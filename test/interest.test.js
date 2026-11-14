// 서버가 시야 밖 플레이어 정보를 절대 보내지 않는지 검증한다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../server/game.js';

function setup(opts) {
  const game = new Game({ BOT_FILL: 0, TEAMS: 2, START_GRACE: 0, ...opts });
  game.walls = [];
  const sent = new Map();
  const add = (name) => {
    const box = [];
    const p = game.addPlayer(name, (m) => box.push(JSON.parse(m)));
    sent.set(p.id, box);
    return p;
  };
  const place = (p, x, z, yaw) => Object.assign(p, { x, z, yaw, alive: true });
  const snap = (p) => {
    game.broadcast();
    return sent.get(p.id).filter((m) => m.t === 's').pop();
  };
  return { game, add, place, snap, sent };
}

test('시야 안의 적만 스냅샷에 포함된다', () => {
  const { add, place, snap } = setup();
  const a = add('A'); // 팀 1
  const b = add('B'); // 팀 2
  place(a, 0, 0, 0);
  place(b, 0, 8, Math.PI); // A의 정면, 서로 마주봄
  assert.deepEqual(snap(a).e.map((e) => e[0]), [b.id]);
  assert.deepEqual(snap(b).e.map((e) => e[0]), [a.id]);

  place(b, 0, -8, Math.PI); // A의 등 뒤, B는 A의 반대쪽을 봄
  assert.deepEqual(snap(a).e, []);
  assert.deepEqual(snap(b).e, []);

  place(b, 0, -8, 0); // B가 A의 등을 봄: 한쪽만 보인다
  assert.deepEqual(snap(a).e, []);
  assert.deepEqual(snap(b).e.map((e) => e[0]), [a.id]);
});

test('시야 밖 적의 좌표는 어떤 메시지에도 들어있지 않다', () => {
  const { game, add, place, sent } = setup();
  const a = add('A');
  const b = add('B');
  place(a, 0, 0, 0);
  place(b, 12.34, -17.89, 0);
  game.broadcast();
  const raw = JSON.stringify(sent.get(a.id));
  assert.ok(!raw.includes('12.34') && !raw.includes('17.89'));
});

test('팀원은 항상 보이고, 팀원의 시야가 공유된다', () => {
  const { add, place, snap } = setup();
  const a = add('A'); // 팀 1
  const b = add('B'); // 팀 2
  const c = add('C'); // 팀 1
  assert.equal(a.team, c.team);
  place(a, 0, 0, 0);
  place(c, 0, -20, Math.PI); // A의 뒤에서 -z를 봄
  place(b, 0, -28, 0); // C의 정면. A에게는 등 뒤 + 시야 거리 밖
  const ids = snap(a).e.map((e) => e[0]).sort();
  assert.deepEqual(ids, [b.id, c.id].sort());
});

test('개인전(TEAMS=0)에서는 시야가 공유되지 않는다', () => {
  const { add, place, snap } = setup({ TEAMS: 0 });
  const a = add('A');
  const b = add('B');
  const c = add('C');
  place(a, 0, 0, 0);
  place(c, 0, -20, Math.PI);
  place(b, 0, -28, 0);
  assert.deepEqual(snap(a).e, []);
  assert.deepEqual(snap(c).e.map((e) => e[0]), [b.id]);
});

test('벽 뒤의 적은 전송되지 않는다', () => {
  const { game, add, place, snap } = setup();
  const a = add('A');
  const b = add('B');
  game.walls = [{ minX: -3, maxX: 3, minZ: 3, maxZ: 4 }];
  place(a, 0, 0, 0);
  place(b, 0, 8, Math.PI);
  assert.deepEqual(snap(a).e, []);
});

test('기습: 등 뒤에서 공격하면 처치되고, 킬 피드에 위치가 없다', () => {
  const { game, add, place, sent } = setup();
  const a = add('A');
  const b = add('B');
  place(a, 0, 0, 0);
  place(b, 0, -1.5, 0); // A 바로 뒤에서 A를 봄
  game.queueInput(b.id, [1, 0, 0, 0, 1]);
  game.step();
  assert.equal(a.alive, false);
  assert.equal(b.score, 1);
  game.broadcast();
  const kill = sent.get(a.id).find((m) => m.t === 'k');
  assert.deepEqual(kill.l, [[b.id, a.id]]);
});

test('입력 검증: 과도한 입력/잘못된 값은 무시되고 이동 속도가 제한된다', () => {
  const { game, add, place } = setup();
  const a = add('A');
  place(a, 0, 0, 0);
  game.queueInput(a.id, [1, NaN, 0, 0, 0]);
  game.queueInput(a.id, 'bad');
  assert.equal(a.queue.length, 0);
  for (let i = 1; i <= 50; i++) game.queueInput(a.id, [i, 0, 999, 0, 0]); // 큐 상한 + 클램프
  game.step();
  // 한 틱에 최대 1개(누적 예산 없음) 처리 → 한 틱 이동 거리 이내
  assert.ok(a.z <= game.cfg.PLAYER_SPEED / game.cfg.TICK_RATE + 1e-9);
  assert.ok(a.queue.length <= 10);
});
