// 캐릭터 선택 화면: 캐릭터들이 3D 로 줄지어 서 있고, 고른 캐릭터가 가운데에서 크게 보인다.
// 게임과 같은 렌더러(WebGL 컨텍스트 하나)를 쓰고, 열려 있는 동안에는 게임 대신 이 장면을 그린다.
import * as THREE from 'three';
import { CFG } from './shared/config.js';
import { CHARACTERS, CHARACTER_KEYS, statsOf } from './shared/progress.js';

const GAP = 2.0; // 캐릭터 사이 간격
const lerp = (a, b, t) => a + (b - a) * t;

export class Showcase {
  constructor(chars) {
    this.chars = chars;
    this.active = false;
    this.lobby = false; // 로비: 고른 캐릭터 하나만 가까이서 보여준다
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

  // 고른 캐릭터에 스킨(의상)을 입혀 보여준다
  setSkin(skin = 'default') {
    for (const it of this.items) this.chars.setKind(it.mesh, 'self', it.id, it.id === this.current ? skin : 'default');
  }

  get current() {
    return CHARACTER_KEYS[this.index];
  }

  move(d) {
    this.index = Math.max(0, Math.min(CHARACTER_KEYS.length - 1, this.index + d));
  }

  // 화면 좌표(픽셀)에서 각 캐릭터 머리 위 위치 → 자물쇠 표시용
  headPos(i, w, h) {
    const it = this.items[i];
    this.v.set(it.mesh.position.x, 2.75 * it.scale, it.mesh.position.z).project(this.camera);
    return [(this.v.x + 1) * 0.5 * w, (1 - this.v.y) * 0.5 * h];
  }

  render(renderer, dt, t, w, h) {
    this.pos = lerp(this.pos, this.index, Math.min(1, dt * 9));
    const cam = this.camera;
    cam.aspect = w / h;
    cam.updateProjectionMatrix();
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
      it.mesh.visible = sel || !this.lobby;
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
