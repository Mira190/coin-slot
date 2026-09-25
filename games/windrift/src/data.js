// Static game data: karts, paints, rivals, items, technique timing windows, physics constants.

export const KMH = 4.8;          // display km/h per unit/s
export const GRAV = 30;          // gravity, units/s²
export const STEP = 1 / 60;      // fixed simulation step

// Timing windows (seconds). The HUD, the AI and the physics all read these.
export const WIN = {
  straighten: 0.34,   // max time after releasing Shift for the body to straighten before the boost light appears
  micro: 0.45,        // 小喷 light: tap ↑ while it is lit
  perfect: 0.15,      // …within this much of the light → 完美 (perfect)
  pullSlip: 0.17,     // 双喷: counter-steer mid-drift until the slip angle is below this (rad) → first light
  snap: 0.5,          // 断位: re-press Shift within this long after releasing it
  tap: 0.3,           // 点漂: drifts shorter than this
  whip: 0.4,          // 甩尾: Shift first, then tap-tap the direction within this long
  land: 0.35,         // 落地喷: tap ↑ within this long after touching down
  airMin: 0.12,       // 空喷: at least this long in the air
  start: [-0.12, 0.3] // 起步喷: press ↑ from 0.3 s before GO to 0.12 s after it
};

export const TIERS = [
  { t: 0, color: 0xfff1b8, zh: '', en: '' },
  { t: 0.45, color: 0x4cc9ff, zh: '蓝火', en: 'BLUE' },
  { t: 1.1, color: 0xffa21f, zh: '橙火', en: 'ORANGE' },
  { t: 1.9, color: 0xd35cff, zh: '紫火', en: 'VIOLET' }
];

// stats: top speed (u/s), accel, handling, drift (charge rate), nitro (power+duration), micro (small-boost power),
// weight (bumps and item knock-back). shape drives kart.js.
export const KARTS = [
  { id: 'gale', zh: '疾风', en: 'Gale', tag: '均衡 All-rounder', top: 42, accel: 24, handling: 1.0, drift: 1.0, nitro: 1.0, micro: 1.0, weight: 1.0,
    shape: { len: 3.2, wid: 1.9, nose: 0.5, wing: 'low', pods: 1, fins: 0, exh: 2, canopy: 0, wheel: 0.42 } },
  { id: 'bolt', zh: '惊雷', en: 'Thunderbolt', tag: '极速 Top speed', top: 44.2, accel: 20, handling: 0.9, drift: 0.95, nitro: 1.0, micro: 0.95, weight: 1.25,
    shape: { len: 3.8, wid: 1.85, nose: 0.9, wing: 'high', pods: 1, fins: 1, exh: 4, canopy: 0, wheel: 0.44 } },
  { id: 'swift', zh: '飞燕', en: 'Swift', tag: '操控 Handling', top: 41.4, accel: 24, handling: 1.16, drift: 1.05, nitro: 0.95, micro: 1.0, weight: 0.85,
    shape: { len: 3.0, wid: 1.8, nose: 0.6, wing: 'split', pods: 0, fins: 1, exh: 2, canopy: 0, wheel: 0.4 } },
  { id: 'blaze', zh: '焰尾', en: 'Blaze', tag: '氮气 Nitro power', top: 41.8, accel: 22, handling: 0.98, drift: 1.0, nitro: 1.28, micro: 1.0, weight: 1.0,
    shape: { len: 3.4, wid: 2.0, nose: 0.4, wing: 'twin', pods: 1, fins: 0, exh: 4, canopy: 0, wheel: 0.43, tanks: 1 } },
  { id: 'hopper', zh: '跳跳', en: 'Hopper', tag: '加速 Launch', top: 41, accel: 31, handling: 1.05, drift: 1.0, nitro: 0.95, micro: 1.05, weight: 0.8,
    shape: { len: 2.7, wid: 2.0, nose: 0.2, wing: 'none', pods: 0, fins: 0, exh: 2, canopy: 1, wheel: 0.5 } },
  { id: 'blade', zh: '冰刃', en: 'Iceblade', tag: '集气 Drift charge', top: 41.5, accel: 23, handling: 1.03, drift: 1.32, nitro: 0.95, micro: 1.0, weight: 0.95,
    shape: { len: 3.5, wid: 1.75, nose: 1.0, wing: 'blade', pods: 0, fins: 2, exh: 2, canopy: 0, wheel: 0.4 } },
  { id: 'bulwark', zh: '钢甲', en: 'Bulwark', tag: '重量 Heavy', top: 42.6, accel: 19, handling: 0.9, drift: 0.95, nitro: 1.05, micro: 0.95, weight: 1.55,
    shape: { len: 3.4, wid: 2.25, nose: 0.3, wing: 'low', pods: 2, fins: 0, exh: 2, canopy: 0, wheel: 0.5, armor: 1 } },
  { id: 'mirage', zh: '镜光', en: 'Mirage', tag: '小喷 Micro boost', top: 42, accel: 23, handling: 1.0, drift: 1.08, nitro: 1.02, micro: 1.3, weight: 0.95,
    shape: { len: 3.6, wid: 1.9, nose: 0.8, wing: 'high', pods: 1, fins: 2, exh: 2, canopy: 1, wheel: 0.42 } }
];

// stat bars (0..1) for the garage
export function statBars(k) {
  const n = (v, a, b) => Math.max(0.08, Math.min(1, (v - a) / (b - a)));
  return [
    ['极速', 'Speed', n(k.top, 40, 44.5)], ['加速', 'Accel', n(k.accel, 17, 32)], ['操控', 'Handling', n(k.handling, 0.85, 1.2)],
    ['集气', 'Charge', n(k.drift, 0.9, 1.35)], ['氮气', 'Nitro', n(k.nitro, 0.9, 1.3)], ['重量', 'Weight', n(k.weight, 0.75, 1.6)]
  ];
}

export const PAINTS = [
  { zh: '烈焰红', en: 'Flame', c: '#E5243B' }, { zh: '日落橙', en: 'Sunset', c: '#FF8A1F' }, { zh: '柠檬黄', en: 'Lemon', c: '#FFD21F' },
  { zh: '青柠绿', en: 'Lime', c: '#39C75A' }, { zh: '湖水蓝', en: 'Lagoon', c: '#17B6D9' }, { zh: '宝石蓝', en: 'Sapphire', c: '#2A5BFF' },
  { zh: '紫罗兰', en: 'Violet', c: '#8E4DFF' }, { zh: '樱花粉', en: 'Sakura', c: '#FF5FA2' }, { zh: '珍珠白', en: 'Pearl', c: '#F0F1F5' },
  { zh: '曜石黑', en: 'Obsidian', c: '#23252C' }, { zh: '香槟金', en: 'Champagne', c: '#D8B25A' }, { zh: '电光银', en: 'Chrome', c: '#AEB6C2' }
];

export const RIVALS = [
  { zh: '小雨', en: 'Rain', paint: 4, kart: 2 }, { zh: '阿杰', en: 'Jay', paint: 0, kart: 1 }, { zh: '米粒', en: 'Millie', paint: 7, kart: 4 },
  { zh: '大熊', en: 'Bruno', paint: 9, kart: 6 }, { zh: '七七', en: 'Kiki', paint: 6, kart: 7 }, { zh: '阿布', en: 'Abu', paint: 1, kart: 3 },
  { zh: '柚子', en: 'Yuzu', paint: 3, kart: 5 }
];

// Items (道具赛). target: 'ahead' (next racer ahead), 'leader', 'ahead3', 'self', 'behind' (drop)
const svg = (b) => '<svg viewBox="0 0 40 40" width="30" height="30" aria-hidden="true">' + b + '</svg>';
export const ITEMS = {
  missile: { zh: '导弹', en: 'Missile', color: '#FF4B4B', target: 'ahead', icon: svg('<path d="M8 32l5-11L28 6l6 6-15 15z" fill="#ff4b4b" stroke="#0b1236" stroke-width="2.5" stroke-linejoin="round"/><path d="M8 32l3-8 5 5z" fill="#ffd21f"/><circle cx="25" cy="15" r="3" fill="#fff"/>') },
  banana: { zh: '香蕉皮', en: 'Banana', color: '#FFD21F', target: 'behind', icon: svg('<path d="M9 11c2 14 12 21 25 19-10-2-16-9-18-19z" fill="#ffd21f" stroke="#0b1236" stroke-width="2.5" stroke-linejoin="round"/><path d="M9 11l-2-5 4 1z" fill="#7a4a1a"/>') },
  fog: { zh: '云雾', en: 'Ink Fog', color: '#8E7BFF', target: 'ahead3', icon: svg('<path d="M10 27a7 7 0 011-14 9 9 0 0117-2 7 7 0 012 16z" fill="#4a3a78" stroke="#0b1236" stroke-width="2.5"/><circle cx="15" cy="33" r="2.5" fill="#4a3a78"/><circle cx="24" cy="35" r="2" fill="#4a3a78"/>') },
  magnet: { zh: '磁铁', en: 'Magnet', color: '#FF5A5A', target: 'ahead', icon: svg('<path d="M9 6h8v14a3 3 0 006 0V6h8v14a11 11 0 01-22 0z" fill="#ff4b4b" stroke="#0b1236" stroke-width="2.5" stroke-linejoin="round"/><path d="M9 6h8v5H9zM23 6h8v5h-8z" fill="#e6f5ff"/>') },
  angel: { zh: '天使', en: 'Angel', color: '#FFF1A8', target: 'self', icon: svg('<ellipse cx="20" cy="8" rx="8" ry="3" fill="none" stroke="#ffd21f" stroke-width="3"/><path d="M20 14c-6 0-8 6-8 12h16c0-6-2-12-8-12z" fill="#fff" stroke="#0b1236" stroke-width="2.5"/><path d="M12 22C5 20 3 14 4 11c4 3 7 4 9 6zM28 22c7-2 9-8 8-11-4 3-7 4-9 6z" fill="#bfe9ff" stroke="#0b1236" stroke-width="2"/>') },
  turbo: { zh: '加速', en: 'Turbo', color: '#29D3FF', target: 'self', icon: svg('<path d="M22 3L8 23h10l-3 14 16-21H21z" fill="#29d3ff" stroke="#0b1236" stroke-width="2.5" stroke-linejoin="round"/>') },
  bubble: { zh: '水泡', en: 'Bubble Fly', color: '#5CC8FF', target: 'leader', icon: svg('<circle cx="20" cy="21" r="14" fill="#5cc8ff" fill-opacity=".45" stroke="#bff0ff" stroke-width="2.5"/><circle cx="15" cy="15" r="3" fill="#fff"/><circle cx="22" cy="23" r="3.5" fill="#1a4f8a"/><path d="M18 20l-5-4M26 20l5-4" stroke="#dff6ff" stroke-width="2.5" stroke-linecap="round"/>') },
  devil: { zh: '恶魔', en: 'Devil', color: '#FF3D8B', target: 'ahead', icon: svg('<circle cx="20" cy="22" r="11" fill="#e0245e" stroke="#0b1236" stroke-width="2.5"/><path d="M11 15L7 5l9 6M29 15l4-10-9 6" fill="#e0245e" stroke="#0b1236" stroke-width="2.5" stroke-linejoin="round"/><path d="M14 21l4 2M26 21l-4 2" stroke="#fff" stroke-width="2.5" stroke-linecap="round"/><path d="M15 28q5 3 10 0" fill="none" stroke="#fff" stroke-width="2"/>') },
  tornado: { zh: '龙卷风', en: 'Tornado', color: '#9FE8FF', target: 'ahead', icon: svg('<path d="M6 8h28M9 14h22M12 20h16M15 26h10M18 32h5" stroke="#9fe8ff" stroke-width="4" stroke-linecap="round"/><path d="M6 8h28M9 14h22M12 20h16M15 26h10M18 32h5" stroke="#0b1236" stroke-width="1" stroke-linecap="round" opacity=".5"/>') },
  turtle: { zh: '乌龟', en: 'Turtle', color: '#4CC46C', target: 'leader', icon: svg('<ellipse cx="20" cy="22" rx="13" ry="9" fill="#3baa5c" stroke="#0b1236" stroke-width="2.5"/><path d="M13 22l7-6 7 6-7 6z" fill="#8fe0a0"/><circle cx="34" cy="20" r="4" fill="#8fe0a0" stroke="#0b1236" stroke-width="2"/>') }
};
// odds by race position fraction (0 = leading, 1 = last)
export function itemOdds(frac, isLeader) {
  if (isLeader) return { banana: 34, angel: 24, fog: 18, turbo: 14, missile: 0, magnet: 0, bubble: 0, turtle: 0, devil: 0, tornado: 0 };
  const b = frac;
  return {
    missile: 16 + 10 * b, banana: 22 - 16 * b, fog: 12, magnet: 8 + 10 * b, angel: 12 - 8 * b,
    turbo: 10 + 12 * b, bubble: 5 + 10 * b, turtle: 5 + 8 * b, devil: 5 + 5 * b, tornado: 3 + 7 * b
  };
}

export const MODES = {
  speed: { zh: '竞速赛', en: 'Speed Race', desc: '漂移集气，氮气冲刺。', descEn: 'Drift to charge nitro. Pure racing.' },
  item: { zh: '道具赛', en: 'Item Race', desc: '吃道具箱，两个道具栏，Z / X 使用。', descEn: 'Grab item boxes, two slots, Z / X to use.' },
  tt: { zh: '计时赛', en: 'Time Trial', desc: '独自跑圈，挑战最佳圈的幽灵车。', descEn: 'Solo laps against the ghost of your best lap.' }
};
