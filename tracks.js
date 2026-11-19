// Shared track geometry + competition rules. Pure JS (no DOM/WebGL) so the SAME code
// runs in the browser and on the Node server — that is what lets the server validate
// checkpoints, laps, off-track penalties and battle courses instead of trusting clients.
//
//  - GEO:        road control points / widths / pads for every map (maps.js renders these)
//  - RACE:       circuit routes with checkpoint gates (Speed Race)
//  - BATTLE:     tandem battle courses (Competitive Drift Battle)
//  - TrackGeo:   "how far off the track is this point?" (off-track penalties)
//  - RaceTracker: ordered checkpoint / lap validation (anti-skip, anti-teleport)

// ------------------------------------------------------------------ geometry helpers
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;

// Centripetal Catmull-Rom spline through control points, resampled every `step` metres.
export function crSample(ctrl, closed, step) {
  const n = ctrl.length, raw = [];
  const P = (i) => {
    if (closed) return ctrl[((i % n) + n) % n];
    if (i < 0) return [2 * ctrl[0][0] - ctrl[1][0], 2 * ctrl[0][1] - ctrl[1][1]];
    if (i >= n) return [2 * ctrl[n - 1][0] - ctrl[n - 2][0], 2 * ctrl[n - 1][1] - ctrl[n - 2][1]];
    return ctrl[i];
  };
  const segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2);
    const d = (a, b) => Math.max(1e-3, Math.pow(Math.hypot(b[0] - a[0], b[1] - a[1]), 0.5));
    const t0 = 0, t1 = d(p0, p1), t2 = t1 + d(p1, p2), t3 = t2 + d(p2, p3);
    const m = Math.max(4, Math.ceil(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / 1.5));
    for (let k = 0; k < m; k++) {
      const t = lerp(t1, t2, k / m);
      const L = (a, b, ta, tb) => [((tb - t) * a[0] + (t - ta) * b[0]) / (tb - ta), ((tb - t) * a[1] + (t - ta) * b[1]) / (tb - ta)];
      const A1 = L(p0, p1, t0, t1), A2 = L(p1, p2, t1, t2), A3 = L(p2, p3, t2, t3);
      const B1 = L(A1, A2, t0, t2), B2 = L(A2, A3, t1, t3);
      raw.push(L(B1, B2, t1, t2));
    }
  }
  if (!closed) raw.push(ctrl[n - 1]);
  return resample(raw, closed, step);
}
// Uniform resampling of a polyline
export function resample(raw, closed, step) {
  const out = [raw[0]]; let acc = 0;
  const pts = closed ? [...raw, raw[0]] : raw;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i]; const seg = Math.hypot(b[0] - a[0], b[1] - a[1]); let s = 0;
    while (acc + seg - s >= step) {
      const need = step - acc; s += need; acc = 0;
      const t = s / Math.hypot(b[0] - a[0], b[1] - a[1]);
      out.push([lerp(a[0], b[0], t), lerp(a[1], b[1], t)]);
    }
    acc += seg - s;
  }
  if (closed) { const l = out[out.length - 1]; if (Math.hypot(l[0] - out[0][0], l[1] - out[0][1]) < step * 0.5) out.pop(); }
  else if (acc > step * 0.3) out.push(raw[raw.length - 1]);
  return out;
}
export function segDist(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1e-9;
  const t = clamp(((px - ax) * dx + (pz - az) * dz) / l2, 0, 1);
  return [Math.hypot(px - (ax + dx * t), pz - (az + dz * t)), t];
}
export function wrapAngle(a) { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; }

// A sampled path with tangents (3 m spacing — identical to how maps.js samples roads)
export function samplePath(pts, closed, { linear = false } = {}) {
  const s = linear ? resample(pts, closed, 3) : crSample(pts, closed, 3);
  const n = s.length, x = new Float64Array(n), z = new Float64Array(n), tx = new Float64Array(n), tz = new Float64Array(n);
  s.forEach((p, i) => { x[i] = p[0]; z[i] = p[1]; });
  for (let i = 0; i < n; i++) {
    const a = closed ? (i - 1 + n) % n : Math.max(0, i - 1), b = closed ? (i + 1) % n : Math.min(n - 1, i + 1);
    const dx = x[b] - x[a], dz = z[b] - z[a], l = Math.hypot(dx, dz) || 1;
    tx[i] = dx / l; tz[i] = dz / l;
  }
  return { n, x, z, tx, tz, closed };
}

// ------------------------------------------------------------------ map geometry (rendered by maps.js)
const CITY_B = 90, CITY_ST = 16, CITY_K = 4;
function cityRoads() {
  const roads = [];
  for (let i = -CITY_K; i <= CITY_K; i++) {
    const v = i * CITY_B;
    roads.push({ pts: [[v, -CITY_K * CITY_B], [v, 0], [v, CITY_K * CITY_B]], width: CITY_ST });
    roads.push({ pts: [[-CITY_K * CITY_B, v], [0, v], [CITY_K * CITY_B, v]], width: CITY_ST });
  }
  return roads;
}
export const CITY = { B: CITY_B, ST: CITY_ST, K: CITY_K };

export const GEO = {
  track: {
    roads: [
      { pts: [[-200, -300], [100, -300], [260, -290], [330, -230], [340, -140], [290, -80], [200, -60], [150, 0], [190, 70], [290, 110], [340, 190], [310, 290], [210, 320], [120, 270], [90, 180], [20, 120], [-60, 150], [-110, 240], [-200, 300], [-300, 280], [-330, 190], [-270, 120], [-170, 90], [-140, 10], [-210, -60], [-320, -120], [-340, -220], [-290, -290]], closed: true, width: 16 },
      { pts: [[60, -300], [60, -270], [60, -245]], width: 12 },
    ],
    pads: [{ x: 60, z: -170, r: 70 }, { x: 0, z: -345, w: 280, d: 56 }],
  },
  desert: {
    roads: [
      { pts: [[-450, -400], [0, -470], [450, -420], [520, -100], [470, 250], [300, 480], [-100, 500], [-420, 420], [-520, 100], [-500, -200]], closed: true, width: 14 },
      { pts: [[0, -462], [10, -320], [0, -175]], width: 12 },
      { pts: [[512, -100], [330, -60], [175, -20]], width: 12 },
    ],
    pads: [{ x: 0, z: 0, r: 165 }, { x: 560, z: 290, w: 70, d: 50, yaw: 0.3 }],
  },
  mountain: {
    roads: [
      { pts: [[-40, -620], [120, -590], [250, -540], [290, -470], [240, -420], [100, -410], [-60, -400], [-220, -380], [-300, -320], [-270, -250], [-150, -230], [0, -230], [150, -210], [250, -160], [270, -90], [200, -40], [80, -40], [-60, -30], [-180, 0], [-220, 70], [-170, 130], [-80, 150], [-10, 180]], width: 11 },
    ],
    pads: [{ x: -70, z: -660, w: 130, d: 70 }, { x: 30, z: 205, r: 48 }],
  },
  forest: {
    roads: [
      { pts: [[-380, -320], [-150, -400], [120, -380], [330, -300], [430, -120], [390, 40], [420, 200], [360, 380], [160, 430], [-40, 380], [-120, 240], [-260, 200], [-400, 260], [-470, 80], [-430, -60], [-450, -200]], closed: true, width: 12 },
      { pts: [[-440, -130], [-340, -145], [-262, -150]], width: 10 },
    ],
    pads: [{ x: -175, z: -150, r: 88 }, { x: 120, z: -290, w: 70, d: 40 }],
  },
  city: { roads: cityRoads(), pads: [], openArea: true },
};

// ------------------------------------------------------------------ Speed Race circuits
// Each route = the circuit centreline (closed). `start` = sample index of the start/finish
// line; race direction = increasing sample index. Gates every GATE_SPACING samples.
const GATE_SPACING = 16; // 16 samples × 3 m = 48 m between checkpoints
function cityLoop() {
  // rectangle along the streets x=±180, z=±180 with rounded corners (stays on the tarmac)
  const a = 180, r = 10, pts = [];
  const corner = (cx, cz, a0) => { for (let k = 0; k <= 4; k++) { const ang = a0 + (k / 4) * (Math.PI / 2); pts.push([cx + Math.cos(ang) * r, cz + Math.sin(ang) * r]); } };
  corner(a - r, -a + r, -Math.PI / 2); corner(a - r, a - r, 0); corner(-a + r, a - r, Math.PI / 2); corner(-a + r, -a + r, Math.PI);
  return pts;
}
export const RACE = {
  track: { name: 'Apex Circuit', road: 0, start: 30, width: 16, margin: 14 },
  desert: { name: 'Dune Valley Highway', road: 0, start: 70, width: 14, margin: 16 },
  forest: { name: 'Pinewood Loop', road: 0, start: 40, width: 12, margin: 12 },
  city: { name: 'Neon Street Circuit', pts: cityLoop(), linear: true, start: 0, width: 16, margin: 6 },
};
export const RACE_MAPS = Object.keys(RACE);

const routeCache = new Map();
export function raceRoute(mapId) {
  if (routeCache.has(mapId)) return routeCache.get(mapId);
  const R = RACE[mapId]; if (!R) return null;
  const rd = R.pts ? { pts: R.pts, closed: true } : GEO[mapId].roads[R.road];
  let path = samplePath(rd.pts, true, { linear: !!R.linear });
  // rotate so sample 0 is the start/finish line
  if (R.start) {
    const rot = (arr) => { const o = new Float64Array(arr.length); for (let i = 0; i < arr.length; i++) o[i] = arr[(i + R.start) % arr.length]; return o; };
    path = { ...path, x: rot(path.x), z: rot(path.z), tx: rot(path.tx), tz: rot(path.tz) };
  }
  const gates = [];
  const count = Math.max(8, Math.floor(path.n / GATE_SPACING));
  for (let g = 0; g < count; g++) {
    const i = Math.round((g * path.n) / count) % path.n;
    gates.push({ i, x: path.x[i], z: path.z[i], tx: path.tx[i], tz: path.tz[i], hw: R.width / 2 + R.margin });
  }
  const route = { mapId, name: R.name, path, gates, width: R.width, length: path.n * 3 };
  routeCache.set(mapId, route);
  return route;
}
// starting grid: 2 columns, rows 9 m apart, behind the start line
export function gridSlots(route, count) {
  const p = route.path, out = [];
  for (let k = 0; k < count; k++) {
    const row = Math.floor(k / 2), lane = k % 2 ? -1 : 1;
    const i = ((-(3 + row * 3)) % p.n + p.n) % p.n;
    const off = lane * route.width * 0.22;
    out.push({ x: p.x[i] - p.tz[i] * off, z: p.z[i] + p.tx[i] * off, h: Math.atan2(p.tx[i], p.tz[i]) });
  }
  return out;
}

// ------------------------------------------------------------------ RaceTracker
// Feed it position samples; it validates checkpoints IN ORDER. Gate 0 is the start/finish:
// the first crossing after the start just begins lap 1; a lap completes when gate 0 is
// crossed again after every other gate. Teleports (resets / implausible jumps) never count.
export class RaceTracker {
  constructor(route, laps) {
    this.route = route; this.laps = laps;
    this.next = 0; this.started = false; this.lap = 0; // completed laps
    this.lapStart = null; this.lapTimes = []; this.best = null; this.finished = false; this.finishTime = null;
    this.prev = null; this.passed = 0; this.wrongWay = 0;
  }
  // s: {t (seconds since race start), x, z, vx, vz, teleport}
  update(s) {
    const prev = this.prev; this.prev = s;
    if (!prev || this.finished || s.t < 0) return null;
    const dx = s.x - prev.x, dz = s.z - prev.z, dist = Math.hypot(dx, dz), dt = Math.max(1e-3, s.t - prev.t);
    const v = Math.min(110, Math.hypot(s.vx || 0, s.vz || 0));
    if (s.teleport || dist > Math.max(3, Math.max(v, Math.hypot(prev.vx || 0, prev.vz || 0)) * dt * 1.8 + 3) || dist > 60) return null;
    const g = this.route.gates[this.next];
    const d0 = (prev.x - g.x) * g.tx + (prev.z - g.z) * g.tz, d1 = (s.x - g.x) * g.tx + (s.z - g.z) * g.tz;
    if (!(d0 < 0 && d1 >= 0)) return null;
    const f = -d0 / (d1 - d0);
    const qx = prev.x + dx * f, qz = prev.z + dz * f;
    const lat = Math.abs((qx - g.x) * -g.tz + (qz - g.z) * g.tx);
    if (lat > g.hw) return null;
    const tc = prev.t + (s.t - prev.t) * f; // interpolated crossing time
    const ev = { gate: this.next, t: tc };
    if (this.next === 0) {
      if (!this.started) { this.started = true; this.lapStart = 0; ev.type = 'start'; }
      else {
        const lt = tc - this.lapStart; this.lapTimes.push(lt); this.lap++; this.lapStart = tc;
        if (this.best === null || lt < this.best) this.best = lt;
        ev.type = 'lap'; ev.lapTime = lt;
        if (this.lap >= this.laps) { this.finished = true; this.finishTime = tc; ev.type = 'finish'; }
      }
    } else ev.type = 'checkpoint';
    this.passed++;
    this.next = (this.next + 1) % this.route.gates.length;
    return ev;
  }
  // monotonic race progress for standings: completed gates + fraction to next gate
  progress(x, z) {
    if (this.finished) return 1e6 - (this.finishTime || 0);
    const gs = this.route.gates, g = gs[this.next], pg = gs[(this.next - 1 + gs.length) % gs.length];
    const seg = Math.hypot(g.x - pg.x, g.z - pg.z) || 1;
    const frac = this.started ? clamp(1 - Math.hypot(x - g.x, z - g.z) / seg, 0, 0.99) : 0;
    return this.passed + frac;
  }
  get gateCount() { return this.route.gates.length; }
}

// ------------------------------------------------------------------ Drift Battle courses
// A one-way section of road with a start gate and an end gate. dir -1 = run the road backwards.
function figure8(r) {
  // two touching circles on the salt flat: right loop then left loop, both starting north at the centre
  const pts = [];
  for (let k = 0; k < 48; k++) { const t = (k / 48) * Math.PI * 2; pts.push([r - r * Math.cos(t), r * Math.sin(t)]); }
  for (let k = 0; k <= 48; k++) { const t = (k / 48) * Math.PI * 2; pts.push([-r + r * Math.cos(t), r * Math.sin(t)]); }
  return pts;
}
export const BATTLE = {
  track: { name: 'Esses & Carousel', road: 0, from: 0.175, to: 0.445, dir: 1, width: 16 },
  desert: { name: 'Salt Flat Figure-8', pts: figure8(55), width: 16 },
  mountain: { name: 'Kurogane Downhill', road: 0, from: 0.93, to: 0.58, dir: -1, width: 11 },
  forest: { name: 'Lakeside Esses', road: 0, from: 0.607, to: 0.878, dir: 1, width: 12 },
};
export const BATTLE_MAPS = Object.keys(BATTLE);
const courseCache = new Map();
export function battleCourse(mapId) {
  if (courseCache.has(mapId)) return courseCache.get(mapId);
  const B = BATTLE[mapId]; if (!B) return null;
  const full = B.pts ? samplePath(B.pts, false, { linear: true }) : samplePath(GEO[mapId].roads[B.road].pts, !!GEO[mapId].roads[B.road].closed);
  const dir = B.dir || 1;
  const a = B.pts ? 0 : Math.round(B.from * (full.n - 1)), b = B.pts ? full.n - 1 : Math.round(B.to * (full.n - 1));
  const idx = []; for (let i = a; dir > 0 ? i <= b : i >= b; i += dir) idx.push(i);
  const n = idx.length, x = new Float64Array(n), z = new Float64Array(n), tx = new Float64Array(n), tz = new Float64Array(n);
  idx.forEach((i, k) => { x[k] = full.x[i]; z[k] = full.z[i]; tx[k] = full.tx[i] * dir; tz[k] = full.tz[i] * dir; });
  const path = { n, x, z, tx, tz, closed: false };
  const mk = (k) => ({ x: x[k], z: z[k], tx: tx[k], tz: tz[k], hw: B.width / 2 + 10 });
  const course = { mapId, name: B.name, path, width: B.width, start: mk(6), end: mk(n - 1), length: n * 3 };
  // start slots: lead just before the start gate, chase ~17 m behind on the same line
  const h0 = Math.atan2(tx[0], tz[0]);
  course.leadSlot = { x: x[2], z: z[2], h: Math.atan2(tx[2], tz[2]) };
  course.chaseSlot = { x: x[0] - tx[0] * 11, z: z[0] - tz[0] * 11, h: h0 };
  courseCache.set(mapId, course);
  return course;
}
// distance from a point to a sampled open/closed path (returns {d, k} nearest sample index)
export function pathDistance(path, px, pz, hint = -1, window = 40) {
  let best = 1e9, bk = 0;
  const n = path.n;
  const lo = hint < 0 ? 0 : Math.max(0, hint - window), hi = hint < 0 ? n - 1 : Math.min(n - 1, hint + window);
  for (let k = lo; k < hi; k++) {
    const [d] = segDist(px, pz, path.x[k], path.z[k], path.x[k + 1], path.z[k + 1]);
    if (d < best) { best = d; bk = k; }
  }
  return { d: best, k: bk };
}

// ------------------------------------------------------------------ TrackGeo (off-track checks)
export class TrackGeo {
  constructor(mapId) {
    const G = GEO[mapId]; this.open = !!G.openArea;
    this.roads = G.roads.map((r) => ({ ...samplePath(r.pts, !!r.closed), half: r.width / 2 }));
    this.pads = G.pads;
    this.cell = 30; this.hash = new Map();
    this.roads.forEach((r, ri) => {
      const segs = r.closed ? r.n : r.n - 1;
      for (let i = 0; i < segs; i++) {
        const j = (i + 1) % r.n, R = r.half + 10;
        const x0 = Math.floor((Math.min(r.x[i], r.x[j]) - R) / this.cell), x1 = Math.floor((Math.max(r.x[i], r.x[j]) + R) / this.cell);
        const z0 = Math.floor((Math.min(r.z[i], r.z[j]) - R) / this.cell), z1 = Math.floor((Math.max(r.z[i], r.z[j]) + R) / this.cell);
        for (let a = x0; a <= x1; a++) for (let b = z0; b <= z1; b++) { const k = a * 100003 + b; let arr = this.hash.get(k); if (!arr) this.hash.set(k, arr = []); arr.push([ri, i, j]); }
      }
    });
  }
  // signed distance to the nearest tarmac edge (negative = on the road / a paved area)
  edge(x, z) {
    if (this.open) return -1;
    let best = 1e9;
    const arr = this.hash.get(Math.floor(x / this.cell) * 100003 + Math.floor(z / this.cell));
    if (arr) for (const [ri, i, j] of arr) { const r = this.roads[ri]; const [d] = segDist(x, z, r.x[i], r.z[i], r.x[j], r.z[j]); best = Math.min(best, d - r.half); }
    for (const p of this.pads) {
      let e;
      if (p.r) e = Math.hypot(x - p.x, z - p.z) - p.r;
      else { const c = Math.cos(p.yaw || 0), s = Math.sin(p.yaw || 0), lx = (x - p.x) * c - (z - p.z) * s, lz = (x - p.x) * s + (z - p.z) * c; e = Math.max(Math.abs(lx) - p.w / 2, Math.abs(lz) - p.d / 2); }
      best = Math.min(best, e);
    }
    return best;
  }
}
export const OFF_TRACK_MARGIN = 4; // metres beyond the tarmac edge before it counts as leaving the track
