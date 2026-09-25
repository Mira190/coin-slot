// Harbour water: Gerstner swell in the vertex shader (damped against the hull and quay), two scrolling
// detail-normal layers, Fresnel reflection of the shared sky function, sun glitter, subsurface tint on
// the crests, foam where the water meets the hull/quay/fenders, and a soft band of ship shadow.
import * as THREE from 'three';
import { SKY_GLSL, SUN_DIR } from './sky.js';
import { seaNormal } from './textures.js';

export const WATER_Y = -7.0;
// hull footprint (rounded rectangle) used for foam and damping: centre x, half length, half beam
const HULL = new THREE.Vector4(4.5, 66, 14.4, 0);

const WAVES = [ // dir x, dir z, steepness, wavelength
  [1.0, 0.25, 0.18, 34], [0.6, -0.8, 0.14, 21], [-0.3, 1.0, 0.1, 13], [0.9, 0.5, 0.08, 7.5], [-0.8, -0.35, 0.06, 4.6],
];

export function makeSea(quality = 1) {
  // radial grid: dense near the ship, sparse far away
  const rings = 120, segs = quality > 1 ? 200 : 128;
  const pos = [], idx = [];
  pos.push(0, 0, 0);
  for (let r = 1; r <= rings; r++) {
    const rad = r * 0.9 + 3 * (Math.pow(1.058, r) - 1); // ~1 m spacing near the hull, ~2.7 km at the edge
    for (let s = 0; s < segs; s++) { const a = (s / segs) * Math.PI * 2; pos.push(Math.cos(a) * rad, 0, Math.sin(a) * rad); }
  }
  for (let s = 0; s < segs; s++) idx.push(0, 1 + ((s + 1) % segs), 1 + s);
  for (let r = 1; r < rings; r++) {
    const a0 = 1 + (r - 1) * segs, a1 = 1 + r * segs;
    for (let s = 0; s < segs; s++) {
      const s1 = (s + 1) % segs;
      idx.push(a0 + s, a0 + s1, a1 + s, a0 + s1, a1 + s1, a1 + s);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  const nrm = seaNormal();
  const wv = WAVES.map(([x, z, q, L]) => { const l = Math.hypot(x, z); return new THREE.Vector4(x / l, z / l, q, L); });
  const mat = new THREE.ShaderMaterial({
    fog: true,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      uTime: { value: 0 }, uSunDir: { value: SUN_DIR }, uNormal: { value: null }, uWaves: { value: wv },
      uHull: { value: HULL }, uQuayZ: { value: 16.8 }, uCam: { value: new THREE.Vector3() },
    }]),
    vertexShader: /* glsl */`
      uniform float uTime; uniform vec4 uWaves[5]; uniform vec4 uHull; uniform float uQuayZ;
      varying vec3 vWorld; varying vec3 vN; varying float vCrest; varying float vHullD;
      #include <fog_pars_vertex>
      float hullDist(vec2 p){ vec2 q = abs(vec2(p.x - uHull.x, p.y)) - uHull.yz; return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0); }
      void main(){
        vec3 p = position;
        vec2 xz = p.xz;
        float hd = hullDist(xz);
        vHullD = hd;
        // calm water in the lee of the hull and at the quay face
        float damp = smoothstep(0.0, 18.0, hd) * smoothstep(0.0, 8.0, uQuayZ - xz.y + 0.0);
        damp = mix(0.25, 1.0, damp);
        vec3 off = vec3(0.0); vec3 T = vec3(1.0, 0.0, 0.0), B = vec3(0.0, 0.0, 1.0);
        float crest = 0.0;
        for (int i = 0; i < 5; i++) {
          vec4 w = uWaves[i];
          float k = 6.28318 / w.w, c = sqrt(9.8 / k), a = w.z / k * damp;
          float f = k * (dot(w.xy, xz) - c * uTime * 0.6);
          float cf = cos(f), sf = sin(f);
          off.x += w.x * a * cf; off.z += w.y * a * cf; off.y += a * sf;
          T += vec3(-w.x * w.x * w.z * damp * sf, w.x * w.z * damp * cf, -w.x * w.y * w.z * damp * sf);
          B += vec3(-w.x * w.y * w.z * damp * sf, w.y * w.z * damp * cf, -w.y * w.y * w.z * damp * sf);
          crest += sf * w.z * damp;
        }
        p += off;
        vN = normalize(cross(B, T));
        vCrest = crest;
        vec4 wp = modelMatrix * vec4(p, 1.0);
        vWorld = wp.xyz;
        vec4 mvPosition = viewMatrix * wp;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */`
      uniform sampler2D uNormal; uniform vec3 uCam; uniform float uQuayZ;
      varying vec3 vWorld; varying vec3 vN; varying float vCrest; varying float vHullD;
      #include <fog_pars_fragment>
      ${SKY_GLSL}
      vec3 detail(vec2 uv){ return texture2D(uNormal, uv).xyz * 2.0 - 1.0; }
      void main(){
        vec3 V = uCam - vWorld; float dist = length(V); V /= dist;
        // detail normals fade with distance (avoids shimmer)
        float fade = 1.0 - smoothstep(60.0, 420.0, dist);
        vec2 uv = vWorld.xz;
        vec3 d1 = detail(uv * 0.045 + vec2(uTime * 0.012, uTime * 0.007));
        vec3 d2 = detail(uv * 0.11 + vec2(-uTime * 0.017, uTime * 0.011));
        vec3 d3 = detail(uv * 0.013 + vec2(uTime * 0.004, -uTime * 0.003));
        vec3 dn = (d1 + d2) * 0.5 * fade + d3 * 0.6;
        vec3 N = normalize(vN + vec3(dn.x, 0.0, dn.y) * 0.22);
        float NdV = max(dot(N, V), 0.0);
        float fres = 0.02 + 0.98 * pow(1.0 - NdV, 5.0);
        vec3 R = reflect(-V, N); R.y = abs(R.y);
        vec3 refl = skyColor(R);
        // water body: deep teal, lighter/greener in the crests facing the sun (subsurface)
        vec3 deep = vec3(0.004, 0.022, 0.034), shallow = vec3(0.012, 0.06, 0.07);
        float sss = pow(max(dot(V, -uSunDir) * 0.5 + 0.5, 0.0), 3.0) * max(vCrest * 4.0 + 0.2, 0.0);
        vec3 body = mix(deep, shallow, clamp(0.35 + vCrest * 2.5, 0.0, 1.0)) + vec3(0.04, 0.12, 0.1) * sss * 0.5;
        vec3 col = mix(body, refl, fres);
        // sun glitter
        vec3 H = normalize(uSunDir + V);
        float spec = pow(max(dot(N, H), 0.0), 900.0) * 16.0 + pow(max(dot(N, H), 0.0), 90.0) * 0.5;
        col += vec3(1.0, 0.8, 0.55) * spec;
        // foam at the hull, quay face and on sharp crests
        float n = texture2D(uNormal, uv * 0.9 + uTime * 0.03).x;
        float hullFoam = (1.0 - smoothstep(0.0, 2.6, vHullD + (n - 0.5) * 1.8)) * step(0.0, vHullD + 0.4);
        float quayFoam = 1.0 - smoothstep(0.0, 1.6, uQuayZ - vWorld.z + (n - 0.5) * 1.2);
        float crestFoam = smoothstep(0.2, 0.3, vCrest + (n - 0.5) * 0.1) * 0.25;
        float foam = clamp(hullFoam * 0.75 + quayFoam * 0.6 + crestFoam, 0.0, 1.0) * smoothstep(0.45, 0.7, n + 0.1);
        col = mix(col, vec3(0.85, 0.88, 0.86), foam * 0.85);
        // the hull shades the water on its lee side (sun comes from -z)
        float shadow = (1.0 - smoothstep(0.0, 9.0, vHullD)) * smoothstep(-2.0, 6.0, vWorld.z) * smoothstep(80.0, 60.0, abs(vWorld.x));
        col *= 1.0 - shadow * 0.45;
        gl_FragColor = vec4(col, 1.0);
        #include <fog_fragment>
      }`,
  });
  mat.uniforms.uNormal.value = nrm;
  const mesh = new THREE.Mesh(g, mat);
  mesh.position.y = WATER_Y;
  mesh.frustumCulled = false;
  mesh.update = (t, camPos) => { mat.uniforms.uTime.value = t; mat.uniforms.uCam.value.copy(camPos); };
  return mesh;
}
