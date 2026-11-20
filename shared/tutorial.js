// 연습(튜토리얼) 고정 배치 (캠핑장). 클라이언트 tutorial.js 가 쓰고, test/tutorial.test.js 가 조건을 확인한다.
//   start: 북쪽(+z)을 보고 시작. 여기서는 허수아비가 벽에 가려 안 보인다 → 화살표를 따라 걸어가 찾는다.
//   guard: 경비 허수아비. 근처에 숨을 벽이 있다.
//   pad/padYaw: 조명탄을 던질 노란 발판과 바라볼 방향.
//   hidden: 숨은 허수아비. 발판·경비·첫 허수아비 자리에서는 벽에 가려 안 보이고, 발판에서 던진 조명탄 빛에만 보인다.
export const TUTORIAL_LAYOUT = Object.freeze({
  map: 'camp',
  start: [-3, -28],
  dummy: [12, -19],
  guard: [19, -19],
  pad: [19, -13],
  padYaw: Math.PI / 4,
  hidden: [20, -5],
});
