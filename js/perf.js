// Frame pacing, dynamic resolution, the Auto quality ladder, the performance overlay and the
// "built-in graphics" hint. main.js calls frameStart() on every requestAnimationFrame and
// frameDone() after each frame it actually renders.

const AUTO_KEY = 'tabletop-towers.auto.v1';     // remembered Auto tier for this device
const HINT_KEY = 'tabletop-towers.gpu-hint.v1'; // the integrated-GPU hint was dismissed
const AUTO_TTL = 7 * 24 * 3600 * 1000;         // re-test the device after a week

export class Perf {
  constructor(R, { onScaleChange, onTierChange } = {}) {
    this.R = R;
    this.onScaleChange = onScaleChange || (() => {});
    this.onTierChange = onTierChange || (() => {});
    // refresh rate, from the spacing of requestAnimationFrame callbacks (median of the last 90)
    this.rafDeltas = [];
    this.lastRaf = 0;
    this.refreshMs = 1000 / 60;
    this.tick = 0;
    this.cap = true;       // render at most ~60 fps, evenly paced (every k-th refresh)
    this.k = 1;
    // dynamic resolution and the Auto ladder (active only while racing on Auto)
    this.auto = false;
    this.win = []; this.winT = 0;
    this.cool = 0; this.goodT = 0; this.minT = 0; this.lastUpAt = -1e9; this.upBlockedUntil = 0;
    this.slowT = 0; this.raceT = 0;
    this.clock = 0;
    // overlay stats
    this.statFrames = 0; this.statSum = 0; this.statMax = 0; this.statT = 0;
    this.overlay = null;
    this.hintPending = false;
  }

  // ---------- frame pacing ----------
  // Returns false when this refresh should be skipped (frame cap on high-refresh screens).
  frameStart(now) {
    if (this.lastRaf) {
      const d = now - this.lastRaf;
      if (d > 3 && d < 60) {
        this.rafDeltas.push(d);
        if (this.rafDeltas.length > 90) this.rafDeltas.shift();
        if (this.rafDeltas.length >= 15 && (this.tick & 15) === 0) {
          const s = [...this.rafDeltas].sort((a, b) => a - b);
          this.refreshMs = s[s.length >> 1];
        }
      }
    }
    this.lastRaf = now;
    this.tick++;
    // 120 Hz → every 2nd refresh (60 fps), 144 Hz → 72, 165 Hz → 82, 240 Hz → every 4th; 60–100 Hz → every one
    const hz = 1000 / this.refreshMs;
    this.k = this.cap ? Math.max(1, Math.floor(hz / 60 + 0.15)) : 1;
    return this.tick % this.k === 0;
  }

  get targetMs() { return this.refreshMs * this.k; }

  // ---------- Auto: dynamic resolution and quality ladder ----------
  static rememberedTier() {
    try {
      const a = JSON.parse(localStorage.getItem(AUTO_KEY) || 'null');
      if (a && ['low', 'medium', 'high'].includes(a.tier) && Date.now() - a.t < AUTO_TTL) return a.tier;
    } catch (e) { /* ignore */ }
    return null;
  }
  // where Auto starts: what this device settled on before, else High on a graphics card, else Medium
  static autoTier(R) { return Perf.rememberedTier() || (R.gpuLooksStrong() ? 'high' : 'medium'); }
  static rememberTier(tier) {
    try { localStorage.setItem(AUTO_KEY, JSON.stringify({ tier, t: Date.now() })); } catch (e) { /* ignore */ }
  }
  static forgetTier() { try { localStorage.removeItem(AUTO_KEY); } catch (e) { /* ignore */ } }

  setAuto(on) {
    this.auto = on;
    this.resetWindow();
    if (!on && this.R.renderScale !== 1) { this.R.setRenderScale(1); this.onScaleChange(); }
  }

  resetWindow() { this.win = []; this.winT = 0; this.goodT = 0; this.minT = 0; this.cool = 1.0; this.slowT = 0; this.raceT = 0; }

  // dtMs: time since the previous rendered frame. racing: a race is running (not paused, not in menus).
  frameDone(dtMs, racing) {
    this.clock += dtMs / 1000;
    // overlay numbers
    this.statFrames++; this.statSum += dtMs; this.statMax = Math.max(this.statMax, dtMs);
    this.statT += dtMs;
    if (this.statT >= 250) { this.updateOverlay(); this.statFrames = 0; this.statSum = 0; this.statMax = 0; this.statT = 0; }

    if (!racing) return;
    // ignore frames that include a long stall (tab switch, garbage collection burst)
    if (dtMs > 250) return;
    this.raceT += dtMs / 1000;
    if (this.raceT < 1.5) return; // let the race settle after the countdown starts
    this.win.push(dtMs); this.winT += dtMs;
    while (this.winT > 1000 && this.win.length > 1) this.winT -= this.win.shift();
    if (this.winT < 600) return;
    const avg = this.winT / this.win.length;
    const target = this.targetMs;
    const slow = avg > target * 1.2;
    const dt = dtMs / 1000;

    // remember how often the frame rate falls well short: drives the integrated-GPU hint
    // (or Auto had to cut resolution or quality to keep up)
    if (avg > target * 1.3 || avg > 22 || (this.auto && (this.R.renderScale < 0.8 || this.R.qualityName === 'low'))) this.slowT += dt;

    if (!this.auto) return;
    this.cool -= dt;
    if (slow) {
      this.goodT = 0;
      if (this.cool > 0) return;
      if (this.R.renderScale > 0.6) {
        // a drop right after a step up means the step up was too much: stay put for a while
        // (each failed attempt waits twice as long before the next: 25 s, 50 s, 100 s, 2 min)
        if (this.clock - this.lastUpAt < 4) { this.upBackoff = Math.min(120, (this.upBackoff || 12.5) * 2); this.upBlockedUntil = this.clock + this.upBackoff; }
        if (this.R.setRenderScale(this.R.renderScale * 0.85)) this.onScaleChange();
        this.cool = 1.5; this.win = []; this.winT = 0;
      } else {
        this.minT += 1.5; this.cool = 1.5;
        // already at the lowest render scale and still slow: one quality step down
        if (this.minT >= 4.5 && this.R.qualityName !== 'low') {
          const next = this.R.qualityName === 'high' ? 'medium' : 'low';
          Perf.rememberTier(next);
          this.onTierChange(next);
          this.R.setRenderScale(0.85);
          this.onScaleChange();
          this.minT = 0; this.cool = 2; this.win = []; this.winT = 0;
        }
      }
    } else if (avg < target * 1.06) {
      this.minT = 0;
      this.goodT += dt;
      if (this.goodT > 4 && this.R.renderScale < 1 && this.clock > this.upBlockedUntil && this.cool <= 0) {
        if (this.R.setRenderScale(this.R.renderScale * 1.1)) this.onScaleChange();
        this.lastUpAt = this.clock; this.goodT = 0; this.cool = 1.5; this.win = []; this.winT = 0;
      }
    } else this.goodT = 0;
  }

  // ---------- integrated-GPU hint ----------
  // True once per device when a race ran clearly slow on Windows integrated graphics.
  shouldHint() {
    if (this.hintPending) return true;
    let dismissed = false;
    try { dismissed = !!localStorage.getItem(HINT_KEY); } catch (e) { /* ignore */ }
    if (dismissed || this.slowT < 4) return false;
    if (!/Windows/.test(navigator.userAgent) || !this.R.gpuLooksIntegrated()) return false;
    this.hintPending = true;
    return true;
  }
  dismissHint() {
    this.hintPending = false; this.slowT = 0;
    try { localStorage.setItem(HINT_KEY, '1'); } catch (e) { /* ignore */ }
  }

  // ---------- overlay ----------
  toggleOverlay(on = !this.overlay) {
    if (on && !this.overlay) {
      const el = document.createElement('div');
      el.id = 'perf';
      el.setAttribute('aria-hidden', 'true');
      document.body.appendChild(el);
      this.overlay = el;
      this.updateOverlay();
    } else if (!on && this.overlay) {
      this.overlay.remove();
      this.overlay = null;
    }
  }

  updateOverlay() {
    if (!this.overlay) return;
    const R = this.R, r = R.renderer, info = r.info;
    const n = Math.max(1, this.statFrames);
    const avg = this.statSum / n;
    const buf = r.domElement;
    const hz = Math.round(1000 / this.refreshMs);
    const pr = r.getPixelRatio();
    const lines = [
      `${(1000 / Math.max(1, avg)).toFixed(0)} fps · ${avg.toFixed(1)} ms (worst ${this.statMax.toFixed(1)})`,
      `screen ${hz} Hz · ${this.cap ? `60 fps cap: renders ${this.k === 1 ? 'every refresh' : `every ${this.k === 2 ? '2nd' : this.k === 3 ? '3rd' : this.k + 'th'} refresh`}` : 'no cap'}`,
      `${buf.width}×${buf.height} · pixel ratio ${pr.toFixed(2)} · scale ${Math.round(R.renderScale * 100)}%`,
      `quality ${R.qualityName}${this.auto ? ' (auto)' : ''} · tilt-shift ${R.quality.tiltMode}`,
      `draw calls ${info.render.calls} · triangles ${(info.render.triangles / 1000).toFixed(0)}k`,
      `shaders ${info.programs ? info.programs.length : '?'} · textures ${info.memory.textures} · geometries ${info.memory.geometries}`,
      `GPU ${R.gpu || 'unknown'}${R.gpuLooksIntegrated() ? ' (integrated)' : ''}`,
    ];
    this.overlay.textContent = lines.join('\n');
  }
}
