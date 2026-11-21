// 최근 전적: 최근 10판, 손상된 값 정리, 요약
import test from 'node:test';
import assert from 'node:assert/strict';
import { HISTORY_MAX, addHistory, agoText, historySummary, normalizeHistory } from '../shared/history.js';
import { normalizeProfile } from '../shared/shop.js';

const game = (i, extra = {}) => ({ t: 1000 + i, r: 'dm', m: 'ffa', map: 'camp', w: i % 2 ? 1 : 0, pl: (i % 4) + 1, n: 8, k: i, lv: 3, ch: 'owl', sk: 'owl_wizard', rp: 10, ...extra });

test('최근 전적: 새 판이 맨 앞에, 최대 10판까지', () => {
  const p = normalizeProfile({});
  assert.deepEqual(p.history, []);
  for (let i = 0; i < 13; i++) addHistory(p, game(i));
  assert.equal(p.history.length, HISTORY_MAX);
  assert.equal(p.history[0].k, 12, '가장 최근 판이 맨 앞');
  assert.equal(p.history.at(-1).k, 3);
  // 저장했다 불러와도 그대로
  assert.deepEqual(normalizeProfile(JSON.parse(JSON.stringify(p))).history, p.history);
});

test('최근 전적: 손상되거나 모르는 값은 버리거나 고친다', () => {
  const list = normalizeHistory([null, 5, { r: 'nope' }, game(1, { pl: -3, k: 'x', map: 'mars', ch: 'dragon', w: 7, rp: 'a' }), game(2, { r: 'hill', c: 12.6 })]);
  assert.equal(list.length, 2);
  assert.equal(list[0].r, 'hill');
  assert.equal(list[0].c, 13);
  const bad = list[1];
  assert.equal(bad.pl, 1);
  assert.equal(bad.k, 0);
  assert.equal(bad.map, '');
  assert.equal(bad.ch, 'explorer');
  assert.equal(bad.w, 0);
  assert.equal(bad.rp, null);
  assert.deepEqual(normalizeHistory('abc'), []);
});

test('최근 전적: 요약(승률, 평균 순위, 최고 순위, 잡은 수)과 지난 시간', () => {
  const list = normalizeHistory([game(0, { w: 1, pl: 1, k: 4 }), game(1, { w: 0, pl: 3, k: 1 }), game(2, { w: -1, pl: 2, k: 0 }), game(3, { w: 1, pl: 1, k: 5 })]);
  assert.deepEqual(historySummary(list), { n: 4, wins: 2, rate: 50, avgPlace: 1.8, kills: 10, best: 1 });
  assert.deepEqual(historySummary([]), { n: 0, wins: 0, rate: 0, avgPlace: 0, kills: 0, best: 0 });
  const now = 10_000_000;
  assert.equal(agoText(now - 5_000, now), '방금');
  assert.equal(agoText(now - 5 * 60_000, now), '5분 전');
  assert.equal(agoText(now - 3 * 3_600_000, now), '3시간 전');
});
