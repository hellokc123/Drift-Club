// Map definitions + procedural world builder.
// Each map = terrain function + road splines + pads + scenery + atmosphere.
// To add a map: write a spec function and register it in SPECS / MAP_LIST.
import { Geo, ChunkBatcher } from './engine/geometry.js';
import { FxBuffer } from './engine/renderer.js';
import { makeNoise, rng, smoothstep, clamp, lerp } from './engine/math.js';
import { crSample, segDist, GEO, CITY } from './tracks.js';

export const MAP_LIST = [
  { id: 'track', name: 'Apex Circuit', type: 'Race Track', desc: 'A proper racing circuit with a National cut-through, service roads, an infield skidpad, an autocross pad and car parks.', accent: '#8fb3d1' },
  { id: 'desert', name: 'Dune Valley', type: 'Desert', desc: 'Huge open desert, 4 km wide. A 12 km winding highway, an interstate, a canyon road, salt flat, dry lake, airstrip and a ghost town.', accent: '#d9a46a' },
  { id: 'mountain', name: 'Kurogane Pass', type: 'Mountains', desc: 'Big Japanese touge at dusk: a five-hairpin uphill, a nine-switchback Irohazaka descent, ridge esses and a valley ring road.', accent: '#d48d6e' },
  { id: 'forest', name: 'Pinewood Trails', type: 'Forest', desc: 'Misty forest roads round a lake, gravel logging trails, a big clearing and a quarry.', accent: '#86b77a' },
  { id: 'city', name: 'City Nights', type: 'City', desc: 'Night-time grid of streets cut by a diagonal boulevard, a central plaza and open parking lots.', accent: '#d8b25c' },
  { id: 'drift', name: 'Ironbay Drift Park', type: 'Drift Park', desc: 'A harbourside drift venue: figure-eight course, hairpins, a huge practice pad, a donut circle and container alleys.', accent: '#7fa8a3' },
];

export const SURFACES = {
  asphalt: { grip: 1.0, drag: 0.0, skid: [0.04, 0.04, 0.045, 0.6], dust: null, rumble: 0, smoke: [0.92, 0.92, 0.95] },
  kerb: { grip: 0.96, drag: 0.02, skid: [0.04, 0.04, 0.045, 0.5], dust: null, rumble: 1, smoke: [0.92, 0.92, 0.95] },
  gravel: { grip: 0.8, drag: 0.22, skid: [0.32, 0.29, 0.24, 0.5], dust: [0.62, 0.57, 0.48], rumble: 0.6 },
  salt: { grip: 0.9, drag: 0.04, skid: [0.55, 0.55, 0.55, 0.45], dust: [0.95, 0.95, 0.93], rumble: 0.15 },
  grass: { grip: 0.72, drag: 0.5, skid: [0.18, 0.26, 0.1, 0.55], dust: [0.38, 0.46, 0.25], rumble: 0.6 },
  sand: { grip: 0.68, drag: 0.6, skid: [0.62, 0.48, 0.32, 0.5], dust: [0.9, 0.75, 0.52], rumble: 0.45 },
  dirt: { grip: 0.72, drag: 0.4, skid: [0.28, 0.22, 0.16, 0.55], dust: [0.5, 0.42, 0.32], rumble: 0.6 },
  rock: { grip: 0.75, drag: 0.4, skid: [0.2, 0.2, 0.2, 0.5], dust: [0.6, 0.58, 0.58], rumble: 0.7 },
  water: { grip: 0.45, drag: 2.5, skid: null, dust: [0.75, 0.85, 0.95], rumble: 0.3 },
};
const PAVED = ['asphalt', 'asphalt', 'asphalt', 'gravel', 'salt']; // type ids 1..4

const col = (h) => { const n = parseInt(h.slice(1), 16); return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]; };
const mix3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const shade = (c, k) => [c[0] * k, c[1] * k, c[2] * k];

// splines / distance helpers are shared with the server (tracks.js)

function smoothArr(a, closed, win, passes) {
  const n = a.length; let cur = a.slice();
  for (let p = 0; p < passes; p++) {
    const nx = new Array(n);
    for (let i = 0; i < n; i++) {
      let s = 0, c = 0;
      for (let k = -win; k <= win; k++) {
        let j = i + k;
        if (closed) j = ((j % n) + n) % n; else j = clamp(j, 0, n - 1);
        s += cur[j]; c++;
      }
      nx[i] = s / c;
    }
    cur = nx;
  }
  return cur;
}

// ---------------------------------------------------------------- spatial hash
class Hash {
  constructor(cell) { this.cell = cell; this.m = new Map(); }
  key(i, j) { return i * 73856093 ^ j * 19349663; }
  insert(minx, minz, maxx, maxz, item) {
    const c = this.cell;
    for (let i = Math.floor(minx / c); i <= Math.floor(maxx / c); i++) for (let j = Math.floor(minz / c); j <= Math.floor(maxz / c); j++) {
      const k = this.key(i, j); let a = this.m.get(k); if (!a) { a = []; this.m.set(k, a); } a.push(item);
    }
  }
  at(x, z) { return this.m.get(this.key(Math.floor(x / this.cell), Math.floor(z / this.cell))) || EMPTY; }
}
const EMPTY = [];

// ---------------------------------------------------------------- MAP GATES
// Every map links to the next and the previous one in this loop. Drive through the glowing gate on
// the road to drive on into the next map (free-drive modes and the public room).
export const MAP_LOOP = ['track', 'desert', 'mountain', 'forest', 'city', 'drift'];
// where each map's two gates stand: road index, position along it (0..1), and which way is "out"
const GATE_SPOTS = {
  track: [{ road: 0, f: 0.3, dir: 1 }, { road: 0, f: 0.62, dir: -1 }],
  desert: [{ road: 1, f: 0.62, dir: 1 }, { road: 1, f: 0.3, dir: -1 }],
  mountain: [{ road: 0, f: 0.3, dir: 1 }, { road: 0, f: 0.72, dir: -1 }],
  forest: [{ road: 0, f: 0.3, dir: 1 }, { road: 0, f: 0.65, dir: -1 }],
  // city: no room between the blocks, so each gate stands in a parking-lot block, down a short side street
  city: [{ road: 0, f: 0.3, dir: 1, spur: [[-360, 225], [-340, 225], [-320, 225], [-296, 225]] }, { road: 0, f: 0.65, dir: -1, spur: [[225, -360], [225, -340], [225, -320], [225, -296]] }],
  drift: [{ road: 0, f: 0.3, dir: 1 }, { road: 0, f: 0.65, dir: -1 }],
};

// ================================================================ WORLD
export class World {
  constructor(renderer, id, quality = 'medium') {
    const q = { low: { cell: 7, density: 0.35, fog: 0.75 }, medium: { cell: 5, density: 0.65, fog: 0.9 }, high: { cell: 4, density: 1, fog: 1 } }[quality] || { cell: 5, density: 0.65, fog: 0.9 };
    this.id = id; this.q = q; this.renderer = renderer;
    const spec = SPECS[id](q);
    this.spec = spec; this.size = spec.size; this.env = spec.env;
    this.env.fogFar *= q.fog; this.env.fogNear *= q.fog;
    this.natSurf = SURFACES[spec.natural];
    this.waterY = spec.water ? spec.water.y : -1e9;
    this.colHash = new Hash(16);
    this.circles = []; this.segments = [];
    this.statics = []; this.fx = [];
    this.batch = new ChunkBatcher(120);
    this.shadowV = []; this.glowV = [];
    this.rand = rng(spec.seed || 1234);
    this.processRoads();
    this.buildHeightfield();
    this.buildTerrainMesh();
    this.buildRoadMeshes();
    this.buildPads();
    if (spec.water) this.buildWater();
    spec.scenery(this.ctx());
    this.buildBoundary();
    this.spawns = spec.spawns ? spec.spawns(this) : this.roadSpawns(0, 0);
    this.challenges = (spec.challenges || []).map((c) => ({ ...c, y: this.heightAt(c.x, c.z) }));
    this.challenges.forEach((c) => this.challengeMarker(c));
    this.buildGates();
    // finalise
    this.statics = this.batch.build(renderer).map((s) => ({ ...s, maxDist: this.env.fogFar + 60 }));
    this.fx.push(this.makeStaticFx(this.shadowV, false), this.makeStaticFx(this.glowV, true));
    this.resetPts = [];
    for (const r of this.roads) for (let i = 0; i < r.n; i += 3) this.resetPts.push([r.x[i], r.z[i], r.h[i], Math.atan2(r.tx[i], r.tz[i])]);
    for (const p of this.pads) this.resetPts.push([p.x, p.z, p.h, 0]);
  }

  // ------------------------------------------------ roads
  // Gate side roads: a short exit ramp leaves the road at each gate spot and the gate stands at its end,
  // so the gates are off the racing line. Tries both sides of the road (and nearby spots) for clear ground.
  planGateSpurs() {
    const spec = this.spec, spots = GATE_SPOTS[this.id] || [], extra = [];
    this.gateSpurs = [];
    if (!spots.length) return extra;
    const sampled = spec.roads.map((r) => crSample(r.pts, !!r.closed, 3));
    const lim = spec.size / 2 - (spec.boundary || 60) - 25;
    const water = spec.water ? spec.water.y + 1.5 : -1e9;
    const padD = (x, z) => Math.min(1e9, ...(spec.pads || []).map((p) => p.r ? Math.hypot(x - p.x, z - p.z) - p.r : Math.hypot(x - p.x, z - p.z) - Math.max(p.w, p.d) / 2));
    const clear = (pts, parent) => {
      for (let k = 0; k < pts.length; k++) {
        const [x, z] = pts[k];
        if (Math.abs(x) > lim || Math.abs(z) > lim) return false;
        if (spec.terrain(x, z) < water) return false;
        if (k * 3 < 22) continue; // the first metres join the parent road
        if (padD(x, z) < 12) return false;
        for (let ri = 0; ri < sampled.length; ri++) {
          if (ri === parent && k * 3 < 45) continue; // still peeling away from its own road
          const need = (spec.roads[ri].width || 10) / 2 + 5 + (ri === parent ? 3 : 7);
          for (let j = 0; j < sampled[ri].length; j += 2) if (Math.hypot(sampled[ri][j][0] - x, sampled[ri][j][1] - z) < need) return false;
        }
        for (const e of extra) for (const q of e.samples) if (Math.hypot(q[0] - x, q[1] - z) < 25) return false;
      }
      return true;
    };
    spots.forEach((sp, gi) => {
      if (sp.spur) { extra.push({ pts: sp.spur, width: 10, flatH: 0, center: 'dash', edge: false, color: [0.16, 0.16, 0.18], gateSpur: gi, samples: crSample(sp.spur, false, 3) }); return; }
      const rd = spec.roads[sp.road], P = sampled[sp.road]; if (!rd) return;
      let done = false;
      for (const df of [0, 0.03, -0.03, 0.06, -0.06, 0.09, -0.09, 0.12, -0.12]) {
        for (const side of [1, -1]) {
          for (const len of [110, 80]) {
            const f = ((sp.f + df) % 1 + 1) % 1, i = Math.round(f * (P.length - 1));
            const a = P[Math.max(0, i - 1)], b = P[Math.min(P.length - 1, i + 1)];
            const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, tx = (b[0] - a[0]) / l * sp.dir, tz = (b[1] - a[1]) / l * sp.dir;
            const nx = tz * side, nz = -tx * side, [x0, z0] = P[i], k = len / 110;
            const pts = [[x0, z0], [x0 + tx * 18 + nx * 6, z0 + tz * 18 + nz * 6], [x0 + tx * 34 + nx * 26 * k, z0 + tz * 34 + nz * 26 * k],
              [x0 + tx * 46 + nx * 58 * k, z0 + tz * 46 + nz * 58 * k], [x0 + tx * 48 + nx * (len - 32), z0 + tz * 48 + nz * (len - 32)],
              [x0 + tx * 48 + nx * (len - 16), z0 + tz * 48 + nz * (len - 16)], [x0 + tx * 48 + nx * len, z0 + tz * 48 + nz * len]]; // straight last 30 m for the gate
            const samples = crSample(pts, false, 3);
            if (!clear(samples, sp.road)) continue;
            extra.push({ pts, width: 10, center: 'dash', color: rd.color || [0.26, 0.26, 0.28], smooth: 6, maxGrade: 0.14, gateSpur: gi, samples });
            done = true; break;
          }
          if (done) break;
        }
        if (done) break;
      }
      if (!done) console.warn('gate side road: no room near', this.id, sp);
    });
    return extra;
  }
  processRoads() {
    const spec = this.spec;
    this.roads = [];
    const jh = new Hash(80); // segments of the roads built so far (junction blending)
    const spurs = this.planGateSpurs();
    for (const rd0 of [...spec.roads, ...spurs]) {
      const rd = rd0;
      const pts = crSample(rd.pts, !!rd.closed, 3);
      const n = pts.length;
      const r = { ...rd, n, x: new Float32Array(n), z: new Float32Array(n), h: new Float32Array(n), tx: new Float32Array(n), tz: new Float32Array(n), half: rd.width / 2 };
      pts.forEach((p, i) => { r.x[i] = p[0]; r.z[i] = p[1]; });
      for (let i = 0; i < n; i++) {
        const a = rd.closed ? (i - 1 + n) % n : Math.max(0, i - 1), b = rd.closed ? (i + 1) % n : Math.min(n - 1, i + 1);
        const dx = r.x[b] - r.x[a], dz = r.z[b] - r.z[a], l = Math.hypot(dx, dz) || 1;
        r.tx[i] = dx / l; r.tz[i] = dz / l;
      }
      let hs = [];
      for (let i = 0; i < n; i++) hs.push(rd.flatH !== undefined ? rd.flatH : spec.terrain(r.x[i], r.z[i]));
      if (rd.flatH === undefined) hs = smoothArr(hs, !!rd.closed, rd.smooth || 12, 3);
      // blend into earlier roads at junctions (height interpolated along the nearest segment, so
      // the joining road meets the other road's surface exactly); samples on the other road are pinned
      const pin = new Uint8Array(n);
      for (let i = 0; i < n; i++) {
        let best = 1e9, bh = 0;
        for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
          for (const [o, j, k] of jh.at(r.x[i] + a * 80, r.z[i] + b * 80)) {
            const [d, t] = segDist(r.x[i], r.z[i], o.x[j], o.z[j], o.x[k], o.z[k]);
            if (d < best) { best = d; bh = lerp(o.h[j], o.h[k], t); }
          }
        }
        if (best < 80) hs[i] = lerp(bh, hs[i], smoothstep(r.half + 4, 70, best));
        if (best < r.half + 4) pin[i] = 1;
      }
      if (rd.flatH === undefined) {
        // limit the gradient (cut & fill) so hills stay drivable — also on the run-up to a junction
        const g = (rd.maxGrade || 0.12) * 3;
        for (let it = 0; it < 6; it++) {
          for (let i = 1; i < n; i++) if (!pin[i]) hs[i] = clamp(hs[i], hs[i - 1] - g, hs[i - 1] + g);
          for (let i = n - 2; i >= 0; i--) if (!pin[i]) hs[i] = clamp(hs[i], hs[i + 1] - g, hs[i + 1] + g);
        }
        const sm = smoothArr(hs, !!rd.closed, 4, 1);
        for (let i = 0; i < n; i++) if (!pin[i]) hs[i] = sm[i];
      }
      r.h.set(hs); r.pin = pin;
      r.index = this.roads.length;
      this.roads.push(r);
      for (let j = 0; j < (r.closed ? n : n - 1); j++) { const k = (j + 1) % n; jh.insert(Math.min(r.x[j], r.x[k]), Math.min(r.z[j], r.z[k]), Math.max(r.x[j], r.x[k]), Math.max(r.z[j], r.z[k]), [r, j, k]); }
    }
    // pads
    this.pads = (spec.pads || []).map((p) => {
      const out = { ...p };
      if (out.h === undefined) {
        let best = 1e9, bh = 0;
        for (const r of this.roads) for (let j = 0; j < r.n; j++) { const d = Math.hypot(r.x[j] - p.x, r.z[j] - p.z); if (d < best) { best = d; bh = r.h[j]; } }
        const reach = (p.r || Math.max(p.w, p.d) / 2) + 30;
        out.h = best < reach ? bh : spec.terrain(p.x, p.z);
      }
      return out;
    });
    // roads that run into / across a pad meet it at the pad's level (no steps where a side road,
    // a junction or a second pad joins it)
    for (const r of this.roads) {
      if (r.flatH !== undefined) continue;
      let touched = false;
      for (let i = 0; i < r.n; i++) for (const p of this.pads) {
        const e = this.padSdf(p, r.x[i], r.z[i]);
        if (e < 45) { r.h[i] = lerp(r.h[i], p.h, smoothstep(45, 2, e)); touched = true; }
        if (e < 0) r.pin[i] = 1;
      }
      if (!touched) continue;
      // keep the run-out from the pad within the road's gradient limit
      const g = (r.maxGrade || 0.12) * 3, n = r.n, h = r.h, pin = r.pin;
      for (let it = 0; it < 6; it++) {
        for (let i = 1; i < n; i++) if (!pin[i]) h[i] = clamp(h[i], h[i - 1] - g, h[i - 1] + g);
        for (let i = n - 2; i >= 0; i--) if (!pin[i]) h[i] = clamp(h[i], h[i + 1] - g, h[i + 1] + g);
      }
    }
  }

  padSdf(p, x, z) {
    if (p.r) return Math.hypot(x - p.x, z - p.z) - p.r;
    const c = Math.cos(p.yaw || 0), s = Math.sin(p.yaw || 0);
    const lx = (x - p.x) * c - (z - p.z) * s, lz = (x - p.x) * s + (z - p.z) * c;
    const qx = Math.abs(lx) - p.w / 2, qz = Math.abs(lz) - p.d / 2;
    return Math.hypot(Math.max(qx, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qz), 0);
  }

  // ------------------------------------------------ heightfield
  buildHeightfield() {
    const spec = this.spec, cs = this.q.cell * (spec.cellMul || 1), size = this.size;
    const N = Math.round(size / cs) + 1; this.N = N; this.cs = cs; this.org = -size / 2;
    this.hf = new Float32Array(N * N); this.sd = new Float32Array(N * N); this.st = new Uint8Array(N * N);
    const shoulder = Math.max(3, cs * 1.2), blend = spec.blend || 22;
    this.shoulder = shoulder;
    const reach = shoulder + blend;
    const hash = new Hash(24);
    this.roadHash = hash;
    this.roads.forEach((r, ri) => {
      const segs = r.closed ? r.n : r.n - 1;
      for (let i = 0; i < segs; i++) {
        const j = (i + 1) % r.n, R = r.half + reach;
        hash.insert(Math.min(r.x[i], r.x[j]) - R, Math.min(r.z[i], r.z[j]) - R, Math.max(r.x[i], r.x[j]) + R, Math.max(r.z[i], r.z[j]) + R, [ri, i, j]);
      }
    });
    for (let gz = 0; gz < N; gz++) for (let gx = 0; gx < N; gx++) {
      const x = this.org + gx * cs, z = this.org + gz * cs, idx = gz * N + gx;
      const nat = spec.terrain(x, z);
      let bt = 1, bh = nat, bsd = 1e4, btype = 0, be = 1e9;
      for (const [ri, i, j] of hash.at(x, z)) {
        const r = this.roads[ri];
        const [d, t] = segDist(x, z, r.x[i], r.z[i], r.x[j], r.z[j]);
        const e = d - r.half;
        if (e < bsd) { bsd = e; btype = (r.surface || 1) | (r.kerbs ? 8 : 0); }
        const tw = smoothstep(shoulder, shoulder + blend, e);
        if (tw < bt || (tw === 0 && e < be)) { bt = tw; be = e; bh = lerp(r.h[i], r.h[j], t); }
      }
      for (const p of this.pads) {
        const e = this.padSdf(p, x, z);
        if (e > reach) continue;
        if (e < bsd) { bsd = e; btype = p.type || 2; }
        const tw = smoothstep(shoulder, shoulder + blend, e);
        if (tw < bt || (tw === 0 && e < be)) { bt = tw; be = e; bh = p.h; }
      }
      this.hf[idx] = bt < 1 ? lerp(bh, nat, bt) : nat;
      this.sd[idx] = bsd; this.st[idx] = btype;
    }
  }

  _bil(arr, x, z) {
    const N = this.N, fx = clamp((x - this.org) / this.cs, 0, N - 1.001), fz = clamp((z - this.org) / this.cs, 0, N - 1.001);
    const ix = Math.floor(fx), iz = Math.floor(fz), tx = fx - ix, tz = fz - iz, i = iz * N + ix;
    // match the triangle split used by the mesh so the car sits exactly on the visible ground
    if (tx + tz < 1) return arr[i] + (arr[i + 1] - arr[i]) * tx + (arr[i + N] - arr[i]) * tz;
    return arr[i + N + 1] + (arr[i + N] - arr[i + N + 1]) * (1 - tx) + (arr[i + 1] - arr[i + N + 1]) * (1 - tz);
  }
  heightAt(x, z) { return this._bil(this.hf, x, z); }
  sdAt(x, z) { return this._bil(this.sd, x, z); }
  surfaceAt(x, z) {
    if (this.spec.surfaceFn) return SURFACES[this.spec.surfaceFn(x, z)];
    const sd = this.sdAt(x, z);
    const N = this.N, gx = clamp(Math.round((x - this.org) / this.cs), 0, N - 1), gz = clamp(Math.round((z - this.org) / this.cs), 0, N - 1);
    const t = this.st[gz * N + gx];
    if (sd < 0 && t) return SURFACES[PAVED[(t & 7)] || 'asphalt'];
    if ((t & 8) && sd < 1.4) return SURFACES.kerb;
    if (this.heightAt(x, z) < this.waterY - 0.25) return SURFACES.water;
    return this.natSurf;
  }

  buildTerrainMesh() {
    const N = this.N, cs = this.cs, spec = this.spec, hf = this.hf;
    const cols = new Array(N * N);
    const noise = makeNoise(77);
    for (let gz = 0; gz < N; gz++) for (let gx = 0; gx < N; gx++) {
      const i = gz * N + gx, x = this.org + gx * cs, z = this.org + gz * cs;
      const hx = hf[Math.min(i + 1, gz * N + N - 1)] - hf[Math.max(i - 1, gz * N)];
      const hz = hf[Math.min(i + N, N * N - 1 - (N - 1 - gx))] - hf[Math.max(i - N, gx)];
      const slope = Math.hypot(hx, hz) / (2 * cs);
      let c = spec.color(x, z, hf[i], slope, this.sd[i]);
      if (this.sd[i] >= 0 && this.sd[i] < this.shoulder && spec.shoulder) c = mix3(spec.shoulder, c, smoothstep(0, this.shoulder, this.sd[i]) * 0.6);
      const v = 1 + noise(x * 0.08, z * 0.08) * 0.06;
      cols[i] = [c[0] * v, c[1] * v, c[2] * v];
    }
    for (let gz = 0; gz < N - 1; gz++) for (let gx = 0; gx < N - 1; gx++) {
      const i = gz * N + gx;
      const x0 = this.org + gx * cs, z0 = this.org + gz * cs, x1 = x0 + cs, z1 = z0 + cs;
      const h = (k) => hf[k] - (this.sd[k] < 0.3 ? 0.12 : 0);
      const a = [x0, h(i), z0], b = [x1, h(i + 1), z0], c = [x0, h(i + N), z1], d = [x1, h(i + N + 1), z1];
      const g = this.batch.geo(x0 + cs / 2, z0 + cs / 2);
      g.triRaw(a, c, b, cols[i], cols[i + N], cols[i + 1]);
      g.triRaw(d, b, c, cols[i + N + 1], cols[i + 1], cols[i + N]);
    }
  }

  // ------------------------------------------------ road meshes
  // how far inside another road / pad a point is (negative = inside). `earlierOnly`: only roads
  // built before `self` (+ far-away parts of `self`, for figure-eights). Used at junctions so the
  // joining road tucks under the through road and no painted lines run across the junction.
  overlap(x, z, self, k, earlierOnly) {
    let best = 1e9;
    const si = self.index;
    for (const [ri, i, j] of this.roadHash.at(x, z)) {
      const o = this.roads[ri];
      if (o === self) {
        const di = Math.min(Math.abs(i - k), self.closed ? self.n - Math.abs(i - k) : 1e9);
        if (di < 30 || (earlierOnly && i > k)) continue;
      } else if (earlierOnly && ri > si) continue;
      const [d] = segDist(x, z, o.x[i], o.z[i], o.x[j], o.z[j]);
      best = Math.min(best, d - o.half);
    }
    for (const p of this.pads) best = Math.min(best, this.padSdf(p, x, z));
    return best;
  }

  buildRoadMeshes() {
    const rand = this.rand;
    for (const r of this.roads) {
      const segs = r.closed ? r.n : r.n - 1;
      const C = r.color || [0.2, 0.2, 0.22];
      const L = (i, off, dy = 0) => [r.x[i] - r.tz[i] * off, r.h[i] + dy, r.z[i] + r.tx[i] * off];
      const Rr = (i, off, dy = 0) => [r.x[i] + r.tz[i] * off, r.h[i] + dy, r.z[i] - r.tx[i] * off];
      // per sample: is this stretch inside an earlier road / pad (junction) -> drawn just underneath it
      const under = new Uint8Array(r.n), near = new Uint8Array(r.n);
      for (let i = 0; i < r.n; i++) {
        const ov = this.overlap(r.x[i], r.z[i], r, i, false); // nearest other tarmac edge from the centre line
        near[i] = ov < r.half + 2 ? 1 : 0;
        under[i] = ov < -1.5 && this.overlap(r.x[i], r.z[i], r, i, true) < -1.5 ? 1 : 0;
      }
      const clear = (p, i) => !near[i] || this.overlap(p[0], p[2], r, i, false) > -0.3; // painted line point not on another road
      for (let i = 0; i < segs; i++) {
        const j = (i + 1) % r.n;
        const g = this.batch.geo(r.x[i], r.z[i]);
        const Q = (A, B, C2, D, c) => g.quad(D, C2, B, A, c); // ribbon winding (faces up)
        const shadeK = 0.96 + (i % 7 === 0 ? 0.04 : 0) + rand() * 0.02;
        const dn = under[i] || under[j] ? -0.07 : 0;
        Q(Rr(i, r.half, dn), Rr(j, r.half, dn), L(j, r.half, dn), L(i, r.half, dn), shade(C, shadeK));
        if (under[i] && under[j]) continue;
        // edge lines
        if (r.edge !== false) {
          const e = r.half - 0.55, w = 0.18, lc = r.edgeColor || [0.9, 0.9, 0.88];
          if (clear(Rr(i, e), i) && clear(Rr(j, e), j)) Q(Rr(i, e + w, 0.03), Rr(j, e + w, 0.03), Rr(j, e, 0.03), Rr(i, e, 0.03), lc);
          if (clear(L(i, e), i) && clear(L(j, e), j)) Q(L(i, e, 0.03), L(j, e, 0.03), L(j, e + w, 0.03), L(i, e + w, 0.03), lc);
        }
        if (r.center && (r.center === 'solid' || (i % 4) < 2) && clear(L(i, 0), i) && clear(L(j, 0), j)) {
          const cc = r.centerColor || [0.95, 0.8, 0.2], w = 0.12;
          Q(Rr(i, w, 0.03), Rr(j, w, 0.03), L(j, w, 0.03), L(i, w, 0.03), cc);
        }
        if (r.kerbs) {
          const kc = (Math.floor(i / 1) % 2) ? [0.85, 0.12, 0.12] : [0.95, 0.95, 0.95];
          if (clear(Rr(i, r.half + 0.6), i) && clear(Rr(j, r.half + 0.6), j)) Q(Rr(i, r.half + 1.3, 0.05), Rr(j, r.half + 1.3, 0.05), Rr(j, r.half, 0.05), Rr(i, r.half, 0.05), kc);
          if (clear(L(i, r.half + 0.6), i) && clear(L(j, r.half + 0.6), j)) Q(L(i, r.half, 0.05), L(j, r.half, 0.05), L(j, r.half + 1.3, 0.05), L(i, r.half + 1.3, 0.05), kc);
        }
        if (r.startLine !== undefined && i === r.startLine) {
          for (let k = 0; k < 8; k++) for (let m = 0; m < 2; m++) {
            if ((k + m) % 2) continue;
            const o0 = -r.half + (k / 8) * r.width, o1 = o0 + r.width / 8;
            const a = [r.x[i] + r.tz[i] * o0 + r.tx[i] * m * 1.5, r.h[i] + 0.04, r.z[i] - r.tx[i] * o0 + r.tz[i] * m * 1.5];
            const b = [r.x[i] + r.tz[i] * o1 + r.tx[i] * m * 1.5, r.h[i] + 0.04, r.z[i] - r.tx[i] * o1 + r.tz[i] * m * 1.5];
            g.quad(a, [a[0] + r.tx[i] * 1.5, a[1], a[2] + r.tz[i] * 1.5], [b[0] + r.tx[i] * 1.5, b[1], b[2] + r.tz[i] * 1.5], b, [0.95, 0.95, 0.95]);
          }
        }
      }
      if (r.guardrails) this.railLine(r, r.half + 1.2, 'rail');
      if (r.walls) this.railLine(r, r.half + r.walls, 'wall');
    }
  }

  // barrier lines along both sides of a road, skipping spots near other roads/pads
  railLine(r, off, kind) {
    for (const side of [-1, 1]) {
      let prev = null;
      const n = r.n, segs = r.closed ? n : n - 1;
      const pts = [];
      for (let i = 0; i <= segs; i++) {
        const k = i % n;
        const x = r.x[k] + r.tz[k] * off * side, z = r.z[k] - r.tx[k] * off * side;
        pts.push([x, z, this.blocked(x, z, r, k, off) ? null : this.heightAt(x, z)]);
      }
      const step = kind === 'wall' ? 2 : 2;
      for (let i = 0; i + step < pts.length; i += step) {
        const a = pts[i], b = pts[i + step];
        if (a[2] === null || b[2] === null) { prev = null; continue; }
        this.addSegment(a[0], a[1], b[0], b[1]);
        const mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2, len = Math.hypot(b[0] - a[0], b[1] - a[1]);
        const yaw = Math.atan2(b[0] - a[0], b[1] - a[1]);
        const pitch = -Math.atan2(b[2] - a[2], len);
        const g = this.batch.geo(mx, mz);
        if (kind === 'rail') {
          g.at(mx, (a[2] + b[2]) / 2 + 0.62, mz, yaw, 1, 1, 1, pitch).box(0, 0, 0, 0.08, 0.3, len + 0.05, { top: [0.85, 0.86, 0.88], side: [0.7, 0.72, 0.75] }).reset();
          g.box(a[0], a[2] + 0.35, a[1], 0.12, 0.7, 0.12, [0.45, 0.45, 0.47]);
        } else {
          const c = (Math.floor(i / step) % 2) ? [0.92, 0.92, 0.92] : [0.85, 0.15, 0.15];
          g.at(mx, (a[2] + b[2]) / 2 + 0.5, mz, yaw, 1, 1, 1, pitch).box(0, 0, 0, 0.7, 1.0, len + 0.04, { top: [0.6, 0.6, 0.62], side: c }).reset();
        }
        prev = b;
      }
    }
  }
  blocked(x, z, self, k, off) {
    for (const [ri, i, j] of this.roadHash.at(x, z)) {
      const r = this.roads[ri];
      const [d] = segDist(x, z, r.x[i], r.z[i], r.x[j], r.z[j]);
      let near = false;
      if (r === self) { const di = Math.min(Math.abs(i - k), self.closed ? self.n - Math.abs(i - k) : 1e9); near = di < 25; }
      if (d < r.half + (near ? 0.6 : 4)) return true;
    }
    for (const p of this.pads) if (this.padSdf(p, x, z) < 6) return true;
    return false;
  }

  buildPads() {
    for (const p of this.pads) {
      const c = p.color || (p.type === 3 ? [0.5, 0.45, 0.38] : p.type === 4 ? [0.9, 0.89, 0.85] : [0.23, 0.23, 0.25]);
      const y = p.h + 0.01;
      if (p.r) {
        const seg = 48;
        for (let i = 0; i < seg; i++) {
          const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
          const g = this.batch.geo(p.x + Math.cos(a0) * p.r * 0.5, p.z + Math.sin(a0) * p.r * 0.5);
          g.tri([p.x, y, p.z], [p.x + Math.cos(a1) * p.r, y, p.z + Math.sin(a1) * p.r], [p.x + Math.cos(a0) * p.r, y, p.z + Math.sin(a0) * p.r], c);
        }
        if (p.markings === 'donut') {
          for (const rr of [p.r * 0.35, p.r * 0.7]) for (let i = 0; i < 40; i++) {
            if (i % 2) continue;
            const a0 = (i / 40) * Math.PI * 2, a1 = ((i + 1) / 40) * Math.PI * 2, g = this.batch.geo(p.x, p.z);
            const P = (a, r) => [p.x + Math.cos(a) * r, y + 0.03, p.z + Math.sin(a) * r];
            g.quad(P(a0, rr), P(a0, rr + 0.4), P(a1, rr + 0.4), P(a1, rr), [0.92, 0.92, 0.9]);
          }
        }
      } else {
        const g = this.batch.geo(p.x, p.z);
        g.at(p.x, y, p.z, p.yaw || 0);
        g.quad([-p.w / 2, 0, -p.d / 2], [-p.w / 2, 0, p.d / 2], [p.w / 2, 0, p.d / 2], [p.w / 2, 0, -p.d / 2], c);
        if (p.markings === 'lot') {
          for (let x = -p.w / 2 + 4; x < p.w / 2 - 3; x += 3.2) for (const zz of [-p.d / 2 + 4, p.d / 2 - 4]) g.box(x, 0.03, zz, 0.15, 0.01, 5, [0.9, 0.9, 0.85]);
        }
        if (p.markings === 'grid') { // practice pad: painted box lines + centre circle guides
          for (let x = -p.w / 2 + 20; x < p.w / 2 - 10; x += 40) g.box(x, 0.03, 0, 0.3, 0.01, p.d - 20, [0.82, 0.8, 0.74]);
          g.box(0, 0.03, 0, p.w - 20, 0.01, 0.3, [0.82, 0.8, 0.74]);
        }
        if (p.markings === 'strip') { // runway: centre dashes + threshold bars
          for (let z = -p.d / 2 + 30; z < p.d / 2 - 30; z += 24) g.box(0, 0.03, z, 0.8, 0.01, 12, [0.85, 0.84, 0.8]);
          for (const zz of [-p.d / 2 + 10, p.d / 2 - 10]) for (let x = -p.w / 2 + 5; x < p.w / 2 - 4; x += 4) g.box(x, 0.03, zz, 1.6, 0.01, 12, [0.85, 0.84, 0.8]);
        }
        g.reset();
      }
    }
  }

  buildWater() {
    const w = this.spec.water, s = this.size / 2, step = 60;
    for (let x = -s; x < s; x += step) for (let z = -s; z < s; z += step) {
      // only where terrain dips below water
      let any = false;
      for (let a = 0; a <= step && !any; a += 10) for (let b = 0; b <= step && !any; b += 10) if (this.heightAt(x + a, z + b) < w.y) any = true;
      if (!any) continue;
      this.batch.geo(x + step / 2, z + step / 2).quad([x, w.y, z], [x, w.y, z + step], [x + step, w.y, z + step], [x + step, w.y, z], w.color);
    }
  }

  buildBoundary() {
    const m = this.spec.boundary ?? 30, s = this.size / 2 - m;
    this.addSegment(-s, -s, s, -s); this.addSegment(s, -s, s, s); this.addSegment(s, s, -s, s); this.addSegment(-s, s, -s, -s);
    this.bound = s;
  }

  roadSpawns(ri, start, count = 12, back = 1) {
    const r = this.roads[ri], out = [];
    for (let k = 0; k < count; k++) {
      const row = Math.floor(k / 2), lane = k % 2 ? 1 : -1;
      const i = ((start - back * (row * 3 + 2)) % r.n + r.n) % r.n;
      const off = lane * r.half * 0.45;
      const x = r.x[i] + r.tz[i] * off, z = r.z[i] - r.tx[i] * off;
      out.push({ x, z, h: Math.atan2(r.tx[i], r.tz[i]) });
    }
    return out;
  }

  // ------------------------------------------------ colliders
  addCircle(x, z, r) { const c = [x, z, r]; this.circles.push(c); this.colHash.insert(x - r, z - r, x + r, z + r, { c }); }
  addSegment(ax, az, bx, bz) { const s = [ax, az, bx, bz]; this.segments.push(s); this.colHash.insert(Math.min(ax, bx), Math.min(az, bz), Math.max(ax, bx), Math.max(az, bz), { s }); }
  addBox(x, z, w, d, yaw = 0) {
    const c = Math.cos(yaw), s = Math.sin(yaw);
    const P = (lx, lz) => [x + lx * c + lz * s, z - lx * s + lz * c];
    const p = [P(-w / 2, -d / 2), P(w / 2, -d / 2), P(w / 2, d / 2), P(-w / 2, d / 2)];
    for (let i = 0; i < 4; i++) { const a = p[i], b = p[(i + 1) % 4]; this.addSegment(a[0], a[1], b[0], b[1]); }
  }
  // returns de-duplicated colliders near a point
  query(x, z) {
    const out = new Set();
    for (const dx of [-8, 8]) for (const dz of [-8, 8]) for (const it of this.colHash.at(x + dx, z + dz)) out.add(it);
    return out;
  }

  nearestReset(x, z) {
    let best = null, bd = 1e18;
    for (const p of this.resetPts) { const d = (p[0] - x) ** 2 + (p[1] - z) ** 2; if (d < bd) { bd = d; best = p; } }
    return best;
  }

  // ------------------------------------------------ fx helpers
  disc(arr, x, y, z, r, c, seg = 12) {
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
      arr.push(x, y, z, c[0], c[1], c[2], c[3], 0, 0,
        x + Math.cos(a1) * r, y, z + Math.sin(a1) * r, c[0], c[1], c[2], c[3], Math.cos(a1), Math.sin(a1),
        x + Math.cos(a0) * r, y, z + Math.sin(a0) * r, c[0], c[1], c[2], c[3], Math.cos(a0), Math.sin(a0));
    }
  }
  makeStaticFx(arr, additive) {
    const vcount = arr.length / 9;
    if (!vcount) return null;
    const b = new FxBuffer(this.renderer, vcount, additive);
    b.data.set(arr); b.count = vcount; b.markDirty(0, vcount);
    return b;
  }
  buildGates() {
    this.gates = [];
    const k = MAP_LOOP.indexOf(this.id), spots = GATE_SPOTS[this.id];
    if (k < 0 || !spots) return;
    const dests = [MAP_LOOP[(k + 1) % MAP_LOOP.length], MAP_LOOP[(k - 1 + MAP_LOOP.length) % MAP_LOOP.length]];
    spots.forEach((sp, gi) => {
      const spur = this.roads.find((r) => r.gateSpur === gi); // its side road (planGateSpurs), if there was room
      const rd = spur || this.roads[sp.road]; if (!rd) return;
      const i = spur ? rd.n - 6 : Math.round(sp.f * (rd.n - 1)), d = spur ? 1 : sp.dir;
      const x = rd.x[i], z = rd.z[i], y = rd.h[i], ex = rd.tx[i] * d, ez = rd.tz[i] * d; // exit direction
      const half = rd.half + 1.6, yaw = Math.atan2(ex, ez);
      const to = dests[gi], info = MAP_LIST.find((m) => m.id === to);
      const ac = info ? col(info.accent) : [1, 0.8, 0.3];
      const back = rd.closed ? ((i - d * 9) % rd.n + rd.n) % rd.n : Math.min(rd.n - 1, Math.max(0, i - d * 9));
      const spawn = { x: rd.x[back], z: rd.z[back], h: Math.atan2(-ex, -ez) };
      this.gates.push({ x, z, y, ex, ez, half, to, name: info ? info.name : to, spawn });
      // two pillars + crossbeam, and a glowing curtain in the destination map's colour
      const nx = ez, nz = -ex; // sideways
      const g = this.batch.geo(x, z);
      for (const s of [-1, 1]) {
        const px = x + nx * half * s, pz = z + nz * half * s, py = this.heightAt(px, pz);
        g.at(px, py, pz, yaw).box(0, 3.6, 0, 0.9, 7.2 + (y - py), 0.9, { top: [0.2, 0.2, 0.22], side: [0.16, 0.16, 0.18] }).reset();
        this.addCircle(px, pz, 0.6);
      }
      g.at(x, y, z, yaw).box(0, 7.4, 0, half * 2 + 0.9, 0.9, 0.9, { top: [0.2, 0.2, 0.22], side: [0.16, 0.16, 0.18], front: [...ac.map((v) => v * 0.9)], back: [...ac.map((v) => v * 0.9)] }).reset();
      const col4 = [ac[0], ac[1], ac[2], 0.35];
      const P = (s, yy) => [x + nx * half * s, y + yy, z + nz * half * s];
      const quad = (A, B, C2, D) => { for (const p of [A, B, C2, A, C2, D]) this.glowV.push(p[0], p[1], p[2], ...col4, 0, 0); };
      quad(P(-1, 0.2), P(-1, 6.9), P(1, 6.9), P(1, 0.2));
      // bright light bands: along the crossbeam (both faces) and up the inside of each pillar
      const band = [ac[0], ac[1], ac[2], 0.95], bx = ex * 0.47, bz = ez * 0.47;
      const bandQ = (A, B, C2, D) => { for (const p of [A, B, C2, A, C2, D]) this.glowV.push(p[0], p[1], p[2], ...band, 0, 0); };
      for (const f of [-1, 1]) {
        const o = (q) => [q[0] + bx * f, q[1], q[2] + bz * f];
        bandQ(o(P(-1.05, 7.1)), o(P(-1.05, 7.7)), o(P(1.05, 7.7)), o(P(1.05, 7.1)));
        for (const sd of [-1, 1]) { const w = sd * (half - 0.5) / half, w2 = sd * (half - 0.8) / half; bandQ(o(P(w, 0.3)), o(P(w, 6.9)), o(P(w2, 6.9)), o(P(w2, 0.3))); }
      }
      this.disc(this.glowV, x, y + 0.1, z, half * 1.2, [ac[0] * 0.5, ac[1] * 0.5, ac[2] * 0.5, 1], 20);
    });
  }
  challengeMarker(c) {
    const y = c.y + 0.1, seg = 40;
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
      const P = (a, r, yy) => { const x = c.x + Math.cos(a) * r, z = c.z + Math.sin(a) * r; return [x, this.heightAt(x, z) + 0.15 + (yy - y), z]; };
      const col4 = [1.0, 0.75, 0.15, 0.55];
      const q = (A, B, C2, D, ua, ub) => { for (const [p, uv] of [[A, ua], [B, ua], [C2, ub], [A, ua], [C2, ub], [D, ub]]) this.glowV.push(p[0], p[1], p[2], ...col4, uv[0], uv[1]); };
      if (i % 2 === 0) q(P(a0, c.r, y), P(a0, c.r - 0.8, y), P(a1, c.r - 0.8, y), P(a1, c.r, y), [0, 0], [0, 0]);
      if (i % 5 === 0) q(P(a0, c.r, y), P(a0, c.r, y + 8), P(a0 + 0.04, c.r, y + 8), P(a0 + 0.04, c.r, y), [0, 0], [0, 1]);
    }
  }

  ctx() {
    const W = this;
    return {
      rand: this.rand, q: this.q,
      geo: (x, z) => W.batch.geo(x, z),
      h: (x, z) => W.heightAt(x, z), sd: (x, z) => W.sdAt(x, z),
      circle: (x, z, r) => W.addCircle(x, z, r), box: (x, z, w, d, yaw) => W.addBox(x, z, w, d, yaw), seg: (...a) => W.addSegment(...a),
      shadow: (x, z, r, a = 0.35) => W.disc(W.shadowV, x, W.heightAt(x, z) + 0.06, z, r, [0, 0, 0, a]),
      glow: (x, y, z, r, c) => W.disc(W.glowV, x, y, z, r, c, 16),
      roads: W.roads, pads: W.pads, world: W,
      // scatter helper: tries `count` random points, keeps those passing `ok`
      scatter(count, fn, ok) {
        const s = W.bound || W.size / 2 - 40;
        for (let i = 0; i < count; i++) {
          const x = (W.rand() * 2 - 1) * (W.size / 2 - 10), z = (W.rand() * 2 - 1) * (W.size / 2 - 10);
          if (ok && !ok(x, z)) continue;
          fn(x, z, Math.abs(x) < s + 30 && Math.abs(z) < s + 30);
        }
      },
    };
  }
}

// ================================================================ scenery props
function pine(g, x, y, z, s, r, snow) {
  g.cylinder(x, y + 0.9 * s, z, 0.22 * s, 1.8 * s, 5, [0.35, 0.24, 0.15]);
  const green = mix3([0.12, 0.3, 0.16], [0.18, 0.38, 0.18], r());
  for (let k = 0; k < 3; k++) {
    const rr = (2.3 - k * 0.55) * s, yy = y + (1.4 + k * 1.6) * s;
    g.cone(x, yy, z, rr, 2.6 * s, 7, shade(green, 0.9 + k * 0.07));
  }
  if (snow) g.cone(x, y + 4.6 * s, z, 0.9 * s, 1.2 * s, 7, [0.95, 0.96, 1]);
}
function leafy(g, x, y, z, s, r, c) {
  g.cylinder(x, y + 1.2 * s, z, 0.25 * s, 2.4 * s, 5, [0.38, 0.27, 0.18]);
  g.blob(x, y + 3.4 * s, z, 2.2 * s, 1.9 * s, 2.2 * s, c || mix3([0.25, 0.48, 0.18], [0.45, 0.58, 0.2], r()), 0.25, r);
}
function rock(g, x, y, z, s, r, c = [0.5, 0.48, 0.46]) { g.blob(x, y + s * 0.3, z, s * (1 + r() * 0.5), s * (0.6 + r() * 0.5), s * (1 + r() * 0.5), shade(c, 0.85 + r() * 0.25), 0.5, r); }
function cactus(g, x, y, z, s, r) {
  const c = [0.28, 0.5, 0.25];
  g.cylinder(x, y + 2 * s, z, 0.35 * s, 4 * s, 6, c);
  const side = r() < 0.5 ? 1 : -1;
  g.cylinder(x + side * 0.8 * s, y + 2.5 * s, z, 0.25 * s, 2 * s, 6, c);
  g.box(x + side * 0.45 * s, y + 1.6 * s, z, 0.8 * s, 0.4 * s, 0.4 * s, c);
  if (r() < 0.6) { g.cylinder(x - side * 0.7 * s, y + 2.9 * s, z, 0.22 * s, 1.4 * s, 6, c); g.box(x - side * 0.4 * s, y + 2.3 * s, z, 0.7 * s, 0.35 * s, 0.35 * s, c); }
}
function cedar(g, x, y, z, s, r) { // tall, narrow, dark Japanese cedar
  g.cylinder(x, y + 1.6 * s, z, 0.2 * s, 3.2 * s, 5, [0.36, 0.24, 0.16]);
  const c = shade([0.16, 0.27, 0.17], 0.85 + r() * 0.3);
  g.cone(x, y + 2.4 * s, z, 1.5 * s, 4.2 * s, 7, c);
  g.cone(x, y + 4.6 * s, z, 1.15 * s, 3.6 * s, 7, shade(c, 1.08));
  g.cone(x, y + 6.6 * s, z, 0.75 * s, 3.0 * s, 6, shade(c, 1.15));
}
function stoneLantern(ctx, x, z) { // toro
  const y = ctx.h(x, z), g = ctx.geo(x, z), st = [0.6, 0.59, 0.56];
  g.box(x, y + 0.2, z, 0.9, 0.4, 0.9, st); g.cylinder(x, y + 1, z, 0.18, 1.2, 6, st);
  g.box(x, y + 1.8, z, 0.7, 0.55, 0.7, { side: [1, 0.75, 0.4, 0.6], top: st, bottom: st }); g.cone(x, y + 2.15, z, 0.7, 0.5, 6, st);
  ctx.circle(x, z, 0.5);
}
function vending(ctx, x, z, yaw) { // glowing roadside vending machine
  const y = ctx.h(x, z), g = ctx.geo(x, z);
  g.at(x, y, z, yaw).box(0, 0.95, 0, 1.0, 1.9, 0.8, { top: [0.8, 0.8, 0.84], side: [0.85, 0.86, 0.9], front: [0.55, 0.8, 1, 0.8] }).box(0, 1.3, 0.41, 0.8, 0.7, 0.02, [1, 1, 0.95, 1]).reset();
  ctx.box(x, z, 1.0, 0.8, yaw); ctx.glow(x, y + 0.08, z, 3, [0.25, 0.32, 0.38, 1]);
}
function lamp(ctx, x, z, yaw, night, colr = [1, 0.85, 0.55]) {
  const y = ctx.h(x, z), g = ctx.geo(x, z);
  g.cylinder(x, y + 3.5, z, 0.12, 7, 6, [0.25, 0.25, 0.28]);
  const ax = Math.sin(yaw) * 1.4, az = Math.cos(yaw) * 1.4;
  g.at(x + ax / 2, y + 7, z + az / 2, yaw).box(0, 0, 0, 0.12, 0.12, 1.5, [0.25, 0.25, 0.28]).reset();
  g.box(x + ax, y + 6.85, z + az, 0.5, 0.15, 0.8, [...colr, night ? 1 : 0.3]);
  ctx.circle(x, z, 0.3);
  if (night) ctx.glow(x + ax, y + 0.08, z + az, 9, [colr[0] * 0.35, colr[1] * 0.35, colr[2] * 0.35, 1]);
}
function tyres(ctx, x, z, n = 3) { // a small stack of old tyres (collides)
  const y = ctx.h(x, z), g = ctx.geo(x, z);
  for (let k = 0; k < n; k++) g.cylinder(x, y + 0.2 + k * 0.4, z, 0.55, 0.38, 8, k % 2 ? [0.12, 0.12, 0.13] : [0.16, 0.16, 0.17]);
  ctx.circle(x, z, 0.6);
}
function billboard(g, x, y, z, yaw, c1, c2) {
  g.at(x, y, z, yaw);
  g.box(-3, 2.5, 0, 0.3, 5, 0.3, [0.3, 0.3, 0.3]); g.box(3, 2.5, 0, 0.3, 5, 0.3, [0.3, 0.3, 0.3]);
  g.box(0, 6, 0, 9, 3.2, 0.3, { side: [0.2, 0.2, 0.2], front: c1, back: c2, top: [0.2, 0.2, 0.2] });
  g.box(-1.5, 6.3, 0.17, 4, 0.8, 0.05, [1, 1, 1]);
  g.reset();
}
function building(ctx, x, z, w, d, h, c, night, r) {
  const y = ctx.h(x, z) - 0.2, g = ctx.geo(x, z);
  g.box(x, y + h / 2, z, w, h, d, { top: shade(c, 0.8), side: c, noBottom: true });
  // windows: rows of lit/unlit bands
  const rows = Math.floor((h - 4) / 3.4);
  for (let f = 0; f < 4; f++) {
    const along = f % 2 === 0 ? w : d, nx = f === 1 ? 1 : f === 3 ? -1 : 0, nz = f === 0 ? 1 : f === 2 ? -1 : 0;
    const segs = Math.max(1, Math.floor(along / 7));
    for (let k = 0; k < rows; k++) for (let s = 0; s < segs; s++) {
      const lit = night && r() < 0.42;
      const wc = lit ? [...(r() < 0.7 ? [1, 0.82, 0.5] : [0.86, 0.88, 0.86]), 0.85] : night ? [0.06, 0.07, 0.1] : [0.25, 0.32, 0.4];
      const u = -along / 2 + (s + 0.5) * (along / segs), yy = y + 3.5 + k * 3.4;
      const cx = x + nx * (w / 2 + 0.04) + (nz ? u : 0), cz = z + nz * (d / 2 + 0.04) + (nx ? u : 0);
      const hw = (along / segs - 1.6) / 2, tx = nz ? 1 : 0, tz = nx ? 1 : 0, s2 = nx + nz; // tangent along the face
      const A = [cx - tx * hw * s2, yy - 0.75, cz - tz * hw * s2 * -1], B = [cx + tx * hw * s2, yy - 0.75, cz + tz * hw * s2 * -1];
      g.quad(A, B, [B[0], yy + 0.75, B[2]], [A[0], yy + 0.75, A[2]], wc);
    }
  }
  // roof stuff
  if (r() < 0.7) g.box(x + (r() - 0.5) * w * 0.4, y + h + 1, z + (r() - 0.5) * d * 0.4, 3, 2, 3, [0.4, 0.4, 0.42]);
  if (night && r() < 0.35) g.box(x, y + h + 2, z, 0.2, 4, 0.2, [1, 0.1, 0.1, 1]);
}

// ================================================================ MAP SPECS
const SPECS = {
  // ------------------------------------------------------------- RACE TRACK
  track(q) {
    const n = makeNoise(11);
    const grassA = col('#4f8a3a'), grassB = col('#5c9a44'), far = col('#6b9a4a');
    return {
      seed: 101, size: 1300, natural: 'grass', boundary: 60, blend: 26,
      terrain: (x, z) => n.fbm(x / 300, z / 300, 3) * 4 + smoothstep(575, 650, Math.max(Math.abs(x), Math.abs(z))) * 25,
      color: (x, z, h, slope, sd) => {
        if (sd < 40) return ((Math.floor((x + z) / 10) & 1) ? grassA : grassB);
        return mix3(grassB, far, smoothstep(40, 200, sd));
      },
      shoulder: col('#8a8a7a'),
      roads: GEO.track.roads.map((r, i) => i === 0 ? { ...r, kerbs: true, walls: 22, color: [0.22, 0.22, 0.24], startLine: 30, smooth: 20 }
        : i === 2 ? { ...r, kerbs: true, color: [0.22, 0.22, 0.24] }
        : { ...r, color: [0.25, 0.25, 0.26], edge: i !== 1 }),
      pads: [
        { ...GEO.track.pads[0], type: 2, markings: 'donut' },
        { ...GEO.track.pads[1], type: 2, markings: 'lot' },
        { ...GEO.track.pads[2], type: 2, markings: 'lot' },
        { ...GEO.track.pads[3], type: 2, color: [0.27, 0.27, 0.29] },
      ],
      spawns: (W) => W.roadSpawns(0, 30, 12, 1),
      challenges: [
        { name: 'Skidpad Spin', x: 75, z: -210, r: 80, target: 18000, time: 30 },
        { name: 'Carousel', x: 395, z: 275, r: 75, target: 12000, time: 25 },
        { name: 'Hairpin', x: -312, z: 312, r: 75, target: 10000, time: 25 },
        { name: 'Autocross Pad', x: -330, z: 20, r: 60, target: 15000, time: 30 },
      ],
      env: {
        sky: { top: col('#2f6fdc'), horizon: col('#bcd8f0'), bottom: col('#9fb7a0') },
        sunDir: norm([0.45, 0.8, 0.3]), sunCol: [1.0, 0.95, 0.85], ambSky: [0.48, 0.56, 0.7], ambGround: [0.3, 0.32, 0.24],
        fogCol: col('#bcd8f0'), fogNear: 260, fogFar: 950, night: false, music: 'bright',
      },
      scenery(c) {
        const r = c.rand;
        // grandstands along main straight (inside of track)
        for (let i = 0; i < 4; i++) {
          const x = -210 + i * 70, z = -343, g = c.geo(x, z), y = c.h(x, z);
          for (let k = 0; k < 6; k++) g.box(x, y + 0.6 + k * 0.9, z + 2 + k * 1.6, 60, 1.2 + k * 1.8, 1.8, { top: (k % 2 ? [0.85, 0.2, 0.2] : [0.2, 0.35, 0.8]), side: [0.6, 0.6, 0.62] });
          g.box(x, y + 12, z + 6, 62, 0.4, 14, [0.9, 0.9, 0.92]);
          for (const sx of [-30, 30]) g.box(x + sx, y + 6, z + 12, 0.5, 12, 0.5, [0.5, 0.5, 0.5]);
          c.box(x, z + 6, 62, 12);
        }
        // pit building by paddock
        { const x = 0, z = -477, g = c.geo(x, z), y = c.h(x, z);
          g.box(x, y + 4, z, 280, 8, 16, { top: [0.8, 0.8, 0.82], side: [0.93, 0.93, 0.95] });
          for (let i = 0; i < 14; i++) g.box(-130 + i * 20, y + 2.5, z + 8.05, 14, 4.5, 0.1, [0.15, 0.18, 0.25]);
          g.box(x, y + 9, z, 60, 3, 10, [0.15, 0.15, 0.17]); c.box(x, z, 280, 16); }
        // start gantry
        { const rd = c.roads[0], i = rd.startLine, x = rd.x[i], z = rd.z[i], y = rd.h[i], g = c.geo(x, z);
          const yaw = Math.atan2(rd.tx[i], rd.tz[i]);
          g.at(x, y, z, yaw);
          for (const sx of [-10.5, 10.5]) g.box(sx, 4, 0, 0.8, 8, 0.8, [0.3, 0.3, 0.32]);
          g.box(0, 8, 0, 22, 1.6, 1.2, { side: [0.15, 0.15, 0.18], front: [0.9, 0.1, 0.1], back: [0.9, 0.1, 0.1] });
          for (let k = -4; k <= 4; k++) g.box(k * 1.6, 8, 0.65, 0.6, 0.6, 0.1, [1, 0.2, 0.15, 1]);
          g.reset();
          const P = (s) => [x + rd.tz[i] * s, z - rd.tx[i] * s];
          for (const s of [-10.5, 10.5]) { const p = P(s); c.circle(p[0], p[1], 0.6); } }
        // trees & billboards outside the walls
        c.scatter(Math.floor(4200 * q.density), (x, z) => {
          const y = c.h(x, z), g = c.geo(x, z), s = 0.8 + r() * 0.7;
          if (r() < 0.5) pine(g, x, y, z, s * 1.2, r); else leafy(g, x, y, z, s, r);
          c.circle(x, z, 0.5 * s); c.shadow(x, z, 2.6 * s);
        }, (x, z) => c.sd(x, z) > 30);
        for (let i = 0; i < 20; i++) {
          const rd = c.roads[0], k = Math.floor(r() * rd.n), side = r() < 0.5 ? -1 : 1, off = rd.half + 27;
          const x = rd.x[k] + rd.tz[k] * off * side, z = rd.z[k] - rd.tx[k] * off * side;
          if (c.sd(x, z) < 24) continue;
          const pal = [[0.9, 0.2, 0.2], [0.2, 0.4, 0.9], [1, 0.75, 0.1], [0.1, 0.7, 0.5]];
          billboard(c.geo(x, z), x, c.h(x, z), z, Math.atan2(rd.tx[k], rd.tz[k]) + Math.PI / 2, pal[i % 4], pal[(i + 1) % 4]);
          c.box(x, z, 9, 1, Math.atan2(rd.tx[k], rd.tz[k]) + Math.PI / 2);
        }
        // light towers
        for (const [x, z] of [[-325, -412], [325, -412], [40, 40], [-475, -40], [475, -60], [-80, 330], [80, 330]]) {
          const y = c.h(x, z), g = c.geo(x, z);
          g.cylinder(x, y + 12, z, 0.5, 24, 6, [0.5, 0.5, 0.52]); g.box(x, y + 24, z, 5, 3, 1, [0.9, 0.92, 0.95, 0.5]); c.circle(x, z, 0.8);
        }
        // autocross pad: tyre-stack cones marking a slalom + corner tyre walls
        for (const [x, z] of [[-370, -10], [-345, 25], [-320, -10], [-295, 25], [-370, 55], [-295, 55]]) tyres(c, x, z);
      },
    };
  },

  // ------------------------------------------------------------- DESERT
  desert(q) {
    const n = makeNoise(23);
    const mesas = [[-1280, 900, 120], [-780, 1000, 190], [-1320, 1200, 200], [-780, 640, 180], [400, -1050, 150], [-500, -1050, 140], [1050, 500, 170], [450, 1100, 120], [-500, 850, 120], [-1500, -850, 80], [-450, -500, 70], [450, -500, 70], [700, 750, 80], [-1200, -1250, 70], [1250, -1050, 70], [-600, 1350, 90], [1250, 1450, 70], [1700, 800, 80], [-1700, -1100, 90], [1700, -1500, 90]];
    const sand = col('#e3b97a'), sand2 = col('#d4a467'), salt = col('#ece7da'), rockC = col('#b56a43'), rockD = col('#8e4f35');
    const terrain = (x, z) => {
      let h = n.fbm(x / 170, z / 170, 4) * 7 + Math.sin(x / 37 + n(x / 90, z / 90) * 3) * 1.2;
      const e = Math.max(Math.abs(x), Math.abs(z));
      h += n.fbm(x / 420, z / 420, 3) * 10; // big rolling dunes
      h += smoothstep(1790, 1960, e) * (50 + n.ridge(x / 160, z / 160, 3) * 80);
      for (const [mx, mz, mr] of mesas) {
        const d = Math.hypot(x - mx, z - mz) + n(x / 40, z / 40) * 18;
        h += smoothstep(mr, mr * 0.8, d) * 55;
      }
      return h;
    };
    return {
      seed: 202, size: 4000, cellMul: 1.4, natural: 'sand', boundary: 80, blend: 24,
      terrain,
      color: (x, z, h, slope, sd) => {
        if (h > 22 || slope > 0.55) return mix3(rockC, rockD, (Math.floor(h / 4) & 1) * 0.6 + n(x / 20, z / 20) * 0.2);
        return mix3(sand, sand2, n(x / 25, z / 25) * 0.5 + 0.5);
      },
      shoulder: col('#c99b62'),
      roads: GEO.desert.roads.map((r, i) => i <= 1 ? { ...r, center: 'dash', color: [0.26, 0.25, 0.25], smooth: 24 }
        : i === 7 ? { ...r, surface: 3, color: [0.5, 0.42, 0.32], edge: false } // dusty gravel track
        : { ...r, center: i <= 6 ? 'dash' : undefined, color: [0.26, 0.25, 0.25] }),
      pads: [
        { ...GEO.desert.pads[0], type: 4, color: salt, h: -1 },
        { ...GEO.desert.pads[1], type: 2 },
        { ...GEO.desert.pads[2], type: 2, color: [0.3, 0.29, 0.28], markings: 'strip', h: -1 }, // same level as the flat it joins
        { ...GEO.desert.pads[3], type: 3, color: [0.55, 0.45, 0.33] },
        { ...GEO.desert.pads[4], type: 4, color: col('#e6dccb'), h: -1 }, // dry lake bed
      ],
      spawns: (W) => W.roadSpawns(0, 70, 12, 1),
      challenges: [
        { name: 'Salt Flat Frenzy', x: 0, z: 0, r: 100, target: 20000, time: 30 },
        { name: 'Dry Lake Donuts', x: 900, z: 1010, r: 90, target: 20000, time: 30 },
        { name: 'Highway Sweeper', x: 1650, z: -1000, r: 80, target: 12000, time: 25 },
        { name: 'Canyon Run', x: -1120, z: 960, r: 80, target: 12000, time: 25 },
        { name: 'Airstrip Slide', x: 900, z: -900, r: 70, target: 15000, time: 30 },
      ],
      env: {
        sky: { top: col('#4a5f9c'), horizon: col('#ffb36b'), bottom: col('#d7a06a') },
        sunDir: norm([-0.65, 0.32, 0.55]), sunCol: [1.15, 0.82, 0.55], sunGlow: [1.3, 0.8, 0.4], ambSky: [0.55, 0.5, 0.58], ambGround: [0.5, 0.38, 0.28],
        fogCol: col('#f0b886'), fogNear: 350, fogFar: 1300, night: false, music: 'warm',
      },
      scenery(c) {
        const r = c.rand;
        c.scatter(Math.floor(7000 * q.density), (x, z, inPlay) => {
          const y = c.h(x, z), g = c.geo(x, z), k = r();
          if (k < 0.45) { const s = 0.8 + r() * 0.6; cactus(g, x, y, z, s, r); if (inPlay) c.circle(x, z, 0.45 * s); c.shadow(x, z, 1.2 * s, 0.3); }
          else if (k < 0.75) { const s = 0.8 + r() * 2.2; rock(g, x, y, z, s, r, [0.7, 0.45, 0.32]); if (inPlay) c.circle(x, z, s * 1.1); }
          else g.blob(x, y + 0.4, z, 0.9, 0.5, 0.9, [0.55, 0.5, 0.3], 0.4, r);
        }, (x, z) => c.sd(x, z) > 10);
        // power line poles along the highway and the interstate
        for (const rd of [c.roads[0], c.roads[1]]) for (let i = 0; i < rd.n; i += 14) {
          const off = rd.half + 9, x = rd.x[i] + rd.tz[i] * off, z = rd.z[i] - rd.tx[i] * off;
          if (c.sd(x, z) < 6) continue;
          const y = c.h(x, z), g = c.geo(x, z), yaw = Math.atan2(rd.tx[i], rd.tz[i]);
          g.cylinder(x, y + 5, z, 0.18, 10, 5, [0.4, 0.3, 0.22]);
          g.at(x, y + 9.4, z, yaw + Math.PI / 2).box(0, 0, 0, 0.15, 0.15, 3, [0.4, 0.3, 0.22]).reset();
          c.circle(x, z, 0.3);
        }
        // gas station
        { const x = 1450, z = 450, y = c.h(x, z), g = c.geo(x, z);
          g.at(x, y, z, 0.3);
          g.box(0, 5.5, 0, 26, 0.8, 16, { top: [0.9, 0.9, 0.9], side: [0.85, 0.15, 0.12] });
          for (const [px, pz] of [[-10, -6], [10, -6], [-10, 6], [10, 6]]) g.box(px, 2.7, pz, 0.6, 5.4, 0.6, [0.9, 0.9, 0.9]);
          for (const px of [-4, 4]) g.box(px, 0.9, 0, 1, 1.8, 2.2, { side: [0.85, 0.85, 0.85], front: [0.85, 0.15, 0.12] });
          g.box(0, 3, 22, 20, 6, 10, { top: [0.6, 0.55, 0.5], side: [0.92, 0.86, 0.75] });
          g.box(0, 3, 16.95, 12, 2.5, 0.1, [0.4, 0.6, 0.7]);
          g.box(16, 9, 18, 0.5, 18, 0.5, [0.5, 0.5, 0.5]); g.box(16, 17, 18, 5, 3, 0.4, [1, 0.6, 0.1, 0.4]);
          g.reset();
          c.box(x, z, 26, 16, 0.3); c.box(x + Math.sin(0.3) * 22, z + Math.cos(0.3) * 22, 20, 10, 0.3);
        }
        // abandoned trailer + signs
        { const x = 300, z = 620, y = c.h(x, z), g = c.geo(x, z);
          g.at(x, y, z, 0.6).box(0, 1.6, 0, 3, 2.6, 9, { top: [0.75, 0.75, 0.78], side: [0.82, 0.8, 0.75] }).box(0, 0.4, -2, 3.2, 0.3, 0.3, [0.1, 0.1, 0.1]).reset();
          c.box(x, z, 3, 9, 0.6); }
        // ghost town: weathered wooden shacks around the gravel square
        for (const [x, z, w, d, yaw] of [[-965, -970, 12, 9, 0.1], [-962, -1028, 10, 8, -0.05], [-838, -958, 11, 8, 0.05], [-840, -1046, 14, 9, -0.1], [-900, -1062, 9, 7, 0]]) {
          const y = c.h(x, z), g = c.geo(x, z), wood = shade([0.55, 0.42, 0.3], 0.8 + r() * 0.3);
          g.at(x, y, z, yaw).box(0, 2, 0, w, 4, d, { top: [0.42, 0.33, 0.26], side: wood }).box(0, 4.6, 0, w + 1, 0.4, d + 1, [0.38, 0.3, 0.24]).box(0, 1.2, d / 2 + 0.05, 1.4, 2.4, 0.1, [0.2, 0.15, 0.1]).reset();
          c.box(x, z, w, d, yaw);
        }
        { const x = -860, z = -1000, y = c.h(x, z), g = c.geo(x, z); // water tower
          for (const [sx, sz] of [[-2, -2], [2, -2], [2, 2], [-2, 2]]) { g.cylinder(x + sx, y + 4, z + sz, 0.2, 8, 5, [0.4, 0.3, 0.22]); c.circle(x + sx, z + sz, 0.3); }
          g.cylinder(x, y + 10, z, 3, 4, 10, [0.5, 0.4, 0.3]); g.cone(x, y + 12.8, z, 3.3, 1.6, 10, [0.4, 0.32, 0.26]); }
        // airstrip hangar + windsock beside the runway
        { const x = 960, z = -840, y = c.h(x, z), g = c.geo(x, z), yaw = 2.356;
          g.at(x, y, z, yaw).box(0, 5, 0, 30, 10, 24, { top: [0.62, 0.6, 0.56], side: [0.72, 0.7, 0.66], front: [0.35, 0.33, 0.3] }).reset();
          c.box(x, z, 30, 24, yaw);
          g.cylinder(840, c.h(840, -960) + 4, -960, 0.1, 8, 5, [0.6, 0.6, 0.6]); g.cone(840.8, c.h(840, -960) + 7.6, -960, 0.5, 1.8, 6, [0.85, 0.45, 0.2]); c.circle(840, -960, 0.3); }
      },
    };
  },

  // ------------------------------------------------------------- MOUNTAINS
  mountain(q) {
    const n = makeNoise(37);
    const terrain = (x, z) => {
      const rr = Math.hypot(x, z);
      let h = 300 * Math.exp(-((rr / 900) ** 2));
      h += n.ridge(x / 300, z / 300, 4) * 55 - 22 + n.fbm(x / 70, z / 70, 2) * 5;
      const e = Math.max(Math.abs(x), Math.abs(z));
      h += smoothstep(1500, 1650, e) * (110 + n.ridge(x / 170, z / 170, 3) * 140);
      return h;
    };
    const grass = col('#4a6b3a'), grass2 = col('#5e7b3e'), cedarFloor = col('#3d5233'), rockC = col('#6f6a68'), snow = col('#eef2f7');
    return {
      seed: 303, size: 3400, cellMul: 1.15, natural: 'dirt', boundary: 70, blend: 20,
      terrain,
      color: (x, z, h, slope, sd) => {
        let c = mix3(grass, grass2, n(x / 30, z / 30) * 0.5 + 0.5);
        c = mix3(c, cedarFloor, smoothstep(60, 140, h) * 0.6);
        c = mix3(c, rockC, smoothstep(0.45, 0.8, slope));
        return mix3(c, snow, smoothstep(305, 335, h + n(x / 25, z / 25) * 12) * (1 - smoothstep(0.9, 1.3, slope)));
      },
      shoulder: col('#6b5f50'),
      // touge roads: narrow, guardrails both sides, orange no-overtaking centre line like Japanese passes
      roads: GEO.mountain.roads.map((r, i) => i === 0 ? { ...r, center: 'dash', color: [0.25, 0.25, 0.27], smooth: 22, maxGrade: 0.1 }
        : i === 5 ? { ...r, surface: 3, color: [0.4, 0.36, 0.3], edge: false, maxGrade: 0.15 }
        : i === 4 ? { ...r, color: [0.25, 0.25, 0.27], maxGrade: 0.14 }
        : { ...r, center: 'dash', centerColor: [0.98, 0.62, 0.12], guardrails: true, color: [0.24, 0.24, 0.26], smooth: 14, maxGrade: 0.14 }),
      pads: [
        { ...GEO.mountain.pads[0], type: 2, markings: 'lot' },
        { ...GEO.mountain.pads[1], type: 2, markings: 'lot' },
        { ...GEO.mountain.pads[2], type: 2, markings: 'lot' },
        { ...GEO.mountain.pads[3], type: 3, color: [0.42, 0.37, 0.3] },
      ],
      spawns: (W) => { // at the foot of the uphill, facing up the pass
        const r = W.roads[1]; let bi = 0, bd = 1e18;
        for (let i = 0; i < r.n; i++) { const d = (r.x[i] - 20) ** 2 + (r.z[i] + 1200) ** 2; if (d < bd) { bd = d; bi = i; } }
        return W.roadSpawns(1, bi, 12, 1);
      },
      challenges: [
        { name: 'Five Hairpins', x: 0, z: -750, r: 90, target: 12000, time: 30 },
        { name: 'Irohazaka', x: 0, z: 410, r: 100, target: 14000, time: 30 },
        { name: 'Summit Donuts', x: 0, z: 60, r: 45, target: 14000, time: 25 },
        { name: 'Ridge Esses', x: 700, z: 0, r: 90, target: 11000, time: 25 },
      ],
      env: {
        sky: { top: col('#2e3d5e'), horizon: col('#e39c74'), bottom: col('#6e5f58') },
        sunDir: norm([0.75, 0.16, -0.35]), sunCol: [1.0, 0.68, 0.5], sunGlow: [1.2, 0.6, 0.38], ambSky: [0.44, 0.46, 0.58], ambGround: [0.26, 0.24, 0.22],
        fogCol: col('#9a8a84'), fogNear: 260, fogFar: 1200, night: false, headlights: true, music: 'dusk',
      },
      scenery(c) {
        const r = c.rand;
        // tall dark Japanese cedars on the slopes, lighter pines down in the valley
        c.scatter(Math.floor(13000 * q.density), (x, z, inPlay) => {
          const y = c.h(x, z);
          if (y > 312) return;
          const g = c.geo(x, z), s = 0.9 + r() * 0.8;
          if (y > 70 && r() < 0.75) cedar(g, x, y, z, s * 1.4, r); else pine(g, x, y, z, s * 1.3, r, y > 290);
          if (inPlay) c.circle(x, z, 0.5 * s); c.shadow(x, z, 2.6 * s, 0.3);
        }, (x, z) => c.sd(x, z) > 9);
        c.scatter(Math.floor(1400 * q.density), (x, z, inPlay) => {
          const s = 1 + r() * 2.5; rock(c.geo(x, z), x, c.h(x, z), z, s, r, [0.55, 0.53, 0.52]); if (inPlay) c.circle(x, z, s);
        }, (x, z) => c.sd(x, z) > 8);
        // red/white chevron boards on the outside of every tight corner of the touge roads
        for (const ri of [1, 2, 3]) {
          const rd = c.roads[ri]; let last = -99;
          for (let i = 3; i < rd.n - 3; i++) {
            const cr = rd.tx[i - 3] * rd.tz[i + 3] - rd.tz[i - 3] * rd.tx[i + 3]; // turn rate over 18 m
            if (Math.abs(cr) < 0.55 || i - last < 7) continue;
            last = i;
            const side = cr > 0 ? 1 : -1, off = rd.half + 2.6; // outside of the bend
            const x = rd.x[i] + rd.tz[i] * off * side, z = rd.z[i] - rd.tx[i] * off * side;
            if (c.sd(x, z) < rd.half - 0.5) continue;
            const y = c.h(x, z), g = c.geo(x, z), yaw = Math.atan2(rd.tx[i], rd.tz[i]);
            g.at(x, y, z, yaw);
            g.box(0, 0.6, 0, 0.12, 1.2, 0.12, [0.3, 0.3, 0.32]);
            g.box(0, 1.5, 0, 0.08, 0.7, 1.4, { top: [0.9, 0.9, 0.9], side: [0.95, 0.95, 0.95] });
            for (const k of [-0.45, 0, 0.45]) g.box(0.05, 1.5, k, 0.02, 0.5, 0.18, [0.85, 0.1, 0.08]);
            g.reset(); c.circle(x, z, 0.25);
          }
        }
        // summit: shrine torii, stone lanterns, vending machines and a lookout lamp ring
        { const x = 0, z = 120, y = c.h(x, z), g = c.geo(x, z);
          g.box(x, y + 0.3, z, 10, 0.6, 7, [0.55, 0.55, 0.55]);
          for (const sx of [-4, 4]) g.box(x + sx, y + 3, z, 0.6, 5.5, 0.6, [0.75, 0.15, 0.1]);
          g.box(x, y + 5.9, z, 11, 0.6, 1, [0.75, 0.15, 0.1]); g.box(x, y + 5.0, z, 9, 0.4, 0.6, [0.75, 0.15, 0.1]);
          c.circle(x - 4, z, 0.5); c.circle(x + 4, z, 0.5); }
        for (const [x, z] of [[-55, 20], [-55, 100], [55, 100], [-20, 112], [20, 112]]) stoneLantern(c, x, z);
        for (const [x, z, yaw] of [[-62, 50, Math.PI / 2], [-62, 54, Math.PI / 2]]) vending(c, x, z, yaw);
        for (const [lx, lz] of [[-60, 70], [60, 30], [30, 100]]) lamp(c, lx, lz, 0, true);
        // base car park: lamps, vending machines, a small tea house
        for (const [lx, lz] of [[-125, -1290], [-125, -1235], [-25, -1290], [-25, -1235]]) lamp(c, lx, lz, lx < -70 ? Math.PI / 2 : -Math.PI / 2, true);
        for (const [x, z] of [[-128, -1270], [-128, -1266]]) vending(c, x, z, Math.PI / 2);
        { const x = -75, z = -1310, y = c.h(x, z), g = c.geo(x, z);
          g.box(x, y + 2.6, z, 22, 5.2, 9, { top: [0.3, 0.25, 0.22], side: [0.85, 0.8, 0.7] });
          g.at(x, y + 5.2, z, Math.PI / 2).extrude([[-5.5, 0], [5.5, 0], [0, 2.6]], 23, 0.05, [0.22, 0.22, 0.25]).reset();
          g.box(x, y + 2.0, z + 4.55, 14, 2.2, 0.1, [1, 0.8, 0.5, 0.8]); c.box(x, z, 22, 9); }
        // north-west village: timber houses with dark tiled roofs
        for (const [x, z, yaw] of [[-640, 800, 0.1], [-760, 800, -0.05], [-640, 885, 0.08], [-780, 900, 0.15], [-700, 930, 0]]) {
          const y = c.h(x, z) - 0.2, g = c.geo(x, z);
          g.at(x, y, z, yaw).box(0, 2.5, 0, 12, 5, 9, { top: [0.3, 0.28, 0.27], side: [0.78, 0.72, 0.62] }).box(0, 1.6, 4.55, 4, 2, 0.1, [1, 0.8, 0.5, 0.75]).reset();
          g.at(x, y + 5, z, yaw).extrude([[-5.3, 0], [5.3, 0], [0, 3]], 13, 0.05, [0.22, 0.22, 0.25]).reset();
          c.box(x, z, 12, 9, yaw);
        }
        for (const [lx, lz] of [[-660, 840], [-740, 840]]) lamp(c, lx, lz, 0, true);
        for (const [x, z] of [[-745, 862], [-741, 862]]) vending(c, x, z, Math.PI);
      },
    };
  },

  // ------------------------------------------------------------- FOREST
  forest(q) {
    const n = makeNoise(41);
    const lake = [156, 156, 135];
    const terrain = (x, z) => {
      let h = n.fbm(x / 260, z / 260, 4) * 18 + n.fbm(x / 60, z / 60, 2) * 3;
      const d = Math.hypot(x - lake[0], z - lake[1]) + n(x / 40, z / 40) * 15;
      h = lerp(Math.max(h, 0.6 + Math.abs(h) * 0.15), -6, smoothstep(lake[2] + 40, lake[2] - 20, d));
      h += smoothstep(660, 770, Math.max(Math.abs(x), Math.abs(z))) * 35;
      return h;
    };
    const g1 = col('#3f6b35'), g2 = col('#557d3d'), dirt = col('#6b5a43'), shore = col('#bfae85');
    return {
      seed: 404, size: 1600, natural: 'dirt', boundary: 60, blend: 22,
      terrain,
      water: { y: -1.2, color: [0.22, 0.42, 0.48] },
      color: (x, z, h, slope, sd) => {
        if (h < 0.2) return shore;
        let c = mix3(g1, g2, n(x / 18, z / 18) * 0.5 + 0.5);
        if (n(x / 50, z / 50) > 0.4) c = mix3(c, dirt, 0.4);
        return c;
      },
      shoulder: col('#6e5e48'),
      roads: GEO.forest.roads.map((r, i) => i === 0 ? { ...r, center: 'dash', color: [0.25, 0.25, 0.26], smooth: 14 }
        : i === 4 || i === 6 || i === 7 ? { ...r, surface: 3, color: [0.42, 0.37, 0.3], edge: false } // gravel trails
        : i === 1 ? { ...r, color: [0.3, 0.28, 0.25], edge: false }
        : { ...r, center: 'dash', color: [0.26, 0.26, 0.27] }),
      pads: [
        { ...GEO.forest.pads[0], type: 3 },
        { ...GEO.forest.pads[1], type: 2, markings: 'lot' },
        { ...GEO.forest.pads[2], type: 3, color: [0.55, 0.52, 0.47] },
      ],
      spawns: (W) => W.roadSpawns(0, 40, 12, 1),
      challenges: [
        { name: 'Gravel Clearing', x: -228, z: -195, r: 95, target: 16000, time: 30 },
        { name: 'Lakeside Esses', x: 533, z: 156, r: 85, target: 11000, time: 25 },
        { name: 'North Bend', x: 390, z: 533, r: 80, target: 10000, time: 25 },
        { name: 'Quarry Bowl', x: -435, z: -630, r: 58, target: 14000, time: 30 },
      ],
      env: {
        sky: { top: col('#5d8fc9'), horizon: col('#d6e2da'), bottom: col('#7d8f78') },
        sunDir: norm([0.35, 0.55, 0.65]), sunCol: [1.0, 0.94, 0.8], ambSky: [0.46, 0.56, 0.6], ambGround: [0.22, 0.28, 0.18],
        fogCol: col('#b5c6bd'), fogNear: 110, fogFar: 650, night: false, music: 'calm',
      },
      scenery(c) {
        const r = c.rand;
        c.scatter(Math.floor(10500 * q.density), (x, z, inPlay) => {
          const y = c.h(x, z);
          if (y < 0.6) return;
          const g = c.geo(x, z), s = 0.9 + r() * 0.8;
          if (r() < 0.62) pine(g, x, y, z, s * 1.35, r); else leafy(g, x, y, z, s * 1.1, r, r() < 0.2 ? [0.8, 0.5, 0.15] : undefined);
          if (inPlay) c.circle(x, z, 0.5 * s); c.shadow(x, z, 2.8 * s, 0.32);
        }, (x, z) => c.sd(x, z) > 8);
        c.scatter(Math.floor(850 * q.density), (x, z, inPlay) => {
          const y = c.h(x, z); if (y < 0) return;
          const g = c.geo(x, z), s = 0.5 + r() * 1.5;
          if (r() < 0.5) { rock(g, x, y, z, s, r, [0.5, 0.5, 0.48]); if (inPlay) c.circle(x, z, s); }
          else g.blob(x, y + 0.5, z, 1.2, 0.8, 1.2, [0.25, 0.42, 0.2], 0.3, r);
        }, (x, z) => c.sd(x, z) > 6);
        // log cabin + jetty
        { const x = 228, z = -395, y = c.h(x, z), g = c.geo(x, z);
          g.box(x, y + 2.5, z, 14, 5, 9, { top: [0.4, 0.28, 0.2], side: [0.55, 0.38, 0.25] });
          g.at(x, y + 5, z, 0).extrude([[-5, 0], [5, 0], [0, 3.2]], 15, 0.05, [0.3, 0.2, 0.16]).reset();
          c.box(x, z, 14, 9); }
        { const x = 30, z = 160, g = c.geo(x, z); g.box(x, -0.6, z, 20, 0.4, 3, [0.5, 0.36, 0.22]); }
        // quarry: rock faces round the bowl + a rusty conveyor
        for (let k = 0; k < 14; k++) { const a = -0.6 + k * 0.33, x = -435 + Math.cos(a) * 74, z = -630 + Math.sin(a) * 74; if (c.sd(x, z) < 6) continue; rock(c.geo(x, z), x, c.h(x, z), z, 4 + r() * 3, r, [0.55, 0.53, 0.5]); c.circle(x, z, 4.5); }
        { const x = -485, z = -665, y = c.h(x, z), g = c.geo(x, z);
          g.at(x, y, z, 0.7).box(0, 4, 0, 2.4, 0.5, 22, [0.5, 0.33, 0.2]).box(0, 2, -9, 0.4, 4, 0.4, [0.4, 0.3, 0.2]).box(0, 2, 9, 0.4, 4, 0.4, [0.4, 0.3, 0.2]).reset(); }
      },
    };
  },

  // ------------------------------------------------------------- CITY
  city(q) {
    const { B, ST, K } = CITY; // block pitch, street width, half count
    const lines = []; for (let i = -K; i <= K; i++) lines.push(i * B);
    const blocks = [];
    for (let i = 0; i < 2 * K; i++) for (let j = 0; j < 2 * K; j++) blocks.push({ i, j, x: (i - K + 0.5) * B, z: (j - K + 0.5) * B });
    const has = (list, b) => list.some(([i, j]) => b.i === i && b.j === j);
    const kind = (b) => {
      if ((b.i === K - 1 || b.i === K) && (b.j === K - 1 || b.j === K)) return 'plaza';
      if (b.i === b.j) return 'diag'; // the diagonal boulevard cuts these blocks into two small parks
      if (has([[1, 7], [7, 1], [7, 8], [2, 3], [8, 5]], b)) return 'lot';
      if (has([[1, 3], [6, 8], [8, 2]], b)) return 'park';
      return 'build';
    };
    const roads = GEO.city.roads.map((r) => ({ ...r, flatH: 0, center: 'dash', color: [0.16, 0.16, 0.18], edge: false }));
    const half = K * B, inner = (B - ST) / 2, DG = 11 * Math.SQRT2; // diagonal parks keep 11 m clear of the boulevard centre
    return {
      seed: 505, size: 1100, natural: 'asphalt', boundary: 550 - half - 8, blend: 4,
      terrain: () => 0,
      surfaceFn: (x, z) => {
        const bi = Math.floor(x / B + K), bj = Math.floor(z / B + K);
        const b = { i: bi, j: bj }, k = bi >= 0 && bj >= 0 && bi < 2 * K && bj < 2 * K ? kind(b) : '';
        const lx = x - (bi - K + 0.5) * B, lz = z - (bj - K + 0.5) * B;
        if (k === 'park' && Math.abs(lx) < inner - 4 && Math.abs(lz) < inner - 4) return 'grass';
        if (k === 'diag' && Math.abs(lx) < inner - 4 && Math.abs(lz) < inner - 4 && Math.abs(lx - lz) > DG + 4) return 'grass';
        return 'asphalt';
      },
      color: () => [0.2, 0.2, 0.22],
      roads,
      pads: [],
      spawns: () => { const out = []; for (let k = 0; k < 12; k++) out.push({ x: -40 + (k % 4) * 26, z: -30 + Math.floor(k / 4) * 30, h: 0 }); return out; },
      challenges: [
        { name: 'Plaza Showtime', x: 0, z: 0, r: 70, target: 18000, time: 30 },
        { name: 'Lot Shuffle', x: 225, z: -315, r: 40, target: 9000, time: 25 },
        { name: 'Downtown Sprint', x: -225, z: 45, r: 60, target: 10000, time: 25 },
        { name: 'Boulevard Dash', x: -225, z: -225, r: 60, target: 11000, time: 25 },
      ],
      env: {
        sky: { top: col('#0a1220'), horizon: col('#2b3340'), bottom: col('#14171c') },
        sunDir: norm([-0.3, 0.7, 0.4]), sunCol: [0.26, 0.29, 0.36], sunGlow: [0.06, 0.07, 0.09], ambSky: [0.24, 0.26, 0.32], ambGround: [0.14, 0.13, 0.12],
        fogCol: col('#1e232b'), fogNear: 140, fogFar: 680, night: true, headlights: true, stars: 0.5, music: 'night',
      },
      scenery(c) {
        const r = c.rand, inner = (B - ST) / 2;
        const pal = [[0.32, 0.33, 0.38], [0.42, 0.36, 0.33], [0.25, 0.3, 0.38], [0.5, 0.48, 0.45], [0.3, 0.27, 0.3]];
        // ordinary shop signs: backlit white/cream panels and a few painted brand colours (no neon)
        const signs = [[0.92, 0.9, 0.84], [0.95, 0.82, 0.6], [0.72, 0.22, 0.18], [0.18, 0.42, 0.3], [0.22, 0.3, 0.5]];
        const triUp = (g, A, Bp, C, col) => { const cy = (Bp[2] - A[2]) * (C[0] - A[0]) - (Bp[0] - A[0]) * (C[2] - A[2]); if (cy > 0) g.tri(A, Bp, C, col); else g.tri(A, C, Bp, col); };
        for (const b of blocks) {
          const k = kind(b), g = c.geo(b.x, b.z);
          if (k === 'diag') {
            // two triangular pocket parks either side of the boulevard: sidewalk rim + grass + trees
            for (const sg of [1, -1]) {
              const P = (lx, lz, y) => [b.x + lx, y, b.z + lz];
              const tri = (d, y, col) => (sg > 0 ? triUp(g, P(-inner, -inner + d, y), P(-inner, inner, y), P(inner - d, inner, y), col) : triUp(g, P(-inner + d, -inner, y), P(inner, -inner, y), P(inner, inner - d, y), col));
              tri(DG, 0.02, [0.36, 0.36, 0.38]);
              tri(DG + 4 * Math.SQRT2 + 4, 0.035, [0.15, 0.3, 0.12]);
              for (let t = 0; t < 8; t++) {
                const u = r(), v = r() * (1 - u), lx = -inner + 8 + u * (2 * inner - 26), lz = inner - 8 - v * (2 * inner - 26);
                const X = b.x + (sg > 0 ? lx : lz), Z = b.z + (sg > 0 ? lz : lx);
                if (Math.abs((X - b.x) - (Z - b.z)) < DG + 9) continue;
                leafy(g, X, 0, Z, 0.9 + r() * 0.4, r, [0.12, 0.3, 0.15]); c.circle(X, Z, 0.5);
              }
            }
            for (const [sx, sz] of [[1, -1], [-1, 1]]) lamp(c, b.x + sx * (inner - 1), b.z + sz * (inner - 1), Math.atan2(sx, sz), true, [1, 0.88, 0.66]);
            for (const t of [-0.3, 0, 0.3]) lamp(c, b.x + t * B - 10, b.z + t * B + 10, Math.PI * 0.75, true); // boulevard lights along the north-west kerb
            continue;
          }
          if (k !== 'plaza') {
            // sidewalk (flush) + curb line
            g.box(b.x, 0.015, b.z, inner * 2 + 0.01, 0.03, inner * 2 + 0.01, { top: [0.36, 0.36, 0.38], side: [0.5, 0.5, 0.5] });
            g.box(b.x, 0.03, b.z, inner * 2 - 4.5, 0.03, inner * 2 - 4.5, k === 'park' ? [0.15, 0.3, 0.12] : k === 'lot' ? [0.18, 0.18, 0.2] : [0.3, 0.3, 0.32]);
          } else {
            g.box(b.x, 0.015, b.z, B + 0.1, 0.03, B + 0.1, [0.38, 0.36, 0.33]); // stone paving
          }
          // lamps at corners (all blocks; none on the diagonal boulevard where it crosses the plaza)
          for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) if (!(k === 'plaza' && sx === sz && b.i === b.j)) lamp(c, b.x + sx * (inner - 1), b.z + sz * (inner - 1), Math.atan2(sx, sz), true, sx * sz > 0 ? [1, 0.82, 0.55] : [1, 0.9, 0.74]); // warm street lights
          if (k === 'build') {
            const split = r();
            const lots = split < 0.3 ? [[0, 0, 1, 1]] : split < 0.65 ? [[-0.5, 0, 0.5, 1], [0.5, 0, 0.5, 1]] : [[-0.5, -0.5, 0.5, 0.5], [0.5, -0.5, 0.5, 0.5], [-0.5, 0.5, 0.5, 0.5], [0.5, 0.5, 0.5, 0.5]];
            const centre = Math.max(0, 1 - Math.hypot(b.x, b.z) / 600);
            for (const [ox, oz, fw, fd] of lots) {
              const w = (inner * 2 - 8) * fw - 2, d = (inner * 2 - 8) * fd - 2;
              const x = b.x + ox * (inner * 2 - 8) * 0.5, z = b.z + oz * (inner * 2 - 8) * 0.5;
              const h = 10 + r() * 30 + centre * centre * 70 * r();
              building(c, x, z, w, d, h, pal[Math.floor(r() * pal.length)], true, r);
              c.box(x, z, w, d);
              if (r() < 0.45) {
                const sc = signs[Math.floor(r() * signs.length)], side = r() < 0.5 ? 1 : -1;
                g.box(x + (r() - 0.5) * w * 0.5, 7 + r() * 6, z + side * (d / 2 + 0.3), 5 + r() * 6, 1.4, 0.2, [...sc, 0.55]); // softly lit sign
                c.glow(x, 0.05, z + side * (d / 2 + 4), 7, [0.09, 0.075, 0.055, 1]); // faint warm spill on the pavement
              }
            }
          } else if (k === 'park') {
            for (let t = 0; t < 26; t++) {
              const x = b.x + (r() - 0.5) * (inner * 2 - 12), z = b.z + (r() - 0.5) * (inner * 2 - 12);
              leafy(g, x, 0, z, 0.9 + r() * 0.5, r, [0.12, 0.3, 0.15]); c.circle(x, z, 0.5);
            }
          } else if (k === 'lot') {
            for (let x = -inner + 6; x < inner - 4; x += 3.4) for (const zz of [-inner + 7, inner - 7]) g.box(b.x + x, 0.06, b.z + zz, 0.15, 0.01, 5.5, [0.85, 0.85, 0.8]);
          } else if (k === 'plaza' && b.i === K - 1 && b.j === K - 1) {
            // centre fountain-like sculpture at the middle of the plaza (at block corner)
            const x = (b.i - K + 1) * B, z = (b.j - K + 1) * B;
            g.cylinder(x, 0.4, z, 6, 0.8, 16, [0.5, 0.5, 0.55]);
            g.cylinder(x, 3.5, z, 0.6, 6, 8, [0.6, 0.6, 0.65]);
            g.blob(x, 7.2, z, 1.6, 1.6, 1.6, [0.55, 0.45, 0.3], 0, r); // bronze sculpture
            c.circle(x, z, 6.2);
            c.glow(x, 0.08, z, 16, [0.16, 0.13, 0.09, 1]); // warm floodlight pool
          }
        }
        // crosswalks & intersections
        for (const xv of lines) for (const zv of lines) {
          const g = c.geo(xv, zv);
          g.box(xv, 0.02, zv, ST - 0.5, 0.02, ST - 0.5, [0.15, 0.15, 0.17]);
          for (let s = -3; s <= 3; s++) {
            for (const sgn of [-1, 1]) {
              g.box(xv + s * 1.9, 0.035, zv + sgn * (ST / 2 + 1.5), 1, 0.02, 3, [0.85, 0.85, 0.85]);
              g.box(xv + sgn * (ST / 2 + 1.5), 0.035, zv + s * 1.9, 3, 0.02, 1, [0.85, 0.85, 0.85]);
            }
          }
        }
        // perimeter barrier + skyline outside
        const e = half + 8;
        for (let v = -e; v < e; v += 6) {
          for (const [x, z, yaw] of [[v + 3, -e, Math.PI / 2], [v + 3, e, Math.PI / 2], [-e, v + 3, 0], [e, v + 3, 0]]) {
            c.geo(x, z).at(x, 0.5, z, yaw).box(0, 0, 0, 0.7, 1, 6, { top: [0.6, 0.6, 0.6], side: (Math.floor(v / 6) & 1) ? [0.9, 0.9, 0.9] : [0.95, 0.75, 0.1] }).reset();
          }
        }
        for (let t = 0; t < 150; t++) {
          const a = r() * Math.PI * 2, d = e + 25 + r() * 30;
          const x = Math.cos(a) * d * 1.05, z = Math.sin(a) * d * 1.05;
          if (Math.max(Math.abs(x), Math.abs(z)) < e + 15) continue;
          building(c, x, z, 18 + r() * 20, 18 + r() * 20, 25 + r() * 90, pal[t % pal.length], true, r);
        }
      },
    };
  },

  // ------------------------------------------------------------- DRIFT PARK (Ironbay)
  drift(q) {
    const n = makeNoise(61);
    const QUAY = 436; // harbour wall (north); hills on the other three sides
    const terrain = (x, z) => {
      let h = 1.6 + n.fbm(x / 230, z / 230, 3) * 1.4;
      const e = Math.max(Math.abs(x), -z);
      h += smoothstep(600, 690, e) * (28 + n.ridge(x / 110, z / 110, 3) * 42);
      return lerp(h, -7, smoothstep(QUAY - 2, QUAY + 30, z)); // harbour basin
    };
    const grassA = col('#5f7f45'), grassB = col('#6f8a4c'), dry = col('#8f8a68'), rockC = col('#7a756c'), conc = col('#8d8b85'), conc2 = col('#7d7c77'), shoreC = col('#6d6a60');
    const yard = GEO.drift.pads[3];
    const inYard = (x, z, m = 0) => Math.abs(x - yard.x) < yard.w / 2 + m && Math.abs(z - yard.z) < yard.d / 2 + m;
    return {
      seed: 606, size: 1400, natural: 'grass', boundary: 60, blend: 24,
      terrain,
      water: { y: -1.2, color: [0.2, 0.34, 0.4] },
      color: (x, z, h, slope, sd) => {
        if (z > QUAY - 4) return h < -0.6 ? shoreC : conc2;
        if (inYard(x, z, 6)) return mix3(conc, conc2, n(x / 14, z / 14) * 0.5 + 0.5);
        let c = mix3(grassA, grassB, n(x / 30, z / 30) * 0.5 + 0.5);
        if (sd < 24) c = mix3(dry, c, smoothstep(5, 24, sd)); // worn, dusty verges round the tarmac
        return mix3(c, rockC, smoothstep(0.45, 0.85, slope));
      },
      shoulder: col('#8a8676'),
      roads: GEO.drift.roads.map((r, i) => i === 0 ? { ...r, kerbs: true, color: [0.21, 0.21, 0.22], startLine: 40, smooth: 20 }
        : { ...r, color: [0.25, 0.25, 0.26] }),
      pads: [
        { ...GEO.drift.pads[0], type: 2, markings: 'lot' },
        { ...GEO.drift.pads[1], type: 2, color: [0.24, 0.24, 0.25], markings: 'grid' },
        { ...GEO.drift.pads[2], type: 2, markings: 'donut' },
        { ...yard, type: 2, color: [0.4, 0.4, 0.39] },
      ],
      spawns: (W) => W.roadSpawns(0, 40, 12, 1),
      challenges: [
        { name: 'Practice Pad', x: -410, z: 240, r: 70, target: 18000, time: 30 },
        { name: 'Donut Circle', x: -110, z: 205, r: 42, target: 12000, time: 25 },
        { name: 'Figure-Eight', x: 0, z: -120, r: 80, target: 14000, time: 25 },
        { name: 'Harbour Hairpin', x: 300, z: 120, r: 70, target: 11000, time: 25 },
        { name: 'S-Bends', x: 415, z: -140, r: 80, target: 13000, time: 25 },
      ],
      env: {
        sky: { top: col('#56789e'), horizon: col('#e3cfb2'), bottom: col('#8f8a7c') },
        sunDir: norm([-0.45, 0.4, 0.8]), sunCol: [1.08, 0.92, 0.74], sunGlow: [1.15, 0.78, 0.48], ambSky: [0.5, 0.54, 0.62], ambGround: [0.32, 0.3, 0.26],
        fogCol: col('#cbbfa9'), fogNear: 240, fogFar: 1000, night: false, music: 'bright',
      },
      scenery(c) {
        const r = c.rand;
        // --- harbour wall: concrete quay edge with bollards (collides — no driving into the sea)
        for (let x = -660; x < 660; x += 20) {
          const g = c.geo(x + 10, QUAY);
          g.box(x + 10, c.h(x + 10, QUAY - 3) + 0.35, QUAY - 1, 20, 0.9, 2, { top: [0.66, 0.65, 0.62], side: [0.55, 0.54, 0.5] });
          if ((x / 20) % 3 === 0) g.cylinder(x + 10, c.h(x + 10, QUAY - 3) + 1.1, QUAY - 1, 0.35, 0.7, 8, [0.2, 0.2, 0.22]);
        }
        c.seg(-700, QUAY - 2, 700, QUAY - 2);
        // --- container stacks in rows across the yard, alleys left open between them
        const pal = [[0.55, 0.24, 0.17], [0.22, 0.3, 0.42], [0.36, 0.42, 0.3], [0.6, 0.58, 0.52], [0.66, 0.5, 0.3], [0.32, 0.33, 0.35], [0.45, 0.2, 0.2]];
        const x0 = yard.x - yard.w / 2;
        for (const [bx0, bx1] of [[x0 + 30, 90], [114, 200], [224, 286], [314, 400], [424, 518], [562, 592]]) {
          for (const [bz0, bz1] of [[318, 342], [352, 378]]) {
            for (let z = bz0; z < bz1 - 1; z += 2.7) for (let x = bx0; x < bx1 - 6; x += 12.6) {
              if (r() < 0.12) continue;
              const k = 1 + Math.floor(r() * 3), g = c.geo(x + 6, z), y = c.h(x + 6, z), cc = pal[Math.floor(r() * pal.length)];
              for (let m = 0; m < k; m++) g.box(x + 6.15, y + 1.3 + m * 2.6, z + 1.25, 12.2, 2.55, 2.45, { top: shade(cc, 0.85), side: shade(cc, 0.95 + (m % 2) * 0.08), noBottom: true });
            }
            c.box((bx0 + bx1) / 2, (bz0 + bz1) / 2 + 0.6, bx1 - bx0, bz1 - bz0 + 1.2);
          }
        }
        // --- gantry cranes along the quay (legs collide; booms reach out over the water)
        for (const cx of [20, 250, 470]) {
          const y = c.h(cx, 418), g = c.geo(cx, 418), steel = [0.72, 0.52, 0.22], dark = [0.3, 0.3, 0.32];
          for (const sx of [-9, 9]) for (const sz of [405, 431]) { g.box(cx + sx, y + 15, sz, 1.2, 30, 1.2, steel); c.circle(cx + sx, sz, 1); }
          for (const sz of [405, 431]) g.box(cx, y + 30.5, sz, 20, 1.4, 1.4, steel);
          g.box(cx - 9, y + 28, 418, 1.4, 1.4, 27, steel); g.box(cx + 9, y + 28, 418, 1.4, 1.4, 27, steel);
          g.box(cx, y + 33, 445, 3, 1.6, 78, steel); g.box(cx, y + 35, 412, 6, 4, 8, dark);
        }
        // --- warehouses between the course and the yard
        for (const [x, z, w, d] of [[140, 240, 84, 30], [450, 236, 70, 28]]) {
          const y = c.h(x, z) - 0.2, g = c.geo(x, z);
          g.box(x, y + 6, z, w, 12, d, { top: [0.5, 0.52, 0.53], side: [0.62, 0.6, 0.55], noBottom: true });
          g.at(x, y + 12, z, 0).extrude([[-d / 2 - 0.5, 0], [d / 2 + 0.5, 0], [0, 3.5]], w + 1, 0.05, [0.45, 0.47, 0.48]).reset();
          for (let k = -2; k <= 2; k++) g.box(x + k * (w / 5), y + 3.5, z + d / 2 + 0.05, 7, 7, 0.1, [0.32, 0.34, 0.36]);
          c.box(x, z, w, d);
        }
        // --- start gantry over the main straight
        { const rd = c.roads[0], i = rd.startLine, x = rd.x[i], z = rd.z[i], y = rd.h[i], g = c.geo(x, z);
          const yaw = Math.atan2(rd.tx[i], rd.tz[i]);
          g.at(x, y, z, yaw);
          for (const sx of [-11.5, 11.5]) g.box(sx, 4, 0, 0.8, 8, 0.8, [0.3, 0.3, 0.32]);
          g.box(0, 8, 0, 24, 1.6, 1.2, { side: [0.15, 0.15, 0.18], front: [0.85, 0.75, 0.3], back: [0.85, 0.75, 0.3] });
          g.reset();
          for (const s of [-11.5, 11.5]) c.circle(x + rd.tz[i] * s, z - rd.tx[i] * s, 0.6); }
        // --- paddock: team garages behind the pad
        { const x = -40, z = -548, y = c.h(x, z), g = c.geo(x, z);
          g.box(x, y + 3.5, z, 280, 7, 14, { top: [0.6, 0.6, 0.62], side: [0.82, 0.8, 0.76] });
          for (let i = 0; i < 12; i++) g.box(-150 + i * 20 + 10, y + 2.3, z + 7.05, 14, 4, 0.1, [0.2, 0.22, 0.26]);
          c.box(x, z, 280, 14); }
        // --- spectator terrace facing the figure-eight crossover
        { const x = -40, z = -300, yaw = Math.atan2(40, 180), g = c.geo(x, z), y = c.h(x, z);
          g.at(x, y, z, yaw);
          for (let k = 0; k < 5; k++) g.box(0, 0.5 + k * 0.8, -k * 1.6, 50, 1 + k * 1.6, 1.6, { top: k % 2 ? [0.62, 0.6, 0.56] : [0.55, 0.53, 0.5], side: [0.5, 0.49, 0.46] });
          g.box(0, 9, -4, 52, 0.4, 10, [0.85, 0.85, 0.82]); g.reset();
          c.box(x - Math.sin(yaw) * 3, z - Math.cos(yaw) * 3, 50, 9, yaw); }
        // --- tyre stacks: donut centre post and practice-pad corners
        tyres(c, -110, 205, 4);
        for (const [x, z] of [[-470, 180], [-515, 305], [-305, 305], [-470, 240], [-410, 200], [-350, 240], [-410, 280]]) tyres(c, x, z);
        // --- light towers
        for (const [x, z] of [[-410, 330], [-200, 150], [110, -150], [-110, -110], [300, -300], [-300, -540], [200, -545], [300, 30], [-230, -160]]) {
          if (c.sd(x, z) < 15) continue;
          const y = c.h(x, z), g = c.geo(x, z);
          g.cylinder(x, y + 12, z, 0.5, 24, 6, [0.5, 0.5, 0.52]); g.box(x, y + 24, z, 5, 3, 1, [0.9, 0.92, 0.95, 0.5]); c.circle(x, z, 0.8);
        }
        // --- trees on the hills and round the venue (none on the yard / quay)
        c.scatter(Math.floor(3800 * q.density), (x, z, inPlay) => {
          const y = c.h(x, z), g = c.geo(x, z), s = 0.8 + r() * 0.7;
          if (r() < 0.55) pine(g, x, y, z, s * 1.25, r); else leafy(g, x, y, z, s, r);
          if (inPlay) c.circle(x, z, 0.5 * s); c.shadow(x, z, 2.6 * s, 0.3);
        }, (x, z) => c.sd(x, z) > 26 && z < QUAY - 30 && !inYard(x, z, 30) && (Math.max(Math.abs(x), -z) > 520 || r() < 0.35));
        c.scatter(Math.floor(300 * q.density), (x, z, inPlay) => {
          const s = 0.8 + r() * 1.6; rock(c.geo(x, z), x, c.h(x, z), z, s, r, [0.55, 0.53, 0.5]); if (inPlay) c.circle(x, z, s);
        }, (x, z) => c.sd(x, z) > 20 && z < QUAY - 30 && !inYard(x, z, 30));
      },
    };
  },
};

function norm(v) { const l = Math.hypot(...v); return v.map((x) => x / l); }
