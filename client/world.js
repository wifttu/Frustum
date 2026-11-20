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
  // 겨울
  snow: rgb(0xf4f8ff), snowShade: rgb(0xd2e0f0), ice: rgb(0xb4dcf4), iceLight: rgb(0xd8f0ff), pine: rgb(0x2f5a48), pineLight: rgb(0x3f7058),
  carrot: rgb(0xff8a2a), coal: rgb(0x26262c), scarf: rgb(0xe24a4a),
  // 해변
  sand: rgb(0xe2c88c), sandDark: rgb(0xc4a46a), palmTrunk: rgb(0xa47a4a), palmLeaf: rgb(0x3f9a4a), palmLeafLight: rgb(0x5cba58),
  straw: rgb(0xd8b25a), strawDark: rgb(0xb08a3a), plank: rgb(0xc89a62), sea: rgb(0x2a6f8f), white: rgb(0xf4f4f0), red: rgb(0xe0453a),
  boats: [rgb(0x3f7fd0), rgb(0xe0453a), rgb(0x3fb08a), rgb(0xf2b53a)], seaRock: rgb(0x6f7480), seaRockLight: rgb(0x8a909a),
  // 공장
  concrete: rgb(0x9a9894), concreteDark: rgb(0x75736e), brick: rgb(0xa4513a), brickDark: rgb(0x7e3a28), steel: rgb(0x8c949c),
  steelDark: rgb(0x5c636a), rust: rgb(0xa0582a), hazard: rgb(0xf2c230), black: rgb(0x2a2a2e),
  containers: [rgb(0xc8432f), rgb(0x2f6fb5), rgb(0x3f8f4a), rgb(0xe08a2a), rgb(0x8a5ab0)],
  drums: [rgb(0x2f6fb5), rgb(0xc8432f), rgb(0xf2c230), rgb(0x3f8f4a)],
  glow: [3, 2.5, 1.4], fire: [3, 1.6, 0.4], fireCore: [3, 2.8, 1.2],
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
function cabin(roof = C.roof, roofDark = C.roofDark) {
  const parts = [[box(5.5, 2.6, 5.5, 0, 1.3, 0), C.log]];
  for (let j = 0; j < 4; j++) parts.push([box(5.62, 0.1, 5.62, 0, 0.55 + j * 0.62, 0), C.logDark]);
  parts.push(
    [new THREE.ConeGeometry(4.5, 2.3, 4).rotateY(Math.PI / 4).translate(0, 3.75, 0), roof],
    [box(6.4, 0.18, 6.4, 0, 2.66, 0), roofDark],
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

// ───── 겨울 ─────
function snowFence(L, T) {
  const parts = [[ball(1, L / 2, 0.35, T * 0.9, 0, 0, 0), C.snowShade]]; // 발밑 눈더미
  const n = Math.ceil(L / 0.7);
  for (let i = 0; i < n; i++) {
    const x = -L / 2 + (i + 0.5) * (L / n);
    const h = 2.4 + (i % 2) * 0.25;
    parts.push([box(0.4, h, 0.18, x, h / 2, 0), vary(C.logDark, i)], [box(0.46, 0.22, 0.3, x, h + 0.05, 0), C.snow]);
  }
  for (const y of [0.8, 1.8]) parts.push([box(L, 0.2, 0.12, 0, y, 0.15), C.log], [box(L, 0.08, 0.2, 0, y + 0.14, 0.15), C.snow]);
  return parts;
}
function iceWall(L, T) {
  const parts = [];
  const n = Math.max(2, Math.round(L / 1.3));
  for (let r = 0; r < 2; r++) {
    for (let i = 0; i < n - r; i++) {
      const x = -L / 2 + (i + 0.5 + r * 0.5) * (L / n);
      const c = (i + r) % 3 === 0 ? C.iceLight : vary(C.ice, i + r * 5, 0.15);
      parts.push([box(L / n - 0.1, 1.05, T * 0.9 - r * 0.15, x, 0.55 + r * 1.08, 0), c]);
    }
  }
  parts.push([box(L * 0.85, 0.18, T * 0.6, 0, 2.2, 0), C.snow]);
  return parts;
}
function snowTree(k) {
  const parts = [[cylY(0.34, 1.3, 0, 0.65, 0, 7, 0.26), C.logDark], [ball(1, 1.2, 0.25, 1.2, 0, 0.05, 0), C.snow]];
  const layers = [[1.45, 1.7, 1.95], [1.15, 1.5, 2.85], [0.8, 1.25, 3.7]];
  layers.forEach(([r, h, y], j) => {
    parts.push([cone(r, h, 0, y, 0, 9), vary(j % 2 ? C.pineLight : C.pine, k + j)]);
    parts.push([cone(r * 0.72, h * 0.42, 0, y + h * 0.3, 0, 9), C.snow]); // 가지 위에 쌓인 눈
  });
  return parts;
}
function snowman(k) {
  const a = k * 0.7;
  return [
    [ball(0.85, 1, 0.9, 1, 0, 0.7, 0), C.snow], [ball(0.6, 1, 1, 1, 0, 1.7, 0), C.snow], [ball(0.42, 1, 1, 1, 0, 2.45, 0), C.snow],
    [new THREE.ConeGeometry(0.08, 0.45, 8).rotateX(Math.PI / 2).translate(0, 2.45, 0.6), C.carrot],
    [ball(0.06, 1, 1, 1, 0.15, 2.58, 0.36), C.coal], [ball(0.06, 1, 1, 1, -0.15, 2.58, 0.36), C.coal],
    [ball(0.07, 1, 1, 1, 0, 1.85, 0.56), C.coal], [ball(0.07, 1, 1, 1, 0, 1.6, 0.6), C.coal],
    [cylY(0.45, 0.2, 0, 2.16, 0, 12), C.scarf], [box(0.2, 0.5, 0.08, 0.25, 1.95, 0.42), C.scarf],
    [cylY(0.3, 0.45, 0, 3.0, 0, 10), C.coal], [cylY(0.45, 0.06, 0, 2.8, 0, 12), C.coal],
    [new THREE.CylinderGeometry(0.05, 0.05, 1.1, 5).rotateZ(Math.PI / 2 + 0.5 + Math.sin(a) * 0.2).translate(0.95, 1.95, 0), C.logDark],
    [new THREE.CylinderGeometry(0.05, 0.05, 1.1, 5).rotateZ(Math.PI / 2 - 0.5).translate(-0.95, 1.95, 0), C.logDark],
  ];
}
function igloo() {
  const parts = [[new THREE.SphereGeometry(1.65, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), C.snow]];
  for (let j = 1; j < 4; j++) parts.push([cylY(1.66 * Math.cos(j * 0.38), 0.05, 0, 1.65 * Math.sin(j * 0.38), 0, 16), C.snowShade]);
  parts.push(
    [new THREE.CylinderGeometry(0.75, 0.75, 1.2, 10, 1, false, 0, Math.PI).rotateZ(Math.PI / 2).rotateY(Math.PI / 2).translate(0, 0, 1.55), C.snow],
    [box(0.9, 0.9, 0.05, 0, 0.45, 2.16), [0.9, 0.55, 0.25]], // 안쪽 불빛
  );
  return parts;
}
function woodpile(L, T) {
  const parts = [];
  for (let r = 0; r < 3; r++) {
    const n = 3 - r;
    for (let i = 0; i < n; i++) {
      const z = (i - (n - 1) / 2) * 0.48;
      parts.push([cylX(0.24, L * 0.9, 0, 0.25 + r * 0.42, z * (T / 1.4), 8), vary(C.log, i + r)]);
      for (const sx of [-1, 1]) parts.push([cylX(0.2, 0.04, sx * L * 0.45, 0.25 + r * 0.42, z * (T / 1.4), 8), C.logEnd]);
    }
  }
  parts.push([box(L * 0.8, 0.15, 0.6, 0, 1.2, 0), C.snow]);
  return parts;
}
// ───── 해변 ─────
function seaWall(L, T) {
  const parts = [];
  const n = Math.ceil(L / 1.5);
  for (let i = 0; i < n; i++) {
    const x = -L / 2 + (i + 0.5) * (L / n);
    parts.push([new THREE.IcosahedronGeometry(1.05 + (i % 3) * 0.12, 0).scale(1, 1.15, 0.9).rotateY(i * 1.3).translate(x, 0.9, 0), vary(C.seaRock, i, 0.25)]);
    if (i % 2) parts.push([new THREE.IcosahedronGeometry(0.6, 0).rotateY(i).translate(x + 0.4, 2.0, 0.1), C.seaRockLight]);
  }
  return parts;
}
function palm(k) {
  const parts = [];
  const lean = (k % 2 ? 1 : -1) * 0.12;
  for (let j = 0; j < 6; j++) {
    const y = 0.3 + j * 0.62;
    parts.push([cylY(0.24 - j * 0.015, 0.66, lean * j * j * 0.25, y, 0, 7, 0.22 - j * 0.015), vary(j % 2 ? C.palmTrunk : C.logDark, j)]);
  }
  const tx = lean * 25 * 0.25;
  const top = 3.9;
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2 + k;
    const leaf = new THREE.BoxGeometry(2.1, 0.06, 0.5).translate(1.05, 0, 0).rotateZ(-0.45).rotateY(a).translate(tx, top, 0);
    parts.push([leaf, vary(i % 2 ? C.palmLeaf : C.palmLeafLight, i)]);
  }
  for (let i = 0; i < 3; i++) parts.push([ball(0.16, 1, 1, 1, tx + Math.sin(i * 2.1) * 0.25, top - 0.2, Math.cos(i * 2.1) * 0.25), C.logDark]);
  parts.push([ball(1, 0.9, 0.18, 0.9, 0, 0.05, 0), C.sandDark]);
  return parts;
}
function beachHut() {
  const parts = [[box(4.6, 2.3, 4.6, 0, 1.15, 0), C.plank]];
  for (let j = 0; j < 5; j++) parts.push([box(4.7, 0.06, 4.7, 0, 0.3 + j * 0.45, 0), shade(C.plank, 0.82)]);
  parts.push(
    [new THREE.ConeGeometry(4.2, 2.4, 4).rotateY(Math.PI / 4).translate(0, 3.5, 0), C.straw],
    [new THREE.ConeGeometry(4.35, 0.5, 4).rotateY(Math.PI / 4).translate(0, 2.55, 0), C.strawDark],
    [box(1.0, 1.7, 0.1, 0, 0.85, 2.32), C.door],
    [box(1.2, 0.8, 0.1, 1.4, 1.4, -2.32), C.window], [box(0.1, 0.8, 1.2, 2.32, 1.4, 0), C.window], [box(0.1, 0.8, 1.2, -2.32, 1.4, 0), C.window],
  );
  // 줄무늬 차양
  for (let i = 0; i < 6; i++) parts.push([box(0.4, 0.06, 1.1, -1.8 + i * 0.4 + 0.2 + 1.2, 2.05, 2.8).rotateX(0), i % 2 ? C.white : C.red]);
  return parts;
}
function boat(L, T, k) {
  const c = C.boats[k % C.boats.length];
  return [
    [ball(1, L / 2, 0.62, T / 2, 0, 0.12, 0), c],
    [ball(1, L / 2 + 0.03, 0.2, T / 2 + 0.03, 0, 0.2, 0), C.white],
    [box(L * 0.92, 0.12, 0.1, 0, 0.74, 0), shade(c, 0.7)],
    [cylX(0.05, 2.2, 0.2, 0.08, T / 2 + 0.25).rotateY(0.2), C.log],
  ];
}
function sandbags(L, T) {
  const parts = [];
  const n = Math.max(2, Math.round(L / 0.9));
  for (let r = 0; r < 3; r++) {
    for (let i = 0; i < n - (r % 2); i++) {
      const x = -L / 2 + (i + 0.5 + (r % 2) * 0.5) * (L / n);
      parts.push([ball(1, (L / n) * 0.55, 0.3, T * 0.48, x, 0.28 + r * 0.5, 0), vary(r === 2 ? C.sand : C.sandDark, i + r, 0.2)]);
    }
  }
  return parts;
}
function lifeguard() {
  const parts = [];
  for (const sx of [-0.8, 0.8]) for (const sz of [-0.8, 0.8]) parts.push([box(0.14, 2.2, 0.14, sx, 1.1, sz), C.white]);
  parts.push(
    [box(2.1, 0.15, 2.1, 0, 2.2, 0), C.plank], [box(2.1, 0.5, 0.08, 0, 2.5, -1.0), C.white], [box(0.08, 0.5, 2.1, 1.0, 2.5, 0), C.white], [box(0.08, 0.5, 2.1, -1.0, 2.5, 0), C.white],
    [box(0.7, 0.8, 0.6, 0, 2.7, -0.3), C.red],
  );
  for (let i = 0; i < 4; i++) parts.push([new THREE.ConeGeometry(1.7, 0.8, 4, 1, true, (i * Math.PI) / 2 + Math.PI / 4, Math.PI / 2).translate(0, 3.85, 0), i % 2 ? C.white : C.red]);
  for (let j = 0; j < 5; j++) parts.push([box(0.7, 0.07, 0.07, 0, 0.35 + j * 0.42, 1.15), C.plank]);
  return parts;
}
// ───── 공장 ─────
function brickWall(L, T) {
  const parts = [[box(L, 2.9, T * 0.9, 0, 1.45, 0), C.brickDark]];
  for (let r = 0; r < 9; r++) {
    const n = Math.max(2, Math.round(L / 0.8));
    for (let i = 0; i < n; i++) {
      if ((i * 7 + r * 3) % 5 === 0) continue;
      const x = -L / 2 + (i + 0.5 + (r % 2) * 0.25) * (L / n);
      if (Math.abs(x) > L / 2 - 0.2) continue;
      parts.push([box((L / n) * 0.9, 0.27, T * 0.95, x, 0.17 + r * 0.31, 0), vary(C.brick, i + r * 3, 0.2)]);
    }
  }
  parts.push([box(L + 0.1, 0.18, T + 0.1, 0, 2.98, 0), C.concrete]);
  return parts;
}
function container(L, T, k) {
  const c = C.containers[k % C.containers.length];
  const H = 2.6;
  const parts = [[box(L, H, T, 0, H / 2, 0), c]];
  const n = Math.round(L / 0.45);
  for (let i = 0; i < n; i++) {
    const x = -L / 2 + (i + 0.5) * (L / n);
    for (const sz of [-1, 1]) parts.push([box(0.14, H - 0.25, 0.06, x, H / 2, sz * (T / 2 + 0.01)), shade(c, 0.78)]);
  }
  parts.push([box(L + 0.06, 0.14, T + 0.06, 0, H, 0), shade(c, 0.7)], [box(L + 0.06, 0.14, T + 0.06, 0, 0.07, 0), shade(c, 0.6)]);
  for (const sx of [-1, 1]) {
    parts.push([box(0.06, H - 0.3, T - 0.2, sx * (L / 2 + 0.02), H / 2, 0), shade(c, 0.85)]);
    parts.push([box(0.08, H - 0.5, 0.06, sx * (L / 2 + 0.05), H / 2, 0.3), C.steelDark], [box(0.08, H - 0.5, 0.06, sx * (L / 2 + 0.05), H / 2, -0.3), C.steelDark]);
  }
  parts.push([box(L * 0.3, 0.35, 0.03, -L * 0.2, H * 0.72, T / 2 + 0.04), C.white]);
  return parts;
}
function pipes(L, T) {
  const parts = [];
  const n = Math.max(2, Math.round(L / 2.5));
  for (let i = 0; i <= n; i++) {
    const x = -L / 2 + 0.3 + (i * (L - 0.6)) / n;
    parts.push([box(0.2, 2.6, T * 0.9, x, 1.3, 0), C.steelDark], [box(0.24, 0.2, T, x, 0.6, 0), C.hazard]);
  }
  const rows = [[0.55, 0.9, C.steel], [0.42, 1.95, C.rust], [0.3, 2.7, C.steel]];
  rows.forEach(([r, y, c], j) => {
    parts.push([cylX(r, L, 0, y, (j - 1) * 0.12, 12), c]);
    for (let i = 1; i < n; i++) parts.push([cylX(r + 0.06, 0.18, -L / 2 + (i * L) / n, y, (j - 1) * 0.12, 12), C.steelDark]);
  });
  parts.push([new THREE.TorusGeometry(0.3, 0.05, 6, 12).translate(L * 0.2, 0.9, T / 2 + 0.2), C.red]);
  return parts;
}
function drum(x, z, c, h = 1.0) {
  return [
    [cylY(0.36, h, x, h / 2, z, 12), c], [cylY(0.375, 0.06, x, h * 0.3, z, 12), shade(c, 0.7)], [cylY(0.375, 0.06, x, h * 0.7, z, 12), shade(c, 0.7)],
    [cylY(0.3, 0.03, x, h + 0.01, z, 12), shade(c, 0.6)],
  ];
}
function barrels(k) {
  const D = C.drums;
  return [
    ...drum(-0.42, -0.4, D[k % 4]), ...drum(0.42, -0.42, D[(k + 1) % 4]), ...drum(-0.4, 0.42, D[(k + 2) % 4]),
    ...drum(0.45, 0.45, C.hazard, 0.6), [box(0.5, 0.06, 0.02, 0.45, 0.3, 0.82), C.black],
    [cylX(0.36, 1.0, 0.1, 1.38, -0.1, 12).rotateY(0.6), D[(k + 3) % 4]],
  ];
}
function tank(k, size) {
  const r = (size / 2) * 0.95;
  const h = 3.8 + size * 0.25;
  const parts = [
    [cylY(r, h, 0, h / 2, 0, 18), vary(C.concrete, k, 0.1)],
    [new THREE.SphereGeometry(r, 18, 6, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.4, 1).translate(0, h, 0), C.steel],
  ];
  for (const y of [h * 0.25, h * 0.55, h * 0.85]) parts.push([cylY(r + 0.04, 0.12, 0, y, 0, 18), C.steelDark]);
  parts.push([box(r * 1.2, 0.4, 0.05, 0, h * 0.4, r + 0.01), C.hazard], [box(0.5, h, 0.08, r * 0.6, h / 2, r * 0.8).rotateY(0.6), C.steelDark]);
  for (let j = 0; j < 6; j++) parts.push([box(0.4, 0.05, 0.05, r * 0.6, 0.4 + j * (h / 6), r * 0.85).rotateY(0.6), C.steel]);
  parts.push([box(r * 0.5, 0.6, 0.06, -r * 0.3, h * 0.15, r * 0.98), C.rust]);
  return parts;
}
function warehouse(w, d) {
  const H = 3.2;
  const parts = [[box(w, H, d, 0, H / 2, 0), C.steel]];
  const n = Math.round(w / 0.4);
  for (let i = 0; i < n; i++) {
    const x = -w / 2 + (i + 0.5) * (w / n);
    for (const sz of [-1, 1]) parts.push([box(0.1, H - 0.1, 0.05, x, H / 2, sz * (d / 2 + 0.01)), C.steelDark]);
  }
  // 박공 지붕
  const roof = new THREE.CylinderGeometry(d / 2 + 0.3, d / 2 + 0.3, w + 0.4, 3, 1).rotateZ(Math.PI / 2).scale(1, 0.5, 1).translate(0, H + 0.02, 0);
  parts.push([roof, C.rust], [box(w + 0.5, 0.15, d + 0.6, 0, H, 0), C.steelDark]);
  parts.push([box(2.4, 2.4, 0.08, -w * 0.15, 1.2, d / 2 + 0.04), C.concreteDark]);
  for (let j = 0; j < 8; j++) parts.push([box(2.4, 0.05, 0.1, -w * 0.15, 0.2 + j * 0.3, d / 2 + 0.06), C.steelDark]);
  for (const x of [w * 0.28, -w * 0.4]) parts.push([box(0.9, 0.5, 0.06, x, 2.4, -d / 2 - 0.04), C.window]);
  parts.push([box(0.9, 0.5, 0.06, w * 0.3, 2.4, d / 2 + 0.04), C.window]);
  parts.push([cylY(0.3, 1.2, w * 0.25, H + 1.2, 0, 8), C.steelDark], [cylY(0.38, 0.12, w * 0.25, H + 1.85, 0, 8), C.steel]);
  for (let i = 0; i < 6; i++) parts.push([box(0.5, 0.12, 0.05, -w * 0.15 - 1.2 + i * 0.5 + 0.25, 2.5, d / 2 + 0.1), i % 2 ? C.hazard : C.black]);
  return parts;
}

// ───── 훈련장 ─────
// 나무 가림막: 판자 벽에 과녁을 그렸다
function plankWall(L, T) {
  const parts = [];
  const n = Math.round(L / 0.55);
  for (let i = 0; i < n; i++) {
    const x = -L / 2 + (i + 0.5) * (L / n);
    const h = 2.5 + ((i * 5) % 3) * 0.12;
    parts.push([box(L / n - 0.05, h, T * 0.5, x, h / 2, 0), vary(i % 2 ? C.plank : shade(C.plank, 0.88), i, 0.15)]);
  }
  for (const y of [0.6, 1.9]) parts.push([box(L, 0.18, T * 0.7, 0, y, 0), C.logDark]);
  for (const sx of [-1, 1]) parts.push([box(0.3, 2.9, T, sx * (L / 2 - 0.15), 1.45, 0), C.logDark]);
  // 과녁 (양면)
  for (const x of [-L * 0.28, L * 0.28]) {
    for (const sz of [-1, 1]) {
      const z = sz * (T * 0.26);
      [[0.62, C.white], [0.48, C.red], [0.32, C.white], [0.16, C.red]].forEach(([r, c], j) => {
        parts.push([new THREE.CylinderGeometry(r, r, 0.03, 20).rotateX(Math.PI / 2).translate(x, 1.45, z + sz * (0.01 + j * 0.008)), c]);
      });
    }
  }
  return parts;
}
// 둥근 건초 더미
function haybale(k) {
  const parts = [];
  const lying = k % 2 === 0;
  const roll = (x, y, z, r, len) => {
    const g = new THREE.CylinderGeometry(r, r, len, 16);
    if (lying) g.rotateZ(Math.PI / 2);
    return g.translate(x, y, z);
  };
  parts.push([roll(0, lying ? 0.75 : 0.65, 0, 0.75, lying ? 1.4 : 1.3), C.straw]);
  for (const t of [-0.45, 0, 0.45]) {
    const g = new THREE.TorusGeometry(0.76, 0.03, 4, 18);
    if (lying) g.rotateY(Math.PI / 2).translate(t, 0.75, 0);
    else g.rotateX(Math.PI / 2).translate(0, 0.65 + t, 0);
    parts.push([g, C.strawDark]);
  }
  parts.push([ball(0.4, 1.2, 0.4, 1.2, 0, 0.04, 0), C.strawDark]);
  return parts;
}

function dress(w, i) {
  const L = Math.max(w.w, w.d);
  const T = Math.min(w.w, w.d);
  const k = Math.round(Math.abs(w.cx) * 3 + Math.abs(w.cz) * 5) + (w.cx > 0 ? 1 : 0) + (w.cz > 0 ? 2 : 0);
  const kinds = {
    palisade: () => palisade(L, T), cabin, tent: () => tent(k), tree: () => tree(k), rock: () => rock(k), crates,
    hedge: () => hedge(L, T, k), fence: () => logFence(L, T), stone: () => stoneWall(L, T),
    // 겨울
    snowfence: () => snowFence(L, T), ice: () => iceWall(L, T), snowtree: () => snowTree(k), snowman: () => snowman(k), igloo,
    snowcabin: () => [...cabin(C.snow, C.snowShade), [box(0.85, 0.25, 0.85, 1.4, 4.85, -1.2), C.snow]], woodpile: () => woodpile(L, T),
    // 해변
    seawall: () => seaWall(L, T), palm: () => palm(k), hut: beachHut, boat: () => boat(L, T, k), sandbag: () => sandbags(L, T), lifeguard,
    // 공장
    brick: () => brickWall(L, T), container: () => container(L, T, k), pipes: () => pipes(L, T), barrels: () => barrels(k),
    tank: () => tank(k, L), warehouse: () => warehouse(L, T),
    // 훈련장
    plank: () => plankWall(L, T), haybale: () => haybale(k),
    void: () => [[box(0.01, 0.01, 0.01, 0, -20, 0), [0, 0, 0]]], // 울타리 밖 어둠 (그리지 않는다)
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

// 테마별 바닥 잔무늬
const DETAILS = {
  // 눈: 반짝이, 발자국, 얼음 조각
  snow(g, S, rnd) {
    for (let i = 0; i < 260; i++) {
      g.fillStyle = 'rgba(150,175,210,.25)';
      const x = rnd() * S;
      const y = rnd() * S;
      const a = rnd() * 6;
      for (let j = 0; j < 4; j++) {
        g.beginPath();
        g.ellipse(x + Math.sin(a) * j * 9 + (j % 2) * 4, y + Math.cos(a) * j * 9, 2.2, 3.2, a, 0, 7);
        g.fill();
      }
    }
    for (let i = 0; i < 2600; i++) {
      g.fillStyle = i % 3 ? 'rgba(255,255,255,.9)' : 'rgba(170,200,235,.6)';
      g.fillRect(rnd() * S, rnd() * S, 1.6, 1.6);
    }
  },
  // 모래: 물결 무늬, 조개, 자갈
  sand(g, S, rnd) {
    g.lineWidth = 1.4;
    for (let i = 0; i < 420; i++) {
      g.strokeStyle = i % 2 ? 'rgba(255,245,210,.45)' : 'rgba(180,150,95,.35)';
      const x = rnd() * S;
      const y = rnd() * S;
      g.beginPath();
      g.arc(x, y, 8 + rnd() * 10, 3.6, 5.8);
      g.stroke();
    }
    for (let i = 0; i < 1400; i++) {
      const t = i % 7;
      g.fillStyle = t === 0 ? '#fff4e8' : t === 1 ? '#f2b5a0' : 'rgba(150,125,90,.55)';
      g.beginPath();
      g.arc(rnd() * S, rnd() * S, t < 2 ? 2.2 : 1.2, 0, 7);
      g.fill();
    }
  },
  // 콘크리트: 이음매, 금, 기름 얼룩
  concrete(g, S, rnd) {
    g.strokeStyle = 'rgba(40,40,40,.25)';
    g.lineWidth = 1.2;
    for (let x = 0; x <= S; x += S / 16) {
      g.beginPath();
      g.moveTo(x, 0);
      g.lineTo(x, S);
      g.moveTo(0, x);
      g.lineTo(S, x);
      g.stroke();
    }
    for (let i = 0; i < 70; i++) {
      g.fillStyle = 'rgba(25,25,28,.3)';
      g.beginPath();
      g.ellipse(rnd() * S, rnd() * S, 6 + rnd() * 16, 4 + rnd() * 10, rnd() * 3, 0, 7);
      g.fill();
    }
    g.strokeStyle = 'rgba(30,30,30,.45)';
    for (let i = 0; i < 120; i++) {
      let x = rnd() * S;
      let y = rnd() * S;
      g.beginPath();
      g.moveTo(x, y);
      for (let j = 0; j < 4; j++) g.lineTo((x += rnd() * 16 - 8), (y += rnd() * 16 - 8));
      g.stroke();
    }
    for (let i = 0; i < 900; i++) {
      g.fillStyle = i % 2 ? 'rgba(150,148,140,.5)' : 'rgba(60,58,55,.5)';
      g.fillRect(rnd() * S, rnd() * S, 1.5, 1.5);
    }
  },
};

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
  // 도로 가운데 점선 (공장)
  if (G.roadLine) {
    g.strokeStyle = G.roadLine;
    g.setLineDash([1.6 * k, 1.4 * k]);
    g.lineWidth = 0.18 * k;
    for (const [pts] of map.roads) {
      g.beginPath();
      pts.forEach(([x, z], i) => (i ? g.lineTo(px(x), pz(z)) : g.moveTo(px(x), pz(z))));
      g.stroke();
    }
    g.setLineDash([]);
  }
  // 물가 (모래, 눈, 슬러지)
  for (const w of map.water) {
    g.fillStyle = G.shore || '#e2cf95';
    g.fillRect(px(w.minX - 1.4), pz(w.minZ - 1.4), (w.w + 2.8) * k, (w.d + 2.8) * k);
  }
  // 나무 부두 (해변)
  for (const [cx, cz, w, d] of G.decks || []) {
    g.fillStyle = '#7a5634';
    g.fillRect(px(cx - w / 2), pz(cz - d / 2), w * k, d * k);
    g.fillStyle = '#a77c4c';
    for (let z = cz - d / 2; z < cz + d / 2; z += 0.55) g.fillRect(px(cx - w / 2 + 0.1), pz(z + 0.05), (w - 0.2) * k, 0.45 * k);
  }
  // 벽(소품) 밑은 다져진 흙
  for (const w of walls.slice(4)) {
    g.fillStyle = G.under || 'rgba(150,115,70,.55)';
    g.beginPath();
    if (g.roundRect) g.roundRect(px(w.minX - 0.5), pz(w.minZ - 0.5), (w.w + 1) * k, (w.d + 1) * k, 0.6 * k);
    else g.rect(px(w.minX - 0.5), pz(w.minZ - 0.5), (w.w + 1) * k, (w.d + 1) * k);
    g.fill();
  }
  const detail = DETAILS[G.detail];
  if (detail) detail(g, S, rnd);
  // 자갈, 풀, 꽃
  for (let i = 0; i < (detail ? 0 : 2600); i++) {
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
  // 작은 맵: 울타리 밖은 어두운 흙
  if (map.half && map.half < mapSize / 2) {
    g.fillStyle = '#1c1812';
    const inner = (map.half + 0.5) * k;
    const mid = S / 2;
    g.fillRect(0, 0, S, mid - inner);
    g.fillRect(0, mid + inner, S, S - mid - inner);
    g.fillRect(0, 0, mid - inner, S);
    g.fillRect(mid + inner, 0, S - mid - inner, S);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

// 물: 바닥보다 살짝 위의 판. 맵마다 호수(연잎), 바다(파도 거품), 얼음(금), 독성 웅덩이(거품). 시야는 막지 않는다.
const WATER = {
  lake: { edge: 0x3f8fc4, mid: 0x2f74a8 },
  sea: { edge: 0x2f8fb0, mid: 0x1b5c86 },
  ice: { edge: 0xcfe8f8, mid: 0xa6d2ee },
  toxic: { edge: 0x4a5a22, mid: [0.35, 1.5, 0.2] },
};
export function buildWater(map, material) {
  if (!map.water.length) return null;
  const style = map.look?.water || 'lake';
  const W = WATER[style];
  const col = (c) => (Array.isArray(c) ? c : rgb(c));
  const parts = [];
  for (const w of map.water) parts.push([new THREE.BoxGeometry(w.w, 0.1, w.d).translate(w.cx, 0.04, w.cz), col(W.edge)]);
  for (const w of map.water) parts.push([new THREE.BoxGeometry(w.w - 0.5, 0.1, w.d - 0.5).translate(w.cx, 0.06, w.cz), col(W.mid)]);
  let seed = 11;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const spot = (w, m = 0.8) => [w.minX + m + rnd() * (w.w - 2 * m), w.minZ + m + rnd() * (w.d - 2 * m)];
  if (style === 'lake') {
    for (let i = 0; i < 14; i++) {
      const [x, z] = spot(map.water[i % map.water.length]);
      parts.push([new THREE.CylinderGeometry(0.35 + rnd() * 0.25, 0.4, 0.04, 9).translate(x, 0.13, z), rgb(0x5aa84a)]);
      if (i % 4 === 0) parts.push([new THREE.SphereGeometry(0.12, 6, 4).translate(x + 0.15, 0.2, z), rgb(0xffb3d0)]);
    }
  } else if (style === 'sea') {
    // 물가를 따라 하얀 파도 거품, 먼바다에는 물결
    for (const w of map.water) {
      const shoreZ = Math.abs(w.minZ) < Math.abs(w.maxZ) ? w.minZ : w.maxZ;
      for (let x = w.minX + 0.4; x < w.maxX - 0.4; x += 1.1) {
        const z = shoreZ + Math.sign(w.cz) * (0.3 + rnd() * 0.25);
        parts.push([new THREE.BoxGeometry(0.9 + rnd() * 0.5, 0.05, 0.22).translate(x, 0.13, z), [1.5, 1.6, 1.65]]);
      }
      for (let i = 0; i < w.w / 2.5; i++) {
        const [x, z] = spot(w, 1.4);
        parts.push([new THREE.BoxGeometry(1.2 + rnd(), 0.04, 0.12).translate(x, 0.13, z), rgb(0x5ab0d0)]);
      }
    }
  } else if (style === 'ice') {
    // 얼음 위의 금과 가장자리 눈
    for (let i = 0; i < 18; i++) {
      const [x, z] = spot(map.water[i % map.water.length]);
      parts.push([new THREE.BoxGeometry(1 + rnd() * 1.6, 0.03, 0.06).rotateY(rnd() * 3).translate(x, 0.12, z), rgb(0x7fb0d4)]);
    }
    for (const w of map.water) {
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2;
        const x = w.cx + Math.sin(a) * (w.w / 2);
        const z = w.cz + Math.cos(a) * (w.d / 2);
        parts.push([new THREE.SphereGeometry(0.55, 8, 5).scale(1.3, 0.35, 1).translate(Math.max(w.minX, Math.min(w.maxX, x)), 0.05, Math.max(w.minZ, Math.min(w.maxZ, z))), rgb(0xf4f8ff)]);
      }
    }
  } else if (style === 'toxic') {
    // 부글거리는 초록 거품과 녹슨 테두리
    for (const w of map.water) {
      for (let i = 0; i < 6; i++) {
        const [x, z] = spot(w, 0.5);
        parts.push([new THREE.SphereGeometry(0.1 + rnd() * 0.14, 6, 4).translate(x, 0.14, z), [0.7, 2.2, 0.4]]);
      }
      for (const sz of [-1, 1]) {
        parts.push([new THREE.BoxGeometry(w.w + 0.3, 0.3, 0.15).translate(w.cx, 0.15, w.cz + sz * (w.d / 2 + 0.05)), rgb(0x8a5a2a)]);
        parts.push([new THREE.BoxGeometry(0.15, 0.3, w.d + 0.3).translate(w.cx + sz * (w.w / 2 + 0.05), 0.15, w.cz), rgb(0x8a5a2a)]);
      }
    }
  }
  const mesh = new THREE.Mesh(merge(parts), material);
  mesh.frustumCulled = false;
  return mesh;
}

// 꾸밈(판정 없음): 가로등, 모닥불, 덤불, 눈더미, 조개, 파라솔, 고깔... 맵 전체를 메시 하나로 합친다.
// glows: 바닥에 번지는 불빛 위치 [x, z, 색, 반경] (어둠 속에서도 은은히 보인다)
const DECO = {
  campfire: (r) => {
    const p = [];
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      p.push([new THREE.IcosahedronGeometry(0.2, 0).translate(Math.sin(a) * 0.62, 0.12, Math.cos(a) * 0.62), vary(C.stone, i)]);
    }
    p.push([cylX(0.12, 1.0, 0, 0.15, 0).rotateY(0.6), C.logDark], [cylX(0.12, 1.0, 0, 0.18, 0).rotateY(-0.7), C.log]);
    p.push([cone(0.38, 0.9, 0, 0.6, 0, 6), C.fire], [cone(0.2, 0.6, 0.05, 0.5, 0.05, 6), C.fireCore]);
    return { p, glow: [0xff9a3a, 3.2] };
  },
  lamp: () => ({
    p: [
      [cylY(0.07, 2.6, 0, 1.3, 0, 6), C.black], [box(0.32, 0.4, 0.32, 0, 2.75, 0), C.glow], [cone(0.3, 0.25, 0, 3.06, 0, 4), C.black],
      [cylY(0.18, 0.12, 0, 0.06, 0, 8), C.black],
    ],
    glow: [0xffd58a, 2.6],
  }),
  torch: () => ({
    p: [[cylY(0.06, 1.6, 0, 0.8, 0, 6), C.palmTrunk], [cylY(0.14, 0.3, 0, 1.7, 0, 6, 0.18), C.strawDark], [cone(0.14, 0.42, 0, 2.05, 0, 6), C.fire]],
    glow: [0xff9a3a, 2.2],
  }),
  log: (r) => ({ p: [[cylX(0.22, 1.6, 0, 0.22, 0, 8).rotateY(r * 3), C.log], [cylX(0.18, 0.04, 0.8, 0.22, 0).rotateY(r * 3), C.logEnd]] }),
  bush: (r) => ({ p: [[ball(0.5, 1, 0.75, 1, 0, 0.35, 0), C.leafDark], [ball(0.4, 1, 0.8, 1, 0.38, 0.32, 0.15), C.leaf], [ball(0.32, 1, 0.8, 1, -0.3, 0.28, 0.25), C.leafLight]] }),
  stump: () => ({ p: [[cylY(0.36, 0.45, 0, 0.22, 0, 9, 0.32), C.logDark], [cylY(0.31, 0.03, 0, 0.46, 0, 9), C.logEnd]] }),
  flowers: (r) => {
    const p = [];
    const cols = [0xff9ab0, 0xfff3c4, 0xffd66b, 0xb8a0ff];
    for (let i = 0; i < 7; i++) {
      const x = Math.sin(i * 2.4) * 0.5;
      const z = Math.cos(i * 1.7) * 0.5;
      p.push([cylY(0.02, 0.3, x, 0.15, z, 4), C.leafDark], [ball(0.08, 1, 0.6, 1, x, 0.32, z), rgb(cols[(i + Math.round(r * 9)) % 4])]);
    }
    return { p };
  },
  chair: (r) => ({
    p: [
      [box(0.6, 0.06, 0.55, 0, 0.45, 0), C.tents[Math.round(r * 9) % 4]], [box(0.6, 0.55, 0.06, 0, 0.75, -0.27).rotateX(-0.2), C.tents[Math.round(r * 9) % 4]],
      [box(0.05, 0.45, 0.05, -0.27, 0.22, 0.24), C.black], [box(0.05, 0.45, 0.05, 0.27, 0.22, 0.24), C.black],
      [box(0.05, 0.45, 0.05, -0.27, 0.22, -0.24), C.black], [box(0.05, 0.45, 0.05, 0.27, 0.22, -0.24), C.black],
    ],
  }),
  bench: () => ({ p: [[box(1.6, 0.08, 0.45, 0, 0.45, 0), C.log], [box(1.6, 0.35, 0.06, 0, 0.75, -0.22), C.log], [box(0.08, 0.45, 0.4, -0.7, 0.22, 0), C.black], [box(0.08, 0.45, 0.4, 0.7, 0.22, 0), C.black]] }),
  mushroom: (r) => {
    const p = [];
    for (let i = 0; i < 3; i++) {
      const x = (i - 1) * 0.28;
      const h = 0.25 + (i % 2) * 0.15;
      p.push([cylY(0.06, h, x, h / 2, i * 0.1, 6), C.logEnd], [new THREE.SphereGeometry(0.17, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2).translate(x, h, i * 0.1), rgb(0xe0453a)]);
      p.push([ball(0.035, 1, 1, 1, x + 0.07, h + 0.12, i * 0.1 + 0.05), C.white]);
    }
    return { p, glow: [0x9affc0, 0.9] };
  },
  reeds: () => {
    const p = [];
    for (let i = 0; i < 6; i++) {
      const x = Math.sin(i * 2.1) * 0.35;
      const z = Math.cos(i * 1.3) * 0.35;
      p.push([cylY(0.025, 1.2, x, 0.6, z, 4), C.leaf], [cylY(0.06, 0.25, x, 1.2, z, 6), C.logDark]);
    }
    return { p };
  },
  snowpile: (r) => ({ p: [[ball(0.7, 1.2, 0.45, 1, 0, 0.1, 0), C.snow], [ball(0.45, 1, 0.6, 1, 0.5, 0.15, 0.3), C.snowShade]] }),
  sled: (r) => ({
    p: [[box(0.6, 0.06, 1.2, 0, 0.3, 0).rotateY(r * 3), C.red], [box(0.05, 0.05, 1.4, 0.25, 0.1, 0).rotateY(r * 3), C.steel], [box(0.05, 0.05, 1.4, -0.25, 0.1, 0).rotateY(r * 3), C.steel]],
  }),
  umbrella: (r) => {
    const c = C.boats[Math.round(r * 9) % 4];
    const p = [[cylY(0.04, 2.3, 0, 1.15, 0, 5), C.white]];
    for (let i = 0; i < 8; i++) p.push([new THREE.ConeGeometry(1.25, 0.5, 8, 1, true, (i * Math.PI) / 4, Math.PI / 4).translate(0, 2.3, 0), i % 2 ? C.white : c]);
    p.push([box(0.6, 0.05, 1.4, 0.9, 0.04, 0.3), c]); // 비치 타월
    return { p };
  },
  shell: (r) => ({
    p: [[new THREE.SphereGeometry(0.16, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.6, 1).translate(0, 0.02, 0), rgb(0xffd8c8)], [new THREE.ConeGeometry(0.12, 0.04, 5).translate(0.4, 0.03, 0.2), rgb(0xff8a5a)]],
  }),
  sandcastle: () => ({
    p: [[box(0.8, 0.35, 0.8, 0, 0.17, 0), C.sand], [cone(0.2, 0.5, -0.25, 0.6, -0.25, 6), C.sandDark], [cone(0.2, 0.5, 0.25, 0.6, 0.25, 6), C.sandDark], [cylY(0.22, 0.45, 0.25, 0.55, -0.25, 6), C.sand]],
  }),
  buoy: () => ({ p: [[ball(0.3, 1, 1, 1, 0, 0.3, 0), C.red], [cylY(0.31, 0.12, 0, 0.3, 0, 10), C.white]] }),
  cone: () => ({ p: [[box(0.5, 0.05, 0.5, 0, 0.025, 0), C.black], [cone(0.2, 0.65, 0, 0.35, 0, 8), rgb(0xff6a1a)], [cylY(0.13, 0.1, 0, 0.4, 0, 8), C.white]] }),
  pallet: (r) => {
    const p = [];
    for (let i = 0; i < 5; i++) p.push([box(1.2, 0.05, 0.18, 0, 0.17, -0.48 + i * 0.24), C.plank]);
    for (const z of [-0.45, 0, 0.45]) p.push([box(1.2, 0.12, 0.12, 0, 0.07, z), C.crateDark]);
    p.push([box(0.5, 0.4, 0.5, 0.2, 0.4, 0), C.crate]);
    return { p };
  },
  drum: (r) => ({ p: drum(0, 0, C.drums[Math.round(r * 9) % 4], 0.9) }),
  // 훈련장: 과녁, 깃발
  target: () => {
    const p = [[cylY(0.06, 1.6, -0.35, 0.8, -0.2, 5), C.logDark], [cylY(0.06, 1.6, 0.35, 0.8, -0.2, 5), C.logDark]];
    [[0.6, C.white], [0.46, C.red], [0.3, C.white], [0.14, C.red]].forEach(([r, c], j) => p.push([new THREE.CylinderGeometry(r, r, 0.08, 20).rotateX(Math.PI / 2 - 0.25).translate(0, 1.25, 0.02 * j), c]));
    p.push([cylX(0.02, 0.5, 0.15, 1.3, 0.25).rotateY(0.4), C.logDark]); // 꽂힌 화살
    return { p };
  },
  flag: (r) => ({
    p: [[cylY(0.05, 3, 0, 1.5, 0, 6), C.logDark], [box(0.9, 0.55, 0.03, 0.47, 2.65, 0), C.tents[Math.round(r * 9) % 4]], [ball(0.08, 1, 1, 1, 0, 3.02, 0), C.hazard]],
  }),
};
export function buildDeco(map, material) {
  const parts = [];
  const glows = [];
  for (const [x, z, kind] of map.deco || []) {
    const fn = DECO[kind];
    if (!fn) continue;
    const r = ((Math.abs(x) * 7.3 + Math.abs(z) * 3.1) % 10) / 10;
    const { p, glow } = fn(r);
    for (const [geo, c] of p) parts.push([geo.rotateY(r * 6).translate(x, 0, z), c]);
    if (glow) glows.push([x, z, ...glow]);
  }
  if (!parts.length) return { mesh: null, glows };
  const mesh = new THREE.Mesh(merge(parts), material);
  mesh.frustumCulled = false;
  return { mesh, glows };
}

// 아이템 모양 (바닥에서 떠서 빙글빙글 돈다)
export function buildItemGeos() {
  const Y = 0.75;
  return {
    heart: merge([
      [new THREE.SphereGeometry(0.22, 10, 8).translate(-0.15, Y + 0.1, 0), rgb(0xff4a5a)],
      [new THREE.SphereGeometry(0.22, 10, 8).translate(0.15, Y + 0.1, 0), rgb(0xff4a5a)],
      [new THREE.ConeGeometry(0.34, 0.45, 10).rotateX(Math.PI).scale(1, 1, 0.62).translate(0, Y - 0.17, 0), rgb(0xff4a5a)],
      [new THREE.SphereGeometry(0.06, 6, 4).translate(-0.2, Y + 0.2, 0.17), [3, 2.4, 2.4]],
    ]),
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
