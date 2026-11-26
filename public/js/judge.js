// Official competition judges. Pure JS, shared by the browser and the server.
// They consume the 20 Hz state samples every client already sends (rounded exactly like the
// server stores them), so a player's browser and the server compute the same numbers —
// and in online play the SERVER's result is the official one.
//
// Sample format: { k, x, y, z, h, vx, vz, f, sl }   k = sample index (20 per second)
// Flag bits f: 1 drifting, 2 braking, 4 reversing, 8 boost, 16 handbrake, 32 spin, 64 reverse-slide,
//              128 hard impact since last sample, 256 teleported (car reset) since last sample
import { DriftScorer } from './scoring.js';
import { TrackGeo, OFF_TRACK_MARGIN, pathDistance, clamp, wrapAngle } from './tracks.js';

export const SAMPLE_DT = 0.05;
export const round2 = (v) => (Number.isFinite(v) ? Math.round(v * 100) / 100 : 0);
export const F = { DRIFT: 1, BRAKE: 2, REV: 4, BOOST: 8, HB: 16, SPIN: 32, REVSLIDE: 64, IMPACT: 128, TELEPORT: 256 };

// Turn consecutive samples into the car-like values DriftScorer needs
class Kinematics {
  constructor() { this.prev = null; }
  push(s) {
    const p = this.prev;
    const dt = p ? clamp((s.k - p.k) * SAMPLE_DT, SAMPLE_DT, 0.25) : SAMPLE_DT;
    const speed = Math.hypot(s.vx, s.vz), velYaw = Math.atan2(s.vx, s.vz);
    const rel = speed > 1.2 ? wrapAngle(s.h - velYaw) : 0;
    const teleport = !!(s.f & F.TELEPORT);
    const w = p && !teleport ? wrapAngle(s.h - p.h) / dt : 0;
    const velRate = p && !teleport && speed > 1.2 && p.speed > 1.2 ? wrapAngle(velYaw - p.velYaw) / dt : 0;
    const mode = s.f & F.SPIN ? 'spin' : s.f & F.REVSLIDE ? 'reverse' : s.f & F.DRIFT ? 'drift' : 'grip';
    const st = {
      dt, speed, velYaw, rel, w, velRate, mode, teleport,
      handbrake: !!(s.f & F.HB), forwardSpeed: s.vx * Math.sin(s.h) + s.vz * Math.cos(s.h),
      decel: p && !teleport ? (p.speed - speed) / dt : 0, impact: !!(s.f & F.IMPACT), x: s.x, z: s.z, k: s.k, h: s.h,
    };
    this.prev = st;
    return st;
  }
}

// ==================================================================== DRIFT CHALLENGE
// Wraps the game's DriftScorer (angle × speed × duration, 360s, reverse, donuts, transitions,
// tandem, combo chains) and adds drift distance, smoothness, collision and off-track penalties,
// and the stats the results screen needs.
export const PENALTY = { crash: 250, offtrack: 150 };
// opts (Drift Race): maxMult caps the combo multiplier, pace scales every point gained by the car's
// speed (slow drifting earns little), noDeduct = crashes / leaving the track only cost the live combo.
export class CompDriftJudge {
  constructor(mapId, onEvent = () => {}, opts = {}) {
    this.geo = new TrackGeo(mapId);
    this.onEvent = onEvent; this.opts = opts;
    this.scorer = new DriftScorer((t, d) => this.onEvent(t, d));
    if (opts.maxMult) this.scorer.maxMult = opts.maxMult;
    this.kin = new Kinematics();
    this.offTrack = false; this.penalties = 0; this.penaltyCount = { crash: 0, offtrack: 0 };
    this.maxMult = 1; this.maxCombo = 0; this.bestAngle = 0;
    this.longest = 0; this.curDrift = 0; this.distance = 0; this.smooth = 1; this.prevRel = null; this.angEma = 0;
    this.finished = false;
  }
  get total() { return Math.max(0, this.scorer.total - this.penalties); }
  get live() { return this.scorer.liveScore; }
  push(s, ctx = {}) {
    if (this.finished) return;
    const c = this.kin.push(s), sc = this.scorer;
    // --- collisions: reported impact OR a sudden stop the server can see for itself
    if ((c.impact || (c.decel > 14 && !this.opts.noDecelCrash)) && c.speed < 30) this.penalize('crash');
    // --- leaving the track
    const edge = this.geo.edge(s.x, s.z);
    const off = edge > OFF_TRACK_MARGIN;
    if (off && !this.offTrack) this.penalize('offtrack');
    this.offTrack = off;
    // --- smoothness: jerky angle changes while drifting reduce scoring (and count as loss of control)
    if (this.prevRel !== null && c.mode === 'drift') {
      const jerk = Math.abs(wrapAngle(c.rel - this.prevRel)) / c.dt;
      this.smooth += (clamp(1.15 - jerk / 6, 0.4, 1.1) - this.smooth) * 0.2;
    } else this.smooth += (1 - this.smooth) * 0.1;
    this.prevRel = c.rel;
    const car = off || c.teleport ? { ...c, mode: 'grip', w: 0, velRate: 0, rel: 0 } : c;
    const before = sc.chain;
    sc.update(c.dt, car, ctx);
    // drift distance + smoothness shape the base points earned this sample
    if (sc.active && sc.chain > before) {
      const gained = sc.chain - before;
      sc.chain = before + gained * this.smooth + c.speed * c.dt * 1.2 * Math.min(1, sc.angle / 30);
      this.angEma += (Math.min(85, sc.angle) - this.angEma) * 0.15;
      if (this.smooth > 0.8) this.bestAngle = Math.max(this.bestAngle, this.angEma);
    } else this.angEma *= 0.8;
    if (this.opts.pace && sc.chain > before) sc.chain = before + (sc.chain - before) * paceFactor(c.speed);
    // drift length = distance covered while a drift chain is alive and the car is sliding
    if (sc.chain > 0 && car.mode !== 'grip') { this.distance += c.speed * c.dt; this.curDrift += c.speed * c.dt; this.longest = Math.max(this.longest, this.curDrift); }
    if (sc.chain === 0) this.curDrift = 0;
    this.maxMult = Math.max(this.maxMult, sc.mult);
    this.maxCombo = Math.max(this.maxCombo, sc.combo);
  }
  penalize(kind) {
    this.penaltyCount[kind]++;
    if (!this.opts.noDeduct) this.penalties += PENALTY[kind];
    if (this.scorer.chain > 0) this.scorer.crash(kind === 'offtrack' ? 'offtrack' : 'crash');
    this.onEvent('penalty', { kind, points: this.opts.noDeduct ? 0 : PENALTY[kind] });
  }
  finish() { if (!this.finished) { this.scorer.bank(); this.finished = true; } return this.summary(); }
  summary() {
    return {
      total: Math.round(this.total), bestChain: Math.round(this.scorer.best), maxMult: Math.round(this.maxMult * 10) / 10, maxCombo: this.maxCombo,
      longest: Math.round(this.longest), bestAngle: Math.round(this.bestAngle), distance: Math.round(this.distance),
      penalties: this.penalties, crashes: this.penaltyCount.crash, offtracks: this.penaltyCount.offtrack, tricks: { ...this.scorer.stats },
    };
  }
}
// ==================================================================== DRIFT RACE
// A race on the Speed Race circuit where drifting AND finishing well both count.
//   final score = (drift points × position factor + position bonus) × gap factor
//   position factor: P1 1.0, P2 0.9, P3 0.8, P4 0.68, P5 0.56, P6+ 0.45
//   gap factor: 1 − seconds behind the winner / 60, never below 0.35 (DNF: 0.35 and no bonus)
// so a strong drifter a few seconds behind still wins, but drifting far behind the field doesn't.
// Drift points use the Drift Challenge judge with race tuning: combo multiplier capped at ×4,
// the live combo banks automatically at every lap line, every point is scaled by speed
// (paceFactor: nothing below 10 m/s ≈ 36 km/h, full value from 24 m/s ≈ 86 km/h) so slow "parking-lot" drifting at the
// back can't out-score racing, and crashes / leaving the track only cost the live combo.
export const DRIFT_RACE = {
  judge: { maxMult: 4, pace: true, noDeduct: true },
  // bonus per lap for each finishing position (P1, P2, …), about one strong lap of drifting; DNF earns no bonus
  bonusPerLap: [60000, 45000, 33000, 24000, 17000, 12000, 8000, 5000, 3000, 2000, 1000, 500],
  posFactor: [1, 0.9, 0.8, 0.68, 0.56, 0.45],
  gapWindow: 60, minGap: 0.2,
  // drift points stop counting this many seconds after the winner crosses the line, so a slow car can't
  // farm points just by being on track longer
  lateWindow: 10,
  maxRate: 3500, // anti-cheat: drift points can't average more than this per second of racing (+ slack)
  slack: 6000,
};
export const paceFactor = (speed) => clamp((speed - 10) / 14, 0, 1.25);
export const driftRaceBonus = (pos, laps, finished) => (finished && pos >= 1 ? (DRIFT_RACE.bonusPerLap[pos - 1] ?? 0) * Math.max(1, laps) : 0);
export const posFactor = (pos) => DRIFT_RACE.posFactor[Math.min(pos, DRIFT_RACE.posFactor.length) - 1] ?? 1;
export const gapFactor = (gap, finished) => (finished ? clamp(1 - Math.max(0, gap) / DRIFT_RACE.gapWindow, DRIFT_RACE.minGap, 1) : DRIFT_RACE.minGap);
export const driftRaceTotal = (drift, posF, bonus, gapF) => Math.round((drift * posF + bonus) * gapF);
export const driftRateCap = (secs) => Math.round(Math.max(0, secs) * DRIFT_RACE.maxRate + DRIFT_RACE.slack);
// rank rows {finished, time, prog, drift}: race positions first (finishers by time, then by progress), then
// add the bonus and sort by total. Ties on total go to the better race position.
export function driftRaceRank(rows, laps) {
  const byRace = [...rows].sort((a, b) => (b.finished - a.finished) || (a.finished ? a.time - b.time : b.prog - a.prog));
  const win = byRace.find((r) => r.finished);
  byRace.forEach((r, i) => {
    r.racePos = i + 1; r.drift = Math.max(0, Math.round(r.drift || 0));
    r.gap = r.finished && win ? Math.round((r.time - win.time) * 100) / 100 : null;
    r.posF = posFactor(i + 1); r.gapF = Math.round(gapFactor(r.gap ?? 0, r.finished) * 100) / 100;
    r.bonus = driftRaceBonus(i + 1, laps, r.finished);
    r.total = driftRaceTotal(r.drift, r.posF, r.bonus, r.gapF);
  });
  return byRace.sort((a, b) => b.total - a.total || a.racePos - b.racePos).map((r, i) => ({ ...r, pos: i + 1 }));
}
// CPU drivers race on grip, so their drift points are ESTIMATED from how hard they corner: the same judge
// is fed a virtual slip angle that grows with lateral acceleration (skill sets how bold they are).
// The estimate is then scaled by skill (AI_DRIFT) so CPUs are beatable but never score zero.
export const AI_DRIFT = { easy: 0.3, medium: 0.47, hard: 0.62, legend: 0.75 }; // drift-master bosses: BOSS_DRIFT (bosses.js)
export const AI_JUDGE = { ...DRIFT_RACE.judge, pace: false, noDecelCrash: true };
export function aiDriftSample(s, prevVelYaw, dt) {
  const speed = Math.hypot(s.vx, s.vz); if (speed < 1.2) return { s, velYaw: prevVelYaw };
  const velYaw = Math.atan2(s.vx, s.vz);
  const rate = prevVelYaw == null ? 0 : wrapAngle(velYaw - prevVelYaw) / dt;
  const lat = Math.abs(rate) * speed; // m/s² of cornering
  const ang = clamp((lat - 4) * 4.2, 0, 42); // degrees
  if (ang < 13 || speed < 7.5) return { s: { ...s, f: s.f & ~1 }, velYaw };
  const rel = (rate >= 0 ? 1 : -1) * ang / 57.3; // nose points to the inside of the corner
  return { s: { ...s, h: round2(wrapAngle(velYaw + rel)), f: s.f | 1, sl: round2(rel) }, velYaw };
}
// challenge variants: 'attack' = best single drift chain wins, 'timed' = total points in the time limit
export const CHALLENGE_VARIANTS = { timed: { name: 'Timed Challenge', defaultTime: 120 }, attack: { name: 'Score Attack', defaultTime: 180 } };
export const challengeScore = (variant, sum) => (variant === 'attack' ? sum.bestChain : sum.total);

// ==================================================================== DRIFT BATTLE
// Judges ONE run: a lead driver and a chase driver on a battle course. Feed samples with the
// run clock t (seconds since "go"). Scores are out of ~100 like real tandem judging.
export const BATTLE_PEN = { offcourse: 8, spin: 10, contact: 4, collision: 10 };
export class BattleRun {
  constructor(course) {
    this.course = course;
    this.lead = this.mkSide(); this.chase = this.mkSide();
    this.trail = []; // lead positions [t, x, z, speed, angle, side, drifting]
    this.done = false; this.endT = null; this.maxT = Math.max(45, course.length / 9);
    this.lastContact = -9;
  }
  mkSide() { return { kin: new Kinematics(), t: 0, time: 0, driftTime: 0, angSum: 0, ang2: 0, spdSum: 0, lineTime: 0, trans: 0, side: 0, sideT: 0, pen: [], offT: 0, off: false, spinning: false, hint: -1, prox: 0, spdM: 0, angM: 0, lineM: 0, crossedStart: false, prevS: null, finished: false }; }
  // shared per-sample bookkeeping; returns derived kinematics
  common(S, s, t) {
    const c = S.kin.push(s);
    const cp = pathDistance(this.course.path, s.x, s.z, S.hint, 40); S.hint = cp.k;
    const dt = c.dt; S.time += dt; S.t = t;
    const onLine = cp.d <= this.course.width / 2 + 1;
    if (onLine) S.lineTime += dt;
    const off = cp.d > this.course.width / 2 + 6;
    if (off) { S.offT += dt; if (!S.off && S.offT > 0.3) { S.off = true; S.pen.push({ kind: 'offcourse', t, pts: BATTLE_PEN.offcourse }); } }
    else { S.offT = 0; S.off = false; }
    const spinning = c.mode === 'spin' || (c.speed < 3 && t > 3 && !S.finished);
    if (spinning && !S.spinning) S.pen.push({ kind: 'spin', t, pts: BATTLE_PEN.spin });
    S.spinning = spinning;
    const ang = Math.abs(c.rel) * 57.3;
    const drifting = c.mode === 'drift' && ang > 12 && c.speed > 7;
    if (drifting) {
      S.driftTime += dt; S.angSum += ang * dt; S.ang2 += ang * ang * dt; S.spdSum += c.speed * dt;
      const side = Math.sign(c.rel);
      if (S.side && side !== S.side && S.sideT > 0.4) S.trans++;
      if (side !== S.side) S.sideT = 0;
      S.side = side; S.sideT += dt;
    }
    // end gate (lead only matters for finishing the run)
    const g = this.course.end;
    if (S.prevS && !S.finished) {
      const d0 = (S.prevS.x - g.x) * g.tx + (S.prevS.z - g.z) * g.tz, d1 = (s.x - g.x) * g.tx + (s.z - g.z) * g.tz;
      const lat = Math.abs((s.x - g.x) * -g.tz + (s.z - g.z) * g.tx);
      if (d0 < 0 && d1 >= 0 && lat < g.hw && !c.teleport) S.finished = true;
    }
    S.prevS = s;
    return { c, ang, drifting, cp };
  }
  pushLead(s, t) {
    if (this.done || t < 0) return;
    const { c, ang, drifting } = this.common(this.lead, s, t);
    this.trail.push([t, s.x, s.z, c.speed, ang, Math.sign(c.rel), drifting]);
    if (this.trail.length > 2000) this.trail.shift();
    if (this.lead.finished) this.finish(t);
    if (t > this.maxT) this.finish(t);
  }
  leadAt(t) {
    const T = this.trail; if (!T.length) return null;
    let i = T.length - 1; while (i > 0 && T[i][0] > t) i--;
    const a = T[i], b = T[Math.min(T.length - 1, i + 1)];
    const f = b[0] > a[0] ? clamp((t - a[0]) / (b[0] - a[0]), 0, 1) : 0;
    return { x: a[1] + (b[1] - a[1]) * f, z: a[2] + (b[2] - a[2]) * f, speed: a[3] + (b[3] - a[3]) * f, ang: a[4], side: a[5], drifting: a[6] };
  }
  pushChase(s, t) {
    if (this.done || t < 0) return;
    const S = this.chase, { c, ang, drifting } = this.common(S, s, t);
    const L = this.leadAt(t); if (!L) return;
    const dt = c.dt, d = Math.hypot(s.x - L.x, s.z - L.z);
    // contact / collisions (only the chaser is penalised — the chaser controls the gap)
    if (d < 2.4 && t - this.lastContact > 1.5) {
      const rel = Math.abs(c.speed - L.speed);
      S.pen.push({ kind: rel > 6 ? 'collision' : 'contact', t, pts: rel > 6 ? BATTLE_PEN.collision : BATTLE_PEN.contact });
      this.lastContact = t;
    }
    // proximity: 2.4–8 m is ideal; fades to zero by 25 m. Counts fully only while both are drifting.
    let prox = d < 2.4 ? 0.3 : d <= 8 ? 1 : Math.max(0, 1 - (d - 8) / 17);
    if (!(drifting && L.drifting)) prox *= 0.35;
    const spdM = 1 - Math.min(1, Math.abs(c.speed - L.speed) / 10);
    const angM = drifting && L.drifting && Math.sign(c.rel) === L.side ? 1 - Math.min(1, Math.abs(ang - L.ang) / 30) : 0;
    // following the lead's line: distance to where the lead drove in the last 4 s
    let line = 99;
    for (let i = this.trail.length - 1; i >= 0 && this.trail[i][0] > t - 4; i -= 2) line = Math.min(line, Math.hypot(s.x - this.trail[i][1], s.z - this.trail[i][2]));
    const lineM = 1 - Math.min(1, line / 6);
    S.prox += prox * dt; S.spdM += spdM * dt; S.angM += angM * dt; S.lineM += lineM * dt;
  }
  finish(t) { if (!this.done) { this.done = true; this.endT = t; } }
  scoreSide(S, role) {
    const T = Math.max(1, S.time), dt = Math.max(1e-3, S.driftTime);
    const angAvg = S.angSum / dt, angStd = Math.sqrt(Math.max(0, S.ang2 / dt - angAvg * angAvg)), spdAvg = S.spdSum / dt;
    const driftFrac = S.driftTime / T;
    const penalty = S.pen.reduce((a, p) => a + p.pts, 0);
    let parts;
    if (role === 'lead') {
      parts = {
        angle: 30 * clamp(angAvg / 45, 0, 1.1) * Math.min(1, driftFrac * 1.4),
        speed: 20 * clamp(spdAvg / 22, 0, 1.1) * Math.min(1, driftFrac * 1.4),
        line: 15 * (S.lineTime / T),
        consistency: 25 * driftFrac * clamp(1 - angStd / 25, 0.3, 1),
        transitions: 10 * Math.min(1, S.trans / 4),
      };
    } else {
      parts = {
        proximity: 35 * (S.prox / T), speedMatch: 20 * (S.spdM / T), angleMatch: 20 * (S.angM / T),
        line: 15 * (S.lineM / T), control: 10 * Math.min(1, driftFrac * 1.3),
      };
    }
    for (const k in parts) parts[k] = Math.round(parts[k] * 10) / 10;
    const raw = Object.values(parts).reduce((a, b) => a + b, 0);
    return { role, score: Math.max(0, Math.round((raw - penalty) * 10) / 10), raw: Math.round(raw * 10) / 10, parts, penalties: S.pen.map((p) => ({ kind: p.kind, pts: p.pts, t: Math.round(p.t * 10) / 10 })), penaltyTotal: penalty, avgAngle: Math.round(angAvg), driftPct: Math.round(driftFrac * 100) };
  }
  result() { return { lead: this.scoreSide(this.lead, 'lead'), chase: this.scoreSide(this.chase, 'chase'), time: Math.round((this.endT || this.lead.t) * 10) / 10, completed: this.lead.finished }; }
}
// combine the two runs of a battle: player A led run 1 and chased run 2, player B the opposite
export function battleTotals(run1, run2) {
  const a = { lead: run1.lead, chase: run2.chase }, b = { lead: run2.lead, chase: run1.chase };
  a.total = Math.round((a.lead.score + a.chase.score) * 10) / 10; b.total = Math.round((b.lead.score + b.chase.score) * 10) / 10;
  a.penalties = a.lead.penaltyTotal + a.chase.penaltyTotal; b.penalties = b.lead.penaltyTotal + b.chase.penaltyTotal;
  return { a, b, winner: a.total === b.total ? 0 : a.total > b.total ? 1 : 2 };
}
