// CPU drivers for solo Speed Race (and as test drivers). They drive the same Vehicle physics
// as the player — no shortcuts: pure-pursuit steering along the race line, speed planned from
// the curvature ahead (corner speed + braking distance), simple lane changes to overtake, and
// a reset if stuck (resets never count as checkpoints).
import { clamp, wrapAngle } from './tracks.js';

// assist: CPU cars on Hard/Legend get a small engine + tyre advantage (like a pro driver's setup)
export const AI_SKILL = {
  easy: { name: 'Easy', pace: 0.84, grip: 0.9, brake: 8, noise: 0.05, boost: false, assist: 1 },
  medium: { name: 'Medium', pace: 0.96, grip: 0.98, brake: 10, noise: 0.015, boost: true, assist: 1.02 },
  hard: { name: 'Hard', pace: 1.0, grip: 1.02, brake: 12, noise: 0.0, boost: true, assist: 1.08 },
  legend: { name: 'Legend', pace: 1.0, grip: 1.04, brake: 13, noise: 0.0, boost: true, assist: 1.15 },
  boss: { name: 'Boss', hidden: true, pace: 1.0, grip: 1.1, brake: 15, noise: 0.0, boost: true, assist: 1.3 }, // Midnight Oni only
};
// the car a CPU driver actually drives at this skill
export function aiDef(def, skill) {
  const a = (AI_SKILL[skill] || AI_SKILL.medium).assist || 1;
  if (a === 1) return def;
  return { ...def, accel: def.accel * a, lat: def.lat * a, grip: def.grip * a, top: def.top * (1 + (a - 1) * 0.6) };
}

export class AIDriver {
  constructor(vehicle, path, skill = 'medium', seed = 1) {
    this.v = vehicle; this.path = path; this.sk = AI_SKILL[skill] || AI_SKILL.medium;
    this.idx = this.nearest(0, path.n); this.lane = 0; this.laneT = 0; this.stuckT = 0; this.seed = seed;
    this.rand = () => { this.seed = (this.seed * 16807) % 2147483647; return this.seed / 2147483647; };
    this.wobble = 0; this.teleported = false;
    // start in the lane we were placed in (grid column) and merge onto the line gradually,
    // instead of every car aiming for the centre line at once and wedging together on narrow roads
    const i = this.idx;
    this.lane = clamp((vehicle.x - path.x[i]) * -path.tz[i] + (vehicle.z - path.z[i]) * path.tx[i], -3.5, 3.5); this.laneT = 2.5;
  }
  nearest(from, span) {
    const p = this.path, v = this.v; let best = 1e18, bi = from;
    for (let k = -span; k <= span; k++) {
      const i = ((from + k) % p.n + p.n) % p.n;
      const d = (p.x[i] - v.x) ** 2 + (p.z[i] - v.z) ** 2;
      if (d < best) { best = d; bi = i; }
    }
    return bi;
  }
  at(i) { const p = this.path, n = p.n; i = p.closed ? ((i % n) + n) % n : clamp(i, 0, n - 1); return i; }
  // heading change over the next ~18 m at sample i → corner radius
  radiusAt(i) {
    const p = this.path, a = this.at(i), b = this.at(i + 6);
    const da = Math.abs(wrapAngle(Math.atan2(p.tx[b], p.tz[b]) - Math.atan2(p.tx[a], p.tz[a])));
    return da < 1e-3 ? 1e4 : 18 / da;
  }
  // others: [{x,z,vx,vz}] other cars, for overtaking
  control(dt, others = [], go = true) {
    const v = this.v, p = this.path, sk = this.sk, d = v.def;
    this.idx = this.nearest(this.idx, 25);
    const speed = v.speed;
    // ---- target speed from the curvature ahead (corner speed + braking distance)
    const aLat = d.lat * v.S.lat * 0.98 * sk.grip, top = d.top * sk.pace;
    let vt = top;
    for (let s = 0; s < 70; s += 3) {
      const R = this.radiusAt(this.idx + s);
      const vc = Math.sqrt(aLat * R) * (0.92 + 0.08 * sk.pace);
      const dist = s * 3;
      vt = Math.min(vt, Math.sqrt(vc * vc + 2 * sk.brake * dist));
    }
    // ---- lane offset for overtaking
    const fx = Math.sin(v.h), fz = Math.cos(v.h);
    let blocked = 0;
    for (const o of others) {
      // side: + = to my right (same convention as this.lane)
      const rx = o.x - v.x, rz = o.z - v.z, ahead = rx * fx + rz * fz, side = -rx * fz + rz * fx;
      if (ahead > 0 && ahead < 16 && Math.abs(side) < 2.8) blocked = side >= 0 ? -1 : 1;
      // a car right alongside: ease away from it rather than both squeezing into the same lane
      if (Math.abs(ahead) < 5 && Math.abs(side) < 4.2) { this.lane = clamp(this.lane - Math.sign(side || 1) * 3 * dt, -3.5, 3.5); this.laneT = Math.max(this.laneT, 0.6); }
    }
    if (blocked) { this.lane = clamp(this.lane + blocked * 4 * dt, -3.5, 3.5); this.laneT = 1.5; }
    else if ((this.laneT -= dt) < 0) this.lane *= 1 - dt * 0.8;
    // ---- pure pursuit steering
    const rNow = Math.min(this.radiusAt(this.idx), this.radiusAt(this.idx + 3));
    const la = Math.max(2, Math.round(Math.min(6 + speed * 0.42, 4 + rNow * 0.7) / 3));
    const ti = this.at(this.idx + la);
    const tx = p.x[ti] - p.tz[ti] * this.lane, tz = p.z[ti] + p.tx[ti] * this.lane;
    if (sk.noise) this.wobble += (this.rand() - 0.5) * sk.noise * 4 * dt - this.wobble * dt;
    const e = wrapAngle(Math.atan2(tx - v.x, tz - v.z) - v.h) + this.wobble;
    const inp = { throttle: 0, brake: 0, steer: clamp((e * 2.4 - v.slip * 0.6) * (d.steer / v.lock), -1, 1), handbrake: false, boost: false, analog: true };
    if (speed < vt - 1) inp.throttle = 1; else if (speed < vt + 0.5) inp.throttle = 0.4;
    if (speed > vt + 1.5) { inp.throttle = 0; inp.brake = clamp((speed - vt) / 3, 0.5, 1); }
    if (sk.boost && vt > top * 0.97 && Math.abs(e) < 0.05) inp.boost = true;
    if (!go) { inp.throttle = 0; inp.brake = 0; inp.handbrake = true; inp.boost = false; }
    // ---- stuck recovery
    if (go && speed < 2) this.stuckT += dt; else this.stuckT = 0;
    if (this.stuckT > 3) {
      const back = this.at(this.idx - 2);
      v.place(p.x[back] - p.tz[back] * this.lane, p.z[back] + p.tx[back] * this.lane, Math.atan2(p.tx[back], p.tz[back]));
      this.stuckT = 0; this.teleported = true;
    }
    return inp;
  }
}
