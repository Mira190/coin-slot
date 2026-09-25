// DOM HUD and menus: crosshair gate indicators, prompts, captions with a typing effect, trial cards,
// trial select with records, settings, completion screen and the credits roll.
import { iconCanvas } from './textures.js';
import { save, persist, fmtTime, completedCount } from './save.js';

const $ = (s) => document.querySelector(s);
export const hud = { onCaption: null };

export function showHUD(on) { $('#hud').hidden = !on; }
export function setGates(a, b, mode) {
  $('#xhair .a').classList.toggle('on', a); $('#xhair .b').classList.toggle('on', b);
  $('#xhair .a').style.display = mode >= 1 ? '' : 'none'; $('#xhair .b').style.display = mode >= 2 ? '' : 'none';
}
export function setHolding(h) { $('#xhair').classList.toggle('hold', h); }
let promptTxt = '';
export function prompt(txt) { if (txt === promptTxt) return; promptTxt = txt; const p = $('#prompt'); p.classList.toggle('on', !!txt); if (txt) p.innerHTML = txt; }
export function stats(time, shots) { $('#stats').innerHTML = `<b>${fmtTime(time)}</b><br>${shots} gate${shots === 1 ? '' : 's'}`; }
export function trialTag(t) { $('#trialtag').textContent = t; }
let toastT = 0;
export function toast(t, dur = 1.6) { const e = $('#toast'); e.textContent = t; e.classList.add('on'); toastT = dur; }
export function vignette(k) { $('#vign').style.opacity = Math.max(0, Math.min(1, k)).toFixed(3); }
export function speedFx(k) { $('#speedfx').style.opacity = Math.max(0, Math.min(1, k)).toFixed(3); }
export function fade(on) { $('#fade').classList.toggle('clear', !on); }

let cardT = 0;
export function card(num, total, name, icons) {
  const c = $('#card');
  c.querySelector('.num').textContent = num === 'X' ? 'UNSCHEDULED' : `TRIAL ${String(num).padStart(2, '0')} / ${String(total).padStart(2, '0')}`;
  c.querySelector('.name').textContent = name;
  const ic = c.querySelector('.icons'); ic.innerHTML = '';
  for (const k of icons) ic.appendChild(iconCanvas(k, 68, '#eef0ec', 'rgba(17,22,26,.8)'));
  c.classList.add('on'); cardT = 4.2;
}

// ---------------------------------------------------------------- captions
const capQ = []; let cap = null;
export function say(text, opts = {}) {
  if (!text) return;
  if (opts.now) { capQ.length = 0; cap = null; }
  if (capQ.some((c) => c.text === text) || (cap && cap.text === text)) return;
  capQ.push({ text, dur: opts.dur || 1.6 + text.length * 0.052, delay: opts.delay || 0 });
}
export function clearCaptions() { capQ.length = 0; cap = null; $('#caption').classList.remove('on'); }
export const captionBusy = () => !!cap || capQ.length > 0;

export function updateHUD(dt) {
  if (toastT > 0) { toastT -= dt; if (toastT <= 0) $('#toast').classList.remove('on'); }
  if (cardT > 0) { cardT -= dt; if (cardT <= 0) $('#card').classList.remove('on'); }
  const el = $('#caption'), tx = el.querySelector('.txt');
  if (!cap && capQ.length) {
    if (capQ[0].delay > 0) capQ[0].delay -= dt;
    else { cap = capQ.shift(); cap.t = 0; el.classList.add('on'); tx.textContent = ''; if (hud.onCaption) hud.onCaption(cap.text); }
  }
  if (cap) {
    cap.t += dt;
    const n = Math.min(cap.text.length, Math.floor(cap.t * 55));
    if (tx.textContent.length !== n) tx.textContent = cap.text.slice(0, n);
    if (cap.t > cap.dur) { cap = null; if (!capQ.length) el.classList.remove('on'); }
  }
}

// ---------------------------------------------------------------- menus
const OVS = ['menu', 'select', 'pause', 'settings', 'done', 'notice'];
let stack = [];
export function showMenu(id) {
  for (const k of OVS) $('#' + k).hidden = k !== id;
  if (!id) return;
  stack.push(id);
  const c = $('#card'); cardT = 0; c.style.transition = 'none'; c.classList.remove('on'); void c.offsetWidth; c.style.transition = ''; // gone at once, not fading behind the menu
}
export function menuBack() { stack.pop(); const prev = stack.pop(); showMenu(prev || null); return prev; }
export function hideMenus() { for (const k of OVS) $('#' + k).hidden = true; stack = []; }
export const menuOpen = () => OVS.some((k) => !$('#' + k).hidden);

export function buildSelect(chambers, onPick) {
  const g = $('#sel-grid'); g.innerHTML = '';
  const total = chambers.filter((c) => !(c.part > 1)).length; // escape parts 2-3 follow part 1 automatically
  $('#sel-sub').textContent = `${completedCount()} of ${total} complete · records are your best time and fewest gates`;
  chambers.forEach((c, i) => {
    if (c.part > 1) return;
    const r = save.done[c.id], unlocked = i === 0 || !!save.done[chambers[i - 1].id] || !!r || new URLSearchParams(location.search).has('all');
    const b = document.createElement('button'); b.className = 'tcard' + (c.escape ? ' escape' : ''); b.disabled = !unlocked;
    b.innerHTML = `<span class="n">${c.escape ? 'UNSCHEDULED' : 'TRIAL ' + String(i + 1).padStart(2, '0')}</span><span class="t">${c.name}</span>` +
      `<span class="ico"></span><span class="r">${r ? `${fmtTime(r.time)} · ${r.gates} gate${r.gates === 1 ? '' : 's'}` : unlocked ? 'not yet attempted' : 'locked'}</span>` + (r ? '<span class="ok">✓</span>' : '');
    const ic = b.querySelector('.ico'); for (const k of c.icons.slice(0, 5)) ic.appendChild(iconCanvas(k, 40, c.escape ? '#eef0ec' : '#11161a', c.escape ? '#1a1f23' : '#eef0ec'));
    b.addEventListener('click', () => onPick(i));
    g.appendChild(b);
  });
}

export function fillDone(ch, idx, total, time, gates, flags, quip, hasNext) {
  $('#done-num').textContent = ch.escape ? 'UNSCHEDULED DEPARTURE' : `TRIAL ${String(idx + 1).padStart(2, '0')} COMPLETE`;
  $('#done-name').textContent = ch.name;
  const r = save.done[ch.id];
  $('#done-time').innerHTML = fmtTime(time) + (flags.newTime && !flags.first ? '<small>record</small>' : `<small style="color:rgba(17,22,26,.5)">${r && !flags.first ? 'best ' + fmtTime(r.time) : ''}</small>`);
  $('#done-gates').innerHTML = gates + (flags.newGates && !flags.first ? '<small>record</small>' : `<small style="color:rgba(17,22,26,.5)">${r && !flags.first ? 'best ' + r.gates : ''}</small>`);
  $('#done-count').textContent = `${completedCount()} / ${total}`;
  $('#done-quip').textContent = quip;
  $('#d-next').hidden = !hasNext;
}

export function bindSettings(apply) {
  const s = save.settings, set = (id, v) => { $(id).value = String(v); };
  set('#s-sens', s.sens); set('#s-fov', s.fov); set('#s-inv', s.invert); set('#s-vol', s.vol); set('#s-mus', s.music); set('#s-q', s.quality); set('#s-bob', s.bob);
  const upd = () => {
    s.sens = +$('#s-sens').value; s.fov = +$('#s-fov').value; s.invert = +$('#s-inv').value; s.vol = +$('#s-vol').value;
    s.music = +$('#s-mus').value; s.quality = $('#s-q').value; s.bob = +$('#s-bob').value; persist(); apply(s);
  };
  for (const id of ['#s-sens', '#s-fov', '#s-inv', '#s-vol', '#s-mus', '#s-q', '#s-bob']) $(id).addEventListener('input', upd);
  apply(s);
}

export function rollCredits(lines, onDone) {
  const c = $('#credits'), r = $('#roll'); c.hidden = false; r.innerHTML = lines;
  r.animate([{ transform: 'translateY(60vh)' }, { transform: 'translateY(-110%)' }], { duration: 42000, easing: 'linear' }).onfinish = () => { c.hidden = true; onDone(); };
  c.onclick = () => { c.hidden = true; onDone(); c.onclick = null; };
}
