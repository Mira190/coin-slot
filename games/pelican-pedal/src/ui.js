// DOM layer: loading veil, title card, HUD, toasts, achievements, pause/settings, ride summary,
// photo mode panel and the tool buttons. Talks to main through a small set of callbacks.
import { $, bus, isTouch, clamp, reduceMotion } from './core.js';
import { ACH } from './game.js';
import { MODE_NAMES } from './director.js';

const fmt = (n) => Math.floor(n).toLocaleString('en-US');
const hhmm = (h) => { const m = Math.floor((((h % 24) + 24) % 24) * 60); return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'); };
function phaseName(el, h) {
  if (el < -9) return 'Night'; if (el < -3) return h < 12 ? 'Blue hour' : 'Dusk'; if (el < 0.5) return h < 12 ? 'Dawn' : 'Sunset';
  if (el < 11) return h < 12 ? 'Morning gold' : 'Golden hour'; if (el < 30) return h < 12 ? 'Morning' : 'Afternoon'; return 'Midday';
}

export class UI {
  constructor(app) {
    this.app = app;
    document.body.classList.toggle('touch', isTouch);
    this.el = { score: $('#h-score'), combo: $('#h-combo'), fish: $('#h-fish'), speed: $('#h-speed'), time: $('#c-time'), phase: $('#c-phase'), clock: $('#clock'), shot: $('#shotname'), toast: $('#toast'), zone: $('#zone'), ach: $('#achtoast') };
    this.toastT = 0; this.zoneT = 0; this.achQ = []; this.achT = 0; this.last = {};
    // buttons
    $('#b-ride').onclick = () => app.startRide();
    $('#b-watch').onclick = () => app.watch();
    $('#b-photo').onclick = () => app.photo(true);
    $('#t-cam').onclick = () => app.nextCamera();
    $('#t-photo').onclick = () => app.photo(!app.photoMode);
    $('#t-sound').onclick = () => app.toggleMute();
    $('#t-ach').onclick = () => this.showAch(true);
    $('#ach-close').onclick = () => this.showAch(false);
    $('#t-menu').onclick = () => app.pause(true, true);
    $('#p-resume').onclick = () => app.pause(false);
    $('#p-end').onclick = () => app.endRide();
    $('#sum-again').onclick = () => { this.modal('#summary', false); app.startRide(); };
    $('#sum-close').onclick = () => { this.modal('#summary', false); app.watch(); };
    $('#o-quality').onchange = (e) => app.setQuality(e.target.value);
    $('#o-camera').onchange = (e) => app.setCamera(e.target.value);
    $('#o-day').onchange = (e) => app.setDayLength(+e.target.value);
    // photo panel
    const P = { focus: $('#p-focus'), ap: $('#p-ap'), time: $('#p-time'), exp: $('#p-exp') };
    this.P = P;
    P.focus.oninput = () => { const v = +P.focus.value; app.photoFocus = v === 0 ? null : 0.4 * Math.pow(60 / 0.4, v / 100); $('#o-focus').textContent = v === 0 ? 'auto' : app.photoFocus.toFixed(1) + ' m'; };
    P.ap.oninput = () => { const v = +P.ap.value / 100; app.photoAperture = v * v * 0.2; $('#o-ap').textContent = v < 0.02 ? 'f/22' : 'f/' + (1.4 / Math.max(v, 0.07)).toFixed(1); };
    P.time.oninput = () => { app.setHour(+P.time.value / 60); $('#o-time').textContent = hhmm(+P.time.value / 60); };
    P.exp.oninput = () => { app.photoExposure = Math.pow(2, +P.exp.value / 50); $('#o-exp').textContent = (+P.exp.value / 50).toFixed(1) + ' EV'; };
    document.querySelectorAll('.fchip').forEach((b) => b.onclick = () => { document.querySelectorAll('.fchip').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); app.setFilter(+b.dataset.f); });
    $('#p-shot').onclick = () => app.screenshot();
    $('#p-exit').onclick = () => app.photo(false);
    $('#p-hide').onclick = () => this.photoPanel(false, true);
    // bus
    bus.on('score', (s) => { this.el.score.textContent = fmt(s); });
    const live = () => app.game.playing && !app.game.autopilot;
    bus.on('line', (e) => { if (live()) this.toast(e.perfect ? (e.golden ? 'Golden sweep!' : 'Clean sweep!') : 'Gulp!', `${e.caught}/${e.n} fish` + (e.bonus ? `  ·  +${fmt(e.bonus)}` : '') + (e.combo > 1 ? `  ·  streak ${e.combo}` : '')); });
    bus.on('crab-hop', () => { if (live()) this.toast('Crab hop!', '+150'); });
    bus.on('crab-hit', () => { if (live()) this.toast('Oof!', 'combo lost'); });
    bus.on('combo-lost', (c) => { if (app.game.playing && !app.game.autopilot) this.toast('Missed', `combo ×${c} lost`, 900); });
    bus.on('lap', (n) => { if (live()) this.toast(`Lap ${n}`, '+500'); });
    bus.on('zone', (name) => { this.el.zone.textContent = name; this.el.zone.classList.add('on'); this.zoneT = 3; });
    bus.on('ach', (a) => { this.achQ.push(a); this.refreshMeta(); });
    this.refreshMeta();
    this.syncSound();
  }
  veil(msg, p) { $('#veil-msg').textContent = msg; $('#veil-fill').style.width = Math.round(p * 100) + '%'; }
  veilDone() { $('#veil').classList.add('gone'); setTimeout(() => $('#veil').hidden = true, 1200); }
  error(msg) { const e = $('#err'); e.hidden = false; e.textContent = msg; }
  refreshMeta() { $('#best').textContent = fmt(this.app.game.best()); $('#trophies').textContent = `${this.app.game.unlocked.size}/${ACH.length}`; }
  syncSound() { const b = $('#t-sound'), m = this.app.audio.muted; b.setAttribute('aria-pressed', String(!m)); b.setAttribute('aria-label', m ? 'Sound off' : 'Sound on'); b.querySelector('.wave').style.opacity = m ? 0.15 : 1; }
  modal(sel, on) { $(sel).hidden = !on; if (on) { const c = $(sel).querySelector('.card'); c.tabIndex = -1; c.scrollTop = 0; c.focus({ preventScroll: true }); } }
  showAch(on) {
    if (on) {
      const g = $('#ach-grid'); g.innerHTML = '';
      for (const a of ACH) { const d = document.createElement('div'); const got = this.app.game.unlocked.has(a.id); d.className = 'ach' + (got ? ' got' : ''); d.innerHTML = `<div class="ic">${got ? a.icon : '🔒'}</div><b>${a.name}</b><span>${a.desc}</span>`; g.appendChild(d); }
    }
    this.modal('#ach-modal', on);
  }
  toast(big, small, ms = 1400) { const t = this.el.toast; t.innerHTML = `${big}<small>${small || ''}</small>`; t.classList.add('on'); this.toastT = ms / 1000; }
  photoPanel(on, keepMode) { $('#photo').hidden = !on; if (!on && keepMode) this.panelHidden = true; else this.panelHidden = false; }
  summary(g) {
    const km = (g.dist / 1000).toFixed(2);
    $('#sum-body').innerHTML = `Score <b style="color:var(--sun)">${fmt(g.score)}</b> · ${g.fishRide} fish · ${km} km ridden${g.laps ? ` · ${g.laps} lap${g.laps > 1 ? 's' : ''}` : ''}<br>Best ${fmt(g.best())} · trophies ${g.unlocked.size}/${ACH.length}`;
    this.modal('#summary', true);
  }
  setCamLabel(mode) { $('#o-camera').value = mode === 'photo' ? 'director' : mode; }
  update(dt, st) {
    const e = this.el;
    // throttle DOM writes
    const sp = Math.round(st.speed * 3.6); if (sp !== this.last.sp) { e.speed.textContent = sp; this.last.sp = sp; }
    if (st.combo !== this.last.combo) { e.combo.textContent = '×' + st.combo; this.last.combo = st.combo; }
    if (st.fish !== this.last.fish) { e.fish.textContent = st.fish; this.last.fish = st.fish; }
    const tm = hhmm(st.hour); if (tm !== this.last.tm) { e.time.textContent = tm; e.phase.textContent = phaseName(st.el, st.hour); e.clock.classList.toggle('moon', st.el < -2); this.last.tm = tm; }
    if (st.shot !== this.last.shot) { e.shot.textContent = st.shot; this.last.shot = st.shot; }
    document.body.classList.toggle('cine', !!st.letterbox && !reduceMotion);
    if (this.toastT > 0) { this.toastT -= dt; if (this.toastT <= 0) e.toast.classList.remove('on'); }
    if (this.zoneT > 0) { this.zoneT -= dt; if (this.zoneT <= 0) e.zone.classList.remove('on'); }
    if (this.achT > 0) { this.achT -= dt; if (this.achT <= 0) e.ach.classList.remove('on'); }
    else if (this.achQ.length) { const a = this.achQ.shift(); e.ach.querySelector('.ic').textContent = a.icon; e.ach.querySelector('b').textContent = a.name; e.ach.classList.add('on'); this.achT = 3.2; this.app.audio.fanfare(); }
  }
}
export { hhmm, MODE_NAMES };
