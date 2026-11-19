import test from 'node:test';
import assert from 'node:assert/strict';
import { DAILY_POOL, achState, applyRank, claimAch, claimDaily, dailyFor, ensureDaily, hasClaimable, rankDelta, rankOf, record, seasonRollover } from '../shared/missions.js';
import { normalizeProfile } from '../shared/shop.js';

const fresh = () => normalizeProfile(null);

test('일일 미션: 날짜마다 같은 3개, 종류가 겹치지 않는다', () => {
  const a = dailyFor('2026-11-19');
  assert.deepEqual(a, dailyFor('2026-11-19'));
  assert.equal(a.length, 3);
  assert.equal(new Set(a.map((id) => DAILY_POOL[id].ev)).size, 3);
  const days = new Set(Array.from({ length: 10 }, (_, i) => dailyFor(`2026-11-${i + 1}`).join()));
  assert.ok(days.size > 3, '날마다 미션이 바뀐다');
});

test('일일 미션: 기록하면 채워지고, 다 채우면 한 번만 보상', () => {
  const p = fresh();
  const now = new Date(2026, 10, 19);
  const m = ensureDaily(p, now);
  const i = 0;
  const d = DAILY_POOL[m.list[i].id];
  const before = p.coins;
  assert.equal(claimDaily(p, i, now), 0);
  const done = record(p, d.ev, d.goal, now);
  assert.ok(done.includes(d));
  assert.ok(hasClaimable(p, now));
  assert.equal(claimDaily(p, i, now), d.coins);
  assert.equal(claimDaily(p, i, now), 0);
  assert.equal(p.coins, before + d.coins);
  // 다음 날이면 새 미션
  ensureDaily(p, new Date(2026, 10, 20));
  assert.ok(p.missions.list.every((it) => it.n === 0 && !it.got));
});

test('업적: 단계마다 차례로 받는다, 최고 레벨은 최댓값으로 기록', () => {
  const p = fresh();
  record(p, 'kill', 12);
  let s = achState(p, 'kills');
  assert.equal(s.reached, 1);
  assert.ok(s.claimable);
  assert.equal(claimAch(p, 'kills'), 100);
  assert.equal(claimAch(p, 'kills'), 0);
  record(p, 'level', 9);
  record(p, 'level', 5);
  assert.equal(p.stats.maxLevel, 9);
  assert.equal(achState(p, 'level').reached, 1);
});

test('랭크: 순위로 점수가 바뀌고, 봇전은 절반, 등급이 오른다', () => {
  assert.ok(rankDelta(1, 8, 3, true) > rankDelta(8, 8, 0, true));
  assert.equal(rankDelta(1, 8, 0, true), 30);
  assert.equal(rankDelta(8, 8, 0, true), -9);
  assert.equal(rankDelta(1, 8, 0, false), 15);
  assert.equal(rankDelta(1, 1, 5, true), 0);
  const p = fresh();
  const now = new Date(2026, 10, 19);
  let r = applyRank(p, 190, now);
  assert.equal(r.after.name, '브론즈');
  r = applyRank(p, 20, now);
  assert.ok(r.up);
  assert.equal(rankOf(p.rank.rp).name, '실버');
  applyRank(p, -9999, now);
  assert.equal(p.rank.rp, 0);
});

test('랭크: 시즌이 바뀌면 지난 등급 보상을 주고 점수가 절반이 된다', () => {
  const p = fresh();
  applyRank(p, 600, new Date(2026, 10, 19)); // 골드
  const coins = p.coins;
  const got = seasonRollover(p, new Date(2026, 11, 1));
  assert.deepEqual(got, { coins: 350, rank: '골드' });
  assert.equal(p.coins, coins + 350);
  assert.equal(p.rank.rp, 300);
  assert.equal(seasonRollover(p, new Date(2026, 11, 5)), null);
});

test('저장 데이터 정리: 이상한 값은 버린다', () => {
  const p = normalizeProfile({ stats: { kills: -5, wins: 'x', big: 3.7 }, ach: { kills: 99 }, rank: { rp: -1 }, missions: { day: 'd', list: [{ id: 'nope' }, { id: 'kill5', n: 2 }] } });
  assert.equal(p.stats.kills, 0);
  assert.equal(p.stats.big, 3);
  assert.equal(p.ach.kills, 4);
  assert.equal(p.rank.rp, 0);
  assert.deepEqual(p.missions.list, [{ id: 'kill5', n: 2, got: false }]);
});
