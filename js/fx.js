// Visual effects: skid marks and soft particles (dust, crumbs, splashes, smoke puffs).
import * as THREE from '../vendor/three.bundle.js';

export class SkidMarks {
  constructor(group, max = 2400) {
    this.max = max;
    this.pos = new Float32Array(max * 4 * 3);
    this.alpha = new Float32Array(max * 4);
    const idx = new Uint32Array(max * 6);
    for (let i = 0; i < max; i++) {
      idx.set([i * 4, i * 4 + 2, i * 4 + 1, i * 4 + 1, i * 4 + 2, i * 4 + 3], i * 6);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
    this.mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      uniforms: { color: { value: new THREE.Color(0x15110e) } },
      vertexShader: `attribute float alpha; varying float vA; void main(){ vA = alpha; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }`,
      fragmentShader: `uniform vec3 color; varying float vA; void main(){ gl_FragColor = vec4(color, vA); }`,
      polygonOffset: true, polygonOffsetFactor: -1,
    });
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.renderOrder = 2;
    this.mesh.frustumCulled = false;
    group.add(this.mesh);
    this.n = 0;
    this.last = new Map(); // key -> {x,z}
  }
  setColor(c) { this.mat.uniforms.color.value.set(c); }
  // a wheel at (x, y, z) moving; width w, strength 0..1
  add(key, x, y, z, w, strength) {
    const prev = this.last.get(key);
    this.last.set(key, { x, z, y });
    if (!prev || strength <= 0) return;
    const dx = x - prev.x, dz = z - prev.z;
    const l = Math.hypot(dx, dz);
    if (l < 0.05 || l > 3) return;
    const nx = -dz / l * w / 2, nz = dx / l * w / 2;
    const i = this.n % this.max;
    const p = this.pos, yy = y + 0.045;
    p.set([prev.x + nx, prev.y + 0.045, prev.z + nz, prev.x - nx, prev.y + 0.045, prev.z - nz, x + nx, yy, z + nz, x - nx, yy, z - nz], i * 12);
    const a = Math.min(0.55, strength * 0.55);
    this.alpha.set([a, a, a, a], i * 4);
    this.n++;
    this.mesh.geometry.attributes.position.needsUpdate = true;
    this.mesh.geometry.attributes.alpha.needsUpdate = true;
  }
  break(key) { this.last.delete(key); }
}

let dotTex = null;
function dotTexture() {
  if (dotTex) return dotTex;
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.5, 'rgba(255,255,255,0.6)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  dotTex = new THREE.CanvasTexture(c);
  return dotTex;
}

export class Particles {
  constructor(group, max = 1500) {
    this.max = max;
    this.p = new Float32Array(max * 3);
    this.v = new Float32Array(max * 3);
    this.c = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.size = new Float32Array(max);
    this.alpha = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.grow = new Float32Array(max);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.p, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.c, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
    this.mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      uniforms: { map: { value: dotTexture() }, scale: { value: 600 } },
      vertexShader: `attribute float size; attribute float alpha; attribute vec3 color; varying float vA; varying vec3 vC; uniform float scale;
        void main(){ vA = alpha; vC = color; vec4 mv = modelViewMatrix * vec4(position,1.); gl_PointSize = size * scale / -mv.z; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform sampler2D map; varying float vA; varying vec3 vC; void main(){ vec4 t = texture2D(map, gl_PointCoord); gl_FragColor = vec4(vC, t.a * vA); }`,
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 3;
    group.add(this.points);
    this.i = 0;
    this.col = new THREE.Color();
  }
  setScale(s) { this.mat.uniforms.scale.value = s; }
  emit(x, y, z, { vx = 0, vy = 0, vz = 0, spread = 2, up = 3, color = 0xffffff, size = 1, life = 0.6, alpha = 0.8, grav = 20, grow = 1, n = 1 } = {}) {
    this.col.set(color);
    for (let k = 0; k < n; k++) {
      const i = this.i; this.i = (this.i + 1) % this.max;
      this.p[i * 3] = x; this.p[i * 3 + 1] = y; this.p[i * 3 + 2] = z;
      this.v[i * 3] = vx + (Math.random() - 0.5) * spread;
      this.v[i * 3 + 1] = vy + Math.random() * up;
      this.v[i * 3 + 2] = vz + (Math.random() - 0.5) * spread;
      const k2 = 0.85 + Math.random() * 0.3;
      this.c[i * 3] = this.col.r * k2; this.c[i * 3 + 1] = this.col.g * k2; this.c[i * 3 + 2] = this.col.b * k2;
      this.life[i] = this.maxLife[i] = life * (0.7 + Math.random() * 0.6);
      this.size[i] = size * (0.7 + Math.random() * 0.6);
      this.alpha[i] = alpha;
      this.grav[i] = grav;
      this.grow[i] = grow;
    }
  }
  update(dt) {
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) { if (this.alpha[i] !== 0) this.alpha[i] = 0; continue; }
      this.life[i] -= dt;
      const t = Math.max(0, this.life[i] / this.maxLife[i]);
      this.v[i * 3 + 1] -= this.grav[i] * dt;
      const drag = Math.exp(-2.5 * dt);
      this.v[i * 3] *= drag; this.v[i * 3 + 2] *= drag;
      this.p[i * 3] += this.v[i * 3] * dt;
      this.p[i * 3 + 1] = Math.max(0.05, this.p[i * 3 + 1] + this.v[i * 3 + 1] * dt);
      this.p[i * 3 + 2] += this.v[i * 3 + 2] * dt;
      this.size[i] *= 1 + (this.grow[i] - 1) * dt;
      this.alpha[i] = Math.min(this.alpha[i], t * 0.9 + 0.0001);
    }
    const g = this.points.geometry;
    g.attributes.position.needsUpdate = true; g.attributes.size.needsUpdate = true; g.attributes.alpha.needsUpdate = true; g.attributes.color.needsUpdate = true;
  }
}
