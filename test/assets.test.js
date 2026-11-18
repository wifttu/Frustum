import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { MAPS } from '../shared/map.js';
import { CHARACTER_KEYS } from '../shared/progress.js';
import { FREE_ICONS, SKIN_ICONS } from '../shared/shop.js';

const img = path.resolve(import.meta.dirname, '../client/img');
const has = (p) => fs.existsSync(path.join(img, `${p}.webp`));

test('그림: 모든 맵·캐릭터·의상의 미리보기와 초상화가 있다', () => {
  for (const id of [...Object.keys(MAPS), 'auto']) assert.ok(has(`maps/${id}`), `maps/${id}`);
  for (const id of CHARACTER_KEYS) assert.ok(has(`chars/${id}`), `chars/${id}`);
  for (const id of Object.keys(SKIN_ICONS)) assert.ok(has(`skins/${id}`), `skins/${id}`);
});

test('그림: 기본 프로필 아이콘마다 그림이 있다', () => {
  const src = fs.readFileSync(path.resolve(import.meta.dirname, '../client/icons.js'), 'utf8');
  const free = JSON.parse(src.match(/const FREE = (\{[^}]+\})/)[1].replace(/'/g, '"'));
  for (const icon of FREE_ICONS) {
    assert.ok(free[icon], `${icon} 의 그림 이름`);
    assert.ok(has(`icons/${free[icon]}`), `icons/${free[icon]}`);
  }
});
