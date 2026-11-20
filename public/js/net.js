// Multiplayer client: WebSocket connection to server.js rooms.
// - remembers a resume token so a dropped connection (Wi-Fi blip, refresh) rejoins the
//   same room/game automatically within the server's grace period
// - only ever has ONE connection attempt running (two at once used to swap the player into a
//   different session and silently lose their room / host role)
// - retries while a sleeping free-tier server wakes up
// - notices a dead connection (no messages for 7 s) and reconnects
// - measures network jitter to size the remote-car interpolation buffer
import { DEFAULT_SERVER } from './config.js';

const TOKEN_KEY = 'driftclub.session';
const DEAD_MS = 7000; // the server always talks at least every few seconds (pongs to our pings)

export class Net {
  constructor() {
    this.ws = null; this.id = null; this.connected = false;
    this.handlers = new Map(); this.room = null; this.clockOffset = null;
    this.jitter = 20; this.interpDelay = 120; this.rtt = 0;
    this.token = null; try { this.token = sessionStorage.getItem(TOKEN_KEY); } catch { /* */ }
    this.reconnecting = false; this.manualClose = false; this.inGame = () => false;
    this.boot = null; this.lastMsgAt = 0;
    this.checkDuplicateTab();
  }
  on(t, fn) { if (!this.handlers.has(t)) this.handlers.set(t, new Set()); this.handlers.get(t).add(fn); return () => this.handlers.get(t).delete(fn); }
  emit(t, m) { const hs = this.handlers.get(t); if (hs) for (const fn of [...hs]) fn(m); }

  // "Duplicate tab" copies sessionStorage, so two tabs could share one session token and keep
  // stealing the session from each other. Ask other open tabs: if one already uses our token, drop it.
  checkDuplicateTab() {
    this.tokenChecked = Promise.resolve();
    if (typeof BroadcastChannel === 'undefined') return;
    try {
      const ch = this.tabChannel = new BroadcastChannel('driftclub-session');
      ch.onmessage = (e) => {
        const d = e.data || {};
        if (d.ask && d.ask === this.token && this.connected) ch.postMessage({ mine: d.ask });
        if (d.mine && d.mine === this.token && !this.connected) { this.token = null; try { sessionStorage.removeItem(TOKEN_KEY); } catch { /* */ } }
      };
      if (this.token) { ch.postMessage({ ask: this.token }); this.tokenChecked = sleep(150); }
    } catch { /* */ }
  }

  static normalize(custom) {
    let u = (custom || '').trim();
    if (!u) return '';
    if (/^https?:\/\//.test(u)) u = u.replace(/^http/, 'ws');
    if (!/^wss?:\/\//.test(u)) u = (/^(localhost|127\.|10\.|192\.168\.|\d+\.\d+\.\d+\.\d+)/.test(u) ? 'ws://' : 'wss://') + u;
    u = u.replace(/\/+$/, '');
    return u.endsWith('/ws') ? u : u + '/ws';
  }
  url(custom) {
    const c = Net.normalize(custom) || Net.normalize(DEFAULT_SERVER);
    if (c) return c;
    if (location.protocol === 'file:') return 'ws://localhost:3000/ws';
    return (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws';
  }
  get target() { return this.url(this.lastArgs ? this.lastArgs.custom : ''); }

  // Connect (with retries for up to `patience` ms, e.g. while a free server wakes up)
  connect(name, car, custom, { patience = 0, onAttempt } = {}) {
    if (this.connected) return Promise.resolve(this.id);
    if (this._connecting) return this._connecting;
    // already reconnecting by itself: wait for that instead of opening a second connection
    if (this.reconnecting) return this.waitReconnect();
    // this tab's session was taken over by another tab: start a fresh session instead of stealing it back
    if (this.replaced) { this.replaced = false; this.token = null; }
    this.lastArgs = { name, car, custom };
    this.manualClose = false;
    const deadline = performance.now() + patience;
    this._connecting = (async () => {
      let attempt = 0, lastErr;
      do {
        attempt++;
        if (onAttempt) onAttempt(attempt);
        try { const id = await this.open(name, car, custom, false); this._connecting = null; return id; }
        catch (e) { lastErr = e; }
        if (performance.now() + 2500 < deadline) { this.wake(custom); await sleep(2500); }
      } while (performance.now() < deadline && !this.manualClose);
      this._connecting = null;
      throw lastErr || new Error('Could not reach the multiplayer server');
    })();
    return this._connecting;
  }
  waitReconnect() {
    return new Promise((resolve, reject) => {
      const offs = [];
      const done = (fn, v) => { offs.forEach((o) => o()); fn(v); };
      offs.push(this.on('welcome', () => done(resolve, this.id)));
      offs.push(this.on('disconnect', () => done(reject, new Error('Could not reach the multiplayer server'))));
    });
  }
  // free hosting tiers sleep when idle; an HTTP request wakes them up
  wake(custom) {
    try { const http = this.url(custom).replace(/^ws/, 'http').replace(/\/ws$/, '/health'); fetch(http, { mode: 'no-cors', cache: 'no-store' }).catch(() => {}); } catch { /* */ }
  }

  async open(name, car, custom, resume) {
    await this.tokenChecked;
    return new Promise((resolve, reject) => {
      let ws, settled = false;
      try { ws = new WebSocket(this.url(custom)); } catch (e) { reject(e); return; }
      const fail = (msg) => { if (!settled) { settled = true; clearTimeout(timer); reject(new Error(msg)); } };
      const timer = setTimeout(() => { if (!settled) { ws.onclose = null; try { ws.close(); } catch { /* */ } fail('timeout'); } }, 8000);
      ws.onopen = () => ws.send(JSON.stringify({ t: 'hello', name, car, token: this.token, inGame: this.inGame() }));
      ws.onmessage = (e) => {
        let m; try { m = JSON.parse(e.data); } catch { return; }
        if (m.t === 'welcome') {
          if (settled && ws !== this.ws) { ws.onclose = null; try { ws.close(); } catch { /* */ } return; } // a timed-out attempt answering late
          clearTimeout(timer);
          if (m.serverTime && this.srvOffset === undefined) this.srvOffset = performance.now() - m.serverTime;
          if (this.ws && this.ws !== ws) { try { this.ws.onclose = null; this.ws.close(); } catch { /* */ } }
          this.ws = ws; this.id = m.id; this.connected = true; this.lastMsgAt = performance.now(); this.pingAt = 0;
          this.token = m.token; try { sessionStorage.setItem(TOKEN_KEY, m.token); } catch { /* */ }
          const restarted = !!(this.boot && m.boot && m.boot !== this.boot);
          this.boot = m.boot || this.boot;
          this.syncBurst();
          this.startPing();
          if (!settled) { settled = true; resolve(m.id); }
          if (!m.resumed) {
            // a brand-new session: if we thought we were in a room, that room is gone for us — say so
            const lost = this.room;
            this.room = null;
            if (lost) this.emit('roomLost', { code: lost.code, reason: restarted || this.restartWarned ? 'restart' : 'expired' });
          }
          if (resume) this.emit('reconnected', m);
        }
        if (ws !== this.ws) return;
        this.lastMsgAt = performance.now();
        this.track(m);
        this.emit(m.t, m);
      };
      ws.onclose = () => {
        clearTimeout(timer);
        if (!settled) { fail('Could not reach the multiplayer server'); return; }
        if (ws === this.ws) this.lost();
      };
      ws.onerror = () => {};
    });
  }
  // our live connection ended (or went silent)
  lost() {
    this.connected = false; this.ws = null; clearInterval(this.pingT);
    if (this.manualClose) { this.room = null; this.emit('disconnect', { was: true }); return; }
    this.autoReconnect();
  }
  // close a socket that stopped talking (Wi-Fi gone, proxy killed it) without waiting for the browser to notice
  dropSocket() {
    const ws = this.ws; if (!ws) return;
    ws.onclose = null; try { ws.close(); } catch { /* */ }
    this.lost();
  }

  track(m) {
    if (m.t === 'snap' && m.ts) {
      const now = performance.now(), off = now - m.ts;
      if (this.clockOffset === null) this.clockOffset = off;
      else {
        // min-filter the one-way offset (slowly relaxed) and track jitter around it
        this.clockOffset = Math.min(this.clockOffset + 0.3, off);
        this.jitter += (Math.abs(off - this.clockOffset) - this.jitter) * 0.05;
      }
      // 50 ms snapshot spacing + 2.5x jitter, bounded
      this.interpDelay += (Math.min(400, Math.max(100, 60 + 2.5 * this.jitter)) - this.interpDelay) * 0.05;
    }
    if (m.t === 'pong') {
      // server-clock sync: keep the lowest-latency estimate (local = server + srvOffset)
      const now = performance.now(), rtt = now - m.ct; this.rtt = rtt;
      const est = now - rtt / 2 - m.st;
      this.syncSamples = [...(this.syncSamples || []), { rtt, est }].slice(-10);
      this.srvOffset = this.syncSamples.reduce((a, b) => (b.rtt < a.rtt ? b : a)).est;
    }
    if (m.t === 'joined' || m.t === 'room') this.room = m.room;
    if (m.t === 'host' && this.room) this.room = { ...this.room, hostId: m.id };
    if (m.t === 'round') this.lastRound = { ...m, at: performance.now() };
    if (m.t === 'gameStart' || m.t === 'gameEnd') { this.lastRound = null; this.lastMatch = {}; }
    if (m.t === 'mStart' || m.t === 'mResult' || m.t === 'bRound') this.lastMatch = { ...(this.lastMatch || {}), [m.t]: m, ...(m.t === 'bRound' ? { mResult: null } : {}) };
    if (m.t === 'left') this.room = null;
    if (m.t === 'replaced') { this.manualClose = true; this.replaced = true; this.room = null; } // this game was opened in another tab
    if (m.t === 'serverRestart') this.restartWarned = true;
  }

  async autoReconnect() {
    if (this.reconnecting) return;
    this.reconnecting = true;
    this.emit('reconnecting', {});
    const { name, car, custom } = this.lastArgs || {};
    // long enough for a free server to restart/wake (~30-60 s)
    const until = performance.now() + (this.restartWarned ? 75000 : 45000);
    while (performance.now() < until && !this.manualClose) {
      await sleep(1200);
      this.wake(custom);
      try { await this.open(name, car, custom, true); this.reconnecting = false; this.restartWarned = false; return; } catch { /* keep trying */ }
    }
    this.reconnecting = false;
    const lost = this.room;
    this.room = null;
    if (lost) this.emit('roomLost', { code: lost.code, reason: 'offline' });
    this.emit('disconnect', { was: true });
  }

  syncBurst() { for (let i = 1; i <= 5; i++) setTimeout(() => this.send({ t: 'ping', ct: performance.now() }), i * 150); }
  // convert a server timestamp (ms) to the local performance.now() clock, and back
  toLocal(serverMs) { return serverMs + (this.srvOffset || 0); }
  serverNow() { return performance.now() - (this.srvOffset || 0); }
  startPing() {
    clearInterval(this.pingT);
    this.pingT = setInterval(() => {
      const now = performance.now(), answered = this.lastMsgAt >= this.pingAt;
      // our last ping got no answer (and nothing else arrived) for 7 s: the connection is dead even if
      // the browser hasn't noticed yet (school proxies / sleeping laptops) -> reconnect now
      if (this.pingAt && !answered && now - this.pingAt > DEAD_MS) return this.dropSocket();
      if (!this.pingAt || answered) { this.pingAt = now; this.send({ t: 'ping', ct: now }); }
    }, 2000);
  }
  send(m) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(m)); }
  close() { this.manualClose = true; if (this.ws) this.ws.close(); this.connected = false; }
  // convert server timestamp to local performance.now() timeline
  localTime(ts) { return ts + (this.clockOffset || 0); }
  get isHost() { return this.room && this.room.hostId === this.id; }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
