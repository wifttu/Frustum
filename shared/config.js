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
  ATTACK_COOLDOWN: 4,
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

// 게임 규칙. 각 규칙은 개인전(ffa)과 2인 팀전(duo) 모두 지원한다.
export const RULES = Object.freeze({
  // 서바이벌: 부활 없음. 마지막 생존자/팀 승리. 시간 초과 시 생존자 수 → 킬 수.
  survival: { respawn: false, time: 120 },
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
