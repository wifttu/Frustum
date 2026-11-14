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
  ATTACK_RANGE: 7,
  ATTACK_ARC: 40 * DEG,
  ATTACK_COOLDOWN: 0.8,
  BEAM_TIME: 0.25, // 빔이 화면에 보이는 시간
  RESPAWN_TIME: 3,

  // 구르기: 짧은 순간이동 + 무적
  ROLL_TIME: 0.3,
  ROLL_SPEED: 15, // m/s → 약 4.5m 이동
  ROLL_COOLDOWN: 3,

  // 조명탄: 던진 지점 주변을 팀 시야로 밝힌다
  FLARE_THROW: 8, // 최대 투척 거리
  FLARE_RADIUS: 7, // 밝히는 반경
  FLARE_TIME: 6,
  FLARE_COOLDOWN: 12,

  TARGET_SCORE: 20, // 팀전 승리 킬 수 (개인전은 절반)
  INTERMISSION: 6, // 라운드 종료 후 다음 라운드까지

  TEAMS: 2, // 0이면 개인전(시야 공유 없음), 2 이상이면 팀원끼리 시야 공유
  MAX_PLAYERS: 12,
  BOT_FILL: 6, // 접속 인원이 이보다 적으면 봇으로 채운다
});

// 조명탄을 시야원으로 쓸 때의 설정: 360도, 반경 FLARE_RADIUS
export const FLARE_VIEW = Object.freeze({
  ...CFG,
  FOV: Math.PI * 2,
  VIEW_RANGE: CFG.FLARE_RADIUS,
  NEAR_RADIUS: 1,
});
