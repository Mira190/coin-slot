// The four circuits (layout data only; geometry in track.js, dressing in scenery.js).
// Pieces: ['S', len, opts] straight, ['T', deg, radius, opts] arc (+ = left). opts:
//   y (end height), y0 (start height: a step = drop), w (end width), adj (closure straight),
//   tunnel, bridge, ice, gap, sand, jump (frac | [frac, h, len]), pads [[frac, lat]], box [frac], label.
// Branches: { from/to: [piece, frac, lat], via: [[piece, frac, lat, y]], w, tunnel, ... } join the loop tangentially.

export const TRACKS = [
  {
    id: 'metro', zh: '霓虹都会', en: 'Neon Metro', theme: 'city', laps: 3, w: 19,
    blurb: '夜色都会的连环弯：立交环桥、地下通道、运河飞跃、小巷近道。',
    blurbEn: 'Back-to-back corners downtown at night: a flyover loop, an underpass, a canal jump and an alley shortcut.',
    pieces: [
      ['S', 90, { adj: 1, pads: [[0.3, 0]] }],
      ['T', -90, 45, { label: 1 }],
      ['S', 80, { box: [0.5] }],
      ['T', 90, 28, { label: 2 }],
      ['T', -90, 28, { label: 3 }],
      ['S', 55, { tunnel: 1, y: -3 }],
      ['S', 55, { tunnel: 1, y: 0, pads: [[0.4, 4]] }],
      ['T', -180, 24, { label: 4 }],
      ['S', 60, { box: [0.5] }],
      ['T', 90, 32, { label: 5 }],
      ['S', 70, { pads: [[0.5, -4]] }],
      ['T', -270, 38, { y: 9, label: 6, bridge: 1 }],
      ['S', 60, { bridge: 1 }],
      ['S', 80, { bridge: 1, y: 0, box: [0.6] }],
      ['T', -90, 40, { label: 7 }],
      ['S', 120, { pads: [[0.3, 4], [0.75, -4]] }],
      ['T', -90, 36, { label: 8 }],
      ['S', 60, { adj: 1, jump: [1, 2.6, 12], pads: [[0.35, 0]] }],
      ['S', 16, { gap: 1 }],
      ['S', 40, {}],
      ['T', 60, 30, { label: 9 }],
      ['S', 30, {}],
      ['T', -60, 30, { label: 10 }],
      ['S', 40, { box: [0.5] }],
      ['T', -60, 30, { label: 11 }],
      ['S', 30, {}],
      ['T', 60, 30, { label: 12 }],
      ['S', 30, {}],
      ['T', -90, 40, { label: 13 }],
      ['S', 60, {}]
    ],
    branches: [{ from: [20, 0, 0], to: [26, 1, 0], w: 9, kind: 'alley', pads: [[0.45, 0]] }]
  },
  {
    id: 'bay', zh: '蓝湾风车', en: 'Windmill Bay', theme: 'coast', laps: 3, w: 19,
    blurb: '白墙蓝顶的海湾小镇：爬坡连续弯、风车山脊、岬角隧道、海湾长桥、码头飞跃。',
    blurbEn: 'A whitewashed harbour town: climbing switchbacks, a windmill ridge, a headland tunnel, a long sea bridge and a pier jump.',
    verts: [
      [-80, 300, 35, { start: 0.45, label: 12, s: { box: [0.85] } }],
      [170, 300, 45, { y: 1, label: 1 }],
      [170, 210, 20, { y: 5, label: 2 }],
      [105, 210, 20, { y: 8, label: 3 }],
      [105, 120, 20, { y: 12, label: 4 }],
      [180, 120, 22, { y: 15, label: 5, s: { pads: [[0.35, 0]] } }],
      [180, -40, 45, { y: 22, label: 6, s: { tunnel: [0.62, 1], box: [0.28], pads: [[0.5, -4], [0.5, 4]] } }],
      [-120, -40, 40, { y: 30, label: 7, a: { tunnel: 1 }, s: { tunnel: [0, 0.3] } }],
      [-120, 50, 30, { y: 26, label: 8, s: { box: [0.5] } }],
      [-220, 50, 30, { y: 21, label: 9 }],
      [-250, 140, 40, { y: 16, label: 10, s: { pads: [[0.4, 0]] } }],
      [-180, 230, 45, { y: 11, s: { bridge: [0.45, 1], box: [0.3] } }],
      [-250, 420, 50, { y: 7, label: 11, a: { bridge: 1 }, s: { bridge: 1, pads: [[0.5, 0]] } }],
      [-80, 440, 45, { y: 7, a: { bridge: 1 }, s: { bridge: 1, jump: [1, 1.4, 10] } }],
      [-80, 365, 0, { y: 7, s: { drop: [0, 6] } }]
    ],
    branches: [{ from: [7, 0.55, 0], to: [9, 0.45, 0], w: 9, kind: 'stairs', pads: [[0.5, 0]] }]
  },
  {
    id: 'glacier', zh: '霜辉冰川', en: 'Aurora Glacier', theme: 'snow', laps: 3, w: 19,
    blurb: '星空光带下的雪山：盘山爬坡、冰晶隧道、跳台飞降、冰湖近道、峡谷木桥。',
    blurbEn: 'Snow peaks under the aurora: a climbing pass, a crystal ice tunnel, a ski-jump drop, a frozen-lake shortcut and a gorge bridge.',
    verts: [
      [-200, 350, 40, { start: 0.3, label: 11, s: { box: [0.85] } }],
      [-200, 150, 30, { y: 6, label: 1 }],
      [-80, 150, 26, { y: 11, label: 2 }],
      [-80, 60, 26, { y: 16, label: 3, s: { pads: [[0.5, 0]] } }],
      [-180, 60, 26, { y: 20, label: 4 }],
      [-180, -60, 45, { y: 25, label: 5, s: { tunnel: [0.15, 0.75], ice: [0.15, 0.75], pads: [[0.45, 0]], box: [0.88] } }],
      [120, -60, 50, { y: 26, label: 6, s: { jump: [1, 1.5, 12], pads: [[0.25, 0]] } }],
      [120, 20, 0, { y: 26, s: { drop: [0, 12] } }],
      [120, 200, 45, { y: 3, label: 7, s: { box: [0.25] } }],
      [270, 200, 45, { y: 0, label: 8 }],
      [270, 300, 40, { y: 0, label: 9 }],
      [150, 300, 50, { y: 0, label: 10, s: { bridge: [0.35, 0.75], pads: [[0.2, 0]] } }],
      [0, 370, 60, { y: 0, s: { box: [0.5] } }]
    ],
    branches: [{ from: [8, 0.55, 0], to: [10, 0.45, 0], via: [[9, 0.5, -38, 0]], w: 11, ice: 1, kind: 'lake' }]
  },
  {
    id: 'dunes', zh: '沙海金塔', en: 'Sunsand Pyramids', theme: 'desert', laps: 3, w: 19,
    blurb: '黄沙中的古老金塔：S弯、U弯接直角弯，翻越塔顶飞跃或钻进墓道，绿洲长桥与穿塔隧道。',
    blurbEn: 'Ancient pyramids in the dunes: S-bends, a U-turn into a right-angle, fly over the summit or cut through the tomb, an oasis bridge and a pyramid tunnel.',
    verts: [
      [-300, 0, 45, { start: 0.35, label: 12, s: { box: [0.8] } }],
      [40, 0, 60, { label: 1 }],
      [150, 60, 45, { label: 2, s: { pads: [[0.5, 0]] } }],
      [280, 40, 50, { label: 3 }],
      [310, 200, 26, { label: 4 }],
      [230, 200, 26, { label: 5 }],
      [230, 120, 30, { label: 6 }],
      [160, 120, 0, { s: { pads: [[0.15, -5], [0.15, 5]] } }],
      [50, 120, 0, { y: 22, s: { jump: [1, 1.2, 8] } }],
      [20, 120, 0, { y: 22, s: { drop: [0, 10] } }],
      [-50, 120, 0, { y: 0 }],
      [-130, 120, 40, { label: 7, s: { box: [0.5] } }],
      [-130, 240, 35, { label: 8 }],
      [-220, 270, 35, { label: 9, s: { bridge: [0.2, 0.8], pads: [[0.5, 0]] } }],
      [-200, 400, 40, { label: 10 }],
      [-310, 400, 40, { label: 11, s: { box: [0.4] } }],
      [-345, 200, 60, { s: { tunnel: [0.3, 0.62], pads: [[0.46, 0]] } }]
    ],
    branches: [{ from: [5, 0.25, 4], to: ['c11', 0.8, 2], via: [[7, 0.35, 20, 0], [9, 0.5, 20, 0]], w: 10, tunnel: [0.3, 0.72], kind: 'tomb' }]
  }
];
