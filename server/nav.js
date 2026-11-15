// 봇 길찾기: 1m 격자 위의 A*. 벽은 고정이라 격자는 한 번만 만든다.
import { MAP_SIZE, isFree } from '../shared/map.js';

const N = MAP_SIZE; // 격자 한 변의 칸 수 (칸 크기 1m)
const HALF = MAP_SIZE / 2;
const CLEAR = 0.6; // 몸 반경 + 여유
const SQRT2 = Math.SQRT2;

const blocked = new Uint8Array(N * N);
for (let cz = 0; cz < N; cz++) {
  for (let cx = 0; cx < N; cx++) blocked[cz * N + cx] = isFree(cx - HALF + 0.5, cz - HALF + 0.5, CLEAR) ? 0 : 1;
}
const cellOf = (v) => Math.max(0, Math.min(N - 1, Math.floor(v + HALF)));
const center = (c) => c - HALF + 0.5;

// 막힌 칸이면 가장 가까운 빈 칸을 찾는다 (벽에 붙어 선 봇 대비)
function nearestFree(cx, cz) {
  if (!blocked[cz * N + cx]) return cz * N + cx;
  for (let r = 1; r <= 3; r++) {
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        const x = cx + dx;
        const z = cz + dz;
        if (x < 0 || z < 0 || x >= N || z >= N) continue;
        if (!blocked[z * N + x]) return z * N + x;
      }
    }
  }
  return -1;
}

// 두 점 사이를 몸이 지나갈 수 있는가 (경로 단순화용)
export function walkable(ax, az, bx, bz) {
  const d = Math.hypot(bx - ax, bz - az);
  const steps = Math.ceil(d / 0.4);
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    if (!isFree(ax + (bx - ax) * t, az + (bz - az) * t, CLEAR - 0.1)) return false;
  }
  return true;
}

const g = new Float32Array(N * N);
const f = new Float32Array(N * N);
const from = new Int32Array(N * N);
const state = new Uint8Array(N * N); // 0 미방문, 1 열림, 2 닫힘
const heap = new Int32Array(N * N * 4);
const DIRS = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, SQRT2], [1, -1, SQRT2], [-1, 1, SQRT2], [-1, -1, SQRT2]];

// 출발점에서 도착점까지의 경유점 [[x,z], ...] (도착점 포함). 길이 없으면 null.
export function findPath(sx, sz, tx, tz) {
  const start = nearestFree(cellOf(sx), cellOf(sz));
  const goal = nearestFree(cellOf(tx), cellOf(tz));
  if (start < 0 || goal < 0) return null;
  const gx = goal % N;
  const gz = (goal / N) | 0;
  state.fill(0);
  let size = 0;
  const push = (c) => {
    let i = size++;
    heap[i] = c;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (f[heap[p]] <= f[heap[i]]) break;
      [heap[p], heap[i]] = [heap[i], heap[p]];
      i = p;
    }
  };
  const pop = () => {
    const top = heap[0];
    heap[0] = heap[--size];
    let i = 0;
    for (;;) {
      const l = i * 2 + 1;
      const r = l + 1;
      let m = i;
      if (l < size && f[heap[l]] < f[heap[m]]) m = l;
      if (r < size && f[heap[r]] < f[heap[m]]) m = r;
      if (m === i) break;
      [heap[m], heap[i]] = [heap[i], heap[m]];
      i = m;
    }
    return top;
  };

  g[start] = 0;
  f[start] = 0;
  from[start] = -1;
  state[start] = 1;
  push(start);
  let found = false;
  while (size > 0) {
    const c = pop();
    if (state[c] === 2) continue;
    state[c] = 2;
    if (c === goal) {
      found = true;
      break;
    }
    const cx = c % N;
    const cz = (c / N) | 0;
    for (const [dx, dz, cost] of DIRS) {
      const x = cx + dx;
      const z = cz + dz;
      if (x < 0 || z < 0 || x >= N || z >= N) continue;
      const n = z * N + x;
      if (blocked[n] || state[n] === 2) continue;
      // 대각선은 양옆이 모두 비어 있을 때만 (모서리 끼임 방지)
      if (dx && dz && (blocked[cz * N + x] || blocked[z * N + cx])) continue;
      const ng = g[c] + cost;
      if (state[n] === 1 && ng >= g[n]) continue;
      g[n] = ng;
      f[n] = ng + Math.hypot(gx - x, gz - z);
      from[n] = c;
      state[n] = 1;
      push(n);
    }
  }
  if (!found) return null;

  const cells = [];
  for (let c = goal; c !== -1; c = from[c]) cells.push([center(c % N), center((c / N) | 0)]);
  cells.reverse();
  // 경로 단순화: 곧장 갈 수 있는 중간 지점은 건너뛴다
  const out = [];
  let ax = sx;
  let az = sz;
  let i = 0;
  while (i < cells.length) {
    let j = cells.length - 1;
    while (j > i && !walkable(ax, az, cells[j][0], cells[j][1])) j--;
    out.push(cells[j]);
    [ax, az] = cells[j];
    i = j + 1;
  }
  return out;
}
