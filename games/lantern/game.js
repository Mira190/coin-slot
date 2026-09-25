(function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // Lantern Drift — a paper lantern rises through bamboo gates over a night lake.
  // ---------------------------------------------------------------------------
  const W = 360, H = 640, WATER = 566, LX = 112;
  const GRAV = 1150, FLAP = -345, MAXFALL = 560, GATE_W = 54, SPACING = 232, R_HIT = 13.5;

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const rnd = (a, b) => a + Math.random() * (b - a);
  const hash = (n) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

  // static starfield (deterministic)
  const STARS = [];
  for (let i = 0; i < 80; i++) STARS.push({ x: hash(i * 1.37) * 720, y: Math.pow(hash(i * 2.91), 1.4) * 430, s: 0.6 + hash(i * 5.3) * 1.5, p: hash(i * 7.7) * 6.28 });

  function hillY(x, layer) {
    if (layer === 0) return 470 - 34 - 26 * Math.sin(x * 0.006 + 1) - 14 * Math.sin(x * 0.017 + 2) - 6 * Math.sin(x * 0.041);
    return 520 - 20 - 22 * Math.sin(x * 0.009 + 4) - 12 * Math.sin(x * 0.023 + 1) - 5 * Math.sin(x * 0.06 + 3);
  }

  // ---------------------------------------------------------------------------
  // Scenery (shared by the game and the card art; drawn in 360-wide space)
  // ---------------------------------------------------------------------------
  function drawSky(ctx, t, scroll, w, h, water) {
    const g = ctx.createLinearGradient(0, 0, 0, water);
    g.addColorStop(0, '#080A1E'); g.addColorStop(0.45, '#15163E'); g.addColorStop(0.8, '#2E2260'); g.addColorStop(1, '#4A2A66');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, water);

    // stars
    const off = scroll * 0.03;
    ctx.fillStyle = '#ECEAFF';
    for (const s of STARS) {
      let x = (s.x - off) % 720; if (x < 0) x += 720;
      if (x > w + 2) continue;
      ctx.globalAlpha = 0.35 + 0.45 * (0.5 + 0.5 * Math.sin(t * 1.8 + s.p));
      ctx.fillRect(x, s.y, s.s, s.s);
    }
    ctx.globalAlpha = 1;

    // moon
    const mx = w * 0.74, my = 118;
    const mg = ctx.createRadialGradient(mx, my, 20, mx, my, 150);
    mg.addColorStop(0, 'rgba(236,234,255,0.30)'); mg.addColorStop(0.4, 'rgba(160,150,255,0.08)'); mg.addColorStop(1, 'rgba(120,100,220,0)');
    ctx.fillStyle = mg; ctx.fillRect(mx - 150, my - 150, 300, 300);
    ctx.fillStyle = '#F4EFD8';
    ctx.beginPath(); ctx.arc(mx, my, 32, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(180,170,200,0.35)';
    ctx.beginPath(); ctx.arc(mx - 10, my - 8, 7, 0, Math.PI * 2); ctx.arc(mx + 11, my + 6, 5, 0, Math.PI * 2); ctx.arc(mx - 2, my + 15, 4, 0, Math.PI * 2); ctx.arc(mx + 14, my - 13, 3, 0, Math.PI * 2); ctx.fill();
    // a thin cloud across the moon
    ctx.fillStyle = 'rgba(46,34,96,0.55)';
    ctx.beginPath(); ctx.ellipse(mx - 6 + Math.sin(t * 0.1) * 10, my + 18, 58, 6, 0, 0, Math.PI * 2); ctx.fill();

    // far hills with a pagoda
    const o0 = scroll * 0.12;
    ctx.fillStyle = '#231E4E';
    ctx.beginPath(); ctx.moveTo(0, water);
    for (let x = 0; x <= w + 8; x += 8) ctx.lineTo(x, hillY(x + o0, 0));
    ctx.lineTo(w + 8, water); ctx.closePath(); ctx.fill();
    const period = 820, px0 = 260 - (o0 % period);
    for (let k = -1; k <= 1; k++) {
      const px = px0 + k * period; if (px < -60 || px > w + 60) continue;
      const base = hillY(px + o0, 0) + 4;
      ctx.fillStyle = '#231E4E';
      for (let i = 0; i < 4; i++) {
        const tw = 34 - i * 7, ty = base - 12 - i * 13;
        ctx.fillRect(px - tw / 2 + 4, ty, tw - 8, 13);
        ctx.beginPath(); ctx.moveTo(px - tw / 2 - 5, ty + 3); ctx.quadraticCurveTo(px, ty - 6, px + tw / 2 + 5, ty + 3); ctx.lineTo(px + tw / 2 - 2, ty); ctx.lineTo(px - tw / 2 + 2, ty); ctx.closePath(); ctx.fill();
      }
      ctx.fillRect(px - 1, base - 70, 2, 14);
      ctx.fillStyle = 'rgba(255,190,90,0.8)';
      ctx.fillRect(px - 2, base - 22, 4, 5); ctx.fillRect(px - 2, base - 35, 4, 4);
    }

    // drifting sky lanterns in the distance
    for (let i = 0; i < 9; i++) {
      const sp = 8 + hash(i) * 10;
      let x = (hash(i * 3.3) * 520 - scroll * (0.15 + hash(i * 1.9) * 0.1)) % 520; if (x < 0) x += 520; x -= 40;
      let y = (hash(i * 5.7) * 500 - t * sp) % 500; if (y < 0) y += 500; y = y * 0.9 + 20;
      if (y > water - 60) continue;
      const s = 1.4 + hash(i * 9.1) * 1.6, fl = 0.8 + 0.2 * Math.sin(t * 6 + i);
      ctx.globalCompositeOperation = 'lighter';
      const sg = ctx.createRadialGradient(x, y, 0, x, y, s * 4);
      sg.addColorStop(0, 'rgba(255,170,80,' + (0.35 * fl).toFixed(3) + ')'); sg.addColorStop(1, 'rgba(255,120,60,0)');
      ctx.fillStyle = sg; ctx.fillRect(x - s * 4, y - s * 4, s * 8, s * 8);
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = 'rgba(255,196,110,' + (0.9 * fl).toFixed(3) + ')';
      ctx.beginPath(); ctx.ellipse(x, y, s * 0.8, s * 1.1, 0, 0, Math.PI * 2); ctx.fill();
    }

    // near hills
    const o1 = scroll * 0.3;
    ctx.fillStyle = '#141236';
    ctx.beginPath(); ctx.moveTo(0, water);
    for (let x = 0; x <= w + 8; x += 8) ctx.lineTo(x, hillY(x + o1, 1));
    ctx.lineTo(w + 8, water); ctx.closePath(); ctx.fill();
    // tree tufts on the near hills
    ctx.fillStyle = '#141236';
    for (let i = -1; i < 12; i++) {
      const bx = i * 40 - (o1 % 40), id = i + Math.floor(o1 / 40);
      if (hash(id) < 0.45) continue;
      const by = hillY(bx + o1, 1) + 3, th = 10 + hash(id * 2) * 16;
      ctx.beginPath(); ctx.moveTo(bx - 6, by); ctx.lineTo(bx, by - th); ctx.lineTo(bx + 6, by); ctx.closePath(); ctx.fill();
    }
    // mist on the shore
    const mist = ctx.createLinearGradient(0, water - 50, 0, water);
    mist.addColorStop(0, 'rgba(120,100,200,0)'); mist.addColorStop(1, 'rgba(120,100,200,0.22)');
    ctx.fillStyle = mist; ctx.fillRect(0, water - 50, w, 50);
  }

  function drawWater(ctx, t, scroll, w, h, water, moonX) {
    const g = ctx.createLinearGradient(0, water, 0, h);
    g.addColorStop(0, '#1B1848'); g.addColorStop(1, '#070818');
    ctx.fillStyle = g; ctx.fillRect(0, water, w, h - water);
    // shoreline highlight
    ctx.fillStyle = 'rgba(160,150,255,0.25)'; ctx.fillRect(0, water, w, 1.5);
    // moon path
    for (let i = 0; i < 12; i++) {
      const y = water + 5 + i * 6;
      if (y > h) break;
      const ww = 34 - i * 1.6 + Math.sin(t * 2.1 + i * 1.3) * 6;
      ctx.fillStyle = 'rgba(244,239,216,' + (0.36 - i * 0.022).toFixed(3) + ')';
      ctx.fillRect(moonX - ww / 2 + Math.sin(t * 1.4 + i) * 4, y, ww, 1.6);
    }
    // ripples drifting with the scroll
    ctx.fillStyle = 'rgba(120,120,230,0.22)';
    for (let i = 0; i < 22; i++) {
      const y = water + 6 + hash(i * 3.1) * (h - water - 8);
      let x = (hash(i * 7.3) * 460 - scroll * (0.5 + (y - water) / 120)) % 460; if (x < 0) x += 460; x -= 50;
      ctx.fillRect(x, y, 10 + 18 * hash(i), 1.2);
    }
  }

  // Bamboo stalk: columns of poles from y0 to y1; cutEnd = 'top' | 'bottom' (the end at the gap)
  function drawStalk(ctx, x, w, y0, y1, cutEnd, seed, t) {
    if (y1 - y0 < 1) return;
    const poles = [[0, w * 0.44, 0], [w * 0.4, w * 0.36, 1], [w * 0.7, w * 0.3, 2]];
    for (const [ox, pw, k] of poles) {
      const px = x + ox;
      // ends of the three poles are staggered a little
      const stagger = [0, 12, 5][k] + hash(seed + k) * 6;
      let a = y0, b = y1;
      if (cutEnd === 'bottom') b -= stagger; else a += stagger;
      const g = ctx.createLinearGradient(px, 0, px + pw, 0);
      g.addColorStop(0, '#0F3326'); g.addColorStop(0.3, '#2C7650'); g.addColorStop(0.5, '#4AA874'); g.addColorStop(0.62, '#3A9064'); g.addColorStop(1, '#123E2C');
      ctx.fillStyle = g;
      ctx.fillRect(px, a, pw, b - a);
      // nodes, aligned from the cut end
      const endY = cutEnd === 'bottom' ? b : a, dir = cutEnd === 'bottom' ? -1 : 1;
      const seg = 40 + k * 4;
      for (let ny = endY + dir * (22 + k * 7); dir > 0 ? ny < b : ny > a; ny += dir * seg) {
        ctx.fillStyle = '#123A28'; ctx.fillRect(px - 1, ny - 1.5, pw + 2, 3);
        ctx.fillStyle = 'rgba(150,230,180,0.45)'; ctx.fillRect(px, ny + 1.5, pw, 1.2);
      }
      // slanted cut showing the hollow
      const ey = cutEnd === 'bottom' ? b : a;
      const sl = 7 * (cutEnd === 'bottom' ? 1 : -1);
      ctx.fillStyle = '#E8D9A0';
      ctx.beginPath(); ctx.ellipse(px + pw / 2, ey + sl * 0.2, pw / 2, 3.2, (cutEnd === 'bottom' ? 0.22 : -0.22), 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#6A5A30';
      ctx.beginPath(); ctx.ellipse(px + pw / 2, ey + sl * 0.2, pw / 2 - 2.5, 1.8, (cutEnd === 'bottom' ? 0.22 : -0.22), 0, Math.PI * 2); ctx.fill();
    }
    // rope binding near the gap
    const ry = cutEnd === 'bottom' ? y1 - 34 : y0 + 34;
    ctx.fillStyle = '#C8384E'; ctx.fillRect(x - 2, ry - 3, w + 4, 6);
    ctx.fillStyle = '#FF5D73'; ctx.fillRect(x - 2, ry - 3, w + 4, 2);
    // leaves
    ctx.fillStyle = '#2F8A58';
    for (let i = 0; i < 3; i++) {
      const ly = cutEnd === 'bottom' ? y1 - 70 - i * 90 : y0 + 70 + i * 90;
      if (ly < y0 + 10 || ly > y1 - 10) continue;
      const side = (i + seed) & 1 ? 1 : -1, lx = side > 0 ? x + w : x;
      const sw = Math.sin(t * 2 + i + seed) * 0.12;
      ctx.save(); ctx.translate(lx, ly); ctx.rotate(side * (0.5 + sw)); ctx.scale(side, 1);
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.quadraticCurveTo(12, -6, 26, -1); ctx.quadraticCurveTo(12, 3, 0, 0); ctx.fill();
      ctx.rotate(0.45); ctx.beginPath(); ctx.moveTo(0, 0); ctx.quadraticCurveTo(10, -5, 20, -1); ctx.quadraticCurveTo(10, 3, 0, 0); ctx.fill();
      ctx.restore();
    }
  }

  function drawLantern(ctx, x, y, ang, t, bright, tassel) {
    const fl = 0.85 + 0.1 * Math.sin(t * 19) + 0.06 * Math.sin(t * 31 + 1.3);
    // big warm glow
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const gr = ctx.createRadialGradient(x, y, 6, x, y, 120 * fl);
    gr.addColorStop(0, 'rgba(255,170,80,' + (0.42 * bright).toFixed(3) + ')');
    gr.addColorStop(0.35, 'rgba(255,110,70,' + (0.14 * bright).toFixed(3) + ')');
    gr.addColorStop(1, 'rgba(255,80,60,0)');
    ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(x, y, 120 * fl, 0, Math.PI * 2); ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.translate(x, y); ctx.rotate(ang);
    // tassel (lags behind the motion)
    ctx.strokeStyle = '#C8384E'; ctx.lineWidth = 1.5;
    const tx = Math.sin(tassel) * 7, ty = 36;
    ctx.beginPath(); ctx.moveTo(0, 22); ctx.quadraticCurveTo(tx * 0.3, 28, tx, ty); ctx.stroke();
    ctx.fillStyle = '#FF5D73';
    ctx.beginPath(); ctx.moveTo(tx - 3, ty); ctx.lineTo(tx + 3, ty); ctx.lineTo(tx + 2, ty + 9); ctx.lineTo(tx - 2, ty + 9); ctx.closePath(); ctx.fill();
    // hanging loop
    ctx.strokeStyle = '#3A2418'; ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.arc(0, -25, 5, Math.PI, 0); ctx.stroke();
    // caps
    ctx.fillStyle = '#3A2418';
    ctx.beginPath(); ctx.moveTo(-11, -18); ctx.lineTo(11, -18); ctx.lineTo(9, -24); ctx.lineTo(-9, -24); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(-9, 18); ctx.lineTo(9, 18); ctx.lineTo(7, 23); ctx.lineTo(-7, 23); ctx.closePath(); ctx.fill();
    // paper body
    const b = bright;
    const pg = ctx.createRadialGradient(0, 4, 2, 0, 0, 24);
    pg.addColorStop(0, b > 0.5 ? '#FFF2B8' : '#C89060');
    pg.addColorStop(0.45, b > 0.5 ? '#FFB050' : '#A05A38');
    pg.addColorStop(1, b > 0.5 ? '#E4483C' : '#6A2A2A');
    ctx.fillStyle = pg;
    ctx.beginPath();
    ctx.moveTo(-10, -19);
    ctx.bezierCurveTo(-24, -14, -24, 14, -9, 19);
    ctx.lineTo(9, 19);
    ctx.bezierCurveTo(24, 14, 24, -14, 10, -19);
    ctx.closePath(); ctx.fill();
    // ribs
    ctx.strokeStyle = 'rgba(150,40,30,0.45)'; ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, -19); ctx.lineTo(0, 19);
    ctx.moveTo(-6, -19); ctx.quadraticCurveTo(-12, 0, -5.5, 19);
    ctx.moveTo(6, -19); ctx.quadraticCurveTo(12, 0, 5.5, 19);
    ctx.moveTo(-18, -8); ctx.quadraticCurveTo(0, -5, 18, -8);
    ctx.moveTo(-18.5, 7); ctx.quadraticCurveTo(0, 10, 18.5, 7);
    ctx.stroke();
    // painted crane-wing motif
    ctx.strokeStyle = 'rgba(180,40,50,0.55)'; ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.arc(0, 1, 6.5, 0, Math.PI * 2); ctx.stroke();
    // flame
    if (b > 0.2) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = 'rgba(255,240,180,' + (0.7 * b).toFixed(3) + ')';
      ctx.beginPath(); ctx.ellipse(0, 8, 3.4, 6 * fl, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,' + (0.6 * b).toFixed(3) + ')';
      ctx.beginPath(); ctx.ellipse(0, 9, 1.6, 3 * fl, 0, 0, Math.PI * 2); ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
    }
    // rim highlight
    ctx.strokeStyle = 'rgba(255,230,180,0.5)'; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(-8, -15); ctx.bezierCurveTo(-18, -11, -19, 4, -14, 11); ctx.stroke();
    ctx.restore();
  }

  // ---------------------------------------------------------------------------
  // Card art (320 x 200)
  // ---------------------------------------------------------------------------
  function art(ctx, w, h, t) {
    ctx.save();
    ctx.scale(w / 320, h / 200);
    // sky: reuse the scene at a smaller scale, cropped
    ctx.save();
    ctx.scale(0.5, 0.5);
    ctx.translate(0, -165);
    drawSky(ctx, t, t * 40, 640, 600, 530);
    ctx.restore();
    const water = 170;
    ctx.save(); ctx.scale(1, 1);
    drawWater(ctx, t, t * 40, 320, 200, water, 236);
    ctx.restore();
    // gates
    const gx = 196 - ((t * 30) % 140);
    for (let k = 0; k < 3; k++) {
      const x = gx + k * 140; if (x > 330) continue;
      const cy = [90, 110, 80][k], gap = 78;
      ctx.save(); ctx.translate(x, 0); ctx.scale(0.6, 1); ctx.translate(-x, 0);
      drawStalk(ctx, x, 54, -10, cy - gap / 2, 'bottom', k, t);
      drawStalk(ctx, x, 54, cy + gap / 2, water + 10, 'top', k + 5, t);
      ctx.restore();
    }
    const ly = 100 + Math.sin(t * 2.2) * 8;
    drawLantern(ctx, 96, ly, Math.sin(t * 1.6) * 0.08, t, 1, Math.sin(t * 2.6) * 0.6);
    // lantern reflection
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 7; i++) {
      ctx.fillStyle = 'rgba(255,150,70,' + (0.35 - i * 0.045).toFixed(3) + ')';
      const ww = 16 - i + Math.sin(t * 3 + i) * 3;
      ctx.fillRect(96 - ww / 2 + Math.sin(t * 2 + i * 1.7) * 3, water + 4 + i * 4, ww, 1.6);
    }
    ctx.globalCompositeOperation = 'source-over';
    const vg = ctx.createRadialGradient(160, 100, 90, 160, 100, 210);
    vg.addColorStop(0, 'rgba(13,15,34,0)'); vg.addColorStop(1, 'rgba(13,15,34,0.5)');
    ctx.fillStyle = vg; ctx.fillRect(0, 0, 320, 200);
    ctx.restore();
  }

  // ---------------------------------------------------------------------------
  // Game
  // ---------------------------------------------------------------------------
  function create(host) {
    let st;

    function reset() {
      st = {
        y: 300, vy: 0, ang: 0, started: false, t: 0, scroll: 0, score: 0, speed: 150,
        gates: [], parts: [], texts: [], dead: false, deathT: 0, deathKind: '', overSent: false,
        flash: 0, shake: 0, tassel: 0, tasselV: 0, lastGapY: 300, puff: 0
      };
      // first gate's leading edge reaches the lantern ~1.5 s after the run starts
      addGate(LX + R_HIT + 2 + st.speed * 1.5, true);
      host.score(0);
    }

    function difficulty() {
      const s = st.score;
      return {
        gap: Math.max(132, 196 - s * 2.3),
        speed: Math.min(215, 150 + s * 1.6),
        bobChance: s < 5 ? 0 : Math.min(0.65, 0.22 + (s - 5) * 0.03),
        bobAmp: Math.min(56, 22 + s * 1.1)
      };
    }

    function addGate(x, first) {
      const d = difficulty();
      const bob = !first && Math.random() < d.bobChance;
      const amp = bob ? d.bobAmp * rnd(0.7, 1) : 0;
      const lo = 70 + d.gap / 2 + amp, hi = WATER - 56 - d.gap / 2 - amp;
      let cy = first ? 300 : clamp(st.lastGapY + rnd(-150, 150), lo, hi);
      cy = clamp(cy, lo, hi);
      st.lastGapY = cy;
      st.gates.push({ x, cy, gap: d.gap, amp, w: rnd(0.9, 1.5), ph: Math.random() * 6.28, passed: false, seed: (Math.random() * 50) | 0 });
    }
    function gapY(g) { return g.cy + (g.amp ? Math.sin(st.t * g.w + g.ph) * g.amp : 0); }

    function burst(x, y, n, cols, sp, up, life, size, grav) {
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2, v = sp * (0.25 + Math.random() * 0.75);
        st.parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - up, g: grav == null ? 500 : grav, life: life * (0.6 + Math.random() * 0.4), max: life, size: size * (0.6 + Math.random() * 0.7), col: cols[(Math.random() * cols.length) | 0] });
      }
    }

    function flap() {
      if (st.dead) return;
      st.vy = FLAP;
      st.tasselV += 5;
      host.sfx('flap');
      st.puff = 1;
      burst(LX, st.y + 22, 4, ['rgba(255,200,120,0.8)', 'rgba(255,140,80,0.7)'], 50, -40, 0.45, 2.2, -60);
    }

    function die(kind) {
      if (st.dead) return;
      st.dead = true; st.deathKind = kind; st.deathT = 0; st.flash = 1; st.shake = 1;
      host.sfx('hit');
      if (kind === 'water') {
        burst(LX, WATER, 26, ['#ECEAFF', '#3DDCFF', '#9AB8FF'], 260, 180, 0.7, 3, 900);
        st.vy = 0;
      } else {
        burst(LX, st.y, 30, ['#FFD23F', '#FF9A4A', '#FF5D73', '#FFF1A8'], 280, 60, 0.8, 3.2, 600);
        st.vy = Math.max(st.vy, 60);
      }
    }

    function onAction(a) {
      if (a === 'action' || a === 'up') {
        if (!st.started) begin();
        flap();
      }
    }

    function begin() {
      st.started = true;
      st.y = 300 + Math.sin(host.time * 2.2) * 7;
    }

    function update(dt) {
      const s = st;
      if (!s.started) { begin(); flap(); }
      s.flash = Math.max(0, s.flash - dt * 3.2);
      s.shake = Math.max(0, s.shake - dt * 3.5);
      s.puff = Math.max(0, s.puff - dt * 4);

      for (let i = s.parts.length - 1; i >= 0; i--) {
        const p = s.parts[i];
        p.life -= dt; if (p.life <= 0) { s.parts.splice(i, 1); continue; }
        p.vy += p.g * dt; p.x += p.vx * dt; p.y += p.vy * dt;
      }
      for (let i = s.texts.length - 1; i >= 0; i--) { const tx = s.texts[i]; tx.life -= dt; tx.y -= 40 * dt; if (tx.life <= 0) s.texts.splice(i, 1); }

      // tassel spring
      s.tasselV += (-s.tassel * 40 - s.vy * 0.02 - s.tasselV * 4) * dt;
      s.tassel += s.tasselV * dt;

      if (s.dead) {
        s.deathT += dt;
        if (s.deathKind !== 'water') {
          s.vy = Math.min(MAXFALL, s.vy + GRAV * dt);
          s.y = Math.min(WATER - 6, s.y + s.vy * dt);
          s.ang += dt * 3;
        }
        if (s.deathT >= 0.42 && !s.overSent) { s.overSent = true; host.gameOver(); }
        return;
      }

      s.t += dt;
      const d = difficulty();
      s.speed = lerp(s.speed, d.speed, 1 - Math.exp(-dt * 2));
      const dx = s.speed * dt;
      s.scroll += dx;

      // lantern physics
      s.vy = Math.min(MAXFALL, s.vy + GRAV * dt);
      s.y += s.vy * dt;
      const targetAng = clamp(s.vy / 1300, -0.28, 0.38);
      s.ang += (targetAng - s.ang) * (1 - Math.exp(-dt * 10));

      // gates
      for (const g of s.gates) g.x -= dx;
      if (s.gates.length && s.gates[0].x < -GATE_W - 10) s.gates.shift();
      const last = s.gates[s.gates.length - 1];
      if (!last || last.x < W + 10) addGate((last ? last.x : W) + SPACING, false);

      // collisions
      if (s.y - 20 < 0) { s.y = 20; die('top'); return; }
      if (s.y + 17 > WATER) { s.y = WATER - 17; die('water'); return; }
      for (const g of s.gates) {
        if (g.x > LX + R_HIT || g.x + GATE_W < LX - R_HIT) {
          if (!g.passed && g.x + GATE_W < LX - R_HIT) {
            g.passed = true; s.score++;
            host.score(s.score); host.sfx('coin');
            s.texts.push({ x: LX + 26, y: s.y - 20, life: 0.8, txt: '+1' });
            burst(g.x + GATE_W / 2, gapY(g), 10, ['#FFD23F', '#5CF2A5', '#FFF1A8'], 140, 40, 0.55, 2.5, 150);
          }
          continue;
        }
        const gy = gapY(g), top = gy - g.gap / 2, bot = gy + g.gap / 2;
        // circle vs the two rectangles
        const nx = clamp(LX, g.x, g.x + GATE_W);
        const hitTop = (() => { const ny = Math.min(s.y, top); const ddx = LX - nx, ddy = s.y - ny; return s.y < top || ddx * ddx + ddy * ddy < R_HIT * R_HIT; })();
        const hitBot = (() => { const ny = Math.max(s.y, bot); const ddx = LX - nx, ddy = s.y - ny; return s.y > bot || ddx * ddx + ddy * ddy < R_HIT * R_HIT; })();
        if (hitTop || hitBot) { die('stalk'); return; }
      }
    }

    function render(ctx) {
      const s = st, t = host.time;
      ctx.save();
      if (s.shake > 0) ctx.translate((Math.random() - 0.5) * 8 * s.shake, (Math.random() - 0.5) * 8 * s.shake);
      drawSky(ctx, t, s.scroll, W, H, WATER);
      const moonX = W * 0.74;
      drawWater(ctx, t, s.scroll, W, H, WATER, moonX);

      // lantern y (hover bob before the run starts)
      const ly = s.started ? s.y : 300 + Math.sin(t * 2.2) * 7;
      const ang = s.started ? s.ang : Math.sin(t * 1.6) * 0.06;
      const tas = s.started ? s.tassel : Math.sin(t * 2.6) * 0.5;

      // reflections of stalks in the water
      for (const g of s.gates) {
        if (g.x > W || g.x + GATE_W < 0) continue;
        const bot = gapY(g) + g.gap / 2;
        const len = Math.min(H - WATER, (WATER - bot) * 0.5);
        if (len <= 0) continue;
        ctx.fillStyle = 'rgba(40,120,80,0.22)';
        for (let yy = 0; yy < len; yy += 4) {
          const wob = Math.sin(t * 3 + yy * 0.3 + g.seed) * 2.5;
          ctx.fillRect(g.x + wob, WATER + 2 + yy, GATE_W, 2);
        }
      }
      // lantern reflection on the water
      const bright = s.dead ? Math.max(0.15, 1 - s.deathT * 2) : 1;
      const near = clamp(1 - (WATER - ly) / 420, 0.25, 1);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < 12; i++) {
        const a = (0.4 - i * 0.03) * near * bright;
        if (a <= 0) break;
        ctx.fillStyle = 'rgba(255,150,70,' + a.toFixed(3) + ')';
        const ww = 26 - i * 1.3 + Math.sin(t * 3 + i) * 5;
        ctx.fillRect(LX - ww / 2 + Math.sin(t * 2.3 + i * 1.7) * 4, WATER + 4 + i * 5.5, ww, 1.8);
      }
      ctx.restore();

      // gates
      for (const g of s.gates) {
        if (g.x > W + 4 || g.x + GATE_W < -4) continue;
        const gy = gapY(g);
        drawStalk(ctx, g.x, GATE_W, -12, gy - g.gap / 2, 'bottom', g.seed, t);
        drawStalk(ctx, g.x, GATE_W, gy + g.gap / 2, WATER + 6, 'top', g.seed + 7, t);
        if (g.amp) {
          // bobbing gates wear a small mint charm so they read as "moving"
          const sw = Math.sin(t * 3 + g.seed) * 0.25;
          for (const [cy2, dir] of [[gy - g.gap / 2 - 34, 1], [gy + g.gap / 2 + 34, -1]]) {
            ctx.save(); ctx.translate(g.x - 2, cy2); ctx.rotate(sw);
            ctx.strokeStyle = '#FF5D73'; ctx.lineWidth = 1.2;
            ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, 9 * dir); ctx.stroke();
            ctx.fillStyle = '#5CF2A5'; ctx.fillRect(-4, dir > 0 ? 9 : -21, 8, 12);
            ctx.fillStyle = 'rgba(13,15,34,0.5)'; ctx.fillRect(-2, dir > 0 ? 12 : -18, 4, 1.2); ctx.fillRect(-2, dir > 0 ? 15 : -15, 4, 1.2);
            ctx.restore();
          }
        }
        // water ring where the stalk meets the lake
        ctx.strokeStyle = 'rgba(160,170,255,0.35)'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.ellipse(g.x + GATE_W / 2, WATER + 3, GATE_W * 0.7 + Math.sin(t * 2 + g.seed) * 3, 3, 0, 0, Math.PI * 2); ctx.stroke();
      }

      // warm light from the lantern spilling onto the stalks
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const lg = ctx.createRadialGradient(LX, ly, 10, LX, ly, 170);
      lg.addColorStop(0, 'rgba(255,140,60,' + (0.16 * bright).toFixed(3) + ')'); lg.addColorStop(1, 'rgba(255,120,60,0)');
      ctx.fillStyle = lg; ctx.fillRect(LX - 170, ly - 170, 340, 340);
      ctx.restore();

      drawLantern(ctx, LX, ly, ang, t, bright, tas);

      // particles
      for (const p of s.parts) {
        ctx.globalAlpha = clamp(p.life / p.max, 0, 1);
        ctx.fillStyle = p.col;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalAlpha = 1;

      // floating +1
      ctx.font = '700 18px Rubik, system-ui, sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      for (const tx of s.texts) {
        ctx.globalAlpha = clamp(tx.life / 0.8, 0, 1);
        ctx.fillStyle = '#FFD23F';
        ctx.fillText(tx.txt, tx.x, tx.y);
      }
      ctx.globalAlpha = 1;

      if (s.flash > 0) {
        ctx.fillStyle = 'rgba(255,93,115,' + (0.4 * s.flash).toFixed(3) + ')';
        ctx.fillRect(0, 0, W, H);
      }
      ctx.restore();

      // big in-world score
      if (s.started) {
        ctx.save();
        ctx.font = '400 44px Bungee, Impact, "Arial Black", system-ui, sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'top';
        ctx.fillStyle = 'rgba(13,15,34,0.55)';
        ctx.fillText(String(s.score), W / 2 + 3, 40 + 3);
        ctx.fillStyle = '#ECEAFF';
        ctx.fillText(String(s.score), W / 2, 40);
        ctx.restore();
      }
    }

    reset();
    return { reset, update, render, onAction };
  }

  Arcade.register({
    id: 'lantern',
    title: 'Lantern Drift',
    genre: 'One-tap flyer',
    tagline: 'Keep one small flame aloft through the bamboo night.',
    width: 360, height: 640,
    controls: ['Space, ↑ or tap to lift', 'Slip through the bamboo gaps', 'Mind the lake and the sky'],
    pad: ['action'],
    art,
    create
  });
})();
