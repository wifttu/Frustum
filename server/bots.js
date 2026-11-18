// 간단한 봇. 사람과 동일한 입력 구조를 만들고, 자기 시야에 들어온 적만 인지한다.
import { canSee, wrapAngle } from '../shared/vision.js';
import { findPath } from './nav.js';

const REACTION = 0.6; // 적을 본 뒤 반응하기까지의 시간

export function botThink(bot, game, dt) {
  const cfg = game.cfg;
  const ai = bot.ai;
  if (ai.wx === undefined) pickWaypoint(bot, game);

  // 독구름: 구역 밖이거나 목적지가 구역 밖이면 안쪽으로 새 목적지를 잡고, 밖에 있는 동안은 싸우지 않는다
  const half = game.zoneHalf() - 2;
  const outside = Math.max(Math.abs(bot.x), Math.abs(bot.z)) > half;
  if (Math.max(Math.abs(ai.wx), Math.abs(ai.wz)) > half) pickWaypoint(bot, game);

  let target = null;
  let best = Infinity;
  for (const q of game.players.values()) {
    if (outside || !q.alive || q.team === bot.team) continue;
    const d = Math.hypot(q.x - bot.x, q.z - bot.z);
    if (d < best && canSee(bot, q.x, q.z, cfg.PLAYER_RADIUS, game.walls, cfg)) {
      best = d;
      target = q;
    }
  }
  ai.seenFor = target ? (ai.seenFor || 0) + dt : 0;

  if (target) ai.hunt = [target.x, target.z]; // 놓치면 마지막으로 본 곳을 수색한다
  if (target && ai.seenFor >= REACTION) {
    const yaw = Math.atan2(target.x - bot.x, target.z - bot.z);
    const aligned = Math.abs(wrapAngle(yaw - bot.yaw)) < cfg.ATTACK_ARC / 2;
    const inRange = best < bot.stats.range;
    // 상대가 나를 정면으로 겨누고 있으면 가끔 옆으로 구른다
    const threatened =
      best < cfg.ATTACK_RANGE + 1 &&
      Math.abs(wrapAngle(Math.atan2(bot.x - target.x, bot.z - target.z) - target.yaw)) < cfg.ATTACK_ARC / 2;
    const dodge = threatened && Math.random() < 0.04;
    // 고유 스킬: 위협받으면 회피/방어기, 체력이 낮으면 치유, 접근할 때 은신/질주
    const sk = bot.skill;
    const useSkill =
      sk === 'roll' ? dodge :
      sk === 'shield' ? threatened && Math.random() < 0.1 :
      sk === 'heal' ? bot.hp < bot.stats.maxHp * 0.55 :
      sk === 'stealth' || sk === 'dash' ? !inRange && Math.random() < 0.05 :
      false;
    return {
      mx: dodge ? (Math.random() < 0.5 ? -1 : 1) : 0,
      mz: inRange ? 0.3 : 1,
      yaw,
      atk: aligned && inRange,
      roll: useSkill,
      flare: false,
    };
  }

  // 가까이 보이는 아이템이 있으면 주우러 간다
  if (!target && !outside && !ai.item) {
    // 아이템과 큰 구슬부터 (경험치가 클수록 멀리 있어도 간다)
    const pickups = [...game.items, ...[...game.fireflies].sort((a, b) => b.v - a.v)];
    for (const it of pickups) {
      if (Math.hypot(it.x - bot.x, it.z - bot.z) > (it.v >= 50 ? 14 : 9)) continue;
      if (!canSee(bot, it.x, it.z, 0.3, game.walls, cfg)) continue;
      ai.item = it.id;
      setGoal(bot, it.x, it.z, game);
      break;
    }
  }
  if (ai.item && !game.items.some((it) => it.id === ai.item) && !game.fireflies.some((f) => f.id === ai.item)) ai.item = null;

  // 적을 놓쳤으면 마지막으로 본 위치로 간다
  if (!target && ai.hunt && !outside) {
    setGoal(bot, ai.hunt[0], ai.hunt[1], game);
    ai.hunt = null;
  }

  // 순찰: A* 경로의 경유점을 차례로 따라간다. 막히면 새 목적지. 가끔 조명탄으로 앞을 밝힌다.
  ai.stuckT = (ai.stuckT || 0) + dt;
  if (ai.stuckT > 1) {
    if (Math.hypot(bot.x - ai.lx, bot.z - ai.lz) < 0.8) pickWaypoint(bot, game);
    ai.stuckT = 0;
    ai.lx = bot.x;
    ai.lz = bot.z;
  }
  let node = ai.path[ai.pi];
  while (node && Math.hypot(node[0] - bot.x, node[1] - bot.z) < 0.8) node = ai.path[++ai.pi];
  if (!node) {
    pickWaypoint(bot, game);
    node = ai.path[ai.pi] || [ai.wx, ai.wz];
  }
  const yaw = Math.atan2(node[0] - bot.x, node[1] - bot.z);
  const diff = Math.abs(wrapAngle(yaw - bot.yaw));
  // 순찰 중 스킬: 매의 눈으로 둘러보기, 반딧불이 많으면 끌어오기, 다쳤으면 치유, 독구름 밖이면 질주
  const sk = bot.skill;
  const patrolSkill =
    sk === 'scan' ? Math.random() < 0.004 :
    sk === 'magnet' ? game.fireflies.filter((f) => Math.hypot(f.x - bot.x, f.z - bot.z) < 9).length >= 3 :
    sk === 'heal' ? bot.hp < bot.stats.maxHp * 0.6 :
    sk === 'dash' ? outside :
    false;
  return { mx: 0, mz: diff < 0.6 ? (outside ? 1 : 0.8) : 0.2, yaw, atk: false, roll: patrolSkill, flare: Math.random() < 0.003 };
}

// 목적지와 그곳까지의 경로를 정한다
function setGoal(bot, x, z, game) {
  const ai = bot.ai;
  ai.wx = x;
  ai.wz = z;
  ai.path = findPath(game.solid, bot.x, bot.z, x, z) || [[x, z]];
  ai.pi = 0;
  ai.lx = bot.x;
  ai.lz = bot.z;
  ai.stuckT = 0;
}

function pickWaypoint(bot, game) {
  const [x, z] = game.randomFreePoint();
  setGoal(bot, x, z, game);
}
