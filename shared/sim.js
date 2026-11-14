// 플레이어 이동 시뮬레이션. 서버(권위)와 클라이언트(예측)가 같은 코드를 실행한다.
import { CFG } from './config.js';
import { MAP_SIZE } from './map.js';
import { wrapAngle } from './vision.js';

// p: {x,z,yaw}, input: {mx,mz,yaw}  (mx: 오른쪽, mz: 전방, yaw: 목표 방향)
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
  const step = CFG.PLAYER_SPEED * dt;
  // 전방 (s,c), 오른쪽 (-c,s)
  p.x += (s * mz - c * mx) * step;
  p.z += (c * mz + s * mx) * step;

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
