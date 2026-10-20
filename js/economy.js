// The money side of the game, after Ballerburg: pocket money, chores, piggy banks with interest, the
// toy soldiers' morale and the swap market. Pure rules, no rendering, so the checks can run it in Node.
import { AMMO } from './ballistics.js';

export const RULES = {
  startCoins: 15,
  startToys: 10,
  maxToys: 16,
  startMorale: 60,
  allowance: 5,
  crewPerCatapult: 2,
  piggyBase: 2,          // coins a piggy bank adds every turn
  piggyInterest: 0.1,    // of what it holds
  piggyCapacity: 30,
  piggyPrice: 15,
  catapultPrice: 20,
  toysPerSnack: 5,
  hungry: -6,
  flagDownPerTurn: -1,
  flagFalls: -10,
  piggySmashed: -5,
  blockLost: -1, blockLostCap: -5,
  cheerBlocks: 4,        // the shooter's toys cheer: +1 a block knocked down (up to this), +3 a box
  cheerBig: 3,           // torn or piggy smashed, +5 for the flag
  happy: 70, birthdayChance: 0.35,
  sulky: 40, defect: 20,
  boxHp: 5,              // dents a cardboard box takes before it tears (paper 1, eraser 2, marble 3)
  boxPrice: 5,
  tapePrice: 2, tapeHp: 1,  // one strip per box per turn
  boxTorn: -3,
};

// chores: what every idle toy earns, and what it does to morale each turn
export const CHORES = [
  { key: 'play', name: 'Playtime', coins: 0, morale: 6 },
  { key: 'light', name: 'Light', coins: 1, morale: 2 },
  { key: 'busy', name: 'Busy', coins: 2, morale: -3 },
  { key: 'grind', name: 'Grind', coins: 3, morale: -8 },
];

// the swap market: prices go up when you buy and settle back each round; selling pays 60 %
export const GOODS = {
  paper: { name: 'Paper ball', base: AMMO.paper.price },
  eraser: { name: 'Eraser', base: AMMO.eraser.price },
  marble: { name: 'Marble', base: AMMO.marble.price },
  snack: { name: 'Snack', base: 2 },
  block: { name: 'Block', base: 1 },
};
export const SELLABLE = ['paper', 'eraser', 'marble', 'snack'];

export class Market {
  constructor() { this.demand = Object.fromEntries(Object.keys(GOODS).map((k) => [k, 1])); this.trend = {}; }
  price(k) { return Math.max(1, Math.round(GOODS[k].base * this.demand[k])); }
  sellPrice(k) { return Math.max(0, Math.floor(GOODS[k].base * this.demand[k] * 0.6)); }
  bought(k, n = 1) { this.demand[k] *= Math.pow(1.08, n); this.trend[k] = 1; }
  sold(k, n = 1) { this.demand[k] = Math.max(0.6, this.demand[k] / Math.pow(1.06, n)); this.trend[k] = -1; }
  // each round prices drift back towards normal
  relax() { for (const k in this.demand) { const before = this.price(k); this.demand[k] = 1 + (this.demand[k] - 1) * 0.75; this.trend[k] = Math.sign(this.price(k) - before); } }
  // what n blocks cost right now (each one pushes the price up a little)
  blockCost(n) { let c = 0, d = this.demand.block; for (let i = 0; i < n; i++) { c += Math.max(1, Math.round(GOODS.block.base * d)); d *= 1.02; } return c; }
}

export function newPlayer(side, { type = 'human', personality = 'hoarder', skill = 'normal' } = {}) {
  return {
    side, type, personality, skill,
    pocket: RULES.startCoins,
    piggies: [{ built: true, savings: 0 }, { built: false, savings: 0 }, { built: false, savings: 0 }],
    catapults: [true, false],
    boxes: [{ built: true, hp: RULES.boxHp }, { built: true, hp: RULES.boxHp }, { built: false, hp: 0 }],
    toys: RULES.startToys,
    morale: RULES.startMorale,
    chores: 1,
    ammo: { paper: 6, eraser: 2, marble: 1 },
    snacks: 3,
    sulkSkip: false,
    flagDown: false,
    stats: { shots: 0, earned: 0, blocksKnocked: 0, boxesTorn: 0, piggiesSmashed: 0, spent: 0 },
  };
}

export const savings = (p) => p.piggies.reduce((s, g) => s + (g.built ? g.savings : 0), 0);
export const wealth = (p) => p.pocket + savings(p);
export const crewed = (p) => Math.min(p.catapults.filter(Boolean).length, Math.floor(p.toys / RULES.crewPerCatapult));
export const idleToys = (p) => Math.max(0, p.toys - p.catapults.filter(Boolean).length * RULES.crewPerCatapult);
export const snacksNeeded = (p) => Math.ceil(p.toys / RULES.toysPerSnack);

// what this turn pays: {allowance, chores, piggies, interest, total}
export function income(p, { grandma = false, choresOverride = null } = {}) {
  const ch = CHORES[choresOverride ?? p.chores];
  const built = p.piggies.filter((g) => g.built);
  const r = {
    allowance: RULES.allowance * (grandma ? 2 : 1),
    chores: idleToys(p) * ch.coins,
    piggies: built.length * RULES.piggyBase,
    interest: built.reduce((s, g) => s + Math.floor(g.savings * RULES.piggyInterest), 0),
  };
  r.total = r.allowance + r.chores + r.piggies + r.interest;
  return r;
}

// pay from the pocket first, then shake the piggy banks (fullest first)
export function canAfford(p, n) { return wealth(p) >= n; }
export function spend(p, n) {
  if (!canAfford(p, n)) return false;
  const fromPocket = Math.min(p.pocket, n);
  p.pocket -= fromPocket; n -= fromPocket;
  const banks = p.piggies.filter((g) => g.built && g.savings > 0).sort((a, b) => b.savings - a.savings);
  for (const g of banks) { const k = Math.min(g.savings, n); g.savings -= k; n -= k; if (!n) break; }
  return true;
}

// at the end of a turn, coins left in the pocket go into the piggy banks (emptiest first)
export function deposit(p) {
  const banks = p.piggies.filter((g) => g.built);
  while (p.pocket > 0) {
    const g = banks.filter((b) => b.savings < RULES.piggyCapacity).sort((a, b) => a.savings - b.savings)[0];
    if (!g) break;
    const k = Math.min(p.pocket, RULES.piggyCapacity - g.savings);
    g.savings += k; p.pocket -= k;
  }
}

// The start of a player's turn: pay out, feed the toys, see how they feel. Returns a report:
// {income, lines: [{text, tone}], lost: null | reason, defected, joined}
export function startTurn(p, other, rnd, { grandma = false, clean = false } = {}) {
  const lines = [];
  const choresNow = clean ? 1 : p.chores;
  const inc = income(p, { grandma, choresOverride: choresNow });
  // interest grows inside the piggy banks; the rest goes in the pocket
  for (const g of p.piggies) if (g.built) g.savings += Math.floor(g.savings * RULES.piggyInterest);
  p.pocket += inc.total - inc.interest;
  p.stats.earned += inc.total;
  let dm = CHORES[choresNow].morale;
  const need = snacksNeeded(p);
  if (p.snacks >= need) p.snacks -= need;
  else { p.snacks = 0; dm += RULES.hungry; lines.push({ text: 'Not enough snacks: the toys are hungry', tone: 'bad' }); }
  if (p.flagDown) dm += RULES.flagDownPerTurn;
  p.morale = Math.max(0, Math.min(100, p.morale + dm));
  const rep = { income: inc, moraleChange: dm, lines, lost: null, defected: 0, joined: 0 };
  if (p.morale >= RULES.happy && p.toys < RULES.maxToys && rnd() < RULES.birthdayChance) {
    p.toys++; rep.joined = 1;
    lines.push({ text: 'A birthday toy joins the castle!', tone: 'good' });
  }
  if (p.morale < RULES.defect && p.toys > 0 && other.morale > p.morale) {
    p.toys--; other.toys++; rep.defected = 1;
    lines.push({ text: 'A toy soldier walks over to the other castle', tone: 'bad' });
  }
  if (p.morale < RULES.sulky) p.sulkSkip = !p.sulkSkip; else p.sulkSkip = false;
  if (p.morale <= 0) rep.lost = 'mutiny';
  else if (p.toys < RULES.crewPerCatapult) rep.lost = 'nocrew';
  return rep;
}

// what an enemy shot did to a castle's morale and money; returns lines for the report
export function takeDamage(p, shooter, { blocks = 0, piggies = [], flagFell = false, boxes = [] }) {
  const lines = [];
  const cheer = (n) => { if (shooter && shooter !== p) shooter.morale = Math.min(100, shooter.morale + n); };
  if (blocks > 0) {
    p.morale = Math.max(0, p.morale + Math.max(RULES.blockLostCap, blocks * RULES.blockLost));
    if (shooter) shooter.stats.blocksKnocked += blocks;
    cheer(Math.min(RULES.cheerBlocks, blocks));
  }
  cheer(RULES.cheerBig * (boxes.length + piggies.length) + (flagFell && !p.flagDown ? 5 : 0));
  if (shooter && shooter !== p) shooter.stats.boxesTorn += boxes.length;
  for (const slot of piggies) {
    const g = p.piggies[slot];
    if (!g.built) continue;
    const coins = g.savings, found = Math.floor(coins / 2);
    g.built = false; g.savings = 0;
    p.morale = Math.max(0, p.morale + RULES.piggySmashed);
    if (shooter && shooter !== p) { shooter.pocket += found; shooter.stats.piggiesSmashed++; }
    lines.push({ text: coins ? `Piggy bank smashed! ${coins} coins scattered${shooter && shooter !== p && found ? `, ${found} rolled to the other side` : ''}` : 'Piggy bank smashed! It was empty', tone: 'bad', coins, found, slot });
  }
  for (const name of boxes) {
    p.morale = Math.max(0, p.morale + RULES.boxTorn);
    lines.push({ text: `The ${name.toLowerCase()} box is torn up!`, tone: 'bad' });
  }
  if (flagFell && !p.flagDown) {
    p.flagDown = true;
    p.morale = Math.max(0, p.morale + RULES.flagFalls);
    lines.push({ text: 'The flag is down!', tone: 'bad' });
  }
  return lines;
}

export const moraleWord = (m) => (m >= 70 ? 'Happy' : m >= 40 ? 'Fine' : m >= 20 ? 'Sulky' : m > 0 ? 'Rebellious' : 'Mutiny');
