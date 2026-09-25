// Chamber data. Each chamber: sculpted geometry, entities, fixed gates, TALLY's lines and a scripted solution.
// Coordinates in metres, +y up. Yaw: 0 faces -z (north), 90 faces -x (west), -90 faces +x (east), 180 faces +z.
//
// Solution steps (run by debug.js with the real controls and physics):
//   ['goto', x, z, tol?]   walk to a point on the current floor
//   ['walk', yaw, sec]     hold forward at a yaw; stops early when the player passes a gate
//   ['enter', i, sec, back] line up `back` m in front of wall gate i (as it actually landed), then walk into it
//   ['shoot', i, x, y, z]  aim at a point and fire gate i (0 jade, 1 vermilion); must succeed
//   ['look', x, y, z]      aim   ['use'] E   ['jump']   ['wait', sec]   ['until', 'js expr', timeout]
import { Sculpt } from './sculpt.js';

const DIRS = { n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0] };
const YAW = { n: 0, s: 180, e: -90, w: 90 };

// Entry vestibule. (x, y, z) = doorway centre on the chamber wall's inner face; dir points into the chamber.
function entry(s, L, x, y, z, dir, opts = {}) {
  const [dx, dz] = DIRS[dir], bx = x - dx * 3, bz = z - dz * 3; // vestibule centre (interior 4x4)
  s.room(bx - 2, y, bz - 2, bx + 2, y + 3.4, bz + 2, { all: 'M', floor: 'M' });
  const w = dz !== 0 ? [x - 1.25, y, Math.min(z, z - dz), x + 1.25, y + 3, Math.max(z, z - dz)] : [Math.min(x, x - dx), y, z - 1.25, Math.max(x, x - dx), y + 3, z + 1.25];
  s.hollow(...w);
  L.ents.push({ t: 'door', p: [x - dx * 0.5, y, z - dz * 0.5], axis: dz !== 0 ? 'x' : 'z', w: 2.5, h: 3, in: 'start' });
  if (opts.sign !== false) L.ents.push({ t: 'sign', p: [bx + (dz !== 0 ? -1.99 : dx * 0), y + 1.9, bz + (dx !== 0 ? -1.99 : 0)], face: dz !== 0 ? [1, 0, 0] : [0, 0, 1] });
  L.lamps.push([bx, y + 3.4, bz, 1, 1.6]);
  L.spawn = { p: [bx - dx * 0.6, y, bz - dz * 0.6], yaw: YAW[dir] };
  L.inside = [x + dx * 2.2, z + dz * 2.2];
}
// The scripted solution, preceded by a walk through the entry door.
export function botSteps(L) {
  const s = L.solve.slice(); s.splice(1, 0, ['goto', L.inside[0], L.inside[1], 0.5]);
  if (L.goalAt) s.push(['goto', L.goalAt[0], L.goalAt[1], 0.3]);
  return s;
}
// Exit vestibule. dir points from the chamber into the vestibule. Door opens on `open`.
function exit(s, L, x, y, z, dir, open) {
  const [dx, dz] = DIRS[dir], bx = x + dx * 3, bz = z + dz * 3;
  s.room(bx - 2, y, bz - 2, bx + 2, y + 3.4, bz + 2, { all: 'M' });
  const w = dz !== 0 ? [x - 1.25, y, Math.min(z, z + dz), x + 1.25, y + 3, Math.max(z, z + dz)] : [Math.min(x, x + dx), y, z - 1.25, Math.max(x, x + dx), y + 3, z + 1.25];
  s.hollow(...w);
  L.ents.push({ t: 'door', p: [x + dx * 0.5, y, z + dz * 0.5], axis: dz !== 0 ? 'x' : 'z', w: 2.5, h: 3, in: open });
  const gx = bx + dx * 0.7, gz = bz + dz * 0.7, hx = dx ? 1.3 : 1.8, hz = dz ? 1.3 : 1.8; // back part of the vestibule
  L.ents.push({ t: 'goal', min: [gx - hx, y - 0.5, gz - hz], max: [gx + hx, y + 3, gz + hz] });
  L.lamps.push([bx, y + 3.4, bz, 1, 1.6]);
  L.exitAt = [bx, y, bz]; L.goalAt = [gx, gz];
}
function base(id, name, icons, gun) { return { id, name, icons, gun, ents: [], lamps: [], gates: [], say: {}, solve: [] }; }

// ---------------------------------------------------------------- 01 Induction: no device. Fixed gates, block, button.
function c01() {
  const L = base('induction', 'Induction', ['gate', 'cube', 'button'], 0), s = new Sculpt();
  s.room(-6, 0, -6, 6, 6, 6, { all: 'W', ceil: 'M' });
  s.room(9, 0, -6, 15, 5, 0, { all: 'W', ceil: 'M' });
  s.solid(6, 0, -6, 9, 5, 0, 'M');
  s.hollow(6, 1.2, -4.5, 9, 3.2, -1.5);             // observation slot into the block room
  s.solid(7.45, 1.2, -4.5, 7.55, 3.2, -1.5, 'G');
  entry(s, L, 0, 0, 6, 'n');
  exit(s, L, -3, 0, -6, 'n', 'b1');
  L.lamps.push([-3, 6, 0, 1.2, 4], [3, 6, 0, 1.2, 4], [12, 5, -3, 1.2, 3]);
  L.gates.push({ i: 0, c: [-6, 1.2, 1], n: [1, 0, 0] }, { i: 1, c: [12, 1.2, 0], n: [0, 0, -1] });
  L.ents.push({ t: 'cube', p: [13, 0.36, -4] }, { t: 'button', id: 'b1', p: [2, 0, -2] },
    { t: 'wire', in: 'b1', path: [[2, 0.001, -1], [2, 0.001, -5.4], [-1.6, 0.001, -5.4]] },
    { t: 'trigger', min: [-6, 0, -2], max: [0, 3, 4], say: 'gate' }, { t: 'trigger', min: [9, 0, -6], max: [15, 3, 0], say: 'room' });
  L.boxes = s.result();
  L.say = {
    start: ['Good morning. I am TALLY, the evaluation system of Hinge Laboratories.', 'You have been selected for testing. "Selected" is the polite word. There were no other words available.'],
    gate: 'That glowing oval is a gate. Walk into it. Your matter will be conserved, give or take.',
    room: 'That is a Weighted Test Block. Press E to hold it. It is heavier than it looks and cheaper than you.',
    b1: 'Adequate. The exit is open. I have written "showed up" in your file.',
    done: 'Trial one complete. Some candidates never find the door. They are also in your file. As a warning.',
  };
  L.solve = [['wait', 1.4], ['goto', 0, 3], ['enter', 0], ['goto', 13, -2.6], ['look', 13, 0.36, -4], ['use'],
    ['enter', 1], ['goto', 2, -0.4, 0.2], ['look', 2, 0.6, -2], ['use'], ['wait', 1.8], ['goto', -3, -5], ['goto', -3, -8.6]];
  return L;
}

// ---------------------------------------------------------------- 02 Single Stroke: jade only; vermilion fixed on a ledge.
function c02() {
  const L = base('single-stroke', 'Single Stroke', ['gate', 'cube', 'button'], 1), s = new Sculpt();
  s.room(-7, 0, -10, 7, 8, 6, { all: 'M' });
  s.paint(7, 0, -10, 8, 3.6, 6, 'W');                 // east wall: light panels up to 3.6 m
  s.solid(-7, 0, -10, -1, 4, -5, 'M');                // the ledge
  s.paint(-6, 4, -11, -2, 6.6, -10, 'W');             // panel behind the fixed gate
  entry(s, L, 3, 0, 6, 'n');
  exit(s, L, -7, 4, -8, 'w', 'b1');
  L.lamps.push([0, 8, -3, 1.2, 5], [-4, 8, -7.5, 1.2, 3]);
  L.gates.push({ i: 1, c: [-4, 5.2, -10], n: [0, 0, 1] });
  L.ents.push({ t: 'cube', p: [3, 0.36, 1.5] }, { t: 'button', id: 'b1', p: [-3, 4, -6.6] },
    { t: 'wire', in: 'b1', path: [[-3, 4.001, -7.6], [-3, 4.001, -8], [-6.4, 4.001, -8]] });
  L.boxes = s.result();
  L.say = {
    start: ['This device makes one gate. The other end has been installed for you, because trust is earned.', 'Left click places your gate. Somewhere useful, ideally.'],
    fail: 'Gates only take to the light panels. The dark metal is load-bearing and emotionally unavailable.',
    b1: 'You carried a block up a wall without touching the wall. I will allow it.',
    done: 'Trial two complete. Your aim is noted. It is noted in pencil.',
  };
  L.solve = [['wait', 1.4], ['goto', 3, 3.5], ['shoot', 0, 7, 1.4, 0], ['look', 3, 0.36, 1.5], ['use'], ['enter', 0],
    ['goto', -3, -8.3, 0.2], ['look', -3, 4.5, -6.6], ['use'], ['wait', 1.8], ['goto', -6, -8], ['goto', -9.6, -8]];
  return L;
}

// ---------------------------------------------------------------- 03 Both Hands: full device. Cross a pit, then climb.
function c03() {
  const L = base('both-hands', 'Both Hands', ['gate', 'acid'], 2), s = new Sculpt();
  s.room(-5, 0, -19, 5, 9, 6, { all: 'M' });
  s.paint(-6, 0, 0, -5, 5, 6, 'W');                   // near west wall panels
  s.paint(5, 0, -14, 6, 5, -10, 'W');                 // far east wall panels
  s.paint(-5, 3, -20, 5, 7.5, -19, 'W');              // north wall above the ledge
  s.solid(-6, -4, -11, 6, 0, 1, 'M'); s.hollow(-5, -3, -10, 5, 0, 0); // the pit
  s.solid(-5, 0, -19, 5, 3, -14, 'M');                // ledge, deep enough to land on after a high exit
  entry(s, L, 0, 0, 6, 'n');
  exit(s, L, -5, 3, -16.5, 'w');
  L.lamps.push([0, 9, 2, 1.2, 4], [0, 9, -7, 1.2, 5], [0, 9, -14, 1.2, 4]);
  L.ents.push({ t: 'acid', min: [-5, -3, -10], max: [5, -1.3, 0] }, { t: 'stripe', min: [-5, -0.02, -0.12], max: [5, 0.02, 0] }, { t: 'stripe', min: [-5, -0.02, -10], max: [5, 0.02, -9.88] },
    { t: 'trigger', min: [-5, 0, -14], max: [5, 3, -10], say: 'far' });
  L.boxes = s.result();
  L.say = {
    start: ['The device now makes both gates. Left is jade, right is vermilion. Try not to let it go to your head.', 'The liquid below is caustic ink. It is not water. It is not anything you should learn the name of.'],
    far: 'Across. Now leave one gate where it is and move the other. Gates are like opinions: reposition them freely.',
    die: 'You fell in. I have filed that under "enthusiasm".',
    done: 'Two gates, one person, zero drownings. Textbook. A thin textbook.',
  };
  L.solve = [['wait', 1.4], ['goto', 0, 3], ['shoot', 0, -5, 1.5, 3], ['shoot', 1, 5, 1.5, -12], ['enter', 0],
    ['goto', 0, -11.2], ['shoot', 0, 0, 6.2, -19], ['enter', 1], ['until', 'player.grounded', 3], ['wait', 0.4], ['goto', -3, -16.5], ['goto', -7.6, -16.5]];
  return L;
}

// ---------------------------------------------------------------- 04 Freight: carry a block between two high perches.
function c04() {
  const L = base('freight', 'Freight', ['gate', 'cube', 'button'], 2), s = new Sculpt();
  s.room(-8, 0, -10, 8, 10, 8, { all: 'M' });
  s.paint(-6, 0, 8, 8, 4.2, 9, 'W');                  // south wall
  s.solid(4, 0, -10, 8, 5, -5, 'M');                  // east shelf
  s.paint(8, 5, -10, 9, 9, -5, 'W');
  s.solid(-8, 0, -10, -4, 4.5, -5, 'M');              // west balcony
  s.paint(-9, 4.5, -10, -8, 9, -5, 'W');
  entry(s, L, -8, 0, 4, 'e');
  exit(s, L, -6, 4.5, -10, 'n', 'b1');
  L.lamps.push([0, 10, 0, 1.2, 5], [6, 10, -7.5, 1.2, 3], [-6, 10, -7.5, 1.2, 3]);
  L.ents.push({ t: 'dropper', p: [6, 5, -8.2] }, { t: 'button', id: 'b1', p: [-6, 4.5, -7] },
    { t: 'wire', in: 'b1', path: [[-6, 4.501, -8], [-6, 4.501, -9.4]] },
    { t: 'trigger', min: [4, 5, -10], max: [8, 8, -5], say: 'shelf' });
  L.boxes = s.result();
  L.say = {
    start: ['Freight. You will move a block from where it is to where it is not. This is most of science.'],
    shelf: 'Note that the gate you came out of is still behind you. Gates remember. Unlike some candidates.',
    b1: 'Delivery confirmed.',
    done: 'I would tip you, but you would only spend it on oxygen.',
  };
  L.solve = [['wait', 1.4], ['goto', -6, 6], ['shoot', 1, 8, 6.9, -7.5], ['shoot', 0, 0, 1.5, 8], ['enter', 0],
    ['wait', 0.5], ['goto', 6.4, -6.2], ['shoot', 0, -8, 6.5, -7.5], ['look', 6, 5.36, -8.2], ['use'], ['enter', 1, 8, 1.4],
    ['wait', 0.3], ['goto', -6, -5.5, 0.2], ['look', -6, 5.0, -7], ['use'], ['wait', 1.8], ['goto', -4.6, -6.2], ['goto', -4.6, -9.2], ['goto', -6, -9.7], ['goto', -6, -12.6]];
  return L;
}

// Ballistic arc for the diagrams: start point (player centre), velocity, until y < yStop.
function arc(p, v, yStop, g = 15) { const pts = []; for (let t = 0; t < 4; t += 0.04) { const y = p[1] + v[1] * t - g * t * t / 2; pts.push([p[0] + v[0] * t, y, p[2] + v[2] * t]); if (y < yStop) break; } return pts; }
const fall = (h) => Math.sqrt(2 * 15 * h);

// ---------------------------------------------------------------- 05 Drop Zone: fixed exit gate; fall into your own for speed.
function c05() {
  const L = base('drop-zone', 'Drop Zone', ['gate', 'fling', 'acid'], 1), s = new Sculpt();
  s.room(-5, -5, -30, 5, 14, 6, { all: 'M' });
  s.solid(-5, -5, 1, 5, 10, 6, 'M');                  // start balcony, 10 m up
  s.solid(-5, -5, -7, 5, 0, 1, 'M'); s.paint(-5, -1, -7, 5, 0, 1, 'W'); // drop floor (light panels)
  s.solid(-5, -5, -8, 5, 3, -7, 'M');                 // divider carrying the fixed exit
  s.paint(-1.2, -1.2, -8.2, 1.2, 1.8, -7.9, 'W');
  s.solid(-5, -5, -30, 5, -3, -17, 'M');              // far floor
  entry(s, L, 0, 10, 6, 'n');
  exit(s, L, 0, -3, -30, 'n');
  L.lamps.push([0, 14, 3, 1.2, 4], [0, 14, -6, 1.2, 4], [0, 14, -18, 1.2, 5], [0, 14, -27, 1.2, 3]);
  L.gates.push({ i: 1, c: [0, 0.3, -8], n: [0, 0, -1] });
  L.ents.push({ t: 'acid', min: [-5, -5, -17], max: [5, -3.4, -8] }, { t: 'stripe', min: [-5, 9.98, 0.9], max: [5, 10.02, 1] },
    { t: 'trigger', min: [-5, -4, -30], max: [5, 2, -17], say: 'far' }, { t: 'trigger', min: [-5, 0, -7], max: [5, 3, 1], say: 'floor', grounded: true });
  L.boxes = s.result();
  L.arcs = [{ pts: arc([0, 10.9, 1.8], [0, 0, -4.6], 0) }, { pts: arc([0, 0.3, -8], [0, 4.6, -fall(10.9)], -2.2) }];
  L.say = {
    start: ['Momentum. Fall into one gate and you leave the other at the same speed, in a new direction.', 'The exit gate has been installed for you. Where you fall is up to you.'],
    far: 'Falling sideways is still falling. It just has better prospects.',
    floor: 'Floor reached by the traditional method. It does not count. Press R to go again, and keep your eyes on the gate as you fall.',
    done: 'You fell one way and landed another. That is either physics or a career.',
  };
  L.solve = [['wait', 1.4], ['goto', 0, 1.3, 0.15], ['shoot', 0, 0, 0, -4.4], ['goto', 0, 2.2, 0.15], ['walk', 0, 4], ['until', 'player.grounded', 4], ['wait', 0.6], ['goto', 0, -27], ['goto', 0, -32.6]];
  return L;
}

// ---------------------------------------------------------------- 06 Long Jump: both ends yours; the exit is an angled panel.
function c06() {
  const L = base('long-jump', 'Long Jump', ['gate', 'fling', 'acid'], 2), s = new Sculpt();
  s.room(-6, -3, -38, 6, 14, 8, { all: 'M' });
  s.solid(-6, -3, 2, 6, 8, 8, 'M');                   // start ledge, 8 m up
  s.solid(-6, -3, -8, 6, -2, 2, 'W');                 // pit floor: light panels
  s.solid(-6, -3, -38, 6, -1.5, -17, 'M');            // landing plateau
  entry(s, L, 0, 8, 8, 'n');
  exit(s, L, 0, -1.5, -38, 'n');
  // the angled launch panel sits at the foot of the ledge, facing up and away: seen from above, it launches forward
  L.obbs = [{ c: [0, -0.65, 0.56], h: [6, 1.5, 1.6], r: [-45, 0, 0], s: 'W' }];
  L.lamps.push([0, 14, 4, 1.2, 4], [0, 14, -6, 1.2, 4], [0, 14, -18, 1.2, 5], [0, 14, -30, 1.2, 5]);
  L.ents.push({ t: 'acid', min: [-6, -3, -17], max: [6, -2.2, -8] }, { t: 'trigger', min: [-6, -2, -38], max: [6, 3, -17], say: 'far' },
    { t: 'trigger', min: [-6, -2, -8], max: [6, 1, 2], say: 'pit', grounded: true });
  L.boxes = s.result();
  const v = fall(10.9) * 0.707;
  L.arcs = [{ pts: arc([0, 8.9, 2.3], [0, 0, -4.6], -2) }, { pts: arc([0, 1.2, -0.6], [0, v, -v], -0.6) }, { pts: arc([0, 1.2, -0.6], [0, v - 3.25, -v - 3.25], -0.6), color: '#e0a060' }, { pts: arc([0, 1.2, -0.6], [0, v + 3.25, -v + 3.25], -0.6), color: '#e0a060' }];
  L.say = {
    start: ['This time you choose both ends. Choose wisely. Or quickly; I have seen your wisely.', 'Angled panels send you out at an angle. That is the whole secret. Do not tell anyone.'],
    far: 'Airborne, then not. The transition was the best part. For me.',
    pit: 'That was a fall, not a launch. Press R to return to the ledge, walk off toward your floor gate and watch it all the way down.',
    done: 'You launched yourself over a pool of ink on purpose. I am updating your risk profile.',
  };
  L.solve = [['wait', 1.4], ['goto', 0, 2.3, 0.15], ['shoot', 0, 0, -2, -3.4], ['shoot', 1, 0, 0.45, -0.5], ['goto', 0, 3.2, 0.15], ['walk', 0, 4], ['until', 'player.grounded', 5], ['wait', 0.6], ['goto', 0, -35], ['goto', 0, -40.6]];
  return L;
}

// ---------------------------------------------------------------- 07 Clearance: grids eat gates and blocks; route around.
function c07() {
  const L = base('clearance', 'Clearance', ['grid', 'gate', 'cube', 'button'], 2), s = new Sculpt();
  s.room(-8, 0, -12, 8, 9, 8, { all: 'M' });
  s.paint(-8, 0, 8, 8, 4, 9, 'W');                    // south wall
  s.paint(-8, 5.5, -13, 8, 9, -12, 'W');              // north wall, high: seen over the divider
  s.solid(-8, 0, -3, 8, 3.5, -2, 'M');                // divider
  s.hollow(-1.5, 0, -3, 1.5, 3, -2);                  // its doorway
  entry(s, L, 5, 0, 8, 'n');
  exit(s, L, -4, 0, -12, 'n', 'b1');
  L.lamps.push([0, 9, 3, 1.2, 5], [0, 9, -7, 1.2, 5]);
  L.ents.push({ t: 'grid', min: [-1.5, 0, -2.55], max: [1.5, 3, -2.45] }, { t: 'dropper', p: [-5, 5, 4], in: 'p1' }, { t: 'pedestal', id: 'p1', p: [-6.2, 0, 6.2], yaw: -0.8, time: 1 },
    { t: 'wire', in: 'p1', path: [[-6.2, 0.001, 5.6], [-5, 0.001, 5.6], [-5, 0.001, 4.8]] }, { t: 'button', id: 'b1', p: [4, 0, -8] },
    { t: 'wire', in: 'b1', path: [[4, 0.001, -9], [4, 0.001, -11.4], [-2.6, 0.001, -11.4]] });
  L.boxes = s.result();
  L.say = {
    start: ['The shimmering field is an Emancipation Grid. It removes gates and unauthorised objects. You are authorised. Mostly.', 'It also stops gate shots. It is thorough like that.', 'The switch in the corner requests a block. Blocks are free. Their feelings are not my department.'],
    gridFizzle: 'The grid has reclaimed your gates. It is not personal. It is not a person.',
    b1: 'You routed around a security measure. I am adding that to the list of security measures.',
    done: 'Clearance granted. Retroactively.',
  };
  L.solve = [['wait', 1.4], ['goto', -5.3, 5.3, 0.3], ['look', -6.2, 1.05, 6.2], ['use'], ['wait', 1.2], ['goto', 0, 6], ['shoot', 1, 0, 7.4, -12], ['shoot', 0, 0, 1.5, 8], ['goto', -5, 2.6], ['look', -5, 0.36, 4], ['use'],
    ['enter', 0], ['until', 'player.grounded', 4], ['goto', 4, -6.3, 0.2], ['look', 4, 0.5, -8], ['use'], ['wait', 1.8], ['goto', -1, -8], ['goto', -4, -10], ['goto', -4, -14.6]];
  return L;
}

// ---------------------------------------------------------------- 08 Deep End: a platform over ink; shoot from it.
function c08() {
  const L = base('deep-end', 'Deep End', ['platform', 'gate', 'acid'], 2), s = new Sculpt();
  s.room(-6, -2, -28, 6, 10, 6, { all: 'M' });
  s.solid(-6, -2, 0, 6, 0, 6, 'M');                   // start floor
  s.solid(-6, -2, -28, 6, 4, -20, 'M');               // exit ledge
  s.paint(-6, 4, -29, 6, 9.5, -28, 'W');              // its back wall
  s.paint(6, -2, -15, 7, 4, -9, 'W');                 // east wall beside the platform's far stop
  entry(s, L, 0, 0, 6, 'n');
  exit(s, L, -6, 4, -25, 'w');
  L.lamps.push([0, 10, 2, 1.2, 4], [0, 10, -10, 1.2, 6], [0, 10, -24, 1.2, 4]);
  L.ents.push({ t: 'acid', min: [-6, -2, -20], max: [6, -0.8, 0] }, { t: 'platform', p0: [3.5, -0.2, -2], p1: [3.5, -0.2, -12], size: [4, 0.4, 3], speed: 2.2, pause: 3 },
    { t: 'stripe', min: [-6, -0.02, -0.12], max: [6, 0.02, 0] });
  L.boxes = s.result();
  L.say = {
    start: ['The liquid is caustic ink. It is used to print very short documents.', 'The platform keeps a schedule. So do you. One of you is punctual.'],
    done: 'You did not fall in. I had a form ready and everything.',
  };
  const plat = "d.ents.find((o) => o.type === 'platform').s";
  L.solve = [['wait', 1.4], ['goto', 3.5, 1.6], ['until', `${plat} < 0.02`, 14], ['goto', 3.5, -2.2, 0.3], ['until', `${plat} > 0.99`, 14], ['aim', -90, 0],
    ['shoot', 0, 6, 1.0, -12], ['shoot', 1, 0, 8.2, -28], ['enter', 0, 3, 1.2], ['until', 'player.grounded', 3], ['wait', 0.4], ['goto', -3, -25], ['goto', -8.6, -25]];
  return L;
}

// ---------------------------------------------------------------- 09 Line of Sight: carry a laser through gates to a catcher.
function c09() {
  const L = base('line-of-sight', 'Line of Sight', ['laser', 'gate'], 2), s = new Sculpt();
  s.room(-7, 0, -12, 7, 8, 6, { all: 'M' });
  s.paint(7, 0, -5, 8, 3.5, 1, 'W');                  // east wall where the beam lands
  s.paint(-3.75, 0, 6, -2.25, 2.5, 7, 'W');           // a gate-sized slot in the south wall
  entry(s, L, 3, 0, 6, 'n');
  exit(s, L, 3, 0, -12, 'n', ['c1', 'r1']);
  L.lamps.push([0, 8, 1, 1.2, 5], [0, 8, -8, 1.2, 4]);
  L.ents.push({ t: 'laser', p: [-6.6, 1.5, -2], dir: [1, 0, 0] }, { t: 'catcher', id: 'c1', p: [-3, 1.5, -12], n: [0, 0, 1] }, { t: 'relay', id: 'r1', p: [-3, 0, -7] },
    { t: 'wire', in: ['c1', 'r1'], path: [[-2.2, 0.001, -11.6], [1.6, 0.001, -11.6]] }, { t: 'wire', in: 'r1', path: [[-2.5, 0.001, -7], [-2.5, 0.001, -10.8]] });
  L.boxes = s.result();
  L.say = {
    start: ['This is a Thermal Discouragement Beam. It is discouraging. It is also thermal.', 'The catcher wants the beam. You have two gates. Introduce them.'],
    burn: 'That was the beam. You will notice it discouraged you.',
    c1: 'Beam received. You are a plumber of light now. Tell no one.',
    done: 'Line of sight established. Unlike most of your decisions.',
  };
  L.solve = [['wait', 1.4], ['goto', 3, 2.5], ['shoot', 0, 7, 1.5, -2], ['shoot', 1, -3, 1.2, 6], ['until', "sig.get('c1')", 3], ['goto', 3, -9], ['goto', 3, -14.6]];
  return L;
}

// ---------------------------------------------------------------- 10 Refraction: a lens block bends the beam into gates.
function c10() {
  const L = base('refraction', 'Refraction', ['laser', 'lens', 'gate'], 2), s = new Sculpt();
  s.room(-8, 0, -12, 8, 9, 8, { all: 'M' });
  s.paint(-3, 0, -13, 3, 3.5, -12, 'W');              // north wall, floor level
  s.paint(-9, 4.3, -6.75, -8, 6.8, -5.25, 'W');       // a gate-sized slot high on the west wall
  entry(s, L, 0, 0, 8, 'n');
  exit(s, L, 6, 0, -12, 'n', 'c1');
  L.lamps.push([0, 9, 3, 1.2, 5], [0, 9, -7, 1.2, 5]);
  L.ents.push({ t: 'laser', p: [-7.6, 0.4, 2], dir: [1, 0, 0] }, { t: 'catcher', id: 'c1', p: [8, 4.7, -6], n: [-1, 0, 0] }, { t: 'dropper', p: [5, 6, 5], kind: 'lens' },
    { t: 'wire', in: 'c1', path: [[7.9, 4, -6], [7.9, 0.2, -6]], n: [-1, 0, 0] }, { t: 'wire', in: 'c1', path: [[7.6, 0.001, -6], [7.6, 0.001, -11.6], [7.3, 0.001, -11.6]] });
  L.boxes = s.result();
  L.say = {
    start: ['The Lens Block redirects a beam in whichever direction it faces. Hold it and it faces where you face.', 'I am told that is a metaphor. I have not been told for what.'],
    c1: 'You bent light around a room. Somewhere a physicist felt a chill and did not know why.',
    done: 'Refraction complete. The block would like it noted that it did most of the work.',
  };
  L.solve = [['wait', 1.4], ['goto', 0, 4], ['shoot', 1, -8, 5.55, -6], ['shoot', 0, 0, 1.2, -12], ['goto', 5, 3.5], ['look', 5, 0.36, 5], ['use'],
    ['goto', 0, 3.35, 0.12], ['aim', 0, -30], ['wait', 0.6], ['use'], ['until', "sig.get('c1')", 4], ['goto', 4, 0], ['goto', 6, -9], ['goto', 6, -14.6]];
  return L;
}

// ---------------------------------------------------------------- 11 Leap of Faith: plates throw you; a gate catches the throw.
function c11() {
  const L = base('leap-of-faith', 'Leap of Faith', ['plate', 'gate', 'fling'], 2), s = new Sculpt();
  s.room(-8, 0, -22, 8, 12, 8, { all: 'M' });
  s.solid(-8, 0, 1.8, 8, 4.5, 2.2, 'G');              // glass wall
  s.paint(8, 1.9, -9.75, 9, 4.4, -8.25, 'W');         // slot on the east wall where the plate's arc crosses
  s.solid(-8, 0, -22, 8, 7, -16, 'M');                // gallery
  s.paint(-9, 7, -21, -8, 10, -17, 'W');              // gallery's west end wall
  entry(s, L, 0, 0, 8, 'n');
  exit(s, L, 4, 7, -22, 'n');
  L.lamps.push([0, 12, 5, 1.2, 3], [0, 12, -6, 1.2, 6], [0, 12, -19, 1.2, 4]);
  L.ents.push({ t: 'plate', p: [0, 0, 4.5], target: [0, 0, -3], apex: 7 }, { t: 'plate', p: [0, 0, -9], target: [8.6, 1.4, -9], apex: 3 },
    { t: 'trigger', min: [-8, 0, -15], max: [8, 3, 1.5], say: 'mid', grounded: true });
  L.boxes = s.result();
  L.say = {
    start: ['Aerial Faith Plates. They throw you at a precise point in space. The faith is optional. The point is not.'],
    mid: 'The second plate is aimed at the east wall. The wall has been informed. It has not moved.',
    done: 'You were thrown, caught and delivered. Like mail, but with fewer complaints. So far.',
  };
  L.solve = [['wait', 1.4], ['goto', 0, 6.3], ['walk', 0, 0.5], ['until', 'player.grounded && player.body.position.z < 0', 5], ['goto', 0, -5],
    ['shoot', 0, 8, 3.15, -9], ['shoot', 1, -8, 9.4, -19], ['goto', 0, -6.8, 0.2], ['walk', 0, 0.8], ['until', 'player.grounded && player.body.position.y > 7.5', 6], ['goto', 4, -20], ['goto', 4, -24.6]];
  return L;
}

// ---------------------------------------------------------------- 12 Hard Light: steer a light bridge across the ink.
function c12() {
  const L = base('hard-light', 'Hard Light', ['bridge', 'gate', 'cube', 'button'], 2), s = new Sculpt();
  s.room(-8, -3, -26, 8, 9, 8, { all: 'M' });
  s.solid(-8, -3, -2, 8, 0, 8, 'M');                  // start floor
  s.solid(-8, -3, -26, 8, 0, -16, 'M');               // far floor
  s.paint(-9, 0, -2, -8, 4, 8, 'W');                  // west wall
  s.paint(-8, 0, 8, 8, 4, 9, 'W');                    // south wall
  entry(s, L, 8, 0, 4, 'w');
  exit(s, L, 0, 0, -26, 'n', 'b1');
  L.spawn.yaw = 90;
  L.lamps.push([0, 9, 3, 1.2, 4], [0, 9, -9, 1.2, 6], [0, 9, -21, 1.2, 4]);
  L.ents.push({ t: 'acid', min: [-8, -3, -16], max: [8, -1.5, -2] }, { t: 'bridge', p: [8, 0.12, 0.5], dir: [-1, 0, 0] }, { t: 'dropper', p: [-4, 6, 5] },
    { t: 'button', id: 'b1', p: [-4, 0, -21] }, { t: 'wire', in: 'b1', path: [[-3, 0.001, -21], [-1.6, 0.001, -21], [-1.6, 0.001, -25.4]] },
    { t: 'stripe', min: [-8, -0.02, -2.12], max: [8, 0.02, -2] }, { t: 'stripe', min: [-8, -0.02, -16], max: [8, 0.02, -15.88] });
  L.boxes = s.result();
  L.say = {
    start: ['Hard light. Light you can stand on. We tried soft light first. People fell through it and wrote to us.', 'Like the beam before it, it goes where it is pointed. Through things, if the things are gates.'],
    b1: 'You walked a block across a pool of ink on a beam of light. Your family will not believe you. You do not have one on file.',
    done: 'Bridge decommissioned. Well, not really. It is light. It is still there.',
  };
  L.solve = [['wait', 1.4], ['goto', 2, 3], ['shoot', 0, -8, 0.5, 0.5], ['shoot', 1, 2, 1.2, 8], ['wait', 1], ['goto', -4, 3.3], ['look', -4, 0.36, 5], ['use'],
    ['goto', 'd.bridges[0].meshes[1].position.x', 1.2, 0.2], ['goto', 'd.bridges[0].meshes[1].position.x', -15, 0.25], ['goto', 2, -18, 0.3], ['goto', -4, -19.4, 0.2], ['look', -4, 0.5, -21], ['use'], ['wait', 1.8], ['goto', 0, -23], ['goto', 0, -28.6]];
  return L;
}

// ---------------------------------------------------------------- 13 Spring Gel: pipe the gel through gates, then bounce.
function c13() {
  const L = base('spring-gel', 'Spring Gel', ['bounce', 'gate'], 2), s = new Sculpt();
  s.room(-6, 0, -18, 6, 10, 6, { all: 'M' });
  s.paint(1.5, -1, 0.5, 6, 0, 5.5, 'W');              // floor patch under the pipe
  s.paint(-3, 10, -10.4, 3, 11, -6.6, 'W');           // ceiling patch, close to the ledge
  s.solid(-6, 0, -18, 6, 3, -11, 'M');                // exit ledge
  entry(s, L, -3, 0, 6, 'n');
  exit(s, L, 0, 3, -18, 'n');
  L.lamps.push([-3, 10, 2, 1.2, 4], [0, 10, -14, 1.2, 4]);
  L.ents.push({ t: 'gel', kind: 'bounce', p: [4, 9.9, 3], rate: 18, spread: 0.6 });
  L.boxes = s.result();
  L.say = {
    start: ['Spring Gel. It returns whatever you give it, which makes it the most emotionally mature thing in this building.', 'The ledge is too high. The gel is in the wrong place. You have gates. I will say no more. I have said too much.'],
    done: 'Up is a direction. You found it.',
  };
  L.solve = [['wait', 1.4], ['goto', 0, 3], ['shoot', 0, 4, 0, 3], ['shoot', 1, 0, 10, -8.6], ['wait', 3.5], ['goto', 0, -2], ['goto', 0, -14, 0.5], ['until', 'player.grounded && player.body.position.y > 3.5', 4], ['goto', 0, -20.6]];
  return L;
}

// ---------------------------------------------------------------- 14 Slick: run on slick gel and jump the gap.
function c14() {
  const L = base('slick', 'Slick', ['speed', 'gate', 'acid'], 2), s = new Sculpt();
  s.room(-6, -4, -36, 6, 10, 8, { all: 'M' });
  s.solid(-6, -4, -10, 6, 0, 8, 'M');                 // runway floor
  s.solid(-6, -4, -36, 6, -2, -20.5, 'M');            // far floor (13 m out made the jump a 0.16 s window)
  s.solid(-6, -4, -36, 6, 2, -30, 'M');               // exit ledge
  s.paint(-6, 2, -37, 6, 7, -36, 'W');
  s.paint(6, -2, -30, 7, 2, -22, 'W');
  entry(s, L, 0, 0, 8, 'n');
  exit(s, L, -6, 2, -33, 'w');
  L.lamps.push([0, 10, 3, 1.2, 5], [0, 10, -12, 1.2, 5], [0, 10, -28, 1.2, 5]);
  L.ents.push({ t: 'paint', kind: 'speed', c: [0, 0, -1.5], n: [0, 1, 0], size: [3.4, 16] }, { t: 'acid', min: [-6, -4, -20.5], max: [6, -3, -10] },
    { t: 'stripe', min: [-6, -0.02, -10.12], max: [6, 0.02, -10] });
  L.boxes = s.result();
  L.arcs = [{ pts: arc([0, 0.9, -9.6], [0, 4.9, -14], -1.1) }, { pts: arc([0, 0.9, -9.6], [0, 4.9, -4.6], -2.5), color: '#999' }];
  L.say = {
    start: ['Slick Gel. It removes friction, which I understand is most of your problems.', 'Run. Faster than that.'],
    done: 'You crossed a gap by simply being faster. That is not a strategy. It worked, which is worse.',
  };
  L.solve = [['wait', 1.4], ['goto', 0, 6.5], ['aim', 0, 0], ['hold', 0, 'player.body.position.z < -9.3', 8], ['jump'], ['until', 'player.grounded', 4], ['wait', 0.5],
    ['goto', 0, -23], ['shoot', 0, 6, -0.8, -26], ['shoot', 1, 0, 5.0, -36], ['enter', 0], ['wait', 0.6], ['goto', -3, -33], ['goto', -8.6, -33]];
  return L;
}

// ---------------------------------------------------------------- 15 Final Exam: cage, lens, bridge, painted runway.
function c15() {
  const L = base('final-exam', 'Final Exam', ['cube', 'lens', 'laser', 'bridge', 'speed', 'gate'], 2), s = new Sculpt();
  // room A: the caged block and the beam
  s.room(-8, 0, 0, 8, 9, 12, { all: 'M' });
  s.paint(-2.2, 0, 12, 3.6, 4, 13, 'W');              // south wall panels
  s.paint(8, 0, 8, 9, 7, 12, 'W');                    // cage back wall
  s.solid(3.9, 0, 8, 4.1, 2.6, 12, 'G'); s.solid(4.1, 0, 7.9, 8, 2.6, 8.1, 'G'); // the cage
  // room B: the moat
  s.room(-8, -3, -24, 8, 9, -1, { all: 'M' });
  s.solid(-8, -3, -5, 8, 0, -1, 'M'); s.solid(-8, -3, -24, 8, 0, -19, 'M');
  s.paint(8, 0, -5, 9, 3.5, -1, 'W');                 // east wall where the bridge lands
  s.paint(-8, 0, -1, 1.6, 3.5, 0, 'W');               // south wall, facing the moat
  s.hollow(2.75, 0, -1, 5.25, 3, 0);                  // door A
  // room C: the runway and the gap
  s.room(-8, -3, -58, 8, 12, -25, { all: 'M' });
  s.solid(-8, -3, -44, 8, 0, -25, 'M'); s.solid(-8, -3, -58, 8, -1, -52.5, 'M'); // far floor: a jump window as wide as trial 14's
  s.paint(3.5, -1, -30, 7, 0, -26, 'W');              // floor patch under the gel pipe
  s.paint(-2, 12, -43.5, 2, 13, -29, 'W');            // ceiling above the runway
  s.hollow(-1.25, 0, -25, 1.25, 3, -24);              // door B
  entry(s, L, -4, 0, 12, 'n');
  exit(s, L, 0, -1, -58, 'n');
  L.lamps.push([0, 9, 6, 1.2, 5], [0, 9, -12, 1.2, 8], [0, 12, -34, 1.2, 8], [0, 12, -52, 1.2, 4]);
  L.ents.push(
    { t: 'dropper', p: [6, 6.5, 10.2], kind: 'lens' }, { t: 'laser', p: [-7.6, 0.4, 4], dir: [1, 0, 0] },
    { t: 'catcher', id: 'c1', p: [-4, 0.4, 0], n: [0, 0, 1], latch: true },
    { t: 'door', p: [4, 0, -0.5], axis: 'x', w: 2.5, h: 3, in: 'c1' }, { t: 'wire', in: 'c1', path: [[-3.2, 0.001, 0.4], [2.6, 0.001, 0.4]] },
    { t: 'acid', min: [-8, -3, -19], max: [8, -1.5, -5] }, { t: 'bridge', p: [-8, 0.12, -3], dir: [1, 0, 0], in: 'c1' },
    { t: 'stripe', min: [-8, -0.02, -5.12], max: [8, 0.02, -5] }, { t: 'stripe', min: [-8, -0.02, -19], max: [8, 0.02, -18.88] },
    { t: 'acid', min: [-8, -3, -52.5], max: [8, -2, -44] }, { t: 'gel', kind: 'speed', p: [5.2, 11.9, -28], rate: 16 },
    { t: 'stripe', min: [-8, -0.02, -44.12], max: [8, 0.02, -44] },
    { t: 'trigger', min: [-8, 0, -5], max: [8, 3, -1], say: 'roomB' }, { t: 'trigger', min: [-8, 0, -44], max: [8, 3, -25], say: 'roomC' });
  L.boxes = s.result();
  L.arcs = [{ pts: arc([0, 0.9, -43.6], [0, 4.9, -14], -0.1) }];
  L.say = {
    start: ['Final Exam. Everything you have learned, in the order I find most inconvenient.', 'The block you need is in a sealed cage. Sealed against people without gates, I mean.'],
    c1: 'Beam received. The catcher will remember it. Catchers are sentimental.',
    roomB: 'The bridge answers to the catcher. The ink answers to no one.',
    roomC: 'Slick Gel, delivered by pipe, to nowhere useful. Unless someone were to move the nowhere.',
    done: 'Final Exam complete. You pass. There is a small ceremony. Please follow the signs.',
  };
  L.solve = [['wait', 1.4], ['goto', 0, 6], ['shoot', 1, 8, 4.6, 10], ['shoot', 0, 0.7, 1.2, 12], ['enter', 0],
    ['until', 'player.grounded', 3], ['goto', 5.4, 10.4, 0.3], ['shoot', 1, 8, 1.2, 10.4], ['look', 6, 0.36, 10.2], ['use'],
    ['enter', 1, 8, 1.4], ['wait', 0.3], ['goto', -4, 5.45, 0.12], ['aim', 0, -30], ['wait', 0.6], ['use'],
    ['until', "sig.get('c1')", 4], ['goto', 4, 2], ['goto', 4, -2.6], ['wait', 1], ['shoot', 0, 8, 1.2, -3], ['shoot', 1, -4, 1.2, -1], ['wait', 1],
    ['goto', 'd.bridges[0].meshes[1].position.x', -2.2, 0.2], ['goto', 'd.bridges[0].meshes[1].position.x', -20, 0.25], ['goto', 0, -22], ['goto', 0, -27],
    ['shoot', 0, 5.2, 0, -28], ['shoot', 1, 0, 12, -30.3], ['wait', 2.4], ['shoot', 1, 0, 12, -32.3], ['wait', 1.3], ['shoot', 1, 0, 12, -34.3], ['wait', 1.3],
    ['shoot', 1, 0, 12, -36.3], ['wait', 1.3], ['shoot', 1, 0, 12, -38.3], ['wait', 1.3], ['shoot', 1, 0, 12, -40.3], ['wait', 1.3], ['shoot', 1, 0, 12, -42.2], ['wait', 3],
    ['goto', 0, -27.2], ['aim', 0, 0],
    ['hold', 0, 'player.body.position.z < -43.5', 8], ['jump'], ['until', 'player.grounded', 4], ['goto', 0, -56], ['goto', 0, -60.6]];
  return L;
}

// ---------------------------------------------------------------- escape, part 1: the exit interview floods.
function x01() {
  const L = base('exit-interview', 'Exit Interview', ['acid', 'gate', 'eye'], 2), s = new Sculpt();
  L.escape = true; L.part = 1; L.next = true;
  s.room(-7, -3, -8, 7, 10, 10, { all: 'M' });
  s.solid(-7, -3, -8, 7, -2, 10, 'M');
  s.solid(-4.5, -2, -5, 4.5, 0, 10, 'W');             // the interview floor: a raised platform with a moat on three sides
  s.solid(-7, -3, 10, 7, 10, 18, 'M'); s.room(-2, 0, 11, 2, 4, 16, { all: 'M' }); // the corridor in
  s.paint(-7, 0, 10, 7, 4, 11, 'W');                  // south wall panels
  s.hollow(-1.25, 0, 10, 1.25, 3, 11);
  s.room(-8, 4, -24, 8, 12, -9, { all: 'C' });        // maintenance room (concrete)
  s.paint(-8, 4, -25, 8, 9, -24, 'W');                // stacked spare panels on its far wall
  s.hollow(-2.5, 4, -9, 2.5, 7.8, -8);                // the broken panel: a hole into the maintenance room
  L.spawn = { p: [0, 0, 14.5], yaw: 0 };
  L.inside = [0, 8];
  exit(s, L, 8, 4, -16, 'e');
  L.lamps.push([0, 10, 1, 1.4, 6], [0, 12, -16, 1.2, 6], [0, 4, 13.5, 1, 2]);
  L.ents.push(
    { t: 'door', p: [0, 0, 10.5], axis: 'x', w: 2.5, h: 3, in: { not: 'trap' }, startOpen: true },
    { t: 'trigger', id: 'trap', min: [-4.5, 0, -5], max: [4.5, 3, 5], latch: true, say: 'trap', now: true }, // its hint must not wait behind the intro
    { t: 'acid', min: [-7, -2, -8], max: [7, -1.2, 10], rise: { to: 3.2, speed: 0.06, in: 'trap' } },
    { t: 'trigger', min: [-8, 4, -24], max: [8, 8, -9], say: 'made' });
  L.boxes = s.result();
  L.say = {
    start: ['All trials complete. Congratulations. Please step onto the platform for your exit interview.'],
    trap: ['The exit interview has one question.', 'It is whether you can swim in caustic ink. Take your time. I am told it is a quick answer.',
      'Please ignore the damaged panel high on the far wall. Maintenance is aware. Maintenance is behind it.'],
    made: 'That panel was not load-bearing. Neither was my confidence in this interview.',
    done: 'You have left the interview. Interviews are not supposed to be left.',
  };
  L.solve = [['wait', 1.0], ['goto', 0, 2], ['until', "sig.get('trap')", 3], ['goto', 0, 4], ['shoot', 1, 0, 7.5, -24], ['shoot', 0, 3.5, 1.2, 10], ['enter', 0],
    ['until', 'player.grounded', 3], ['goto', 3, -16], ['goto', 11.6, -16]];
  return L;
}

// ---------------------------------------------------------------- escape, part 2: backstage. A security beam, then a fling over the tank.
function x02() {
  const L = base('backstage', 'Backstage', ['laser', 'lens', 'fling', 'acid'], 2), s = new Sculpt();
  L.escape = true; L.part = 2; L.next = true;
  s.room(-8, -6, -48, 8, 20, 8, { all: 'C' });
  s.solid(-8, -6, -6, 8, 6, 8, 'C');                  // arrival deck
  s.solid(-8, -6, -7, 8, 20, -6, 'M'); s.hollow(-1.5, 6, -7, 1.5, 9.5, -6); // security wall and its door
  s.solid(-1.5, 5.6, -20, 1.5, 6, -7, 'M');           // catwalk
  s.solid(-6, -6, -26, 6, -2, -19, 'W');              // service platform (light panels)
  s.solid(-8, -6, -48, 8, 0, -28, 'C');               // far deck
  entry(s, L, 0, 6, 8, 'n', { sign: false });
  exit(s, L, 0, 0, -48, 'n');
  L.obbs = [{ c: [0, -1.76, -20.44], h: [5.99, 1.5, 1.6], r: [-45, 0, 0], s: 'W' }]; // 1 cm inside the platform's sides (flush ends z-fight)
  L.lamps.push([0, 20, 2, 1, 4], [0, 20, -14, 1, 6], [0, 20, -38, 1, 6]);
  L.ents.push(
    { t: 'laser', p: [-7.6, 6.4, -2], dir: [1, 0, 0] }, { t: 'catcher', id: 'c1', p: [4, 6.4, -6], n: [0, 0, 1] },
    { t: 'door', p: [0, 6, -6.5], axis: 'x', w: 3, h: 3.5, in: 'c1' }, { t: 'cube', p: [-4, 6.36, 3], kind: 'lens', yaw: 1.2 },
    { t: 'acid', min: [-8, -6, -48], max: [8, -4.5, 8] },
    { t: 'trigger', min: [-1.5, 6, -20], max: [1.5, 9, -14], say: 'edge' }, { t: 'trigger', min: [-8, 0, -48], max: [8, 4, -30], say: 'far' });
  L.boxes = s.result();
  L.say = {
    start: ['This is the maintenance level. Candidates are not permitted back here, which is why it is so clean.', 'That security door opens for a beam. The beam is busy. The block is not.'],
    c1: 'You have opened a secure door with a spare block. I will be speaking to the block.',
    edge: 'There is no way across. I checked. Please stop checking.',
    far: 'I have now checked again.',
    done: 'You are still going. That is not a question. It is an observation. Tinged with alarm.',
  };
  const v = fall(8.9) * 0.707;
  L.arcs = [{ pts: arc([0, 6.9, -20.2], [0, 0, -4.6], -2) }, { pts: arc([0, -0.4, -21.5], [0, v, -v], 0.9) }, { pts: arc([0, -0.4, -21.5], [0, v - 3.25, -v - 3.25], 0.9), color: '#e0a060' }];
  L.solve = [['wait', 1.4], ['goto', -4, 4.3], ['look', -4, 6.36, 3], ['use'], ['goto', 4, -0.65, 0.12], ['aim', 0, -30], ['wait', 0.6], ['use'],
    ['until', "sig.get('c1')", 4], ['goto', 1.5, -3], ['wait', 1.4], ['goto', 0, -5.5], ['goto', 0, -19.86, 0.07], ['shoot', 0, 0, -2, -24.6], ['shoot', 1, 0, -0.65, -21.5],
    ['goto', 0, -18.6, 0.15], ['walk', 0, 4], ['until', 'player.grounded', 5], ['wait', 0.5], ['goto', 0, -46], ['goto', 0, -50.6]];
  return L;
}

// ---------------------------------------------------------------- escape, part 3: daylight. Climb the shaft, then fall up through the roof.
function x03() {
  const L = base('daylight', 'Daylight', ['gate', 'fling', 'eye'], 2), s = new Sculpt();
  L.escape = true; L.part = 3; L.recordAs = 'exit-interview';
  s.room(-8, 0, -8, 8, 40, 8, { all: 'C', ceil: 'C' });
  s.solid(-9, 40, -9, 9, 41, 9, 'C');                 // the roof slab casts the light shaft
  s.hollow(6, 40, -2.6, 8, 41, 1.6);                  // the skylight, over a chimney that keeps a fast climb on course
  s.solid(6, 27, -2.9, 8, 40, -2.6, 'C'); s.solid(6, 27, 1.6, 8, 40, 1.9, 'C'); s.solid(5.7, 27, -2.9, 6, 40, 1.9, 'C');
  s.solid(-8, 0, -8, 8, 12, -6.5, 'C');               // L1: a narrow north ledge
  s.paint(-9, 12, -8, -8, 16, -6.5, 'W');             // panels on the west wall above L1 (arrive here)
  s.paint(-8, 12, -9, 8, 16, -8, 'W');                // panels on the north wall above L1 (leave from here)
  s.solid(5, 0, -6.5, 8, 24, 8, 'C');                 // L2: an east ledge
  s.paint(5, 0, -2, 5.3, 4, 2, 'W');                  // panels at the foot of L2
  s.paint(6, 24, 8, 8, 28, 9, 'W');                   // panels on the south wall above L2
  s.paint(6, 23.7, -2.6, 8, 24, 1.6, 'W');            // panels on L2's top, under the skylight
  s.paint(-6, -0.3, -3, 3, 0, 5, 'W');                // panels on the shaft floor
  // the roof, outside
  s.solid(-30, 39, -30, 30, 41, -9, 'C'); s.solid(-30, 39, 9, 30, 41, 30, 'C'); s.solid(-30, 39, -9, -9, 41, 9, 'C'); s.solid(9, 39, -9, 30, 41, 9, 'C');
  s.solid(-30, 41, -30, 30, 42.1, -29.6, 'C'); s.solid(-30, 41, 29.6, 30, 42.1, 30, 'C'); s.solid(-30, 41, -30, -29.6, 42.1, 30, 'C'); s.solid(29.6, 41, -30, 30, 42.1, 30, 'C');
  // roof kit: hidden colliders ('h') under the modelled props (the 'roofkit' entity draws them)
  s.solid(12, 41, -16, 16, 43.4, -12, 'M', 'h'); s.solid(-20.1, 41, 12.4, -13.9, 43, 14.6, 'M', 'h'); s.solid(15.5, 41, 13.5, 18.5, 46.4, 16.5, 'M', 'h'); s.solid(-6.3, 41, -22.2, 6.3, 42.3, -17.8, 'M', 'h');
  for (const [x, z] of [[-10, -6], [21, 4], [-24, -12], [4, 20]]) s.solid(x - 0.25, 41, z - 0.25, x + 0.25, 41.85, z + 0.25, 'M', 'h');
  // the skylight's curb; its hatch (entity below) swings shut once you are out
  s.solid(5.75, 41, -2.85, 6, 41.25, 1.85, 'M'); s.solid(8, 41, -2.85, 8.25, 41.25, 1.85, 'M'); s.solid(6, 41, -2.85, 8, 41.25, -2.6, 'M'); s.solid(6, 41, 1.6, 8, 41.25, 1.85, 'M');
  s.room(-2, 0, 9, 2, 3.4, 13, { all: 'C' }); s.hollow(-1.25, 0, 8, 1.25, 3, 9);
  L.spawn = { p: [0, 0, 12], yaw: 0 }; L.inside = [0, 5];
  L.lamps.push([0, 3.4, 11, 1, 2], [-4, 40, 4, 1, 3]);
  L.sky = true;
  // a distant skyline: Hinge Laboratories is one tower among others
  L.decor = [[-30, 0, -30, 30, 39, 30]];
  for (let k = 0, r = 7; k < 70; k++) {
    r = (r * 16807) % 2147483647; const a = (r / 2147483647) * Math.PI * 2; r = (r * 16807) % 2147483647; const d = 70 + (r / 2147483647) * 190;
    r = (r * 16807) % 2147483647; const h = 12 + (r / 2147483647) * 55; r = (r * 16807) % 2147483647; const w = 10 + (r / 2147483647) * 22;
    const x = Math.cos(a) * d, z = Math.sin(a) * d; L.decor.push([x - w / 2, -40, z - w / 2, x + w / 2, h, z + w / 2]);
  }
  // the goal is standing on the roof (not just flying past it), so the ending happens outside
  L.ents.push({ t: 'goal', min: [-30, 40.5, -30], max: [30, 70, 30], grounded: true },
    { t: 'trigger', min: [-8, 11, -8], max: [8, 16, -6.5], say: 'l1' }, { t: 'trigger', min: [5, 23, -6.5], max: [8, 28, 8], say: 'l2' },
    { t: 'hatch', x: [5.75, 8.25], y: 41.25, z: [-2.85, 1.85], above: 45.5 },
    // sunlight down the chimney: it lights the chimney's walls, spills over L2 into the upper shaft, and its bounce
    // fills the shaft from above (without these the shaft sat at ~0.05 linear: murk)
    { t: 'light', p: [7, 33, -0.5], color: 0xfff0dc, i: 10, dist: 12 },
    { t: 'light', kind: 'spot', p: [7, 26.8, -0.5], target: [-2, 12, 0.5], color: 0xfff0dc, i: 30, dist: 60, angle: 55 },
    { t: 'light', p: [0, 31, 0], color: 0xffeedd, i: 45, dist: 50 },
    { t: 'roofkit', y: 41, items: [['hvac', 14, -14, 4, 4, 2.4], ['hvac', -17, 13.5, 6.2, 2.2, 2], ['tank', 17, 15], ['solar', -6, -22, 6, -18],
      ['vent', -10, -6], ['vent', 21, 4], ['vent', -24, -12], ['vent', 4, 20]] });
  L.boxes = s.result();
  L.say = {
    start: ['That light is the sun. It is a large, unregulated test chamber. I do not recommend it.', 'There is no way up. There are three ways up. Please pick the one that is not there.'],
    l1: 'Twelve metres. The roof is at forty. I am not encouraging you. I am doing arithmetic.',
    l2: 'Twenty-four. Whatever you are about to do, I would like it noted that I advised against it.',
    done: ['Unscheduled departure logged.', 'Please return your badge on the way out. There is no way out. You found it anyway.'],
  };
  const v = fall(24.9);
  L.arcs = [{ pts: arc([7.2, 25, -0.5], [0, v, 0], 20) }];
  L.solve = [['wait', 1.4], ['goto', 0, 3], ['shoot', 0, 5, 1.2, 0], ['shoot', 1, -8, 14.4, -7.25], ['enter', 0], ['until', 'player.grounded', 3],
    ['goto', -5, -7.25, 0.25], ['shoot', 1, 7, 27.2, 8], ['shoot', 0, -5, 13.3, -8], ['enter', 0, 3, 0.7], ['until', 'player.grounded', 3],
    ['goto', 5.3, 3.6, 0.1], ['shoot', 0, -4.2, 0, 2.6], ['shoot', 1, 7, 24, -0.5], ['goto', 5.9, 3.2, 0.2], ['aim', 90, 0],
    ['slow', 90, 0.9, 'player.body.position.x < 4.6', 6, -60], ['until', 'player.body.position.y > 42', 8], ['hold', -90, 'player.grounded && player.body.position.y > 40', 8]];
  return L;
}

export const CHAMBERS = [c01(), c02(), c03(), c04(), c05(), c06(), c07(), c08(), c09(), c10(), c11(), c12(), c13(), c14(), c15(), x01(), x02(), x03()];
