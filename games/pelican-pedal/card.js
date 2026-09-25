// Lobby card for Pelican Pedal (the game itself is index.html).
Arcade.register({
  id: 'pelican-pedal', title: 'Pelican Pedal', genre: '3D showcase ride',
  tagline: 'A great white pelican on a cherry-red roadster: golden hour, flying fish, a whole island.',
  controls: 'W pedal · A/D steer · F scoop · P photo',
  art(c, w, h, t) {
    const g = c.createLinearGradient(0, 0, 0, h * 0.6);
    g.addColorStop(0, '#F59E6B'); g.addColorStop(1, '#FFE3A3');
    c.fillStyle = g; c.fillRect(0, 0, w, h);
    c.fillStyle = '#FFF2C7'; c.beginPath(); c.arc(w * 0.75, h * 0.5, 24, 0, 7); c.fill();
    c.fillStyle = '#2E7DA6'; c.fillRect(0, h * 0.55, w, h * 0.2);
    c.fillStyle = 'rgba(255,242,199,.6)'; for (let i = 0; i < 12; i++) c.fillRect(((i * 53 + t * 20) % (w + 40)) - 20, h * 0.58 + (i % 4) * 8, 18, 2);
    c.fillStyle = '#C79A63'; c.fillRect(0, h * 0.75, w, h * 0.25);
    // bicycle
    const x = w * 0.45, y = h * 0.8, a = t * 6;
    c.strokeStyle = '#1D2B3A'; c.lineWidth = 2.5;
    [x - 26, x + 26].forEach((wx) => { c.beginPath(); c.arc(wx, y, 15, 0, 7); c.stroke(); for (let k = 0; k < 3; k++) { c.beginPath(); c.moveTo(wx + Math.cos(a + k * 2.1) * 15, y + Math.sin(a + k * 2.1) * 15); c.lineTo(wx - Math.cos(a + k * 2.1) * 15, y - Math.sin(a + k * 2.1) * 15); c.stroke(); } });
    c.strokeStyle = '#D6453D'; c.lineWidth = 3;
    c.beginPath(); c.moveTo(x - 26, y); c.lineTo(x - 4, y - 2); c.lineTo(x - 10, y - 26); c.lineTo(x + 18, y - 24); c.lineTo(x + 26, y); c.moveTo(x - 4, y - 2); c.lineTo(x + 18, y - 24); c.stroke();
    // pelican
    const bob = Math.sin(t * 6) * 1.5;
    c.fillStyle = '#F7F5EE'; c.beginPath(); c.ellipse(x - 6, y - 40 + bob, 18, 13, -0.3, 0, 7); c.fill();
    c.fillStyle = '#2B2B2B'; c.beginPath(); c.ellipse(x - 16, y - 40 + bob, 10, 6, -0.4, 0, 7); c.fill();
    c.strokeStyle = '#F7F5EE'; c.lineWidth = 5; c.beginPath(); c.moveTo(x + 6, y - 48 + bob); c.quadraticCurveTo(x + 14, y - 66 + bob, x + 10, y - 72 + bob); c.stroke();
    c.fillStyle = '#F7F5EE'; c.beginPath(); c.arc(x + 11, y - 74 + bob, 6, 0, 7); c.fill();
    c.fillStyle = '#F2B84B'; c.beginPath(); c.moveTo(x + 15, y - 76 + bob); c.lineTo(x + 46, y - 70 + bob); c.quadraticCurveTo(x + 30, y - 58 + bob, x + 15, y - 70 + bob); c.fill();
    c.fillStyle = '#1D2B3A'; c.beginPath(); c.arc(x + 12, y - 76 + bob, 1.4, 0, 7); c.fill();
    c.strokeStyle = '#F08A2E'; c.lineWidth = 2.5; c.beginPath(); c.moveTo(x - 4, y - 30 + bob); c.lineTo(x - 4 + Math.cos(a) * 7, y - 2 + Math.sin(a) * 7); c.stroke();
  }
});
