// 성장 시스템: 반딧불(경험치)을 모아 레벨을 올리고, 레벨마다 강화 카드 3장 중 1장을 고른다.
// 서버(판정)와 클라이언트(예측, UI)가 같은 계산을 쓴다.

export const PROGRESS = Object.freeze({
  BASE_HP: 100,
  BASE_DAMAGE: 34, // 손전등 한 번 (기본 체력이면 세 번에 쓰러진다)
  REGEN_DELAY: 4, // 마지막으로 맞은 뒤 이 시간이 지나면 회복 시작
  BASE_REGEN: 3, // 초당 회복량
  MAX_LEVEL: 12,
  CHOICES: 3, // 레벨업마다 고르는 카드 수
  // 경험치
  XP_FIREFLY: 10,
  XP_HIT: 6,
  XP_KILL: 30, // + 상대 레벨 x XP_KILL_PER_LEVEL
  XP_KILL_PER_LEVEL: 8,
  // 반딧불
  FIREFLY_MAX: 28,
  FIREFLY_EVERY: 1.2, // 새로 생기는 간격(초)
  FIREFLY_START: 18,
  PICK_RADIUS: 1.2,
  DEATH_DROP: 0.5, // 쓰러지면 현재 레벨 경험치의 이만큼을 반딧불로 흘린다
});

// 레벨 n 에서 다음 레벨까지 필요한 경험치
export const xpToNext = (level) => 50 + (level - 1) * 45;

// 강화 카드. max: 최대 중첩
export const UPGRADES = Object.freeze({
  hp: { name: '튼튼한 몸', desc: '최대 체력 +30', icon: '❤️', max: 4 },
  dmg: { name: '강한 빛', desc: '피해 +20%', icon: '💥', max: 4 },
  range: { name: '긴 빛', desc: '손전등 사거리 +1m', icon: '🔦', max: 3 },
  arc: { name: '넓은 빛', desc: '빛의 폭 +10°', icon: '🌟', max: 3 },
  cd: { name: '빠른 충전', desc: '손전등 충전 -18%', icon: '🔋', max: 3 },
  speed: { name: '가벼운 발', desc: '이동 속도 +8%', icon: '👟', max: 3 },
  roll: { name: '구르기 달인', desc: '구르기 충전 -30%', icon: '🌀', max: 2 },
  regen: { name: '회복력', desc: '회복 +4/초, 더 빨리 시작', icon: '🍀', max: 3 },
  leech: { name: '따뜻한 빛', desc: '입힌 피해의 25% 회복', icon: '💗', max: 2 },
  magnet: { name: '반딧불 자석', desc: '반딧불을 멀리서 끌어당김', icon: '🧲', max: 2 },
});
export const UPGRADE_KEYS = Object.keys(UPGRADES);

// 강화 단계(ups: {키: 단계}) → 실제 수치
export function statsOf(ups, cfg) {
  const u = (k) => ups[k] || 0;
  return {
    maxHp: PROGRESS.BASE_HP + u('hp') * 30,
    damage: PROGRESS.BASE_DAMAGE * (1 + u('dmg') * 0.2),
    range: cfg.ATTACK_RANGE + u('range'),
    arc: cfg.ATTACK_ARC + (u('arc') * 10 * Math.PI) / 180,
    cooldown: cfg.ATTACK_COOLDOWN * Math.pow(0.82, u('cd')),
    speed: 1 + u('speed') * 0.08,
    rollCd: cfg.ROLL_COOLDOWN * Math.pow(0.7, u('roll')),
    regen: PROGRESS.BASE_REGEN + u('regen') * 4,
    regenDelay: PROGRESS.REGEN_DELAY - u('regen') * 0.8,
    leech: u('leech') * 0.25,
    pickRadius: PROGRESS.PICK_RADIUS + u('magnet') * 1.6,
  };
}

// 아직 최대가 아닌 강화 중에서 n 장을 무작위로 뽑는다
export function rollChoices(ups, n = PROGRESS.CHOICES, rnd = Math.random) {
  const pool = UPGRADE_KEYS.filter((k) => (ups[k] || 0) < UPGRADES[k].max);
  const out = [];
  while (out.length < n && pool.length) out.push(pool.splice(Math.floor(rnd() * pool.length), 1)[0]);
  return out;
}
