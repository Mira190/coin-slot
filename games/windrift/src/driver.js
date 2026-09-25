// The racer in the cockpit: full-face helmet (clear-coated shell with a paint-matched livery, smoked visor, spoiler),
// racing suit (fabric with sheen; paint-coloured side panels, chest band, piping, collar), gloves with cuffs, boots,
// seated reclined with hands at ten-to-two. Parts merge into 4 draw calls: suit, leather/trim, helmet, visor.
// Local frame: origin at the hip point on the seat, +z forward, +y up. Returns { driver, head } (head turns alone).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { canvasTex, FONT_EN } from './gfx.js';

const cache = new Map();
const lum = (c) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;

// suit atlas: top half = torso (u around from the chest centre, v up), bottom half = sleeves/legs (a side stripe)
function suitTexture(paint) {
  const key = 'suit' + paint;
  if (cache.has(key)) return cache.get(key);
  const p = new THREE.Color(paint), light = lum(p) > 0.55;
  const base = '#262a33', panel = '#' + p.getHexString(), pipe = light ? '#1a1c22' : '#f2f2f0', accent = lum(p) < 0.08 ? '#d8b25a' : panel;
  const t = canvasTex(512, 512, (c, w, h) => {
    const T = h / 2; // torso block: y 0..T (top of canvas = top of torso)
    c.fillStyle = base; c.fillRect(0, 0, w, h);
    // fabric weave
    c.globalAlpha = 0.06; for (let y = 0; y < h; y += 3) { c.fillStyle = y % 6 ? '#000' : '#fff'; c.fillRect(0, y, w, 1); } c.globalAlpha = 1;
    // side panels: u = 0.25 (right) and 0.75 (left), widening toward the ribs
    c.fillStyle = accent;
    for (const u of [0.25, 0.75]) { c.beginPath(); c.moveTo((u - 0.07) * w, T); c.lineTo((u + 0.07) * w, T); c.lineTo((u + 0.1) * w, T * 0.35); c.lineTo((u + 0.05) * w, 0); c.lineTo((u - 0.05) * w, 0); c.lineTo((u - 0.1) * w, T * 0.35); c.fill(); }
    // chest band (front) and shoulder yoke (back)
    c.fillRect(0, T * 0.34, w * 0.13, T * 0.1); c.fillRect(w * 0.87, T * 0.34, w * 0.13, T * 0.1);
    c.fillRect(w * 0.36, T * 0.1, w * 0.28, T * 0.08);
    // piping along the panel edges
    c.strokeStyle = pipe; c.lineWidth = 3;
    for (const u of [0.25, 0.75]) for (const s of [-1, 1]) { c.beginPath(); c.moveTo((u + s * 0.07) * w, T); c.lineTo((u + s * 0.1) * w, T * 0.35); c.lineTo((u + s * 0.05) * w, 0); c.stroke(); }
    // zip down the chest centre (u = 0 / 1) and a belt line
    c.strokeStyle = '#8a8f99'; c.lineWidth = 2; c.beginPath(); c.moveTo(3, 0); c.lineTo(3, T * 0.9); c.moveTo(w - 3, 0); c.lineTo(w - 3, T * 0.9); c.stroke();
    c.fillStyle = '#15171c'; c.fillRect(0, T * 0.9, w, T * 0.1);
    // chest patches (either side of the zip) and a back logo
    c.fillStyle = '#f2f2f0'; c.fillRect(w * 0.05, T * 0.2, w * 0.05, T * 0.07); c.fillStyle = accent; c.fillRect(w * 0.9, T * 0.2, w * 0.05, T * 0.07);
    c.fillStyle = pipe; c.font = `bold ${Math.round(T * 0.11)}px ${FONT_EN}`; c.textAlign = 'center'; c.fillText('WINDRIFT', w * 0.5, T * 0.5);
    // limbs block (bottom half): base with a paint stripe on both sides
    c.fillStyle = accent; c.fillRect(w * 0.2, T, w * 0.1, T); c.fillRect(w * 0.7, T, w * 0.1, T);
    c.fillStyle = pipe; c.fillRect(w * 0.2, T, 3, T); c.fillRect(w * 0.3 - 3, T, 3, T); c.fillRect(w * 0.7, T, 3, T); c.fillRect(w * 0.8 - 3, T, 3, T);
  });
  t.userData.shared = true; cache.set(key, t);
  return t;
}

// helmet livery on the sphere UV (u around from -x, v from the crown down): paint stripes over the crown front to
// back, a contrasting pinstripe, a trim band above the neck, and a number disc on each side
function helmetTexture(paint, shell) {
  const key = 'helm' + paint + shell;
  if (cache.has(key)) return cache.get(key);
  const p = new THREE.Color(paint), s = new THREE.Color(shell);
  const stripe = Math.abs(lum(p) - lum(s)) < 0.12 ? '#1c1e26' : '#' + p.getHexString();
  const pin = lum(s) > 0.5 ? '#1c1e26' : '#f4f4f2';
  const t = canvasTex(512, 256, (c, w, h) => {
    c.fillStyle = '#' + s.getHexString(); c.fillRect(0, 0, w, h);
    // front is u = 0.25, back u = 0.75 (three's sphere starts at -x)
    for (const u of [0.25, 0.75]) {
      c.fillStyle = stripe; c.fillRect((u - 0.055) * w, 0, 0.11 * w, h * 0.62);
      c.fillStyle = pin; c.fillRect((u - 0.075) * w, 0, 0.012 * w, h * 0.6); c.fillRect((u + 0.063) * w, 0, 0.012 * w, h * 0.6);
    }
    // a swept band along each side, low at the visor and rising to the back
    c.fillStyle = stripe;
    for (const [a, b] of [[0.3, 0.7], [0.8, 1.2]]) { c.beginPath(); c.moveTo(a * w, h * 0.7); c.lineTo(b * w, h * 0.52); c.lineTo(b * w, h * 0.58); c.lineTo(a * w, h * 0.76); c.fill(); c.beginPath(); c.moveTo(a * w - w, h * 0.7); c.lineTo(b * w - w, h * 0.52); c.lineTo(b * w - w, h * 0.58); c.lineTo(a * w - w, h * 0.76); c.fill(); }
    // number discs on both sides (u = 0 sits on the texture seam, so draw it at both edges)
    for (const u of [0, 0.5, 1]) {
      const x = u * w;
      c.fillStyle = '#f4f4f2'; c.beginPath(); c.arc(x, h * 0.4, h * 0.1, 0, 7); c.fill();
      c.fillStyle = '#1c1e26'; c.font = `bold ${Math.round(h * 0.13)}px ${FONT_EN}`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('7', x, h * 0.41);
    }
    // trim band and rubber edge above the neck opening
    c.fillStyle = '#1c1e26'; c.fillRect(0, h * 0.8, w, h * 0.2);
    c.fillStyle = stripe; c.fillRect(0, h * 0.76, w, h * 0.035);
  });
  t.userData.shared = true; cache.set(key, t);
  return t;
}

// vertex colour + UV-remap helpers so parts can share one material each
function tint(g, c) {
  g = g.index ? g.toNonIndexed() : g;
  const col = new THREE.Color(c), n = g.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) a.set([col.r, col.g, col.b], i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return g;
}
function uvBlock(g, v0, v1) {
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setY(i, v0 + uv.getY(i) * (v1 - v0));
  return g;
}
// tapered cylinder from a to b
const _up = new THREE.Vector3(0, 1, 0);
function limb(a, b, r0, r1, seg = 14) {
  const d = new THREE.Vector3().subVectors(b, a), len = d.length();
  const g = new THREE.CylinderGeometry(r1, r0, len, seg, 3);
  g.translate(0, len / 2, 0);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(_up, d.normalize()));
  g.translate(a.x, a.y, a.z);
  return g;
}
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const place = (g, x, y, z, rx = 0, ry = 0, rz = 0) => { g.rotateX(rx); g.rotateY(ry); g.rotateZ(rz); g.translate(x, y, z); return g; };

let mats = null;
function sharedMats() {
  if (mats) return mats;
  mats = {
    trim: new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.62, metalness: 0.05, sheen: 0.4, sheenRoughness: 0.6, sheenColor: 0x555555 }),
    visor: new THREE.MeshPhysicalMaterial({ color: 0x0c1118, metalness: 0.55, roughness: 0.06, clearcoat: 1, clearcoatRoughness: 0.03, iridescence: 0.45, iridescenceIOR: 1.6, envMapIntensity: 1.2 })
  };
  mats.trim.userData.shared = mats.visor.userData.shared = true;
  return mats;
}

export function buildDriver(paint, o = {}) {
  const M = sharedMats();
  const shellColor = o.helmet ?? 0xf1f1ee;
  const suit = new THREE.MeshPhysicalMaterial({ map: suitTexture(paint), roughness: 0.78, metalness: 0, sheen: 0.55, sheenRoughness: 0.45, sheenColor: 0x8a8f99 });
  const helmet = new THREE.MeshPhysicalMaterial({ map: helmetTexture(paint, shellColor), roughness: 0.32, metalness: 0.08, clearcoat: 1, clearcoatRoughness: 0.05 });
  const accent = new THREE.Color(paint), dark = 0x1a1c22, sole = 0x0e0f12, glove = 0x474c58; // gloves lighter than the black rim
  const driver = new THREE.Group();
  const suitG = [], trimG = [];

  // torso: lathe profile (radius by height), flattened front-to-back, reclined ~15°
  const prof = [[0.001, -0.02], [0.17, -0.02], [0.19, 0.06], [0.2, 0.18], [0.225, 0.3], [0.235, 0.4], [0.215, 0.47], [0.15, 0.525], [0.08, 0.55], [0.001, 0.555]].map(([r, y]) => new THREE.Vector2(r, y));
  const lean = -0.26;
  const torso = new THREE.LatheGeometry(prof, 28);
  torso.scale(1.32, 1, 0.82); torso.rotateX(lean);
  suitG.push(uvBlock(torso.index ? torso.toNonIndexed() : torso, 0.5, 1));
  const R = (x, y, z) => V(x, y, z).applyAxisAngle(V(1, 0, 0), lean); // a point on the reclined torso
  // hips / thighs / shins / boots (mostly hidden in the nose, visible through the cockpit opening)
  for (const s of [1, -1]) {
    const hip = V(s * 0.11, 0.04, 0.02), knee = V(s * 0.15, 0.2, 0.42), ankle = V(s * 0.13, 0.08, 0.78);
    suitG.push(uvBlock(limb(hip, knee, 0.095, 0.075), 0, 0.5), uvBlock(limb(knee, ankle, 0.07, 0.058), 0, 0.5));
    suitG.push(uvBlock(new THREE.SphereGeometry(0.078, 12, 8).translate(knee.x, knee.y, knee.z), 0, 0.5));
    trimG.push(tint(place(new THREE.BoxGeometry(0.11, 0.1, 0.2), ankle.x, ankle.y + 0.01, ankle.z + 0.06), dark));
    trimG.push(tint(place(new THREE.BoxGeometry(0.115, 0.03, 0.22), ankle.x, ankle.y - 0.045, ankle.z + 0.07), sole));
  }
  // arms: shoulder → elbow (out and down) → hand on the wheel rim at ten-to-two
  const wheelC = V(0, 0.43, 0.42), wheelTilt = -1.0, wr = 0.15;
  const onRim = (a) => V(Math.sin(a) * wr, Math.cos(a) * wr, 0).applyAxisAngle(V(1, 0, 0), wheelTilt).add(wheelC);
  for (const s of [1, -1]) {
    // arms reach forward to a chest-height wheel; the elbow drops below the shoulder–hand line and stays clear of the
    // ribs. Sleeves are padded suit fabric: a round shoulder, a full upper arm, a forearm that tapers to the wrist
    const sh = R(s * 0.28, 0.44, 0.0), hand = onRim(s * 0.95);
    const el = sh.clone().lerp(hand, 0.5).add(V(s * 0.075, -0.1, -0.02));
    const wrist = hand.clone().lerp(el, 0.2);
    suitG.push(uvBlock(new THREE.SphereGeometry(0.108, 16, 12).translate(sh.x, sh.y, sh.z), 0, 0.5));
    suitG.push(uvBlock(limb(sh, el, 0.1, 0.086, 18), 0, 0.5), uvBlock(limb(el, wrist, 0.084, 0.064, 18), 0, 0.5));
    suitG.push(uvBlock(new THREE.SphereGeometry(0.086, 14, 10).translate(el.x, el.y, el.z), 0, 0.5));
    // glove: a flared gauntlet cuff in the kart colour over the sleeve end, then a padded fist with a thumb wrapped
    // over the rim
    trimG.push(tint(limb(wrist.clone().lerp(el, 0.3), wrist, 0.088, 0.07, 16), accent));
    const fist = new THREE.SphereGeometry(0.068, 14, 12); fist.scale(1, 0.86, 1.3);
    trimG.push(tint(fist.translate(hand.x, hand.y, hand.z), glove));
    const up = V(0, 1, 0).applyAxisAngle(V(1, 0, 0), wheelTilt), thumb = hand.clone().addScaledVector(up, 0.05).add(V(-s * 0.035, 0, 0.02));
    trimG.push(tint(new THREE.CapsuleGeometry(0.026, 0.05, 4, 8).rotateZ(Math.PI / 2).translate(thumb.x, thumb.y, thumb.z), glove));
  }
  // steering wheel: rim, spokes, hub
  const rim = new THREE.TorusGeometry(wr, 0.018, 8, 28); rim.rotateX(wheelTilt); // torus lies in XY like onRim()
  trimG.push(tint(rim.translate(wheelC.x, wheelC.y, wheelC.z), 0x15161a));
  for (const a of [Math.PI / 2, -Math.PI / 2, Math.PI]) { const e = onRim(a); trimG.push(tint(limb(wheelC, e, 0.012, 0.012, 6), 0x2a2c33)); }
  trimG.push(tint(new THREE.CylinderGeometry(0.045, 0.045, 0.04, 16).rotateX(Math.PI / 2 + wheelTilt).translate(wheelC.x, wheelC.y, wheelC.z), accent));
  // collar and balaclava neck
  const neckBase = R(0, 0.54, 0.0), neckTop = R(0, 0.64, 0.04);
  trimG.push(tint(limb(neckBase, neckTop, 0.072, 0.066, 16), dark));
  const collar = new THREE.TorusGeometry(0.085, 0.024, 8, 20); collar.rotateX(Math.PI / 2 + lean);
  trimG.push(tint(collar.translate(neckBase.x, neckBase.y + 0.01, neckBase.z), accent));

  const add = (list, mat, parent) => { const m = new THREE.Mesh(mergeGeometries(list.map((g) => (g.index ? g.toNonIndexed() : g))), mat); m.castShadow = true; parent.add(m); list.forEach((g) => g.dispose()); return m; };
  add(suitG, suit, driver);
  add(trimG, M.trim, driver);

  // helmet (its own group so it can turn): shell, visor, chin, spoiler
  const head = new THREE.Group();
  const hc = R(0, 0.77, 0.07);
  head.position.copy(hc);
  const HR = 0.225; // helmet radius (≈ 0.7 × shoulder width)
  const shell = new THREE.SphereGeometry(HR, 36, 24, 0, Math.PI * 2, 0, Math.PI * 0.8);
  shell.scale(1, 1.02, 1.1);
  const chin = new THREE.SphereGeometry(HR * 0.8, 24, 12, Math.PI * 0.2, Math.PI * 0.6, Math.PI * 0.55, Math.PI * 0.3); // chin bar in front, below the visor
  chin.scale(1.05, 1, 1.25); chin.translate(0, -0.02, 0.02);
  const fin = new THREE.BoxGeometry(0.028, 0.045, 0.11); fin.rotateX(-0.35); fin.translate(0, HR * 0.84, -HR * 0.8);
  const lip = new THREE.BoxGeometry(0.18, 0.016, 0.065); lip.rotateX(-0.25); lip.translate(0, HR * 0.68, -HR);
  const helmetParts = [shell, chin, fin, lip].map((g) => (g.index ? g.toNonIndexed() : g));
  // the spoiler parts take the stripe colour region of the texture (u ≈ 0.75 at the back)
  // partial spheres/boxes span the whole texture in UV, so pin them to one spot: chin = shell colour, spoiler = stripe
  const pin = (g, u, v) => { const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, u, v); };
  pin(helmetParts[1], 0.14, 0.62); pin(helmetParts[2], 0.75, 0.75); pin(helmetParts[3], 0.75, 0.75);
  const hm = add(helmetParts, helmet, head);
  const visor = new THREE.SphereGeometry(HR * 1.032, 32, 12, Math.PI / 2 - 0.92, 1.84, Math.PI * 0.36, Math.PI * 0.2);
  visor.scale(1, 1.02, 1.1);
  const vm = new THREE.Mesh(visor, M.visor); vm.castShadow = false; head.add(vm);
  head.rotation.x = 0.1; // chin slightly down, eyes on the road
  driver.add(head);
  hm.castShadow = true;
  return { driver, head, suit, helmet };
}
