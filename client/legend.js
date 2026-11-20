// 전설 의상 전용 효과: 손전등 빛 색 + 처치 이펙트. 의상은 로스터로 모두에게 알려지므로 모든 플레이어에게 보인다.
// kill(fx, x, z): fx 는 SkillFx (client/skillfx.js). 쓰러진 자리(x, z)에 그린다.
export const LEGEND = Object.freeze({
  // 우주 탐험가: 파란 우주 빛 · 로켓 불꽃이 솟는다
  explorer_astro: {
    beam: 0x6fd0ff,
    kill(fx, x, z) {
      fx.ring(x, z, { r1: 4.6, color: 0x6fd0ff, dur: 0.8 });
      fx.ring(x, z, { r1: 2.6, color: 0xffffff, dur: 0.5, delay: 0.08 });
      fx.sparks(x, z, { n: 26, color: 0x8fe0ff, spread: 0.3, rise: 5, out: 1.6, dur: 1.1, size: 1.2 });
      fx.sparks(x, z, { n: 14, color: 0xffa04a, spread: 0.3, rise: 2.6, out: 3.2, dur: 0.7 });
    },
  },
  // 천둥 신: 번개 빛 · 하늘에서 벼락이 내리친다
  runner_thunder: {
    beam: 0xffee66,
    kill(fx, x, z) {
      fx.bolt(x, z, 0xfff6b0);
      fx.ring(x, z, { r1: 4.2, color: 0xffe14a, dur: 0.6 });
      fx.sparks(x, z, { n: 30, color: 0xfff27a, spread: 0.4, y: 0.2, rise: 2, out: 4.5, dur: 0.6, size: 1.1 });
    },
  },
  // 기사 곰: 황금 빛 · 황금 방패가 터져 나간다
  bear_knight: {
    beam: 0xffd25a,
    kill(fx, x, z) {
      fx.ring(x, z, { r1: 3.6, color: 0xffd25a, dur: 0.6, a: 1 });
      fx.ring(x, z, { r1: 5, color: 0xfff4c0, dur: 0.8, delay: 0.12 });
      fx.sparks(x, z, { n: 24, color: 0xffd25a, spread: 0.5, rise: 3, out: 3, dur: 0.9, size: 1.2 });
      fx.sparks(x, z, { n: 10, color: 0xffffff, spread: 0.3, rise: 4, out: 1, dur: 0.6 });
    },
  },
  // 별빛 마법사: 보랏빛 · 별가루가 소용돌이치며 떠오른다
  owl_wizard: {
    beam: 0x9a6cff,
    kill(fx, x, z) {
      fx.ring(x, z, { r1: 3.8, color: 0xa98cff, dur: 0.9 });
      fx.sparks(x, z, { n: 22, color: 0xc8b0ff, spread: 1, rise: 2.6, out: 0.8, dur: 1.5, size: 1.1 });
      fx.sparks(x, z, { n: 14, color: 0xffe27a, spread: 1.2, y: 0.8, rise: 1.8, out: 1.2, dur: 1.6, size: 0.9 });
    },
  },
  // 등불 군주: 호박빛 · 반딧불 떼가 흩어진다
  collector_lord: {
    beam: 0xffb02e,
    kill(fx, x, z) {
      fx.ring(x, z, { r1: 3.4, color: 0xffb02e, dur: 0.8 });
      fx.sparks(x, z, { n: 34, color: 0xd8ff6a, spread: 0.8, y: 0.6, rise: 1.2, out: 1.8, dur: 1.9, size: 0.8 });
      fx.sparks(x, z, { n: 10, color: 0xffd25a, spread: 0.4, rise: 2.4, out: 1, dur: 1 });
    },
  },
  // 밤그림자: 보랏빛 그림자 빛 · 어둠 속으로 빨려 든다
  ninja_void: {
    beam: 0xb050ff,
    kill(fx, x, z) {
      fx.ring(x, z, { r0: 4.2, r1: 0.2, color: 0xc070ff, dur: 0.6, a: 1 });
      fx.smoke(x, z, { n: 14, color: 0x3a2a5a, spread: 1.1, dur: 1.1 });
      fx.sparks(x, z, { n: 18, color: 0xd08aff, spread: 0.3, y: 0.6, rise: 3.2, out: 0.6, dur: 1, size: 1 });
    },
  },
  // 숲의 현자: 초록 빛 · 꽃잎과 포자가 피어오른다
  healer_sage: {
    beam: 0x7dffa0,
    kill(fx, x, z) {
      fx.ring(x, z, { r1: 3.6, color: 0x7dffa0, dur: 0.9 });
      fx.sparks(x, z, { n: 22, color: 0x9dff8a, spread: 1, rise: 1.8, out: 1.4, dur: 1.5, size: 0.9 });
      fx.sparks(x, z, { n: 12, color: 0xff9ac8, spread: 0.8, rise: 1.4, out: 2, dur: 1.4, size: 1 });
      fx.smoke(x, z, { n: 6, color: 0xbfffc8, spread: 0.7, dur: 0.9 });
    },
  },
});
