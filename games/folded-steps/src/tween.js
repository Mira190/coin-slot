// Folded Steps: tiny tween engine. Everything that moves eases.
export const E = {
  lin: (t) => t,
  io: (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
  out: (t) => 1 - Math.pow(1 - t, 3),
  in: (t) => t * t * t,
  back: (t) => { const c = 1.45; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); },
  soft: (t) => 1 - Math.pow(1 - t, 5),
  sine: (t) => -(Math.cos(Math.PI * t) - 1) / 2,
};
const live = new Set();
// tween(dur, fn(k), ease) -> promise; fn gets the eased progress 0..1 every frame
export function tween(dur, fn, ease = E.io) {
  return new Promise((resolve) => {
    if (dur <= 0) { fn(1); resolve(); return; }
    live.add({ t: 0, dur, fn, ease, resolve });
  });
}
export function stepTweens(dt) {
  for (const w of [...live]) {
    w.t = Math.min(w.dur, w.t + dt);
    w.fn(w.ease(w.t / w.dur));
    if (w.t >= w.dur) { live.delete(w); w.resolve(); }
  }
}
export const tweening = () => live.size > 0;
export const wait = (s) => tween(s, () => {});
