(function () {
  'use strict';

  // ---------- constants ----------
  const PAL = { ink: '#0D0F22', cab: '#171A36', cab2: '#20244A', line: '#2E3366', text: '#ECEAFF', muted: '#A3A2CC', marquee: '#FFD23F', coral: '#FF5D73', cyan: '#3DDCFF', mint: '#5CF2A5' };
  const FONT_D = "'Bungee', Impact, 'Arial Black', sans-serif";
  const FONT_M = "'IBM Plex Mono', ui-monospace, Menlo, Consolas, monospace";
  const FONT_B = "'Rubik', system-ui, -apple-system, 'Segoe UI', sans-serif";

  const W = 360, H = 640;
  const COLS = 10, ROWS = 20, HID = 2, TOT = ROWS + HID;
  const CELL = 26, WX = 14, WY = 88, WW = COLS * CELL, WH = ROWS * CELL; // well 260x520
  const SX = WX + WW + 12, SW = W - 14 - SX;                             // side column
  const DAS = 0.17, ARR = 0.05, LOCK = 0.5, MAX_RESETS = 15, CLEAR_DUR = 0.34;
  const LINE_PTS = [0, 100, 300, 500, 800];
  const CLEAR_NAMES = ['', 'SINGLE', 'DOUBLE', 'TRIPLE', 'QUADRUPLE!'];

  const TYPES = ['I', 'O', 'T', 'S', 'Z', 'J', 'L'];
  const COLOR = { I: PAL.cyan, O: PAL.marquee, T: '#B07CFF', S: PAL.mint, Z: PAL.coral, J: '#5B7CFF', L: '#FF9A3D' };
  const BASE = {
    I: [[0, 1], [1, 1], [2, 1], [3, 1]],
    O: [[0, 0], [1, 0], [0, 1], [1, 1]],
    T: [[1, 0], [0, 1], [1, 1], [2, 1]],
    S: [[1, 0], [2, 0], [0, 1], [1, 1]],
    Z: [[0, 0], [1, 0], [1, 1], [2, 1]],
    J: [[0, 0], [0, 1], [1, 1], [2, 1]],
    L: [[2, 0], [0, 1], [1, 1], [2, 1]]
  };
  const SIZE = { I: 4, O: 2, T: 3, S: 3, Z: 3, J: 3, L: 3 };
  const ROT = {};
  TYPES.forEach((t) => {
    const n = SIZE[t], rs = [BASE[t]];
    for (let r = 1; r < 4; r++) rs.push(rs[r - 1].map(([x, y]) => [n - 1 - y, x])); // clockwise
    ROT[t] = rs;
  });
  const KICKS = [[0, 0], [-1, 0], [1, 0], [0, -1], [-1, -1], [1, -1], [-2, 0], [2, 0]];
  const KICKS_I = [[0, 0], [-1, 0], [1, 0], [-2, 0], [2, 0], [0, -1], [0, -2]];

  // ---------- drawing helpers ----------
  const shadeCache = {};
  function shade(hex, amt) {
    const key = hex + amt;
    if (shadeCache[key]) return shadeCache[key];
    const n = parseInt(hex.slice(1), 16);
    let r = n >> 16, g = (n >> 8) & 255, b = n & 255;
    const tg = amt < 0 ? 0 : 255, k = Math.abs(amt);
    r = Math.round(r + (tg - r) * k); g = Math.round(g + (tg - g) * k); b = Math.round(b + (tg - b) * k);
    return (shadeCache[key] = 'rgb(' + r + ',' + g + ',' + b + ')');
  }
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
  function drawBlock(ctx, x, y, s, col, alpha) {
    const b = Math.max(2, Math.round(s * 0.16));
    ctx.globalAlpha = alpha == null ? 1 : alpha;
    ctx.fillStyle = shade(col, -0.55);
    ctx.fillRect(x, y, s, s);
    ctx.fillStyle = col;
    ctx.fillRect(x + 1, y + 1, s - 2, s - 2);
    const x0 = x + 1, y0 = y + 1, x1 = x + s - 1, y1 = y + s - 1;
    ctx.fillStyle = shade(col, 0.42);
    ctx.beginPath();
    ctx.moveTo(x0, y0); ctx.lineTo(x1, y0); ctx.lineTo(x1 - b, y0 + b); ctx.lineTo(x0 + b, y0 + b); ctx.lineTo(x0 + b, y1 - b); ctx.lineTo(x0, y1);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = shade(col, -0.28);
    ctx.beginPath();
    ctx.moveTo(x1, y0); ctx.lineTo(x1, y1); ctx.lineTo(x0, y1); ctx.lineTo(x0 + b, y1 - b); ctx.lineTo(x1 - b, y1 - b); ctx.lineTo(x1 - b, y0 + b);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.fillRect(x0 + b + 1, y0 + b + 1, Math.max(2, s * 0.24), Math.max(1.5, s * 0.1));
    ctx.globalAlpha = 1;
  }
  function drawGhost(ctx, x, y, s, col) {
    ctx.fillStyle = col; ctx.globalAlpha = 0.13;
    ctx.fillRect(x + 1, y + 1, s - 2, s - 2);
    ctx.globalAlpha = 0.6; ctx.strokeStyle = col; ctx.lineWidth = 1.5;
    ctx.strokeRect(x + 2.25, y + 2.25, s - 4.5, s - 4.5);
    ctx.globalAlpha = 1;
  }
  function drawMini(ctx, type, cx, cy, s, alpha) {
    const cells = ROT[type][0];
    let minx = 9, maxx = -9, miny = 9, maxy = -9;
    cells.forEach(([x, y]) => { minx = Math.min(minx, x); maxx = Math.max(maxx, x); miny = Math.min(miny, y); maxy = Math.max(maxy, y); });
    const ox = Math.round(cx - ((maxx - minx + 1) * s) / 2 - minx * s), oy = Math.round(cy - ((maxy - miny + 1) * s) / 2 - miny * s);
    cells.forEach(([x, y]) => drawBlock(ctx, ox + x * s, oy + y * s, s, COLOR[type], alpha));
  }
  function label(ctx, text, x, y, align, color) {
    ctx.font = '600 10px ' + FONT_B;
    if ('letterSpacing' in ctx) ctx.letterSpacing = '1.5px';
    ctx.textAlign = align || 'left'; ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = color || PAL.muted;
    ctx.fillText(text, x, y);
    if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
  }

  // ---------- thumbnail art ----------
  const ART_ROWS = [
    'L........I',
    'LLO..T.ZZI',
    'JOOTTT.SZZ',
    'JJSSLL.SSO',
    'ZZSSIL.LOO',
    'IIIIJJ.JLL'
  ];
  function art(ctx, w, h, t) {
    const g = ctx.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, '#221D5C'); g.addColorStop(1, PAL.ink);
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    // diagonal light rays
    ctx.fillStyle = 'rgba(255,210,63,0.05)';
    for (let i = -2; i < 8; i++) { ctx.beginPath(); ctx.moveTo(i * 60, 0); ctx.lineTo(i * 60 + 26, 0); ctx.lineTo(i * 60 - 74, h); ctx.lineTo(i * 60 - 100, h); ctx.closePath(); ctx.fill(); }
    const s = 14, rows = 13, wx = 90, wy = 9, ww = 10 * s, wh = rows * s;
    rr(ctx, wx - 5, wy - 5, ww + 10, wh + 10, 7); ctx.fillStyle = PAL.cab; ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = PAL.line; ctx.stroke();
    ctx.fillStyle = '#0A0C1F'; ctx.fillRect(wx, wy, ww, wh);
    ctx.strokeStyle = 'rgba(140,150,255,0.08)'; ctx.lineWidth = 1;
    ctx.beginPath();
    for (let c = 1; c < 10; c++) { ctx.moveTo(wx + c * s + 0.5, wy); ctx.lineTo(wx + c * s + 0.5, wy + wh); }
    for (let r = 1; r < rows; r++) { ctx.moveTo(wx, wy + r * s + 0.5); ctx.lineTo(wx + ww, wy + r * s + 0.5); }
    ctx.stroke();
    const base = rows - ART_ROWS.length;
    ART_ROWS.forEach((row, r) => { for (let c = 0; c < 10; c++) if (row[c] !== '.') drawBlock(ctx, wx + c * s, wy + (base + r) * s, s, COLOR[row[c]]); });
    // falling vertical bar into the gap
    const cyc = 2.6, p = ((t + 1.1) % cyc) / cyc;
    const landY = base + 2; // top of the 4-tall bar when landed (rows base+2 .. base+5)
    const y = p < 0.72 ? Math.floor(-4 + (landY + 4) * (p / 0.72)) : landY;
    for (let k = 0; k < 4; k++) drawGhost(ctx, wx + 6 * s, wy + (landY + k) * s, s, COLOR.I);
    ctx.save(); ctx.beginPath(); ctx.rect(wx, wy, ww, wh); ctx.clip();
    for (let k = 0; k < 4; k++) drawBlock(ctx, wx + 6 * s, wy + (y + k) * s, s, COLOR.I);
    if (p >= 0.72) {
      const f = 1 - (p - 0.72) / 0.28;
      ctx.fillStyle = 'rgba(255,255,255,' + (0.85 * f).toFixed(3) + ')';
      const cw = ww * f;
      ctx.fillRect(wx + (ww - cw) / 2, wy + (landY) * s, cw, 4 * s);
    }
    ctx.restore();
    // side panels
    rr(ctx, 16, 14, 60, 92, 8); ctx.fillStyle = PAL.cab; ctx.fill(); ctx.strokeStyle = PAL.line; ctx.lineWidth = 1.5; ctx.stroke();
    label(ctx, 'NEXT', 46, 30, 'center');
    drawMini(ctx, 'T', 46, 52, 11);
    drawMini(ctx, 'S', 46, 84, 9, 0.85);
    rr(ctx, 244, 14, 60, 52, 8); ctx.fillStyle = PAL.cab; ctx.fill(); ctx.stroke();
    label(ctx, 'LINES', 274, 30, 'center');
    ctx.font = '600 18px ' + FONT_M; ctx.fillStyle = PAL.mint; ctx.textAlign = 'center'; ctx.fillText('42', 274, 54);
    rr(ctx, 244, 74, 60, 52, 8); ctx.fillStyle = PAL.cab; ctx.fill(); ctx.stroke();
    label(ctx, 'LEVEL', 274, 90, 'center');
    ctx.font = '600 18px ' + FONT_M; ctx.fillStyle = PAL.cyan; ctx.fillText('5', 274, 114);
    // loose decorative blocks
    drawBlock(ctx, 24, 150, 16, COLOR.Z); drawBlock(ctx, 40, 150, 16, COLOR.Z); drawBlock(ctx, 40, 166, 16, COLOR.Z); drawBlock(ctx, 56, 166, 16, COLOR.Z);
    drawBlock(ctx, 262, 150, 16, COLOR.O); drawBlock(ctx, 278, 150, 16, COLOR.O); drawBlock(ctx, 262, 166, 16, COLOR.O); drawBlock(ctx, 278, 166, 16, COLOR.O);
  }

  // ---------- game ----------
  function create(host) {
    let board, bag, queue, cur, score, lines, level, fallAcc, lockT, lockResets, lowestY;
    let dasDir, dasT, clearing, over, overAt, shake, parts, texts, flashes, trails, levelPulse, pieceN, shakeT = 0;

    const emptyRow = () => new Array(COLS).fill(null);
    function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; } return a; }
    function nextType() { if (!bag.length) bag = shuffle(TYPES.slice()); return bag.pop(); }
    function fillQueue() { while (queue.length < 4) queue.push(nextType()); }
    function gravity() { return Math.max(0.05, 0.85 * Math.pow(0.82, level - 1)); }
    function addScore(n) { if (n <= 0) return; score += n; host.score(score); }

    function collides(x, y, rot, type) {
      const cells = ROT[type || cur.type][rot];
      for (let i = 0; i < 4; i++) {
        const cx = x + cells[i][0], cy = y + cells[i][1];
        if (cx < 0 || cx >= COLS || cy >= TOT) return true;
        if (cy >= 0 && board[cy][cx]) return true;
      }
      return false;
    }
    const grounded = () => cur && collides(cur.x, cur.y + 1, cur.rot);
    function afterShift() {
      if (grounded() && lockResets < MAX_RESETS) { lockT = 0; lockResets++; }
    }
    function shift(dx) {
      if (!cur || collides(cur.x + dx, cur.y, cur.rot)) return false;
      cur.x += dx; afterShift(); return true;
    }
    function rotate() {
      if (!cur || cur.type === 'O') { if (cur) host.sfx('blip'); return; }
      const nr = (cur.rot + 1) % 4, kicks = cur.type === 'I' ? KICKS_I : KICKS;
      for (let i = 0; i < kicks.length; i++) {
        const nx = cur.x + kicks[i][0], ny = cur.y + kicks[i][1];
        if (!collides(nx, ny, nr)) {
          cur.x = nx; cur.y = ny; cur.rot = nr; cur.spin = 1;
          afterShift(); host.sfx('blip'); return;
        }
      }
    }
    function stepDown() {
      if (!cur || collides(cur.x, cur.y + 1, cur.rot)) return false;
      cur.y++; lockT = 0;
      if (cur.y > lowestY) { lowestY = cur.y; lockResets = 0; }
      return true;
    }
    function ghostY() { let y = cur.y; while (!collides(cur.x, y + 1, cur.rot)) y++; return y; }

    function spawn() {
      fillQueue();
      const type = queue.shift(); fillQueue();
      cur = { type, rot: 0, x: type === 'O' ? 4 : 3, y: 1, spin: 0, born: host.time };
      if (collides(cur.x, cur.y, 0)) { cur.y = 0; if (collides(cur.x, cur.y, 0)) { topOut(); return; } }
      else if (!collides(cur.x, cur.y + 1, 0)) cur.y++;
      fallAcc = 0; lockT = 0; lockResets = 0; lowestY = cur.y; pieceN++;
    }
    function topOut() {
      if (over) return;
      over = true; overAt = host.time; shake = 0.3;
      host.gameOver();
    }
    function anyHidden() {
      for (let y = 0; y < HID; y++) for (let x = 0; x < COLS; x++) if (board[y][x]) return true;
      return false;
    }
    function lock() {
      const cells = ROT[cur.type][cur.rot];
      cells.forEach(([dx, dy]) => {
        const x = cur.x + dx, y = cur.y + dy;
        if (y >= 0) board[y][x] = cur.type;
        flashes.push({ x, y, t: 0.22 });
      });
      cur = null;
      const full = [];
      for (let y = 0; y < TOT; y++) if (board[y].every(Boolean)) full.push(y);
      if (full.length) {
        const n = full.length;
        addScore(LINE_PTS[n] * level);
        lines += n;
        clearing = { rows: full, t: 0 };
        host.sfx('clear');
        full.forEach((y) => {
          for (let x = 0; x < COLS; x++) {
            const col = COLOR[board[y][x]] || PAL.text;
            for (let k = 0; k < 3; k++) {
              parts.push({ x: WX + x * CELL + CELL / 2, y: WY + (y - HID) * CELL + CELL / 2, vx: (Math.random() - 0.5) * 260 + (x - 4.5) * 22, vy: -Math.random() * 220 - 40, life: 0.6 + Math.random() * 0.5, max: 1.1, col, s: 2 + Math.random() * 3 });
            }
          }
        });
        const midY = Math.min(WY + ((full[0] + full[n - 1]) / 2 - HID) * CELL, WY + WH - 70);
        texts.push({ text: CLEAR_NAMES[n], sub: '+' + LINE_PTS[n] * level, x: WX + WW / 2, y: midY, t: 0, dur: 1.2, col: n === 4 ? PAL.marquee : PAL.text, big: n === 4 });
        if (n === 4) shake = 0.25;
      } else {
        if (anyHidden()) { topOut(); return; }
        spawn();
      }
    }
    function finishClear() {
      const rows = clearing.rows; clearing = null;
      rows.forEach((y) => { board.splice(y, 1); board.unshift(emptyRow()); });
      flashes.length = 0;
      const nl = 1 + Math.floor(lines / 10);
      if (nl > level) {
        level = nl; levelPulse = 1.4;
        texts.push({ text: 'LEVEL ' + level, sub: 'SPEED UP', x: WX + WW / 2, y: WY + WH * 0.32, t: 0, dur: 1.5, col: PAL.cyan, big: true });
        host.sfx('boost');
      }
      if (anyHidden()) { topOut(); return; }
      spawn();
    }
    function hardDrop() {
      if (!cur) return;
      const y0 = cur.y, gy = ghostY(), d = gy - y0;
      cur.y = gy;
      addScore(2 * d);
      if (d > 0) {
        const cells = ROT[cur.type][cur.rot];
        const cols = {};
        cells.forEach(([dx, dy]) => { const x = cur.x + dx; cols[x] = Math.min(cols[x] == null ? 99 : cols[x], dy); });
        Object.keys(cols).forEach((x) => trails.push({ x: +x, y0: y0 + cols[x], y1: gy + cols[x], t: 0.22, col: COLOR[cur.type] }));
      }
      shake = Math.max(shake, 0.08 + Math.min(0.08, d * 0.005));
      lock();
    }
    function stackHeight() {
      for (let y = 0; y < TOT; y++) for (let x = 0; x < COLS; x++) if (board[y][x]) return Math.min(ROWS, TOT - y);
      return 0;
    }

    function tickFx(dt) {
      for (let i = parts.length - 1; i >= 0; i--) {
        const p = parts[i];
        p.life -= dt; if (p.life <= 0) { parts.splice(i, 1); continue; }
        p.vy += 620 * dt; p.x += p.vx * dt; p.y += p.vy * dt;
      }
      for (let i = texts.length - 1; i >= 0; i--) { texts[i].t += dt; if (texts[i].t >= texts[i].dur) texts.splice(i, 1); }
      for (let i = flashes.length - 1; i >= 0; i--) { flashes[i].t -= dt; if (flashes[i].t <= 0) flashes.splice(i, 1); }
      for (let i = trails.length - 1; i >= 0; i--) { trails[i].t -= dt; if (trails[i].t <= 0) trails.splice(i, 1); }
      levelPulse = Math.max(0, levelPulse - dt);
      if (cur) cur.spin = Math.max(0, cur.spin - dt * 8);
    }

    // ---------- render pieces ----------
    function drawTop(ctx) {
      rr(ctx, 14, 14, W - 28, 60, 12);
      ctx.fillStyle = PAL.cab; ctx.fill();
      ctx.lineWidth = 1.5; ctx.strokeStyle = PAL.line; ctx.stroke();
      label(ctx, 'SCORE', 28, 36);
      ctx.font = '600 24px ' + FONT_M; ctx.textAlign = 'left'; ctx.fillStyle = PAL.marquee;
      ctx.fillText(String(score).padStart(6, '0'), 27, 63);
      label(ctx, 'LEVEL', W - 28, 36, 'right');
      ctx.font = '600 24px ' + FONT_M; ctx.textAlign = 'right';
      ctx.fillStyle = levelPulse > 0 && Math.floor(levelPulse * 8) % 2 === 0 ? PAL.text : PAL.cyan;
      ctx.fillText(String(level).padStart(2, '0'), W - 27, 63);
      // speed pips between
      const pips = 8, px0 = 150, pw = 10, gap = 4;
      label(ctx, 'SPEED', px0, 36);
      for (let i = 0; i < pips; i++) {
        const on = i < Math.min(pips, Math.ceil(level * pips / 15));
        ctx.fillStyle = on ? (i < 4 ? PAL.mint : i < 6 ? PAL.marquee : PAL.coral) : PAL.cab2;
        rr(ctx, px0 + i * (pw + gap), 48, pw, 14, 2); ctx.fill();
      }
    }
    function drawSide(ctx) {
      // NEXT
      const nh = 196;
      rr(ctx, SX, WY - 6, SW, nh, 10); ctx.fillStyle = PAL.cab; ctx.fill(); ctx.lineWidth = 1.5; ctx.strokeStyle = PAL.line; ctx.stroke();
      label(ctx, 'NEXT', SX + SW / 2 + 1, WY + 12, 'center', PAL.text);
      const cx = SX + SW / 2;
      if (queue.length) {
        drawMini(ctx, queue[0], cx, WY + 48, 13);
        ctx.fillStyle = PAL.line; ctx.fillRect(SX + 10, WY + 78, SW - 20, 1);
        drawMini(ctx, queue[1], cx, WY + 108, 10, 0.9);
        drawMini(ctx, queue[2], cx, WY + 152, 10, 0.75);
      }
      // LINES + goal bar
      const ly = WY - 6 + nh + 10;
      rr(ctx, SX, ly, SW, 78, 10); ctx.fillStyle = PAL.cab; ctx.fill(); ctx.stroke();
      label(ctx, 'LINES', SX + SW / 2 + 1, ly + 18, 'center');
      ctx.font = '600 22px ' + FONT_M; ctx.textAlign = 'center'; ctx.fillStyle = PAL.mint;
      ctx.fillText(String(lines), SX + SW / 2, ly + 46);
      const segW = (SW - 16 - 9) / 10, into = lines % 10;
      for (let i = 0; i < 10; i++) {
        ctx.fillStyle = i < into ? PAL.mint : PAL.cab2;
        ctx.fillRect(SX + 8 + i * (segW + 1), ly + 58, segW, 8);
      }
      // STACK meter
      const my = ly + 88, mh = WY + WH + 6 - my;
      rr(ctx, SX, my, SW, mh, 10); ctx.fillStyle = PAL.cab; ctx.fill(); ctx.stroke();
      label(ctx, 'STACK', SX + SW / 2 + 1, my + 18, 'center');
      const bx = SX + SW / 2 - 8, by = my + 28, bw = 16, bh = mh - 40;
      rr(ctx, bx, by, bw, bh, 4); ctx.fillStyle = '#0A0C1F'; ctx.fill();
      const hgt = stackHeight(), frac = hgt / ROWS;
      if (frac > 0) {
        const fh = Math.max(4, (bh - 4) * frac);
        const g = ctx.createLinearGradient(0, by + bh, 0, by);
        g.addColorStop(0, PAL.mint); g.addColorStop(0.55, PAL.marquee); g.addColorStop(1, PAL.coral);
        ctx.fillStyle = g;
        rr(ctx, bx + 2, by + bh - 2 - fh, bw - 4, fh, 3); ctx.fill();
      }
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      for (let i = 1; i < 5; i++) ctx.fillRect(bx - 4, by + (bh * i) / 5, 3, 1);
    }
    function drawWell(ctx, T) {
      const danger = stackHeight() >= 15 && !over;
      rr(ctx, WX - 7, WY - 7, WW + 14, WH + 14, 12);
      ctx.fillStyle = PAL.cab; ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = danger ? 'rgba(255,93,115,' + (0.55 + 0.45 * Math.sin(T * 8)).toFixed(3) + ')' : PAL.line;
      ctx.stroke();
      const g = ctx.createLinearGradient(0, WY, 0, WY + WH);
      g.addColorStop(0, '#0B0D22'); g.addColorStop(1, '#10123A');
      ctx.fillStyle = g; ctx.fillRect(WX, WY, WW, WH);

      ctx.save();
      ctx.beginPath(); ctx.rect(WX, WY, WW, WH); ctx.clip();
      // lane highlight under the active piece
      if (cur && !over) {
        const cells = ROT[cur.type][cur.rot];
        let minx = 99, maxx = -1, miny = 99;
        cells.forEach(([dx, dy]) => { minx = Math.min(minx, cur.x + dx); maxx = Math.max(maxx, cur.x + dx); miny = Math.min(miny, cur.y + dy); });
        const lg = ctx.createLinearGradient(0, WY + (miny - HID) * CELL, 0, WY + WH);
        lg.addColorStop(0, 'rgba(255,255,255,0.045)'); lg.addColorStop(1, 'rgba(255,255,255,0.0)');
        ctx.fillStyle = lg;
        ctx.fillRect(WX + minx * CELL, WY + (miny - HID) * CELL, (maxx - minx + 1) * CELL, WH);
      }
      // grid
      ctx.strokeStyle = 'rgba(140,150,255,0.075)'; ctx.lineWidth = 1;
      ctx.beginPath();
      for (let c = 1; c < COLS; c++) { ctx.moveTo(WX + c * CELL + 0.5, WY); ctx.lineTo(WX + c * CELL + 0.5, WY + WH); }
      for (let r = 1; r < ROWS; r++) { ctx.moveTo(WX, WY + r * CELL + 0.5); ctx.lineTo(WX + WW, WY + r * CELL + 0.5); }
      ctx.stroke();

      // settled blocks (grey-out sweep after top-out)
      const greyRows = over ? Math.floor((T - overAt) / 0.035) : -1;
      for (let y = HID; y < TOT; y++) {
        const greyed = over && y >= TOT - greyRows;
        for (let x = 0; x < COLS; x++) {
          const v = board[y][x]; if (!v) continue;
          drawBlock(ctx, WX + x * CELL, WY + (y - HID) * CELL, CELL, greyed ? '#4A4F7E' : COLOR[v]);
        }
      }
      // hard-drop streaks
      trails.forEach((tr) => {
        const a = tr.t / 0.22;
        const ytop = WY + (tr.y0 - HID) * CELL, ybot = WY + (tr.y1 - HID) * CELL;
        const sg = ctx.createLinearGradient(0, ytop, 0, ybot);
        sg.addColorStop(0, 'rgba(255,255,255,0)'); sg.addColorStop(1, tr.col);
        ctx.globalAlpha = 0.45 * a; ctx.fillStyle = sg;
        ctx.fillRect(WX + tr.x * CELL + 3, ytop, CELL - 6, ybot - ytop + CELL);
        ctx.globalAlpha = 1;
      });
      // ghost + active piece
      if (cur && !over) {
        const cells = ROT[cur.type][cur.rot], col = COLOR[cur.type];
        const gy = ghostY();
        if (gy !== cur.y) cells.forEach(([dx, dy]) => drawGhost(ctx, WX + (cur.x + dx) * CELL, WY + (gy + dy - HID) * CELL, CELL, col));
        const lockFrac = grounded() ? Math.min(1, lockT / LOCK) : 0;
        cells.forEach(([dx, dy]) => {
          const px = WX + (cur.x + dx) * CELL, py = WY + (cur.y + dy - HID) * CELL;
          drawBlock(ctx, px, py, CELL, col);
          if (lockFrac > 0) { ctx.fillStyle = 'rgba(13,15,34,' + (lockFrac * 0.35).toFixed(3) + ')'; ctx.fillRect(px + 1, py + 1, CELL - 2, CELL - 2); }
          if (cur.spin > 0) { ctx.fillStyle = 'rgba(255,255,255,' + (cur.spin * 0.35).toFixed(3) + ')'; ctx.fillRect(px + 1, py + 1, CELL - 2, CELL - 2); }
        });
      } else if (cur && over) {
        ROT[cur.type][cur.rot].forEach(([dx, dy]) => drawBlock(ctx, WX + (cur.x + dx) * CELL, WY + (cur.y + dy - HID) * CELL, CELL, '#4A4F7E'));
      }
      // lock flashes
      flashes.forEach((f) => {
        ctx.fillStyle = 'rgba(255,255,255,' + (f.t / 0.22 * 0.6).toFixed(3) + ')';
        ctx.fillRect(WX + f.x * CELL + 1, WY + (f.y - HID) * CELL + 1, CELL - 2, CELL - 2);
      });
      // line-clear wipe
      if (clearing) {
        const p = Math.min(1, clearing.t / CLEAR_DUR);
        clearing.rows.forEach((y) => {
          const ry = WY + (y - HID) * CELL;
          const cw = WW * (1 - p);
          ctx.fillStyle = 'rgba(255,255,255,' + (0.95 - 0.5 * p).toFixed(3) + ')';
          ctx.fillRect(WX + (WW - cw) / 2, ry + 1, cw, CELL - 2);
          ctx.fillStyle = 'rgba(255,210,63,' + (0.35 * (1 - p)).toFixed(3) + ')';
          ctx.fillRect(WX, ry - 3, WW, CELL + 6);
        });
      }
      ctx.restore();

      // particles
      parts.forEach((p) => {
        ctx.globalAlpha = Math.max(0, Math.min(1, p.life / 0.5));
        ctx.fillStyle = p.col;
        ctx.fillRect(p.x - p.s / 2, p.y - p.s / 2, p.s, p.s);
      });
      ctx.globalAlpha = 1;
      // floating text
      texts.forEach((tx) => {
        const k = tx.t / tx.dur;
        const a = Math.min(1, tx.t / 0.06, k > 0.7 ? (1 - k) / 0.3 : 1);
        const pop = tx.t < 0.12 ? 0.75 + 0.25 * (tx.t / 0.12) : 1;
        const y = tx.y - 26 * k;
        ctx.save();
        ctx.globalAlpha = Math.max(0, a);
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.font = (tx.big ? 26 : 22) + 'px ' + FONT_D;
        const fit = Math.min(1, (WW - 24) / Math.max(1, ctx.measureText(tx.text).width));
        ctx.translate(tx.x, y); ctx.scale(pop * fit, pop * fit);
        ctx.lineJoin = 'round'; ctx.lineWidth = 7; ctx.strokeStyle = 'rgba(13,15,34,0.9)';
        ctx.strokeText(tx.text, 1, 1);
        ctx.fillStyle = PAL.coral; ctx.fillText(tx.text, 2, 2);
        ctx.fillStyle = tx.col; ctx.fillText(tx.text, 0, 0);
        if (tx.sub) {
          ctx.scale(1 / fit, 1 / fit);
          ctx.font = '600 15px ' + FONT_M; ctx.lineWidth = 5; ctx.strokeText(tx.sub, 0, 25);
          ctx.fillStyle = PAL.text; ctx.fillText(tx.sub, 0, 25);
        }
        ctx.restore();
      });
    }

    const inst = {
      reset() {
        board = []; for (let y = 0; y < TOT; y++) board.push(emptyRow());
        bag = []; queue = []; cur = null;
        score = 0; lines = 0; level = 1; fallAcc = 0; lockT = 0; lockResets = 0; lowestY = 0;
        dasDir = 0; dasT = 0; clearing = null; over = false; overAt = 0; shake = 0;
        parts = []; texts = []; flashes = []; trails = []; levelPulse = 0; pieceN = 0;
        spawn();
        host.score(0);
      },
      update(dt) {
        tickFx(dt);
        if (over) return;
        if (clearing) { clearing.t += dt; if (clearing.t >= CLEAR_DUR) finishClear(); return; }
        if (!cur) { spawn(); if (over || !cur) return; }

        // auto-repeat for held left/right
        if (dasDir) {
          const name = dasDir < 0 ? 'left' : 'right', other = dasDir < 0 ? 'right' : 'left';
          if (!host.held(name)) {
            if (host.held(other)) { dasDir = -dasDir; dasT = DAS; shift(dasDir); } else dasDir = 0;
          } else {
            dasT -= dt;
            let guard = 0;
            while (dasT <= 0 && guard++ < 12) { if (!shift(dasDir)) { dasT = 0; break; } dasT += ARR; }
          }
        }

        // gravity / soft drop
        const soft = host.held('down');
        const g = gravity(), interval = soft ? Math.min(g, 0.035) : g;
        fallAcc += dt;
        let guard = 0;
        while (fallAcc >= interval && guard++ < 40) {
          fallAcc -= interval;
          if (stepDown()) { if (soft) addScore(1); } else { fallAcc = 0; break; }
        }
        // lock delay
        if (grounded()) { lockT += dt; if (lockT >= LOCK) lock(); }
        else lockT = 0;
      },
      render(ctx) {
        const T = host.time;
        const bg = ctx.createLinearGradient(0, 0, 0, H);
        bg.addColorStop(0, '#1A1846'); bg.addColorStop(0.5, '#12143A'); bg.addColorStop(1, PAL.ink);
        ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
        // faint diagonal pinstripes
        ctx.strokeStyle = 'rgba(255,255,255,0.025)'; ctx.lineWidth = 1;
        ctx.beginPath();
        for (let i = -H; i < W; i += 22) { ctx.moveTo(i, H); ctx.lineTo(i + H, 0); }
        ctx.stroke();
        ctx.save();
        // decay by wall time in render: update() stops when paused/over, render doesn't
        shake = Math.max(0, shake - (host.time - (shakeT || host.time))); shakeT = host.time;
        if (shake > 0) { const m = shake * 18; ctx.translate((Math.random() - 0.5) * m, (Math.random() - 0.5) * m * 0.6); }
        drawTop(ctx);
        drawSide(ctx);
        drawWell(ctx, T);
        ctx.restore();
      },
      onAction(a) {
        if (over) return;
        if (a === 'left' || a === 'right') {
          dasDir = a === 'left' ? -1 : 1; dasT = DAS;
          if (!clearing) shift(dasDir);
          return;
        }
        if (clearing || !cur) return;
        if (a === 'up') rotate();
        else if (a === 'down') { if (stepDown()) addScore(1); fallAcc = 0; }
        else if (a === 'action') hardDrop();
      },
      onRelease(a) {
        if ((a === 'left' && dasDir < 0) || (a === 'right' && dasDir > 0)) {
          const other = a === 'left' ? 'right' : 'left';
          if (host.held(other)) { dasDir = -dasDir; dasT = DAS; } else dasDir = 0;
        }
      },
      destroy() {}
    };
    return inst;
  }

  Arcade.register({
    id: 'stackfall',
    title: 'Stackfall',
    genre: 'Block puzzle',
    tagline: 'Slot the falling shapes, clear lines, chase speed.',
    width: W, height: H,
    controls: ['← → move · ↑ rotate', '↓ soft drop · Space hard drop', 'Swipe to move, tap to drop'],
    pad: ['left', 'up', 'down', 'right', 'action'],
    art,
    create
  });
})();
