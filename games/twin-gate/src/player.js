// First-person character: cannon-es body of three stacked spheres, ground/air movement, jump, and a camera whose
// orientation is carried through gates and then eased upright (roll and "body up" decay back to world up).
import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { phys, contactsOf, STEP } from './physics.js';
import { gates, linked, xfPoint, xfQuat, xfDir, travellers } from './portals.js';

export const RADIUS = 0.3, CENTER_H = 0.9, EYE = 0.7;
export const WALK = 4.6, JUMP_V = 4.9, GROUND_ACC = 42, AIR_WISH = 1.6, AIR_ACC = 7, TERMINAL = 33;
export const FLOOR_EXIT_MIN = 6.0;       // min speed out of an upward-facing gate so you clear it
const UP = new THREE.Vector3(0, 1, 0), ID = new THREE.Quaternion();

const body = new CANNON.Body({ mass: 80, fixedRotation: true, material: phys.mat.player, linearDamping: 0, allowSleep: false });
for (const y of [-0.6, 0, 0.6]) body.addShape(new CANNON.Sphere(RADIUS), new CANNON.Vec3(0, y, 0));
body.updateMassProperties();

export const player = {
  body, yaw: 0, pitch: 0, residual: new THREE.Quaternion(), up: new THREE.Vector3(0, 1, 0),
  grounded: false, groundBody: null, groundN: new THREE.Vector3(0, 1, 0), groundP: new THREE.Vector3(), airT: 0,
  coyote: 0, jumpBuf: 0, preVel: new THREE.Vector3(), contacts: [],
  prev: new THREE.Vector3(), cur: new THREE.Vector3(),
  health: 100, alive: true, hurtT: 0,
  bobT: 0, bobAmt: 0, land: 0, landV: 0, fovKick: 0,
  keys: { f: 0, b: 0, l: 0, r: 0, jump: false },
  speedGel: false, onFootstep: null, onLand: null, onJump: null,
  groundVel: new THREE.Vector3(),
  traveller: null, noclipHold: null,
};
player.traveller = { body, prev: new CANNON.Vec3(), radius: 0.95, isPlayer: true, onTeleport: (i) => afterGate(i) };

export function spawnPlayer(p, yaw = 0) {
  if (!phys.world.bodies.includes(body)) phys.world.addBody(body);
  travellers.add(player.traveller);
  body.position.set(p[0], p[1] + CENTER_H, p[2]); body.velocity.set(0, 0, 0);
  body.previousPosition.copy(body.position);
  player.yaw = yaw; player.pitch = 0; player.residual.identity(); player.up.copy(UP);
  player.prev.set(body.position.x, body.position.y, body.position.z); player.cur.copy(player.prev);
  player.health = 100; player.alive = true; player.hurtT = 0; player.land = 0; player.landV = 0; player.airT = 0;
  player.grounded = false; player.speedGel = false;
}

const _f = new THREE.Vector3(), _u = new THREE.Vector3(), _d = new THREE.Vector3(), _e = new THREE.Euler(0, 0, 0, 'YXZ'), _qa = new THREE.Quaternion();
export const yawPitchQuat = (yaw, pitch, out = new THREE.Quaternion()) => out.setFromEuler(_e.set(pitch, yaw, 0, 'YXZ'));
export function viewQuat(out = new THREE.Quaternion()) { return out.copy(player.residual).multiply(yawPitchQuat(player.yaw, player.pitch, _qa)); }

// Split an arbitrary camera orientation into yaw/pitch plus a residual rotation that will ease out.
export function setViewQuat(q) {
  _f.set(0, 0, -1).applyQuaternion(q); _u.set(0, 1, 0).applyQuaternion(q);
  _d.set(_f.x * _u.y - _u.x * _f.y, 0, _f.z * _u.y - _u.z * _f.y);
  if (_d.lengthSq() < 1e-8) _d.set(-Math.sin(player.yaw), 0, -Math.cos(player.yaw));
  player.yaw = Math.atan2(-_d.x, -_d.z);
  player.pitch = Math.asin(THREE.MathUtils.clamp(_f.y, -1, 1));
  player.pitch = THREE.MathUtils.clamp(player.pitch, -1.55, 1.55);
  player.residual.copy(q).multiply(yawPitchQuat(player.yaw, player.pitch, _qa).invert());
}

function afterGate(i) {
  const exit = gates[1 - i], entry = gates[i];
  // crossing between a wall and a floor/ceiling/angled gate: curl up into the middle sphere for a moment so the
  // upright body does not clip the tilted surface around the exit (Portal force-crouches here too)
  if (Math.abs(exit.n.y) > 0.25 || Math.abs(entry.n.y) > 0.25) player.curlT = 0.4;
  setViewQuat(xfQuat(i, viewQuat()));
  xfDir(i, player.up, player.up);
  // an upward-facing exit gets a minimum launch so the body clears the opening
  if (exit.n.y > 0.5) {
    const v = body.velocity, vn = v.x * exit.n.x + v.y * exit.n.y + v.z * exit.n.z;
    if (vn < FLOOR_EXIT_MIN) { const k = FLOOR_EXIT_MIN - vn; v.x += exit.n.x * k; v.y += exit.n.y * k; v.z += exit.n.z * k; }
  }
  player.grounded = false; player.coyote = 0; player.airT = 0.01;
  player.prev.set(body.position.x, body.position.y, body.position.z); player.cur.copy(player.prev);
}

// Called before each physics step.
export function playerPreStep(dt) {
  const k = player.keys, v = body.velocity;
  player.curlT = Math.max(0, (player.curlT || 0) - dt);
  body.shapes[0].collisionResponse = body.shapes[2].collisionResponse = player.curlT <= 0;
  player.preVel.set(v.x, v.y, v.z);
  if (!player.alive) { v.x *= 0.9; v.z *= 0.9; return; }
  const fx = -Math.sin(player.yaw), fz = -Math.cos(player.yaw);
  let wx = fx * (k.f - k.b) + -fz * (k.r - k.l), wz = fz * (k.f - k.b) + fx * (k.r - k.l);
  const wl = Math.hypot(wx, wz), mag = Math.min(1, wl); if (wl > 0) { wx /= wl; wz /= wl; } // analog input keeps its magnitude
  player.jumpBuf = k.jump ? 0.12 : Math.max(0, player.jumpBuf - dt); k.jump = false;
  player.coyote = player.grounded ? 0.1 : Math.max(0, player.coyote - dt);
  const gv = player.groundVel;
  if (player.grounded) {
    const max = player.speedGel ? 14 : WALK;
    let tx = wx * max * mag + gv.x, tz = wz * max * mag + gv.z;
    let dvx = tx - v.x, dvz = tz - v.z;
    const hs = Math.hypot(v.x - gv.x, v.z - gv.z);
    let acc = player.speedGel ? (wl ? 10 : 3) : GROUND_ACC;
    // landing faster than walking: skid down with friction instead of snapping
    if (!player.speedGel && hs > max + 0.5) { acc = 14; if (wl) { const along = (wx * (v.x - gv.x) + wz * (v.z - gv.z)) / hs; if (along > 0.5) { tx = v.x; tz = v.z; } } }
    const dl = Math.hypot(dvx, dvz), lim = acc * dt;
    if (dl > lim) { dvx *= lim / dl; dvz *= lim / dl; }
    v.x += dvx; v.z += dvz;
    // cancel the slide gravity induces on gentle slopes when standing still
    if (!wl && v.y < 0 && player.groundN.y > 0.8 && !player.speedGel) v.y *= 0.5;
  } else if (wl && !player.noAir) {
    // weak air control (none during a faith-plate throw); while flung fast, input that would brake the fling is ignored
    const hs = Math.hypot(v.x, v.z), cur = v.x * wx + v.z * wz;
    if (hs > 7.5 && cur < 0) { const k = cur / hs; wx -= v.x / hs * k; wz -= v.z / hs * k; const l = Math.hypot(wx, wz); if (l > 1e-3) { wx /= l; wz /= l; } else wx = wz = 0; }
    const add = AIR_WISH * mag - (v.x * wx + v.z * wz);
    if (add > 0 && (wx || wz)) { const a = Math.min(AIR_ACC * dt, add); v.x += wx * a; v.z += wz * a; }
  }
  if (!player.grounded) funnel(dt, v);
  if (player.jumpBuf > 0 && (player.grounded || player.coyote > 0)) {
    v.y = JUMP_V + Math.max(0, gv.y); player.jumpBuf = 0; player.coyote = 0; player.grounded = false;
    if (player.onJump) player.onJump();
  }
  const sp = Math.hypot(v.x, v.y, v.z); if (sp > TERMINAL) { const s = TERMINAL / sp; v.x *= s; v.y *= s; v.z *= s; }
}

// Floor-gate funnelling: falling fast while looking down at an upward-facing gate below, the horizontal drift
// is eased toward a path that lands in its centre.
function funnel(dt, v) {
  if (v.y > -4 || player.pitch > -0.35 || !linked()) return;
  const p = body.position, feet = p.y - CENTER_H;
  for (const g of gates) {
    if (g.n.y < 0.7) continue;
    const dy = feet - g.c.y; if (dy < 0.2 || dy > 30) continue;
    // reach grows with height: a long fall gets a wide funnel, a short hop only a nudge
    const ox = g.c.x - p.x, oz = g.c.z - p.z; if (Math.hypot(ox, oz) > 2 + dy * 0.3) continue;
    const t = (v.y + Math.sqrt(v.y * v.y + 2 * 15 * (dy + CENTER_H))) / 15; // time until the centre reaches the plane
    const tx = ox / Math.max(t, 0.1), tz = oz / Math.max(t, 0.1);
    if (Math.hypot(tx, tz) > 9) continue;
    const k = Math.min(1, dt * 5); v.x += (tx - v.x) * k; v.z += (tz - v.z) * k;
    return;
  }
}

// Called after each physics step (after gate teleports).
export function playerPostStep(dt) {
  const cs = contactsOf(body, player.contacts);
  let g = null, best = 0.6;
  for (const c of cs) if (c.ny > best && !(c.other.isProp && c.other.held)) { best = c.ny; g = c; }
  const was = player.grounded;
  player.grounded = !!g && body.velocity.y < 3 + (g && g.other.type === CANNON.Body.KINEMATIC ? g.other.velocity.y : 0);
  if (player.grounded) {
    player.groundBody = g.other; player.groundN.set(g.nx, g.ny, g.nz); player.groundP.set(g.px, g.py, g.pz);
    const ob = g.other;
    if (ob.type === CANNON.Body.KINEMATIC) player.groundVel.set(ob.velocity.x, ob.velocity.y, ob.velocity.z); else player.groundVel.set(0, 0, 0);
    if (!was) {
      const iv = -player.preVel.y;
      if (iv > 2.5) { player.landV = Math.min(0.14, iv * 0.012); if (player.onLand) player.onLand(iv); }
    }
    player.airT = 0; player.noAir = false;
  } else { player.groundBody = null; player.airT += dt; if (was) player.groundVel.set(0, 0, 0); }
  player.prev.copy(player.cur); player.cur.set(body.position.x, body.position.y, body.position.z);
}

// Per-frame camera update: returns eye position + orientation, resolved through a gate if the head is past one.
const _c = new THREE.Vector3(), _eye = new THREE.Vector3(), _q = new THREE.Quaternion(), _x = new THREE.Vector3(), _r = new THREE.Vector3();
export function playerView(alpha, dt, bobOn = true) {
  // ease the residual roll and body-up back to upright
  player.residual.slerp(ID, 1 - Math.exp(-dt * 3.2));
  player.up.lerp(UP, 1 - Math.exp(-dt * 4.5)).normalize();
  const hs = Math.hypot(body.velocity.x - player.groundVel.x, body.velocity.z - player.groundVel.z);
  const moving = player.grounded && hs > 0.8;
  player.bobAmt += ((moving && bobOn ? Math.min(1, hs / WALK) : 0) - player.bobAmt) * Math.min(1, dt * 8);
  if (player.grounded) {
    const prevPhase = Math.floor(player.bobT / Math.PI);
    player.bobT += dt * (hs * 2.1 + 0.001);
    if (moving && Math.floor(player.bobT / Math.PI) !== prevPhase && player.onFootstep) player.onFootstep(hs);
  }
  // landing dip: a damped spring
  player.land += (player.landV - player.land) * Math.min(1, dt * 30); player.landV *= Math.exp(-dt * 9);
  _c.copy(player.prev).lerp(player.cur, alpha);
  viewQuat(_q);
  _r.set(1, 0, 0).applyQuaternion(_q);
  const b = player.bobAmt;
  _eye.copy(_c).addScaledVector(player.up, EYE + Math.abs(Math.sin(player.bobT)) * 0.045 * b - 0.02 * b - player.land)
    .addScaledVector(_r, Math.sin(player.bobT) * 0.028 * b);
  // head past a gate before the body: render from the far side
  if (linked()) for (const g of gates) {
    const d0 = g.dist(_c), d1 = g.dist(_eye);
    if (d0 >= 0 && d1 < 0) { _x.copy(_c).lerp(_eye, d0 / (d0 - d1)); if (g.inHole(_x, 0)) { xfPoint(g.i, _eye, _eye); xfQuat(g.i, _q, _q); break; } }
  }
  return { pos: _eye, quat: _q, speed: Math.hypot(body.velocity.x, body.velocity.y, body.velocity.z) };
}
