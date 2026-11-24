// Shared track geometry + competition rules. Pure JS (no DOM/WebGL) so the SAME code
// runs in the browser and on the Node server — that is what lets the server validate
// checkpoints, laps, off-track penalties and battle courses instead of trusting clients.
//
//  - GEO:        road control points / widths / pads for every map (maps.js renders these)
//  - RACE:       circuit routes with checkpoint gates (Speed Race)
//  - BATTLE:     tandem battle courses (Competitive Drift Battle)
//  - TrackGeo:   "how far off the track is this point?" (off-track penalties)
//  - RaceTracker: ordered checkpoint / lap validation (anti-skip, anti-teleport)

// ------------------------------------------------------------------ geometry helpers
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;

// Centripetal Catmull-Rom spline through control points, resampled every `step` metres.
export function crSample(ctrl, closed, step) {
  const n = ctrl.length, raw = [];
  const P = (i) => {
    if (closed) return ctrl[((i % n) + n) % n];
    if (i < 0) return [2 * ctrl[0][0] - ctrl[1][0], 2 * ctrl[0][1] - ctrl[1][1]];
    if (i >= n) return [2 * ctrl[n - 1][0] - ctrl[n - 2][0], 2 * ctrl[n - 1][1] - ctrl[n - 2][1]];
    return ctrl[i];
  };
  const segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2);
    const d = (a, b) => Math.max(1e-3, Math.pow(Math.hypot(b[0] - a[0], b[1] - a[1]), 0.5));
    const t0 = 0, t1 = d(p0, p1), t2 = t1 + d(p1, p2), t3 = t2 + d(p2, p3);
    const m = Math.max(4, Math.ceil(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / 1.5));
    for (let k = 0; k < m; k++) {
      const t = lerp(t1, t2, k / m);
      const L = (a, b, ta, tb) => [((tb - t) * a[0] + (t - ta) * b[0]) / (tb - ta), ((tb - t) * a[1] + (t - ta) * b[1]) / (tb - ta)];
      const A1 = L(p0, p1, t0, t1), A2 = L(p1, p2, t1, t2), A3 = L(p2, p3, t2, t3);
      const B1 = L(A1, A2, t0, t2), B2 = L(A2, A3, t1, t3);
      raw.push(L(B1, B2, t1, t2));
    }
  }
  if (!closed) raw.push(ctrl[n - 1]);
  return resample(raw, closed, step);
}
// Uniform resampling of a polyline
export function resample(raw, closed, step) {
  const out = [raw[0]]; let acc = 0;
  const pts = closed ? [...raw, raw[0]] : raw;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i]; const seg = Math.hypot(b[0] - a[0], b[1] - a[1]); let s = 0;
    while (acc + seg - s >= step) {
      const need = step - acc; s += need; acc = 0;
      const t = s / Math.hypot(b[0] - a[0], b[1] - a[1]);
      out.push([lerp(a[0], b[0], t), lerp(a[1], b[1], t)]);
    }
    acc += seg - s;
  }
  if (closed) { const l = out[out.length - 1]; if (Math.hypot(l[0] - out[0][0], l[1] - out[0][1]) < step * 0.5) out.pop(); }
  else if (acc > step * 0.3) out.push(raw[raw.length - 1]);
  return out;
}
export function segDist(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1e-9;
  const t = clamp(((px - ax) * dx + (pz - az) * dz) / l2, 0, 1);
  return [Math.hypot(px - (ax + dx * t), pz - (az + dz * t)), t];
}
export function wrapAngle(a) { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; }

// A sampled path with tangents (3 m spacing — identical to how maps.js samples roads)
export function samplePath(pts, closed, { linear = false } = {}) {
  const s = linear ? resample(pts, closed, 3) : crSample(pts, closed, 3);
  const n = s.length, x = new Float64Array(n), z = new Float64Array(n), tx = new Float64Array(n), tz = new Float64Array(n);
  s.forEach((p, i) => { x[i] = p[0]; z[i] = p[1]; });
  for (let i = 0; i < n; i++) {
    const a = closed ? (i - 1 + n) % n : Math.max(0, i - 1), b = closed ? (i + 1) % n : Math.min(n - 1, i + 1);
    const dx = x[b] - x[a], dz = z[b] - z[a], l = Math.hypot(dx, dz) || 1;
    tx[i] = dx / l; tz[i] = dz / l;
  }
  return { n, x, z, tx, tz, closed };
}

// ------------------------------------------------------------------ map geometry (rendered by maps.js)
const CITY_B = 90, CITY_ST = 16, CITY_K = 5;
function cityRoads() {
  const roads = [], e = CITY_K * CITY_B;
  for (let i = -CITY_K; i <= CITY_K; i++) {
    const v = i * CITY_B;
    roads.push({ pts: [[v, -e], [v, 0], [v, e]], width: CITY_ST });
    roads.push({ pts: [[-e, v], [0, v], [e, v]], width: CITY_ST });
  }
  roads.push({ pts: [[-e, -e], [0, 0], [e, e]], width: CITY_ST, diagonal: true }); // the diagonal boulevard
  return roads;
}
export const CITY = { B: CITY_B, ST: CITY_ST, K: CITY_K };

const sc = (k, pts) => pts.map(([x, z]) => [Math.round(x * k), Math.round(z * k)]);

// Every map is a road NETWORK: road 0 is the main loop (the Speed Race circuit on most maps);
// the other roads are connectors, cut-throughs and side roads whose ends sit on another road
// (a junction) or inside a pad (car parks, skidpads, plazas).
// A ladder of switchbacks (Japanese touge hairpins): `legs` traverses of length `len`, the first one
// starting at (x0, z0) heading +x (dir 1) or -x (dir -1), each hairpin stepping `gap` metres in z
// (sign of gap = which way up the ladder goes). Legs get a slight S-bend so they flow.
function ladder(x0, z0, legs, len, gap, dir) {
  const pts = [], r = Math.abs(gap) / 2, sz = Math.sign(gap);
  let x = x0, z = z0, d = dir;
  for (let i = 0; i < legs; i++) {
    const xe = x + d * len;
    pts.push([x + d * len * 0.12, z], [x + d * len * 0.5, z + sz * gap * 0.12 * (i % 2 ? 1 : -1)], [xe - d * len * 0.12, z]);
    if (i < legs - 1) { // hairpin: half circle round (xe, z + gap/2), bulging a little wider than the legs
      const cz = z + gap / 2;
      for (const t of [-0.6, 0, 0.6]) pts.push([xe + d * r * 1.25 * Math.cos(t), cz + sz * r * Math.sin(t)]);
      z += gap; x = xe; d = -d;
    }
  }
  return pts;
}

export const GEO = {
  track: {
    roads: [
      // 0: the Grand Prix circuit
      { pts: sc(1.25, [[-200, -300], [100, -300], [260, -290], [330, -230], [340, -140], [290, -80], [200, -60], [150, 0], [190, 70], [290, 110], [340, 190], [310, 290], [210, 320], [120, 270], [90, 180], [20, 120], [-60, 150], [-110, 240], [-200, 300], [-300, 280], [-330, 190], [-270, 120], [-170, 90], [-140, 10], [-210, -60], [-320, -120], [-340, -220], [-290, -290]]), closed: true, width: 16 },
      // 1: pit link from the main straight to the infield skidpad
      { pts: [[75, -375], [75, -335], [75, -290]], width: 12 },
      // 2: "National" cut-through across the infield (short circuit / shortcut)
      { pts: [[188, 0], [110, -40], [0, -60], [-100, -40], [-175, 12]], width: 14 },
      // 3: outer service road all the way round the venue (outside the circuit walls)
      { pts: [[0, -540], [330, -540], [520, -470], [545, -250], [540, 60], [545, 330], [470, 500], [250, 525], [0, 520], [-250, 525], [-470, 500], [-545, 330], [-545, 60], [-545, -250], [-520, -470], [-330, -540]], closed: true, width: 12 },
      // 4,5: paddock exits to the service road
      { pts: [[-160, -440], [-240, -490], [-300, -539]], width: 12 },
      { pts: [[160, -440], [240, -490], [300, -539]], width: 12 },
      // 6: east crossover: service road -> circuit (marshal access)
      { pts: [[542, 120], [440, 110], [330, 128]], width: 12 },
      // 7: north car park access
      { pts: [[0, 519], [0, 460], [0, 395]], width: 12 },
      // 8: autocross pad access (west)
      { pts: [[-545, 20], [-470, 20], [-395, 20]], width: 12 },
      // 9: infield back road: National -> hairpin infield
      { pts: [[-60, -50], [-100, 60], [-118, 150], [-101, 240]], width: 11 },
    ],
    pads: [
      { x: 75, z: -210, r: 80 }, // infield skidpad
      { x: 0, z: -430, w: 340, d: 70 }, // paddock
      { x: 0, z: 330, w: 130, d: 120 }, // north car park
      { x: -330, z: 20, w: 120, d: 110 }, // autocross pad
    ],
  },
  desert: {
    // Dune Valley: a huge open desert (4 km across) with a long winding highway that
    // weaves out to every corner, an interstate cutting across it, and side roads to the
    // salt flat, a dry lake, a canyon, a ghost town, an old airstrip and a gas station.
    roads: [
      // 0: Grand Desert Highway — long, winding, never a plain circle
      { pts: [[0, -1500], [700, -1640], [1300, -1450], [1650, -1000], [1500, -600], [1700, -200], [1650, 400], [1350, 800], [1520, 1250], [1150, 1660], [500, 1600], [0, 1300], [-500, 1660], [-1100, 1600], [-1600, 1250], [-1450, 700], [-1720, 200], [-1600, -400], [-1300, -900], [-1520, -1400], [-900, -1660], [-400, -1450]], closed: true, width: 16 },
      // 1: the interstate straight across the valley, west to east
      { pts: [[-1720, 200], [-1100, 270], [-600, 340], [0, 400], [600, 340], [1100, 230], [1700, -200]], width: 16 },
      // 2: south highway -> salt flat
      { pts: [[0, -1500], [60, -1000], [-20, -600], [0, -205]], width: 13 },
      // 3: north highway -> crosses the interstate -> salt flat
      { pts: [[0, 1300], [40, 900], [10, 600], [0, 400], [0, 205]], width: 13 },
      // 4: east road: salt flat -> highway
      { pts: [[205, 0], [600, -60], [1100, -200], [1500, -600]], width: 13 },
      // 5: west road: salt flat -> highway
      { pts: [[-205, 0], [-700, -80], [-1100, -300], [-1600, -400]], width: 13 },
      // 6: canyon road, twisting between the mesas (interstate -> north-west highway)
      { pts: [[-1100, 270], [-1160, 560], [-980, 760], [-1120, 960], [-960, 1160], [-1130, 1360], [-1100, 1600]], width: 12 },
      // 7: ghost-town gravel road (west road -> south-west highway)
      { pts: [[-1100, -300], [-1050, -650], [-900, -1000], [-980, -1300], [-900, -1660]], width: 11 },
      // 8: highway -> airstrip (south-east)
      { pts: [[1300, -1450], [1160, -1230], [1050, -1050]], width: 12 },
      // 9: airstrip -> east road
      { pts: [[760, -760], [640, -450], [600, -60]], width: 12 },
      // 10: gas station access (east highway)
      { pts: [[1650, 400], [1560, 425], [1490, 440]], width: 12 },
      // 11: dry lake access (north-east highway)
      { pts: [[1350, 800], [1180, 870], [1060, 930]], width: 12 },
    ],
    pads: [
      { x: 0, z: 0, r: 210 }, // salt flat
      { x: 1450, z: 450, w: 70, d: 50, yaw: 0.3 }, // gas station
      { x: 900, z: -900, w: 46, d: 420, yaw: 2.356 }, // airstrip
      { x: -900, z: -1000, w: 90, d: 70 }, // ghost-town square
      { x: 900, z: 1010, r: 170 }, // dry lake
    ],
  },
  mountain: {
    // Kurogane Pass: a 3.4 km mountain with Japanese touge roads — an uphill with a ladder of
    // hairpins, an Irohazaka-style switchback descent, flowing ridge esses, all narrow two-lane
    // roads with guardrails, round a big valley ring road.
    roads: [
      // 0: valley ring road round the mountain
      { pts: [[0, -1350], [600, -1250], [1050, -900], [1280, -450], [1320, 0], [1250, 500], [950, 950], [500, 1250], [0, 1320], [-500, 1260], [-950, 980], [-1250, 520], [-1330, 0], [-1250, -500], [-1000, -950], [-550, -1250]], closed: true, width: 11 },
      // 1: Kurogane uphill: base -> fast esses -> five-hairpin ladder -> sweepers -> summit hairpins -> summit
      { pts: [[0, -1350], [20, -1200], [-50, -1110], [20, -1040], [-60, -990], [-160, -978], [-222, -952], [-226, -915], ...ladder(-150, -900, 6, 300, 60, 1),
        [-230, -520], [-160, -420], [-40, -390], [90, -330], [160, -250], ...ladder(170, -190, 4, 150, 46, -1), [198, -42], [218, -8], [185, 24], [90, 36], [0, 50]], width: 10 },
      // 2: Irohazaka descent: summit -> nine switchbacks down the north face -> esses -> ring
      { pts: [[0, 50], [10, 120], [-80, 140], [-160, 150], [-210, 172], [-190, 197], ...ladder(-130, 200, 9, 260, 52, 1), [195, 655], [140, 740], [0, 800], [-70, 900], [40, 1020], [-30, 1150], [0, 1320]], width: 10 },
      // 3: ridge run: east ring -> flowing esses up the east ridge -> summit
      { pts: [[1320, 0], [1180, 110], [1040, -90], [900, 120], [770, -100], [650, 110], [530, -90], [420, 100], [320, -60], [220, 110], [130, 85], [65, 85]], width: 10 },
      // 4: village lane (north-west ring)
      { pts: [[-950, 980], [-830, 900], [-720, 860]], width: 10 },
      // 5: gravel forestry road -> clearing (west ring)
      { pts: [[-1330, 0], [-1180, 40], [-1050, -20]], width: 9.5 },
    ],
    pads: [{ x: -75, z: -1262, w: 110, d: 70 }, { x: 0, z: 60, w: 130, d: 90 }, { x: -700, z: 840, w: 80, d: 50 }, { x: -990, z: -20, r: 55 }],
  },
  forest: {
    roads: [
      // 0: the main forest loop
      { pts: sc(1.3, [[-380, -320], [-150, -400], [120, -380], [330, -300], [430, -120], [390, 40], [420, 200], [360, 380], [160, 430], [-40, 380], [-120, 240], [-260, 200], [-400, 260], [-470, 80], [-430, -60], [-450, -200]]), closed: true, width: 12 },
      // 1: west spur into the gravel clearing
      { pts: [[-572, -169], [-442, -188], [-320, -195]], width: 10 },
      // 2: lakeside road along the south and west shore
      { pts: [[505, 40], [360, -20], [180, -45], [20, 40], [-40, 180], [-20, 330], [-58, 490]], width: 11 },
      // 3: north shore road
      { pts: [[-22, 325], [120, 352], [300, 330], [420, 400], [466, 490]], width: 11 },
      // 4: gravel logging trail: clearing -> north-west loop
      { pts: [[-228, -110], [-250, 40], [-300, 170], [-336, 262]], width: 9 },
      // 5: forest road through the middle: south loop -> cabin car park -> lakeside
      { pts: [[156, -490], [158, -440], [156, -400], [160, -300], [175, -160], [180, -50]], width: 10 },
      // 6: quarry track (outside the loop, south-west)
      { pts: [[-490, -420], [-470, -520], [-445, -575]], width: 9 },
      // 7: east forest track: east loop -> lakeside east end (short cut)
      { pts: [[430, -390], [470, -200], [505, 40]], width: 9 },
    ],
    pads: [{ x: -228, z: -195, r: 100 }, { x: 156, z: -380, w: 70, d: 40 }, { x: -435, z: -630, r: 62 }],
  },
  city: { roads: cityRoads(), pads: [], openArea: true },
  drift: {
    roads: [
      // 0: the drift course — main straight, fast right-hander, S-bends, hairpin, a figure-eight
      // crossover in the middle, the long west sweeper and a final hairpin onto the straight
      { pts: [[-250, -480], [0, -480], [200, -478], [330, -450], [425, -350], [440, -230], [380, -140], [450, -40], [410, 60], [345, 140], [280, 160], [225, 110], [150, 25], [0, -120], [-150, -265], [-270, -320], [-380, -260], [-420, -120], [-370, 10], [-250, 60], [-150, 30], [0, -120], [150, -270], [210, -340], [150, -395], [0, -405], [-250, -400], [-370, -420], [-380, -460]], closed: true, width: 18 },
      // 1: paddock road along the south of the main straight -> west service road
      { pts: [[-250, -480], [-420, -520], [-540, -420], [-560, -150], [-540, 120], [-500, 210]], width: 12 },
      // 2: hairpin -> harbour container yard (north access)
      { pts: [[282, 156], [300, 230], [300, 300]], width: 12 },
      // 3: practice pad -> donut circle, and donut circle -> container yard
      { pts: [[-300, 215], [-200, 200], [-145, 185]], width: 12 },
      { pts: [[-80, 228], [-55, 262], [-40, 300]], width: 12 },
      // 5: infield link: west sweeper -> practice pad
      { pts: [[-300, 46], [-330, 140], [-360, 175]], width: 12 },
      // 6: east service road: S-bends -> container yard east end
      { pts: [[449, -40], [520, 40], [545, 160], [540, 300]], width: 11 },
    ],
    pads: [
      { x: -40, z: -506, w: 300, d: 60 }, // paddock
      { x: -410, z: 240, w: 230, d: 150 }, // practice pad
      { x: -110, z: 205, r: 42 }, // donut circle
      { x: 240, z: 357, w: 720, d: 150 }, // harbour container yard (alleys between the stacks)
    ],
  },
};

// Junctions: the end of a side road is snapped exactly onto the centre line of the road it joins
// (the nearest earlier road within 40 m), unless it ends inside a pad. Done once here, so the
// browser world, the server's off-track checks and the race routes all use the same points.
function snapNetwork(G) {
  const done = [];
  const inPad = ([x, z]) => G.pads.some((p) => {
    if (p.r) return Math.hypot(x - p.x, z - p.z) < p.r;
    const c = Math.cos(p.yaw || 0), s = Math.sin(p.yaw || 0), lx = (x - p.x) * c - (z - p.z) * s, lz = (x - p.x) * s + (z - p.z) * c;
    return Math.abs(lx) < p.w / 2 && Math.abs(lz) < p.d / 2;
  });
  for (const rd of G.roads) {
    if (!rd.closed && done.length) {
      for (const end of [0, rd.pts.length - 1]) {
        const q = rd.pts[end]; if (inPad(q)) continue;
        let best = 40, bp = null;
        for (const o of done) for (let i = 0; i < o.n - (o.closed ? 0 : 1); i++) {
          const j = (i + 1) % o.n, [d, t] = segDist(q[0], q[1], o.x[i], o.z[i], o.x[j], o.z[j]);
          if (d < best) { best = d; bp = [o.x[i] + (o.x[j] - o.x[i]) * t, o.z[i] + (o.z[j] - o.z[i]) * t]; }
        }
        if (bp) rd.pts[end] = [Math.round(bp[0] * 10) / 10, Math.round(bp[1] * 10) / 10];
      }
    }
    done.push(samplePath(rd.pts, !!rd.closed));
  }
}
for (const id of Object.keys(GEO)) snapNetwork(GEO[id]);

// ------------------------------------------------------------------ Speed Race circuits
// Each route = the circuit centreline (closed). `start` = sample index of the start/finish
// line; race direction = increasing sample index. Gates every GATE_SPACING samples.
const GATE_SPACING = 16; // 16 samples × 3 m = 48 m between checkpoints
// A street circuit through the given grid corners, corners rounded with radius r (stays on the tarmac)
function streetLoop(wp, r = 10) {
  const pts = [], n = wp.length;
  for (let k = 0; k < n; k++) {
    const p = wp[k], a = wp[(k - 1 + n) % n], b = wp[(k + 1) % n];
    const ux = p[0] - a[0], uz = p[1] - a[1], ul = Math.hypot(ux, uz), vx = b[0] - p[0], vz = b[1] - p[1], vl = Math.hypot(vx, vz);
    const turn = Math.acos(clamp((ux * vx + uz * vz) / (ul * vl), -1, 1));
    if (turn < 0.05) { pts.push(p); continue; }
    const cut = r / Math.tan((Math.PI - turn) / 2); // tangent length of a radius-r fillet
    const s0 = [p[0] - (ux / ul) * cut, p[1] - (uz / ul) * cut], s1 = [p[0] + (vx / vl) * cut, p[1] + (vz / vl) * cut];
    for (let t = 0; t <= 4; t++) { const f = t / 4, q0 = [s0[0] + (p[0] - s0[0]) * f, s0[1] + (p[1] - s0[1]) * f], q1 = [p[0] + (s1[0] - p[0]) * f, p[1] + (s1[1] - p[1]) * f]; pts.push([q0[0] + (q1[0] - q0[0]) * f, q0[1] + (q1[1] - q0[1]) * f]); }
  }
  return pts;
}
// Downtown: the long south avenue, up the east side, a jog round the plaza, back down the west and
// the diagonal boulevard into a hairpin at the south-west corner
const CITY_LOOP = [[-180, -360], [270, -360], [270, 180], [90, 180], [90, 360], [-90, 360], [-90, -90], [-360, -360]];
export const RACE = {
  track: { name: 'Apex Circuit', road: 0, start: 30, width: 16, margin: 14 },
  desert: { name: 'Dune Valley Highway', road: 0, start: 70, width: 14, margin: 16 },
  mountain: { name: 'Kurogane Pass Loop', legs: [[1, [0, -1350], [0, 50], 1], [2, [0, 50], [0, 1320], 1], [0, [0, 1320], [0, -1350], 1]], start: 20, width: 10, margin: 12 },
  forest: { name: 'Pinewood Loop', road: 0, start: 40, width: 12, margin: 12 },
  drift: { name: 'Ironbay Figure-Eight', road: 0, start: 40, width: 18, margin: 12 },
  city: { name: 'Downtown Street Circuit', pts: streetLoop(CITY_LOOP, 12), linear: true, start: 0, width: 16, margin: 6 },
};
export const RACE_MAPS = Object.keys(RACE);

// A circuit made of pieces of several roads of the network: legs = [[road, [fromX, fromZ], [toX, toZ], dir]]
// (dir +1 = along the road's point order, -1 = against it). Uses the roads' own 3 m samples, so the
// race line lies exactly on the tarmac the world builds.
function chainLegs(mapId, legs) {
  const out = [];
  for (const [ri, from, to, dir = 1] of legs) {
    const rd = GEO[mapId].roads[ri], p = samplePath(rd.pts, !!rd.closed);
    const near = ([x, z]) => { let b = 0, bd = 1e18; for (let i = 0; i < p.n; i++) { const d = (p.x[i] - x) ** 2 + (p.z[i] - z) ** 2; if (d < bd) { bd = d; b = i; } } return b; };
    let i = near(from); const j = near(to);
    for (let guard = 0; guard <= p.n; guard++) {
      out.push([p.x[i], p.z[i]]);
      if (i === j) break;
      i = p.closed ? (i + dir + p.n) % p.n : clamp(i + dir, 0, p.n - 1);
    }
  }
  // drop near-duplicate points where legs meet
  return out.filter((q, k) => k === 0 || Math.hypot(q[0] - out[k - 1][0], q[1] - out[k - 1][1]) > 1);
}

const routeCache = new Map();
export function raceRoute(mapId) {
  if (routeCache.has(mapId)) return routeCache.get(mapId);
  const R = RACE[mapId]; if (!R) return null;
  const rd = R.pts ? { pts: R.pts, closed: true } : R.legs ? { pts: chainLegs(mapId, R.legs), closed: true } : GEO[mapId].roads[R.road];
  let path = samplePath(rd.pts, true, { linear: !!(R.linear || R.legs) });
  // rotate so sample 0 is the start/finish line
  if (R.start) {
    const rot = (arr) => { const o = new Float64Array(arr.length); for (let i = 0; i < arr.length; i++) o[i] = arr[(i + R.start) % arr.length]; return o; };
    path = { ...path, x: rot(path.x), z: rot(path.z), tx: rot(path.tx), tz: rot(path.tz) };
  }
  const gates = [];
  const count = Math.max(8, Math.floor(path.n / GATE_SPACING));
  for (let g = 0; g < count; g++) {
    const i = Math.round((g * path.n) / count) % path.n;
    gates.push({ i, x: path.x[i], z: path.z[i], tx: path.tx[i], tz: path.tz[i], hw: R.width / 2 + R.margin });
  }
  const route = { mapId, name: R.name, path, gates, width: R.width, length: path.n * 3 };
  routeCache.set(mapId, route);
  return route;
}
// starting grid: 2 columns, rows 9 m apart, behind the start line
export function gridSlots(route, count) {
  const p = route.path, out = [];
  for (let k = 0; k < count; k++) {
    const row = Math.floor(k / 2), lane = k % 2 ? -1 : 1;
    const i = ((-(3 + row * 3)) % p.n + p.n) % p.n;
    const off = lane * route.width * 0.22;
    out.push({ x: p.x[i] - p.tz[i] * off, z: p.z[i] + p.tx[i] * off, h: Math.atan2(p.tx[i], p.tz[i]) });
  }
  return out;
}

// ------------------------------------------------------------------ RaceTracker
// Feed it position samples; it validates checkpoints IN ORDER. Gate 0 is the start/finish:
// the first crossing after the start just begins lap 1; a lap completes when gate 0 is
// crossed again after every other gate. Teleports (resets / implausible jumps) never count.
export class RaceTracker {
  constructor(route, laps) {
    this.route = route; this.laps = laps;
    this.next = 0; this.started = false; this.lap = 0; // completed laps
    this.lapStart = null; this.lapTimes = []; this.best = null; this.finished = false; this.finishTime = null;
    this.prev = null; this.passed = 0; this.wrongWay = 0;
  }
  // s: {t (seconds since race start), x, z, vx, vz, teleport}
  update(s) {
    const prev = this.prev; this.prev = s;
    if (!prev || this.finished || s.t < 0) return null;
    const dx = s.x - prev.x, dz = s.z - prev.z, dist = Math.hypot(dx, dz), dt = Math.max(1e-3, s.t - prev.t);
    const v = Math.min(110, Math.hypot(s.vx || 0, s.vz || 0));
    if (s.teleport || dist > Math.max(3, Math.max(v, Math.hypot(prev.vx || 0, prev.vz || 0)) * dt * 1.8 + 3) || dist > 60) return null;
    const g = this.route.gates[this.next];
    const d0 = (prev.x - g.x) * g.tx + (prev.z - g.z) * g.tz, d1 = (s.x - g.x) * g.tx + (s.z - g.z) * g.tz;
    if (!(d0 < 0 && d1 >= 0)) return null;
    const f = -d0 / (d1 - d0);
    const qx = prev.x + dx * f, qz = prev.z + dz * f;
    const lat = Math.abs((qx - g.x) * -g.tz + (qz - g.z) * g.tx);
    if (lat > g.hw) return null;
    const tc = prev.t + (s.t - prev.t) * f; // interpolated crossing time
    const ev = { gate: this.next, t: tc };
    if (this.next === 0) {
      if (!this.started) { this.started = true; this.lapStart = 0; ev.type = 'start'; }
      else {
        const lt = tc - this.lapStart; this.lapTimes.push(lt); this.lap++; this.lapStart = tc;
        if (this.best === null || lt < this.best) this.best = lt;
        ev.type = 'lap'; ev.lapTime = lt;
        if (this.lap >= this.laps) { this.finished = true; this.finishTime = tc; ev.type = 'finish'; }
      }
    } else ev.type = 'checkpoint';
    this.passed++;
    this.next = (this.next + 1) % this.route.gates.length;
    return ev;
  }
  // monotonic race progress for standings: completed gates + fraction to next gate
  progress(x, z) {
    if (this.finished) return 1e6 - (this.finishTime || 0);
    const gs = this.route.gates, g = gs[this.next], pg = gs[(this.next - 1 + gs.length) % gs.length];
    const seg = Math.hypot(g.x - pg.x, g.z - pg.z) || 1;
    const frac = this.started ? clamp(1 - Math.hypot(x - g.x, z - g.z) / seg, 0, 0.99) : 0;
    return this.passed + frac;
  }
  get gateCount() { return this.route.gates.length; }
}

// ------------------------------------------------------------------ Drift Battle courses
// A one-way section of road with a start gate and an end gate. dir -1 = run the road backwards.
function figure8(r) {
  // two touching circles on the salt flat: right loop then left loop, both starting north at the centre
  const pts = [];
  for (let k = 0; k < 48; k++) { const t = (k / 48) * Math.PI * 2; pts.push([r - r * Math.cos(t), r * Math.sin(t)]); }
  for (let k = 0; k <= 48; k++) { const t = (k / 48) * Math.PI * 2; pts.push([-r + r * Math.cos(t), r * Math.sin(t)]); }
  return pts;
}
export const BATTLE = {
  track: { name: 'Esses & Carousel', road: 0, from: 0.175, to: 0.445, dir: 1, width: 16 },
  desert: { name: 'Salt Flat Figure-8', pts: figure8(55), width: 16 },
  mountain: { name: 'Irohazaka Downhill', road: 2, from: 0.05, to: 0.5, dir: 1, width: 10 },
  forest: { name: 'Lakeside Esses', road: 0, from: 0.607, to: 0.878, dir: 1, width: 12 },
  drift: { name: 'Ironbay S-Bends', road: 0, from: 0.13, to: 0.36, dir: 1, width: 18 },
};
export const BATTLE_MAPS = Object.keys(BATTLE);
const courseCache = new Map();
export function battleCourse(mapId) {
  if (courseCache.has(mapId)) return courseCache.get(mapId);
  const B = BATTLE[mapId]; if (!B) return null;
  const full = B.pts ? samplePath(B.pts, false, { linear: true }) : samplePath(GEO[mapId].roads[B.road].pts, !!GEO[mapId].roads[B.road].closed);
  const dir = B.dir || 1;
  const a = B.pts ? 0 : Math.round(B.from * (full.n - 1)), b = B.pts ? full.n - 1 : Math.round(B.to * (full.n - 1));
  const idx = []; for (let i = a; dir > 0 ? i <= b : i >= b; i += dir) idx.push(i);
  const n = idx.length, x = new Float64Array(n), z = new Float64Array(n), tx = new Float64Array(n), tz = new Float64Array(n);
  idx.forEach((i, k) => { x[k] = full.x[i]; z[k] = full.z[i]; tx[k] = full.tx[i] * dir; tz[k] = full.tz[i] * dir; });
  const path = { n, x, z, tx, tz, closed: false };
  const mk = (k) => ({ x: x[k], z: z[k], tx: tx[k], tz: tz[k], hw: B.width / 2 + 10 });
  const course = { mapId, name: B.name, path, width: B.width, start: mk(6), end: mk(n - 1), length: n * 3 };
  // start slots: lead just before the start gate, chase ~17 m behind on the same line
  const h0 = Math.atan2(tx[0], tz[0]);
  course.leadSlot = { x: x[2], z: z[2], h: Math.atan2(tx[2], tz[2]) };
  course.chaseSlot = { x: x[0] - tx[0] * 11, z: z[0] - tz[0] * 11, h: h0 };
  courseCache.set(mapId, course);
  return course;
}
// distance from a point to a sampled open/closed path (returns {d, k} nearest sample index)
export function pathDistance(path, px, pz, hint = -1, window = 40) {
  let best = 1e9, bk = 0;
  const n = path.n;
  const lo = hint < 0 ? 0 : Math.max(0, hint - window), hi = hint < 0 ? n - 1 : Math.min(n - 1, hint + window);
  for (let k = lo; k < hi; k++) {
    const [d] = segDist(px, pz, path.x[k], path.z[k], path.x[k + 1], path.z[k + 1]);
    if (d < best) { best = d; bk = k; }
  }
  return { d: best, k: bk };
}

// ------------------------------------------------------------------ TrackGeo (off-track checks)
export class TrackGeo {
  constructor(mapId) {
    const G = GEO[mapId]; this.open = !!G.openArea;
    this.roads = G.roads.map((r) => ({ ...samplePath(r.pts, !!r.closed), half: r.width / 2 }));
    this.pads = G.pads;
    this.cell = 30; this.hash = new Map();
    this.roads.forEach((r, ri) => {
      const segs = r.closed ? r.n : r.n - 1;
      for (let i = 0; i < segs; i++) {
        const j = (i + 1) % r.n, R = r.half + 10;
        const x0 = Math.floor((Math.min(r.x[i], r.x[j]) - R) / this.cell), x1 = Math.floor((Math.max(r.x[i], r.x[j]) + R) / this.cell);
        const z0 = Math.floor((Math.min(r.z[i], r.z[j]) - R) / this.cell), z1 = Math.floor((Math.max(r.z[i], r.z[j]) + R) / this.cell);
        for (let a = x0; a <= x1; a++) for (let b = z0; b <= z1; b++) { const k = a * 100003 + b; let arr = this.hash.get(k); if (!arr) this.hash.set(k, arr = []); arr.push([ri, i, j]); }
      }
    });
  }
  // signed distance to the nearest tarmac edge (negative = on the road / a paved area)
  edge(x, z) {
    if (this.open) return -1;
    let best = 1e9;
    const arr = this.hash.get(Math.floor(x / this.cell) * 100003 + Math.floor(z / this.cell));
    if (arr) for (const [ri, i, j] of arr) { const r = this.roads[ri]; const [d] = segDist(x, z, r.x[i], r.z[i], r.x[j], r.z[j]); best = Math.min(best, d - r.half); }
    for (const p of this.pads) {
      let e;
      if (p.r) e = Math.hypot(x - p.x, z - p.z) - p.r;
      else { const c = Math.cos(p.yaw || 0), s = Math.sin(p.yaw || 0), lx = (x - p.x) * c - (z - p.z) * s, lz = (x - p.x) * s + (z - p.z) * c; e = Math.max(Math.abs(lx) - p.w / 2, Math.abs(lz) - p.d / 2); }
      best = Math.min(best, e);
    }
    return best;
  }
}
export const OFF_TRACK_MARGIN = 4; // metres beyond the tarmac edge before it counts as leaving the track
