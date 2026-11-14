// 맵: 정사각형 아레나 + 축 정렬 벽(AABB). 벽은 이동과 시야를 모두 막는다.
export const MAP_SIZE = 64;
export const WALL_HEIGHT = 3;

const H = MAP_SIZE / 2;

// [중심x, 중심z, 가로, 세로]
const defs = [
  // 외곽
  [0, -H, MAP_SIZE + 1, 1],
  [0, H, MAP_SIZE + 1, 1],
  [-H, 0, 1, MAP_SIZE + 1],
  [H, 0, 1, MAP_SIZE + 1],
  // 중앙
  [0, 0, 6, 6],
  [0, 14, 8, 1.5],
  [0, -14, 8, 1.5],
  [14, 0, 1.5, 8],
  [-14, 0, 1.5, 8],
  [0, 25, 1.5, 6],
  [0, -25, 1.5, 6],
  [25, 0, 6, 1.5],
  [-25, 0, 6, 1.5],
];

// 한 사분면을 4방향으로 대칭 복사
const quadrant = [
  [10, 10, 2, 2],
  [18, 8, 8, 1.5],
  [8, 19, 1.5, 9],
  [22, 20, 3, 3],
  [16, 26, 10, 1.5],
  [27, 12, 1.5, 7],
  [14, 15, 2, 2],
];
for (const [x, z, w, d] of quadrant) {
  for (const sx of [1, -1]) for (const sz of [1, -1]) defs.push([x * sx, z * sz, w, d]);
}

export const WALLS = defs.map(([cx, cz, w, d]) => ({
  cx,
  cz,
  w,
  d,
  minX: cx - w / 2,
  maxX: cx + w / 2,
  minZ: cz - d / 2,
  maxZ: cz + d / 2,
}));

export function isFree(x, z, clearance) {
  const lim = H - 0.5 - clearance;
  if (x < -lim || x > lim || z < -lim || z > lim) return false;
  for (const w of WALLS) {
    if (x > w.minX - clearance && x < w.maxX + clearance && z > w.minZ - clearance && z < w.maxZ + clearance)
      return false;
  }
  return true;
}
