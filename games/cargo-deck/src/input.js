// Keyboard + mouse (pointer lock) + touch (left stick, right-side drag to look, buttons).
// Produces a polled state: move axes, look deltas, held buttons and one-shot presses.
export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.pressed = new Set(); // one-shot, cleared by consume()
    this.mouse = { dx: 0, dy: 0, l: false, r: false };
    this.locked = false;
    this.touch = matchMedia('(pointer:coarse)').matches && !matchMedia('(pointer:fine)').matches;
    this.stick = { x: 0, y: 0, id: null, ox: 0, oy: 0 };
    this.look = { id: null, x: 0, y: 0 };
    this.tbtn = new Set();
    this.enabled = false;
    this.wheel = 0;
    const kd = (e) => {
      if (e.code === 'Tab' || e.code === 'Space' || (e.ctrlKey && e.code === 'KeyW')) e.preventDefault();
      if (!this.keys.has(e.code)) this.pressed.add(e.code);
      this.keys.add(e.code);
    };
    const ku = (e) => { this.keys.delete(e.code); };
    addEventListener('keydown', kd);
    addEventListener('keyup', ku);
    addEventListener('blur', () => { this.keys.clear(); this.mouse.l = this.mouse.r = false; this.tbtn.clear(); });
    canvas.addEventListener('mousedown', (e) => {
      if (!this.enabled) return;
      if (!this.locked && !this.touch) { this.requestLock(); return; }
      if (e.button === 0) { this.mouse.l = true; this.pressed.add('Mouse0'); }
      if (e.button === 2) { this.mouse.r = true; this.pressed.add('Mouse2'); }
    });
    addEventListener('mouseup', (e) => { if (e.button === 0) this.mouse.l = false; if (e.button === 2) this.mouse.r = false; });
    addEventListener('contextmenu', (e) => e.preventDefault());
    addEventListener('mousemove', (e) => { if (this.locked) { this.mouse.dx += e.movementX; this.mouse.dy += e.movementY; } });
    addEventListener('wheel', (e) => { if (this.locked) this.wheel += Math.sign(e.deltaY); }, { passive: true });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
      if (!this.locked) { this.mouse.l = this.mouse.r = false; if (this.onUnlock) this.onUnlock(); }
    });
    this._touchSetup();
  }
  requestLock() {
    if (this.touch) return;
    const quiet = (p) => { if (p && p.catch) p.catch(() => {}); return p; };
    try {
      quiet(this.canvas.requestPointerLock({ unadjustedMovement: true })).catch?.(() => { try { quiet(this.canvas.requestPointerLock()); } catch (e) { /* ignore */ } });
    } catch (e) { /* no pointer lock (headless / old browser) */ }
  }
  exitLock() { if (document.pointerLockElement) document.exitPointerLock(); }
  _touchSetup() {
    const root = document.getElementById('touch');
    const stickEl = document.getElementById('tstick'), knob = stickEl.firstElementChild;
    const R = 50;
    stickEl.addEventListener('touchstart', (e) => {
      const t = e.changedTouches[0], r = stickEl.getBoundingClientRect();
      this.stick.id = t.identifier; this.stick.ox = r.left + r.width / 2; this.stick.oy = r.top + r.height / 2;
      e.preventDefault();
    }, { passive: false });
    root.querySelectorAll('.tb').forEach((b) => {
      const name = b.dataset.b;
      b.addEventListener('touchstart', (e) => { e.preventDefault(); this.tbtn.add(name); this.pressed.add('T_' + name); b.classList.add('on');
        // the fire button also steers the view while held
        if (name === 'fire' && this.look.id === null) { const t = e.changedTouches[0]; this.look.id = t.identifier; this.look.x = t.clientX; this.look.y = t.clientY; }
      }, { passive: false });
      const up = (e) => { e.preventDefault(); this.tbtn.delete(name); b.classList.remove('on'); };
      b.addEventListener('touchend', up, { passive: false }); b.addEventListener('touchcancel', up, { passive: false });
    });
    addEventListener('touchstart', (e) => {
      if (!this.enabled) return;
      for (const t of e.changedTouches) {
        if (t.target.closest && t.target.closest('.tb,.stick,.ov,button,a,input')) continue;
        if (t.clientX > innerWidth * 0.4 && this.look.id === null) { this.look.id = t.identifier; this.look.x = t.clientX; this.look.y = t.clientY; }
      }
    }, { passive: true });
    addEventListener('touchmove', (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === this.stick.id) {
          let dx = t.clientX - this.stick.ox, dy = t.clientY - this.stick.oy;
          const l = Math.hypot(dx, dy); if (l > R) { dx *= R / l; dy *= R / l; }
          this.stick.x = dx / R; this.stick.y = dy / R;
          knob.style.transform = `translate(${dx}px,${dy}px)`;
        } else if (t.identifier === this.look.id) {
          this.mouse.dx += (t.clientX - this.look.x) * 2.2; this.mouse.dy += (t.clientY - this.look.y) * 2.2;
          this.look.x = t.clientX; this.look.y = t.clientY;
        }
      }
    }, { passive: true });
    const end = (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === this.stick.id) { this.stick.id = null; this.stick.x = this.stick.y = 0; knob.style.transform = ''; }
        if (t.identifier === this.look.id) this.look.id = null;
      }
    };
    addEventListener('touchend', end); addEventListener('touchcancel', end);
  }
  down(code) { return this.keys.has(code); }
  hit(code) { return this.pressed.has(code); }
  // movement axes (-1..1): x strafe right, y forward
  axes() {
    let x = 0, y = 0;
    if (this.down('KeyW') || this.down('ArrowUp')) y += 1;
    if (this.down('KeyS') || this.down('ArrowDown')) y -= 1;
    if (this.down('KeyD') || this.down('ArrowRight')) x += 1;
    if (this.down('KeyA') || this.down('ArrowLeft')) x -= 1;
    if (this.stick.id !== null) { x += this.stick.x; y -= this.stick.y; }
    const l = Math.hypot(x, y); if (l > 1) { x /= l; y /= l; }
    return { x, y };
  }
  firing() { return this.mouse.l || this.tbtn.has('fire') || !!this.debugFire; }
  aiming() { return this.mouse.r || !!this.debugAds; }
  consumeLook() { const d = { dx: this.mouse.dx, dy: this.mouse.dy }; this.mouse.dx = this.mouse.dy = 0; return d; }
  consume() { this.pressed.clear(); this.wheel = 0; }
}
