// Keyboard, pointer drag / wheel (orbit + photo cameras) and the on-screen touch buttons.
export class Input {
  constructor(el) {
    this.keys = new Set(); this.edges = new Set(); this.touch = new Set();
    this.drag = { x: 0, y: 0 }; this.wheel = 0; this.lastAny = 0; this.onKey = null;
    const block = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space']);
    addEventListener('keydown', (e) => {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) return;
      if (block.has(e.code)) e.preventDefault();
      if (!this.keys.has(e.code)) this.edges.add(e.code);
      this.keys.add(e.code); this.lastAny = performance.now();
      if (!e.repeat && this.onKey) this.onKey(e.code, e);
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => { this.keys.clear(); this.touch.clear(); });
    // drag on the canvas
    let down = null;
    el.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY, id: e.pointerId }; el.setPointerCapture && el.setPointerCapture(e.pointerId); });
    el.addEventListener('pointermove', (e) => { if (!down || e.pointerId !== down.id) return; this.drag.x += e.clientX - down.x; this.drag.y += e.clientY - down.y; down.x = e.clientX; down.y = e.clientY; });
    const up = () => { down = null; };
    el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
    el.addEventListener('wheel', (e) => { this.wheel += e.deltaY; e.preventDefault(); }, { passive: false });
    // touch buttons (hold semantics; edges for hop/bell)
    document.querySelectorAll('#touch .tb').forEach((b) => {
      const k = b.dataset.k;
      const on = (e) => { e.preventDefault(); if (!this.touch.has(k)) this.edges.add('t-' + k); this.touch.add(k); b.classList.add('on'); this.lastAny = performance.now(); if (this.onTouch) this.onTouch(k); };
      const off = (e) => { e.preventDefault(); this.touch.delete(k); b.classList.remove('on'); };
      b.addEventListener('pointerdown', on); b.addEventListener('pointerup', off); b.addEventListener('pointercancel', off); b.addEventListener('pointerleave', off);
      b.addEventListener('contextmenu', (e) => e.preventDefault());
    });
  }
  has(...codes) { return codes.some((c) => this.keys.has(c)); }
  edge(...codes) { return codes.some((c) => this.edges.has(c)); }
  // gameplay + camera state for this frame
  read() {
    const K = (...c) => this.has(...c), T = (k) => this.touch.has(k);
    const r = {
      pedal: K('KeyW', 'ArrowUp') || T('pedal') ? 1 : 0,
      brake: K('KeyS', 'ArrowDown') || T('brake') ? 1 : 0,
      steer: (K('KeyD', 'ArrowRight') || T('right') ? 1 : 0) - (K('KeyA', 'ArrowLeft') || T('left') ? 1 : 0),
      hop: this.edge('Space', 't-hop'), trick: K('ShiftLeft', 'ShiftRight') || T('trick'), scoop: K('KeyF', 'KeyE', 'Enter', 'NumpadEnter') || T('scoop'),
      bell: this.edge('KeyB', 't-bell'),
      drag: { x: this.drag.x, y: this.drag.y }, wheel: this.wheel,
      move: { x: (K('KeyD', 'ArrowRight') ? 1 : 0) - (K('KeyA', 'ArrowLeft') ? 1 : 0), y: (K('KeyE') ? 1 : 0) - (K('KeyQ') ? 1 : 0), z: (K('KeyW', 'ArrowUp') ? 1 : 0) - (K('KeyS', 'ArrowDown') ? 1 : 0) },
      fast: K('ShiftLeft', 'ShiftRight'),
    };
    r.any = r.pedal || r.brake || r.steer || r.hop || r.trick || r.scoop || r.bell;
    this.drag.x = this.drag.y = 0; this.wheel = 0; this.edges.clear();
    return r;
  }
}
