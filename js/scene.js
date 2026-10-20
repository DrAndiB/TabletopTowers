// The kitchen: a long farmhouse table on a sunny afternoon, the window the draft comes through, the
// cupboards, the things the kids left on the table, and the swap shop in the middle at the back.
import * as THREE from '../vendor/three.bundle.js';
import { RoundedBoxGeometry } from '../vendor/three.bundle.js';
import * as TX from './textures.js';
import { rng, TAU } from './util.js';
import { TABLE } from './layout.js';
import { soldierGeometry, ammoMesh, TEAM, bake } from './pieces.js';

export const LIGHT = {
  sunDir: [-0.42, 0.78, 0.48], sunColor: 0xfff0d8, sunIntensity: 2.2,
  hemiSky: 0xf2ecdf, hemiGround: 0x7a5a40, hemiIntensity: 0.65,
  envIntensity: 0.55, exposure: 1.0, background: 0x2a2421, shadowRadius: 3,
  grade: { sat: 1.12, tint: [1.02, 1, 0.97] },
};

// ---------- the room ----------
export function buildKitchen(K, R) {
  const g = K.group;
  const std = (p) => new THREE.MeshStandardMaterial(p);
  // floor tiles far below
  const fc = TX.makeCanvas(256), f = fc.getContext('2d');
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) { f.fillStyle = (x + y) % 2 ? '#e9e4da' : '#c9b9a2'; f.fillRect(x * 32, y * 32, 32, 32); }
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(1400, 800).rotateX(-Math.PI / 2), std({ map: TX.toTexture(fc, { repeat: [18, 10] }), roughness: 0.6 }));
  floor.position.set(0, -76, 0); floor.receiveShadow = true; g.add(floor);
  // the back wall: tiles up to the counter, then paint
  const tc = TX.makeCanvas(256, 128), tg = tc.getContext('2d');
  tg.fillStyle = '#cfc6b8'; tg.fillRect(0, 0, 256, 128);
  for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) { tg.fillStyle = (x + y) % 3 ? '#f4efe6' : '#e6eef2'; tg.fillRect(x * 64 + (y % 2) * 32 - 32 + 2, y * 32 + 2, 60, 28); tg.fillRect(x * 64 + (y % 2) * 32 + 32 + 2, y * 32 + 2, 60, 28); }
  const wall = new THREE.Mesh(new THREE.PlaneGeometry(1400, 420), std({ color: 0xf3e3c3, roughness: 0.95 }));
  wall.position.set(0, 110, -170); g.add(wall);
  const tiles = new THREE.Mesh(new THREE.PlaneGeometry(1400, 40), std({ map: TX.toTexture(tc, { repeat: [28, 2] }), roughness: 0.35 }));
  tiles.position.set(0, 34, -169.5); g.add(tiles);
  // the counter along the wall, cupboards above, the window in the middle
  const cupMat = std({ color: 0x9cc7a3, roughness: 0.5 });
  const counter = new THREE.Mesh(new THREE.BoxGeometry(1400, 4, 60), std({ color: 0xe8e2d6, roughness: 0.4 }));
  counter.position.set(0, 12, -140); counter.receiveShadow = true; g.add(counter);
  const base = new THREE.Mesh(new THREE.BoxGeometry(1400, 88, 58), cupMat);
  base.position.set(0, -32, -140); g.add(base);
  for (let k = -6; k <= 6; k++) {
    if (Math.abs(k) <= 1) continue;
    const m = new THREE.Mesh(new RoundedBoxGeometry(58, 74, 4, 2, 1), cupMat);
    m.position.set(k * 62, 112, -166); m.castShadow = true; g.add(m);
    const knob = new THREE.Mesh(new THREE.SphereGeometry(1.6, 12, 8), new THREE.MeshStandardMaterial({ color: 0xd9c08a, roughness: 0.3, metalness: 1 }));
    knob.position.set(k * 62 + (k < 0 ? 22 : -22), 84, -163); g.add(knob);
  }
  const win = paneWindow(g, { x: 0, y: 100, z: -169, w: 150, h: 92, sky: daySky(5) });
  // curtains that move with the draft
  const curtains = [-1, 1].map((s) => curtain(g, s * 88, 100, -164, s));
  // a plant on the sill
  const pot = new THREE.Mesh(K.lathe([[0.01, 0], [5, 0], [6.5, 10], [0.01, 10]], 20), std({ color: 0xd2734a, roughness: 0.8 }));
  pot.position.set(52, win.sillY, -160); pot.castShadow = true; g.add(pot);
  const leaves = [];
  const lr = rng(4);
  for (let k = 0; k < 14; k++) { const a = lr() * TAU; leaves.push({ x: 52 + Math.cos(a) * lr() * 6, y: win.sillY + 12 + lr() * 10, z: -160 + Math.sin(a) * 4, rx: lr() * 2, ry: a, rz: lr() - 0.5, sx: 2.2, sy: 5, sz: 0.6 }); }
  K.instances(new THREE.SphereGeometry(1, 8, 6), std({ color: 0x4f9a4a, roughness: 0.6 }), leaves);

  // the table: polished oak, a little glossy, legs down to the floor
  const T = TX.woodTextures({ size: 1024, planks: 3, base: 0xb07a4f, dark: 0x6e4a2f, light: 0xd7a878, seed: 77, ringFreq: 10, roughBase: 0.32, lacquer: 0.85, grainContrast: 0.9 });
  // planks run the length of the table
  for (const k of ['map', 'normalMap', 'roughnessMap']) { T[k].center.set(0.5, 0.5); T[k].rotation = Math.PI / 2; T[k].repeat.set(1, 1.8); }
  const top = new THREE.Mesh(new RoundedBoxGeometry(TABLE.x * 2 + 8, 5, TABLE.z * 2 + 8, 3, 1.8), new THREE.MeshPhysicalMaterial({ ...T, roughness: 0.32, clearcoat: 0.55, clearcoatRoughness: 0.22, envMapIntensity: 0.45 }));
  top.position.set(0, -2.5, 0); top.receiveShadow = true; top.castShadow = true; g.add(top);
  R.addMirror(top, { y: 0, strength: 0.22, blur: 2.5 });
  const legMat = std({ color: 0x8a5a36, roughness: 0.45 });
  for (const x of [-TABLE.x + 10, TABLE.x - 10]) for (const z of [-TABLE.z + 10, TABLE.z - 10]) { const leg = new THREE.Mesh(new THREE.BoxGeometry(8, 72, 8), legMat); leg.position.set(x, -41, z); g.add(leg); }

  // on the table: the kids' cocoa mugs at their ends, a fruit bowl, the biscuit tin
  const mug = (x, z, col) => {
    const m = new THREE.Mesh(K.lathe([[0.01, 0], [4.6, 0], [4.8, 10], [4.2, 10], [4.1, 0.6], [0.01, 0.6]], 24), std({ color: col, roughness: 0.35 }));
    m.position.set(x, 0, z); m.castShadow = true; g.add(m);
    const h = new THREE.Mesh(new THREE.TorusGeometry(2.5, 0.6, 8, 16, Math.PI), std({ color: col, roughness: 0.35 }));
    h.rotation.z = -Math.PI / 2; h.position.set(x + 4.6, 5, z); h.castShadow = true; g.add(h);
    const cocoa = new THREE.Mesh(new THREE.CircleGeometry(4.15, 20).rotateX(-Math.PI / 2), std({ color: 0x5a3220, roughness: 0.3 }));
    cocoa.position.set(x, 8.5, z); g.add(cocoa);
  };
  mug(-168, 44, TEAM[0].main); mug(168, 44, TEAM[1].main);
  const bowl = new THREE.Mesh(K.lathe([[0.01, 0], [8, 0.4], [14, 6], [15, 9], [14.4, 9.2], [13, 6.4], [7.5, 1.2], [0.01, 1]], 32), std({ color: 0xf4efe6, roughness: 0.3 }));
  bowl.position.set(-150, 0, -48); bowl.castShadow = true; g.add(bowl);
  for (const [c, r, dx, dz] of [[0xe23b2e, 4.2, -3, 0], [0xf2c230, 4, 3, 2], [0x7bbf3a, 3.8, 0, -4], [0xef7d2c, 4.1, 5, -3]]) { const m = new THREE.Mesh(new THREE.SphereGeometry(r, 20, 14), std({ color: c, roughness: 0.45 })); m.position.set(-150 + dx, 6.5, -48 + dz); m.castShadow = true; g.add(m); }
  const tinC = TX.makeCanvas(256, 64), tc2 = tinC.getContext('2d');
  tc2.fillStyle = '#2f5fae'; tc2.fillRect(0, 0, 256, 64);
  for (let x = 8; x < 256; x += 32) { tc2.fillStyle = '#f2c230'; tc2.beginPath(); tc2.arc(x, 32, 9, 0, TAU); tc2.fill(); tc2.fillStyle = '#e23b2e'; tc2.beginPath(); tc2.arc(x + 16, 20, 5, 0, TAU); tc2.fill(); }
  const tin = new THREE.Mesh(new THREE.CylinderGeometry(11, 11, 12, 32), [std({ map: TX.toTexture(tinC, { repeat: [2, 1] }), roughness: 0.3, metalness: 0.6 }), std({ color: 0xd9c08a, roughness: 0.25, metalness: 1 }), std({ color: 0xd9c08a, roughness: 0.25, metalness: 1 })]);
  tin.position.set(152, 6, -50); tin.castShadow = true; g.add(tin);
  // crayons and a drawing of a castle at the front corners
  const draw = TX.makeCanvas(256, 180), dg = draw.getContext('2d');
  dg.fillStyle = '#fbf8ef'; dg.fillRect(0, 0, 256, 180);
  dg.strokeStyle = '#e23b2e'; dg.lineWidth = 5; dg.lineJoin = 'round';
  dg.beginPath(); dg.moveTo(40, 150); dg.lineTo(40, 70); dg.lineTo(60, 70); dg.lineTo(60, 85); dg.lineTo(80, 85); dg.lineTo(80, 70); dg.lineTo(100, 70); dg.lineTo(100, 100); dg.lineTo(160, 100); dg.lineTo(160, 60); dg.lineTo(200, 60); dg.lineTo(200, 150); dg.stroke();
  dg.fillStyle = '#f2c230'; dg.beginPath(); dg.arc(215, 35, 18, 0, TAU); dg.fill();
  dg.strokeStyle = '#2f6fe0'; dg.beginPath(); dg.moveTo(180, 60); dg.lineTo(180, 20); dg.lineTo(205, 28); dg.lineTo(180, 36); dg.stroke();
  const paper = new THREE.Mesh(new THREE.PlaneGeometry(28, 20).rotateX(-Math.PI / 2), std({ map: TX.toTexture(draw, { wrap: false }), roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -1 }));
  paper.position.set(140, 0.05, 50); paper.rotation.y = 0.2; paper.receiveShadow = true; g.add(paper);
  const cols = [0xd93a2b, 0x2c6fd6, 0xf1c232, 0x2ba150];
  cols.forEach((c, i) => {
    const cr = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 9, 10).rotateZ(Math.PI / 2), new THREE.MeshPhysicalMaterial({ color: c, roughness: 0.45, clearcoat: 0.3 }));
    cr.position.set(-150 + i * 2.2, 0.5, 52 - i * 1.5); cr.rotation.y = 0.4 + i * 0.3; cr.castShadow = true; g.add(cr);
  });

  // everything that stands still: one draw call per material
  const keep = g.children.slice();
  const still = new THREE.Group();
  for (const o of keep) if (!o.userData.live && !o.isInstancedMesh && o !== top) still.add(o);
  g.add(still);
  bake(still);
  return {
    win, curtains,
    update(t, dt, wind) {
      for (const c of curtains) c.update(t, wind);
    },
  };
}

function curtain(group, x, y, z, s) {
  const c = TX.makeCanvas(64), cg = c.getContext('2d');
  for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) { cg.fillStyle = (i + j) % 2 ? '#f7f2e8' : (i % 2 && j % 2 ? '#d9472b' : '#eba293'); cg.fillRect(i * 8, j * 8, 8, 8); }
  const geo = new THREE.PlaneGeometry(26, 104, 8, 12);
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: TX.toTexture(c, { repeat: [3, 10] }), roughness: 0.9, side: THREE.DoubleSide }));
  mesh.position.set(x, y, z); mesh.castShadow = true; mesh.userData.live = true;
  group.add(mesh);
  const base = geo.attributes.position.array.slice();
  return {
    update(t, wind) {
      const p = geo.attributes.position, k = Math.min(1, Math.abs(wind) / 30);
      for (let i = 0; i < p.count; i++) {
        const bx = base[i * 3], by = base[i * 3 + 1], hang = (52 - by) / 104;
        p.setZ(i, Math.sin(bx * 0.6 + t * 1.3) * 1.2 + hang * hang * k * (10 + 4 * Math.sin(t * 3 + by * 0.05)));
        p.setX(i, bx + hang * hang * Math.sign(wind || 1) * k * 6 * Math.sin(t * 2.2 + by * 0.04) * s);
      }
      p.needsUpdate = true;
      geo.computeVertexNormals();
    },
  };
}

// ---------- the swap shop: a cardboard box with an awning, the shopkeeper behind it ----------
export function buildStall(K) {
  const g = new THREE.Group();
  g.position.set(0, 0, -46);
  K.group.add(g);
  const std = (p) => new THREE.MeshStandardMaterial(p);
  // corrugated cardboard
  const cc = TX.makeCanvas(256), c = cc.getContext('2d');
  c.fillStyle = '#c99d66'; c.fillRect(0, 0, 256, 256);
  for (let x = 0; x < 256; x += 6) { c.fillStyle = 'rgba(120,80,40,0.12)'; c.fillRect(x, 0, 2, 256); }
  const card = std({ map: TX.toTexture(cc), roughness: 0.92 });
  // the front, with the sign painted on
  const fc = TX.makeCanvas(512, 200), f = fc.getContext('2d');
  f.drawImage(cc, 0, 0, 512, 200);
  f.fillStyle = '#fff4dc'; f.beginPath(); f.roundRect(26, 30, 460, 140, 26); f.fill();
  f.lineWidth = 8; f.strokeStyle = '#1f1a17'; f.stroke();
  f.font = '86px "Lilita One", Impact, sans-serif'; f.textAlign = 'center'; f.textBaseline = 'middle';
  f.fillStyle = '#e23b2e'; f.fillText('SWAP', 168, 104); f.fillStyle = '#2f6fe0'; f.fillText('SHOP', 360, 104);
  const front = std({ map: TX.toTexture(fc, { wrap: false }), roughness: 0.9 });
  const box = new THREE.Mesh(new THREE.BoxGeometry(46, 18, 16), [card, card, card, card, front, card]);
  box.position.set(0, 9, 0); box.castShadow = true; box.receiveShadow = true; g.add(box);
  // pencil poles and a striped paper awning
  for (const x of [-22, 22]) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 38, 6), new THREE.MeshPhysicalMaterial({ color: x < 0 ? 0xe23b2e : 0x2f6fe0, roughness: 0.4, clearcoat: 0.5 }));
    pole.position.set(x, 19, -7); pole.castShadow = true; g.add(pole);
  }
  const ac = TX.makeCanvas(256, 32), a = ac.getContext('2d');
  for (let x = 0; x < 256; x += 32) { a.fillStyle = '#e23b2e'; a.fillRect(x, 0, 16, 32); a.fillStyle = '#fff4dc'; a.fillRect(x + 16, 0, 16, 32); }
  const awning = new THREE.Mesh(new THREE.PlaneGeometry(50, 14, 1, 1), std({ map: TX.toTexture(ac, { wrap: false }), roughness: 0.85, side: THREE.DoubleSide }));
  awning.position.set(0, 36, -1); awning.rotation.x = -1.0; awning.castShadow = true; g.add(awning);
  const scal = TX.makeCanvas(256, 32), sc = scal.getContext('2d');
  for (let x = 0; x < 256; x += 32) { sc.fillStyle = x % 64 ? '#fff4dc' : '#e23b2e'; sc.beginPath(); sc.moveTo(x, 0); sc.lineTo(x + 32, 0); sc.lineTo(x + 32, 12); sc.arc(x + 16, 12, 16, 0, Math.PI); sc.fill(); }
  const fringe = new THREE.Mesh(new THREE.PlaneGeometry(50, 5), std({ map: TX.toTexture(scal, { wrap: false }), transparent: true, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.85 }));
  fringe.position.set(0, 30.6, 4.6); g.add(fringe);
  // the goods on the counter
  const goods = {};
  const put = (key, obj, x, z) => { obj.position.set(x, 18, z); g.add(obj); goods[key] = { obj, x, z, y: 18, bump: 0 }; obj.traverse((m) => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } }); bake(obj); return obj; };
  // a jar of marbles
  const jar = new THREE.Group();
  jar.add(new THREE.Mesh(new THREE.CylinderGeometry(3.6, 3.6, 9, 24, 1, true), new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.05, transparent: true, opacity: 0.25, clearcoat: 1, side: THREE.DoubleSide, depthWrite: false })));
  jar.children[0].position.y = 4.5;
  const lid = new THREE.Mesh(new THREE.CylinderGeometry(3.8, 3.8, 1.2, 24), std({ color: 0xe23b2e, roughness: 0.4 })); lid.position.y = 9.6; jar.add(lid);
  const mr = rng(9);
  for (let k = 0; k < 9; k++) { const m = ammoMesh('marble'); m.scale.setScalar(0.85); m.position.set((mr() - 0.5) * 4, 1.4 + Math.floor(k / 3) * 2.4, (mr() - 0.5) * 4); jar.add(m); }
  put('marble', jar, 14, 2);
  // erasers in a little stack
  const er = new THREE.Group();
  for (let k = 0; k < 3; k++) { const e = ammoMesh('eraser'); e.position.set(0, 1.2 + k * 2.4, 0); e.rotation.y = k * 0.4; er.add(e); }
  put('eraser', er, 4, 3);
  // paper balls in a pile
  const pb = new THREE.Group();
  for (const [x, y, z] of [[-2, 2.2, 0], [2, 2.2, 1], [0, 2.2, -2.5], [0, 5.6, 0]]) { const p = ammoMesh('paper'); p.position.set(x, y, z); p.rotation.set(x, y, z); pb.add(p); }
  put('paper', pb, -7, 2);
  // a packet of biscuits (the snacks)
  const bc = TX.makeCanvas(128, 64), b = bc.getContext('2d');
  b.fillStyle = '#f2c230'; b.fillRect(0, 0, 128, 64); b.fillStyle = '#c98a4b'; for (let k = 0; k < 3; k++) { b.beginPath(); b.arc(28 + k * 36, 36, 14, 0, TAU); b.fill(); }
  b.fillStyle = '#e23b2e'; b.font = '20px "Lilita One", Impact, sans-serif'; b.textAlign = 'center'; b.fillText('YUM', 64, 18);
  const biscuits = new THREE.Mesh(new RoundedBoxGeometry(9, 4, 5, 2, 0.8), [0, 1, 2, 3, 4, 5].map((k) => (k === 4 ? std({ map: TX.toTexture(bc, { wrap: false }), roughness: 0.6 }) : std({ color: 0xf2c230, roughness: 0.6 }))));
  const bg = new THREE.Group(); biscuits.position.y = 2; bg.add(biscuits);
  put('snack', bg, -18, 2);
  // glue bottle
  const glue = new THREE.Group();
  const gb = new THREE.Mesh(K.lathe([[0.01, 0], [2.2, 0], [2.3, 6], [1.2, 7.2], [0.01, 7.2]], 18), std({ color: 0xfbf8ef, roughness: 0.4 }));
  const gc = new THREE.Mesh(new THREE.ConeGeometry(0.9, 2.6, 12), std({ color: 0xef7d2c, roughness: 0.4 })); gc.position.y = 8.4;
  glue.add(gb, gc);
  put('glue', glue, 21, -3);
  // the shopkeeper: a big peg doll in a green cap
  const keeper = new THREE.Group();
  const kd = new THREE.Mesh(soldierGeometry(0).clone(), new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.5, clearcoat: 0.5 }));
  const col = kd.geometry.attributes.color, red = new THREE.Color(TEAM[0].main), dark = new THREE.Color(TEAM[0].dark);
  for (let i = 0; i < col.count; i++) {
    if (Math.abs(col.getX(i) - red.r) < 0.01 && Math.abs(col.getY(i) - red.g) < 0.01) col.setXYZ(i, 0.95, 0.75, 0.3);
    else if (Math.abs(col.getX(i) - dark.r) < 0.01 && Math.abs(col.getY(i) - dark.g) < 0.01) col.setXYZ(i, 0.15, 0.55, 0.3);
  }
  kd.scale.setScalar(3.4); kd.castShadow = true;
  keeper.add(kd);
  keeper.position.set(0, 0, -12);
  g.add(keeper);
  return {
    group: g, goods, keeper,
    // something was bought or sold: it hops on the counter
    bump(key) { if (goods[key]) goods[key].bump = 1; },
    update(t, dt) {
      keeper.position.y = Math.abs(Math.sin(t * 1.6)) * 0.8;
      keeper.rotation.y = Math.sin(t * 0.5) * 0.25;
      for (const k in goods) {
        const it = goods[k];
        if (it.bump > 0) { it.bump = Math.max(0, it.bump - dt * 2.5); it.obj.position.y = it.y + Math.sin(it.bump * Math.PI) * 5; it.obj.rotation.y += dt * 8 * it.bump; }
      }
    },
  };
}

// ---------- window and sky (from Tabletop Trials' venues) ----------
export function paneWindow(group, { x, y, z, w, h, sky, frame = 0xf7f4ee, depth = 3 }) {
  const cw = 512, ch = Math.round((512 * h) / w);
  const base = TX.makeCanvas(cw, ch);
  sky(base.getContext('2d'), cw, ch);
  const tex = TX.toTexture(base, { wrap: false });
  const win = new THREE.Group();
  win.position.set(x, y, z);
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color(1.6, 1.6, 1.6) }));
  win.add(glass);
  const fm = new THREE.MeshStandardMaterial({ color: frame, roughness: 0.5 });
  const bar = (bw, bh, bx, by, bd = depth) => { const m = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, bd), fm); m.position.set(bx, by, bd / 2 - 0.4); m.castShadow = true; m.receiveShadow = true; win.add(m); };
  const fw = Math.max(2.4, w * 0.04);
  bar(w + 2 * fw, fw, 0, h / 2 + fw / 2); bar(w + 2 * fw, fw, 0, -h / 2 - fw / 2);
  bar(fw, h, -w / 2 - fw / 2, 0); bar(fw, h, w / 2 + fw / 2, 0);
  bar(fw * 0.5, h, 0, 0, depth * 0.6); bar(w, fw * 0.5, 0, h * 0.1, depth * 0.6);
  const s = new THREE.Mesh(new THREE.BoxGeometry(w + 4 * fw, 1.6, 12), fm); s.position.set(0, -h / 2 - fw - 0.8, 5); s.castShadow = true; s.receiveShadow = true; win.add(s);
  group.add(win);
  return { group: win, sillY: y - h / 2 - fw };
}

export function daySky(seed = 5) {
  return (g, w, h) => {
    const r = rng(seed);
    const s = g.createLinearGradient(0, 0, 0, h);
    s.addColorStop(0, '#8fd0f5'); s.addColorStop(0.7, '#d6f0fb'); s.addColorStop(1, '#fff6dc');
    g.fillStyle = s; g.fillRect(0, 0, w, h);
    const sun = g.createRadialGradient(w * 0.25, h * 0.2, 0, w * 0.25, h * 0.2, w * 0.45);
    sun.addColorStop(0, 'rgba(255,250,225,1)'); sun.addColorStop(0.2, 'rgba(255,244,205,0.7)'); sun.addColorStop(1, 'rgba(255,244,205,0)');
    g.fillStyle = sun; g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(255,255,255,0.85)';
    for (let k = 0; k < 3; k++) { const cx = w * (0.45 + k * 0.2), cy = h * (0.25 + r() * 0.2); for (let j = 0; j < 5; j++) { g.beginPath(); g.ellipse(cx + (j - 2) * w * 0.03, cy + Math.sin(j) * h * 0.02, w * 0.045, h * 0.05, 0, 0, TAU); g.fill(); } }
    for (const [cx, cy, n] of [[w * 0.95, 0, 40], [w * 0.05, -h * 0.05, 26]]) {
      for (let k = 0; k < n; k++) {
        const a = r() * TAU, d = r() * w * 0.22;
        g.fillStyle = ['#4f9a4a', '#6cb35a', '#3d7f3f', '#86c46a'][k % 4];
        g.globalAlpha = 0.85;
        g.beginPath(); g.ellipse(cx + Math.cos(a) * d, cy + Math.abs(Math.sin(a)) * d * 0.9, w * 0.035, h * 0.03, a, 0, TAU); g.fill();
      }
      g.globalAlpha = 1;
    }
    g.fillStyle = '#7fbf6a';
    for (let x = 0; x < w; x += w * 0.04) { g.beginPath(); g.arc(x, h * 1.02, w * 0.05, 0, TAU); g.fill(); }
  };
}
