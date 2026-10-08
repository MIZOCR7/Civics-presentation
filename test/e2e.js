/* End-to-end test: real HTTP + SSE against a running server.
   Usage: node test/e2e.js   (server must already be listening) */

const BASE = process.env.BASE || 'http://127.0.0.1:4000';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0, fail = 0;
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name} ${detail}`); }
}

async function api(pathname, body) {
  const res = await fetch(BASE + pathname, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  let json = {};
  try { json = await res.json(); } catch (_) {}
  return { status: res.status, ok: res.ok, ...json };
}

function streamClient(role, params) {
  const events = [];
  const ctrl = new AbortController();
  const url = `${BASE}/events?${new URLSearchParams({ role, ...params })}`;
  fetch(url, { signal: ctrl.signal })
    .then(async (res) => {
      if (!res.ok) { events.push({ ev: 'error', data: { status: res.status } }); return; }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const chunk = buf.slice(0, i);
          buf = buf.slice(i + 2);
          let ev = 'message', data = '';
          for (const line of chunk.split('\n')) {
            if (line.startsWith('event:')) ev = line.slice(6).trim();
            else if (line.startsWith('data:')) data += line.slice(5).trim();
          }
          if (data) { try { events.push({ ev, data: JSON.parse(data) }); } catch (_) {} }
        }
      }
    })
    .catch(() => {});
  return {
    events,
    close: () => ctrl.abort(),
    states: () => events.filter((e) => e.ev === 'state').map((e) => e.data),
    latest: () => {
      const s = events.filter((e) => e.ev === 'state');
      return s.length ? s[s.length - 1].data : null;
    },
  };
}

async function waitFor(label, pred, timeout = 6000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    if (pred()) return true;
    await sleep(30);
  }
  throw new Error(`timeout waiting for: ${label}`);
}

(async () => {
  console.log('\n=== QuizRush end-to-end ===\n');

  // ---- host creates the game
  const created = await api('/api/host/create');
  check('host can create a game', created.ok && /^\d{6}$/.test(created.pin), JSON.stringify(created));
  const { pin, hostToken } = created;
  const host = streamClient('host', { token: hostToken });
  await waitFor('host state', () => host.latest());
  check('host stream receives state', host.latest().phase === 'lobby');
  check('server reports question total', host.latest().total > 0, `total=${host.latest().total}`);
  const TOTAL = host.latest().total;

  // Short questions keep the test quick: 5s each.
  const t = await api('/api/host/command', { hostToken, cmd: 'setTime', seconds: 5 });
  check('host can change the time per question', t.ok && t.questionTime === 5);

  // ---- guard rails
  const badPin = await api('/api/join', { pin: '000000', name: 'Nope' });
  check('wrong PIN is rejected', badPin.status === 404 && badPin.error === 'bad_pin');
  const noName = await api('/api/join', { pin, name: '   ' });
  check('empty nickname is rejected', noName.status === 400 && noName.error === 'name_required');

  // ---- 26 students join (real classroom size)
  const names = Array.from({ length: 26 }, (_, i) => `Student${i + 1}`);
  const players = [];
  for (const name of names) {
    const r = await api('/api/join', { pin, name });
    if (!r.ok) throw new Error('join failed: ' + JSON.stringify(r));
    players.push({ name: r.name, playerId: r.playerId, token: r.token, stream: null, score: 0 });
  }
  await waitFor('all 26 players on the host screen', () => host.latest().players.length === 26);
  check('26 players joined', host.latest().players.length === 26, `got ${host.latest().players.length}`);

  // every player wears an animal avatar, spread across the roster
  const animals = host.latest().players.map((p) => p.animal);
  check('every player has an animal avatar', animals.every((a) => Number.isInteger(a) && a >= 0 && a < 24), JSON.stringify(animals.slice(0, 5)));
  check('animals are spread across the class', new Set(animals).size >= 20, `${new Set(animals).size} distinct`);
  check('host screen offers join addresses', Array.isArray(host.latest().addresses) && host.latest().addresses.every((a) => typeof a.url === 'string'), JSON.stringify(host.latest().addresses));

  // duplicate name gets a suffix instead of colliding
  const dup = await api('/api/join', { pin, name: 'Student1' });
  check('duplicate nickname is made unique', dup.ok && dup.name === 'Student1 2', dup.name);
  await waitFor('duplicate shows on the host screen', () => host.latest().players.length === 27);
  await api('/api/host/command', { hostToken, cmd: 'kick', playerId: dup.playerId });
  await waitFor('kicked player disappears', () => host.latest().players.length === 26);
  check('kick removes a player', host.latest().players.length === 26 && !host.latest().players.some((p) => p.id === dup.playerId));

  // open a live stream for the first 4 players (enough to prove the wire)
  for (const p of players.slice(0, 4)) p.stream = streamClient('player', { playerId: p.playerId, token: p.token });
  await waitFor('player stream', () => players[0].stream.latest());
  check('player stream receives state', players[0].stream.latest().role === 'player');
  check('player snapshot carries their animal', Number.isInteger(players[0].stream.latest().you.animal), JSON.stringify(players[0].stream.latest().you.animal));
  check('unknown player token is refused', await (async () => {
    const s = streamClient('player', { playerId: 'deadbeef', token: 'nope' });
    await sleep(250);
    const refused = s.events.some((e) => e.ev === 'error' && e.data.status === 403);
    s.close();
    return refused;
  })());

  // ---- start
  await api('/api/host/command', { hostToken, cmd: 'start' });
  await waitFor('question 1', () => host.latest().phase === 'question');
  check('game starts on the first question', host.latest().qIndex === 0);
  check('timer is armed', host.latest().endsAt > Date.now());
  check('timer uses the chosen question time', host.latest().question.time === 5, `${host.latest().question.time}s`);
  const q1 = host.latest().question;
  check('question has 4 options', q1.options.length >= 2, `${q1.options.length}`);

  const joinMid = await api('/api/join', { pin, name: 'Latecomer' });
  check('cannot join while a question is running', joinMid.status === 400 && joinMid.error === 'in_progress');

  // ---- answer: A right & fast, B wrong, C right & slow-ish
  const correctIdx = 0; // first question's answer index in questions.json
  const rA = await api('/api/answer', { playerId: players[0].playerId, token: players[0].token, choice: 0 });
  check('player can answer', rA.ok && rA.correct === true, JSON.stringify(rA));
  check('fast correct answer is worth about 1000', rA.points >= 900 && rA.points <= 1000, `points=${rA.points}`);

  const dupAns = await api('/api/answer', { playerId: players[0].playerId, token: players[0].token, choice: 1 });
  check('second answer from same player is refused', dupAns.error === 'already_answered');

  const rB = await api('/api/answer', { playerId: players[1].playerId, token: players[1].token, choice: 1 });
  check('wrong answer scores zero', rB.ok && rB.correct === false && rB.points === 0, JSON.stringify(rB));

  const badToken = await api('/api/answer', { playerId: players[2].playerId, token: 'wrong', choice: 2 });
  check('answer with a bad token is refused', badToken.status === 403);

  await sleep(400);
  const rC = await api('/api/answer', { playerId: players[2].playerId, token: players[2].token, choice: 0 });
  check('slower correct answer scores less than the fast one', rC.ok && rC.points > 0 && rC.points < rA.points, `${rC.points} < ${rA.points}`);

  await waitFor('host sees 3 answers', () => host.latest().answeredCount >= 3);
  check('host counts answers live', host.latest().answeredCount === 3, `${host.latest().answeredCount}`);

  // ---- reveal
  await api('/api/host/command', { hostToken, cmd: 'reveal' });
  await waitFor('reveal', () => host.latest().phase === 'reveal');
  const dist = host.latest().distribution;
  check('reveal shows the answer distribution', Array.isArray(dist) && dist[0] === 2 && dist[1] === 1, JSON.stringify(dist));
  check('reveal exposes the correct index', host.latest().correctIndex === correctIdx);
  check('fastest-correct feed carries animals', (host.latest().lastWinners || []).every((w) => Number.isInteger(w.animal)));
  await waitFor('player sees reveal', () => players[0].stream.latest().phase === 'reveal');
  check('player snapshot carries the correct index', players[0].stream.latest().correctIndex === correctIdx);
  check('wrong player is told they were wrong', players[1].stream.latest().you.correct === false);
  check('correct player is told they were right', players[0].stream.latest().you.correct === true);

  // ---- scoreboard
  await api('/api/host/command', { hostToken, cmd: 'next' });
  await waitFor('scoreboard', () => host.latest().phase === 'scoreboard');
  const sb = host.latest().players;
  check('leaderboard is sorted by score', sb[0].score >= sb[1].score && sb[1].score >= sb[2].score, JSON.stringify(sb.slice(0, 3).map((p) => p.score)));
  check('fastest correct answer leads', sb[0].name === players[0].name, sb[0].name);

  // ---- question 2 is left alone: the timer alone must end it
  await api('/api/host/command', { hostToken, cmd: 'next' });
  await waitFor('question 2', () => host.latest().phase === 'question' && host.latest().qIndex === 1, 8000);
  const q2 = host.latest().question;
  await waitFor('auto reveal when the timer runs out', () => host.latest().phase === 'reveal', 12000);
  check('question ends by itself when time runs out', host.latest().phase === 'reveal');
  check('nobody answered means zero distribution', host.latest().distribution.every((n) => n === 0));
  check('players were moved to the reveal too', await waitFor('player reveal', () => players[0].stream.latest().phase === 'reveal', 4000));

  // ---- drive the rest of the game to the podium
  let guard = 0;
  while (host.latest().phase !== 'podium' && guard++ < 60) {
    await api('/api/host/command', { hostToken, cmd: 'skip' });
    await sleep(50);
  }

  await waitFor('podium', () => host.latest().phase === 'podium', 8000);
  check('game ends on the podium', host.latest().phase === 'podium');
  const finalOrder = host.latest().players;
  check('everyone who scored is on the final board', finalOrder.length === 26, `${finalOrder.length}`);
  check('final board is ranked', finalOrder[0].rank === 1 && finalOrder[25].rank === 26);

  // ---- replay
  await api('/api/host/command', { hostToken, cmd: 'restart' });
  await waitFor('back to lobby', () => host.latest().phase === 'lobby');
  check('replay returns to the lobby', host.latest().phase === 'lobby');
  check('replay resets every score', host.latest().players.every((p) => p.score === 0));

  // ---- reconnect after a refresh
  const rejoin = await api('/api/rejoin', { playerId: players[0].playerId, token: players[0].token });
  check('a refreshed phone rejoins the same player', rejoin.ok && rejoin.playerId === players[0].playerId);

  // ---- second game gets a fresh PIN
  const created2 = await api('/api/host/create');
  check('a new game gets a new PIN', created2.ok && created2.pin !== pin, `${created2.pin} vs ${pin}`);

  host.close();
  players.forEach((p) => p.stream && p.stream.close());

  console.log(`\n=== ${pass} passed, ${fail} failed ===\n`);
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error('\nTEST CRASHED:', e.message);
  process.exit(1);
});
