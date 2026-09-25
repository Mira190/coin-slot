// Folded Steps: generative ambient music and tuned sound effects, all synthesised with WebAudio.
// Everything is in the chapter's pentatonic key, so footsteps, cranks and reveals always harmonise with
// the bed: a slow pad that drifts between chords, plus Eno-style bell loops of unequal lengths.
const KEYS = [
  { root: 261.63, scale: [0, 2, 4, 7, 9] }, // C major pentatonic
  { root: 220.0, scale: [0, 3, 5, 7, 10] }, // A minor pentatonic
  { root: 174.61, scale: [0, 2, 4, 7, 9] }, // F major pentatonic
  { root: 196.0, scale: [0, 2, 5, 7, 9] }, // G suspended pentatonic
];
const LOOPS = [6.1, 7.9, 10.3, 13.7]; // seconds; unequal so the pattern never repeats exactly

export class Audio {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.key = KEYS[0];
    this.stepN = 0;
    this.nextChord = 0;
    this.chordI = 0;
    this.loopT = LOOPS.map((l, i) => i * 1.7);
    this.dragGrind = null;
  }
  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const C = window.AudioContext || window.webkitAudioContext;
    if (!C) return;
    const ctx = (this.ctx = new C());
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.8;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16; comp.ratio.value = 3; comp.attack.value = 0.01; comp.release.value = 0.3;
    this.master.connect(comp).connect(ctx.destination);
    // reverb: a generated stereo impulse (decaying noise, darker as it decays)
    this.verb = ctx.createConvolver();
    const len = Math.floor(ctx.sampleRate * 3.4), ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = ir.getChannelData(c);
      let lp = 0;
      for (let i = 0; i < len; i++) { const t = i / len; lp += (Math.random() * 2 - 1 - lp) * (0.9 - t * 0.75); d[i] = lp * Math.pow(1 - t, 2.4); }
    }
    this.verb.buffer = ir;
    this.verbIn = ctx.createGain(); this.verbIn.gain.value = 0.55;
    this.verbIn.connect(this.verb).connect(this.master);
    // a soft dotted echo for bells
    this.delay = ctx.createDelay(1); this.delay.delayTime.value = 0.43;
    const fb = ctx.createGain(); fb.gain.value = 0.32;
    const dl = ctx.createBiquadFilter(); dl.type = 'lowpass'; dl.frequency.value = 2400;
    this.delayIn = ctx.createGain(); this.delayIn.gain.value = 0.25;
    this.delayIn.connect(this.delay).connect(dl).connect(fb).connect(this.delay);
    dl.connect(this.master); dl.connect(this.verbIn);
    // the pad bus: lowpass with a slow breathing LFO
    this.padBus = ctx.createGain(); this.padBus.gain.value = 0.0;
    const pf = (this.padF = ctx.createBiquadFilter()); pf.type = 'lowpass'; pf.frequency.value = 900; pf.Q.value = 0.6;
    const lfo = ctx.createOscillator(), lg = ctx.createGain();
    lfo.frequency.value = 0.07; lg.gain.value = 380;
    lfo.connect(lg).connect(pf.frequency); lfo.start();
    this.padBus.connect(pf); pf.connect(this.master); pf.connect(this.verbIn);
    this.noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const nd = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    this.voices = [];
    this.musicOn = true;
  }
  setMuted(m) { this.muted = m; if (this.master) this.master.gain.setTargetAtTime(m ? 0 : 0.8, this.ctx.currentTime, 0.05); }
  setChapter(ch) { this.key = KEYS[ch % KEYS.length]; this.nextChord = 0; }
  // frequency of pentatonic degree i (0 = root; wraps into higher octaves)
  f(i) { const s = this.key.scale, n = s.length; const o = Math.floor(i / n), d = ((i % n) + n) % n; return this.key.root * Math.pow(2, o + s[d] / 12); }
  now() { return this.ctx ? this.ctx.currentTime : 0; }
  out(pan = 0, verb = 0.4, echo = 0) {
    const ctx = this.ctx, g = ctx.createGain(), p = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    if (p) { p.pan.value = Math.max(-1, Math.min(1, pan)); g.connect(p).connect(this.master); } else g.connect(this.master);
    if (verb) { const s = ctx.createGain(); s.gain.value = verb; g.connect(s).connect(this.verbIn); }
    if (echo) { const s = ctx.createGain(); s.gain.value = echo; g.connect(s).connect(this.delayIn); }
    return g;
  }
  // FM bell / mallet
  bell(freq, t, o = {}) {
    if (!this.ctx) return;
    const ctx = this.ctx, dur = o.dur ?? 2.4, vol = o.vol ?? 0.12;
    const car = ctx.createOscillator(), mod = ctx.createOscillator(), mg = ctx.createGain(), env = ctx.createGain();
    car.frequency.value = freq; mod.frequency.value = freq * (o.ratio ?? 3.5);
    mg.gain.setValueAtTime(freq * (o.index ?? 1.6), t);
    mg.gain.exponentialRampToValueAtTime(freq * 0.02 + 0.01, t + dur * 0.6);
    mod.connect(mg).connect(car.frequency);
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(vol, t + (o.att ?? 0.006));
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    car.connect(env).connect(this.out(o.pan ?? 0, o.verb ?? 0.5, o.echo ?? 0));
    car.start(t); mod.start(t); car.stop(t + dur + 0.05); mod.stop(t + dur + 0.05);
  }
  tone(freq, t, o = {}) {
    if (!this.ctx) return;
    const ctx = this.ctx, dur = o.dur ?? 0.3, vol = o.vol ?? 0.1;
    const osc = ctx.createOscillator(), env = ctx.createGain();
    osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(freq, t);
    if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, t + dur);
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(vol, t + (o.att ?? 0.005));
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(env).connect(this.out(o.pan ?? 0, o.verb ?? 0.3));
    osc.start(t); osc.stop(t + dur + 0.05);
  }
  noise(t, o = {}) {
    if (!this.ctx) return;
    const ctx = this.ctx, src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), env = ctx.createGain();
    src.buffer = this.noiseBuf; src.loop = true;
    f.type = o.type || 'bandpass'; f.frequency.setValueAtTime(o.f ?? 1800, t); f.Q.value = o.q ?? 1.2;
    if (o.to) f.frequency.exponentialRampToValueAtTime(o.to, t + (o.dur ?? 0.1));
    const dur = o.dur ?? 0.08;
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(o.vol ?? 0.08, t + (o.att ?? 0.004));
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(env).connect(this.out(o.pan ?? 0, o.verb ?? 0.2));
    src.start(t, Math.random()); src.stop(t + dur + 0.05);
  }
  // ---------- music bed ----------
  update(dt, active) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const t = this.now();
    this.padBus.gain.setTargetAtTime(active && !this.muted ? 0.16 : 0, t, 1.5);
    if (!active) return;
    if (t >= this.nextChord) { this.chord(t); this.nextChord = t + 9.5; }
    // bell loops: each fires once per period on a note that drifts through the scale
    LOOPS.forEach((L, i) => {
      this.loopT[i] -= dt;
      if (this.loopT[i] > 0) return;
      this.loopT[i] += L;
      if (Math.random() < 0.22) return; // a little silence keeps it breathing
      const deg = [5, 7, 9, 6, 8, 10][(this.chordI * 2 + i + Math.floor(Math.random() * 3)) % 6];
      this.bell(this.f(deg), t + Math.random() * 0.2, { vol: 0.045 + Math.random() * 0.03, dur: 3.6, pan: Math.random() * 1.4 - 0.7, verb: 0.9, echo: 0.6, index: 1.1, ratio: [3.5, 2.01, 4.2][i % 3] });
    });
  }
  chord(t) {
    const prog = [0, 3, 1, 4, 2];
    const d = prog[this.chordI++ % prog.length];
    for (const v of this.voices) { v.g.gain.setTargetAtTime(0.0001, t, 1.6); v.o.forEach((o) => o.stop(t + 7)); }
    this.voices = [0, 2, 4, 7].map((k, i) => {
      const fr = this.f(d + k) / 2;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(i === 0 ? 0.32 : 0.2, t + 3.2);
      const o = [0, 1].map((j) => { const x = this.ctx.createOscillator(); x.type = j ? 'triangle' : 'sine'; x.frequency.value = fr * (j ? 1.003 : 0.998); x.connect(g); x.start(t); return x; });
      g.connect(this.padBus);
      return { g, o };
    });
    this.chordRoot = d;
  }
  // ---------- effects ----------
  step(height, pan = 0, kind = 'stone') {
    if (!this.ctx) return;
    const t = this.now();
    this.stepN++;
    const deg = Math.max(0, Math.min(12, Math.round(height) + 5 + (this.stepN % 2)));
    this.bell(this.f(deg), t, { vol: 0.07, dur: 0.5, ratio: 4.01, index: 0.6, pan, verb: 0.35 });
    this.noise(t, { f: kind === 'wall' ? 3200 : 1500, q: 2, vol: 0.02, dur: 0.05, pan });
  }
  tick(i, pan = 0) { if (!this.ctx) return; const t = this.now(); this.noise(t, { f: 2600 + (i % 5) * 300, q: 6, vol: 0.05, dur: 0.04, pan }); this.tone(this.f(8 + (i % 5)), t, { vol: 0.02, dur: 0.12, pan }); }
  snap(pan = 0) {
    if (!this.ctx) return;
    const t = this.now(), d = this.chordRoot ?? 0;
    this.tone(70, t, { vol: 0.22, dur: 0.35, to: 50, verb: 0.2, pan });
    this.noise(t, { f: 400, q: 0.8, vol: 0.06, dur: 0.12, type: 'lowpass', pan });
    [0, 2, 4, 7].forEach((k, i) => this.bell(this.f(d + k + 5), t + 0.04 + i * 0.045, { vol: 0.08, dur: 2.4, pan: pan + (i - 1.5) * 0.15, echo: 0.3 }));
  }
  grind(on, speed = 0) {
    if (!this.ctx) return;
    const t = this.now();
    if (on && !this.dragGrind) {
      const src = this.ctx.createBufferSource(), f = this.ctx.createBiquadFilter(), g = this.ctx.createGain();
      src.buffer = this.noiseBuf; src.loop = true; f.type = 'bandpass'; f.frequency.value = 300; f.Q.value = 1.5; g.gain.value = 0;
      src.connect(f).connect(g).connect(this.out(0, 0.2)); src.start();
      this.dragGrind = { src, g, f };
    }
    if (this.dragGrind) {
      this.dragGrind.g.gain.setTargetAtTime(on ? Math.min(0.12, speed * 0.04) : 0, t, 0.05);
      this.dragGrind.f.frequency.setTargetAtTime(220 + speed * 90, t, 0.05);
      if (!on) { const d = this.dragGrind; this.dragGrind = null; d.src.stop(t + 0.3); }
    }
  }
  plate(on, pan = 0) {
    if (!this.ctx) return;
    const t = this.now();
    this.tone(on ? 110 : 82, t, { vol: 0.14, dur: 0.4, pan });
    this.bell(this.f(on ? 3 : 1), t + 0.02, { vol: 0.08, dur: 1.8, ratio: 1.41, index: 2.2, pan });
  }
  reveal() {
    if (!this.ctx) return;
    const t = this.now(), d = this.chordRoot ?? 0;
    this.noise(t, { f: 200, to: 2600, q: 0.7, vol: 0.07, dur: 1.8, att: 1.2, verb: 0.8 });
    this.tone(55, t, { vol: 0.2, dur: 2.6, att: 0.8, verb: 0.5 });
    [0, 2, 4, 5, 7, 9].forEach((k, i) => this.bell(this.f(d + k + 3), t + 0.35 + i * 0.13, { vol: 0.08, dur: 3, echo: 0.4, pan: (i / 5) * 1.2 - 0.6 }));
  }
  glimmer(pan = 0) { if (!this.ctx) return; const t = this.now(); [10, 12, 14, 17].forEach((k, i) => this.bell(this.f(k), t + i * 0.06, { vol: 0.06, dur: 1.6, ratio: 5.01, index: 0.8, pan, echo: 0.5 })); }
  win() {
    if (!this.ctx) return;
    const t = this.now();
    [0, 2, 4, 7, 9].forEach((k) => this.bell(this.f(k + 2), t, { vol: 0.07, dur: 4.5, verb: 0.9 }));
    [5, 7, 9, 10, 12, 14, 15].forEach((k, i) => this.bell(this.f(k), t + 0.25 + i * 0.09, { vol: 0.06, dur: 2.6, echo: 0.5, pan: (i / 6) * 1.4 - 0.7 }));
    this.noise(t, { f: 6000, q: 0.5, vol: 0.03, dur: 2.2, att: 0.4, verb: 1 });
  }
  cry(pan = 0) {
    if (!this.ctx) return;
    const t = this.now();
    this.noise(t, { f: 2200, q: 1, vol: 0.06, dur: 0.22, pan });
    this.tone(this.f(9), t, { vol: 0.05, dur: 0.18, to: this.f(6), type: 'triangle', pan });
    this.tone(this.f(9), t + 0.2, { vol: 0.04, dur: 0.16, to: this.f(7), type: 'triangle', pan });
  }
  stone(follow, pan = 0) {
    if (!this.ctx) return;
    const t = this.now();
    this.tone(follow ? 196 : 147, t, { vol: 0.12, dur: 0.18, pan });
    this.noise(t, { f: 700, q: 3, vol: 0.05, dur: 0.06, pan });
    this.bell(this.f(follow ? 7 : 2), t + 0.05, { vol: 0.07, dur: 1.4, ratio: 1.5, index: 1.2, pan });
  }
  ui() { if (!this.ctx) return; this.tone(this.f(9), this.now(), { vol: 0.03, dur: 0.08, verb: 0.1 }); }
  gong() { if (!this.ctx) return; const t = this.now(); this.bell(this.f(0) / 2, t, { vol: 0.12, dur: 5, ratio: 1.41, index: 3, verb: 0.9 }); }
  no(pan = 0) { if (!this.ctx) return; this.tone(this.f(1), this.now(), { vol: 0.05, dur: 0.15, to: this.f(0), type: 'triangle', pan }); }
}
