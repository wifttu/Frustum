import * as THREE from 'three';
import { CFG, FLARE_VIEW, ITEMS, RULES, SCAN_VIEW, ZONE } from './shared/config.js';
import { MAP_SIZE, MAPS } from './shared/map.js';
import { stepPlayer } from './shared/sim.js';
import { wrapAngle } from './shared/vision.js';
import { VisionMask } from './fog.js';
import { Input } from './input.js';
import { Music, Sfx } from './audio.js';
import { DEFAULT_SERVER, normalizeServer } from './settings.js';
import { prefs, savePrefs } from './prefs.js';
import { decodeBackup, encodeBackup } from './shared/backup.js';
import {
  ACHIEVEMENTS, DAILY_POOL, RANKS, achState, applyRank, claimAch, claimDaily as claimMission, ensureDaily, hasClaimable, rankDelta, rankOf as tierOf, record,
  seasonDaysLeft, seasonRollover,
} from './shared/missions.js';
import { CHARACTERS, ORBS, PROGRESS, SKILLS, UPGRADES, charOf, orbTier, statsOf, xpToNext } from './shared/progress.js';
import { Characters, DeathFx, growOf, merge } from './character.js';
import { SkillFx } from './skillfx.js';
import { TUTOR_REWARD, Tutorial, pickSpots } from './tutorial.js';
import { charImg, iconText, imgEl, itemImg, mapImg, setIcon, skillImg, skinImg, srcText, upImg } from './icons.js';
import { Minimap } from './minimap.js';
import { buildDeco, buildFloorTexture, buildItemGeos, buildWalls, buildWater } from './world.js';
import { Showcase, radarOf } from './showcase.js';
import { Net } from './net.js';
import { initParty } from './party.js';
import { DAILY, GACHA, SKINS, TIERS, claimDaily, dayKey, gacha, iconsFor, normalizeProfile, skinOf } from './shared/shop.js';

const DT = 1 / CFG.TICK_RATE;
const INTERP_MS = 110; // 원격 플레이어 보간 지연
const $ = (id) => document.getElementById(id);
const lerp = (a, b, t) => a + (b - a) * t;
const lerpAngle = (a, b, t) => a + wrapAngle(b - a) * t;

// ───────────────────────── 렌더러 (모바일 우선 설정) ─────────────────────────
const canvas = $('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
renderer.setClearColor(0x000000, 1);
renderer.info.autoReset = false;
// 그래픽 품질: 해상도 상한, 고정 배율, 꾸밈·흙먼지 표시. auto 는 프레임에 맞춰 해상도를 스스로 조절한다.
const QUALITY = {
  auto: { cap: 2, adaptive: true },
  low: { cap: 1, scale: 0.8, deco: false, dust: false },
  mid: { cap: 1.5, scale: 1 },
  high: { cap: 2, scale: 1 },
};
const qual = () => QUALITY[prefs.quality] || QUALITY.auto;
let BASE_PR = Math.min(devicePixelRatio || 1, qual().cap);
let resScale = qual().scale ?? 1;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(55, 1, 0.5, 120);
// 따뜻한 손전등/모닥불 톤의 조명
const hemi = new THREE.HemisphereLight(0xfff0d8, 0x6b5a45, 1.45);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff2dc, 1.25);
sun.position.set(0.4, 1, 0.25);
scene.add(sun);

let curMap = MAPS.camp; // 현재 맵 (라운드마다 바뀐다)
const mask = new VisionMask(MAP_SIZE, curMap.walls, CFG);
const sfx = new Sfx();

// 바닥: 잔디와 흙길. 시야 밖에서는 달빛 아래처럼 아주 희미하게만 보인다(지형 정보만, 플레이어 정보 없음)
const floorMat = mask.apply(new THREE.MeshLambertMaterial({ map: buildFloorTexture(curMap, MAP_SIZE) }), 0.09);
scene.add(new THREE.Mesh(new THREE.PlaneGeometry(MAP_SIZE, MAP_SIZE).rotateX(-Math.PI / 2), floorMat));

// 독구름: 안전 구역(정사각형) 바깥을 덮는 초록 안개. 시야와 무관하게 항상 보인다.
// 높이가 다른 두 장을 겹쳐 위에서 볼 때 부피감이 나게 한다 (드로우콜 2회, 텍스처 없음).
const gasMat = new THREE.ShaderMaterial({
  transparent: true,
  depthWrite: false,
  uniforms: { uHalf: { value: 999 }, uTime: { value: 0 } },
  vertexShader: /* glsl */ `
    varying vec2 vW;
    void main() {
      vec4 w = modelMatrix * vec4(position, 1.0);
      vW = w.xz;
      gl_Position = projectionMatrix * viewMatrix * w;
    }`,
  fragmentShader: /* glsl */ `
    uniform float uHalf;
    uniform float uTime;
    varying vec2 vW;
    float n(vec2 p) { return sin(p.x) * sin(p.y); }
    void main() {
      // 구역 경계까지의 거리(밖이 양수). 경계가 일렁이게 한다.
      float d = max(abs(vW.x), abs(vW.y)) - uHalf;
      d += 0.6 * n(vW * 0.7 + vec2(uTime * 1.3, -uTime * 1.1));
      if (d < 0.0) discard;
      float puff = 0.5 + 0.25 * n(vW * 0.45 + vec2(uTime * 0.5, uTime * 0.3)) + 0.25 * n(vW * 1.1 - vec2(uTime * 0.4, -uTime * 0.6));
      float edge = exp(-d * 1.2);
      float a = (0.22 + 0.25 * smoothstep(0.0, 6.0, d)) * (0.6 + 0.6 * puff) + edge * 0.4;
      vec3 col = mix(vec3(0.2, 0.62, 0.16), vec3(0.7, 1.0, 0.35), edge) * (0.55 + 0.45 * puff);
      gl_FragColor = vec4(col, clamp(a, 0.0, 0.8));
    }`,
});
const gasLayers = [0.08, 1.7].map((y) => {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(MAP_SIZE + 60, MAP_SIZE + 60).rotateX(-Math.PI / 2), gasMat);
  m.position.y = y;
  m.frustumCulled = false;
  m.renderOrder = 5;
  m.visible = false;
  scene.add(m);
  return m;
});

// 벽(캠핑장 소품): 벽마다 메시 하나. 매 프레임 "시야에 걸렸고 화면 안에 있는" 것만 그린다.
const propMat = mask.apply(new THREE.MeshLambertMaterial({ color: 0xd8d8d8, vertexColors: true }));
const waterMat = mask.apply(new THREE.MeshLambertMaterial({ color: 0xd8d8d8, vertexColors: true }), 0.12);
let wallProps = buildWalls(curMap.walls, propMat);
for (const p of wallProps) scene.add(p.mesh);
let waterMesh = null;

// 꾸밈(가로등, 모닥불, 눈더미...)과 맵마다 다른 조명 색. 불빛은 어둠 속에서도 바닥에 은은히 번진다.
const glowTex = (() => {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.4, 'rgba(255,255,255,.45)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
})();
const glowMat = new THREE.MeshBasicMaterial({ map: glowTex, vertexColors: true, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending });
let decoMesh = null;
let glowMesh = null;
function buildScenery() {
  for (const m of [decoMesh, glowMesh]) {
    if (!m) continue;
    scene.remove(m);
    m.geometry.dispose();
  }
  const { mesh, glows } = buildDeco(curMap, propMat);
  decoMesh = mesh;
  if (decoMesh) scene.add(decoMesh);
  glowMesh = null;
  if (glows.length) {
    const parts = glows.map(([x, z, col, r]) => [new THREE.CircleGeometry(r, 20).rotateX(-Math.PI / 2).translate(x, 0.05, z), new THREE.Color(col).toArray()]);
    glowMesh = new THREE.Mesh(merge(parts), glowMat);
    glowMesh.frustumCulled = false;
    glowMesh.renderOrder = 2;
    scene.add(glowMesh);
  }
  if (decoMesh) decoMesh.visible = qual().deco !== false;
  if (glowMesh) glowMesh.visible = qual().deco !== false;
  hemi.color.setHex(curMap.look.sky);
  hemi.groundColor.setHex(curMap.look.earth);
  sun.color.setHex(curMap.look.sun);
}
buildScenery();

// 맵 교체: 소품, 바닥, 물, 시야 마스크, 미니맵을 새 맵으로 다시 만든다
// 라운드 시작: 맵 미리보기 카드가 잠깐 떴다가 사라진다
let introTimer = 0;
function showMapIntro(id) {
  const map = MAPS[id];
  if (!map) return;
  const el = $('mapIntro');
  el.querySelector('img').src = mapImg(id);
  el.querySelector('b').textContent = map.name;
  el.hidden = false;
  el.classList.remove('show');
  void el.offsetWidth;
  el.classList.add('show');
  clearTimeout(introTimer);
  introTimer = setTimeout(() => (el.hidden = true), 2600);
}
function setMap(id) {
  const next = MAPS[id];
  if (!next || next === curMap) return;
  curMap = next;
  for (const p of wallProps) {
    scene.remove(p.mesh);
    p.mesh.geometry.dispose();
  }
  wallProps = buildWalls(curMap.walls, propMat);
  for (const p of wallProps) scene.add(p.mesh);
  if (waterMesh) {
    scene.remove(waterMesh);
    waterMesh.geometry.dispose();
  }
  waterMesh = buildWater(curMap, waterMat);
  if (waterMesh) scene.add(waterMesh);
  buildScenery();
  floorMat.map.dispose();
  floorMat.map = buildFloorTexture(curMap, MAP_SIZE);
  floorMat.needsUpdate = true;
  mask.setWalls(curMap.walls);
  minimap.setMap(curMap);
  for (const m of itemMeshes.values()) scene.remove(m);
  itemMeshes.clear();
}

// 아이템 메시: 서버가 보내준(= 시야 안의) 아이템만 존재한다
const itemGeos = buildItemGeos();
const itemMat = mask.apply(new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: true }));
const itemGlowGeo = new THREE.CircleGeometry(0.6, 20).rotateX(-Math.PI / 2).translate(0, 0.04, 0);
const itemGlowMat = mask.apply(
  new THREE.MeshBasicMaterial({ color: 0xffd25a, transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending }),
);
const itemMeshes = new Map(); // id → Group
let itemsSeen = []; // [id, type, x, z]
function syncItems(list) {
  itemsSeen = list;
  const keep = new Set();
  for (const [id, type, x, z] of list) {
    keep.add(id);
    let g = itemMeshes.get(id);
    if (!g) {
      g = new THREE.Group();
      const body = new THREE.Mesh(itemGeos[type], itemMat);
      g.add(body, new THREE.Mesh(itemGlowGeo, itemGlowMat));
      g.userData.body = body;
      g.userData.seed = id * 1.7;
      g.position.set(x, 0, z);
      g.traverse((o) => (o.frustumCulled = false));
      scene.add(g);
      itemMeshes.set(id, g);
    }
  }
  for (const [id, g] of itemMeshes) {
    if (keep.has(id)) continue;
    scene.remove(g);
    itemMeshes.delete(id);
  }
}

// 캐릭터(모델 + 애니메이션)와 처치 이펙트
const chars = new Characters(mask);
const deathFx = new DeathFx(scene);
const skillFx = new SkillFx(scene);

// 흙먼지: 달리거나 구를 때 발밑에서 피어오른다 (InstancedMesh 하나, 시야 밖은 마스크로 가려진다)
const DUST_N = 96;
const dustMesh = new THREE.InstancedMesh(
  new THREE.IcosahedronGeometry(0.16, 0),
  mask.apply(new THREE.MeshLambertMaterial({ color: 0xcdb48a, transparent: true, opacity: 0.55, depthWrite: false })),
  DUST_N,
);
dustMesh.frustumCulled = false;
dustMesh.count = 0;
scene.add(dustMesh);
const dust = Array.from({ length: DUST_N }, () => ({ t: 1, x: 0, y: 0, z: 0, vx: 0, vz: 0, s: 1 }));
let dustNext = 0;
const dustMat = new THREE.Matrix4();
function puff(x, z, n = 1, spread = 0.25, big = 1) {
  for (let k = 0; k < n; k++) {
    const d = dust[dustNext];
    dustNext = (dustNext + 1) % DUST_N;
    const a = Math.random() * Math.PI * 2;
    Object.assign(d, {
      t: 0, x: x + Math.cos(a) * spread, y: 0.08, z: z + Math.sin(a) * spread,
      vx: Math.cos(a) * 0.6, vz: Math.sin(a) * 0.6, s: (0.6 + Math.random() * 0.6) * big,
    });
  }
}
// 움직이는 캐릭터마다 일정 간격으로 먼지를 낸다
function dustFor(mesh, dt, rolling) {
  const u = mesh.userData;
  if (!mesh.visible || qual().dust === false) return;
  u.dustT = (u.dustT || 0) - dt;
  if (u.dustT > 0) return;
  if (rolling) {
    puff(mesh.position.x, mesh.position.z, 2, 0.3, 1.3);
    u.dustT = 0.05;
  } else if ((u.speed || 0) > 3) {
    puff(mesh.position.x, mesh.position.z, 1, 0.2, (u.speed || 0) > 6.5 ? 1.2 : 0.9);
    u.dustT = (u.speed || 0) > 6.5 ? 0.07 : 0.16;
  }
}
function drawDust(dt) {
  let n = 0;
  for (const d of dust) {
    if (d.t >= 1) continue;
    d.t = Math.min(1, d.t + dt / 0.6);
    d.x += d.vx * dt;
    d.z += d.vz * dt;
    d.y += dt * 0.5;
    const k = d.s * (0.5 + d.t * 1.2) * (1 - d.t * d.t);
    dustMat.makeScale(k, k * 0.7, k).setPosition(d.x, d.y, d.z);
    dustMesh.setMatrixAt(n++, dustMat);
  }
  dustMesh.count = n;
  dustMesh.instanceMatrix.needsUpdate = true;
}
const makePlayerMesh = (kind, char, skin) => chars.make(kind, charOf(char), false, skinOf(skin));
const setKind = (mesh, kind, char, skin) => chars.setKind(mesh, kind, charOf(char), skinOf(skin));

const geo = {
  flare: new THREE.SphereGeometry(0.16, 8, 6).translate(0, 0.16, 0),
  glow: new THREE.CircleGeometry(1.2, 20).rotateX(-Math.PI / 2).translate(0, 0.03, 0),
};
const mat = {
  flare: new THREE.MeshBasicMaterial({ color: 0xffb070 }),
  glow: new THREE.MeshBasicMaterial({ color: 0x3c1c08, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }),
};

// 조명탄 메시 풀
const flareMeshes = [];
function flareMesh(i) {
  while (flareMeshes.length <= i) {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(geo.flare, mat.flare), new THREE.Mesh(geo.glow, mat.glow));
    g.traverse((o) => (o.frustumCulled = false));
    g.visible = false;
    scene.add(g);
    flareMeshes.push(g);
  }
  return flareMeshes[i];
}

// ───────────────────────── 상태 ─────────────────────────
let party = null; // 친선 게임 방 (아래에서 만든다)
let offline = null; // 오프라인 모드: 브라우저 안에서 서버 로직을 직접 실행 { game, player }
let myId = 0;
let myTeam = 0;
let seq = 0;
let alive = false;
let everAlive = false;
let mode = 'duo';
let rule = 'survival';
let target = 0; // 점수제 목표 킬
let roundTime = CFG.ROUND_TIME;
let respawnIn = 0;
let zoneTarget = 0; // 서버가 알려준 안전 구역 절반 길이 (0 = 독구름 없음)
let zoneNow = 0; // 화면용으로 부드럽게 따라가는 값
let gas = 0; // 독구름 노출 시간
let gasSfxT = 0;
let roundLeft = 0;
let snapNext = false; // 새 라운드: 다음 스냅샷 위치로 순간이동
let localCd = 0;
let localBeam = 0;
let flareCd = 0;
let killedBy = '';
let watchId = 0; // 쓰러진 동안 보고 있는 플레이어 (서버가 정한다)
const camFocus = { x: 0, z: 0, yaw: 0, init: false }; // 카메라가 따라가는 곳 (관전 대상으로 부드럽게 옮겨 간다)
let roundStart = { earned: 0, coins: 0 }; // 판이 시작될 때의 경험치·코인 (결과 화면에서 차이를 보여준다)
let streak = 0; // 죽지 않고 이어간 처치 수
let lastCount = 0; // 라운드 시작 카운트다운 표시용
let winnerText = '';
let shake = 0; // 화면 흔들림 세기
let mapT = 0;
let cricketT = 2;
let roundEnd = 0; // 라운드 종료 배너 남은 시간
let stepT = 0;
let lastSpot = 0;
const sim = { x: 0, z: 0, yaw: 0, rollT: 0, rollCd: 0, rollDx: 0, rollDz: 1, speedT: 0, dashT: 0, skill: 'roll' }; // 예측된 내 상태
const buffs = { vest: 0, cloak: 0, shield: 0, scan: 0 }; // 서버가 알려준 내 버프 남은 시간
const prev = { x: 0, z: 0, yaw: 0 };
const view = { x: 0, z: 0, yaw: 0 }; // 렌더용 보간 상태
const pending = []; // 서버가 아직 확인하지 않은 입력
const roster = new Map(); // id → {name, team, score}  (위치 정보 없음)
// 서버가 보내준(= 시야 안의) 플레이어만 존재한다. 시야에서 벗어나면 즉시 삭제.
// 로비에서 고른 것: 온라인 여부, 친구 방 코드, 맵('' = 순환)
const lobby = { online: false, room: '', map: '' };
const ents = new Map();
// 내 성장 상태 (서버가 바뀔 때마다 't:st' 로 알려준다)
const prog = { hp: PROGRESS.BASE_HP, xp: 0, level: 1, next: xpToNext(1), ups: {}, choices: null, more: 0, stats: statsOf({}, CFG), earned: 0 };
let fireflies = []; // [id, x, z]
let flares = []; // 우리 팀 조명탄 [x, z, 남은 시간]
let snapCount = 0;

const selfMesh = makePlayerMesh('self');
selfMesh.visible = false;
scene.add(selfMesh);

const input = new Input({
  surface: canvas, stick: $('stick'), knob: $('knob'),
  attackBtn: $('attack'), rollBtn: $('roll'), flareBtn: $('flare'),
});

// 모바일은 터치 이후에만 소리를 낼 수 있다
addEventListener('pointerdown', () => sfx.unlock(), { capture: true });
addEventListener('keydown', () => sfx.unlock(), { capture: true });
const drawMute = () => ($('mute').textContent = sfx.muted ? '🔇' : '🔊');
drawMute();
$('mute').addEventListener('pointerdown', (e) => {
  e.preventDefault();
  e.stopPropagation();
  sfx.unlock();
  sfx.setMuted(!sfx.muted);
  drawMute();
});

// 소리 위치: 내 화면 기준 좌우(pan)와 거리 감쇠
function spatial(x, z) {
  const dx = x - view.x;
  const dz = z - view.z;
  const d = Math.hypot(dx, dz);
  const s = Math.sin(view.yaw);
  const c = Math.cos(view.yaw);
  const pan = d > 0.5 ? (-c * dx + s * dz) / d : 0;
  return [Math.max(0.15, 1 - d / 24), pan * 0.8];
}

// ───────────────────────── 네트워크 ─────────────────────────
const params = new URLSearchParams(location.search);
const STATIC_HOST = location.hostname.endsWith('github.io');
// ?server= > (정적 호스팅이면 settings.js 의 기본 서버) > 페이지를 서빙한 서버
// 우선순위: 주소의 ?server= > 설정에서 넣은 주소 > (정적 호스팅이면) 기본 서버 > 페이지를 서빙한 서버
const remote = () => normalizeServer(params.get('server')) || normalizeServer(prefs.server) || (STATIC_HOST ? normalizeServer(DEFAULT_SERVER) : '');
function serverBase() {
  const REMOTE = remote();
  if (!REMOTE) return `${location.protocol}//${location.host}`;
  const u = REMOTE.replace(/\/$/, '');
  return /^(https?|wss?):\/\//.test(u) ? u.replace(/^ws/, 'http') : `https://${u}`;
}
const wsUrl = () => serverBase().replace(/^http/, 'ws') + '/ws';

// 서버 연결: 로비에서부터 유지해 친선 방, 친구 접속 상태, 초대를 주고받는다
const NET_TEXT = {
  connecting: '서버에 연결 중…',
  waking: '서버를 깨우는 중… (무료 서버는 최대 1분)',
  open: '',
  failed: '서버에 접속할 수 없어요. 혼자 하기(봇전)는 서버 없이 됩니다.',
};
const net = new Net({
  url: wsUrl,
  health: () => serverBase() + '/healthz',
  onMessage: (m) => {
    if (!party?.handle(m)) onMessage(m);
  },
  onState: (state) => {
    if (state in NET_TEXT) $('status').textContent = NET_TEXT[state];
    if (state === 'closed' && myId && !offline) showMenu('서버와 연결이 끊겼습니다.');
    party?.onNetState(state);
  },
});

function showMenu(msg) {
  if (party?.active) party.showRoom();
  else enterLobby();
  $('hud').hidden = true;
  $('status').textContent = msg;
  myId = 0;
  alive = false;
  roundEnd = 0;
  flares = [];
  fireflies = [];
  prog.choices = null;
  $('choices').hidden = true;
  zoneTarget = 0;
  gas = 0;
  pending.length = 0;
  $('banner').hidden = true;
  for (const id of [...ents.keys()]) removeEnt(id);
}

async function connect(name, gameMode, gameRule) {
  if (STATIC_HOST && !remote()) {
    $('status').textContent = '온라인 서버 주소가 설정되지 않았습니다. 혼자 하기는 서버 없이 됩니다.';
    return;
  }
  if (!(await net.open())) return;
  sendHello();
  net.send({ t: 'j', n: name, m: gameMode, r: gameRule, c: profile.char, s: profile.skin, map: lobby.map, ch: cheatPayload() });
}

// 내 프로필을 서버에 알린다 (친구 접속 상태, 방 화면에 쓰인다)
function sendHello() {
  net.send({ t: 'hi', n: $('name').value.trim() || 'Player', c: profile.char, s: profile.skin, i: profile.icon, fc: profile.fc, ch: cheatPayload() });
}

// 치트 모드 (설정) → 서버/오프라인 게임에 보내는 값
function cheatPayload() {
  if (!prefs.cheat) return null;
  return { god: prefs.cheatGod, xp: prefs.cheatXp, cd: prefs.cheatCd, speed: prefs.cheatSpeed };
}

// 오프라인(혼자 하기): 서버와 같은 Game 클래스를 브라우저에서 실행한다. 메시지 형식도 같아서 아래 코드는 구분하지 않는다.
async function startOffline(name, gameMode, gameRule) {
  $('status').textContent = '불러오는 중…';
  const { Game } = await import('./server/game.js');
  const game = new Game({ mode: gameMode, rule: gameRule, ...(lobby.map ? { map: lobby.map, FIXED_MAP: true } : {}) });
  game.balanceBots();
  const player = game.addPlayer(name, (msg) => onMessage(JSON.parse(msg)), false, profile.char, profile.skin, { cheat: cheatPayload() }); // 봇 한 자리를 이어받는다
  offline = { game, player };
  onMessage({ t: 'w', id: player.id, team: player.team, ...game.info() });
}

// ── 관전 ── 쓰러진 동안: 데스매치는 나를 잡은 상대(킬캠), 서바이벌은 살아 있는 팀원부터
let watchKey = '';
function drawWatch(watching) {
  const on = !!watching && !!myId && roundEnd <= 0;
  const key = on ? `${watchId}|${killedBy}` : '';
  $('dead').classList.toggle('watching', on);
  if (key === watchKey) return;
  watchKey = key;
  $('watchBar').hidden = !on;
  if (!on) return;
  const r = roster.get(watchId);
  const who = r?.name ?? '';
  $('watchName').textContent = who === killedBy ? `${who} (나를 잡은 상대)` : r?.team === myTeam ? `${who} (팀원)` : who;
  $('watchNext').hidden = !!RULES[rule]?.respawn; // 부활을 기다리는 동안은 킬캠만
}
$('watchNext').addEventListener('pointerdown', (e) => {
  e.preventDefault();
  e.stopPropagation();
  if (offline) offline.game.cycleWatch(offline.player);
  else net.send({ t: 'wn' });
  sfx.choose();
});

// ── 미션 · 업적 · 랭크 ── (치트 모드, 연습 중에는 기록하지 않는다)
const tracking = () => !tutor && !prefs.cheat && !!myId;
function track(ev, n = 1) {
  if (!tracking() || !(n > 0)) return;
  for (const d of record(profile, ev, n)) toast('미션 완료! 🎯', `${d.text} · 로비에서 🪙 ${d.coins} 받기`, 'buff');
  saveProfile();
}
// 판이 끝났을 때: 판 수·승리·1등을 기록하고 순위로 랭크 점수를 바꾼다
function roundRank(won, me) {
  if (!tracking() || !me) return null;
  track('round');
  if (won) track('win');
  const rows = [...roster.entries()].sort((a, b) => pointsOf(b[1]) - pointsOf(a[1]));
  const place = rows.findIndex(([id]) => id === myId) + 1;
  if (place === 1) track('top');
  const r = applyRank(profile, rankDelta(place, rows.length, me.score || 0, !offline));
  saveProfile();
  if (r.up) setTimeout(() => toast('승급! 🏅', `${r.after.name} 등급이 됐어요`, 'buff'), 900);
  return r;
}
let missionTab = 'daily';
function drawRankBadge() {
  const r = tierOf(profile.rank.rp);
  const el = $('rankBadge');
  el.textContent = `🏅 ${r.name} ${profile.rank.rp}`;
  el.style.setProperty('--rc', r.color);
  $('openMissions').classList.toggle('hasNew', hasClaimable(profile));
}
function missionRow(icon, title, sub, n, goal, btn) {
  const row = document.createElement('div');
  row.className = 'mrow' + (btn.cls === 'ok' ? ' done' : '');
  row.innerHTML = '<i></i><div class="mtext"><b></b><div class="mbar"><i></i></div><small></small></div><button></button>';
  row.querySelector('i').textContent = icon;
  row.querySelector('b').innerHTML = title;
  row.querySelector('.mbar i').style.width = `${Math.min(100, (n / goal) * 100).toFixed(0)}%`;
  row.querySelector('small').textContent = sub;
  const b = row.querySelector('button');
  b.textContent = btn.text;
  b.className = btn.cls || '';
  b.disabled = btn.cls !== 'can';
  if (btn.cls === 'can') b.addEventListener('click', btn.on);
  return row;
}
function claimed(coins) {
  if (!coins) return;
  saveProfile();
  drawProfile();
  sfx.levelUp();
  toast(`🪙 +${coins}`, '보상을 받았어요', 'buff');
  drawMissions();
}
function drawMissions() {
  for (const b of $('missionTabs').children) b.classList.toggle('on', b.dataset.tab === missionTab);
  const body = $('missionBody');
  body.replaceChildren();
  const note = [];
  if (missionTab === 'daily') {
    const m = ensureDaily(profile);
    m.list.forEach((it, i) => {
      const d = DAILY_POOL[it.id];
      const done = it.n >= d.goal;
      body.append(missionRow('🎯', d.text, `${it.n} / ${d.goal}`, it.n, d.goal, it.got ? { text: '받음 ✓', cls: 'ok' } : done ? { text: `🪙 ${d.coins} 받기`, cls: 'can', on: () => claimed(claimMission(profile, i)) } : { text: `🪙 ${d.coins}` }));
    });
    const now = new Date();
    const left = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1) - now;
    note.push(`새 미션까지 ${Math.floor(left / 3600000)}시간 ${Math.floor((left % 3600000) / 60000)}분`);
  } else if (missionTab === 'ach') {
    for (const key of Object.keys(ACHIEVEMENTS)) {
      const s = achState(profile, key);
      const stars = '★'.repeat(s.got) + '☆'.repeat(s.a.tiers.length - s.got);
      const title = `${s.a.name}<em>${stars}</em>`;
      if (s.maxed) body.append(missionRow(s.a.icon, title, `모두 달성 (${s.v})`, 1, 1, { text: '완료 ✓', cls: 'ok' }));
      else body.append(missionRow(s.a.icon, title, `${s.a.text(s.goal)} · ${Math.min(s.v, s.goal)} / ${s.goal}`, s.v, s.goal, s.claimable ? { text: `🪙 ${s.coins} 받기`, cls: 'can', on: () => claimed(claimAch(profile, key)) } : { text: `🪙 ${s.coins}` }));
    }
  } else {
    seasonRollover(profile);
    const r = tierOf(profile.rank.rp);
    const big = document.createElement('div');
    big.className = 'rankBig';
    big.style.setProperty('--rc', r.color);
    big.innerHTML = `<div class="medal">🏅</div><div style="flex:1"><b></b><small class="rp"></small><div class="mbar"><i></i></div><small class="next"></small></div>`;
    big.querySelector('b').textContent = r.name;
    big.querySelector('.rp').textContent = `${profile.rank.rp}점 · 이번 시즌 최고 ${profile.rank.best}점`;
    big.querySelector('.mbar i').style.width = `${(r.prog * 100).toFixed(0)}%`;
    big.querySelector('.next').textContent = r.next !== null ? `다음 등급까지 ${r.next - profile.rank.rp}점 · 시즌 끝까지 ${seasonDaysLeft()}일` : `최고 등급! · 시즌 끝까지 ${seasonDaysLeft()}일`;
    const list = document.createElement('div');
    list.className = 'rankList';
    RANKS.forEach((t, i) => {
      const d = document.createElement('div');
      d.style.setProperty('--rc', t.color);
      if (i === r.i) d.className = 'me';
      d.innerHTML = '<b></b><span></span>';
      d.querySelector('b').textContent = t.name;
      d.querySelector('span').textContent = `${t.min}점~ · 시즌 보상 🪙${t.reward}`;
      list.append(d);
    });
    body.append(big, list);
    note.push('판이 끝날 때 순위로 점수가 오르내려요 (1등 +30 … 꼴등 -9, 잡은 수마다 +2). 혼자 하기(봇전)는 절반. 시즌은 한 달이고, 끝나면 등급 보상을 주고 점수가 절반이 돼요.');
  }
  if (prefs.cheat) note.unshift('🧪 치트 모드가 켜져 있으면 미션·업적·랭크가 오르지 않아요.');
  $('missionNote').textContent = note.join(' ');
  drawRankBadge();
}
function openMissions(tab = missionTab) {
  missionTab = tab;
  drawMissions();
  $('missionPanel').hidden = false;
}
$('openMissions').addEventListener('click', () => openMissions());
$('rankBadge').addEventListener('click', () => openMissions('rank'));
$('closeMissions').addEventListener('click', () => ($('missionPanel').hidden = true));
for (const b of $('missionTabs').children) b.addEventListener('click', () => openMissions(b.dataset.tab));

// ── 연습(튜토리얼) ──
let tutor = null; // 진행 중인 연습
const startGrace = () => (tutor ? 0 : CFG.START_GRACE); // 연습에는 시작 대기 시간이 없다
let tutorSeen = false; // 허수아비를 한 번이라도 시야에 넣었나
async function startTutorial() {
  $('tutorPrompt').hidden = true;
  prefs.tutorSeen = true;
  savePrefs();
  $('status').textContent = '불러오는 중…';
  const { Game } = await import('./server/game.js');
  const game = new Game({ mode: 'ffa', rule: 'dm', map: 'camp', FIXED_MAP: true, BOT_FILL: 0, START_GRACE: 0, ROUND_TIME: 3600, items: false, fireflies: false });
  const name = $('name').value.trim() || 'Player';
  const player = game.addPlayer(name, (msg) => onMessage(JSON.parse(msg)), false, profile.char, profile.skin);
  const dummy = game.addPlayer('허수아비', null, true);
  dummy.dummy = true;
  dummy.char = 'explorer';
  dummy.skin = 'default';
  const spot = pickSpots(game.map);
  Object.assign(player, { x: spot.me[0], z: spot.me[1], yaw: 0, alive: true });
  Object.assign(dummy, { x: spot.dummy[0], z: spot.dummy[1], yaw: 0, alive: true, hp: 60 });
  game.rosterDirty = true;
  offline = { game, player };
  tutorSeen = false;
  document.body.classList.add('tutorial');
  onMessage({ t: 'w', id: player.id, team: player.team, ...game.info() });
  input.yaw = 0;
  tutor = new Tutorial({
    $, sfx, game, player, dummy, skill: player.skill,
    state: () => ({
      x: view.x, z: view.z, yaw: view.yaw, seen: tutorSeen, seenNow: ents.has(dummy.id), level: prog.level,
      ups: Object.values(prog.ups || {}).reduce((a, b) => a + b, 0), skill: sim.rollCd > 0, flare: flareCd > 0,
    }),
    onFinish: () => {
      const first = !profile.tutorial;
      if (first) {
        profile.tutorial = 1;
        profile.coins += TUTOR_REWARD;
        saveProfile();
        drawProfile();
      }
      $('tutorReward').textContent = first ? `보상 🪙 +${TUTOR_REWARD}` : '';
      $('tutorDone').hidden = false;
      sfx.win();
    },
  });
}
function endTutorial() {
  tutor?.stop();
  tutor = null;
  $('tutorDone').hidden = true;
  document.body.classList.remove('tutorial');
}
$('tutorYes').addEventListener('click', () => startTutorial());
$('tutorNo').addEventListener('click', () => {
  prefs.tutorSeen = true;
  savePrefs();
  $('tutorPrompt').hidden = true;
});
$('tutorSkip').addEventListener('click', () => exitGame());
$('tutorLobby').addEventListener('click', () => exitGame());
$('tutorPlay').addEventListener('click', () => {
  exitGame();
  $('play').click();
});
$('tutorAgain').addEventListener('click', () => {
  $('settings').hidden = true;
  startTutorial();
});

function onMessage(m) {
  if (m.t === 'w') {
    Object.assign(prog, { hp: PROGRESS.BASE_HP, xp: 0, level: 1, next: xpToNext(1), ups: {}, choices: null, more: 0, stats: statsOf({}, CFG, profile.char), earned: 0 });
    chars.setKind(selfMesh, 'self', profile.char, profile.skin);
    applyMyStats();
    drawChoices();
    myId = m.id;
    myTeam = m.team;
    mode = m.m || 'duo';
    rule = m.r || 'survival';
    target = m.g || 0;
    roundTime = m.rtm || CFG.ROUND_TIME;
    roundStart = { earned: 0, coins: profile.coins };
    if (m.map) setMap(m.map);
    if (!document.body.classList.contains('tutorial')) showMapIntro(m.map || curMap.id);
    $('menu').style.display = 'none';
    party?.hideRoom();
    $('invite').hidden = true;
    showcase.close();
    $('hud').hidden = false;
  } else if (m.t === 'full') {
    $('status').textContent = '방이 가득 찼습니다.';
  } else if (m.t === 'r') {
    roster.clear();
    for (const [id, name, team, score, al, wins, level, char, skin, fc] of m.p) roster.set(id, { name, team, score, alive: !!al, wins, level: level || 1, char, skin, fc: fc || '' });
    for (const [id, e] of ents) setKind(e.mesh, kindOf(id), roster.get(id)?.char, roster.get(id)?.skin);
    drawBoard();
    noteRecent();
    drawScore();
  } else if (m.t === 'k') {
    for (const [k, v] of m.l) {
      // 내가 보고 있던 플레이어가 쓰러지면 그 자리에 이펙트 (위치는 이미 알고 있던 것만 쓴다)
      const seen = ents.get(v);
      if (seen) {
        deathFx.spawn(seen.x, seen.z, kindOf(v));
        shake = Math.max(shake, 0.3);
      }
      if (v === myId) {
        killedBy = k ? (roster.get(k)?.name ?? '') : '독구름';
        deathFx.spawn(view.x, view.z, 'self');
        shake = 0.9;
        flash();
        streak = 0;
        sfx.death();
        buzz(200);
      } else if (k === myId) {
        track('kill');
        streak++;
        toast(streak > 1 ? `${streak}연속 잡았다!` : '잡았다!', roster.get(v)?.name ?? '');
        sfx.kill();
        buzz(40);
      }
      else if (roster.get(k)?.team === myTeam) sfx.allyKill();
      else if (roster.get(v)?.team === myTeam) sfx.allyDown();
      addFeed(k, v);
    }
  } else if (m.t === 'e') {
    const won = m.w === myTeam;
    roundEnd = m.s;
    $('bannerTitle').textContent = won ? '승리' : m.w ? '패배' : '무승부';
    $('bannerTitle').className = won ? 'win' : 'lose';
    winnerText = m.w ? `승자: ${m.n.join(', ')}` : '시간 초과';
    drawResults();
    // 이번 판 보상
    const me = roster.get(myId);
    const xpGot = prog.earned - roundStart.earned;
    const coinGot = Math.floor(profile.coins) - Math.floor(roundStart.coins);
    const rk = roundRank(won, me);
    $('bannerReward').innerHTML = '';
    const chips = [['⭐', '레벨', `Lv ${prog.level}`], ['🔦', '잡은 수', `${me?.score ?? 0}`], ['✨', '경험치', `+${xpGot}`], ['🪙', '코인', `+${coinGot}`]];
    if (rk) chips.push(['🏅', rk.after.name, `${rk.delta >= 0 ? '+' : ''}${rk.delta}`]);
    for (const [icon, label, val] of chips) {
      const c = document.createElement('div');
      c.innerHTML = '<i></i><b></b><span></span>';
      c.querySelector('i').textContent = icon;
      c.querySelector('b').textContent = val;
      c.querySelector('span').textContent = label;
      $('bannerReward').append(c);
    }
    $('banner').hidden = false;
    won ? sfx.win() : sfx.lose();
  } else if (m.t === 'b') {
    // 반사 조끼가 빛을 막았다
    for (const [k, v] of m.l) {
      const at = v === myId ? view : ents.get(v);
      if (at) deathFx.spawn(at.x, at.z, 'shield');
      if (v === myId || k === myId) sfx.block();
      if (v === myId && !(prefs.cheat && prefs.cheatGod)) toast('막았다!', '반사 조끼가 빛을 튕겨냈어요', 'buff');
      else if (k === myId) toast('막혔다!', '상대가 반사 조끼를 입었어요');
    }
  } else if (m.t === 'n') {
    roundStart = { earned: prog.earned, coins: profile.coins };
    if (m.map) {
      setMap(m.map);
      if (!tutor) showMapIntro(m.map);
    }
    roundEnd = 0;
    snapNext = true;
    $('banner').hidden = true;
    killedBy = '';
    streak = 0;
  } else if (m.t === 'st') {
    // 내 성장 정보
    const leveled = m.lv > prog.level;
    if (m.earned > prog.earned) track('xp', m.earned - prog.earned);
    if (leveled) track('level', m.lv);
    addProfileXp(m.earned - prog.earned);
    Object.assign(prog, { level: m.lv, next: m.next, ups: m.ups, choices: m.ch, more: m.more, stats: m.st, earned: m.earned });
    applyMyStats();
    drawChoices();
    if (leveled) {
      popNumber(view.x, view.z, 'LEVEL UP ⬆', 'lvup');
      sfx.levelUp();
      deathFx.spawn(view.x, view.z, 'level');
      auraT = 0;
      buzz(30);
    }
  } else if (m.t === 'c') {
    // 스킬 사용: 보이는 플레이어(또는 나)에게만 효과를 낸다
    for (const [id, skill] of m.l) {
      const at = id === myId ? view : ents.get(id);
      if (!at) continue;
      const [vol, pan] = id === myId ? [1, 0] : spatial(at.x, at.z);
      sfx.skill(skill, vol, pan);
      castFx(id, skill, at);
    }
  } else if (m.t === 'h') {
    // 손전등 피해: 보이는 대상에게만 숫자를 띄운다
    for (const [k, v, dmg] of m.l) {
      if (dmg < 0) {
        // 치유
        const at = v === myId ? view : ents.get(v);
        if (at) {
          popNumber(at.x, at.z, `+${-dmg}`, 'heal');
          skillFx.sparks(at.x, at.z, { n: 8, color: 0x8affb0, spread: 0.5, rise: 1.3, dur: 0.9 });
        }
        continue;
      }
      const at = v === myId ? view : ents.get(v);
      if (!at) continue;
      popNumber(at.x, at.z, dmg, v === myId ? 'hurt' : k === myId ? 'deal' : 'other');
      if (v === myId) {
        sfx.hurt();
        shake = Math.max(shake, 0.45);
        flash();
      } else if (k === myId) {
        sfx.hit();
        const e = ents.get(v);
        if (e) e.hitT = 0.15;
      }
    }
  } else if (m.t === 's') {
    onSnapshot(m);
  }
}

const kindOf = (id) => (roster.get(id)?.team === myTeam ? 'ally' : 'enemy');

function onSnapshot(m) {
  const [x, z, yaw, al, resp, cdNow, rollT, rollCd, rollDx, rollDz, fcd, gasT, speedT, vestT, cloakT, dashT, shieldT, scanT] = m.me;
  watchId = m.w || 0;
  const wasAlive = alive;
  alive = !!al;
  roundLeft = m.rt ?? 0;
  respawnIn = resp;
  gas = gasT || 0;
  zoneTarget = m.zh || 0;
  flareCd = fcd;
  buffs.vest = vestT || 0;
  if (buffs.cloak > 0 && !(cloakT > 0) && alive) skillFx.smoke(view.x, view.z, { n: 8, dur: 0.7 });
  buffs.cloak = cloakT || 0;
  buffs.shield = shieldT || 0;
  buffs.scan = scanT || 0;
  // 배터리를 주우면 서버 쿨다운이 0이 되므로 따라간다
  if (cdNow === 0 && localCd > 0 && m.pk?.includes('battery')) localCd = 0;
  // 서버 상태로 되돌린 뒤 미확인 입력을 다시 적용 (클라이언트 예측 보정)
  Object.assign(sim, { x, z, yaw, rollT, rollCd, rollDx, rollDz, speedT: speedT || 0, dashT: dashT || 0 });
  while (pending.length && pending[0].seq <= m.a) pending.shift();
  if (alive) for (const inp of pending) stepPlayer(sim, inp, DT, curMap.solid);
  else pending.length = 0;
  if (alive && (!wasAlive || snapNext)) {
    // 새 라운드: 보간 없이 순간이동, 조준 방향과 쿨다운도 초기화
    Object.assign(prev, sim);
    input.yaw = sim.yaw;
    localCd = 0;
    chars.respawn(selfMesh);
    if (everAlive) sfx.respawn();
    everAlive = true;
  }
  snapNext = false;

  snapCount++;
  const now = performance.now();
  for (const [id, ex, ez, eyaw, flags, hpPct, lv] of m.e) {
    let e = ents.get(id);
    if (!e) {
      e = { mesh: makePlayerMesh(kindOf(id), roster.get(id)?.char, roster.get(id)?.skin), buf: [], x: ex, z: ez, yaw: eyaw, flags: 0, stamp: 0, rollP: -1, label: null };
      e.mesh.position.set(ex, 0, ez);
      scene.add(e.mesh);
      ents.set(id, e);
      // 적이 시야에 새로 들어오면 짧은 경고음
      if (kindOf(id) === 'enemy' && now - lastSpot > 600) {
        lastSpot = now;
        sfx.spot(spatial(ex, ez)[1]);
      }
    }
    e.buf.push({ t: now, x: ex, z: ez, yaw: eyaw });
    if (e.buf.length > 8) e.buf.shift();
    // 빔/구르기가 새로 시작될 때 소리
    if (flags & 1 && !(e.flags & 1)) sfx.beam(...spatial(ex, ez));
    if (flags & 2 && !(e.flags & 2)) sfx.roll(...spatial(ex, ez));
    if (flags & 32 && !(e.flags & 32)) dashStartFx(e.mesh, e);
    if (!(flags & 4) && e.flags & 4) skillFx.smoke(ex, ez, { n: 8, dur: 0.7 }); // 은신이 풀릴 때
    e.flags = flags;
    e.hpPct = hpPct ?? 100;
    e.lv = lv || 1;
    e.stamp = snapCount;
  }
  // 이번 스냅샷에 없는 플레이어 = 시야 밖 또는 사망 → 클라이언트에서 완전히 제거
  for (const [id, e] of ents) if (e.stamp !== snapCount) removeEnt(id);
  flares = m.f || [];
  syncItems(m.it || []);
  if (m.hp !== undefined) prog.hp = m.hp;
  if (m.xp !== undefined && m.xp > prog.xp) {
    const got = m.xp - prog.xp;
    if (got >= ORBS.medium.v) {
      popNumber(view.x, view.z, `+${got} XP`, got >= ORBS.large.v ? 'xpbig' : 'xp');
      sfx.pickup();
    } else sfx.firefly();
  }
  if (m.xp !== undefined) prog.xp = m.xp;
  if (m.ff) syncFireflies(m.ff);
  for (const type of m.pk || []) {
    toast(ITEMS[type].name, ITEMS[type].desc, 'buff', itemImg(type));
    sfx.pickup();
    buzz(25);
  }
}

function removeEnt(id) {
  const e = ents.get(id);
  if (!e) return;
  scene.remove(e.mesh);
  if (e.label) freeLabel(e.label);
  ents.delete(id);
}

// ───────────────────────── HUD ─────────────────────────
function drawScore() {
  const time = `${Math.floor(roundLeft / 60)}:${String(roundLeft % 60).padStart(2, '0')}`;
  const chip = $('timeChip');
  if (chip.textContent !== time) chip.textContent = time;
  chip.classList.toggle('low', roundLeft <= 10);
  let info = '';
  if (rule === 'survival') {
    let aliveN = 0;
    const teams = new Set();
    for (const p of roster.values()) {
      if (!p.alive) continue;
      aliveN++;
      teams.add(p.team);
    }
    info = mode === 'ffa' ? `생존 ${aliveN}명` : `생존 ${teams.size}팀 · ${aliveN}명`;
    if (zoneTarget) info += ` · 구역 ${Math.round(zoneTarget * 2)}m`;
  } else if (target) info = `목표 ${target}킬`;
  if (mode !== 'ffa' && rule !== 'survival') {
    const kills = new Map();
    for (const p of roster.values()) kills.set(p.team, (kills.get(p.team) || 0) + p.score);
    let top = 0;
    for (const [t, k] of kills) if (t !== myTeam) top = Math.max(top, k);
    info = `우리 팀 ${kills.get(myTeam) || 0} : ${top} 상대${info ? ' · ' + info : ''}`;
  }
  const el = $('score');
  if (el.textContent !== info) el.textContent = info;
  el.hidden = !info;
}

// 순위표: 점수 = 킬 x 100 + (레벨 - 1) x 20. 위치 정보는 없다.
const pointsOf = (p) => p.score * 100 + (p.level - 1) * 20;
let leaderId = 0; // 1등 (머리 위에 왕관)
function drawBoard() {
  const rows = [...roster.entries()].sort((a, b) => pointsOf(b[1]) - pointsOf(a[1]));
  leaderId = rows[0] && pointsOf(rows[0][1]) > 0 ? rows[0][0] : 0;
  const myRank = rows.findIndex(([id]) => id === myId);
  const show = rows.slice(0, 4).map((r, i) => [i, r]);
  if (myRank >= 4) show.push([myRank, rows[myRank]]);
  $('board').replaceChildren(
    ...show.map(([i, [id, p]]) => {
      const row = document.createElement('div');
      row.className = id === myId ? 'me' : p.team === myTeam ? 'ally' : '';
      for (const text of [`#${i + 1}`, p.name, pointsOf(p)]) {
        const c = document.createElement('span');
        c.textContent = text;
        row.append(c);
      }
      return row;
    }),
  );
}
function addFeed(k, v) {
  const row = document.createElement('div');
  for (const [id, sep] of [[k, ' ▸ '], [v, '']]) {
    const s = document.createElement('span');
    s.className = roster.get(id)?.team === myTeam ? 'ally' : 'enemy';
    s.textContent = id ? (roster.get(id)?.name ?? '?') : '독구름';
    row.append(s, sep);
  }
  $('feed').prepend(row);
  while ($('feed').children.length > 5) $('feed').lastChild.remove();
  setTimeout(() => row.remove(), 6000);
}
// 이름표: 화면에 보이는 플레이어 머리 위에 이름을 띄운다 (DOM 풀 재사용)
const labelPool = [];
const projV = new THREE.Vector3();
function freeLabel(el) {
  el.style.display = 'none';
  labelPool.push(el);
}
function drawLabels() {
  const w = innerWidth;
  const h = innerHeight;
  for (const [id, e] of ents) {
    if (!e.mesh.visible) {
      if (e.label) e.label.style.display = 'none';
      continue;
    }
    if (!e.label) {
      e.label = labelPool.pop();
      if (!e.label) {
        e.label = $('labels').appendChild(document.createElement('div'));
        e.label.innerHTML = '<span><b></b><i></i></span><s><u></u></s>';
      }
      e.label.dataset.k = '';
    }
    const name = roster.get(id)?.name ?? '';
    const crown = id === leaderId;
    const key = `${name}|${e.lv}|${e.hpPct}|${kindOf(id)}|${crown}`;
    if (e.label.dataset.k !== key) {
      e.label.dataset.k = key;
      e.label.className = kindOf(id) + (crown ? ' leader' : '');
      e.label.querySelector('b').textContent = e.lv;
      e.label.querySelector('i').textContent = name;
      e.label.querySelector('u').style.transform = `scaleX(${(e.hpPct / 100).toFixed(2)})`;
    }
    projV.set(e.x, 2.45 * growOf(e.lv || 1), e.z).project(camera);
    e.label.style.display = '';
    e.label.style.transform = `translate(${((projV.x + 1) * 0.5 * w).toFixed(1)}px, ${((1 - projV.y) * 0.5 * h).toFixed(1)}px) translate(-50%, -100%)`;
  }
}

// ── 성장 UI ──
// 내 강화 수치를 예측과 화면에 반영
function applyMyStats() {
  sim.spd = prog.stats.speed;
  sim.rollCdMax = prog.stats.rollCd;
  sim.skill = prog.stats.skill || 'roll';
  // 스킬 버튼을 내 캐릭터의 고유 스킬로 바꾼다
  const sk = SKILLS[sim.skill];
  const btn = $('roll');
  btn.dataset.label = sk.name;
  btn.querySelector('i').replaceChildren(imgEl(skillImg(sim.skill), 'sk'));
  btn.setAttribute('aria-label', sk.name);
  chars.setBeamStats(selfMesh, prog.stats.range, prog.stats.arc);
}

// 레벨업 카드
function drawChoices() {
  const box = $('choices');
  if (!prog.choices || !myId) {
    box.hidden = true;
    return;
  }
  box.hidden = false;
  $('choiceTitle').textContent = prog.more ? `강화 선택 (+${prog.more})` : '강화 선택';
  $('choiceCards').replaceChildren(
    ...prog.choices.map((key, i) => {
      const u = UPGRADES[key];
      const b = document.createElement('button');
      b.className = 'card';
      const lvl = (prog.ups[key] || 0) + 1;
      b.innerHTML = `<i><img class="up" src="${upImg(key)}" alt="" draggable="false"></i><b></b><span></span><em>${'●'.repeat(lvl)}${'○'.repeat(u.max - lvl)}</em>`;
      b.querySelector('b').textContent = u.name;
      b.querySelector('span').textContent = u.desc;
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        pickChoice(i);
      });
      return b;
    }),
  );
}
function pickChoice(i) {
  if (!prog.choices || !prog.choices[i]) return;
  sfx.choose();
  // 서버 응답(다음 카드 묶음)이 오기 전까지 숨긴다. 오프라인은 응답이 즉시 오므로 먼저 숨겨야 한다.
  prog.choices = null;
  $('choices').hidden = true;
  if (offline) {
    offline.game.choose(offline.player, i);
    offline.game.broadcast();
  } else net.send({ t: 'u', c: i });
}
addEventListener('keydown', (e) => {
  const n = { Digit1: 0, Digit2: 1, Digit3: 2 }[e.code];
  if (n !== undefined && prog.choices) pickChoice(n);
});

// 상태창: 체력, 경험치, 레벨
function drawStatus() {
  const hpR = Math.max(0, Math.min(1, prog.hp / prog.stats.maxHp));
  $('hpFill').style.transform = `scaleX(${hpR.toFixed(3)})`;
  $('hpFill').classList.toggle('low', hpR < 0.35);
  $('hpText').textContent = `${Math.ceil(prog.hp)} / ${prog.stats.maxHp}`;
  const maxed = prog.level >= PROGRESS.MAX_LEVEL;
  $('xpFill').style.transform = `scaleX(${maxed ? 1 : Math.min(1, prog.xp / prog.next).toFixed(3)})`;
  $('xpText').textContent = maxed ? 'MAX' : `${prog.xp} / ${prog.next}`;
  $('lvBadge').textContent = `LV ${prog.level}`;
  // 내 머리 위 체력바
  const bar = $('selfBar');
  bar.style.display = alive ? '' : 'none';
  if (alive) {
    projV.set(view.x, 2.45 * growOf(prog.level), view.z).project(camera);
    bar.classList.toggle('leader', leaderId === myId);
    bar.style.transform = `translate(${((projV.x + 1) * 0.5 * innerWidth).toFixed(1)}px, ${((1 - projV.y) * 0.5 * innerHeight).toFixed(1)}px) translate(-50%, -100%)`;
    bar.firstElementChild.firstElementChild.style.transform = `scaleX(${hpR.toFixed(3)})`;
  }
}

// 떠오르는 피해 숫자
const numPool = [];
function popNumber(x, z, dmg, kind) {
  const el = numPool.pop() || $('nums').appendChild(document.createElement('div'));
  el.textContent = kind === 'hurt' ? `-${dmg}` : dmg;
  el.className = 'num ' + kind;
  projV.set(x + (Math.random() - 0.5) * 0.6, 2.2, z).project(camera);
  el.style.left = `${((projV.x + 1) * 0.5 * innerWidth).toFixed(0)}px`;
  el.style.top = `${((1 - projV.y) * 0.5 * innerHeight).toFixed(0)}px`;
  el.style.display = '';
  el.style.animation = 'none';
  void el.offsetWidth;
  el.style.animation = '';
  setTimeout(() => {
    el.style.display = 'none';
    numPool.push(el);
  }, 800);
}

// 반딧불: 어둠 속에서도 빛나 보이는 작은 불빛 (지형처럼 공개된 정보)
const FF_MAX = 96;
// 경험치 보석: 작은 노랑, 중간 초록, 큰 보라. 각진 보석이 빙글빙글 돌며 떠 있고 바닥에 그림자가 진다.
const ORB_LOOK = {
  small: { core: 0xffe14a, glow: 0x8a7a10, size: 0.9 },
  medium: { core: 0x3cf0a0, glow: 0x1a8a50, size: 1.35 },
  large: { core: 0xd56bff, glow: 0x9a2aa8, size: 2 },
};
const gemGeo = new THREE.OctahedronGeometry(0.17, 0).scale(1, 1.45, 1);
const ffMesh = new THREE.InstancedMesh(gemGeo, new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0x3a3a3a, flatShading: true }), FF_MAX);
const ffGlow = new THREE.InstancedMesh(
  new THREE.SphereGeometry(0.4, 10, 8),
  new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
  FF_MAX,
);
const ffShadow = new THREE.InstancedMesh(
  new THREE.CircleGeometry(0.2, 14).rotateX(-Math.PI / 2),
  new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.28, depthWrite: false }),
  FF_MAX,
);
ffMesh.setColorAt(0, new THREE.Color());
ffGlow.setColorAt(0, new THREE.Color());
for (const m of [ffMesh, ffGlow, ffShadow]) {
  m.frustumCulled = false;
  m.count = 0;
  scene.add(m);
}
const ffMat = new THREE.Matrix4();
const ffQ = new THREE.Quaternion();
const ffPos = new THREE.Vector3();
const ffScl = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const ffColor = new THREE.Color();
let ffColorsDirty = true;
let ffPrev = [];
const sucked = new Map(); // 끌어오기로 빨려 들어가는 중인 반딧불 id → 언제까지 숨길지
function syncFireflies(list) {
  ffPrev = fireflies;
  const t = performance.now();
  for (const [id, until] of sucked) if (until < t) sucked.delete(id);
  // 없어진 반딧불: 옆에 플레이어가 있으면 먹힌 것 → 자석에 붙듯 그 플레이어에게 날아간다
  const next = new Set(list.map((f) => f[0]));
  for (const [id, fx, fz, v] of fireflies) {
    if (next.has(id) || sucked.has(id)) continue;
    const p = ffDrawn.get(id) || { x: fx, y: 0.9, z: fz };
    const m = nearestMagnet(p.x, p.z, 1.4);
    const look = ORB_LOOK[orbTier(v || ORBS.small.v)];
    if (m) skillFx.gem(p.x, p.z, look.core, m.at, 0, { mode: 'snap', y0: p.y, s: look.size * 0.9 });
    if (m?.at === view) {
      track('orb');
      if (orbTier(v || ORBS.small.v) === 'large') track('orbBig');
    }
  }
  for (const id of ffDrawn.keys()) if (!next.has(id)) ffDrawn.delete(id);
  fireflies = list.filter((f) => !sucked.has(f[0])).slice(0, FF_MAX);
  ffColorsDirty = true;
}
// ── 스킬 효과 ──
// 스킬을 쓴 순간: 캐릭터는 그 스킬 자세를 취하고, 발밑과 주변에 차분한 효과가 난다
function castFx(id, skill, at) {
  if (id === myId) track('skill');
  const mesh = id === myId ? selfMesh : at.mesh;
  if (mesh) chars.cast(mesh, skill);
  const { x, z } = at;
  if (skill === 'heal') {
    skillFx.ring(x, z, { r0: 0.4, r1: SKILLS.heal.radius, dur: 0.85, color: 0x7dff9a, a: 0.65, follow: at });
    skillFx.ring(x, z, { r0: 0.3, r1: SKILLS.heal.radius * 0.55, dur: 0.6, color: 0xc8ffd0, a: 0.35, follow: at });
    skillFx.sparks(x, z, { n: 14, color: 0x8affb0, spread: 0.7, rise: 1.6, dur: 1 });
  } else if (skill === 'magnet') {
    skillFx.ring(x, z, { r0: SKILLS.magnet.radius, r1: 0.6, dur: 0.5, color: 0xffe27a, a: 0.5, follow: at });
    suckFireflies(at);
  } else if (skill === 'scan') {
    skillFx.ring(x, z, { r0: 0.5, r1: SKILLS.scan.radius, dur: 1.1, color: 0xc8a8ff, a: 0.55, follow: at });
    at.scanPulse = 1.3;
  } else if (skill === 'shield') {
    skillFx.sparks(x, z, { n: 10, color: 0x9fe8ff, spread: 0.9, y: 0.5, rise: 0.5, out: 1.6, dur: 0.5 });
  } else if (skill === 'stealth') {
    skillFx.smoke(x, z, { n: 14 });
  }
}
// 질주 출발: 앞으로 숙이며 발밑에서 흙먼지 고리
function dashStartFx(mesh, at) {
  chars.cast(mesh, 'dash');
  skillFx.ring(at.x, at.z, { r0: 0.3, r1: 1.8, dur: 0.35, color: 0xfff0c0, a: 0.45 });
}
// 질주 중에는 바람 줄기, 매의 눈이 켜져 있는 동안은 잔잔한 고리가 주기적으로 퍼진다
function skillTrails(at, dt, dashing, scanning) {
  if (dashing) {
    const mx = at.x - (at.tx ?? at.x);
    const mz = at.z - (at.tz ?? at.z);
    if (Math.hypot(mx, mz) > 0.001) at.my = Math.atan2(mx, mz);
    at.streakT = (at.streakT || 0) - dt;
    if (at.streakT <= 0) {
      at.streakT = 0.05;
      skillFx.streak(at.x, at.z, at.my ?? at.yaw ?? 0);
    }
  }
  at.tx = at.x;
  at.tz = at.z;
  if (scanning) {
    at.scanPulse = (at.scanPulse ?? 1.3) - dt;
    if (at.scanPulse <= 0) {
      at.scanPulse = 1.3;
      skillFx.ring(at.x, at.z, { r0: 0.5, r1: SKILLS.scan.radius * 0.75, dur: 1.2, color: 0xc8a8ff, a: 0.22, width: 0.06, follow: at });
    }
  }
}
// 끌어오기: 주변 반딧불이 보석처럼 휘어 날아와 몸에 쏙 들어간다
function suckFireflies(at) {
  const R = SKILLS.magnet.radius;
  const seen = new Set();
  const until = performance.now() + 1500;
  let longest = 0.5;
  for (const [id, fx, fz, v] of [...fireflies, ...ffPrev]) {
    if (seen.has(id)) continue;
    seen.add(id);
    if (Math.hypot(fx - at.x, fz - at.z) > R) continue;
    sucked.set(id, until);
    if (at === view) {
      track('orb');
      if (orbTier(v || ORBS.small.v) === 'large') track('orbBig');
    }
    const p = ffDrawn.get(id) || { x: fx, y: 0.9, z: fz };
    const look = ORB_LOOK[orbTier(v || ORBS.small.v)];
    const delay = 0.12 + Math.random() * 0.12; // 손을 뻗은 뒤에 끌려오기 시작한다
    const dur = 0.4 + Math.hypot(p.x - at.x, p.z - at.z) * 0.045 + Math.random() * 0.1;
    longest = Math.max(longest, delay + dur);
    skillFx.gem(p.x, p.z, look.core, at, delay, { mode: 'spiral', y0: p.y, s: look.size * 0.9, dur });
  }
  // 몸 둘레의 작은 빛 알갱이들이 소용돌이치며 빨려 든다
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2;
    const r = 1.6 + Math.random() * 1.6;
    skillFx.gem(at.x + Math.sin(a) * r, at.z + Math.cos(a) * r, 0xfff0b0, at, 0.05 + Math.random() * 0.25, { mode: 'spiral', y0: 0.4 + Math.random() * 1.1, s: 0.32, dur: 0.55 + Math.random() * 0.25, trail: false });
  }
  // 다 모이면 몸에서 작게 퍼지는 빛 (빨아들였다)
  skillFx.ring(at.x, at.z, { r0: 0.3, r1: 1.6, dur: 0.35, color: 0xffe27a, a: 0.6, follow: at, delay: longest });
  fireflies = fireflies.filter((f) => !sucked.has(f[0]));
  ffColorsDirty = true;
}

// 레벨업 빛기둥: 아래에서 위로 옅어지는 황금빛 기둥이 솟았다가 사라진다
const auraTex = (() => {
  const c = document.createElement('canvas');
  c.width = 4;
  c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createLinearGradient(0, 64, 0, 0);
  grd.addColorStop(0, 'rgba(255,240,170,1)');
  grd.addColorStop(0.35, 'rgba(255,220,110,.55)');
  grd.addColorStop(1, 'rgba(255,200,80,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 4, 64);
  return new THREE.CanvasTexture(c);
})();
const aura = new THREE.Mesh(
  new THREE.CylinderGeometry(0.85, 1, 3.2, 28, 1, true).translate(0, 1.6, 0),
  new THREE.MeshBasicMaterial({ map: auraTex, transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }),
);
aura.frustumCulled = false;
aura.visible = false;
scene.add(aura);
let auraT = 1;
function drawAura(dt) {
  if (auraT >= 1) return;
  auraT = Math.min(1, auraT + dt / 1.3);
  aura.visible = auraT < 1;
  const k = auraT;
  aura.position.set(view.x, 0, view.z);
  aura.scale.set(0.8 + k * 0.6, Math.min(1, k * 5) * (1.1 - k * 0.3), 0.8 + k * 0.6);
  aura.rotation.y += dt * 2;
  aura.material.opacity = 1 - k * k;
}
// 자석: 줍는 거리 바깥 MAGNET_BAND 안의 반딧불은 그 플레이어 쪽으로 떨리며 끌려가는 모습을 보인다 (그림만, 판정은 서버)
const MAGNET_BAND = 1.8;
const ffDrawn = new Map(); // id → 마지막으로 그린 위치 { x, y, z } (먹힐 때 거기서부터 날아간다)
function magnetsNow() {
  const list = [];
  if (alive) list.push({ at: view, pick: prog.stats.pickRadius || PROGRESS.PICK_RADIUS });
  for (const [id, e] of ents) {
    if (e.flags & 4 && kindOf(id) === 'enemy') continue;
    list.push({ at: e, pick: PROGRESS.PICK_RADIUS + (CHARACTERS[roster.get(id)?.char]?.pick || 0) });
  }
  return list;
}
function nearestMagnet(x, z, extra) {
  let best = null;
  let bd = Infinity;
  for (const m of magnetsNow()) {
    const d = Math.hypot(m.at.x - x, m.at.z - z);
    if (d < m.pick + extra && d < bd) {
      bd = d;
      best = m;
    }
  }
  return best;
}
function drawFireflies(t) {
  ffMesh.count = ffGlow.count = ffShadow.count = fireflies.length;
  const mags = magnetsNow();
  for (let i = 0; i < fireflies.length; i++) {
    let [id, x, z, v] = fireflies[i];
    const look = ORB_LOOK[orbTier(v || ORBS.small.v)];
    const ph = id * 2.399;
    let s = look.size;
    let fy = 0.55 + s * 0.12 + Math.sin(t * 2.4 + ph) * 0.12;
    // 자석: 가까운 플레이어 쪽으로 기울며 파르르 떨린다 (가까울수록 세게)
    let pullK = 0;
    let px = 0;
    let pz = 0;
    let near = null;
    let nd = 0;
    for (const m of mags) {
      const d = Math.hypot(m.at.x - x, m.at.z - z);
      const k = Math.min(1, 1 - (d - m.pick) / MAGNET_BAND);
      if (k > pullK && d > 0.01) {
        pullK = k;
        near = m;
        nd = d;
      }
    }
    if (near) {
      pullK *= pullK; // 가까워질수록 급격히 세진다
      const move = Math.max(0, Math.min(nd - 0.3, pullK * 1.2));
      px = ((near.at.x - x) / nd) * move;
      pz = ((near.at.z - z) / nd) * move;
      const shake = 0.05 * pullK;
      x += px + Math.sin(t * 43 + ph) * shake;
      z += pz + Math.cos(t * 37 + ph) * shake;
      fy += (1.0 - fy) * pullK * 0.6;
      s *= 1 - 0.12 * pullK;
    }
    const dr = ffDrawn.get(id);
    if (dr) Object.assign(dr, { x, y: fy, z });
    else ffDrawn.set(id, { x, y: fy, z });
    // 보석: 제자리에서 돌며 위아래로 둥실 (끌려갈 때는 더 빨리 돈다)
    ffQ.setFromAxisAngle(UP, t * (1.8 + pullK * 6) + ph);
    ffMesh.setMatrixAt(i, ffMat.compose(ffPos.set(x, fy, z), ffQ, ffScl.setScalar(s)));
    // 빛: 큰 보석일수록 크게 숨 쉰다
    const g = s * (0.75 + 0.22 * Math.sin(t * (s > 1.8 ? 5 : 3.5) + ph));
    ffGlow.setMatrixAt(i, ffMat.makeScale(g, g, g).setPosition(x, fy, z));
    // 그림자: 높이 뜰수록 작고 옅게
    const sh = s * (1.05 - (fy - 0.55) * 0.5);
    ffShadow.setMatrixAt(i, ffMat.makeScale(sh, 1, sh).setPosition(x, 0.03, z));
    if (ffColorsDirty) {
      ffMesh.setColorAt(i, ffColor.setHex(look.core));
      ffGlow.setColorAt(i, ffColor.setHex(look.glow));
    }
  }
  if (ffColorsDirty) {
    ffMesh.instanceColor.needsUpdate = ffGlow.instanceColor.needsUpdate = true;
    ffColorsDirty = false;
  }
  ffMesh.instanceMatrix.needsUpdate = ffGlow.instanceMatrix.needsUpdate = ffShadow.instanceMatrix.needsUpdate = true;
}

// 모험가 레벨: 기기에 쌓이는 누적 경험치
const PROFILE_KEY = 'frustum.profile';
const profile = (() => {
  try {
    return normalizeProfile(JSON.parse(localStorage.getItem(PROFILE_KEY)));
  } catch {
    return normalizeProfile(null);
  }
})();
const CHEAT_COINS = 9999999;
const cheatCoinsOn = () => prefs.cheat && prefs.cheatCoins;
const coinText = () => (cheatCoinsOn() ? '∞' : String(Math.floor(profile.coins)));
// 코인 무한을 켜면 원래 코인을 따로 두고 가득 채운다. 끄면 원래 코인으로 되돌린다.
function applyCheatCoins() {
  if (cheatCoinsOn()) {
    if (prefs.realCoins === null) prefs.realCoins = profile.coins;
    profile.coins = CHEAT_COINS;
  } else if (prefs.realCoins !== null) {
    profile.coins = prefs.realCoins;
    prefs.realCoins = null;
  }
  savePrefs();
  saveProfile();
}
function saveProfile() {
  if (cheatCoinsOn()) profile.coins = CHEAT_COINS; // 써도 줄지 않는다
  try {
    localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
  } catch {}
}
const COIN_PER_XP = 0.25; // 경험치 4 = 코인 1
const rankNeed = (lv) => 200 + (lv - 1) * 150;
function rankOf(xp) {
  let lv = 1;
  while (xp >= rankNeed(lv)) xp -= rankNeed(lv++);
  return { lv, xp, need: rankNeed(lv) };
}
function addProfileXp(n) {
  if (!(n > 0)) return;
  profile.xp += n;
  profile.coins += n * COIN_PER_XP;
  saveProfile();
  drawProfile();
}
function drawProfile() {
  const r = rankOf(profile.xp);
  $('rankLv').textContent = `모험가 Lv ${r.lv}`;
  $('rankFill').style.transform = `scaleX(${(r.xp / r.need).toFixed(3)})`;
  $('rankText').textContent = `${r.xp} / ${r.need}`;
  $('coins').textContent = `🪙 ${coinText()}`;
}

// 캐릭터 선택 화면: 3D 캐릭터를 넘겨 보며 능력을 확인하고, 코인으로 사거나 고른다
const showcase = new Showcase(chars);
const CHAR_IDS = Object.keys(CHARACTERS);
const lockEls = CHAR_IDS.map(() => {
  const el = document.createElement('div');
  el.textContent = '🔒';
  return $('shopLocks').appendChild(el);
});
function drawShop() {
  const id = showcase.current;
  const c = CHARACTERS[id];
  const owned = profile.owned.includes(id);
  $('shopCoins').textContent = `🪙 ${coinText()}`;
  $('shopName').textContent = c.name;
  const sk = SKILLS[c.skill];
  iconText($('shopAbility'), c.icon, c.desc);
  srcText($('shopSkill'), skillImg(c.skill), `${sk.name} · ${sk.desc}`);
  $('shopCount').textContent = `${profile.owned.length}/${CHAR_IDS.length}`;
  $('shopPrev').disabled = showcase.index === 0;
  $('shopNext').disabled = showcase.index === CHAR_IDS.length - 1;
  // 능력치 그래프: 위 체력, 오른쪽 속도, 아래 공격, 왼쪽 사거리
  const r = radarOf(id);
  const R = 44;
  $('radarShape').setAttribute('points', `0,${-r.hp * R} ${r.speed * R},0 0,${r.power * R} ${-r.range * R},0`);
  const btn = $('shopAct');
  btn.className = '';
  btn.disabled = false;
  if (profile.char === id) {
    btn.textContent = '사용 중';
    btn.disabled = true;
  } else if (owned) btn.textContent = '선택';
  else {
    btn.textContent = `🪙 ${c.price} 구매`;
    btn.className = 'buy';
    btn.disabled = profile.coins < c.price;
  }
}
// ── 상점 탭: 캐릭터 / 스킨 / 뽑기 ──
let shopTab = 'chars';
function setShopTab(tab) {
  shopTab = tab;
  $('shop').dataset.tab = tab;
  for (const b of $('shopTabs').children) b.classList.toggle('on', b.dataset.tab === tab);
  // 스킨/뽑기 탭에서는 지금 쓰는 캐릭터를 가운데에 세운다
  if (tab !== 'chars') showcase.open(profile.char);
  showcase.setSkin(tab === 'chars' ? 'default' : profile.skin);
  drawShop();
  if (tab === 'skins') drawSkins();
  if (tab === 'gacha') drawGacha();
}
for (const b of $('shopTabs').children) b.addEventListener('click', () => setShopTab(b.dataset.tab));

function drawSkins() {
  $('skinRow').replaceChildren(
    ...Object.entries(SKINS).map(([id, sk]) => {
      const owned = profile.skins.includes(id);
      const b = document.createElement('button');
      b.className = `skin ${sk.tier}` + (profile.skin === id ? ' on' : '') + (owned ? '' : ' locked');
      b.innerHTML = '<i></i><span></span>';
      // 의상을 입은 모습 (기본은 지금 고른 캐릭터)
      b.querySelector('i').append(imgEl(id === 'default' ? charImg(showcase.current) : skinImg(id), 'portrait'));
      if (sk.color !== null) b.querySelector('i').style.background = `radial-gradient(circle at 50% 35%, #fff6, #${sk.color.toString(16).padStart(6, '0')})`;
      b.querySelector('span').textContent = owned ? sk.name : `🔒 ${sk.name}`;
      b.addEventListener('click', () => {
        // 가진 스킨은 입고, 없는 스킨은 미리보기만
        showcase.setSkin(id);
        $('shopName').textContent = sk.name;
        $('shopAbility').textContent = sk.desc;
        if (owned) {
          profile.skin = id;
          saveProfile();
          sfx.choose();
          drawSkins();
          $('shopSkill').textContent = '입고 있어요';
        } else $('shopSkill').textContent = `${TIERS[sk.tier].name} 의상 · 뽑기에서 얻을 수 있어요`;
      });
      return b;
    }),
  );
}

function drawGacha() {
  $('shopCoins').textContent = `🪙 ${coinText()}`;
  $('gachaOdds').innerHTML = Object.values(TIERS)
    .map((t) => `<span style="color:${t.color}">${t.name} ${Math.round(t.p * 100)}%</span>`)
    .join(' · ');
  $('gachaPity').textContent = `영웅 이상 확정까지 ${GACHA.PITY - profile.pity}회 · 일반: 코인 / 희귀: 스킨 / 영웅·전설: 캐릭터, 스킨`;
  $('gacha1').textContent = `1회 🪙 ${GACHA.COST}`;
  $('gacha10').textContent = `10회 🪙 ${GACHA.COST10}`;
  $('gacha1').disabled = profile.coins < GACHA.COST;
  $('gacha10').disabled = profile.coins < GACHA.COST10;
}
function doGacha(n) {
  const results = gacha(profile, n);
  if (!results) return;
  saveProfile();
  drawGacha();
  drawProfile();
  // 결과 카드를 하나씩 뒤집어 보여준다
  $('gachaCards').replaceChildren(
    ...results.map((r, i) => {
      const card = document.createElement('div');
      card.className = `gcard ${r.tier}`;
      card.style.animationDelay = `${i * 0.12}s`;
      const name = r.kind === 'coins' ? `코인 ${r.coins}` : r.kind === 'skin' ? `${SKINS[r.id].name} 스킨` : CHARACTERS[r.id].name;
      card.innerHTML = '<i></i><b></b><span></span>';
      // 캐릭터와 의상은 초상화, 코인은 동전
      if (r.kind === 'coins') card.querySelector('i').textContent = '🪙';
      else card.querySelector('i').append(imgEl(r.kind === 'skin' ? skinImg(r.id) : charImg(r.id), 'portrait'));
      card.querySelector('b').textContent = name;
      card.querySelector('span').textContent = TIERS[r.tier].name + (r.dup ? ' (모두 보유)' : '');
      return card;
    }),
  );
  $('gachaResult').hidden = false;
  const best = Math.max(...results.map((r) => Object.keys(TIERS).indexOf(r.tier)));
  if (best >= 2) sfx.win();
  else sfx.levelUp();
  buzz(best >= 2 ? 120 : 30);
}
$('gacha1').addEventListener('click', () => doGacha(1));
$('gacha10').addEventListener('click', () => doGacha(10));
$('gachaOk').addEventListener('click', () => ($('gachaResult').hidden = true));

// 출석 보상: 하루 한 번
function drawDaily() {
  const can = profile.daily !== dayKey();
  $('daily').hidden = !can;
  if (can) {
    const next = profile.streak && profile.streak < DAILY.MAX_STREAK ? profile.streak + 1 : profile.streak || 1;
    $('daily').querySelector('span').textContent = `출석 ${next}일`;
  }
}
$('daily').addEventListener('click', () => {
  const got = claimDaily(profile);
  if (!got) return;
  saveProfile();
  drawProfile();
  drawDaily();
  sfx.pickup();
  $('status').textContent = `출석 보상 🪙 ${got} 받았어요! (연속 ${profile.streak}일)`;
});

function shopMove(d) {
  if (shopTab !== 'chars') return;
  const before = showcase.index;
  showcase.move(d);
  if (showcase.index !== before) {
    sfx.firefly();
    drawShop();
  }
}
$('shopAct').addEventListener('click', () => {
  const id = showcase.current;
  const c = CHARACTERS[id];
  if (!profile.owned.includes(id)) {
    if (profile.coins < c.price) return;
    profile.coins -= c.price;
    profile.owned.push(id);
    sfx.levelUp();
  } else sfx.choose();
  profile.char = id;
  saveProfile();
  drawShop();
  drawProfile();
});
$('shopPrev').addEventListener('click', () => shopMove(-1));
$('shopNext').addEventListener('click', () => shopMove(1));
addEventListener('keydown', (e) => {
  if (!showcase.active) return;
  if (e.code === 'ArrowLeft') shopMove(-1);
  if (e.code === 'ArrowRight') shopMove(1);
  if (e.code === 'Escape') $('closeShop').click();
});
// 좌우로 밀어서 넘기기, 옆 캐릭터를 눌러서 고르기
{
  let startX = null;
  $('shop').addEventListener('pointerdown', (e) => {
    if (e.target === $('shop') || e.target.closest('#shopLocks')) startX = e.clientX;
  });
  $('shop').addEventListener('pointerup', (e) => {
    if (startX === null) return;
    const dx = e.clientX - startX;
    startX = null;
    if (Math.abs(dx) > 36) shopMove(dx < 0 ? 1 : -1);
    else if (e.clientX < innerWidth * 0.36) shopMove(-1);
    else if (e.clientX > innerWidth * 0.64) shopMove(1);
  });
}
function openShop(tab) {
  // 친선 방에서 열었으면 방 화면을 가린다 (닫으면 다시 방으로 돌아간다)
  party?.hideRoom();
  $('invite').hidden = true;
  showcase.lobby = false;
  showcase.empty = false; // 방 화면에서 꺼 둔 3D 캐릭터를 다시 보이게
  showcase.open(profile.char);
  setShopTab(tab);
  $('shop').hidden = false;
  $('menu').style.display = 'none';
}
$('openChars').addEventListener('click', () => openShop('chars'));
$('openShop').addEventListener('click', () => openShop('gacha'));
$('closeShop').addEventListener('click', () => {
  $('gachaResult').hidden = true;
  $('shop').hidden = true;
  if (party?.active) {
    if (net.ready) sendHello(); // 바꾼 캐릭터·의상을 방 사람들에게 알린다
    party.showRoom();
  } else enterLobby();
});

// ── 로비 ──
const RULE_NAMES = { dm: '데스매치', score: '점수제 데스매치', survival: '서바이벌' };
const MODE_NAMES = { ffa: '개인전', duo: '2인 팀전' };
function enterLobby() {
  $('menu').style.display = '';
  party?.hideRoom();
  showcase.empty = false;
  if (net.ready) sendHello();
  showcase.lobby = true;
  showcase.open(profile.char);
  showcase.setSkin(profile.skin);
  drawLobby();
  drawRankBadge();
  $('tutorPrompt').hidden = !!(profile.tutorial || prefs.tutorSeen);
}
function drawLobby() {
  const c = CHARACTERS[profile.char];
  const sk = SKILLS[c.skill];
  setIcon($('avatar'), profile.icon || c.icon);
  $('lobbyCharName').textContent = profile.skin === 'default' ? c.name : `${c.name} · ${SKINS[profile.skin].name}`;
  srcText($('lobbySkill'), skillImg(c.skill), `${sk.name} · ${c.desc}`);
  $('modeText').textContent = `${RULE_NAMES[menuRule]} · ${MODE_NAMES[menuMode]}`;
  $('mapText').textContent = lobby.map ? `맵: ${MAPS[lobby.map].name}` : '맵: 순환';
  $('modeCard').style.setProperty('--map', `url(${mapImg(lobby.map)})`);
  $('netSolo').classList.toggle('on', !lobby.online);
  $('netOnline').classList.toggle('on', lobby.online);
  for (const [m, id] of Object.entries(MAP_BTNS)) $(id).classList.toggle('on', lobby.map === m);
  drawOnline();
}
// 프로필 아이콘 고르기
function drawIcons() {
  $('iconHint').textContent = '';
  $('iconGrid').replaceChildren(
    ...[{ icon: '', locked: false, how: '' }, ...iconsFor(profile)].map((x) => {
      const b = document.createElement('button');
      setIcon(b, x.icon || CHARACTERS[profile.char].icon);
      if (!x.icon) b.dataset.auto = '1';
      b.className = (profile.icon === x.icon ? 'on' : '') + (x.locked ? ' locked' : '');
      b.addEventListener('click', () => {
        if (x.locked) return ($('iconHint').textContent = `🔒 ${x.how}`);
        profile.icon = x.icon;
        saveProfile();
        sfx.choose();
        drawIcons();
        drawLobby();
      });
      return b;
    }),
  );
}
$('avatar').addEventListener('click', () => {
  drawIcons();
  $('iconPanel').hidden = false;
});
$('closeIcons').addEventListener('click', () => ($('iconPanel').hidden = true));

// 온라인 서버 주소: 설정에서 붙여 넣고 연결을 확인한다
function drawServer(msg = '') {
  const cur = remote();
  $('serverState').textContent = msg || (cur ? `연결 대상: ${cur.replace(/^https?:\/\//, '')}` : STATIC_HOST ? '아직 서버가 없어요. 혼자 하기는 서버 없이 됩니다.' : '이 페이지를 띄운 서버에 접속합니다.');
}
$('setServer').value = prefs.server;
$('testServer').addEventListener('click', async () => {
  const raw = $('setServer').value;
  const url = normalizeServer(raw);
  if (raw.trim() && !url) return drawServer('주소를 확인해 주세요. 예: frustum.onrender.com');
  prefs.server = url;
  savePrefs();
  $('setServer').value = url.replace(/^https?:\/\//, '');
  if (!url) return drawServer();
  drawServer('확인 중… (잠든 무료 서버는 1분까지 걸려요)');
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 70000);
    const res = await fetch(`${url}/healthz`, { signal: ctl.signal });
    clearTimeout(timer);
    if (!res.ok || (await res.text()).trim() !== 'ok') throw new Error();
    drawServer('✅ 연결됐어요! 로비에서 온라인으로 시작하세요.');
    lobby.online = true;
    drawLobby();
  } catch {
    drawServer('❌ 서버에 닿지 않아요. 주소와 서버 상태를 확인해 주세요.');
  }
});
drawServer();

for (const [m, id] of Object.entries({ '': 'mapAuto', camp: 'mapCamp', forest: 'mapForest', lake: 'mapLake', winter: 'mapWinter', beach: 'mapBeach', factory: 'mapFactory' })) {
  document.getElementById(id).style.setProperty('--map', `url(${mapImg(m)})`);
}
const MAP_BTNS = { '': 'mapAuto', camp: 'mapCamp', forest: 'mapForest', lake: 'mapLake', winter: 'mapWinter', beach: 'mapBeach', factory: 'mapFactory' };
for (const [m, id] of Object.entries(MAP_BTNS)) {
  $(id).addEventListener('click', () => {
    lobby.map = m;
    drawLobby();
  });
}
// 온라인 방 현황: 규칙·인원 조합마다 접속 중인 사람 수. 사람이 모자란 자리는 AI 가 채운다.
let roomCounts = null;
async function loadRooms() {
  roomCounts = null;
  if (!lobby.online) return drawOnline();
  drawOnline('불러오는 중…');
  try {
    const res = await fetch(`${serverBase()}/rooms`, { cache: 'no-store' });
    roomCounts = await res.json();
  } catch {
    return drawOnline('서버가 깨어나는 중이거나 닿지 않아요');
  }
  drawOnline();
}
function drawOnline(msg = '') {
  const box = $('onlineBox');
  box.hidden = !lobby.online;
  if (!lobby.online) return;
  const key = `${menuRule}-${menuMode}`;
  const total = roomCounts ? Object.values(roomCounts).reduce((a, b) => a + b, 0) : 0;
  $('onlineText').textContent =
    msg || (roomCounts ? `지금 접속 ${total}명 · 이 모드 ${roomCounts[key] ?? 0}명 (빈자리는 AI가 채워요)` : '');
  $('busiest').disabled = !roomCounts || total === 0;
  // 버튼마다 그 조합의 인원 표시
  for (const [r, id] of Object.entries(RULE_BTNS)) $(id).dataset.n = roomCounts ? roomCounts[`${r}-${menuMode}`] ?? 0 : '';
  for (const [m, id] of Object.entries(MODES)) $(id).dataset.n = roomCounts ? roomCounts[`${menuRule}-${m}`] ?? 0 : '';
}
$('busiest').addEventListener('click', () => {
  if (!roomCounts) return;
  const [best] = Object.entries(roomCounts).sort((a, b) => b[1] - a[1])[0] ?? [];
  if (!best) return;
  const [r, m] = best.split('-');
  menuRule = r;
  menuMode = m;
  try {
    localStorage.setItem('frustum.rule', r);
    localStorage.setItem('frustum.mode', m);
  } catch {}
  drawPicks();
  drawLobby();
  drawOnline();
});
$('modeCard').addEventListener('click', () => {
  $('modePanel').hidden = false;
  loadRooms();
});
// 친선 방 설정을 바꿀 때도 같은 창을 쓴다 (빈자리 AI 줄이 더 보인다)
let roomSettingsDone = null;
let roomAi = true;
function drawAi() {
  $('aiOn').classList.toggle('on', roomAi);
  $('aiOff').classList.toggle('on', !roomAi);
}
$('aiOn').addEventListener('click', () => ((roomAi = true), drawAi()));
$('aiOff').addEventListener('click', () => ((roomAi = false), drawAi()));
function openRoomSettings(set, done) {
  menuRule = set.rule;
  menuMode = set.mode;
  lobby.map = set.map;
  roomAi = set.ai;
  roomSettingsDone = done;
  drawPicks();
  drawLobby();
  drawAi();
  $('aiRow').hidden = false;
  $('onlineBox').hidden = true;
  $('modeNote').hidden = true;
  $('modePanel').hidden = false;
}
$('closeModes').addEventListener('click', () => {
  $('modePanel').hidden = true;
  $('aiRow').hidden = true;
  $('modeNote').hidden = false;
  if (roomSettingsDone) {
    roomSettingsDone({ rule: menuRule, mode: menuMode, map: lobby.map, ai: roomAi });
    roomSettingsDone = null;
    return;
  }
  drawLobby();
});
function setOnline(on) {
  lobby.online = on;
  try {
    localStorage.setItem('frustum.online', on ? '1' : '0');
  } catch {}
  if (on) net.open();
  else if (!party?.active) net.close();
  drawLobby();
}
// 온라인으로 바꾸고 서버에 붙는다. 붙으면 true.
async function ensureOnline() {
  if (STATIC_HOST && !remote()) {
    $('status').textContent = '온라인 서버 주소가 설정되지 않았습니다.';
    return false;
  }
  if (!lobby.online) setOnline(true);
  return net.open();
}
$('netSolo').addEventListener('click', () => setOnline(false));
$('netOnline').addEventListener('click', () => setOnline(true));

// 온라인에서 같은 방에 있던 사람(봇 제외)을 최근 목록에 기록한다
function noteRecent() {
  if (offline || !myId) return;
  let changed = false;
  for (const [id, p] of roster) {
    if (id === myId || /^AI-\d+$/.test(p.name) || (p.fc && p.fc === profile.fc)) continue;
    const key = (x) => x.fc || `name:${x.name}`;
    if (profile.recent[0] && key(profile.recent[0]) === key(p)) continue;
    profile.recent = [{ name: p.name, fc: p.fc || '' }, ...profile.recent.filter((x) => key(x) !== key(p))].slice(0, 12);
    changed = true;
  }
  if (changed) saveProfile();
}

// 버프 칩: 남은 시간이 있는 효과만 보여준다
const BUFF_IMG = { sneakers: itemImg('sneakers'), vest: itemImg('vest'), cloak: skillImg('stealth'), dash: skillImg('dash'), shield: skillImg('shield'), scan: skillImg('scan') };
const BUFF_NAMES = { dash: '질주', shield: '방패', scan: '매의 눈', cloak: '은신' };
// 내 머리 위 체력바 (다른 플레이어 이름표와 같은 모양)
$('labels').insertAdjacentHTML('beforeend', '<div id="selfBar" class="self"><s><u></u></s></div>');
let buffKey = '';
function drawBuffs() {
  const list = [];
  if (alive && sim.speedT > 0) list.push(['sneakers', sim.speedT]);
  if (alive && buffs.vest > 0) list.push(['vest', buffs.vest]);
  if (alive && buffs.cloak > 0) list.push(['cloak', buffs.cloak]);
  if (alive && sim.dashT > 0) list.push(['dash', sim.dashT]);
  if (alive && buffs.shield > 0) list.push(['shield', buffs.shield]);
  if (alive && buffs.scan > 0) list.push(['scan', buffs.scan]);
  const key = list.map(([t, r]) => t + Math.ceil(r)).join();
  if (key === buffKey) return;
  buffKey = key;
  $('buffs').replaceChildren(
    ...list.map(([t, r]) => {
      const el = document.createElement('div');
      el.className = 'buff ' + t;
      srcText(el, BUFF_IMG[t], `${BUFF_NAMES[t] || ITEMS[t].name} ${Math.ceil(r)}`);
      return el;
    }),
  );
}

// 라운드 결과표: 킬 순위
function drawResults() {
  const rows = [...roster.entries()].sort((a, b) => b[1].score - a[1].score).slice(0, 8);
  $('bannerList').replaceChildren(
    ...rows.map(([id, p], i) => {
      const row = document.createElement('div');
      row.className = id === myId ? 'me' : p.team === myTeam ? 'ally' : 'enemy';
      for (const text of [i + 1, `Lv${p.level} ${p.name}`, `${p.score}킬`]) {
        const cell = document.createElement('span');
        cell.textContent = text;
        row.append(cell);
      }
      return row;
    }),
  );
}

// 피격 섬광
function flash() {
  const el = $('flash');
  el.style.animation = 'none';
  void el.offsetWidth;
  el.style.animation = 'flash .5s ease-out';
}

// 화면 중앙 알림 (처치 확인, 라운드 시작)
let toastTimer = 0;
function toast(title, sub = '', cls = '', img = '') {
  const el = $('toast');
  el.className = cls;
  if (img) srcText($('toastTitle'), img, title);
  else $('toastTitle').textContent = title;
  $('toastSub').textContent = sub;
  el.hidden = false;
  // 애니메이션 재시작
  el.style.animation = 'none';
  void el.offsetWidth;
  el.style.animation = '';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), 1300);
}

// 스킬 버튼: 쿨다운 중에는 남은 시간을 숫자로 보여준다
function drawSkill(id, remain, total, usable) {
  const el = $(id);
  const label = el.querySelector('span');
  const cooling = remain > 0.05;
  el.style.setProperty('--cd', usable ? Math.max(0, Math.min(1, remain / total)).toFixed(3) : 1);
  el.classList.toggle('off', !usable);
  el.classList.toggle('cooling', cooling);
  const text = cooling ? (remain >= 1 ? String(Math.ceil(remain)) : remain.toFixed(1)) : el.dataset.label;
  if (label.textContent !== text) label.textContent = text;
}

// ───────────────────────── 고정 틱: 입력 전송 + 예측 ─────────────────────────
function fixedStep() {
  Object.assign(prev, sim);
  localCd = Math.max(0, localCd - DT);
  localBeam = Math.max(0, localBeam - DT);
  flareCd = Math.max(0, flareCd - DT);
  if (!myId || (!offline && !net.ready)) return;
  const canAct = alive && roundEnd <= 0;
  let atk = input.consume('atk');
  const roll = input.consume('roll') && canAct;
  let flare = input.consume('flare') && canAct;
  // 라운드 시작 직후에는 공격할 수 없다 (서버와 같은 규칙)
  const grace = roundLeft > roundTime - startGrace();
  if (!canAct || sim.rollT > 0 || grace) atk = false;
  if (atk && localCd <= 0) {
    localCd = prog.stats.cooldown;
    localBeam = CFG.BEAM_TIME; // 즉시 피드백 (판정은 서버)
    shake = Math.max(shake, 0.22);
    sfx.beam();
  }
  if (flare && flareCd <= 0) {
    flareCd = CFG.FLARE_COOLDOWN;
    sfx.flare();
    chars.cast(selfMesh, 'flare'); // 던지는 동작
    track('flare');
  } else flare = false;

  const inp = { seq: ++seq, mx: input.mx, mz: input.mz, yaw: wrapAngle(input.yaw), atk, roll, flare };
  const d = [inp.seq, +inp.mx.toFixed(3), +inp.mz.toFixed(3), +inp.yaw.toFixed(4), atk ? 1 : 0, roll ? 1 : 0, flare ? 1 : 0];
  if (offline) offline.game.queueInput(offline.player.id, d);
  else net.send({ t: 'i', d });
  if (canAct) {
    // 서버가 받는 것과 같은 (양자화된) 값으로 예측
    inp.mx = d[1];
    inp.mz = d[2];
    inp.yaw = d[3];
    pending.push(inp);
    if (pending.length > 60) pending.shift();
    const wasRolling = sim.rollT > 0;
    const wasDashing = sim.dashT > 0;
    stepPlayer(sim, inp, DT, curMap.solid);
    if (sim.rollT > 0 && !wasRolling) {
      sfx.roll();
      track('skill');
    }
    if (sim.dashT > 0 && !wasDashing) {
      sfx.skill('dash');
      dashStartFx(selfMesh, view);
      track('skill');
    }
    sim.cast = null; // 그 밖의 스킬 효과는 서버가 적용한다
    // 발소리
    if (Math.hypot(inp.mx, inp.mz) > 0.3 && sim.rollT <= 0) {
      stepT -= DT;
      if (stepT <= 0) {
        stepT = 0.34;
        sfx.step(0.7);
      }
    }
  }
  if (offline) {
    offline.game.step();
    if (offline.game.tick % CFG.SNAPSHOT_EVERY === 0) offline.game.broadcast();
  }
}

// ───────────────────────── 프레임 ─────────────────────────
const frustum = new THREE.Frustum();
const projView = new THREE.Matrix4();
const sphere = new THREE.Sphere(new THREE.Vector3(), 1.3);
const sources = [];
const flareSources = [];
const minimap = new Minimap($('minimap'), curMap, MAP_SIZE);
const mapEnts = [];
const stats = { fps: 0, walls: 0, players: 0, calls: 0, tris: 0 };
let acc = 0;
let lastT = performance.now();
let frameEma = 16;
let statT = 0;
let frames = 0;

function resize() {
  const w = innerWidth;
  const h = innerHeight;
  renderer.setPixelRatio(BASE_PR * resScale);
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  // 세로 화면에서는 수직 FOV를 넓혀 좌우 시야를 확보
  camera.fov = camera.aspect >= 1 ? 55 : Math.min(85, (2 * Math.atan(Math.tan((55 * Math.PI) / 360) / camera.aspect) * 180) / Math.PI);
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

function frame(now) {
  requestAnimationFrame(frame);
  const dtMs = Math.min(100, now - lastT);
  lastT = now;
  frameEma = lerp(frameEma, dtMs, 0.05);
  if (showcase.active) {
    // 캐릭터 선택 화면이 열려 있으면 게임 대신 그 장면을 그린다
    renderer.info.reset();
    showcase.render(renderer, dtMs / 1000, now * 0.001, innerWidth, innerHeight);
    for (let i = 0; i < lockEls.length; i++) {
      // 고른 캐릭터는 구매 버튼이 알려 주므로 자물쇠를 띄우지 않는다
      const locked = shopTab === 'chars' && i !== showcase.index && !profile.owned.includes(CHAR_IDS[i]);
      lockEls[i].style.display = locked ? '' : 'none';
      if (!locked) continue;
      const [x, y] = showcase.headPos(i, innerWidth, innerHeight);
      lockEls[i].style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%)`;
    }
    return;
  }
  input.update(dtMs / 1000);
  if (roundEnd > 0) roundEnd -= dtMs / 1000;

  acc += dtMs / 1000;
  while (acc >= DT) {
    fixedStep();
    acc -= DT;
  }
  const alpha = acc / DT;
  view.x = lerp(prev.x, sim.x, alpha);
  view.z = lerp(prev.z, sim.z, alpha);
  view.yaw = lerpAngle(prev.yaw, sim.yaw, alpha);

  // 내 캐릭터
  selfMesh.visible = alive;
  selfMesh.position.set(view.x, 0, view.z);
  selfMesh.rotation.y = view.yaw;
  const dt = dtMs / 1000;
  const tSec = now * 0.001;
  const canActNow = alive && roundEnd <= 0;
  chars.animate(selfMesh, dt, tSec, {
    beam: localBeam > 0,
    roll: sim.rollT > 0 ? 1 - sim.rollT / CFG.ROLL_TIME : -1,
    aimReady: canActNow && localCd <= 0 && sim.rollT <= 0,
    vest: buffs.vest > 0 || buffs.shield > 0,
    cloak: buffs.cloak > 0,
    level: prog.level,
    dash: alive && sim.dashT > 0,
    shield: alive && buffs.shield > 0,
    scan: alive && buffs.scan > 0,
  });
  if (alive) skillTrails(view, dt, sim.dashT > 0, buffs.scan > 0);
  deathFx.update(dt);
  skillFx.update(dt);
  drawAura(dt);
  if (alive) dustFor(selfMesh, dt, sim.rollT > 0);
  drawDust(dt);

  // 원격 플레이어 보간
  const rt = now - INTERP_MS;
  for (const e of ents.values()) {
    const b = e.buf;
    let i = b.length - 1;
    while (i > 0 && b[i - 1].t > rt) i--;
    const p1 = b[i];
    const p0 = b[i - 1] ?? p1;
    const t = p1.t > p0.t ? Math.max(0, Math.min(1, (rt - p0.t) / (p1.t - p0.t))) : 1;
    e.x = lerp(p0.x, p1.x, t);
    e.z = lerp(p0.z, p1.z, t);
    e.yaw = lerpAngle(p0.yaw, p1.yaw, t);
    e.mesh.position.set(e.x, 0, e.z);
    e.mesh.rotation.y = e.yaw;
    e.rollP = e.flags & 2 ? Math.min(1, Math.max(0, e.rollP) + dt / CFG.ROLL_TIME) : -1;
    chars.animate(e.mesh, dt, tSec, {
      beam: !!(e.flags & 1), roll: e.rollP, cloak: !!(e.flags & 4), vest: !!(e.flags & 8), level: e.lv,
      dash: !!(e.flags & 32), shield: !!(e.flags & 64), scan: !!(e.flags & 16),
    });
    skillTrails(e, dt, !!(e.flags & 32), !!(e.flags & 16));
    if (!(e.flags & 4)) dustFor(e.mesh, dt, e.rollP >= 0);
    if (e.hitT > 0) {
      // 맞으면 잠깐 움찔
      e.hitT -= dt;
      const k = 1 + Math.max(0, e.hitT) * 1.6;
      e.mesh.scale.set(k, 1 / k, k);
    } else e.mesh.scale.set(1, 1, 1);
  }

  // 아이템: 둥실둥실 떠서 돈다
  for (const g of itemMeshes.values()) {
    const b = g.userData.body;
    b.rotation.y = tSec * 1.8 + g.userData.seed;
    b.position.y = Math.sin(tSec * 3 + g.userData.seed) * 0.12;
  }

  // 버프, 상태창, 반딧불
  drawBuffs();
  if (myId) drawStatus();
  drawFireflies(tSec);
  if (tutor) {
    if (offline && ents.has(tutor.ctx.dummy.id)) tutorSeen = true;
    tutor.update(dt);
  }

  // 조명탄: 깜빡이는 불꽃
  flareSources.length = 0;
  for (let i = 0; i < Math.max(flares.length, flareMeshes.length); i++) {
    const f = flares[i];
    const fm = flareMesh(i);
    fm.visible = !!f;
    if (!f) continue;
    fm.position.set(f[0], 0, f[1]);
    const flick = 0.85 + Math.sin(now * 0.03 + i) * 0.1 + Math.random() * 0.05;
    fm.scale.setScalar(flick * Math.min(1, f[2]));
    flareSources.push({ x: f[0], z: f[1], yaw: 0, view: FLARE_VIEW });
  }

  // 독구름: 구역 크기를 부드럽게 따라가고, 안에 들어가 있으면 화면 경고 + 소리
  const inGame = myId && zoneTarget > 0;
  if (inGame) zoneNow = Math.abs(zoneTarget - zoneNow) > 4 ? zoneTarget : lerp(zoneNow, zoneTarget, Math.min(1, dtMs * 0.008));
  for (const g of gasLayers) g.visible = !!inGame;
  gasMat.uniforms.uHalf.value = zoneNow;
  gasMat.uniforms.uTime.value = now * 0.001;
  const inGas = inGame && alive && roundEnd <= 0 && Math.max(Math.abs(view.x), Math.abs(view.z)) > zoneNow;
  const danger = inGas ? Math.max(0.35, gas / ZONE.GAS_TIME) : inGame && alive ? Math.min(0.3, gas / ZONE.GAS_TIME) : 0;
  $('gas').style.opacity = danger.toFixed(2);
  $('gasText').hidden = !inGas;
  if (inGas) {
    $('gasText').textContent = `독구름! ${Math.max(0, ZONE.GAS_TIME - gas).toFixed(1)}`;
    gasSfxT -= dtMs / 1000;
    if (gasSfxT <= 0) {
      gasSfxT = 0.6;
      sfx.gas();
    }
  } else gasSfxT = 0;

  // 1) 시야 마스크: 나 + 팀원 + 팀 조명탄의 시야 합집합. 관전 중이면 보고 있는 플레이어 팀의 시야.
  const watching = !alive && watchId ? ents.get(watchId) : null;
  const visTeam = watching ? roster.get(watchId)?.team : myTeam;
  sources.length = 0;
  if (alive) sources.push(view);
  for (const [id, e] of ents) if (roster.get(id)?.team === visTeam) sources.push(e);
  sources.push(...flareSources);
  // 매의 눈: 사방 시야 (나, 그리고 스킬을 쓴 아군)
  if (alive && buffs.scan > 0) sources.push({ x: view.x, z: view.z, yaw: 0, view: SCAN_VIEW });
  for (const [id, e] of ents) if (e.flags & 16 && roster.get(id)?.team === visTeam) sources.push({ x: e.x, z: e.z, yaw: 0, view: SCAN_VIEW });
  drawWatch(watching);
  renderer.info.reset();
  mask.update(renderer, sources);

  // 2) 카메라 (캐릭터 뒤 위쪽에서 따라가는 3인칭). 관전 중이면 보고 있는 플레이어를 따라간다.
  const tgt = watching || view;
  if (!camFocus.init || (!watching && alive)) Object.assign(camFocus, { x: tgt.x, z: tgt.z, yaw: tgt.yaw, init: true });
  else {
    const k = Math.min(1, dt * 5);
    camFocus.x += (tgt.x - camFocus.x) * k;
    camFocus.z += (tgt.z - camFocus.z) * k;
    camFocus.yaw += wrapAngle(tgt.yaw - camFocus.yaw) * k;
  }
  const cv = camFocus;
  const s = Math.sin(cv.yaw);
  const c = Math.cos(cv.yaw);
  shake = Math.max(0, shake - dt * 2.6);
  const sk = shake * shake * 1.1;
  camera.position.set(
    cv.x - s * 9 * prefs.zoom + (Math.random() - 0.5) * sk,
    17 * prefs.zoom + (Math.random() - 0.5) * sk,
    cv.z - c * 9 * prefs.zoom + (Math.random() - 0.5) * sk,
  );
  camera.lookAt(cv.x + s * 4.5 * prefs.zoom, 0, cv.z + c * 4.5 * prefs.zoom);
  camera.updateMatrixWorld();
  projView.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  frustum.setFromProjectionMatrix(projView);

  // 3) 컬링: (시야에 걸린 벽) ∩ (화면 절두체 안) 만 인스턴스 버퍼에 넣는다
  let nWalls = 0;
  for (let i = 0; i < wallProps.length; i++) {
    const p = wallProps[i];
    p.mesh.visible = !!mask.seen[i] && frustum.intersectsSphere(p.sphere);
    if (p.mesh.visible) nWalls++;
  }

  let nPlayers = 0;
  for (const e of ents.values()) {
    sphere.center.set(e.x, 0.9, e.z);
    e.mesh.visible = frustum.intersectsSphere(sphere);
    if (e.mesh.visible) nPlayers++;
  }
  drawLabels();

  renderer.render(scene, camera);

  // 풀벌레 소리
  if (myId && (cricketT -= dt) <= 0) {
    cricketT = 0.8 + Math.random() * 2.6;
    sfx.cricket();
  }

  // 미니맵 (초당 10회)
  if (prefs.showMinimap && now - mapT > 100) {
    mapT = now;
    mapEnts.length = 0;
    for (const [id, e] of ents) mapEnts.push({ x: e.x, z: e.z, kind: kindOf(id) });
    minimap.draw({ me: view, alive, ents: mapEnts, flares, items: itemsSeen.map(([, , x, z]) => ({ x, z })), zone: zoneTarget ? zoneNow : 0, fov: CFG.FOV, range: CFG.VIEW_RANGE });
  }

  // 스킬 버튼 쿨다운 (매 프레임)
  const canAct = alive && roundEnd <= 0;
  drawSkill('attack', localCd, prog.stats.cooldown, canAct);
  drawSkill('roll', sim.rollCd, prog.stats.rollCd, canAct);
  drawSkill('flare', flareCd, CFG.FLARE_COOLDOWN, canAct);

  // HUD / 통계 / 적응형 해상도
  frames++;
  if (now - statT > 500) {
    stats.fps = Math.round((frames * 1000) / (now - statT));
    stats.walls = nWalls;
    stats.players = nPlayers;
    stats.calls = renderer.info.render.calls;
    stats.tris = renderer.info.render.triangles;
    frames = 0;
    statT = now;
    if (prefs.showStats) $('stats').textContent =
      `${stats.fps} fps  x${resScale.toFixed(2)}\n` +
      `draw ${stats.calls}  tri ${stats.tris}\n` +
      `벽 ${nWalls}/${curMap.walls.length}  플레이어 ${nPlayers}/${Math.max(0, roster.size - 1)}`;
    // 프레임이 떨어지면 해상도를 낮추고, 여유가 있으면 되돌린다
    if (!qual().adaptive) {
      // 고정 품질
    } else if (frameEma > 24 && resScale > 0.55) {
      resScale -= 0.1;
      resize();
    } else if (frameEma < 15 && resScale < 1) {
      resScale = Math.min(1, resScale + 0.05);
      resize();
    }
    $('dead').hidden = alive || !myId || roundEnd > 0;
    $('deadBy').textContent = killedBy ? `처치자: ${killedBy}` : '';
    $('respawn').textContent = rule === 'survival' ? '다음 라운드까지 대기' : `${Math.ceil(respawnIn)}초 후 부활`;
    if (roundEnd > 0) $('bannerSub').textContent = `${winnerText} · ${Math.ceil(roundEnd)}초 후 다음 라운드`;
    if (myId) drawScore();
    // 라운드 시작 카운트다운 (공격 금지 시간)
    const count = roundEnd > 0 || !alive ? 0 : Math.max(0, roundLeft - (roundTime - startGrace()));
    if (count !== lastCount) {
      if (count > 0) toast(String(count), curMap.name, 'count');
      else if (lastCount > 0) toast('시작!', '', 'count');
      lastCount = count;
    }
  }
}
requestAnimationFrame(frame);

// ───────────────────────── 시작 ─────────────────────────
$('name').value = params.get('name') || localStorage.getItem('frustum.name') || '';
function remember(name) {
  try {
    localStorage.setItem('frustum.name', name);
  } catch {}
}
const stored = (k) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const MODES = { ffa: 'modeFfa', duo: 'modeDuo' };
const RULE_BTNS = { dm: 'ruleDm', score: 'ruleScore', survival: 'ruleSurvival' };
const pick = (table, ...cands) => cands.find((c) => c && Object.hasOwn(table, c));
let menuMode = pick(MODES, params.get('mode'), stored('frustum.mode')) || 'duo';
let menuRule = pick(RULE_BTNS, params.get('rule'), stored('frustum.rule')) || 'dm';
function drawPicks() {
  for (const [m, id] of Object.entries(MODES)) $(id).classList.toggle('on', menuMode === m);
  for (const [r, id] of Object.entries(RULE_BTNS)) $(id).classList.toggle('on', menuRule === r);
}
function bindPick(table, key, set) {
  for (const [v, id] of Object.entries(table)) {
    $(id).addEventListener('click', () => {
      set(v);
      try {
        localStorage.setItem(key, v);
      } catch {}
      drawPicks();
      drawLobby();
    });
  }
}
bindPick(MODES, 'frustum.mode', (v) => (menuMode = v));
bindPick(RULE_BTNS, 'frustum.rule', (v) => (menuRule = v));
drawPicks();
// 가로 화면 고정을 시도한다 (지원하는 브라우저/설치형 앱에서만 동작. 대부분 전체 화면일 때만 된다)
const lockLandscape = () => screen.orientation?.lock?.('landscape')?.catch?.(() => {});

// 전체 화면: 주소창과 아래 네비게이션 바를 숨긴다. 브라우저 규칙상 화면을 '누른 순간'에만 켤 수 있다.
const canFullscreen = !!(document.documentElement.requestFullscreen || document.documentElement.webkitRequestFullscreen);
const standalone = matchMedia('(display-mode: fullscreen), (display-mode: standalone)').matches || navigator.standalone;
const isFullscreen = () => !!(document.fullscreenElement || document.webkitFullscreenElement);
function goFullscreen() {
  if (!prefs.fullscreen || !canFullscreen || standalone || isFullscreen()) return;
  const el = document.documentElement;
  const req = el.requestFullscreen ? el.requestFullscreen({ navigationUI: 'hide' }) : el.webkitRequestFullscreen();
  Promise.resolve(req).then(lockLandscape).catch(() => {});
}
// 손을 뗄 때(터치) 또는 클릭할 때가 브라우저가 전체 화면을 허락하는 순간이다
addEventListener('pointerup', goFullscreen, { capture: true });
addEventListener('click', goFullscreen, { capture: true });
addEventListener('keydown', (e) => e.key !== 'Escape' && goFullscreen(), { capture: true });

// 앱 설치: 안드로이드 크롬·삼성 인터넷은 설치 창을 띄울 수 있다. 아이폰은 '공유 → 홈 화면에 추가'.
let installEvent = null;
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
function drawInstall() {
  const row = $('installRow');
  if (standalone) return (row.hidden = true);
  row.hidden = false;
  $('installApp').hidden = !installEvent;
  $('installNote').textContent = installEvent
    ? '홈 화면에서 주소창 없이 바로 열려요'
    : isIOS
      ? '사파리 아래 공유(□↑) → "홈 화면에 추가"를 누르세요'
      : '브라우저 메뉴(⋮) → "홈 화면에 추가" 또는 "앱 설치"를 누르세요';
}
addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installEvent = e;
  drawInstall();
});
addEventListener('appinstalled', () => {
  installEvent = null;
  $('installRow').hidden = true;
});
$('installApp').addEventListener('click', async () => {
  if (!installEvent) return;
  installEvent.prompt();
  await installEvent.userChoice.catch(() => {});
  installEvent = null;
  drawInstall();
});
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
// 아이폰 사파리는 전체 화면 기능이 없어서 설정 줄을 숨긴다
if (!canFullscreen || standalone) $('fsRow').hidden = true;

// 로비 배경음악: 로비·방·상점에 있을 때만, 게임에 들어가면 멈춘다
const music = new Music(sfx);
function syncMusic() {
  const inMenu = !myId;
  if (prefs.music && inMenu && sfx.ready) music.start();
  else music.stop();
}
addEventListener('pointerdown', () => setTimeout(syncMusic, 50), { capture: true });
setInterval(syncMusic, 1000);
$('play').addEventListener('click', () => {
  lockLandscape();
  const name = $('name').value.trim() || 'Player';
  remember(name);
  if (lobby.online) connect(name, menuMode, menuRule);
  else startOffline(name, menuMode, menuRule).catch((e) => ($('status').textContent = '시작 실패: ' + e.message));
});

// ───────────────────────── 설정 ─────────────────────────
function buzz(ms) {
  if (prefs.vibrate && navigator.vibrate) navigator.vibrate(ms);
}
function applyPrefs() {
  input.setOptions({ fixedStick: prefs.fixedStick, lefty: prefs.lefty, sens: prefs.sens });
  sfx.setVolume(prefs.volume);
  document.body.classList.toggle('lefty', prefs.lefty);
  $('stats').hidden = !prefs.showStats;
  $('minimap').hidden = !prefs.showMinimap;
  $('sensVal').textContent = `x${prefs.sens.toFixed(1)}`;
  $('volVal').textContent = `${Math.round(prefs.volume * 100)}%`;
  $('zoomVal').textContent = `x${prefs.zoom.toFixed(2)}`;
  if (!prefs.fullscreen && isFullscreen()) (document.exitFullscreen || document.webkitExitFullscreen)?.call(document);
  syncMusic();
  drawInstall();
  drawCheat();
}
// 치트 모드: 켜고 끌 때마다 코인을 맞추고 서버(또는 오프라인 게임)에 바로 알린다
let cheatSent = '';
function drawCheat() {
  $('cheatOpts').hidden = !prefs.cheat;
  document.body.classList.toggle('cheating', prefs.cheat);
  const key = JSON.stringify([cheatPayload(), cheatCoinsOn()]);
  if (key === cheatSent) return;
  const first = !cheatSent;
  cheatSent = key;
  applyCheatCoins();
  drawProfile();
  if (first) return;
  if (offline) {
    offline.player.cheat = cheatPayload();
    offline.game.applyStats(offline.player);
  } else if (net.ready) sendHello();
}
drawProfile();
drawDaily();
const CHECKS = { setCheat: 'cheat', setCheatCoins: 'cheatCoins', setCheatGod: 'cheatGod', setCheatXp: 'cheatXp', setCheatCd: 'cheatCd', setCheatSpeed: 'cheatSpeed', setFixed: 'fixedStick', setLefty: 'lefty', setVibrate: 'vibrate', setStats: 'showStats', setMinimap: 'showMinimap', setFullscreen: 'fullscreen', setMusic: 'music' };
const RANGES = { setSens: 'sens', setVol: 'volume', setZoom: 'zoom' };
for (const [id, key] of Object.entries(CHECKS)) {
  $(id).checked = prefs[key];
  $(id).addEventListener('change', () => {
    prefs[key] = $(id).checked;
    savePrefs();
    applyPrefs();
  });
}
for (const [id, key] of Object.entries(RANGES)) {
  $(id).value = prefs[key];
  $(id).addEventListener('input', () => {
    prefs[key] = Number($(id).value);
    savePrefs();
    applyPrefs();
  });
}
// 게임에서 나온다: 온라인이면 연결은 유지하고 서버에 알린다 (친선 방에 있었다면 방으로 돌아간다)
function exitGame() {
  endTutorial();
  if (offline) offline = null;
  else if (myId) net.send({ t: 'leave' });
  showMenu('');
}
// ── 그래픽 품질 ──
const QUALITY_NOTE = {
  auto: '자동: 폰 성능에 맞춰 해상도를 조절해요',
  low: '낮음: 오래된 폰도 부드럽게 (꾸밈·흙먼지 끔)',
  mid: '보통: 화질과 배터리의 중간',
  high: '높음: 가장 선명하게 (배터리를 더 써요)',
};
function applyQuality() {
  const q = qual();
  BASE_PR = Math.min(devicePixelRatio || 1, q.cap);
  resScale = q.scale ?? Math.min(1, resScale);
  if (decoMesh) decoMesh.visible = q.deco !== false;
  if (glowMesh) glowMesh.visible = q.deco !== false;
  for (const b of $('qualityPick').children) b.classList.toggle('on', b.dataset.q === (QUALITY[prefs.quality] ? prefs.quality : 'auto'));
  $('qualityNote').textContent = QUALITY_NOTE[prefs.quality] || QUALITY_NOTE.auto;
  resize();
}
for (const b of $('qualityPick').children) {
  b.addEventListener('click', () => {
    prefs.quality = b.dataset.q;
    savePrefs();
    applyQuality();
  });
}

// ── 데이터 백업 ── (이 기기에만 저장되므로 코드/파일로 사본을 남긴다)
navigator.storage?.persist?.().catch(() => {}); // 브라우저가 저장 공간을 함부로 비우지 않게 요청
function backupCode() {
  const p = { ...profile };
  if (cheatCoinsOn() && prefs.realCoins !== null) p.coins = prefs.realCoins; // 치트 코인 말고 진짜 코인
  return encodeBackup(p);
}
const needBackup = () => !prefs.backupAt && (profile.owned.length > 1 || profile.skins.length > 1 || profile.xp > 1500);
function drawBackup(msg = '') {
  const when = prefs.backupAt ? new Date(prefs.backupAt).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
  $('backupNote').textContent = msg || (when ? `마지막 백업: ${when} · 새로 모은 것은 다시 백업하세요` : '코인·캐릭터·스킨은 이 기기에만 저장돼요. 백업 코드를 꼭 보관하세요');
  $('openSettings').classList.toggle('hasNew', needBackup());
}
function markBackup(msg) {
  prefs.backupAt = Date.now();
  savePrefs();
  drawBackup(msg);
}
function openRestore(code = '', msg = '') {
  $('restoreCode').value = code;
  $('restoreMsg').textContent = msg;
  $('restoreMsg').className = 'hint';
  $('restorePanel').hidden = false;
  if (code) $('restoreCode').select();
}
$('backupCopy').addEventListener('click', async () => {
  const code = backupCode();
  try {
    await navigator.clipboard.writeText(code);
    markBackup('복사했어요! 메모장이나 "나에게 보내기"에 붙여 넣어 두세요');
  } catch {
    openRestore(code, '아래 코드를 길게 눌러 전체 선택 → 복사해서 보관하세요');
    markBackup();
  }
});
$('backupFile').addEventListener('click', () => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([backupCode()], { type: 'text/plain' }));
  a.download = `frustum-backup-${dayKey()}.txt`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 3000);
  markBackup('파일로 저장했어요 (다운로드 폴더)');
});
$('backupRestore').addEventListener('click', () => openRestore());
$('restoreClose').addEventListener('click', () => ($('restorePanel').hidden = true));
$('restoreFile').addEventListener('change', async (e) => {
  const f = e.target.files?.[0];
  if (f) $('restoreCode').value = (await f.text()).trim();
  e.target.value = '';
});
$('restoreGo').addEventListener('click', () => {
  const r = decodeBackup($('restoreCode').value);
  const msg = $('restoreMsg');
  if (!r) {
    msg.textContent = '코드가 올바르지 않아요. 빠진 글자 없이 전부 붙여 넣었는지 확인해 주세요.';
    msg.className = 'hint err';
    return;
  }
  const when = r.savedAt ? new Date(r.savedAt).toLocaleString('ko-KR') : '';
  const sum = `코인 ${Math.floor(r.profile.coins)} · 캐릭터 ${r.profile.owned.length}개 · 의상 ${r.profile.skins.length}개`;
  if (!confirm(`${when ? when + ' 백업\n' : ''}${sum}\n\n이 기기의 지금 데이터를 이 백업으로 바꿀까요?`)) return;
  if (cheatCoinsOn()) prefs.realCoins = r.profile.coins; // 치트 중이면 진짜 코인 자리에
  prefs.backupAt = r.savedAt || Date.now();
  savePrefs();
  try {
    localStorage.setItem(PROFILE_KEY, JSON.stringify(r.profile));
  } catch {}
  msg.textContent = '복구했어요! 다시 불러오는 중…';
  msg.className = 'hint ok';
  setTimeout(() => location.reload(), 500);
});

function openSettings() {
  drawBackup();
  $('tutorAgain').hidden = !!myId;
  $('leave').hidden = !myId;
  $('leave').textContent = party?.active && !offline ? '방으로 돌아가기' : '게임 나가기';
  $('settings').hidden = false;
}
$('openSettings').addEventListener('click', openSettings);
$('gear').addEventListener('pointerdown', (e) => {
  e.preventDefault();
  e.stopPropagation();
  openSettings();
});
$('closeSettings').addEventListener('click', () => ($('settings').hidden = true));
$('leave').addEventListener('click', () => {
  $('settings').hidden = true;
  exitGame();
});
applyPrefs();
applyQuality();
drawBackup();
{
  // 시즌이 바뀌었으면 지난 시즌 보상
  const sr = seasonRollover(profile);
  if (sr) saveProfile();
  if (sr) setTimeout(() => toast('새 시즌 시작! 🏅', `지난 시즌 ${sr.rank} 보상 🪙 ${sr.coins}`, 'buff'), 1200);
}

// 내 친구 코드: 처음 실행할 때 한 번 만든다
if (!profile.fc) {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  profile.fc = Array.from({ length: 6 }, () => abc[Math.floor(Math.random() * abc.length)]).join('');
  saveProfile();
}
party = initParty({
  $, net, profile, saveProfile, sfx, buzz, CHARACTERS, MAPS, params, remote, lockLandscape, ensureOnline, openRoomSettings,
  hello: sendHello,
  picks: () => ({ rule: menuRule, mode: menuMode, map: lobby.map }),
  status: (msg) => ($('status').textContent = msg),
  inGame: () => !!myId,
  exitGame,
  enterLobby,
  openShop,
  hideLobby: () => {
    $('menu').style.display = 'none';
    showcase.lobby = true;
    showcase.empty = true; // 방 화면에서는 배경만 그린다
    if (!showcase.active) showcase.open(profile.char);
  },
});
// 온라인 여부: 지난번 선택, 처음이면 서버가 정해져 있을 때 온라인
const savedOnline = stored('frustum.online');
lobby.online = savedOnline !== null ? savedOnline === '1' : !!remote();
enterLobby();
if (lobby.online && (remote() || !STATIC_HOST)) net.open(); // 로비에서도 연결해 두어야 초대를 받는다
let helloTimer = 0;
$('name').addEventListener('input', () => {
  clearTimeout(helloTimer);
  helloTimer = setTimeout(() => net.ready && sendHello(), 600);
});
if (params.has('offline')) startOffline($('name').value || 'Player', menuMode, menuRule);
else if (params.has('auto')) connect($('name').value || 'Player', menuMode, menuRule);

// 디버그/자동 테스트용 핸들
window.__frustum = {
  music, get fullscreen() { return isFullscreen(); }, dustCount: () => dustMesh.count,
  skillFx, ents, roster, sim, view, stats, mask, input, sfx, prefs, buffs, itemMeshes, profile, prog, drawShop, showcase, lobby, net, get party() { return party; },
  get map() { return curMap.id; },
  get alive() { return alive; },
  get myId() { return myId; },
  get flares() { return flares; },
  get offline() { return offline; },
};
