// First-person viewmodel: gloved hands with jointed fingers, IK forearms/upper arms reaching to off-screen
// shoulders, the detailed gun, and procedural animation (sway, bob, recoil, draw, reload, inspect, knife, throw).
// ADS puts the gun's sight point exactly on the camera axis, so irons / red dot / scope line up with the
// crosshair at any FOV.
import * as THREE from 'three';
import { buildGun, buildGrenade, gunMats } from './gunmodels.js';
import { camo } from './textures.js';
import { WEAPONS } from './weapons.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
// piecewise keyframes: k = [[t, value], ...] (value number or [x,y,z]); smooth interpolation
function kf(t, k) {
  if (t <= k[0][0]) return k[0][1];
  for (let i = 1; i < k.length; i++) {
    if (t <= k[i][0]) {
      const a = k[i - 1], b = k[i], u = smooth((t - a[0]) / (b[0] - a[0]));
      if (typeof a[1] === 'number') return lerp(a[1], b[1], u);
      return [lerp(a[1][0], b[1][0], u), lerp(a[1][1], b[1][1], u), lerp(a[1][2], b[1][2], u)];
    }
  }
  return k[k.length - 1][1];
}

// per-weapon hip offset (camera space) and eye distance behind the sight point when aiming
const POSE = {
  vk12: { hip: [0.16, -0.2, -0.42], eye: 0.36, roll: 0.03 },
  r4: { hip: [0.16, -0.19, -0.42], eye: 0.26, roll: 0.03 },
  wasp: { hip: [0.15, -0.18, -0.4], eye: 0.26, roll: 0.03 },
  longbolt: { hip: [0.16, -0.2, -0.42], eye: 0.12, roll: 0.03 },
  breacher: { hip: [0.16, -0.19, -0.42], eye: 0.36, roll: 0.03 },
  talon: { hip: [0.13, -0.15, -0.42], eye: 0.42, roll: 0.0 },
  knife: { hip: [0.16, -0.13, -0.36], eye: 0.3, roll: 0.0 },
  nade: { hip: [0.13, -0.15, -0.36], eye: 0.3, roll: 0.0 },
};

// ------------------------------------------------------------------------------------------------ hands
function buildHand(mats, left) {
  const s = left ? -1 : 1;
  const hand = new THREE.Group();
  const palm = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.028, 0.085), mats.glove);
  palm.position.set(0, 0, 0.0); hand.add(palm);
  const knuck = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.012, 0.03), mats.pad);
  knuck.position.set(0, 0.018, -0.02); hand.add(knuck);
  const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.034, 0.05, 10).rotateX(Math.PI / 2), mats.glove);
  cuff.position.set(0, -0.002, 0.065); cuff.scale.set(1.05, 0.75, 1); hand.add(cuff);
  const fingers = [];
  // four fingers along -z from the knuckles, each with three joints (x: bend down)
  for (let i = 0; i < 4; i++) {
    const len = [0.042, 0.047, 0.045, 0.036][i];
    const base = new THREE.Group(); base.position.set(s * (-0.028 + i * 0.019), 0, -0.042); hand.add(base);
    let parent = base;
    const segs = [];
    for (let k = 0; k < 3; k++) {
      const L = len * [0.45, 0.32, 0.26][k];
      const seg = new THREE.Mesh(new THREE.CapsuleGeometry(0.0085 - k * 0.0008, L, 3, 8).rotateX(Math.PI / 2).translate(0, 0, -L / 2), mats.glove);
      parent.add(seg);
      const joint = new THREE.Group(); joint.position.set(0, 0, -L); seg.add(joint);
      segs.push(seg); parent = joint;
    }
    fingers.push(segs);
  }
  // thumb: from the side of the palm, angled inward
  const tb = new THREE.Group(); tb.position.set(s * -0.04, -0.005, -0.005); tb.rotation.set(0, s * 0.9, s * -0.4); hand.add(tb);
  const t1 = new THREE.Mesh(new THREE.CapsuleGeometry(0.0105, 0.026, 3, 8).rotateX(Math.PI / 2).translate(0, 0, -0.013), mats.glove); tb.add(t1);
  const tj = new THREE.Group(); tj.position.set(0, 0, -0.026); t1.add(tj);
  const t2 = new THREE.Mesh(new THREE.CapsuleGeometry(0.0095, 0.022, 3, 8).rotateX(Math.PI / 2).translate(0, 0, -0.011), mats.glove); tj.add(t2);
  hand.userData = { fingers, thumb: [t1, t2], tb };
  return hand;
}
// curl: 0 open .. 1 fist per finger (index separate so it can sit on the trigger)
function curlHand(hand, grip, index = grip, thumb = 0.5) {
  const { fingers, thumb: th } = hand.userData;
  fingers.forEach((segs, i) => {
    const c = i === 0 ? index : grip;
    segs[0].rotation.x = -c * 1.25; segs[1].rotation.x = -c * 1.45; segs[2].rotation.x = -c * 1.0;
  });
  th[0].rotation.x = -thumb * 0.5; th[1].rotation.x = -thumb * 0.9;
}
function limb(mat, r0, r1) {
  const g = new THREE.CylinderGeometry(r1, r0, 1, 10, 1, false);
  g.translate(0, 0.5, 0);
  const m = new THREE.Mesh(g, mat);
  return m;
}
const _up = V(0, 1, 0), _q = new THREE.Quaternion();
function placeLimb(m, a, b) {
  const d = b.clone().sub(a), L = d.length();
  m.position.copy(a);
  m.quaternion.setFromUnitVectors(_up, d.divideScalar(L || 1));
  m.scale.set(1, L, 1);
}
// hand orientation from a finger direction (local -z) and the palm's facing (local -y), in the parent frame
function handFrame(finger, palm) {
  const z = finger.clone().normalize().negate();
  const y = palm.clone().negate();
  y.addScaledVector(z, -y.dot(z)).normalize();
  const x = new THREE.Vector3().crossVectors(y, z);
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
}
// 2-bone IK: shoulder S, target T, lengths a (upper) b (fore), pole direction -> elbow position
function ik(S, T, a, b, pole) {
  const d = T.clone().sub(S); let L = d.length();
  L = clamp(L, Math.abs(a - b) + 1e-3, a + b - 1e-3);
  d.normalize();
  const x = (a * a - b * b + L * L) / (2 * L), h = Math.sqrt(Math.max(0, a * a - x * x));
  const p = pole.clone().sub(d.clone().multiplyScalar(pole.dot(d))).normalize();
  return S.clone().add(d.multiplyScalar(x)).add(p.multiplyScalar(h));
}

// ------------------------------------------------------------------------------------------------ viewmodel
export class ViewModel {
  constructor(R) {
    this.R = R;
    const M = gunMats();
    this.mats = {
      glove: new THREE.MeshStandardMaterial({ color: 0x2a2b2e, roughness: 0.75, metalness: 0.05 }),
      pad: new THREE.MeshStandardMaterial({ color: 0x3b3d40, roughness: 0.6, metalness: 0.1 }),
      sleeve: new THREE.MeshStandardMaterial({ color: 0x777777, roughness: 0.85 }),
      watch: M.polymer,
    };
    this.root = new THREE.Group();
    R.vmScene.add(this.root);
    this.gunHolder = new THREE.Group(); this.root.add(this.gunHolder);
    this.handR = buildHand(this.mats, false); this.handL = buildHand(this.mats, true);
    this.root.add(this.handR, this.handL);
    this.foreR = limb(this.mats.sleeve, 0.036, 0.046); this.foreL = limb(this.mats.sleeve, 0.036, 0.046);
    this.upR = limb(this.mats.sleeve, 0.048, 0.056); this.upL = limb(this.mats.sleeve, 0.048, 0.056);
    this.root.add(this.foreR, this.foreL, this.upR, this.upL);
    // watch on the left wrist
    const watch = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.012, 12), M.polymer);
    watch.rotation.z = Math.PI / 2; this.watch = watch; this.root.add(watch);
    this.guns = {};
    this.nades = { frag: buildGrenade('frag'), flash: buildGrenade('flash'), smoke: buildGrenade('smoke') };
    for (const k in this.nades) { this.nades[k].visible = false; this.root.add(this.nades[k]); this.nades[k].scale.setScalar(1); }
    this.spareMag = null;
    this.cur = null; this.curId = null;
    // animation state
    this.t = 0; this.bob = 0; this.sway = V(); this.swayV = V(); this.kick = 0; this.kickV = 0; this.kickRot = V(); this.roll = 0;
    this.draw = 1; this.action = null; this.actT = 0; this.actLen = 1; this.land = 0; this.ads = 0;
    this.flash = null; this.flashT = 0;
    this.muzzleWorld = V(); this.ejectWorld = V();
    this._buildFlash();
    this.setTeam(0);
  }
  setTeam(team) {
    const pal = team === 0 ? ['#3b4a5c', '#56687e', '#2a3441', '#7a8a9a'] : ['#6e5f44', '#8a7652', '#4a3f2d', '#a39271'];
    this._camo = this._camo || {};
    const c = this._camo[team] || (this._camo[team] = camo(pal, team ? 21 : 11, 7));
    this.mats.sleeve.map = c.map; this.mats.sleeve.normalMap = c.normal; this.mats.sleeve.color.set(0xffffff); this.mats.sleeve.needsUpdate = true;
    this.mats.glove.color.set(team === 0 ? 0x25272b : 0x3a3326);
  }
  _buildFlash() {
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const x = c.getContext('2d');
    const g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, 'rgba(255,250,220,1)'); g.addColorStop(0.2, 'rgba(255,200,90,0.9)'); g.addColorStop(0.5, 'rgba(255,120,30,0.35)'); g.addColorStop(1, 'rgba(255,80,0,0)');
    x.fillStyle = g; x.fillRect(0, 0, 128, 128);
    x.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 6; i++) { x.save(); x.translate(64, 64); x.rotate(i * Math.PI / 3 + 0.3); x.fillStyle = 'rgba(255,200,120,0.5)'; x.beginPath(); x.moveTo(0, -4); x.lineTo(62, 0); x.lineTo(0, 4); x.fill(); x.restore(); }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.MeshBasicMaterial({ map: t, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, color: new THREE.Color(3, 2.6, 2) });
    const f = new THREE.Group();
    const a = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.16), mat); f.add(a);
    const b = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.1), mat); b.rotation.y = Math.PI / 2; b.position.z = -0.12; f.add(b);
    const cc = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.1), mat); cc.rotation.set(Math.PI / 2, Math.PI / 2, 0); cc.position.z = -0.12; f.add(cc);
    f.visible = false;
    this.flash = f;
    this.flashLight = new THREE.PointLight(0xffb060, 0, 1.6, 2);
    this.R.vmScene.add(this.flashLight);
  }
  equip(id) {
    if (this.cur) this.cur.group.visible = false;
    for (const k in this.nades) this.nades[k].visible = false;
    this.curId = id;
    if (id === 'frag' || id === 'flash' || id === 'smoke') { this.cur = null; this.nadeKind = id; this.nades[id].visible = true; }
    else {
      if (!this.guns[id]) {
        const g = buildGun(id, 'hi');
        g.group.traverse((o) => { if (o.isMesh) { o.frustumCulled = false; } });
        this.gunHolder.add(g.group);
        g.magHome = g.parts.mag ? g.parts.mag.position.clone() : null;
        g.boltHome = g.parts.bolt ? g.parts.bolt.position.clone() : null;
        g.slideHome = g.parts.slide ? g.parts.slide.position.clone() : null;
        g.pumpHome = g.parts.pump ? g.parts.pump.position.clone() : null;
        this.guns[id] = g;
      }
      this.cur = this.guns[id]; this.cur.group.visible = true; this.nadeKind = null;
      if (this.flash.parent) this.flash.parent.remove(this.flash);
      this.cur.group.add(this.flash); this.flash.position.copy(this.cur.pts.muzzle);
    }
    this.draw = 0; this.action = null;
  }
  // actions: 'reload', 'reloadEmpty', 'inspect', 'slash', 'stab', 'bolt', 'pump', 'shell', 'throw', 'pin'
  play(action, len) { this.action = action; this.actT = 0; this.actLen = len; }
  fire(def) {
    const k = def.kick || 1;
    this.kickV += 0.9 * k; this.kickRot.x += 0.035 * k * (0.8 + Math.random() * 0.4); this.kickRot.y += (Math.random() - 0.5) * 0.02 * k; this.kickRot.z += (Math.random() - 0.5) * 0.04 * k;
    if (def.kind !== 'knife') { this.flashT = 0.045; this.flash.rotation.z = Math.random() * 6.28; this.flash.scale.setScalar(0.8 + Math.random() * 0.5); }
    if (this.cur && this.cur.parts.slide) this.slideT = 0.08;
    if (this.cur && this.cur.parts.bolt && def.auto) this.boltT = 0.06;
  }
  landed(v) { this.land = Math.min(0.06, v * 0.008); }

  update(dt, s) {
    // s: { ads, speed, onGround, crouch, lookDX, lookDY, t, hidden, scoped }
    this.t += dt;
    const id = this.curId || 'knife';
    const pose = POSE[this.nadeKind ? 'nade' : id] || POSE.r4;
    this.ads = s.ads;
    const ads = smooth(s.ads);
    this.root.visible = !s.hidden;
    // draw / holster
    this.draw = Math.min(1, this.draw + dt / 0.38);
    const dr = 1 - smooth(this.draw);
    // springs: sway follows mouse, kick recovers
    const sk = 1 - ads * 0.75;
    this.swayV.x += (-s.lookDX * 0.0009 * sk - this.sway.x) * 60 * dt; this.swayV.y += (s.lookDY * 0.0009 * sk - this.sway.y) * 60 * dt;
    this.swayV.multiplyScalar(Math.exp(-14 * dt)); this.sway.addScaledVector(this.swayV, dt * 10);
    this.sway.x = clamp(this.sway.x, -0.05, 0.05); this.sway.y = clamp(this.sway.y, -0.05, 0.05);
    this.kickV -= this.kick * 380 * dt; this.kickV *= Math.exp(-22 * dt); this.kick += this.kickV * dt;
    this.kickRot.multiplyScalar(Math.exp(-11 * dt));
    this.land *= Math.exp(-7 * dt);
    const moving = s.onGround ? clamp(s.speed / 5, 0, 1) : 0;
    this.bob += dt * (6 + s.speed * 1.4) * (moving > 0.05 ? 1 : 0.3);
    const bobA = moving * (1 - ads * 0.85);
    const breath = Math.sin(this.t * 1.6) * 0.0025 * (1 - ads * 0.6);
    // base pose: hip -> ads
    const hip = V(...pose.hip);
    let pos = hip.clone(), rot = V(id === 'knife' ? 0.35 : 0, id === 'knife' ? 0.25 : -0.03, id === 'knife' ? 0.5 : pose.roll);
    if (this.cur) {
      const S = this.cur.pts.sight;
      const adsPos = V(-S.x, -S.y, -S.z - pose.eye);
      pos.lerp(adsPos, ads); rot.multiplyScalar(1 - ads);
    }
    pos.x += Math.sin(this.bob) * 0.012 * bobA + this.sway.x;
    pos.y += -Math.abs(Math.cos(this.bob)) * 0.011 * bobA + breath - this.land + this.sway.y + (s.crouch ? -0.008 * (1 - ads) : 0);
    pos.z += this.kick * 0.05;
    rot.x += this.kickRot.x * (1 - ads * 0.5) + this.sway.y * 1.5 + Math.cos(this.bob * 2) * 0.006 * bobA;
    rot.y += this.kickRot.y - this.sway.x * 1.8;
    rot.z += this.kickRot.z + Math.sin(this.bob) * 0.012 * bobA - this.sway.x * 1.2;
    // draw animation
    pos.y -= dr * 0.25; rot.x -= dr * 0.9; rot.z += dr * 0.3;
    // actions
    let hideL = false, leftFree = null, magOff = null, magVisible = true, spare = null;
    const a = this.action;
    if (a) {
      this.actT += dt;
      const u = this.actT / this.actLen;
      if (u >= 1) this.action = null;
      else {
        const g = this.cur;
        if (a === 'reload' || a === 'reloadEmpty') {
          const tilt = kf(u, [[0, 0], [0.12, 1], [0.8, 1], [1, 0]]);
          rot.z += tilt * 0.55; rot.x += tilt * 0.12; pos.y -= tilt * 0.03; pos.x -= tilt * 0.02;
          if (g && g.parts.mag) {
            // mag drops out, hand fetches a new one and seats it
            const drop = kf(u, [[0.1, 0], [0.22, 1]]);
            const back = kf(u, [[0.38, 0], [0.56, 1]]);
            if (u < 0.3) magOff = [0, -0.2 * drop, 0.03 * drop];
            else if (u < 0.56) { magOff = [0, -0.25 + 0.2 * back, 0.06 - 0.06 * back]; }
            else magOff = [0, -0.05 * (1 - kf(u, [[0.56, 0], [0.64, 1]])), 0];
            magVisible = !(u > 0.24 && u < 0.36);
            const mh = g.magHome;
            if (u < 0.1) leftFree = kf(u, [[0, 0], [0.1, 1]]) > 0.5 ? [mh.x, mh.y - 0.06, mh.z] : null;
            else if (u < 0.36) leftFree = [mh.x - 0.02, mh.y - 0.05 - 0.28 * kf(u, [[0.22, 0], [0.36, 1]]), mh.z + 0.02];
            else if (u < 0.66) leftFree = [mh.x - 0.01, mh.y - 0.07 + (magOff ? magOff[1] : 0), mh.z + (magOff ? magOff[2] : 0)];
            else if (a === 'reloadEmpty' && u < 0.86 && g.boltHome) { const b = g.boltHome; leftFree = [b.x + 0.03, b.y, b.z + 0.02]; }
            if (a === 'reloadEmpty' && g.parts.bolt && u > 0.72 && u < 0.84) this.boltPull = kf(u, [[0.72, 0], [0.77, 1], [0.84, 0]]);
            else this.boltPull = 0;
          }
        } else if (a === 'shell') {
          // shotgun: one shell per cycle into the loading port
          rot.z -= 0.35; rot.x += 0.12; pos.x -= 0.02;
          const up = kf(u, [[0, 0], [0.55, 1], [0.8, 1], [1, 0]]);
          if (g) { const p = g.pts.eject; leftFree = [p.x - 0.01, p.y - 0.08 + up * 0.05, p.z + 0.03]; }
          spare = 'shell';
        } else if (a === 'bolt') {
          const b = kf(u, [[0, 0], [0.2, 1], [0.45, 1.6], [0.7, 1], [1, 0]]);
          rot.z += 0.2 * Math.min(1, b); pos.y -= 0.01 * b;
          this.boltPull = kf(u, [[0.15, 0], [0.4, 1], [0.6, 1], [0.8, 0]]);
          if (g && g.boltHome) { const bh = g.boltHome; leftFree = [bh.x + 0.05, bh.y - 0.02, bh.z + 0.05 * this.boltPull]; }
        } else if (a === 'pump') {
          const p = kf(u, [[0, 0], [0.35, 1], [0.7, 0]]);
          this.pumpPull = p; rot.x += 0.05 * p;
        } else if (a === 'inspect') {
          const r1 = kf(u, [[0, 0], [0.18, 1], [0.45, 1], [0.6, 0.2], [0.8, 0.2], [1, 0]]);
          const r2 = kf(u, [[0.45, 0], [0.6, 1], [0.8, 1], [1, 0]]);
          rot.y += r1 * 0.9; rot.z += r1 * 0.55; rot.x += r2 * 0.6; pos.x -= r1 * 0.05; pos.y += r1 * 0.03 + r2 * 0.02; pos.z += r1 * 0.04;
        } else if (a === 'slash') {
          const w = kf(u, [[0, 0], [0.25, 1], [0.55, -1], [1, 0]]);
          rot.y += w * 0.9; rot.z += -w * 0.6 + 0.3; pos.x -= w * 0.12; pos.y += Math.abs(w) * 0.03;
        } else if (a === 'stab') {
          const w = kf(u, [[0, 0], [0.3, -0.6], [0.5, 1], [0.8, 1], [1, 0]]);
          pos.z -= w * 0.18; pos.x -= w * 0.06; pos.y += w * 0.04; rot.x -= w * 0.4;
        } else if (a === 'throw') {
          const w = kf(u, [[0, 0], [0.4, -1], [0.6, 1], [1, 0.6]]);
          pos.y += w * 0.08 + (w < 0 ? -w * 0.05 : 0); pos.z += -w * 0.1; rot.x += -w * 0.8; pos.x -= w * 0.03;
          if (u > 0.55) for (const k in this.nades) this.nades[k].visible = false;
        } else if (a === 'pin') {
          const w = kf(u, [[0, 0], [0.5, 1], [1, 1]]);
          pos.y += w * 0.02; rot.z += w * 0.2;
        } else if (a === 'switch') {
          const w = kf(u, [[0, 0], [1, 1]]);
          pos.y -= w * 0.25; rot.x -= w * 0.9;
        }
      }
    }
    if (!this.action) { this.boltPull = 0; this.pumpPull = 0; }
    this.gunHolder.position.copy(pos);
    this.gunHolder.rotation.set(rot.x, rot.y, rot.z, 'YXZ');
    // animate parts
    const g = this.cur;
    if (g) {
      if (g.parts.mag) { g.parts.mag.position.copy(g.magHome); if (magOff) g.parts.mag.position.add(V(...magOff)); g.parts.mag.visible = magVisible; }
      this.slideT = Math.max(0, (this.slideT || 0) - dt);
      if (g.parts.slide) g.parts.slide.position.z = g.slideHome.z + (this.slideT > 0 ? 0.035 : 0) + (s.empty ? 0.035 : 0);
      this.boltT = Math.max(0, (this.boltT || 0) - dt);
      if (g.parts.bolt) g.parts.bolt.position.z = g.boltHome.z + (this.boltT > 0 ? 0.04 : 0) + (this.boltPull || 0) * 0.06;
      if (g.parts.pump) g.parts.pump.position.z = g.pumpHome.z + (this.pumpPull || 0) * 0.09;
    }
    this.gunHolder.updateMatrixWorld(true);
    // hand targets in camera space. Hands are posed by frames in gun space: which way the fingers point
    // and which way the palm faces, so the grip hand wraps the pistol grip and the support hand cups the guard.
    const mw = this.gunHolder.matrixWorld;
    const toCam = (p) => V(p[0], p[1], p[2]).applyMatrix4(mw);
    let rHand, lHand, rQuat = new THREE.Quaternion(), lQuat = new THREE.Quaternion();
    const gq = new THREE.Quaternion().setFromRotationMatrix(mw);
    if (g) {
      const gp = g.pts.grip, fp = g.pts.fore;
      const pistol = id === 'talon', knife = id === 'knife';
      // grip hand: palm on the right of the grip facing left, fingers forward/down round the front
      rHand = toCam([gp.x + 0.032, gp.y - 0.005, gp.z + 0.012]);
      rQuat.copy(gq).multiply(handFrame(V(-0.25, -0.35, -0.9), V(-1, 0, 0)));
      curlHand(this.handR, knife ? 0.95 : 0.92, knife ? 0.95 : 0.3, 0.7);
      if (knife) { hideL = true; }
      else if (pistol) {
        // support hand wraps the grip hand from the left
        lHand = leftFree ? toCam(leftFree) : toCam([gp.x - 0.034, gp.y - 0.02, gp.z + 0.008]);
        lQuat.copy(gq).multiply(handFrame(V(0.35, -0.3, -0.85), V(1, 0, 0)));
        curlHand(this.handL, 0.85, 0.85, 0.3);
      } else if (leftFree) {
        lHand = toCam(leftFree);
        lQuat.copy(gq).multiply(handFrame(V(0.3, 0.2, -0.9), V(0.6, 0.8, 0)));
        curlHand(this.handL, 0.65, 0.6, 0.6);
      } else {
        // support hand under the handguard, palm up, fingers curling round the far side
        lHand = toCam([fp.x - 0.012, fp.y - 0.048, fp.z + 0.01]);
        lQuat.copy(gq).multiply(handFrame(V(0.75, 0.15, -0.64), V(0.15, 1, 0)));
        curlHand(this.handL, 0.78, 0.7, 0.6);
      }
    } else {
      // grenade in the right hand; left hand pulls the pin then drops away
      rHand = pos.clone().add(V(0.02, -0.03, 0.03));
      rQuat.setFromEuler(new THREE.Euler(rot.x, rot.y, rot.z, 'YXZ')).multiply(handFrame(V(-0.3, 0.2, -0.93), V(-1, 0.2, 0)));
      curlHand(this.handR, 0.7, 0.7, 0.7);
      const n = this.nades[this.nadeKind];
      if (n) { n.position.copy(pos).add(V(-0.01, 0.0, -0.02)); n.rotation.set(rot.x, rot.y, rot.z); }
      if (this.action === 'pin') { lHand = pos.clone().add(V(-0.07, 0.04, 0.0)); lQuat.setFromEuler(new THREE.Euler(rot.x, rot.y, rot.z, 'YXZ')).multiply(handFrame(V(0.8, 0.3, -0.5), V(0.3, -1, 0))); curlHand(this.handL, 0.6, 0.8, 0.8); }
      else hideL = true;
    }
    this.handR.position.copy(rHand); this.handR.quaternion.copy(rQuat);
    this.handL.visible = !hideL && !!lHand;
    if (lHand) { this.handL.position.copy(lHand); this.handL.quaternion.copy(lQuat); }
    // arms by IK from off-screen shoulders to the wrists
    const wristR = V(0, 0, 0.07).applyQuaternion(rQuat).add(rHand);
    const shR = V(0.24, -0.3, 0.16), shL = V(-0.24, -0.32, 0.12);
    const elR = ik(shR, wristR, 0.3, 0.27, V(0.7, -1, 0.2));
    placeLimb(this.foreR, wristR, elR); placeLimb(this.upR, elR, shR);
    this.foreL.visible = this.upL.visible = this.watch.visible = this.handL.visible;
    if (this.handL.visible) {
      const wristL = V(0, 0, 0.07).applyQuaternion(lQuat).add(lHand);
      const elL = ik(shL, wristL, 0.3, 0.27, V(-0.8, -1, 0.1));
      placeLimb(this.foreL, wristL, elL); placeLimb(this.upL, elL, shL);
      this.watch.position.copy(V(0, 0.01, 0.1).applyQuaternion(lQuat).add(lHand));
      this.watch.quaternion.copy(lQuat).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, Math.PI / 2)));
    }
    // muzzle flash
    this.flashT -= dt;
    this.flash.visible = this.flashT > 0 && !!g;
    this.flashLight.intensity = this.flashT > 0 ? 2.5 : 0;
    if (g) {
      this.flashLight.position.copy(toCam([g.pts.muzzle.x, g.pts.muzzle.y + 0.03, g.pts.muzzle.z + 0.05]));
      this.muzzleWorld.copy(toCam([g.pts.muzzle.x, g.pts.muzzle.y, g.pts.muzzle.z]));
      this.ejectWorld.copy(toCam([g.pts.eject.x, g.pts.eject.y, g.pts.eject.z]));
    } else this.muzzleWorld.copy(pos);
  }
}
