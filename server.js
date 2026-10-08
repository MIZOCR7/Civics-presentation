'use strict';
/* ============================================================================
   QuizRush - Kahoot-style live classroom quiz
   Zero dependencies. Pure Node.js http + Server-Sent Events.

   Realtime model:
     server -> client : SSE stream on /events   (state pushes + clock sync)
     client -> server : small JSON POSTs        (/api/...)

   Everything about the game lives in ONE `game` object so state can never
   drift out of sync between the host screen and 30 phones.
   ========================================================================== */

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const QUESTIONS_FILE = path.join(ROOT, 'questions.json');
// Some hosts (including this IDE) export PORT=0, which would make Node bind an
// unpredictable random port. Only honour a real, usable port number.
function resolvePort() {
  for (const raw of [process.env.QUIZRUSH_PORT, process.env.PORT]) {
    const n = Number(raw);
    if (Number.isInteger(n) && n > 0 && n < 65536) return n;
  }
  return 4000;
}
const PORT = resolvePort();
const HOST = process.env.HOST || '0.0.0.0';

const rid = (n = 8) => crypto.randomBytes(n).toString('hex');

/* ---------------------------------------------------------------- questions */

function loadQuestions() {
  const raw = fs.readFileSync(QUESTIONS_FILE, 'utf8');
  const data = JSON.parse(raw);
  const questions = (data.questions || [])
    .filter((q) => q && q.q && Array.isArray(q.options) && q.options.length >= 2)
    .map((q) => ({
      q: String(q.q),
      options: q.options.map((o) => String(o)).slice(0, 4),
      answer: Math.max(0, Math.min(q.options.length - 1, Number(q.answer) || 0)),
      // null means "use the host's time-per-question setting"
      time: q.time ? Math.max(5, Math.min(120, Number(q.time))) : null,
    }));
  return {
    title: data.title || 'Live Quiz',
    defaultQuestionTime: Number(data.defaultQuestionTime) || 20,
    questions,
  };
}

let BANK = loadQuestions();

/* -------------------------------------------------------------- networking */

function rankAddr(a) {
  if (a.startsWith('192.168.')) return 3;
  if (a.startsWith('10.')) return 3;
  if (a.startsWith('172.')) return 2;
  if (a.startsWith('169.254.')) return 0;
  return 1;
}

function lanAddresses() {
  const out = [];
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const ni of ifaces[name] || []) {
      if (ni.family === 'IPv4' && !ni.internal) out.push({ name, address: ni.address });
    }
  }
  out.sort((a, b) => rankAddr(b.address) - rankAddr(a.address));
  return out;
}

/* --------------------------------------------------------------- SSE rooms */

let nextClientId = 1;
const clients = new Map(); // id -> { id, res, role, playerId, hostToken, alive }

function sseSend(client, event, data) {
  try {
    client.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  } catch (_) {
    /* client gone; the close handler cleans up */
  }
}

function broadcast(event, data, filter) {
  for (const c of clients.values()) {
    if (filter && !filter(c)) continue;
    sseSend(c, event, data);
  }
}

function sseHandler(req, res, url) {
  const role = url.searchParams.get('role') === 'host' ? 'host' : 'player';
  const token = url.searchParams.get('token') || '';
  const playerId = url.searchParams.get('playerId') || '';

  // Validate identity BEFORE opening the stream.
  if (role === 'host' && (!game || game.hostToken !== token)) {
    res.writeHead(403, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'unknown_host' }));
  }
  if (role === 'player') {
    const p = game && game.players.get(playerId);
    if (!p || p.token !== token) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'unknown_player' }));
    }
    p.connected = true;
    p.lastSeen = Date.now();
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write(': connected\n\n');

  const client = { id: nextClientId++, res, role, playerId, hostToken: token, alive: true };
  clients.set(client.id, client);

  sseSend(client, 'hello', { serverNow: Date.now(), clientId: client.id });
  pushState(client);
  if (role === 'player') broadcastHost();

  req.on('close', () => {
    client.alive = false;
    clients.delete(client.id);
    if (role === 'player') {
      const p = game && game.players.get(playerId);
      if (p) {
        p.connected = false;
        p.lastSeen = Date.now();
        broadcastHost();
      }
    }
  });
}

// Heartbeat: keeps phones awake and gives every client a fresh clock sample.
setInterval(() => {
  if (!game) return;
  const now = Date.now();
  broadcast('ping', { serverNow: now, phase: game.phase, endsAt: game.questionEndsAt || 0 });
  // Proactive auto-reveal guard in case a setTimeout was ever lost.
  if (game.phase === 'question' && game.questionEndsAt && now > game.questionEndsAt + 400) {
    revealNow(game);
  }
}, 2000).unref();

/* ------------------------------------------------------------------- game */

let game = null;

// How many animal avatars the client knows about (public/js/common.js). The
// server only stores an index; the browser turns it into an icon.
const ANIMAL_COUNT = 24;

// Pick the animal used least in the lobby, so a class of 26 spreads out
// instead of everyone wearing the same face.
function pickAnimal() {
  const used = new Array(ANIMAL_COUNT).fill(0);
  for (const p of game.players.values()) {
    if (Number.isInteger(p.animal) && p.animal >= 0 && p.animal < ANIMAL_COUNT) used[p.animal]++;
  }
  let best = 0;
  for (let i = 1; i < ANIMAL_COUNT; i++) if (used[i] < used[best]) best = i;
  return best;
}

function makePin() {
  let pin;
  do {
    pin = String(Math.floor(100000 + Math.random() * 900000));
  } while (game && game.pin === pin);
  return pin;
}

function createGame() {
  game = {
    pin: makePin(),
    hostToken: rid(16),
    createdAt: Date.now(),
    phase: 'lobby', // lobby | question | reveal | scoreboard | podium
    players: new Map(),
    qIndex: -1,
    questionStartedAt: 0,
    questionEndsAt: 0,
    timer: null,
    lastDistribution: null,
    lastWinners: [],
    settings: { questionTime: BANK.defaultQuestionTime },
    currentQuestionTime: BANK.defaultQuestionTime,
    paused: false,
  };
  return game;
}

const currentQuestion = () => (game && game.qIndex >= 0 ? BANK.questions[game.qIndex] : null);

function sortedPlayers() {
  return [...game.players.values()].sort((a, b) => b.score - a.score || a.joinedAt - b.joinedAt);
}

function rankOf(playerId) {
  const list = sortedPlayers();
  return list.findIndex((p) => p.id === playerId) + 1;
}

/* ---------------------------------------------------------------- payloads */

function hostSnapshot() {
  const q = currentQuestion();
  const players = sortedPlayers().map((p, i) => ({
    id: p.id,
    name: p.name,
    score: p.score,
    rank: i + 1,
    streak: p.streak,
    connected: p.connected,
    animal: Number.isInteger(p.animal) ? p.animal : 0,
    answered: p.lastChoice !== null && p.lastChoice !== undefined,
    delta: p.lastDelta || 0,
  }));
  return {
    role: 'host',
    phase: game.phase,
    pin: game.pin,
    title: BANK.title,
    serverNow: Date.now(),
    joinUrl: joinUrl(),
    // Every reachable address, so the host can switch if the guessed one is not
    // the network the students are on (hotspot vs school Wi-Fi, etc.).
    addresses: lanAddresses().map((a) => ({ name: a.name, url: `http://${a.address}:${PORT}` })),
    settings: game.settings,
    total: BANK.questions.length,
    qIndex: game.qIndex,
    question: q ? { text: q.q, options: q.options, time: game.currentQuestionTime } : null,
    startedAt: game.questionStartedAt,
    endsAt: game.questionEndsAt,
    answeredCount: players.filter((p) => p.answered).length,
    playerCount: players.length,
    players,
    distribution: game.phase === 'reveal' ? game.lastDistribution : null,
    correctIndex: game.phase === 'reveal' ? q.answer : null,
    lastWinners: game.phase === 'reveal' ? game.lastWinners : [],
  };
}

function playerSnapshot(playerId) {
  const p = game.players.get(playerId);
  if (!p) return null;
  const q = currentQuestion();
  const reveal = game.phase === 'reveal' || game.phase === 'scoreboard' || game.phase === 'podium';
  return {
    role: 'player',
    phase: game.phase,
    pin: game.pin,
    title: BANK.title,
    serverNow: Date.now(),
    total: BANK.questions.length,
    qIndex: game.qIndex,
    question: q ? { text: q.q, options: q.options, time: game.currentQuestionTime } : null,
    endsAt: game.questionEndsAt,
    you: {
      id: p.id,
      name: p.name,
      animal: Number.isInteger(p.animal) ? p.animal : 0,
      score: p.score,
      rank: rankOf(p.id),
      streak: p.streak,
      answered: p.lastChoice !== null && p.lastChoice !== undefined,
      choice: p.lastChoice,
      correct: reveal ? p.lastCorrect : null,
      lastPoints: p.lastPoints,
      lastCorrect: p.lastCorrect,
    },
    correctIndex: game.phase === 'reveal' ? q.answer : null,
    top: sortedPlayers()
      .slice(0, 5)
      .map((x, i) => ({ name: x.name, animal: Number.isInteger(x.animal) ? x.animal : 0, score: x.score, rank: i + 1, delta: x.lastDelta || 0 })),
  };
}

function pushState(client) {
  if (!client) return;
  if (client.role === 'host') {
    if (client.hostToken === game.hostToken) sseSend(client, 'state', hostSnapshot());
  } else {
    const snap = playerSnapshot(client.playerId);
    if (snap) sseSend(client, 'state', snap);
  }
}

function broadcastAll() {
  for (const c of clients.values()) pushState(c);
}

function broadcastHost() {
  const snap = hostSnapshot();
  for (const c of clients.values()) if (c.role === 'host' && c.hostToken === game.hostToken) sseSend(c, 'state', snap);
}

/* --------------------------------------------------------- game mechanics */

function startQuestion(index) {
  clearTimeout(game.timer);
  game.qIndex = index;
  game.phase = 'question';
  game.questionStartedAt = Date.now();
  const q = currentQuestion();
  game.currentQuestionTime = q.time || game.settings.questionTime;
  game.questionEndsAt = game.questionStartedAt + game.currentQuestionTime * 1000;
  game.lastDistribution = null;
  game.lastWinners = [];
  for (const p of game.players.values()) {
    p.lastChoice = null;
    p.lastCorrect = null;
    p.lastPoints = 0;
    p.answeredAt = 0;
  }
  broadcastAll();
  game.timer = setTimeout(() => {
    if (game.phase === 'question') revealNow(game);
  }, game.currentQuestionTime * 1000 + 250);
}

function revealNow() {
  if (game.phase !== 'question') return;
  clearTimeout(game.timer);
  const q = currentQuestion();
  const dist = q.options.map(() => 0);
  for (const p of game.players.values()) {
    if (typeof p.lastChoice === 'number' && p.lastChoice >= 0 && p.lastChoice < dist.length) dist[p.lastChoice]++;
  }
  game.lastDistribution = dist;
  game.phase = 'reveal';

  // Who answered correctly this round, fastest first (for the host's live feed).
  game.lastWinners = [...game.players.values()]
    .filter((p) => p.lastCorrect)
    .sort((a, b) => b.lastPoints - a.lastPoints)
    .slice(0, 5)
    .map((p) => ({ name: p.name, points: p.lastPoints, animal: Number.isInteger(p.animal) ? p.animal : 0 }));

  broadcastAll();
}

function allAnswered() {
  const list = [...game.players.values()].filter((p) => p.connected);
  if (!list.length) return false;
  return list.every((p) => p.lastChoice !== null && p.lastChoice !== undefined);
}

function submitAnswer(playerId, choice) {
  const p = game.players.get(playerId);
  if (!p) return { error: 'unknown_player' };
  if (game.phase !== 'question') return { error: 'not_question' };
  if (p.lastChoice !== null && p.lastChoice !== undefined) return { error: 'already_answered' };

  const now = Date.now();
  if (now > game.questionEndsAt + 300) return { error: 'too_late' };

  const q = currentQuestion();
  const correct = Number(choice) === q.answer;
  const totalMs = (game.currentQuestionTime || q.time) * 1000;
  const usedMs = Math.max(0, Math.min(totalMs, now - game.questionStartedAt));
  // Kahoot scoring: 1000 pts for an instant correct answer, ~500 at the buzzer.
  const speedPts = Math.round(1000 * (1 - usedMs / totalMs / 2));
  let bonus = 0;
  if (correct) {
    p.streak += 1;
    bonus = Math.min((p.streak - 1) * 100, 500);
  } else {
    p.streak = 0;
  }
  const points = correct ? speedPts + bonus : 0;

  const beforeRank = rankOf(p.id);
  p.lastChoice = Number(choice);
  p.lastCorrect = correct;
  p.lastPoints = points;
  p.answeredAt = usedMs;
  p.correctCount = (p.correctCount || 0) + (correct ? 1 : 0);
  p.answeredTotal = (p.answeredTotal || 0) + 1;
  p.score += points;
  p.prevRank = beforeRank;

  broadcastAll();

  // Kahoot ends the question the moment everyone is in.
  if (allAnswered()) {
    clearTimeout(game.timer);
    game.timer = setTimeout(() => {
      if (game.phase === 'question') revealNow(game);
    }, 700);
  }
  return { ok: true, correct, points };
}

function goScoreboard() {
  if (game.phase !== 'reveal') return;
  game.phase = 'scoreboard';
  const list = sortedPlayers();
  for (const p of list) {
    const prev = p.prevRank || 0;
    p.lastDelta = prev ? prev - rankOf(p.id) : 0;
  }
  broadcastAll();
}

function nextQuestion() {
  clearTimeout(game.timer);
  if (game.qIndex + 1 >= BANK.questions.length) {
    game.phase = 'podium';
    game.questionEndsAt = 0;
    broadcastAll();
    return;
  }
  startQuestion(game.qIndex + 1);
}

function resetGame() {
  clearTimeout(game.timer);
  for (const p of game.players.values()) {
    p.score = 0;
    p.streak = 0;
    p.lastChoice = null;
    p.lastCorrect = null;
    p.lastPoints = 0;
    p.prevRank = 0;
    p.lastDelta = 0;
    p.correctCount = 0;
    p.answeredTotal = 0;
  }
  game.qIndex = -1;
  game.phase = 'lobby';
  game.questionStartedAt = 0;
  game.questionEndsAt = 0;
  broadcastAll();
}

function joinGame(name, existingId) {
  const clean = String(name || '').replace(/\s+/g, ' ').trim().slice(0, 18);
  if (!clean) return { error: 'name_required' };
  if (game.phase === 'question') return { error: 'in_progress' };

  // Same name from the same phone = reconnect, not a duplicate.
  if (existingId) {
    const old = game.players.get(existingId);
    if (old) {
      old.name = clean;
      old.connected = true;
      broadcastAll();
      return { ok: true, playerId: old.id, token: old.token, name: old.name, rejoined: true };
    }
  }

  let finalName = clean;
  const taken = new Set([...game.players.values()].map((p) => p.name.toLowerCase()));
  if (taken.has(finalName.toLowerCase())) {
    let n = 2;
    while (taken.has(`${finalName} ${n}`.toLowerCase())) n++;
    finalName = `${finalName} ${n}`;
  }

  const id = rid(6);
  game.players.set(id, {
    id,
    token: rid(12),
    name: finalName,
    animal: pickAnimal(),
    score: 0,
    streak: 0,
    lastChoice: null,
    lastCorrect: null,
    lastPoints: 0,
    prevRank: 0,
    lastDelta: 0,
    correctCount: 0,
    answeredTotal: 0,
    connected: true,
    joinedAt: Date.now(),
  });
  broadcastAll();
  const p = game.players.get(id);
  return { ok: true, playerId: id, token: p.token, name: p.name };
}

/* ------------------------------------------------------------- http server */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

function readBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (c) => {
      body += c;
      if (body.length > 1e6) req.destroy();
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (_) {
        resolve({});
      }
    });
    req.on('error', () => resolve({}));
  });
}

function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function joinUrl() {
  const addrs = lanAddresses();
  const addr = addrs.length ? addrs[0].address : 'localhost';
  return `http://${addr}:${PORT}`;
}

function serveStatic(req, res, urlPath) {
  let rel = decodeURIComponent(urlPath);
  if (rel === '/') rel = '/index.html';
  if (rel === '/host') rel = '/host.html';
  if (rel === '/play') rel = '/play.html';
  const filePath = path.join(PUBLIC_DIR, path.normalize(rel).replace(/^(\.\.[/\\])+/, ''));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }
  fs.readFile(filePath, (err, buf) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Not found');
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(buf);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const p = url.pathname;

  if (p === '/events') return sseHandler(req, res, url);

  if (p === '/api/netinfo') {
    return sendJson(res, 200, { port: PORT, joinUrl: joinUrl(), addresses: lanAddresses() });
  }

  if (p === '/api/host/create' && req.method === 'POST') {
    createGame();
    return sendJson(res, 200, { pin: game.pin, hostToken: game.hostToken, joinUrl: joinUrl(), title: BANK.title, total: BANK.questions.length });
  }

  if (p === '/api/host/verify' && req.method === 'POST') {
    const body = await readBody(req);
    if (!game || body.hostToken !== game.hostToken) return sendJson(res, 403, { error: 'bad_token' });
    return sendJson(res, 200, { ok: true, pin: game.pin, phase: game.phase, total: BANK.questions.length });
  }

  if (p === '/api/host/bank' && req.method === 'POST') {
    const body = await readBody(req);
    if (!game || body.hostToken !== game.hostToken) return sendJson(res, 403, { error: 'bad_token' });
    return sendJson(res, 200, { title: BANK.title, questions: BANK.questions });
  }

  if (p === '/api/host/command' && req.method === 'POST') {
    const body = await readBody(req);
    if (!game || body.hostToken !== game.hostToken) return sendJson(res, 403, { error: 'bad_token' });
    switch (body.cmd) {
      case 'start':
        if (game.phase === 'lobby') startQuestion(0);
        else if (game.phase === 'podium') resetGame();
        break;
      case 'reveal':
        revealNow();
        break;
      case 'scoreboard':
        goScoreboard();
        break;
      case 'next':
        if (game.phase === 'reveal') goScoreboard();
        else if (game.phase === 'scoreboard') nextQuestion();
        else if (game.phase === 'lobby') startQuestion(0);
        break;
      case 'skip': // jump straight to the next question from any state
        clearTimeout(game.timer);
        nextQuestion();
        break;
      case 'restart':
        resetGame();
        break;
      case 'kick': {
        const p2 = game.players.get(body.playerId);
        if (p2) {
          p2.connected = false;
          game.players.delete(body.playerId);
          broadcastAll();
        }
        break;
      }
      case 'clearPlayers':
        for (const c of clients.values()) if (c.role === 'player') c.res.end();
        game.players.clear();
        broadcastAll();
        break;
      case 'reloadQuestions':
        try {
          BANK = loadQuestions();
          resetGame();
          return sendJson(res, 200, { ok: true, total: BANK.questions.length, title: BANK.title });
        } catch (e) {
          return sendJson(res, 400, { error: 'bad_questions_file', detail: String(e.message || e) });
        }
      case 'setTime': {
        const t = Math.max(5, Math.min(120, Number(body.seconds) || 20));
        game.settings.questionTime = t;
        if (game.phase === 'question') game.currentQuestionTime = t; // live change
        broadcastAll();
        return sendJson(res, 200, { ok: true, questionTime: t });
      }
      case 'end':
        clearTimeout(game.timer);
        game.phase = 'podium';
        game.questionEndsAt = 0;
        broadcastAll();
        break;
    }
    return sendJson(res, 200, { ok: true, phase: game.phase, qIndex: game.qIndex });
  }

  if (p === '/api/join' && req.method === 'POST') {
    const body = await readBody(req);
    if (!game) return sendJson(res, 404, { error: 'no_game' });
    if (String(body.pin || '') !== game.pin) return sendJson(res, 404, { error: 'bad_pin' });
    const result = joinGame(body.name, body.playerId);
    if (result.error) return sendJson(res, 400, result);
    return sendJson(res, 200, { ...result, pin: game.pin });
  }

  if (p === '/api/rejoin' && req.method === 'POST') {
    const body = await readBody(req);
    if (!game) return sendJson(res, 404, { error: 'no_game' });
    const pl = game.players.get(body.playerId);
    if (!pl || pl.token !== body.token) return sendJson(res, 404, { error: 'unknown_player' });
    pl.connected = true;
    broadcastAll();
    return sendJson(res, 200, { ok: true, playerId: pl.id, token: pl.token, name: pl.name, pin: game.pin });
  }

  if (p === '/api/answer' && req.method === 'POST') {
    const body = await readBody(req);
    if (!game) return sendJson(res, 404, { error: 'no_game' });
    const pl = game.players.get(body.playerId);
    if (!pl || pl.token !== body.token) return sendJson(res, 403, { error: 'unknown_player' });
    const r = submitAnswer(body.playerId, body.choice);
    if (r.error) return sendJson(res, 400, r);
    return sendJson(res, 200, r);
  }

  if (p === '/api/questions' && req.method === 'GET') {
    return sendJson(res, 200, { title: BANK.title, total: BANK.questions.length });
  }

  return serveStatic(req, res, p);
});

server.listen(PORT, HOST, () => {
  const url = joinUrl();
  console.log('');
  console.log('  ================================================');
  console.log('    QuizRush is RUNNING');
  console.log('  ================================================');
  console.log('');
  console.log(`    Host screen ....... ${url}/host`);
  console.log(`    Students join ..... ${url}`);
  console.log(`    Questions ......... ${BANK.questions.length} loaded from questions.json`);
  console.log('');
  if (lanAddresses().length > 1) {
    console.log('    Other addresses:');
    for (const a of lanAddresses().slice(1)) console.log(`      http://${a.address}:${PORT}  (${a.name})`);
    console.log('');
  }
  console.log('    Students must be on the SAME Wi-Fi as this computer.');
  console.log('    If Windows asks about the firewall, click "Allow".');
  console.log('');
});

process.on('uncaughtException', (e) => console.error('[uncaught]', e));
process.on('unhandledRejection', (e) => console.error('[unhandled]', e));
