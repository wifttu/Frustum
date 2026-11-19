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
  const { game, add, place } = setup({ TEAMS: 2, ROUND_TIME: 1 });
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
  const { game, add, place } = setup({ rule: 'dm', TEAMS: 0, ROUND_TIME: 6 });
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
