// 상점 규칙: 스킨, 뽑기(등급·확률·천장), 출석 보상.
// 화면과 분리된 순수 로직이라 테스트할 수 있다. 재화는 게임으로 버는 코인뿐이고 실제 결제는 없다.
import { CHARACTERS } from './progress.js';
import { normalizeProgress } from './missions.js';

// 스킨(의상): 컨셉마다 모자와 소품이 달라진다. 모자·소품은 모든 플레이어에게 보이고,
// color 는 내 화면에서의 후드/망토 색이다(다른 사람에게는 아군 파랑, 적 빨강으로 보인다).
export const SKINS = Object.freeze({
  default: { name: '기본', desc: '캐릭터 본래 모습', color: null, tier: 'common' },
  strawberry: { name: '딸기 요정', desc: '잎사귀 왕관과 씨앗 무늬 후드', color: 0xff5d7a, tier: 'rare' },
  lime: { name: '개구리', desc: '눈이 툭 튀어나온 개구리 후드', color: 0x7fcf3a, tier: 'rare' },
  pumpkin: { name: '호박 마법사', desc: '뾰족한 마법사 모자', color: 0xff8a2e, tier: 'rare' },
  snow: { name: '눈사람', desc: '중절모, 당근 코, 빨간 목도리', color: 0xf2f4f8, tier: 'epic' },
  night: { name: '우주비행사', desc: '헬멧 테와 안테나, 산소통', color: 0x39407e, tier: 'epic' },
  gold: { name: '황금 왕', desc: '보석 박힌 왕관과 털 망토', color: 0xffcf3a, tier: 'legend' },
});
export const SKIN_KEYS = Object.keys(SKINS);
export const skinOf = (id) => (Object.hasOwn(SKINS, id) ? id : 'default');

// 프로필 아이콘: 기본 제공 + 가진 캐릭터의 아이콘 + 가진 의상의 아이콘
export const FREE_ICONS = Object.freeze(['🔦', '🏕️', '🌲', '🔥', '🌙', '⭐', '🦊', '🐱', '🐶', '🐼', '🐰', '🦔']);
export const SKIN_ICONS = Object.freeze({ strawberry: '🍓', lime: '🐸', pumpkin: '🎃', snow: '⛄', night: '🚀', gold: '👑' });
// [{ icon, locked, how }] — locked 이면 how 에 얻는 방법
export function iconsFor(profile) {
  const out = FREE_ICONS.map((icon) => ({ icon, locked: false, how: '' }));
  for (const [id, c] of Object.entries(CHARACTERS)) out.push({ icon: c.icon, locked: !profile.owned.includes(id), how: `${c.name} 캐릭터를 얻으면 열려요` });
  for (const [id, icon] of Object.entries(SKIN_ICONS)) out.push({ icon, locked: !profile.skins.includes(id), how: `${SKINS[id].name} 의상을 얻으면 열려요` });
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
  return normalizeProgress({ xp: 0, coins: 0, owned: ['explorer'], char: 'explorer', skins: ['default'], skin: 'default', pity: 0, daily: '', streak: 0, friends: [], recent: [], icon: '', fc: '', tutorial: 0 });
}

// 저장된 값을 안전하게 정리한다 (오래된 저장 데이터, 손상된 값 대비)
export function normalizeProfile(raw) {
  const p = { ...newProfile(), ...(raw && typeof raw === 'object' ? raw : {}) };
  p.coins = Number.isFinite(p.coins) ? Math.max(0, p.coins) : 0;
  p.xp = Number.isFinite(p.xp) ? Math.max(0, p.xp) : 0;
  p.owned = [...new Set(['explorer', ...(Array.isArray(p.owned) ? p.owned : [])])].filter((id) => Object.hasOwn(CHARACTERS, id));
  p.skins = [...new Set(['default', ...(Array.isArray(p.skins) ? p.skins : [])])].filter((id) => Object.hasOwn(SKINS, id));
  if (!p.owned.includes(p.char)) p.char = 'explorer';
  if (!p.skins.includes(p.skin)) p.skin = 'default';
  p.pity = Number.isInteger(p.pity) ? p.pity : 0;
  p.streak = Number.isInteger(p.streak) ? p.streak : 0;
  p.tutorial = p.tutorial ? 1 : 0; // 연습을 끝냈나 (보상은 한 번만)
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
  for (const [id, s] of Object.entries(SKINS)) if (s.tier === tier && !profile.skins.includes(id)) pool.push(['skin', id]);
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
