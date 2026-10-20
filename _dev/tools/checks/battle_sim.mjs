// Headless battle check (no browser): both castles stand still, and computer kids' shots do what they
// should. Run from the repository root:
//   node --experimental-default-type=module _dev/tools/checks/battle_sim.mjs [shots] [skill] [seed]
import { Physics } from '../../../js/physics.js';
import { Castle } from '../../../js/castle.js';
import { newPlayer } from '../../../js/economy.js';
import { aim } from '../../../js/ai.js';
import { launchVelocity, AMMO_ORDER, WIND_MAX } from '../../../js/ballistics.js';
import { rng } from '../../../js/util.js';

const shots = +(process.argv[2] || 12), skill = process.argv[3] || 'hard', seed = +(process.argv[4] || 3);
const rnd = rng(seed);
const phys = new Physics();
const players = [newPlayer(0, { type: 'cpu', personality: 'warmonger' }), newPlayer(1, { type: 'cpu', personality: 'hoarder' })];
players[1].piggies[1].built = true;
const castles = [];
castles[0] = new Castle(phys, 0, { other: () => castles[1] });
castles[1] = new Castle(phys, 1, { other: () => castles[0] });
castles.forEach((c, i) => c.build(players[i]));

// 1. standing still while awake
phys.wakeAll();
let t = performance.now();
for (let i = 0; i < 240; i++) phys.step();
console.log(`settle 2 s awake: ${((performance.now() - t) / 240).toFixed(2)} ms/step; standing ${castles.map((c) => `${c.standing()}/${c.plan.length}`).join(' ')}; teddies ${castles.map((c) => c.teddyOk()).join(' ')}; flags ${castles.map((c) => c.flagUp()).join(' ')}; piggies ${castles.map((c) => [0, 1, 2].map((s) => (c.piggies[s] ? c.piggyOk(s) : '-')).join(',')).join(' ')}`);
for (let i = 0; i < 240 && !phys.settled(); i++) phys.step();
console.log('settled:', phys.settled());

// 2. shots
const ammos = AMMO_ORDER;
for (let n = 0; n < shots; n++) {
  const side = n % 2, me = players[side], enemy = castles[1 - side];
  if (!enemy.teddyOk()) { console.log('teddy down, game over'); break; }
  me.ammo = { paper: 0, eraser: 0, marble: 0 };
  const ammo = ammos[Math.floor(n / 2) % 3];
  me.ammo[ammo] = 5;
  phys.wind = (rnd() * 2 - 1) * WIND_MAX;
  t = performance.now();
  const shot = aim(me, castles[side], enemy, phys, phys.wind, rnd, skill);
  const aimMs = performance.now() - t;
  const [lx, ly] = castles[side].launch(shot.slot);
  const [vx, vy] = launchVelocity(shot.angle, shot.power, castles[side].dir);
  const before = enemy.standing();
  phys.addProjectile(shot.ammo, lx, ly, vx, vy);
  let steps = 0;
  t = performance.now();
  while (!phys.settled() && steps < 120 * 9) { phys.step(); steps++; }
  const ms = performance.now() - t;
  for (const b of [...phys.projectiles]) phys.remove(b);
  console.log(`${side ? 'Blue' : 'Red '} ${shot.ammo.padEnd(6)} at ${shot.target.kind.padEnd(6)} wind ${phys.wind.toFixed(0).padStart(3)} a=${shot.angle.toFixed(1)} p=${shot.power.toFixed(3)} score ${shot.score.toFixed(1).padStart(6)} aim ${aimMs.toFixed(0)}ms | ${(steps / 120).toFixed(1)} s, ${(ms / Math.max(1, steps)).toFixed(2)} ms/step | blocks ${before}→${enemy.standing()} teddy ${enemy.teddyOk() ? 'ok' : 'DOWN'} flag ${enemy.flagUp() ? 'up' : 'DOWN'} piggies ${[0, 1, 2].map((s) => (enemy.piggies[s] ? (enemy.piggyOk(s) ? 'ok' : 'X') : '-')).join(',')} | own ${castles[side].standing()}`);
}
