// Lobby card for Cloudspire (the game itself is index.html).
Arcade.register({
  id: 'cloudspire', title: 'Cloudspire', genre: '3D runner',
  tagline: 'Run the broken causeways above the cloud sea with a stolen sun shard.',
  hi() { try { return ['HI', String(Math.floor(JSON.parse(localStorage.getItem('cloudspire.best')) || 0)).padStart(6, '0')]; } catch (e) { return null; } },
  art(c, w, h, t) {
    const g = c.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#2E2459'); g.addColorStop(0.55, '#D9708C'); g.addColorStop(1, '#FFC894');
    c.fillStyle = g; c.fillRect(0, 0, w, h);
    c.fillStyle = 'rgba(255,209,102,.9)'; c.beginPath(); c.arc(w * 0.72, h * 0.42, 26, 0, 7); c.fill();
    // cloud sea
    for (let i = 0; i < 3; i++) {
      c.fillStyle = ['rgba(255,232,210,.55)', 'rgba(243,230,207,.75)', '#F3E6CF'][i];
      c.beginPath(); c.moveTo(0, h);
      for (let x = 0; x <= w; x += 8) c.lineTo(x, h * (0.66 + i * 0.1) + Math.sin(x * 0.04 + t * (0.6 + i * 0.3) + i * 2) * 5);
      c.lineTo(w, h); c.fill();
    }
    // causeway in perspective
    const vx = w / 2, vy = h * 0.5;
    c.fillStyle = '#5B4A7A';
    c.beginPath(); c.moveTo(vx - 6, vy); c.lineTo(vx + 6, vy); c.lineTo(w * 0.78, h); c.lineTo(w * 0.22, h); c.fill();
    c.strokeStyle = 'rgba(255,209,102,.8)'; c.lineWidth = 1.5;
    for (let k = 0; k < 7; k++) { const z = ((k + t * 1.5) % 7) / 7, y = vy + (h - vy) * z * z, hw = 6 + (w * 0.28 - 6) * z * z; c.beginPath(); c.moveTo(vx - hw, y); c.lineTo(vx + hw, y); c.stroke(); }
    // runner
    const bob = Math.abs(Math.sin(t * 8)) * 4;
    c.fillStyle = '#221A40';
    c.beginPath(); c.arc(vx, h * 0.68 - bob, 6, 0, 7); c.fill();
    c.fillRect(vx - 5, h * 0.72 - bob, 10, 18);
    c.fillStyle = '#FFD166'; c.beginPath(); c.arc(vx + 8, h * 0.75 - bob, 3.5, 0, 7); c.fill();
  }
});
