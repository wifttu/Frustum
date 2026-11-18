// 이미지 생성 장면들 (tools/render-assets.mjs 가 브라우저에서 실행한다)
import * as THREE from 'three';
import { MAPS, MAP_SIZE, isFree } from '../shared/map.js';
import { CFG } from '../shared/config.js';
import { CHARACTER_KEYS } from '../shared/progress.js';
import { SKIN_ICONS } from '../shared/shop.js';
import { buildDeco, buildFloorTexture, buildWalls, buildWater } from '../world.js';
import { Characters, merge, rgb, shade } from '../character.js';
import { VisionMask } from '../fog.js';

const SS = 2; // 슈퍼샘플링 배율 (크게 그려서 줄인다 = 계단 현상 없음)
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
document.body.append(renderer.domElement);

// 크게 그린 결과를 줄여서 webp 로. post(g, w, h): 2D 후처리
function shoot(scene, camera, w, h, { alpha = false, post = null, quality = 0.9 } = {}) {
  renderer.setSize(w * SS, h * SS, false);
  renderer.setClearColor(0x000000, alpha ? 0 : 1);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.render(scene, camera);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  g.imageSmoothingQuality = 'high';
  g.drawImage(renderer.domElement, 0, 0, w, h);
  if (post) post(g, w, h);
  return c.toDataURL('image/webp', quality);
}

// ───────────────────────── 맵 미리보기 ─────────────────────────
// 시야 마스크 대신 "손전등이 비추는 곳" 을 그린 텍스처를 쓴다: 빛이 닿은 곳은 따뜻하게, 나머지는 달빛.
function maskTexture(lights, base) {
  const S = 512;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  g.fillStyle = `rgb(${base * 255},${base * 255},${base * 255})`;
  g.fillRect(0, 0, S, S);
  const px = (x) => (x / MAP_SIZE + 0.5) * S;
  const pz = (z) => (0.5 - z / MAP_SIZE) * S; // flipY
  g.filter = 'blur(5px)';
  for (const [x, z, yaw, range, arc] of lights) {
    const grd = g.createRadialGradient(px(x), pz(z), 0, px(x), pz(z), (range / MAP_SIZE) * S);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.75, 'rgba(255,255,255,.9)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.beginPath();
    // 캔버스 각도: 월드 yaw(+z 기준, x 쪽으로 돈다) → 화면에서 z 가 뒤집혀 있다
    const a = Math.PI / 2 - yaw;
    g.moveTo(px(x), pz(z));
    g.arc(px(x), pz(z), (range / MAP_SIZE) * S, -a - arc / 2 + Math.PI, -a + arc / 2 + Math.PI);
    g.closePath();
    g.fill();
    // 발밑은 항상 조금 밝다
    g.beginPath();
    g.arc(px(x), pz(z), (2.6 / MAP_SIZE) * S, 0, 7);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  return t;
}
function fakeMask(tex) {
  const m = Object.create(VisionMask.prototype);
  m.texture = tex;
  m.mapSize = MAP_SIZE;
  return m;
}
function freeNear(map, x, z) {
  for (let r = 0; r < 8; r += 0.5) {
    for (let a = 0; a < 6.28; a += 0.5) {
      const nx = x + Math.sin(a) * r;
      const nz = z + Math.cos(a) * r;
      if (isFree(nx, nz, 0.7, map.solid)) return [nx, nz];
    }
  }
  return [x, z];
}

// 맵별 구도: cam 카메라 위치, at 바라보는 곳, cast: [캐릭터, x, z, 바라볼 x, z, 빔]
const VIEWS = {
  camp: { cam: [17, 19, -19], at: [0, 0, 3], cast: [['explorer', 5.5, -5, -3, 6, 1], ['bear', -6, 7, 5, -4, 0], ['collector', 9, 4, 0, 12, 1]] },
  forest: { cam: [15, 18, -18], at: [3, 0, 6], cast: [['owl', 7.5, 0.8, 2, 11, 1], ['ninja', 2, 13, 9, 3, 0], ['runner', 12, 12, 5, 6, 1]] },
  lake: { cam: [-17, 17, -18], at: [0, 0, 4], cast: [['healer', -7, -8, 7, 8, 1], ['explorer', 7.5, 9, -3, -6, 1], ['bear', -10, 6, 0, 12, 0]] },
  winter: { cam: [16, 18, -18], at: [2, 0, 4], cast: [['bear', 6, -7, -2, 6, 1], ['explorer', -6.5, 8, 6, 2, 1], ['owl', 9, 9.5, 1, 14, 0]] },
  beach: { cam: [-6, 19, -6], at: [5, 0, 17], cast: [['runner', 9, 15, 12, 25, 1], ['collector', 4, 12, -4, 18, 1], ['ninja', 16, 18, 8, 10, 0]] },
  factory: { cam: [16, 18, -17], at: [3, 0, 6], cast: [['ninja', 6, -3, -1, 7, 1], ['runner', 4.5, 7.5, 11, 1, 1], ['healer', 13, 14, 5, 6, 0]] },
};

function mapScene(id) {
  const map = MAPS[id];
  const view = VIEWS[id];
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x0a0c18, 34, 70);
  const hemi = new THREE.HemisphereLight(map.look.sky, map.look.earth, 1.45);
  const sun = new THREE.DirectionalLight(map.look.sun, 1.25);
  sun.position.set(0.4, 1, 0.25);
  scene.add(hemi, sun);

  // 등장인물 자리와 손전등 빛
  const cast = view.cast.map(([char, x, z, tx, tz, beam]) => {
    const [fx, fz] = freeNear(map, x, z);
    return { char, x: fx, z: fz, yaw: Math.atan2(tx - fx, tz - fz), beam: !!beam };
  });
  const lights = cast.map((c) => [c.x, c.z, c.yaw, 17, CFG.FOV]);
  const mask = fakeMask(maskTexture(lights, 0.4));
  const dim = 0.42; // 빛이 안 닿은 곳의 달빛 밝기

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(MAP_SIZE, MAP_SIZE).rotateX(-Math.PI / 2),
    mask.apply(new THREE.MeshLambertMaterial({ map: buildFloorTexture(map, MAP_SIZE) }), dim),
  );
  scene.add(floor);
  const propMat = mask.apply(new THREE.MeshLambertMaterial({ color: 0xd8d8d8, vertexColors: true }), dim);
  for (const p of buildWalls(map.walls, propMat)) {
    p.mesh.visible = true;
    scene.add(p.mesh);
  }
  const water = buildWater(map, mask.apply(new THREE.MeshLambertMaterial({ color: 0xd8d8d8, vertexColors: true }), dim + 0.1));
  if (water) scene.add(water);
  const { mesh: deco, glows } = buildDeco(map, propMat);
  if (deco) scene.add(deco);
  // 불빛 웅덩이
  const glowMat = new THREE.MeshBasicMaterial({ map: radialTex(), vertexColors: true, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending });
  if (glows.length) {
    const parts = glows.map(([x, z, col, r]) => [new THREE.CircleGeometry(r, 20).rotateX(-Math.PI / 2).translate(x, 0.05, z), new THREE.Color(col).toArray()]);
    scene.add(new THREE.Mesh(merge(parts), glowMat));
  }

  // 캐릭터
  const chars = new Characters(mask);
  for (const c of cast) {
    const m = chars.make('self', c.char, false);
    m.position.set(c.x, 0, c.z);
    m.rotation.y = c.yaw;
    for (let i = 0; i < 12; i++) chars.animate(m, 0.1, i * 0.1, { beam: c.beam, roll: -1 });
    m.userData.ring.visible = false;
    scene.add(m);
  }
  // 경험치 보석 몇 개
  const gemMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, emissive: 0x404040 });
  const gemGlow = new THREE.MeshBasicMaterial({ map: radialTex(), vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  const gemParts = [];
  const glowParts = [];
  let seed = id.length * 97;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 14; i++) {
    const [x, z] = freeNear(map, view.at[0] + (rnd() - 0.5) * 26, view.at[2] + (rnd() - 0.5) * 22);
    const big = i % 5 === 0;
    const col = big ? 0xd56bff : i % 3 === 0 ? 0x3cf0a0 : 0xffe14a;
    const s = big ? 2 : i % 3 === 0 ? 1.35 : 0.9;
    gemParts.push([new THREE.OctahedronGeometry(0.17 * s, 0).scale(1, 1.45, 1).rotateY(rnd() * 3).translate(x, 0.7 + s * 0.1, z), rgb(col)]);
    glowParts.push([new THREE.PlaneGeometry(1.4 * s, 1.4 * s).rotateX(-Math.PI / 2).translate(x, 0.06, z), shade(rgb(col), 0.8)]);
  }
  scene.add(new THREE.Mesh(merge(gemParts), gemMat), new THREE.Mesh(merge(glowParts), gemGlow));

  const camera = new THREE.PerspectiveCamera(36, 16 / 9, 0.5, 200);
  camera.position.set(...view.cam);
  camera.lookAt(...view.at);
  return { scene, camera };
}

let radial = null;
function radialTex() {
  if (radial) return radial;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.4, 'rgba(255,255,255,.45)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  return (radial = new THREE.CanvasTexture(c));
}

// 가장자리를 어둡게, 살짝 대비를 올린다
function vignette(g, w, h) {
  const grd = g.createRadialGradient(w / 2, h * 0.45, h * 0.35, w / 2, h / 2, w * 0.62);
  grd.addColorStop(0, 'rgba(0,0,0,0)');
  grd.addColorStop(1, 'rgba(4,6,16,.62)');
  g.fillStyle = grd;
  g.fillRect(0, 0, w, h);
}

// ───────────────────────── 초상화 (캐릭터, 의상) ─────────────────────────
const portrait = (() => {
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xfff4e4, 0x5a5a7a, 1.2));
  const key = new THREE.DirectionalLight(0xfff0d8, 1.7);
  key.position.set(2.5, 4, 5);
  const rim = new THREE.DirectionalLight(0x9fd4ff, 1.6);
  rim.position.set(-4, 3, -4);
  scene.add(key, rim);
  const chars = new Characters({ apply: (m) => m });
  const camera = new THREE.PerspectiveCamera(24, 1, 0.1, 50);
  camera.position.set(0.85, 2.15, 4.3);
  camera.lookAt(0, 1.5, 0);
  return { scene, chars, camera };
})();
function shootPortrait(char, skin = 'default') {
  const { scene, chars, camera } = portrait;
  const m = chars.make('self', char, true, skin);
  m.rotation.y = 0.32;
  for (let i = 0; i < 12; i++) chars.animate(m, 0.1, 1 + i * 0.1, { roll: -1 });
  scene.add(m);
  const url = shoot(scene, camera, 256, 256, { alpha: true });
  scene.remove(m);
  return url;
}

// ───────────────────────── 프로필 아이콘 (기본 제공) ─────────────────────────
const ball = (r, sx, sy, sz, x, y, z, seg = 16) => new THREE.SphereGeometry(r, seg, Math.round(seg * 0.75)).scale(sx, sy, sz).translate(x, y, z);
const coneG = (r, h, x, y, z, seg = 12) => new THREE.ConeGeometry(r, h, seg).translate(x, y, z);
const EYE = rgb(0x1c1418);
const SHINE = [3, 3, 3];
// 동물 얼굴: 공통 눈·볼
function face(parts, { eyeY = 0.05, eyeX = 0.3, eyeZ = 0.9, cheek = 0xff9a9a, cheekY = -0.12 } = {}) {
  for (const s of [-1, 1]) {
    parts.push([ball(0.15, 1, 1.25, 0.6, s * eyeX, eyeY, eyeZ), EYE]);
    parts.push([ball(0.05, 1, 1, 1, s * eyeX + 0.05, eyeY + 0.07, eyeZ + 0.08), SHINE]);
    if (cheek) parts.push([ball(0.13, 1.3, 0.8, 0.4, s * 0.52, cheekY, eyeZ - 0.12), shade(rgb(cheek), 1)]);
  }
}
const ICON_MODELS = {
  fox() {
    const O = rgb(0xf08a3a), W = rgb(0xfff4e8), D = rgb(0x3a2418);
    const p = [[ball(1, 1.08, 0.92, 0.95, 0, 0, 0), O], [ball(0.62, 1.2, 0.7, 0.9, 0, -0.3, 0.42), W]];
    for (const s of [-1, 1]) {
      // 귀: 밑동 기준으로 만들어 기울인 뒤 머리 위에 붙인다
      const ear = (g) => g.rotateZ(-s * 0.38).translate(s * 0.55, 0.62, -0.05);
      p.push([ear(coneG(0.38, 0.85, 0, 0.42, 0)), O], [ear(coneG(0.21, 0.5, 0, 0.3, 0.14)), W], [ear(coneG(0.13, 0.27, 0, 0.73, 0)), D]);
    }
    p.push([ball(0.1, 1.3, 1, 1, 0, -0.18, 1.0), D]);
    face(p, { eyeY: 0.1, eyeZ: 0.9 });
    return p;
  },
  cat() {
    const G = rgb(0x9a9aa8), L = rgb(0xe8e4ec), P = rgb(0xff9ab0), D = rgb(0x6a6a78);
    const p = [[ball(1, 1.1, 0.92, 0.95, 0, 0, 0), G], [ball(0.5, 1.3, 0.7, 0.8, 0, -0.32, 0.55), L]];
    for (const s of [-1, 1]) {
      p.push([new THREE.ConeGeometry(0.38, 0.7, 4).rotateY(Math.PI / 4).rotateZ(-s * 0.3).translate(s * 0.62, 0.88, -0.05), G]);
      p.push([new THREE.ConeGeometry(0.22, 0.44, 4).rotateY(Math.PI / 4).rotateZ(-s * 0.3).translate(s * 0.6, 0.84, 0.12), P]);
      for (const k of [-1, 1]) p.push([new THREE.BoxGeometry(0.55, 0.025, 0.02).rotateZ(k * 0.12).translate(s * 0.75, -0.25 + k * 0.07, 0.75), D]);
    }
    for (let i = 0; i < 3; i++) p.push([new THREE.BoxGeometry(0.06, 0.25, 0.04).translate((i - 1) * 0.18, 0.78, 0.6), D]); // 이마 줄무늬
    p.push([coneG(0.08, 0.1, 0, -0.18, 1.0, 3).rotateX(Math.PI), P]);
    face(p, { eyeY: 0.08 });
    return p;
  },
  dog() {
    const B = rgb(0xd8a060), C = rgb(0xfff0dc), E = rgb(0x8a5a32), D = rgb(0x2a1a14);
    const p = [[ball(1, 1.05, 0.95, 0.95, 0, 0, 0), B], [ball(0.55, 1.25, 0.8, 1, 0, -0.32, 0.55), C]];
    for (const s of [-1, 1]) p.push([ball(0.42, 0.7, 1.35, 0.45, s * 0.98, -0.05, 0).rotateZ(s * 0.25), E]);
    p.push([ball(0.3, 1.2, 1, 0.5, -0.36, 0.2, 0.7), C]); // 눈가 반점
    p.push([ball(0.15, 1.3, 0.9, 1, 0, -0.15, 1.05), D], [ball(0.12, 1, 0.5, 0.7, 0, -0.55, 0.88), rgb(0xff7a8a)]);
    face(p, { eyeY: 0.12 });
    return p;
  },
  panda() {
    const W = rgb(0xfafaf6), K = rgb(0x26262c);
    const p = [[ball(1, 1.1, 0.95, 0.95, 0, 0, 0), W], [ball(0.45, 1.3, 0.75, 0.8, 0, -0.32, 0.55), W]];
    for (const s of [-1, 1]) {
      p.push([ball(0.32, 1, 1, 0.7, s * 0.72, 0.78, -0.05), K]);
      p.push([ball(0.24, 1, 1.35, 0.5, 0, 0, 0).rotateZ(s * 0.5).translate(s * 0.31, 0.06, 0.8), K]);
      p.push([ball(0.08, 1, 1, 1, s * 0.3, 0.1, 0.92), SHINE], [ball(0.05, 1, 1, 1, s * 0.3, 0.1, 0.98), EYE]);
      p.push([ball(0.12, 1.3, 0.8, 0.4, s * 0.55, -0.22, 0.75), rgb(0xffb0b8)]);
    }
    p.push([ball(0.12, 1.4, 0.9, 1, 0, -0.2, 0.98), K]);
    return p;
  },
  rabbit() {
    const W = rgb(0xfaf4f0), P = rgb(0xffa8c0);
    const p = [[ball(1, 1.05, 0.95, 0.95, 0, -0.15, 0), W], [ball(0.45, 1.3, 0.75, 0.8, 0, -0.45, 0.55), W]];
    for (const s of [-1, 1]) {
      p.push([ball(0.26, 1, 3.2, 0.6, s * 0.36, 1.25, -0.1).rotateZ(-s * 0.12), W]);
      p.push([ball(0.15, 1, 2.7, 0.4, s * 0.36, 1.25, 0.05).rotateZ(-s * 0.12), P]);
    }
    p.push([ball(0.09, 1.3, 0.8, 1, 0, -0.32, 0.96), P], [new THREE.BoxGeometry(0.16, 0.14, 0.05).translate(0, -0.55, 0.9), [2.6, 2.6, 2.6]]);
    face(p, { eyeY: -0.05 });
    return p;
  },
  hedgehog() {
    const S = rgb(0x6a4a32), F = rgb(0xf2d8b0), D = rgb(0x2a1a14);
    const p = [];
    for (let i = 0; i < 60; i++) {
      const y = 1 - (i / 59) * 1.7;
      const r = Math.sqrt(1 - y * y);
      const a = i * 2.39996;
      const v = new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r);
      if (v.z > 0.45 && v.y < 0.55) continue; // 얼굴 쪽은 비운다
      const spike = new THREE.ConeGeometry(0.16, 0.5, 5).translate(0, 1.12, 0);
      spike.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), v));
      p.push([spike, shade(S, 0.85 + (i % 3) * 0.12)]);
    }
    p.push([ball(1, 1.08, 0.92, 0.95, 0, 0, 0), S], [ball(0.78, 1.15, 0.95, 0.75, 0, -0.1, 0.38), F], [ball(0.34, 1.1, 0.8, 1, 0, -0.32, 0.85), F]);
    p.push([ball(0.11, 1.2, 1, 1, 0, -0.25, 1.17), D]);
    for (const s of [-1, 1]) p.push([ball(0.18, 1, 1, 0.6, s * 0.62, 0.55, 0.2), F]);
    face(p, { eyeY: 0.05, eyeZ: 0.95 });
    return p;
  },
  flashlight() {
    const K = rgb(0x2e3440), Y = rgb(0xf2c230), M = rgb(0xc8d0d8);
    const body = [
      [new THREE.CylinderGeometry(0.28, 0.28, 1.5, 20).translate(0, -0.2, 0), K],
      [new THREE.CylinderGeometry(0.3, 0.3, 0.22, 20).translate(0, 0.2, 0), Y],
      [new THREE.CylinderGeometry(0.3, 0.3, 0.12, 20).translate(0, -0.75, 0), Y],
      [new THREE.CylinderGeometry(0.5, 0.3, 0.55, 20).translate(0, 0.82, 0), M],
      [new THREE.CylinderGeometry(0.46, 0.46, 0.04, 20).translate(0, 1.1, 0), [3, 2.8, 1.9]],
      [new THREE.BoxGeometry(0.14, 0.24, 0.12).translate(0, 0.02, 0.28), rgb(0xe0453a)],
    ];
    return body.map(([g, c]) => [g.rotateZ(-0.9).translate(-0.35, -0.1, 0), c]);
  },
  star() {
    const s = new THREE.Shape();
    for (let i = 0; i < 10; i++) {
      const r = i % 2 ? 0.45 : 1.05;
      const a = (i / 10) * Math.PI * 2 + Math.PI / 2;
      i ? s.lineTo(Math.cos(a) * r, Math.sin(a) * r) : s.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    const g = new THREE.ExtrudeGeometry(s, { depth: 0.25, bevelEnabled: true, bevelThickness: 0.14, bevelSize: 0.1, bevelSegments: 2 }).translate(0, 0, -0.12);
    return [[g.rotateY(-0.35), rgb(0xffc83a)]];
  },
  moon() {
    const s = new THREE.Shape();
    // 두 원의 교점에서 정확히 이어지게 한다 (바깥 원 r=1, 안쪽 원 중심 0.42 r=0.78)
    const ix = (1 - 0.78 ** 2 + 0.42 ** 2) / (2 * 0.42);
    const iy = Math.sqrt(1 - ix * ix);
    const a1 = Math.atan2(iy, ix);
    const a2 = Math.atan2(iy, ix - 0.42);
    s.absarc(0, 0, 1, a1, Math.PI * 2 - a1, false);
    s.absarc(0.42, 0, 0.78, Math.PI * 2 - a2, a2, true);
    const g = new THREE.ExtrudeGeometry(s, { depth: 0.3, bevelEnabled: true, bevelThickness: 0.14, bevelSize: 0.08, bevelSegments: 3, curveSegments: 24 }).translate(-0.05, 0, -0.15);
    const p = [[g.rotateZ(-0.35).rotateY(-0.3), rgb(0xfff0a8)]];
    for (const [x, y, r] of [[0.75, 0.7, 0.1], [0.95, -0.15, 0.07], [0.55, -0.75, 0.08]]) p.push([new THREE.OctahedronGeometry(r, 0).translate(x, y, 0.2), [3, 2.8, 1.6]]);
    return p;
  },
};
// 맵 소품으로 만드는 아이콘
const PROP_ICONS = { tent: 'tent', tree: 'tree' };

const iconScene = (() => {
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xfff4e4, 0x5a5a7a, 1.25));
  const key = new THREE.DirectionalLight(0xfff0d8, 1.6);
  key.position.set(2, 3, 5);
  const rim = new THREE.DirectionalLight(0x9fd4ff, 1.2);
  rim.position.set(-4, 2, -3);
  scene.add(key, rim);
  return scene;
})();
const iconMat = new THREE.MeshLambertMaterial({ vertexColors: true });
// 물체를 화면 가운데에 꽉 차게 둔다
function frame(obj, camera, fill = 0.78) {
  const box = new THREE.Box3().setFromObject(obj);
  const sphere = box.getBoundingSphere(new THREE.Sphere());
  const size = box.getSize(new THREE.Vector3());
  // 화면에 보이는 크기(가로·세로) 기준으로 맞춘다 (상자 대각선 기준이면 너무 작아진다)
  const r = Math.max(size.x, size.y, size.z * 0.7) / 2;
  const dist = r / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) / fill + size.z / 2;
  const dir = camera.userData.dir || new THREE.Vector3(0, 0.25, 1).normalize();
  camera.position.copy(sphere.center).addScaledVector(dir, dist);
  camera.lookAt(sphere.center);
  camera.near = dist / 10;
  camera.far = dist * 10;
}
function shootIcon(name) {
  let obj;
  const camera = new THREE.PerspectiveCamera(26, 1, 0.1, 100);
  if (ICON_MODELS[name]) {
    obj = new THREE.Mesh(merge(ICON_MODELS[name]()), iconMat);
    if (['fox', 'cat', 'dog', 'panda', 'rabbit', 'hedgehog'].includes(name)) obj.rotation.y = 0.28;
  } else if (name === 'campfire') {
    obj = buildDeco({ deco: [[0, 0, 'campfire']] }, iconMat).mesh;
    camera.userData.dir = new THREE.Vector3(0.3, 0.75, 1).normalize();
  } else {
    const w = { tent: [3, 3], tree: [1.6, 1.6] }[name];
    const wall = { cx: 0, cz: 0, w: w[0], d: w[1], kind: PROP_ICONS[name], minX: -w[0] / 2, maxX: w[0] / 2, minZ: -w[1] / 2, maxZ: w[1] / 2 };
    obj = buildWalls([wall], iconMat)[0].mesh;
    obj.visible = true;
    camera.userData.dir = new THREE.Vector3(0.35, 0.45, 1).normalize();
  }
  iconScene.add(obj);
  frame(obj, camera, name === 'campfire' ? 0.9 : 0.8);
  const url = shoot(iconScene, camera, 192, 192, { alpha: true });
  iconScene.remove(obj);
  return url;
}

// 프로필 아이콘 (이모지 → 이름). client/icons.js 와 같은 목록
const FREE = { '🔦': 'flashlight', '🏕️': 'tent', '🌲': 'tree', '🔥': 'campfire', '🌙': 'moon', '⭐': 'star', '🦊': 'fox', '🐱': 'cat', '🐶': 'dog', '🐼': 'panda', '🐰': 'rabbit', '🦔': 'hedgehog' };

window.renderAll = async (only = '') => {
  const out = {};
  const want = (k) => !only || k.startsWith(only);
  const thumbs = {};
  for (const id of Object.keys(MAPS)) {
    if (!want(`maps/${id}`)) continue;
    const { scene, camera } = mapScene(id);
    out[`maps/${id}`] = thumbs[id] = shoot(scene, camera, 512, 288, { post: vignette, quality: 0.86 });
  }
  // 순환: 맵 6개를 비스듬히 이어 붙인 그림
  if (want('maps/auto') && Object.keys(thumbs).length === Object.keys(MAPS).length) {
    const c = document.createElement('canvas');
    c.width = 512;
    c.height = 288;
    const g = c.getContext('2d');
    const ids = Object.keys(MAPS);
    const imgs = await Promise.all(ids.map((id) => new Promise((ok) => { const im = new Image(); im.onload = () => ok(im); im.src = thumbs[id]; })));
    const n = imgs.length;
    const slant = 40;
    imgs.forEach((im, i) => {
      const x0 = (i / n) * (512 + slant) - slant;
      const x1 = ((i + 1) / n) * (512 + slant) - slant;
      g.save();
      g.beginPath();
      g.moveTo(x0 + slant, 0);
      g.lineTo(x1 + slant, 0);
      g.lineTo(x1, 288);
      g.lineTo(x0, 288);
      g.closePath();
      g.clip();
      const cx = (x0 + x1 + slant) / 2;
      g.drawImage(im, cx - 256 * 0.75, 144 - 144 * 1.0, 512 * 0.75 * 1.33, 288 * 1.33);
      g.restore();
      g.strokeStyle = 'rgba(255,230,160,.85)';
      g.lineWidth = 3;
      g.beginPath();
      g.moveTo(x1 + slant, 0);
      g.lineTo(x1, 288);
      g.stroke();
    });
    vignette(g, 512, 288);
    out['maps/auto'] = c.toDataURL('image/webp', 0.86);
  }
  for (const id of CHARACTER_KEYS) if (want(`chars/${id}`)) out[`chars/${id}`] = shootPortrait(id);
  for (const id of Object.keys(SKIN_ICONS)) if (want(`skins/${id}`)) out[`skins/${id}`] = shootPortrait('explorer', id);
  for (const name of Object.values(FREE)) if (want(`icons/${name}`)) out[`icons/${name}`] = shootIcon(name);
  return out;
};
