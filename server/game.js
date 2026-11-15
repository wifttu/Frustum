// 권위 서버 게임 로직. 네트워크와 분리되어 있어 테스트와 오프라인 모드에서 그대로 쓴다.
import { CFG, FLARE_VIEW, ITEM_RULES, ITEM_TYPES, ITEMS, RULES, ZONE, zoneHalf } from '../shared/config.js';
import { MAP_ROTATION, MAP_SIZE, MAPS, isFree } from '../shared/map.js';
import { flareLanding, stepPlayer } from '../shared/sim.js';
import { canSee, segmentBlocked, wrapAngle } from '../shared/vision.js';
import { botThink } from './bots.js';

const DT = 1 / CFG.TICK_RATE;
const MAX_QUEUE = 10;
const q2 = (v) => Math.round(v * 100) / 100;

export class Game {
  constructor(opts = {}) {
    this.mode = opts.mode === 'ffa' ? 'ffa' : 'duo';
    this.rule = Object.hasOwn(RULES, opts.rule) ? opts.rule : 'survival';
    const R = RULES[this.rule];
    this.respawns = R.respawn;
    this.zoned = !!R.zone; // 독구름이 조여 오는 규칙인가
    this.cfg = { ...CFG, TEAMS: this.mode === 'ffa' ? 0 : CFG.TEAMS, ROUND_TIME: R.time, ...opts };
    delete this.cfg.mode;
    delete this.cfg.rule;
    this.target = R.target ? (opts.TARGET ?? R.target[this.mode]) : 0; // 점수제 목표 킬
    this.roundT = 0; // 현재 라운드 경과 시간
    // 맵: 라운드마다 순서대로 바뀐다. walls 는 시야를 막고, solid(= walls + 물)는 이동을 막는다.
    this.mapIdx = Math.max(0, MAP_ROTATION.indexOf(opts.map));
    this.setMap(MAP_ROTATION[this.mapIdx]);
    this.items = [];
    this.itemT = 0;
    this.nextItem = 1;
    this.useItems = opts.items !== false;
    this.players = new Map();
    this.flares = [];
    this.nextId = 1;
    this.tick = 0;
    this.rosterDirty = false;
    this.kills = [];
    this.blocks = []; // 반사 조끼가 막은 공격 [공격자, 대상]
    this.events = []; // 라운드 시작/종료 알림
    this.endT = 0; // > 0 이면 라운드 종료 후 휴식 중
    this.winner = null;
  }

  setMap(id) {
    this.map = MAPS[id];
    this.walls = this.map.walls;
    this.water = this.map.water;
  }

  // 이동 충돌 목록 (테스트가 walls 를 바꿔 끼워도 따라간다)
  get solid() {
    if (!this.water.length) return this.walls;
    if (this._solidOf !== this.walls) {
      this._solidOf = this.walls;
      this._solid = [...this.walls, ...this.water];
    }
    return this._solid;
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
      alive: false, respawn: 0, gas: 0, cd: 0, speedT: 0, vest: 0, cloakT: 0, picked: [], beam: 0, score: 0, wins: 0,
      rollT: 0, rollCd: 0, rollDx: 0, rollDz: 1, flareCd: 0,
      queue: [], budget: 0, ack: 0, lastSeq: 0, ai: {},
    };
    const bots = isBot ? [] : [...this.players.values()].filter((q) => q.isBot);
    const seat = bots.find((q) => q.alive) || bots[0];
    if (seat) {
      this.players.delete(seat.id);
      Object.assign(p, { team: seat.team, x: seat.x, z: seat.z, yaw: seat.yaw, alive: seat.alive, respawn: seat.respawn, score: seat.score });
    } else {
      p.team = 1000 + id; // 개인전: 각자 고유 팀
      if (this.cfg.TEAMS > 0) {
        p.team = 1;
        for (let t = 2; t <= this.cfg.TEAMS; t++) if (this.teamSize(t) < this.teamSize(p.team)) p.team = t;
      }
      // 서바이벌은 라운드가 한창이면 다음 라운드부터 참가, 데스매치는 바로 참가
      if (this.endT <= 0 && (this.respawns || this.roundT < this.cfg.JOIN_GRACE)) this.spawn(p);
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

  // 현재 안전 구역의 절반 길이 (독구름이 없는 규칙은 Infinity)
  zoneHalf() {
    return this.zoned ? zoneHalf(this.roundT) : Infinity;
  }

  // 안전 구역 안의 빈 지점
  randomFreePoint(clearance = 1) {
    const span = Math.min(MAP_SIZE - 4, (this.zoneHalf() - 1.5) * 2);
    for (let i = 0; i < 200; i++) {
      const x = (Math.random() - 0.5) * span;
      const z = (Math.random() - 0.5) * span;
      if (isFree(x, z, clearance, this.solid)) return [x, z];
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
    p.gas = 0;
    p.speedT = 0;
    p.vest = 0;
    p.cloakT = 0;
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
    stepPlayer(p, inp, DT, this.solid);
    // 구르는 중에는 공격할 수 없다
    if (inp.atk && p.cd <= 0 && !(p.rollT > 0) && this.roundT >= this.cfg.START_GRACE) this.attack(p);
    if (inp.flare && p.flareCd <= 0) this.throwFlare(p);
  }

  // 손전등 빔: 좁고 긴 원뿔 안의, 벽에 가리지 않은 적을 처치한다.
  attack(p) {
    const cfg = this.cfg;
    p.cd = cfg.ATTACK_COOLDOWN;
    p.beam = cfg.BEAM_TIME;
    p.cloakT = 0; // 공격하면 망토가 벗겨진다
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
      if (q.vest > 0) {
        // 반사 조끼: 이번 한 번은 막는다
        q.vest = 0;
        this.blocks.push([p.id, q.id]);
        continue;
      }
      q.alive = false;
      q.respawn = cfg.RESPAWN_TIME;
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

  // 팀별 킬 합계 (개인전은 본인 킬)
  killsByTeam() {
    const m = new Map();
    for (const p of this.players.values()) m.set(p.team, (m.get(p.team) || 0) + p.score);
    return m;
  }

  // 서바이벌: 한 팀(개인전은 한 명)만 남으면 종료. 점수제: 목표 킬 달성 시 종료.
  checkRoundEnd() {
    if (this.endT > 0 || this.players.size < 2) return;
    if (!this.respawns) {
      const teams = this.aliveByTeam();
      if (teams.size <= 1) this.endRound(teams.size ? [...teams.keys()][0] : 0);
    } else if (this.target) {
      for (const [team, kills] of this.killsByTeam()) {
        if (kills >= this.target) return this.endRound(team);
      }
    }
  }

  // 시간 초과. 서바이벌: 생존자가 많은 팀 → 킬이 많은 팀. 데스매치: 킬이 많은 팀. 동률이면 무승부(0)
  timeUp() {
    if (this.respawns) {
      const rank = [...this.killsByTeam()].sort((a, b) => b[1] - a[1]);
      const tie = rank.length > 1 && rank[0][1] === rank[1][1];
      return this.endRound(rank.length && !tie ? rank[0][0] : 0);
    }
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
    if (!this.cfg.FIXED_MAP) {
      this.mapIdx = (this.mapIdx + 1) % MAP_ROTATION.length;
      this.setMap(MAP_ROTATION[this.mapIdx]);
    }
    for (const p of this.players.values()) {
      p.score = 0;
      p.flareCd = 0;
      p.queue.length = 0;
      p.alive = false; // spawn 이 다른 플레이어 시야를 피하도록 먼저 모두 비활성화
    }
    for (const p of this.players.values()) {
      this.spawn(p);
      if (p.ai) p.ai = {}; // 봇 경로는 새 맵 기준으로 다시
    }
    this.items.length = 0;
    this.itemT = 0;
    for (let i = 0; i < ITEM_RULES.START; i++) this.spawnItem();
    this.rosterDirty = true;
    this.events.push({ t: 'n', map: this.map.id });
  }

  spawnItem() {
    if (!this.useItems || this.items.length >= ITEM_RULES.MAX) return;
    const [x, z] = this.randomFreePoint(1.2);
    const type = ITEM_TYPES[Math.floor(Math.random() * ITEM_TYPES.length)];
    this.items.push({ id: this.nextItem++, type, x, z });
  }

  pickItem(p, it) {
    if (it.type === 'battery') {
      p.cd = 0;
      p.flareCd = 0;
    } else if (it.type === 'sneakers') p.speedT = ITEMS.sneakers.time;
    else if (it.type === 'vest') p.vest = ITEMS.vest.time;
    else if (it.type === 'cloak') p.cloakT = ITEMS.cloak.time;
    if (p.send) p.picked.push(it.type);
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

    // 독구름: 안전 구역 밖에 GAS_TIME 이상 머물면 탈락 (킬 피드의 처치자 0 = 독구름)
    if (this.zoned) {
      const half = this.zoneHalf();
      let died = false;
      for (const p of this.players.values()) {
        if (!p.alive) continue;
        const out = Math.max(Math.abs(p.x), Math.abs(p.z)) > half;
        p.gas = out ? p.gas + DT : Math.max(0, p.gas - DT * ZONE.RECOVER);
        if (p.gas < ZONE.GAS_TIME) continue;
        p.alive = false;
        p.queue.length = 0;
        this.kills.push([0, p.id]);
        this.rosterDirty = true;
        died = true;
      }
      if (died) this.checkRoundEnd();
      if (this.endT > 0) return;
    }

    // 아이템: 일정 간격으로 생기고, 살아있는 플레이어가 밟으면 줍는다
    if (this.useItems) {
      this.itemT += DT;
      if (this.itemT >= ITEM_RULES.EVERY) {
        this.itemT = 0;
        this.spawnItem();
      }
      const half = this.zoneHalf();
      this.items = this.items.filter((it) => {
        if (Math.max(Math.abs(it.x), Math.abs(it.z)) > half) return false; // 독구름에 삼켜짐
        for (const p of this.players.values()) {
          if (!p.alive || Math.hypot(p.x - it.x, p.z - it.z) > ITEM_RULES.PICK_RADIUS) continue;
          this.pickItem(p, it);
          return false;
        }
        return true;
      });
    }

    for (const p of this.players.values()) {
      p.cd = Math.max(0, p.cd - DT);
      p.vest = Math.max(0, p.vest - DT);
      p.cloakT = Math.max(0, p.cloakT - DT);
      p.beam = Math.max(0, p.beam - DT);
      p.flareCd = Math.max(0, p.flareCd - DT);
      if (!p.alive) {
        // 서바이벌은 다음 라운드까지 대기, 데스매치는 잠시 후 부활
        while (p.queue.length) p.ack = p.queue.shift().seq;
        if (this.respawns) {
          p.respawn -= DT;
          if (p.respawn <= 0) {
            this.spawn(p);
            this.rosterDirty = true;
          }
        }
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
          // 그림자 망토: 아주 가까이 오지 않으면 보이지 않는다 (서버가 위치를 보내지 않음)
          if (q.cloakT > 0 && Math.hypot(s.x - q.x, s.z - q.z) > ITEM_RULES.CLOAK_NEAR) continue;
          if (canSee(s, q.x, q.z, cfg.PLAYER_RADIUS, this.walls, view, cfg.VIS_MARGIN)) {
            set.add(q.id);
            break;
          }
        }
      }
      vis.set(team, set);
    }
    // 팀별로 보이는 아이템
    if (this.items.length) {
      for (const [team, list] of sources) {
        const set = new Set();
        for (const it of this.items) {
          for (const [s, view] of list) {
            if (canSee(s, it.x, it.z, 0.3, this.walls, view)) {
              set.add(it.id);
              break;
            }
          }
        }
        vis.set('i' + team, set);
      }
    }
    return vis;
  }

  // 플레이어별 스냅샷. 시야 밖 적은 아예 담지 않는다 → 클라이언트 메모리에 위치가 존재하지 않음.
  // e: [id, x, z, yaw, flags]  flags: 1 = 빔 발사 중, 2 = 구르는 중, 4 = 망토, 8 = 조끼
  snapshotFor(p, vis) {
    const seen = vis.get(p.team);
    const e = [];
    for (const q of this.players.values()) {
      if (q === p || !q.alive) continue;
      if (q.team !== p.team && !(seen && seen.has(q.id))) continue;
      e.push([q.id, q2(q.x), q2(q.z), q2(q.yaw), (q.beam > 0 ? 1 : 0) | (q.rollT > 0 ? 2 : 0) | (q.cloakT > 0 ? 4 : 0) | (q.vest > 0 ? 8 : 0)]);
    }
    const f = [];
    for (const fl of this.flares) if (fl.team === p.team) f.push([q2(fl.x), q2(fl.z), q2(fl.t)]);
    const seenItems = vis.get('i' + p.team);
    const it = [];
    if (seenItems) for (const x of this.items) if (seenItems.has(x.id)) it.push([x.id, x.type, q2(x.x), q2(x.z)]);
    const pk = p.picked;
    p.picked = [];
    return {
      t: 's',
      k: this.tick,
      a: p.ack,
      zh: this.zoned ? q2(this.zoneHalf()) : 0, // 안전 구역 절반 길이 (0 = 독구름 없음)
      rt: Math.ceil(Math.max(0, this.cfg.ROUND_TIME - this.roundT)), // 남은 라운드 시간
      // 예측 보정에 필요한 값은 반올림하지 않는다
      me: [p.x, p.z, p.yaw, p.alive ? 1 : 0, this.respawns ? q2(Math.max(0, p.respawn)) : 0, q2(p.cd), p.rollT, p.rollCd, p.rollDx, p.rollDz, q2(p.flareCd), q2(p.gas), p.speedT, q2(p.vest), q2(p.cloakT)],
      e,
      f,
      it, // 보이는 아이템 [id, 종류, x, z]
      pk, // 방금 주운 아이템
    };
  }

  // 접속 시 알려주는 방 정보
  info() {
    return { m: this.mode, r: this.rule, g: this.target, rtm: this.cfg.ROUND_TIME, map: this.map.id };
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
    if (this.blocks.length) {
      all({ t: 'b', l: this.blocks });
      this.blocks = [];
    }
    for (const ev of this.events) all(ev);
    this.events = [];
    if (!humans.length) return;
    const vis = this.computeVisibility();
    for (const p of humans) p.send(JSON.stringify(this.snapshotFor(p, vis)));
  }
}
