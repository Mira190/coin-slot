// Folded Steps: DOM layer. HUD, toasts, level banner, chapter title cards, the win card, the title screen
// and the constellation map where every finished level is a lit star.
import { CHAPTERS } from './palettes.js';
import { LEVELS } from './levels.js';
import * as S from './save.js';

const $ = (s) => document.querySelector(s);
const TIPS = {
  threshold: 'Tap a tile to walk. Some roads only meet where your eye says they do.',
  garden: 'Drag the crank to turn the garden. You may ride it while it turns.',
  endless: 'The whole stair turns on its crank. Where you stand when it stops matters.',
  lift: 'Drag the lift’s handle up or down. Each floor lines up with different doors.',
  winds: 'The great wheel turns the whole world. Only the illusions change.',
  sunken: 'Plates wake what sleeps beneath the water.',
  spire: 'Walls marked with chevrons can be walked. Turn the spire while you cling to it.',
  wardens: 'Wardens will not let you pass, but they can be carried away.',
  bell: 'A warden standing on a plate holds it down, and wardens can be carried.',
  lintel: 'Tap Lintel to make it wait or follow. Its flat head is a step.',
  weight: 'Leave Lintel on the plate, and find a way past the warden.',
  crown: 'Everything you have learned, folded into one road.',
};
// constellation positions (percent of each chapter panel)
const SKY = [
  [[16, 62], [48, 30], [82, 56]],
  [[18, 36], [46, 66], [80, 34]],
  [[14, 52], [50, 24], [84, 58]],
  [[18, 66], [50, 40], [84, 30]],
];
const svg = (p) => `<svg viewBox="0 0 24 24" aria-hidden="true">${p}</svg>`;
export const ICON = {
  hint: svg('<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2V16h5v-.1c0-.8.4-1.5 1-2A6 6 0 0 0 12 3z"/>'),
  undo: svg('<path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>'),
  restart: svg('<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>'),
  sound: svg('<path d="M11 5 6 9H3v6h3l5 4z"/><path class="on-i" d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/><path class="off-i" d="m16 9 5 6M21 9l-5 6"/>'),
  map: svg('<path d="m9 4-6 2v14l6-2 6 2 6-2V4l-6 2z"/><path d="M9 4v14M15 6v14"/>'),
};

export class UI {
  constructor(app) {
    this.app = app;
    this.toastT = 0;
    for (const b of document.querySelectorAll('[data-icon]')) b.insertAdjacentHTML('afterbegin', ICON[b.dataset.icon]);
    const on = (sel, fn) => $(sel).addEventListener('click', (e) => { e.stopPropagation(); app.audio.init(); app.audio.ui(); fn(); });
    on('#bHint', () => app.game.hint());
    on('#bUndo', () => app.game.undo());
    on('#bRestart', () => app.game.restart());
    on('#bSound', () => this.toggleSound());
    on('#bMap', () => (app.playingCustom ? app.openEditor() : app.openMap()));
    on('#tBegin', () => app.continueGame());
    on('#tMap', () => app.openMap());
    on('#tEdit', () => app.openEditor());
    on('#mClose', () => app.closeMap());
    on('#mEdit', () => app.openEditor());
    on('#wNext', () => app.nextLevel());
    on('#wReplay', () => app.replay());
    on('#wMap', () => app.openMap());
    on('#optSound', () => this.toggleSound());
    on('#optMotion', () => app.toggleMotion());
    $('#card').addEventListener('click', () => this.cardDone && this.cardDone());
    this.syncOptions();
  }
  show(sel, on) { const el = $(sel); if (on) { el.hidden = false; requestAnimationFrame(() => el.classList.add('on')); } else { el.classList.remove('on'); setTimeout(() => { if (!el.classList.contains('on')) el.hidden = true; }, 420); } }
  toggleSound() {
    const s = this.app.save;
    s.mute = !s.mute;
    S.save(s);
    this.app.audio.setMuted(s.mute);
    this.syncOptions();
    this.toast(s.mute ? 'Sound off' : 'Sound on', 1000);
  }
  syncOptions() {
    const s = this.app.save;
    $('#bSound').classList.toggle('off', s.mute);
    $('#optSound').textContent = 'Sound: ' + (s.mute ? 'off' : 'on');
    $('#optMotion').textContent = 'Motion: ' + (this.app.reduce ? 'reduced' : 'full');
  }
  hud(g) {
    if (!g.def) return;
    const d = g.def, i = LEVELS.indexOf(d);
    $('#hNum').textContent = i >= 0 ? `${CHAPTERS[d.chapter].roman} · ${(i % 3) + 1}` : 'Workshop';
    $('#hTitle').textContent = d.title;
    $('#hZh').textContent = d.zh || '';
    const par = d.par ?? null;
    $('#hTurns').textContent = `turns ${g.turns}` + (par != null ? ` · par ${par}` : '');
    const gl = $('#hGlim');
    gl.hidden = g.L.glim < 0;
    gl.classList.toggle('got', !!g.st.g);
    $('#hHint').hidden = !g.hintUsed;
    $('#bUndo').disabled = !g.undoStack || !g.undoStack.length;
  }
  toast(msg, ms = 2400) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.add('on');
    clearTimeout(this.toastT);
    this.toastT = setTimeout(() => el.classList.remove('on'), ms);
  }
  levelStart(g) {
    const d = g.def;
    const b = $('#banner');
    $('#bnTitle').textContent = d.title;
    $('#bnZh').textContent = d.zh || '';
    $('#bnLine').textContent = d.line || '';
    b.classList.add('on');
    document.body.classList.add('banner-on');
    clearTimeout(this.bT);
    this.bT = setTimeout(() => { b.classList.remove('on'); document.body.classList.remove('banner-on'); }, 4200);
    const tip = TIPS[d.id];
    if (tip && !(this.app.save.stars[d.id] || [])[0]) setTimeout(() => { if (g.def === d && !g.won && !g.hintPending) this.toast(tip, 5200); }, 2600);
  }
  // full-screen chapter card; resolves on timeout or tap
  chapterCard(ch) {
    const C = CHAPTERS[ch];
    $('#cNum').textContent = C.n;
    $('#cRoman').textContent = 'Chapter ' + C.roman;
    $('#cTitle').textContent = C.title;
    $('#cZh').textContent = C.zh;
    $('#cLine').textContent = C.line;
    this.show('#card', true);
    this.app.audio.gong();
    return new Promise((res) => {
      const done = () => { this.cardDone = null; clearTimeout(t); this.show('#card', false); setTimeout(res, 300); };
      const t = setTimeout(done, this.app.reduce ? 1800 : 3200);
      this.cardDone = done;
    });
  }
  win(g, stars, isLast, custom) {
    const d = g.def;
    clearTimeout(this.toastT); $('#toast').classList.remove('on');
    $('#banner').classList.remove('on'); document.body.classList.remove('banner-on');
    $('#wTitle').textContent = d.title;
    $('#wLine').textContent = isLast ? 'The map is whole. Every road you walked was one road, folded.' : d.line;
    const labels = ['Reached the gate', g.L.glim >= 0 ? 'Found the glimmer' : 'No glimmer here', d.par != null ? `Within par (${d.par} turn${d.par === 1 ? '' : 's'}), no hints` : 'Prove it in the Workshop for a par'];
    $('#wStars').innerHTML = stars.map((s, i) => `<li class="${s ? 'got' : ''}" style="--d:${0.25 + i * 0.22}s"><i></i><span>${labels[i]}</span></li>`).join('');
    $('#wNext').hidden = !custom && (isLast || LEVELS.indexOf(d) < 0);
    $('#wNext').textContent = custom ? 'Workshop' : 'Next fold';
    $('#wHead').textContent = isLast ? 'Unfolded' : 'Folded';
    this.show('#win', true);
  }
  hideWin() { this.show('#win', false); }
  escape() {
    const a = this.app;
    if (!$('#win').hidden) return;
    if (!$('#map').hidden) a.closeMap(); else if (a.game.world) a.openMap();
  }
  // the constellation map
  map(save, current) {
    const root = $('#mSky');
    root.innerHTML = '';
    CHAPTERS.forEach((C, ci) => {
      const lv = LEVELS.map((d, i) => ({ d, i })).filter((x) => x.d.chapter === ci);
      const panel = document.createElement('section');
      panel.className = 'ch';
      const pts = SKY[ci];
      const lines = pts.slice(1).map((p, k) => { const q = pts[k]; const lit = S.done(save, lv[k].d.id) && S.done(save, lv[k + 1].d.id); return `<line x1="${q[0]}" y1="${q[1]}" x2="${p[0]}" y2="${p[1]}" class="${lit ? 'lit' : ''}"/>`; }).join('');
      panel.innerHTML = `<header><b class="zhn">${C.n}</b><div><h3>${C.title} <span class="zh">${C.zh}</span></h3><p>${C.line}</p></div></header>
        <div class="sky"><svg viewBox="0 0 100 100" preserveAspectRatio="none">${lines}</svg></div>`;
      const sky = panel.querySelector('.sky');
      lv.forEach(({ d, i }, k) => {
        const st = save.stars[d.id] || [false, false, false];
        const unlocked = i === 0 || S.done(save, LEVELS[i - 1].id) || st[0] || this.app.unlockAll;
        const b = document.createElement('button');
        b.className = 'star' + (st[0] ? ' lit' : '') + (unlocked ? '' : ' locked') + (i === current ? ' cur' : '');
        b.style.left = pts[k][0] + '%'; b.style.top = pts[k][1] + '%';
        b.disabled = !unlocked;
        b.setAttribute('aria-label', `${d.title}${st[0] ? ', completed' : unlocked ? '' : ', locked'}`);
        b.innerHTML = `<i class="core"></i><span class="lbl"><em>${d.title}</em><small>${d.zh}</small><span class="mini">${st.map((s) => `<u class="${s ? 'g' : ''}"></u>`).join('')}</span></span>`;
        b.title = d.line;
        b.addEventListener('click', (e) => { e.stopPropagation(); this.app.audio.init(); this.app.audio.ui(); this.app.startLevel(i); });
        sky.appendChild(b);
      });
      root.appendChild(panel);
    });
    const n = S.count(save, LEVELS.map((d) => d.id));
    const allStars = LEVELS.reduce((s, d) => s + (save.stars[d.id] || []).filter(Boolean).length, 0);
    $('#mCount').textContent = `${n} of ${LEVELS.length} folds · ${allStars} of ${LEVELS.length * 3} stars`;
  }
  // a hint arrow drawn next to a handle
  dragHint(on, pos, G, d) {
    const el = $('#arrow');
    if (!on) { el.classList.remove('on'); return; }
    const s = this.app.view.toScreen(pos);
    el.style.left = s.x + 'px'; el.style.top = s.y + 'px';
    el.textContent = G.kind === 'slider' ? '⇕' : d > 0 ? '↺' : '↻';
    el.classList.add('on');
    clearTimeout(this.arT);
    this.arT = setTimeout(() => el.classList.remove('on'), 3200);
  }
}
