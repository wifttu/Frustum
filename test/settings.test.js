import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeServer } from '../client/settings.js';
import { iconsFor, newProfile, normalizeProfile } from '../shared/shop.js';

test('서버 주소: 여러 형태를 받아 https 주소로 정리한다', () => {
  for (const v of ['frustum.onrender.com', ' https://frustum.onrender.com/ ', 'wss://frustum.onrender.com/ws', 'HTTPS://frustum.onrender.com/abc?x=1'])
    assert.equal(normalizeServer(v), 'https://frustum.onrender.com');
  assert.equal(normalizeServer('http://192.168.0.5:3000'), 'http://192.168.0.5:3000');
  assert.equal(normalizeServer('localhost:3000'), 'https://localhost:3000');
  for (const bad of ['', '   ', 'javascript:alert(1)', 'not a url', 'https://user:pw@evil.com', null, undefined]) assert.equal(normalizeServer(bad), '');
});

test('프로필 아이콘: 가진 캐릭터/의상의 아이콘만 쓸 수 있다', () => {
  const p = newProfile();
  const list = iconsFor(p);
  assert.ok(list.find((x) => x.icon === '🔦' && !x.locked));
  assert.ok(list.find((x) => x.icon === '🐻' && x.locked));
  assert.ok(list.find((x) => x.icon === 's:bear_knight' && x.locked));
  assert.equal(normalizeProfile({ icon: 's:bear_knight' }).icon, '', '잠긴 아이콘은 초기화');
  assert.equal(normalizeProfile({ icon: 's:bear_knight', skins: ['bear_knight'] }).icon, 's:bear_knight');
  // 예전 공용 의상 아이콘(👑)을 쓰고 있었으면 바뀐 새 의상의 아이콘으로
  const old = normalizeProfile({ icon: '👑', skins: ['gold'] });
  assert.equal(old.icon, `s:${old.skins.find((id) => id !== 'default')}`);
  assert.equal(normalizeProfile({ icon: '<b>' }).icon, '');
  assert.equal(new Set(list.map((x) => x.icon)).size, list.length, '아이콘이 겹치지 않는다');
});
