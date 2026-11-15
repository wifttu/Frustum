// HTTP(정적 파일) + WebSocket 게임 서버.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { CFG, RULES } from '../shared/config.js';
import { Game } from './game.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT) || 3000;

const MOUNTS = [
  ['/shared/', path.join(ROOT, 'shared')],
  ['/server/', path.join(ROOT, 'server')], // 오프라인 모드용: game.js, bots.js 만 허용
  ['/vendor/three/', path.join(ROOT, 'node_modules/three/build')],
  ['/', path.join(ROOT, 'client')],
];
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
};

const server = http.createServer((req, res) => {
  let url;
  try {
    url = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  } catch {
    res.writeHead(400).end();
    return;
  }
  if (url === '/healthz') {
    // Render 헬스체크 / 잠든 서버 깨우기용
    res.writeHead(200, { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' }).end('ok');
    return;
  }
  if (url === '/') url = '/index.html';
  for (const [prefix, dir] of MOUNTS) {
    if (!url.startsWith(prefix)) continue;
    const file = path.resolve(dir, url.slice(prefix.length));
    if (!file.startsWith(dir + path.sep)) break; // 디렉터리 탈출 차단
    if (prefix === '/server/' && !['game.js', 'bots.js', 'nav.js'].includes(path.basename(file))) break;
    fs.readFile(file, (err, data) => {
      if (err) {
        res.writeHead(404).end('Not found');
        return;
      }
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
        'Cache-Control': prefix.startsWith('/vendor') ? 'public, max-age=86400' : 'no-cache',
      });
      res.end(data);
    });
    return;
  }
  res.writeHead(404).end('Not found');
});

// 규칙 × 모드 조합마다 방 하나씩 (예: 'dm-ffa', 'survival-duo')
const games = {};
for (const rule of Object.keys(RULES)) for (const mode of ['ffa', 'duo']) games[`${rule}-${mode}`] = new Game({ rule, mode });
for (const g of Object.values(games)) g.balanceBots();

const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 512 });
wss.on('connection', (ws) => {
  let player = null;
  let game = null;
  let msgCount = 0;
  const rateTimer = setInterval(() => (msgCount = 0), 1000);

  ws.on('message', (raw) => {
    if (++msgCount > 120) return; // 초당 메시지 제한
    let m;
    try {
      m = JSON.parse(raw);
    } catch {
      return;
    }
    if (!m || typeof m !== 'object') return;
    if (m.t === 'j' && !player) {
      const key = `${m.r}-${m.m}`;
      game = Object.hasOwn(games, key) ? games[key] : games['survival-duo'];
      const wasEmpty = game.humanCount === 0;
      if (game.humanCount >= CFG.MAX_PLAYERS) {
        ws.send(JSON.stringify({ t: 'full' }));
        ws.close();
        return;
      }
      const name = String(m.n ?? '').replace(/[^\p{L}\p{N}_\- ]/gu, '').trim().slice(0, 12) || 'Player';
      player = game.addPlayer(name, (msg) => {
        // 느린 클라이언트에 스냅샷이 쌓이지 않게 한다
        if (ws.readyState === ws.OPEN && ws.bufferedAmount < 64 * 1024) ws.send(msg);
      }, false, typeof m.c === 'string' ? m.c : null);
      game.balanceBots();
      if (wasEmpty) game.newRound(); // 비어 있던 방은 새 라운드로 시작
      ws.send(JSON.stringify({ t: 'w', id: player.id, team: player.team, ...game.info() }));
    } else if (m.t === 'i' && player) {
      game.queueInput(player.id, m.d);
    } else if (m.t === 'u' && player) {
      game.choose(player, m.c); // 레벨업 카드 선택
    }
  });

  ws.on('close', () => {
    clearInterval(rateTimer);
    if (player) {
      game.removePlayer(player.id);
      game.balanceBots();
    }
  });
  ws.on('error', () => {});
});

// 고정 틱 루프 (타이머 오차 누적 보정)
const STEP_MS = 1000 / CFG.TICK_RATE;
let next = performance.now();
setInterval(() => {
  const now = performance.now();
  let steps = 0;
  while (now >= next && steps < 5) {
    for (const g of Object.values(games)) {
      if (g.humanCount === 0) continue; // 사람이 없는 방은 멈춰 둔다
      g.step();
      if (g.tick % CFG.SNAPSHOT_EVERY === 0) g.broadcast();
    }
    next += STEP_MS;
    steps++;
  }
  if (now - next > 250) next = now; // 크게 밀리면 따라잡기 포기
}, STEP_MS / 2);

server.listen(PORT, () => console.log(`Frustum server: http://localhost:${PORT}`));
