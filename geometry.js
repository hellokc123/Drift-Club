// Geometry builder: accumulates flat-shaded triangles with vertex colours.
// Colours are [r,g,b] or [r,g,b,emissive].
import { mat4 } from './math.js';

export class Geo {
  constructor() { this.p = []; this.n = []; this.c = []; this.m = null; }
  get vertexCount() { return this.p.length / 3; }
  setTransform(m) { this.m = m; return this; }
  // transform helper: position + yaw + uniform/non-uniform scale
  at(x, y, z, yaw = 0, sx = 1, sy = 1, sz = 1, pitch = 0, roll = 0) { this.m = mat4.compose(new Float32Array(16), x, y, z, yaw, pitch, roll, sx, sy, sz); return this; }
  reset() { this.m = null; return this; }

  tri(a, b, c, col) {
    if (this.m) {
      a = mat4.transformPoint(this.m, a[0], a[1], a[2]);
      b = mat4.transformPoint(this.m, b[0], b[1], b[2]);
      c = mat4.transformPoint(this.m, c[0], c[1], c[2]);
    }
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    this.p.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
    this.n.push(nx, ny, nz, nx, ny, nz, nx, ny, nz);
    const e = col.length > 3 ? col[3] : 0;
    for (let i = 0; i < 3; i++) this.c.push(col[0], col[1], col[2], e);
    return this;
  }
  // triangle with per-vertex colours and given (smooth) normals — used by terrain
  triRaw(a, b, c, ca, cb, cc) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    this.p.push(...a, ...b, ...c);
    this.n.push(nx, ny, nz, nx, ny, nz, nx, ny, nz);
    this.c.push(ca[0], ca[1], ca[2], ca[3] || 0, cb[0], cb[1], cb[2], cb[3] || 0, cc[0], cc[1], cc[2], cc[3] || 0);
    return this;
  }
  quad(a, b, c, d, col) { this.tri(a, b, c, col); this.tri(a, c, d, col); return this; }

  // axis aligned box centred at (x,y,z) in local space; cols = one colour or {top,side,bottom}
  box(x, y, z, w, h, d, col) {
    const x0 = x - w / 2, x1 = x + w / 2, y0 = y - h / 2, y1 = y + h / 2, z0 = z - d / 2, z1 = z + d / 2;
    const top = col.top || col, side = col.side || col, bottom = col.bottom || side, front = col.front || side, back = col.back || side;
    this.quad([x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0], top);
    if (!col.noBottom) this.quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], bottom);
    this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], front);
    this.quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], back);
    this.quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], side);
    this.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], side);
    return this;
  }

  // Extrude a convex side profile (points [z,y], counter-clockwise when viewed from +x)
  // across the X axis with bevelled edges for a smoother car-body look.
  // wf (optional): plan-view width multiplier wf(z, y) -> 0..1, used to taper car bodies
  extrude(profile, width, bevel, col, x0 = 0, wf = null) {
    let cz = 0, cy = 0; profile.forEach((p) => { cz += p[0]; cy += p[1]; }); cz /= profile.length; cy /= profile.length;
    const shrink = profile.map(([z, y]) => { const dz = z - cz, dy = y - cy, l = Math.hypot(dz, dy) || 1; const k = Math.min(bevel, l * 0.5) / l; return [z - dz * k, y - dy * k]; });
    const hw = width / 2, f = wf || (() => 1);
    const rings = [
      shrink.map(([z, y]) => [x0 - hw * f(z, y), y, z]), profile.map(([z, y]) => [x0 - (hw - bevel) * f(z, y), y, z]),
      profile.map(([z, y]) => [x0 + (hw - bevel) * f(z, y), y, z]), shrink.map(([z, y]) => [x0 + hw * f(z, y), y, z]),
    ];
    const n = profile.length;
    for (let r = 0; r < 3; r++) for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      this.quad(rings[r][i], rings[r + 1][i], rings[r + 1][j], rings[r][j], col);
    }
    for (let i = 1; i < n - 1; i++) { this.tri(rings[3][0], rings[3][i + 1], rings[3][i], col); this.tri(rings[0][0], rings[0][i], rings[0][i + 1], col); }
    return this;
  }

  // Cylinder along X axis (wheels) or Y axis (trunks)
  cylinder(x, y, z, r, len, seg, col, axis = 'y', capCol, r2) {
    const rt = r2 === undefined ? r : r2;
    const P = (a, h, rr) => {
      const c = Math.cos(a) * rr, s = Math.sin(a) * rr;
      return axis === 'y' ? [x + c, y + h, z + s] : axis === 'x' ? [x + h, y + c, z + s] : [x + c, y + s, z + h];
    };
    const h0 = -len / 2, h1 = len / 2;
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
      const A = P(a0, h0, r), B = P(a1, h0, r), C = P(a1, h1, rt), D = P(a0, h1, rt);
      if (axis === 'y') this.quad(A, D, C, B, col); else this.quad(A, B, C, D, col);
      const cc = capCol || col;
      const c0 = axis === 'y' ? [x, y + h0, z] : axis === 'x' ? [x + h0, y, z] : [x, y, z + h0];
      const c1 = axis === 'y' ? [x, y + h1, z] : axis === 'x' ? [x + h1, y, z] : [x, y, z + h1];
      if (axis === 'y') { this.tri(c1, C, D, cc); this.tri(c0, A, B, cc); }
      else { this.tri(c1, D, C, cc); this.tri(c0, B, A, cc); }
    }
    return this;
  }
  cone(x, y, z, r, h, seg, col) {
    const top = [x, y + h, z];
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
      const A = [x + Math.cos(a0) * r, y, z + Math.sin(a0) * r], B = [x + Math.cos(a1) * r, y, z + Math.sin(a1) * r];
      this.tri(A, top, B, col);
    }
    return this;
  }
  // low-poly blob (octahedron subdivided once, jittered)
  blob(x, y, z, rx, ry, rz, col, jitter = 0, rand = Math.random) {
    const v = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
    const f = [[0, 2, 4], [4, 2, 1], [1, 2, 5], [5, 2, 0], [4, 3, 0], [1, 3, 4], [5, 3, 1], [0, 3, 5]];
    const cache = new Map();
    const norm = (a) => { const l = Math.hypot(...a); return a.map((q) => q / l); };
    const mid = (i, j) => { const k = i < j ? `${i}_${j}` : `${j}_${i}`; if (!cache.has(k)) { v.push(norm([(v[i][0] + v[j][0]) / 2, (v[i][1] + v[j][1]) / 2, (v[i][2] + v[j][2]) / 2])); cache.set(k, v.length - 1); } return cache.get(k); };
    const faces = [];
    for (const [a, b, c] of f) { const ab = mid(a, b), bc = mid(b, c), ca = mid(c, a); faces.push([a, ab, ca], [ab, b, bc], [ca, bc, c], [ab, bc, ca]); }
    const pts = v.map((p) => { const j = 1 + (rand() - 0.5) * jitter; return [x + p[0] * rx * j, y + p[1] * ry * j, z + p[2] * rz * j]; });
    for (const [a, b, c] of faces) this.tri(pts[a], pts[b], pts[c], col);
    return this;
  }
  // flat disc / ring lying on ground (normal up)
  disc(x, y, z, r, seg, col) {
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
      this.tri([x, y, z], [x + Math.cos(a1) * r, y, z + Math.sin(a1) * r], [x + Math.cos(a0) * r, y, z + Math.sin(a0) * r], col);
    }
    return this;
  }
  append(g) { this.p.push(...g.p); this.n.push(...g.n); this.c.push(...g.c); return this; }
  build() { return { pos: new Float32Array(this.p), nrm: new Float32Array(this.n), col: new Float32Array(this.c) }; }
}

// Splits static world geometry into spatial chunks for frustum culling.
export class ChunkBatcher {
  constructor(size = 160) { this.size = size; this.chunks = new Map(); }
  geo(x, z) {
    const k = `${Math.floor(x / this.size)},${Math.floor(z / this.size)}`;
    let g = this.chunks.get(k); if (!g) { g = new Geo(); this.chunks.set(k, g); }
    return g;
  }
  build(renderer) {
    const out = [];
    for (const g of this.chunks.values()) {
      if (!g.p.length) continue;
      // split very big chunks so buffers stay modest
      out.push({ mesh: renderer.createMesh(g.build()) });
    }
    return out;
  }
}
