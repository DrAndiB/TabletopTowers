// Synthesised sound, no audio files (after Tabletop Trials): wooden blocks clacking, the rubber band
// of a spoon catapult, marbles, erasers and paper balls landing, piggy banks smashing, coins, the cat,
// the dinner bell; the kitchen's background life; and quiet three-voice chip tunes (our own).
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
const rand = (a, b) => a + Math.random() * (b - a);

export class Sound {
  constructor() {
    this.ctx = null;
    this.muted = false;
    try { this.muted = localStorage.getItem('tabletop-towers.muted') === '1'; } catch (e) { /* ignore */ }
    this.unlocked = false;
    this.wantSong = null;
    this.musicLevel = 1;
    this.lastClack = 0;
    const unlock = () => {
      this.unlocked = true;
      for (const ev of ['pointerdown', 'keydown', 'touchstart']) window.removeEventListener(ev, unlock, true);
      this.ensure();
      if (this.wantSong) this.playMusic(this.wantSong, this.musicLevel);
    };
    for (const ev of ['pointerdown', 'keydown', 'touchstart']) window.addEventListener(ev, unlock, true);
  }

  ensure() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return true; }
    if (!this.unlocked) return false;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.85;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 4;
    this.master.connect(comp).connect(ctx.destination);
    this.sfx = ctx.createGain(); this.sfx.gain.value = 0.9; this.sfx.connect(this.master);
    this.music = ctx.createGain(); this.music.gain.value = 0;
    const mlp = ctx.createBiquadFilter(); mlp.type = 'lowpass'; mlp.frequency.value = 4600; mlp.Q.value = 0.6;
    this.music.connect(mlp).connect(this.master);
    // the kitchen: a little reverb on everything but the music
    this.verb = ctx.createConvolver();
    this.send = ctx.createGain(); this.send.gain.value = 0.16;
    this.sfx.connect(this.send).connect(this.verb).connect(this.master);
    this.ambBus = ctx.createGain(); this.ambBus.gain.value = 1; this.ambBus.connect(this.sfx);
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noise = buf;
    this.verb.buffer = this.impulse(0.95, 0.62);
    this.buildLoops();
    this.amb = { clock: ctx.currentTime + 1, spoon: ctx.currentTime + 6, birds: ctx.currentTime + 3 };
    this.startTicker();
    return true;
  }

  setMuted(m) {
    this.muted = m;
    try { localStorage.setItem('tabletop-towers.muted', m ? '1' : '0'); } catch (e) { /* ignore */ }
    if (this.master) this.master.gain.setTargetAtTime(m ? 0 : 0.85, this.ctx.currentTime, 0.05);
  }

  // ---------- building blocks ----------
  out(node, pan = 0) {
    if (pan && this.ctx.createStereoPanner) {
      const p = this.ctx.createStereoPanner(); p.pan.value = Math.max(-0.9, Math.min(0.9, pan));
      node.connect(p); p.connect(this.sfx);
    } else node.connect(this.sfx);
  }
  tone(freq, dur, { type = 'square', vol = 0.2, when = 0, slideTo = null, attack = 0.005, pan = 0, vib = 0, vibRate = 6 } = {}) {
    if (!this.ensure()) return;
    const ctx = this.ctx, t = ctx.currentTime + when;
    const o = ctx.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    if (vib) {
      const l = ctx.createOscillator(); l.frequency.value = vibRate;
      const lg = ctx.createGain(); lg.gain.value = vib;
      l.connect(lg).connect(o.frequency); l.start(t); l.stop(t + dur + 0.05);
    }
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    this.out(g, pan);
    o.start(t); o.stop(t + dur + 0.05);
  }
  noiseBurst(dur, { freq = 800, q = 1, vol = 0.3, type = 'lowpass', pan = 0, when = 0, attack = 0.002 } = {}) {
    if (!this.ensure()) return;
    const ctx = this.ctx, t = ctx.currentTime + when;
    const s = ctx.createBufferSource(); s.buffer = this.noise;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g);
    this.out(g, pan);
    s.start(t, Math.random() * 1.5); s.stop(t + dur + 0.05);
  }
  sweep(dur, { from = 500, to = 2000, q = 1.2, vol = 0.1, type = 'bandpass', pan = 0, attack = 0.1, when = 0 } = {}) {
    if (!this.ensure()) return;
    const ctx = this.ctx, t = ctx.currentTime + when;
    const s = ctx.createBufferSource(); s.buffer = this.noise;
    const f = ctx.createBiquadFilter(); f.type = type; f.Q.value = q;
    f.frequency.setValueAtTime(from, t); f.frequency.exponentialRampToValueAtTime(to, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g);
    this.out(g, pan);
    s.start(t, Math.random() * 1.2); s.stop(t + dur + 0.05);
  }
  impulse(decay, bright) {
    const ctx = this.ctx, rate = ctx.sampleRate, len = Math.round(rate * decay), pre = Math.round(rate * 0.012);
    const buf = ctx.createBuffer(2, len, rate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let lp = 0;
      for (let i = pre; i < len; i++) {
        const t = (i - pre) / rate, k = (0.12 + 0.8 * bright) * Math.exp(-t * 2 / decay);
        lp += k * (Math.random() * 2 - 1 - lp);
        d[i] = lp * Math.exp((-t * 6.9) / decay);
      }
    }
    return buf;
  }

  // the draft through the window
  buildLoops() {
    const ctx = this.ctx;
    const s = ctx.createBufferSource(); s.buffer = this.noise; s.loop = true;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 600; f.Q.value = 0.7;
    const g = ctx.createGain(); g.gain.value = 0;
    s.connect(f).connect(g).connect(this.sfx);
    s.start();
    this.windLoop = { f, g };
  }
  setWind(level) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.windLoop.g.gain.setTargetAtTime(Math.max(0, Math.min(1, level)) * 0.05, t, 0.3);
    this.windLoop.f.frequency.setTargetAtTime(450 + level * 500, t, 0.3);
  }

  // ---------- the kitchen's background life ----------
  startTicker() {
    if (this.tickTimer) return;
    const tick = () => {
      this.tickTimer = setTimeout(tick, 80);
      if (!this.ctx || this.ctx.state !== 'running') return;
      const now = this.ctx.currentTime, until = now + 0.25;
      for (const k in this.amb) {
        let t = this.amb[k];
        while (t < until) t += this.ambient(k, Math.max(t, now));
        this.amb[k] = t;
      }
    };
    tick();
  }
  blip(t, f, dur, { type = 'sine', vol = 0.03, slide = 1, pan = 0, attack = 0.004 } = {}) {
    const ctx = this.ctx;
    const o = ctx.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(f, t); if (slide !== 1) o.frequency.exponentialRampToValueAtTime(f * slide, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + attack); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    if (pan && ctx.createStereoPanner) { const p = ctx.createStereoPanner(); p.pan.value = pan; g.connect(p).connect(this.ambBus); } else g.connect(this.ambBus);
    o.start(t); o.stop(t + dur + 0.05);
  }
  tick(t, dur, { freq = 3000, q = 1, type = 'bandpass', vol = 0.02 } = {}) {
    const ctx = this.ctx;
    const s = ctx.createBufferSource(); s.buffer = this.noise;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(this.ambBus);
    s.start(t, Math.random() * 1.5); s.stop(t + dur + 0.02);
  }
  ambient(kind, t) {
    switch (kind) {
      case 'clock': this.tock = !this.tock; this.tick(t, 0.02, { freq: this.tock ? 2400 : 2900, q: 6, vol: 0.006 }); return 1;
      case 'spoon': { const f = rand(2900, 3400); this.blip(t, f, 0.35, { vol: 0.007, pan: rand(-0.5, 0.5) }); this.blip(t, f * 2.4, 0.2, { vol: 0.003 }); return rand(9, 18); }
      case 'birds': { const f = rand(3200, 4400), n = 3 + Math.floor(Math.random() * 4); for (let k = 0; k < n; k++) this.blip(t + k * 0.09, f * rand(0.92, 1.12), 0.06, { vol: 0.006, slide: rand(1.1, 1.4), pan: 0.1 }); return rand(5, 11); }
      default: return 999;
    }
  }

  // ---------- game sounds ----------
  click() { this.tone(1500, 0.035, { type: 'triangle', vol: 0.06 }); }
  pick() { this.tone(988, 0.08, { type: 'triangle', vol: 0.08 }); this.tone(1319, 0.12, { type: 'triangle', vol: 0.07, when: 0.06 }); }
  nope() { this.tone(220, 0.14, { type: 'triangle', vol: 0.1, slideTo: 180 }); }
  // the shop till: a bell and coins
  till() { this.tone(2093, 0.5, { type: 'sine', vol: 0.09 }); this.tone(2637, 0.4, { type: 'sine', vol: 0.05, when: 0.02 }); this.coins(3, 0.08); }
  coins(n = 4, when = 0) { for (let k = 0; k < n; k++) { const t = when + k * rand(0.04, 0.08); this.tone(rand(3600, 4800), 0.12, { type: 'sine', vol: 0.05, when: t }); this.tone(rand(5200, 6400), 0.06, { type: 'sine', vol: 0.02, when: t }); } }
  // the rubber band lets go
  twang(power = 1) {
    this.tone(120 + power * 60, 0.35, { type: 'triangle', vol: 0.22, slideTo: 60, vib: 18, vibRate: 30 });
    this.noiseBurst(0.08, { freq: 1800, q: 2, type: 'bandpass', vol: 0.12 });
    this.sweep(0.5, { from: 500, to: 1800, q: 0.8, vol: 0.05 * (0.5 + power), attack: 0.1 });
  }
  stretch(tension) {
    if (!this.ensure()) return;
    const now = this.ctx.currentTime;
    if (now - (this.lastStretch || 0) < 0.07) return;
    this.lastStretch = now;
    this.tone(180 + tension * 140, 0.06, { type: 'sawtooth', vol: 0.018 });
  }
  // two wooden blocks knocking together: a short resonant click, deeper for big blocks
  clack(v = 1, pan = 0, deep = false) {
    if (!this.ensure()) return;
    const now = this.ctx.currentTime;
    if (now - this.lastClack < 0.018) return;
    this.lastClack = now;
    const vol = Math.min(0.28, 0.04 + v * 0.03);
    const f = (deep ? 520 : 900) * rand(0.85, 1.25);
    this.tone(f, 0.08, { type: 'triangle', vol: vol * 0.8, pan, slideTo: f * 0.85 });
    this.noiseBurst(0.04, { freq: f * 2.6, q: 4, type: 'bandpass', vol: vol * 0.7, pan });
  }
  thud(v = 1, pan = 0) { this.tone(90, 0.22, { type: 'sine', vol: Math.min(0.3, 0.08 + v * 0.04), slideTo: 50, pan }); this.noiseBurst(0.12, { freq: 400, vol: 0.06 * v, pan }); }
  clink(v = 1, pan = 0) { const f = rand(3000, 4200); this.tone(f, 0.25, { type: 'sine', vol: Math.min(0.16, 0.04 + v * 0.03), pan }); this.tone(f * 1.52, 0.18, { type: 'sine', vol: 0.03, pan }); }
  boing(v = 1, pan = 0) { this.tone(rand(180, 240), 0.25, { type: 'sine', vol: Math.min(0.2, 0.06 + v * 0.03), slideTo: 420, pan }); }
  paperHit(v = 1, pan = 0) { this.noiseBurst(0.12, { freq: 2200, q: 0.6, type: 'bandpass', vol: Math.min(0.14, 0.03 + v * 0.03), pan }); }
  // glazed clay breaking: a knock, then shards
  smash(pan = 0) {
    this.tone(160, 0.25, { type: 'sine', vol: 0.25, slideTo: 70, pan });
    for (let k = 0; k < 14; k++) { const t = k * rand(0.01, 0.04); this.tone(rand(2500, 6000), rand(0.05, 0.15), { type: 'sine', vol: rand(0.02, 0.06), when: t, pan: pan + rand(-0.3, 0.3) }); }
    this.noiseBurst(0.35, { freq: 4500, q: 0.7, type: 'highpass', vol: 0.12, pan });
    this.coins(6, 0.15);
  }
  whoosh(vol = 1) { this.sweep(0.8, { from: 300, to: 2400, q: 0.9, vol: 0.09 * vol, attack: 0.25 }); }
  pop() { this.tone(500, 0.12, { type: 'sine', vol: 0.16, slideTo: 1100 }); }
  meow() { const t0 = 0; this.tone(560, 0.5, { type: 'sawtooth', vol: 0.05, slideTo: 760, vib: 10, when: t0 }); this.tone(760, 0.4, { type: 'sawtooth', vol: 0.04, slideTo: 420, when: t0 + 0.45 }); }
  purr(dur = 2) { for (let k = 0; k < dur * 4; k++) this.tone(52 * rand(0.95, 1.05), 0.2, { type: 'sawtooth', vol: 0.03, when: k * 0.26 }); }
  bell() { for (let k = 0; k < 6; k++) { this.tone(1760, 0.6, { type: 'triangle', vol: 0.1, when: k * 0.14 }); this.tone(3520 * 1.18, 0.3, { type: 'sine', vol: 0.03, when: k * 0.14 }); } }
  sparkle() { [88, 91, 95, 100, 103].forEach((m, i) => this.tone(mtof(m), 0.3, { type: 'sine', vol: 0.05, when: i * 0.06 })); }
  aww() { [62, 61, 60, 59].forEach((m, i) => this.kazoo(m - 12, i === 3 ? 0.7 : 0.28, i * 0.3, 0.08)); }

  kazoo(midi, dur, when = 0, vol = 0.09) {
    if (!this.ensure()) return;
    const ctx = this.ctx, t = ctx.currentTime + when;
    const o = ctx.createOscillator(); o.setPeriodicWave(this.pulseWave(0.25)); o.frequency.value = mtof(midi);
    const l = ctx.createOscillator(); l.frequency.value = 5.5;
    const lg = ctx.createGain(); lg.gain.value = mtof(midi) * 0.008;
    l.connect(lg).connect(o.frequency);
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 3200; f.Q.value = 0.7;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol * 0.7, t + 0.01);
    g.gain.setValueAtTime(vol * 0.7, t + dur * 0.8); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(f).connect(g).connect(this.sfx);
    o.start(t); l.start(t); o.stop(t + dur + 0.05); l.stop(t + dur + 0.05);
  }
  piano(midi, dur = 0.5, when = 0, vol = 0.12) {
    this.tone(mtof(midi), dur, { type: 'triangle', vol, when, attack: 0.003 });
    this.tone(mtof(midi) * 2, dur * 0.5, { type: 'sine', vol: vol * 0.3, when, attack: 0.003 });
  }
  // a castle's turn: its own little call on the kazoo
  turnCall(side) {
    const seq = side ? [[67, 0.12], [71, 0.12], [74, 0.3]] : [[60, 0.12], [64, 0.12], [67, 0.3]];
    let t = 0;
    for (const [m, d] of seq) { this.kazoo(m, d + 0.02, t, 0.08); t += d; }
  }
  fanfare() {
    const seq = [[67, 0.14], [72, 0.14], [76, 0.14], [79, 0.32], [76, 0.14], [79, 0.6]];
    let t = 0;
    for (const [m, d] of seq) { this.kazoo(m, d + 0.03, t, 0.08); this.kazoo(m - 12, d + 0.03, t, 0.05); t += d; }
  }

  // ---------- music: three-voice chip tunes ----------
  playMusic(name, level = 1) {
    this.wantSong = name; this.musicLevel = level;
    if (!this.ensure()) return;
    const t = this.ctx.currentTime, S = SONGS[name];
    if (!S) return;
    this.music.gain.cancelScheduledValues(t);
    this.music.gain.setTargetAtTime(MUSIC_VOL * level, t, 0.4);
    if (this.song && this.song.name === name && !this.song.stopping) return;
    if (!S.bars) S.bars = S.lead.map(parseBar);
    this.song = { name, S, k: 0, t: t + 0.15, dur: 60 / S.bpm / 4 };
    if (!this.musicTimer) {
      const tick = () => {
        this.musicTimer = setTimeout(tick, 60);
        const song = this.song;
        if (!song || this.ctx.state !== 'running') return;
        const until = this.ctx.currentTime + 0.25;
        if (song.t < this.ctx.currentTime - 0.5) song.t = this.ctx.currentTime;
        while (song.t < until) { this.musicStep(song, song.k, song.t); song.t += song.dur; song.k++; }
      };
      tick();
    }
  }
  stopMusic(fade = 0.5) {
    this.wantSong = null;
    if (!this.ctx || !this.song) return;
    const t = this.ctx.currentTime, song = this.song;
    song.stopping = true;
    this.music.gain.cancelScheduledValues(t);
    this.music.gain.setTargetAtTime(0, t, fade / 3);
    setTimeout(() => { if (this.song === song) this.song = null; }, fade * 1000 + 200);
  }
  musicStep(song, k, t) {
    const S = song.S, per = S.beats * 4, nb = S.bars.length, bar = Math.floor(k / per) % nb, s = k % per, d = song.dur;
    const names = S.chords[bar].split(' '), ch = chordOf(names[Math.min(names.length - 1, Math.floor((s * names.length) / per))]);
    for (const n of S.bars[bar]) if (n.at === s && n.m) this.chipLead(t, mtof(n.m), n.len * d);
    const beat = s % 4 === 0, b = s / 4;
    if (S.style === 'march') {
      if (beat) this.chipBass(t, mtof(ch.root - 12 + (b % 2 ? 7 : 0)), d * 1.8);
      if (s % 4 === 2) this.chipArp(t, ch, d * 1.4);
    } else {
      if (s % 2 === 0) this.chipBass(t, mtof(ch.root - 12 + (s % 4 === 2 ? 12 : 0)), d * 1.6);
      if (s % 8 === 4) this.chipArp(t, ch, d * 3);
    }
    if (s === 0 || s === per / 2 || (S.style === 'pop' && s === per / 2 + 2)) this.chipKick(t);
    if (s === 4 || s === 12) this.chipSnare(t);
    if (s % 2 === 0) this.chipHat(t, beat ? 0.7 : 1);
  }
  pulseWave(duty) {
    this.pulses = this.pulses || {};
    if (!this.pulses[duty]) {
      const n = 28, re = new Float32Array(n), im = new Float32Array(n);
      for (let i = 1; i < n; i++) re[i] = (2 / (i * Math.PI)) * Math.sin(i * Math.PI * duty);
      this.pulses[duty] = this.ctx.createPeriodicWave(re, im);
    }
    return this.pulses[duty];
  }
  chipLead(t, f, dur) {
    const ctx = this.ctx, o = ctx.createOscillator(), g = ctx.createGain();
    o.setPeriodicWave(this.pulseWave(0.25)); o.frequency.value = f;
    const l = ctx.createOscillator(), lg = ctx.createGain(); l.frequency.value = 5.6;
    lg.gain.setValueAtTime(0, t); lg.gain.linearRampToValueAtTime(f * 0.006, t + Math.min(0.25, dur * 0.6));
    l.connect(lg).connect(o.frequency);
    const end = t + Math.max(0.06, dur * 0.92);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.09, t + 0.008); g.gain.setTargetAtTime(0.06, t + 0.01, 0.06);
    g.gain.setValueAtTime(0.06, end - 0.03); g.gain.linearRampToValueAtTime(0.0001, end);
    o.connect(g).connect(this.music);
    o.start(t); l.start(t); o.stop(end + 0.02); l.stop(end + 0.02);
  }
  chipBass(t, f, dur) {
    const ctx = this.ctx, o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'triangle'; o.frequency.value = f;
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.2, t + 0.006); g.gain.setTargetAtTime(0.11, t + 0.01, 0.08); g.gain.linearRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.music);
    o.start(t); o.stop(t + dur + 0.02);
  }
  chipArp(t, ch, dur) {
    const ctx = this.ctx, o = ctx.createOscillator(), g = ctx.createGain();
    o.setPeriodicWave(this.pulseWave(0.125));
    const notes = ch.iv.map((iv) => mtof(ch.root + 12 + iv));
    for (let k = 0, u = 0; u < dur; k++, u += 0.02) o.frequency.setValueAtTime(notes[k % notes.length], t + u);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.035, t + 0.006); g.gain.setTargetAtTime(0.0001, t + dur * 0.4, dur * 0.25);
    o.connect(g).connect(this.music);
    o.start(t); o.stop(t + dur + 0.05);
  }
  chipKick(t) {
    const ctx = this.ctx, o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'triangle'; o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(48, t + 0.11);
    g.gain.setValueAtTime(0.16, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);
    o.connect(g).connect(this.music); o.start(t); o.stop(t + 0.16);
  }
  chipSnare(t) {
    const ctx = this.ctx, s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    s.buffer = this.noise; f.type = 'bandpass'; f.frequency.value = 2400; f.Q.value = 0.8;
    g.gain.setValueAtTime(0.06, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    s.connect(f).connect(g).connect(this.music); s.start(t, Math.random()); s.stop(t + 0.14);
  }
  chipHat(t, v = 1) {
    const ctx = this.ctx, s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    s.buffer = this.noise; f.type = 'highpass'; f.frequency.value = 7500;
    g.gain.setValueAtTime(0.018 * v, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.035);
    s.connect(f).connect(g).connect(this.music); s.start(t, Math.random()); s.stop(t + 0.05);
  }
}

// ---------- the tunes (our own) ----------
const MUSIC_VOL = 0.42;
const NOTE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
function midiOf(n) {
  const m = /^([A-G])(#|b)?(\d)$/.exec(n);
  return 12 * (+m[3] + 1) + NOTE[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
}
const QUALITY = { '': [0, 4, 7], m: [0, 3, 7], 7: [0, 4, 7, 10], m7: [0, 3, 7, 10], maj7: [0, 4, 7, 11] };
function chordOf(name) {
  const m = /^([A-G][#b]?)(.*)$/.exec(name);
  return { root: midiOf(m[1] + '3'), iv: QUALITY[m[2]] || QUALITY[''] };
}
function parseBar(str) {
  let at = 0;
  return str.trim().split(/\s+/).map((tok) => {
    const [n, l] = tok.split(':'), len = +l;
    const ev = { at, len, m: n === 'R' ? 0 : midiOf(n) };
    at += len;
    return ev;
  });
}
const SONGS = {
  // the menus: a cheeky little tune in F
  menu: {
    bpm: 116, beats: 4, style: 'pop',
    chords: ['F', 'Bb', 'C', 'F', 'Dm', 'Bb', 'C', 'F'],
    lead: ['C5:2 F5:2 A5:4 G5:2 F5:2 C5:4', 'D5:4 F5:4 Bb5:6 A5:2', 'G5:4 E5:2 C5:2 G5:4 E5:4', 'F5:8 R:8',
      'A5:4 F5:2 D5:2 A5:4 F5:4', 'Bb5:6 A5:2 G5:4 F5:4', 'E5:2 F5:2 G5:2 E5:2 C5:4 E5:4', 'F5:12 R:4'],
  },
  // the siege: a toy-soldier march in D minor
  siege: {
    bpm: 126, beats: 4, style: 'march',
    chords: ['Dm', 'Dm', 'C', 'C', 'Bb', 'F', 'Gm A', 'Dm', 'F', 'C', 'Dm', 'A', 'Bb', 'C', 'Dm A', 'Dm'],
    lead: ['D5:2 D5:2 A4:2 D5:2 F5:4 E5:2 D5:2', 'E5:2 F5:2 G5:2 E5:2 A5:6 R:2', 'G5:2 G5:2 E5:2 G5:2 C6:4 B5:2 A5:2', 'G5:4 E5:4 C5:8',
      'D5:2 F5:2 Bb5:4 A5:2 G5:2 F5:4', 'C5:2 F5:2 A5:4 G5:2 F5:2 C5:4', 'Bb4:2 D5:2 G5:4 C#5:2 E5:2 A5:4', 'D5:12 R:4',
      'A5:4 C6:4 A5:4 F5:4', 'G5:4 E5:2 C5:2 E5:4 G5:4', 'F5:2 E5:2 D5:2 E5:2 F5:4 A5:4', 'E5:8 C#5:4 A4:4',
      'D5:4 F5:4 Bb5:4 D6:4', 'C6:4 Bb5:2 A5:2 G5:4 E5:4', 'F5:4 D5:4 E5:4 C#5:4', 'D5:8 A4:4 D5:4'],
  },
};
