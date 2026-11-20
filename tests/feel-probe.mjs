// Drift "feel" probe: prints numbers for the two player complaints.
// Run: node tests/feel-probe.mjs
import { Vehicle, PHYS_DT } from '../public/js/physics.js';
import { carById, carDims } from '../public/js/cars.js';

const pad = { heightAt: () => 0, surfaceAt: () => ({ grip: 1, drag: 0 }), query: () => [], waterY: -1e9 };
const N = { throttle: 0, brake: 0, steer: 0, handbrake: false, boost: false };
const make = (id, style = 'drift') => { const d = carById(id); const v = new Vehicle(d, pad, carDims(d), { style, maxAngle: 62 }); v.place(0, 0, 0); return v; };
const run = (v, secs, inp, each) => { for (let t = 0; t < secs - 1e-9; t += PHYS_DT) { v.step(PHYS_DT, typeof inp === 'function' ? inp(v, t) : inp); if (each && each(v, t) === true) return t; } return null; };
const upTo = (v, ms) => run(v, 30, { ...N, throttle: 1 }, (c) => c.speed >= ms);
const lat = (c) => { const s = Math.sin(c.h), co = Math.cos(c.h); return -c.vx * co + c.vz * s; };
const deg = (r) => (r * 57.3).toFixed(0);

// a big left drift: handbrake flick, then hold steering into it on throttle for 2 s
export function bigDrift(v) { upTo(v, 20); run(v, 0.3, { ...N, throttle: 0.7, steer: 1, handbrake: true }); run(v, 2, { ...N, throttle: 0.9, steer: 0.7 }); }

// 1) exit: from a big drift, how long until grip when the player (a) lets go of steering but stays on the gas,
//    (b) counter-steers (full, held), (c) lifts off. Also: max slip on the OTHER side (overshoot / flip).
export function exitTest(id, kind, style = 'drift') {
  const v = make(id, style); bigDrift(v);
  const startAng = Math.abs(v.rel), dir0 = Math.sign(v.rel);
  const inp = kind === 'neutral' ? { ...N, throttle: 1 } : kind === 'counter' ? { ...N, throttle: 0.8, steer: -1 } : kind === 'tap' ? (c, t) => ({ ...N, throttle: 0.8, steer: t < 0.25 ? -1 : 0 }) : { ...N };
  let other = 0;
  const t = run(v, 4, inp, (c) => { if (Math.sign(c.rel) === -dir0) other = Math.max(other, Math.abs(c.rel)); return c.mode === 'grip' && Math.abs(c.rel) < 0.1; });
  // after reaching grip, keep the same inputs 1 more second: does it start drifting again on its own?
  let redrift = false; if (t !== null) run(v, 1, inp, (c) => { if (c.mode !== 'grip') redrift = true; });
  return { startDeg: deg(startAng), exitS: t === null ? '>4' : t.toFixed(2), otherSideDeg: deg(other), redrift, speedKmh: (v.speed * 3.6).toFixed(0) };
}

// 2) 360: handbrake + full lock at ~50 km/h until rotated 330°, then release everything (or drive on).
export function spinTest(id, after = 'release') {
  const v = make(id); upTo(v, 14);
  let rot = 0, prevH = v.h;
  run(v, 4, { ...N, throttle: 0.6, steer: 1, handbrake: true }, (c) => { let d = c.h - prevH; d = Math.atan2(Math.sin(d), Math.cos(d)); rot += d; prevH = c.h; return Math.abs(rot) > 5.76; });
  const x0 = v.x, z0 = v.z;
  const inp = after === 'release' ? { ...N } : { ...N, throttle: 1 };
  let maxW = 0;
  const t = run(v, 3, inp, (c, t) => { if (t > 0.3) maxW = Math.max(maxW, Math.abs(c.w - (c.velRate || 0))); return t > 0.2 && Math.abs(c.w) < 0.3 && Math.abs(lat(c)) < 1; });
  return { rotatedDeg: deg(Math.abs(rot)), settleS: t === null ? '>3' : t.toFixed(2), travelM: Math.hypot(v.x - x0, v.z - z0).toFixed(1), mode: v.mode, latMs: lat(v).toFixed(1) };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  for (const id of ['hatch', 'shiro', 'kitsune']) {
    console.log(id, 'exit neutral+gas', exitTest(id, 'neutral'));
    console.log(id, 'exit counter-steer', exitTest(id, 'counter'));
    console.log(id, 'exit counter tap', exitTest(id, 'tap'));
    console.log(id, 'exit lift', exitTest(id, 'lift'));
    console.log(id, '360 release', spinTest(id, 'release'));
    console.log(id, '360 drive on', spinTest(id, 'gas'));
  }
}
