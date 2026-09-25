// Synthesised audio. Every sound is rendered at startup into buffers with OfflineAudioContext (layered
// gunshots per weapon, footsteps per surface, impacts, foley, explosions, UI) and played through a
// distance low-pass + occlusion muffle + stereo panner, with sends into three generated convolution
// reverbs (open deck / cabin / pipe) cross-faded by where the listener stands. Ambience and music are
// sequenced live.
const SR = 44100;
const rnd = (a, b) => a + Math.random() * (b - a);

// ---------------------------------------------------------------------------------------------- recipes
// each recipe renders into an OfflineAudioContext (ctx, out, v) where v in 0..1 varies the take
function noiseBuf(ctx, sec, brown = false) {
  const b = ctx.createBuffer(1, Math.ceil(sec * ctx.sampleRate), ctx.sampleRate), d = b.getChannelData(0);
  let last = 0;
  for (let i = 0; i < d.length; i++) { const w = Math.random() * 2 - 1; if (brown) { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; } else d[i] = w; }
  return b;
}
function env(ctx, g, t0, a, peak, dec, curve = 'exp') {
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.linearRampToValueAtTime(peak, t0 + a);
  if (curve === 'exp') g.gain.exponentialRampToValueAtTime(0.0001, t0 + a + dec);
  else g.gain.linearRampToValueAtTime(0, t0 + a + dec);
}
function noise(ctx, out, { t = 0, len = 0.3, type = 'bandpass', f = 1000, q = 1, a = 0.001, peak = 1, dec = 0.1, brown = false, f2 = null }) {
  const s = ctx.createBufferSource(); s.buffer = noiseBuf(ctx, len + 0.05, brown);
  const fl = ctx.createBiquadFilter(); fl.type = type; fl.frequency.setValueAtTime(f, t); fl.Q.value = q;
  if (f2) fl.frequency.exponentialRampToValueAtTime(f2, t + len);
  const g = ctx.createGain(); env(ctx, g, t, a, peak, dec);
  s.connect(fl).connect(g).connect(out); s.start(t); s.stop(t + len + 0.05);
}
function tone(ctx, out, { t = 0, type = 'sine', f = 440, f2 = null, a = 0.002, peak = 0.5, dec = 0.2, len = null, detune = 0 }) {
  const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(f, t); o.detune.value = detune;
  if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + (len || dec));
  const g = ctx.createGain(); env(ctx, g, t, a, peak, dec);
  o.connect(g).connect(out); o.start(t); o.stop(t + a + dec + 0.05);
}
function shaper(ctx, amt = 2) {
  const w = ctx.createWaveShaper(), n = 1024, c = new Float32Array(n);
  for (let i = 0; i < n; i++) { const x = (i / n) * 2 - 1; c[i] = Math.tanh(x * amt) / Math.tanh(amt); }
  w.curve = c; return w;
}
// gun profiles: crack (supersonic snap), body (chamber/blast), thump (low punch), mech (action), tail
const GUNS = {
  rifleA: { crack: [4200, 0.9, 0.012], body: [700, 0.9, 1.0, 0.13], thump: [95, 42, 0.9, 0.14], mech: [2600, 0.18], tail: [900, 0.35, 0.5], drive: 3 },
  rifleB: { crack: [5200, 0.8, 0.01], body: [950, 1.1, 0.85, 0.1], thump: [110, 50, 0.7, 0.11], mech: [3200, 0.2], tail: [1100, 0.3, 0.42], drive: 2.6 },
  smg: { crack: [3000, 0.6, 0.008], body: [1300, 1.3, 0.8, 0.07], thump: [130, 70, 0.5, 0.08], mech: [3800, 0.25], tail: [1400, 0.22, 0.3], drive: 2.2 },
  sniper: { crack: [3600, 1.0, 0.016], body: [480, 0.7, 1.1, 0.26], thump: [70, 30, 1.0, 0.3], mech: [2000, 0.1], tail: [700, 0.6, 1.2], drive: 3.6 },
  shotgun: { crack: [2400, 0.7, 0.014], body: [420, 0.6, 1.1, 0.22], thump: [80, 36, 1.0, 0.24], mech: [1800, 0.1], tail: [800, 0.5, 0.8], drive: 3.2 },
  pistol: { crack: [4600, 0.7, 0.008], body: [1500, 1.2, 0.7, 0.07], thump: [150, 70, 0.5, 0.07], mech: [4200, 0.3], tail: [1300, 0.25, 0.35], drive: 2.2 },
};
function renderGun(p) {
  return (ctx, out, v) => {
    const k = 1 + (v - 0.5) * 0.12;
    const drv = shaper(ctx, p.drive); const bus = ctx.createGain(); bus.gain.value = 0.9; bus.connect(drv).connect(out);
    noise(ctx, bus, { type: 'highpass', f: p.crack[0] * k, q: 0.7, peak: p.crack[1], dec: p.crack[2], len: 0.05 });
    noise(ctx, bus, { type: 'bandpass', f: p.body[0] * k, q: p.body[1], peak: p.body[2] * 1.4, dec: p.body[3], len: p.body[3] + 0.1 });
    tone(ctx, bus, { f: p.thump[0] * k, f2: p.thump[1], peak: p.thump[2], dec: p.thump[3] });
    noise(ctx, bus, { t: 0.004, type: 'bandpass', f: p.mech[0], q: 4, peak: p.mech[1], dec: 0.02, len: 0.05 });
    noise(ctx, out, { t: 0.02, type: 'lowpass', f: p.tail[0] * k, q: 0.5, a: 0.01, peak: p.tail[1], dec: p.tail[2], len: p.tail[2] + 0.1, brown: true });
  };
}
const R = {
  // footsteps per surface
  step_deck: (c, o, v) => { tone(c, o, { f: 85 + v * 20, f2: 60, peak: 0.5, dec: 0.07 }); noise(c, o, { f: 1700 + v * 500, q: 1.2, peak: 0.35, dec: 0.05, len: 0.1 }); tone(c, o, { f: 2400 + v * 300, peak: 0.03, dec: 0.12 }); },
  step_container: (c, o, v) => { tone(c, o, { f: 105 + v * 25, peak: 0.55, dec: 0.2 }); tone(c, o, { f: 180 + v * 30, peak: 0.25, dec: 0.15 }); noise(c, o, { f: 900, q: 1, peak: 0.2, dec: 0.06, len: 0.1 }); },
  step_grate: (c, o, v) => { noise(c, o, { f: 3000 + v * 800, q: 2, peak: 0.4, dec: 0.05, len: 0.1 }); for (const f of [1150, 2870, 4400]) tone(c, o, { f: f * (1 + v * 0.05), peak: 0.05, dec: 0.1 }); tone(c, o, { f: 90, peak: 0.3, dec: 0.05 }); },
  step_wood: (c, o, v) => { tone(c, o, { f: 140 + v * 30, f2: 90, peak: 0.55, dec: 0.08 }); noise(c, o, { type: 'lowpass', f: 900, peak: 0.3, dec: 0.05, len: 0.1 }); },
  step_lino: (c, o, v) => { noise(c, o, { type: 'highpass', f: 1200 + v * 400, peak: 0.25, dec: 0.03, len: 0.06 }); tone(c, o, { f: 120, peak: 0.25, dec: 0.04 }); },
  land: (c, o, v) => { tone(c, o, { f: 70, f2: 45, peak: 0.8, dec: 0.15 }); noise(c, o, { f: 900, q: 0.8, peak: 0.5, dec: 0.1, len: 0.2 }); },
  // impacts
  hit_metal: (c, o, v) => { noise(c, o, { type: 'highpass', f: 3000, peak: 0.5, dec: 0.02, len: 0.05 }); tone(c, o, { f: 2600 + v * 2000, peak: 0.12, dec: 0.25 }); tone(c, o, { f: 1400 + v * 600, peak: 0.08, dec: 0.18 }); },
  hit_wood: (c, o, v) => { tone(c, o, { f: 220 + v * 80, f2: 120, peak: 0.6, dec: 0.08 }); noise(c, o, { f: 1400, q: 1, peak: 0.5, dec: 0.06, len: 0.1 }); },
  hit_flesh: (c, o, v) => { noise(c, o, { type: 'lowpass', f: 500 + v * 200, peak: 0.9, dec: 0.1, len: 0.15 }); tone(c, o, { f: 90, f2: 50, peak: 0.6, dec: 0.1 }); },
  ric: (c, o, v) => { tone(c, o, { type: 'sine', f: 3200 + v * 1500, f2: 1300, peak: 0.15, dec: 0.35, len: 0.35 }); noise(c, o, { type: 'highpass', f: 4000, peak: 0.3, dec: 0.02, len: 0.04 }); },
  whiz: (c, o, v) => { noise(c, o, { type: 'bandpass', f: 2500, f2: 900, q: 3, a: 0.04, peak: 0.6, dec: 0.12, len: 0.18 }); },
  shell_rifle: (c, o, v) => { for (let i = 0; i < 3; i++) tone(c, o, { t: i * 0.07 + v * 0.02, f: 4200 + v * 900 - i * 300, peak: 0.12 / (i + 1), dec: 0.06 }); },
  shell_pistol: (c, o, v) => { for (let i = 0; i < 3; i++) tone(c, o, { t: i * 0.06, f: 5200 + v * 900, peak: 0.1 / (i + 1), dec: 0.05 }); },
  shell_shotgun: (c, o, v) => { tone(c, o, { f: 900 + v * 200, peak: 0.2, dec: 0.08 }); tone(c, o, { t: 0.09, f: 700, peak: 0.1, dec: 0.06 }); },
  // foley
  magout: (c, o) => { noise(c, o, { f: 2400, q: 3, peak: 0.5, dec: 0.02, len: 0.05 }); noise(c, o, { t: 0.03, type: 'bandpass', f: 1200, q: 1, peak: 0.3, dec: 0.12, len: 0.2 }); },
  magin: (c, o) => { noise(c, o, { f: 1900, q: 2, peak: 0.6, dec: 0.03, len: 0.05 }); tone(c, o, { f: 320, peak: 0.4, dec: 0.05 }); noise(c, o, { t: 0.05, f: 3000, q: 4, peak: 0.5, dec: 0.02, len: 0.04 }); },
  bolt: (c, o) => { noise(c, o, { f: 2600, q: 3, peak: 0.6, dec: 0.03, len: 0.06 }); noise(c, o, { t: 0.02, type: 'bandpass', f: 1500, q: 1.5, peak: 0.35, dec: 0.08, len: 0.12 }); noise(c, o, { t: 0.16, f: 3100, q: 3, peak: 0.7, dec: 0.03, len: 0.06 }); },
  pump: (c, o) => { noise(c, o, { f: 1200, q: 1.5, peak: 0.6, dec: 0.07, len: 0.1 }); noise(c, o, { t: 0.18, f: 1600, q: 1.5, peak: 0.7, dec: 0.07, len: 0.1 }); },
  shellin: (c, o) => { noise(c, o, { f: 1800, q: 2, peak: 0.5, dec: 0.04, len: 0.06 }); tone(c, o, { f: 500, peak: 0.2, dec: 0.04 }); },
  dry: (c, o) => { noise(c, o, { f: 3500, q: 5, peak: 0.5, dec: 0.015, len: 0.03 }); },
  draw: (c, o) => { noise(c, o, { type: 'bandpass', f: 800, q: 0.7, a: 0.05, peak: 0.35, dec: 0.15, len: 0.25 }); noise(c, o, { t: 0.2, f: 2800, q: 4, peak: 0.4, dec: 0.02, len: 0.04 }); },
  pin: (c, o) => { tone(c, o, { f: 3400, peak: 0.25, dec: 0.25 }); noise(c, o, { f: 5000, q: 5, peak: 0.3, dec: 0.02, len: 0.04 }); },
  throw: (c, o) => { noise(c, o, { type: 'bandpass', f: 600, f2: 1600, q: 1, a: 0.08, peak: 0.5, dec: 0.2, len: 0.3 }); },
  bounce: (c, o, v) => { tone(c, o, { f: 380 + v * 200, f2: 260, peak: 0.5, dec: 0.08 }); noise(c, o, { f: 2000, q: 2, peak: 0.3, dec: 0.03, len: 0.05 }); },
  swing: (c, o) => { noise(c, o, { type: 'bandpass', f: 900, f2: 2800, q: 1.2, a: 0.05, peak: 0.6, dec: 0.15, len: 0.22 }); },
  stab: (c, o) => { noise(c, o, { type: 'lowpass', f: 700, peak: 0.9, dec: 0.12, len: 0.15 }); noise(c, o, { f: 3500, q: 2, peak: 0.3, dec: 0.05, len: 0.08 }); },
  explode: (c, o) => {
    const d = shaper(c, 3); const b = c.createGain(); b.gain.value = 1; b.connect(d).connect(o);
    noise(c, b, { type: 'lowpass', f: 1800, f2: 200, a: 0.004, peak: 1.2, dec: 1.4, len: 1.6, brown: true });
    tone(c, b, { f: 60, f2: 28, peak: 1.2, dec: 0.9, len: 0.9 });
    noise(c, b, { type: 'highpass', f: 2500, peak: 0.7, dec: 0.08, len: 0.1 });
    for (let i = 0; i < 14; i++) noise(c, o, { t: 0.1 + Math.random() * 0.9, f: 1500 + Math.random() * 3000, q: 3, peak: 0.12, dec: 0.03, len: 0.05 });
  },
  flashbang: (c, o) => { const d = shaper(c, 4); d.connect(o); noise(c, d, { type: 'highpass', f: 800, peak: 1.2, dec: 0.25, len: 0.3 }); tone(c, d, { f: 90, f2: 40, peak: 0.9, dec: 0.3 }); },
  tinnitus: (c, o) => { tone(c, o, { f: 3800, peak: 0.12, a: 0.05, dec: 3.5, curve: 'lin' }); },
  smoke: (c, o) => { noise(c, o, { type: 'highpass', f: 3500, a: 0.1, peak: 0.25, dec: 2.8, len: 3, curve: 'lin' }); },
  // ui / game
  hitmark: (c, o) => { tone(c, o, { type: 'triangle', f: 1800, peak: 0.3, dec: 0.05 }); },
  headshot: (c, o) => { tone(c, o, { type: 'sine', f: 2400, peak: 0.35, dec: 0.3 }); tone(c, o, { type: 'sine', f: 3600, peak: 0.15, dec: 0.2 }); },
  kill: (c, o) => { tone(c, o, { type: 'triangle', f: 880, peak: 0.3, dec: 0.12 }); tone(c, o, { t: 0.07, type: 'triangle', f: 1320, peak: 0.3, dec: 0.2 }); },
  medal: (c, o) => { [660, 880, 1100, 1320].forEach((f, i) => tone(c, o, { t: i * 0.06, type: 'triangle', f, peak: 0.25, dec: 0.25 })); },
  click: (c, o) => { tone(c, o, { type: 'square', f: 1200, peak: 0.08, dec: 0.03 }); },
  hover: (c, o) => { tone(c, o, { type: 'sine', f: 2000, peak: 0.05, dec: 0.02 }); },
  beep: (c, o) => { tone(c, o, { type: 'sine', f: 1000, peak: 0.25, dec: 0.12 }); },
  hurt: (c, o) => { noise(c, o, { type: 'lowpass', f: 400, peak: 0.8, dec: 0.12, len: 0.15 }); tone(c, o, { f: 70, peak: 0.6, dec: 0.12 }); },
  heart: (c, o) => { tone(c, o, { f: 55, f2: 40, peak: 0.7, dec: 0.12 }); tone(c, o, { t: 0.22, f: 50, f2: 38, peak: 0.5, dec: 0.12 }); },
  horn: (c, o) => {
    for (const [f, dt] of [[98, 0], [123.5, 4], [98.5, -6]]) {
      const osc = c.createOscillator(); osc.type = 'sawtooth'; osc.frequency.value = f; osc.detune.value = dt;
      const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 700; lp.Q.value = 2;
      const g = c.createGain(); g.gain.setValueAtTime(0, 0); g.gain.linearRampToValueAtTime(0.18, 0.15); g.gain.setValueAtTime(0.18, 1.7); g.gain.linearRampToValueAtTime(0, 2.2);
      osc.connect(lp).connect(g).connect(o); osc.start(0); osc.stop(2.3);
    }
  },
  win: (c, o) => { [[523, 659, 784], [587, 740, 880], [659, 831, 988]].forEach((ch, i) => ch.forEach((f) => tone(c, o, { t: i * 0.28, type: 'triangle', f, peak: 0.12, dec: 0.9 }))); },
  lose: (c, o) => { [[392, 466, 587], [349, 415, 523], [311, 370, 466]].forEach((ch, i) => ch.forEach((f) => tone(c, o, { t: i * 0.32, type: 'triangle', f, peak: 0.12, dec: 1.0 }))); },
  gull: (c, o, v) => { for (let i = 0; i < 3; i++) tone(c, o, { t: i * 0.22, type: 'triangle', f: 1500 + v * 400, f2: 900, peak: 0.06, dec: 0.18, len: 0.18 }); },
};
const LENS = { explode: 2.2, horn: 2.4, win: 2, lose: 2.2, tinnitus: 3.8, smoke: 3.2, gull: 0.9 };
for (const [k, p] of Object.entries(GUNS)) { R['gun_' + k] = renderGun(p); LENS['gun_' + k] = 1.4; }

function impulse(ctx, sec, decay, tone = 1, early = []) {
  const len = Math.ceil(sec * ctx.sampleRate), b = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = b.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const t = i / ctx.sampleRate;
      const w = (Math.random() * 2 - 1) * Math.pow(1 - t / sec, decay);
      lp += (w - lp) * tone; d[i] = lp;
    }
    for (const [t, g] of early) { const i = Math.floor(t * ctx.sampleRate * (1 + ch * 0.03)); if (i < len) d[i] += g * (ch ? 0.8 : 1); }
  }
  return b;
}

// ---------------------------------------------------------------------------------------------- engine
export class Audio {
  constructor() { this.ok = false; this.buf = {}; this.vol = { master: 0.8, music: 0.5, sfx: 0.9 }; this.muted = false; this.env = 'deck'; this.last = {}; }
  async init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = this.ctx = new AC();
    this.master = ctx.createGain();
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 4; comp.attack.value = 0.003; comp.release.value = 0.2;
    this.master.connect(comp).connect(ctx.destination);
    this.sfx = ctx.createGain(); this.music = ctx.createGain(); this.uiBus = ctx.createGain(); this.amb = ctx.createGain();
    this.sfx.connect(this.master); this.music.connect(this.master); this.uiBus.connect(this.master); this.amb.connect(this.sfx);
    // reverbs: open deck (short slap off the containers), cabin (small metal room), pipe (long metallic tube)
    this.verbs = {};
    const irs = {
      deck: impulse(ctx, 1.3, 3.2, 0.5, [[0.045, 0.5], [0.09, 0.3], [0.16, 0.2]]),
      cabin: impulse(ctx, 0.9, 2.2, 0.35, [[0.012, 0.6], [0.025, 0.4]]),
      pipe: impulse(ctx, 2.4, 1.8, 0.25, [[0.02, 0.5], [0.04, 0.45], [0.06, 0.4], [0.08, 0.35], [0.1, 0.3]]),
    };
    for (const k in irs) { const cv = ctx.createConvolver(); cv.buffer = irs[k]; const g = ctx.createGain(); g.gain.value = k === 'deck' ? 1 : 0; cv.connect(g).connect(this.sfx); this.verbs[k] = { cv, g }; }
    this.verbIn = ctx.createGain(); for (const k in this.verbs) this.verbIn.connect(this.verbs[k].cv);
    this.applyVolume();
    // render all buffers (several takes of the varied ones)
    const jobs = [];
    for (const [k, fn] of Object.entries(R)) {
      const takes = k.startsWith('gun_') || k.startsWith('step_') || k.startsWith('hit_') || k === 'ric' || k.startsWith('shell_') || k === 'bounce' || k === 'gull' ? 3 : 1;
      for (let i = 0; i < takes; i++) jobs.push(this._render(k, fn, LENS[k] || 0.5, takes > 1 ? i / (takes - 1) : 0.5));
    }
    await Promise.all(jobs);
    this.ok = true;
    this._ambience();
  }
  async _render(key, fn, sec, v) {
    const oc = new OfflineAudioContext(1, Math.ceil(sec * SR), SR);
    const out = oc.createGain(); out.connect(oc.destination);
    fn(oc, out, v);
    const b = await oc.startRendering();
    (this.buf[key] || (this.buf[key] = [])).push(b);
  }
  applyVolume() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this.muted ? 0 : this.vol.master, t, 0.05);
    this.music.gain.setTargetAtTime(this.vol.music * 0.5, t, 0.1);
    this.sfx.gain.setTargetAtTime(this.vol.sfx, t, 0.05);
    this.uiBus.gain.setTargetAtTime(this.vol.sfx * 0.8, t, 0.05);
  }
  setEnv(env) {
    if (!this.ctx || env === this.env) return;
    this.env = env;
    const t = this.ctx.currentTime;
    for (const k in this.verbs) this.verbs[k].g.gain.setTargetAtTime(k === env ? 1 : 0, t, 0.25);
  }
  // listener = camera
  listen(pos, fwd, up) {
    this.lp = pos; this.lf = fwd;
    if (!this.ctx) return;
    const L = this.ctx.listener;
    if (L.positionX) { L.positionX.value = pos.x; L.positionY.value = pos.y; L.positionZ.value = pos.z; L.forwardX.value = fwd.x; L.forwardY.value = fwd.y; L.forwardZ.value = fwd.z; L.upX.value = up.x; L.upY.value = up.y; L.upZ.value = up.z; }
    else { L.setPosition(pos.x, pos.y, pos.z); L.setOrientation(fwd.x, fwd.y, fwd.z, up.x, up.y, up.z); }
  }
  // play a buffer: o = { pos, gain, rate, verb (send), occluded, ui, maxDist }
  play(key, o = {}) {
    if (!this.ok || !this.buf[key]) return;
    const ctx = this.ctx, list = this.buf[key];
    const b = list[(Math.random() * list.length) | 0];
    const s = ctx.createBufferSource(); s.buffer = b;
    s.playbackRate.value = (o.rate || 1) * (1 + (Math.random() - 0.5) * (o.jit ?? 0.06));
    const g = ctx.createGain();
    let gain = o.gain ?? 1, cutoff = 20000, send = o.verb ?? 0.25;
    if (o.pos && this.lp) {
      const d = Math.hypot(o.pos.x - this.lp.x, o.pos.y - this.lp.y, o.pos.z - this.lp.z);
      const md = o.maxDist || 120;
      if (d > md) return;
      gain *= 1 / (1 + d * d * 0.004) * (1 - d / md);
      cutoff = 18000 * Math.pow(0.5, d / 22); // air absorption
      send *= 1 + d / 25;
      if (o.occluded) { gain *= 0.45; cutoff = Math.min(cutoff, 900); send *= 1.4; }
    }
    if (gain < 0.002) return;
    g.gain.value = gain;
    let node = s;
    if (cutoff < 19000) { const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = Math.max(300, cutoff); node.connect(f); node = f; }
    node.connect(g);
    if (o.pos) {
      const p = ctx.createPanner(); p.panningModel = 'equalpower'; p.distanceModel = 'linear'; p.rolloffFactor = 0; p.refDistance = 1; p.maxDistance = 10000;
      if (p.positionX) { p.positionX.value = o.pos.x; p.positionY.value = o.pos.y; p.positionZ.value = o.pos.z; } else p.setPosition(o.pos.x, o.pos.y, o.pos.z);
      g.connect(p); p.connect(o.ui ? this.uiBus : this.sfx);
    } else g.connect(o.ui ? this.uiBus : this.sfx);
    if (send > 0.01 && !o.ui) { const sg = ctx.createGain(); sg.gain.value = Math.min(1.2, send) * gain; node.connect(sg).connect(this.verbIn); }
    s.start();
    return s;
  }
  // convenience wrappers
  gun(sound, pos, self, occluded) { this.play('gun_' + sound, { pos: self ? null : pos, gain: self ? 0.85 : 1.1, verb: self ? 0.35 : 0.5, occluded, maxDist: 260, jit: 0.05 }); }
  step(surface, pos, self, loud = 1) {
    const k = { deck: 'step_deck', steel: 'step_deck', container: 'step_container', grate: 'step_grate', rail: 'step_grate', wood: 'step_wood', lino: 'step_lino', drum: 'step_container' }[surface] || 'step_deck';
    this.play(k, { pos: self ? null : pos, gain: (self ? 0.32 : 0.8) * loud, verb: 0.15, maxDist: 30, jit: 0.1 });
  }
  impact(mat, pos) { this.play(mat === 'wood' ? 'hit_wood' : mat === 'flesh' ? 'hit_flesh' : 'hit_metal', { pos, gain: 0.7, maxDist: 45 }); if (mat !== 'wood' && mat !== 'flesh' && Math.random() < 0.2) this.play('ric', { pos, gain: 0.4, maxDist: 40 }); }
  shell(pos, kind) { this.play('shell_' + (kind || 'rifle'), { pos, gain: 0.35, maxDist: 16, verb: 0.05 }); }
  ui(key, gain = 1) { this.play(key, { ui: true, gain }); }
  sfx2(key, pos, gain = 1, maxDist = 60) { this.play(key, { pos, gain, maxDist }); }
  // ambience: looping sea + wind bed, gulls and distant port clanks
  _ambience() {
    const ctx = this.ctx;
    const sea = ctx.createBufferSource(); sea.buffer = noiseBuf(ctx, 6, true); sea.loop = true;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 500;
    const g = ctx.createGain(); g.gain.value = 0.35;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.13; const lg = ctx.createGain(); lg.gain.value = 0.18; lfo.connect(lg).connect(g.gain);
    sea.connect(lp).connect(g).connect(this.amb); sea.start(); lfo.start();
    const wind = ctx.createBufferSource(); wind.buffer = noiseBuf(ctx, 5); wind.loop = true;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 700; bp.Q.value = 0.6;
    const wg = ctx.createGain(); wg.gain.value = 0.035;
    const lfo2 = ctx.createOscillator(); lfo2.frequency.value = 0.07; const lg2 = ctx.createGain(); lg2.gain.value = 300; lfo2.connect(lg2).connect(bp.frequency);
    wind.connect(bp).connect(wg).connect(this.amb); wind.start(); lfo2.start();
    this.ambG = g;
    setInterval(() => {
      if (!this.lp || this.ctx.state !== 'running') return;
      if (Math.random() < 0.35) this.play('gull', { pos: { x: this.lp.x + rnd(-40, 40), y: this.lp.y + 25, z: this.lp.z + rnd(-40, 40) }, gain: 0.5, maxDist: 200, verb: 0.3 });
      if (Math.random() < 0.2) this.play('hit_metal', { pos: { x: rnd(-80, 80), y: 0, z: rnd(40, 90) }, gain: 0.25, maxDist: 250, verb: 1, rate: 0.5 });
    }, 3000);
  }
  // ---------------------------------------------------------------- music (live sequencer)
  startMusic(kind = 'menu') {
    if (!this.ctx) return;
    this.musicKind = kind;
    if (this._seq) return;
    const ctx = this.ctx, bpm = 96, stepT = 60 / bpm / 4;
    let step = 0, next = ctx.currentTime + 0.1;
    // Am  F  C  G  (menu) / minor drone pulse (match)
    const chords = [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]];
    const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
    const voice = (t, f, dur, type, gain, cut = 1800, dest = this.music) => {
      const o = ctx.createOscillator(); o.type = type; o.frequency.value = f;
      const fl = ctx.createBiquadFilter(); fl.type = 'lowpass'; fl.frequency.value = cut;
      const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(gain, t + Math.min(0.08, dur * 0.3)); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(fl).connect(g).connect(dest); o.start(t); o.stop(t + dur + 0.05);
    };
    const drum = (t, kind, gain) => {
      if (kind === 'k') { const o = ctx.createOscillator(); o.frequency.setValueAtTime(120, t); o.frequency.exponentialRampToValueAtTime(40, t + 0.15); const g = ctx.createGain(); g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.25); o.connect(g).connect(this.music); o.start(t); o.stop(t + 0.3); }
      else { const s = ctx.createBufferSource(); s.buffer = this._nb || (this._nb = noiseBuf(ctx, 0.3)); const f = ctx.createBiquadFilter(); f.type = kind === 'h' ? 'highpass' : 'bandpass'; f.frequency.value = kind === 'h' ? 7000 : 1800; const g = ctx.createGain(); g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0001, t + (kind === 'h' ? 0.04 : 0.15)); s.connect(f).connect(g).connect(this.music); s.start(t); s.stop(t + 0.2); }
    };
    this._seq = setInterval(() => {
      if (ctx.state !== 'running') return;
      while (next < ctx.currentTime + 0.15) {
        const bar = Math.floor(step / 16) % 4, s = step % 16, ch = chords[bar];
        const menu = this.musicKind === 'menu', tense = this.musicKind === 'tense';
        if (this.musicKind !== 'off') {
          if (s === 0) for (const m of ch) { voice(next, mtof(m), stepT * 16, 'sawtooth', menu ? 0.028 : 0.018, menu ? 1400 : 900); voice(next, mtof(m) * 1.004, stepT * 16, 'sawtooth', menu ? 0.02 : 0.012, 1100); }
          if (s % 4 === 0 || (tense && s % 2 === 0)) voice(next, mtof(ch[0] - 24), stepT * 3, 'triangle', menu ? 0.12 : 0.1, 600);
          if (menu && (s % 3 === 0)) voice(next, mtof(ch[(s / 3) % 3 | 0] + 12), stepT * 1.5, 'square', 0.025, 2600);
          if (menu || tense) { if (s % 8 === 0) drum(next, 'k', 0.35); if (s % 8 === 4) drum(next, 's', 0.12); if (s % 2 === 1) drum(next, 'h', 0.05); }
          else if (s === 0 && bar % 2 === 0) drum(next, 'k', 0.18);
        }
        next += stepT; step++;
      }
    }, 25);
  }
  setMusic(kind) { this.musicKind = kind; }
}
