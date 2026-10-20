// One castle on the table: its blocks, throne and teddy, flag, piggy banks and catapults as physics
// bodies, how much of it still stands, and rebuilding it. The scene listens through hooks
// (onAdd/onRemove) to give each body a mesh. No three.js here, so the checks can use it in Node.
import { castlePlan, SLOTS, THRONE, TEDDY, PIGGY, worldX, sideDir } from './layout.js';

const TOL = 1.5;        // a block is still "standing" within this distance of where it belongs
const TILT = 0.97;      // ...and this upright (cosine)

export class Castle {
  constructor(phys, side, hooks = {}) {
    this.phys = phys;
    this.side = side;
    this.dir = sideDir(side);
    this.hooks = hooks;
    this.plan = castlePlan();
    this.blocks = this.plan.map(() => null);
    this.piggies = [null, null, null];
    this.catapults = [null, null];
    this.throne = this.teddy = this.flag = null;
  }

  add(body) { if (this.hooks.onAdd) this.hooks.onAdd(body, this); return body; }
  drop(body) { if (!body) return; this.phys.remove(body); if (this.hooks.onRemove) this.hooks.onRemove(body, this); }

  build(player) {
    this.plan.forEach((p, i) => { const b = this.phys.addBlock(p, this.side); b.userData.index = i; this.blocks[i] = this.add(b); });
    this.throne = this.add(this.phys.addThrone(this.side));
    this.teddy = this.add(this.phys.addTeddy(this.side));
    this.flag = this.add(this.phys.addFlag(this.side));
    this.homes = {
      teddy: this.teddy.position.clone(), throne: this.throne.position.clone(), flag: this.flag.position.clone(),
    };
    player.piggies.forEach((g, i) => { if (g.built) this.addPiggy(i); });
    player.catapults.forEach((c, i) => { if (c) this.addCatapult(i); });
  }

  addPiggy(slot) {
    if (this.piggies[slot]) this.drop(this.piggies[slot]);
    this.clearSpot(worldX(this.side, SLOTS.piggies[slot].x), SLOTS.piggies[slot].y, PIGGY.w, PIGGY.h);
    this.piggies[slot] = this.add(this.phys.addPiggy(this.side, slot));
    this.piggies[slot].userData.home = this.piggies[slot].position.clone();
    return this.piggies[slot];
  }
  addCatapult(slot) {
    if (this.catapults[slot]) return this.catapults[slot];
    this.catapults[slot] = this.add(this.phys.addCatapult(this.side, slot));
    return this.catapults[slot];
  }
  removePiggy(slot) { this.drop(this.piggies[slot]); this.piggies[slot] = null; }

  // where a plan block's centre belongs, in world space
  home(i) { const p = this.plan[i]; return { x: worldX(this.side, p.x), y: p.y + p.h / 2, z: 0 }; }

  intact(i) {
    const b = this.blocks[i];
    if (!b || !b.world) return false;
    const h = this.home(i);
    const d = Math.hypot(b.position.x - h.x, b.position.y - h.y, b.position.z - h.z);
    return d < TOL && this.phys.up(b).y > TILT;
  }
  missing() { return this.plan.map((_, i) => i).filter((i) => !this.intact(i)); }
  standing() { return this.plan.length - this.missing().length; }

  // the teddy is still on his throne (squashed or slumped counts: only off it doesn't)
  teddyOk() {
    const t = this.teddy, h = this.homes.teddy, th = this.throne;
    if (!t || !t.world) return false;
    if (t.position.y < h.y - 4.5 || Math.hypot(t.position.x - h.x, t.position.z - h.z) > 7) return false;
    // ...and the throne is still standing in the throne room
    return !!th && th.world && th.position.y > this.homes.throne.y - 3 && this.phys.up(th).y > 0.5;
  }
  flagUp() {
    const f = this.flag, h = this.homes.flag;
    if (!f || !f.world) return false;
    return this.phys.up(f).y > 0.6 && f.position.y > h.y - 6;
  }
  // a piggy bank that tipped over or fell off its shelf counts as broken
  piggyOk(slot) {
    const g = this.piggies[slot];
    if (!g || !g.world) return false;
    const h = g.userData.home;
    return !g.userData.smashed && this.phys.up(g).y > 0.5 && g.position.y > h.y - 4;
  }

  // the launch point of a catapult (world), the way it shoots
  launch(slot) { const s = SLOTS.catapults[slot]; return [worldX(this.side, s.launch[0]), s.launch[1]]; }

  // Remove anything loose (fallen blocks of either castle, spent ammo) from a rectangle around a
  // spot that is about to be filled. Returns the bodies it removed.
  clearSpot(cx, y0, w, h) {
    const out = [];
    for (const b of this.phys.dynamicBodies()) {
      const k = b.userData.kind;
      if (k === 'teddy' || k === 'throne') continue;
      if (k === 'block' && b.userData.side === this.side && this.intact(b.userData.index)) continue;
      if (k === 'block' && b.userData.side !== this.side) {
        const other = this.hooks.other && this.hooks.other();
        if (other && other.intact(b.userData.index)) continue;
      }
      if (k === 'piggy' && b.userData.side === this.side && this.piggyOk(b.userData.slot)) continue;
      if (k === 'flag' && b === this.flag && this.flagUp()) continue;
      b.updateAABB();
      const a = b.aabb;
      if (a.upperBound.x > cx - w / 2 - 0.3 && a.lowerBound.x < cx + w / 2 + 0.3 && a.upperBound.y > y0 - 0.2 && a.lowerBound.y < y0 + h + 0.3 && a.upperBound.z > -5.5 && a.lowerBound.z < 5.5) out.push(b);
    }
    for (const b of out) this.dropLoose(b);
    return out;
  }

  // forget a loose body wherever it is referenced
  dropLoose(b) {
    const ud = b.userData;
    if (ud.kind === 'block') {
      const owner = ud.side === this.side ? this : this.hooks.other && this.hooks.other();
      if (owner && owner.blocks[ud.index] === b) owner.blocks[ud.index] = null;
    }
    if (ud.kind === 'flag' && b === this.flag) this.flag = null;
    if (ud.kind === 'piggy' && ud.side === this.side && this.piggies[ud.slot] === b) this.piggies[ud.slot] = null;
    this.drop(b);
    if (this.hooks.onLoose) this.hooks.onLoose(b);
  }

  // Put the missing blocks back (bottom up) and, if asked, the flag. Fallen pieces are tidied away.
  rebuild(indices, { flag = false } = {}) {
    const order = [...indices].sort((a, b) => this.plan[a].y - this.plan[b].y);
    for (const i of order) {
      if (this.blocks[i]) { this.drop(this.blocks[i]); this.blocks[i] = null; }
      const p = this.plan[i];
      this.clearSpot(worldX(this.side, p.x), p.y, p.w, p.h);
      const b = this.phys.addBlock(p, this.side);
      b.userData.index = i;
      this.blocks[i] = this.add(b);
    }
    if (flag) {
      if (this.flag) this.drop(this.flag);
      this.clearSpot(worldX(this.side, SLOTS.flag.x), SLOTS.flag.y, 4, 24);
      this.flag = this.add(this.phys.addFlag(this.side));
    }
    return order;
  }

  // everything of this castle, for sleeping/waking and glue
  bodies() { return [...this.blocks, ...this.piggies, this.throne, this.teddy, this.flag].filter((b) => b && b.world); }

  // glue: heavier, grippier blocks for a while
  setGlue(on) {
    for (const b of this.blocks) {
      if (!b || !b.world) continue;
      const base = b.userData.piece.w * b.userData.piece.h * 10 * 0.002;
      b.mass = on ? base * 3 : base;
      b.updateMassProperties();
      b.userData.glued = on;
    }
    this.glued = on;
  }

  // the parts the computer kids aim at (world points)
  targets() {
    const t = [];
    if (this.teddy && this.teddy.world) t.push({ kind: 'teddy', x: this.teddy.position.x, y: this.teddy.position.y + 1, w: TEDDY.w });
    if (this.flag && this.flag.world && this.flagUp()) t.push({ kind: 'flag', x: this.flag.position.x, y: this.flag.position.y + 8, w: 2 });
    this.piggies.forEach((g, slot) => { if (g && this.piggyOk(slot)) t.push({ kind: 'piggy', slot, x: g.position.x, y: g.position.y, w: PIGGY.w }); });
    t.push({ kind: 'throne', x: this.throne.position.x, y: this.throne.position.y, w: THRONE.seat[0] });
    return t;
  }
}
