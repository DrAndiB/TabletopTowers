// Ammo and flight. One small integrator (semi-implicit Euler, like the physics engine) drives the
// aiming preview, the computer kids' aim and the forces on a projectile in flight, so all three agree.
import { GRAVITY } from './layout.js';

export const DT = 1 / 120;          // physics step
export const WIND_MAX = 34;         // the strongest draft, units/s² on a wind-sensitivity-1 projectile
export const ANGLE_MIN = 15, ANGLE_MAX = 80;
export const SPEED_MIN = 80, SPEED_MAX = 270;

// paper balls drift on the draft; marbles barely notice it but punch through walls
export const AMMO = {
  paper: { key: 'paper', name: 'Paper ball', short: 'Paper', price: 1, mass: 0.18, radius: 2.4, shape: 'sphere', drag: 0.55, wind: 1.6, restitution: 0.1, friction: 0.8, damage: 1, tip: 'Cheap and light. The draft blows it about.' },
  eraser: { key: 'eraser', name: 'Eraser', short: 'Eraser', price: 3, mass: 1.1, size: [5.2, 2.4, 3.2], shape: 'box', drag: 0.12, wind: 0.6, restitution: 0.62, friction: 0.5, damage: 2, tip: 'Bounces. Good for knocking things off the top.' },
  marble: { key: 'marble', name: 'Marble', short: 'Marble', price: 6, mass: 2.6, radius: 1.8, shape: 'sphere', drag: 0.04, wind: 0.25, restitution: 0.3, friction: 0.2, damage: 3, tip: 'Heavy glass. Knocks walls down and dents boxes most.' },
};
export const AMMO_ORDER = ['paper', 'eraser', 'marble'];

// power 0..1 → launch speed; angle in degrees above the horizon; dir +1 shoots right, -1 left
export function launchVelocity(angle, power, dir) {
  const v = SPEED_MIN + (SPEED_MAX - SPEED_MIN) * power;
  const a = (angle * Math.PI) / 180;
  return [dir * v * Math.cos(a), v * Math.sin(a)];
}

// acceleration from the draft and air drag (gravity is added by whoever integrates)
export function airAccel(vx, vy, ammo, wind) {
  return [wind * ammo.wind - ammo.drag * vx, -ammo.drag * vy];
}

// The flight from (x0, y0) until it drops below `floor`, leaves the table, or `tMax` passes.
// hit(x, y, r) can end it early (returns truthy when the projectile touches something).
// Returns {pts: [[x, y, t]...], end: [x, y], t, hit}.
export function flight(x0, y0, angle, power, dir, ammoKey, wind, { tMax = 5, floor = -2, every = 4, hit = null } = {}) {
  const ammo = AMMO[ammoKey];
  let [vx, vy] = launchVelocity(angle, power, dir);
  let x = x0, y = y0, t = 0, k = 0, h = null;
  const r = ammo.radius || 2;
  const pts = [[x, y, 0]];
  while (t < tMax) {
    const [ax, ay] = airAccel(vx, vy, ammo, wind);
    vx += ax * DT; vy += (ay - GRAVITY) * DT;
    x += vx * DT; y += vy * DT; t += DT;
    if (++k % every === 0) pts.push([x, y, t]);
    if (hit && (h = hit(x, y, r))) break;
    if (y < floor || Math.abs(x) > 200) break;
  }
  pts.push([x, y, t]);
  return { pts, end: [x, y], t, hit: h };
}

// closest the flight comes to a target point, and when
export function closestApproach(f, tx, ty) {
  let best = Infinity, at = null;
  for (let i = 1; i < f.pts.length; i++) {
    const [ax, ay] = f.pts[i - 1], [bx, by] = f.pts[i];
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy || 1e-9;
    const u = Math.max(0, Math.min(1, ((tx - ax) * dx + (ty - ay) * dy) / l2));
    const cx = ax + dx * u, cy = ay + dy * u, d = Math.hypot(tx - cx, ty - cy);
    if (d < best) { best = d; at = [cx, cy]; }
  }
  return { d: best, at };
}
