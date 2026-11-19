// Map definitions + procedural world builder.
// Each map = terrain function + road splines + pads + scenery + atmosphere.
// To add a map: write a spec function and register it in SPECS / MAP_LIST.
import { Geo, ChunkBatcher } from './engine/geometry.js';
import { FxBuffer } from './engine/renderer.js';
import { makeNoise, rng, smoothstep, clamp, lerp } from './engine/math.js';
import { crSample, segDist, GEO } from './tracks.js';

export const MAP_LIST = [
  { id: 'track', name: 'Apex Circuit', type: 'Race Track', desc: 'A proper racing circuit with sweepers, a carousel, a hairpin and an infield skidpad.', accent: '#3a86ff' },
  { id: 'desert', name: 'Dune Valley', type: 'Desert', desc: 'Golden-hour highway loop around a huge salt flat. Endless room to slide.', accent: '#f4a261' },
  { id: 'mountain', name: 'Kurogane Pass', type: 'Mountains', desc: 'A dusk touge climbing switchbacks to a summit lookout.', accent: '#b5179e' },
  { id: 'forest', name: 'Pinewood Trails', type: 'Forest', desc: 'Misty forest loop around a lake with a big gravel clearing.', accent: '#52b788' },
  { id: 'city', name: 'Neon District', type: 'City', desc: 'Night-time grid of streets, a central plaza and open parking lots.', accent: '#ff006e' },
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
    // finalise
    this.statics = this.batch.build(renderer).map((s) => ({ ...s, maxDist: this.env.fogFar + 60 }));
    this.fx.push(this.makeStaticFx(this.shadowV, false), this.makeStaticFx(this.glowV, true));
    this.resetPts = [];
    for (const r of this.roads) for (let i = 0; i < r.n; i += 3) this.resetPts.push([r.x[i], r.z[i], r.h[i], Math.atan2(r.tx[i], r.tz[i])]);
    for (const p of this.pads) this.resetPts.push([p.x, p.z, p.h, 0]);
  }

  // ------------------------------------------------ roads
  processRoads() {
    const spec = this.spec;
    this.roads = [];
    for (const rd of spec.roads) {
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
      if (rd.flatH === undefined) {
        hs = smoothArr(hs, !!rd.closed, rd.smooth || 12, 3);
        // limit the gradient (cut & fill) so hills stay drivable
        const g = (rd.maxGrade || 0.12) * 3;
        for (let it = 0; it < 6; it++) {
          for (let i = 1; i < n; i++) hs[i] = clamp(hs[i], hs[i - 1] - g, hs[i - 1] + g);
          for (let i = n - 2; i >= 0; i--) hs[i] = clamp(hs[i], hs[i + 1] - g, hs[i + 1] + g);
        }
        hs = smoothArr(hs, !!rd.closed, 4, 1);
      }
      // blend into earlier roads at junctions
      for (let i = 0; i < n; i++) {
        let best = 1e9, bh = 0;
        for (const o of this.roads) for (let j = 0; j < o.n; j += 1) {
          const d = Math.hypot(o.x[j] - r.x[i], o.z[j] - r.z[i]); if (d < best) { best = d; bh = o.h[j]; }
        }
        if (best < 80) hs[i] = lerp(bh, hs[i], smoothstep(r.half + 4, 70, best));
      }
      r.h.set(hs);
      this.roads.push(r);
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
    const spec = this.spec, cs = this.q.cell, size = this.size;
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
  buildRoadMeshes() {
    const rand = this.rand;
    for (const r of this.roads) {
      const segs = r.closed ? r.n : r.n - 1;
      const C = r.color || [0.2, 0.2, 0.22];
      const L = (i, off, dy = 0) => [r.x[i] - r.tz[i] * off, r.h[i] + dy, r.z[i] + r.tx[i] * off];
      const Rr = (i, off, dy = 0) => [r.x[i] + r.tz[i] * off, r.h[i] + dy, r.z[i] - r.tx[i] * off];
      for (let i = 0; i < segs; i++) {
        const j = (i + 1) % r.n;
        const g = this.batch.geo(r.x[i], r.z[i]);
        const Q = (A, B, C2, D, c) => g.quad(D, C2, B, A, c); // ribbon winding (faces up)
        const shadeK = 0.96 + (i % 7 === 0 ? 0.04 : 0) + rand() * 0.02;
        Q(Rr(i, r.half), Rr(j, r.half), L(j, r.half), L(i, r.half), shade(C, shadeK));
        // edge lines
        if (r.edge !== false) {
          const e = r.half - 0.55, w = 0.18, lc = r.edgeColor || [0.9, 0.9, 0.88];
          Q(Rr(i, e + w, 0.03), Rr(j, e + w, 0.03), Rr(j, e, 0.03), Rr(i, e, 0.03), lc);
          Q(L(i, e, 0.03), L(j, e, 0.03), L(j, e + w, 0.03), L(i, e + w, 0.03), lc);
        }
        if (r.center && (r.center === 'solid' || (i % 4) < 2)) {
          const cc = r.centerColor || [0.95, 0.8, 0.2], w = 0.12;
          Q(Rr(i, w, 0.03), Rr(j, w, 0.03), L(j, w, 0.03), L(i, w, 0.03), cc);
        }
        if (r.kerbs) {
          const kc = (Math.floor(i / 1) % 2) ? [0.85, 0.12, 0.12] : [0.95, 0.95, 0.95];
          Q(Rr(i, r.half + 1.3, 0.05), Rr(j, r.half + 1.3, 0.05), Rr(j, r.half, 0.05), Rr(i, r.half, 0.05), kc);
          Q(L(i, r.half, 0.05), L(j, r.half, 0.05), L(j, r.half + 1.3, 0.05), L(i, r.half + 1.3, 0.05), kc);
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
function lamp(ctx, x, z, yaw, night, colr = [1, 0.85, 0.55]) {
  const y = ctx.h(x, z), g = ctx.geo(x, z);
  g.cylinder(x, y + 3.5, z, 0.12, 7, 6, [0.25, 0.25, 0.28]);
  const ax = Math.sin(yaw) * 1.4, az = Math.cos(yaw) * 1.4;
  g.at(x + ax / 2, y + 7, z + az / 2, yaw).box(0, 0, 0, 0.12, 0.12, 1.5, [0.25, 0.25, 0.28]).reset();
  g.box(x + ax, y + 6.85, z + az, 0.5, 0.15, 0.8, [...colr, night ? 1 : 0.3]);
  ctx.circle(x, z, 0.3);
  if (night) ctx.glow(x + ax, y + 0.08, z + az, 9, [colr[0] * 0.35, colr[1] * 0.35, colr[2] * 0.35, 1]);
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
      const wc = lit ? [...(r() < 0.7 ? [1, 0.82, 0.5] : [0.6, 0.85, 1]), 0.85] : night ? [0.06, 0.07, 0.1] : [0.25, 0.32, 0.4];
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
      seed: 101, size: 1000, natural: 'grass', boundary: 60, blend: 26,
      terrain: (x, z) => n.fbm(x / 300, z / 300, 3) * 4 + smoothstep(420, 500, Math.max(Math.abs(x), Math.abs(z))) * 25,
      color: (x, z, h, slope, sd) => {
        if (sd < 40) return ((Math.floor((x + z) / 10) & 1) ? grassA : grassB);
        return mix3(grassB, far, smoothstep(40, 200, sd));
      },
      shoulder: col('#8a8a7a'),
      roads: [
        { ...GEO.track.roads[0], kerbs: true, walls: 22, color: [0.22, 0.22, 0.24], startLine: 30, smooth: 20 },
        { ...GEO.track.roads[1], color: [0.22, 0.22, 0.24], edge: false },
      ],
      pads: [
        { ...GEO.track.pads[0], type: 2, markings: 'donut' },
        { ...GEO.track.pads[1], type: 2, markings: 'lot' },
      ],
      spawns: (W) => W.roadSpawns(0, 30, 12, 1),
      challenges: [
        { name: 'Skidpad Spin', x: 60, z: -170, r: 70, target: 18000, time: 30 },
        { name: 'Carousel', x: 315, z: 220, r: 70, target: 12000, time: 25 },
        { name: 'Hairpin', x: -250, z: 250, r: 70, target: 10000, time: 25 },
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
          const x = -150 + i * 70, z = -268, g = c.geo(x, z), y = c.h(x, z);
          for (let k = 0; k < 6; k++) g.box(x, y + 0.6 + k * 0.9, z + 2 + k * 1.6, 60, 1.2 + k * 1.8, 1.8, { top: (k % 2 ? [0.85, 0.2, 0.2] : [0.2, 0.35, 0.8]), side: [0.6, 0.6, 0.62] });
          g.box(x, y + 12, z + 6, 62, 0.4, 14, [0.9, 0.9, 0.92]);
          for (const sx of [-30, 30]) g.box(x + sx, y + 6, z + 12, 0.5, 12, 0.5, [0.5, 0.5, 0.5]);
          c.box(x, z + 6, 62, 12);
        }
        // pit building by paddock
        { const x = 0, z = -385, g = c.geo(x, z), y = c.h(x, z);
          g.box(x, y + 4, z, 240, 8, 16, { top: [0.8, 0.8, 0.82], side: [0.93, 0.93, 0.95] });
          for (let i = 0; i < 12; i++) g.box(-110 + i * 20, y + 2.5, z + 8.05, 14, 4.5, 0.1, [0.15, 0.18, 0.25]);
          g.box(x, y + 9, z, 60, 3, 10, [0.15, 0.15, 0.17]); c.box(x, z, 240, 16); }
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
        c.scatter(Math.floor(2600 * q.density), (x, z) => {
          const y = c.h(x, z), g = c.geo(x, z), s = 0.8 + r() * 0.7;
          if (r() < 0.5) pine(g, x, y, z, s * 1.2, r); else leafy(g, x, y, z, s, r);
          c.circle(x, z, 0.5 * s); c.shadow(x, z, 2.6 * s);
        }, (x, z) => c.sd(x, z) > 34);
        for (let i = 0; i < 14; i++) {
          const rd = c.roads[0], k = Math.floor(r() * rd.n), side = r() < 0.5 ? -1 : 1, off = rd.half + 27;
          const x = rd.x[k] + rd.tz[k] * off * side, z = rd.z[k] - rd.tx[k] * off * side;
          if (c.sd(x, z) < 24) continue;
          const pal = [[0.9, 0.2, 0.2], [0.2, 0.4, 0.9], [1, 0.75, 0.1], [0.1, 0.7, 0.5]];
          billboard(c.geo(x, z), x, c.h(x, z), z, Math.atan2(rd.tx[k], rd.tz[k]) + Math.PI / 2, pal[i % 4], pal[(i + 1) % 4]);
          c.box(x, z, 9, 1, Math.atan2(rd.tx[k], rd.tz[k]) + Math.PI / 2);
        }
        // light towers
        for (const [x, z] of [[-260, -330], [260, -330], [0, 30], [-380, 0], [380, 0]]) {
          const y = c.h(x, z), g = c.geo(x, z);
          g.cylinder(x, y + 12, z, 0.5, 24, 6, [0.5, 0.5, 0.52]); g.box(x, y + 24, z, 5, 3, 1, [0.9, 0.92, 0.95, 0.5]); c.circle(x, z, 0.8);
        }
      },
    };
  },

  // ------------------------------------------------------------- DESERT
  desert(q) {
    const n = makeNoise(23);
    const mesas = [[620, -520, 120], [-640, 560, 140], [640, 600, 110], [-620, -600, 130], [0, 690, 160], [-700, 0, 150], [700, 80, 140]];
    const sand = col('#e3b97a'), sand2 = col('#d4a467'), salt = col('#ece7da'), rockC = col('#b56a43'), rockD = col('#8e4f35');
    const terrain = (x, z) => {
      let h = n.fbm(x / 170, z / 170, 4) * 7 + Math.sin(x / 37 + n(x / 90, z / 90) * 3) * 1.2;
      const e = Math.max(Math.abs(x), Math.abs(z));
      h += smoothstep(560, 690, e) * (40 + n.ridge(x / 120, z / 120, 3) * 60);
      for (const [mx, mz, mr] of mesas) {
        const d = Math.hypot(x - mx, z - mz) + n(x / 40, z / 40) * 18;
        h += smoothstep(mr, mr * 0.8, d) * 55;
      }
      return h;
    };
    return {
      seed: 202, size: 1400, natural: 'sand', boundary: 70, blend: 24,
      terrain,
      color: (x, z, h, slope, sd) => {
        if (h > 22 || slope > 0.55) return mix3(rockC, rockD, (Math.floor(h / 4) & 1) * 0.6 + n(x / 20, z / 20) * 0.2);
        return mix3(sand, sand2, n(x / 25, z / 25) * 0.5 + 0.5);
      },
      shoulder: col('#c99b62'),
      roads: [
        { ...GEO.desert.roads[0], center: 'dash', color: [0.26, 0.25, 0.25], smooth: 18 },
        { ...GEO.desert.roads[1], center: 'dash', color: [0.26, 0.25, 0.25] },
        { ...GEO.desert.roads[2], center: 'dash', color: [0.26, 0.25, 0.25] },
      ],
      pads: [
        { ...GEO.desert.pads[0], type: 4, color: salt },
        { ...GEO.desert.pads[1], type: 2 },
      ],
      spawns: (W) => W.roadSpawns(0, 70, 12, 1),
      challenges: [
        { name: 'Salt Flat Frenzy', x: 0, z: 0, r: 90, target: 20000, time: 30 },
        { name: 'Highway Sweeper', x: 480, z: -280, r: 75, target: 12000, time: 25 },
        { name: 'Canyon Bend', x: -470, z: 330, r: 75, target: 12000, time: 25 },
      ],
      env: {
        sky: { top: col('#4a5f9c'), horizon: col('#ffb36b'), bottom: col('#d7a06a') },
        sunDir: norm([-0.65, 0.32, 0.55]), sunCol: [1.15, 0.82, 0.55], sunGlow: [1.3, 0.8, 0.4], ambSky: [0.55, 0.5, 0.58], ambGround: [0.5, 0.38, 0.28],
        fogCol: col('#f0b886'), fogNear: 300, fogFar: 1150, night: false, music: 'warm',
      },
      scenery(c) {
        const r = c.rand;
        c.scatter(Math.floor(1400 * q.density), (x, z, inPlay) => {
          const y = c.h(x, z), g = c.geo(x, z), k = r();
          if (k < 0.45) { const s = 0.8 + r() * 0.6; cactus(g, x, y, z, s, r); if (inPlay) c.circle(x, z, 0.45 * s); c.shadow(x, z, 1.2 * s, 0.3); }
          else if (k < 0.75) { const s = 0.8 + r() * 2.2; rock(g, x, y, z, s, r, [0.7, 0.45, 0.32]); if (inPlay) c.circle(x, z, s * 1.1); }
          else g.blob(x, y + 0.4, z, 0.9, 0.5, 0.9, [0.55, 0.5, 0.3], 0.4, r);
        }, (x, z) => c.sd(x, z) > 10);
        // power line poles along the highway
        const rd = c.roads[0];
        for (let i = 0; i < rd.n; i += 14) {
          const off = rd.half + 9, x = rd.x[i] + rd.tz[i] * off, z = rd.z[i] - rd.tx[i] * off;
          if (c.sd(x, z) < 6) continue;
          const y = c.h(x, z), g = c.geo(x, z), yaw = Math.atan2(rd.tx[i], rd.tz[i]);
          g.cylinder(x, y + 5, z, 0.18, 10, 5, [0.4, 0.3, 0.22]);
          g.at(x, y + 9.4, z, yaw + Math.PI / 2).box(0, 0, 0, 0.15, 0.15, 3, [0.4, 0.3, 0.22]).reset();
          c.circle(x, z, 0.3);
        }
        // gas station
        { const x = 560, z = 290, y = c.h(x, z), g = c.geo(x, z);
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
        { const x = -30, z = 200, y = c.h(x, z), g = c.geo(x, z);
          g.at(x, y, z, 0.6).box(0, 1.6, 0, 3, 2.6, 9, { top: [0.75, 0.75, 0.78], side: [0.82, 0.8, 0.75] }).box(0, 0.4, -2, 3.2, 0.3, 0.3, [0.1, 0.1, 0.1]).reset();
          c.box(x, z, 3, 9, 0.6); }
      },
    };
  },

  // ------------------------------------------------------------- MOUNTAINS
  mountain(q) {
    const n = makeNoise(37);
    const terrain = (x, z) => {
      const rr = Math.hypot(x, z - 150);
      let h = 150 * Math.exp(-((rr / 430) ** 2));
      h += n.ridge(x / 260, z / 260, 4) * 45 - 18 + n.fbm(x / 60, z / 60, 2) * 4;
      const e = Math.max(Math.abs(x), Math.abs(z));
      h += smoothstep(700, 790, e) * (90 + n.ridge(x / 150, z / 150, 3) * 120);
      return h;
    };
    const grass = col('#4a6b3a'), grass2 = col('#5e7b3e'), rockC = col('#6f6a68'), snow = col('#eef2f7');
    return {
      seed: 303, size: 1600, natural: 'dirt', boundary: 70, blend: 20,
      terrain,
      color: (x, z, h, slope, sd) => {
        let c = mix3(grass, grass2, n(x / 30, z / 30) * 0.5 + 0.5);
        c = mix3(c, rockC, smoothstep(0.45, 0.8, slope));
        return mix3(c, snow, smoothstep(125, 150, h + n(x / 25, z / 25) * 10) * (1 - smoothstep(0.9, 1.3, slope)));
      },
      shoulder: col('#6b5f50'),
      roads: [
        { ...GEO.mountain.roads[0], center: 'dash', centerColor: [0.95, 0.95, 0.9], guardrails: true, color: [0.24, 0.24, 0.26], smooth: 18, maxGrade: 0.11 },
      ],
      pads: [
        { ...GEO.mountain.pads[0], type: 2, markings: 'lot' },
        { ...GEO.mountain.pads[1], type: 2 },
      ],
      spawns: (W) => {
        const out = [];
        for (let k = 0; k < 12; k++) out.push({ x: -110 + (k % 6) * 12, z: -670 + Math.floor(k / 6) * 16, h: 0.35 });
        return out;
      },
      challenges: [
        { name: 'Hairpin One', x: 270, z: -460, r: 70, target: 10000, time: 25 },
        { name: 'Switchback Run', x: -275, z: -300, r: 75, target: 11000, time: 25 },
        { name: 'Summit Donuts', x: 30, z: 205, r: 48, target: 14000, time: 25 },
      ],
      env: {
        sky: { top: col('#2a2d63'), horizon: col('#f08a7a'), bottom: col('#7a5a6a') },
        sunDir: norm([0.75, 0.16, -0.35]), sunCol: [1.0, 0.62, 0.48], sunGlow: [1.2, 0.5, 0.35], ambSky: [0.42, 0.42, 0.62], ambGround: [0.25, 0.22, 0.26],
        fogCol: col('#9a7f98'), fogNear: 220, fogFar: 1000, night: false, headlights: true, music: 'dusk',
      },
      scenery(c) {
        const r = c.rand;
        c.scatter(Math.floor(5000 * q.density), (x, z, inPlay) => {
          const y = c.h(x, z);
          if (y > 132) return;
          const g = c.geo(x, z), s = 0.9 + r() * 0.8;
          pine(g, x, y, z, s * 1.3, r, y > 105);
          if (inPlay) c.circle(x, z, 0.5 * s); c.shadow(x, z, 2.8 * s, 0.3);
        }, (x, z) => c.sd(x, z) > 9);
        c.scatter(Math.floor(500 * q.density), (x, z, inPlay) => {
          const s = 1 + r() * 2.5; rock(c.geo(x, z), x, c.h(x, z), z, s, r, [0.55, 0.53, 0.52]); if (inPlay) c.circle(x, z, s);
        }, (x, z) => c.sd(x, z) > 8);
        // summit shrine + lookout
        { const x = 30, z = 245, y = c.h(x, z), g = c.geo(x, z);
          g.box(x, y + 0.3, z, 10, 0.6, 7, [0.55, 0.55, 0.55]);
          for (const sx of [-4, 4]) g.box(x + sx, y + 3, z - 3, 0.6, 5.5, 0.6, [0.75, 0.15, 0.1]);
          g.box(x, y + 5.9, z - 3, 11, 0.6, 1, [0.75, 0.15, 0.1]); g.box(x, y + 5.0, z - 3, 9, 0.4, 0.6, [0.75, 0.15, 0.1]);
          c.circle(x - 4, z - 3, 0.5); c.circle(x + 4, z - 3, 0.5);
          for (const [lx, lz] of [[-5, 170], [70, 190], [55, 240]]) lamp(c, lx, lz, 0, true); }
        // base parking lamps + a small cafe
        for (const lx of [-120, -70, -20]) lamp(c, lx, -632, Math.PI, true);
        { const x = -70, z = -705, y = c.h(x, z), g = c.geo(x, z);
          g.box(x, y + 3, z, 24, 6, 10, { top: [0.3, 0.25, 0.22], side: [0.85, 0.8, 0.7] });
          g.box(x, y + 2.2, z + 5.05, 16, 2.5, 0.1, [1, 0.8, 0.5, 0.8]); c.box(x, z, 24, 10); }
      },
    };
  },

  // ------------------------------------------------------------- FOREST
  forest(q) {
    const n = makeNoise(41);
    const lake = [120, 120, 105];
    const terrain = (x, z) => {
      let h = n.fbm(x / 260, z / 260, 4) * 18 + n.fbm(x / 60, z / 60, 2) * 3;
      const d = Math.hypot(x - lake[0], z - lake[1]) + n(x / 40, z / 40) * 15;
      h = lerp(Math.max(h, 0.6 + Math.abs(h) * 0.15), -6, smoothstep(lake[2] + 40, lake[2] - 20, d));
      h += smoothstep(480, 590, Math.max(Math.abs(x), Math.abs(z))) * 35;
      return h;
    };
    const g1 = col('#3f6b35'), g2 = col('#557d3d'), dirt = col('#6b5a43'), shore = col('#bfae85');
    return {
      seed: 404, size: 1200, natural: 'dirt', boundary: 60, blend: 22,
      terrain,
      water: { y: -1.2, color: [0.22, 0.42, 0.48] },
      color: (x, z, h, slope, sd) => {
        if (h < 0.2) return shore;
        let c = mix3(g1, g2, n(x / 18, z / 18) * 0.5 + 0.5);
        if (n(x / 50, z / 50) > 0.4) c = mix3(c, dirt, 0.4);
        return c;
      },
      shoulder: col('#6e5e48'),
      roads: [
        { ...GEO.forest.roads[0], center: 'dash', color: [0.25, 0.25, 0.26], smooth: 14 },
        { ...GEO.forest.roads[1], color: [0.3, 0.28, 0.25], edge: false },
      ],
      pads: [
        { ...GEO.forest.pads[0], type: 3 },
        { ...GEO.forest.pads[1], type: 2, markings: 'lot' },
      ],
      spawns: (W) => W.roadSpawns(0, 40, 12, 1),
      challenges: [
        { name: 'Gravel Clearing', x: -175, z: -150, r: 88, target: 16000, time: 30 },
        { name: 'Lakeside Esses', x: 410, z: 120, r: 80, target: 11000, time: 25 },
        { name: 'North Bend', x: 300, z: 410, r: 75, target: 10000, time: 25 },
      ],
      env: {
        sky: { top: col('#5d8fc9'), horizon: col('#d6e2da'), bottom: col('#7d8f78') },
        sunDir: norm([0.35, 0.55, 0.65]), sunCol: [1.0, 0.94, 0.8], ambSky: [0.46, 0.56, 0.6], ambGround: [0.22, 0.28, 0.18],
        fogCol: col('#b5c6bd'), fogNear: 110, fogFar: 650, night: false, music: 'calm',
      },
      scenery(c) {
        const r = c.rand;
        c.scatter(Math.floor(7000 * q.density), (x, z, inPlay) => {
          const y = c.h(x, z);
          if (y < 0.6) return;
          const g = c.geo(x, z), s = 0.9 + r() * 0.8;
          if (r() < 0.62) pine(g, x, y, z, s * 1.35, r); else leafy(g, x, y, z, s * 1.1, r, r() < 0.2 ? [0.8, 0.5, 0.15] : undefined);
          if (inPlay) c.circle(x, z, 0.5 * s); c.shadow(x, z, 2.8 * s, 0.32);
        }, (x, z) => c.sd(x, z) > 8);
        c.scatter(Math.floor(500 * q.density), (x, z, inPlay) => {
          const y = c.h(x, z); if (y < 0) return;
          const g = c.geo(x, z), s = 0.5 + r() * 1.5;
          if (r() < 0.5) { rock(g, x, y, z, s, r, [0.5, 0.5, 0.48]); if (inPlay) c.circle(x, z, s); }
          else g.blob(x, y + 0.5, z, 1.2, 0.8, 1.2, [0.25, 0.42, 0.2], 0.3, r);
        }, (x, z) => c.sd(x, z) > 6);
        // log cabin + jetty
        { const x = 120, z = -335, y = c.h(x, z), g = c.geo(x, z);
          g.box(x, y + 2.5, z, 14, 5, 9, { top: [0.4, 0.28, 0.2], side: [0.55, 0.38, 0.25] });
          g.at(x, y + 5, z, 0).extrude([[-5, 0], [5, 0], [0, 3.2]], 15, 0.05, [0.3, 0.2, 0.16]).reset();
          c.box(x, z, 14, 9); }
        { const x = 18, z = 120, g = c.geo(x, z); g.box(x, -0.6, z, 20, 0.4, 3, [0.5, 0.36, 0.22]); }
      },
    };
  },

  // ------------------------------------------------------------- CITY
  city(q) {
    const B = 90, ST = 16, K = 4; // block pitch, street width, half count
    const lines = []; for (let i = -K; i <= K; i++) lines.push(i * B);
    const blocks = [];
    for (let i = 0; i < 2 * K; i++) for (let j = 0; j < 2 * K; j++) blocks.push({ i, j, x: (i - K + 0.5) * B, z: (j - K + 0.5) * B });
    const kind = (b) => {
      if ((b.i === 3 || b.i === 4) && (b.j === 3 || b.j === 4)) return 'plaza';
      if ((b.i === 1 && b.j === 6) || (b.i === 6 && b.j === 1) || (b.i === 6 && b.j === 6) || (b.i === 1 && b.j === 2)) return 'lot';
      if (b.i === 1 && b.j === 1) return 'park';
      return 'build';
    };
    const roads = GEO.city.roads.map((r) => ({ ...r, flatH: 0, center: 'dash', color: [0.16, 0.16, 0.18], edge: false }));
    const half = K * B;
    return {
      seed: 505, size: 900, natural: 'asphalt', boundary: 450 - half - 8, blend: 4,
      terrain: () => 0,
      surfaceFn: (x, z) => {
        const bi = Math.floor(x / B + K), bj = Math.floor(z / B + K);
        if (bi === 1 && bj === 1) {
          const lx = x - (bi - K + 0.5) * B, lz = z - (bj - K + 0.5) * B;
          if (Math.abs(lx) < (B - ST) / 2 - 4 && Math.abs(lz) < (B - ST) / 2 - 4) return 'grass';
        }
        return 'asphalt';
      },
      color: () => [0.2, 0.2, 0.22],
      roads,
      pads: [],
      spawns: () => { const out = []; for (let k = 0; k < 12; k++) out.push({ x: -40 + (k % 4) * 26, z: -30 + Math.floor(k / 4) * 30, h: 0 }); return out; },
      challenges: [
        { name: 'Plaza Showtime', x: 0, z: 0, r: 70, target: 18000, time: 30 },
        { name: 'Lot Shuffle', x: 225, z: 225, r: 40, target: 9000, time: 25 },
        { name: 'Downtown Sprint', x: -225, z: 45, r: 60, target: 10000, time: 25 },
      ],
      env: {
        sky: { top: col('#05061a'), horizon: col('#2c1b4a'), bottom: col('#120d1f') },
        sunDir: norm([-0.3, 0.7, 0.4]), sunCol: [0.22, 0.26, 0.42], sunGlow: [0.08, 0.08, 0.15], ambSky: [0.2, 0.2, 0.34], ambGround: [0.12, 0.09, 0.14],
        fogCol: col('#1a1230'), fogNear: 140, fogFar: 680, night: true, headlights: true, stars: 1, music: 'night',
      },
      scenery(c) {
        const r = c.rand, inner = (B - ST) / 2;
        const pal = [[0.32, 0.33, 0.38], [0.42, 0.36, 0.33], [0.25, 0.3, 0.38], [0.5, 0.48, 0.45], [0.3, 0.27, 0.3]];
        const neon = [[1, 0.1, 0.55], [0.1, 0.95, 0.85], [0.6, 0.3, 1], [1, 0.75, 0.1], [0.2, 0.5, 1]];
        for (const b of blocks) {
          const k = kind(b), g = c.geo(b.x, b.z);
          if (k !== 'plaza') {
            // sidewalk (flush) + curb line
            g.box(b.x, 0.015, b.z, inner * 2 + 0.01, 0.03, inner * 2 + 0.01, { top: [0.36, 0.36, 0.38], side: [0.5, 0.5, 0.5] });
            g.box(b.x, 0.03, b.z, inner * 2 - 4.5, 0.03, inner * 2 - 4.5, k === 'park' ? [0.15, 0.3, 0.12] : k === 'lot' ? [0.18, 0.18, 0.2] : [0.3, 0.3, 0.32]);
          } else {
            g.box(b.x, 0.015, b.z, B + 0.1, 0.03, B + 0.1, [0.34, 0.3, 0.36]);
          }
          // lamps at corners (all blocks)
          for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) lamp(c, b.x + sx * (inner - 1), b.z + sz * (inner - 1), Math.atan2(sx, sz), true, sx * sz > 0 ? [1, 0.82, 0.55] : [0.7, 0.85, 1]);
          if (k === 'build') {
            const split = r();
            const lots = split < 0.3 ? [[0, 0, 1, 1]] : split < 0.65 ? [[-0.5, 0, 0.5, 1], [0.5, 0, 0.5, 1]] : [[-0.5, -0.5, 0.5, 0.5], [0.5, -0.5, 0.5, 0.5], [-0.5, 0.5, 0.5, 0.5], [0.5, 0.5, 0.5, 0.5]];
            const centre = 1 - Math.hypot(b.x, b.z) / 520;
            for (const [ox, oz, fw, fd] of lots) {
              const w = (inner * 2 - 8) * fw - 2, d = (inner * 2 - 8) * fd - 2;
              const x = b.x + ox * (inner * 2 - 8) * 0.5, z = b.z + oz * (inner * 2 - 8) * 0.5;
              const h = 10 + r() * 30 + centre * centre * 70 * r();
              building(c, x, z, w, d, h, pal[Math.floor(r() * pal.length)], true, r);
              c.box(x, z, w, d);
              if (r() < 0.45) {
                const nc = neon[Math.floor(r() * neon.length)], side = r() < 0.5 ? 1 : -1;
                g.box(x + (r() - 0.5) * w * 0.5, 7 + r() * 6, z + side * (d / 2 + 0.3), 5 + r() * 6, 1.4, 0.2, [...nc, 1]);
                c.glow(x, 0.05, z + side * (d / 2 + 4), 7, [nc[0] * 0.25, nc[1] * 0.25, nc[2] * 0.25, 1]);
              }
            }
          } else if (k === 'park') {
            for (let t = 0; t < 26; t++) {
              const x = b.x + (r() - 0.5) * (inner * 2 - 12), z = b.z + (r() - 0.5) * (inner * 2 - 12);
              leafy(g, x, 0, z, 0.9 + r() * 0.5, r, [0.12, 0.3, 0.15]); c.circle(x, z, 0.5);
            }
          } else if (k === 'lot') {
            for (let x = -inner + 6; x < inner - 4; x += 3.4) for (const zz of [-inner + 7, inner - 7]) g.box(b.x + x, 0.06, b.z + zz, 0.15, 0.01, 5.5, [0.85, 0.85, 0.8]);
          } else if (k === 'plaza' && b.i === 3 && b.j === 3) {
            // centre fountain-like sculpture at the middle of the plaza (at block corner)
            const x = (b.i - K + 1) * B, z = (b.j - K + 1) * B;
            g.cylinder(x, 0.4, z, 6, 0.8, 16, [0.5, 0.5, 0.55]);
            g.cylinder(x, 3.5, z, 0.6, 6, 8, [0.6, 0.6, 0.65]);
            g.blob(x, 7.2, z, 1.6, 1.6, 1.6, [0.1, 0.9, 0.9, 1], 0, r);
            c.circle(x, z, 6.2);
            c.glow(x, 0.08, z, 16, [0.05, 0.3, 0.3, 1]);
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
        for (let t = 0; t < 120; t++) {
          const a = r() * Math.PI * 2, d = e + 25 + r() * 30;
          const x = Math.cos(a) * d * 1.05, z = Math.sin(a) * d * 1.05;
          if (Math.max(Math.abs(x), Math.abs(z)) < e + 15) continue;
          building(c, x, z, 18 + r() * 20, 18 + r() * 20, 25 + r() * 90, pal[t % pal.length], true, r);
        }
      },
    };
  },
};

function norm(v) { const l = Math.hypot(...v); return v.map((x) => x / l); }
