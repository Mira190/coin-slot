// Coin Slot lobby: builds the accessible DOM (cards + mini cabinet links) from Arcade.catalog,
// runs the entrance sequence, sound, card tilt, posters/previews and the warp-into-game transition.
// The WebGL layer (arcade/lobby3d.js) is loaded afterwards and only decorates this DOM.
(function () {
  'use strict';
  const A = window.Arcade;
  const $ = (s, el) => (el || document).querySelector(s);
  const root = document.documentElement;
  const SELF = (document.currentScript && document.currentScript.src) || new URL('arcade/lobby.js', location.href).href;

  // old deep links (index.html#coil) -> the game's own route
  const hash = location.hash.slice(1);
  if (A.catalog.some((c) => c.id === hash)) { location.replace('games/' + hash + '/'); return; }

  const mq = (q) => window.matchMedia && window.matchMedia(q).matches;
  const reduce = mq('(prefers-reduced-motion: reduce)');
  const finePointer = mq('(hover: hover) and (pointer: fine)');
  const store = (s) => ({
    get(k) { try { return window[s].getItem(k); } catch (e) { return null; } },
    set(k, v) { try { window[s].setItem(k, v); } catch (e) { /* ignore */ } }
  });
  const local = store('localStorage'), sess = store('sessionStorage');
  const fmt = (n) => String(Math.max(0, Math.floor(n || 0))).padStart(6, '0');
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  // controls hints for page games whose card.js has no `controls` field (a def's own `controls` wins)
  const HINTS = {
    'windrift': '↑↓←→ drive · Shift drift',
    'cargo-deck': 'WASD move · mouse aim · click fire',
    'pelican-pedal': 'WASD / arrows pedal & steer',
    'cloudspire': '←→ lanes · ↑ jump · ↓ slide'
  };
  const PAL = ['#FF5D73', '#3DDCFF', '#FFD23F', '#5CF2A5', '#A58BFF', '#FF9F43'];

  const L = window.Lobby = {
    reduce, defs: [], minis: [], hot: -1, scroll: 0,
    pointer: { x: 0, y: 0 }, vis: { hero: true, row: false },
    intro: { kind: 'none', start: performance.now(), skip: false },
    zoom: null, glReady: false, t: 0
  };

  // ---------- sound (WebAudio, silent until the first user gesture; shares the cabinets' mute key) ----------
  let actx = null;
  let muted = local.get('coinslot-muted') === 'true';
  const soundBtn = $('#sound');
  function syncSound() {
    soundBtn.setAttribute('aria-pressed', String(!muted));
    soundBtn.setAttribute('aria-label', muted ? 'Sound off' : 'Sound on');
    soundBtn.classList.toggle('off', muted);
  }
  syncSound();
  function unlock() {
    if (!actx) { try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { actx = null; } }
    if (actx && actx.state === 'suspended') actx.resume().catch(() => {});
  }
  ['pointerdown', 'keydown'].forEach((ev) => addEventListener(ev, unlock, { passive: true }));
  function tone(f, dur, type, to, vol, delay) {
    const t0 = actx.currentTime + (delay || 0);
    const o = actx.createOscillator(), g = actx.createGain();
    o.type = type; o.frequency.setValueAtTime(f, t0);
    if (to) o.frequency.exponentialRampToValueAtTime(to, t0 + dur);
    g.gain.setValueAtTime(vol, t0); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(actx.destination); o.start(t0); o.stop(t0 + dur + 0.02);
  }
  let lastBlip = 0;
  const SFX = {
    blip() { const n = performance.now(); if (n - lastBlip < 70) return; lastBlip = n; tone(880, 0.045, 'square', 0, 0.025); },
    coin() { tone(988, 0.07, 'square', 0, 0.045); tone(1319, 0.22, 'square', 0, 0.045, 0.07); },
    warp() { tone(180, 0.5, 'sawtooth', 1400, 0.03); }
  };
  const sfx = (n) => { if (muted || !actx || actx.state !== 'running') return; try { SFX[n](); } catch (e) { /* ignore */ } };
  soundBtn.addEventListener('click', () => { muted = !muted; local.set('coinslot-muted', String(muted)); syncSound(); unlock(); sfx('coin'); });

  // ---------- load every game's lobby definition (in catalog order) ----------
  let pending = A.catalog.length;
  A.catalog.forEach((c) => {
    const s = document.createElement('script');
    s.src = 'games/' + c.id + '/' + (c.cabinet ? 'game.js' : 'card.js');
    s.async = false;
    s.onload = s.onerror = () => { if (--pending === 0) build(); };
    document.body.appendChild(s);
  });

  const best = (id) => { const v = +local.get('coinslot-best-' + id); return isFinite(v) ? v : 0; };
  function hiOf(g) {
    if (g.hi) { try { const h = g.hi(); if (h) return h; } catch (e) { /* ignore */ } }
    return ['HI', fmt(best(g.id))];
  }
  const hintOf = (g) => (Array.isArray(g.controls) ? g.controls[0] : g.controls) || HINTS[g.id] || '';

  function drawArt(d, ctx, scale, t) {
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    try { ctx.save(); d.g.art(ctx, 320, 200, t); ctx.restore(); } catch (err) { ctx.restore(); ctx.fillStyle = '#20244A'; ctx.fillRect(0, 0, 320, 200); }
  }
  L.drawArt = drawArt;

  function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }

  function build() {
    const defs = A.catalog.map((c, i) => ({ c, g: A.games.find((g) => g.id === c.id) })).filter((x) => x.g);
    defs.forEach((d, i) => { d.i = i; d.color = d.g.color || PAL[i % PAL.length]; d.hint = hintOf(d.g); d.v = 0; });
    L.defs = defs;
    const feats = defs.filter((d) => !d.c.cabinet), minis = defs.filter((d) => d.c.cabinet);
    $('#count').textContent = defs.length;
    $('#stat-games').textContent = String(defs.length).padStart(2, '0');
    $('#mini-count').textContent = minis.length + ' quick 2D games on the back row. Pick a machine.';
    if (feats[0]) $('#cta-play').href = 'games/' + feats[0].g.id + '/';

    feats.forEach((d, k) => buildCard(d, k));
    minis.forEach((d, k) => buildMini(d, k));
    L.minis = minis;
    if (!minis.length) $('#back-row').hidden = true;

    watch();
    loop();
    load3d();
  }

  // ---------- main stage cards ----------
  function buildCard(d, k) {
    const g = d.g;
    const a = el('a', 'gcard rv-io' + (k === 0 ? ' hero-card' : ''));
    a.href = 'games/' + g.id + '/';
    a.style.setProperty('--c', d.color);
    a.style.setProperty('--d', k % 2);
    const media = el('div', 'gc-media');
    const cv = el('canvas'); cv.width = 640; cv.height = 400; cv.setAttribute('aria-hidden', 'true');
    const img = el('img'); img.alt = ''; img.decoding = 'async'; img.loading = k < 2 ? 'eager' : 'lazy';
    media.append(cv, img, el('span', 'gc-glare'), el('span', 'gc-scan'));
    const body = el('div', 'gc-body');
    const top = el('div', 'gc-top');
    top.append(el('span', 'chip', g.genre));
    if (k === 0) top.append(el('span', 'badge', 'Featured'));
    const hi = hiOf(g);
    const hiEl = el('span', 'hi'); hiEl.append(el('span', null, hi[0]), el('b', null, hi[1]));
    const foot = el('div', 'gc-foot');
    foot.append(hiEl);
    if (d.hint) { const kh = el('span', 'keys', d.hint); foot.append(kh); }
    foot.append(el('span', 'play', 'Play ▸'));
    body.append(top, el('h3', null, g.title), el('p', 'gc-tag', g.tagline), foot);
    a.append(media, body);
    $('#featured').appendChild(a);

    Object.assign(d, { el: a, cv, ctx: cv.getContext('2d'), hiEl, poster: false, seen: false });
    drawArt(d, d.ctx, 2, 0);
    img.onload = () => { d.poster = true; img.classList.add('ok'); };
    img.onerror = () => img.remove();
    img.src = 'games/' + g.id + '/poster.webp';

    a.addEventListener('pointerenter', () => { sfx('blip'); preview(d, true); });
    a.addEventListener('pointerleave', () => { preview(d, false); a.style.removeProperty('--rx'); a.style.removeProperty('--ry'); a.classList.remove('tilt'); });
    a.addEventListener('focus', () => preview(d, true));
    a.addEventListener('blur', () => preview(d, false));
    if (finePointer && !reduce) {
      a.addEventListener('pointermove', (e) => {
        const r = a.getBoundingClientRect();
        const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
        a.classList.add('tilt');
        a.style.setProperty('--rx', ((0.5 - y) * (k === 0 ? 5 : 9)).toFixed(2) + 'deg');
        a.style.setProperty('--ry', ((x - 0.5) * (k === 0 ? 7 : 12)).toFixed(2) + 'deg');
        a.style.setProperty('--gx', (x * 100).toFixed(1) + '%');
        a.style.setProperty('--gy', (y * 100).toFixed(1) + '%');
      });
    }
    a.addEventListener('click', (e) => warp(e, d, media));
  }

  // hover/focus preview: games/<id>/preview.webm if it exists (tried once per card)
  function preview(d, on) {
    if (reduce) return;
    if (on && !d.vid && !d.noVid) {
      const v = el('video', 'gc-vid');
      v.muted = true; v.loop = true; v.playsInline = true; v.preload = 'auto'; v.setAttribute('aria-hidden', 'true');
      v.onerror = () => { d.noVid = true; v.remove(); d.vid = null; };
      v.addEventListener('loadeddata', () => { if (d.want) { v.play().catch(() => {}); v.classList.add('on'); } }, { once: true });
      v.src = 'games/' + d.g.id + '/preview.webm';
      d.el.querySelector('.gc-glare').before(v);
      d.vid = v;
    }
    d.want = on;
    if (!d.vid || d.vid.readyState < 2) return;
    if (on) { d.vid.play().catch(() => {}); d.vid.classList.add('on'); }
    else { d.vid.classList.remove('on'); d.vid.pause(); }
  }

  // ---------- mini cabinets (real links; lobby3d renders a 3D machine into each .mini-view) ----------
  function buildMini(d, k) {
    const g = d.g;
    const li = el('li');
    const a = el('a', 'mini rv-io');
    a.href = 'games/' + g.id + '/';
    a.style.setProperty('--c', d.color);
    a.style.setProperty('--d', k);
    const view = el('div', 'mini-view');
    const shell = el('div', 'mini-shell'); shell.setAttribute('aria-hidden', 'true');
    const marq = el('span', 'mini-marq', g.title);
    const scr = el('div', 'mini-screen');
    const cv = el('canvas', 'mini-art'); cv.width = 640; cv.height = 400;
    const img = el('img', 'mini-poster'); img.alt = ''; img.loading = 'lazy'; img.decoding = 'async';
    img.onload = () => img.classList.add('ok'); img.onerror = () => img.remove();
    img.src = 'games/' + g.id + '/poster.webp';
    scr.append(cv, img);
    shell.append(marq, scr, el('span', 'mini-deck'));
    view.append(shell);
    const plate = el('div', 'mini-plate');
    const hi = hiOf(g);
    const hiEl = el('span', 'hi'); hiEl.append(el('span', null, hi[0]), el('b', null, hi[1]));
    plate.append(el('h3', null, g.title), el('span', 'chip', g.genre), hiEl);
    if (d.hint) plate.append(el('span', 'keys', d.hint));
    a.append(view, plate);
    li.append(a);
    $('#minis').appendChild(li);
    Object.assign(d, { el: a, view, cv, ctx: cv.getContext('2d'), hiEl, k });
    drawArt(d, d.ctx, 2, 0);
    const on = () => { if (L.hot !== k) sfx('blip'); L.hot = k; a.classList.add('hot'); };
    const off = () => { if (L.hot === k) L.hot = -1; a.classList.remove('hot'); };
    a.addEventListener('pointerenter', on); a.addEventListener('pointerleave', off);
    a.addEventListener('focus', on); a.addEventListener('blur', off);
    a.addEventListener('click', (e) => warp(e, d, view, k));
  }

  // ---------- visibility, scroll, pointer ----------
  function watch() {
    const hero = $('#hero');
    const io = new IntersectionObserver((es) => es.forEach((e) => {
      if (e.target === hero) L.vis.hero = e.isIntersecting;
      else if (e.target.id === 'back-row') L.vis.row = e.isIntersecting;
      else if (e.target._d) e.target._d.seen = e.isIntersecting;
    }), { rootMargin: '120px 0px' });
    io.observe(hero); io.observe($('#back-row'));
    L.defs.forEach((d) => { if (!d.c.cabinet) { d.el._d = d; io.observe(d.el); } });

    // staggered rise-in for sections and cards as they enter
    const rise = new IntersectionObserver((es) => es.forEach((e) => {
      if (e.isIntersecting) { e.target.classList.add('in'); rise.unobserve(e.target); }
    }), { rootMargin: '0px 0px -8% 0px' });
    document.querySelectorAll('.rv-io').forEach((n) => rise.observe(n));

    const nav = $('.nav');
    let ticking = false;
    function onScroll() {
      ticking = false;
      const span = Math.max(1, hero.offsetHeight - innerHeight);
      L.scroll = clamp(scrollY / span, 0, 1);
      hero.style.setProperty('--p', L.scroll.toFixed(4));
      nav.classList.toggle('solid', scrollY > innerHeight * 0.6);
    }
    addEventListener('scroll', () => { if (!ticking) { ticking = true; requestAnimationFrame(onScroll); } }, { passive: true });
    addEventListener('resize', onScroll);
    onScroll();
    addEventListener('pointermove', (e) => {
      L.pointer.x = (e.clientX / innerWidth) * 2 - 1;
      L.pointer.y = (e.clientY / innerHeight) * 2 - 1;
    }, { passive: true });

    // back from a game (bfcache): undo the warp, refresh high scores
    addEventListener('pageshow', (e) => {
      if (!e.persisted) return;
      document.querySelectorAll('.warp').forEach((w) => w.remove());
      L.warping = false; L.zoom = null;
      L.defs.forEach((d) => { const h = hiOf(d.g); d.hiEl.firstChild.textContent = h[0]; d.hiEl.lastChild.textContent = h[1]; });
    });
  }

  // ---------- art ticker: animates the 2D posters that are actually on screen (~30 fps) ----------
  let last = 0, acc = 0;
  function loop() {
    if (reduce) return;
    requestAnimationFrame(function f(ts) {
      requestAnimationFrame(f);
      const dt = last ? Math.min(0.05, (ts - last) / 1000) : 0; last = ts;
      L.t += dt; acc += dt;
      if (acc < 1 / 30 || document.hidden) return;
      acc = 0;
      L.defs.forEach((d) => {
        if (d.c.cabinet) { if (L.vis.row) { drawArt(d, d.ctx, 2, L.t); d.v++; } }
        else if (d.seen && !d.poster) drawArt(d, d.ctx, 2, L.t);
      });
    });
  }

  // ---------- warp into a game: zoom into the screen, expand to the viewport, navigate ----------
  function warp(e, d, media, miniIndex) {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    if (L.warping) return;
    L.warping = true;
    unlock(); sfx('coin');
    const href = d.el.href;
    const nav = () => location.assign(href);
    if (reduce) { nav(); return; }
    sfx('warp');

    const w = el('div', 'warp');
    const img = media.querySelector('img.ok');
    if (img) w.append(img.cloneNode());
    else { const c = el('canvas'); c.width = 640; c.height = 400; c.getContext('2d').drawImage(d.cv, 0, 0); w.append(c); }
    w.append(el('span', 'warp-title', d.g.title));
    const r = media.getBoundingClientRect();
    const isMini = miniIndex != null;
    const delay = isMini && L.glReady ? 380 : 0;
    if (isMini && L.glReady) L.zoom = { k: miniIndex, t0: performance.now(), dur: 420 };

    setTimeout(() => {
      // same-document View Transition where supported (cards only: minis are drawn by WebGL under the DOM)
      if (document.startViewTransition && !isMini) {
        media.style.viewTransitionName = 'warp';
        const vt = document.startViewTransition(() => {
          media.style.viewTransitionName = '';
          w.style.viewTransitionName = 'warp';
          w.classList.add('full');
          document.body.append(w);
        });
        vt.ready.catch(() => {}); vt.updateCallbackDone.catch(() => {});
        vt.finished.then(() => setTimeout(nav, 120), nav);
        return;
      }
      // fallback: FLIP a fixed clone from the media rect to the full viewport
      const s = isMini && L.glReady ? screenRect(r) : r;
      Object.assign(w.style, { left: s.left + 'px', top: s.top + 'px', width: s.width + 'px', height: s.height + 'px' });
      document.body.append(w);
      const anim = w.animate([
        { left: s.left + 'px', top: s.top + 'px', width: s.width + 'px', height: s.height + 'px', borderRadius: '10px' },
        { left: '0px', top: '0px', width: innerWidth + 'px', height: innerHeight + 'px', borderRadius: '0px' }
      ], { duration: 460, easing: 'cubic-bezier(.7,0,.2,1)', fill: 'forwards' });
      anim.onfinish = () => { w.classList.add('full', 'flash'); setTimeout(nav, 140); };
    }, delay);
    setTimeout(nav, 2500); // never strand the player if an animation stalls
  }
  // after the 3D zoom the screen fills the middle of the view
  function screenRect(r) {
    const w = r.width * 0.92, h = w * 0.625;
    return { left: r.left + (r.width - w) / 2, top: r.top + (r.height - h) / 2, width: w, height: h };
  }

  // ---------- entrance sequence ----------
  const intro = $('#intro');
  (function startIntro() {
    const kind = root.dataset.intro || 'none';   // chosen by the inline script in <head>, before first paint
    L.intro.kind = kind;
    if (kind === 'none') { intro.remove(); return; }
    L.intro.start = Infinity;   // lobby3d holds the hall dark until reveal() sets this
    let done = false, timers = [];
    const later = (fn, ms) => timers.push(setTimeout(fn, ms));
    function finish() {
      if (done) return; done = true;
      timers.forEach(clearTimeout);
      L.intro.skip = true;
      root.classList.remove('intro-wait', 'intro-go', 'intro-crt', 'intro-full', 'intro-short');
      intro.remove();
      ['keydown', 'pointerdown', 'wheel', 'touchstart'].forEach((ev) => removeEventListener(ev, skip, true));
    }
    function skip() { if (!done) finish(); }
    ['keydown', 'pointerdown', 'wheel', 'touchstart'].forEach((ev) => addEventListener(ev, skip, { capture: true, passive: true }));
    L.skipIntro = skip;
    if (scrollY > 40) { finish(); return; }   // reload with a restored scroll position: no show

    function reveal() {
      L.intro.start = performance.now();
      root.classList.add('intro-crt');
      later(() => root.classList.add('intro-go'), kind === 'full' ? 700 : 150);
      later(finish, kind === 'full' ? 1900 : 1300);
    }
    if (kind === 'short') { intro.remove(); reveal(); return; }
    // full: coin drops (0.7 s), wait briefly for the 3D hall, then the CRT opens
    const t0 = performance.now();
    later(() => sfx('coin'), 560);
    later(function waitGl() {
      if (L.glReady || L.glFailed || performance.now() - t0 > 2000) reveal();
      else later(waitGl, 60);
    }, 760);
  })();

  // ---------- WebGL layer ----------
  function load3d() {
    let ok = false;
    try { const c = document.createElement('canvas'); ok = !!(c.getContext('webgl2') || c.getContext('webgl')); } catch (e) { ok = false; }
    const fail = (err) => { L.glFailed = true; root.classList.add('no-gl'); if (err) console.warn('Coin Slot: 3D lobby unavailable', err); };
    if (!ok) { fail(); return; }
    import(new URL('lobby3d.js', SELF).href)
      .then((m) => m.start(L))
      .then(() => { L.glReady = true; root.classList.add('gl'); })
      .catch(fail);
  }
})();
