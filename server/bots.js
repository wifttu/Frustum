// 간단한 봇. 사람과 동일한 입력 구조를 만들고, 자기 시야에 들어온 적만 인지한다.
import { canSee, wrapAngle } from '../shared/vision.js';

const REACTION = 0.6; // 적을 본 뒤 반응하기까지의 시간

export function botThink(bot, game, dt) {
  const cfg = game.cfg;
  const ai = bot.ai;
  if (ai.wx === undefined) pickWaypoint(bot, game);

  let target = null;
  let best = Infinity;
  for (const q of game.players.values()) {
    if (!q.alive || q.team === bot.team) continue;
    const d = Math.hypot(q.x - bot.x, q.z - bot.z);
    if (d < best && canSee(bot, q.x, q.z, cfg.PLAYER_RADIUS, game.walls, cfg)) {
      best = d;
      target = q;
    }
  }
  ai.seenFor = target ? (ai.seenFor || 0) + dt : 0;

  if (target && ai.seenFor >= REACTION) {
    const yaw = Math.atan2(target.x - bot.x, target.z - bot.z);
    const aligned = Math.abs(wrapAngle(yaw - bot.yaw)) < cfg.ATTACK_ARC / 2;
    const inRange = best < cfg.ATTACK_RANGE;
    // 상대가 나를 정면으로 겨누고 있으면 가끔 옆으로 구른다
    const threatened =
      best < cfg.ATTACK_RANGE + 1 &&
      Math.abs(wrapAngle(Math.atan2(bot.x - target.x, bot.z - target.z) - target.yaw)) < cfg.ATTACK_ARC / 2;
    const dodge = threatened && Math.random() < 0.04;
    return {
      mx: dodge ? (Math.random() < 0.5 ? -1 : 1) : 0,
      mz: inRange ? 0.3 : 1,
      yaw,
      atk: aligned && inRange,
      roll: dodge,
      flare: false,
    };
  }

  // 순찰: 웨이포인트로 이동, 막히면 새 목적지. 가끔 조명탄으로 앞을 밝힌다.
  ai.stuckT = (ai.stuckT || 0) + dt;
  if (ai.stuckT > 1) {
    if (Math.hypot(bot.x - ai.lx, bot.z - ai.lz) < 0.8) pickWaypoint(bot, game);
    ai.stuckT = 0;
    ai.lx = bot.x;
    ai.lz = bot.z;
  }
  const dx = ai.wx - bot.x;
  const dz = ai.wz - bot.z;
  if (Math.hypot(dx, dz) < 1.5) pickWaypoint(bot, game);
  const yaw = Math.atan2(dx, dz);
  const diff = Math.abs(wrapAngle(yaw - bot.yaw));
  return { mx: 0, mz: diff < 0.6 ? 0.8 : 0.2, yaw, atk: false, roll: false, flare: Math.random() < 0.003 };
}

function pickWaypoint(bot, game) {
  const ai = bot.ai;
  [ai.wx, ai.wz] = game.randomFreePoint();
  ai.lx = bot.x;
  ai.lz = bot.z;
  ai.stuckT = 0;
}
