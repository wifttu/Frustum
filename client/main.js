import * as THREE from 'three';
import { CFG, FLARE_VIEW, ITEMS, SCAN_VIEW, ZONE } from './shared/config.js';
import { MAP_SIZE, MAPS } from './shared/map.js';
import { stepPlayer } from './shared/sim.js';
import { wrapAngle } from './shared/vision.js';
import { VisionMask } from './fog.js';
import { Input } from './input.js';
import { Sfx } from './audio.js';
import { DEFAULT_SERVER, normalizeServer } from './settings.js';
import { prefs, savePrefs } from './prefs.js';
import { CHARACTERS, PROGRESS, SKILLS, UPGRADES, charOf, statsOf, xpToNext } from './shared/progress.js';
import { Characters, DeathFx } from './character.js';
import { Minimap } from './minimap.js';
import { buildFloorTexture, buildItemGeos, buildWalls, buildWater } from './world.js';
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
const BASE_PR = Math.min(devicePixelRatio || 1, 2);
let resScale = 1;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(55, 1, 0.5, 120);
// 따뜻한 손전등/모닥불 톤의 조명
scene.add(new THREE.HemisphereLight(0xfff0d8, 0x6b5a45, 1.45));
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

// 맵 교체: 소품, 바닥, 물, 시야 마스크, 미니맵을 새 맵으로 다시 만든다
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
  net.send({ t: 'j', n: name, m: gameMode, r: gameRule, c: profile.char, s: profile.skin, map: lobby.map });
}

// 내 프로필을 서버에 알린다 (친구 접속 상태, 방 화면에 쓰인다)
function sendHello() {
  net.send({ t: 'hi', n: $('name').value.trim() || 'Player', c: profile.char, s: profile.skin, i: profile.icon, fc: profile.fc });
}

// 오프라인(혼자 하기): 서버와 같은 Game 클래스를 브라우저에서 실행한다. 메시지 형식도 같아서 아래 코드는 구분하지 않는다.
async function startOffline(name, gameMode, gameRule) {
  $('status').textContent = '불러오는 중…';
  const { Game } = await import('./server/game.js');
  const game = new Game({ mode: gameMode, rule: gameRule, ...(lobby.map ? { map: lobby.map, FIXED_MAP: true } : {}) });
  game.balanceBots();
  const player = game.addPlayer(name, (msg) => onMessage(JSON.parse(msg)), false, profile.char, profile.skin); // 봇 한 자리를 이어받는다
  offline = { game, player };
  onMessage({ t: 'w', id: player.id, team: player.team, ...game.info() });
}

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
    if (m.map) setMap(m.map);
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
    $('banner').hidden = false;
    won ? sfx.win() : sfx.lose();
  } else if (m.t === 'b') {
    // 반사 조끼가 빛을 막았다
    for (const [k, v] of m.l) {
      const at = v === myId ? view : ents.get(v);
      if (at) deathFx.spawn(at.x, at.z, 'shield');
      if (v === myId || k === myId) sfx.block();
      if (v === myId) toast('막았다!', '반사 조끼가 빛을 튕겨냈어요', 'buff');
      else if (k === myId) toast('막혔다!', '상대가 반사 조끼를 입었어요');
    }
  } else if (m.t === 'n') {
    if (m.map) setMap(m.map);
    roundEnd = 0;
    snapNext = true;
    $('banner').hidden = true;
    killedBy = '';
    streak = 0;
  } else if (m.t === 'st') {
    // 내 성장 정보
    const leveled = m.lv > prog.level;
    addProfileXp(m.earned - prog.earned);
    Object.assign(prog, { level: m.lv, next: m.next, ups: m.ups, choices: m.ch, more: m.more, stats: m.st, earned: m.earned });
    applyMyStats();
    drawChoices();
    if (leveled) {
      popNumber(view.x, view.z, 'LEVEL UP ⬆', 'lvup');
      sfx.levelUp();
      deathFx.spawn(view.x, view.z, 'level');
      buzz(30);
    }
  } else if (m.t === 'c') {
    // 스킬 사용: 보이는 플레이어(또는 나)에게만 효과를 낸다
    for (const [id, skill] of m.l) {
      const at = id === myId ? view : ents.get(id);
      if (!at) continue;
      const [vol, pan] = id === myId ? [1, 0] : spatial(at.x, at.z);
      sfx.skill(skill, vol, pan);
      if (skill === 'heal' || skill === 'magnet' || skill === 'scan') deathFx.spawn(at.x, at.z, skill === 'heal' ? 'heal' : 'level');
      if (skill === 'shield') deathFx.spawn(at.x, at.z, 'shield');
    }
  } else if (m.t === 'h') {
    // 손전등 피해: 보이는 대상에게만 숫자를 띄운다
    for (const [k, v, dmg] of m.l) {
      if (dmg < 0) {
        // 치유
        const at = v === myId ? view : ents.get(v);
        if (at) popNumber(at.x, at.z, `+${-dmg}`, 'heal');
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
  const wasAlive = alive;
  alive = !!al;
  roundLeft = m.rt ?? 0;
  respawnIn = resp;
  gas = gasT || 0;
  zoneTarget = m.zh || 0;
  flareCd = fcd;
  buffs.vest = vestT || 0;
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
  if (m.xp !== undefined && m.xp > prog.xp && m.xp - prog.xp <= PROGRESS.XP_FIREFLY * 3) sfx.firefly();
  if (m.xp !== undefined) prog.xp = m.xp;
  if (m.ff) syncFireflies(m.ff);
  for (const type of m.pk || []) {
    toast(ITEMS[type].name, ITEMS[type].desc, 'buff');
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
function drawBoard() {
  const rows = [...roster.entries()].sort((a, b) => pointsOf(b[1]) - pointsOf(a[1]));
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
    const key = `${name}|${e.lv}|${e.hpPct}|${kindOf(id)}`;
    if (e.label.dataset.k !== key) {
      e.label.dataset.k = key;
      e.label.className = kindOf(id);
      e.label.querySelector('b').textContent = e.lv;
      e.label.querySelector('i').textContent = name;
      e.label.querySelector('u').style.transform = `scaleX(${(e.hpPct / 100).toFixed(2)})`;
    }
    projV.set(e.x, 2.45, e.z).project(camera);
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
  btn.querySelector('i').textContent = sk.icon;
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
      b.innerHTML = `<i>${u.icon}</i><b></b><span></span><em>${'●'.repeat(lvl)}${'○'.repeat(u.max - lvl)}</em>`;
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
    projV.set(view.x, 2.45, view.z).project(camera);
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
const FF_MAX = 64;
const ffMesh = new THREE.InstancedMesh(
  new THREE.SphereGeometry(0.11, 8, 6),
  new THREE.MeshBasicMaterial({ color: 0xfff27a }),
  FF_MAX,
);
const ffGlow = new THREE.InstancedMesh(
  new THREE.SphereGeometry(0.42, 10, 8),
  new THREE.MeshBasicMaterial({ color: 0x8a7a10, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
  FF_MAX,
);
ffMesh.frustumCulled = ffGlow.frustumCulled = false;
ffMesh.count = ffGlow.count = 0;
scene.add(ffMesh, ffGlow);
const ffMat = new THREE.Matrix4();
function syncFireflies(list) {
  fireflies = list.slice(0, FF_MAX);
}
function drawFireflies(t) {
  ffMesh.count = ffGlow.count = fireflies.length;
  for (let i = 0; i < fireflies.length; i++) {
    const [id, x, z] = fireflies[i];
    const ph = id * 2.399;
    const fx = x + Math.sin(t * 1.3 + ph) * 0.25;
    const fz = z + Math.cos(t * 1.1 + ph) * 0.25;
    const fy = 0.9 + Math.sin(t * 2.1 + ph) * 0.25;
    const pulse = 0.75 + 0.35 * Math.sin(t * 4 + ph);
    ffMat.makeScale(pulse, pulse, pulse).setPosition(fx, fy, fz);
    ffMesh.setMatrixAt(i, ffMat);
    ffGlow.setMatrixAt(i, ffMat);
  }
  ffMesh.instanceMatrix.needsUpdate = ffGlow.instanceMatrix.needsUpdate = true;
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
function saveProfile() {
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
  $('coins').textContent = `🪙 ${Math.floor(profile.coins)}`;
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
  $('shopCoins').textContent = `🪙 ${Math.floor(profile.coins)}`;
  $('shopName').textContent = c.name;
  const sk = SKILLS[c.skill];
  $('shopAbility').textContent = `${c.icon} ${c.desc}`;
  $('shopSkill').textContent = `${sk.icon} ${sk.name} · ${sk.desc}`;
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
      b.querySelector('i').style.background = sk.color === null ? 'conic-gradient(#4fc46a, #f2c230, #8a68d8, #f2903a, #4fc46a)' : `#${sk.color.toString(16).padStart(6, '0')}`;
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
  $('shopCoins').textContent = `🪙 ${Math.floor(profile.coins)}`;
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
      const icon = r.kind === 'coins' ? '🪙' : r.kind === 'skin' ? '🎨' : CHARACTERS[r.id].icon;
      const name = r.kind === 'coins' ? `코인 ${r.coins}` : r.kind === 'skin' ? `${SKINS[r.id].name} 스킨` : CHARACTERS[r.id].name;
      card.innerHTML = '<i></i><b></b><span></span>';
      card.querySelector('i').textContent = icon;
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
  showcase.lobby = false;
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
  if (party?.active) party.showRoom();
  else enterLobby();
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
}
function drawLobby() {
  const c = CHARACTERS[profile.char];
  const sk = SKILLS[c.skill];
  $('avatar').textContent = profile.icon || c.icon;
  $('lobbyCharName').textContent = profile.skin === 'default' ? c.name : `${c.name} · ${SKINS[profile.skin].name}`;
  $('lobbySkill').textContent = `${sk.icon} ${sk.name} · ${c.desc}`;
  $('modeText').textContent = `${RULE_NAMES[menuRule]} · ${MODE_NAMES[menuMode]}`;
  $('mapText').textContent = lobby.map ? `맵: ${MAPS[lobby.map].name}` : '맵: 순환';
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
      b.textContent = x.icon || CHARACTERS[profile.char].icon;
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

const MAP_BTNS = { '': 'mapAuto', camp: 'mapCamp', forest: 'mapForest', lake: 'mapLake' };
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
const BUFF_ICONS = { sneakers: '👟', vest: '🛡️', cloak: '👻', dash: '💨', shield: '🛡️', scan: '👁️' };
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
      el.textContent = `${BUFF_ICONS[t]} ${BUFF_NAMES[t] || ITEMS[t].name} ${Math.ceil(r)}`;
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
function toast(title, sub = '', cls = '') {
  const el = $('toast');
  el.className = cls;
  $('toastTitle').textContent = title;
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
  const grace = roundLeft > roundTime - CFG.START_GRACE;
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
    if (sim.rollT > 0 && !wasRolling) sfx.roll();
    if (sim.dashT > 0 && !wasDashing) sfx.skill('dash');
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
  });
  deathFx.update(dt);

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
    chars.animate(e.mesh, dt, tSec, { beam: !!(e.flags & 1), roll: e.rollP, cloak: !!(e.flags & 4), vest: !!(e.flags & 8) });
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

  // 1) 시야 마스크: 나 + 팀원 + 팀 조명탄의 시야 합집합
  sources.length = 0;
  if (alive) sources.push(view);
  for (const [id, e] of ents) if (roster.get(id)?.team === myTeam) sources.push(e);
  sources.push(...flareSources);
  // 매의 눈: 사방 시야 (나, 그리고 스킬을 쓴 아군)
  if (alive && buffs.scan > 0) sources.push({ x: view.x, z: view.z, yaw: 0, view: SCAN_VIEW });
  for (const [id, e] of ents) if (e.flags & 16 && roster.get(id)?.team === myTeam) sources.push({ x: e.x, z: e.z, yaw: 0, view: SCAN_VIEW });
  renderer.info.reset();
  mask.update(renderer, sources);

  // 2) 카메라 (캐릭터 뒤 위쪽에서 따라가는 3인칭)
  const s = Math.sin(view.yaw);
  const c = Math.cos(view.yaw);
  shake = Math.max(0, shake - dt * 2.6);
  const sk = shake * shake * 1.1;
  camera.position.set(
    view.x - s * 9 * prefs.zoom + (Math.random() - 0.5) * sk,
    17 * prefs.zoom + (Math.random() - 0.5) * sk,
    view.z - c * 9 * prefs.zoom + (Math.random() - 0.5) * sk,
  );
  camera.lookAt(view.x + s * 4.5 * prefs.zoom, 0, view.z + c * 4.5 * prefs.zoom);
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
    if (frameEma > 24 && resScale > 0.55) {
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
    const count = roundEnd > 0 || !alive ? 0 : Math.max(0, roundLeft - (roundTime - CFG.START_GRACE));
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
// 가로 화면 고정을 시도한다 (지원하는 브라우저/설치형 앱에서만 동작)
const lockLandscape = () => screen.orientation?.lock?.('landscape')?.catch?.(() => {});
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
}
drawProfile();
drawDaily();
const CHECKS = { setFixed: 'fixedStick', setLefty: 'lefty', setVibrate: 'vibrate', setStats: 'showStats', setMinimap: 'showMinimap' };
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
  if (offline) offline = null;
  else if (myId) net.send({ t: 'leave' });
  showMenu('');
}
function openSettings() {
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
  ents, roster, sim, view, stats, mask, input, sfx, prefs, buffs, itemMeshes, profile, prog, drawShop, showcase, lobby, net, get party() { return party; },
  get map() { return curMap.id; },
  get alive() { return alive; },
  get myId() { return myId; },
  get flares() { return flares; },
  get offline() { return offline; },
};
