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
  assert.ok(list.find((x) => x.icon === '👑' && x.locked));
  assert.equal(normalizeProfile({ icon: '👑' }).icon, '', '잠긴 아이콘은 초기화');
  assert.equal(normalizeProfile({ icon: '👑', skins: ['gold'] }).icon, '👑');
  assert.equal(normalizeProfile({ icon: '<b>' }).icon, '');
  assert.equal(new Set(list.map((x) => x.icon)).size, list.length, '아이콘이 겹치지 않는다');
});
