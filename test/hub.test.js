// 친선 방, 초대, 접속 상태: 가짜 세션으로 서버 동작을 확인한다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Hub, PARTY_SLOTS, QUICK_CHAT, friendCode, teamOfSlot } from '../server/hub.js';
import { CFG } from '../shared/config.js';

let nextId = 1;
function session(hub, name, fc = '') {
  const s = { id: nextId++, box: [] };
  s.raw = (msg) => s.box.push(JSON.parse(msg));
  s.send = (obj) => s.box.push(JSON.parse(JSON.stringify(obj)));
  s.got = (t) => s.box.filter((m) => m.t === t).pop();
  s.all = (t) => s.box.filter((m) => m.t === t);
  hub.connect(s);
  hub.handle(s, { t: 'hi', n: name, c: 'explorer', s: 'default', i: '', fc });
  return s;
}
const later = (s) => Object.keys(s.last).forEach((k) => (s.last[k] = 0)); // 속도 제한 풀기 (테스트용)

test('방 만들기와 참가: 코드로 들어가고, 자리가 차례로 배정된다', () => {
  const hub = new Hub();
  const a = session(hub, 'Anna');
  const b = session(hub, 'Ben');
  hub.handle(a, { t: 'pcreate', set: { rule: 'survival', mode: 'ffa', map: 'lake', ai: false } });
  const st = a.got('p');
  assert.match(st.code, /^[A-Z0-9]{5}$/);
  assert.equal(st.host, a.id);
  assert.deepEqual(st.set, { rule: 'survival', mode: 'ffa', map: 'lake', ai: false });
  hub.handle(b, { t: 'pjoin', code: st.code.toLowerCase() });
  const st2 = b.got('p');
  assert.deepEqual(st2.members.map((m) => [m.name, m.slot]), [['Anna', 0], ['Ben', 1]]);
  assert.equal(a.got('p').members.length, 2, '방장도 새 상태를 받는다');
  hub.handle(b, { t: 'pjoin', code: 'ZZZZZ' });
  assert.match(b.got('perr').msg, /찾을 수 없/);
});

test('방이 가득 차면 더 들어갈 수 없다', () => {
  const hub = new Hub();
  const host = session(hub, 'H');
  hub.handle(host, { t: 'pcreate' });
  const code = host.got('p').code;
  for (let i = 1; i < PARTY_SLOTS; i++) hub.handle(session(hub, `P${i}`), { t: 'pjoin', code });
  const late = session(hub, 'Late');
  hub.handle(late, { t: 'pjoin', code });
  assert.match(late.got('perr').msg, /가득/);
});

test('방장만 설정을 바꾸고, 바꾸면 준비가 풀린다. 잘못된 값은 무시한다', () => {
  const hub = new Hub();
  const a = session(hub, 'A');
  const b = session(hub, 'B');
  hub.handle(a, { t: 'pcreate' });
  hub.handle(b, { t: 'pjoin', code: a.got('p').code });
  hub.handle(b, { t: 'pready' });
  assert.equal(b.got('p').members[1].ready, true);
  hub.handle(b, { t: 'pset', set: { rule: 'score' } });
  assert.equal(a.got('p').set.rule, 'dm', '방장이 아니면 무시');
  hub.handle(a, { t: 'pset', set: { rule: 'score', mode: '__proto__', map: 'nowhere', ai: 'yes' } });
  const st = a.got('p');
  assert.deepEqual(st.set, { rule: 'score', mode: 'duo', map: '', ai: true });
  assert.equal(st.members[1].ready, false);
});

test('자리 옮기기, 내보내기, 방장이 나가면 다음 사람이 방장', () => {
  const hub = new Hub();
  const a = session(hub, 'A');
  const b = session(hub, 'B');
  const c = session(hub, 'C');
  hub.handle(a, { t: 'pcreate' });
  const code = a.got('p').code;
  hub.handle(b, { t: 'pjoin', code });
  hub.handle(c, { t: 'pjoin', code });
  hub.handle(b, { t: 'pmove', slot: 0 });
  assert.equal(b.got('p').members.find((m) => m.name === 'B').slot, 1, '찬 자리로는 못 간다');
  hub.handle(b, { t: 'pmove', slot: 5 });
  assert.equal(b.got('p').members.find((m) => m.name === 'B').slot, 5);
  hub.handle(b, { t: 'pkick', sid: c.id });
  assert.equal(a.got('p').members.length, 3, '방장이 아니면 못 내보낸다');
  hub.handle(a, { t: 'pkick', sid: c.id });
  assert.equal(c.got('pgone').kicked, true);
  assert.equal(c.party, null);
  hub.handle(a, { t: 'pleave' });
  assert.equal(b.got('p').host, b.id);
  assert.equal(b.got('p').members.length, 1);
  hub.handle(b, { t: 'pleave' });
  assert.equal(hub.parties.size, 0, '빈 방은 사라진다');
});

test('시작: 모두 준비해야 하고, 자리대로 팀이 정해지며, AI 를 끄면 사람만 들어간다', () => {
  const hub = new Hub();
  const a = session(hub, 'A');
  const b = session(hub, 'B');
  const c = session(hub, 'C');
  hub.handle(a, { t: 'pcreate', set: { mode: 'duo', ai: false, map: 'forest' } });
  const code = a.got('p').code;
  hub.handle(b, { t: 'pjoin', code });
  hub.handle(c, { t: 'pjoin', code });
  hub.handle(c, { t: 'pmove', slot: 4 });
  hub.handle(a, { t: 'pstart' });
  assert.match(a.got('perr').msg, /준비/);
  hub.handle(b, { t: 'pready' });
  hub.handle(c, { t: 'pready' });
  hub.handle(a, { t: 'pstart' });
  for (const s of [a, b, c]) assert.ok(s.got('w'), '모두 게임에 들어간다');
  const g = a.game;
  assert.equal(g, b.game);
  assert.equal(g.players.size, 3, 'AI 없음');
  assert.equal(g.map.id, 'forest');
  assert.equal(a.player.team, b.player.team, '0, 1번 자리는 같은 팀');
  assert.equal(c.player.team, teamOfSlot('duo', 4));
  assert.notEqual(a.player.team, c.player.team);
  assert.equal(a.got('w').party, code);
  assert.equal(a.got('p').playing, 3);
  assert.ok([...hub.games()].includes(g), '틱 대상에 들어간다');
});

test('AI 를 켜면 빈자리를 채우고, 늦게 온 사람은 내 팀 AI 자리를 이어받는다', () => {
  const hub = new Hub();
  const a = session(hub, 'A');
  hub.handle(a, { t: 'pcreate', set: { mode: 'duo', ai: true } });
  hub.handle(a, { t: 'pstart' });
  const g = a.game;
  assert.equal(g.players.size, CFG.BOT_FILL);
  const b = session(hub, 'B');
  hub.handle(b, { t: 'pjoin', code: a.party.code });
  assert.equal(b.player, null, '들어오기만 하면 방에서 기다린다');
  hub.handle(b, { t: 'pplay' });
  assert.equal(b.game, g);
  assert.equal(b.player.team, teamOfSlot('duo', 1));
  assert.equal(b.player.team, a.player.team);
  assert.equal(g.players.size, CFG.BOT_FILL, '전체 인원은 그대로');
});

test('혼자서 AI 를 끄고는 시작할 수 없다', () => {
  const hub = new Hub();
  const a = session(hub, 'A');
  hub.handle(a, { t: 'pcreate', set: { ai: false } });
  hub.handle(a, { t: 'pstart' });
  assert.match(a.got('perr').msg, /AI/);
  assert.equal(a.game, null);
});

test('게임에서 나오면 방으로 돌아오고, 모두 나오면 친선 게임이 끝난다', () => {
  const hub = new Hub();
  const a = session(hub, 'A');
  const b = session(hub, 'B');
  hub.handle(a, { t: 'pcreate' });
  hub.handle(b, { t: 'pjoin', code: a.party.code });
  hub.handle(b, { t: 'pready' });
  hub.handle(a, { t: 'pstart' });
  const p = a.party;
  hub.handle(a, { t: 'leave' });
  assert.ok(a.got('left'));
  assert.equal(a.party, p, '방에는 남아 있다');
  assert.ok(p.game, '아직 B 가 하는 중');
  hub.handle(b, { t: 'leave' });
  assert.equal(p.game, null);
  assert.equal([...hub.games()].length, 0);
});

test('빠른 채팅은 정해진 문구 번호만, 너무 자주는 못 보낸다', () => {
  const hub = new Hub();
  const a = session(hub, 'A');
  const b = session(hub, 'B');
  hub.handle(a, { t: 'pcreate' });
  hub.handle(b, { t: 'pjoin', code: a.party.code });
  hub.handle(a, { t: 'pchat', i: 3 });
  hub.handle(a, { t: 'pchat', i: 4 });
  hub.handle(a, { t: 'pchat', i: 999 });
  const msgs = b.all('pmsg').filter((m) => m.sid === a.id);
  assert.deepEqual(msgs.map((m) => m.i), [3]);
  assert.ok(QUICK_CHAT[3]);
});

test('친구 접속 상태와 초대', () => {
  const hub = new Hub();
  const a = session(hub, 'Anna', 'AAAAAA');
  const b = session(hub, 'Ben', 'BBBBBB');
  hub.handle(a, { t: 'fs', codes: ['bbbbbb', 'CCCCCC', 'bad', 42] });
  assert.deepEqual(a.got('fs').st, { BBBBBB: { s: 'online', n: 'Ben' }, CCCCCC: { s: 'off' } });
  hub.handle(a, { t: 'inv', to: 'BBBBBB' });
  assert.match(a.got('perr').msg, /방/, '방이 있어야 초대한다');
  hub.handle(a, { t: 'pcreate' });
  later(a);
  hub.handle(a, { t: 'inv', to: 'BBBBBB' });
  const inv = b.got('inv');
  assert.deepEqual([inv.from, inv.code, inv.n], ['Anna', a.party.code, 1]);
  assert.equal(a.got('invr').ok, true);
  later(a);
  hub.handle(a, { t: 'inv', to: 'CCCCCC' });
  assert.equal(a.got('invr').ok, false, '접속하지 않은 친구');
  later(a);
  hub.handle(a, { t: 'fs', codes: ['AAAAAA'] });
  assert.equal(a.got('fs').st.AAAAAA.s, 'party');
  hub.disconnect(b);
  later(a);
  hub.handle(a, { t: 'fs', codes: ['BBBBBB'] });
  assert.equal(a.got('fs').st.BBBBBB.s, 'off');
});

test('입력 검증: 이름, 친구 코드, 아이콘', () => {
  assert.equal(friendCode('ab12cd'), 'AB12CD');
  for (const bad of ['abc', 'ABCDEFG', '__proto__', null, 7]) assert.equal(friendCode(bad), '');
  const hub = new Hub();
  const a = session(hub, '<b>Hi</b>!!');
  hub.handle(a, { t: 'hi', i: '<img>', c: 'constructor', s: 'toString' });
  assert.deepEqual(a.prof, { name: 'bHib', char: 'explorer', skin: 'default', icon: '' });
});

test('빠른 매칭은 방을 떠나고 공개 방에 들어간다', () => {
  const hub = new Hub();
  const a = session(hub, 'A');
  hub.handle(a, { t: 'pcreate' });
  hub.handle(a, { t: 'j', r: 'dm', m: 'ffa' });
  assert.equal(a.party, null);
  assert.ok(a.got('pgone'));
  assert.equal(a.game, hub.rooms.find({ rule: 'dm', mode: 'ffa' }));
  hub.disconnect(a);
  assert.equal(hub.rooms.find({ rule: 'dm', mode: 'ffa' }).humanCount, 0);
});

test('친선 방 3 대 3: 세 칸씩 한 팀, 모닥불 점령은 6자리', async () => {
  const { teamOfSlot, slotsOf } = await import('../server/hub.js');
  assert.deepEqual([0, 1, 2, 3, 4, 5].map((i) => teamOfSlot('squad', i)), [1, 1, 1, 2, 2, 2]);
  assert.equal(slotsOf({ rule: 'hill', mode: 'ffa' }), 6);
  assert.equal(slotsOf({ rule: 'dm', mode: 'duo' }), 8);
});

test('프로필: 아이콘 배경은 방 사람들에게 보이고, 강화 단계는 게임 능력치에 들어간다', () => {
  const hub = new Hub();
  const a = session(hub, 'A');
  const b = session(hub, 'B');
  hub.handle(a, { t: 'hi', b: 'aurora', cl: 3 });
  hub.handle(b, { t: 'hi', b: '__proto__', cl: 99 });
  assert.equal(a.prof.bg, 'aurora');
  assert.equal(b.prof.bg, '', '없는 배경');
  assert.equal(b.prof.clv, 5, '최대 5단계');
  hub.handle(a, { t: 'pcreate' });
  hub.handle(b, { t: 'pjoin', code: a.got('p').code });
  assert.deepEqual(b.got('p').members.map((m) => m.bg), ['aurora', '']);
  // 빠른 매칭: 강화 단계만큼 체력이 많다
  const c = session(hub, 'C');
  const d = session(hub, 'D');
  hub.handle(c, { t: 'j', r: 'dm', m: 'ffa', cl: 5 });
  hub.handle(d, { t: 'j', r: 'dm', m: 'ffa', cl: 0 });
  assert.ok(c.player && d.player);
  assert.ok(c.player.stats.maxHp > d.player.stats.maxHp);
});
