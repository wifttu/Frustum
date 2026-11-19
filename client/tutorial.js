// 연습(튜토리얼): 혼자 하기 판 위에서 단계별로 조작을 알려 준다. 허수아비는 가만히 서 있고, 경험치 보석은 직접 놓는다.
// main.js 가 ctx 로 지금 상태를 알려 준다 (게임 판정은 오프라인 Game 그대로).
import { isFree } from './shared/map.js';
import { segmentBlocked, wrapAngle } from './shared/vision.js';
import { ORBS, SKILLS } from './shared/progress.js';

export const TUTOR_REWARD = 100;

// 단계: text 안내, hi 반짝일 버튼, arrow 허수아비 쪽 화살표, done 통과 조건
function steps(skill) {
  return [
    { icon: '🕹️', text: '왼쪽 아래를 누른 채 끌어서 걸어 보세요', sub: 'PC: W A S D', hi: 'stickZone', done: (s) => s.moved > 4 },
    { icon: '👆', text: '오른쪽 화면을 좌우로 밀면 몸이 돌아가요', sub: 'PC: 마우스 끌기 또는 Q / E', done: (s) => s.turned > 2.4 },
    { icon: '🔦', text: '앞의 밝은 부채꼴이 내 시야예요. 시야 밖의 상대는 안 보여요', sub: '화살표 쪽의 허수아비를 시야에 넣어 보세요', arrow: true, done: (s) => s.seen },
    { icon: '💥', text: '허수아비를 빛 안에 넣고 손전등 버튼을 누르세요', sub: '두 번 맞히면 쓰러져요', hi: 'attack', arrow: true, done: (s) => s.down },
    { icon: '💎', text: '경험치 보석을 먹어 보세요', sub: '노랑 < 초록 < 보라, 큰 보석일수록 많이 줘요', orbs: true, done: (s) => s.level >= 2 },
    { icon: '🃏', text: '레벨업! 강화 카드 한 장을 고르세요', sub: '레벨이 오를 때마다 점점 강해져요', hi: 'choices', done: (s) => s.ups > 0 },
    { icon: '✨', text: `고유 스킬 "${SKILLS[skill]?.name || '구르기'}" 버튼을 눌러 보세요`, sub: '캐릭터마다 스킬이 달라요', hi: 'roll', done: (s) => s.skill },
    { icon: '🎆', text: '조명탄을 던지면 그곳이 잠깐 밝아져요', sub: '숨은 상대를 찾을 때 써 보세요', hi: 'flare', done: (s) => s.flare },
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
    this.ctx = ctx; // { $, state(): {...}, game, player, dummy, onFinish() }
    this.list = steps(ctx.skill);
    this.i = -1;
    this.acc = { moved: 0, turned: 0 };
    this.last = null;
    this.doneT = 0;
    this.next();
  }

  next() {
    const { $ } = this.ctx;
    this.clearHi();
    this.i++;
    if (this.i >= this.list.length) {
      $('tutor').hidden = true;
      $('tutorArrow').hidden = true;
      this.ctx.onFinish();
      return;
    }
    const st = this.list[this.i];
    $('tutorIcon').textContent = st.icon;
    $('tutorText').textContent = st.text;
    $('tutorSub').textContent = st.sub || '';
    $('tutorCount').textContent = `${this.i + 1} / ${this.list.length}`;
    $('tutor').hidden = false;
    $('tutor').classList.remove('pass');
    $('tutor').style.animation = 'none';
    void $('tutor').offsetWidth;
    $('tutor').style.animation = '';
    if (st.hi) $(st.hi)?.classList.add('tutorHi');
    if (st.orbs) this.placeOrbs();
    this.ctx.sfx?.choose?.();
  }

  clearHi() {
    for (const el of document.querySelectorAll('.tutorHi')) el.classList.remove('tutorHi');
  }

  // 플레이어 앞쪽에 작은·중간·큰 보석을 늘어놓는다
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
    put(2.6, -1.2, ORBS.small.v);
    put(3.2, 1.2, ORBS.small.v);
    put(4.4, 0, ORBS.medium.v);
    put(6.2, 0.6, ORBS.large.v);
  }

  update(dt) {
    if (this.i >= this.list.length) return;
    const s = this.ctx.state();
    if (this.last) {
      // 순간이동(처음 자리 잡기, 부활)은 걸은 것으로 치지 않는다
      const step = Math.hypot(s.x - this.last.x, s.z - this.last.z);
      const turn = Math.abs(wrapAngle(s.yaw - this.last.yaw));
      if (step < 0.8) this.acc.moved += step;
      if (turn < 0.6) this.acc.turned += turn;
    }
    this.last = { x: s.x, z: s.z, yaw: s.yaw };
    const st = this.list[this.i];
    const dummy = this.ctx.dummy;
    const view = { ...this.acc, seen: s.seen, down: !dummy.alive || s.killedDummy, level: s.level, ups: s.ups, skill: s.skill, flare: s.flare };
    // 허수아비 쪽 화살표 (화면 가장자리)
    const arrow = this.ctx.$('tutorArrow');
    const showArrow = st.arrow && dummy.alive && !s.seenNow;
    arrow.hidden = !showArrow;
    if (showArrow) {
      const rel = wrapAngle(Math.atan2(dummy.x - s.x, dummy.z - s.z) - s.yaw); // + 면 왼쪽
      const th = -rel;
      const R = Math.min(innerWidth, innerHeight) * 0.3;
      arrow.style.transform = `translate(${(innerWidth / 2 + Math.sin(th) * R).toFixed(0)}px, ${(innerHeight * 0.55 - Math.cos(th) * R).toFixed(0)}px) translate(-50%, -50%) rotate(${th.toFixed(3)}rad)`;
    }
    // 통과하면 잠깐 초록으로 반짝이고 다음 단계로
    if (this.doneT > 0) {
      this.doneT -= dt;
      if (this.doneT <= 0) this.next();
      return;
    }
    if (st.done(view)) {
      this.doneT = 0.7;
      this.ctx.$('tutor').classList.add('pass');
      this.ctx.sfx?.pickup?.();
    }
  }

  stop() {
    this.clearHi();
    this.i = this.list.length;
    this.ctx.$('tutor').hidden = true;
    this.ctx.$('tutorArrow').hidden = true;
  }
}
