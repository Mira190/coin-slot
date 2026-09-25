// Keyboard + touch + gamepad → the driving input struct (same shape the AI produces). Edges (taps) are latched
// until read. Gamepad (standard mapping): stick/d-pad steer, A or RT throttle (A tap = 喷), B/LT brake,
// LB/RB drift, X nitro/item 1, Y item 2, Back camera, Start pause.
// While racing, Ctrl combos and page-scrolling keys are preventDefault-ed (Ctrl+W cannot be blocked by any page).

const DRIVE = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'ShiftLeft', 'ShiftRight', 'ControlLeft', 'ControlRight', 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyZ', 'KeyX', 'KeyQ', 'KeyR']);

export class Input {
  constructor() {
    this.keys = Object.create(null); this.edge = Object.create(null); this.touch = Object.create(null); this.tedge = Object.create(null);
    this.racing = false; this.onKey = null; this.isTouch = false;
    addEventListener('keydown', (e) => {
      if (this.racing && (e.ctrlKey || DRIVE.has(e.code))) e.preventDefault();
      if (!this.keys[e.code] && !e.repeat) this.edge[e.code] = true;
      this.keys[e.code] = true;
      if (!e.repeat && this.onKey) this.onKey(e);
    }, { capture: true });
    addEventListener('keyup', (e) => { this.keys[e.code] = false; if (this.racing && DRIVE.has(e.code)) e.preventDefault(); });
    addEventListener('blur', () => this.clear());
    addEventListener('contextmenu', (e) => { if (this.racing) e.preventDefault(); });
    addEventListener('touchstart', () => this.setTouch(true), { passive: true, once: true });
  }
  setTouch(on) { this.isTouch = on; document.body.classList.toggle('touch', on); }
  clear() { for (const k in this.keys) this.keys[k] = false; for (const k in this.touch) this.touch[k] = false; }
  bindTouch(el, name) {
    const on = (e) => { e.preventDefault(); this.setTouch(true); this.touch[name] = true; this.tedge[name] = true; el.classList.add('act'); try { el.setPointerCapture(e.pointerId); } catch (_) {} this.onTouch?.(name); };
    const off = (e) => { e.preventDefault(); this.touch[name] = false; el.classList.remove('act'); };
    el.addEventListener('pointerdown', on); el.addEventListener('pointerup', off); el.addEventListener('pointercancel', off); el.addEventListener('lostpointercapture', off);
  }
  take(code) { const v = !!this.edge[code]; this.edge[code] = false; return v; }
  takeT(name) { const v = !!this.tedge[name]; this.tedge[name] = false; return v; }
  // poll the first connected gamepad; button edges go through the same latches as keys
  pad() {
    const gps = navigator.getGamepads ? navigator.getGamepads() : [];
    const gp = gps && [...gps].find((g) => g && g.connected);
    if (!gp) return null;
    const btn = (i) => !!(gp.buttons[i] && (gp.buttons[i].pressed || gp.buttons[i].value > 0.4));
    const prev = this.padPrev || [];
    const cur = gp.buttons.map((_, i) => btn(i));
    const edge = (i) => cur[i] && !prev[i];
    this.padPrev = cur;
    if (edge(9)) this.onKey?.({ code: 'Escape' });
    if (edge(8)) this.onKey?.({ code: 'KeyC' });
    const ax = gp.axes[0] || 0;
    return {
      steer: Math.abs(ax) > 0.2 ? -ax : (btn(14) ? 1 : 0) - (btn(15) ? 1 : 0),
      up: btn(0) || btn(7), down: btn(1) || btn(6), drift: btn(4) || btn(5),
      upTap: edge(0), nitro: edge(2), item2: edge(3), reset: false
    };
  }
  // driving struct for this simulation step
  read() {
    const k = this.keys, t = this.touch, g = this.pad();
    const left = k.ArrowLeft || k.KeyA || t.left, right = k.ArrowRight || k.KeyD || t.right;
    const brake = k.ArrowDown || k.KeyS || t.brake || (g && g.down);
    const steer = (left ? 1 : 0) - (right ? 1 : 0);
    return {
      up: !!(k.ArrowUp || k.KeyW || (this.isTouch && !brake) || (g && g.up)),
      down: !!brake,
      steer: steer || (g ? g.steer : 0),
      drift: !!(k.ShiftLeft || k.ShiftRight || t.drift || (g && g.drift)),
      upTap: this.take('ArrowUp') | this.take('KeyW') | this.takeT('boost') | (g && g.upTap) ? true : false,
      nitro: this.take('ControlLeft') | this.take('ControlRight') | this.take('Space') | this.takeT('nitro') | (g && g.nitro) ? true : false,
      item1: this.take('KeyZ') | this.take('KeyQ') ? true : false,
      item2: this.take('KeyX') | this.takeT('item2') | (g && g.item2) ? true : false,
      reset: this.take('KeyR')
    };
  }
  // drop stale taps (e.g. after a menu) so they don't fire on the first race frame
  flush() { for (const c in this.edge) this.edge[c] = false; for (const c in this.tedge) this.tedge[c] = false; }
}
