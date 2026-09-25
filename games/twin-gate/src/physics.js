// cannon-es world, materials, fixed stepping, and the contact filter that makes walls
// lose their collision inside an open gate.
import * as CANNON from 'cannon-es';

export const STEP = 1 / 120;
export const GRAVITY = 15;

const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -GRAVITY, 0) });
world.broadphase = new CANNON.SAPBroadphase(world);
world.allowSleep = true;
world.solver.iterations = 12;
world.defaultContactMaterial.friction = 0.35;
world.defaultContactMaterial.restitution = 0.05;
world.defaultContactMaterial.contactEquationStiffness = 5e7;
world.defaultContactMaterial.contactEquationRelaxation = 3;

const mat = { world: new CANNON.Material('world'), player: new CANNON.Material('player'), prop: new CANNON.Material('prop'), slick: new CANNON.Material('slick') };
world.addContactMaterial(new CANNON.ContactMaterial(mat.player, mat.world, { friction: 0, restitution: 0 }));
world.addContactMaterial(new CANNON.ContactMaterial(mat.player, mat.prop, { friction: 0, restitution: 0 }));
world.addContactMaterial(new CANNON.ContactMaterial(mat.player, mat.slick, { friction: 0, restitution: 0 }));
world.addContactMaterial(new CANNON.ContactMaterial(mat.prop, mat.world, { friction: 0.45, restitution: 0.08 }));
world.addContactMaterial(new CANNON.ContactMaterial(mat.prop, mat.prop, { friction: 0.4, restitution: 0.05 }));
world.addContactMaterial(new CANNON.ContactMaterial(mat.prop, mat.slick, { friction: 0.02, restitution: 0.05 }));

export const phys = { world, mat, CANNON, filters: [] };

// Contact filter: every generated contact passes through here once (right after the narrowphase fills in the
// contact point). Filters return false to drop it; the solver skips disabled equations.
const np = world.narrowphase;
const origFric = np.createFrictionEquationsFromContact.bind(np);
np.createFrictionEquationsFromContact = function (c, out) {
  for (const f of phys.filters) if (!f(c)) { c.enabled = false; return false; }
  return origFric(c, out);
};

// Contacts touching `body` from the last step: [{ other, n (pointing into body), point, eq }]
export function contactsOf(body, out = []) {
  out.length = 0;
  for (const c of world.contacts) {
    if (!c.enabled) continue;
    if (c.bi === body) out.push({ other: c.bj, nx: -c.ni.x, ny: -c.ni.y, nz: -c.ni.z, px: c.bj.position.x + c.rj.x, py: c.bj.position.y + c.rj.y, pz: c.bj.position.z + c.rj.z });
    else if (c.bj === body) out.push({ other: c.bi, nx: c.ni.x, ny: c.ni.y, nz: c.ni.z, px: c.bi.position.x + c.ri.x, py: c.bi.position.y + c.ri.y, pz: c.bi.position.z + c.ri.z });
  }
  return out;
}
