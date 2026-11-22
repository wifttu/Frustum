// 캐릭터 선택 화면: 캐릭터들이 3D 로 줄지어 서 있고, 고른 캐릭터가 가운데에서 크게 보인다.
// 게임과 같은 렌더러(WebGL 컨텍스트 하나)를 쓰고, 열려 있는 동안에는 게임 대신 이 장면을 그린다.
import * as THREE from 'three';
import { CFG } from './shared/config.js';
import { CHARACTERS, CHARACTER_KEYS, statsOf } from './shared/progress.js';

const GAP = 2.0; // 캐릭터 사이 간격
const lerp = (a, b, t) => a + (b - a) * t;
const SHAKE = 0.95; // 뽑을 때 병이 흔들리는 시간 (초)

// 가운데가 밝고 가장자리로 갈수록 투명한 동그라미 (빛 번짐용)
function glowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  r.addColorStop(0, 'rgba(255,255,255,1)');
  r.addColorStop(0.35, 'rgba(255,255,255,.5)');
  r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// 뽑기 장면: 그루터기 위에 반딧불이 가득 든 유리병 ("반딧불 뽑기"). 뽑으면 병이 흔들리다 빛이 터진다.
function buildJar() {
  const root = new THREE.Group();
  const lambert = (color) => new THREE.MeshLambertMaterial({ color });
  // 나무 그루터기와 나이테
  const stump = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.18, 0.7, 20), lambert(0x7a4f2c));
  stump.position.y = 0.35;
  const top = new THREE.Mesh(new THREE.CylinderGeometry(0.99, 0.99, 0.04, 20), lambert(0xd9b07a));
  top.position.y = 0.71;
  root.add(stump, top);
  for (const r of [0.32, 0.6, 0.84]) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(r, 0.022, 5, 28), lambert(0xa8743f));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.735;
    root.add(ring);
  }
  // 흔들리는 병 (아래쪽 가운데를 축으로)
  const jar = new THREE.Group();
  jar.position.y = 0.74;
  root.add(jar);
  const profile = [[0, 0], [0.64, 0], [0.72, 0.08], [0.74, 1.25], [0.62, 1.47], [0.46, 1.57], [0.46, 1.74]].map(([x, y]) => new THREE.Vector2(x, y));
  const glass = new THREE.Mesh(
    new THREE.LatheGeometry(profile, 36),
    new THREE.MeshStandardMaterial({ color: 0xd8f4ff, transparent: true, opacity: 0.24, roughness: 0.08, metalness: 0.1, side: THREE.DoubleSide, depthWrite: false }),
  );
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.47, 0.04, 8, 32), new THREE.MeshStandardMaterial({ color: 0xeaf8ff, transparent: true, opacity: 0.6 }));
  rim.rotation.x = Math.PI / 2;
  rim.position.y = 1.74;
  const cork = new THREE.Mesh(new THREE.CylinderGeometry(0.43, 0.39, 0.3, 18), lambert(0xc8925a));
  cork.position.y = 1.86;
  const twine = new THREE.Mesh(new THREE.TorusGeometry(0.485, 0.035, 6, 28), lambert(0xe8d2a0));
  twine.rotation.x = Math.PI / 2;
  twine.position.y = 1.64;
  // 끈에 매단 작은 별 꼬리표
  const tag = new THREE.Mesh(new THREE.OctahedronGeometry(0.14, 0), new THREE.MeshStandardMaterial({ color: 0xffd25a, emissive: 0x8a5a00, roughness: 0.4 }));
  tag.position.set(0.5, 1.42, 0.22);
  tag.scale.set(1, 1.3, 0.5);
  jar.add(glass, rim, cork, twine, tag);
  // 병 속 빛: 은은한 빛 덩어리 + 반딧불들 + 주변을 비추는 불빛
  const tex = glowTexture();
  const glowMat = new THREE.SpriteMaterial({ map: tex, color: 0xfff0a0, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false });
  const glow = new THREE.Sprite(glowMat);
  glow.position.y = 0.75;
  glow.scale.setScalar(2.2);
  jar.add(glow);
  const flies = [];
  for (let i = 0; i < 18; i++) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color: i % 4 ? 0xeaff7a : 0xfff3b0, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    s.scale.setScalar(0.2 + (i % 3) * 0.05);
    jar.add(s);
    flies.push({ s, a: (i / 18) * Math.PI * 2, r: 0.18 + ((i * 37) % 10) * 0.045, h: 0.2 + ((i * 53) % 10) * 0.11, sp: 0.6 + (i % 5) * 0.2, ph: i * 1.7 });
  }
  const light = new THREE.PointLight(0xffe27a, 2.4, 7, 1.6);
  light.position.y = 0.8;
  jar.add(light);
  // 병 뒤의 큰 빛 번짐 (뽑을 때 크게 터진다)
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color: 0xffd27a, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false }));
  halo.position.set(0, 1.5, -0.4);
  halo.scale.setScalar(4.2);
  root.add(halo);
  root.visible = false;
  return { root, jar, glow, flies, light, halo };
}

export class Showcase {
  constructor(chars) {
    this.chars = chars;
    this.active = false;
    this.lobby = false; // 로비: 고른 캐릭터 하나만 가까이서 보여준다
    this.gacha = false; // 뽑기 탭: 캐릭터 대신 반딧불 병
    this.shake = 0; // 남은 흔들림 시간
    this.flash = 0; // 빛이 터지는 정도 (1 → 0)
    this.index = 0; // 고른 캐릭터
    this.pos = 0; // 화면이 따라가는 위치 (부드럽게 index 로 이동)
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);

    // 배경: 해 질 녘 캠핑장 하늘
    const c = document.createElement('canvas');
    c.width = 4;
    c.height = 256;
    const g = c.getContext('2d');
    const grad = g.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0, '#1b2a52');
    grad.addColorStop(0.45, '#6a4f86');
    grad.addColorStop(0.7, '#f0965a');
    grad.addColorStop(1, '#ffd58a');
    g.fillStyle = grad;
    g.fillRect(0, 0, 4, 256);
    const bg = new THREE.CanvasTexture(c);
    bg.colorSpace = THREE.SRGBColorSpace;
    this.scene.background = bg;

    this.scene.add(new THREE.HemisphereLight(0xfff2dc, 0x6a7a4a, 1.25));
    const key = new THREE.DirectionalLight(0xfff0d0, 1.5);
    key.position.set(2, 4, 5);
    this.scene.add(key);

    // 잔디 언덕과 뒤쪽 나무 실루엣
    const ground = new THREE.Mesh(
      new THREE.CylinderGeometry(30, 30, 0.4, 48).translate(0, -0.2, 0),
      new THREE.MeshLambertMaterial({ color: 0x79b24e }),
    );
    this.scene.add(ground);
    const treeMat = new THREE.MeshLambertMaterial({ color: 0x2f5e3c });
    for (let i = -9; i <= 9; i++) {
      const h = 3 + ((i * 7 + 20) % 5) * 0.5;
      const t = new THREE.Mesh(new THREE.ConeGeometry(1.2, h, 7), treeMat);
      t.position.set(i * 2.1 + ((i * 13) % 3) * 0.3, h / 2, -6 - ((i * 5 + 20) % 4));
      this.scene.add(t);
    }

    this.jar = buildJar();
    this.scene.add(this.jar.root);

    this.items = CHARACTER_KEYS.map((id, i) => {
      const mesh = chars.make('self', id, true);
      mesh.position.set(i * GAP, 0, 0);
      mesh.userData.spawn = 1;
      this.scene.add(mesh);
      return { id, mesh, scale: 1, spin: 0 };
    });
    this.v = new THREE.Vector3();
  }

  open(id) {
    this.index = Math.max(0, CHARACTER_KEYS.indexOf(id));
    this.pos = this.index;
    this.active = true;
  }

  close() {
    this.active = false;
  }

  // 캐릭터마다 의상을 입혀 보여준다 (skinOf(캐릭터 ID) → 의상 ID)
  setSkins(skinOf) {
    for (const it of this.items) this.chars.setKind(it.mesh, 'self', it.id, skinOf(it.id));
  }

  get current() {
    return CHARACTER_KEYS[this.index];
  }

  move(d) {
    this.index = Math.max(0, Math.min(CHARACTER_KEYS.length - 1, this.index + d));
  }

  // 드래그: 손가락을 따라 줄이 움직이고, 놓으면 튕긴 속도만큼 여러 명을 지나 가장 가까운 캐릭터에 멈춘다
  // 화면에서 캐릭터 한 칸(GAP)이 몇 픽셀인지 (카메라 거리·시야각·화면비로 계산)
  pxPerItem(w, h) {
    const dist = 10.2;
    const visibleW = 2 * dist * Math.tan(((this.camera.fov / 2) * Math.PI) / 180) * (w / h);
    return (w / visibleW) * GAP;
  }
  dragTo(pos) {
    const last = CHARACTER_KEYS.length - 1;
    // 양 끝을 넘으면 고무줄처럼 조금만 따라간다
    this.pos = pos < 0 ? pos * 0.35 : pos > last ? last + (pos - last) * 0.35 : pos;
    this.index = Math.max(0, Math.min(last, Math.round(this.pos)));
  }

  // 화면 좌표(픽셀)에서 각 캐릭터 머리 위 위치 → 자물쇠 표시용
  headPos(i, w, h) {
    const it = this.items[i];
    this.v.set(it.mesh.position.x, 2.75 * it.scale, it.mesh.position.z).project(this.camera);
    return [(this.v.x + 1) * 0.5 * w, (1 - this.v.y) * 0.5 * h];
  }

  // 뽑기: 병을 흔들다가 빛을 터뜨린다 (결과는 SHAKE 초 뒤에 보여 준다)
  burst() {
    this.shake = SHAKE;
  }

  renderJar(dt, t, w, h) {
    const J = this.jar;
    // 화면 왼쪽 가운데 (오른쪽에는 뽑기 창이 있다)
    const visibleW = 2 * 9 * Math.tan(((this.camera.fov / 2) * Math.PI) / 180) * (w / h);
    J.root.position.set(-visibleW * 0.2, 0, 1.2);
    J.root.scale.setScalar(1.08);
    let rot = Math.sin(t * 1.3) * 0.025;
    let fast = 1;
    if (this.shake > 0) {
      this.shake -= dt;
      const k = 1 - Math.max(0, this.shake) / SHAKE; // 점점 세게
      rot = Math.sin(t * 38) * (0.05 + 0.13 * k);
      fast = 1 + k * 4;
      J.jar.position.y = 0.74 + Math.abs(Math.sin(t * 19)) * 0.08 * k;
      if (this.shake <= 0) this.flash = 1;
    } else J.jar.position.y = lerp(J.jar.position.y, 0.74, Math.min(1, dt * 10));
    J.jar.rotation.z = rot;
    this.flash = Math.max(0, this.flash - dt * 1.6);
    const f = this.flash;
    const pulse = 0.5 + 0.5 * Math.sin(t * 2.2);
    J.light.intensity = 2.0 + pulse * 0.8 + f * 14;
    J.glow.scale.setScalar(2.1 + pulse * 0.25 + f * 3);
    J.glow.material.opacity = 0.55 + f * 0.45;
    J.halo.scale.setScalar(4 + pulse * 0.4 + f * 9);
    J.halo.material.opacity = 0.32 + f * 0.6;
    for (const q of J.flies) {
      q.a += dt * q.sp * fast;
      const r = q.r + Math.sin(t * 1.7 + q.ph) * 0.06;
      q.s.position.set(Math.cos(q.a) * r, q.h + Math.sin(t * 2.3 * fast + q.ph) * 0.12, Math.sin(q.a) * r);
      q.s.material.opacity = 0.55 + 0.45 * Math.sin(t * 3 + q.ph * 2);
    }
  }

  render(renderer, dt, t, w, h) {
    if (!this.dragging) this.pos = lerp(this.pos, this.index, Math.min(1, dt * 7));
    const cam = this.camera;
    cam.aspect = w / h;
    cam.updateProjectionMatrix();
    this.jar.root.visible = this.gacha && !this.lobby;
    if (this.jar.root.visible) {
      // 뽑기 탭: 캐릭터는 숨기고 병만
      cam.position.set(0, 1.9, 10.2);
      cam.lookAt(0, 1.95, 0);
      for (const it of this.items) it.mesh.visible = false;
      this.renderJar(dt, t, w, h);
      renderer.render(this.scene, cam);
      return;
    }
    if (this.lobby) {
      cam.position.set(this.pos * GAP, 1.9, 10.4);
      cam.lookAt(this.pos * GAP, 1.3, 0);
    } else {
      cam.position.set(this.pos * GAP, 1.9, 10.2);
      cam.lookAt(this.pos * GAP, 1.75, 0);
    }
    for (let i = 0; i < this.items.length; i++) {
      const it = this.items[i];
      const sel = i === this.index;
      it.mesh.visible = !this.empty && (sel || !this.lobby);
      it.scale = lerp(it.scale, sel ? 1.12 : 0.72, Math.min(1, dt * 10));
      it.mesh.scale.setScalar(it.scale);
      // 고른 캐릭터는 천천히 좌우로 몸을 돌리며 손전등을 든다
      it.spin = lerp(it.spin, sel ? Math.sin(t * 1.2) * 0.45 : -0.25, Math.min(1, dt * 6));
      it.mesh.rotation.y = it.spin;
      it.mesh.position.z = lerp(it.mesh.position.z, sel ? 0.8 : 0, Math.min(1, dt * 10));
      this.chars.animate(it.mesh, dt, t + i, { beam: false, roll: -1 });
      it.mesh.userData.speed = 0;
    }
    renderer.render(this.scene, cam);
  }
}

// 능력치 그래프용 값 (0..1): 체력, 속도, 공격, 사거리
export function radarOf(id) {
  const st = statsOf({}, CFG, id);
  const n = (v, lo, hi) => Math.max(0.18, Math.min(1, (v - lo) / (hi - lo)));
  return {
    hp: n(st.maxHp, 60, 150),
    speed: n(st.speed, 0.85, 1.12),
    power: n(st.damage, 28, 38),
    range: n(st.range, 4.5, 8),
    special: CHARACTERS[id].desc,
  };
}
