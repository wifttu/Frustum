// 시야(프러스텀) 수학. 서버의 관심 영역 판정과 클라이언트의 시야 마스크가 이 파일을 공유한다.
//
// 맵이 평지 + 수직 벽이므로 캐릭터 눈의 절두체는 위/아래 평면이 아무것도 자르지 않는다.
// 따라서 좌/우 평면(FOV), far 평면(VIEW_RANGE), 벽에 의한 가림만 XZ 평면에서 판정한다.
// 방향 규약: yaw 의 전방 벡터는 (sin yaw, cos yaw).

const TAU = Math.PI * 2;

export function wrapAngle(a) {
  a = (a + Math.PI) % TAU;
  if (a < 0) a += TAU;
  return a - Math.PI;
}

// 정규화된 광선과 AABB의 교차 거리. 안 맞으면 Infinity.
export function rayAabb(ox, oz, dx, dz, w, maxT) {
  let t0 = 0;
  let t1 = maxT;
  if (Math.abs(dx) < 1e-9) {
    if (ox < w.minX || ox > w.maxX) return Infinity;
  } else {
    let a = (w.minX - ox) / dx;
    let b = (w.maxX - ox) / dx;
    if (a > b) [a, b] = [b, a];
    if (a > t0) t0 = a;
    if (b < t1) t1 = b;
    if (t0 > t1) return Infinity;
  }
  if (Math.abs(dz) < 1e-9) {
    if (oz < w.minZ || oz > w.maxZ) return Infinity;
  } else {
    let a = (w.minZ - oz) / dz;
    let b = (w.maxZ - oz) / dz;
    if (a > b) [a, b] = [b, a];
    if (a > t0) t0 = a;
    if (b < t1) t1 = b;
    if (t0 > t1) return Infinity;
  }
  return t0;
}

export function segmentBlocked(ax, az, bx, bz, walls) {
  const dx = bx - ax;
  const dz = bz - az;
  const len = Math.hypot(dx, dz);
  if (len < 1e-6) return false;
  const nx = dx / len;
  const nz = dz / len;
  const loX = Math.min(ax, bx);
  const hiX = Math.max(ax, bx);
  const loZ = Math.min(az, bz);
  const hiZ = Math.max(az, bz);
  for (const w of walls) {
    if (w.maxX < loX || w.minX > hiX || w.maxZ < loZ || w.minZ > hiZ) continue;
    if (rayAabb(ax, az, nx, nz, w, len) < len) return true;
  }
  return false;
}

// viewer {x,z,yaw} 가 반지름 tr 인 원(tx,tz)을 볼 수 있는가.
// margin 은 시야 영역만 넓힌다(가림 판정에는 쓰지 않음).
export function canSee(viewer, tx, tz, tr, walls, cfg, margin = 0) {
  const dx = tx - viewer.x;
  const dz = tz - viewer.z;
  const d = Math.hypot(dx, dz);
  const r = tr + margin;
  if (d > cfg.VIEW_RANGE + r) return false;
  if (d > cfg.NEAR_RADIUS + r) {
    const diff = Math.abs(wrapAngle(Math.atan2(dx, dz) - viewer.yaw));
    if (diff > cfg.FOV / 2 + Math.asin(Math.min(1, r / d))) return false;
  }
  if (d < 1e-6) return true;
  // 몸의 중심과 양쪽 가장자리 중 하나라도 보이면 보이는 것으로 본다.
  const px = (-dz / d) * tr;
  const pz = (dx / d) * tr;
  return (
    !segmentBlocked(viewer.x, viewer.z, tx, tz, walls) ||
    !segmentBlocked(viewer.x, viewer.z, tx + px, tz + pz, walls) ||
    !segmentBlocked(viewer.x, viewer.z, tx - px, tz - pz, walls)
  );
}

const UNIFORM_RAYS = 48;
const CORNER_EPS = 0.0015;
const PENETRATION = 0.5; // 광선이 벽 속으로 조금 들어가 벽의 앞면/윗면 가장자리가 밝아지게 한다
export const MAX_FAN_POINTS = 640;

const angles = new Float64Array(MAX_FAN_POINTS);
const near = [];

// 벽에 가려진 시야 다각형(부채꼴)을 계산한다.
// out.pts(Float32Array, x/z 쌍)에 외곽 점을 각도 순으로 채우고 점 개수를 반환한다.
// seen(Uint8Array)에는 광선이 닿은 벽을 1로 표시한다(호출자가 초기화; 여러 시야원의 합집합용).
export function computeVisionFan(x, z, yaw, walls, cfg, pts, seen) {
  const half = cfg.FOV / 2;
  const range = cfg.VIEW_RANGE;
  let n = 0;
  for (let i = 0; i <= UNIFORM_RAYS; i++) angles[n++] = -half + (cfg.FOV * i) / UNIFORM_RAYS;

  near.length = 0;
  for (let i = 0; i < walls.length; i++) {
    const w = walls[i];
    const ddx = Math.max(w.minX - x, 0, x - w.maxX);
    const ddz = Math.max(w.minZ - z, 0, z - w.maxZ);
    const dist = Math.hypot(ddx, ddz);
    if (dist > range) continue;
    near.push(i);
    if (dist < cfg.NEAR_RADIUS) seen[i] = 1;
    // 벽 모서리 양옆으로 광선을 쏴야 그림자 경계가 정확해진다.
    for (let c = 0; c < 4 && n + 3 <= MAX_FAN_POINTS; c++) {
      const cx = c & 1 ? w.maxX : w.minX;
      const cz = c & 2 ? w.maxZ : w.minZ;
      const rel = wrapAngle(Math.atan2(cx - x, cz - z) - yaw);
      if (rel <= -half || rel >= half) continue;
      angles[n++] = Math.max(-half, rel - CORNER_EPS);
      angles[n++] = rel;
      angles[n++] = Math.min(half, rel + CORNER_EPS);
    }
  }
  angles.subarray(0, n).sort();

  for (let i = 0; i < n; i++) {
    const a = yaw + angles[i];
    const dx = Math.sin(a);
    const dz = Math.cos(a);
    let t = range;
    let hit = -1;
    for (let k = 0; k < near.length; k++) {
      const tt = rayAabb(x, z, dx, dz, walls[near[k]], t);
      if (tt < t) {
        t = tt;
        hit = near[k];
      }
    }
    if (hit >= 0) {
      seen[hit] = 1;
      t = Math.min(range, t + PENETRATION);
    }
    pts[i * 2] = x + dx * t;
    pts[i * 2 + 1] = z + dz * t;
  }
  return n;
}
