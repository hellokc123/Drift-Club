// Vehicle catalogue + procedural low-poly car models.
// To add a car: append an entry to CARS (pick a body style, tune the numbers).
import { Geo } from './engine/geometry.js';
import { hexToRgb, mat4 } from './engine/math.js';

export const CATEGORIES = [
  { id: 'basic', name: 'Basic' }, { id: 'sports', name: 'Sports' }, { id: 'super', name: 'Supercars' },
  { id: 'drift', name: 'Drift' }, { id: 'muscle', name: 'Muscle' }, { id: 'pickup', name: 'Pickups' }, { id: 'suv', name: 'SUVs' },
  // hidden until unlocked with the secret code (see secret.js); its cars are still valid ids online
  { id: 'creator', name: 'Creator', secret: 'creator' },
  { id: 'squad', name: 'Squad', secret: 'squad' },
  // per-car unlocks: a player only sees these tabs (and only the cars in them) once they've earned one
  { id: 'secret', name: 'Secret', perCar: true },
  { id: 'boss', name: 'Boss', perCar: true },
];

// accel m/s², top m/s, grip = lateral grip rate, lat = max cornering accel (m/s²), steer = max wheel angle (rad),
// wb = wheelbase, driftGrip (lower = slides more), driftPower (throttle rotation), driftSteer (yaw authority while sliding),
// momentum (speed kept while sliding), powerOver (throttle-induced oversteer), mass (collisions), engine sound params
export const CARS = [
  { id: 'hatch', name: 'Kova Hatch', cat: 'basic', style: 'hatch', paint: '#b3262e', accel: 6.4, top: 47, grip: 9, lat: 10, steer: 0.62, wb: 2.45, driftGrip: 2.0, driftPower: 0.95, driftSteer: 2.1, momentum: 0.42, powerOver: 0.1, mass: 1.0, engine: { pitch: 1.15, cyl: 4, grit: 0.3 } },
  { id: 'sedan', name: 'Civa Sedan', cat: 'basic', style: 'sedan', paint: '#34506e', accel: 6.1, top: 50, grip: 9, lat: 10, steer: 0.58, wb: 2.7, driftGrip: 1.9, driftPower: 1.0, driftSteer: 1.95, momentum: 0.44, powerOver: 0.15, mass: 1.1, engine: { pitch: 1.0, cyl: 4, grit: 0.25 } },
  { id: 'zephyr', name: 'Zephyr GT', cat: 'sports', style: 'coupe', paint: '#d4a32a', accel: 8.4, top: 64, grip: 11, lat: 12, steer: 0.57, wb: 2.6, driftGrip: 1.6, driftPower: 1.2, driftSteer: 2.15, momentum: 0.5, powerOver: 0.3, mass: 1.05, engine: { pitch: 1.2, cyl: 6, grit: 0.35 } },
  { id: 'kaze', name: 'Kaze RS', cat: 'sports', style: 'hatch', paint: '#3d6f6b', accel: 8.9, top: 62, grip: 12, lat: 12.5, steer: 0.58, wb: 2.55, driftGrip: 1.85, driftPower: 1.05, driftSteer: 2.05, momentum: 0.46, powerOver: 0.15, mass: 1.05, engine: { pitch: 1.35, cyl: 4, grit: 0.5 } },
  { id: 'vortex', name: 'Vortex V12', cat: 'super', style: 'wedge', paint: '#c2531d', accel: 10.6, top: 82, grip: 12, lat: 13.5, steer: 0.52, wb: 2.7, driftGrip: 1.7, driftPower: 1.3, driftSteer: 2.05, momentum: 0.52, powerOver: 0.3, mass: 1.15, engine: { pitch: 1.5, cyl: 12, grit: 0.4 } },
  { id: 'aurora', name: 'Aurora Hyper', cat: 'super', style: 'wedge', paint: '#c9ccd1', accel: 11.3, top: 86, grip: 13, lat: 14, steer: 0.52, wb: 2.75, driftGrip: 1.8, driftPower: 1.2, driftSteer: 1.95, momentum: 0.52, powerOver: 0.25, mass: 1.1, engine: { pitch: 1.7, cyl: 8, grit: 0.3 } },
  { id: 'shiro', name: 'Shiro D1', cat: 'drift', style: 'coupe', paint: '#eeeeea', accel: 8.7, top: 62, grip: 10, lat: 11, steer: 0.68, wb: 2.55, driftGrip: 1.2, driftPower: 1.5, driftSteer: 2.5, momentum: 0.6, powerOver: 0.6, mass: 1.0, engine: { pitch: 1.25, cyl: 4, grit: 0.7 } },
  { id: 'kitsune', name: 'Kitsune 86', cat: 'drift', style: 'coupe', paint: '#2f3f6b', accel: 7.9, top: 58, grip: 10, lat: 11, steer: 0.68, wb: 2.45, driftGrip: 1.15, driftPower: 1.45, driftSteer: 2.5, momentum: 0.62, powerOver: 0.65, mass: 0.95, engine: { pitch: 1.4, cyl: 4, grit: 0.55 } },
  { id: 'thunder', name: 'Thunder 69', cat: 'muscle', style: 'muscle', paint: '#1d3557', accel: 9.5, top: 66, grip: 8.5, lat: 10, steer: 0.55, wb: 2.85, driftGrip: 1.4, driftPower: 1.5, driftSteer: 1.95, momentum: 0.52, powerOver: 0.55, mass: 1.25, engine: { pitch: 0.7, cyl: 8, grit: 0.85 } },
  { id: 'brute', name: 'Brute SS', cat: 'muscle', style: 'muscle', paint: '#7c1d22', accel: 10.1, top: 70, grip: 9, lat: 10.5, steer: 0.55, wb: 2.9, driftGrip: 1.45, driftPower: 1.45, driftSteer: 1.95, momentum: 0.5, powerOver: 0.5, mass: 1.3, engine: { pitch: 0.75, cyl: 8, grit: 0.9 } },
  { id: 'ranger', name: 'Ranger TX', cat: 'pickup', style: 'pickup', paint: '#5b6647', accel: 6.5, top: 50, grip: 8, lat: 9, steer: 0.58, wb: 3.2, driftGrip: 1.8, driftPower: 1.1, driftSteer: 1.8, momentum: 0.42, powerOver: 0.35, mass: 1.5, engine: { pitch: 0.8, cyl: 6, grit: 0.6 } },
  { id: 'hauler', name: 'Hauler HD', cat: 'pickup', style: 'pickup', paint: '#3d405b', accel: 6.1, top: 48, grip: 7.5, lat: 8.5, steer: 0.55, wb: 3.4, driftGrip: 1.9, driftPower: 1.0, driftSteer: 1.7, momentum: 0.4, powerOver: 0.3, mass: 1.7, engine: { pitch: 0.65, cyl: 8, grit: 0.8 }, scale: 1.06 },
  { id: 'trail', name: 'Trailblazer', cat: 'suv', style: 'suv', paint: '#a0622b', accel: 6.7, top: 52, grip: 8.5, lat: 9.5, steer: 0.58, wb: 2.8, driftGrip: 1.9, driftPower: 1.0, driftSteer: 1.8, momentum: 0.42, powerOver: 0.2, mass: 1.45, engine: { pitch: 0.9, cyl: 6, grit: 0.45 } },
  { id: 'atlas', name: 'Atlas X', cat: 'suv', style: 'suv', paint: '#26292c', accel: 7.7, top: 58, grip: 9, lat: 10, steer: 0.57, wb: 2.9, driftGrip: 1.8, driftPower: 1.1, driftSteer: 1.9, momentum: 0.44, powerOver: 0.25, mass: 1.5, engine: { pitch: 1.0, cyl: 8, grit: 0.4 } },
  // --- second wave: one lighter / twitchier and one heavier / steadier car per category
  { id: 'pipa', name: 'Pipa Dot', cat: 'basic', style: 'hatch', paint: '#6f8a6b', livery: 1, liveryColor: '#eeeeea', accel: 6.3, top: 46, grip: 9.5, lat: 10.2, steer: 0.66, wb: 2.3, driftGrip: 2.05, driftPower: 0.9, driftSteer: 2.2, momentum: 0.4, powerOver: 0.08, mass: 0.88, engine: { pitch: 1.35, cyl: 3, grit: 0.35 } },
  { id: 'brenna', name: 'Brenna Estate', cat: 'basic', style: 'wagon', paint: '#7a5c45', accel: 5.9, top: 51, grip: 9, lat: 9.8, steer: 0.56, wb: 2.8, driftGrip: 1.85, driftPower: 1.0, driftSteer: 1.9, momentum: 0.46, powerOver: 0.18, mass: 1.2, engine: { pitch: 0.95, cyl: 4, grit: 0.2 } },
  { id: 'selene', name: 'Selene Spyder', cat: 'sports', style: 'roadster', paint: '#2f4f3e', accel: 8.6, top: 60, grip: 12, lat: 12.8, steer: 0.62, wb: 2.35, driftGrip: 1.7, driftPower: 1.15, driftSteer: 2.25, momentum: 0.48, powerOver: 0.25, mass: 0.9, engine: { pitch: 1.45, cyl: 4, grit: 0.4 } },
  { id: 'ostra', name: 'Ostra Velo', cat: 'sports', style: 'sedan', paint: '#4b5d73', accel: 8.0, top: 66, grip: 11.5, lat: 12, steer: 0.55, wb: 2.8, driftGrip: 1.75, driftPower: 1.1, driftSteer: 1.95, momentum: 0.5, powerOver: 0.2, mass: 1.2, engine: { pitch: 1.1, cyl: 6, grit: 0.3 } },
  { id: 'strale', name: 'Strale R', cat: 'super', style: 'wedge', paint: '#9e2a2b', accel: 11.0, top: 80, grip: 13, lat: 14.2, steer: 0.55, wb: 2.6, driftGrip: 1.65, driftPower: 1.3, driftSteer: 2.15, momentum: 0.5, powerOver: 0.32, mass: 1.0, engine: { pitch: 1.8, cyl: 6, grit: 0.5 } },
  { id: 'halcyon', name: 'Halcyon GTS', cat: 'super', style: 'coupe', paint: '#2b3a55', accel: 10.3, top: 85, grip: 12.5, lat: 13.2, steer: 0.5, wb: 2.85, driftGrip: 1.85, driftPower: 1.15, driftSteer: 1.9, momentum: 0.54, powerOver: 0.2, mass: 1.3, engine: { pitch: 1.3, cyl: 12, grit: 0.3 } },
  { id: 'tenko', name: 'Tenko S', cat: 'drift', style: 'coupe', paint: '#a33b20', accel: 7.6, top: 56, grip: 10, lat: 11, steer: 0.72, wb: 2.35, driftGrip: 1.1, driftPower: 1.4, driftSteer: 2.65, momentum: 0.6, powerOver: 0.7, mass: 0.88, engine: { pitch: 1.5, cyl: 4, grit: 0.5 } },
  { id: 'ronin', name: 'Ronin V8', cat: 'drift', style: 'sedan', paint: '#3e4447', accel: 9.2, top: 64, grip: 10, lat: 11, steer: 0.66, wb: 2.75, driftGrip: 1.25, driftPower: 1.55, driftSteer: 2.35, momentum: 0.6, powerOver: 0.55, mass: 1.15, engine: { pitch: 0.85, cyl: 8, grit: 0.75 } },
  { id: 'jackal', name: 'Jackal 350', cat: 'muscle', style: 'muscle', paint: '#b5651d', accel: 9.3, top: 64, grip: 9, lat: 10.5, steer: 0.58, wb: 2.7, driftGrip: 1.35, driftPower: 1.45, driftSteer: 2.1, momentum: 0.52, powerOver: 0.6, mass: 1.15, engine: { pitch: 0.85, cyl: 8, grit: 0.75 } },
  { id: 'behemoth', name: 'Behemoth SS', cat: 'muscle', style: 'muscle', paint: '#5c6b73', accel: 10.4, top: 72, grip: 9, lat: 10.2, steer: 0.52, wb: 3.0, driftGrip: 1.5, driftPower: 1.4, driftSteer: 1.85, momentum: 0.54, powerOver: 0.45, mass: 1.42, engine: { pitch: 0.6, cyl: 8, grit: 0.95 } },
  { id: 'wren', name: 'Wren Ute', cat: 'pickup', style: 'pickup', paint: '#c2b28a', accel: 6.9, top: 51, grip: 8.5, lat: 9.5, steer: 0.62, wb: 2.95, driftGrip: 1.75, driftPower: 1.15, driftSteer: 1.95, momentum: 0.44, powerOver: 0.4, mass: 1.3, engine: { pitch: 1.0, cyl: 4, grit: 0.45 } },
  { id: 'mammoth', name: 'Mammoth HD', cat: 'pickup', style: 'pickup', paint: '#a8a39a', accel: 6.4, top: 52, grip: 7.8, lat: 8.6, steer: 0.52, wb: 3.5, driftGrip: 1.95, driftPower: 0.95, driftSteer: 1.6, momentum: 0.42, powerOver: 0.25, mass: 1.85, engine: { pitch: 0.55, cyl: 8, grit: 0.95 }, scale: 1.03 },
  { id: 'fennec', name: 'Fennec XC', cat: 'suv', style: 'suv', paint: '#6c7a89', accel: 7.0, top: 54, grip: 9, lat: 10, steer: 0.6, wb: 2.6, driftGrip: 1.85, driftPower: 1.05, driftSteer: 1.95, momentum: 0.43, powerOver: 0.2, mass: 1.3, engine: { pitch: 1.1, cyl: 4, grit: 0.35 } },
  { id: 'castellan', name: 'Castellan Grand', cat: 'suv', style: 'suv', paint: '#2b3530', accel: 7.2, top: 57, grip: 8.8, lat: 9.6, steer: 0.54, wb: 3.05, driftGrip: 1.9, driftPower: 1.0, driftSteer: 1.75, momentum: 0.45, powerOver: 0.2, mass: 1.7, engine: { pitch: 0.8, cyl: 8, grit: 0.3 } },
  // --- secret: the creator's car. Hidden in the garage until unlocked; satin black with gold accents.
  { id: 'creator', name: 'Nocturne Aurum D', cat: 'creator', style: 'wedge', paint: '#1d1d1f', wheel: '#b8975a', livery: 2, liveryColor: '#c9a24a', satin: true, accel: 20.3, top: 152.2, grip: 23.1, lat: 24.5, steer: 0.68, wb: 2.55, driftGrip: 1.05, driftPower: 1.65, driftSteer: 2.75, momentum: 0.66, powerOver: 0.6, mass: 1.0, engine: { pitch: 1.45, cyl: 10, grit: 0.55 } },
  // creator race car: fastest car in the game for racing (stays above every boss), with stability control (can't spin out). The Aurum D is the drift king: 75% boosted drift car.
  { id: 'creatorR', name: 'Nocturne Aurum R', cat: 'creator', style: 'wedge', paint: '#151618', wheel: '#c8ccd2', livery: 2, liveryColor: '#d9dbe0', satin: true, accel: 19, top: 140, grip: 22, lat: 23.5, steer: 0.64, wb: 2.7, driftGrip: 1.95, driftPower: 1.15, driftSteer: 2.0, momentum: 0.5, powerOver: 0.15, mass: 1.05, noSpin: true, engine: { pitch: 1.6, cyl: 12, grit: 0.4 } },
  // --- secret: the Squad car (its own code). Very fast, huge grip, sharp steering, stability control - but
  // a step below the creator race car in every number
  // --- secret cars, one unlock each (see SECRET_HINTS). All a step below the creator race car.
  { id: 'kitsuneS', name: 'Kitsune S', cat: 'secret', secret: 'kitsune', style: 'coupe', paint: '#e8742a', wheel: '#f2f2f2', livery: 1, liveryColor: '#f4f1ea', accel: 9.4, top: 70, grip: 12, lat: 12.8, steer: 0.7, wb: 2.45, driftGrip: 1.25, driftPower: 1.4, driftSteer: 2.6, momentum: 0.6, powerOver: 0.45, mass: 0.95, engine: { pitch: 1.4, cyl: 4, grit: 0.55 } },
  { id: 'mango', name: 'Mango Midnight', cat: 'secret', secret: 'mango', style: 'coupe', paint: '#1b1a3a', wheel: '#ffb21e', livery: 2, liveryColor: '#ff9f1a', accel: 10.2, top: 78, grip: 12.6, lat: 13.4, steer: 0.66, wb: 2.55, driftGrip: 1.3, driftPower: 1.5, driftSteer: 2.55, momentum: 0.6, powerOver: 0.45, mass: 1.0, engine: { pitch: 1.3, cyl: 6, grit: 0.5 } },
  { id: 'raijin', name: 'Raijin GT-R', cat: 'secret', secret: 'raijin', style: 'wedge', paint: '#f2d21b', wheel: '#232323', livery: 1, liveryColor: '#151515', accel: 11.0, top: 84, grip: 13.5, lat: 14.3, steer: 0.6, wb: 2.65, driftGrip: 1.7, driftPower: 1.2, driftSteer: 2.2, momentum: 0.52, powerOver: 0.2, mass: 1.15, engine: { pitch: 1.45, cyl: 6, grit: 0.6 } },
  { id: 'oni', name: 'Oni Kuro', cat: 'boss', secret: 'oni', style: 'coupe', paint: '#0c0c0e', wheel: '#b01010', livery: 2, liveryColor: '#c8140f', satin: true, accel: 17.4, top: 132, grip: 21.9, lat: 23.1, steer: 0.66, wb: 2.6, driftGrip: 1.2, driftPower: 1.5, driftSteer: 2.6, momentum: 0.62, powerOver: 0.5, mass: 1.05, engine: { pitch: 1.25, cyl: 6, grit: 0.7 } },
  // boss cars: just a bit above the Vanta GT (no hidden AI buffs), so beating a boss comes down to driving skill. Beat a boss 1v1 to unlock theirs (Boss tab). The Aurum R stays above them all.
  { id: 'valkyrie', name: 'Valkyrie RS', cat: 'boss', secret: 'valkyrie', style: 'wedge', paint: '#c9ced6', wheel: '#1d3c78', livery: 1, liveryColor: '#1d3c78', accel: 15.4, top: 107, grip: 18, lat: 18.8, steer: 0.58, wb: 2.6, driftGrip: 1.8, driftPower: 1.2, driftSteer: 2.1, momentum: 0.5, powerOver: 0.2, mass: 1.05, engine: { pitch: 1.55, cyl: 10, grit: 0.4 } },
  { id: 'mirage', name: 'Mirage V8', cat: 'boss', secret: 'sandstorm', style: 'muscle', paint: '#c8a46a', wheel: '#151515', livery: 1, liveryColor: '#151515', accel: 14.1, top: 99, grip: 16.4, lat: 17.2, steer: 0.55, wb: 2.8, driftGrip: 1.4, driftPower: 1.55, driftSteer: 2.1, momentum: 0.55, powerOver: 0.5, mass: 1.2, engine: { pitch: 0.85, cyl: 8, grit: 0.85 } },
  { id: 'timber', name: 'Timber Rally', cat: 'boss', secret: 'grizzly', style: 'coupe', paint: '#2f5d3a', wheel: '#e8e8e8', livery: 1, liveryColor: '#f2f2f2', accel: 11.6, top: 88, grip: 14.8, lat: 15.6, steer: 0.72, wb: 2.5, driftGrip: 1.5, driftPower: 1.35, driftSteer: 2.4, momentum: 0.56, powerOver: 0.35, mass: 0.95, engine: { pitch: 1.5, cyl: 4, grit: 0.7 } },
  { id: 'phantom', name: 'Phantom GT', cat: 'boss', secret: 'phantom', style: 'coupe', paint: '#2a1740', wheel: '#1ee3ff', livery: 2, liveryColor: '#1ee3ff', accel: 17.7, top: 133.5, grip: 21.6, lat: 22.8, steer: 0.6, wb: 2.7, driftGrip: 1.5, driftPower: 1.35, driftSteer: 2.3, momentum: 0.56, powerOver: 0.35, mass: 1.05, engine: { pitch: 1.35, cyl: 6, grit: 0.45 } },
  { id: 'ironjaw', name: 'Ironjaw 440', cat: 'boss', secret: 'ironjaw', style: 'muscle', paint: '#151515', wheel: '#ffd23a', livery: 1, liveryColor: '#ffd23a', accel: 17.5, top: 133.5, grip: 21.3, lat: 22.5, steer: 0.62, wb: 2.7, driftGrip: 1.2, driftPower: 1.6, driftSteer: 2.6, momentum: 0.62, powerOver: 0.6, mass: 1.15, engine: { pitch: 0.8, cyl: 8, grit: 0.9 } },
  { id: 'vanta', name: 'Vanta GT', cat: 'squad', style: 'wedge', paint: '#1f3f7a', wheel: '#2b2d31', livery: 1, liveryColor: '#e8eaee', accel: 11.4, top: 86, grip: 14.0, lat: 14.8, steer: 0.62, wb: 2.7, driftGrip: 1.95, driftPower: 1.1, driftSteer: 2.0, momentum: 0.5, powerOver: 0.12, mass: 1.1, noSpin: true, engine: { pitch: 1.5, cyl: 8, grit: 0.35 } },
];
export const carById = (id) => CARS.find((c) => c.id === id) || CARS[0];
// how each secret car is unlocked (shown on the locked car in the garage)
export const SECRET_HINTS = { kitsuneS: 'Reach level 10', raijin: 'Reach level 25', oni: 'Beat Midnight Oni (Kurogane Pass boss)', mango: 'Secret code',
  valkyrie: 'Beat Valkyrie (Apex Circuit boss)', mirage: 'Beat Sandstorm (Dune Valley boss)', timber: 'Beat Grizzly (Pinewood Trails boss)', phantom: 'Beat the Phantom (City Nights boss)', ironjaw: 'Beat Ironjaw (Ironbay boss)' };

// 0-10 stats for the garage
export function carStats(c) {
  const s = (v, a, b) => Math.max(1, Math.min(10, Math.round(((v - a) / (b - a)) * 9 + 1)));
  return {
    accel: s(c.accel, 5.8, 11.4), top: s(c.top, 46, 87),
    handling: s(c.lat + c.steer * 6, 11.5, 18.5), drift: s((2.4 - c.driftGrip) * 2 + c.driftPower + c.powerOver + c.momentum, 2.0, 5.0),
  };
}

export const RIMS = ['Classic 5', 'Mesh', 'Deep Dish', 'Turbine', 'Split 6', 'Steelie'];
export const SPOILERS = ['None', 'Ducktail', 'Mid Wing', 'GT Wing'];
export const STRIPES = ['None', 'Single', 'Twin'];
// realistic factory-style paints: reds, blues, greens, metallics, white/black (custom colours are still allowed)
export const PAINTS = ['#b3262e', '#7c1d22', '#c2531d', '#d4a32a', '#5b6647', '#3d6f6b', '#34506e', '#1d3557', '#2f3f6b', '#5a4a6e', '#eeeeea', '#c9ccd1', '#8d99ae', '#55595e', '#26292c', '#a0622b'];
export const WHEEL_COLORS = ['#cccccc', '#222222', '#b8975a', '#ffffff', '#4a4d52', '#8a6a3a', '#7d8597', '#a6a8ab'];
// underglow: off by default; subtle, normal light colours only
export const GLOWS = ['', '#d8d4c8', '#e2703c', '#5f7fa8', '#b3262e', '#7a8a6a'];
// Older versions offered bright neon colours. Saved cars (and other players' cars) that still use one
// are shown with the nearest normal colour instead, so old saves keep working.
const OLD_NEON = {
  '#00f5d4': '#3d6f6b', '#2ec4b6': '#3d6f6b', '#ff006e': '#7c1d22', '#8338ec': '#5a4a6e', '#80b918': '#5b6647',
  '#ffbe0b': '#d4a32a', '#ff5400': '#c2531d', '#3a86ff': '#34506e', '#e63946': '#b3262e', '#e0b13c': '#b8975a',
};
const OLD_GLOW = { '#00f5d4': '#5f7fa8', '#ff006e': '#b3262e', '#3a86ff': '#5f7fa8', '#ffbe0b': '#e2703c', '#8338ec': '#5f7fa8', '#19e3ff': '#d8d4c8' };
export const normalColor = (hex) => (hex && OLD_NEON[hex.toLowerCase()]) || hex;
export const normalGlow = (hex) => (hex && OLD_GLOW[hex.toLowerCase()]) || hex;
// returns a copy of a car config with any old neon colours swapped for normal ones
export function normalizeColors(cfg) {
  if (!cfg) return cfg;
  return { ...cfg, paint: normalColor(cfg.paint), wheel: normalColor(cfg.wheel), stripeColor: normalColor(cfg.stripeColor), liveryColor: normalColor(cfg.liveryColor), underglow: normalGlow(cfg.underglow || '') };
}

// Visual parts. Each changes the 3D model (or its glass/light colour). fits(def, i) says which
// options suit which car: e.g. bull bars and tow bars are for pickups and SUVs only.
const truck = (def) => def.cat === 'pickup' || def.cat === 'suv';
export const VISUAL = {
  rimSize: { name: 'Rim size', opts: ['Factory', '+1"', '+2"', '+3"'] },
  fbumper: { name: 'Front bumper', opts: ['Factory', 'Sport lip', 'Splitter & canards', 'Bull bar'], fits: (d, i) => i !== 3 || truck(d) },
  rbumper: { name: 'Rear bumper', opts: ['Factory', 'Diffuser', 'Race diffuser', 'Tow bar'], fits: (d, i) => i !== 3 || truck(d) },
  skirts: { name: 'Side skirts', opts: ['Factory', 'Street', 'Race'] },
  kit: { name: 'Body kit', opts: ['None', 'Street kit', 'Widebody'] },
  hood: { name: 'Bonnet', opts: ['Factory', 'Vented', 'Scoop', 'Carbon'] },
  spoiler: { name: 'Spoiler', opts: SPOILERS, fits: (d, i) => i === 0 || !truck(d) || d.cat === 'suv' && i <= 1 },
  tint: { name: 'Window tint', opts: ['Factory', 'Light', 'Dark', 'Limo', 'Blue'] },
  lights: { name: 'Headlights', opts: ['Factory', 'Xenon', 'Yellow', 'Smoked'] },
  exhaust: { name: 'Exhaust', opts: ['Factory', 'Dual tips', 'Quad', 'Big single', 'Side exit'] },
  livery: { name: 'Livery', opts: ['None', 'Two-tone roof', 'Side stripe', 'Racer'] },
};
export const fitsPart = (def, k, i) => !VISUAL[k] || !VISUAL[k].fits || VISUAL[k].fits(def, i);
const TINT = [null, [3.2, 3.4, 3.6], [0.55, 0.55, 0.6], [0.2, 0.2, 0.22], [1.2, 2.2, 4.2]];
const LIGHT = [null, [1.05, 1.18, 1.5], [1.35, 1.12, 0.45], [0.55, 0.55, 0.58]];

export function defaultConfig(id = 'hatch') {
  const c = carById(id);
  return {
    id: c.id, paint: c.paint, wheel: c.wheel || '#cccccc', rim: c.rim || 0, spoiler: 0, kit: 0, stripes: 0, stripeColor: '#ffffff', lowered: 0, underglow: '',
    rimSize: 0, fbumper: 0, rbumper: 0, skirts: 0, hood: 0, tint: c.tint || 0, lights: 0, exhaust: 0, livery: c.livery || 0, liveryColor: c.liveryColor || '#111111', tune: null,
  };
}

// --------------------------------------------------------------------------
// Body shapes. Profiles are side silhouettes [z,y] (z forward), counter-clockwise.
// --------------------------------------------------------------------------
const STYLES = {
  hatch: { L: 3.95, W: 1.78, H: 0.62, ride: 0.2, nose: 0.62, cowl: 1.1, deck: 0.0, rearTop: 0.95, cab: [0.22, 1.15, 1.9, 0.38], ch: 0.6, cw: 0.86, wheelR: 0.31, wheelW: 0.24, fo: 0.78, ro: 0.72 },
  sedan: { L: 4.55, W: 1.82, H: 0.6, ride: 0.19, nose: 0.62, cowl: 1.3, deck: 0.04, rearTop: 0.88, cab: [1.0, 1.4, 2.15, 1.45], ch: 0.56, cw: 0.85, wheelR: 0.32, wheelW: 0.24, fo: 0.9, ro: 0.95 },
  coupe: { L: 4.4, W: 1.82, H: 0.56, ride: 0.15, nose: 0.55, cowl: 1.45, deck: 0.05, rearTop: 0.86, cab: [0.95, 1.5, 2.3, 1.55], ch: 0.5, cw: 0.82, wheelR: 0.33, wheelW: 0.26, fo: 0.85, ro: 0.95 },
  wedge: { L: 4.6, W: 2.0, H: 0.5, ride: 0.12, nose: 0.42, cowl: 1.5, deck: 0.06, rearTop: 0.92, cab: [1.25, 1.45, 2.35, 1.7], ch: 0.46, cw: 0.78, wheelR: 0.35, wheelW: 0.3, fo: 1.0, ro: 0.9 },
  muscle: { L: 4.85, W: 1.96, H: 0.68, ride: 0.17, nose: 0.86, cowl: 1.95, deck: 0.02, rearTop: 0.9, cab: [1.05, 2.0, 2.65, 1.45], ch: 0.52, cw: 0.84, wheelR: 0.35, wheelW: 0.3, fo: 1.0, ro: 1.0 },
  pickup: { L: 5.3, W: 2.0, H: 0.8, ride: 0.38, nose: 0.85, cowl: 1.6, deck: 0.0, rearTop: 1.0, cab: [2.0, 1.65, 2.15, 2.05], ch: 0.75, cw: 0.92, wheelR: 0.42, wheelW: 0.32, fo: 1.0, ro: 1.15, bed: true },
  suv: { L: 4.8, W: 2.0, H: 0.84, ride: 0.34, nose: 0.85, cowl: 1.35, deck: 0.0, rearTop: 1.0, cab: [0.15, 1.4, 1.95, 0.3], ch: 0.72, cw: 0.9, wheelR: 0.41, wheelW: 0.3, fo: 1.0, ro: 0.95, rails: true },
  // long-roof estate: sedan nose, roof carried right to an upright tailgate
  wagon: { L: 4.7, W: 1.82, H: 0.6, ride: 0.19, nose: 0.62, cowl: 1.3, deck: 0.0, rearTop: 0.97, cab: [0.16, 1.4, 2.12, 0.3], ch: 0.57, cw: 0.86, wheelR: 0.32, wheelW: 0.24, fo: 0.9, ro: 0.92 },
  // open two-seater: low windscreen, no roof, cockpit with seats and roll hoops (open: true)
  roadster: { L: 4.05, W: 1.78, H: 0.54, ride: 0.14, nose: 0.5, cowl: 1.6, deck: 0.04, rearTop: 0.9, cab: [1.25, 1.9, 2.1, 1.45], ch: 0.3, cw: 0.84, wheelR: 0.31, wheelW: 0.24, fo: 0.8, ro: 0.76, open: true },
};

// --------------------------------------------------------------------------
// Per-car designs. Every car starts from its body style, then overrides the proportions and
// picks its own parts, so no two cars share a 3D model. All designs are original and fictional.
//   shape   overrides for the STYLES numbers, plus taperF / taperR (plan-view taper of the nose /
//           tail, 0..0.3) and crown (rounded roof height, m)
//   head    headlights: round | rect | slim | swept | popup | bar | dots | square   (n = lamps per side)
//   tail    tail lights: pair | bar | split | round | vertical | L | C | stack | slim | quad
//   grille  slot | wide | mesh | vslat | full | intake | trap | bars | big
//   hood    flat | scoop | bulge | vents | power | louver | ridge
//   arches  round | flare | over | square | haunch | box | angular
//   aero    factory aero: none | ducktail | roof | roofbig | wing | swan | lip | fins
//           (deck-mounted factory aero is replaced when an aftermarket spoiler is fitted)
//   exhaust single | dual | center2 | center1 | offset | quad | side | stack | high
//   mirror  sport | std | tow
//   extras  extra parts, see addExtras()
// --------------------------------------------------------------------------
export const LOOKS = {
  // BASIC
  hatch: { // Kova Hatch: short, upright city hatchback with big round eyes
    shape: { taperF: 0.07, taperR: 0.03, rearTop: 1.0, cab: [0.18, 1.12, 1.82, 0.32], ch: 0.62 },
    head: 'round', n: 1, grille: 'slot', tail: 'vertical', hood: 'flat', arches: 'round', aero: 'roof', exhaust: 'single', mirror: 'std',
    extras: ['cladding', 'wiper'],
  },
  sedan: { // Civa Sedan: three-box family saloon, chrome grille bar, L-shaped tails
    shape: { taperF: 0.05, taperR: 0.05, deck: 0.02, cab: [1.05, 1.42, 2.1, 1.55] },
    head: 'slim', grille: 'wide', tail: 'L', hood: 'ridge', arches: 'round', aero: 'none', exhaust: 'dual', mirror: 'std',
    extras: ['beltline', 'chromeTrim'], doors: 4,
  },
  // SPORTS
  zephyr: { // Zephyr GT: long-bonnet fastback grand tourer
    shape: { L: 4.55, H: 0.52, ride: 0.14, nose: 0.5, cowl: 1.8, deck: 0.08, cab: [0.7, 1.8, 2.55, 1.0], ch: 0.46, cw: 0.78, taperF: 0.13, taperR: 0.1 },
    head: 'swept', grille: 'trap', tail: 'bar', hood: 'vents', arches: 'flare', aero: 'ducktail', exhaust: 'center2', mirror: 'sport',
    extras: ['sideVent', 'diffuser'],
  },
  kaze: { // Kaze RS: wide, low hot hatch with a big roof spoiler and centre exhaust
    shape: { L: 4.05, W: 1.86, H: 0.58, ride: 0.16, nose: 0.6, rearTop: 0.98, cab: [0.24, 1.2, 1.85, 0.36], ch: 0.55, taperF: 0.04 },
    head: 'dots', grille: 'mesh', tail: 'C', hood: 'louver', arches: 'square', aero: 'roofbig', exhaust: 'center1', mirror: 'sport',
    extras: ['splitter', 'skirts'],
  },
  // SUPERCARS
  vortex: { // Vortex V12: sharp, flat wedge with louvred engine deck and a fixed wing
    shape: { L: 4.65, W: 2.04, H: 0.52, ride: 0.11, nose: 0.3, cowl: 1.3, deck: 0.04, cab: [1.45, 1.35, 2.1, 1.95], ch: 0.42, cw: 0.74, taperF: 0.2, taperR: 0.04 },
    head: 'slim', grille: 'intake', tail: 'quad', hood: 'vents', arches: 'angular', aero: 'wing', exhaust: 'quad', mirror: 'sport',
    extras: ['sideIntake', 'engineLouvers', 'diffuser'],
  },
  aurora: { // Aurora Hyper: smooth cab-forward teardrop with a bubble canopy and twin tail fins
    shape: { L: 4.75, W: 2.0, H: 0.54, ride: 0.11, nose: 0.42, cowl: 1.1, deck: 0.1, rearTop: 0.82, cab: [1.05, 1.1, 1.85, 1.75], ch: 0.46, cw: 0.7, crown: 0.07, taperF: 0.26, taperR: 0.2 },
    head: 'bar', grille: 'intake', tail: 'slim', hood: 'bulge', arches: 'flare', aero: 'fins', exhaust: 'high', mirror: 'sport',
    extras: ['roofScoop', 'sideIntake', 'diffuser'],
  },
  // DRIFT
  shiro: { // Shiro D1: boxy pop-up-lamp notchback coupe, bolt-on overfenders and a swan-neck wing
    shape: { L: 4.45, W: 1.8, H: 0.56, nose: 0.62, cowl: 1.42, deck: 0.06, cab: [1.05, 1.45, 2.15, 1.55], ch: 0.5, cw: 0.84, taperF: 0.03 },
    head: 'popup', grille: 'slot', tail: 'stack', hood: 'vents', arches: 'over', aero: 'swan', exhaust: 'side', mirror: 'sport',
    extras: ['splitter', 'towhook', 'canards'],
  },
  kitsune: { // Kitsune 86: compact rounded fastback, wide round fenders, quad round tails, ducktail
    shape: { L: 4.25, W: 1.84, H: 0.54, ride: 0.14, nose: 0.52, cowl: 1.5, cab: [0.72, 1.5, 2.2, 1.0], ch: 0.5, cw: 0.8, crown: 0.04, taperF: 0.1, taperR: 0.07 },
    head: 'swept', grille: 'big', tail: 'round', n: 2, hood: 'bulge', arches: 'flare', aero: 'ducktail', exhaust: 'offset', mirror: 'sport',
    extras: ['canards', 'diffuser', 'skirts'],
  },
  // MUSCLE
  thunder: { // Thunder 69: classic long-hood muscle car, quad round lamps in a full-width grille, chrome bumpers
    shape: { L: 4.95, W: 1.94, H: 0.66, nose: 0.9, cowl: 2.15, deck: 0.03, cab: [1.1, 2.2, 2.75, 1.4], ch: 0.48, cw: 0.84, taperF: 0.02 },
    head: 'round', n: 2, grille: 'full', tail: 'split', hood: 'scoop', arches: 'round', aero: 'lip', exhaust: 'dual', mirror: 'std',
    extras: ['chromeBumpers', 'beltline'],
  },
  brute: { // Brute SS: modern muscle, angry slit lamps, power-dome bonnet, wide rear haunches
    shape: { L: 4.8, W: 2.0, H: 0.7, nose: 0.94, cowl: 1.85, deck: 0.04, cab: [1.25, 1.95, 2.5, 1.7], ch: 0.48, cw: 0.82, taperF: 0.05, taperR: 0.03 },
    head: 'rect', grille: 'mesh', tail: 'pair', hood: 'power', arches: 'haunch', aero: 'roof', exhaust: 'quad', mirror: 'sport',
    extras: ['splitter', 'sideVent', 'diffuser'],
  },
  // PICKUPS
  ranger: { // Ranger TX: mid-size crew-cab pickup, square fender flares, roll bar, side steps
    shape: { L: 5.25, W: 1.95, H: 0.76, ride: 0.36, nose: 0.82, cowl: 1.45, cab: [1.75, 1.5, 2.0, 1.85], ch: 0.72, taperF: 0.04 },
    head: 'rect', grille: 'bars', tail: 'stack', hood: 'bulge', arches: 'square', aero: 'none', exhaust: 'single', mirror: 'std',
    extras: ['rollbar', 'steps', 'fogs', 'skid'], doors: 4,
  },
  hauler: { // Hauler HD: tall, slab-fronted heavy-duty regular-cab truck, chrome slat grille, exhaust stack
    shape: { L: 5.5, W: 2.04, H: 0.92, ride: 0.42, nose: 0.97, cowl: 1.75, cab: [2.5, 1.8, 2.12, 2.42], ch: 0.74, cw: 0.94 },
    head: 'square', grille: 'vslat', tail: 'vertical', hood: 'ridge', arches: 'box', aero: 'none', exhaust: 'stack', mirror: 'tow',
    extras: ['markers', 'mudflaps', 'chromeBumpers', 'towhook', 'bedRails'],
  },
  // SUVs
  trail: { // Trailblazer: short, boxy 2-door off-roader with upright screen, spare wheel, snorkel and roof rack
    shape: { L: 4.4, W: 1.98, H: 0.82, ride: 0.4, nose: 0.95, cowl: 1.15, rearTop: 1.0, cab: [0.3, 1.25, 1.38, 0.32], ch: 0.78, cw: 0.94, fo: 0.82, ro: 0.78 },
    head: 'round', n: 1, grille: 'bars', tail: 'quad', hood: 'flat', arches: 'square', aero: 'none', exhaust: 'single', mirror: 'std',
    extras: ['spare', 'snorkel', 'rack', 'lightbar', 'bullbar', 'steps', 'skid'],
  },
  atlas: { // Atlas X: sleek performance SUV with a sloping coupe roofline and full-width light bar
    shape: { L: 4.9, W: 2.0, H: 0.78, ride: 0.3, nose: 0.8, cowl: 1.4, rearTop: 0.92, cab: [0.6, 1.45, 2.1, 1.25], ch: 0.64, cw: 0.86, taperF: 0.09, taperR: 0.07 },
    head: 'slim', grille: 'big', tail: 'bar', hood: 'ridge', arches: 'flare', aero: 'roof', exhaust: 'quad', mirror: 'std',
    extras: ['rails', 'diffuser', 'skirts'], doors: 4,
  },
  // ---- second wave
  pipa: { // Pipa Dot: tiny, tall city car with a contrast roof, round tails and a pert little bonnet bulge
    shape: { L: 3.6, W: 1.7, H: 0.62, ride: 0.2, nose: 0.6, cowl: 0.95, rearTop: 1.0, cab: [0.14, 1.0, 1.62, 0.24], ch: 0.64, cw: 0.88, crown: 0.04, taperF: 0.08, taperR: 0.05, fo: 0.64, ro: 0.58, wheelR: 0.29, wheelW: 0.22 },
    head: 'rect', grille: 'slot', tail: 'round', n: 1, hood: 'bulge', arches: 'flare', aero: 'none', exhaust: 'offset', mirror: 'std',
    extras: ['wiper', 'cladding'],
  },
  brenna: { // Brenna Estate: long-roof family wagon, roof rails, chrome trim, L-shaped tails
    shape: { taperF: 0.05, taperR: 0.03 },
    head: 'slim', grille: 'wide', tail: 'L', hood: 'ridge', arches: 'round', aero: 'roof', exhaust: 'dual', mirror: 'std',
    extras: ['rails', 'beltline', 'chromeTrim'], doors: 4,
  },
  selene: { // Selene Spyder: open two-seat roadster, long bonnet, round lamps, ducktail and twin centre pipes
    shape: { taperF: 0.12, taperR: 0.08 },
    head: 'round', n: 1, grille: 'mesh', tail: 'round', hood: 'bulge', arches: 'flare', aero: 'ducktail', exhaust: 'center2', mirror: 'sport',
    extras: ['lip', 'diffuser'],
  },
  ostra: { // Ostra Velo: wide-track sports saloon, flared arches, quad pipes, boot lip
    shape: { L: 4.65, W: 1.86, H: 0.58, ride: 0.16, deck: 0.03, cab: [1.0, 1.42, 2.15, 1.5], ch: 0.54, taperF: 0.06, taperR: 0.05 },
    head: 'swept', grille: 'mesh', tail: 'bar', hood: 'bulge', arches: 'flare', aero: 'lip', exhaust: 'quad', mirror: 'sport',
    extras: ['splitter', 'skirts', 'diffuser'], doors: 4,
  },
  strale: { // Strale R: compact, featherweight track wedge with a roof scoop, canards and a fixed wing
    shape: { L: 4.4, W: 1.98, H: 0.48, ride: 0.1, nose: 0.36, cowl: 1.2, deck: 0.05, cab: [1.4, 1.3, 2.0, 1.85], ch: 0.42, cw: 0.72, taperF: 0.22, taperR: 0.06 },
    head: 'dots', grille: 'intake', tail: 'C', hood: 'louver', arches: 'angular', aero: 'wing', exhaust: 'center1', mirror: 'sport',
    extras: ['roofScoop', 'sideIntake', 'canards', 'splitter', 'raceDiffuser'],
  },
  halcyon: { // Halcyon GTS: front-engined V12 grand tourer, very long bonnet, muscular rear hips
    shape: { L: 4.75, W: 1.96, H: 0.52, ride: 0.12, nose: 0.46, cowl: 2.05, deck: 0.06, cab: [0.75, 2.05, 2.75, 1.05], ch: 0.46, cw: 0.76, crown: 0.03, taperF: 0.14, taperR: 0.12, wheelR: 0.35, wheelW: 0.3 },
    head: 'slim', grille: 'big', tail: 'round', n: 2, hood: 'vents', arches: 'haunch', aero: 'ducktail', exhaust: 'quad', mirror: 'sport',
    extras: ['sideVent', 'diffuser', 'lip'],
  },
  tenko: { // Tenko S: short-wheelbase notchback drift coupe, bolt-on overfenders, tow hook, ducktail
    shape: { L: 4.1, W: 1.78, H: 0.56, ride: 0.14, nose: 0.6, cowl: 1.35, cab: [0.95, 1.38, 2.0, 1.45], ch: 0.52, taperF: 0.04, fo: 0.78, ro: 0.8 },
    head: 'rect', grille: 'slot', tail: 'quad', hood: 'vents', arches: 'over', aero: 'ducktail', exhaust: 'offset', mirror: 'sport',
    extras: ['towhook', 'canards', 'splitter'],
  },
  ronin: { // Ronin V8: four-door drift saloon, overfenders, louvred bonnet, big wing and side-exit exhaust
    shape: { W: 1.86, H: 0.58, ride: 0.15, deck: 0.03, taperF: 0.04 },
    head: 'rect', grille: 'mesh', tail: 'stack', hood: 'louver', arches: 'over', aero: 'wing', exhaust: 'side', mirror: 'sport',
    extras: ['splitter', 'towhook', 'skirts'], doors: 4,
  },
  jackal: { // Jackal 350: compact pony-car fastback, single round lamps, hood scoop, chrome bumpers
    shape: { L: 4.6, W: 1.9, H: 0.64, nose: 0.86, cowl: 1.85, deck: 0.03, cab: [0.75, 1.9, 2.55, 1.05], ch: 0.48, cw: 0.82, taperF: 0.03 },
    head: 'round', n: 1, grille: 'bars', tail: 'quad', hood: 'scoop', arches: 'round', aero: 'ducktail', exhaust: 'dual', mirror: 'sport',
    extras: ['chromeBumpers', 'sideVent'],
  },
  behemoth: { // Behemoth SS: huge four-door muscle saloon, power-dome bonnet, wide hips, full-width tail bar
    shape: { L: 5.05, W: 2.0, H: 0.7, nose: 0.92, cowl: 1.75, deck: 0.04, cab: [1.15, 1.75, 2.35, 1.55], ch: 0.52, cw: 0.84, taperF: 0.03, taperR: 0.03 },
    head: 'rect', grille: 'big', tail: 'bar', hood: 'power', arches: 'haunch', aero: 'lip', exhaust: 'quad', mirror: 'std',
    extras: ['splitter', 'diffuser'], doors: 4,
  },
  wren: { // Wren Ute: small single-cab ute, long bed with rails, swept lamps, fog lamps
    shape: { L: 4.9, W: 1.86, H: 0.72, ride: 0.32, nose: 0.78, cowl: 1.4, cab: [2.1, 1.45, 1.9, 2.15], ch: 0.66, cw: 0.9, taperF: 0.06, wheelR: 0.37, wheelW: 0.27 },
    head: 'swept', grille: 'mesh', tail: 'vertical', hood: 'flat', arches: 'flare', aero: 'none', exhaust: 'single', mirror: 'std',
    extras: ['bedRails', 'fogs'],
  },
  mammoth: { // Mammoth HD: giant crew-cab heavy-duty truck, power bonnet, tow mirrors, cab marker lamps
    shape: { L: 5.7, W: 2.06, H: 0.95, ride: 0.44, nose: 0.97, cowl: 1.8, cab: [2.25, 1.85, 2.15, 2.3], ch: 0.76, cw: 0.94, wheelR: 0.44, wheelW: 0.34 },
    head: 'rect', grille: 'big', tail: 'pair', hood: 'power', arches: 'box', aero: 'none', exhaust: 'dual', mirror: 'tow',
    extras: ['markers', 'mudflaps', 'skid', 'steps', 'fogs'], doors: 4,
  },
  fennec: { // Fennec XC: compact crossover, rugged cladding, sloping tail, roof rails
    shape: { L: 4.4, W: 1.9, H: 0.76, ride: 0.3, nose: 0.8, cowl: 1.25, rearTop: 0.95, cab: [0.3, 1.3, 1.9, 0.5], ch: 0.62, cw: 0.88, crown: 0.03, taperF: 0.08, taperR: 0.06, wheelR: 0.37, wheelW: 0.27 },
    head: 'swept', grille: 'mesh', tail: 'C', hood: 'flat', arches: 'square', aero: 'roof', exhaust: 'dual', mirror: 'std',
    extras: ['cladding', 'rails', 'skid'], doors: 4,
  },
  castellan: { // Castellan Grand: long three-row luxury SUV, chrome slat grille, side steps
    shape: { L: 5.15, W: 2.04, H: 0.86, ride: 0.34, nose: 0.9, cowl: 1.5, rearTop: 1.0, cab: [0.12, 1.55, 2.05, 0.22], ch: 0.74, cw: 0.92 },
    head: 'slim', grille: 'vslat', tail: 'L', hood: 'ridge', arches: 'round', aero: 'none', exhaust: 'dual', mirror: 'std',
    extras: ['rails', 'chromeTrim', 'beltline', 'steps'], doors: 4,
  },
  // ---- secret
  creator: { // Nocturne Aurum: low, wide bubble-roof wedge, overfenders, swan-neck wing, satin black with gold accents
    shape: { L: 4.6, W: 2.06, H: 0.5, ride: 0.1, nose: 0.34, cowl: 1.25, deck: 0.05, rearTop: 0.88, cab: [1.35, 1.3, 2.05, 1.8], ch: 0.43, cw: 0.72, crown: 0.04, taperF: 0.22, taperR: 0.08 },
    head: 'bar', grille: 'intake', tail: 'bar', hood: 'vents', arches: 'over', aero: 'swan', exhaust: 'center2', mirror: 'sport',
    extras: ['splitter', 'canards', 'diffuser', 'sideIntake', 'goldAccent'],
  },
  creatorR: { // Nocturne Aurum R: same family as the drift car, longer and lower, platinum accents
    shape: { L: 4.75, W: 2.08, H: 0.48, ride: 0.09, nose: 0.32, cowl: 1.3, deck: 0.05, rearTop: 0.86, cab: [1.4, 1.3, 2.1, 1.8], ch: 0.42, cw: 0.72, crown: 0.04, taperF: 0.24, taperR: 0.08 },
    head: 'bar', grille: 'intake', tail: 'bar', hood: 'vents', arches: 'over', aero: 'swan', exhaust: 'center2', mirror: 'sport',
    extras: ['splitter', 'canards', 'diffuser', 'sideIntake', 'goldAccent'], accent: [0.82, 0.84, 0.88],
  },
  kitsuneS: { // Kitsune S: small, light fastback drift coupe with pop-up lights and a ducktail
    shape: { L: 4.2, W: 1.76, H: 0.53, ride: 0.13, nose: 0.5, cowl: 1.5, cab: [0.9, 1.4, 2.15, 1.35], ch: 0.48, taperF: 0.12, taperR: 0.08 },
    head: 'popup', grille: 'slot', tail: 'round', hood: 'vents', arches: 'flare', aero: 'ducktail', exhaust: 'single', mirror: 'sport',
    extras: ['splitter', 'skirts'],
  },
  mango: { // Mango Midnight: midnight-blue widebody coupe, mango-orange stripes and wheels, big wing
    shape: { L: 4.45, W: 1.94, H: 0.52, ride: 0.11, nose: 0.48, cowl: 1.5, cab: [0.95, 1.45, 2.2, 1.45], ch: 0.47, cw: 0.8, taperF: 0.15, taperR: 0.07 },
    head: 'swept', grille: 'intake', tail: 'C', hood: 'scoop', arches: 'over', aero: 'wing', exhaust: 'quad', mirror: 'sport',
    extras: ['splitter', 'canards', 'diffuser', 'goldAccent'], accent: [1, 0.62, 0.1],
  },
  raijin: { // Raijin GT-R: wide, square-shouldered grip monster, round quad tails, roof fin
    shape: { L: 4.6, W: 2.0, H: 0.54, ride: 0.12, nose: 0.42, cowl: 1.35, cab: [1.1, 1.35, 2.1, 1.6], ch: 0.46, cw: 0.78, taperF: 0.16, taperR: 0.03 },
    head: 'slim', grille: 'big', tail: 'quad', hood: 'power', arches: 'box', aero: 'wing', exhaust: 'dual', mirror: 'sport',
    extras: ['splitter', 'diffuser', 'sideVent'],
  },
  oni: { // Oni Kuro: the boss bot's car. Satin black widebody coupe, blood-red accents, swan wing
    shape: { L: 4.5, W: 2.02, H: 0.5, ride: 0.1, nose: 0.42, cowl: 1.45, cab: [1.0, 1.4, 2.15, 1.5], ch: 0.45, cw: 0.78, crown: 0.03, taperF: 0.18, taperR: 0.06 },
    head: 'bar', grille: 'intake', tail: 'bar', hood: 'vents', arches: 'over', aero: 'swan', exhaust: 'center2', mirror: 'sport',
    extras: ['splitter', 'canards', 'diffuser', 'sideIntake', 'goldAccent'], accent: [0.85, 0.06, 0.05],
  },
  vanta: { // Vanta GT: clean GT wedge with a swan wing and white accents
    head: 'bar', grille: 'intake', tail: 'bar', hood: 'vents', arches: 'over', aero: 'swan', exhaust: 'center2', mirror: 'sport',
    extras: ['splitter', 'diffuser', 'sideIntake', 'goldAccent'], accent: [0.9, 0.91, 0.93],
  },
};

// boss cars borrow a body from a car of their class, with their own accents:
// Valkyrie RS + Phantom GT = supercars, Mirage V8 + Ironjaw 440 = muscle, Timber Rally = sports car, Oni Kuro = drift car
for (const [id, from, accent] of [['valkyrie', 'strale', [0.29, 0.55, 1]], ['mirage', 'behemoth', [0.08, 0.08, 0.08]], ['timber', 'zephyr', [0.95, 0.95, 0.95]], ['phantom', 'halcyon', [0.12, 0.89, 1]], ['ironjaw', 'jackal', [1, 0.82, 0.23]]]) {
  const base = LOOKS[from] || {};
  LOOKS[id] = { ...base, extras: [...new Set([...(base.extras || []), 'splitter', 'goldAccent'])], accent };
}
function shapeOf(def) { return { ...STYLES[def.style], ...((LOOKS[def.id] || {}).shape || {}) }; }

export function carDims(def) {
  const s = shapeOf(def); const k = def.scale || 1;
  return { L: s.L * k, W: s.W * k, H: (s.ride + s.H + s.ch) * k, wheelR: s.wheelR * k };
}

const C = {
  glass: [0.07, 0.09, 0.12], trim: [0.09, 0.09, 0.1], tire: [0.06, 0.06, 0.065], side: [0.16, 0.16, 0.17],
  head: [1, 0.97, 0.86, 1], tail: [1, 1, 1], white: [1, 1, 1], grille: [0.05, 0.05, 0.06],
  chrome: [0.62, 0.64, 0.68], metal: [0.36, 0.36, 0.38], hole: [0.02, 0.02, 0.02], plastic: [0.12, 0.12, 0.13],
  amber: [1, 0.62, 0.12, 1], gold: [0.78, 0.6, 0.27], seat: [0.1, 0.09, 0.09], housing: [0.16, 0.16, 0.18], well: [0.03, 0.03, 0.035], rubber: [0.07, 0.07, 0.075],
};

function profiles(s, lowered) {
  const L = s.L, H = s.H, r = s.ride - (lowered === true ? 0.06 : +lowered || 0); // lowered: metres of body drop
  const z0 = -L / 2, z1 = L / 2, y0 = r, y1 = r + H;
  const lower = [
    [z0 + 0.08, y0 + 0.02], [z1 - 0.15, y0 + 0.02], [z1, y0 + H * 0.32], [z1 - 0.04, y0 + H * s.nose],
    [z1 - s.cowl, y1], [z0 + 0.25, y1 - s.deck * H], [z0, y0 + H * s.rearTop * 0.92], [z0 - 0.02, y0 + H * 0.35],
  ];
  const [cbR, cbF, ctF, ctR] = s.cab;
  const cabin = [[z0 + cbR, y1 - 0.01], [z1 - cbF, y1 - 0.01], [z1 - ctF, y1 + s.ch], [z0 + ctR, y1 + s.ch]];
  return { lower, cabin, y0, y1, z0, z1, r };
}

function grow(profile, d) {
  let cz = 0, cy = 0; profile.forEach((p) => { cz += p[0]; cy += p[1]; }); cz /= profile.length; cy /= profile.length;
  return profile.map(([z, y]) => { const dz = z - cz, dy = y - cy, l = Math.hypot(dz, dy) || 1; return [z + (dz / l) * d, y + (dy / l) * d]; });
}

function buildWheel(rimStyle, R, W, size = 0) {
  const tire = new Geo();
  tire.cylinder(0, 0, 0, R, W, 18, C.tire, 'x', C.side);
  tire.cylinder(0, 0, 0, R * 0.97, W + 0.02, 18, C.tire, 'x', C.side); // rounded tyre shoulder
  // tread blocks for visible spin
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    tire.at(0, 0, 0, 0, 1, 1, 1, a).box(0, R + 0.004, 0, W * 0.9, 0.012, 0.06, [0.12, 0.12, 0.13]).reset();
  }
  const rim = new Geo(); const rr = R * Math.min(0.86, 0.66 + 0.065 * size), x = W / 2 + 0.006; // bigger rims, lower-profile tyres
  const W_ = C.white;
  rim.cylinder(x - 0.01, 0, 0, rr, 0.03, 18, [0.75, 0.75, 0.75], 'x', [0.06, 0.06, 0.065]); // rim lip around a dark barrel
  // brake disc (in the tyre mesh so the wheel colour doesn't tint it), seen between the spokes
  tire.cylinder(x + 0.004, 0, 0, rr * 0.74, 0.006, 16, [0.4, 0.4, 0.42], 'x', [0.42, 0.42, 0.44]);
  tire.cylinder(x + 0.006, 0, 0, rr * 0.36, 0.006, 12, [0.2, 0.2, 0.21], 'x', [0.22, 0.22, 0.23]); // disc hat
  const spokes = (n, w, t = 0.035, len = rr * 0.92, off = 0) => {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + off;
      rim.at(x + 0.008, 0, 0, 0, 1, 1, 1, a).box(0, len / 2, 0, t, len, w, W_).reset();
    }
  };
  switch (rimStyle) {
    case 1: spokes(12, 0.025, 0.03); break;
    case 2: rim.cylinder(x + 0.01, 0, 0, rr * 0.95, 0.02, 14, [0.55, 0.55, 0.55], 'x', [0.6, 0.6, 0.6]); spokes(5, 0.07, 0.04, rr * 0.5); break;
    case 3: for (let i = 0; i < 9; i++) { const a = (i / 9) * Math.PI * 2; rim.at(x + 0.008, 0, 0, 0.35, 1, 1, 1, a).box(0, rr * 0.5, 0, 0.03, rr * 0.85, 0.09, W_).reset(); } break;
    case 4: spokes(6, 0.03, 0.035, rr * 0.92, 0.08); spokes(6, 0.03, 0.035, rr * 0.92, -0.08); break;
    case 5: rim.cylinder(x + 0.004, 0, 0, rr * 0.9, 0.02, 10, [0.62, 0.62, 0.62], 'x', W_); for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; rim.box(x + 0.02, Math.cos(a) * rr * 0.55, Math.sin(a) * rr * 0.55, 0.02, 0.08, 0.08, C.grille); } break;
    default: spokes(5, 0.085);
  }
  rim.cylinder(x + 0.02, 0, 0, rr * 0.2, 0.04, 8, W_, 'x', [0.5, 0.5, 0.5]);
  return { tire: tire.build(), rim: rim.build() };
}

// Build GPU meshes for a car configuration. Returns a CarModel.
const modelCache = new Map();
export function buildCarModel(renderer, cfg) {
  cfg = normalizeColors(cfg);
  const def = carById(cfg.id);
  const key = JSON.stringify([def.id, cfg.rim, cfg.spoiler, cfg.kit, cfg.stripes, cfg.lowered, cfg.rimSize, cfg.fbumper, cfg.rbumper, cfg.skirts, cfg.hood, cfg.exhaust, cfg.livery, cfg.tune && cfg.tune.rideHeight]);
  let m = modelCache.get(key);
  if (!m || m.renderer !== renderer) { m = buildGeometry(renderer, def, cfg); m.renderer = renderer; modelCache.set(key, m); }
  return {
    def, meshes: m, cfg,
    paint: hexToRgb(cfg.paint), wheelCol: hexToRgb(cfg.wheel), stripeCol: hexToRgb(cfg.stripeColor || '#ffffff'),
    glow: cfg.underglow ? hexToRgb(cfg.underglow) : null,
    liveryCol: hexToRgb(cfg.liveryColor || '#111111'), glassTint: TINT[cfg.tint | 0] || null, lightTint: LIGHT[cfg.lights | 0] || null,
  };
}
export function clearCarCache() { modelCache.clear(); }

// Body shell: like Geo.extrude, but the side panels are built as vertical strips so the body can
// taper in plan view (wf) without the flat side panel twisting.
function bodyShell(g, prof, width, bevel, col, wf) {
  let cz = 0, cy = 0; prof.forEach(([z, y]) => { cz += z; cy += y; }); cz /= prof.length; cy /= prof.length;
  const sh = prof.map(([z, y]) => { const dz = z - cz, dy = y - cy, l = Math.hypot(dz, dy) || 1; const k = Math.min(bevel, l * 0.5) / l; return [z - dz * k, y - dy * k]; });
  const hw = width / 2, n = prof.length;
  const rings = [sh.map(([z, y]) => [-hw * wf(z), y, z]), prof.map(([z, y]) => [-(hw - bevel) * wf(z), y, z]),
    prof.map(([z, y]) => [(hw - bevel) * wf(z), y, z]), sh.map(([z, y]) => [hw * wf(z), y, z])];
  for (let r = 0; r < 3; r++) for (let i = 0; i < n; i++) { const j = (i + 1) % n; g.quad(rings[r][i], rings[r + 1][i], rings[r + 1][j], rings[r][j], col); }
  const zs = [...new Set(sh.map((p) => +p[0].toFixed(4)))].sort((a, b) => a - b);
  const span = (z) => {
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < n; i++) {
      const a = sh[i], b = sh[(i + 1) % n];
      if (Math.abs(a[0] - b[0]) < 1e-6) { if (Math.abs(z - a[0]) < 1e-3) { lo = Math.min(lo, a[1], b[1]); hi = Math.max(hi, a[1], b[1]); } continue; }
      if ((z - a[0]) * (z - b[0]) <= 1e-9) { const y = a[1] + ((b[1] - a[1]) * (z - a[0])) / (b[0] - a[0]); lo = Math.min(lo, y); hi = Math.max(hi, y); }
    }
    return [lo, hi];
  };
  for (let i = 0; i < zs.length - 1; i++) {
    const za = zs[i], zb = zs[i + 1], [la, ha] = span(za), [lb, hb] = span(zb);
    if (!isFinite(la) || !isFinite(lb)) continue;
    for (const sx of [-1, 1]) {
      const A = [sx * hw * wf(za), la, za], B = [sx * hw * wf(zb), lb, zb], Cc = [sx * hw * wf(zb), hb, zb], D = [sx * hw * wf(za), ha, za];
      if (sx > 0) g.quad(A, D, Cc, B, col); else g.quad(A, B, Cc, D, col);
    }
  }
}
// insert profile vertices at the given z positions (so the plan taper follows the body)
function densify(poly, zs) {
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length]; out.push(a);
    const cuts = zs.filter((z) => (z - a[0]) * (z - b[0]) < 0 && Math.abs(z - a[0]) > 0.03 && Math.abs(z - b[0]) > 0.03).sort((p, q) => (a[0] < b[0] ? p - q : q - p));
    for (const z of cuts) { const u = (z - a[0]) / (b[0] - a[0]); out.push([z, a[1] + (b[1] - a[1]) * u]); }
  }
  return out;
}
const dtri = (g, a, b, c, col) => { g.tri(a, b, c, col); g.tri(a, c, b, col); };

function buildGeometry(renderer, def, cfg) {
  const look = LOOKS[def.id] || {};
  const s0 = shapeOf(def); const k = def.scale || 1;
  const s = { ...s0, L: s0.L * k, W: s0.W * k, H: s0.H * k, ride: s0.ride * k, ch: s0.ch * k, wheelR: s0.wheelR * k, cowl: s0.cowl * k, cab: s0.cab.map((v) => v * k), fo: s0.fo * k, ro: s0.ro * k, crown: (s0.crown || 0) * k };
  const rideAdj = cfg.tune && cfg.tune.rideHeight ? Math.max(-3, Math.min(2, cfg.tune.rideHeight | 0)) * 0.02 : 0;
  const P = profiles(s, (cfg.lowered ? 0.06 : 0) - rideAdj);
  const paint = new Geo(), glass = new Geo(), trim = new Geo(), head = new Geo(), tail = new Geo(), stripe = new Geo();
  const W = s.W, H = s.H, { y0, y1, z0, z1 } = P, ex = [...(look.extras || [])], has = (e) => ex.includes(e);
  const livery = new Geo();
  // garage parts add to / override the car's factory details
  const fit = (k) => (fitsPart(def, k, cfg[k] | 0) ? cfg[k] | 0 : 0);
  if (fit('fbumper') === 1) ex.push('lip'); if (fit('fbumper') === 2) ex.push('splitter', 'canards'); if (fit('fbumper') === 3) ex.push('bullbar');
  if (fit('rbumper') === 1) ex.push('diffuser'); if (fit('rbumper') === 2) ex.push('diffuser', 'raceDiffuser'); if (fit('rbumper') === 3) ex.push('towbar');
  if (fit('skirts') === 1) ex.push('skirts'); if (fit('skirts') === 2) ex.push('raceSkirts');
  const noseY = y0 + H * s.nose, frontLowY = y0 + H * 0.32, rearTopY = y0 + H * s.rearTop * 0.92, rearLowY = y0 + H * 0.35, deckY = y1 - s.deck * H;
  const bumperCol = has('chromeBumpers') ? C.chrome : has('cladding') ? C.plastic : C.trim;

  // ---- plan-view taper + body
  const tlF = Math.max(0.3, Math.min(0.95, s.fo - s.wheelR - 0.06)), tlR = Math.max(0.3, Math.min(0.95, s.ro - s.wheelR - 0.06));
  const tF = s.taperF || 0, tR = s.taperR || 0;
  const wf = (z) => {
    let f = 1; const a = z - (z1 - tlF), b = z0 + tlR - z;
    if (a > 0) f -= tF * Math.pow(Math.min(1, a / tlF), 1.6);
    if (b > 0) f -= tR * Math.pow(Math.min(1, b / tlR), 1.6);
    return f;
  };
  const hw = (z) => (W / 2) * wf(z);
  const cuts = [z1 - tlF, z1 - tlF * 0.55, z1 - tlF * 0.25, z0 + tlR, z0 + tlR * 0.55, z0 + tlR * 0.25];
  bodyShell(paint, densify(P.lower, cuts), W, 0.09, C.white, wf);

  // surface helpers. upper chain runs front -> back (z decreasing)
  const up = [[z1, frontLowY], [z1 - 0.04, noseY], [z1 - s.cowl, y1], [z0 + 0.25, deckY], [z0, rearTopY], [z0 - 0.02, rearLowY]];
  const surfY = (z) => {
    for (let i = 0; i < up.length - 1; i++) { const a = up[i], b = up[i + 1]; if (z <= a[0] && z >= b[0]) return a[1] + ((b[1] - a[1]) * (a[0] - z)) / ((a[0] - b[0]) || 1); }
    return z > up[0][0] ? up[0][1] : up[up.length - 1][1];
  };
  const slope = (z) => (surfY(z + 0.04) - surfY(z - 0.04)) / 0.08;
  // place a box lying on the top surface at z, tilted to the surface
  const onTop = (g, x, z, w, h, d, col, lift = 0) => { g.at(x, surfY(z) + lift, z, 0, 1, 1, 1, -Math.atan(slope(z))).box(0, h / 2 - 0.012, 0, w, h, d, col).reset(); };
  // faces: polylines from the bottom up; returns the surface z and the tilt of the face at height y
  const faceAt = (poly, y) => {
    for (let i = 0; i < poly.length - 1; i++) {
      const a = poly[i], b = poly[i + 1];
      if (y >= a[1] - 1e-6 && y <= b[1] + 1e-6) { const u = (y - a[1]) / ((b[1] - a[1]) || 1); return [a[0] + (b[0] - a[0]) * u, b[0] - a[0], b[1] - a[1]]; }
    }
    const l = poly[poly.length - 1]; return [l[0], 0, 1];
  };
  const FP = [[z1 - 0.15, y0 + 0.02], [z1, frontLowY], [z1 - 0.04, noseY], [z1 - s.cowl, y1]];
  const BP = [[z0 + 0.08, y0 + 0.02], [z0 - 0.02, rearLowY], [z0, rearTopY], [z0 + 0.25, deckY]];
  // mount a part on the front face (local +z = outward normal); f(g) draws it around the origin
  const front = (x, y, out, f, yaw = 0, roll = 0) => {
    const [z, dz, dy] = faceAt(FP, y), p = Math.atan2(dz, dy), nz = Math.cos(p), ny = -Math.sin(p);
    return (g) => { g.at(x, y + ny * out, z + nz * out, yaw, 1, 1, 1, p, roll); f(g); g.reset(); };
  };
  const back = (x, y, out, f, yaw = 0, roll = 0) => {
    const [z, dz, dy] = s.bed ? [z0 + 0.08 - 0.04, 0, 1] : faceAt(BP, y), p = Math.atan2(-dz, dy);
    const nz = -Math.cos(p), ny = -Math.sin(p);
    return (g) => { g.at(x, y + ny * out, z + nz * out, Math.PI + yaw, 1, 1, 1, p, roll); f(g); g.reset(); };
  };
  const fBox = (g, x, y, w, h, d, col, out = 0.012, yaw = 0, roll = 0) => front(x, y, out - d / 2, (G) => G.box(0, 0, 0, w, h, d, col), yaw, roll)(g);
  const bBox = (g, x, y, w, h, d, col, out = 0.012, yaw = 0, roll = 0) => back(x, y, out - d / 2, (G) => G.box(0, 0, 0, w, h, d, col), yaw, roll)(g);
  const fCyl = (g, x, y, r, d, col, cap, out = 0.012) => front(x, y, out - d / 2, (G) => G.cylinder(0, 0, 0, r, d, 12, col, 'z', cap))(g);
  const bCyl = (g, x, y, r, d, col, cap, out = 0.012) => back(x, y, out - d / 2, (G) => G.cylinder(0, 0, 0, r, d, 12, col, 'z', cap))(g);

  // ---- cabin (glass) + painted roof and pillars
  const [cbR, cbF, ctF, ctR] = s.cab;
  const roofY = y1 + s.ch;
  const cabin = [[z0 + cbR, y1 - 0.01], [z1 - cbF, y1 - 0.01], [z1 - ctF, roofY], [z0 + ctR, roofY]];
  if (s.crown) cabin.splice(3, 0, [(z1 - ctF + z0 + ctR) / 2 + 0.1, roofY + s.crown]);
  const cabW = W * s.cw;
  if (!s.open) glass.extrude(cabin, cabW, 0.07, C.glass);
  const cR = cabin[0], cF = cabin[1], tFp = cabin[2], tRp = cabin[cabin.length - 1];
  const roofLine = cabin.slice(2).reverse(); // rear -> front
  if (s.open) { // roadster: raked windscreen in a painted frame, open cockpit with two seats and roll hoops
    glass.extrude([[cF[0] - 0.05, y1 - 0.01], [cF[0], y1 - 0.01], [tFp[0], roofY], [tFp[0] - 0.05, roofY]], cabW - 0.04, 0.02, C.glass);
    paint.extrude([[tFp[0] - 0.06, roofY - 0.01], [tFp[0] + 0.01, roofY - 0.01], [tFp[0] + 0.01, roofY + 0.03], [tFp[0] - 0.06, roofY + 0.03]], cabW + 0.02, 0.015, C.white);
    const zc0 = cR[0] + 0.05, zc1 = cF[0] - 0.02, zm = (zc0 + zc1) / 2;
    trim.box(0, y1 - 0.02, zm, cabW * 0.96, 0.06, zc1 - zc0, C.grille); // cockpit tub
    trim.box(0, y1 + 0.02, zc1 - 0.12, cabW * 0.96, 0.08, 0.22, C.trim); // dashboard
    for (const sx of [-1, 1]) {
      const sxp = sx * cabW * 0.24, sz = zc0 + 0.2;
      trim.at(sxp, y1 + 0.13, sz, 0, 1, 1, 1, 0.25).box(0, 0, 0, 0.42, 0.34, 0.09, C.seat).reset(); // seat back
      trim.box(sxp, y1 + 0.33, sz - 0.05, 0.22, 0.11, 0.08, C.seat); // headrest
      trim.box(sxp, y1 + 0.0, sz + 0.24, 0.42, 0.07, 0.42, C.seat); // cushion
      onTop(paint, sxp, zc0 - 0.32, 0.32, 0.1, 0.6, C.white); // head fairing behind each seat
      for (const dx of [-0.16, 0.16]) trim.box(sxp + dx, y1 + 0.19, zc0 - 0.08, 0.035, 0.38, 0.035, C.metal); // roll hoop
      trim.box(sxp, y1 + 0.38, zc0 - 0.08, 0.355, 0.035, 0.035, C.metal);
    }
    trim.cylinder(cabW * 0.24, y1 + 0.24, zc1 - 0.3, 0.16, 0.03, 14, C.trim, 'z', C.trim); // steering wheel
  } else for (let i = 0; i < roofLine.length - 1; i++) {
    const a = roofLine[i], b = roofLine[i + 1], ea = i === 0 ? 0.02 : 0, eb = i === roofLine.length - 2 ? 0.02 : 0;
    paint.extrude([[a[0] - ea, a[1] - 0.03], [b[0] + eb, b[1] - 0.03], [b[0] + eb / 2, b[1] + 0.035], [a[0] - ea / 2, a[1] + 0.035]], cabW + 0.03, 0.03, C.white);
  }
  const roofAt = (z) => { for (let i = 0; i < roofLine.length - 1; i++) { const a = roofLine[i], b = roofLine[i + 1]; if (z >= a[0] && z <= b[0]) return a[1] + ((b[1] - a[1]) * (z - a[0])) / ((b[0] - a[0]) || 1); } return roofY; };
  const midZ = (cR[0] + tRp[0] + cF[0] + tFp[0]) / 4;
  for (const sx of s.open ? [] : [-1, 1]) {
    paint.box(sx * (cabW / 2 - 0.01), (y1 + roofAt(midZ - 0.15)) / 2, midZ - 0.15, 0.04, roofAt(midZ - 0.15) - y1, 0.12, C.white);
    const ax = sx * (cabW / 2 - 0.02);
    const a0 = [ax - sx * 0.03, y1, cF[0]], a1 = [ax, roofY, tFp[0]];
    const dz = a1[2] - a0[2], dy = a1[1] - a0[1], len = Math.hypot(dz, dy);
    paint.at(ax, (a0[1] + a1[1]) / 2, (a0[2] + a1[2]) / 2, 0, 1, 1, 1, -Math.atan2(dy, dz)).box(0, 0, 0, 0.05, 0.05, len, C.white).reset();
    // C-pillar
    const c0 = [ax - sx * 0.03, y1, cR[0]], c1 = [ax, roofY, tRp[0]];
    const cdz = c1[2] - c0[2], cdy = c1[1] - c0[1];
    paint.at(ax, (c0[1] + c1[1]) / 2, (c0[2] + c1[2]) / 2, 0, 1, 1, 1, -Math.atan2(cdy, cdz)).box(0, 0, 0, 0.05, 0.05, Math.hypot(cdz, cdy), C.white).reset();
  }

  if (s.open) for (const sx of [-1, 1]) { // windscreen A-pillars
    const ax = sx * (cabW / 2 - 0.02), a0 = [ax, y1, cF[0] - 0.02], a1 = [ax, roofY, tFp[0] - 0.02];
    const dz = a1[2] - a0[2], dy = a1[1] - a0[1];
    paint.at(ax, (a0[1] + a1[1]) / 2, (a0[2] + a1[2]) / 2, 0, 1, 1, 1, -Math.atan2(dy, dz)).box(0, 0, 0, 0.045, 0.045, Math.hypot(dz, dy), C.white).reset();
  }

  // ---- bumpers
  const bw = (z) => hw(z) * 2 * 0.97;
  trim.box(0, y0 + 0.1, z1 - 0.05, bw(z1 - 0.05), 0.16, 0.12, bumperCol);
  if (!s.bed) trim.box(0, y0 + 0.1, z0 + 0.05, bw(z0 + 0.05), 0.16, 0.12, bumperCol);
  else trim.box(0, y0 + 0.12, z0 + 0.04, W * 0.98, 0.14, 0.14, bumperCol);
  trim.box(0, y0 + 0.04, 0, W * 0.96, 0.08, s.L * 0.9, C.trim); // underbody shadow line

  // ---- wheel wells + arches
  const wx = W / 2 - s.wheelW / 2 + 0.04, wy = s.wheelR, fz = z1 - s.fo, rz = z0 + s.ro;
  const archStyle = (cfg.kit | 0) === 2 ? (s.bed || look.arches === 'square' ? 'box' : 'over') : look.arches || 'round'; // widebody
  const band = (g, x, zc, yc, r0, r1, a0, a1, nSeg, out, col) => {
    const rm = (r0 + r1) / 2, rw = r1 - r0, da = (a1 - a0) / nSeg;
    for (let i = 0; i < nSeg; i++) {
      const a = a0 + da * (i + 0.5), seg = rm * da * 1.08;
      if (yc + rm * Math.sin(a) > localTop(zc + rm * Math.cos(a)) + 0.03) continue; // keep arches on the bodywork
      g.at(x, yc + rm * Math.sin(a), zc + rm * Math.cos(a), 0, 1, 1, 1, -(a + Math.PI / 2)).box(0, 0, 0, out, rw, seg, col).reset();
    }
  };
  // fender humps: on low cars the tyres stand taller than the bonnet / deck, so the wings rise over them
  // (rounded: a row of slices whose tops follow a circle around the wheel)
  const ARCH = s.wheelR + 0.05, humps = [];
  const humpTop = (zc, z) => { const r = ARCH + 0.06, dz = z - zc; return Math.abs(dz) < r ? wy + Math.sqrt(r * r - dz * dz) : -Infinity; };
  for (const zc of [fz, rz]) {
    if (s.bed && zc < z0 + s.cab[0]) continue; // pickup beds are tall enough
    const r = ARCH + 0.06, N = 12; let any = false, sMin = Infinity;
    for (let z = zc - r; z <= zc + r; z += 0.04) { sMin = Math.min(sMin, surfY(z)); if (humpTop(zc, z) > surfY(z) + 0.015) any = true; }
    if (any) {
      const prof = [[zc - r, sMin - 0.06], [zc + r, sMin - 0.06]];
      for (let i = 0; i <= N; i++) { const a = (i / N) * Math.PI; prof.push([zc + r * Math.cos(a), Math.max(sMin - 0.05, wy + r * Math.sin(a))]); }
      prof.splice(2, 1); // drop the duplicate start point
      const hwid = 0.42;
      for (const sx of [-1, 1]) paint.extrude(prof, hwid, 0.05, C.white, sx * (hw(zc) - hwid / 2 + 0.004));
    }
    if (any) humps.push(zc);
  }
  const localTop = (z) => {
    let t = surfY(z);
    if (s.bed && z < z0 + s.cab[0]) t = Math.max(t, y1 + 0.42);
    for (const zc of humps) t = Math.max(t, humpTop(zc, z));
    return t - 0.015;
  };
  for (const [zc, rear] of [[fz, false], [rz, true]]) {
    const R = ARCH, yb = y0 + 0.03, yc = Math.max(wy, yb + 0.02);
    const aMin = Math.asin(Math.max(-1, Math.min(1, (yb - yc) / R))), a0 = aMin, a1 = Math.PI - aMin;
    for (const sx of [-1, 1]) {
      const xs = sx * (hw(zc) + 0.006);
      // dark wheel well (only above the body's lower edge)
      const N = 12;
      for (let i = 0; i < N; i++) {
        const p = (a) => { const z = zc + R * Math.cos(a); return [xs, Math.min(yc + R * Math.sin(a), localTop(z)), z]; };
        dtri(trim, [xs, yc, zc], p(a0 + ((a1 - a0) * i) / N), p(a0 + ((a1 - a0) * (i + 1)) / N), C.well);
      }
      const st = archStyle === 'haunch' && !rear ? 'round' : archStyle;
      const ox = (o) => sx * (hw(zc) + o);
      if (st === 'round') band(paint, ox(0.015), zc, yc, R, R + 0.05, a0, a1, 12, 0.03, C.white);
      else if (st === 'flare') { band(paint, ox(0.03), zc, yc, R - 0.01, R + 0.1, a0, a1, 12, 0.06, C.white); }
      else if (st === 'over') {
        band(paint, ox(0.06), zc, yc, R - 0.02, R + 0.13, a0, a1, 6, 0.12, C.white);
        for (let i = 0; i < 5; i++) { const a = a0 + ((a1 - a0) * (i + 0.5)) / 5; trim.box(ox(0.125), yc + (R + 0.08) * Math.sin(a), zc + (R + 0.08) * Math.cos(a), 0.012, 0.025, 0.025, C.chrome); }
      } else if (st === 'square') {
        const t = 0.09, top = yc + R + 0.02, xo = ox(0.04);
        trim.box(xo, top, zc, 0.08, t, R * 1.7, C.plastic);
        for (const dzs of [-1, 1]) trim.at(xo, (top + yb) / 2 + 0.02, zc + dzs * R * 1.02, 0, 1, 1, 1, -dzs * 0.32).box(0, 0, 0, 0.08, (top - yb) * 1.04, t, C.plastic).reset();
      } else if (st === 'angular') band(paint, ox(0.03), zc, yc, R - 0.01, R + 0.09, a0, a1, 4, 0.06, C.white);
      else if (st === 'box') {
        const t = 0.08, top = Math.min(yc + R + 0.03, localTop(zc) - 0.02), xo = ox(0.05);
        paint.box(xo, top, zc, 0.1, t, R * 2.3, C.white);
        for (const dzs of [-1, 1]) paint.box(xo, (top + yb) / 2, zc + dzs * R * 1.1, 0.1, top - yb, t, C.white);
      } else if (st === 'haunch') { // rear: wide muscular hip over the wheel
        band(paint, ox(0.03), zc, yc, R - 0.01, R + 0.09, a0, a1, 12, 0.06, C.white);
        paint.at(ox(0.03), y1 - 0.12, zc + 0.15, 0, 1, 1, 1, 0).box(0, 0, 0, 0.06, 0.12, R * 3.2, C.white).reset();
      }
    }
  }

  // ---- headlights
  const faceH = noseY - frontLowY;
  const onFace = faceH > 0.15;
  let hy = onFace ? frontLowY + faceH * 0.62 : noseY + 0.03;
  const lampH = onFace ? 1 : 1.7; // lamps on a sloping nose are seen at a shallow angle
  const hzRef = faceAt(FP, hy)[0];
  const hx = (w, inset = 0.08) => hw(hzRef) - inset - w / 2;
  const hl = look.head || 'rect';
  if (hl === 'round') {
    const n = look.n || 1, r = n > 1 ? 0.075 : 0.1, gap = r * 2 + 0.05;
    for (const sx of [-1, 1]) for (let i = 0; i < n; i++) {
      const x = sx * (hx(r * 2, 0.09 + (n > 1 ? 0.02 : 0)) - i * gap);
      fCyl(trim, x, hy, r + 0.03, 0.05, C.chrome, C.housing, 0.02);
      fCyl(head, x, hy, r, 0.05, C.head, C.head, 0.032);
    }
  } else if (hl === 'rect') {
    for (const sx of [-1, 1]) { fBox(trim, sx * hx(0.38), hy, 0.4, 0.11, 0.05, C.housing, 0.018, 0, sx * 0.1); fBox(head, sx * hx(0.38), hy + 0.005, 0.34, 0.06 * lampH, 0.05, C.head, 0.026, 0, sx * 0.1); }
  } else if (hl === 'slim') {
    for (const sx of [-1, 1]) { fBox(head, sx * hx(0.5, 0.04), hy, 0.5, 0.045 * lampH, 0.05, C.head, 0.02, sx * -0.28); fBox(trim, sx * hx(0.5, 0.04), hy - 0.04, 0.46, 0.03, 0.04, C.housing, 0.016, sx * -0.28); }
  } else if (hl === 'swept') {
    for (const sx of [-1, 1]) { fBox(trim, sx * hx(0.42, 0.05), hy, 0.44, 0.1 * lampH, 0.05, C.housing, 0.016, sx * -0.35, sx * 0.22); fBox(head, sx * hx(0.42, 0.05), hy, 0.36, 0.06 * lampH, 0.05, C.head, 0.024, sx * -0.35, sx * 0.22); }
  } else if (hl === 'popup') { // closed pop-up covers on the bonnet + thin lamps in the bumper
    for (const sx of [-1, 1]) {
      onTop(paint, sx * (hw(z1 - 0.3) - 0.3), z1 - 0.3, 0.36, 0.045, 0.32, C.white);
      onTop(trim, sx * (hw(z1 - 0.3) - 0.3), z1 - 0.3, 0.38, 0.03, 0.34, C.grille, -0.008);
      fBox(head, sx * hx(0.32, 0.1), frontLowY - 0.02, 0.32, 0.05, 0.05, C.head, 0.02);
    }
    hy = frontLowY - 0.02;
  } else if (hl === 'bar') {
    fBox(head, 0, hy, hw(hzRef) * 2 - 0.25, 0.028 * lampH, 0.05, C.head, 0.02);
    for (const sx of [-1, 1]) fBox(head, sx * hx(0.22, 0.1), hy - 0.045 * lampH, 0.22, 0.04 * lampH, 0.05, C.head, 0.02, sx * -0.25);
  } else if (hl === 'dots') {
    for (const sx of [-1, 1]) {
      fBox(trim, sx * hx(0.4, 0.06), hy, 0.42, 0.1, 0.05, C.housing, 0.016, sx * -0.2);
      for (let i = 0; i < 3; i++) fBox(head, sx * (hx(0.4, 0.06) - 0.14 + i * 0.14), hy, 0.08, 0.06, 0.05, C.head, 0.026, sx * -0.2);
    }
  } else if (hl === 'square') {
    for (const sx of [-1, 1]) { fBox(trim, sx * hx(0.34, 0.06), hy, 0.36, 0.26, 0.05, C.chrome, 0.016); fBox(head, sx * hx(0.34, 0.06), hy + 0.04, 0.3, 0.1, 0.05, C.head, 0.026); fBox(head, sx * hx(0.34, 0.06), hy - 0.07, 0.3, 0.06, 0.05, C.amber, 0.026); }
  }

  // ---- grille
  const gy = onFace ? frontLowY + faceH * 0.25 : frontLowY - 0.02, gW = hw(z1) * 2;
  const gr = look.grille || 'slot';
  if (gr === 'slot') { fBox(trim, 0, hy, gW * 0.32, 0.05, 0.04, C.grille, 0.01); fBox(trim, 0, y0 + 0.13, gW * 0.5, 0.07, 0.04, C.grille, 0.075); }
  else if (gr === 'wide') { fBox(trim, 0, gy + 0.02, gW * 0.6, 0.15, 0.04, C.grille, 0.01); fBox(trim, 0, gy + 0.03, gW * 0.62, 0.025, 0.04, C.chrome, 0.018); fBox(trim, 0, y0 + 0.12, gW * 0.4, 0.05, 0.04, C.grille, 0.075); }
  else if (gr === 'mesh') {
    fBox(trim, 0, gy, gW * 0.52, 0.2, 0.04, C.grille, 0.01);
    for (let i = -3; i <= 3; i++) fBox(trim, i * gW * 0.07, gy, 0.012, 0.19, 0.04, C.plastic, 0.016);
    for (let j = -1; j <= 1; j++) fBox(trim, 0, gy + j * 0.06, gW * 0.5, 0.012, 0.04, C.plastic, 0.016);
  } else if (gr === 'vslat') {
    const gh = Math.min(0.42, faceH * 0.75);
    fBox(trim, 0, gy + gh * 0.25, gW * 0.5, gh, 0.04, C.chrome, 0.012);
    fBox(trim, 0, gy + gh * 0.25, gW * 0.46, gh - 0.06, 0.04, C.grille, 0.018);
    for (let i = -4; i <= 4; i++) fBox(trim, i * gW * 0.05, gy + gh * 0.25, 0.035, gh - 0.07, 0.04, C.chrome, 0.026);
  } else if (gr === 'full') {
    fBox(trim, 0, hy, hw(hzRef) * 2 - 0.08, 0.22, 0.04, C.grille, 0.006);
    fBox(trim, 0, hy + 0.12, hw(hzRef) * 2 - 0.08, 0.025, 0.04, C.chrome, 0.012);
    fBox(trim, 0, hy - 0.12, hw(hzRef) * 2 - 0.08, 0.025, 0.04, C.chrome, 0.012);
    for (let i = -2; i <= 2; i++) fBox(trim, i * 0.09, hy, 0.015, 0.2, 0.04, C.plastic, 0.012);
  } else if (gr === 'intake') { // supercar: no grille, big lower intakes
    fBox(trim, 0, y0 + 0.14, gW * 0.42, 0.09, 0.04, C.grille, 0.075);
    for (const sx of [-1, 1]) fBox(trim, sx * gW * 0.33, y0 + 0.15, gW * 0.2, 0.11, 0.04, C.grille, 0.075, sx * -0.3);
    fBox(trim, 0, frontLowY + 0.01, gW * 0.2, 0.025, 0.04, C.grille, 0.012);
  } else if (gr === 'trap') {
    fBox(trim, 0, gy, gW * 0.34, 0.1, 0.04, C.grille, 0.012);
    fBox(trim, 0, y0 + 0.14, gW * 0.5, 0.08, 0.04, C.grille, 0.075);
    for (const sx of [-1, 1]) fBox(trim, sx * gW * 0.2, gy - 0.02, 0.06, 0.12, 0.04, C.grille, 0.012, 0, sx * 0.5);
  } else if (gr === 'bars') {
    fBox(trim, 0, gy + 0.04, gW * 0.5, 0.24, 0.04, C.grille, 0.008);
    for (let j = 0; j < 3; j++) fBox(trim, 0, gy - 0.05 + j * 0.08, gW * 0.52, 0.035, 0.05, look.head === 'round' ? C.plastic : C.chrome, 0.02);
  } else if (gr === 'big') {
    fBox(trim, 0, gy + 0.01, gW * 0.46, 0.24, 0.04, C.chrome, 0.008);
    fBox(trim, 0, gy + 0.01, gW * 0.42, 0.2, 0.04, C.grille, 0.014);
    for (let j = -1; j <= 1; j++) fBox(trim, 0, gy + 0.01 + j * 0.06, gW * 0.42, 0.01, 0.04, C.plastic, 0.02);
    fBox(trim, 0, y0 + 0.12, gW * 0.6, 0.06, 0.04, C.grille, 0.075);
  }

  // ---- tail lights
  const ty = s.bed ? y1 + 0.24 : rearLowY + (rearTopY - rearLowY) * 0.6;
  const tz = s.bed ? z0 + 0.04 : faceAt(BP, ty)[0];
  const thw = s.bed ? W / 2 - 0.02 : hw(tz);
  const tx = (w, inset = 0.05) => thw - inset - w / 2;
  const tl = look.tail || 'pair';
  if (tl === 'pair') for (const sx of [-1, 1]) { bBox(tail, sx * tx(0.42), ty, 0.42, 0.1, 0.05, C.tail, 0.015); }
  else if (tl === 'bar') { bBox(tail, 0, ty + 0.03, thw * 2 - 0.12, 0.035, 0.05, C.tail, 0.015); for (const sx of [-1, 1]) bBox(tail, sx * tx(0.3), ty - 0.02, 0.3, 0.07, 0.05, C.tail, 0.015); }
  else if (tl === 'split') { for (const sx of [-1, 1]) { bBox(trim, sx * (thw / 2 - 0.02), ty, thw - 0.12, 0.11, 0.05, C.chrome, 0.01); bBox(tail, sx * (thw / 2 - 0.02), ty, thw - 0.16, 0.07, 0.05, C.tail, 0.018); } }
  else if (tl === 'round') { const n = look.n || 2; for (const sx of [-1, 1]) for (let i = 0; i < n; i++) { bCyl(trim, sx * (tx(0.16) - i * 0.19), ty, 0.085, 0.04, C.housing, C.housing, 0.01); bCyl(tail, sx * (tx(0.16) - i * 0.19), ty, 0.068, 0.04, C.tail, C.tail, 0.018); } }
  else if (tl === 'vertical') { const h = s.bed ? 0.36 : 0.28; for (const sx of [-1, 1]) bBox(tail, sx * tx(0.11, 0.02), ty, 0.11, h, 0.05, C.tail, 0.015); }
  else if (tl === 'L') for (const sx of [-1, 1]) { bBox(tail, sx * tx(0.38, 0.03), ty, 0.38, 0.07, 0.05, C.tail, 0.015); bBox(tail, sx * tx(0.08, 0.03), ty + 0.1, 0.08, 0.16, 0.05, C.tail, 0.015); }
  else if (tl === 'C') for (const sx of [-1, 1]) { bBox(tail, sx * tx(0.06, 0.04), ty, 0.06, 0.2, 0.05, C.tail, 0.015); for (const dy of [-0.08, 0.08]) bBox(tail, sx * tx(0.24, 0.04), ty + dy, 0.24, 0.045, 0.05, C.tail, 0.015); }
  else if (tl === 'stack') for (const sx of [-1, 1]) { for (const dy of [-0.045, 0.045]) bBox(tail, sx * tx(0.36), ty + dy, 0.36, 0.055, 0.05, C.tail, 0.015); }
  else if (tl === 'slim') { for (const sx of [-1, 1]) bBox(tail, sx * tx(0.5, 0.02), ty + 0.03, 0.5, 0.032, 0.05, C.tail, 0.015, 0, sx * 0.12); bBox(tail, 0, ty - 0.02, 0.5, 0.02, 0.05, C.tail, 0.015); }
  else if (tl === 'quad') for (const sx of [-1, 1]) for (let i = 0; i < 2; i++) bBox(tail, sx * (tx(0.13) - i * 0.17), ty, 0.13, 0.12, 0.05, C.tail, 0.015);
  if (!s.bed) bBox(trim, 0, ty - 0.12, Math.min(0.5, thw), 0.11, 0.03, C.grille, 0.005); // number plate recess
  fBox(trim, 0, y0 + 0.2, 0.42, 0.1, 0.02, C.grille, 0.075); // front plate

  // ---- bonnet
  const hood = [look.hood || 'flat', 'vents', 'scoop', look.hood || 'flat'][fit('hood')], hzc = z1 - s.cowl * 0.45;
  if (fit('hood') === 3) { // carbon bonnet skin following the bonnet surface
    const a = z1 - 0.06, b = z1 - s.cowl + 0.04;
    trim.extrude([[b, surfY(b) - 0.005], [a, surfY(a) - 0.005], [a, surfY(a) + 0.018], [b, surfY(b) + 0.018]], hw(a) * 2 * 0.82, 0.01, [0.07, 0.07, 0.08]);
    for (let i = -3; i <= 3; i++) onTop(trim, i * W * 0.1, (a + b) / 2, 0.006, 0.026, a - b - 0.05, [0.13, 0.13, 0.15]);
  }
  if (hood === 'scoop') { onTop(paint, 0, hzc, 0.55, 0.1, s.cowl * 0.42, C.white); onTop(trim, 0, hzc + s.cowl * 0.19, 0.42, 0.06, 0.05, C.grille, 0.03); }
  else if (hood === 'bulge') onTop(paint, 0, hzc, W * 0.42, 0.045, s.cowl * 0.7, C.white);
  else if (hood === 'vents') for (const sx of [-1, 1]) { onTop(trim, sx * W * 0.17, hzc + 0.05, 0.24, 0.02, 0.32, C.grille); for (let i = 0; i < 4; i++) onTop(trim, sx * W * 0.17, hzc - 0.09 + i * 0.09, 0.24, 0.035, 0.025, C.plastic); }
  else if (hood === 'power') { onTop(paint, 0, hzc, W * 0.5, 0.085, s.cowl * 0.75, C.white); for (const sx of [-1, 1]) onTop(trim, sx * W * 0.14, hzc + s.cowl * 0.2, 0.1, 0.03, 0.3, C.grille, 0.06); }
  else if (hood === 'louver') for (let i = 0; i < 5; i++) onTop(trim, 0, hzc - 0.16 + i * 0.08, W * 0.3, 0.025, 0.03, C.grille);
  else if (hood === 'ridge') for (const sx of [-1, 1]) onTop(paint, sx * W * 0.2, hzc, 0.05, 0.03, s.cowl * 0.85, C.white);

  // ---- factory aero (deck-mounted parts give way to an aftermarket spoiler)
  const deckZ = z0 + 0.25, aero = look.aero || 'none', deckFree = !(cfg.spoiler > 0) && !s.bed;
  if (aero === 'ducktail' && deckFree) paint.extrude([[deckZ - 0.22, deckY - 0.02], [deckZ + 0.12, deckY - 0.02], [deckZ - 0.2, deckY + 0.08]], hw(deckZ) * 2 * 0.95, 0.02, C.white);
  if (aero === 'lip' && deckFree) paint.extrude([[deckZ - 0.2, deckY - 0.015], [deckZ + 0.02, deckY - 0.015], [deckZ - 0.19, deckY + 0.035]], hw(deckZ) * 2 * 0.9, 0.01, C.white);
  if ((aero === 'roof' || aero === 'roofbig') && !s.open) {
    const big = aero === 'roofbig', rzp = tRp[0] + 0.02, ry = roofAt(tRp[0] + 0.05);
    paint.extrude([[rzp - (big ? 0.34 : 0.2), ry - 0.02], [rzp + 0.1, ry + 0.02], [rzp + 0.08, ry + 0.06], [rzp - (big ? 0.32 : 0.18), ry + (big ? 0.06 : 0.03)]], cabW * (big ? 1.02 : 0.95), 0.015, C.white);
    if (big) for (const sx of [-1, 1]) trim.box(sx * cabW * 0.51, ry + 0.01, rzp - 0.12, 0.02, 0.1, 0.36, C.plastic);
  }
  if ((aero === 'wing' || aero === 'swan') && deckFree) {
    const hgt = aero === 'swan' ? 0.4 : 0.26, ww = aero === 'swan' ? W * 1.0 : W * 0.92, wz = deckZ - 0.08;
    if (aero === 'swan') for (const sx of [-1, 1]) {
      trim.at(sx * W * 0.22, deckY + hgt / 2, wz - 0.12, 0, 1, 1, 1, 0.45).box(0, 0, 0, 0.035, hgt + 0.08, 0.06, C.trim).reset();
      trim.box(sx * W * 0.22, deckY + hgt + 0.06, wz - 0.06, 0.035, 0.05, 0.14, C.trim);
    } else for (const sx of [-1, 1]) trim.box(sx * W * 0.3, deckY + hgt / 2, wz, 0.05, hgt, 0.14, C.trim);
    paint.extrude([[wz - 0.36, deckY + hgt], [wz + 0.06, deckY + hgt + 0.02], [wz + 0.04, deckY + hgt + 0.06], [wz - 0.34, deckY + hgt + 0.1]], ww, 0.015, C.white);
    for (const sx of [-1, 1]) trim.box(sx * ww / 2, deckY + hgt + 0.05, wz - 0.16, 0.02, 0.22, 0.44, C.trim);
  }
  if (aero === 'fins') {
    for (const sx of [-1, 1]) paint.at(sx * W * 0.3, 0, 0).extrude([[deckZ - 0.25, deckY - 0.02], [tRp[0] - 0.1, roofAt(tRp[0]) - 0.1], [deckZ - 0.15, deckY + 0.18]], 0.04, 0.01, C.white).reset();
    if (deckFree) paint.extrude([[deckZ - 0.22, deckY - 0.02], [deckZ + 0.1, deckY - 0.02], [deckZ - 0.2, deckY + 0.06]], W * 0.5, 0.02, C.white);
  }

  // ---- exhausts
  const exy = y0 + 0.06, exz = z0 + 0.02;
  const pipe = (x, r = 0.042, y = exy, z = exz) => trim.cylinder(x, y, z, r, 0.2, 10, C.metal, 'z', C.hole);
  const exh = [look.exhaust || 'single', 'dual', 'quad', 'center1', 'side'][fit('exhaust')];
  if (exh === 'single') pipe(-W * 0.3);
  else if (exh === 'dual') { pipe(-W * 0.32); pipe(W * 0.32); }
  else if (exh === 'center2') { pipe(-0.09, 0.045); pipe(0.09, 0.045); }
  else if (exh === 'center1') pipe(0, 0.065);
  else if (exh === 'offset') pipe(W * 0.22, 0.07);
  else if (exh === 'quad') for (const sx of [-1, 1]) { pipe(sx * (W * 0.32 + 0.05), 0.038); pipe(sx * (W * 0.32 - 0.05), 0.038); }
  else if (exh === 'side') trim.cylinder(-(hw(rz) + 0.02), y0 + 0.07, rz + s.wheelR + 0.3, 0.045, 0.16, 10, C.metal, 'x', C.hole);
  else if (exh === 'high') { const hy2 = rearLowY + (rearTopY - rearLowY) * 0.2; pipe(0, 0.075, hy2, faceAt(BP, hy2)[0] + 0.04); }
  else if (exh === 'stack') { const sz = z0 + s.cab[0] - 0.12, sxp = W / 2 - 0.16; trim.cylinder(sxp, y1 + 0.55, sz, 0.055, 1.25, 10, C.chrome, 'y', C.hole); trim.box(sxp, y1 + 1.2, sz - 0.04, 0.12, 0.03, 0.12, C.chrome); }

  // ---- mirrors
  const mir = look.mirror || 'std';
  for (const sx of [-1, 1]) {
    const mz = cF[0] - 0.12, mx = sx * (cabW / 2 + (mir === 'tow' ? 0.2 : 0.11)), my = y1 + 0.13;
    paint.box(sx * (cabW / 2 + 0.03), my - 0.03, mz, 0.08, 0.04, 0.08, C.white);
    if (mir === 'tow') { trim.box(mx, my + 0.05, mz, 0.06, 0.28, 0.14, C.plastic); trim.box(sx * (cabW / 2 + 0.1), my - 0.05, mz, 0.2, 0.025, 0.025, C.plastic); }
    else if (mir === 'sport') paint.box(mx, my, mz, 0.12, 0.07, 0.12, C.white);
    else paint.box(mx, my, mz, 0.16, 0.11, 0.1, C.white);
  }

  // ---- pickup bed
  if (s.bed) {
    const bz0 = z0 + 0.08, bz1 = z0 + s.cab[0] - 0.05, bl = bz1 - bz0, bh = 0.42;
    trim.box(0, y1 + 0.005, (bz0 + bz1) / 2, W * 0.88, 0.02, bl, [0.12, 0.12, 0.12]);
    for (const sx of [-1, 1]) paint.box(sx * (W / 2 - 0.06), y1 + bh / 2, (bz0 + bz1) / 2, 0.1, bh, bl, C.white);
    paint.box(0, y1 + bh / 2, bz0, W - 0.02, bh, 0.08, C.white);
    trim.box(0, y1 + bh + 0.02, bz1 + 0.05, W * 0.9, 0.04, 0.05, C.trim);
    trim.box(0, y1 + bh * 0.55, bz0 - 0.045, 0.3, 0.05, 0.02, C.plastic); // tailgate handle
    if (has('bedRails')) for (const sx of [-1, 1]) trim.box(sx * (W / 2 - 0.06), y1 + bh + 0.03, (bz0 + bz1) / 2, 0.06, 0.04, bl, C.chrome);
    if (has('rollbar')) {
      const rbz = bz1 - 0.3, rh = s.ch * 0.92; // hoop just below the cab roof line
      for (const sx of [-1, 1]) trim.box(sx * (W / 2 - 0.16), y1 + rh / 2, rbz, 0.07, rh, 0.07, C.plastic);
      trim.box(0, y1 + rh, rbz, W - 0.25, 0.07, 0.07, C.plastic);
      for (const sx of [-1, 1]) trim.at(sx * (W / 2 - 0.16), y1 + rh * 0.55, rbz - 0.35, 0, 1, 1, 1, -0.95).box(0, 0, 0, 0.06, 0.06, rh * 1.1, C.plastic).reset();
      for (const sx of [-1, 1]) { trim.box(sx * 0.3, y1 + rh + 0.08, rbz, 0.16, 0.1, 0.07, C.housing); head.box(sx * 0.3, y1 + rh + 0.08, rbz + 0.037, 0.13, 0.07, 0.01, C.head); }
    }
  }

  // ---- extras
  if (has('lip')) fBox(trim, 0, y0 + 0.02, hw(z1) * 2 - 0.1, 0.035, 0.16, C.plastic, 0.06);
  if (has('raceSkirts')) for (const sx of [-1, 1]) { trim.box(sx * (W / 2 + 0.03), y0 + 0.05, (fz + rz) / 2, 0.08, 0.12, (fz - rz) - s.wheelR * 2 - 0.15, C.plastic); trim.box(sx * (W / 2 + 0.08), y0 + 0.02, (fz + rz) / 2, 0.06, 0.025, (fz - rz) - s.wheelR * 2 - 0.15, C.plastic); }
  if (has('raceDiffuser')) { bBox(trim, 0, y0 + 0.02, W * 0.85, 0.05, 0.4, C.plastic, 0.1); for (const sx of [-1, 1]) bBox(trim, sx * W * 0.38, y0 + 0.14, 0.03, 0.2, 0.35, C.plastic, 0.1); }
  if (has('towbar')) { bBox(trim, 0, y0 + 0.06, 0.08, 0.08, 0.3, C.metal, 0.22); trim.cylinder(0, y0 + 0.13, z0 - 0.25, 0.035, 0.08, 8, C.chrome, 'y', C.chrome); }
  if (has('cladding') || has('skirts')) for (const sx of [-1, 1]) trim.box(sx * (W / 2 + 0.005), y0 + 0.07, (fz + rz) / 2, 0.03, 0.1, (fz - rz) - s.wheelR * 2 - 0.2, has('cladding') ? C.plastic : C.trim);
  if (has('wiper')) for (const sx of [-1, 1]) trim.at(sx * 0.25, y1 + 0.02, cF[0] - 0.04, 0, 1, 1, 1, 0, sx * 0.1).box(0, 0, 0, 0.45, 0.015, 0.02, C.trim).reset();
  if (has('beltline')) for (const sx of [-1, 1]) trim.box(sx * (cabW / 2 + 0.01), y1 + 0.005, (cR[0] + cF[0]) / 2, 0.02, 0.022, cF[0] - cR[0], C.chrome);
  if (has('chromeTrim')) bBox(trim, 0, ty - 0.06, thw * 1.3, 0.02, 0.03, C.chrome, 0.012);
  if (has('sideVent')) for (const sx of [-1, 1]) for (let i = 0; i < 3; i++) trim.at(sx * (hw(fz - 0.6) + 0.004), y0 + H * 0.55 - i * 0.07, fz - s.wheelR - 0.3, 0, 1, 1, 1, 0.35).box(0, 0, 0, 0.012, 0.03, 0.28, C.grille).reset();
  if (has('diffuser')) { bBox(trim, 0, y0 + 0.04, W * 0.6, 0.06, 0.22, C.plastic, 0.05); for (let i = -2; i <= 2; i++) bBox(trim, i * W * 0.11, y0 + 0.08, 0.02, 0.1, 0.24, C.plastic, 0.06); }
  if (has('splitter')) fBox(trim, 0, y0 + 0.015, hw(z1) * 2 + 0.02, 0.03, 0.32, C.plastic, 0.1);
  if (has('canards')) for (const sx of [-1, 1]) fBox(trim, sx * (hw(z1 - 0.1) - 0.05), y0 + 0.2, 0.18, 0.02, 0.14, C.plastic, 0.07, 0, sx * -0.3);
  if (has('towhook')) fBox(trim, -hw(z1) * 0.55, y0 + 0.1, 0.05, 0.1, 0.12, [0.85, 0.1, 0.1], 0.1);
  if (has('sideIntake')) for (const sx of [-1, 1]) {
    const iz = rz + s.wheelR + 0.45;
    trim.at(sx * (hw(iz) + 0.004), y0 + H * 0.55, iz, 0, 1, 1, 1, 0).box(0, 0, 0, 0.02, H * 0.42, 0.55, C.grille).reset();
    paint.at(sx * (hw(iz) + 0.02), y0 + H * 0.78, iz + 0.05, 0, 1, 1, 1, 0).box(0, 0, 0, 0.05, 0.04, 0.65, C.white).reset();
  }
  if (has('engineLouvers')) { const lz0 = tRp[0] - 0.05; for (let i = 0; i < 6; i++) onTop(trim, 0, lz0 - i * 0.12, cabW * 0.8, 0.03, 0.05, C.grille, 0.005); }
  if (has('roofScoop')) { const rzc = (tRp[0] + tFp[0]) / 2 - 0.25; paint.box(0, roofAt(rzc) + 0.06, rzc, 0.3, 0.1, 0.55, C.white); trim.box(0, roofAt(rzc) + 0.08, rzc + 0.28, 0.24, 0.07, 0.02, C.hole); }
  if (has('fogs')) for (const sx of [-1, 1]) fCyl(head, sx * (hw(z1) - 0.28), y0 + 0.13, 0.045, 0.04, C.head, C.head, 0.075);
  if (has('skid')) fBox(trim, 0, y0 - 0.02, W * 0.55, 0.05, 0.35, C.chrome, 0.06);
  if (has('steps')) for (const sx of [-1, 1]) trim.box(sx * (W / 2 + 0.07), y0 - 0.03, (fz + rz) / 2, 0.16, 0.04, (fz - rz) - s.wheelR * 2 - 0.25, C.plastic);
  if (has('markers')) for (let i = -2; i <= 2; i++) head.box(i * cabW * 0.18, roofAt(tFp[0] - 0.05) + 0.045, tFp[0] - 0.05, 0.07, 0.035, 0.05, C.amber);
  if (has('mudflaps')) for (const sx of [-1, 1]) trim.box(sx * (W / 2 - s.wheelW / 2), y0 - 0.02, rz - s.wheelR - 0.12, s.wheelW + 0.04, 0.3, 0.02, C.rubber);
  if (has('spare')) {
    const sy = y0 + H * 0.62, sz = faceAt(BP, sy)[0] - 0.13;
    trim.cylinder(0.05, sy, sz, s.wheelR * 0.95, 0.24, 14, C.tire, 'z', C.tire);
    trim.cylinder(0.05, sy, sz - 0.125, s.wheelR * 0.55, 0.02, 12, C.metal, 'z', C.metal);
  }
  if (has('snorkel')) {
    const sz2 = cF[0] + 0.15, sxp = -(hw(sz2) + 0.06);
    trim.box(sxp, (y1 + roofY) / 2, sz2, 0.1, roofY - y1 + 0.2, 0.1, C.plastic);
    trim.box(sxp, roofY + 0.1, sz2 + 0.05, 0.14, 0.12, 0.2, C.plastic);
  }
  if (has('rack')) {
    const rz0 = tRp[0] + 0.05, rz1 = tFp[0] - 0.05, ry = roofY + 0.12;
    for (const sx of [-1, 1]) trim.box(sx * cabW * 0.45, ry, (rz0 + rz1) / 2, 0.04, 0.04, rz1 - rz0, C.plastic);
    for (let i = 0; i < 4; i++) trim.box(0, ry, rz0 + ((rz1 - rz0) * i) / 3, cabW * 0.92, 0.035, 0.04, C.plastic);
    for (const sx of [-1, 1]) for (const zz of [rz0, rz1]) trim.box(sx * cabW * 0.45, ry - 0.06, zz, 0.04, 0.12, 0.04, C.plastic);
  }
  if (has('lightbar')) { const lz = tFp[0] - 0.02; trim.box(0, roofY + 0.2, lz, cabW * 0.8, 0.09, 0.08, C.housing); for (let i = -3; i <= 3; i++) head.box(i * cabW * 0.1, roofY + 0.2, lz + 0.042, 0.07, 0.055, 0.01, C.head); }
  if (has('bullbar')) {
    const bz = z1 + 0.14;
    for (const sx of [-1, 1]) trim.box(sx * W * 0.25, y0 + 0.28, bz, 0.06, 0.5, 0.06, C.plastic);
    trim.box(0, y0 + 0.52, bz, W * 0.56, 0.06, 0.06, C.plastic); trim.box(0, y0 + 0.14, bz, W * 0.7, 0.06, 0.06, C.plastic);
  }
  if (has('goldAccent')) { const ACC = look.accent || C.gold; // secret cars: thin gold (or platinum) pinstripes on the splitter, sills, diffuser and a nose badge
    fBox(trim, 0, y0 + 0.035, hw(z1) * 2 - 0.05, 0.014, 0.02, ACC, 0.11);
    for (const sx of [-1, 1]) trim.box(sx * (W / 2 + 0.012), y0 + 0.13, (fz + rz) / 2, 0.012, 0.018, (fz - rz) - ARCH * 2 - 0.2, ACC);
    bBox(trim, 0, y0 + 0.11, W * 0.62, 0.014, 0.02, ACC, 0.06);
    onTop(trim, 0, z1 - 0.35, 0.12, 0.02, 0.07, ACC, 0.005);
    for (const sx of [-1, 1]) onTop(trim, sx * W * 0.12, (z1 - s.cowl * 0.5), 0.025, 0.012, s.cowl * 0.8, ACC, 0.004); // bonnet pinstripes
  }
  if (has('rails')) for (const sx of [-1, 1]) trim.box(sx * cabW * 0.4, roofAt((tRp[0] + tFp[0]) / 2) + 0.06, (tRp[0] + tFp[0]) / 2, 0.035, 0.035, (tFp[0] - tRp[0]) * 0.92, C.chrome);

  // ---- door shut lines + handles (cheap detail that makes the body read as a real car)
  {
    const zA = Math.min(cF[0] + 0.05, fz - ARCH - 0.12);
    const zEnd = Math.max(rz + ARCH + 0.08, s.bed ? z0 + s.cab[0] + 0.06 : -1e9); // doors stop before the rear wheel / bed
    const ok = [zA];
    for (const len of look.doors === 4 ? [0.95, 0.82] : [1.12]) { const z = Math.max(zEnd, ok[ok.length - 1] - len); if (ok[ok.length - 1] - z > 0.4) ok.push(z); }
    const yTop = y1 - 0.03, yBot = y0 + 0.1, handle = look.extras && look.extras.includes('chromeTrim') ? C.chrome : C.plastic;
    for (const sx of [-1, 1]) {
      for (const z of ok) trim.box(sx * (hw(z) + 0.004), (yTop + yBot) / 2, z, 0.01, yTop - yBot, 0.012, C.grille);
      for (let i = 1; i < ok.length; i++) trim.box(sx * (hw(ok[i]) + 0.012), y0 + H * 0.72, ok[i] + 0.16, 0.02, 0.03, 0.14, handle);
    }
  }

  // ---- upgrades (garage)
  if (cfg.kit) {
    fBox(trim, 0, y0 - 0.02, hw(z1) * 2, 0.04, 0.3, C.trim, 0.06);
    for (const sx of [-1, 1]) trim.box(sx * (W / 2 + 0.01), y0 + 0.03, 0, 0.06, 0.1, s.L * 0.5, C.trim);
    trim.box(0, y0 + 0.02, z0 + 0.1, W * 0.7, 0.08, 0.2, C.grille);
  }
  if (cfg.spoiler === 1) paint.extrude([[deckZ - 0.2, deckY - 0.02], [deckZ + 0.15, deckY - 0.02], [deckZ - 0.18, deckY + 0.09]], W * 0.9, 0.02, C.white);
  if (cfg.spoiler >= 2) {
    const hgt = cfg.spoiler === 2 ? 0.22 : 0.38, ww = cfg.spoiler === 2 ? W * 0.9 : W * 1.02;
    for (const sx of [-1, 1]) trim.box(sx * W * 0.3, deckY + hgt / 2, deckZ - 0.05, 0.05, hgt, 0.14, C.trim);
    paint.extrude([[deckZ - 0.32, deckY + hgt], [deckZ + 0.08, deckY + hgt + 0.02], [deckZ + 0.06, deckY + hgt + 0.06], [deckZ - 0.3, deckY + hgt + 0.1]], ww, 0.015, C.white);
    if (cfg.spoiler === 3) for (const sx of [-1, 1]) trim.box(sx * ww / 2, deckY + hgt + 0.05, deckZ - 0.12, 0.02, 0.2, 0.4, C.trim);
  }
  if (cfg.stripes) {
    const lo = grow(P.lower, 0.012), ca = grow([...cabin.slice(0, 2), ...cabin.slice(2).map(([z, y]) => [z, y + 0.04])], 0.012);
    const xs = cfg.stripes === 1 ? [0] : [-0.2, 0.2], sw = cfg.stripes === 1 ? 0.32 : 0.16;
    for (const x of xs) { stripe.extrude(lo, sw, 0.005, C.white, x); if (!s.open) stripe.extrude(ca, sw, 0.005, C.white, x); }
  }
  // liveries (drawn in the livery colour)
  const lv = cfg.livery | 0;
  if (lv === 1 && !s.open) { // two-tone: roof + pillars
    for (let i = 0; i < roofLine.length - 1; i++) { const a = roofLine[i], b = roofLine[i + 1]; livery.extrude([[a[0] - 0.03, a[1] - 0.03], [b[0] + 0.03, b[1] - 0.03], [b[0] + 0.02, b[1] + 0.042], [a[0] - 0.02, a[1] + 0.042]], cabW + 0.045, 0.03, C.white); }
  }
  if (lv === 2 || lv === 3) for (const sx of [-1, 1]) { // side stripe at the shoulder line, following the body taper
    const ys = y0 + H * 0.62, zs0 = rz - s.wheelR * 0.4, zs1 = fz + s.wheelR * 0.4, n = 6;
    for (let i = 0; i < n; i++) { const za = zs0 + ((zs1 - zs0) * i) / n, zb = zs0 + ((zs1 - zs0) * (i + 1)) / n, zm = (za + zb) / 2; livery.box(sx * (hw(zm) + 0.006), ys, zm, 0.012, 0.09, zb - za + 0.01, C.white); }
  }
  if (lv === 3) for (const sx of [-1, 1]) { // racer: door roundels
    const zr = (fz + rz) / 2 + 0.1, yr = y0 + H * 0.4;
    trim.cylinder(sx * (hw(zr) + 0.01), yr, zr, 0.24, 0.012, 16, C.white, 'x', C.white);
    livery.cylinder(sx * (hw(zr) + 0.018), yr, zr, 0.17, 0.012, 16, C.white, 'x', C.white);
  }
  const wheel = buildWheel(cfg.rim | 0, s.wheelR, s.wheelW, fit('rimSize'));
  const mk = (g) => (g.p.length ? renderer.createMesh(g.build()) : null);
  return {
    paint: mk(paint), glass: mk(glass), trim: mk(trim), head: mk(head), tail: mk(tail), stripe: mk(stripe), livery: mk(livery),
    tire: renderer.createMesh(wheel.tire), rim: renderer.createMesh(wheel.rim),
    wheels: [[wx, wy, fz, 1, 0], [-wx, wy, fz, 1, 1], [wx, wy, rz, 0, 0], [-wx, wy, rz, 0, 1]],
    dims: { L: s.L, W, wheelR: s.wheelR, headY: hy, frontZ: z1, rearZ: z0, roofY: Math.max(roofY + (s.crown || 0), y1) },
  };
}

// Produce draw items for a car. state: {x,y,z,yaw,pitch,roll,steer,spin,brake,reverse}
const _m = new Float32Array(16), _w = new Float32Array(16);
export function carDrawItems(model, st, out) {
  const M = model.meshes;
  const base = mat4.compose(new Float32Array(16), st.x, st.y, st.z, st.yaw, st.pitch || 0, st.roll || 0);
  const bodyRoll = mat4.compose(_m, 0, 0, 0, 0, st.bodyPitch || 0, st.bodyRoll || 0);
  const body = mat4.multiply(new Float32Array(16), base, bodyRoll);
  out.push({ mesh: M.paint, matrix: body, tint: model.paint, spec: model.def.satin ? 0.3 : 0.9 }); // satin paint: soft highlights
  out.push(model.glassTint ? { mesh: M.glass, matrix: body, spec: 0.55, tint: model.glassTint } : { mesh: M.glass, matrix: body, spec: 0.55 });
  if (M.livery) out.push({ mesh: M.livery, matrix: body, tint: model.liveryCol, spec: 0.9 });
  out.push({ mesh: M.trim, matrix: body, spec: 0.1 });
  if (M.stripe) out.push({ mesh: M.stripe, matrix: body, tint: model.stripeCol, spec: 0.9 });
  const lt = model.lightTint, hb = st.lights ? [1.25, 1.2, 1.1] : [0.9, 0.9, 0.85];
  out.push({ mesh: M.head, matrix: body, emissive: 1, tint: lt ? [hb[0] * lt[0], hb[1] * lt[1], hb[2] * lt[2]] : hb });
  const braking = st.brake;
  out.push({ mesh: M.tail, matrix: body, emissive: 1, tint: st.reverse ? [1.3, 1.3, 1.3] : braking ? [1.6, 0.1, 0.08] : [0.55, 0.04, 0.04] });
  // Ackermann steering: st.steer is the average front-wheel angle; the inside wheel turns more
  // than the outside one (both wheels point around the same turning centre on the rear axle)
  const d0 = st.steer || 0, wb = M.wheels[0][2] - M.wheels[2][2], track = M.wheels[0][0] * 2;
  const R = Math.abs(d0) > 1e-3 ? wb / Math.tan(Math.abs(d0)) : 0;
  M.wheels.forEach(([x, y, z, front, left], i) => {
    // x > 0 is the car's left side; for a left turn (d0 > 0) that wheel is on the inside
    const inside = Math.sign(x) === Math.sign(d0);
    const steer = !front || !R ? (front ? d0 : 0) : Math.sign(d0) * Math.atan(wb / Math.max(0.5, R + (inside ? -track / 2 : track / 2)));
    const lift = st.wheelOffset ? st.wheelOffset[i] : 0; // suspension travel: wheels follow the ground
    const wm = mat4.compose(_w, x, y + lift, z, steer + (left ? Math.PI : 0), left ? -(st.spin || 0) : (st.spin || 0), 0);
    const mat = mat4.multiply(new Float32Array(16), base, wm);
    out.push({ mesh: M.tire, matrix: mat, spec: 0.05 });
    out.push({ mesh: M.rim, matrix: mat, tint: model.wheelCol, spec: 1.0 });
  });
}
