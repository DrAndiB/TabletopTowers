// The on-screen parts during a game: a card for each castle, the draft, turn banners and toasts, the
// shop sheet (chores, the market, building) and the aiming bar. Plain DOM; the game calls in, the
// buttons call the game's actions.
import { AMMO, AMMO_ORDER, WIND_MAX } from './ballistics.js';
import { CHORES, GOODS, RULES, savings, moraleWord, snacksNeeded, idleToys } from './economy.js';
import { PERSONALITIES } from './ai.js';
import { TEAM } from './pieces.js';
import { SLOTS } from './layout.js';

const $ = (s, r = document) => r.querySelector(s);

// little painted icons
export const ICON = {
  coin: '<svg class="ico" viewBox="0 0 20 20"><circle cx="10" cy="10" r="8.5" fill="#f2c230" stroke="#1f1a17" stroke-width="2"/><circle cx="10" cy="10" r="4.5" fill="none" stroke="#a77c08" stroke-width="1.6"/></svg>',
  pig: '<svg class="ico" viewBox="0 0 22 20"><ellipse cx="10" cy="11" rx="8.5" ry="6.5" fill="#f4a5b8" stroke="#1f1a17" stroke-width="2"/><rect x="16.5" y="8.5" width="4" height="5" rx="2" fill="#f4a5b8" stroke="#1f1a17" stroke-width="1.6"/><rect x="7" y="4" width="6" height="2" rx="1" fill="#1f1a17"/></svg>',
  toy: '<svg class="ico" viewBox="0 0 14 20"><rect x="3" y="9" width="8" height="10" rx="2" fill="currentColor" stroke="#1f1a17" stroke-width="1.6"/><circle cx="7" cy="7" r="3" fill="#f2d2b0" stroke="#1f1a17" stroke-width="1.4"/><rect x="4" y="1" width="6" height="4" rx="1" fill="#1f1a17"/></svg>',
  snack: '<svg class="ico" viewBox="0 0 20 20"><circle cx="10" cy="10" r="8" fill="#d9a066" stroke="#1f1a17" stroke-width="2"/><circle cx="7" cy="8" r="1.4" fill="#5a3220"/><circle cx="12.5" cy="7" r="1.2" fill="#5a3220"/><circle cx="11" cy="12.5" r="1.4" fill="#5a3220"/></svg>',
  paper: '<svg class="ico" viewBox="0 0 20 20"><path d="M10 2l6 3 2 6-4 6-6 1-5-4-1-6z" fill="#fbf8ef" stroke="#1f1a17" stroke-width="2" stroke-linejoin="round"/><path d="M6 8l4 2 4-3M8 13l3-2" stroke="#7a9ad8" stroke-width="1.2" fill="none"/></svg>',
  eraser: '<svg class="ico" viewBox="0 0 22 16"><rect x="1.5" y="3" width="12" height="10" rx="2" fill="#e8606a" stroke="#1f1a17" stroke-width="2"/><rect x="12.5" y="3" width="8" height="10" rx="2" fill="#3a6fd0" stroke="#1f1a17" stroke-width="2"/></svg>',
  marble: '<svg class="ico" viewBox="0 0 20 20"><circle cx="10" cy="10" r="8" fill="#9fd8f2" stroke="#1f1a17" stroke-width="2"/><path d="M4 11c3-3 6 2 12-2" stroke="#2f6fe0" stroke-width="2.4" fill="none"/><circle cx="7" cy="6.5" r="1.6" fill="#fff"/></svg>',
  box: '<svg class="ico" viewBox="0 0 22 20"><path d="M2 7h18v11H2z" fill="#c99d66" stroke="#1f1a17" stroke-width="2" stroke-linejoin="round"/><path d="M2 7l3-5h12l3 5" fill="#dcb47e" stroke="#1f1a17" stroke-width="2" stroke-linejoin="round"/><rect x="9" y="7" width="4" height="11" fill="#e6cf9a"/></svg>',
  block: '<svg class="ico" viewBox="0 0 22 18"><rect x="1.5" y="9" width="10" height="7" rx="1.5" fill="#d8392b" stroke="#1f1a17" stroke-width="1.8"/><rect x="10.5" y="9" width="10" height="7" rx="1.5" fill="#f2b730" stroke="#1f1a17" stroke-width="1.8"/><rect x="6" y="2" width="10" height="7" rx="1.5" fill="#e8c896" stroke="#1f1a17" stroke-width="1.8"/></svg>',
  catapult: '<svg class="ico" viewBox="0 0 24 18"><rect x="2" y="13" width="20" height="4" rx="1" fill="#e8c896" stroke="#1f1a17" stroke-width="1.6"/><path d="M8 14L20 4" stroke="#1f1a17" stroke-width="2.4"/><ellipse cx="20" cy="4" rx="3" ry="2" fill="#fff" stroke="#1f1a17" stroke-width="1.6"/></svg>',
};
const fmt = (h) => (h % 1 ? h.toFixed(1) : String(h));
const boxPips = (boxes) => (boxes ? boxes.map((b) => (b.built ? `<i class="pip" style="--f:${Math.round((b.hp / RULES.boxHp) * 100)}%"></i>` : '<i class="pip gone"></i>')).join('') : '');
const trendMark = (t) => (t > 0 ? '<i class="up">▲</i>' : t < 0 ? '<i class="down">▼</i>' : '');

export class Hud {
  constructor(root) {
    this.root = root;
    this.cards = [$('#card-0', root), $('#card-1', root)];
    this.toasts = $('#toasts', root);
    this.bannerEl = $('#banner', root);
    this.shopEl = $('#shop', root);
    this.aimEl = $('#aimbar', root);
    this.windEl = $('#wind', root);
    this.roundEl = $('#round', root);
  }
  bind(game) { this.game = game; }
  reset(players) {
    this.players = players;
    this.toasts.innerHTML = '';
    this.hideShop(); this.hideAim();
    this.bannerEl.className = '';
    this.root.classList.add('hidden');
  }
  showHud() { this.root.classList.remove('hidden'); }
  hideHud() { this.root.classList.add('hidden'); }
  setRound(n) { this.roundEl.textContent = `Round ${n}`; }

  setCastle(side, p, { standing, total, boxes }) {
    const el = this.cards[side];
    const who = p.type === 'human' ? 'Player' : `Computer · ${PERSONALITIES[p.personality].name}`;
    const m = Math.round(p.morale);
    const mood = moraleWord(m);
    el.classList.toggle('active', this.game && this.game.turn === side && this.game.phase !== 'over');
    el.innerHTML = `<div class="cc-head"><b>${TEAM[side].name} castle</b><span>${who}</span></div>
      <div class="cc-money">${ICON.coin}<b>${p.pocket}</b><span class="sep"></span>${ICON.pig}<b>${savings(p)}</b><small>saved in ${p.piggies.filter((g) => g.built).length}</small></div>
      <div class="cc-morale m-${mood.toLowerCase()}"><div class="bar"><i style="width:${m}%"></i></div><span>${mood}</span></div>
      <div class="cc-stock"><span style="color:${TEAM[side].hex}">${ICON.toy}${p.toys}</span><span>${ICON.snack}${p.snacks}</span>${AMMO_ORDER.map((k) => `<span class="${p.ammo[k] ? '' : 'none'}">${ICON[k]}${p.ammo[k]}</span>`).join('')}<span class="boxes" title="Cardboard boxes: dents left">${ICON.box}${boxPips(boxes)}</span></div>
      <div class="cc-tags">${p.flagDown ? '<em class="bad">Flag down</em>' : ''}${standing < total ? `<em>${total - standing} blocks down</em>` : ''}${p.sulkSkip ? '<em class="bad">Sulking</em>' : ''}</div>`;
  }

  setWind(w) {
    const k = Math.abs(w) / WIND_MAX;
    const n = w === 0 ? 0 : k < 0.34 ? 1 : k < 0.7 ? 2 : 3;
    const arrows = n ? (w > 0 ? '›'.repeat(n) : '‹'.repeat(n)) : '·';
    const word = ['Still', 'Light', 'Breezy', 'Strong'][n];
    this.windEl.innerHTML = `<span class="w-label">Draft</span><span class="w-arrows ${w > 0 ? 'r' : 'l'}">${arrows}</span><span class="w-word">${word}</span>`;
    this.windEl.title = `The draft from the window: ${word.toLowerCase()}${n ? (w > 0 ? ', blowing right' : ', blowing left') : ''}`;
  }

  // ---------- messages ----------
  toast(text, tone = 'info', dur = 2.4) {
    const el = document.createElement('div');
    el.className = 'toast ' + tone;
    el.textContent = text;
    this.toasts.appendChild(el);
    while (this.toasts.children.length > 4) this.toasts.firstChild.remove();
    setTimeout(() => el.classList.add('out'), dur * 1000);
    setTimeout(() => el.remove(), dur * 1000 + 500);
  }
  banner(title, text, kind = 'turn', dur = 2) {
    const b = this.bannerEl;
    b.className = '';
    b.innerHTML = `<div class="bn ${kind}"><h2>${title}</h2>${text ? `<p>${text}</p>` : ''}</div>`;
    void b.offsetWidth;
    b.className = 'show';
    clearTimeout(this.bannerTimer);
    this.bannerTimer = setTimeout(() => { b.className = 'hide'; }, dur * 1000);
  }
  turnStart(side, p, rep) {
    const inc = rep.income;
    const parts = [`${inc.allowance} pocket money`];
    if (inc.chores) parts.push(`${inc.chores} chores`);
    if (inc.piggies) parts.push(`${inc.piggies} piggy`);
    if (inc.interest) parts.push(`${inc.interest} interest`);
    const dm = rep.moraleChange;
    const lines = [`<span class="inc">+${inc.total} ${ICON.coin}</span> <small>${parts.join(' · ')}</small>`, `<small>Morale ${dm >= 0 ? '+' : ''}${dm}</small>`];
    for (const l of rep.lines) lines.push(`<small class="${l.tone}">${l.text}</small>`);
    this.banner(`${TEAM[side].name}'s turn`, lines.join('<br>'), 'turn t' + side, p.type === 'human' ? 1.6 : 1.25);
  }

  // ---------- the shop ----------
  showShop(side, info) {
    const g = this.game, p = g.players[side], m = info.market, el = this.shopEl;
    const price = (k) => m.price(k);
    const can = (n) => p.pocket + savings(p) >= n;
    const item = (k, have, extra = '') => `<div class="item">
        <div class="it-name">${ICON[k]}<span>${GOODS[k].name}${k === 'snack' ? 's' : ''}</span><small>×${have}</small></div>
        <div class="it-price">${ICON.coin}${price(k)}${trendMark(m.trend[k])}</div>
        <div class="it-btns"><button class="btn tiny buy" data-buy="${k}" ${can(price(k)) ? '' : 'disabled'}>Buy</button><button class="btn tiny ghost" data-sell="${k}" ${have > 0 && m.sellPrice(k) > 0 ? '' : 'disabled'} title="Sell for ${m.sellPrice(k)}">Sell ${m.sellPrice(k)}</button></div>${extra}</div>`;
    const ch = CHORES.map((c, i) => `<button data-chores="${i}" class="${p.chores === i ? 'on' : ''}"><b>${c.name}</b><small>${c.coins ? `+${c.coins * idleToys(p)} ${ICON.coin}` : 'no coins'} · ${c.morale > 0 ? '+' : ''}${c.morale} mood</small></button>`).join('');
    const rebuildable = info.missing > 0 || info.flagDown || info.displaced > 0;
    const builtBoxes = info.boxes.map((b, i) => (b.built ? `${SLOTS.boxes[i].name.split(' ').pop()} ${fmt(b.hp)}` : null)).filter(Boolean);
    el.innerHTML = `<div class="sh-head"><h3>${TEAM[side].name}'s shop</h3><span class="sh-money">${ICON.coin}<b>${p.pocket}</b> in pocket · ${ICON.pig}<b>${savings(p)}</b> in piggies</span>
        <button class="btn yellow go" data-go>To the catapult <kbd>Enter</kbd></button></div>
      <div class="sh-chores"><span class="lbl">Chores for ${idleToys(p)} idle toys</span><div class="seg chores">${ch}</div></div>
      <div class="sh-grid">
        ${AMMO_ORDER.map((k) => item(k, p.ammo[k])).join('')}
        ${item('snack', p.snacks, `<div class="it-note">The toys eat ${snacksNeeded(p)} a turn</div>`)}
        <div class="item build"><div class="it-name">${ICON.box}<span>Cardboard</span></div>
          <div class="it-note">${builtBoxes.length ? `Dents left: ${builtBoxes.join(' · ')} (of ${RULES.boxHp})` : 'No boxes left'}</div>
          <div class="it-btns"><button class="btn tiny buy" data-build="tape" ${info.tapeTarget >= 0 && can(RULES.tapePrice) ? '' : 'disabled'} title="Mends ${RULES.tapeHp} dents on your most dented box">Tape ${ICON.coin}${RULES.tapePrice}</button><button class="btn tiny buy" data-build="box" ${info.boxSlot >= 0 && can(RULES.boxPrice) ? '' : 'disabled'} title="${info.boxSlot >= 0 ? `A new box for the ${SLOTS.boxes[info.boxSlot].name.toLowerCase()}` : 'All boxes are up'}">New box ${ICON.coin}${RULES.boxPrice}</button></div></div>
        <div class="item build"><div class="it-name">${ICON.block}<span>Rebuild</span></div>
          <div class="it-note">${rebuildable ? [info.missing ? `${info.missing} block${info.missing === 1 ? '' : 's'}` : '', info.flagDown ? 'the flag' : '', info.displaced ? 'boxes back in place' : ''].filter(Boolean).join(', ') : 'Nothing to rebuild'}</div>
          <div class="it-btns"><button class="btn tiny buy" data-build="rebuild" ${rebuildable && can(info.rebuildCost) ? '' : 'disabled'}>${rebuildable ? `${ICON.coin}${info.rebuildCost}` : 'Rebuild'}</button></div></div>
        <div class="item build"><div class="it-name">${ICON.pig}<span>Piggy bank</span></div>
          <div class="it-note">${info.piggySlot >= 0 ? `${p.piggies.filter((x) => x.built).length} of 3 built. Earns ${RULES.piggyBase} + 10% a turn` : 'All three built'}</div>
          <div class="it-btns"><button class="btn tiny buy" data-build="piggy" ${info.piggySlot >= 0 && can(RULES.piggyPrice) ? '' : 'disabled'}>${ICON.coin}${RULES.piggyPrice}</button></div></div>
        <div class="item build"><div class="it-name">${ICON.catapult}<span>Back catapult</span></div>
          <div class="it-note">${info.canCatapult ? 'Lobs high over your keep' : 'Built'}</div>
          <div class="it-btns"><button class="btn tiny buy" data-build="catapult" ${info.canCatapult && can(RULES.catapultPrice) ? '' : 'disabled'}>${ICON.coin}${RULES.catapultPrice}</button></div></div>
      </div>
      <p class="sh-foot">Coins you don't spend go into your piggy banks: they earn interest, but a smashed piggy spills them.</p>`;
    el.hidden = false;
    for (const b of el.querySelectorAll('[data-buy]')) b.onclick = () => g.act({ do: 'buy', item: b.dataset.buy });
    for (const b of el.querySelectorAll('[data-sell]')) b.onclick = () => g.act({ do: 'sell', item: b.dataset.sell });
    for (const b of el.querySelectorAll('[data-chores]')) b.onclick = () => g.act({ do: 'chores', level: +b.dataset.chores });
    for (const b of el.querySelectorAll('[data-build]')) b.onclick = () => g.act({ do: b.dataset.build });
    el.querySelector('[data-go]').onclick = () => g.shopDone();
  }
  hideShop() { this.shopEl.hidden = true; }

  // ---------- aiming ----------
  showAim(_side, a, p) {
    const g = this.game, el = this.aimEl;
    el.innerHTML = `<div class="am-hint">Drag on the table to aim · <kbd>↑</kbd><kbd>↓</kbd> angle · <kbd>←</kbd><kbd>→</kbd> strength · <kbd>Tab</kbd> ammo</div>
      <div class="am-row">
        <div class="am-ammo seg">${AMMO_ORDER.map((k) => `<button data-ammo="${k}" title="${AMMO[k].tip}">${ICON[k]}<span>${AMMO[k].short}</span><small>×<b data-n="${k}">${p.ammo[k]}</b></small></button>`).join('')}</div>
        ${p.catapults[1] ? `<button class="btn small-btn" data-cat>${ICON.catapult}<span data-catname></span> <kbd>C</kbd></button>` : ''}
        <div class="am-dial"><span>Angle</span><button class="btn tiny" data-da="-1" aria-label="Lower">▼</button><b data-angle></b><button class="btn tiny" data-da="1" aria-label="Higher">▲</button></div>
        <div class="am-dial"><span>Strength</span><button class="btn tiny" data-dp="-1" aria-label="Weaker">◀</button><b data-power></b><button class="btn tiny" data-dp="1" aria-label="Stronger">▶</button></div>
        <button class="btn ghost small-btn" data-back>← Shop</button>
        <button class="btn big yellow fire" data-fire>Fire! <kbd>Space</kbd></button>
      </div>`;
    el.hidden = false;
    for (const b of el.querySelectorAll('[data-ammo]')) b.onclick = () => g.setAim({ ammo: b.dataset.ammo });
    const c = el.querySelector('[data-cat]'); if (c) c.onclick = () => g.cycleCatapult();
    const hold = (b, fn) => {
      let iv = null;
      const stop = () => { clearInterval(iv); iv = null; };
      b.onpointerdown = (e) => { e.preventDefault(); fn(); stop(); iv = setInterval(fn, 70); };
      b.onpointerup = b.onpointerleave = b.onpointercancel = stop;
    };
    for (const b of el.querySelectorAll('[data-da]')) hold(b, () => g.setAim({ angle: g.aimState.angle + +b.dataset.da * 0.5 }));
    for (const b of el.querySelectorAll('[data-dp]')) hold(b, () => g.setAim({ power: g.aimState.power + +b.dataset.dp * 0.005 }));
    el.querySelector('[data-back]').onclick = () => g.backToShop();
    el.querySelector('[data-fire]').onclick = () => g.fire();
    this.updateAim(a, p);
  }
  updateAim(a, p) {
    const el = this.aimEl;
    if (el.hidden) return;
    el.querySelector('[data-angle]').textContent = `${a.angle.toFixed(1)}°`;
    el.querySelector('[data-power]').textContent = `${(a.power * 100).toFixed(1)}%`;
    for (const b of el.querySelectorAll('[data-ammo]')) { b.classList.toggle('on', b.dataset.ammo === a.ammo); b.disabled = !(p.ammo[b.dataset.ammo] > 0); }
    for (const n of el.querySelectorAll('[data-n]')) n.textContent = p.ammo[n.dataset.n];
    const cn = el.querySelector('[data-catname]'); if (cn) cn.textContent = a.slot ? 'Back' : 'Front';
  }
  hideAim() { this.aimEl.hidden = true; }
}
