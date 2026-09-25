// Folded Steps: level data. Cells are unit cubes [x, y, z, flags]; a cell's top face sits at y + 0.5.
// flags: n = solid, no walkable faces   a = accent stone   b = second stone   d = dome   t = turret
// Tiles are referenced as 'group:x,y,z' (top face) or 'group:x,y,z:+x' (a side face).
// Every level here is proven solvable by tools/solve.mjs (Dijkstra over the full state space).
const R = (x0, x1, y0, y1, z0, z1, f = '') => { const o = []; for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) o.push([x, y, z, f]); return o; };
const col = (x, z, y0, y1, f = 'b') => R(x, x, y0, y1, z, z, f);

export const LEVELS = [
  {
    id: 'threshold', par: 1, title: 'Threshold', zh: '门槛', chapter: 0, pal: 'dawn', water: -5,
    line: 'The road goes on wherever the eye agrees that it does.',
    groups: [
      {
        id: 'a', deco: [['lamp', 3, 0, 3, 'nw'], ['lamp', 4, 0, 3, 'ne'], ['lamp', 0, 0, 4, 'sw'], ['lamp', 0, 1, 0, 'ne'], ['flag', 0, 1, -1, 'nw']],
        blocks: [
          ...R(3, 4, 0, 0, 3, 4), ...col(3, 3, -5, -1), ...col(4, 4, -5, -1), ...col(3, 4, -5, -1), ...col(4, 3, -5, -1),
          ...R(0, 2, 0, 0, 4, 4), ...col(0, 4, -5, -1), [1, -1, 4, 'q'], [2, -1, 4, 'q'],
          ...R(0, 0, 0, 0, 2, 3), [0, 0, 1], ...col(0, 1, -5, -1),
          ...R(0, 0, 1, 1, -1, 0), ...col(0, -1, -5, 0),
          [4, 1, 6], ...col(4, 6, -5, 0),
        ],
        stairs: [[0, 1, 1, '-z']],
      },
      {
        id: 'tower', deco: [['lamp', -6, -1, -5, 'sw']], kind: 'lift', style: 'rise', poses: [{ off: [0, -9, 0] }, {}],
        blocks: [[-6, -1, -7, 'n'], [-6, 0, -7, 'd'], ...col(-4, -4, -5, -2, ''), ...col(-6, -4, -5, -1), [-6, -1, -5], [-6, -1, -6, 'a']],
        stairs: [[-5, -1, -4, '-x']],
      },
    ],
    plates: [{ tile: 'a:0,1,-1', lifts: ['tower'], latch: true }],
    player: 'a:4,0,4', goal: 'a:-6,-1,-6'.replace('a:', 'tower:'), glimmer: 'a:4,1,6',
  },
  {
    id: 'garden', par: 2, title: 'Turning Garden', zh: '转园', chapter: 0, pal: 'mint', water: -5,
    line: 'A garden that turns is still a garden; only its doors move.',
    groups: [
      {
        id: 'a', deco: [['lamp', 0, 0, -3, 'ne'], ['lamp', -1, 0, -3, 'nw'], ['turret', 5, 3, -1]],
        blocks: [
          [-1, 0, -3], [0, 0, -3], [0, 0, -2], ...col(-1, -3, -5, -1), ...col(0, -2, -5, -1),
          ...R(4, 5, 2, 2, 2, 2), ...col(4, 2, -5, 1), ...col(5, 2, -5, 1), [5, 2, 1], [5, 2, 0], [5, 3, 0, 'a'], [5, 3, -1, 'n'],
          [-4, -2, -2], ...col(-4, -2, -5, -3),
        ],
        stairs: [[5, 3, 1, '-z']],
      },
      {
        id: 'g', deco: [['tree', 0, 0, -1], ['tree', 0, 0, 1]], kind: 'rotor', axis: 'y', pivot: [0, 0, 0], cyc: true, start: 1, handle: [0, -1, 0],
        blocks: [[0, 0, 0], [-1, 0, 0], [1, 0, 0], [0, 0, -1, 'n'], [0, 0, 1, 'n'], ...col(0, 0, -5, -1)],
      },
    ],
    player: 'a:-1,0,-3', goal: 'a:5,3,0', glimmer: 'a:-4,-2,-2',
  },
  {
    id: 'endless', par: 3, title: 'The Endless Stair', zh: '无尽阶', chapter: 0, pal: 'rose', water: -5,
    line: 'Climb long enough and the top will come round to meet you.',
    groups: [
      {
        id: 'a', deco: [['lamp', -2, 0, 2, 'sw'], ['flag', -1, 4, 0, 'ne'], ['lamp', -2, 4, 0, 'nw']],
        blocks: [[-2, 0, 2], [-2, 0, 1], [-2, 0, 0], [-1, 0, 0], ...col(-2, 2, -5, -1), ...col(-1, 0, -5, -1), [-2, 4, 0], [-1, 4, 0], [-3, 4, 0, 'a'], ...col(-3, 0, -5, 3)],
      },
      {
        id: 'loop', deco: [['lamp', 0, 0, 0, 'nw'], ['lamp', 4, 2, 0, 'ne'], ['lamp', 4, 4, 6, 'se']], kind: 'rotor', plain: true, axis: 'y', pivot: [2, 0, 3], cyc: true, start: 1, handle: [4, 0.2, 2],
        blocks: [
          [0, 0, 0], ...col(0, 0, -5, -1), [1, 0, 0, 'n'], [2, 1, 0], ...col(2, 0, -5, 0), [3, 1, 0, 'n'], [4, 2, 0], ...col(4, 0, -5, 1),
          [4, 2, 1], ...col(4, 1, -5, 1), [4, 2, 2], ...col(4, 2, -5, 1), [4, 2, 3, 'n'], [4, 3, 4], ...col(4, 4, -5, 2), [4, 3, 5, 'n'], [4, 4, 6], ...col(4, 6, -5, 3),
          [3, 3, 4], ...col(3, 4, -5, 2),
        ],
        stairs: [[1, 1, 0, '+x'], [3, 2, 0, '+x'], [4, 3, 3, '+z'], [4, 4, 5, '+z']],
      },
    ],
    player: 'a:-2,0,2', goal: 'a:-3,4,0', glimmer: 'loop:3,3,4',
  },
  {
    id: 'lift', par: 3, title: 'The Patient Lift', zh: '升台', chapter: 1, pal: 'sea', water: -5,
    line: 'Rise one floor and the whole world rearranges its doors.',
    groups: [
      {
        id: 'a', deco: [['lamp', -1, 0, 1, 'nw'], ['lamp', -1, 0, 2, 'sw'], ['flag', 2, 2, 1, 'ne'], ['turret', -5, 1, -5]],
        blocks: [[-5, 1, -5, 'n'], 
          ...R(-1, 1, 0, 0, 1, 2), ...col(-1, 2, -5, -1), ...col(1, 1, -5, -1), ...col(1, 2, -5, -1), ...col(-1, 1, -5, -1),
          [2, 2, 1, 'a'], ...col(2, 1, -2, 1, 'n'),
          [-3, 1, -2], ...col(-3, -2, -5, 0), [-5, 1, -2], [-5, 1, -3], [-5, 1, -4, 'a'], ...col(-5, -2, -5, 0), ...col(-5, -4, -5, 0),
          [-2, 0, -3], ...col(-2, -3, -5, -1),
        ],
      },
      {
        id: 'e', kind: 'slider', dir: [0, 1, 0], n: 4, start: 0, handle: [0.62, -0.5, 0],
        blocks: [[0, 0, 0], ...col(0, 0, -6, -1, 'b')],
      },
      { id: 'bridge', kind: 'lift', style: 'rise', poses: [{ off: [0, -7, 0] }, {}], blocks: [[-4, 1, -2], ...col(-4, -2, -5, 0)] },
    ],
    plates: [{ tile: 'a:2,2,1', lifts: ['bridge'], latch: true }],
    player: 'a:1,0,2', goal: 'a:-5,1,-4', glimmer: 'a:-2,0,-3',
  },
  {
    id: 'winds', par: 3, title: 'Keep of Four Winds', zh: '四风堡', chapter: 1, pal: 'lilac', water: -5,
    line: 'Turn the whole world a quarter, and strangers become neighbours.',
    world: { pivot: [0, 0, 0], handle: [0, 3.6, 0], start: 0 },
    groups: [
      {
        id: 'a', deco: [['lamp', -6, 0, 0, 'nw'], ['flag', 1, 2, 0, 'ne'], ['lamp', 3, 0, -4, 'sw'], ['lamp', 0, 2, 2, 'sw']],
        blocks: [[6, 1, -8, 'n'], [6, 2, -8, 'd'], 
          ...R(-6, -3, 0, 0, 0, 0), ...col(-6, 0, -5, -1), ...col(-3, 0, -5, -1),
          [0, 2, 2], [1, 2, 2], [1, 2, 1], [1, 2, 0], ...col(0, 2, -5, 1), ...col(1, 0, -5, 1), ...col(0, 0, -5, 1, 'n'),
          [3, 0, -3], [3, 0, -4], [4, 0, -4], ...col(3, -3, -5, -1), ...col(4, -4, -5, -1),
          [5, 1, -6], [5, 1, -7], [6, 1, -7, 'a'], ...col(5, -6, -5, 0), ...col(6, -7, -5, 0),
          [4, 0, 4], ...col(4, 4, -5, -1),
        ],
      },
    ],
    player: 'a:-6,0,0', goal: 'a:6,1,-7', glimmer: 'a:4,0,4',
  },
  {
    id: 'sunken', par: 5, title: 'The Sunken Court', zh: '沉庭', chapter: 1, pal: 'jade', water: -5,
    line: 'What sank here was only waiting to be asked.',
    groups: [
      {
        id: 'a', deco: [['lamp', 0, 0, 0, 'nw'], ['lamp', 6, 0, 0, 'se'], ['lamp', 3, 0, -3, 'nw'], ['flag', -3, 2, -7, 'nw']],
        blocks: [
          ...R(0, 1, 0, 0, 0, 1), ...col(0, 1, -5, -1), ...col(1, 0, -5, -1),
          ...R(5, 6, 0, 0, 0, 0), ...col(6, 0, -5, -1),
          [3, 0, -2], [3, 0, -3], ...col(3, -3, -5, -1),
          [3, 0, 2], ...col(3, 2, -5, -1),
          [2, 2, -7], ...col(2, -7, -5, 1), [-3, 2, -7], [-4, 2, -7], ...col(-4, -7, -5, 1), ...col(-3, -7, -5, 1),
          [0, 3, -5], ...col(0, -5, 0, 2, 'n'),
        ],
      },
      {
        id: 'compass', deco: [['tree', 3, 0, -1], ['tree', 3, 0, 1]], kind: 'rotor', axis: 'y', pivot: [3, 0, 0], cyc: true, start: 1, handle: [3, -1, 0],
        blocks: [[3, 0, 0], [2, 0, 0], [4, 0, 0], [3, 0, -1, 'n'], [3, 0, 1, 'n'], ...col(3, 0, -5, -1)],
      },
      { id: 'sl', kind: 'slider', dir: [-1, 0, 0], n: 3, start: 0, handle: [0.5, 2, -6.38], blocks: [[0, 2, -7], [1, 2, -7]] },
      {
        id: 'stage1', kind: 'lift', style: 'rise', poses: [{ off: [0, -9, 0] }, {}],
        blocks: [[3, 1, -5], ...col(3, -5, -5, 0), [3, 2, -7], ...col(3, -7, -5, 1)],
        stairs: [[3, 1, -4, '-z'], [3, 2, -6, '-z']],
      },
      {
        id: 'stage2', kind: 'lift', style: 'rise', poses: [{ off: [0, -10, 0] }, {}],
        blocks: [[3, 0, 3], ...col(3, 3, -5, -1), [3, 1, 5], ...col(3, 5, -5, 0), ...R(2, 4, 2, 2, 7, 8), ...col(2, 8, -5, 1), ...col(4, 8, -5, 1), ...col(3, 7, -5, 1), [3, 3, 9, 'd']],
        stairs: [[3, 1, 4, '+z'], [3, 2, 6, '+z']],
      },
    ],
    plates: [{ tile: 'a:6,0,0', lifts: ['stage1'], latch: true }, { tile: 'a:-4,2,-7', lifts: ['stage2'], latch: true }],
    player: 'a:0,0,1', goal: 'stage2:3,2,8', glimmer: 'a:0,3,-5',
  },
  {
    id: 'spire', par: 2, title: 'The Clinging Spire', zh: '攀塔', chapter: 2, pal: 'peach', water: -5,
    line: 'Down is only a habit. Break it gently.',
    groups: [
      {
        id: 'a', deco: [['lamp', 1, 0, 0, 'nw'], ['lamp', 0, 0, 2, 'sw'], ['dome', -6, 2, -6]],
        blocks: [[-6, 2, -6, 'n'], 
          ...R(1, 3, 0, 0, 0, 0), ...col(1, 0, -5, -1), ...col(3, 0, -5, -1),
          [0, 0, 1], [0, 0, 2], ...col(0, 2, -5, -1), ...col(0, 1, -5, -1),
          [-5, 2, -4], [-6, 2, -4], [-6, 2, -5, 'a'], ...col(-5, -4, -5, 1), ...col(-6, -5, -5, 1),
        ],
      },
      {
        id: 'sp', deco: [['flag', 0, 6, 0, 'ne']], kind: 'rotor', axis: 'y', pivot: [0, 0, 0], cyc: true, start: 0, handle: [0, -1.5, 0],
        blocks: [...col(0, 0, -5, 6, '')],
        walls: [[0, 1, 0, '+x'], [0, 2, 0, '+x'], [0, 3, 0, '+x'], [0, 3, 0, '-z'], [0, 4, 0, '-z'], [0, 5, 0, '-z'], [0, 6, 0, '-z']],
      },
    ],
    player: 'a:3,0,0', goal: 'a:-6,2,-5', glimmer: 'a:0,0,2',
  },
  {
    id: 'wardens', par: 2, title: 'The Warden', zh: '守者', chapter: 2, pal: 'dusk', water: -5,
    line: 'It will not let you pass. It will, however, let itself be carried.',
    groups: [
      {
        id: 'a', deco: [['lamp', -6, 0, -1, 'nw'], ['lamp', -5, 0, 0, 'se'], ['dome', 4, 1, -4], ['flag', 4, 0, 0, 'se']],
        blocks: [[4, 1, -4, 'n'], 
          ...R(-6, -5, 0, 0, -1, 0), ...col(-6, -1, -5, -1), ...col(-5, 0, -5, -1),
          ...R(-4, 1, 0, 0, 0, 0), ...col(-3, 0, -5, -1), ...col(0, 0, -5, -1), [-2, -1, 0, 'r'], [-1, -1, 0, 'r'],
          [3, 0, 0], [4, 0, 0], ...col(4, 0, -5, -1), [4, 1, -2], [4, 1, -3, 'a'], ...col(4, -3, -5, 0), [4, 0, -2, 'n'],
          [1, -1, -4], ...col(1, -4, -5, -2),
        ],
        stairs: [[4, 1, -1, '-z']],
      },
      { id: 'sh', kind: 'slider', dir: [0, 0, 1], n: 2, start: 0, handle: [2.62, -0.2, 0], blocks: [[2, 0, -1], [2, 0, 0], ...col(2, 0, -3, -1)] },
    ],
    sentinels: [{ rail: ['a:-4,0,0', 'sh:2,0,0'], start: 3, dir: 1 }],
    player: 'a:-6,0,-1', goal: 'a:4,1,-3', glimmer: 'a:1,-1,-4',
  },
  {
    id: 'bell', title: 'The Bell Keeper', zh: '钟守', chapter: 2, pal: 'plum', water: -5,
    line: 'Even a warden can be asked to hold a door.',
    groups: [
      {
        id: 'a', deco: [['lamp', -6, 0, 0, 'nw'], ['lamp', 0, 0, 0, 'se'], ['flag', -1, 4, -2, 'nw']],
        blocks: [
          ...R(-6, -4, 0, 0, 0, 0), ...col(-6, 0, -5, -1), ...col(-4, 0, -5, -1),
          [0, 0, 0], ...col(0, 0, -5, -1), ...col(0, -1, -5, 4, ''), [0, 4, -2], [-1, 4, -2, 'a'], ...col(-1, -2, -5, 3), ...col(0, -2, -5, 3),
          ...R(-6, -3, 2, 2, -3, -3), ...col(-6, -3, -5, 1), ...col(-3, -3, -5, 1),
          [2, 5, 0], ...col(2, 0, 1, 4, 'n'),
        ],
        walls: [[0, 1, -1, '+z'], [0, 2, -1, '+z'], [0, 3, -1, '+z'], [0, 4, -1, '+z']],
      },
      { id: 'bridge', kind: 'lift', style: 'rise', poses: [{ off: [0, -8, 0] }, {}], blocks: [...R(-3, -1, 0, 0, 0, 0), ...col(-2, 0, -5, -1)] },
      // the bell sits at the open west end of the warden's walk, where nothing stands in front of it
      { id: 'bell', deco: [['dome', -8, 2, -3]], kind: 'rotor', axis: 'y', pivot: [-8, 2, -3], cyc: true, start: 0, handle: [-8, 1, -3], blocks: [[-7, 2, -3], [-8, 2, -3, 'n'], ...col(-8, -3, -5, 1)] },
    ],
    plates: [{ tile: 'bell:-7,2,-3', lifts: ['bridge'] }],
    sentinels: [{ rail: ['a:-3,2,-3', 'bell:-7,2,-3'], start: 0, dir: 1 }],
    player: 'a:-6,0,0', goal: 'a:-1,4,-2', glimmer: 'a:2,5,0',
  },
  {
    id: 'lintel', par: 1, title: 'Lintel', zh: '楣石', chapter: 3, pal: 'sand', water: -5,
    line: 'A friend of stone: slow to speak, quick to hold a door.',
    groups: [
      {
        id: 'a', deco: [['lamp', -5, 0, -1, 'nw'], ['lamp', 5, 0, 0, 'se'], ['lamp', 0, 0, 1, 'sw'], ['turret', 5, 1, -3]],
        blocks: [[5, 1, -3, 'n'], 
          ...R(-5, -4, 0, 0, -1, 0), ...col(-5, -1, -5, -1), ...col(-4, 0, -5, -1),
          ...R(0, 1, 0, 0, 0, 0), [0, 0, 1], ...col(0, 1, -5, -1), ...col(1, 0, -5, -1),
          [2, -1, 1], [2, -1, 0], ...col(2, 1, -5, -2), ...col(2, 0, -5, -2),
          ...R(3, 5, 0, 0, 0, 0), ...col(3, 0, -5, -1), ...col(5, 0, -5, -1), [5, 1, -2, 'a'], ...col(5, -2, -5, 0),
          [0, -2, -3], ...col(0, -3, -5, -3),
        ],
        stairs: [[1, 0, 1, '-x'], [5, 1, -1, '-z']],
      },
      { id: 'b1', kind: 'lift', style: 'rise', poses: [{ off: [0, -8, 0] }, {}], blocks: [...R(-3, -1, 0, 0, 0, 0), ...col(-2, 0, -5, -1)] },
    ],
    plates: [{ tile: 'a:-5,0,-1', lifts: ['b1'] }],
    companion: 'a:-5,0,0',
    player: 'a:-4,0,-1', goal: 'a:5,1,-2', glimmer: 'a:0,-2,-3',
  },
  {
    id: 'weight', par: 2, title: 'The Weight of Stone', zh: '石重', chapter: 3, pal: 'moss', water: -5,
    line: 'Leave a friend where the door is heavy, and walk on lightly.',
    groups: [
      {
        id: 'a', deco: [['tree', -3, 1, -3], ['tree', -2, 1, -3], ['turret', 0, 1, -6], ['lamp', -7, 0, 0, 'nw'], ['lamp', 1, 0, 0, 'ne']],
        blocks: [
          ...R(-7, -6, 0, 0, 0, 1), ...col(-7, 1, -5, -1), ...col(-6, 0, -5, -1),
          ...R(-5, 1, 0, 0, 0, 0), ...col(-4, 0, -5, -1), ...col(-1, 0, -5, -1), ...col(1, 0, -5, -1), [-3, -1, 0, 'r'], [-2, -1, 0, 'r'], [0, -1, 0, 'r'],
          ...R(-3, -2, 0, 0, -2, -2), ...col(-3, -2, -5, -1), [-3, 1, -3, 'n'], [-2, 1, -3, 'n'],
          [1, 0, -2], [1, 0, -3], ...col(1, -3, -5, -1), [1, 1, -5], [1, 1, -6, 'a'], ...col(1, -6, -5, 0), [0, 1, -6, 'n'],
          [-2, -1, -3], ...col(-2, -3, -5, -2),
        ],
        stairs: [[1, 1, -4, '-z']],
      },
      { id: 'sl', kind: 'slider', dir: [-1, 0, 0], n: 3, start: 0, handle: [0, -0.2, -0.38], blocks: [[0, 0, -1], ...col(0, -1, -2, -1)] },
      { id: 'door', kind: 'lift', style: 'rise', poses: [{ off: [0, -8, 0] }, {}], blocks: [[1, 0, -1], ...col(1, -1, -5, -1)] },
    ],
    plates: [{ tile: 'a:-3,0,-2', lifts: ['door'] }],
    sentinels: [{ rail: ['a:-4,0,0', 'a:1,0,0'], start: 2, dir: 1 }],
    companion: 'a:-6,0,1',
    player: 'a:-7,0,1', goal: 'a:1,1,-6', glimmer: 'a:-2,-1,-3',
  },
  {
    id: 'crown', par: 4, title: 'The Folded Crown', zh: '折冠', chapter: 3, pal: 'aurora', water: -5,
    line: 'Everything you learned was one road, folded until it fit in your hand.',
    world: { pivot: [2, 0, 3], handle: [2, 3.1, 3], start: 0, cyc: false, min: 0, max: 1 },
    groups: [
      {
        id: 'a', deco: [['lamp', -4, 1, 1, 'nw'], ['lamp', 10, 5, 1, 'se'], ['lamp', 0, 0, 0, 'nw'], ['lamp', 4, 4, 6, 'se'], ['flag', 10, 5, 8, 'ne']],
        blocks: [
          // the start island (it meets the loop only when the world is turned a quarter)
          [-2, 1, 1], [-3, 1, 1], [-4, 1, 1], ...col(-2, 1, -5, 0), ...col(-4, 1, -5, 0),
          // the Penrose loop around the crank tower
          [0, 0, 0], ...col(0, 0, -5, -1), [1, 0, 0, 'n'], [2, 1, 0], ...col(2, 0, -5, 0), [3, 1, 0, 'n'], [4, 2, 0], ...col(4, 0, -5, 1),
          [4, 2, 1], ...col(4, 1, -5, 1), [4, 2, 2], ...col(4, 2, -5, 1), [4, 2, 3, 'n'], [4, 3, 4], ...col(4, 4, -5, 2), [4, 3, 5, 'n'], [4, 4, 6], ...col(4, 6, -5, 3),
          [3, 3, 4], ...col(3, 4, -5, 2), ...col(2, 3, -5, 2, 'n'),
          // the upper terrace, the alcove and the wall tower
          [10, 5, 4], [10, 5, 3], ...col(10, 4, -5, 4), ...col(10, 3, -5, 4),
          [10, 5, 1], [9, 5, 1], [8, 5, 1], ...col(10, 1, -5, 4), ...col(8, 1, -5, 4),
          [10, 5, 8], ...col(10, 8, -5, 4),
          ...col(10, -1, -5, 9, ''),
        ],
        stairs: [[1, 1, 0, '+x'], [3, 2, 0, '+x'], [4, 3, 3, '+z'], [4, 4, 5, '+z']],
        walls: [[10, 6, -1, '+z'], [10, 7, -1, '+z'], [10, 8, -1, '+z'], [10, 9, -1, '+z']],
      },
      {
        id: 'rise', kind: 'lift', style: 'rise', poses: [{ off: [0, -11, 0] }, {}],
        blocks: [[5, 4, 6], ...col(5, 6, -5, 3), [7, 5, 6], [8, 5, 6], ...col(7, 6, -5, 4), ...col(8, 6, -5, 4)],
        stairs: [[6, 5, 6, '+x']],
      },
      { id: 'tt', kind: 'rotor', axis: 'y', pivot: [10, 5, 6], cyc: true, start: 3, handle: [10, 4, 6], blocks: [[10, 5, 6], [9, 5, 6], [10, 5, 5], ...col(10, 6, -5, 4)] },
      { id: 'sh', kind: 'slider', dir: [1, 0, 0], n: 2, start: 0, handle: [9.5, 5, 2.62], blocks: [[9, 5, 2], [10, 5, 2], ...col(10, 2, 2, 4)] },
      { id: 'gate', kind: 'lift', style: 'rise', poses: [{ off: [0, -11, 0] }, {}], blocks: [[10, 5, 0], ...col(10, 0, -5, 4)] },
      {
        id: 'crown', kind: 'lift', style: 'unfold', poses: [{ off: [0, -15, 0] }, {}],
        deco: [['flag', 9, 10, -3], ['flag', 11, 10, -3]],
        blocks: [[10, 9, -2], [10, 9, -3, 'a'], [9, 9, -3, 'n'], [11, 9, -3, 'n'], [9, 9, -4, 'n'], [11, 9, -4, 'n'], [10, 9, -4, 'n'], [10, 10, -4, 'd'], [9, 10, -4, 't'], [11, 10, -4, 't'], [9, 10, -3, 'n'], [11, 10, -3, 'n'], ...col(10, -2, 4, 8, 'n'), ...col(9, -4, 5, 8, 'n'), ...col(11, -4, 5, 8, 'n')],
      },
    ],
    plates: [
      { tile: 'a:4,2,0', lifts: ['rise'], latch: true },
      { tile: 'a:8,5,1', lifts: ['gate'] },
      { tile: 'a:10,9,-1', lifts: ['crown'], latch: true },
    ],
    sentinels: [{ rail: ['a:10,5,4', 'sh:10,5,2'], start: 0, dir: 1 }],
    companion: 'a:4,2,2',
    player: 'a:-4,1,1', goal: 'crown:10,9,-3', glimmer: 'a:10,5,8',
  },
];
