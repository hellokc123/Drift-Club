// Tyre smoke / dust particles, skid marks, car shadows, headlight beams, underglow.
import { FxBuffer } from './engine/renderer.js';

const QUAL = { low: { p: 160, s: 700 }, medium: { p: 340, s: 1600 }, high: { p: 620, s: 3200 } };

export class Effects {
  constructor(renderer, world, quality = 'medium') {
    const q = QUAL[quality] || QUAL.medium;
    this.r = renderer; this.world = world;
    this.maxP = q.p; this.parts = [];
    this.smoke = new FxBuffer(renderer, q.p * 6, false);
    this.maxSkid = q.s; this.skidHead = 0; this.skidUsed = 0;
    this.skid = new FxBuffer(renderer, q.s * 6, false);
    this.dyn = new FxBuffer(renderer, 6000, false);
    this.add = new FxBuffer(renderer, 6000, true);
    this.marks = new Map();
  }
  get buffers() { return [this.skid, this.dyn, this.smoke, this.add]; }

  emit(x, y, z, vx, vy, vz, col, size, life, grow) {
    if (this.parts.length >= this.maxP) this.parts.shift();
    this.parts.push({ x, y, z, vx, vy, vz, col, size, life, max: life, grow });
  }

  // continuous skid strip per wheel key
  skidAt(key, x, z, col, width = 0.26) {
    const y = this.world.heightAt(x, z) + 0.05;
    const last = this.marks.get(key);
    this.marks.set(key, [x, y, z]);
    if (!last) return;
    const dx = x - last[0], dz = z - last[2], l = Math.hypot(dx, dz);
    if (l < 0.05) { this.marks.set(key, last); return; }
    if (l > 3) return;
    const px = (-dz / l) * width / 2, pz = (dx / l) * width / 2;
    const i = this.skidHead * 6, d = this.skid.data;
    const v = [[last[0] - px, last[1], last[2] - pz], [x - px, y, z - pz], [x + px, y, z + pz], [last[0] + px, last[1], last[2] + pz]];
    let o = i * 9;
    for (const k of [0, 1, 2, 0, 2, 3]) { const p = v[k]; d[o++] = p[0]; d[o++] = p[1]; d[o++] = p[2]; d[o++] = col[0]; d[o++] = col[1]; d[o++] = col[2]; d[o++] = col[3]; d[o++] = 0; d[o++] = 0; }
    this.skid.markDirty(i, i + 6);
    this.skidHead = (this.skidHead + 1) % this.maxSkid;
    this.skidUsed = Math.min(this.maxSkid, this.skidUsed + 1);
    this.skid.count = this.skidUsed * 6;
  }
  breakSkid(key) { this.marks.delete(key); }

  // per-frame buffers
  begin() { this.dyn.count = 0; this.add.count = 0; }
  _push(buf, x, y, z, c, u, v) {
    if (buf.count >= buf.max) return;
    const o = buf.count * 9, d = buf.data;
    d[o] = x; d[o + 1] = y; d[o + 2] = z; d[o + 3] = c[0]; d[o + 4] = c[1]; d[o + 5] = c[2]; d[o + 6] = c[3]; d[o + 7] = u; d[o + 8] = v;
    buf.count++;
  }
  _finish(buf) { if (buf.count) buf.markDirty(0, buf.count); }
  ellipse(buf, x, y, z, yaw, rx, rz, c, seg = 14) {
    const s = Math.sin(yaw), co = Math.cos(yaw);
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
      const P = (a) => { const lx = Math.cos(a) * rx, lz = Math.sin(a) * rz; return [x + lx * co + lz * s, z - lx * s + lz * co]; };
      const p0 = P(a0), p1 = P(a1);
      this._push(buf, x, y, z, c, 0, 0);
      this._push(buf, p1[0], y, p1[1], c, Math.cos(a1), Math.sin(a1));
      this._push(buf, p0[0], y, p0[1], c, Math.cos(a0), Math.sin(a0));
    }
  }
  carShadow(x, y, z, yaw, L, W) { this.ellipse(this.dyn, x, y + 0.06, z, yaw, W * 0.72, L * 0.62, [0, 0, 0, 0.55]); }
  underglow(x, y, z, yaw, L, W, c) { this.ellipse(this.add, x, y + 0.07, z, yaw, W * 1.1, L * 0.75, [c[0] * 0.7, c[1] * 0.7, c[2] * 0.7, 1]); }
  // light cone from (x,y,z) toward heading
  beam(x, y, z, yaw, len = 26, spread = 7, strength = 0.11, c = [1, 0.95, 0.8]) {
    const fx = Math.sin(yaw), fz = Math.cos(yaw), rx = -fz, rz = fx;
    const bx = x + fx * len, bz = z + fz * len, by = this.world.heightAt(bx, bz) + 0.4;
    const seg = 6, col = [c[0] * strength, c[1] * strength, c[2] * strength, 1];
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
      const P = (a) => [bx + rx * Math.cos(a) * spread, by + Math.sin(a) * spread * 0.35 + spread * 0.2, bz + rz * Math.cos(a) * spread];
      const p0 = P(a0), p1 = P(a1);
      this._push(this.add, x, y, z, col, 0, 0);
      this._push(this.add, p0[0], p0[1], p0[2], col, 0, 1);
      this._push(this.add, p1[0], p1[1], p1[2], col, 0, 1);
    }
  }
  flame(x, y, z, size, c) { this.billboardInto(this.add, x, y, z, size, c); }
  billboardInto(buf, x, y, z, s, c) {
    const v = this.r.view; const rx = v[0] * s, ry = v[4] * s, rz = v[8] * s, ux = v[1] * s, uy = v[5] * s, uz = v[9] * s;
    const A = [x - rx - ux, y - ry - uy, z - rz - uz], B = [x + rx - ux, y + ry - uy, z + rz - uz], C = [x + rx + ux, y + ry + uy, z + rz + uz], D = [x - rx + ux, y - ry + uy, z - rz + uz];
    this._push(buf, ...A, c, -1, -1); this._push(buf, ...B, c, 1, -1); this._push(buf, ...C, c, 1, 1);
    this._push(buf, ...A, c, -1, -1); this._push(buf, ...C, c, 1, 1); this._push(buf, ...D, c, -1, 1);
  }

  update(dt) {
    // particles
    const P = this.parts;
    for (let i = P.length - 1; i >= 0; i--) {
      const p = P[i]; p.life -= dt;
      if (p.life <= 0) { P.splice(i, 1); continue; }
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      p.vx *= 1 - dt * 1.2; p.vz *= 1 - dt * 1.2; p.vy *= 1 - dt * 0.6;
      p.size += p.grow * dt;
    }
    this.smoke.count = 0;
    const cam = this.r.camPos;
    for (const p of P) {
      const t = p.life / p.max;
      // fade particles that are close to the camera so smoke never blinds the player
      const dc = Math.hypot(p.x - cam[0], p.y - cam[1], p.z - cam[2]);
      const near = Math.min(1, Math.max(0, (dc - p.size - 1) / 5));
      const a = p.col[3] * Math.min(1, t * 1.6) * Math.min(1, (1 - t) * 8 + 0.2) * near;
      if (a < 0.004) continue;
      this.billboardInto(this.smoke, p.x, p.y, p.z, p.size, [p.col[0], p.col[1], p.col[2], a]);
    }
    this._finish(this.smoke); this._finish(this.dyn); this._finish(this.add);
  }

  dispose() { [this.smoke, this.skid, this.dyn, this.add].forEach((b) => b.dispose()); }
}
