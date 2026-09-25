// DOM HUD: score bar, clock, alive pips, radar, zone callout, radio, kill feed with weapon icons, medals and
// streak banners, crosshair (spread-driven, hidden when dead / scoped / knifing), hitmarkers, damage arcs,
// vitals, ammo, reload bar, scope, flash-bang white-out, death panel, scoreboard, end screen.
import { boxes, zones, BOUNDS, TEAM_NAMES } from './mapdata.js';
import { WEAPONS, spreadOf } from './weapons.js';
import { curWeapon, eyePos } from './combat.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

// ------------------------------------------------------------------------------------------------ icons
export function drawWeaponIcon(c, id, color = '#e8ecf2') {
  const x = c.getContext('2d'), w = c.width, h = c.height;
  x.clearRect(0, 0, w, h); x.fillStyle = color; x.strokeStyle = color; x.lineWidth = 2;
  x.save(); x.scale(w / 120, h / 44);
  const R = (a, b, c2, d) => x.fillRect(a, b, c2, d);
  const poly = (pts) => { x.beginPath(); x.moveTo(pts[0], pts[1]); for (let i = 2; i < pts.length; i += 2) x.lineTo(pts[i], pts[i + 1]); x.closePath(); x.fill(); };
  switch (id) {
    case 'vk12': R(18, 16, 58, 8); R(76, 18, 36, 3); poly([18, 16, 4, 20, 4, 30, 20, 24]); poly([46, 24, 54, 24, 50, 36, 44, 36]); poly([58, 24, 66, 24, 70, 38, 62, 40]); R(100, 13, 2, 5); break;
    case 'r4': R(24, 15, 50, 9); R(74, 17, 32, 5); R(106, 18, 8, 3); R(8, 17, 16, 5); R(4, 15, 8, 12); poly([36, 24, 44, 24, 42, 36, 34, 36]); R(52, 24, 7, 15); R(44, 9, 14, 6); break;
    case 'wasp': R(24, 14, 48, 10); R(72, 17, 20, 4); R(10, 17, 14, 3); R(8, 15, 4, 10); poly([36, 24, 44, 24, 42, 36, 34, 36]); poly([54, 24, 60, 24, 64, 40, 58, 41]); R(40, 10, 5, 4); break;
    case 'longbolt': R(10, 18, 50, 8); R(60, 19, 56, 3); R(26, 8, 34, 6); R(22, 9, 6, 4); R(58, 9, 6, 4); poly([10, 18, 2, 20, 2, 32, 16, 26]); poly([40, 26, 48, 26, 46, 36, 38, 36]); R(52, 26, 6, 8); break;
    case 'breacher': R(18, 16, 30, 9); R(48, 16, 64, 4); R(50, 21, 44, 4); R(62, 20, 20, 8); poly([18, 16, 2, 20, 2, 30, 20, 25]); poly([30, 25, 38, 25, 36, 36, 28, 36]); break;
    case 'talon': R(34, 12, 50, 9); poly([40, 21, 54, 21, 50, 38, 36, 38]); R(46, 21, 10, 3); break;
    case 'knife': poly([20, 22, 80, 18, 104, 22, 80, 26]); R(76, 14, 4, 16); R(84, 17, 0, 0); R(16, 18, 60, 8); x.clearRect(20, 18, 56, 8); R(84, 18, 26, 8); poly([10, 20, 76, 18, 76, 26, 10, 24]); break;
    case 'frag': x.beginPath(); x.arc(60, 25, 13, 0, 7); x.fill(); R(56, 7, 8, 6); R(64, 8, 12, 3); break;
    case 'fall': x.font = 'bold 26px sans-serif'; x.fillText('↓', 50, 32); break;
    default: R(20, 18, 80, 8);
  }
  x.restore();
}
const MEDALS = {
  double: ['Double Kill', '#ffb347', 'II'], triple: ['Triple Kill', '#ff8a3c', 'III'], multi: ['Multi Kill', '#ff5a3c', 'IV'], rampage: ['Rampage', '#ff3a6a', 'V+'],
  headshot: ['Headshot', '#ffd23a', 'hs'], wallbang: ['Through Cover', '#5fd0ff', 'wb'], knife: ['Blade', '#c0c8d0', 'kn'], boom: ['Boom', '#ff7a2a', 'gr'],
  longshot: ['Long Shot', '#8cc8ff', 'ls'], pointblank: ['Point Blank', '#ff9a8a', 'pb'], revenge: ['Revenge', '#e05aff', 'rv'], laststand: ['Last Stand', '#ff4a3a', 'lst'],
  first: ['First Blood', '#ff3a3a', '1'], ace: ['Ace', '#ffe066', 'A'], clutch: ['Clutch', '#62f0a0', 'C'],
};
function drawMedal(c, k) {
  const [, col, glyph] = MEDALS[k];
  const x = c.getContext('2d'), s = c.width;
  x.clearRect(0, 0, s, s);
  x.save(); x.translate(s / 2, s / 2);
  // shield with a laurel ring
  const g = x.createLinearGradient(0, -s / 2, 0, s / 2); g.addColorStop(0, col); g.addColorStop(1, '#2a1a10');
  x.fillStyle = g; x.strokeStyle = 'rgba(255,245,220,0.9)'; x.lineWidth = s * 0.035;
  x.beginPath(); x.moveTo(0, -s * 0.42); x.lineTo(s * 0.34, -s * 0.28); x.lineTo(s * 0.3, s * 0.12); x.quadraticCurveTo(s * 0.18, s * 0.34, 0, s * 0.44); x.quadraticCurveTo(-s * 0.18, s * 0.34, -s * 0.3, s * 0.12); x.lineTo(-s * 0.34, -s * 0.28); x.closePath(); x.fill(); x.stroke();
  x.fillStyle = 'rgba(255,255,255,0.18)'; x.beginPath(); x.moveTo(0, -s * 0.38); x.lineTo(s * 0.3, -s * 0.25); x.lineTo(0, -s * 0.05); x.lineTo(-s * 0.3, -s * 0.25); x.fill();
  for (const sd of [-1, 1]) for (let i = 0; i < 5; i++) { const a = Math.PI / 2 + sd * (0.5 + i * 0.28); x.fillStyle = '#e8c56a'; x.beginPath(); x.ellipse(Math.cos(a) * s * 0.47, Math.sin(a) * s * 0.4, s * 0.05, s * 0.022, a + sd * 0.6, 0, 7); x.fill(); }
  x.fillStyle = '#fff8e6'; x.font = `900 ${glyph.length > 2 ? s * 0.2 : s * 0.28}px Rubik, sans-serif`; x.textAlign = 'center'; x.textBaseline = 'middle';
  if (glyph === 'hs') { x.beginPath(); x.arc(0, 0, s * 0.13, 0, 7); x.lineWidth = s * 0.04; x.strokeStyle = '#fff8e6'; x.stroke(); x.fillRect(-s * 0.02, -s * 0.2, s * 0.04, s * 0.4); x.fillRect(-s * 0.2, -s * 0.02, s * 0.4, s * 0.04); }
  else x.fillText(glyph.toUpperCase(), 0, s * 0.02);
  x.restore();
}

// ------------------------------------------------------------------------------------------------ HUD
export class Hud {
  constructor(game) {
    this.g = null;
    this.el = {};
    for (const id of ['hud', 's0', 's1', 'clock', 'goal', 'al0', 'al1', 'feed', 'radio', 'zone', 'xh', 'hm', 'dmg', 'banner', 'medals', 'bigmsg', 'bigt', 'bigs', 'msg', 'pickup', 'hpn', 'hpfill', 'hpghost', 'vitals', 'streak', 'wname', 'mag', 'res', 'nades', 'slots', 'reloadbar', 'vig', 'flash', 'scope', 'spawnp', 'fps', 'dead', 'deadby', 'deadinfo', 'deadt', 'deadw', 'board', 'radarc']) this.el[id] = $(id);
    this.radarCtx = this.el.radarc.getContext('2d');
    this._mapCanvas();
    this.spots = []; this.flashT = 0; this.vigT = 0; this.bigT = 0; this.bannerT = 0; this.hmT = 0; this.pickT = 0;
    this.fpsAcc = 0; this.fpsN = 0; this.showFps = false;
    this.xhColor = '#7dffb4';
  }
  _mapCanvas() {
    // top-down map for the radar (4 px per metre), drawn once from the collision boxes
    const S = 4, W = (BOUNDS.x1 - BOUNDS.x0 + 20) * S, H = (BOUNDS.z1 - BOUNDS.z0 + 20) * S;
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const x = c.getContext('2d');
    this.mapS = S; this.mapOX = BOUNDS.x0 - 10; this.mapOZ = BOUNDS.z0 - 10;
    x.fillStyle = 'rgba(40,70,90,0.55)'; x.fillRect(0, 0, W, H);
    const sorted = [...boxes].sort((a, b) => (a.y + a.sy / 2) - (b.y + b.sy / 2));
    for (const b of sorted) {
      if (b.mat === 'rail' || b.vis === 'roof') continue;
      const top = b.y + b.sy / 2;
      let col = 'rgba(70,82,76,1)';
      if (b.mat === 'deck' || b.vis === 'floor') col = top > 3 ? 'rgba(62,68,80,1)' : 'rgba(58,70,62,1)';
      if (b.vis === 'pipefloor') col = 'rgba(30,36,46,1)';
      if (b.vis === 'walkway') col = 'rgba(96,104,84,0.9)';
      if (b.mat === 'container') col = top > 3 ? 'rgba(190,196,200,1)' : 'rgba(150,158,166,1)';
      if (b.mat === 'wood') col = 'rgba(170,130,80,1)';
      if (b.vis === 'cabinwall' || b.vis === 'hull') col = 'rgba(210,210,200,1)';
      if (b.vis === 'furn' || b.step) col = 'rgba(100,106,110,1)';
      const cs = Math.cos(b.ry || 0), sn = Math.sin(b.ry || 0), hx = b.sx / 2, hz = b.sz / 2;
      x.fillStyle = col; x.beginPath();
      [[-hx, -hz], [hx, -hz], [hx, hz], [-hx, hz]].forEach(([u, v], i) => { const px = (b.x + u * cs + v * sn - this.mapOX) * S, pz = (b.z - u * sn + v * cs - this.mapOZ) * S; i ? x.lineTo(px, pz) : x.moveTo(px, pz); });
      x.fill();
    }
    this.mapCanvas = c;
  }
  onMatchStart(g) {
    this.g = g;
    this.spots = [];
    if (this.tagEls) { for (const el of this.tagEls.values()) el.remove(); this.tagEls.clear(); }
    this.el.feed.innerHTML = ''; this.el.radio.innerHTML = ''; this.el.medals.innerHTML = '';
    this.el.goal.textContent = g.mode.id === 'tdm' ? `Deathmatch · first to ${g.mode.limit}` : `Elimination · first to ${g.mode.wins}`;
    this.el.hud.hidden = false; this.el.dead.hidden = true;
  }
  onSpawn(a) { this.el.dead.hidden = true; this.el.xh.style.opacity = 1; this.el.vig.style.opacity = 0; }
  big(t, s, dur = 2) { this.el.bigt.textContent = t; this.el.bigs.textContent = s || ''; this.el.bigmsg.classList.add('show'); this.bigT = dur; }
  banner(t, sub) { this.el.banner.textContent = t; this.el.banner.classList.add('show'); this.bannerT = 2.2; if (sub) this.msg(sub, 2.2); }
  msg(t, dur = 2) { this.el.msg.innerHTML = esc(t); this.msgT = dur; }
  pickup(t) { this.el.pickup.textContent = t; this.el.pickup.style.opacity = 1; this.pickT = 1.4; }
  medal(k) {
    if (!MEDALS[k]) return;
    const d = document.createElement('div'); d.className = 'm';
    const c = document.createElement('canvas'); c.width = c.height = 124; drawMedal(c, k);
    const b = document.createElement('b'); b.textContent = MEDALS[k][0];
    d.append(c, b);
    this.el.medals.appendChild(d);
    while (this.el.medals.children.length > 4) this.el.medals.firstChild.remove();
    setTimeout(() => { d.style.transition = 'opacity .4s'; d.style.opacity = 0; setTimeout(() => d.remove(), 450); }, 2600);
  }
  radio(name, text, enemy) {
    const d = document.createElement('div'); if (enemy) d.className = 'en';
    d.innerHTML = `<b>${esc(name)}:</b> ${esc(text)}`;
    this.el.radio.appendChild(d);
    while (this.el.radio.children.length > 4) this.el.radio.firstChild.remove();
    setTimeout(() => { d.style.opacity = 0; setTimeout(() => d.remove(), 700); }, 5000);
  }
  spot(pos, t) { this.spots.push({ x: pos.x, z: pos.z, t }); if (this.spots.length > 20) this.spots.shift(); }
  feed(A, v, info, hs) {
    const d = document.createElement('div');
    const P = this.g.player;
    if (A === P || v === P) d.className = 'me';
    const tc = (a) => (a.team === 0 ? 'b' : 'r');
    const c = document.createElement('canvas'); c.width = 120; c.height = 44; drawWeaponIcon(c, info.weapon === 'fall' ? 'fall' : info.weapon);
    const who = A && A !== v ? `<span class="${tc(A)}">${esc(A.name)}</span>` : '';
    d.innerHTML = who;
    d.appendChild(c);
    if (hs) { const s = document.createElement('span'); s.className = 'hs'; s.textContent = 'HS'; d.appendChild(s); }
    if (info.wall) { const s = document.createElement('span'); s.className = 'wb'; s.textContent = 'WALL'; d.appendChild(s); }
    const vs = document.createElement('span'); vs.className = tc(v); vs.textContent = v.name; d.appendChild(vs);
    this.el.feed.prepend(d);
    while (this.el.feed.children.length > 6) this.el.feed.lastChild.remove();
    setTimeout(() => { d.style.opacity = 0; setTimeout(() => d.remove(), 600); }, 7000);
  }
  hitmark(head, kill) { const h = this.el.hm; h.className = head ? 'hs' : kill ? 'kill' : ''; h.style.transition = 'none'; h.style.opacity = 1; h.style.transform = 'scale(1.3)'; this.hmT = kill ? 0.45 : 0.22; }
  hurt(info, dmg) { this.vigT = Math.min(1, this.vigT + dmg / 60); }
  damageFrom(pos) {
    const P = this.g.player, dx = pos.x - P.pos.x, dz = pos.z - P.pos.z;
    const ang = Math.atan2(-dx, -dz) - P.yaw; // 0 = in front
    const d = document.createElement('div');
    d.style.transform = `rotate(${-ang}rad)`;
    this.el.dmg.appendChild(d);
    requestAnimationFrame(() => { d.style.opacity = 0; });
    setTimeout(() => d.remove(), 1000);
    while (this.el.dmg.children.length > 6) this.el.dmg.firstChild.remove();
  }
  flash(s) { this.flashT = Math.max(this.flashT, 0.5 + s * 3.5); }
  fired(def) { this.kick = Math.min(1, (this.kick || 0) + 0.35); }
  onDeath(P, info) {
    const A = info.attacker;
    this.el.xh.style.opacity = 0;
    this.el.scope.hidden = true;
    this.el.dead.hidden = false;
    this.el.deadby.textContent = A && A !== P ? A.name : info.weapon === 'frag' ? 'Your own grenade' : 'The sea';
    this.el.deadby.style.color = A && A.team === 1 ? '#ff9d90' : '#8cc8ff';
    drawWeaponIcon(this.el.deadw, info.weapon);
    const W = WEAPONS[info.weapon];
    this.el.deadinfo.textContent = A && A !== P ? `${W ? W.name : 'Frag'} · ${info.dist ? info.dist.toFixed(0) + ' m' : ''}${info.part === 'head' ? ' · headshot' : ''} · ${Math.max(0, A.hp)} HP left` : '';
  }
  spectate(name) { this.el.deadt.textContent = `SPECTATING ${name.toUpperCase()}`; }
  showBoard(on) {
    const b = this.el.board;
    if (!on) { b.hidden = true; return; }
    b.hidden = false; b.innerHTML = this.boardHTML();
  }
  boardHTML() {
    const g = this.g, P = g.player;
    let h = '';
    for (const t of [0, 1]) {
      const list = g.actors.filter((a) => a.team === t).sort((a, b) => b.stats.score - a.stats.score || b.stats.k - a.stats.k);
      const sc = g.mode.id === 'tdm' ? g.scores[t] : g.roundWins[t];
      h += `<table class="sb t${t}"><caption style="color:${t ? '#ff9d90' : '#8cc8ff'}">${TEAM_NAMES[t]} · ${sc}</caption><tr><th>Name</th><th>K</th><th>D</th><th>A</th><th>HS</th><th>Score</th></tr>`;
      for (const a of list) h += `<tr class="${a === P ? 'me' : ''} ${a.alive ? '' : 'dead'}"><td>${esc(a.name)}${a.role ? `<span class="role">${a.role} · ${WEAPONS[a.primary].name}</span>` : `<span class="role">${WEAPONS[a.primary].name}</span>`}</td><td>${a.stats.k}</td><td>${a.stats.d}</td><td>${a.stats.a}</td><td>${a.stats.hs}</td><td>${a.stats.score}</td></tr>`;
      h += '</table>';
    }
    return h;
  }
  onEnd(g) {
    this.el.hud.hidden = true; this.el.dead.hidden = true; this.el.board.hidden = true;
  }
  // ------------------------------------------------------------------------------------------------ per frame
  update(g, dt, view) {
    const P = g.player, E = this.el;
    if (!P) return;
    // top bar
    if (g.mode.id === 'tdm') {
      E.s0.textContent = g.scores[0]; E.s1.textContent = g.scores[1];
      const t = Math.max(0, g.matchT); E.clock.textContent = `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
    } else {
      E.s0.textContent = g.roundWins[0]; E.s1.textContent = g.roundWins[1];
      const t = g.freeze ? g.freezeT : Math.max(0, g.roundT); E.clock.textContent = g.freeze ? `0:0${Math.ceil(t)}` : `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
    }
    for (const t of [0, 1]) {
      const list = g.actors.filter((a) => a.team === t);
      const key = list.map((a) => (a.alive ? 1 : 0)).join('');
      if (E['al' + t].dataset.k !== key) { E['al' + t].dataset.k = key; E['al' + t].innerHTML = list.map((a) => `<i class="${a.alive ? '' : 'dead'}"></i>`).join(''); }
    }
    // vitals / ammo
    E.hpn.textContent = Math.max(0, P.hp);
    E.hpfill.style.width = Math.max(0, P.hp) + '%';
    this.ghost = this.ghost == null ? P.hp : this.ghost + (P.hp - this.ghost) * Math.min(1, dt * 2);
    E.hpghost.style.width = Math.max(0, this.ghost) + '%';
    E.vitals.classList.toggle('low', P.hp <= 30);
    E.streak.textContent = P.streak >= 2 ? `×${P.streak}` : '';
    const w = curWeapon(P);
    if (P.nadeSel) {
      E.wname.textContent = { frag: 'Frag grenade', flash: 'Flash grenade', smoke: 'Smoke grenade' }[P.nadeSel];
      E.mag.textContent = P.load.nades[P.nadeSel]; E.res.textContent = '';
      E.mag.classList.remove('low');
    } else if (w) {
      E.wname.textContent = w.def.name;
      E.mag.textContent = w.def.kind === 'knife' ? '—' : w.mag; E.res.textContent = w.def.kind === 'knife' ? '' : `/ ${w.reserve}`;
      E.mag.classList.toggle('low', w.def.kind !== 'knife' && w.mag <= Math.ceil(w.def.mag * 0.25));
    }
    const nk = `${P.load.nades.frag}${P.load.nades.flash}${P.load.nades.smoke}${P.nadeSel}`;
    if (E.nades.dataset.k !== nk) { E.nades.dataset.k = nk; E.nades.innerHTML = ['frag', 'flash', 'smoke'].map((k) => `<span class="${P.nadeSel === k ? 'on' : ''}">${k.toUpperCase()} ${P.load.nades[k]}</span>`).join(''); }
    const sk = `${P.slot}${P.nadeSel}${P.primary}`;
    if (E.slots.dataset.k !== sk) { E.slots.dataset.k = sk; E.slots.innerHTML = P.load.guns.map((gw, i) => `<div class="${!P.nadeSel && P.slot === i ? 'on' : ''}">${i + 1} ${gw.def.name.split(' ')[0].toUpperCase()}</div>`).join('') + `<div class="${P.nadeSel ? 'on' : ''}">4 NADE</div>`; }
    // reload bar
    if (w && w.reloading && !w.def.shellReload) { E.reloadbar.hidden = false; E.reloadbar.firstElementChild.style.width = (100 * (1 - w.reloadT / (w.reloadLen || w.def.reload))) + '%'; }
    else E.reloadbar.hidden = true;
    // crosshair: gap follows the real spread; hidden when dead, scoped, aiming with an optic
    const alive = P.alive && g.state === 'play';
    const scoped = view.scoped;
    E.scope.hidden = !(scoped && alive);
    let show = alive && !scoped && !(P.ads > 0.6 && w && w.def.ads.sight !== 'none') && !P.nadeSel;
    if (w && w.def.kind === 'sniper' && P.ads < 0.6) show = alive; // no-scope: crosshair shown but wide
    E.xh.style.opacity = show ? 1 : 0;
    if (show && w) {
      this.kick = (this.kick || 0) * Math.exp(-dt * 10);
      const sp = w.def.kind === 'knife' ? 0.6 : spreadOf(w, P);
      const px = Math.tan((sp * Math.PI) / 180) / Math.tan((view.fov * Math.PI) / 360) * innerHeight / 2;
      const gap = Math.max(3, Math.min(90, px)) + this.kick * 6;
      E.xh.style.setProperty('--xh', this.xhColor);
      const [u, d, l, r] = E.xh.children;
      u.style.top = (-gap - 9) + 'px'; d.style.top = gap + 'px'; l.style.left = (-gap - 9) + 'px'; r.style.left = gap + 'px';
      E.xh.classList.toggle('knife', w.def.kind === 'knife');
    }
    // hitmarker fade
    if (this.hmT > 0) { this.hmT -= dt; if (this.hmT <= 0) { E.hm.style.transition = 'opacity .15s, transform .15s'; E.hm.style.opacity = 0; E.hm.style.transform = 'scale(1)'; } }
    // vignette / flash
    this.vigT = Math.max(P.hp < 30 && P.alive ? 0.35 + Math.sin(g.time * 5) * 0.12 : 0, this.vigT - dt * 0.8);
    E.vig.style.opacity = this.vigT;
    this.flashT = Math.max(0, this.flashT - dt);
    E.flash.style.opacity = Math.min(1, this.flashT * 0.8);
    // timers
    if (this.bigT > 0) { this.bigT -= dt; if (this.bigT <= 0) E.bigmsg.classList.remove('show'); }
    if (this.bannerT > 0) { this.bannerT -= dt; if (this.bannerT <= 0) E.banner.classList.remove('show'); }
    if (this.msgT > 0) { this.msgT -= dt; if (this.msgT <= 0) E.msg.innerHTML = ''; }
    if (this.pickT > 0) { this.pickT -= dt; if (this.pickT <= 0) E.pickup.style.opacity = 0; }
    E.spawnp.hidden = !(P.alive && P.spawnProt > 0);
    // zone / environment
    E.zone.textContent = view.zone || '';
    // death panel timer
    if (!P.alive && g.state === 'play') {
      if (g.mode.id === 'tdm') { const t = Math.max(0, (P.respawnAt || 0) - g.time); E.deadt.textContent = `RESPAWN IN ${t.toFixed(1)}`; }
      else if (!g.deathCam || g.deathCam.t < 4) E.deadt.textContent = 'WAITING FOR THE NEXT ROUND';
    }
    // scoreboard live refresh
    if (!E.board.hidden && (this._bt = (this._bt || 0) + dt) > 0.3) { this._bt = 0; E.board.innerHTML = this.boardHTML(); }
    // fps
    if (this.showFps) { this.fpsAcc += dt; this.fpsN++; if (this.fpsAcc > 0.5) { E.fps.hidden = false; E.fps.textContent = Math.round(this.fpsN / this.fpsAcc) + ' fps'; this.fpsAcc = 0; this.fpsN = 0; } } else E.fps.hidden = true;
    this._radar(g, P);
    this._tags(g, P, view.cam);
  }
  // name tags: teammates always (blue), an enemy only while he's under the crosshair with a clear line (red)
  _tags(g, P, cam) {
    if (!cam) return;
    cam.updateMatrixWorld(); cam.matrixWorldInverse.copy(cam.matrixWorld).invert();
    const host = this.tagHost || (this.tagHost = document.getElementById('tags'));
    if (!this.tagEls) this.tagEls = new Map();
    const W = innerWidth, H = innerHeight, v = this._tv || (this._tv = cam.position.clone());
    const dir = this._td || (this._td = cam.position.clone()); cam.getWorldDirection(dir);
    let aimed = null;
    if (P.alive) {
      let bt = 90;
      for (const a of g.actors) {
        if (a.team === P.team || !a.alive) continue;
        const r = a.soldier.raycast(cam.position, dir, bt, g.frame);
        if (r && g.coll.los(cam.position.x, cam.position.y, cam.position.z, a.pos.x, a.pos.y + 1.4, a.pos.z)) { bt = r.t; aimed = a; }
      }
    }
    for (const a of g.actors) {
      if (a === P) continue;
      let el = this.tagEls.get(a);
      const show = a.alive && (a.team === P.team || a === aimed) && g.state === 'play';
      if (!show) { if (el) el.style.display = 'none'; continue; }
      v.set(a.pos.x, a.pos.y + 2.05 - a.crouchAmt * 0.5, a.pos.z);
      const d = v.distanceTo(cam.position);
      v.project(cam);
      if (v.z > 1 || Math.abs(v.x) > 1.05 || Math.abs(v.y) > 1.05 || d > 70) { if (el) el.style.display = 'none'; continue; }
      if (!el) { el = document.createElement('b'); el.innerHTML = '<span></span><i><u></u></i>'; host.appendChild(el); this.tagEls.set(a, el); }
      el.style.display = '';
      el.className = a.team === P.team ? '' : 'en';
      if (el.firstChild.textContent !== a.name) el.firstChild.textContent = a.name;
      el.lastChild.firstChild.style.width = Math.max(0, a.hp) + '%';
      el.style.left = ((v.x + 1) / 2 * W).toFixed(1) + 'px'; el.style.top = ((1 - v.y) / 2 * H).toFixed(1) + 'px';
      el.style.opacity = d > 40 ? 0.6 : 1;
    }
  }
  _radar(g, P) {
    const x = this.radarCtx, W = 352, R = W / 2, S = 4.4; // px per metre on the radar canvas (~40 m radius)
    x.clearRect(0, 0, W, W);
    x.save();
    x.beginPath(); x.arc(R, R, R, 0, 7); x.clip();
    x.fillStyle = 'rgba(10,20,30,0.6)'; x.fillRect(0, 0, W, W);
    x.translate(R, R);
    const yaw = P.alive ? P.yaw : g.camYaw;
    x.rotate(yaw);
    const cx = P.pos.x, cz = P.pos.z;
    const k = S / this.mapS;
    x.globalAlpha = 0.9;
    x.drawImage(this.mapCanvas, (this.mapOX - cx) * S, (this.mapOZ - cz) * S, this.mapCanvas.width * k, this.mapCanvas.height * k);
    x.globalAlpha = 1;
    // smoke clouds
    for (const s of g.fx.smokes) { x.fillStyle = 'rgba(220,220,220,0.35)'; x.beginPath(); x.arc((s.p.x - cx) * S, (s.p.z - cz) * S, s.r * S, 0, 7); x.fill(); }
    // teammates, spotted enemies (recent intel or firing)
    for (const a of g.actors) {
      if (a === P || !a.alive) continue;
      const mate = a.team === P.team;
      const spotted = !mate && ((g.time - (a.lastShot || -9) < 1.2) || this.spots.some((s) => g.time - s.t < 2.5 && Math.hypot(s.x - a.pos.x, s.z - a.pos.z) < 3));
      if (!mate && !spotted) continue;
      const px = (a.pos.x - cx) * S, pz = (a.pos.z - cz) * S;
      x.save(); x.translate(px, pz); x.rotate(-a.yaw);
      x.fillStyle = mate ? '#5aa8ff' : '#ff5a4a'; x.strokeStyle = '#000'; x.lineWidth = 2;
      x.beginPath(); x.moveTo(0, -11); x.lineTo(7, 7); x.lineTo(0, 3); x.lineTo(-7, 7); x.closePath(); x.stroke(); x.fill();
      x.restore();
    }
    // own dead body marker and nades
    for (const n of g.nades) { x.fillStyle = n.kind === 'frag' ? '#ffb347' : '#ddd'; x.beginPath(); x.arc((n.pos.x - cx) * S, (n.pos.z - cz) * S, 4, 0, 7); x.fill(); }
    x.restore();
    // player arrow + view cone
    x.fillStyle = 'rgba(255,255,255,0.08)'; x.beginPath(); x.moveTo(R, R); x.arc(R, R, R, -Math.PI / 2 - 0.6, -Math.PI / 2 + 0.6); x.fill();
    x.fillStyle = '#ffe2a8'; x.beginPath(); x.moveTo(R, R - 13); x.lineTo(R + 8, R + 8); x.lineTo(R, R + 3); x.lineTo(R - 8, R + 8); x.closePath(); x.fill();
    x.strokeStyle = 'rgba(255,255,255,0.25)'; x.lineWidth = 3; x.beginPath(); x.arc(R, R, R - 2, 0, 7); x.stroke();
    // compass N (bow = +x)
    x.fillStyle = 'rgba(255,255,255,0.6)'; x.font = '600 18px "IBM Plex Mono", monospace'; x.textAlign = 'center';
    // the bow (+x world) after the radar rotation lands at angle = yaw on screen
    x.fillText('BOW', R + Math.cos(yaw) * (R - 18), R + Math.sin(yaw) * (R - 18) + 6);
  }
}
