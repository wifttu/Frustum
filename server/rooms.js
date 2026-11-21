// 방 관리. 공개 방은 규칙 × 모드 조합마다 하나씩 항상 있고,
// 친구끼리 쓰는 비공개 방은 방 코드로 만들어지며 사람이 모두 나가면 사라진다.
import { RULES, modeFor } from '../shared/config.js';
import { MAPS } from '../shared/map.js';
import { Game } from './game.js';

export const MAX_PRIVATE_ROOMS = 50;
const MODES = ['ffa', 'duo'];
// 공개 방: 규칙 × 인원 구성 (모닥불 점령은 3 대 3 하나)
export const PUBLIC_ROOMS = Object.keys(RULES).flatMap((rule) => [...new Set(MODES.map((m) => modeFor(rule, m)))].map((mode) => [rule, mode]));

// 방 코드: 영문 대문자와 숫자 4~6자. 그 밖의 값은 코드 없음으로 취급한다.
export function roomCode(v) {
  const s = typeof v === 'string' ? v.toUpperCase() : '';
  return /^[A-Z0-9]{4,6}$/.test(s) ? s : '';
}

export class Rooms {
  constructor() {
    this.games = new Map(); // key → Game
    for (const [rule, mode] of PUBLIC_ROOMS) {
      const g = new Game({ rule, mode });
      g.balanceBots();
      this.games.set(`${rule}-${mode}`, g);
    }
    this.privateCount = 0;
  }

  // 들어갈 방을 찾거나 만든다. 비공개 방이 너무 많으면 null.
  find({ rule, mode, room, map }) {
    rule = Object.hasOwn(RULES, rule) ? rule : 'survival';
    mode = modeFor(rule, mode);
    const code = roomCode(room);
    if (!code) return this.games.get(`${rule}-${mode}`);
    // 비공개 방은 코드만으로 찾는다: 먼저 만든 사람의 규칙/모드/맵을 따른다
    const key = `room:${code}`;
    let g = this.games.get(key);
    if (!g) {
      if (this.privateCount >= MAX_PRIVATE_ROOMS) return null;
      const fixed = Object.hasOwn(MAPS, map);
      g = new Game({ rule, mode, ...(fixed ? { map, FIXED_MAP: true } : {}) });
      g.room = code;
      g.balanceBots();
      this.games.set(key, g);
      this.privateCount++;
    }
    return g;
  }

  // 공개 방별 접속 중인 사람 수 (봇 제외). 비공개 방은 코드를 아는 사람만 쓰므로 알리지 않는다.
  summary() {
    const out = {};
    for (const [key, g] of this.games) if (!g.room) out[key] = g.humanCount;
    return out;
  }

  // 사람이 모두 나간 비공개 방은 없앤다
  cleanup(g) {
    if (!g.room || g.humanCount > 0) return;
    if (this.games.delete(`room:${g.room}`)) this.privateCount--;
  }

  [Symbol.iterator]() {
    return this.games.values();
  }
}
