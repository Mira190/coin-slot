// Folded Steps: runs the solver off the main thread for hints and for the editor's "prove it" button.
import * as F from './logic.js';

const cache = new Map();
onmessage = (e) => {
  const { id, def, st, glimmer } = e.data;
  let r = null;
  try {
    const key = JSON.stringify(def);
    let L = cache.get(key);
    if (!L) { L = F.compile(def); cache.clear(); cache.set(key, L); }
    const s0 = st || F.init(L);
    const goal = glimmer ? (L2, s) => s.p === L.goal && s.g : F.won;
    const res = F.solve(L, s0, goal, 700000);
    r = res && res.actions ? { actions: res.actions, turns: res.turns, steps: res.steps, explored: res.explored } : { none: true, capped: !!(res && res.capped), explored: res ? res.explored : 0 };
  } catch (err) { r = { error: String(err.message || err) }; }
  postMessage({ id, r });
};
