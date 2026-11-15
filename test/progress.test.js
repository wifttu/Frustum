import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../server/game.js';
import { CFG } from '../shared/config.js';
import { PROGRESS, UPGRADES, rollChoices, statsOf, xpToNext } from '../shared/progress.js';

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

test('체력: 한 번에 쓰러지지 않고 세 번째에 쓰러진다', () => {
  const { game, add, place } = setup();
  const a = add('A');
  const b = add('B');
  place(a, 0, 0, 0);
  place(b, 0, 3, 0);
  assert.equal(b.hp, PROGRESS.BASE_HP);
  for (let i = 0; i < 2; i++) {
    a.cd = 0;
    game.attack(a);
    assert.equal(b.alive, true);
  }
  assert.equal(b.hp, PROGRESS.BASE_HP - PROGRESS.BASE_DAMAGE * 2);
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
  for (let i = 0; i < 5; i++) game.fireflies.push({ id: 900 + i, x: 0.2 * i, z: 0, v: PROGRESS.XP_FIREFLY });
  game.step();
  assert.equal(game.fireflies.length, 0);
  assert.equal(a.level, 2); // 50 경험치 = 1레벨업
  assert.equal(a.choices.length, 1);
  assert.equal(a.choices[0].length, 3);
  game.broadcast();
  const st = sent.get(a.id).filter((m) => m.t === 'st').pop();
  assert.equal(st.lv, 2);
  assert.deepEqual(st.ch, a.choices[0]);
  // 체력 강화 선택
  a.choices[0] = ['hp', 'dmg', 'range'];
  game.choose(a, 0);
  assert.equal(a.stats.maxHp, PROGRESS.BASE_HP + 30);
  assert.equal(a.hp, PROGRESS.BASE_HP + 30);
  assert.equal(a.choices.length, 0);
});

test('성장: 강화가 실제 판정에 반영된다 (사거리, 피해, 흡혈)', () => {
  const { game, add, place } = setup();
  const a = add('A');
  const b = add('B');
  place(a, 0, 0, 0);
  place(b, 0, CFG.ATTACK_RANGE + 1.2, 0);
  game.attack(a);
  assert.equal(b.hp, PROGRESS.BASE_HP, '기본 사거리 밖');
  a.ups = { range: 2, dmg: 2, leech: 1 };
  game.applyStats(a);
  a.hp = 50;
  a.cd = 0;
  game.attack(a);
  const dmg = Math.round(PROGRESS.BASE_DAMAGE * 1.4);
  assert.equal(b.hp, PROGRESS.BASE_HP - dmg);
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
  assert.equal(b.xp, 20);
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
  assert.equal(a.hp, PROGRESS.BASE_HP);
  assert.ok(game.fireflies.length >= PROGRESS.FIREFLY_START - 2);
});

test('강화 카드는 최대 단계를 넘지 않는다', () => {
  const full = Object.fromEntries(Object.entries(UPGRADES).map(([k, u]) => [k, u.max]));
  assert.deepEqual(rollChoices(full), []);
  const almost = { ...full, hp: 0 };
  assert.deepEqual(rollChoices(almost), ['hp']);
  assert.equal(xpToNext(1), 50);
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
  assert.equal(bear.hp, 150);
  assert.ok(bear.spd < 1);
  // 올빼미는 기본 사거리 밖(7.5m)을 맞힌다
  place(owl, 0, 0, 0);
  place(bear, 0, 7.5, 0);
  place(bad, 20, 20, 0);
  game.attack(owl);
  assert.equal(bear.hp, 150 - Math.round(PROGRESS.BASE_DAMAGE * 1.1));
  assert.ok(Object.values(CHARACTERS).every((c) => c.name && c.desc && c.price >= 0));
});

test('캐릭터: 그림자는 구르면 잠깐 안 보이고, 반디는 경험치를 더 받는다', () => {
  const { game, place } = setup();
  const ninja = game.addPlayer('N', () => {}, false, 'ninja');
  const col = game.addPlayer('C', () => {}, false, 'collector');
  place(ninja, 0, 6, Math.PI);
  place(col, 0, 0, 0);
  assert.equal(game.computeVisibility().get(col.team).has(ninja.id), true);
  game.queueInput(ninja.id, [1, 0, 0, Math.PI, 0, 1, 0]);
  game.step();
  assert.ok(ninja.cloakT > 1);
  assert.equal(game.computeVisibility().get(col.team).has(ninja.id), false);
  game.gainXp(col, 20);
  assert.equal(col.xp, 25);
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
