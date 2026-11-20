// =============================================================
//  DRIFT CLUB — game server
//  Zero dependencies: serves the game files AND runs the
//  real-time multiplayer room system over WebSockets.
//  Run:  node server.js          (PORT env var optional)
// =============================================================
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT) || 3000;
const PUB = path.join(__dirname, 'public');

const MAPS = ['track', 'desert', 'mountain', 'forest', 'city'];
const MODES = ['endless', 'standard', 'chill', 'competitive', 'challenge', 'race', 'driftrace', 'battle'];
const COMP_MODES = ['challenge', 'race', 'driftrace', 'battle'];
const RACE_MODES = ['race', 'driftrace']; // modes run on the race circuits (grid, laps, checkpoints)
const SNAPSHOT_HZ = 20;
const MAX_PAYLOAD = 64 * 1024;
const RESUME_GRACE_MS = 30000; // a dropped player keeps their slot this long (Wi-Fi blips, page refresh)
const MAX_PER_IP = Number(process.env.MAX_PER_IP) || 20; // open connections per network (schools share one IP)
const FLOOD_LIMIT = 60; // messages per half second per connection (the game sends ~25)
const RESULTS_AUTO_LOBBY_MS = Number(process.env.RESULTS_AUTO_LOBBY_MS) || 120000; // a finished match goes back to the lobby by itself after this
const RACE_REST_MS = Number(process.env.RACE_REST_MS) || 60000; // after the first finisher, the others get this long
const BOOT_ID = crypto.randomBytes(4).toString('hex'); // changes on every server restart
const MODE_NAMES = { endless: 'Endless', standard: 'Standard', chill: 'Chill', competitive: 'Competitive', challenge: 'Drift Challenge', race: 'Speed Race', driftrace: 'Drift Race', battle: 'Drift Battle' };
// per-message-type limits: [messages per second, burst]
const RATE = { chat: [2, 3], create: [1, 2], join: [2, 3], peek: [2, 3], list: [2, 3], records: [1, 2], settings: [5, 8], start: [1, 2], rematch: [1, 2] };

// -------------------------------------------------------------
// Shared game rules (the same tracks.js / judge.js the browser runs) — loaded at startup
// -------------------------------------------------------------
let SH = null;
const ready = (async () => {
  const { pathToFileURL } = require('url');
  const imp = (f) => import(pathToFileURL(path.join(PUB, 'js', f)).href);
  const [tracks, judge, tuning, cars] = await Promise.all([imp('tracks.js'), imp('judge.js'), imp('tuning.js'), imp('cars.js')]);
  SH = { ...tracks, ...judge, tuning, cars };
})();

// -------------------------------------------------------------
// Online records (only server-validated, completed competitions). Stored as a JSON file.
// -------------------------------------------------------------
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const REC_FILE = path.join(DATA_DIR, 'records.json');
let records = { challenge: {}, race: {}, driftrace: {}, battle: { players: {} }, matches: [] };
try { records = { ...records, ...JSON.parse(fs.readFileSync(REC_FILE, 'utf8')) }; } catch { /* first run */ }
let recSaveT = null;
function saveRecords() {
  clearTimeout(recSaveT);
  recSaveT = setTimeout(() => {
    try { fs.mkdirSync(DATA_DIR, { recursive: true }); fs.writeFileSync(REC_FILE + '.tmp', JSON.stringify(records)); fs.renameSync(REC_FILE + '.tmp', REC_FILE); }
    catch (e) { console.error('could not save records', e.message); }
  }, 500);
}
const top = (arr, entry, key, n = 10, asc = false) => { arr.push(entry); arr.sort((a, b) => (asc ? a[key] - b[key] : b[key] - a[key])); arr.length = Math.min(arr.length, n); return arr; };

// -------------------------------------------------------------
// Static file server
// -------------------------------------------------------------
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8',
};

const server = http.createServer((req, res) => {
  let url;
  try { url = decodeURIComponent(req.url.split('?')[0]); } catch { url = '/'; }
  if (url === '/records') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-cache' });
    return res.end(JSON.stringify(publicRecords()));
  }
  if (url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, rooms: rooms.size, players: clients.size }));
  }
  if (url === '/') url = '/index.html';
  const fp = path.normalize(path.join(PUB, url));
  if (!fp.startsWith(PUB + path.sep)) { res.writeHead(403); return res.end('Forbidden'); }
  fs.readFile(fp, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(fp).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(data);
  });
});

// -------------------------------------------------------------
// Minimal RFC 6455 WebSocket implementation
// -------------------------------------------------------------
class WSConn {
  constructor(socket) {
    this.socket = socket;
    this.buf = Buffer.alloc(0);
    this.frag = null; // fragmented message parts
    this.open = true;
    this.lastPong = Date.now();
    this.onmessage = null;
    this.onclose = null;
    socket.on('data', (d) => this._data(d));
    socket.on('close', () => this._closed());
    socket.on('error', () => this._closed());
  }
  _closed() {
    if (!this.open) return;
    this.open = false;
    if (this.onclose) this.onclose();
  }
  _data(chunk) {
    this.buf = Buffer.concat([this.buf, chunk]);
    while (this.buf.length >= 2) {
      const b0 = this.buf[0], b1 = this.buf[1];
      const fin = (b0 & 0x80) !== 0, op = b0 & 0x0f, masked = (b1 & 0x80) !== 0;
      let len = b1 & 0x7f, off = 2;
      if (len === 126) { if (this.buf.length < 4) return; len = this.buf.readUInt16BE(2); off = 4; }
      else if (len === 127) {
        if (this.buf.length < 10) return;
        const hi = this.buf.readUInt32BE(2), lo = this.buf.readUInt32BE(6);
        if (hi !== 0) return this.close(1009);
        len = lo; off = 10;
      }
      if (len > MAX_PAYLOAD) return this.close(1009);
      if (!masked) return this.close(1002); // clients must mask
      if (this.buf.length < off + 4 + len) return;
      const mask = this.buf.subarray(off, off + 4);
      const payload = Buffer.from(this.buf.subarray(off + 4, off + 4 + len));
      for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
      this.buf = this.buf.subarray(off + 4 + len);
      this._frame(fin, op, payload);
      if (!this.open) return;
    }
  }
  _frame(fin, op, payload) {
    if (op === 0x8) return this.close(1000);
    if (op === 0x9) return this._send(0xA, payload);
    if (op === 0xA) { this.lastPong = Date.now(); return; }
    if (op === 0x1 || op === 0x2) {
      if (fin) return this._msg(op, payload);
      this.frag = { op, parts: [payload], size: payload.length };
      return;
    }
    if (op === 0x0 && this.frag) {
      this.frag.parts.push(payload);
      this.frag.size += payload.length;
      if (this.frag.size > MAX_PAYLOAD) { this.frag = null; return this.close(1009); } // whole message too big
      if (fin) { const f = this.frag; this.frag = null; this._msg(f.op, Buffer.concat(f.parts)); }
    }
  }
  _msg(op, payload) {
    this.lastPong = Date.now();
    if (op === 0x1 && this.onmessage) this.onmessage(payload.toString('utf8'));
  }
  _send(op, payload) {
    if (!this.open) return;
    const len = payload.length;
    let header;
    if (len < 126) { header = Buffer.from([0x80 | op, len]); }
    else if (len < 65536) { header = Buffer.alloc(4); header[0] = 0x80 | op; header[1] = 126; header.writeUInt16BE(len, 2); }
    else { header = Buffer.alloc(10); header[0] = 0x80 | op; header[1] = 127; header.writeUInt32BE(0, 2); header.writeUInt32BE(len, 6); }
    try { this.socket.write(Buffer.concat([header, payload])); } catch { this._closed(); }
  }
  send(text) { this._send(0x1, Buffer.from(text, 'utf8')); }
  ping() { this._send(0x9, Buffer.alloc(0)); }
  close(code = 1000) {
    if (!this.open) return;
    const b = Buffer.alloc(2); b.writeUInt16BE(code, 0);
    this._send(0x8, b);
    this.open = false;
    try { this.socket.end(); } catch { /* ignore */ }
    // a dead or slow peer may never finish closing: force it after 2 s
    const sock = this.socket;
    setTimeout(() => { try { sock.destroy(); } catch { /* ignore */ } }, 2000).unref();
    if (this.onclose) this.onclose();
  }
}

server.on('upgrade', (req, socket) => {
  const key = req.headers['sec-websocket-key'];
  if (!req.url.startsWith('/ws') || !key) { socket.destroy(); return; }
  const accept = crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' +
    `Sec-WebSocket-Accept: ${accept}\r\n\r\n`);
  socket.setNoDelay(true);
  const ip = clientIp(req);
  if ((ipCount.get(ip) || 0) >= MAX_PER_IP) { const w = new WSConn(socket); w.send(JSON.stringify({ t: 'error', msg: 'Too many connections from your network' })); w.close(1008); return; }
  ipCount.set(ip, (ipCount.get(ip) || 0) + 1);
  socket.once('close', () => { const n = (ipCount.get(ip) || 1) - 1; if (n > 0) ipCount.set(ip, n); else ipCount.delete(ip); });
  onConnection(new WSConn(socket));
});
// connections per IP. On Render the real address is the first x-forwarded-for entry; elsewhere the socket's own.
const ipCount = new Map();
function clientIp(req) {
  const xff = (process.env.RENDER || process.env.TRUST_PROXY) && req.headers['x-forwarded-for'];
  return (xff ? String(xff).split(',')[0].trim() : req.socket.remoteAddress) || '?';
}

// -------------------------------------------------------------
// Rooms
// -------------------------------------------------------------
const rooms = new Map();   // code -> room
const clients = new Map(); // id -> client
const sessions = new Map(); // resume token -> client
let nextId = 1;

const clampInt = (v, a, b, d) => { v = Math.round(Number(v)); return Number.isFinite(v) ? Math.min(b, Math.max(a, v)) : d; };
const cleanText = (s, max, d) => {
  s = String(s ?? '').replace(/[<>&"'`\u0000-\u001f]/g, '').trim().slice(0, max);
  return s || d;
};
const num = (v) => (Number.isFinite(v) ? Math.round(v * 100) / 100 : 0);

function genCode() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for (;;) {
    let c = '';
    for (let i = 0; i < 5; i++) c += A[Math.floor(Math.random() * A.length)];
    if (!rooms.has(c)) return c;
  }
}

// Car config from a browser: every visual option and every performance setting is clamped to what the
// game allows for that car (tuning.js / cars.js, the same code the browser uses). Anything else is dropped.
function sanitizeCar(car) {
  if (!car || typeof car !== 'object') car = {};
  const hex = (c, d) => (/^#[0-9a-fA-F]{6}$/.test(c) ? c : d);
  const def = SH && SH.cars.CARS.find((d) => d.id === car.id) || (SH ? SH.cars.CARS[0] : { id: 'hatch' });
  const V = SH ? SH.cars.VISUAL : {}, part = (k) => { const n = V[k] ? V[k].opts.length - 1 : 3, v = clampInt(car[k], 0, n, 0); return SH && !SH.cars.fitsPart(def, k, v) ? 0 : v; };
  return {
    id: def.id,
    paint: hex(car.paint, '#e63946'), wheel: hex(car.wheel, '#cccccc'),
    stripeColor: hex(car.stripeColor, '#ffffff'), liveryColor: hex(car.liveryColor, '#111111'),
    rim: clampInt(car.rim, 0, 5, 0), spoiler: part('spoiler'), kit: part('kit'),
    stripes: clampInt(car.stripes, 0, 2, 0), lowered: clampInt(car.lowered, 0, 1, 0),
    underglow: car.underglow ? hex(car.underglow, '') : '',
    rimSize: part('rimSize'), fbumper: part('fbumper'), rbumper: part('rbumper'), skirts: part('skirts'), hood: part('hood'),
    tint: part('tint'), lights: part('lights'), exhaust: part('exhaust'), livery: part('livery'),
    tune: SH ? SH.tuning.sanitizeTune(car.tune, def) : null,
  };
}
// highest speed this player's validated car could plausibly reach (boost, downhill and lag margin included)
function speedCap(car, rules) {
  const def = SH.cars.CARS.find((d) => d.id === car.id) || SH.cars.CARS[0];
  return SH.tuning.applyTune(def, car.tune, rules).top * 1.12 * 1.3 + 6;
}

function roomInfo(r) {
  return {
    code: r.code, name: r.name, isPublic: r.isPublic, map: r.map, mode: r.mode,
    maxPlayers: r.maxPlayers, rounds: r.rounds, roundTime: r.roundTime, hostId: r.hostId,
    status: r.status, variant: r.variant, matchTime: r.matchTime, laps: r.laps, rules: r.rules,
    match: r.match ? { mode: r.match.mode, phase: r.match.phase, competitors: r.match.competitors } : null,
    players: [...r.players].filter((id) => clients.has(id)).map((id) => {
      const c = clients.get(id);
      return { id, name: c.name, car: c.car, wins: c.wins || 0, away: !!c.suspended };
    }),
  };
}
function listInfo(r) {
  return { code: r.code, name: r.name, map: r.map, mode: r.mode, count: r.players.size, max: r.maxPlayers, status: r.status, rules: r.rules };
}

function send(c, msg) { if (c && !c.suspended && c.ws.open) c.ws.send(JSON.stringify(msg)); }
function broadcast(r, msg, exceptId) {
  const s = JSON.stringify(msg);
  for (const id of r.players) if (id !== exceptId) { const c = clients.get(id); if (c && !c.suspended && c.ws.open) c.ws.send(s); }
}
function broadcastRoom(r) { broadcast(r, { t: 'room', room: roomInfo(r) }); }

// Settings are only ever changed by the host (or at creation). Returns what changed, so everyone can be told.
function applySettings(r, s, isCreate) {
  const before = { mode: r.mode, map: r.map };
  if (s.name !== undefined) r.name = cleanText(s.name, 24, r.name || 'Drift Room');
  if (s.isPublic !== undefined) r.isPublic = !!s.isPublic;
  if (s.maxPlayers !== undefined) r.maxPlayers = Math.max(clampInt(s.maxPlayers, 2, 12, 8), isCreate ? 1 : r.players.size);
  if (r.status === 'lobby' || isCreate) {
    if (MAPS.includes(s.map)) r.map = s.map;
    if (MODES.includes(s.mode)) r.mode = s.mode;
    if (s.rounds !== undefined) r.rounds = clampInt(s.rounds, 1, 5, 3);
    if (s.roundTime !== undefined) r.roundTime = clampInt(s.roundTime, 30, 300, 90);
    if (s.variant === 'timed' || s.variant === 'attack') r.variant = s.variant;
    if (s.matchTime !== undefined) r.matchTime = clampInt(s.matchTime, 30, 600, 120);
    if (s.laps !== undefined) r.laps = clampInt(s.laps, 1, 10, 3);
    if (['open', 'equal', 'stock'].includes(s.rules)) r.rules = s.rules; // performance-mod rules
  }
  return { mode: before.mode !== r.mode, map: before.map !== r.map };
}

// A room is only created with the mode the player picked: there is no silent default.
function createRoom(c, s) {
  const r = {
    code: genCode(), name: `${c.name}'s room`, isPublic: true, map: 'track', mode: s.mode,
    maxPlayers: 8, rounds: 3, roundTime: 90, variant: 'timed', matchTime: 120, laps: 3, rules: 'open', hostId: c.id, status: 'lobby', match: null,
    players: new Set(), game: null, timers: [], spawnSeq: 0,
  };
  applySettings(r, s || {}, true);
  rooms.set(r.code, r);
  log(`room ${r.code} created by ${c.name}`);
  return r;
}

function joinRoom(c, r) {
  if (c.room) leaveRoom(c);
  r.players.add(c.id);
  c.room = r.code; c.state = null; c.score = { total: 0, best: 0, chain: 0 }; c.wins = 0;
  send(c, { t: 'joined', room: roomInfo(r), you: c.id });
  broadcast(r, { t: 'room', room: roomInfo(r) }, c.id);
  broadcast(r, { t: 'chat', system: true, text: `${c.name} joined` }, c.id);
  if (r.status === 'playing') sendGameStart(r, c);
}

function leaveRoom(c) {
  const r = rooms.get(c.room);
  c.room = null; c.state = null; c.suspended = false; clearTimeout(c.dropTimer);
  if (!r) return;
  r.players.delete(c.id);
  if (r.players.size === 0) { clearTimers(r); rooms.delete(r.code); log(`room ${r.code} closed`); return; }
  if (r.match && r.match.competitors.includes(c.id)) competitorLeft(r, c.id);
  if (r.hostId === c.id) {
    // pick a connected player as the new host if possible, and tell everyone clearly
    const ids = [...r.players].filter((id) => clients.has(id));
    r.hostId = ids.find((id) => !clients.get(id).suspended) || ids[0];
    const h = clients.get(r.hostId);
    broadcast(r, { t: 'host', id: r.hostId, name: h ? h.name : '?', prev: c.name });
    broadcast(r, { t: 'chat', system: true, text: `${c.name} (host) left — ${h ? h.name : '?'} is now the host` });
  }
  broadcast(r, { t: 'playerLeft', id: c.id });
  broadcast(r, { t: 'chat', system: true, text: `${c.name} left` });
  broadcastRoom(r);
}

function clearTimers(r) { r.timers.forEach(clearTimeout); r.timers = []; }
// room timer; an error in one room must never stop the whole server
function later(r, ms, fn) {
  const t = setTimeout(() => {
    r.timers = r.timers.filter((x) => x !== t);
    try { fn(); } catch (e) { console.error(`room ${r.code} timer error`, e); }
  }, ms);
  r.timers.push(t);
}

function sendGameStart(r, c) {
  const g = r.game, M = r.match;
  const comp = M ? { variant: M.variant, time: M.time, laps: M.laps } : null;
  const isComp = M && M.competitors.includes(c.id);
  send(c, {
    t: 'gameStart', map: r.map, mode: r.mode, spawn: (r.spawnSeq++) % 12, rules: r.rules,
    rounds: r.rounds, roundTime: r.roundTime, room: roomInfo(r),
    comp, spectator: !!M && !isComp, grid: isComp ? M.p[c.id].grid : 0,
    resume: isComp && M.phase !== 'loading' && c.state ? { x: c.state[0], z: c.state[2], h: c.state[3] } : null,
  });
  if (M) {
    if (M.mStart) send(c, M.mStart);
    if (M.round && M.round.msg) send(c, M.round.msg);
    if (M.result) send(c, M.result);
  }
  if (r.mode === 'competitive' && g && g.round > 0) {
    const now = Date.now();
    if (g.phase === 'countdown' || g.phase === 'running') {
      const runStart = g.roundStartAt + 3000;
      send(c, {
        t: 'round', round: g.round, rounds: r.rounds,
        countdown: Math.max(0, (runStart - now) / 1000),
        duration: Math.max(0, Math.min(r.roundTime, (g.roundEndAt - Math.max(now, runStart)) / 1000)),
      });
    }
  }
}

function startGame(r) {
  clearTimers(r);
  r.status = 'playing'; r.spawnSeq = 0;
  r.game = { round: 0, phase: 'free', roundStartAt: 0, roundEndAt: 0, history: [] };
  for (const id of r.players) {
    const c = clients.get(id);
    c.score = { total: 0, best: 0, chain: 0 }; c.wins = 0; c.matchTotal = 0; c.state = null;
  }
  for (const id of r.players) sendGameStart(r, clients.get(id));
  broadcastRoom(r);
  if (r.mode === 'competitive') later(r, 1500, () => startRound(r));
  log(`room ${r.code} started ${r.mode} on ${r.map}`);
}

function startRound(r) {
  const g = r.game;
  if (!g || r.status !== 'playing') return;
  g.round++; g.phase = 'countdown';
  g.roundStartAt = Date.now();
  g.roundEndAt = g.roundStartAt + 3000 + r.roundTime * 1000;
  for (const id of r.players) clients.get(id).score = { total: 0, best: 0, chain: 0 };
  broadcast(r, { t: 'round', round: g.round, rounds: r.rounds, countdown: 3, duration: r.roundTime });
  later(r, 3000, () => { g.phase = 'running'; });
  // small grace period so every client's final score arrives
  later(r, 3000 + r.roundTime * 1000 + 1500, () => endRound(r));
}

function endRound(r) {
  const g = r.game;
  if (!g || r.status !== 'playing') return;
  g.phase = 'results';
  const results = [...r.players].map((id) => {
    const c = clients.get(id);
    return { id, name: c.name, score: Math.round(c.score.total) || 0, best: Math.round(c.score.best) || 0 };
  }).sort((a, b) => b.score - a.score);
  const winner = results.length && results[0].score > 0 ? results[0] : null;
  if (winner) { const wc = clients.get(winner.id); wc.wins = (wc.wins || 0) + 1; }
  for (const res of results) { const c = clients.get(res.id); c.matchTotal = (c.matchTotal || 0) + res.score; }
  g.history.push({ round: g.round, winnerId: winner ? winner.id : null });
  const last = g.round >= r.rounds;
  broadcast(r, { t: 'roundEnd', round: g.round, rounds: r.rounds, results, winnerId: winner ? winner.id : null, last });
  broadcastRoom(r);
  if (!last) later(r, 7000, () => startRound(r));
  else later(r, 6000, () => endMatch(r));
}

function endMatch(r) {
  if (r.status !== 'playing') return;
  const standings = [...r.players].map((id) => {
    const c = clients.get(id);
    return { id, name: c.name, wins: c.wins || 0, total: c.matchTotal || 0 };
  }).sort((a, b) => b.wins - a.wins || b.total - a.total);
  broadcast(r, { t: 'matchEnd', standings, winnerId: standings.length ? standings[0].id : null });
  r.game.phase = 'final';
  later(r, 9000, () => endGame(r));
}

function endGame(r) {
  clearTimers(r);
  r.status = 'lobby'; r.game = null; r.match = null;
  for (const id of r.players) { const c = clients.get(id); if (c) c.state = null; }
  broadcast(r, { t: 'gameEnd' });
  broadcastRoom(r);
}

// -------------------------------------------------------------
// Competitive matches: Drift Challenge, Speed Race, Drift Battle.
// The server owns the clock (countdown/end times) and judges every competitor itself from the
// 20 Hz samples, using the same rules code as the browser (tracks.js / judge.js).
// -------------------------------------------------------------
function startMatch(r) {
  const isRace = RACE_MODES.includes(r.mode);
  const valid = isRace ? SH.RACE_MAPS : r.mode === 'battle' ? SH.BATTLE_MAPS : MAPS;
  if (!valid.includes(r.map)) return isRace ? 'Pick a map with a race circuit (Apex Circuit, Dune Valley, Pinewood Trails or City Nights)' : 'Pick a map with a battle course (Apex Circuit, Dune Valley, Kurogane Pass or Pinewood Trails)';
  const present = [...r.players].filter((id) => !clients.get(id).suspended);
  if (r.mode === 'battle' && present.length < 2) return 'Drift Battle needs 2 players in the room (solo players can battle their own ghost from Play → Drift Battle)';
  clearTimers(r);
  r.status = 'playing'; r.spawnSeq = 0; r.game = null;
  const M = r.match = {
    id: crypto.randomBytes(6).toString('hex'), mode: r.mode, map: r.map, phase: 'loading',
    competitors: r.mode === 'battle' ? present.slice(0, 2) : present, ready: new Set(), p: {},
    variant: r.variant, time: r.matchTime, laps: r.laps, results: [], mStart: null, result: null, round: null,
  };
  const slots = isRace ? SH.gridSlots(SH.raceRoute(r.map), Math.max(12, M.competitors.length)) : null;
  // each competitor's car is locked in at the start: its speed limit comes from the validated setup + room rules
  M.competitors.forEach((id, i) => { const c = clients.get(id); c.state = null; M.p[id] = { grid: i, name: c.name, slot: slots ? slots[i] : null, car: c.car, vmax: speedCap(c.car, r.rules), fast: 0 }; });
  for (const id of r.players) sendGameStart(r, clients.get(id));
  broadcastRoom(r);
  later(r, 15000, () => { if (r.match === M && M.phase === 'loading') begin(r); }); // don't wait forever for slow loaders
  log(`room ${r.code} match ${M.id}: ${M.mode} on ${M.map} (${M.competitors.length} competitors)`);
  return null;
}
function maybeBegin(r) {
  const M = r.match;
  if (M && M.phase === 'loading' && M.competitors.every((id) => M.ready.has(id) || clients.get(id).suspended)) begin(r);
}
function begin(r) {
  const M = r.match, now = Date.now();
  if (M.mode === 'battle') return startBattleRound(r, 1);
  M.phase = 'countdown'; M.startAt = now + 4000;
  if (M.mode === 'challenge') {
    M.endAt = M.startAt + M.time * 1000;
    for (const id of M.competitors) M.p[id].judge = new SH.CompDriftJudge(M.map);
    later(r, M.endAt - now + 900, () => finishChallenge(r));
  } else {
    const route = SH.raceRoute(M.map);
    for (const id of M.competitors) {
      M.p[id].tracker = new SH.RaceTracker(route, M.laps);
      if (M.mode === 'driftrace') M.p[id].judge = new SH.CompDriftJudge(M.map, () => {}, SH.DRIFT_RACE.judge);
    }
    later(r, 4000 + Math.max(10, M.laps * 6) * 60000, () => finishRace(r)); // hard cap
  }
  later(r, 4000, () => { if (M.phase === 'countdown') M.phase = 'running'; });
  M.mStart = { t: 'mStart', mode: M.mode, startAt: M.startAt, endAt: M.endAt || null };
  broadcast(r, M.mStart);
  broadcastRoom(r);
}
function matchSample(r, c, m) {
  const M = r.match; if (!M || !M.competitors.includes(c.id) || M.phase === 'results') return;
  const P = M.p[c.id], now = Date.now(), pp = Array.isArray(m.p) ? m.p : [];
  const s = { k: m.k | 0, x: num(pp[0]), y: num(pp[1]), z: num(pp[2]), h: num(m.h), vx: num(m.vx), vz: num(m.vz), f: m.f | 0, sl: num(m.sl) };
  // sample index must move forward and can't run ahead of real time
  if (P.k0 === undefined) { P.k0 = s.k; P.t0 = now; }
  if (P.lastK !== undefined && s.k <= P.lastK) {
    if (P.lastK - s.k < 40) return; // stale / duplicate sample
    // the client restarted its counter (page refresh + resume): new sequence, treated as a teleport
    P.k0 = s.k; P.t0 = now; P.lastK = s.k - 1; s.f |= 256;
  }
  if ((s.k - P.k0) * 50 > now - P.t0 + 1500) s.k = (P.lastK ?? s.k) + 1;
  // speed check against what this car's validated setup can do (reported speed and actual movement)
  const prev = P.last, moved = prev ? Math.hypot(s.x - prev.x, s.z - prev.z) / Math.max(0.05, (s.k - (prev.k ?? s.k - 1)) * 0.05) : 0;
  if (Math.hypot(s.vx, s.vz) > P.vmax || (moved > P.vmax && !(s.f & 256))) { s.f |= 256; P.fast++; } // not counted: treated like a teleport
  P.lastK = s.k; P.last = s; P.lastAt = now;
  if (M.phase === 'loading') return; // nothing is judged until the countdown has been scheduled
  if (P.fast > 60 && !P.dq) { P.dq = true; send(c, { t: 'error', msg: 'Your car went faster than its setup allows. Your driving is no longer counted in this match.' }); log(`room ${r.code}: ${c.name} exceeded the speed limit of their car (${P.vmax.toFixed(0)} m/s)`); }
  if (P.dq) return;
  if (M.mode === 'challenge') {
    if (M.phase === 'running' && now <= M.endAt) P.judge.push(s, { tandem: tandemFor(M, c.id, s, now) });
  } else if (RACE_MODES.includes(M.mode)) {
    const t = (now - M.startAt) / 1000;
    if (t < 0 && P.slot && !P.jump && Math.hypot(s.x - P.slot.x, s.z - P.slot.z) > 6) { P.jump = true; P.penalty = 3; send(c, { t: 'error', msg: 'Jump start: +3 s penalty' }); }
    // Drift Race: the server judges every competitor's drifting itself from the samples (the browser's
    // numbers are only its live HUD). Points count from GO until the competitor crosses the finish line.
    const J = P.judge, judging = J && M.phase === 'running' && t >= 0 && !P.tracker.finished;
    if (judging) J.push(s, { tandem: tandemFor(M, c.id, s, now) });
    const ev = P.tracker.update({ t, x: s.x, z: s.z, vx: s.vx, vz: s.vz, teleport: !!(s.f & 256) });
    if (J && ev && (ev.type === 'lap' || ev.type === 'finish')) J.scorer.bank(); // the combo banks at every lap line
    if (ev && ev.type === 'finish') { P.finishT = ev.t + (P.penalty || 0); if (J) { J.finish(); P.driftT = t; } checkRaceEnd(r); }
  } else if (M.mode === 'battle') {
    const R = M.round; if (!R || R.ended) return;
    const t = (now - R.startAt) / 1000;
    if (t < 0) return;
    if (c.id === R.lead) R.run.pushLead(s, t); else if (c.id === R.chase) R.run.pushChase(s, t);
    if (R.run.done) endBattleRound(r);
  }
}
function tandemFor(M, id, s, now) {
  if (!(s.f & 1)) return false;
  const sp = Math.hypot(s.vx, s.vz); if (sp < 8) return false;
  for (const o of M.competitors) {
    if (o === id) continue;
    const q = M.p[o].last; if (!q || now - M.p[o].lastAt > 300 || !(q.f & 1)) continue;
    const sq = Math.hypot(q.vx, q.vz); if (sq < 8 || Math.hypot(q.x - s.x, q.z - s.z) > 15) continue;
    if ((q.vx * s.vx + q.vz * s.vz) / (sp * sq) > 0.7) return true;
  }
  return false;
}
function finishChallenge(r) {
  const M = r.match; if (!M || M.phase === 'results') return;
  M.phase = 'results';
  const rows = M.competitors.map((id) => { const P = M.p[id]; const sum = P.judge ? P.judge.finish() : null; return { id, name: P.name, left: !!P.left, ...(sum || {}) }; })
    .filter((x) => x.total !== undefined)
    .sort((a, b) => SH.challengeScore(M.variant, b) - SH.challengeScore(M.variant, a));
  const w = rows.find((x) => SH.challengeScore(M.variant, x) > 0);
  M.result = { t: 'mResult', mode: 'challenge', variant: M.variant, rows, winnerId: w ? w.id : null, matchId: M.id };
  broadcast(r, M.result); broadcastRoom(r); autoLobby(r);
  recordResult(M);
}
function raceRows(M) {
  return M.competitors.map((id) => {
    const P = M.p[id], T = P.tracker, L = P.last;
    const row = { id, name: P.name, lap: T ? T.lap : 0, next: T ? T.next : 0, gates: T ? T.gateCount : 0, finished: !!(T && T.finished), time: P.finishT ?? null, best: T ? T.best : null, left: !!P.left, prog: T ? T.progress(L ? L.x : 0, L ? L.z : 0) : 0, penalty: P.penalty || 0 };
    if (M.mode === 'driftrace') Object.assign(row, driftOf(M, P));
    return row;
  }).sort((a, b) => (b.finished - a.finished) || (a.finished ? a.time - b.time : b.prog - a.prog)).map((x, i) => ({ ...x, pos: i + 1 }));
}
// Drift Race points of one competitor, clamped to a sane rate: no more than DRIFT_RACE.maxRate points
// per second of racing (+ slack), whatever the samples claimed. Disqualified drivers score nothing.
function driftOf(M, P) {
  const J = P.judge; if (!J || P.dq) return { drift: 0, live: 0, mult: 1, capped: false };
  const secs = P.driftT ?? Math.max(0, (Math.min(Date.now(), M.endedAt || Infinity) - M.startAt) / 1000);
  const cap = SH.driftRateCap(secs), raw = J.total, live = J.finished ? 0 : J.live;
  const drift = Math.min(raw, cap);
  return { drift: Math.round(drift), live: Math.round(Math.max(0, Math.min(live, cap - drift))), mult: J.scorer.mult, combo: J.scorer.combo, capped: raw > cap || raw + live > cap };
}
function checkRaceEnd(r) {
  const M = r.match; if (!M || M.phase === 'results') return;
  const active = M.competitors.filter((id) => !M.p[id].left);
  const done = (id) => M.p[id].tracker && M.p[id].tracker.finished;
  if (active.every(done)) later(r, 1500, () => finishRace(r));
  // once somebody has crossed the line, the rest get 60 s to finish (a player leaving doesn't start this)
  else if (!M.firstFinishTimer && M.competitors.some(done)) { M.firstFinishTimer = true; later(r, RACE_REST_MS, () => finishRace(r)); }
}
function finishRace(r) {
  const M = r.match; if (!M || M.phase === 'results') return;
  M.phase = 'results'; M.endedAt = Date.now();
  if (M.mode === 'driftrace') {
    for (const id of M.competitors) { const J = M.p[id].judge; if (J && !J.finished) J.finish(); } // DNF: drift points banked so far still count
    const rows = SH.driftRaceRank(raceRows(M), M.laps);
    M.result = { t: 'mResult', mode: 'driftrace', laps: M.laps, rows, winnerId: rows[0] && rows[0].total > 0 ? rows[0].id : null, matchId: M.id };
    broadcast(r, M.result); broadcastRoom(r); autoLobby(r);
    return recordResult(M);
  }
  const rows = raceRows(M);
  M.result = { t: 'mResult', mode: 'race', laps: M.laps, rows, winnerId: rows[0] && rows[0].finished ? rows[0].id : null, matchId: M.id };
  broadcast(r, M.result); broadcastRoom(r); autoLobby(r);
  recordResult(M);
}
function startBattleRound(r, n) {
  const M = r.match, now = Date.now();
  const [A, B] = M.competitors;
  const lead = n === 1 ? A : B, chase = n === 1 ? B : A;
  const course = SH.battleCourse(M.map);
  M.phase = 'countdown';
  const R = M.round = { n, lead, chase, startAt: now + 5000, run: new SH.BattleRun(course), ended: false };
  R.msg = { t: 'bRound', round: n, leadId: lead, chaseId: chase, startAt: R.startAt };
  M.result = null;
  broadcast(r, R.msg);
  later(r, 5000, () => { if (M.round === R) M.phase = 'running'; });
  later(r, 5000 + (R.run.maxT + 4) * 1000, () => { if (M.round === R) endBattleRound(r); });
  broadcastRoom(r);
}
function endBattleRound(r) {
  const M = r.match, R = M && M.round; if (!R || R.ended) return;
  R.ended = true; R.run.finish((Date.now() - R.startAt) / 1000);
  const res = R.run.result();
  M.results.push(res);
  broadcast(r, { t: 'bRoundEnd', round: R.n, leadId: R.lead, chaseId: R.chase, leadName: M.p[R.lead].name, chaseName: M.p[R.chase].name, result: res });
  if (R.n === 1) later(r, 7000, () => { if (r.match === M && !M.p[M.competitors[0]].left && !M.p[M.competitors[1]].left) startBattleRound(r, 2); });
  else later(r, 6000, () => finishBattle(r));
}
function finishBattle(r, forfeitBy) {
  const M = r.match; if (!M || M.phase === 'results') return;
  M.phase = 'results';
  const [A, B] = M.competitors;
  const zero = { score: 0, raw: 0, parts: {}, penalties: [], penaltyTotal: 0 };
  let a, b, winner;
  if (M.results.length === 2) { const T = SH.battleTotals(M.results[0], M.results[1]); a = T.a; b = T.b; winner = T.winner === 1 ? A : T.winner === 2 ? B : null; }
  else { // forfeit / incomplete
    const r1 = M.results[0];
    a = { lead: r1 ? r1.lead : zero, chase: zero, total: r1 ? r1.lead.score : 0, penalties: r1 ? r1.lead.penaltyTotal : 0 };
    b = { lead: zero, chase: r1 ? r1.chase : zero, total: r1 ? r1.chase.score : 0, penalties: r1 ? r1.chase.penaltyTotal : 0 };
    winner = forfeitBy ? (forfeitBy === A ? B : A) : null;
  }
  M.result = { t: 'mResult', mode: 'battle', a: { id: A, name: M.p[A].name, ...a }, b: { id: B, name: M.p[B].name, ...b }, winnerId: winner, matchId: M.id, forfeit: forfeitBy ? `${M.p[forfeitBy].name} left the battle` : null };
  broadcast(r, M.result); broadcastRoom(r); autoLobby(r);
  if (!forfeitBy) recordResult(M);
}
// after the results, the room goes back to the lobby by itself if the host doesn't pick rematch/lobby,
// so a room can never stay stuck "in game" with the mode settings locked
function autoLobby(r) {
  const M = r.match;
  later(r, RESULTS_AUTO_LOBBY_MS, () => { if (r.match === M && M.phase === 'results') endGame(r); });
}
function competitorLeft(r, id) {
  const M = r.match; if (!M || M.phase === 'results') return;
  M.p[id].left = true;
  if (M.mode === 'battle') finishBattle(r, id);
  else if (RACE_MODES.includes(M.mode)) checkRaceEnd(r);
  else if (M.competitors.every((x) => M.p[x].left)) finishChallenge(r);
}
// periodic match state (4 Hz)
setInterval(() => {
  for (const r of rooms.values()) try {
    const M = r.match; if (!M || M.phase === 'loading' || M.phase === 'results') continue;
    if (M.mode === 'challenge') {
      const rows = M.competitors.filter((id) => M.p[id].judge).map((id) => { const J = M.p[id].judge; const best = Math.max(J.scorer.best, J.live); return { id, name: M.p[id].name, score: Math.round(M.variant === 'attack' ? best : J.total + J.live), total: Math.round(J.total), best: Math.round(J.scorer.best), mult: J.scorer.mult }; });
      broadcast(r, { t: 'mState', mode: 'challenge', rows });
    } else if (RACE_MODES.includes(M.mode)) broadcast(r, { t: 'mState', mode: M.mode, rows: raceRows(M) });
  } catch (e) { console.error(`room ${r.code} state error`, e); }
}, 250);

// records: only completed matches, each match once
function recordResult(M) {
  if (records.matches.includes(M.id)) return;
  records.matches.push(M.id); if (records.matches.length > 500) records.matches.shift();
  const date = new Date().toISOString().slice(0, 10), R = M.result;
  if (M.mode === 'challenge') {
    const C = records.challenge[M.map] = records.challenge[M.map] || { timed: [], attack: [], longest: [], combo: [] };
    for (const x of R.rows) {
      if (x.left || !(x.total > 0 || x.bestChain > 0)) continue;
      top(C[M.variant], { name: x.name, score: SH.challengeScore(M.variant, x), date }, 'score');
      top(C.longest, { name: x.name, m: x.longest, date }, 'm');
      top(C.combo, { name: x.name, mult: x.maxMult, date }, 'mult');
    }
  } else if (M.mode === 'race') {
    const T = records.race[M.map] = records.race[M.map] || { total: {}, lap: [] };
    for (const x of R.rows) {
      if (!x.finished || x.left) continue;
      top(T.total[M.laps] = T.total[M.laps] || [], { name: x.name, time: Math.round(x.time * 1000) / 1000, date }, 'time', 10, true);
      if (x.best) top(T.lap, { name: x.name, time: Math.round(x.best * 1000) / 1000, date }, 'time', 10, true);
    }
  } else if (M.mode === 'driftrace') {
    const T = records.driftrace[M.map] = records.driftrace[M.map] || { score: {}, drift: [] };
    for (const x of R.rows) {
      if (!x.finished || x.left) continue;
      top(T.score[M.laps] = T.score[M.laps] || [], { name: x.name, score: x.total, drift: x.drift, bonus: x.bonus, date }, 'score');
      if (x.drift > 0) top(T.drift, { name: x.name, score: x.drift, laps: M.laps, date }, 'score');
    }
  } else if (M.mode === 'battle') {
    for (const [P, won] of [[R.a, R.winnerId === R.a.id], [R.b, R.winnerId === R.b.id]]) {
      const e = records.battle.players[P.name] = records.battle.players[P.name] || { wins: 0, losses: 0, draws: 0, points: 0, matches: 0 };
      e.matches++; e.points = Math.round((e.points + P.total) * 10) / 10;
      if (!R.winnerId) e.draws++; else if (won) e.wins++; else e.losses++;
    }
  }
  saveRecords();
}
function publicRecords() {
  const battle = Object.entries(records.battle.players).map(([name, e]) => ({ name, ...e, winPct: e.matches ? Math.round((e.wins / e.matches) * 100) : 0 }))
    .sort((a, b) => b.wins - a.wins || b.winPct - a.winPct || b.points - a.points).slice(0, 20);
  return { challenge: records.challenge, race: records.race, driftrace: records.driftrace || {}, battle };
}

// -------------------------------------------------------------
// Connections & messages
// -------------------------------------------------------------
function onConnection(ws) {
  let c = { id: String(nextId++), ws, name: 'Driver', room: null, car: sanitizeCar(null), state: null, score: { total: 0, best: 0, chain: 0 }, wins: 0, msgCount: 0, token: null, suspended: false };
  clients.set(c.id, c);
  ws.onmessage = (text) => {
    if (++c.msgCount > FLOOD_LIMIT) return; // flood guard (reset twice a second)
    let m; try { m = JSON.parse(text); } catch { return; }
    if (!m || typeof m.t !== 'string') return;
    if (!c.token && m.t !== 'hello') return; // nothing counts until the player has said hello
    if (!rateOk(c, m.t)) return;
    try {
      if (m.t === 'hello' && resume(m)) return;
      handle(c, m);
    } catch (e) { console.error('handler error', e); }
  };
  // Resume a dropped session (same player, same room, same score) if the token matches.
  // The old socket may not be flagged as dropped yet (the heartbeat takes up to ~40 s), so a
  // matching token simply takes the session over: the newest connection always wins.
  function resume(m) {
    const old = typeof m.token === 'string' && sessions.get(m.token);
    if (!old || old === c) return false;
    if (c.room) leaveRoom(c); // this connection was already in a room of its own: leave it properly first
    clients.delete(c.id); if (c.token) sessions.delete(c.token);
    clearTimeout(old.dropTimer);
    const prevWs = old.ws;
    old.ws = ws; old.suspended = false; old.msgCount = 0; old.rate = {};
    if (prevWs !== ws && prevWs.open) { // still connected somewhere else (e.g. a second tab): tell it, then close it
      prevWs.onclose = null;
      try { prevWs.send(JSON.stringify({ t: 'replaced' })); } catch { /* ignore */ }
      prevWs.close(4000);
    }
    c = old;
    if (m.name) c.name = cleanText(m.name, 16, c.name);
    send(c, { t: 'welcome', id: c.id, token: c.token, resumed: true, serverTime: Date.now(), boot: BOOT_ID });
    const r = c.room && rooms.get(c.room);
    if (r) {
      send(c, { t: 'joined', room: roomInfo(r), you: c.id, resumed: true });
      if (r.status === 'playing' && !m.inGame) sendGameStart(r, c);
      else if (r.status !== 'playing' && m.inGame) send(c, { t: 'gameEnd' }); // the game ended while we were away
      broadcast(r, { t: 'chat', system: true, text: `${c.name} reconnected` }, c.id);
      broadcastRoom(r);
    } else c.room = null;
    log(`${c.name} resumed session`);
    return true;
  }
  ws.onclose = () => {
    if (c.ws !== ws) return; // an old socket of a resumed session
    if (c.room && rooms.has(c.room) && c.token) {
      // keep the slot for a while so the player can reconnect
      c.suspended = true; c.state = null;
      const r = rooms.get(c.room);
      broadcast(r, { t: 'chat', system: true, text: `${c.name} lost connection…` });
      broadcastRoom(r);
      c.dropTimer = setTimeout(() => {
        if (!c.suspended) return;
        if (c.room) leaveRoom(c);
        clients.delete(c.id); sessions.delete(c.token);
      }, RESUME_GRACE_MS);
    } else {
      if (c.room) leaveRoom(c);
      clients.delete(c.id); if (c.token) sessions.delete(c.token);
    }
  };
}

// per-type cooldowns (token bucket): stops chat spam and create/join/list hammering
function rateOk(c, t) {
  const lim = RATE[t]; if (!lim) return true;
  const now = Date.now(), b = (c.rate = c.rate || {})[t] || (c.rate[t] = { n: lim[1], at: now });
  b.n = Math.min(lim[1], b.n + ((now - b.at) / 1000) * lim[0]); b.at = now;
  if (b.n < 1) return false;
  b.n -= 1; return true;
}
const sane = (v) => { v = Number(v); return Number.isFinite(v) ? Math.min(5e6, Math.max(0, v)) : 0; };

function handle(c, m) {
  const r = c.room ? rooms.get(c.room) : null;
  const isHost = r && r.hostId === c.id;
  switch (m.t) {
    case 'hello':
      c.name = cleanText(m.name, 16, `Driver${c.id}`);
      if (m.car) c.car = sanitizeCar(m.car);
      if (!c.token) { c.token = crypto.randomBytes(12).toString('hex'); sessions.set(c.token, c); }
      // hadToken: the browser asked to resume but that session no longer exists (expired or server restarted)
      send(c, { t: 'welcome', id: c.id, token: c.token, resumed: false, serverTime: Date.now(), boot: BOOT_ID, hadToken: typeof m.token === 'string' && m.token !== c.token });
      break;
    case 'name':
      c.name = cleanText(m.name, 16, c.name);
      if (r) broadcastRoom(r);
      break;
    case 'list':
      send(c, { t: 'rooms', rooms: [...rooms.values()].filter((x) => x.isPublic).map(listInfo) });
      break;
    case 'create': {
      const s = m.settings || {};
      if (!MODES.includes(s.mode)) return send(c, { t: 'error', msg: 'Pick a game mode for the room' });
      if (m.car) c.car = sanitizeCar(m.car);
      const nr = createRoom(c, s);
      joinRoom(c, nr);
      break;
    }
    case 'peek': { // look at a room (mode, map, rules) before joining it
      const pr = rooms.get(cleanText(m.code, 8, '').toUpperCase());
      return send(c, pr ? { t: 'peek', room: { ...listInfo(pr), rounds: pr.rounds, laps: pr.laps, variant: pr.variant } } : { t: 'peek', room: null, code: cleanText(m.code, 8, '').toUpperCase() });
    }
    case 'join': {
      const code = cleanText(m.code, 8, '').toUpperCase();
      const jr = rooms.get(code);
      if (!jr) return send(c, { t: 'error', gone: code, msg: `Room ${code} doesn't exist any more (it closed, or the server restarted). Create a new room.` });
      if (jr.code === c.room) { // already in this room (e.g. re-entering a running game from the lobby)
        send(c, { t: 'joined', room: roomInfo(jr), you: c.id });
        if (jr.status === 'playing') sendGameStart(jr, c);
        return;
      }
      if (jr.players.size >= jr.maxPlayers) return send(c, { t: 'error', msg: 'That room is full' });
      if (m.car) c.car = sanitizeCar(m.car);
      joinRoom(c, jr);
      break;
    }
    case 'leave':
      if (r) leaveRoom(c);
      send(c, { t: 'left' });
      break;
    case 'settings':
      if (!isHost) return send(c, { t: 'error', msg: r ? 'Only the host can change settings' : 'You are not in a room any more' });
      if (r.status !== 'lobby' && m.settings && (m.settings.mode || m.settings.map)) send(c, { t: 'error', msg: 'Mode and map can be changed once the game is back in the lobby' });
      const ch = applySettings(r, m.settings || {}, false);
      // a mode/map change is always announced, so nobody wonders why the room changed
      if (ch.mode || ch.map) broadcast(r, { t: 'chat', system: true, text: `${c.name} (host) set the room to ${MODE_NAMES[r.mode]} on ${r.map}` });
      broadcastRoom(r);
      break;
    case 'car':
      c.car = sanitizeCar(m.car);
      if (r) broadcastRoom(r);
      break;
    case 'start':
      if (!isHost) return send(c, { t: 'error', msg: r ? 'Only the host can start the game' : 'You are not in a room any more' });
      if (r.status !== 'lobby') return send(c, { t: 'error', msg: 'A game is already running — end it first' });
      if (COMP_MODES.includes(r.mode)) { const err = startMatch(r); if (err) send(c, { t: 'error', msg: err }); }
      else startGame(r);
      break;
    case 'rematch':
      if (!isHost) return send(c, { t: 'error', msg: 'Only the host can start a rematch' });
      if (r && r.match && r.match.phase === 'results') { const err = startMatch(r); if (err) send(c, { t: 'error', msg: err }); }
      break;
    case 'ready':
      if (r && r.match && r.match.competitors.includes(c.id)) { r.match.ready.add(c.id); maybeBegin(r); }
      break;
    case 'records':
      send(c, { t: 'records', records: publicRecords() });
      break;
    case 'end':
      if (!isHost || !r || r.status !== 'playing') return;
      endGame(r);
      break;
    case 'st': {
      if (!r || r.status !== 'playing') return;
      const p = Array.isArray(m.p) ? m.p : [];
      c.state = [num(p[0]), num(p[1]), num(p[2]), num(m.h), num(m.vx), num(m.vz), num(m.s), m.f | 0, num(m.sl), num(m.pi), num(m.ro)];
      c.stateAt = Date.now(); c.stateNew = true;
      if (r.match) matchSample(r, c, m);
      break;
    }
    case 'sc':
      if (!r) return;
      // free-play scores are reported by the browser: at least keep them finite and sane
      c.score = { total: sane(m.total), best: sane(m.best), chain: sane(m.chain) };
      break;
    case 'chat':
      if (!r) return;
      broadcast(r, { t: 'chat', from: c.id, name: c.name, text: cleanText(m.text, 120, '') });
      break;
    case 'ping':
      send(c, { t: 'pong', ct: m.ct, st: Date.now() });
      break;
    default:
      break;
  }
}

// Snapshot broadcast — every room's player states.
// Only states that arrived since the last snapshot are sent (a frozen player isn't re-sent as if new),
// each with its age in ms so the browser can place it at the right time.
setInterval(() => {
  const now = Date.now();
  for (const r of rooms.values()) try {
    if (r.status !== 'playing') continue;
    const ps = [];
    for (const id of r.players) {
      const c = clients.get(id);
      if (!c || !c.state || !c.stateNew || c.suspended || (r.match && !r.match.competitors.includes(id))) continue;
      c.stateNew = false;
      ps.push([id, ...c.state, Math.min(1000, now - c.stateAt)]);
    }
    if (ps.length) broadcast(r, { t: 'snap', ts: now, ps });
  } catch (e) { console.error(`room ${r.code} snapshot error`, e); }
}, 1000 / SNAPSHOT_HZ);

// Leaderboard broadcast
setInterval(() => {
  for (const r of rooms.values()) try {
    if (r.status !== 'playing') continue;
    const lb = [...r.players].filter((id) => clients.has(id)).map((id) => { const c = clients.get(id); return { id, name: c.name, score: Math.round(c.score.total + c.score.chain), best: Math.round(c.score.best), wins: c.wins || 0 }; });
    broadcast(r, { t: 'lb', lb });
  } catch (e) { console.error(`room ${r.code} leaderboard error`, e); }
  for (const c of clients.values()) c.msgCount = 0;
}, 500);

// Heartbeat: drop dead connections
setInterval(() => {
  const now = Date.now();
  for (const c of clients.values()) try {
    if (c.suspended) continue;
    if (now - c.ws.lastPong > 30000) c.ws.close(1001);
    else c.ws.ping();
  } catch (e) { console.error('heartbeat error', e); }
}, 10000);

function log(s) { console.log(`[${new Date().toISOString().slice(11, 19)}] ${s}`); }

// Render (and Ctrl+C) stop the server with a signal: warn everyone first, because rooms live in memory
function shutdown() {
  for (const c of clients.values()) send(c, { t: 'serverRestart', msg: 'The multiplayer server is restarting — rooms will be closed.' });
  setTimeout(() => process.exit(0), 300);
}
if (require.main === module) {
  process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);
  ready.then(() => server.listen(PORT, '0.0.0.0', () => {
    console.log(`\n  DRIFT CLUB server running`);
    console.log(`  Open  http://localhost:${PORT}  in your browser`);
    console.log(`  Friends on your network can join via http://<your-ip>:${PORT}\n`);
  })).catch((e) => { console.error('Failed to load shared game rules:', e); process.exit(1); });
}
module.exports = { server, ready };
