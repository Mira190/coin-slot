// Golden-hour sky: one GLSL function shared by the sky dome, the sea reflection and the PMREM environment,
// so the water reflects exactly the sky you see. Includes drifting procedural clouds lit from the sun side.
import * as THREE from 'three';

export const SUN_DIR = new THREE.Vector3(0.36, 0.27, -0.89).normalize(); // low sun over the port-side harbour
export const SUN_COLOR = new THREE.Color(1.0, 0.8, 0.6);
export const FOG_COLOR = new THREE.Color(0.66, 0.6, 0.58);

export const SKY_GLSL = /* glsl */`
uniform vec3 uSunDir;
uniform float uTime;
float sh_hash(vec2 p){ p = fract(p*vec2(123.34, 456.21)); p += dot(p, p+45.32); return fract(p.x*p.y); }
float sh_noise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(sh_hash(i), sh_hash(i+vec2(1,0)), f.x), mix(sh_hash(i+vec2(0,1)), sh_hash(i+vec2(1,1)), f.x), f.y); }
float sh_fbm(vec2 p){ float a=0.5, s=0.0; for(int i=0;i<5;i++){ s+=a*sh_noise(p); p=p*2.03+vec2(1.7,9.2); a*=0.5; } return s; }
vec3 skyColor(vec3 d){
  d = normalize(d);
  float h = d.y;
  float sd = max(dot(d, uSunDir), 0.0);
  vec3 zen = vec3(0.10, 0.22, 0.50);
  vec3 midc = vec3(0.36, 0.50, 0.72);
  vec3 horA = vec3(0.98, 0.70, 0.46);   // toward the sun
  vec3 horB = vec3(0.62, 0.64, 0.72);   // away from the sun
  float toward = pow(max(dot(normalize(vec3(d.x,0.0,d.z)), normalize(vec3(uSunDir.x,0.0,uSunDir.z))),0.0), 2.0);
  vec3 hor = mix(horB, horA, toward);
  float hh = max(h, 0.0);
  vec3 c = mix(hor, midc, smoothstep(0.0, 0.25, hh));
  c = mix(c, zen, smoothstep(0.2, 0.9, hh));
  // mie glow + sun disc
  // broad warm glow, a tighter aureole, then a ~1.2 degree disc. The disc is far above the bloom threshold, but
  // the glow around it stays moderate so a scope pointed at the sun isn't a flat white field.
  c += vec3(1.0, 0.62, 0.32) * (pow(sd, 6.0) * 0.35 + pow(sd, 64.0) * 0.3 + pow(sd, 900.0) * 0.8);
  c += vec3(1.0, 0.9, 0.7) * smoothstep(0.99985, 0.99992, sd) * 7.0;
  // clouds: project on a plane above
  if (h > 0.01) {
    vec2 uv = d.xz / (h + 0.08) * 1.4 + vec2(uTime * 0.004, uTime * 0.0015);
    float n = sh_fbm(uv * 1.3);
    float cov = smoothstep(0.52, 0.78, n) * smoothstep(0.02, 0.18, h);
    float edge = pow(sd, 3.0);
    vec3 cc = mix(vec3(0.72, 0.66, 0.70), vec3(1.25, 0.86, 0.62), edge * 0.9 + 0.1);
    cc = mix(cc, vec3(0.45, 0.42, 0.5), smoothstep(0.7, 0.95, n) * 0.5);
    c = mix(c, cc, cov * 0.85);
    // thin high streaks
    float st = smoothstep(0.55, 0.8, sh_fbm(vec2(uv.x * 0.4, uv.y * 3.0) + 7.0)) * 0.25 * smoothstep(0.1, 0.5, h);
    c = mix(c, vec3(1.0, 0.85, 0.75), st);
  }
  // below horizon: hazy sea colour
  c = mix(c, vec3(0.30, 0.34, 0.38), smoothstep(0.0, -0.08, h));
  return c;
}
`;

export function makeSkyDome() {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false,
    uniforms: { uSunDir: { value: SUN_DIR }, uTime: { value: 0 } },
    vertexShader: /* glsl */`
      varying vec3 vDir;
      void main(){ vDir = position; vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position = p.xyww; }`,
    fragmentShader: /* glsl */`
      varying vec3 vDir;
      ${SKY_GLSL}
      void main(){ gl_FragColor = vec4(skyColor(vDir), 1.0); }`,
  });
  const m = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), mat);
  m.scale.setScalar(2000);
  m.frustumCulled = false;
  m.renderOrder = -10;
  return m;
}

// PMREM environment from the sky (plus a dark sea below) for PBR reflections/ambient
export function makeEnvironment(renderer) {
  const s = new THREE.Scene();
  const dome = makeSkyDome();
  dome.scale.setScalar(100);
  s.add(dome);
  const pm = new THREE.PMREMGenerator(renderer);
  const rt = pm.fromScene(s, 0.02, 0.1, 400);
  pm.dispose();
  dome.geometry.dispose(); dome.material.dispose();
  return rt.texture;
}
