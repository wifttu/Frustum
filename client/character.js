// 캐릭터: 코드로 만든 저폴리 인형 + 절차적 애니메이션(걷기, 숨쉬기, 손전등 조준/발사, 구르기, 등장).
// 외부 모델 파일 없음. 캐릭터 하나는 드로우콜 7~8회 (몸통/팔2/다리2/발밑 링/그림자/빔).
import * as THREE from 'three';
import { CFG } from './shared/config.js';

const SUIT = [1, 1, 1]; // 머티리얼 색(팀 색)이 그대로 나오는 부분
const DARK = [0.2, 0.21, 0.24];
const MID = [0.5, 0.52, 0.56];
const GLOW = [3, 3, 3]; // 바이저, 손전등 렌즈: 밝게 빛나 보이게

// 여러 지오메트리를 정점 색과 함께 하나로 합친다 (드로우콜 절약)
function merge(parts) {
  const pos = [];
  const nor = [];
  const col = [];
  for (const [geo, c] of parts) {
    const g = geo.index ? geo.toNonIndexed() : geo;
    const p = g.attributes.position.array;
    const n = g.attributes.normal.array;
    for (let i = 0; i < p.length; i += 3) {
      pos.push(p[i], p[i + 1], p[i + 2]);
      nor.push(n[i], n[i + 1], n[i + 2]);
      col.push(c[0], c[1], c[2]);
    }
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return out;
}

const HIP_Y = 0.74;
const SHOULDER_Y = 1.26;
const PIVOT_Y = 0.8; // 구를 때 회전 중심
const BODY_SCALE = 1.3; // 위에서 내려다보는 카메라에서 잘 보이도록 몸만 키운다 (판정 크기는 그대로)

const torsoGeo = merge([
  [new THREE.CapsuleGeometry(0.25, 0.3, 4, 10).translate(0, 1.02, 0), SUIT],
  [new THREE.SphereGeometry(0.23, 12, 10).translate(0, 1.52, 0), SUIT],
  [new THREE.SphereGeometry(0.245, 12, 6, 0, Math.PI * 2, 0, Math.PI * 0.45).translate(0, 1.53, 0), DARK], // 헬멧
  [new THREE.BoxGeometry(0.33, 0.1, 0.14).translate(0, 1.53, 0.17), GLOW], // 바이저
  [new THREE.BoxGeometry(0.32, 0.36, 0.16).translate(0, 1.06, -0.27), DARK], // 배낭
  [new THREE.CylinderGeometry(0.265, 0.265, 0.08, 12).translate(0, 0.84, 0), DARK], // 벨트
]);
const legGeo = merge([
  [new THREE.CapsuleGeometry(0.105, 0.42, 3, 8).translate(0, -0.33, 0), MID],
  [new THREE.BoxGeometry(0.2, 0.11, 0.3).translate(0, -0.68, 0.05), DARK], // 신발
]);
const armParts = [
  [new THREE.CapsuleGeometry(0.085, 0.34, 3, 8).translate(0, -0.23, 0), SUIT],
  [new THREE.SphereGeometry(0.1, 8, 6).translate(0, -0.48, 0), DARK], // 장갑
];
const armLGeo = merge(armParts);
const armRGeo = merge([
  ...armParts,
  [new THREE.CylinderGeometry(0.06, 0.09, 0.34, 8).translate(0, -0.68, 0), DARK], // 손전등
  [new THREE.CylinderGeometry(0.085, 0.085, 0.03, 8).translate(0, -0.86, 0), GLOW], // 렌즈
]);
const ringGeo = new THREE.RingGeometry(0.5, 0.6, 28).rotateX(-Math.PI / 2).translate(0, 0.05, 0);
const shadowGeo = new THREE.CircleGeometry(0.44, 16).rotateX(-Math.PI / 2).translate(0, 0.03, 0);

// 손전등 빔: 판정 범위(ATTACK_RANGE, ATTACK_ARC)와 같은 모양의 부채꼴. 손에서 멀어질수록 흐려진다.
function makeBeamGeometry() {
  const seg = 16;
  const pos = [0.43, 1.5, 1.1];
  const col = [0.62, 0.58, 0.42];
  const idx = [];
  for (let i = 0; i <= seg; i++) {
    const a = -CFG.ATTACK_ARC / 2 + (CFG.ATTACK_ARC * i) / seg;
    pos.push(Math.sin(a) * CFG.ATTACK_RANGE, 0.5, Math.cos(a) * CFG.ATTACK_RANGE);
    col.push(0.05, 0.045, 0.025);
    if (i > 0) idx.push(0, i, i + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  return g;
}
const beamGeo = makeBeamGeometry();
// 조준 가이드: 빔 사거리 끝을 표시하는 얇은 호 (내 캐릭터만)
const aimGeo = new THREE.RingGeometry(
  CFG.ATTACK_RANGE - 0.07, CFG.ATTACK_RANGE, 20, 1, -Math.PI / 2 - CFG.ATTACK_ARC / 2, CFG.ATTACK_ARC,
).rotateX(-Math.PI / 2).translate(0, 0.06, 0);

const COLORS = { self: 0xe6eef6, ally: 0x3d9cf0, enemy: 0xf0503d };
const lerp = (a, b, t) => a + (b - a) * t;
const easeOutBack = (t) => 1 + 2.7 * Math.pow(t - 1, 3) + 1.7 * Math.pow(t - 1, 2);

export class Characters {
  constructor(mask) {
    this.body = {};
    this.ring = {};
    for (const [kind, color] of Object.entries(COLORS)) {
      this.body[kind] = mask.apply(new THREE.MeshLambertMaterial({ color, vertexColors: true }));
      this.ring[kind] = mask.apply(
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: kind === 'self' ? 0.45 : 0.8, depthWrite: false }),
      );
    }
    this.shadow = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35, depthWrite: false });
    this.beam = mask.apply(
      new THREE.MeshBasicMaterial({
        vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false,
      }),
    );
    this.aim = mask.apply(
      new THREE.MeshBasicMaterial({ color: 0xffe9a0, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false }),
    );
  }

  make(kind) {
    const root = new THREE.Group();
    const pose = new THREE.Group(); // 구르기/들썩임이 적용되는 그룹
    const inner = new THREE.Group();
    pose.position.y = PIVOT_Y;
    inner.position.y = -PIVOT_Y;
    pose.add(inner);

    const m = this.body[kind];
    const torso = new THREE.Mesh(torsoGeo, m);
    const legL = new THREE.Mesh(legGeo, m);
    const legR = new THREE.Mesh(legGeo, m);
    const armL = new THREE.Mesh(armLGeo, m);
    const armR = new THREE.Mesh(armRGeo, m);
    legL.position.set(0.13, HIP_Y, 0);
    legR.position.set(-0.13, HIP_Y, 0);
    armL.position.set(-0.33, SHOULDER_Y, 0);
    armR.position.set(0.33, SHOULDER_Y, 0);
    inner.add(torso, legL, legR, armL, armR);

    const ring = new THREE.Mesh(ringGeo, this.ring[kind]);
    const shadow = new THREE.Mesh(shadowGeo, this.shadow);
    const beam = new THREE.Mesh(beamGeo, this.beam);
    beam.visible = false;
    const body = new THREE.Group();
    body.add(pose);
    root.add(body, shadow, ring, beam);
    let aim = null;
    if (kind === 'self') {
      aim = new THREE.Mesh(aimGeo, this.aim);
      root.add(aim);
    }
    root.userData = {
      kind, body, pose, torso, legL, legR, armL, armR, ring, beam, aim,
      phase: Math.random() * 6, seed: Math.random() * 6, atk: 0, spawn: 0, speed: 0, lx: null, lz: 0,
    };
    // 그룹 단위로 컬링하므로 자식의 자동 컬링은 끈다
    root.traverse((o) => (o.frustumCulled = false));
    return root;
  }

  setKind(root, kind) {
    const u = root.userData;
    if (u.kind === kind) return;
    u.kind = kind;
    for (const part of [u.torso, u.legL, u.legR, u.armL, u.armR]) part.material = this.body[kind];
    u.ring.material = this.ring[kind];
  }

  // 등장 애니메이션을 처음부터 다시 (부활, 새 라운드)
  respawn(root) {
    root.userData.spawn = 0;
    root.userData.lx = null;
  }

  // s: { beam: 빔 발사 중, roll: 구르기 진행도 0..1 (아니면 -1), aimReady: 조준 가이드 표시 }
  animate(root, dt, t, s) {
    const u = root.userData;
    // 이동 속도는 위치 변화에서 추정한다 (원격 플레이어도 같은 코드)
    if (u.lx !== null && dt > 0) {
      const v = Math.hypot(root.position.x - u.lx, root.position.z - u.lz) / dt;
      u.speed = lerp(u.speed, Math.min(v, CFG.ROLL_SPEED), Math.min(1, dt * 12));
    }
    u.lx = root.position.x;
    u.lz = root.position.z;

    u.spawn = Math.min(1, u.spawn + dt * 4);
    u.body.scale.setScalar(Math.max(0.01, easeOutBack(u.spawn)) * BODY_SCALE);

    const rolling = s.roll >= 0;
    const amt = rolling ? 0 : Math.min(1, u.speed / CFG.PLAYER_SPEED);
    u.phase += dt * 11 * amt;
    const sw = Math.sin(u.phase) * 0.9 * amt;
    const breathe = Math.sin(t * 2.2 + u.seed) * (1 - amt);

    u.atk = lerp(u.atk, s.beam ? 1 : 0, Math.min(1, dt * (s.beam ? 30 : 7)));
    u.legL.rotation.x = sw;
    u.legR.rotation.x = -sw;
    u.armL.rotation.x = -sw * 0.8;
    u.armL.rotation.z = -0.12;
    // 오른팔은 손전등을 앞으로 겨누고, 발사 순간 쭉 뻗는다
    u.armR.rotation.x = -1.1 - 0.47 * u.atk + sw * 0.12 + breathe * 0.03;
    u.armR.position.z = 0.02 + 0.14 * u.atk;
    u.torso.rotation.x = 0.13 * amt - 0.1 * u.atk;
    u.torso.scale.y = 1 + breathe * 0.012;

    const pose = u.pose;
    if (rolling) {
      // 앞구르기: 몸을 말고 한 바퀴
      const tuck = Math.sin(s.roll * Math.PI);
      pose.rotation.x = s.roll * Math.PI * 2;
      pose.position.y = PIVOT_Y - 0.32 * tuck;
      pose.scale.setScalar(1 - 0.2 * tuck);
      u.legL.rotation.x = u.legR.rotation.x = -1.5 * tuck;
      u.armL.rotation.x = -1.2 * tuck;
    } else {
      pose.rotation.x = 0;
      pose.scale.setScalar(1);
      pose.position.y = PIVOT_Y + Math.abs(Math.cos(u.phase)) * 0.05 * amt + breathe * 0.012;
    }

    u.beam.visible = !!s.beam;
    if (u.aim) u.aim.visible = !!s.aimReady;
  }
}

// 처치 이펙트: 바닥 충격파 링 + 흩어지는 파편. 내가 보고 있던 플레이어(또는 나)가 쓰러질 때만 쓴다.
const BURST_N = 14;
export class DeathFx {
  constructor(scene) {
    this.scene = scene;
    this.pool = [];
    this.ringGeo = new THREE.RingGeometry(0.75, 1, 28).rotateX(-Math.PI / 2);
  }

  spawn(x, z, kind) {
    let fx = this.pool.find((f) => f.t >= 1);
    if (!fx) {
      const ring = new THREE.Mesh(
        this.ringGeo,
        new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
      );
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(BURST_N * 3), 3));
      const pts = new THREE.Points(
        geo,
        new THREE.PointsMaterial({ size: 0.22, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
      );
      ring.frustumCulled = pts.frustumCulled = false;
      this.scene.add(ring, pts);
      fx = { ring, pts, vel: new Float32Array(BURST_N * 3), t: 1 };
      this.pool.push(fx);
    }
    const color = COLORS[kind] ?? 0xffffff;
    fx.ring.material.color.set(color);
    fx.pts.material.color.set(color);
    fx.ring.position.set(x, 0.07, z);
    const p = fx.pts.geometry.attributes.position.array;
    for (let i = 0; i < BURST_N; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 2 + Math.random() * 4;
      p[i * 3] = x;
      p[i * 3 + 1] = 0.6 + Math.random() * 0.8;
      p[i * 3 + 2] = z;
      fx.vel[i * 3] = Math.cos(a) * sp;
      fx.vel[i * 3 + 1] = 2 + Math.random() * 4;
      fx.vel[i * 3 + 2] = Math.sin(a) * sp;
    }
    fx.t = 0;
    fx.ring.visible = fx.pts.visible = true;
  }

  update(dt) {
    for (const fx of this.pool) {
      if (fx.t >= 1) continue;
      fx.t = Math.min(1, fx.t + dt / 0.7);
      const fade = 1 - fx.t;
      fx.ring.scale.setScalar(0.4 + fx.t * 2.6);
      fx.ring.material.opacity = fade * 0.9;
      fx.pts.material.opacity = fade;
      const p = fx.pts.geometry.attributes.position.array;
      for (let i = 0; i < BURST_N; i++) {
        fx.vel[i * 3 + 1] -= 14 * dt;
        p[i * 3] += fx.vel[i * 3] * dt;
        p[i * 3 + 1] = Math.max(0.05, p[i * 3 + 1] + fx.vel[i * 3 + 1] * dt);
        p[i * 3 + 2] += fx.vel[i * 3 + 2] * dt;
      }
      fx.pts.geometry.attributes.position.needsUpdate = true;
      if (fx.t >= 1) fx.ring.visible = fx.pts.visible = false;
    }
  }
}
