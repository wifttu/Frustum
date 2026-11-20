import test from 'node:test';
import assert from 'node:assert/strict';
import { TUTORIAL_LAYOUT as L } from '../shared/tutorial.js';
import { MAPS, closedMap, isFree } from '../shared/map.js';
import { CFG } from '../shared/config.js';
import { canSee, segmentBlocked } from '../shared/vision.js';
import { flareLanding } from '../shared/sim.js';
import { findPath } from '../server/nav.js';

const map = MAPS[L.map];
const all = { ...CFG, FOV: Math.PI * 2 }; // 어느 쪽을 보든

test('연습 배치: 모든 자리가 비어 있고 걸어서 갈 수 있다', () => {
  for (const k of ['start', 'dummy', 'guard', 'pad', 'hidden']) assert.ok(isFree(...L[k], 0.8, map.solid), k);
  for (const [a, b] of [['start', 'dummy'], ['dummy', 'guard'], ['guard', 'pad']]) assert.ok(findPath(map.solid, ...L[a], ...L[b]), `${a} → ${b}`);
});

test('연습 배치: 처음 자리에서는 허수아비가 벽에 가려 안 보이고, 조금 멀리 있다', () => {
  assert.ok(segmentBlocked(...L.start, ...L.dummy, map.walls));
  assert.ok(Math.hypot(L.dummy[0] - L.start[0], L.dummy[1] - L.start[1]) > 12);
});

test('연습 배치: 숨은 허수아비는 발판·경비·첫 허수아비 자리에서 안 보이고, 발판에서 던진 조명탄 빛에는 보인다', () => {
  for (const k of ['pad', 'guard', 'dummy']) assert.equal(canSee({ x: L[k][0], z: L[k][1], yaw: 0 }, ...L.hidden, CFG.PLAYER_RADIUS, map.walls, all, CFG.VIS_MARGIN), false, k);
  const [lx, lz] = flareLanding({ x: L.pad[0], z: L.pad[1], yaw: L.padYaw }, map.walls);
  assert.ok(Math.hypot(lx - L.pad[0], lz - L.pad[1]) > 6, '조명탄이 충분히 멀리 날아간다');
  const flare = { ...CFG, FOV: Math.PI * 2, VIEW_RANGE: CFG.FLARE_RADIUS, NEAR_RADIUS: 1 };
  assert.ok(canSee({ x: lx, z: lz, yaw: 0 }, ...L.hidden, CFG.PLAYER_RADIUS, map.walls, flare), '조명탄 빛에 보인다');
});

test('연습 배치: 게임을 훈련장으로 열면 정말 훈련장이다 (순환에 없는 맵)', async () => {
  const { Game } = await import('../server/game.js');
  const g = new Game({ mode: 'ffa', rule: 'dm', map: L.map, FIXED_MAP: true, BOT_FILL: 0 });
  assert.equal(g.map.id, 'training');
  g.newRound();
  assert.equal(g.map.id, 'training');
});

test('연습 배치: 문을 닫으면 시작 마당 밖으로 못 나가고, 마당 어디에서도 허수아비가 안 보인다', () => {
  const closed = closedMap(map);
  assert.equal(findPath(closed.solid, ...L.start, ...L.dummy), null);
  let n = 0;
  for (let x = -14; x <= 14; x += 1) {
    for (let z = -14; z <= -7; z += 1) {
      if (!isFree(x, z, CFG.PLAYER_RADIUS, closed.solid)) continue;
      n++;
      assert.equal(canSee({ x, z, yaw: 0 }, ...L.dummy, CFG.PLAYER_RADIUS, closed.walls, all, CFG.VIS_MARGIN), false, `(${x}, ${z})`);
    }
  }
  assert.ok(n > 50, '마당이 충분히 넓다');
});

test('연습: 경비·숨은 허수아비는 쓰러뜨릴 수 없다', async () => {
  const { Game } = await import('../server/game.js');
  const g = new Game({ mode: 'ffa', rule: 'dm', map: L.map, FIXED_MAP: true, BOT_FILL: 0, START_GRACE: 0 });
  const me = g.addPlayer('Me', () => {});
  const t = g.addPlayer('경비', null, true);
  Object.assign(t, { dummy: true, invuln: true });
  g.applyStats(t);
  Object.assign(me, { x: 9, z: -2, yaw: 0, alive: true });
  Object.assign(t, { x: 9, z: 1, alive: true, hp: t.stats.maxHp });
  for (let i = 0; i < 5; i++) {
    me.cd = 0;
    g.attack(me);
  }
  assert.equal(t.alive, true);
  assert.equal(t.hp, t.stats.maxHp);
});
