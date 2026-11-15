import * as THREE from 'three';
import { CFG, FLARE_VIEW, ZONE } from './shared/config.js';
import { MAP_SIZE, WALLS, WALL_HEIGHT } from './shared/map.js';
import { stepPlayer } from './shared/sim.js';
import { wrapAngle } from './shared/vision.js';
import { VisionMask } from './fog.js';
import { Input } from './input.js';
import { Sfx } from './audio.js';
import { DEFAULT_SERVER } from './settings.js';
import { prefs, savePrefs } from './prefs.js';

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
scene.add(new THREE.HemisphereLight(0xcfe3ff, 0x30363c, 1.5));
const sun = new THREE.DirectionalLight(0xffffff, 1.4);
sun.position.set(0.4, 1, 0.25);
scene.add(sun);

const mask = new VisionMask(MAP_SIZE, WALLS, CFG);
const sfx = new Sfx();

// 바닥: 시야 밖에서도 격자만 아주 희미하게 남긴다(지형 정보만, 플레이어 정보 없음)
{
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#56616b';
  g.fillRect(0, 0, 128, 128);
  g.strokeStyle = '#6f7c88';
  g.lineWidth = 4;
  g.strokeRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(MAP_SIZE / 4, MAP_SIZE / 4);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(MAP_SIZE, MAP_SIZE).rotateX(-Math.PI / 2),
    mask.apply(new THREE.MeshLambertMaterial({ map: tex }), 0.05),
  );
  scene.add(floor);
}

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

// 벽: InstancedMesh 하나(드로우콜 1회). 매 프레임 "보이는 벽"만 인스턴스 버퍼에 채운다.
const wallMesh = new THREE.InstancedMesh(
  new THREE.BoxGeometry(1, 1, 1),
  mask.apply(new THREE.MeshLambertMaterial({ color: 0x9aa9b8 })),
  WALLS.length,
);
wallMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
wallMesh.frustumCulled = false; // 직접 컬링한다
scene.add(wallMesh);
const wallMatrices = new Float32Array(WALLS.length * 16);
const wallSpheres = WALLS.map((w, i) => {
  new THREE.Matrix4()
    .compose(new THREE.Vector3(w.cx, WALL_HEIGHT / 2, w.cz), new THREE.Quaternion(), new THREE.Vector3(w.w, WALL_HEIGHT, w.d))
    .toArray(wallMatrices, i * 16);
  return new THREE.Sphere(new THREE.Vector3(w.cx, WALL_HEIGHT / 2, w.cz), Math.hypot(w.w, WALL_HEIGHT, w.d) / 2);
});

// 손전등 빔: 판정 범위(ATTACK_RANGE, ATTACK_ARC)와 똑같은 모양의 부채꼴. 손에서 멀어질수록 흐려진다.
function makeBeamGeometry() {
  const seg = 16;
  const pos = [0.35, 0.9, 0.5];
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

// 플레이어 메시 (지오메트리/머티리얼 공유)
const geo = {
  body: new THREE.CylinderGeometry(0.42, 0.45, 1.2, 12).translate(0, 0.6, 0),
  head: new THREE.SphereGeometry(0.3, 12, 8).translate(0, 1.5, 0),
  visor: new THREE.BoxGeometry(0.36, 0.12, 0.2).translate(0, 1.52, 0.24),
  torch: new THREE.CylinderGeometry(0.07, 0.11, 0.5, 8).rotateX(Math.PI / 2).translate(0.38, 0.9, 0.35),
  beam: makeBeamGeometry(),
  flare: new THREE.SphereGeometry(0.16, 8, 6).translate(0, 0.16, 0),
  glow: new THREE.CircleGeometry(1.2, 20).rotateX(-Math.PI / 2).translate(0, 0.03, 0),
};
const mat = {
  self: mask.apply(new THREE.MeshLambertMaterial({ color: 0xf2f6fa })),
  ally: mask.apply(new THREE.MeshLambertMaterial({ color: 0x3d9cf0 })),
  enemy: mask.apply(new THREE.MeshLambertMaterial({ color: 0xf0503d })),
  dark: mask.apply(new THREE.MeshLambertMaterial({ color: 0x1b2026 })),
  beam: mask.apply(
    new THREE.MeshBasicMaterial({
      vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false,
    }),
  ),
  flare: new THREE.MeshBasicMaterial({ color: 0xffb070 }),
  glow: new THREE.MeshBasicMaterial({ color: 0x3c1c08, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }),
};
function makePlayerMesh(kind) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(geo.body, mat[kind]);
  const head = new THREE.Mesh(geo.head, mat[kind]);
  g.add(body, head, new THREE.Mesh(geo.visor, mat.dark), new THREE.Mesh(geo.torch, mat.dark));
  const beam = new THREE.Mesh(geo.beam, mat.beam);
  beam.visible = false;
  g.add(beam);
  g.userData = { body, head, beam, kind };
  // 그룹 단위로 컬링하므로 자식의 자동 컬링은 끈다
  g.traverse((o) => (o.frustumCulled = false));
  return g;
}
function setKind(mesh, kind) {
  if (mesh.userData.kind === kind) return;
  mesh.userData.kind = kind;
  mesh.userData.body.material = mesh.userData.head.material = mat[kind];
}
// 구르는 중에는 몸을 납작하게
function setRolling(mesh, rolling) {
  mesh.scale.set(rolling ? 1.15 : 1, rolling ? 0.55 : 1, rolling ? 1.15 : 1);
}

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
let ws = null;
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
let winnerText = '';
let roundEnd = 0; // 라운드 종료 배너 남은 시간
let stepT = 0;
let lastSpot = 0;
const sim = { x: 0, z: 0, yaw: 0, rollT: 0, rollCd: 0, rollDx: 0, rollDz: 1 }; // 예측된 내 상태
const prev = { x: 0, z: 0, yaw: 0 };
const view = { x: 0, z: 0, yaw: 0 }; // 렌더용 보간 상태
const pending = []; // 서버가 아직 확인하지 않은 입력
const roster = new Map(); // id → {name, team, score}  (위치 정보 없음)
// 서버가 보내준(= 시야 안의) 플레이어만 존재한다. 시야에서 벗어나면 즉시 삭제.
const ents = new Map();
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
const REMOTE = params.get('server') || (STATIC_HOST ? DEFAULT_SERVER : '');
function serverBase() {
  if (!REMOTE) return `${location.protocol}//${location.host}`;
  const u = REMOTE.replace(/\/$/, '');
  return /^(https?|wss?):\/\//.test(u) ? u.replace(/^ws/, 'http') : `https://${u}`;
}
const wsUrl = () => serverBase().replace(/^http/, 'ws') + '/ws';

function showMenu(msg) {
  $('menu').style.display = '';
  $('hud').hidden = true;
  $('status').textContent = msg;
  myId = 0;
  alive = false;
  roundEnd = 0;
  flares = [];
  zoneTarget = 0;
  gas = 0;
  pending.length = 0;
  $('banner').hidden = true;
  for (const id of [...ents.keys()]) removeEnt(id);
}

function connect(name, gameMode, gameRule) {
  if (STATIC_HOST && !REMOTE) {
    $('status').textContent = '온라인 서버 주소가 설정되지 않았습니다. 혼자 하기는 서버 없이 됩니다.';
    return;
  }
  // 무료 서버(Render)는 잠들어 있으면 깨어나는 데 1분 가까이 걸린다: 미리 깨우고, 실패하면 다시 시도한다
  if (REMOTE) fetch(serverBase() + '/healthz', { mode: 'no-cors' }).catch(() => {});
  const deadline = performance.now() + 90_000;
  const attempt = () => {
    let opened = false;
    ws = new WebSocket(wsUrl());
    ws.onopen = () => {
      opened = true;
      ws.send(JSON.stringify({ t: 'j', n: name, m: gameMode, r: gameRule }));
    };
    ws.onmessage = (ev) => onMessage(JSON.parse(ev.data));
    ws.onclose = () => {
      if (myId) return showMenu('서버와 연결이 끊겼습니다.');
      if (!opened && REMOTE && performance.now() < deadline) {
        $('status').textContent = '서버를 깨우는 중… (무료 서버는 최대 1분)';
        setTimeout(attempt, 3000);
        return;
      }
      showMenu(opened ? '' : '서버에 접속할 수 없습니다. 혼자 하기(봇전)는 서버 없이 됩니다.');
    };
  };
  $('status').textContent = '접속 중…';
  attempt();
}

// 오프라인(혼자 하기): 서버와 같은 Game 클래스를 브라우저에서 실행한다. 메시지 형식도 같아서 아래 코드는 구분하지 않는다.
async function startOffline(name, gameMode, gameRule) {
  $('status').textContent = '불러오는 중…';
  const { Game } = await import('./server/game.js');
  const game = new Game({ mode: gameMode, rule: gameRule });
  game.balanceBots();
  const player = game.addPlayer(name, (msg) => onMessage(JSON.parse(msg))); // 봇 한 자리를 이어받는다
  offline = { game, player };
  onMessage({ t: 'w', id: player.id, team: player.team, ...game.info() });
}

function onMessage(m) {
  if (m.t === 'w') {
    myId = m.id;
    myTeam = m.team;
    mode = m.m || 'duo';
    rule = m.r || 'survival';
    target = m.g || 0;
    roundTime = m.rtm || CFG.ROUND_TIME;
    $('menu').style.display = 'none';
    $('hud').hidden = false;
  } else if (m.t === 'full') {
    $('status').textContent = '방이 가득 찼습니다.';
  } else if (m.t === 'r') {
    roster.clear();
    for (const [id, name, team, score, al, wins] of m.p) roster.set(id, { name, team, score, alive: !!al, wins });
    for (const [id, e] of ents) setKind(e.mesh, kindOf(id));
    drawScore();
  } else if (m.t === 'k') {
    for (const [k, v] of m.l) {
      if (v === myId) {
        killedBy = k ? (roster.get(k)?.name ?? '') : '독구름';
        sfx.death();
        buzz(200);
      } else if (k === myId) {
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
    $('banner').hidden = false;
    won ? sfx.win() : sfx.lose();
  } else if (m.t === 'n') {
    roundEnd = 0;
    snapNext = true;
    $('banner').hidden = true;
    killedBy = '';
  } else if (m.t === 's') {
    onSnapshot(m);
  }
}

const kindOf = (id) => (roster.get(id)?.team === myTeam ? 'ally' : 'enemy');

function onSnapshot(m) {
  const [x, z, yaw, al, resp, , rollT, rollCd, rollDx, rollDz, fcd, gasT] = m.me;
  const wasAlive = alive;
  alive = !!al;
  roundLeft = m.rt ?? 0;
  respawnIn = resp;
  gas = gasT || 0;
  zoneTarget = m.zh || 0;
  flareCd = fcd;
  // 서버 상태로 되돌린 뒤 미확인 입력을 다시 적용 (클라이언트 예측 보정)
  Object.assign(sim, { x, z, yaw, rollT, rollCd, rollDx, rollDz });
  while (pending.length && pending[0].seq <= m.a) pending.shift();
  if (alive) for (const inp of pending) stepPlayer(sim, inp, DT, WALLS);
  else pending.length = 0;
  if (alive && (!wasAlive || snapNext)) {
    // 새 라운드: 보간 없이 순간이동, 조준 방향과 쿨다운도 초기화
    Object.assign(prev, sim);
    input.yaw = sim.yaw;
    localCd = 0;
    if (everAlive) sfx.respawn();
    everAlive = true;
  }
  snapNext = false;

  snapCount++;
  const now = performance.now();
  for (const [id, ex, ez, eyaw, flags] of m.e) {
    let e = ents.get(id);
    if (!e) {
      e = { mesh: makePlayerMesh(kindOf(id)), buf: [], x: ex, z: ez, yaw: eyaw, flags: 0, stamp: 0 };
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
    e.stamp = snapCount;
  }
  // 이번 스냅샷에 없는 플레이어 = 시야 밖 또는 사망 → 클라이언트에서 완전히 제거
  for (const [id, e] of ents) if (e.stamp !== snapCount) removeEnt(id);
  flares = m.f || [];
}

function removeEnt(id) {
  const e = ents.get(id);
  if (!e) return;
  scene.remove(e.mesh);
  ents.delete(id);
}

// ───────────────────────── HUD ─────────────────────────
function drawScore() {
  const me = roster.get(myId);
  const time = `${Math.floor(roundLeft / 60)}:${String(roundLeft % 60).padStart(2, '0')}`;
  let left;
  let right = `킬 ${me?.score ?? 0} · ${me?.wins ?? 0}승`;
  if (rule === 'survival') {
    let aliveN = 0;
    const teams = new Set();
    for (const p of roster.values()) {
      if (!p.alive) continue;
      aliveN++;
      teams.add(p.team);
    }
    left = mode === 'ffa' ? `생존 ${aliveN}명` : `생존 ${teams.size}팀 · ${aliveN}명`;
    if (zoneTarget) left += ` · 구역 ${Math.round(zoneTarget * 2)}m`;
  } else {
    // 데스매치: 내(우리 팀) 킬과 가장 앞선 상대의 킬
    const kills = new Map();
    for (const p of roster.values()) kills.set(p.team, (kills.get(p.team) || 0) + p.score);
    const mine = kills.get(myTeam) || 0;
    let top = 0;
    for (const [t, k] of kills) if (t !== myTeam) top = Math.max(top, k);
    left = `${mode === 'ffa' ? '나' : '우리 팀'} ${mine} : ${top} 상대 1위`;
    if (target) left += ` · 목표 ${target}`;
    if (mode === 'ffa') right = `${me?.wins ?? 0}승`;
  }
  $('score').innerHTML =
    `<span class="ally">${left}</span> <span class="enemy">${time}</span><span class="me">${right}</span>`;
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
// 스킬 버튼: 쿨다운 중에는 남은 시간을 숫자로 보여준다
function drawSkill(id, remain, total, usable) {
  const el = $(id);
  const label = el.firstElementChild;
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
  if (!myId || (!offline && (!ws || ws.readyState !== WebSocket.OPEN))) return;
  const canAct = alive && roundEnd <= 0;
  let atk = input.consume('atk');
  const roll = input.consume('roll') && canAct;
  let flare = input.consume('flare') && canAct;
  // 라운드 시작 직후에는 공격할 수 없다 (서버와 같은 규칙)
  const grace = roundLeft > roundTime - CFG.START_GRACE;
  if (!canAct || sim.rollT > 0 || grace) atk = false;
  if (atk && localCd <= 0) {
    localCd = CFG.ATTACK_COOLDOWN;
    localBeam = CFG.BEAM_TIME; // 즉시 피드백 (판정은 서버)
    sfx.beam();
  }
  if (flare && flareCd <= 0) {
    flareCd = CFG.FLARE_COOLDOWN;
    sfx.flare();
  } else flare = false;

  const inp = { seq: ++seq, mx: input.mx, mz: input.mz, yaw: wrapAngle(input.yaw), atk, roll, flare };
  const d = [inp.seq, +inp.mx.toFixed(3), +inp.mz.toFixed(3), +inp.yaw.toFixed(4), atk ? 1 : 0, roll ? 1 : 0, flare ? 1 : 0];
  if (offline) offline.game.queueInput(offline.player.id, d);
  else ws.send(JSON.stringify({ t: 'i', d }));
  if (canAct) {
    // 서버가 받는 것과 같은 (양자화된) 값으로 예측
    inp.mx = d[1];
    inp.mz = d[2];
    inp.yaw = d[3];
    pending.push(inp);
    if (pending.length > 60) pending.shift();
    const wasRolling = sim.rollT > 0;
    stepPlayer(sim, inp, DT, WALLS);
    if (sim.rollT > 0 && !wasRolling) sfx.roll();
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
  selfMesh.userData.beam.visible = localBeam > 0;
  setRolling(selfMesh, sim.rollT > 0);

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
    e.mesh.userData.beam.visible = !!(e.flags & 1);
    setRolling(e.mesh, !!(e.flags & 2));
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

  // 1) 시야 마스크: 나 + 팀원 + 팀 조명탄의 시야 합집합
  sources.length = 0;
  if (alive) sources.push(view);
  for (const [id, e] of ents) if (roster.get(id)?.team === myTeam) sources.push(e);
  sources.push(...flareSources);
  renderer.info.reset();
  mask.update(renderer, sources);

  // 2) 카메라 (캐릭터 뒤 위쪽에서 따라가는 3인칭)
  const s = Math.sin(view.yaw);
  const c = Math.cos(view.yaw);
  camera.position.set(view.x - s * 9, 17, view.z - c * 9);
  camera.lookAt(view.x + s * 6, 0, view.z + c * 6);
  camera.updateMatrixWorld();
  projView.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  frustum.setFromProjectionMatrix(projView);

  // 3) 컬링: (시야에 걸린 벽) ∩ (화면 절두체 안) 만 인스턴스 버퍼에 넣는다
  let nWalls = 0;
  const im = wallMesh.instanceMatrix.array;
  for (let i = 0; i < WALLS.length; i++) {
    if (!mask.seen[i] || !frustum.intersectsSphere(wallSpheres[i])) continue;
    im.set(wallMatrices.subarray(i * 16, i * 16 + 16), nWalls * 16);
    nWalls++;
  }
  wallMesh.count = nWalls;
  wallMesh.instanceMatrix.needsUpdate = true;
  wallMesh.visible = nWalls > 0;

  let nPlayers = 0;
  for (const e of ents.values()) {
    sphere.center.set(e.x, 0.9, e.z);
    e.mesh.visible = frustum.intersectsSphere(sphere);
    if (e.mesh.visible) nPlayers++;
  }

  renderer.render(scene, camera);

  // 스킬 버튼 쿨다운 (매 프레임)
  const canAct = alive && roundEnd <= 0;
  drawSkill('attack', localCd, CFG.ATTACK_COOLDOWN, canAct);
  drawSkill('roll', sim.rollCd, CFG.ROLL_COOLDOWN, canAct);
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
      `벽 ${nWalls}/${WALLS.length}  플레이어 ${nPlayers}/${Math.max(0, roster.size - 1)}`;
    // 프레임이 떨어지면 해상도를 낮추고, 여유가 있으면 되돌린다
    if (frameEma > 24 && resScale > 0.55) {
      resScale -= 0.1;
      resize();
    } else if (frameEma < 15 && resScale < 1) {
      resScale = Math.min(1, resScale + 0.05);
      resize();
    }
    $('dead').hidden = alive || !myId || roundEnd > 0;
    $('deadBy').textContent = killedBy ? ` — ${killedBy}` : '';
    $('respawn').textContent = rule === 'survival' ? '다음 라운드까지 대기' : `${Math.ceil(respawnIn)}초 후 부활`;
    if (roundEnd > 0) $('bannerSub').textContent = `${winnerText} · ${Math.ceil(roundEnd)}초 후 다음 라운드`;
    if (myId) drawScore();
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
    });
  }
}
bindPick(MODES, 'frustum.mode', (v) => (menuMode = v));
bindPick(RULE_BTNS, 'frustum.rule', (v) => (menuRule = v));
drawPicks();
$('play').addEventListener('click', () => {
  const name = $('name').value.trim() || 'Player';
  remember(name);
  startOffline(name, menuMode, menuRule).catch((e) => ($('status').textContent = '시작 실패: ' + e.message));
});
$('online').addEventListener('click', () => {
  const name = $('name').value.trim() || 'Player';
  remember(name);
  connect(name, menuMode, menuRule);
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
  $('sensVal').textContent = `x${prefs.sens.toFixed(1)}`;
  $('volVal').textContent = `${Math.round(prefs.volume * 100)}%`;
}
const CHECKS = { setFixed: 'fixedStick', setLefty: 'lefty', setVibrate: 'vibrate', setStats: 'showStats' };
const RANGES = { setSens: 'sens', setVol: 'volume' };
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
function openSettings() {
  $('leave').hidden = !myId;
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
  if (offline) {
    offline = null;
    showMenu('');
  } else if (ws) {
    myId = 0; // onclose 가 "연결 끊김" 대신 빈 메시지를 보이도록
    ws.close();
    showMenu('');
  }
});
applyPrefs();

if (params.has('offline')) startOffline($('name').value || 'Player', menuMode, menuRule);
else if (params.has('auto')) connect($('name').value || 'Player', menuMode, menuRule);

// 디버그/자동 테스트용 핸들
window.__frustum = {
  ents, roster, sim, view, stats, mask, input, sfx,
  get alive() { return alive; },
  get myId() { return myId; },
  get flares() { return flares; },
  get offline() { return offline; },
};
