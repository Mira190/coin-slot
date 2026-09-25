// All sound is synthesised with WebAudio. The music is stepped by the crank: four 16th-notes per
// pedal revolution, so the tempo follows cadence (a slow clock takes over when freewheeling).
// Ambience: ocean swell + crashing waves, wind, tyre rumble, chain whir, freewheel ticking,
// boardwalk plank clatter. SFX: bell, gulp, catch chimes, gulls, splashes, bonks, shutter.
import { clamp, lerp, store, rng } from './core.js';

const NOTE = (n) => 440 * Math.pow(2, (n - 69) / 12);
// chords as MIDI roots + quality; D major family
const CH = { D: [50, [0, 4, 7]], A: [45, [0, 4, 7]], Bm: [47, [0, 3, 7]], G: [43, [0, 4, 7]], Em: [52, [0, 3, 7]], Fsm: [42, [0, 3, 7]] };
const PROG_DAY = ['D', 'A', 'Bm', 'G', 'D', 'A', 'G', 'A'];
const PROG_NIGHT = ['Bm', 'G', 'D', 'A', 'Bm', 'Em', 'G', 'A'];
// a gentle whistled melody (scale degrees in D major), one note per 2 steps, -1 = rest
const MEL = [9, -1, 11, 12, 14, -1, 12, 11, 9, -1, 7, -1, 9, 11, -1, -1, 7, -1, 9, 11, 12, -1, 11, 9, 7, -1, 4, -1, 2, -1, -1, -1];
const DMAJ = [0, 2, 4, 5, 7, 9, 11];
const degree = (d) => 62 + Math.floor(d / 7) * 12 + DMAJ[((d % 7) + 7) % 7];

export class Audio {
  constructor() {
    this.ctx = null; this.muted = store.get('muted') === '1'; this.ready = false;
    this.step = -1; this.bar = 0; this.clock = 0; this.crankStep = null; this.night = 0; this.golden = 0;
  }
  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {}); return; }
    try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return; }
    this.build();
  }
  setMuted(m) { this.muted = m; store.set('muted', m ? '1' : '0'); if (this.master) this.master.gain.setTargetAtTime(m ? 0 : 0.9, this.ctx.currentTime, 0.05); }
  pause(p) { if (!this.ctx) return; if (p) this.ctx.suspend().catch(() => {}); else this.ctx.resume().catch(() => {}); }

  build() {
    const c = this.ctx, sr = c.sampleRate;
    this.master = c.createGain(); this.master.gain.value = this.muted ? 0 : 0.9;
    const comp = c.createDynamicsCompressor(); comp.threshold.value = -16; comp.ratio.value = 3.5; comp.attack.value = 0.01; comp.release.value = 0.25;
    this.master.connect(comp).connect(c.destination);
    this.music = c.createGain(); this.music.gain.value = 0.55; this.music.connect(this.master);
    this.sfx = c.createGain(); this.sfx.gain.value = 0.9; this.sfx.connect(this.master);
    this.amb = c.createGain(); this.amb.gain.value = 0.7; this.amb.connect(this.master);
    // a little room for the music
    const verb = c.createConvolver(), ir = c.createBuffer(2, sr * 1.8, sr);
    for (let ch = 0; ch < 2; ch++) { const d = ir.getChannelData(ch); for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 3.2); }
    verb.buffer = ir; this.verb = c.createGain(); this.verb.gain.value = 0.22; this.verb.connect(verb).connect(this.master);
    // noise
    const nb = c.createBuffer(1, sr * 2, sr), nd = nb.getChannelData(0); for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    this.noiseBuf = nb;
    const loop = (filterType, f, q, g0) => { const s = c.createBufferSource(); s.buffer = nb; s.loop = true; s.playbackRate.value = 0.8 + Math.random() * 0.4; const fl = c.createBiquadFilter(); fl.type = filterType; fl.frequency.value = f; fl.Q.value = q; const g = c.createGain(); g.gain.value = g0; s.connect(fl).connect(g); s.start(); return { s, fl, g }; };
    this.ocean = loop('lowpass', 500, 0.5, 0); this.ocean.g.connect(this.amb);
    this.ocean2 = loop('bandpass', 1400, 0.4, 0); this.ocean2.g.connect(this.amb);
    this.wind = loop('bandpass', 700, 0.6, 0); this.wind.g.connect(this.amb);
    this.rumble = loop('lowpass', 160, 0.7, 0); this.rumble.g.connect(this.amb);
    this.whir = loop('bandpass', 3200, 5, 0); this.whir.g.connect(this.amb);
    // freewheel pawl clicks and boardwalk plank clacks as looped one-click buffers (rate = playbackRate / length)
    const clickBuf = (len, f, decay, noise) => { const b = c.createBuffer(1, Math.round(sr * len), sr), d = b.getChannelData(0); for (let i = 0; i < Math.min(d.length, sr * 0.012); i++) { const t = i / sr; d[i] = (Math.sin(t * f * 6.283) * (1 - noise) + (Math.random() * 2 - 1) * noise) * Math.exp(-t * decay); } return b; };
    const mk = (buf, g0) => { const s = c.createBufferSource(); s.buffer = buf; s.loop = true; const g = c.createGain(); g.gain.value = g0; s.connect(g).connect(this.amb); s.start(); return { s, g }; };
    this.tick = mk(clickBuf(0.05, 3800, 900, 0.5), 0);
    const pb = clickBuf(0.1, 180, 180, 0.35); this.plank = mk(pb, 0);
    // pre-rendered Karplus-Strong plucks and marimba notes
    this.pluck = new Map(); this.marimba = new Map();
    this.nextCrash = 3; this.swellT = 0;
    this.ready = true;
  }
  ksBuffer(midi, dur = 1.6, bright = 0.5) {
    const key = midi + ':' + bright; if (this.pluck.has(key)) return this.pluck.get(key);
    const c = this.ctx, sr = c.sampleRate, n = Math.round(sr * dur), b = c.createBuffer(1, n, sr), d = b.getChannelData(0);
    const f = NOTE(midi), N = Math.max(2, Math.round(sr / f)), line = new Float32Array(N);
    let lp = 0; for (let i = 0; i < N; i++) { lp = lp * (1 - bright) + (Math.random() * 2 - 1) * bright; line[i] = lp; }
    let idx = 0, prev = 0; const decay = 0.996 - Math.max(0, (midi - 60)) * 0.0004;
    for (let i = 0; i < n; i++) { const cur = line[idx]; const out = 0.5 * (cur + prev) * decay; prev = cur; line[idx] = out; idx = (idx + 1) % N; d[i] = cur * (1 - i / n) ** 0.5; }
    this.pluck.set(key, b); return b;
  }
  marimbaBuffer(midi) {
    if (this.marimba.has(midi)) return this.marimba.get(midi);
    const c = this.ctx, sr = c.sampleRate, n = Math.round(sr * 1.2), b = c.createBuffer(1, n, sr), d = b.getChannelData(0), f = NOTE(midi);
    for (let i = 0; i < n; i++) { const t = i / sr; d[i] = (Math.sin(t * f * 6.283) * Math.exp(-t * 4) + 0.35 * Math.sin(t * f * 4 * 6.283) * Math.exp(-t * 14) + 0.1 * Math.sin(t * f * 10 * 6.283) * Math.exp(-t * 40)) * Math.min(1, t * 400); }
    this.marimba.set(midi, b); return b;
  }
  play(buf, t, gain, dest = this.music, rate = 1, pan = 0, verb = 0.5) {
    const c = this.ctx, s = c.createBufferSource(); s.buffer = buf; s.playbackRate.value = rate;
    const g = c.createGain(); g.gain.value = gain;
    const p = c.createStereoPanner(); p.pan.value = clamp(pan, -1, 1);
    s.connect(g).connect(p).connect(dest); if (verb) { const v = c.createGain(); v.gain.value = verb; p.connect(v).connect(this.verb); }
    s.start(t); s.onended = () => { s.disconnect(); g.disconnect(); p.disconnect(); };
  }
  tone(f0, f1, dur, type = 'sine', gain = 0.3, dest = this.sfx, t0 = 0, pan = 0) {
    if (!(gain > 1e-3)) return; // inaudible (e.g. far away); also, exponential ramps can't target 0
    const c = this.ctx, t = c.currentTime + t0, o = c.createOscillator(), g = c.createGain(), p = c.createStereoPanner(); p.pan.value = pan;
    o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(p).connect(dest); o.start(t); o.stop(t + dur + 0.05); o.onended = () => { o.disconnect(); g.disconnect(); p.disconnect(); };
  }
  noise(dur, type, f0, f1, gain, t0 = 0, pan = 0, q = 1, dest = this.sfx) {
    if (!(gain > 1e-3)) return;
    const c = this.ctx, t = c.currentTime + t0, s = c.createBufferSource(); s.buffer = this.noiseBuf; s.playbackRate.value = 1;
    const fl = c.createBiquadFilter(); fl.type = type; fl.Q.value = q; fl.frequency.setValueAtTime(f0, t); fl.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t + dur);
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + Math.min(0.03, dur * 0.2)); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const p = c.createStereoPanner(); p.pan.value = pan;
    s.connect(fl).connect(g).connect(p).connect(dest); s.start(t, Math.random()); s.stop(t + dur + 0.05); s.onended = () => { s.disconnect(); fl.disconnect(); g.disconnect(); p.disconnect(); };
  }

  // ---------------------------------------------------------------- music
  musicStep(pedaling) {
    const c = this.ctx, t = c.currentTime + 0.012;
    this.step = (this.step + 1) % 16; if (this.step === 0) this.bar++;
    const st = this.step, night = this.night > 0.5, prog = night ? PROG_NIGHT : PROG_DAY;
    const [root, q] = CH[prog[this.bar % prog.length]];
    const vol = night ? 0.6 : 1;
    // bass
    if (st === 0 || st === 8 || (st === 14 && pedaling)) this.play(this.ksBuffer(root - 12 + (st === 8 ? q[2] : st === 14 ? 12 : 0), 1.4, 0.25), t, 0.55 * vol, this.music, 1, 0, 0.1);
    // ukulele arpeggio (half density when coasting)
    if (st % 2 === 0 && (pedaling || st % 4 === 0)) { const tones = [0, q[1], q[2], 12, q[2], q[1], 12, q[1] + 12]; const n = root + 12 + tones[(st / 2) % 8]; this.play(this.ksBuffer(n, 1.5, night ? 0.35 : 0.6), t, 0.26 * vol, this.music, 1, ((st / 2) % 2 ? 0.3 : -0.3), 0.6); }
    // soft kick and shaker when pedaling
    if (pedaling && !night) {
      if (st === 0 || st === 8) this.tone(120, 45, 0.18, 'sine', 0.35, this.music);
      if (st % 2 === 1) this.noise(0.05, 'highpass', 7000, 9000, st % 4 === 3 ? 0.08 : 0.045, 0, 0.2, 1, this.music);
    }
    // whistled melody on alternate phrases, golden hour sings more
    const phrase = Math.floor(this.bar / 2) % 4;
    if (st % 2 === 0 && (phrase === 1 || phrase === 3 || (this.golden > 0.5 && phrase === 2))) {
      const d = MEL[((this.bar % 2) * 8 + st / 2) % MEL.length];
      if (d >= 0) this.play(this.marimbaBuffer(degree(d) + (night ? -12 : 0)), t, 0.2 * vol, this.music, 1, 0.15, 0.8);
    }
  }

  // ---------------------------------------------------------------- per frame
  // st: { speed, pedaling, crank, coastRev, zone, seaNear, night, golden, camLow }
  update(dt, st) {
    if (!this.ready) return;
    const c = this.ctx, now = c.currentTime, v = st.speed;
    this.night = st.night; this.golden = st.golden;
    // music clock: crank-driven while pedaling, a relaxed clock otherwise
    if (st.pedaling) {
      const cs = Math.floor(st.crank / (Math.PI / 2));
      if (this.crankStep === null) this.crankStep = cs;
      if (cs !== this.crankStep) { const n = Math.min(3, cs - this.crankStep); for (let i = 0; i < n; i++) this.musicStep(true); this.crankStep = cs; }
      this.clock = 0;
    } else {
      this.crankStep = null; this.clock += dt * 3.2;
      while (this.clock >= 1) { this.clock -= 1; this.musicStep(false); }
    }
    const k = (x, tc = 0.15) => x;
    const sea = st.seaNear;
    this.swellT += dt; const swell = 0.6 + 0.4 * Math.sin(this.swellT * 0.9) * Math.sin(this.swellT * 0.37);
    this.ocean.g.gain.setTargetAtTime((0.12 + 0.3 * sea) * swell, now, 0.3);
    this.ocean2.g.gain.setTargetAtTime((0.02 + 0.07 * sea) * swell, now, 0.3);
    this.nextCrash -= dt;
    if (this.nextCrash <= 0) { this.nextCrash = 4 + Math.random() * 5; if (sea > 0.2) this.noise(2.6, 'lowpass', 1800, 250, 0.22 * sea, 0, (Math.random() - 0.5) * 0.8, 0.7, this.amb); }
    this.wind.g.gain.setTargetAtTime(clamp(0.015 + v * v * 0.0022, 0, 0.35), now, 0.2);
    this.wind.fl.frequency.setTargetAtTime(500 + v * 60, now, 0.3);
    const board = st.zone === 'boardwalk', cobbles = st.zone === 'town';
    this.rumble.g.gain.setTargetAtTime(clamp(v * 0.018, 0, 0.22) * (cobbles ? 1.6 : 1), now, 0.1);
    this.whir.g.gain.setTargetAtTime(st.pedaling ? clamp(v * 0.004, 0, 0.04) : 0, now, 0.1);
    const coasting = !st.pedaling && v > 0.6;
    this.tick.g.gain.setTargetAtTime(coasting ? 0.09 : 0, now, 0.05);
    this.tick.s.playbackRate.setTargetAtTime(clamp(st.coastRev * 14, 3, 60) * 0.05, now, 0.05);
    this.plank.g.gain.setTargetAtTime(board && v > 0.5 ? 0.35 : cobbles && v > 0.5 ? 0.12 : 0, now, 0.05);
    this.plank.s.playbackRate.setTargetAtTime(clamp(v / (board ? 0.19 : 0.33), 1, 80) * 0.1, now, 0.05);
  }

  // ---------------------------------------------------------------- sfx
  bell() { if (!this.ready) return; const f = 2350; [0, 0.13].forEach((d) => [[1, 1, 1.4], [2.76, 0.5, 0.9], [5.4, 0.25, 0.5], [8.93, 0.12, 0.25]].forEach(([r, a, dec]) => this.tone(f * r, f * r * 0.998, dec, 'sine', 0.18 * a, this.sfx, d, -0.2))); }
  gulp() { if (!this.ready) return; this.tone(240, 70, 0.28, 'sine', 0.5); this.noise(0.25, 'lowpass', 600, 150, 0.25, 0.02); this.tone(180, 60, 0.2, 'sine', 0.35, this.sfx, 0.3); this.tone(900, 1400, 0.06, 'sine', 0.08, this.sfx, 0.5); }
  // one fish into the pouch: a marimba blip that climbs the pentatonic scale along the line, plus a wet plip
  pickup(n, golden) {
    if (!this.ready) return;
    const t = this.ctx.currentTime, k = Math.min(n - 1, 10), m = 72 + [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24][k];
    this.play(this.marimbaBuffer(m), t, 0.26, this.sfx, 1, 0, 0.35);
    this.tone(700 + k * 60, 1500 + k * 90, 0.05, 'sine', 0.07);
    if (golden) for (let i = 0; i < 4; i++) this.play(this.ksBuffer(88 + [0, 4, 7, 12][i], 1, 0.8), t + 0.05 + i * 0.05, 0.14, this.sfx, 1, (i % 2 ? 0.4 : -0.4), 0.9);
  }
  // a clean sweep of a whole line
  catchChime(golden, combo) {
    if (!this.ready) return;
    const base = 74 + Math.min(combo, 6) * 2, t = this.ctx.currentTime;
    this.play(this.marimbaBuffer(base), t, 0.3, this.sfx); this.play(this.marimbaBuffer(base + 4), t + 0.08, 0.3, this.sfx); this.play(this.marimbaBuffer(base + 7), t + 0.16, 0.28, this.sfx);
    this.noise(0.18, 'bandpass', 1400, 700, 0.18, 0, 0, 1.5); // wet slap
    if (golden) for (let i = 0; i < 6; i++) this.play(this.ksBuffer(86 + [0, 4, 7, 12, 16, 19][i], 1, 0.8), t + 0.2 + i * 0.06, 0.16, this.sfx, 1, (i % 2 ? 0.4 : -0.4), 0.9);
  }
  splash(pan = 0, g = 0.2) { if (!this.ready) return; this.noise(0.45, 'bandpass', 2200, 500, g, 0, pan, 0.9); }
  gull(pan, dist) {
    if (!this.ready) return;
    const g = clamp(0.22 * (1 - dist / 70), 0, 0.22); if (g < 0.01) return;
    const n = 2 + Math.floor(Math.random() * 3), f = 1300 + Math.random() * 500;
    for (let i = 0; i < n; i++) { const d = i * (0.16 + Math.random() * 0.05); this.tone(f * 1.25, f * 0.72, 0.16, 'sawtooth', g * 0.35, this.sfx, d, pan); this.tone(f * 2.5, f * 1.5, 0.12, 'sine', g * 0.25, this.sfx, d, pan); }
  }
  hop() { if (!this.ready) return; this.tone(300, 520, 0.12, 'triangle', 0.12); this.noise(0.2, 'highpass', 2500, 6000, 0.05); }
  land() { if (!this.ready) return; this.tone(110, 45, 0.18, 'sine', 0.35); this.noise(0.12, 'lowpass', 900, 200, 0.12); }
  bonk() { if (!this.ready) return; this.tone(520, 180, 0.12, 'square', 0.1); this.tone(160, 120, 0.2, 'sine', 0.3); }
  grunt() { if (!this.ready) return; this.tone(130, 85, 0.35, 'sawtooth', 0.12); this.noise(0.3, 'bandpass', 500, 300, 0.12, 0, 0, 3); }
  whoosh() { if (!this.ready) return; this.noise(0.6, 'bandpass', 400, 1600, 0.12, 0, 0, 0.8); }
  fanfare() { if (!this.ready) return; const t = this.ctx.currentTime; [74, 78, 81, 86].forEach((m, i) => this.play(this.marimbaBuffer(m), t + i * 0.09, 0.3, this.sfx, 1, 0, 0.8)); }
  shutter() { if (!this.ready) return; this.noise(0.05, 'highpass', 3000, 5000, 0.4); this.noise(0.06, 'bandpass', 1500, 900, 0.3, 0.07); }
  ui() { if (!this.ready) return; this.tone(880, 1320, 0.06, 'sine', 0.08); }
}
