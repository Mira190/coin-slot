// Cargo Deck map: pure data (no three.js) so node scripts can draw the top-down draft from it.
// Frame: x runs along the ship (stern -x .. bow +x), y up, z across (port -z .. starboard +z).
// Team 0 (Sentinels, blue) spawns in the stern cabin facing +x; team 1 (Corsairs, red) in the bow cabin facing -x.
// The layout is point-symmetric (180 degrees about the origin), except the V at midships which is mirror-symmetric.
// Everything is a yaw-rotated box: { x, y, z } is the box centre, sx/sy/sz full sizes, ry yaw.
//   solid: blocks movement   shot: blocks bullets   pc: penetration cost (Infinity = never)
//   mat: surface for footsteps/impacts   vis: how world.js draws it ('none' when drawn by a richer builder)

export const DECK_Y = 0, PIPE_Y = -1.2, WALK_Y = 1.8, F2_Y = 3.4, ROOF_Y = 6.8;
export const HALF_W = 14; // deck half width (z)
export const CAB_FRONT = 36; // cabin front walls at x = -36 / +36
export const CAB_BACK = 47.3;
export const PIPE_END = 18; // each pipe runs from its cabin to x = +/-18 in the enemy half
export const C20 = 6.06, C40 = 12.19, CW = 2.44, CH = 2.59;
export const TEAM_NAMES = ['Sentinels', 'Corsairs'];

export const boxes = [];
export const containers = []; // { x, y, z, ry, len, color, open: 0 | 1 (one end) | 2 (both ends), team }
export const stairs = []; // { x, z, ry, w, y0, y1, n, run } for drawing
export const rails = []; // { x0, z0, x1, z1, y, h } thin rails (visual + solid, bullets pass)
export const lamps = []; // { x, y, z, kind }
export const decor = []; // { kind, x, y, z, ry, ... } drawn by world.js, may add solids itself
export const doors = []; // { x, z, ry, w, h, y, team } door frames (visual)
export const windows = []; // { x, y, z, ry, w, h } window frames (visual)

const PI = Math.PI;
// point-symmetric copy: the red half is the blue half turned 180 degrees about the ship's centre
const flip = (o) => ({ ...o, x: -o.x, z: -o.z, ry: (o.ry || 0) + PI });

function box(o, both = false) {
  const b = { y: 0, ry: 0, solid: true, shot: true, pc: Infinity, mat: 'steel', vis: 'steel', ...o };
  boxes.push(b);
  if (both) boxes.push(flip(b));
  return b;
}
// axis-aligned box from min/max corners
function aabb(x0, y0, z0, x1, y1, z1, o = {}, both = false) {
  return box({ x: (x0 + x1) / 2, y: (y0 + y1) / 2, z: (z0 + z1) / 2, sx: x1 - x0, sy: y1 - y0, sz: z1 - z0, ...o }, both);
}

// ------------------------------------------------------------------------------------------------ containers
// A container adds its own collision: solid box, or open shell (floor, roof, sides, back) when open.
function container(o, both = true) {
  const c = { y: 0, ry: 0, len: 20, color: 'red', open: 0, ...o };
  const L = c.len === 40 ? C40 : C20;
  const add = (cc) => {
    containers.push(cc);
    const cs = Math.cos(cc.ry), sn = Math.sin(cc.ry);
    // local (u along length, v across) -> world
    const at = (u, v) => ({ x: cc.x + u * cs + v * sn, z: cc.z - u * sn + v * cs });
    if (!cc.open) {
      boxes.push({ x: cc.x, y: cc.y + CH / 2, z: cc.z, sx: L, sy: CH, sz: CW, ry: cc.ry, solid: true, shot: true, pc: Infinity, mat: 'container', vis: 'none', cont: cc });
    } else {
      const t = 0.12;
      const part = (u, v, y, sx, sy, sz) => { const p = at(u, v); boxes.push({ x: p.x, y, z: p.z, sx, sy, sz, ry: cc.ry, solid: true, shot: true, pc: Infinity, mat: 'container', vis: 'none', cont: cc }); };
      part(0, 0, cc.y + t / 2, L, t, CW); // floor
      part(0, 0, cc.y + CH - t / 2, L, t, CW); // roof
      part(0, CW / 2 - t / 2, cc.y + CH / 2, L, CH, t); // side
      part(0, -CW / 2 + t / 2, cc.y + CH / 2, L, CH, t);
      if (cc.open === 1) part(-L / 2 + t / 2, 0, cc.y + CH / 2, t, CH, CW); // back wall at -u end
    }
  };
  add(c);
  if (both) add({ ...flip(c), team: c.team === undefined ? undefined : 1 - c.team });
  return c;
}

// crate: penetrable wooden box
function crate(x, z, s = 1.2, y = 0, ry = 0, both = true, h = s) {
  box({ x, y: y + h / 2, z, sx: s, sy: h, sz: s, ry, pc: 1.0, mat: 'wood', vis: 'crate' }, both);
}

// straight stair: bottom step at (x,z), climbs along direction ry (0 = +x) from y0 to y1
function stair(x, z, ry, w, y0, y1, run = 0.28, both = true, o = {}) {
  const n = Math.max(1, Math.round(Math.abs(y1 - y0) / 0.2));
  const rise = (y1 - y0) / n, cs = Math.cos(ry), sn = Math.sin(ry);
  const make = (sx, sz, sry) => {
    stairs.push({ x: sx, z: sz, ry: sry, w, y0, y1, n, run, ...o });
    const c2 = Math.cos(sry), s2 = Math.sin(sry);
    for (let i = 0; i < n; i++) {
      const top = y0 + rise * (i + 1);
      const u = run * (i + 0.5);
      // each step is a block from the lower floor up to its tread (so the stair is solid underneath)
      const lo = Math.min(y0, y1) - 0.05;
      boxes.push({ x: sx + u * c2, y: (top + lo) / 2, z: sz - u * s2, sx: run + 0.01, sy: top - lo, sz: w, ry: sry, solid: true, shot: true, pc: 2.5, mat: 'grate', vis: 'none', step: true });
    }
  };
  make(x, z, ry);
  if (both) { const f = flip({ x, z, ry }); make(f.x, f.z, f.ry); }
}

function rail(x0, z0, x1, z1, y, h = 1.05, both = true) {
  const r = { x0, z0, x1, z1, y, h };
  rails.push(r);
  const len = Math.hypot(x1 - x0, z1 - z0), ry = -Math.atan2(z1 - z0, x1 - x0);
  // rails block movement but not bullets
  const b = { x: (x0 + x1) / 2, y: y + h / 2, z: (z0 + z1) / 2, sx: len, sy: h, sz: 0.08, ry, solid: true, shot: false, pc: 0, mat: 'rail', vis: 'none' };
  boxes.push(b);
  if (both) { rails.push({ x0: -x0, z0: -z0, x1: -x1, z1: -z1, y, h }); boxes.push(flip(b)); }
}

// ------------------------------------------------------------------------------------------------ hull & deck
// Main deck slab (the pipe trenches along each edge are cut out of it).
aabb(-CAB_FRONT, -0.6, -11.2, CAB_FRONT, DECK_Y, 11.2, { mat: 'deck', vis: 'deck' });
// deck strips beside the trenches where there is no pipe (the enemy end of each edge)
aabb(PIPE_END + 3.6, -0.6, 11.2, CAB_FRONT, DECK_Y, HALF_W, { mat: 'deck', vis: 'deck' }, true);
// pipe trench floors (blue pipe along +z, red along -z)
aabb(-CAB_BACK + 4.7, PIPE_Y - 0.4, 11.4, PIPE_END, PIPE_Y, HALF_W, { mat: 'steel', vis: 'pipefloor' }, true);
// pipe exit ramp (steps up to deck level) + a landing
stair(PIPE_END, 12.7, 0, 2.6, PIPE_Y, DECK_Y, 0.6, true, { kind: 'pipe' });
// the stair's deck-side handrail (drawn by world.js) blocks movement too, one segment per step so it follows the
// slope: without it you walked through the drawn rail, and bots cutting the corner stepped off the side of the stair
// into the gap under the deck edge and stuck there
for (let i = 0; i < 6; i++) box({ x: PIPE_END + 0.3 + i * 0.6, y: PIPE_Y + 0.2 * (i + 1) + 0.5, z: 11.45, sx: 0.6, sy: 1.0, sz: 0.06, shot: false, pc: 0, mat: 'rail', vis: 'none' }, true);
// pipe inner wall (divides trench from deck, rises to carry the walkway)
aabb(-CAB_FRONT, PIPE_Y - 0.4, 11.2, PIPE_END, WALK_Y - 0.2, 11.4, { mat: 'steel', vis: 'pipewall' }, true);
// walkway on top of the pipe (the "second floor" along each flank)
aabb(-CAB_FRONT, WALK_Y - 0.2, 11.2, PIPE_END, WALK_Y, HALF_W, { mat: 'grate', vis: 'walkway' }, true);
// hull side (bulwark) between the cabins; inside each cabin the same plating is the cabin's lower side wall
aabb(-CAB_FRONT, -9, HALF_W, CAB_FRONT, 1.1, HALF_W + 0.35, { mat: 'steel', vis: 'hull' }, true);
// hull plating closes the gap between the bulwark top and the walkway along each pipe
aabb(-CAB_FRONT, 1.1, HALF_W, PIPE_END, WALK_Y - 0.2, HALF_W + 0.35, { mat: 'steel', vis: 'none' }, true);
// bulwark top rail above the walkway so nobody drops into the sea
rail(-CAB_FRONT, HALF_W - 0.1, PIPE_END, HALF_W - 0.1, WALK_Y, 1.0);
// walkway inboard rail with a gap at the far end for the stair down to the deck
rail(-CAB_FRONT + 2.3, 11.25, PIPE_END - 1.2, 11.25, WALK_Y, 1.0); // open at the far end: climb up from the crate
rail(PIPE_END, 11.25, PIPE_END, HALF_W - 0.1, WALK_Y, 1.0); // walkway end
// crate under the walkway's far end so the other team can climb onto it
crate(PIPE_END - 0.4, 10.45, 1.2, 0, 0);

// ------------------------------------------------------------------------------------------------ cabins
// Built in the blue (stern) frame and flipped for the bow. Two floors + roof; stairs up to the bridge room,
// stairs down into the flank pipe, three bridge windows and a door out to the walkway stair.
function cabin() {
  const X0 = -CAB_BACK, X1 = -CAB_FRONT, T = 0.3; // outer extent, wall thickness
  const W = { mat: 'steel', vis: 'cabinwall' }, IW = { mat: 'steel', vis: 'inwall', pc: 1.6 };
  const wallZ = (z0, z1, y0, y1, o = W) => aabb(X1 - T, y0, z0, X1, y1, z1, o, true); // front wall piece
  // ground floor slab (spawn hall + stair room), leaving the pipe stair hole
  aabb(X0, -0.6, -HALF_W, X1, 0, 11.6, { mat: 'lino', vis: 'floor' }, true);
  aabb(X0, -0.6, 11.6, -42.6, 0, HALF_W, { mat: 'lino', vis: 'floor' }, true);
  // shell: no two pieces share volume, so no two faces lie on top of each other (z-fighting). Hull plating up
  // to the bulwark top (1.1), side walls above it, back wall between the side walls, all under the roof slab.
  const RY = ROOF_Y - 0.25;
  aabb(X0, -9, HALF_W, X1, 1.1, HALF_W + 0.35, { mat: 'steel', vis: 'cabinhull' }, true);
  aabb(X0, -9, -HALF_W - 0.35, X1, 1.1, -HALF_W, { mat: 'steel', vis: 'cabinhull' }, true);
  aabb(X0, 0, -HALF_W, X0 + T, RY, HALF_W, W, true);
  aabb(X0, 1.1, -HALF_W - 0.35, X1, RY, -HALF_W, W, true);
  aabb(X0, 1.1, HALF_W, X1, RY, HALF_W + 0.35, W, true);
  // front wall, ground floor: door L (-8.6..-6.8), door M (0.4..2.2), pipe opening (11.4..14 below y 1.4)
  wallZ(-HALF_W, -8.6, 0, F2_Y);
  wallZ(-6.8, 0.4, 0, F2_Y);
  wallZ(2.2, 11.4, 0, F2_Y);
  wallZ(-8.6, -6.8, 2.3, F2_Y);
  wallZ(0.4, 2.2, 2.3, F2_Y);
  wallZ(11.4, HALF_W, WALK_Y - 0.2, F2_Y);
  doors.push({ x: X1 - T / 2, z: -7.7, ry: 0, w: 1.8, h: 2.3, y: 0 }, { x: X1 - T / 2, z: 1.3, ry: 0, w: 1.8, h: 2.3, y: 0 });
  doors.push(flip({ x: X1 - T / 2, z: -7.7, ry: 0, w: 1.8, h: 2.3, y: 0 }), flip({ x: X1 - T / 2, z: 1.3, ry: 0, w: 1.8, h: 2.3, y: 0 }));
  // front wall, bridge floor: windows at z -9.5..-5.5, -3.5..0.5, 2.5..6.5 (sill 4.4, head 5.6); door 11.6..13.6
  const WS = F2_Y + 1.0, WH = F2_Y + 2.2;
  wallZ(-HALF_W, 11.6, F2_Y, WS);
  wallZ(-HALF_W, -9.5, WS, WH); wallZ(-5.5, -3.5, WS, WH); wallZ(0.5, 2.5, WS, WH); wallZ(6.5, 11.6, WS, WH);
  wallZ(-HALF_W, 11.6, WH, RY);
  wallZ(11.6, 13.6, F2_Y + 2.2, RY);
  wallZ(13.6, HALF_W, F2_Y, RY);
  for (const z of [-7.5, -1.5, 4.5]) { const w = { x: X1 - T / 2, y: (WS + WH) / 2, z, ry: 0, w: 4, h: WH - WS }; windows.push(w, flip(w)); }
  doors.push({ x: X1 - T / 2, z: 12.6, ry: 0, w: 2.0, h: 2.2, y: F2_Y }, flip({ x: X1 - T / 2, z: 12.6, ry: 0, w: 2.0, h: 2.2, y: F2_Y }));
  // partition between spawn hall and stair room (z 8.6..8.9) with doorway x -46..-43.8
  aabb(-46.0 + 2.2, 0, 8.6, X1 - T, F2_Y - 0.2, 8.9, IW, true);
  aabb(X0 + T, 2.3, 8.6, -43.8, F2_Y - 0.2, 8.9, IW, true);
  aabb(X0 + T, 0, 8.6, -46.0, 2.3, 8.9, IW, true);
  // pipe stairwell: steps down along +x from x -42.6 (y 0) to -40.8 (y -1.2), then flat to the front wall
  stair(-42.6 + 1.8, 12.8, PI, 2.4, PIPE_Y, DECK_Y, 0.3);
  aabb(-42.6, PIPE_Y, 11.4, X1, -0.6, 11.6, { mat: 'steel', vis: 'inwall' }, true); // trench lip (pipe floor to floor slab)
  rail(-42.6, 11.5, X1 - T, 11.5, 0, 1.0);
  // bridge floor with the stair hole (hole x -46.9..-44.7, z -6.8..-2.0)
  const FL = { mat: 'lino', vis: 'floor' };
  aabb(X0 + T, F2_Y - 0.2, -HALF_W, X1 - T, F2_Y, -6.8, FL, true);
  aabb(X0 + T, F2_Y - 0.2, -2.0, X1 - T, F2_Y, HALF_W, FL, true);
  aabb(-44.7, F2_Y - 0.2, -6.8, X1 - T, F2_Y, -2.0, FL, true);
  // stairs up: bottom at z -2.0 (y 0) climbing toward -z to z -6.76 (y 3.4)
  stair(-45.8, -2.0, PI / 2, 2.1, DECK_Y, F2_Y, 0.28);
  rail(-44.65, -6.8, -44.65, -2.0, F2_Y, 1.0);
  rail(-46.9, -2.0, -44.65, -2.0, F2_Y, 1.0);
  // roof slab
  aabb(X0, ROOF_Y - 0.25, -HALF_W - 0.35, X1, ROOF_Y, HALF_W + 0.35, { mat: 'steel', vis: 'roof' }, true);
  // exterior stair from the bridge door down to the walkway (x -36 y 3.4 -> x -33.76 y 1.8)
  stair(X1 + 2.24, 12.7, PI, 2.2, WALK_Y, F2_Y, 0.28);
  rail(X1, 11.5, X1 + 2.3, 11.5, WALK_Y, 1.0);
  // lamps inside
  for (const p of [[-41.5, 2.9, -8], [-41.5, 2.9, 0], [-41.5, 2.9, 6], [-40, 2.9, 11], [-41.5, 6.3, -6], [-41.5, 6.3, 4]]) {
    lamps.push({ x: p[0], y: p[1], z: p[2], kind: 'ceiling' }, { x: -p[0], y: p[1], z: -p[2], kind: 'ceiling' });
  }
  // furniture (solid boxes the renderer dresses up)
  const F = (x0, y0, z0, x1, y1, z1, kind, o = {}) => aabb(x0, y0, z0, x1, y1, z1, { mat: 'steel', vis: 'furn', kind, pc: 1.2, ...o }, true);
  F(-47.0, 0, -13.6, -46.4, 2.0, -8.0, 'lockers'); // back wall lockers
  F(-47.0, 0, 3.0, -46.4, 2.0, 8.2, 'lockers');
  F(-42.5, 0, -12.8, -40.0, 0.78, -11.2, 'table');
  F(-39.5, 0, 5.2, -37.5, 1.1, 6.0, 'rack');
  F(-43.0, 0, 9.3, -38.0, 1.2, 10.6, 'pumps', { mat: 'steel' });
  F(-39.6, F2_Y, -13.6, -37.0, F2_Y + 1.0, -11.0, 'console');
  F(-39.6, F2_Y, 6.8, -37.0, F2_Y + 1.0, 9.6, 'console');
  F(-43.4, F2_Y, -1.0, -41.2, F2_Y + 0.95, 1.6, 'chart');
}
cabin();

// ------------------------------------------------------------------------------------------------ deck cargo
// blue half; container() and crate() add the point-symmetric bow copy automatically.
const PAL = ['red', 'blue', 'green', 'orange', 'grey', 'teal', 'maroon', 'yellow'];
// 1-line: first container ahead of the main door (turned across the deck) screens the spawn
container({ x: -29.0, z: 2.2, ry: PI / 2, len: 20, color: 'blue' });
// crates right of spawn (penetrable, the grenade magnet)
crate(-32.0, 7.8); crate(-32.0, 9.1); crate(-30.7, 8.4, 1.0); crate(-32.0, 7.8, 1.1, 1.2, 0.3);
// green container left of spawn, crate at its bow end to crouch-jump onto it
container({ x: -30.0, z: -10.9, ry: 0, len: 20, color: 'green' });
crate(-26.3, -10.9, 1.2);
// 2-line: the big second container straight ahead of the spawn, crate at its stern end to get up
container({ x: -18.4, z: 3.6, ry: 0, len: 40, color: 'red' });
crate(-25.15, 3.2, 1.2);
// high box: 40ft with an open 20ft on its stern half; the upper box looks forward over three lanes
container({ x: -17.3, z: 9.95, ry: 0, len: 40, color: 'grey' });
container({ x: -20.35, y: CH, z: 9.95, ry: 0, len: 20, color: 'orange', open: 1 });
crate(-10.6, 9.6, 1.2);
// penetrable crates in the 2-line centre
crate(-21.2, -1.3, 1.2); crate(-19.9, -2.5, 1.0); crate(-21.2, -1.3, 1.0, 1.2, 0.4);
// slanted container lining the mid lane on the port side (parallel to the lane)
export const LANE = Math.atan2(7.7, 36); // mid lane runs from the stern left door to the bow left door
container({ x: -21.5, z: -7.6, ry: -LANE, len: 20, color: 'teal' });
// L stack on the port side of mid (two-high on its long leg), pocket facing the stern
container({ x: -13.87, z: -8.2, ry: 0, len: 20, color: 'yellow' });
container({ x: -13.87, y: CH, z: -8.2, ry: 0, len: 20, color: 'maroon' });
container({ x: -9.62, z: -6.39, ry: PI / 2, len: 20, color: 'blue' });
crate(-12.5, -5.2, 1.2); crate(-12.5, -5.2, 1.2, 1.2, 0.2); // cover inside the L
// sight-blocking crates in the alleys beside mid
crate(3.2, -10.0, 1.2); crate(3.2, -10.0, 1.2, 1.2, 0.3);
crate(-8.0, 6.4, 1.2); crate(-8.0, 6.4, 1.1, 1.2, 0.5); crate(-9.3, 6.6, 1.0);
// crates at each pipe exit (cover; the enemy green box beyond overlooks the ship)
crate(PIPE_END + 5.0, 13.2, 1.2); crate(PIPE_END + 5.0, 13.2, 1.0, 1.2, 0.3);
// oil drums near the doors (penetrable)
for (const [x, z] of [[-34.6, -3.2], [-34.0, -2.5], [-34.7, -1.9]]) box({ x, y: 0.45, z, sx: 0.6, sy: 0.9, sz: 0.6, pc: 0.6, mat: 'drum', vis: 'drum' }, true);

// ------------------------------------------------------------------------------------------------ the V (midships)
// Two 20ft boxes leaning away from each other form a V whose point sits just off the mid sightline; the V is
// doubled point-to-point (an hourglass) so the middle is point-symmetric like the rest of the deck: each team
// meets a V mouth on its left and the door-to-door sightline threads the waist between the two points.
{
  const a = 50 * PI / 180, apexZ = 2.7, gap = 1.3;
  const dx = Math.cos(a), dz = Math.sin(a), half = C20 / 2;
  const cL = { x: -gap - dx * half, z: apexZ + dz * half }, cR = { x: gap + dx * half, z: apexZ + dz * half };
  container({ x: cL.x, z: cL.z, ry: a, len: 20, color: 'orange' });
  container({ x: cR.x, z: cR.z, ry: -a, len: 20, color: 'green' });
  crate(0, 7.6, 1.2, 0, 0.3); // crate deep in each V mouth
}

// ------------------------------------------------------------------------------------------------ gameplay points
// Spawn points (team 0 stern cabin ground floor; team 1 is the flipped copy).
const spawn0 = [];
// face the nearer cabin door (not the blank front wall) so the first thing you see is the way out
const CAB_DOORS = [-7.7, 1.3], CAB_DOOR_X = -37.4;
for (const z of [-12.2, -9.8, -5, -1, 3, 6.5]) for (const x of [-43.4, -40.8, -38.2]) {
  const dz = CAB_DOORS.reduce((a, b) => (Math.abs(b - z) < Math.abs(a - z) ? b : a)) - z;
  spawn0.push({ x, z, yaw: Math.atan2(-(CAB_DOOR_X - x), -dz) });
}
// the map is point-symmetric: the bow team's spawns are mirrored through the origin and turned half a circle
export const spawns = [spawn0, spawn0.map((p) => ({ x: -p.x, z: -p.z, yaw: p.yaw + PI }))];

// Callout zones: rectangles in the blue frame [name, x0, z0, x1, z1, y0?, y1?]; the bow copy gets 'Bow' names.
const Z = [];
const zone = (name, x0, z0, x1, z1, y0 = -5, y1 = 20) => Z.push({ name, x0, z0, x1, z1, y0, y1 });
const zone2 = (nameS, nameB, x0, z0, x1, z1, y0, y1) => { zone(nameS, x0, z0, x1, z1, y0, y1); zone(nameB, -x1, -z1, -x0, -z0, y0, y1); };
zone2('Stern Bridge', 'Bow Bridge', -47.3, -14, -36, 14, 3.0, 20);
zone2('Stern Pipe', 'Bow Pipe', -42.6, 11.3, PIPE_END + 3.6, 14, -5, 0.4);
zone2('Stern Walkway', 'Bow Walkway', -36, 11.2, PIPE_END, 14, 1.2, 3.0);
zone2('Stern Cabin', 'Bow Cabin', -47.3, -14, -36, 14, -5, 3.0);
zone2('Stern Door', 'Bow Door', -36, -2.5, -27.5, 6.5);
zone2('Stern Crates', 'Bow Crates', -36, 6.5, -25.5, 11.2);
zone2('Stern Green', 'Bow Green', -36, -14, -25, -6.0);
zone2('Stern Second', 'Bow Second', -27.5, 0.5, -12, 6.5);
zone2('Stern High Box', 'Bow High Box', -24, 6.5, -10, 11.2);
zone2('Stern Pipe Exit', 'Bow Pipe Exit', PIPE_END, 11.2, CAB_FRONT, 14);
zone2('Port Alley', 'Starboard Alley', -25, -14, -5, -5.5);
zone2('Stern Mid', 'Bow Mid', -27.5, -6.0, -3, 0.5);
zone('Starboard V', -5, 3.0, 5, 11.2);
zone('Port V', -5, -11.2, 5, -3.0);
zone('Mid', -5, -3.0, 5, 3.0);
export const zones = Z;
export function zoneAt(x, y, z) {
  for (const q of Z) if (x >= q.x0 && x <= q.x1 && z >= q.z0 && z <= q.z1 && y >= q.y0 && y <= q.y1) return q.name;
  return x < 0 ? 'Stern Deck' : 'Bow Deck';
}

// Ammo pickups (respawning) - blue frame, flipped copies added.
const P0 = [[-33.5, 0, 4.2], [-13.6, 0, -2.5], [-40.0, F2_Y, -9.5], [-6.0, PIPE_Y, 12.7], [-2.0, WALK_Y, 12.7]];
export const pickups = [...P0.map(([x, y, z]) => ({ x, y, z })), ...P0.map(([x, y, z]) => ({ x: -x, y, z: -z }))];

// Nav graph nodes: [id, x, y, z, flags]; edges are found at load (walk test) plus explicit jump links.
// flags: s = snipe spot, c = cover, h = hold, p = perch (reached by jumping)
const N0 = [
  ['cab_a', -43.5, 0, -8], ['cab_b', -43.5, 0, 0], ['cab_c', -40, 0, 4], ['cab_d', -39, 0, -4], ['cab_e', -38.5, 0, -12.4],
  ['cab_door_l', -37.4, 0, -7.7], ['cab_door_m', -37.4, 0, 1.3], ['hall_door', -44.9, 0, 7.6],
  ['stair_rm', -44.9, 0, 10.2], ['pipe_top', -44.0, 0, 12.8], ['pipe_in', -39.5, PIPE_Y, 12.8],
  ['up_bot', -45.8, 0, -1.2], ['up_top', -45.8, F2_Y, -7.9], ['br_land', -43.0, F2_Y, -8.6],
  ['br_a', -42, F2_Y, -9.5], ['br_win_l', -37.1, F2_Y, -7.5, 's'], ['br_win_m', -37.1, F2_Y, -1.5, 's'], ['br_win_r', -37.1, F2_Y, 4.5, 's'],
  ['br_b', -41, F2_Y, 3], ['br_c', -41.5, F2_Y, 10.5], ['br_door', -37.2, F2_Y, 12.6],
  ['walk_a', -31, WALK_Y, 12.6, 'h'], ['walk_b', -20, WALK_Y, 12.6, 's'], ['walk_c', -8, WALK_Y, 12.6, 'h'], ['walk_d', 4, WALK_Y, 12.6, 's'],
  ['walk_e', 13.5, WALK_Y, 12.6], ['walk_end', 17.4, WALK_Y, 11.75], ['walk_crate', 17.6, 1.2, 10.45], ['walk_bot', 17.9, 0, 8.9, 'c'],
  ['pipe_a', -34, PIPE_Y, 12.7], ['pipe_b', -22, PIPE_Y, 12.7], ['pipe_c', -10, PIPE_Y, 12.7], ['pipe_d', 2, PIPE_Y, 12.7], ['pipe_e', 14, PIPE_Y, 12.7],
  ['pipe_x', 20.5, -0.2, 12.7], ['pipe_out', 23.2, 0, 11.9, 'c'], ['pipe_out2', 23.5, 0, 10.1, 'c'],
  ['door_l_out', -34.6, 0, -7.7, 'c'], ['door_m_out', -34.4, 0, 1.3, 'c'], ['drums', -33.2, 0, -1.4, 'c'],
  ['first_n', -31.5, 0, 4.6, 'c'], ['first_s', -31.2, 0, -1.8, 'c'], ['crates_s', -33.2, 0, 6.6, 'c'], ['crates_e', -29.2, 0, 7.3, 'c'],
  ['green_n', -30, 0, -8.6, 'c'], ['green_e', -25.0, 0, -8.6, 'c'], ['green_w', -34.6, 0, -11.0],
  ['green_crate', -26.3, 1.2, -10.9], ['green_top', -27.6, CH, -10.9, 'ps'],
  ['sec_w', -26.4, 0, 1.2, 'c'], ['sec_s', -18.4, 0, 1.5, 'c'], ['sec_e', -11.2, 0, 2.0, 'c'],
  ['sec_crate', -25.15, 1.2, 3.2], ['sec_top_w', -23.9, CH, 3.6], ['sec_top', -15.0, CH, 3.6, 'ps'],
  ['corr_w', -25.2, 0, 6.8], ['corr_m', -18, 0, 6.8, 'c'], ['corr_e', -10.6, 0, 6.8, 'c'],
  ['hb_crate', -10.6, 1.2, 9.6], ['hb_front', -12.0, CH, 9.95, 'p'], ['hb_in', -18.8, CH + 0.12, 9.95, 'ps'],
  ['mid_a', -24.5, 0, -3.6, 'c'], ['mid_b', -15.5, 0, -2.4], ['mid_c', -8.5, 0, -1.6], ['mid_crates', -18.4, 0, -1.0, 'c'],
  ['slant_n', -21.5, 0, -5.2, 'c'], ['slant_s', -21.5, 0, -10.2, 'c'],
  ['alley_w', -19.2, 0, -10.2], ['alley_gap', -17.6, 0, -9.0, 'c'], ['alley_b', -13.9, 0, -10.3], ['alley_c', -6.5, 0, -10.2],
  ['l_in', -14.2, 0, -5.8, 'c'], ['l_e', -7.2, 0, -3.0, 'c'],
  ['vp_w', -6.4, 0, 8.8, 'c'], ['v_back_w', -3.5, 0, -0.2, 'c'],
  ['pipex_red', -24.2, 0, -12.2, 'c'], ['pipex_red2', -22.5, 0, -9.6],
];
const N1 = [['mid_o', 0, 0, 0, 'c'], ['vp_n', 0, 0, 5.2, 'c'], ['vp_s', 0, 0, -5.2, 'c']];
export const navNodes = [
  ...N0.map(([id, x, y, z, f = '']) => ({ id: 's_' + id, x, y, z, f })),
  ...N0.map(([id, x, y, z, f = '']) => ({ id: 'b_' + id, x: -x, y, z: -z, f })),
  ...N1.map(([id, x, y, z, f = '']) => ({ id, x, y, z, f })),
];
// explicit jump links the walk test cannot find (crate steps up onto containers and the walkway)
const J0 = [['green_e', 'green_crate'], ['green_crate', 'green_top'], ['sec_w', 'sec_crate'], ['sec_crate', 'sec_top_w'],
  ['corr_e', 'hb_crate'], ['hb_crate', 'hb_front'], ['walk_bot', 'walk_crate'], ['walk_crate', 'walk_end']];
export const navLinks = [...J0.map(([a, b]) => ['s_' + a, 's_' + b]), ...J0.map(([a, b]) => ['b_' + a, 'b_' + b])];

// World extents for the radar
export const BOUNDS = { x0: -CAB_BACK, x1: CAB_BACK, z0: -HALF_W - 0.35, z1: HALF_W + 0.35 };
