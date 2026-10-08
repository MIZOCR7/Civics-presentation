/* ==========================================================================
   Player controller
   ========================================================================== */

let creds = null;
try { creds = JSON.parse(localStorage.getItem('qr_player') || 'null'); } catch (_) { creds = null; }

if (!creds || !creds.playerId || !creds.token) {
  location.replace('/');
}

let state = null;
let stream = null;
let sync = createSync();
let answered = false;
let localResult = null;
let renderKey = '';
let lastTickSecond = -1;
let podiumShown = false;
let lobbyGreeted = false;

$('#floaters') && addFloaters($('#floaters'), 8);

/* ------------------------------------------------------------------ render */

function phaseKey() {
  if (!state) return 'none';
  return [state.phase, state.qIndex, state.you.answered, state.correctIndex, state.you.rank].join('|');
}

function renderTop() {
  const bar = $('#topBar');
  if (!state) return;
  const s = state.you;
  const showQ = state.phase === 'question' || state.phase === 'reveal' || state.phase === 'scoreboard';
  bar.innerHTML = `
    ${showQ && state.qIndex >= 0 ? `<span class="pill">Q${state.qIndex + 1}/${state.total}</span>` : ''}
    <span class="pill solid">${s.score.toLocaleString()} pts</span>
    ${s.score > 0 || state.qIndex >= 0 ? `<span class="pill">#${s.rank}</span>` : ''}
    <span class="spacer"></span>
    <span class="pill">${avatarHtml(s.animal, 'sm')} ${esc(s.name)}</span>
    <button class="pill" id="muteBtn" style="border:none;cursor:pointer;font-family:inherit" title="Mute sound">${icon(Audio.isMuted() ? 'volumeOff' : 'volume')}</button>
  `;
  const mb = $('#muteBtn');
  mb.addEventListener('click', () => {
    Audio.toggleMute();
    mb.innerHTML = icon(Audio.isMuted() ? 'volumeOff' : 'volume');
  });
}

function render() {
  if (!state) return;
  renderTop();
  const app = $('#app');
  const phase = state.phase;
  if (phase !== 'podium' && podiumShown) podiumShown = false;
  if (phase === 'lobby' && !lobbyGreeted) { lobbyGreeted = true; Audio.join(); }

  if (phase === 'lobby') {
    app.innerHTML = `
      <div class="result-screen">
        ${avatarHtml(state.you.animal, 'xl')}
        <div class="result-title">You're in!</div>
        <p style="font-size:19px;font-weight:800;margin:2px 0 0">${esc(state.you.name)}</p>
        <p class="waiting-note" style="max-width:320px">
          Look at the big screen. The game starts as soon as your teacher is ready.
        </p>
      </div>`;
    return;
  }

  if (phase === 'question') {
    if (answered) {
      const r = localResult;
      app.innerHTML = `
        <div class="result-screen">
          <div class="result-icon ${r ? (r.correct ? 'good' : 'bad') : 'neutral'}">${icon(r ? (r.correct ? 'check' : 'cross') : 'hand')}</div>
          <div class="result-title">${r ? (r.correct ? 'Correct!' : 'Wrong') : 'Answer sent'}</div>
          ${r && r.correct ? `<div class="result-points">+${r.points.toLocaleString()}</div>` : ''}
          ${r && r.correct && state.you.streak > 1 ? `<div class="result-streak">${icon('fire')} ${state.you.streak} in a row</div>` : ''}
          <p class="waiting-note">Waiting for the others…</p>
        </div>`;
      return;
    }
    app.innerHTML = `
      <div class="question-text">${esc(state.question.text)}</div>
      <div style="display:flex;align-items:center;gap:12px;padding:0 4px">
        <div class="timer-bar" id="timerBar" style="flex:1"><i id="timerFill"></i></div>
        <div style="font-weight:900;font-size:22px;font-variant-numeric:tabular-nums" id="timerText">${state.question.time}</div>
      </div>
      <div class="answers-grid" id="answers">
        ${state.question.options.map((o, i) => `
          <button class="answer" data-i="${i}">${shapeHtml(i)}<span class="label">${esc(o)}</span></button>`).join('')}
      </div>`;
    $$('#answers .answer').forEach((btn) => {
      btn.addEventListener('click', () => submitAnswer(Number(btn.dataset.i), btn));
    });
    return;
  }

  if (phase === 'reveal') {
    const ci = state.correctIndex;
    const mine = localResult;
    app.innerHTML = `
      <div class="question-text" style="font-size:18px">${esc(state.question.text)}</div>
      <div class="result-screen" style="gap:4px">
        <div class="result-icon ${mine ? (mine.correct ? 'good' : 'bad') : 'neutral'}">${icon(mine ? (mine.correct ? 'check' : 'cross') : 'clock')}</div>
        <div class="result-title">${mine ? (mine.correct ? 'Correct!' : 'Wrong') : "Time's up"}</div>
        ${mine && mine.correct ? `<div class="result-points">+${mine.points.toLocaleString()}</div>` : ''}
        <p style="margin-top:12px;font-weight:800;color:var(--muted)">Correct answer</p>
        <div class="answer-badge">${shapeHtml(ci)}<span>${esc(state.question.options[ci])}</span></div>
      </div>`;
    return;
  }

  if (phase === 'scoreboard' || phase === 'podium') {
    const top = state.top || [];
    app.innerHTML = `
      <div style="text-align:center;padding:8px">
        <h2 style="font-size:clamp(20px,5vw,28px);display:flex;align-items:center;justify-content:center;gap:10px">
          ${phase === 'podium' ? icon('trophy') + ' Final results' : 'Scoreboard'}
        </h2>
        <p style="margin:10px 0 0;font-size:clamp(18px,4.6vw,24px);font-weight:900">
          You are <span style="color:var(--gold)">#${state.you.rank}</span> with ${state.you.score.toLocaleString()} pts
        </p>
      </div>
      <div class="scoreboard" style="max-width:520px">
        ${top.map((t, i) => `
          <div class="sb-row ${i === 0 ? 'top1' : i === 1 ? 'top2' : i === 2 ? 'top3' : ''}" style="animation-delay:${i * 60}ms">
            <span class="rank">${i + 1}</span>
            <span class="sb-name">${avatarHtml(t.animal)}<span>${esc(t.name)}${t.name === state.you.name ? ' (you)' : ''}</span></span>
            <span class="score">${t.score.toLocaleString()}</span>
          </div>`).join('')}
      </div>`;
    if (phase === 'podium' && !podiumShown) { podiumShown = true; Audio.podium(); confetti(4000); }
    return;
  }

  app.innerHTML = `<div class="waiting-note">Waiting for the host…</div>`;
}

function refresh() {
  const k = phaseKey();
  if (k !== renderKey) {
    renderKey = k;
    render();
  } else {
    renderTop();
  }
}

/* ---------------------------------------------------------------- answering */

let submitting = false;

async function submitAnswer(choice, btn) {
  if (answered || submitting || !state || state.phase !== 'question') return;
  submitting = true;
  answered = true;
  renderKey = phaseKey() + '-sent';

  $$('#answers .answer').forEach((b) => {
    b.classList.add('locked');
    if (Number(b.dataset.i) === choice) b.classList.add('chosen');
    else b.classList.add('dimmed');
  });
  Audio.answer(choice);

  const res = await post('/api/answer', { playerId: creds.playerId, token: creds.token, choice });
  submitting = false;
  if (res.ok) {
    localResult = { correct: !!res.correct, points: res.points || 0 };
    if (res.correct) Audio.correct(); else Audio.wrong();
  } else {
    answered = res.error === 'already_answered' ? true : answered;
    if (res.error === 'too_late' || res.error === 'not_question') toast('Too late for that one');
    else toast('Answer not saved - try again');
  }
  renderKey = '';
  render();
}

/* -------------------------------------------------------------- timer loop */

function tickTimers() {
  if (!state) return;
  const inQuestion = state.phase === 'question' && state.endsAt;
  const bar = $('#timerBar');
  const fill = $('#timerFill');
  const text = $('#timerText');

  if (!inQuestion) { lastTickSecond = -1; return; }
  const total = (state.question.time || 20) * 1000;
  const left = sync.remaining(state.endsAt);
  const pct = Math.max(0, Math.min(1, left / total));

  if (fill) fill.style.width = `${pct * 100}%`;
  if (bar) bar.classList.toggle('low', left <= 5000);
  const secs = Math.ceil(left / 1000);
  if (text) {
    text.textContent = secs;
    text.style.color = left <= 5000 ? 'var(--gold)' : '#fff';
  }

  if (!answered && secs !== lastTickSecond) {
    if (secs <= 5 && secs > 0) Audio.urgent();
    lastTickSecond = secs;
  }
  if (left <= 0 && !answered) { /* server will move us into reveal */ }
}
setInterval(tickTimers, 100);

/* ------------------------------------------------------------- background music */

let musicMood = null;
function syncMusic() {
  if (!state || Audio.isMuted()) return;
  const wanted = state.phase === 'lobby' ? 'lobby' : 'game';
  if (wanted !== musicMood) {
    Music.start(wanted);
    musicMood = wanted;
  }
}
setInterval(syncMusic, 300);
document.addEventListener('pointerdown', syncMusic, { once: true });

/* ------------------------------------------------------------- connection */

if (creds && creds.playerId && creds.token) stream = connectStream('player', { playerId: creds.playerId, token: creds.token }, {
  sync: (t) => sync.sample(t),
  status: (s) => {
    if (s === 'reconnecting') toast('Reconnecting…');
    if (s === 'offline') toast('Connection lost - keep this page open');
  },
  state: (d) => {
    const newQuestion = !state || state.qIndex !== d.qIndex || state.phase !== d.phase;
    state = d;
    if (d.phase === 'question' && (newQuestion || d.qIndex !== undefined)) {
      if (!d.you.answered) { answered = false; localResult = null; }
      else if (newQuestion) { answered = true; }
    }
    if (d.phase === 'lobby') { answered = false; localResult = null; }
    refresh();
  },
});

window.addEventListener('beforeunload', () => stream && stream.close());
