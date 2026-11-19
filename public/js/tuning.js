// Vehicle tuning: performance parts + adjustable setup. Shared by the browser and the server.
//
// A tune never replaces a car - it scales the car's own numbers (see applyTune), so every car keeps
// its character: a tuned Hauler is still a heavy truck, a tuned Kitsune is still a nimble drift car.
// Everything here changes real physics values; the garage's stat bars are measured by driving the
// resulting car in the physics engine (carstats.js), never estimated.

// ---------------------------------------------------------------- parts (levels)
export const PARTS = {
  engine: {
    name: 'Engine', levels: ['Stock', 'Street', 'Sport', 'Race'],
    desc: 'More power: quicker acceleration, higher top speed and sharper throttle response. More power than the tyres can put down means wheelspin and power oversteer.',
  },
  gearbox: {
    name: 'Gearbox', levels: ['Stock', 'Quick-shift', 'Sequential'],
    desc: 'Faster gear changes lose less drive between gears. The sequential box shifts so hard it briefly unsettles the rear tyres on every upshift.',
  },
  tires: {
    name: 'Tyres', levels: ['Street', 'Sport', 'Racing', 'Drift', 'Off-road'], keys: ['street', 'sport', 'race', 'drift', 'offroad'],
    desc: 'Racing: most grip on tarmac, poor on dirt and grass, hard to drift. Drift: low, progressive grip that holds long slides. Off-road: loses little grip off the tarmac.',
  },
  susp: {
    name: 'Suspension', levels: ['Stock', 'Street', 'Sport', 'Race'],
    desc: 'Stiffer springs and dampers: less body roll and more cornering grip on smooth tarmac, but the car skips over rough ground and bumps.',
  },
  brakes: {
    name: 'Brakes', levels: ['Stock', 'Street', 'Sport', 'Race'],
    desc: 'Stronger brakes stop the car sooner. Race brakes bite hard enough to unsettle the car if you brake mid-corner.',
  },
  weight: {
    name: 'Weight reduction', levels: ['Stock', 'Light', 'Lighter', 'Stripped'],
    desc: 'Less weight: better acceleration and quicker direction changes, but drifts lose speed sooner, the car is twitchier at speed and loses out in collisions.',
  },
};
// tyre compounds: grip = lateral grip, lat = max cornering force, slide = grip while sliding (lower = easier,
// longer drifts), mom = speed kept while sliding, off = how badly loose surfaces hurt (lower = better off-road)
export const TIRES = {
  street: { grip: 1, lat: 1, slide: 1, mom: 1, off: 1 },
  sport: { grip: 1.07, lat: 1.06, slide: 1.08, mom: 1, off: 1.12 },
  race: { grip: 1.16, lat: 1.13, slide: 1.22, mom: 0.94, off: 1.5 },
  drift: { grip: 0.9, lat: 0.94, slide: 0.74, mom: 1.12, off: 1.08 },
  offroad: { grip: 0.95, lat: 0.95, slide: 0.95, mom: 1, off: 0.45 },
};

// ---------------------------------------------------------------- setup sliders (-3 .. +3, 0 = factory)
export const SLIDERS = {
  finalDrive: { name: 'Final drive', lo: 'Short (acceleration)', hi: 'Long (top speed)', group: 'Transmission' },
  rideHeight: { name: 'Ride height', lo: 'Lower', hi: 'Higher', min: -3, max: 2, group: 'Suspension' },
  springs: { name: 'Spring stiffness', lo: 'Soft', hi: 'Stiff', group: 'Suspension' },
  dampers: { name: 'Weight transfer', lo: 'Slow / soft', hi: 'Fast / firm', group: 'Suspension' },
  balance: { name: 'Handling balance', lo: 'Understeer (stable)', hi: 'Oversteer (agile)', group: 'Suspension' },
  steerLock: { name: 'Steering angle', lo: 'Less lock', hi: 'More lock', group: 'Steering' },
  steerSpeed: { name: 'Steering response', lo: 'Slower', hi: 'Quicker', group: 'Steering' },
  steerStab: { name: 'Steering stability', lo: 'Twitchy', hi: 'Stable', group: 'Steering' },
  brakeBias: { name: 'Brake balance', lo: 'Front', hi: 'Rear', group: 'Brakes' },
  handbrake: { name: 'Handbrake', lo: 'Gentle', hi: 'Aggressive', group: 'Brakes' },
  tireGrip: { name: 'Tyre grip', lo: 'Slippery', hi: 'Grippy', group: 'Drift & grip' },
  frontGrip: { name: 'Front grip', lo: 'Less', hi: 'More', group: 'Drift & grip' },
  rearGrip: { name: 'Rear grip', lo: 'Loose', hi: 'Planted', group: 'Drift & grip' },
  driftEntry: { name: 'Drift initiation', lo: 'Hard to start', hi: 'Easy to start', group: 'Drift & grip' },
  driftStab: { name: 'Drift stability', lo: 'Lively', hi: 'Steady', group: 'Drift & grip' },
};
const RANGE = (k) => [SLIDERS[k].min ?? -3, SLIDERS[k].max ?? 3];

export const STOCK_TUNE = Object.freeze({
  engine: 0, gearbox: 0, tires: 'street', susp: 0, brakes: 0, weight: 0,
  ...Object.fromEntries(Object.keys(SLIDERS).map((k) => [k, 0])),
});

// what fits which car (pickups/SUVs get off-road tyres; only light road cars get fully stripped interiors)
export function allowedTires(def) {
  return ['pickup', 'suv', 'basic'].includes(def.cat) ? ['street', 'sport', 'race', 'drift', 'offroad'] : ['street', 'sport', 'race', 'drift'];
}
export function maxLevel(def, part) {
  if (part === 'weight' && ['pickup', 'suv'].includes(def.cat)) return 2;
  return PARTS[part].levels.length - 1;
}

// clamp any incoming tune (from storage, UI or the network) to legal values for this car
export function sanitizeTune(t, def) {
  const out = { ...STOCK_TUNE };
  if (!t || typeof t !== 'object') return out;
  const int = (v, lo, hi) => { v = Math.round(Number(v)); return Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : 0; };
  for (const p of ['engine', 'gearbox', 'susp', 'brakes', 'weight']) out[p] = int(t[p], 0, def ? maxLevel(def, p) : PARTS[p].levels.length - 1);
  const tires = def ? allowedTires(def) : Object.keys(TIRES);
  out.tires = tires.includes(t.tires) ? t.tires : 'street';
  for (const k of Object.keys(SLIDERS)) { const [lo, hi] = RANGE(k); out[k] = int(t[k], lo, hi); }
  return out;
}
export const isStock = (t) => !t || Object.keys(STOCK_TUNE).every((k) => (t[k] ?? STOCK_TUNE[k]) === STOCK_TUNE[k]);

// ---------------------------------------------------------------- the physics
// Returns a new car definition with tuned values. Stock tune returns numbers identical to the
// original car. Fields the physics reads (with stock defaults, see physics.js):
//   accel, top, grip, lat, steer, driftGrip, driftSteer, momentum, powerOver, mass (as before)
//   tune: { brake, brakeBias, hbForce, hbGrip, hbEntry, rearGrip, frontGrip, surfSens, launch,
//           shiftGain, shiftKick, tractionAccel, susK, susD, cgH, bump, steerRate, yawResp,
//           stab, steerSlack, entry, angleGain, exitHold }
export function applyTune(def, tune, rules = 'open') {
  if (rules === 'stock' || !tune) tune = STOCK_TUNE;
  const T = sanitizeTune(tune, def);
  let d = { ...def };
  if (rules === 'equal') return equalize(d);
  const ty = TIRES[T.tires];
  const P = [1, 1.08, 1.17, 1.28][T.engine];
  const M = [1, 0.95, 0.9, 0.85][T.weight];
  const fd = T.finalDrive, s = (k, per) => 1 + T[k] * per;
  // engine + weight + final drive
  const stockAccel = def.accel;
  d.accel = def.accel * P * Math.pow(1 / M, 0.6) * (1 - 0.035 * fd);
  d.top = def.top * Math.pow(P, 0.38) * (1 + 0.025 * fd);
  d.powerOver = def.powerOver + [0, 0.06, 0.13, 0.22][T.engine] + 0.04 * T.driftEntry;
  d.mass = def.mass * M;
  d.momentum = def.momentum * ty.mom * [1, 0.97, 0.94, 0.9][T.weight];
  // grip: compound, suspension, ride height (centre of gravity), overall/front/rear trims, balance
  const suspLat = [1, 1.02, 1.04, 1.06][T.susp] * (1 - 0.012 * T.rideHeight) * (1 + 0.006 * T.springs);
  const all = s('tireGrip', 0.04);
  d.grip = def.grip * ty.grip * all;
  d.lat = def.lat * ty.lat * suspLat * all;
  d.driftGrip = def.driftGrip * ty.slide * (1 + 0.03 * T.tireGrip) * (1 + 0.03 * T.driftStab);
  d.steer = def.steer * s('steerLock', 0.06);
  d.driftSteer = def.driftSteer * s('driftStab', 0.04);
  const bal = T.balance; // + = stiffer rear = oversteer
  d.tune = {
    brake: [15, 16.5, 18.5, 21][T.brakes], brakeBias: T.brakeBias / 3, brakeKick: [0, 0, 0.03, 0.08][T.brakes],
    hbForce: 3.2 * s('handbrake', 0.15), hbGrip: 0.55 * (1 - 0.08 * T.handbrake), hbEntry: 1 - 0.08 * T.handbrake,
    frontGrip: s('frontGrip', 0.05) * (1 + 0.03 * bal),
    rearGrip: s('rearGrip', 0.05) * (1 - 0.03 * bal),
    surfSens: ty.off * (1 + [0, 0.05, 0.1, 0.16][T.susp]) * (1 + 0.04 * Math.max(0, -T.rideHeight)),
    launch: [1, 1.04, 1.08, 1.12][T.engine],
    tractionAccel: T.engine > 0 || fd < 0 || T.weight > 0 ? stockAccel : 0, // extra drive is limited by tyre grip
    shiftGain: [0, 0.03, 0.06][T.gearbox], shiftKick: T.gearbox === 2 ? 0.18 : 0,
    susK: [1, 1.15, 1.35, 1.6][T.susp] * s('springs', 0.07),
    susD: [1, 1.1, 1.25, 1.4][T.susp] * s('dampers', 0.12),
    cgH: [0.42, 0.4, 0.38, 0.36][T.susp] + 0.012 * T.rideHeight,
    bump: 0.2 + 0.025 * T.rideHeight, ride: 0.02 * T.rideHeight,
    steerRate: s('steerSpeed', 0.1), yawResp: s('steerSpeed', 0.05) * (1 + 0.04 * T.weight) * (1 + 0.03 * T.dampers),
    stab: Math.max(0.25, s('steerStab', 0.25) * (1 - 0.06 * T.weight)),
    steerSlack: Math.max(0.6, (1 - 0.06 * T.steerStab) * (1 + 0.03 * T.weight)),
    entry: Math.max(0.5, 1 - 0.1 * T.driftEntry), angleGain: s('driftStab', 0.1), exitHold: s('driftStab', 0.15),
  };
  return d;
}

// "Equalized performance" rooms: every car gets the same power, top speed, grip and weight; each car
// keeps its own steering geometry and drift character. Player tunes are not used.
export const EQUAL_BASE = { accel: 8.4, top: 64, grip: 10.5, lat: 11.5, mass: 1.15 };
function equalize(d) { return { ...d, ...EQUAL_BASE, tune: undefined }; }

export const RULES = {
  open: { name: 'Open modifications', short: 'Open mods', desc: 'Everyone drives their own tuned car.' },
  equal: { name: 'Equalized performance', short: 'Equalized', desc: 'All cars get the same power, top speed, grip and weight. Each keeps its own steering and drift character. Performance mods are not used; looks are kept.' },
  stock: { name: 'Stock only', short: 'Stock only', desc: 'Every car runs its factory setup. Performance mods are not used; looks are kept.' },
};

// ---------------------------------------------------------------- built-in presets
// Each preset is a full set of compatible modifications for the given car.
export const PRESET_INFO = {
  stock: 'Original factory setup.',
  street: 'Balanced everyday performance: a little more of everything.',
  sport: 'Quicker acceleration, sharper handling and stronger brakes.',
  racing: 'Built for circuit racing: race tyres, stiff suspension, quick-shift and stability.',
  drift: 'Built for controlled drifting: drift tyres, extra lock, loose rear and easy entry.',
  grip: 'Maximum tyre traction: grippy and planted, hard to unstick.',
  speed: 'Top-speed build: big power, long gearing and a stable chassis.',
};
export function builtinPresets(def) {
  const off = ['pickup', 'suv'].includes(def.cat);
  const P = (o) => sanitizeTune({ ...STOCK_TUNE, ...o }, def);
  return {
    stock: P({}),
    street: P({ engine: 1, tires: 'sport', susp: 1, brakes: 1, rideHeight: off ? 0 : -1 }),
    sport: P({ engine: 2, gearbox: 1, finalDrive: -1, tires: 'sport', susp: 2, brakes: 2, weight: 1, steerSpeed: 1, rideHeight: off ? 0 : -1 }),
    racing: P({ engine: 2, gearbox: 2, tires: 'race', susp: 3, brakes: 3, weight: 2, balance: -1, steerStab: 1, frontGrip: 1, rideHeight: off ? -1 : -2, driftEntry: -1 }),
    drift: P({ engine: 2, gearbox: 1, finalDrive: -2, tires: 'drift', susp: 2, steerLock: 3, rearGrip: -2, frontGrip: 2, driftEntry: 2, driftStab: 2, handbrake: 2, brakeBias: 1, balance: 2, rideHeight: off ? -1 : -2 }),
    grip: P({ engine: 1, tires: 'race', susp: 3, brakes: 2, tireGrip: 2, frontGrip: 2, rearGrip: 2, balance: -1, steerStab: 2, driftEntry: -2, rideHeight: off ? -1 : -2 }),
    speed: P({ engine: 3, gearbox: 2, finalDrive: 3, tires: 'sport', susp: 1, brakes: 2, weight: 2, steerStab: 2, rideHeight: off ? 0 : -1 }),
  };
}
export const PRESET_NAMES = { stock: 'Stock', street: 'Street', sport: 'Sport', racing: 'Racing', drift: 'Drift', grip: 'Grip', speed: 'Speed' };

// short tag shown next to a player's name in lobbies
export function tuneSummary(t) {
  if (isStock(t)) return 'Stock';
  const bits = [];
  if (t.engine) bits.push(`Engine ${PARTS.engine.levels[t.engine]}`);
  if (t.tires !== 'street') bits.push(`${PARTS.tires.levels[PARTS.tires.keys.indexOf(t.tires)]} tyres`);
  if (t.susp) bits.push(`${PARTS.susp.levels[t.susp]} suspension`);
  return bits.length ? bits.join(' · ') : 'Tuned setup';
}
