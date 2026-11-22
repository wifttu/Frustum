import test from 'node:test';
import assert from 'node:assert/strict';
import { DAILY, GACHA, SKINS, SKIN_ICONS, TIERS, claimDaily, gacha, newProfile, normalizeProfile, rollOnce, skinFor, skinsOf } from '../shared/shop.js';
import { CHARACTER_KEYS } from '../shared/progress.js';
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

test('친구 목록: 예전 이름 목록도 옮기고, 같은 친구 코드는 하나로', () => {
  const p = normalizeProfile({
    friends: ['민수', { name: 'Jay', fc: 'ABC123' }, { name: 'Jay2', fc: 'ABC123' }, { name: '', fc: 'ZZZ999' }, 5, null],
    fc: 'bad',
  });
  assert.deepEqual(p.friends, [{ name: '민수', fc: '' }, { name: 'Jay', fc: 'ABC123' }]);
  assert.equal(p.fc, '');
  assert.equal(normalizeProfile({ fc: 'QWE234' }).fc, 'QWE234');
});

test('의상: 캐릭터마다 희귀·영웅·전설 한 벌씩, 다른 캐릭터의 의상은 입지 않는다', () => {
  for (const c of CHARACTER_KEYS) {
    const list = skinsOf(c);
    assert.deepEqual(list.map((id) => SKINS[id].tier), ['rare', 'epic', 'legend'], c);
    for (const id of list) {
      assert.equal(skinFor(c, id), id);
      assert.ok(SKIN_ICONS[id]);
    }
  }
  assert.equal(Object.keys(SKINS).length, 1 + CHARACTER_KEYS.length * 3);
  assert.equal(skinFor('owl', 'bear_panda'), 'default');
  assert.equal(skinFor('owl', 'nope'), 'default');
  assert.equal(skinFor('owl', 'default'), 'default');
});

test('의상: 캐릭터마다 입은 의상을 따로 기억한다', () => {
  const p = normalizeProfile({
    owned: ['explorer', 'bear', 'owl'], char: 'bear', skins: ['default', 'bear_panda', 'owl_snow'],
    skinBy: { bear: 'bear_panda', owl: 'bear_panda', explorer: 'explorer_astro', ninja: 'x' },
  });
  assert.deepEqual(p.skinBy, { bear: 'bear_panda' }, '안 맞거나 없는 의상은 지운다');
  assert.equal(p.skin, 'bear_panda');
  // 예전 형식: skin 하나만 있던 저장 데이터
  const q = normalizeProfile({ owned: ['explorer', 'owl'], char: 'owl', skins: ['default', 'owl_snow'], skin: 'owl_snow' });
  assert.deepEqual(q.skinBy, { owl: 'owl_snow' });
  assert.equal(q.skin, 'owl_snow');
});

test('의상: 예전 공용 의상은 같은 등급의 캐릭터별 의상으로 바뀐다 (지금 캐릭터 먼저)', () => {
  const p = normalizeProfile({ owned: ['explorer', 'owl'], char: 'owl', skins: ['default', 'gold', 'strawberry', 'night'], skin: 'gold', coins: 0 });
  assert.ok(!p.skins.includes('gold'));
  assert.ok(p.skins.includes('owl_wizard') && p.skins.includes('owl_snow') && p.skins.includes('owl_detective'));
  assert.equal(p.skins.length, 4);
  assert.match(p.legacyNote, /3개/);
  assert.equal(p.skin, 'owl_wizard', '입고 있던 예전 의상(전설)은 바뀐 새 의상으로 입혀 준다');
  // 바꿀 의상이 남지 않으면 코인으로 돌려준다
  const all = Object.keys(SKINS).filter((id) => SKINS[id].tier === 'legend');
  const q = normalizeProfile({ skins: ['default', ...all, 'gold'], coins: 0 });
  assert.equal(q.coins, GACHA.DUP.legend);
  // 이미 옮긴 데이터를 다시 정리해도 그대로
  const again = normalizeProfile(JSON.parse(JSON.stringify({ ...p, legacyNote: undefined })));
  assert.deepEqual(again.skins, p.skins);
  assert.equal(again.legacyNote, undefined);
});

test('뽑기: 가진 캐릭터의 의상이 더 잘 나온다', () => {
  let mine = 0;
  let other = 0;
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 3000; i++) {
    const p = normalizeProfile({ owned: ['explorer', 'owl'], char: 'owl', coins: 1e6 });
    const r = rollOnce(p, rnd);
    if (r.kind !== 'skin') continue;
    if (['explorer', 'owl'].includes(SKINS[r.id].char)) mine++;
    else other++;
  }
  // 7명 중 2명을 가졌으니 무게가 같다면 2/7 ≈ 29%, 세 배면 6/11 ≈ 55%
  assert.ok(mine / (mine + other) > 0.45, `${mine}/${mine + other}`);
});

test('전설 의상: 모두 전용 효과(빛 색, 처치 이펙트)와 설명이 있다', async () => {
  const { LEGEND } = await import('../client/legend.js');
  const legends = Object.keys(SKINS).filter((id) => SKINS[id].tier === 'legend');
  assert.equal(legends.length, CHARACTER_KEYS.length);
  for (const id of legends) {
    assert.ok(SKINS[id].fx, id);
    assert.equal(typeof LEGEND[id]?.beam, 'number', id);
    assert.equal(typeof LEGEND[id]?.kill, 'function', id);
  }
  assert.deepEqual(Object.keys(LEGEND).sort(), legends.sort(), '전설이 아닌 의상에는 효과가 없다');
});

test('의상 얻는 길: 업적 2단계는 희귀, 4단계는 영웅 의상 (이미 있으면 코인)', async () => {
  const { ACHIEVEMENTS, ACH_SKIN_COINS, achState, claimAch } = await import('../shared/missions.js');
  // 업적마다 다른 캐릭터의 희귀·영웅 의상 → 14벌 모두 얻을 수 있다
  const all = Object.values(ACHIEVEMENTS).flatMap((a) => [a.skins[2], a.skins[4]]);
  assert.equal(new Set(all).size, 14);
  for (const a of Object.values(ACHIEVEMENTS)) {
    assert.equal(SKINS[a.skins[2]].tier, 'rare');
    assert.equal(SKINS[a.skins[4]].tier, 'epic');
    assert.equal(SKINS[a.skins[2]].char, SKINS[a.skins[4]].char);
  }
  const p = normalizeProfile({ stats: { kills: 60 }, coins: 0 });
  assert.equal(achState(p, 'kills').skin, null, '1단계는 코인만');
  assert.equal(claimAch(p, 'kills'), 100);
  assert.equal(achState(p, 'kills').skin, 'ninja_fox');
  assert.equal(claimAch(p, 'kills'), 250);
  assert.ok(p.skins.includes('ninja_fox'));
  // 이미 가진 의상이면 대신 코인
  const q = normalizeProfile({ stats: { kills: 60 }, ach: { kills: 1 }, skins: ['default', 'ninja_fox'], coins: 0 });
  assert.equal(claimAch(q, 'kills'), 250 + ACH_SKIN_COINS);
});

test('의상 얻는 길: 시즌에 골드·플래티넘·다이아에 닿으면 희귀·영웅·전설 의상 (지금 캐릭터 먼저, 시즌마다 다시)', async () => {
  const { claimRankSkin } = await import('../shared/shop.js');
  const { rankSkinList, seasonRollover, hasClaimable } = await import('../shared/missions.js');
  const now = new Date(2026, 10, 20);
  const p = normalizeProfile({ owned: ['explorer', 'owl'], char: 'owl', rank: { season: '2026-11', rp: 950, best: 950 }, coins: 0 });
  const list = rankSkinList(p);
  assert.deepEqual(list.map((r) => [r.i, r.tier, r.claimable]), [[2, 'rare', true], [3, 'epic', true], [4, 'legend', false]]);
  assert.ok(hasClaimable(p, now));
  assert.deepEqual(claimRankSkin(p, 2), { skin: 'owl_snow' });
  assert.deepEqual(claimRankSkin(p, 3), { skin: 'owl_detective' });
  assert.equal(claimRankSkin(p, 3), null, '한 시즌에 한 번');
  assert.equal(claimRankSkin(p, 4), null, '다이아에 닿아야');
  // 저장했다 불러와도 받은 기록은 남는다
  assert.deepEqual(normalizeProfile(JSON.parse(JSON.stringify(p))).rank.got, [2, 3]);
  // 새 시즌이면 다시 받을 수 있다
  seasonRollover(p, new Date(2026, 11, 2));
  assert.deepEqual(p.rank.got, []);
  // 가질 의상이 없으면 코인
  const full = normalizeProfile({ skins: Object.keys(SKINS), rank: { season: '2026-11', rp: 600, best: 600 }, coins: 0 });
  assert.deepEqual(claimRankSkin(full, 2), { coins: GACHA.DUP.rare });
});

test('상점: 크리스탈 묶음 → 전설 의상·프로필 배경 (크리스탈), 저장했다 불러와도 남는다', async () => {
  const { GEM_PACKS, LEGEND_PRICE, PROFILE_BGS, addGems, buyBg, buyLegend, canUseBg } = await import('../shared/shop.js');
  const p = normalizeProfile({ owned: ['explorer', 'bear'], coins: 5000 });
  assert.equal(p.gems, 0);
  assert.equal(buyLegend(p, 'bear_knight'), false, '크리스탈이 없으면 못 산다');
  assert.equal(addGems(p, 'nope'), 0);
  const big = GEM_PACKS.at(-1);
  assert.equal(addGems(p, big.id), big.gems + big.bonus, '보너스까지');
  assert.equal(buyLegend(p, 'bear_panda'), false, '전설 의상만 판다');
  assert.equal(buyLegend(p, 'bear_knight'), true);
  assert.equal(p.gems, big.gems + big.bonus - LEGEND_PRICE);
  assert.ok(p.skins.includes('bear_knight'));
  assert.equal(buyLegend(p, 'bear_knight'), false, '이미 가진 의상');
  assert.equal(p.coins, 5000, '코인은 그대로');
  // 배경: 무료는 그냥 쓰고, 크리스탈 배경은 사야 쓴다
  assert.ok(canUseBg(p, 'night') && canUseBg(p, 'camp') && canUseBg(p, ''));
  assert.ok(!canUseBg(p, 'aurora'));
  assert.equal(buyBg(p, 'night'), false, '무료 배경은 사지 않는다');
  const g = p.gems;
  assert.equal(buyBg(p, 'aurora'), true);
  assert.equal(p.gems, g - PROFILE_BGS.aurora.gems);
  assert.ok(canUseBg(p, 'aurora'));
  p.bg = 'aurora';
  const q = normalizeProfile(JSON.parse(JSON.stringify(p)));
  assert.equal(q.gems, p.gems);
  assert.deepEqual(q.bgs, ['aurora']);
  assert.equal(q.bg, 'aurora');
  // 손상된 값: 사지 않은 배경, 이상한 크리스탈
  const bad = normalizeProfile({ gems: -5, bg: 'galaxy', bgs: ['galaxy', 'night', 'x'] });
  assert.equal(bad.gems, 0);
  assert.deepEqual(bad.bgs, ['galaxy']);
  assert.equal(bad.bg, 'galaxy');
  assert.equal(normalizeProfile({ bg: 'royal' }).bg, '', '사지 않은 배경은 기본으로');
  assert.equal(normalizeProfile({ gems: 12.7 }).gems, 12);
});

test('상점: 캐릭터 강화는 코인으로, 가진 캐릭터만, 최대 5단계 → 체력·피해가 오른다', async () => {
  const { upgradeChar, upgradeCost } = await import('../shared/shop.js');
  const { CHAR_UP, statsOf } = await import('../shared/progress.js');
  const p = normalizeProfile({ owned: ['explorer'], coins: 99999, gems: 999 });
  assert.equal(upgradeChar(p, 'bear'), 0, '없는 캐릭터');
  for (let i = 1; i <= CHAR_UP.MAX; i++) assert.equal(upgradeChar(p, 'explorer'), i);
  assert.equal(upgradeChar(p, 'explorer'), 0, '최대');
  assert.equal(upgradeCost(p, 'explorer'), null);
  assert.equal(p.coins, 99999 - CHAR_UP.COST.reduce((a, b) => a + b, 0));
  assert.equal(p.gems, 999, '크리스탈은 쓰지 않는다');
  const poor = normalizeProfile({ coins: 10 });
  assert.equal(upgradeChar(poor, 'explorer'), 0, '코인이 모자라면');
  // 저장 값 정리: 0~5, 가진 캐릭터만
  const q = normalizeProfile({ owned: ['explorer'], clv: { explorer: 9, bear: 3, owl: 'x' } });
  assert.deepEqual(q.clv, { explorer: CHAR_UP.MAX });
  // 능력치
  const { CFG: cfg } = await import('../shared/config.js');
  const a = statsOf({}, cfg, 'explorer', 1, 0);
  const b = statsOf({}, cfg, 'explorer', 1, 5);
  assert.ok(b.maxHp > a.maxHp && b.damage > a.damage);
  assert.ok(Math.abs(b.damage / a.damage - (1 + 5 * CHAR_UP.DMG)) < 1e-9);
  assert.deepEqual(statsOf({}, cfg, 'explorer', 1, 99), statsOf({}, cfg, 'explorer', 1, 5), '5단계보다 세지지 않는다');
});
