// The visible world: ship deck + cargo + cabins (interiors), flank pipes and walkways, hull and superstructure,
// the quay with gantry cranes and a container yard, and the wider harbour. Collision comes from mapdata.
import * as THREE from 'three';
import * as TX from './textures.js';
import * as M from './mapdata.js';
import { Batch } from './geom.js';
import { makeSea, WATER_Y } from './sea.js';
import { SUN_DIR, SUN_COLOR } from './sky.js';

const PI = Math.PI;
const std = (o) => new THREE.MeshStandardMaterial(o);
function pbr(t, o = {}) {
  return std({ map: t.map, normalMap: t.normal, roughnessMap: t.rm, metalnessMap: t.rm, roughness: 1, metalness: 1, ...o });
}
function rep(t, r) { for (const k of ['map', 'normal', 'rm']) if (t[k]) { t[k] = t[k].clone(); t[k].repeat.set(r, r); t[k].needsUpdate = true; } return t; }

// ------------------------------------------------------------------------------------------------ materials
function makeMaterials() {
  const m = {};
  m.deck = pbr(TX.deckPlate());
  m.bulk = pbr(TX.paintedSteel('#56605a', 21, 1.2));
  m.bulkhead = pbr(TX.paintedSteel('#8d9a8f', 22, 0.8));
  const tread = TX.treadPlate();
  m.tread = pbr(tread);
  m.pipeFloor = pbr(tread, { envMapIntensity: 0.22 });
  m.cabinExt = pbr(TX.paintedSteel('#dcd8cc', 23, 1.0));
  m.cabinInt = pbr(TX.paintedSteel('#8e9d91', 24, 0.35), { envMapIntensity: 0.16 });
  m.ceiling = pbr(TX.paintedSteel('#a9aca6', 25, 0.2, 128, 128), { envMapIntensity: 0.14 });
  m.lino = pbr(TX.linoFloor(), { envMapIntensity: 0.2 });
  m.bulwark = pbr(TX.paintedSteel('#7d877f', 26, 1.0));
  m.pipeWall = pbr(TX.paintedSteel('#6d756f', 28, 1.4), { envMapIntensity: 0.22 });
  m.pipeCeil = std({ color: 0x3c4240, roughness: 0.7, metalness: 0.5, envMapIntensity: 0.2 });
  m.hull = pbr(rep(TX.paintedSteel('#1f2428', 29, 1.6), 0.25));
  m.hullRed = pbr(rep(TX.paintedSteel('#7a2a22', 30, 1.0), 0.25));
  m.rail = std({ color: 0xe0a91c, roughness: 0.45, metalness: 0.25 });
  m.railWhite = std({ color: 0xd8d8d0, roughness: 0.5, metalness: 0.2 });
  m.steelDark = std({ color: 0x34373a, roughness: 0.45, metalness: 0.85 });
  m.rubber = std({ color: 0x141414, roughness: 0.9 });
  m.rope = std({ color: 0xc8b48a, roughness: 0.95 });
  m.crate = pbr(TX.crateWood(12)); m.crate2 = pbr(TX.crateWood(13));
  m.drumBlue = std({ color: 0x1f4f9a, roughness: 0.45, metalness: 0.35 });
  m.drumRed = std({ color: 0xa22a1e, roughness: 0.45, metalness: 0.35 });
  // emitters: just over the bloom threshold (render.js), so a lamp reads as lit with a small halo, not a white slab
  m.lampOn = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.9, 1.6, 1.2) });
  m.lampRed = new THREE.MeshBasicMaterial({ color: new THREE.Color(3.0, 0.25, 0.18) });
  m.lampGreen = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.2, 2.6, 0.35) });
  m.lampWhite = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.5, 1.55, 1.6) });
  m.glass = std({ color: 0x16222c, roughness: 0.06, metalness: 1.0 });
  m.screen = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.25, 0.9, 0.7) });
  m.screen2 = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.9, 0.6, 0.2) });
  m.concrete = pbr(rep(TX.concrete(), 1));
  m.orange = std({ color: 0xe8661d, roughness: 0.5, metalness: 0.1 });
  m.white = std({ color: 0xe6e4dc, roughness: 0.55, metalness: 0.1 });
  m.black = std({ color: 0x1a1b1d, roughness: 0.6, metalness: 0.3 });
  m.funnel = std({ color: 0x1f4f8f, roughness: 0.5, metalness: 0.2 });
  m.locker = std({ color: 0x6f7c86, roughness: 0.5, metalness: 0.6 });
  m.wood = std({ color: 0x6b4a2e, roughness: 0.7 });
  m.chart = std({ color: 0x9db2b4, roughness: 0.85 }); // sea chart: pure white under the bridge lamp read as a glowing slab
  m.cfloor = std({ color: 0x5a4331, roughness: 0.85 });
  m.crane = pbr(TX.paintedSteel('#c7402c', 31, 0.6));
  m.craneWhite = pbr(TX.paintedSteel('#e4e4de', 32, 0.5));
  m.hazard = std({ map: TX.hazard(), roughness: 0.6 });
  m.hazard.map.repeat.set(1, 1);
  m.water = null;
  // containers: side (20/40 ft) / door per colour, shared roof, frame per colour
  m.cont = {};
  let seed = 1;
  const colors = new Set(M.containers.map((c) => c.color));
  for (const col of colors) {
    const s20 = TX.containerSide(col, seed, 20, seed), dr = TX.containerDoor(col, seed);
    const e = { side20: pbr(s20), door: pbr(dr), frame: std({ color: new THREE.Color(TX.CONTAINER_COLORS[col]).multiplyScalar(0.8), roughness: 0.6, metalness: 0.3 }) };
    // blank end wall: paint colour + the side relief, no logo
    e.end = std({ color: new THREE.Color(TX.CONTAINER_COLORS[col]).multiplyScalar(0.92), normalMap: s20.normal, roughness: 0.62, metalness: 0.1 });
    if (M.containers.some((c) => c.color === col && c.len === 40)) e.side40 = pbr(TX.containerSide(col, seed + 50, 40, seed));
    m.cont[col] = e;
    seed++;
  }
  m.roof = pbr(TX.containerRoof());
  return m;
}

// ------------------------------------------------------------------------------------------------ containers
function buildContainer(B, c, keyBase) {
  const L = c.len === 40 ? M.C40 : M.C20, W = M.CW, H = M.CH;
  const cs = Math.cos(c.ry), sn = Math.sin(c.ry);
  const at = (u, v) => [c.x + u * cs + v * sn, c.z - u * sn + v * cs];
  const k = keyBase;
  // body: 6 faces with container-specific UVs
  const body = new THREE.BufferGeometry();
  const pos = [], nor = [], uv = [], groups = [];
  const face = (mk, corners, n, uvs) => {
    const base = pos.length / 3;
    for (let i = 0; i < 4; i++) { const [u, y, v] = corners[i], w = at(u, v); pos.push(w[0], c.y + y, w[1]); nor.push(n[0] * cs + n[2] * sn, n[1], -n[0] * sn + n[2] * cs); uv.push(...uvs[i]); }
    groups.push([mk, base]);
  };
  const hl = L / 2, hw = W / 2, ul = c.len === 40 ? 1 : 1;
  const inset = 0.04;
  // sides (+v and -v); u mapped so text reads correctly from outside
  face('side', [[-hl, 0, hw - inset], [hl, 0, hw - inset], [hl, H, hw - inset], [-hl, H, hw - inset]], [0, 0, 1], [[0, 0], [ul, 0], [ul, 1], [0, 1]]);
  face('side', [[hl, 0, -hw + inset], [-hl, 0, -hw + inset], [-hl, H, -hw + inset], [hl, H, -hw + inset]], [0, 0, -1], [[0, 0], [ul, 0], [ul, 1], [0, 1]]);
  // door end (+u) unless open; back end (-u)
  if (!c.open) face('door', [[hl - inset, 0, hw], [hl - inset, 0, -hw], [hl - inset, H, -hw], [hl - inset, H, hw]], [1, 0, 0], [[0, 0], [1, 0], [1, 1], [0, 1]]);
  face('end', [[-hl + inset, 0, -hw], [-hl + inset, 0, hw], [-hl + inset, H, hw], [-hl + inset, H, -hw]], [-1, 0, 0], [[0, 0], [0.4, 0], [0.4, 1], [0, 1]]);
  // roof panel sits a little below the top rails (as on a real box) so the two never share a plane
  const HR = H - 0.02;
  face('roof', [[-hl, HR, hw], [hl, HR, hw], [hl, HR, -hw], [-hl, HR, -hw]], [0, 1, 0], [[0, 0], [L / 3, 0], [L / 3, 1], [0, 1]]);
  const idx = [];
  for (let i = 0; i < pos.length / 12; i++) { const b = i * 4; idx.push(b, b + 1, b + 2, b, b + 2, b + 3); }
  body.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  body.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  body.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  // split by material into separate small geometries for the batch
  for (let i = 0; i < groups.length; i++) {
    const [mk, base] = groups[i];
    const g = new THREE.BufferGeometry();
    const sl = (arr, n) => arr.slice(base * n, (base + 4) * n);
    g.setAttribute('position', new THREE.Float32BufferAttribute(sl(pos, 3), 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(sl(nor, 3), 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(sl(uv, 2), 2));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    const key = mk === 'side' ? `${k}:side${c.len}` : mk === 'door' ? `${k}:door` : mk === 'end' ? `${k}:end` : 'roof';
    B.push(key, g);
  }
  // frame: corner posts, top & bottom rails between the posts (not through them: no shared faces), castings
  const fk = `${k}:frame`, LR = L - 0.34, WR = W - 0.34;
  const post = (u, v) => { const w = at(u, v); B.box(fk, w[0], c.y + H / 2, w[1], 0.17, H, 0.17, c.ry); };
  post(hl - 0.085, hw - 0.085); post(hl - 0.085, -hw + 0.085); post(-hl + 0.085, hw - 0.085); post(-hl + 0.085, -hw + 0.085);
  for (const v of [hw - 0.05, -hw + 0.05]) {
    const w = at(0, v);
    B.box(fk, w[0], c.y + H - 0.07, w[1], LR, 0.14, 0.1, c.ry);
    B.box(fk, w[0], c.y + 0.1, w[1], LR, 0.2, 0.12, c.ry);
  }
  for (const u of [hl - 0.05, -hl + 0.05]) {
    const w = at(u, 0);
    B.box(fk, w[0], c.y + H - 0.1, w[1], 0.1, 0.2, WR, c.ry);
    B.box(fk, w[0], c.y + 0.12, w[1], 0.12, 0.24, WR, c.ry);
  }
  for (const u of [hl - 0.09, -hl + 0.09]) for (const v of [hw - 0.09, -hw + 0.09]) for (const y of [0.09, H - 0.09]) {
    const w = at(u, v); B.box('steelDark', w[0], c.y + y, w[1], 0.19, 0.19, 0.19, c.ry);
  }
  // door hardware: 4 locking bars with cam keepers and handles
  if (!c.open) {
    for (const v of [-0.95, -0.35, 0.35, 0.95]) {
      const w = at(hl + 0.02, v * hw * 0.98);
      B.cyl('steelDark', [w[0], c.y + 0.18, w[1]], [w[0], c.y + H - 0.18, w[1]], 0.028, 6);
      const hw2 = at(hl + 0.06, v * hw * 0.98 + (v > 0 ? -0.12 : 0.12));
      B.box('steelDark', hw2[0], c.y + 1.15, hw2[1], 0.05, 0.05, 0.28, c.ry);
      for (const y of [0.25, H - 0.25]) { const kp = at(hl + 0.03, v * hw * 0.98); B.box('steelDark', kp[0], c.y + y, kp[1], 0.08, 0.12, 0.12, c.ry); }
    }
    for (const y of [0.4, 1.3, 2.2]) for (const v of [hw - 0.02, -hw + 0.02]) { const w = at(hl + 0.03, v); B.box('steelDark', w[0], c.y + y, w[1], 0.08, 0.14, 0.05, c.ry); }
  } else {
    // interior: floor boards + inner walls; doors swung open against the sides
    const w0 = at(0, 0);
    B.box('cfloor', w0[0], c.y + 0.125, w0[1], L - 0.1, 0.01, W - 0.2, c.ry);
    for (const v of [hw - 0.13, -hw + 0.13]) { const w = at(0, v); B.box(`${k}:frame`, w[0], c.y + H / 2, w[1], L - 0.12, H - 0.25, 0.02, c.ry); }
    { const w = at(-hl + 0.13, 0); B.box(`${k}:frame`, w[0], c.y + H / 2, w[1], 0.02, H - 0.25, W - 0.2, c.ry); }
    { const w = at(0, 0); B.box(`${k}:frame`, w[0], c.y + H - 0.13, w[1], L - 0.12, 0.02, W - 0.2, c.ry); }
    for (const s of [1, -1]) {
      // leaf hinged at the corner post, folded back 260 degrees against the side
      const hv = s * hw, leafW = hw;
      const p = at(hl - leafW / 2, hv + s * 0.08);
      B.box(`${k}:door`, p[0], c.y + H / 2, p[1], leafW, H - 0.1, 0.06, c.ry);
      for (const v of [0.3, 0.8]) { const q = at(hl - leafW * v, hv + s * 0.13); B.cyl('steelDark', [q[0], c.y + 0.2, q[1]], [q[0], c.y + H - 0.2, q[1]], 0.026, 6); }
    }
  }
}

// ------------------------------------------------------------------------------------------------ cabin props
function furniture(B, b) {
  const x0 = b.x - b.sx / 2, x1 = b.x + b.sx / 2, z0 = b.z - b.sz / 2, z1 = b.z + b.sz / 2, y0 = b.y - b.sy / 2, y1 = b.y + b.sy / 2;
  const alongZ = b.sz > b.sx;
  switch (b.kind) {
    case 'lockers': {
      const n = Math.max(1, Math.round((alongZ ? b.sz : b.sx) / 0.6));
      for (let i = 0; i < n; i++) {
        const a = (i + 0.5) / n;
        const cx = alongZ ? b.x : x0 + a * b.sx, cz = alongZ ? z0 + a * b.sz : b.z;
        const w = (alongZ ? b.sz : b.sx) / n - 0.03;
        B.box('locker', cx, (y0 + y1) / 2, cz, alongZ ? b.sx : w, b.sy, alongZ ? w : b.sz);
        // vents + handle on the door face
        const face = b.x > 0 ? -1 : 1, fx = b.x + face * (b.sx / 2 + 0.005);
        for (let k = 0; k < 4; k++) B.box('black', fx, y1 - 0.25 - k * 0.05, cz, 0.01, 0.02, w * 0.5);
        B.box('steelDark', fx + face * 0.01, (y0 + y1) / 2, cz + w * 0.35, 0.03, 0.14, 0.03);
      }
      break;
    }
    case 'table': {
      B.box('wood', b.x, y1 - 0.03, b.z, b.sx, 0.06, b.sz);
      for (const [x, z] of [[x0 + 0.08, z0 + 0.08], [x1 - 0.08, z0 + 0.08], [x0 + 0.08, z1 - 0.08], [x1 - 0.08, z1 - 0.08]]) B.box('steelDark', x, (y0 + y1 - 0.06) / 2, z, 0.05, b.sy - 0.06, 0.05);
      // benches either side (visual only, low)
      B.box('wood', b.x, 0.44, z0 - 0.35, b.sx, 0.05, 0.3); B.box('wood', b.x, 0.44, z1 + 0.35, b.sx, 0.05, 0.3);
      // mugs / papers
      B.cyl('white', [b.x - 0.4, y1, b.z], [b.x - 0.4, y1 + 0.1, b.z], 0.045, 8);
      B.box('white', b.x + 0.3, y1 + 0.005, b.z - 0.2, 0.3, 0.01, 0.22, 0.3);
      break;
    }
    case 'rack': {
      B.box('steelDark', b.x, y0 + 0.05, b.z, b.sx, 0.1, b.sz);
      B.box('steelDark', b.x, y1 - 0.04, b.z, b.sx, 0.08, b.sz);
      // rifles standing in the rack (simple silhouettes)
      for (let i = 0; i < 5; i++) {
        const x = x0 + 0.25 + i * (b.sx - 0.5) / 4;
        B.box('black', x, (y0 + y1) / 2 + 0.05, b.z, 0.06, b.sy * 0.85, 0.12, 0.08);
        B.box('black', x, y0 + 0.55, b.z + 0.08, 0.04, 0.2, 0.06);
      }
      break;
    }
    case 'pumps': {
      for (let i = 0; i < 3; i++) {
        const x = x0 + 0.8 + i * 1.6;
        B.cyl('drumBlue', [x, 0, b.z], [x, 0.8, b.z], 0.45, 12);
        B.cyl('steelDark', [x, 0.8, b.z], [x, 1.15, b.z], 0.2, 8);
      }
      B.cyl('bulk', [x0, 0.95, z1 - 0.1], [x1, 0.95, z1 - 0.1], 0.1, 8);
      break;
    }
    case 'console': {
      B.box('black', b.x, (y0 + y1) / 2 - 0.05, b.z, b.sx, b.sy - 0.1, b.sz);
      const face = b.x > 0 ? -1 : 1;
      // slanted top with screens
      B.box('bulk', b.x, y1 - 0.02, b.z, b.sx, 0.06, b.sz, 0);
      for (let i = 0; i < 3; i++) {
        const z = z0 + 0.45 + i * (b.sz - 0.9) / 2;
        B.box(i === 1 ? 'screen2' : 'screen', b.x + face * 0.2, y1 + 0.2, z, 0.02, 0.28, 0.42);
        B.box('black', b.x + face * 0.21 - face * 0.02, y1 + 0.2, z, 0.03, 0.32, 0.46);
      }
      break;
    }
    case 'chart': {
      B.box('wood', b.x, y1 - 0.04, b.z, b.sx, 0.08, b.sz);
      B.box('bulk', b.x, (y0 + y1) / 2 - 0.04, b.z, b.sx - 0.1, b.sy - 0.08, b.sz - 0.1);
      B.box('chart', b.x, y1 + 0.003, b.z, b.sx * 0.7, 0.005, b.sz * 0.6, 0.1);
      break;
    }
    default: B.box('bulk', b.x, b.y, b.z, b.sx, b.sy, b.sz);
  }
}

// ------------------------------------------------------------------------------------------------ ship structure
function isCabinInterior(x, y, z) {
  const ax = Math.abs(x);
  return ax > 36.28 && ax < 47.02 && Math.abs(z) < 14.0 && y > -1.3 && y < 6.56;
}
function buildStructure(B) {
  const cabinFaces = (b) => (name, n, c) => {
    const px = c[0] + n[0] * 0.2, py = c[1] + n[1] * 0.2, pz = c[2] + n[2] * 0.2;
    if (name === 'ny' && c[1] < 0.1) return null;
    return isCabinInterior(px, py, pz) ? 'cabinInt' : 'cabinExt';
  };
  for (const b of M.boxes) {
    const r = b.ry || 0;
    switch (b.vis) {
      case 'deck': B.box((n, nw) => nw[1] > 0.5 ? 'deck' : nw[1] < -0.5 ? null : 'bulk', b.x, b.y, b.z, b.sx, b.sy, b.sz, r, 'world', 0.25); break;
      // (its sides are all buried: under the walls, the hull, the stairwell steps and the exit stair)
      case 'pipefloor': B.box((n, nw) => nw[1] > 0.5 ? 'pipeFloor' : null, b.x, b.y, b.z, b.sx, b.sy, b.sz, r, 'world', 0.8); break;
      case 'pipewall': B.box((n, nw) => Math.abs(nw[1]) > 0.5 ? null : Math.sign(nw[2]) === Math.sign(b.z) ? 'pipeWall' : 'bulkhead', b.x, b.y, b.z, b.sx, b.sy, b.sz, r, 'world', 0.33); break;
      case 'walkway': B.box((n, nw) => nw[1] > 0.5 ? 'tread' : nw[1] < -0.5 ? 'pipeCeil' : 'bulkhead', b.x, b.y, b.z, b.sx, b.sy, b.sz, r, 'world', 0.8); break;
      case 'hull': B.box((n, nw) => nw[1] > 0.5 ? 'bulk' : Math.abs(nw[2]) < 0.5 || Math.sign(nw[2]) === Math.sign(b.z) ? null : 'bulwark', b.x, b.y, b.z, b.sx, b.sy, b.sz, r, 'world', 0.33); break;
      // hull plating inside a cabin: only its inner face shows (the hull mesh is the outside, the wall sits on top)
      case 'cabinhull': B.box((n, nw) => Math.abs(nw[2]) > 0.5 && Math.sign(nw[2]) !== Math.sign(b.z) ? 'cabinInt' : null, b.x, b.y, b.z, b.sx, b.sy, b.sz, r, 'world', 0.33); break;
      case 'cabinwall':
        B.box(cabinFaces(b), b.x, b.y, b.z, b.sx, b.sy, b.sz, r, 'world', 0.33);
        // ground-floor walls carry their inner face 0.6 m down into the floor slab: unseen by the camera, but it
        // gives the shadow map an occluder under the wall's base edge, so low sun can't leak in along the floor
        if (Math.abs(b.y - b.sy / 2) < 0.01) B.box((n, nw, c) => Math.abs(nw[1]) < 0.5 && isCabinInterior(c[0] + nw[0] * 0.2, 0.5, c[2] + nw[2] * 0.2) ? 'cabinInt' : null, b.x, -0.3, b.z, b.sx, 0.6, b.sz, r, 'world', 0.33);
        break;
      case 'inwall': B.box('cabinInt', b.x, b.y, b.z, b.sx, b.sy, b.sz, r, 'world', 0.33); break;
      case 'floor': B.box((n, nw) => nw[1] > 0.5 ? 'lino' : nw[1] < -0.5 ? 'ceiling' : 'cabinInt', b.x, b.y, b.z, b.sx, b.sy, b.sz, r, 'world', 0.5); break;
      case 'roof': B.box((n, nw) => nw[1] > 0.5 ? 'deck' : nw[1] < -0.5 ? 'ceiling' : 'cabinExt', b.x, b.y, b.z, b.sx, b.sy, b.sz, r, 'world', 0.25); break;
      case 'furn': furniture(B, b); break;
      case 'crate': B.box(Math.abs(b.x * 7 + b.z * 3) % 2 < 1 ? 'crate' : 'crate2', b.x, b.y, b.z, b.sx, b.sy, b.sz, r, 'unit'); break;
      case 'drum': {
        const k = Math.abs(b.x + b.z) % 1.5 < 0.75 ? 'drumBlue' : 'drumRed';
        B.cyl(k, [b.x, b.y - b.sy / 2, b.z], [b.x, b.y + b.sy / 2, b.z], b.sx / 2, 14);
        for (const t of [0.3, 0.7]) B.cyl('steelDark', [b.x, b.y - b.sy / 2 + b.sy * t - 0.015, b.z], [b.x, b.y - b.sy / 2 + b.sy * t + 0.015, b.z], b.sx / 2 + 0.012, 14);
        break;
      }
      case 'steel': B.box('bulk', b.x, b.y, b.z, b.sx, b.sy, b.sz, r, 'world', 0.33); break;
      default: break;
    }
    if (b.step) {
      const inCab = Math.abs(b.x) > 36.2;
      // drawn at the exact run: the collision steps overlap by 1 cm, which would make their side faces z-fight
      B.box((n, nw) => nw[1] > 0.5 ? 'tread' : nw[1] < -0.5 ? null : inCab ? 'bulk' : 'bulkhead', b.x, b.y, b.z, b.sx - 0.01, b.sy, b.sz, r, 'world', 1);
      // safety nosing strip on the tread's leading edge (both edges: we don't know the climb direction here)
      const cs = Math.cos(r), sn = Math.sin(r), top = b.y + b.sy / 2, h = (b.sx - 0.01) / 2 - 0.035;
      for (const e of [-1, 1]) B.box('rail', b.x + cs * e * h, top + 0.004, b.z - sn * e * h, 0.05, 0.012, b.sz - 0.04, r);
    }
  }
  // rails: posts + two bars (one post where two rails meet: coincident cylinders z-fight)
  const posts = new Set();
  for (const rl of M.rails) {
    const L = Math.hypot(rl.x1 - rl.x0, rl.z1 - rl.z0);
    if (L < 0.05) continue;
    const n = Math.max(1, Math.ceil(L / 1.4));
    for (let i = 0; i <= n; i++) {
      const t = i / n, x = rl.x0 + (rl.x1 - rl.x0) * t, z = rl.z0 + (rl.z1 - rl.z0) * t, key = `${x.toFixed(2)},${rl.y},${z.toFixed(2)}`;
      if (!posts.has(key)) { posts.add(key); B.cyl('rail', [x, rl.y, z], [x, rl.y + rl.h, z], 0.025, 6); }
    }
    B.cyl('rail', [rl.x0, rl.y + rl.h, rl.z0], [rl.x1, rl.y + rl.h, rl.z1], 0.03, 6);
    B.cyl('rail', [rl.x0, rl.y + rl.h * 0.5, rl.z0], [rl.x1, rl.y + rl.h * 0.5, rl.z1], 0.02, 6);
  }
  // stair handrails (both sides) along each stair run
  for (const s of M.stairs) {
    const cs = Math.cos(s.ry), sn = Math.sin(s.ry), len = s.run * s.n;
    for (const side of [-1, 1]) {
      const ox = sn * side * (s.w / 2 - 0.05), oz = cs * side * (s.w / 2 - 0.05);
      const a = [s.x + ox, s.y0 + 1.0, s.z + oz], b = [s.x + cs * len + ox, s.y1 + 1.0, s.z - sn * len + oz];
      B.cyl('rail', a, b, 0.025, 6);
      B.cyl('rail', [a[0], s.y0, a[2]], a, 0.022, 6);
      B.cyl('rail', [b[0], s.y1, b[2]], b, 0.022, 6);
    }
  }
  // door frames + open watertight doors. Frames sit wholly proud of the wall face (d.x + 0.15): a frame sunk into
  // the wall shares the soffit / reveal planes with it and z-fights there.
  for (const d of M.doors) {
    const s = Math.cos(d.ry) > 0 ? 1 : -1; // +1: front wall faces +x
    const xo = d.x + s * 0.21;
    B.box('bulk', xo, d.y + d.h + 0.08, d.z, 0.12, 0.16, d.w + 0.3);
    for (const e of [-1, 1]) B.box('bulk', xo, d.y + d.h / 2, d.z + e * (d.w / 2 + 0.08), 0.12, d.h, 0.16);
    B.box('bulk', d.x + s * 0.22, d.y + 0.04, d.z, 0.14, 0.08, d.w); // low sill
    // leaf folded flat against the outside wall
    const lz = d.z + s * (d.w / 2 + 0.18 + d.w / 2);
    B.box('bulkhead', d.x + s * 0.24, d.y + d.h / 2, lz, 0.07, d.h - 0.1, d.w - 0.05);
    for (const y of [0.35, d.h - 0.35]) B.box('steelDark', d.x + s * 0.23, d.y + y, d.z + s * (d.w / 2 + 0.12), 0.1, 0.16, 0.1);
    for (const y of [0.5, 1.1, 1.7]) B.box('steelDark', d.x + s * 0.3, d.y + y, lz, 0.05, 0.04, d.w * 0.5);
  }
  for (const w of M.windows) {
    const s = Math.cos(w.ry) > 0 ? 1 : -1, xo = w.x + s * 0.2; // proud of the wall face, like the door frames
    B.box('bulk', xo, w.y + w.h / 2 + 0.05, w.z, 0.1, 0.1, w.w + 0.2);
    B.box('bulk', w.x + s * 0.25, w.y - w.h / 2 - 0.05, w.z, 0.2, 0.1, w.w + 0.2);
    for (const e of [-1, 1]) B.box('bulk', xo, w.y, w.z + e * (w.w / 2 + 0.05), 0.1, w.h, 0.1);
    B.box('bulk', w.x, w.y, w.z, 0.06, w.h, 0.06); // mullion, in the opening
  }
  // walkway underside beams + pipe lamps + pipelines along the hull side of each pipe
  for (const sgn of [1, -1]) {
    B.box((n, nw) => Math.sign(nw[2]) === sgn ? null : 'pipeWall', sgn * ((-36 + M.PIPE_END) / 2), 1.35, sgn * 14.17, M.PIPE_END + 36, 0.5, 0.35, 0, 'world', 0.33);
    for (let x = -32; x <= 14; x += 6) B.cyl('lampWhite', [sgn * x, 0.45, sgn * 13.96], [sgn * x, 0.45, sgn * 13.99], 0.16, 12);
    const zc = sgn * 12.7;
    for (let x = -34; x <= M.PIPE_END - 1; x += 3) B.box('pipeCeil', sgn * x, M.WALK_Y - 0.3, zc, 0.18, 0.22, 2.6);
    for (const y of [-0.2, 0.25]) B.cyl(y > 0 ? 'drumRed' : 'bulkhead', [sgn * -42.5, y, sgn * 13.72], [sgn * M.PIPE_END, y, sgn * 13.72], y > 0 ? 0.09 : 0.13, 8);
    for (let x = -30; x <= 12; x += 7) {
      B.box('bulk', sgn * x, 0.9, sgn * 13.9, 0.24, 0.3, 0.1);
      B.box('lampOn', sgn * x, 0.9, sgn * 13.82, 0.16, 0.2, 0.06);
    }
    // painted deck markings: hazard strip on the walkway edge facing the deck
    B.box('hazard', sgn * (-36 + (M.PIPE_END + 36) / 2), M.WALK_Y - 0.1, sgn * 11.19, M.PIPE_END + 36, 0.2, 0.02, 0, 'world', 0.5);
  }
  // ceiling lamps
  for (const l of M.lamps) {
    B.box('bulk', l.x, l.y + 0.12, l.z, 0.9, 0.06, 0.26);
    B.box('lampOn', l.x, l.y + 0.07, l.z, 0.8, 0.04, 0.16);
  }
  // spawn hall dressing: benches, emblems of each team painted on the hall wall (drawn by sign meshes in buildWorld)
  for (const s of [1, -1]) {
    for (const z of [-4.5, 3.5]) B.box('wood', s * -42.2, 0.45, s * z, 3.2, 0.06, 0.4);
    for (const z of [-4.5, 3.5]) for (const dx of [-1.4, 1.4]) B.box('steelDark', s * (-42.2 + dx), 0.21, s * z, 0.06, 0.42, 0.35);
  }
}

// ------------------------------------------------------------------------------------------------ hull, superstructure
function hullShape(y0, y1) {
  const s = new THREE.Shape();
  // outline in (x, -z): stern transom at x -61, parallel mid body, curved bow to the stem at x 70
  const hb = 14.35;
  s.moveTo(-58.5, -hb);
  s.lineTo(38, -hb);
  s.quadraticCurveTo(60, -hb, 70.5, 0);
  s.quadraticCurveTo(60, hb, 38, hb);
  s.lineTo(-58.5, hb);
  s.quadraticCurveTo(-61.5, hb, -61.5, hb - 3);
  s.lineTo(-61.5, -hb + 3);
  s.quadraticCurveTo(-61.5, -hb, -58.5, -hb);
  const g = new THREE.ExtrudeGeometry(s, { depth: y1 - y0, bevelEnabled: false, curveSegments: 16 });
  g.rotateX(-PI / 2);
  g.translate(0, y0, 0);
  return g;
}
function buildHull(group, mats) {
  const hide = new THREE.MeshBasicMaterial({ visible: false });
  const top = new THREE.Mesh(hullShape(-6.3, 1.1), [hide, mats.hull]);
  const bottom = new THREE.Mesh(hullShape(-14, -6.3), [hide, mats.hullRed]);
  const band = new THREE.Mesh(hullShape(-6.45, -6.25), [hide, mats.white]);
  band.scale.set(1.002, 1, 1.004);
  for (const m of [top, bottom, band]) { m.receiveShadow = true; m.castShadow = false; group.add(m); }
  // ship name + port on the bow and stern (both sides)
  const name = TX.signTexture('MERIDIAN STAR', '#f0eee6', null, 1024, 128, '800 84px Rubik, "Arial Black", sans-serif');
  const port = TX.signTexture('MERIDIAN STAR · PORT KESSIN', '#f0eee6', null, 1024, 128, '700 60px Rubik, "Arial Black", sans-serif');
  const nm = new THREE.MeshStandardMaterial({ map: name, transparent: true, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -2 });
  const pm = new THREE.MeshStandardMaterial({ map: port, transparent: true, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -2 });
  for (const s of [1, -1]) {
    const p = new THREE.Mesh(new THREE.PlaneGeometry(14, 1.75), nm);
    p.position.set(52, -1.4, s * 14.25 * 0.985); p.rotation.y = s > 0 ? -0.1 : PI + 0.1;
    if (s < 0) p.position.z = -14.1;
    group.add(p);
  }
  const tr = new THREE.Mesh(new THREE.PlaneGeometry(18, 2.2), pm);
  tr.position.set(-61.55, -2.2, 0); tr.rotation.y = -PI / 2; group.add(tr);
  // draught marks near bow and stern
  const dm = TX.signTexture('14M\n\n12M', '#f0eee6', null, 128, 256, '700 40px "IBM Plex Mono", monospace');
  const dmm = new THREE.MeshStandardMaterial({ map: dm, transparent: true, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -2 });
  for (const [x, s] of [[62, 1], [62, -1], [-58, 1], [-58, -1]]) {
    const p = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 1.6), dmm);
    p.position.set(x, -6.5, s * 14.37); if (Math.abs(x) > 60) p.position.z = s * 10.5;
    p.rotation.y = s > 0 ? 0 : PI; group.add(p);
  }
}
// Stern deck and bulwark aft of the cabin, following the hull outline. The hull mesh is the outside, so this adds
// only the deck, the bulwark's inner face and its cap: nothing lies on the hull's own faces.
function sternDeck(B) {
  const hb = 14.35, T = 0.35, H = 1.1, k = 0.33;
  const path = new THREE.Path(); // (x, z)
  path.moveTo(-47.3, hb); path.lineTo(-58.5, hb); path.quadraticCurveTo(-61.5, hb, -61.5, hb - 3);
  path.lineTo(-61.5, -hb + 3); path.quadraticCurveTo(-61.5, -hb, -58.5, -hb); path.lineTo(-47.3, -hb);
  const p = path.getPoints(8);
  const q = p.map((a, i) => { // inner edge: offset inboard along the outline normal
    const b = p[Math.min(i + 1, p.length - 1)], c = p[Math.max(i - 1, 0)], tx = b.x - c.x, tz = b.y - c.y, l = Math.hypot(tx, tz);
    return new THREE.Vector2(a.x - (tz / l) * T, a.y + (tx / l) * T);
  });
  const pos = [], uv = [];
  const v = (x, y, z, s, t) => { pos.push(x, y, z); uv.push(s, t); };
  let s0 = 0;
  for (let i = 0; i + 1 < p.length; i++) {
    const a = q[i], b = q[i + 1], s1 = s0 + a.distanceTo(b);
    v(a.x, 0, a.y, s0 * k, 0); v(b.x, 0, b.y, s1 * k, 0); v(b.x, H, b.y, s1 * k, H * k); // inner face
    v(a.x, 0, a.y, s0 * k, 0); v(b.x, H, b.y, s1 * k, H * k); v(a.x, H, a.y, s0 * k, H * k);
    const c = p[i], d = p[i + 1];
    v(a.x, H, a.y, a.x * k, a.y * k); v(b.x, H, b.y, b.x * k, b.y * k); v(d.x, H, d.y, d.x * k, d.y * k); // cap
    v(a.x, H, a.y, a.x * k, a.y * k); v(d.x, H, d.y, d.x * k, d.y * k); v(c.x, H, c.y, c.x * k, c.y * k);
    s0 = s1;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  B.push('bulwark', g);
  // deck plate inside the bulwark (shape in (x, -z) so it faces up after the rotation)
  const dg = new THREE.ShapeGeometry(new THREE.Shape(q.map((a) => new THREE.Vector2(a.x, -a.y))));
  dg.rotateX(-PI / 2);
  const duv = dg.attributes.uv; for (let i = 0; i < duv.count; i++) duv.setXY(i, duv.getX(i) * 0.25, duv.getY(i) * 0.25);
  B.push('deck', dg);
}
function buildShipDecor(B) {
  // --- stern (behind the Sentinel cabin): mooring deck, funnel, lifeboats
  sternDeck(B);
  for (const z of [-9, -3, 3, 9]) { B.cyl('bulk', [-58, 0, z], [-58, 1.0, z], 0.55, 14); B.cyl('rope', [-58, 0.25, z], [-58, 0.8, z], 0.62, 14); } // mooring winches
  for (const z of [-12.5, 12.5]) for (const x of [-60, -55, -50]) { B.cyl('black', [x, 0, z], [x, 0.7, z], 0.22, 10); B.cyl('black', [x + 0.7, 0, z], [x + 0.7, 0.7, z], 0.22, 10); }
  // funnel (tapered, company band)
  const fg = new THREE.CylinderGeometry(2.8, 3.4, 14, 20, 1); fg.scale(1.3, 1, 1);
  B.geo('funnel', fg, -54, 7, 0);
  const band = new THREE.CylinderGeometry(2.84, 2.95, 2.0, 20, 1, true); band.scale(1.3, 1, 1);
  B.geo('white', band, -54, 11.5, 0);
  const cap = new THREE.CylinderGeometry(2.6, 2.84, 1.2, 20); cap.scale(1.3, 1, 1);
  B.geo('black', cap, -54, 14.6, 0);
  // stern superstructure above the Sentinel cabin: wheelhouse with window band, wings, radar mast
  B.aabb('cabinExt', -46.8, 6.8, -9, -39, 9.8, 9);
  B.aabb('glass', -39.05, 8.1, -8.6, -38.95, 9.4, 8.6);
  for (let z = -8; z <= 8; z += 2) B.aabb('cabinExt', -39.06, 8.08, z - 0.06, -38.9, 9.42, z + 0.06); // mullions proud of the glass
  for (const s of [1, -1]) {
    B.aabb('glass', -46.6, 8.1, s * 9.02, -39.2, 9.4, s * 9.1);
    B.aabb('cabinExt', -44.5, 9.0, s * 9, -40, 9.2, s * 14.3); // wing roof
    B.aabb('cabinExt', -40.5, 6.8, s * 13.9, -39.5, 8.0, s * 14.3); // wing bulwark end
  }
  B.aabb('cabinExt', -47.2, 9.8, -9.4, -38.6, 10.1, 9.4);
  B.cyl('white', [-43, 10.1, 0], [-43, 15.5, 0], 0.18, 10);
  B.aabb('white', -43.3, 13.4, -2.5, -42.7, 13.6, 2.5);
  for (const z of [-2.2, 2.2]) B.cyl('white', [-43, 13.6, z], [-43, 15.0, z], 0.05, 6);
  // lifeboats on davits
  for (const s of [1, -1]) {
    const lb = new THREE.CapsuleGeometry(1.25, 5.2, 6, 12); lb.rotateZ(PI / 2); lb.scale(1, 0.9, 1);
    B.geo('orange', lb, -51.5, 4.4, s * 12.6);
    B.aabb('white', -54.3, 4.9, s * 12.0, -48.7, 5.3, s * 13.2);
    for (const x of [-54, -49]) { B.box('white', x, 3.2, s * 13.5, 0.3, 6.4, 0.3); B.box('white', x, 6.3, s * 13.0, 0.26, 0.3, 1.4); }
  }
  // --- bow (behind the Corsair cabin): raised forecastle deck, windlass, foremast
  const fk = new THREE.Shape();
  fk.moveTo(47.3, -14.3); fk.lineTo(55, -14.3); fk.quadraticCurveTo(64, -12, 70.3, 0); fk.quadraticCurveTo(64, 12, 55, 14.3); fk.lineTo(47.3, 14.3); fk.closePath();
  const fkg = new THREE.ExtrudeGeometry(fk, { depth: 2.4, bevelEnabled: false, curveSegments: 12 });
  fkg.rotateX(-PI / 2); fkg.translate(0, -0.4, 0);
  B.geo('deck', fkg);
  for (const s of [1, -1]) {
    B.cyl('bulk', [55, 2.0, s * 3], [55, 3.1, s * 3], 0.9, 16); // windlass drums
    B.cyl('steelDark', [55, 2.4, s * 1.8], [55, 2.4, s * 4.2], 0.35, 10);
    for (let i = 0; i < 12; i++) B.box('steelDark', 56 + i * 0.35, 2.05, s * 3, 0.3, 0.1, 0.14, 0); // anchor chain run
    B.cyl('black', [52, 2.0, s * 12.5], [52, 2.7, s * 12.5], 0.25, 10);
    B.cyl('black', [52.8, 2.0, s * 12.5], [52.8, 2.7, s * 12.5], 0.25, 10);
  }
  B.cyl('white', [44, 6.8, 0], [44, 17, 0], 0.22, 10);
  B.aabb('white', 43.8, 14.8, -2.2, 44.2, 15.0, 2.2);
  const bw = (n, nw) => nw[0] < -0.5 ? null : 'bulwark'; // aft end is against the cabin (and the forecastle's end)
  B.aabb(bw, 47.3, 0, 14.0, 55, 3.4, 14.35); B.aabb(bw, 47.3, 0, -14.35, 55, 3.4, -14.0);
  // lights on the masts (emissive), stern flag pole
  B.box('lampWhite', 44, 17.1, 0, 0.25, 0.25, 0.25); B.box('lampRed', -43, 15.6, -0.3, 0.2, 0.2, 0.2); B.box('lampGreen', -43, 15.6, 0.3, 0.2, 0.2, 0.2);
  B.cyl('white', [-61, 0, 0], [-61, 5.5, 0], 0.05, 6);
}

// ------------------------------------------------------------------------------------------------ harbour backdrop
const noBottom = (k) => (n, nw) => (nw[1] < -0.5 ? null : k); // resting on the quay: the underside is never seen
function buildCrane(B, x) {
  // ship-to-shore gantry crane standing on the quay, boom reaching out over the ship
  const zs = [22.5, 44], y0 = -1.8, top = 36;
  for (const z of zs) for (const dx of [-7, 7]) {
    B.box(noBottom('crane'), x + dx, y0 + (top - y0) / 2, z, 1.2, top - y0, 1.2);
    B.box(noBottom('steelDark'), x + dx, y0 + 0.6, z, 2.4, 1.2, 1.8); // bogies
  }
  for (const dx of [-7, 7]) { B.box('crane', x + dx, 10, 33.25, 1.0, 1.4, 21.5); B.box('crane', x + dx, top - 1, 33.25, 1.0, 1.6, 21.5); }
  for (const z of zs) { B.box('crane', x, 10, z, 14, 1.2, 1.0); }
  // diagonal portal bracing
  // (the two diagonals of an X cross each other: different radii keep their flat faces off each other's planes)
  for (const dx of [-7, 7]) { B.cyl('crane', [x + dx, 10, 22.5], [x + dx, top - 1, 44], 0.35, 6); B.cyl('crane', [x + dx, 10, 44], [x + dx, top - 1, 22.5], 0.32, 6); }
  // boom: two box girders from backreach z 62 to outreach z -38, at y 38..40
  for (const dx of [-3, 3]) {
    B.box('craneWhite', x + dx, top + 3.25, 12, 0.5, 0.4, 100);
    B.box('craneWhite', x + dx, top + 1.2, 12, 0.6, 0.5, 100);
    for (let z = -36; z < 60; z += 4) B.cyl('craneWhite', [x + dx, top + 1.3, z], [x + dx, top + 3.2, z + 4], 0.1, 4);
  }
  for (let z = -36; z < 60; z += 8) B.box('craneWhite', x, top + 1.25, z, 6.8, 0.3, 0.4); // top 5 cm under the girders'
  // machinery house + A-frame + stays
  B.box('craneWhite', x, top + 5.2, 50, 8, 4, 10);
  for (const dx of [-3.5, 3.5]) { B.cyl('crane', [x + dx, top, 40], [x + dx * 0.4, top + 22, 33], 0.45, 8); B.cyl('crane', [x + dx, top, 28], [x + dx * 0.4, top + 22, 33], 0.45, 8); }
  for (const dx of [-3, 3]) { B.cyl('steelDark', [x + dx * 0.4, top + 22, 33], [x + dx, top + 3.3, -34], 0.08, 4); B.cyl('steelDark', [x + dx * 0.4, top + 22, 33], [x + dx, top + 3.3, 60], 0.08, 4); }
  // trolley + cabin + spreader hanging over the water beyond the ship
  const tz = 32;
  B.box('craneWhite', x, top + 0.6, tz, 7, 1.4, 4);
  B.box('glass', x - 2.2, top - 1.2, tz, 2.2, 2.2, 2.4);
  for (const dx of [-2, 2]) for (const dz of [-1.2, 1.2]) B.cyl('steelDark', [x + dx, top, tz + dz], [x + dx * 0.9, 7, tz + dz * 0.9], 0.03, 4);
  B.box('crane', x, 6.6, tz, 12.2, 0.6, 2.5);
  // aircraft warning light + floodlights
  B.box('lampRed', x, top + 7.4, 50, 0.4, 0.4, 0.4);
  for (const dx of [-3, 3]) B.box('lampOn', x + dx, top - 0.2, 5, 0.8, 0.25, 0.5);
}
function buildHarbour(scene, mats) {
  const B = new Batch();
  // quay: concrete apron + face down into the water, fenders, bollards
  B.aabb((n, nw) => nw[1] > 0.5 ? 'concrete' : 'concrete', -420, -12, 16.8, 420, -1.8, 150, 'world', 0.12);
  for (let x = -60; x <= 70; x += 9) {
    B.cyl('rubber', [x, -4.2, 15.9], [x, -2.4, 15.9], 0.75, 12);
    B.cyl('black', [x + 4, -1.8, 18.2], [x + 4, -1.1, 18.2], 0.3, 10);
  }
  // mooring lines: from ship bollards to quay bollards (catenary approximated by 3 segments)
  const lines = [[-59, 0.6, 12.5, -75, -1.2, 18.2], [-59.5, 0.6, 12.5, -66, -1.2, 18.2], [-52, 0.6, 13, -40, -1.2, 18.2], [52, 2.6, 12.5, 40, -1.2, 18.2], [60, 2.6, 11, 78, -1.2, 18.2], [60.5, 2.6, 10.8, 86, -1.2, 18.2]];
  for (const [x0, y0, z0, x1, y1, z1] of lines) {
    const mid = [(x0 + x1) / 2, Math.min(y0, y1) - 1.0, (z0 + z1) / 2];
    B.cyl('rope', [x0, y0, z0], mid, 0.05, 5); B.cyl('rope', mid, [x1, y1, z1], 0.05, 5);
  }
  // crane rails
  for (const z of [22.5, 44]) B.aabb(noBottom('steelDark'), -420, -1.8, z - 0.2, 420, -1.7, z + 0.2);
  for (const x of [-38, 12, 64]) buildCrane(B, x);
  // warehouses and a few buildings along the quay, light masts
  const bmat = ['cabinExt', 'bulkhead', 'concrete'];
  const R = TX.rng(9);
  for (let i = 0; i < 14; i++) {
    const x = -300 + i * 46 + R() * 10, w = 24 + R() * 16, d = 18 + R() * 16, h = 8 + R() * 12;
    B.aabb(bmat[i % 3], x, -1.8, 130, x + w, -1.8 + h, 130 + d);
    B.aabb('bulk', x - 0.2, -1.8 + h, 129.8, x + w + 0.2, -1.8 + h + 0.6, 130.2 + d);
  }
  for (let x = -200; x <= 200; x += 40) { B.cyl('bulk', [x, -1.8, 100], [x, 26, 100], 0.35, 8); B.box('lampOn', x, 26.2, 100, 3, 0.4, 1); }
  // breakwater + lighthouse across the harbour (port side)
  B.aabb('concrete', -520, -9, -330, 260, -5.4, -312, 'world', 0.1);
  for (let x = -500; x < 260; x += 7) B.geo('concrete', new THREE.TetrahedronGeometry(3.2, 0), x, -6, -309 + (x % 3), x * 0.1, 0.4, 0.3);
  B.cyl('white', [250, -5.4, -321], [250, 16, -321], 3.6, 18, 2.6);
  B.cyl('drumRed', [250, 3, -321], [250, 7, -321], 3.3, 18, 3.05);
  B.cyl('glass', [250, 16, -321], [250, 19.5, -321], 2.2, 12);
  B.cyl('drumRed', [250, 19.5, -321], [250, 21.5, -321], 2.5, 12, 0.3);
  B.box('lampOn', 250, 17.8, -321, 1.6, 1.6, 1.6);
  // anchored ships in the roads (silhouettes)
  const ship = (x, z, L, ry, col) => {
    const cs = Math.cos(ry), sn = Math.sin(ry);
    const P = (u, v) => [x + u * cs + v * sn, z - u * sn + v * cs];
    let p = P(0, 0); B.box('hull', p[0], -4.5, p[1], L, 6, L * 0.15, ry);
    p = P(-L * 0.38, 0); B.box('cabinExt', p[0], 2.5, p[1], L * 0.1, 8, L * 0.13, ry);
    for (let k = -3; k <= 2; k++) { p = P(k * L * 0.1, 0); B.box(col[(k + 3) % col.length], p[0], 0.5 + (k % 2) * 1.3, p[1], L * 0.09, 3 + (k % 2) * 2.6, L * 0.12, ry); } // narrower than the house: no shared side planes
  };
  ship(-260, -420, 150, 0.3, ['cont:red', 'cont:blue', 'cont:grey']);
  ship(120, -520, 190, -0.2, ['cont:green', 'cont:orange', 'cont:teal']);
  ship(-520, -160, 110, 1.2, ['cont:yellow', 'cont:maroon']);
  const bg = B.build(mats, { '*': { cast: false, receive: false } });
  // the cranes should cast onto the deck: re-enable for crane parts
  bg.traverse((o) => { if (o.isMesh && (o.name === 'crane' || o.name === 'craneWhite')) o.castShadow = true; });
  scene.add(bg);
  // container yard (instanced): ~700 boxes in rows behind the cranes
  const yardSide = TX.containerSide('white', 91, 20, 91);
  const ym = pbr(yardSide);
  const yg = new THREE.BoxGeometry(M.C20, M.CH, M.CW);
  const im = new THREE.InstancedMesh(yg, ym, 900);
  const cols = Object.values(TX.CONTAINER_COLORS).map((c) => new THREE.Color(c).multiplyScalar(1.6));
  const dummy = new THREE.Object3D();
  let n = 0;
  for (let row = 0; row < 12 && n < 900; row++) {
    const z = 56 + row * 6;
    for (let x = -260; x < 260 && n < 900; x += 6.5) {
      if (R() < 0.18) continue;
      const hgt = 1 + Math.floor(R() * 4);
      for (let k = 0; k < hgt && n < 900; k++) {
        dummy.position.set(x + (row % 2) * 1.2, -1.8 + M.CH / 2 + k * M.CH, z);
        dummy.rotation.set(0, PI / 2 + (R() < 0.5 ? 0 : PI), 0);
        dummy.updateMatrix();
        im.setMatrixAt(n, dummy.matrix);
        im.setColorAt(n, cols[Math.floor(R() * cols.length)]);
        n++;
      }
    }
  }
  im.count = n;
  im.receiveShadow = false; im.castShadow = false;
  scene.add(im);
  // hills and a hazy city skyline behind the port
  const hills = new THREE.Mesh(new THREE.CylinderGeometry(1500, 1700, 90, 64, 1, true, 0, PI), std({ color: 0x55604f, roughness: 1 }));
  hills.position.set(0, 30, 200); hills.rotation.y = PI / 2; hills.scale.set(1, 1, 0.8);
  scene.add(hills);
  const win = TX.cityWindows();
  const cityMat = std({ color: 0x8a8e94, roughness: 0.85, emissiveMap: win, emissive: new THREE.Color(1, 0.9, 0.8), emissiveIntensity: 0.25 });
  const cb = new THREE.BoxGeometry(1, 1, 1); cb.translate(0, 0.5, 0);
  const city = new THREE.InstancedMesh(cb, cityMat, 90);
  for (let i = 0; i < 90; i++) {
    const a = -1.2 + (i / 90) * 2.4, r = 700 + R() * 250;
    dummy.position.set(Math.sin(a) * r * 1.4, -2, 420 + Math.cos(a) * r * 0.6);
    dummy.scale.set(18 + R() * 30, 14 + Math.pow(R(), 2.5) * 80, 18 + R() * 30);
    dummy.rotation.set(0, R() * 3, 0);
    dummy.updateMatrix(); city.setMatrixAt(i, dummy.matrix);
  }
  scene.add(city);
  // far headlands on the open side
  const head = new THREE.Mesh(new THREE.ConeGeometry(420, 120, 12), std({ color: 0x4e5a5a, roughness: 1 }));
  head.position.set(-1100, 20, -900); head.scale.set(2.2, 1, 1); scene.add(head);
  const head2 = head.clone(); head2.position.set(900, 5, -1300); head2.scale.set(3, 0.7, 1.2); scene.add(head2);
}

// ------------------------------------------------------------------------------------------------ gulls
function makeGulls(scene) {
  const g = new THREE.BufferGeometry();
  // body + two wings as a single strip; wings flap by moving the tip vertices
  g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0.35, 0, 0, -0.3, -0.9, 0, 0, 0.9, 0, 0], 3));
  g.setIndex([0, 2, 1, 0, 1, 3]);
  g.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ color: 0xf2f2ee, side: THREE.DoubleSide, roughness: 0.8 });
  const birds = [];
  for (let i = 0; i < 14; i++) {
    const m = new THREE.Mesh(g.clone(), mat);
    m.userData = { r: 30 + Math.random() * 60, h: 18 + Math.random() * 22, s: (0.1 + Math.random() * 0.12) * (Math.random() < 0.5 ? -1 : 1), a: Math.random() * 7, f: 4 + Math.random() * 3, cx: -20 + Math.random() * 40, cz: -30 + Math.random() * 40 };
    scene.add(m); birds.push(m);
  }
  return (t) => {
    for (const b of birds) {
      const u = b.userData, a = u.a + t * u.s;
      b.position.set(u.cx + Math.cos(a) * u.r, u.h + Math.sin(t * 0.5 + u.a) * 2, u.cz + Math.sin(a) * u.r);
      b.rotation.set(0, -a + (u.s > 0 ? 0 : PI), Math.sin(t) * 0.2 * Math.sign(u.s));
      const p = b.geometry.attributes.position, flap = Math.sin(t * u.f + u.a) * 0.45;
      p.setY(2, flap); p.setY(3, flap); p.needsUpdate = true;
    }
  };
}

// Bounce light for the cabin interiors: a small radiance room (lamp panels in the ceiling, daylight at window
// height, warm floor, pale walls) prefiltered into an environment map for the interior materials. It lights the
// ceilings and corners the downlights can't reach, at no per-pixel light cost. (The sky map, dimmed, left them murky.)
function interiorEnvironment(renderer) {
  const s = new THREE.Scene(), C = (r, g, b) => new THREE.MeshBasicMaterial({ color: new THREE.Color(r, g, b), side: THREE.BackSide });
  const wall = C(0.2, 0.21, 0.19);
  s.add(new THREE.Mesh(new THREE.BoxGeometry(10, 3.2, 10), [wall, wall, C(0.15, 0.15, 0.14), C(0.12, 0.11, 0.095), wall, wall])); // +x -x +y -y +z -z
  const lamp = new THREE.MeshBasicMaterial({ color: new THREE.Color(6, 5, 3.8) });
  for (const [x, z] of [[-2.5, -2.5], [2.5, -2.5], [-2.5, 2.5], [2.5, 2.5]]) { const m = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.05, 0.3), lamp); m.position.set(x, 1.55, z); s.add(m); }
  const day = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.1, 1.0, 0.9) });
  for (const sx of [1, -1]) { const m = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.9, 6), day); m.position.set(sx * 4.95, 0.4, 0); s.add(m); }
  const pm = new THREE.PMREMGenerator(renderer), rt = pm.fromScene(s, 0.04);
  pm.dispose();
  s.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); for (const m of [].concat(o.material)) m.dispose(); } });
  return rt.texture;
}

// ------------------------------------------------------------------------------------------------ build
export function buildWorld(scene, opts = {}) {
  const mats = makeMaterials();
  // three.js only honours envMapIntensity when the material has its own envMap (scene.environment uses the
  // scene-wide intensity), so interior materials get the env map explicitly to stay dim
  for (const m of Object.values(mats)) if (m && m.isMaterial && m.envMapIntensity < 1) m.envMap = scene.environment;
  if (opts.renderer) {
    const inner = interiorEnvironment(opts.renderer);
    for (const [k, i] of [['cabinInt', 0.9], ['ceiling', 1.1], ['lino', 0.8], ['locker', 1.0], ['wood', 0.9], ['chart', 0.8]]) { mats[k].envMap = inner; mats[k].envMapIntensity = i; }
  }
  const B = new Batch();
  buildStructure(B);
  for (const c of M.containers) buildContainer(B, c, 'cont:' + c.color);
  buildShipDecor(B);
  // material table for container keys
  const table = { ...mats };
  for (const [col, e] of Object.entries(mats.cont)) {
    table[`cont:${col}:side20`] = e.side20; table[`cont:${col}:side40`] = e.side40 || e.side20;
    table[`cont:${col}:door`] = e.door; table[`cont:${col}:frame`] = e.frame; table[`cont:${col}`] = e.side20; table[`cont:${col}:end`] = e.end;
  }
  const ship = B.build(table, { rail: { cast: true }, lampOn: { cast: false, receive: false }, glass: { cast: false } });
  scene.add(ship);
  const hullG = new THREE.Group(); buildHull(hullG, mats); scene.add(hullG);
  // team emblems painted in each spawn hall and on the cabin fronts
  const emb = [TX.signTexture('SENTINELS', '#2e6fd0', null, 1024, 256, '900 150px Rubik, "Arial Black", sans-serif'), TX.signTexture('CORSAIRS', '#d0402e', null, 1024, 256, '900 150px Rubik, "Arial Black", sans-serif')];
  const big = [TX.signTexture('S', '#f2efe6', null, 256, 256, '900 220px Rubik, "Arial Black", sans-serif'), TX.signTexture('B', '#f2efe6', null, 256, 256, '900 220px Rubik, "Arial Black", sans-serif')];
  for (const t of [0, 1]) {
    const s = t ? -1 : 1;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(6, 1.5), new THREE.MeshStandardMaterial({ map: emb[t], transparent: true, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -2 }));
    m.position.set(s * -46.98, 2.75, s * 5.6); m.rotation.y = t ? -PI / 2 : PI / 2; scene.add(m);
    const b2 = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 2.6), new THREE.MeshStandardMaterial({ map: big[t], transparent: true, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -2 }));
    b2.position.set(s * -35.98, 5.0, s * 9.4); b2.rotation.y = t ? -PI / 2 : PI / 2; scene.add(b2);
  }
  buildHarbour(scene, table);
  const sea = makeSea(opts.quality || 1);
  scene.add(sea);
  const gulls = makeGulls(scene);
  // lights
  const hemi = new THREE.HemisphereLight(0xa9c1e0, 0x6b5a48, 0.22);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(SUN_COLOR, 3.1);
  sun.position.copy(SUN_DIR).multiplyScalar(120);
  sun.castShadow = true;
  // bias is in shadow-depth units (x (far - near) metres): -0.00005 x 150 m is under 1 cm, so shadows stay attached
  // to their casters. (-0.0004 over the old 250 m range was 10 cm: sunlight leaked under walls into the cabins.)
  sun.shadow.bias = -0.00005; sun.shadow.normalBias = 0.03;
  const sc = sun.shadow.camera;
  // extents measured in light space for this sun: ship length along 'up', height+beam (and crane booms) along 'right';
  // depth covers the casters only (crane boom tips at ~50 m from the light, crane backreach at ~180 m)
  sc.left = -13; sc.right = 44; sc.top = 72; sc.bottom = -67; sc.near = 40; sc.far = 190;
  // align the shadow camera's up with the ship's long axis so the box hugs the deck
  sun.shadow.camera.up.set(1, 0, 0);
  scene.add(sun); scene.add(sun.target);
  const points = [];
  if (opts.pointLights !== false) {
    // cabin ceiling lamps are downlights: a spot at the fixture aimed at the floor. (Omni lights hung just under
    // the ceiling threw a clipped hotspot onto the ceiling right above them.)
    const S = (x, y, z, i, d, a) => { const l = new THREE.SpotLight(0xffe2b8, i, d, a, 0.85, 2); l.position.set(x, y, z); l.target.position.set(x, y - 3, z); scene.add(l, l.target); points.push(l); };
    const P = (x, y, z, c, i, d) => { const l = new THREE.PointLight(c, i, d, 2); l.position.set(x, y, z); scene.add(l); points.push(l); };
    for (const s of [1, -1]) {
      // two across the hall, one in the stair room, one on the bridge (one per floor left the hall ends and the
      // stair room dark). ~22 cd from 2.7 m puts a warm pool on the floor well under clipping, and the cone never
      // reaches the ceiling. ponytail: every light costs every lit pixel on the map (three.js has no light culling),
      // so the bounce map does the fill and there is not one light per fixture
      for (const [x, y, z, i] of [[-41.5, 2.8, -5, 24], [-41.5, 2.8, 4, 24], [-40, 2.8, 11, 16], [-41.5, 6.2, -1, 24]]) S(s * x, y, s * z, i, 12, 1.4);
      P(s * -22, 0.7, s * 12.7, 0xffd9a0, 4, 18);
      P(s * 2, 0.7, s * 12.7, 0xffd9a0, 4, 18);
    }
  }
  // animated bits: radar scanner
  const radar = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.15, 4.2), mats.black);
  radar.position.set(-43, 15.7, 0); scene.add(radar);
  return {
    mats, sun, hemi, sea, points,
    update(t, cam) {
      sea.update(t, cam.position);
      gulls(t);
      radar.rotation.y = t * 2.2;
    },
    setShadowSize(sz) {
      sun.castShadow = sz > 0;
      if (sz > 0) { sun.shadow.mapSize.set(sz, sz); if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; } }
    },
  };
}
