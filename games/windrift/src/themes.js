// Per-theme look: sky, fog, light, post settings, palette, and the natural terrain around each circuit.
import { fbm, noise2, smoothstep } from './gfx.js';

// Light budget. Bloom runs on the linear HDR buffer *before* tone mapping, with threshold 1.0 on every theme that
// uses it. Lights and albedos are set so lit surfaces (even white walls and moonlit snow) stay below 1.0, and only
// real light sources exceed it. These are the linear multipliers for emissive / unlit light-source materials; they
// sit just above the threshold so glows stay small and tight instead of flooding the frame.
export const BLOOM_T = 1.0;
export const GLOW = {
  window: 0.66, neon: 1.25, sign: 1.0, videoWall: 0.9, lampHead: 1.2, lampPool: 0.35, tunnelLamp: 1.1, lantern: 1.5,
  cabinWindow: 0.85, crystal: 0.3, lighthouse: 1.7, torch: 1.7, trim: 0.7, arrowBoard: 0.3, pad: 1.0, itemBox: 0.35,
  gantryAccent: 0.7, banner: 0.5, startLight: 1.8, headlight: 1.15, taillight: 1.3, tank: 0.7, underglow: 0.2, neonSpill: 0.22,
  flame: 1.45, spark: 1.55, moon: 1.35, envPanel: 0.9
};

export const THEMES = {
  city: {
    name: 'city', night: true,
    sky: { top: 0x04061a, mid: 0x13103a, horizon: 0x6b2a72, bottom: 0x0a0716, stars: 1, moon: [-0.4, 0.55, -0.73], aurora: 0 },
    fog: { color: 0x1a0f30, near: 140, far: 700 },
    // ACES here: PBR Neutral's black-level toe subtracts the darkest channel, which turned every dark surface under
    // the cool night light into flat pure blue. ACES keeps the asphalt a deep neutral and lets the neon carry colour
    exposure: 1.5, aces: true, bloom: [0.42, 0.3, BLOOM_T],
    sun: { color: 0xa9b8ff, intensity: 1.35, dir: [-0.45, 0.8, -0.4] },
    hemi: { sky: 0x4b56b8, ground: 0x2a1030, intensity: 0.8 },
    road: '#2a2b33', roadRough: 0.5, roadLine: '#dfe3ee', kerb: ['#ff2e7e', '#f4f4fa'], ground: [0.17, 0.17, 0.2], ground2: [0.1, 0.1, 0.13],
    wall: { color: 0x9aa0ad, trim: 0x19d3ff, trim2: 0xff3d9a }, bridgeDip: 'none', hump: false
  },
  coast: {
    name: 'coast', night: false,
    sun: { color: 0xfff1d6, intensity: 2.1, dir: [0.55, 0.62, 0.55] }, skyDay: { turbidity: 3.2, rayleigh: 1.6, mie: 0.004, g: 0.82, elev: 38, azim: 145 },
    fog: { color: 0xa9cfe8, near: 220, far: 1500 },
    exposure: 0.66, bloom: [0, 0.3, 9],
    hemi: { sky: 0xcfe8ff, ground: 0x9a8a60, intensity: 0.75 },
    road: '#5a5d66', roadLine: '#ffffff', kerb: ['#1f6fe0', '#ffffff'], ground: [0.42, 0.5, 0.26], ground2: [0.7, 0.64, 0.48],
    wall: { color: 0xf4f1ea, trim: 0x1f6fe0, trim2: 0x1f6fe0 }, bridgeDip: 'sea', hump: true, sea: -1.2
  },
  snow: {
    name: 'snow', night: true,
    sky: { top: 0x061634, mid: 0x14356b, horizon: 0x7fa7cf, bottom: 0x1b2a44, stars: 0.7, moon: [0.35, 0.42, 0.84], aurora: 1 },
    fog: { color: 0x7d97be, near: 140, far: 900 },
    // moonlit snow: albedo × light kept under the bloom threshold so the snowfield never glows
    exposure: 1.35, bloom: [0.32, 0.28, BLOOM_T], envI: 0.4,
    sun: { color: 0xcfe0ff, intensity: 0.95, dir: [0.35, 0.55, 0.76] },
    hemi: { sky: 0x9ec4ff, ground: 0x5a6e90, intensity: 0.6 },
    road: '#4b5566', roadLine: '#e8f4ff', kerb: ['#e0283c', '#ffffff'], ground: [0.76, 0.8, 0.88], ground2: [0.5, 0.55, 0.65],
    wall: { color: 0xeaf4ff, trim: 0xe0283c, trim2: 0x3aa0ff }, bridgeDip: 'gorge', hump: true
  },
  desert: {
    name: 'desert', night: false,
    sun: { color: 0xffe2b0, intensity: 2.4, dir: [-0.6, 0.55, 0.58] }, skyDay: { turbidity: 6, rayleigh: 1.2, mie: 0.005, g: 0.85, elev: 34, azim: 10 },
    fog: { color: 0xd8b98a, near: 240, far: 1500 },
    exposure: 0.68, bloom: [0, 0.3, 9],
    hemi: { sky: 0xffe7c2, ground: 0xb78a52, intensity: 0.7 },
    road: '#5e5044', roadLine: '#fff4d8', kerb: ['#d8541e', '#fff1d0'], ground: [0.74, 0.56, 0.34], ground2: [0.6, 0.42, 0.24],
    wall: { color: 0xd9b27a, trim: 0x8a5a2c, trim2: 0x2a8fb8 }, bridgeDip: 'pond', hump: false
  }
};

// Natural ground height away from the road (the road corridor is blended in by world.js).
export function baseHeight(theme, x, z, T) {
  switch (theme) {
    case 'city': return 0;
    case 'coast': {
      const zc = 300 + 35 * smoothstep(-170, -60, x) + 8 * Math.sin(x * 0.03);
      const land = Math.max(0, zc - z);
      const hills = land * 0.085 + fbm(x * 0.006, z * 0.006, 4) * 26 * smoothstep(0, 80, land) - 2;
      const sea = -9 * smoothstep(0, 40, z - zc);
      return z > zc ? sea : Math.max(0.4, hills);
    }
    case 'snow': {
      const b = T.bounds, cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2;
      const r = Math.hypot((x - cx) / (b.x1 - b.x0 + 200), (z - cz) / (b.z1 - b.z0 + 200));
      const m = fbm(x * 0.004 + 3, z * 0.004, 5);
      return 6 + m * 50 + smoothstep(0.35, 0.8, r) * 140 * (0.6 + m) + noise2(x * 0.05, z * 0.05) * 2;
    }
    case 'desert': {
      const d = fbm(x * 0.008, z * 0.011, 4);
      const ridge = 1 - Math.abs(Math.sin(x * 0.011 + z * 0.004 + d * 3));
      return 1 + ridge * 7 * d + d * 6 - 2;
    }
  }
  return 0;
}
