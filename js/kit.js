// Helpers for building the room: materials, instancing, contact shadows, merging. From Tabletop Turbo
// (via Tabletop Trials), without the track and physics parts.
import * as THREE from '../vendor/three.bundle.js';
import { RoundedBoxGeometry, BufferGeometryUtils } from '../vendor/three.bundle.js';
import * as TX from './textures.js';
import { rng, TAU } from './util.js';

export function makeKit({ scene, quality, seed = 7 }) {
  const group = new THREE.Group();
  scene.add(group);
  const r = rng(seed);

  const kit = {
    THREE, TX, RoundedBoxGeometry, BufferGeometryUtils, group, quality, r, rng, TAU,

    add(obj, { cast = true, receive = true, parent = group } = {}) {
      obj.traverse((o) => { if (o.isMesh) { o.castShadow = cast; o.receiveShadow = receive; } });
      parent.add(obj);
      return obj;
    },
    mesh(geo, mat, x = 0, y = 0, z = 0, opts = {}) {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      if (opts.ry) m.rotation.y = opts.ry;
      if (opts.rx) m.rotation.x = opts.rx;
      if (opts.rz) m.rotation.z = opts.rz;
      if (opts.scale) m.scale.setScalar(opts.scale);
      return kit.add(m, opts);
    },
    std(params) { return new THREE.MeshStandardMaterial(params); },
    phys(params) { return new THREE.MeshPhysicalMaterial(params); },
    plastic(color, rough = 0.35, extra = {}) { return new THREE.MeshPhysicalMaterial({ color, roughness: rough, metalness: 0, clearcoat: 0.3, clearcoatRoughness: 0.3, ...extra }); },
    paint(color, extra = {}) { return new THREE.MeshPhysicalMaterial({ color, roughness: 0.45, clearcoat: 0.55, clearcoatRoughness: 0.25, ...extra }); },
    felt(color, extra = {}) { return new THREE.MeshPhysicalMaterial({ color, roughness: 0.95, sheen: 1, sheenRoughness: 0.55, sheenColor: 0xffffff, ...extra }); },
    metal(color = 0xd8dade, rough = 0.2, extra = {}) { return new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 1, ...extra }); },
    glass(color = 0xffffff, opacity = 0.22, extra = {}) {
      return new THREE.MeshPhysicalMaterial({ color, roughness: 0.04, metalness: 0, transparent: true, opacity, clearcoat: 1, clearcoatRoughness: 0.02, depthWrite: false, side: THREE.DoubleSide, envMapIntensity: 1.6, ...extra });
    },
    lathe(profile, segs = 48) { return new THREE.LatheGeometry(profile.map(([rr, h]) => new THREE.Vector2(rr, h)), segs); },

    // soft dark blob under an object = cheap ambient occlusion
    contact(x, z, rx, rz = rx, opacity = 0.35, angle = 0, y = 0.03) {
      const m = new THREE.Mesh(kit._blobGeo || (kit._blobGeo = new THREE.PlaneGeometry(1, 1)),
        new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity, alphaMap: TX.blobShadowTexture(), depthWrite: false }));
      m.rotation.x = -Math.PI / 2; m.rotation.z = -angle;
      m.scale.set(rx * 2, rz * 2, 1);
      m.position.set(x, y, z);
      m.renderOrder = 1;
      group.add(m);
      return m;
    },

    // InstancedMesh from a list of {x,y,z,ry,rx,rz,s|sx,sy,sz,color}
    instances(geo, mat, list, { cast = true, receive = true, colors = false, parent = group } = {}) {
      const im = new THREE.InstancedMesh(geo, mat, list.length);
      const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), s = new THREE.Vector3();
      const col = new THREE.Color();
      list.forEach((t, i) => {
        e.set(t.rx || 0, t.ry || 0, t.rz || 0, t.order || 'YXZ');
        q.setFromEuler(e);
        p.set(t.x, t.y || 0, t.z);
        s.set(t.sx ?? t.s ?? 1, t.sy ?? t.s ?? 1, t.sz ?? t.s ?? 1);
        m4.compose(p, q, s);
        im.setMatrixAt(i, m4);
        if (colors && t.color != null) im.setColorAt(i, col.set(t.color));
      });
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
      im.castShadow = cast; im.receiveShadow = receive;
      im.computeBoundingSphere();
      parent.add(im);
      return im;
    },

    // Merge parts [{geo, color, matrix|pos/rot/scale}] into one vertex-coloured geometry.
    merge(parts) {
      const geos = parts.map((p) => {
        const g = p.geo.index ? p.geo.toNonIndexed() : p.geo.clone();
        const m = p.matrix || new THREE.Matrix4().compose(
          new THREE.Vector3(...(p.pos || [0, 0, 0])),
          new THREE.Quaternion().setFromEuler(new THREE.Euler(...(p.rot || [0, 0, 0]), 'YXZ')),
          new THREE.Vector3(...(Array.isArray(p.scale) ? p.scale : [p.scale ?? 1, p.scale ?? 1, p.scale ?? 1])));
        g.applyMatrix4(m);
        const c = new THREE.Color(p.color ?? 0xffffff);
        const n = g.attributes.position.count;
        const cols = new Float32Array(n * 3);
        for (let i = 0; i < n; i++) { cols[i * 3] = c.r; cols[i * 3 + 1] = c.g; cols[i * 3 + 2] = c.b; }
        g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
        for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(k)) g.deleteAttribute(k);
        if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
        return g;
      });
      return BufferGeometryUtils.mergeGeometries(geos, false);
    },

    dispose() {
      group.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) {
          const ms = Array.isArray(o.material) ? o.material : [o.material];
          for (const m of ms) {
            for (const k of ['map', 'normalMap', 'roughnessMap', 'alphaMap', 'bumpMap', 'emissiveMap']) {
              if (m[k] && m[k] !== TX.blobShadowTexture() && !m[k].userData.shared) m[k].dispose();
            }
            m.dispose();
          }
        }
      });
      scene.remove(group);
    },
  };
  return kit;
}
