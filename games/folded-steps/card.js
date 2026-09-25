// Lobby card for 折阶 Folded Steps (the game itself is index.html + src/).
Arcade.register({
  id: 'folded-steps', title: 'Folded Steps', genre: 'Impossible-geometry puzzle',
  tagline: 'Turn cranks, walk up walls and cross bridges that only exist from where you stand.',
  controls: 'Tap to walk · drag cranks · Z undo',
  hi() { try { const n = +localStorage.getItem('coinslot-best-folded-steps') || 0; return ['FOLDS', n + '/12']; } catch (e) { return null; } },
  art(c, w, h, t) {
    // sky
    const g = c.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#e9b8c9'); g.addColorStop(0.6, '#fbe8ea'); g.addColorStop(1, '#f2d8cf');
    c.fillStyle = g; c.fillRect(0, 0, w, h);
    c.fillStyle = 'rgba(255,240,220,.8)'; c.beginPath(); c.arc(w * 0.78, h * 0.2, 18, 0, 7); c.fill();
    for (let i = 0; i < 14; i++) { const x = (i * 71) % w, y = (i * 37) % (h * 0.5); c.fillStyle = `rgba(255,255,255,${0.35 + 0.3 * Math.sin(t * 2 + i)})`; c.fillRect(x, y, 1.5, 1.5); }
    // lake
    const lk = c.createLinearGradient(0, h * 0.6, 0, h);
    lk.addColorStop(0, '#c2b6dc'); lk.addColorStop(1, '#7a78b3');
    c.fillStyle = lk; c.fillRect(0, h * 0.62, w, h);
    c.strokeStyle = 'rgba(255,255,255,.35)'; c.lineWidth = 1;
    for (let k = 0; k < 7; k++) { const y = h * 0.66 + k * 8 + Math.sin(t + k) * 1.5; c.beginPath(); c.moveTo(0, y); for (let x = 0; x <= w; x += 10) c.lineTo(x, y + Math.sin(x * 0.05 + t * 1.6 + k) * 1.2); c.stroke(); }
    // an impossible triangle of cubes: +x, then up +y, then +z lands back on the start (z = -x - y on screen)
    const S = 15, ox = w * 0.42, oy = h * 0.5;
    const P = (x, y, z) => [ox + (x - z) * S * 0.866, oy - y * S + (x + z) * S * 0.5];
    const poly = (pts, col) => { c.beginPath(); pts.forEach((p, i) => (i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1]))); c.closePath(); c.fillStyle = col; c.fill(); };
    const cube = (x, y, z, k) => {
      const q = 0.5;
      poly([P(x - q, y + q, z - q), P(x + q, y + q, z - q), P(x + q, y + q, z + q), P(x - q, y + q, z + q)], k[0]);
      poly([P(x - q, y + q, z + q), P(x + q, y + q, z + q), P(x + q, y - q, z + q), P(x - q, y - q, z + q)], k[1]);
      poly([P(x + q, y + q, z - q), P(x + q, y + q, z + q), P(x + q, y - q, z + q), P(x + q, y - q, z - q)], k[2]);
    };
    const stone = ['#fff4ef', '#dca9b9', '#a8779a'], mech = ['#ffe0a0', '#e9b25a', '#c48c3e'], dark = ['#f3d6dc', '#c792aa', '#94668a'];
    const N = 5;
    const cells = [];
    for (let i = 0; i < N; i++) cells.push([i, 0, 0, i === 0 ? mech : stone]);
    for (let j = 1; j < N; j++) cells.push([N - 1, j, 0, dark]);
    for (let k = 1; k < N - 1; k++) cells.push([N - 1, N - 1, k, stone]);
    // support columns into the lake
    for (let y = -4; y < 0; y++) cells.push([0, y, 0, dark], [N - 1, y, 0, dark]);
    cells.sort((a, b) => a[0] + a[1] + a[2] - (b[0] + b[1] + b[2]));
    for (const [x, y, z, k] of cells) cube(x, y, z, k);
    // the impossible overlap: the far start cube is drawn over the near end of the third beam
    cube(0, 0, 0, mech);
    // a crank on the high corner, turning
    const cp = P(N - 1, N - 0.4, 0);
    c.strokeStyle = '#d9546a'; c.lineWidth = 2;
    c.beginPath(); c.ellipse(cp[0], cp[1], 10, 5.5, 0, 0, 7); c.stroke();
    for (let k = 0; k < 4; k++) { const a = t * 1.2 + (k * Math.PI) / 2; c.beginPath(); c.moveTo(cp[0], cp[1]); c.lineTo(cp[0] + Math.cos(a) * 10, cp[1] + Math.sin(a) * 5.5); c.stroke(); }
    // the gate at the start of the loop, with its glyph
    const gp = P(2, 0.5, 0);
    c.strokeStyle = '#9b87c9'; c.lineWidth = 2.2; c.beginPath(); c.arc(gp[0], gp[1] - 8, 6, Math.PI, 0); c.stroke();
    c.beginPath(); c.moveTo(gp[0] - 6, gp[1] - 8); c.lineTo(gp[0] - 6, gp[1] + 1); c.moveTo(gp[0] + 6, gp[1] - 8); c.lineTo(gp[0] + 6, gp[1] + 1); c.stroke();
    const gl = 0.6 + 0.4 * Math.sin(t * 3);
    c.fillStyle = `rgba(255,214,130,${0.4 * gl})`; c.beginPath(); c.arc(gp[0], gp[1] - 18, 10, 0, 7); c.fill();
    c.fillStyle = '#ffe09a'; c.beginPath(); c.moveTo(gp[0], gp[1] - 24); c.lineTo(gp[0] + 4, gp[1] - 18); c.lineTo(gp[0], gp[1] - 12); c.lineTo(gp[0] - 4, gp[1] - 18); c.fill();
    // the pilgrim walks the top beam and steps, impossibly, back onto the bottom one
    const u = (t * 0.12) % 1;
    const L1 = N - 2, L2 = N - 1;
    let wp;
    if (u < 0.55) { const f = u / 0.55; wp = P(N - 1, N - 0.5, 1 + f * (L1 - 0.5)); }
    else { const f = (u - 0.55) / 0.45; wp = P(f * (L2 - 1) + 0.0, 0.5, 0); }
    const bob = Math.abs(Math.sin(t * 9)) * 1.1;
    c.fillStyle = '#3f5d7e'; c.beginPath(); c.moveTo(wp[0] - 3.6, wp[1]); c.lineTo(wp[0] + 3.6, wp[1]); c.lineTo(wp[0] + 1.4, wp[1] - 8 - bob); c.lineTo(wp[0] - 1.4, wp[1] - 8 - bob); c.fill();
    c.fillStyle = '#f3d6c4'; c.beginPath(); c.arc(wp[0], wp[1] - 10 - bob, 2.2, 0, 7); c.fill();
    c.fillStyle = '#ecd6a6'; c.beginPath(); c.moveTo(wp[0] - 5.5, wp[1] - 11 - bob); c.lineTo(wp[0] + 5.5, wp[1] - 11 - bob); c.lineTo(wp[0], wp[1] - 15 - bob); c.fill();
    c.strokeStyle = '#e2645a'; c.lineWidth = 1.4; c.beginPath(); c.moveTo(wp[0] + 1, wp[1] - 8 - bob); c.quadraticCurveTo(wp[0] - 4, wp[1] - 7, wp[0] - 8, wp[1] - 6 + Math.sin(t * 8) * 1.4); c.stroke();
    // a second tower with a dome, far right
    const tx = w * 0.8, ty = h * 0.62;
    c.fillStyle = '#d7aebb'; c.fillRect(tx - 9, ty - 58, 18, 58);
    c.fillStyle = '#b98aa6'; c.fillRect(tx, ty - 58, 9, 58);
    c.fillStyle = '#9b87c9'; c.beginPath(); c.arc(tx, ty - 58, 9, Math.PI, 0); c.fill();
    c.fillStyle = '#4a3f5c'; c.fillRect(tx - 4, ty - 44, 3, 6); c.fillRect(tx - 4, ty - 26, 3, 6);
    // title
    c.fillStyle = 'rgba(69,59,85,.8)'; c.font = '600 20px Georgia, serif'; c.textAlign = 'left';
    c.fillText('折阶', 14, 30);
  },
});
