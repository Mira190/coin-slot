// Cameras. The director opens with a crane shot over the bay, then cuts between hero 3/4,
// low angle, feet, pouch close-up, aerial, side tracking and telephoto shots, choosing the
// camera side from the sun (front-lit or rim-lit) and reacting to catches and tricks.
// Other modes: chase, side, orbit (drag), pelican POV, and a free photo camera.
import { THREE, V3, clamp, lerp, damp, smooth, camera, reduceMotion, hash, vnoise } from './core.js';

const SHOTS = {
  //        dur  fov  aperture  kind
  hero: { dur: 7, fov: 34, ap: 0.05, kind: 'track' },
  rear34: { dur: 6, fov: 36, ap: 0.045, kind: 'track' },
  low: { dur: 4.5, fov: 30, ap: 0.06, kind: 'fixed' },
  feet: { dur: 4, fov: 30, ap: 0.11, kind: 'track' },
  pouch: { dur: 5, fov: 28, ap: 0.1, kind: 'track' },
  aerial: { dur: 6.5, fov: 46, ap: 0.012, kind: 'track' },
  side: { dur: 6, fov: 30, ap: 0.05, kind: 'track' },
  tele: { dur: 5, fov: 13, ap: 0.09, kind: 'fixed' },
};
export const MODES = ['director', 'chase', 'side', 'orbit', 'pov'];
const _rc = new THREE.Raycaster(), _p = new V3(), _d = new V3();
_rc.layers.enableAll(); // the rider lives on the no-reflection layer
export const MODE_NAMES = { director: 'Director', chase: 'Chase', side: 'Side', orbit: 'Orbit', pov: 'Pelican POV', photo: 'Photo' };

export class Director {
  constructor(heightAt) {
    this.heightAt = heightAt;
    this.mode = 'director'; this.shot = 'crane'; this.shotT = 0; this.side = 1; this.hist = [];
    this.fwd = new V3(0, 0, 1); this.pos = new V3(); this.target = new V3(); this.fov = 35; this.focus = 4; this.aperture = 0.05;
    this.fixed = new V3(); this.shake = 0; this.label = 'Crane'; this.letterbox = false;
    this.orbit = { yaw: 0.7, pitch: 0.18, dist: 3.8 };
    this.free = { pos: new V3(), yaw: 0, pitch: 0, vel: new V3() };
    this.lookAtCam = 0; this.pending = null; this.interactive = 0;
    this.camPos = new V3(); this.camTarget = new V3(); this.inited = false;
  }
  setMode(m) {
    this.mode = m; this.inited = false; this.inited2 = false; // snap on a mode change
    if (m === 'director') this.cut(this.pickShot());
    if (m === 'photo') { this.free.pos.copy(camera.position); const d = camera.getWorldDirection(new V3()); this.free.yaw = Math.atan2(d.x, d.z); this.free.pitch = Math.asin(clamp(d.y, -1, 1)); }
  }
  restart() { this.mode = 'director'; this.cut('crane'); }
  cut(name) { this.shot = name; this.shotT = 0; this.inited = false; this.hist.push(name); if (this.hist.length > 4) this.hist.shift(); }
  event(kind) {
    if (this.mode !== 'director' || this.shot === 'crane' || reduceMotion) return; // no reactive cuts when motion is reduced
    const settle = this.hist.length <= 2 ? 5 : 1.2; // let the first hero after the crane breathe
    if (kind === 'catch' && this.shot !== 'pouch' && this.shotT > settle) this.pending = 'pouch';
    if (kind === 'trick' && this.shotT > 1.5 && this.shot !== 'low') this.pending = Math.random() < 0.5 ? 'low' : 'side';
  }
  pickShot() {
    const busy = this.interactive > 0;
    const pool = busy ? ['hero', 'rear34', 'side', 'hero', 'aerial'] : ['hero', 'low', 'feet', 'pouch', 'aerial', 'side', 'tele', 'hero', 'rear34'];
    let s; for (let k = 0; k < 10; k++) { s = pool[Math.floor(Math.random() * pool.length)]; if (!this.hist.includes(s)) break; }
    return s;
  }
  // choose the camera side so the pelican is front-lit (or, sometimes, rim-lit against the sun)
  chooseSide(R, sky) {
    const sun = sky.lightDir, right = R.right;
    const d = sun.x * right.x + sun.z * right.z;
    // rim light only on wide shots: a close-up into a low sun is all glare
    const wide = this.shot === 'hero' || this.shot === 'side' || this.shot === 'rear34' || this.shot === 'low' || this.shot === 'aerial';
    const rim = wide && sky.isGolden() && Math.random() < 0.35;
    this.side = (d > 0 ? 1 : -1) * (rim ? -1 : 1);
    if (Math.abs(d) < 0.15) this.side = Math.random() < 0.5 ? 1 : -1;
  }
  // world point from rider-frame offsets (x: right, y: up, z: forward)
  rf(R, x, y, z, out = new V3()) { return out.copy(R.pos).addScaledVector(R.right, x).addScaledVector(R.up, y).addScaledVector(this.fwd, z); }
  // Is the pedal area hidden from `pos`? Rays to four points round the cranks, tested against the pelican's
  // body, wings and feather cards (a lowered, flared wing on a hard lean can hang right in front of a low lens)
  // and the ground. The bike and the legs are what the shot is of, so they don't count.
  feetBlocked(pos, R, pel) {
    const occ = [pel.body.mesh, pel.cardMesh, ...pel.wings.map((w) => w.loft.mesh)];
    for (const o of occ) { o.geometry.boundingSphere = null; if (o.isInstancedMesh) o.boundingSphere = null; } // rebuilt every frame
    let n = 0;
    for (const [x, y] of [[0.1, 0.17], [0.1, 0.37], [-0.1, 0.17], [-0.1, 0.37]]) {
      const p = this.rf(R, x, y, 0, _p), d = _d.subVectors(p, pos), L = d.length(); d.divideScalar(L);
      _rc.set(pos, d); _rc.far = L;
      let hit = _rc.intersectObjects(occ, false).length > 0;
      for (let k = 1; !hit && k < 8; k++) { _p.copy(pos).addScaledVector(d, L * k / 8); hit = _p.y < this.heightAt(_p.x, _p.z); }
      n += hit;
    }
    return n >= 2;
  }

  update(dt, R, pel, sky, input) {
    // smoothed heading so road wiggles don't jitter the camera
    this.fwd.lerp(R.fwd, 1 - Math.exp(-3 * dt)).normalize();
    this.interactive = Math.max(0, this.interactive - dt);
    const chest = this.rf(R, 0, 1.05, 0.05), head = pel.headWorld(new V3());
    let pos = new V3(), tgt = new V3(), fov = 35, ap = 0.05, focusPt = chest, snap = false;
    this.lookAtCam = 0; this.letterbox = false;
    const m = this.mode;
    if (m === 'director') {
      this.shotT += dt;
      let S = SHOTS[this.shot];
      if (this.shot === 'crane') {
        // high over the water behind the rider, sweeping down into the hero 3/4
        this.letterbox = this.shotT < 7.5;
        const k = smooth(0, 1, this.shotT / 8.5), e = k * k * (3 - 2 * k);
        if (!this.inited) { this.chooseSide(R, sky); this.inited = true; }
        const a = this.rf(R, this.side * 14, 26, -30), b = this.rf(R, this.side * 2.3, 1.2, 3.5);
        pos.lerpVectors(a, b, e); pos.y += Math.sin(e * Math.PI) * 6;
        const ta = this.rf(R, 0, 2, 40), tb = chest.clone().addScaledVector(this.fwd, 0.25); tb.y -= 0.17; tgt.lerpVectors(ta, tb, smooth(0, 0.8, k));
        fov = lerp(48, 34, e); ap = lerp(0.005, 0.05, e);
        if (this.shotT > 9.5) this.cut('hero');
      } else {
        if (!this.inited) {
          this.chooseSide(R, sky); this.inited = true; snap = true;
          // the feet close-up needs a clear view of the pedals: take the other side, or another shot
          if (this.shot === 'feet') {
            this.clearT = 0.25;
            if (this.feetBlocked(this.rf(R, this.side * 1.05, 0.3, 0.12), R, pel)) {
              if (!this.feetBlocked(this.rf(R, -this.side * 1.05, 0.3, 0.12), R, pel)) this.side = -this.side;
              else { this.shot = this.hist[this.hist.length - 1] = 'hero'; S = SHOTS.hero; }
            }
          }
          if (this.shot === 'low') this.rf(R, this.side * 1.7, 0.32, Math.max(6, R.speed * 2.6), this.fixed);
          if (this.shot === 'tele') this.rf(R, this.side * 0.5, 1.3, 16 + R.speed * 3, this.fixed);
          this.drift = Math.random() * 10;
        }
        const t = this.shotT, dr = this.drift, sd = this.side;
        switch (this.shot) {
          case 'hero': this.rf(R, sd * (2.3 + Math.sin(t * 0.25 + dr) * 0.25), 1.2 + Math.sin(t * 0.3) * 0.1, 3.5 - t * 0.06, pos); tgt.copy(chest).addScaledVector(this.fwd, 0.25); tgt.y -= 0.17; break;
          case 'rear34': this.rf(R, sd * 1.7, 1.7, -3.4 + t * 0.05, pos); tgt.copy(chest).addScaledVector(this.fwd, 0.9).y += 0.1; break;
          case 'side': this.rf(R, sd * 3.7, 1.05, 0.2 + Math.sin(t * 0.3 + dr) * 0.4, pos); tgt.copy(chest); break;
          case 'feet':
            this.rf(R, sd * 1.05, 0.3, 0.12 - t * 0.03, pos); this.rf(R, sd * 0.05, 0.32, -0.02, tgt); focusPt = this.rf(R, sd * 0.09, 0.3, 0);
            // if something swings into the way later (a hard lean towards the lens), cut away
            if ((this.clearT -= dt) < 0) { this.clearT = 0.25; if (this.feetBlocked(pos, R, pel)) this.shotT = Infinity; }
            break;
          case 'pouch': this.rf(R, sd * 1.15, 1.42, 0.62 + t * 0.03, pos); pel.pouchWorld(tgt); tgt.lerp(head, 0.3); focusPt = tgt.clone(); this.lookAtCam = smooth(0.6, 1.4, t) * (1 - smooth(3.8, 4.8, t)); break;
          case 'aerial': this.rf(R, sd * (6.5 + t * 0.4), 5.5 + t * 0.5, -7 + t * 0.5, pos); tgt.copy(chest).addScaledVector(this.fwd, 2.5); break;
          case 'low': pos.copy(this.fixed); tgt.copy(chest).y += 0.1; break;
          case 'tele': pos.copy(this.fixed); tgt.copy(chest); break; // fov follows the distance below
        }
        fov = S.fov; ap = S.ap;
        // telephoto: zoom so the rider stays ~38% of the frame height as it approaches
        if (this.shot === 'tele') fov = clamp(2 * Math.atan(1.7 / 0.38 / 2 / Math.max(2, pos.distanceTo(chest))) * 180 / Math.PI, 8, 40);
        if (this.shot === 'low' || this.shot === 'tele') {
          // end once the rider has passed the fixed camera
          const rel = new V3().subVectors(R.pos, this.fixed).dot(this.fwd);
          if (rel > 1.5 || this.shotT > S.dur + 2) this.shotT = Math.max(this.shotT, S.dur);
        }
        // close-ups are brief while someone is steering
        const dur = (reduceMotion ? 1.6 : 1) * S.dur * (this.interactive > 0 && (this.shot === 'pouch' || this.shot === 'feet') ? 0.55 : 1);
        if (this.pending && this.shotT > (this.hist.length <= 2 ? 5 : 1)) { this.cut(this.pending); this.pending = null; }
        else if (this.shotT > dur) this.cut(this.pickShot());
      }
      this.label = this.shot === 'crane' ? 'Crane' : ({ hero: 'Hero ¾', rear34: 'Rear ¾', low: 'Low angle', feet: 'Feet', pouch: 'Pouch close-up', aerial: 'Aerial', side: 'Side tracking', tele: 'Telephoto' })[this.shot];
    } else if (m === 'chase') {
      // high enough to look down the road over the pelican's head, so fish lines read against the asphalt
      this.rf(R, 0.55, 2.4, -4.0, pos); tgt.copy(R.pos).addScaledVector(R.up, 0.9).addScaledVector(this.fwd, 2.2); fov = 46; ap = 0.012; this.label = 'Chase'; // a gameplay camera: shallow DOF would blur the lines far down the road
    } else if (m === 'side') {
      this.rf(R, -4.4, 1.1, 0.3, pos); tgt.copy(chest); fov = 32; ap = 0.045; this.label = 'Side';
    } else if (m === 'orbit') {
      const o = this.orbit; if (input && input.drag) { o.yaw -= input.drag.x * 0.006; o.pitch = clamp(o.pitch + input.drag.y * 0.004, -0.2, 1.3); }
      if (input && input.wheel) o.dist = clamp(o.dist * Math.exp(input.wheel * 0.001), 1.2, 14);
      const yaw = Math.atan2(this.fwd.x, this.fwd.z) + o.yaw;
      pos.set(Math.sin(yaw) * Math.cos(o.pitch), Math.sin(o.pitch), Math.cos(yaw) * Math.cos(o.pitch)).multiplyScalar(o.dist).add(chest);
      tgt.copy(chest); fov = 36; ap = 0.05; this.label = 'Orbit';
    } else if (m === 'pov') {
      pel.eyeWorld(1, pos).lerp(pel.eyeWorld(-1, new V3()), 0.5).addScaledVector(R.up, 0.05).addScaledVector(this.fwd, -0.02);
      // look a little down the bill so the mandible and pouch sit in the lower third
      tgt.copy(R.pos).addScaledVector(this.fwd, 9).addScaledVector(R.up, 0.15); fov = 72; ap = 0.0; this.label = 'Pelican POV'; snap = true;
      focusPt = tgt;
    } else if (m === 'photo') {
      const F = this.free; if (input) {
        if (input.drag) { F.yaw -= input.drag.x * 0.004; F.pitch = clamp(F.pitch - input.drag.y * 0.004, -1.4, 1.4); }
        const f = new V3(Math.sin(F.yaw) * Math.cos(F.pitch), Math.sin(F.pitch), Math.cos(F.yaw) * Math.cos(F.pitch)), r = new V3().crossVectors(f, new V3(0, 1, 0)).normalize();
        const mv = new V3().addScaledVector(f, input.move.z).addScaledVector(r, input.move.x).addScaledVector(new V3(0, 1, 0), input.move.y);
        F.vel.lerp(mv.multiplyScalar(input.fast ? 9 : 2.5), 1 - Math.exp(-8 * dt)); F.pos.addScaledVector(F.vel, dt);
        pos.copy(F.pos); tgt.copy(F.pos).add(f);
      }
      fov = this.photoFov || 35; ap = 0; snap = true; this.label = 'Photo';
    }
    // composition: while the title card covers the left, slide the subject to the right third
    const shotBias = m !== 'director' ? 0 : ({ crane: 1, hero: 1, aerial: 1, rear34: 0.8, low: 0.6, tele: 0.5, side: 0.35 })[this.shot] ?? 0;
    this.bias = damp(this.bias || 0, (this.frameBias || 0) * shotBias, 2.5, dt);
    const closeUp = m === 'director' && (this.shot === 'pouch' || this.shot === 'feet');
    if (this.bias > 0.001 && m === 'director') {
      const d = pos.distanceTo(tgt), right = new V3().subVectors(tgt, pos).cross(new V3(0, 1, 0)).normalize();
      tgt.addScaledVector(right, -this.bias * d * Math.tan(fov * Math.PI / 360) * (innerWidth / innerHeight) * 0.36);
    }
    // keep the camera above ground and water
    const gh = Math.max(this.heightAt(pos.x, pos.z), 0) + (m === 'pov' || m === 'photo' ? 0.05 : 0.22);
    if (pos.y < gh) pos.y = gh;
    // subtle handheld shake on planks and at speed (off for reduced motion)
    if (!reduceMotion && m !== 'photo' && m !== 'pov') {
      const k = (R.bumpy ? 0.012 : 0.004) * clamp(R.speed / 8, 0, 1.3), tt = performance.now() / 1000;
      pos.x += (vnoise(tt * 3.1, 1) - 0.5) * k; pos.y += (vnoise(tt * 3.7, 2) - 0.5) * k; tgt.x += (vnoise(tt * 2.3, 5) - 0.5) * k * 0.5;
    }
    // smooth the chase-style modes; tracking shots are rigid to the smoothed frame
    const sm = snap || !this.inited2 ? 1 : (m === 'chase' || m === 'side' || m === 'orbit') ? 1 - Math.exp(-7 * dt) : 1 - Math.exp(-14 * dt);
    this.inited2 = true;
    // smooth relative to the rider so a moving subject stays where the shot put it (no lag drift)
    const fixedShot = m === 'photo' || (m === 'director' && (this.shot === 'low' || this.shot === 'tele'));
    const base = fixedShot ? new V3() : R.pos;
    this.relP = this.relP || new V3(); this.relT = this.relT || new V3();
    const rp = pos.clone().sub(base), rt = tgt.clone().sub(base);
    if (snap && m === 'director' && this.shotT < dt * 1.5) { this.relP.copy(rp); this.relT.copy(rt); }
    else if (this.lastFixed !== fixedShot) { this.relP.copy(rp); this.relT.copy(rt); }
    else { this.relP.lerp(rp, sm); this.relT.lerp(rt, sm); }
    this.lastFixed = fixedShot;
    this.camPos.copy(base).add(this.relP); this.camTarget.copy(base).add(this.relT);
    camera.position.copy(this.camPos); camera.lookAt(this.camTarget);
    this.fov = damp(this.fov, fov, 6, dt); if (snap) this.fov = fov;
    camera.fov = this.fov; camera.near = m === 'pov' ? 0.02 : 0.05; camera.updateProjectionMatrix();
    this.focus = camera.position.distanceTo(focusPt); this.aperture = ap;
  }
}
