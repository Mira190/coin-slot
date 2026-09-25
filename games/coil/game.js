(function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // Coil — neon snake on a 20x20 board (400x440 logical, 40px info strip on top)
  // ---------------------------------------------------------------------------
  const W = 400, H = 440, TOP = 40, CELL = 20, N = 20;
  const MONO = "'IBM Plex Mono', ui-monospace, Menlo, Consolas, monospace";
  const DISP = "Bungee, Impact, 'Arial Black', sans-serif";
  const DIRS = { left: { x: -1, y: 0 }, right: { x: 1, y: 0 }, up: { x: 0, y: -1 }, down: { x: 0, y: 1 } };

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, p) => a + (b - a) * p;
  const rand = (a, b) => a + Math.random() * (b - a);
  const cx = (x) => x * CELL + CELL / 2;
  const cy = (y) => TOP + y * CELL + CELL / 2;

  // body colour along the snake: mint head -> cyan -> violet tail
  function bodyHue(f) { return f < 0.5 ? lerp(152, 192, f / 0.5) : lerp(192, 268, (f - 0.5) / 0.5); }
  function bodyCol(f, l) { return 'hsl(' + bodyHue(f).toFixed(0) + ',92%,' + (l || 60) + '%)'; }

  // ---- shared drawing helpers (game + card art) ----
  function drawBody(ctx, pts, opt) {
    const n = pts.length;
    if (n < 2) return;
    const w0 = opt.w0 || 15, w1 = opt.w1 || 9;
    // outer neon glow
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = opt.dead ? 'rgba(255,93,115,0.30)' : 'rgba(61,220,255,0.30)';
    ctx.shadowColor = opt.dead ? 'rgba(255,93,115,0.9)' : 'rgba(61,220,255,0.9)';
    ctx.shadowBlur = 14;
    ctx.lineWidth = w0 + 2;
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < n; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.stroke();
    ctx.restore();

    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    // dark under-stroke for definition
    ctx.strokeStyle = '#070817';
    for (let i = n - 1; i >= 1; i--) {
      const f = (i - 1) / Math.max(1, n - 2);
      ctx.lineWidth = lerp(w0, w1, f) + 3 + (opt.bulge ? opt.bulge(i - 1) : 0);
      ctx.beginPath();
      ctx.moveTo(pts[i].x, pts[i].y);
      ctx.lineTo(pts[i - 1].x, pts[i - 1].y);
      ctx.stroke();
    }
    // coloured pieces, tail first so the head sits on top
    for (let i = n - 1; i >= 1; i--) {
      const f = (i - 1) / Math.max(1, n - 2);
      const bw = lerp(w0, w1, f) + (opt.bulge ? opt.bulge(i - 1) : 0);
      ctx.strokeStyle = opt.dead ? (opt.flash ? '#FFE3E8' : 'hsl(' + bodyHue(f).toFixed(0) + ',25%,48%)') : bodyCol(f, 58);
      ctx.lineWidth = bw;
      ctx.beginPath();
      ctx.moveTo(pts[i].x, pts[i].y);
      ctx.lineTo(pts[i - 1].x, pts[i - 1].y);
      ctx.stroke();
    }
    // tube highlight
    ctx.strokeStyle = 'rgba(255,255,255,0.28)';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(pts[0].x - 1.5, pts[0].y - 2);
    for (let i = 1; i < n; i++) ctx.lineTo(pts[i].x - 1.5, pts[i].y - 2);
    ctx.stroke();
    // scale dots
    ctx.fillStyle = 'rgba(8,10,30,0.28)';
    for (let i = 2; i < n - 1; i += 1) {
      ctx.beginPath();
      ctx.arc(pts[i].x, pts[i].y, 1.8, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawHead(ctx, x, y, ang, o) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(ang);
    // tongue
    if (o.tongue > 0 && !o.dead) {
      const L = 6 + 6 * Math.sin(o.tongue * Math.PI);
      ctx.strokeStyle = '#FF5D73';
      ctx.lineWidth = 1.6;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(9, 0); ctx.lineTo(9 + L, 0);
      ctx.moveTo(9 + L, 0); ctx.lineTo(9 + L + 3, -2.5);
      ctx.moveTo(9 + L, 0); ctx.lineTo(9 + L + 3, 2.5);
      ctx.stroke();
    }
    // head
    ctx.fillStyle = '#070817';
    ctx.beginPath(); ctx.ellipse(0, 0, 12.5, 11, 0, 0, Math.PI * 2); ctx.fill();
    const g = ctx.createRadialGradient(3, -3, 1, 0, 0, 12);
    g.addColorStop(0, o.dead ? '#FFE3E8' : '#C8FFE4');
    g.addColorStop(0.5, o.dead ? '#C77B8A' : '#5CF2A5');
    g.addColorStop(1, o.dead ? '#6E4652' : '#1FB27A');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.ellipse(0, 0, 11, 9.6, 0, 0, Math.PI * 2); ctx.fill();
    // eyes
    for (const s of [-1, 1]) {
      const ex = 3.2, ey = s * 4.6;
      if (o.dead) {
        ctx.strokeStyle = '#0D0F22';
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(ex - 2.2, ey - 2.2); ctx.lineTo(ex + 2.2, ey + 2.2);
        ctx.moveTo(ex + 2.2, ey - 2.2); ctx.lineTo(ex - 2.2, ey + 2.2);
        ctx.stroke();
      } else if (o.blink) {
        ctx.strokeStyle = '#0D0F22';
        ctx.lineWidth = 1.6;
        ctx.beginPath(); ctx.moveTo(ex - 2.4, ey); ctx.lineTo(ex + 2.4, ey); ctx.stroke();
      } else {
        ctx.fillStyle = '#FFFFFF';
        ctx.beginPath(); ctx.arc(ex, ey, 3.5, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#0D0F22';
        ctx.beginPath(); ctx.arc(ex + 1.3, ey, 2, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(ex + 1.6, ey - 1.4, 0.9, 0.9);
      }
    }
    ctx.restore();
  }

  function drawFruit(ctx, x, y, s, t) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(s, s);
    ctx.globalCompositeOperation = 'lighter';
    const gl = ctx.createRadialGradient(0, 0, 2, 0, 0, 17);
    gl.addColorStop(0, 'rgba(255,93,115,0.5)');
    gl.addColorStop(1, 'rgba(255,93,115,0)');
    ctx.fillStyle = gl;
    ctx.fillRect(-17, -17, 34, 34);
    ctx.globalCompositeOperation = 'source-over';
    const g = ctx.createRadialGradient(-2.5, -1, 1, 0, 1.5, 8);
    g.addColorStop(0, '#FFB3BF'); g.addColorStop(0.45, '#FF5D73'); g.addColorStop(1, '#C0204A');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(0, 1.5, 7, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.beginPath(); ctx.ellipse(-2.6, -1, 1.6, 1.1, -0.6, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#7A4A2A'; ctx.lineWidth = 1.4; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(0, -5); ctx.quadraticCurveTo(0.5, -7.5, 1.5, -8.5); ctx.stroke();
    ctx.fillStyle = '#5CF2A5';
    ctx.beginPath(); ctx.ellipse(4, -7, 3.6, 1.8, -0.5 + Math.sin(t * 3) * 0.12, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  function drawGold(ctx, x, y, s, t, frac) {
    ctx.save();
    ctx.translate(x, y);
    // timer ring
    if (frac != null) {
      ctx.strokeStyle = 'rgba(255,210,63,0.25)';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(0, 0, 13, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = '#FFD23F';
      ctx.beginPath(); ctx.arc(0, 0, 13, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frac); ctx.stroke();
    }
    ctx.scale(s, s);
    ctx.globalCompositeOperation = 'lighter';
    const gl = ctx.createRadialGradient(0, 0, 2, 0, 0, 22);
    gl.addColorStop(0, 'rgba(255,210,63,0.6)');
    gl.addColorStop(1, 'rgba(255,210,63,0)');
    ctx.fillStyle = gl;
    ctx.fillRect(-22, -22, 44, 44);
    // sparkle rays
    ctx.strokeStyle = 'rgba(255,240,180,0.7)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let k = 0; k < 4; k++) {
      const a = t * 1.5 + k * Math.PI / 2;
      ctx.moveTo(Math.cos(a) * 9, Math.sin(a) * 9);
      ctx.lineTo(Math.cos(a) * 15, Math.sin(a) * 15);
    }
    ctx.stroke();
    ctx.globalCompositeOperation = 'source-over';
    // star gem
    ctx.rotate(Math.sin(t * 2) * 0.2);
    const g = ctx.createLinearGradient(0, -8, 0, 8);
    g.addColorStop(0, '#FFF3B0'); g.addColorStop(0.5, '#FFD23F'); g.addColorStop(1, '#E08A1E');
    ctx.fillStyle = g;
    ctx.beginPath();
    for (let k = 0; k < 10; k++) {
      const r = k % 2 ? 3.8 : 8.5;
      const a = -Math.PI / 2 + k * Math.PI / 5;
      if (k) ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r); else ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#8A5A10'; ctx.lineWidth = 0.8; ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.beginPath(); ctx.arc(-1.8, -2.4, 1.2, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  function drawStone(ctx, x, y, s) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(s, s);
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    rr(ctx, -8, -6, 18, 16, 5); ctx.fill();
    const g = ctx.createLinearGradient(0, -9, 0, 9);
    g.addColorStop(0, '#7C77B4'); g.addColorStop(1, '#3B3868');
    ctx.fillStyle = g;
    rr(ctx, -9, -9, 18, 18, 5); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    rr(ctx, -7, -7.5, 14, 4, 2); ctx.fill();
    ctx.strokeStyle = 'rgba(20,18,50,0.7)';
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.moveTo(-3, -2); ctx.lineTo(0, 1); ctx.lineTo(-1, 5);
    ctx.moveTo(0, 1); ctx.lineTo(4, 2);
    ctx.stroke();
    ctx.restore();
  }

  function rr(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function drawBoard(ctx, ox, oy, cols, rows, cell) {
    ctx.fillStyle = '#0C0E24';
    ctx.fillRect(ox, oy, cols * cell, rows * cell);
    ctx.fillStyle = '#10132D';
    for (let y = 0; y < rows; y++) {
      for (let x = (y % 2); x < cols; x += 2) ctx.fillRect(ox + x * cell, oy + y * cell, cell, cell);
    }
    ctx.fillStyle = 'rgba(61,220,255,0.10)';
    for (let y = 1; y < rows; y++) for (let x = 1; x < cols; x++) ctx.fillRect(ox + x * cell - 1, oy + y * cell - 1, 2, 2);
  }

  // ---------------------------------------------------------------------------
  Arcade.register({
    id: 'coil',
    title: 'Coil',
    genre: 'Snake',
    tagline: 'Grow long, go fast, and never bite your own tail.',
    width: W, height: H,
    controls: ['← ↑ → ↓ steer (queue 2 turns)', 'Gold star = +50, grab it fast', 'Swipe on touch'],
    pad: ['left', 'up', 'down', 'right'],

    art(ctx, w, h, t) {
      drawBoard(ctx, 0, 0, 16, 10, 20);
      const vg = ctx.createRadialGradient(w / 2, h / 2, 40, w / 2, h / 2, 200);
      vg.addColorStop(0, 'rgba(61,220,255,0.10)'); vg.addColorStop(1, 'rgba(13,15,34,0.6)');
      ctx.fillStyle = vg; ctx.fillRect(0, 0, w, h);
      const ccx = w / 2, ccy = h / 2 + 4;
      // spiral, tail outside -> head near the fruit
      const pts = [];
      const turns = 2.1 * Math.PI * 2;
      for (let a = 0; a <= turns; a += 0.16) {
        const k = a / turns;
        const r = lerp(88, 26, k);
        const ang = a + t * 0.35;
        pts.push({ x: ccx + Math.cos(ang) * r * 1.35, y: ccy + Math.sin(ang) * r * 0.82 });
      }
      pts.reverse(); // head first
      drawBody(ctx, pts, { w0: 16, w1: 7 });
      const hd = pts[0], nx = pts[1];
      const ang = Math.atan2(hd.y - nx.y, hd.x - nx.x);
      drawHead(ctx, hd.x, hd.y, ang, { tongue: (t % 2.4) < 0.4 ? (t % 2.4) / 0.4 : 0, blink: (t % 3.3) < 0.12 });
      drawFruit(ctx, ccx, ccy + Math.sin(t * 3) * 1.5, 1.35, t);
      drawGold(ctx, w - 36, 32, 0.9, t, null);
      ctx.strokeStyle = 'rgba(61,220,255,0.55)';
      ctx.lineWidth = 2;
      ctx.strokeRect(1, 1, w - 2, h - 2);
    },

    create(host) {
      const P = host.palette;
      let snake, prevTail, grew, dir, queue, acc, tickLen, fruit, gold, stones, eaten, level, score;
      let dead, deadT, ended, pulses, parts, floats, gulp, banner, shake, headAng, lastUpd, lastRT, blinkT, tongueT, fruitsSinceGold;

      function occupied(x, y, skipTail) {
        for (let i = 0; i < snake.length - (skipTail ? 1 : 0); i++) if (snake[i].x === x && snake[i].y === y) return true;
        return false;
      }
      function stoneAt(x, y) { for (const s of stones) if (s.x === x && s.y === y) return true; return false; }
      function freeCell(extra) {
        for (let tries = 0; tries < 400; tries++) {
          const x = Math.floor(Math.random() * N), y = Math.floor(Math.random() * N);
          if (occupied(x, y) || stoneAt(x, y)) continue;
          if (fruit && fruit.x === x && fruit.y === y) continue;
          if (gold && gold.x === x && gold.y === y) continue;
          if (extra && !extra(x, y)) continue;
          return { x, y };
        }
        // exhaustive fallback
        for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
          if (occupied(x, y) || stoneAt(x, y)) continue;
          if (fruit && fruit.x === x && fruit.y === y) continue;
          if (gold && gold.x === x && gold.y === y) continue;
          return { x, y };
        }
        return null;
      }
      function placeFruit() {
        const c = freeCell();
        fruit = c ? { x: c.x, y: c.y, born: host.time } : null;
      }
      function addStones(count) {
        const hd = snake[0];
        for (let k = 0; k < count; k++) {
          const c = freeCell((x, y) => {
            if (x < 1 || y < 1 || x > N - 2 || y > N - 2) return false;
            if (Math.abs(x - hd.x) + Math.abs(y - hd.y) < 5) return false;
            // not in the line of travel just ahead
            for (let s = 1; s <= 7; s++) if (hd.x + dir.x * s === x && hd.y + dir.y * s === y) return false;
            for (const st of stones) if (Math.abs(st.x - x) <= 1 && Math.abs(st.y - y) <= 1) return false;
            return true;
          });
          if (c) stones.push({ x: c.x, y: c.y, born: host.time });
        }
      }
      function calcTick() { return Math.max(0.07, 0.155 - (snake.length - 4) * 0.0022); }

      function reset() {
        snake = [{ x: 7, y: 10 }, { x: 6, y: 10 }, { x: 5, y: 10 }, { x: 4, y: 10 }];
        prevTail = { x: 3, y: 10 }; grew = false;
        dir = { x: 1, y: 0 }; queue = [];
        acc = 0; tickLen = calcTick();
        stones = []; gold = null; fruit = null;
        eaten = 0; level = 1; score = 0; fruitsSinceGold = 0;
        dead = false; deadT = 0; ended = false;
        pulses = []; parts = []; floats = []; gulp = null; banner = null; shake = 0;
        headAng = 0; lastUpd = -1; lastRT = host.time; blinkT = 2.5; tongueT = 1.2;
        fruit = { x: 13, y: 7, born: host.time - 1 };
        host.score(0);
      }

      function die() {
        dead = true; deadT = 0;
        host.sfx('hit');
        shake = 1;
        const hx = cx(snake[0].x) + dir.x * 8, hy = cy(snake[0].y) + dir.y * 8;
        for (let i = 0; i < 26; i++) {
          const a = rand(0, Math.PI * 2), v = rand(60, 240);
          parts.push({ x: hx, y: hy, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: rand(0.4, 0.9), max: 0.9, c: i % 3 ? '#FF5D73' : '#FFD23F', r: rand(1.5, 3) });
        }
      }

      function burst(x, y, col, n) {
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2 + rand(-0.2, 0.2), v = rand(50, 140);
          parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: rand(0.3, 0.6), max: 0.6, c: col, r: rand(1.2, 2.4) });
        }
        parts.push({ x, y, ring: true, life: 0.4, max: 0.4, c: col });
      }

      function tick() {
        if (gulp) { burst(cx(gulp.x), cy(gulp.y), gulp.gold ? '#FFD23F' : '#FF5D73', gulp.gold ? 16 : 10); gulp = null; }
        if (queue.length) dir = queue.shift();
        const hd = snake[0];
        const nx = hd.x + dir.x, ny = hd.y + dir.y;
        if (nx < 0 || ny < 0 || nx >= N || ny >= N || stoneAt(nx, ny)) { die(); return; }
        const eatF = fruit && fruit.x === nx && fruit.y === ny;
        const eatG = gold && gold.x === nx && gold.y === ny;
        const growing = eatF || eatG;
        if (occupied(nx, ny, !growing)) { die(); return; }
        snake.unshift({ x: nx, y: ny });
        if (growing) { grew = true; prevTail = null; } else { prevTail = snake.pop(); grew = false; }

        if (eatF) {
          eaten++; fruitsSinceGold++;
          score += 10;
          host.sfx('coin');
          gulp = { x: nx, y: ny, gold: false };
          floats.push({ x: cx(nx), y: cy(ny) - 8, t: 0, txt: '+10', c: P.text });
          pulses.push({ pos: 0 });
          fruit = null;
          placeFruit();
          if (fruitsSinceGold >= 5) {
            fruitsSinceGold = 0;
            const c = freeCell((x, y) => Math.abs(x - nx) + Math.abs(y - ny) > 3);
            if (c) gold = { x: c.x, y: c.y, life: 5, max: 5, born: host.time };
          }
          const nl = 1 + Math.floor(eaten / 5);
          if (nl !== level) {
            level = nl;
            let sub = 'FASTER';
            if (level >= 3 && stones.length < 16) {
              addStones(level === 3 ? 3 : 2);
              sub = level === 3 ? 'WATCH THE STONES' : 'MORE STONES';
            }
            banner = { t: 0, txt: 'LEVEL ' + level, sub };
          }
        }
        if (eatG) {
          score += 50;
          host.sfx('clear');
          gulp = { x: nx, y: ny, gold: true };
          floats.push({ x: cx(nx), y: cy(ny) - 8, t: 0, txt: '+50', c: P.marquee, big: true });
          pulses.push({ pos: 0, big: true });
          gold = null;
        }
        if (growing) host.score(score);
        tickLen = calcTick();
      }

      function update(dt) {
        lastUpd = host.time;
        if (dead) {
          deadT += dt;
          if (deadT > 0.6 && !ended) { ended = true; host.gameOver(); }
          return;
        }
        if (gold) {
          gold.life -= dt;
          if (gold.life <= 0) { burst(cx(gold.x), cy(gold.y), 'rgba(255,210,63,0.6)', 8); gold = null; }
        }
        for (let i = pulses.length - 1; i >= 0; i--) {
          pulses[i].pos += dt / tickLen * 1.6;
          if (pulses[i].pos > snake.length + 3) pulses.splice(i, 1);
        }
        blinkT -= dt; if (blinkT < -0.13) blinkT = rand(2.2, 4.5);
        tongueT -= dt; if (tongueT < -0.3) tongueT = rand(1.6, 3.4);
        acc += dt;
        while (acc >= tickLen && !dead) {
          acc -= tickLen;
          tick();
        }
      }

      function fx(dt) {
        for (let i = parts.length - 1; i >= 0; i--) {
          const p = parts[i];
          p.life -= dt;
          if (p.life <= 0) { parts.splice(i, 1); continue; }
          if (!p.ring) { p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 1 - dt * 3; p.vy *= 1 - dt * 3; }
        }
        for (let i = floats.length - 1; i >= 0; i--) { floats[i].t += dt; if (floats[i].t > 0.9) floats.splice(i, 1); }
        if (banner) { banner.t += dt; if (banner.t > 1.6) banner = null; }
        shake = Math.max(0, shake - dt * 3);
      }

      function render(ctx) {
        const now = host.time;
        const rdt = clamp(now - lastRT, 0, 0.05);
        lastRT = now;
        if (dead || now - lastUpd < 0.12) fx(rdt);
        const t = now;

        ctx.fillStyle = P.ink;
        ctx.fillRect(0, 0, W, H);

        ctx.save();
        if (shake > 0) ctx.translate(rand(-1, 1) * shake * 5, rand(-1, 1) * shake * 5);

        drawBoard(ctx, 0, TOP, N, N, CELL);

        // stones
        for (const s of stones) {
          const k = clamp((t - s.born) / 0.35, 0, 1);
          ctx.globalAlpha = k;
          drawStone(ctx, cx(s.x), cy(s.y) - (1 - k) * 14, 1 + (1 - k) * 0.4);
        }
        ctx.globalAlpha = 1;

        // fruit
        if (fruit) {
          const k = clamp((t - fruit.born) / 0.25, 0, 1);
          const pop = k < 1 ? 1 - Math.pow(1 - k, 3) * 1 + Math.sin(k * Math.PI) * 0.25 : 1;
          drawFruit(ctx, cx(fruit.x), cy(fruit.y) + Math.sin(t * 4) * 1.2, pop, t);
        }
        if (gold) {
          const f = clamp(gold.life / gold.max, 0, 1);
          const vis = f > 0.3 || Math.sin(t * 22) > -0.3;
          if (vis) drawGold(ctx, cx(gold.x), cy(gold.y), 0.65 + 0.35 * f + Math.sin(t * 6) * 0.04, t, f);
        }

        // snake (interpolated)
        const p = dead ? 1 : clamp(acc / tickLen, 0, 1);
        const C = snake;
        const pts = [];
        let hx = lerp(cx(C[1].x), cx(C[0].x), p), hy = lerp(cy(C[1].y), cy(C[0].y), p);
        if (dead) {
          const b = Math.sin(clamp(deadT / 0.25, 0, 1) * Math.PI) * 5;
          hx += dir.x * b; hy += dir.y * b;
        }
        pts.push({ x: hx, y: hy });
        for (let i = 1; i < C.length; i++) pts.push({ x: cx(C[i].x), y: cy(C[i].y) });
        if (!grew && prevTail) pts.push({ x: lerp(cx(prevTail.x), cx(C[C.length - 1].x), p), y: lerp(cy(prevTail.y), cy(C[C.length - 1].y), p) });

        // gulp: fruit shrinking into the mouth
        if (gulp) {
          const s = 1 - p;
          if (s > 0.02) {
            if (gulp.gold) drawGold(ctx, cx(gulp.x), cy(gulp.y), s, t, null);
            else drawFruit(ctx, cx(gulp.x), cy(gulp.y), s, t);
          }
        }

        const bulge = pulses.length ? (k) => {
          let b = 0;
          for (const q of pulses) { const d = k - q.pos; b += (q.big ? 7 : 5) * Math.exp(-d * d / 1.4); }
          return b;
        } : null;
        drawBody(ctx, pts, { w0: 15, w1: 8, bulge, dead, flash: dead && Math.sin(deadT * 40) > 0 && deadT < 0.35 });

        // head orientation (smoothly turned)
        const tgt = Math.atan2(C[0].y - C[1].y, C[0].x - C[1].x);
        let da = tgt - headAng;
        while (da > Math.PI) da -= Math.PI * 2;
        while (da < -Math.PI) da += Math.PI * 2;
        headAng += da * Math.min(1, rdt * 22);
        if (Math.abs(da) > 2.5) headAng = tgt;
        drawHead(ctx, hx, hy, headAng, { dead, blink: blinkT < 0 && blinkT > -0.13, tongue: tongueT < 0 ? -tongueT / 0.3 : 0 });

        // particles
        ctx.globalCompositeOperation = 'lighter';
        for (const q of parts) {
          const a = clamp(q.life / q.max, 0, 1);
          ctx.globalAlpha = a;
          if (q.ring) {
            ctx.strokeStyle = q.c;
            ctx.lineWidth = 2;
            ctx.beginPath(); ctx.arc(q.x, q.y, 6 + (1 - a) * 18, 0, Math.PI * 2); ctx.stroke();
          } else {
            ctx.fillStyle = q.c;
            ctx.beginPath(); ctx.arc(q.x, q.y, q.r, 0, Math.PI * 2); ctx.fill();
          }
        }
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 1;

        // floating score text
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        for (const f of floats) {
          const k = f.t / 0.9;
          ctx.globalAlpha = k < 0.6 ? 1 : 1 - (k - 0.6) / 0.4;
          ctx.font = (f.big ? '18px ' : '13px ') + DISP;
          ctx.fillStyle = 'rgba(8,8,24,0.8)';
          ctx.fillText(f.txt, f.x + 1.5, f.y - k * 26 + 1.5);
          ctx.fillStyle = f.c;
          ctx.fillText(f.txt, f.x, f.y - k * 26);
        }
        ctx.globalAlpha = 1;

        // board frame
        ctx.strokeStyle = dead ? 'rgba(255,93,115,0.8)' : 'rgba(61,220,255,0.55)';
        ctx.lineWidth = 2;
        ctx.strokeRect(1, TOP + 1, W - 2, N * CELL - 2);
        ctx.strokeStyle = dead ? 'rgba(255,93,115,0.18)' : 'rgba(61,220,255,0.14)';
        ctx.lineWidth = 6;
        ctx.strokeRect(4, TOP + 4, W - 8, N * CELL - 8);

        // level banner
        if (banner) {
          const k = banner.t / 1.6;
          const a = k < 0.15 ? k / 0.15 : k > 0.7 ? 1 - (k - 0.7) / 0.3 : 1;
          const sc = k < 0.15 ? 0.8 + k / 0.15 * 0.2 : 1;
          ctx.save();
          ctx.globalAlpha = a * 0.95;
          ctx.translate(W / 2, TOP + 200 - k * 10);
          ctx.scale(sc, sc);
          ctx.font = '34px ' + DISP;
          ctx.fillStyle = P.coral;
          ctx.fillText(banner.txt, 3, 3);
          ctx.fillStyle = P.marquee;
          ctx.fillText(banner.txt, 0, 0);
          ctx.font = '600 12px ' + MONO;
          ctx.fillStyle = P.text;
          ctx.fillText(banner.sub, 0, 30);
          ctx.restore();
        }
        ctx.restore();

        drawStrip(ctx, t);
      }

      function drawStrip(ctx, t) {
        ctx.fillStyle = P.ink;
        ctx.fillRect(0, 0, W, TOP);
        ctx.fillStyle = P.line;
        ctx.fillRect(0, TOP - 1, W, 1);
        ctx.textBaseline = 'middle';
        ctx.textAlign = 'left';
        ctx.font = '600 10px ' + MONO;
        ctx.fillStyle = P.muted;
        ctx.fillText('LENGTH', 14, TOP / 2);
        ctx.font = '600 15px ' + MONO;
        ctx.fillStyle = P.mint;
        ctx.fillText(String(snake.length), 62, TOP / 2 + 0.5);
        ctx.textAlign = 'center';
        ctx.font = '600 10px ' + MONO;
        ctx.fillStyle = P.muted;
        ctx.fillText('LEVEL', W / 2 - 12, TOP / 2);
        ctx.font = '600 15px ' + MONO;
        ctx.fillStyle = P.text;
        ctx.textAlign = 'left';
        ctx.fillText(String(level), W / 2 + 10, TOP / 2 + 0.5);
        // progress to next golden star
        const bx = W - 18;
        for (let i = 0; i < 5; i++) {
          const x = bx - (4 - i) * 14, y = TOP / 2;
          const on = i < fruitsSinceGold;
          ctx.save();
          ctx.translate(x, y);
          ctx.rotate(Math.PI / 4);
          ctx.fillStyle = on ? P.marquee : 'transparent';
          ctx.strokeStyle = on ? P.marquee : P.line;
          ctx.lineWidth = 1.5;
          ctx.beginPath(); ctx.rect(-3.5, -3.5, 7, 7);
          if (on) ctx.fill();
          ctx.stroke();
          ctx.restore();
        }
        if (gold) {
          const f = clamp(gold.life / gold.max, 0, 1);
          ctx.fillStyle = 'rgba(255,210,63,0.25)';
          ctx.fillRect(bx - 60, TOP - 6, 64, 2);
          ctx.fillStyle = P.marquee;
          ctx.fillRect(bx - 60, TOP - 6, 64 * f, 2);
        }
      }

      function onAction(a) {
        if (dead) return;
        const d = DIRS[a];
        if (!d) return; // 'action' is a no-op
        const last = queue.length ? queue[queue.length - 1] : dir;
        if ((d.x === last.x && d.y === last.y) || (d.x === -last.x && d.y === -last.y)) return;
        if (queue.length < 2) queue.push(d);
      }

      return { reset, update, render, onAction, onRelease() {}, destroy() { parts = []; floats = []; } };
    }
  });
})();
