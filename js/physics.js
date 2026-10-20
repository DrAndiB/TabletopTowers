// Rigid-body physics for the block castles (cannon-es), on a fixed 120 Hz step. Everything sleeps
// between shots; the first touch of a projectile wakes the whole table, and a shot is over when
// everything has gone back to sleep. No three.js in here, so the checks can run it in Node.
import * as CANNON from '../vendor/cannon-es.js';
import { DEPTH, TABLE, GRAVITY, TEDDY, THRONE, PIGGY, CATAPULT, SLOTS, worldX, sideDir } from './layout.js';
import { AMMO, DT, airAccel } from './ballistics.js';

const V = (x, y, z) => new CANNON.Vec3(x, y, z);
const MAX_STEPS = 6;   // per frame; slower frames run the physics in slow motion instead of spiralling

export class Physics {
  constructor() {
    const w = (this.world = new CANNON.World({ gravity: V(0, -GRAVITY, 0), allowSleep: true }));
    w.broadphase = new CANNON.SAPBroadphase(w);
    w.solver.iterations = 20;
    w.defaultContactMaterial.friction = 0.55;
    w.defaultContactMaterial.restitution = 0.05;
    // materials: blocks and table are wood; the teddy is felt; piggy banks are glazed clay
    const M = (this.mat = { wood: new CANNON.Material('wood'), felt: new CANNON.Material('felt'), clay: new CANNON.Material('clay'), card: new CANNON.Material('card') });
    for (const k of Object.keys(AMMO)) M[k] = new CANNON.Material(k);
    w.addContactMaterial(new CANNON.ContactMaterial(M.felt, M.wood, { friction: 0.9, restitution: 0.02 }));
    w.addContactMaterial(new CANNON.ContactMaterial(M.clay, M.wood, { friction: 0.5, restitution: 0.05 }));
    w.addContactMaterial(new CANNON.ContactMaterial(M.card, M.wood, { friction: 0.8, restitution: 0.0 }));
    for (const k of Object.keys(AMMO)) {
      const a = AMMO[k];
      for (const o of ['wood', 'felt', 'clay', 'card']) w.addContactMaterial(new CANNON.ContactMaterial(M[k], M[o], { friction: a.friction, restitution: o === 'felt' ? a.restitution * 0.3 : a.restitution }));
    }
    this.acc = 0;
    this.time = 0;
    this.projectiles = new Set();
    this.kinematic = new Set();
    this.lost = [];
    this.onImpact = null;       // (bodyA, bodyB, speed) for sounds and smashing piggies
    this.onLost = null;         // (body) a body fell off the table
    this.onBoxHit = null;       // (box, shot, speed) a projectile hit a cardboard box
    this.wind = 0;
    // the table top (and the kitchen floor far below, so nothing falls forever)
    const table = new CANNON.Body({ mass: 0, material: M.wood, shape: new CANNON.Box(V(TABLE.x, 5, TABLE.z)) });
    table.position.set(0, -5, 0);
    table.userData = { kind: 'table' };
    w.addBody(table);
    this.table = table;
  }

  // ---------- building ----------
  dyn(kind, side, mass, material, shapes, x, y, z = 0, extra = {}) {
    const b = new CANNON.Body({ mass, material });
    for (const [s, off] of shapes) b.addShape(s, off ? V(...off) : undefined);
    b.position.set(x, y, z);
    b.sleepSpeedLimit = 2.2;
    b.sleepTimeLimit = 0.35;
    b.linearDamping = 0.02;
    b.angularDamping = 0.05;
    if (extra.angularDamping) { b.angularDamping = extra.angularDamping; delete extra.angularDamping; }
    b.userData = { kind, side, ...extra };
    b.addEventListener('collide', (e) => this.collide(b, e));
    this.world.addBody(b);
    b.sleep();
    return b;
  }

  // a wooden block from the plan, centred at its world position
  addBlock(p, side) {
    const mass = p.w * p.h * DEPTH * 0.002;
    return this.dyn('block', side, mass, this.mat.wood, [[new CANNON.Box(V(p.w / 2, p.h / 2, DEPTH / 2))]], worldX(side, p.x), p.y + p.h / 2, 0, { piece: p });
  }

  // the throne: seat and back as one body; its origin near the centre of mass
  addThrone(side) {
    const s = SLOTS.throne, [sw, sh, sd] = THRONE.seat, [bw, bh, bd] = THRONE.back;
    return this.dyn('throne', side, 0.9, this.mat.wood, [
      [new CANNON.Box(V(sw / 2, sh / 2, sd / 2)), [0, -1, 1]],
      [new CANNON.Box(V(bw / 2, bh / 2, bd / 2)), [0, sh / 2 - 1 + bh / 2, -sd / 2 + bd / 2 + 1]],
    ], worldX(side, s.x), s.y + 3, -1);
  }

  addTeddy(side) {
    const s = SLOTS.throne;
    return this.dyn('teddy', side, 0.7, this.mat.felt, [[new CANNON.Box(V(TEDDY.w / 2, TEDDY.h / 2, TEDDY.d / 2))]], worldX(side, s.x), s.y + THRONE.seat[1] + TEDDY.h / 2, 1.5);
  }

  addPiggy(side, slot) {
    const s = SLOTS.piggies[slot];
    return this.dyn('piggy', side, 0.9, this.mat.clay, [[new CANNON.Box(V(PIGGY.w / 2, PIGGY.h / 2, PIGGY.d / 2))]], worldX(side, s.x), s.y + PIGGY.h / 2, 0, { slot });
  }

  // a pencil flagpole in a small wooden foot; the origin a little up the pole so it topples
  addFlag(side) {
    const s = SLOTS.flag;
    return this.dyn('flag', side, 0.3, this.mat.wood, [
      [new CANNON.Box(V(1.6, 1.5, 1.6)), [0, -4.5, 0]],
      [new CANNON.Box(V(0.45, 11, 0.45)), [0, 8, 0]],
    ], worldX(side, s.x), s.y + 6, 0, { angularDamping: 0.3 });
  }

  // a cardboard box: light, grippy, and it swallows projectiles (see collide)
  addBox(side, slot) {
    const s = SLOTS.boxes[slot];
    return this.dyn('box', side, s.mass, this.mat.card, [[new CANNON.Box(V(s.w / 2, s.h / 2, DEPTH / 2))]], worldX(side, s.x), s.y + s.h / 2, 0, { slot });
  }

  // catapults are bolted to the table: they stop debris but never fall over
  addCatapult(side, slot) {
    const s = SLOTS.catapults[slot];
    const b = new CANNON.Body({ mass: 0, material: this.mat.wood, shape: new CANNON.Box(V(CATAPULT.w / 2, CATAPULT.h / 2, CATAPULT.d / 2)) });
    b.position.set(worldX(side, s.x), s.y + CATAPULT.h / 2, 0);
    b.userData = { kind: 'catapult', side, slot };
    this.world.addBody(b);
    return b;
  }

  remove(b) {
    if (!b) return;
    // bodies can't leave the world in the middle of a step (a collision event wants it gone)
    if (this.stepping) { (this.pending || (this.pending = [])).push(b); return; }
    this.world.removeBody(b);
    this.projectiles.delete(b);
    this.kinematic.delete(b);
  }

  // ---------- shooting ----------
  addProjectile(ammoKey, x, y, vx, vy) {
    const a = AMMO[ammoKey];
    const shape = a.shape === 'box' ? new CANNON.Box(V(a.size[0] / 2, a.size[1] / 2, a.size[2] / 2)) : new CANNON.Sphere(a.radius);
    const b = new CANNON.Body({ mass: a.mass, material: this.mat[ammoKey], shape });
    b.position.set(x, y, 0);
    b.velocity.set(vx, vy, 0);
    if (a.shape === 'box') b.angularVelocity.set(0, 0, -Math.sign(vx) * 9);
    b.linearDamping = 0; b.angularDamping = 0;
    b.allowSleep = false;   // until it has landed
    b.sleepSpeedLimit = 2; b.sleepTimeLimit = 0.3;
    b.userData = { kind: 'shot', ammo: ammoKey, flying: true, born: this.time, hits: 0 };
    b.addEventListener('collide', (e) => this.collide(b, e));
    this.world.addBody(b);
    this.projectiles.add(b);
    return b;
  }

  collide(b, e) {
    const other = e.body;
    let speed = 0;
    try { speed = Math.abs(e.contact.getImpactVelocityAlongNormal()); } catch (err) { /* ignore */ }
    const ud = b.userData;
    if (ud.kind === 'shot' && ud.flying) {
      // first touch: the wind lets go of it, it starts to slow down, the table wakes up
      ud.flying = false;
      ud.landedAt = this.time;
      b.allowSleep = true;
      b.linearDamping = 0.6; b.angularDamping = 0.8;
      this.wakeAll();
    }
    if (ud.kind === 'shot') ud.hits++;
    // cardboard swallows a shot: it stops dead (before the solver hands the push on) and the box
    // takes the damage instead of the blocks behind it. A shot that tears the box open goes on
    // through it with what it has left.
    if (ud.kind === 'shot' && other.userData.kind === 'box' && !other.userData.torn && speed > 25) {
      const r = this.onBoxHit ? this.onBoxHit(other, b, speed) : null;
      if (r && r.torn) {
        other.isTrigger = true;
        const eqs = this.world.solver.equations;
        for (let i = eqs.length - 1; i >= 0; i--) if (eqs[i].bi === other || eqs[i].bj === other) eqs.splice(i, 1);
        b.velocity.scale(r.keep, b.velocity);
      } else {
        b.velocity.scale(0.1, b.velocity);
        b.angularVelocity.scale(0.2, b.angularVelocity);
      }
    }
    // a piggy bank that breaks takes most of the shot with it
    if (ud.kind === 'shot' && other.userData.kind === 'piggy' && speed > 22) {
      b.velocity.scale(0.35, b.velocity);
      b.angularVelocity.scale(0.5, b.angularVelocity);
    }
    // each pair is reported once (from the body with the lower id)
    if (this.onImpact && b.id < other.id) this.onImpact(b, other, speed);
  }

  wakeAll() {
    for (const b of this.world.bodies) if (b.type === CANNON.Body.DYNAMIC) b.wakeUp();
  }

  // ---------- running ----------
  update(dt) {
    this.acc = Math.min(this.acc + dt, DT * MAX_STEPS);
    let n = 0;
    while (this.acc >= DT - 1e-6) { this.step(); this.acc -= DT; n++; }
    return n;
  }

  step() {
    // the draft and air drag on projectiles still in the air
    for (const b of this.projectiles) {
      if (!b.userData.flying) continue;
      const a = AMMO[b.userData.ammo];
      const [ax, ay] = airAccel(b.velocity.x, b.velocity.y, a, this.wind);
      b.force.x += ax * b.mass; b.force.y += ay * b.mass;
    }
    for (const k of this.kinematic) if (k.userData.move) k.userData.move(k, DT, this.time);
    this.stepping = true;
    try { this.world.step(DT); } finally { this.stepping = false; }
    if (this.pending) { const p = this.pending; this.pending = null; for (const b of p) this.remove(b); }
    this.time += DT;
    // whatever falls off the table is gone
    for (let i = this.world.bodies.length - 1; i >= 0; i--) {
      const b = this.world.bodies[i];
      if (b.type === CANNON.Body.DYNAMIC && b.position.y < -40) {
        this.lost.push(b);
        this.remove(b);
        if (this.onLost) this.onLost(b);
      }
    }
  }

  // nothing is moving any more (projectiles still in the air count as moving)
  settled() {
    for (const b of this.world.bodies) {
      if (b.type === CANNON.Body.KINEMATIC) return false;
      if (b.type !== CANNON.Body.DYNAMIC) continue;
      if (b.userData.kind === 'shot' && b.userData.flying) return false;
      if (b.sleepState !== CANNON.Body.SLEEPING) return false;
    }
    return true;
  }

  dynamicBodies() { return this.world.bodies.filter((b) => b.type === CANNON.Body.DYNAMIC); }

  // the upward direction of a body (for "has it fallen over?")
  up(b) { return b.quaternion.vmult(V(0, 1, 0)); }

  // a moving collider that pushes things around (the cat walking across the table)
  addKinematic(halfExtents, x, y, z, move, userData = {}) {
    const b = new CANNON.Body({ mass: 0, type: CANNON.Body.KINEMATIC, shape: new CANNON.Box(V(...halfExtents)) });
    b.position.set(x, y, z);
    b.userData = { kind: 'kinematic', move, ...userData };
    this.world.addBody(b);
    this.kinematic.add(b);
    return b;
  }

  // world-space AABBs of everything solid except the table, for aiming checks: [{x0,y0,x1,y1,b}]
  boxes() {
    const out = [];
    for (const b of this.world.bodies) {
      if (b === this.table || b.userData.kind === 'shot' || b.userData.kind === 'kinematic') continue;
      b.updateAABB();
      const a = b.aabb;
      if (a.lowerBound.z > 3 || a.upperBound.z < -3) continue;   // out of the firing plane
      out.push({ x0: a.lowerBound.x, y0: a.lowerBound.y, x1: a.upperBound.x, y1: a.upperBound.y, b });
    }
    return out;
  }
}

export { CANNON, sideDir };
