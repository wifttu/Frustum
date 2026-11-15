import test from 'node:test';
import assert from 'node:assert/strict';
import { findPath, walkable } from '../server/nav.js';
import { isFree, MAPS, WALLS } from '../shared/map.js';
import { Game } from '../server/game.js';
import { CFG } from '../shared/config.js';

test('길찾기: 벽을 돌아가는 경로를 찾고, 모든 구간을 걸을 수 있다', () => {
  // 중앙 블록(6m x 6m)을 사이에 둔 두 점
  const path = findPath(WALLS, -6, 0.5, 6, 0.5);
  assert.ok(path && path.length >= 2, '직선으로는 못 가므로 경유점이 있어야 한다');
  let [x, z] = [-6, 0.5];
  for (const [nx, nz] of path) {
    assert.ok(isFree(nx, nz, 0.5));
    assert.ok(walkable(x, z, nx, nz, WALLS), `(${x},${z}) → (${nx},${nz})`);
    [x, z] = [nx, nz];
  }
  assert.ok(Math.hypot(x - 6, z - 0.5) < 1.5);
});

test('길찾기: 트인 곳은 한 번에 간다', () => {
  const path = findPath(WALLS, -28, -28, -22, -28);
  assert.equal(path.length, 1);
});

test('봇은 오래 한자리에 끼어 있지 않는다', () => {
  const game = new Game({ rule: 'dm', mode: 'duo', TEAMS: 1 }); // 전원 같은 팀: 싸우지 않고 순찰만 한다
  game.balanceBots();
  const bots = [...game.players.values()];
  let stuckSamples = 0;
  let samples = 0;
  for (let s = 0; s < 40; s++) {
    const before = bots.map((b) => [b.x, b.z]);
    for (let i = 0; i < CFG.TICK_RATE; i++) game.step();
    bots.forEach((b, i) => {
      samples++;
      if (Math.hypot(b.x - before[i][0], b.z - before[i][1]) < 0.5) stuckSamples++;
    });
  }
  assert.ok(stuckSamples / samples < 0.1, `멈춘 비율 ${(stuckSamples / samples * 100).toFixed(1)}%`);
});

test('길찾기: 모든 맵에서 임의의 두 빈 지점 사이에 길이 있다 (막힌 구역 없음)', () => {
  for (const map of Object.values(MAPS)) {
    let seed = 3;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 58 - 29;
    const pts = [];
    while (pts.length < 40) {
      const p = [rnd(), rnd()];
      if (isFree(p[0], p[1], 1, map.solid)) pts.push(p);
    }
    for (let i = 0; i < pts.length - 1; i++) {
      assert.ok(findPath(map.solid, ...pts[i], ...pts[i + 1]), `${map.id}: ${pts[i]} → ${pts[i + 1]}`);
    }
  }
});

test('호수: 이동은 막지만 시야는 막지 않는다', async () => {
  const { canSee } = await import('../shared/vision.js');
  const lake = MAPS.lake;
  assert.equal(isFree(0, 0, 0.45, lake.solid), false);
  assert.equal(isFree(0, 0, 0.45, lake.walls), true);
  // 호수 건너편(14m)이 보인다
  assert.equal(canSee({ x: 0, z: -7.5, yaw: 0 }, 0, 7.5, 0.45, lake.walls, CFG), true);
});
