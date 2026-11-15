// 플레이어 이동 시뮬레이션. 서버(권위)와 클라이언트(예측)가 같은 코드를 실행한다.
import { CFG, ITEMS } from './config.js';
import { MAP_SIZE } from './map.js';
import { rayAabb, wrapAngle } from './vision.js';

// p: {x,z,yaw,rollT,rollCd,rollDx,rollDz}
// input: {mx,mz,yaw,roll}  (mx: 오른쪽, mz: 전방, yaw: 목표 방향)
export function stepPlayer(p, input, dt, walls) {
  const maxTurn = CFG.TURN_RATE * dt;
  const dy = wrapAngle(input.yaw - p.yaw);
  p.yaw = wrapAngle(p.yaw + Math.max(-maxTurn, Math.min(maxTurn, dy)));

  let mx = input.mx;
  let mz = input.mz;
  const len = Math.hypot(mx, mz);
  if (len > 1) {
    mx /= len;
    mz /= len;
  }
  const s = Math.sin(p.yaw);
  const c = Math.cos(p.yaw);
  // 전방 (s,c), 오른쪽 (-c,s)
  let vx = s * mz - c * mx;
  let vz = c * mz + s * mx;

  p.rollCd = Math.max(0, (p.rollCd || 0) - dt);
  if (input.roll && p.rollCd <= 0 && !(p.rollT > 0)) {
    // 이동 중이면 이동 방향으로, 아니면 바라보는 방향으로 구른다
    const vl = Math.hypot(vx, vz);
    p.rollDx = vl > 0.2 ? vx / vl : s;
    p.rollDz = vl > 0.2 ? vz / vl : c;
    p.rollT = CFG.ROLL_TIME;
    p.rollCd = p.rollCdMax || CFG.ROLL_COOLDOWN; // 강화로 짧아질 수 있다
  }

  let step = CFG.PLAYER_SPEED * (p.spd || 1) * dt; // spd: 이동 속도 강화 배율
  if (p.speedT > 0) {
    step *= ITEMS.sneakers.speed; // 운동화
    p.speedT = Math.max(0, p.speedT - dt);
  }
  if (p.rollT > 0) {
    vx = p.rollDx;
    vz = p.rollDz;
    step = CFG.ROLL_SPEED * dt;
    p.rollT = Math.max(0, p.rollT - dt);
  }
  p.x += vx * step;
  p.z += vz * step;

  const r = CFG.PLAYER_RADIUS;
  for (let iter = 0; iter < 2; iter++) {
    for (const w of walls) {
      const qx = Math.max(w.minX, Math.min(p.x, w.maxX));
      const qz = Math.max(w.minZ, Math.min(p.z, w.maxZ));
      const ox = p.x - qx;
      const oz = p.z - qz;
      const d2 = ox * ox + oz * oz;
      if (d2 >= r * r) continue;
      if (d2 > 1e-10) {
        const d = Math.sqrt(d2);
        p.x = qx + (ox / d) * r;
        p.z = qz + (oz / d) * r;
      } else {
        // 중심이 벽 안: 가장 가까운 면으로 밀어낸다
        const l = p.x - w.minX;
        const rr = w.maxX - p.x;
        const b = p.z - w.minZ;
        const t = w.maxZ - p.z;
        const m = Math.min(l, rr, b, t);
        if (m === l) p.x = w.minX - r;
        else if (m === rr) p.x = w.maxX + r;
        else if (m === b) p.z = w.minZ - r;
        else p.z = w.maxZ + r;
      }
    }
  }
  const lim = MAP_SIZE / 2 - r;
  p.x = Math.max(-lim, Math.min(lim, p.x));
  p.z = Math.max(-lim, Math.min(lim, p.z));
}

// 조명탄 착지점: 전방으로 던지되 벽 앞에서 멈춘다.
export function flareLanding(p, walls) {
  const dx = Math.sin(p.yaw);
  const dz = Math.cos(p.yaw);
  let t = CFG.FLARE_THROW;
  for (const w of walls) t = Math.min(t, rayAabb(p.x, p.z, dx, dz, w, t));
  t = Math.max(0, t - 0.4);
  return [p.x + dx * t, p.z + dz * t];
}
