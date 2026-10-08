/* ==========================================================================
   Shared client helpers: live stream, clock sync, icons, animals, audio,
   background music, confetti.
   ========================================================================== */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}

/* ------------------------------------------------------------------- icons */
/* Hand-drawn line icons so the interface never falls back on emoji chrome.  */

const ICONS = {
  link: '<path d="M10 13a5 5 0 0 0 7.1 0l2.4-2.4a5 5 0 0 0-7.1-7.1L11.5 4.4"/><path d="M14 11a5 5 0 0 0-7.1 0l-2.4 2.4a5 5 0 1 0 7.1 7.1L12.5 19.6"/>',
  list: '<path d="M8.5 6.5h12M8.5 12h12M8.5 17.5h12M3.8 6.5h.01M3.8 12h.01M3.8 17.5h.01"/>',
  volume: '<path d="M11 5.2 6.4 9H3.2v6h3.2L11 18.8z"/><path d="M15.6 9.4a3.6 3.6 0 0 1 0 5.2"/><path d="M18.4 6.6a7.6 7.6 0 0 1 0 10.8"/>',
  volumeOff: '<path d="M11 5.2 6.4 9H3.2v6h3.2L11 18.8z"/><path d="m16 9.8 5 4.4M21 9.8l-5 4.4"/>',
  play: '<path d="M7 4.6v14.8L19.4 12z" fill="currentColor" stroke="none"/>',
  clock: '<circle cx="12" cy="12" r="8.6"/><path d="M12 7.2V12l3.4 2"/>',
  next: '<path d="M4.5 12h13.6"/><path d="m12.6 6.2 5.8 5.8-5.8 5.8"/>',
  flag: '<path d="M5.4 21V3.6"/><path d="M5.4 4.6h12l-2 4 2 4h-12z"/>',
  refresh: '<path d="M20.6 12a8.6 8.6 0 1 1-2.8-6.3"/><path d="M20.8 3.6v5.2h-5.2"/>',
  trash: '<path d="M4.2 7h15.6M9.4 7V4.8h5.2V7M6.4 7l1 13h9.2l1-13"/>',
  users: '<circle cx="9.2" cy="8" r="3.3"/><path d="M3.4 20.2a5.8 5.8 0 0 1 11.6 0"/><path d="M16.4 5.2a3.3 3.3 0 0 1 0 5.6"/><path d="M17.7 14.6a5.8 5.8 0 0 1 3.2 5.2"/>',
  crown: '<path d="M3.2 8.2 7.4 11.6 12 4.4l4.6 7.2 4.2-3.4-1.3 10.4H4.5z"/>',
  check: '<path d="M4.6 12.6 9.4 17.4 19.6 6.6"/>',
  cross: '<path d="M6.4 6.4 17.6 17.6M17.6 6.4 6.4 17.6"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="2.6"/>',
  qr: '<rect x="3.2" y="3.2" width="7" height="7" rx="1.4"/><rect x="13.8" y="3.2" width="7" height="7" rx="1.4"/><rect x="3.2" y="13.8" width="7" height="7" rx="1.4"/><path d="M13.8 13.8h3v3h-3zM20 13.8v2.4M20.4 20h.01M14 20h3"/>',
  wifi: '<path d="M4.2 11.4a11 11 0 0 1 15.6 0"/><path d="M7.4 14.6a6.6 6.6 0 0 1 9.2 0"/><path d="M12 18.6h.01"/>',
  bolt: '<path d="M13.4 2.4 4.6 13.4h6.2l-1.2 8.2 8.8-11h-6.2z"/>',
  trophy: '<path d="M7.6 3.8h8.8v5.4a4.4 4.4 0 0 1-8.8 0z"/><path d="M7.6 5H4.4v2a3.2 3.2 0 0 0 3.2 3.2M16.4 5h3.2v2a3.2 3.2 0 0 1-3.2 3.2"/><path d="M9.4 20.2h5.2M12 13.6v6.6"/>',
  spark: '<path d="M12 3.2v5M12 15.8v5M3.2 12h5M15.8 12h5M6.4 6.4l2.8 2.8M14.8 14.8l2.8 2.8M17.6 6.4l-2.8 2.8M9.2 14.8l-2.8 2.8"/>',
  fire: '<path d="M12 3.4c3.4 3.6 5.4 6.2 5.4 9.2a5.4 5.4 0 0 1-10.8 0c0-1.6.7-3 1.8-4.4.5 1.2 1.2 1.8 2 1.8.2-2.6.6-4.6 1.6-6.6z"/>',
  hand: '<path d="M8 11V5.4a1.6 1.6 0 0 1 3.2 0V11"/><path d="M11.2 10.6V4.4a1.6 1.6 0 0 1 3.2 0v6.2"/><path d="M14.4 11V6.6a1.6 1.6 0 0 1 3.2 0V14a7 7 0 0 1-7 7h-.6a6 6 0 0 1-4.7-2.3L3.6 15a1.7 1.7 0 0 1 2.6-2.1L8 14.6"/>',
  eye: '<path d="M2.6 12S6 6.2 12 6.2 21.4 12 21.4 12 18 17.8 12 17.8 2.6 12 2.6 12z"/><circle cx="12" cy="12" r="3"/>',
  medal: '<circle cx="12" cy="14.6" r="5.4"/><path d="M8.4 9.8 6 3.4h12l-2.4 6.4"/><path d="m12 12.2 1 2 2.2.3-1.6 1.6.4 2.2-2-1.1-2 1.1.4-2.2-1.6-1.6 2.2-.3z"/>',
};

function icon(name, cls) {
  return `<svg class="icon ${cls || ''}" viewBox="0 0 24 24" fill="none" stroke="currentColor"`
    + ` stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">`
    + `${ICONS[name] || ''}</svg>`;
}

/* ------------------------------------------------------------------ animals */

const ANIMALS = [
  { e: '🦊', n: 'Fox' }, { e: '🐼', n: 'Panda' }, { e: '🐯', n: 'Tiger' }, { e: '🦁', n: 'Lion' },
  { e: '🐸', n: 'Frog' }, { e: '🐙', n: 'Octopus' }, { e: '🐵', n: 'Monkey' }, { e: '🦉', n: 'Owl' },
  { e: '🐨', n: 'Koala' }, { e: '🐷', n: 'Pig' }, { e: '🐧', n: 'Penguin' }, { e: '🐢', n: 'Turtle' },
  { e: '🦄', n: 'Unicorn' }, { e: '🐝', n: 'Bee' }, { e: '🐳', n: 'Whale' }, { e: '🦖', n: 'Dino' },
  { e: '🐹', n: 'Hamster' }, { e: '🦜', n: 'Parrot' }, { e: '🐺', n: 'Wolf' }, { e: '🐮', n: 'Cow' },
  { e: '🐰', n: 'Bunny' }, { e: '🦈', n: 'Shark' }, { e: '🐬', n: 'Dolphin' }, { e: '🦒', n: 'Giraffe' },
];

function animalOf(i) {
  const n = ANIMALS.length;
  const idx = ((Math.trunc(i) || 0) % n + n) % n;
  return { ...ANIMALS[idx], index: idx };
}

function animalColors(i) {
  const h = ((Math.trunc(i) || 0) * 360) / ANIMALS.length + 6;
  return { c1: `hsl(${h} 88% 63%)`, c2: `hsl(${(h + 28) % 360} 82% 45%)` };
}

function avatarHtml(i, cls) {
  const a = animalOf(i);
  const { c1, c2 } = animalColors(a.index);
  return `<span class="avatar ${cls || ''}" style="--c1:${c1};--c2:${c2}" `
    + `title="${a.n}" role="img" aria-label="${a.n}">${a.e}</span>`;
}

/* ------------------------------------------------------------- shape icons */

const SHAPES = [
  '<svg viewBox="0 0 24 24" fill="#fff" aria-hidden="true"><path d="M12 3.6 22 20.6H2z"/></svg>',
  '<svg viewBox="0 0 24 24" fill="#fff" aria-hidden="true"><path d="M12 2.2 21.8 12 12 21.8 2.2 12z"/></svg>',
  '<svg viewBox="0 0 24 24" fill="#fff" aria-hidden="true"><circle cx="12" cy="12" r="9.6"/></svg>',
  '<svg viewBox="0 0 24 24" fill="#fff" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2.6"/></svg>',
];

function shapeHtml(i) { return `<span class="shape">${SHAPES[i] || SHAPES[0]}</span>`; }

/* -------------------------------------------------------------- clock sync */

function createSync() {
  let offset = 0; // serverNow - localNow
  return {
    sample(serverNow) {
      if (!serverNow) return;
      const sampleOffset = serverNow - Date.now();
      offset = offset === 0 ? sampleOffset : offset * 0.6 + sampleOffset * 0.4;
    },
    now() { return Date.now() + offset; },
    remaining(endsAt) { return Math.max(0, endsAt - this.now()); },
  };
}

/* ------------------------------------------------------------------- live  */

function connectStream(role, params, handlers) {
  const qs = new URLSearchParams({ role, ...params });
  let es;
  let retry = 0;
  let closed = false;

  function open() {
    es = new EventSource(`/events?${qs.toString()}`);
    es.addEventListener('hello', (e) => {
      retry = 0;
      const d = JSON.parse(e.data);
      handlers.sync && handlers.sync(d.serverNow);
    });
    es.addEventListener('ping', (e) => {
      const d = JSON.parse(e.data);
      handlers.sync && handlers.sync(d.serverNow);
      handlers.ping && handlers.ping(d);
    });
    es.addEventListener('state', (e) => {
      const d = JSON.parse(e.data);
      handlers.sync && handlers.sync(d.serverNow);
      handlers.state(d);
    });
    es.onerror = () => {
      if (closed) return;
      es.close();
      retry = Math.min(retry + 1, 8);
      handlers.status && handlers.status('reconnecting');
      setTimeout(open, 400 * retry);
      if (retry >= 6 && handlers.status) handlers.status('offline');
    };
    es.onopen = () => handlers.status && handlers.status('live');
  }

  open();
  return { close() { closed = true; try { es.close(); } catch (_) {} } };
}

/* ==========================================================================
   Audio: synthesised instruments, musical cues, and a procedural music loop.
   Everything is generated in the browser - no audio files to download.
   ========================================================================== */

const Audio = (() => {
  let ctx = null;
  let master = null;
  let musicBus = null;
  let muted = localStorage.getItem('qr_muted') === '1';

  function ensure() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      try {
        ctx = new AC();
        master = ctx.createGain();
        master.gain.value = muted ? 0 : 1;
        master.connect(ctx.destination);
        musicBus = ctx.createGain();
        musicBus.gain.value = 0;
        musicBus.connect(master);
      } catch (_) { ctx = null; return null; }
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  // A single synthesised note. `bus` picks music or effects.
  function note(freq, when, dur, o) {
    const c = ensure();
    if (!c || muted) return;
    const opt = o || {};
    const t0 = Math.max(when, c.currentTime + 0.001);
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = opt.type || 'triangle';
    osc.frequency.setValueAtTime(freq, t0);
    if (opt.glide) osc.frequency.exponentialRampToValueAtTime(Math.max(20, opt.glide), t0 + dur);
    const peak = opt.gain == null ? 0.18 : opt.gain;
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.linearRampToValueAtTime(peak, t0 + (opt.attack || 0.012));
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gain).connect(opt.bus === 'music' ? musicBus : master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }

  // Warm marimba-style pluck used for taps and answers.
  function pluck(freq, at, gain) {
    note(freq, at, 0.42, { type: 'triangle', gain: (gain || 0.2), attack: 0.006 });
    note(freq * 2, at, 0.22, { type: 'sine', gain: (gain || 0.2) * 0.35, attack: 0.004 });
  }

  function setMuted(next) {
    muted = next;
    localStorage.setItem('qr_muted', muted ? '1' : '0');
    const c = ensure();
    if (c) {
      master.gain.cancelScheduledValues(c.currentTime);
      master.gain.linearRampToValueAtTime(muted ? 0 : 1, c.currentTime + 0.18);
    }
  }

  return {
    unlock: () => !!ensure(),
    isMuted: () => muted,
    toggleMute() { setMuted(!muted); if (!muted) pluck(720, 0, 0.14); return muted; },
    context: ensure,
    music: () => { ensure(); return musicBus; },

    join() { pluck(587, 0, 0.16); pluck(880, 0.1, 0.14); },
    click() { pluck(660, 0, 0.1); },
    answer(i) {
      const scale = [523.25, 587.33, 659.25, 783.99];
      pluck(scale[i % 4], 0, 0.2);
    },
    tick() { note(1180, 0, 0.05, { type: 'sine', gain: 0.06 }); },
    urgent() { pluck(988, 0, 0.13); pluck(988, 0.13, 0.1); },
    correct() { [659.25, 830.6, 987.77, 1318.5].forEach((f, i) => pluck(f, i * 0.09, 0.19)); },
    wrong() {
      note(311.13, 0, 0.3, { type: 'sine', gain: 0.16 });
      note(233.08, 0.13, 0.42, { type: 'sine', gain: 0.15 });
    },
    start() { [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => pluck(f, i * 0.11, 0.2)); },
    podium() {
      [523.25, 659.25, 783.99, 1046.5, 1318.5, 1568].forEach((f, i) => pluck(f, i * 0.15, 0.21));
      [130.81, 164.81, 196, 261.63].forEach((f, i) => note(f, i * 0.6, 1.1, { type: 'sine', gain: 0.1 }));
    },
    whoosh() { note(420, 0, 0.32, { type: 'sine', gain: 0.11, glide: 150 }); },
  };
})();

/* Backwards-compatible alias for the screens that still call Sound.* */
const Sound = Audio;

/* ---------------------------------------------------------- background music */

const Music = (() => {
  const MOODS = {
    lobby: {
      bpm: 96,
      chords: [
        [261.63, 329.63, 392.0], [196.0, 246.94, 293.66],
        [220.0, 261.63, 329.63], [174.61, 220.0, 261.63],
      ],
      bass: [130.81, 98.0, 110.0, 87.31],
      walk: [0, 1, 2, 1, 2, 1, 2, 1],
      type: 'sine', level: 0.075,
    },
    game: {
      bpm: 126,
      chords: [
        [261.63, 329.63, 392.0], [349.23, 440.0, 523.25],
        [392.0, 493.88, 587.33], [349.23, 440.0, 523.25],
      ],
      bass: [130.81, 174.61, 196.0, 174.61],
      walk: [0, 2, 1, 2, 0, 2, 1, 2],
      type: 'triangle', level: 0.07,
    },
  };

  let mood = null;
  let timer = null;
  let step = 0;
  let nextTime = 0;
  const LOOKAHEAD = 0.12;

  function schedule() {
    const c = Audio.context();
    if (!c || !mood) return;
    const m = MOODS[mood];
    const eighth = 60 / m.bpm / 2;
    if (nextTime < c.currentTime) nextTime = c.currentTime + 0.06;
    while (nextTime < c.currentTime + LOOKAHEAD) {
      const inBar = step % 8;
      const bar = Math.floor(step / 8) % m.chords.length;
      const chord = m.chords[bar];
      noteMusic(chord[m.walk[inBar]], nextTime, eighth * 1.7, m.type, m.level);
      if (inBar === 0 || inBar === 4) noteMusic(m.bass[bar], nextTime, eighth * 2.6, 'sine', m.level * 1.5);
      if (inBar === 6) noteMusic(chord[2] * 2, nextTime, eighth * 0.9, 'sine', m.level * 0.6);
      step++;
      nextTime += eighth;
    }
  }

  function noteMusic(freq, when, dur, type, gain) {
    const c = Audio.context();
    if (!c) return;
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, when);
    g.gain.setValueAtTime(0.0001, when);
    g.gain.linearRampToValueAtTime(gain, when + 0.05);
    g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    const bus = Audio.music();
    if (!bus) return;
    osc.connect(g).connect(bus);
    osc.start(when);
    osc.stop(when + dur + 0.05);
  }

  function fade(to, seconds) {
    const b = Audio.music();
    const c = Audio.context();
    if (!b || !c) return;
    b.gain.cancelScheduledValues(c.currentTime);
    b.gain.setValueAtTime(b.gain.value, c.currentTime);
    b.gain.linearRampToValueAtTime(to, c.currentTime + seconds);
  }

  return {
    start(next) {
      const c = Audio.context();
      if (!c) return;
      if (!Audio.music()) return;
      if (mood === next && timer) { fade(1, 0.6); return; }
      mood = next;
      step = 0;
      nextTime = c.currentTime + 0.1;
      fade(1, 1.1);
      if (!timer) timer = setInterval(schedule, 40);
      schedule();
    },
    stop() {
      fade(0, 0.6);
      const t = timer;
      timer = null;
      mood = null;
      if (t) setTimeout(() => clearInterval(t), 900);
    },
    isPlaying: () => !!timer,
  };
})();

// Browsers block audio until the user touches the page once.
['click', 'touchstart', 'keydown', 'pointerdown'].forEach((ev) =>
  document.addEventListener(ev, () => Audio.unlock(), { once: true })
);

/* ---------------------------------------------------------------- confetti */

function confetti(durationMs = 4500) {
  let canvas = $('#confetti');
  if (!canvas) {
    canvas = document.createElement('canvas');
    canvas.id = 'confetti';
    document.body.appendChild(canvas);
  }
  const ctx = canvas.getContext('2d');
  function size() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  }
  size();
  window.addEventListener('resize', size);

  const colors = ['#ffd166', '#ff5d73', '#4cc9f0', '#7ee787', '#ff9f45', '#ffffff'];
  const parts = Array.from({ length: 180 }, () => ({
    x: Math.random() * canvas.width,
    y: -Math.random() * canvas.height * 0.6,
    w: 6 + Math.random() * 8,
    h: 8 + Math.random() * 12,
    vy: 1.6 + Math.random() * 3.4,
    vx: -1.4 + Math.random() * 2.8,
    rot: Math.random() * Math.PI,
    vr: -0.12 + Math.random() * 0.24,
    color: colors[(Math.random() * colors.length) | 0],
  }));

  const start = performance.now();
  (function frame(t) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (const p of parts) {
      p.x += p.vx;
      p.y += p.vy;
      p.rot += p.vr;
      if (p.y > canvas.height + 30) { p.y = -20; p.x = Math.random() * canvas.width; }
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    }
    if (t - start < durationMs) requestAnimationFrame(frame);
    else ctx.clearRect(0, 0, canvas.width, canvas.height);
  })(start);
}

/* ------------------------------------------------------------------- toast */

let toastTimer = null;
function toast(msg, ms = 2200) {
  let el = $('#toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.className = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

/* ------------------------------------------------------------------- utils */

async function post(url, data) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data || {}),
  });
  let body = {};
  try { body = await res.json(); } catch (_) {}
  return { ok: res.ok, status: res.status, ...body };
}

// Drifting animal silhouettes behind the content.
function addFloaters(container, count = 10) {
  if (!container) return;
  const pool = ['🦊', '🐼', '🐸', '🦉', '🐙', '🐝', '🐧', '🦄', '🐨', '🦜', '🐳', '🐢'];
  for (let i = 0; i < count; i++) {
    const s = document.createElement('span');
    s.textContent = pool[i % pool.length];
    s.style.left = `${(Math.random() * 92).toFixed(2)}%`;
    s.style.top = `${(Math.random() * 90).toFixed(2)}%`;
    s.style.animationDelay = `${(Math.random() * 8).toFixed(2)}s`;
    s.style.animationDuration = `${(11 + Math.random() * 9).toFixed(1)}s`;
    s.style.fontSize = `${24 + Math.random() * 30}px`;
    container.appendChild(s);
  }
}
