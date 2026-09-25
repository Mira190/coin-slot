// Coin Slot lobby, WebGL layer: the night-time arcade hall behind the hero, and a 3D machine
// rendered into every mini-cabinet link. Purely decorative: the DOM in index.html stays the source of truth.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const easeOut = (t) => 1 - Math.pow(1 - clamp(t, 0, 1), 3);
const easeInOut = (t) => { t = clamp(t, 0, 1); return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; };
const mq = (q) => window.matchMedia(q).matches;

export async function start(L) {
  const phone = mq('(max-width: 700px)') || mq('(pointer: coarse)');
  let lite = phone;
  const MAX_DPR = phone ? 1.5 : 1.75;   // ponytail: fixed caps; adaptive drop below handles slow laptops
  try { await Promise.race([document.fonts.load('400 80px Bungee'), new Promise((r) => setTimeout(r, 1500))]); } catch (e) { /* ignore */ }

  // ---------------------------------------------------------------- shared assets
  const texCache = new Map();
  function canvasTex(key, w, h, draw, srgb = true) {
    if (texCache.has(key)) return texCache.get(key);
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    draw(c.getContext('2d'), w, h);
    const t = new THREE.CanvasTexture(c);
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    texCache.set(key, t);
    return t;
  }
  const glowTex = canvasTex('glow', 128, 128, (c, w, h) => {
    const g = c.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.35, 'rgba(255,255,255,.35)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g; c.fillRect(0, 0, w, h);
  }, false);
  const beamTex = canvasTex('beam', 8, 128, (c, w, h) => {
    const g = c.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.7, 'rgba(255,255,255,.55)'); g.addColorStop(1, 'rgba(255,255,255,.9)');
    c.fillStyle = g; c.fillRect(0, 0, w, h);
  }, false);

  function marqueeTex(title, color) {
    return canvasTex('mq:' + title, 512, 136, (c, w, h) => {
      const g = c.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, '#1a1440'); g.addColorStop(0.5, '#2c1f5e'); g.addColorStop(1, '#120e2c');
      c.fillStyle = g; c.fillRect(0, 0, w, h);
      c.fillStyle = color; c.globalAlpha = 0.35; c.fillRect(0, h - 10, w, 10); c.fillRect(0, 0, w, 6); c.globalAlpha = 1;
      let size = 64; c.font = `400 ${size}px Bungee, Impact, sans-serif`;
      while (c.measureText(title.toUpperCase()).width > w - 60 && size > 20) { size -= 2; c.font = `400 ${size}px Bungee, Impact, sans-serif`; }
      c.textAlign = 'center'; c.textBaseline = 'middle';
      c.shadowColor = color; c.shadowBlur = 22;
      c.fillStyle = color; c.fillText(title.toUpperCase(), w / 2 + 3, h / 2 + 5);
      c.shadowBlur = 8; c.fillStyle = '#FFF6D6'; c.fillText(title.toUpperCase(), w / 2, h / 2 + 2);
    });
  }
  function sideTex(color) {
    return canvasTex('side:' + color, 128, 256, (c, w, h) => {
      c.fillStyle = '#131433'; c.fillRect(0, 0, w, h);
      c.save(); c.translate(w / 2, h / 2); c.rotate(-0.5);
      [[-40, 26, 0.9], [0, 10, 0.55], [22, 5, 0.35]].forEach(([x, bw, a]) => { c.globalAlpha = a; c.fillStyle = color; c.fillRect(x, -h, bw, h * 2); });
      c.restore(); c.globalAlpha = 1;
      const g = c.createLinearGradient(0, 0, 0, h); g.addColorStop(0, 'rgba(0,0,0,.55)'); g.addColorStop(0.5, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,.6)');
      c.fillStyle = g; c.fillRect(0, 0, w, h);
    });
  }

  // ---------------------------------------------------------------- CRT screen shader
  const CRT_VS = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }';
  const CRT_FS = `
    uniform sampler2D map; uniform float uTime, uPower, uHot, uDim, uLines;
    varying vec2 vUv;
    vec2 curve(vec2 uv){ uv = uv * 2.0 - 1.0; vec2 o = abs(uv.yx) / vec2(4.2, 3.6); uv += uv * o * o; return uv * 0.5 + 0.5; }
    void main(){
      vec2 uv = curve(vUv);
      vec3 col = vec3(0.0);
      if (uv.x > 0.0 && uv.x < 1.0 && uv.y > 0.0 && uv.y < 1.0) {
        float sy = max(smoothstep(0.35, 1.0, uPower), 0.006), sx = smoothstep(0.0, 0.35, uPower);
        vec2 c = uv - 0.5;
        float on = step(abs(c.y), 0.5 * sy) * step(abs(c.x), 0.5 * sx);
        vec2 s = vec2(c.x / max(sx, 0.001), c.y / sy) + 0.5;
        float ab = 0.0022;
        col = vec3(texture2D(map, s + vec2(ab, 0.0)).r, texture2D(map, s).g, texture2D(map, s - vec2(ab, 0.0)).b);
        float scan = 0.72 + 0.28 * sin(s.y * uLines * 6.2832);
        float vig = pow(clamp(16.0 * uv.x * uv.y * (1.0 - uv.x) * (1.0 - uv.y), 0.0, 1.0), 0.28);
        float roll = 0.96 + 0.04 * sin(uv.y * 9.0 - uTime * 3.0);
        col *= scan * vig * roll * on;
        col += on * (1.0 - smoothstep(0.35, 0.9, uPower)) * 2.5;          // the bright line of a CRT warming up
        col *= uDim * (1.0 + uHot * 0.6);
        col += vec3(0.05, 0.07, 0.12) * vig * (0.4 + uHot);               // phosphor glow on the glass
      }
      float glare = smoothstep(0.55, 0.0, length(vUv - vec2(0.28, 0.78))) * 0.08;
      gl_FragColor = vec4(col + glare, 1.0);
      #include <colorspace_fragment>
    }`;
  function crtMaterial(tex) {
    return new THREE.ShaderMaterial({
      uniforms: { map: { value: tex }, uTime: { value: 0 }, uPower: { value: 1 }, uHot: { value: 0 }, uDim: { value: 1 }, uLines: { value: 100 } },
      vertexShader: CRT_VS, fragmentShader: CRT_FS, toneMapped: false
    });
  }

  // ---------------------------------------------------------------- arcade cabinet model
  // side profile (depth z, height y) of an upright cabinet, extruded across its width
  const PROFILE = [[0, 0], [0.62, 0], [0.62, 0.86], [0.84, 0.95], [0.83, 1.03], [0.6, 1.1], [0.56, 1.12], [0.47, 1.66], [0.62, 1.72], [0.67, 1.97], [0, 1.97]];
  const CW = 0.86, CZ = 0.41;
  const cabGeo = (() => {
    const g = new THREE.ExtrudeGeometry(new THREE.Shape(PROFILE.map(([x, y]) => new THREE.Vector2(x, y))), { depth: CW, bevelEnabled: false });
    g.rotateY(-Math.PI / 2); g.translate(CW / 2, 0, -CZ);
    return g;
  })();
  const edgeGeo = (() => {
    const pts = [];
    for (const sx of [-CW / 2 - 0.004, CW / 2 + 0.004]) for (let i = 1; i < 9; i++) {
      const [z0, y0] = PROFILE[i], [z1, y1] = PROFILE[i + 1];
      pts.push(sx, y0, z0 - CZ + 0.004, sx, y1, z1 - CZ + 0.004);
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3)); return g;
  })();
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x1a1b3e, roughness: 0.5, metalness: 0.35 });
  const bezelMat = new THREE.MeshStandardMaterial({ color: 0x040410, roughness: 0.25, metalness: 0.6 });
  const plateMat = new THREE.MeshStandardMaterial({ color: 0x2a2c4a, roughness: 0.35, metalness: 0.8 });
  const btnGeo = new THREE.CylinderGeometry(0.032, 0.032, 0.025, 14);
  const stickGeo = new THREE.CylinderGeometry(0.01, 0.01, 0.09, 6);
  const ballGeo = new THREE.SphereGeometry(0.034, 14, 10);
  const screenGeo = new THREE.PlaneGeometry(0.68, 0.425);
  const bezelGeo = new THREE.PlaneGeometry(0.8, 0.54);
  const marqGeo = new THREE.PlaneGeometry(0.84, 0.22);
  const doorGeo = new THREE.PlaneGeometry(0.3, 0.3);
  const slotGeo = new THREE.PlaneGeometry(0.03, 0.065);
  const mats = new Map();
  const matFor = (key, make) => { if (!mats.has(key)) mats.set(key, make()); return mats.get(key); };

  function makeCabinet({ title, color, tex, detail = true }) {
    const col = new THREE.Color(color);
    const g = new THREE.Group();
    const side = matFor('side' + color, () => new THREE.MeshStandardMaterial({ map: sideTex(color), roughness: 0.5, metalness: 0.2 }));
    const tx = side.map; tx.wrapS = tx.wrapT = THREE.RepeatWrapping; tx.repeat.set(1 / 0.86, 1 / 2);
    g.add(new THREE.Mesh(cabGeo, [side, bodyMat]));
    const tilt = -Math.atan2(0.09, 0.54);
    const bezel = new THREE.Mesh(bezelGeo, bezelMat); bezel.position.set(0, 1.39, 0.515 - CZ + 0.006); bezel.rotation.x = tilt; g.add(bezel);
    const crt = crtMaterial(tex);
    const screen = new THREE.Mesh(screenGeo, crt); screen.position.set(0, 1.39, 0.515 - CZ + 0.012); screen.rotation.x = tilt; g.add(screen);
    const mMat = new THREE.MeshBasicMaterial({ map: marqueeTex(title, color), toneMapped: false });
    const marq = new THREE.Mesh(marqGeo, mMat); marq.position.set(0, 1.845, 0.645 - CZ + 0.008); marq.rotation.x = Math.atan2(0.05, 0.25); g.add(marq);
    const edgeMat = new THREE.LineBasicMaterial({ color: col.clone().multiplyScalar(1.6), toneMapped: false });
    g.add(new THREE.LineSegments(edgeGeo, edgeMat));
    if (detail) {
      const deckY = 1.07, deckZ = 0.72 - CZ;
      [[0.06, 0xff5d73], [0.17, 0x3ddcff], [0.28, 0xffd23f]].forEach(([x, c]) => {
        const b = new THREE.Mesh(btnGeo, matFor('btn' + c, () => new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(1.4), toneMapped: false })));
        b.position.set(x, deckY + 0.01, deckZ); b.rotation.x = -0.29; g.add(b);
      });
      const stick = new THREE.Mesh(stickGeo, plateMat); stick.position.set(-0.2, deckY + 0.04, deckZ); g.add(stick);
      const ball = new THREE.Mesh(ballGeo, matFor('ball', () => new THREE.MeshStandardMaterial({ color: 0xe8334f, roughness: 0.2, metalness: 0.1 }))); ball.position.set(-0.2, deckY + 0.09, deckZ); g.add(ball);
      const door = new THREE.Mesh(doorGeo, plateMat); door.position.set(0, 0.5, 0.62 - CZ + 0.003); g.add(door);
      const slotMat = matFor('slot', () => new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff5d73).multiplyScalar(2), toneMapped: false }));
      [-0.06, 0.06].forEach((x) => { const s = new THREE.Mesh(slotGeo, slotMat); s.position.set(x, 0.56, 0.62 - CZ + 0.006); g.add(s); });
    }
    g.userData = { crt, mMat, edgeMat, col };
    return g;
  }

  // mirror a group under the floor: a cheap wet-floor reflection without a second render pass
  function reflect(obj) { const r = obj.clone(); r.scale.y = -1; r.position.y = -obj.position.y; return r; }

  // ================================================================= HERO: the hall
  const hallCanvas = document.getElementById('hall');
  const hr = new THREE.WebGLRenderer({ canvas: hallCanvas, antialias: !lite, powerPreference: 'high-performance' });
  hr.setPixelRatio(Math.min(devicePixelRatio, MAX_DPR));
  hr.toneMapping = THREE.ACESFilmicToneMapping; hr.toneMappingExposure = 1.05;
  const hall = new THREE.Scene();
  hall.background = new THREE.Color(0x06061a);
  hall.fog = new THREE.FogExp2(0x0a0826, 0.055);
  const cam = new THREE.PerspectiveCamera(50, 1, 0.1, 80);

  // hall layout (z runs from the entrance Z0 back to the sign wall END)
  const tall = innerWidth / innerHeight < 0.9;   // portrait screens get a narrower hall so the machines frame the sign
  const HALF = tall ? 3.8 : 5, CABX = tall ? 2.85 : 3.9, Z0 = 12, END = -13, LEN = Z0 - END, ZMID = (Z0 + END) / 2;
  hall.add(new THREE.HemisphereLight(0x5a4bd0, 0x080814, 0.8));
  const signLight = new THREE.PointLight(0xffc53a, 14, 14, 1.5); signLight.position.set(0, 3.0, END + 2.6); hall.add(signLight);
  const lA = new THREE.PointLight(0xff4d8d, 16, 11, 1.3); lA.position.set(-2.6, 3.4, -1.5); hall.add(lA);
  const lB = new THREE.PointLight(0x3ddcff, 16, 11, 1.3); lB.position.set(2.6, 3.4, -6.5); hall.add(lB);
  const lights = [[signLight, 14], [lA, 16], [lB, 16]];

  const world = new THREE.Group(); hall.add(world);       // everything above the floor (gets mirrored)
  const wallMat = new THREE.MeshStandardMaterial({ color: 0x0b0a22, roughness: 0.9, metalness: 0.1 });
  [-1, 1].forEach((s) => { const w = new THREE.Mesh(new THREE.PlaneGeometry(LEN, 4.6), wallMat); w.position.set(s * HALF, 2.3, ZMID); w.rotation.y = -s * Math.PI / 2; world.add(w); });
  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(HALF * 2, LEN), new THREE.MeshStandardMaterial({ color: 0x07071a, roughness: 1 }));
  ceil.position.set(0, 4.6, ZMID); ceil.rotation.x = Math.PI / 2; hall.add(ceil);
  const endTex = canvasTex('endwall', 512, 256, (c, w, h) => {   // dark tiled wall with a faint grid
    c.fillStyle = '#07061A'; c.fillRect(0, 0, w, h);
    c.fillStyle = 'rgba(120,100,220,.06)';
    for (let y = 0; y < h; y += 16) for (let x = (y / 16) % 2 ? 0 : 16; x < w; x += 32) c.fillRect(x, y, 30, 14);
  });
  const endWall = new THREE.Mesh(new THREE.PlaneGeometry(HALF * 2, 4.6), new THREE.MeshStandardMaterial({ map: endTex, roughness: 1, metalness: 0 }));
  endWall.position.set(0, 2.3, END); world.add(endWall);

  // neon: vertical tubes on the walls, a thin rail along each wall, panel lights on the ceiling
  const neon = (c, k = 1.8) => matFor('neon' + c + k, () => new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(k), toneMapped: false }));
  const tubeV = new THREE.BoxGeometry(0.05, 2.4, 0.05);
  const NCOL = [0xff4d8d, 0x3ddcff, 0xa58bff];
  for (let i = 0, z = Z0 - 3; z > END + 1; i++, z -= 3.3) [-1, 1].forEach((s) => {
    const m = new THREE.Mesh(tubeV, neon(NCOL[(i + (s > 0 ? 1 : 0)) % 3], 1.5)); m.position.set(s * (HALF - 0.04), 2.45, z); world.add(m);
  });
  [-1, 1].forEach((s) => {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, LEN), neon(s < 0 ? 0xff4d8d : 0x3ddcff, 0.5)); rail.position.set(s * (HALF - 0.05), 3.9, ZMID); world.add(rail);
  });

  // the cabinets: every game in the catalog, along both walls (mini cabinets first, then the 3D games)
  const order = [...L.defs.filter((d) => d.c.cabinet), ...L.defs.filter((d) => !d.c.cabinet)];
  const PER_SIDE = lite ? 4 : 5;
  const hallScreens = [];
  const artCanvas = new Map();   // one 320x200 art canvas per game, shared by all its screens
  function artFor(d) {
    if (artCanvas.has(d)) return artCanvas.get(d);
    const c = document.createElement('canvas'); c.width = 320; c.height = 200;
    const ctx = c.getContext('2d'); L.drawArt(d, ctx, 1, 0);
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.generateMipmaps = false; tex.minFilter = THREE.LinearFilter;
    const a = { d, ctx, tex }; artCanvas.set(d, a); return a;
  }
  for (let k = 0; k < PER_SIDE * 2 && order.length; k++) {
    const d = order[k % order.length];
    const s = k % 2 ? 1 : -1, row = Math.floor(k / 2);
    const art = artFor(d);
    const cab = makeCabinet({ title: d.g.title, color: d.color, tex: art.tex, detail: !lite && row < 3 });   // far machines skip the small parts
    const z = -0.4 - row * 2.1;
    cab.position.set(s * CABX, 0, z);
    cab.rotation.y = -s * (Math.PI / 2 - 0.42);
    cab.scale.setScalar(1.2);
    world.add(cab);
    cab.userData.crt.uniforms.uLines.value = 70;
    hallScreens.push({ crt: cab.userData.crt, mMat: cab.userData.mMat, z, delay: 0.1 + row * 0.09 + (s > 0 ? 0.05 : 0) });
    // light pool on the floor in front of the machine
    const pool = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 2.4), new THREE.MeshBasicMaterial({ map: glowTex, color: new THREE.Color(d.color).multiplyScalar(0.45), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    pool.rotation.x = -Math.PI / 2; pool.position.set(s * (CABX - 0.9), 0.012, z + 0.5); hall.add(pool);
  }

  // the sign: a steel box with bulbs around it and two neon words on its face
  const sign = new THREE.Group(); sign.position.set(0, 3.0, END + 0.35); world.add(sign);
  const SW = tall ? 6.4 : 9, SH = tall ? 2.1 : 2.5;
  sign.add(new THREE.Mesh(new THREE.BoxGeometry(SW, SH, 0.3), new THREE.MeshStandardMaterial({ color: 0x100e26, roughness: 0.5, metalness: 0.6 })));
  function wordTex(word, fill, shade) {
    return canvasTex('w:' + word, 1024, 360, (c, w, h) => {
      c.font = '400 250px Bungee, Impact, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.lineJoin = 'round';
      c.fillStyle = shade; c.fillText(word, w / 2 + 12, h / 2 + 22);
      c.shadowColor = fill; c.shadowBlur = 18; c.fillStyle = fill; c.fillText(word, w / 2, h / 2 + 10);
      c.shadowBlur = 0; c.strokeStyle = 'rgba(255,248,200,.95)'; c.lineWidth = 4; c.strokeText(word, w / 2, h / 2 + 10);
    });
  }
  const wordGeo = new THREE.PlaneGeometry(SW * 0.46, SW * 0.46 * 360 / 1024);
  const words = ['COIN', 'SLOT'].map((wd, i) => {
    const m = new THREE.MeshBasicMaterial({ map: wordTex(wd, '#FFD23F', '#FF5D73'), transparent: true, toneMapped: false, depthWrite: false, fog: false });
    const mesh = new THREE.Mesh(wordGeo, m); mesh.position.set((i ? 1 : -1) * SW * 0.235, 0.2, 0.17); sign.add(mesh);
    return m;
  });
  const subTex = canvasTex('sub', 1024, 96, (c, w, h) => {
    c.font = '600 40px "IBM Plex Mono", monospace'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.shadowColor = '#3DDCFF'; c.shadowBlur = 14; c.fillStyle = '#9FF0FF'; c.fillText('★ ARCADE · FREE PLAY ★'.split('').join(' '), w / 2, h / 2);
  });
  const subMat = new THREE.MeshBasicMaterial({ map: subTex, transparent: true, toneMapped: false, depthWrite: false, fog: false });
  const sub = new THREE.Mesh(new THREE.PlaneGeometry(SW * 0.78, SW * 0.78 * 96 / 1024), subMat); sub.position.set(0, -0.8, 0.17); sign.add(sub);
  // bulbs
  const bulbs = [];
  const perRow = Math.round(SW / 0.28), perCol = Math.round(SH / 0.28);
  for (let i = 0; i <= perRow; i++) { const x = -SW / 2 + 0.1 + (i / perRow) * (SW - 0.2); bulbs.push([x, SH / 2 - 0.1], [x, -SH / 2 + 0.1]); }
  for (let j = 1; j < perCol; j++) { const y = -SH / 2 + 0.1 + (j / perCol) * (SH - 0.2); bulbs.push([-SW / 2 + 0.1, y], [SW / 2 - 0.1, y]); }
  const bulbMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(0.05, 8, 6), new THREE.MeshBasicMaterial({ toneMapped: false, fog: false }), bulbs.length);
  const tmpM = new THREE.Matrix4(), bulbCol = new THREE.Color();
  bulbs.forEach(([x, y], i) => { tmpM.makeTranslation(x, y, 0.17); bulbMesh.setMatrixAt(i, tmpM); bulbMesh.setColorAt(i, bulbCol.setRGB(2, 1.6, 0.6)); });
  sign.add(bulbMesh);
  const halo = new THREE.Mesh(new THREE.PlaneGeometry(SW * 1.7, SH * 2.6), new THREE.MeshBasicMaterial({ map: glowTex, color: new THREE.Color(0xff8a3a).multiplyScalar(0.35), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, fog: false }));
  halo.position.set(0, 0, 0.05); sign.add(halo);
  const signPool = new THREE.Mesh(new THREE.PlaneGeometry(10, 7), new THREE.MeshBasicMaterial({ map: glowTex, color: new THREE.Color(0xffb13a).multiplyScalar(0.3), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
  signPool.rotation.x = -Math.PI / 2; signPool.position.set(0, 0.014, END + 3); hall.add(signPool);

  // mirrored world under a wet floor
  const mirror = reflect(world); hall.add(mirror);
  const floorTex = canvasTex('floor', 512, 512, (c, w, h) => {
    c.fillStyle = 'rgba(12,10,34,.93)'; c.fillRect(0, 0, w, h);
    // puddles: more transparent, so the reflection shows through
    for (let i = 0; i < 26; i++) {
      const x = (i * 197) % w, y = (i * 331) % h, r = 30 + (i * 53) % 90;
      const g = c.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(1, 'rgba(0,0,0,0)');
      c.globalCompositeOperation = 'destination-out'; c.globalAlpha = 0.5; c.fillStyle = g; c.fillRect(x - r, y - r, r * 2, r * 2);
    }
    c.globalCompositeOperation = 'source-over'; c.globalAlpha = 1;
    c.strokeStyle = 'rgba(80,70,160,.35)'; c.lineWidth = 2;
    for (let i = 0; i <= 4; i++) { c.beginPath(); c.moveTo(i * w / 4, 0); c.lineTo(i * w / 4, h); c.moveTo(0, i * h / 4); c.lineTo(w, i * h / 4); c.stroke(); }
  });
  floorTex.wrapS = floorTex.wrapT = THREE.RepeatWrapping; floorTex.repeat.set(2.5, 6.25);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(HALF * 2, LEN), new THREE.MeshStandardMaterial({ map: floorTex, transparent: true, roughness: 0.3, metalness: 0.4 }));
  floor.rotation.x = -Math.PI / 2; floor.position.set(0, 0, ZMID); hall.add(floor);

  // dust in the air
  const DUST = lite ? 140 : 420;
  const dp = new Float32Array(DUST * 3);
  for (let i = 0; i < DUST; i++) { dp[i * 3] = (Math.random() - 0.5) * HALF * 1.8; dp[i * 3 + 1] = Math.random() * 4.2; dp[i * 3 + 2] = 7 - Math.random() * 19; }
  const dustGeo = new THREE.BufferGeometry(); dustGeo.setAttribute('position', new THREE.BufferAttribute(dp, 3));
  const dust = new THREE.Points(dustGeo, new THREE.PointsMaterial({ size: 0.035, map: glowTex, color: 0xb9b3ff, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }));
  hall.add(dust);

  // post: bloom on capable machines
  let composer = null, bloom = null;
  function makeComposer() {
    composer = new EffectComposer(hr);
    composer.addPass(new RenderPass(hall, cam));
    bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.75, 0.5, 0.78);
    composer.addPass(bloom);
    composer.addPass(new OutputPass());
  }
  if (!lite) makeComposer();

  let hw = 0, hh = 0, portrait = false;
  function sizeHall() {
    const w = hallCanvas.clientWidth, h = hallCanvas.clientHeight;
    if (w === hw && h === hh) return;
    hw = w; hh = h;
    hr.setSize(w, h, false);
    const aspect = w / h;
    cam.aspect = aspect;
    // portrait: a taller lens and a camera further in, so the sign spans the screen and the cabinets frame it
    portrait = aspect < 0.9;
    cam.fov = portrait ? 72 : aspect < 1.3 ? 58 : 50;
    cam.updateProjectionMatrix();
    if (composer) { composer.setPixelRatio(hr.getPixelRatio()); composer.setSize(w, h); bloom.resolution.set(w / 2, h / 2); }
  }

  // ================================================================= BACK ROW: one machine per mini link
  const rowCanvas = document.getElementById('row-gl');
  const rowWrap = rowCanvas.parentElement;
  const rr = new THREE.WebGLRenderer({ canvas: rowCanvas, antialias: true, alpha: true });
  rr.setPixelRatio(Math.min(devicePixelRatio, MAX_DPR));
  rr.toneMapping = THREE.ACESFilmicToneMapping; rr.toneMappingExposure = 1.1;
  rr.setClearColor(0x000000, 0);
  const row = new THREE.Scene();
  row.add(new THREE.HemisphereLight(0x6a5cf0, 0x0a0a18, 1.2));
  const key = new THREE.DirectionalLight(0xffffff, 1.2); key.position.set(2, 4, 5); row.add(key);
  const rowFloorTex = canvasTex('rowfloor', 256, 256, (c, w, h) => {
    const g = c.createRadialGradient(w / 2, h * 0.42, 0, w / 2, h * 0.42, w * 0.55);
    g.addColorStop(0, 'rgba(12,11,34,.66)'); g.addColorStop(0.5, 'rgba(12,11,34,.88)'); g.addColorStop(1, 'rgba(12,11,34,1)');
    c.fillStyle = g; c.fillRect(0, 0, w, h);
  });
  function wallTex(color) {
    return canvasTex('wall:' + color, 256, 256, (c, w, h) => {
      const g = c.createLinearGradient(0, 0, 0, h); g.addColorStop(0, '#07061A'); g.addColorStop(0.6, '#161236'); g.addColorStop(1, '#0C0B22');
      c.fillStyle = g; c.fillRect(0, 0, w, h);
      const r = c.createRadialGradient(w / 2, h * 0.55, 0, w / 2, h * 0.55, w * 0.45);
      r.addColorStop(0, color + '55'); r.addColorStop(1, color + '00'); c.fillStyle = r; c.fillRect(0, 0, w, h);
      c.shadowColor = color; c.shadowBlur = 12; c.fillStyle = color; c.fillRect(0, h * 0.2, w, 3);
      c.shadowBlur = 0; c.fillStyle = 'rgba(255,255,255,.04)';
      for (let x = 0; x < w; x += 16) c.fillRect(x, h * 0.2 + 6, 1, h);
    });
  }
  const machines = L.minis.map((d, k) => {
    const x = k * 8;
    const cab = makeCabinet({ title: d.g.title, color: d.color, tex: (() => { const t = new THREE.CanvasTexture(d.cv); t.colorSpace = THREE.SRGBColorSpace; t.generateMipmaps = false; t.minFilter = THREE.LinearFilter; return t; })() });
    cab.position.set(x, 0, 0); row.add(cab);
    const refl = reflect(cab); row.add(refl);
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(8, 5), new THREE.MeshBasicMaterial({ map: wallTex(d.color), toneMapped: false }));
    wall.position.set(x, 2.5, -1.3); row.add(wall);
    const fl = new THREE.Mesh(new THREE.PlaneGeometry(8, 8), new THREE.MeshBasicMaterial({ map: rowFloorTex, transparent: true, depthWrite: false, toneMapped: false }));
    fl.rotation.x = -Math.PI / 2; fl.position.set(x, 0.001, 1.9); fl.renderOrder = 1; row.add(fl);
    const pool = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 2.2), new THREE.MeshBasicMaterial({ map: glowTex, color: new THREE.Color(d.color).multiplyScalar(0.5), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    pool.rotation.x = -Math.PI / 2; pool.position.set(x, 0.004, 0.75); pool.renderOrder = 2; row.add(pool);
    const lamp = new THREE.PointLight(new THREE.Color(d.color), 0, 4, 1.5); lamp.position.set(x, 2.6, 1.2); row.add(lamp);
    const cone = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 1.1, 2.9, 24, 1, true), new THREE.MeshBasicMaterial({ map: beamTex, color: new THREE.Color(d.color).multiplyScalar(0.0), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }));
    cone.position.set(x, 1.55, 0.25); row.add(cone);
    const c = new THREE.PerspectiveCamera(30, 0.75, 0.05, 40);
    return { d, k, x, cab, refl, pool, lamp, cone, cam: c, hot: 0, v: -1, tex: cab.userData.crt.uniforms.map.value, px: 0, py: 0 };
  });
  let rw = 0, rh = 0;
  function sizeRow() {
    const w = rowWrap.clientWidth, h = rowWrap.clientHeight;
    if (w === rw && h === rh) return;
    rw = w; rh = h; rr.setSize(w, h, false);
  }
  addEventListener('pointermove', (e) => {
    machines.forEach((m) => {
      const r = m.d.view.getBoundingClientRect();
      m.px = clamp(((e.clientX - r.left) / r.width) * 2 - 1, -1.5, 1.5);
      m.py = clamp(((e.clientY - r.top) / r.height) * 2 - 1, -1.5, 1.5);
    });
  }, { passive: true });

  // ================================================================= loop
  const t0 = performance.now();
  let last = t0, frames = 0, slowAcc = 0, artFlip = 0;
  const camPos = new THREE.Vector3(0, 6, 16), look = new THREE.Vector3(0, 2.6, -20), lookNow = look.clone();
  const par = { x: 0, y: 0 };
  let slotFlicker = 0;

  function flickerOn(t, a, seed) {    // neon buzzing on: noisy until `a`, then steady
    if (t >= a) return 1;
    if (t <= 0) return 0;
    const n = Math.sin(t * 90 + seed * 13) * Math.sin(t * 37 + seed * 7);
    return n > 0.1 ? 0.9 : t / a * 0.15;
  }

  function renderHall(now, dt) {
    sizeHall();
    const k = L.intro.kind;
    const it = L.intro.skip || k === 'none' ? 99 : Math.max(0, (now - Math.max(L.intro.start, t0)) / 1000);
    const full = k === 'full';

    // intro timeline (seconds since the CRT opened)
    const camT = easeOut(full ? (it - 0.05) / 1.7 : it / 1.1);
    const signOn = full ? flickerOn(it - 0.25, 0.75, 1) : flickerOn(it, 0.35, 1);
    const slotOn = full ? flickerOn(it - 0.4, 0.8, 2) : flickerOn(it - 0.05, 0.4, 2);
    const power = full ? sstep(0, 0.8, it) : sstep(0, 0.3, it);

    // idle life: SLOT now and then drops out for a blink
    if (it > 3 && !L.reduce) { if (slotFlicker > 0) slotFlicker -= dt; else if (Math.random() < dt * 0.12) slotFlicker = 0.18; }
    const slotBlink = slotFlicker > 0 && Math.sin(now * 0.09) > -0.2 ? 0.25 : 1;
    words[0].color.setScalar(0.06 + 0.98 * signOn);
    words[1].color.setScalar((0.06 + 0.98 * slotOn) * slotBlink);
    subMat.color.setScalar(sstep(0.9, 1.3, full ? it : it + 0.9) * 1.2);
    halo.material.opacity = 0.6 * signOn;
    lights.forEach(([l, i]) => { l.intensity = i * (l === signLight ? 0.2 + 0.8 * signOn : power); });

    // bulb chase
    const chase = Math.floor(now / 110);
    for (let i = 0; i < bulbs.length; i++) {
      const lit = signOn > 0.5 && (L.reduce || (i + chase) % 3 !== 0);
      bulbMesh.setColorAt(i, lit ? bulbCol.setRGB(1.7, 1.3, 0.55) : bulbCol.setRGB(0.18, 0.12, 0.05));
    }
    bulbMesh.instanceColor.needsUpdate = true;

    // screens power on one by one, then play their attract loops
    hallScreens.forEach((s) => {
      const u = s.crt.uniforms;
      u.uPower.value = full ? sstep(s.delay, s.delay + 0.5, it - 0.2) : sstep(0, 0.35, it - s.delay * 0.3);
      u.uTime.value = now / 1000;
      s.mMat.color.setScalar(0.1 + 0.7 * u.uPower.value);
    });
    if (!L.reduce) {
      let i = 0;
      artFlip ^= 1;
      artCanvas.forEach((a) => { if ((i++ & 1) === artFlip) { L.drawArt(a.d, a.ctx, 1, now / 1000); a.tex.needsUpdate = true; } });
    }

    // camera: glide in, then dolly along the hall with scroll, with a little mouse parallax
    const p = easeInOut(L.scroll);
    const rest = new THREE.Vector3(0, lerp(1.7, 2.3, p), lerp(portrait ? 2.5 : 5.2, END + (portrait ? 9 : 7), p));
    par.x = lerp(par.x, L.reduce ? 0 : L.pointer.x, 0.06); par.y = lerp(par.y, L.reduce ? 0 : L.pointer.y, 0.06);
    const from = full ? new THREE.Vector3(0, 3.9, Z0 - 0.5) : new THREE.Vector3(0, 2.4, rest.z + 5);
    camPos.lerpVectors(from, rest, camT);
    camPos.x += par.x * 0.55 * (1 - p * 0.5); camPos.y += -par.y * 0.25;
    look.set(par.x * 0.35, lerp(portrait ? -1.2 : 2.45, portrait ? 1.6 : 2.9, p) - par.y * 0.12, END);
    lookNow.lerp(look, 0.2);
    cam.position.copy(camPos);
    cam.lookAt(lookNow);
    cam.rotation.z += -par.x * 0.012;

    // dust drift
    if (!L.reduce) { dust.rotation.y = Math.sin(now / 9000) * 0.05; dust.position.y = Math.sin(now / 4000) * 0.08; }

    if (composer) composer.render(); else hr.render(hall, cam);

    // adaptive quality: a slow machine drops bloom, then pixel ratio
    frames++;
    if (frames > 30 && frames < 240) {
      slowAcc = lerp(slowAcc, dt, 0.05);
      if (frames % 60 === 0 && slowAcc > 1 / 38) {
        if (composer) { composer = null; lite = true; }
        else if (hr.getPixelRatio() > 1) { hr.setPixelRatio(1); hw = 0; }
      }
    }
  }

  function renderRow(now) {
    sizeRow();
    const wrapRect = rowWrap.getBoundingClientRect();
    rr.setScissorTest(false); rr.clear();
    rr.setScissorTest(true);
    const z = L.zoom;
    machines.forEach((m) => {
      const r = m.d.view.getBoundingClientRect();
      if (r.bottom < 0 || r.top > innerHeight || r.width < 2) return;
      const x = r.left - wrapRect.left, y = rh - (r.bottom - wrapRect.top);
      rr.setViewport(x, y, r.width, r.height); rr.setScissor(x, y, r.width, r.height);
      // live art texture from the DOM canvas the ticker draws
      if (m.d.v !== m.v) { m.v = m.d.v; m.tex.needsUpdate = true; }
      const hot = L.hot === m.k || (z && z.k === m.k) ? 1 : 0;
      m.hot = lerp(m.hot, hot, 0.12);
      const u = m.cab.userData.crt.uniforms;
      u.uTime.value = now / 1000; u.uHot.value = m.hot; u.uDim.value = 0.75 + 0.25 * m.hot;
      m.cab.userData.mMat.color.setScalar(0.55 + 0.9 * m.hot);
      m.cab.userData.edgeMat.color.copy(m.cab.userData.col).multiplyScalar(0.8 + 1.6 * m.hot);
      m.lamp.intensity = 5 * m.hot;
      m.cone.material.color.copy(m.cab.userData.col).multiplyScalar(0.08 * m.hot);
      m.pool.material.color.copy(m.cab.userData.col).multiplyScalar(0.25 + 0.5 * m.hot);
      const tx = L.reduce ? 0 : clamp(m.px, -1, 1) * m.hot;
      m.cab.rotation.y = lerp(m.cab.rotation.y, 0.38 + tx * 0.3 + (L.reduce ? 0 : Math.sin(now / 2400 + m.k) * 0.05), 0.1);
      m.refl.rotation.y = m.cab.rotation.y;

      const c = m.cam;
      c.aspect = r.width / r.height;
      const fit = Math.max(4.9, 0.8 / (c.aspect * Math.tan(THREE.MathUtils.degToRad(c.fov / 2))));
      const pos = new THREE.Vector3(m.x + (L.reduce ? 0 : m.px * 0.25), 1.35 - m.hot * 0.08, fit - m.hot * 0.35);
      const tgt = new THREE.Vector3(m.x, 0.98 + m.hot * 0.06, 0);
      if (z && z.k === m.k) {    // click: dive into the screen
        const q = easeInOut((performance.now() - z.t0) / z.dur);
        const scr = new THREE.Vector3(0, 1.39, 0.105).applyAxisAngle(new THREE.Vector3(0, 1, 0), m.cab.rotation.y).add(new THREE.Vector3(m.x, 0, 0));
        const eye = scr.clone().add(new THREE.Vector3(0, 0.1, 1).applyAxisAngle(new THREE.Vector3(0, 1, 0), m.cab.rotation.y).multiplyScalar(0.34 / (c.aspect * Math.tan(THREE.MathUtils.degToRad(c.fov / 2))) / 0.92));
        pos.lerp(eye, q); tgt.lerp(scr, q);
      }
      c.position.copy(pos); c.lookAt(tgt); c.updateProjectionMatrix();
      rr.render(row, c);
    });
  }

  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    if (document.hidden) return;
    if (L.vis.hero) renderHall(now, dt);
    if (L.vis.row && machines.length) renderRow(now);
  }
  // first frame synchronously so the intro reveals a finished scene
  renderHall(performance.now(), 0.016);
  requestAnimationFrame(frame);
  hallCanvas.classList.add('on');
}
