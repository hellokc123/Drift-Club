// Garage statistics, MEASURED by driving the (tuned) car in the real physics engine on a flat test
// pad - no hand-made numbers. Each test is a short headless simulation (~10k physics steps, a few ms).
import { Vehicle, PHYS_DT } from './physics.js';
import { carDims } from './cars.js';

const ASPHALT = { grip: 1, drag: 0 };
const PAD = { heightAt: () => 0, surfaceAt: () => ASPHALT, query: () => [], waterY: -1e9 };
const N = { throttle: 0, brake: 0, steer: 0, handbrake: false };

function car(def, style) { const v = new Vehicle(def, PAD, carDims(def), { style, maxAngle: 62 }); v.place(0, 0, 0); return v; }
function run(v, secs, inp, until) { for (let t = 0; t < secs; t += PHYS_DT) { v.step(PHYS_DT, typeof inp === 'function' ? inp(v, t) : inp); if (until && until(v, t)) return t; } return secs; }
function hold(v, kmh, steer = 0, extra = {}) { const e = kmh / 3.6 - v.speed; return { ...N, throttle: e > 0 ? Math.min(1, e * 0.8) : 0, brake: e < -1 ? Math.min(1, -e * 0.3) : 0, steer, ...extra }; }

export function measureStats(def, style = 'race') {
  const out = {};
  // top speed (no boost) and 0-100 km/h
  { const v = car(def, style); let t100 = null, last = 0, stall = 0;
    run(v, 90, { ...N, throttle: 1 }, (c, t) => { if (t100 === null && c.speed >= 27.78) t100 = t; if (c.speed - last < 0.0004) stall++; else stall = 0; last = c.speed; return stall > 240; });
    out.top = v.speed * 3.6; out.accel = t100 ?? 99; }
  // 100-0 km/h braking distance
  { const v = car(def, style); run(v, 30, { ...N, throttle: 1 }, (c) => c.speed >= 27.78); const z0 = v.z, x0 = v.x;
    run(v, 10, { ...N, brake: 1 }, (c) => c.speed < 0.3); out.brake = Math.hypot(v.x - x0, v.z - z0); }
  // cornering: steady lateral g at 80 km/h, full lock
  { const v = car(def, style); run(v, 30, { ...N, throttle: 1 }, (c) => c.speed >= 22.2); let w = 0, n = 0;
    run(v, 4, (c, t) => { if (t > 2.5) { w += Math.abs(c.w) * c.speed; n++; } return hold(c, 80, 1); }); out.corner = w / n / 9.81; }
  // grip: how fast a sideways slide is caught (lateral grip rate, 1/s), at 60 km/h
  { const v = car(def, style); run(v, 30, { ...N, throttle: 1 }, (c) => c.speed >= 16.7);
    const sh = Math.sin(v.h), ch = Math.cos(v.h); v.vx += -ch * 1.8; v.vz += sh * 1.8; // small sideways kick (too small to start a drift)
    let t = run(v, 3, (c) => hold(c, 60), (c) => { const s2 = Math.sin(c.h), c2 = Math.cos(c.h); return Math.abs(-c.vx * c2 + c.vz * s2) < 0.18; });
    out.grip = t < 3 ? Math.log(10) / Math.max(0.05, t) : 0.5; }
  // steering: turning circle (diameter) at 20 km/h and how quickly full lock is reached
  { const v = car(def, style); run(v, 10, { ...N, throttle: 1 }, (c) => c.speed >= 5.56); let w = 0, n = 0;
    run(v, 4, (c, t) => { if (t > 2.5) { w += Math.abs(c.w); n++; } return hold(c, 20, 1); });
    out.circle = 2 * (20 / 3.6) / Math.max(0.05, w / n);
    // turn-in: time to reach 90% of the settled yaw rate after full lock is applied at 50 km/h
    const v2 = car(def, style); run(v2, 10, { ...N, throttle: 1 }, (c) => c.speed >= 13.9); const trace = [];
    run(v2, 1.5, (c, t) => { trace.push([t, Math.abs(c.w)]); return hold(c, 50, 1); });
    const fin = trace.slice(-30).reduce((a, p) => a + p[1], 0) / 30, hit = trace.find((p) => p[1] >= 0.9 * fin);
    out.response = hit ? hit[0] : 1.5; }
  // drift, four parts:
  //  flick  - lowest speed at which a handbrake flick + lock starts a drift (lower = easier)
  //  power  - time for throttle + full lock alone (no handbrake) to break the rear loose from 40 km/h
  //  sustain- after a 65 km/h entry, a committed drift for 4 s: share of time sideways and the angle reached
  //  keep   - share of the speed kept through that drift
  { let flick = 75;
    for (let k = 10; k <= 75; k += 5) {
      const v = car(def, style); run(v, 20, { ...N, throttle: 1 }, (c) => c.speed >= k / 3.6);
      run(v, 0.2, { ...N, steer: 1, handbrake: true }); let ok = false;
      run(v, 1.2, { ...N, throttle: 0.6, steer: 0.6 }, (c) => (ok = c.drifting && Math.abs(c.rel) > 0.25));
      if (ok) { flick = k; break; }
    }
    const vp = car(def, style); run(vp, 20, { ...N, throttle: 1 }, (c) => c.speed >= 11.1);
    const power = run(vp, 3, { ...N, throttle: 1, steer: 1 }, (c) => c.drifting);
    const v = car(def, style); run(v, 30, { ...N, throttle: 1 }, (c) => c.speed >= 18.06); const s0 = v.speed;
    run(v, 0.3, { ...N, throttle: 0.6, steer: 1, handbrake: true });
    let ang = 0, n = 0, slid = 0, tot = 0;
    run(v, 4, (c) => { tot++; if (c.drifting) { slid++; ang += Math.abs(c.rel); n++; } return { ...N, throttle: 0.8, steer: 0.7 }; }); // a committed, deep drift
    out.driftFlick = flick; out.driftPower = power; out.driftAngle = n ? (ang / n) * 57.3 : 0; out.driftHold = slid / tot; out.driftKeep = v.speed / s0;
    const fS = (75 - flick) / 65, pS = power < 3 ? 1 - power / 3 : 0, hS = out.driftHold * Math.min(1, out.driftAngle / 55), kS = Math.max(0, Math.min(1, (out.driftKeep - 0.35) / 0.6));
    out.drift = Math.round(100 * (0.2 * fS + 0.25 * pS + 0.35 * hS + 0.2 * kS)); }
  out.weight = Math.round(def.mass * 1250);
  return out;
}

// bar scales (fixed across all cars so cars can be compared): [worst, best]
export const STAT_SCALE = {
  top: { name: 'Top speed', unit: 'km/h', lo: 150, hi: 340, fmt: (v) => Math.round(v) },
  accel: { name: 'Acceleration', unit: 's 0–100', lo: 8.5, hi: 2.5, fmt: (v) => v.toFixed(1) },
  corner: { name: 'Handling', unit: 'g', lo: 0.7, hi: 2.6, fmt: (v) => v.toFixed(2) },
  grip: { name: 'Grip', unit: 'slide recovery', lo: 2, hi: 16, fmt: (v) => v.toFixed(1) },
  circle: { name: 'Steering', unit: 'm circle', lo: 14, hi: 4.5, fmt: (v) => v.toFixed(1) },
  response: { name: 'Turn-in', unit: 's to full turn', lo: 0.45, hi: 0.12, fmt: (v) => v.toFixed(2) },
  brake: { name: 'Braking', unit: 'm 100–0', lo: 40, hi: 16, fmt: (v) => v.toFixed(1) },
  weight: { name: 'Weight', unit: 'kg', lo: 2300, hi: 1000, fmt: (v) => v },
  drift: { name: 'Drift', unit: '/100', lo: 0, hi: 100, fmt: (v) => Math.round(v) },
};
export const statFrac = (k, v) => { const s = STAT_SCALE[k]; return Math.max(0.03, Math.min(1, (v - s.lo) / (s.hi - s.lo))); };
