// 영어 사전: 게임 데이터와 첫 화면(index.html)의 한국어가 모두 사전에 있어야 한다.
// 새 캐릭터·의상·맵·미션 등을 넣으면 client/lang-en.js 에도 영어를 넣어야 이 테스트가 통과한다.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { EN, EN_PATTERNS } from '../client/lang-en.js';
import { CHARACTERS, SKILLS, UPGRADES } from '../shared/progress.js';
import { ITEMS } from '../shared/config.js';
import { MAPS } from '../shared/map.js';
import { SKINS, TIERS } from '../shared/shop.js';
import { ACHIEVEMENTS, DAILY_POOL, RANKS } from '../shared/missions.js';

const KO = /[가-힣]/;

test('영어 사전: 게임 데이터의 이름과 설명이 모두 있다', () => {
  const need = [];
  for (const c of Object.values(CHARACTERS)) need.push(c.name, c.desc);
  for (const s of Object.values(SKILLS)) need.push(s.name, s.desc);
  for (const u of Object.values(UPGRADES)) need.push(u.name, u.desc);
  for (const it of Object.values(ITEMS)) need.push(it.name, it.desc);
  for (const m of Object.values(MAPS)) need.push(m.name);
  for (const s of Object.values(SKINS)) need.push(s.name, s.desc, s.fx);
  for (const t of Object.values(TIERS)) need.push(t.name);
  for (const d of Object.values(DAILY_POOL)) need.push(d.text);
  for (const a of Object.values(ACHIEVEMENTS)) need.push(a.name);
  for (const r of RANKS) need.push(r.name);
  const missing = need.filter((s) => s && KO.test(s) && !Object.hasOwn(EN, s));
  assert.deepEqual(missing, []);
});

test('영어 사전: 첫 화면(index.html)의 한국어 글과 안내 문구가 모두 있다', () => {
  const html = fs.readFileSync(new URL('../client/index.html', import.meta.url), 'utf8').replace(/<!--[\s\S]*?-->/g, '').replace(/<script[\s\S]*?<\/script>/g, '');
  const texts = [...html.matchAll(/>([^<>]*[가-힣][^<>]*)</g)].map((m) => m[1].trim());
  const attrs = [...html.matchAll(/(?:placeholder|aria-label|title)="([^"]*[가-힣][^"]*)"/g)].map((m) => m[1]);
  // 번역하지 않는 곳(translate="no")의 글은 빼고
  const skip = new Set(['🌐 언어 · Language', '한국어']);
  const patterns = EN_PATTERNS.map(([ko]) => new RegExp('^' + ko.split('{}').map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.+?') + '$'));
  const missing = [...texts, ...attrs].filter((s) => !skip.has(s) && !Object.hasOwn(EN, s) && !patterns.some((re) => re.test(s)));
  assert.deepEqual(missing, []);
});

test('영어 사전: 패턴의 자리 수가 맞고, 영어 쪽에 한국어가 없다', () => {
  for (const [ko, en] of EN_PATTERNS) {
    const n = ko.split('{}').length - 1;
    assert.ok(n > 0, ko);
    for (const [, i] of en.matchAll(/\{(\d)\}/g)) assert.ok(+i < n, `${ko} → ${en}`);
    assert.ok(!KO.test(en), en);
  }
  for (const [ko, en] of Object.entries(EN)) assert.ok(!KO.test(en), `${ko} → ${en}`);
});
