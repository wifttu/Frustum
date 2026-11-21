// 사용자 설정 (기기에 저장)
const KEY = 'frustum.prefs';
const defaults = {
  fixedStick: false, // 조이스틱을 화면 한쪽에 고정
  lefty: false, // 왼손 모드: 조이스틱과 버튼 좌우 반전
  sens: 1, // 회전 감도 배율
  zoom: 1, // 카메라 거리 배율 (작을수록 가까이)
  volume: 0.8, // 효과음 크기 0..1
  vibrate: true, // 처치/사망 시 진동
  fullscreen: true, // 터치하면 전체 화면으로 (주소창·네비게이션 바 숨김)
  music: true, // 로비 배경음악
  musicGame: true, // 게임 중 배경음악
  showMinimap: true, // 미니맵 표시
  server: '', // 온라인 서버 주소 (비우면 기본값)
  showStats: false, // 성능 정보(fps 등) 표시
  quality: 'auto', // 그래픽 품질: auto(성능에 맞춰 자동) / low / mid / high
  lang: 'auto', // 언어: auto(기기 언어) / ko / en
  backupAt: 0, // 마지막으로 백업 코드를 만든 때
  tutorSeen: false, // 연습 안내를 이미 봤다(닫았다)
  // 치트 모드: 전체 스위치 + 항목별 스위치. 게임 안 치트는 혼자(AI 상대)일 때만 켜진다.
  cheat: false,
  cheatCoins: true, // 코인 무한
  cheatGod: true, // 무적
  cheatXp: true, // 경험치 5배
  cheatCd: true, // 쿨타임 1/4
  cheatSpeed: false, // 이동 +30%
  realCoins: null, // 코인 무한을 켜기 전의 코인 (끄면 되돌린다)
};
let saved = {};
try {
  saved = JSON.parse(localStorage.getItem(KEY)) || {};
} catch {}
export const prefs = { ...defaults, ...saved };
export function savePrefs() {
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {}
}
