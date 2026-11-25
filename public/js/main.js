// App bootstrap: renderer, menus, main loop, multiplayer event routing.
import { Renderer } from './engine/renderer.js';
import { AudioEngine } from './audio.js';
import { Input } from './input.js';
import { Net } from './net.js';
import { UI, $, toast, esc } from './ui.js';
import { Showroom } from './showroom.js';
import { Game } from './game.js';
import { loadSettings, saveSettings } from './settings.js';
import { MAP_LIST } from './maps.js';
import { MODES } from './scoring.js';
import { TouchControls, goFullscreen } from './touch.js';
import { levelInfo, LEVEL_REWARDS, xpForRecord } from './level.js';
import { Account } from './account.js';
import { unlock } from './secret.js';
import { CARS } from './cars.js';

class App {
  constructor() {
    this.settings = loadSettings();
    const canvas = $('#gl');
    try {
      this.renderer = new Renderer(canvas, { antialias: this.settings.quality === 'high', preserve: /[?&]capture/.test(location.search) });
    } catch (e) {
      $('#fatal').classList.remove('hidden'); $('#fatal').innerHTML = `<h2>WebGL unavailable</h2><p>${esc(e.message)}</p><p>Try another browser, or enable hardware acceleration.</p>`;
      throw e;
    }
    this.audio = new AudioEngine();
    this.audio.setVolumes({ master: this.settings.master, sfx: this.settings.sfx, music: this.settings.music });
    this.input = new Input(this.settings);
    this.net = new Net(); this.net.level = () => this.level;
    this.account = new Account(this); this.net.acct = () => this.account.token;
    this.ui = new UI(this);
    this.touch = new TouchControls(this);
    this.showroom = new Showroom(this);
    this.game = null; this.fps = 60; this.frames = 0; this.fpsT = 0;
    this.bindNet();
    const unlock = () => { this.audio.init(); this.audio.playMusic(this.game ? this.audio.style : 'menu'); };
    window.addEventListener('pointerdown', unlock, { once: false });
    window.addEventListener('keydown', unlock, { once: false });
    // accounts: logged in -> pull the latest save; never chose -> show the login screen first
    if (this.account.loggedIn) { this.ui.show('main'); this.account.refresh().then(() => this.ui.renderAccount()); }
    else this.ui.show(this.account.guestChosen ? 'main' : 'login');
    // after a refresh / crash, quietly resume an unfinished multiplayer session (same room & game)
    if (this.net.token) this.net.connect(this.settings.playerName, this.settings.car, this.settings.serverUrl, { patience: 8000 }).catch(() => {});
    $('#fps').classList.toggle('hidden', !this.settings.showFps);
    this.renderLevel();
    this.last = performance.now();
    requestAnimationFrame((t) => this.loop(t));
    window.__app = this; // handy for debugging & automated tests
  }
  saveSettings(noSync) { saveSettings(this.settings); if (!noSync && this.account) this.account.queueSave(); }
  get level() { return levelInfo(this.settings.xp || 0).level; }
  // XP: drifting, distance, finished competitions. Level ups unlock secret cars at some levels.
  addXP(n, why) {
    n = Math.round(n); if (!(n > 0)) return;
    const S = this.settings, before = levelInfo(S.xp || 0).level;
    S.xp = (S.xp || 0) + n;
    const after = levelInfo(S.xp).level;
    if (after > before) {
      this.audio.chime(true);
      if (this.game) this.game.bigText(`LEVEL ${after}!`, 1800);
      toast(`<b>Level up! You are level ${after}</b>${why ? `<br><small>${esc(why)}</small>` : ''}`, 3500, 'good');
      for (let L = before + 1; L <= after; L++) {
        const r = LEVEL_REWARDS[L];
        if (r && unlock(r)) setTimeout(() => toast(`<b>Secret car unlocked: ${esc((CARS.find((c) => c.secret === r) || { name: r }).name)}</b><br><small>Garage › Secret tab</small>`, 5000, 'good'), 1200);
      }
      this.net.send({ t: 'level', level: after, up: true });
    }
    this._xpSave = (this._xpSave || 0) + n;
    if (this._xpSave > 200 || after > before) { this._xpSave = 0; this.saveSettings(); }
    this.renderLevel();
  }
  renderLevel() {
    const li = levelInfo(this.settings.xp || 0), pct = Math.round((li.into / li.need) * 100);
    for (const el of document.querySelectorAll('.lvl-badge')) el.innerHTML = `<b>LV ${li.level}</b><i><s style="width:${pct}%"></s></i><small>${li.into} / ${li.need} XP</small>`;
  }
  // personal records — only called once per COMPLETED competition
  saveRecord(type, d) {
    const R = this.settings.records = this.settings.records || {};
    if (type === 'challenge') {
      const c = ((R.challenge = R.challenge || {})[d.map] = R.challenge[d.map] || {});
      const score = d.variant === 'attack' ? d.bestChain : d.total;
      c[d.variant] = Math.max(c[d.variant] || 0, score || 0);
      c.longest = Math.max(c.longest || 0, d.longest || 0); c.combo = Math.max(c.combo || 0, d.maxMult || 0); c.angle = Math.max(c.angle || 0, d.bestAngle || 0);
    } else if (type === 'race') {
      const r = ((R.race = R.race || {})[d.map] = R.race[d.map] || { total: {} });
      if (d.time && (!r.total[d.laps] || d.time < r.total[d.laps])) r.total[d.laps] = d.time;
      if (d.beatBoss && d.bossId && unlock(d.bossId)) { const car = CARS.find((c) => c.secret === d.bossId); setTimeout(() => toast(`<b>You beat the boss!</b><br><small>Boss car unlocked: ${esc(car ? car.name : d.bossId)} (Garage › Boss tab)</small>`, 6000, 'good'), 800); }
      if (d.best && (!r.lap || d.best < r.lap)) r.lap = d.best;
      r.races = (r.races || 0) + 1; if (d.pos === 1 && d.field > 1) r.wins = (r.wins || 0) + 1;
    } else if (type === 'driftrace') {
      const r = ((R.driftrace = R.driftrace || {})[d.map] = R.driftrace[d.map] || { score: {} });
      if (d.finished && d.score > (r.score[d.laps] || 0)) r.score[d.laps] = d.score;
      r.drift = Math.max(r.drift || 0, d.drift || 0);
      r.races = (r.races || 0) + 1; if (d.pos === 1 && d.field > 1) r.wins = (r.wins || 0) + 1;
    } else if (type === 'battle') {
      const b = (R.battle = R.battle || {});
      if (d.solo) { b.solo = b.solo || {}; b.solo[d.map] = Math.max(b.solo[d.map] || 0, d.total); }
      else { if (d.draw) b.draws = (b.draws || 0) + 1; else if (d.won) b.wins = (b.wins || 0) + 1; else b.losses = (b.losses || 0) + 1; b.points = Math.round(((b.points || 0) + d.total) * 10) / 10; }
    }
    this.saveSettings();
    this.addXP(xpForRecord(type, d), type === 'race' ? 'Speed Race finished' : type === 'driftrace' ? 'Drift Race finished' : type === 'battle' ? 'Drift Battle finished' : 'Challenge finished');
  }
  saveBest(map, mode, score) {
    const k = `${map}:${mode}`;
    if (score > (this.settings.bests[k] || 0)) { this.settings.bests[k] = Math.round(score); this.saveSettings(); }
  }

  loop(t) {
    const dt = Math.min(0.1, (t - this.last) / 1000); this.last = t;
    this.frames++; this.fpsT += dt;
    if (this.fpsT >= 0.5) { this.fps = Math.round(this.frames / this.fpsT); this.frames = 0; this.fpsT = 0; if (!this.game && this.settings.showFps) $('#fps').textContent = `${this.fps} fps`; }
    this.renderer.resize(this.settings.renderScale || 1, this.settings.maxDpr || 2);
    this.touch.sync();
    try {
      if (this.game && this.game.ready) this.game.frame(dt);
      else if (!this.game) this.showroom.frame(dt, this.ui.current);
    } catch (e) { console.error(e); }
    requestAnimationFrame((tt) => this.loop(tt));
  }

  startGame(opts) {
    if (this.game) this.endGame();
    // phones: go fullscreen + landscape when a drive starts (works when started by a tap)
    if (this.touch.active && this.settings.touchFullscreen !== false) goFullscreen(true);
    this.lastOpts = opts;
    const info = MAP_LIST.find((m) => m.id === opts.mapId);
    this.ui.loading(true, `Loading ${info ? info.name : 'map'}…`);
    this.ui.show('none');
    $('#menu-bg').classList.add('hidden');
    setTimeout(() => {
      try {
        const g = new Game(this, opts);
        this.game = g;
        g.load();
        g.ready = true;
      } catch (e) {
        console.error(e);
        this.game = null;
        toast(`Failed to load map: ${esc(e.message)}`, 5000, 'bad');
        this.ui.show(opts.mp ? 'lobby' : 'main');
      }
      this.ui.loading(false);
    }, 40);
  }
  restartGame() { const o = this.lastOpts; this.endGame(); this.startGame(o); }
  endGame() {
    if (!this.game) return;
    if (this.game.mode.score && !this.game.mp && !this.game.mode.rounds) this.saveBest(this.game.opts.mapId, this.game.mode.id, this.game.scorer.total);
    this.game.destroy(); this.game = null;
    $('#pause').classList.add('hidden');
  }
  quitToMenu(screen = 'main') {
    this.endGame();
    this.audio.playMusic('menu');
    this.ui.show(screen);
  }

  bindNet() {
    const N = this.net;
    N.on('rooms', (m) => this.ui.renderRooms(m.rooms));
    N.on('joined', (m) => { if (!this.game && !(m.room && m.room.permanent)) this.ui.show('lobby'); }); // the public room drops you straight into the game
    N.on('room', () => { if (this.ui.current === 'lobby') this.ui.renderLobby(); });
    N.on('left', () => { this.settings.lastRoom = ''; this.saveSettings(); if (!this.game) this.ui.show('mp'); });
    N.on('error', (m) => {
      toast(esc(m.msg), 4000, 'bad');
      if (m.gone && this.settings.lastRoom === m.gone) { this.settings.lastRoom = ''; this.saveSettings(); if (this.ui.current === 'mp') this.ui.enterMP(); }
    });
    N.on('chat', (m) => { if (!this.game) this.ui.chatLine(m); });
    N.on('gameStart', (m) => {
      // never guess a mode: an unknown one used to silently fall back to Endless
      if (!MODES.find((x) => x.id === m.mode)) { toast(`This room uses a game mode your page doesn't know (${esc(m.mode)}). Refresh the page.`, 6000, 'bad'); return; }
      if (this.game && this.game.mp) this.endGame();
      this.startGame({ mp: true, mapId: m.map, modeId: m.mode, spawn: m.spawn, rounds: m.rounds, roundTime: m.roundTime, comp: m.comp, spectator: m.spectator, grid: m.grid, resume: m.resume, rules: m.rules || 'open', permanent: !!m.permanent });
    });
    N.on('gameEnd', () => {
      if (this.game && this.game.mp) { this.endGame(); this.audio.playMusic('menu'); this.ui.show('lobby'); toast('Back in the room lobby', 2000); }
    });
    N.inGame = () => !!(this.game && this.game.mp);
    const banner = (on, text) => { const b = $('#netbanner'); b.classList.toggle('hidden', !on); if (text) b.textContent = text; };
    N.on('reconnecting', () => banner(true, 'Connection lost — reconnecting…'));
    N.on('reconnected', () => {
      banner(false);
      if (!N.room) return; // fresh session (no room): 'roomLost' explains what happened if needed
      toast('Reconnected', 1500, 'good');
      if (this.ui.current === 'lobby') this.ui.renderLobby();
    });
    // our room is gone for us (server restarted, or we were away too long): say so clearly, never
    // leave a stale lobby on screen or drop the player into some other room
    N.on('roomLost', ({ code, reason }) => {
      banner(false);
      if (this.game && this.game.mp) { this.endGame(); this.audio.playMusic('menu'); }
      if (this.settings.lastRoom === code) { this.settings.lastRoom = ''; this.saveSettings(); }
      if (!this.game) this.ui.show('mp');
      const why = reason === 'restart' ? 'the multiplayer server restarted, which closes every room'
        : reason === 'offline' ? 'the server could not be reached for too long'
          : 'you were disconnected for more than 30 seconds, so your place was given up';
      toast(`Room ${esc(code)} is gone: ${why}. Create a new room (or rejoin if your friends are still there).`, 7000, 'bad');
    });
    N.on('host', (m) => {
      if (m.id === N.id) toast(`${esc(m.prev)} left — <b>you are now the host</b> (you can change mode and map)`, 5000, 'good');
      else toast(`<b>${esc(m.name)}</b> is now the host`, 4000);
      if (this.ui.current === 'lobby') this.ui.renderLobby();
    });
    N.on('replaced', () => {
      if (this.game && this.game.mp) { this.endGame(); this.audio.playMusic('menu'); }
      if (!this.game) this.ui.show('main');
      toast('Multiplayer was opened in another tab or window, so this one was disconnected.', 6000, 'bad');
    });
    N.on('serverRestart', (m) => banner(true, m.msg || 'Server restarting…'));
    N.on('disconnect', ({ was }) => {
      banner(false);
      if (!was || N.replaced) return;
      if (this.game && this.game.mp) { this.endGame(); this.audio.playMusic('menu'); }
      if (this.game == null && ['lobby', 'create', 'mp', 'none'].includes(this.ui.current)) { this.ui.show('mp'); }
      toast('Disconnected from the multiplayer server', 3500, 'bad');
    });
  }
}

new App();

// "Add to Home Screen" / offline shell. Not on file:// (the standalone DriftClub.html).
if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
  window.addEventListener('load', () => { navigator.serviceWorker.register('sw.js').catch((e) => console.warn('Service worker not registered:', e.message)); });
}
