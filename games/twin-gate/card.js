// Lobby card for 双门 Twin Gate (the game itself is index.html + src/).
Arcade.register({
  id: 'twin-gate', title: '双门 Twin Gate', genre: '3D gate puzzler',
  tagline: 'Two linked doorways, fifteen trials, one evaluator keeping count. Fall in one gate, fly out the other.',
  controls: 'Mouse look · click gates · WASD · E hold',
  hi() {
    try { const s = JSON.parse(localStorage.getItem('twin-gate.v1')); const n = s && s.done ? Object.keys(s.done).length : 0; return ['TRIALS', String(n).padStart(2, '0') + '/16']; } catch (e) { return ['TRIALS', '00/16']; }
  },
  art(c, w, h, t) {
    // a white test chamber in one-point perspective; a figure loops out of vermilion and into jade
    const vx = w * 0.5, vy = h * 0.46, bw = w * 0.34, bh = h * 0.42;               // back wall rectangle
    const bl = vx - bw / 2, br = vx + bw / 2, bt = vy - bh / 2, bb = vy + bh / 2;
    const P = (pts, fill) => { c.beginPath(); c.moveTo(pts[0], pts[1]); for (let i = 2; i < pts.length; i += 2) c.lineTo(pts[i], pts[i + 1]); c.closePath(); c.fillStyle = fill; c.fill(); };
    P([0, 0, w, 0, br, bt, bl, bt], '#c9cdc9');                                       // ceiling
    P([0, h, w, h, br, bb, bl, bb], '#6f7672');                                       // floor
    P([0, 0, bl, bt, bl, bb, 0, h], '#e3e6e2');                                       // left wall
    P([w, 0, br, bt, br, bb, w, h], '#d5d9d5');                                       // right wall
    c.fillStyle = '#eceee9'; c.fillRect(bl, bt, bw, bh);                              // back wall
    // panel seams converging to the vanishing point
    c.strokeStyle = 'rgba(40,48,46,.18)'; c.lineWidth = 1;
    for (let k = 1; k < 5; k++) { const x = bl + bw * k / 5; c.beginPath(); c.moveTo(x, bt); c.lineTo(x, bb); c.stroke(); }
    for (let k = 1; k < 4; k++) { const y = bt + bh * k / 4; c.beginPath(); c.moveTo(bl, y); c.lineTo(br, y); c.stroke(); }
    for (let k = 0; k < 6; k++) { const f = k / 6; c.beginPath(); c.moveTo(bl + (0 - bl) * f * 0, bt + (bb - bt) * f); c.lineTo(0, h * f); c.stroke(); c.beginPath(); c.moveTo(br, bt + (bb - bt) * f); c.lineTo(w, h * f); c.stroke(); }
    for (let k = 1; k < 7; k++) { const x = bl + bw * k / 7; c.beginPath(); c.moveTo(x, bb); c.lineTo(vx + (x - vx) * 3.2, h); c.stroke(); }
    // ceiling lamps
    c.fillStyle = 'rgba(255,255,255,.95)'; P([vx - 18, bt - 6, vx + 18, bt - 6, vx + 40, 10, vx - 40, 10], 'rgba(255,255,255,.9)');
    // gates with flickering rims
    const gate = (x, y, rx, ry, col, glow, inner) => {
      c.save();
      c.fillStyle = inner; c.beginPath(); c.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); c.fill();
      for (let k = 0; k < 3; k++) { c.strokeStyle = k ? glow : col; c.lineWidth = [3, 7, 12][k]; c.globalAlpha = [1, 0.35, 0.15][k] * (0.85 + 0.15 * Math.sin(t * 9 + k + x)); c.beginPath(); c.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); c.stroke(); }
      c.globalAlpha = 1;
      for (let k = 0; k < 10; k++) { const a = t * 1.7 + k * 0.63 + x; c.fillStyle = col; c.globalAlpha = 0.5 + 0.5 * Math.sin(t * 5 + k); c.beginPath(); c.arc(x + Math.cos(a) * rx * 1.05, y + Math.sin(a) * ry * 1.05, 1.3, 0, 7); c.fill(); }
      c.restore();
    };
    // jade on the left wall: its view shows a small vermilion gate far away (recursion)
    gate(w * 0.13, h * 0.52, 11, 34, '#2fe6c0', '#7fffe6', '#2c3431');
    c.fillStyle = '#e6e9e5'; c.beginPath(); c.ellipse(w * 0.13, h * 0.52, 8, 29, 0, 0, 7); c.fill();
    c.strokeStyle = '#ff5a36'; c.lineWidth = 1.5; c.beginPath(); c.ellipse(w * 0.13 + 1, h * 0.5, 3, 9, 0, 0, 7); c.stroke();
    // vermilion on the back wall, low
    const gx = vx + bw * 0.18, gy = bb - 22;
    gate(gx, gy, 12, 21, '#ff5a36', '#ffb09a', '#3b302c');
    c.fillStyle = '#d7dbd7'; c.beginPath(); c.ellipse(gx, gy, 9, 17, 0, 0, 7); c.fill();
    // the flying figure: out of vermilion, over the room, into jade
    const T = (t * 0.42) % 1, x0 = gx, y0 = gy, x1 = w * 0.13, y1 = h * 0.52;
    const fx = x0 + (x1 - x0) * T, fy = y0 + (y1 - y0) * T - Math.sin(T * Math.PI) * 70;
    for (let k = 1; k < 7; k++) { const tt = Math.max(0, T - k * 0.025); const tx = x0 + (x1 - x0) * tt, ty = y0 + (y1 - y0) * tt - Math.sin(tt * Math.PI) * 70; c.fillStyle = `rgba(255,120,80,${0.3 - k * 0.04})`; c.beginPath(); c.arc(tx, ty, 4 - k * 0.4, 0, 7); c.fill(); }
    c.save(); c.translate(fx, fy); c.rotate(-0.8 + T * 2.2);
    c.fillStyle = '#1b2023'; c.beginPath(); c.arc(0, -8, 3.2, 0, 7); c.fill(); c.fillRect(-2.5, -5, 5, 9);
    c.strokeStyle = '#1b2023'; c.lineWidth = 2.2; c.lineCap = 'round';
    c.beginPath(); c.moveTo(-1, 4); c.lineTo(-4, 10); c.moveTo(1, 4); c.lineTo(4, 9); c.moveTo(-2, -3); c.lineTo(-6, 1); c.moveTo(2, -3); c.lineTo(7, -5); c.stroke();
    c.fillStyle = '#eef0ec'; c.fillRect(4, -7, 6, 3); c.restore();
    // a block on a button
    const bx = vx - bw * 0.3, by = bb + 30;
    c.fillStyle = '#2b3034'; c.beginPath(); c.ellipse(bx, by + 6, 20, 5, 0, 0, 7); c.fill();
    c.fillStyle = '#c9392a'; c.beginPath(); c.ellipse(bx, by + 4, 15, 3.6, 0, 0, 7); c.fill();
    c.fillStyle = '#b9bdbc'; c.fillRect(bx - 9, by - 13, 18, 17); c.fillStyle = '#9ea3a2'; c.fillRect(bx - 6, by - 10, 12, 11);
    c.strokeStyle = `rgba(160,255,230,${0.6 + 0.4 * Math.sin(t * 3)})`; c.lineWidth = 1.6; c.beginPath(); c.arc(bx, by - 4.5, 3.5, 0, 7); c.stroke();
    // soft vignette
    const v = c.createRadialGradient(vx, vy, 40, vx, vy, w * 0.75); v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(10,14,16,.45)');
    c.fillStyle = v; c.fillRect(0, 0, w, h);
  }
});
