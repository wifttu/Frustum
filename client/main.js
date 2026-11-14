import * as THREE from 'three';
import { CFG } from './shared/config.js';
import { MAP_SIZE, WALLS, WALL_HEIGHT } from './shared/map.js';
import { stepPlayer } from './shared/sim.js';
import { wrapAngle } from './shared/vision.js';
import { VisionMask } from './fog.js';
import { Input } from './input.js';

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

// 플레이어 메시 (지오메트리/머티리얼 공유)
const geo = {
  body: new THREE.CylinderGeometry(0.42, 0.45, 1.2, 12).translate(0, 0.6, 0),
  head: new THREE.SphereGeometry(0.3, 12, 8).translate(0, 1.5, 0),
  visor: new THREE.BoxGeometry(0.36, 0.12, 0.2).translate(0, 1.52, 0.24),
  blade: new THREE.BoxGeometry(0.08, 0.08, 0.9).translate(0.45, 0.8, 0.45),
  swing: new THREE.RingGeometry(0.6, CFG.ATTACK_RANGE, 14, 1, -Math.PI / 2 - CFG.ATTACK_ARC / 2, CFG.ATTACK_ARC)
    .rotateX(-Math.PI / 2)
    .translate(0, 0.9, 0),
};
const mat = {
  self: mask.apply(new THREE.MeshLambertMaterial({ color: 0xf2f6fa })),
  ally: mask.apply(new THREE.MeshLambertMaterial({ color: 0x3d9cf0 })),
  enemy: mask.apply(new THREE.MeshLambertMaterial({ color: 0xf0503d })),
  dark: mask.apply(new THREE.MeshLambertMaterial({ color: 0x1b2026 })),
  swing: mask.apply(
    new THREE.MeshBasicMaterial({ color: 0xffd25a, transparent: true, opacity: 0.6, side: THREE.DoubleSide, depthWrite: false }),
  ),
};
function makePlayerMesh(kind) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(geo.body, mat[kind]);
  const head = new THREE.Mesh(geo.head, mat[kind]);
  g.add(body, head, new THREE.Mesh(geo.visor, mat.dark), new THREE.Mesh(geo.blade, mat.dark));
  const swing = new THREE.Mesh(geo.swing, mat.swing);
  swing.visible = false;
  g.add(swing);
  g.userData = { body, head, swing, kind };
  // 그룹 단위로 컬링하므로 자식의 자동 컬링은 끈다
  g.traverse((o) => (o.frustumCulled = false));
  return g;
}
function setKind(mesh, kind) {
  if (mesh.userData.kind === kind) return;
  mesh.userData.kind = kind;
  mesh.userData.body.material = mesh.userData.head.material = mat[kind];
}

// ───────────────────────── 상태 ─────────────────────────
let ws = null;
let offline = null; // 오프라인 모드: 브라우저 안에서 서버 로직을 직접 실행 { game, player }
let myId = 0;
let myTeam = 0;
let seq = 0;
let alive = false;
let respawnIn = 0;
let localCd = 0;
let localSwing = 0;
let killedBy = '';
const sim = { x: 0, z: 0, yaw: 0 }; // 예측된 내 상태
const prev = { x: 0, z: 0, yaw: 0 };
const view = { x: 0, z: 0, yaw: 0 }; // 렌더용 보간 상태
const pending = []; // 서버가 아직 확인하지 않은 입력
const roster = new Map(); // id → {name, team, score}  (위치 정보 없음)
// 서버가 보내준(= 시야 안의) 플레이어만 존재한다. 시야에서 벗어나면 즉시 삭제.
const ents = new Map();
let snapCount = 0;

const selfMesh = makePlayerMesh('self');
selfMesh.visible = false;
scene.add(selfMesh);

const input = new Input({ surface: canvas, stick: $('stick'), knob: $('knob'), attackBtn: $('attack') });

// ───────────────────────── 네트워크 ─────────────────────────
const SERVER_PARAM = new URLSearchParams(location.search).get('server');
function wsUrl() {
  if (SERVER_PARAM) {
    const u = SERVER_PARAM.replace(/^http/, 'ws');
    return /^wss?:\/\//.test(u) ? u.replace(/\/$/, '') + '/ws' : `wss://${u.replace(/\/$/, '')}/ws`;
  }
  return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
}

function showMenu(msg) {
  $('menu').style.display = '';
  $('hud').hidden = true;
  $('status').textContent = msg;
  myId = 0;
  for (const id of [...ents.keys()]) removeEnt(id);
}

function connect(name) {
  $('status').textContent = '접속 중…';
  let opened = false;
  ws = new WebSocket(wsUrl());
  ws.onopen = () => {
    opened = true;
    ws.send(JSON.stringify({ t: 'j', n: name }));
  };
  ws.onmessage = (ev) => onMessage(JSON.parse(ev.data));
  ws.onclose = () => {
    showMenu(
      myId ? '서버와 연결이 끊겼습니다.' : opened ? '' : '서버에 접속할 수 없습니다. 혼자 하기(봇전)는 서버 없이 됩니다.',
    );
  };
}

// 오프라인(혼자 하기): 서버와 같은 Game 클래스를 브라우저에서 실행한다. 메시지 형식도 같아서 아래 코드는 구분하지 않는다.
async function startOffline(name) {
  $('status').textContent = '불러오는 중…';
  const { Game } = await import('./server/game.js');
  const game = new Game();
  const player = game.addPlayer(name, (msg) => onMessage(JSON.parse(msg)));
  game.balanceBots();
  offline = { game, player };
  onMessage({ t: 'w', id: player.id, team: player.team });
}

function onMessage(m) {
  if (m.t === 'w') {
    myId = m.id;
    myTeam = m.team;
    $('menu').style.display = 'none';
    $('hud').hidden = false;
  } else if (m.t === 'full') {
    $('status').textContent = '방이 가득 찼습니다.';
  } else if (m.t === 'r') {
    roster.clear();
    for (const [id, name, team, score] of m.p) roster.set(id, { name, team, score });
    for (const [id, e] of ents) setKind(e.mesh, kindOf(id));
    drawScore();
  } else if (m.t === 'k') {
    for (const [k, v] of m.l) {
      if (v === myId) killedBy = roster.get(k)?.name ?? '';
      addFeed(k, v);
    }
  } else if (m.t === 's') {
    onSnapshot(m);
  }
}

const kindOf = (id) => (roster.get(id)?.team === myTeam ? 'ally' : 'enemy');

function onSnapshot(m) {
  const [x, z, yaw, al, resp] = m.me;
  const wasAlive = alive;
  alive = !!al;
  respawnIn = resp;
  // 서버 상태로 되돌린 뒤 미확인 입력을 다시 적용 (클라이언트 예측 보정)
  sim.x = x;
  sim.z = z;
  sim.yaw = yaw;
  while (pending.length && pending[0].seq <= m.a) pending.shift();
  if (alive) for (const inp of pending) stepPlayer(sim, inp, DT, WALLS);
  else pending.length = 0;
  if (alive && !wasAlive) {
    // 리스폰: 보간 없이 순간이동, 조준 방향도 서버 값으로
    Object.assign(prev, sim);
    input.yaw = sim.yaw;
  }

  snapCount++;
  const now = performance.now();
  for (const [id, ex, ez, eyaw, flags] of m.e) {
    let e = ents.get(id);
    if (!e) {
      e = { mesh: makePlayerMesh(kindOf(id)), buf: [], x: ex, z: ez, yaw: eyaw, flags: 0, stamp: 0 };
      scene.add(e.mesh);
      ents.set(id, e);
    }
    e.buf.push({ t: now, x: ex, z: ez, yaw: eyaw });
    if (e.buf.length > 8) e.buf.shift();
    e.flags = flags;
    e.stamp = snapCount;
  }
  // 이번 스냅샷에 없는 플레이어 = 시야 밖 또는 사망 → 클라이언트에서 완전히 제거
  for (const [id, e] of ents) if (e.stamp !== snapCount) removeEnt(id);
}

function removeEnt(id) {
  const e = ents.get(id);
  if (!e) return;
  scene.remove(e.mesh);
  ents.delete(id);
}

// ───────────────────────── HUD ─────────────────────────
function drawScore() {
  let mine = 0;
  let theirs = 0;
  for (const p of roster.values()) p.team === myTeam ? (mine += p.score) : (theirs += p.score);
  const me = roster.get(myId);
  $('score').innerHTML =
    CFG.TEAMS > 0
      ? `<span class="ally">아군 ${mine}</span> : <span class="enemy">${theirs} 적군</span><span class="me">내 킬 ${me?.score ?? 0}</span>`
      : `<span class="me">킬 ${me?.score ?? 0}</span>`;
}
function addFeed(k, v) {
  const row = document.createElement('div');
  for (const [id, sep] of [[k, ' ▸ '], [v, '']]) {
    const s = document.createElement('span');
    s.className = roster.get(id)?.team === myTeam ? 'ally' : 'enemy';
    s.textContent = roster.get(id)?.name ?? '?';
    row.append(s, sep);
  }
  $('feed').prepend(row);
  while ($('feed').children.length > 5) $('feed').lastChild.remove();
  setTimeout(() => row.remove(), 6000);
}

// ───────────────────────── 고정 틱: 입력 전송 + 예측 ─────────────────────────
function fixedStep() {
  Object.assign(prev, sim);
  localCd = Math.max(0, localCd - DT);
  localSwing = Math.max(0, localSwing - DT);
  if (!myId || (!offline && (!ws || ws.readyState !== WebSocket.OPEN))) return;
  let atk = input.consumeAttack();
  if (!alive) atk = false;
  if (atk && localCd <= 0) {
    localCd = CFG.ATTACK_COOLDOWN;
    localSwing = 0.25; // 즉시 피드백 (판정은 서버)
  }
  const inp = { seq: ++seq, mx: input.mx, mz: input.mz, yaw: wrapAngle(input.yaw), atk };
  const d = [inp.seq, +inp.mx.toFixed(3), +inp.mz.toFixed(3), +inp.yaw.toFixed(4), atk ? 1 : 0];
  if (offline) offline.game.queueInput(offline.player.id, d);
  else ws.send(JSON.stringify({ t: 'i', d }));
  if (alive) {
    // 서버가 받는 것과 같은 (양자화된) 값으로 예측
    inp.mx = +inp.mx.toFixed(3);
    inp.mz = +inp.mz.toFixed(3);
    inp.yaw = +inp.yaw.toFixed(4);
    pending.push(inp);
    if (pending.length > 60) pending.shift();
    stepPlayer(sim, inp, DT, WALLS);
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
  selfMesh.userData.swing.visible = localSwing > 0;

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
    e.mesh.userData.swing.visible = !!(e.flags & 1);
  }

  // 1) 시야 마스크: 나 + 팀원의 시야 합집합
  sources.length = 0;
  if (alive) sources.push(view);
  for (const [id, e] of ents) if (roster.get(id)?.team === myTeam) sources.push(e);
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
    $('stats').textContent =
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
    $('dead').hidden = alive || !myId;
    $('deadBy').textContent = killedBy ? ` — ${killedBy}` : '';
    $('respawn').textContent = `${Math.ceil(respawnIn)}초 후 부활`;
    $('attack').classList.toggle('cd', localCd > 0 || !alive);
  }
}
requestAnimationFrame(frame);

// ───────────────────────── 시작 ─────────────────────────
const params = new URLSearchParams(location.search);
$('name').value = params.get('name') || localStorage.getItem('frustum.name') || '';
function remember(name) {
  try {
    localStorage.setItem('frustum.name', name);
  } catch {}
}
$('play').addEventListener('click', () => {
  const name = $('name').value.trim() || 'Player';
  remember(name);
  startOffline(name).catch((e) => ($('status').textContent = '시작 실패: ' + e.message));
});
$('online').addEventListener('click', () => {
  const name = $('name').value.trim() || 'Player';
  remember(name);
  connect(name);
});
if (params.has('offline')) startOffline($('name').value || 'Player');
else if (params.has('auto')) connect($('name').value || 'Player');

// 디버그/자동 테스트용 핸들
window.__frustum = { ents, roster, sim, view, stats, mask, input, get alive() { return alive; }, get myId() { return myId; } };
