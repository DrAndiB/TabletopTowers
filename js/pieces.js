// The toys: painted wooden blocks, the teddy on his throne, glazed piggy banks, spoon catapults,
// pencil flagpoles, peg-doll toy soldiers, the ammo, and the cat. All procedural; each function
// returns a THREE.Object3D whose origin matches its physics body (see physics.js).
import * as THREE from '../vendor/three.bundle.js';
import { RoundedBoxGeometry, BufferGeometryUtils } from '../vendor/three.bundle.js';
import * as TX from './textures.js';
import { DEPTH, TEDDY, THRONE, PIGGY, CATAPULT, SLOTS } from './layout.js';
import { AMMO } from './ballistics.js';
import { rng, TAU, clamp } from './util.js';

export const TEAM = [
  { name: 'Red', hex: '#e23b2e', main: 0xd8392b, dark: 0x8e1712, light: 0xf6a39a, paints: [0xd8392b, 0xf2b730, 0xffffff, 0xe8763a, 0xffffff, 0xd8392b, 0xffffff] },
  { name: 'Blue', hex: '#2f6fe0', main: 0x2f6fd8, dark: 0x153a86, light: 0xa9c6f4, paints: [0x2f6fd8, 0x2fae5a, 0xffffff, 0x58b8e8, 0xffffff, 0x2f6fd8, 0xffffff] },
];

const shadowy = (o, cast = true, receive = true) => { o.traverse((m) => { if (m.isMesh) { m.castShadow = cast; m.receiveShadow = receive; } }); return o; };

// ---------- one draw call per material ----------
// Merges the plain meshes under `root` that share a material into one mesh each, in root's space.
// Anything that moves on its own is left alone: mark it (or a parent) with userData.live = true.
export function bake(root) {
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const buckets = new Map();
  const live = (o) => { for (let p = o; p && p !== root; p = p.parent) if (p.userData.live) return true; return false; };
  root.traverse((o) => {
    if (!o.isMesh || o.isInstancedMesh || Array.isArray(o.material) || live(o)) return;
    const key = `${o.material.uuid}|${o.castShadow}|${o.receiveShadow}|${o.renderOrder}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(o);
  });
  const m4 = new THREE.Matrix4();
  for (const list of buckets.values()) {
    if (list.length < 2) continue;
    const geos = list.map((o) => {
      const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
      for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(k)) g.deleteAttribute(k);
      if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
      g.applyMatrix4(m4.multiplyMatrices(inv, o.matrixWorld));
      g.clearGroups();
      return g;
    });
    const hasColor = geos.every((g) => g.attributes.color);
    if (!hasColor) for (const g of geos) if (g.attributes.color) g.deleteAttribute('color');
    const merged = BufferGeometryUtils.mergeGeometries(geos, false);
    if (!merged) continue;
    const first = list[0];
    const mesh = new THREE.Mesh(merged, first.material);
    mesh.castShadow = first.castShadow; mesh.receiveShadow = first.receiveShadow; mesh.renderOrder = first.renderOrder;
    root.add(mesh);
    for (const o of list) o.parent.remove(o);
  }
  return root;
}

// ---------- wood ----------
let woodT = null;
function wood() {
  if (!woodT) {
    woodT = TX.woodTextures({ size: 512, planks: 1, base: 0xe8c896, dark: 0xc49a62, light: 0xf6e2bc, seed: 21, ringFreq: 9, gap: 0, varyPlanks: 0, roughBase: 0.5, lacquer: 0.3, grainContrast: 0.8 });
    for (const k in woodT) woodT[k].userData.shared = true;
  }
  return woodT;
}
const matCache = new Map();
export function woodMaterial(tint = 0xffffff) {
  if (matCache.has(tint)) return matCache.get(tint);
  const t = wood(), painted = tint !== 0xffffff;
  const m = new THREE.MeshPhysicalMaterial({ map: t.map, normalMap: t.normalMap, roughnessMap: t.roughnessMap, normalScale: new THREE.Vector2(0.35, 0.35), color: tint, roughness: painted ? 0.55 : 0.7, clearcoat: painted ? 0.55 : 0.15, clearcoatRoughness: 0.3 });
  matCache.set(tint, m);
  return m;
}

// rounded block, UVs projected per face so the grain runs along the long side at a constant scale
const geoCache = new Map();
export function blockGeometry(w, h, d = DEPTH) {
  const key = `${w}x${h}x${d}`;
  if (geoCache.has(key)) return geoCache.get(key);
  const g = new RoundedBoxGeometry(w, h, d, 2, Math.min(0.5, Math.min(w, h, d) * 0.12));
  const p = g.attributes.position, n = g.attributes.normal, uv = g.attributes.uv;
  const S = 20;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i), ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)), az = Math.abs(n.getZ(i));
    let u, v;
    if (az >= ax && az >= ay) [u, v] = w >= h ? [y, x] : [x, y];
    else if (ay >= ax) [u, v] = [z, x];
    else [u, v] = [z, y];
    uv.setXY(i, u / S + 0.5 + (w * 0.37) % 1, v / S + 0.5);
  }
  g.clearGroups();
  geoCache.set(key, g);
  return g;
}

// a block of a castle: its paint comes from the castle's set and its place in the plan
export function blockMesh(piece, side, index) {
  const pal = TEAM[side].paints;
  let tint;
  if (piece.kind === 'board') tint = 0xffffff;
  else if (piece.kind === 'tower') tint = TEAM[side].main;
  else tint = pal[(index * 5 + (piece.kind === 'cube' ? 3 : 0)) % pal.length];
  const m = new THREE.Mesh(blockGeometry(piece.w, piece.h), woodMaterial(tint));
  return shadowy(m);
}

// ---------- stuffed teddy (after Tabletop Trials' plush crowd) ----------
let feltMat = null;
function felt() {
  if (feltMat) return feltMat;
  const h = TX.noiseField(128, { seed: 77, period: 32, oct: 2 });
  const nm = TX.toTexture(TX.normalFromHeight(h, 128, 128, 1.5), { srgb: false, repeat: [3, 3] });
  nm.userData.shared = true;
  feltMat = new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.92, sheen: 1, sheenRoughness: 0.5, sheenColor: 0xffffff, normalMap: nm, normalScale: new THREE.Vector2(0.5, 0.5) });
  return feltMat;
}
function mergeParts(parts) {
  const geos = parts.map((p) => {
    const g = p.geo.index ? p.geo.toNonIndexed() : p.geo.clone();
    g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(...p.pos), new THREE.Quaternion().setFromEuler(new THREE.Euler(...(p.rot || [0, 0, 0]))), new THREE.Vector3(...(Array.isArray(p.scale) ? p.scale : [p.scale, p.scale, p.scale]))));
    const c = new THREE.Color(p.color), n = g.attributes.position.count, cols = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { cols[i * 3] = c.r; cols[i * 3 + 1] = c.g; cols[i * 3 + 2] = c.b; }
    g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(k)) g.deleteAttribute(k);
    return g;
  });
  let n = 0;
  for (const g of geos) n += g.attributes.position.count;
  const out = new THREE.BufferGeometry();
  for (const [k, size] of [['position', 3], ['normal', 3], ['color', 3], ['uv', 2]]) {
    const arr = new Float32Array(n * size);
    let o = 0;
    for (const g of geos) { arr.set(g.attributes[k].array, o); o += g.attributes[k].array.length; }
    out.setAttribute(k, new THREE.BufferAttribute(arr, size));
  }
  return out;
}
const G = {
  s: new THREE.SphereGeometry(1, 20, 14), sLow: new THREE.SphereGeometry(1, 10, 8), cap: new THREE.CapsuleGeometry(1, 1, 4, 10),
  cone: new THREE.ConeGeometry(1, 1, 10), cyl: new THREE.CylinderGeometry(1, 1, 1, 14), cyl6: new THREE.CylinderGeometry(1, 1, 1, 6), box: new THREE.BoxGeometry(1, 1, 1), torus: new THREE.TorusGeometry(1, 0.3, 8, 20),
};

// The teddy: a seated bear about `size` tall facing +z, with a paper crown. Origin at the centre of
// its physics box. update(t, mood) makes him wave or tremble.
export function teddy(side) {
  const s = 1.05, fur = 0x9a6a43, light = 0xd9b48a, dark = 0x2a1d17;
  const P = (geo, color, pos, scale, rot) => ({ geo, color, pos: pos.map((v) => v * s), scale: (Array.isArray(scale) ? scale : [scale, scale, scale]).map((v) => v * s), rot });
  const body = [], arms = [];
  body.push(P(G.s, fur, [0, 3, 0], [3, 3.2, 2.7]));
  body.push(P(G.s, light, [0, 2.7, 1.5], [1.8, 2.1, 1.3]));
  const hy = 7.2;
  body.push(P(G.s, fur, [0, hy, 0.2], [2.4, 2.25, 2.2]));
  for (const sx of [-1, 1]) { body.push(P(G.s, fur, [sx * 1.7, 1.0, 1.6], [1.15, 1.0, 1.6])); body.push(P(G.s, light, [sx * 1.7, 1.0, 3.1], [0.8, 0.8, 0.25])); }
  body.push(P(G.s, light, [0, hy - 0.55, 1.95], [1.05, 0.8, 0.75]));
  body.push(P(G.s, dark, [0, hy - 0.25, 2.65], [0.35, 0.26, 0.2]));
  for (const sx of [-1, 1]) { body.push(P(G.s, fur, [sx * 1.7, hy + 1.6, -0.1], [0.85, 0.85, 0.45])); body.push(P(G.s, light, [sx * 1.7, hy + 1.6, 0.18], [0.5, 0.5, 0.2])); }
  for (const sx of [-1, 1]) body.push(P(G.sLow, 0x141012, [sx * 0.8, hy + 0.35, 2.1], 0.32));
  // a scarf in the castle's colour
  body.push(P(G.torus, TEAM[side].main, [0, 5.0, 0.3], [2.1, 2.1, 1.6], [Math.PI / 2, 0, 0]));
  for (const sx of [-1, 1]) arms.push(P(G.cap, fur, [sx * 2.6, -1.0, 0.4], [0.85, 1.1, 0.85], [0, 0, sx * 0.35]));
  const group = new THREE.Group(), inner = new THREE.Group();
  group.add(inner);
  inner.position.set(0, -TEDDY.h / 2, -0.4);
  const bm = new THREE.Mesh(mergeParts(body), felt());
  inner.add(bm);
  const armPivot = new THREE.Group();
  armPivot.position.set(0, 5.0 * s, 0);
  inner.add(armPivot);
  armPivot.add(new THREE.Mesh(mergeParts(arms), felt()));
  // paper crown
  const gold = new THREE.MeshPhysicalMaterial({ color: 0xf2c230, roughness: 0.35, metalness: 0.3, clearcoat: 0.6, side: THREE.DoubleSide });
  const crown = new THREE.Group();
  const band = new THREE.Mesh(new THREE.CylinderGeometry(1.25, 1.35, 0.9, 16, 1, true), gold);
  crown.add(band);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * TAU, pt = new THREE.Mesh(new THREE.ConeGeometry(0.42, 1.1, 4), gold);
    pt.position.set(Math.sin(a) * 1.2, 0.95, Math.cos(a) * 1.2);
    crown.add(pt);
  }
  const jewel = new THREE.Mesh(new THREE.SphereGeometry(0.28, 8, 6), new THREE.MeshPhysicalMaterial({ color: TEAM[side].main, roughness: 0.1, clearcoat: 1 }));
  jewel.position.set(0, 0.1, 1.3);
  crown.add(jewel);
  shadowy(crown);
  bake(crown);
  crown.position.set(0, (hy + 2.3) * s, 0.1);
  crown.rotation.z = 0.12 * (side ? -1 : 1);
  inner.add(crown);
  shadowy(group);
  const ph = side * 1.7;
  return {
    group,
    // mood: 0 calm .. 1 alarmed (an attack coming), -1 cheering
    update(t, mood = 0) {
      if (mood < 0) {
        const b = Math.max(0, Math.sin(t * 9 + ph));
        inner.position.y = -TEDDY.h / 2 + b * b * 0.8;
        armPivot.rotation.x = -(1.6 + 0.6 * Math.sin(t * 12 + ph));
      } else {
        inner.position.y = -TEDDY.h / 2;
        armPivot.rotation.x = -(0.25 + mood * 1.2 + Math.sin(t * 1.3 + ph) * 0.05);
        inner.rotation.z = mood * Math.sin(t * 40) * 0.03;
      }
    },
  };
}

export function throne(side) {
  const g = new THREE.Group();
  const [sw, sh, sd] = THRONE.seat, [bw, bh, bd] = THRONE.back;
  const gold = woodMaterial(0xf2c230);
  const seat = new THREE.Mesh(blockGeometry(sw, sh, sd), gold);
  seat.position.set(0, -1, 1);
  const back = new THREE.Mesh(blockGeometry(bw, bh, bd), gold);
  back.position.set(0, sh / 2 - 1 + bh / 2, -2);
  const cushion = new THREE.Mesh(new RoundedBoxGeometry(sw - 1, 1, sd - 1, 2, 0.45), new THREE.MeshPhysicalMaterial({ color: TEAM[side].main, roughness: 0.8, sheen: 1, sheenColor: 0xffffff, sheenRoughness: 0.4 }));
  cushion.position.set(0, 1.4, 1.2);
  g.add(seat, back, cushion);
  for (const sx of [-1, 1]) {
    const knob = new THREE.Mesh(G.s, woodMaterial(TEAM[side].main));
    knob.scale.setScalar(1.1);
    knob.position.set(sx * (bw / 2 - 1), back.position.y + bh / 2 + 0.7, -2);
    g.add(knob);
  }
  // a painted heart on the back
  const heart = new THREE.Mesh(new THREE.CircleGeometry(1.8, 24), new THREE.MeshPhysicalMaterial({ map: heartTexture(TEAM[side].hex), transparent: true, roughness: 0.5, clearcoat: 0.5 }));
  heart.position.set(0, back.position.y + 2.2, -2 + bd / 2 + 0.02);
  g.add(heart);
  return bake(shadowy(g));
}
function heartTexture(color) {
  return TX.labelTexture(64, 64, (g) => {
    g.fillStyle = color;
    g.beginPath(); g.moveTo(32, 54); g.bezierCurveTo(4, 34, 10, 8, 32, 22); g.bezierCurveTo(54, 8, 60, 34, 32, 54); g.fill();
  });
}

// ---------- piggy bank ----------
let pigMat = null;
export function piggy(side) {
  if (!pigMat) pigMat = new THREE.MeshPhysicalMaterial({ color: 0xf4a5b8, roughness: 0.22, clearcoat: 1, clearcoatRoughness: 0.08 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x2a1418, roughness: 0.6 });
  const g = new THREE.Group(), inner = new THREE.Group();
  g.add(inner);
  const add = (geo, mat, x, y, z, sx, sy, sz, rx = 0, ry = 0, rz = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.scale.set(sx, sy, sz); m.rotation.set(rx, ry, rz); inner.add(m); return m; };
  add(G.s, pigMat, 0, 0.4, 0, 4.2, 3.1, 2.8);
  add(G.cyl, pigMat, 4.2, 0.6, 0, 1.15, 0.9, 1.15, 0, 0, Math.PI / 2);
  for (const z of [-0.45, 0.45]) add(G.sLow, dark, 4.68, 0.6, z, 0.2, 0.28, 0.2);
  for (const z of [-1.5, 1.5]) { add(G.cone, pigMat, 2.3, 3.1, z, 0.8, 1.2, 0.5, 0, 0, -0.5); add(G.sLow, dark, 3.0, 1.6, z * 0.85, 0.32, 0.36, 0.32); }
  for (const x of [-2.4, 2.2]) for (const z of [-1.5, 1.5]) add(G.cyl, pigMat, x, -2.7, z, 0.75, 1.6, 0.75);
  add(G.box, dark, -0.4, 3.45, 0, 2.6, 0.3, 0.45);
  add(new THREE.TorusGeometry(0.6, 0.18, 6, 14, Math.PI * 1.6), pigMat, -4.4, 1.2, 0, 1, 1, 1, 0, Math.PI / 2, 0);
  inner.rotation.y = side ? Math.PI : 0;
  shadowy(g);
  bake(inner);
  return g;
}

// ---------- flag on a pencil ----------
const flagTexCache = [];
function flagTexture(side) {
  if (flagTexCache[side]) return flagTexCache[side];
  const W = 128, H = 80;
  const c = TX.makeCanvas(W, H), g = c.getContext('2d');
  g.fillStyle = TEAM[side].hex; g.fillRect(0, 0, W, H);
  // a stripe and the castle's sign, painted by a kid
  g.fillStyle = side ? '#ffffff' : '#ffc93c';
  g.fillRect(0, H * 0.72, W, H * 0.12);
  g.translate(W * 0.45, H * 0.4);
  if (side === 0) {
    g.beginPath();
    for (let i = 0; i < 10; i++) { const a = (i / 10) * TAU - Math.PI / 2, r = i % 2 ? 9 : 21; g.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
    g.closePath(); g.fill();
  } else {
    g.beginPath(); g.arc(0, 0, 20, 0.5, TAU - 0.5, false); g.arc(9, -2, 16, TAU - 0.75, 0.75, true); g.closePath(); g.fill();
  }
  const t = TX.toTexture(c, { wrap: false });
  t.userData.shared = true;
  flagTexCache[side] = t;
  return t;
}
export function flag(side) {
  const g = new THREE.Group();
  const foot = new THREE.Mesh(blockGeometry(3.2, 3, 3.2), woodMaterial(0xffffff));
  foot.position.y = -4.5;
  g.add(foot);
  // the pencil: six-sided, yellow, sharpened end up, pink eraser at the bottom in the foot
  const pencil = new THREE.Mesh(G.cyl6, new THREE.MeshPhysicalMaterial({ color: 0xf2c230, roughness: 0.4, clearcoat: 0.5 }));
  pencil.scale.set(0.5, 20, 0.5); pencil.position.y = 7;
  const tip = new THREE.Mesh(G.cone, new THREE.MeshStandardMaterial({ color: 0xe8c8a0, roughness: 0.8 }));
  tip.scale.set(0.5, 2, 0.5); tip.position.y = 18;
  const lead = new THREE.Mesh(G.cone, new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 0.5 }));
  lead.scale.set(0.16, 0.6, 0.16); lead.position.y = 18.75;
  g.add(pencil, tip, lead);
  // the paper flag: a waving plane
  const geo = new THREE.PlaneGeometry(10, 6.25, 10, 4);
  geo.translate(-5, 0, 0);
  const cloth = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: flagTexture(side), roughness: 0.85, side: THREE.DoubleSide }));
  cloth.position.set(0, 13.5, 0);
  cloth.rotation.y = side ? Math.PI : 0;
  g.add(cloth);
  shadowy(g);
  const base = geo.attributes.position.array.slice();
  return {
    group: g,
    update(t, wind = 0) {
      const p = geo.attributes.position;
      const k = 0.35 + Math.min(1, Math.abs(wind) / 30) * 0.9;
      for (let i = 0; i < p.count; i++) {
        const x = base[i * 3], y = base[i * 3 + 1], d = -x / 10;
        p.setZ(i, Math.sin(t * 6 + x * 0.8 + y * 0.2) * d * k * 0.9);
        p.setY(i, y - d * d * (1 - k) * 0.6);
      }
      p.needsUpdate = true;
      geo.computeVertexNormals();
    },
  };
}

// ---------- cardboard boxes ----------
const cardCache = new Map();
function cardTexture(kind, label = '', w = 1, h = 1) {
  const key = `${kind}:${label}:${w}x${h}`;
  if (cardCache.has(key)) return cardCache.get(key);
  const W = 256, H = Math.max(64, Math.round((256 * h) / w));
  const c = TX.makeCanvas(W, H), g = c.getContext('2d');
  const r = rng(label.length * 13 + W + H);
  g.fillStyle = '#c99d66'; g.fillRect(0, 0, W, H);
  // corrugation and a few scuffs
  for (let x = 0; x < W; x += 5) { g.fillStyle = `rgba(120,80,40,${0.06 + r() * 0.05})`; g.fillRect(x, 0, 2, H); }
  for (let k = 0; k < 6; k++) { g.fillStyle = `rgba(90,60,30,${0.05 + r() * 0.06})`; g.beginPath(); g.ellipse(r() * W, r() * H, 10 + r() * 30, 4 + r() * 10, r() * 3, 0, TAU); g.fill(); }
  if (kind === 'top') {
    // packing tape down the middle
    g.fillStyle = 'rgba(214,182,120,0.85)'; g.fillRect(0, H * 0.38, W, H * 0.24);
    g.fillStyle = 'rgba(255,255,255,0.18)'; g.fillRect(0, H * 0.4, W, H * 0.05);
  } else if (kind === 'front' && label) {
    // a printed word, a bit faded, and the arrows
    g.save();
    g.translate(W / 2, H / 2);
    const fs = Math.min(H * 0.32, (W * 1.5) / label.length);
    g.font = `${fs}px "Lilita One", Impact, sans-serif`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = 'rgba(60,40,24,0.75)';
    if (H > W * 1.6) { g.rotate(-Math.PI / 2); }
    g.fillText(label, 0, 0);
    g.restore();
    g.strokeStyle = 'rgba(200,40,30,0.55)'; g.lineWidth = 5;
    g.strokeRect(10, 10, W - 20, H - 20);
  }
  const t = TX.toTexture(c, { wrap: false });
  t.userData.shared = true;
  cardCache.set(key, t);
  return t;
}
// A cardboard box from the castle's slots. As it takes hits its edges sag, its faces cave in and
// the printed side gets creased, scuffed and finally torn. Origin at its centre.
export function cardboardBox(side, slot) {
  const s = SLOTS.boxes[slot];
  const geo = new THREE.BoxGeometry(s.w, s.h, DEPTH, Math.max(2, Math.round(s.w / 1.5)), Math.max(2, Math.round(s.h / 1.5)), 6);
  // the printed side is the box's own canvas, so the damage can be drawn on it
  const front = cardTexture('front', s.label, s.w, s.h);
  const fc = TX.makeCanvas(front.image.width, front.image.height);
  const ftex = TX.toTexture(fc, { wrap: false });
  const side_ = new THREE.MeshStandardMaterial({ map: cardTexture('side', '', DEPTH, s.h), roughness: 0.95 });
  const mats = [side_, side_,
    new THREE.MeshStandardMaterial({ map: cardTexture('top', '', s.w, DEPTH), roughness: 0.9 }), side_,
    new THREE.MeshStandardMaterial({ map: ftex, roughness: 0.95 }), side_];
  const mesh = new THREE.Mesh(geo, mats);
  mesh.castShadow = true; mesh.receiveShadow = true;
  const base = geo.attributes.position.array.slice();
  const seed = side * 7 + slot * 3 + 1;
  const hx = s.w / 2, hy = s.h / 2, hz = DEPTH / 2;
  const paintFront = (f) => {
    const g = fc.getContext('2d'), W = fc.width, H = fc.height, r = rng(seed);
    g.drawImage(front.image, 0, 0);
    if (f <= 0) { ftex.needsUpdate = true; return; }
    // one crease for every bit of damage, a scuff around each, in the same places every time
    const n = Math.ceil(f * 7);
    for (let k = 0; k < 7; k++) {
      const x = W * (0.12 + r() * 0.76), y = H * (0.12 + r() * 0.76), a = r() * Math.PI, l = Math.min(W, H) * (0.25 + r() * 0.35);
      if (k >= n) continue;
      g.fillStyle = 'rgba(80,50,20,0.22)'; g.beginPath(); g.ellipse(x, y, l * 0.55, l * 0.3, a, 0, TAU); g.fill();
      g.strokeStyle = 'rgba(60,36,14,0.75)'; g.lineWidth = 3; g.lineCap = 'round';
      g.beginPath(); g.moveTo(x - Math.cos(a) * l / 2, y - Math.sin(a) * l / 2); g.quadraticCurveTo(x + Math.sin(a) * l * 0.15, y - Math.cos(a) * l * 0.15, x + Math.cos(a) * l / 2, y + Math.sin(a) * l / 2); g.stroke();
      g.strokeStyle = 'rgba(255,240,210,0.35)'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(x - Math.cos(a) * l / 2 + 2, y - Math.sin(a) * l / 2 + 2); g.lineTo(x + Math.cos(a) * l / 2 + 2, y + Math.sin(a) * l / 2 + 2); g.stroke();
    }
    // badly hurt: a flap torn open showing the dark inside
    if (f > 0.55) {
      // a ragged hole, its paper torn back on one side
      const x = W * 0.6, y = H * 0.52, rx = W * (0.08 + (f - 0.55) * 0.25), ry = H * (0.1 + (f - 0.55) * 0.3);
      const pts = [];
      for (let k = 0; k < 14; k++) { const a = (k / 14) * TAU, j = 0.65 + r() * 0.45; pts.push([x + Math.cos(a) * rx * j, y + Math.sin(a) * ry * j]); }
      g.fillStyle = '#2e1c0e'; g.beginPath(); pts.forEach(([px, py], k) => (k ? g.lineTo(px, py) : g.moveTo(px, py))); g.closePath(); g.fill();
      g.fillStyle = '#e8cc9c'; g.beginPath(); g.moveTo(pts[0][0], pts[0][1]); g.lineTo(pts[3][0], pts[3][1]); g.lineTo(x + rx * 1.5, y + ry * 0.9); g.closePath(); g.fill();
      g.strokeStyle = 'rgba(60,36,14,0.7)'; g.lineWidth = 2; g.stroke();
    }
    ftex.needsUpdate = true;
  };
  return {
    group: mesh,
    // 0 = new, 1 = about to tear
    setDamage(f) {
      const p = geo.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const x = base[i * 3], y = base[i * 3 + 1], z = base[i * 3 + 2];
        const ex = 1 - Math.abs(x / hx), ey = 1 - Math.abs(y / hy), ez = 1 - Math.abs(z / hz);
        const n = 0.5 + 0.5 * Math.sin(x * 1.3 + seed) * Math.sin(y * 1.1 + seed * 2) * Math.cos(z * 0.9 + seed * 3);
        const k = f * (0.3 + 0.7 * n);
        // the top sags in the middle, the sides buckle in, the faces cave
        const sag = y > 0 ? k * 1.6 * ex * (0.5 + 0.5 * ez) : 0;
        p.setXYZ(i,
          x - Math.sign(x) * k * 1.2 * ey * (0.5 + 0.5 * ez),
          y - sag - Math.sign(y) * k * 0.6 * Math.min(ex, ez),
          z - Math.sign(z) * k * 2.2 * Math.min(ex, ey));
      }
      p.needsUpdate = true;
      geo.computeVertexNormals();
      paintFront(f);
    },
  };
}

// ---------- spoon catapult ----------
export function catapult(side) {
  const root = new THREE.Group();
  const g = new THREE.Group();
  root.add(g);
  g.rotation.y = side ? Math.PI : 0;
  const base = new THREE.Mesh(blockGeometry(CATAPULT.w, 2, CATAPULT.d), woodMaterial(TEAM[side].main));
  base.position.set(0, -CATAPULT.h / 2 + 1, 0);
  g.add(base);
  const pale = woodMaterial(0xffffff);
  for (const z of [-3, 3]) {
    const up = new THREE.Mesh(blockGeometry(1.2, 7, 1.2), pale);
    up.position.set(3.2, -CATAPULT.h / 2 + 5.5, z);
    g.add(up);
  }
  const bar = new THREE.Mesh(blockGeometry(1.2, 1.2, 7.4), pale);
  bar.position.set(3.2, -CATAPULT.h / 2 + 9, 0);
  g.add(bar);
  // the throwing arm: a lolly stick with a plastic spoon, on a pivot near the front
  const pivot = new THREE.Group();
  pivot.userData.live = true;
  pivot.position.set(-1, -CATAPULT.h / 2 + 3, 0);
  g.add(pivot);
  const stick = new THREE.Mesh(new RoundedBoxGeometry(12, 0.5, 1.6, 2, 0.24), new THREE.MeshStandardMaterial({ color: 0xe9d3a8, roughness: 0.75 }));
  stick.position.x = -6;
  pivot.add(stick);
  const spoonMat = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.2, clearcoat: 0.8, transmission: 0, side: THREE.DoubleSide });
  const bowl = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 8, 0, TAU, 0, Math.PI / 2), spoonMat);
  bowl.scale.set(2.4, 0.9, 1.9); bowl.rotation.x = Math.PI;
  bowl.position.set(-12.4, 0.75, 0);
  pivot.add(bowl);
  const band = new THREE.Mesh(new THREE.TorusGeometry(1.4, 0.25, 6, 18), new THREE.MeshPhysicalMaterial({ color: side ? 0x2fae5a : 0xe23b2e, roughness: 0.6 }));
  band.rotation.y = Math.PI / 2;
  band.position.set(-1, -CATAPULT.h / 2 + 3, 0);
  g.add(band);
  // the ammo in the spoon while aiming
  const ammo = new THREE.Group();
  ammo.position.set(-12.4, 1.6, 0);
  pivot.add(ammo);
  shadowy(root);
  bake(g);
  const REST = 170, state = { a: REST, swing: -1, target: REST };
  // deg: the arm's direction from the pivot (180 = lying flat backwards, 90 = straight up)
  const set = (deg) => { pivot.rotation.z = THREE.MathUtils.degToRad(deg - 180); };
  set(REST);
  return {
    group: root, ammo,
    // tension 0..1 pulls the arm down
    pull(tension) { state.swing = -1; state.target = REST + 18 * clamp(tension, 0, 1); },
    fire() { state.swing = 0; },
    update(dt) {
      if (state.swing >= 0) {
        state.swing += dt;
        const t = state.swing;
        // a fast throw up to the crossbar, a little rattle, then back down slowly
        if (t < 0.07) state.a = THREE.MathUtils.lerp(state.a, 72, t / 0.07);
        else if (t < 0.3) state.a = 72 + Math.sin((t - 0.07) * 60) * 6 * (1 - (t - 0.07) / 0.23);
        else { state.a = THREE.MathUtils.lerp(state.a, REST, 1 - Math.exp(-3 * dt)); if (t > 2) { state.swing = -1; state.target = REST; } }
      } else state.a = THREE.MathUtils.lerp(state.a, state.target, 1 - Math.exp(-14 * dt));
      set(state.a);
    },
  };
}

// ---------- toy soldiers: wooden peg dolls ----------
const soldierGeo = [];
export function soldierGeometry(side) {
  if (soldierGeo[side]) return soldierGeo[side];
  const T = TEAM[side];
  soldierGeo[side] = mergeParts([
    { geo: G.cyl, color: T.main, pos: [0, 1.6, 0], scale: [1.05, 3.2, 1.05] },
    { geo: G.cyl, color: 0x2a211b, pos: [0, 0.15, 0], scale: [1.12, 0.3, 1.12] },
    { geo: G.cyl, color: 0xf2c230, pos: [0, 2.2, 0], scale: [1.08, 0.3, 1.08] },
    { geo: G.s, color: 0xf2d2b0, pos: [0, 4.05, 0], scale: [1.0, 1.0, 1.0] },
    { geo: G.cyl, color: T.dark, pos: [0, 5.3, 0], scale: [0.85, 1.6, 0.85] },
    { geo: G.cyl, color: 0xf2c230, pos: [0, 4.65, 0], scale: [0.9, 0.22, 0.9] },
    { geo: G.sLow, color: 0x141012, pos: [-0.35, 4.15, 0.88], scale: 0.13 },
    { geo: G.sLow, color: 0x141012, pos: [0.35, 4.15, 0.88], scale: 0.13 },
  ]);
  return soldierGeo[side];
}
let soldierMat = null;
export function soldier(side) {
  if (!soldierMat) soldierMat = new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.5, clearcoat: 0.5, clearcoatRoughness: 0.3 });
  return shadowy(new THREE.Mesh(soldierGeometry(side), soldierMat));
}

// ---------- ammo ----------
let paperTex = null;
function paperTexture() {
  if (paperTex) return paperTex;
  const c = TX.makeCanvas(128), g = c.getContext('2d');
  g.fillStyle = '#fbf8ef'; g.fillRect(0, 0, 128, 128);
  g.strokeStyle = 'rgba(70,110,200,0.45)'; g.lineWidth = 2;
  for (let y = 10; y < 128; y += 14) { g.beginPath(); g.moveTo(0, y); g.lineTo(128, y); g.stroke(); }
  g.strokeStyle = 'rgba(220,60,60,0.5)'; g.beginPath(); g.moveTo(28, 0); g.lineTo(28, 128); g.stroke();
  paperTex = TX.toTexture(c);
  paperTex.userData.shared = true;
  return paperTex;
}
let marbleTex = null;
function marbleTexture() {
  if (marbleTex) return marbleTex;
  const c = TX.makeCanvas(128, 64), g = c.getContext('2d');
  g.fillStyle = '#9fd8f2'; g.fillRect(0, 0, 128, 64);
  for (const [col, off] of [['#1f6fd8', 0], ['#f2b730', 40], ['#e23b2e', 84]]) {
    g.fillStyle = col; g.beginPath();
    for (let x = 0; x <= 128; x += 4) g.lineTo(x, 32 + Math.sin((x + off) * 0.09) * 18);
    for (let x = 128; x >= 0; x -= 4) g.lineTo(x, 32 + Math.sin((x + off) * 0.09) * 18 + 7);
    g.fill();
  }
  marbleTex = TX.toTexture(c);
  marbleTex.userData.shared = true;
  return marbleTex;
}
export function ammoMesh(key) {
  const a = AMMO[key];
  let m;
  if (key === 'paper') {
    const geo = new THREE.IcosahedronGeometry(a.radius, 2);
    const p = geo.attributes.position, r = rng(5), v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i); v.multiplyScalar(0.82 + r() * 0.3); p.setXYZ(i, v.x, v.y, v.z); }
    geo.computeVertexNormals();
    m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: paperTexture(), roughness: 0.9, flatShading: true }));
  } else if (key === 'eraser') {
    m = new THREE.Group();
    const [w, h, d] = a.size;
    const pink = new THREE.Mesh(new RoundedBoxGeometry(w * 0.62, h, d, 2, 0.4), new THREE.MeshStandardMaterial({ color: 0xe8606a, roughness: 0.8 }));
    pink.position.x = -w * 0.19;
    const blue = new THREE.Mesh(new RoundedBoxGeometry(w * 0.4, h, d, 2, 0.4), new THREE.MeshStandardMaterial({ color: 0x3a6fd0, roughness: 0.8 }));
    blue.position.x = w * 0.3;
    m.add(pink, blue);
  } else {
    m = new THREE.Mesh(new THREE.SphereGeometry(a.radius, 24, 16), new THREE.MeshPhysicalMaterial({ map: marbleTexture(), roughness: 0.04, clearcoat: 1, clearcoatRoughness: 0.02, transparent: true, opacity: 0.88, envMapIntensity: 1.4 }));
  }
  return shadowy(m);
}

// ---------- the cat that walks across the table ----------
export function walkingCat() {
  const root = new THREE.Group(), body = new THREE.Group();
  root.add(body);
  const fur = new THREE.MeshStandardMaterial({ color: 0xe8954a, roughness: 0.85 });
  const stripe = new THREE.MeshStandardMaterial({ color: 0xb8622a, roughness: 0.85 });
  const belly = new THREE.MeshStandardMaterial({ color: 0xfbe6c8, roughness: 0.9 });
  const add = (geo, mat, x, y, z, sx, sy, sz, parent = body) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.scale.set(sx, sy, sz); parent.add(m); return m; };
  // walking along +z: body is long in z
  add(G.cap, fur, 0, 27, 0, 8, 12, 8).rotation.x = Math.PI / 2;
  for (let i = 0; i < 4; i++) add(G.torus, stripe, 0, 27, -8 + i * 5.5, 8.1, 8.1, 3).rotation.set(0, 0, 0);
  add(G.s, belly, 0, 22, 2, 6, 4, 10);
  const head = new THREE.Group(); head.position.set(0, 36, 17); body.add(head);
  add(G.s, fur, 0, 0, 0, 7, 6.3, 6.5, head);
  add(G.s, belly, 0, -2, 4.6, 3.6, 2.6, 2.4, head);
  add(G.sLow, new THREE.MeshStandardMaterial({ color: 0xe88a98 }), 0, -0.6, 6.4, 0.9, 0.7, 0.6, head);
  for (const sx of [-1, 1]) {
    add(G.cone, fur, sx * 4.2, 6.4, -0.5, 2.6, 5, 1.6, head).rotation.z = -sx * 0.25;
    add(G.s, new THREE.MeshStandardMaterial({ color: 0x9ccf4a, roughness: 0.25, emissive: 0x2c4010, emissiveIntensity: 0.6 }), sx * 2.6, 1.4, 5.4, 1.2, 1.5, 0.6, head);
    add(G.s, new THREE.MeshBasicMaterial({ color: 0x14100c }), sx * 2.6, 1.4, 5.9, 0.35, 1.2, 0.3, head);
  }
  const legs = [];
  for (const [x, z] of [[-4, 11], [4, 11], [-4, -11], [4, -11]]) {
    const hip = new THREE.Group(); hip.position.set(x, 22, z); body.add(hip);
    add(G.cap, fur, 0, -10.5, 0, 2.3, 9, 2.3, hip);
    add(G.s, belly, 0, -21, 1, 2.8, 1.6, 3.4, hip);
    legs.push(hip);
  }
  const tail = [];
  for (let i = 0; i < 10; i++) tail.push(add(G.s, i % 3 === 1 ? stripe : fur, 0, 0, 0, 2.2 - i * 0.1, 2.2 - i * 0.1, 2.2 - i * 0.1));
  shadowy(root);
  let phase = 0;
  return {
    group: root, head,
    update(dt, speed, t) {
      phase += dt * speed * 0.16;
      legs.forEach((h, i) => { h.rotation.x = Math.sin(phase + (i === 0 || i === 3 ? 0 : Math.PI)) * 0.45 * Math.min(1, speed / 10); });
      body.position.y = Math.abs(Math.sin(phase)) * 0.8;
      head.rotation.y = Math.sin(t * 0.7) * 0.4;
      let px = 0, py = 30, pz = -18, a = 0.6;
      tail.forEach((s, i) => { s.position.set(px, py, pz); a += 0.12 + Math.sin(t * 2 + i * 0.5) * 0.05; px += Math.sin(t * 1.5 + i * 0.4) * 0.4; py += Math.sin(a) * 2.6; pz -= Math.cos(a) * 2.2; });
    },
  };
}
