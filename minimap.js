// Real-time minimap.
// The background is rendered once per map straight from the World's own data — the same heightfield,
// road distance field, surface types, water level and collision walls the physics uses — so it can't
// drift out of sync with the 3D world. Markers are drawn every frame from live positions: your car,
// other players (from the existing position sync; no extra network traffic), CPU racers, the
// solo-battle ghost, and the mode's overlays (race line, next checkpoint, battle course, drift-area
// boundary).
import { OFF_TRACK_MARGIN, TrackGeo } from './tracks.js';

export const MINIMAP_SIZES = { s: 140, m: 180, l: 240 };
export const MINIMAP_POS = ['bottom-right', 'top-right', 'top-left', 'bottom-left'];
export const MINIMAP_RANGES = { auto: 'Auto', near: 'Near', far: 'Far', map: 'Whole map' };
const PALETTE = ['#ff006e', '#3a86ff', '#ffbe0b', '#80ffdb', '#ff7b00', '#c77dff', '#06d6a0', '#ef476f'];
const NAT = { grass: [62, 96, 50], sand: [176, 146, 98], dirt: [104, 86, 62], asphalt: [44, 46, 54] };
const PAVE = { asphalt: [150, 154, 166], gravel: [150, 132, 104], salt: [222, 222, 214], kerb: [190, 80, 80] };

export class Minimap {
  constructor(game) {
    this.g = game; this.world = game.world;
    this.el = document.getElementById('minimap');
    this.cv = this.el.querySelector('canvas');
    this.ctx = this.cv.getContext('2d');
    this.colors = new Map();
    this.buildBase();
    this.applySettings();
    this.viewR = 160;
  }

  // ------------------------------------------------------------- static background
  buildBase() {
    const W = this.world, size = W.size, half = size / 2;
    const res = Math.min(0.8, 1100 / size); // px per metre
    const n = Math.ceil(size * res);
    this.res = res; this.half = half; this.n = n;
    const cv = document.createElement('canvas'); cv.width = cv.height = n;
    const ctx = cv.getContext('2d'), img = ctx.createImageData(n, n), d = img.data;
    const nat = NAT[W.spec.natural] || NAT.grass, water = W.waterY;
    let i = 0;
    for (let v = 0; v < n; v++) {
      for (let u = 0; u < n; u++, i += 4) {
        const [x, z] = this.toWorld(u + 0.5, v + 0.5);
        const h = W.heightAt(x, z), sd = W.sdAt(x, z);
        // hill shading from the real heightfield (light from the top-left of the map)
        const gx = W.heightAt(x - 2, z) - W.heightAt(x + 2, z), gz = W.heightAt(x, z + 2) - W.heightAt(x, z - 2);
        const shade = Math.max(0.55, Math.min(1.35, 1 + (gx * 0.6 - gz * 0.6) * 0.18));
        let c;
        const s = W.surfaceAt(x, z);
        if (h < water - 0.25) c = [52, 104, 150];
        else if (sd < 0) c = s.dust ? (s.grip > 0.85 ? PAVE.salt : PAVE.gravel) : PAVE.asphalt;
        else if (s.rumble === 1) c = PAVE.kerb;
        else if (W.spec.color) { const t = W.spec.color(x, z, h, Math.hypot(gx, gz) / 4, sd); c = [t[0] * 255, t[1] * 255, t[2] * 255]; } // same colouring as the 3D terrain
        else c = nat;
        const k = sd < 0 ? 1 : shade;
        d[i] = Math.min(255, c[0] * k); d[i + 1] = Math.min(255, c[1] * k); d[i + 2] = Math.min(255, c[2] * k); d[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    // walls, barriers, buildings (the actual collision geometry)
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(20,20,28,0.85)'; ctx.lineWidth = Math.max(1, 1.2 * res * 2);
    ctx.beginPath();
    for (const [ax, az, bx, bz] of W.segments) { const [u0, v0] = this.toPx(ax, az), [u1, v1] = this.toPx(bx, bz); ctx.moveTo(u0, v0); ctx.lineTo(u1, v1); }
    ctx.stroke();
    ctx.fillStyle = 'rgba(16,30,16,0.55)';
    for (const [x, z, r] of W.circles) { if (r > 6) continue; const [u, v] = this.toPx(x, z); ctx.fillRect(u - 0.8, v - 0.8, 1.6, 1.6); }
    this.base = cv;
    this.overlay = null; // mode overlay drawn on demand (needs the competitive controller)
  }

  // mode overlays: race line + start, battle course, drift-area boundary
  buildOverlay() {
    const comp = this.g.comp, cv = document.createElement('canvas'); cv.width = cv.height = this.n;
    const ctx = cv.getContext('2d'), res = this.res;
    const line = (pts, closed, style, width, dash) => {
      ctx.beginPath(); pts.forEach((p, i) => { const [u, v] = this.toPx(p[0], p[1]); i ? ctx.lineTo(u, v) : ctx.moveTo(u, v); });
      if (closed) ctx.closePath(); ctx.setLineDash(dash || []); ctx.strokeStyle = style; ctx.lineWidth = width; ctx.stroke(); ctx.setLineDash([]);
    };
    const gateLine = (gt, style, w) => {
      const [u0, v0] = this.toPx(gt.x + gt.nx * gt.hw, gt.z + gt.nz * gt.hw), [u1, v1] = this.toPx(gt.x - gt.nx * gt.hw, gt.z - gt.nz * gt.hw);
      ctx.beginPath(); ctx.moveTo(u0, v0); ctx.lineTo(u1, v1); ctx.strokeStyle = style; ctx.lineWidth = w; ctx.stroke();
    };
    if (comp && comp.route) { // Speed Race: the official racing line and the start/finish line
      const P = comp.route.path;
      const pts = []; for (let i = 0; i < P.n; i += 2) pts.push([P.x[i], P.z[i]]);
      line(pts, true, 'rgba(255,255,255,0.9)', Math.max(2, 3 * res * 2));
      line(pts, true, 'rgba(0,229,255,0.9)', Math.max(1, 1.2 * res * 2));
      this.gateGeom(comp.route.gates).slice(0, 1).forEach((gt) => gateLine(gt, '#fff', 4));
      // direction chevrons every ~120 m so the driving direction is obvious
      for (let i = 20; i < P.n; i += 40) {
        const j = (i + 2) % P.n, a = Math.atan2(P.x[j] - P.x[i], P.z[j] - P.z[i]);
        this.chevron(ctx, P.x[i], P.z[i], a, 7, 'rgba(0,229,255,1)');
      }
    } else if (comp && comp.course) { // Drift Battle course
      const C = comp.course, P = C.path, pts = []; for (let i = 0; i < P.n; i++) pts.push([P.x[i], P.z[i]]);
      line(pts, false, 'rgba(255,190,11,0.55)', Math.max(4, C.width * res));
      line(pts, false, 'rgba(255,255,255,0.85)', 1.5, [6, 5]);
      for (const [gt, col] of [[C.start, '#06d6a0'], [C.end, '#ff006e']]) if (gt) gateLine(this.gateGeom([{ ...gt, hw: C.width / 2 + 3 }])[0], col, 4);
    }
    if (comp && comp.judge && this.g.opts.mapId !== 'city') { // Drift Challenge: the judged drift area (tarmac + margin)
      const T = new TrackGeo(this.g.opts.mapId), W = this.world, n = this.n;
      if (!T.open) {
        const img = ctx.getImageData(0, 0, n, n), d = img.data, step = 1;
        const m = OFF_TRACK_MARGIN, band = 0.9 / res;
        for (let v = 0; v < n; v += step) for (let u = 0; u < n; u += step) {
          const [x, z] = this.toWorld(u + 0.5, v + 0.5);
          const sd = W.sdAt(x, z); if (sd < m - 3 || sd > m + 4) continue; // cheap pre-filter
          const e = T.edge(x, z);
          if (Math.abs(e - m) < band) { const i = (v * n + u) * 4; d[i] = 255; d[i + 1] = 214; d[i + 2] = 10; d[i + 3] = 235; }
        }
        ctx.putImageData(img, 0, 0);
      }
    }
    this.overlay = cv;
  }
  gateGeom(gates) {
    return gates.map((g) => {
      const tx = g.tx !== undefined ? g.tx : g.dx, tz = g.tz !== undefined ? g.tz : g.dz;
      return { x: g.x, z: g.z, nx: tz || 0, nz: -(tx || 0), hw: g.hw || 10 };
    });
  }
  chevron(ctx, x, z, a, s, col) {
    const [u, v] = this.toPx(x, z), sa = -Math.sin(a), ca = -Math.cos(a); // screen direction of travel (mirror-correct, see toPx)
    ctx.beginPath(); ctx.moveTo(u + sa * s, v + ca * s); ctx.lineTo(u - sa * s * 0.6 + ca * s * 0.6, v - ca * s * 0.6 - sa * s * 0.6);
    ctx.lineTo(u - sa * s * 0.6 - ca * s * 0.6, v - ca * s * 0.6 + sa * s * 0.6); ctx.closePath(); ctx.fillStyle = col; ctx.fill();
  }

  // World (x, z) -> background pixel. Screen up = world +z; screen right = world -x, which matches
  // the 3D view (looking along +z, +x is on your left), so turns go the same way on the map.
  toPx(x, z) { return [(this.half - x) * this.res, (this.half - z) * this.res]; }
  toWorld(u, v) { return [this.half - u / this.res, this.half - v / this.res]; }

  applySettings() {
    const S = this.g.app.settings, mm = S.minimap || {};
    this.on = mm.on !== false; this.rotate = mm.orient !== 'north'; this.range = mm.range || 'auto';
    const px = MINIMAP_SIZES[mm.size] || MINIMAP_SIZES.m, dpr = Math.min(2, window.devicePixelRatio || 1);
    this.px = px; this.cv.width = this.cv.height = Math.round(px * dpr); this.dpr = dpr;
    this.cv.style.width = this.cv.style.height = `${px}px`;
    this.el.className = `mm-${MINIMAP_POS.includes(mm.pos) ? mm.pos : 'bottom-right'}`;
    this.el.classList.toggle('hidden', !this.on);
    document.getElementById('hud').dataset.mm = this.on ? (MINIMAP_POS.includes(mm.pos) ? mm.pos : 'bottom-right') : '';
    document.getElementById('hud').style.setProperty('--mm', `${px}px`);
  }

  color(id) {
    if (!this.colors.has(id)) this.colors.set(id, PALETTE[this.colors.size % PALETTE.length]);
    return this.colors.get(id);
  }

  // what to show this frame: [{x,z,h,col,label,kind}]
  markers() {
    const g = this.g, out = [], comp = g.comp;
    const battle = comp && comp.course;
    const roleOf = (id) => (battle && comp.leadId !== undefined ? (id === comp.leadId ? 'lead' : id === comp.chaseId ? 'chase' : null) : null);
    for (const r of g.remotes.values()) {
      if (!r.seen || !r.model || r.away) continue; // only connected players who are driving (a dropped player disappears at once)
      const role = roleOf(r.id);
      out.push({ x: r.x, z: r.z, h: r.h, col: role === 'lead' ? '#ffbe0b' : role === 'chase' ? '#00e5ff' : this.color(r.id), label: role === 'lead' ? 'L' : role === 'chase' ? 'C' : (r.name || '?')[0].toUpperCase(), kind: 'player', name: r.name });
    }
    if (comp && comp.ai) comp.ai.forEach((a, i) => out.push({ x: a.v.x, z: a.v.z, h: a.v.h, col: '#8d99ae', label: String(i + 1), kind: 'cpu', name: a.name }));
    if (battle && !comp.mp && comp.role === 'chase' && comp.ghost && comp.ghost.length) {
      const gs = comp.ghostAt(Math.max(0, comp.t || 0)) || comp.ghost[0].s;
      if (gs) out.push({ x: gs.x, z: gs.z, h: gs.h, col: '#9fe6ff', label: 'L', kind: 'ghost', name: 'Ghost' });
    }
    return out;
  }

  me() {
    const g = this.g;
    if (g.spectator) { const t = g.specTarget && g.specTarget(); return t ? { x: t.x, z: t.z, h: t.h, speed: t.speed || 0, spec: true } : null; }
    const c = g.car; return { x: c.x, z: c.z, h: c.h, speed: c.speed };
  }

  // circuit / course extents for the "whole circuit" view
  extents() {
    const comp = this.g.comp, P = comp && (comp.route ? comp.route.path : comp.course ? comp.course.path : null);
    if (!P) return null;
    let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
    for (let i = 0; i < P.n; i++) { x0 = Math.min(x0, P.x[i]); x1 = Math.max(x1, P.x[i]); z0 = Math.min(z0, P.z[i]); z1 = Math.max(z1, P.z[i]); }
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2; let r = 0;
    for (let i = 0; i < P.n; i++) r = Math.max(r, Math.hypot(P.x[i] - cx, P.z[i] - cz)); // fits inside the round map
    return { cx, cz, r: r + 22 };
  }

  draw(dt) {
    if (!this.on || this.g.hudHidden) return;
    if (!this.overlay && (!this.g.mode.comp || this.g.comp)) this.buildOverlay();
    const me = this.me(); if (!me) return;
    const ctx = this.ctx, px = this.px, dpr = this.dpr, R = px / 2;
    // view range (metres from centre to edge)
    let cx = me.x, cz = me.z, want;
    const ext = this.extents();
    if (this.range === 'map') { want = this.half; cx = 0; cz = 0; }
    else if (this.range === 'near') want = 110;
    else if (this.range === 'far') want = 280;
    else if (ext) { want = ext.r; cx = ext.cx; cz = ext.cz; } // Speed Race / Drift Battle: the whole circuit
    else want = 120 + Math.min(1, me.speed / 55) * 120; // free roam: zoom out with speed
    this.viewR += (want - this.viewR) * Math.min(1, dt * 2.5);
    if (Math.abs(this.viewR - want) > want * 0.6) this.viewR = want; // snap on mode/range changes
    const scale = R / this.viewR; // screen px per metre
    const rot = this.rotate ? me.h : 0;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, px, px);
    ctx.save();
    ctx.beginPath(); ctx.arc(R, R, R - 1, 0, Math.PI * 2); ctx.clip();
    ctx.fillStyle = '#10101a'; ctx.fillRect(0, 0, px, px);
    // world -> screen: centre, rotate (heading up in rotating mode), scale; background is in px units
    ctx.translate(R, R); ctx.rotate(rot); ctx.scale(scale / this.res, scale / this.res);
    const [cu, cv] = this.toPx(cx, cz);
    ctx.translate(-cu, -cv);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.base, 0, 0);
    if (this.overlay) ctx.drawImage(this.overlay, 0, 0);
    // next checkpoint (Speed Race): the same gate the glowing pillars mark in the world
    const comp = this.g.comp;
    if (comp && comp.route && comp.tracker && !this.g.spectator && !comp.tracker.finished) {
      const gt = this.gateGeom([comp.route.gates[comp.tracker.next]])[0], [u, v] = this.toPx(gt.x, gt.z);
      const pulse = 0.6 + 0.4 * Math.sin(performance.now() / 160);
      ctx.beginPath(); ctx.arc(u, v, (5 / scale) * this.res, 0, Math.PI * 2); ctx.fillStyle = `rgba(255,214,10,${pulse})`; ctx.fill();
    }
    ctx.restore();
    // markers (screen space so they stay the same size at any zoom)
    const toScreen = (x, z) => {
      let dx = (cx - x) * scale, dy = (cz - z) * scale; // same mirror as toPx
      if (rot) { const c = Math.cos(rot), s = Math.sin(rot), rx = dx * c - dy * s, ry = dx * s + dy * c; dx = rx; dy = ry; }
      return [R + dx, R + dy];
    };
    const heading = (h) => rot - h; // marker angle on screen (0 = up, clockwise); the map is mirrored, see toPx
    for (const m of this.markers()) {
      let [u, v] = toScreen(m.x, m.z); const dd = Math.hypot(u - R, v - R), edge = R - 8;
      if (dd > edge) { // off the map: pin to the rim as a small pointer so you still know where they are
        u = R + ((u - R) / dd) * edge; v = R + ((v - R) / dd) * edge;
        ctx.globalAlpha = 0.85; this.dot(ctx, u, v, 4, m.col, m.kind); ctx.globalAlpha = 1; continue;
      }
      if (m.kind === 'ghost') ctx.globalAlpha = 0.55;
      this.arrow(ctx, u, v, heading(m.h), 7, m.col);
      ctx.globalAlpha = 1;
      ctx.font = 'bold 9px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = '#fff';
      ctx.strokeStyle = 'rgba(0,0,0,0.8)'; ctx.lineWidth = 3; ctx.strokeText(m.label, u, v - 10); ctx.fillText(m.label, u, v - 10);
    }
    // you
    const [mu, mv] = toScreen(me.x, me.z);
    if (!me.spec) this.arrow(ctx, mu, mv, heading(me.h), 9, '#ffffff', true);
    else this.dot(ctx, mu, mv, 5, '#ffffff');
    // compass
    const nx = R + Math.sin(rot) * (R - 10), ny = R - Math.cos(rot) * (R - 10); // world north (+z) on screen
    ctx.font = 'bold 10px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.beginPath(); ctx.arc(nx, ny, 7, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#ff4d6d'; ctx.fillText('N', nx, ny + 0.5); ctx.textBaseline = 'alphabetic';
    // rim
    ctx.beginPath(); ctx.arc(R, R, R - 1, 0, Math.PI * 2); ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 2; ctx.stroke();
  }
  arrow(ctx, u, v, a, s, col, me) {
    const sa = Math.sin(a), ca = Math.cos(a);
    // tip, back-right, notch, back-left in local (right, up) units, rotated by a (0 = screen up)
    const pts = [[0, 1.1], [0.75, -0.8], [0, -0.35], [-0.75, -0.8]].map(([rx, up]) => [u + (rx * ca + up * sa) * s, v + (rx * sa - up * ca) * s]);
    ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath();
    ctx.fillStyle = col; ctx.fill(); ctx.lineWidth = me ? 2 : 1.5; ctx.strokeStyle = me ? '#ff006e' : 'rgba(0,0,0,0.85)'; ctx.stroke();
  }
  dot(ctx, u, v, r, col) { ctx.beginPath(); ctx.arc(u, v, r, 0, Math.PI * 2); ctx.fillStyle = col; ctx.fill(); ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(0,0,0,0.85)'; ctx.stroke(); }
}
