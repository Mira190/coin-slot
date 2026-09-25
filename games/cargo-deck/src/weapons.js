// Weapon table + per-actor weapon state. Angles in degrees unless noted. Names are original.
//   dmg: per bullet/pellet at close range; falloff [start m, end m, min multiplier]
//   pen: penetration power (crate 1.0, drum 0.6, cabin partition 1.6, stair 2.5; containers/hull never)
//   spread: base, move (at full run), air, walk, perShot heat, maxHeat, recover (deg/s); crouch x0.75, ADS x ads
//   recoil: pattern of [yaw, pitch] kicks (deg) per shot index + kick (visual punch) + recover rate
export const HEAD = 4, CHEST = 1, STOMACH = 1.1, ARM = 0.8, LEG = 0.75;
export const MULT = { head: HEAD, chest: CHEST, stomach: STOMACH, arm: ARM, leg: LEG };

// deterministic recoil pattern: a climb for the first shots, then a drift that swings side to side
function pattern(n, climb, side, seed, lateStart = 8) {
  const out = [];
  let s = seed;
  const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  for (let i = 0; i < n; i++) {
    const up = i < lateStart ? climb * (0.7 + 0.3 * Math.min(1, i / 3)) : climb * 0.28;
    const sway = i < 4 ? (rnd() - 0.5) * side * 0.4 : Math.sin((i - 4) / 4.2 + seed) * side + (rnd() - 0.5) * side * 0.35;
    out.push([sway, up]);
  }
  return out;
}

export const WEAPONS = {
  vk12: {
    id: 'vk12', name: 'VK-12', desc: 'Heavy rifle · 7.62', slot: 0, kind: 'rifle', auto: true,
    dmg: 36, rpm: 600, mag: 30, reserve: 90, reload: 2.45, reloadEmpty: 2.9, pen: 2.2, falloff: [45, 140, 0.75],
    spread: { base: 0.35, move: 3.2, air: 7, walk: 1.2, perShot: 0.32, maxHeat: 3.2, recover: 7, ads: 0.35 },
    recoil: pattern(30, 0.72, 0.55, 7), kick: 1.25, recover: 11, speed: 0.92,
    ads: { fov: 0.78, time: 0.21, sight: 'iron' }, shell: 'rifle', tracer: 0.5, sound: 'rifleA', vm: 'vk12',
  },
  r4: {
    id: 'r4', name: 'R4 Carbine', desc: 'Carbine · 5.56 · red dot', slot: 0, kind: 'rifle', auto: true,
    dmg: 30, rpm: 780, mag: 30, reserve: 90, reload: 2.25, reloadEmpty: 2.7, pen: 1.9, falloff: [40, 120, 0.72],
    spread: { base: 0.3, move: 2.7, air: 6.5, walk: 1.0, perShot: 0.24, maxHeat: 2.6, recover: 8, ads: 0.32 },
    recoil: pattern(30, 0.52, 0.42, 3), kick: 0.95, recover: 12, speed: 0.95,
    ads: { fov: 0.72, time: 0.19, sight: 'dot' }, shell: 'rifle', tracer: 0.5, sound: 'rifleB', vm: 'r4',
  },
  wasp: {
    id: 'wasp', name: 'Wasp SMG', desc: 'SMG · 9 mm · fast', slot: 0, kind: 'smg', auto: true,
    dmg: 24, rpm: 900, mag: 32, reserve: 128, reload: 2.0, reloadEmpty: 2.3, pen: 1.1, falloff: [18, 60, 0.6],
    spread: { base: 0.5, move: 1.6, air: 5, walk: 0.8, perShot: 0.22, maxHeat: 3.0, recover: 10, ads: 0.45 },
    recoil: pattern(32, 0.38, 0.5, 11, 6), kick: 0.7, recover: 13, speed: 1.0,
    ads: { fov: 0.82, time: 0.15, sight: 'ring' }, shell: 'pistol', tracer: 0.4, sound: 'smg', vm: 'wasp',
  },
  longbolt: {
    id: 'longbolt', name: 'Longbolt', desc: 'Bolt sniper · 8x scope', slot: 0, kind: 'sniper', auto: false,
    dmg: 115, rpm: 46, mag: 5, reserve: 20, reload: 3.1, reloadEmpty: 3.1, pen: 3.5, falloff: [200, 400, 0.9], bolt: 1.05,
    spread: { base: 7.5, move: 9, air: 14, walk: 3, perShot: 0, maxHeat: 0, recover: 20, ads: 0.0 },
    recoil: pattern(5, 3.2, 0.6, 5), kick: 3.2, recover: 6, speed: 0.86,
    ads: { fov: 0.24, time: 0.26, sight: 'scope', zoom2: 0.12 }, shell: 'rifle', tracer: 1, sound: 'sniper', vm: 'longbolt',
  },
  breacher: {
    id: 'breacher', name: 'Breacher 12', desc: 'Pump shotgun · 9 pellets', slot: 0, kind: 'shotgun', auto: false,
    dmg: 15, pellets: 9, rpm: 72, mag: 7, reserve: 28, reload: 0.52, shellReload: true, pen: 0.6, falloff: [8, 28, 0.25], pump: 0.62,
    spread: { base: 4.2, move: 1.2, air: 3, walk: 0.4, perShot: 0, maxHeat: 0, recover: 20, ads: 0.72 },
    recoil: pattern(7, 2.6, 0.8, 9), kick: 2.6, recover: 7, speed: 0.94,
    ads: { fov: 0.86, time: 0.18, sight: 'bead' }, shell: 'shotgun', tracer: 0.35, sound: 'shotgun', vm: 'breacher',
  },
  talon: {
    id: 'talon', name: 'Talon .45', desc: 'Pistol · semi-auto', slot: 1, kind: 'pistol', auto: false,
    dmg: 34, rpm: 380, mag: 12, reserve: 48, reload: 1.7, reloadEmpty: 2.0, pen: 1.2, falloff: [20, 70, 0.65],
    spread: { base: 0.45, move: 1.8, air: 5, walk: 0.6, perShot: 0.5, maxHeat: 2.5, recover: 9, ads: 0.5 },
    recoil: pattern(12, 1.1, 0.4, 13), kick: 1.4, recover: 12, speed: 1.0,
    ads: { fov: 0.86, time: 0.14, sight: 'iron' }, shell: 'pistol', tracer: 0.4, sound: 'pistol', vm: 'talon',
  },
  knife: {
    id: 'knife', name: 'Field Knife', desc: 'Slash / heavy stab', slot: 2, kind: 'knife', auto: true,
    dmg: 55, dmg2: 110, rpm: 140, rpm2: 55, range: 1.9, mag: 0, reserve: 0, pen: 0, falloff: [99, 99, 1],
    spread: { base: 0, move: 0, air: 0, walk: 0, perShot: 0, maxHeat: 0, recover: 1, ads: 1 },
    recoil: [[0, 0]], kick: 0.4, recover: 10, speed: 1.08, ads: { fov: 1, time: 0.1, sight: 'none' }, sound: 'knife', vm: 'knife',
  },
};
export const GRENADES = {
  frag: { id: 'frag', name: 'Frag', fuse: 2.2, dmg: 110, radius: 7.5, count: 1 },
  flash: { id: 'flash', name: 'Flash', fuse: 1.5, radius: 22, count: 1 },
  smoke: { id: 'smoke', name: 'Smoke', fuse: 1.6, radius: 4.6, life: 15, count: 1 },
};
export const PRIMARIES = ['vk12', 'r4', 'wasp', 'longbolt', 'breacher'];

export function makeWeaponState(id) {
  const d = WEAPONS[id];
  return { id, def: d, mag: d.mag, reserve: d.reserve, next: 0, reloadT: 0, reloading: false, shots: 0, heat: 0, boltT: 0, pumpT: 0, shellQueue: 0 };
}
export function makeLoadout(primary) {
  return {
    guns: [makeWeaponState(primary), makeWeaponState('talon'), makeWeaponState('knife')],
    nades: { frag: 1, flash: 1, smoke: 1 },
    nadeSel: 'frag',
  };
}
// current spread in degrees for an actor with weapon state w
export function spreadOf(w, a) {
  const s = w.def.spread;
  const speed = Math.hypot(a.vel.x, a.vel.z);
  let v = s.base + w.heat;
  if (!a.onGround) v += s.air;
  else if (speed > 3.0) v += s.move * Math.min(1, (speed - 1.2) / 4);
  else if (speed > 0.4) v += s.walk;
  if (a.crouching && a.onGround) v *= 0.75;
  if (a.ads > 0.5) v *= s.ads;
  return v;
}
export function falloffMult(def, d) {
  const [a, b, m] = def.falloff;
  if (d <= a) return 1;
  if (d >= b) return m;
  return 1 + (m - 1) * (d - a) / (b - a);
}
