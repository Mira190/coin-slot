// Coin Slot cabinet: runs one registered canvas game full-screen (games/<id>/index.html).
// Games register { id, title, genre, tagline, controls, pad, width, height, art, create(host) }.
(function () {
  'use strict';
  const $ = (s) => document.querySelector(s);
  const PALETTE = { ink: '#0D0F22', cab: '#171A36', cab2: '#20244A', line: '#2E3366', text: '#ECEAFF', muted: '#A3A2CC', marquee: '#FFD23F', coral: '#FF5D73', cyan: '#3DDCFF', mint: '#5CF2A5' };
  const LOBBY = '../../';
  const def0 = Arcade.games[0];   // each cabinet page loads exactly one game module

  document.body.insertAdjacentHTML('beforeend',
    '<section class="stage" id="stage" aria-label="Game">' +
    '<div class="bar">' +
    '<a class="btn" id="back" href="' + LOBBY + '" aria-label="Back to games">←<span class="lbl"> Games</span></a>' +
    '<h2 id="g-title">Game</h2>' +
    '<div class="readout"><span>SCORE</span><b id="g-score">000000</b></div>' +
    '<div class="readout hi-r"><span>HI</span><b id="g-best">000000</b></div>' +
    '<button class="btn" id="pause" type="button" aria-label="Pause">❚❚</button>' +
    '<button class="btn" id="mute" type="button" aria-label="Toggle sound">Sound on</button>' +
    '</div>' +
    '<div class="play-area" id="area"><div class="screen" id="screen"><canvas id="cv"></canvas><div class="overlay" id="ov"></div></div></div>' +
    '<div class="pad" id="pad"></div></section>');

  // ---------- storage ----------
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* ignore */ } }
  };
  const bestOf = (id) => store.get('coinslot-best-' + id, 0) || 0;
  const fmt = (n) => String(Math.max(0, Math.floor(n || 0))).padStart(6, '0');

  // ---------- sound ----------
  let actx = null;
  let muted = !!store.get('coinslot-muted', false);
  function audio() {
    if (!actx) { try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { actx = null; } }
    if (actx && actx.state === 'suspended') { actx.resume().catch(() => {}); }
    return actx;
  }
  function tone(f, dur, type, to, vol, delay) {
    const a = actx; if (!a) return;
    const t0 = a.currentTime + (delay || 0);
    const o = a.createOscillator(), g = a.createGain();
    o.type = type || 'square';
    o.frequency.setValueAtTime(f, t0);
    if (to) o.frequency.exponentialRampToValueAtTime(to, t0 + dur);
    g.gain.setValueAtTime(vol || 0.08, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(a.destination); o.start(t0); o.stop(t0 + dur + 0.02);
  }
  const SFX = {
    coin() { tone(988, 0.06, 'square', 0, 0.05); tone(1319, 0.12, 'square', 0, 0.05, 0.06); },
    jump() { tone(320, 0.15, 'triangle', 640, 0.1); },
    flap() { tone(480, 0.08, 'triangle', 720, 0.08); },
    hit() { tone(200, 0.3, 'sawtooth', 60, 0.08); },
    blip() { tone(660, 0.05, 'square', 0, 0.04); },
    clear() { tone(523, 0.08, 'square', 0, 0.05); tone(659, 0.08, 'square', 0, 0.05, 0.08); tone(784, 0.14, 'square', 0, 0.05, 0.16); },
    boost() { tone(200, 0.25, 'sawtooth', 900, 0.04); },
    over() { tone(392, 0.6, 'triangle', 98, 0.1); }
  };
  function sfx(name) { if (muted || !actx || !SFX[name]) return; try { SFX[name](); } catch (e) { /* ignore */ } }

  // ---------- stage ----------
  const cv = $('#cv'), ctx = cv.getContext('2d');
  const ov = $('#ov'), area = $('#area'), screen = $('#screen'), pad = $('#pad');
  const elScore = $('#g-score'), elBest = $('#g-best');
  let cur = null;      // { def, inst, host, score, best }
  let state = 'idle';  // idle | ready | playing | paused | over
  let overAt = 0;
  const held = {};
  const t0 = performance.now();
  const now = () => (performance.now() - t0) / 1000;
  let view = { k: 1, dpr: 1 };

  function makeHost(def) {
    const host = {
      width: def.width, height: def.height, palette: PALETTE, time: now(),
      pointer: { x: def.width / 2, y: def.height / 2, down: false, t: -99 },
      held: (a) => !!held[a],
      score(n) { if (!cur) return; cur.score = Math.max(0, Math.floor(n || 0)); elScore.textContent = fmt(cur.score); },
      gameOver() { if (state === 'playing') endGame(); },
      sfx
    };
    return host;
  }

  function open(def) {
    audio();
    const host = makeHost(def);
    let inst;
    try { inst = def.create(host); inst.reset(); } catch (e) { console.error(e); return; }
    cur = { def, inst, host, score: 0, best: bestOf(def.id) };
    $('#g-title').textContent = def.title;
    elScore.textContent = fmt(0); elBest.textContent = fmt(cur.best);
    buildPad(def.pad || ['left', 'up', 'down', 'right', 'action']);
    document.title = def.title + ' · Coin Slot';
    document.body.style.overflow = 'hidden';
    fit();
    setState('ready');
    last = 0; if (!raf) raf = requestAnimationFrame(frame);
  }
  function close() { location.href = LOBBY; }

  function setState(s) {
    state = s;
    const d = cur.def;
    $('#pause').textContent = s === 'paused' ? '▶' : '❚❚';
    $('#pause').setAttribute('aria-label', s === 'paused' ? 'Resume' : 'Pause');
    if (s === 'playing') { ov.hidden = true; ov.innerHTML = ''; return; }
    ov.hidden = false;
    const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    if (s === 'ready') {
      ov.innerHTML = '<div class="panel"><h3>' + esc(d.title) + '</h3><p>' + esc(d.tagline) + '</p><ul>' +
        (d.controls || []).map((c) => '<li>' + esc(c) + '</li>').join('') +
        '</ul><button class="btn primary" type="button" data-do="start">Start</button><span class="hint">Space, Enter or tap to start</span></div>';
    } else if (s === 'paused') {
      ov.innerHTML = '<div class="panel"><h3>Paused</h3><div class="row"><button class="btn primary" type="button" data-do="resume">Resume</button><button class="btn" type="button" data-do="quit">Quit to games</button></div><span class="hint">P or Esc to resume</span></div>';
    } else if (s === 'over') {
      const isNew = cur.score > 0 && cur.score >= cur.best && cur.newBest;
      ov.innerHTML = '<div class="panel"><h3>Game over</h3><div class="big">' + fmt(cur.score) + '</div>' +
        (isNew ? '<span class="new">NEW HIGH SCORE</span>' : '<p>High score ' + fmt(cur.best) + '</p>') +
        '<div class="row"><button class="btn primary" type="button" data-do="again">Play again</button><button class="btn" type="button" data-do="quit">Quit to games</button></div><span class="hint">Space or Enter to play again</span></div>';
    }
    const first = ov.querySelector('.btn.primary');
    if (first) { try { first.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }
  }
  ov.addEventListener('click', (e) => {
    const b = e.target.closest('[data-do]');
    if (!b) { if (state === 'ready') start(); return; }   // "tap to start" anywhere on the ready card
    e.stopPropagation();
    if (state === 'over' && now() - overAt < 0.45) return; // restart guard also covers taps/clicks
    const k = b.getAttribute('data-do');
    if (k === 'start') start();
    else if (k === 'resume') setState('playing');
    else if (k === 'again') again();
    else if (k === 'quit') close();
  });
  ov.addEventListener('pointerdown', (e) => { if (!e.target.closest('[data-do]')) { e.preventDefault(); } });

  function start() { audio(); if (state === 'ready') { setState('playing'); } }
  function again() {
    if (!cur) return;
    try { cur.inst.reset(); } catch (e) { console.error(e); }
    cur.score = 0; cur.newBest = false; elScore.textContent = fmt(0);
    for (const k in held) held[k] = false;
    setState('playing');
  }
  function endGame() {
    if (cur.score > cur.best) { cur.best = cur.score; cur.newBest = true; store.set('coinslot-best-' + cur.def.id, cur.best); elBest.textContent = fmt(cur.best); }
    else cur.newBest = false;
    sfx('over');
    overAt = now();
    setState('over');
  }
  function togglePause() {
    if (state === 'playing') setState('paused');
    else if (state === 'paused') setState('playing');
  }

  // ---------- actions ----------
  function press(a) {
    if (!cur) return;
    const was = held[a]; held[a] = true;
    if (state === 'ready') { if (!was) start(); return; }
    if (state === 'paused') { if (a === 'action' && !was) setState('playing'); return; }
    if (state === 'over') { if (a === 'action' && !was && now() - overAt > 0.45) again(); return; }
    if (state === 'playing' && !was) { try { cur.inst.onAction && cur.inst.onAction(a); } catch (e) { console.error(e); } }
  }
  function release(a) {
    if (!held[a]) return;
    held[a] = false;
    if (cur && state === 'playing') { try { cur.inst.onRelease && cur.inst.onRelease(a); } catch (e) { console.error(e); } }
  }
  const KEYS = { ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right', ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down', Space: 'action', Enter: 'action', NumpadEnter: 'action' };
  window.addEventListener('keydown', (e) => {
    if (!cur) return;
    if (e.code === 'KeyP' || e.code === 'Escape') { e.preventDefault(); if (!e.repeat) togglePause(); return; }
    const a = KEYS[e.code]; if (!a) return;
    const fe = document.activeElement;
    if ((e.code === 'Space' || e.code === 'Enter') && fe && fe.tagName === 'BUTTON') {
      if (ov.contains(fe)) {
        // overlay buttons: Space/Enter activates them, but keep the restart guard after a game ends
        e.preventDefault();
        if (!e.repeat && !(state === 'over' && now() - overAt < 0.45)) fe.click();
        return;
      }
      // bar/pad buttons keep focus after a mouse click; hand the key to the game instead
      if (!e.repeat && state === 'playing') fe.blur();
      else if (fe.closest('.bar')) { return; }
    }
    e.preventDefault();
    if (!e.repeat) press(a);
  });
  window.addEventListener('keyup', (e) => { const a = KEYS[e.code]; if (a) release(a); });
  window.addEventListener('blur', () => { for (const k in held) release(k); if (state === 'playing') setState('paused'); });
  document.addEventListener('visibilitychange', () => { if (document.hidden && state === 'playing') setState('paused'); });

  // pointer on canvas: move = pointer, tap = action, swipe = direction
  let pStart = null;
  function toLogical(e) {
    const r = cv.getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width * cur.def.width, y: (e.clientY - r.top) / r.height * cur.def.height };
  }
  cv.addEventListener('pointerdown', (e) => {
    if (!cur) return; e.preventDefault(); audio();
    if (e.pointerType === 'touch') document.documentElement.classList.add('touch');
    const p = toLogical(e); Object.assign(cur.host.pointer, p, { down: true, t: now() });
    pStart = { x: e.clientX, y: e.clientY, id: e.pointerId, swiped: false };
    try { cv.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
  });
  cv.addEventListener('pointermove', (e) => {
    if (!cur) return;
    const p = toLogical(e); Object.assign(cur.host.pointer, p, { t: now() });
    if (pStart && pStart.id === e.pointerId && !pStart.swiped && e.pointerType === 'touch') {
      const dx = e.clientX - pStart.x, dy = e.clientY - pStart.y;
      if (Math.hypot(dx, dy) > 30 && !cur.def.pointerOnly) {
        const a = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up');
        pStart.swiped = true; press(a); release(a);
      }
    }
  });
  const endPointer = (e) => {
    if (!cur) return;
    cur.host.pointer.down = false;
    if (pStart && pStart.id === e.pointerId) {
      const moved = Math.hypot(e.clientX - pStart.x, e.clientY - pStart.y);
      if (!pStart.swiped && moved < 30 && e.type === 'pointerup') { press('action'); release('action'); }
      pStart = null;
    }
  };
  cv.addEventListener('pointerup', endPointer);
  cv.addEventListener('pointercancel', endPointer);

  // on-screen pad
  const PAD_LABEL = { left: '◀', right: '▶', up: '▲', down: '▼', action: 'GO' };
  function buildPad(list) {
    pad.innerHTML = '';
    list.forEach((a) => {
      const b = document.createElement('button');
      b.type = 'button'; b.textContent = PAD_LABEL[a] || a; b.setAttribute('aria-label', a);
      if (a === 'action') b.className = 'act';
      const down = (e) => { e.preventDefault(); audio(); b.classList.add('on'); press(a); };
      const up = (e) => { e.preventDefault(); b.classList.remove('on'); release(a); };
      b.addEventListener('pointerdown', down);
      b.addEventListener('pointerup', up); b.addEventListener('pointercancel', up); b.addEventListener('pointerleave', up);
      b.addEventListener('contextmenu', (e) => e.preventDefault());
      pad.appendChild(b);
    });
    if (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) document.documentElement.classList.add('touch');
    requestAnimationFrame(fit);
  }

  $('#pause').addEventListener('click', () => { if (state === 'ready') start(); else togglePause(); });
  const muteBtn = $('#mute');
  function paintMute() { muteBtn.innerHTML = '♪<span class="lbl"> ' + (muted ? 'Sound off' : 'Sound on') + '</span>'; muteBtn.classList.toggle('off', muted); muteBtn.setAttribute('aria-pressed', String(!muted)); }
  muteBtn.addEventListener('click', () => { muted = !muted; store.set('coinslot-muted', muted); audio(); paintMute(); });
  paintMute();

  // ---------- sizing ----------
  function fit() {
    if (!cur) return;
    const d = cur.def;
    const aw = Math.max(100, area.clientWidth - 32), ah = Math.max(100, area.clientHeight - 28);
    const k = Math.min(aw / d.width, ah / d.height);
    const w = Math.floor(d.width * k), h = Math.floor(d.height * k);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.style.width = w + 'px'; cv.style.height = h + 'px';
    cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
    view = { k: (w / d.width) * dpr, ky: (h / d.height) * dpr };
  }
  if (window.ResizeObserver) new ResizeObserver(() => fit()).observe(area);
  window.addEventListener('resize', fit);

  // ---------- loop ----------
  let raf = 0, last = 0;
  function frame(ts) {
    raf = requestAnimationFrame(frame);
    const dt = last ? Math.min(0.05, Math.max(0, (ts - last) / 1000)) : 0;
    last = ts;
    if (cur) {
      cur.host.time = now();
      if (state === 'playing') { try { cur.inst.update(dt); } catch (e) { console.error(e); } }
      ctx.setTransform(view.k, 0, 0, view.ky, 0, 0);
      ctx.save();
      try { cur.inst.render(ctx); } catch (e) { console.error(e); }
      ctx.restore();
    }
  }
  raf = requestAnimationFrame(frame);

  open(def0);
  // mouse clicks on bar buttons shouldn't leave focus there (Space/Enter belong to the game)
  document.querySelectorAll('.bar .btn').forEach((b) => b.addEventListener('click', (e) => { if (e.detail > 0) b.blur(); }));
  window.CoinSlot = { open: () => open(def0), close, get state() { return state; }, get score() { return cur ? cur.score : 0; } };
})();
