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
  showMinimap: true, // 미니맵 표시
  server: '', // 온라인 서버 주소 (비우면 기본값)
  showStats: false, // 성능 정보(fps 등) 표시
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
