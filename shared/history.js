// 최근 전적: 끝까지 한 판의 결과를 기기(프로필)에 최근 10판까지 남긴다. 화면과 분리된 순수 로직이라 테스트할 수 있다.
// 항목(짧은 키로 저장해 백업 코드가 길어지지 않게):
//   t 끝난 시각(ms), r 규칙, m 인원 구성, map 맵, w 결과(1 승리, 0 패배, -1 무승부), pl 순위, n 인원,
//   k 잡은 수, c 모닥불 점령 초, lv 레벨, ch 캐릭터, sk 의상, rp 랭크 점수 변화(기록 안 하면 null),
//   x 경험치, co 코인, on 온라인(1) / 혼자(0), ct 치트 모드(1)
import { RULES } from './config.js';
import { MAPS } from './map.js';
import { CHARACTERS } from './progress.js';

export const HISTORY_MAX = 10;

const int = (v, lo, hi, d = 0) => (Number.isFinite(v) ? Math.max(lo, Math.min(hi, Math.round(v))) : d);

function clean(e) {
  if (!e || typeof e !== 'object' || !Object.hasOwn(RULES, e.r)) return null;
  return {
    t: int(e.t, 0, 8.64e15),
    r: e.r,
    m: ['ffa', 'duo', 'squad'].includes(e.m) ? e.m : 'duo',
    map: Object.hasOwn(MAPS, e.map) ? e.map : '',
    w: e.w === 1 || e.w === -1 ? e.w : 0,
    pl: int(e.pl, 1, 99, 1),
    n: int(e.n, 1, 99, 1),
    k: int(e.k, 0, 999),
    c: int(e.c, 0, 9999),
    lv: int(e.lv, 1, 99, 1),
    ch: Object.hasOwn(CHARACTERS, e.ch) ? e.ch : 'explorer',
    sk: typeof e.sk === 'string' ? e.sk.slice(0, 32) : 'default',
    rp: Number.isFinite(e.rp) ? Math.round(e.rp) : null,
    x: int(e.x, 0, 1e7),
    co: int(e.co, 0, 1e7),
    on: e.on ? 1 : 0,
    ct: e.ct ? 1 : 0,
  };
}

// 저장된 값 정리 (오래된 순서가 섞여 있어도 최근 것부터 10개)
export function normalizeHistory(list) {
  return (Array.isArray(list) ? list : [])
    .map(clean)
    .filter(Boolean)
    .sort((a, b) => b.t - a.t)
    .slice(0, HISTORY_MAX);
}

// 한 판 추가 (맨 앞에, 최대 10개)
export function addHistory(p, entry) {
  const e = clean(entry);
  if (!e) return null;
  p.history = [e, ...normalizeHistory(p.history)].slice(0, HISTORY_MAX);
  return e;
}

// 요약: 판 수, 승리 수, 승률(%), 평균 순위, 잡은 수 합, 최고 순위
export function historySummary(list) {
  const n = list.length;
  if (!n) return { n: 0, wins: 0, rate: 0, avgPlace: 0, kills: 0, best: 0 };
  const wins = list.filter((e) => e.w === 1).length;
  return {
    n,
    wins,
    rate: Math.round((wins / n) * 100),
    avgPlace: Math.round((list.reduce((a, e) => a + e.pl, 0) / n) * 10) / 10,
    kills: list.reduce((a, e) => a + e.k, 0),
    best: Math.min(...list.map((e) => e.pl)),
  };
}

// "방금", "5분 전", "3시간 전", "2일 전"
export function agoText(t, now = Date.now()) {
  const s = Math.max(0, (now - t) / 1000);
  if (s < 60) return '방금';
  if (s < 3600) return `${Math.floor(s / 60)}분 전`;
  if (s < 86400) return `${Math.floor(s / 3600)}시간 전`;
  return `${Math.floor(s / 86400)}일 전`;
}
