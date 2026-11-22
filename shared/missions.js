// 일일 미션, 업적, 랭크(시즌 점수). 화면과 분리된 순수 로직이라 테스트할 수 있다.
// 기록은 기기(프로필)에 남는다. 치트 모드와 연습 중에는 클라이언트가 기록하지 않는다.

// ── 일일 미션: 날짜마다 정해진 3개 (모두에게 같은 미션) ──
export const DAILY_POOL = Object.freeze({
  kill5: { text: '상대 5명 잡기', ev: 'kill', goal: 5, coins: 120 },
  kill12: { text: '상대 12명 잡기', ev: 'kill', goal: 12, coins: 220 },
  big3: { text: '큰 보석(보라) 3개 먹기', ev: 'orbBig', goal: 3, coins: 100 },
  orb40: { text: '경험치 보석 40개 먹기', ev: 'orb', goal: 40, coins: 100 },
  lv10: { text: '한 판에서 레벨 10 찍기', ev: 'level', goal: 10, max: true, coins: 120 },
  lv15: { text: '한 판에서 레벨 15 찍기', ev: 'level', goal: 15, max: true, coins: 200 },
  skill8: { text: '고유 스킬 8번 쓰기', ev: 'skill', goal: 8, coins: 80 },
  round3: { text: '게임 3판 끝까지 하기', ev: 'round', goal: 3, coins: 120 },
  top1: { text: '한 판 1등 하기', ev: 'top', goal: 1, coins: 150 },
  win2: { text: '2번 이기기', ev: 'win', goal: 2, coins: 150 },
  flare5: { text: '조명탄 5번 던지기', ev: 'flare', goal: 5, coins: 70 },
  xp1500: { text: '경험치 1500 모으기', ev: 'xp', goal: 1500, coins: 120 },
});
const DAILY_KEYS = Object.keys(DAILY_POOL);
export const DAILY_COUNT = 3;

const hash = (s) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0;
  return h;
};
export const dayOf = (d = new Date()) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;

// 그날의 미션 3개 (같은 종류의 기록이 겹치지 않게)
export function dailyFor(day) {
  let h = hash(`daily:${day}`);
  const out = [];
  const used = new Set();
  for (let guard = 0; out.length < DAILY_COUNT && guard < 50; guard++) {
    h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0;
    const id = DAILY_KEYS[h % DAILY_KEYS.length];
    if (used.has(DAILY_POOL[id].ev)) continue;
    used.add(DAILY_POOL[id].ev);
    out.push(id);
  }
  return out;
}

// 날짜가 바뀌었으면 새 미션으로
export function ensureDaily(p, now = new Date()) {
  const day = dayOf(now);
  if (p.missions?.day === day && Array.isArray(p.missions.list)) return p.missions;
  p.missions = { day, list: dailyFor(day).map((id) => ({ id, n: 0, got: false })) };
  return p.missions;
}

// ── 업적: 단계마다 보상 (누적 기록) ──
// skins: 그 단계를 받으면 함께 주는 의상 (2단계 희귀, 4단계 영웅 — 업적마다 캐릭터 하나). 이미 가졌으면 대신 코인.
export const ACHIEVEMENTS = Object.freeze({
  kills: { name: '사냥꾼', icon: '🔦', stat: 'kills', tiers: [10, 50, 200, 1000], coins: [100, 250, 600, 1500], skins: { 2: 'ninja_fox', 4: 'ninja_samurai' }, text: (g) => `상대 ${g}명 잡기` },
  rounds: { name: '단골 캠퍼', icon: '🏕️', stat: 'rounds', tiers: [5, 25, 100, 400], coins: [80, 200, 500, 1200], skins: { 2: 'explorer_safari', 4: 'explorer_pirate' }, text: (g) => `${g}판 끝까지 하기` },
  wins: { name: '승리의 빛', icon: '🏆', stat: 'wins', tiers: [3, 20, 80, 300], coins: [100, 250, 600, 1500], skins: { 2: 'bear_panda', 4: 'bear_polar' }, text: (g) => `${g}번 이기기` },
  tops: { name: '왕관 수집가', icon: '👑', stat: 'tops', tiers: [1, 10, 50, 200], coins: [100, 300, 800, 2000], skins: { 2: 'runner_sprinter', 4: 'runner_racer' }, text: (g) => `1등 ${g}번 하기` },
  big: { name: '보석 사냥꾼', icon: '💎', stat: 'big', tiers: [10, 50, 200, 800], coins: [80, 200, 500, 1200], skins: { 2: 'collector_bee', 4: 'collector_fairy' }, text: (g) => `큰 보석 ${g}개 먹기` },
  level: { name: '왕귀', icon: '⭐', stat: 'maxLevel', tiers: [8, 12, 16, 20], coins: [100, 200, 400, 800], skins: { 2: 'owl_snow', 4: 'owl_detective' }, text: (g) => `한 판 최고 레벨 ${g}` },
  skills: { name: '스킬 장인', icon: '✨', stat: 'skills', tiers: [20, 100, 400, 1500], coins: [80, 200, 500, 1200], skins: { 2: 'healer_mushroom', 4: 'healer_flower' }, text: (g) => `고유 스킬 ${g}번 쓰기` },
});
export const ACH_SKIN_COINS = 200; // 보상 의상을 이미 가졌으면 대신 주는 코인
const STAT_OF = { kill: 'kills', round: 'rounds', win: 'wins', top: 'tops', orbBig: 'big', orb: 'orbs', skill: 'skills', flare: 'flares', xp: 'xp' };
export const STAT_KEYS = ['kills', 'rounds', 'wins', 'tops', 'big', 'orbs', 'skills', 'flares', 'xp', 'maxLevel'];

// 기록 하나: ev 종류, n 개 (level 은 그 판에서 찍은 레벨). 반환: 이번에 다 채운 일일 미션 목록
export function record(p, ev, n = 1, now = new Date()) {
  const m = ensureDaily(p, now);
  if (ev === 'level') p.stats.maxLevel = Math.max(p.stats.maxLevel, n);
  else if (STAT_OF[ev]) p.stats[STAT_OF[ev]] += n;
  const done = [];
  for (const it of m.list) {
    const d = DAILY_POOL[it.id];
    if (!d || d.ev !== ev || it.n >= d.goal) continue;
    it.n = d.max ? Math.max(it.n, Math.min(n, d.goal)) : Math.min(d.goal, it.n + n);
    if (it.n >= d.goal) done.push(d);
  }
  return done;
}
// 다 채운 일일 미션 보상 받기 → 코인 (못 받으면 0)
export function claimDaily(p, i, now = new Date()) {
  const it = ensureDaily(p, now).list[i];
  const d = it && DAILY_POOL[it.id];
  if (!d || it.got || it.n < d.goal) return 0;
  it.got = true;
  p.coins += d.coins;
  return d.coins;
}
// 업적: 지금 몇 단계까지 달성 / 받았나
export function achState(p, key) {
  const a = ACHIEVEMENTS[key];
  const v = p.stats[a.stat] || 0;
  const got = p.ach[key] || 0;
  const reached = a.tiers.filter((g) => v >= g).length;
  const next = Math.min(got, a.tiers.length - 1);
  return { a, v, got, reached, goal: a.tiers[next], coins: a.coins[next], skin: a.skins?.[next + 1] || null, claimable: reached > got, maxed: got >= a.tiers.length };
}
// 받은 코인 수를 돌려준다. 그 단계에 의상이 있으면 의상도 준다 (이미 가졌으면 대신 코인)
export function claimAch(p, key) {
  const s = achState(p, key);
  if (!s.claimable) return 0;
  p.ach[key] = s.got + 1;
  let coins = s.coins;
  if (s.skin && Array.isArray(p.skins)) {
    if (p.skins.includes(s.skin)) coins += ACH_SKIN_COINS;
    else p.skins.push(s.skin);
  }
  p.coins += coins;
  return coins;
}
// 받을 것이 있나 (로비 빨간 점)
export function hasClaimable(p, now = new Date()) {
  return missionClaimable(p, now) || rankClaimable(p);
}
// 미션 창(일일 미션·업적)에 받을 보상이 있나
export function missionClaimable(p, now = new Date()) {
  const m = ensureDaily(p, now);
  if (m.list.some((it) => !it.got && it.n >= (DAILY_POOL[it.id]?.goal ?? Infinity))) return true;
  return Object.keys(ACHIEVEMENTS).some((k) => achState(p, k).claimable);
}
// 랭크 창에 받을 시즌 의상이 있나
export const rankClaimable = (p) => rankSkinList(p).some((r) => r.claimable);

// ── 랭크: 판이 끝날 때의 순위로 점수가 오르내린다. 시즌은 한 달 ──
export const RANKS = Object.freeze([
  { name: '브론즈', min: 0, color: '#c0875a', reward: 100 },
  { name: '실버', min: 200, color: '#c8d2dc', reward: 200 },
  { name: '골드', min: 500, color: '#ffd25a', reward: 350 },
  { name: '플래티넘', min: 900, color: '#6fe0d0', reward: 550 },
  { name: '다이아', min: 1400, color: '#8ab8ff', reward: 800 },
  { name: '마스터', min: 2000, color: '#ff8af0', reward: 1200 },
]);
export const seasonOf = (d = new Date()) => `${d.getFullYear()}-${d.getMonth() + 1}`;
// 시즌 의상 보상: 이번 시즌 최고 점수로 골드·플래티넘·다이아에 처음 닿으면 희귀·영웅·전설 의상 하나씩 (시즌마다 다시)
// 어떤 의상을 줄지는 shared/shop.js 의 claimRankSkin 이 고른다 (지금 캐릭터 → 가진 캐릭터 → 아무나)
export const RANK_SKINS = Object.freeze({ 2: 'rare', 3: 'epic', 4: 'legend' });
export function rankSkinList(p) {
  return Object.entries(RANK_SKINS).map(([i, tier]) => {
    const r = RANKS[i];
    const reached = p.rank.best >= r.min;
    const got = p.rank.got.includes(+i);
    return { i: +i, tier, rank: r, reached, got, claimable: reached && !got };
  });
}
export function rankOf(rp) {
  let i = 0;
  while (i + 1 < RANKS.length && rp >= RANKS[i + 1].min) i++;
  const next = RANKS[i + 1];
  return { i, ...RANKS[i], next: next ? next.min : null, prog: next ? (rp - RANKS[i].min) / (next.min - RANKS[i].min) : 1 };
}
// 순위 점수: 1등 +30 … 꼴등 -9 (인원에 맞춰 늘이고 줄인다) + 잡은 수 x2. 봇전은 절반.
const PLACE = [30, 20, 12, 6, 0, -3, -6, -9];
export function rankDelta(place, players, kills, online) {
  if (players < 2) return 0;
  const k = Math.round(((place - 1) / (players - 1)) * (PLACE.length - 1));
  const d = PLACE[k] + Math.min(10, kills) * 2;
  return Math.round(online ? d : d / 2);
}
// 시즌이 바뀌었으면 지난 시즌 등급 보상을 주고 점수를 절반으로. 반환: 보상 {coins, rank} 또는 null
export function seasonRollover(p, now = new Date()) {
  const cur = seasonOf(now);
  if (p.rank.season === cur) return null;
  const first = !p.rank.season;
  const r = rankOf(p.rank.rp);
  p.rank = { season: cur, rp: Math.floor(p.rank.rp / 2), best: 0, got: [] };
  if (first) return null;
  p.coins += r.reward;
  return { coins: r.reward, rank: r.name };
}
export function applyRank(p, delta, now = new Date()) {
  seasonRollover(p, now);
  const before = rankOf(p.rank.rp);
  p.rank.rp = Math.max(0, p.rank.rp + delta);
  p.rank.best = Math.max(p.rank.best, p.rank.rp);
  const after = rankOf(p.rank.rp);
  return { delta, rp: p.rank.rp, before, after, up: after.i > before.i, down: after.i < before.i };
}
// 남은 시즌 일수
export function seasonDaysLeft(now = new Date()) {
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  return Math.max(1, Math.ceil((end - now) / 86400000));
}

// 저장된 값 정리 (normalizeProfile 에서 부른다)
export function normalizeProgress(p) {
  const st = p.stats && typeof p.stats === 'object' ? p.stats : {};
  p.stats = Object.fromEntries(STAT_KEYS.map((k) => [k, Number.isFinite(st[k]) && st[k] > 0 ? Math.floor(st[k]) : 0]));
  const ach = p.ach && typeof p.ach === 'object' ? p.ach : {};
  p.ach = Object.fromEntries(Object.entries(ACHIEVEMENTS).map(([k, a]) => [k, Math.max(0, Math.min(a.tiers.length, Math.floor(ach[k] || 0)))]));
  const r = p.rank && typeof p.rank === 'object' ? p.rank : {};
  p.rank = {
    season: typeof r.season === 'string' ? r.season : '',
    rp: Number.isFinite(r.rp) ? Math.max(0, Math.floor(r.rp)) : 0,
    best: Number.isFinite(r.best) ? Math.max(0, Math.floor(r.best)) : 0,
    got: Array.isArray(r.got) ? [...new Set(r.got.filter((i) => Object.hasOwn(RANK_SKINS, i)).map(Number))] : [], // 이번 시즌에 받은 의상 보상
  };
  const m = p.missions;
  if (!m || typeof m.day !== 'string' || !Array.isArray(m.list)) p.missions = null;
  else p.missions = { day: m.day, list: m.list.filter((it) => it && Object.hasOwn(DAILY_POOL, it.id)).slice(0, DAILY_COUNT).map((it) => ({ id: it.id, n: Math.max(0, Math.floor(it.n) || 0), got: !!it.got })) };
  return p;
}
