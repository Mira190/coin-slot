// Theme dressing: everything off the road. Procedural, instanced or merged so each theme is a few dozen draw calls.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { F, DS, wrap } from './track.js';
import { canvasTex, speckle, rng, fbm, softTex, textTex, FONT_ZH, FONT_EN, smoothstep } from './gfx.js';
import { GLOW } from './themes.js';

const V3 = THREE.Vector3;
const m4 = new THREE.Matrix4(), q4 = new THREE.Quaternion(), e4 = new THREE.Euler(), p4 = new V3(), s4 = new V3();

export function buildScenery(W) {
  ({ city, coast, snow, desert })[W.th.name](W);
}

// ---- helpers --------------------------------------------------------------------------------------
function instanced(W, geo, mat, list, { shadow = true, receive = true } = {}) {
  if (!list.length) return null;
  const im = new THREE.InstancedMesh(geo, mat, list.length);
  list.forEach((t, n) => {
    e4.set(t.rx || 0, t.ry || 0, t.rz || 0); q4.setFromEuler(e4);
    p4.set(t.x, t.y, t.z); s4.set(t.sx || t.s || 1, t.sy || t.s || 1, t.sz || t.s || 1);
    m4.compose(p4, q4, s4); im.setMatrixAt(n, m4);
    if (t.color != null && im.setColorAt) im.setColorAt(n, new THREE.Color(t.color));
  });
  im.castShadow = shadow; im.receiveShadow = receive;
  im.computeBoundingSphere();
  W.scene.add(im);
  return im;
}
// scatter n points in the play area, away from roads
function scatter(W, n, r, { minD = 6, maxD = 1e9, seed = 1, pad = 250, test } = {}) {
  const b = W.T.bounds, R = rng(seed), out = [];
  let tries = 0;
  while (out.length < n && tries < n * 30) {
    tries++;
    const x = b.x0 - pad + R() * (b.x1 - b.x0 + pad * 2), z = b.z0 - pad + R() * (b.z1 - b.z0 + pad * 2);
    const d = W.roadDistAll(x, z);
    if (d < minD + r || d > maxD) continue;
    if (test && !test(x, z, d, R)) continue;
    out.push({ x, z, d, r: R });
  }
  return out;
}
const ni = (g) => (g.index ? g.toNonIndexed() : g);
function vcolor(geo, c) {
  geo = ni(geo);
  const col = new THREE.Color(c), n = geo.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = col.r; a[i * 3 + 1] = col.g; a[i * 3 + 2] = col.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return geo;
}
function prep(geo) { // merge-compatible: non-indexed with position/normal/uv/color
  const g = ni(geo);
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
  if (!g.attributes.color) vcolor(g, 0xffffff);
  return g;
}
function boxUV(w, h, d, tile) {
  // box whose UVs repeat every `tile` units so window textures keep their scale
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv;
  for (let f = 0; f < 6; f++) {
    const fw = f < 2 ? d : f < 4 ? w : w, fh = f < 2 ? h : f < 4 ? d : h;
    for (let k = 0; k < 4; k++) { const i = f * 4 + k; uv.setXY(i, uv.getX(i) * fw / tile, uv.getY(i) * fh / tile); }
  }
  return g;
}
const place = (g, x, y, z, ry = 0, sx = 1, sy = 1, sz = 1) => { g = g.clone(); g.scale(sx, sy, sz); g.rotateY(ry); g.translate(x, y, z); return g; };
function mergeAdd(W, geos, mat, shadow = true) {
  if (!geos.length) return null;
  const m = new THREE.Mesh(mergeGeometries(geos.map(prep)), mat);
  m.castShadow = shadow; m.receiveShadow = true; W.scene.add(m);
  return m;
}
function lampPositions(W, every, off) {
  const P = W.T.main, out = [];
  let acc = 0, side = 1;
  for (let i = 0; i < P.n; i++) {
    acc += DS;
    if (acc < every || P.fl[i] & (F.TUN | F.GAP)) continue;
    if (W.nearTunnel(P.x[i], P.z[i]) < 16) continue; // no lamp posts at tunnel mouths
    acc = 0; side = -side;
    if ((side > 0 ? P.openL : P.openR)[i]) continue;
    const hw = P.hw[i] + off;
    out.push({ x: P.x[i] + P.nx[i] * side * hw, y: P.y[i], z: P.z[i] + P.nz[i] * side * hw, ry: Math.atan2(P.tx[i], P.tz[i]) + (side > 0 ? -Math.PI / 2 : Math.PI / 2), i, side, bridge: !!(P.fl[i] & F.BRG) });
  }
  return out;
}
function waterMat(W, color, opacity = 0.9, rough = 0.06) {
  const n = W.waterNormals.clone(); n.needsUpdate = true; n.repeat.set(8, 8);
  W.anim.push((dt) => { n.offset.x += dt * 0.01; n.offset.y += dt * 0.006; });
  return new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0.1, normalMap: n, normalScale: new THREE.Vector2(0.5, 0.5), transparent: opacity < 1, opacity });
}
function featWater(W, f, y, mat, across) {
  const g = new THREE.PlaneGeometry(f.half * 2 + 10, across);
  const m = new THREE.Mesh(g, mat);
  m.rotation.x = -Math.PI / 2; m.rotation.z = Math.atan2(f.tz, f.tx) * -1;
  m.position.set(f.x, y, f.z);
  // orient: plane's local x along the road tangent
  m.rotation.set(-Math.PI / 2, 0, -Math.atan2(f.tz, f.tx));
  W.scene.add(m);
  return m;
}

// ---- CITY -----------------------------------------------------------------------------------------
function windowTex(seed, warm) {
  // lit windows: warm/cool tints at varied brightness (curtains, lamps, TV glow); the glass itself is dark in the
  // albedo map so the light comes only from the emissive map and never clips to white
  const R = rng(seed);
  const lit = [];
  const PAL = warm ? ['#e8a85a', '#f0bd78', '#d98c48', '#f3cf96'] : ['#8fb8e8', '#b8d0ee', '#e8a85a', '#9ec8e0'];
  const tex = canvasTex(256, 256, (c, w, h) => {
    speckle(c, w, h, ['#1a1c2a', '#22202e', '#161d2a', '#26222c'][seed % 4], 0.12, 1500, seed);
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
      const on = R() < 0.3;
      if (on) lit.push([x, y, PAL[Math.floor(R() * PAL.length)], 0.35 + R() * 0.65]);
      c.fillStyle = on ? '#2a2830' : '#0b0d16'; c.fillRect(x * 32 + 6, y * 32 + 7, 20, 18);
      c.fillStyle = 'rgba(255,255,255,.05)'; c.fillRect(x * 32 + 6, y * 32 + 7, 20, 3);
    }
  }, { repeat: true });
  const emi = canvasTex(256, 256, (c, w, h) => {
    c.fillStyle = '#000'; c.fillRect(0, 0, w, h);
    for (const [x, y, col, k] of lit) {
      c.globalAlpha = k; c.fillStyle = col; c.fillRect(x * 32 + 6, y * 32 + 7, 20, 18);
      c.globalAlpha = k * 0.5; c.fillStyle = '#000'; c.fillRect(x * 32 + 6, y * 32 + 7 + 12, 20, 6); // sill shadow
    }
    c.globalAlpha = 1;
  }, { repeat: true });
  return new THREE.MeshStandardMaterial({ map: tex, emissive: 0xffffff, emissiveMap: emi, emissiveIntensity: GLOW.window, roughness: 0.55, metalness: 0.25 });
}
const NEON = [['风驰', 'WINDRIFT'], ['夜市', 'NIGHT MARKET'], ['拉面', 'RAMEN'], ['电玩城', 'ARCADE'], ['咖啡', 'CAFE'], ['霓虹', 'NEON'], ['疾驰', 'VELOCITY'], ['烧烤', 'BBQ'], ['唱片', 'RECORDS'], ['漂移', 'DRIFT'], ['书店', 'BOOKS'], ['旅馆', 'HOTEL']];
const NEONC = ['#ff2e7e', '#19d3ff', '#ffd21f', '#9b5cff', '#39ff9a', '#ff8a1f'];
function neonTex(i) {
  const [zh, en] = NEON[i % NEON.length], col = NEONC[i % NEONC.length];
  // tube colour for the glyphs (a pale tint of the neon, not white) so signs read as coloured light, not white glare
  const c = new THREE.Color(col).lerp(new THREE.Color(0xffffff), 0.35), core = '#' + c.getHexString();
  return textTex([{ text: zh, font: `96px ${FONT_ZH}`, color: core, glow: col, blur: 18, y: 70 }, { text: en, font: `30px ${FONT_EN}`, color: col, glow: col, blur: 10, y: 140 }], { w: 384, h: 176, bg: 'rgba(10,6,24,.92)', border: col, bw: 6 });
}

function city(W) {
  const T = W.T, sc = W.scene;
  const mats = [0, 1, 2, 3].map((k) => windowTex(k + 3, k % 2 === 0));
  const groups = [[], [], [], []];
  const R = rng(99);
  const b = T.bounds, cell = 28;
  const signSpots = [];
  for (let x = b.x0 - 300; x < b.x1 + 300; x += cell) for (let z = b.z0 - 300; z < b.z1 + 300; z += cell) {
    const jx = x + (R() - 0.5) * 8, jz = z + (R() - 0.5) * 8;
    const w = 12 + R() * 11, d = 12 + R() * 11, rad = Math.hypot(w, d) / 2;
    const dist = W.roadDistAll(jx, jz);
    if (dist < rad + 9) continue;
    const far = smoothstep(40, 260, dist);
    const h = 14 + R() * 30 + far * R() * 90 + (R() < 0.06 ? 70 : 0);
    const k = Math.floor(R() * 4);
    const ry = Math.round(R() * 2) * 0.0;
    groups[k].push(place(boxUV(w, h, d, 16), jx, h / 2 - 0.5, jz, ry));
    // rooftop clutter
    if (R() < 0.5) groups[(k + 1) % 4].push(place(boxUV(w * 0.4, 3, d * 0.3, 16), jx + (R() - 0.5) * w * 0.4, h + 1.5, jz + (R() - 0.5) * d * 0.4));
    if (dist < 60 && R() < 0.55) signSpots.push({ x: jx, z: jz, w, d, h });
  }
  groups.forEach((g, k) => { const m = mergeAdd(W, g, mats[k]); });
  // far skyline ring
  {
    const ring = [], cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2, rr = Math.max(b.x1 - b.x0, b.z1 - b.z0) / 2 + 520;
    for (let a = 0; a < Math.PI * 2; a += 0.045) {
      const h = 60 + R() * 160, w = 30 + R() * 40;
      ring.push(place(boxUV(w, h, w, 16), cx + Math.cos(a) * (rr + R() * 120), h / 2 - 1, cz + Math.sin(a) * (rr + R() * 120), -a));
    }
    mergeAdd(W, ring, mats[1], false);
  }
  // neon signs facing the road
  const signGeo = new THREE.PlaneGeometry(9, 4.1);
  signSpots.slice(0, 26).forEach((s, n) => {
    const tex = neonTex(n);
    const mat = new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color(1, 1, 1).multiplyScalar(GLOW.neon), transparent: true });
    const m = new THREE.Mesh(signGeo, mat);
    // face toward nearest main-road sample
    const P = T.main; let bi = 0, bd = 1e9; for (let i = 0; i < P.n; i += 3) { const dd = Math.hypot(P.x[i] - s.x, P.z[i] - s.z); if (dd < bd) { bd = dd; bi = i; } }
    const dx = P.x[bi] - s.x, dz = P.z[bi] - s.z, a = Math.atan2(dx, dz);
    const off = Math.max(s.w, s.d) / 2 + 0.3;
    const hy = Math.min(s.h - 3, 8 + (n % 4) * 3.5);
    m.position.set(s.x + Math.sin(a) * off, hy, s.z + Math.cos(a) * off);
    m.rotation.y = a;
    sc.add(m);
  });
  // big video wall near the start straight
  {
    const cv = document.createElement('canvas'); cv.width = 512; cv.height = 256;
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
    const ctx = cv.getContext('2d');
    let acc = 0, fr = 0;
    const draw = () => {
      fr++;
      const g = ctx.createLinearGradient(0, 0, 512, 256);
      const hue = (fr * 3) % 360;
      g.addColorStop(0, `hsl(${hue},80%,35%)`); g.addColorStop(1, `hsl(${(hue + 120) % 360},80%,20%)`);
      ctx.fillStyle = g; ctx.fillRect(0, 0, 512, 256);
      ctx.fillStyle = 'rgba(255,255,255,.08)';
      for (let i = 0; i < 12; i++) ctx.fillRect(((fr * 9 + i * 60) % 620) - 60, i * 22, 40, 4);
      ctx.font = `120px ${FONT_ZH}`; ctx.textAlign = 'center'; ctx.fillStyle = '#fff'; ctx.shadowColor = '#ff2e7e'; ctx.shadowBlur = 24;
      ctx.fillText(fr % 80 < 40 ? '风驰' : '漂移', 256, 130);
      ctx.font = `34px ${FONT_EN}`; ctx.shadowBlur = 0; ctx.fillStyle = '#ffd21f';
      ctx.fillText(fr % 80 < 40 ? 'WINDRIFT GRAND PRIX' : 'DRIFT · BOOST · WIN', 256, 210);
      tex.needsUpdate = true;
    };
    draw();
    W.anim.push((dt) => { acc += dt; if (acc > 0.12) { acc = 0; draw(); } });
    const P = T.main, i = wrap(P, 30), side = -1;
    const dist = P.hw[i] + 26;
    const scr = new THREE.Mesh(new THREE.PlaneGeometry(32, 16), new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color(1, 1, 1).multiplyScalar(GLOW.videoWall) }));
    scr.position.set(P.x[i] + P.nx[i] * side * dist, 22, P.z[i] + P.nz[i] * side * dist);
    scr.lookAt(P.x[i], 18, P.z[i]);
    sc.add(scr);
    const frame = new THREE.Mesh(new THREE.BoxGeometry(34, 18, 1.5), new THREE.MeshStandardMaterial({ color: 0x15161f, metalness: 0.7, roughness: 0.3 }));
    frame.position.copy(scr.position); frame.quaternion.copy(scr.quaternion); frame.translateZ(-0.8); sc.add(frame);
    const leg = new THREE.Mesh(new THREE.BoxGeometry(2, 14, 2), frame.material); leg.position.set(scr.position.x, 7, scr.position.z); sc.add(leg);
  }
  // street lamps + light pools
  {
    const L = lampPositions(W, 26, 1.6);
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x2a2d38, metalness: 0.8, roughness: 0.35 });
    const pole = new THREE.CylinderGeometry(0.14, 0.2, 8.5, 8); pole.translate(0, 4.25, 0);
    const arm = new THREE.BoxGeometry(0.16, 0.16, 3.2); arm.translate(0, 8.4, 1.5);
    const head = new THREE.BoxGeometry(0.6, 0.25, 1.4); head.translate(0, 8.25, 2.9);
    const lampGeo = mergeGeometries([pole, arm].map(ni));
    const list = L.map((l) => ({ x: l.x, y: l.y - 0.3, z: l.z, ry: l.ry + Math.PI / 2 }));
    instanced(W, lampGeo, poleMat, list);
    const heads = new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.72, 0.42).multiplyScalar(GLOW.lampHead) });
    instanced(W, head, heads, list, { shadow: false });
    const pool = new THREE.MeshBasicMaterial({ map: softTex(), color: 0xffb46b, transparent: true, opacity: GLOW.lampPool, blending: THREE.AdditiveBlending, depthWrite: false });
    const pg = new THREE.PlaneGeometry(12, 12); pg.rotateX(-Math.PI / 2);
    instanced(W, pg, pool, L.map((l) => ({ x: l.x - Math.sin(l.ry + Math.PI / 2) * -2.9 * 0 + (W.T.main.x[l.i] - l.x) * 0.3, y: l.y + 0.08, z: l.z + (W.T.main.z[l.i] - l.z) * 0.3 })), { shadow: false, receive: false });
  }
  // canal water under the jump gap
  for (const f of W.features) if (f.kind === 'canal') {
    featWater(W, f, -3.6, waterMat(W, 0x0d3a52, 0.95, 0.04), 440);
    // canal edge lights
  }
  // alley shortcut: market stalls and lantern strings
  for (const P of T.paths) if (P.kind === 'alley') {
    const lanternMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.3, 0.2).multiplyScalar(GLOW.lantern) });
    const lg = new THREE.SphereGeometry(0.42, 10, 8);
    const lanterns = [], stalls = [], awnings = [];
    for (let i = 4; i < P.n - 4; i += 4) {
      for (const s of [1, -1]) {
        const hw = P.hw[i];
        lanterns.push({ x: P.x[i] + P.nx[i] * s * (hw - 0.8), y: P.y[i] + 4.6 + Math.sin(i) * 0.2, z: P.z[i] + P.nz[i] * s * (hw - 0.8) });
        if (i % 8 === 0) {
          const x = P.x[i] + P.nx[i] * s * (hw + 3), z = P.z[i] + P.nz[i] * s * (hw + 3), ry = Math.atan2(P.tx[i], P.tz[i]);
          stalls.push({ x, y: P.y[i] + 1.2, z, ry });
          awnings.push({ x: P.x[i] + P.nx[i] * s * (hw + 1.8), y: P.y[i] + 3, z: P.z[i] + P.nz[i] * s * (hw + 1.8), ry, rz: 0, rx: 0, color: ['#ff2e7e', '#19d3ff', '#ffd21f'][i % 3] });
        }
      }
    }
    instanced(W, lg, lanternMat, lanterns, { shadow: false });
    instanced(W, new THREE.BoxGeometry(3.4, 2.4, 3), new THREE.MeshStandardMaterial({ color: 0x5a3a2a, roughness: 0.8 }), stalls);
    const aw = instanced(W, new THREE.BoxGeometry(3.6, 0.2, 3.4), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6 }), awnings);
    // a gate arch at both ends
    for (const i of [2, P.n - 3]) {
      const g = textTex([{ text: '小巷近道', font: `60px ${FONT_ZH}`, color: '#ffd21f', glow: '#ff8a1f', y: 50 }, { text: 'ALLEY SHORTCUT', font: `26px ${FONT_EN}`, color: '#fff', y: 104 }], { w: 512, h: 128, bg: 'rgba(40,6,12,.9)', border: '#ff2e7e' });
      const m = new THREE.Mesh(new THREE.PlaneGeometry(P.hw[i] * 2 + 2, 2.2), new THREE.MeshBasicMaterial({ map: g, side: THREE.DoubleSide, color: new THREE.Color(1, 1, 1).multiplyScalar(GLOW.sign) }));
      m.position.set(P.x[i], P.y[i] + 6, P.z[i]); m.rotation.y = Math.atan2(P.tx[i], P.tz[i]) + Math.PI; sc.add(m);
    }
  }
  // flyover underside strip lights (bridges)
  planters(W, 0x2f8f4a);
}
function planters(W, leaf) {
  const pts = scatter(W, 70, 1.5, { minD: 3.5, maxD: 9, seed: 5 });
  const trunk = new THREE.CylinderGeometry(0.18, 0.25, 2.4, 6); trunk.translate(0, 1.2, 0);
  const crown = new THREE.IcosahedronGeometry(1.6, 1); crown.translate(0, 3.3, 0);
  const g = mergeGeometries([vcolor(trunk, 0x5a3a22), vcolor(crown, leaf)]);
  instanced(W, g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 }), pts.map((p) => ({ x: p.x, y: W.groundAt(p.x, p.z), z: p.z, ry: p.r() * 6, s: 0.8 + p.r() * 0.5 })));
}

// ---- COAST ----------------------------------------------------------------------------------------
function houseTex(seed) {
  return canvasTex(128, 128, (c, w, h) => {
    speckle(c, w, h, '#e4e1d8', 0.07, 700, seed);
    const R = rng(seed);
    c.fillStyle = ['#1f5fd0', '#2a78d8', '#1a4fae', '#e2a23a'][seed % 4];
    const door = R() < 0.7;
    if (door) c.fillRect(52, 70, 24, 58);
    c.fillRect(14, 30, 20, 22); c.fillRect(94, 30, 20, 22);
    if (!door) c.fillRect(54, 30, 20, 22);
    c.fillStyle = 'rgba(0,0,0,.06)'; c.fillRect(0, 0, w, 6);
  });
}
function coast(W) {
  const T = W.T, sc = W.scene, R = rng(21);
  // village houses on the hillside and around the start
  const houseMats = [0, 1, 2, 3].map((k) => new THREE.MeshStandardMaterial({ map: houseTex(k + 1), roughness: 0.85 }));
  const groups = [[], [], [], []], domes = [], bougs = [];
  const spots = scatter(W, 260, 5, { minD: 7, maxD: 110, seed: 8, pad: 120, test: (x, z) => W.groundAt(x, z) > 0.5 && W.groundAt(x, z) < 34 });
  for (const s of spots) {
    const w = 6 + s.r() * 6, d = 6 + s.r() * 6, h = 4 + s.r() * 5 + (s.r() < 0.2 ? 4 : 0);
    const gy = W.groundAt(s.x, s.z) - 0.8;
    const ry = s.r() * Math.PI;
    groups[Math.floor(s.r() * 4)].push(place(new THREE.BoxGeometry(w, h + 1, d), s.x, gy + (h + 1) / 2, s.z, ry));
    if (s.r() < 0.5) groups[Math.floor(s.r() * 4)].push(place(new THREE.BoxGeometry(w * 0.55, h * 0.6, d * 0.55), s.x + Math.cos(ry) * w * 0.2, gy + h + h * 0.3, s.z - Math.sin(ry) * w * 0.2, ry));
    if (s.r() < 0.18) domes.push({ x: s.x, y: gy + h + 1, z: s.z, s: Math.min(w, d) * 0.36 });
    if (s.r() < 0.3) bougs.push({ x: s.x + (s.r() - 0.5) * w, y: gy + h * 0.6, z: s.z + (s.r() - 0.5) * d, s: 1 + s.r() });
  }
  groups.forEach((g, k) => mergeAdd(W, g, houseMats[k]));
  const dome = new THREE.SphereGeometry(1, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2);
  instanced(W, dome, new THREE.MeshStandardMaterial({ color: 0x2365d8, roughness: 0.35, metalness: 0.1 }), domes);
  instanced(W, new THREE.IcosahedronGeometry(1.2, 1), new THREE.MeshStandardMaterial({ color: 0xe0368a, roughness: 0.9 }), bougs);

  // windmills along the ridge (the highest stretch of the main loop)
  const P = T.main;
  const mills = [];
  let lastS = -999;
  const ymax = T.bounds.y1;
  for (let i = 0; i < P.n; i++) {
    if (P.y[i] < ymax - 9 || P.fl[i] & F.TUN || P.s[i] - lastS < 34) continue;
    lastS = P.s[i];
    const side = mills.length % 2 ? 1 : -1, off = P.hw[i] + 14 + R() * 12;
    const x = P.x[i] + P.nx[i] * side * off, z = P.z[i] + P.nz[i] * side * off;
    if (W.roadDistAll(x, z) < 8) continue;
    mills.push({ x, z, y: W.groundAt(x, z) - 0.5 });
  }
  const towerMat = new THREE.MeshStandardMaterial({ color: 0xe2ded2, roughness: 0.8 });
  const roofMat = new THREE.MeshStandardMaterial({ color: 0x8a5a36, roughness: 0.9 });
  const sailMat = new THREE.MeshStandardMaterial({ color: 0xe8e0cc, roughness: 0.8, side: THREE.DoubleSide });
  const woodMat = new THREE.MeshStandardMaterial({ color: 0x5a3a22, roughness: 0.9 });
  for (const m of mills.slice(0, 9)) {
    const g = new THREE.Group();
    const tower = new THREE.Mesh(new THREE.CylinderGeometry(3, 3.9, 11, 16), towerMat); tower.position.y = 5.5; tower.castShadow = true; g.add(tower);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(3.7, 3.6, 16), roofMat); roof.position.y = 12.8; roof.castShadow = true; g.add(roof);
    const door = new THREE.Mesh(new THREE.BoxGeometry(1.4, 2.4, 0.3), new THREE.MeshStandardMaterial({ color: 0x1f5fd0 })); door.position.set(0, 1.2, 3.8); g.add(door);
    const hub = new THREE.Group(); hub.position.set(0, 11.2, 3.4);
    for (let k = 0; k < 6; k++) {
      const arm = new THREE.Group(); arm.rotation.z = (k / 6) * Math.PI * 2;
      const spar = new THREE.Mesh(new THREE.BoxGeometry(0.22, 9, 0.22), woodMat); spar.position.y = 4.5; arm.add(spar);
      const sail = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 6.5), sailMat); sail.position.set(0.95, 5.2, 0.05); arm.add(sail);
      hub.add(arm);
    }
    g.add(hub);
    g.position.set(m.x, m.y, m.z);
    g.rotation.y = Math.atan2(W.sunDir.x, W.sunDir.z) + R() * 0.6;
    g.traverse((o) => { o.userData.dynamic = true; });
    sc.add(g);
    const sp = 0.6 + R() * 0.5;
    W.anim.push((dt) => { hub.rotation.z += dt * sp; });
  }
  // cypress + olive trees
  const cyp = new THREE.ConeGeometry(1.1, 7, 8); cyp.translate(0, 3.5, 0);
  const trees = scatter(W, 240, 1.5, { minD: 4, maxD: 160, seed: 12, pad: 160, test: (x, z) => W.groundAt(x, z) > 1 });
  instanced(W, vcolor(cyp, 0x2f5a2c), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }), trees.filter((t, i) => i % 2).map((t) => ({ x: t.x, y: W.groundAt(t.x, t.z) - 0.3, z: t.z, s: 0.8 + t.r() * 0.7, ry: t.r() * 6 })));
  const olive = new THREE.IcosahedronGeometry(2.2, 1); olive.translate(0, 2.6, 0);
  instanced(W, vcolor(olive, 0x7f9a5a), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, flatShading: true }), trees.filter((t, i) => !(i % 2)).map((t) => ({ x: t.x, y: W.groundAt(t.x, t.z) - 0.5, z: t.z, s: 0.7 + t.r() * 0.6, sy: 0.6 + t.r() * 0.3 })));
  // rocks by the water
  const rocks = scatter(W, 90, 2, { minD: 4, seed: 14, pad: 200, test: (x, z) => { const g = W.groundAt(x, z); return g < 3 && g > -4; } });
  instanced(W, new THREE.DodecahedronGeometry(2, 0), new THREE.MeshStandardMaterial({ color: 0x8c8378, roughness: 0.95, flatShading: true }), rocks.map((r) => ({ x: r.x, y: W.groundAt(r.x, r.z), z: r.z, s: 0.6 + r.r() * 1.8, ry: r.r() * 6, rx: r.r() })));
  // lighthouse on the sea side
  {
    const b = T.bounds;
    let best = null;
    for (let k = 0; k < 400; k++) { const x = b.x0 - 60 + R() * 200, z = b.z1 - 40 - R() * 200; const g = W.groundAt(x, z); if (g > 0.5 && g < 6 && W.roadDistAll(x, z) > 20) { best = [x, z, g]; break; } }
    if (best) {
      const g = new THREE.Group();
      const stripeTex = canvasTex(64, 256, (c, w, h) => { for (let y = 0; y < h; y += 64) { c.fillStyle = '#ffffff'; c.fillRect(0, y, w, 32); c.fillStyle = '#d8283c'; c.fillRect(0, y + 32, w, 32); } });
      const tw = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 3.2, 24, 20), new THREE.MeshStandardMaterial({ map: stripeTex, roughness: 0.6 })); tw.position.y = 12; tw.castShadow = true; g.add(tw);
      const lamp = new THREE.Mesh(new THREE.CylinderGeometry(1.8, 1.8, 2.6, 16), new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.93, 0.6).multiplyScalar(GLOW.lighthouse) })); lamp.position.y = 25.3; g.add(lamp);
      const cap = new THREE.Mesh(new THREE.ConeGeometry(2.4, 2.2, 16), new THREE.MeshStandardMaterial({ color: 0xd8283c })); cap.position.y = 27.7; g.add(cap);
      g.position.set(best[0], best[2] - 0.5, best[1]); sc.add(g);
    }
  }
  // sailboats
  {
    const hull = new THREE.BoxGeometry(2.4, 1.1, 7); hull.translate(0, 0.3, 0);
    const mast = new THREE.CylinderGeometry(0.1, 0.1, 9); mast.translate(0, 5, 0);
    const sail = new THREE.BufferGeometry(); sail.setAttribute('position', new THREE.Float32BufferAttribute([0, 1.4, -0.3, 0, 9.2, -0.3, 0, 1.4, -3.6], 3)); sail.computeVertexNormals(); sail.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 0, 1, 1, 0], 2));
    const g = mergeGeometries([vcolor(hull, 0xf2f2f2), vcolor(mast, 0x6a4a2a), vcolor(sail, 0xfff6e8)]);
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, side: THREE.DoubleSide });
    const boats = scatter(W, 16, 6, { minD: 30, seed: 16, pad: 380, test: (x, z) => W.groundAt(x, z) < -5 });
    const im = instanced(W, g, mat, boats.map((b) => ({ x: b.x, y: W.th.sea - 0.2, z: b.z, ry: b.r() * 6 })));
    if (im) { im.userData.dynamic = true; const base = boats.map((b) => ({ ...b, ry: 0 })); let t = 0;
      W.anim.push((dt) => { t += dt; base.forEach((b, n) => { e4.set(Math.sin(t + n) * 0.05, n, Math.cos(t * 0.8 + n) * 0.06); q4.setFromEuler(e4); p4.set(b.x, W.th.sea - 0.2 + Math.sin(t * 1.3 + n) * 0.15, b.z); s4.set(1, 1, 1); m4.compose(p4, q4, s4); im.setMatrixAt(n, m4); }); im.instanceMatrix.needsUpdate = true; }); }
  }
  // beach umbrellas south of the start straight
  {
    const pts = scatter(W, 40, 2, { minD: 4, maxD: 40, seed: 18, pad: 60, test: (x, z) => { const g = W.groundAt(x, z); return g > -0.6 && g < 1.2; } });
    const pole = new THREE.CylinderGeometry(0.06, 0.06, 2.6); pole.translate(0, 1.3, 0);
    const top = new THREE.ConeGeometry(1.7, 0.7, 10); top.translate(0, 2.7, 0);
    const cols = [0xff5a5a, 0xffd21f, 0x29a8ff, 0xffffff];
    instanced(W, mergeGeometries([vcolor(pole, 0xdddddd), vcolor(top, 0xffffff)]), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7 }), pts.map((p, i) => ({ x: p.x, y: W.groundAt(p.x, p.z), z: p.z, color: cols[i % 4] })));
  }
  // stairs shortcut: flower pots and a sign
  for (const P2 of T.paths) if (P2.kind === 'stairs') {
    const pots = [];
    for (let i = 3; i < P2.n - 3; i += 3) for (const s of [1, -1]) pots.push({ x: P2.x[i] + P2.nx[i] * s * (P2.hw[i] + 1.2), y: P2.y[i], z: P2.z[i] + P2.nz[i] * s * (P2.hw[i] + 1.2), color: s > 0 ? 0xe0368a : 0xff8a1f });
    const pot = new THREE.CylinderGeometry(0.5, 0.4, 0.8, 8); pot.translate(0, 0.4, 0);
    const fl = new THREE.IcosahedronGeometry(0.6, 0); fl.translate(0, 1.1, 0);
    instanced(W, mergeGeometries([vcolor(pot, 0xb8663a), vcolor(fl, 0xffffff)]), new THREE.MeshStandardMaterial({ vertexColors: true }), pots);
    signBoard(W, P2, 2, '阶梯近道', 'STAIRS SHORTCUT', '#1f6fe0');
  }
}
function signBoard(W, P, i, zh, en, col) {
  // slide the sign along its path until its posts are well clear of any tunnel mouth
  while (i < P.n - 4 && W.nearTunnel(P.x[i], P.z[i]) < 26) i++;
  const g = textTex([{ text: zh, font: `60px ${FONT_ZH}`, color: '#ffffff', y: 50 }, { text: en, font: `26px ${FONT_EN}`, color: '#ffffff', y: 104 }], { w: 512, h: 128, bg: col });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(P.hw[i] * 2 + 2, 2.2), new THREE.MeshStandardMaterial({ map: g, side: THREE.DoubleSide, emissive: 0xffffff, emissiveMap: g, emissiveIntensity: 0.25 }));
  m.position.set(P.x[i], P.y[i] + 6, P.z[i]); m.rotation.y = Math.atan2(P.tx[i], P.tz[i]) + Math.PI; W.scene.add(m);
  for (const s of [1, -1]) { const post = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 7), new THREE.MeshStandardMaterial({ color: 0x333333 })); post.position.set(P.x[i] + P.nx[i] * s * (P.hw[i] + 1), P.y[i] + 3.5, P.z[i] + P.nz[i] * s * (P.hw[i] + 1)); W.scene.add(post); }
}

// ---- SNOW -----------------------------------------------------------------------------------------
function pineGeo() {
  const parts = [];
  const trunk = new THREE.CylinderGeometry(0.25, 0.35, 2, 6); trunk.translate(0, 1, 0); parts.push(vcolor(trunk, 0x4a3020));
  for (let k = 0; k < 3; k++) {
    const r = 2.6 - k * 0.7, y = 1.6 + k * 1.9;
    const c = new THREE.ConeGeometry(r, 3.2, 8); c.translate(0, y + 1.6, 0); parts.push(vcolor(c, 0x1f4a3a));
    const s = new THREE.ConeGeometry(r * 0.62, 1.2, 8); s.translate(0, y + 2.75, 0); parts.push(vcolor(s, 0xf2f7ff));
  }
  return mergeGeometries(parts);
}
function snow(W) {
  const T = W.T, sc = W.scene, R = rng(31);
  const lake = W.features.find((f) => f.kind === 'lake');
  const notLake = (x, z) => !lake || Math.hypot(x - lake.x, z - lake.z) > 95;
  const trees = scatter(W, 1100, 2.5, { minD: 5, seed: 33, pad: 400, test: (x, z) => notLake(x, z) && W.groundAt(x, z) > -2 });
  instanced(W, pineGeo(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 }), trees.map((t) => ({ x: t.x, y: W.groundAt(t.x, t.z) - 0.3, z: t.z, s: 0.8 + t.r() * 0.9, ry: t.r() * 6 })));
  // rocks
  const rocks = scatter(W, 120, 2, { minD: 5, seed: 35, pad: 300 });
  instanced(W, new THREE.DodecahedronGeometry(2.2, 0), new THREE.MeshStandardMaterial({ color: 0x5d6678, roughness: 0.9, flatShading: true }), rocks.map((r) => ({ x: r.x, y: W.groundAt(r.x, r.z) - 0.4, z: r.z, s: 0.6 + r.r() * 2.2, ry: r.r() * 6, rx: r.r() })));
  // frozen lake
  if (lake) {
    const m = new THREE.MeshPhysicalMaterial({ color: 0xbfe8ff, roughness: 0.05, metalness: 0.0, clearcoat: 1, clearcoatRoughness: 0.05, transparent: true, opacity: 0.85 });
    const disc = new THREE.Mesh(new THREE.CircleGeometry(78, 48), m);
    disc.rotation.x = -Math.PI / 2; disc.position.set(lake.x, -0.1, lake.z); disc.receiveShadow = true; sc.add(disc);
    signBoard(W, lake.P, 3, '冰湖近道', 'FROZEN LAKE', '#1a5fb8');
  }
  // ice crystals near tunnels
  const crystals = [];
  for (const P of T.paths) for (let i = 0; i < P.n; i += 7) if (P.fl[i] & F.TUN) for (const s of [1, -1]) crystals.push({ x: P.x[i] + P.nx[i] * s * (P.hw[i] + 3 + R() * 6), y: P.y[i] + R() * 3, z: P.z[i] + P.nz[i] * s * (P.hw[i] + 3 + R() * 6), s: 1 + R() * 2.5, ry: R() * 6, rx: R() * 0.5 });
  const cm = new THREE.MeshStandardMaterial({ color: 0x9ff0ff, emissive: 0x2ab8ff, emissiveIntensity: GLOW.crystal, roughness: 0.1, transparent: true, opacity: 0.85 });
  instanced(W, new THREE.OctahedronGeometry(1.2, 0).scale(0.6, 1.8, 0.6), cm, crystals, { shadow: false });
  // cabins with warm windows around the start
  const winTex = canvasTex(128, 128, (c, w, h) => { c.fillStyle = '#6b4128'; c.fillRect(0, 0, w, h); for (let y = 0; y < h; y += 16) { c.fillStyle = 'rgba(0,0,0,.2)'; c.fillRect(0, y, w, 3); } c.fillStyle = '#ffcf7a'; c.fillRect(20, 40, 26, 30); c.fillRect(82, 40, 26, 30); });
  const winEmi = canvasTex(128, 128, (c, w, h) => { c.fillStyle = '#000'; c.fillRect(0, 0, w, h); c.fillStyle = '#ffb04a'; c.fillRect(20, 40, 26, 30); c.fillRect(82, 40, 26, 30); });
  const cabMat = new THREE.MeshStandardMaterial({ map: winTex, emissive: 0xffffff, emissiveMap: winEmi, emissiveIntensity: GLOW.cabinWindow, roughness: 0.9 });
  const roofMat = new THREE.MeshStandardMaterial({ color: 0xf4f8ff, roughness: 0.7 });
  const spots = scatter(W, 34, 5, { minD: 8, maxD: 60, seed: 37, pad: 80, test: (x, z) => W.groundAt(x, z) < 8 && notLake(x, z) });
  const walls = [], roofs = [];
  for (const s of spots) {
    const w = 6 + s.r() * 3, d = 5 + s.r() * 3, gy = W.groundAt(s.x, s.z) - 0.4, ry = s.r() * 6;
    walls.push(place(new THREE.BoxGeometry(w, 4, d), s.x, gy + 2, s.z, ry));
    const roof = new THREE.CylinderGeometry(0.01, (w / 2) * 1.2, 3, 4, 1); roof.rotateY(Math.PI / 4); roof.scale(1, 1, d / w);
    roofs.push(place(roof, s.x, gy + 5.5, s.z, ry));
  }
  mergeAdd(W, walls, cabMat); mergeAdd(W, roofs, roofMat);
  // ski lift up the mountain beside the climb
  {
    const P = T.main; let ia = 0, ib = 0;
    for (let i = 0; i < P.n; i++) { if (P.y[i] < P.y[ia]) ia = i; if (P.y[i] > P.y[ib]) ib = i; }
    const A = new V3(P.x[ia] + 60, 0, P.z[ia] - 40), B = new V3(P.x[ib] - 40, 0, P.z[ib] + 60);
    A.y = W.groundAt(A.x, A.z); B.y = W.groundAt(B.x, B.z);
    const towers = [], n = 7;
    for (let k = 0; k <= n; k++) { const p = A.clone().lerp(B, k / n); p.y = W.groundAt(p.x, p.z); if (W.roadDistAll(p.x, p.z) > 6) towers.push({ x: p.x, y: p.y, z: p.z }); }
    const tg = new THREE.CylinderGeometry(0.3, 0.45, 12, 6); tg.translate(0, 6, 0);
    instanced(W, tg, new THREE.MeshStandardMaterial({ color: 0x3a3f4a, metalness: 0.6 }), towers);
    const pts = towers.map((t) => new V3(t.x, t.y + 11.8, t.z));
    if (pts.length > 1) {
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0x222222 })); sc.add(line);
      const chairs = new THREE.InstancedMesh(new THREE.BoxGeometry(1.4, 1.2, 1), new THREE.MeshStandardMaterial({ color: 0xe0283c }), 14);
      chairs.userData.dynamic = true; sc.add(chairs);
      let t = 0; const total = pts.length - 1;
      W.anim.push((dt) => { t += dt * 0.05; for (let c = 0; c < 14; c++) { const u = (t + c / 14) % 1, f = u * total, k = Math.min(total - 1, Math.floor(f)), p = pts[k].clone().lerp(pts[k + 1], f - k); m4.makeTranslation(p.x, p.y - 2, p.z); chairs.setMatrixAt(c, m4); } chairs.instanceMatrix.needsUpdate = true; });
    }
  }
  // flags at the ski jump
  for (const j of T.jumps) {
    const P = T.paths[j.path];
    for (const s of [1, -1]) for (let k = 0; k < 3; k++) {
      const i = wrap(P, j.i - k * 4);
      const x = P.x[i] + P.nx[i] * s * (P.hw[i] + 1.5), z = P.z[i] + P.nz[i] * s * (P.hw[i] + 1.5);
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 5), new THREE.MeshStandardMaterial({ color: 0xcccccc })); post.position.set(x, P.y[i] + 2.5, z); sc.add(post);
      const flag = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1), new THREE.MeshStandardMaterial({ color: k % 2 ? 0x1a5fb8 : 0xe0283c, side: THREE.DoubleSide })); flag.position.set(x, P.y[i] + 4.4, z + 0.8); sc.add(flag);
    }
  }
}

// ---- DESERT ---------------------------------------------------------------------------------------
function sandstoneTex() {
  return canvasTex(256, 256, (c, w, h) => {
    speckle(c, w, h, '#d9b077', 0.16, 2500, 41);
    c.strokeStyle = 'rgba(100,60,20,.35)'; c.lineWidth = 2;
    for (let y = 0; y < h; y += 32) { c.beginPath(); c.moveTo(0, y); c.lineTo(w, y); c.stroke(); for (let x = (y / 32) % 2 ? 24 : 0; x < w; x += 48) { c.beginPath(); c.moveTo(x, y); c.lineTo(x, y + 32); c.stroke(); } }
  }, { repeat: true });
}
function stepPyramid(cx, cz, y0, half, height, steps, ry, topHalf) {
  const g = [];
  for (let k = 0; k < steps; k++) {
    const f = k / steps, hh = height / steps;
    const hs = half + (topHalf - half) * f;
    g.push(place(boxUV(hs * 2, hh + 0.02, hs * 2, 8), cx, y0 + hh * (k + 0.5), cz, ry));
  }
  return g;
}
function smoothPyramid(cx, cz, y0, half, height, ry) {
  const g = new THREE.ConeGeometry(half * Math.SQRT2, height, 4, 1);
  g.rotateY(Math.PI / 4 + ry); g.translate(cx, y0 + height / 2, cz);
  return g;
}
function desert(W) {
  const T = W.T, sc = W.scene, R = rng(51);
  const stone = new THREE.MeshStandardMaterial({ map: sandstoneTex(), roughness: 0.92 });
  const P = T.main;
  // pyramid 1: under the summit the road flies over
  let top = 0; for (let i = 0; i < P.n; i++) if (P.y[i] > P.y[top]) top = i;
  let a = top, e = top; while (P.y[wrap(P, a - 1)] > P.y[top] - 0.6) a = wrap(P, a - 1); while (P.y[wrap(P, e + 1)] > P.y[top] - 0.6) e = wrap(P, e + 1);
  const mid = wrap(P, Math.round((a + (e < a ? e + P.n : e)) / 2));
  const ry = Math.atan2(P.tx[mid], P.tz[mid]);
  const H1 = P.y[top] - 1.2;
  const steps = mergeAdd(W, stepPyramid(P.x[mid], P.z[mid], -2, 52, H1 + 2, 12, ry, 16), stone);
  // the tomb passage runs through this solid pyramid: from inside its tube the step treads showed as false brick
  // floors that hid the kart, so the pyramid is hidden while the camera is in there (the tube hides the rest)
  for (const Q of T.paths) if (Q.kind === 'tomb') W.hideInTube.push({ mesh: steps, P: Q });
  // pyramid 2: the loop tunnels through its base
  const pyr = [], tunRuns = [];
  for (let i = 0; i < P.n; i++) if ((P.fl[i] & F.TUN) && !(P.fl[wrap(P, i - 1)] & F.TUN)) { let k = i; while (P.fl[wrap(P, k + 1)] & F.TUN) k++; tunRuns.push([i, k]); }
  for (const [ta, tb] of tunRuns) {
    const m2 = wrap(P, Math.round((ta + tb) / 2)), len = (tb - ta) * DS;
    const half = len / 2 + 2;
    const g = new THREE.ConeGeometry(half * Math.SQRT2, half * 1.35, 4, 1, true);
    g.rotateY(Math.PI / 4 + Math.atan2(P.tx[m2], P.tz[m2])); g.translate(P.x[m2], P.y[m2] - 1 + half * 0.675, P.z[m2]);
    pyr.push(g);
  }
  mergeAdd(W, pyr, stone);
  // giant pyramids on the horizon
  const b = T.bounds, cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2;
  const giants = [[cx - 520, cz - 380, 150], [cx + 180, cz - 560, 210], [cx + 640, cz + 120, 130]].map(([x, z, s]) => smoothPyramid(x, z, -4, s, s * 1.25, R()));
  const gm = new THREE.MeshStandardMaterial({ color: 0xd8b07a, roughness: 0.95, flatShading: true });
  mergeAdd(W, giants, gm, false);
  // guardian lion statue near the start
  {
    const i = wrap(P, 45), side = 1, off = P.hw[i] + 36; // back on the flat dune top (at +20 it stood on the road-cut slope)
    const x = P.x[i] + P.nx[i] * side * off, z = P.z[i] + P.nz[i] * side * off;
    const r = Math.atan2(P.tx[i], P.tz[i]) + Math.PI / 2 * -side;
    // seat it on the lowest sand under its footprint (the dunes roll along its length, so the centre height left the
    // plinth and paws floating) on a deep plinth that runs under the paws and stays embedded where the sand is higher
    let gy = Infinity;
    for (const lx of [-4, 0, 4]) for (const lz of [-13, -4, 5, 15]) gy = Math.min(gy, W.groundAt(x + lx * Math.cos(r) + lz * Math.sin(r), z - lx * Math.sin(r) + lz * Math.cos(r)));
    gy -= 0.3;
    const parts = [
      place(boxUV(7, 4, 18, 8), 0, 2, -2), place(boxUV(6, 7, 6, 8), 0, 6.5, 6.5), place(boxUV(4.2, 4, 4, 8), 0, 9.5, 9),
      place(boxUV(6.6, 5, 2.2, 8), 0, 9.6, 7.1), place(boxUV(2, 1.4, 8, 8), 2.2, 1.3, 10.5), place(boxUV(2, 1.4, 8, 8), -2.2, 1.3, 10.5), place(boxUV(8.4, 3, 30, 8), 0, -0.9, 1.5)
    ].map((g) => { g.rotateY(r); g.translate(x, gy, z); return g; });
    mergeAdd(W, parts, stone);
  }
  // obelisks along the start straight
  const obs = [];
  for (const k of [20, -20, 60, -60]) {
    const i = wrap(P, k);
    for (const s of [1, -1]) {
      const x = P.x[i] + P.nx[i] * s * (P.hw[i] + 5), z = P.z[i] + P.nz[i] * s * (P.hw[i] + 5);
      const o = new THREE.CylinderGeometry(0.5, 1.2, 14, 4, 1); o.rotateY(Math.PI / 4); o.translate(x, W.groundAt(x, z) + 6.5, z); obs.push(o);
      const tip = new THREE.ConeGeometry(0.72, 1.6, 4); tip.rotateY(Math.PI / 4); tip.translate(x, W.groundAt(x, z) + 14.3, z); obs.push(tip);
    }
  }
  mergeAdd(W, obs, stone);
  // ruins: columns
  const cols = scatter(W, 60, 1.5, { minD: 5, maxD: 70, seed: 53, pad: 60 });
  const colGeo = new THREE.CylinderGeometry(0.9, 1, 1, 12); colGeo.translate(0, 0.5, 0);
  instanced(W, colGeo, stone, cols.map((c) => ({ x: c.x, y: W.groundAt(c.x, c.z) - 0.4, z: c.z, sy: 3 + c.r() * 8, s: 1 })));
  // palms: at the oasis pond and scattered
  const palm = (() => {
    const parts = [];
    for (let k = 0; k < 6; k++) { const c = new THREE.CylinderGeometry(0.28, 0.34, 1.3, 6); c.translate(0.12 * k * k * 0.1, 0.65 + k * 1.25, 0); parts.push(vcolor(c, 0x7a5a36)); }
    for (let k = 0; k < 7; k++) {
      const f = new THREE.BoxGeometry(0.9, 0.08, 4.4); f.translate(0, 0, 2.2); f.rotateX(0.35); f.rotateY((k / 7) * Math.PI * 2); f.translate(0.4, 7.7, 0);
      parts.push(vcolor(f, 0x3e8a3a));
    }
    return mergeGeometries(parts);
  })();
  const pond = W.features.filter((f) => f.kind === 'pond');
  const palms = [];
  for (const f of pond) {
    featWater(W, f, -1.3, waterMat(W, 0x1f8a9a, 0.9, 0.05), 90);
    for (let k = 0; k < 26; k++) { const a = R() * Math.PI * 2, rr = 36 + R() * 30; const x = f.x + Math.cos(a) * rr * 1.3, z = f.z + Math.sin(a) * rr; if (W.roadDistAll(x, z) > 4) palms.push({ x, y: W.groundAt(x, z) - 0.3, z, s: 0.8 + R() * 0.5, ry: R() * 6 }); }
  }
  for (const p of scatter(W, 30, 2, { minD: 6, maxD: 90, seed: 57, pad: 100 })) palms.push({ x: p.x, y: W.groundAt(p.x, p.z) - 0.3, z: p.z, s: 0.8 + p.r() * 0.5, ry: p.r() * 6 });
  instanced(W, palm, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, side: THREE.DoubleSide }), palms);
  // dune grass tufts
  const tufts = scatter(W, 300, 0.5, { minD: 3, maxD: 120, seed: 59, pad: 150 });
  const tg = new THREE.ConeGeometry(0.6, 1.2, 5); tg.translate(0, 0.5, 0);
  instanced(W, vcolor(tg, 0x9a8a4a), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }), tufts.map((t) => ({ x: t.x, y: W.groundAt(t.x, t.z) - 0.2, z: t.z, s: 0.6 + t.r() })), { shadow: false });
  // tomb shortcut torches + sign
  for (const P2 of T.paths) if (P2.kind === 'tomb') {
    const torches = [];
    for (let i = 2; i < P2.n - 2; i += 5) if (P2.fl[i] & F.TUN) for (const s of [1, -1]) torches.push({ x: P2.x[i] + P2.nx[i] * s * (P2.hw[i] + 0.2), y: P2.y[i] + 3.2, z: P2.z[i] + P2.nz[i] * s * (P2.hw[i] + 0.2) });
    instanced(W, new THREE.SphereGeometry(0.2, 8, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.45, 0.12).multiplyScalar(GLOW.torch) }), torches, { shadow: false });
    signBoard(W, P2, 3, '墓道近道', 'TOMB PASSAGE', '#8a3a1a');
  }
}
