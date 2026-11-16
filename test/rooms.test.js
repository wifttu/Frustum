import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_PRIVATE_ROOMS, Rooms, roomCode } from '../server/rooms.js';

test('방 코드: 영문/숫자 4~6자만 인정한다', () => {
  assert.equal(roomCode('abcd'), 'ABCD');
  assert.equal(roomCode('A1B2C3'), 'A1B2C3');
  for (const bad of ['abc', 'toolong7', 'ab cd', '__proto__', 42, null, undefined]) assert.equal(roomCode(bad), '');
});

test('공개 방: 규칙 × 모드마다 하나, 잘못된 값은 기본 방으로', () => {
  const rooms = new Rooms();
  assert.equal([...rooms].length, 6);
  const g = rooms.find({ rule: 'dm', mode: 'ffa' });
  assert.equal(g, rooms.find({ rule: 'dm', mode: 'ffa', room: '??' }));
  assert.deepEqual([g.rule, g.mode], ['dm', 'ffa']);
  const d = rooms.find({ rule: 'constructor', mode: '__proto__' });
  assert.deepEqual([d.rule, d.mode], ['survival', 'duo']);
});

test('비공개 방: 같은 코드는 같은 방, 만든 사람의 설정을 따르고, 비면 사라진다', () => {
  const rooms = new Rooms();
  const a = rooms.find({ rule: 'score', mode: 'ffa', room: 'camp1', map: 'lake' });
  const b = rooms.find({ rule: 'dm', mode: 'duo', room: 'CAMP1', map: 'forest' });
  assert.equal(a, b);
  assert.deepEqual([a.rule, a.mode, a.map.id, a.room], ['score', 'ffa', 'lake', 'CAMP1']);
  assert.notEqual(a, rooms.find({ rule: 'score', mode: 'ffa' }));
  // 맵을 고정한 방은 라운드가 바뀌어도 같은 맵
  a.newRound();
  assert.equal(a.map.id, 'lake');
  const p = a.addPlayer('H', () => {});
  rooms.cleanup(a);
  assert.equal([...rooms].length, 7, '사람이 있으면 유지');
  a.removePlayer(p.id);
  rooms.cleanup(a);
  assert.equal([...rooms].length, 6);
});

test('비공개 방 수에는 상한이 있다', () => {
  const rooms = new Rooms();
  for (let i = 0; i < MAX_PRIVATE_ROOMS; i++) assert.ok(rooms.find({ room: `R${String(i).padStart(3, '0')}` }));
  assert.equal(rooms.find({ room: 'OVER1' }), null);
});

test('스킨: 서버는 목록에 있는 스킨만 받아 로스터에 싣는다', () => {
  const rooms = new Rooms();
  const g = rooms.find({ rule: 'dm', mode: 'ffa', room: 'SKIN1' });
  const a = g.addPlayer('A', () => {}, false, 'bear', 'gold');
  const b = g.addPlayer('B', () => {}, false, 'bear', 'toString');
  assert.equal(a.skin, 'gold');
  assert.equal(b.skin, 'default');
  assert.equal(g.roster().p.find((r) => r[0] === a.id)[8], 'gold');
});
