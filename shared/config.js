// 서버와 클라이언트가 함께 쓰는 게임 상수.
// 시야 판정(서버)과 시야 마스크(클라이언트)가 같은 값을 써야 화면과 판정이 일치한다.
const DEG = Math.PI / 180;

export const CFG = Object.freeze({
  TICK_RATE: 30, // 서버 시뮬레이션 / 클라이언트 입력 주기 (Hz)
  SNAPSHOT_EVERY: 2, // N틱마다 스냅샷 전송 (30/2 = 15Hz)

  PLAYER_RADIUS: 0.45,
  PLAYER_SPEED: 5.5, // m/s
  TURN_RATE: 8, // rad/s. 서버가 회전 속도를 제한해 "순간 360도 스캔" 치트를 막는다.

  FOV: 90 * DEG, // 수평 시야각
  VIEW_RANGE: 20, // 시야 거리 (far plane)
  NEAR_RADIUS: 1.6, // 몸 주변 근접 감지 반경 (자기 캐릭터가 보이도록)
  VIS_MARGIN: 0.3, // 서버 판정 여유값: 시야 경계에서 갑자기 튀어나오는 현상 완화

  // 손전등 빔 공격: 좁고 긴 원뿔. 벽에 막힌다.
  ATTACK_RANGE: 6,
  ATTACK_ARC: 40 * DEG,
  ATTACK_COOLDOWN: 1.5, // 기본값. 체력제라 한 번에 쓰러지지 않으므로 4초에서 줄였다 (강화로 더 줄어든다)
  BEAM_TIME: 0.25, // 빔이 화면에 보이는 시간

  // 구르기: 짧은 순간이동 + 무적
  ROLL_TIME: 0.3,
  ROLL_SPEED: 15, // m/s → 약 4.5m 이동
  ROLL_COOLDOWN: 3,

  // 조명탄: 던진 지점 주변을 팀 시야로 밝힌다
  FLARE_THROW: 8, // 최대 투척 거리
  FLARE_RADIUS: 7, // 밝히는 반경
  FLARE_TIME: 4,
  FLARE_COOLDOWN: 12,

  // 생존전: 부활 없음. 마지막까지 살아남은 사람/팀이 라운드 승리.
  ROUND_TIME: 120, // 기본값. 실제 값은 아래 RULES 의 time 을 쓴다
  RESPAWN_TIME: 3, // 데스매치 부활 대기
  INTERMISSION: 6, // 라운드 종료 후 다음 라운드까지
  START_GRACE: 3, // 라운드 시작 직후 공격 금지 시간
  JOIN_GRACE: 10, // 라운드 시작 후 이 시간 안에 들어오면 바로 참가

  // 모드: 'ffa' = 8인 개인전(시야 공유 없음), 'duo' = 2인 1팀 × 4팀(팀원과 시야 공유)
  TEAMS: 4, // duo 모드의 팀 수. ffa 모드에서는 0으로 덮어쓴다
  MAX_PLAYERS: 8,
  BOT_FILL: 8, // 접속 인원이 이보다 적으면 봇으로 채운다
});

// 아이템: 맵 곳곳에 생기고, 밟으면 줍는다. 시야 안에 있을 때만 보인다.
export const ITEMS = Object.freeze({
  heart: { name: '하트', desc: '체력 +40', heal: 40 },
  battery: { name: '배터리', desc: '손전등·조명탄 즉시 충전' },
  sneakers: { name: '운동화', desc: '6초 동안 빨라짐', time: 6, speed: 1.4 },
  vest: { name: '반사 조끼', desc: '빛을 한 번 막아 줌', time: 20 },
  cloak: { name: '그림자 망토', desc: '6초 동안 상대에게 안 보임', time: 6 },
});
export const ITEM_TYPES = Object.keys(ITEMS);
export const ITEM_RULES = Object.freeze({
  MAX: 8, // 맵 위 최대 개수
  EVERY: 5, // 새로 생기는 간격(초)
  START: 3, // 라운드 시작 때 개수
  PICK_RADIUS: 1.1,
  CLOAK_NEAR: 2.2, // 망토를 써도 이 거리 안에서는 보인다
});

// 독구름(서바이벌 전용): 맵 가장자리에서 안쪽으로 조여 오는 정사각형 안전 구역.
export const ZONE = Object.freeze({
  WAIT: 15, // 라운드 시작 후 조여 오기 시작할 때까지
  END: 100, // 이 시점에 최소 크기에 도달
  MIN_HALF: 7, // 최종 안전 구역의 절반 길이 (중앙 14m × 14m)
  GAS_TIME: 3, // 독구름 안에서 버틸 수 있는 시간
  RECOVER: 0.5, // 안전 구역에서 초당 회복량
});
const MAP_HALF = 32; // shared/map.js 의 MAP_SIZE / 2
// 라운드 경과 시간 t 에서 안전 구역의 절반 길이
export function zoneHalf(t) {
  const k = Math.max(0, Math.min(1, (t - ZONE.WAIT) / (ZONE.END - ZONE.WAIT)));
  return MAP_HALF + (ZONE.MIN_HALF - MAP_HALF) * k;
}

// 게임 규칙. 각 규칙은 개인전(ffa)과 2인 팀전(duo) 모두 지원한다.
export const RULES = Object.freeze({
  // 서바이벌: 부활 없음. 마지막 생존자/팀 승리. 시간 초과 시 생존자 수 → 킬 수.
  survival: { respawn: false, time: 120, zone: true },
  // 데스매치: 부활 있음. 제한 시간 동안 킬이 가장 많은 사람/팀 승리.
  dm: { respawn: true, time: 180 },
  // 점수제 데스매치: 부활 있음. 목표 킬을 먼저 채우면 승리. 시간 초과 시 킬 수.
  score: { respawn: true, time: 300, target: { ffa: 10, duo: 15 } },
});

// 조명탄을 시야원으로 쓸 때의 설정: 360도, 반경 FLARE_RADIUS
export const FLARE_VIEW = Object.freeze({
  ...CFG,
  FOV: Math.PI * 2,
  VIEW_RANGE: CFG.FLARE_RADIUS,
  NEAR_RADIUS: 1,
});

// '매의 눈' 스킬의 시야: 360도, 반경 15m (벽은 여전히 가린다)
export const SCAN_VIEW = Object.freeze({ ...CFG, FOV: Math.PI * 2, VIEW_RANGE: 15, NEAR_RADIUS: 1 });
