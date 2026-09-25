// Folded Steps: the lake. A finite disc (an ortho camera would otherwise see an infinite plane climb the
// screen) with animated ripple normals, sun glints, sky tint, soft rim and foam rings around every pillar.
import * as THREE from 'three';
import { FXU, SUN } from './render.js';

const MAXP = 32;
export class Water {
  constructor(scene) {
    this.u = {
      uDeep: { value: new THREE.Color() }, uShallow: { value: new THREE.Color() }, uSky: { value: new THREE.Color() }, uFoam: { value: new THREE.Color('#ffffff') },
      uCenter: { value: new THREE.Vector2() }, uRad: { value: 20 }, uSun: { value: SUN.clone() },
      uP: { value: Array.from({ length: MAXP }, () => new THREE.Vector4()) }, uNP: { value: 0 },
      uRip: { value: Array.from({ length: 6 }, () => new THREE.Vector4(0, 0, -99, 0)) },
      uMist: FXU.uMist, uMistTop: FXU.uMistTop, uMistBot: FXU.uMistBot, uTime: FXU.uTime,
    };
    const m = new THREE.ShaderMaterial({
      uniforms: this.u, transparent: true, depthWrite: true,
      vertexShader: 'varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
      fragmentShader: `
        uniform vec3 uDeep, uShallow, uSky, uFoam, uMist; uniform vec2 uCenter; uniform float uRad, uTime, uMistTop, uMistBot; uniform vec3 uSun;
        uniform vec4 uP[${MAXP}]; uniform int uNP; uniform vec4 uRip[6];
        varying vec3 vW;
        float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float n2(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f); return mix(mix(h(i), h(i+vec2(1,0)), f.x), mix(h(i+vec2(0,1)), h(i+vec2(1,1)), f.x), f.y); }
        void main(){
          vec2 p = vW.xz;
          float t = uTime;
          vec2 g = vec2(0.0);
          g += 0.060 * vec2(cos(p.x * 0.8 + p.y * 0.3 + t * 0.9), cos(p.y * 0.9 - p.x * 0.2 - t * 0.7));
          g += 0.035 * vec2(cos(p.x * 1.9 - p.y * 1.1 - t * 1.4), cos(p.y * 2.1 + p.x * 0.7 + t * 1.2));
          g += 0.020 * vec2(n2(p * 2.3 + t * 0.3) - 0.5, n2(p * 2.3 - t * 0.35 + 7.0) - 0.5) * 2.0;
          float r = length(p - uCenter);
          // foam rings: a steady collar plus one ring drifting outward per pillar; and each pillar's
          // reflection, which in this projection lies along +x+z from its foot
          float foam = 0.0, refl = 0.0;
          for (int i = 0; i < ${MAXP}; i++) {
            if (i >= uNP) break;
            vec4 q = uP[i];
            vec2 dq = p - q.xy;
            float d = max(abs(dq.x), abs(dq.y)) - 0.5;
            float ph = fract(t * 0.22 + fract(q.x * 0.37 + q.y * 0.61));
            foam += smoothstep(0.09, 0.0, abs(d - ph * 1.1)) * (1.0 - ph) * 0.7;
            foam += smoothstep(0.14, 0.0, abs(d)) * 0.9;
            g += normalize(dq + 0.001) * sin(d * 9.0 - t * 3.0) * 0.03 * exp(-max(d, 0.0) * 1.6);
            float along = (dq.x + dq.y) * 0.5, across = (dq.x - dq.y) * 0.5 + sin(along * 5.0 - t * 2.2) * 0.05;
            float len = q.z;
            refl = max(refl, smoothstep(0.62, 0.42, abs(across)) * smoothstep(-0.2, 0.3, along) * smoothstep(len, len * 0.2, along) * q.w);
          }
          // tap / splash ripples
          for (int i = 0; i < 6; i++) {
            vec4 q = uRip[i];
            float age = t - q.z;
            if (age < 0.0 || age > 3.0) continue;
            float d = length(p - q.xy);
            float w = smoothstep(0.16, 0.0, abs(d - age * 1.4)) * (1.0 - age / 3.0) * q.w;
            foam += w;
          }
          vec3 n = normalize(vec3(-g.x, 1.0, -g.y));
          vec3 V = normalize(vec3(1.0));
          vec3 H = normalize(uSun + V);
          float spec = pow(max(dot(n, H), 0.0), 220.0) * 2.2 + pow(max(dot(n, H), 0.0), 30.0) * 0.08;
          float fres = pow(1.0 - max(dot(n, V), 0.0), 2.0);
          float depth = smoothstep(1.5, uRad * 0.75, r);
          vec3 col = mix(uShallow, uDeep, depth * 0.8 + (n2(p * 0.22 + t * 0.02) - 0.5) * 0.08);
          col = mix(col, uSky, clamp(fres * 1.8, 0.0, 0.6));
          col = mix(col, uDeep * 0.55, refl * 0.55);
          col += uFoam * clamp(foam, 0.0, 1.0) * 0.55 + vec3(spec) * (1.0 - refl * 0.7);
          float sv = dot(vW, vec3(-0.40824829, 0.81649658, -0.40824829));
          col = mix(col, uSky, smoothstep(uRad * 0.55, uRad, r) * 0.6);
          col = mix(col, uMist, smoothstep(uMistTop, uMistBot, sv) * 0.5);
          float a = smoothstep(uRad, uRad * 0.55, r);
          gl_FragColor = vec4(col, a);
        }`,
    });
    this.mesh = new THREE.Mesh(new THREE.CircleGeometry(1, 96), m);
    this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.renderOrder = -1;
    this.mesh.receiveShadow = false;
    scene.add(this.mesh);
    this.rip = 0;
  }
  set(P, y, cx, cz, rad) {
    this.u.uDeep.value.set(P.water[0]);
    this.u.uShallow.value.set(P.water[1]);
    this.u.uSky.value.set(P.sky[1]);
    this.u.uCenter.value.set(cx, cz);
    this.u.uRad.value = rad;
    this.mesh.position.set(cx, y, cz);
    this.mesh.scale.setScalar(rad);
    this.y = y;
  }
  // list of [x, z, height above water, strength]
  pillars(list) {
    const P = this.u.uP.value;
    list.slice(0, MAXP).forEach((q, i) => P[i].set(q[0], q[1], q[2] ?? 3, q[3] ?? 1));
    this.u.uNP.value = Math.min(MAXP, list.length);
  }
  ripple(x, z, strength = 1) {
    this.u.uRip.value[this.rip++ % 6].set(x, z, FXU.uTime.value, strength);
  }
}
