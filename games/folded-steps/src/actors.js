// Folded Steps: the three kinds of walker. The Cartographer (player), Lintel (the stone companion whose
// flat head is a tile) and the Wardens (folded-paper sentinels). Each is modelled facing +z, standing on +y.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mat, hash } from './deco.js';

const UP = new THREE.Vector3(0, 1, 0);
const tmpM = new THREE.Matrix4(), tq = new THREE.Quaternion(), tx = new THREE.Vector3(), tz = new THREE.Vector3();
const M = (g, m, cast = true) => { const x = new THREE.Mesh(g, m); x.castShadow = cast; x.receiveShadow = false; return x; };

class Actor {
  constructor(scene) {
    this.g = new THREE.Group();
    this.body = new THREE.Group();
    this.g.add(this.body);
    scene.add(this.g);
    this.up = UP.clone();
    this.fwd = new THREE.Vector3(0, 0, 1);
    this.q = new THREE.Quaternion();
    this.walkT = 0;
    this.moving = false;
  }
  // position on a surface point with a given up; facing is projected onto the surface
  place(c, n) { this.g.position.copy(c); this.up.copy(n); }
  face(dir) { if (dir.lengthSq() > 1e-6) this.fwd.copy(dir).normalize(); }
  orient(dt, snap) {
    tz.copy(this.fwd).addScaledVector(this.up, -this.fwd.dot(this.up));
    if (tz.lengthSq() < 1e-4) tz.set(this.up.y ? 0 : 1, 0, this.up.y ? 1 : 0).addScaledVector(this.up, -0.0);
    tz.normalize();
    tx.crossVectors(this.up, tz).normalize();
    tmpM.makeBasis(tx, this.up, tz);
    tq.setFromRotationMatrix(tmpM);
    if (snap) this.q.copy(tq); else this.q.slerp(tq, 1 - Math.exp(-dt * 14));
    this.g.quaternion.copy(this.q);
  }
  set visible(v) { this.g.visible = v; }
  dispose(scene) { scene.remove(this.g); this.g.traverse((o) => { if (o.isMesh) o.geometry.dispose(); }); }
}

export class Cartographer extends Actor {
  constructor(scene, P) {
    super(scene);
    const b = this.body;
    const robe = mat('#3f5d7e', { rough: 0.85 }), hem = mat('#f4ecdf', { rough: 0.9 });
    const prof = [[0, 0], [0.19, 0], [0.18, 0.05], [0.14, 0.2], [0.095, 0.33], [0.07, 0.37], [0, 0.38]].map(([x, y]) => new THREE.Vector2(x, y));
    b.add(M(new THREE.LatheGeometry(prof, 20), robe));
    const trim = M(new THREE.CylinderGeometry(0.192, 0.195, 0.035, 20, 1, true), hem);
    trim.position.y = 0.018;
    b.add(trim);
    const sash = M(new THREE.TorusGeometry(0.122, 0.022, 6, 20), mat(P.handle));
    sash.rotation.x = Math.PI / 2; sash.position.y = 0.2;
    b.add(sash);
    this.head = new THREE.Group();
    this.head.position.y = 0.44;
    this.head.add(M(new THREE.SphereGeometry(0.076, 16, 12), mat('#f3d6c4', { rough: 0.8 })));
    // a conical straw hat (the pilgrim's douli) with a band
    const hat = M(new THREE.ConeGeometry(0.165, 0.11, 24, 1, false), mat('#ecd6a6', { rough: 0.95 }));
    hat.position.y = 0.1;
    const band = M(new THREE.TorusGeometry(0.07, 0.013, 6, 18), mat(P.handle));
    band.rotation.x = Math.PI / 2; band.position.y = 0.06;
    this.head.add(hat, band);
    for (const s of [-1, 1]) { const e = M(new THREE.SphereGeometry(0.011, 6, 4), mat('#3b3350'), false); e.position.set(s * 0.027, 0.0, 0.069); this.head.add(e); }
    b.add(this.head);
    // a rolled map on the back
    const scroll = M(new THREE.CylinderGeometry(0.03, 0.03, 0.22, 10), mat('#e8dcc4'));
    scroll.rotation.z = Math.PI / 2.6; scroll.position.set(0, 0.28, -0.1);
    b.add(scroll);
    // scarf: a ribbon trailing behind in world space
    this.tail = Array.from({ length: 9 }, () => new THREE.Vector3());
    const rg = new THREE.BufferGeometry();
    rg.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(9 * 2 * 3), 3));
    const idx = [];
    for (let i = 0; i < 8; i++) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
    rg.setIndex(idx);
    this.ribbon = new THREE.Mesh(rg, mat(P.handle, { side: THREE.DoubleSide, rough: 0.7 }));
    this.ribbon.frustumCulled = false;
    this.ribbon.castShadow = true;
    scene.add(this.ribbon);
    this.scarfInit = false;
    this.body.scale.setScalar(1.22);
    // where stone stands between you and the pilgrim, a faint ink silhouette shows through. It draws after the world
    // and before the pilgrim, only where it is behind something (nudged 0.1 toward the eye so the tile underfoot
    // never counts), and the stencil stops overlapping parts from doubling up. Alpha is left alone, or the page
    // background would show through the canvas.
    const ghost = new THREE.MeshBasicMaterial({ color: '#24406a', opacity: 0.74, blending: THREE.CustomBlending, blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor, depthWrite: false, depthFunc: THREE.GreaterDepth, stencilWrite: true, stencilRef: 1, stencilFunc: THREE.NotEqualStencilFunc, stencilZPass: THREE.ReplaceStencilOp });
    ghost.onBeforeCompile = (sh) => { sh.vertexShader = sh.vertexShader.replace('#include <project_vertex>', '#include <project_vertex>\ngl_Position.z -= 0.00035 * gl_Position.w;'); };
    const parts = [];
    b.traverse((m) => { if (m.isMesh) parts.push(m); });
    for (const m of parts) { m.renderOrder = 2; const s = new THREE.Mesh(m.geometry, ghost); s.renderOrder = 1; m.add(s); }
    this.ribbon.renderOrder = 2;
  }
  update(dt, t) {
    this.walkT += dt * (this.moving ? 11 : 0);
    const bob = this.moving ? Math.abs(Math.sin(this.walkT)) * 0.035 : Math.sin(t * 2.2) * 0.006;
    this.body.position.y = bob;
    this.body.rotation.z = this.moving ? Math.sin(this.walkT) * 0.06 : 0;
    this.head.rotation.y = this.moving ? 0 : Math.sin(t * 0.7) * 0.25;
    this.orient(dt);
    this.g.updateMatrixWorld(true);
    // ribbon: first point pinned at the neck, the rest trail with lag and a little flutter
    const neck = new THREE.Vector3(0.06, (0.37 + bob) * 1.22, -0.04).applyMatrix4(this.g.matrixWorld);
    const back = new THREE.Vector3(0, 0, -1).applyQuaternion(this.g.quaternion).multiplyScalar(0.055);
    const down = this.up.clone().multiplyScalar(-0.012);
    if (!this.scarfInit) { this.tail.forEach((p, i) => p.copy(neck).addScaledVector(back, i)); this.scarfInit = true; }
    this.tail[0].copy(neck);
    for (let i = 1; i < this.tail.length; i++) {
      const want = this.tail[i - 1].clone().add(back).add(down);
      want.addScaledVector(tx.crossVectors(this.up, back).normalize(), Math.sin(t * 6 + i * 0.9) * 0.012 * i * 0.3);
      this.tail[i].lerp(want, 1 - Math.exp(-dt * (22 - i)));
      const d = this.tail[i].clone().sub(this.tail[i - 1]);
      if (d.length() > 0.075) this.tail[i].copy(this.tail[i - 1]).addScaledVector(d.normalize(), 0.075);
    }
    const a = this.ribbon.geometry.attributes.position;
    const side = tx.crossVectors(this.up, back).normalize();
    this.tail.forEach((p, i) => {
      const w = 0.035 * (1 - i / 12);
      a.setXYZ(i * 2, p.x + side.x * w, p.y + side.y * w, p.z + side.z * w);
      a.setXYZ(i * 2 + 1, p.x - side.x * w, p.y - side.y * w, p.z - side.z * w);
    });
    a.needsUpdate = true;
    this.ribbon.geometry.computeBoundingSphere();
    this.ribbon.visible = this.g.visible;
  }
  dispose(scene) { super.dispose(scene); scene.remove(this.ribbon); this.ribbon.geometry.dispose(); }
}

// Lintel: exactly one unit tall, so its flat head is flush with a tile one step up
export class Lintel extends Actor {
  constructor(scene, P) {
    super(scene);
    const b = this.body;
    const stone = mat(P.acc, { rough: 0.8 }), dark = mat(P.col, { rough: 0.85 });
    const base = M(new RoundedBoxGeometry(0.78, 0.26, 0.78, 3, 0.05), dark); base.position.y = 0.13;
    const mid = M(new RoundedBoxGeometry(0.66, 0.46, 0.66, 3, 0.07), stone); mid.position.y = 0.49;
    const top = M(new RoundedBoxGeometry(0.9, 0.28, 0.9, 3, 0.05), dark); top.position.y = 0.86;
    const inlay = M(new THREE.TorusGeometry(0.22, 0.02, 6, 28), mat(P.glow, { emit: P.glow, ei: 0.2 }), false);
    inlay.rotation.x = Math.PI / 2; inlay.position.y = 1.0;
    this.eye = M(new THREE.CircleGeometry(0.075, 20), mat('#ffffff', { emit: P.glow, ei: 2 }), false);
    this.eye.position.set(0, 0.52, 0.332);
    const lid = M(new THREE.TorusGeometry(0.1, 0.016, 6, 20, Math.PI), dark, false);
    lid.position.set(0, 0.54, 0.333);
    b.add(base, mid, top, inlay, this.eye, lid);
    this.inlay = inlay;
    this.follow = true;
    this.P = P;
  }
  setFollow(on) {
    if (this.follow === on && this.eye.userData.set) return;
    this.eye.userData.set = true;
    this.follow = on;
    this.eye.material = mat('#ffffff', { emit: this.P.glow, ei: on ? 2 : 0.25 });
    this.inlay.material = mat(this.P.glow, { emit: this.P.glow, ei: on ? 0.2 : 1.6 });
  }
  update(dt, t) {
    this.walkT += dt * (this.moving ? 9 : 0);
    this.body.position.y = this.moving ? Math.abs(Math.sin(this.walkT)) * 0.02 : 0;
    this.body.rotation.z = this.moving ? Math.sin(this.walkT) * 0.03 : 0;
    this.eye.scale.setScalar(this.follow ? 1 + Math.sin(t * 2.4) * 0.06 : 0.7);
    this.orient(dt);
  }
}

// Wardens: tall folded-paper figures; they flap and cry when something blocks them
export class Warden extends Actor {
  constructor(scene, P, k = 0) {
    super(scene);
    const b = this.body;
    const paper = mat('#4b4478', { flat: true, rough: 0.75 }), white = mat('#f4efe8', { flat: true, rough: 0.8 });
    const body = M(new THREE.ConeGeometry(0.24, 0.62, 4, 1), paper);
    body.rotation.y = Math.PI / 4; body.position.y = 0.31;
    const head = M(new THREE.OctahedronGeometry(0.11, 0), paper);
    head.position.y = 0.67; head.scale.set(1, 1.2, 1);
    const beak = M(new THREE.ConeGeometry(0.045, 0.2, 4), white);
    beak.rotation.x = Math.PI / 2; beak.position.set(0, 0.66, 0.15);
    const mask = M(new THREE.CircleGeometry(0.06, 3), white, false);
    mask.position.set(0, 0.71, 0.085); mask.rotation.z = Math.PI;
    for (const s of [-1, 1]) { const e = M(new THREE.SphereGeometry(0.016, 6, 4), mat(P.glow, { emit: P.glow, ei: 2 }), false); e.position.set(s * 0.035, 0.7, 0.09); b.add(e); }
    this.wings = [-1, 1].map((s) => {
      const sh = new THREE.Shape(); sh.moveTo(0, 0); sh.lineTo(0.3 * s, -0.08); sh.lineTo(0.05 * s, -0.3); sh.lineTo(0, 0);
      const w = M(new THREE.ShapeGeometry(sh), mat('#6a62a0', { flat: true, side: THREE.DoubleSide }));
      w.position.set(0.06 * s, 0.5, -0.02);
      b.add(w);
      return w;
    });
    b.add(body, head, beak, mask);
    this.flap = 0;
    this.phase = hash(k, 9) * 6;
  }
  cry() { this.flap = 1; }
  update(dt, t) {
    this.walkT += dt * (this.moving ? 10 : 0);
    this.flap = Math.max(0, this.flap - dt * 1.4);
    const f = this.flap > 0 ? Math.sin(t * 30) * this.flap : Math.sin(t * 1.6 + this.phase) * 0.06;
    this.wings.forEach((w, i) => { w.rotation.y = (i ? -1 : 1) * (0.2 + f * 0.9); w.rotation.z = (i ? 1 : -1) * f * 0.3; });
    this.body.position.y = this.moving ? Math.abs(Math.sin(this.walkT)) * 0.03 : Math.sin(t * 1.3 + this.phase) * 0.01;
    this.body.rotation.x = this.flap * 0.15;
    this.orient(dt);
  }
}
