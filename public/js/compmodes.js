// Competitive mode controllers: Drift Challenge, Speed Race, Drift Race, Drift Battle.
// They plug into Game through a few hooks (load, filterInput, stepExtras, onSample, update,
// draw, hud, destroy). Solo play is fully local; online play follows the SERVER's clock and
// uses the server's official scores/positions/results (the local judges only drive the live HUD).
import { Vehicle, PHYS_DT } from './physics.js';
import { CARS, carById, buildCarModel, carDrawItems } from './cars.js';
import { raceRoute, gridSlots, RaceTracker, battleCourse, RACE } from './tracks.js';
import { CompDriftJudge, round2, BattleRun, battleTotals, challengeScore, CHALLENGE_VARIANTS, DRIFT_RACE, AI_DRIFT, AI_JUDGE, aiDriftSample, driftRaceRank, driftRaceBonus, posFactor } from './judge.js';
import { AIDriver, AI_SKILL, aiDef } from './ai.js';
import { OniRecorder, loadBrain, saveBrain } from './oni.js';
import { BOSSES, bossFor } from './bosses.js';
import { $, fmt, esc, toast } from './ui.js';

export const fmtTime = (t) => (t == null || !Number.isFinite(t) ? '—' : `${Math.floor(t / 60)}:${(t % 60).toFixed(2).padStart(5, '0')}`);
const COUNTDOWN = 3;

export function createComp(game) {
  const k = game.mode.comp;
  if (k === 'challenge') return new ChallengeComp(game);
  if (k === 'race') return new RaceComp(game);
  if (k === 'driftrace') return new DriftRaceComp(game);
  if (k === 'battle') return new BattleComp(game);
  return null;
}

// ======================================================================= base
class Comp {
  constructor(g) {
    this.g = g; this.net = g.net; this.mp = g.mp; this.cfg = g.opts.comp || {};
    this.unsub = []; this.phase = 'pre'; this.clock = 0; this.goAt = null; this.ownsScoring = false;
    this.lastCount = null; this.resultShown = false; this.timers = [];
    this.spectator = !!g.opts.spectator;
  }
  on(t, fn) { this.unsub.push(this.net.on(t, fn)); }
  later(ms, fn) { const id = setTimeout(fn, ms); this.timers.push(id); return id; }
  // seconds since "GO" (negative during the countdown)
  get t() {
    if (this.goAt === null) return -1e9;
    return this.mp ? (performance.now() - this.goAt) / 1000 : this.clock - this.goAt;
  }
  startCountdown(serverStartAt) {
    if (this.mp) this.goAt = this.net.toLocal(serverStartAt);
    else this.goAt = this.clock + COUNTDOWN + 0.6;
    this.phase = 'countdown'; this.lastCount = null;
  }
  filterInput(inp) {
    if (this.phase === 'countdown' || this.phase === 'pre' || this.phase === 'waiting') { inp.throttle = 0; inp.boost = false; inp.brake = 0; inp.handbrake = true; }
  }
  update(dt, simRunning) {
    if (simRunning) this.clock += dt;
    if (this.phase === 'countdown') {
      const t = this.t, c = Math.ceil(-t);
      if (t < 0 && c <= COUNTDOWN && c !== this.lastCount) { this.lastCount = c; this.g.bigText(String(c), 800); this.g.app.audio.blip(660, 0.12, 'square', 0.1); }
      if (t >= 0) { this.phase = 'running'; this.g.bigText('GO!', 900); this.g.app.audio.blip(990, 0.25, 'square', 0.12); this.onGo(); }
    }
  }
  onGo() {}
  stepExtras() {}
  onSample() {}
  draw() {}
  hud() {}
  // results overlay with rematch / menu buttons
  showResults(html, { solo }) {
    this.resultShown = true;
    const el = $('#results'); el.classList.remove('hidden');
    const host = this.mp && this.net.isHost;
    el.innerHTML = `<div class="res-card wide-res">${html}<div class="row res-actions">
      ${solo ? '<button class="btn primary" data-act="rematch">Rematch</button><button class="btn" data-act="menu">Main menu</button>'
        : host ? '<button class="btn primary" data-act="rematch">Rematch (everyone)</button><button class="btn" data-act="lobby">Back to lobby</button>'
          : '<span class="muted">Waiting for the host: rematch or back to lobby…</span><button class="btn" data-act="leave">Leave room</button>'}</div></div>`;
    const b = (a, fn) => { const x = el.querySelector(`[data-act=${a}]`); if (x) x.onclick = fn; };
    b('rematch', () => { if (solo) this.g.app.restartGame(); else this.net.send({ t: 'rematch' }); });
    b('menu', () => this.g.app.quitToMenu());
    b('lobby', () => this.net.send({ t: 'end' }));
    b('leave', () => { this.net.send({ t: 'leave' }); this.g.app.quitToMenu('mp'); });
  }
  // main panel (top centre) + optional standings in the existing top-right leaderboard slot
  hudBox(html, board, title = 'Standings') {
    const el = $('#comp-hud'); el.classList.remove('hidden'); el.innerHTML = html;
    $('#hud').classList.add('comp-on');
    const b = $('#hud-board');
    if (board) { b.classList.remove('hidden'); b.innerHTML = `<div class="lb-title">${title}</div>${board}`; } else b.classList.add('hidden');
  }
  destroy() { this.unsub.forEach((u) => u()); this.timers.forEach(clearTimeout); $('#comp-hud').classList.add('hidden'); $('#comp-hud').innerHTML = ''; $('#hud').classList.remove('comp-on'); }
  // ask the server (online) to start the countdown once our map has loaded
  readyUp() { if (this.mp) this.net.send({ t: 'ready' }); else this.startCountdown(); }
  bindStart() {
    this.on('mStart', (m) => { if (this.g.spectator) return; this.startCountdown(m.startAt); if (m.endAt) this.endAt = this.net.toLocal(m.endAt); });
    this.on('mResult', (m) => this.onServerResult(m));
    const ms = this.net.lastMatch; // arrived while the map was loading
    if (ms && ms.mStart && !this.g.spectator) { this.startCountdown(ms.mStart.startAt); if (ms.mStart.endAt) this.endAt = this.net.toLocal(ms.mStart.endAt); }
    if (ms && ms.mResult) this.later(300, () => this.onServerResult(ms.mResult));
  }
  onServerResult() {}
}

// ======================================================================= DRIFT CHALLENGE
class ChallengeComp extends Comp {
  constructor(g) {
    super(g);
    this.variant = this.cfg.variant || 'timed';
    this.duration = this.cfg.time || CHALLENGE_VARIANTS[this.variant].defaultTime;
    this.ownsScoring = true;
  }
  load() {
    const g = this.g;
    this.judge = new CompDriftJudge(g.opts.mapId, (t, d) => this.onJudgeEvent(t, d));
    g.scorer = this.judge.scorer; g.scorer.enabled = true;
    $('#hud-drift').classList.remove('hidden'); $('#hud-score').classList.remove('hidden');
    this.board = [];
    if (this.mp) { this.bindStart(); this.on('mState', (m) => { if (m.mode === 'challenge') this.board = m.rows; }); }
    this.readyUp();
  }
  onJudgeEvent(t, d) {
    if (t === 'penalty') this.g.onScore('penalty', d);
    else this.g.onScore(t, d);
  }
  onSample(s, ctx) { if (this.phase === 'running' && !this.ended) this.judge.push(s, ctx); }
  update(dt, sim) {
    super.update(dt, sim);
    if (this.phase === 'running' && !this.ended) {
      const left = this.mp && this.endAt ? (this.endAt - performance.now()) / 1000 : this.duration - this.t;
      this.left = Math.max(0, left);
      if (left <= 0) this.finishLocal();
    }
  }
  finishLocal() {
    this.ended = true; this.phase = 'over';
    const sum = this.judge.finish();
    this.g.bigText('TIME!', 1400); this.g.app.audio.chime(true);
    if (!this.mp) {
      this.g.app.saveRecord('challenge', { map: this.g.opts.mapId, variant: this.variant, ...sum });
      this.later(1500, () => this.showResults(this.resultsHtml([{ name: this.g.app.settings.playerName, me: true, ...sum }], true), { solo: true }));
    } else this.hudBox('<div class="cbig">TIME!</div><div class="muted">Waiting for the official results…</div>');
  }
  onServerResult(m) {
    if (m.mode !== 'challenge') return;
    if (!this.ended) { this.ended = true; this.judge.finish(); }
    const me = m.rows.find((r) => r.id === this.net.id);
    if (me && !this._saved) { this._saved = true; this.g.app.saveRecord('challenge', { map: this.g.opts.mapId, variant: m.variant, ...me }); }
    this.showResults(this.resultsHtml(m.rows.map((r) => ({ ...r, me: r.id === this.net.id })), false, m.variant), { solo: false });
  }
  resultsHtml(rows, solo, variant = this.variant) {
    const key = (r) => challengeScore(variant, r);
    rows = [...rows].sort((a, b) => key(b) - key(a));
    const w = rows[0];
    return `<div class="res-kicker">Drift Challenge · ${CHALLENGE_VARIANTS[variant].name} · ${esc(this.g.mapInfo.name)}</div>
      <h2>${solo ? `Final score ${fmt(key(w))}` : `🏆 ${esc(w.name)} wins with ${fmt(key(w))}`}</h2>
      <table class="res-table"><tr><th>#</th><th>Driver</th><th>${variant === 'attack' ? 'Best drift' : 'Score'}</th><th>${variant === 'attack' ? 'Total' : 'Best drift'}</th><th>Top combo</th><th>Longest</th><th>Best angle</th><th>Penalties</th></tr>
      ${rows.map((r, i) => `<tr class="${r.me ? 'me' : ''} ${i === 0 ? 'win' : ''}"><td>${i + 1}</td><td>${esc(r.name)}</td><td><b>${fmt(key(r))}</b></td><td>${fmt(variant === 'attack' ? r.total : r.bestChain)}</td><td>×${r.maxMult}</td><td>${fmt(r.longest)} m</td><td>${r.bestAngle}°</td><td>${r.penalties ? `−${fmt(r.penalties)}` : '—'}</td></tr>`).join('')}</table>
      ${solo ? `<p class="muted">Tricks: ${rows[0].tricks ? Object.entries(rows[0].tricks).filter(([, v]) => v).map(([k, v]) => `${v}× ${k.replace('spins360', '360')}`).join(' · ') || 'none' : ''}</p>` : '<p class="muted">Official scores computed by the server from everyone\'s driving.</p>'}`;
  }
  hud() {
    const v = CHALLENGE_VARIANTS[this.variant];
    const t = this.phase === 'running' ? this.left : this.phase === 'over' ? 0 : this.duration;
    const sum = this.judge.summary();
    let board = '';
    if (this.mp && this.board.length) board = [...this.board].sort((a, b) => b.score - a.score).slice(0, 8).map((r, i) => `<div class="lb-row ${r.id === this.net.id ? 'me' : ''}"><span>${i + 1}</span><b>${esc(r.name)}</b><em>${fmt(r.score)}</em></div>`).join('');
    if (!this.ended) this.hudBox(`<div class="ctag">${v.name}</div><div class="cbig ${t < 10 && this.phase === 'running' ? 'urgent' : ''}">${fmtTime(t).slice(0, -3)}</div>
      <div class="cstats">${this.variant === 'attack' ? `<span>Best drift <b>${fmt(sum.bestChain)}</b></span>` : `<span>Score <b>${fmt(sum.total)}</b></span>`}<span>Top combo <b>×${sum.maxMult}</b></span>${sum.penalties ? `<span class="bad">Penalties −${fmt(sum.penalties)}</span>` : ''}</div>`, board, 'Live scores (server)');
  }
}

// ======================================================================= CPU RIVALS
// named CPU drivers (each with their own factory paint); bosses are in bosses.js
const RIVALS = [
  { name: 'Kenji "Hairpin" Mori', paint: '#c9ccd1' }, { name: 'Lola Vance', paint: '#d4a32a' }, { name: 'Big Tex', paint: '#7c1d22' },
  { name: 'Yuki Snow', paint: '#e8eef5' }, { name: 'Marco Turbo', paint: '#c2531d' }, { name: 'Priya Blaze', paint: '#5b2a86' },
  { name: 'Dutch', paint: '#2f6b3a' }, { name: 'Rook', paint: '#34506e' }, { name: 'Sasha Volt', paint: '#1f9bb5' }, { name: 'Old Man Gus', paint: '#5b6647' },
];
const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

// ======================================================================= SPEED RACE
class RaceComp extends Comp {
  get kind() { return 'race'; }
  load() {
    const g = this.g, S = g.app.settings;
    this.route = raceRoute(g.opts.mapId);
    this.laps = this.cfg.laps || 3;
    this.tracker = new RaceTracker(this.route, this.laps);
    this.ai = [];
    const fight = !this.mp && this.cfg.difficulty === 'bossfight'; // 1v1 against this map's boss
    const nAI = this.mp ? 0 : fight ? 1 : Math.max(0, Math.min(7, this.cfg.ai ?? 5));
    const slots = gridSlots(this.route, Math.max(nAI + 1, 12));
    // solo: the player starts at the back of the grid; online: the server assigns grid slots
    const mySlot = this.mp ? slots[(g.opts.grid || 0) % slots.length] : slots[nAI];
    g.car.place(mySlot.x, mySlot.z, mySlot.h); g.cam.snap();
    this.mySlot = mySlot;
    // CPU racers get a random mix of road cars from the whole catalogue (never trucks, never the secret car)
    const diff = this.cfg.difficulty || 'medium';
    // harder CPUs pick from the faster cars
    let pool = CARS.filter((c) => !['pickup', 'suv', 'creator', 'squad', 'secret', 'boss'].includes(c.cat));
    if (diff === 'hard' || diff === 'legend') pool = pool.filter((c) => c.top >= 60);
    pool = pool.map((c) => c.id);
    for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
    const roster = shuffle([...RIVALS]);
    // Boss: 1v1 with this map's boss. Hard and Legend: Midnight Oni takes pole position.
    this.bossInfo = fight ? bossFor(g.opts.mapId) : nAI > 0 && (diff === 'hard' || diff === 'legend') ? BOSSES.mountain : null;
    this.fight = fight;
    const BI = this.bossInfo;
    for (let i = 0; i < nAI; i++) {
      const isBoss = !!BI && i === 0, rv = isBoss ? null : roster[i % roster.length];
      const id = isBoss ? BI.car : pool[i % pool.length];
      const cfg = isBoss ? { id, spoiler: 0, stripes: 0, ...BI.cfg }
        : { id, paint: rv.paint, wheel: '#cccccc', rim: i % 6, spoiler: i % 4, kit: i % 2, stripes: 0, lowered: 0, underglow: '' };
      const model = buildCarModel(g.app.renderer, cfg);
      const def = isBoss ? carById(id) : aiDef(carById(id), diff); // bosses drive their car exactly as it is in the garage
      const v = new Vehicle(def, g.world, model.meshes.dims, { style: 'race' });
      v.place(slots[i].x, slots[i].z, slots[i].h);
      const name = isBoss ? BI.name : rv.name;
      const tag = document.createElement('div'); tag.className = 'nametag cpu' + (isBoss ? ' boss' : ''); tag.textContent = isBoss ? `${BI.icon} ${BI.title.toUpperCase()}` : name; $('#tags').appendChild(tag);
      if (isBoss) { tag.style.color = BI.color; tag.style.borderColor = BI.color; tag.style.boxShadow = `0 0 12px ${BI.color}99`; }
      this.ai.push({ name, boss: isBoss, v, model, def, drv: new AIDriver(v, this.route.path, isBoss ? 'boss' : diff, 11 + i * 7), tr: new RaceTracker(this.route, this.laps), tag, k: 0 });
    }
    this.boss = this.ai.find((a) => a.boss) || null;
    if (this.boss && !this.mp) { // load what Oni has learned about this track
      const B = this.boss;
      this.oniRec = new OniRecorder(this.route.path, this.route.width);
      loadBrain(g.app.account, g.opts.mapId, this.oniRec.n, BI.id).then((brain) => {
        if (this.destroyed) return;
        this.oniBrain = brain; B.drv.brain = brain; // learned braking points and lines only — no extra power
        if (brain.races) toast(`<b style="color:${BI.color}">${BI.icon} ${esc(BI.name)}</b> has raced here ${brain.races}× (won ${brain.wins}, lost ${brain.losses})<br><small>Remembers this track: ${brain.speed.filter((x) => x !== 1).length} stretches studied</small>`, 4500, 'oni');
      });
    }
    if (this.boss) setTimeout(() => this.taunt(this.oniBrain && this.oniBrain.races ? 'remember' : 'start'), 1600);
    if (!this.mp) { // Enter: skip waiting for the CPUs once you've finished
      this.onKey = (e) => { if (e.key === 'Enter' && this.phase === 'done' && !this.resultShown) this.maybeSoloResults(true); };
      window.addEventListener('keydown', this.onKey);
    }
    this.standings = [];
    if (this.mp) { this.bindStart(); this.on('mState', (m) => { if (m.mode === this.kind) { this.standings = m.rows; this.serverMe = m.rows.find((r) => r.id === this.net.id); } }); }
    this.readyUp();
  }
  stepExtras(dt) {
    // CPUs keep racing after the player finishes, until each one crosses the line or the race timer runs out
    const racing = this.phase === 'running' || (this.phase === 'done' && !this.timeUp);
    const cars = [this.g.car, ...this.ai.map((a) => a.v)];
    for (const a of this.ai) {
      const inp = a.drv.control(dt, cars.filter((c) => c !== a.v), racing && !a.tr.finished);
      a.v.step(dt, inp);
    }
    // every pair once, equal and opposite (resolving each car separately made whoever went first take most of the hit)
    for (let i = 0; i < cars.length; i++) for (let j = i + 1; j < cars.length; j++) Vehicle.collidePair(cars[i], cars[j]);
  }
  onSample(s) {
    const t = this.t;
    if (this.phase !== 'running' && this.phase !== 'done') return;
    const ev = this.tracker.update({ t, x: s.x, z: s.z, vx: s.vx, vz: s.vz, teleport: !!(s.f & 256) });
    if (ev) this.onEvent(ev);
    if (this.oniRec && this.phase === 'running') { // Oni watches you (and himself) on every stretch
      this.oniRec.player(s.x, s.z, Math.hypot(s.vx, s.vz), !!(s.f & 256));
      const B = this.boss; if (!B.tr.finished) this.oniRec.boss(B.drv.idx, B.v.x, B.v.z, B.v.speed, B.drv.teleported, B.v.rel);
    }
    for (const a of this.ai) {
      const e = a.tr.update({ t, x: a.v.x, z: a.v.z, vx: a.v.vx, vz: a.v.vz, teleport: a.drv.teleported }); a.drv.teleported = false;
      if (e && e.type === 'finish') a.finishT = e.t;
    }
  }
  onEvent(ev) {
    const g = this.g;
    if (ev.type === 'lap') { toast(`Lap ${this.tracker.lap}: <b>${fmtTime(ev.lapTime)}</b>${this.tracker.best === ev.lapTime ? ' · best lap!' : ''}`, 2200, 'good'); g.app.audio.chime(true); }
    if (ev.type === 'finish') {
      this.phase = 'done'; g.bigText('FINISH!', 1500); g.app.audio.chime(true);
      if (!this.mp) this.later(1000, () => this.maybeSoloResults());
    }
    if (ev.type === 'checkpoint') g.app.audio.blip(1400, 0.05, 'sine', 0.04);
  }
  // the boss bot talks: at the start, when you pass him, when he passes you, and at the end
  taunt(kind) {
    const L = this.bossInfo && this.bossInfo.lines[kind]; if (!L || !this.boss) return;
    const now = performance.now(); if (kind !== 'start' && kind !== 'win' && kind !== 'lose' && now - (this.tauntAt || 0) < 9000) return;
    this.tauntAt = now;
    const BI = this.bossInfo;
    toast(`<b style="color:${BI.color}">${BI.icon} ${esc(BI.name)}:</b> “${esc(L[Math.floor(Math.random() * L.length)])}”`, 3200, 'oni');
  }
  update(dt, sim) {
    super.update(dt, sim);
    if (this.boss && this.phase === 'running' && this.tracker.started) {
      const me = this.tracker.progress(0, 0), him = this.boss.tr.progress(0, 0), ahead = me > him;
      if (this.bossAhead === undefined) this.bossAhead = ahead;
      else if (ahead !== this.bossAhead) { this.bossAhead = ahead; this.taunt(ahead ? 'passed' : 'passes'); }
    }
    // solo race timer (same limit as online): when it runs out, anyone still racing is DNF
    if (!this.mp && this.goAt !== null && !this.timeUp && (this.phase === 'running' || this.phase === 'done') && this.t > this.timeLimit()) {
      this.timeUp = true;
      if (this.phase === 'running') { this.phase = 'done'; this.g.bigText('TIME UP', 1500); }
      if (!this.resultShown) this.maybeSoloResults(true);
    }
    // solo: results once every CPU has crossed the line too (Enter shows them straight away)
    if (!this.mp && this.phase === 'done' && !this.resultShown && this.ai.every((a) => a.tr.finished)) this.maybeSoloResults(true);
    // missed-checkpoint / wrong-way hint: next gate is behind us and we're moving away from it
    if (this.phase === 'running') {
      const gt = this.route.gates[this.tracker.next], c = this.g.car;
      const d = Math.hypot(c.x - gt.x, c.z - gt.z), toward = (gt.x - c.x) * c.vx + (gt.z - c.z) * c.vz;
      this.warn = this.tracker.started && d > 60 && toward < 0 && c.speed > 5 ? (d > 150 ? 'Missed a checkpoint — turn back!' : 'Wrong way!') : '';
    }
  }
  timeLimit() { return 60 * Math.max(10, this.laps * Math.max(6, (this.route.length || 0) / 1500)); }
  maybeSoloResults(force) {
    if (this.resultShown || (!force && !this.ai.every((a) => a.tr.finished))) return;
    const me = { name: this.g.app.settings.playerName, me: true, tr: this.tracker };
    const all = [me, ...this.ai.map((a) => ({ name: a.name, cpu: true, tr: a.tr }))];
    const rows = all.map((r) => ({ name: r.name, me: r.me, cpu: r.cpu, finished: r.tr.finished, time: r.tr.finishTime, best: r.tr.best, laps: r.tr.lap, prog: r.tr.progress(0, 0) }))
      .sort((a, b) => (b.finished - a.finished) || (a.finished ? a.time - b.time : b.prog - a.prog));
    const mine = rows.find((r) => r.me);
    const bossRow = this.boss ? rows.find((r) => r.cpu && r.name === this.bossInfo.name) : null;
    const beatBoss = !!(bossRow && mine.finished && rows.indexOf(mine) < rows.indexOf(bossRow));
    if (this.boss) this.taunt(beatBoss ? 'lose' : 'win');
    if (this.oniRec && this.oniBrain && !this.oniLearned && this.tracker.started) { // Oni learns from this race
      this.oniLearned = true;
      const L = this.oniRec.learn(this.oniBrain, !beatBoss, true);
      saveBrain(this.g.app.account, this.g.opts.mapId, L.brain, this.bossInfo.id);
      this.later(4200, () => toast(`<b style="color:${this.bossInfo.color}">${this.bossInfo.icon} ${esc(this.bossInfo.name)} learned from this race</b><br><small>${L.faster ? `Faster through ${L.faster} stretch${L.faster === 1 ? '' : 'es'} where you beat him` : 'You taught him nothing new'}${L.careful ? ` · more careful in ${L.careful} where he slipped up` : ''}</small>`, 6000, 'oni'));
    }
    if (mine.finished) this.g.app.saveRecord('race', { map: this.g.opts.mapId, laps: this.laps, time: mine.time, best: mine.best, pos: rows.indexOf(mine) + 1, field: rows.length, beatBoss, bossId: beatBoss ? this.bossInfo.id : null, bossFight: !!this.fight });
    this.showResults(this.resultsHtml(rows, true), { solo: true });
  }
  onServerResult(m) {
    if (m.mode !== 'race') return;
    this.phase = 'done';
    const rows = m.rows.map((r) => ({ ...r, laps: r.lap, me: r.id === this.net.id }));
    const mine = rows.find((r) => r.me);
    if (mine && mine.finished && !this._saved) { this._saved = true; this.g.app.saveRecord('race', { map: this.g.opts.mapId, laps: m.laps, time: mine.time, best: mine.best, pos: rows.indexOf(mine) + 1, field: rows.length }); }
    this.showResults(this.resultsHtml(rows, false), { solo: false });
  }
  resultsHtml(rows, solo) {
    const w = rows[0], lead = w.finished ? w.time : null;
    return `<div class="res-kicker">Speed Race · ${esc(this.route.name)} · ${this.laps} lap${this.laps === 1 ? "" : "s"}${solo ? (this.fight ? ` · 👑 Boss 1v1 vs ${esc(this.bossInfo.title)}` : ` · ${(AI_SKILL[this.cfg.difficulty] || AI_SKILL.medium).name} CPU`) : ''}</div>
      <h2>${w.finished ? `🏆 ${esc(w.name)} wins` : 'No finishers'}${rows.find((r) => r.me) ? ` · you finished P${rows.findIndex((r) => r.me) + 1}` : ''}</h2>
      <table class="res-table"><tr><th>Pos</th><th>Driver</th><th>Total time</th><th>Gap</th><th>Best lap</th><th>Laps</th></tr>
      ${rows.map((r, i) => `<tr class="${r.me ? 'me' : ''} ${i === 0 && r.finished ? 'win' : ''}"><td>${i + 1}</td><td>${esc(r.name)}${r.cpu ? ' <i class="cpu-tag">CPU</i>' : ''}${r.left ? ' <i class="cpu-tag">left</i>' : ''}</td><td><b>${r.finished ? fmtTime(r.time) : 'DNF'}</b></td><td>${r.finished && i > 0 && lead != null ? '+' + (r.time - lead).toFixed(2) : '—'}</td><td>${fmtTime(r.best)}</td><td>${r.laps}/${this.laps}</td></tr>`).join('')}</table>
      <p class="muted">${solo ? 'Laps count only after every checkpoint is passed in order.' : 'Official times and positions computed by the server from validated checkpoints.'}</p>`;
  }
  draw(items, dt) {
    const g = this.g, R = g.app.renderer;
    for (const a of this.ai) {
      const v = a.v;
      carDrawItems(a.model, { x: v.x, y: v.y, z: v.z, yaw: v.h, pitch: v.pitch, roll: v.roll, wheelOffset: v.wheelOffset, steer: v.wheelAngle, spin: v.spin, brake: v.brakeOn, reverse: v.reversing, lights: g.env.night }, items);
      g.carFx({ x: v.x, y: v.y, z: v.z, h: v.h, vx: v.vx, vz: v.vz, speed: v.speed, rel: v.rel, mode: v.mode, drifting: v.drifting, handbrake: v.handbrake, braking: v.brakeOn, boosting: v.boosting }, a.model, a.model.meshes.dims, 'ai' + a.name, dt, false);
      const p = R.project(v.x, v.y + a.model.meshes.dims.roofY + 1, v.z), dist = Math.hypot(v.x - g.cam.eye[0], v.z - g.cam.eye[2]);
      if (p && dist < 200) { a.tag.style.display = 'block'; a.tag.style.transform = `translate(${p[0]}px, ${p[1]}px) translate(-50%, -100%) scale(${Math.min(1.1, Math.max(0.55, 30 / dist))})`; } else a.tag.style.display = 'none';
    }
    // next checkpoint: two light pillars + a line on the ground
    if (this.phase === 'running' || this.phase === 'countdown') {
      const gt = this.route.gates[this.tracker.next], E = g.effects, w = this.route.width / 2 + 1;
      const isFinish = this.tracker.next === 0 && this.tracker.started;
      const col = isFinish ? [0.9, 0.9, 0.9, 1] : [0.1, 0.6, 1.0, 1];
      for (const s of [-1, 1]) {
        const x = gt.x - gt.tz * w * s, z = gt.z + gt.tx * w * s, y = g.world.heightAt(x, z);
        for (let k = 0; k < 6; k++) E.billboardInto(E.add, x, y + 0.6 + k * 1.1, z, 0.55, [col[0] * 0.35, col[1] * 0.35, col[2] * 0.35, 1]);
      }
    }
  }
  standingsRows() {
    if (this.mp && this.standings.length) return this.standings.map((r) => ({ name: r.name, me: r.id === this.net.id, lap: r.lap, finished: r.finished, time: r.time }));
    const t = this.tracker, c = this.g.car;
    const all = [{ name: this.g.app.settings.playerName, me: true, tr: t, x: c.x, z: c.z }, ...this.ai.map((a) => ({ name: a.name, tr: a.tr, x: a.v.x, z: a.v.z }))];
    return all.map((r) => ({ name: r.name, me: r.me, p: r.tr.progress(r.x, r.z), lap: r.tr.lap, finished: r.tr.finished, time: r.tr.finishTime })).sort((a, b) => b.p - a.p);
  }
  hud() {
    const t = this.tracker, rows = this.standingsRows();
    const pos = (this.mp && this.serverMe ? this.serverMe.pos : rows.findIndex((r) => r.me) + 1) || 1;
    const lap = Math.min(this.laps, (this.mp && this.serverMe ? this.serverMe.lap : t.lap) + 1);
    const time = this.phase === 'running' ? this.t : this.phase === 'done' ? (t.finishTime || this.t) : 0;
    const lapNow = t.started && !t.finished ? this.t - t.lapStart : 0;
    const cp = t.started ? (t.next === 0 ? t.gateCount : t.next) : 0;
    this.hudBox(`<div class="race-top"><div class="pos">P${pos}<small>/${rows.length}</small></div>
      <div class="lap">LAP <b>${t.finished ? this.laps : lap}</b>/${this.laps}</div></div>
      <div class="cstats"><span>Time <b>${fmtTime(Math.max(0, time))}</b></span><span>Lap <b>${fmtTime(lapNow)}</b></span><span>Best <b>${fmtTime(t.best)}</b></span></div>
      <div class="cpbar" title="Checkpoints this lap"><i style="width:${(cp / t.gateCount) * 100}%"></i><span>Checkpoint ${cp}/${t.gateCount}</span></div>
      ${this.warn ? `<div class="cwarn">${this.warn}</div>` : ''}
      ${!this.mp && this.phase === 'done' && !this.resultShown ? `<div class="muted">Finished! The others are still racing · time left ${fmtTime(Math.max(0, this.timeLimit() - this.t)).slice(0, -3)} · <b>Enter</b> = results now</div>` : ''}`,
      rows.slice(0, 8).map((r, i) => `<div class="lb-row ${r.me ? 'me' : ''}"><span>${i + 1}</span><b>${esc(r.name)}</b><em>${r.finished ? fmtTime(r.time) : `Lap ${Math.min(this.laps, r.lap + 1)}`}</em></div>`).join(''), 'Race standings');
  }
  destroy() { super.destroy(); this.destroyed = true; for (const a of this.ai) a.tag.remove(); if (this.onKey) window.removeEventListener('keydown', this.onKey); }
}

// ======================================================================= DRIFT RACE
// The Speed Race circuit, grid, laps and checkpoints — but the result is
//   score = drift points × finish factor (position and gap to the winner) + position bonus (judge.js DRIFT_RACE).
// The player's drifting is judged from the official 20 Hz samples (online the SERVER's judge is official);
// CPU drivers race on grip and get an estimated drift score from how hard they corner.
const DNF_AFTER = 60; // solo: seconds after the first CPU finishes before an unfinished player is DNF
class DriftRaceComp extends RaceComp {
  get kind() { return 'driftrace'; }
  load() {
    const g = this.g;
    this.ownsScoring = true;
    this.dj = new CompDriftJudge(g.opts.mapId, (t, d) => { if (t !== 'penalty') g.onScore(t, d); }, DRIFT_RACE.judge);
    g.scorer = this.dj.scorer; g.scorer.enabled = true;
    $('#hud-drift').classList.remove('hidden'); $('#hud-score').classList.remove('hidden');
    super.load();
    this.aiF = AI_DRIFT[this.cfg.difficulty || 'medium'] || AI_DRIFT.medium;
    for (const a of this.ai) { a.dj = new CompDriftJudge(g.opts.mapId, () => {}, AI_JUDGE); a.vy = null; a.sk = 0; a.lastLap = 0; }
    this.cutT = 0;
  }
  aiDrift(a) { return Math.round((a.dj.total + a.dj.live) * this.aiF); }
  myDrift() { return Math.round(this.dj.total + this.dj.live); }
  // drift stops counting DRIFT_RACE.lateWindow s after the first car (player or CPU) crosses the line
  lateCut(t) {
    let first = this.tracker.finished ? this.tracker.finishTime : Infinity;
    for (const a of this.ai) if (a.tr.finished) first = Math.min(first, a.tr.finishTime);
    return t > first + DRIFT_RACE.lateWindow;
  }
  onSample(s, ctx) {
    // judge first, then the tracker (same order as the server): a lap line banks the combo
    if (this.phase === 'running' && this.t >= 0 && !this.tracker.finished && !this.lateCut(this.t)) this.dj.push(s, ctx);
    super.onSample(s, ctx);
  }
  // CPU drift estimates are sampled every 0.05 s of SIMULATED time (not per rendered frame), so a slow
  // frame rate can't change their score
  stepExtras(dt) {
    super.stepExtras(dt);
    if ((this.phase !== 'running' && this.phase !== 'done') || this.t < 0) return;
    for (const a of this.ai) {
      a.acc = (a.acc || 0) + dt;
      while (a.acc >= 0.05) { a.acc -= 0.05; this.aiSample(a); }
    }
  }
  aiSample(a) {
    if (a.tr.lap > a.lastLap) { a.lastLap = a.tr.lap; a.dj.scorer.bank(); } // lap line banks the combo
    if (a.tr.finished) { if (!a.dj.finished) a.dj.finish(); return; }
    if (this.lateCut(this.t)) return;
    const v = a.v, jump = a.px !== undefined && Math.hypot(v.x - a.px, v.z - a.pz) > 8; // stuck-reset
    a.px = v.x; a.pz = v.z;
    const s = { k: ++a.sk, x: round2(v.x), z: round2(v.z), h: round2(v.h), vx: round2(v.vx), vz: round2(v.vz), f: (v.drifting ? 1 : 0) | (jump ? 256 : 0), sl: round2(v.rel) };
    const o = aiDriftSample(s, jump ? null : a.vy, 0.05);
    a.vy = o.velYaw; a.dj.push(o.s);
  }
  onEvent(ev) {
    if (ev.type === 'lap' || ev.type === 'finish') this.dj.scorer.bank();
    if (ev.type === 'finish') this.dj.finish();
    super.onEvent(ev);
  }
  update(dt, sim) {
    super.update(dt, sim);
    // solo: once a CPU has finished, an unfinished player has DNF_AFTER seconds left (no endless slow drifting)
    if (!this.mp && this.phase === 'running' && !this.resultShown && this.ai.some((a) => a.tr.finished)) {
      this.cutT += sim ? dt : 0;
      this.cutLeft = Math.max(0, DNF_AFTER - this.cutT);
      if (this.cutT > DNF_AFTER) { this.phase = 'done'; this.dnf = true; this.dj.finish(); this.g.bigText('TIME UP', 1500); this.maybeSoloResults(true); }
    }
  }
  maybeSoloResults(force) {
    if (this.resultShown || (!force && !this.ai.every((a) => a.tr.finished))) return;
    if (!this.dj.finished) this.dj.finish();
    for (const a of this.ai) if (!a.dj.finished) a.dj.finish();
    const c = this.g.car;
    const all = [{ name: this.g.app.settings.playerName, me: true, tr: this.tracker, x: c.x, z: c.z, drift: this.myDrift() },
      ...this.ai.map((a) => ({ name: a.name, cpu: true, tr: a.tr, x: a.v.x, z: a.v.z, drift: this.aiDrift(a) }))];
    const rows = driftRaceRank(all.map((r) => ({ name: r.name, me: r.me, cpu: r.cpu, finished: r.tr.finished, time: r.tr.finishTime, best: r.tr.best, laps: r.tr.lap, prog: r.tr.progress(r.x, r.z), drift: r.drift })), this.laps);
    const mine = rows.find((r) => r.me);
    this.g.app.saveRecord('driftrace', { map: this.g.opts.mapId, laps: this.laps, score: mine.total, drift: mine.drift, bonus: mine.bonus, racePos: mine.racePos, pos: mine.pos, field: rows.length, finished: mine.finished });
    this.showResults(this.resultsHtml(rows, true), { solo: true });
  }
  onServerResult(m) {
    if (m.mode !== 'driftrace') return;
    this.phase = 'done'; if (!this.dj.finished) this.dj.finish();
    const rows = m.rows.map((r) => ({ ...r, laps: r.lap, me: r.id === this.net.id }));
    const mine = rows.find((r) => r.me);
    if (mine && !this._saved) { this._saved = true; this.g.app.saveRecord('driftrace', { map: this.g.opts.mapId, laps: m.laps, score: mine.total, drift: mine.drift, bonus: mine.bonus, racePos: mine.racePos, pos: mine.pos, field: rows.length, finished: mine.finished }); }
    this.showResults(this.resultsHtml(rows, false), { solo: false });
  }
  resultsHtml(rows, solo) {
    const w = rows[0], mi = rows.findIndex((r) => r.me);
    return `<div class="res-kicker">Drift Race · ${esc(this.route.name)} · ${this.laps} lap${this.laps === 1 ? '' : 's'}${solo ? ` · ${AI_SKILL[this.cfg.difficulty || 'medium'].name} CPU` : ''}</div>
      <h2>${w && w.total > 0 ? `🏆 ${esc(w.name)} wins with ${fmt(w.total)}` : 'No score'}${mi >= 0 ? ` · you placed #${mi + 1}` : ''}</h2>
      <table class="res-table dr-res"><tr><th>#</th><th>Driver</th><th>Race</th><th>Drift pts</th><th></th><th>Pos.</th><th></th><th>Bonus</th><th></th><th>Gap</th><th></th><th>Total</th></tr>
      ${rows.map((r, i) => `<tr class="${r.me ? 'me' : ''} ${i === 0 && r.total > 0 ? 'win' : ''}"><td>${i + 1}</td><td>${esc(r.name)}${r.cpu ? ' <i class="cpu-tag">CPU</i>' : ''}${r.left ? ' <i class="cpu-tag">left</i>' : ''}</td>
        <td>${r.finished ? `P${r.racePos} · ${fmtTime(r.time)}` : `DNF · lap ${Math.min(this.laps, r.laps + 1)}/${this.laps}`}</td><td>${fmt(r.drift)}</td><td class="op">×</td><td>${r.posF.toFixed(2)}</td><td class="op">+</td><td>${r.bonus ? fmt(r.bonus) : '—'}</td><td class="op">×</td><td title="${r.finished ? (r.gap ? `${r.gap.toFixed(1)} s behind the winner` : 'winner') : 'did not finish'}">${r.gapF.toFixed(2)}${r.finished && r.gap ? ` <small class="muted">+${r.gap.toFixed(1)}s</small>` : ''}</td><td class="op">=</td><td><b>${fmt(r.total)}</b></td></tr>`).join('')}</table>
      <p class="muted">Total = (drift pts × position factor + position bonus) × gap factor. Position factor P1 1.0 · P2 0.9 · P3 0.8 · P4 0.68 · P5 0.56 · P6+ 0.45. Gap factor loses 1/60 per second behind the winner (min ${DRIFT_RACE.minGap}; DNF ${DRIFT_RACE.minGap}). Drift stops counting ${DRIFT_RACE.lateWindow} s after the winner finishes. Bonus per lap: ${DRIFT_RACE.bonusPerLap.slice(0, 5).map((b, i) => `P${i + 1} ${fmt(b)}`).join(' · ')}… (× ${this.laps}). No bonus without finishing. ${solo ? 'CPU drift points are estimated from how hard they corner.' : 'Official drift points and positions computed by the server.'}</p>`;
  }
  // live standings: race order, each with drift points and the bonus they'd get finishing there
  drStandings() {
    let rows;
    if (this.mp && this.standings.length) rows = this.standings.map((r) => ({ name: r.name, me: r.id === this.net.id, lap: r.lap, finished: r.finished, time: r.time, drift: (r.drift || 0) + (r.live || 0), racePos: r.pos }));
    else {
      const c = this.g.car;
      rows = [{ name: this.g.app.settings.playerName, me: true, tr: this.tracker, x: c.x, z: c.z, drift: this.myDrift() }, ...this.ai.map((a) => ({ name: a.name, tr: a.tr, x: a.v.x, z: a.v.z, drift: this.aiDrift(a) }))]
        .map((r) => ({ name: r.name, me: r.me, p: r.tr.progress(r.x, r.z), lap: r.tr.lap, finished: r.tr.finished, time: r.tr.finishTime, drift: r.drift }))
        .sort((a, b) => b.p - a.p).map((r, i) => ({ ...r, racePos: i + 1 }));
    }
    // projection: as if finishing in the current position (the gap to the winner is only known at the end)
    for (const r of rows) { const out = this.dnf && r.me; r.bonus = out ? 0 : driftRaceBonus(r.racePos, this.laps, true); r.score = Math.round((r.drift * posFactor(r.racePos) + r.bonus) * (out ? DRIFT_RACE.minGap : 1)); }
    return rows;
  }
  hud() {
    const t = this.tracker, rows = this.drStandings(), me = rows.find((r) => r.me) || { racePos: 1, drift: 0, bonus: 0, score: 0 };
    const lap = Math.min(this.laps, (this.mp && this.serverMe ? this.serverMe.lap : t.lap) + 1);
    const time = this.phase === 'running' ? this.t : this.phase === 'done' ? (t.finishTime || this.t) : 0;
    const cp = t.started ? (t.next === 0 ? t.gateCount : t.next) : 0;
    const sc = this.dj.scorer, combo = sc.chain > 0 ? Math.round(sc.liveScore) : 0;
    const drift = this.myDrift(); // local judge: instant feedback (online the server's numbers rank you)
    const board = [...rows].sort((a, b) => b.score - a.score).slice(0, 8)
      .map((r, i) => `<div class="lb-row ${r.me ? 'me' : ''}"><span>${i + 1}</span><b>${esc(r.name)} <i class="dr-pos">P${r.racePos}</i></b><em>${fmt(r.score)}</em></div>`).join('');
    // the live combo itself is the big drift counter under this panel (#hud-drift)
    this.hudBox(`<div class="race-top"><div class="pos">P${me.racePos}<small>/${rows.length}</small></div>
      <div class="lap">LAP <b>${t.finished ? this.laps : lap}</b>/${this.laps}</div></div>
      <div class="cstats dr-stats"><span>Drift pts <b class="${combo ? 'dr-live' : ''}">${fmt(drift)}</b> ×${posFactor(me.racePos).toFixed(2)}</span><span>P${me.racePos} bonus <b>+${fmt(me.bonus)}</b></span><span>Score <b>${fmt(Math.round(drift * posFactor(me.racePos) + me.bonus))}</b></span><span>Time <b>${fmtTime(Math.max(0, time))}</b></span></div>
      <div class="cpbar" title="Checkpoints this lap"><i style="width:${(cp / t.gateCount) * 100}%"></i><span>Checkpoint ${cp}/${t.gateCount}</span></div>
      ${this.warn ? `<div class="cwarn">${this.warn}</div>` : ''}${this.cutLeft != null && this.phase === 'running' && !this.mp ? `<div class="cwarn">Finish in ${Math.ceil(this.cutLeft)} s or DNF</div>` : ''}`,
      board, 'Drift Race · points');
  }
}

// ======================================================================= DRIFT BATTLE
// Online: the server runs both rounds (A leads/B chases, then swap) and judges them.
// Solo: run 1 = your lead run (judged + recorded); run 2 = chase your own ghost.
class BattleComp extends Comp {
  load() {
    const g = this.g;
    this.course = battleCourse(g.opts.mapId);
    this.round = 1; this.role = 'lead'; this.runs = []; this.ghost = [];
    this.live = null; // local preview judge for the HUD
    if (this.mp) {
      this.bindStartBattle();
    } else {
      this.place('lead');
      this.live = new BattleRun(this.course);
      this.readyUp();
      toast('Run 1: LEAD. Drift the course from the start gate to the finish gate.', 3500);
    }
  }
  place(role) {
    const s = role === 'lead' ? this.course.leadSlot : this.course.chaseSlot;
    this.g.car.place(s.x, s.z, s.h); this.g.cam.snap(); this.g.teleportFlag = true;
  }
  bindStartBattle() {
    const onRound = (m) => {
      this.leadId = m.leadId; this.chaseId = m.chaseId; // spectators need the roles too (minimap: lead / chase)
      if (this.g.spectator) { this.round = m.round; return; }
      this.round = m.round; this.role = m.leadId === this.net.id ? 'lead' : m.chaseId === this.net.id ? 'chase' : 'watch';
      this.leadId = m.leadId; this.chaseId = m.chaseId;
      if (this.role !== 'watch') this.place(this.role);
      this.live = new BattleRun(this.course); this.liveRole = this.role;
      $('#results').classList.add('hidden'); this.resultShown = false;
      this.startCountdown(m.startAt);
      toast(`Round ${m.round}/2: you are <b>${this.role.toUpperCase()}</b>`, 3000);
    };
    this.on('bRound', onRound);
    this.on('bRoundEnd', (m) => this.showRoundEnd(m));
    this.on('mResult', (m) => this.onServerResult(m));
    const ms = this.net.lastMatch;
    if (ms && ms.bRound) onRound(ms.bRound);
    this.net.send({ t: 'ready' });
  }
  filterInput(inp) {
    super.filterInput(inp);
    if (this.phase === 'between') { inp.throttle = 0; inp.handbrake = true; inp.boost = false; }
  }
  onSample(s) {
    if (this.phase !== 'running') return;
    const t = this.t;
    if (!this.mp) {
      if (this.role === 'lead') { this.live.pushLead(s, t); this.ghost.push({ t, s }); }
      else {
        this.live.pushChase(s, t);
        const gs = this.ghostAt(t);
        if (gs) this.live.pushLead(gs, t);
      }
      if (this.live.done || t > this.live.maxT + 1) this.endSoloRun();
    } else if (this.live) {
      // local preview only; the server's judging is official
      if (this.role === 'lead') this.live.pushLead(s, t);
      else if (this.role === 'chase') {
        const L = [...this.g.remotes.values()].find((r) => r.id === this.leadId);
        if (L) this.live.pushLead({ k: s.k, x: L.x, z: L.z, h: L.h, vx: L.vx, vz: L.vz, f: L.flags, sl: L.slip }, t);
        this.live.pushChase(s, t);
      }
    }
  }
  ghostAt(t) {
    const G = this.ghost; if (!G.length) return null;
    let i = this.gi || 0; while (i < G.length - 1 && G[i + 1].t <= t) i++; this.gi = i;
    return G[i].s;
  }
  endSoloRun() {
    const res = this.live.result();
    this.runs.push(res);
    this.phase = 'between';
    if (this.role === 'lead') {
      this.g.bigText('RUN 1 DONE', 1300);
      this.showRunCard(res.lead, 'Lead run', 'Next: chase your own ghost through the same course.');
      this.later(5000, () => {
        $('#results').classList.add('hidden');
        this.role = 'chase'; this.round = 2; this.gi = 0; this.place('chase');
        this.ghostCar = this.ghostCar || this.makeGhost();
        this.live = new BattleRun(this.course);
        this.startCountdown();
        toast('Run 2: CHASE your ghost. Stay close, match its angle and line.', 3500);
      });
    } else {
      const lead = this.runs[0].lead, chase = res.chase;
      const total = Math.round((lead.score + chase.score) * 10) / 10;
      this.g.app.saveRecord('battle', { solo: true, map: this.g.opts.mapId, total, lead: lead.score, chase: chase.score });
      this.showResults(this.soloHtml(lead, chase, total), { solo: true });
    }
  }
  makeGhost() {
    const cfg = { ...this.g.app.settings.car, paint: '#d6d8db', underglow: '', livery: 0, stripes: 0 }; // neutral pale-grey ghost
    const model = buildCarModel(this.g.app.renderer, cfg);
    const tag = document.createElement('div'); tag.className = 'nametag ghost'; tag.textContent = 'GHOST · your lead run'; $('#tags').appendChild(tag);
    return { model, tag };
  }
  showRunCard(side, title, sub) {
    const el = $('#results'); el.classList.remove('hidden');
    el.innerHTML = `<div class="res-card"><div class="res-kicker">${title}</div><h2>${side.score} pts</h2>${partsHtml(side)}<p class="muted">${sub}</p></div>`;
  }
  showRoundEnd(m) {
    this.phase = 'between';
    const r = m.result, me = this.net.id;
    const mine = m.leadId === me ? r.lead : m.chaseId === me ? r.chase : null;
    const el = $('#results'); el.classList.remove('hidden');
    el.innerHTML = `<div class="res-card wide-res"><div class="res-kicker">Round ${m.round}/2 judged by the server</div>
      <div class="battle-cols"><div><h3>LEAD · ${esc(m.leadName)}</h3><h2>${r.lead.score}</h2>${partsHtml(r.lead)}</div><div><h3>CHASE · ${esc(m.chaseName)}</h3><h2>${r.chase.score}</h2>${partsHtml(r.chase)}</div></div>
      <p class="muted">${m.round === 1 ? 'Roles switch for round 2…' : 'Final result coming up…'}${mine ? ` You scored ${mine.score}.` : ''}</p></div>`;
  }
  onServerResult(m) {
    if (m.mode !== 'battle') return;
    const me = this.net.id, A = m.a, B = m.b;
    const mine = A.id === me ? A : B.id === me ? B : null, other = mine === A ? B : A;
    if (mine && !this._saved) { this._saved = true; this.g.app.saveRecord('battle', { solo: false, map: this.g.opts.mapId, won: m.winnerId === me, draw: !m.winnerId, total: mine.total, lead: mine.lead.score, chase: mine.chase.score, opponent: other.name }); }
    const col = (P) => `<div><h3>${esc(P.name)}${P.id === m.winnerId ? ' 🏆' : ''}</h3><h2>${P.total}</h2><table class="res-table small"><tr><td>Lead run</td><td>${P.lead.score}</td></tr><tr><td>Chase run</td><td>${P.chase.score}</td></tr><tr><td>Penalties</td><td>${P.penalties ? '−' + P.penalties : '—'}</td></tr></table>${penList(P)}</div>`;
    this.showResults(`<div class="res-kicker">Drift Battle · ${esc(this.course.name)}${m.forfeit ? ' · forfeit' : ''}</div>
      <h2>${m.winnerId ? `🏆 ${esc((m.winnerId === A.id ? A : B).name)} wins the battle` : 'Draw'}</h2>
      <div class="battle-cols">${col(A)}${col(B)}</div><p class="muted">${m.forfeit ? esc(m.forfeit) : 'Combined score = lead run + chase run (server judged).'}</p>`, { solo: false });
  }
  soloHtml(lead, chase, total) {
    return `<div class="res-kicker">Drift Battle (solo) · ${esc(this.course.name)}</div><h2>Combined score ${total}</h2>
      <div class="battle-cols"><div><h3>Your lead run</h3><h2>${lead.score}</h2>${partsHtml(lead)}</div><div><h3>Chasing your ghost</h3><h2>${chase.score}</h2>${partsHtml(chase)}</div></div>
      <p class="muted">Solo battles are practice against your own recorded lead run — no CPU pretends to be a player.</p>`;
  }
  draw(items, dt) {
    const g = this.g;
    if (!this.mp && this.role === 'chase' && this.ghostCar && this.phase !== 'pre') {
      const gs = this.ghostAt(Math.max(0, this.t)) || (this.ghost[0] && this.ghost[0].s);
      if (gs) {
        const y = g.world.heightAt(gs.x, gs.z);
        carDrawItems(this.ghostCar.model, { x: gs.x, y, z: gs.z, yaw: gs.h, spin: this.t * 20, steer: 0, lights: true }, items);
        const speed = Math.hypot(gs.vx, gs.vz);
        g.carFx({ x: gs.x, y, z: gs.z, h: gs.h, vx: gs.vx, vz: gs.vz, speed, rel: gs.sl, mode: gs.f & 1 ? 'drift' : 'grip', drifting: !!(gs.f & 1) }, this.ghostCar.model, this.ghostCar.model.meshes.dims, 'ghost', dt, false);
        const p = g.app.renderer.project(gs.x, y + 2.4, gs.z);
        if (p) { this.ghostCar.tag.style.display = 'block'; this.ghostCar.tag.style.transform = `translate(${p[0]}px, ${p[1]}px) translate(-50%, -100%)`; } else this.ghostCar.tag.style.display = 'none';
      }
    }
    // start / finish gates of the course
    const E = g.effects;
    for (const [gate, col] of [[this.course.start, [0.3, 1, 0.4]], [this.course.end, [1, 0.3, 0.6]]]) {
      for (const s of [-1, 1]) {
        const w = this.course.width / 2 + 1, x = gate.x - gate.tz * w * s, z = gate.z + gate.tx * w * s, y = g.world.heightAt(x, z);
        for (let k = 0; k < 5; k++) E.billboardInto(E.add, x, y + 0.6 + k * 1.1, z, 0.5, [col[0] * 0.3, col[1] * 0.3, col[2] * 0.3, 1]);
      }
    }
  }
  hud() {
    const role = this.role, L = this.live;
    let extra = '';
    if (L && role === 'chase') {
      const c = this.g.car;
      let lx = null, lz = null;
      if (!this.mp) { const gs = this.ghostAt(Math.max(0, this.t)); if (gs) { lx = gs.x; lz = gs.z; } }
      else { const r = [...this.g.remotes.values()].find((x) => x.id === this.leadId); if (r) { lx = r.x; lz = r.z; } }
      if (lx !== null) {
        const d = Math.hypot(c.x - lx, c.z - lz), q = d < 2.4 ? 'TOO CLOSE' : d <= 8 ? 'PERFECT' : d < 15 ? 'GOOD' : 'TOO FAR';
        extra = `<div class="prox"><span>Gap <b>${d.toFixed(1)} m</b></span><span class="q q-${q.split(' ').join('')}">${q}</span></div><div class="cpbar prox-bar"><i style="width:${Math.max(0, 100 - d * 4)}%"></i></div>`;
      }
    }
    const t = this.phase === 'running' ? this.t : 0;
    this.hudBox(`<div class="ctag">Drift Battle · Round ${this.round}/2</div><div class="role role-${role}">${role === 'watch' ? 'SPECTATING' : role.toUpperCase()}</div>
      <div class="cstats"><span>Run <b>${fmtTime(t).slice(0, -3)}</b></span><span>${esc(this.course.name)}</span></div>${extra}`);
  }
  destroy() { super.destroy(); if (this.ghostCar) this.ghostCar.tag.remove(); }
}

function partsHtml(side) {
  const labels = { angle: 'Angle', speed: 'Speed', line: 'Line', consistency: 'Consistency', transitions: 'Transitions', proximity: 'Proximity', speedMatch: 'Speed match', angleMatch: 'Angle match', control: 'Control' };
  return `<table class="res-table small">${Object.entries(side.parts).map(([k, v]) => `<tr><td>${labels[k] || k}</td><td>${v}</td></tr>`).join('')}${side.penaltyTotal ? `<tr class="bad"><td>Penalties</td><td>−${side.penaltyTotal}</td></tr>` : ''}</table>${penList(side)}`;
}
function penList(side) {
  const p = side.penalties || (side.lead ? [...side.lead.penalties, ...side.chase.penalties] : []);
  if (!p || !p.length) return '';
  const names = { offcourse: 'left the course', spin: 'spun / lost control', contact: 'contact', collision: 'collision' };
  const counts = {}; p.forEach((x) => { counts[x.kind] = (counts[x.kind] || 0) + 1; });
  return `<div class="pen-list">${Object.entries(counts).map(([k, n]) => `${n}× ${names[k] || k}`).join(' · ')}</div>`;
}
