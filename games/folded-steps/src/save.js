// Folded Steps: progress, settings and workshop levels in localStorage (every access guarded).
const KEY = 'folded-steps.v1';
const blank = () => ({ v: 1, stars: {}, mute: false, reduce: null, custom: [], last: 0 });
export function load() {
  try { const s = JSON.parse(localStorage.getItem(KEY)); if (s && s.v === 1) return Object.assign(blank(), s); } catch (e) { /* ignore */ }
  return blank();
}
export function save(s) { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) { /* private mode or full */ } }
export const done = (s, id) => !!(s.stars[id] && s.stars[id][0]);
// merge earned stars (never lose one)
export function award(s, id, got) {
  const prev = s.stars[id] || [false, false, false];
  s.stars[id] = prev.map((v, i) => v || !!got[i]);
  save(s);
  return s.stars[id];
}
export const count = (s, ids) => ids.filter((id) => done(s, id)).length;
