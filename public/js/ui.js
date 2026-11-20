// DOM menus: main menu, play setup, garage, multiplayer rooms, settings, pause, HUD helpers.
import { MINIMAP_RANGES } from './minimap.js';
import { CARS, CATEGORIES, carById, carStats, RIMS, SPOILERS, STRIPES, PAINTS, WHEEL_COLORS, GLOWS, defaultConfig, VISUAL, fitsPart } from './cars.js';
import { PARTS, SLIDERS, RULES, sanitizeTune, applyTune, isStock, allowedTires, maxLevel, builtinPresets, PRESET_NAMES, PRESET_INFO, tuneSummary } from './tuning.js';
import { measureStats, STAT_SCALE, statFrac } from './carstats.js';
import { MAP_LIST } from './maps.js';
import { MODES, FREE_MODES, COMP_MODES } from './scoring.js';
import { RACE, RACE_MAPS, BATTLE, BATTLE_MAPS } from './tracks.js';
import { CHALLENGE_VARIANTS } from './judge.js';
import { AI_SKILL } from './ai.js';
import { ACTIONS, DEFAULT_BINDINGS, keyLabel } from './input.js';
import { VIEWS } from './camera.js';
import { DRIVE_STYLES } from './physics.js';

export const $ = (s, el = document) => el.querySelector(s);
export const $$ = (s, el = document) => [...el.querySelectorAll(s)];
export const fmt = (n) => Math.round(n || 0).toLocaleString('en-US');
export const fmtT = (t) => (t == null || !Number.isFinite(t) ? '—' : `${Math.floor(t / 60)}:${(t % 60).toFixed(2).padStart(5, '0')}`);
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export function toast(html, ms = 2500, cls = '') {
  const el = document.createElement('div'); el.className = 'toast ' + cls; el.innerHTML = html;
  $('#toasts').appendChild(el);
  setTimeout(() => el.classList.add('out'), ms); setTimeout(() => el.remove(), ms + 400);
}

export class UI {
  constructor(app) {
    this.app = app; this.current = 'main'; this.playSel = { mode: 'endless', map: 'track' };
    this.compSel = { mode: 'challenge', challenge: { variant: 'timed', time: 120, map: 'track' }, race: { map: 'track', laps: 3, ai: 5, difficulty: 'medium' }, battle: { map: 'track' } };
    this.recTab = 'challenge';
    this.garageCat = carById(app.settings.car.id).cat;
    this.settingsTab = 'graphics'; this.settingsReturn = 'main';
    this.bind();
  }
  get S() { return this.app.settings; }
  click() { this.app.audio.init(); this.app.audio.blip(720, 0.04, 'triangle', 0.06); }

  show(name) {
    this.current = name;
    $$('.screen').forEach((s) => s.classList.toggle('active', s.id === 'scr-' + name));
    $('#menu-bg').classList.toggle('hidden', name === 'none');
    if (name === 'play') this.renderPlay();
    if (name === 'garage') this.renderGarage();
    if (name === 'settings') this.renderSettings();
    if (name === 'mp') this.enterMP();
    if (name === 'lobby') this.renderLobby();
    if (name === 'comp') this.renderComp();
    if (name === 'records') this.renderRecords();
  }

  bind() {
    document.addEventListener('click', (e) => {
      const b = e.target.closest('[data-go]');
      if (b) { this.click(); const g = b.dataset.go; if (g === 'settings') this.settingsReturn = this.current; this.show(g); }
    });
    $('#btn-start').onclick = () => { this.click(); this.app.startGame({ mapId: this.playSel.map, modeId: this.playSel.mode, mp: false }); };
    $('#settings-back').onclick = () => { this.click(); this.app.saveSettings(); if (this.app.game) { this.show('none'); this.showPause(true, this.app.game); } else this.show(this.settingsReturn === 'settings' ? 'main' : this.settingsReturn); };
  }

  // ------------------------------------------------------------- PLAY
  renderPlay() {
    const S = this.S;
    const art = { challenge: 'track', race: 'city', battle: 'mountain' };
    $('#comp-cards').innerHTML = COMP_MODES.map((m) => `<button class="card compcard" data-comp="${m.id}"><div class="map-thumb t-${art[m.id]}"><span class="comp-icon">${m.icon}</span></div><b>${m.name}</b><span>${m.desc}</span><em>Solo · Online</em></button>`).join('');
    $$('#comp-cards .card').forEach((b) => (b.onclick = () => { this.click(); this.compSel.mode = b.dataset.comp; this.show('comp'); }));
    if (!FREE_MODES.find((m) => m.id === this.playSel.mode)) this.playSel.mode = 'endless';
    $('#mode-cards').innerHTML = FREE_MODES.map((m) => `<button class="card mode ${m.id === this.playSel.mode ? 'sel' : ''}" data-mode="${m.id}"><i>${m.icon}</i><b>${m.name}</b><span>${m.desc}</span></button>`).join('');
    $('#map-cards').innerHTML = MAP_LIST.map((m) => {
      const best = S.bests[`${m.id}:${this.playSel.mode}`];
      return `<button class="card map ${m.id === this.playSel.map ? 'sel' : ''}" data-map="${m.id}" style="--map-accent:${m.accent}"><div class="map-thumb t-${m.id}"></div><small>${m.type}</small><b>${m.name}</b><span>${m.desc}</span>${best ? `<em>Best ${fmt(best)}</em>` : ''}</button>`;
    }).join('');
    $$('#mode-cards .card').forEach((b) => (b.onclick = () => { this.click(); this.playSel.mode = b.dataset.mode; this.renderPlay(); }));
    $$('#map-cards .card').forEach((b) => (b.onclick = () => { this.click(); this.playSel.map = b.dataset.map; this.renderPlay(); }));
    const def = carById(S.car.id);
    $('#play-car').innerHTML = `<span class="swatch" style="background:${S.car.paint}"></span><div><small>${CATEGORIES.find((c) => c.id === def.cat).name}</small><b>${def.name}</b><small>${(DRIVE_STYLES[S.driveStyle] || DRIVE_STYLES.drift).name} style · ${S.driftAngle || 62}° max angle</small></div><button class="btn small" data-go="garage">Change</button>`;
  }

  // ------------------------------------------------------------- COMPETITIVE SETUP
  compMaps(mode) { return mode === 'race' ? RACE_MAPS : mode === 'battle' ? BATTLE_MAPS : MAP_LIST.map((m) => m.id); }
  compOpts(mode) {
    const C = this.compSel[mode];
    if (mode === 'challenge') return { variant: C.variant, time: C.time };
    if (mode === 'race') return { laps: C.laps, ai: C.ai, difficulty: C.difficulty };
    return {};
  }
  renderComp() {
    const mode = this.compSel.mode, M = MODES.find((m) => m.id === mode), C = this.compSel[mode];
    $('#comp-title').textContent = M.name; $('#comp-desc').textContent = M.desc;
    const chips = (list, cur, attr) => `<div class="chips">${list.map(([v, n]) => `<button class="chip ${String(v) === String(cur) ? 'sel' : ''}" data-${attr}="${v}">${n}</button>`).join('')}</div>`;
    const mapCards = this.compMaps(mode).map((id) => {
      const m = MAP_LIST.find((x) => x.id === id), sub = mode === 'race' ? RACE[id].name : mode === 'battle' ? BATTLE[id].name : m.type;
      const pb = this.personalBest(mode, id, C);
      return `<button class="card map ${id === C.map ? 'sel' : ''}" data-cmap="${id}" style="--map-accent:${m.accent}"><div class="map-thumb t-${id}"></div><small>${sub}</small><b>${m.name}</b>${pb ? `<em>${pb}</em>` : ''}</button>`;
    }).join('');
    let h = '';
    if (mode === 'challenge') {
      h += `<div class="setup-row"><label>Challenge type</label>${chips(Object.entries(CHALLENGE_VARIANTS).map(([k, v]) => [k, v.name]), C.variant, 'cvar')}</div>
        <p class="setup-note">${C.variant === 'attack' ? 'Score Attack: your <b>single best drift chain</b> wins. Keep one long combo alive.' : 'Timed Challenge: <b>total points</b> before the timer hits zero.'} Crashes cost 250, leaving the track costs 150 and ends the chain.</p>
        <div class="setup-row"><label>Time limit</label><input type="range" id="c-time" min="30" max="600" step="30" value="${C.time}"><em id="c-time-v">${Math.floor(C.time / 60)}:${String(C.time % 60).padStart(2, '0')}</em></div>`;
    } else if (mode === 'race') {
      h += `<div class="setup-row"><label>Laps</label><input type="range" id="c-laps" min="1" max="10" step="1" value="${C.laps}"><em id="c-laps-v">${C.laps}</em></div>
        <div class="setup-row"><label>CPU opponents (solo)</label><input type="range" id="c-ai" min="0" max="7" step="1" value="${C.ai}"><em id="c-ai-v">${C.ai}</em></div>
        <div class="setup-row"><label>CPU difficulty</label>${chips(Object.entries(AI_SKILL).map(([k, v]) => [k, v.name]), C.difficulty, 'cdiff')}</div>
        <p class="setup-note">Pass every checkpoint in order. Resets never count as checkpoints. Solo races start you at the back of the grid. CPU drivers are clearly labelled and only appear in solo races.</p>`;
    } else {
      h += `<p class="setup-note"><b>Online (2 players):</b> round 1, one of you leads and the other chases; round 2 the roles swap. Lead runs are judged on angle, speed, line, consistency and transitions; chase runs on proximity, speed and angle matching, line and control. Penalties for leaving the course, spinning and contact.<br><b>Solo:</b> drive a judged lead run, then chase a ghost replay of it.</p>`;
    }
    h += `<h3>${mode === 'race' ? 'Circuit' : mode === 'battle' ? 'Battle course' : 'Map'}</h3><div class="cards maps">${mapCards}</div>`;
    $('#comp-setup').innerHTML = h;
    const S = this.S, def = carById(S.car.id);
    $('#comp-car').innerHTML = `<span class="swatch" style="background:${S.car.paint}"></span><div><small>${(DRIVE_STYLES[S.driveStyle] || DRIVE_STYLES.drift).name} style</small><b>${def.name}</b></div><button class="btn small" data-go="garage">Change</button>`;
    $$('[data-cmap]').forEach((b) => (b.onclick = () => { this.click(); C.map = b.dataset.cmap; this.renderComp(); }));
    $$('[data-cvar]').forEach((b) => (b.onclick = () => { this.click(); C.variant = b.dataset.cvar; C.time = CHALLENGE_VARIANTS[C.variant].defaultTime; this.renderComp(); }));
    $$('[data-cdiff]').forEach((b) => (b.onclick = () => { this.click(); C.difficulty = b.dataset.cdiff; this.renderComp(); }));
    const slider = (id, key, f) => { const el = $('#' + id); if (el) el.oninput = () => { C[key] = +el.value; $('#' + id + '-v').textContent = f ? f(C[key]) : C[key]; }; };
    slider('c-time', 'time', (v) => `${Math.floor(v / 60)}:${String(v % 60).padStart(2, '0')}`); slider('c-laps', 'laps'); slider('c-ai', 'ai');
    $('#comp-solo').onclick = () => { this.click(); this.app.startGame({ mapId: C.map, modeId: mode, mp: false, comp: this.compOpts(mode) }); };
    $('#comp-online').onclick = () => { this.click(); this.showCreate({ mode, map: C.map, ...this.compOpts(mode) }); };
  }
  personalBest(mode, map, C) {
    const R = this.S.records || {};
    if (mode === 'challenge') { const r = R.challenge && R.challenge[map]; return r && r[C.variant] ? `PB ${fmt(r[C.variant])}` : ''; }
    if (mode === 'race') { const r = R.race && R.race[map]; const t = r && r.total && r.total[C.laps]; return t ? `PB ${fmtT(t)} (${C.laps} lap${C.laps == 1 ? "" : "s"})` : r && r.lap ? `Best lap ${fmtT(r.lap)}` : ''; }
    const b = R.battle && R.battle.solo && R.battle.solo[map]; return b ? `Solo best ${b}` : '';
  }

  // ------------------------------------------------------------- RECORDS
  async renderRecords() {
    const tabs = [['challenge', 'Drift Challenge'], ['race', 'Speed Race'], ['battle', 'Drift Battle']];
    $('#rec-tabs').innerHTML = tabs.map(([k, n]) => `<button class="tab ${k === this.recTab ? 'sel' : ''}" data-rtab="${k}">${n}</button>`).join('');
    $$('[data-rtab]').forEach((b) => (b.onclick = () => { this.click(); this.recTab = b.dataset.rtab; this.renderRecords(); }));
    const R = this.S.records || {}, tab = this.recTab, mapName = (id) => (MAP_LIST.find((m) => m.id === id) || {}).name || id;
    let mine = '';
    if (tab === 'challenge') {
      const rows = Object.entries(R.challenge || {});
      mine = rows.length ? `<table class="res-table"><tr><th>Map</th><th>Timed</th><th>Score Attack</th><th>Longest drift</th><th>Top combo</th><th>Best angle</th></tr>${rows.map(([m, r]) => `<tr><td>${mapName(m)}</td><td>${r.timed ? fmt(r.timed) : '—'}</td><td>${r.attack ? fmt(r.attack) : '—'}</td><td>${r.longest ? r.longest + ' m' : '—'}</td><td>${r.combo ? '×' + r.combo : '—'}</td><td>${r.angle ? r.angle + '°' : '—'}</td></tr>`).join('')}</table>` : '';
    } else if (tab === 'race') {
      const rows = Object.entries(R.race || {});
      mine = rows.length ? `<table class="res-table"><tr><th>Circuit</th><th>Fastest lap</th><th>Fastest race times</th><th>Wins</th></tr>${rows.map(([m, r]) => `<tr><td>${RACE[m] ? RACE[m].name : m}</td><td>${fmtT(r.lap)}</td><td>${Object.entries(r.total || {}).map(([l, t]) => `${l} lap${l > 1 ? 's' : ''}: ${fmtT(t)}`).join('<br>') || '—'}</td><td>${r.wins || 0}/${r.races || 0}</td></tr>`).join('')}</table>` : '';
    } else {
      const b = R.battle || {};
      const m = (b.wins || 0) + (b.losses || 0) + (b.draws || 0);
      mine = `<table class="res-table"><tr><td>Online battles won</td><td><b>${b.wins || 0}</b></td></tr><tr><td>Lost</td><td>${b.losses || 0}</td></tr><tr><td>Win rate</td><td>${m ? Math.round(((b.wins || 0) / m) * 100) + '%' : '—'}</td></tr><tr><td>Competition points</td><td>${fmt(b.points || 0)}</td></tr></table>
        ${Object.keys(b.solo || {}).length ? `<h4>Solo (lead + ghost chase)</h4><table class="res-table">${Object.entries(b.solo).map(([mm, v]) => `<tr><td>${BATTLE[mm] ? BATTLE[mm].name : mm}</td><td>${v}</td></tr>`).join('')}</table>` : ''}`;
    }
    $('#rec-personal').innerHTML = mine || '<div class="empty">No completed competitions yet.</div>';
    // online leaderboard (server-validated results only)
    const box = $('#rec-online');
    try {
      const url = this.app.net.url(this.S.serverUrl).replace(/^ws/, 'http').replace(/\/ws$/, '/records');
      const data = await (await fetch(url, { cache: 'no-store' })).json();
      if (this.current !== 'records' || this.recTab !== tab) return;
      box.innerHTML = this.onlineHtml(tab, data, mapName) || '<div class="empty">No online results yet. Finish an online competition to appear here.</div>';
    } catch { if (this.current === 'records') box.innerHTML = '<div class="empty">Online leaderboard unavailable (multiplayer server not reachable).</div>'; }
  }
  onlineHtml(tab, D, mapName) {
    const list = (arr, val) => (arr && arr.length ? `<ol class="lb-list">${arr.slice(0, 5).map((e) => `<li><b>${esc(e.name)}</b><em>${val(e)}</em></li>`).join('')}</ol>` : '<span class="muted">—</span>');
    if (tab === 'challenge') return Object.entries(D.challenge || {}).map(([m, c]) => `<div class="lb-block"><h4>${mapName(m)}</h4><div class="lb-cols"><div><small>Timed</small>${list(c.timed, (e) => fmt(e.score))}</div><div><small>Score Attack</small>${list(c.attack, (e) => fmt(e.score))}</div><div><small>Longest drift</small>${list(c.longest, (e) => e.m + ' m')}</div><div><small>Highest combo</small>${list(c.combo, (e) => '×' + e.mult)}</div></div></div>`).join('');
    if (tab === 'race') return Object.entries(D.race || {}).map(([m, r]) => `<div class="lb-block"><h4>${RACE[m] ? RACE[m].name : m}</h4><div class="lb-cols"><div><small>Fastest lap</small>${list(r.lap, (e) => fmtT(e.time))}</div>${Object.entries(r.total || {}).map(([l, a]) => `<div><small>Fastest ${l}-lap race</small>${list(a, (e) => fmtT(e.time))}</div>`).join('')}</div></div>`).join('');
    return D.battle && D.battle.length ? `<table class="res-table"><tr><th>#</th><th>Driver</th><th>Won</th><th>Lost</th><th>Win %</th><th>Points</th></tr>${D.battle.map((e, i) => `<tr><td>${i + 1}</td><td>${esc(e.name)}</td><td>${e.wins}</td><td>${e.losses}</td><td>${e.winPct}%</td><td>${fmt(e.points)}</td></tr>`).join('')}</table>` : '';
  }

  // ------------------------------------------------------------- GARAGE
  // Right panel: driving style + measured stats (stock vs your setup) on top, then tabs:
  // Looks (visual parts) · Performance (parts) · Tuning (setup sliders) · Presets (built-in + yours).
  // Each car remembers its own setup (settings.garage[carId]); custom presets are per car too.
  renderGarage() {
    const S = this.S, cfg = S.car, def = carById(cfg.id);
    cfg.tune = sanitizeTune(cfg.tune, def);
    const tab = this.garageTab || 'looks';
    $('#cat-tabs').innerHTML = CATEGORIES.map((c) => `<button class="tab ${c.id === this.garageCat ? 'sel' : ''}" data-cat="${c.id}">${c.name}</button>`).join('');
    $('#car-list').innerHTML = CARS.filter((c) => c.cat === this.garageCat).map((c) => { const g = (S.garage || {})[c.id]; const tuned = g && !isStock(g.tune); return `<button class="car-item ${c.id === cfg.id ? 'sel' : ''}" data-car="${c.id}"><span class="swatch" style="background:${(g && g.paint) || c.paint}"></span><b>${c.name}</b><small>${tuned ? '<i class="tuned">TUNED</i> ' : ''}${Math.round(this.measuredTop(c, g && g.tune))} km/h</small></button>`; }).join('');
    $('#car-name').innerHTML = `<small>${CATEGORIES.find((c) => c.id === def.cat).name}</small>${def.name}`;
    const ds = DRIVE_STYLES[S.driveStyle] || DRIVE_STYLES.drift;
    const room = this.app.net.room, rule = room && room.rules;
    $('#car-stats').innerHTML = `
      <div class="chips style-chips">${Object.entries(DRIVE_STYLES).map(([k, v]) => `<button class="chip ${k === (S.driveStyle || 'drift') ? 'sel' : ''}" data-style="${k}">${v.name} style</button>`).join('')}</div>
      <p class="style-desc">${ds.desc}</p>
      <div class="stat angle-row"><span>Max drift angle</span><input type="range" id="drift-angle-set" min="35" max="80" step="1" value="${S.driftAngle || 62}"><em id="drift-angle-v">${S.driftAngle || 62}°</em></div>
      ${S.driveStyle === 'race' ? '<p class="style-desc muted">Race style caps slides at 43°.</p>' : ''}
      ${rule && rule !== 'open' ? `<p class="room-rule">Your room uses <b>${RULES[rule].name}</b>: ${RULES[rule].desc}</p>` : ''}
      <div id="tune-stats"></div>`;
    this.renderStats();
    const tabs = [['looks', 'Looks'], ['perf', 'Performance'], ['tune', 'Tuning'], ['presets', 'Presets']];
    let h = `<div class="tabs gtabs">${tabs.map(([k, n]) => `<button class="tab ${k === tab ? 'sel' : ''}" data-gtab="${k}">${n}</button>`).join('')}</div>`;
    const sw = (list, cur, attr) => list.map((c) => `<button class="sw ${c === cur ? 'sel' : ''}" data-${attr}="${c}" style="background:${c || 'transparent'}">${c ? '' : '∅'}</button>`).join('');
    const opts = (list, cur, attr, fits) => list.map((n, i) => `<button class="chip ${i === cur ? 'sel' : ''}" data-${attr}="${i}" ${fits && !fits(i) ? 'disabled title="Does not fit this car"' : ''}>${n}</button>`).join('');
    const T = cfg.tune;
    if (tab === 'looks') {
      const part = (k) => `<h4>${VISUAL[k].name}</h4><div class="chips">${opts(VISUAL[k].opts, cfg[k] | 0, 'vis-' + k, (i) => fitsPart(def, k, i))}</div>`;
      h += `<h4>Paint</h4><div class="swatches">${sw(PAINTS, cfg.paint, 'paint')}<label class="sw custom" title="Custom colour"><input type="color" id="paint-custom" value="${cfg.paint}">+</label></div>
        <h4>Wheel design</h4><div class="chips">${opts(RIMS, cfg.rim, 'rim')}</div>
        ${part('rimSize')}
        <h4>Wheel colour</h4><div class="swatches">${sw(WHEEL_COLORS, cfg.wheel, 'wheel')}<label class="sw custom"><input type="color" id="wheel-custom" value="${cfg.wheel}">+</label></div>
        ${part('fbumper')}${part('rbumper')}${part('skirts')}${part('kit')}${part('hood')}${part('spoiler')}${part('exhaust')}${part('tint')}${part('lights')}
        <h4>Livery</h4><div class="chips">${opts(VISUAL.livery.opts, cfg.livery | 0, 'vis-livery')}<label class="chip colorchip">Colour <input type="color" id="livery-custom" value="${cfg.liveryColor || '#111111'}"></label></div>
        <h4>Racing stripes</h4><div class="chips">${opts(STRIPES, cfg.stripes, 'stripes')}<label class="chip colorchip">Colour <input type="color" id="stripe-custom" value="${cfg.stripeColor || '#ffffff'}"></label></div>
        <h4>Stance &amp; extras</h4><div class="chips"><button class="chip ${cfg.lowered ? 'sel' : ''}" data-toggle="lowered">Lowered (look)</button></div>
        <h4>Underglow</h4><div class="swatches">${sw(GLOWS, cfg.underglow, 'glow')}</div>
        <button class="btn small ghost" id="reset-look">Reset to factory look</button>`;
    } else if (tab === 'perf') {
      const tireKeys = PARTS.tires.keys, allowed = allowedTires(def);
      const lv = (k) => `<div class="part"><h4>${PARTS[k].name}</h4><div class="chips">${PARTS[k].levels.map((n, i) => `<button class="chip ${T[k] === i ? 'sel' : ''}" data-part="${k}" data-v="${i}" ${i > maxLevel(def, k) ? 'disabled title="Not available for this car"' : ''}>${n}</button>`).join('')}</div><p class="muted">${PARTS[k].desc}</p></div>`;
      h += lv('engine') + lv('gearbox')
        + `<div class="part"><h4>${PARTS.tires.name}</h4><div class="chips">${tireKeys.map((k, i) => `<button class="chip ${T.tires === k ? 'sel' : ''}" data-tires="${k}" ${allowed.includes(k) ? '' : 'disabled title="Not available for this car"'}>${PARTS.tires.levels[i]}</button>`).join('')}</div><p class="muted">${PARTS.tires.desc}</p></div>`
        + lv('susp') + lv('brakes') + lv('weight')
        + `<button class="btn small ghost" data-preset="stock">Return to stock setup</button>`;
    } else if (tab === 'tune') {
      const groups = {};
      for (const [k, d] of Object.entries(SLIDERS)) (groups[d.group] = groups[d.group] || []).push([k, d]);
      for (const [g, list] of Object.entries(groups)) {
        h += `<h4>${g}</h4>` + list.map(([k, d]) => `<div class="tslider"><span>${d.name}</span><div class="tsl-row"><small>${d.lo}</small><input type="range" data-slider="${k}" min="${d.min ?? -3}" max="${d.max ?? 3}" step="1" value="${T[k]}"><small>${d.hi}</small></div><em>${T[k] > 0 ? '+' : ''}${T[k]}</em></div>`).join('');
      }
      h += `<p class="muted">Suspension springs, weight transfer and brake balance also change how the car rides bumps and behaves under braking, which the flat-pad stats above can't show. Try them on Kurogane Pass.</p>
        <button class="btn small ghost" id="tune-zero">Reset sliders to factory</button>`;
    } else {
      const mine = ((S.presets || {})[def.id] || []);
      const bi = builtinPresets(def);
      const cur = JSON.stringify(T);
      h += `<h4>Built-in setups for the ${esc(def.name)}</h4><div class="preset-grid">${Object.keys(bi).map((k) => `<button class="preset ${JSON.stringify(bi[k]) === cur ? 'sel' : ''}" data-preset="${k}"><b>${PRESET_NAMES[k]}</b><small>${PRESET_INFO[k]}</small></button>`).join('')}</div>
        <p class="muted">Built-in setups change performance parts and tuning only; your paint and body parts stay.</p>
        <h4>Your presets for this car</h4>
        ${mine.length ? `<div class="my-presets">${mine.map((p, i) => `<div class="mp-row"><input class="mp-name" data-i="${i}" value="${esc(p.name)}" maxlength="24" title="Rename"><button class="btn small" data-mload="${i}">Load</button><button class="btn small ghost" data-mdup="${i}" title="Duplicate">Copy</button><button class="btn small ghost danger" data-mdel="${i}" title="Delete">✕</button></div>`).join('')}</div>` : '<p class="muted">None yet. Save the current car (looks + performance + tuning) as a preset:</p>'}
        <div class="mp-save"><input id="mp-newname" maxlength="24" placeholder="Preset name" value="${esc(def.name)} setup ${mine.length + 1}"><button class="btn small primary" id="mp-savebtn">Save preset</button></div>
        <button class="btn small ghost" id="restore-all">Restore original vehicle (factory look + stock setup)</button>`;
    }
    $('#custom').innerHTML = h;
    this.bindGarage(def);
  }
  measuredTop(def, tune) { // top speed as measured in the physics (the same number as the stat bar)
    const style = this.S.driveStyle || 'drift', k = JSON.stringify([def.id, style, tune && !isStock(tune) ? sanitizeTune(tune, def) : null]);
    this.statCache = this.statCache || new Map();
    if (!this.statCache.has(k)) this.statCache.set(k, measureStats(applyTune(def, tune && !isStock(tune) ? tune : null), style));
    return this.statCache.get(k).top;
  }
  // stat bars: stock (faded) vs your current setup, both measured in the physics engine
  renderStats() {
    const S = this.S, cfg = S.car, def = carById(cfg.id), style = S.driveStyle || 'drift';
    const keyS = JSON.stringify([def.id, style, null]), keyC = JSON.stringify([def.id, style, isStock(cfg.tune) ? null : cfg.tune]);
    this.statCache = this.statCache || new Map();
    const get = (k, tune) => { if (!this.statCache.has(k)) { if (this.statCache.size > 80) this.statCache.clear(); this.statCache.set(k, measureStats(applyTune(def, tune), style)); } return this.statCache.get(k); };
    const st = get(keyS, null), cu = get(keyC, cfg.tune);
    const rows = [['top'], ['accel'], ['corner'], ['grip'], ['circle', 'response'], ['brake'], ['weight'], ['drift']];
    const better = (k, d) => (STAT_SCALE[k].hi > STAT_SCALE[k].lo ? d > 0 : d < 0);
    const el = $('#tune-stats'); if (!el) return;
    el.innerHTML = `<div class="stat-head"><span></span><span><i class="lg stock"></i>Stock <i class="lg cur"></i>Your setup</span><span></span></div>` + rows.map(([k, k2]) => {
      const sc = STAT_SCALE[k], a = st[k], b = cu[k], d = b - a, show = Math.abs(d) >= (k === 'top' || k === 'weight' || k === 'drift' ? 1 : 0.05);
      const f2 = k2 ? (statFrac(k, b) * 0.7 + statFrac(k2, cu[k2]) * 0.3) : statFrac(k, b), f1 = k2 ? (statFrac(k, a) * 0.7 + statFrac(k2, st[k2]) * 0.3) : statFrac(k, a);
      const val = `${sc.fmt(b)}<small> ${sc.unit}</small>${k2 ? `<small> · ${STAT_SCALE[k2].fmt(cu[k2])} s</small>` : ''}`;
      return `<div class="tstat" title="${sc.name}: measured in the physics engine (${sc.unit}${k2 ? '; then seconds to turn in fully at 50 km/h' : ''})"><span>${sc.name}</span><div class="bar2"><b style="width:${f1 * 100}%"></b><i style="width:${f2 * 100}%"></i></div><em>${val}${show ? ` <span class="${better(k, d) ? 'up' : 'down'}">${d > 0 ? '+' : ''}${sc.fmt(d)}</span>` : ''}</em></div>`;
    }).join('') + `<p class="muted tiny">Measured by driving the car in the game's physics (${style === 'race' ? 'Race' : 'Drift'} style) on a flat test pad.</p>`;
  }
  bindGarage(def) {
    const S = this.S, cfg = S.car;
    $$('#cat-tabs .tab').forEach((b) => (b.onclick = () => { this.click(); this.garageCat = b.dataset.cat; this.renderGarage(); }));
    $$('#car-list .car-item').forEach((b) => (b.onclick = () => {
      this.click(); if (b.dataset.car === cfg.id) return;
      S.garage = S.garage || {}; S.garage[cfg.id] = JSON.parse(JSON.stringify(cfg)); // remember this car's setup
      const saved = S.garage[b.dataset.car];
      S.car = saved ? { ...defaultConfig(b.dataset.car), ...saved, id: b.dataset.car } : defaultConfig(b.dataset.car);
      this.carChanged();
    }));
    $$('[data-gtab]').forEach((b) => (b.onclick = () => { this.click(); this.garageTab = b.dataset.gtab; this.renderGarage(); }));
    const set = (k, v) => { S.car[k] = v; this.carChanged(); };
    const tune = (k, v) => { S.car.tune = sanitizeTune({ ...S.car.tune, [k]: v }, def); this.carChanged(); };
    $$('[data-paint]').forEach((b) => (b.onclick = () => { this.click(); set('paint', b.dataset.paint); }));
    $$('[data-wheel]').forEach((b) => (b.onclick = () => { this.click(); set('wheel', b.dataset.wheel); }));
    $$('[data-glow]').forEach((b) => (b.onclick = () => { this.click(); set('underglow', b.dataset.glow); }));
    $$('[data-rim]').forEach((b) => (b.onclick = () => { this.click(); set('rim', +b.dataset.rim); }));
    $$('[data-stripes]').forEach((b) => (b.onclick = () => { this.click(); set('stripes', +b.dataset.stripes); }));
    for (const k of Object.keys(VISUAL)) $$(`[data-vis-${k}]`).forEach((b) => (b.onclick = () => { this.click(); set(k, +b.getAttribute('data-vis-' + k)); }));
    $$('[data-toggle]').forEach((b) => (b.onclick = () => { this.click(); set(b.dataset.toggle, S.car[b.dataset.toggle] ? 0 : 1); }));
    if ($('#paint-custom')) { $('#paint-custom').oninput = (e) => { S.car.paint = e.target.value; this.app.showroom.setCar(S.car); }; $('#paint-custom').onchange = () => this.carChanged(); }
    if ($('#wheel-custom')) $('#wheel-custom').onchange = (e) => set('wheel', e.target.value);
    if ($('#stripe-custom')) $('#stripe-custom').onchange = (e) => { S.car.stripeColor = e.target.value; if (!S.car.stripes) S.car.stripes = 1; this.carChanged(); };
    if ($('#livery-custom')) $('#livery-custom').onchange = (e) => { S.car.liveryColor = e.target.value; if (!S.car.livery) S.car.livery = 1; this.carChanged(); };
    $$('[data-style]').forEach((b) => (b.onclick = () => { this.click(); S.driveStyle = b.dataset.style; this.app.saveSettings(); this.renderGarage(); }));
    $('#drift-angle-set').oninput = (e) => { S.driftAngle = +e.target.value; $('#drift-angle-v').textContent = `${S.driftAngle}°`; };
    $('#drift-angle-set').onchange = () => this.app.saveSettings();
    if ($('#reset-look')) $('#reset-look').onclick = () => { this.click(); S.car = { ...defaultConfig(S.car.id), tune: S.car.tune }; this.carChanged(); };
    // performance parts + tuning
    $$('[data-part]').forEach((b) => (b.onclick = () => { this.click(); tune(b.dataset.part, +b.dataset.v); }));
    $$('[data-tires]').forEach((b) => (b.onclick = () => { this.click(); tune('tires', b.dataset.tires); }));
    $$('[data-slider]').forEach((el) => {
      el.oninput = () => { const k = el.dataset.slider; S.car.tune = sanitizeTune({ ...S.car.tune, [k]: +el.value }, def); el.closest('.tslider').querySelector('em').textContent = `${+el.value > 0 ? '+' : ''}${el.value}`; this.renderStats(); };
      el.onchange = () => this.carChanged();
    });
    if ($('#tune-zero')) $('#tune-zero').onclick = () => { this.click(); const t = { ...S.car.tune }; for (const k of Object.keys(SLIDERS)) t[k] = 0; S.car.tune = sanitizeTune(t, def); this.carChanged(); };
    // presets
    $$('[data-preset]').forEach((b) => (b.onclick = () => { this.click(); S.car.tune = builtinPresets(def)[b.dataset.preset]; this.carChanged(); toast(`${PRESET_NAMES[b.dataset.preset]} setup applied`, 1200); }));
    const mine = () => { S.presets = S.presets || {}; return (S.presets[def.id] = S.presets[def.id] || []); };
    const snap = () => { const c = JSON.parse(JSON.stringify(S.car)); delete c.id; return c; };
    if ($('#mp-savebtn')) $('#mp-savebtn').onclick = () => { this.click(); const name = ($('#mp-newname').value || '').trim().slice(0, 24) || 'My setup'; mine().push({ name, cfg: snap() }); this.app.saveSettings(); this.renderGarage(); toast(`Saved preset “${esc(name)}”`, 1200); };
    $$('[data-mload]').forEach((b) => (b.onclick = () => { this.click(); const p = mine()[+b.dataset.mload]; S.car = { ...defaultConfig(def.id), ...JSON.parse(JSON.stringify(p.cfg)), id: def.id }; this.carChanged(); toast(`Loaded “${esc(p.name)}”`, 1200); }));
    $$('[data-mdup]').forEach((b) => (b.onclick = () => { this.click(); const p = mine()[+b.dataset.mdup]; mine().splice(+b.dataset.mdup + 1, 0, { name: `${p.name} (copy)`.slice(0, 24), cfg: JSON.parse(JSON.stringify(p.cfg)) }); this.app.saveSettings(); this.renderGarage(); }));
    $$('[data-mdel]').forEach((b) => (b.onclick = () => { this.click(); const p = mine()[+b.dataset.mdel]; if (!confirm(`Delete preset “${p.name}”?`)) return; mine().splice(+b.dataset.mdel, 1); this.app.saveSettings(); this.renderGarage(); }));
    $$('.mp-name').forEach((el) => (el.onchange = () => { const v = el.value.trim().slice(0, 24); if (v) { mine()[+el.dataset.i].name = v; this.app.saveSettings(); } }));
    if ($('#restore-all')) $('#restore-all').onclick = () => { this.click(); S.car = defaultConfig(def.id); this.carChanged(); toast('Restored the factory car', 1200); };
  }
  carChanged() {
    this.S.garage = this.S.garage || {}; this.S.garage[this.S.car.id] = JSON.parse(JSON.stringify(this.S.car));
    this.app.saveSettings();
    this.app.showroom.setCar(this.S.car);
    if (this.app.net.room) this.app.net.send({ t: 'car', car: this.S.car });
    this.renderGarage();
  }

  // ------------------------------------------------------------- MULTIPLAYER
  async enterMP() {
    const S = this.S, N = this.app.net;
    $('#mp-name').value = S.playerName;
    $('#mp-server').value = S.serverUrl || '';
    $('#mp-name').onchange = (e) => { S.playerName = e.target.value.trim().slice(0, 16) || S.playerName; this.app.saveSettings(); N.send({ t: 'name', name: S.playerName }); };
    $('#mp-server').onchange = (e) => { S.serverUrl = e.target.value.trim(); this.app.saveSettings(); N.close(); setTimeout(() => this.enterMP(), 200); };
    $('#mp-refresh').onclick = () => { this.click(); N.send({ t: 'list' }); };
    $('#mp-join').onclick = () => { this.click(); const code = $('#mp-code').value.trim().toUpperCase(); if (code) this.joinRoom(code); };
    $('#mp-code').onkeydown = (e) => { if (e.key === 'Enter') $('#mp-join').click(); };
    $('#mp-create').onclick = () => { this.click(); this.showCreate(); };
    const rj = $('#mp-rejoin');
    if (S.lastRoom) { rj.classList.remove('hidden'); rj.textContent = `Rejoin ${S.lastRoom}`; rj.onclick = () => { this.click(); this.joinRoom(S.lastRoom); }; } else rj.classList.add('hidden');
    const host = N.url(S.serverUrl).replace(/^wss?:\/\//, '').replace(/\/ws$/, '');
    this.setStatus(`Connecting to ${host}…`, '');
    $('#room-list').innerHTML = '<div class="empty">Looking for rooms…</div>';
    try {
      // free hosting can take ~a minute to wake up, so keep trying for a while
      await N.connect(S.playerName, S.car, S.serverUrl, { patience: host.startsWith('localhost') ? 0 : 75000, onAttempt: (n) => { if (n > 1 && this.current === 'mp') this.setStatus(`Waking up ${host}… (try ${n}, free servers can take up to a minute)`, ''); } });
      this.setStatus(`Connected to ${host}`, 'ok');
      N.send({ t: 'list' });
      clearInterval(this._listT);
      this._listT = setInterval(() => { if (this.current === 'mp') N.send({ t: 'list' }); else clearInterval(this._listT); }, 3000);
    } catch {
      const local = location.protocol === 'file:';
      this.setStatus(local ? 'No multiplayer server running' : 'Server offline', 'bad');
      $('#room-list').innerHTML = `<div class="empty">Can't reach the multiplayer server.<br>Single-player still works from <b>Play</b>.<br><br>${local
        ? 'To play with friends online, enter your online server address under <b>Server</b> (see <b>HOW TO PLAY.txt</b> → "Multiplayer online"), or run <b>Start-Multiplayer-Server.bat</b> for same-network play.'
        : 'Ask whoever runs the server to start it again.'}</div>`;
    }
  }
  setStatus(t, cls) { const el = $('#mp-status'); el.textContent = t; el.className = 'status ' + cls; }
  renderRooms(rooms) {
    if (this.current !== 'mp') return;
    const mapName = (id) => (MAP_LIST.find((m) => m.id === id) || {}).name || id, modeName = (id) => (MODES.find((m) => m.id === id) || {}).name || id;
    $('#room-list').innerHTML = rooms.length ? rooms.map((r) => `<div class="room-row"><div><b>${esc(r.name)}</b><small>${mapName(r.map)} · ${modeName(r.mode)} · <i class="rule-tag ${r.rules || 'open'}" title="${RULES[r.rules || 'open'].desc}">${RULES[r.rules || 'open'].short}</i> · ${r.status === 'playing' ? '<i class="live">In game</i>' : 'In lobby'}</small></div><span class="count">${r.count}/${r.max}</span><code>${r.code}</code><button class="btn small primary" data-join="${r.code}" ${r.count >= r.max ? 'disabled' : ''}>Join</button></div>`).join('')
      : '<div class="empty">No public rooms right now.<br>Create one and share the code with friends!</div>';
    $$('[data-join]').forEach((b) => (b.onclick = () => { this.click(); this.joinRoom(b.dataset.join); }));
  }
  async joinRoom(code) {
    const N = this.app.net, S = this.S;
    try { await N.connect(S.playerName, S.car, S.serverUrl, { patience: 30000 }); } catch { return toast('Multiplayer server unreachable', 3000, 'bad'); }
    // look at the room first: if it restricts performance mods, show its rules before joining
    const info = await new Promise((res) => { const off = N.on('peek', (m) => { off(); res(m.room); }); N.send({ t: 'peek', code }); setTimeout(() => { off(); res(undefined); }, 4000); });
    if (info === null) {
      // the room is gone (closed, or the server restarted): say so and forget it, never join something else
      if (S.lastRoom === code) { S.lastRoom = ''; this.app.saveSettings(); if (this.current === 'mp') $('#mp-rejoin').classList.add('hidden'); }
      return toast(`Room ${esc(code)} doesn't exist any more (it closed, or the server restarted). Create a new room.`, 5000, 'bad');
    }
    if (info && info.rules && info.rules !== 'open') {
      const ok = await this.confirmRules(info); if (!ok) return;
    }
    N.send({ t: 'join', code, car: S.car });
  }
  confirmRules(r) {
    const tuned = !isStock(this.S.car.tune);
    return new Promise((res) => {
      const d = document.createElement('div'); d.id = 'rules-dlg'; d.className = 'modal';
      const mapName = (id) => (MAP_LIST.find((m) => m.id === id) || {}).name || id, modeName = (id) => (MODES.find((m) => m.id === id) || {}).name || id;
      d.innerHTML = `<div class="panel narrow"><h2>Room rules</h2><p><b>${esc(r.name)}</b> · ${modeName(r.mode)} · ${mapName(r.map)}</p>
        <p class="room-rule"><b>${RULES[r.rules].name}.</b> ${RULES[r.rules].desc}</p>
        ${tuned ? '<p class="muted">Your car is tuned: in this room it drives with ' + (r.rules === 'stock' ? 'its factory setup' : 'equalized performance') + '. Your setup stays saved for other rooms.</p>' : ''}
        <div class="row-btns"><button class="btn ghost" data-r="0">Cancel</button><button class="btn primary" data-r="1" id="rules-join">Join room</button></div></div>`;
      document.body.appendChild(d);
      d.querySelectorAll('[data-r]').forEach((b) => (b.onclick = () => { this.click(); d.remove(); res(b.dataset.r === '1'); }));
    });
  }
  // map options valid for a mode (races need a circuit, battles a battle course)
  mapOptions(mode, cur) {
    const ids = this.compMaps(mode);
    return ids.map((id) => { const m = MAP_LIST.find((x) => x.id === id); const sub = mode === 'race' ? RACE[id].name : mode === 'battle' ? BATTLE[id].name : m.type; return `<option value="${id}" ${id === cur ? 'selected' : ''}>${m.name} — ${sub}</option>`; }).join('');
  }
  modeOptions(cur) {
    return `<optgroup label="Competitive">${COMP_MODES.map((m) => `<option value="${m.id}" ${m.id === cur ? 'selected' : ''}>${m.name}</option>`).join('')}</optgroup><optgroup label="Free play">${FREE_MODES.map((m) => `<option value="${m.id}" ${m.id === cur ? 'selected' : ''}>${m.name}</option>`).join('')}</optgroup>`;
  }
  // mode-specific room fields; `v` = current values, `dis` = disabled attr
  modeFields(mode, v, dis = '', pre = 'cr') {
    if (mode === 'challenge') return `<label>Challenge type<select id="${pre}-variant" ${dis}>${Object.entries(CHALLENGE_VARIANTS).map(([k, x]) => `<option value="${k}" ${k === v.variant ? 'selected' : ''}>${x.name}</option>`).join('')}</select></label><label>Time limit (seconds)<input id="${pre}-mtime" type="number" min="30" max="600" step="30" value="${v.matchTime}" ${dis}></label>`;
    if (mode === 'race') return `<label>Laps<input id="${pre}-laps" type="number" min="1" max="10" value="${v.laps}" ${dis}></label>`;
    if (mode === 'battle') return '<p class="muted">Drift Battle is 1 v 1: the first two players compete, anyone else spectates.</p>';
    if (mode === 'competitive') return `<label>Rounds<input id="${pre}-rounds" type="number" min="1" max="5" value="${v.rounds}" ${dis}></label><label>Round length (s)<input id="${pre}-time" type="number" min="30" max="300" step="15" value="${v.roundTime}" ${dis}></label>`;
    return '';
  }
  showCreate(preset = {}) {
    const S = this.S;
    const st = { mode: preset.mode || 'challenge', map: preset.map || 'track', variant: preset.variant || 'timed', matchTime: preset.time || 120, laps: preset.laps || 3, rounds: 3, roundTime: 90, pub: true };
    const draw = () => {
      if (!this.compMaps(st.mode).includes(st.map)) st.map = this.compMaps(st.mode)[0];
      $('#create-form').innerHTML = `
      <label>Room name<input id="cr-name" maxlength="24" value="${esc(st.name || S.playerName + "'s room")}"></label>
      <label>Visibility<div class="chips" id="cr-vis"><button class="chip ${st.pub ? 'sel' : ''}" data-v="1">Public</button><button class="chip ${st.pub ? '' : 'sel'}" data-v="0">Private (code only)</button></div></label>
      <label>Game mode<select id="cr-mode">${this.modeOptions(st.mode)}</select></label>
      <label>Map<select id="cr-map">${this.mapOptions(st.mode, st.map)}</select></label>
      <div class="mode-fields">${this.modeFields(st.mode, st)}</div>
      <label>Max players<input id="cr-max" type="number" min="2" max="12" value="${st.mode === 'battle' ? 2 : 8}"></label>
      <label>Performance mods<select id="cr-rules">${Object.entries(RULES).map(([k, x]) => `<option value="${k}" ${k === (st.rules || 'open') ? 'selected' : ''}>${x.name}</option>`).join('')}</select></label>
      <p class="muted" id="cr-rules-d">${RULES[st.rules || 'open'].desc}</p>`;
      $$('#cr-vis .chip').forEach((b) => (b.onclick = () => { st.pub = b.dataset.v === '1'; st.name = $('#cr-name').value; draw(); }));
      $('#cr-mode').onchange = (e) => { st.mode = e.target.value; st.name = $('#cr-name').value; draw(); };
      $('#cr-map').onchange = (e) => { st.map = e.target.value; };
      $('#cr-rules').onchange = (e) => { st.rules = e.target.value; $('#cr-rules-d').textContent = RULES[st.rules].desc; };
    };
    draw();
    $('#create-go').onclick = async () => {
      this.click();
      const N = this.app.net, val = (id, d) => ($('#' + id) ? $('#' + id).value : d), btn = $('#create-go');
      if (btn.disabled) return; // one room per click, even while a sleeping server wakes up
      btn.disabled = true;
      try { await N.connect(S.playerName, S.car, S.serverUrl, { patience: 30000 }); } catch { btn.disabled = false; return toast('Multiplayer server unreachable', 3000, 'bad'); }
      setTimeout(() => { btn.disabled = false; }, 1500);
      N.send({ t: 'create', car: S.car, settings: { name: $('#cr-name').value, isPublic: st.pub, map: $('#cr-map').value, mode: $('#cr-mode').value, maxPlayers: +$('#cr-max').value, rounds: +val('cr-rounds', 3), roundTime: +val('cr-time', 90), variant: val('cr-variant', 'timed'), matchTime: +val('cr-mtime', 120), laps: +val('cr-laps', 3), rules: val('cr-rules', 'open') } });
    };
    this.show('create');
  }
  renderLobby() {
    const N = this.app.net, room = N.room; if (!room || this.current !== 'lobby') return;
    const host = room.hostId === N.id;
    this.S.lastRoom = room.code; this.app.saveSettings();
    $('#lobby-title').innerHTML = `${esc(room.name)} <span class="tag">${room.isPublic ? 'Public' : 'Private'}</span>`;
    $('#lobby-code').textContent = room.code;
    $('#lobby-players').innerHTML = room.players.map((p) => {
      const d = carById(p.car.id);
      return `<div class="player ${p.id === N.id ? 'me' : ''}"><span class="swatch" style="background:${p.car.paint}"></span><b>${esc(p.name)}</b>${p.id === room.hostId ? '<i class="crown" title="Host">♛ Host</i>' : ''}${p.away ? '<i class="away-tag">reconnecting…</i>' : ''}${room.match && !room.match.competitors.includes(p.id) ? '<i class="away-tag">spectating</i>' : ''}<small>${d.name} · ${(room.rules || 'open') === 'open' ? esc(tuneSummary(p.car.tune || {})) : RULES[room.rules].short}</small></div>`;
    }).join('') + `<div class="slots">${room.players.length} / ${room.maxPlayers} players</div>`;
    const dis = host && room.status === 'lobby' ? '' : 'disabled';
    const dis2 = host ? '' : 'disabled';
    $('#lobby-settings').innerHTML = `
      <label>Room name<input id="lb-name" maxlength="24" value="${esc(room.name)}" ${dis2}></label>
      <label>Visibility<select id="lb-pub" ${dis2}><option value="1" ${room.isPublic ? 'selected' : ''}>Public</option><option value="0" ${room.isPublic ? '' : 'selected'}>Private</option></select></label>
      <label>Mode<select id="lb-mode" ${dis}>${this.modeOptions(room.mode)}</select></label>
      <label>Map<select id="lb-map" ${dis}>${this.mapOptions(room.mode, room.map)}</select></label>
      <label>Max players<input id="lb-max" type="number" min="2" max="12" value="${room.maxPlayers}" ${dis2}></label>
      ${this.modeFields(room.mode, room, dis, 'lb')}
      <label>Performance mods<select id="lb-rules" ${dis}>${Object.entries(RULES).map(([k, x]) => `<option value="${k}" ${k === (room.rules || 'open') ? 'selected' : ''}>${x.name}</option>`).join('')}</select></label>
      <p class="muted">${RULES[room.rules || 'open'].desc}</p>
      ${this.compMaps(room.mode).includes(room.map) ? '' : '<p class="bad-note">This map has no ' + (room.mode === 'race' ? 'race circuit' : 'battle course') + ' — pick another map.</p>'}
      ${host ? (room.status === 'lobby' ? '<p class="muted"><b>You are the host:</b> you choose the mode and map.</p>' : '<p class="muted">A game is running. Press <b>End game</b> to change mode or map.</p>')
        : `<p class="muted">Only the host (<b>${esc((room.players.find((p) => p.id === room.hostId) || {}).name || '?')}</b>) can change settings.</p>`}`;
    const send = (patch) => N.send({ t: 'settings', settings: patch });
    if (host) {
      $('#lb-name').onchange = (e) => send({ name: e.target.value });
      $('#lb-pub').onchange = (e) => send({ isPublic: e.target.value === '1' });
      $('#lb-map').onchange = (e) => send({ map: e.target.value });
      $('#lb-mode').onchange = (e) => { const mode = e.target.value; const maps = this.compMaps(mode); send({ mode, ...(maps.includes(room.map) ? {} : { map: maps[0] }) }); };
      $('#lb-max').onchange = (e) => send({ maxPlayers: +e.target.value });
      const on = (id, f) => { if ($('#' + id)) $('#' + id).onchange = (e) => send(f(e.target.value)); };
      on('lb-rounds', (v) => ({ rounds: +v })); on('lb-time', (v) => ({ roundTime: +v })); on('lb-variant', (v) => ({ variant: v })); on('lb-mtime', (v) => ({ matchTime: +v })); on('lb-laps', (v) => ({ laps: +v })); on('lb-rules', (v) => ({ rules: v }));
    }
    const start = $('#lobby-start');
    start.classList.toggle('hidden', !host);
    const playing = room.status === 'playing';
    // while a game runs the host's button ends it (everyone back to the lobby), so the host can never be locked out
    start.textContent = playing ? 'End game (everyone → lobby)' : room.mode === 'battle' && room.players.length < 2 ? 'Need 2 players' : 'Start game';
    start.disabled = false;
    start.onclick = () => { this.click(); N.send({ t: playing ? 'end' : 'start' }); };
    const jn = $('#lobby-joinrun');
    jn.classList.toggle('hidden', room.status !== 'playing'); jn.textContent = room.match && room.match.phase !== 'results' ? 'Watch the match ›' : 'Join the running game ›';
    jn.onclick = () => { this.click(); N.send({ t: 'join', code: room.code, car: this.S.car }); };
    $('#lobby-wait').classList.toggle('hidden', host || room.status === 'playing');
    $('#lobby-leave').onclick = () => { this.click(); N.send({ t: 'leave' }); };
    $('#lobby-copy').onclick = () => { navigator.clipboard && navigator.clipboard.writeText(room.code); toast('Room code copied', 1200); };
    $('#lobby-chat-input').onkeydown = (e) => { if (e.key === 'Enter' && e.target.value.trim()) { N.send({ t: 'chat', text: e.target.value.trim() }); e.target.value = ''; } };
  }
  chatLine(m) {
    const line = `<div class="cl ${m.system ? 'sys' : ''}">${m.system ? esc(m.text) : `<b>${esc(m.name)}:</b> ${esc(m.text)}`}</div>`;
    for (const sel of ['#lobby-chat-log', '#chat-log']) {
      const el = $(sel); if (!el) continue;
      el.insertAdjacentHTML('beforeend', line);
      while (el.children.length > 40) el.firstChild.remove();
      el.scrollTop = el.scrollHeight;
    }
    const last = $('#chat-log').lastElementChild; if (last) setTimeout(() => last.classList.add('fade'), 8000);
  }

  // ------------------------------------------------------------- SETTINGS
  renderSettings() {
    const S = this.S, tab = this.settingsTab;
    $('#set-tabs').innerHTML = ['graphics', 'audio', 'camera', 'controls', 'minimap', 'player'].map((t) => `<button class="tab ${t === tab ? 'sel' : ''}" data-tab="${t}">${t[0].toUpperCase() + t.slice(1)}</button>`).join('');
    $$('#set-tabs .tab').forEach((b) => (b.onclick = () => { this.click(); this.settingsTab = b.dataset.tab; this.renderSettings(); }));
    const slider = (id, label, min, max, step, val, fmtv) => `<div class="setting"><span>${label}</span><input type="range" id="${id}" min="${min}" max="${max}" step="${step}" value="${val}"><em id="${id}-v">${fmtv(val)}</em></div>`;
    const choice = (id, label, list, cur) => `<div class="setting"><span>${label}</span><div class="chips" id="${id}">${list.map(([v, n]) => `<button class="chip ${String(v) === String(cur) ? 'sel' : ''}" data-v="${v}">${n}</button>`).join('')}</div></div>`;
    const pct = (v) => `${Math.round(v * 100)}%`;
    let h = '';
    if (tab === 'graphics') {
      h = choice('g-q', 'Graphics quality', [['low', 'Low (Chromebook)'], ['medium', 'Medium'], ['high', 'High']], S.quality)
        + slider('g-scale', 'Render resolution', 0.5, 1, 0.05, S.renderScale, pct)
        + choice('g-fps', 'Show FPS', [[true, 'On'], [false, 'Off']], S.showFps)
        + `<div class="setting"><span>Fullscreen</span><button class="btn small" id="g-full">${document.fullscreenElement ? 'Exit fullscreen' : 'Enter fullscreen'}</button></div>
        <p class="muted">Quality changes scenery density, terrain detail, smoke and draw distance. It applies the next time a map loads (anti-aliasing on High applies after a page reload).</p>`;
    } else if (tab === 'audio') {
      h = slider('a-master', 'Master volume', 0, 1, 0.05, S.master, pct) + slider('a-sfx', 'Effects (engine, tyres)', 0, 1, 0.05, S.sfx, pct) + slider('a-music', 'Music volume', 0, 1, 0.05, S.music, pct)
        + '<p class="muted">Press M while driving to toggle music.</p>';
    } else if (tab === 'camera') {
      h = choice('c-view', 'Default camera', VIEWS.map((v, i) => [i, v.name]), S.camView)
        + slider('c-dist', 'Camera distance', 0.7, 1.6, 0.05, S.camDist, (v) => `${v.toFixed(2)}×`)
        + slider('c-smooth', 'Camera sensitivity (follow speed)', 0.5, 2, 0.05, S.camSmooth, (v) => `${v.toFixed(2)}×`)
        + slider('c-fov', 'Field of view', 55, 90, 1, S.fov, (v) => `${v}°`)
        + choice('c-shake', 'Crash camera shake', [[true, 'On'], [false, 'Off']], S.camShake);
    } else if (tab === 'controls') {
      h = slider('k-steer', 'Steering sensitivity', 0.5, 1.5, 0.05, S.steerSens, (v) => `${v.toFixed(2)}×`)
        + choice('k-pad', 'Gamepad (Xbox / PlayStation)', [[true, 'Enabled'], [false, 'Disabled']], S.gamepad)
        + slider('k-dz', 'Stick deadzone', 0, 0.4, 0.01, S.deadzone, pct)
        + `<div class="binds"><div class="bind-head"><span>Action</span><span>Primary</span><span>Secondary</span></div>${ACTIONS.map((a) => `<div class="bind"><span>${a.label}</span>${[0, 1].map((i) => `<button class="key" data-bind="${a.id}" data-slot="${i}">${keyLabel((S.bindings[a.id] || [])[i])}</button>`).join('')}</div>`).join('')}</div>
        <button class="btn small ghost" id="k-reset">Reset key bindings</button>
        <p class="muted">Gamepad: Left stick steer · RT accelerate · LT brake/reverse · A or RB handbrake · X/B boost · Y camera · View reset · Menu pause.</p>`;
    } else if (tab === 'minimap') {
      const M = S.minimap;
      h = choice('m-on', 'Minimap', [[true, 'On'], [false, 'Off']], M.on)
        + choice('m-size', 'Size', [['s', 'Small'], ['m', 'Medium'], ['l', 'Large']], M.size)
        + choice('m-pos', 'Position', [['bottom-right', 'Bottom right'], ['top-right', 'Top right'], ['top-left', 'Top left'], ['bottom-left', 'Bottom left']], M.pos)
        + choice('m-orient', 'Orientation', [['rotate', 'Rotating (car points up)'], ['north', 'Fixed north-up']], M.orient)
        + choice('m-range', 'Zoom', Object.entries(MINIMAP_RANGES), M.range)
        + '<p class="muted">Auto zoom follows your car and zooms out with speed in free roam and Drift Challenge, and shows the whole circuit in Speed Race and Drift Battle. Press N while driving to show or hide the minimap.</p>';
    } else {
      h = `<div class="setting"><span>Player name</span><input id="p-name" maxlength="16" value="${esc(S.playerName)}"></div>`
        + choice('p-units', 'Speed units', [['kmh', 'km/h'], ['mph', 'mph']], S.units)
        + `<div class="setting"><span>Multiplayer server</span><input id="p-server" placeholder="(same as this page)" value="${esc(S.serverUrl)}"></div>
        <p class="muted">Leave the server blank when the game is opened from the server itself. Set it (e.g. <code>my-drift-server.onrender.com</code>) if you host the game files somewhere else.</p>`;
    }
    $('#set-body').innerHTML = h;
    const bindSlider = (id, key, after) => { const el = $('#' + id); if (!el) return; el.oninput = () => { S[key] = +el.value; $('#' + id + '-v').textContent = el.parentElement.querySelector('em').textContent = this.fmtSlider(id, +el.value); after && after(); this.app.saveSettings(); }; };
    const bindChoice = (id, key, conv, after) => $$(`#${id} .chip`).forEach((b) => (b.onclick = () => { this.click(); S[key] = conv(b.dataset.v); this.app.saveSettings(); after && after(); this.renderSettings(); }));
    const bool = (v) => v === 'true', num = (v) => +v, str = (v) => v;
    bindChoice('g-q', 'quality', str); bindSlider('g-scale', 'renderScale'); bindChoice('g-fps', 'showFps', bool, () => $('#fps').classList.toggle('hidden', !S.showFps));
    if ($('#g-full')) $('#g-full').onclick = () => { if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen && document.documentElement.requestFullscreen(); setTimeout(() => this.renderSettings(), 300); };
    const vol = () => this.app.audio.setVolumes({ master: S.master, sfx: S.sfx, music: S.music });
    bindSlider('a-master', 'master', vol); bindSlider('a-sfx', 'sfx', vol); bindSlider('a-music', 'music', vol);
    bindChoice('c-view', 'camView', num, () => { if (this.app.game) { this.app.game.cam.view = S.camView; this.app.game.cam.snap(); } });
    bindSlider('c-dist', 'camDist'); bindSlider('c-smooth', 'camSmooth'); bindSlider('c-fov', 'fov'); bindChoice('c-shake', 'camShake', bool);
    bindSlider('k-steer', 'steerSens'); bindChoice('k-pad', 'gamepad', bool); bindSlider('k-dz', 'deadzone');
    $$('[data-bind]').forEach((b) => (b.onclick = () => {
      this.click(); b.textContent = 'Press a key…'; b.classList.add('listening');
      this.app.input.capture = (code) => {
        const a = b.dataset.bind, slot = +b.dataset.slot;
        const list = [...(S.bindings[a] || [])];
        if (code === 'Escape' && a !== 'pause') list.splice(slot, 1); else list[slot] = code;
        S.bindings[a] = list.filter(Boolean);
        this.app.saveSettings(); this.renderSettings();
      };
    }));
    if ($('#k-reset')) $('#k-reset').onclick = () => { this.click(); S.bindings = JSON.parse(JSON.stringify(DEFAULT_BINDINGS)); this.app.saveSettings(); this.renderSettings(); };
    if ($('#p-name')) $('#p-name').onchange = (e) => { S.playerName = e.target.value.trim().slice(0, 16) || S.playerName; this.app.saveSettings(); this.app.net.send({ t: 'name', name: S.playerName }); };
    bindChoice('p-units', 'units', str);
    const mm = (id, key, conv) => $$(`#${id} .chip`).forEach((b) => (b.onclick = () => { this.click(); S.minimap[key] = conv(b.dataset.v); this.app.saveSettings(); if (this.app.game && this.app.game.minimap) this.app.game.minimap.applySettings(); this.renderSettings(); }));
    mm('m-on', 'on', bool); mm('m-size', 'size', str); mm('m-pos', 'pos', str); mm('m-orient', 'orient', str); mm('m-range', 'range', str);
    if ($('#p-server')) $('#p-server').onchange = (e) => { S.serverUrl = e.target.value.trim(); this.app.saveSettings(); this.app.net.close(); };
  }
  fmtSlider(id, v) {
    if (id.startsWith('a-') || id === 'g-scale' || id === 'k-dz') return `${Math.round(v * 100)}%`;
    if (id === 'c-fov') return `${v}°`;
    return `${v.toFixed(2)}×`;
  }

  // ------------------------------------------------------------- PAUSE / LOADING
  showPause(on, game) {
    const el = $('#pause');
    el.classList.toggle('hidden', !on);
    if (!on) return;
    const mp = game.mp, host = mp && this.app.net.isHost;
    el.innerHTML = `<div class="pause-card"><h2>Paused</h2>${mp ? '<p class="muted">Multiplayer keeps running while this menu is open.</p>' : ''}
      <button class="btn primary" data-p="resume">Resume</button>
      ${mp ? '' : '<button class="btn" data-p="restart">Restart</button>'}
      <button class="btn" data-p="style">Driving style: <b>${game.car.styleId === 'race' ? 'Race' : 'Drift'}</b> (switch)</button>
      <button class="btn" data-p="settings">Settings</button>
      ${host ? '<button class="btn" data-p="end">End session (everyone → lobby)</button>' : ''}
      ${mp ? '<button class="btn" data-p="lobby">Back to room lobby</button><button class="btn danger" data-p="leave">Leave room</button>' : '<button class="btn danger" data-p="quit">Quit to main menu</button>'}
      <div class="controls-help"><b>Controls</b> W/S accelerate·brake · A/D steer · Space handbrake · Shift boost · C camera · R reset · H hide HUD · M music${mp ? ' · T chat' : ''}<br><b>Tricks</b> Throttle sets the drift angle · opposite lock (+ handbrake tap in Race) = transition · hold handbrake + steer into the slide = 360 · keep sliding past 180° = reverse drift · slow + full lock + throttle = donuts</div></div>`;
    $$('[data-p]', el).forEach((b) => (b.onclick = () => {
      this.click();
      const a = b.dataset.p, N = this.app.net;
      if (a === 'resume') game.togglePause(false);
      if (a === 'restart') { el.classList.add('hidden'); this.app.restartGame(); }
      if (a === 'style') { game.setStyle(game.car.styleId === 'drift' ? 'race' : 'drift'); this.showPause(true, game); }
      if (a === 'settings') { el.classList.add('hidden'); this.settingsReturn = 'none'; this.show('settings'); }
      if (a === 'quit') this.app.quitToMenu();
      if (a === 'end') { N.send({ t: 'end' }); }
      if (a === 'lobby') { this.app.quitToMenu('lobby'); }
      if (a === 'leave') { N.send({ t: 'leave' }); this.app.quitToMenu('mp'); }
    }));
  }
  loading(on, text) { $('#loading').classList.toggle('hidden', !on); if (text) $('#loading-text').textContent = text; }
}
