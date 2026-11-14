// 손전등 빔 판정, 구르기, 조명탄, 라운드 진행.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../server/game.js';
import { CFG } from '../shared/config.js';
import { stepPlayer } from '../shared/sim.js';

function setup(opts) {
  const game = new Game({ BOT_FILL: 0, ...opts });
  game.walls = [];
  const sent = new Map();
  const add = (name) => {
    const box = [];
    const p = game.addPlayer(name, (m) => box.push(JSON.parse(m)));
    sent.set(p.id, box);
    return p;
  };
  const place = (p, x, z, yaw) => Object.assign(p, { x, z, yaw, alive: true });
  return { game, add, place, sent };
}
const at = (deg, d) => [Math.sin((deg * Math.PI) / 180) * d, Math.cos((deg * Math.PI) / 180) * d];

test('빔: 6m 앞, 15도 옆의 적을 맞힌다', () => {
  const { game, add, place } = setup();
  const a = add('A');
  const b = add('B');
  place(a, 0, 0, 0);
  place(b, ...at(15, 6), 0);
  game.attack(a);
  assert.equal(b.alive, false);
});

test('빔: 원뿔 밖(35도)이나 사거리 밖(9m)은 맞지 않는다', () => {
  const { game, add, place } = setup();
  const a = add('A');
  const b = add('B');
  place(a, 0, 0, 0);
  place(b, ...at(35, 6), 0);
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

test('라운드: 목표 점수에 도달하면 종료되고 휴식 후 초기화된다', () => {
  const { game, add, place, sent } = setup({ TARGET_SCORE: 2, INTERMISSION: 1 });
  const a = add('A');
  const b = add('B');
  for (let i = 0; i < 2; i++) {
    place(a, 0, 0, 0);
    place(b, 0, 3, 0);
    a.cd = 0;
    game.attack(a);
  }
  assert.equal(game.winner, a.team);
  game.broadcast();
  assert.ok(sent.get(a.id).some((m) => m.t === 'e' && m.w === a.team));
  for (let i = 0; i < CFG.TICK_RATE + 2; i++) game.step();
  assert.equal(game.winner, null);
  assert.equal(a.score, 0);
  assert.ok(a.alive && b.alive);
});
