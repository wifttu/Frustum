// 성장 시스템: 반딧불(경험치)을 모아 레벨을 올리고, 레벨마다 강화 카드 3장 중 1장을 고른다.
// 서버(판정)와 클라이언트(예측, UI)가 같은 계산을 쓴다.

export const PROGRESS = Object.freeze({
  BASE_HP: 100,
  BASE_DAMAGE: 34, // 손전등 한 번 (기본 체력이면 세 번에 쓰러진다)
  REGEN_DELAY: 4, // 마지막으로 맞은 뒤 이 시간이 지나면 회복 시작
  BASE_REGEN: 3, // 초당 회복량
  MAX_LEVEL: 20,
  CHOICES: 3, // 레벨업마다 고르는 카드 수
  // 레벨마다 저절로 붙는 성장 (카드와 별개). 레벨이 높을수록 확실히 강해진다 = 왕귀.
  HP_PER_LEVEL: 8,
  DMG_PER_LEVEL: 0.04,
  // 경험치
  XP_HIT: 4,
  XP_KILL: 30, // + 상대 레벨 x XP_KILL_PER_LEVEL
  XP_KILL_PER_LEVEL: 7,
  BOUNTY_PER_GAP: 0.4, // 나보다 높은 레벨을 잡으면 레벨 차이마다 +40%
  // 반딧불(경험치 구슬): 작은 것, 중간 것, 큰 것
  FIREFLY_MAX: 40,
  FIREFLY_EVERY: 0.6, // 새로 생기는 간격(초)
  FIREFLY_START: 30,
  PICK_RADIUS: 1.7, // 이 안의 반딧불은 자석처럼 끌려와 먹힌다 (가까이 가면 미리 떨리며 끌려오는 모습이 보인다)
  DEATH_DROP: 0.6, // 쓰러지면 지금 레벨에서 모은 경험치의 이만큼 + 레벨 보너스를 큰 구슬로 흘린다
});

// 경험치 구슬 종류. weight: 맵에 저절로 생길 때의 비율
export const ORBS = Object.freeze({
  small: { v: 6, weight: 70 },
  medium: { v: 18, weight: 24 },
  large: { v: 50, weight: 6 },
});
export const orbTier = (v) => (v >= ORBS.large.v ? 'large' : v >= ORBS.medium.v ? 'medium' : 'small');
export function randomOrb(rnd = Math.random) {
  let r = rnd() * 100;
  for (const [k, o] of Object.entries(ORBS)) {
    r -= o.weight;
    if (r < 0) return o.v;
  }
  return ORBS.small.v;
}

// 레벨 n 에서 다음 레벨까지 필요한 경험치: 초반은 금방, 뒤로 갈수록 조금씩 무거워진다
export const xpToNext = (level) => Math.round(24 + (level - 1) * 12 + (level - 1) ** 2 * 2.6);

// 치트 모드 (설정에서 켬). 다른 사람과 함께하는 판에서는 서버가 꺼 버린다 = 혼자 또는 AI 상대일 때만.
export const CHEAT = Object.freeze({ XP_MUL: 5, CD_MUL: 0.25, SPEED_MUL: 1.3 });
const CHEAT_KEYS = ['god', 'xp', 'cd', 'speed'];
export function cheatOf(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const c = {};
  for (const k of CHEAT_KEYS) if (raw[k] === true || raw[k] === 1) c[k] = true;
  return Object.keys(c).length ? c : null;
}

// 강화 카드. max: 최대 중첩
export const UPGRADES = Object.freeze({
  hp: { name: '튼튼한 몸', desc: '최대 체력 +30', icon: '❤️', max: 4 },
  dmg: { name: '강한 빛', desc: '피해 +20%', icon: '💥', max: 4 },
  range: { name: '긴 빛', desc: '손전등 사거리 +1m', icon: '🔦', max: 3 },
  arc: { name: '넓은 빛', desc: '빛의 폭 +10°', icon: '🌟', max: 3 },
  cd: { name: '빠른 충전', desc: '손전등 충전 -18%', icon: '🔋', max: 3 },
  speed: { name: '가벼운 발', desc: '이동 속도 +8%', icon: '👟', max: 3 },
  roll: { name: '스킬 달인', desc: '고유 스킬 충전 -25%', icon: '🌀', max: 2 },
  regen: { name: '회복력', desc: '회복 +4/초, 더 빨리 시작', icon: '🍀', max: 3 },
  leech: { name: '따뜻한 빛', desc: '입힌 피해의 25% 회복', icon: '💗', max: 2 },
  magnet: { name: '반딧불 자석', desc: '반딧불을 멀리서 끌어당김', icon: '🧲', max: 2 },
});
export const UPGRADE_KEYS = Object.keys(UPGRADES);

// 고유 스킬: 캐릭터마다 하나씩 (두 번째 버튼). cd: 충전 시간(초)
export const SKILLS = Object.freeze({
  roll: { name: '구르기', icon: '🌀', cd: 3, desc: '빠르게 굴러 피한다 (구르는 동안 무적)' },
  dash: { name: '질주', icon: '💨', cd: 6, time: 2.5, speed: 1.7, desc: '2.5초 동안 훨씬 빨라진다' },
  shield: { name: '방패', icon: '🛡️', cd: 16, time: 1.6, desc: '1.6초 동안 모든 빛을 막는다' },
  scan: { name: '매의 눈', icon: '👁️', cd: 14, time: 4, radius: 15, desc: '4초 동안 주변 15m를 사방으로 본다' },
  magnet: { name: '끌어오기', icon: '🧲', cd: 9, radius: 11, desc: '주변 11m의 반딧불을 한 번에 모은다' },
  stealth: { name: '은신', icon: '🌫️', cd: 8, time: 3.5, desc: '3.5초 동안 상대에게 안 보인다 (공격하면 풀림)' },
  heal: { name: '치유', icon: '💚', cd: 13, amount: 35, radius: 6, desc: '나와 주변 아군의 체력을 35 회복한다' },
});

// 캐릭터: 저마다 기본 능력이 다르다. 코인으로 구매한다(explorer 는 기본 제공).
// 수치 필드는 statsOf 에서 기본값에 더하거나 곱한다. 특수 능력은 서버 game.js 에서 처리한다.
export const CHARACTERS = Object.freeze({
  explorer: { name: '탐험가', icon: '🧭', price: 0, skill: 'roll', desc: '균형 잡힌 기본 캐릭터 · 체력 115', hp: 15 },
  runner: { name: '번개', icon: '⚡', price: 300, skill: 'dash', desc: '이동 +15%, 손전등 충전 -20%, 피해 +5%', speed: 0.15, cd: 0.2, dmg: 0.05 },
  bear: { name: '곰돌이', icon: '🐻', price: 400, skill: 'shield', desc: '체력 115, 이동 -10%', hp: 15, speed: -0.1 },
  owl: { name: '올빼미', icon: '🦉', price: 500, skill: 'scan', desc: '사거리 +2m, 피해 +10%, 빛의 폭 -8°', range: 2, dmg: 0.1, arc: -8 },
  collector: { name: '반디', icon: '🏮', price: 350, skill: 'magnet', desc: '경험치 +30%, 반딧불을 멀리서 줍기', xp: 0.3, pick: 2 },
  ninja: { name: '그림자', icon: '🥷', price: 600, skill: 'stealth', desc: '피해 +20%, 이동 +5%, 체력 95', hp: -5, dmg: 0.2, speed: 0.05 },
  healer: { name: '약초꾼', icon: '🌿', price: 450, skill: 'heal', desc: '회복 1.5배, 입힌 피해의 8% 회복', regenMul: 1.5, leech: 0.08 },
});
export const CHARACTER_KEYS = Object.keys(CHARACTERS);
export const charOf = (id) => (Object.hasOwn(CHARACTERS, id) ? id : 'explorer');

// 강화 단계(ups: {키: 단계}) → 실제 수치
// 캐릭터 강화(상점): 코인으로 캐릭터마다 단계를 올린다 (최대 5단계). 단계마다 최대 체력 +3%, 손전등 피해 +2%.
// 유료 재화(크리스탈)로는 살 수 없다 → 돈으로 강해지지 않는다.
export const CHAR_UP = Object.freeze({ MAX: 5, COST: [300, 600, 1000, 1500, 2200], HP: 0.03, DMG: 0.02 });
export const clvOf = (v) => Math.max(0, Math.min(CHAR_UP.MAX, Math.floor(Number(v) || 0)));

export function statsOf(ups, cfg, charId = 'explorer', level = 1, clv = 0) {
  const u = (k) => ups[k] || 0;
  const c = CHARACTERS[charOf(charId)];
  const lv = Math.max(0, level - 1);
  const cl = clvOf(clv);
  return {
    maxHp: Math.round((PROGRESS.BASE_HP + (c.hp || 0) + u('hp') * 30 + lv * PROGRESS.HP_PER_LEVEL) * (1 + cl * CHAR_UP.HP)),
    damage: PROGRESS.BASE_DAMAGE * (1 + (c.dmg || 0) + u('dmg') * 0.2 + lv * PROGRESS.DMG_PER_LEVEL) * (1 + cl * CHAR_UP.DMG),
    range: cfg.ATTACK_RANGE + (c.range || 0) + u('range'),
    arc: cfg.ATTACK_ARC + (((c.arc || 0) + u('arc') * 10) * Math.PI) / 180,
    cooldown: cfg.ATTACK_COOLDOWN * (1 - (c.cd || 0)) * Math.pow(0.82, u('cd')),
    speed: 1 + (c.speed || 0) + u('speed') * 0.08,
    skill: c.skill,
    rollCd: SKILLS[c.skill].cd * Math.pow(0.75, u('roll')), // 고유 스킬 충전 시간 (필드 이름은 호환을 위해 유지)
    regen: (PROGRESS.BASE_REGEN + u('regen') * 4) * (c.regenMul || 1),
    regenDelay: PROGRESS.REGEN_DELAY - u('regen') * 0.8,
    leech: (c.leech || 0) + u('leech') * 0.25,
    pickRadius: PROGRESS.PICK_RADIUS + (c.pick || 0) + u('magnet') * 1.6,
    xpMul: 1 + (c.xp || 0),
  };
}

// 아직 최대가 아닌 강화 중에서 n 장을 무작위로 뽑는다
export function rollChoices(ups, n = PROGRESS.CHOICES, rnd = Math.random) {
  const pool = UPGRADE_KEYS.filter((k) => (ups[k] || 0) < UPGRADES[k].max);
  const out = [];
  while (out.length < n && pool.length) out.push(pool.splice(Math.floor(rnd() * pool.length), 1)[0]);
  return out;
}
