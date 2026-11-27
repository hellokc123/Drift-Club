// City traffic: working traffic lights at every street junction, and cars that drive in their lane on
// every street, stop at red lights, queue behind each other, brake for you and turn at junctions.
// Everything here is local to each player (cosmetic + a solid obstacle), so it costs nothing online.
import { Geo } from './engine/geometry.js';
import { mat4 } from './engine/math.js';
import { buildCarModel, carDrawItems } from './cars.js';

const CYCLE = 26; // s: group A green 9.5, amber 2.5, all-red 1, group B green 9.5, amber 2.5, all-red 1
const PAINTS = ['#c9c9cc', '#1d1f24', '#8c1d1d', '#24427a', '#e8e6df', '#5b6168', '#2f5a3a', '#b8862b', '#6b2b55', '#0f0f12', '#a7aab0', '#d6d0c4'];
const MODELS = ['hatch', 'sedan', 'pipa', 'brenna', 'trail', 'atlas', 'fennec', 'ranger', 'wren', 'castellan', 'zephyr', 'sedan', 'hatch'];

export class Traffic {
  constructor(game, { cars = true, count = 44 } = {}) {
    this.g = game; this.R = game.app.renderer; this.t = 0;
    const W = game.world;
    this.roads = W.roads.map((r, ri) => ({ r, ri })).filter(({ r }) => r.gateSpur === undefined).map(({ r, ri }) => {
      // distance along the road at each sample (for speeds in m/s)
      const s = new Float32Array(r.n); for (let k = 1; k < r.n; k++) s[k] = s[k - 1] + Math.hypot(r.x[k] - r.x[k - 1], r.z[k] - r.z[k - 1]);
      return { r, ri, s, len: s[r.n - 1] + (r.closed ? Math.hypot(r.x[0] - r.x[r.n - 1], r.z[0] - r.z[r.n - 1]) : 0), stops: [], ends: [[], []], lights: !/roundabout/i.test(r.name || '') };
    });
    this.roads.forEach((R, k) => { R.k = k; });
    this.findJunctions();
    this.buildSignals();
    this.cars = [];
    if (cars) this.spawn(count);
  }

  // ------------------------------------------------------------------ junctions
  findJunctions() {
    const cell = 24, hash = new Map(), key = (a, b) => a * 73856093 ^ b * 19349663;
    this.roads.forEach((R, k) => { const r = R.r; for (let i = 0; i < r.n; i += 2) { const h = key(Math.floor(r.x[i] / cell), Math.floor(r.z[i] / cell)); let a = hash.get(h); if (!a) hash.set(h, a = []); a.push([k, i]); } });
    const hits = [];
    this.roads.forEach((A, ka) => {
      const a = A.r;
      for (let i = 0; i < a.n; i += 2) {
        const cx = Math.floor(a.x[i] / cell), cz = Math.floor(a.z[i] / cell);
        for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
          const arr = hash.get(key(cx + dx, cz + dz)); if (!arr) continue;
          for (const [kb, j] of arr) {
            if (kb <= ka) continue;
            const b = this.roads[kb].r;
            if (Math.hypot(a.x[i] - b.x[j], a.z[i] - b.z[j]) < (a.half + b.half) * 0.55) hits.push({ x: (a.x[i] + b.x[j]) / 2, z: (a.z[i] + b.z[j]) / 2, legs: [[ka, i], [kb, j]] });
          }
        }
      }
    });
    // cluster contact points into junctions
    const J = [];
    for (const h of hits) {
      let j = J.find((q) => Math.hypot(q.x - h.x, q.z - h.z) < 36);
      if (!j) { j = { x: h.x, z: h.z, n: 0, legs: new Map() }; J.push(j); }
      j.x = (j.x * j.n + h.x) / (j.n + 1); j.z = (j.z * j.n + h.z) / (j.n + 1); j.n++;
      for (const [k, i] of h.legs) { const cur = j.legs.get(k); if (cur === undefined) j.legs.set(k, i); }
    }
    // each leg: the road sample nearest the junction centre
    this.junctions = J.map((j, id) => {
      const legs = [...j.legs.keys()].map((k) => {
        const r = this.roads[k].r; let bi = 0, bd = 1e9;
        for (let i = 0; i < r.n; i++) { const d = Math.hypot(r.x[i] - j.x, r.z[i] - j.z); if (d < bd) { bd = d; bi = i; } }
        return { k, i: bi };
      });
      const lit = legs.length >= 2 && legs.every((l) => this.roads[l.k].lights);
      return { id, x: j.x, z: j.z, legs, lit, off: (id * 7.3) % CYCLE };
    });
    // per-road list of junction crossings (for turning) and road-end connections
    for (const jn of this.junctions) for (const l of jn.legs) this.roads[l.k].stops.push({ jn, i: l.i });
    for (const R of this.roads) {
      R.stops.sort((p, q) => p.i - q.i);
      if (R.r.closed) continue;
      for (const [end, idx] of [[0, 0], [1, R.r.n - 1]]) {
        const ex = R.r.x[idx], ez = R.r.z[idx];
        this.roads.forEach((O, k) => {
          if (O === R) return;
          let bi = -1, bd = 14; for (let i = 0; i < O.r.n; i++) { const d = Math.hypot(O.r.x[i] - ex, O.r.z[i] - ez); if (d < bd) { bd = d; bi = i; } }
          if (bi >= 0) R.ends[end].push({ k, i: bi });
        });
      }
    }
  }
  // which group a road is in at a junction: the first leg's road is group A, the rest group B
  lightFor(jn, k) {
    if (!jn.lit) return 'g';
    const ph = (this.t + jn.off) % CYCLE, A = jn.legs[0].k === k;
    const p = A ? ph : (ph + 13) % CYCLE;
    return p < 9.5 ? 'g' : p < 12 ? 'a' : 'r';
  }

  // ------------------------------------------------------------------ signal heads
  buildSignals() {
    const W = this.g.world, poles = new Geo(), lens = new Geo();
    lens.box(0, 0, 0, 0.26, 0.26, 0.08, [1, 1, 1]);
    this.heads = [];
    for (const jn of this.junctions) {
      if (!jn.lit) continue;
      const maxHalf = Math.max(...jn.legs.map((l) => this.roads[l.k].r.half));
      for (const l of jn.legs) {
        const R = this.roads[l.k], r = R.r;
        for (const d of [1, -1]) {
          // stop line: back from the junction by the crossing road's half width + 3 m
          let si = l.i, run = 0;
          while (run < maxHalf + 3) { const ni = si - d; if (ni < 0 || ni >= r.n) { si = -1; break; } run += Math.hypot(r.x[ni] - r.x[si], r.z[ni] - r.z[si]); si = ni; }
          if (si < 0) continue; // the road starts/ends at this junction on this side: no approach
          const fx = r.tx[si] * d, fz = r.tz[si] * d, rx = -fz, rz = fx; // travel direction and its right
          const px = r.x[si] + rx * (r.half + 1.8), pz = r.z[si] + rz * (r.half + 1.8);
          const y = W.heightAt(px, pz), yaw = Math.atan2(-fx, -fz); // the lenses face the drivers
          poles.cylinder(px, y + 2.6, pz, 0.11, 5.2, 6, [0.16, 0.17, 0.19]);
          poles.at(px, y + 5.3, pz, yaw).box(0, 0, 0.06, 0.42, 1.15, 0.3, [0.07, 0.07, 0.08]).box(0, 0, 0.23, 0.5, 1.25, 0.04, [0.12, 0.12, 0.13]).reset();
          W.addCircle(px, pz, 0.3);
          const m = (dy) => mat4.compose(new Float32Array(16), px - fx * 0.24, y + 5.3 + dy, pz - fz * 0.24, yaw, 0, 0);
          this.heads.push({ jn, k: l.k, x: px, z: pz, m: [m(0.36), m(0), m(-0.36)] });
          R.stopLines = R.stopLines || []; R.stopLines.push({ jn, i: si, d });
        }
      }
    }
    this.poleMesh = poles.p.length ? this.R.createMesh(poles.build()) : null;
    this.lensMesh = this.R.createMesh(lens.build());
    this.I = mat4.compose(new Float32Array(16), 0, 0, 0, 0, 0, 0);
  }

  // ------------------------------------------------------------------ cars
  spawn(count) {
    const W = this.g.world, car = this.g.car, total = this.roads.reduce((a, R) => a + R.len, 0);
    let tries = 0;
    while (this.cars.length < count && tries++ < count * 40) {
      // longer streets get more cars
      let pick = Math.random() * total, R = this.roads[0];
      for (const q of this.roads) { pick -= q.len; if (pick <= 0) { R = q; break; } }
      const i = 2 + Math.random() * (R.r.n - 4), d = Math.random() < 0.5 ? 1 : -1;
      const c = { R, i, d, v: 0, vmax: 12 + Math.random() * 6, stopT: 0, wait: 0 };
      this.place(c);
      if (car && Math.hypot(c.x - car.x, c.z - car.z) < 70) continue;
      if (this.cars.some((o) => Math.hypot(o.x - c.x, o.z - c.z) < 16)) continue;
      const id = MODELS[Math.floor(Math.random() * MODELS.length)];
      c.model = buildCarModel(this.R, { id, paint: PAINTS[Math.floor(Math.random() * PAINTS.length)], wheel: '#2a2b2e' });
      const dm = c.model.meshes.dims; c.radius = dm.W * 0.5; c.offset = dm.L * 0.27; c.mass = 1400; c.dims = dm;
      c.y = W.heightAt(c.x, c.z); c.spin = 0;
      this.cars.push(c);
    }
  }
  // position + heading from (road, float sample index, direction), in the right-hand lane
  place(c) {
    const r = c.R.r, n = r.n;
    let i = c.i; if (r.closed) i = ((i % n) + n) % n; else i = Math.max(0, Math.min(n - 1.001, i));
    const i0 = Math.floor(i), i1 = r.closed ? (i0 + 1) % n : Math.min(n - 1, i0 + 1), f = i - i0;
    const tx = r.tx[i0] + (r.tx[i1] - r.tx[i0]) * f, tz = r.tz[i0] + (r.tz[i1] - r.tz[i0]) * f, tl = Math.hypot(tx, tz) || 1;
    const fx = (tx / tl) * c.d, fz = (tz / tl) * c.d, lane = r.half * 0.48;
    // right-hand traffic: the car's right is (-fz, fx) (in this engine +x local is the car's left)
    const x = r.x[i0] + (r.x[i1] - r.x[i0]) * f - fz * lane, z = r.z[i0] + (r.z[i1] - r.z[i0]) * f + fx * lane;
    c.vx = c.x !== undefined ? (x - c.x) : 0; c.vz = c.z !== undefined ? (z - c.z) : 0;
    c.x = x; c.z = z; c.h = Math.atan2(fx, fz); c.fx = fx; c.fz = fz;
  }
  // metres per sample at index i
  step(R, i) { const r = R.r, n = r.n, i0 = Math.max(0, Math.min(n - 2, Math.floor(i))); return Math.max(0.5, R.s[i0 + 1] - R.s[i0]) || 3; }

  update(dt) {
    this.t += dt;
    const W = this.g.world, me = this.g.car;
    for (const c of this.cars) {
      const r = c.R.r, sp = this.step(c.R, c.i);
      let target = c.vmax;
      // tight bends: slow down
      if (!Number.isFinite(c.v)) c.v = 0;
      const ahead = Math.round(c.i + c.d * 8), ia = r.closed ? ((ahead % r.n) + r.n) % r.n : Math.max(0, Math.min(r.n - 1, ahead));
      const turn = Math.abs(Math.atan2(r.tx[Math.floor(c.i) % r.n] * r.tz[ia] - r.tz[Math.floor(c.i) % r.n] * r.tx[ia], r.tx[Math.floor(c.i) % r.n] * r.tx[ia] + r.tz[Math.floor(c.i) % r.n] * r.tz[ia]));
      target = Math.min(target, Math.max(6, 18 - turn * 14));
      // red / amber lights ahead in my direction
      for (const st of c.R.stopLines || []) {
        if (st.d !== c.d) continue;
        let di = (st.i - c.i) * c.d; if (r.closed && di < 0) di += r.n;
        const dist = di * sp;
        if (dist < -1 || dist > 45) continue;
        const L = this.lightFor(st.jn, c.R.k);
        if (L === 'r' || (L === 'a' && dist > 14)) target = Math.min(target, Math.sqrt(Math.max(0, dist - 1.5) * 2 * 3.2));
      }
      // the car in front (any car within my lane ahead), and you
      const look = (ox, oz, gap) => {
        const dx = ox - c.x, dz = oz - c.z, along = dx * c.fx + dz * c.fz, lat = Math.abs(dx * c.fz - dz * c.fx);
        if (along > 0 && along < 40 && lat < 3.2) target = Math.min(target, Math.max(0, (along - gap) * 0.9));
      };
      for (const o of this.cars) if (o !== c && Math.abs(o.x - c.x) < 40 && Math.abs(o.z - c.z) < 40 && (o.fx * c.fx + o.fz * c.fz) > 0.3) look(o.x, o.z, 9);
      if (me) look(me.x, me.z, 8);
      if (c.stopT > 0) { c.stopT -= dt; target = 0; }
      // accelerate / brake smoothly
      const prev = c.v;
      c.v = target > c.v ? Math.min(target, c.v + 3 * dt) : Math.max(target, c.v - 7 * dt);
      c.brake = c.v < prev - 0.01 || c.v < 0.3;
      c.i += (c.d * c.v * dt) / sp;
      if (r.closed) c.i = ((c.i % r.n) + r.n) % r.n;
      // junction turns: when crossing a junction centre, sometimes turn onto the other street
      for (const st of c.R.stops) {
        const was = (st.i - (c.i - (c.d * c.v * dt) / sp)) * c.d, now = (st.i - c.i) * c.d;
        if (was > 0 && now <= 0 && Math.random() < 0.35) {
          const opts = st.jn.legs.filter((l) => this.roads[l.k] !== c.R);
          if (opts.length) { const l = opts[Math.floor(Math.random() * opts.length)]; c.R = this.roads[l.k]; c.i = l.i; c.d = l.i < 3 ? 1 : l.i > c.R.r.n - 4 ? -1 : (Math.random() < 0.5 ? 1 : -1); c.x = undefined; }
          break;
        }
      }
      // end of an open street: continue onto a connecting street (or turn round)
      const rr = c.R.r;
      if (!rr.closed && (c.i <= 0 || c.i >= rr.n - 1)) {
        const opts = c.R.ends[c.i <= 0 ? 0 : 1];
        if (opts.length) { const l = opts[Math.floor(Math.random() * opts.length)]; c.R = this.roads[l.k]; c.i = l.i; c.d = l.i < 3 ? 1 : l.i > c.R.r.n - 4 ? -1 : (Math.random() < 0.5 ? 1 : -1); }
        else { c.d = -c.d; c.i = Math.max(0.5, Math.min(rr.n - 1.5, c.i)); }
        c.x = undefined;
      }
      this.place(c);
      if (dt > 0) { c.vx = c.vx / dt; c.vz = c.vz / dt; }
      if (Math.hypot(c.vx, c.vz) > 40) { c.vx = c.fx * c.v; c.vz = c.fz * c.v; } // after a road change
      c.y = W.heightAt(c.x, c.z);
      c.spin += (c.v / 0.33) * dt;
    }
  }
  // physics: you bump into traffic (called every physics step); the car you hit stops for a moment
  collide(car) {
    for (const c of this.cars) {
      if (Math.abs(c.x - car.x) > 8 || Math.abs(c.z - car.z) > 8) continue;
      const before = car.impact;
      car.collideCar(c);
      if (car.impact > before || car.impact > 0.5) { c.stopT = 2.5; c.v = 0; }
    }
  }

  draw(items) {
    const e = this.g.cam.eye || [this.g.car.x, 0, this.g.car.z], cx = e[0], cz = e[2];
    if (this.poleMesh) items.push({ mesh: this.poleMesh, matrix: this.I, spec: 0.2 });
    const COL = { g: [0.15, 1.6, 0.45], a: [1.7, 1.05, 0.1], r: [1.8, 0.1, 0.06] }, OFF = [0.1, 0.1, 0.1];
    for (const h of this.heads) {
      if (Math.abs(h.x - cx) > 420 || Math.abs(h.z - cz) > 420) continue;
      const L = this.lightFor(h.jn, h.k);
      items.push({ mesh: this.lensMesh, matrix: h.m[0], emissive: 1, tint: L === 'r' ? COL.r : OFF });
      items.push({ mesh: this.lensMesh, matrix: h.m[1], emissive: 1, tint: L === 'a' ? COL.a : OFF });
      items.push({ mesh: this.lensMesh, matrix: h.m[2], emissive: 1, tint: L === 'g' ? COL.g : OFF });
    }
    for (const c of this.cars) {
      if (Math.abs(c.x - cx) > 380 || Math.abs(c.z - cz) > 380) continue;
      carDrawItems(c.model, { x: c.x, y: c.y, z: c.z, yaw: c.h, spin: c.spin, steer: 0, brake: c.brake, lights: true }, items);
    }
  }
}
