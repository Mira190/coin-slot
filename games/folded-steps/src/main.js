// Folded Steps: boot, screen flow (title -> chapter card -> level -> win -> map), main loop, debug hook.
import { View } from './render.js';
import { Audio } from './audio.js';
import { FX } from './fx.js';
import { Water } from './water.js';
import { Game } from './game.js';
import { Input } from './input.js';
import { UI } from './ui.js';
import { Editor } from './editor.js';
import { LEVELS } from './levels.js';
import * as S from './save.js';
import * as F from './logic.js';
import { stepTweens, tween } from './tween.js';

const app = {};
app.save = S.load();
const mq = matchMedia('(prefers-reduced-motion: reduce)');
app.reduce = app.save.reduce ?? mq.matches;
mq.addEventListener?.('change', (e) => { if (app.save.reduce == null) setMotion(e.matches); });
app.unlockAll = new URLSearchParams(location.search).has('all');
app.view = new View(document.getElementById('c'));
app.audio = new Audio();
app.audio.muted = app.save.mute;
app.fx = new FX(app.view.scene);
app.water = new Water(app.view.scene);
app.ui = new UI(app);
app.game = new Game(app);
app.game.reduce = app.reduce;
app.input = new Input(app);
app.editor = new Editor(app);
app.mode = 'title';
const $ = (s) => document.querySelector(s);
document.body.classList.toggle('reduce', app.reduce);

function setMotion(r) {
  app.reduce = r; app.game.reduce = r; app.fx.reduce = r;
  document.body.classList.toggle('reduce', r);
  app.ui.syncOptions();
}
app.toggleMotion = () => { setMotion(!app.reduce); app.save.reduce = app.reduce; S.save(app.save); };
function setMode(m) {
  app.mode = m;
  document.body.dataset.mode = m;
}
const ids = LEVELS.map((d) => d.id);
const firstOpen = () => { const i = LEVELS.findIndex((d) => !S.done(app.save, d.id)); return i < 0 ? LEVELS.length - 1 : i; };

app.startLevel = async (i, o = {}) => {
  const d = LEVELS[i];
  if (!d) return;
  app.ui.hideWin();
  app.ui.show('#map', false);
  app.ui.show('#title', false);
  app.editor.close(true);
  // a chapter card opens every chapter (and greets you when you arrive from elsewhere)
  const prev = app.lastPlayed;
  const newChapter = !o.noCard && (i % 3 === 0 || !prev || prev.chapter !== d.chapter);
  app.lastPlayed = d;
  app.playingCustom = false;
  setMode('play');
  app.input.enabled = false;
  if (newChapter) await app.ui.chapterCard(d.chapter);
  app.save.last = i; S.save(app.save);
  app.current = i;
  await app.game.load(d, { instant: o.instant });
  app.input.enabled = true;
};
app.continueGame = () => app.startLevel(app.current ?? firstOpen());
app.nextLevel = () => (app.playingCustom ? app.openEditor() : app.startLevel(app.current + 1));
app.replay = () => (app.playingCustom ? app.playCustom(app.playingCustom) : app.startLevel(app.current, { noCard: true }));
app.openMap = () => {
  app.ui.hideWin();
  app.ui.map(app.save, app.current ?? -1);
  app.ui.show('#map', true);
  app.input.enabled = false;
};
app.closeMap = () => {
  app.ui.show('#map', false);
  if (app.game.world && app.mode === 'play' && !app.game.won) app.input.enabled = true;
  else if (app.mode !== 'play') app.ui.show('#title', true);
};
app.openEditor = () => { app.ui.show('#map', false); app.ui.show('#title', false); app.ui.hideWin(); app.playingCustom = null; setMode('editor'); app.editor.open(); };
app.playCustom = async (def) => {
  app.ui.hideWin();
  app.playingCustom = def;
  setMode('play');
  app.input.enabled = false;
  await app.game.load(def);
  app.input.enabled = true;
  app.ui.toast('Workshop test. The map button returns to the Workshop.', 3000);
};
app.leaveEditor = async () => {
  setMode('title');
  const i = app.current ?? firstOpen();
  await app.game.load(LEVELS[i], { instant: true, quiet: true });
  app.ui.show('#title', true);
};
app.onWin = (g, stars) => {
  if (app.playingCustom) { app.ui.win(g, stars, false, true); app.input.enabled = false; return; }
  const got = S.award(app.save, g.def.id, stars);
  const n = S.count(app.save, ids);
  if (window.Arcade && Arcade.saveBest) Arcade.saveBest(n);
  app.ui.win(g, got.map((v, i) => v && (stars[i] || v)), LEVELS.indexOf(g.def) === LEVELS.length - 1);
  app.input.enabled = false;
};

// ---------- main loop ----------
let last = performance.now(), T = 0, paused = false;
function frame(now) {
  requestAnimationFrame(frame);
  let dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (paused) return;
  const ts = app.game.timeScale;
  T += dt * ts;
  stepTweens(dt * ts);
  app.game.update(dt, T);
  app.editor.update(dt, T);
  app.fx.update(dt * ts, T, app.view.renderer.getPixelRatio() * Math.min(1.4, app.view.h / 800));
  app.audio.update(dt, app.mode !== 'title' || !!app.game.world);
  app.view.render(dt);
}
addEventListener('visibilitychange', () => {
  paused = document.hidden;
  if (app.audio.ctx) { if (paused) app.audio.ctx.suspend(); else app.audio.ctx.resume(); }
  last = performance.now();
});
// pause on blur (the world, its wardens and the music all hold still until focus returns)
addEventListener('blur', () => { paused = true; if (app.audio.ctx) app.audio.ctx.suspend(); });
addEventListener('focus', () => { if (document.hidden) return; paused = false; last = performance.now(); if (app.audio.ctx) app.audio.ctx.resume(); });

// ---------- boot: the title floats over the first unfinished level ----------
(async () => {
  setMode('title');
  app.attract = true;
  const i = Math.min(app.save.last || 0, LEVELS.length - 1);
  await app.game.load(LEVELS[S.done(app.save, LEVELS[i].id) ? firstOpen() : i], { instant: true, quiet: true });
  app.current = LEVELS.indexOf(app.game.def);
  $('#tBegin').textContent = S.count(app.save, ids) ? 'Continue' : 'Begin';
  app.ui.show('#title', true);
  document.body.classList.add('ready');
})();
requestAnimationFrame(frame);

// ---------- debug / verification hook ----------
const errors = [];
addEventListener('error', (e) => errors.push(String(e.message)));
addEventListener('unhandledrejection', (e) => errors.push(String(e.reason && e.reason.message || e.reason)));
const idle = () => new Promise((res) => { const chk = () => { const g = app.game; if (!g.busy && !g.anim && !g.dragging && !g.queue.length) res(); else setTimeout(chk, 16); }; chk(); });
window.__debug = {
  app, F, LEVELS, errors,
  state: () => app.game.st,
  level: () => app.game.def && app.game.def.id,
  won: () => app.game.won,
  load: (i, instant = true) => app.startLevel(i, { noCard: true, instant }),
  solve: (glimmer) => F.solve(app.game.L, app.game.st, glimmer ? (L, s) => s.p === L.goal && s.g : F.won, 3000000),
  idle,
  // play a list of solver actions through the real command paths (drags go through beginDrag/dragTo/endDrag)
  async play(actions, speed = 3) {
    const g = app.game;
    g.timeScale = speed;
    g.manual = true;
    for (const a of actions) {
      await idle();
      if (g.won) break;
      if (a.t === 'step' || a.t === 'wait') { g.queue.push(a); await idle(); }
      else if (a.t === 'toggle') g.toggleCompanion();
      else if (a.t === 'mech') {
        const G = g.L.mechs[a.i];
        const cur = g.world.vm[a.i];
        let d = a.v - g.st.m[a.i];
        if (G.src.cyc) { d = ((d % 4) + 4) % 4; if (d === 3) d = -1; }
        g.beginDrag(a.i);
        for (let k = 1; k <= 6; k++) { g.dragTo(cur + (d * k) / 6); await new Promise((r) => setTimeout(r, 8)); }
        await g.endDrag();
      }
    }
    await idle();
    await new Promise((r) => setTimeout(r, 200 / speed));
    g.manual = false;
    return { won: g.won, turns: g.turns, st: g.st };
  },
  async autoplay(i, { speed = 3, glimmer = true } = {}) {
    await this.load(i, true);
    await idle();
    const r = this.solve(glimmer && app.game.L.glim >= 0);
    if (!r || !r.actions) return { won: false, error: 'no solution' };
    return this.play(r.actions, speed);
  },
};
