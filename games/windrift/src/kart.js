// Kart models: an extruded body profile plus pods, wings, fins, canopy, exhausts, wheels and a driver, all
// shaped by the kart's `shape` data. KartView syncs a model to the simulated kart each frame (interpolated),
// with body roll in drifts, wheel spin/steer, exhaust flames by boost type, and shield / bubble / turtle states.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries, toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';
import { KARTS } from './data.js';
import { GLOW } from './themes.js';
import { textTex, softTex, FONT_ZH, FONT_EN } from './gfx.js';
import { angDiff } from './physics.js';
import { buildDriver } from './driver.js';

const shared = {};
function mats() {
  if (shared.carbon) return shared;
  shared.carbon = new THREE.MeshStandardMaterial({ color: 0x1b1d24, roughness: 0.45, metalness: 0.4 });
  shared.chrome = new THREE.MeshStandardMaterial({ color: 0xc8ccd4, roughness: 0.24, metalness: 1 });
  shared.rubber = new THREE.MeshStandardMaterial({ color: 0x15151a, roughness: 0.9 });
  shared.rim = new THREE.MeshStandardMaterial({ color: 0xc9ced8, roughness: 0.25, metalness: 0.9 });
  shared.glass = new THREE.MeshPhysicalMaterial({ color: 0x9fd8ff, roughness: 0.05, metalness: 0, transmission: 0, transparent: true, opacity: 0.45, clearcoat: 1 });
  shared.flameGeo = new THREE.ConeGeometry(0.2, 1, 12, 1, true).rotateX(-Math.PI / 2).translate(0, 0, -0.5);
  shared.wheel = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.35 });
  shared.blob = new THREE.MeshBasicMaterial({ map: softTex(), color: 0x000000, transparent: true, opacity: 0.55, depthWrite: false });
  shared.plane = new THREE.PlaneGeometry(1, 1);
  return shared;
}

const FlameShader = {
  uniforms: { uColor: { value: new THREE.Color(0x4cc9ff) }, uCore: { value: new THREE.Color(0xffffff) }, uTime: { value: 0 }, uAmt: { value: 0 }, uGain: { value: GLOW.flame } },
  vertexShader: 'varying vec2 vUv; varying float vZ; void main(){ vUv = uv; vZ = -position.z; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `uniform vec3 uColor, uCore; uniform float uTime, uAmt, uGain; varying vec2 vUv; varying float vZ;
    void main(){ float t = clamp(vZ, 0.0, 1.0); float flick = 0.75 + 0.25 * sin(uTime * 60.0 + vUv.x * 12.0);
      // tinted core (never pure white) that fades in just past the nozzle, so an end-on view is a soft glow, not a disc
      vec3 c = mix(mix(uColor, uCore, 0.55), uColor, smoothstep(0.05, 0.5, t));
      float a = smoothstep(0.0, 0.14, t) * (1.0 - t) * flick * uAmt;
      gl_FragColor = vec4(c * uGain * a, a); }`
};

// side profile of the body (z forward, y up), extruded across the width
function bodyGeo(s) {
  const L = s.len, nose = s.nose;
  const sh = new THREE.Shape();
  const r = -L / 2, f = L / 2;
  sh.moveTo(r, 0.32);
  sh.lineTo(r, 0.78);
  sh.quadraticCurveTo(r + 0.15, 0.95, r + 0.55, 0.92);
  sh.lineTo(-0.35, 0.86);
  sh.quadraticCurveTo(-0.15, 0.62, 0.25, 0.64); // cockpit dip
  sh.quadraticCurveTo(0.55, 0.66, 0.75, 0.86);
  sh.quadraticCurveTo(0.95 + nose * 0.3, 0.9, f - 0.25, 0.58 - nose * 0.08);
  sh.quadraticCurveTo(f + 0.05, 0.5, f, 0.36);
  sh.lineTo(r, 0.32);
  const w = s.wid * 0.6;
  const g = new THREE.ExtrudeGeometry(sh, { depth: w, bevelEnabled: true, bevelThickness: 0.14, bevelSize: 0.12, bevelSegments: 3, curveSegments: 10 });
  g.translate(0, 0, -w / 2);
  g.rotateY(-Math.PI / 2); // shape x → kart z (forward)
  // extrusions come with flat per-segment normals, which reflect as stepped bands on the paint: smooth them across
  // the gentle curve segments, keep the bevel and cap edges crisp
  return toCreasedNormals(g, 0.45);
}

// merged, vertex-coloured wheel geometry (tyre + rim + spoke), cached per size
const wheelCache = new Map();
function wheelGeo(r, w) {
  const key = r.toFixed(3) + ':' + w;
  if (wheelCache.has(key)) return wheelCache.get(key);
  const col = (g, c) => { g = g.index ? g.toNonIndexed() : g; const cc = new THREE.Color(c), n = g.attributes.position.count, a = new Float32Array(n * 3); for (let i = 0; i < n; i++) a.set([cc.r, cc.g, cc.b], i * 3); g.setAttribute('color', new THREE.BufferAttribute(a, 3)); return g; };
  const tire = new THREE.CylinderGeometry(r, r, w, 22).rotateZ(Math.PI / 2);
  const rim = new THREE.CylinderGeometry(r * 0.58, r * 0.58, w + 0.02, 14).rotateZ(Math.PI / 2);
  const spoke = new THREE.BoxGeometry(w + 0.04, r * 1.05, 0.09);
  const g = mergeGeometries([col(tire, 0x16161b), col(rim, 0xc9ced8), col(spoke, 0x2a2c34)]);
  g.userData.shared = true;
  wheelCache.set(key, g);
  return g;
}

export function buildKartModel(kartIdx, paintHex, o = {}) {
  const M = mats(), K = KARTS[kartIdx], s = K.shape;
  // dielectric paint under a clear coat: a metallic base tinted and multiplied the moon glint into a bloom blob
  const paint = new THREE.MeshPhysicalMaterial({ color: paintHex, metalness: 0.1, roughness: 0.42, clearcoat: 1, clearcoatRoughness: 0.2 });
  const accent = new THREE.MeshPhysicalMaterial({ color: new THREE.Color(paintHex).offsetHSL(0.5, 0, 0).getHex(), metalness: 0.4, roughness: 0.3, clearcoat: 1 });
  const root = new THREE.Group();   // position + yaw
  const body = new THREE.Group();   // roll/pitch/bounce
  root.add(body);
  // parts are collected per (parent, material) and merged, so a kart is ~15 draw calls instead of ~45
  const buckets = new Map();
  const tmpM = new THREE.Matrix4(), tmpE = new THREE.Euler();
  const add = (g, m, x = 0, y = 0, z = 0, parent = body, rot) => {
    g = g.index ? g.toNonIndexed() : g.clone();
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    if (g.attributes.color && m !== lightsMat) g.deleteAttribute('color');
    if (rot) { tmpE.set(rot[0] || 0, rot[1] || 0, rot[2] || 0); g.applyMatrix4(tmpM.makeRotationFromEuler(tmpE)); }
    g.translate(x, y, z);
    const key = parent.uuid + m.uuid;
    if (!buckets.has(key)) buckets.set(key, { parent, m, geos: [] });
    buckets.get(key).geos.push(g);
  };
  const lightsMat = new THREE.MeshBasicMaterial({ vertexColors: true, color: new THREE.Color(1, 1, 1).multiplyScalar(GLOW.headlight) });
  const lightGeo = (g, c) => { g = g.index ? g.toNonIndexed() : g; const cc = new THREE.Color(c), n = g.attributes.position.count, a = new Float32Array(n * 3); for (let i = 0; i < n; i++) a.set([cc.r, cc.g, cc.b], i * 3); g.setAttribute('color', new THREE.BufferAttribute(a, 3)); return g; };

  add(new RoundedBoxGeometry(s.wid * 0.92, 0.22, s.len * 0.94, 3, 0.08), M.carbon, 0, 0.3, 0);
  add(bodyGeo(s), paint);
  if (s.pods) for (const x of [1, -1]) {
    add(new RoundedBoxGeometry(0.42, 0.42, s.len * 0.42, 3, 0.16), s.pods === 2 ? accent : paint, x * s.wid * 0.43, 0.52, -0.1);
    add(new RoundedBoxGeometry(0.2, 0.14, s.len * 0.3, 2, 0.05), M.carbon, x * s.wid * 0.43, 0.76, -0.1);
  }
  add(new RoundedBoxGeometry(s.wid * 1.05, 0.08, 0.5, 2, 0.03), accent, 0, 0.32, s.len / 2 - 0.05);
  for (const x of [1, -1]) add(new THREE.BoxGeometry(0.06, 0.28, 0.55), accent, x * s.wid * 0.52, 0.42, s.len / 2 - 0.05);
  const rz = -s.len / 2 + 0.1;
  if (s.wing === 'low') add(new RoundedBoxGeometry(s.wid * 0.95, 0.1, 0.55, 2, 0.04), accent, 0, 1.0, rz);
  else if (s.wing === 'high' || s.wing === 'blade') {
    for (const x of [0.35, -0.35]) add(new THREE.BoxGeometry(0.07, 0.6, 0.25), M.carbon, x * s.wid, 1.1, rz + 0.05);
    add(new RoundedBoxGeometry(s.wid * (s.wing === 'blade' ? 1.25 : 1.05), 0.1, s.wing === 'blade' ? 0.45 : 0.7, 2, 0.04), accent, 0, 1.42, rz);
    for (const x of [1, -1]) add(new THREE.BoxGeometry(0.06, 0.4, 0.75), paint, x * s.wid * (s.wing === 'blade' ? 0.62 : 0.52), 1.42, rz);
  } else if (s.wing === 'split') {
    for (const x of [1, -1]) add(new RoundedBoxGeometry(s.wid * 0.45, 0.08, 0.6, 2, 0.03), accent, x * s.wid * 0.3, 1.15, rz, body, [0, 0, x * 0.25]);
  } else if (s.wing === 'twin') {
    add(new RoundedBoxGeometry(s.wid, 0.08, 0.5, 2, 0.03), accent, 0, 1.05, rz);
    add(new RoundedBoxGeometry(s.wid * 0.9, 0.08, 0.45, 2, 0.03), accent, 0, 1.4, rz - 0.1);
    for (const x of [1, -1]) add(new THREE.BoxGeometry(0.06, 0.5, 0.6), M.carbon, x * s.wid * 0.46, 1.22, rz - 0.05);
  }
  if (s.fins) for (let k = 0; k < s.fins; k++) add(new THREE.BoxGeometry(0.06, 0.45, 0.8), accent, s.fins === 1 ? 0 : (k ? 0.3 : -0.3), 1.05, -s.len * 0.25, body, [-0.2, 0, 0]);
  if (s.armor) for (const z of [s.len / 2 + 0.12, -s.len / 2 - 0.1]) add(new RoundedBoxGeometry(s.wid * 1.02, 0.35, 0.3, 2, 0.1), M.chrome, 0, 0.45, z);
  if (s.tanks) { if (!shared.tank) shared.tank = new THREE.MeshStandardMaterial({ color: 0x29d3ff, emissive: 0x1a8fff, emissiveIntensity: GLOW.tank, metalness: 0.5, roughness: 0.2 }); for (const x of [0.28, -0.28]) add(new THREE.CylinderGeometry(0.16, 0.16, 0.9, 12), shared.tank, x, 0.95, -s.len / 2 + 0.55, body, [Math.PI / 2, 0, 0]); }
  if (s.canopy) add(new THREE.SphereGeometry(0.62, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.8, 1.35), M.glass, 0, 0.72, 0.05);
  for (const x of [1, -1]) {
    add(lightGeo(new THREE.SphereGeometry(0.1, 10, 8), 0xffe6b8), lightsMat, x * s.wid * 0.3, 0.55, s.len / 2 - 0.05);
    add(lightGeo(new THREE.BoxGeometry(0.26, 0.1, 0.05), new THREE.Color(0xff2030).multiplyScalar(GLOW.taillight / GLOW.headlight)), lightsMat, x * s.wid * 0.33, 0.72, -s.len / 2 - 0.02);
  }
  // exhausts; one merged flame mesh stretched along z by the boost state
  const ex = s.exh === 4 ? [0.42, 0.16, -0.16, -0.42] : [0.28, -0.28];
  const flameParts = [];
  for (const x of ex) {
    add(new THREE.CylinderGeometry(0.1, 0.12, 0.45, 12), M.chrome, x * s.wid * 0.62, 0.55, -s.len / 2 - 0.08, body, [Math.PI / 2, 0, 0]);
    flameParts.push(shared.flameGeo.clone().scale(0.8, 0.8, 1).translate(x * s.wid * 0.62, 0, 0));
  }
  const fm = new THREE.ShaderMaterial({ ...FlameShader, uniforms: THREE.UniformsUtils.clone(FlameShader.uniforms), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  const flame = new THREE.Mesh(mergeGeometries(flameParts), fm);
  flame.position.set(0, 0.55, -s.len / 2 - 0.3); flame.frustumCulled = false; flame.renderOrder = 5;
  body.add(flame);
  // the racer (driver.js): leans as a group, the helmet turns on its own
  const { driver, head } = buildDriver(paintHex, { helmet: o.helmet });
  driver.position.set(0, 0.6, 0.02); body.add(driver);
  for (const { parent, m, geos } of buckets.values()) {
    const mesh = new THREE.Mesh(mergeGeometries(geos), m);
    mesh.castShadow = m !== lightsMat && m !== M.glass; mesh.receiveShadow = false;
    parent.add(mesh);
    geos.forEach((g) => g.dispose());
  }
  // wheels: one vertex-coloured mesh each (they spin and steer)
  const wheels = [];
  const wr = s.wheel, fx = s.wid / 2 + 0.05, fz = s.len / 2 - 0.55, bz = -s.len / 2 + 0.55;
  for (const [x, z, front] of [[fx, fz, 1], [-fx, fz, 1], [fx, bz, 0], [-fx, bz, 0]]) {
    const r = wr * (front ? 0.95 : 1.05);
    const hub = new THREE.Group(); hub.position.set(x, r, z); root.add(hub);
    const spin = new THREE.Mesh(wheelGeo(r, front ? 0.34 : 0.46), M.wheel);
    spin.castShadow = true; hub.add(spin);
    wheels.push({ hub, spin, front, r });
  }
  // underglow (reads well at night) + contact shadow
  const glow = new THREE.Mesh(shared.plane, new THREE.MeshBasicMaterial({ map: softTex(), color: new THREE.Color(paintHex), transparent: true, opacity: o.night ? GLOW.underglow : 0, blending: THREE.AdditiveBlending, depthWrite: false }));
  glow.scale.set(s.wid * 1.9, s.len * 1.35, 1); glow.rotation.x = -Math.PI / 2; glow.position.y = 0.06; glow.renderOrder = 1; root.add(glow);
  const blob = new THREE.Mesh(shared.plane, M.blob);
  blob.scale.set(s.wid * 1.5, s.len * 1.25, 1); blob.rotation.x = -Math.PI / 2; blob.position.y = 0.04; root.add(blob);
  return { root, body, driver, head, wheels, flames: [flame], paint, glow, blob, shape: s };
}

// free a model's GPU resources (shared geometries/materials stay)
export function disposeModel(root) {
  const S = mats();
  const keep = new Set([S.carbon, S.chrome, S.rubber, S.rim, S.glass, S.wheel, S.blob, S.tank, S.flameGeo, S.plane]);
  const shared = (x) => keep.has(x) || (x && x.userData && x.userData.shared);
  root.traverse((c) => {
    if (c.geometry && !shared(c.geometry)) c.geometry.dispose();
    if (c.material && !shared(c.material)) { if (c.material.map && c.material.map !== softTex() && !shared(c.material.map)) c.material.map.dispose(); c.material.dispose(); }
  });
}

export class KartView {
  constructor(k, scene, o = {}) {
    this.k = k;
    const m = buildKartModel(k.kartIdx, k.paint, { night: o.night, helmet: o.helmet });
    Object.assign(this, m);
    this.scene = scene;
    scene.add(this.root);
    this.root.traverse((c) => { c.userData.dynamic = true; });
    this.spinAng = 0; this.roll = 0; this.pitch = 0; this.steer = 0; this.t = 0;
    this.pos = new THREE.Vector3();
    if (o.tag) {
      const tex = textTex([{ text: k.name.zh, font: `700 40px "Noto Sans SC",sans-serif`, color: '#ffffff', y: 36 }, { text: k.name.en, font: `22px ${FONT_EN}`, color: '#9fe8ff', y: 76 }], { w: 256, h: 96, bg: 'rgba(8,14,40,.72)' });
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, fog: false }));
      sp.scale.set(2.6, 0.98, 1); sp.position.y = 2.8; this.root.add(sp); this.tag = sp;
    }
    if (o.ghost) {
      this.root.traverse((c) => {
        if (c.isMesh) { c.castShadow = false; c.material = c.material.clone(); c.material.transparent = true; c.material.opacity = Math.min(c.material.opacity ?? 1, 0.38); c.material.depthWrite = false; }
      });
      this.blob.visible = false;
    }
    // shield / bubble / turtle
    this.shield = new THREE.Mesh(new THREE.SphereGeometry(2.3, 24, 16), new THREE.MeshBasicMaterial({ color: 0xfff0a0, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.shield.position.y = 0.9; this.shield.visible = false; this.root.add(this.shield);
    this.bubble = new THREE.Mesh(new THREE.SphereGeometry(2.4, 24, 16), new THREE.MeshPhysicalMaterial({ color: 0x7fd8ff, transparent: true, opacity: 0.35, roughness: 0, clearcoat: 1 }));
    this.bubble.position.y = 1; this.bubble.visible = false; this.root.add(this.bubble);
    const shell = new THREE.Group();
    const sh = new THREE.Mesh(new THREE.SphereGeometry(0.7, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x3baa5c, roughness: 0.6, flatShading: true }));
    sh.scale.set(1, 0.7, 1.2); shell.add(sh); shell.position.y = 1.9; shell.visible = false; this.root.add(shell); this.shell = shell;
    const horns = new THREE.Group(), hm = new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.15, 0.25).multiplyScalar(GLOW.neon) });
    for (const s of [1, -1]) { const c = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.4, 8), hm); c.position.set(s * 0.2, 0.3, 0); c.rotation.z = -s * 0.35; horns.add(c); }
    horns.visible = false; this.head.add(horns); this.horns = horns;
  }
  setNight(on) { this.glow.material.opacity = on ? GLOW.underglow : 0; }
  // alpha: interpolation factor between the previous and current physics step
  update(dt, alpha, cam) {
    const k = this.k, s = this.shape;
    this.t += dt;
    const x = k.prevX + (k.x - k.prevX) * alpha, y = k.prevY + (k.y - k.prevY) * alpha, z = k.prevZ + (k.z - k.prevZ) * alpha;
    const hNow = k.h + k.spinA;
    const h = k.prevH + angDiff(hNow, k.prevH) * alpha;
    this.pos.set(x, y, z);
    this.root.position.set(x, y + (k.stunKind === 'bubble' && k.stun > 0 ? 1.8 + Math.sin(this.t * 4) * 0.3 : 0), z);
    this.root.rotation.y = h;
    // body dynamics
    const slip = angDiff(k.h, k.vh);
    const targetRoll = (k.drift.on ? -slip * 0.28 : -k.prevSdir * Math.min(1, Math.abs(k.spd) / 30) * 0.06) + (k.stunKind === 'tumble' && k.stun > 0 ? Math.sin(this.t * 14) * 0.6 : 0);
    const accel = (k.spd - (this.lastSpd ?? k.spd)) / Math.max(dt, 1e-3); this.lastSpd = k.spd;
    const targetPitch = Math.max(-0.08, Math.min(0.08, -accel * 0.004)) + (!k.grounded ? Math.max(-0.25, Math.min(0.25, -k.vy * 0.02)) : 0);
    this.roll += (targetRoll - this.roll) * Math.min(1, dt * 10);
    this.pitch += (targetPitch - this.pitch) * Math.min(1, dt * 8);
    this.body.rotation.set(this.pitch, 0, this.roll);
    this.body.position.y = Math.sin(this.t * 30) * 0.012 * Math.min(1, Math.abs(k.spd) / 20);
    // steering + wheel spin
    const st = k.drift.on ? k.drift.dir * -0.35 : (k.prevSdir || 0) * 0.35;
    this.steer += (st - this.steer) * Math.min(1, dt * 12);
    for (const w of this.wheels) {
      if (w.front) w.hub.rotation.y = this.steer;
      w.spin.rotation.x += (k.spd / w.r) * dt;
    }
    this.driver.rotation.z = -this.roll * 0.8 + this.steer * 0.1;
    this.head.rotation.y = this.steer * 0.6;
    // flames: nitro violet-blue, small boosts orange, idle flicker
    const b = k.b;
    const nitro = b.nitro > 0 || b.turbo > 0, micro = b.micro > 0 || b.start > 0 || b.pad > 0;
    const amt = nitro ? 1 : micro ? 0.75 : k.spd > 5 && this.k.rev !== false ? 0.18 : 0.08;
    const len = nitro ? 2.6 : micro ? 1.5 : 0.5;
    for (const f of this.flames) {
      const u = f.material.uniforms;
      u.uTime.value = this.t; u.uAmt.value = amt;
      u.uColor.value.setHex(nitro ? 0x3a6bff : micro ? 0xff7a1a : 0x4cc9ff);
      u.uCore.value.setHex(nitro ? 0xc8f0ff : 0xfff2c0);
      f.scale.set(1, nitro ? 1.25 : 1, len * (0.85 + Math.random() * 0.3));
    }
    this.shield.visible = k.shield > 0;
    if (this.shield.visible) { this.shield.rotation.y += dt * 2; this.shield.material.opacity = 0.18 + Math.sin(this.t * 8) * 0.06; }
    this.bubble.visible = k.stunKind === 'bubble' && k.stun > 0;
    this.shell.visible = k.turtle > 0;
    if (this.horns) this.horns.visible = k.devil > 0;
    this.blob.visible = k.grounded || k.y < 50;
  }
  dispose() { this.scene.remove(this.root); disposeModel(this.root); }
}
