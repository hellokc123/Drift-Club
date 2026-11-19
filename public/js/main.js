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
    this.net = new Net();
    this.ui = new UI(this);
    this.showroom = new Showroom(this);
    this.game = null; this.fps = 60; this.frames = 0; this.fpsT = 0;
    this.bindNet();
    const unlock = () => { this.audio.init(); this.audio.playMusic(this.game ? this.audio.style : 'menu'); };
    window.addEventListener('pointerdown', unlock, { once: false });
    window.addEventListener('keydown', unlock, { once: false });
    this.ui.show('main');
    // after a refresh / crash, quietly resume an unfinished multiplayer session (same room & game)
    if (this.net.token) this.net.connect(this.settings.playerName, this.settings.car, this.settings.serverUrl, { patience: 8000 }).catch(() => {});
    $('#fps').classList.toggle('hidden', !this.settings.showFps);
    this.last = performance.now();
    requestAnimationFrame((t) => this.loop(t));
    window.__app = this; // handy for debugging & automated tests
  }
  saveSettings() { saveSettings(this.settings); }
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
      if (d.best && (!r.lap || d.best < r.lap)) r.lap = d.best;
      r.races = (r.races || 0) + 1; if (d.pos === 1 && d.field > 1) r.wins = (r.wins || 0) + 1;
    } else if (type === 'battle') {
      const b = (R.battle = R.battle || {});
      if (d.solo) { b.solo = b.solo || {}; b.solo[d.map] = Math.max(b.solo[d.map] || 0, d.total); }
      else { if (d.draw) b.draws = (b.draws || 0) + 1; else if (d.won) b.wins = (b.wins || 0) + 1; else b.losses = (b.losses || 0) + 1; b.points = Math.round(((b.points || 0) + d.total) * 10) / 10; }
    }
    this.saveSettings();
  }
  saveBest(map, mode, score) {
    const k = `${map}:${mode}`;
    if (score > (this.settings.bests[k] || 0)) { this.settings.bests[k] = Math.round(score); this.saveSettings(); }
  }

  loop(t) {
    const dt = Math.min(0.1, (t - this.last) / 1000); this.last = t;
    this.frames++; this.fpsT += dt;
    if (this.fpsT >= 0.5) { this.fps = Math.round(this.frames / this.fpsT); this.frames = 0; this.fpsT = 0; if (!this.game && this.settings.showFps) $('#fps').textContent = `${this.fps} fps`; }
    this.renderer.resize(this.settings.renderScale || 1);
    try {
      if (this.game && this.game.ready) this.game.frame(dt);
      else if (!this.game) this.showroom.frame(dt, this.ui.current);
    } catch (e) { console.error(e); }
    requestAnimationFrame((tt) => this.loop(tt));
  }

  startGame(opts) {
    if (this.game) this.endGame();
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
    N.on('joined', () => { if (!this.game) this.ui.show('lobby'); });
    N.on('room', () => { if (this.ui.current === 'lobby') this.ui.renderLobby(); });
    N.on('left', () => { this.settings.lastRoom = ''; this.saveSettings(); if (!this.game) this.ui.show('mp'); });
    N.on('error', (m) => toast(esc(m.msg), 3000, 'bad'));
    N.on('chat', (m) => { if (!this.game) this.ui.chatLine(m); });
    N.on('gameStart', (m) => {
      if (this.game && this.game.mp) this.endGame();
      this.startGame({ mp: true, mapId: m.map, modeId: m.mode, spawn: m.spawn, rounds: m.rounds, roundTime: m.roundTime, comp: m.comp, spectator: m.spectator, grid: m.grid, resume: m.resume, rules: m.rules || 'open' });
    });
    N.on('gameEnd', () => {
      if (this.game && this.game.mp) { this.endGame(); this.audio.playMusic('menu'); this.ui.show('lobby'); toast('Back in the room lobby', 2000); }
    });
    N.inGame = () => !!(this.game && this.game.mp);
    const banner = (on, text) => { const b = $('#netbanner'); b.classList.toggle('hidden', !on); if (text) b.textContent = text; };
    N.on('reconnecting', () => banner(true, 'Connection lost — reconnecting…'));
    N.on('reconnected', () => { banner(false); toast('Reconnected', 1500, 'good'); if (this.ui.current === 'lobby') this.ui.renderLobby(); });
    N.on('resumeFailed', () => {
      banner(false);
      if (this.game && this.game.mp) { this.endGame(); this.audio.playMusic('menu'); }
      if (['lobby', 'none', 'create'].includes(this.ui.current) || !this.game) this.ui.show('mp');
      toast('Reconnected, but your room slot had expired — rejoin with the room code', 4000, 'bad');
    });
    N.on('disconnect', ({ was }) => {
      banner(false);
      if (!was) return;
      if (this.game && this.game.mp) { this.endGame(); this.audio.playMusic('menu'); }
      if (this.game == null && ['lobby', 'create', 'mp', 'none'].includes(this.ui.current)) { this.ui.show('mp'); }
      toast('Disconnected from the multiplayer server', 3500, 'bad');
    });
  }
}

new App();
