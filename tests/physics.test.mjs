// Physics tests for Drift Club. Run with:  node tests/physics.test.mjs
// They drive the real Vehicle physics with scripted inputs at the fixed physics step (no browser needed).
import test from 'node:test';
import assert from 'node:assert/strict';
import { Vehicle, PHYS_DT } from '../public/js/physics.js';
import { CARS, carById, carDims } from '../public/js/cars.js';
import { applyTune, sanitizeTune, builtinPresets } from '../public/js/tuning.js';

const ASPHALT = { grip: 1, drag: 0 };
// flat test pad; `walls` is a list of wall segments [ax, az, bx, bz]
function pad(walls = []) {
  return { heightAt: () => 0, surfaceAt: () => ASPHALT, query: () => walls.map((s) => ({ s })), waterY: -1e9 };
}
const N = { throttle: 0, brake: 0, steer: 0, handbrake: false, boost: false };
function makeCar(id, style = 'drift', world = pad()) {
  const def = carById(id); const v = new Vehicle(def, world, carDims(def), { style, maxAngle: 62 });
  v.place(0, 0, 0); return v;
}
// step for `secs`; inp can be an object or a function (car, t) -> input. each(car, t) is called after every step.
function run(v, secs, inp, each) {
  for (let t = 0; t < secs - 1e-9; t += PHYS_DT) { v.step(PHYS_DT, typeof inp === 'function' ? inp(v, t) : inp); if (each && each(v, t) === true) return t; }
  return secs;
}
const upTo = (v, ms) => run(v, 30, { ...N, throttle: 1 }, (c) => c.speed >= ms);
// handbrake flick into a left-hand drift from `ms` m/s
function enterDrift(v, ms = 18) { upTo(v, ms); run(v, 0.3, { ...N, throttle: 0.6, steer: 1, handbrake: true }); }
const finite = (v) => ['x', 'y', 'z', 'h', 'vx', 'vz', 'w', 'pitch', 'roll', 'rpm', 'bodyRoll', 'bodyPitch', 'wheelAngle'].every((k) => Number.isFinite(v[k]));

test('no NaNs for any car, style or input mix', () => {
  let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (const def of CARS) for (const style of ['drift', 'race']) {
    const v = makeCar(def.id, style);
    let inp = { ...N };
    run(v, 25, (c, t) => {
      if (Math.round(t / PHYS_DT) % 40 === 0) inp = { throttle: rnd() < 0.7 ? rnd() : 0, brake: rnd() < 0.2 ? rnd() : 0, steer: rnd() * 2 - 1, handbrake: rnd() < 0.15, boost: rnd() < 0.1, analog: rnd() < 0.5 };
      return inp;
    }, (c) => { assert.ok(finite(c), `${def.id}/${style} produced a non-finite value`); });
  }
});

test('top speeds are sane and follow the car stats', () => {
  const tops = {};
  for (const def of CARS) {
    const v = makeCar(def.id, 'race'); run(v, 60, { ...N, throttle: 1 });
    const kmh = v.speed * 3.6; tops[def.id] = kmh;
    assert.ok(kmh > 100 && kmh < 330, `${def.id} top speed ${kmh.toFixed(0)} km/h`);
    assert.ok(v.speed <= def.top * 1.02, `${def.id} exceeds its top speed stat`);
  }
  assert.ok(tops.aurora > tops.hatch + 60, 'hypercar should be much faster than the hatchback');
});

test('handbrake drift gives a sustained slip angle', () => {
  for (const id of ['hatch', 'shiro', 'thunder', 'atlas']) {
    const v = makeCar(id); enterDrift(v);
    let slid = 0, n = 0, ang = 0;
    run(v, 4, { ...N, throttle: 0.8, steer: 0.6 }, (c) => { n++; if (c.drifting) { slid++; ang += Math.abs(c.rel); } });
    const mean = (ang / Math.max(1, slid)) * 57.3;
    assert.ok(slid / n > 0.9, `${id} drifted only ${(100 * slid / n).toFixed(0)}% of the time`);
    assert.ok(mean > 25 && mean < 80, `${id} mean drift angle ${mean.toFixed(0)} deg`);
  }
});

test('drifting never creates speed out of nothing (energy) and does not gain speed forever', () => {
  for (const id of ['shiro', 'kitsune', 'vortex', 'hauler']) {
    // 1) coasting slide (no throttle): speed must never go up
    const v = makeCar(id); enterDrift(v, 22);
    let prev = v.speed;
    run(v, 1.5, { ...N, throttle: 0, steer: 1, handbrake: true }, (c) => { assert.ok(c.speed <= prev + 1e-6, `${id} gained speed while coasting sideways`); prev = c.speed; });
    // shallow-angle coasting slide (where the old formula created speed)
    const u = makeCar(id); enterDrift(u, 22); prev = u.speed;
    run(u, 1.2, { ...N, throttle: 0, steer: 0.2 }, (c) => { assert.ok(c.speed <= prev + 1e-6, `${id} gained speed in a shallow coasting slide`); prev = c.speed; });
    // 2) a long full-throttle drift settles at a steady speed below the car's top speed
    const w = makeCar(id); enterDrift(w);
    const sp = []; let k = 0;
    run(w, 30, { ...N, throttle: 1, steer: 0.5 }, (c) => { if (++k % 120 === 0) sp.push(c.speed); }); // once a second
    const last = sp.slice(-10);
    assert.ok(Math.max(...last) - Math.min(...last) < 1.5, `${id} drift speed still changing: ${last.map((s) => s.toFixed(1)).join(' ')}`);
    assert.ok(Math.max(...sp) < w.def.top * 0.75, `${id} drifts too fast (${Math.max(...sp).toFixed(1)} m/s)`);
  }
});

test('hitting a wall mid-drift does not spin the car', () => {
  for (const id of ['shiro', 'hatch', 'brute']) for (const tilt of [0.3, 0.5]) {
    const walls = [];
    const v = makeCar(id, 'drift', pad(walls)); enterDrift(v);
    run(v, 1.0, { ...N, throttle: 0.8, steer: 0.5 });
    assert.ok(v.drifting, `${id} should be drifting before the wall`);
    // a wall 1.6 m out on the side the car slides toward, angled `tilt` rad into its path
    const sp = v.speed, ux = v.vx / sp, uz = v.vz / sp, side = Math.sign(v.rel) || 1;
    const nx = -Math.cos(v.h) * side, nz = Math.sin(v.h) * side;
    const wx = ux * Math.cos(tilt) - nx * Math.sin(tilt), wz = uz * Math.cos(tilt) - nz * Math.sin(tilt);
    const cx = v.x + nx * 1.6, cz = v.z + nz * 1.6;
    walls.push([cx - wx * 60, cz - wz * 60, cx + wx * 60, cz + wz * 60]);
    let maxW = 0, maxRate = 0, hit = 0, spun = false;
    run(v, 2, { ...N, throttle: 0.8, steer: 0.5 }, (c) => {
      if (c.impact > 0) hit++;
      maxW = Math.max(maxW, Math.abs(c.w)); maxRate = Math.max(maxRate, Math.abs(c.velRate));
      if (c.mode === 'spin') spun = true;
    });
    assert.ok(hit > 0, `${id} never touched the wall`);
    assert.ok(!spun, `${id} went into a spin after the wall`);
    // before the fix the bounce showed up as a 15+ rad/s "turn" and the yaw rate reached 6+ rad/s
    assert.ok(maxRate < 3, `${id} travel-direction rate spiked to ${maxRate.toFixed(1)} rad/s`);
    assert.ok(maxW < 4.5, `${id} yaw rate reached ${maxW.toFixed(1)} rad/s`);
    assert.ok(finite(v));
  }
});

test('different cars handle measurably differently', () => {
  const drift = (id) => {
    const v = makeCar(id); enterDrift(v); const s0 = v.speed; let ang = 0, n = 0;
    run(v, 4, { ...N, throttle: 0.8, steer: 0.6 }, (c) => { if (c.drifting) { ang += Math.abs(c.rel); n++; } });
    return { angle: (ang / Math.max(1, n)) * 57.3, keep: v.speed / s0 };
  };
  const shiro = drift('shiro'), hatch = drift('hatch'), hauler = drift('hauler');
  // the drift car holds more angle and more speed than the basic hatch and the heavy truck
  assert.ok(shiro.angle > hatch.angle + 5, `angle shiro ${shiro.angle.toFixed(0)} vs hatch ${hatch.angle.toFixed(0)}`);
  assert.ok(shiro.keep > hatch.keep + 0.15, `speed kept shiro ${shiro.keep.toFixed(2)} vs hatch ${hatch.keep.toFixed(2)}`);
  assert.ok(shiro.keep > hauler.keep + 0.15, `speed kept shiro ${shiro.keep.toFixed(2)} vs hauler ${hauler.keep.toFixed(2)}`);
  // collisions use mass: the light car is knocked back harder than the heavy truck
  const bump = (meId, otherId) => {
    const me = makeCar(meId); me.place(0, 0, 0); me.vz = 10;
    const o = makeCar(otherId); o.place(0, 3.2, Math.PI);
    me.collideCar(o); return 10 - me.vz;
  };
  const light = bump('kitsune', 'hauler'), heavy = bump('hauler', 'kitsune');
  assert.ok(light > heavy * 1.3, `light car bounce ${light.toFixed(2)} vs heavy ${heavy.toFixed(2)}`);
  assert.ok(Math.abs(bump('shiro', 'hatch') - bump('hatch', 'shiro')) < 1, 'equal-ish cars bounce about the same');
});

test('clutch kick and feint start a drift (Drift style), feint does not in Race style', () => {
  // clutch kick: turning on full throttle, a quick lift and re-floor throws the rear out
  const v = makeCar('shiro'); upTo(v, 15);
  run(v, 0.3, { ...N, throttle: 1, steer: 0.7 });
  assert.equal(v.mode, 'grip');
  run(v, 0.12, { ...N, throttle: 0, steer: 0.7 });
  let drifted = false; run(v, 0.6, { ...N, throttle: 1, steer: 0.7 }, (c) => { if (c.drifting) drifted = true; });
  assert.ok(drifted, 'clutch kick should start a drift');
  // a slow lift (normal driving) does not
  const s = makeCar('shiro'); upTo(s, 15); run(s, 0.3, { ...N, throttle: 1, steer: 0.7 }); run(s, 0.8, { ...N, throttle: 0, steer: 0.7 });
  drifted = false; run(s, 0.4, { ...N, throttle: 1, steer: 0.4 }, (c) => { if (c.drifting) drifted = true; });
  assert.ok(!drifted, 'a slow lift should not count as a clutch kick');
  // feint: steer right, then flick hard left
  const feint = (style) => {
    const f = makeCar('kitsune', style); upTo(f, 19);
    run(f, 0.45, { ...N, throttle: 0.6, steer: -0.8 });
    let d = false; run(f, 0.6, { ...N, throttle: 0.8, steer: 1 }, (c) => { if (c.drifting) d = true; }); return d;
  };
  assert.ok(feint('drift'), 'feint should start a drift in Drift style');
  assert.ok(!feint('race'), 'a quick lane change must not start a drift in Race style');
});

test('same results at 60 / 120 / 144 fps render rates (fixed physics step + interpolation)', () => {
  // the game loop: accumulate frame time, step physics at 120 Hz, read input once per frame
  const script = (t) => (t < 2 ? { ...N, throttle: 1 } : t < 2.3 ? { ...N, throttle: 0.6, steer: 1, handbrake: true } : t < 6 ? { ...N, throttle: 0.85, steer: 0.5 } : { ...N, throttle: 0.4, steer: -0.2 });
  const sim = (fps) => {
    const v = makeCar('shiro'); let acc = 0; const frames = fps * 8; const jumps = [];
    let last = v.renderState(1);
    for (let f = 0; f < frames; f++) {
      const t = f / fps; acc += 1 / fps;
      const inp = script(t);
      while (acc >= PHYS_DT - 1e-9) { v.step(PHYS_DT, inp); acc -= PHYS_DT; }
      const r = v.renderState(acc / PHYS_DT);
      jumps.push(Math.hypot(r.x - last.x, r.z - last.z) * fps); last = r; // rendered speed this frame
    }
    return { v, jumps };
  };
  const a = sim(60), b = sim(120), c = sim(144);
  for (const [name, o] of [['60', a], ['144', c]]) {
    const d = Math.hypot(o.v.x - b.v.x, o.v.z - b.v.z);
    assert.ok(d < 0.5, `${name} fps ended ${d.toFixed(2)} m away from 120 fps`);
    assert.equal(o.v.mode, b.v.mode);
  }
  // interpolated motion at 144 Hz is smooth: rendered speed never jumps by more than 15% between frames (cruise part)
  const cruise = c.jumps.slice(144 * 0.5, 144 * 1.9);
  for (let i = 1; i < cruise.length; i++) assert.ok(Math.abs(cruise[i] - cruise[i - 1]) < cruise[i - 1] * 0.15 + 0.05, `render stutter at frame ${i}`);
});

test('old saved tunes still load and give the stock car when empty', () => {
  const def = carById('shiro');
  const old = { engine: 2, tires: 'drift', susp: 1 }; // a save from before newer sliders existed
  const t = sanitizeTune(old, def);
  assert.equal(t.engine, 2); assert.equal(t.tires, 'drift'); assert.equal(t.balance, 0);
  const tuned = applyTune(def, old); const v = new Vehicle(tuned, pad(), carDims(def), {}); v.place(0, 0, 0);
  run(v, 5, { ...N, throttle: 1 }); assert.ok(finite(v) && v.speed > 10);
  for (const [k, p] of Object.entries(builtinPresets(def))) { const d = applyTune(def, p); assert.ok(Number.isFinite(d.accel) && Number.isFinite(d.mass), k); }
  assert.equal(applyTune(def, null).accel, def.accel);
});

// ---- drift exit / 360 feel (player complaint: "won't let me go straight", "360 sends me sliding everywhere") ----
import { exitTest, spinTest, bigDrift } from './feel-probe.mjs';
const FEEL_CARS = CARS.map((c) => c.id);

test('letting go of steering (still on the gas) straightens out within ~1.2 s, without flipping to the other side', () => {
  for (const id of FEEL_CARS) {
    const r = exitTest(id, 'neutral');
    assert.ok(+r.exitS < 1.2, `${id} took ${r.exitS}s to straighten`);
    assert.ok(+r.otherSideDeg < 9, `${id} swung ${r.otherSideDeg}° the other way`);
    assert.equal(r.redrift, false, `${id} started drifting again on its own`);
  }
});

test('counter-steering ends the drift quickly and does not throw the car into the opposite drift', () => {
  for (const id of FEEL_CARS) for (const k of ['counter', 'tap', 'lift']) {
    const r = exitTest(id, k);
    assert.ok(+r.exitS < (k === 'lift' ? 1.3 : 1.1), `${id} ${k}: ${r.exitS}s`);
    assert.ok(+r.otherSideDeg < 9, `${id} ${k}: flipped ${r.otherSideDeg}°`);
  }
  for (const id of ['sedan', 'aurora']) assert.ok(+exitTest(id, 'neutral', 'race').exitS < 1.2);
});

test('steering into the drift keeps it going (full lock, keyboard taps and half-stick)', () => {
  for (const id of ['shiro', 'brute', 'kitsune']) for (const pat of ['full', 'taps', 'half']) {
    const v = makeCar(id); bigDrift(v); let dr = 0, n = 0;
    run(v, 5, (c, t) => ({ ...N, throttle: 0.9, steer: pat === 'full' ? 1 : pat === 'half' ? 0.5 : (t % 0.8) < 0.15 ? 0 : 1 }), (c) => { n++; if (c.mode === 'drift') dr++; });
    assert.ok(dr / n > 0.95, `${id} ${pat}: only drifting ${(100 * dr / n).toFixed(0)}% of the time`);
  }
});

test('a handbrake 360 settles quickly instead of sliding away', () => {
  for (const id of FEEL_CARS) for (const after of ['release', 'gas']) {
    const r = spinTest(id, after);
    assert.ok(+r.settleS < 2.6, `${id} ${after}: settled in ${r.settleS}s`);
    assert.ok(+r.travelM < 10, `${id} ${after}: slid ${r.travelM} m`);
  }
});

test('handbrake + opposite lock still swings the car into a drift the other way (both styles)', () => {
  for (const style of ['race', 'drift']) for (const id of FEEL_CARS) {
    const v = makeCar(id, style); enterDrift(v, 22); run(v, 1, { ...N, throttle: 0.8, steer: 0.7 });
    const d0 = Math.sign(v.rel);
    run(v, 0.25, { ...N, throttle: 0.8, steer: -d0, handbrake: true });
    let swung = false; run(v, 1.5, { ...N, throttle: 0.9, steer: -d0 }, (c) => { if (c.mode === 'drift' && Math.sign(c.rel) === -d0 && Math.abs(c.rel) > 0.3) swung = true; });
    assert.ok(swung, `${id} ${style}: handbrake transition did not swing into the other drift`);
  }
});

test('a light touch of steer into the drift keeps it going (gamepad)', () => {
  for (const id of ['shiro', 'brute']) {
    const v = makeCar(id); bigDrift(v); let dr = 0, n = 0;
    run(v, 3, { ...N, throttle: 0.9, steer: 0.08 }, (c) => { n++; if (c.mode === 'drift') dr++; });
    assert.ok(dr / n > 0.9, `${id}: ${(100 * dr / n).toFixed(0)}%`);
  }
});

// ---- player report #2: "if I want to go straight it goes straight then switches to the other side", "360 slides everywhere"
import { spin } from './spin-probe.mjs';
test('straightening out with FULL gas and counter-steer held does not kick into a new drift', () => {
  for (const style of ['drift', 'race']) for (const c of CARS) for (const hold of [0.4, 2.5]) {
    const v = makeCar(c.id, style); bigDrift(v); if (v.mode !== 'drift') continue;
    const d0 = Math.sign(v.rel); let seenGrip = false, again = false;
    run(v, 3, (car, t) => ({ ...N, throttle: 1, steer: t < hold ? -d0 : 0 }), (car) => { if (car.mode === 'grip') seenGrip = true; else if (seenGrip) again = true; });
    assert.equal(again, false, `${c.id} ${style} hold ${hold}: drifted again after straightening`);
  }
});
test('a 360 keeps travelling straight and grips again right after letting go (40/70/100 km/h)', () => {
  for (const id of ['hatch', 'shiro', 'brute', 'hauler']) for (const kmh of [40, 70, 100]) {
    const r = spin(id, kmh, 'release');
    assert.ok(+r.settle < 0.3, `${id} ${kmh}: took ${r.settle}s to grip after the 360`);
  }
});
test('steering again after straightening out still lets you start a new drift', () => {
  const v = makeCar('shiro'); bigDrift(v); const d0 = Math.sign(v.rel);
  run(v, 1.2, { ...N, throttle: 1, steer: -d0 }); run(v, 0.4, { ...N, throttle: 1 });
  let drifted = false; run(v, 2, { ...N, throttle: 1, steer: d0 }, (c) => { if (c.mode === 'drift') drifted = true; });
  assert.ok(drifted, 'power-over after centring the wheel should still start a drift');
});
