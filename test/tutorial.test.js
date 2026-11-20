import test from 'node:test';
import assert from 'node:assert/strict';
import { TUTORIAL_LAYOUT as L } from '../shared/tutorial.js';
import { MAPS, isFree } from '../shared/map.js';
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
