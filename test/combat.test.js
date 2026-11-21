// 손전등 빔 판정, 구르기, 조명탄, 라운드 진행.
import test from 'node:test';
import { MAP_ROTATION } from '../shared/map.js';
import assert from 'node:assert/strict';
import { Game } from '../server/game.js';
import { CFG, ZONE, zoneHalf } from '../shared/config.js';
import { stepPlayer } from '../shared/sim.js';

function setup(opts) {
  const game = new Game({ BOT_FILL: 0, TEAMS: 2, ...opts });
  game.walls = [];
  const sent = new Map();
  const add = (name) => {
    const box = [];
    const p = game.addPlayer(name, (m) => box.push(JSON.parse(m)));
    sent.set(p.id, box);
    return p;
  };
  // 기존 테스트는 한 방 판정을 검증하므로 체력을 1로 둔다 (체력/성장은 progress.test.js)
  const place = (p, x, z, yaw) => Object.assign(p, { x, z, yaw, alive: true, hp: 1 });
  return { game, add, place, sent };
}
const at = (deg, d) => [Math.sin((deg * Math.PI) / 180) * d, Math.cos((deg * Math.PI) / 180) * d];

test('빔: 5.5m 앞, 15도 옆의 적을 맞힌다', () => {
  const { game, add, place } = setup();
  const a = add('A');
  const b = add('B');
  place(a, 0, 0, 0);
  place(b, ...at(15, 5.5), 0);
  game.attack(a);
  assert.equal(b.alive, false);
});

test('빔: 원뿔 밖(35도)이나 사거리 밖(9m)은 맞지 않는다', () => {
  const { game, add, place } = setup();
  const a = add('A');
  const b = add('B');
  place(a, 0, 0, 0);
  place(b, ...at(35, 5), 0);
  game.attack(a);
  assert.equal(b.alive, true);
  place(b, 0, 9, 0);
  game.attack(a);
  assert.equal(b.alive, true);
});

test('빔: 벽에 막힌다', () => {
  const { game, add, place } = setup();
  const a = add('A');
  const b = add('B');
  game.walls = [{ minX: -2, maxX: 2, minZ: 2, maxZ: 3 }];
  place(a, 0, 0, 0);
  place(b, 0, 5, 0);
  game.attack(a);
  assert.equal(b.alive, true);
});

test('구르기: 짧은 시간에 멀리 이동하고 쿨다운이 걸린다', () => {
  const p = { x: 0, z: 0, yaw: 0 };
  const dt = 1 / CFG.TICK_RATE;
  stepPlayer(p, { mx: 0, mz: 0, yaw: 0, roll: true }, dt, []);
  for (let i = 0; i < 20; i++) stepPlayer(p, { mx: 0, mz: 0, yaw: 0, roll: true }, dt, []);
  assert.ok(Math.abs(p.z - CFG.ROLL_SPEED * CFG.ROLL_TIME) < 0.6, `z=${p.z}`);
  assert.ok(p.rollCd > 0);
  // 쿨다운 중에는 다시 구르지 않는다
  const z = p.z;
  stepPlayer(p, { mx: 0, mz: 0, yaw: 0, roll: true }, dt, []);
  assert.equal(p.z, z);
});

test('구르기: 이동 방향으로 구른다', () => {
  const p = { x: 0, z: 0, yaw: 0 };
  stepPlayer(p, { mx: 1, mz: 0, yaw: 0, roll: true }, 1 / CFG.TICK_RATE, []);
  assert.ok(p.x < -0.3 && Math.abs(p.z) < 1e-9, '오른쪽(-x)으로 이동');
});

test('구르는 중에는 빔에 맞지 않는다', () => {
  const { game, add, place } = setup();
  const a = add('A');
  const b = add('B');
  place(a, 0, 0, 0);
  place(b, 0, 5, 0);
  b.rollT = 0.2;
  game.attack(a);
  assert.equal(b.alive, true);
  b.rollT = 0;
  game.attack(a);
  assert.equal(b.alive, false);
});

test('조명탄: 등 뒤의 적을 팀 시야에 드러낸다', () => {
  const { game, add, place } = setup();
  const a = add('A');
  const b = add('B');
  place(a, 0, 0, 0);
  place(b, 0, -10, 0); // A의 등 뒤
  assert.equal(game.computeVisibility().get(a.team).has(b.id), false);
  a.yaw = Math.PI; // 뒤로 던지고
  game.throwFlare(a);
  a.yaw = 0; // 다시 앞을 봐도
  assert.equal(game.computeVisibility().get(a.team).has(b.id), true);
  // 시간이 지나면 꺼진다
  for (let i = 0; i < CFG.FLARE_TIME * CFG.TICK_RATE + 2; i++) game.step();
  if (b.alive && a.alive) assert.equal(game.computeVisibility().get(a.team).has(b.id), false);
});

test('조명탄은 같은 팀에게만 전송된다', () => {
  const { game, add, place, sent } = setup();
  const a = add('A');
  const b = add('B');
  place(a, 0, 0, 0);
  place(b, 20, 20, 0);
  game.throwFlare(a);
  game.broadcast();
  const last = (p) => sent.get(p.id).filter((m) => m.t === 's').pop();
  assert.equal(last(a).f.length, 1);
  assert.equal(last(b).f.length, 0);
});

test('생존전: 마지막 한 팀이 남으면 라운드가 끝나고, 휴식 후 전원 부활한다', () => {
  const { game, add, place, sent } = setup({ TEAMS: 0, INTERMISSION: 1 });
  const a = add('A');
  const b = add('B');
  const c = add('C');
  place(a, 0, 0, 0);
  place(b, 0, 3, 0);
  place(c, 20, 20, 0);
  game.attack(a);
  assert.equal(b.alive, false);
  assert.equal(game.winner, null, '아직 둘이 남았다');
  // 탈락자는 부활하지 않는다
  for (let i = 0; i < CFG.TICK_RATE * 5; i++) game.step();
  assert.equal(b.alive, false);
  place(c, a.x, a.z + 3, 0);
  a.yaw = 0;
  game.attack(a);
  assert.equal(game.winner, a.team);
  assert.equal(a.wins, 1);
  game.broadcast();
  assert.ok(sent.get(b.id).some((m) => m.t === 'e' && m.w === a.team && m.n[0] === 'A'));
  for (let i = 0; i < CFG.TICK_RATE + 2; i++) game.step();
  assert.equal(game.winner, null);
  assert.ok(a.alive && b.alive && c.alive);
  assert.equal(a.score, 0);
});

test('생존전: 시간이 다 되면 생존자가 많은 팀이 이긴다', () => {
  const { game, add, place } = setup({ TEAMS: 2, ROUND_TIME: 1, START_GRACE: 0 });
  const a = add('A'); // 팀 1
  const b = add('B'); // 팀 2
  const c = add('C'); // 팀 1
  place(a, -20, -20, 0);
  place(c, -22, -20, 0);
  place(b, 20, 20, 0);
  for (let i = 0; i < CFG.TICK_RATE + 2; i++) game.step();
  assert.equal(game.winner, a.team);
});

test('모드: ffa는 전원 다른 팀, duo는 2명씩 4팀', () => {
  const ffa = new Game({ mode: 'ffa' });
  ffa.balanceBots();
  assert.equal(ffa.players.size, 8);
  assert.equal(new Set([...ffa.players.values()].map((p) => p.team)).size, 8);
  const duo = new Game({ mode: 'duo' });
  duo.balanceBots();
  const sizes = new Map();
  for (const p of duo.players.values()) sizes.set(p.team, (sizes.get(p.team) || 0) + 1);
  assert.deepEqual([...sizes.values()], [2, 2, 2, 2]);
});

test('사람은 살아있는 봇의 자리를 이어받는다', () => {
  const game = new Game({ mode: 'duo' });
  game.balanceBots();
  for (let i = 0; i < CFG.TICK_RATE * 15; i++) game.step(); // 유예 시간 이후
  if (game.endT > 0) return; // 봇끼리 이미 끝낸 경우는 건너뛴다
  const aliveBefore = [...game.players.values()].filter((p) => p.alive).length;
  const h = game.addPlayer('H', () => {});
  game.balanceBots();
  assert.equal(game.players.size, 8);
  assert.equal([...game.players.values()].filter((p) => p.alive).length, aliveBefore);
  if (aliveBefore > 0) assert.equal(h.alive, true);
  assert.equal(game.teamSize(h.team), 2);
});

test('데스매치: 처치당하면 잠시 후 부활하고, 시간 종료 시 킬이 많은 쪽이 이긴다', () => {
  const { game, add, place } = setup({ rule: 'dm', TEAMS: 0, ROUND_TIME: 6, START_GRACE: 0 });
  const a = add('A');
  const b = add('B');
  place(a, 0, 0, 0);
  place(b, 0, 3, 0);
  game.attack(a);
  assert.equal(b.alive, false);
  assert.equal(game.winner, null, '데스매치는 한 명만 남아도 끝나지 않는다');
  for (let i = 0; i < CFG.TICK_RATE * (CFG.RESPAWN_TIME + 0.2); i++) game.step();
  assert.equal(b.alive, true);
  for (let i = 0; i < CFG.TICK_RATE * 3; i++) game.step();
  assert.equal(game.winner, a.team);
});

test('점수제 데스매치: 목표 킬에 먼저 도달하면 끝난다', () => {
  const { game, add, place } = setup({ rule: 'score', TEAMS: 0, TARGET: 2 });
  const a = add('A');
  const b = add('B');
  for (let i = 0; i < 2; i++) {
    assert.equal(game.winner, null);
    place(a, 0, 0, 0);
    place(b, 0, 3, 0);
    game.attack(a);
  }
  assert.equal(game.winner, a.team);
  assert.equal(new Game({ rule: 'score', mode: 'duo' }).info().g, 15);
});

test('독구름: 안전 구역이 가장자리에서 중앙으로 줄어든다', () => {
  assert.equal(zoneHalf(0), 32);
  assert.equal(zoneHalf(ZONE.WAIT), 32);
  assert.ok(zoneHalf((ZONE.WAIT + ZONE.END) / 2) < 32);
  assert.equal(zoneHalf(ZONE.END + 50), ZONE.MIN_HALF);
});

test('독구름: 구역 밖에 오래 있으면 탈락하고, 안에 있으면 회복한다', () => {
  const { game, add, place } = setup({ TEAMS: 0 });
  const a = add('A');
  const b = add('B');
  const c = add('C');
  game.roundT = ZONE.END; // 최소 구역
  place(a, 0, 5, 0); // 안
  place(b, 20, 20, 0); // 밖
  place(c, 0, -5, 0); // 안
  for (let i = 0; i < CFG.TICK_RATE * (ZONE.GAS_TIME - 1); i++) game.step();
  assert.equal(b.alive, true);
  assert.ok(b.gas > 1.5 && a.gas === 0);
  for (let i = 0; i < CFG.TICK_RATE * 1.2; i++) game.step();
  assert.equal(b.alive, false);
  assert.deepEqual(game.kills.at(-1), [0, b.id]);
  assert.equal(game.winner, null, '안에 있는 둘은 계속 싸운다');
});

test('독구름은 서바이벌에만 있다', () => {
  assert.equal(new Game({ rule: 'dm' }).zoneHalf(), Infinity);
  assert.equal(new Game({ rule: 'survival' }).zoneHalf(), 32);
});

test('아이템: 밟으면 효과가 적용되고 사라진다', () => {
  const { game, add, place } = setup({ TEAMS: 0, START_GRACE: 0 });
  const a = add('A');
  const b = add('B');
  place(a, 0, 0, 0);
  place(b, 20, 20, 0);
  a.cd = 3;
  a.flareCd = 9;
  game.items = [{ id: 1, type: 'battery', x: 0.3, z: 0 }, { id: 2, type: 'sneakers', x: 0, z: 0.4 }];
  game.step();
  assert.equal(game.items.length, 0);
  assert.equal(a.cd, 0);
  assert.equal(a.flareCd, 0);
  assert.ok(a.speedT > 5);
});

test('아이템: 반사 조끼는 한 번 막고 사라진다', () => {
  const { game, add, place, sent } = setup({ TEAMS: 0 });
  const a = add('A');
  const b = add('B');
  place(a, 0, 0, 0);
  place(b, 0, 3, 0);
  b.vest = 10;
  game.attack(a);
  assert.equal(b.alive, true);
  assert.equal(b.vest, 0);
  game.broadcast();
  assert.ok(sent.get(b.id).some((m) => m.t === 'b'));
  a.cd = 0;
  game.attack(a);
  assert.equal(b.alive, false);
});

test('아이템: 망토를 쓰면 가까이 오기 전에는 위치가 전송되지 않는다', () => {
  const { game, add, place } = setup({ TEAMS: 0 });
  const a = add('A');
  const b = add('B');
  place(a, 0, 0, 0);
  place(b, 0, 6, Math.PI);
  b.cloakT = 5;
  assert.equal(game.computeVisibility().get(a.team).has(b.id), false);
  place(b, 0, 1.5, Math.PI);
  assert.equal(game.computeVisibility().get(a.team).has(b.id), true);
  // 공격하면 벗겨진다
  place(b, 0, 6, Math.PI);
  game.attack(b);
  assert.equal(b.cloakT, 0);
});

test('맵: 라운드마다 다음 맵으로 바뀌고, 클라이언트에 알린다', () => {
  const { game, add, sent } = setup({ TEAMS: 0 });
  add('A');
  const ids = [game.map.id];
  for (let i = 0; i < MAP_ROTATION.length; i++) {
    game.newRound();
    ids.push(game.map.id);
  }
  assert.deepEqual(ids, [...MAP_ROTATION, MAP_ROTATION[0]]);
  game.broadcast();
  assert.ok(sent.get(1).some((m) => m.t === 'n' && m.map === MAP_ROTATION[1]));
});

test('관전: 쓰러지면 잡은 상대의 시야로 보고, 다음 대상으로 바꿀 수 있다', () => {
  const { game, add, place } = setup({ TEAMS: 0 });
  const a = add('A');
  const b = add('B');
  const c = add('C');
  place(a, 0, 0, 0);
  place(b, 0, 3, Math.PI); // a 를 바라본다
  place(c, 20, 20, 0);
  a.hp = 1;
  game.attack(b);
  assert.equal(a.alive, false);
  let snap = game.snapshotFor(a, game.computeVisibility());
  assert.equal(snap.w, b.id);
  // b 의 팀(= b 자신) 시야: b 는 목록에 들어 있다
  assert.ok(snap.e.some((x) => x[0] === b.id));
  game.cycleWatch(a);
  snap = game.snapshotFor(a, game.computeVisibility());
  assert.equal(snap.w, c.id);
  // 살아나면 관전 끝
  place(a, 0, 0, 0);
  snap = game.snapshotFor(a, game.computeVisibility());
  assert.equal(snap.w, 0);
});

test('감정표현: 번호만 받고, 너무 자주 보내면 무시한다', () => {
  const { game, add, sent } = setup({ TEAMS: 0 });
  const a = add('A');
  game.emote(a, 2);
  game.emote(a, 3); // 바로 또 보내면 무시
  game.emote(a, 99); // 없는 번호
  game.broadcast();
  const msgs = sent.get(a.id).filter((m) => m.t === 'em');
  assert.deepEqual(msgs.map((m) => m.l), [[[a.id, 2]]]);
  for (let i = 0; i < CFG.TICK_RATE * 2; i++) game.step();
  game.emote(a, 5);
  game.broadcast();
  assert.ok(sent.get(a.id).some((m) => m.t === 'em' && m.l[0][1] === 5));
});

test('연습 허수아비: 회복하지 않고 기본 손전등 딱 2방에 쓰러진다', () => {
  const { game, add, place } = setup({ TEAMS: 0 });
  const me = add('Me');
  const dummy = game.addPlayer('허수아비', null, true);
  dummy.dummy = true;
  game.applyStats(dummy);
  place(me, 0, 0, 0);
  place(dummy, 0, 3, 0);
  dummy.hp = dummy.stats.maxHp;
  game.attack(me);
  assert.equal(dummy.alive, true);
  for (let i = 0; i < CFG.TICK_RATE * 10; i++) game.step(); // 10초 기다려도 회복하지 않는다
  assert.equal(dummy.hp, dummy.stats.maxHp - Math.round(me.stats.damage));
  me.cd = 0;
  game.attack(me);
  assert.equal(dummy.alive, false);
});

test('연습 허수아비: 정해 둔 처치 경험치와 보석을 주고, 다시 나타나지 않는다', () => {
  const { game, add, place } = setup({ TEAMS: 0, fireflies: false });
  const me = add('Me');
  const dummy = game.addPlayer('허수아비', null, true);
  Object.assign(dummy, { dummy: true, killXp: 10, drops: [6, 6, 18] });
  game.applyStats(dummy);
  place(me, 0, 0, 0);
  place(dummy, 0, 3, 0);
  dummy.hp = 1;
  game.attack(me);
  assert.equal(dummy.alive, false);
  assert.equal(me.xp, 10);
  assert.deepEqual(game.fireflies.map((f) => f.v).sort((a, b) => a - b), [6, 6, 18]);
  for (let i = 0; i < CFG.TICK_RATE * 6; i++) game.step();
  assert.equal(dummy.alive, false);
});

test('연습 경비 허수아비: 가까이 보이면 비추고, 체력이 많이 줄면 봐준다', () => {
  const { game, add, place } = setup({ TEAMS: 0 });
  const me = add('Me');
  const t = game.addPlayer('경비', null, true);
  Object.assign(t, { dummy: true, turret: true });
  game.applyStats(t);
  place(me, 0, 0, 0);
  place(t, 3, 3, 0);
  me.hp = me.stats.maxHp;
  for (let i = 0; i < CFG.TICK_RATE * 10; i++) game.step();
  assert.equal(me.alive, true);
  assert.ok(me.hp < me.stats.maxHp, '맞았다');
  assert.ok(me.hp >= me.stats.maxHp * 0.2, '많이 줄면 더는 비추지 않는다');
  // 멀리 가면 못 비춘다
  Object.assign(me, { x: 20, z: 20 });
  const hp = me.hp;
  for (let i = 0; i < CFG.TICK_RATE * 2; i++) game.step();
  assert.ok(me.hp >= hp);
});

test('모닥불 점령: 둘레 안에 우리 편만 있으면 1초에 1점, 상대도 있으면 쟁탈 중이라 0점', () => {
  const { game, add, place } = setup({ rule: 'hill', mode: 'ffa', TEAMS: 0 });
  const a = add('A');
  const b = add('B');
  const h = game.hill;
  game.roundT = CFG.START_GRACE; // 시작 직후 대기 시간은 지났다
  place(a, h.x, h.z, 0);
  place(b, h.x + 20, h.z, 0);
  for (let i = 0; i < CFG.TICK_RATE * 2; i++) game.step();
  assert.equal(game.hillOwner, a.team);
  assert.equal(Math.round(game.capPts.get(a.team)), 2);
  assert.equal(Math.round(a.cap), 2);
  // 상대가 들어오면 쟁탈 중: 아무도 점수를 얻지 못한다
  place(b, h.x + 1, h.z, Math.PI);
  for (let i = 0; i < CFG.TICK_RATE; i++) game.step();
  assert.equal(game.hillFight, true);
  assert.equal(game.hillOwner, 0);
  assert.equal(Math.round(game.capPts.get(a.team)), 2);
  assert.equal(game.capPts.get(b.team) || 0, 0);
  // 스냅샷: 우리 편 기준 [차지한 편, 쟁탈, 우리 점수, 상대 최고 점수]
  const snap = game.snapshotFor(a, game.computeVisibility());
  assert.deepEqual(snap.cp, [0, 1, 2, 0]);
  assert.equal(game.roster().p.find((r) => r[0] === a.id)[10], 2);
});

test('모닥불 점령: 목표 점수를 먼저 채우면 이기고, 시간이 끝나면 점수가 높은 편이 이긴다', () => {
  const { game, add, place } = setup({ rule: 'hill', mode: 'ffa', TEAMS: 0, CAP_GOAL: 3 });
  const a = add('A');
  const b = add('B');
  game.roundT = CFG.START_GRACE;
  place(a, game.hill.x, game.hill.z, 0);
  place(b, game.hill.x + 20, game.hill.z, 0);
  for (let i = 0; i < CFG.TICK_RATE * 4 && !game.endT; i++) game.step();
  assert.ok(game.endT > 0);
  assert.equal(game.winner, a.team);

  const t = setup({ rule: 'hill', mode: 'ffa', TEAMS: 0 });
  const c = t.add('C');
  const d = t.add('D');
  t.game.capPts.set(c.team, 4);
  t.game.capPts.set(d.team, 9);
  c.score = 3; // 킬이 많아도 점수가 먼저
  t.game.timeUp();
  assert.equal(t.game.winner, d.team);
});

test('모닥불 점령: 새 라운드에는 점수가 0부터, 봇은 모닥불로 모인다', () => {
  const game = new Game({ rule: 'hill', mode: 'duo' });
  game.balanceBots();
  game.capPts.set(1, 10);
  for (const p of game.players.values()) p.cap = 5;
  game.newRound();
  assert.equal(game.capPts.size, 0);
  for (const p of game.players.values()) assert.equal(p.cap, 0);
  // 1분 동안: 여러 봇이 모닥불 둘레에 들어온다
  const visited = new Set();
  for (let i = 0; i < CFG.TICK_RATE * 60; i++) {
    game.step();
    for (const p of game.players.values()) if (p.alive && Math.hypot(p.x - game.hill.x, p.z - game.hill.z) < game.hill.r) visited.add(p.id);
  }
  assert.ok(visited.size >= 3, `visited ${visited.size}`);
});

test('결과 화면: 혼자 하기는 다시하기를 누를 때까지 기다리고, 누르면 결과를 잠깐 보여 준 뒤 다음 판', () => {
  const { game, add } = setup({ HOLD_END: true });
  const a = add('A');
  game.addPlayer('AI', null, true); // 혼자 하기: 사람 한 명 + AI
  game.endRound(a.team);
  for (let i = 0; i < CFG.TICK_RATE * 20; i++) game.step();
  assert.ok(game.endT > 0, '누르기 전에는 다음 판으로 넘어가지 않는다');
  game.again(a);
  game.step();
  assert.equal(game.endT, 0, '결과를 충분히 봤으면 바로 다음 판');
  assert.equal(a.again, false);
});

test('결과 화면: 온라인은 시간이 되면 넘어가고, 사람이 모두 다시하기를 누르면 일찍 넘어간다', () => {
  const { game, add } = setup({});
  const a = add('A');
  const b = add('B');
  game.endRound(a.team);
  game.again(a);
  for (let i = 0; i < CFG.TICK_RATE * 3; i++) game.step();
  assert.ok(game.endT > 0, '한 명만 눌렀으면 기다린다');
  game.again(b);
  game.step();
  assert.equal(game.endT, 0, '모두 눌렀으면 바로');
  // 아무도 안 누르면 정해진 시간 뒤에 넘어간다
  game.endRound(a.team);
  for (let i = 0; i < CFG.TICK_RATE * (CFG.INTERMISSION + 0.5); i++) game.step();
  assert.equal(game.endT, 0);
  // 판이 진행 중일 때 누른 것은 무시
  game.again(a);
  assert.ok(!a.again);
});

test('결과 화면: 다시하기를 누른 사람 수를 모두에게 알린다', () => {
  const { game, add, sent } = setup({});
  const a = add('A');
  const b = add('B');
  game.addPlayer('AI', null, true); // 봇은 세지 않는다
  game.endRound(a.team);
  game.broadcast();
  const ev = sent.get(b.id).find((m) => m.t === 'e');
  assert.equal(ev.hn, 2);
  game.again(a);
  game.again(a); // 두 번 눌러도 한 번
  game.broadcast();
  const ag = sent.get(b.id).filter((m) => m.t === 'ag');
  assert.deepEqual(ag.map((m) => [m.n, m.of]), [[1, 2]]);
  // 결과 화면 중에 한 명이 나가면 인원이 바뀐다
  game.removePlayer(b.id);
  game.broadcast();
  assert.deepEqual(sent.get(a.id).filter((m) => m.t === 'ag').map((m) => [m.n, m.of]), [[1, 2], [1, 1]]);
});

test('시작 카운트다운: 끝날 때까지 아무도 움직이거나 줍지 못하고, 라운드 시간도 흐르지 않는다', () => {
  const game = new Game({ rule: 'dm', mode: 'ffa' });
  game.balanceBots();
  const sent = [];
  const me = game.addPlayer('Me', (m) => sent.push(JSON.parse(m)));
  const bots = [...game.players.values()].filter((p) => p.isBot);
  const start = new Map([...game.players.values()].map((p) => [p.id, [p.x, p.z]]));
  // 내 발밑과 봇 발밑에 보석을 둔다
  game.spawnFirefly(me.x, me.z, 50);
  game.spawnFirefly(bots[0].x, bots[0].z, 50);
  const ffBefore = game.fireflies.length;
  // 앞으로 걷고 공격하는 입력을 계속 보낸다
  let seq = 0;
  for (let i = 0; i < CFG.TICK_RATE * (CFG.START_GRACE - 0.2); i++) {
    game.queueInput(me.id, [++seq, 0, 1, 0.7, 1, 0, 0]);
    game.step();
  }
  assert.ok(game.starting);
  for (const p of game.players.values()) assert.deepEqual([p.x, p.z], start.get(p.id), `${p.name} 는 그대로`);
  assert.ok(Math.abs(me.yaw - 0.7) < 1e-6, '돌아보기는 된다');
  assert.equal(game.fireflies.length, ffBefore, '아무도 보석을 줍지 않았다');
  assert.equal(me.xp + me.level - 1, 0);
  game.broadcast();
  const snap = sent.filter((m) => m.t === 's').at(-1);
  assert.equal(snap.rt, game.cfg.ROUND_TIME, '카운트다운 동안 남은 시간은 그대로');
  assert.equal(snap.cd, 1);
  // 카운트다운이 끝나면 움직인다
  for (let i = 0; i < CFG.TICK_RATE; i++) {
    game.queueInput(me.id, [++seq, 0, 1, 0.7, 0, 0, 0]);
    game.step();
  }
  assert.ok(!game.starting);
  assert.notDeepEqual([me.x, me.z], start.get(me.id));
});

test('중간 입장: 봇 자리를 이어받아도 레벨·경험치·강화는 1레벨부터', () => {
  const game = new Game({ rule: 'dm', mode: 'duo' });
  game.balanceBots();
  for (const p of game.players.values()) Object.assign(p, { level: 7, xp: 40, ups: { power: 2 }, score: 3 });
  game.roundT = 60;
  const me = game.addPlayer('Me', () => {});
  assert.equal(me.level, 1);
  assert.equal(me.xp, 0);
  assert.deepEqual(me.ups, {});
  assert.equal(me.hp, me.stats.maxHp);
  assert.equal(me.score, 3, '팀 점수에 들어가는 잡은 수는 그대로');
  assert.equal(game.info().inp, 1, '진행 중인 판');
  assert.equal(new Game({ rule: 'dm' }).info().inp, 0, '막 시작한 판');
});
