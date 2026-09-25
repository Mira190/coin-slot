// Records, settings and ghost laps in localStorage under the `windrift-` prefix (all access guarded).
const P = 'windrift-';
export const store = {
  get(k, d = null) { try { const v = localStorage.getItem(P + k); return v == null ? d : v; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(P + k, String(v)); return true; } catch (e) { return false; } },
  json(k, d = null) { try { const v = localStorage.getItem(P + k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
  setJSON(k, v) { try { localStorage.setItem(P + k, JSON.stringify(v)); return true; } catch (e) { return false; } }
};
export const fmt = (t) => {
  if (t == null || !isFinite(t)) return '--:--.--';
  const m = Math.floor(t / 60), s = t - m * 60;
  return m + ':' + (s < 10 ? '0' : '') + s.toFixed(2);
};
// best race time per track+mode, best lap per track
export const bestRace = (track, mode) => { const v = parseFloat(store.get(`best-${track}-${mode}`)); return isFinite(v) ? v : null; };
export const bestLap = (track) => { const v = parseFloat(store.get(`lap-${track}`)); return isFinite(v) ? v : null; };
export function saveRace(track, mode, t) { const b = bestRace(track, mode); if (b == null || t < b) { store.set(`best-${track}-${mode}`, t.toFixed(3)); return true; } return false; }
export function saveLap(track, t) { const b = bestLap(track); if (b == null || t < b) { store.set(`lap-${track}`, t.toFixed(3)); return true; } return false; }

// Ghost: 20 Hz samples of x, y, z, heading (×100 ints) for one lap.
export class GhostRec {
  constructor() { this.f = []; this.t0 = 0; this.next = 0; }
  start(t) { this.f = []; this.t0 = t; this.next = t; }
  sample(k, t) {
    while (t >= this.next) {
      this.f.push(Math.round(k.x * 100), Math.round(k.y * 100), Math.round(k.z * 100), Math.round((k.h % (Math.PI * 2)) * 1000));
      this.next += 0.05;
    }
  }
}
export function saveGhost(track, lapTime, frames, kartIdx, paint) {
  return store.setJSON(`ghost-${track}`, { lap: lapTime, kart: kartIdx, paint, f: frames });
}
export const loadGhost = (track) => { const g = store.json(`ghost-${track}`); return g && Array.isArray(g.f) && g.f.length >= 8 ? g : null; };
export function ghostAt(g, t, out) {
  const n = g.f.length / 4, u = Math.max(0, t / 0.05), i = Math.min(n - 2, Math.floor(u)), f = Math.min(1, u - i), F = g.f;
  const a = i * 4, b = a + 4;
  out.x = (F[a] + (F[b] - F[a]) * f) / 100; out.y = (F[a + 1] + (F[b + 1] - F[a + 1]) * f) / 100; out.z = (F[a + 2] + (F[b + 2] - F[a + 2]) * f) / 100;
  let h0 = F[a + 3] / 1000, h1 = F[b + 3] / 1000, d = h1 - h0;
  if (d > Math.PI) d -= Math.PI * 2; else if (d < -Math.PI) d += Math.PI * 2;
  out.h = h0 + d * f;
  out.done = u >= n - 1;
  return out;
}
