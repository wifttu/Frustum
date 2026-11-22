// 상점 규칙: 스킨, 뽑기(등급·확률·천장), 출석 보상.
// 화면과 분리된 순수 로직이라 테스트할 수 있다. 재화: 게임으로 버는 코인(🪙), 진짜 돈으로 사는 크리스탈(💎, client/pay.js — 아직 결제 연결 전).
import { CHARACTERS, CHAR_UP, clvOf } from './progress.js';
import { RANK_SKINS, normalizeProgress, rankSkinList } from './missions.js';
import { normalizeHistory } from './history.js';

// 스킨(의상): 캐릭터마다 따로 있다 (char). 캐릭터의 특징에 맞춘 모자·소품이 붙고, 모자·소품은 모든 플레이어에게 보인다.
// color 는 내 화면에서의 후드/망토 색이다(다른 사람에게는 아군 파랑, 적 빨강으로 보인다).
// fx: 전설 의상 전용 효과 (손전등 빛 색과 처치 이펙트, client/legend.js). 모든 플레이어에게 보인다.
export const SKINS = Object.freeze({
  default: { name: '기본', desc: '캐릭터 본래 모습', color: null, tier: 'common', char: null },
  // 탐험가: 어디든 가는 모험가
  explorer_safari: { char: 'explorer', name: '사파리 탐험가', desc: '챙 넓은 탐험 모자와 목에 건 쌍안경', color: 0xc8a868, tier: 'rare' },
  explorer_pirate: { char: 'explorer', name: '해적 선장', desc: '삼각 모자, 안대, 금화 목걸이', color: 0xa8322e, tier: 'epic' },
  explorer_astro: { char: 'explorer', name: '우주 탐험가', desc: '우주 헬멧과 안테나, 분사구 달린 산소통', color: 0x39407e, tier: 'legend', fx: '파란 우주 빛 · 처치하면 로켓 불꽃' },
  // 번개: 빠른 달리기
  runner_sprinter: { char: 'runner', name: '스프린터', desc: '땀받이 머리띠, 등번호 7, 형광 운동화', color: 0x2f7fd8, tier: 'rare' },
  runner_racer: { char: 'runner', name: '레이서', desc: '줄무늬 레이싱 헬멧과 등에 꽂은 체크무늬 깃발', color: 0xe03a2a, tier: 'epic' },
  runner_thunder: { char: 'runner', name: '천둥 신', desc: '빛나는 번개 왕관, 먹구름 깃, 번개 문장', color: 0x5a3ab8, tier: 'legend', fx: '번개 빛 · 처치하면 하늘에서 벼락' },
  // 곰돌이: 튼튼한 몸, 방패
  bear_panda: { char: 'bear', name: '판다', desc: '판다 털모자와 등에 멘 대나무', color: 0xf2f2ee, tier: 'rare' },
  bear_polar: { char: 'bear', name: '북극곰', desc: '북극곰 털모자, 털목도리, 눈꽃 배지', color: 0xdfeeff, tier: 'epic' },
  bear_knight: { char: 'bear', name: '기사 곰', desc: '깃털 투구, 어깨 갑옷, 방패 문장', color: 0x3a5fb0, tier: 'legend', fx: '황금 빛 · 처치하면 황금 방패 폭발' },
  // 올빼미: 멀리 보는 눈
  owl_snow: { char: 'owl', name: '흰올빼미', desc: '하얀 깃털과 호박색으로 빛나는 금테 고글', color: 0xf4f2ea, tier: 'rare' },
  owl_detective: { char: 'owl', name: '탐정 올빼미', desc: '사냥 모자, 외알 안경, 나비넥타이, 돋보기', color: 0x8a6a40, tier: 'epic' },
  owl_wizard: { char: 'owl', name: '별빛 마법사', desc: '별이 빛나는 뾰족 모자와 별 지팡이', color: 0x2a2f7a, tier: 'legend', fx: '보랏빛 · 처치하면 별가루 소용돌이' },
  // 반디: 반딧불을 모으는 등불
  collector_bee: { char: 'collector', name: '꿀벌', desc: '줄무늬 망토, 빛나는 더듬이, 반짝이는 날개', color: 0xf2c230, tier: 'rare' },
  collector_fairy: { char: 'collector', name: '반딧불 요정', desc: '빛나는 네 날개, 꽃 화관, 머리 위 등불', color: 0x7fe0c0, tier: 'epic' },
  collector_lord: { char: 'collector', name: '등불 군주', desc: '반딧불 보석 왕관, 담비털 깃, 등불 지팡이', color: 0xa8283a, tier: 'legend', fx: '호박빛 · 처치하면 반딧불 떼' },
  // 그림자: 숨어서 노린다
  ninja_fox: { char: 'ninja', name: '여우 가면', desc: '여우 귀, 옆머리 여우 가면, 날리는 목도리', color: 0xe8e2d6, tier: 'rare' },
  ninja_samurai: { char: 'ninja', name: '사무라이', desc: '초승달 투구, 어깨 갑옷, 등에 멘 칼', color: 0xb8302a, tier: 'epic' },
  ninja_void: { char: 'ninja', name: '밤그림자', desc: '보랏빛 눈, 긴 두건, 떠다니는 그림자', color: 0x2a1f44, tier: 'legend', fx: '그림자 빛 · 처치하면 어둠 속으로 빨려 듦' },
  // 약초꾼: 치유
  healer_mushroom: { char: 'healer', name: '버섯 약사', desc: '물방울무늬 버섯 모자와 물약 두 병', color: 0x9a6a4a, tier: 'rare' },
  healer_flower: { char: 'healer', name: '꽃 요정', desc: '새싹이 피운 꽃, 꽃 화관, 가슴 꽃', color: 0xff8ab8, tier: 'epic' },
  healer_sage: { char: 'healer', name: '숲의 현자', desc: '잎사귀 사슴뿔, 잎 망토, 빛나는 지팡이', color: 0x2f8a4a, tier: 'legend', fx: '초록 빛 · 처치하면 꽃잎과 포자' },
});
export const SKIN_KEYS = Object.keys(SKINS);
export const skinOf = (id) => (Object.hasOwn(SKINS, id) ? id : 'default');
// 그 캐릭터의 의상들 (기본 제외)
export const skinsOf = (char) => SKIN_KEYS.filter((k) => SKINS[k].char === char);
// 이 캐릭터가 입을 수 있는 의상인가 (기본은 누구나)
export const skinFits = (skin, char) => skin === 'default' || SKINS[skin]?.char === char;
// 캐릭터에 맞지 않는 의상이면 기본으로
export const skinFor = (char, skin) => (skinFits(skinOf(skin), char) ? skinOf(skin) : 'default');
// 예전(모든 캐릭터 공용) 의상 → 같은 등급의 새 의상으로 바꿔 준다
const LEGACY_SKINS = { strawberry: 'rare', lime: 'rare', pumpkin: 'rare', snow: 'epic', night: 'epic', gold: 'legend' };
const LEGACY_ICONS = { strawberry: '🍓', lime: '🐸', pumpkin: '🎃', snow: '⛄', night: '🚀', gold: '👑' };

// 프로필 아이콘: 기본 제공 + 가진 캐릭터의 아이콘 + 가진 의상의 아이콘
export const FREE_ICONS = Object.freeze(['🔦', '🏕️', '🌲', '🔥', '🌙', '⭐', '🦊', '🐱', '🐶', '🐼', '🐰', '🦔']);
// 의상 아이콘은 's:의상ID' (그림은 그 의상을 입은 초상화)
export const SKIN_ICONS = Object.freeze(Object.fromEntries(SKIN_KEYS.filter((k) => k !== 'default').map((k) => [k, `s:${k}`])));
// [{ icon, locked, how }] — locked 이면 how 에 얻는 방법
export function iconsFor(profile) {
  const out = FREE_ICONS.map((icon) => ({ icon, locked: false, how: '' }));
  for (const [id, c] of Object.entries(CHARACTERS)) out.push({ icon: c.icon, locked: !profile.owned.includes(id), how: `${c.name} 캐릭터를 얻으면 열려요` });
  for (const [id, icon] of Object.entries(SKIN_ICONS)) out.push({ icon, locked: !profile.skins.includes(id), how: `${CHARACTERS[SKINS[id].char].name}의 ${SKINS[id].name} 의상을 얻으면 열려요` });
  return out;
}

export const TIERS = Object.freeze({
  common: { name: '일반', p: 0.6, color: '#9fb2c4' },
  rare: { name: '희귀', p: 0.28, color: '#5ab4ff' },
  epic: { name: '영웅', p: 0.1, color: '#c58bff' },
  legend: { name: '전설', p: 0.02, color: '#ffd25a' },
});
const ORDER = ['common', 'rare', 'epic', 'legend'];

export const GACHA = Object.freeze({
  COST: 100,
  COST10: 900, // 10회 묶음 (1회 무료)
  PITY: 10, // 이 횟수 안에 영웅 이상이 한 번은 나온다
  DUP: { rare: 90, epic: 200, legend: 500 }, // 더 받을 것이 없을 때 돌려주는 코인
});
export const DAILY = Object.freeze({ BASE: 60, PER_STREAK: 15, MAX_STREAK: 7 });

// 캐릭터의 등급: 가격 기준
export const charTier = (id) => (CHARACTERS[id].price > 450 ? 'legend' : 'epic');

export function newProfile() {
  return normalizeProgress({ xp: 0, coins: 0, owned: ['explorer'], char: 'explorer', skins: ['default'], skin: 'default', pity: 0, daily: '', streak: 0, friends: [], recent: [], icon: '', fc: '', tutorial: 0, skinBy: {}, history: [], gems: 0, bg: '', bgs: [], clv: {} });
}

// 저장된 값을 안전하게 정리한다 (오래된 저장 데이터, 손상된 값 대비)
export function normalizeProfile(raw) {
  const p = { ...newProfile(), ...(raw && typeof raw === 'object' ? raw : {}) };
  p.coins = Number.isFinite(p.coins) ? Math.max(0, p.coins) : 0;
  p.xp = Number.isFinite(p.xp) ? Math.max(0, p.xp) : 0;
  p.owned = [...new Set(['explorer', ...(Array.isArray(p.owned) ? p.owned : [])])].filter((id) => Object.hasOwn(CHARACTERS, id));
  const rawSkins = Array.isArray(p.skins) ? p.skins : [];
  p.skins = [...new Set(['default', ...rawSkins])].filter((id) => Object.hasOwn(SKINS, id));
  if (!p.owned.includes(p.char)) p.char = 'explorer';
  // 예전 공용 의상: 같은 등급의 새 의상(지금 캐릭터 → 가진 캐릭터 → 아무나 순)으로 바꾸고, 없으면 코인으로
  const legacy = rawSkins.filter((id) => Object.hasOwn(LEGACY_SKINS, id));
  let wear = null; // 입고 있던 예전 의상을 바꾼 새 의상 (그대로 입혀 준다)
  if (legacy.length) {
    for (const old of legacy) {
      const pick = pickSkin(p, LEGACY_SKINS[old]);
      if (pick) {
        p.skins.push(pick);
        if (p.icon === LEGACY_ICONS[old]) p.icon = SKIN_ICONS[pick]; // 예전 의상 아이콘을 쓰고 있었으면 새 의상 아이콘으로
        if (p.skin === old) wear = pick;
      } else p.coins += GACHA.DUP[LEGACY_SKINS[old]];
    }
    p.legacyNote = `예전 의상 ${legacy.length}개를 캐릭터별 새 의상으로 바꿔 드렸어요`;
  }
  // 캐릭터마다 입은 의상 (예전 형식의 skin 하나도 받는다)
  const sb = p.skinBy && typeof p.skinBy === 'object' ? p.skinBy : {};
  p.skinBy = {};
  for (const c of Object.keys(CHARACTERS)) if (p.skins.includes(sb[c]) && skinFits(sb[c], c) && sb[c] !== 'default') p.skinBy[c] = sb[c];
  if (p.skin && p.skin !== 'default' && p.skins.includes(p.skin) && skinFits(p.skin, p.char)) p.skinBy[p.char] ||= p.skin;
  if (wear) p.skinBy[SKINS[wear].char] ||= wear;
  p.skin = p.skinBy[p.char] || 'default';
  p.pity = Number.isInteger(p.pity) ? p.pity : 0;
  p.streak = Number.isInteger(p.streak) ? p.streak : 0;
  p.tutorial = p.tutorial ? 1 : 0; // 연습을 끝냈나 (보상은 한 번만)
  p.history = normalizeHistory(p.history); // 최근 전적 10판
  // 상점: 크리스탈, 프로필 배경, 캐릭터 강화 단계
  p.gems = Number.isFinite(p.gems) ? Math.max(0, Math.floor(p.gems)) : 0;
  p.bgs = [...new Set(Array.isArray(p.bgs) ? p.bgs : [])].filter((id) => PROFILE_BGS[id]?.gems > 0);
  if (!canUseBg(p, p.bg)) p.bg = '';
  const cl = p.clv && typeof p.clv === 'object' ? p.clv : {};
  p.clv = {};
  for (const id of p.owned) if (clvOf(cl[id]) > 0) p.clv[id] = clvOf(cl[id]);
  // 친구/최근 함께한 플레이어: 이름 목록 (계정이 없어 기기에만 저장)
  // { name, fc } 목록. 예전 저장 형식(이름 문자열)도 받는다. 친구 코드가 같으면 하나로 합친다.
  const people = (v, max) => {
    const out = [];
    const seen = new Set();
    for (const x of Array.isArray(v) ? v : []) {
      const item = typeof x === 'string' ? { name: x, fc: '' } : x && typeof x === 'object' ? x : null;
      if (!item || typeof item.name !== 'string' || !item.name) continue;
      const fc = typeof item.fc === 'string' && /^[A-Z0-9]{6}$/.test(item.fc) ? item.fc : '';
      const key = fc || `name:${item.name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ name: item.name.slice(0, 12), fc });
    }
    return out.slice(0, max);
  };
  p.friends = people(p.friends, 40);
  p.recent = people(p.recent, 12);
  // 내 친구 코드: 비어 있으면 클라이언트가 처음 실행할 때 만든다
  p.fc = typeof p.fc === 'string' && /^[A-Z0-9]{6}$/.test(p.fc) ? p.fc : '';
  // 아이콘: 지금 쓸 수 있는 것만 인정한다 ('' = 고른 캐릭터의 아이콘)
  if (!iconsFor(p).some((x) => !x.locked && x.icon === p.icon)) p.icon = '';
  return normalizeProgress(p); // 미션·업적·랭크
}

function pickTier(rnd) {
  let r = rnd();
  for (const id of ORDER) {
    r -= TIERS[id].p;
    if (r < 0) return id;
  }
  return 'common';
}

// 뽑기 한 번의 결과를 정하고 profile 에 반영한다 (코인 차감은 호출하는 쪽에서).
// 반환: { tier, kind: 'coins' | 'skin' | 'char', id?, coins?, dup? }
export function rollOnce(profile, rnd = Math.random) {
  let tier = pickTier(rnd);
  profile.pity++;
  if (profile.pity >= GACHA.PITY && ORDER.indexOf(tier) < 2) tier = 'epic'; // 천장
  if (ORDER.indexOf(tier) >= 2) profile.pity = 0;

  if (tier === 'common') {
    const coins = 30 + Math.floor(rnd() * 41);
    profile.coins += coins;
    return { tier, kind: 'coins', coins };
  }
  // 아직 없는 것 중에서 고른다
  const pool = [];
  // 가진 캐릭터의 의상이 세 배 잘 나온다
  for (const [id, s] of Object.entries(SKINS)) {
    if (s.tier !== tier || profile.skins.includes(id)) continue;
    for (let k = profile.owned.includes(s.char) ? 3 : 1; k > 0; k--) pool.push(['skin', id]);
  }
  if (tier !== 'rare') {
    for (const id of Object.keys(CHARACTERS)) if (CHARACTERS[id].price > 0 && charTier(id) === tier && !profile.owned.includes(id)) pool.push(['char', id]);
  }
  if (!pool.length) {
    const coins = GACHA.DUP[tier];
    profile.coins += coins;
    return { tier, kind: 'coins', coins, dup: true };
  }
  const [kind, id] = pool[Math.floor(rnd() * pool.length)];
  if (kind === 'skin') profile.skins.push(id);
  else profile.owned.push(id);
  return { tier, kind, id };
}

// n 회 뽑기. 코인이 모자라면 null.
export function gacha(profile, n, rnd = Math.random) {
  const cost = n >= 10 ? GACHA.COST10 : GACHA.COST * n;
  if (profile.coins < cost) return null;
  profile.coins -= cost;
  const out = [];
  for (let i = 0; i < n; i++) out.push(rollOnce(profile, rnd));
  return out;
}

// 아직 없는 그 등급의 의상 하나: 지금 캐릭터 → 가진 캐릭터 → 아무나 순 (없으면 null)
export function pickSkin(p, tier) {
  const rank = (k) => (SKINS[k].char === p.char ? 0 : p.owned.includes(SKINS[k].char) ? 1 : 2);
  return SKIN_KEYS.filter((k) => SKINS[k].tier === tier && !p.skins.includes(k)).sort((a, b) => rank(a) - rank(b))[0] || null;
}
// 시즌 랭크 의상 보상 받기 → { skin } 또는 (다 가졌으면) { coins }. 받을 수 없으면 null
export function claimRankSkin(p, i) {
  const r = rankSkinList(p).find((x) => x.i === i);
  if (!r || !r.claimable) return null;
  p.rank.got.push(i);
  const skin = pickSkin(p, RANK_SKINS[i]);
  if (skin) {
    p.skins.push(skin);
    return { skin };
  }
  p.coins += GACHA.DUP[RANK_SKINS[i]];
  return { coins: GACHA.DUP[RANK_SKINS[i]] };
}

// ── 상점: 크리스탈(💎, 유료 재화) ──
// 크리스탈은 결제로만 생긴다(결제 연결은 client/pay.js). 크리스탈로는 전설 의상과 고급 프로필 배경을 산다.
// 캐릭터 강화는 코인(플레이로 얻는 재화)으로만 → 돈으로 강해지지 않는다.
export const GEM_PACKS = Object.freeze([
  { id: 'g60', gems: 60, bonus: 0, krw: 1200 },
  { id: 'g300', gems: 300, bonus: 30, krw: 5900, tag: '인기' },
  { id: 'g650', gems: 650, bonus: 100, krw: 11900 },
  { id: 'g1400', gems: 1400, bonus: 300, krw: 24900, tag: '최고 혜택' },
]);
export const LEGEND_PRICE = 480; // 전설 의상 한 벌 (💎)
// 크리스탈(💎)로 코인(🪙) 사기: 많이 살수록 보너스
export const COIN_PACKS = Object.freeze([
  { id: 'k20', gems: 20, coins: 200 },
  { id: 'k100', gems: 100, coins: 1100, bonus: 100 },
  { id: 'k300', gems: 300, coins: 3600, bonus: 600 },
]);
// 프로필 아이콘 배경: gems 0 이면 누구나, 아니면 크리스탈로 산다. 그림은 client/backgrounds.js (CSS 로 그린다)
export const PROFILE_BGS = Object.freeze({
  night: { name: '밤하늘', gems: 0 },
  sunset: { name: '노을', gems: 0 },
  fire: { name: '모닥불', gems: 0 },
  firefly: { name: '반딧불', gems: 0 },
  snow: { name: '눈송이', gems: 0 },
  wave: { name: '파도', gems: 0 },
  plaid: { name: '체크무늬', gems: 0 },
  rainbow: { name: '무지개', gems: 0 },
  aurora: { name: '오로라', gems: 120 },
  galaxy: { name: '은하수', gems: 120 },
  royal: { name: '황금빛', gems: 120 },
  sakura: { name: '벚꽃 밤', gems: 120 },
});
export const canUseBg = (p, id) => id === '' || (Object.hasOwn(PROFILE_BGS, id) && (!PROFILE_BGS[id].gems || p.bgs.includes(id)));
// 결제가 끝난 크리스탈 묶음을 넣는다 (보너스 포함)
export function addGems(p, packId) {
  const pack = GEM_PACKS.find((x) => x.id === packId);
  if (!pack) return 0;
  p.gems += pack.gems + pack.bonus;
  return pack.gems + pack.bonus;
}
export function buyLegend(p, id) {
  if (SKINS[id]?.tier !== 'legend' || p.skins.includes(id) || p.gems < LEGEND_PRICE) return false;
  p.gems -= LEGEND_PRICE;
  p.skins.push(id);
  return true;
}
export function buyBg(p, id) {
  const b = PROFILE_BGS[id];
  if (!b?.gems || p.bgs.includes(id) || p.gems < b.gems) return false;
  p.gems -= b.gems;
  p.bgs.push(id);
  return true;
}
// 크리스탈 → 코인. 받은 코인 수 (크리스탈이 모자라면 0)
export function buyCoins(p, id) {
  const k = COIN_PACKS.find((x) => x.id === id);
  if (!k || p.gems < k.gems) return 0;
  p.gems -= k.gems;
  p.coins += k.coins;
  return k.coins;
}
// 캐릭터 강화 한 단계 (코인). 성공하면 새 단계, 아니면 0
export const upgradeCost = (p, id) => CHAR_UP.COST[p.clv[id] || 0] ?? null;
export function upgradeChar(p, id) {
  if (!p.owned.includes(id)) return 0;
  const lv = p.clv[id] || 0;
  if (lv >= CHAR_UP.MAX || p.coins < CHAR_UP.COST[lv]) return 0;
  p.coins -= CHAR_UP.COST[lv];
  p.clv[id] = lv + 1;
  return lv + 1;
}

export const dayKey = (d = new Date()) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;

// 출석 보상: 하루 한 번. 어제도 받았으면 연속 출석으로 보상이 커진다. 받을 수 없으면 0.
export function claimDaily(profile, now = new Date()) {
  const today = dayKey(now);
  if (profile.daily === today) return 0;
  const yesterday = dayKey(new Date(now.getTime() - 86400000));
  profile.streak = profile.daily === yesterday ? Math.min(DAILY.MAX_STREAK, profile.streak + 1) : 1;
  profile.daily = today;
  const coins = DAILY.BASE + DAILY.PER_STREAK * (profile.streak - 1);
  profile.coins += coins;
  return coins;
}
