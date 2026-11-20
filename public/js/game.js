// A driving session: world, local car, remote cars, effects, scoring, modes, HUD.
import { World, MAP_LIST } from './maps.js';
import { Vehicle, PHYS_DT } from './physics.js';
import { buildCarModel, carDrawItems, carById } from './cars.js';
import { Minimap } from './minimap.js';
import { applyTune, RULES, isStock } from './tuning.js';
import { Effects } from './effects.js';
import { CarCamera, VIEWS } from './camera.js';
import { DriftScorer, modeById, CHAIN_GRACE } from './scoring.js';
import { lerp, wrapAngle, clamp } from './engine/math.js';
import { $, fmt, toast, esc } from './ui.js';
import { createComp } from './compmodes.js';
import { round2 } from './judge.js';

const MUSIC = { track: 'bright', desert: 'warm', mountain: 'dusk', forest: 'calm', city: 'night', drift: 'bright' };

export class Game {
  constructor(app, opts) {
    this.app = app; this.opts = opts;
    this.mode = modeById(opts.modeId);
    this.mapInfo = MAP_LIST.find((m) => m.id === opts.mapId);
    this.mp = !!opts.mp; this.net = app.net;
    this.paused = false; this.hudHidden = false; this.time = 0;
    this.remotes = new Map(); this.unsub = [];
    this.accum = 0; this.sendT = 0; this.scoreT = 0; this.hudT = 0;
    this.challenge = null; this.challengeCD = 0; this.zoneHintT = 0;
    this.round = null; this.roundHistory = [];
    this.board = [];
    this.comp = null; this.spectator = !!opts.spectator; this.sampleAcc = 0; this.sampleK = 0; this.impactFlag = false; this.teleportFlag = false;
  }

  load() {
    const app = this.app, R = app.renderer, S = app.settings;
    this.world = new World(R, this.opts.mapId, S.quality);
    this.env = this.world.env;
    this.model = buildCarModel(R, S.car);
    // the car you drive = your car with your performance parts and tuning, under this room's rules
    // (single player: always your own setup). The same rule set is enforced by the server.
    this.rules = this.mp ? (this.opts.rules || 'open') : 'open';
    this.def = applyTune(carById(S.car.id), S.car.tune, this.rules);
    this.car = new Vehicle(this.def, this.world, this.model.meshes.dims, { style: S.driveStyle, maxAngle: S.driftAngle });
    this.spawnIndex = this.opts.spawn || 0;
    this.respawn();
    this.effects = new Effects(R, this.world, S.quality);
    this.cam = new CarCamera(); this.cam.view = S.camView || 0;
    this.scorer = new DriftScorer((t, d) => this.onScore(t, d));
    this.scorer.enabled = this.mode.score;
    app.audio.startEngine(this.def.engine);
    app.audio.playMusic(this.mode.id === 'chill' ? 'chill' : this.mode.id === 'competitive' ? 'compete' : MUSIC[this.opts.mapId]);
    this.setupHud();
    if (this.mp) this.bindNet();
    if (this.mode.comp) { this.comp = createComp(this); this.comp.load(); }
    if (this.opts.resume && !this.spectator) { const r = this.opts.resume; this.car.place(r.x, r.z, r.h); this.cam.snap(); this.teleportFlag = true; }
    if (this.spectator) this.startSpectating();
    this.minimap = new Minimap(this);
    if (this.mode.rounds && !this.mp) {
      this.localRounds = { n: 0, total: this.opts.rounds || 3, dur: this.opts.roundTime || 90 };
      setTimeout(() => this.startRound(1, this.localRounds.total, 3, this.localRounds.dur), 1200);
    }
    if (this.mode.challenges) setTimeout(() => toast(`Drive into a glowing ring to start a timed drift challenge`, 4000), 1500);
    if (this.rules !== 'open' && !this.spectator) setTimeout(() => toast(`Room rules: <b>${RULES[this.rules].name}</b>. ${!isStock(S.car.tune) ? 'Your performance mods are not used in this room; ' : ''}${RULES[this.rules].desc}`, 5500), 900);
    if (this.mode.id === 'chill') setTimeout(() => toast('Chill mode — no score, no pressure. H hides the HUD, M toggles music.', 4500), 1200);
  }

  respawn() {
    const sp = this.world.spawns[this.spawnIndex % this.world.spawns.length];
    this.car.place(sp.x, sp.z, sp.h);
    if (this.cam) this.cam.snap();
  }

  resetCar() {
    const p = this.world.nearestReset(this.car.x, this.car.z);
    if (!p) return this.respawn();
    // face along the road in the direction closest to where we were heading
    let h = p[3];
    if (Math.abs(wrapAngle(h - this.car.h)) > Math.PI / 2) h += Math.PI;
    this.car.place(p[0], p[1], h);
    this.cam.snap();
    this.teleportFlag = true;
    if (this.mode.crashPenalty && !(this.comp && this.comp.ownsScoring)) this.scorer.crash();
    if (this.mp) this.sendState(true);
  }

  // ------------------------------------------------------------- networking
  bindNet() {
    const N = this.net;
    const on = (t, fn) => this.unsub.push(N.on(t, fn));
    on('snap', (m) => {
      for (const p of m.ps) {
        if (p[0] === N.id) continue;
        const t = N.localTime(m.ts - (p[12] || 0)); // p[12] = how old this state was when the server sent it
        let r = this.remotes.get(p[0]);
        if (!r) r = this.addRemote(p[0]);
        r.buf.push({ t, x: p[1], y: p[2], z: p[3], h: p[4], vx: p[5], vz: p[6], s: p[7], f: p[8], sl: p[9], pi: p[10] || 0, ro: p[11] || 0 });
        if (r.buf.length > 30) r.buf.shift();
      }
    });
    on('room', (m) => this.syncRoom(m.room));
    on('playerLeft', (m) => this.removeRemote(m.id));
    on('lb', (m) => { this.board = m.lb; });
    on('round', (m) => this.startRound(m.round, m.rounds, m.countdown, m.duration));
    on('roundEnd', (m) => this.showRoundResults(m));
    on('matchEnd', (m) => this.showFinal(m.standings, m.winnerId));
    on('chat', (m) => this.app.ui.chatLine(m));
    this.syncRoom(N.room);
    // a round may have started while the map was still loading
    const lr = N.lastRound;
    if (lr) {
      const el = (performance.now() - lr.at) / 1000;
      let cd = lr.countdown - el, dur = lr.duration;
      if (cd < 0) { dur += cd; cd = 0; }
      if (dur > 0) this.startRound(lr.round, lr.rounds, cd, dur);
    }
  }
  addRemote(id) {
    const r = { id, name: 'Driver', cfg: null, model: null, buf: [], x: 0, y: 0, z: 0, h: 0, vx: 0, vz: 0, spin: 0, steer: 0, flags: 0, slip: 0, radius: 0.95, offset: 1.15, pitch: 0, roll: 0, seen: false };
    const tag = document.createElement('div'); tag.className = 'nametag'; $('#tags').appendChild(tag); r.tag = tag;
    this.remotes.set(id, r);
    const info = this.net.room && this.net.room.players.find((p) => p.id === id);
    if (info) this.applyRemoteInfo(r, info);
    return r;
  }
  applyRemoteInfo(r, info) {
    r.name = info.name; r.away = !!info.away; r.tag.textContent = info.away ? `${info.name} (reconnecting…)` : info.name; r.tag.classList.toggle('away', r.away);
    const key = JSON.stringify(info.car);
    if (key !== r.cfgKey) {
      r.cfgKey = key; r.cfg = info.car;
      r.model = buildCarModel(this.app.renderer, info.car);
      const d = r.model.meshes.dims; r.radius = d.W * 0.5; r.offset = d.L * 0.27; r.dims = d;
      r.mass = applyTune(carById(info.car.id), info.car.tune, this.rules).mass; // for collisions (heavier car pushes harder)
    }
  }
  syncRoom(room) {
    if (!room) return;
    const ids = new Set(room.players.map((p) => p.id));
    for (const id of [...this.remotes.keys()]) if (!ids.has(id)) this.removeRemote(id);
    for (const p of room.players) { if (p.id === this.net.id) continue; const r = this.remotes.get(p.id) || this.addRemote(p.id); this.applyRemoteInfo(r, p); }
    this.roomPlayers = room.players;
  }
  removeRemote(id) {
    const r = this.remotes.get(id); if (!r) return;
    r.tag.remove(); this.remotes.delete(id);
    for (const w of [0, 1, 2, 3]) this.effects.breakSkid(id + ':' + w);
  }
  sendState(force) {
    const c = this.car;
    const f = (c.drifting ? 1 : 0) | (c.brakeOn ? 2 : 0) | (c.reversing ? 4 : 0) | (c.boosting ? 8 : 0) | (c.handbrake ? 16 : 0) | (c.mode === 'spin' ? 32 : 0) | (c.mode === 'reverse' ? 64 : 0);
    this.net.send({ t: 'st', p: [c.x, c.y, c.z], h: c.h, vx: c.vx, vz: c.vz, s: c.wheelAngle, f, sl: c.rel, pi: c.pitch, ro: c.roll });
  }
  sendScore(final) { this.net.send({ t: 'sc', total: this.scorer.total, best: this.scorer.best, chain: final ? 0 : this.scorer.liveScore }); }

  interpRemotes(dt) {
    const now = performance.now(), rt = now - (this.net.interpDelay || 120);
    for (const r of this.remotes.values()) {
      const b = r.buf; if (!b.length) continue;
      let a = null, c = null;
      for (let i = b.length - 1; i >= 0; i--) if (b[i].t <= rt) { a = b[i]; c = b[i + 1] || null; break; }
      let s;
      if (!a) s = b[0];
      else if (c) {
        const t = clamp((rt - a.t) / Math.max(1, c.t - a.t), 0, 1);
        s = { x: lerp(a.x, c.x, t), y: lerp(a.y, c.y, t), z: lerp(a.z, c.z, t), h: a.h + wrapAngle(c.h - a.h) * t, vx: lerp(a.vx, c.vx, t), vz: lerp(a.vz, c.vz, t), s: lerp(a.s, c.s, t), f: c.f, sl: Math.abs(c.sl - a.sl) > Math.PI ? c.sl : lerp(a.sl, c.sl, t), pi: lerp(a.pi, c.pi, t), ro: lerp(a.ro, c.ro, t) };
      } else {
        const ex = Math.min(0.5, (rt - a.t) / 1000);
        s = { ...a, x: a.x + a.vx * ex, z: a.z + a.vz * ex };
      }
      const fwd = s.vx * Math.sin(s.h) + s.vz * Math.cos(s.h);
      r.x = s.x; r.y = s.y; r.z = s.z; r.h = s.h; r.vx = s.vx; r.vz = s.vz; r.steer = s.s; r.flags = s.f; r.slip = s.sl; r.pitch = s.pi; r.roll = s.ro;
      r.speed = Math.hypot(s.vx, s.vz);
      if (r.dims) r.spin += (fwd / r.dims.wheelR) * dt;
      r.seen = now - b[b.length - 1].t < 1000 + (this.net.interpDelay || 120); // no updates for ~1 s: hide (no frozen ghosts on the road)
    }
  }

  makeSample() {
    const c = this.car; this.sampleK++;
    const f = (c.drifting ? 1 : 0) | (c.brakeOn ? 2 : 0) | (c.reversing ? 4 : 0) | (c.boosting ? 8 : 0) | (c.handbrake ? 16 : 0) | (c.mode === 'spin' ? 32 : 0) | (c.mode === 'reverse' ? 64 : 0) | (this.impactFlag ? 128 : 0) | (this.teleportFlag ? 256 : 0);
    this.impactFlag = false; this.teleportFlag = false;
    return { k: this.sampleK, x: round2(c.x), y: round2(c.y), z: round2(c.z), h: round2(wrapAngle(c.h)), vx: round2(c.vx), vz: round2(c.vz), f, sl: round2(c.rel), s: round2(c.wheelAngle), pi: round2(c.pitch), ro: round2(c.roll) };
  }
  startSpectating() {
    this.car.place(this.car.x, this.car.z, this.car.h); this.car.y = -500; // parked out of sight, never sent
    this.specIdx = 0;
    $('#spec-banner').classList.remove('hidden');
    toast('A competition is in progress — you are spectating. You\'ll be in the next one (rematch).', 5000);
  }
  // camera proxy following a remote competitor
  specTarget() {
    const list = [...this.remotes.values()].filter((r) => r.seen && r.model);
    if (!list.length) return null;
    const r = list[this.specIdx % list.length];
    return { x: r.x, y: r.y, z: r.z, h: r.h, vx: r.vx, vz: r.vz, speed: r.speed || 0, forwardSpeed: (r.vx * Math.sin(r.h) + r.vz * Math.cos(r.h)), mode: r.flags & 1 ? 'drift' : 'grip', boosting: false, dims: r.dims, name: r.name };
  }

  // drifting alongside another drifting player, both going the same way
  tandemCheck() {
    const c = this.car;
    if (!this.mp || c.mode === 'grip' || c.speed < 8) return false;
    const ux = c.vx / c.speed, uz = c.vz / c.speed;
    for (const r of this.remotes.values()) {
      if (!r.seen || !(r.flags & 1) || !r.speed || r.speed < 8) continue;
      if (Math.hypot(r.x - c.x, r.z - c.z) > 15) continue;
      if ((r.vx / r.speed) * ux + (r.vz / r.speed) * uz > 0.7) return true;
    }
    return false;
  }

  // ------------------------------------------------------------- rounds (competitive)
  startRound(n, total, countdown, duration) {
    this.round = { n, total, phase: countdown > 0 ? 'countdown' : 'running', t: countdown > 0 ? countdown : duration, duration };
    this.scorer.reset(); this.scorer.enabled = true;
    this.challenge = null;
    $('#results').classList.add('hidden');
    if (countdown > 0) { this.respawn(); this.app.input.enabled = false; }
    this.lastCount = null;
  }
  updateRound(dt) {
    const R = this.round; if (!R) return;
    R.t -= dt;
    if (R.phase === 'countdown') {
      const c = Math.ceil(R.t);
      if (c !== this.lastCount && c > 0) { this.lastCount = c; this.bigText(String(c), 800); this.app.audio.blip(660, 0.12, 'square', 0.1); }
      if (R.t <= 0) { R.phase = 'running'; R.t = R.duration; this.app.input.enabled = !this.paused; this.bigText('GO!', 900); this.app.audio.blip(990, 0.25, 'square', 0.12); }
    } else if (R.phase === 'running') {
      if (R.t <= 0) {
        R.phase = 'over'; R.t = 0;
        this.scorer.bank(); this.scorer.enabled = false;
        this.bigText('TIME!', 1400); this.app.audio.chime(true);
        if (this.mp) this.sendScore(true);
        else {
          const score = this.scorer.total;
          this.roundHistory.push(score);
          const best = Math.max(...this.roundHistory);
          const results = this.roundHistory.map((s, i) => ({ id: 'r' + i, name: `Round ${i + 1}`, score: s }));
          setTimeout(() => this.showRoundResults({ round: R.n, rounds: R.total, results, winnerId: 'r' + this.roundHistory.indexOf(best), last: R.n >= R.total, solo: true }), 1500);
          if (R.n < R.total) setTimeout(() => this.startRound(R.n + 1, R.total, 3, R.duration), 7500);
          else setTimeout(() => this.showFinal(this.roundHistory.map((s, i) => ({ id: 'r' + i, name: `Round ${i + 1}`, wins: 0, total: s })).sort((a, b) => b.total - a.total), null, true), 7500);
        }
      }
    }
  }
  showRoundResults(m) {
    if (this.round) this.round.phase = 'results';
    const el = $('#results'); el.classList.remove('hidden');
    const me = this.net && this.net.id;
    const win = m.results.find((r) => r.id === m.winnerId);
    el.innerHTML = `<div class="res-card"><div class="res-kicker">${m.solo ? 'Score attack' : 'Round results'} · ${m.round}/${m.rounds}</div>
      <h2>${m.solo ? `Round ${m.round}: ${fmt(m.results[m.round - 1].score)}` : win ? `${esc(win.name)} wins the round!` : 'No winner this round'}</h2>
      <ol class="res-list">${m.results.map((r, i) => `<li class="${r.id === me ? 'me' : ''} ${r.id === m.winnerId ? 'win' : ''}"><span>${i + 1}</span><b>${esc(r.name)}</b><em>${fmt(r.score)}</em></li>`).join('')}</ol>
      <p class="muted">${m.last ? 'Final standings coming up…' : 'Next round starting soon…'}</p></div>`;
    if (win && win.id === me) this.app.audio.chime(true);
  }
  showFinal(standings, winnerId, solo) {
    const el = $('#results'); el.classList.remove('hidden');
    const me = this.net && this.net.id;
    const w = standings.find((s) => s.id === winnerId);
    el.innerHTML = `<div class="res-card final"><div class="res-kicker">Match over</div>
      <h2>${solo ? `Best round: ${fmt(standings[0].total)}` : w ? `🏆 ${esc(w.name)} wins the match!` : 'Match complete'}</h2>
      <ol class="res-list">${standings.map((s, i) => `<li class="${s.id === me ? 'me' : ''} ${i === 0 ? 'win' : ''}"><span>${i + 1}</span><b>${esc(s.name)}</b><em>${solo ? fmt(s.total) : `${s.wins} round win${s.wins === 1 ? '' : 's'} · ${fmt(s.total)}`}</em></li>`).join('')}</ol>
      ${solo ? '<div class="row"><button class="btn primary" data-act="again">Play again</button><button class="btn" data-act="menu">Main menu</button></div>' : '<p class="muted">Returning to the room lobby…</p>'}</div>`;
    if (solo) {
      const total = Math.max(...standings.map((s) => s.total));
      this.app.saveBest(this.opts.mapId, 'competitive', total);
      el.querySelector('[data-act=again]').onclick = () => { this.roundHistory = []; el.classList.add('hidden'); this.startRound(1, this.localRounds.total, 3, this.localRounds.dur); };
      el.querySelector('[data-act=menu]').onclick = () => this.app.quitToMenu();
    }
  }

  // ------------------------------------------------------------- challenges (standard)
  updateChallenges(dt) {
    const c = this.car;
    this.challengeCD = Math.max(0, this.challengeCD - dt);
    const live = this.scorer.total + this.scorer.liveScore;
    if (this.challenge) {
      const ch = this.challenge; ch.t -= dt;
      const got = live - ch.start;
      if (got >= ch.c.target) {
        this.scorer.bank();
        const bonus = 5000; this.scorer.total += bonus;
        toast(`<b>${esc(ch.c.name)}</b> complete! +${fmt(bonus)} bonus`, 3500, 'good'); this.app.audio.chime(true);
        this.challenge = null; this.challengeCD = 6; this.mustLeave = ch.c;
      } else if (ch.t <= 0) {
        toast(`<b>${esc(ch.c.name)}</b> failed — ${fmt(got)} / ${fmt(ch.c.target)}`, 3500, 'bad'); this.app.audio.chime(false);
        this.challenge = null; this.challengeCD = 4; this.mustLeave = ch.c;
      }
      return;
    }
    for (const z of this.world.challenges) {
      const d = Math.hypot(c.x - z.x, c.z - z.z);
      if (this.mustLeave === z) { if (d > z.r + 10) this.mustLeave = null; continue; }
      if (d < z.r && this.challengeCD <= 0 && c.speed > 4) {
        this.challenge = { c: z, t: z.time, start: live };
        toast(`Challenge: <b>${esc(z.name)}</b> — score ${fmt(z.target)} in ${z.time}s`, 3000);
        this.app.audio.blip(880, 0.15, 'square', 0.1);
        break;
      }
    }
  }

  // ------------------------------------------------------------- scoring events
  onScore(type, d) {
    const pop = (html, cls) => {
      const el = document.createElement('div'); el.className = 'pop ' + (cls || ''); el.innerHTML = html;
      $('#pops').appendChild(el); setTimeout(() => el.remove(), 1800);
    };
    if (type === 'banked') { pop(`+${fmt(d.value)}<small>${d.label}${d.best ? ' · NEW BEST' : ''}</small>`, d.value > 15000 ? 'big' : ''); if (d.value > 6000) this.app.audio.blip(1200, 0.1, 'sine', 0.08); }
    if (type === 'crash') { pop(`CRASHED<small>−${fmt(d.lost)} chain lost</small>`, 'bad'); }
    if (type === 'offtrack') pop(`OFF TRACK<small>−${fmt(d.lost)} chain lost</small>`, 'bad');
    if (type === 'reset') pop(`RESET<small>−${fmt(d.lost)} chain lost</small>`, 'bad');
    if (type === 'penalty') pop(`PENALTY −${fmt(d.points)}<small>${d.kind === 'offtrack' ? 'left the track' : 'collision'}</small>`, 'bad');
    if (type === 'spinout') { pop(`SPUN OUT<small>−${fmt(d.lost)} chain lost</small>`, 'bad'); }
    if (type === 'trick') { pop(`${d.name}<small>+${fmt(d.points)} · combo ×${d.combo}</small>`, 'trick'); this.app.audio.blip(980, 0.12, 'triangle', 0.09); }
    if (type === 'transition') pop(`TRANSITION<small>+${fmt(d.points)} · combo ×${d.combo}</small>`, 'small');
    if (type === 'combo') pop(`CHAIN ×${d.combo}`, 'small');
    if (type === 'label') pop(d.text, 'small');
  }
  bigText(t, ms) { const el = $('#bigtext'); el.textContent = t; el.classList.remove('show'); void el.offsetWidth; el.classList.add('show'); clearTimeout(this._bt); this._bt = setTimeout(() => el.classList.remove('show'), ms); }

  // ------------------------------------------------------------- main frame
  frame(dt) {
    const app = this.app, input = app.input, S = app.settings;
    this.time += dt;
    input.pollPad(); // controller buttons work even while paused / chatting
    for (const a of input.pressed()) this.action(a);
    const simPaused = this.paused && !this.mp;
    if (!simPaused) {
      this.accum += Math.min(dt, 0.1);
      let steps = 0, maxImpact = 0;
      const inp = this.paused || this.chatOpen ? { throttle: 0, brake: 0, steer: 0, handbrake: false, boost: false } : input.read();
      if (this.round && this.round.phase === 'countdown') { inp.throttle = 0; inp.boost = false; inp.brake = 0; inp.handbrake = true; }
      if (this.comp) this.comp.filterInput(inp);
      while (this.accum >= PHYS_DT && steps < 12) {
        if (!this.spectator) {
          this.car.step(PHYS_DT, inp);
          maxImpact = Math.max(maxImpact, this.car.impact);
          for (const r of this.remotes.values()) if (r.seen && !r.away) { this.car.collideCar(r); maxImpact = Math.max(maxImpact, this.car.impact); }
        }
        if (this.comp) this.comp.stepExtras(PHYS_DT);
        this.accum -= PHYS_DT; steps++;
      }
      // how far we are between the last physics step and the next one (for smooth drawing)
      this.alpha = clamp(this.accum / PHYS_DT, 0, 1);
      if (maxImpact > 2.5) {
        app.audio.impact(maxImpact);
        if (maxImpact > 6.5) {
          this.cam.shake = Math.min(1, maxImpact / 14); this.impactFlag = true;
          if (this.mode.crashPenalty && !(this.comp && this.comp.ownsScoring)) this.scorer.crash();
        }
      }
      if (!(this.comp && this.comp.ownsScoring)) this.scorer.update(dt, this.car, { tandem: this.tandemCheck() });
      // competitive modes: official 20 Hz samples (identical to what the server receives)
      if (this.comp && !this.spectator) {
        this.sampleAcc += Math.min(dt, 0.1);
        while (this.sampleAcc >= 0.05) { this.sampleAcc -= 0.05; const sm = this.makeSample(); this.comp.onSample(sm, { tandem: this.tandemCheck() }); if (this.mp) this.net.send({ t: 'st', ...sm, p: [sm.x, sm.y, sm.z] }); }
      }
      if (this.mode.challenges) this.updateChallenges(dt);
      this.updateRound(dt);
    }
    if (this.comp) this.comp.update(dt, !simPaused);
    if (this.mp) {
      this.interpRemotes(dt);
      this.sendT -= dt; if (this.sendT <= 0) { this.sendT = Math.max(0, this.sendT + 0.05); if (!this.comp && !this.spectator) this.sendState(); } // keep the leftover: steady 20 Hz
      this.scoreT -= dt; if (this.scoreT <= 0) { this.scoreT = 0.25; if (!this.comp && (!this.round || this.round.phase === 'running')) this.sendScore(); }
    }
    const c = this.car;
    app.audio.updateEngine({ gear: c.gear, rpm: c.rpm, throttle: c.throttle, speed: c.speed, slip: c.slip, drifting: c.drifting, rumble: c.surface ? c.surface.rumble : 0, paved: c.surface && !c.surface.dust, boosting: c.boosting, paused: simPaused });
    this.render(simPaused ? 0 : dt);
    this.hudT -= dt; if (this.hudT <= 0) { this.hudT = 1 / 20; this.updateHud(); }
  }

  action(a) {
    const app = this.app;
    if (a === 'pause') { if (this.chatOpen) return this.closeChat(); return this.togglePause(); }
    if (this.paused) return;
    if (a === 'style') this.setStyle(this.car.styleId === 'drift' ? 'race' : 'drift');
    if (a === 'camera' && this.spectator) { this.specIdx = (this.specIdx || 0) + 1; const t = this.specTarget(); if (t) toast(`Watching ${esc(t.name)}`, 1000); return; }
    if (a === 'camera') { this.cam.view = (this.cam.view + 1) % VIEWS.length; this.cam.snap(); toast(`Camera: ${VIEWS[this.cam.view].name}`, 1000); app.settings.camView = this.cam.view; }
    if (a === 'reset' && !this.spectator) this.resetCar();
    if (a === 'hud') { this.hudHidden = !this.hudHidden; $('#hud').classList.toggle('hidden-hud', this.hudHidden); }
    if (a === 'music') toast(app.audio.toggleMusic() ? 'Music on' : 'Music off', 1000);
    if (a === 'minimap' && this.minimap) { const mm = app.settings.minimap; mm.on = !mm.on; app.saveSettings(); this.minimap.applySettings(); toast(mm.on ? 'Minimap on' : 'Minimap off', 900); }
    if (a === 'chat' && this.mp) this.openChat();
  }
  setStyle(style) {
    const S = this.app.settings;
    S.driveStyle = style; this.app.saveSettings();
    this.car.setStyle(style, S.driftAngle);
    toast(`Driving style: <b>${style === 'race' ? 'Race' : 'Drift'}</b>`, 1400);
    this.setupHudMode();
  }
  setupHudMode() { $('#hud-mode').textContent = `${this.mode.name} · ${this.mapInfo.name} · ${this.car.styleId === 'race' ? 'Race' : 'Drift'} style`; }
  togglePause(force) {
    this.paused = force !== undefined ? force : !this.paused;
    this.app.input.enabled = !this.paused && !(this.round && this.round.phase === 'countdown');
    this.app.ui.showPause(this.paused, this);
  }
  openChat() {
    this.chatOpen = true; const inp = $('#chat-input'); inp.classList.remove('hidden'); inp.value = ''; inp.focus();
    inp.onkeydown = (e) => {
      if (e.key === 'Enter') { const t = inp.value.trim(); if (t) this.net.send({ t: 'chat', text: t }); this.closeChat(); }
      if (e.key === 'Escape') this.closeChat();
      e.stopPropagation();
    };
  }
  closeChat() { this.chatOpen = false; const inp = $('#chat-input'); inp.blur(); inp.classList.add('hidden'); }

  // ------------------------------------------------------------- rendering
  carFx(st, model, dims, key, dt, isLocal) {
    const E = this.effects, env = this.env;
    const sh = Math.sin(st.h), ch = Math.cos(st.h);
    E.carShadow(st.x, this.world.heightAt(st.x, st.z), st.z, st.h, dims.L, dims.W);
    if (model.glow) { const k = env.night ? 1 : 0.45; E.underglow(st.x, st.y, st.z, st.h, dims.L, dims.W, model.glow.map((v) => v * k)); }
    if (env.headlights || env.night) {
      for (const sx of [-0.55, 0.55]) {
        const lx = st.x + sh * dims.frontZ - ch * sx * dims.W * 0.5, lz = st.z + ch * dims.frontZ + sh * sx * dims.W * 0.5;
        E.beam(lx, st.y + dims.headY, lz, st.h, env.night ? 30 : 24, 6, env.night ? 0.09 : 0.05);
      }
    }
    const speed = st.speed, rel = st.rel || 0;
    const surf = this.world.surfaceAt(st.x, st.z);
    // how hard the tyres are sliding: sideways component of travel, spins/reverse slides, wheelspin
    let slideAmt = Math.abs(Math.sin(rel)) * Math.min(1, speed / 10);
    if (st.mode === 'spin' || st.mode === 'reverse') slideAmt = Math.max(slideAmt, Math.min(1, speed / 8));
    if (st.mode === 'reverse') slideAmt = Math.max(slideAmt * 0.6, Math.abs(Math.sin(rel)) * Math.min(1, speed / 10));
    const burn = st.burnout ? 0.8 : 0;
    const hbLock = st.handbrake && speed > 4 ? 0.5 : 0;
    const intensity = Math.min(1, Math.max(slideAmt * (st.drifting ? 1.3 : 0.9), burn, hbLock));
    const wheels = model.meshes.wheels;
    if (!dt) return;
    for (let w = 0; w < 4; w++) {
      const [wx, , wz, front] = wheels[w];
      // local +x is the car's left side; rotate wheel offset into world space
      const X = st.x + ch * wx + sh * wz, Z = st.z - sh * wx + ch * wz;
      const marks = (front ? intensity > 0.45 : intensity > 0.12) || (st.braking && speed > 12 && !front);
      if (marks && surf.skid && speed > 1.5) {
        const k = Math.min(1, 0.35 + intensity * 0.8);
        E.skidAt(key + ':' + w, X, Z, [surf.skid[0], surf.skid[1], surf.skid[2], surf.skid[3] * k]);
      } else E.breakSkid(key + ':' + w);
      if (front && intensity < 0.7) continue;
      const y = this.world.heightAt(X, Z) + 0.3;
      if (intensity > 0.1 && (speed > 2 || burn)) {
        // throttle spins the rear tyres: more and thicker smoke when the driver is on the power
        const thr = st.throttle ?? (st.drifting ? 0.7 : 0.3), power = front ? 0.4 : 0.6 + 0.6 * thr;
        const rate = (surf.dust ? 14 : 24) * intensity * power;
        if (Math.random() < rate * dt) {
          const a = (surf.dust ? 0.28 : 0.2) * Math.min(1, intensity + 0.4);
          const c = surf.dust ? [...surf.dust, a] : [...(surf.smoke || [0.9, 0.9, 0.92]), a];
          const big = 0.5 + 0.35 * intensity * power;
          E.emit(X, y, Z, st.vx * 0.25 + (Math.random() - 0.5) * 2, 0.5 + Math.random() * 0.8, st.vz * 0.25 + (Math.random() - 0.5) * 2, c, big, 1.5 + Math.random() * (0.8 + intensity), 1.6 + 0.8 * intensity);
        }
      } else if (surf.dust && speed > 9 && Math.random() < dt * 14 * Math.min(1, speed / 30)) {
        E.emit(X, y, Z, -st.vx * 0.1, 0.4, -st.vz * 0.1, [...surf.dust, 0.25], 0.6, 1.2, 2);
      }
    }
    if (st.boosting) {
      const bx = st.x + sh * (dims.rearZ - 0.15), bz = st.z + ch * (dims.rearZ - 0.15);
      E.flame(bx, st.y + 0.35, bz, 0.35 + Math.random() * 0.15, [1, 0.55, 0.15, 1]);
      E.flame(bx, st.y + 0.35, bz, 0.2, [0.4, 0.6, 1, 1]);
    }
  }

  render(dt) {
    const app = this.app, R = app.renderer, S = app.settings, c = this.car;
    // draw the local car between its last two physics steps (no stutter on 75/144 Hz screens)
    const rs = c.renderState(this.alpha ?? 1);
    const camLocal = { x: rs.x, y: rs.y, z: rs.z, h: rs.h, vx: c.vx, vz: c.vz, speed: c.speed, forwardSpeed: c.forwardSpeed, mode: c.mode, boosting: c.boosting, dims: c.dims };
    const camCar = this.spectator ? (this.specTarget() || camLocal) : camLocal;
    this.cam.update(Math.max(dt, 1 / 240), camCar, this.world, S);
    R.setCamera(this.cam.eye, this.cam.target, (this.cam.fov * Math.PI) / 180, 0.5, this.env.fogFar + 120);
    const E = this.effects; E.begin();
    const items = this.world.statics.slice();
    const hideOwn = VIEWS[this.cam.view].hood;
    const local = { x: rs.x, y: rs.y, z: rs.z, h: rs.h, vx: c.vx, vz: c.vz, speed: c.speed, rel: c.rel, mode: c.mode, drifting: c.drifting, handbrake: c.handbrake, braking: c.brakeOn, boosting: c.boosting, burnout: c.mode !== 'grip' && c.throttle > 0.8 && c.speed < 9, throttle: c.throttle };
    if (!hideOwn && !this.spectator) carDrawItems(this.model, { x: rs.x, y: rs.y, z: rs.z, yaw: rs.h, pitch: rs.pitch, roll: rs.roll, bodyPitch: c.bodyPitch, bodyRoll: c.bodyRoll, wheelOffset: c.wheelOffset, steer: c.wheelAngle, spin: c.spin, brake: c.brakeOn || c.handbrake, reverse: c.reversing, lights: this.env.night }, items);
    if (!this.spectator) this.carFx(local, this.model, this.model.meshes.dims, 'me', dt, true);
    for (const r of this.remotes.values()) {
      if (!r.model || !r.seen) { r.tag.style.display = 'none'; continue; }
      const f = r.flags;
      carDrawItems(r.model, { x: r.x, y: r.y, z: r.z, yaw: r.h, pitch: r.pitch, roll: r.roll, steer: r.steer, spin: r.spin, brake: !!(f & 2) || !!(f & 16), reverse: !!(f & 4), lights: this.env.night }, items);
      this.carFx({ x: r.x, y: r.y, z: r.z, h: r.h, vx: r.vx, vz: r.vz, speed: r.speed, rel: r.slip, mode: f & 32 ? 'spin' : f & 64 ? 'reverse' : f & 1 ? 'drift' : 'grip', drifting: !!(f & 1), handbrake: !!(f & 16), braking: !!(f & 2), boosting: !!(f & 8), burnout: !!(f & 1) && r.speed < 9 }, r.model, r.dims, r.id, dt, false);
      const p = R.project(r.x, r.y + r.dims.roofY + 1.0, r.z);
      const dist = Math.hypot(r.x - this.cam.eye[0], r.z - this.cam.eye[2]);
      if (p && dist < 260) { r.tag.style.display = 'block'; r.tag.style.transform = `translate(${p[0]}px, ${p[1]}px) translate(-50%, -100%) scale(${clamp(30 / dist, 0.55, 1.1)})`; }
      else r.tag.style.display = 'none';
    }
    if (this.comp) this.comp.draw(items, dt);
    E.update(dt);
    const head = (this.env.headlights || this.env.night) && !this.spectator ? {
      on: true, intensity: this.env.night ? 1.0 : 0.5,
      pos: [rs.x + Math.sin(rs.h) * (this.model.meshes.dims.frontZ), rs.y + 0.9, rs.z + Math.cos(rs.h) * this.model.meshes.dims.frontZ],
      dir: normalize([Math.sin(rs.h), -0.12, Math.cos(rs.h)]),
    } : null;
    R.render(this.env, items, [...this.world.fx, ...E.buffers], head);
    if (this.minimap) this.minimap.draw(Math.max(dt, 1 / 240));
  }

  // ------------------------------------------------------------- HUD
  setupHud() {
    const S = this.app.settings;
    $('#hud').classList.remove('hidden', 'hidden-hud');
    this.setupHudMode();
    $('#hud-name').textContent = S.playerName;
    $('#hud-drift').classList.toggle('hidden', !this.mode.score);
    $('#hud-score').classList.toggle('hidden', !this.mode.score);
    $('#hud-board').classList.toggle('hidden', !(this.mode.board && (this.mp || this.mode.rounds)) || !!this.mode.comp);
    $('#spec-banner').classList.add('hidden');
    $('#hud-timer').classList.add('hidden');
    $('#hud-challenge').classList.add('hidden');
    $('#chat-log').classList.toggle('hidden', !this.mp);
    $('#hud-hint').innerHTML = this.mp ? 'T chat · C camera · R reset · Esc menu' : 'Space handbrake · Shift boost · C camera · R reset · Esc menu';
    $('#pops').innerHTML = '';
    $('#results').classList.add('hidden');
    $('#tags').innerHTML = '';
  }
  updateHud() {
    const c = this.car, S = this.app.settings, sc = this.scorer;
    const kmh = c.speed * 3.6, spd = S.units === 'mph' ? kmh * 0.621 : kmh;
    $('#spd-num').textContent = Math.round(spd);
    $('#spd-unit').textContent = S.units === 'mph' ? 'MPH' : 'KM/H';
    $('#spd-gear').textContent = c.gear === -1 ? 'R' : c.speed < 0.5 && c.throttle === 0 ? 'N' : c.gear;
    const frac = Math.min(1, c.rpm);
    $('#spd-arc').style.strokeDashoffset = String(251 - 251 * 0.75 * frac);
    $('#spd-arc').classList.toggle('redline', frac > 0.9);
    $('#boost-fill').style.width = `${Math.round(c.boost * 100)}%`;
    $('#boost').classList.toggle('active', c.boosting);
    if (this.mode.score) {
      const live = sc.liveScore;
      const d = $('#hud-drift');
      d.classList.toggle('live', sc.chain > 0);
      $('#drift-score').textContent = sc.chain > 0 ? fmt(Math.round(sc.chain)) : '';
      $('#drift-mult').textContent = sc.chain > 0 ? `×${sc.mult.toFixed(1)}` : '';
      $('#drift-angle').textContent = sc.chain > 0 && c.mode !== 'grip' ? `${c.mode === 'reverse' ? 'REVERSE ' : c.mode === 'spin' ? 'SPIN ' : ''}${Math.round(sc.angle)}°${sc.tandem ? ' · TANDEM ×1.5' : ''}` : '';
      $('#drift-grace').style.transform = `scaleX(${sc.chain > 0 ? (sc.active ? 1 : Math.max(0, sc.grace / CHAIN_GRACE)) : 0})`;
      $('#score-total').textContent = fmt(sc.total + (live && this.mode.rounds ? 0 : 0));
      $('#score-best').textContent = fmt(sc.best);
    }
    // timer
    const T = $('#hud-timer');
    if (this.round && (this.round.phase === 'running' || this.round.phase === 'countdown')) {
      T.classList.remove('hidden');
      const t = Math.max(0, this.round.phase === 'running' ? this.round.t : this.round.duration);
      T.innerHTML = `<small>ROUND ${this.round.n}/${this.round.total}</small>${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
      T.classList.toggle('urgent', this.round.phase === 'running' && t < 10);
    } else T.classList.add('hidden');
    // challenge
    const C = $('#hud-challenge');
    if (this.challenge) {
      const ch = this.challenge, got = sc.total + sc.liveScore - ch.start;
      C.classList.remove('hidden');
      C.innerHTML = `<div class="ch-top"><b>${esc(ch.c.name)}</b><span>${Math.ceil(ch.t)}s</span></div><div class="bar"><i style="width:${Math.min(100, (got / ch.c.target) * 100)}%"></i></div><div class="ch-sub">${fmt(got)} / ${fmt(ch.c.target)}</div>`;
    } else C.classList.add('hidden');
    // leaderboard
    if (this.mode.board && (this.mp || this.mode.rounds)) {
      let rows;
      if (this.mp) rows = [...this.board].sort((a, b) => b.score - a.score).map((p) => ({ name: p.name, score: p.score, me: p.id === this.net.id, wins: p.wins }));
      else rows = [{ name: S.playerName, score: Math.round(sc.total + sc.liveScore), me: true }, ...this.roundHistory.map((s, i) => ({ name: `Round ${i + 1}`, score: s }))];
      $('#hud-board').innerHTML = `<div class="lb-title">${this.mp ? 'Leaderboard' : 'Your rounds'}</div>` + rows.slice(0, 8).map((r, i) => `<div class="lb-row ${r.me ? 'me' : ''}"><span>${i + 1}</span><b>${esc(r.name)}${r.wins ? ` <i class="wins">${'★'.repeat(Math.min(5, r.wins))}</i>` : ''}</b><em>${fmt(r.score)}</em></div>`).join('');
    }
    if (this.comp) this.comp.hud();
    if (S.showFps) $('#fps').textContent = `${this.app.fps} fps · ${this.app.renderer.stats.draws} draws`;
  }

  destroy() {
    $('#minimap').classList.add('hidden'); delete $('#hud').dataset.mm;
    if (this.comp) { this.comp.destroy(); this.comp = null; }
    $('#spec-banner').classList.add('hidden');
    $('#results').classList.add('hidden'); $('#results').innerHTML = '';
    this.app.audio.stopEngine();
    this.unsub.forEach((u) => u());
    for (const r of this.remotes.values()) r.tag.remove();
    this.effects.dispose();
    const R = this.app.renderer;
    for (const s of this.world.statics) R.deleteMesh(s.mesh);
    for (const b of this.world.fx) if (b) b.dispose();
    $('#hud').classList.add('hidden');
    $('#tags').innerHTML = '';
    this.app.input.enabled = true;
  }
}
function normalize(v) { const l = Math.hypot(...v); return v.map((x) => x / l); }
