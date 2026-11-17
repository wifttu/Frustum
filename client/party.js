// 친선 게임 방, 친구(친구 코드·접속 상태·초대), 초대 알림.
// 서버와는 main.js 의 Net 연결 하나로 주고받는다. 계정이 없어서 친구 목록은 기기에 저장한다.
const RULE_NAMES = { dm: '데스매치', score: '점수제', survival: '서바이벌' };
const MODE_NAMES = { ffa: '개인전', duo: '2인 팀전' };
const STATE_TEXT = { online: '접속 중', party: '방에 있음', game: '게임 중', off: '오프라인' };
const SYS_TEXT = { join: '님이 들어왔어요', leave: '님이 나갔어요', kick: '님이 내보내졌어요' };
const cleanCode = (v, n) => String(v ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, n);
const el = (tag, cls, text) => Object.assign(document.createElement(tag), cls ? { className: cls } : {}, text !== undefined ? { textContent: text } : {});

export function initParty(ctx) {
  const { $, net, profile, saveProfile, sfx, CHARACTERS, MAPS } = ctx;
  let sid = 0; // 서버가 정해 준 내 세션 번호
  let chatLines = []; // 빠른 채팅 문구 (서버가 알려준다)
  let st = null; // 지금 있는 방의 상태
  let statuses = {}; // 친구 코드 → { s, n }
  let pollTimer = 0;
  let lastInvite = null;
  const bubbles = new Map(); // 세션 번호 → { text, until }
  const feed = [];

  const me = () => st?.members.find((m) => m.sid === sid);
  const isHost = () => st && st.host === sid;
  const toast = (msg) => ctx.status(msg);

  // ── 방 화면 ──
  function showRoom() {
    if (!st) return;
    ctx.hideLobby();
    $('room').hidden = false;
    drawRoom();
    startPolling();
  }
  function hideRoom() {
    $('room').hidden = true;
    $('chatPanel').hidden = true;
  }

  function slotCard(slot) {
    const m = st.members.find((x) => x.slot === slot);
    const card = el('button', 'slot');
    if (!m) {
      card.classList.add('empty');
      card.append(el('i', '', st.set.ai ? '🤖' : '＋'), el('b', '', st.set.ai ? 'AI' : '빈 자리'), el('span', '', me()?.slot === slot ? '' : '여기로 이동'));
      card.addEventListener('click', () => net.send({ t: 'pmove', slot }));
      return card;
    }
    const c = CHARACTERS[m.char] || CHARACTERS.explorer;
    if (m.sid === sid) card.classList.add('me');
    if (m.sid === st.host) card.classList.add('host');
    card.append(el('i', '', m.icon || c.icon), el('b', '', m.name), el('span', '', `${c.icon} ${c.name}`));
    const tag = m.sid === st.host ? '👑 방장' : m.inGame ? '🎮 게임 중' : m.ready ? '✅ 준비 완료' : '대기 중';
    card.append(el('em', m.ready || m.sid === st.host ? 'ok' : '', tag));
    const bubble = bubbles.get(m.sid);
    if (bubble && bubble.until > performance.now()) card.append(el('q', '', bubble.text));
    if (isHost() && m.sid !== sid) {
      const kick = el('s', '', '✕');
      kick.title = '내보내기';
      kick.addEventListener('click', (e) => {
        e.stopPropagation();
        if (confirm(`${m.name}님을 내보낼까요?`)) net.send({ t: 'pkick', sid: m.sid });
      });
      card.append(kick);
    }
    return card;
  }

  function drawRoom() {
    if (!st || $('room').hidden) return;
    $('roomCode').textContent = `방 코드 ${st.code}  📋`;
    const groups = st.set.mode === 'duo' ? [[0, 1], [2, 3], [4, 5], [6, 7]] : [[0, 1, 2, 3], [4, 5, 6, 7]];
    $('roomSlots').className = st.set.mode;
    $('roomSlots').replaceChildren(
      ...groups.map((g, i) => {
        const box = el('div', 'group');
        if (st.set.mode === 'duo') box.append(el('h4', '', `팀 ${i + 1}`));
        const row = el('div', 'row');
        row.append(...g.map(slotCard));
        box.append(row);
        return box;
      }),
    );
    // 설정 카드
    $('roomSetHint').textContent = isHost() ? '방장 · 눌러서 바꾸기 ›' : '방장이 정해요';
    $('roomSetText').textContent = `${RULE_NAMES[st.set.rule]} · ${MODE_NAMES[st.set.mode]}`;
    $('roomSetSub').textContent = `맵: ${st.set.map ? MAPS[st.set.map].name : '순환'} · ${st.set.ai ? '빈자리 AI' : '사람만'}`;
    // 큰 버튼: 방장은 시작, 나머지는 준비. 게임이 진행 중이면 참가.
    const btn = $('roomMain');
    const mine = me();
    let why = '';
    btn.className = '';
    if (st.playing && mine && !mine.inGame) {
      btn.textContent = '게임 참가';
      btn.dataset.act = 'play';
      why = '';
    } else if (isHost()) {
      btn.textContent = '시작';
      btn.dataset.act = 'start';
      if (st.playing) why = '게임이 진행 중이에요';
      else if (st.members.some((m) => m.sid !== st.host && !m.ready)) why = '모두 준비하면 시작할 수 있어요';
      else if (!st.set.ai && st.members.length < 2) why = '혼자서는 빈자리를 AI로 채워야 해요';
    } else {
      btn.textContent = mine?.ready ? '준비 취소' : '준비';
      btn.dataset.act = 'ready';
      if (mine?.ready) btn.className = 'ready';
    }
    btn.disabled = !!why;
    $('roomWhy').textContent = why || (btn.dataset.act === 'play' ? `${st.playing}명이 게임 중이에요` : st.members.length < 2 ? '친구를 초대해 보세요 →' : '');
    $('roomFeed').replaceChildren(...feed.slice(-4).map((line) => el('div', '', line)));
  }

  $('roomMain').addEventListener('click', () => {
    const act = $('roomMain').dataset.act;
    if (act === 'start') net.send({ t: 'pstart' });
    else if (act === 'ready') net.send({ t: 'pready' });
    else if (act === 'play') net.send({ t: 'pplay' });
    ctx.lockLandscape();
    sfx.choose();
  });
  $('roomSet').addEventListener('click', () => {
    if (isHost()) ctx.openRoomSettings(st.set, (set) => net.send({ t: 'pset', set }));
    else toast('설정은 방장이 바꿀 수 있어요');
  });
  $('roomLeave').addEventListener('click', () => net.send({ t: 'pleave' }));
  $('roomCode').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(st.code);
      addFeed('방 코드를 복사했어요');
    } catch {
      addFeed(`방 코드: ${st.code}`);
    }
    drawRoom();
  });
  $('roomLink').addEventListener('click', () => shareLink());
  $('roomFriends').addEventListener('click', () => openFriends());
  $('roomChars').addEventListener('click', () => ctx.openShop('chars'));
  $('roomChat').addEventListener('click', () => {
    const panel = $('chatPanel');
    panel.hidden = !panel.hidden;
    panel.replaceChildren(
      ...chatLines.map((text, i) => {
        const b = el('button', '', text);
        b.addEventListener('click', () => {
          net.send({ t: 'pchat', i });
          panel.hidden = true;
        });
        return b;
      }),
    );
  });

  async function shareLink() {
    if (!st) return;
    const u = new URL(location.href);
    u.search = '';
    u.searchParams.set('party', st.code);
    if (ctx.remote()) u.searchParams.set('server', ctx.remote());
    const text = `Frustum 친선 게임 같이 하자! 방 코드 ${st.code}`;
    try {
      if (navigator.share) await navigator.share({ title: 'Frustum', text, url: u.href });
      else {
        await navigator.clipboard.writeText(`${text} ${u.href}`);
        addFeed('초대 링크를 복사했어요. 친구에게 보내 주세요');
      }
    } catch {
      addFeed(u.href);
    }
    drawRoom();
  }

  function addFeed(line) {
    feed.push(line);
    if (feed.length > 20) feed.shift();
  }

  // ── 방 만들기 / 참가 ──
  // 서버가 방 기능을 아는 새 버전인지 확인한다. 새 서버는 'hi' 에 답하고, 예전 서버는 모르는 메시지를 무시한다.
  let hiOk = false;
  let hiWaiters = [];
  function waitHi(ms) {
    if (hiOk) return Promise.resolve(true);
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        hiWaiters = hiWaiters.filter((w) => w !== done);
        resolve(false);
      }, ms);
      const done = () => {
        clearTimeout(timer);
        resolve(true);
      };
      hiWaiters.push(done);
    });
  }
  // 온라인에 연결하고 새 버전 서버인지까지 확인한다. 안 되면 이유를 화면에 알린다.
  async function ready(msg) {
    toast(msg);
    if (!(await ctx.ensureOnline())) {
      toast('서버에 연결하지 못했어요. 서버 주소와 서버 상태를 확인해 주세요');
      return false;
    }
    ctx.hello();
    if (!(await waitHi(4000))) {
      toast('서버가 아직 예전 버전이라 친선 게임을 쓸 수 없어요. 서버를 최신 버전으로 다시 배포해야 해요');
      friendMsg('서버가 예전 버전이에요. Render 에서 최신 버전으로 다시 배포해 주세요');
      return false;
    }
    return true;
  }
  async function create() {
    if (!(await ready('방을 만드는 중…'))) return;
    const { rule, mode, map } = ctx.picks();
    net.send({ t: 'pcreate', set: { rule, mode, map, ai: true } });
  }
  async function join(code) {
    const c = cleanCode(code, 6);
    if (c.length < 4) return friendMsg('방 코드는 4~6자예요');
    if (!(await ready('방에 들어가는 중…'))) return;
    net.send({ t: 'pjoin', code: c });
  }

  // ── 친구 ──
  function friendMsg(text) {
    $('friendMsg').textContent = text;
  }
  function personRow(p, buttons) {
    const row = el('div', 'person');
    const s = p.fc ? statuses[p.fc]?.s || 'off' : 'none';
    row.append(el('i', `dot ${s}`), el('b', '', p.name), el('span', '', p.fc ? STATE_TEXT[s] || '' : '친구 코드 없음'));
    for (const [label, cls, onTap, disabled] of buttons) {
      const b = el('button', cls, label);
      b.disabled = !!disabled;
      b.addEventListener('click', onTap);
      row.append(b);
    }
    return row;
  }
  function drawFriends() {
    $('myFc').textContent = profile.fc;
    const inParty = !!st;
    const list = profile.friends.map((f) =>
      personRow(f, [
        ...(inParty ? [['초대', 'inv', () => net.send({ t: 'inv', to: f.fc }), !f.fc || (statuses[f.fc]?.s || 'off') === 'off']] : []),
        ['✕', 'del', () => {
          if (!confirm(`${f.name}님을 친구에서 뺄까요?`)) return;
          profile.friends = profile.friends.filter((x) => x !== f);
          saveProfile();
          drawFriends();
        }],
      ]),
    );
    $('friendList').replaceChildren(...(list.length ? list : [el('em', '', '친구 코드를 받아 추가하거나, 아래 최근 플레이어를 추가해 보세요.')]));
    const friendFcs = new Set(profile.friends.map((f) => f.fc).filter(Boolean));
    const recent = profile.recent
      .filter((r) => !(r.fc && friendFcs.has(r.fc)) && r.fc !== profile.fc)
      .map((r) => personRow(r, [['＋ 친구', 'add', () => addFriend(r.fc, r.name), !r.fc]]));
    $('recentList').replaceChildren(...(recent.length ? recent : [el('em', '', '온라인에서 함께한 플레이어가 여기에 나와요.')]));
  }
  function addFriend(fc, name = '') {
    fc = cleanCode(fc, 6);
    if (fc.length !== 6) return friendMsg('친구 코드는 6자리예요');
    if (fc === profile.fc) return friendMsg('내 코드예요 😄');
    if (profile.friends.some((f) => f.fc === fc)) return friendMsg('이미 친구예요');
    profile.friends = [{ name: name || statuses[fc]?.n || `친구 ${fc}`, fc }, ...profile.friends].slice(0, 40);
    saveProfile();
    friendMsg('친구를 추가했어요');
    sfx.choose();
    drawFriends();
    poll(true);
  }
  function openFriends() {
    drawFriends();
    friendMsg(net.ready ? '' : '온라인에 연결하면 친구 접속 상태를 볼 수 있어요');
    $('friends').hidden = false;
    startPolling();
    poll(true);
  }

  // 친구 접속 상태: 친구창이나 방이 열려 있는 동안 몇 초마다 묻는다
  function poll(now = false) {
    const codes = [...profile.friends, ...profile.recent].map((p) => p.fc).filter(Boolean);
    if (!codes.length || !net.ready) return;
    if (now || !$('friends').hidden || !$('room').hidden) net.send({ t: 'fs', codes });
  }
  function startPolling() {
    if (pollTimer) return;
    pollTimer = setInterval(() => {
      if ($('friends').hidden && $('room').hidden) {
        clearInterval(pollTimer);
        pollTimer = 0;
        return;
      }
      poll();
    }, 4000);
  }

  $('openFriends').addEventListener('click', openFriends);
  $('closeFriends').addEventListener('click', () => ($('friends').hidden = true));
  $('openRoom').addEventListener('click', create);
  $('copyFc').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(profile.fc);
      friendMsg('친구 코드를 복사했어요');
    } catch {
      friendMsg(`내 친구 코드: ${profile.fc}`);
    }
  });
  $('addFc').addEventListener('click', () => addFriend($('addFcInput').value));
  $('joinRoom').addEventListener('click', () => join($('joinCode').value));
  $('addFcInput').addEventListener('input', () => ($('addFcInput').value = cleanCode($('addFcInput').value, 6)));
  $('joinCode').addEventListener('input', () => ($('joinCode').value = cleanCode($('joinCode').value, 6)));

  // ── 초대 알림 ──
  let inviteTimer = 0;
  function showInvite(m) {
    lastInvite = m;
    $('invIcon').textContent = m.icon || '📨';
    $('invTitle').textContent = `${m.from}님의 초대`;
    $('invSub').textContent = `${RULE_NAMES[m.set?.rule] || ''} · ${MODE_NAMES[m.set?.mode] || ''} · ${m.n}명 대기 중`;
    $('invite').hidden = false;
    sfx.pickup();
    ctx.buzz(60);
    clearTimeout(inviteTimer);
    inviteTimer = setTimeout(() => ($('invite').hidden = true), 25000);
  }
  $('invYes').addEventListener('click', () => {
    $('invite').hidden = true;
    if (!lastInvite) return;
    if (ctx.inGame()) ctx.exitGame(); // 게임 중이었다면 나와서 들어간다
    join(lastInvite.code);
  });
  $('invNo').addEventListener('click', () => ($('invite').hidden = true));

  // ── 서버 메시지 ──
  function handle(m) {
    switch (m.t) {
      case 'hi':
        sid = m.sid;
        if (Array.isArray(m.chat)) chatLines = m.chat;
        hiOk = true;
        for (const w of hiWaiters.splice(0)) w();
        return true;
      case 'p': {
        const fresh = !st || st.code !== m.code;
        st = m;
        if (fresh) {
          feed.length = 0;
          addFeed(isHost() ? `방을 만들었어요 · 코드 ${m.code}` : `${m.code} 방에 들어왔어요`);
          $('friends').hidden = true;
          toast(''); // "만드는 중…" 안내를 지운다
          if (!ctx.inGame()) showRoom();
        } else drawRoom();
        return true;
      }
      case 'pmsg': {
        if (m.sys) addFeed(`${m.name}${SYS_TEXT[m.sys] || ''}`);
        else {
          const who = st?.members.find((x) => x.sid === m.sid);
          const text = chatLines[m.i] || '';
          bubbles.set(m.sid, { text, until: performance.now() + 4000 });
          setTimeout(drawRoom, 4100);
          if (who) addFeed(`${who.name}: ${text}`);
          if (m.sid !== sid) sfx.firefly();
        }
        drawRoom();
        return true;
      }
      case 'perr':
        if (!$('friends').hidden) friendMsg(m.msg);
        if (st && !$('room').hidden) {
          addFeed(`⚠️ ${m.msg}`);
          drawRoom();
        }
        toast(m.msg);
        return true;
      case 'pgone':
        st = null;
        bubbles.clear();
        hideRoom();
        if (!ctx.inGame()) ctx.enterLobby();
        toast(m.kicked ? '방장이 방에서 내보냈어요' : '');
        return true;
      case 'inv':
        showInvite(m);
        return true;
      case 'invr': {
        const f = profile.friends.find((x) => x.fc === m.to);
        const line = m.ok ? `${f?.name || m.to}님에게 초대를 보냈어요` : `${f?.name || m.to}님은 지금 접속해 있지 않아요`;
        if (!$('friends').hidden) friendMsg(line);
        if (st) {
          addFeed(line);
          drawRoom();
        }
        return true;
      }
      case 'fs': {
        statuses = { ...statuses, ...m.st };
        // 친구가 이름을 바꿨으면 따라간다
        let changed = false;
        for (const f of profile.friends) {
          const n = statuses[f.fc]?.n;
          if (n && n !== f.name) {
            f.name = n;
            changed = true;
          }
        }
        if (changed) saveProfile();
        if (!$('friends').hidden) drawFriends();
        return true;
      }
      case 'left':
        return true;
    }
    return false;
  }

  function onNetState(state) {
    if (state === 'closed' || state === 'failed') hiOk = false; // 다시 연결되면 다시 확인한다
    if (state === 'open') {
      ctx.hello();
      poll(true);
    }
    if ((state === 'closed' || state === 'failed') && st) {
      st = null;
      hideRoom();
      if (!ctx.inGame()) ctx.enterLobby();
      toast('서버와 연결이 끊겨 방에서 나왔어요');
    }
  }

  // 초대 링크(?party=코드, 예전 ?room=코드)로 들어오면 그 방에 바로 들어간다
  const linkCode = cleanCode(ctx.params.get('party') || ctx.params.get('room'), 6);
  if (linkCode.length >= 4) setTimeout(() => join(linkCode), 300);

  return {
    handle,
    onNetState,
    showRoom,
    hideRoom,
    openFriends,
    get active() {
      return !!st;
    },
    get state() {
      return st;
    },
  };
}
