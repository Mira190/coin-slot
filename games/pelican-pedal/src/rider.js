// The ride: bicycle physics along the coast road (pedal, brake, drag, slope, steering across the
// lanes, lean from yaw rate, hop, wing-lift wheelie) and the pelican/scarf driven from it.
import { THREE, V3, clamp, lerp, damp, smooth, bus, reduceMotion, basisQuat } from './core.js';
import { ROAD_W } from './layout.js';
import { roadFrame, roadHeightAt, surfaceAt } from './world.js';
import { G } from './bike.js';

export const LANE = ROAD_W / 2 - 0.6;
const _tb = new V3(), _d = new V3(), _x = new V3(1, 0, 0), _q = new THREE.Quaternion();

export class Rider {
  constructor(bike, pel, scarf) {
    this.bike = bike; this.pel = pel; this.scarf = scarf;
    this.s = 0; this.lat = -1.2; this.latV = 0; this.v = 7; this.h = 0; this.vh = 0; this.wheelie = 0; this.wheelieV = 0;
    this.lean = 0; this.psi = 0; this.trick = 0; this.effort = 0; this.pedaling = true; this.brake = 0; this.flare = 0; this.flapT = 0;
    this.scoop = 0; this.bump = 0; this.airborne = false; this.maxV = 0;
    this.F = roadFrame(0); this.R = { pos: new V3(), fwd: new V3(0, 0, 1), right: new V3(), up: new V3(0, 1, 0), speed: 0, s: 0, zone: 'beach', bumpy: false, lat: 0 };
    this.vel = new V3(); this.prevPos = null;
    this.pedals = [{ p: new V3(), q: new THREE.Quaternion() }, { p: new V3(), q: new THREE.Quaternion() }]; this.grips = [new V3(), new V3()];
    this.look = null; this.lookW = 0; this.eyeLook = null; this.wind = new V3(-1.5, 0, 0.8);
    this.q = new THREE.Quaternion(); this.bellT = 0;
  }
  // in: { pedal, brake, steer, hop (edge), trick (held), scoop (held) }
  update(dt, inp, t) {
    const F = roadFrame(this.s, this.lat, this.F), s0 = this.s, lat0 = this.lat; // (the bike is posed at F)
    const slope = (roadHeightAt(this.s + 1.5) - roadHeightAt(this.s - 1.5)) / 3;
    // longitudinal
    const pedal = clamp(inp.pedal, 0, 1);
    const drive = pedal * 3.4 * Math.max(0, 1 - this.v / 13.5);
    const drag = 0.07 + 0.008 * this.v * this.v + (inp.scoop ? 0.011 * this.v * this.v : 0) + inp.brake * 6 + slope * 9.8 * 0.55; // ~37 km/h flat out, 40+ downhill; a wide-open pouch is a parachute
    this.v = clamp(this.v + (drive - drag) * dt, 0, 17);
    this.pedaling = pedal > 0.05 && this.v > 0.3;
    this.effort = damp(this.effort, this.pedaling ? 0.35 + pedal * 0.4 + Math.max(0, slope) * 6 : 0, 4, dt);
    this.brake = inp.brake;
    // lateral: steer moves across the lanes, faster at speed
    // steer is screen-right positive; +lat is seaward, which is the rider's left on this loop
    const targetLat = -clamp(inp.steer, -1, 1) * lerp(1.0, 3.4, clamp(this.v / 8, 0, 1));
    this.latV = damp(this.latV, targetLat, 5, dt);
    this.lat += this.latV * dt;
    if (Math.abs(this.lat) > LANE) { this.lat = clamp(this.lat, -LANE, LANE); this.latV *= 0.3; }
    const psiPrev = this.psi;
    this.psi = Math.atan2(this.latV, Math.max(this.v, 1));
    const yawRate = this.v * F.k + (this.psi - psiPrev) / Math.max(dt, 1e-3);
    const leanT = clamp(Math.atan(this.v * yawRate / 9.8), -0.5, 0.5);
    this.lean = damp(this.lean, leanT, 6, dt);
    this.s += this.v * dt;
    // vertical: hop and landing
    if (inp.hop && !this.airborne && this.v > 1) { this.vh = 3.1; this.airborne = true; this.flapT = 0.7; bus.emit('hop'); }
    if (this.airborne) {
      this.vh -= 9.8 * dt; this.h += this.vh * dt;
      if (this.h <= 0) { this.h = 0; this.airborne = false; this.bump = -Math.min(6, Math.abs(this.vh)) * 3; this.vh = 0; bus.emit('land'); }
    }
    // wing-lift wheelie: hold to rear up with wings spread
    const wantTrick = inp.trick && this.v > 2.5 && !this.airborne;
    this.trick = damp(this.trick, wantTrick ? 1 : 0, wantTrick ? 3 : 5, dt);
    const wTarget = wantTrick ? 0.3 + Math.sin(t * 2.2) * 0.03 : 0;
    const wf = (wTarget - this.wheelie) * 40 - this.wheelieV * 9;
    this.wheelieV += wf * dt; this.wheelie = clamp(this.wheelie + this.wheelieV * dt, 0, 0.45);
    if (!wantTrick && this.wheelie < 0.01 && this.wheelieV < -0.5) { this.bump = -8; this.wheelieV = 0; bus.emit('land'); }
    this.flapT = Math.max(0, this.flapT - dt);
    // brakes and hard steering make the wings flare for balance
    this.flare = damp(this.flare, clamp(inp.brake * 0.35 + Math.abs(this.latV) * 0.05, 0, 0.4), 4, dt);
    this.scoop = inp.scoop ? 1 : 0;
    // pose the bike in the world: both tyres on the ribbon surface under their contact points
    // (the bike's origin is on the ground under the bottom bracket, the axles at G.RA.z / G.FA.z)
    const up = new V3(0, 1, 0), fwd = F.t.clone().applyAxisAngle(up, this.psi);
    const cp = Math.cos(this.psi), sp = Math.sin(this.psi);
    const yR = surfaceAt(s0 + G.RA.z * cp, lat0 + G.RA.z * sp), yF = surfaceAt(s0 + G.FA.z * cp, lat0 + G.FA.z * sp);
    const pitch = (yF - yR) / (G.FA.z - G.RA.z);
    fwd.y = pitch; fwd.normalize();
    const lup = up.clone().applyAxisAngle(fwd, -this.lean);
    basisQuat(this.q, fwd, lup);
    const B = this.bike.group; B.position.copy(F.p); B.position.y = yR - G.RA.z * pitch + this.h; B.quaternion.copy(this.q);
    // road texture bumps (boardwalk planks rattle); they only ever lift the tyres
    const bumpy = F.zone === 'boardwalk' || F.zone === 'town';
    const rAmp = bumpy && !this.airborne ? 0.004 * clamp(this.v / 6, 0, 1) : 0;
    const rattle = Math.sin(this.s * (F.zone === 'boardwalk' ? 2 * Math.PI / 0.19 : 2 * Math.PI / 0.33)) * rAmp;
    B.position.y += rAmp + rattle;
    this.bike.update(dt, { speed: this.v, pedaling: this.pedaling, steer: -this.psi * 1.2 - this.lean * 0.25 + (this.v < 3 ? Math.sin(t * 3) * 0.04 : 0), wheelie: this.wheelie, lights: this.lights || 0 });
    // the raked, steered front wheel dips or lifts a few mm as it turns and leans: find where each tyre
    // really bottoms out and nudge the bike's height and pitch so both touch the surface under them
    // (in a wheelie only the rear one is on the ground)
    B.updateMatrixWorld(true);
    const err = [0, 1].map((i) => {
      const b = this.bike.tyreBottom(i, _tb), d = _d.subVectors(b, F.p);
      return surfaceAt(s0 + d.dot(F.t), lat0 + d.dot(F.n)) + this.h + rAmp + rattle - b.y;
    });
    const dP = this.wheelie > 0.005 ? 0 : (err[1] - err[0]) / (G.FA.z - G.RA.z);
    B.position.y += err[0] - G.RA.z * dP;
    B.quaternion.multiply(_q.setFromAxisAngle(_x, -dP)); // small nose-up pitch about the origin (+x is the bike's left)
    // velocity (for secondary motion and the scarf)
    const R = this.R; R.pos.copy(B.position); R.fwd.copy(fwd).setY(0).normalize(); R.up.copy(up); R.right.crossVectors(R.fwd, up).normalize();
    R.speed = this.v; R.s = this.s; R.zone = F.zone; R.bumpy = bumpy; R.lat = this.lat; R.f = F.f;
    if (this.prevPos) this.vel.subVectors(B.position, this.prevPos).divideScalar(Math.max(dt, 1e-3)); this.prevPos = (this.prevPos || new V3()).copy(B.position);
    this.maxV = Math.max(this.maxV, this.v);
    // drive the pelican
    B.updateMatrixWorld(true);
    const pel = this.pel;
    for (let i = 0; i < 2; i++) { this.bike.pedalIn(pel.root, i, this.pedals[i].p, this.pedals[i].q); this.bike.gripIn(pel.root, i, this.grips[i]); }
    this.bump = damp(this.bump, 0, 10, dt);
    pel.update({
      dt, crank: this.bike.crank, effort: this.effort, speed: this.v, steer: this.psi * 1.5, lean: this.lean,
      trick: this.trick, flare: this.flare, flapping: this.flapT > 0 || (this.trick > 0.6 && Math.sin(t * 1.3) > 0.7), scoop: Math.max(this.scoop, this.mouth || 0),
      pedals: this.pedals, grips: this.grips, vel: this.vel, bump: this.bump * (reduceMotion ? 0.3 : 1) + rattle * 800,
      look: this.look, lookW: this.lookW, eyeLook: this.eyeLook,
    });
    this.scarf.update(dt, this.vel, this.wind);
  }
  ring() { bus.emit('bell'); this.bike.ring_bell && this.bike.ring_bell(); }
}
