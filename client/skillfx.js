// 스킬 효과: 바닥 고리, 반짝이, 연기, 바람 줄기, 끌려오는 보석.
// 화려함보다 "무슨 스킬을 썼는지 한눈에" 가 목표. 전부 미리 만든 메시 몇 개(인스턴스)로 그려 모바일에서도 가볍다.
import * as THREE from 'three';

const N_SPARK = 320;
const N_SMOKE = 60;
const N_STREAK = 48;
const N_GEM = 96;
const N_RING = 12;
const ease = (t) => 1 - (1 - t) * (1 - t);

// 빛나는 것(가산 혼합)은 색을 검게 줄여 사라지게 한다 → 투명도 없이 인스턴스 하나로 페이드
function pool(n, geo, mat) {
  const mesh = new THREE.InstancedMesh(geo, mat, n);
  mesh.frustumCulled = false;
  mesh.count = 0;
  mesh.setColorAt(0, new THREE.Color());
  return mesh;
}

export class SkillFx {
  constructor(scene) {
    const add = { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending };
    this.sparkMesh = pool(N_SPARK, new THREE.OctahedronGeometry(0.11, 0), new THREE.MeshBasicMaterial({ ...add }));
    this.smokeMesh = pool(N_SMOKE, new THREE.IcosahedronGeometry(0.32, 1), new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, depthWrite: false }));
    this.streakMesh = pool(N_STREAK, new THREE.PlaneGeometry(0.06, 1).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ ...add, side: THREE.DoubleSide }));
    this.gemMesh = pool(N_GEM, new THREE.OctahedronGeometry(0.17, 0).scale(1, 1.45, 1), new THREE.MeshBasicMaterial({ ...add }));
    // 날아가는 보석 둘레의 은은한 빛 (맵 위 반딧불과 같은 느낌)
    this.gemGlow = pool(N_GEM, new THREE.SphereGeometry(0.4, 10, 8), new THREE.MeshBasicMaterial({ ...add }));
    scene.add(this.sparkMesh, this.smokeMesh, this.streakMesh, this.gemMesh, this.gemGlow);
    this.sparksP = [];
    this.smokesP = [];
    this.streaksP = [];
    this.gemsP = [];
    // 바닥 고리: 고리마다 메시 하나 (투명도를 따로 줘야 해서)
    this.ringGeo = new THREE.RingGeometry(0.9, 1, 64).rotateX(-Math.PI / 2);
    this.rings = Array.from({ length: N_RING }, () => {
      const m = new THREE.Mesh(this.ringGeo, new THREE.MeshBasicMaterial({ ...add, opacity: 0 }));
      m.visible = false;
      m.frustumCulled = false;
      m.renderOrder = 2;
      scene.add(m);
      return { m, t: 1, dur: 1, r0: 0, r1: 1, a: 1, follow: null };
    });
    this.m4 = new THREE.Matrix4();
    this.q = new THREE.Quaternion();
    this.v = new THREE.Vector3();
    this.sc = new THREE.Vector3();
    this.col = new THREE.Color();
    this.up = new THREE.Vector3(0, 1, 0);
  }

  // 바닥에 퍼지거나(r0 < r1) 모여드는(r0 > r1) 고리. follow: {x, z} 를 따라다닌다
  // delay: 이만큼(초) 뒤에 시작
  ring(x, z, { r0 = 0.3, r1 = 5, dur = 0.7, color = 0xffffff, a = 0.8, width = 0.1, follow = null, delay = 0 } = {}) {
    const r = this.rings.find((q) => q.t >= 1) || this.rings[0];
    Object.assign(r, { x, z, t: -delay / dur, dur, r0, r1, a, follow, width });
    r.m.material.color.set(color);
    r.m.visible = true;
  }
  // 반짝이: 위로 떠오르거나 사방으로 튄다
  sparks(x, z, { n = 10, color = 0xffffff, spread = 0.6, y = 0.4, rise = 1.4, out = 0.4, dur = 0.9, size = 1 } = {}) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * spread;
      this.push(this.sparksP, N_SPARK, {
        x: x + Math.sin(a) * r, y: y + Math.random() * 0.8, z: z + Math.cos(a) * r,
        vx: Math.sin(a) * out * Math.random(), vy: rise * (0.6 + Math.random() * 0.6), vz: Math.cos(a) * out * Math.random(),
        t: -Math.random() * 0.15, dur: dur * (0.7 + Math.random() * 0.5), s: size * (0.7 + Math.random() * 0.6), c: color,
      });
    }
  }
  // 연기: 몽글몽글 커지며 옅어진다
  smoke(x, z, { n = 12, color = 0xb4aad0, spread = 0.9, dur = 0.9 } = {}) {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + Math.random();
      const r = spread * (0.3 + Math.random() * 0.7);
      this.push(this.smokesP, N_SMOKE, {
        x: x + Math.sin(a) * r * 0.7, y: 0.3 + Math.random() * 1.2, z: z + Math.cos(a) * r * 0.7,
        vx: Math.sin(a) * r * 1.4, vy: 0.3 + Math.random() * 0.4, vz: Math.cos(a) * r * 1.4,
        t: -Math.random() * 0.06, dur: dur * (0.8 + Math.random() * 0.4), s: 1.3 + Math.random() * 0.8, c: color,
      });
    }
  }
  // 질주: 몸 옆으로 지나가는 가는 바람 줄기 (움직이는 방향의 반대쪽으로 흘러간다)
  streak(x, z, yaw) {
    const side = (Math.random() - 0.5) * 1.1;
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    this.push(this.streaksP, N_STREAK, {
      x: x - c * side, y: 0.35 + Math.random() * 1.2, z: z + s * side, yaw,
      vx: -s * 6, vy: 0, vz: -c * 6, t: 0, dur: 0.28, s: 0.7 + Math.random() * 0.6, c: 0xfff2c0,
    });
  }
  // 보석이 대상에게 끌려온다. to: {x, z} (움직이면 따라간다)
  //   mode 'spiral': 끌어오기 스킬 — 대상 둘레를 돌며 반지름이 줄어드는 소용돌이, 갈수록 빨라지고 꼬리가 남는다
  //   mode 'snap':   평소에 주울 때 — 자석에 붙듯 가속하며 곧장 날아와 쏙
  gem(x, z, color, to, delay = 0, { mode = 'spiral', dur = 0, y0 = 0.9, s = 1, trail = mode === 'spiral' } = {}) {
    const r0 = Math.hypot(x - to.x, z - to.z);
    const d = dur || (mode === 'spiral' ? 0.38 + r0 * 0.045 + Math.random() * 0.1 : 0.16 + r0 * 0.05);
    this.push(this.gemsP, N_GEM, {
      x0: x, z0: z, y0, to, t: -delay, dur: d, c: color, s, mode, trail,
      r0, a0: Math.atan2(x - to.x, z - to.z), spin: Math.random() * 6, side: Math.random() < 0.5 ? -1 : 1,
    });
  }

  push(list, max, p) {
    if (list.length >= max) list.shift();
    list.push(p);
  }

  update(dt) {
    const { m4, q, v, sc, col } = this;
    // 고리
    for (const r of this.rings) {
      if (r.t >= 1) continue;
      r.t = Math.min(1, r.t + dt / r.dur);
      if (r.t < 0) {
        r.m.visible = false;
        continue;
      }
      const k = ease(r.t);
      const rad = r.r0 + (r.r1 - r.r0) * k;
      const fx = r.follow ? r.follow.x : r.x;
      const fz = r.follow ? r.follow.z : r.z;
      r.m.position.set(fx, 0.08, fz);
      r.m.scale.set(rad, 1, rad);
      r.m.material.opacity = r.a * (r.r0 > r.r1 ? Math.sin(r.t * Math.PI) : 1 - r.t) ;
      r.m.visible = r.t < 1;
    }
    // 반짝이
    this.sparksP = this.sparksP.filter((p) => (p.t += dt) < p.dur);
    this.sparkMesh.count = this.sparksP.length;
    this.sparksP.forEach((p, i) => {
      const t = Math.max(0, p.t);
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      p.vy *= 1 - dt * 1.2;
      const life = t / p.dur;
      const s = p.s * (p.t < 0 ? 0 : Math.sin(Math.min(1, life * 1.4) * Math.PI * 0.5 + 0.0001)) * (1 - life * 0.5);
      q.setFromAxisAngle(this.up, p.t * 5 + i);
      m4.compose(v.set(p.x, p.y, p.z), q, sc.setScalar(Math.max(0.001, s)));
      this.sparkMesh.setMatrixAt(i, m4);
      this.sparkMesh.setColorAt(i, col.set(p.c).multiplyScalar(p.t < 0 ? 0 : 1 - life * life));
    });
    // 연기 (부드럽게 커지다가 작아지며 사라진다)
    this.smokesP = this.smokesP.filter((p) => (p.t += dt) < p.dur);
    this.smokeMesh.count = this.smokesP.length;
    this.smokesP.forEach((p, i) => {
      const t = Math.max(0, p.t);
      const life = t / p.dur;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      p.vx *= 1 - dt * 3;
      p.vz *= 1 - dt * 3;
      const s = p.t < 0 ? 0.001 : p.s * (0.6 + life * 0.9) * (1 - life * life * life);
      m4.compose(v.set(p.x, p.y, p.z), q.identity(), sc.setScalar(Math.max(0.001, s)));
      this.smokeMesh.setMatrixAt(i, m4);
      this.smokeMesh.setColorAt(i, col.set(p.c));
    });
    // 바람 줄기
    this.streaksP = this.streaksP.filter((p) => (p.t += dt) < p.dur);
    this.streakMesh.count = this.streaksP.length;
    this.streaksP.forEach((p, i) => {
      const life = p.t / p.dur;
      p.x += p.vx * dt;
      p.z += p.vz * dt;
      q.setFromAxisAngle(this.up, p.yaw);
      m4.compose(v.set(p.x, p.y, p.z), q, sc.set(1, 1, p.s * (0.4 + life)));
      this.streakMesh.setMatrixAt(i, m4);
      this.streakMesh.setColorAt(i, col.set(p.c).multiplyScalar(0.55 * Math.sin(life * Math.PI)));
    });
    // 끌려오는 보석: 옆으로 휘며 위로 살짝 떴다가 대상에게 쏙
    const arrived = [];
    this.gemsP = this.gemsP.filter((p) => {
      p.t += dt;
      if (p.t < p.dur) return true;
      arrived.push(p);
      return false;
    });
    this.gemMesh.count = this.gemGlow.count = this.gemsP.length;
    const trails = [];
    this.gemsP.forEach((p, i) => {
      const k = Math.max(0, p.t) / p.dur;
      const tx = p.to.x;
      const tz = p.to.z;
      let x;
      let y;
      let z;
      if (p.mode === 'spiral') {
        // 소용돌이: 처음엔 천천히 돌다가 가까워질수록 빨라지며 빨려 들어간다
        const e = Math.pow(k, 1.7);
        const r = p.r0 * (1 - e);
        const a = p.a0 + p.side * e * 2.4;
        x = tx + Math.sin(a) * r;
        z = tz + Math.cos(a) * r;
        y = p.y0 + Math.sin(k * Math.PI) * 0.8 + (1.05 - p.y0) * e;
      } else {
        // 자석: 가속하며 곧장, 살짝 떠올랐다가 가슴 높이로
        const e = k * k;
        x = p.x0 + (tx - p.x0) * e;
        z = p.z0 + (tz - p.z0) * e;
        y = p.y0 + (1.0 - p.y0) * e + Math.sin(k * Math.PI) * 0.2;
      }
      if (p.t >= 0 && p.trail && (p.tick = !p.tick)) trails.push([x, y, z, p.c]);
      q.setFromAxisAngle(this.up, p.spin + k * 14);
      m4.compose(v.set(x, y, z), q, sc.setScalar(p.t < 0 ? 0.001 : p.s * (1 - k * 0.55)));
      this.gemMesh.setMatrixAt(i, m4);
      this.gemMesh.setColorAt(i, col.set(p.c));
      const g = p.t < 0 ? 0.001 : p.s * (0.9 - k * 0.4);
      this.gemGlow.setMatrixAt(i, m4.makeScale(g, g, g).setPosition(x, y, z));
      this.gemGlow.setColorAt(i, col.set(p.c).multiplyScalar(0.4));
    });
    // 꼬리: 지나간 자리에 잠깐 남는 작은 빛
    for (const [x, y, z, c] of trails) {
      this.push(this.sparksP, N_SPARK, { x, y, z, vx: 0, vy: 0.2, vz: 0, t: 0, dur: 0.3, s: 0.55, c });
    }
    for (const p of arrived) {
      if (p.mode === 'spiral') this.sparks(p.to.x, p.to.z, { n: 3, color: p.c, spread: 0.3, y: 0.9, rise: 0.8, out: 1.2, dur: 0.4, size: 0.8 });
      else this.sparks(p.to.x, p.to.z, { n: 2, color: p.c, spread: 0.2, y: 0.95, rise: 0.6, out: 0.8, dur: 0.3, size: 0.6 });
    }
    for (const m of [this.sparkMesh, this.smokeMesh, this.streakMesh, this.gemMesh, this.gemGlow]) {
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
  }
}
