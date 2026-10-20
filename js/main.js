// Boot, menus (title, who's playing, how to play, pause, results) and the main loop.
import { GameRenderer } from './render.js';
import { Perf } from './perf.js';
import { Sound } from './audio.js';
import { Game } from './game.js';
import { Hud } from './hud.js';
import { PERSONALITIES, SKILLS } from './ai.js';
import { TEAM } from './pieces.js';

const $ = (s) => document.querySelector(s);
const params = new URLSearchParams(location.search);
const SETTINGS_KEY = 'tabletop-towers.settings.v1';
const PERS = ['random', ...Object.keys(PERSONALITIES)];

const defaults = {
  quality: 'auto',
  sides: [{ type: 'human', personality: 'random', skill: 'normal' }, { type: 'cpu', personality: 'random', skill: 'normal' }],
};
let settings = loadSettings();
function loadSettings() {
  try {
    const s = JSON.parse(localStorage.getItem(SETTINGS_KEY) || 'null');
    if (s && Array.isArray(s.sides) && s.sides.length === 2) {
      return {
        quality: ['auto', 'low', 'medium', 'high'].includes(s.quality) ? s.quality : 'auto',
        sides: s.sides.map((d, i) => ({
          type: d.type === 'cpu' ? 'cpu' : 'human',
          personality: PERS.includes(d.personality) ? d.personality : 'random',
          skill: SKILLS[d.skill] ? d.skill : defaults.sides[i].skill,
        })),
      };
    }
  } catch (e) { /* ignore */ }
  return JSON.parse(JSON.stringify(defaults));
}
function saveSettings() { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch (e) { /* ignore */ } }

// ---------- engine ----------
const canvas = $('#game');
const quality = params.get('quality') || settings.quality;
const R = new GameRenderer(canvas, quality === 'auto' ? 'medium' : quality);
if (quality === 'auto') R.setQuality(Perf.autoTier(R));
const sound = new Sound();
const hud = new Hud($('#hud'));
const game = new Game(R, sound, hud);
const perf = new Perf(R, { onTierChange: (q) => R.setQuality(q) });
perf.setAuto(quality === 'auto');
if (params.get('fps') === 'max') perf.cap = false;
if (params.get('debug')) perf.toggleOverlay(true);
window.__tt = { game, R, sound, perf, settings: () => settings };

let screen = 'title';
let lastT = performance.now();
let lastCfg = null;

function showScreen(name) {
  screen = name;
  if (name !== 'none' && perf.shouldHint()) $('#gpu-hint').hidden = false;
  for (const el of document.querySelectorAll('.screen')) el.classList.toggle('active', el.id === 'screen-' + name);
  document.body.dataset.screen = name;
  if (['title', 'setup', 'howto'].includes(name)) sound.playMusic('menu', 1);
}

// ---------- who's playing ----------
function renderSetup() {
  const root = $('#sides');
  root.innerHTML = '';
  settings.sides.forEach((d, i) => {
    const el = document.createElement('div');
    el.className = 'side ' + (i ? 'blue' : 'red');
    const cpu = d.type === 'cpu';
    el.innerHTML = `<h3><span class="dot" style="background:${TEAM[i].hex}"></span>${TEAM[i].name} castle <small>${i ? 'on the right' : 'on the left'}</small></h3>
      <div class="seg who"><button data-t="human" class="${cpu ? '' : 'on'}">Player</button><button data-t="cpu" class="${cpu ? 'on' : ''}">Computer kid</button></div>
      <div class="cpu-opts" ${cpu ? '' : 'hidden'}>
        <div class="opt-row"><span>Kind</span><div class="seg pers">${PERS.map((k) => `<button data-p="${k}" class="${d.personality === k ? 'on' : ''}" title="${k === 'random' ? 'A surprise' : PERSONALITIES[k].blurb}">${k === 'random' ? 'Surprise me' : PERSONALITIES[k].name}</button>`).join('')}</div></div>
        <p class="opt-help">${d.personality === 'random' ? 'You find out who you are playing when the game starts.' : PERSONALITIES[d.personality].blurb}</p>
        <div class="opt-row"><span>Aim</span><div class="seg skill">${Object.keys(SKILLS).map((k) => `<button data-s="${k}" class="${d.skill === k ? 'on' : ''}">${SKILLS[k].name}</button>`).join('')}</div></div>
      </div>
      <p class="human-help" ${cpu ? 'hidden' : ''}>Mouse, touch or keyboard. You take turns on this screen.</p>`;
    for (const b of el.querySelectorAll('[data-t]')) b.onclick = () => { sound.click(); d.type = b.dataset.t; saveSettings(); renderSetup(); };
    for (const b of el.querySelectorAll('[data-p]')) b.onclick = () => { sound.click(); d.personality = b.dataset.p; saveSettings(); renderSetup(); };
    for (const b of el.querySelectorAll('[data-s]')) b.onclick = () => { sound.click(); d.skill = b.dataset.s; saveSettings(); renderSetup(); };
    root.appendChild(el);
  });
  for (const b of document.querySelectorAll('[data-opt="quality"]')) b.classList.toggle('on', b.dataset.val === settings.quality);
}
for (const b of document.querySelectorAll('[data-opt="quality"]')) {
  b.onclick = () => {
    sound.click();
    settings.quality = b.dataset.val; saveSettings();
    if (b.dataset.val === 'auto') { R.setQuality(Perf.autoTier(R)); perf.setAuto(true); } else { perf.setAuto(false); R.setQuality(b.dataset.val); }
    renderSetup();
  };
}

function gameConfig() {
  const pick = () => { const k = Object.keys(PERSONALITIES); return k[Math.floor(Math.random() * k.length)]; };
  return {
    seed: +(params.get('seed') || 0) || Math.floor(Math.random() * 1e6),
    players: settings.sides.map((d) => ({ type: d.type, personality: d.personality === 'random' ? pick() : d.personality, skill: d.skill })),
  };
}

function startGame(cfg = gameConfig()) {
  lastCfg = cfg;
  // a fresh seed each time, the same people playing
  game.start(cfg);
  showScreen('none');
}

// ---------- results ----------
const REASONS = {
  teddy: (l) => `${l}'s teddy fell off his throne.`,
  owngoal: (l) => `${l} knocked their own teddy off his throne!`,
  mutiny: (l) => `${l}'s toys had enough and walked off the table.`,
  nocrew: (l) => `${l} had nobody left to work the catapult.`,
};
function showResults(over) {
  hud.hideHud();
  const w = TEAM[over.winner].name, l = TEAM[1 - over.winner].name;
  $('#results-kicker').textContent = `After ${over.round} round${over.round === 1 ? '' : 's'}`;
  $('#results-title').textContent = `${w} castle wins!`;
  $('#results-title').style.color = TEAM[over.winner].hex;
  $('#results-reason').textContent = (REASONS[over.reason] || REASONS.teddy)(l);
  const P = game.players;
  const row = (label, f) => `<tr><th>${label}</th>${P.map((p) => `<td>${f(p)}</td>`).join('')}</tr>`;
  $('#results-stats').innerHTML = `<table><thead><tr><th></th>${P.map((p, i) => `<th style="color:${TEAM[i].hex}">${TEAM[i].name}${p.type === 'cpu' ? `<small>${PERSONALITIES[p.personality].name}</small>` : ''}</th>`).join('')}</tr></thead><tbody>
    ${row('Shots', (p) => p.stats.shots)}${row('Blocks knocked down', (p) => p.stats.blocksKnocked)}${row('Piggy banks smashed', (p) => p.stats.piggiesSmashed)}${row('Coins earned', (p) => p.stats.earned)}${row('Toys at the end', (p) => p.toys)}</tbody></table>`;
  showScreen('results');
  confetti(TEAM[over.winner].hex);
}
function confetti(color) {
  const root = $('#confetti');
  root.innerHTML = '';
  const cols = [color, '#ffc93c', '#fff4dc', '#2fae5a'];
  for (let i = 0; i < 70; i++) {
    const s = document.createElement('i');
    s.style.left = Math.random() * 100 + '%';
    s.style.background = cols[i % cols.length];
    s.style.animationDelay = Math.random() * 1.6 + 's';
    s.style.animationDuration = 2.4 + Math.random() * 2 + 's';
    s.style.transform = `rotate(${Math.random() * 360}deg)`;
    root.appendChild(s);
  }
}
game.onOver = (over) => showResults(over);

// ---------- pause ----------
function togglePause(force) {
  if (screen === 'none') { game.paused = true; showScreen('pause'); sound.stopMusic(0.2); }
  else if (screen === 'pause' && force !== true) { game.paused = false; showScreen('none'); sound.playMusic('siege', 0.55); }
}
function toMenu() {
  game.paused = false;
  game.start({ showcase: true, seed: 7, players: [{ type: 'cpu', personality: 'hoarder' }, { type: 'cpu', personality: 'warmonger' }] });
  showScreen('title');
}

// ---------- buttons ----------
$('#btn-play').onclick = () => { sound.pick(); renderSetup(); showScreen('setup'); };
$('#btn-howto').onclick = () => { sound.click(); howtoBack = 'title'; showScreen('howto'); };
$('#btn-setup-howto').onclick = () => { sound.click(); howtoBack = 'setup'; showScreen('howto'); };
let howtoBack = 'title';
$('#btn-howto-back').onclick = () => { sound.click(); if (howtoBack === 'setup') renderSetup(); showScreen(howtoBack); };
$('#btn-setup-back').onclick = () => { sound.click(); showScreen('title'); };
$('#btn-start').onclick = () => { sound.pick(); startGame(); };
$('#btn-resume').onclick = () => togglePause();
$('#btn-restart').onclick = () => { game.paused = false; startGame({ ...lastCfg, seed: Math.floor(Math.random() * 1e6) }); };
$('#btn-quit').onclick = () => toMenu();
$('#btn-again').onclick = () => { sound.pick(); startGame(gameConfig()); };
$('#btn-results-menu').onclick = () => toMenu();
$('#btn-pause').onclick = () => togglePause();
$('#btn-hud-pause').onclick = () => togglePause();
$('#btn-gpu-hint').onclick = () => { perf.dismissHint(); $('#gpu-hint').hidden = true; };
function updateSoundBtn() { $('#btn-sound').textContent = sound.muted ? '🔇' : '🔊'; $('#btn-sound').setAttribute('aria-label', sound.muted ? 'Sound off' : 'Sound on'); }
$('#btn-sound').onclick = () => { sound.setMuted(!sound.muted); updateSoundBtn(); };
updateSoundBtn();
function toggleFullscreen() {
  const d = document;
  if (d.fullscreenElement || d.webkitFullscreenElement) (d.exitFullscreen || d.webkitExitFullscreen).call(d);
  else { const el = d.documentElement; const req = el.requestFullscreen || el.webkitRequestFullscreen; if (req) req.call(el).catch?.(() => {}); }
}
$('#btn-fs').onclick = () => toggleFullscreen();

// ---------- keyboard and pointer ----------
window.addEventListener('keydown', (e) => {
  if (e.repeat && !e.code.startsWith('Arrow')) return;
  if (screen === 'none') {
    if (e.code === 'Escape' || e.code === 'KeyP') { togglePause(); return; }
    if (e.code === 'KeyF') { toggleFullscreen(); return; }
    if (e.code === 'F3') { e.preventDefault(); perf.toggleOverlay(); return; }
    game.keyDown(e);
    return;
  }
  if (e.code === 'Escape') {
    if (screen === 'pause') togglePause();
    else if (screen === 'setup') showScreen('title');
    else if (screen === 'howto') $('#btn-howto-back').click();
    return;
  }
  if (e.code === 'Enter' || e.code === 'NumpadEnter') {
    if (screen === 'title') $('#btn-play').click();
    else if (screen === 'setup') $('#btn-start').click();
    else if (screen === 'results') $('#btn-again').click();
    else if (screen === 'pause') $('#btn-resume').click();
  }
});
window.addEventListener('keyup', (e) => game.keyUp(e));
window.addEventListener('blur', () => game.keys.clear());
canvas.addEventListener('pointerdown', (e) => { if (screen !== 'none') return; canvas.setPointerCapture?.(e.pointerId); game.pointerDown(e.clientX, e.clientY); });
canvas.addEventListener('pointermove', (e) => { if (screen === 'none') game.pointerMove(e.clientX, e.clientY); });
canvas.addEventListener('pointerup', () => game.pointerUp());
canvas.addEventListener('pointercancel', () => game.pointerUp());
window.addEventListener('resize', () => { R.resize(); game.particles?.setScale(R.renderer.domElement.height * 0.9); });

// ---------- the loop ----------
function frame(now) {
  requestAnimationFrame(frame);
  if (!perf.frameStart(now)) return;
  const dtMs = now - lastT;
  lastT = now;
  const dt = Math.min(0.05, dtMs / 1000);
  game.update(dt);
  R.render();
  perf.frameDone(dtMs, screen === 'none' && !game.paused);
}

(async function boot() {
  await document.fonts.ready.catch(() => {});
  if (params.get('test')) game.cinematics = !!params.get('cine');
  if (params.get('noevents')) game.noEvents = true;
  if (params.get('event')) game.forceEvent = params.get('event');
  game.start({ showcase: true, seed: 7, players: [{ type: 'cpu', personality: 'hoarder' }, { type: 'cpu', personality: 'warmonger' }] });
  try { await R.warmUp(); } catch (e) { /* first frames compile instead */ }
  $('#boot').classList.add('done');
  if (params.get('autostart')) {
    // quick starts and tests: ?autostart=1&p=human,cpu&skill=hard&seed=5
    const types = (params.get('p') || 'human,cpu').split(',');
    const pers = (params.get('pers') || 'hoarder,warmonger').split(',');
    startGame({ seed: +(params.get('seed') || 5), players: types.map((t, i) => ({ type: t === 'cpu' ? 'cpu' : 'human', personality: pers[i] || 'hoarder', skill: params.get('skill') || 'normal' })) });
  } else showScreen('title');
  if (params.get('test')) {
    // automated tests drive the clock themselves
    window.__tt.step = (sec = 0) => { const info = R.renderer.info; info.reset(); game.simulate(sec); R.render(); return { ...info.render, phase: game.phase, round: game.round, turn: game.turn }; };
    window.__tt.screen = () => screen;
    window.__tt.show = (name) => { if (name === 'setup') renderSetup(); showScreen(name); };
    window.__tt.ready = true;
  } else requestAnimationFrame(frame);
})();
