// 판이 끝나면: 1~3등이 입은 의상 그대로 시상대에 올라 승리 포즈를 한다.
// 팀전(2인 팀전, 3 대 3)에서 이긴 팀이 있으면 등수 단 대신 넓은 우승 단 하나에 이긴 팀이 나란히 서서 함께 기뻐한다.
// 게임과 같은 렌더러(WebGL 컨텍스트 하나)를 쓰고, 보이는 동안에는 게임 장면 대신 이 장면을 그린다.
import * as THREE from 'three';

// 단: 가운데 1등(가장 높다), 왼쪽 2등, 오른쪽 3등
const SPOTS = [
  { x: 0, h: 0.95, top: 0xffd25a, side: 0xb8862a, n: '1' },
  { x: -1.8, h: 0.62, top: 0xe4ebf2, side: 0x8c98a6, n: '2' },
  { x: 1.8, h: 0.42, top: 0xf0a878, side: 0x9a5a34, n: '3' },
];
const ENTER = [0.75, 0.4, 0.1]; // 등장 순서: 3등 → 2등 → 1등 (초)
const TEAM_GAP = 1.4; // 우승 단 위 팀원 사이 간격
const TEAM_H = 0.95; // 우승 단 높이 (1등 단과 같다)
const CONFETTI = 90;
const lerp = (a, b, t) => a + (b - a) * t;

function numberTexture(n, color) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = color;
  g.fillRect(0, 0, 128, 128);
  g.fillStyle = 'rgba(255,255,255,.92)';
  g.font = '900 92px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.shadowColor = 'rgba(0,0,0,.35)';
  g.shadowBlur = 8;
  g.fillText(n, 64, 70);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class Podium {
  constructor(chars) {
    this.chars = chars;
    this.active = false;
    this.t = 0;
    this.slots = []; // { mesh, rank }
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
    this.v = new THREE.Vector3();

    // 밤하늘 (위는 남색, 아래는 모닥불빛이 번진 보라)
    const c = document.createElement('canvas');
    c.width = 4;
    c.height = 256;
    const g = c.getContext('2d');
    const grad = g.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0, '#0b1230');
    grad.addColorStop(0.55, '#2a2350');
    grad.addColorStop(0.85, '#6a3a52');
    grad.addColorStop(1, '#a8583a');
    g.fillStyle = grad;
    g.fillRect(0, 0, 4, 256);
    const bg = new THREE.CanvasTexture(c);
    bg.colorSpace = THREE.SRGBColorSpace;
    this.scene.background = bg;

    this.scene.add(new THREE.HemisphereLight(0xd8dcff, 0x3a2a40, 1.1));
    const key = new THREE.DirectionalLight(0xfff0d8, 1.6);
    key.position.set(2, 5, 6);
    this.scene.add(key);
    const warm = new THREE.PointLight(0xff9a4a, 8, 12, 1.6); // 앞쪽 모닥불빛
    warm.position.set(0, 1.2, 3.5);
    this.scene.add(warm);

    // 바닥, 뒤쪽 나무 실루엣, 별
    this.scene.add(new THREE.Mesh(new THREE.CylinderGeometry(26, 26, 0.4, 48).translate(0, -0.2, 0), new THREE.MeshLambertMaterial({ color: 0x3f5a3a })));
    const treeMat = new THREE.MeshLambertMaterial({ color: 0x1c2e2a });
    for (let i = -8; i <= 8; i++) {
      const h = 3 + ((i * 7 + 20) % 5) * 0.55;
      const t = new THREE.Mesh(new THREE.ConeGeometry(1.15, h, 7), treeMat);
      t.position.set(i * 1.9 + ((i * 13) % 3) * 0.3, h / 2, -5.5 - ((i * 5 + 20) % 4) * 0.8);
      this.scene.add(t);
    }
    const starPos = [];
    for (let i = 0; i < 140; i++) starPos.push((Math.random() - 0.5) * 60, 6 + Math.random() * 14, -18 - Math.random() * 6);
    const stars = new THREE.Points(
      new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(starPos, 3)),
      new THREE.PointsMaterial({ color: 0xfff6d8, size: 0.09 }),
    );
    this.scene.add(stars);

    // 단상: 옆면 + 윗판 + 앞면 숫자 (개인 순위용 1·2·3등 단)
    this.rankStand = new THREE.Group();
    for (const s of SPOTS) {
      const side = new THREE.Mesh(new THREE.BoxGeometry(1.6, s.h, 1.3).translate(s.x, s.h / 2, 0), new THREE.MeshLambertMaterial({ color: s.side }));
      const top = new THREE.Mesh(new THREE.BoxGeometry(1.68, 0.09, 1.38).translate(s.x, s.h, 0), new THREE.MeshLambertMaterial({ color: s.top }));
      const num = new THREE.Mesh(
        new THREE.PlaneGeometry(0.5, 0.5).translate(s.x, Math.max(0.24, s.h * 0.48), 0.66),
        new THREE.MeshBasicMaterial({ map: numberTexture(s.n, `#${s.side.toString(16).padStart(6, '0')}`), transparent: true }),
      );
      this.rankStand.add(side, top, num);
    }
    this.scene.add(this.rankStand);
    // 팀 우승 단: 팀원 수에 맞춰 넓이를 바꾸는 금빛 단 하나 (앞면에 별)
    const gold = SPOTS[0];
    this.teamStand = new THREE.Group();
    this.teamSide = new THREE.Mesh(new THREE.BoxGeometry(1, TEAM_H, 1.3).translate(0, TEAM_H / 2, 0), new THREE.MeshLambertMaterial({ color: gold.side }));
    this.teamTop = new THREE.Mesh(new THREE.BoxGeometry(1, 0.09, 1.38).translate(0, TEAM_H, 0), new THREE.MeshLambertMaterial({ color: gold.top }));
    const star = new THREE.Mesh(
      new THREE.PlaneGeometry(0.56, 0.56).translate(0, TEAM_H * 0.48, 0.66),
      new THREE.MeshBasicMaterial({ map: numberTexture('★', `#${gold.side.toString(16).padStart(6, '0')}`), transparent: true }),
    );
    this.teamStand.add(this.teamSide, this.teamTop, star);
    this.teamStand.visible = false;
    this.scene.add(this.teamStand);
    // 앞쪽 모닥불 두 개 (빛나는 불꽃)
    const stone = new THREE.MeshLambertMaterial({ color: 0x6a6670 });
    const fire = new THREE.MeshBasicMaterial({ color: 0xffa03a });
    const core = new THREE.MeshBasicMaterial({ color: 0xfff0a0 });
    this.fires = [];
    for (const x of [-3.6, 3.6]) {
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2;
        const st = new THREE.Mesh(new THREE.IcosahedronGeometry(0.16, 0), stone);
        st.position.set(x + Math.sin(a) * 0.45, 0.1, 1.6 + Math.cos(a) * 0.45);
        this.scene.add(st);
      }
      const f = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.8, 7).translate(0, 0.4, 0), fire);
      const k = new THREE.Mesh(new THREE.ConeGeometry(0.15, 0.5, 6).translate(0, 0.25, 0), core);
      f.position.set(x, 0.05, 1.6);
      k.position.set(x, 0.05, 1.6);
      this.scene.add(f, k);
      this.fires.push(f, k);
    }

    // 꽃가루(색종이): 1등이 올라서면 쏟아진다
    const paper = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.07, 0.11), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }), CONFETTI);
    const cols = [0xffd25a, 0xff6b8a, 0x5ab4ff, 0x8ef0a0, 0xc58bff, 0xffffff];
    const col = new THREE.Color();
    for (let i = 0; i < CONFETTI; i++) paper.setColorAt(i, col.setHex(cols[i % cols.length]));
    paper.frustumCulled = false;
    this.scene.add(paper);
    this.paper = paper;
    this.bits = Array.from({ length: CONFETTI }, () => ({ x: 0, y: -5, z: 0, vx: 0, vy: 0, rx: 0, ry: 0, spin: 0 }));
    this.m4 = new THREE.Matrix4();
    this.q = new THREE.Quaternion();
    this.e = new THREE.Euler();
    this.one = new THREE.Vector3(1, 1, 1);
  }

  // list: [{ char, skin }] 1등부터 최대 3명
  // team: true 면 list 는 이긴 팀원들 (최대 3명) → 우승 단 하나에 같은 높이로 나란히
  open(list, team = false) {
    this.close();
    const n = Math.min(3, list.length);
    this.team = team;
    this.rankStand.visible = !team;
    this.teamStand.visible = team;
    if (team) {
      const w = n * TEAM_GAP + 0.3;
      this.teamSide.scale.x = w;
      this.teamTop.scale.x = w + 0.08;
    }
    this.slots = list.slice(0, 3).map((p, rank) => {
      const mesh = this.chars.make('self', p.char, true, p.skin);
      const x = team ? (rank - (n - 1) / 2) * TEAM_GAP : SPOTS[rank].x;
      const h = team ? TEAM_H : SPOTS[rank].h;
      mesh.position.set(x, h + 0.045, 0);
      mesh.rotation.y = -x * 0.12; // 가운데를 살짝 바라본다
      mesh.userData.spawn = -(team ? 0.1 + rank * 0.12 : ENTER[rank]) * 4; // 차례로 톡 튀어나온다 (팀은 거의 함께)
      this.scene.add(mesh);
      return { mesh, rank };
    });
    this.t = 0;
    this.burst = false;
    for (const b of this.bits) b.y = -5;
    this.active = true;
  }

  close() {
    for (const s of this.slots) this.scene.remove(s.mesh);
    this.slots = [];
    this.active = false;
  }

  // 화면 좌표(픽셀)에서 rank 번째 캐릭터의 머리 위 → 이름표 위치
  tagPos(rank, w, h) {
    const s = this.slots[rank];
    if (!s) return null;
    this.v.set(s.mesh.position.x, s.mesh.position.y + 2.55, 0).project(this.camera);
    return [(this.v.x + 1) * 0.5 * w, (1 - this.v.y) * 0.5 * h];
  }

  render(renderer, dt, t, w, h) {
    this.t += dt;
    const cam = this.camera;
    const aspect = w / h;
    cam.aspect = aspect;
    // 가로 화면: 시상대를 왼쪽에 두고 오른쪽은 결과표 자리. 세로 화면: 가운데 위쪽.
    const wide = aspect > 1.2;
    const needW = wide ? 6.2 / 0.55 : 6.4; // 화면에 들어와야 할 폭
    const tan = Math.tan(((cam.fov / 2) * Math.PI) / 180);
    const dist = Math.max(10.5, needW / (2 * tan * aspect)); // 1등 머리 위 이름표와 왕관까지 들어오게
    const visW = 2 * dist * tan * aspect;
    const cx = wide ? visW * 0.2 : 0;
    cam.position.set(cx, 2.6, dist);
    cam.lookAt(cx, wide ? 1.85 : 1.3, 0);
    cam.updateProjectionMatrix();

    for (const { mesh, rank } of this.slots) {
      this.chars.animate(mesh, dt, t, { roll: -1 });
      const u = mesh.userData;
      const live = u.spawn > 0.6;
      if (!live) continue;
      const tt = this.t * 1 + rank * (this.team ? 0.37 : 1);
      if (rank === 0 || this.team) {
        // 1등(팀전은 이긴 팀 모두): 두 팔을 번쩍 들고 깡충깡충
        const hop = Math.max(0, Math.sin(tt * 5.2));
        u.pose.position.y += hop * 0.22;
        u.armL.rotation.x = -2.75 + Math.sin(tt * 10.4) * 0.12;
        u.armL.rotation.z = -0.35;
        u.armR.rotation.x = -2.6 + Math.sin(tt * 10.4 + 1) * 0.12;
        u.legL.rotation.x = u.legR.rotation.x = -hop * 0.35;
      } else if (rank === 1) {
        // 2등: 한 손을 흔든다
        u.armL.rotation.x = -2.5;
        u.armL.rotation.z = -0.35 + Math.sin(tt * 7) * 0.45;
        u.pose.position.y += Math.abs(Math.sin(tt * 3.5)) * 0.05;
      } else {
        // 3등: 손뼉을 치며 들썩인다
        const clap = Math.sin(tt * 9);
        u.armL.rotation.x = -1.25;
        u.armL.rotation.z = lerp(0.1, 0.55, (clap + 1) / 2);
        u.armR.rotation.x = -1.25;
        u.pose.position.y += Math.abs(clap) * 0.04;
      }
    }

    // 1등이 올라서는 순간 꽃가루
    if (!this.burst && this.slots.length && this.t > ENTER[0] + 0.2) {
      this.burst = true;
      for (const b of this.bits) {
        Object.assign(b, {
          x: (Math.random() - 0.5) * 6,
          y: 4 + Math.random() * 3,
          z: (Math.random() - 0.5) * 2.4,
          vx: (Math.random() - 0.5) * 0.6,
          vy: -0.9 - Math.random() * 0.8,
          rx: Math.random() * 6,
          ry: Math.random() * 6,
          spin: 4 + Math.random() * 6,
        });
      }
    }
    for (let i = 0; i < CONFETTI; i++) {
      const b = this.bits[i];
      if (this.burst) {
        b.x += (b.vx + Math.sin(this.t * 2 + i) * 0.35) * dt;
        b.y += b.vy * dt;
        b.rx += b.spin * dt;
        b.ry += b.spin * 0.7 * dt;
        if (b.y < 0.02) b.y = 0.02; // 바닥에 쌓인다
      }
      this.q.setFromEuler(this.e.set(b.rx, b.ry, 0));
      this.v.set(b.x, b.y, b.z);
      this.paper.setMatrixAt(i, this.m4.compose(this.v, this.q, this.one));
    }
    this.paper.instanceMatrix.needsUpdate = true;
    for (let i = 0; i < this.fires.length; i++) this.fires[i].scale.set(1, 0.85 + Math.sin(t * 13 + i * 2) * 0.12 + Math.random() * 0.05, 1);

    renderer.render(this.scene, cam);
  }
}
