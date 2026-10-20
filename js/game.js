// One game of Tabletop Towers: two block castles on the kitchen table, turn by turn. A turn is:
// pocket money and morale → the shop (chores, the market, building) → aim and fire → watch it land
// → count the damage. A round is both turns; some rounds start with something happening in the
// kitchen. The teddy that falls off his throne loses.
import * as THREE from '../vendor/three.bundle.js';
import { makeKit } from './kit.js';
import { Physics } from './physics.js';
import { Castle } from './castle.js';
import { SLOTS, worldX, sideDir } from './layout.js';
import { AMMO_ORDER, flight, launchVelocity, WIND_MAX, ANGLE_MIN, ANGLE_MAX } from './ballistics.js';
import * as E from './economy.js';
import { shop as aiShop, aim as aiAim } from './ai.js';
import * as P from './pieces.js';
import { buildKitchen, buildStall, LIGHT } from './scene.js';
import { Particles } from './fx.js';
import { rng, clamp, lerp, damp } from './util.js';

const OVERVIEW = { x: 0, y: 38, width: 330, pitch: 0.19 };
const SETTLE_MAX = 6;        // seconds to watch after the first touch
const FLIGHT_MAX = 9;
export const EVENTS = {
  cat: { title: 'Here comes the cat!', text: 'She walks right across the table.' },
  dinner: { title: 'Dinner time!', text: 'Truce this round: shop and build, but no shooting.' },
  grandma: { title: 'Grandma is visiting!', text: 'Double pocket money for everyone this round.' },
  fairy: { title: 'The tooth fairy came!', text: '' },
  clean: { title: 'Clean your room!', text: 'Chores are Light for everyone this round, like it or not.' },
  sister: { title: 'Little sister wants a block!', text: '' },
  gust: { title: 'Somebody opened the window!', text: 'A strong draft this round.' },
};

export class Game {
  constructor(R, sound, hud) {
    this.R = R; this.sound = sound; this.hud = hud;
    this.time = 0;
    this.over = null;
    this.onOver = null;
    this.paused = false;
    this.cinematics = true;
    this.keys = new Set();
    this.visuals = new Map();     // physics body → {obj, update?, pop}
    this.lastAim = [null, null];
    this.ghost = [null, null];
    this.camera = { ...OVERVIEW };
    this.camGoal = { ...OVERVIEW };
    this.built = false;
    hud.bind(this);
  }

  // ---------- the room (once) ----------
  buildRoom() {
    if (this.built) return;
    this.built = true;
    const R = this.R;
    R.setLighting(LIGHT);
    R.shadowSpan = 420;
    this.K = makeKit({ scene: R.scene, quality: R.quality, seed: 11 });
    this.room = buildKitchen(this.K, R);
    this.stall = buildStall(this.K);
    this.particles = new Particles(this.K.group, 900);
    this.particles.setScale(R.renderer.domElement.height * 0.9);
    this.coins = new Coins(this.K.group);
    this.preview = new Dots(this.K.group, 0xffffff, 40, 2.2);
    this.ghostDots = new Dots(this.K.group, 0x1f1a17, 90, 0.9, 0.35);
    this.dynamic = new THREE.Group();
    R.scene.add(this.dynamic);
    this.applyCamera(true);
  }

  // ---------- a new game ----------
  // cfg: {players: [{type: 'human'|'cpu', personality, skill}, ...], seed}
  start(cfg) {
    this.buildRoom();
    this.clear();
    this.cfg = cfg;
    this.rnd = rng(cfg.seed || (Date.now() & 0xffff));
    this.phys = new Physics();
    this.phys.onImpact = (a, b, v) => this.impact(a, b, v);
    this.phys.onLost = (b) => this.removeVisual(b);
    this.players = cfg.players.map((p, i) => E.newPlayer(i, p));
    this.market = new E.Market();
    this.castles = [];
    for (let s = 0; s < 2; s++) {
      this.castles[s] = new Castle(this.phys, s, {
        onAdd: (b) => this.addVisual(b),
        onRemove: (b) => this.removeVisual(b),
        onLoose: (b) => this.puff(b.position.x, b.position.y, b.position.z, 0xe8d4b0, 8),
        other: () => this.castles[1 - s],
      });
    }
    this.castles.forEach((c, i) => c.build(this.players[i]));
    this.soldiers = [[], []];
    this.walkers = [];
    this.players.forEach((p, s) => { for (let i = 0; i < p.toys; i++) this.addSoldier(s, true); });
    this.round = 0;
    this.turn = 0;
    this.wind = 0;
    this.over = null;
    this.flags = {};
    this.phase = 'intro';
    this.phaseT = 0;
    this.lastAim = [null, null];
    this.ghost = [null, null];
    this.ghostDots.hide(); this.preview.hide();
    this.hud.reset(this.players);
    if (cfg.showcase) {
      // behind the title screen: the castles stand, the camera drifts along the table
      this.phase = 'showcase';
      this.camera = { ...OVERVIEW, width: 300 };
      this.camGoal = { ...this.camera };
      this.applyCamera(true);
      return;
    }
    this.refreshHud();
    this.sound.playMusic('siege', 0.55);
    if (this.cinematics) { this.camera = { x: 0, y: 30, width: 120, pitch: 0.35, z: -40 }; }
    this.applyCamera(true);
  }

  clear() {
    for (const [b] of this.visuals) this.removeVisual(b);
    this.visuals.clear();
    if (this.soldiers) for (const list of this.soldiers) for (const s of list) this.dynamic.remove(s.mesh);
    if (this.walkers) for (const w of this.walkers) this.dynamic.remove(w.mesh);
    if (this.shot && this.shot.mesh) this.dynamic.remove(this.shot.mesh);
    if (this.cat) { this.dynamic.remove(this.cat.view.group); this.cat = null; }
    if (this.thief) { this.dynamic.remove(this.thief.mesh); this.thief = null; }
    this.shot = null;
    if (this.coins) this.coins.clear();
  }

  // ---------- visuals for bodies ----------
  addVisual(b) {
    const ud = b.userData;
    let v = null;
    if (ud.kind === 'block') v = { obj: P.blockMesh(ud.piece, ud.side, ud.index) };
    else if (ud.kind === 'throne') v = { obj: P.throne(ud.side) };
    else if (ud.kind === 'teddy') { const t = P.teddy(ud.side); v = { obj: t.group, teddy: t }; }
    else if (ud.kind === 'piggy') v = { obj: P.piggy(ud.side) };
    else if (ud.kind === 'flag') { const f = P.flag(ud.side); v = { obj: f.group, flag: f }; }
    else if (ud.kind === 'catapult') { const c = P.catapult(ud.side); v = { obj: c.group, catapult: c, static: true }; }
    if (!v) return;
    v.pop = this.phase && this.phase !== 'intro' ? 0 : 1;
    this.visuals.set(b, v);
    this.dynamic.add(v.obj);
    v.obj.position.copy(b.position);
    v.obj.quaternion.copy(b.quaternion);
    if (v.pop < 1) v.obj.scale.setScalar(0.01);
  }
  removeVisual(b) {
    const v = this.visuals.get(b);
    if (!v) return;
    this.dynamic.remove(v.obj);
    this.visuals.delete(b);
  }
  syncVisuals(dt) {
    for (const [b, v] of this.visuals) {
      if (!v.static) { v.obj.position.copy(b.position); v.obj.quaternion.copy(b.quaternion); }
      if (v.pop < 1) { v.pop = Math.min(1, v.pop + dt * 3.5); const k = v.pop; v.obj.scale.setScalar(Math.max(0.01, 1 + Math.sin(k * Math.PI) * 0.15 * (1 - k) - (1 - k) * (1 - k))); }
      if (v.teddy) v.teddy.update(this.time, this.teddyMood(b));
      if (v.flag) v.flag.update(this.time, this.wind * sideDir(b.userData.side));
      if (v.catapult) v.catapult.update(this.dtFrame || 0.016);
    }
  }
  teddyMood(b) {
    if (this.over) return this.over.winner === b.userData.side ? -1 : 0;
    if (this.phase === 'flight' && this.turn !== b.userData.side) return 0.8;
    return 0;
  }
  catapultView(side, slot) { const b = this.castles[side].catapults[slot]; return b && this.visuals.get(b) ? this.visuals.get(b).catapult : null; }

  // ---------- toy soldiers ----------
  soldierSpot(side, i) { return { x: worldX(side, -50 + i * 6.2), z: 17 + (i % 2) * 4 }; }
  addSoldier(side, quiet = false) {
    const mesh = P.soldier(side);
    const i = this.soldiers[side].length;
    const s = this.soldierSpot(side, i);
    mesh.position.set(s.x, 0, s.z);
    mesh.rotation.y = side ? -0.3 : 0.3;
    this.dynamic.add(mesh);
    const o = { mesh, side, ph: this.rnd ? this.rnd() * 6 : 0, pop: quiet ? 1 : 0 };
    if (!quiet) { mesh.scale.setScalar(0.01); this.confetti(s.x, 6, s.z, 14); }
    this.soldiers[side].push(o);
    return o;
  }
  // one toy walks over to the other castle (or off the table, on mutiny)
  walkOver(from, to = null) {
    const o = this.soldiers[from].pop();
    if (!o) return;
    const start = o.mesh.position.clone();
    const end = to == null ? new THREE.Vector3(start.x + sideDir(from) * -160, 0, 70) : (() => { const s = this.soldierSpot(to, this.soldiers[to].length + this.walkers.filter((w) => w.to === to).length); return new THREE.Vector3(s.x, 0, s.z); })();
    this.walkers.push({ mesh: o.mesh, from, to, start, end, t: 0, dur: Math.max(1.5, start.distanceTo(end) / 55) });
  }
  updateSoldiers(dt) {
    const t = this.time;
    for (let s = 0; s < 2; s++) {
      const p = this.players && this.players[s];
      const happy = p ? p.morale >= 70 : false, sulky = p ? p.morale < 40 : false;
      this.soldiers[s].forEach((o, i) => {
        if (o.pop < 1) { o.pop = Math.min(1, o.pop + dt * 3); o.mesh.scale.setScalar(Math.max(0.01, o.pop)); }
        const sp = this.soldierSpot(s, i);
        o.mesh.position.x = damp(o.mesh.position.x, sp.x, 6, dt); o.mesh.position.z = damp(o.mesh.position.z, sp.z, 6, dt);
        const hop = happy ? Math.max(0, Math.sin(t * 7 + o.ph)) * 1.2 : 0;
        o.mesh.position.y = hop;
        o.mesh.rotation.z = sulky ? 0.25 * Math.sin(o.ph) : Math.sin(t * 2 + o.ph) * 0.04;
      });
    }
    for (let i = this.walkers.length - 1; i >= 0; i--) {
      const w = this.walkers[i];
      w.t += dt;
      const k = clamp(w.t / w.dur, 0, 1);
      w.mesh.position.lerpVectors(w.start, w.end, k);
      w.mesh.position.y = Math.abs(Math.sin(w.t * 12)) * 1.2;
      w.mesh.rotation.y = Math.atan2(w.end.x - w.start.x, w.end.z - w.start.z);
      if (k >= 1) {
        this.walkers.splice(i, 1);
        this.dynamic.remove(w.mesh);
        if (w.to != null) {
          const o = this.addSoldier(w.to, true);
          o.mesh.position.copy(w.end);
          this.confetti(w.end.x, 6, w.end.z, 8);
        }
      }
    }
  }
  // keep the row of soldiers matching the number of toys
  syncSoldierCount(side) {
    const n = this.players[side].toys;
    while (this.soldiers[side].length + this.walkers.filter((w) => w.to === side).length < n) this.addSoldier(side);
    while (this.soldiers[side].length > n && this.soldiers[side].length) { const o = this.soldiers[side].pop(); this.dynamic.remove(o.mesh); }
  }

  // ---------- effects ----------
  puff(x, y, z, color = 0xf4ead8, n = 10) { this.particles.emit(x, y, z, { color, n, size: 3, life: 0.7, spread: 14, up: 10, grav: 6, alpha: 0.55, grow: 1.6 }); }
  confetti(x, y, z, n = 20) { for (const c of [0xe23b2e, 0xf2c230, 0x2f6fe0, 0x2fae5a]) this.particles.emit(x, y, z, { color: c, n: Math.ceil(n / 4), size: 1.4, life: 1.4, spread: 40, up: 60, grav: 90, alpha: 1, grow: 1 }); }

  // physics contacts → sounds and broken piggy banks
  impact(a, b, speed) {
    if (speed < 5 || !this.phys) return;
    const kinds = [a.userData.kind, b.userData.kind];
    const x = (a.position.x + b.position.x) / 2, y = Math.max(a.position.y, b.position.y), pan = clamp(x / 200, -0.9, 0.9);
    const v = speed / 25;
    // piggy banks are glazed clay: a good knock breaks them
    for (const [p, o] of [[a, b], [b, a]]) {
      if (p.userData.kind !== 'piggy' || p.userData.smashed) continue;
      const ok = o.userData.kind;
      if ((ok === 'shot' && speed > 22) || (ok === 'block' && speed > 32) || (ok === 'table' && speed > 30)) { this.smashPiggy(p); return; }
    }
    const shot = kinds[0] === 'shot' ? a : kinds[1] === 'shot' ? b : null;
    if (shot) {
      const ammo = shot.userData.ammo;
      if (ammo === 'marble') this.sound.clink(v, pan);
      else if (ammo === 'eraser') this.sound.boing(v, pan);
      else this.sound.paperHit(v, pan);
      if (kinds.includes('block') || kinds.includes('throne')) this.sound.clack(v, pan);
      if (speed > 40) this.puff(x, y, 0, 0xf1e2c4, 6);
      return;
    }
    if (kinds.includes('teddy')) { this.sound.thud(v * 0.5, pan); return; }
    const deep = [a, b].some((q) => q.userData.piece && (q.userData.piece.kind === 'board' || q.userData.piece.kind === 'tower'));
    if (kinds.includes('table')) { this.sound.clack(v * 0.8, pan, true); if (speed > 30) this.puff(x, 0.5, 0, 0xe8d4b0, 4); }
    else this.sound.clack(v, pan, deep);
  }

  smashPiggy(b) {
    const ud = b.userData;
    if (ud.smashed) return;
    ud.smashed = true;
    const { x, y, z } = b.position;
    this.sound.smash(clamp(x / 200, -0.9, 0.9));
    this.particles.emit(x, y, z, { color: 0xf4a5b8, n: 26, size: 1.6, life: 1.2, spread: 50, up: 50, grav: 120, alpha: 1, grow: 1 });
    this.puff(x, y, z, 0xffe0e8, 8);
    const g = this.players[ud.side].piggies[ud.slot];
    this.coins.burst(x, y, z, Math.max(3, Math.min(14, Math.ceil(g.savings / 2))));
    if (this.shotLog) this.shotLog.piggies[ud.side].add(ud.slot);
    else this.pendingPiggies = (this.pendingPiggies || []).concat([[ud.side, ud.slot]]);
    this.castles[ud.side].removePiggy(ud.slot);
  }

  // ---------- turns ----------
  nextRound() {
    this.round++;
    if (this.round > 1) this.market.relax();
    this.flags = {};
    this.hud.setRound(this.round);
    // something happens in the kitchen now and then (not in the first rounds)
    if (this.forceEvent && this.round === 2) { this.startEvent(this.forceEvent); return; }
    if (this.round >= 3 && !this.noEvents && this.rnd() < 0.24) {
      const keys = Object.keys(EVENTS);
      this.startEvent(this.forceEvent || keys[Math.floor(this.rnd() * keys.length)]);
      return;
    }
    this.startTurn(0);
  }

  startTurn(side) {
    this.turn = side;
    const p = this.players[side], other = this.players[1 - side];
    this.wind = Math.round((this.rnd() * 2 - 1) * WIND_MAX * (this.flags.gust ? 1.7 : 1));
    this.phys.wind = this.wind;
    const rep = E.startTurn(p, other, this.rnd, { grandma: !!this.flags.grandma, clean: !!this.flags.clean });
    this.lastReport = rep;
    // coins rain into the castle
    const piggies = this.castles[side].piggies.filter(Boolean);
    const tgt = piggies.length ? piggies[0].position : { x: worldX(side, 0), y: 10, z: 0 };
    this.coins.rain(tgt.x, tgt.y + 4, tgt.z, Math.min(12, Math.ceil(rep.income.total / 2)));
    this.sound.coins(Math.min(8, Math.ceil(rep.income.total / 3)), 0.4);
    if (rep.defected) this.walkOver(side, 1 - side);
    if (rep.joined) this.syncSoldierCount(side);
    this.sound.turnCall(side);
    this.hud.turnStart(side, p, rep, this.flags);
    this.refreshHud();
    if (rep.lost) { this.gameOver(1 - side, rep.lost); return; }
    this.setPhase('start');
  }

  setPhase(ph) {
    this.phase = ph;
    this.phaseT = 0;
    const side = this.turn, p = this.players[side];
    if (ph === 'shop') {
      this.camGoal = { ...OVERVIEW, x: worldX(side, 0) * 0.25 };
      if (p.type === 'human') this.hud.showShop(side, this.shopInfo(side));
      else this.aiQueue = aiShop(p, this.players[1 - side], this.market, this.castles[side], this.rnd);
    } else if (ph === 'aim') {
      this.hud.hideShop();
      const why = this.cantShoot(side);
      if (why) { this.hud.toast(why, 'bad', 2.6); this.setPhase('after'); this.skipShot = true; return; }
      this.skipShot = false;
      this.camGoal = { ...OVERVIEW };
      const last = this.lastAim[side];
      const slot0 = last && p.catapults[last.slot] ? last.slot : p.catapults.findIndex(Boolean);
      this.aimState = { slot: slot0, ammo: last && p.ammo[last.ammo] > 0 ? last.ammo : AMMO_ORDER.find((k) => p.ammo[k] > 0), angle: last ? last.angle : 50, power: last ? last.power : 0.62 };
      this.loadSpoon();
      if (p.type === 'human') this.hud.showAim(side, this.aimState, p);
      else { this.aiPlan = null; this.aiThink = 0.7; }
      if (this.ghost[side]) this.ghostDots.show(this.ghost[side]); else this.ghostDots.hide();
    } else if (ph === 'after') {
      this.hud.hideAim();
      this.preview.hide();
    }
  }

  cantShoot(side) {
    const p = this.players[side];
    if (this.flags.dinner) return 'Dinner time: no shooting this round.';
    if (p.sulkSkip) return `${P.TEAM[side].name}'s toys are sulking. No shot this turn!`;
    if (E.crewed(p) < 1) return 'Nobody to work the catapult!';
    if (!AMMO_ORDER.some((k) => p.ammo[k] > 0)) return 'Out of ammo! Nothing to throw this turn.';
    return null;
  }

  shopInfo(side) {
    const p = this.players[side], c = this.castles[side];
    const missing = c.missing().length;
    return {
      missing, flagDown: p.flagDown, rebuildCost: this.rebuildCost(side),
      piggySlot: p.piggies.findIndex((g) => !g.built), canCatapult: !p.catapults[1],
      income: E.income(p), market: this.market,
    };
  }
  rebuildCost(side) { const p = this.players[side], n = this.castles[side].missing().length; return n || p.flagDown ? this.market.blockCost(n) + (p.flagDown ? 2 : 0) : 0; }

  // a shop action by the player whose turn it is: returns a message or null if it couldn't be done
  act(a) {
    const side = this.turn, p = this.players[side], c = this.castles[side], m = this.market;
    if (this.phase !== 'shop') return null;
    let msg = null;
    if (a.do === 'chores') { p.chores = a.level; msg = `Chores: ${E.CHORES[a.level].name}`; this.sound.click(); }
    else if (a.do === 'buy') {
      const price = m.price(a.item);
      if (!E.spend(p, price)) { this.sound.nope(); return null; }
      p.stats.spent += price;
      if (a.item === 'snack') p.snacks++;
      else if (a.item === 'glue') { p.glue = E.RULES.glueShots; c.setGlue(true); this.glueFx(side); }
      else p.ammo[a.item]++;
      m.bought(a.item);
      this.stall.bump(a.item);
      this.sound.till();
      msg = `Bought ${E.GOODS[a.item].name.toLowerCase()} for ${price}`;
    } else if (a.do === 'sell') {
      const have = a.item === 'snack' ? p.snacks : p.ammo[a.item];
      const price = m.sellPrice(a.item);
      if (!have || price <= 0) { this.sound.nope(); return null; }
      if (a.item === 'snack') p.snacks--; else p.ammo[a.item]--;
      p.pocket += price;
      m.sold(a.item);
      this.stall.bump(a.item);
      this.sound.coins(2);
      msg = `Sold ${E.GOODS[a.item].name.toLowerCase()} for ${price}`;
    } else if (a.do === 'piggy') {
      const slot = a.slot ?? p.piggies.findIndex((g) => !g.built);
      if (slot < 0 || p.piggies[slot].built || !E.spend(p, E.RULES.piggyPrice)) { this.sound.nope(); return null; }
      p.stats.spent += E.RULES.piggyPrice;
      p.piggies[slot] = { built: true, savings: 0 };
      c.addPiggy(slot);
      this.sound.pop(); this.sound.coins(3);
      msg = `New piggy bank (${SLOTS.piggies[slot].name.toLowerCase()})`;
    } else if (a.do === 'catapult') {
      if (p.catapults[1] || !E.spend(p, E.RULES.catapultPrice)) { this.sound.nope(); return null; }
      p.stats.spent += E.RULES.catapultPrice;
      p.catapults[1] = true;
      c.addCatapult(1);
      this.sound.pop();
      msg = 'A second catapult, at the back';
    } else if (a.do === 'rebuild') {
      const missing = c.missing(), cost = this.rebuildCost(side);
      if ((!missing.length && !p.flagDown) || !E.spend(p, cost)) { this.sound.nope(); return null; }
      p.stats.spent += cost;
      const flagToo = p.flagDown;
      c.rebuild(missing, { flag: flagToo });
      m.bought('block', missing.length);
      if (flagToo) { p.flagDown = false; p.morale = Math.min(100, p.morale + 4); }
      if (c.glued) c.setGlue(true);
      this.sound.pick();
      msg = `Rebuilt ${missing.length} block${missing.length === 1 ? '' : 's'}${flagToo ? ' and the flag' : ''}`;
    }
    this.refreshHud();
    if (p.type === 'human') this.hud.showShop(side, this.shopInfo(side));
    return msg;
  }
  glueFx(side) {
    for (const b of this.castles[side].blocks) if (b && b.world && this.rnd() < 0.3) this.particles.emit(b.position.x, b.position.y + 2, 4, { color: 0xfffbe8, n: 2, size: 1.2, life: 1, spread: 2, up: 4, grav: 10, alpha: 0.9 });
  }

  shopDone() { if (this.phase === 'shop') { this.sound.click(); this.setPhase('aim'); } }

  // ---------- aiming ----------
  loadSpoon() {
    for (let s = 0; s < 2; s++) for (let slot = 0; slot < 2; slot++) { const cv = this.catapultView(s, slot); if (cv) { cv.ammo.clear(); cv.pull(0); } }
    if (!this.aimState || !this.aimState.ammo) return;
    const cv = this.catapultView(this.turn, this.aimState.slot);
    if (cv) { const m = P.ammoMesh(this.aimState.ammo); cv.ammo.add(m); }
  }
  setAim(change) {
    if (this.phase !== 'aim' || !this.aimState) return;
    const a = this.aimState, p = this.players[this.turn];
    if (change.angle != null) a.angle = clamp(change.angle, ANGLE_MIN, ANGLE_MAX);
    if (change.power != null) a.power = clamp(change.power, 0, 1);
    if (change.ammo && p.ammo[change.ammo] > 0) { a.ammo = change.ammo; this.loadSpoon(); this.sound.click(); }
    if (change.slot != null && p.catapults[change.slot]) { a.slot = change.slot; this.loadSpoon(); this.sound.click(); }
    if (change.power != null) this.sound.stretch(a.power);
    if (p.type === 'human') this.hud.updateAim(a, p);
  }
  cycleAmmo(dir = 1) {
    const p = this.players[this.turn], list = AMMO_ORDER.filter((k) => p.ammo[k] > 0);
    if (!list.length) return;
    const i = list.indexOf(this.aimState.ammo);
    this.setAim({ ammo: list[(i + dir + list.length) % list.length] });
  }
  cycleCatapult() {
    const p = this.players[this.turn];
    if (!p.catapults[1]) { this.hud.toast('Only one catapult: build a back catapult in the shop', 'info', 2); return; }
    this.setAim({ slot: 1 - this.aimState.slot });
  }

  fire() {
    if (this.phase !== 'aim' || !this.aimState || !this.aimState.ammo) return;
    const side = this.turn, p = this.players[side], a = this.aimState, c = this.castles[side];
    if (!(p.ammo[a.ammo] > 0)) return;
    p.ammo[a.ammo]--;
    p.stats.shots++;
    this.lastAim[side] = { ...a };
    const [lx, ly] = c.launch(a.slot);
    const [vx, vy] = launchVelocity(a.angle, a.power, c.dir);
    const body = this.phys.addProjectile(a.ammo, lx, ly, vx, vy);
    const mesh = P.ammoMesh(a.ammo);
    this.dynamic.add(mesh);
    mesh.position.set(lx, ly, 0);
    this.shot = { body, mesh, side, t: 0, landed: null, path: [[lx, ly]] };
    this.shotLog = {
      standing: this.castles.map((k) => k.standing()), flags: this.castles.map((k) => k.flagUp()),
      piggies: [new Set(), new Set()],
    };
    const cv = this.catapultView(side, a.slot);
    if (cv) { cv.fire(); cv.ammo.clear(); }
    this.sound.twang(a.power);
    this.sound.whoosh(0.5 + a.power);
    this.hud.hideAim();
    this.hud.hideShop();
    this.preview.hide();
    this.ghostDots.hide();
    this.refreshHud();
    this.setPhase('flight');
  }

  // ---------- after a shot ----------
  afterShot() {
    const log = this.shotLog;
    this.shotLog = null;
    const shooter = this.players[this.turn];
    // pieces that tipped over count as broken too
    for (let s = 0; s < 2; s++) {
      const c = this.castles[s];
      c.piggies.forEach((g, slot) => { if (g && !c.piggyOk(slot)) { this.smashPiggy(g); log.piggies[s].add(slot); } });
    }
    const lines = [];
    for (let s = 0; s < 2; s++) {
      const p = this.players[s], c = this.castles[s];
      const lost = Math.max(0, log.standing[s] - c.standing());
      const flagFell = log.flags[s] && !c.flagUp();
      const out = E.takeDamage(p, s === this.turn ? null : shooter, { blocks: lost, piggies: [...log.piggies[s]], flagFell });
      if (lost) lines.push({ text: `${P.TEAM[s].name} lost ${lost} block${lost === 1 ? '' : 's'}${s === this.turn ? ' (own goal!)' : ''}`, tone: s === this.turn ? 'bad' : 'good' });
      lines.push(...out);
      // glue wears off with each enemy shot
      if (s !== this.turn && p.glue > 0) { p.glue--; if (!p.glue) c.setGlue(false); }
    }
    if (!lines.length) lines.push({ text: 'Missed!', tone: 'info' });
    for (const l of lines) this.hud.toast(l.text, l.tone, 2.6);
    if (this.shot) this.ghost[this.turn] = this.shot.path;
    this.refreshHud();
  }

  endTurn() {
    if (this.over) return;
    if (this.shot) { this.phys.remove(this.shot.body); this.puff(this.shot.mesh.position.x, this.shot.mesh.position.y, 0, 0xffffff, 6); this.dynamic.remove(this.shot.mesh); this.shot = null; }
    for (const b of [...this.phys.projectiles]) this.phys.remove(b);
    E.deposit(this.players[this.turn]);
    this.refreshHud();
    if (this.turn === 0) this.startTurn(1);
    else this.nextRound();
  }

  gameOver(winner, reason) {
    if (this.over) return;
    if (this.shotLog && this.shot) this.afterShot();
    this.over = { winner, reason, round: this.round };
    this.phase = 'over';
    this.hud.hideShop(); this.hud.hideAim(); this.preview.hide(); this.ghostDots.hide();
    this.sound.stopMusic(0.4);
    if (reason === 'teddy') this.sound.aww();
    setTimeout(() => this.sound.fanfare(), 1200);
    const loser = 1 - winner;
    if (reason === 'mutiny') for (let k = 0; k < 6; k++) setTimeout(() => this.walkOver(loser, null), k * 250);
    this.camGoal = { x: worldX(loser, -14), y: 20, width: 150, pitch: 0.22 };
    this.overT = 0;
    this.confetti(worldX(winner, -14), 50, 0, 60);
  }

  // ---------- kitchen events ----------
  startEvent(key) {
    const ev = EVENTS[key];
    this.event = { key, t: 0 };
    this.phase = 'event';
    this.phaseT = 0;
    let text = ev.text;
    if (key === 'dinner') { this.flags.dinner = true; this.sound.bell(); }
    else if (key === 'grandma') { this.flags.grandma = true; this.sound.sparkle(); }
    else if (key === 'clean') { this.flags.clean = true; this.sound.kazoo(60, 0.3); this.sound.kazoo(55, 0.5, 0.3); }
    else if (key === 'gust') { this.flags.gust = true; this.sound.whoosh(1.5); }
    else if (key === 'fairy') {
      const s = this.rnd() < 0.5 ? 0 : 1;
      this.players[s].pocket += 5;
      text = `${P.TEAM[s].name} finds 5 coins under a pillow.`;
      this.coins.rain(worldX(s, 0), 50, 0, 6);
      this.sound.sparkle();
    } else if (key === 'sister') {
      const s = this.rnd() < 0.5 ? 0 : 1, c = this.castles[s];
      const pick = c.plan.map((p, i) => i).filter((i) => c.intact(i) && c.plan[i].part === 'wall' && c.plan[i].y >= 12);
      if (pick.length) {
        const i = pick[Math.floor(this.rnd() * pick.length)];
        const b = c.blocks[i], v = this.visuals.get(b);
        const mesh = v.obj;
        this.visuals.delete(b);
        this.phys.remove(b);
        c.blocks[i] = null;
        this.phys.wakeAll();
        this.thief = { mesh, t: 0, from: mesh.position.clone() };
        text = `She takes one off ${P.TEAM[s].name}'s wall. Cheeky!`;
      } else text = 'She looks around, but finds nothing she likes.';
      this.sound.kazoo(72, 0.2); this.sound.kazoo(76, 0.3, 0.2);
    } else if (key === 'cat') {
      // she steps over one castle's wall and swats a few blocks off the top on the way, or she
      // strolls down the middle of the table
      const s = this.rnd() < 0.5 ? 0 : 1, onWall = this.rnd() < 0.62;
      const x = onWall ? worldX(s, 30 + this.rnd() * 12) : (this.rnd() - 0.5) * 60;
      const view = P.walkingCat();
      view.group.scale.setScalar(0.72);
      view.group.position.set(x, 0, -110);
      this.dynamic.add(view.group);
      this.cat = { view, x, z: -110, speed: 26, side: onWall ? s : null, swatted: false, t: 0, standing: this.castles.map((k) => k.standing()), flags: this.castles.map((k) => k.flagUp()) };
      this.shotLog = { standing: this.cat.standing, flags: this.cat.flags, piggies: [new Set(), new Set()] };
      this.sound.meow();
      this.camGoal = { x, y: 24, width: 230, pitch: 0.24 };
    }
    this.hud.banner(ev.title, text, 'event', key === 'cat' ? 3 : 3.2);
    this.refreshHud();
  }

  updateEvent(dt) {
    const ev = this.event;
    ev.t += dt;
    if (this.cat) {
      const c = this.cat;
      c.t += dt;
      c.z += c.speed * dt;
      c.view.group.position.z = c.z;
      c.view.update(dt, c.speed, this.time);
      this.camGoal.x = c.x;
      if (c.t > 1.5 && c.t < 1.6) this.sound.purr(1.5);
      if (!c.swatted && c.z > -8) { c.swatted = true; if (c.side != null) this.catSwat(c.side, c.x); }
      if (c.z > 120) {
        this.dynamic.remove(c.view.group);
        this.cat = null;
        ev.catDone = ev.t;
      }
      return;
    }
    if (this.thief) {
      const th = this.thief;
      th.t += dt;
      th.mesh.position.set(th.from.x + Math.sin(th.t * 2) * 6, th.from.y + th.t * th.t * 30, th.from.z + th.t * 40);
      th.mesh.rotation.x += dt * 3;
      if (th.t > 2.2) { this.dynamic.remove(th.mesh); this.thief = null; }
    }
    const wait = ev.catDone != null ? ev.catDone + 1.5 : 3.4;
    if (ev.t > wait && this.phys.settled()) {
      if (ev.catDone != null || ev.key === 'sister') {
        const log = this.shotLog || { standing: [0, 0], flags: [true, true], piggies: [new Set(), new Set()] };
        if (ev.key === 'sister' && !this.shotLog) log.standing = this.castles.map((k) => k.standing() + 0);
        this.shotLog = null;
        for (let s = 0; s < 2; s++) {
          const c = this.castles[s];
          c.piggies.forEach((g, slot) => { if (g && !c.piggyOk(slot)) { this.smashPiggy(g); log.piggies[s].add(slot); } });
          const lost = ev.key === 'cat' ? Math.max(0, log.standing[s] - c.standing()) : 0;
          const out = E.takeDamage(this.players[s], null, { blocks: lost, piggies: [...log.piggies[s]], flagFell: log.flags[s] && !c.flagUp() });
          if (lost) this.hud.toast(`The cat knocked ${lost} block${lost === 1 ? '' : 's'} off ${P.TEAM[s].name}'s castle`, 'info', 2.6);
          for (const l of out) this.hud.toast(l.text, l.tone, 2.6);
        }
      }
      this.event = null;
      this.refreshHud();
      this.startTurn(0);
    }
  }

  // a paw (or a tail) knocks the top blocks of a wall off the table's edge side
  catSwat(side, x) {
    const c = this.castles[side];
    const top = c.blocks.filter((b, i) => b && b.world && c.intact(i) && Math.abs(b.position.x - x) < 12 && c.plan[i].y >= 12).sort((a, b) => b.position.y - a.position.y);
    const n = Math.min(top.length, 2 + Math.floor(this.rnd() * 3));
    for (const b of top.slice(0, n)) {
      b.wakeUp();
      b.velocity.set((this.rnd() - 0.5) * 20, 20 + this.rnd() * 20, 40 + this.rnd() * 25);
      b.angularVelocity.set((this.rnd() - 0.5) * 8, (this.rnd() - 0.5) * 8, (this.rnd() - 0.5) * 8);
    }
    this.phys.wakeAll();
    this.sound.meow();
  }

  // ---------- the frame ----------
  simulate(sec) {
    let t = 0;
    while (t < sec - 1e-6) { const d = Math.min(1 / 60, sec - t); this.update(d); t += d; }
  }

  update(dt) {
    this.dtFrame = dt;
    this.time += dt;
    if (!this.phys) { this.applyCamera(); return; }
    if (this.paused) { this.applyCamera(); return; }
    this.phaseT += dt;
    // physics runs all the time: rebuilt blocks settle, the cat pushes things
    this.phys.update(dt);
    this.syncVisuals(dt);
    this.updateSoldiers(dt);
    this.room.update(this.time, dt, this.wind);
    this.stall.update(this.time, dt);
    this.particles.update(dt);
    this.coins.update(dt);
    this.sound.setWind(Math.abs(this.wind) / WIND_MAX * (this.phase === 'over' ? 0 : 1));
    if (this.pendingPiggies && !this.shotLog) {
      for (const [s, slot] of this.pendingPiggies) for (const l of E.takeDamage(this.players[s], null, { piggies: [slot] })) this.hud.toast(l.text, l.tone, 2.6);
      this.pendingPiggies = null;
      this.refreshHud();
    }
    // a teddy that leaves his throne loses, whenever it happens
    if (!this.over && this.phase !== 'intro' && this.phase !== 'showcase') {
      for (let s = 0; s < 2; s++) {
        const c = this.castles[s];
        c.teddyDown = c.teddyOk() ? 0 : (c.teddyDown || 0) + dt;
        if (c.teddyDown > 0.6) { this.gameOver(1 - s, s === this.turn && this.phase === 'flight' ? 'owngoal' : 'teddy'); break; }
      }
    }
    switch (this.phase) {
      case 'showcase':
        this.camGoal = { x: Math.sin(this.time * 0.09) * 70, y: 24 + Math.sin(this.time * 0.13) * 4, width: 250 + Math.sin(this.time * 0.07) * 50, pitch: 0.2 + Math.sin(this.time * 0.11) * 0.05 };
        break;
      case 'intro':
        this.camGoal = { ...OVERVIEW };
        if (this.phaseT > (this.cinematics ? 2.6 : 0.01)) { this.hud.showHud(); this.nextRound(); }
        break;
      case 'start':
        if (this.phaseT > (this.players[this.turn].type === 'human' ? 1.4 : 1.1) || this.skipStart) { this.skipStart = false; this.setPhase('shop'); }
        break;
      case 'shop':
        if (this.players[this.turn].type !== 'human') this.aiShopStep(dt);
        break;
      case 'aim':
        if (this.players[this.turn].type === 'human') this.humanAim(dt);
        else this.aiAimStep(dt);
        if (this.phase === 'aim') this.updatePreview();
        break;
      case 'flight': this.updateFlight(dt); break;
      case 'after':
        if (this.phaseT > (this.skipShot ? 2.2 : 1.6)) this.endTurn();
        break;
      case 'event': this.updateEvent(dt); break;
      case 'over':
        this.overT += dt;
        if (this.overT > 3.2 && !this.overShown) { this.overShown = true; if (this.onOver) this.onOver(this.over); }
        break;
    }
    this.applyCamera();
  }

  // the computer kid shops one thing at a time (so the till rings), then says what it did
  aiShopStep(dt) {
    this.aiT = (this.aiT || 0) + dt;
    if (this.aiT < 0.4) return;
    this.aiT = 0;
    const a = this.aiQueue && this.aiQueue.shift();
    if (!this.aiDone) this.aiDone = [];
    if (!a) {
      const s = summarize(this.aiDone);
      if (s) this.hud.toast(`${P.TEAM[this.turn].name} ${s}`, 'info', 2.6);
      this.aiDone = null;
      this.setPhase('aim');
      return;
    }
    if (this.act(a)) this.aiDone.push(a);
  }

  humanAim(dt) {
    const k = this.keys, a = this.aimState;
    let da = 0, dp = 0;
    if (k.has('ArrowUp') || k.has('KeyW')) da += 1;
    if (k.has('ArrowDown') || k.has('KeyS')) da -= 1;
    if (k.has('ArrowRight') || k.has('KeyD')) dp += 1;
    if (k.has('ArrowLeft') || k.has('KeyA')) dp -= 1;
    const fine = k.has('ShiftLeft') || k.has('ShiftRight') ? 0.25 : 1;
    if (da || dp) this.setAim({ angle: a.angle + da * 28 * dt * fine, power: a.power + dp * 0.4 * dt * fine });
    const cv = this.catapultView(this.turn, a.slot);
    if (cv) cv.pull(a.power);
  }

  aiAimStep(dt) {
    const side = this.turn, p = this.players[side];
    if (!this.aiPlan) {
      this.aiThink -= dt;
      if (this.aiThink > 0) return;
      this.aiPlan = aiAim(p, this.castles[side], this.castles[1 - side], this.phys, this.wind, this.rnd, p.skill);
      if (!this.aiPlan) { this.hud.toast('Nothing to throw!', 'info'); this.skipShot = true; this.setPhase('after'); return; }
      this.aiFrom = { ...this.aimState };
      this.aiT = 0;
      if (this.aiPlan.ammo !== this.aimState.ammo || this.aiPlan.slot !== this.aimState.slot) { this.aimState.ammo = this.aiPlan.ammo; this.aimState.slot = this.aiPlan.slot; this.loadSpoon(); }
    }
    this.aiT += dt;
    const k = clamp(this.aiT / 1.3, 0, 1), e = k * k * (3 - 2 * k);
    this.aimState.angle = lerp(this.aiFrom.angle, this.aiPlan.angle, e);
    this.aimState.power = lerp(this.aiFrom.power, this.aiPlan.power, e);
    const cv = this.catapultView(side, this.aimState.slot);
    if (cv) cv.pull(this.aimState.power);
    if (this.aiT > 1.7) this.fire();
  }

  updatePreview() {
    const a = this.aimState;
    if (!a || !a.ammo) { this.preview.hide(); return; }
    const c = this.castles[this.turn];
    const [lx, ly] = c.launch(a.slot);
    const f = flight(lx, ly, a.angle, a.power, c.dir, a.ammo, this.wind, { tMax: 3, every: 3 });
    // only the first part of the flight is shown: the rest is up to you
    const T = f.t * 0.38;
    this.preview.show(f.pts.filter((q) => q[2] <= T));
  }

  updateFlight(dt) {
    const s = this.shot;
    if (!s) { this.setPhase('after'); return; }
    s.t += dt;
    const b = s.body;
    if (b.world) { s.mesh.position.copy(b.position); s.mesh.quaternion.copy(b.quaternion); if (b.userData.flying) s.path.push([b.position.x, b.position.y]); }
    if (!b.userData.flying && s.landed == null) s.landed = s.t;
    // the camera follows it, then watches what it did
    const x = b.world ? b.position.x : s.mesh.position.x, y = b.world ? b.position.y : 0;
    if (s.landed == null) this.camGoal = { x: clamp(x, -150, 150), y: Math.max(26, y * 0.7 + 8), width: 210, pitch: 0.18 };
    else this.camGoal = { x: clamp(this.camGoal.x, -150, 150), y: 24, width: 230, pitch: 0.2 };
    const done = (s.landed != null && (this.phys.settled() || s.t - s.landed > SETTLE_MAX)) || s.t > FLIGHT_MAX || !b.world;
    if (done) { this.afterShot(); this.setPhase('after'); }
  }

  // ---------- camera ----------
  applyCamera(snap = false) {
    const c = this.camera, g = this.camGoal;
    const r = snap ? 1 : 1 - Math.exp(-2.6 * (this.dtFrame || 0.016));
    for (const k of ['x', 'y', 'width', 'pitch']) c[k] = lerp(c[k], g[k], r);
    c.z = lerp(c.z || 0, g.z || 0, r);
    // narrow (portrait) screens see less across: keep the castles big enough
    const aspect = this.R.camera.aspect || 1.6;
    const width = aspect < 1.2 ? c.width * Math.max(0.62, aspect / 1.2) : c.width;
    this.R.orbit(c.x, c.y, c.z, { yaw: 0, pitch: c.pitch, width, shadowSpan: 420 });
    this.R.setFocus(0.48, 0.3, 0.75);
  }

  // ---------- input ----------
  keyDown(e) {
    this.keys.add(e.code);
    if (this.phase === 'aim' && this.players[this.turn].type === 'human') {
      if (e.code === 'Space' || e.code === 'Enter' || e.code === 'NumpadEnter') { e.preventDefault(); this.fire(); return true; }
      if (e.code === 'Tab' || e.code === 'KeyQ') { e.preventDefault(); this.cycleAmmo(e.shiftKey ? -1 : 1); return true; }
      if (e.code === 'KeyE') { this.cycleAmmo(1); return true; }
      if (e.code === 'KeyC') { this.cycleCatapult(); return true; }
      if (e.code === 'KeyB') { this.backToShop(); return true; }
      if (e.code.startsWith('Arrow')) { e.preventDefault(); return true; }
    }
    if (this.phase === 'shop' && this.players[this.turn].type === 'human' && (e.code === 'Enter' || e.code === 'NumpadEnter')) { this.shopDone(); return true; }
    if (this.phase === 'start' && (e.code === 'Enter' || e.code === 'Space')) { this.skipStart = true; return true; }
    return false;
  }
  keyUp(e) { this.keys.delete(e.code); }
  backToShop() { if (this.phase === 'aim' && this.players[this.turn].type === 'human') { this.hud.hideAim(); this.preview.hide(); this.loadSpoon(); this.setPhase('shop'); } }

  // slingshot drag on the table: pull back and down to aim up and forward
  pointerDown(x, y) {
    if (this.phase === 'start') { this.skipStart = true; return; }
    if (this.phase !== 'aim' || this.players[this.turn].type !== 'human') return;
    this.drag = { x, y, angle: this.aimState.angle, power: this.aimState.power, moved: false };
  }
  pointerMove(x, y) {
    const d = this.drag;
    if (!d) return;
    const dx = d.x - x, dy = y - d.y, len = Math.hypot(dx, dy);
    if (len < 12 && !d.moved) return;
    d.moved = true;
    const dir = this.castles[this.turn].dir;
    const ang = (Math.atan2(dy, dx * dir) * 180) / Math.PI;
    const scale = Math.min(window.innerWidth, window.innerHeight) * 0.42;
    this.setAim({ angle: ang, power: len / scale });
  }
  pointerUp() { this.drag = null; }

  refreshHud() {
    if (!this.players) return;
    this.players.forEach((p, s) => this.hud.setCastle(s, p, { standing: this.castles[s].standing(), total: this.castles[s].plan.length, glued: p.glue }));
    this.hud.setWind(this.wind);
  }
}

// "buys 2 snacks and a marble, builds a piggy bank"
function summarize(acts) {
  const n = {};
  for (const a of acts) { const k = a.do === 'buy' || a.do === 'sell' ? `${a.do}:${a.item}` : a.do === 'chores' ? `chores:${a.level}` : a.do; n[k] = (n[k] || 0) + 1; }
  const word = (item, c) => { const w = E.GOODS[item].name.toLowerCase(); return c === 1 ? `${item === 'eraser' ? 'an' : 'a'} ${w}` : `${c} ${w}${w.endsWith('s') ? '' : 's'}`; };
  const buys = [], sells = [], other = [];
  for (const k in n) {
    const [d, it] = k.split(':');
    if (d === 'buy') buys.push(word(it, n[k]));
    else if (d === 'sell') sells.push(word(it, n[k]));
    else if (d === 'chores') other.push(`sets chores to ${E.CHORES[+it].name}`);
    else if (d === 'piggy') other.push('builds a piggy bank');
    else if (d === 'catapult') other.push('builds a back catapult');
    else if (d === 'rebuild') other.push('rebuilds the castle');
    else if (d === 'glue') other.push('glues the castle');
  }
  const parts = [];
  if (buys.length) parts.push('buys ' + list(buys));
  if (sells.length) parts.push('sells ' + list(sells));
  parts.push(...other);
  return parts.length ? parts.join(', ') : 'saves its money';
}
const list = (a) => (a.length < 2 ? a.join('') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1]);

// ---------- little things on the table ----------
// The aiming preview and the last shot's path: a row of soft dots.
class Dots {
  constructor(group, color, max, size, opacity = 0.95) {
    this.max = max;
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(max * 3);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    const c = document.createElement('canvas'); c.width = c.height = 32;
    const x = c.getContext('2d'); x.fillStyle = '#fff'; x.beginPath(); x.arc(16, 16, 11, 0, Math.PI * 2); x.fill();
    x.lineWidth = 4; x.strokeStyle = 'rgba(31,26,23,0.95)'; x.stroke();
    const tex = new THREE.CanvasTexture(c);
    this.points = new THREE.Points(g, new THREE.PointsMaterial({ color, size: size * 2.2, map: tex, transparent: true, opacity, depthWrite: false, depthTest: false, sizeAttenuation: true, toneMapped: false }));
    this.points.frustumCulled = false;
    this.points.renderOrder = 6;
    this.points.visible = false;
    group.add(this.points);
  }
  show(pts) {
    const n = Math.min(this.max, pts.length);
    const step = pts.length > this.max ? pts.length / this.max : 1;
    for (let i = 0; i < n; i++) { const q = pts[Math.floor(i * step)]; this.pos[i * 3] = q[0]; this.pos[i * 3 + 1] = q[1]; this.pos[i * 3 + 2] = 0.5; }
    this.points.geometry.setDrawRange(0, n);
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.visible = n > 1;
  }
  hide() { this.points.visible = false; }
}

// Gold coins hopping about: income raining into a castle, a smashed piggy bank's savings.
class Coins {
  constructor(group, max = 80) {
    const geo = new THREE.CylinderGeometry(1.1, 1.1, 0.3, 16);
    this.mesh = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ color: 0xf2c230, metalness: 1, roughness: 0.25 }), max);
    this.mesh.castShadow = true;
    this.mesh.frustumCulled = false;
    group.add(this.mesh);
    this.list = [];
    this.max = max;
    this.m4 = new THREE.Matrix4(); this.q = new THREE.Quaternion(); this.e = new THREE.Euler(); this.v = new THREE.Vector3(); this.s = new THREE.Vector3();
    this.clear();
  }
  clear() { this.list = []; this.mesh.count = 0; }
  add(c) { if (this.list.length >= this.max) this.list.shift(); this.list.push(c); }
  burst(x, y, z, n) { for (let i = 0; i < n; i++) this.add({ x, y, z, vx: (Math.random() - 0.5) * 70, vy: 40 + Math.random() * 50, vz: (Math.random() - 0.2) * 40, r: Math.random() * 6, spin: 8 + Math.random() * 10, life: 2.5 + Math.random(), t: 0 }); }
  rain(x, y, z, n) { for (let i = 0; i < n; i++) this.add({ x: x + (Math.random() - 0.5) * 8, y: y + 40 + i * 4, z: z + (Math.random() - 0.5) * 6, vx: 0, vy: -20, vz: 0, r: Math.random() * 6, spin: 10, life: 1.4 + i * 0.05, t: 0, sink: y }); }
  update(dt) {
    let k = 0;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const c = this.list[i];
      c.t += dt;
      if (c.t > c.life) { this.list.splice(i, 1); continue; }
      c.vy -= 160 * dt;
      c.x += c.vx * dt; c.y += c.vy * dt; c.z += c.vz * dt; c.r += c.spin * dt;
      const floor = c.sink != null ? c.sink : 0.2;
      if (c.y < floor) { if (c.sink != null) { c.t = c.life; continue; } c.y = floor; c.vy *= -0.35; c.vx *= 0.6; c.vz *= 0.6; c.spin *= 0.6; }
    }
    for (const c of this.list) {
      const sc = Math.min(1, (c.life - c.t) * 3);
      this.e.set(c.r, c.r * 0.7, 0);
      this.m4.compose(this.v.set(c.x, c.y, c.z), this.q.setFromEuler(this.e), this.s.set(sc, sc, sc));
      this.mesh.setMatrixAt(k++, this.m4);
    }
    this.mesh.count = k;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

