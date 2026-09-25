(function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // Neon Circuit — segment-projected night highway racer (portrait 360x640)
  // ---------------------------------------------------------------------------
  const W = 360, H = 640;
  const SEG = 200;            // world length of one road segment
  const ROADW = 1000;         // HALF road width in world units (road spans x -1..1 normalised)
  const CAMH = 2000;          // camera height above the road
  const FOCAL = 400;          // focal length in logical pixels
  const HOR = 268;            // horizon line (screen y)
  const CAR_Y = 580;          // screen y of the player's rear wheels
  const PZ = CAMH * FOCAL / (CAR_Y - HOR); // distance camera -> player car
  const DRAW = 220;           // segments drawn
  const RUMBLE = 3;           // segments per rumble block
  const CURVE_K = 0.55;       // how strongly curve values bend the projected road
  const LAMP_EVERY = 12;
  const UNIT_M = 50 / 12000;  // metres per world unit (12000 u/s == 180 km/h)
  const KMH = 180 / 12000;
  const PLAYER_W = 560;
  const P_HW = PLAYER_W / 2 / ROADW;
  const FOG_START = 11000, FOG_END = DRAW * SEG;

  const MONO = "'IBM Plex Mono', ui-monospace, Menlo, Consolas, monospace";
  const DISP = "Bungee, Impact, 'Arial Black', sans-serif";

  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, p) => a + (b - a) * p;
  const easeIn = (a, b, p) => a + (b - a) * p * p;
  const easeInOut = (a, b, p) => a + (b - a) * (-Math.cos(p * Math.PI) / 2 + 0.5);

  // ---- colour helpers (cached) ----
  const cache = {};
  function rgbOf(hex) {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function shade(hex, k) {
    const key = hex + k;
    if (cache[key]) return cache[key];
    const c = rgbOf(hex).map((v) => Math.round(k >= 0 ? v + (255 - v) * k : v * (1 + k)));
    return (cache[key] = 'rgb(' + c[0] + ',' + c[1] + ',' + c[2] + ')');
  }

  // ---- seeded rng for static scenery ----
  function mulberry(seed) {
    return function () {
      seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ---- skyline layers (built once) ----
  const PERIOD = 720;
  function buildSkyline(seed, minH, maxH, minW, maxW, litP, colors) {
    const r = mulberry(seed);
    const blds = [], wins = colors.map(() => []);
    let x = 0;
    while (x < PERIOD) {
      const bw = Math.round(minW + r() * (maxW - minW));
      // keep the middle a bit lower so the sun peeks through
      const mid = Math.abs(((x + bw / 2) % PERIOD) - PERIOD / 4) < 60 ? 0.6 : 1;
      const bh = Math.round((minH + r() * (maxH - minH)) * mid);
      const b = { x, w: bw, h: bh, ant: r() < 0.25 && bh > maxH * 0.6, neon: r() < 0.3 ? (r() < 0.5 ? 1 : 2) : 0, step: r() < 0.3 };
      blds.push(b);
      for (let wy = bh - 7; wy > 4; wy -= 7) {
        for (let wx = 3; wx < bw - 4; wx += 6) {
          if (r() < litP) {
            const ci = Math.floor(r() * colors.length);
            wins[ci].push(x + wx, wy);
          }
        }
      }
      x += bw + (r() < 0.3 ? Math.round(r() * 8) : 0);
    }
    return { blds, wins, colors };
  }
  const SKY_FAR = buildSkyline(7, 26, 92, 16, 40, 0.14, ['#7A5CC0', '#4F3C8C']);
  const SKY_NEAR = buildSkyline(21, 34, 150, 22, 54, 0.22, ['#FFD23F', '#3DDCFF', '#FF8FB1', '#FFE9A8']);
  const STARS = (function () {
    const r = mulberry(99), a = [];
    for (let i = 0; i < 46; i++) a.push({ x: r() * PERIOD, y: r() * (HOR - 110), s: r() < 0.2 ? 1.6 : 1, ph: r() * 6.28 });
    return a;
  })();

  // ---- car types (world width, height/width ratio) ----
  const TYPES = {
    coupe: { w: 520, hr: 0.56 },
    sedan: { w: 560, hr: 0.62 },
    van: { w: 600, hr: 0.92 },
    truck: { w: 660, hr: 1.12 }
  };
  const TRAFFIC_COLORS = ['#FFD23F', '#5CF2A5', '#FF5D73', '#B18CFF', '#FF9F43', '#ECEAFF', '#FF6AD5', '#7B8CFF'];

  // ---------------------------------------------------------------------------
  // Car drawing (rear view). (cx, by) = bottom centre, w = screen width.
  // ---------------------------------------------------------------------------
  function tailGlow(ctx, x, y, r, a) {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(255,60,95,' + a + ')');
    g.addColorStop(1, 'rgba(255,40,80,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }

  function drawCar(ctx, cx, by, w, color, type, o) {
    const T = TYPES[type] || TYPES.coupe;
    const h = w * T.hr;
    const brake = o.brake ? 1 : 0;
    ctx.save();
    ctx.translate(cx, by);
    if (o.alpha != null && o.alpha < 1) ctx.globalAlpha = o.alpha;
    if (o.rot) ctx.rotate(o.rot);

    if (w < 8) {
      // far away: just a pair of tail lights in the dark
      ctx.globalCompositeOperation = 'lighter';
      const r = Math.max(1.6, w * 0.5);
      tailGlow(ctx, -w * 0.35, -h * 0.45, r * 1.6, 0.8);
      tailGlow(ctx, w * 0.35, -h * 0.45, r * 1.6, 0.8);
      ctx.restore();
      return;
    }

    // ground shadow
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.beginPath();
    ctx.ellipse(0, -h * 0.02, w * 0.6, Math.max(1.5, w * 0.07), 0, 0, Math.PI * 2);
    ctx.fill();

    // tyres
    ctx.fillStyle = '#06060E';
    const tw = w * 0.16, th = h * (type === 'truck' ? 0.16 : 0.28);
    ctx.fillRect(-w * 0.47, -th, tw, th);
    ctx.fillRect(w * 0.47 - tw, -th, tw, th);

    if (o.roll) ctx.transform(1, 0, o.roll * 0.09, 1, 0, 0);

    const light = shade(color, 0.28), dark = shade(color, -0.45), mid = shade(color, -0.15);

    if (type === 'truck') {
      // box trailer
      const g = ctx.createLinearGradient(0, -h, 0, -h * 0.12);
      g.addColorStop(0, light); g.addColorStop(1, dark);
      ctx.fillStyle = g;
      ctx.fillRect(-w / 2, -h, w, h * 0.86);
      ctx.fillStyle = 'rgba(0,0,0,0.18)';
      for (let i = 1; i < 4; i++) ctx.fillRect(-w / 2 + (w * i) / 4 - w * 0.008, -h * 0.97, w * 0.016, h * 0.8);
      ctx.fillStyle = 'rgba(255,255,255,0.18)';
      ctx.fillRect(-w / 2, -h, w, h * 0.03);
      // underride bar
      ctx.fillStyle = '#15152A';
      ctx.fillRect(-w * 0.44, -h * 0.13, w * 0.88, h * 0.04);
      // amber markers along the top
      ctx.fillStyle = '#FFB547';
      for (let i = 0; i < 5; i++) ctx.fillRect(-w * 0.4 + i * w * 0.2 - w * 0.012, -h * 0.975, w * 0.024, h * 0.02);
      // tail lights (lower corners)
      ctx.fillStyle = brake ? '#FF6A88' : '#FF2D55';
      ctx.fillRect(-w * 0.48, -h * 0.28, w * 0.08, h * 0.1);
      ctx.fillRect(w * 0.40, -h * 0.28, w * 0.08, h * 0.1);
      ctx.globalCompositeOperation = 'lighter';
      tailGlow(ctx, -w * 0.44, -h * 0.23, w * (0.2 + brake * 0.1), 0.55 + brake * 0.3);
      tailGlow(ctx, w * 0.44, -h * 0.23, w * (0.2 + brake * 0.1), 0.55 + brake * 0.3);
      ctx.globalCompositeOperation = 'source-over';
    } else if (type === 'van') {
      const g = ctx.createLinearGradient(0, -h, 0, -h * 0.1);
      g.addColorStop(0, light); g.addColorStop(1, dark);
      ctx.fillStyle = g;
      roundRect(ctx, -w / 2, -h * 0.97, w, h * 0.86, w * 0.08);
      ctx.fill();
      // rear windows (split doors)
      ctx.fillStyle = '#0B1030';
      roundRect(ctx, -w * 0.42, -h * 0.9, w * 0.39, h * 0.3, w * 0.04); ctx.fill();
      roundRect(ctx, w * 0.03, -h * 0.9, w * 0.39, h * 0.3, w * 0.04); ctx.fill();
      ctx.fillStyle = 'rgba(160,190,255,0.16)';
      ctx.fillRect(-w * 0.36, -h * 0.88, w * 0.08, h * 0.26);
      ctx.fillRect(w * 0.09, -h * 0.88, w * 0.08, h * 0.26);
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.fillRect(-w * 0.006, -h * 0.95, w * 0.012, h * 0.8);
      // bumper
      ctx.fillStyle = '#16162C';
      ctx.fillRect(-w * 0.5, -h * 0.2, w, h * 0.09);
      // vertical tail lights
      ctx.fillStyle = brake ? '#FF6A88' : '#FF2D55';
      ctx.fillRect(-w * 0.49, -h * 0.58, w * 0.06, h * 0.3);
      ctx.fillRect(w * 0.43, -h * 0.58, w * 0.06, h * 0.3);
      ctx.globalCompositeOperation = 'lighter';
      tailGlow(ctx, -w * 0.46, -h * 0.43, w * (0.22 + brake * 0.1), 0.55 + brake * 0.3);
      tailGlow(ctx, w * 0.46, -h * 0.43, w * (0.22 + brake * 0.1), 0.55 + brake * 0.3);
      ctx.globalCompositeOperation = 'source-over';
    } else {
      // coupe / sedan: cabin
      const cabTop = type === 'coupe' ? 0.26 : 0.3;
      ctx.fillStyle = mid;
      ctx.beginPath();
      ctx.moveTo(-w * 0.43, -h * 0.6);
      ctx.lineTo(-w * cabTop - w * 0.03, -h * 0.97);
      ctx.quadraticCurveTo(0, -h * 1.02, w * cabTop + w * 0.03, -h * 0.97);
      ctx.lineTo(w * 0.43, -h * 0.6);
      ctx.closePath();
      ctx.fill();
      // rear glass
      const gg = ctx.createLinearGradient(0, -h * 0.94, 0, -h * 0.62);
      gg.addColorStop(0, '#1C2766'); gg.addColorStop(1, '#070A22');
      ctx.fillStyle = gg;
      ctx.beginPath();
      ctx.moveTo(-w * 0.37, -h * 0.63);
      ctx.lineTo(-w * cabTop, -h * 0.92);
      ctx.lineTo(w * cabTop, -h * 0.92);
      ctx.lineTo(w * 0.37, -h * 0.63);
      ctx.closePath();
      ctx.fill();
      if (w > 20) {
        ctx.fillStyle = 'rgba(190,210,255,0.14)';
        ctx.beginPath();
        ctx.moveTo(-w * 0.2, -h * 0.63); ctx.lineTo(-w * 0.1, -h * 0.92);
        ctx.lineTo(-w * 0.02, -h * 0.92); ctx.lineTo(-w * 0.12, -h * 0.63);
        ctx.closePath(); ctx.fill();
      }
      // lower body
      const g = ctx.createLinearGradient(0, -h * 0.64, 0, -h * 0.08);
      g.addColorStop(0, light); g.addColorStop(0.55, color); g.addColorStop(1, dark);
      ctx.fillStyle = g;
      roundRect(ctx, -w / 2, -h * 0.64, w, h * 0.55, w * 0.07);
      ctx.fill();
      // trunk lip highlight
      ctx.fillStyle = 'rgba(255,255,255,0.28)';
      ctx.fillRect(-w * 0.44, -h * 0.64, w * 0.88, Math.max(1, h * 0.025));
      // spoiler for the player
      if (o.spoiler) {
        ctx.fillStyle = dark;
        ctx.fillRect(-w * 0.28, -h * 0.72, w * 0.04, h * 0.1);
        ctx.fillRect(w * 0.24, -h * 0.72, w * 0.04, h * 0.1);
        ctx.fillStyle = shade(color, -0.3);
        roundRect(ctx, -w * 0.49, -h * 0.77, w * 0.98, h * 0.07, h * 0.03); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.35)';
        ctx.fillRect(-w * 0.47, -h * 0.77, w * 0.94, Math.max(1, h * 0.018));
      }
      // tail light housing + bar
      ctx.fillStyle = '#2A0614';
      ctx.fillRect(-w * 0.47, -h * 0.54, w * 0.94, h * 0.11);
      ctx.fillStyle = brake ? '#FF7A95' : '#FF2D55';
      ctx.fillRect(-w * 0.46, -h * 0.525, w * 0.25, h * 0.08);
      ctx.fillRect(w * 0.21, -h * 0.525, w * 0.25, h * 0.08);
      ctx.fillStyle = brake ? '#FF5C7F' : '#C21F45';
      ctx.fillRect(-w * 0.21, -h * 0.5, w * 0.42, h * 0.03);
      if (o.accent && w > 30) {
        // neon underglow strip on the diffuser
        ctx.fillStyle = o.accent;
        ctx.fillRect(-w * 0.36, -h * 0.13, w * 0.72, Math.max(1, h * 0.025));
      }
      // bumper / diffuser
      ctx.fillStyle = '#12122A';
      ctx.fillRect(-w * 0.44, -h * 0.2, w * 0.88, h * 0.08);
      if (w > 24) {
        // plate
        ctx.fillStyle = '#E4E2FF';
        ctx.fillRect(-w * 0.09, -h * 0.36, w * 0.18, h * 0.1);
        ctx.fillStyle = '#3A3A66';
        ctx.fillRect(-w * 0.06, -h * 0.325, w * 0.12, h * 0.03);
        // exhausts
        ctx.fillStyle = '#4A4A6A';
        ctx.beginPath(); ctx.arc(-w * 0.3, -h * 0.16, w * 0.035, 0, 7); ctx.fill();
        ctx.beginPath(); ctx.arc(w * 0.3, -h * 0.16, w * 0.035, 0, 7); ctx.fill();
      }
      ctx.globalCompositeOperation = 'lighter';
      const ga = 0.5 + brake * 0.35, gr = w * (0.22 + brake * 0.12);
      tailGlow(ctx, -w * 0.33, -h * 0.48, gr, ga);
      tailGlow(ctx, w * 0.33, -h * 0.48, gr, ga);
      ctx.globalCompositeOperation = 'source-over';
    }

    // turn signal
    if (o.blink) {
      ctx.globalCompositeOperation = 'lighter';
      const bx = o.blink * w * 0.47;
      const g = ctx.createRadialGradient(bx, -h * 0.45, 0, bx, -h * 0.45, w * 0.22);
      g.addColorStop(0, 'rgba(255,190,60,0.95)'); g.addColorStop(1, 'rgba(255,160,40,0)');
      ctx.fillStyle = g;
      ctx.fillRect(bx - w * 0.22, -h * 0.45 - w * 0.22, w * 0.44, w * 0.44);
      ctx.globalCompositeOperation = 'source-over';
    }
    ctx.restore();
  }

  function roundRect(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // ---------------------------------------------------------------------------
  // Sky / skyline
  // ---------------------------------------------------------------------------
  let skyGrad = null, skyGradCtx = null, hazeGrad = null;
  function drawSky(ctx, bgOff, sunOff, t, hor, w) {
    w = w || W;
    if (skyGradCtx !== ctx || !skyGrad) {
      skyGradCtx = ctx;
      skyGrad = ctx.createLinearGradient(0, 0, 0, HOR);
      skyGrad.addColorStop(0, '#090A1F');
      skyGrad.addColorStop(0.42, '#1C1650');
      skyGrad.addColorStop(0.72, '#4A1B6C');
      skyGrad.addColorStop(0.9, '#A4306F');
      skyGrad.addColorStop(1, '#FF6D5C');
      hazeGrad = ctx.createLinearGradient(0, HOR - 40, 0, HOR + 60);
      hazeGrad.addColorStop(0, 'rgba(255,93,115,0)');
      hazeGrad.addColorStop(0.4, 'rgba(255,93,115,0.22)');
      hazeGrad.addColorStop(1, 'rgba(38,20,64,0)');
    }
    ctx.fillStyle = skyGrad;
    ctx.fillRect(0, 0, w, hor + 2);

    // stars
    ctx.fillStyle = '#ECEAFF';
    const so = ((bgOff * 0.12) % PERIOD + PERIOD) % PERIOD;
    for (let i = 0; i < STARS.length; i++) {
      const s = STARS[i];
      let x = s.x - so; if (x < 0) x += PERIOD;
      if (x > w) continue;
      ctx.globalAlpha = 0.35 + 0.35 * Math.sin(t * 1.7 + s.ph);
      ctx.fillRect(x, s.y, s.s, s.s);
    }
    ctx.globalAlpha = 1;

    // sun
    const sx = w / 2 + sunOff, sy = hor - 22, sr = 86;
    const glow = ctx.createRadialGradient(sx, sy, sr * 0.6, sx, sy, sr * 2.1);
    glow.addColorStop(0, 'rgba(255,120,110,0.45)');
    glow.addColorStop(1, 'rgba(255,90,140,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(sx - sr * 2.2, sy - sr * 2.2, sr * 4.4, sr * 2.2 + 22);
    ctx.save();
    ctx.beginPath();
    // stripes cut into the lower half of the sun
    const top = sy - sr;
    ctx.rect(sx - sr, top, sr * 2, sr * 1.02);
    const ph = (t * 6) % 12;
    for (let k = 0, y = sy - sr * 0.02; y < hor; k++) {
      const gap = 1.5 + k * 1.4;
      const band = 12 - k * 0.8;
      ctx.rect(sx - sr, y + ph * (band / 12), sr * 2, Math.max(2, band - gap));
      y += band;
    }
    ctx.clip();
    const sg = ctx.createLinearGradient(0, top, 0, hor);
    sg.addColorStop(0, '#FFE66B');
    sg.addColorStop(0.5, '#FFA24A');
    sg.addColorStop(1, '#FF3F7A');
    ctx.fillStyle = sg;
    ctx.beginPath(); ctx.arc(sx, sy, sr, 0, Math.PI * 2); ctx.fill();
    ctx.restore();

    // skyline layers
    drawSkyline(ctx, SKY_FAR, bgOff * 0.3, hor, '#2A1A56', t, w, false);
    drawSkyline(ctx, SKY_NEAR, bgOff * 0.55, hor, '#120C2B', t, w, true);

    ctx.fillStyle = hazeGrad;
    ctx.fillRect(0, hor - 40, w, 100);
  }

  function drawSkyline(ctx, L, off, hor, fill, t, w, near) {
    const o = ((off % PERIOD) + PERIOD) % PERIOD;
    for (let rep = -1; rep <= 1; rep++) {
      const ox = rep * PERIOD - o;
      if (ox > w || ox + PERIOD < 0) continue;
      ctx.fillStyle = fill;
      ctx.beginPath();
      for (let i = 0; i < L.blds.length; i++) {
        const b = L.blds[i];
        const x = ox + b.x;
        if (x > w || x + b.w < 0) continue;
        ctx.rect(x, hor - b.h, b.w, b.h + 2);
        if (b.step) ctx.rect(x + b.w * 0.25, hor - b.h - 8, b.w * 0.5, 9);
        if (b.ant) ctx.rect(x + b.w / 2 - 0.75, hor - b.h - 18, 1.5, 19);
      }
      ctx.fill();
      // windows
      for (let c = 0; c < L.colors.length; c++) {
        const arr = L.wins[c];
        ctx.fillStyle = L.colors[c];
        ctx.globalAlpha = near ? 0.75 : 0.5;
        ctx.beginPath();
        for (let i = 0; i < arr.length; i += 2) {
          const x = ox + arr[i];
          if (x < -3 || x > w) continue;
          ctx.rect(x, hor - arr[i + 1], 2, 3);
        }
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      if (near) {
        for (let i = 0; i < L.blds.length; i++) {
          const b = L.blds[i];
          const x = ox + b.x;
          if (x > w || x + b.w < 0) continue;
          if (b.neon) {
            ctx.fillStyle = b.neon === 1 ? '#3DDCFF' : '#FF5D73';
            ctx.fillRect(x, hor - b.h - (b.step ? 8 : 0), b.w, 1.5);
          }
          if (b.ant && Math.sin(t * 3 + b.x) > 0.2) {
            ctx.fillStyle = '#FF3355';
            ctx.fillRect(x + b.w / 2 - 1.25, hor - b.h - 20, 2.5, 2.5);
          }
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Endless track generator
  // ---------------------------------------------------------------------------
  function makeTrack() {
    let segs = [], base = 0, lastY = 0;
    function push(curve, y) {
      segs.push({ i: base + segs.length, curve, y1: lastY, y2: y, sign: 0 });
      lastY = y;
    }
    function road(enter, hold, leave, curve, dy) {
      const y0 = lastY, y1 = lastY + dy, tot = enter + hold + leave;
      const start = segs.length;
      let n = 0;
      for (let k = 0; k < enter; k++) push(easeIn(0, curve, k / enter), easeInOut(y0, y1, ++n / tot));
      for (let k = 0; k < hold; k++) push(curve, easeInOut(y0, y1, ++n / tot));
      for (let k = 0; k < leave; k++) push(easeInOut(curve, 0, k / leave), easeInOut(y0, y1, ++n / tot));
      if (Math.abs(curve) >= 2.4) {
        for (let k = start + 2; k < start + enter + Math.min(hold, 22); k += 8) segs[k].sign = curve > 0 ? 1 : -1;
      }
    }
    function gen() {
      const idx = base + segs.length;
      if (idx < 90) { road(0, 90, 0, 0, 0); return; }
      const r = Math.random();
      const L = () => 12 + Math.floor(Math.random() * 22);
      const dy = () => clamp((Math.random() * 2 - 1) * 1400 - lastY * 0.6, -1700, 1700);
      const c = () => (Math.random() < 0.5 ? -1 : 1) * rand(1.6, 4.4);
      if (r < 0.18) road(L(), 20 + Math.floor(Math.random() * 30), L(), 0, dy() * 0.5);
      else if (r < 0.62) road(L(), 25 + Math.floor(Math.random() * 35), L(), c(), Math.random() < 0.5 ? dy() : 0);
      else if (r < 0.84) { const cv = c(); road(L(), 22, L(), cv, 0); road(L(), 22, L(), -cv * rand(0.7, 1.1), dy() * 0.5); }
      else road(L(), 30, L(), 0, dy());
    }
    return {
      at(i) {
        if (i < base) i = base;
        while (i >= base + segs.length) gen();
        return segs[i - base];
      },
      prune(i) {
        const drop = i - base - 40;
        if (drop > 300) { segs.splice(0, drop); base += drop; }
      }
    };
  }

  // ---------------------------------------------------------------------------
  Arcade.register({
    id: 'neon-circuit',
    title: 'Neon Circuit',
    genre: 'Street racer',
    tagline: 'Thread midnight traffic at 220 km/h. Hit nitro for 320.',
    width: W, height: H,
    controls: ['← → steer · ↓ brake', 'Space / ↑ fire nitro', 'Skim past cars for bonus + nitro'],
    pad: ['left', 'right', 'down', 'action'],

    art(ctx, w, h, t) {
      const hor = Math.round(h * 0.5);
      ctx.save();
      // sky, sun, skyline (scaled so the big-scene drawing fits the card)
      ctx.save();
      const k = hor / HOR;
      ctx.scale(k, k);
      drawSky(ctx, t * 30, 0, t, HOR, w / k);
      ctx.restore();
      skyGrad = null; // gradient was built for card scale
      ctx.fillStyle = '#100E28';
      ctx.fillRect(0, hor, w, h - hor);
      // road
      const camH = 1000, F = 260, step = 180, N = 70;
      const phase = (t * 1800) % (step * 4);
      const bend = (z) => 0.000009 * z * z * Math.sin(t * 0.4 + 0.8);
      let prev = null;
      const pts = [];
      for (let i = N; i >= 0; i--) {
        const z = 200 + i * step - phase;
        const s = F / z;
        pts.push({ x: w / 2 + bend(z) * s, y: hor + camH * s, s, i });
      }
      for (let n = 0; n < pts.length; n++) {
        const p = pts[n];
        if (prev && p.y > prev.y) {
          const rw = 900;
          const grp = Math.floor(p.i / 2) % 2;
          quad(ctx, prev.x, prev.y, rw * 1.16 * prev.s, p.x, p.y + 1, rw * 1.16 * p.s, grp ? '#FF5D73' : '#EDE8FF');
          quad(ctx, prev.x, prev.y, rw * prev.s, p.x, p.y + 1, rw * p.s, grp ? '#1D1B3E' : '#211F46');
          if (grp) {
            quad(ctx, prev.x - rw * 0.33 * prev.s, prev.y, 14 * prev.s, p.x - rw * 0.33 * p.s, p.y + 1, 14 * p.s, '#8FF1FF');
            quad(ctx, prev.x + rw * 0.33 * prev.s, prev.y, 14 * prev.s, p.x + rw * 0.33 * p.s, p.y + 1, 14 * p.s, '#8FF1FF');
          }
        }
        prev = p;
      }
      // distance fog
      const fg = ctx.createLinearGradient(0, hor, 0, hor + 40);
      fg.addColorStop(0, 'rgba(60,26,90,0.9)'); fg.addColorStop(1, 'rgba(60,26,90,0)');
      ctx.fillStyle = fg; ctx.fillRect(0, hor, w, 40);
      // traffic ahead + player car
      drawCar(ctx, w / 2 - 38, hor + 34, 22, '#FFD23F', 'sedan', {});
      drawCar(ctx, w / 2 + 30, hor + 22, 13, '#B18CFF', 'van', {});
      drawCar(ctx, w / 2 + 6, h - 10, 92, '#34D6FF', 'coupe', { spoiler: true, accent: '#FF5D73', roll: Math.sin(t * 1.3) * 0.4 });
      ctx.restore();
    },

    create(host) {
      const P = host.palette;
      let track, pos, x, vx, speed, T, dist, bonus, nitro, boosting, cars, spawnT, hunterT;
      let crashed, crashT, crashDir, ended, roll, shake, flash, parts, floats, bgOff, sunOff;
      let idleT, impL, impR, lastScore, lastUpd, lastRT, offroad, boostAmt, nmStreak, nmT;
      const proj = [];
      for (let n = 0; n < DRAW; n++) proj.push({ x1: 0, y1: 0, w1: 0, x2: 0, y2: 0, w2: 0, s1: 0, s2: 0, z1: 0, seg: null, ok: false, cars: [] });

      function cruise() { return 9500 + Math.min(T, 150) * 35; }

      function makeCar(z, lx, hunter) {
        const r = Math.random();
        const type = hunter ? (r < 0.5 ? 'sedan' : 'coupe') : (r < 0.35 ? 'sedan' : r < 0.6 ? 'coupe' : r < 0.82 ? 'van' : 'truck');
        const spd = hunter ? rand(2800, 3900) : rand(3200, 5400) + Math.min(T, 120) * 10;
        return {
          z, x: lx, tx: lx, speed: spd, base: spd, type,
          hw: TYPES[type].w / 2 / ROADW,
          color: TRAFFIC_COLORS[Math.floor(Math.random() * TRAFFIC_COLORS.length)],
          hunter, nm: false, hit: false, prevRel: 1e9, blinkT: 0, lc: 0, braking: false
        };
      }
      function laneBusy(z, win) {
        const busy = [false, false, false];
        for (const c of cars) {
          if (Math.abs(c.z - z) < win) {
            busy[clamp(Math.round(c.x * 1.5) + 1, 0, 2)] = true;
            busy[clamp(Math.round(c.tx * 1.5) + 1, 0, 2)] = true;
          }
        }
        return busy;
      }
      function spawn(hunter) {
        const pz = pos + PZ;
        const z = pz + (hunter ? 30000 : rand(30000, 38000));
        const busy = laneBusy(z, 1800);
        const nBusy = busy.filter(Boolean).length;
        if (nBusy >= 2) return false;
        let lx;
        if (hunter) lx = clamp(x, -0.78, 0.78);
        else {
          const free = [0, 1, 2].filter((l) => !busy[l]);
          lx = (free[Math.floor(Math.random() * free.length)] - 1) * (2 / 3);
        }
        const li = clamp(Math.round(lx * 1.5) + 1, 0, 2);
        if (busy[li]) return false;
        cars.push(makeCar(z, lx, hunter));
        return true;
      }

      function reset() {
        track = makeTrack();
        pos = 0; x = 0; vx = 0; speed = 0; T = 0; dist = 0; bonus = 0; nitro = 0.5; boosting = false;
        cars = []; spawnT = 1.2; hunterT = 4.5;
        crashed = false; crashT = 0; crashDir = 1; ended = false; roll = 0; shake = 0; flash = 0;
        parts = []; floats = []; bgOff = 0; sunOff = 0; idleT = 0; impL = 0; impR = 0;
        lastScore = -1; lastUpd = -1; lastRT = host.time; offroad = false; boostAmt = 0; nmStreak = 0; nmT = 0;
        // a few cars already on the road
        const lanes = [-2 / 3, 2 / 3, 0, -2 / 3, 2 / 3];
        for (let i = 0; i < 5; i++) {
          const c = makeCar(PZ + 9000 + i * 5200 + rand(0, 1500), lanes[i], false);
          cars.push(c);
        }
        host.score(0);
      }

      function tryBoost() {
        if (crashed || boosting) return;
        if (nitro < 0.22) return;
        boosting = true;
        host.sfx('boost');
        for (let i = 0; i < 14; i++) {
          parts.push({ x: W / 2 + rand(-30, 30), y: CAR_Y - 6, vx: rand(-60, 60), vy: rand(40, 140), life: rand(0.25, 0.5), max: 0.5, c: i % 2 ? '#3DDCFF' : '#ECEAFF', k: 'spark', sz: 2 });
        }
      }

      function crash(car) {
        crashed = true; crashT = 0; flash = 1; shake = 1;
        crashDir = car.x > x ? -1 : 1;
        car.hit = true; car.speed += 1500; car.tx = clamp(car.x - crashDir * 0.35, -1.1, 1.1);
        boosting = false;
        host.sfx('hit');
        const cx = W / 2 + (car.x - x) * 60, cy = CAR_Y - 44;
        for (let i = 0; i < 46; i++) {
          const a = rand(0, Math.PI * 2), v = rand(120, 460);
          parts.push({ x: cx, y: cy, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 120, life: rand(0.35, 1), max: 1, c: ['#FFE66B', '#FFFFFF', '#FF9F43', '#FF5D73'][i % 4], k: 'spark', sz: rand(1.2, 2.4), g: 520 });
        }
        for (let i = 0; i < 10; i++) {
          parts.push({ x: cx + rand(-20, 20), y: cy + rand(-8, 8), vx: rand(-30, 30), vy: rand(-60, -20), life: rand(0.8, 1.4), max: 1.4, c: '#6A6390', k: 'smoke', sz: rand(8, 14) });
        }
      }

      function step(h) {
        T += h;
        const pz = pos + PZ;
        const pSeg = track.at(Math.floor(pz / SEG));
        const sp = speed / 12000;
        const cr = cruise();

        if (!crashed) {
          impL = Math.max(0, impL - h); impR = Math.max(0, impR - h);
          const L = host.held('left') || impL > 0, R = host.held('right') || impR > 0;
          const steer = (R ? 1 : 0) - (L ? 1 : 0);
          const brake = host.held('down');
          if (steer || brake || boosting) idleT = 0; else idleT += h;
          const tv = steer * 2.35 * clamp(speed / 9000, 0.3, 1.1);
          vx += (tv - vx) * Math.min(1, h * 10);
          x += vx * h;
          x -= h * sp * sp * pSeg.curve * 0.36; // centrifugal push to the outside
          x = clamp(x, -1.18, 1.18);
          roll += (steer - roll) * Math.min(1, h * 7);
          offroad = Math.abs(x) > 1.0;

          let target = boosting ? cr * 1.45 : cr;
          if (brake) target = 2600;
          if (offroad) target = Math.min(target, cr * 0.5);
          if (speed < target) speed = Math.min(target, speed + (boosting ? 9000 : 4200) * h);
          else speed = Math.max(target, speed - (brake ? 9500 : offroad ? 8000 : 3500) * h);

          if (boosting) {
            nitro -= h / 2.4;
            if (nitro <= 0 || brake) { nitro = Math.max(0, nitro); boosting = false; }
          } else nitro = Math.min(1, nitro + h * 0.045);

          dist += speed * h;
          if (offroad && speed > 1500 && Math.random() < h * 40) {
            const side = Math.random() < 0.5 ? -1 : 1;
            parts.push({ x: W / 2 + side * 36, y: CAR_Y - 2, vx: side * rand(10, 70), vy: rand(-90, -30), life: rand(0.25, 0.5), max: 0.5, c: Math.random() < 0.5 ? '#8A7FB0' : '#C9A56B', k: 'spark', sz: rand(1.5, 2.5), g: 300 });
          }
          shake = Math.max(shake, offroad && speed > 1500 ? 0.25 : 0);
        } else {
          crashT += h;
          speed = Math.max(0, speed - 15000 * h);
          if (crashT > 0.9 && !ended) { ended = true; host.gameOver(); }
        }
        pos += speed * h;
        boostAmt += ((boosting ? 1 : 0) - boostAmt) * Math.min(1, h * 5);

        // parallax
        bgOff += pSeg.curve * sp * h * 34;
        sunOff += pSeg.curve * sp * h * 10;
        sunOff -= sunOff * Math.min(1, h * 0.35);
        sunOff = clamp(sunOff, -120, 120);

        // spawning
        if (!crashed && speed > 2500) {
          spawnT -= h;
          if (spawnT <= 0) { spawn(false); spawnT = Math.max(0.42, 1.5 - T * 0.009) * rand(0.7, 1.3); }
          hunterT -= h;
          if (hunterT <= 0) { hunterT = spawn(true) ? Math.max(2.4, 4.2 - T * 0.015) : 0.4; }
        }

        // traffic
        const newPz = pos + PZ;
        const track_until = idleT > 5 ? 2400 : 6500;
        for (let i = 0; i < cars.length; i++) {
          const c = cars[i];
          const rel0 = c.z - newPz;
          if (c.hunter && !crashed && rel0 > track_until) c.tx = clamp(x, -0.78, 0.78);
          // occasional lane change later in the run
          if (!c.hunter && !c.hit && T > 35 && c.lc <= 0 && rel0 > 7000 && Math.random() < h * 0.06 * Math.min(2, T / 60)) {
            const nl = clamp(Math.round(c.tx * 1.5) + (Math.random() < 0.5 ? -1 : 1), -1, 1) * (2 / 3);
            const busy = laneBusy(c.z, 1500);
            if (!busy[Math.round(nl * 1.5) + 1] && busy.filter(Boolean).length < 2) { c.blinkT = 1.1; c.lc = 1; c.pending = nl; }
          }
          if (c.blinkT > 0) {
            c.blinkT -= h;
            if (c.blinkT <= 0 && c.pending != null) { c.tx = c.pending; c.pending = null; }
          }
          const d = c.tx - c.x;
          if (Math.abs(d) > 0.002) c.x += clamp(d, -0.55 * h, 0.55 * h);
          else c.lc = 0;
          // follow slower car ahead in same lane
          let sp2 = c.base;
          for (let j = 0; j < cars.length; j++) {
            if (j === i) continue;
            const o = cars[j];
            const dz = o.z - c.z;
            if (dz > 0 && dz < 1100 && Math.abs(o.x - c.x) < 0.5) sp2 = Math.min(sp2, o.speed - 200);
          }
          if (!c.hit) {
            c.braking = sp2 < c.speed - 50;
            c.speed += clamp(sp2 - c.speed, -5000 * h, 2500 * h);
          }
          c.z += c.speed * h;

          // collision / near miss
          const rel = c.z - newPz;
          if (!crashed && !c.hit) {
            const lim = (c.hw + P_HW) * 0.86;
            const dx = Math.abs(c.x - x);
            if (rel < 380 && rel > -320 && dx < lim) crash(c);
            else if (c.prevRel >= -320 && rel < -320 && !c.nm && dx < lim + 0.18 && speed > c.speed) {
              c.nm = true;
              bonus += 50;
              nitro = Math.min(1, nitro + 0.22);
              nmStreak = nmT > 0 ? nmStreak + 1 : 1; nmT = 2.5;
              host.sfx('coin');
              floats.push({ x: W / 2 + (c.x < x ? -46 : 46), y: CAR_Y - 70, t: 0, txt: '+50', sub: nmStreak > 1 ? 'NEAR MISS x' + nmStreak : 'NEAR MISS' });
            }
          }
          c.prevRel = rel;
        }
        nmT = Math.max(0, nmT - h);
        for (let i = cars.length - 1; i >= 0; i--) {
          const rel = cars[i].z - newPz;
          if (rel < -PZ - 800 || rel > 60000) cars.splice(i, 1);
        }
        track.prune(Math.floor(pos / SEG));

        if (!crashed) {
          const sc = Math.floor(dist * UNIT_M * 0.5) + bonus;
          if (sc !== lastScore) { lastScore = sc; host.score(sc); }
        }
      }

      function update(dt) {
        lastUpd = host.time;
        let rem = dt;
        while (rem > 1e-6) {
          const h = Math.min(rem, 1 / 120);
          step(h);
          rem -= h;
        }
      }

      function fx(dt) {
        for (let i = parts.length - 1; i >= 0; i--) {
          const p = parts[i];
          p.life -= dt;
          if (p.life <= 0) { parts.splice(i, 1); continue; }
          p.vy += (p.g || 0) * dt;
          p.x += p.vx * dt; p.y += p.vy * dt;
          if (p.k === 'smoke') p.sz += dt * 18;
        }
        for (let i = floats.length - 1; i >= 0; i--) {
          floats[i].t += dt;
          if (floats[i].t > 1.1) floats.splice(i, 1);
        }
        flash = Math.max(0, flash - dt * 3);
        shake = Math.max(0, shake - dt * 2.5);
      }

      // ---------------- rendering ----------------
      function fogAt(z) {
        const f = clamp((z - FOG_START) / (FOG_END - FOG_START), 0, 1);
        return f * (2 - f) * 0.92;
      }

      function drawLamp(ctx, sx, sy, s, side, fog) {
        const hgt = 2500 * s, arm = 560 * s;
        const pw = Math.max(0.8, 55 * s);
        ctx.globalAlpha = 1 - fog;
        ctx.strokeStyle = '#2C2856';
        ctx.lineWidth = pw;
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(sx, sy - hgt);
        ctx.stroke();
        ctx.strokeStyle = '#211E45';
        ctx.lineWidth = Math.max(0.7, pw * 0.55);
        ctx.beginPath();
        ctx.moveTo(sx, sy - hgt + pw);
        ctx.quadraticCurveTo(sx, sy - hgt - 110 * s, sx - side * arm, sy - hgt - 90 * s);
        ctx.stroke();
        const lx = sx - side * arm, ly = sy - hgt - 70 * s;
        ctx.fillStyle = '#FFE3F6';
        ctx.fillRect(lx - 80 * s, ly - 12 * s, 160 * s, Math.max(1, 26 * s));
        ctx.globalCompositeOperation = 'lighter';
        const r = Math.max(3, 520 * s);
        const g = ctx.createRadialGradient(lx, ly, 0, lx, ly, r);
        g.addColorStop(0, 'rgba(255,140,220,0.55)');
        g.addColorStop(0.35, 'rgba(255,90,190,0.16)');
        g.addColorStop(1, 'rgba(255,80,180,0)');
        ctx.fillStyle = g;
        ctx.fillRect(lx - r, ly - r, r * 2, r * 2);
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 1;
      }

      function drawSign(ctx, sx, sy, s, dir, fog, t) {
        const bw = 470 * s, bh = 250 * s, lift = 230 * s;
        if (bw < 3) return;
        ctx.globalAlpha = 1 - fog;
        ctx.fillStyle = '#2A2650';
        const pw = Math.max(1, 30 * s);
        ctx.fillRect(sx - bw * 0.32, sy - lift, pw, lift);
        ctx.fillRect(sx + bw * 0.32 - pw, sy - lift, pw, lift);
        ctx.fillStyle = '#120E2C';
        ctx.fillRect(sx - bw / 2, sy - lift - bh, bw, bh);
        ctx.strokeStyle = 'rgba(255,210,63,0.35)';
        ctx.lineWidth = Math.max(0.6, 10 * s);
        ctx.strokeRect(sx - bw / 2, sy - lift - bh, bw, bh);
        const on = Math.sin(t * 8) > -0.6;
        const cy = sy - lift - bh / 2;
        for (let pass = 0; pass < (bw > 12 ? 2 : 1); pass++) {
          ctx.strokeStyle = pass === 0 && bw > 12 ? 'rgba(255,210,63,0.25)' : on ? '#FFD23F' : '#8A6E1F';
          ctx.lineWidth = Math.max(1, (pass === 0 && bw > 12 ? 60 : 26) * s);
          ctx.beginPath();
          for (let k = -1; k <= 1; k++) {
            const cx = sx + k * bw * 0.28;
            ctx.moveTo(cx - dir * bw * 0.07, cy - bh * 0.28);
            ctx.lineTo(cx + dir * bw * 0.07, cy);
            ctx.lineTo(cx - dir * bw * 0.07, cy + bh * 0.28);
          }
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
      }

      function quadRoad(ctx, x1, y1, w1, x2, y2, w2, col) {
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.moveTo(x1 - w1, y1);
        ctx.lineTo(x1 + w1, y1);
        ctx.lineTo(x2 + w2, y2);
        ctx.lineTo(x2 - w2, y2);
        ctx.closePath();
        ctx.fill();
      }
      function strip(ctx, pr, off, half) {
        // adds a longitudinal strip (normalised offset / half width) to the current path
        const x1 = pr.x1 + off * pr.w1, w1 = half * pr.w1, x2 = pr.x2 + off * pr.w2, w2 = half * pr.w2;
        ctx.moveTo(x1 - w1, pr.y1 + 1);
        ctx.lineTo(x1 + w1, pr.y1 + 1);
        ctx.lineTo(x2 + w2, pr.y2);
        ctx.lineTo(x2 - w2, pr.y2);
        ctx.closePath();
      }

      function render(ctx) {
        const now = host.time;
        const rdt = clamp(now - lastRT, 0, 0.05);
        lastRT = now;
        if (crashed || now - lastUpd < 0.12) fx(rdt);
        const t = now;

        ctx.save();
        if (shake > 0) ctx.translate(rand(-1, 1) * shake * (crashed ? 6 : 2), rand(-1, 1) * shake * (crashed ? 5 : 1.5));

        drawSky(ctx, bgOff, sunOff, t, HOR);
        ctx.fillStyle = '#26143F';
        ctx.fillRect(-8, HOR, W + 16, H - HOR + 8);

        // ---- project ----
        const baseIdx = Math.floor(pos / SEG);
        const basePct = (pos % SEG) / SEG;
        const pz = pos + PZ;
        const pSeg = track.at(Math.floor(pz / SEG));
        const pPct = (pz % SEG) / SEG;
        const playerY = lerp(pSeg.y1, pSeg.y2, pPct);
        const camY = playerY + CAMH;
        const camX = x * ROADW;
        let cx = 0, dx = -(track.at(baseIdx).curve * basePct) * CURVE_K;
        for (let n = 0; n < DRAW; n++) {
          const seg = track.at(baseIdx + n);
          const pr = proj[n];
          pr.seg = seg;
          pr.cars.length = 0;
          const z1 = seg.i * SEG - pos, z2 = z1 + SEG;
          pr.z1 = z1;
          const ok = z1 > 60;
          if (ok) {
            const s1 = FOCAL / z1, s2 = FOCAL / z2;
            pr.s1 = s1; pr.s2 = s2;
            pr.x1 = W / 2 + (cx - camX) * s1;
            pr.x2 = W / 2 + (cx + dx - camX) * s2;
            pr.y1 = HOR + (camY - seg.y1) * s1;
            pr.y2 = HOR + (camY - seg.y2) * s2;
            pr.w1 = ROADW * s1; pr.w2 = ROADW * s2;
          }
          pr.ok = ok;
          cx += dx;
          dx += seg.curve * CURVE_K;
        }
        // bucket traffic into segments
        const behind = [];
        for (const c of cars) {
          const n = Math.floor(c.z / SEG) - baseIdx;
          if (c.z < pz) { if (c.z - pos > 300) behind.push(c); continue; }
          if (n >= 0 && n < DRAW) proj[n].cars.push(c);
        }

        // ---- draw far -> near ----
        for (let n = DRAW - 1; n >= 0; n--) {
          const pr = proj[n];
          if (!pr.ok) continue;
          const seg = pr.seg;
          const fog = fogAt(pr.z1);
          if (pr.y2 < pr.y1 && pr.y2 < H + 2) {
            const grp = Math.floor(seg.i / RUMBLE) % 2;
            const li = seg.i % LAMP_EVERY;
            const pool = li <= 2 || li >= LAMP_EVERY - 2 ? (li === 0 ? 1 : li === 1 || li === LAMP_EVERY - 1 ? 0.7 : 0.35) : 0;
            // ground
            ctx.fillStyle = grp ? '#100E28' : '#131031';
            ctx.fillRect(-8, pr.y2, W + 16, pr.y1 - pr.y2 + 1);
            // synth grid rails on the ground
            if (pr.w1 > 0.8 && fog < 0.8) {
              ctx.fillStyle = 'rgba(155,70,255,0.35)';
              ctx.beginPath();
              for (let g = 2; g <= 6; g++) {
                const gx = g === 2 ? 2.1 : g * 1.3;
                strip(ctx, pr, -gx, 0.022);
                strip(ctx, pr, gx, 0.022);
              }
              ctx.fill();
              if (seg.i % 8 === 0) {
                ctx.fillStyle = 'rgba(155,70,255,0.28)';
                ctx.fillRect(-8, pr.y2, W + 16, Math.max(0.6, (pr.y1 - pr.y2) * 0.35));
              }
            }
            // rumble
            quadRoad(ctx, pr.x1, pr.y1 + 1, pr.w1 * 1.13, pr.x2, pr.y2, pr.w2 * 1.13, grp ? '#FF5D73' : '#EDE8FF');
            // asphalt (brighter under the streetlights)
            quadRoad(ctx, pr.x1, pr.y1 + 1, pr.w1, pr.x2, pr.y2, pr.w2,
              pool ? (pool > 0.9 ? '#2E2356' : pool > 0.5 ? '#28204C' : '#221D44') : (grp ? '#1B1A3A' : '#1E1C3F'));
            // neon edge lines
            ctx.fillStyle = '#3DDCFF';
            ctx.beginPath();
            strip(ctx, pr, -0.985, 0.022);
            strip(ctx, pr, 0.985, 0.022);
            ctx.fill();
            if (grp && fog < 0.9) {
              ctx.fillStyle = '#A9F3FF';
              ctx.beginPath();
              strip(ctx, pr, -1 / 3, 0.02);
              strip(ctx, pr, 1 / 3, 0.02);
              ctx.fill();
            }
            if (fog > 0.01) {
              ctx.fillStyle = 'rgba(38,20,64,' + fog.toFixed(3) + ')';
              ctx.fillRect(-8, pr.y2, W + 16, pr.y1 - pr.y2 + 1);
            }
          }
          // sprites on this segment: roadside first, then cars (far->near)
          const midZ = pr.z1 + SEG * 0.5;
          if (midZ > 500) {
            const sx0 = (pr.x1 + pr.x2) / 2, sy0 = (pr.y1 + pr.y2) / 2, s0 = (pr.s1 + pr.s2) / 2;
            if (seg.i % LAMP_EVERY === 0) {
              drawLamp(ctx, sx0 - 1.45 * ROADW * s0, sy0, s0, -1, fog);
              drawLamp(ctx, sx0 + 1.45 * ROADW * s0, sy0, s0, 1, fog);
            }
            if (seg.sign) {
              // chevrons on the outside of the bend
              const side = -seg.sign;
              drawSign(ctx, sx0 + side * 1.6 * ROADW * s0, sy0, s0, seg.sign, fog, t);
            }
          }
          if (pr.cars.length) {
            pr.cars.sort((a, b) => b.z - a.z);
            for (const c of pr.cars) drawTraffic(ctx, c, pr, t);
          }
        }

        // ---- player ----
        drawPlayer(ctx, t);
        for (const c of behind) {
          const n = Math.floor(c.z / SEG) - baseIdx;
          if (n >= 0 && n < DRAW && proj[n].ok) drawTraffic(ctx, c, proj[n], t);
        }

        // particles
        ctx.globalCompositeOperation = 'lighter';
        for (const p of parts) {
          const a = clamp(p.life / (p.max * 0.6), 0, 1);
          if (p.k === 'smoke') continue;
          ctx.strokeStyle = p.c;
          ctx.globalAlpha = a;
          ctx.lineWidth = p.sz;
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(p.x - p.vx * 0.03, p.y - p.vy * 0.03);
          ctx.stroke();
        }
        ctx.globalCompositeOperation = 'source-over';
        for (const p of parts) {
          if (p.k !== 'smoke') continue;
          ctx.globalAlpha = clamp(p.life / p.max, 0, 1) * 0.45;
          ctx.fillStyle = p.c;
          ctx.beginPath(); ctx.arc(p.x, p.y, p.sz, 0, 7); ctx.fill();
        }
        ctx.globalAlpha = 1;

        // speed lines while boosting
        if (boostAmt > 0.05) {
          ctx.globalCompositeOperation = 'lighter';
          ctx.strokeStyle = 'rgba(160,240,255,' + (0.28 * boostAmt).toFixed(3) + ')';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          for (let i = 0; i < 14; i++) {
            let a = rand(-0.35, 0.9); // left/right flanks only, never across the car
            if (i % 2) a = Math.PI - a;
            const r0 = rand(200, 280), r1 = r0 + rand(40, 100);
            const vx0 = W / 2, vy0 = HOR + 24;
            ctx.moveTo(vx0 + Math.cos(a) * r0, vy0 + Math.sin(a) * r0);
            ctx.lineTo(vx0 + Math.cos(a) * r1, vy0 + Math.sin(a) * r1);
          }
          ctx.stroke();
          const vg = ctx.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, H * 0.7);
          vg.addColorStop(0, 'rgba(61,220,255,0)');
          vg.addColorStop(1, 'rgba(61,220,255,' + (0.22 * boostAmt).toFixed(3) + ')');
          ctx.fillStyle = vg;
          ctx.fillRect(0, 0, W, H);
          ctx.globalCompositeOperation = 'source-over';
        }

        // floating bonus text
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        for (const f of floats) {
          const k = f.t / 1.1;
          const y = f.y - k * 50;
          ctx.globalAlpha = k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3;
          const sc = k < 0.12 ? 0.6 + k / 0.12 * 0.5 : 1.1 - Math.min(0.1, (k - 0.12));
          ctx.save();
          ctx.translate(f.x, y);
          ctx.scale(sc, sc);
          ctx.font = '22px ' + DISP;
          ctx.fillStyle = P.coral;
          ctx.fillText(f.txt, 2, 2);
          ctx.fillStyle = P.marquee;
          ctx.fillText(f.txt, 0, 0);
          ctx.font = '600 10px ' + MONO;
          ctx.fillStyle = P.text;
          ctx.fillText(f.sub, 0, 17);
          ctx.restore();
        }
        ctx.globalAlpha = 1;
        ctx.restore(); // shake

        // crash flash
        if (flash > 0) {
          ctx.fillStyle = 'rgba(255,240,245,' + (flash * 0.75).toFixed(3) + ')';
          ctx.fillRect(0, 0, W, H);
        }
        drawHud(ctx, t);
      }

      function drawTraffic(ctx, c, pr, t) {
        const zc = c.z - pos;
        if (zc < 300) return;
        const pct = clamp((c.z % SEG) / SEG, 0, 1);
        const s = FOCAL / zc;
        const rx = lerp(pr.x1, pr.x2, pct);
        const wy = lerp(pr.seg.y1, pr.seg.y2, pct);
        const pzv = pos + PZ;
        const pSeg = track.at(Math.floor(pzv / SEG));
        const camY = lerp(pSeg.y1, pSeg.y2, (pzv % SEG) / SEG) + CAMH;
        const sy = HOR + (camY - wy) * s;
        const sx = rx + c.x * ROADW * s;
        const w = TYPES[c.type].w * s;
        const fog = fogAt(zc);
        const blink = (c.blinkT > 0 || (c.hunter && Math.abs(c.tx - c.x) > 0.08)) && Math.sin(t * 14) > 0
          ? Math.sign((c.pending != null ? c.pending : c.tx) - c.x) || 0 : 0;
        drawCar(ctx, sx, sy, w, c.color, c.type, {
          alpha: 1 - fog * 0.85,
          brake: c.braking || c.hit,
          blink,
          rot: c.hit ? Math.sin(t * 20) * 0.05 : 0
        });
      }

      function drawPlayer(ctx, t) {
        const sp = speed / 12000;
        let bob = Math.sin(t * 31) * 0.5 * Math.min(1, sp);
        if (offroad && !crashed && speed > 1000) bob += rand(-1.5, 1.5);
        const w = PLAYER_W * FOCAL / PZ;
        let rot = roll * 0.025;
        let ox = 0;
        if (crashed) {
          const k = Math.min(1, crashT / 0.6);
          rot = crashDir * (1 - (1 - k) * (1 - k)) * 0.42 + Math.sin(crashT * 30) * 0.03 * (1 - k);
          ox = crashDir * k * 18;
        }
        const by = CAR_Y + bob;
        // exhaust flames
        if (boostAmt > 0.05 && !crashed) {
          ctx.save();
          ctx.globalCompositeOperation = 'lighter';
          for (const side of [-1, 1]) {
            const ex = W / 2 + side * w * 0.3, ey = by - w * 0.56 * 0.16;
            const len = (18 + Math.random() * 14) * boostAmt;
            const g = ctx.createRadialGradient(ex, ey + len * 0.3, 0, ex, ey + len * 0.3, len);
            g.addColorStop(0, 'rgba(230,250,255,0.95)');
            g.addColorStop(0.35, 'rgba(61,220,255,0.7)');
            g.addColorStop(1, 'rgba(90,80,255,0)');
            ctx.fillStyle = g;
            ctx.beginPath();
            ctx.ellipse(ex, ey + len * 0.35, 5 + 2 * boostAmt, len * 0.7, 0, 0, Math.PI * 2);
            ctx.fill();
          }
          ctx.restore();
        }
        // underglow on the road
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        const ug = ctx.createRadialGradient(W / 2 + ox, by, 4, W / 2 + ox, by, w * 0.75);
        ug.addColorStop(0, 'rgba(61,220,255,0.35)');
        ug.addColorStop(1, 'rgba(61,220,255,0)');
        ctx.fillStyle = ug;
        ctx.beginPath();
        ctx.ellipse(W / 2 + ox, by, w * 0.75, w * 0.16, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        drawCar(ctx, W / 2 + ox, by, w, '#34D6FF', 'coupe', {
          roll: crashed ? 0 : roll,
          rot,
          brake: host.held('down') && !crashed,
          spoiler: true,
          accent: P.coral
        });
      }

      function drawHud(ctx, t) {
        // speedometer
        const gx = 50, gy = 620, r = 32;
        const kmh = Math.round(speed * KMH);
        const frac = clamp(speed / 21000, 0, 1);
        ctx.lineCap = 'round';
        ctx.lineWidth = 4;
        ctx.strokeStyle = 'rgba(13,15,34,0.75)';
        ctx.beginPath(); ctx.arc(gx, gy, r, Math.PI, Math.PI * 2); ctx.stroke();
        ctx.strokeStyle = 'rgba(46,51,102,0.95)';
        ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(gx, gy, r, Math.PI, Math.PI * 2); ctx.stroke();
        if (frac > 0.005) {
          const g = ctx.createLinearGradient(gx - r, 0, gx + r, 0);
          g.addColorStop(0, P.cyan); g.addColorStop(0.7, P.marquee); g.addColorStop(1, P.coral);
          ctx.strokeStyle = g;
          ctx.beginPath(); ctx.arc(gx, gy, r, Math.PI, Math.PI + Math.PI * frac); ctx.stroke();
        }
        ctx.lineCap = 'butt';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'alphabetic';
        ctx.font = '600 19px ' + MONO;
        ctx.fillStyle = 'rgba(8,8,24,0.7)';
        ctx.fillText(String(kmh), gx + 1, gy - 5);
        ctx.fillStyle = P.text;
        ctx.fillText(String(kmh), gx, gy - 6);
        ctx.font = '600 8px ' + MONO;
        ctx.fillStyle = 'rgba(8,8,24,0.85)';
        ctx.fillText('KM/H', gx + 1, gy + 6);
        ctx.fillStyle = P.muted;
        ctx.fillText('KM/H', gx, gy + 5);

        // nitro bar
        const bx = 250, by = 610, bw = 96, bh = 9, nSeg = 10;
        ctx.textAlign = 'right';
        ctx.font = '600 9px ' + MONO;
        const ready = nitro >= 0.22 && !boosting;
        const lbl = boosting ? 'NITRO!' : ready ? 'NITRO READY' : 'NITRO';
        ctx.fillStyle = 'rgba(8,8,24,0.85)';
        ctx.fillText(lbl, bx + bw + 1, by - 4);
        ctx.fillStyle = boosting ? P.cyan : ready ? (Math.sin(t * 6) > 0 ? P.cyan : P.text) : P.muted;
        ctx.fillText(boosting ? 'NITRO!' : ready ? 'NITRO READY' : 'NITRO', bx + bw, by - 5);
        ctx.fillStyle = 'rgba(13,15,34,0.75)';
        ctx.fillRect(bx - 2, by - 2, bw + 4, bh + 4);
        const segW = (bw - (nSeg - 1) * 2) / nSeg;
        for (let i = 0; i < nSeg; i++) {
          const f = clamp(nitro * nSeg - i, 0, 1);
          const sx = bx + i * (segW + 2);
          ctx.fillStyle = '#2E3366';
          ctx.fillRect(sx, by, segW, bh);
          if (f > 0) {
            ctx.fillStyle = boosting ? (i % 2 ? '#A9F3FF' : P.cyan) : P.cyan;
            ctx.fillRect(sx, by, segW * f, bh);
          }
        }
        if (boosting || nitro >= 0.999) {
          ctx.save();
          ctx.globalCompositeOperation = 'lighter';
          ctx.fillStyle = 'rgba(61,220,255,0.18)';
          ctx.fillRect(bx - 4, by - 4, bw + 8, bh + 8);
          ctx.restore();
        }
      }

      return {
        reset,
        update,
        render,
        onAction(a) {
          if (a === 'action' || a === 'up') tryBoost();
          else if (a === 'left') impL = 0.12;
          else if (a === 'right') impR = 0.12;
        },
        onRelease() {},
        destroy() { cars = []; parts = []; floats = []; }
      };
    }
  });

  // module-level helper used by art()
  function quad(ctx, x1, y1, w1, x2, y2, w2, col) {
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.moveTo(x1 - w1, y1);
    ctx.lineTo(x1 + w1, y1);
    ctx.lineTo(x2 + w2, y2);
    ctx.lineTo(x2 - w2, y2);
    ctx.closePath();
    ctx.fill();
  }
})();
