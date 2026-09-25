// A pelican-sized single-speed roadster: lugged diamond frame in candy-red clearcoat,
// chrome bars/fenders/cranks, 32-spoke 3-cross wheels on gum-wall tyres, a moving 1/2" chain.
// Bike-local: origin on the ground under the bottom bracket, +z forward, +y up, +x left.
import { THREE, V3, TAU, lerp, clamp, smooth, rng, canvas, dataTex, normalFromHeight, mesh, tubeGeo, tfbm, MAX_ANISO, bakeStatic } from './core.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// ---------------------------------------------------------------- geometry (metres)
export const G = {
  R: 0.30, tyreR: 0.018, rimR: 0.266,
  BB: new V3(0, 0.265, 0), RA: new V3(0, 0.30, -0.40), FA: new V3(0, 0.30, 0.58),
  htAxis: new V3(0, Math.sin(72 * Math.PI / 180), -Math.cos(72 * Math.PI / 180)),
  stAxis: new V3(0, Math.sin(73 * Math.PI / 180), -Math.cos(73 * Math.PI / 180)),
  crank: 0.105, ring: 44, cog: 16, pitch: 0.0127, chainX: -0.043, pedalX: 0.092,
};
G.ringR = G.ring * G.pitch / TAU; G.cogR = G.cog * G.pitch / TAU; G.ratio = G.ring / G.cog;
// steering axis passes 55 mm behind the front axle at axle height (fork offset). The head tube starts high
// enough for the fork crown to clear the front fender: at 0.44 m the crown, the lower head tube and the down tube
// sat inside the wheel, and the tyre ran through the head tube.
{
  const s = (0.63 - G.FA.y) / G.htAxis.y;
  G.HB = new V3(0, 0.63, G.FA.z - 0.055 + G.htAxis.z * s);
}
G.HT = G.HB.clone().addScaledVector(G.htAxis, 0.06);
G.ST = G.BB.clone().addScaledVector(G.stAxis, 0.27);
G.SP = G.ST.clone().addScaledVector(G.stAxis, 0.05);
G.saddle = new V3(0, G.SP.y + 0.034, G.SP.z - 0.004);
G.stem = G.HT.clone().addScaledVector(G.htAxis, 0.04);
// the bars' reference point, where the clamp used to be: the bars drop back to the grips at the same place, which
// the wings' IK pose was tuned to
G.bars = new V3(0, 0.617, 0.474);

// ---------------------------------------------------------------- textures
function flakeNormal() {
  const N = 256, R = rng(77), hts = new Float32Array(N * N);
  for (let i = 0; i < N * N; i++) hts[i] = R();
  return normalFromHeight(hts, N, N, 0.35);
}
function treadTextures() {
  // u: around the wheel (1/12 of the circumference per tile), v: around the tyre section (v=0/1 is the crown)
  const W = 128, H = 256, hts = new Float32Array(W * H), c = canvas(W, H), g = c.getContext('2d'), img = g.createImageData(W, H), d = img.data;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const v = y / H, a = Math.min(v, 1 - v) * 2; // 0 at the crown, 1 at the inner side
    let h = 0.5;
    if (a < 0.32) { // chevron tread blocks
      const s = a / 0.32, u = x / W * 6 + s * 1.2 * (v < 0.5 ? 1 : -1);
      const blk = (u - Math.floor(u)) < 0.62 ? 1 : 0;
      h = blk * (1 - smooth(0.85, 1, s)) * 0.9 + 0.1;
      // siping
      h -= 0.15 * (Math.abs(((u * 2) % 1) - 0.5) < 0.04 ? 1 : 0);
    } else if (a < 0.36) h = 0.2; // bead line
    else h = 0.5 + 0.05 * Math.sin(x / W * TAU * 24);
    hts[y * W + x] = h;
    const i = (y * W + x) * 4;
    let r = 28, gg = 26, b = 24;
    if (a > 0.34 && a < 0.8) { r = 196; gg = 150; b = 102; } // tan gum wall
    if (a > 0.335 && a < 0.35) { r = 60; gg = 50; b = 40; }
    const n = 0.9 + 0.1 * tfbm(x / 16, y / 16, W / 16, 3);
    d[i] = r * n; d[i + 1] = gg * n; d[i + 2] = b * n; d[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const map = new THREE.CanvasTexture(c); map.colorSpace = THREE.SRGBColorSpace; map.wrapS = map.wrapT = THREE.RepeatWrapping; map.anisotropy = MAX_ANISO;
  return { map, normal: normalFromHeight(hts, W, H, 3) };
}
function decalTex() {
  const c = canvas(1024, 128), g = c.getContext('2d');
  g.fillStyle = '#a3122a'; g.fillRect(0, 0, 1024, 128);
  g.font = 'italic 700 40px Georgia, serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  for (const y of [32, 96]) {
    g.save(); g.translate(560, y); if (y > 64) g.scale(-1, -1);
    g.fillStyle = '#f5e7c8'; g.fillText('Pelican', 0, 0);
    g.fillStyle = '#e8c36a'; g.fillRect(-120, 16, 240, 2.5); g.restore();
  }
  // thin gold pinstripe bands near the lugs
  g.fillStyle = '#e8c36a'; g.fillRect(40, 0, 3, 128); g.fillRect(980, 0, 3, 128);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = MAX_ANISO; return t;
}
function leatherNormal() {
  const N = 128, hts = new Float32Array(N * N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) hts[y * N + x] = tfbm(x / 8, y / 8, N / 8, 4);
  return normalFromHeight(hts, N, N, 2.2);
}

// ---------------------------------------------------------------- materials
function mats() {
  const flake = flakeNormal(); flake.repeat.set(30, 3);
  const paint = new THREE.MeshPhysicalMaterial({ color: 0xa3122a, metalness: 0.45, roughness: 0.36, clearcoat: 1, clearcoatRoughness: 0.035, normalMap: flake, normalScale: new THREE.Vector2(0.25, 0.25), sheen: 0.2, sheenColor: new THREE.Color(0xff5060) });
  const decal = paint.clone(); decal.color = new THREE.Color(0xffffff); decal.map = decalTex(); decal.normalMap = null;
  // polished, not a mirror (at 0.08 every sun glint was a pinpoint thousands of times brighter than the sky); only
  // parts that hold still relative to the sun stay chrome, the moving ones are satin (below)
  const chrome = new THREE.MeshStandardMaterial({ color: 0xf4f4f6, metalness: 1, roughness: 0.17 });
  const alu = new THREE.MeshStandardMaterial({ color: 0xd8dadf, metalness: 1, roughness: 0.28 });
  // satin alloy for the parts that turn with the pedals: flat polished faces going round flashed the sun twice a
  // revolution, like a blinking light
  const satin = new THREE.MeshStandardMaterial({ color: 0xcfd2d8, metalness: 1, roughness: 0.5 });
  const steel = new THREE.MeshStandardMaterial({ color: 0xb8bcc4, metalness: 1, roughness: 0.22 });
  const chain = new THREE.MeshStandardMaterial({ color: 0x5c5a58, metalness: 0.9, roughness: 0.38 });
  const t = treadTextures(); t.map.repeat.set(12, 1); t.normal.repeat.set(12, 1);
  const tyre = new THREE.MeshStandardMaterial({ map: t.map, normalMap: t.normal, normalScale: new THREE.Vector2(1.2, 1.2), roughness: 0.82 });
  const ln = leatherNormal();
  const leather = new THREE.MeshPhysicalMaterial({ color: 0x7a4322, roughness: 0.48, clearcoat: 0.35, clearcoatRoughness: 0.35, normalMap: ln, normalScale: new THREE.Vector2(0.4, 0.4), sheen: 0.3, sheenColor: new THREE.Color(0xc07a4a) });
  const grip = leather.clone(); grip.color = new THREE.Color(0x5a2e16);
  const black = new THREE.MeshStandardMaterial({ color: 0x1c1c1e, roughness: 0.55, metalness: 0.2 });
  // a fluted (frosted) lens: it glows when the lamp is on, and a low sun can't turn it into a mirror that looks lit
  const lens = new THREE.MeshPhysicalMaterial({ color: 0xfff6e0, roughness: 0.3, transmission: 0, emissive: 0xffe2a8, emissiveIntensity: 0, clearcoat: 0.3, clearcoatRoughness: 0.3 });
  const red = new THREE.MeshPhysicalMaterial({ color: 0x9a0a10, roughness: 0.2, emissive: 0xff1a10, emissiveIntensity: 0, clearcoat: 1 });
  return { paint, decal, chrome, alu, satin, steel, chain, tyre, leather, grip, black, lens, red };
}

// tube along a smooth path through points (CatmullRom), radius r (optionally tapering to r2)
function pathTube(pts, r, r2 = r, seg = 24, rs = 14) {
  const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
  const g = new THREE.TubeGeometry(curve, seg, r, rs, false);
  if (r2 !== r) {
    const p = g.attributes.position, n = g.attributes.normal;
    for (let i = 0; i <= seg; i++) {
      const k = r2 / r, s = lerp(1, k, i / seg), c = curve.getPointAt(i / seg);
      for (let j = 0; j <= rs; j++) { const idx = i * (rs + 1) + j; p.setXYZ(idx, c.x + (p.getX(idx) - c.x) * s, c.y + (p.getY(idx) - c.y) * s, c.z + (p.getZ(idx) - c.z) * s); }
    }
    g.computeVertexNormals();
  }
  return g;
}
const Lc = (a, b, t) => new V3().lerpVectors(a, b, t);
const _n = new V3();

export class Bike {
  constructor() {
    const M = this.M = mats();
    this.group = new THREE.Group(); this.group.name = 'bike';
    this.pitchPivot = new THREE.Group(); this.group.add(this.pitchPivot); // wheelie pivot at the rear axle, so the tyre rolls rather than digs in
    this.pitchPivot.position.copy(G.RA);
    this.frame = new THREE.Group(); this.frame.position.copy(G.RA).negate(); this.pitchPivot.add(this.frame);
    this.buildFrame(); this.buildWheels(); this.buildDrivetrain(); this.buildFront(); this.buildSaddle();
    this.crank = Math.PI * 0.5; this.wheelA = 0; this.cogA = 0; this.steer = 0; this.lightsOn = 0;
    this.frame.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    // spokes share the rim's metal so each wheel bakes into fewer draws
    for (const w of this.wheels) w.traverse((o) => { if (o.isMesh && o.material === M.steel) o.material = M.alu; });
    const moving = new Set([this.wheels[0], this.wheels[1], this.cranks, this.ring, this.cogG, this.chain, this.steerPivot, this.bell, this.lamp]);
    bakeStatic(this.frame, (o) => moving.has(o));
    bakeStatic(this.steerAssembly, (o) => moving.has(o));
    for (const w of this.wheels) bakeStatic(w);
    for (const p of this.pedals) bakeStatic(p.body);
    bakeStatic(this.cranks, (o) => this.pedals.some((p) => p.p === o || p.body === o));
  }

  buildFrame() {
    const M = this.M, f = this.frame;
    const BB = G.BB, ST = G.ST, HT = G.HT, HB = G.HB, RA = G.RA;
    const ttA = ST.clone().addScaledVector(G.stAxis, -0.012), ttB = HT.clone().addScaledVector(G.htAxis, -0.018);
    const dtB = HB.clone().addScaledVector(G.htAxis, 0.02);
    const geos = [];
    geos.push(pathTube([ttA, Lc(ttA, ttB, 0.5).add(new V3(0, 0.004, 0)), ttB], 0.0135, 0.0135, 16, 16)); // top tube
    geos.push(pathTube([ST.clone().addScaledVector(G.stAxis, 0.035), BB.clone().addScaledVector(G.stAxis, -0.01)], 0.0145, 0.0145, 4, 16)); // seat tube
    geos.push(pathTube([HB.clone().addScaledVector(G.htAxis, -0.012), HT.clone().addScaledVector(G.htAxis, 0.012)], 0.0175, 0.0175, 4, 18)); // head tube
    // stays, split left/right
    for (const sd of [1, -1]) {
      const drop = RA.clone().add(new V3(sd * 0.058, 0.004, 0.01));
      geos.push(pathTube([BB.clone().add(new V3(sd * 0.02, -0.004, -0.02)), BB.clone().add(new V3(sd * 0.045, 0.012, -0.16)), drop], 0.0085, 0.0065, 18, 10));
      geos.push(pathTube([ST.clone().add(new V3(sd * 0.018, -0.012, -0.004)), Lc(ST, RA, 0.5).add(new V3(sd * 0.05, 0, 0)), drop.clone().add(new V3(0, 0.012, 0.006))], 0.0075, 0.0062, 18, 10));
      // dropout plate
      const dp = new THREE.CylinderGeometry(0.014, 0.014, 0.005, 16).rotateZ(Math.PI / 2); dp.translate(drop.x, drop.y, drop.z); geos.push(dp);
    }
    // lugs: short, slightly fatter sleeves at the joints
    const lug = (p, axis, r, len) => { const g = new THREE.CylinderGeometry(r, r, len, 18); g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new V3(0, 1, 0), axis)); g.translate(p.x, p.y, p.z); geos.push(g); };
    lug(ST.clone().addScaledVector(G.stAxis, 0.0), G.stAxis, 0.0168, 0.05);
    lug(HT, G.htAxis, 0.0198, 0.03); lug(HB, G.htAxis, 0.0198, 0.03);
    const bbShell = new THREE.CylinderGeometry(0.021, 0.021, 0.075, 20).rotateZ(Math.PI / 2); bbShell.translate(BB.x, BB.y, BB.z); geos.push(bbShell);
    const frame = mesh(mergeGeometries(geos.map((g) => g.index ? g.toNonIndexed() : g).map(stripUV)), M.paint); frame.name = 'frame';
    f.add(frame);
    // down tube carries the decal
    const dtg = pathTube([BB.clone().addScaledVector(new V3().subVectors(dtB, BB).normalize(), 0.012), dtB], 0.0165, 0.0165, 8, 24);
    const dt = mesh(dtg, M.decal); f.add(dt);
    // seat post, chrome
    f.add(mesh(tubeGeo(ST.clone().addScaledVector(G.stAxis, 0.02), G.SP, 0.0105), M.chrome));
    // rear fender + stays, rear reflector
    this.rearFender = this.fender(RA, -0.65, 1.9); f.add(this.rearFender);
    // seated on the fender's outer skin (r = G.R + 0.014) at a = -1.2, its thin axis radial (it used to float 2 cm off it)
    const ra = -1.2, rr = G.R + 0.014 + 0.004;
    this.tail = mesh(new THREE.BoxGeometry(0.03, 0.018, 0.012), M.red); this.tail.position.copy(RA).add(new V3(0, Math.cos(ra) * rr, Math.sin(ra) * rr)); this.tail.rotation.x = ra - Math.PI / 2; f.add(this.tail);
    // kickstand (folded)
    f.add(mesh(tubeGeo(BB.clone().add(new V3(-0.03, -0.01, -0.05)), BB.clone().add(new V3(-0.04, 0.0, -0.26)), 0.005, 0.004, 8), M.alu));
  }
  // chrome fender arc over a wheel centred at c, from angle a0 spanning `span` radians (0 = straight up, + towards the front)
  fender(c, a0, span) {
    const segs = 30, r = G.R + 0.014, w = 0.028, pos = [], idx = [], uv = [];
    for (let i = 0; i <= segs; i++) {
      const a = a0 + span * (i / segs) * -1 + span * 0.5;
      const y = Math.cos(a) * r, z = Math.sin(a) * r;
      for (let j = 0; j <= 6; j++) { const u = j / 6 - 0.5, dy = -(u * u) * 0.03; pos.push(u * w * 1.8, y + dy * Math.cos(a), z + dy * Math.sin(a)); uv.push(i / segs * 4, j / 6); }
    }
    for (let i = 0; i < segs; i++) for (let j = 0; j < 6; j++) { const a = i * 7 + j, b = a + 7; idx.push(a, b, a + 1, b, b + 1, a + 1); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
    // satin enamel in the frame's red: a broad curved chrome (or glossy clearcoat) fender caught a low sun as a
    // star that swelled and shrank with every bump, and read as a light flashing on the bike
    this.fenderMat = this.fenderMat || new THREE.MeshStandardMaterial({ color: 0x9a1026, metalness: 0, roughness: 0.55, side: THREE.DoubleSide });
    const m = mesh(g, this.fenderMat);
    m.position.copy(c);
    return m;
  }

  buildWheels() {
    const M = this.M;
    const wheelGeo = () => {
      const rim = new THREE.TorusGeometry(G.rimR - 0.004, 0.0085, 10, 96);
      rim.scale(1, 1, 1.25);
      const hub = new THREE.CylinderGeometry(0.014, 0.014, 0.1, 18).rotateZ(Math.PI / 2);
      const fl = [new THREE.CylinderGeometry(0.026, 0.026, 0.004, 24).rotateZ(Math.PI / 2).translate(0.03, 0, 0), new THREE.CylinderGeometry(0.026, 0.026, 0.004, 24).rotateZ(Math.PI / 2).translate(-0.03, 0, 0)];
      // 32 spokes, 3-cross, alternating flanges; rim holes 11.25° apart
      const spokes = [];
      for (const sd of [1, -1]) for (let j = 0; j < 16; j++) {
        const ah = TAU * j / 16 + (sd < 0 ? Math.PI / 16 : 0), ar = ah + (j % 2 ? -1 : 1) * 1.178;
        const a = new V3(sd * 0.03, Math.cos(ah) * 0.023, Math.sin(ah) * 0.023), b = new V3(sd * 0.004, Math.cos(ar) * (G.rimR - 0.01), Math.sin(ar) * (G.rimR - 0.01));
        spokes.push(tubeGeo(a, b, 0.0011, 0.0011, 5));
        const nip = tubeGeo(b, b.clone().multiplyScalar(0.97).setX(b.x), 0.0022, 0.0022, 6); spokes.push(nip);
      }
      rim.rotateY(Math.PI / 2);
      return { rim, hub: mergeGeometries([hub, ...fl].map(stripUV)), spokes: mergeGeometries(spokes.map(stripUV)) };
    };
    const w = wheelGeo();
    const tyreGeo = new THREE.TorusGeometry(G.R - G.tyreR, G.tyreR, 20, 160).rotateY(Math.PI / 2);
    const valve = tubeGeo(new V3(0, G.rimR - 0.012, 0), new V3(0, G.rimR - 0.04, 0), 0.0025);
    this.wheels = [G.RA, G.FA].map((c, i) => {
      const g = new THREE.Group(); g.position.copy(c);
      g.add(mesh(w.rim, M.alu), mesh(w.hub, M.chrome), mesh(w.spokes, M.steel), mesh(tyreGeo, M.tyre), mesh(valve, M.black));
      return g;
    });
    this.frame.add(this.wheels[0]);
  }

  buildDrivetrain() {
    const M = this.M, f = this.frame;
    // chainring with 44 teeth and a 5-arm spider cut-out
    const ringShape = (teeth, r, rootDepth, holes) => {
      const s = new THREE.Shape(), n = teeth * 4;
      for (let i = 0; i <= n; i++) {
        const a = i / n * TAU, ph = (i % 4), rr = ph === 0 || ph === 1 ? r + 0.0028 : r - rootDepth;
        const x = Math.cos(a) * rr, y = Math.sin(a) * rr; if (i === 0) s.moveTo(x, y); else s.lineTo(x, y);
      }
      if (holes) for (let k = 0; k < 5; k++) {
        const h = new THREE.Path(), a0 = k / 5 * TAU + 0.2, a1 = a0 + TAU / 5 - 0.4;
        h.absarc(0, 0, r * 0.82, a0, a1, false); h.absarc(0, 0, r * 0.38, a1, a0, true); s.holes.push(h);
      }
      return s;
    };
    const ex = (shape, depth) => new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelThickness: 0.0008, bevelSize: 0.0006, bevelSegments: 1, curveSegments: 6 }).translate(0, 0, -depth / 2).rotateY(Math.PI / 2);
    this.ring = new THREE.Group(); this.ring.position.copy(G.BB).setX(G.chainX); f.add(this.ring);
    this.ring.add(mesh(ex(ringShape(G.ring, G.ringR, 0.004, true), 0.003), M.satin));
    this.ring.add(mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.012, 20).rotateZ(Math.PI / 2), M.satin));
    // crank arms (satin alloy) + spindle + pedals
    this.cranks = new THREE.Group(); this.cranks.position.copy(G.BB); f.add(this.cranks);
    this.cranks.add(mesh(new THREE.CylinderGeometry(0.009, 0.009, G.pedalX * 2 - 0.03, 12).rotateZ(Math.PI / 2), M.steel));
    const armGeo = (sd) => {
      const s = new THREE.Shape(); s.moveTo(-0.014, 0); s.quadraticCurveTo(0, -0.02, 0.014, 0); s.lineTo(0.009, G.crank); s.quadraticCurveTo(0, G.crank + 0.012, -0.009, G.crank); s.closePath();
      return new THREE.ExtrudeGeometry(s, { depth: 0.008, bevelEnabled: true, bevelThickness: 0.002, bevelSize: 0.002, bevelSegments: 2 }).translate(0, 0, -0.004).rotateY(Math.PI / 2).translate(sd * (G.pedalX - 0.028), 0, 0);
    };
    this.pedals = [];
    for (const sd of [1, -1]) {
      const arm = new THREE.Group(); arm.rotation.x = sd > 0 ? Math.PI : 0; this.cranks.add(arm);
      arm.add(mesh(armGeo(sd), M.satin));
      const p = new THREE.Group(); p.position.set(sd * G.pedalX, G.crank, 0); arm.add(p);
      // platform pedal: black body with a satin alloy cage
      const body = new THREE.Group(); p.add(body);
      body.add(mesh(new THREE.BoxGeometry(0.058, 0.012, 0.07), M.black));
      for (const z of [-0.036, 0.036]) body.add(mesh(new THREE.BoxGeometry(0.066, 0.016, 0.005), M.satin).translateZ(z));
      body.add(mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.07, 8).rotateZ(Math.PI / 2), M.steel).translateX(-sd * 0.01));
      body.position.x = sd * 0.012;
      this.pedals.push({ sd, arm, p, body });
    }
    // rear cog
    this.cogG = new THREE.Group(); this.cogG.position.copy(G.RA).setX(G.chainX); f.add(this.cogG);
    this.cogG.add(mesh(ex(ringShape(G.cog, G.cogR, 0.0035, false), 0.0035), M.steel));
    // chain: instanced links along the closed ring->cog path
    this.buildChain();
  }
  buildChain() {
    const C1 = new THREE.Vector2(G.BB.z, G.BB.y), C2 = new THREE.Vector2(G.RA.z, G.RA.y), r1 = G.ringR + 0.001, r2 = G.cogR + 0.001;
    const d = C2.clone().sub(C1).length(), e = C2.clone().sub(C1).divideScalar(d), p = new THREE.Vector2(-e.y, e.x); // p: 90° CCW
    const sb = (r1 - r2) / d, cb = Math.sqrt(1 - sb * sb);
    const nT = p.clone().multiplyScalar(cb).add(e.clone().multiplyScalar(sb));
    const nB = p.clone().multiplyScalar(-cb).add(e.clone().multiplyScalar(sb));
    // orient p upwards
    if (nT.y < 0) { const t = nT.clone(); nT.copy(nB); nB.copy(t); }
    const T1 = C1.clone().addScaledVector(nT, r1), T2 = C2.clone().addScaledVector(nT, r2), B2 = C2.clone().addScaledVector(nB, r2), B1 = C1.clone().addScaledVector(nB, r1);
    const ang = (v) => Math.atan2(v.y, v.x);
    const aT2 = ang(nT), aB2 = ang(nB);
    // cog arc goes around the back (through angle PI), ring arc around the front (through 0)
    let cogSpan = aB2 - aT2; if (cogSpan < 0) cogSpan += TAU; // CCW from top to bottom via the back
    let ringSpan = aT2 - aB2; if (ringSpan < 0) ringSpan += TAU;
    const segs = [
      { k: 'l', a: T1, b: T2, len: T1.distanceTo(T2) },
      { k: 'a', c: C2, r: r2, a0: aT2, span: cogSpan, len: r2 * cogSpan },
      { k: 'l', a: B2, b: B1, len: B2.distanceTo(B1) },
      { k: 'a', c: C1, r: r1, a0: aB2, span: ringSpan, len: r1 * ringSpan },
    ];
    const total = segs.reduce((s, x) => s + x.len, 0);
    const n = Math.round(total / G.pitch);
    this.chainPath = { segs, total, n, step: total / n };
    // link: two side plates (figure-8 outline) + roller
    const sh = new THREE.Shape(); const L = G.pitch, rr = 0.0042;
    sh.absarc(-L / 2, 0, rr, Math.PI / 2, Math.PI * 1.5, false); sh.quadraticCurveTo(0, -rr * 0.55, L / 2, -rr); sh.absarc(L / 2, 0, rr, -Math.PI / 2, Math.PI / 2, false); sh.quadraticCurveTo(0, rr * 0.55, -L / 2, rr);
    const plate = (x) => new THREE.ExtrudeGeometry(sh, { depth: 0.0009, bevelEnabled: false, curveSegments: 5 }).rotateY(Math.PI / 2).translate(x, 0, 0);
    const roller = new THREE.CylinderGeometry(0.0034, 0.0034, 0.0062, 8).rotateZ(Math.PI / 2).translate(0, 0, -L / 2);
    const lg = mergeGeometries([plate(0.0035), plate(-0.0044), roller].map((g) => stripUV(g.index ? g.toNonIndexed() : g)));
    this.chain = new THREE.InstancedMesh(lg, this.M.chain, n); this.chain.castShadow = true; this.chain.frustumCulled = false;
    this.chain.position.x = G.chainX; this.frame.add(this.chain);
    this._cm = new THREE.Matrix4(); this._cq = new THREE.Quaternion(); this._cp = new V3(); this._one = new V3(1, 1, 1);
    this.updateChain(0);
  }
  chainAt(s, out) { // returns [z, y, angle]
    const P = this.chainPath; s = ((s % P.total) + P.total) % P.total;
    for (const g of P.segs) {
      if (s <= g.len) {
        if (g.k === 'l') { const t = s / g.len; out[0] = lerp(g.a.x, g.b.x, t); out[1] = lerp(g.a.y, g.b.y, t); out[2] = Math.atan2(g.b.y - g.a.y, g.b.x - g.a.x); }
        else { const a = g.a0 + s / g.r; out[0] = g.c.x + Math.cos(a) * g.r; out[1] = g.c.y + Math.sin(a) * g.r; out[2] = a + Math.PI / 2; }
        return out;
      }
      s -= g.len;
    }
    return out;
  }
  updateChain(offset) {
    const P = this.chainPath, o = [0, 0, 0];
    for (let i = 0; i < P.n; i++) {
      this.chainAt(offset + i * P.step, o);
      // link axis is along z in link space; path angle is measured in the (z,y) plane
      this._cq.setFromAxisAngle(new V3(1, 0, 0), -o[2]);
      this._cm.compose(this._cp.set(0, o[1], o[0]), this._cq, this._one);
      this.chain.setMatrixAt(i, this._cm);
    }
    this.chain.instanceMatrix.needsUpdate = true;
  }

  buildFront() {
    const M = this.M;
    // steering assembly rotates about the head-tube axis
    this.steerPivot = new THREE.Group(); this.steerPivot.position.copy(G.HB); this.frame.add(this.steerPivot);
    const local = (v) => v.clone().sub(G.HB);
    const s = new THREE.Group(); this.steerAssembly = s; this.steerPivot.add(s);
    const FA = local(G.FA), crown = local(G.HB.clone().addScaledVector(G.htAxis, -0.03));
    // fork: steerer + crown + raked blades
    const geos = [];
    geos.push(tubeGeo(crown, local(G.HT), 0.011)); // ends inside the head lug: running on up it shared the chrome stem's exact cylinder and z-fought
    const crownG = new THREE.BoxGeometry(0.09, 0.018, 0.03); crownG.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new V3(0, 1, 0), G.htAxis)); crownG.translate(crown.x, crown.y, crown.z); geos.push(crownG);
    for (const sd of [1, -1]) {
      const top = crown.clone().add(new V3(sd * 0.038, -0.005, 0)), end = FA.clone().add(new V3(sd * 0.05, 0.004, 0.004));
      const mid = top.clone().lerp(end, 0.55).addScaledVector(G.htAxis, 0).add(new V3(0, 0, -0.012));
      const bend = end.clone().add(new V3(0, 0.05, -0.02));
      geos.push(pathTube([top, mid, bend, end], 0.009, 0.0065, 18, 10));
      const dp = new THREE.CylinderGeometry(0.012, 0.012, 0.005, 14).rotateZ(Math.PI / 2); dp.translate(end.x, end.y, end.z); geos.push(dp);
    }
    s.add(mesh(mergeGeometries(geos.map((g) => stripUV(g.index ? g.toNonIndexed() : g))), M.paint));
    // front wheel + fender
    const fw = this.wheels[1]; fw.position.copy(FA); s.add(fw);
    const ff = this.fender(FA, 0.4, 1.6); s.add(ff);
    // stem + swept-back bars + leather grips
    const stemTop = local(G.stem), stemFwd = stemTop.clone().add(new V3(0, -0.01, 0.06)), bars = local(G.bars);
    // (satin, like the cranks: right behind the headlamp, a sun glint here read as the lamp flashing)
    s.add(mesh(tubeGeo(local(G.HT), stemTop, 0.011), M.satin));
    s.add(mesh(tubeGeo(stemTop, stemFwd, 0.009), M.satin));
    s.add(mesh(new THREE.CylinderGeometry(0.013, 0.013, 0.04, 14).rotateZ(Math.PI / 2).translate(stemFwd.x, stemFwd.y, stemFwd.z), M.satin));
    this.grips = [];
    for (const sd of [1, -1]) {
      // swept back and down from the clamp to the grips
      const p0 = stemFwd, p1 = p0.clone().add(new V3(sd * 0.09, -0.008, 0.0)), p2 = bars.clone().add(new V3(sd * 0.17, 0.022, -0.045));
      const pts = [p0, p1, p2, bars.clone().add(new V3(sd * 0.205, 0.028, -0.12)), bars.clone().add(new V3(sd * 0.212, 0.03, -0.2))];
      s.add(mesh(pathTube(pts, 0.0105, 0.0105, 30, 12), M.satin)); // satin: the bars wobble with the steering, and a chrome glint on them blinked
      if (sd > 0) this.bellAt = p1.clone().lerp(p2, 0.5);
      const ga = bars.clone().add(new V3(sd * 0.208, 0.029, -0.13)), gb = bars.clone().add(new V3(sd * 0.213, 0.03, -0.205));
      s.add(mesh(tubeGeo(ga, gb, 0.0155, 0.0155, 14), M.grip));
      s.add(mesh(new THREE.SphereGeometry(0.0158, 12, 8).translate(gb.x, gb.y, gb.z), M.grip));
      const gc = new THREE.Object3D(); gc.position.lerpVectors(ga, gb, 0.45); s.add(gc);
      this.grips.push(gc);
    }
    // bell (left, just inboard of the grip)
    this.bell = new THREE.Group(); this.bell.position.copy(this.bellAt).add(new V3(0, 0.018, -0.02)); s.add(this.bell);
    this.bell.add(mesh(new THREE.SphereGeometry(0.022, 20, 10, 0, TAU, 0, Math.PI / 2).scale(1, 0.75, 1).translate(0, 0.012, 0), M.alu)); // brushed: a chrome dome catches the sun from every angle
    this.bell.add(mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.012, 10), M.chrome));
    this.striker = mesh(new THREE.BoxGeometry(0.004, 0.004, 0.022), M.chrome); this.striker.position.set(0.018, 0.006, -0.008); this.bell.add(this.striker);
    // headlamp on a bracket in front of the bar clamp, well above the tyre: bucket + glowing lens + spot light for
    // the road. (It used to sit on a fork crown inside the wheel, and its light strobed through the spinning spokes.)
    this.lamp = new THREE.Group(); this.lamp.position.copy(stemFwd).add(new V3(0, -0.012, 0.052)); s.add(this.lamp);
    const bucket = new THREE.CylinderGeometry(0.026, 0.021, 0.045, 20).rotateX(Math.PI / 2);
    this.lamp.add(mesh(bucket, M.black)); // black enamel: a chrome bucket's sun glint read as the lamp flicking on
    this.lens = mesh(new THREE.CircleGeometry(0.024, 20).translate(0, 0, 0.0226), M.lens); this.lamp.add(this.lens);
    this.lamp.add(mesh(tubeGeo(new V3(0, 0, -0.02), new V3(0, 0.012, -0.052), 0.004), M.black));
    // aimed a few degrees down with a tight cone, so it lights the road ahead but never the wheel or fender below it
    this.spot = new THREE.SpotLight(0xffe0b0, 0, 28, 0.3, 0.45, 1.6); this.spot.position.set(0, 0, 0.03);
    this.spot.target.position.set(0, -0.35, 6); this.lamp.add(this.spot, this.spot.target);
  }

  buildSaddle() {
    const M = this.M;
    // sprung leather saddle: domed top over a pear-shaped outline, riveted cantle, chrome springs
    const U = 24, Vn = 14, pos = [], idx = [], uv = [];
    const outline = (u) => { const nose = 0.022, rear = 0.075; return lerp(nose, rear, smooth(0.1, 0.85, 1 - u)) * (u < 0.05 ? 0.7 + u * 6 : 1); };
    for (let i = 0; i <= U; i++) {
      const u = i / U, z = lerp(-0.1, 0.11, u), w = outline(u);
      for (let j = 0; j <= Vn; j++) {
        const v = j / Vn * 2 - 1;
        const skirt = Math.abs(v) > 0.8 ? (Math.abs(v) - 0.8) / 0.2 : 0;
        const x = v * w * (1 - skirt * 0.08), y = 0.02 * (1 - v * v) * (1 - 0.3 * u) - skirt * 0.028 + 0.01 * Math.sin(u * Math.PI) - 0.012 * u * u;
        pos.push(x, y, z); uv.push(u * 2, j / Vn);
      }
    }
    for (let i = 0; i < U; i++) for (let j = 0; j < Vn; j++) { const a = i * (Vn + 1) + j, b = a + Vn + 1; idx.push(a, a + 1, b, b, a + 1, b + 1); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
    const sad = new THREE.Group(); sad.position.copy(G.saddle).add(new V3(0, -0.028, 0)); this.frame.add(sad);
    M.leather.side = THREE.DoubleSide; const top = mesh(g, M.leather); sad.add(top);
    for (let k = 0; k < 5; k++) { const a = (k / 4 - 0.5) * 2.2, r = mesh(new THREE.SphereGeometry(0.0035, 8, 6), M.chrome); r.position.set(Math.sin(a) * 0.068, 0.0, -0.095 + (1 - Math.cos(a)) * 0.02); sad.add(r); }
    for (const sd of [1, -1]) {
      const m = mesh(new THREE.TubeGeometry(new Helix(0.0085, 0.036, 5), 60, 0.0019, 6, false), M.chrome); m.position.set(sd * 0.04, -0.03, -0.075); sad.add(m);
      sad.add(mesh(tubeGeo(new V3(sd * 0.02, -0.018, 0.09), new V3(sd * 0.04, -0.04, -0.07), 0.0028), M.chrome));
    }
    sad.add(mesh(tubeGeo(new V3(0, -0.04, -0.02), new V3(0, -0.04, 0.02), 0.012), M.chrome));
  }

  // --------------------------------------------------------------- per frame
  // speed m/s, pedaling (bool), steer (rad), wheelie (rad), lights 0..1
  update(dt, { speed = 0, pedaling = true, steer = 0, wheelie = 0, lights = 0 } = {}) {
    const dA = speed * dt / G.R;
    this.wheelA += dA;
    for (const w of this.wheels) w.rotation.x = this.wheelA;
    if (pedaling) { this.crank += dA / G.ratio; this.cogA += dA; }
    else {
      // coasting: pedals settle level (right foot forward) while the hub freewheels
      const target = Math.round((this.crank - Math.PI / 2) / Math.PI) * Math.PI + Math.PI / 2;
      const d = target - this.crank; const step = clamp(d * 3 * dt, -dt * 1.2, dt * 1.2); this.crank += step; this.cogA += step * G.ratio;
    }
    this.cranks.rotation.x = this.crank; this.ring.rotation.x = this.crank; this.cogG.rotation.x = this.cogA;
    for (const p of this.pedals) {
      // pedals stay near level with a little ankling
      const a = this.crank + (p.sd > 0 ? Math.PI : 0);
      p.p.rotation.x = -a - 0.18 * Math.cos(a + 0.4);
    }
    this.updateChain(-this.crank * G.ringR);
    this.steer = steer;
    this.steerPivot.quaternion.setFromAxisAngle(G.htAxis, steer);
    this.pitchPivot.rotation.x = -wheelie;
    this.lightsOn = lights;
    // steady, and bright enough to read as a lamp (a small halo) without blooming into a flare
    this.M.lens.emissiveIntensity = lights * 2; this.M.red.emissiveIntensity = lights * 1.2;
    this.spot.intensity = lights * 14;
  }
  ring_bell() { this.bellT = 0.25; }
  // lowest point of tyre i (0 rear, 1 front) in world space; the wheel's matrixWorld must be current
  tyreBottom(i, out) {
    const e = this.wheels[i].matrixWorld.elements, n = _n.set(e[0], e[1], e[2]).normalize();
    out.set(n.x * n.y, n.y * n.y - 1, n.z * n.y).multiplyScalar((G.R - G.tyreR) / Math.sqrt(1 - n.y * n.y)); // down, in the wheel plane
    out.x += e[12]; out.y += e[13] - G.tyreR; out.z += e[14];
    return out;
  }
  // pedal & grip transforms in the space of `obj` (the pelican root)
  pedalIn(obj, i, outP, outQ) {
    const p = this.pedals[i].p;
    p.getWorldPosition(outP); p.getWorldQuaternion(outQ);
    obj.worldToLocal(outP); outQ.premultiply(obj.getWorldQuaternion(new THREE.Quaternion()).invert());
  }
  gripIn(obj, i, out) { this.grips[i].getWorldPosition(out); return obj.worldToLocal(out); }
}

// keep only position/normal/uv so geometries can be merged
function stripUV(g) {
  for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') g.deleteAttribute(k);
  if (!g.attributes.normal) g.computeVertexNormals();
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
  return g;
}
class Helix extends THREE.Curve {
  constructor(r, h, turns) { super(); this.r = r; this.h = h; this.turns = turns; }
  getPoint(t, out = new V3()) { const a = t * this.turns * TAU; return out.set(Math.cos(a) * this.r, t * this.h - this.h / 2, Math.sin(a) * this.r); }
}
