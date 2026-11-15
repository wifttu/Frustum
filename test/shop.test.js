import test from 'node:test';
import assert from 'node:assert/strict';
import { DAILY, GACHA, SKINS, TIERS, claimDaily, gacha, newProfile, normalizeProfile, rollOnce } from '../shared/shop.js';
import { CHARACTERS } from '../shared/progress.js';

const seeded = (seed) => () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

test('뽑기: 확률의 합은 1이고, 코인이 모자라면 뽑을 수 없다', () => {
  assert.ok(Math.abs(Object.values(TIERS).reduce((a, t) => a + t.p, 0) - 1) < 1e-9);
  const p = newProfile();
  p.coins = 50;
  assert.equal(gacha(p, 1), null);
  assert.equal(p.coins, 50);
});

test('뽑기: 비용을 내고 결과가 프로필에 반영된다', () => {
  const p = newProfile();
  p.coins = 1000;
  const r = gacha(p, 10, seeded(5));
  assert.equal(r.length, 10);
  let coinsBack = 0;
  for (const x of r) {
    if (x.kind === 'coins') coinsBack += x.coins;
    if (x.kind === 'skin') assert.ok(p.skins.includes(x.id));
    if (x.kind === 'char') assert.ok(p.owned.includes(x.id));
  }
  assert.equal(p.coins, 1000 - GACHA.COST10 + coinsBack);
});

test('뽑기: 천장 — 10회 안에 영웅 이상이 반드시 나온다', () => {
  const p = newProfile();
  const tiers = [];
  for (let i = 0; i < GACHA.PITY; i++) tiers.push(rollOnce(p, () => 0.1).tier); // 0.1 → 항상 일반
  assert.deepEqual(tiers.slice(0, 9), Array(9).fill('common'));
  assert.equal(tiers[9], 'epic');
  assert.equal(p.pity, 0);
});

test('뽑기: 같은 것을 두 번 주지 않고, 다 모으면 코인으로 돌려준다', () => {
  const p = newProfile();
  const rnd = seeded(11);
  for (let i = 0; i < 600; i++) rollOnce(p, rnd);
  assert.equal(new Set(p.owned).size, p.owned.length);
  assert.equal(new Set(p.skins).size, p.skins.length);
  assert.equal(p.owned.length, Object.keys(CHARACTERS).length);
  assert.equal(p.skins.length, Object.keys(SKINS).length);
  const r = rollOnce(p, () => 0.999); // 전설
  assert.deepEqual([r.tier, r.kind, r.dup, r.coins], ['legend', 'coins', true, GACHA.DUP.legend]);
});

test('출석 보상: 하루 한 번, 연속 출석이면 늘어나고 끊기면 처음부터', () => {
  const p = newProfile();
  const d1 = new Date(2026, 10, 15, 9);
  assert.equal(claimDaily(p, d1), DAILY.BASE);
  assert.equal(claimDaily(p, new Date(2026, 10, 15, 23)), 0);
  assert.equal(claimDaily(p, new Date(2026, 10, 16, 8)), DAILY.BASE + DAILY.PER_STREAK);
  assert.equal(p.streak, 2);
  assert.equal(claimDaily(p, new Date(2026, 10, 19, 8)), DAILY.BASE);
  assert.equal(p.streak, 1);
});

test('프로필 정리: 손상되거나 오래된 저장 값도 안전하다', () => {
  const p = normalizeProfile({ coins: 'x', owned: ['bear', 'nope', 'bear'], char: 'ninja', skins: null, skin: 'gold', pity: 2.5 });
  assert.equal(p.coins, 0);
  assert.deepEqual(p.owned, ['explorer', 'bear']);
  assert.equal(p.char, 'explorer');
  assert.deepEqual(p.skins, ['default']);
  assert.equal(p.skin, 'default');
  assert.equal(p.pity, 0);
  assert.deepEqual(normalizeProfile(null), newProfile());
});
