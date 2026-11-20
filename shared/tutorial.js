// 연습(튜토리얼) 고정 배치: 훈련장(30m x 30m). 클라이언트 tutorial.js 가 쓰고, test/tutorial.test.js 가 조건을 확인한다.
//   start: 남쪽 마당에서 북쪽(+z)을 보고 시작. 나무 가림막 때문에 허수아비가 안 보인다 → 화살표를 따라 걸어가 찾는다.
//   dummy: 서쪽 허수아비.   guard: 동쪽 경비 허수아비 (가운데 상자·건초 더미 뒤로 숨을 수 있다).
//   pad/padYaw: 조명탄을 던질 노란 발판과 바라볼 방향(북북서).
//   hidden: 북쪽 돌담 뒤 숨은 허수아비. 시작·발판·경비·첫 허수아비 자리에서는 안 보이고, 발판에서 던진 조명탄 빛에만 보인다.
export const TUTORIAL_LAYOUT = Object.freeze({
  map: 'training',
  start: [0, -12],
  dummy: [-10, -1],
  guard: [9, 2],
  pad: [10, 7],
  padYaw: (Math.PI * 15) / 8,
  hidden: [2, 13],
});
