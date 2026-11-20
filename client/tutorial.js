// 연습(튜토리얼): 혼자 하기 판 위에서 단계별로 조작을 알려 준다. 허수아비는 가만히 서 있고, 경험치 보석은 직접 놓는다.
// main.js 가 ctx 로 지금 상태를 알려 준다 (게임 판정은 오프라인 Game 그대로).
import { isFree } from './shared/map.js';
import { segmentBlocked, wrapAngle } from './shared/vision.js';
import { ORBS, SKILLS } from './shared/progress.js';

export const TUTOR_REWARD = 100;
const TOP = 112; // 위쪽 HUD·자막 아래부터 표시한다
const ARROW_HIDE = 3.2; // 허수아비와 이만큼 가까워지면 화살표·표시를 숨긴다 (손전등 사거리 6m 안)

// 단계: text 안내, sub 도움말, info(상태) 진행 표시, hi 반짝일 곳, target 허수아비 표시, done 통과 조건
function steps(skill) {
  return [
    { icon: '🕹️', text: '왼쪽 조이스틱을 끌어서 걸어 보세요', hi: 'stickZone', info: (s) => `걸은 거리 ${Math.min(4, s.moved).toFixed(1)} / 4m`, done: (s) => s.moved >= 4 },
    { icon: '👆', text: '화면 오른쪽을 좌우로 밀어서 몸을 돌려 보세요', info: (s) => `${Math.min(100, Math.round((s.turned / 2.4) * 100))}%`, done: (s) => s.turned > 2.4 },
    { icon: '🎯', text: '미션: 허수아비를 찾으세요', sub: '노란 표시를 따라가세요 · 내 앞의 밝은 곳(시야)에 들어오면 보여요', target: true, done: (s) => s.seen },
    {
      icon: '🔦', text: '미션: 손전등으로 허수아비를 처치하세요', sub: '가까이 가서 손전등 버튼! 앞쪽 노란 빛이 닿아야 맞아요', hi: 'attack', target: true,
      info: (s) => `맞힘 ${s.hits} / 2`, done: (s) => s.down,
    },
    {
      icon: '💎', text: '미션: 경험치 보석을 먹고 레벨업 하세요', sub: '보석을 먹으면 위쪽 경험치 바가 차요 · 가득 차면 레벨업!', hi: 'xpBar', orbs: true,
      info: (s) => (s.level >= 2 ? '레벨업!' : `경험치 ${s.xp} / ${s.next}`), done: (s) => s.level >= 2,
    },
    { icon: '🃏', text: '레벨업! 아래 강화 카드 하나를 눌러 고르세요', sub: '레벨이 오를 때마다 카드로 강해져요', hi: 'choices', done: (s) => s.ups > 0 },
    { icon: '✨', text: `"${SKILLS[skill]?.name || '구르기'}" 버튼을 눌러 보세요`, sub: '캐릭터마다 고유 스킬이 달라요', hi: 'roll', done: (s) => s.skill },
    { icon: '🎆', text: '조명탄 버튼을 눌러 보세요', sub: '던진 곳이 잠깐 밝아져서 숨은 상대가 보여요', hi: 'flare', done: (s) => s.flare },
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
      // 앞으로 걸어갈 자리와 보석 놓을 자리도 비어 있어야 한다
      if (!free(x, z + 4) || !free(x + 2.5, z + 2) || !free(x - 2.5, z + 2)) continue;
      return { me: [x, z], dummy: [dx, dz] };
    }
  }
  return { me: [0, -18], dummy: [0, -27] };
}

export class Tutorial {
  constructor(ctx) {
    this.ctx = ctx; // { $, sfx, state(), project(x, y, z), stickCenter(), game, player, dummy, onFinish() }
    this.list = steps(ctx.skill);
    this.i = -1;
    this.acc = { moved: 0, turned: 0 };
    this.last = null;
    this.doneT = 0;
    this.bob = 0;
    this.infoText = '';
    this.next();
  }

  next() {
    const { $ } = this.ctx;
    this.clearHi();
    this.i++;
    if (this.i >= this.list.length) {
      $('tutor').hidden = true;
      this.hideTarget();
      this.ctx.onFinish();
      return;
    }
    const st = this.list[this.i];
    $('tutorIcon').textContent = st.icon;
    $('tutorText').textContent = st.text;
    $('tutorSub').textContent = st.sub || '';
    $('tutorInfo').textContent = '';
    this.infoText = '';
    $('tutorCount').textContent = `${this.i + 1} / ${this.list.length}`;
    $('tutor').hidden = false;
    $('tutor').classList.remove('pass');
    $('tutor').style.animation = 'none';
    void $('tutor').offsetWidth;
    $('tutor').style.animation = '';
    if (st.hi) $(st.hi)?.classList.add('tutorHi');
    if (st.hi === 'stickZone') this.placeStickZone();
    if (st.orbs) this.placeOrbs();
    if (!st.target) this.hideTarget();
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

  // 플레이어 앞쪽에 보석 3개 (작은 것 2 + 중간 1 = 30): 딱 한 번 레벨업할 만큼
  placeOrbs() {
    const { game, player } = this.ctx;
    const s = Math.sin(player.yaw);
    const c = Math.cos(player.yaw);
    const put = (f, side, v) => {
      const x = player.x + s * f - c * side;
      const z = player.z + c * f + s * side;
      if (isFree(x, z, 0.4, game.solid)) game.spawnFirefly(x, z, v);
      else game.spawnFirefly(player.x + s * 2, player.z + c * 2, v);
    };
    put(2.6, -0.6, ORBS.small.v);
    put(3.8, 0.6, ORBS.small.v);
    put(5.2, 0, ORBS.medium.v);
  }

  // 허수아비 표시: 화면 안이면 머리 위에 통통 튀는 ▼ 표시, 화면 밖이면 화면 가장자리에서 그쪽을 가리키는 화살표
  drawTarget(s, dt) {
    const { $, dummy, project } = this.ctx;
    const arrow = $('tutorArrow');
    const mark = $('tutorMark');
    const dist = Math.hypot(dummy.x - s.x, dummy.z - s.z);
    if (!dummy.alive) return this.hideTarget();
    this.bob += dt;
    // 발밑의 노란 고리: 3D 장면 안이라 자막에 가리지 않는다 (가까이 가도 쓰러뜨릴 때까지)
    this.ctx.ring?.(dummy.x, dummy.z, true, this.bob);
    if (dist <= ARROW_HIDE) {
      arrow.hidden = mark.hidden = true;
      return;
    }
    const bounce = Math.abs(Math.sin(this.bob * 5)) * 10;
    const W = innerWidth;
    const H = innerHeight;
    const [bx, by, bz] = project(dummy.x, 1, dummy.z); // 몸통
    const bodyOn = bz < 1 && bx > 0 && bx < W && by > 50 && by < H;
    const [hx, hy] = project(dummy.x, 3.7, dummy.z); // 이름표보다 위
    if (bodyOn) {
      // 화면 안: 고리 + (자막과 안 겹치면) 머리 위 ▼
      arrow.hidden = true;
      mark.hidden = !(hy > TOP + 40);
      if (!mark.hidden) mark.style.transform = `translate(${hx.toFixed(1)}px, ${(hy - bounce).toFixed(1)}px) translate(-50%, -100%)`;
      return;
    }
    mark.hidden = true;
    arrow.hidden = false;
    // 화면 밖: 내 캐릭터에서 허수아비 쪽(원근 반영)으로 뻗은 선이 화면 가장자리와 만나는 곳
    const [px, py] = project(s.x, 0.9, s.z);
    const ux = (dummy.x - s.x) / dist;
    const uz = (dummy.z - s.z) / dist;
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
    const th = Math.atan2(dx, -dy); // 화면 위쪽 기준 시계 방향
    arrow.style.transform = `translate(${(px + dx * t).toFixed(1)}px, ${(py + dy * t).toFixed(1)}px) translate(-50%, -50%)`;
    arrow.querySelector('i').style.transform = `rotate(${th.toFixed(3)}rad)`;
  }

  update(dt) {
    if (this.i >= this.list.length) return;
    const s = this.ctx.state();
    if (this.last) {
      // 조이스틱으로 걸은 거리만 센다 (구르기·질주·순간이동은 빼고)
      const step = Math.hypot(s.x - this.last.x, s.z - this.last.z);
      const turn = Math.abs(wrapAngle(s.yaw - this.last.yaw));
      if (s.walking && step < 2) this.acc.moved += step; // 2m 넘게 한 번에 바뀌면 순간이동 (프레임이 느려도 걸음은 센다)
      if (turn < 0.6) this.acc.turned += turn;
    }
    this.last = { x: s.x, z: s.z, yaw: s.yaw };
    const st = this.list[this.i];
    const dummy = this.ctx.dummy;
    const max = dummy.stats?.maxHp || 68;
    const hits = dummy.alive ? Math.min(2, Math.round(((max - dummy.hp) / max) * 2)) : 2;
    const view = { ...this.acc, seen: s.seen, down: !dummy.alive, hits, level: s.level, xp: s.xp, next: s.next, ups: s.ups, skill: s.skill, flare: s.flare };
    if (st.target) this.drawTarget(s, dt);
    if (st.info) {
      const t = st.info(view);
      if (t !== this.infoText) this.ctx.$('tutorInfo').textContent = this.infoText = t;
    }
    // 통과하면 잠깐 초록으로 반짝이고 다음 단계로
    if (this.doneT > 0) {
      this.doneT -= dt;
      if (this.doneT <= 0) this.next();
      return;
    }
    if (st.done(view)) {
      this.doneT = 0.7;
      this.hideTarget();
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
