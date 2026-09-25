// Keyboard, mouse + pointer lock, and optional touch controls. Emits actions through `act`.
export const input = {
  keys: new Set(), locked: false, lookX: 0, lookY: 0, touch: false, stick: { x: 0, y: 0 },
  act: { fire() {}, use() {}, jump() {}, restart() {}, pause() {}, mute() {}, confirm() {}, unlock() {} },
};

export function bindInput(canvas) {
  const A = input.act;
  addEventListener('keydown', (e) => {
    if (e.repeat && e.code !== 'Space') return;
    input.keys.add(e.code);
    switch (e.code) {
      case 'Space': if (!e.repeat) A.jump(); e.preventDefault(); break;
      case 'KeyE': case 'KeyF': A.use(); break;
      case 'KeyR': A.restart(); break;
      case 'KeyM': A.mute(); break;
      case 'Escape': case 'KeyP': if (e.code === 'KeyP' || !input.locked) A.pause(); break;
      case 'Enter': A.confirm(); break;
      case 'KeyQ': A.fire(0); break;
    }
  });
  addEventListener('keyup', (e) => input.keys.delete(e.code));
  addEventListener('blur', () => { input.keys.clear(); A.unlock(true); });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('mousedown', (e) => {
    if (!input.locked) return;
    if (e.button === 0) A.fire(0); else if (e.button === 2) A.fire(1);
    e.preventDefault();
  });
  addEventListener('mousemove', (e) => { if (input.locked) { input.lookX += e.movementX || 0; input.lookY += e.movementY || 0; } });
  document.addEventListener('pointerlockchange', () => {
    const was = input.locked; input.locked = document.pointerLockElement === canvas;
    if (was && !input.locked) A.unlock(false);
  });
}

export function lockPointer(canvas) {
  if (input.touch) return;
  try { const p = canvas.requestPointerLock({ unadjustedMovement: false }); if (p && p.catch) p.catch(() => {}); } catch (e) { /* ignore */ }
}
export function unlockPointer() { if (document.pointerLockElement) document.exitPointerLock(); }

export function moveAxes() {
  const k = input.keys;
  let f = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0), b = (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
  let l = (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0), r = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0);
  if (input.touch) { const s = input.stick; if (s.y < -0.2) f = Math.min(1, -s.y * 1.3); if (s.y > 0.2) b = Math.min(1, s.y * 1.3); if (s.x < -0.2) l = Math.min(1, -s.x * 1.3); if (s.x > 0.2) r = Math.min(1, s.x * 1.3); }
  return { f, b, l, r };
}

// Touch: left stick moves, drag on the right looks, buttons for gates/use/jump/pause.
export function bindTouch(root) {
  input.touch = true; root.hidden = false; document.body.classList.add('touch'); // HUD layout makes room (index.html)
  const A = input.act, stick = root.querySelector('.stick'), knob = root.querySelector('.knob'), look = root.querySelector('.look');
  let sid = null, lid = null, lx = 0, ly = 0;
  const capture = (el, id) => { try { el.setPointerCapture(id); } catch (e) { /* pointer already gone */ } };
  stick.addEventListener('pointerdown', (e) => { sid = e.pointerId; capture(stick, sid); upd(e); });
  stick.addEventListener('pointermove', (e) => { if (e.pointerId === sid) upd(e); });
  const end = (e) => { if (e.pointerId === sid) { sid = null; input.stick.x = input.stick.y = 0; knob.style.transform = ''; } };
  stick.addEventListener('pointerup', end); stick.addEventListener('pointercancel', end);
  function upd(e) {
    const r = stick.getBoundingClientRect(); let x = (e.clientX - r.left) / r.width * 2 - 1, y = (e.clientY - r.top) / r.height * 2 - 1;
    const l = Math.hypot(x, y); if (l > 1) { x /= l; y /= l; }
    input.stick.x = x; input.stick.y = y; knob.style.transform = `translate(${x * 38}px, ${y * 38}px)`;
  }
  look.addEventListener('pointerdown', (e) => { lid = e.pointerId; lx = e.clientX; ly = e.clientY; capture(look, lid); });
  look.addEventListener('pointermove', (e) => { if (e.pointerId !== lid) return; input.lookX += (e.clientX - lx) * 2.2; input.lookY += (e.clientY - ly) * 2.2; lx = e.clientX; ly = e.clientY; });
  look.addEventListener('pointerup', (e) => { if (e.pointerId === lid) lid = null; });
  for (const b of root.querySelectorAll('.tb')) b.addEventListener('pointerdown', (e) => {
    e.preventDefault(); const k = b.dataset.k;
    if (k === 'fireA') A.fire(0); else if (k === 'fireB') A.fire(1); else if (k === 'use') A.use(); else if (k === 'jump') A.jump(); else if (k === 'pause') A.pause();
  });
}
