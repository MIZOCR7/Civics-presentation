/* ==========================================================================
   Host controller - the big screen dashboard
   ========================================================================== */

let state = null;
let stream = null;
const sync = createSync();
let hostToken = null;
let pin = null;
let renderKey = '';
let lobbyKey = '';
let lastTickSecond = -1;
let showPreview = false;
let bank = null;

addFloaters($('#floaters') || document.body, 10);

/* --------------------------------------------------------------- bootstrap */

async function boot() {
  const saved = JSON.parse(localStorage.getItem('qr_host') || 'null');
  if (saved && saved.hostToken) {
    const check = await post('/api/host/verify', { hostToken: saved.hostToken });
    if (check.ok) {
      hostToken = saved.hostToken;
      pin = check.pin;
      localStorage.setItem('qr_host', JSON.stringify({ hostToken, pin }));
    }
  }
  if (!hostToken) {
    const created = await post('/api/host/create', {});
    if (!created.ok) {
      $('#main').innerHTML = `<div class="center-screen" style="flex:1"><div class="card"><h2>Could not start a game</h2><p style="font-weight:600">Is the server running? Reload this page.</p></div></div>`;
      return;
    }
    hostToken = created.hostToken;
    pin = created.pin;
    localStorage.setItem('qr_host', JSON.stringify({ hostToken, pin }));
  }
  $('#pinValue').textContent = pin;
  $('#joinPill').innerHTML = `${icon('link')} ${esc(location.origin)}`;
  $('#joinPill').style.cursor = 'pointer';
  $('#joinPill').title = 'Click to copy the join link';
  $('#joinPill').addEventListener('click', copyJoinLink);

  stream = connectStream('host', { token: hostToken }, {
    sync: (t) => sync.sample(t),
    state: (d) => { state = d; render(); },
    status: (s) => {
      if (s === 'reconnecting') toast('Reconnecting to the game…');
      if (s === 'offline') toast('Lost connection - reload this page');
    },
  });
}

// Students must reach this machine by its LAN address, so prefer the address the
// server detected (falls back to localhost only when there is no network at all).
// The host can override it when the guessed address is the wrong network.
let chosenUrl = null;

function studentUrl() {
  return chosenUrl || (state && state.joinUrl) || location.origin;
}

function pickAddress(url) {
  chosenUrl = url;
  lobbyKey = '';
  render();
  toast('Sharing ' + url);
}

function noNetwork() {
  const u = studentUrl();
  return u.includes('localhost') || u.includes('127.0.0.1');
}

function joinLink() {
  return `${studentUrl()}?pin=${pin}`;
}

async function copyJoinLink() {
  const url = joinLink();
  try {
    await navigator.clipboard.writeText(url);
    toast('Join link copied: ' + url);
  } catch (_) {
    toast(url);
  }
}

/* ------------------------------------------------------------------ signals */

async function command(cmd, extra = {}) {
  const res = await post('/api/host/command', { hostToken, cmd, ...extra });
  if (!res.ok) toast('Command failed - is the server still running?');
  return res;
}

const PHASE_LABEL = {
  lobby: 'Lobby',
  question: 'Question live',
  reveal: 'Answer revealed',
  scoreboard: 'Scoreboard',
  podium: 'Final results',
};

function renderTop() {
  if (!state) return;
  $('#pinValue').textContent = state.pin;
  $('#phasePill').textContent = PHASE_LABEL[state.phase] || state.phase;
  $('#playersPill').innerHTML = `${icon('users')} ${state.players.length}`;
  $('#joinPill').innerHTML = `${icon('link')} ${esc(studentUrl())}`;
}

/* -------------------------------------------------------------------- render */

function render() {
  if (!state) return;
  renderTop();
  // Only rebuild the DOM when the shape of the screen changes. Player counts
  // update in place, so the timer bar never restarts mid-question.
  const key = [state.phase, state.qIndex, state.correctIndex, state.total].join('|');
  const structural = key !== renderKey;
  renderKey = key;

  if (state.phase === 'lobby') return renderLobby();
  if (state.phase === 'question') return renderQuestion(structural);
  if (state.phase === 'reveal') return renderReveal();
  if (state.phase === 'scoreboard') return renderScoreboard();
  if (state.phase === 'podium') return renderPodium();
}

/* --- lobby --- */

function renderLobby() {
  // Rebuild only when the roster actually changes, so joins do not restart the
  // QR rendering on every state push.
  const sig = state.players.map((p) => `${p.id}:${p.name}:${p.connected}`).join(',');
  if (sig === lobbyKey && $('#qrCanvas')) { updateLobbyCount(); return; }
  lobbyKey = sig;

  $('#main').innerHTML = `
    <div class="lobby-grid">
      <aside class="join-panel">
        <div class="join-addr">
          <div class="join-addr-label">Join at</div>
          <div class="join-url">${esc(studentUrl())}</div>
        </div>

        <div class="qr-card">
          <canvas id="qrCanvas" class="qr-canvas" width="190" height="190"></canvas>
          <div class="qr-caption">
            <span class="pin-chip">PIN <b>${esc(state.pin)}</b></span>
            scan to join
          </div>
        </div>

        ${noNetwork() ? `<div class="banner">${icon('wifi')}<span>No network address found. Connect this computer to the school Wi-Fi, then reload this page.</span></div>` : ''}

        ${(state.addresses || []).length > 1 ? `
          <div class="addr-picker">
            <div class="join-addr-label">Not working? Pick your network</div>
            <div class="addr-list">
              ${state.addresses.map((a) => `<button class="addr-btn ${a.url === studentUrl() ? 'active' : ''}" data-url="${esc(a.url)}">${esc(a.name)}<b>${esc(a.url.replace('http://', ''))}</b></button>`).join('')}
            </div>
          </div>` : ''}

        <ol class="join-steps">
          <li>Connect to the <b>same Wi-Fi</b></li>
          <li>Scan the code or open <b>${esc(studentUrl())}</b></li>
          <li>Enter the PIN <b>${esc(state.pin)}</b></li>
          <li>Pick a name and wait</li>
        </ol>

        <div class="join-actions">
          <button class="btn ghost small" id="copyBtn">${icon('link')} Copy link</button>
          <button class="btn ghost small" id="previewBtn">${icon('list')} ${showPreview ? 'Hide' : 'Questions'} (${state.total})</button>
        </div>
        <div id="previewBox" class="preview-box ${showPreview ? '' : 'hidden'}"></div>
      </aside>

      <section class="players-panel">
        <div class="panel-head">
          <h2>${icon('users')} Players</h2>
          <span class="count-badge" id="countBadge">${state.players.length}</span>
          <span class="panel-sub">ready to play</span>
        </div>
        <div class="player-chips" id="chips">
          ${state.players.length
            ? state.players.map((p) => chipHtml(p)).join('')
            : `<span class="chip empty-hint">Waiting for players to scan in…</span>`}
        </div>
      </section>
    </div>`;

  drawQR();
  wireKickButtons();
  $$('.addr-btn').forEach((b) => b.addEventListener('click', () => pickAddress(b.dataset.url)));
  if ($('#copyBtn')) $('#copyBtn').addEventListener('click', copyJoinLink);
  if ($('#previewBtn')) $('#previewBtn').addEventListener('click', async () => {
    showPreview = !showPreview;
    if (showPreview && !bank) bank = await post('/api/host/bank', { hostToken }).catch(() => null);
    renderKey = '';
    lobbyKey = '';
    render();
  });
  if (showPreview && bank && bank.questions) {
    $('#previewBox').innerHTML = bank.questions.map((q, i) => `
      <div style="margin-bottom:11px">
        <b style="color:#fff">${i + 1}. ${esc(q.q)}</b><br>
        ${q.options.map((o, j) => `<span style="color:${j === q.answer ? '#7ee787' : 'rgba(245,243,255,.6)'}">${j === q.answer ? '✔' : '•'} ${esc(o)}</span>`).join('<br>')}
      </div>`).join('');
  }

  renderLobbyFooter();
}

function updateLobbyCount() {
  const badge = $('#countBadge');
  if (badge) badge.textContent = state.players.length;
  const chips = $('#chips');
  if (chips && state.players.length) {
    chips.innerHTML = state.players.map((p) => chipHtml(p)).join('');
    wireKickButtons();
  }
}

function renderLobbyFooter() {
  $('#footer').innerHTML = `
    <label class="setting">${icon('clock')} Time per question
      <select id="timeSelect">
        ${[10, 15, 20, 30, 45, 60].map((t) => `<option value="${t}" ${t === state.settings.questionTime ? 'selected' : ''}>${t} sec</option>`).join('')}
      </select>
    </label>
    <button class="btn green" id="startBtn" style="min-width:250px">${icon('play')} Start game</button>
    <span class="kbd-hint"><span class="kbd">Space</span> start</span>`;
  $('#timeSelect').addEventListener('change', (e) => command('setTime', { seconds: Number(e.target.value) }));
  $('#startBtn').addEventListener('click', () => {
    if (!state.players.length) { toast('Nobody has joined yet - wait for players'); return; }
    command('start');
  });
}

function drawQR() {
  const canvas = $('#qrCanvas');
  if (!canvas || typeof QR === 'undefined') return;
  try {
    QR.draw(canvas, joinLink(), { size: 190 });
  } catch (e) {
    canvas.style.display = 'none';
  }
}

function chipHtml(p) {
  return `<span class="chip ${p.connected ? '' : 'offline'}" title="${p.connected ? 'connected' : 'disconnected'}">
    ${avatarHtml(p.animal)}
    <span>${esc(p.name)}</span>
    <button class="kick" data-id="${p.id}" title="Remove this player">${icon('cross')}</button>
  </span>`;
}

function wireKickButtons() {
  $$('.chip .kick').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const chip = btn.closest('.chip');
      const name = chip ? chip.querySelector('span:nth-of-type(1)')?.textContent || 'this player' : 'this player';
      if (confirm(`Remove ${name} from the game?`)) command('kick', { playerId: btn.dataset.id });
    });
  });
}

/* --- question --- */

function renderQuestion(structural) {
  const q = state.question;
  if (!structural) { updateLiveCounts(); return; }

  $('#main').innerHTML = `
    <div class="question-stage">
      <div class="question-head">
        <span class="q-counter">Question ${state.qIndex + 1} of ${state.total}</span>
        <div class="host-question-text">${esc(q.text)}</div>
        <span class="timer-number" id="timerText" style="font-size:56px">${q.time}</span>
      </div>
      <div class="timer-bar" id="timerBar" style="max-width:100%"><i id="timerFill"></i></div>
      <div class="host-stage-center">
        <div class="answers-grid host-answers">
          ${q.options.map((o, i) => `
            <div class="answer" data-i="${i}" style="cursor:default">
              ${shapeHtml(i)}
              <span class="label">${esc(o)}</span>
            </div>`).join('')}
        </div>
      </div>
      <div class="waiting-strip">
        <span class="pill" id="answeredStrip">${state.answeredCount} of ${state.playerCount} answered</span>
        <span class="pill" id="waitingPill">${icon('hand')} ${state.players.length - state.answeredCount} still thinking</span>
      </div>
    </div>`;

  $('#footer').innerHTML = `
    <button class="btn blue" id="revealBtn">${icon('clock')} Show answer</button>
    <span class="kbd-hint"><span class="kbd">Space</span> reveal</span>
    <button class="btn ghost small" id="endBtn">${icon('stop')} End game</button>`;
  $('#revealBtn').addEventListener('click', () => command('reveal'));
  $('#endBtn').addEventListener('click', () => command('end'));
}

/* --- reveal --- */

function renderReveal() {
  const q = state.question;
  const dist = state.distribution || [];
  const total = dist.reduce((a, b) => a + b, 0) || 1;

  $('#main').innerHTML = `
    <div class="question-stage">
      <div class="question-head">
        <span class="q-counter">Question ${state.qIndex + 1} of ${state.total}</span>
        <div class="host-question-text">${esc(q.text)}</div>
        <span class="pill">${state.answeredCount}/${state.playerCount} answered</span>
      </div>
      <div class="host-stage-center">
        <div class="answers-grid host-answers">
          ${q.options.map((o, i) => `
            <div class="answer ${i === state.correctIndex ? 'correct' : 'dimmed'}" data-i="${i}" style="cursor:default">
              ${shapeHtml(i)}
              <span class="label">${esc(o)}</span>
              <span class="dist-badge ${dist[i] ? '' : 'zero'}">${dist[i] || 0}<span style="font-size:13px"> · ${Math.round(((dist[i] || 0) / total) * 100)}%</span></span>
            </div>`).join('')}
        </div>
      </div>
      ${state.lastWinners && state.lastWinners.length ? `
        <div class="waiting-strip">
          <span style="display:inline-flex;align-items:center;gap:8px">${icon('bolt')} Fastest correct:</span>
          ${state.lastWinners.map((w) => `<span class="pill">${avatarHtml(w.animal, 'sm')} ${esc(w.name)} <b style="color:var(--gold)">+${w.points}</b></span>`).join('')}
        </div>` : `<div class="waiting-strip"><span style="color:var(--muted)">Nobody got it right this time</span></div>`}
    </div>`;

  $('#footer').innerHTML = `
    <button class="btn green" id="nextBtn" style="min-width:250px">
      ${state.qIndex + 1 >= state.total ? `${icon('flag')} Show final results` : `${icon('next')} Scoreboard`}
    </button>
    <span class="kbd-hint"><span class="kbd">Space</span> next</span>`;
  $('#nextBtn').addEventListener('click', () => command('next'));
}

/* --- scoreboard --- */

function renderScoreboard() {
  const top = state.players.slice(0, 5);
  const rest = state.players.slice(5);

  $('#main').innerHTML = `
    <div class="question-stage" style="justify-content:center">
      <h2 style="text-align:center;font-size:clamp(22px,3vw,36px)">Scoreboard · Question ${state.qIndex + 1} of ${state.total}</h2>
      <div class="scoreboard">
        ${top.map((p, i) => `
          <div class="sb-row ${i === 0 ? 'top1' : i === 1 ? 'top2' : i === 2 ? 'top3' : ''}" style="animation-delay:${i * 70}ms">
            <span class="rank">${i + 1}</span>
            <span class="sb-name">${avatarHtml(p.animal)}<span>${esc(p.name)}</span></span>
            <span class="score">${p.score.toLocaleString()}</span>
            <span class="delta ${p.delta > 0 ? 'up' : p.delta < 0 ? 'down' : ''}">${p.delta > 0 ? '▲' + p.delta : p.delta < 0 ? '▼' + Math.abs(p.delta) : '—'}</span>
          </div>`).join('')}
      </div>
      ${rest.length ? `<div class="full-list" style="margin-top:14px">
        ${rest.map((p) => `<span class="fl-item">${p.rank}. ${esc(p.name)} · ${p.score.toLocaleString()}</span>`).join('')}
      </div>` : ''}
    </div>`;

  $('#footer').innerHTML = `
    <button class="btn green" id="nextBtn" style="min-width:250px">
      ${state.qIndex + 1 >= state.total ? `${icon('flag')} Final results` : `${icon('next')} Next question`}
    </button>
    <span class="kbd-hint"><span class="kbd">Space</span> continue</span>`;
  $('#nextBtn').addEventListener('click', () => command('next'));
}

/* --- podium --- */

function renderPodium() {
  const p = state.players;
  const order = [p[1], p[0], p[2]].filter(Boolean); // 2nd, 1st, 3rd
  const placeOf = (pl) => p.indexOf(pl) + 1;

  $('#main').innerHTML = `
    <div class="podium-wrap">
      <h2 style="font-size:clamp(24px,3.4vw,40px);display:flex;align-items:center;gap:12px">
        ${icon('trophy')} ${esc(state.title)} - Final Results
      </h2>
      <div class="podium">
        ${order.map((pl, idx) => {
          const place = placeOf(pl);
          return `<div class="place p${place}" style="animation-delay:${idx * 140}ms">
            ${avatarHtml(pl.animal, 'xl')}
            <div class="who">${place === 1 ? `${icon('crown')} ` : ''}${esc(pl.name)}</div>
            <div class="pts">${pl.score.toLocaleString()} pts</div>
            <div class="block">${place}</div>
          </div>`;
        }).join('')}
      </div>
      <div class="full-list" style="margin-top:16px">
        ${p.map((pl) => `<span class="fl-item">${pl.rank}. ${esc(pl.name)} · ${pl.score.toLocaleString()}</span>`).join('')}
      </div>
    </div>`;

  $('#footer').innerHTML = `
    <button class="btn green" id="againBtn" style="min-width:230px">${icon('refresh')} Play again (same players)</button>
    <button class="btn ghost small" id="clearBtn">${icon('trash')} Clear players</button>
    <span class="kbd-hint"><span class="kbd">Space</span> play again</span>`;
  $('#againBtn').addEventListener('click', () => command('restart'));
  $('#clearBtn').addEventListener('click', () => {
    if (confirm('Remove all players from the lobby?')) command('clearPlayers');
  });
}

/* --------------------------------------------------------- live timer loop */

function tickTimers() {
  if (!state || state.phase !== 'question') { lastTickSecond = -1; return; }
  const total = (state.question.time || 20) * 1000;
  const left = sync.remaining(state.endsAt);
  const fill = $('#timerFill');
  const bar = $('#timerBar');
  const text = $('#timerText');
  if (fill) fill.style.width = `${Math.max(0, Math.min(1, left / total)) * 100}%`;
  if (bar) bar.classList.toggle('low', left <= 5000);
  const secs = Math.ceil(left / 1000);
  if (text) { text.textContent = secs; text.classList.toggle('low', left <= 5000); }
  if (secs !== lastTickSecond && secs > 0 && secs <= 5) Audio.tick();
  lastTickSecond = secs;
}
setInterval(tickTimers, 100);

/* --------------------------------------------------------- live answer counts */

function updateLiveCounts() {
  // Per-option counts stay hidden until the reveal (same as Kahoot) so the
  // class cannot read the room off the projector mid-question.
  if (!state || !state.players) return;
  const strip = $('#answeredStrip');
  if (strip) strip.textContent = `${state.answeredCount} of ${state.playerCount} answered`;
  const waiting = $('#waitingPill');
  if (waiting) waiting.innerHTML = `${icon('hand')} ${Math.max(0, state.players.length - state.answeredCount)} still thinking`;
}

/* ------------------------------------------------------------- keyboard */

document.addEventListener('keydown', (e) => {
  if (!state) return;
  if (e.target.tagName === 'SELECT') return;
  if (e.code === 'Space' || e.code === 'ArrowRight' || e.key === 'Enter') {
    e.preventDefault();
    if (state.phase === 'lobby') { if (state.players.length) command('start'); }
    else if (state.phase === 'question') command('reveal');
    else if (state.phase === 'reveal') command('next');
    else if (state.phase === 'scoreboard') command('next');
    else if (state.phase === 'podium') command('restart');
  }
  if (e.key === 'r' || e.key === 'R') command('reveal');
  if (e.key === 'n' || e.key === 'N') command('skip');
  if (e.key === 'f' || e.key === 'F') {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen().catch(() => {});
  }
});

function paintMute() {
  $('#muteBtn').innerHTML = icon(Audio.isMuted() ? 'volumeOff' : 'volume');
}

$('#muteBtn').addEventListener('click', () => {
  Audio.toggleMute();
  paintMute();
});
paintMute();

/* --------------------------------------------- sound + music, driven by phase */

let lastPhaseKey = '';
let lastRoster = 0;
let musicMood = null;

setInterval(() => {
  if (!state) return;

  // Music: relaxed while waiting, upbeat once the quiz is running.
  const wanted = state.phase === 'lobby' ? 'lobby' : 'game';
  if (wanted !== musicMood && !Audio.isMuted()) {
    Music.start(wanted);
    musicMood = wanted;
  }

  const pk = `${state.phase}|${state.qIndex}`;
  if (pk !== lastPhaseKey) {
    if (state.phase === 'question') Audio.start();
    else if (state.phase === 'reveal') Audio.correct();
    else if (state.phase === 'scoreboard') Audio.whoosh();
    else if (state.phase === 'podium') { Audio.podium(); confetti(6000); }
    lastPhaseKey = pk;
  }
  if (state.phase === 'lobby' && state.players.length > lastRoster) Audio.join();
  lastRoster = state.players.length;
}, 200);

// Kick the music off on the first interaction (browsers need a gesture).
document.addEventListener('pointerdown', () => {
  if (!Audio.isMuted()) { Music.start(state && state.phase === 'lobby' ? 'lobby' : 'game'); musicMood = state && state.phase === 'lobby' ? 'lobby' : 'game'; }
}, { once: true });

boot();
