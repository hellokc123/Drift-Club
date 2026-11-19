// Animated 3D showroom behind the menus and garage.
import { Geo } from './engine/geometry.js';
import { FxBuffer } from './engine/renderer.js';
import { buildCarModel, carDrawItems } from './cars.js';

const ENV = {
  sky: { top: [0.02, 0.025, 0.06], horizon: [0.1, 0.07, 0.18], bottom: [0.03, 0.03, 0.05] },
  sunDir: norm([0.4, 0.75, 0.6]), sunCol: [1.05, 1.0, 0.95], sunGlow: [0, 0, 0], ambSky: [0.42, 0.42, 0.55], ambGround: [0.12, 0.1, 0.16],
  fogCol: [0.05, 0.04, 0.09], fogNear: 25, fogFar: 90, stars: 0.6,
};

export class Showroom {
  constructor(app) {
    this.app = app; this.t = 0; this.yaw = 0.6;
    const R = app.renderer;
    const g = new Geo();
    g.disc(0, 0, 0, 80, 48, [0.07, 0.07, 0.09]);
    g.cylinder(0, 0.12, 0, 4.4, 0.24, 40, [0.13, 0.13, 0.15], 'y');
    g.cylinder(0, 0.13, 0, 4.5, 0.08, 40, [0.1, 0.9, 1.0, 1], 'y');
    // background light bars
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2, r = 26;
      g.at(Math.cos(a) * r, 0, Math.sin(a) * r, -a + Math.PI / 2).box(0, 4, 0, 0.4, 8, 0.4, [0.6, 0.2, 1, 1]).box(0, 0.05, 0, 3, 0.1, 3, [0.08, 0.08, 0.1]).reset();
    }
    this.static = [{ mesh: R.createMesh(g.build()), cull: false }];
    // floor glow rings (additive)
    const arr = [];
    const ring = (r0, r1, c, seg = 64) => {
      for (let i = 0; i < seg; i++) {
        const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
        const P = (a, r) => [Math.cos(a) * r, 0.02, Math.sin(a) * r];
        for (const [p, u] of [[P(a0, r0), 0], [P(a0, r1), 1], [P(a1, r1), 1], [P(a0, r0), 0], [P(a1, r1), 1], [P(a1, r0), 0]]) arr.push(...p, ...c, 0, u);
      }
    };
    ring(4.5, 9, [0.03, 0.18, 0.24, 1]);
    ring(14, 14.4, [0.4, 0.1, 0.5, 1]);
    ring(20, 20.3, [0.1, 0.3, 0.6, 1]);
    for (let i = 0; i < 14; i++) { const a = (i / 14) * Math.PI * 2; const x = Math.cos(a) * 26, z = Math.sin(a) * 26; for (let k = 0; k < 16; k++) { const a0 = (k / 16) * 6.283, a1 = ((k + 1) / 16) * 6.283; arr.push(x, 0.03, z, 0.35, 0.12, 0.6, 1, 0, 0, x + Math.cos(a1) * 5, 0.03, z + Math.sin(a1) * 5, 0.35, 0.12, 0.6, 1, Math.cos(a1), Math.sin(a1), x + Math.cos(a0) * 5, 0.03, z + Math.sin(a0) * 5, 0.35, 0.12, 0.6, 1, Math.cos(a0), Math.sin(a0)); } }
    this.glow = new FxBuffer(R, arr.length / 9, true); this.glow.data.set(arr); this.glow.count = arr.length / 9; this.glow.markDirty(0, this.glow.count);
    this.shadow = new FxBuffer(R, 64, false);
    this.setCar(app.settings.car);
    // drag the car (empty space between the garage panels) to rotate it; it resumes spinning after a moment
    this.holdT = 0;
    const scr = document.getElementById('scr-garage');
    if (scr) {
      let drag = null;
      scr.addEventListener('pointerdown', (e) => { if (e.target !== scr) return; drag = e.clientX; this.holdT = 1e9; scr.setPointerCapture(e.pointerId); scr.classList.add('dragging'); });
      scr.addEventListener('pointermove', (e) => { if (drag === null) return; this.yaw += (e.clientX - drag) * 0.012; drag = e.clientX; });
      const up = () => { if (drag === null) return; drag = null; this.holdT = 2.5; scr.classList.remove('dragging'); };
      scr.addEventListener('pointerup', up); scr.addEventListener('pointercancel', up);
    }
  }
  setCar(cfg) { this.model = buildCarModel(this.app.renderer, cfg); this.pop = 0.25; }
  frame(dt, screen) {
    this.t += dt; this.pop = Math.max(0, this.pop - dt);
    const R = this.app.renderer;
    const garage = screen === 'garage';
    this.holdT = Math.max(0, this.holdT - dt);
    if (this.holdT <= 0) this.yaw += dt * (garage ? 0.35 : 0.18);
    const camA = this.t * 0.05 + 0.9, rad = garage ? 11 : 12, h = garage ? 2.6 : 3.0;
    const eye = [Math.sin(camA) * rad, h + Math.sin(this.t * 0.3) * 0.25, Math.cos(camA) * rad];
    // put the car off-centre so the menu panel doesn't cover it
    const side = garage ? -0.3 : -3.4;
    const rx = Math.cos(camA), rz = -Math.sin(camA);
    const target = [rx * side, 0.7, rz * side];
    R.setCamera(eye, target, (garage ? 40 : 42) * Math.PI / 180, 0.3, 200);
    const items = [...this.static];
    const bounce = Math.sin(this.pop * 25) * this.pop * 0.3;
    carDrawItems(this.model, { x: 0, y: 0.24 + bounce, z: 0, yaw: this.yaw, spin: 0, steer: Math.sin(this.t * 0.6) * 0.15, lights: true }, items);
    // contact shadow
    const s = this.shadow; s.count = 0; const d = this.model.meshes.dims; const arr = [];
    for (let i = 0; i < 16; i++) { const a0 = (i / 16) * 6.283, a1 = ((i + 1) / 16) * 6.283; const P = (a) => { const lx = Math.cos(a) * d.W * 0.7, lz = Math.sin(a) * d.L * 0.6; return [lx * Math.cos(this.yaw) + lz * Math.sin(this.yaw), 0.255, -lx * Math.sin(this.yaw) + lz * Math.cos(this.yaw)]; }; arr.push(0, 0.255, 0, 0, 0, 0, 0.6, 0, 0, ...P(a1), 0, 0, 0, 0.6, Math.cos(a1), Math.sin(a1), ...P(a0), 0, 0, 0, 0.6, Math.cos(a0), Math.sin(a0)); }
    s.data.set(arr); s.count = arr.length / 9; s.markDirty(0, s.count);
    R.render(ENV, items, [s, this.glow], null);
  }
}
function norm(v) { const l = Math.hypot(...v); return v.map((x) => x / l); }
