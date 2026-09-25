// The sea: the three.js Water addon (planar reflections) fed a procedural tiling normal map,
// with shallow-water turquoise, a swash edge and foam injected from the island's exact height grid.
import { THREE, V3, TAU, rng, smooth, normalFromHeight, scene, camera } from './core.js';
import { Water } from 'three/addons/objects/Water.js';
import { EXT } from './world.js';

function waterNormals() {
  // sum of integer-frequency waves (so it tiles) in many directions + a little noise
  const N = 256, hts = new Float32Array(N * N), R = rng(19), waves = [];
  for (let i = 0; i < 28; i++) {
    const kx = Math.round((R() - 0.5) * 2 * (2 + i * 0.7)), ky = Math.round((R() - 0.5) * 2 * (2 + i * 0.7));
    if (!kx && !ky) continue;
    waves.push([kx, ky, 1 / Math.pow(Math.hypot(kx, ky), 1.2), R() * TAU]);
  }
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    let h = 0; const u = x / N * TAU, v = y / N * TAU;
    for (const [kx, ky, a, p] of waves) h += a * Math.sin(kx * u + ky * v + p);
    hts[y * N + x] = h;
  }
  return normalFromHeight(hts, N, N, 6);
}

const _f = new V3(), _d = new V3();
const WET = new THREE.Color(0x8c7a5a).convertSRGBToLinear().multiplyScalar(0.62); // the terrain's underwater sand, darkened as wet (world.js)

export class Ocean {
  constructor(world, quality = 2) {
    const size = quality >= 2 ? 512 : 256;
    // subdivided: across one 24 km triangle the interpolated depth and world position are too coarse for a shoreline
    const water = this.water = new Water(new THREE.PlaneGeometry(24000, 24000, 160, 160), {
      textureWidth: size, textureHeight: size, waterNormals: waterNormals(), sunDirection: new V3(0, 1, 0),
      sunColor: 0xffffff, waterColor: 0x0b3442, distortionScale: 2.6, fog: true, alpha: 1,
    });
    water.rotation.x = -Math.PI / 2; water.position.y = 0; water.name = 'ocean';
    water.material.uniforms.size.value = 1.6;
    const U = water.material.uniforms;
    U.uH = { value: world.hTex }; U.uHN = { value: world.hTex.image.width }; U.uExt = { value: EXT }; U.uZK = { value: 2e-5 };
    U.uE = { value: new THREE.Color() }; U.uShallow = { value: new THREE.Color(0.1, 0.55, 0.52) }; U.uWet = { value: WET };
    U.uSkyH = { value: new THREE.Color() }; U.uSkyM = { value: new THREE.Color() }; U.uSkyZ = { value: new THREE.Color() }; U.uHaze = { value: 1e-4 }; U.uReflK = { value: new THREE.Color(1, 1, 1) };
    const fs = water.material.fragmentShader;
    water.material.fragmentShader = fs.replace('vec3 surfaceNormal = normalize( noise.xzy * vec3( 1.5, 1.0, 1.5 ) );',
      // calm the normals with distance so the far sea doesn't alias into blotches
      // (far out the waves are smaller than a pixel: that's roughness, not a flat mirror, see 'rough' below)
      // plus a finer ripple layer, so the near water isn't a few big smooth swells
      `float nfade = 1.0 / (1.0 + length(eye - worldPosition.xyz) * 0.006), rough = 1.0 - nfade;
      vec3 fn = texture2D( normalSampler, worldPosition.xz * size * 0.047 + vec2( time * 0.13, -time * 0.09 ) ).xzy * 2.0 - 1.0;
      vec3 fn2 = texture2D( normalSampler, worldPosition.xz * size * 0.13 + vec2( -time * 0.21, time * 0.17 ) ).xzy * 2.0 - 1.0;
      vec3 swellN = normalize( noise.xzy * vec3( 1.5 * nfade, 1.0, 1.5 * nfade ) );
      vec3 surfaceNormal = normalize( swellN + vec3( fn.x, 0.0, fn.z ) * 0.4 * nfade );`)
      .replace('sunLight( surfaceNormal, eyeDirection, 100.0, 2.0, 0.5, diffuseLight, specularLight );', '')
      .replace('vec2 distortion = surfaceNormal.xz * ( 0.001 + 1.0 / distance ) * distortionScale;', `
      // reflections stretch into streaks toward the eye (a tilt along the view moves the image up or down); the fine
      // ripples drive that vertical offset, so shore lights and the moon break into long columns of glints, not smears
      vec2 fw2 = normalize( -worldToEye.xz ), rt2 = vec2( -fw2.y, fw2.x );
      vec2 distortion = vec2( 0.4 * dot( swellN.xz, rt2 ), 1.2 * dot( swellN.xz, fw2 ) + 2.6 * dot( fn2.xz, fw2 ) * nfade ) * ( 0.001 + 1.0 / max( distance, 25.0 ) ) * distortionScale;`)
      .replace('vec3 reflectionSample = vec3( texture2D( mirrorSampler, mirrorCoord.xy / mirrorCoord.w + distortion ) );', `
      // the mirror holds only things (its sky is transparent, see update): the sky part is reflected from uSky*, higher
      // up the sky the farther out, since the facets you see there are the ones tilted toward you (deeper blue)
      vec4 mirror = texture2D( mirrorSampler, mirrorCoord.xy / mirrorCoord.w + distortion );
      float ry = clamp( reflect( -eyeDirection, surfaceNormal ).y, 0.0, 1.0 ); ry += ( 0.1 + 0.35 * rough ) * ( 1.0 - ry );
      vec3 skyR = mix( mix( uSkyH, uSkyM, smoothstep( 0.0, 0.25, ry ) ), uSkyZ, smoothstep( 0.2, 0.6, ry ) );
      vec3 reflectionSample = mirror.rgb + ( 1.0 - mirror.a ) * skyR;`)
      .replace('float reflectance = rf0 + ( 1.0 - rf0 ) * pow( ( 1.0 - theta ), 5.0 );', `
      // Fresnel, lowered where the waves are unresolved (they hide the grazing facets)
      float reflectance = ( rf0 + ( 1.0 - rf0 ) * pow( ( 1.0 - theta ), 5.0 ) ) * ( 1.0 - 0.55 * rough );
      // glitter: a finer normal and a tight lobe near (many small sparkles), widening into a path far out
      vec3 gnrm = normalize( surfaceNormal + vec3( fn2.x, 0.0, fn2.z ) * 0.5 * nfade );
      float shin = mix( 900.0, 45.0, rough );
      specularLight = pow( max( dot( eyeDirection, reflect( -sunDirection, gnrm ) ), 0.0 ), shin ) * ( shin + 8.0 ) * 0.04 * sunColor;`)
      .replace('vec3 scatter = max( 0.0, dot( surfaceNormal, eyeDirection ) ) * waterColor;', '')
      // the body colour is light scattered up from inside the water (scaled with the light in update); no diffuse sun
      .replace('vec3 albedo = mix( ( sunColor * diffuseLight * 0.3 + scatter ) * getShadowMask(), reflectionSample + specularLight, reflectance );',
        'vec3 albedo = mix( waterColor * ( 0.35 + 0.65 * getShadowMask() ), reflectionSample * uReflK + specularLight, reflectance );')
      // the sea keeps its own, lighter haze, so it stays darker than the sky right down to the horizon
      .replace('#include <fog_fragment>', '#ifdef USE_FOG\n gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, 1.0 - exp( -vFogDepth * uHaze ) );\n#endif')
      .replace('uniform vec3 waterColor;', `uniform vec3 waterColor;
      uniform sampler2D uH; uniform float uHN, uExt, uZK, uHaze; uniform vec3 uReflK; uniform vec3 uE, uShallow, uWet, uSkyH, uSkyM, uSkyZ;
      // terrain height exactly as the mesh has it: the same grid and the same diagonal split as World.heightAt
      float terrainH(vec2 p) {
        vec2 f = (p + uExt) / (2.0 * uExt) * (uHN - 1.0);
        if (f.x < 0.0 || f.y < 0.0 || f.x >= uHN - 1.0 || f.y >= uHN - 1.0) return -16.0;
        ivec2 i = ivec2(floor(f)); vec2 u = f - floor(f);
        float h00 = texelFetch(uH, i, 0).r, h10 = texelFetch(uH, i + ivec2(1, 0), 0).r, h01 = texelFetch(uH, i + ivec2(0, 1), 0).r, h11 = texelFetch(uH, i + ivec2(1, 1), 0).r;
        return u.x + u.y <= 1.0 ? h00 + (h10 - h00) * u.x + (h01 - h00) * u.y : h11 + (h01 - h11) * (1.0 - u.x) + (h10 - h11) * (1.0 - u.y);
      }`)
      .replace('vec3 outgoingLight = albedo;', `vec3 outgoingLight = albedo;
      {
        float wd = -terrainH(worldPosition.xz); // true water depth
        // The beach runs into the sea at about 1:20, so near the waterline the sand is only centimetres under
        // this plane, and at a grazing angle the depth buffer can't tell them apart: the test flipped between
        // sea and sand as the camera moved (the shoreline flicker). That sliver is left to the terrain (wet sand),
        // with a margin that grows with distance as depth precision falls; a slow swash moves the edge.
        float swash = 0.04 * (0.5 + 0.5 * sin(time * 0.45 + worldPosition.x * 0.021 - worldPosition.z * 0.017));
        float edge = wd - swash - (0.02 + uZK * dot(worldToEye, worldToEye));
        if (edge < 0.0) discard;
        // shallows: sand shows through as turquoise near the beaches (lit by what lights the sand: uE, so it
        // fades with the day instead of glowing cyan under the high dusk exposure)
        float sh = exp(-wd * 0.28);
        outgoingLight = mix(outgoingLight, mix(outgoingLight, uShallow * uE * 0.25, 0.75), sh * (1.0 - reflectance * 0.6));
        // the last few centimetres are a thin sheet over the sand: fade into the wet sand under it (with a sheen),
        // so the water ends softly instead of on a hard line
        float film = 1.0 - smoothstep(0.0, 0.2, edge);
        outgoingLight = mix(outgoingLight, uWet * uE + reflectionSample * reflectance * 0.15, film * 0.85);
        // foam: soft bands rolling in over the shelf, and a lacy line riding the swash
        float nz = noise.x * 0.5 + noise.z * 0.5;
        float band = sin(wd * 4.2 - time * 1.2 + nz * 1.5);
        float foam = smoothstep(0.86, 1.0, band) * smoothstep(2.5, 0.7, wd) * 0.45;
        foam += smoothstep(0.12, 0.035, edge) * smoothstep(0.0, 0.025, edge) * 0.6;
        foam *= 0.65 + 0.35 * nz;
        // foam is a white diffuse surface, lit like the sand, with a little of the sky it reflects
        outgoingLight = mix(outgoingLight, 0.75 * uE + reflectionSample * 0.12, clamp(foam, 0.0, 1.0));
      }`);
    water.material.needsUpdate = true;
    water.receiveShadow = true;
    scene.add(water);
    // Render the mirror without the sky dome and onto transparent black, so its alpha says where there's something
    // to reflect; the shader fills the rest with the sky from uSky*.
    const mirror = water.onBeforeRender, cc = new THREE.Color();
    water.onBeforeRender = (r, sc, cam, ...rest) => {
      const a = r.getClearAlpha(), dome = this.dome, vis = dome && dome.visible; r.getClearColor(cc);
      r.setClearColor(0x000000, 0); if (dome) dome.visible = false;
      mirror(r, sc, cam, ...rest);
      r.setClearColor(cc, a); if (dome) dome.visible = vis;
    };
  }
  update(t, sky) {
    const U = this.water.material.uniforms;
    this.dome = sky.sky;
    U.time.value = t * 0.8;
    U.sunDirection.value.copy(sky.lightDir);
    // the glitter: the sun's colour by day, a silver moon path at night
    if (sky.el > -4) U.sunColor.value.copy(sky.sun.color).multiplyScalar(Math.min(1.4, sky.sun.intensity * 0.35));
    else U.sunColor.value.setRGB(0.78, 0.84, 0.95).multiplyScalar(0.3 * sky.sun.intensity);
    // the sky it reflects, along the view: near the horizon, ~15° up and ~53° up. Facing a low sun, take it from at
    // least 70° round from the sun: the sun's glow on the water is the glitter path, and the rest stays dark blue-green
    // instead of mirroring the glare
    const f = camera.getWorldDirection(_f); f.y = 0; if (f.lengthSq() < 1e-6) f.set(0, 0, -1); f.normalize();
    const sa = Math.atan2(sky.sunDir.x, sky.sunDir.z), da = Math.atan2(Math.sin(Math.atan2(f.x, f.z) - sa), Math.cos(Math.atan2(f.x, f.z) - sa));
    if (Math.abs(da) < 1.22 && sky.el > -6) { const a = sa + Math.sign(da || 1) * 1.22; f.set(Math.sin(a), 0, Math.cos(a)); }
    // Round sunset the low sky and the clouds are pink and gold all round: take the reflection from higher up and filter
    // it toward blue-green (not the glitter), so the water off the sun path stays dark and the gold is the path's
    const low = smooth(12, 3, sky.el) * smooth(-7, -2, sky.el);
    U.uReflK.value.setRGB(1 - 0.72 * low, 1 - 0.5 * low, 1 - 0.42 * low);
    for (const [k, e0, e1] of [['uSkyH', 0.03, 0.22], ['uSkyM', 0.26, 0.5], ['uSkyZ', 0.8, 0.92]]) { const e = e0 + (e1 - e0) * low; sky.colorAt(_d.set(f.x * Math.sqrt(1 - e * e), e, f.z * Math.sqrt(1 - e * e)), U[k].value); }
    U.uHaze.value = scene.fog.density * 0.12;
    // the light reaching the sand (per unit albedo), as the terrain gets it: sun + hemisphere (Lambert) + the sky's env fill
    const s = sky.sun, h = sky.hemi, k = s.intensity * Math.max(sky.lightDir.y, 0) / Math.PI;
    U.uE.value.setRGB(s.color.r * k + h.color.r * h.intensity / Math.PI, s.color.g * k + h.color.g * h.intensity / Math.PI, s.color.b * k + h.color.b * h.intensity / Math.PI)
      .addScalar(sky.ambLum || 0);
    // the sea's body colour is light scattered up from inside the water, so it scales with the light too (as a
    // fixed radiance it glowed cyan under the high dusk exposure); a deep ocean blue
    const E = U.uE.value, lum = 0.2126 * E.r + 0.7152 * E.g + 0.0722 * E.b;
    U.waterColor.value.setRGB(0.003, 0.03, 0.056).multiplyScalar(lum);
    // depth precision scales with the near plane (the POV camera's is closer)
    U.uZK.value = 2e-5 * 0.05 / camera.near;
  }
}
