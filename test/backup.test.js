import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeBackup, encodeBackup } from '../shared/backup.js';
import { normalizeProfile } from '../shared/shop.js';

test('백업 코드: 프로필을 그대로 되살린다 (한글 이름·친구 포함)', () => {
  const p = normalizeProfile({ coins: 1234, xp: 5000, owned: ['explorer', 'owl'], char: 'owl', skins: ['default', 'gold'], skin: 'gold', friends: [{ name: '반디친구', fc: 'ABC123' }], fc: 'ZZZ999' });
  const code = encodeBackup(p);
  assert.match(code, /^FRU1\.[A-Za-z0-9_-]+\.[0-9a-z]{7}$/);
  const r = decodeBackup(`  ${code.slice(0, 20)}\n${code.slice(20)}  `); // 줄바꿈·공백이 섞여도 된다
  assert.ok(r);
  assert.equal(r.profile.coins, 1234);
  assert.deepEqual(r.profile.owned, ['explorer', 'owl']);
  assert.equal(r.profile.skin, 'gold');
  assert.equal(r.profile.friends[0].name, '반디친구');
  assert.equal(r.profile.fc, 'ZZZ999');
});

test('백업 코드: 한 글자라도 틀리거나 잘리면 복구하지 않는다', () => {
  const code = encodeBackup(normalizeProfile({ coins: 50 }));
  const i = 12;
  const broken = code.slice(0, i) + (code[i] === 'A' ? 'B' : 'A') + code.slice(i + 1);
  assert.equal(decodeBackup(broken), null);
  assert.equal(decodeBackup(code.slice(0, -3)), null);
  assert.equal(decodeBackup('아무 글자'), null);
  assert.equal(decodeBackup(''), null);
});
