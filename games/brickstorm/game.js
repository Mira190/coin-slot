(function () {
  'use strict';

  const PAL = { ink: '#0D0F22', cab: '#171A36', cab2: '#20244A', line: '#2E3366', text: '#ECEAFF', muted: '#A3A2CC', marquee: '#FFD23F', coral: '#FF5D73', cyan: '#3DDCFF', mint: '#5CF2A5' };
  const FONT_D = "'Bungee', Impact, 'Arial Black', sans-serif";
  const FONT_M = "'IBM Plex Mono', ui-monospace, Menlo, Consolas, monospace";
  const FONT_B = "'Rubik', system-ui, -apple-system, 'Segoe UI', sans-serif";

  const W = 400, H = 600;
  const HUD = 40, FL = 10, FR = 390, FT = 50;          // playfield bounds
  const COLS = 10, CW = (FR - FL) / COLS, CH = 18, BY0 = FT + 34;
  const PY = 548, PH = 12, PW = 76, PW_WIDE = 120;      // paddle
  const R = 6;                                          // ball radius
  const MAX_BALLS = 8, AUTO_LAUNCH = 2.5;
  const MIN_ELEV = 0.33;   // min angle from horizontal (rad, ~19°)
  const MIN_TILT = 0.1;    // min angle from vertical (rad, ~6°)

  const ROW_COLORS = [PAL.coral, '#FF9A3D', PAL.marquee, PAL.mint, PAL.cyan, '#6E8BFF', '#FF7BC8'];
  const TOUGH = '#9467FF';
  const STEEL = '#8B91BC';

  // '1' normal · '2' tough · '#' steel · '.' empty
  const LEVELS = [
    { name: 'Opening Act', rows: [
      '2222222222',
      '1111111111',
      '1111111111',
      '1111111111',
      '1111111111',
      '1111111111'
    ] },
    { name: 'Pyramid', rows: [
      '....22....',
      '...2112...',
      '..111111..',
      '.11111111.',
      '1111111111',
      '2111111112',
      '..........',
      '.#......#.'
    ] },
    { name: 'Twin Towers', rows: [
      '22......22',
      '11#....#11',
      '1111..1111',
      '1221..1221',
      '1111..1111',
      '1111..1111',
      '2222..2222'
    ] },
    { name: 'Checkpoint', rows: [
      '1.1.1.1.1.',
      '.2.2.2.2.2',
      '1.1.1.1.1.',
      '.2.2.2.2.2',
      '1.1.1.1.1.',
      '.1.1.1.1.1',
      '..........',
      '##..##..##'
    ] },
    { name: 'Gold Coin', rows: [
      '...2222...',
      '..211112..',
      '.21111112.',
      '.21122112.',
      '.21122112.',
      '.21111112.',
      '..211112..',
      '...2222...'
    ] }
  ];

  const CAPS = {
    wide: { label: 'W', name: 'WIDE', col: PAL.mint, w: 3 },
    multi: { label: 'M', name: 'MULTI', col: PAL.cyan, w: 3 },
    slow: { label: 'S', name: 'SLOW', col: PAL.marquee, w: 2 },
    life: { label: '+1', name: '+1 LIFE', col: PAL.coral, w: 1 }
  };

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  function rr(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // ---------- shared drawing ----------
  function drawBrick(ctx, x, y, w, h, kind, col, hp, flash, cracks) {
    if (kind === 'steel') {
      rr(ctx, x, y, w, h, 3); ctx.fillStyle = '#5A6090'; ctx.fill();
      rr(ctx, x + 1, y + 1, w - 2, h - 2, 2); ctx.fillStyle = STEEL; ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.fillRect(x + 2, y + 1.5, w - 4, 2);
      ctx.fillStyle = 'rgba(0,0,0,0.22)'; ctx.fillRect(x + 2, y + h - 3.5, w - 4, 2);
      // diagonal sheen
      ctx.fillStyle = 'rgba(255,255,255,0.22)';
      ctx.beginPath(); ctx.moveTo(x + w * 0.35, y + 1); ctx.lineTo(x + w * 0.5, y + 1); ctx.lineTo(x + w * 0.38, y + h - 1); ctx.lineTo(x + w * 0.23, y + h - 1); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#3E4370';
      const bs = 1.6;
      ctx.beginPath();
      ctx.arc(x + 4, y + 4.5, bs, 0, 6.3); ctx.arc(x + w - 4, y + 4.5, bs, 0, 6.3);
      ctx.moveTo(x + 4 + bs, y + h - 4.5); ctx.arc(x + 4, y + h - 4.5, bs, 0, 6.3);
      ctx.moveTo(x + w - 4 + bs, y + h - 4.5); ctx.arc(x + w - 4, y + h - 4.5, bs, 0, 6.3);
      ctx.fill();
    } else if (kind === 'tough') {
      rr(ctx, x, y, w, h, 3); ctx.fillStyle = '#4B2E9E'; ctx.fill();
      rr(ctx, x + 1, y + 1, w - 2, h - 2, 2); ctx.fillStyle = hp > 1 ? TOUGH : '#7A55D6'; ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.18)'; ctx.fillRect(x + 1, y + 1, w - 2, (h - 2) * 0.45);
      ctx.strokeStyle = 'rgba(230,220,255,0.75)'; ctx.lineWidth = 1;
      ctx.strokeRect(x + 3.5, y + 3.5, w - 7, h - 7);
      if (hp <= 1 && cracks) {
        ctx.strokeStyle = 'rgba(25,10,60,0.85)'; ctx.lineWidth = 1.3;
        ctx.beginPath();
        cracks.forEach((ln) => { ctx.moveTo(x + ln[0] * w, y + ln[1] * h); for (let i = 2; i < ln.length; i += 2) ctx.lineTo(x + ln[i] * w, y + ln[i + 1] * h); });
        ctx.stroke();
      }
    } else {
      rr(ctx, x, y, w, h, 3); ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.fill();
      rr(ctx, x + 0.5, y + 0.5, w - 1, h - 1, 3); ctx.fillStyle = col; ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.2)'; ctx.fillRect(x + 1.5, y + 1.5, w - 3, (h - 3) * 0.45);
      ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.fillRect(x + 3, y + 2, w - 6, 1.5);
      ctx.fillStyle = 'rgba(0,0,0,0.2)'; ctx.fillRect(x + 1.5, y + h - 3.5, w - 3, 2);
    }
    if (flash > 0) { rr(ctx, x, y, w, h, 3); ctx.fillStyle = 'rgba(255,255,255,' + (flash * 0.85).toFixed(3) + ')'; ctx.fill(); }
  }
  function drawPaddle(ctx, x, y, w, h, squash) {
    const sy = 1 - squash * 0.25, sx = 1 + squash * 0.06;
    const pw = w * sx, ph = h * sy, px = x - pw / 2, py = y + (h - ph);
    // glow
    const g = ctx.createRadialGradient(x, py + ph / 2, 2, x, py + ph / 2, pw * 0.7);
    g.addColorStop(0, 'rgba(255,93,115,0.28)'); g.addColorStop(1, 'rgba(255,93,115,0)');
    ctx.fillStyle = g; ctx.fillRect(x - pw * 0.7, py - pw * 0.4, pw * 1.4, pw * 0.8);
    rr(ctx, px, py, pw, ph, ph / 2); ctx.fillStyle = '#A8364A'; ctx.fill();
    rr(ctx, px, py, pw, ph - 2, (ph - 2) / 2); ctx.fillStyle = PAL.coral; ctx.fill();
    // end caps
    ctx.fillStyle = PAL.cyan;
    rr(ctx, px, py, 12, ph - 2, (ph - 2) / 2); ctx.fill();
    rr(ctx, px + pw - 12, py, 12, ph - 2, (ph - 2) / 2); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    rr(ctx, px + 8, py + 2, pw - 16, 2.5, 1.2); ctx.fill();
    ctx.fillStyle = PAL.marquee; ctx.fillRect(x - 1, py + 3, 2, ph - 6);
  }
  function drawBall(ctx, x, y, r, tint) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createRadialGradient(x, y, 0, x, y, r * 3.2);
    g.addColorStop(0, tint === 'slow' ? 'rgba(255,210,63,0.55)' : 'rgba(61,220,255,0.55)');
    g.addColorStop(1, 'rgba(61,220,255,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r * 3.2, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    ctx.fillStyle = '#FFFFFF'; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = tint === 'slow' ? PAL.marquee : '#BDF3FF'; ctx.beginPath(); ctx.arc(x + r * 0.25, y + r * 0.3, r * 0.55, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#FFFFFF'; ctx.beginPath(); ctx.arc(x - r * 0.3, y - r * 0.3, r * 0.3, 0, Math.PI * 2); ctx.fill();
  }
  function drawBackdrop(ctx, w, h, top) {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#1B1848'); g.addColorStop(0.6, '#121436'); g.addColorStop(1, PAL.ink);
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(140,150,255,0.05)'; ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0.5; x < w; x += 20) { ctx.moveTo(x, top); ctx.lineTo(x, h); }
    for (let y = top + 0.5; y < h; y += 20) { ctx.moveTo(0, y); ctx.lineTo(w, y); }
    ctx.stroke();
  }

  // ---------- thumbnail ----------
  function art(ctx, w, h, t) {
    drawBackdrop(ctx, w, h, 0);
    const cols = 8, bw = 36, bh = 14, x0 = (w - cols * bw) / 2, y0 = 18;
    const map = ['22222222', '11111111', '1111.111', '11#11..1', '1.111.11'];
    map.forEach((row, r) => {
      const ci = Math.max(0, r - 1);
      for (let c = 0; c < cols; c++) {
        const ch = row[c]; if (ch === '.') continue;
        const kind = ch === '#' ? 'steel' : ch === '2' ? 'tough' : 'normal';
        drawBrick(ctx, x0 + c * bw + 1, y0 + r * bh + 1, bw - 2, bh - 2, kind, ROW_COLORS[ci], 2, 0, null);
      }
    });
    // ball bouncing on a looping path
    const cyc = 2.4, p = ((t + 0.6) % cyc) / cyc;
    const tri = p < 0.5 ? p * 2 : 2 - p * 2;          // 0..1..0
    const bx = 70 + p * 180, by = 172 - tri * 72;
    // trail
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    for (let i = 8; i >= 1; i--) {
      const q = ((t + 0.6 - i * 0.025) % cyc + cyc) % cyc / cyc, tq = q < 0.5 ? q * 2 : 2 - q * 2;
      ctx.fillStyle = 'rgba(61,220,255,' + (0.28 * (1 - i / 9)).toFixed(3) + ')';
      ctx.beginPath(); ctx.arc(70 + q * 180, 172 - tq * 72, 6 * (1 - i / 14), 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
    // sparks near the wall
    const sparkCols = [PAL.marquee, PAL.coral, PAL.mint];
    for (let i = 0; i < 9; i++) {
      const a = i * 0.7 + 0.4, d = 10 + (i % 3) * 7;
      ctx.fillStyle = sparkCols[i % 3];
      ctx.fillRect(208 + Math.cos(a) * d, 86 + Math.sin(a) * d * 0.7, 3, 3);
    }
    // capsule
    rr(ctx, 250, 118, 30, 13, 6.5); ctx.fillStyle = PAL.mint; ctx.fill();
    ctx.font = '11px ' + FONT_D; ctx.fillStyle = PAL.ink; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('W', 265, 125);
    drawBall(ctx, bx, by, 6);
    drawPaddle(ctx, clamp(bx, 50, 270), 180, 76, 11, 0);
  }

  // ---------- game ----------
  function create(host) {
    let stage, lives, score, bricks, breakable, balls, caps, parts, texts, paddle;
    let wideT, slowT, slowMul, stageT, stuckT, clearT, shake, redFlash, over, bannerT, shakeT = 0;

    function addScore(n) { score += n; host.score(score); }
    function levelDef() { return LEVELS[stage % LEVELS.length]; }
    function loopN() { return Math.floor(stage / LEVELS.length); }
    function baseSpeed() { return (330 + 16 * (stage % LEVELS.length)) * Math.pow(1.12, loopN()); }
    function speed() { return baseSpeed() * (1 + Math.min(0.2, stageT * 0.004)) * slowMul; }

    function makeCracks() {
      const out = [];
      const cx = 0.3 + Math.random() * 0.4;
      out.push([cx, 0, cx + 0.06, 0.35, cx - 0.04, 0.6, cx + 0.03, 1]);
      out.push([cx + 0.06, 0.35, cx + 0.22, 0.5, cx + 0.3, 0.8]);
      out.push([cx - 0.04, 0.6, cx - 0.2, 0.45]);
      return out;
    }
    function loadStage() {
      const L = levelDef();
      bricks = []; breakable = 0;
      let ci = -1;
      L.rows.forEach((row, r) => {
        if (row.indexOf('1') >= 0) ci++;
        for (let c = 0; c < COLS; c++) {
          const ch = row[c]; if (!ch || ch === '.') continue;
          const kind = ch === '#' ? 'steel' : ch === '2' ? 'tough' : 'normal';
          bricks.push({ x: FL + c * CW + 1, y: BY0 + r * CH + 1, w: CW - 2, h: CH - 2, kind, hp: kind === 'tough' ? 2 : 1, col: ROW_COLORS[Math.max(0, ci) % ROW_COLORS.length], flash: 0, alive: true, cracks: kind === 'tough' ? makeCracks() : null, pop: 0 });
          if (kind !== 'steel') breakable++;
        }
      });
      caps = []; stageT = 0; wideT = 0; slowT = 0; bannerT = 2.2;
      resetBall();
    }
    function resetBall() {
      balls = [{ x: paddle.x, y: PY - R - 0.5, vx: 0, vy: 0, stuck: true, trail: [], since: 0 }];
      stuckT = 0;
    }
    function launch() {
      const sp = speed();
      balls.forEach((b) => {
        if (!b.stuck) return;
        let a = clamp(paddle.vx / 1400, -0.45, 0.45) + (Math.random() - 0.5) * 0.35;
        if (Math.abs(a) < 0.12) a = a < 0 ? -0.12 : 0.12;
        b.vx = Math.sin(a) * sp; b.vy = -Math.cos(a) * sp; b.stuck = false; b.since = 0;
      });
      stuckT = 0;
      host.sfx('blip');
    }
    function fixAngle(b, sp) {
      const m = Math.hypot(b.vx, b.vy) || 1;
      b.vx = (b.vx / m) * sp; b.vy = (b.vy / m) * sp;
      const sy = b.vy < 0 ? -1 : 1, sx = b.vx < 0 ? -1 : b.vx > 0 ? 1 : (Math.random() < 0.5 ? -1 : 1);
      if (Math.abs(b.vy) < sp * Math.sin(MIN_ELEV)) { b.vy = sy * sp * Math.sin(MIN_ELEV); b.vx = sx * sp * Math.cos(MIN_ELEV); }
      if (Math.abs(b.vx) < sp * Math.sin(MIN_TILT)) { b.vx = sx * sp * Math.sin(MIN_TILT); b.vy = sy * sp * Math.cos(MIN_TILT); }
    }
    function hitBrick(b) {
      let best = null, bd = R * R;
      for (let i = 0; i < bricks.length; i++) {
        const br = bricks[i];
        if (!br.alive || b.y + R < br.y || b.y - R > br.y + br.h || b.x + R < br.x || b.x - R > br.x + br.w) continue;
        const nx = clamp(b.x, br.x, br.x + br.w), ny = clamp(b.y, br.y, br.y + br.h);
        const d = (b.x - nx) * (b.x - nx) + (b.y - ny) * (b.y - ny);
        if (d < bd) { bd = d; best = br; }
      }
      return best;
    }
    function burst(x, y, col, n, spd) {
      for (let i = 0; i < n && parts.length < 420; i++) {
        const a = Math.random() * Math.PI * 2, v = (0.3 + Math.random()) * spd;
        parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - spd * 0.3, life: 0.4 + Math.random() * 0.5, col, s: 2 + Math.random() * 2.5 });
      }
    }
    function damage(br, b) {
      br.flash = 1;
      const cx = br.x + br.w / 2, cy = br.y + br.h / 2;
      if (br.kind === 'steel') { host.sfx('blip'); burst(b.x, b.y, '#DDE2FF', 4, 90); return; }
      b.since = 0;
      br.hp--;
      if (br.hp > 0) { host.sfx('blip'); burst(cx, cy, '#CDB8FF', 6, 110); return; }
      br.alive = false; breakable--;
      const pts = br.kind === 'tough' ? 25 : 10;
      addScore(pts);
      host.sfx('blip');
      const col = br.kind === 'tough' ? TOUGH : br.col;
      burst(cx, cy, col, 14, 170);
      burst(cx, cy, '#FFFFFF', 3, 120);
      texts.push({ text: '+' + pts, x: cx, y: cy, t: 0, dur: 0.6, col: pts > 10 ? PAL.marquee : PAL.text, size: 12 });
      maybeDrop(cx, cy);
      if (breakable <= 0) stageClear();
    }
    function maybeDrop(x, y) {
      if (caps.length >= 2 || Math.random() > 0.15 || breakable <= 0) return;
      const pool = [];
      Object.keys(CAPS).forEach((k) => { if (k === 'life' && lives >= 5) return; for (let i = 0; i < CAPS[k].w; i++) pool.push(k); });
      caps.push({ x, y, type: pool[Math.floor(Math.random() * pool.length)], vy: 125, t: 0 });
    }
    function applyCap(c) {
      host.sfx('coin');
      const info = CAPS[c.type];
      texts.push({ text: info.name + '!', x: clamp(c.x, 60, W - 60), y: PY - 26, t: 0, dur: 1, col: info.col, size: 16 });
      burst(c.x, c.y, info.col, 16, 160);
      if (c.type === 'wide') wideT = 15;
      else if (c.type === 'slow') slowT = 10;
      else if (c.type === 'life') lives = Math.min(6, lives + 1);
      else if (c.type === 'multi') {
        if (balls.some((b) => b.stuck)) launch();
        const src = balls.find((b) => !b.stuck && !b.dead);
        if (!src) return;
        const sp = Math.hypot(src.vx, src.vy) || speed(), a0 = Math.atan2(src.vy, src.vx);
        [-0.5, 0.5].forEach((da) => {
          if (balls.length >= MAX_BALLS) return;
          const a = a0 + da;
          balls.push({ x: src.x, y: src.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, stuck: false, trail: [], since: 0 });
        });
      }
    }
    function stageClear() {
      const bonus = 250 + 100 * (stage + 1);
      addScore(bonus);
      host.sfx('clear');
      clearT = 2;
      balls.forEach((b) => burst(b.x, b.y, PAL.cyan, 12, 140));
      balls = []; caps = [];
      texts.push({ text: 'STAGE CLEAR', sub: '+' + bonus + ' BONUS', x: W / 2, y: 330, t: 0, dur: 1.9, col: PAL.marquee, size: 30 });
    }
    function loseLife() {
      lives--;
      host.sfx('hit');
      shake = 0.35; redFlash = 0.5;
      if (lives <= 0) { over = true; host.gameOver(); return; }
      wideT = 0; slowT = 0; caps = [];
      resetBall();
    }

    function movePaddle(dt) {
      const L = host.held('left'), Rt = host.held('right');
      const usePointer = host.time - host.pointer.t < 1;
      if (L !== Rt) {
        const dir = Rt ? 1 : -1;
        paddle.vx += (dir * 640 - paddle.vx) * Math.min(1, dt * 14);
        paddle.x += paddle.vx * dt;
      } else if (usePointer) {
        const nx = paddle.x + (host.pointer.x - paddle.x) * Math.min(1, dt * 30);
        paddle.vx = dt > 0 ? (nx - paddle.x) / dt : 0;
        paddle.x = nx;
      } else {
        paddle.vx += -paddle.vx * Math.min(1, dt * 16);
        paddle.x += paddle.vx * dt;
      }
      const half = paddle.w / 2;
      if (paddle.x < FL + half) { paddle.x = FL + half; paddle.vx = 0; }
      if (paddle.x > FR - half) { paddle.x = FR - half; paddle.vx = 0; }
    }
    function stepBall(b, h, sp) {
      b.x += b.vx * h;
      if (b.x < FL + R) { b.x = FL + R; b.vx = Math.abs(b.vx); }
      else if (b.x > FR - R) { b.x = FR - R; b.vx = -Math.abs(b.vx); }
      let hit = hitBrick(b);
      if (hit) { b.x -= b.vx * h; b.vx = -b.vx; damage(hit, b); if (clearT > 0) return; }
      b.y += b.vy * h;
      if (b.y < FT + R) { b.y = FT + R; b.vy = Math.abs(b.vy); }
      hit = hitBrick(b);
      if (hit) { b.y -= b.vy * h; b.vy = -b.vy; damage(hit, b); if (clearT > 0) return; }
      // paddle
      const half = paddle.w / 2;
      if (b.vy > 0 && b.y + R >= PY && b.y < PY + PH * 0.6 && b.x >= paddle.x - half - R && b.x <= paddle.x + half + R) {
        const off = clamp((b.x - paddle.x) / (half + R * 0.5), -1, 1);
        const a = off * 1.05;
        b.vx = Math.sin(a) * sp; b.vy = -Math.cos(a) * sp;
        fixAngle(b, sp);
        b.y = PY - R; b.since = 0;
        paddle.squash = 1;
        host.sfx('blip');
        burst(b.x, PY, PAL.cyan, 5, 90);
      }
      if (b.y - R > H) b.dead = true;
    }

    const inst = {
      reset() {
        stage = 0; lives = 3; score = 0;
        paddle = { x: W / 2, w: PW, vx: 0, squash: 0 };
        parts = []; texts = []; caps = [];
        slowMul = 1; clearT = 0; shake = 0; redFlash = 0; over = false;
        loadStage();
        host.score(0);
      },
      update(dt) {
        // effects
        for (let i = parts.length - 1; i >= 0; i--) {
          const p = parts[i]; p.life -= dt;
          if (p.life <= 0) { parts.splice(i, 1); continue; }
          p.vy += 520 * dt; p.x += p.vx * dt; p.y += p.vy * dt;
        }
        for (let i = texts.length - 1; i >= 0; i--) { texts[i].t += dt; if (texts[i].t >= texts[i].dur) texts.splice(i, 1); }
        bricks.forEach((br) => { if (br.flash > 0) br.flash = Math.max(0, br.flash - dt * 6); });
        redFlash = Math.max(0, redFlash - dt);
        bannerT = Math.max(0, bannerT - dt);
        paddle.squash = Math.max(0, paddle.squash - dt * 6);
        if (over) return;

        paddle.w += ((wideT > 0 ? PW_WIDE : PW) - paddle.w) * Math.min(1, dt * 10);
        movePaddle(dt);

        if (clearT > 0) {
          clearT -= dt;
          if (clearT <= 0) { stage++; loadStage(); }
          return;
        }
        stageT += dt;
        wideT = Math.max(0, wideT - dt);
        slowT = Math.max(0, slowT - dt);
        slowMul += ((slowT > 0 ? 0.62 : 1) - slowMul) * Math.min(1, dt * 4);

        // balls
        const sp = speed();
        let anyStuck = false;
        for (let i = 0; i < balls.length; i++) {
          const b = balls[i];
          if (b.stuck) {
            anyStuck = true;
            b.x = paddle.x; b.y = PY - R - 0.5; b.trail.length = 0;
            continue;
          }
          fixAngle(b, sp);
          b.since += dt;
          if (b.since > 7) { // nothing touched for a while: nudge out of any loop
            const a = Math.atan2(b.vy, b.vx) + (Math.random() < 0.5 ? -0.35 : 0.35);
            b.vx = Math.cos(a) * sp; b.vy = Math.sin(a) * sp; fixAngle(b, sp); b.since = 0;
          }
          const steps = Math.max(1, Math.ceil((sp * dt) / 3));
          const hstep = dt / steps;
          for (let s = 0; s < steps && !b.dead; s++) {
            stepBall(b, hstep, sp);
            if (clearT > 0) return;
          }
          b.trail.unshift({ x: b.x, y: b.y, t: host.time });
          while (b.trail.length && host.time - b.trail[b.trail.length - 1].t > 0.12) b.trail.pop();
          if (b.trail.length > 24) b.trail.length = 24;
        }
        balls = balls.filter((b) => !b.dead);
        if (anyStuck) { stuckT += dt; if (stuckT >= AUTO_LAUNCH) launch(); }

        // capsules
        const half = paddle.w / 2;
        for (let i = caps.length - 1; i >= 0; i--) {
          const c = caps[i];
          c.t += dt; c.y += c.vy * dt;
          if (c.y + 7 >= PY && c.y - 7 <= PY + PH && c.x + 16 >= paddle.x - half && c.x - 16 <= paddle.x + half) { caps.splice(i, 1); applyCap(c); continue; }
          if (c.y > H + 20) caps.splice(i, 1);
        }

        if (!balls.length) loseLife();
      },
      render(ctx) {
        const T = host.time;
        drawBackdrop(ctx, W, H, HUD);
        // bottom glow
        const bg = ctx.createRadialGradient(W / 2, H + 40, 10, W / 2, H + 40, 260);
        bg.addColorStop(0, 'rgba(61,220,255,0.12)'); bg.addColorStop(1, 'rgba(61,220,255,0)');
        ctx.fillStyle = bg; ctx.fillRect(0, H - 260, W, 260);

        ctx.save();
        // decay by wall time in render: update() stops when paused/over, render doesn't
        shake = Math.max(0, shake - (host.time - (shakeT || host.time))); shakeT = host.time;
        if (shake > 0) { const m = shake * 16; ctx.translate((Math.random() - 0.5) * m, (Math.random() - 0.5) * m); }

        // walls
        ctx.fillStyle = PAL.cab2;
        ctx.fillRect(0, HUD, FL, H - HUD); ctx.fillRect(FR, HUD, W - FR, H - HUD); ctx.fillRect(0, HUD, W, FT - HUD);
        ctx.fillStyle = 'rgba(61,220,255,0.45)';
        ctx.fillRect(FL - 1, FT, 1, H - FT); ctx.fillRect(FR, FT, 1, H - FT); ctx.fillRect(FL - 1, FT - 1, FR - FL + 2, 1);
        // marquee bulbs in the top rail
        for (let i = 0; i < 19; i++) {
          const on = (i + Math.floor(T * 4)) % 3 === 0;
          ctx.fillStyle = on ? PAL.marquee : 'rgba(255,210,63,0.25)';
          ctx.beginPath(); ctx.arc(20 + i * 20, HUD + 5, 2, 0, Math.PI * 2); ctx.fill();
        }

        // bricks
        bricks.forEach((br) => { if (br.alive) drawBrick(ctx, br.x, br.y, br.w, br.h, br.kind, br.col, br.hp, br.flash, br.cracks); });

        // capsules
        caps.forEach((c) => {
          const info = CAPS[c.type];
          const wob = Math.sin(c.t * 10) * 1.2;
          ctx.save(); ctx.translate(c.x, c.y);
          const g = ctx.createRadialGradient(0, 0, 2, 0, 0, 24);
          g.addColorStop(0, info.col); g.addColorStop(1, 'rgba(0,0,0,0)');
          ctx.globalAlpha = 0.35; ctx.fillStyle = g; ctx.fillRect(-24, -24, 48, 48); ctx.globalAlpha = 1;
          rr(ctx, -17, -7 + wob * 0.2, 34, 14, 7); ctx.fillStyle = info.col; ctx.fill();
          ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = 1; ctx.stroke();
          ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.fillRect(-12, -5, 24, 3);
          ctx.font = '11px ' + FONT_D; ctx.fillStyle = PAL.ink; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.fillText(info.label, 0, 1);
          ctx.restore();
        });

        // paddle
        drawPaddle(ctx, paddle.x, PY, paddle.w, PH, paddle.squash);

        // aim guide + auto-launch ring
        const stuck = balls.find((b) => b.stuck);
        if (stuck && !over) {
          const k = Math.min(1, stuckT / AUTO_LAUNCH);
          ctx.fillStyle = 'rgba(236,234,255,0.5)';
          for (let i = 1; i <= 5; i++) { ctx.beginPath(); ctx.arc(stuck.x, stuck.y - 12 - i * 12 - ((T * 30) % 12), 1.6, 0, Math.PI * 2); ctx.fill(); }
          ctx.strokeStyle = PAL.marquee; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.arc(stuck.x, stuck.y, R + 5, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (1 - k)); ctx.stroke();
        }

        // trails + balls
        const tint = slowMul < 0.9 ? 'slow' : null;
        ctx.save(); ctx.globalCompositeOperation = 'lighter';
        balls.forEach((b) => {
          for (let i = b.trail.length - 1; i >= 1; i--) {
            const p = b.trail[i], age = clamp((T - p.t) / 0.12, 0, 1);
            ctx.fillStyle = tint ? 'rgba(255,210,63,' + (0.35 * (1 - age)).toFixed(3) + ')' : 'rgba(61,220,255,' + (0.35 * (1 - age)).toFixed(3) + ')';
            ctx.beginPath(); ctx.arc(p.x, p.y, R * (1 - age * 0.6), 0, Math.PI * 2); ctx.fill();
          }
        });
        ctx.restore();
        balls.forEach((b) => drawBall(ctx, b.x, b.y, R, tint));

        // particles
        parts.forEach((p) => { ctx.globalAlpha = clamp(p.life / 0.4, 0, 1); ctx.fillStyle = p.col; ctx.fillRect(p.x - p.s / 2, p.y - p.s / 2, p.s, p.s); });
        ctx.globalAlpha = 1;

        // floating text
        texts.forEach((tx) => {
          const k = tx.t / tx.dur, a = k > 0.65 ? (1 - k) / 0.35 : 1;
          const pop = tx.size > 20 ? (k < 0.12 ? 0.6 + 0.4 * (k / 0.12) : 1) : 1;
          ctx.save();
          ctx.globalAlpha = clamp(a, 0, 1);
          ctx.translate(tx.x, tx.y - (tx.size > 20 ? 0 : 22 * k)); ctx.scale(pop, pop);
          ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.font = (tx.size > 14 ? tx.size + 'px ' + FONT_D : '600 ' + tx.size + 'px ' + FONT_M);
          if (tx.size > 14) { ctx.fillStyle = PAL.coral; ctx.fillText(tx.text, 2, 2); }
          ctx.fillStyle = tx.col; ctx.fillText(tx.text, 0, 0);
          if (tx.sub) { ctx.font = '600 16px ' + FONT_M; ctx.fillStyle = PAL.text; ctx.fillText(tx.sub, 0, 30); }
          ctx.restore();
        });

        // stage title banner
        if (bannerT > 0 && clearT <= 0) {
          const a = clamp(bannerT / 0.5, 0, 1);
          ctx.globalAlpha = a;
          ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.font = '600 12px ' + FONT_M; ctx.fillStyle = PAL.muted;
          ctx.fillText('STAGE ' + String(stage + 1).padStart(2, '0') + (loopN() > 0 ? '  ·  SPEED +' + (loopN() * 12) + '%' : ''), W / 2, 380);
          ctx.font = '24px ' + FONT_D; ctx.fillStyle = PAL.coral; ctx.fillText(levelDef().name.toUpperCase(), W / 2 + 2, 408);
          ctx.fillStyle = PAL.text; ctx.fillText(levelDef().name.toUpperCase(), W / 2, 406);
          ctx.globalAlpha = 1;
        }
        ctx.restore();

        // HUD strip
        ctx.fillStyle = PAL.cab; ctx.fillRect(0, 0, W, HUD);
        ctx.fillStyle = PAL.line; ctx.fillRect(0, HUD - 1, W, 1);
        ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
        ctx.font = '600 10px ' + FONT_B; ctx.fillStyle = PAL.muted; ctx.fillText('STAGE', 14, HUD / 2);
        ctx.font = '16px ' + FONT_D; ctx.fillStyle = PAL.marquee; ctx.fillText(String(stage + 1).padStart(2, '0'), 54, HUD / 2 + 1);
        // lives
        ctx.textAlign = 'right';
        ctx.font = '600 10px ' + FONT_B; ctx.fillStyle = PAL.muted;
        const lx = W - 14 - Math.max(0, lives - 1) * 16;
        ctx.fillText('LIVES', lx - 14, HUD / 2);
        for (let i = 0; i < lives; i++) {
          const x = W - 14 - (lives - 1 - i) * 16 - 4, y = HUD / 2;
          ctx.fillStyle = PAL.coral; ctx.beginPath(); ctx.arc(x, y, 5.5, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.beginPath(); ctx.arc(x - 1.6, y - 1.6, 1.8, 0, Math.PI * 2); ctx.fill();
        }
        // active power-ups
        let px = 100;
        [['wide', wideT, 15], ['slow', slowT, 10]].forEach(([k, tl, full]) => {
          if (tl <= 0) return;
          const info = CAPS[k];
          const blink = tl < 2.5 && Math.floor(T * 8) % 2 === 0;
          rr(ctx, px, 11, 64, 18, 9); ctx.fillStyle = PAL.cab2; ctx.fill();
          rr(ctx, px, 11, 64 * (tl / full), 18, 9); ctx.fillStyle = blink ? 'rgba(255,255,255,0.3)' : info.col; ctx.globalAlpha = 0.35; ctx.fill(); ctx.globalAlpha = 1;
          ctx.strokeStyle = info.col; ctx.lineWidth = 1; rr(ctx, px + 0.5, 11.5, 63, 17, 8.5); ctx.stroke();
          ctx.font = '10px ' + FONT_D; ctx.textAlign = 'center'; ctx.fillStyle = PAL.text; ctx.fillText(info.name, px + 32, HUD / 2 + 1);
          px += 72;
        });

        if (redFlash > 0) { ctx.fillStyle = 'rgba(255,93,115,' + (redFlash * 0.35).toFixed(3) + ')'; ctx.fillRect(0, 0, W, H); }
      },
      onAction(a) {
        if (over) return;
        if ((a === 'action' || a === 'up') && balls.some((b) => b.stuck) && clearT <= 0) launch();
      },
      destroy() {}
    };
    return inst;
  }

  Arcade.register({
    id: 'brickstorm',
    title: 'Brickstorm',
    genre: 'Brick breaker',
    tagline: 'Smash the wall, catch the capsules, keep the ball alive.',
    width: W, height: H,
    pointerOnly: true,
    controls: ['Move mouse or drag to steer', '← → keys also steer', 'Space or tap to launch'],
    pad: ['left', 'right', 'action'],
    art,
    create
  });
})();
