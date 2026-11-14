// 권위 서버 게임 로직. 네트워크와 분리되어 있어 테스트에서 그대로 쓸 수 있다.
import { CFG } from '../shared/config.js';
import { MAP_SIZE, WALLS, isFree } from '../shared/map.js';
import { stepPlayer } from '../shared/sim.js';
import { canSee, segmentBlocked, wrapAngle } from '../shared/vision.js';
import { botThink } from './bots.js';

const DT = 1 / CFG.TICK_RATE;
const MAX_QUEUE = 10;
const q2 = (v) => Math.round(v * 100) / 100;

export class Game {
  constructor(opts = {}) {
    this.cfg = { ...CFG, ...opts };
    this.walls = WALLS;
    this.players = new Map();
    this.nextId = 1;
    this.tick = 0;
    this.rosterDirty = false;
    this.kills = [];
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

  addPlayer(name, send = null, isBot = false) {
    const id = this.nextId++;
    let team = 1000 + id; // 개인전: 각자 고유 팀
    if (this.cfg.TEAMS > 0) {
      team = 1;
      for (let t = 2; t <= this.cfg.TEAMS; t++) if (this.teamSize(t) < this.teamSize(team)) team = t;
    }
    const p = {
      id, name, team, isBot, send,
      x: 0, z: 0, yaw: 0,
      alive: true, respawn: 0, cd: 0, swing: 0, score: 0,
      queue: [], budget: 0, ack: 0, ai: {},
    };
    this.players.set(id, p);
    this.spawn(p);
    this.rosterDirty = true;
    return p;
  }

  removePlayer(id) {
    if (this.players.delete(id)) this.rosterDirty = true;
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
    // 적의 시야 밖에서 리스폰
    let pos = [0, 0];
    for (let i = 0; i < 30; i++) {
      pos = this.randomFreePoint();
      let seen = false;
      for (const q of this.players.values()) {
        if (q.alive && q.team !== p.team && q !== p && canSee(q, pos[0], pos[1], this.cfg.PLAYER_RADIUS, this.walls, this.cfg, 2)) {
          seen = true;
          break;
        }
      }
      if (!seen) break;
    }
    p.x = pos[0];
    p.z = pos[1];
    p.yaw = Math.atan2(-p.x, -p.z); // 맵 중앙을 향해
    p.alive = true;
    p.respawn = 0;
    p.cd = 0;
    p.swing = 0;
  }

  // 클라이언트 입력: [seq, mx, mz, yaw, atk]. 값은 신뢰하지 않고 검증/클램프한다.
  queueInput(id, m) {
    const p = this.players.get(id);
    if (!p || !Array.isArray(m) || p.queue.length >= MAX_QUEUE) return;
    const [seq, mx, mz, yaw, atk] = m;
    if (!Number.isInteger(seq) || seq <= p.lastSeq) return;
    if (![mx, mz, yaw].every(Number.isFinite)) return;
    p.lastSeq = seq;
    p.queue.push({
      seq,
      mx: Math.max(-1, Math.min(1, mx)),
      mz: Math.max(-1, Math.min(1, mz)),
      yaw: wrapAngle(yaw),
      atk: !!atk,
    });
  }

  applyInput(p, inp) {
    stepPlayer(p, inp, DT, this.walls);
    if (inp.atk && p.cd <= 0) this.attack(p);
  }

  attack(p) {
    const cfg = this.cfg;
    p.cd = cfg.ATTACK_COOLDOWN;
    p.swing = 0.25;
    for (const q of this.players.values()) {
      if (!q.alive || q.team === p.team) continue;
      const dx = q.x - p.x;
      const dz = q.z - p.z;
      const d = Math.hypot(dx, dz);
      if (d > cfg.ATTACK_RANGE + cfg.PLAYER_RADIUS) continue;
      if (Math.abs(wrapAngle(Math.atan2(dx, dz) - p.yaw)) > cfg.ATTACK_ARC / 2) continue;
      if (segmentBlocked(p.x, p.z, q.x, q.z, this.walls)) continue;
      q.alive = false;
      q.respawn = cfg.RESPAWN_TIME;
      q.queue.length = 0;
      p.score++;
      this.kills.push([p.id, q.id]);
      this.rosterDirty = true;
    }
  }

  step() {
    this.tick++;
    for (const p of this.players.values()) {
      p.cd = Math.max(0, p.cd - DT);
      p.swing = Math.max(0, p.swing - DT);
      if (!p.alive) {
        p.respawn -= DT;
        while (p.queue.length) p.ack = p.queue.shift().seq;
        if (p.respawn <= 0) this.spawn(p);
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

  // 팀별로 "지금 보이는 적" 집합을 계산한다 (팀원 시야의 합집합).
  computeVisibility() {
    const cfg = this.cfg;
    const sources = new Map();
    for (const p of this.players.values()) {
      if (!p.alive) continue;
      if (!sources.has(p.team)) sources.set(p.team, []);
      sources.get(p.team).push(p);
    }
    const vis = new Map();
    for (const [team, members] of sources) {
      const set = new Set();
      for (const q of this.players.values()) {
        if (!q.alive || q.team === team) continue;
        for (const s of members) {
          if (canSee(s, q.x, q.z, cfg.PLAYER_RADIUS, this.walls, cfg, cfg.VIS_MARGIN)) {
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
  snapshotFor(p, vis) {
    const seen = vis.get(p.team);
    const e = [];
    for (const q of this.players.values()) {
      if (q === p || !q.alive) continue;
      if (q.team !== p.team && !(seen && seen.has(q.id))) continue;
      e.push([q.id, q2(q.x), q2(q.z), q2(q.yaw), q.swing > 0 ? 1 : 0]);
    }
    return {
      t: 's',
      k: this.tick,
      a: p.ack,
      me: [p.x, p.z, p.yaw, p.alive ? 1 : 0, q2(Math.max(0, p.respawn)), q2(p.cd)],
      e,
    };
  }

  roster() {
    return {
      t: 'r',
      p: [...this.players.values()].map((p) => [p.id, p.name, p.team, p.score]),
    };
  }

  // 스냅샷/로스터/킬 피드를 전송한다. 킬 피드에는 위치를 싣지 않는다.
  broadcast() {
    const humans = [...this.players.values()].filter((p) => p.send);
    if (this.rosterDirty) {
      const msg = JSON.stringify(this.roster());
      for (const p of humans) p.send(msg);
      this.rosterDirty = false;
    }
    if (this.kills.length) {
      const msg = JSON.stringify({ t: 'k', l: this.kills });
      for (const p of humans) p.send(msg);
      this.kills = [];
    }
    if (!humans.length) return;
    const vis = this.computeVisibility();
    for (const p of humans) p.send(JSON.stringify(this.snapshotFor(p, vis)));
  }
}
