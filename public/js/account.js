// Accounts: log in / sign up against the game server's /api, keep the login token on this device,
// and sync the player's progress (level/XP, cars and setups, bests, secret-car unlocks) to the account.
import { isUnlocked, unlock } from './secret.js';

const KEY = 'driftclub.account', GUEST = 'driftclub.guest';
const SYNC_KEYS = ['playerName', 'driveStyle', 'driftAngle', 'car', 'bests', 'garage', 'presets', 'xp', 'publicMap']; // device stuff (graphics, controls) stays per device
const SECRET_NAMES = ['creator', 'squad', 'mango', 'kitsune', 'raijin', 'oni'];

export class Account {
  constructor(app) {
    this.app = app;
    try { this.data = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { this.data = null; }
    this.saveT = null;
  }
  get loggedIn() { return !!(this.data && this.data.token); }
  get name() { return this.data ? this.data.name : null; }
  get token() { return this.data ? this.data.token : null; }
  get guestChosen() { try { return localStorage.getItem(GUEST) === '1'; } catch { return false; } }
  playAsGuest() { try { localStorage.setItem(GUEST, '1'); } catch { /* */ } }
  base() { // http(s) base of the game server (same place multiplayer connects to)
    const ws = this.app.net.url(this.app.settings.serverUrl);
    return ws.replace(/^ws/, 'http').replace(/\/ws$/, '');
  }
  async call(route, body, timeoutMs = 75000) {
    const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const r = await fetch(`${this.base()}/api/${route}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: ctl.signal });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || `Server error ${r.status}`);
      return j;
    } catch (e) {
      if (e.name === 'AbortError' || e instanceof TypeError) throw new Error('Can\'t reach the server. It may be waking up — try again in a minute.');
      throw e;
    } finally { clearTimeout(t); }
  }
  snapshot() {
    const S = this.app.settings, out = { settings: {}, unlocks: SECRET_NAMES.filter((n) => isUnlocked(n)), v: 1 };
    for (const k of SYNC_KEYS) if (S[k] !== undefined) out.settings[k] = S[k];
    return out;
  }
  apply(save) {
    const S = this.app.settings;
    if (save && save.settings) for (const k of SYNC_KEYS) if (save.settings[k] !== undefined) S[k] = save.settings[k];
    if (save && Array.isArray(save.unlocks)) for (const n of save.unlocks) if (SECRET_NAMES.includes(n)) unlock(n);
    S.playerName = this.name;
    this.app.saveSettings(true);
    this.app.renderLevel();
  }
  remember(name, token) {
    this.data = { name, token };
    try { localStorage.setItem(KEY, JSON.stringify(this.data)); localStorage.removeItem(GUEST); } catch { /* */ }
  }
  async signup(name, pass) {
    const r = await this.call('signup', { name, pass, save: this.snapshot() }); // a new account starts with this device's progress
    this.remember(r.name, r.token); this.apply(r.save); this.reconnect();
    return r;
  }
  async login(name, pass) {
    const r = await this.call('login', { name, pass });
    this.remember(r.name, r.token);
    // brand-new account with nothing saved yet: keep this device's progress
    if (!r.save || !r.save.settings) { this.apply(null); this.pushNow(); } else this.apply(r.save);
    this.reconnect();
    return r;
  }
  async refresh() { // on start-up: pull the latest save for the remembered login
    if (!this.loggedIn) return;
    try { const r = await this.call('me', { token: this.token }, 20000); this.data.name = r.name; this.apply(r.save); }
    catch (e) { if (/log in again/.test(e.message)) this.forget(); }
  }
  logout() {
    if (this.loggedIn) this.call('logout', { token: this.token }, 8000).catch(() => {});
    this.forget(); this.reconnect();
  }
  forget() { this.data = null; try { localStorage.removeItem(KEY); } catch { /* */ } }
  reconnect() { // tell an open multiplayer connection who we are now
    const N = this.app.net;
    N.send({ t: 'auth', acct: this.token || null, name: this.app.settings.playerName });
  }
  // progress changed: upload a few seconds later (batched)
  queueSave() {
    if (!this.loggedIn) return;
    clearTimeout(this.saveT);
    this.saveT = setTimeout(() => this.pushNow(), 4000);
  }
  pushNow() {
    if (!this.loggedIn) return;
    clearTimeout(this.saveT);
    this.call('save', { token: this.token, save: this.snapshot() }, 30000).catch((e) => { if (/log in again/.test(e.message)) this.forget(); });
  }
}
