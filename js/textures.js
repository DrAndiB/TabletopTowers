// Procedural textures painted into canvases at load time. No image files needed.
import * as THREE from '../vendor/three.bundle.js';
import { makeNoise2D, clamp, lerp, smoothstep, rng } from './util.js';

let maxAniso = 8;
export function setMaxAnisotropy(a) { maxAniso = a; }

export function makeCanvas(w, h = w) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

export function toTexture(canvas, { repeat = [1, 1], srgb = true, wrap = true, aniso = true, flipY = true } = {}) {
  const t = new THREE.CanvasTexture(canvas);
  if (wrap) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
  t.repeat.set(repeat[0], repeat[1]);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = aniso ? maxAniso : 1;
  t.flipY = flipY;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.needsUpdate = true;
  return t;
}

// Fill a canvas pixel by pixel. fn(x, y, u, v, out) writes 0..255 into out[0..3].
export function paint(w, h, fn, canvas) {
  const c = canvas || makeCanvas(w, h);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(w, h);
  const d = img.data;
  const out = [0, 0, 0, 255];
  let i = 0;
  for (let y = 0; y < h; y++) {
    const v = y / h;
    for (let x = 0; x < w; x++) {
      out[3] = 255;
      fn(x, y, x / w, v, out);
      d[i] = out[0]; d[i + 1] = out[1]; d[i + 2] = out[2]; d[i + 3] = out[3];
      i += 4;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

// Tileable fbm field, cached.
const fieldCache = new Map();
export function noiseField(size, { seed = 1, period = 8, oct = 5, gain = 0.5, sx = 1, sy = 1 } = {}) {
  const key = [size, seed, period, oct, gain, sx, sy].join(',');
  if (fieldCache.has(key)) return fieldCache.get(key);
  const n = makeNoise2D(seed);
  const f = new Float32Array(size * size);
  const px = period * sx, py = period * sy;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // separate periods per axis for stretched (grain-like) noise
      let amp = 1, sum = 0, norm = 0, fq = 1;
      for (let o = 0; o < oct; o++) {
        const ppx = Math.max(1, Math.round(px * fq)), ppy = Math.max(1, Math.round(py * fq));
        sum += amp * n.noise((x / size) * ppx, (y / size) * ppy, ppx, ppy);
        norm += amp; amp *= gain; fq *= 2;
      }
      f[y * size + x] = sum / norm;
    }
  }
  fieldCache.set(key, f);
  return f;
}

// Sample a tileable field with wrapping (nearest).
export function sampleField(f, size, x, y) {
  const xi = ((Math.floor(x) % size) + size) % size;
  const yi = ((Math.floor(y) % size) + size) % size;
  return f[yi * size + xi];
}

// Height field (Float32Array w*h, ~0..1) to tangent-space normal map canvas.
export function normalFromHeight(h, w, ht, strength = 2) {
  return paint(w, ht, (x, y, u, v, o) => {
    const xl = (x - 1 + w) % w, xr = (x + 1) % w, yu = (y - 1 + ht) % ht, yd = (y + 1) % ht;
    const dx = (h[y * w + xr] - h[y * w + xl]) * strength;
    const dy = (h[yd * w + x] - h[yu * w + x]) * strength;
    let nx = -dx, ny = dy, nz = 1;
    const l = Math.hypot(nx, ny, nz);
    nx /= l; ny /= l; nz /= l;
    o[0] = (nx * 0.5 + 0.5) * 255; o[1] = (ny * 0.5 + 0.5) * 255; o[2] = (nz * 0.5 + 0.5) * 255;
  });
}

export function heightFromCanvasLuma(c) {
  const ctx = c.getContext('2d');
  const d = ctx.getImageData(0, 0, c.width, c.height).data;
  const h = new Float32Array(c.width * c.height);
  for (let i = 0; i < h.length; i++) h[i] = (d[i * 4] * 0.3 + d[i * 4 + 1] * 0.59 + d[i * 4 + 2] * 0.11) / 255;
  return h;
}

const mix3 = (a, b, t, o) => { o[0] = lerp(a[0], b[0], t); o[1] = lerp(a[1], b[1], t); o[2] = lerp(a[2], b[2], t); return o; };
export const hex3 = (hex) => [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];

// ---------- Wood ----------
// Planks with grain lines, pores and growth-ring bands. Returns {map, normalMap, roughnessMap}.
export function woodTextures({
  size = 1024, seed = 3, planks = 4, base = 0x9a6a3e, dark = 0x5e3a1e, light = 0xc89a66,
  ringFreq = 22, figure = 1, gap = 0.006, gapColor = 0x2a1a0e, varyPlanks = 0.12, roughBase = 0.55,
  lacquer = 0.0, grainContrast = 1, poreContrast = 1,
} = {}) {
  const r = rng(seed);
  const warp = noiseField(256, { seed: seed + 1, period: 3, oct: 4, sx: 1, sy: 0.6 });
  const grain = noiseField(1024, { seed: seed + 2, period: 96, oct: 3, sx: 1, sy: 0.03 });
  const pores = noiseField(1024, { seed: seed + 5, period: 256, oct: 1, sx: 1, sy: 0.06 });
  const blot = noiseField(256, { seed: seed + 3, period: 5, oct: 4 });
  const B = hex3(base), D = hex3(dark), L = hex3(light), G = hex3(gapColor);
  const plankTint = [], plankOff = [], plankFreq = [];
  for (let i = 0; i < planks; i++) { plankTint.push(1 + (r() - 0.5) * 2 * varyPlanks); plankOff.push(r() * 1000); plankFreq.push(ringFreq * (0.7 + r() * 0.6)); }
  const h = new Float32Array(size * size);
  const rough = makeCanvas(size);
  const tmp = [0, 0, 0];
  const fs = 1024 / size;
  const map = paint(size, size, (x, y, u, v, o) => {
    const pu = u * planks;
    const pi = Math.floor(pu);
    const fu = pu - pi;
    const off = plankOff[pi];
    const w = sampleField(warp, 256, u * 256 + off * 0.37, v * 256 + off);
    // growth-ring bands: arcs across the plank (flat-sawn look)
    const cx = fu - 0.5 + (w - 0.5) * 0.6 * figure;
    // parabolic "cathedral" arcs along the board, with darker latewood edges
    const phase = cx * cx * 3.2 * figure + v * (plankFreq[pi] / 3) + (w - 0.5) * 0.9 + off;
    const fr = phase - Math.floor(phase);
    const band = smoothstep(0.45, 0.95, fr) * (1 - smoothstep(0.95, 1.0, fr)) * 0.8 + 0.2 * (0.5 + 0.5 * Math.sin(phase * 6.283));
    const g = sampleField(grain, 1024, x * fs + off * 13, y * fs + off * 7);
    const pz = sampleField(pores, 1024, x * fs + off * 31, y * fs + off * 3);
    const b = sampleField(blot, 256, u * 256 + off, v * 256);
    const line = smoothstep(0.6, 0.76, g) * 0.32 * grainContrast;
    const pore = smoothstep(0.74, 0.88, pz) * 0.25 * poreContrast;
    let t = clamp(0.36 + band * 0.4 + (b - 0.5) * 0.2, 0, 1);
    mix3(L, B, smoothstep(0, 0.55, t), tmp);
    mix3(tmp, D, smoothstep(0.55, 1.0, t) * 0.9, tmp);
    let k = plankTint[pi] * (1 - line - pore);
    const edge = Math.min(fu, 1 - fu);
    let height = 0.55 - line * 0.6 - pore * 0.9 - band * 0.05;
    if (edge < gap) { mix3(tmp, G, 0.9, tmp); height = 0.0; }
    else if (edge < gap * 3) { const e = (edge - gap) / (gap * 2); k *= 0.82 + 0.18 * e; height -= 0.25 * (1 - e); }
    o[0] = clamp(tmp[0] * k, 0, 255); o[1] = clamp(tmp[1] * k, 0, 255); o[2] = clamp(tmp[2] * k, 0, 255);
    h[y * size + x] = height;
  });
  paint(size, size, (x, y, u, v, o) => {
    const hh = h[y * size + x];
    const rv = clamp(roughBase + (0.55 - hh) * 0.6 - lacquer * 0.3, 0.05, 1) * 255;
    o[0] = o[1] = o[2] = rv;
  }, rough);
  return {
    map: toTexture(map),
    normalMap: toTexture(normalFromHeight(h, size, size, 2.5), { srgb: false }),
    roughnessMap: toTexture(rough, { srgb: false }),
  };
}

// ---------- Woven fabric: gingham tablecloth ----------
export function ginghamTextures({ size = 1024, checks = 8, color = 0xc4262b, base = 0xf7f3ea, seed = 5, threadsPerCheck = 18 } = {}) {
  const C = hex3(color), W = hex3(base);
  const n = noiseField(256, { seed, period: 16, oct: 3 });
  const h = new Float32Array(size * size);
  const tmp = [0, 0, 0];
  const threads = checks * threadsPerCheck;
  const map = paint(size, size, (x, y, u, v, o) => {
    const cu = Math.floor(u * checks * 2) % 2; // band on/off
    const cv = Math.floor(v * checks * 2) % 2;
    // weave: alternating over/under
    const tu = u * threads, tv = v * threads;
    const iu = Math.floor(tu), iv = Math.floor(tv);
    const fu = tu - iu, fv = tv - iv;
    const over = (iu + iv) % 2 === 0; // warp over weft
    const wu = Math.sin(fu * Math.PI), wv = Math.sin(fv * Math.PI);
    const yarn = over ? wv : wu; // visible yarn cross-section shading
    // colour: warp thread colour from vertical bands, weft from horizontal bands
    const warpCol = cu ? 1 : 0, weftCol = cv ? 1 : 0;
    const colAmt = over ? warpCol : weftCol;
    const mixAmt = (warpCol + weftCol) * 0.5;
    const amt = lerp(mixAmt, colAmt, 0.6);
    mix3(W, C, amt * 0.92, tmp);
    const nn = sampleField(n, 256, u * 256, v * 256);
    const shade = 0.78 + 0.22 * yarn + (nn - 0.5) * 0.1;
    o[0] = clamp(tmp[0] * shade, 0, 255); o[1] = clamp(tmp[1] * shade, 0, 255); o[2] = clamp(tmp[2] * shade, 0, 255);
    h[y * size + x] = yarn * 0.6 + nn * 0.4;
  });
  return {
    map: toTexture(map),
    normalMap: toTexture(normalFromHeight(h, size, size, 1.6), { srgb: false }),
  };
}

// ---------- Felt (pool table) ----------
export function feltTextures({ size = 512, color = 0x1f7a45, seed = 9 } = {}) {
  const C = hex3(color);
  const n1 = noiseField(size, { seed, period: 128, oct: 2 });
  const n2 = noiseField(256, { seed: seed + 1, period: 6, oct: 4 });
  const h = new Float32Array(size * size);
  const map = paint(size, size, (x, y, u, v, o) => {
    const a = n1[y * size + x];
    const b = sampleField(n2, 256, u * 256, v * 256);
    const k = 0.9 + (a - 0.5) * 0.35 + (b - 0.5) * 0.12;
    o[0] = clamp(C[0] * k, 0, 255); o[1] = clamp(C[1] * k, 0, 255); o[2] = clamp(C[2] * k, 0, 255);
    h[y * size + x] = a;
  });
  return { map: toTexture(map), normalMap: toTexture(normalFromHeight(h, size, size, 1.2), { srgb: false }) };
}

// ---------- Generic mottled surface (dirt, sand, concrete...) ----------
export function mottledTextures({ size = 512, a = 0x7a5a3a, b = 0x5a3f28, c = null, seed = 11, period = 8, speck = 0.15, bump = 2, roughness = null, pebbles = 0, pebbleColor = 0x8a7f72 } = {}) {
  const A = hex3(a), B = hex3(b), Cc = c != null ? hex3(c) : null;
  const n1 = noiseField(256, { seed, period, oct: 5 });
  const n2 = noiseField(size, { seed: seed + 1, period: size / 4, oct: 1 });
  const h = new Float32Array(size * size);
  const tmp = [0, 0, 0];
  const map = paint(size, size, (x, y, u, v, o) => {
    const t = sampleField(n1, 256, u * 256, v * 256);
    const s = n2[y * size + x];
    mix3(A, B, smoothstep(0.3, 0.7, t), tmp);
    if (Cc) mix3(tmp, Cc, smoothstep(0.62, 0.8, t) * 0.7, tmp);
    const k = 1 + (s - 0.5) * speck * 2;
    o[0] = clamp(tmp[0] * k, 0, 255); o[1] = clamp(tmp[1] * k, 0, 255); o[2] = clamp(tmp[2] * k, 0, 255);
    h[y * size + x] = t * 0.6 + s * 0.4;
  });
  if (pebbles > 0) {
    const ctx = map.getContext('2d');
    const r = rng(seed + 7);
    const P = hex3(pebbleColor);
    for (let i = 0; i < pebbles; i++) {
      const x = r() * size, y = r() * size, rad = 1 + r() * r() * 5;
      const k = 0.7 + r() * 0.6;
      for (const [ox, oy] of [[0, 0], [size, 0], [-size, 0], [0, size], [0, -size]]) {
        const g = ctx.createRadialGradient(x + ox - rad * 0.3, y + oy - rad * 0.3, 0, x + ox, y + oy, rad);
        g.addColorStop(0, `rgb(${P[0] * k * 1.25 | 0},${P[1] * k * 1.25 | 0},${P[2] * k * 1.25 | 0})`);
        g.addColorStop(0.8, `rgb(${P[0] * k | 0},${P[1] * k | 0},${P[2] * k | 0})`);
        g.addColorStop(1, `rgba(${P[0] * k * 0.5 | 0},${P[1] * k * 0.5 | 0},${P[2] * k * 0.5 | 0},0)`);
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(x + ox, y + oy, rad, 0, Math.PI * 2); ctx.fill();
      }
      // pebble bumps into height
      const ix = Math.floor(x), iy = Math.floor(y), ir = Math.ceil(rad);
      for (let yy = -ir; yy <= ir; yy++) for (let xx = -ir; xx <= ir; xx++) {
        const d = Math.hypot(xx, yy) / rad;
        if (d < 1) {
          const px = ((ix + xx) % size + size) % size, py = ((iy + yy) % size + size) % size;
          h[py * size + px] = Math.max(h[py * size + px], 0.6 + 0.4 * Math.sqrt(1 - d * d));
        }
      }
    }
  }
  const out = { map: toTexture(map), normalMap: toTexture(normalFromHeight(h, size, size, bump), { srgb: false }) };
  if (roughness) {
    const rc = paint(size, size, (x, y, u, v, o) => { const q = clamp(roughness[0] + (roughness[1] - roughness[0]) * h[y * size + x], 0, 1) * 255; o[0] = o[1] = o[2] = q; });
    out.roughnessMap = toTexture(rc, { srgb: false });
  }
  return out;
}

// ---------- Brushed metal ----------
export function brushedMetalTextures({ size = 256, seed = 13, horizontal = true } = {}) {
  const n = noiseField(size, { seed, period: horizontal ? 2 : 64, oct: 2, sx: horizontal ? 1 : 0.02, sy: horizontal ? 32 : 1 });
  const h = new Float32Array(size * size);
  const rough = paint(size, size, (x, y, u, v, o) => {
    const t = n[y * size + x];
    h[y * size + x] = t;
    const q = clamp(0.28 + (t - 0.5) * 0.25, 0, 1) * 255;
    o[0] = o[1] = o[2] = q;
  });
  return { roughnessMap: toTexture(rough, { srgb: false }), normalMap: toTexture(normalFromHeight(h, size, size, 0.6), { srgb: false }) };
}

// Soft radial blob used for contact shadows (white centre, transparent edge; used as alphaMap).
let blobTex = null;
export function blobShadowTexture() {
  if (blobTex) return blobTex;
  const s = 128;
  const c = makeCanvas(s);
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.45, 'rgba(255,255,255,0.75)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, s, s);
  blobTex = toTexture(c, { srgb: false, wrap: false });
  return blobTex;
}

// Small text/label textures (ruler numbers, ball numbers, labels).
export function labelTexture(w, h, draw, opts = {}) {
  const c = makeCanvas(w, h);
  draw(c.getContext('2d'), w, h);
  return toTexture(c, { wrap: false, ...opts });
}
