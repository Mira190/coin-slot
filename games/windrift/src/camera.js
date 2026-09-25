// Camera rig: chase / far chase / hood / trackside TV, plus the pre-race flyover and the finish orbit.
// FOV widens with speed and nitro; shake on hits, walls and hard landings.
import * as THREE from 'three';
import { angDiff } from './physics.js';
import { wrap, F } from './track.js';

const RM = (() => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; } })();
export const CAMS = [{ zh: '追尾', en: 'Chase' }, { zh: '远景', en: 'Far' }, { zh: '车头', en: 'Hood' }, { zh: '转播', en: 'TV' }];

export class CameraRig {
  constructor() {
    this.cam = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.25, 5000);
    this.mode = 0; this.yaw = 0; this.shakeA = 0; this.fov = 70; this.pos = new THREE.Vector3(); this.look = new THREE.Vector3();
    this.first = true; this.tv = null; this.t = 0;
  }
  resize(a) { this.cam.aspect = a; this.cam.updateProjectionMatrix(); }
  shake(a) { if (!RM) this.shakeA = Math.min(1.2, Math.max(this.shakeA, a)); }
  snap() { this.first = true; }
  follow(view, k, dt, W, boost) {
    const p = view.pos, cam = this.cam;
    this.t += dt;
    const slip = angDiff(k.h, k.vh);
    // sit behind the nose, swinging out a little in drifts (clamped so a collision slide can't swing it sideways)
    const wantYaw = k.h - Math.max(-0.55, Math.min(0.55, slip)) * 0.6;
    if (this.first) { this.yaw = wantYaw; }
    this.yaw += angDiff(wantYaw, this.yaw) * Math.min(1, dt * (k.drift.on ? 3.2 : 5.5));
    const spdF = Math.min(1.4, Math.abs(k.spd) / 42);
    let want = 68 + spdF * 7 + (boost ? 11 : 0);
    const m = this.mode;
    const target = new THREE.Vector3(), look = new THREE.Vector3();
    if (m === 0 || m === 1) {
      const dist = m === 0 ? 6.4 + spdF * 0.9 + (boost ? 0.9 : 0) : 11 + spdF;
      const hgt = m === 0 ? 2.5 : 4.6;
      target.set(p.x - Math.sin(this.yaw) * dist, p.y + hgt, p.z - Math.cos(this.yaw) * dist);
      look.set(p.x + Math.sin(this.yaw) * 5, p.y + 1.25, p.z + Math.cos(this.yaw) * 5);
      const g = W.groundAt(target.x, target.z) + 1.2;
      // keep above the ground behind the kart unless we're in a tunnel
      if (target.y < g && !W.inTunnel) target.y = g;
      if (this.first) this.pos.copy(target);
      const lag = Math.min(1, dt * 11);
      this.pos.lerp(target, lag);
      // vertical: follow fast when airborne so jumps read well
      this.pos.y += (target.y - this.pos.y) * Math.min(1, dt * 6);
      this.look.copy(look);
      view.head.visible = true; view.driver.visible = true;
    } else if (m === 2) {
      const h = k.h;
      target.set(p.x + Math.sin(h) * 0.5, p.y + 1.45, p.z + Math.cos(h) * 0.5);
      look.set(p.x + Math.sin(k.vh * 0.5 + h * 0.5) * 20, p.y + 1.1, p.z + Math.cos(k.vh * 0.5 + h * 0.5) * 20);
      this.pos.copy(target); this.look.copy(look);
      view.driver.visible = false;
      want += 6;
    } else if (W.inTunnel) {
      // inside a tunnel the trackside view is blind: ride along instead
      this.pos.set(p.x - Math.sin(this.yaw) * 7, p.y + 2.6, p.z - Math.cos(this.yaw) * 7); this.look.set(p.x, p.y + 1, p.z);
      this.tv = null;
    } else {
      // trackside cameras placed along the kart's path; switch when the kart passes one
      const P = W.T.paths[k.path];
      if (!this.tv || this.tv.path !== k.path || (P.closed ? ((this.tv.i - k.idx + P.n) % P.n) > P.n / 2 : k.idx >= this.tv.i)) {
        // a spot along the path the kart is on (loop or shortcut: it used to stay parked at the fork). Candidates on
        // either side, near/far and low/high are scored by open ground and by whether hills cut the sight line to
        // the stretch the kart drives towards the camera
        // a tunnel ahead hides everything beyond its mouth: put the camera just before the mouth instead
        let i = wrap(P, k.idx + 42);
        for (let s = 8; s <= 42; s++) if (P.fl[wrap(P, k.idx + s)] & F.TUN) { i = wrap(P, k.idx + s - 3); break; }
        let best = null;
        for (const side of [1, -1]) for (const off of [P.hw[i] + 9, P.hw[i] + 4]) for (const up of [6, 13]) {
          const x = P.x[i] + P.nx[i] * side * off, z = P.z[i] + P.nz[i] * side * off, g = W.groundAt(x, z), y = Math.max(P.y[i] + up, g + 4);
          let cost = Math.max(0, g - P.y[i]) + (off < P.hw[i] + 5 ? 2 : 0) + (up > 6 ? 1.5 : 0);
          for (let s = 0; s < 42; s += 6) {
            const j = wrap(P, k.idx + s), ty = P.y[j] + 1;
            for (let f = 0.1; f < 0.95; f += 0.1) if (W.groundAt(x + (P.x[j] - x) * f, z + (P.z[j] - z) * f) > y + (ty - y) * f) { cost += 3; break; }
          }
          if (!best || cost < best.cost) best = { x, y, z, cost };
        }
        this.tv = { path: k.path, i, pos: new THREE.Vector3(best.x, best.y, best.z) };
      }
      this.pos.copy(this.tv.pos); this.look.set(p.x, p.y + 1, p.z);
      const d = this.pos.distanceTo(this.look);
      want = Math.max(18, Math.min(60, 1400 / Math.max(10, d)));
      view.driver.visible = true;
    }
    this.first = false;
    if (cam.aspect < 1) want += (1 - cam.aspect) * 36; // portrait phones: keep the horizontal view usable
    this.fov += (want - this.fov) * Math.min(1, dt * 4);
    cam.fov = this.fov; cam.updateProjectionMatrix();
    cam.position.copy(this.pos);
    if (this.shakeA > 0) {
      const s = this.shakeA * 0.35;
      cam.position.x += (Math.random() - 0.5) * s; cam.position.y += (Math.random() - 0.5) * s; cam.position.z += (Math.random() - 0.5) * s;
      this.shakeA = Math.max(0, this.shakeA - dt * 2.5);
    }
    cam.up.set(0, 1, 0);
    cam.lookAt(this.look);
    if (m === 2) cam.rotateZ(-slip * 0.15);
  }
  // pre-race flyover: swoop from above the gantry down behind the player
  intro(view, k, u, W) {
    const p = view.pos, cam = this.cam;
    const e = 1 - Math.pow(1 - Math.min(1, u), 3);
    const a0 = k.h + 2.4, a1 = k.h + Math.PI;
    const a = a0 + (a1 - a0) * e, r = 42 - 35.6 * e, hgt = 26 - 23.5 * e;
    cam.position.set(p.x + Math.sin(a) * r, p.y + hgt, p.z + Math.cos(a) * r);
    this.fov = 62 + e * 6; cam.fov = this.fov; cam.updateProjectionMatrix();
    cam.lookAt(p.x + Math.sin(k.h) * 8 * (1 - e), p.y + 1 + 3 * (1 - e), p.z + Math.cos(k.h) * 8 * (1 - e));
    this.pos.copy(cam.position); this.yaw = k.h;
  }
  orbit(p, dt, radius = 9, h = 3.2) {
    this.t += dt;
    const a = this.t * 0.35, cam = this.cam;
    cam.position.set(p.x + Math.sin(a) * radius, p.y + h, p.z + Math.cos(a) * radius);
    cam.fov = 55; cam.updateProjectionMatrix();
    cam.lookAt(p.x, p.y + 0.9, p.z);
  }
}
