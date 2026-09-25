// Lobby card for Cargo Deck (the game itself is index.html).
Arcade.register({
  id: 'cargo-deck', title: 'Cargo Deck', genre: '3D shooter',
  tagline: '5v5 on a moored freighter at golden hour. Sniper lane, flank pipes, the double V. Deathmatch or elimination.',
  art(c, w, h, t) {
    // golden-hour sky and sea
    const g = c.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#27406e'); g.addColorStop(0.45, '#c9855a'); g.addColorStop(0.62, '#f2b36d'); g.addColorStop(0.63, '#1d3440'); g.addColorStop(1, '#0c1a22');
    c.fillStyle = g; c.fillRect(0, 0, w, h);
    const sx = w * 0.72, sy = h * 0.58;
    const sun = c.createRadialGradient(sx, sy, 0, sx, sy, h * 0.35);
    sun.addColorStop(0, 'rgba(255,236,190,.95)'); sun.addColorStop(0.15, 'rgba(255,190,110,.45)'); sun.addColorStop(1, 'rgba(255,150,80,0)');
    c.fillStyle = sun; c.fillRect(0, 0, w, h);
    // glitter path on the water
    c.fillStyle = 'rgba(255,220,160,.35)';
    for (let i = 0; i < 14; i++) { const y = h * 0.66 + i * h * 0.024, ww = (8 + i * 3) * (0.7 + 0.3 * Math.sin(t * 3 + i)); c.fillRect(sx - ww / 2, y, ww, 1.5); }
    // gantry crane silhouette
    c.strokeStyle = '#8f2d22'; c.lineWidth = 3;
    c.beginPath(); c.moveTo(w * 0.12, h * 0.63); c.lineTo(w * 0.12, h * 0.16); c.moveTo(w * 0.22, h * 0.63); c.lineTo(w * 0.22, h * 0.16); c.stroke();
    c.lineWidth = 2; c.beginPath(); c.moveTo(w * 0.04, h * 0.15); c.lineTo(w * 0.58, h * 0.15); c.moveTo(w * 0.12, h * 0.4); c.lineTo(w * 0.22, h * 0.22); c.stroke();
    // hull and deck cargo, the double V in the middle
    c.fillStyle = '#12171c'; c.beginPath(); c.moveTo(0, h * 0.63); c.lineTo(w, h * 0.63); c.lineTo(w, h * 0.74); c.lineTo(0, h * 0.74); c.fill();
    const cols = ['#9c2f22', '#1f4f8f', '#2f6b3a', '#c8662a', '#7d8288', '#1d6f6c'];
    for (let i = 0; i < 12; i++) {
      const x = (i * 29 + 6) % (w + 10) - 8, rows = 1 + ((i * 5) % 3 === 0 ? 1 : 0);
      if (Math.abs(x - w * 0.5) < 26) continue;
      for (let r = 0; r < rows; r++) { c.fillStyle = cols[(i + r) % cols.length]; c.fillRect(x, h * 0.63 - (r + 1) * 11, 26, 10); c.fillStyle = 'rgba(0,0,0,.25)'; for (let k = 2; k < 26; k += 4) c.fillRect(x + k, h * 0.63 - (r + 1) * 11 + 1, 1, 8); }
    }
    c.save(); c.translate(w * 0.5, h * 0.6);
    for (const s of [-1, 1]) { c.save(); c.rotate(s * 0.7); c.fillStyle = s < 0 ? '#c8662a' : '#2f6b3a'; c.fillRect(-4, -22, 8, 20); c.restore(); }
    c.restore();
    // tracer + crosshair
    const k = (t * 0.9) % 1;
    c.strokeStyle = `rgba(255,220,140,${0.9 * (1 - k)})`; c.lineWidth = 1.5;
    c.beginPath(); c.moveTo(w * 0.08 + k * w * 0.3, h * 0.5 - k * h * 0.05); c.lineTo(w * 0.12 + k * w * 0.3, h * 0.495 - k * h * 0.05); c.stroke();
    const cx = w / 2, cy = h * 0.42, sp = 5 + Math.abs(Math.sin(t * 5)) * 3;
    c.strokeStyle = '#7dffb4'; c.lineWidth = 2;
    c.beginPath();
    c.moveTo(cx - sp - 7, cy); c.lineTo(cx - sp, cy); c.moveTo(cx + sp, cy); c.lineTo(cx + sp + 7, cy);
    c.moveTo(cx, cy - sp - 7); c.lineTo(cx, cy - sp); c.moveTo(cx, cy + sp); c.lineTo(cx, cy + sp + 7);
    c.stroke();
  },
});
