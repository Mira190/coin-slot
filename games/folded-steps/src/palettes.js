// Folded Steps: chapters and per-level palettes (pastel, warm/cool balanced, nothing fully saturated).
export const CHAPTERS = [
  { n: '壹', roman: 'I', title: 'The First Fold', zh: '初折', line: 'Walk, and let the eye be your bridge.' },
  { n: '贰', roman: 'II', title: 'Water Courts', zh: '水院', line: 'What sinks is only waiting to be asked.' },
  { n: '叁', roman: 'III', title: 'Walls That Walk', zh: '壁行', line: 'Down is a habit. So is fear. Both can be folded.' },
  { n: '肆', roman: 'IV', title: 'The Stone Companion', zh: '石伴', line: 'Some roads are only wide enough for two.' },
];

// sky: [top, horizon]; stone: walkable tops & bodies; col: supports; acc: accent stone; mech: moving parts;
// handle: cranks; wall: gravity walls; water: [deep, shallow]; mist; glow: goal / glimmer light; leaf: topiary
export const PALETTES = {
  dawn:   { sky: ['#f7c9b6', '#fdeede'], stone: '#f0d8c2', col: '#d9b8b0', acc: '#e98f7f', mech: '#f2a65a', handle: '#e2645a', wall: '#b9d4e6', water: ['#6f93b8', '#a9c8dc'], mist: '#fbe7da', glow: '#ffd48a', leaf: '#9cc59a', roof: '#d87c6e', sun: '#ffe2c4' },
  mint:   { sky: ['#bfe3d6', '#eef7ef'], stone: '#e2ecd8', col: '#b7cfc0', acc: '#e7a3a0', mech: '#f0b776', handle: '#e06f5f', wall: '#c9b8e8', water: ['#4f9a9a', '#9fd3c9'], mist: '#e6f4ec', glow: '#fff0a8', leaf: '#6fae88', roof: '#e29a7c', sun: '#f4fff2' },
  rose:   { sky: ['#e9b8c9', '#fbe8ea'], stone: '#f2d8d7', col: '#d7aebb', acc: '#9b87c9', mech: '#f3c26b', handle: '#d9546a', wall: '#aed7d0', water: ['#7a78b3', '#c2b6dc'], mist: '#fae3e7', glow: '#ffe09a', leaf: '#a6c59d', roof: '#b77aa0', sun: '#fff0ea' },
  sea:    { sky: ['#a7cfe6', '#e9f4f7'], stone: '#dbe7ec', col: '#a9c0cf', acc: '#f0b28a', mech: '#ef8f6f', handle: '#d65c5c', wall: '#f3d59b', water: ['#3f7fa6', '#8fc3da'], mist: '#e3f0f5', glow: '#fff3b0', leaf: '#86b8a4', roof: '#e0896c', sun: '#f2fbff' },
  lilac:  { sky: ['#c6b8e6', '#f1eaf7'], stone: '#e5dbef', col: '#b8a8d0', acc: '#f0a98c', mech: '#8fc9b8', handle: '#e07a5f', wall: '#f5d08a', water: ['#6d6aa8', '#b3aede'], mist: '#ece4f5', glow: '#ffe4a3', leaf: '#9fbf96', roof: '#9d7fc4', sun: '#fbf5ff' },
  jade:   { sky: ['#9fd1c2', '#e7f5ee'], stone: '#dce9db', col: '#9fbfb2', acc: '#e7b86f', mech: '#e98f86', handle: '#c9594f', wall: '#cdb9ea', water: ['#2f7f7a', '#86c7b6'], mist: '#dff1e8', glow: '#fff1a6', leaf: '#5e9e7c', roof: '#d6865f', sun: '#f1fff8' },
  peach:  { sky: ['#f5c7a3', '#fdf0e2'], stone: '#f4dfc9', col: '#e0b79d', acc: '#8fb6c9', mech: '#9ac79b', handle: '#d9605a', wall: '#bfd8f0', water: ['#6c8fb0', '#b3cde0'], mist: '#fdeadb', glow: '#ffe3a0', leaf: '#8dbb8a', roof: '#d9876a', sun: '#fff4e8' },
  dusk:   { sky: ['#8f86c3', '#f3c9b9'], stone: '#e8d7de', col: '#a99bc0', acc: '#f0a07a', mech: '#f4c46f', handle: '#e2645a', wall: '#a7d5d2', water: ['#4c4f8f', '#9a93c7'], mist: '#e9d8e2', glow: '#ffd98a', leaf: '#8fb39b', roof: '#8c77b8', sun: '#ffe6d6' },
  plum:   { sky: ['#b894c2', '#f4e3ee'], stone: '#ebd7e5', col: '#b89ab8', acc: '#86b9b0', mech: '#f1b36e', handle: '#d45470', wall: '#f2d58f', water: ['#6a4f8c', '#b39ccb'], mist: '#efdfea', glow: '#ffe2a0', leaf: '#94b894', roof: '#a8729c', sun: '#fff0f6' },
  sand:   { sky: ['#e8cfa6', '#faf1e3'], stone: '#efdfc6', col: '#d6bf9c', acc: '#86a7c9', mech: '#e59273', handle: '#cf5f4f', wall: '#b9d7c4', water: ['#5d8aa0', '#a8cbd3'], mist: '#f7ecdc', glow: '#ffe7a3', leaf: '#9cb88a', roof: '#c98a64', sun: '#fff7ea' },
  moss:   { sky: ['#b6cfa2', '#f0f4e4'], stone: '#e3e9d2', col: '#b3c3a0', acc: '#d79a8e', mech: '#e9b06a', handle: '#c95b50', wall: '#c1b3e3', water: ['#4c7f6c', '#9cc6ad'], mist: '#e8f0dd', glow: '#fff0a2', leaf: '#6f9d6a', roof: '#c47f63', sun: '#f7fff0' },
  aurora: { sky: ['#6f7bc2', '#f6d2c4'], stone: '#eadce9', col: '#a8a3cf', acc: '#f2c46b', mech: '#f09a86', handle: '#e2586b', wall: '#9fdad0', water: ['#3e4d8f', '#96a6d8'], mist: '#e8dcec', glow: '#ffe08f', leaf: '#8fc0a2', roof: '#9a7cc9', sun: '#fff1dc' },
};
