// All sound is synthesized with WebAudio: layered one-shots (optionally positional), looping hums for lasers and
// bridges, a room tone, a speed wind, and a generative ambient music bed with a tenser mode for the escape.
let ctx = null, master, sfxBus, musicBus, ambBus, verbSend, comp, noiseBuf = null;
const loops = new Map();
export const audio = { ready: false, muted: false, vol: 0.8, musicVol: 0.55, mode: 'calm' };

export function initAudio() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
  const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
  ctx = new AC();
  comp = ctx.createDynamicsCompressor(); comp.threshold.value = -16; comp.ratio.value = 4; comp.attack.value = 0.004; comp.release.value = 0.2;
  master = ctx.createGain(); master.gain.value = audio.muted ? 0 : audio.vol;
  comp.connect(master); master.connect(ctx.destination);
  sfxBus = ctx.createGain(); sfxBus.connect(comp);
  musicBus = ctx.createGain(); musicBus.gain.value = audio.musicVol * 0.5; musicBus.connect(comp);
  ambBus = ctx.createGain(); ambBus.gain.value = 0.5; ambBus.connect(comp);
  const verb = ctx.createConvolver(); verb.buffer = impulse(2.8, 2.4); const vg = ctx.createGain(); vg.gain.value = 0.55; verb.connect(vg); vg.connect(comp);
  verbSend = ctx.createGain(); verbSend.gain.value = 1; verbSend.connect(verb);
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  audio.ready = true;
  roomTone(); startMusic();
}
export function setMute(m) { audio.muted = m; if (master) master.gain.setTargetAtTime(m ? 0 : audio.vol, ctx.currentTime, 0.05); }
export function setVolume(v) { audio.vol = v; if (master && !audio.muted) master.gain.setTargetAtTime(v, ctx.currentTime, 0.05); }
export function setMusicVolume(v) { audio.musicVol = v; if (musicBus) musicBus.gain.setTargetAtTime(v * 0.5, ctx.currentTime, 0.2); }
export function suspend(on) { if (!ctx) return; if (on) ctx.suspend(); else ctx.resume(); }

function impulse(sec, decay) {
  const n = Math.floor(ctx.sampleRate * sec), b = ctx.createBuffer(2, n, ctx.sampleRate);
  for (let c = 0; c < 2; c++) { const d = b.getChannelData(c); for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, decay) * (i < 90 ? i / 90 : 1); }
  return b;
}

// ---------------------------------------------------------------- building blocks
const now = () => ctx.currentTime;
function out(pos, wet = 0.25, vol = 1) {
  const g = ctx.createGain(); g.gain.value = vol;
  let head = g;
  if (pos) {
    const p = ctx.createPanner(); p.panningModel = 'HRTF'; p.distanceModel = 'inverse'; p.refDistance = 2.5; p.rolloffFactor = 1.1; p.maxDistance = 80;
    setPos(p, pos); g.connect(p); p.connect(sfxBus); if (wet) { const w = ctx.createGain(); w.gain.value = wet; p.connect(w); w.connect(verbSend); }
  } else { g.connect(sfxBus); if (wet) { const w = ctx.createGain(); w.gain.value = wet; g.connect(w); w.connect(verbSend); } }
  return head;
}
function setPos(p, v) { if (p.positionX) { p.positionX.value = v.x; p.positionY.value = v.y; p.positionZ.value = v.z; } else p.setPosition(v.x, v.y, v.z); }
function tone(dest, type, f0, f1, t0, dur, peak = 0.3, a = 0.005) {
  const o = ctx.createOscillator(), g = ctx.createGain(); o.type = type;
  o.frequency.setValueAtTime(f0, t0); if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t0 + dur);
  g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(peak, t0 + a); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g); g.connect(dest); o.start(t0); o.stop(t0 + dur + 0.05); return o;
}
function noise(dest, t0, dur, { type = 'bandpass', f0 = 1000, f1 = f0, q = 1, peak = 0.3, a = 0.005 } = {}) {
  const s = ctx.createBufferSource(); s.buffer = noiseBuf; s.loop = true; s.playbackRate.value = 0.8 + Math.random() * 0.4;
  const f = ctx.createBiquadFilter(); f.type = type; f.Q.value = q; f.frequency.setValueAtTime(f0, t0); if (f1 !== f0) f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + dur);
  const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(peak, t0 + a); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  s.connect(f); f.connect(g); g.connect(dest); s.start(t0, Math.random()); s.stop(t0 + dur + 0.05); return f;
}
function fm(dest, carrier, ratio, index, t0, dur, peak = 0.2) {
  const c = ctx.createOscillator(), m = ctx.createOscillator(), mg = ctx.createGain(), g = ctx.createGain();
  c.frequency.value = carrier; m.frequency.value = carrier * ratio; mg.gain.setValueAtTime(carrier * index, t0); mg.gain.exponentialRampToValueAtTime(1, t0 + dur);
  m.connect(mg); mg.connect(c.frequency); c.connect(g); g.connect(dest);
  g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(peak, t0 + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  c.start(t0); m.start(t0); c.stop(t0 + dur + 0.05); m.stop(t0 + dur + 0.05);
}

// ---------------------------------------------------------------- one-shots
const SFX = {
  fire(d, t, o) { const k = o.i ? 0.78 : 1; tone(d, 'sine', 1500 * k, 260 * k, t, 0.2, 0.25); tone(d, 'square', 900 * k, 120 * k, t, 0.09, 0.05); noise(d, t, 0.14, { f0: 4000, f1: 900, q: 2, peak: 0.18 }); tone(d, 'sine', 110, 45, t, 0.18, 0.35); },
  open(d, t, o) {
    const k = o.i ? [523.3, 784] : [659.3, 987.8];
    noise(d, t, 0.45, { f0: 350, f1: 2400, q: 3, peak: 0.22, a: 0.02 });
    for (const f of k) { const osc = tone(d, 'sine', f, f, t + 0.02, 0.9, 0.07, 0.03); const l = ctx.createOscillator(), lg = ctx.createGain(); l.frequency.value = 7; lg.gain.value = 6; l.connect(lg); lg.connect(osc.frequency); l.start(t); l.stop(t + 1); }
    tone(d, 'triangle', 90, 60, t, 0.3, 0.2);
  },
  close(d, t) { tone(d, 'sine', 1400, 180, t, 0.35, 0.12); noise(d, t, 0.3, { f0: 3000, f1: 600, q: 4, peak: 0.12 }); },
  fail(d, t) { tone(d, 'square', 150, 90, t, 0.12, 0.09); noise(d, t, 0.2, { f0: 1800, f1: 400, q: 6, peak: 0.12 }); tone(d, 'sawtooth', 62, 55, t, 0.25, 0.05); },
  teleport(d, t) { noise(d, t, 0.42, { type: 'lowpass', f0: 300, f1: 3000, q: 2, peak: 0.28, a: 0.08 }); tone(d, 'sine', 220, 440, t, 0.3, 0.05, 0.05); },
  step(d, t, o) {
    const r = 0.8 + Math.random() * 0.4;
    if (o.metal) { noise(d, t, 0.09, { f0: 2200 * r, q: 5, peak: 0.08 }); tone(d, 'triangle', 320 * r, 200 * r, t, 0.06, 0.04); }
    else noise(d, t, 0.1, { type: 'lowpass', f0: 900 * r, f1: 250, q: 1, peak: 0.16 });
    tone(d, 'sine', 90 * r, 50, t, 0.08, 0.08);
  },
  land(d, t, o) { const v = Math.min(1, (o.v || 5) / 14); tone(d, 'sine', 130, 38, t, 0.25, 0.3 * v + 0.08); noise(d, t, 0.22, { type: 'lowpass', f0: 1200, f1: 200, peak: 0.25 * v + 0.05 }); },
  jump(d, t) { noise(d, t, 0.14, { type: 'bandpass', f0: 700, f1: 1400, q: 1, peak: 0.05, a: 0.02 }); },
  pickup(d, t) { tone(d, 'sawtooth', 180, 520, t, 0.18, 0.04, 0.02); tone(d, 'sine', 880, 1320, t + 0.05, 0.12, 0.06); },
  drop(d, t) { tone(d, 'sawtooth', 520, 160, t, 0.2, 0.035, 0.02); },
  throw(d, t) { noise(d, t, 0.25, { f0: 600, f1: 2200, q: 1.5, peak: 0.15, a: 0.03 }); tone(d, 'sawtooth', 300, 900, t, 0.12, 0.03); },
  impact(d, t, o) { const v = Math.min(1, (o.v || 3) / 9); noise(d, t, 0.12, { f0: 380, q: 2.5, peak: 0.3 * v }); tone(d, 'sine', 200, 85, t, 0.18, 0.25 * v); noise(d, t, 0.05, { f0: 3000, q: 3, peak: 0.08 * v }); },
  btnDown(d, t) { tone(d, 'sine', 110, 55, t, 0.2, 0.35); noise(d, t, 0.08, { f0: 900, q: 2, peak: 0.2 }); tone(d, 'sine', 660, 660, t + 0.08, 0.1, 0.08); tone(d, 'sine', 990, 990, t + 0.17, 0.2, 0.08); },
  btnUp(d, t) { tone(d, 'sine', 990, 990, t, 0.1, 0.06); tone(d, 'sine', 660, 660, t + 0.09, 0.18, 0.06); tone(d, 'sine', 90, 60, t, 0.12, 0.12); },
  pedestal(d, t) { noise(d, t, 0.03, { f0: 4000, q: 3, peak: 0.2 }); tone(d, 'sine', 1200, 1200, t + 0.02, 0.12, 0.08); },
  tick(d, t) { tone(d, 'square', 1800, 1800, t, 0.025, 0.03); },
  pedestalOff(d, t) { tone(d, 'sine', 900, 300, t, 0.3, 0.07); },
  doorOpen(d, t) {
    const o = ctx.createOscillator(), f = ctx.createBiquadFilter(), g = ctx.createGain(); o.type = 'sawtooth'; o.frequency.setValueAtTime(70, t); o.frequency.linearRampToValueAtTime(95, t + 0.8);
    f.type = 'lowpass'; f.frequency.value = 500; g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.08, t + 0.1); g.gain.setValueAtTime(0.08, t + 0.7); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.95);
    o.connect(f); f.connect(g); g.connect(d); o.start(t); o.stop(t + 1);
    noise(d, t, 0.6, { type: 'highpass', f0: 3000, f1: 5000, peak: 0.05, a: 0.05 });
    tone(d, 'sine', 90, 50, t + 0.9, 0.2, 0.2);
  },
  doorClose(d, t) { SFX.doorOpen(d, t); tone(d, 'sine', 140, 45, t + 0.85, 0.3, 0.35); noise(d, t + 0.85, 0.15, { f0: 600, q: 1.5, peak: 0.2 }); },
  dropper(d, t) { noise(d, t, 0.5, { type: 'highpass', f0: 2500, peak: 0.08, a: 0.05 }); tone(d, 'square', 160, 90, t, 0.08, 0.06); },
  gridPass(d, t) { tone(d, 'sawtooth', 58, 62, t, 0.45, 0.08); noise(d, t, 0.4, { f0: 2500, q: 8, peak: 0.12 }); },
  fizzle(d, t) { for (let i = 0; i < 16; i++) tone(d, 'sine', 2000 + Math.random() * 3500, 1500 + Math.random() * 1000, t + i * 0.05, 0.12, 0.025); noise(d, t, 0.9, { type: 'highpass', f0: 5000, peak: 0.05, a: 0.1 }); },
  plate(d, t) { tone(d, 'sine', 90, 35, t, 0.35, 0.4); noise(d, t, 0.2, { type: 'lowpass', f0: 1500, f1: 300, peak: 0.3 }); noise(d, t + 0.05, 0.7, { f0: 400, f1: 2500, q: 1, peak: 0.15, a: 0.1 }); },
  catchOn(d, t) { fm(d, 880, 3.5, 2, t, 0.9, 0.08); fm(d, 1318.5, 3.5, 1.5, t + 0.07, 1.1, 0.06); },
  catchOff(d, t) { fm(d, 660, 3.5, 1.5, t, 0.5, 0.05); },
  bridgeOn(d, t) { tone(d, 'sine', 90, 180, t, 0.6, 0.12, 0.05); tone(d, 'triangle', 360, 720, t, 0.5, 0.04, 0.05); noise(d, t, 0.4, { f0: 2000, f1: 5000, q: 2, peak: 0.05, a: 0.1 }); },
  bridgeOff(d, t) { tone(d, 'sine', 180, 60, t, 0.4, 0.1); },
  bounce(d, t) { tone(d, 'sine', 240, 720, t, 0.25, 0.22, 0.01); tone(d, 'triangle', 120, 360, t, 0.2, 0.1); noise(d, t, 0.08, { f0: 900, q: 1, peak: 0.1 }); },
  splat(d, t) { noise(d, t, 0.09, { f0: 700 + Math.random() * 500, q: 2, peak: 0.08 }); },
  die(d, t) { tone(d, 'sine', 70, 28, t, 1.4, 0.45); noise(d, t, 1.0, { type: 'lowpass', f0: 800, f1: 60, peak: 0.3 }); tone(d, 'sawtooth', 220, 55, t, 0.8, 0.06); },
  complete(d, t) { [523.3, 659.3, 784, 1046.5, 1318.5].forEach((f, i) => fm(d, f, 2, 1.2, t + i * 0.09, 1.3 - i * 0.1, 0.07)); },
  burn(d, t) { noise(d, t, 0.12, { type: 'highpass', f0: 3000, peak: 0.1 }); tone(d, 'sawtooth', 300, 200, t, 0.08, 0.03); },
  nope(d, t) { tone(d, 'square', 220, 180, t, 0.08, 0.035); },
  blip(d, t, o) {
    const n = Math.min(9, 3 + Math.floor((o.len || 30) / 14));
    for (let i = 0; i < n; i++) { const f = 380 + Math.random() * 380; fm(d, f, 1.5 + Math.random(), 1.2, t + i * 0.075, 0.07, 0.04); }
  },
  wake(d, t) { [196, 293.7, 392, 587.3].forEach((f, i) => fm(d, f, 1, 0.8, t + i * 0.18, 1.8, 0.05)); },
  alarm(d, t) { for (let i = 0; i < 3; i++) { tone(d, 'square', 880, 660, t + i * 0.5, 0.35, 0.05); } },
  hatch(d, t) { tone(d, 'square', 120, 60, t, 0.15, 0.08); noise(d, t, 0.3, { f0: 500, q: 2, peak: 0.15 }); },
};
const WET = { open: 0.4, close: 0.3, fail: 0.2, complete: 0.6, die: 0.7, catchOn: 0.5, wake: 0.7, fizzle: 0.5, bounce: 0.3, doorOpen: 0.3, doorClose: 0.3 };
const VOL = { step: 0.8, splat: 0.7, tick: 0.8, blip: 0.9 };

export function sfx(name, pos = null, o = {}) {
  if (!audio.ready || audio.muted || !SFX[name]) return;
  if (ctx.state !== 'running') return;
  const d = out(pos, WET[name] ?? 0.2, (VOL[name] ?? 1) * (o.vol ?? 1));
  SFX[name](d, now() + 0.005, o);
}

// ---------------------------------------------------------------- loops (laser hum, bridge hum, wind)
export function loop(key, kind, pos, level) {
  if (!audio.ready) return;
  let L = loops.get(key);
  if (!L) {
    const g = ctx.createGain(); g.gain.value = 0;
    let p = null;
    if (pos) { p = ctx.createPanner(); p.panningModel = 'HRTF'; p.distanceModel = 'inverse'; p.refDistance = 2; p.rolloffFactor = 1.2; g.connect(p); p.connect(sfxBus); } else g.connect(sfxBus);
    const srcs = [];
    if (kind === 'laser') { for (const [f, ty, v] of [[110, 'sawtooth', 0.03], [220.5, 'sine', 0.05], [331, 'triangle', 0.02]]) { const o = ctx.createOscillator(), og = ctx.createGain(); o.type = ty; o.frequency.value = f; og.gain.value = v; const lf = ctx.createBiquadFilter(); lf.type = 'lowpass'; lf.frequency.value = 1400; o.connect(lf); lf.connect(og); og.connect(g); o.start(); srcs.push(o); } }
    if (kind === 'bridge') { for (const [f, v] of [[146.8, 0.04], [220, 0.03], [293.7, 0.015]]) { const o = ctx.createOscillator(), og = ctx.createGain(); o.frequency.value = f; og.gain.value = v; o.connect(og); og.connect(g); o.start(); srcs.push(o); } }
    if (kind === 'wind' || kind === 'gel') { const s = ctx.createBufferSource(); s.buffer = noiseBuf; s.loop = true; const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = kind === 'wind' ? 700 : 300; f.Q.value = kind === 'wind' ? 0.7 : 3; s.connect(f); f.connect(g); s.start(); srcs.push(s); L = { f }; }
    L = Object.assign(L || {}, { g, p, srcs });
    loops.set(key, L);
  }
  if (pos && L.p) setPos(L.p, pos);
  L.g.gain.setTargetAtTime(level, now(), 0.06);
  if (L.f && key === 'wind') L.f.frequency.setTargetAtTime(500 + level * 3000, now(), 0.1);
}
export function stopLoops(prefix = '') { for (const [k, L] of loops) if (k.startsWith(prefix)) { L.g.gain.setTargetAtTime(0, now(), 0.05); setTimeout(() => { for (const s of L.srcs) try { s.stop(); } catch (e) { /* stopped */ } L.g.disconnect(); }, 300); loops.delete(k); } }

export function setListener(pos, quat) {
  if (!ctx) return;
  const l = ctx.listener, t = now();
  const fx = -2 * (quat.x * quat.z + quat.w * quat.y), fy = -2 * (quat.y * quat.z - quat.w * quat.x), fz = -(1 - 2 * (quat.x * quat.x + quat.y * quat.y));
  const ux = 2 * (quat.x * quat.y - quat.w * quat.z), uy = 1 - 2 * (quat.x * quat.x + quat.z * quat.z), uz = 2 * (quat.y * quat.z + quat.w * quat.x);
  if (l.positionX) {
    l.positionX.setTargetAtTime(pos.x, t, 0.02); l.positionY.setTargetAtTime(pos.y, t, 0.02); l.positionZ.setTargetAtTime(pos.z, t, 0.02);
    l.forwardX.setTargetAtTime(fx, t, 0.02); l.forwardY.setTargetAtTime(fy, t, 0.02); l.forwardZ.setTargetAtTime(fz, t, 0.02);
    l.upX.setTargetAtTime(ux, t, 0.02); l.upY.setTargetAtTime(uy, t, 0.02); l.upZ.setTargetAtTime(uz, t, 0.02);
  } else { l.setPosition(pos.x, pos.y, pos.z); l.setOrientation(fx, fy, fz, ux, uy, uz); }
}

// ---------------------------------------------------------------- room tone
function roomTone() {
  const s = ctx.createBufferSource(); s.buffer = noiseBuf; s.loop = true;
  const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 140;
  const g = ctx.createGain(); g.gain.value = 0.12; s.connect(f); f.connect(g); g.connect(ambBus); s.start();
  const hum = ctx.createOscillator(); hum.frequency.value = 60; const hg = ctx.createGain(); hg.gain.value = 0.012; hum.connect(hg); hg.connect(ambBus); hum.start();
  const hum2 = ctx.createOscillator(); hum2.frequency.value = 120.3; const hg2 = ctx.createGain(); hg2.gain.value = 0.006; hum2.connect(hg2); hg2.connect(ambBus); hum2.start();
}

// ---------------------------------------------------------------- generative music
// Slow extended chords on detuned pads, a sparse bell arpeggio through a feedback delay, and a soft bass.
// 'tense' mode (the escape) swaps to minor harmony and adds a pulsing filtered bass.
const CALM = [[62, [0, 4, 7, 11, 14]], [59, [0, 3, 7, 10, 14]], [55, [0, 4, 7, 11, 18]], [57, [0, 5, 7, 9, 14]]];
const TENSE = [[57, [0, 3, 7, 10]], [53, [0, 4, 7, 11]], [50, [0, 3, 7, 10]], [52, [0, 3, 6, 10]]];
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
let music = { next: 0, bar: 0, step: 0, delay: null, timer: null };
function startMusic() {
  const dl = ctx.createDelay(1.5), fb = ctx.createGain(), dg = ctx.createGain(), lp = ctx.createBiquadFilter();
  dl.delayTime.value = 0.59; fb.gain.value = 0.38; dg.gain.value = 0.5; lp.type = 'lowpass'; lp.frequency.value = 2500;
  dl.connect(lp); lp.connect(fb); fb.connect(dl); lp.connect(dg); dg.connect(musicBus);
  const ms = ctx.createGain(); ms.gain.value = 0.35; musicBus.connect(ms); ms.connect(verbSend);
  music.delay = dl; music.next = now() + 0.3;
  music.timer = setInterval(schedule, 90);
}
function schedule() {
  if (!ctx || ctx.state !== 'running') return;
  const tense = audio.mode === 'tense', beat = tense ? 60 / 96 / 2 : 60 / 72 / 2; // eighth notes
  while (music.next < now() + 0.35) {
    const t = music.next, prog = tense ? TENSE : CALM, barLen = 16;
    const [root, iv] = prog[music.bar % prog.length];
    if (music.step === 0) { // new chord
      pad(root, iv, t, beat * barLen, tense);
      bass(mtof(root - 12), t, beat * barLen);
    }
    if (tense && music.step % 2 === 0) pulse(mtof(root - 24), t, beat * 0.9);
    const p = tense ? 0.55 : 0.32;
    if (Math.random() < p && music.step % (tense ? 1 : 2) === 0) {
      const n = root + 12 + iv[Math.floor(Math.random() * iv.length)] + (Math.random() < 0.3 ? 12 : 0);
      bell(mtof(n), t, tense ? 0.035 : 0.045);
    }
    music.step++; if (music.step >= barLen) { music.step = 0; music.bar++; }
    music.next += beat;
  }
}
function pad(root, iv, t, dur, tense) {
  for (const k of iv.slice(0, 4)) {
    const f = mtof(root + k);
    for (const det of [-6, 6]) {
      const o = ctx.createOscillator(), fl = ctx.createBiquadFilter(), g = ctx.createGain();
      o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = det;
      fl.type = 'lowpass'; fl.frequency.setValueAtTime(tense ? 500 : 700, t); fl.frequency.linearRampToValueAtTime(tense ? 900 : 1300, t + dur * 0.5); fl.frequency.linearRampToValueAtTime(500, t + dur);
      g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.012, t + 1.8); g.gain.setValueAtTime(0.012, t + dur - 1); g.gain.linearRampToValueAtTime(0.0001, t + dur + 1.5);
      o.connect(fl); fl.connect(g); g.connect(musicBus); o.start(t); o.stop(t + dur + 1.6);
    }
  }
}
function bass(f, t, dur) { const o = ctx.createOscillator(), g = ctx.createGain(); o.frequency.value = f; g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.05, t + 0.8); g.gain.linearRampToValueAtTime(0.0001, t + dur); o.connect(g); g.connect(musicBus); o.start(t); o.stop(t + dur + 0.1); }
function pulse(f, t, dur) { const o = ctx.createOscillator(), fl = ctx.createBiquadFilter(), g = ctx.createGain(); o.type = 'sawtooth'; o.frequency.value = f; fl.type = 'lowpass'; fl.frequency.setValueAtTime(900, t); fl.frequency.exponentialRampToValueAtTime(120, t + dur); g.gain.setValueAtTime(0.05, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur); o.connect(fl); fl.connect(g); g.connect(musicBus); o.start(t); o.stop(t + dur + 0.05); }
function bell(f, t, peak) {
  const c = ctx.createOscillator(), m = ctx.createOscillator(), mg = ctx.createGain(), g = ctx.createGain();
  c.type = 'sine'; c.frequency.value = f; m.frequency.value = f * 3.5; mg.gain.setValueAtTime(f * 1.4, t); mg.gain.exponentialRampToValueAtTime(1, t + 1.2);
  m.connect(mg); mg.connect(c.frequency); c.connect(g); g.connect(musicBus); g.connect(music.delay);
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + 0.005); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.8);
  c.start(t); m.start(t); c.stop(t + 1.9); m.stop(t + 1.9);
}
