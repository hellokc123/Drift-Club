// Persistent settings (localStorage)
import { DEFAULT_BINDINGS } from './input.js';
import { defaultConfig, normalizeColors } from './cars.js';

const KEY = 'driftclub.settings.v1';

function guessQuality() {
  const mem = navigator.deviceMemory || 8, cores = navigator.hardwareConcurrency || 8;
  const ua = navigator.userAgent || '';
  if (/CrOS/.test(ua) || mem <= 4 || cores <= 4) return 'low';
  return 'medium';
}

export const DEFAULTS = {
  playerName: 'Driver' + Math.floor(100 + Math.random() * 900),
  quality: guessQuality(), renderScale: 1, showFps: false,
  master: 0.8, sfx: 0.8, music: 0.45,
  camView: 0, camDist: 1, camSmooth: 1, fov: 68, camShake: true,
  steerSens: 1, deadzone: 0.15, gamepad: true, units: 'kmh',
  driveStyle: 'drift', driftAngle: 62,
  bindings: JSON.parse(JSON.stringify(DEFAULT_BINDINGS)),
  car: defaultConfig('hatch'),
  serverUrl: '',
  bests: {},
  // minimap: on/off, size s|m|l, screen corner, rotating (player-up) or north-up, range auto|near|far|map
  garage: {}, // each car's own saved setup (looks + performance + tuning), by car id
  presets: {}, // your saved presets, by car id: [{ name, cfg }]
  minimap: { on: true, size: 'm', pos: 'bottom-right', orient: 'rotate', range: 'auto' },
};

export function loadSettings() {
  let s = {};
  try { s = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { s = {}; }
  const out = { ...JSON.parse(JSON.stringify(DEFAULTS)), ...s };
  out.bindings = { ...DEFAULT_BINDINGS, ...(s.bindings || {}) };
  out.car = normalizeColors({ ...defaultConfig(out.car && out.car.id), ...(s.car || {}) }); // old neon colours -> nearest normal ones
  out.minimap = { ...DEFAULTS.minimap, ...(s.minimap || {}) };
  return out;
}
export function saveSettings(s) { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* private mode */ } }
