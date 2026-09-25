// Lobby card for 风驰 Windrift (the game itself is index.html + src/).
Arcade.register({
  id: 'windrift', title: '风驰 Windrift', genre: '3D kart racer',
  tagline: 'Drift, tap the boost light for 小喷 and 双喷, stack nitro. Four circuits, eight racers, items and time trial.',
  controls: '↑↓←→ drive · Shift drift · Ctrl nitro',
  hi() {
    // best race time: first circuit with a record (time trial, then speed, then item)
    const f = (t) => Math.floor(t / 60) + ':' + (t % 60).toFixed(2).padStart(5, '0');
    try {
      for (const tr of ['metro', 'bay', 'glacier', 'dunes']) for (const m of ['tt', 'speed', 'item']) {
        const v = parseFloat(localStorage.getItem('windrift-best-' + tr + '-' + m));
        if (isFinite(v)) return ['BEST', f(v)];
      }
    } catch (e) { /* storage blocked */ }
    return ['BEST', '-:--.--'];
  },
  art(c, w, h, t) {
    // neon night road; a kart seen from behind drifts left and right, sparks cycling blue → orange → violet
    const sky = c.createLinearGradient(0, 0, 0, h * 0.62);
    sky.addColorStop(0, '#050820'); sky.addColorStop(0.7, '#241450'); sky.addColorStop(1, '#6b2a72');
    c.fillStyle = sky; c.fillRect(0, 0, w, h);
    for (let i = 0; i < 40; i++) { c.fillStyle = `rgba(255,255,255,${0.3 + 0.5 * Math.abs(Math.sin(t * 2 + i))})`; c.fillRect((i * 73) % w, (i * 37) % (h * 0.4), 1, 1); }
    const vy = h * 0.58, vx = w / 2 + Math.sin(t * 0.7) * 10;
    for (let i = 0; i < 16; i++) {
      const bw = 16 + ((i * 7) % 14), bh = 28 + ((i * 53) % 70), side = i % 2 ? 1 : -1, off = 34 + Math.floor(i / 2) * 18;
      const x = vx + side * off - bw / 2;
      c.fillStyle = i % 3 ? '#140f33' : '#1b1440'; c.fillRect(x, vy - bh, bw, bh + 2);
      for (let wy = vy - bh + 5; wy < vy - 4; wy += 6) for (let wx = x + 3; wx < x + bw - 3; wx += 5) if (((wx * 7 + wy * 3 + i) | 0) % 5 < 2) { c.fillStyle = ((wx + wy) | 0) % 3 ? '#ffd79a' : '#9fd0ff'; c.fillRect(wx, wy, 2, 3); }
      if (i % 4 === 1) { c.fillStyle = ['#ff2e7e', '#19d3ff', '#ffd21f'][i % 3]; c.fillRect(x + 2, vy - bh + 8, bw - 4, 3); }
    }
    // road with neon edges and dashes rushing in
    c.fillStyle = '#1c1c28'; c.beginPath(); c.moveTo(vx - 6, vy); c.lineTo(vx + 6, vy); c.lineTo(w * 1.1, h); c.lineTo(-w * 0.1, h); c.fill();
    c.lineWidth = 3; c.strokeStyle = '#19d3ff'; c.beginPath(); c.moveTo(vx - 6, vy); c.lineTo(-w * 0.1, h); c.stroke();
    c.strokeStyle = '#ff3d8b'; c.beginPath(); c.moveTo(vx + 6, vy); c.lineTo(w * 1.1, h); c.stroke();
    c.fillStyle = 'rgba(255,255,255,.75)';
    for (let k = 0; k < 7; k++) { const z = ((k + t * 2.2) % 7) / 7, y = vy + (h - vy) * z * z, hw = 0.6 + z * 2.2; c.fillRect(vx + (w / 2 - vx) * z - hw, y, hw * 2, 2 + z * 7); }
    // speed lines
    c.strokeStyle = 'rgba(200,230,255,.35)'; c.lineWidth = 1;
    for (let i = 0; i < 10; i++) { const a = i * 0.63 + t, r0 = ((t * 1.7 + i * 0.37) % 1) * 90 + 70; c.beginPath(); c.moveTo(w / 2 + Math.cos(a) * r0, h * 0.55 + Math.sin(a) * r0 * 0.6); c.lineTo(w / 2 + Math.cos(a) * (r0 + 26), h * 0.55 + Math.sin(a) * (r0 + 26) * 0.6); c.stroke(); }
    // kart from behind, drifting
    const kx = w / 2 + Math.sin(t * 1.3) * 26, ky = h * 0.8, ang = Math.cos(t * 1.3) * 0.28, dir = Math.sign(Math.cos(t * 1.3)) || 1;
    const tier = Math.floor(t * 0.7) % 3, sc = ['#4cc9ff', '#ffa21f', '#d35cff'][tier];
    c.strokeStyle = sc; c.lineWidth = 1.5;
    for (let i = 0; i < 18; i++) { const p = (t * 3 + i / 18) % 1, sx = kx - dir * (26 + p * 60), sy = ky + 10 - p * 22 + ((i * 5) % 9); c.globalAlpha = 1 - p; c.beginPath(); c.moveTo(sx, sy); c.lineTo(sx - dir * 7, sy + 2); c.stroke(); }
    c.globalAlpha = 1;
    c.save(); c.translate(kx, ky); c.rotate(ang);
    c.fillStyle = 'rgba(255,61,139,.35)'; c.beginPath(); c.ellipse(0, 12, 38, 8, 0, 0, 7); c.fill();
    c.fillStyle = '#111'; c.fillRect(-30, -2, 13, 17); c.fillRect(17, -2, 13, 17);
    c.fillStyle = '#e5243b'; c.beginPath(); c.moveTo(-20, 12); c.lineTo(20, 12); c.lineTo(17, -6); c.lineTo(-17, -6); c.fill();
    c.fillStyle = '#1b8fa8'; c.fillRect(-24, -13, 48, 5);
    c.fillStyle = '#f2f2f2'; c.fillRect(-6, -20, 12, 10);
    c.fillStyle = '#ffd21f'; c.beginPath(); c.arc(0, -22, 7, 0, 7); c.fill();
    c.fillStyle = '#12182a'; c.fillRect(-5, -24, 10, 4);
    const fl = 6 + Math.random() * 6;
    for (const x of [-9, 9]) { const g = c.createLinearGradient(0, 12, 0, 12 + fl); g.addColorStop(0, '#dff4ff'); g.addColorStop(1, 'rgba(60,110,255,0)'); c.fillStyle = g; c.beginPath(); c.moveTo(x - 4, 10); c.lineTo(x + 4, 10); c.lineTo(x, 12 + fl + 6); c.fill(); }
    c.restore();
    c.font = 'bold 32px "ZCOOL QingKe HuangYou","PingFang SC",sans-serif'; c.fillStyle = '#ffd21f';
    c.shadowColor = '#ff8a1f'; c.shadowBlur = 10; c.fillText('风驰', 12, 40); c.shadowBlur = 0;
    c.font = '11px "Russo One",sans-serif'; c.fillStyle = '#bfe9ff'; c.fillText('W I N D R I F T', 14, 56);
  }
});
