// Sky, sun & moon, time of day, PMREM environment, stars, moon, volumetric clouds and fog.
// A 0-24 h clock drives everything: the Sky addon's scattering, the cascaded SunLight (the moon
// takes over after dusk), exposure, fog colour (sampled from the sky at the horizon ahead) and lamps.
import { THREE, V3, clamp, lerp, smooth, rng, renderer, scene, TAU, canvas, tfbm } from './core.js';
import { Sky } from 'three/addons/objects/Sky.js';
import { SunLight } from 'three/addons/lights/SunLight.js';

// ---------------------------------------------------------------- palette keyed by sun elevation (deg)
const KEYS = [
  // el,  sunCol,   sunI, hemiSky, hemiGnd, hemiI, key,  env,  turb, rayl, mie,   stars, cloudLit
  [-18, 0x8ea8ff, 0.5, 0x1a2a52, 0x0c0e14, 0.6, 0.34, 1.0, 2, 0.6, 0.003, 1.0, 0.06],
  [-9, 0x93a8f0, 0.45, 0x243258, 0x121418, 0.55, 0.42, 1.0, 3, 1.0, 0.004, 0.85, 0.1],
  [-3.5, 0xff8a60, 0.35, 0x4a4a82, 0x2a2224, 0.5, 0.8, 1.0, 4, 1.6, 0.005, 0.3, 0.3],
  [0, 0xff7a3a, 1.6, 0x8a80b0, 0x5a4034, 0.45, 1.05, 0.85, 4.5, 1.8, 0.006, 0.04, 0.7],
  [4, 0xff9240, 4.2, 0x9ea6d0, 0x6a5a44, 0.3, 1.18, 0.5, 4.2, 1.9, 0.0055, 0, 0.9],
  [10, 0xffb86c, 5.4, 0xaec4e6, 0x7a6a50, 0.26, 1.18, 0.42, 3.4, 1.8, 0.0042, 0, 1],
  // (with the sky in sun units, less Rayleigh keeps a high sun's sky blue down to the horizon instead of grey)
  [25, 0xffeedd, 6.5, 0xb8d0f0, 0x8a7a60, 0.22, 1.16, 0.34, 1.9, 1.3, 0.0026, 0, 1],
  [65, 0xfff8ee, 8.0, 0xc0d8f8, 0x8a7a60, 0.22, 1.14, 0.3, 1.7, 1.1, 0.0024, 0, 1],
];
const _ca = new THREE.Color(), _cb = new THREE.Color();
function palette(el) {
  let i = 0; while (i < KEYS.length - 2 && el > KEYS[i + 1][0]) i++;
  const A = KEYS[i], B = KEYS[i + 1], t = clamp((el - A[0]) / (B[0] - A[0]), 0, 1), u = t * t * (3 - 2 * t);
  const col = (k) => new THREE.Color().copy(_ca.setHex(A[k])).lerp(_cb.setHex(B[k]), u);
  const num = (k) => lerp(A[k], B[k], u);
  return { sunCol: col(1), sunI: num(2), hemiSky: col(3), hemiGnd: col(4), hemiI: num(5), key: num(6), env: num(7), turb: num(8), rayl: num(9), mie: num(10), stars: num(11), cloudLit: num(12) };
}

// ---------------------------------------------------------------- how the dome looks (the visible sky only)
// Preetham's horizon is a neutral grey whatever the turbidity, a low sun is a white glare and the sky opposite it
// goes brown. The visible dome (and the fog, which has to melt into it) keeps Preetham's brightness but takes its
// colour from these stops; the env map that lights the scene stays plain Preetham, so lighting doesn't change.
// Per sun elevation: dome gain, how much of Preetham's hue is replaced, a brightness boost away from the sun, an
// added twilight/night glow (radiance), and colour stops at the horizon, ~12° and the zenith, toward and away from the sun.
const LOOK = [
  // el, gain, rep, anti, twi,  toward the sun: horizon, 12°, zenith;   away: horizon, 12°, zenith
  [-18, 1, 0, 1, 0.55, 0x1e2a4c, 0x111a34, 0x080d1e, 0x1e2a4c, 0x111a34, 0x080d1e],
  [-9, 1, 0, 1, 0.13, 0xa4705c, 0x4a4c94, 0x16246a, 0x3a4680, 0x243276, 0x16246a],
  [-3.5, 1.2, 1, 2, 0.1, 0xff7a4a, 0xc0689a, 0x34469e, 0xb484a8, 0x4a64b0, 0x283e96],
  [0, 1.2, 0.95, 2, 0, 0xff8a3c, 0xf07a96, 0x3a58b8, 0xd8a0c0, 0x9090cc, 0x3050a8],
  [4, 1.3, 0.9, 1.7, 0, 0xffa050, 0xf4a09c, 0x4a6cc0, 0xf0b0c4, 0xa0a8d8, 0x3c62b8],
  [10, 1.45, 0.8, 1.15, 0, 0xffb870, 0xf4c8a4, 0x4a78c0, 0xeccad6, 0x9cb8e0, 0x3a6ab8],
  [25, 1.6, 0.8, 1, 0, 0xb2d2f2, 0x70a8dc, 0x2c62b2, 0xb0d0f2, 0x6ca4da, 0x2c62b2],
  [65, 1.6, 0.8, 1, 0, 0xb2d2f2, 0x70a8dc, 0x2c62b2, 0xb0d0f2, 0x6ca4da, 0x2c62b2],
];
const LOOK_C = LOOK.map((k) => k.slice(5).map((h) => new THREE.Color(h))); // hex -> linear
function look(el, U) {
  let i = 0; while (i < LOOK.length - 2 && el > LOOK[i + 1][0]) i++;
  const A = LOOK[i], B = LOOK[i + 1], t = clamp((el - A[0]) / (B[0] - A[0]), 0, 1), u = t * t * (3 - 2 * t);
  U.uDome.value = lerp(A[1], B[1], u); U.uRep.value = lerp(A[2], B[2], u); U.uAB.value = lerp(A[3], B[3], u); U.uTwi.value = lerp(A[4], B[4], u);
  ['uHs', 'uMs', 'uZs', 'uHa', 'uMa', 'uZa'].forEach((k, j) => U[k].value.copy(LOOK_C[i][j]).lerp(LOOK_C[i + 1][j], u));
}
// sunlight on the clouds by sun elevation: rgb, strength (relative to the day's)
const CLOUD = [[-12, 0.5, 0.32, 0.4, 0], [-8, 0.9, 0.36, 0.3, 0.006], [-5, 0.95, 0.26, 0.36, 0.06], [-2, 1, 0.34, 0.38, 0.32], [1, 1, 0.52, 0.38, 0.7], [4, 1, 0.64, 0.4, 0.85], [12, 1, 0.86, 0.7, 0.9], [30, 1, 0.96, 0.9, 0.9]];
function cloudLight(el, out) {
  let i = 0; while (i < CLOUD.length - 2 && el > CLOUD[i + 1][0]) i++;
  const A = CLOUD[i], B = CLOUD[i + 1], u = smooth(A[0], B[0], el), k = lerp(A[4], B[4], u);
  return out.setRGB(lerp(A[1], B[1], u) * k, lerp(A[2], B[2], u) * k, lerp(A[3], B[3], u) * k);
}
const _ry = new THREE.Matrix4(), _r3 = new THREE.Matrix3();
// the colour stops in a direction (mirrors skyGrad in the shader); ss = how much it faces the sun
const _g1 = new THREE.Color(), _g2 = new THREE.Color();
function skyGrad(dir, sd, U, out) {
  const e = Math.max(dir.y, 0), a = smooth(0, 0.2, e), b = smooth(0.12, 0.72, e);
  let ss = (dir.x * sd.x + dir.z * sd.z) / ((Math.hypot(dir.x, dir.z) + 1e-5) * (Math.hypot(sd.x, sd.z) + 1e-5)) * 0.5 + 0.5; ss = lerp(ss * ss, 0.5, b);
  _g1.copy(U.uHa.value).lerp(U.uMa.value, a).lerp(U.uZa.value, b); _g2.copy(U.uHs.value).lerp(U.uMs.value, a).lerp(U.uZs.value, b);
  out.copy(_g1).lerp(_g2, ss); return ss;
}

// ---------------------------------------------------------------- Preetham sky on the CPU (for fog colour)
const lambdaTR = new V3(5.804542996261093e-6, 1.3562911419845635e-5, 3.0265902468824876e-5);
const MieConst = new V3(1.8399918514433978e14, 2.7798023919660528e14, 4.0790479543861094e14);
// look = true gives the visible dome, false the env-map sky that lights the scene (plain Preetham and the old night glow)
const _gc = new THREE.Color();
function skyColor(dir, sunDir, U, night, out, look = true) {
  const e = Math.E, pi = Math.PI;
  const sunE = 1000 * Math.max(0, 1 - Math.pow(e, -((1.6110731556870734 - Math.acos(clamp(sunDir.y, -1, 1))) / 1.5)));
  const sunfade = 1 - clamp(1 - Math.exp(sunDir.y * 450000 / 450000), 0, 1);
  const rc = U.rayleigh.value - (1 - sunfade);
  const bR = lambdaTR.clone().multiplyScalar(rc);
  const c = 0.2 * U.turbidity.value * 10e-18, bM = MieConst.clone().multiplyScalar(0.434 * c * U.mieCoefficient.value);
  const zen = Math.acos(Math.max(0, dir.y)), inv = 1 / (Math.cos(zen) + 0.15 * Math.pow(93.885 - zen * 180 / pi, -1.253));
  const sR = 8.4e3 * inv, sM = 1.25e3 * inv;
  const Fex = new V3(Math.exp(-(bR.x * sR + bM.x * sM)), Math.exp(-(bR.y * sR + bM.y * sM)), Math.exp(-(bR.z * sR + bM.z * sM)));
  const cosT = dir.dot(sunDir), rP = 3 / (16 * pi) * (1 + Math.pow(cosT * 0.5 + 0.5, 2));
  const g = U.mieDirectionalG.value, mP = 1 / (4 * pi) * (1 - g * g) / Math.pow(1 - 2 * g * cosT + g * g, 1.5);
  const k = Math.pow(clamp(1 - sunDir.y, 0, 1), 5);
  const res = [0, 0, 0];
  for (let ch = 0; ch < 3; ch++) {
    const br = ['x', 'y', 'z'][ch], R = bR[br], M = bM[br], F = Fex[br];
    const ratio = (R * rP + M * mP) / (R + M);
    let Lin = Math.pow(sunE * ratio * (1 - F), 1.5);
    Lin *= lerp(1, Math.pow(sunE * ratio * F, 0.5), k);
    res[ch] = (Lin + 0.1 * F * (look ? 1 - night : 1)) * 0.04;
    res[ch] = res[ch] / (1 + res[ch] / 4) * U.uGain.value; // same compression and gain as the patched sky shader
  }
  // the same look as the patched sky shader
  if (look) {
    const ss = skyGrad(dir, sunDir, U, _gc), lm = 0.2126 * res[0] + 0.7152 * res[1] + 0.0722 * res[2], gl = Math.max(0.2126 * _gc.r + 0.7152 * _gc.g + 0.0722 * _gc.b, 1e-5);
    const k = U.uDome.value * lerp(U.uAB.value, 1, ss), r = U.uRep.value;
    for (let ch = 0; ch < 3; ch++) res[ch] = lerp(res[ch], lm * [_gc.r, _gc.g, _gc.b][ch] / gl, r) * k;
    const xl = (0.2126 * res[0] + 0.7152 * res[1] + 0.0722 * res[2]) * U.uExpo.value;
    if (xl > 0.8) for (let ch = 0; ch < 3; ch++) res[ch] *= (0.8 + (xl - 0.8) / (1 + (xl - 0.8) / 0.9)) / xl;
    const tw = U.uTwi.value; res[0] += _gc.r * tw; res[1] += _gc.g * tw; res[2] += _gc.b * tw;
  } else { const h = clamp(dir.y, 0, 1); res[0] += night * lerp(0.010, 0.0025, h); res[1] += night * lerp(0.014, 0.004, h); res[2] += night * lerp(0.03, 0.011, h); }
  return out.setRGB(res[0], res[1] + 0.0003, res[2] + 0.00075);
}

// ---------------------------------------------------------------- textures
function moonTex() {
  const S = 256, c = canvas(S, S), g = c.getContext('2d'), R = rng(17);
  const gr = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  gr.addColorStop(0, '#fffaf0'); gr.addColorStop(0.46, '#efe8dc'); gr.addColorStop(0.49, 'rgba(240,235,225,0.6)'); gr.addColorStop(0.5, 'rgba(0,0,0,0)');
  g.fillStyle = gr; g.fillRect(0, 0, S, S);
  g.globalCompositeOperation = 'source-atop';
  for (let i = 0; i < 9; i++) { g.fillStyle = `rgba(120,120,135,${0.18 + R() * 0.2})`; g.beginPath(); g.ellipse(S * (0.3 + R() * 0.4), S * (0.3 + R() * 0.4), S * (0.05 + R() * 0.1), S * (0.04 + R() * 0.08), R() * 3, 0, TAU); g.fill(); }
  for (let i = 0; i < 40; i++) { const x = S * (0.2 + R() * 0.6), y = S * (0.2 + R() * 0.6), r = 2 + R() * 6; g.strokeStyle = 'rgba(90,90,100,0.35)'; g.lineWidth = 1; g.beginPath(); g.arc(x, y, r, 0, TAU); g.stroke(); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function glowTex() {
  const S = 128, c = canvas(S, S), g = c.getContext('2d'), gr = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.2, 'rgba(255,255,255,0.35)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, S, S); return new THREE.CanvasTexture(c);
}
// The galactic frame, in the stars' own frame (which turns with the clock: rotation.y = h/24·τ/4). It's set so that at
// 23:00 the bright core sits 16° up in the north-east, over the mountains, and the band arches low across the north
// (peaking ~30° up) and sets over the sea in the south-west.
const ROT23 = 23 / 24 * TAU * 0.25, _deg = Math.PI / 180;
const _bearing = (b, e) => new V3(Math.sin(b * _deg) * Math.cos(e * _deg), Math.sin(e * _deg), -Math.cos(b * _deg) * Math.cos(e * _deg)).applyAxisAngle(new V3(0, 1, 0), -ROT23);
const GAL_C = _bearing(35, 16), GAL_N = new V3().crossVectors(GAL_C, _bearing(270, 16)).normalize();
const GAL_K = new V3().crossVectors(GAL_C, GAL_N);
// Milky Way: longitude across (tileable), latitude ±40° down. A dusty glowing band, wider and warmer at the core,
// clumped into star clouds, split by a dark rift along the plane and crossed by patchy dust lanes.
function milkyWay(W = 768, H = 192) {
  const data = new Uint8Array(W * H * 4), P = W / 48;
  for (let y = 0; y < H; y++) {
    const b = (y / (H - 1) - 0.5) * 80;
    for (let x = 0; x < W; x++) {
      const l = x / W * 360, lw = l > 180 ? l - 360 : l, core = Math.exp(-((lw / 36) ** 2));
      const sig = 4.5 + 7 * core + 3 * tfbm(x / 48, 2.5, P, 2), bc = b + 1.2 * Math.sin(l * 0.035) - 1;
      if (Math.abs(bc) > sig * 3.2) continue;
      const band = Math.exp(-((bc / sig) ** 2)), clump = tfbm(x / 26, y / 26 + 20, W / 26, 5);
      let I = band * (0.45 + 0.55 * core) * (0.45 + 1.1 * clump * clump) + core * 0.5 * Math.exp(-((bc / (5 + 3 * core)) ** 2));
      // the rift: a sinuous dark lane just off the plane, over ±75° of the core, plus patchy dust
      const rift = Math.exp(-(((bc - 1.4 - 3 * (tfbm(x / 40, 7.1, W / 40, 3) - 0.5)) / (1.3 + 1.2 * core)) ** 2)) * smooth(85, 30, Math.abs(lw));
      const dust = clamp(tfbm(x / 14 + 9, y / 14, W / 14, 4) * 1.9 - 0.75, 0, 1) * band;
      I *= (1 - 0.8 * rift) * (1 - 0.7 * dust) * (0.75 + 0.5 * tfbm(x / 3, y / 3, W / 3, 2));
      // warm bulge, cooler arms, dust-reddened edges
      const w = core * 0.8 + dust * 0.3, i = (y * W + x) * 4, v = clamp(I, 0, 1.6) / 1.6 * 255;
      data[i] = v * lerp(0.8, 1.0, w); data[i + 1] = v * lerp(0.86, 0.84, w); data[i + 2] = v * lerp(1.0, 0.66, w); data[i + 3] = 255;
    }
  }
  const t = new THREE.DataTexture(data, W, H); t.wrapS = THREE.RepeatWrapping; t.magFilter = t.minFilter = THREE.LinearFilter; t.colorSpace = THREE.SRGBColorSpace; t.needsUpdate = true;
  return t;
}
// tileable 3D noise for the clouds: R = billowy Perlin-Worley, G = Worley detail
function cloudNoise(N = 64) {
  const data = new Uint8Array(N * N * N * 4), R = rng(42);
  const worley = (cells) => {
    const pts = new Float32Array(cells * cells * cells * 3);
    for (let i = 0; i < pts.length; i++) pts[i] = R();
    return (x, y, z) => { // x,y,z in [0,1)
      const fx = x * cells, fy = y * cells, fz = z * cells, ix = Math.floor(fx), iy = Math.floor(fy), iz = Math.floor(fz);
      let best = 9;
      for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const cx = ix + dx, cy = iy + dy, cz = iz + dz, wx = ((cx % cells) + cells) % cells, wy = ((cy % cells) + cells) % cells, wz = ((cz % cells) + cells) % cells;
        const k = ((wz * cells + wy) * cells + wx) * 3, px = cx + pts[k], py = cy + pts[k + 1], pz = cz + pts[k + 2];
        const d = (px - fx) ** 2 + (py - fy) ** 2 + (pz - fz) ** 2; if (d < best) best = d;
      }
      return Math.sqrt(best);
    };
  };
  const w1 = worley(4), w2 = worley(8), w3 = worley(16);
  // tileable value noise for the Perlin-ish base
  const P = 8, grid = new Float32Array(P * P * P); for (let i = 0; i < grid.length; i++) grid[i] = R();
  const vn = (x, y, z, p) => {
    const fx = x * p, fy = y * p, fz = z * p, ix = Math.floor(fx), iy = Math.floor(fy), iz = Math.floor(fz), u = fx - ix, v = fy - iy, w = fz - iz;
    const s = (a) => a * a * (3 - 2 * a), su = s(u), sv = s(v), sw = s(w);
    const at = (a, b, c) => grid[(((c % p) + p) % p % P) * P * P + (((b % p) + p) % p % P) * P + (((a % p) + p) % p % P)];
    const l = (a, b, t) => a + (b - a) * t;
    return l(l(l(at(ix, iy, iz), at(ix + 1, iy, iz), su), l(at(ix, iy + 1, iz), at(ix + 1, iy + 1, iz), su), sv), l(l(at(ix, iy, iz + 1), at(ix + 1, iy, iz + 1), su), l(at(ix, iy + 1, iz + 1), at(ix + 1, iy + 1, iz + 1), su), sv), sw);
  };
  for (let z = 0; z < N; z++) for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const u = x / N, v = y / N, w = z / N;
    const per = (vn(u, v, w, 4) * 0.55 + vn(u, v, w, 8) * 0.3 + vn(u, v, w, 8) * 0.15);
    const wf = 1 - (w1(u, v, w) * 0.625 + w2(u, v, w) * 0.25 + w3(u, v, w) * 0.125) * 1.1;
    const pw = clamp(per * 0.6 + wf * 0.6 - 0.2, 0, 1);
    const i = ((z * N + y) * N + x) * 4;
    data[i] = pw * 255; data[i + 1] = clamp(1 - (w2(u, v, w) * 0.6 + w3(u, v, w) * 0.4), 0, 1) * 255; data[i + 2] = 0; data[i + 3] = 255;
  }
  const t = new THREE.Data3DTexture(data, N, N, N);
  t.format = THREE.RGBAFormat; t.type = THREE.UnsignedByteType; t.wrapS = t.wrapT = t.wrapR = THREE.RepeatWrapping;
  t.minFilter = t.magFilter = THREE.LinearFilter; t.unpackAlignment = 1; t.needsUpdate = true;
  return t;
}

// clouds and stars sit on the far plane (like the sky dome), behind everything including the mountains 5-16 km off
const CLOUD_VS = /* glsl */`varying vec3 vWorld; void main(){ vec4 w = modelMatrix * vec4(position,1.0); vWorld = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; gl_Position.z = gl_Position.w; }`;
const CLOUD_FS = /* glsl */`
precision highp sampler3D;
uniform sampler3D uNoise; uniform vec3 uSunDir, uSunCol, uAmbTop, uAmbBot, uHaze; uniform float uTime, uCover, uLit, uHazeK;
varying vec3 vWorld;
const float BASE = 1300.0, TOP = 2600.0;
float dens(vec3 p, bool detail) {
  vec3 q = p * 0.00017 + vec3(uTime * 0.0022, 0.0, uTime * 0.001);
  vec4 n = texture(uNoise, q);
  float h = clamp((p.y - BASE) / (TOP - BASE), 0.0, 1.0);
  float shape = smoothstep(0.0, 0.12, h) * smoothstep(1.0, 0.35, h);
  float cov = texture(uNoise, p * 0.000035 + vec3(0.3, 0.1, uTime * 0.0003)).r;
  float c = n.r * shape - (1.0 - uCover * (0.65 + 0.7 * cov));
  if (detail && c > 0.0) c -= texture(uNoise, q * 3.3 + 0.37).g * 0.22 * (1.0 - c);
  return max(0.0, c) * 3.0;
}
float hg(float c, float g) { float g2 = g * g; return (1.0 - g2) / pow(1.0 + g2 - 2.0 * g * c, 1.5) * 0.0795775; }
void main() {
  vec3 rd = normalize(vWorld - cameraPosition);
  if (rd.y < 0.012) discard;
  float t0 = (BASE - cameraPosition.y) / rd.y, t1 = (TOP - cameraPosition.y) / rd.y;
  t1 = min(t1, t0 + 5000.0);
  float dt = (t1 - t0) / float(STEPS);
  float jit = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
  float T = 1.0; vec3 col = vec3(0.0);
  float mu = dot(rd, uSunDir);
  float ph = mix(hg(mu, 0.65), hg(mu, -0.2), 0.35) * 6.0 + 0.25;
  for (int i = 0; i < STEPS; i++) {
    vec3 p = cameraPosition + rd * (t0 + (float(i) + jit) * dt);
    float d = dens(p, true);
    if (d > 0.002) {
      float ld = 0.0;
      for (int j = 1; j <= LSTEPS; j++) ld += dens(p + uSunDir * (float(j * j) * 70.0), false);
      float beer = exp(-ld * 1.4), powder = 1.0 - exp(-d * 4.0);
      float h = clamp((p.y - BASE) / (TOP - BASE), 0.0, 1.0);
      vec3 L = uSunCol * uLit * beer * mix(1.0, powder * 2.0, 0.5) * ph + mix(uAmbBot, uAmbTop, h);
      float a = 1.0 - exp(-d * dt * 0.012);
      col += T * a * L; T *= 1.0 - a;
      if (T < 0.03) break;
    }
  }
  col = col / (1.0 + col / 3.0);
  float alpha = 1.0 - T;
  // aerial perspective: far clouds melt into the horizon haze
  float far = 1.0 - exp(-t0 * uHazeK);
  col = mix(col, uHaze * alpha, far);
  float fade = smoothstep(0.012, 0.09, rd.y);
  gl_FragColor = vec4(col * fade, alpha * fade);
}`;

export class SkySystem {
  constructor(quality = 2) {
    this.hour = 18.2; this.sunDir = new V3(); this.moonDir = new V3(); this.lightDir = new V3(); this.el = 0; this.night = 0;
    // sky dome
    const sky = this.sky = new Sky(); sky.scale.setScalar(15000); sky.name = 'sky'; scene.add(sky);
    this.U = sky.material.uniforms;
    this.U.cloudCoverage.value = 0.12; this.U.cloudScale.value = 0.00015; this.U.cloudElevation.value = 0.8; this.U.cloudDensity.value = 0.25;
    this.mwTex = milkyWay(); this.gal = new THREE.Matrix3().set(GAL_C.x, GAL_C.y, GAL_C.z, GAL_N.x, GAL_N.y, GAL_N.z, GAL_K.x, GAL_K.y, GAL_K.z);
    this.patchNight(sky.material);
    // env-map sky (no sun disc, no clouds)
    this.envScene = new THREE.Scene(); this.envSky = new Sky(); this.envSky.scale.setScalar(1000); this.envScene.add(this.envSky);
    this.envSky.material.uniforms.showSunDisc.value = 0; this.envSky.material.uniforms.cloudCoverage.value = 0;
    this.patchNight(this.envSky.material); this.envSky.material.uniforms.uEnv.value = 1;
    this.pmrem = new THREE.PMREMGenerator(renderer); this.envRT = null; this.lastBake = -1e9; this.bakedEl = -999;
    // sun (the moon borrows it at night): cascaded shadows from the SunLight addon
    const sun = this.sun = new SunLight(0xffffff, 3);
    sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.00025; sun.shadow.normalBias = 0.02; sun.shadow.radius = 2.5;
    sun.shadow.camera.far = 60;
    scene.add(sun);
    this.hemi = new THREE.HemisphereLight(0xbfd4ff, 0x6a5a44, 0.35); scene.add(this.hemi);
    // stars: a field over the sky plus a crowd along the Milky Way; a few bright ones, many faint, tinted by temperature
    const R = rng(3), n = 6000, sp = new Float32Array(n * 3), sz = new Float32Array(n), tw = new Float32Array(n), sc = new Float32Array(n * 3);
    const TEMP = [[0.72, 0.82, 1.0], [0.86, 0.9, 1.0], [1.0, 1.0, 1.0], [1.0, 0.93, 0.8], [1.0, 0.8, 0.6]], v = new V3();
    for (let i = 0; i < n; i++) {
      if (i < 2600) { // galactic plane: latitude spread wider at the core
        const l = (R() < 0.35 ? (R() - 0.5) * 1.4 : (R() - 0.5) * TAU), gb = (R() + R() + R() - 1.5) * (0.07 + 0.12 * Math.exp(-l * l / 0.4));
        v.set(0, 0, 0).addScaledVector(GAL_C, Math.cos(gb) * Math.cos(l)).addScaledVector(GAL_N, Math.sin(gb)).addScaledVector(GAL_K, Math.cos(gb) * Math.sin(l));
      } else { const u = R() * 2 - 1, a = R() * TAU, r = Math.sqrt(1 - u * u); v.set(r * Math.cos(a), Math.abs(u) * 0.95 + 0.05, r * Math.sin(a)); }
      v.normalize().multiplyScalar(9000); sp.set([v.x, v.y, v.z], i * 3);
      const m = Math.pow(R(), i < 2600 ? 7 : 5); // most are faint
      sz[i] = 0.9 + m * 3.2; tw[i] = R() * TAU;
      const c = TEMP[Math.min(4, Math.floor(Math.pow(R(), 0.8) * 5))], br = 0.12 + 0.2 * R() + m * 1.4;
      sc.set([c[0] * br, c[1] * br, c[2] * br], i * 3);
    }
    const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.BufferAttribute(sp, 3)); sg.setAttribute('size', new THREE.BufferAttribute(sz, 1)); sg.setAttribute('tw', new THREE.BufferAttribute(tw, 1)); sg.setAttribute('starCol', new THREE.BufferAttribute(sc, 3));
    this.starMat = new THREE.ShaderMaterial({
      uniforms: { uA: { value: 0 }, uT: { value: 0 }, uPR: { value: renderer.getPixelRatio() } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      // a gentle twinkle, stronger low in the sky (more air), and extinction at the horizon
      vertexShader: 'attribute float size; attribute float tw; attribute vec3 starCol; uniform float uT; uniform float uPR; varying vec3 vC; void main(){ vec4 mv = modelViewMatrix*vec4(position,1.0); gl_Position = projectionMatrix*mv; gl_Position.z = gl_Position.w; float y = normalize(position).y; vC = starCol * (1.0 - (0.12 + 0.2 * (1.0 - y)) * (0.5 + 0.5 * sin(uT*(2.1 + fract(tw)*2.0) + tw*7.0))) * smoothstep(0.0, 0.2, y); gl_PointSize = size * uPR * 1.6; }',
      fragmentShader: 'uniform float uA; varying vec3 vC; void main(){ vec2 d = gl_PointCoord - 0.5; float a = smoothstep(0.5, 0.0, length(d)); a *= a; gl_FragColor = vec4(vC * a * uA * 2.5, a * uA); }',
    });
    this.stars = new THREE.Points(sg, this.starMat); this.stars.frustumCulled = false; this.stars.renderOrder = -2; scene.add(this.stars);
    // moon + halo
    this.moon = new THREE.Mesh(new THREE.PlaneGeometry(566, 566), new THREE.MeshBasicMaterial({ map: moonTex(), transparent: true, depthWrite: false, fog: false, color: new THREE.Color(2.2, 2.2, 2.1) }));
    this.halo = new THREE.Mesh(new THREE.PlaneGeometry(3050, 3050), new THREE.MeshBasicMaterial({ map: glowTex(), transparent: true, depthWrite: false, fog: false, blending: THREE.AdditiveBlending, color: new THREE.Color(0.25, 0.3, 0.45) }));
    this.moon.renderOrder = this.halo.renderOrder = -1; scene.add(this.moon, this.halo);
    // volumetric clouds (raymarched slab in a camera-centred dome)
    this.cloudQ = -1; this.cloudNoise = cloudNoise(64);
    this.cloudMat = new THREE.ShaderMaterial({
      uniforms: { uNoise: { value: this.cloudNoise }, uSunDir: { value: new V3() }, uSunCol: { value: new THREE.Color() }, uAmbTop: { value: new THREE.Color() }, uAmbBot: { value: new THREE.Color() }, uHaze: { value: new THREE.Color() }, uTime: { value: 0 }, uCover: { value: 0.7 }, uLit: { value: 1 }, uHazeK: { value: 0.00012 } },
      vertexShader: CLOUD_VS, fragmentShader: CLOUD_FS, side: THREE.BackSide, transparent: true, depthWrite: false,
      blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor, defines: { STEPS: 24, LSTEPS: 3 },
    });
    this.clouds = new THREE.Mesh(new THREE.SphereGeometry(9500, 32, 16), this.cloudMat); this.clouds.frustumCulled = false; this.clouds.renderOrder = -1; this.clouds.name = 'clouds';
    scene.add(this.clouds);
    this.setQuality(quality);
    this.fogCol = new THREE.Color(); this.set(this.hour);
  }
  patchNight(mat) {
    const u = mat.uniforms;
    u.uNight = { value: 0 }; u.uGain = { value: 1 }; u.uEnv = { value: 0 }; u.uExpo = { value: 0 }; u.uDome = { value: 1 }; u.uRep = { value: 0 }; u.uAB = { value: 1 }; u.uTwi = { value: 0 }; u.uMWk = { value: 0 };
    for (const k of ['uHs', 'uMs', 'uZs', 'uHa', 'uMa', 'uZa']) u[k] = { value: new THREE.Color() };
    u.uMW = { value: this.mwTex }; u.uGal = { value: new THREE.Matrix3() };
    mat.fragmentShader = mat.fragmentShader.replace('uniform float time;', `uniform float time;
      uniform float uNight, uGain, uEnv, uExpo, uDome, uRep, uAB, uTwi, uMWk; uniform vec3 uHs, uMs, uZs, uHa, uMa, uZa; uniform sampler2D uMW; uniform mat3 uGal;
      // value noise (the Milky Way's grain)
      float h3(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
      float vn3(vec3 p) { vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(mix(h3(i), h3(i + vec3(1, 0, 0)), f.x), mix(h3(i + vec3(0, 1, 0)), h3(i + vec3(1, 1, 0)), f.x), f.y),
                   mix(mix(h3(i + vec3(0, 0, 1)), h3(i + vec3(1, 0, 1)), f.x), mix(h3(i + vec3(0, 1, 1)), h3(i + vec3(1, 1, 1)), f.x), f.y), f.z); }
      // colour stops (horizon, ~12°, zenith) toward and away from the sun; ss = how much d faces the sun
      vec3 skyGrad(vec3 d, vec3 sd, out float ss) {
        float e = max(d.y, 0.0), a = smoothstep(0.0, 0.2, e), b = smoothstep(0.12, 0.72, e);
        ss = dot(d.xz, sd.xz) / ((length(d.xz) + 1e-5) * (length(sd.xz) + 1e-5)) * 0.5 + 0.5; ss = mix(ss * ss, 0.5, b);
        return mix(mix(mix(uHa, uMa, a), uZa, b), mix(mix(uHs, uMs, a), uZs, b), ss);
      }`)
      // soft-compress the in-scattered glow around a low sun so golden hour isn't a white-out; uGain puts the
      // sky in the same units as the sun light (see update). Then the look: Preetham's brightness, the stops' colour
      // (uRep of it), a boost away from the sun, and the twilight/night glow. The Milky Way is painted on at night.
      .replace('vec3 texColor = ( Lin + L0 ) * 0.04 + sundiscColor + vec3( 0.0, 0.0003, 0.00075 );', `vec3 scat = ( Lin + L0 * ( 1.0 - uNight * ( 1.0 - uEnv ) ) ) * 0.04; scat = scat / ( 1.0 + scat / 4.0 );
      vec3 texColor = scat * uGain;
      float ss; vec3 gcol = skyGrad( direction, vSunDirection, ss );
      const vec3 LUM = vec3( 0.2126, 0.7152, 0.0722 );
      texColor = mix( texColor, dot( texColor, LUM ) * gcol / max( dot( gcol, LUM ), 1e-5 ), uRep ) * uDome * mix( uAB, 1.0, ss );
      // a soft shoulder (in exposed units, visible dome only) so the glow round a low sun stays gold instead of clipping white
      float xl = dot( texColor, LUM ) * uExpo;
      if ( xl > 0.8 ) texColor *= ( 0.8 + ( xl - 0.8 ) / ( 1.0 + ( xl - 0.8 ) / 0.9 ) ) / xl;
      // the env map keeps the old night glow, so the lighting doesn't change
      texColor += sundiscColor * 0.3 * uGain + ( uEnv > 0.5 ? uNight * mix( vec3( 0.010, 0.014, 0.03 ), vec3( 0.0025, 0.004, 0.011 ), clamp( direction.y, 0.0, 1.0 ) ) : gcol * uTwi ) + vec3( 0.0, 0.0003, 0.00075 );
      if ( uMWk > 0.0 ) {
        vec3 g = uGal * direction; float gb = asin( clamp( g.y, -1.0, 1.0 ) );
        // the texture carries the band, rift and dust; a fine grain breaks it into star clouds
        if ( abs( gb ) < 0.69 ) texColor += uMWk * texture2D( uMW, vec2( atan( g.z, g.x ) * 0.1591549, gb / 1.3963 + 0.5 ) ).rgb * smoothstep( -0.01, 0.25, direction.y )
          * ( 0.3 + 0.9 * vn3( g * 160.0 ) * ( 0.4 + 0.9 * vn3( g * 470.0 + 3.1 ) ) );
      }`)
      .replace('cloudColor *= max( dayFactor, 0.03 );', 'cloudColor *= max( dayFactor, 0.03 ) * uGain;'); // the 2D clouds in the same units as the dome
    mat.needsUpdate = true;
  }
  setQuality(q) {
    if (q === this.cloudQ) return; this.cloudQ = q;
    const steps = [0, 12, 20, 28][q] || 0, ls = q >= 3 ? 4 : q >= 2 ? 3 : 2;
    this.clouds.visible = steps > 0;
    this.U.cloudCoverage.value = steps > 0 ? 0.12 : 0.42; // fall back to the addon's 2D clouds on low
    if (steps) { this.cloudMat.defines.STEPS = steps; this.cloudMat.defines.LSTEPS = ls; this.cloudMat.needsUpdate = true; }
    this.sun.shadow.mapSize.setScalar(q >= 3 ? 2048 : q >= 1 ? 1536 : 1024);
    if (this.sun.shadow.map) { this.sun.shadow.map.dispose(); this.sun.shadow.map = null; }
  }
  // sun path: rises in the east (+x) at 05:00, ~65° to the south at noon, sets over the western sea at 19:00
  static sunAt(h, out) {
    const th = (h - 5) / 14 * Math.PI, e = 65 * Math.PI / 180;
    return out.set(Math.cos(th), Math.sin(th) * Math.sin(e), Math.sin(th) * Math.cos(e)).normalize();
  }
  set(hour) { this.hour = ((hour % 24) + 24) % 24; }
  // advance the clock; the pretty low-sun hours pass more slowly
  advance(dt, minutesPerDay = 12) {
    const slow = Math.abs(this.el) < 12 ? 0.3 : 1;
    this.set(this.hour + dt * 24 / (minutesPerDay * 60) * slow);
  }
  isGolden() { return this.el > 0.5 && this.el < 11; }
  // the visible sky's colour in a direction (for the sea's reflection of it)
  colorAt(dir, out) { return skyColor(dir, this.sunDir, this.U, this.night, out); }
  update(dt, t, camera, focus) {
    const h = this.hour;
    SkySystem.sunAt(h, this.sunDir);
    // moon roughly opposite the sun, offset so it isn't a mirror image; a low arc (it rises over the eastern range in
    // the blue hour and hangs ~25° up over the southern bay at 23:00), so it draws a long path on the sea
    const th = (h - 5) / 14 * Math.PI + Math.PI + 0.45, e = 26 * Math.PI / 180;
    this.moonDir.set(Math.cos(th), Math.sin(th) * Math.sin(e), Math.sin(th) * Math.cos(e)).normalize();
    const el = this.el = Math.asin(this.sunDir.y) * 180 / Math.PI;
    const P = this.P = palette(el);
    this.night = smooth(1, -7, el);
    const U = this.U;
    U.sunPosition.value.copy(this.sunDir).multiplyScalar(4000);
    U.turbidity.value = P.turb; U.rayleigh.value = P.rayl; U.mieCoefficient.value = P.mie * 0.6; U.mieDirectionalG.value = 0.86;
    U.time.value = t; U.uNight.value = this.night;
    // The addon's sky radiance is in arbitrary units: at noon its horizon was brighter than a sunlit white
    // feather, so the sky, the sea reflecting it and the fogged distance all went milky grey. The palette's env
    // factor already scaled it into sun-light units for the lighting; apply the same factor to the visible dome,
    // the fog and the clouds' ambient, so what you see matches what lights the scene.
    U.uGain.value = P.env;
    look(el, U);
    // the Milky Way turns with the stars; it shows once it's properly dark
    U.uMWk.value = 0.12 * smooth(-10, -16, el); U.uGal.value.copy(this.gal).multiply(_r3.setFromMatrix4(_ry.makeRotationY(-h / 24 * TAU * 0.25)));
    // light: the sun, or the moon once the sun is well down
    const useMoon = el < -4;
    this.lightDir.copy(useMoon ? this.moonDir : this.sunDir);
    if (this.lightDir.y < 0.12) this.lightDir.y = 0.12, this.lightDir.normalize(); // keep shadows sane at the horizon
    this.sun.position.copy(this.lightDir);
    this.sun.color.copy(P.sunCol);
    const horizonFade = useMoon ? smooth(-0.05, 0.25, this.moonDir.y) : smooth(-2.5, 1.5, el);
    this.sun.intensity = P.sunI * horizonFade;
    this.hemi.color.copy(P.hemiSky); this.hemi.groundColor.copy(P.hemiGnd); this.hemi.intensity = P.hemiI;
    scene.environmentIntensity = 1; // the baked env map carries the sky gain
    // auto exposure: a sunlit (or moonlit) white feather lands on the palette's key value
    const lum = (c) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
    const white = 0.8 * ((this.ambLum || 0.1) + this.sun.intensity * lum(this.sun.color) / Math.PI + P.hemiI * lum(P.hemiSky) / Math.PI);
    const exp = clamp(0.6 * P.key / Math.max(white, 1e-3), 0.05, 4.5);
    this.exposure = this.exposure ? lerp(this.exposure, exp, 1 - Math.exp(-4 * dt)) : exp;
    renderer.toneMappingExposure = this.exposure * (this.exposureBias || 1);
    U.uExpo.value = renderer.toneMappingExposure / 0.6;
    // stars and moon
    this.starMat.uniforms.uA.value = P.stars; this.starMat.uniforms.uT.value = t; this.stars.position.copy(camera.position);
    this.stars.rotation.y = h / 24 * TAU * 0.25;
    const md = this.moonDir, mvis = smooth(-0.04, 0.05, md.y);
    this.moon.visible = this.halo.visible = mvis > 0.01;
    // beyond the mountains (they reach 16 km), inside the far plane
    this.moon.position.copy(camera.position).addScaledVector(md, 18500); this.moon.lookAt(camera.position);
    this.halo.position.copy(camera.position).addScaledVector(md, 18650); this.halo.lookAt(camera.position);
    this.moon.material.opacity = mvis; this.halo.material.opacity = mvis * (0.4 + 0.6 * this.night);
    // clouds
    this.clouds.position.copy(camera.position);
    const cu = this.cloudMat.uniforms;
    // The sun lights the clouds until well after it sets: from below the horizon it reaches their bellies but not their
    // tops (the light march runs down through the cloud), gold at golden hour, pink-red in the afterglow, then only a
    // warm rim toward the west in the blue hour. After that the moon takes over.
    const cloudMoon = el < -9;
    cu.uTime.value = t; cu.uSunDir.value.copy(cloudMoon ? this.moonDir : this.sunDir);
    if (cloudMoon) { cu.uSunCol.value.copy(P.sunCol).multiplyScalar(0.05); cu.uLit.value = P.cloudLit; } else { cloudLight(el, cu.uSunCol.value); cu.uLit.value = 1; }
    // ambient on the clouds: sky colour above, a warmer/darker bounce below
    skyColor(new V3(0, 1, 0), this.sunDir, U, this.night, cu.uAmbTop.value, false); cu.uAmbTop.value.multiplyScalar(1.4);
    skyColor(new V3(this.sunDir.x, 0.15, this.sunDir.z).normalize(), this.sunDir, U, this.night, cu.uAmbBot.value, el > -5); cu.uAmbBot.value.multiplyScalar(0.55); // blue hour: plain sky, so clouds go dark
    // fog colour: the sky just above the horizon in the direction the camera looks
    const fw = camera.getWorldDirection(new V3()); fw.y = 0; if (fw.lengthSq() < 1e-6) fw.set(0, 0, 1); fw.normalize(); fw.y = 0.035; fw.normalize();
    skyColor(fw, this.sunDir, U, this.night, this.fogCol);
    cu.uHaze.value.copy(this.fogCol);
    scene.fog.color.copy(this.fogCol);
    scene.fog.density = lerp(0.0005, 0.0012, smooth(10, -3, el)) * (this.fogBias || 1);
    // re-bake the environment when the sun has moved enough
    if (Math.abs(el - this.bakedEl) > 0.6 || t - this.lastBake > 20) this.bake(t);
  }
  bake(t) {
    const E = this.envSky.material.uniforms, U = this.U;
    E.sunPosition.value.copy(U.sunPosition.value); E.turbidity.value = U.turbidity.value; E.rayleigh.value = U.rayleigh.value;
    E.mieCoefficient.value = U.mieCoefficient.value; E.mieDirectionalG.value = U.mieDirectionalG.value; E.uNight.value = U.uNight.value; E.uGain.value = U.uGain.value;
    // the env map lights the scene: it keeps plain Preetham and the old night glow, not the dome's look
    // cosine-weighted sky luminance (stratified), used by the auto exposure
    let sum = 0, n = 0; const d = new V3(), c = new THREE.Color();
    for (let i = 0; i < 12; i++) for (let j = 0; j < 16; j++) {
      const u = (i + 0.5) / 12, a = (j + 0.5) / 16 * TAU, y = Math.sqrt(u), r = Math.sqrt(1 - u);
      skyColor(d.set(r * Math.cos(a), Math.max(y, 0.02), r * Math.sin(a)).normalize(), this.sunDir, U, this.night, c, false);
      sum += 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b; n++;
    }
    this.ambLum = sum / n;
    const old = this.envRT;
    this.envRT = this.pmrem.fromScene(this.envScene, 0, 0.1, 2000, { size: 128 });
    scene.environment = this.envRT.texture;
    if (old) old.dispose();
    this.lastBake = t; this.bakedEl = this.el;
  }
}
