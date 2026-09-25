// DOM HUD: Chinese labels with English sub-labels. Position/laps/times, standings, the 喷 light, 集气 gauge with
// two nitro bottles (speed mode) or two item slots (item mode), speedometer, minimap, popups, banners, warnings.
import { KMH, ITEMS } from './data.js';
import { fmt } from './store.js';
import { DS } from './track.js';

const $ = (id) => document.getElementById(id);
const POP_LIFE = 1.15;

export class HUD {
  constructor() {
    this.el = {}; ['hud', 'hPos', 'hPosN', 'hLap', 'hTime', 'hLapT', 'hBest', 'hGhost', 'hGhostL', 'hStand', 'light', 'gauge', 'gaugeFill', 'b0', 'b1', 'gaugeWrap', 'itemWrap', 'slot0', 'slot1', 'pops', 'banner', 'count', 'warn', 'ink', 'toast', 'minimap', 'speedo', 'hint'].forEach((k) => (this.el[k] = $(k)));
    this.mm = this.el.minimap.getContext('2d'); this.sp = this.el.speedo.getContext('2d');
    this.mmT = 0; this.standT = 0; this.toastT = 0; this.last = {};
    this.popQ = []; this.popLive = []; this.counting = false;
    this.el.banner.addEventListener('animationend', () => this.el.banner.classList.remove('on'));
  }
  setup(R, T, bestLap) {
    const e = this.el;
    this.R = R; this.T = T; this.bestLap = bestLap;
    const item = R.mode === 'item';
    e.gaugeWrap.hidden = item; e.itemWrap.hidden = !item;
    e.hPosN.textContent = '/' + R.karts.length;
    e.hPos.parentElement.style.visibility = R.mode === 'tt' ? 'hidden' : '';
    e.hStand.hidden = R.mode === 'tt';
    e.hGhost.hidden = e.hGhostL.hidden = R.mode !== 'tt';
    this.clearPops(); e.count.textContent = ''; e.count.className = ''; this.counting = false; e.count.className = ''; e.banner.classList.remove('on'); e.banner.innerHTML = ''; e.toast.classList.remove('on'); this.toastT = 0; e.warn.hidden = true; e.ink.classList.remove('on');
    e.hStand.innerHTML = R.karts.map(() => '<li><b></b><i></i><span></span></li>').join('');
    // minimap geometry
    const b = T.bounds, S = 380, pad = 34, sc = Math.min((S - pad * 2) / (b.x1 - b.x0), (S - pad * 2) / (b.z1 - b.z0));
    const ox = (S - (b.x1 - b.x0) * sc) / 2, oz = (S - (b.z1 - b.z0) * sc) / 2;
    this.mx = (x) => ox + (x - b.x0) * sc; this.mz = (z) => oz + (z - b.z0) * sc;
    this.paths = T.paths.map((P) => { const p = new Path2D(); for (let i = 0; i < P.n; i += 2) (i ? p.lineTo : p.moveTo).call(p, this.mx(P.x[i]), this.mz(P.z[i])); if (P.closed) p.closePath(); return p; });
    this.last = {};
    this.lastLight = null;
    this.standT = 0; this.mmT = 0; // draw standings and minimap on the very first frame
  }
  // Popups queue into the top-centre lane (index.html #feed): at most 3 on screen (1 while the countdown numeral
  // shows), each held ~1 s, the rest wait; a repeat of the newest message becomes ×N instead of a new row.
  pop(zh, en, cls = '') {
    const newest = this.popQ[this.popQ.length - 1] || this.popLive[this.popLive.length - 1];
    if (newest && newest.zh === zh && !(newest.t < 0.25)) {
      newest.n++; if (newest.el) { newest.t = Math.max(newest.t, 0.8); this.renderPop(newest); }
      return;
    }
    this.popQ.push({ zh, en, cls, n: 1, t: POP_LIFE, el: null });
    if (this.popQ.length > 4) this.popQ.shift(); // a stale backlog is worse than a dropped hint
    this.tickPops(0);
  }
  renderPop(p) { p.el.innerHTML = p.zh + (p.n > 1 ? `<span class="x">×${p.n}</span>` : '') + (p.en ? `<small>${p.en}</small>` : ''); }
  tickPops(dt) {
    for (const p of this.popLive) {
      p.t -= dt;
      if (p.t <= 0.25 && !p.el.classList.contains('out')) p.el.classList.add('out');
      if (p.t <= 0) p.el.remove();
    }
    this.popLive = this.popLive.filter((p) => p.t > 0);
    const max = this.counting ? 1 : 3;
    // something is waiting: retire the oldest row once it has been readable for 0.6 s
    if (this.popQ.length && this.popLive.length >= max) { const o = this.popLive[0]; if (o.t <= POP_LIFE - 0.6) o.t = Math.min(o.t, 0.25); }
    while (this.popQ.length && this.popLive.length < max) {
      const p = this.popQ.shift();
      p.el = document.createElement('div'); p.el.className = 'pop ' + p.cls; this.renderPop(p);
      this.el.pops.appendChild(p.el); this.popLive.push(p);
    }
  }
  clearPops() { this.popQ = []; this.popLive = []; this.el.pops.innerHTML = ''; }
  banner(zh, en) { const b = this.el.banner; b.innerHTML = zh + `<small>${en}</small>`; b.classList.remove('on'); void b.offsetWidth; b.classList.add('on'); }
  count(txt, go) { const c = this.el.count; c.textContent = txt; c.className = (go ? 'go ' : '') + 'anim'; void c.offsetWidth; if (!txt) c.className = ''; this.counting = !!txt; }
  toast(t, dur = 1.6) { const e = this.el.toast; e.textContent = t; e.classList.add('on'); this.toastT = Math.max(dur, t.length > 30 ? 5 : dur); }
  bottlePop(n) { const b = this.el['b' + (n - 1)]; if (b) { b.classList.remove('pop'); void b.offsetWidth; b.classList.add('pop'); } }

  update(dt, R, extra = {}) {
    const e = this.el, P = R.player, set = (k, v) => { if (this.last[k] !== v) { this.last[k] = v; e[k].textContent = v; } };
    this.tickPops(dt);
    const rank = R.ranks.indexOf(P) + 1;
    set('hPos', String(rank));
    set('hLap', `${Math.max(1, Math.min(R.laps, P.lap))}/${R.laps}`);
    set('hTime', fmt(R.state === 'countdown' ? 0 : P.finished ? P.finishTime : R.time));
    set('hLapT', fmt(R.state === 'countdown' ? 0 : P.finished ? P.lapTimes[P.lapTimes.length - 1] : R.time - P.lapStart));
    const best = Math.min(this.bestLap ?? Infinity, ...(P.lapTimes.length ? P.lapTimes : [Infinity]));
    set('hBest', isFinite(best) ? fmt(best) : '--:--.--');
    if (extra.ghostDelta != null) { set('hGhost', (extra.ghostDelta >= 0 ? '+' : '-') + Math.abs(extra.ghostDelta).toFixed(2)); e.hGhost.className = 'gd ' + (extra.ghostDelta <= 0 ? 'minus' : 'plus'); }
    // standings
    this.standT -= dt;
    if (this.standT <= 0 && R.mode !== 'tt') {
      this.standT = 0.25;
      const lis = e.hStand.children;
      R.ranks.forEach((k, i) => { const li = lis[i]; if (!li) return; li.children[0].textContent = i + 1; li.children[1].style.background = k.paint; li.children[2].textContent = k.name.zh + ' ' + k.name.en; li.className = k.isPlayer ? 'me' : ''; });
    }
    // boost light
    const lightState = P.light > 0 ? (P.lightDouble ? 'on dbl' : 'on') : P.landWin > 0 ? 'land' : '';
    if (lightState !== this.lastLight) { this.lastLight = lightState; e.light.className = 'light ' + lightState; e.light.innerHTML = P.landWin > 0 && !P.light ? '落地<small>LANDING · TAP ↑</small>' : (P.lightDouble ? '双喷' : '喷') + '<small>TAP ↑ BOOST</small>'; }
    // gauge / bottles or items
    if (R.mode !== 'item') {
      const g = Math.min(1, P.gauge);
      e.gaugeFill.style.width = (g * 100).toFixed(1) + '%';
      e.gauge.classList.toggle('full', P.bottles >= 2 && g >= 1);
      e.b0.classList.toggle('on', P.bottles >= 1); e.b1.classList.toggle('on', P.bottles >= 2);
    } else {
      for (let s = 0; s < 2; s++) {
        const el = e['slot' + s], it = P.items[s], roll = P.roll[s] > 0;
        const key = (it || '') + (roll ? 'r' + Math.floor(P.roll[s] * 12) : '');
        if (this.last['slot' + s] === key) continue;
        this.last['slot' + s] = key;
        const keys = Object.keys(ITEMS), show = roll ? keys[Math.floor(P.roll[s] * 12) % keys.length] : it;
        el.className = 'slot' + (it ? ' full' : '') + (roll ? ' roll' : '');
        el.querySelector('.ic').innerHTML = show ? `${ITEMS[show].icon}<span style="color:${ITEMS[show].color}">${ITEMS[show].zh}</span><small>${ITEMS[show].en}</small>` : '';
      }
    }
    // warnings
    let warn = '';
    if (P.lock > 0 && R.mode === 'item') warn = '⚠ 被锁定<small>INCOMING — AN ANGEL 天使 WOULD BLOCK IT</small>';
    else if (P.devil > 0) warn = '方向颠倒<small>CONTROLS REVERSED</small>';
    else if (P.wrong && R.state === 'race') warn = '逆行<small>WRONG WAY</small>';
    if (warn !== this.last.warn) { this.last.warn = warn; e.warn.hidden = !warn; e.warn.innerHTML = warn; }
    e.ink.classList.toggle('on', P.fog > 0);
    if (this.toastT > 0) { this.toastT -= dt; if (this.toastT <= 0) e.toast.classList.remove('on'); }
    this.speedo(P, extra.top || 42);
    this.mmT -= dt;
    if (this.mmT <= 0) { this.mmT = 1 / 30; this.minimap(R, extra.ghost); }
  }
  speedo(P, top) {
    const c = this.sp, W = 420, H = 300, kmh = Math.round(Math.abs(P.spd) * KMH);
    c.clearRect(0, 0, W, H);
    const cx = 250, cy = 205, r = 150, a0 = Math.PI * 0.8, a1 = Math.PI * 2.2;
    const f = Math.min(1, Math.abs(P.spd) / (top * 1.55));
    c.lineCap = 'round';
    c.lineWidth = 22; c.strokeStyle = 'rgba(7,12,40,.55)'; c.beginPath(); c.arc(cx, cy, r, a0, a1); c.stroke();
    const boost = P.b.nitro > 0 || P.b.turbo > 0;
    const g = c.createLinearGradient(cx - r, 0, cx + r, 0);
    g.addColorStop(0, '#1b7bff'); g.addColorStop(0.55, '#29d3ff'); g.addColorStop(0.8, '#ffd21f'); g.addColorStop(1, '#ff3d8b');
    c.lineWidth = 16; c.strokeStyle = g;
    if (boost) { c.shadowColor = '#29d3ff'; c.shadowBlur = 22; }
    c.beginPath(); c.arc(cx, cy, r, a0, a0 + (a1 - a0) * f); c.stroke();
    c.shadowBlur = 0;
    c.lineWidth = 3; c.strokeStyle = 'rgba(255,255,255,.5)';
    for (let i = 0; i <= 10; i++) { const a = a0 + (a1 - a0) * (i / 10); c.beginPath(); c.moveTo(cx + Math.cos(a) * (r - 20), cy + Math.sin(a) * (r - 20)); c.lineTo(cx + Math.cos(a) * (r - 30), cy + Math.sin(a) * (r - 30)); c.stroke(); }
    c.textAlign = 'right'; c.fillStyle = '#fff'; c.font = 'italic 92px "Russo One",sans-serif';
    c.shadowColor = 'rgba(0,0,40,.8)'; c.shadowBlur = 8;
    c.fillText(String(kmh), cx + 70, cy + 20);
    c.shadowBlur = 0;
    c.font = '26px "Russo One",sans-serif'; c.fillStyle = '#9fe8ff'; c.fillText('km/h', cx + 70, cy + 56);
    c.textAlign = 'left'; c.font = '26px "ZCOOL QingKe HuangYou",sans-serif'; c.fillStyle = '#cfe0ff'; c.fillText('时速', cx - 110, cy + 56);
    if (boost) { c.font = '28px "ZCOOL QingKe HuangYou",sans-serif'; c.fillStyle = '#29d3ff'; c.fillText('氮气!', cx - 110, cy - 40); }
  }
  minimap(R, ghost) {
    const c = this.mm, S = 380;
    c.clearRect(0, 0, S, S);
    c.lineJoin = 'round'; c.lineCap = 'round';
    this.paths.forEach((p, i) => {
      c.lineWidth = i ? 9 : 14; c.strokeStyle = 'rgba(0,0,30,.6)'; c.stroke(p);
      c.lineWidth = i ? 5 : 8; c.strokeStyle = i ? 'rgba(255,210,31,.75)' : 'rgba(220,235,255,.9)';
      if (i) c.setLineDash([6, 6]); c.stroke(p); c.setLineDash([]);
    });
    const M = this.T.main;
    // start line
    c.strokeStyle = '#ff3d8b'; c.lineWidth = 5; c.beginPath();
    c.moveTo(this.mx(M.x[0] + M.nx[0] * 12), this.mz(M.z[0] + M.nz[0] * 12)); c.lineTo(this.mx(M.x[0] - M.nx[0] * 12), this.mz(M.z[0] - M.nz[0] * 12)); c.stroke();
    if (ghost) { c.fillStyle = 'rgba(160,220,255,.7)'; c.beginPath(); c.arc(this.mx(ghost.x), this.mz(ghost.z), 7, 0, 7); c.fill(); }
    if (R.items) for (const s of R.items.shots) { c.fillStyle = '#ff4b4b'; c.beginPath(); c.arc(this.mx(s.x), this.mz(s.z), 5, 0, 7); c.fill(); }
    const ks = R.karts.slice().sort((a, b) => (a.isPlayer ? 1 : 0) - (b.isPlayer ? 1 : 0));
    for (const k of ks) {
      const x = this.mx(k.x), z = this.mz(k.z);
      if (k.isPlayer) {
        c.save(); c.translate(x, z); c.rotate(-k.h);
        c.fillStyle = '#ffd21f'; c.strokeStyle = '#000'; c.lineWidth = 3;
        c.beginPath(); c.moveTo(0, 14); c.lineTo(-10, -9); c.lineTo(0, -4); c.lineTo(10, -9); c.closePath(); c.stroke(); c.fill(); c.restore();
      } else { c.fillStyle = k.paint; c.strokeStyle = '#fff'; c.lineWidth = 2.5; c.beginPath(); c.arc(x, z, 7, 0, 7); c.fill(); c.stroke(); }
    }
  }
}
