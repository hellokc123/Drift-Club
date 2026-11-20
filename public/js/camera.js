// Chase / close chase / hood cameras. The chase yaw blends heading with the
// direction of travel so long drifts stay readable instead of whipping around.
import { damp, dampAngle, clamp, wrapAngle, smoothstep } from './engine/math.js';

export const VIEWS = [
  { name: 'Chase', dist: 7.2, height: 2.5, look: 1.4, travel: 0.55 },
  { name: 'Close Chase', dist: 4.9, height: 1.75, look: 1.1, travel: 0.45 },
  { name: 'Hood', hood: true },
];

export class CarCamera {
  constructor() { this.eye = [0, 5, -10]; this.target = [0, 0, 0]; this.yaw = 0; this.fov = 68; this.view = 0; this.init = false; this.shake = 0; }
  snap() { this.init = false; }
  update(dt, car, world, settings) {
    const V = VIEWS[this.view % VIEWS.length];
    const speed = car.speed, sm = settings.camSmooth || 1, dk = settings.camDist || 1;
    const velYaw = Math.atan2(car.vx, car.vz);
    const baseFov = settings.fov || 68;
    this.fov = damp(this.fov, baseFov + Math.min(14, speed * 0.22) + (car.boosting ? 6 : 0), 3, dt);
    if (V.hood) {
      const d = car.dims, sh = Math.sin(car.h), ch = Math.cos(car.h);
      const fwd = d.L * 0.08, up = (d.roofY || 1.3) - 0.12;
      this.eye = [car.x + sh * fwd, car.y + up, car.z + ch * fwd];
      this.target = [car.x + sh * 20, car.y + up - 0.9, car.z + ch * 20];
      this.yaw = car.h; this.init = false;
      return;
    }
    let goal = car.h;
    if (speed > 3) {
      // follow a blend of heading and travel direction; at big angles (360s, reverse drifts)
      // follow the travel direction fully so the view never whips around
      const rel = wrapAngle(velYaw - car.h);
      const big = smoothstep(0.9, 1.7, Math.abs(rel));
      const normalReverse = car.forwardSpeed < -2 && (car.mode || 'grip') === 'grip';
      goal = normalReverse ? car.h : car.h + rel * (V.travel + (1 - V.travel) * big);
    }
    if (!this.init) { this.yaw = goal; }
    this.yaw = dampAngle(this.yaw, goal, 4.2 * sm, dt);
    const dist = V.dist * dk * (1 + Math.min(0.18, speed * 0.003)), hgt = V.height * dk;
    const ex = car.x - Math.sin(this.yaw) * dist, ez = car.z - Math.cos(this.yaw) * dist;
    let ey = car.y + hgt;
    const gy = world.heightAt(ex, ez) + 0.6;
    if (ey < gy) ey = gy;
    if (!this.init) { this.eye = [ex, ey, ez]; this.init = true; }
    const k = 12 * sm;
    this.eye = [damp(this.eye[0], ex, k, dt), damp(this.eye[1], ey, k * 0.6, dt), damp(this.eye[2], ez, k, dt)];
    // keep a constant distance even while damping (prevents rubber banding at high speed)
    const dx = this.eye[0] - car.x, dz = this.eye[2] - car.z, dd = Math.hypot(dx, dz) || 1;
    const want = clamp(dd, dist * 0.85, dist * 1.12);
    this.eye[0] = car.x + (dx / dd) * want; this.eye[2] = car.z + (dz / dd) * want;
    this.target = [car.x + Math.sin(this.yaw) * V.look * 2, car.y + V.look, car.z + Math.cos(this.yaw) * V.look * 2];
    // camera shake: pick a new random offset ~30 times a second and glide toward it, so the shake
    // looks the same at 60 Hz and 144 Hz (a new random jump every frame would shake harder on fast screens)
    if (this.shake > 0 && settings.camShake) {
      this.shake = Math.max(0, this.shake - dt * 3);
      this.shakeT = (this.shakeT || 0) - dt;
      if (this.shakeT <= 0) { this.shakeT = 1 / 30; this.shakeGoal = [Math.random() - 0.5, Math.random() - 0.5]; }
      const g = this.shakeGoal || [0, 0], o = this.shakeOff || [0, 0];
      this.shakeOff = [damp(o[0], g[0], 40, dt), damp(o[1], g[1], 40, dt)];
      const s = this.shake * 0.25;
      this.eye[0] += this.shakeOff[0] * s; this.eye[1] += this.shakeOff[1] * s;
    } else this.shakeOff = [0, 0];
  }
}
