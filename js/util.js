// Small math helpers, a seeded RNG and 2D noise used by textures and world layout.

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
export const TAU = Math.PI * 2;
export function wrapAngle(a) {
  while (a > Math.PI) a -= TAU;
  while (a < -Math.PI) a += TAU;
  return a;
}
export function damp(current, target, rate, dt) {
  return lerp(current, target, 1 - Math.exp(-rate * dt));
}

// Deterministic RNG (mulberry32) so worlds look the same every time they load.
export function rng(seed = 1) {
  let s = seed >>> 0;
  const r = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  r.range = (a, b) => a + (b - a) * r();
  r.int = (a, b) => Math.floor(a + (b - a + 1) * r());
  r.pick = (arr) => arr[Math.floor(r() * arr.length)];
  r.sign = () => (r() < 0.5 ? -1 : 1);
  r.gauss = () => {
    let u = 0, v = 0;
    while (u === 0) u = r();
    while (v === 0) v = r();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * v);
  };
  return r;
}

// Tileable value noise on a periodic integer lattice. period = lattice cells per tile.
export function makeNoise2D(seed = 1) {
  const r = rng(seed);
  const N = 256;
  const perm = new Uint8Array(N * 2);
  const vals = new Float32Array(N);
  for (let i = 0; i < N; i++) { perm[i] = i; vals[i] = r(); }
  for (let i = N - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    const t = perm[i]; perm[i] = perm[j]; perm[j] = t;
  }
  for (let i = 0; i < N; i++) perm[i + N] = perm[i];
  const hash = (x, y) => vals[perm[(perm[x & 255] + y) & 511] & 255];
  const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
  // periodic value noise, period p (integer) in lattice units
  function noise(x, y, p = 256, py = p) {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const x0 = ((xi % p) + p) % p, y0 = ((yi % py) + py) % py;
    const x1 = (x0 + 1) % p, y1 = (y0 + 1) % py;
    const u = fade(xf), v = fade(yf);
    const a = hash(x0, y0), b = hash(x1, y0), c = hash(x0, y1), d = hash(x1, y1);
    return lerp(lerp(a, b, u), lerp(c, d, u), v);
  }
  // fractal sum, normalised to 0..1, tileable with base period p
  function fbm(x, y, oct = 4, p = 8, gain = 0.5) {
    let amp = 1, sum = 0, norm = 0, f = 1;
    for (let i = 0; i < oct; i++) {
      sum += amp * noise(x * f, y * f, p * f);
      norm += amp;
      amp *= gain;
      f *= 2;
    }
    return sum / norm;
  }
  return { noise, fbm };
}

// Distance from point to segment, plus closest point.
export function segDist(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  const l2 = dx * dx + dz * dz || 1e-9;
  const t = clamp(((px - ax) * dx + (pz - az) * dz) / l2, 0, 1);
  const cx = ax + dx * t, cz = az + dz * t;
  return { d: Math.hypot(px - cx, pz - cz), cx, cz, t };
}

export function pointInPoly(x, z, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], zi = poly[i][1], xj = poly[j][0], zj = poly[j][1];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

// Irregular blob outline (for spills, puddles, stains) as an array of [x,z].
export function blobOutline(r, cx, cz, radius, lumpiness = 0.35, n = 40, stretch = 1, angle = 0) {
  const pts = [];
  const k1 = r() * TAU, k2 = r() * TAU, k3 = r() * TAU;
  const ca = Math.cos(angle), sa = Math.sin(angle);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU;
    const m = 1 + lumpiness * (0.5 * Math.sin(a * 2 + k1) + 0.3 * Math.sin(a * 3 + k2) + 0.2 * Math.sin(a * 5 + k3));
    const lx = Math.cos(a) * radius * m * stretch;
    const lz = Math.sin(a) * radius * m;
    pts.push([cx + lx * ca - lz * sa, cz + lx * sa + lz * ca]);
  }
  return pts;
}

export const PLAYER_COLORS = [
  { name: 'Red', hex: '#e23b2e', body: 0xd8322a, dark: 0x8e1712 },
  { name: 'Blue', hex: '#2f6fe0', body: 0x2a66d8, dark: 0x153a86 },
  { name: 'Yellow', hex: '#f2c230', body: 0xf0bb1c, dark: 0xa77c08 },
  { name: 'Green', hex: '#2fae5a', body: 0x27a352, dark: 0x135e2c },
];
