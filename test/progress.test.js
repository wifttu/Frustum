import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../server/game.js';
import { CFG } from '../shared/config.js';
import { CHEAT, ORBS, PROGRESS, UPGRADES, cheatOf, orbTier, randomOrb, rollChoices, statsOf, xpToNext } from '../shared/progress.js';

function setup(opts) {
  const game = new Game({ BOT_FILL: 0, TEAMS: 0, START_GRACE: 0, items: false, ...opts });
  game.walls = [];
  game.fireflies = [];
  const sent = new Map();
  const add = (name) => {
    const box = [];
    const p = game.addPlayer(name, (m) => box.push(JSON.parse(m)));
    sent.set(p.id, box);
    return p;
  };
  const place = (p, x, z, yaw) => Object.assign(p, { x, z, yaw, alive: true });
  return { game, add, place, sent };
}

test('체력: 한 번에 쓰러지지 않고, 체력만큼 여러 번 맞아야 쓰러진다', () => {
  const { game, add, place } = setup();
  const a = add('A');
  const b = add('B');
  place(a, 0, 0, 0);
  place(b, 0, 3, 0);
  const full = b.stats.maxHp;
  assert.equal(b.hp, full);
  const need = Math.ceil(full / PROGRESS.BASE_DAMAGE);
  assert.ok(need >= 3 && need <= 4, `기본 캐릭터는 3~4번 (지금 ${need}번)`);
  for (let i = 0; i < need - 1; i++) {
    a.cd = 0;
    game.attack(a);
    assert.equal(b.alive, true);
  }
  assert.equal(b.hp, full - PROGRESS.BASE_DAMAGE * (need - 1));
  a.cd = 0;
  game.attack(a);
  assert.equal(b.alive, false);
  assert.equal(a.score, 1);
});

test('체력: 한동안 맞지 않으면 회복한다', () => {
  const { game, add, place } = setup();
  const a = add('A');
  add('B');
  place(a, 0, 0, 0);
  a.hp = 50;
  a.hurtT = 0;
  for (let i = 0; i < CFG.TICK_RATE * (PROGRESS.REGEN_DELAY - 0.5); i++) game.step();
  assert.equal(a.hp, 50);
  for (let i = 0; i < CFG.TICK_RATE * 2; i++) game.step();
  assert.ok(a.hp > 54);
});

test('성장: 반딧불을 주우면 경험치, 레벨업하면 카드 3장, 고르면 강화된다', () => {
  const { game, add, place, sent } = setup();
  const a = add('A');
  add('B');
  place(a, 0, 0, 0);
  for (let i = 0; i < 5; i++) game.fireflies.push({ id: 900 + i, x: 0.2 * i, z: 0, v: ORBS.small.v });
  game.step();
  assert.equal(game.fireflies.length, 0);
  assert.equal(a.level, 2); // 작은 구슬 5개(30) ≥ 첫 레벨업(24)
  assert.equal(a.choices.length, 1);
  assert.equal(a.choices[0].length, 3);
  game.broadcast();
  const st = sent.get(a.id).filter((m) => m.t === 'st').pop();
  assert.equal(st.lv, 2);
  assert.deepEqual(st.ch, a.choices[0]);
  // 체력 강화 선택
  a.choices[0] = ['hp', 'dmg', 'range'];
  game.choose(a, 0);
  const lv2 = statsOf({}, CFG, 'explorer', 2).maxHp;
  assert.equal(a.stats.maxHp, lv2 + 30);
  assert.equal(a.hp, lv2 + 30);
  assert.equal(a.choices.length, 0);
});

test('성장: 강화가 실제 판정에 반영된다 (사거리, 피해, 흡혈)', () => {
  const { game, add, place } = setup();
  const a = add('A');
  const b = add('B');
  place(a, 0, 0, 0);
  place(b, 0, CFG.ATTACK_RANGE + 1.2, 0);
  game.attack(a);
  const bFull = b.stats.maxHp;
  assert.equal(b.hp, bFull, '기본 사거리 밖');
  a.ups = { range: 2, dmg: 2, leech: 1 };
  game.applyStats(a);
  a.hp = 50;
  a.cd = 0;
  game.attack(a);
  const dmg = Math.round(PROGRESS.BASE_DAMAGE * 1.4);
  assert.equal(b.hp, bFull - dmg);
  assert.ok(Math.abs(a.hp - (50 + dmg * 0.25)) < 1e-6);
});

test('성장: 처치하면 큰 경험치, 쓰러진 쪽은 반딧불을 흘린다', () => {
  const { game, add, place } = setup();
  const a = add('A');
  const b = add('B');
  place(a, 0, 0, 0);
  place(b, 0, 3, 0);
  b.xp = 40;
  b.hp = 1;
  game.attack(a);
  assert.equal(b.alive, false);
  assert.ok(a.earned >= PROGRESS.XP_KILL + PROGRESS.XP_HIT);
  assert.ok(game.fireflies.length >= 2);
  assert.equal(b.xp, 40 - Math.floor(40 * PROGRESS.DEATH_DROP));
});

test('성장: 새 라운드에 초기화된다', () => {
  const { game, add } = setup();
  const a = add('A');
  add('B');
  game.gainXp(a, 500);
  assert.ok(a.level > 3);
  game.newRound();
  assert.equal(a.level, 1);
  assert.deepEqual(a.ups, {});
  assert.equal(a.hp, statsOf({}, CFG, 'explorer', 1).maxHp);
  assert.ok(game.fireflies.length >= PROGRESS.FIREFLY_START - 2);
});

test('강화 카드는 최대 단계를 넘지 않는다', () => {
  const full = Object.fromEntries(Object.entries(UPGRADES).map(([k, u]) => [k, u.max]));
  assert.deepEqual(rollChoices(full), []);
  const almost = { ...full, hp: 0 };
  assert.deepEqual(rollChoices(almost), ['hp']);
  assert.ok(xpToNext(1) < xpToNext(10) && xpToNext(10) < xpToNext(19), '뒤로 갈수록 무거워진다');
  assert.ok(statsOf({ cd: 3 }, CFG).cooldown < CFG.ATTACK_COOLDOWN * 0.6);
});

test('캐릭터: 저마다 기본 능력이 다르고, 서버 판정에 반영된다', async () => {
  const { CHARACTERS } = await import('../shared/progress.js');
  const { game, place } = setup();
  game.fireflies = [];
  const bear = game.addPlayer('Bear', () => {}, false, 'bear');
  const owl = game.addPlayer('Owl', () => {}, false, 'owl');
  const bad = game.addPlayer('X', () => {}, false, '__proto__');
  assert.equal(bad.char, 'explorer');
  assert.equal(bear.hp, PROGRESS.BASE_HP + 15);
  assert.ok(bear.spd < 1);
  // 올빼미는 기본 사거리 밖(7.5m)을 맞힌다
  place(owl, 0, 0, 0);
  place(bear, 0, 7.5, 0);
  place(bad, 20, 20, 0);
  game.attack(owl);
  assert.equal(bear.hp, PROGRESS.BASE_HP + 15 - Math.round(PROGRESS.BASE_DAMAGE * 1.1));
  assert.ok(Object.values(CHARACTERS).every((c) => c.name && c.desc && c.price >= 0));
});

test('스킬: 그림자의 은신은 위치 전송을 끊고, 반디는 경험치를 더 받는다', () => {
  const { game, place } = setup();
  const ninja = game.addPlayer('N', () => {}, false, 'ninja');
  const col = game.addPlayer('C', () => {}, false, 'collector');
  place(ninja, 0, 6, Math.PI);
  place(col, 0, 0, 0);
  assert.equal(game.computeVisibility().get(col.team).has(ninja.id), true);
  game.queueInput(ninja.id, [1, 0, 0, Math.PI, 0, 1, 0]);
  game.step();
  assert.ok(ninja.cloakT > 3);
  assert.ok(ninja.rollCd > 7, '충전 시간이 걸린다');
  assert.equal(ninja.rollT, 0, '구르지 않는다');
  assert.equal(game.computeVisibility().get(col.team).has(ninja.id), false);
  const before = col.earned;
  game.gainXp(col, 20);
  assert.equal(col.earned - before, 26); // 20 x 1.3
});

test('스킬: 질주, 방패, 매의 눈, 끌어오기, 치유', async () => {
  const { SKILLS } = await import('../shared/progress.js');
  const { game, place } = setup({ TEAMS: 2 });
  const use = (p) => {
    game.queueInput(p.id, [(p.lastSeq || 0) + 1, 0, 1, p.yaw, 0, 1, 0]);
    game.step();
  };
  const runner = game.addPlayer('R', () => {}, false, 'runner'); // 팀 1
  const bear = game.addPlayer('B', () => {}, false, 'bear'); // 팀 2
  const healer = game.addPlayer('H', () => {}, false, 'healer'); // 팀 1
  const owl = game.addPlayer('O', () => {}, false, 'owl'); // 팀 2
  const col = game.addPlayer('C', () => {}, false, 'collector'); // 팀 1
  place(runner, -20, -20, 0);
  place(bear, 0, 3, 0);
  place(healer, -20, -18, 0);
  place(owl, 20, 0, 0);
  place(col, 20, 20, 0);

  // 질주: 한 틱 이동 거리가 늘어난다
  const z0 = runner.z;
  use(runner);
  assert.ok(runner.dashT > 2);
  assert.ok(runner.z - z0 > (CFG.PLAYER_SPEED * runner.spd * 1.6) / CFG.TICK_RATE);

  // 방패: 지속 시간 동안 피해를 받지 않는다
  use(bear);
  assert.ok(bear.shieldT > 1.4);
  const hp = bear.hp;
  const filler = game.addPlayer('F', () => {}, false, 'explorer'); // 팀 2 (팀 수를 맞추는 용도)
  place(filler, -28, 28, 0);
  const atk = game.addPlayer('X', () => {}, false, 'explorer'); // 팀 1
  assert.notEqual(atk.team, bear.team);
  place(atk, 0, 0, 0);
  game.attack(atk);
  assert.equal(bear.hp, hp);

  // 매의 눈: 등 뒤의 적이 보인다
  place(atk, 20, -8, 0); // 올빼미(20,0, +z 를 봄)의 등 뒤
  assert.equal(game.computeVisibility().get(owl.team).has(atk.id), false);
  use(owl);
  assert.equal(game.computeVisibility().get(owl.team).has(atk.id), true);

  // 끌어오기: 범위 안의 반딧불을 모은다
  game.fireflies = [{ id: 1, x: 25, z: 25, v: 10 }, { id: 2, x: 14, z: 20, v: 10 }, { id: 3, x: -20, z: 0, v: 10 }];
  use(col);
  assert.equal(game.fireflies.length, 1);
  assert.ok(col.earned >= 25);

  // 치유: 나와 가까운 아군을 회복한다 (적은 아님)
  healer.hp = 40;
  runner.hp = 30;
  place(runner, -20, -16, 0);
  use(healer);
  assert.ok(Math.abs(healer.hp - (40 + SKILLS.heal.amount)) < 1); // 자연 회복이 조금 섞인다
  assert.ok(runner.hp >= 30 + SKILLS.heal.amount);
});

test('하트: 체력을 회복한다', () => {
  const { game, add, place } = setup({ items: true });
  const a = add('A');
  add('B');
  place(a, 0, 0, 0);
  a.hp = 30;
  game.items = [{ id: 1, type: 'heart', x: 0.2, z: 0 }];
  game.step();
  assert.ok(a.hp >= 70 && a.hp < 71);
});

test('경험치 구슬: 작은·중간·큰 구슬, 높은 레벨일수록 많이 흘린다', () => {
  assert.equal(orbTier(ORBS.small.v), 'small');
  assert.equal(orbTier(ORBS.medium.v), 'medium');
  assert.equal(orbTier(ORBS.large.v), 'large');
  const counts = { small: 0, medium: 0, large: 0 };
  for (let i = 0; i < 4000; i++) counts[orbTier(randomOrb())]++;
  assert.ok(counts.small > counts.medium && counts.medium > counts.large && counts.large > 100, JSON.stringify(counts));
  const drop = (level) => {
    const { game, add, place } = setup();
    const a = add('A');
    const b = add('B');
    place(a, 0, 0, 0);
    place(b, 0, 3, 0);
    b.level = level;
    b.hp = 1;
    game.attack(a);
    return game.fireflies.reduce((s, f) => s + f.v, 0);
  };
  assert.ok(drop(12) > drop(2) * 2);
});

test('레벨이 오르면 체력과 피해가 저절로 오르고, 높은 레벨을 잡으면 현상금이 붙는다', () => {
  assert.ok(statsOf({}, CFG, 'explorer', 10).maxHp > statsOf({}, CFG, 'explorer', 1).maxHp + 50);
  assert.ok(statsOf({}, CFG, 'explorer', 10).damage > statsOf({}, CFG, 'explorer', 1).damage * 1.3);
  const gain = (myLv, theirLv) => {
    const { game, add, place } = setup();
    const a = add('A');
    const b = add('B');
    place(a, 0, 0, 0);
    place(b, 0, 3, 0);
    a.level = myLv;
    b.level = theirLv;
    b.hp = 1;
    const before = a.earned;
    game.attack(a);
    return a.earned - before;
  };
  assert.ok(gain(2, 10) > gain(10, 10) * 2, '아래 레벨이 위 레벨을 잡으면 크게 받는다');
});

test('치트: 사람이 혼자일 때만 무적·경험치·쿨타임이 켜지고, 다른 사람이 오면 꺼진다', () => {
  const game = new Game({ BOT_FILL: 0, TEAMS: 0, START_GRACE: 0, items: false });
  game.walls = [];
  game.fireflies = [];
  const me = game.addPlayer('Me', () => {}, false, 'explorer', 'default', { cheat: { god: true, xp: true, cd: true } });
  const bot = game.addPlayer('AI-1', null, true);
  Object.assign(me, { x: 0, z: 0, yaw: Math.PI, alive: true });
  Object.assign(bot, { x: 0, z: 3, yaw: Math.PI, alive: true });
  const base = statsOf({}, CFG, 'explorer');
  assert.equal(me.stats.xpMul, base.xpMul * CHEAT.XP_MUL);
  assert.ok(Math.abs(me.stats.cooldown - base.cooldown * CHEAT.CD_MUL) < 1e-9);
  const hp = me.hp;
  game.attack(bot);
  assert.equal(me.hp, hp); // 무적
  // 다른 사람이 들어오면 치트가 꺼진다
  const other = game.addPlayer('B', () => {});
  assert.equal(me.stats.xpMul, base.xpMul);
  game.attack(bot);
  assert.ok(me.hp < hp);
  game.removePlayer(other.id);
  assert.equal(me.stats.xpMul, base.xpMul * CHEAT.XP_MUL);
  assert.equal(cheatOf({ god: 1, hack: true }).god, true);
  assert.equal(cheatOf({ hack: true }), null);
});
