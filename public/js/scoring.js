// Drift scoring.
// Base points flow only from CONTROLLED sliding: angle × speed × duration. The car's
// rotation relative to its direction of travel must be steady, and nothing accrues
// while the handbrake is held or while the car is spinning.
// Trick bonuses (added to the chain, then multiplied):
//   360       full rotation relative to travel, finishing still moving
//   REVERSE   controlled sliding backwards (points ×1.6 + bonus on exit)
//   DONUT     each full tight circle while drifting (diminishing for repeats)
//   TRANSITION switching drift direction without straightening
//   TANDEM    drifting alongside another drifting player (points ×1.5)
//   CHAIN     consecutive drifts linked within the grace window
// Spinning out (losing all speed mid-spin) or crashing loses the unbanked chain.
export const CHAIN_GRACE = 2.0;
const MAX_MULT = 8;
const TAU = Math.PI * 2;

export class DriftScorer {
  constructor(onEvent) {
    this.onEvent = onEvent || (() => {});
    this.reset();
  }
  reset() {
    this.total = 0; this.best = 0;
    this.chain = 0; this.combo = 0; this.mult = 1;
    this.active = false; this.grace = 0; this.segTime = 0; this.chainTime = 0;
    this.lastDir = 0; this.angle = 0; this.enabled = true;
    this.driftCount = 0; this.controlled = false;
    this.rot = 0; this.circ = 0; this.donutStreak = 0; this.donutIdle = 0; this.gripT = 0;
    this.revT = 0; this.tandemT = 0; this.tandem = false; this.prevMode = 'grip'; this.side = 0; this.sideT = 0;
    this.stats = { spins360: 0, donuts: 0, transitions: 0, reverse: 0, tandem: 0 };
  }
  get liveScore() { return this.chain * this.mult; }
  bonus(points, combo, type, data) { this.chain += points; if (combo) this.combo++; this.onEvent(type, { ...data, points: Math.round(points), combo: this.combo }); }

  // car: Vehicle; ctx: { tandem: bool }
  update(dt, car, ctx = {}) {
    if (!this.enabled) return;
    const speed = car.speed, mode = car.mode, rel = car.rel || 0;
    const revAng = Math.abs(((rel - Math.PI * Math.sign(rel || 1)) + 3 * Math.PI) % TAU - Math.PI);
    const ang = (mode === 'reverse' ? revAng : Math.abs(rel)) * 57.3;
    this.angle = ang;
    const relRate = Math.abs((car.w || 0) - (car.velRate || 0)); // how fast the car rotates relative to its travel
    const controlled = relRate < 1.7 && !car.handbrake;
    this.controlled = controlled;
    const sliding = mode !== 'grip';

    // ---------- 360 tracking (rotation relative to direction of travel)
    if (sliding && speed > 3) { this.rot += ((car.w || 0) - (car.velRate || 0)) * dt; this.gripT = 0; }
    else { this.gripT += dt; if (this.gripT > 0.5) this.rot = 0; }
    if (Math.abs(this.rot) >= TAU) {
      this.rot -= Math.sign(this.rot) * TAU;
      if (speed > 5) { this.stats.spins360++; this.bonus(1800 * Math.min(1.6, Math.max(0.7, speed / 14)), true, 'trick', { name: '360!' }); }
    }
    // ---------- spin out: lost all speed mid-rotation = uncontrolled
    if (mode === 'spin' && speed < 2.5 && this.chain > 0) { this.crash('spinout'); }
    if (car.teleport && this.chain > 0) this.crash('reset'); // a car reset ends the drift chain

    // ---------- donuts (tight full circles while drifting)
    const radius = Math.abs(car.velRate || 0) > 0.05 ? speed / Math.abs(car.velRate) : 1e9;
    if (mode === 'drift' && ang > 30 && speed > 2.5 && speed < 20 && radius < 14 && !car.handbrake) { this.circ += (car.velRate || 0) * dt; this.donutIdle = 0; } // no donuts with the handbrake held (no stationary spin farming)
    else { this.donutIdle += dt; if (this.donutIdle > 0.8) { this.circ = 0; if (this.donutIdle > 3) this.donutStreak = 0; } }
    if (Math.abs(this.circ) >= TAU) {
      this.circ -= Math.sign(this.circ) * TAU;
      const k = Math.max(0.25, Math.pow(0.8, this.donutStreak));
      this.donutStreak++; this.stats.donuts++;
      this.bonus(900 * k, this.donutStreak <= 4, 'trick', { name: this.donutStreak > 1 ? `DONUT ×${this.donutStreak}` : 'DONUT!' });
    }

    // ---------- reverse drift
    if (mode === 'reverse' && this.prevMode !== 'reverse' && speed > 5) this.onEvent('label', { text: 'REVERSE DRIFT!' });
    if (mode === 'reverse' && speed > 4) this.revT += dt;
    else if (this.revT > 0) {
      if (this.revT > 1) { this.stats.reverse++; this.bonus(Math.min(3000, 500 * this.revT), true, 'trick', { name: 'REVERSE DRIFT' }); }
      this.revT = 0;
    }

    // ---------- tandem
    const tandemNow = !!ctx.tandem && sliding && speed > 8;
    if (tandemNow) { this.tandemT += dt; if (!this.tandem && this.tandemT > 0.6) { this.tandem = true; this.onEvent('label', { text: 'TANDEM!' }); } }
    else if (this.tandemT > 0) {
      if (this.tandem && this.tandemT > 1.5) { this.stats.tandem++; this.bonus(Math.min(4000, 350 * this.tandemT), true, 'trick', { name: 'TANDEM' }); }
      this.tandemT = 0; this.tandem = false;
    }

    // ---------- transitions: drift direction flips while still sliding
    if (mode === 'drift' && Math.abs(rel) > 0.2) {
      const side = Math.sign(rel);
      if (this.side && side !== this.side && this.sideT > 0.35 && speed > 8) {
        this.stats.transitions++; this.segTime = 0; this.lastDir = side;
        this.bonus(300 + speed * 15, true, 'transition', {});
      }
      if (side !== this.side) this.sideT = 0;
      this.side = side; this.sideT += dt;
    } else if (!sliding && this.gripT > 0.5) { this.side = 0; this.sideT = 0; }

    // ---------- base points from controlled sliding
    let scoring = false, rateMul = 1;
    if (mode === 'drift' && ang > 12 && speed > 7 && controlled && car.forwardSpeed > 1) scoring = true;
    if (mode === 'reverse' && ang < 55 && speed > 5 && controlled) { scoring = true; rateMul = 1.6; }
    if (this.tandem) rateMul *= 1.5;
    const donutting = mode === 'drift' && ang > 30 && speed > 2.5 && radius < 14 && !car.handbrake;
    const keepAlive = scoring || donutting || mode === 'spin' || (mode === 'reverse' && speed > 4) || (sliding && car.handbrake && speed > 5) || (mode === 'drift' && this.sideT < 0.6 && speed > 8);

    if (scoring) {
      const dir = mode === 'drift' ? Math.sign(rel) : 0;
      if (!this.active) {
        this.active = true;
        // a NEW link in the chain needs a real gap after a real drift; brief blips just continue the same drift
        const newDrift = (this.gapT || 0) >= 0.35 && (this.lastSeg || 0) >= 0.6;
        if (this.chain > 0) { if (newDrift) { this.combo++; this.segTime = 0; this.driftCount++; this.onEvent('combo', { combo: this.combo }); } }
        else { this.combo = 0; this.chainTime = 0; this.segTime = 0; this.driftCount++; }
      }
      if (dir) this.lastDir = dir;
      this.segTime += dt; this.chainTime += dt;
      const angleF = Math.min(1.5, Math.max(0, (ang - 10) / 30));
      const speedF = Math.min(2.4, speed / 16);
      const durF = 1 + Math.min(this.segTime, 6) * 0.18;
      this.chain += 110 * angleF * speedF * durF * rateMul * dt;
      if (ang > 55 && this.segTime > 0.5 && !this._bigAngle) { this._bigAngle = true; this.onEvent('label', { text: 'BIG ANGLE!' }); }
    } else if (this.active) { this.active = false; this._bigAngle = false; this.lastSeg = this.segTime; this.gapT = 0; }
    if (!this.active) this.gapT = (this.gapT || 0) + dt;
    if (keepAlive) { if (this.chain > 0 || scoring) this.grace = CHAIN_GRACE; }
    else if (this.chain > 0) {
      this.grace -= dt;
      if (this.grace <= 0) this.bank();
    }
    this.mult = Math.min(this.maxMult || MAX_MULT, 1 + this.combo * 0.5 + Math.floor(this.chainTime / 5) * 0.5);
    this.prevMode = mode;
  }

  bank() {
    if (this.chain <= 0) return 0;
    const v = Math.round(this.chain * this.mult);
    this.total += v;
    const isBest = v > this.best;
    if (isBest) this.best = v;
    this.onEvent('banked', { value: v, best: isBest, label: tier(v) });
    this.chain = 0; this.combo = 0; this.mult = 1; this.chainTime = 0; this.grace = 0; this.lastDir = 0; this.active = false; this.rot = 0;
    return v;
  }
  crash(kind = 'crash') {
    if (this.chain > 0) {
      const lost = Math.round(this.chain * this.mult);
      this.chain = 0; this.combo = 0; this.mult = 1; this.chainTime = 0; this.grace = 0; this.active = false; this.rot = 0; this.circ = 0;
      this.onEvent(kind, { lost });
    }
  }
}

function tier(v) {
  if (v > 60000) return 'LEGENDARY DRIFT';
  if (v > 30000) return 'INSANE DRIFT';
  if (v > 15000) return 'AWESOME DRIFT';
  if (v > 6000) return 'GREAT DRIFT';
  if (v > 2000) return 'NICE DRIFT';
  return 'DRIFT';
}

export const MODES = [
  { id: 'endless', name: 'Endless', icon: '∞', desc: 'Drive as long as you like. No timer, no objectives — explore and earn drift points.', score: true, timer: false, challenges: false, crashPenalty: true, board: true },
  { id: 'standard', name: 'Standard', icon: '◆', desc: 'Classic drifting with optional timed drift challenges marked on the map.', score: true, timer: false, challenges: true, crashPenalty: true, board: true },
  { id: 'chill', name: 'Chill', icon: '☾', desc: 'Pure cruising. No score, no timers, no crash penalties. Just vibes and music.', score: false, timer: false, challenges: false, crashPenalty: false, board: false },
  { id: 'competitive', name: 'Competitive', icon: '⚑', desc: 'Timed rounds. Highest drift score wins each round — angle, speed, duration and combos all count.', score: true, timer: true, challenges: false, crashPenalty: true, board: true, rounds: true },
];
// Competitive modes (comp: …) — see compmodes.js. They keep their own setup screens and use the
// server for official timing/scoring online.
MODES.push(
  { id: 'challenge', comp: 'challenge', name: 'Drift Challenge', icon: '★', desc: 'Score Attack or Timed Challenge. Angle, speed, distance, smoothness and combos count; crashes and leaving the track cost you.', score: true, timer: true, challenges: false, crashPenalty: true, board: true },
  { id: 'race', comp: 'race', name: 'Speed Race', icon: '⚑', desc: 'Circuit racing: starting grid, countdown, laps, checkpoints, positions and best laps. Race CPU drivers solo or friends online.', score: false, timer: true, challenges: false, crashPenalty: false, board: true },
  { id: 'driftrace', comp: 'driftrace', name: 'Drift Race', icon: '≋', desc: 'A race where style pays: drift points earned on the way plus a bonus for where you finish. Out-drift the field or out-run it.', score: true, timer: true, challenges: false, crashPenalty: false, board: true },
  { id: 'battle', comp: 'battle', name: 'Drift Battle', icon: '⇄', desc: 'Head-to-head tandem: lead one run, chase the other. Judged on angle, line and proximity. Solo: chase your own ghost.', score: false, timer: true, challenges: false, crashPenalty: false, board: false },
);
export const FREE_MODES = MODES.filter((m) => !m.comp);
export const COMP_MODES = MODES.filter((m) => m.comp);
export const modeById = (id) => MODES.find((m) => m.id === id) || MODES[0];
