// Multiplayer tests: starts its own server(s) on random ports and talks to them with real WebSockets.
// Run:  node tests/multiplayer.test.mjs      (exits with code 1 if anything fails)
import { spawn } from 'node:child_process';
import net from 'node:net';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const randPort = () => 20000 + Math.floor(Math.random() * 30000);

// ---------------------------------------------------------------- server control
async function startServer(env = {}, port = randPort()) {
  const proc = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(port), DATA_DIR: path.join(ROOT, 'tests', '.data'), ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  proc.stdout.on('data', (d) => { out += d; }); proc.stderr.on('data', (d) => { out += d; });
  for (let i = 0; i < 100 && !out.includes('running'); i++) await sleep(50);
  if (!out.includes('running')) throw new Error('server did not start:\n' + out);
  return { port, proc, log: () => out, alive: () => proc.exitCode === null && !proc.killed, stop: () => new Promise((r) => { if (proc.exitCode !== null) return r(); proc.once('exit', r); proc.kill('SIGKILL'); }) };
}
const health = async (port) => (await fetch(`http://localhost:${port}/health`)).json();

// ---------------------------------------------------------------- simple protocol client
class Client {
  constructor(port, name = 'P') { this.port = port; this.name = name; this.msgs = []; this.waiters = []; }
  open(extra = {}) {
    return new Promise((resolve, reject) => {
      const ws = this.ws = new WebSocket(`ws://localhost:${this.port}/ws`);
      ws.onopen = () => ws.send(JSON.stringify({ t: 'hello', name: this.name, car: { id: 'starter' }, ...extra }));
      ws.onmessage = (e) => {
        const m = JSON.parse(e.data); this.msgs.push(m);
        if (m.t === 'welcome') { this.id = m.id; this.token = m.token; this.welcome = m; resolve(this); }
        if (m.t === 'joined' || m.t === 'room') this.room = m.room;
        for (const w of [...this.waiters]) if (w.pred(m)) { this.waiters.splice(this.waiters.indexOf(w), 1); w.res(m); }
      };
      ws.onclose = (e) => { this.closed = e.code || true; reject(new Error('closed before welcome')); };
      ws.onerror = () => {};
    });
  }
  send(m) { this.ws.send(JSON.stringify(m)); }
  wait(pred, ms = 3000, what = '') {
    if (typeof pred === 'string') { const t = pred; what = what || t; pred = (m) => m.t === t; }
    const seen = this.msgs.find((m) => pred(m) && !m._used);
    if (seen) { seen._used = true; return Promise.resolve(seen); }
    return new Promise((res, rej) => {
      const w = { pred, res: (m) => { m._used = true; clearTimeout(w.t); res(m); } };
      w.t = setTimeout(() => { this.waiters.splice(this.waiters.indexOf(w), 1); rej(new Error(`${this.name}: timed out waiting for ${what || 'message'}`)); }, ms);
      this.waiters.push(w);
    });
  }
  clear() { this.msgs = []; }
  close() { try { this.ws.close(); } catch { /* */ } }
}
const client = async (port, name, extra) => new Client(port, name).open(extra);

// ---------------------------------------------------------------- the browser's Net class, run in Node
globalThis.sessionStorage = { m: {}, getItem(k) { return this.m[k] ?? null; }, setItem(k, v) { this.m[k] = String(v); }, removeItem(k) { delete this.m[k]; } };
globalThis.location = { protocol: 'http:', host: 'localhost' };
const { Net } = await import(path.join(ROOT, 'public', 'js', 'net.js'));
function browserNet(port) {
  sessionStorage.m = {}; // each "browser tab" starts fresh
  const n = new Net(); n.events = [];
  for (const t of ['reconnecting', 'reconnected', 'roomLost', 'disconnect', 'joined', 'error', 'host', 'replaced', 'gameStart', 'gameEnd']) n.on(t, (m) => n.events.push({ t, m }));
  n.custom = `localhost:${port}`;
  n.go = () => n.connect('Owner', { id: 'starter' }, n.custom);
  return n;
}
const until = async (fn, ms = 5000, what = 'condition') => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return; await sleep(50); } throw new Error('timed out: ' + what); };

// ---------------------------------------------------------------- tiny test runner
const results = [];
async function test(name, fn) {
  const t0 = Date.now();
  try { await fn(); results.push([true, name]); console.log(`  ok   ${name} (${Date.now() - t0} ms)`); }
  catch (e) { results.push([false, name]); console.log(`  FAIL ${name}\n       ${e.stack.split('\n').slice(0, 3).join('\n       ')}`); }
}
function eq(a, b, msg) { if (a !== b) throw new Error(`${msg}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }
function ok(v, msg) { if (!v) throw new Error(msg); }

const RACE = { mode: 'race', map: 'track', laps: 3, isPublic: false };
async function raceRoom(port) {
  const host = await client(port, 'Host'), friend = await client(port, 'Friend');
  host.send({ t: 'create', settings: RACE }); const j = await host.wait('joined');
  friend.send({ t: 'join', code: j.room.code }); await friend.wait('joined');
  await host.wait((m) => m.t === 'room' && m.room.players.length === 2, 3000, 'room with 2 players');
  return { host, friend, code: j.room.code };
}

// ================================================================ tests
const S = await startServer({ RESULTS_AUTO_LOBBY_MS: '1200', RACE_REST_MS: '1500' });
const P = S.port;
console.log(`server on ${P}`);

await test('race room: create, join, start -> both get Speed Race', async () => {
  const { host, friend } = await raceRoom(P);
  eq(friend.room.mode, 'race', 'friend sees mode'); eq(host.room.mode, 'race', 'host sees mode after join');
  host.send({ t: 'start' });
  eq((await host.wait('gameStart')).mode, 'race', 'host gameStart'); eq((await friend.wait('gameStart')).mode, 'race', 'friend gameStart');
  host.close(); friend.close();
});

await test('create without a valid mode is refused (no silent Endless room)', async () => {
  const a = await client(P, 'A');
  const before = (await health(P)).rooms;
  a.send({ t: 'create', settings: { map: 'track' } });
  ok(/mode/i.test((await a.wait('error')).msg), 'error mentions mode');
  eq((await health(P)).rooms, before, 'no room created');
  a.send({ t: 'create', settings: { mode: 'speedrace' } }); await a.wait('error');
  a.close();
});

await test('BUG: reconnect + UI connect at the same time keeps the race room and the host role', async () => {
  // Before the fix: the UI's connect() opened a 2nd socket while autoReconnect was running; the later
  // "welcome" replaced the session, the room view was wiped (room=null) and the real host session
  // timed out 30 s later -> host role moved to the friend / room lost.
  const owner = browserNet(P);
  await owner.go();
  owner.send({ t: 'create', settings: RACE });
  await until(() => owner.room, 3000, 'owner in room');
  const code = owner.room.code, id = owner.id;
  const friend = await client(P, 'Friend'); friend.send({ t: 'join', code }); await friend.wait('joined');
  const players0 = (await health(P)).players;
  owner.ws.close(); // Wi-Fi blip -> autoReconnect starts
  await sleep(20);
  ok(owner.reconnecting, 'owner is reconnecting');
  const p = owner.go(); // e.g. the player clicks Join/Create/Multiplayer while the banner is up
  await p; await sleep(2500);
  ok(owner.room && owner.room.code === code, 'owner still sees the race room');
  eq(owner.room.mode, 'race', 'room still Speed Race');
  eq(owner.id, id, 'same session id');
  eq(owner.room.hostId, id, 'owner still host');
  eq((await health(P)).players, players0, 'no duplicate session on the server');
  ok(!owner.events.some((e) => e.t === 'roomLost'), 'no room lost');
  owner.close(); friend.close();
});

await test('BUG: resume while the old socket is not flagged dropped yet -> same session, still host', async () => {
  const { host, friend, code } = await raceRoom(P);
  // the host's page reloads/reconnects but the server hasn't noticed the old socket died
  const again = await client(P, 'Host', { token: host.token });
  eq(again.welcome.resumed, true, 'resumed');
  eq(again.id, host.id, 'same id');
  const j = await again.wait('joined'); eq(j.room.code, code, 'same room'); eq(j.room.hostId, host.id, 'still host'); eq(j.room.mode, 'race', 'still race');
  await host.wait('replaced', 2000); // the old connection is told and closed
  await until(() => host.closed, 3000, 'old socket closed');
  again.send({ t: 'settings', settings: { laps: 5 } });
  eq((await friend.wait((m) => m.t === 'room' && m.room.laps === 5)).room.mode, 'race', 'host can still change settings');
  eq(j.room.players.length, 2, 'no ghost player');
  again.close(); friend.close();
});

await test('resume after a real drop (within the grace period)', async () => {
  const { host, friend, code } = await raceRoom(P);
  host.close(); await friend.wait((m) => m.t === 'chat' && /lost connection/.test(m.text));
  const again = await client(P, 'Host', { token: host.token });
  eq(again.welcome.resumed, true, 'resumed'); eq((await again.wait('joined')).room.code, code, 'same room');
  again.close(); friend.close();
});

await test('BUG: host leaves to the lobby during a race -> host can end it and change the mode again', async () => {
  const { host, friend } = await raceRoom(P);
  host.send({ t: 'start' }); await host.wait('gameStart');
  host.send({ t: 'settings', settings: { mode: 'endless' } });
  ok(/back in the lobby/.test((await host.wait('error')).msg), 'mode change while playing is refused with a reason');
  host.send({ t: 'start' }); await host.wait('error'); // start while running -> explained, not silently ignored
  host.send({ t: 'end' }); await friend.wait('gameEnd');
  await host.wait((m) => m.t === 'room' && m.room.status === 'lobby');
  friend.clear();
  host.send({ t: 'settings', settings: { mode: 'challenge' } });
  eq((await friend.wait((m) => m.t === 'room' && m.room.mode === 'challenge')).room.status, 'lobby', 'mode changed');
  ok(/set the room to Drift Challenge/.test((await friend.wait((m) => m.t === 'chat' && m.system)).text), 'change is announced');
  host.close(); friend.close();
});

await test('a friend joining mid-race spectates; the room stays Speed Race', async () => {
  const host = await client(P, 'Host'); host.send({ t: 'create', settings: RACE }); const j = await host.wait('joined');
  host.send({ t: 'start' }); await host.wait('gameStart');
  const friend = await client(P, 'Friend'); friend.send({ t: 'join', code: j.room.code });
  const gs = await friend.wait('gameStart'); eq(gs.mode, 'race', 'mode'); eq(gs.spectator, true, 'spectator');
  host.close(); friend.close();
});

await test('host handover is announced and the new host can change the mode', async () => {
  const { host, friend } = await raceRoom(P);
  host.send({ t: 'leave' });
  const h = await friend.wait('host'); eq(h.id, friend.id, 'friend is new host'); eq(h.prev, 'Host', 'previous host named');
  friend.send({ t: 'settings', settings: { mode: 'endless' } });
  eq((await friend.wait((m) => m.t === 'room' && m.room.mode === 'endless')).room.hostId, friend.id, 'new host changed mode');
  host.close(); friend.close();
});

await test('joining a room that no longer exists says so (no other room)', async () => {
  const a = await client(P, 'A'); a.send({ t: 'join', code: 'ZZZZZ' });
  const e = await a.wait('error'); eq(e.gone, 'ZZZZZ', 'gone flag'); ok(/doesn't exist/.test(e.msg), 'clear message');
  eq(a.room, undefined, 'not in any room'); a.close();
});

await test('one player leaving a race does not start the 60 s finish timer', async () => {
  const { host, friend } = await raceRoom(P);
  host.send({ t: 'start' }); await host.wait('gameStart'); await friend.wait('gameStart');
  host.send({ t: 'ready' }); friend.send({ t: 'ready' }); await host.wait('mStart');
  friend.send({ t: 'leave' });
  await sleep(2500); // RACE_REST_MS is 1.5 s in this test server
  ok(!host.msgs.some((m) => m.t === 'mResult'), 'race not ended just because someone left');
  host.close(); friend.close();
});

await test('finished match returns to the lobby by itself (room never stuck "in game")', async () => {
  const a = await client(P, 'A'), b = await client(P, 'B');
  a.send({ t: 'create', settings: { mode: 'battle', map: 'track' } }); const j = await a.wait('joined');
  b.send({ t: 'join', code: j.room.code }); await b.wait('joined');
  a.send({ t: 'start' }); await a.wait('gameStart');
  b.send({ t: 'leave' }); // forfeit -> results
  await a.wait('mResult');
  await a.wait('gameEnd', 3000); // RESULTS_AUTO_LOBBY_MS is 1.2 s here
  eq((await a.wait((m) => m.t === 'room' && m.room.status === 'lobby')).room.mode, 'battle', 'mode unchanged');
  a.close(); b.close();
});

await test('CRASH: second hello with another session token while in a room does not kill the server', async () => {
  const x = await client(P, 'X'); x.send({ t: 'create', settings: { mode: 'endless', map: 'track' } }); await x.wait('joined');
  x.close(); await sleep(150); // X is now suspended (keeps its slot)
  const y = await client(P, 'Y'); y.send({ t: 'create', settings: { mode: 'endless', map: 'track' } }); await y.wait('joined');
  y.send({ t: 'start' }); await y.wait('gameStart');
  y.send({ t: 'st', p: [1, 2, 3], h: 0, vx: 0, vz: 0 });
  y.send({ t: 'hello', name: 'Y', token: x.token }); // resume X on Y's socket while Y is still in its room
  await sleep(1200); // several snapshot + leaderboard ticks
  ok(S.alive(), 'server still running');
  ok((await health(P)).ok, 'health ok');
  y.close();
});

await test('messages before hello are ignored', async () => {
  const ws = new WebSocket(`ws://localhost:${P}/ws`); const got = [];
  await new Promise((r) => { ws.onopen = r; }); ws.onmessage = (e) => got.push(JSON.parse(e.data));
  const before = (await health(P)).rooms;
  ws.send(JSON.stringify({ t: 'create', settings: { mode: 'race', map: 'track' } })); await sleep(300);
  eq((await health(P)).rooms, before, 'no room'); eq(got.length, 0, 'no reply'); ws.close();
});

await test('flood limits: chat is rate limited, sc values are clamped', async () => {
  const a = await client(P, 'A'), b = await client(P, 'B');
  a.send({ t: 'create', settings: { mode: 'endless', map: 'track' } }); const j = await a.wait('joined');
  b.send({ t: 'join', code: j.room.code }); await b.wait('joined'); b.clear();
  for (let i = 0; i < 100; i++) a.send({ t: 'chat', text: 'spam ' + i });
  await sleep(600);
  const n = b.msgs.filter((m) => m.t === 'chat' && !m.system).length;
  ok(n >= 1 && n <= 4, `chat limited (got ${n})`);
  a.send({ t: 'start' }); await a.wait('gameStart'); await sleep(600);
  a.send({ t: 'sc', total: 1e300, best: 'NaN', chain: -5 }); await sleep(700);
  const lb = [...b.msgs].reverse().find((m) => m.t === 'lb'); const me = lb.lb.find((p) => p.id === a.id);
  ok(me.score <= 5e6 && Number.isFinite(me.score), `score clamped (${me.score})`);
  a.close(); b.close();
});

await test('snapshots: a player state is sent once (not re-sent stale every tick) with its age', async () => {
  const a = await client(P, 'A'), b = await client(P, 'B');
  a.send({ t: 'create', settings: { mode: 'endless', map: 'track' } }); const j = await a.wait('joined');
  b.send({ t: 'join', code: j.room.code }); await b.wait('joined');
  a.send({ t: 'start' }); await a.wait('gameStart'); b.clear();
  a.send({ t: 'st', p: [5, 0, 5], h: 1, vx: 0, vz: 0 });
  await sleep(500);
  const snaps = b.msgs.filter((m) => m.t === 'snap' && m.ps.some((p) => p[0] === a.id));
  eq(snaps.length, 1, 'state sent once');
  const p = snaps[0].ps.find((x) => x[0] === a.id); ok(p.length === 13 && p[12] >= 0 && p[12] <= 1000, 'age included');
  a.close(); b.close();
});

await test('fragmented message larger than 64 KB closes the connection (1009)', async () => {
  const code = await new Promise((resolve) => {
    const s = net.connect(P, 'localhost', () => {
      s.write(`GET /ws HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${crypto.randomBytes(16).toString('base64')}\r\nSec-WebSocket-Version: 13\r\n\r\n`);
      const frame = (op, fin, len) => { const h = Buffer.from([(fin ? 0x80 : 0) | op, 0x80 | 126, len >> 8, len & 255, 0, 0, 0, 0]); return Buffer.concat([h, Buffer.alloc(len, 0x20)]); };
      setTimeout(() => { s.write(frame(0x1, false, 60000)); for (let i = 0; i < 3; i++) s.write(frame(0x0, false, 60000)); }, 100);
    });
    let buf = Buffer.alloc(0);
    s.on('data', (d) => { buf = Buffer.concat([buf, d]); const i = buf.indexOf(Buffer.from([0x88, 0x02])); if (i >= 0 && buf.length >= i + 4) { resolve(buf.readUInt16BE(i + 2)); s.destroy(); } });
    s.on('close', () => resolve('closed without close frame'));
    setTimeout(() => resolve('timeout'), 3000);
  });
  eq(code, 1009, 'close code');
});

await test('restart: client is told clearly that its room is gone (not dropped into another room)', async () => {
  const R = await startServer();
  const owner = browserNet(R.port); await owner.go();
  owner.send({ t: 'create', settings: RACE }); await until(() => owner.room, 3000, 'in room');
  const code = owner.room.code;
  const port = R.port; await R.stop();
  const R2 = await startServer({}, port); // the free host restarts: every room is wiped
  await until(() => owner.events.some((e) => e.t === 'roomLost'), 15000, 'roomLost');
  const e = owner.events.find((x) => x.t === 'roomLost').m;
  eq(e.code, code, 'names the room'); eq(e.reason, 'restart', 'knows it was a restart');
  eq(owner.room, null, 'not in any room');
  ok(!owner.events.some((x) => x.t === 'joined' && x.m.room.code !== code), 'never joined another room');
  owner.close(); await R2.stop();
});

await test('dead socket: a silent connection is detected and the session resumes (still host)', async () => {
  const R = await startServer();
  const owner = browserNet(R.port); await owner.go();
  owner.send({ t: 'create', settings: RACE }); await until(() => owner.room, 3000, 'in room');
  const id = owner.id, code = owner.room.code;
  R.proc.kill('SIGSTOP'); // server goes silent (like a dead Wi-Fi link): no close, no messages
  await until(() => owner.events.some((e) => e.t === 'reconnecting'), 12000, 'client noticed the dead connection');
  R.proc.kill('SIGCONT');
  await until(() => owner.connected && owner.room, 15000, 'reconnected');
  eq(owner.id, id, 'same session'); eq(owner.room.code, code, 'same room'); eq(owner.room.hostId, id, 'still host'); eq(owner.room.mode, 'race', 'still race');
  owner.close(); await R.stop();
});

await test('connections per IP are capped', async () => {
  const R = await startServer({ MAX_PER_IP: '3' });
  const cs = []; for (let i = 0; i < 3; i++) cs.push(await client(R.port, 'C' + i));
  const extra = new Client(R.port, 'X'); let refused = false;
  try { await extra.open(); } catch { refused = true; }
  ok(refused, '4th connection refused');
  ok(extra.msgs.some((m) => m.t === 'error' && /Too many/.test(m.msg)), 'told why');
  cs.forEach((c) => c.close()); await R.stop();
});

await test('static files: no access outside public/', async () => {
  const r = await fetch(`http://localhost:${P}/..%2fserver.js`); eq(r.status, 403, 'traversal blocked');
  eq((await fetch(`http://localhost:${P}/`)).status, 200, 'index served');
});

// ---------------------------------------------------------------- Drift Race
const TR = await import(path.join(ROOT, 'public', 'js', 'tracks.js'));
const JD = await import(path.join(ROOT, 'public', 'js', 'judge.js'));
const DRIFT = { mode: 'driftrace', map: 'city', laps: 1, isPublic: false };
// scripted driver: follows the race line from its grid slot at `speed` m/s, sending 20 Hz samples in real time.
// angle(t) = heading offset from the direction of travel (radians); drifting flag set when it's non-zero.
function driveRoute(cl, map, grid, { speed = 40, angle = () => 0, startAt }) {
  const route = TR.raceRoute(map), P = route.path, n = P.n, row = Math.floor(grid / 2), lane = grid % 2 ? -1 : 1, off = lane * route.width * 0.22;
  let idx = -(3 + row * 3), k = 0, stop = false;
  const at = (fi) => { const i0 = Math.floor(fi), f = fi - i0, a = ((i0 % n) + n) % n, b = (a + 1) % n; return { x: P.x[a] + (P.x[b] - P.x[a]) * f - P.tz[a] * off, z: P.z[a] + (P.z[b] - P.z[a]) * f + P.tx[a] * off }; };
  const tick = () => {
    if (stop) return;
    const t = (Date.now() - startAt) / 1000, go = t >= 0;
    const a = at(idx), b = at(idx + 0.5), dir = Math.atan2(b.x - a.x, b.z - a.z), v = go ? speed : 0;
    const ang = go ? angle(t) : 0;
    cl.send({ t: 'st', k: ++k, p: [a.x, 0, a.z], h: dir + ang, vx: Math.sin(dir) * v, vz: Math.cos(dir) * v, f: ang ? 1 : 0, sl: ang });
    if (go) idx += (speed * 0.05) / 3;
  };
  const id = setInterval(tick, 50);
  return { stop: () => { stop = true; clearInterval(id); } };
}
async function driftRoom(port, settings = DRIFT) {
  const host = await client(port, 'Host'), friend = await client(port, 'Friend');
  host.send({ t: 'create', settings }); const j = await host.wait('joined');
  friend.send({ t: 'join', code: j.room.code }); await friend.wait('joined');
  await host.wait((m) => m.t === 'room' && m.room.players.length === 2, 3000, 'room with 2 players');
  return { host, friend, code: j.room.code };
}

await test('drift race room: stays Drift Race when a friend joins, on start, and after back to lobby', async () => {
  const { host, friend } = await driftRoom(P, { ...DRIFT, map: 'track', laps: 4 });
  eq(friend.room.mode, 'driftrace', 'friend sees Drift Race'); eq(host.room.mode, 'driftrace', 'host still Drift Race after join'); eq(host.room.laps, 4, 'laps kept');
  host.send({ t: 'start' });
  const gs = await friend.wait('gameStart'); eq(gs.mode, 'driftrace', 'gameStart mode'); eq(gs.comp.laps, 4, 'laps sent'); eq(gs.spectator, false, 'friend competes');
  eq((await host.wait('gameStart')).mode, 'driftrace', 'host gameStart');
  host.send({ t: 'ready' }); friend.send({ t: 'ready' });
  eq((await host.wait('mStart')).mode, 'driftrace', 'match started as Drift Race');
  const st = await host.wait((m) => m.t === 'mState', 3000, 'mState'); eq(st.mode, 'driftrace', 'live state mode'); ok(st.rows.every((r) => 'drift' in r), 'rows carry drift points');
  host.send({ t: 'end' }); await friend.wait('gameEnd');
  eq((await friend.wait((m) => m.t === 'room' && m.room.status === 'lobby')).room.mode, 'driftrace', 'back in the lobby: still Drift Race');
  const late = await client(P, 'Late'); late.send({ t: 'join', code: host.room.code });
  eq((await late.wait('joined')).room.mode, 'driftrace', 'a third player joining the lobby sees Drift Race');
  eq((await host.wait((m) => m.t === 'room' && m.room.players.length === 3)).room.mode, 'driftrace', 'host still Drift Race');
  host.send({ t: 'settings', settings: { laps: 2 } });
  eq((await friend.wait((m) => m.t === 'room' && m.room.laps === 2)).room.mode, 'driftrace', 'host can change laps; mode unchanged');
  host.close(); friend.close(); late.close();
});

await test('drift race: a map without a circuit is refused like Speed Race', async () => {
  const a = await client(P, 'A'); a.send({ t: 'create', settings: { ...DRIFT, map: 'mountain' } }); await a.wait('joined');
  a.send({ t: 'start' }); ok(/race circuit/.test((await a.wait('error')).msg), 'explains why');
  a.close();
});

await test('drift race results: drift points + position bonus (a drifter finishing 2nd beats a grip racer finishing 1st)', async () => {
  const R = await startServer({ RACE_REST_MS: '8000' });
  const { host, friend } = await driftRoom(R.port);
  host.send({ t: 'start' });
  const gh = await host.wait('gameStart'), gf = await friend.wait('gameStart');
  host.send({ t: 'ready' }); friend.send({ t: 'ready' });
  const ms = await host.wait('mStart');
  // host = grip racer (faster); friend = drifter (slower, holds a steady 30° slide)
  const d1 = driveRoute(host, 'city', gh.grid, { speed: 46, startAt: ms.startAt });
  const d2 = driveRoute(friend, 'city', gf.grid, { speed: 43, startAt: ms.startAt, angle: () => 0.52 });
  const res = await host.wait('mResult', 60000, 'drift race result');
  d1.stop(); d2.stop();
  eq(res.mode, 'driftrace', 'result mode');
  const H = res.rows.find((r) => r.id === host.id), Fr = res.rows.find((r) => r.id === friend.id);
  ok(H.finished && Fr.finished, 'both finished');
  eq(H.racePos, 1, 'racer crossed the line first'); eq(Fr.racePos, 2, 'drifter second');
  eq(H.drift, 0, 'no drift points without drifting');
  ok(Fr.drift > 0, `drifter earned drift points (${Fr.drift})`);
  eq(H.bonus, JD.driftRaceBonus(1, 1, true), 'P1 bonus'); eq(Fr.bonus, JD.driftRaceBonus(2, 1, true), 'P2 bonus');
  eq(H.total, H.drift + H.bonus, 'total = drift + bonus'); eq(Fr.total, Fr.drift + Fr.bonus, 'total = drift + bonus');
  ok(Fr.drift <= JD.driftRateCap(Fr.time + 1), 'within the rate cap');
  eq(res.rows[0].id, friend.id, 'the drifter wins overall'); eq(res.winnerId, friend.id, 'winnerId');
  eq((await friend.wait('mResult')).winnerId, friend.id, 'friend sees the same result');
  const recs = await (await fetch(`http://localhost:${R.port}/records`)).json();
  ok(recs.driftrace && recs.driftrace.city && recs.driftrace.city.score['1'].length === 2, 'online Drift Race records saved');
  // host goes back to the lobby: the room is still Drift Race
  host.send({ t: 'end' }); eq((await friend.wait((m) => m.t === 'room' && m.room.status === 'lobby')).room.mode, 'driftrace', 'still Drift Race');
  host.close(); friend.close(); await R.stop();
});

await test('drift race anti-cheat: absurd drift reports are clamped to a sane rate', async () => {
  const a = await client(P, 'Cheater');
  a.send({ t: 'create', settings: { ...DRIFT, laps: 3 } }); await a.wait('joined');
  a.send({ t: 'start' }); const gs = await a.wait('gameStart'); a.send({ t: 'ready' });
  const ms = await a.wait('mStart');
  a.send({ t: 'sc', total: 1e300, best: 1e300, chain: 1e300 }); // free-play score reports are ignored here
  // spoofed samples: spinning 2 turns a second at speed (each 360 is a big trick bonus)
  const d = driveRoute(a, 'city', gs.grid, { speed: 22, startAt: ms.startAt, angle: (t) => (t * 12) % (Math.PI * 2) - Math.PI });
  await sleep(Math.max(0, ms.startAt - Date.now()) + 7000);
  const st = await a.wait((m) => m.t === 'mState' && m.rows[0].capped, 3000, 'capped state');
  const me = st.rows[0], secs = (Date.now() - ms.startAt) / 1000;
  ok(me.capped, 'flagged as capped');
  ok(me.drift + me.live <= JD.driftRateCap(secs) + 1, `drift ${me.drift}+${me.live} within cap ${JD.driftRateCap(secs)}`);
  ok(Number.isFinite(me.drift) && me.drift < 1e6, 'finite and small');
  d.stop(); a.send({ t: 'leave' }); a.close();
});

ok(S.alive(), 'main server survived all tests');
await S.stop();
const failed = results.filter((r) => !r[0]);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
