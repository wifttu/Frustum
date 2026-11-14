import test from 'node:test';
import assert from 'node:assert/strict';
import { CFG } from '../shared/config.js';
import { canSee, computeVisionFan, MAX_FAN_POINTS, segmentBlocked, wrapAngle } from '../shared/vision.js';

const R = CFG.PLAYER_RADIUS;
const wall = (cx, cz, w, d) => ({ cx, cz, w, d, minX: cx - w / 2, maxX: cx + w / 2, minZ: cz - d / 2, maxZ: cz + d / 2 });
const viewer = { x: 0, z: 0, yaw: 0 }; // +z 방향을 봄

test('wrapAngle', () => {
  assert.ok(Math.abs(wrapAngle(Math.PI * 3) - Math.PI) < 1e-9 || Math.abs(wrapAngle(Math.PI * 3) + Math.PI) < 1e-9);
  assert.ok(Math.abs(wrapAngle(-0.1) + 0.1) < 1e-12);
});

test('정면의 대상은 보인다', () => {
  assert.equal(canSee(viewer, 0, 10, R, [], CFG), true);
});

test('등 뒤와 측면(FOV 밖)은 보이지 않는다', () => {
  assert.equal(canSee(viewer, 0, -10, R, [], CFG), false);
  assert.equal(canSee(viewer, 10, 0, R, [], CFG), false);
  assert.equal(canSee(viewer, -10, 1, R, [], CFG), false);
});

test('FOV 경계: 45도 안쪽은 보이고 바깥은 안 보인다', () => {
  const at = (deg, d = 10) => [Math.sin((deg * Math.PI) / 180) * d, Math.cos((deg * Math.PI) / 180) * d];
  assert.equal(canSee(viewer, ...at(40), R, [], CFG), true);
  assert.equal(canSee(viewer, ...at(-40), R, [], CFG), true);
  assert.equal(canSee(viewer, ...at(55), R, [], CFG), false);
  assert.equal(canSee(viewer, ...at(-55), R, [], CFG), false);
});

test('시야 거리 밖은 보이지 않는다', () => {
  assert.equal(canSee(viewer, 0, CFG.VIEW_RANGE - 1, R, [], CFG), true);
  assert.equal(canSee(viewer, 0, CFG.VIEW_RANGE + 2, R, [], CFG), false);
});

test('근접 반경 안은 방향과 무관하게 감지된다', () => {
  assert.equal(canSee(viewer, 0, -1.2, R, [], CFG), true);
  assert.equal(canSee(viewer, 0, -3.5, R, [], CFG), false);
});

test('벽 뒤는 보이지 않고, 벽 옆으로 몸이 일부 나오면 보인다', () => {
  const walls = [wall(0, 5, 4, 1)];
  assert.equal(canSee(viewer, 0, 10, R, walls, CFG), false);
  assert.equal(segmentBlocked(0, 0, 0, 10, walls), true);
  assert.equal(canSee(viewer, 6, 10, R, walls, CFG), true);
  // 중심은 가려졌지만 가장자리가 보이는 경우
  assert.equal(segmentBlocked(0, 0, 3.9, 10, walls), true);
  assert.equal(canSee(viewer, 4.2, 10, R, walls, CFG), true);
});

test('시야 방향을 돌리면 결과가 달라진다', () => {
  assert.equal(canSee({ x: 0, z: 0, yaw: Math.PI / 2 }, 10, 0, R, [], CFG), true);
  assert.equal(canSee({ x: 0, z: 0, yaw: Math.PI / 2 }, 0, 10, R, [], CFG), false);
});

test('시야 다각형: 벽이 그림자를 만들고 닿은 벽을 표시한다', () => {
  const walls = [wall(0, 5, 4, 1), wall(0, -5, 4, 1)];
  const pts = new Float32Array(MAX_FAN_POINTS * 2);
  const seen = new Uint8Array(walls.length);
  const n = computeVisionFan(0, 0, 0, walls, CFG, pts, seen);
  assert.ok(n > 40);
  assert.deepEqual([...seen], [1, 0]); // 앞의 벽만 보임
  let minD = Infinity;
  let maxD = 0;
  for (let i = 0; i < n; i++) {
    const d = Math.hypot(pts[i * 2], pts[i * 2 + 1]);
    minD = Math.min(minD, d);
    maxD = Math.max(maxD, d);
    // 모든 점은 FOV 안
    assert.ok(Math.abs(Math.atan2(pts[i * 2], pts[i * 2 + 1])) <= CFG.FOV / 2 + 1e-6);
  }
  assert.ok(minD < 5.2, '벽에 막힌 광선은 짧다'); // 4.5 + 침투 0.5
  assert.ok(Math.abs(maxD - CFG.VIEW_RANGE) < 1e-3, '안 막힌 광선은 시야 거리까지');
});
