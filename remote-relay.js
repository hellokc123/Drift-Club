// Computer Remote relay (https://github.com/hellokc123/Computer-Remote)
// Lets a phone tell a PC helper to open apps/games. Both sides only make OUTGOING requests to this
// server, so the PC needs no open port, no firewall rule and no admin rights.
// Security: every request carries a long random pairing key in the X-Remote-Key header (never in the
// URL). The server only stores a SHA-256 of it. The PC only runs actions from its own allow-list.
const crypto = require('crypto');

const pcs = new Map(); // keyHash -> { status, lastSeen, queue: [], waiter, log: [] }
const MAX_PCS = 200, MAX_QUEUE = 10, CMD_TTL = 60000, POLL_MS = 25000;

function pcFor(req) {
  const key = String(req.headers['x-remote-key'] || '');
  if (!/^[A-Za-z0-9_-]{32,128}$/.test(key)) return null;
  const h = crypto.createHash('sha256').update(key).digest('hex');
  let pc = pcs.get(h);
  if (!pc) {
    if (pcs.size >= MAX_PCS) { // drop the stalest entry
      let old = null; for (const [k, v] of pcs) if (!old || v.lastSeen < old[1].lastSeen) old = [k, v];
      if (old) pcs.delete(old[0]);
    }
    pc = { status: null, lastSeen: 0, queue: [], waiter: null, log: [] };
    pcs.set(h, pc);
  }
  return pc;
}
function send(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}
function readJson(req, cb) {
  let body = '', size = 0;
  req.on('data', (d) => { size += d.length; if (size > 200000) { req.destroy(); return; } body += d; });
  req.on('end', () => { let j = {}; try { j = JSON.parse(body || '{}'); } catch {} cb(j); });
}
const clean = (s, n = 80) => String(s == null ? '' : s).slice(0, n);
function flush(pc) {
  if (!pc.waiter) return;
  const now = Date.now();
  pc.queue = pc.queue.filter((c) => now - c.at < CMD_TTL);
  if (!pc.queue.length) return;
  const { res, timer } = pc.waiter; pc.waiter = null; clearTimeout(timer);
  const cmds = pc.queue.splice(0).map(({ id, action }) => ({ id, action }));
  send(res, 200, { cmds });
}

// returns true when it handled the request
function handleRemote(req, res, url) {
  if (url !== '/remote/api/agent' && url !== '/remote/api/phone') return false;
  if (req.method !== 'POST') { send(res, 405, { error: 'POST only' }); return true; }
  const pc = pcFor(req);
  if (!pc) { send(res, 401, { error: 'Bad pairing key' }); return true; }
  readJson(req, (j) => {
    if (url === '/remote/api/agent') { // the PC helper: report status + results, then long-poll for commands
      pc.lastSeen = Date.now();
      if (j.status && typeof j.status === 'object') {
        const list = (a) => (Array.isArray(a) ? a.slice(0, 300).map((x) => ({ id: clean(x.id, 60), name: clean(x.name), group: clean(x.group, 20) })) : []);
        pc.status = { name: clean(j.status.name, 40), actions: list(j.status.actions) };
      }
      if (Array.isArray(j.done)) for (const d of j.done.slice(0, 20)) { pc.log.unshift({ t: Date.now(), msg: clean(d.msg, 160), ok: !!d.ok }); pc.log.length = Math.min(pc.log.length, 15); }
      if (pc.waiter) { clearTimeout(pc.waiter.timer); send(pc.waiter.res, 200, { cmds: [] }); }
      const timer = setTimeout(() => { if (pc.waiter && pc.waiter.res === res) { pc.waiter = null; send(res, 200, { cmds: [] }); } }, j.wait === false ? 0 : POLL_MS);
      pc.waiter = { res, timer };
      res.on('close', () => { if (pc.waiter && pc.waiter.res === res) { clearTimeout(timer); pc.waiter = null; } });
      flush(pc);
      return;
    }
    // the phone: optionally queue an action, then get status
    if (j.action) {
      const action = clean(j.action, 60);
      if (!pc.status || !pc.status.actions.some((a) => a.id === action)) return send(res, 400, { error: 'Unknown action' });
      if (pc.queue.length >= MAX_QUEUE) return send(res, 429, { error: 'Too many at once, wait a sec' });
      pc.queue.push({ id: crypto.randomBytes(6).toString('hex'), action, at: Date.now() });
      flush(pc);
    }
    send(res, 200, { online: !!pc.waiter || Date.now() - pc.lastSeen < 40000, lastSeen: pc.lastSeen, status: pc.status, log: pc.log, queued: pc.queue.length });
  });
  return true;
}
module.exports = { handleRemote };
