// 연습(튜토리얼): 혼자 하기 판 위에서 단계별로 조작을 알려 준다. 허수아비는 가만히 서 있다.
// main.js 가 ctx 로 지금 상태를 알려 준다 (게임 판정은 오프라인 Game 그대로).
// 단계마다 "그 단계가 시작된 뒤에 한 것"만 센다 (앞 단계에서 한 행동으로 다음 단계가 저절로 넘어가지 않게).
import { CFG } from './shared/config.js';
import { SKILLS } from './shared/progress.js';
import { TUTORIAL_LAYOUT } from './shared/tutorial.js';
import { segmentBlocked, wrapAngle } from './shared/vision.js';

export const TUTOR_REWARD = 100;
const TOP = 112; // 위쪽 HUD·자막 아래부터 표시한다
const ARROW_HIDE = 3.2; // 목표와 이만큼 가까워지면 화살표·표시를 숨긴다
const MIN_SHOW = 1.0; // 단계마다 최소 이만큼(초)은 안내를 보여 준다
const HEAL_GOAL = 20; // 회복 단계: 이만큼 차오르면 통과
const YELLOW = 0xffd25a;
const RED = 0xff5a4a;
const GREEN = 0x8affb0;

// 고정 배치 (shared/tutorial.js). 처음 자리에서는 허수아비가 벽에 가려 안 보이고, 걸어가야 찾을 수 있다.
export const LAYOUT = TUTORIAL_LAYOUT;

// 단계: text 안내, sub 도움말, info(상태) 진행 표시, hi 반짝일 곳, start 시작할 때, target 표시할 곳, done 통과 조건
function steps(skill) {
  return [
    { icon: '🕹️', text: '왼쪽 조이스틱을 끌어서 걸어 보세요', sub: '울타리 친 마당 안에서 연습해요', hi: 'stickZone', info: (v) => `걸은 거리 ${Math.min(4, v.moved).toFixed(1)} / 4m`, done: (v) => v.moved >= 4 },
    { icon: '👆', text: '화면 오른쪽을 좌우로 밀어서 몸을 돌려 보세요', sub: '걷는 방향과 따로 돌릴 수 있어요 · 다 하면 앞쪽 문이 열려요', info: (v) => `${Math.min(100, Math.round((v.turned / 2.4) * 100))}%`, done: (v) => v.turned >= 2.4 },
    { icon: '🎯', text: '문이 열렸어요! 미션: 허수아비를 찾으세요', sub: '문을 나가 노란 화살표를 따라가세요 · 내 앞의 밝은 곳(시야)에 들어와야 보여요', start: 'gate', target: 'dummy', arrow: true, done: (v) => v.seen('dummy') },
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
      icon: '⚠️', text: '미션: 경비 허수아비에게 다가갔다가, 빛에 맞으면 숨으세요', sub: '경비는 쓰러뜨릴 수 없어요 · 빛에 맞으면 체력이 줄어요 · 벽 뒤로 숨거나 멀리 피하세요',
      start: 'turret', target: 'turret', arrow: true, color: RED,
      info: (v) => (v.hurt === 0 ? '빨간 표시 쪽으로' : v.safeT > 0 ? `안전 ${Math.min(1.5, v.safeT).toFixed(1)} / 1.5초` : '맞고 있어요! 숨으세요'),
      done: (v) => v.hurt > 0 && v.safeT >= 1.5,
    },
    {
      icon: '🍀', text: '미션: 숨은 채로 체력을 회복하세요', sub: '맞지 않고 4초가 지나면 체력이 저절로 차올라요 · 다시 맞으면 처음부터',
      info: (v) => (v.wait > 0 ? `회복 시작까지 ${v.wait.toFixed(1)}초` : `회복 ${Math.min(HEAL_GOAL, Math.floor(v.healed))} / ${HEAL_GOAL}`),
      done: (v) => v.healed >= HEAL_GOAL || v.hp >= v.maxHp,
    },
    {
      icon: '🟡', text: '미션: 노란 발판으로 가세요', sub: '조명탄을 던질 자리예요', target: 'pad', arrow: true, color: GREEN,
      done: (v) => v.padDist < 1.3,
    },
    {
      icon: '🎆', text: '미션: 조명탄을 던져 숨은 허수아비를 찾으세요', sub: '앞쪽 벽 너머 어둠에 숨어 있어요 · 조명탄은 앞으로 날아가 주변 7m를 밝혀요', hi: 'flare',
      start: 'hidden', target: 'hiddenFound',
      info: (v) => (v.padDist > 1.6 ? '노란 발판 위에서 던지세요' : v.flareUses > 0 && !v.lit && !v.flaring ? '한 번 더 던져 보세요' : ''),
      done: (v) => v.flareUses > 0 && v.lit,
    },
  ];
}

export class Tutorial {
  constructor(ctx) {
    this.ctx = ctx; // { $, sfx, state(), project(x,y,z), stickCenter(), ring(), turnTo(yaw), resetFlare(), game, player, dummy, onFinish() }
    this.list = steps(ctx.skill);
    this.ents = { dummy: ctx.dummy, pad: { x: LAYOUT.pad[0], z: LAYOUT.pad[1], alive: true } };
    this.i = -1;
    this.bob = 0;
    ctx.setGate(true); // 걷기·돌기를 배우는 동안은 시작 마당의 문을 닫아 둔다
    this.next();
  }

  next() {
    const { $ } = this.ctx;
    this.clearHi();
    // 회복 단계가 끝나면 경비 허수아비는 조용히 치운다
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
    this.hurtSeen = s.hurt;
    this.calmT = 99; // 마지막으로 맞은 뒤 지난 시간
    this.onPad = false;
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
    if (st.start === 'gate') this.ctx.setGate(false);
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

  addDummy(name, [x, z], extra) {
    const { game } = this.ctx;
    const d = game.addPlayer(name, null, true);
    Object.assign(d, { dummy: true, char: 'explorer', skin: 'default', ...extra });
    game.applyStats(d);
    Object.assign(d, { x, z, alive: true, hp: d.stats.maxHp });
    game.rosterDirty = true;
    return d;
  }

  // 경비 허수아비: 정해진 자리에서 다가오는 상대를 비춘다
  spawnTurret() {
    const [gx, gz] = LAYOUT.guard;
    this.ents.turret = this.addDummy('경비 허수아비', LAYOUT.guard, { turret: true, invuln: true, yaw: Math.atan2(LAYOUT.dummy[0] - gx, LAYOUT.dummy[1] - gz) });
  }

  // 숨은 허수아비: 정해진 자리 (벽 너머 어둠). 발판에 서 있으면 던질 방향으로 몸을 돌려 준다.
  spawnHidden() {
    this.ents.hidden = this.addDummy('숨은 허수아비', LAYOUT.hidden, { yaw: 2.4, invuln: true });
    this.ctx.resetFlare();
  }

  // 표시: 발밑 고리 + (화면 안) 머리 위 ▼ 또는 (화면 밖) 가장자리 화살표
  drawTarget(s, dt, ent, { arrow: useArrow, color }) {
    const { $, project } = this.ctx;
    const arrow = $('tutorArrow');
    const mark = $('tutorMark');
    if (!ent || !ent.alive) return this.hideTarget();
    this.bob += dt;
    this.ctx.ring?.(ent.x, ent.z, true, this.bob, color);
    arrow.querySelector('span').textContent = ent.label || '허수아비';
    mark.querySelector('span').textContent = ent.label || '허수아비';
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
    // 맞으면 회복 기준을 새로 잡는다 (맞은 뒤 가장 낮은 체력부터 센다)
    this.calmT += dt;
    if (s.hurt !== this.hurtSeen) {
      this.hurtSeen = s.hurt;
      this.calmT = 0;
      this.lowHp = s.hp;
    }
    this.lowHp = Math.min(this.lowHp, s.hp);
    const st = this.list[this.i];
    const { dummy, turret, hidden, pad } = this.ents;
    // 경비 허수아비의 빛이 닿지 않는 곳에 머문 시간
    if (turret) {
      // 경비가 실제로 비출 수 있는 거리(사거리 + 몸 반경)와 같은 기준
      const safe = Math.hypot(turret.x - s.x, turret.z - s.z) > turret.stats.range + CFG.PLAYER_RADIUS + 0.05 || segmentBlocked(turret.x, turret.z, s.x, s.z, this.ctx.game.walls);
      this.acc.safeT = safe ? this.acc.safeT + dt : 0;
    }
    // 발판: 올라서면 던질 방향으로 몸을 돌려 준다 (내려갔다 다시 올라와도)
    const padDist = Math.hypot(pad.x - s.x, pad.z - s.z);
    if (st.start === 'hidden') {
      if (padDist < 1.3 && !this.onPad) this.ctx.turnTo(LAYOUT.padYaw);
      this.onPad = padDist < 1.3;
    }
    const max = dummy.stats?.maxHp || 68;
    const lit = !!hidden && s.visible(hidden.id) && s.flares.some(([fx, fz]) => Math.hypot(fx - hidden.x, fz - hidden.z) < CFG.FLARE_RADIUS + 0.5);
    // 조명탄을 던졌는데 못 찾았으면(빛이 꺼진 뒤) 바로 다시 던질 수 있게
    const flaring = s.flares.length > 0;
    if (st.start === 'hidden' && s.flareUses > this.base.flare && !flaring && !lit && !this.retry) {
      this.retry = true;
      this.ctx.resetFlare();
    }
    if (flaring) this.retry = false;
    const v = {
      ...this.acc, dummy, hits: dummy.alive ? Math.min(2, Math.round(((max - dummy.hp) / max) * 2)) : 2,
      seen: (k) => !!this.ents[k] && s.visible(this.ents[k].id),
      level: s.level, xp: s.xp, next: s.next, ups: s.ups, hp: s.hp, maxHp: s.maxHp, lit, flaring, padDist,
      wait: Math.max(0, s.regenDelay - this.calmT), healed: s.hp - this.lowHp,
      skillUses: s.skillUses - this.base.skill, flareUses: s.flareUses - this.base.flare, hurt: s.hurt - this.base.hurt,
    };
    if (st.target === 'hiddenFound') {
      if (lit || this.doneT > 0) this.drawTarget(s, dt, hidden, { arrow: false, color: YELLOW });
      else this.drawTarget(s, dt, { ...pad, label: '발판' }, { arrow: padDist > 1.6, color: GREEN }); // 발판 위치는 계속 보여 준다
    } else if (st.target) {
      const ent = st.target === 'pad' ? { ...pad, label: '발판' } : st.target === 'turret' ? turret && Object.assign(turret, { label: '경비 허수아비' }) : this.ents[st.target];
      this.drawTarget(s, dt, ent, { arrow: st.arrow, color: st.color ?? YELLOW });
    }
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
