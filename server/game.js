// 권위 서버 게임 로직. 네트워크와 분리되어 있어 테스트와 오프라인 모드에서 그대로 쓴다.
import { CFG, FLARE_VIEW } from '../shared/config.js';
import { MAP_SIZE, WALLS, isFree } from '../shared/map.js';
import { flareLanding, stepPlayer } from '../shared/sim.js';
import { canSee, segmentBlocked, wrapAngle } from '../shared/vision.js';
import { botThink } from './bots.js';

const DT = 1 / CFG.TICK_RATE;
const MAX_QUEUE = 10;
const q2 = (v) => Math.round(v * 100) / 100;

export class Game {
  constructor(opts = {}) {
    this.mode = opts.mode === 'ffa' ? 'ffa' : 'duo';
    this.cfg = { ...CFG, TEAMS: this.mode === 'ffa' ? 0 : CFG.TEAMS, ...opts };
    delete this.cfg.mode;
    this.roundT = 0; // 현재 라운드 경과 시간
    this.walls = WALLS;
    this.players = new Map();
    this.flares = [];
    this.nextId = 1;
    this.tick = 0;
    this.rosterDirty = false;
    this.kills = [];
    this.events = []; // 라운드 시작/종료 알림
    this.endT = 0; // > 0 이면 라운드 종료 후 휴식 중
    this.winner = null;
  }

  get humanCount() {
    let n = 0;
    for (const p of this.players.values()) if (!p.isBot) n++;
    return n;
  }

  teamSize(team) {
    let n = 0;
    for (const p of this.players.values()) if (p.team === team) n++;
    return n;
  }

  // 사람은 봇의 자리(팀, 위치, 생존 상태)를 이어받아 라운드 중에도 바로 플레이한다.
  addPlayer(name, send = null, isBot = false) {
    const id = this.nextId++;
    const p = {
      id, name, team: 0, isBot, send,
      x: 0, z: 0, yaw: 0,
      alive: false, cd: 0, beam: 0, score: 0, wins: 0,
      rollT: 0, rollCd: 0, rollDx: 0, rollDz: 1, flareCd: 0,
      queue: [], budget: 0, ack: 0, lastSeq: 0, ai: {},
    };
    const bots = isBot ? [] : [...this.players.values()].filter((q) => q.isBot);
    const seat = bots.find((q) => q.alive) || bots[0];
    if (seat) {
      this.players.delete(seat.id);
      Object.assign(p, { team: seat.team, x: seat.x, z: seat.z, yaw: seat.yaw, alive: seat.alive, score: seat.score });
    } else {
      p.team = 1000 + id; // 개인전: 각자 고유 팀
      if (this.cfg.TEAMS > 0) {
        p.team = 1;
        for (let t = 2; t <= this.cfg.TEAMS; t++) if (this.teamSize(t) < this.teamSize(p.team)) p.team = t;
      }
      // 라운드가 한창이면 다음 라운드부터 참가
      if (this.endT <= 0 && this.roundT < this.cfg.JOIN_GRACE) this.spawn(p);
    }
    this.players.set(id, p);
    this.rosterDirty = true;
    return p;
  }

  removePlayer(id) {
    if (!this.players.delete(id)) return;
    this.rosterDirty = true;
    this.checkRoundEnd();
  }

  // 사람 수에 맞춰 봇 수를 조절한다.
  balanceBots() {
    const want = Math.max(0, this.cfg.BOT_FILL - this.humanCount);
    const bots = [...this.players.values()].filter((p) => p.isBot);
    for (let i = bots.length; i < want; i++) this.addPlayer(`BOT-${this.nextId}`, null, true);
    for (let i = bots.length; i > want; i--) {
      bots.sort((a, b) => this.teamSize(b.team) - this.teamSize(a.team));
      this.removePlayer(bots.shift().id);
    }
  }

  randomFreePoint(clearance = 1) {
    for (let i = 0; i < 200; i++) {
      const x = (Math.random() - 0.5) * (MAP_SIZE - 4);
      const z = (Math.random() - 0.5) * (MAP_SIZE - 4);
      if (isFree(x, z, clearance)) return [x, z];
    }
    return [5, 5];
  }

  spawn(p) {
    // 적의 시야 밖이면서 다른 플레이어와 가장 멀리 떨어진 후보 지점을 고른다
    let pos = [0, 0];
    let bestScore = -Infinity;
    for (let i = 0; i < 30; i++) {
      const c = this.randomFreePoint();
      let minD = 40;
      let seen = false;
      for (const q of this.players.values()) {
        if (!q.alive || q === p || q.team === p.team) continue;
        minD = Math.min(minD, Math.hypot(q.x - c[0], q.z - c[1]));
        if (canSee(q, c[0], c[1], this.cfg.PLAYER_RADIUS, this.walls, this.cfg, 2)) seen = true;
      }
      const score = minD - (seen ? 100 : 0);
      if (score > bestScore) {
        bestScore = score;
        pos = c;
      }
    }
    p.x = pos[0];
    p.z = pos[1];
    p.yaw = Math.atan2(-p.x, -p.z); // 맵 중앙을 향해
    p.alive = true;
    p.cd = 0;
    p.beam = 0;
    p.rollT = 0;
    p.rollCd = 0;
  }

  // 클라이언트 입력: [seq, mx, mz, yaw, atk, roll, flare]. 값은 신뢰하지 않고 검증/클램프한다.
  queueInput(id, m) {
    const p = this.players.get(id);
    if (!p || !Array.isArray(m) || p.queue.length >= MAX_QUEUE) return;
    const [seq, mx, mz, yaw, atk, roll, flare] = m;
    if (!Number.isInteger(seq) || seq <= p.lastSeq) return;
    if (![mx, mz, yaw].every(Number.isFinite)) return;
    p.lastSeq = seq;
    p.queue.push({
      seq,
      mx: Math.max(-1, Math.min(1, mx)),
      mz: Math.max(-1, Math.min(1, mz)),
      yaw: wrapAngle(yaw),
      atk: !!atk,
      roll: !!roll,
      flare: !!flare,
    });
  }

  applyInput(p, inp) {
    stepPlayer(p, inp, DT, this.walls);
    // 구르는 중에는 공격할 수 없다
    if (inp.atk && p.cd <= 0 && !(p.rollT > 0) && this.roundT >= this.cfg.START_GRACE) this.attack(p);
    if (inp.flare && p.flareCd <= 0) this.throwFlare(p);
  }

  // 손전등 빔: 좁고 긴 원뿔 안의, 벽에 가리지 않은 적을 처치한다.
  attack(p) {
    const cfg = this.cfg;
    p.cd = cfg.ATTACK_COOLDOWN;
    p.beam = cfg.BEAM_TIME;
    const r = cfg.PLAYER_RADIUS;
    for (const q of this.players.values()) {
      if (!q.alive || q.team === p.team) continue;
      if (q.rollT > 0) continue; // 구르기 무적
      const dx = q.x - p.x;
      const dz = q.z - p.z;
      const d = Math.hypot(dx, dz);
      if (d > cfg.ATTACK_RANGE + r) continue;
      // 몸통 반경만큼 각도 여유를 준다 (가까울수록 넓게 맞는다)
      const slack = d > r ? Math.asin(r / d) : Math.PI;
      if (Math.abs(wrapAngle(Math.atan2(dx, dz) - p.yaw)) > cfg.ATTACK_ARC / 2 + slack) continue;
      if (segmentBlocked(p.x, p.z, q.x, q.z, this.walls)) continue;
      q.alive = false;
      q.queue.length = 0;
      p.score++;
      this.kills.push([p.id, q.id]);
      this.rosterDirty = true;
    }
    this.checkRoundEnd();
  }

  throwFlare(p) {
    p.flareCd = this.cfg.FLARE_COOLDOWN;
    const [x, z] = flareLanding(p, this.walls);
    this.flares.push({ team: p.team, x, z, t: this.cfg.FLARE_TIME });
  }

  aliveByTeam() {
    const m = new Map();
    for (const p of this.players.values()) {
      if (!p.alive) continue;
      const t = m.get(p.team) || { n: 0, kills: 0 };
      t.n++;
      m.set(p.team, t);
    }
    for (const p of this.players.values()) if (m.has(p.team)) m.get(p.team).kills += p.score;
    return m;
  }

  // 한 팀(개인전은 한 명)만 남으면 라운드 종료
  checkRoundEnd() {
    if (this.endT > 0 || this.players.size < 2) return;
    const teams = this.aliveByTeam();
    if (teams.size <= 1) this.endRound(teams.size ? [...teams.keys()][0] : 0);
  }

  // 시간 초과: 생존자가 많은 팀, 동률이면 킬이 많은 팀. 그래도 같으면 무승부(0)
  timeUp() {
    const rank = [...this.aliveByTeam()].sort((a, b) => b[1].n - a[1].n || b[1].kills - a[1].kills);
    const tie = rank.length > 1 && rank[0][1].n === rank[1][1].n && rank[0][1].kills === rank[1][1].kills;
    this.endRound(rank.length && !tie ? rank[0][0] : 0);
  }

  endRound(team) {
    this.endT = this.cfg.INTERMISSION;
    this.winner = team;
    const names = [];
    for (const p of this.players.values()) {
      if (p.team !== team) continue;
      p.wins++;
      names.push(p.name);
    }
    this.rosterDirty = true;
    this.events.push({ t: 'e', w: team, s: this.cfg.INTERMISSION, n: names });
  }

  newRound() {
    this.endT = 0;
    this.roundT = 0;
    this.winner = null;
    this.flares.length = 0;
    for (const p of this.players.values()) {
      p.score = 0;
      p.flareCd = 0;
      p.queue.length = 0;
      p.alive = false; // spawn 이 다른 플레이어 시야를 피하도록 먼저 모두 비활성화
    }
    for (const p of this.players.values()) this.spawn(p);
    this.rosterDirty = true;
    this.events.push({ t: 'n' });
  }

  step() {
    this.tick++;
    for (const f of this.flares) f.t -= DT;
    this.flares = this.flares.filter((f) => f.t > 0);

    if (this.endT > 0) {
      // 라운드 사이 휴식: 입력은 소비하되 움직이지 않는다
      this.endT -= DT;
      for (const p of this.players.values()) {
        while (p.queue.length) p.ack = p.queue.shift().seq;
      }
      if (this.endT <= 0) this.newRound();
      return;
    }

    this.roundT += DT;
    if (this.roundT >= this.cfg.ROUND_TIME) {
      this.timeUp();
      return;
    }

    for (const p of this.players.values()) {
      p.cd = Math.max(0, p.cd - DT);
      p.beam = Math.max(0, p.beam - DT);
      p.flareCd = Math.max(0, p.flareCd - DT);
      if (!p.alive) {
        // 탈락: 다음 라운드까지 대기
        while (p.queue.length) p.ack = p.queue.shift().seq;
        continue;
      }
      if (p.isBot) {
        this.applyInput(p, botThink(p, this, DT));
        continue;
      }
      // 틱당 입력 1개씩만 적립 → 입력을 몰아 보내는 스피드핵 방지
      p.budget = Math.min(p.budget + 1, 4);
      while (p.alive && p.queue.length && p.budget >= 1) {
        const inp = p.queue.shift();
        this.applyInput(p, inp);
        p.ack = inp.seq;
        p.budget--;
      }
    }
  }

  // 팀별로 "지금 보이는 적" 집합을 계산한다 (팀원 시야 + 팀 조명탄의 합집합).
  computeVisibility() {
    const cfg = this.cfg;
    const sources = new Map();
    const add = (team, src, view) => {
      if (!sources.has(team)) sources.set(team, []);
      sources.get(team).push([src, view]);
    };
    for (const p of this.players.values()) if (p.alive) add(p.team, p, cfg);
    for (const f of this.flares) add(f.team, { x: f.x, z: f.z, yaw: 0 }, FLARE_VIEW);

    const vis = new Map();
    for (const [team, list] of sources) {
      const set = new Set();
      for (const q of this.players.values()) {
        if (!q.alive || q.team === team) continue;
        for (const [s, view] of list) {
          if (canSee(s, q.x, q.z, cfg.PLAYER_RADIUS, this.walls, view, cfg.VIS_MARGIN)) {
            set.add(q.id);
            break;
          }
        }
      }
      vis.set(team, set);
    }
    return vis;
  }

  // 플레이어별 스냅샷. 시야 밖 적은 아예 담지 않는다 → 클라이언트 메모리에 위치가 존재하지 않음.
  // e: [id, x, z, yaw, flags]  flags: 1 = 빔 발사 중, 2 = 구르는 중
  snapshotFor(p, vis) {
    const seen = vis.get(p.team);
    const e = [];
    for (const q of this.players.values()) {
      if (q === p || !q.alive) continue;
      if (q.team !== p.team && !(seen && seen.has(q.id))) continue;
      e.push([q.id, q2(q.x), q2(q.z), q2(q.yaw), (q.beam > 0 ? 1 : 0) | (q.rollT > 0 ? 2 : 0)]);
    }
    const f = [];
    for (const fl of this.flares) if (fl.team === p.team) f.push([q2(fl.x), q2(fl.z), q2(fl.t)]);
    return {
      t: 's',
      k: this.tick,
      a: p.ack,
      rt: Math.ceil(Math.max(0, this.cfg.ROUND_TIME - this.roundT)), // 남은 라운드 시간
      // 예측 보정에 필요한 값은 반올림하지 않는다
      me: [p.x, p.z, p.yaw, p.alive ? 1 : 0, 0, q2(p.cd), p.rollT, p.rollCd, p.rollDx, p.rollDz, q2(p.flareCd)],
      e,
      f,
    };
  }

  // p: [id, 이름, 팀, 이번 라운드 킬, 생존 여부, 누적 승]  (위치 정보 없음)
  roster() {
    return {
      t: 'r',
      p: [...this.players.values()].map((p) => [p.id, p.name, p.team, p.score, p.alive ? 1 : 0, p.wins]),
    };
  }

  // 스냅샷/로스터/킬 피드를 전송한다. 킬 피드에는 위치를 싣지 않는다.
  broadcast() {
    const humans = [...this.players.values()].filter((p) => p.send);
    const all = (obj) => {
      const msg = JSON.stringify(obj);
      for (const p of humans) p.send(msg);
    };
    if (this.rosterDirty) {
      all(this.roster());
      this.rosterDirty = false;
    }
    if (this.kills.length) {
      all({ t: 'k', l: this.kills });
      this.kills = [];
    }
    for (const ev of this.events) all(ev);
    this.events = [];
    if (!humans.length) return;
    const vis = this.computeVisibility();
    for (const p of humans) p.send(JSON.stringify(this.snapshotFor(p, vis)));
  }
}
