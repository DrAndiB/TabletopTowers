// The computer kids: what they buy, and where they shoot. Aiming tries a grid of angles and strengths
// through the same flight model as the game, against the boxes of everything on the table, and picks
// the shot whose first touch is closest to what it wants to hit; then a hand that shakes a little.
import { flight, closestApproach, ANGLE_MIN, ANGLE_MAX } from './ballistics.js';
import { RULES, wealth, snacksNeeded } from './economy.js';

export const PERSONALITIES = {
  hoarder: { name: 'Hoarder', blurb: 'Fills piggy banks and shoots at yours.' },
  warmonger: { name: 'Warmonger', blurb: 'Works the toys hard and buys marbles.' },
  sweetheart: { name: 'Sweetheart', blurb: 'Keeps the toys happy, so yours walk over.' },
};
export const SKILLS = {
  easy: { name: 'Easy', angle: 3.6, power: 0.06, wind: 0.6 },
  normal: { name: 'Normal', angle: 1.8, power: 0.028, wind: 0.25 },
  hard: { name: 'Hard', angle: 0.7, power: 0.012, wind: 0.05 },
};

// ---------- shopping ----------
// Returns a list of actions [{do: 'chores'|'buy'|'sell'|'piggy'|'catapult'|'rebuild'|'tape'|'box', ...}]
// that the game carries out one by one (so they can be shown).
export function shop(me, enemy, market, castle, rnd) {
  const P = me.personality, acts = [];
  let money = wealth(me);
  const reserve = 4;
  const can = (n) => money - n >= 0;
  const pay = (n) => { money -= n; };
  // chores
  let ch = 1;
  if (P === 'hoarder') ch = me.morale > 66 ? 2 : me.morale > 45 ? 1 : 0;
  else if (P === 'warmonger') ch = me.morale > 58 ? 3 : me.morale > 42 ? 2 : me.morale > 30 ? 1 : 0;
  else ch = me.morale < 58 ? 0 : me.morale < 84 ? 1 : 2;
  if (ch !== me.chores) acts.push({ do: 'chores', level: ch });
  // snacks: hungry toys sulk
  const want = snacksNeeded(me) * (P === 'sweetheart' ? 3 : 2);
  let s = me.snacks;
  while (s < want && can(market.price('snack'))) { acts.push({ do: 'buy', item: 'snack' }); pay(market.price('snack')); s++; }
  // the flag first, then the walls
  const missing = castle.missing().length;
  const flagDown = me.flagDown;
  if (missing || flagDown) {
    const cost = market.blockCost(missing) + (flagDown ? 2 : 0);
    const budget = P === 'hoarder' ? 0.35 : P === 'warmonger' ? 0.3 : 0.5;
    if ((missing >= 3 || flagDown) && can(cost) && cost <= money * budget + 6) { acts.push({ do: 'rebuild' }); pay(cost); }
  }
  // cardboard: a torn keep box first, then tape on the worst dents, then the box for the wall
  me.boxes.forEach((g, slot) => {
    if (g.built || slot === 2) return;
    if (can(RULES.boxPrice)) { acts.push({ do: 'box', slot }); pay(RULES.boxPrice); }
  });
  // one strip of tape on each dented box (the game tapes the most dented one first)
  const dented = me.boxes.filter((g) => g.built && g.hp < RULES.boxHp).length;
  for (let k = 0; k < dented; k++) if (can(RULES.tapePrice + reserve)) { acts.push({ do: 'tape' }); pay(RULES.tapePrice); }
  if (!me.boxes[2].built && P !== 'warmonger' && money >= RULES.boxPrice + 16) { acts.push({ do: 'box', slot: 2 }); pay(RULES.boxPrice); }
  // piggy banks and a second catapult
  const empty = me.piggies.findIndex((g) => !g.built);
  if (empty >= 0) {
    const builtN = me.piggies.filter((g) => g.built).length;
    const keen = P === 'hoarder' ? RULES.piggyPrice + reserve : builtN === 0 ? RULES.piggyPrice + 2 : P === 'sweetheart' && builtN < 2 ? 24 : 34;
    if (money >= keen) { acts.push({ do: 'piggy', slot: empty }); pay(RULES.piggyPrice); }
  }
  if (!me.catapults[1] && P === 'warmonger' && money >= RULES.catapultPrice + 12 && me.toys >= 6) { acts.push({ do: 'catapult', slot: 1 }); pay(RULES.catapultPrice); }
  // ammo
  const stock = { ...me.ammo };
  const target = P === 'warmonger' ? { marble: 3, eraser: 1, paper: 2 } : P === 'hoarder' ? { paper: 5, eraser: 2, marble: 0 } : { eraser: 3, paper: 3, marble: 1 };
  const spendCap = P === 'hoarder' ? 0.3 : P === 'warmonger' ? 0.75 : 0.5;
  let budget = Math.max(4, money * spendCap);
  for (const k of ['marble', 'eraser', 'paper']) {
    while (stock[k] < target[k] && budget >= market.price(k) && can(market.price(k))) { acts.push({ do: 'buy', item: k }); pay(market.price(k)); budget -= market.price(k); stock[k]++; }
  }
  if (!stock.paper && !stock.eraser && !stock.marble && can(market.price('paper'))) acts.push({ do: 'buy', item: 'paper' });
  // a hoarder sells surplus paper when it's dear
  if (P === 'hoarder' && stock.paper > 7 && market.sellPrice('paper') >= 1) acts.push({ do: 'sell', item: 'paper' });
  return acts;
}

// ---------- aiming ----------
function pickAmmo(me, target) {
  const A = me.ammo, P = me.personality;
  const order = P === 'warmonger' ? ['marble', 'eraser', 'paper'] : P === 'hoarder' ? (target.kind === 'teddy' ? ['eraser', 'paper', 'marble'] : ['paper', 'eraser', 'marble']) : ['eraser', 'paper', 'marble'];
  return order.find((k) => A[k] > 0) || null;
}

function pickTarget(me, enemyCastle, rnd) {
  const t = enemyCastle.targets();
  const by = (k) => t.filter((x) => x.kind === k);
  const P = me.personality;
  const teddy = by('teddy')[0] || by('throne')[0];
  if (P === 'hoarder' && by('piggy').length && rnd() < 0.65) return by('piggy')[Math.floor(rnd() * by('piggy').length)];
  if (P === 'sweetheart' && by('flag').length && rnd() < 0.5) return by('flag')[0];
  if (P === 'warmonger' && by('piggy').length && rnd() < 0.2) return by('piggy')[0];
  return teddy;
}

// Best shot from one catapult at one target. boxes: from Physics.boxes(); ownSide: never hit our castle.
function solve(launch, dir, ammo, wind, target, boxes, ownSide, targetBody) {
  const tops = Math.max(...boxes.map((b) => b.y1), 0) + 3;
  const hitTest = (x, y, r) => {
    if (y > tops) return null;
    if (y < r) return { table: true };
    for (const b of boxes) if (x > b.x0 - r && x < b.x1 + r && y > b.y0 - r && y < b.y1 + r) return b;
    return null;
  };
  const score = (angle, power) => {
    const f = flight(launch[0], launch[1], angle, power, dir, ammo, wind, { hit: hitTest, every: 2, tMax: 4 });
    const h = f.hit;
    if (h && h.b && h.b.userData.side === ownSide && h.b.userData.kind !== 'shot') return 1e4 - f.end[1];
    if (h && h.b === targetBody) return Math.abs(f.end[0] - target.x) * 0.2;
    const ca = closestApproach(f, target.x, target.y);
    let s = ca.d;
    if (!h) s += 30;
    else if (h.table) s += 8;
    return s;
  };
  let best = { s: Infinity };
  for (let a = ANGLE_MIN + 5; a <= ANGLE_MAX - 2; a += 2.5) {
    for (let p = 0.05; p <= 1.0001; p += 0.04) {
      const s = score(a, p);
      if (s < best.s) best = { s, angle: a, power: p };
    }
  }
  // refine around the best
  const c = { ...best };
  for (let a = c.angle - 2; a <= c.angle + 2; a += 0.5) {
    for (let p = Math.max(0, c.power - 0.04); p <= Math.min(1, c.power + 0.04); p += 0.005) {
      const s = score(a, p);
      if (s < best.s) best = { s, angle: a, power: p };
    }
  }
  return best;
}

// Returns {slot, ammo, angle, power, target} or null when it can't shoot.
export function aim(me, myCastle, enemyCastle, phys, wind, rnd, skillKey = 'normal') {
  const target = pickTarget(me, enemyCastle, rnd);
  const ammo = pickAmmo(me, target);
  if (!ammo || !target) return null;
  const sk = SKILLS[skillKey] || SKILLS.normal;
  const boxes = phys.boxes();
  const targetBody = target.kind === 'teddy' ? enemyCastle.teddy : target.kind === 'flag' ? enemyCastle.flag : target.kind === 'piggy' ? enemyCastle.piggies[target.slot] : enemyCastle.throne;
  // the kid reads the draft a little wrong
  const feltWind = wind + (rnd() * 2 - 1) * sk.wind * 30;
  let best = null;
  const slots = [0, 1].filter((i) => me.catapults[i]);
  for (const slot of slots) {
    const s = solve(myCastle.launch(slot), myCastle.dir, ammo, feltWind, target, boxes, me.side, targetBody);
    if (!best || s.s < best.s) best = { ...s, slot };
  }
  const gauss = () => { let u = 0, v = 0; while (!u) u = rnd(); while (!v) v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  const angle = Math.max(ANGLE_MIN, Math.min(ANGLE_MAX, best.angle + gauss() * sk.angle));
  const power = Math.max(0, Math.min(1, best.power + gauss() * sk.power));
  return { slot: best.slot, ammo, angle, power, target, score: best.s };
}
