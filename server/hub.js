// 접속(세션) 관리: 빠른 매칭, 친선 게임 방(파티), 친구 접속 상태와 초대.
// 네트워크와 분리되어 있어 가짜 세션으로 테스트할 수 있다.
//   세션: { id, send(obj), raw(string) } — 나머지 필드(prof, fc, party, game, player...)는 여기서 채운다.
import { MODE_INFO, RULES, modeFor } from '../shared/config.js';
import { MAPS } from '../shared/map.js';
import { CHARACTERS, charOf, cheatOf } from '../shared/progress.js';
import { FREE_ICONS, SKIN_ICONS, skinFor } from '../shared/shop.js';
import { Game } from './game.js';
import { Rooms, roomCode } from './rooms.js';

export const PARTY_SLOTS = 8;
export const MAX_PARTIES = 200;
// 빠른 채팅: 정해진 문구만 보낸다 (자유 입력이 없어 욕설·도배 걱정이 없다)
export const QUICK_CHAT = Object.freeze(['안녕! 👋', '준비 됐어 ✅', '잠깐만 ⏳', '가자! 🔥', '좋아요 👍', '같은 팀 하자 🤝', 'GG 🎉', 'ㅋㅋㅋ 😆']);
const CODE_ABC = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 헷갈리는 글자(0/O, 1/I) 제외
const ICONS = new Set([...FREE_ICONS, ...Object.values(CHARACTERS).map((c) => c.icon), ...Object.values(SKIN_ICONS)]);
const MODES = ['ffa', 'duo'];

export const cleanName = (v) => String(v ?? '').replace(/[^\p{L}\p{N}_\- ]/gu, '').trim().slice(0, 12) || 'Player';
// 친구 코드: 영문 대문자·숫자 6자 (기기마다 하나, 클라이언트가 만든다)
export function friendCode(v) {
  const s = typeof v === 'string' ? v.toUpperCase() : '';
  return /^[A-Z0-9]{6}$/.test(s) ? s : '';
}
// 친선 방에서 같은 팀이 되는 자리: 2인 팀전은 두 칸씩, 3 대 3 은 세 칸씩 한 팀, 개인전은 칸마다 다른 팀
export const teamOfSlot = (mode, slot) => (mode === 'duo' ? 1 + Math.floor(slot / 2) : mode === 'squad' ? 1 + Math.floor(slot / 3) : 2000 + slot);
// 그 설정에서 쓸 수 있는 자리 수 (3 대 3 은 6자리)
export const slotsOf = (set) => MODE_INFO[modeFor(set.rule, set.mode)].players;

function cleanSettings(set, base) {
  const s = { ...base };
  if (set && typeof set === 'object') {
    if (Object.hasOwn(RULES, set.rule)) s.rule = set.rule;
    if (MODES.includes(set.mode)) s.mode = set.mode;
    if (set.map === '' || Object.hasOwn(MAPS, set.map)) s.map = set.map;
    if (typeof set.ai === 'boolean') s.ai = set.ai;
  }
  return s;
}

class Party {
  constructor(code, host) {
    this.code = code;
    this.host = host.id;
    this.set = { rule: 'dm', mode: 'duo', map: '', ai: true };
    this.members = new Map(); // 세션 id → 세션
    this.game = null; // 진행 중인 친선 게임
  }

  freeSlot() {
    const used = new Set([...this.members.values()].map((s) => s.slot));
    const n = slotsOf(this.set);
    for (let i = 0; i < PARTY_SLOTS; i++) if (!used.has(i) && (i < n || used.size >= n)) return i;
    return -1;
  }

  // 3 대 3 처럼 자리가 줄면 뒷자리에 있던 사람을 빈 앞자리로 옮긴다
  packSlots() {
    const n = slotsOf(this.set);
    const used = new Set([...this.members.values()].map((s) => s.slot));
    for (const s of this.members.values()) {
      if (s.slot < n) continue;
      for (let i = 0; i < n; i++) {
        if (used.has(i)) continue;
        used.delete(s.slot);
        s.slot = i;
        used.add(i);
        break;
      }
    }
  }

  state() {
    return {
      t: 'p',
      code: this.code,
      host: this.host,
      set: this.set,
      playing: this.game ? this.game.humanCount : 0,
      members: [...this.members.values()].map((s) => ({
        sid: s.id, name: s.prof.name, char: s.prof.char, skin: s.prof.skin, icon: s.prof.icon, fc: s.fc || '',
        slot: s.slot, ready: !!s.ready, inGame: !!s.player,
      })),
    };
  }

  broadcast(obj) {
    const msg = JSON.stringify(obj);
    for (const s of this.members.values()) s.raw(msg);
  }

  sync() {
    this.broadcast(this.state());
  }
}

export class Hub {
  constructor() {
    this.rooms = new Rooms(); // 빠른 매칭용 공개 방 + 방 코드로 바로 들어가는 비공개 방
    this.parties = new Map(); // 방 코드 → Party
    this.byFc = new Map(); // 친구 코드 → Set<세션>
  }

  // 틱을 돌릴 게임들 (사람이 있는 것만)
  *games() {
    for (const g of this.rooms) if (g.humanCount > 0) yield g;
    for (const p of this.parties.values()) if (p.game && p.game.humanCount > 0) yield p.game;
  }

  connect(s) {
    s.prof = { name: 'Player', char: 'explorer', skin: 'default', icon: '' };
    s.fc = '';
    s.party = null;
    s.game = null;
    s.player = null;
    s.slot = -1;
    s.ready = false;
    s.last = {}; // 메시지 종류별 마지막 시각 (속도 제한)
  }

  disconnect(s) {
    if (s.party) this.leaveParty(s);
    else this.leaveGame(s, true);
    this.setFc(s, '');
  }

  // 같은 종류의 요청을 너무 자주 보내지 못하게 한다
  throttle(s, key, ms) {
    const now = Date.now();
    if (now - (s.last[key] || 0) < ms) return true;
    s.last[key] = now;
    return false;
  }

  err(s, msg) {
    s.send({ t: 'perr', msg });
  }

  handle(s, m) {
    if (!m || typeof m !== 'object') return;
    switch (m.t) {
      case 'hi': return this.hello(s, m);
      case 'fs': return this.friendStatus(s, m);
      case 'inv': return this.invite(s, m);
      case 'pcreate': return this.createParty(s, m);
      case 'pjoin': return this.joinParty(s, m);
      case 'pleave': return this.leaveParty(s, true);
      case 'pset': return this.setParty(s, m);
      case 'pmove': return this.moveSlot(s, m);
      case 'pkick': return this.kick(s, m);
      case 'pready': return this.toggleReady(s);
      case 'pchat': return this.chat(s, m);
      case 'pstart': return this.startParty(s);
      case 'pplay': return this.joinPartyGame(s);
      case 'j': return this.quickPlay(s, m);
      case 'i': if (s.player) s.game.queueInput(s.player.id, m.d); return;
      case 'u': if (s.player) s.game.choose(s.player, m.c); return;
      case 'wn': if (s.player) s.game.cycleWatch(s.player); return; // 관전 대상 바꾸기
      case 'em': if (s.player) s.game.emote(s.player, m.e); return; // 감정표현
      case 'again': if (s.player) s.game.again(s.player); return; // 결과 화면에서 다시하기
      case 'leave': return this.leaveGame(s);
    }
  }

  // ── 프로필과 접속 상태 ──
  updateProfile(s, m) {
    if (typeof m.n === 'string') s.prof.name = cleanName(m.n);
    if (typeof m.c === 'string') s.prof.char = charOf(m.c);
    if (typeof m.s === 'string') s.prof.skin = m.s;
    s.prof.skin = skinFor(s.prof.char, s.prof.skin); // 그 캐릭터의 의상만
    if (typeof m.i === 'string') s.prof.icon = ICONS.has(m.i) ? m.i : '';
    // 치트: 혼자(AI 상대)일 때만 게임에서 켜진다. 게임 중에 바꾸면 바로 반영한다.
    if (m.ch !== undefined) {
      s.prof.cheat = cheatOf(m.ch);
      if (s.game && s.player && s.game.players.get(s.player.id) === s.player) {
        s.player.cheat = s.prof.cheat;
        s.game.applyStats(s.player);
      }
    }
  }

  setFc(s, fc) {
    if (s.fc === fc) return;
    if (s.fc) {
      const set = this.byFc.get(s.fc);
      set?.delete(s);
      if (set && !set.size) this.byFc.delete(s.fc);
    }
    s.fc = fc;
    if (fc) {
      if (!this.byFc.has(fc)) this.byFc.set(fc, new Set());
      this.byFc.get(fc).add(s);
    }
  }

  hello(s, m) {
    this.updateProfile(s, m);
    this.setFc(s, friendCode(m.fc));
    s.send({ t: 'hi', sid: s.id, chat: QUICK_CHAT });
    if (s.party) s.party.sync(); // 방 안에서 캐릭터를 바꾼 경우
  }

  // 친구 코드들의 접속 상태 { s: off / online / party / game, n: 지금 쓰는 이름 }
  friendStatus(s, m) {
    if (!Array.isArray(m.codes) || this.throttle(s, 'fs', 1500)) return;
    const st = {};
    for (const raw of m.codes.slice(0, 40)) {
      const fc = friendCode(raw);
      if (!fc) continue;
      const set = this.byFc.get(fc);
      if (!set?.size) {
        st[fc] = { s: 'off' };
        continue;
      }
      const list = [...set];
      const state = list.some((x) => x.player) ? 'game' : list.some((x) => x.party) ? 'party' : 'online';
      st[fc] = { s: state, n: list[0].prof.name };
    }
    s.send({ t: 'fs', st });
  }

  // 내가 있는 방으로 친구를 초대한다 (친구가 접속해 있어야 받는다)
  invite(s, m) {
    const to = friendCode(m.to);
    if (!s.party) return this.err(s, '먼저 방을 만들어 주세요');
    if (!to || to === s.fc || this.throttle(s, 'inv', 1500)) return;
    const targets = this.byFc.get(to);
    if (targets?.size) {
      const msg = JSON.stringify({ t: 'inv', from: s.prof.name, icon: s.prof.icon, fc: s.fc, code: s.party.code, set: s.party.set, n: s.party.members.size });
      for (const x of targets) x.raw(msg);
    }
    s.send({ t: 'invr', to, ok: !!targets?.size });
  }

  // ── 친선 게임 방 ──
  newCode() {
    for (;;) {
      const code = Array.from({ length: 5 }, () => CODE_ABC[Math.floor(Math.random() * CODE_ABC.length)]).join('');
      if (!this.parties.has(code)) return code;
    }
  }

  createParty(s, m) {
    if (this.throttle(s, 'pcreate', 1000)) return;
    this.updateProfile(s, m);
    if (s.party) this.leaveParty(s);
    else this.leaveGame(s, true);
    if (this.parties.size >= MAX_PARTIES) return this.err(s, '지금은 방을 더 만들 수 없어요. 잠시 후 다시 해 주세요');
    const p = new Party(this.newCode(), s);
    p.set = cleanSettings(m.set, p.set);
    this.parties.set(p.code, p);
    this.addMember(p, s);
    p.sync();
  }

  addMember(p, s) {
    s.party = p;
    s.slot = p.freeSlot();
    s.ready = false;
    p.members.set(s.id, s);
  }

  joinParty(s, m) {
    this.updateProfile(s, m);
    const code = roomCode(m.code);
    const p = this.parties.get(code);
    if (!p) return this.err(s, '방을 찾을 수 없어요. 코드를 확인해 주세요');
    if (s.party === p) return s.send(p.state());
    if (p.members.size >= PARTY_SLOTS) return this.err(s, '방이 가득 찼어요');
    if (s.party) this.leaveParty(s);
    else this.leaveGame(s, true);
    this.addMember(p, s);
    p.sync();
    p.broadcast({ t: 'pmsg', sys: 'join', name: s.prof.name });
  }

  // kicked: 방장이 내보냈는지 (알림 문구가 다르다)
  leaveParty(s, notify = false, kicked = false) {
    const p = s.party;
    if (!p) return;
    this.leaveGame(s, true);
    p.members.delete(s.id);
    s.party = null;
    s.slot = -1;
    s.ready = false;
    if (notify || kicked) s.send({ t: 'pgone', kicked });
    if (!p.members.size) {
      this.parties.delete(p.code);
      return;
    }
    if (p.host === s.id) {
      // 남은 사람 중 가장 앞자리가 방장을 넘겨받는다
      const next = [...p.members.values()].sort((a, b) => a.slot - b.slot)[0];
      p.host = next.id;
      next.ready = false;
    }
    p.sync();
    p.broadcast({ t: 'pmsg', sys: kicked ? 'kick' : 'leave', name: s.prof.name });
  }

  setParty(s, m) {
    const p = s.party;
    if (!p || p.host !== s.id) return;
    const next = cleanSettings(m.set, p.set);
    if (JSON.stringify(next) === JSON.stringify(p.set)) return;
    p.set = next;
    p.packSlots();
    for (const x of p.members.values()) x.ready = false; // 설정이 바뀌면 다시 준비
    p.sync();
  }

  moveSlot(s, m) {
    const p = s.party;
    const slot = m.slot;
    if (!p || !Number.isInteger(slot) || slot < 0 || slot >= slotsOf(p.set)) return;
    if ([...p.members.values()].some((x) => x.slot === slot)) return;
    s.slot = slot;
    p.sync();
  }

  kick(s, m) {
    const p = s.party;
    if (!p || p.host !== s.id) return;
    const target = p.members.get(m.sid);
    if (!target || target === s) return;
    this.leaveParty(target, false, true);
  }

  toggleReady(s) {
    if (!s.party || s.party.host === s.id) return;
    s.ready = !s.ready;
    s.party.sync();
  }

  chat(s, m) {
    if (!s.party || !Number.isInteger(m.i) || !QUICK_CHAT[m.i] || this.throttle(s, 'chat', 800)) return;
    s.party.broadcast({ t: 'pmsg', sid: s.id, i: m.i });
  }

  // 시작 조건을 따져 이유를 돌려준다 ('' 이면 시작 가능)
  startBlock(p) {
    if (p.game) return '이미 게임이 진행 중이에요';
    const others = [...p.members.values()].filter((x) => x.id !== p.host);
    if (others.some((x) => !x.ready)) return '모두 준비해야 시작할 수 있어요';
    if (!p.set.ai && p.members.size < 2) return '혼자서는 AI를 켜야 해요';
    if (p.members.size > slotsOf(p.set)) return '3 대 3 은 6명까지예요';
    return '';
  }

  startParty(s) {
    const p = s.party;
    if (!p || p.host !== s.id) return;
    const why = this.startBlock(p);
    if (why) return this.err(s, why);
    const { rule, mode, map, ai } = p.set;
    const g = new Game({ rule, mode, ...(ai ? {} : { BOT_FILL: 0 }), ...(map ? { map, FIXED_MAP: true } : {}) });
    g.party = p.code;
    p.game = g;
    const members = [...p.members.values()];
    for (const x of members) this.addToGame(x, g, teamOfSlot(g.mode, x.slot));
    g.balanceBots();
    g.newRound();
    for (const x of members) {
      x.ready = false;
      this.welcome(x);
    }
    p.sync();
  }

  // 진행 중인 친선 게임에 뒤늦게 들어간다 (내 자리 팀의 AI 자리를 이어받는다)
  joinPartyGame(s) {
    const p = s.party;
    if (!p?.game || s.player) return;
    if (p.game.humanCount >= p.game.cfg.MAX_PLAYERS) return this.err(s, '게임 자리가 가득 찼어요');
    this.addToGame(s, p.game, teamOfSlot(p.game.mode, s.slot));
    p.game.balanceBots();
    this.welcome(s);
    p.sync();
  }

  // ── 게임 ──
  addToGame(s, g, team) {
    s.game = g;
    s.player = g.addPlayer(s.prof.name, (msg) => s.raw(msg), false, s.prof.char, s.prof.skin, { team, fc: s.fc, cheat: s.prof.cheat });
  }

  welcome(s) {
    const g = s.game;
    s.send({ t: 'w', id: s.player.id, team: s.player.team, room: g.room || '', party: g.party || '', ...g.info() });
  }

  quickPlay(s, m) {
    this.updateProfile(s, m);
    if (s.party) this.leaveParty(s, true);
    else this.leaveGame(s, true);
    const g = this.rooms.find({ rule: m.r, mode: m.m, room: m.room, map: m.map });
    if (!g || g.humanCount >= g.cfg.MAX_PLAYERS) return s.send({ t: 'full' });
    const wasEmpty = g.humanCount === 0;
    this.addToGame(s, g);
    g.balanceBots();
    if (wasEmpty) g.newRound(); // 비어 있던 방은 새 라운드로 시작
    this.welcome(s);
  }

  // silent: 다른 동작의 일부로 나갈 때는 'left' 를 보내지 않는다
  leaveGame(s, silent = false) {
    const g = s.game;
    if (!g) return;
    g.removePlayer(s.player.id);
    g.balanceBots();
    s.game = null;
    s.player = null;
    this.rooms.cleanup(g);
    const p = s.party;
    if (p && p.game === g && g.humanCount === 0) p.game = null; // 모두 나가면 친선 게임 끝
    if (!silent) s.send({ t: 'left' });
    if (p) p.sync();
  }
}
