// All sound is synthesized with WebAudio: a geared engine (player) plus a panned rival engine, tyre screech,
// wind, nitro roar, one-shot SFX for every technique/item/event, and a step-sequenced music bed per theme.

const NOTE = (n) => 440 * Math.pow(2, (n - 69) / 12);

const SONGS = {
  menu: { bpm: 104, root: 57, scale: [0, 2, 3, 5, 7, 8, 10], prog: [0, 5, 3, 6], lead: [0, -1, 4, -1, 2, -1, 4, 5, 4, -1, 2, -1, 0, -1, -1, -1], drums: 'soft', bassOct: -24, pad: 'saw', leadWave: 'triangle' },
  city: { bpm: 132, root: 57, scale: [0, 2, 3, 5, 7, 8, 10], prog: [0, 5, 2, 6], lead: [7, -1, 4, 7, 9, -1, 7, 4, 2, -1, 4, -1, 7, 6, 4, 2], drums: 'four', bassOct: -24, pad: 'saw', leadWave: 'square' },
  coast: { bpm: 124, root: 62, scale: [0, 2, 4, 5, 7, 9, 11], prog: [0, 4, 5, 3], lead: [4, -1, 2, 4, 7, -1, 4, -1, 5, 4, 2, -1, 0, -1, 2, -1], drums: 'shuffle', bassOct: -24, pad: 'tri', leadWave: 'triangle' },
  snow: { bpm: 128, root: 52, scale: [0, 2, 3, 5, 7, 8, 10], prog: [0, 5, 2, 6], lead: [7, 9, 11, -1, 9, 7, -1, 4, 7, -1, 9, 7, 4, -1, 2, -1], drums: 'four', bassOct: -12, pad: 'saw', leadWave: 'bell' },
  desert: { bpm: 120, root: 50, scale: [0, 1, 4, 5, 7, 8, 10], prog: [0, 1, 0, 6], lead: [0, 1, 2, 1, 0, -1, 4, 3, 2, -1, 1, 0, 1, -1, -1, -1], drums: 'tribal', bassOct: -12, pad: 'saw', leadWave: 'pluck' }
};

export class Audio {
  constructor(muted) {
    this.ctx = null; this.muted = !!muted; this.song = null; this.step = 0; this.nextT = 0; this.intense = 0;
  }
  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const c = this.ctx = new AC();
    this.master = c.createGain(); this.master.gain.value = this.muted ? 0 : 0.9;
    const comp = c.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 4; comp.attack.value = 0.004; comp.release.value = 0.2;
    this.master.connect(comp); comp.connect(c.destination);
    this.music = c.createGain(); this.music.gain.value = 0.32; this.music.connect(this.master);
    this.sfx = c.createGain(); this.sfx.gain.value = 0.85; this.sfx.connect(this.master);
    this.eng = c.createGain(); this.eng.gain.value = 0.5; this.eng.connect(this.master);
    // noise buffer
    const len = c.sampleRate * 2, buf = c.createBuffer(1, len, c.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noiseBuf = buf;
    // player engine
    this.e1 = c.createOscillator(); this.e1.type = 'sawtooth';
    this.e2 = c.createOscillator(); this.e2.type = 'square';
    this.e3 = c.createOscillator(); this.e3.type = 'sine';
    this.eF = c.createBiquadFilter(); this.eF.type = 'lowpass'; this.eF.Q.value = 3;
    this.eG = c.createGain(); this.eG.gain.value = 0;
    const g2 = c.createGain(); g2.gain.value = 0.5; const g3 = c.createGain(); g3.gain.value = 0.9;
    this.e1.connect(this.eF); this.e2.connect(g2); g2.connect(this.eF); this.e3.connect(g3); g3.connect(this.eG);
    this.eF.connect(this.eG); this.eG.connect(this.eng);
    [this.e1, this.e2, this.e3].forEach((o) => { o.frequency.value = 60; o.start(); });
    // rival engine (nearest AI), panned
    this.r1 = c.createOscillator(); this.r1.type = 'sawtooth'; this.r1.frequency.value = 80;
    this.rF = c.createBiquadFilter(); this.rF.type = 'lowpass'; this.rF.frequency.value = 700;
    this.rG = c.createGain(); this.rG.gain.value = 0;
    this.rP = c.createStereoPanner ? c.createStereoPanner() : c.createGain();
    this.r1.connect(this.rF); this.rF.connect(this.rG); this.rG.connect(this.rP); this.rP.connect(this.eng); this.r1.start();
    // loops: screech, wind, nitro roar
    const loop = (type, f, q) => { const s = c.createBufferSource(); s.buffer = buf; s.loop = true; const fl = c.createBiquadFilter(); fl.type = type; fl.frequency.value = f; fl.Q.value = q; const g = c.createGain(); g.gain.value = 0; s.connect(fl); fl.connect(g); g.connect(this.sfx); s.start(); return { s, fl, g }; };
    this.scr = loop('bandpass', 1800, 6);
    this.wind = loop('lowpass', 500, 0.7);
    this.roar = loop('bandpass', 400, 1.2);
    this.seqTimer = setInterval(() => this.tick(), 25);
  }
  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.setTargetAtTime(m ? 0 : 0.9, this.ctx.currentTime, 0.03);
  }
  suspend(on) { if (!this.ctx) return; if (on) this.ctx.suspend(); else this.ctx.resume(); }
  // ---- continuous: called each frame
  drive(k, top, rival, dt) {
    if (!this.ctx || !k) return;
    const t = this.ctx.currentTime, a = Math.abs(k.spd);
    const gears = 6, gw = top * 1.08 / gears, gear = Math.min(gears - 1, Math.floor(a / gw));
    const rpm = Math.min(1.2, 0.28 + ((a - gear * gw) / gw) * 0.72);
    const boost = k.b.nitro > 0 || k.b.turbo > 0 ? 1 : k.b.micro > 0 || k.b.start > 0 ? 0.5 : 0;
    const base = 52 + gear * 9 + rpm * 120 + boost * 25 + (k.rev ? 20 : 0);
    const up = k.revIdle ? 0.3 : 1;
    this.e1.frequency.setTargetAtTime(base, t, 0.04);
    this.e2.frequency.setTargetAtTime(base * 0.5 + 1.5, t, 0.04);
    this.e3.frequency.setTargetAtTime(base * 0.25, t, 0.04);
    this.eF.frequency.setTargetAtTime(380 + rpm * 1500 + boost * 1200, t, 0.05);
    this.eG.gain.setTargetAtTime((0.1 + Math.min(1, a / top) * 0.12 + boost * 0.05) * up, t, 0.05);
    const slip = k.drift.on ? 1 : 0;
    this.scr.g.gain.setTargetAtTime(k.grounded && a > 10 ? slip * 0.16 + Math.max(0, Math.abs(k.slipA || 0) - 0.2) * 0.2 : 0, t, 0.04);
    this.scr.fl.frequency.setTargetAtTime(1500 + (k.drift.tier || 0) * 250 + Math.sin(t * 30) * 120, t, 0.03);
    this.wind.g.gain.setTargetAtTime(Math.min(1, a / top) ** 2 * 0.14 + boost * 0.05, t, 0.1);
    this.wind.fl.frequency.setTargetAtTime(300 + a * 18, t, 0.1);
    this.roar.g.gain.setTargetAtTime(boost >= 1 ? 0.28 : boost * 0.12, t, 0.05);
    this.roar.fl.frequency.setTargetAtTime(300 + boost * 500 + Math.sin(t * 13) * 60, t, 0.05);
    if (rival) {
      this.r1.frequency.setTargetAtTime(60 + Math.abs(rival.k.spd) * 4.2, t, 0.06);
      this.rG.gain.setTargetAtTime(Math.max(0, 0.13 - rival.d * 0.004), t, 0.08);
      if (this.rP.pan) this.rP.pan.setTargetAtTime(Math.max(-1, Math.min(1, rival.pan)), t, 0.08);
    } else this.rG.gain.setTargetAtTime(0, t, 0.1);
  }
  quiet() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    for (const g of [this.eG, this.scr.g, this.wind.g, this.roar.g, this.rG]) g.gain.setTargetAtTime(0, t, 0.08);
  }
  // ---- one-shot helpers
  tone(f, dur, type = 'square', vol = 0.1, f2, delay = 0, dest) {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime + delay, o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(f, t); if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(dest || this.sfx); o.start(t); o.stop(t + dur + 0.05);
  }
  noise(dur, type, f0, f1, vol, delay = 0, q = 1, dest) {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime + delay, s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
    s.buffer = this.noiseBuf; f.type = type; f.frequency.setValueAtTime(f0, t); if (f1) f.frequency.exponentialRampToValueAtTime(f1, t + dur); f.Q.value = q;
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(dest || this.sfx); s.start(t, Math.random()); s.stop(t + dur + 0.05);
  }
  play(name, o = {}) {
    if (!this.ctx) return;
    switch (name) {
      case 'count': this.tone(o.go ? 1046 : 523, o.go ? 0.6 : 0.22, 'square', 0.12); if (o.go) this.tone(1568, 0.5, 'triangle', 0.08); break;
      case 'light': this.tone(1760, 0.08, 'sine', 0.05); this.tone(2637, 0.1, 'sine', 0.035, null, 0.03); break;
      case 'micro': {
        const p = o.perfect ? 1.25 : 1;
        this.noise(0.45, 'bandpass', 600, 3000, 0.35, 0, 1.2); this.tone(220 * p, 0.35, 'sawtooth', 0.06, 660 * p);
        this.tone(o.dbl ? 1318 : 988, 0.14, 'triangle', 0.08, null, 0.02); if (o.dbl) this.tone(1760, 0.16, 'triangle', 0.08, null, 0.1);
        if (o.perfect) this.tone(2093, 0.2, 'sine', 0.06, null, 0.06);
        break;
      }
      case 'nitro': this.noise(1.1, 'bandpass', 250, 2200, 0.5, 0, 0.8); this.tone(90, 0.7, 'sawtooth', 0.12, 240); this.tone(180, 0.5, 'square', 0.05, 520, 0.05); break;
      case 'pad': this.noise(0.4, 'highpass', 1200, 5000, 0.18); this.tone(660, 0.25, 'triangle', 0.07, 1320); break;
      case 'bottle': [784, 988, 1175, 1568].forEach((f, i) => this.tone(f, 0.16, 'triangle', 0.08, null, i * 0.05)); break;
      case 'tech': this.tone(o.f || 880, 0.12, 'triangle', 0.07); this.tone((o.f || 880) * 1.5, 0.12, 'triangle', 0.05, null, 0.05); break;
      case 'combo': [659, 880, 1109, 1319, 1760].forEach((f, i) => this.tone(f, 0.12, 'square', 0.05, null, i * 0.04)); break;
      case 'start': this.noise(1.2, 'bandpass', 200, 3000, 0.5); this.tone(110, 1, 'sawtooth', 0.12, 440); break;
      case 'air': this.noise(0.5, 'bandpass', 900, 2500, 0.25); this.tone(523, 0.18, 'triangle', 0.07, 1046); break;
      case 'land': this.noise(0.18, 'lowpass', 400, 120, 0.4); this.tone(70, 0.18, 'sine', 0.25, 40); break;
      case 'wall': this.noise(0.22 + (o.impact || 0.5) * 0.2, 'lowpass', 900, 150, 0.35 + (o.impact || 0.5) * 0.35); this.noise(0.3, 'bandpass', 3000, 1500, 0.12 * (o.impact || 0.5), 0.01, 4); break;
      case 'bump': this.noise(0.15, 'lowpass', 700, 200, 0.4); this.tone(110, 0.12, 'square', 0.08, 70); break;
      case 'lap': [880, 1175].forEach((f, i) => this.tone(f, 0.2, 'triangle', 0.09, null, i * 0.1)); break;
      case 'final': [659, 784, 988, 1319].forEach((f, i) => this.tone(f, 0.22, 'square', 0.07, null, i * 0.09)); break;
      case 'finish': [523, 659, 784, 1046, 784, 1046, 1319].forEach((f, i) => this.tone(f, 0.3, 'square', 0.08, null, i * 0.11)); break;
      case 'box': [1046, 1318, 1568, 2093].forEach((f, i) => this.tone(f, 0.08, 'square', 0.04, null, i * 0.035)); break;
      case 'roll': this.tone(1400 + Math.random() * 600, 0.03, 'square', 0.025); break;
      case 'ready': this.tone(1568, 0.1, 'triangle', 0.07); this.tone(2093, 0.14, 'triangle', 0.06, null, 0.06); break;
      case 'missile': this.noise(0.9, 'bandpass', 500, 2500, 0.35); this.tone(300, 0.8, 'sawtooth', 0.05, 900); break;
      case 'boom': this.noise(0.8, 'lowpass', 1400, 60, 0.9); this.tone(60, 0.6, 'sine', 0.35, 30); break;
      case 'banana': this.tone(300, 0.1, 'square', 0.06, 200); break;
      case 'slip': this.tone(900, 0.5, 'triangle', 0.08, 180); this.noise(0.4, 'bandpass', 2000, 600, 0.2, 0, 3); break;
      case 'fog': this.noise(0.9, 'lowpass', 300, 1200, 0.3); break;
      case 'magnet': for (let i = 0; i < 6; i++) this.tone(300 + (i % 2) * 120, 0.12, 'sine', 0.06, null, i * 0.08); break;
      case 'shield': [523, 659, 784, 1046].forEach((f) => this.tone(f, 0.8, 'sine', 0.05)); break;
      case 'blocked': this.tone(1760, 0.3, 'sine', 0.1, 880); this.noise(0.2, 'highpass', 3000, 6000, 0.15); break;
      case 'bubble': this.tone(400, 0.35, 'sine', 0.12, 1200); this.tone(800, 0.2, 'sine', 0.06, 1600, 0.1); break;
      case 'turtle': this.tone(160, 0.5, 'square', 0.08, 90); break;
      case 'devil': [392, 370, 349, 330].forEach((f, i) => this.tone(f, 0.16, 'sawtooth', 0.06, f * 0.94, i * 0.09)); break;
      case 'tornado': this.noise(1.3, 'bandpass', 200, 2400, 0.4, 0, 2); this.noise(1.3, 'bandpass', 2400, 300, 0.25, 0.2, 3); break;
      case 'lock': this.tone(1200, 0.07, 'square', 0.06); break;
      case 'turbo': this.noise(0.8, 'bandpass', 300, 2600, 0.4); this.tone(140, 0.6, 'sawtooth', 0.08, 420); break;
      case 'hit': this.tone(440, 0.4, 'sawtooth', 0.08, 110); break;
      case 'reset': this.tone(660, 0.1, 'triangle', 0.06); this.tone(440, 0.14, 'triangle', 0.06, null, 0.08); break;
      case 'ui': this.tone(o.f || 1200, 0.05, 'triangle', 0.05); break;
      case 'early': this.tone(200, 0.2, 'square', 0.06, 150); break;
      case 'win': [523, 659, 784, 1046, 1319, 1568].forEach((f, i) => { this.tone(f, 0.5, 'square', 0.06, null, i * 0.12); this.tone(f / 2, 0.5, 'triangle', 0.06, null, i * 0.12); }); break;
    }
  }
  // ---- music sequencer
  playSong(name) {
    if (!this.ctx) { this.pending = name; return; }
    this.song = SONGS[name] || null; this.songName = name; this.step = 0; this.nextT = this.ctx.currentTime + 0.1;
  }
  stopSong() { this.song = null; }
  tick() {
    if (this.pending && this.ctx) { this.playSong(this.pending); this.pending = null; }
    const s = this.song, c = this.ctx;
    if (!s || !c || c.state !== 'running') return;
    const spb = 60 / s.bpm / 4;
    while (this.nextT < c.currentTime + 0.14) { this.sched(s, this.step, this.nextT, spb); this.step++; this.nextT += spb; }
  }
  sched(s, step, t, spb) {
    const c = this.ctx, st = step % 16, bar = Math.floor(step / 16) % s.prog.length, deg = s.prog[bar];
    const deg2n = (d, oct = 0) => { const L = s.scale.length, o = Math.floor(d / L), k = ((d % L) + L) % L; return s.root + s.scale[k] + 12 * (o + oct); };
    const dest = this.music, I = this.intense;
    const env = (o, g, a, d, v) => { g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(v, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + d); o.start(t); o.stop(t + a + d + 0.05); };
    const osc = (type, f, v, a, d, cut) => {
      const o = c.createOscillator(), g = c.createGain(); o.type = type; o.frequency.value = f;
      if (cut) { const fl = c.createBiquadFilter(); fl.type = 'lowpass'; fl.frequency.value = cut; o.connect(fl); fl.connect(g); } else o.connect(g);
      g.connect(dest); env(o, g, a, d, v);
    };
    const nz = (type, f, v, d, q = 1) => { const b = c.createBufferSource(), fl = c.createBiquadFilter(), g = c.createGain(); b.buffer = this.noiseBuf; fl.type = type; fl.frequency.value = f; fl.Q.value = q; b.connect(fl); fl.connect(g); g.connect(dest); g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.0001, t + d); b.start(t, Math.random()); b.stop(t + d + 0.05); };
    const kick = () => { const o = c.createOscillator(), g = c.createGain(); o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.14); o.connect(g); g.connect(dest); env(o, g, 0.003, 0.28, 0.9); };
    // drums
    if (s.drums === 'four') {
      if (st % 4 === 0) kick();
      if (st === 4 || st === 12) { nz('bandpass', 1800, 0.35, 0.16, 0.7); osc('triangle', 190, 0.18, 0.002, 0.1); }
      if (st % 2 === 1 || I > 0.5) nz('highpass', 8000, st % 2 ? 0.1 : 0.05, 0.05);
    } else if (s.drums === 'shuffle') {
      if (st === 0 || st === 10) kick();
      if (st === 4 || st === 12) { nz('bandpass', 2000, 0.3, 0.12, 0.8); nz('bandpass', 2400, 0.2, 0.1, 0.8); }
      if (st % 2 === 0) nz('highpass', 7000, st % 4 === 2 ? 0.09 : 0.05, 0.06);
    } else if (s.drums === 'tribal') {
      if (st === 0 || st === 6 || st === 10) kick();
      if (st === 3 || st === 11 || st === 14) osc('sine', st === 14 ? 330 : 260, 0.3, 0.002, 0.15);
      if (st === 4 || st === 12) nz('bandpass', 1500, 0.28, 0.14, 1);
      if (st % 2) nz('highpass', 6000, 0.05, 0.04);
    } else if (s.drums === 'soft') {
      if (st === 0 || st === 8) kick();
      if (st % 4 === 2) nz('highpass', 7000, 0.04, 0.05);
    }
    // bass: root on 8ths with octave pops
    if (st % 2 === 0) { const n = deg2n(deg, 0) + s.bassOct + (st % 8 === 6 ? 12 : 0); osc('sawtooth', NOTE(n), 0.2, 0.005, spb * 1.6, 500 + I * 400); }
    // pad chord at bar start
    if (st === 0) for (const d of [0, 2, 4]) { const n = deg2n(deg + d, 0) - 12; osc(s.pad === 'tri' ? 'triangle' : 'sawtooth', NOTE(n), 0.045, 0.2, spb * 15, 1400); osc('sawtooth', NOTE(n) * 1.004, 0.03, 0.2, spb * 15, 1100); }
    // lead
    const L = s.lead[st];
    if (L >= 0 && (bar % 2 === 1 || I > 0.3 || this.songName === 'menu')) {
      const n = deg2n(deg + L, 0) + 12;
      if (s.leadWave === 'bell') { osc('sine', NOTE(n), 0.1, 0.004, 0.5); osc('sine', NOTE(n) * 2.01, 0.04, 0.004, 0.25); }
      else if (s.leadWave === 'pluck') osc('sawtooth', NOTE(n), 0.09, 0.004, 0.22, 1800);
      else osc(s.leadWave, NOTE(n), s.leadWave === 'square' ? 0.05 : 0.09, 0.006, spb * 1.8, 3200);
    }
    // arpeggio sparkle when intense (final lap)
    if (I > 0.6 && st % 2 === 1) osc('square', NOTE(deg2n(deg + [0, 2, 4, 7][(st >> 1) % 4], 0) + 24), 0.025, 0.003, 0.08, 4000);
  }
}
