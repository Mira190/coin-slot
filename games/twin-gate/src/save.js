// Progress records and settings in localStorage (always wrapped: private mode and quotas must not break play).
const KEY = 'twin-gate.v1';
const DEF = { done: {}, last: 0, settings: { sens: 1, fov: 78, invert: 0, vol: 0.8, music: 0.55, quality: 'auto', bob: 1, muted: false } };

export const save = load();
function load() {
  try { const s = JSON.parse(localStorage.getItem(KEY)); if (s && s.done) return { ...DEF, ...s, settings: { ...DEF.settings, ...(s.settings || {}) } }; } catch (e) { /* fresh */ }
  return JSON.parse(JSON.stringify(DEF));
}
export function persist() { try { localStorage.setItem(KEY, JSON.stringify(save)); } catch (e) { /* ignore */ } }

// Record a completed trial; returns { newTime, newGates } flags.
export function record(id, time, gates) {
  const r = save.done[id], out = { newTime: !r || time < r.time, newGates: !r || gates < r.gates, first: !r };
  save.done[id] = { time: r ? Math.min(r.time, time) : time, gates: r ? Math.min(r.gates, gates) : gates, n: (r ? r.n : 0) + 1 };
  persist();
  return out;
}
export const completedCount = () => Object.keys(save.done).length;
export const fmtTime = (s) => { const m = Math.floor(s / 60), r = s - m * 60; return `${m}:${r < 10 ? '0' : ''}${r.toFixed(1)}`; };
