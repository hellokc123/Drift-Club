import { Vehicle, PHYS_DT } from '../public/js/physics.js';
import { carById, carDims } from '../public/js/cars.js';
const pad = { heightAt: () => 0, surfaceAt: () => ({ grip: 1, drag: 0 }), query: () => [], waterY: -1e9 };
const N = { throttle: 0, brake: 0, steer: 0, handbrake: false, boost: false };
const lat = (v) => -Math.sin(v.h) * v.vx + Math.cos(v.h) * v.vz; // not exact; use rel instead
export function spin(id, kmh, after, thrDuring = 1) {
  const d = carById(id); const v = new Vehicle(d, pad, carDims(d), { style: 'drift', maxAngle: 62 }); v.place(0,0,0);
  for (let t = 0; t < 30 && v.speed < kmh / 3.6; t += PHYS_DT) v.step(PHYS_DT, { ...N, throttle: 1 });
  let rot = 0, ph = v.h, x0 = v.x, z0 = v.z, tSpin = 0;
  for (; tSpin < 5 && Math.abs(rot) < 2 * Math.PI - 0.3; tSpin += PHYS_DT) { v.step(PHYS_DT, { ...N, throttle: thrDuring, steer: 1, handbrake: true }); let dd = v.h - ph; rot += Math.atan2(Math.sin(dd), Math.cos(dd)); ph = v.h; }
  const spinDist = Math.hypot(v.x - x0, v.z - z0); const x1 = v.x, z1 = v.z; const spdAfterSpin = v.speed * 3.6;
  const inp = after === 'release' ? { ...N } : after === 'gas+steer' ? { ...N, throttle: 1, steer: 1 } : { ...N, throttle: 1 };
  let settle = null, redrift = false, wasGrip = false;
  for (let t = 0; t < 4; t += PHYS_DT) { v.step(PHYS_DT, inp); if (v.mode === 'grip') { wasGrip = true; if (settle === null && Math.abs(v.rel) < 0.15) settle = t; } else if (wasGrip) redrift = true; }
  return { spin: tSpin.toFixed(2) + 's/' + spinDist.toFixed(0) + 'm', spdAfter: spdAfterSpin.toFixed(0), settle: settle === null ? 'never' : settle.toFixed(2), after: Math.hypot(v.x - x1, v.z - z1).toFixed(0) + 'm', redrift, rotDeg: (Math.abs(rot) * 57.3).toFixed(0) };
}
