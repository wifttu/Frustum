// 연습(튜토리얼): 혼자 하기 판 위에서 단계별로 조작을 알려 준다. 허수아비는 가만히 서 있다.
// main.js 가 ctx 로 지금 상태를 알려 준다 (게임 판정은 오프라인 Game 그대로).
// 단계마다 "그 단계가 시작된 뒤에 한 것"만 센다 (앞 단계에서 한 행동으로 다음 단계가 저절로 넘어가지 않게).
import { CFG } from './shared/config.js';
import { isFree } from './shared/map.js';
import { SKILLS } from './shared/progress.js';
import { flareLanding } from './shared/sim.js';
import { canSee, segmentBlocked, wrapAngle } from './shared/vision.js';

export const TUTOR_REWARD = 100;
const TOP = 112; // 위쪽 HUD·자막 아래부터 표시한다
const ARROW_HIDE = 3.2; // 허수아비와 이만큼 가까워지면 화살표·표시를 숨긴다 (손전등 사거리 6m 안)
const MIN_SHOW = 1.0; // 단계마다 최소 이만큼(초)은 안내를 보여 준다
const YELLOW = 0xffd25a;
const RED = 0xff5a4a;

// 단계: text 안내, sub 도움말, info(상태) 진행 표시, hi 반짝일 곳, start 시작할 때, target 표시할 허수아비, done 통과 조건
function steps(skill) {
  return [
    { icon: '🕹️', text: '왼쪽 조이스틱을 끌어서 걸어 보세요', hi: 'stickZone', info: (v) => `걸은 거리 ${Math.min(4, v.moved).toFixed(1)} / 4m`, done: (v) => v.moved >= 4 },
    { icon: '👆', text: '화면 오른쪽을 좌우로 밀어서 몸을 돌려 보세요', sub: '걷는 방향과 따로 돌릴 수 있어요', info: (v) => `${Math.min(100, Math.round((v.turned / 2.4) * 100))}%`, done: (v) => v.turned >= 2.4 },
    { icon: '🎯', text: '미션: 허수아비를 찾으세요', sub: '노란 표시를 따라가세요 · 내 앞의 밝은 곳(시야)에 들어오면 보여요', target: 'dummy', arrow: true, done: (v) => v.seen('dummy') },
    {
      icon: '🔦', text: '미션: 손전등으로 허수아비를 처치하세요', sub: '가까이 가서 손전등 버튼! 앞쪽 노란 빛이 닿아야 맞아요', hi: 'attack', target: 'dummy', arrow: true,
      info: (v) => `맞힘 ${v.hits} / 2`, done: (v) => !v.dummy.alive,
    },
    {
      icon: '💎', text: '미션: 떨어진 경험치 보석을 주워 레벨업 하세요', sub: '처치해도, 보석을 먹어도 경험치가 쌓여요 · 바가 가득 차면 레벨업!', hi: 'xpBar',
      info: (v) => (v.level >= 2 ? '레벨업!' : `경험치 ${v.xp} / ${v.next}`), done: (v) => v.level >= 2,
    },
    { icon: '🃏', text: '레벨업! 아래 강화 카드 하나를 눌러 고르세요', sub: '레벨이 오를 때마다 카드로 강해져요', hi: 'choices', done: (v) => v.ups > 0 },
    { icon: '✨', text: `"${SKILLS[skill]?.name || '구르기'}" 버튼을 눌러 보세요`, sub: '캐릭터마다 고유 스킬이 달라요', hi: 'roll', done: (v) => v.skillUses > 0 },
    {
      icon: '⚠️', text: '미션: 경비 허수아비의 빛을 피해 숨으세요', sub: '빛(노란 부채꼴)에 맞으면 체력이 줄어요 · 벽 뒤로 숨거나 멀리 피하세요',
      start: 'turret', target: 'turret', color: RED, info: (v) => (v.safeT > 0 ? `안전 ${Math.min(1.5, v.safeT).toFixed(1)} / 1.5초` : '위험!'),
      done: (v) => v.hurt > 0 && v.safeT >= 1.5,
    },
    {
      icon: '🍀', text: '미션: 숨은 채로 체력을 회복하세요', sub: '4초 동안 맞지 않으면 체력이 저절로 차올라요 · 다시 빛에 맞으면 처음부터',
      info: (v) => `체력 ${Math.ceil(v.hp)} / ${v.maxHp}`, done: (v) => v.hp >= Math.min(v.maxHp, v.lowHp + 12),
    },
    {
      icon: '🎆', text: '미션: 조명탄을 던져 숨은 허수아비를 찾으세요', sub: '조명탄은 앞으로 날아가 주변 7m를 밝혀요 · 시야 밖 어둠 속도 보여요', hi: 'flare',
      start: 'hidden', target: 'hiddenFound', done: (v) => v.flareUses > 0 && v.lit,
    },
  ];
}

// 열린 곳에서 플레이어 자리와 (등 뒤) 허수아비 자리를 고른다
export function pickSpots(map) {
  const free = (x, z) => isFree(x, z, 1.3, map.solid);
  for (let r = 0; r < 26; r += 1) {
    for (let a = 0; a < 6.28; a += 0.4) {
      const x = Math.round(Math.sin(a) * r);
      const z = Math.round(-18 + Math.cos(a) * r * 0.6);
      const dx = x;
      const dz = z - 9;
      if (!free(x, z) || !free(dx, dz) || segmentBlocked(x, z, dx, dz, map.walls)) continue;
      // 앞으로 걸어갈 자리도 비어 있어야 한다
      if (!free(x, z + 4) || !free(x + 2.5, z + 2) || !free(x - 2.5, z + 2)) continue;
      return { me: [x, z], dummy: [dx, dz] };
    }
  }
  return { me: [0, -18], dummy: [0, -27] };
}

export class Tutorial {
  constructor(ctx) {
    this.ctx = ctx; // { $, sfx, state(), project(x,y,z), stickCenter(), ring(), turnTo(yaw), game, player, dummy, onFinish() }
    this.list = steps(ctx.skill);
    this.ents = { dummy: ctx.dummy };
    this.i = -1;
    this.bob = 0;
    this.next();
  }

  next() {
    const { $ } = this.ctx;
    this.clearHi();
    // 앞 단계의 경비 허수아비는 조용히 치운다
    if (this.list[this.i]?.icon === '🍀' && this.ents.turret) {
      this.ctx.game.removePlayer(this.ents.turret.id);
      this.ents.turret = null;
    }
    this.i++;
    if (this.i >= this.list.length) {
      $('tutor').hidden = true;
      this.hideTarget();
      this.ctx.onFinish();
      return;
    }
    const st = this.list[this.i];
    const s = this.ctx.state();
    // 이 단계가 시작된 뒤의 행동만 세도록 기준을 새로 잡는다
    this.t = 0;
    this.acc = { moved: 0, turned: 0, safeT: 0 };
    this.base = { skill: s.skillUses, flare: s.flareUses, hurt: s.hurt };
    this.lowHp = s.hp;
    this.last = null;
    this.doneT = 0;
    this.infoText = '';
    $('tutorIcon').textContent = st.icon;
    $('tutorText').textContent = st.text;
    $('tutorSub').textContent = st.sub || '';
    $('tutorInfo').textContent = '';
    $('tutorCount').textContent = `${this.i + 1} / ${this.list.length}`;
    $('tutor').hidden = false;
    $('tutor').classList.remove('pass');
    $('tutor').style.animation = 'none';
    void $('tutor').offsetWidth;
    $('tutor').style.animation = '';
    if (st.hi) $(st.hi)?.classList.add('tutorHi');
    if (st.hi === 'stickZone') this.placeStickZone();
    if (st.start === 'turret') this.spawnTurret();
    if (st.start === 'hidden') this.spawnHidden();
    this.hideTarget();
    this.ctx.sfx?.choose?.();
  }

  // 노란 원을 실제 조이스틱 자리에
  placeStickZone() {
    const [x, y] = this.ctx.stickCenter();
    const el = this.ctx.$('stickZone');
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
  }

  clearHi() {
    for (const el of document.querySelectorAll('.tutorHi')) el.classList.remove('tutorHi');
  }

  hideTarget() {
    this.ctx.$('tutorArrow').hidden = true;
    this.ctx.$('tutorMark').hidden = true;
    this.ctx.ring?.(0, 0, false);
  }

  addDummy(name, x, z, extra) {
    const { game } = this.ctx;
    const d = game.addPlayer(name, null, true);
    Object.assign(d, { dummy: true, char: 'explorer', skin: 'default', ...extra });
    game.applyStats(d);
    Object.assign(d, { x, z, alive: true, hp: d.stats.maxHp });
    game.rosterDirty = true;
    return d;
  }

  // 경비 허수아비: 플레이어 앞쪽 3.5~5m, 사이에 벽이 없는 곳. 나를 바라보고 바로 비춘다.
  spawnTurret() {
    const { game, player } = this.ctx;
    let spot = null;
    // 내 앞쪽(시야 안)부터 찾아서 누가 쏘는지 보이게 한다
    for (const r of [4.5, 4, 5, 3.5]) {
      for (let k = 0; k < 16 && !spot; k++) {
        const a = player.yaw + (k % 2 ? -1 : 1) * Math.ceil(k / 2) * (Math.PI / 10);
        const x = player.x + Math.sin(a) * r;
        const z = player.z + Math.cos(a) * r;
        if (isFree(x, z, 0.8, game.solid) && !segmentBlocked(x, z, player.x, player.z, game.walls)) spot = [x, z];
      }
      if (spot) break;
    }
    spot ||= [player.x + 3, player.z + 3];
    this.ents.turret = this.addDummy('경비 허수아비', spot[0], spot[1], { turret: true, yaw: Math.atan2(player.x - spot[0], player.z - spot[1]) });
    // 앞이 막혀 옆이나 뒤에 세웠으면 그쪽으로 몸을 돌려 누가 비추는지 보이게 한다
    const toward = Math.atan2(spot[0] - player.x, spot[1] - player.z);
    if (Math.abs(wrapAngle(toward - player.yaw)) > 0.6) this.ctx.turnTo(toward);
  }

  // 숨은 허수아비: 지금 시야에는 안 보이고(옆쪽 어둠), 앞으로 던진 조명탄 빛(7m)에는 보이는 곳.
  // 지금 방향에서 못 찾으면 몸을 돌려 준다.
  spawnHidden() {
    const { game, player } = this.ctx;
    const walls = game.walls;
    // 지금 바라보는 쪽부터 16방향을 차례로 본다 (구석에 있어도 트인 쪽을 찾는다)
    const yaws = Array.from({ length: 16 }, (_, k) => player.yaw + (k % 2 ? -1 : 1) * Math.ceil(k / 2) * (Math.PI / 8));
    for (const yaw of yaws) {
      const me = { x: player.x, z: player.z, yaw };
      const [lx, lz] = flareLanding(me, walls);
      if (Math.hypot(lx - me.x, lz - me.z) < 4.5) continue; // 앞이 막혀 조명탄이 멀리 못 간다
      for (const off of [1.2, 1.35, 1.5, 1.65]) {
        for (const side of [1, -1]) {
          for (const r of [5, 6, 4.5, 7, 4]) {
            const a = yaw + side * off;
            const x = me.x + Math.sin(a) * r;
            const z = me.z + Math.cos(a) * r;
            if (!isFree(x, z, 0.8, game.solid)) continue;
            if (Math.hypot(x - lx, z - lz) > CFG.FLARE_RADIUS - 0.8 || segmentBlocked(lx, lz, x, z, walls)) continue;
            if (canSee(me, x, z, CFG.PLAYER_RADIUS, walls, CFG, 0.6)) continue; // 지금 시야에 보이면 안 된다
            if (Math.abs(wrapAngle(yaw - player.yaw)) > 0.05) this.ctx.turnTo(yaw);
            this.ents.hidden = this.addDummy('숨은 허수아비', x, z, { yaw: Math.random() * 6 });
            return;
          }
        }
      }
    }
    // 마땅한 곳이 없으면(좁은 구석) 맵 안의 가까운 빈자리에 두고, 화살표로 방향만 알려 준다
    for (let r = 4; r < 12; r += 1) {
      for (let k = 0; k < 16; k++) {
        const a = player.yaw + (k / 16) * Math.PI * 2;
        const x = player.x + Math.sin(a) * r;
        const z = player.z + Math.cos(a) * r;
        if (!isFree(x, z, 0.8, game.solid)) continue;
        this.ents.hidden = this.addDummy('숨은 허수아비', x, z, {});
        this.hiddenHint = true;
        return;
      }
    }
  }

  // 허수아비 표시: 발밑 고리 + (화면 안) 머리 위 ▼ 또는 (화면 밖) 가장자리 화살표
  drawTarget(s, dt, ent, { arrow: useArrow, color }) {
    const { $, project } = this.ctx;
    const arrow = $('tutorArrow');
    const mark = $('tutorMark');
    if (!ent || !ent.alive) return this.hideTarget();
    this.bob += dt;
    this.ctx.ring?.(ent.x, ent.z, true, this.bob, color);
    const dist = Math.hypot(ent.x - s.x, ent.z - s.z);
    if (!useArrow || dist <= ARROW_HIDE) {
      arrow.hidden = mark.hidden = true;
      return;
    }
    const bounce = Math.abs(Math.sin(this.bob * 5)) * 10;
    const W = innerWidth;
    const H = innerHeight;
    const [bx, by, bz] = project(ent.x, 1, ent.z); // 몸통
    const bodyOn = bz < 1 && bx > 0 && bx < W && by > 50 && by < H;
    const [hx, hy] = project(ent.x, 3.7, ent.z); // 이름표보다 위
    if (bodyOn) {
      arrow.hidden = true;
      mark.hidden = !(hy > TOP + 40);
      if (!mark.hidden) mark.style.transform = `translate(${hx.toFixed(1)}px, ${(hy - bounce).toFixed(1)}px) translate(-50%, -100%)`;
      return;
    }
    mark.hidden = true;
    arrow.hidden = false;
    // 화면 밖: 내 캐릭터에서 그쪽(원근 반영)으로 뻗은 선이 화면 가장자리와 만나는 곳
    const [px, py] = project(s.x, 0.9, s.z);
    const ux = (ent.x - s.x) / dist;
    const uz = (ent.z - s.z) / dist;
    const [qx, qy] = project(s.x + ux * 1.5, 0.9, s.z + uz * 1.5);
    let dx = qx - px;
    let dy = qy - py;
    const l = Math.hypot(dx, dy) || 1;
    dx /= l;
    dy /= l;
    const m = 46;
    const tx = dx > 0 ? (W - m - px) / dx : dx < 0 ? (m - px) / dx : Infinity;
    const ty = dy > 0 ? (H - m - py) / dy : dy < 0 ? (TOP + 24 - py) / dy : Infinity;
    const t = Math.max(0, Math.min(tx, ty)) - bounce;
    arrow.style.transform = `translate(${(px + dx * t).toFixed(1)}px, ${(py + dy * t).toFixed(1)}px) translate(-50%, -50%)`;
    arrow.querySelector('i').style.transform = `rotate(${Math.atan2(dx, -dy).toFixed(3)}rad)`;
  }

  update(dt) {
    if (this.i >= this.list.length) return;
    const s = this.ctx.state();
    this.t += dt;
    if (this.last) {
      // 조이스틱으로 걸은 거리만 센다 (구르기·질주·순간이동은 빼고)
      const step = Math.hypot(s.x - this.last.x, s.z - this.last.z);
      const turn = Math.abs(wrapAngle(s.yaw - this.last.yaw));
      if (s.walking && step < 2) this.acc.moved += step;
      if (turn < 0.6) this.acc.turned += turn;
    }
    this.last = { x: s.x, z: s.z, yaw: s.yaw };
    this.lowHp = Math.min(this.lowHp, s.hp);
    const st = this.list[this.i];
    const { dummy, turret, hidden } = this.ents;
    // 경비 허수아비의 빛이 닿지 않는 곳에 머문 시간
    if (turret) {
      const safe = Math.hypot(turret.x - s.x, turret.z - s.z) > turret.stats.range + 0.8 || segmentBlocked(turret.x, turret.z, s.x, s.z, this.ctx.game.walls);
      this.acc.safeT = safe ? this.acc.safeT + dt : 0;
    }
    const max = dummy.stats?.maxHp || 68;
    const lit = !!hidden && s.visible(hidden.id) && s.flares.some(([fx, fz]) => Math.hypot(fx - hidden.x, fz - hidden.z) < CFG.FLARE_RADIUS + 0.5);
    const v = {
      ...this.acc, dummy, hits: dummy.alive ? Math.min(2, Math.round(((max - dummy.hp) / max) * 2)) : 2,
      seen: (k) => !!this.ents[k] && s.visible(this.ents[k].id),
      level: s.level, xp: s.xp, next: s.next, ups: s.ups, hp: s.hp, maxHp: s.maxHp, lowHp: this.lowHp, lit,
      skillUses: s.skillUses - this.base.skill, flareUses: s.flareUses - this.base.flare, hurt: s.hurt - this.base.hurt,
    };
    if (st.target === 'hiddenFound') {
      if (lit || this.doneT > 0) this.drawTarget(s, dt, hidden, { arrow: false, color: YELLOW });
      else if (this.hiddenHint) this.drawTarget(s, dt, hidden, { arrow: true, color: YELLOW }); // 구석이라 자리를 못 고른 경우만 방향 안내
    } else if (st.target) this.drawTarget(s, dt, this.ents[st.target], { arrow: st.arrow, color: st.color ?? YELLOW });
    if (st.info) {
      const t = st.info(v);
      if (t !== this.infoText) this.ctx.$('tutorInfo').textContent = this.infoText = t;
    }
    // 통과하면 잠깐 초록으로 반짝이고 다음 단계로
    if (this.doneT > 0) {
      this.doneT -= dt;
      if (this.doneT <= 0) this.next();
      return;
    }
    if (this.t >= MIN_SHOW && st.done(v)) {
      this.doneT = 0.9;
      if (st.target !== 'hiddenFound') this.hideTarget();
      this.ctx.$('tutor').classList.add('pass');
      this.ctx.sfx?.pickup?.();
    }
  }

  stop() {
    this.clearHi();
    this.i = this.list.length;
    this.ctx.$('tutor').hidden = true;
    this.hideTarget();
  }
}
