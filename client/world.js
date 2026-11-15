// 맵 꾸미기: "한밤의 캠핑장". 충돌/시야 판정은 shared/map.js 의 상자(AABB) 그대로이고,
// 여기서는 각 상자를 울타리, 생울타리, 돌담, 바위, 나무, 텐트, 상자 더미, 오두막 모양으로 그린다.
// 벽 하나가 메시 하나(정점 색, 머티리얼 공유)라서 벽 단위로 컬링할 수 있다.
import * as THREE from 'three';
import { merge, rgb, shade } from './character.js';

const C = {
  log: rgb(0x9a6a3c), logDark: rgb(0x7a4f2a), logEnd: rgb(0xd9b98a),
  leaf: rgb(0x4f9a45), leafLight: rgb(0x77b94e), leafDark: rgb(0x356f38),
  stone: rgb(0x9a9a94), stoneLight: rgb(0xb8b6ac), moss: rgb(0x6f9a4a),
  crate: rgb(0xc08a4a), crateDark: rgb(0x8a5c2c), barrel: rgb(0xa8552e),
  roof: rgb(0xb5462f), roofDark: rgb(0x8c3524), window: [3, 2.4, 1.2],
  door: rgb(0x4a2f1c), flower: rgb(0xff9ab0), mat: rgb(0x6a5a8a),
  tents: [rgb(0xf08a3c), rgb(0x3fb0a0), rgb(0xf2c84b), rgb(0xe2606a)],
};

const box = (w, h, d, x, y, z) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);
const cylY = (r, h, x, y, z, seg = 8, rTop = r) => new THREE.CylinderGeometry(rTop, r, h, seg).translate(x, y, z);
const cylX = (r, len, x, y, z, seg = 8) => new THREE.CylinderGeometry(r, r, len, seg).rotateZ(Math.PI / 2).translate(x, y, z);
const cone = (r, h, x, y, z, seg = 8) => new THREE.ConeGeometry(r, h, seg).translate(x, y, z);
const ball = (r, sx, sy, sz, x, y, z) => new THREE.SphereGeometry(r, 8, 6).scale(sx, sy, sz).translate(x, y, z);
// 색에 조금씩 변화를 준다 (i 로 결정되는 고정 값)
const vary = (c, i, amt = 0.12) => shade(c, 1 - amt / 2 + (((i * 37) % 11) / 10) * amt);

// 아래 함수들은 길이 방향이 X 축인 로컬 좌표로 만든다 (L: 길이, T: 두께)
function palisade(L, T) {
  const parts = [];
  const n = Math.ceil(L / 1.05);
  for (let i = 0; i < n; i++) {
    const x = -L / 2 + (i + 0.5) * (L / n);
    const h = 3.3 + ((i * 7) % 3) * 0.35;
    const c = vary(i % 2 ? C.log : C.logDark, i);
    parts.push([cylY(0.52, h, x, h / 2, 0, 6), c], [cone(0.52, 0.7, x, h + 0.35, 0, 6), shade(c, 1.15)]);
  }
  parts.push([box(L, 0.3, T + 0.2, 0, 2.2, 0), C.logDark]);
  return parts;
}
function hedge(L, T, k) {
  const parts = [[box(L, 1.5, T * 0.9, 0, 0.75, 0), C.leafDark]];
  const n = Math.max(2, Math.round(L / 1.1));
  for (let i = 0; i < n; i++) {
    const x = -L / 2 + (i + 0.5) * (L / n);
    parts.push([ball(0.8, 1, 0.85, T * 0.75, x, 1.55 + ((i + k) % 2) * 0.12, 0), vary(i % 3 ? C.leaf : C.leafLight, i + k)]);
    if ((i + k) % 3 === 0) parts.push([ball(0.11, 1, 1, 1, x + 0.2, 2.15, T * 0.3), C.flower]);
  }
  return parts;
}
function logFence(L, T) {
  const parts = [];
  for (let j = 0; j < 3; j++) {
    const y = 0.42 + j * 0.78;
    const c = vary(j % 2 ? C.logDark : C.log, j);
    parts.push([cylX(0.42, L - 0.3, 0, y, (j % 2 ? 0.08 : -0.08), 7), c]);
    for (const s of [-1, 1]) parts.push([cylX(0.3, 0.06, s * (L / 2 - 0.13), y, (j % 2 ? 0.08 : -0.08), 7), C.logEnd]);
  }
  for (const s of [-1, 1]) {
    parts.push([cylY(0.3, 2.9, s * (L / 2 - 0.35), 1.45, T * 0.42, 6), C.logDark]);
    parts.push([cylY(0.3, 2.9, s * (L / 2 - 0.35), 1.45, -T * 0.42, 6), C.logDark]);
  }
  return parts;
}
function stoneWall(L, T) {
  const parts = [[box(L, 1.9, T * 0.92, 0, 0.95, 0), C.stone]];
  const n = Math.round(L / 1.15);
  for (let i = 0; i < n; i++) {
    const x = -L / 2 + (i + 0.5) * (L / n);
    const c = i % 4 === 1 ? C.moss : vary(C.stoneLight, i, 0.2);
    parts.push([box(L / n - 0.12, 0.5 + (i % 2) * 0.22, T, x, 2.15 + (i % 2) * 0.11, 0), c]);
  }
  return parts;
}
function rock(k) {
  return [
    [new THREE.IcosahedronGeometry(1.05, 0).scale(1.05, 0.95, 1).rotateY(k).translate(0, 0.75, 0), vary(C.stone, k, 0.2)],
    [new THREE.IcosahedronGeometry(0.5, 0).rotateY(k * 2).translate(0.75, 0.35, 0.6), C.stoneLight],
    [ball(0.3, 1.4, 0.5, 1.2, -0.3, 1.6, 0.1), C.moss],
  ];
}
function crates() {
  return [
    [box(1.15, 1.15, 1.15, -0.38, 0.58, -0.36), C.crate],
    [box(1.2, 0.1, 1.2, -0.38, 1.16, -0.36), C.crateDark],
    [box(0.95, 0.95, 0.95, 0.5, 0.48, 0.45).rotateY(0.15), vary(C.crate, 3)],
    [box(0.8, 0.8, 0.8, -0.3, 1.6, -0.3).rotateY(0.4), C.crateDark],
    [cylY(0.42, 1.0, 0.55, 0.5, -0.5, 10), C.barrel],
    [cylY(0.44, 0.1, 0.55, 0.8, -0.5, 10), C.crateDark],
  ];
}
function tree(k) {
  return [
    [cylY(0.36, 1.5, 0, 0.75, 0, 7, 0.28), C.logDark],
    [cone(1.35, 1.7, 0, 2.1, 0, 9), vary(C.leafDark, k)],
    [cone(1.08, 1.5, 0, 3.0, 0, 9), vary(C.leaf, k + 1)],
    [cone(0.75, 1.25, 0, 3.85, 0, 9), vary(C.leafLight, k + 2)],
  ];
}
function tent(k) {
  const c = C.tents[k % C.tents.length];
  return [
    [box(3.1, 0.06, 3.1, 0, 0.03, 0), C.mat],
    [new THREE.ConeGeometry(2.05, 2.5, 4).rotateY(Math.PI / 4).translate(0, 1.25, 0), c],
    [new THREE.ConeGeometry(0.75, 1.5, 3).rotateY(Math.PI).scale(1, 1, 0.3).translate(0, 0.75, 1.36), C.door], // 입구
    [cylY(0.05, 0.6, 0, 2.7, 0, 5), C.logDark],
    [box(0.4, 0.25, 0.02, 0.2, 2.85, 0), shade(c, 1.2)], // 깃발
  ];
}
function cabin() {
  const parts = [[box(5.5, 2.6, 5.5, 0, 1.3, 0), C.log]];
  for (let j = 0; j < 4; j++) parts.push([box(5.62, 0.1, 5.62, 0, 0.55 + j * 0.62, 0), C.logDark]);
  parts.push(
    [new THREE.ConeGeometry(4.5, 2.3, 4).rotateY(Math.PI / 4).translate(0, 3.75, 0), C.roof],
    [box(6.4, 0.18, 6.4, 0, 2.66, 0), C.roofDark],
    [box(0.7, 1.6, 0.7, 1.4, 4.0, -1.2), C.stone],
    [box(1.0, 1.7, 0.1, 0, 0.85, 2.78), C.door],
    [box(1.0, 1.7, 0.1, 0, 0.85, -2.78), C.door],
  );
  for (const s of [-1, 1]) {
    parts.push([box(0.9, 0.7, 0.1, s * 1.7, 1.55, 2.78), C.window], [box(0.9, 0.7, 0.1, s * 1.7, 1.55, -2.78), C.window]);
    parts.push([box(0.1, 0.7, 0.9, s * 2.78, 1.55, 0.9), C.window], [box(0.1, 0.7, 0.9, s * 2.78, 1.55, -0.9), C.window]);
  }
  return parts;
}

function dress(w, i) {
  const L = Math.max(w.w, w.d);
  const T = Math.min(w.w, w.d);
  const k = Math.round(Math.abs(w.cx) * 3 + Math.abs(w.cz) * 5) + (w.cx > 0 ? 1 : 0) + (w.cz > 0 ? 2 : 0);
  const kinds = {
    palisade: () => palisade(L, T), cabin, tent: () => tent(k), tree: () => tree(k), rock: () => rock(k), crates,
    hedge: () => hedge(L, T, k), fence: () => logFence(L, T), stone: () => stoneWall(L, T),
  };
  if (w.kind && kinds[w.kind]) return kinds[w.kind]();
  if (i < 4) return palisade(L, T);
  if (w.w === w.d) {
    if (w.w >= 5) return cabin();
    if (w.w >= 3) return tent(k);
    return Math.abs(w.cx) === 14 ? tree(k) : k % 2 ? rock(k) : crates();
  }
  const kind = Math.round(Math.abs(w.cx) + Math.abs(w.cz)) % 3;
  return kind === 0 ? hedge(L, T, k) : kind === 1 ? logFence(L, T) : stoneWall(L, T);
}

// walls → [{ mesh, sphere }] (walls 와 같은 순서)
export function buildWalls(walls, material) {
  return walls.map((w, i) => {
    const geo = merge(dress(w, i));
    if (w.d > w.w) geo.rotateY(Math.PI / 2);
    geo.translate(w.cx, 0, w.cz);
    geo.computeBoundingSphere();
    const mesh = new THREE.Mesh(geo, material);
    mesh.frustumCulled = false; // 직접 컬링한다
    mesh.visible = false;
    return { mesh, sphere: geo.boundingSphere };
  });
}

// 바닥 텍스처: 맵 전체를 한 장으로 그린다 (잔디, 흙길, 벽 주변 흙, 꽃과 풀).
export function buildFloorTexture(map, mapSize) {
  const walls = map.walls;
  const G = map.ground;
  const S = 1024;
  const k = S / mapSize;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  // 텍스처 좌표: u = x, v = z (PlaneGeometry 를 눕힌 뒤의 UV 에 맞춘다)
  const px = (x) => (x + mapSize / 2) * k;
  const pz = (z) => (z + mapSize / 2) * k;
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

  g.fillStyle = G.base;
  g.fillRect(0, 0, S, S);
  // 잔디 얼룩
  for (let i = 0; i < 520; i++) {
    g.fillStyle = G.patches[i % 3];
    g.beginPath();
    g.ellipse(rnd() * S, rnd() * S, 14 + rnd() * 46, 10 + rnd() * 30, rnd() * 3, 0, 7);
    g.fill();
  }
  // 흙길: 십자 + 둘레
  g.strokeStyle = '#c9a56e';
  g.lineCap = 'round';
  g.lineJoin = 'round';
  const road = (pts, width) => {
    g.lineWidth = width * k;
    g.beginPath();
    pts.forEach(([x, z], i) => (i ? g.lineTo(px(x), pz(z)) : g.moveTo(px(x), pz(z))));
    g.stroke();
  };
  for (const [col, wd] of [[G.road[0], 3.6], [G.road[1], 3.0]]) {
    g.strokeStyle = col;
    for (const [pts, scale] of map.roads) road(pts, wd * scale);
  }
  // 호숫가 모래
  for (const w of map.water) {
    g.fillStyle = '#e2cf95';
    g.fillRect(px(w.minX - 1.4), pz(w.minZ - 1.4), (w.w + 2.8) * k, (w.d + 2.8) * k);
  }
  // 벽(소품) 밑은 다져진 흙
  for (const w of walls.slice(4)) {
    g.fillStyle = 'rgba(150,115,70,.55)';
    g.beginPath();
    if (g.roundRect) g.roundRect(px(w.minX - 0.5), pz(w.minZ - 0.5), (w.w + 1) * k, (w.d + 1) * k, 0.6 * k);
    else g.rect(px(w.minX - 0.5), pz(w.minZ - 0.5), (w.w + 1) * k, (w.d + 1) * k);
    g.fill();
  }
  // 자갈, 풀, 꽃
  for (let i = 0; i < 2600; i++) {
    const x = rnd() * S;
    const y = rnd() * S;
    const t = i % 10;
    if (t < 5) {
      g.strokeStyle = t < 3 ? 'rgba(70,125,55,.7)' : 'rgba(170,210,110,.7)';
      g.lineWidth = 1.5;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + rnd() * 4 - 2, y - 4 - rnd() * 3);
      g.stroke();
    } else if (t < 8) {
      g.fillStyle = 'rgba(120,105,85,.5)';
      g.fillRect(x, y, 2 + rnd() * 2, 2 + rnd() * 2);
    } else {
      g.fillStyle = ['#fff3c4', '#ffb3c4', '#ffffff', '#ffd66b'][i % 4];
      g.beginPath();
      g.arc(x, y, 1.8, 0, 7);
      g.fill();
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

// 물: 바닥보다 살짝 위의 파란 판 + 연잎. 판정상 들어갈 수 없지만 시야는 막지 않는다.
export function buildWater(map, material) {
  if (!map.water.length) return null;
  const parts = [];
  for (const w of map.water) parts.push([new THREE.BoxGeometry(w.w, 0.1, w.d).translate(w.cx, 0.04, w.cz), rgb(0x3f8fc4)]);
  for (const w of map.water) parts.push([new THREE.BoxGeometry(w.w - 0.5, 0.1, w.d - 0.5).translate(w.cx, 0.06, w.cz), rgb(0x2f74a8)]);
  let seed = 11;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 14; i++) {
    const w = map.water[i % map.water.length];
    const x = w.minX + 0.8 + rnd() * (w.w - 1.6);
    const z = w.minZ + 0.8 + rnd() * (w.d - 1.6);
    parts.push([new THREE.CylinderGeometry(0.35 + rnd() * 0.25, 0.4, 0.04, 9).translate(x, 0.13, z), rgb(0x5aa84a)]);
    if (i % 4 === 0) parts.push([new THREE.SphereGeometry(0.12, 6, 4).translate(x + 0.15, 0.2, z), rgb(0xffb3d0)]);
  }
  const mesh = new THREE.Mesh(merge(parts), material);
  mesh.frustumCulled = false;
  return mesh;
}

// 아이템 모양 (바닥에서 떠서 빙글빙글 돈다)
export function buildItemGeos() {
  const Y = 0.75;
  return {
    battery: merge([
      [new THREE.CylinderGeometry(0.2, 0.2, 0.55, 12).translate(0, Y, 0), rgb(0x2b2b30)],
      [new THREE.CylinderGeometry(0.205, 0.205, 0.25, 12).translate(0, Y + 0.13, 0), rgb(0xffc63a)],
      [new THREE.CylinderGeometry(0.08, 0.08, 0.08, 8).translate(0, Y + 0.31, 0), rgb(0xd8d8d8)],
      [new THREE.BoxGeometry(0.06, 0.18, 0.02).translate(0, Y - 0.05, 0.2), rgb(0xffe27a)],
    ]),
    sneakers: merge([
      [new THREE.BoxGeometry(0.3, 0.16, 0.62).translate(-0.18, Y - 0.1, 0), rgb(0xff5d5d)],
      [new THREE.BoxGeometry(0.31, 0.06, 0.64).translate(-0.18, Y - 0.2, 0), rgb(0xffffff)],
      [new THREE.BoxGeometry(0.3, 0.16, 0.62).translate(0.18, Y - 0.04, 0.06), rgb(0xff5d5d)],
      [new THREE.BoxGeometry(0.31, 0.06, 0.64).translate(0.18, Y - 0.14, 0.06), rgb(0xffffff)],
    ]),
    vest: merge([
      [new THREE.BoxGeometry(0.62, 0.62, 0.22).translate(0, Y, 0), rgb(0xf2a03a)],
      [new THREE.BoxGeometry(0.64, 0.08, 0.24).translate(0, Y + 0.1, 0), rgb(0xe8f6ff)],
      [new THREE.BoxGeometry(0.64, 0.08, 0.24).translate(0, Y - 0.12, 0), rgb(0xe8f6ff)],
      [new THREE.BoxGeometry(0.2, 0.3, 0.24).translate(0, Y + 0.38, 0), rgb(0xf2a03a)],
    ]),
    cloak: merge([
      [new THREE.ConeGeometry(0.38, 0.75, 10).translate(0, Y, 0), rgb(0x6a4fd0)],
      [new THREE.SphereGeometry(0.17, 10, 8).translate(0, Y + 0.32, 0), rgb(0x8a72f0)],
      [new THREE.SphereGeometry(0.04, 6, 4).translate(0.07, Y + 0.33, 0.14), [3, 3, 3]],
      [new THREE.SphereGeometry(0.04, 6, 4).translate(-0.07, Y + 0.33, 0.14), [3, 3, 3]],
    ]),
  };
}
