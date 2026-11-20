// Arcade drift physics with a real 4-wheel suspension.
//
// HORIZONTAL: four handling regimes, blended smoothly:
//   grip    – kinematic bicycle model with a lateral-grip limit
//   drift   – low lateral grip; an angle controller drives yaw so the drift angle follows
//             the player's throttle + steering (adjustable max angle, smooth transitions)
//   spin    – handbrake + steering held into the rotation lets the car rotate past the
//             angle limit (360s), keeping momentum
//   reverse – sliding backwards (after a 180 / J-turn / reverse handbrake), steerable
// Two driving styles (DRIVE_STYLES) change the actual physics parameters.
//
// DRIFT ENTRY (besides handbrake / power-over / big slip): a clutch kick (lift and re-floor the
// throttle while turning) or a feint (swing the steering one way, then hard the other way) throws
// the rear out. Braking or lifting while turning moves weight forward and makes the rear lighter.
//
// VERTICAL: each wheel is a spring + damper against the terrain under it. Body height,
// pitch and roll are integrated from the wheel forces (plus weight transfer from
// acceleration/cornering), so the car follows hills and bumps without launching.
import { clamp, damp, moveTowards, wrapAngle, lerp } from './engine/math.js';

export const PHYS_DT = 1 / 120;
const G = 9.81;

export const DRIVE_STYLES = {
  drift: {
    name: 'Drift', desc: 'Easy drift entry, throttle-steerable angle, quick left/right transitions, forgiving.',
    grip: 0.92, lat: 0.95, steerResp: 1.0, driftGrip: 0.82, powerOverAdd: 0.3, entrySlip: 0.22, hbEntrySpeed: 4.5,
    angleGain: 4.2, momentum: 1.25, swing: true, minAngle: 0.14, exitHold: 0.3, maxAngleCap: 1.4, powerDelay: 0.25, stability: 0,
  },
  race: {
    name: 'Race', desc: 'High grip, precise steering and faster cornering. Slides straighten out quickly.',
    grip: 1.3, lat: 1.55, steerResp: 1.35, driftGrip: 1.75, powerOverAdd: -0.4, entrySlip: 0.45, hbEntrySpeed: 9,
    angleGain: 3.2, momentum: 0.95, swing: false, minAngle: 0.04, exitHold: 0.12, maxAngleCap: 0.75, powerDelay: 9, stability: 1,
    // steering geometry: more lock than the car's base value, and a speed-dependent range that keeps the
    // front-wheel angle close to what the tyres can actually use (see steerLimit)
    lock: 1.15, speedSteer: { slack: 1.7, minFrac: 0.24 },
  },
};

// suspension constants (per unit mass)
const K = 55, KD = 5.5, DROOP = 0.26, PRELOAD = G / (4 * K), BUMP = 0.2, AIR_G = 1.9, AERO = 0.0036;
// Tuning hooks (def.tune, built by tuning.js). These defaults are exactly the untuned behaviour.
export const STOCK_PHYS = Object.freeze({
  brake: 15, brakeBias: 0, brakeKick: 0, hbForce: 3.2, hbGrip: 0.55, hbEntry: 1, frontGrip: 1, rearGrip: 1, surfSens: 1,
  launch: 1, tractionAccel: 0, shiftGain: 0, shiftKick: 0, susK: 1, susD: 1, cgH: 0.42, bump: BUMP, ride: 0,
  steerRate: 1, yawResp: 1, stab: 1, steerSlack: 1, entry: 1, angleGain: 1, exitHold: 1,
});

export class Vehicle {
  constructor(def, world, dims, opts = {}) {
    this.def = def; this.world = world; this.dims = dims;
    this.T = def.tune || STOCK_PHYS; this.wheelspin = 0; this.kickT = 0;
    this.x = 0; this.z = 0; this.y = 0; this.h = 0;
    this.vx = 0; this.vz = 0; this.w = 0; this.vy = 0;
    this.steer = 0; this.mode = 'grip'; this.driftAmt = 0; this.dir = 1; this.straightT = 0; this.swingT = 0;
    this.spinDir = 1; this.powerT = 0;
    this.slip = 0; this.rel = 0; this.velRate = 0; this.prevVelYaw = null;
    this.load = 0; this.visSteer = 0; this.bodyPitchVel = 0; this.bodyRollVel = 0;
    this.thrHighT = 9; this.liftT = 9; this.feintT = 9; this.feintDir = 0; this.lastSteerSide = 0; this.shiftT = 0;
    this.mass = def.mass || 1;
    this.pitch = 0; this.roll = 0; this.pitchVel = 0; this.rollVel = 0; this.bodyPitch = 0; this.bodyRoll = 0;
    this.contact = 1; this.traction = 1; this.airTime = 0; this.slopeF = 0; this.spinT = 0;
    this.spin = 0; this.rpm = 0.1; this.gear = 1; this.boost = 1; this.boosting = false;
    this.surface = null; this.impact = 0; this.lastImpact = 0; this.throttle = 0; this.brakeOn = false; this.reversing = false; this.handbrake = false;
    this.radius = dims.W * 0.5;
    this.offset = dims.L * 0.27;
    this.gears = [0, 0.18, 0.34, 0.5, 0.67, 0.84, 1.01];
    const wx = dims.W * 0.42, fz = dims.L * 0.33, rz = -dims.L * 0.33;
    this.wheelLocal = [[wx, fz], [-wx, fz], [wx, rz], [-wx, rz]];
    this.wheelGround = [0, 0, 0, 0]; this.wheelComp = [0, 0, 0, 0]; this.wheelOffset = [0, 0, 0, 0];
    this.Ip = Math.max(1.2, (dims.L * dims.L) / 12); this.Ir = Math.max(0.4, (dims.W * dims.W) / 10);
    this.setStyle(opts.style || 'drift', opts.maxAngle);
    this.savePrev();
  }
  // remember the state at the start of a physics step, for smooth rendering between steps
  savePrev() { this.px = this.x; this.py = this.y; this.pz = this.z; this.ph = this.h; this.pPitch = this.pitch; this.pRoll = this.roll; }
  // position/heading blended between the last two physics steps (alpha 0..1); heading wraps safely
  renderState(alpha = 1) {
    const a = clamp(alpha, 0, 1);
    return {
      x: lerp(this.px, this.x, a), y: lerp(this.py, this.y, a), z: lerp(this.pz, this.z, a),
      h: wrapAngle(this.ph + wrapAngle(this.h - this.ph) * a),
      pitch: lerp(this.pPitch, this.pitch, a), roll: lerp(this.pRoll, this.roll, a),
    };
  }
  setStyle(style, maxAngleDeg) {
    this.styleId = DRIVE_STYLES[style] ? style : 'drift';
    this.S = DRIVE_STYLES[this.styleId];
    if (maxAngleDeg) this.maxAngleSetting = clamp(maxAngleDeg, 30, 85) * Math.PI / 180;
    else if (!this.maxAngleSetting) this.maxAngleSetting = 62 * Math.PI / 180;
    this.maxAngle = Math.min(this.maxAngleSetting, this.S.maxAngleCap);
  }
  get drifting() { return this.mode !== 'grip'; }
  // max front-wheel angle (rad) at a standstill for this car + driving style
  get lock() { return this.def.steer * (this.S.lock || 1); }
  // actual average front-wheel angle (rad, + = left) - used by the visuals and sent to other players
  // while sliding the front wheels point along the direction of travel (counter-steer), like a real drift car
  get wheelAngle() { return this.visSteer; }
  // fraction of full lock available while gripping at this speed
  steerLimit(speed, gS = 1) {
    const S = this.S, ss = S.speedSteer;
    if (!ss) return 1 / (1 + speed * 0.022 * (1 + (this.T.stab - 1) * 0.5) / S.steerResp); // drift style
    // low speed: full lock for tight turns. Higher up: the angle that produces the tyres' maximum
    // cornering force (wb * aMax / v^2), with some slack so the driver can feel the limit,
    // never less than minFrac of full lock so the car stays steerable at top speed.
    const aMax = this.def.lat * S.lat * gS * this.T.frontGrip, v2 = Math.max(1, speed * speed);
    const need = Math.atan(this.def.wb * aMax / v2) * ss.slack * this.T.steerSlack;
    return clamp(need / this.lock, ss.minFrac, 1);
  }
  get speed() { return Math.hypot(this.vx, this.vz); }
  get forwardSpeed() { return this.vx * Math.sin(this.h) + this.vz * Math.cos(this.h); }

  place(x, z, h) {
    this.x = x; this.z = z; this.h = h; this.vx = this.vz = this.w = 0; this.steer = 0;
    this.mode = 'grip'; this.driftAmt = 0; this.slip = 0; this.rel = 0; this.velRate = 0; this.prevVelYaw = null;
    this.vy = 0; this.pitchVel = 0; this.rollVel = 0;
    this.sampleWheels();
    const gF = (this.wheelGround[0] + this.wheelGround[1]) / 2, gB = (this.wheelGround[2] + this.wheelGround[3]) / 2;
    const gL = (this.wheelGround[0] + this.wheelGround[2]) / 2, gR = (this.wheelGround[1] + this.wheelGround[3]) / 2;
    const lz = this.wheelLocal[0][1] - this.wheelLocal[2][1], lx = this.wheelLocal[0][0] - this.wheelLocal[1][0];
    this.pitch = -Math.atan2(gF - gB, lz); this.roll = Math.atan2(gL - gR, lx);
    this.y = this.wheelGround.reduce((a, b) => a + b, 0) / 4;
    this.prevGround = this.wheelGround.slice();
    this.contact = 1; this.traction = 1; this.slopeF = -Math.sin(this.pitch);
    this.load = 0; this.visSteer = 0; this.bodyPitch = this.bodyRoll = this.bodyPitchVel = this.bodyRollVel = 0;
    this.thrHighT = 9; this.liftT = 9; this.feintT = 9; this.feintDir = 0; this.lastSteerSide = 0;
    this.savePrev(); // a teleport must not be smeared by render interpolation
  }

  sampleWheels() {
    const W = this.world, sh = Math.sin(this.h), ch = Math.cos(this.h), floor = W.waterY - 0.6;
    for (let i = 0; i < 4; i++) {
      const [lx, lz] = this.wheelLocal[i];
      const px = this.x + ch * lx + sh * lz, pz = this.z - sh * lx + ch * lz;
      // tyre footprint: the wheel rolls over edges instead of hitting them like a wall
      const r = this.dims.wheelR * 0.9;
      const g = Math.max(W.heightAt(px, pz), W.heightAt(px + sh * r, pz + ch * r) - 0.03, W.heightAt(px - sh * r, pz - ch * r) - 0.03);
      this.wheelGround[i] = g < floor ? floor : g;
    }
  }

  // inp: throttle 0..1, brake 0..1, steer -1..1 (+left), handbrake bool, boost bool
  step(dt, inp) {
    const d = this.def, S = this.S, W = this.world;
    this.savePrev();
    const sh = Math.sin(this.h), ch = Math.cos(this.h);
    const fx = sh, fz = ch, rx = -ch, rz = sh;
    let vf = this.vx * fx + this.vz * fz;
    let vl = this.vx * rx + this.vz * rz; // + = sliding to the right (nose points left of travel)
    const speed = Math.hypot(vf, vl);
    const surf = this.surface = W.surfaceAt(this.x, this.z);
    const T = this.T;
    const gS = T.surfSens === 1 ? surf.grip : clamp(1 - (1 - surf.grip) * T.surfSens, 0.2, 1.05), tr = this.traction; // tyre compound vs surface
    const hb = this.handbrake = !!inp.handbrake;
    const thr = inp.throttle;

    // ---------------- travel direction & drift angle (full -180..180 range)
    const velYaw = Math.atan2(this.vx, this.vz);
    // how fast the travel direction turns (rad/s). Clamped so a sudden change (e.g. a bump) can't make
    // the drift controllers below chase a huge number and spin the car.
    if (speed > 1.2 && this.prevVelYaw !== null) this.velRate = damp(this.velRate, clamp(wrapAngle(velYaw - this.prevVelYaw) / dt, -6, 6), 25, dt);
    else this.velRate = damp(this.velRate, 0, 10, dt);
    this.prevVelYaw = speed > 1.2 ? velYaw : null;
    const rel = this.rel = speed > 1.2 ? wrapAngle(this.h - velYaw) : 0; // + = nose left of travel
    const absRel = Math.abs(rel);
    const revRel = wrapAngle(rel - Math.PI); // angle to straight-backwards travel
    const effPower = clamp(d.powerOver + S.powerOverAdd, 0, 1);

    // ---------------- steering (speed sensitive in grip, full lock while sliding)
    const sens = inp.steerSens || 1;
    const limit = this.mode !== 'grip' ? 1 : this.steerLimit(speed, gS);
    const target = clamp(inp.steer * sens, -1, 1) * limit;
    const rate = (inp.analog ? 9 : 4.4) * S.steerResp * T.steerRate * (Math.abs(target) < Math.abs(this.steer) || Math.sign(target) !== Math.sign(this.steer) ? 1.7 : 1);
    this.steer = moveTowards(this.steer, target, rate * dt);
    const st = this.steer;

    // ---------------- longitudinal
    const boostOn = inp.boost && this.boost > 0.02 && thr > 0.1;
    this.boosting = boostOn;
    const top = d.top * (boostOn ? 1.12 : 1);
    let F = 0;
    this.brakeOn = false; this.reversing = false;
    let spinFrac = 0;
    if (thr > 0) {
      if (vf > -1) {
        const r = Math.max(0, vf) / top, curve = thr * Math.max(0, 1 - Math.pow(r, 2.2));
        let drive = d.accel * curve * (r < 0.12 ? 1.15 * T.launch : 1) * (this.gear >= 2 ? 1 + T.shiftGain : 1);
        if (T.tractionAccel) {
          // tuned cars: drive beyond what the stock car makes is limited by what the rear tyres can put down
          const stockDrive = T.tractionAccel * curve * (r < 0.12 ? 1.15 : 1);
          const limit = Math.max(stockDrive, d.grip * S.grip * gS * T.rearGrip * 0.95 * tr);
          if (drive > limit) { spinFrac = (drive - limit) / drive; drive = limit; }
        }
        F += drive * (boostOn ? 1.55 : 1);
      } else { F += 14 * thr; this.brakeOn = true; }
    }
    this.wheelspin = damp(this.wheelspin, spinFrac, 12, dt);
    if (inp.brake > 0) {
      if (vf > 1) { F -= T.brake * inp.brake * (1 - 0.12 * Math.abs(T.brakeBias)); this.brakeOn = true; } // off-balance brakes lock one axle
      else if (vf > -13) { F -= d.accel * 0.6 * inp.brake; this.reversing = vf < -0.2; }
    }
    F *= tr; // no drive / brakes while the wheels are off the ground
    if (boostOn) this.boost = Math.max(0, this.boost - dt * 0.28);
    if (hb && this.mode !== 'spin') F -= Math.sign(vf) * Math.min(Math.abs(vf) / dt, T.hbForce) * tr;
    F -= vf * Math.abs(vf) * (d.accel / (top * top)) * 0.25;
    F -= vf * (0.06 + surf.drag * 0.9) * tr;
    if (thr === 0 && inp.brake === 0 && !hb) F -= Math.sign(vf) * Math.min(Math.abs(vf) / dt, 0.9) * tr;
    F -= G * this.slopeF * 0.85 * tr; // gravity along the slope
    if (this.mode !== 'grip' && this.mode !== 'spin') {
      // sliding scrubs speed. Holding a moderate counter-steer (steering against the slide, as a real
      // drifter does to hold the line) scrubs less, so smooth, skilled drifts keep more speed.
      const cs = this.mode === 'drift' ? clamp(-st * this.dir, 0, 1) : 0;
      const skill = clamp(1 - Math.abs(cs - 0.45) * 2.5, 0, 1);
      F -= vf * Math.abs(Math.sin(this.slip)) * 0.35 * (1 - 0.3 * skill);
    }
    const vfPrev = vf;
    if (this.mode === 'spin') F *= 0.1; // spinning: driven wheels just spin
    vf += F * dt;
    if (inp.brake > 0 && vfPrev > 1 && vf < 0) vf = 0;
    // weight transfer (in g): + = accelerating (weight on the rear), - = braking / lifting (weight on the nose).
    // Taller cars with shorter wheelbases shift more weight.
    const wt = (T.cgH / 0.42) * (2.6 / d.wb);
    this.load = damp(this.load, clamp((vf - vfPrev) / dt / G, -1.2, 1.2) * wt, 8, dt);
    const lf = clamp(this.load, -0.9, 0.6);

    // ---------------- drift entry by technique (only from normal grip driving)
    // clutch kick: a quick lift (< 0.3 s) from full throttle, then floor it again while turning
    this.thrHighT = thr > 0.8 ? 0 : this.thrHighT + dt;
    if (thr < 0.2 && this.liftT > 5) { this.liftT = 0; this.liftFromPower = this.thrHighT < 0.25; this.liftBraked = false; } // a lift starts
    if (inp.brake > 0.1) this.liftBraked = true; // braking in between = normal driving, not a kick
    if (this.liftT <= 5) this.liftT += dt;
    if (thr > 0.9 && this.throttle <= 0.9) { // throttle floored again
      if (this.mode === 'grip' && this.liftFromPower && !this.liftBraked && this.liftT < 0.45 && Math.abs(inp.steer) > 0.5 && vf > 8 && speed < 40) {
        const k = Math.sign(inp.steer);
        this.enterDrift(k); this.w += k * (0.7 + 0.35 * d.driftPower) * (S.stability ? 0.6 : 1); this.wheelspin = 0.6;
      }
      this.liftT = 9;
    }
    if (this.liftT > 0.6 && this.liftT <= 5) this.liftT = 9; // too slow to count as a kick
    // feint (Scandinavian flick): turning one way, swing the steering hard the other way -> the rear
    // swings out and the car drifts into the new direction (Drift style)
    const side = Math.abs(inp.steer) > 0.6 ? Math.sign(inp.steer) : 0;
    if (side) {
      if (S.swing && this.mode === 'grip' && side !== this.lastSteerSide && this.lastSteerSide && this.feintT < 0.4 &&
          speed > 13 && vf > 0 && thr > 0.3 && this.w * side < -0.3) {
        this.enterDrift(side); this.w = side * (0.9 + 0.3 * d.driftPower);
      }
      this.lastSteerSide = side; this.feintT = 0;
    } else this.feintT += dt;

    // ---------------- regime state machine
    const prevMode = this.mode;
    const steerIn = st * this.dir;
    this.hbRecent = hb ? 0.35 : Math.max(0, (this.hbRecent || 0) - dt); // a handbrake tap counts for a moment
    this.spinArm = hb && steerIn > 0.7 ? (this.spinArm || 0) + dt : 0;
    if (this.mode === 'grip') {
      const wantPower = effPower > 0.4 && speed > 6 && speed < 40 && vf > 0 && thr > 0.85 && Math.abs(inp.steer) > 0.7;
      this.powerT = wantPower ? this.powerT + dt : 0;
      if (vf > 0 && speed > S.hbEntrySpeed * T.hbEntry * T.entry && hb && Math.abs(st) > 0.12) this.enterDrift(Math.sign(st));
      else if (vf > 0 && speed > 7 && absRel > S.entrySlip * T.entry && absRel < 1.5) this.enterDrift(Math.sign(rel));
      else if (this.powerT > S.powerDelay * T.entry) this.enterDrift(Math.sign(inp.steer));
      else if (speed > 1.2 && speed < 9 && vf > 0 && hb && thr > 0.7 && Math.abs(inp.steer) > 0.75) { this.enterDrift(Math.sign(inp.steer)); this.w += Math.sign(inp.steer) * 1.6; } // donut start
      else if (vf < -5 && hb && Math.abs(st) > 0.2) this.mode = 'reverse';
      else if (vf < -6 && Math.abs(revRel) > 0.45) this.mode = 'reverse';
    } else if (this.mode === 'drift') {
      if (absRel > 0.12 && Math.sign(rel) !== this.dir) { this.dir = Math.sign(rel); this.swingLatch = false; }
      if (this.spinArm > 0.15 && absRel > Math.min(this.maxAngle * 0.78, 0.9) && speed > 4) { this.mode = 'spin'; this.spinDir = this.dir; this.spinT = 0; }
      if (!hb && absRel < 0.1 && Math.abs(this.w - this.velRate) < 0.6) this.straightT += dt; else this.straightT = 0;
      if (this.straightT > S.exitHold * T.exitHold || speed < (thr > 0.5 ? 1.8 : 3.5) || vf < -2 && absRel < 1.2) this.mode = 'grip';
      else if (absRel > 1.9) this.mode = 'reverse';
    } else if (this.mode === 'spin') {
      this.spinT += dt;
      if (!hb || st * this.spinDir < 0.3) {
        if (absRel < 1.55) { this.mode = 'drift'; this.dir = Math.sign(rel) || this.spinDir; }
        else this.mode = 'reverse';
      }
      if (speed < (hb && st * this.spinDir > 0.3 ? 0.5 : 2)) this.mode = 'grip';
    } else if (this.mode === 'reverse') {
      if (speed < 2.5) this.mode = 'grip';
      else if (absRel < 1.35) { this.mode = 'drift'; this.dir = Math.sign(rel) || 1; }
    }
    if (this.mode !== prevMode) { this.straightT = 0; this.swingT = 0; }
    const sliding = this.mode !== 'grip';
    this.driftAmt = moveTowards(this.driftAmt, sliding ? 1 : 0, (sliding ? 7 : 3.2) * dt);

    // ---------------- lateral grip (blended between grip and slide values)
    let gripLat = d.grip * S.grip * gS * (1 - effPower * thr * Math.abs(st) * 0.55) * T.rearGrip;
    if (this.wheelspin > 0.01) gripLat *= 1 - 0.6 * this.wheelspin; // wheelspin = power oversteer
    if (this.kickT > 0) { this.kickT -= dt; gripLat *= 1 - T.shiftKick; } // sequential upshift jolt
    gripLat *= 1 + lf * 0.28; // braking / lifting unloads the rear tyres (lift-off oversteer, trail-brake rotation)
    if (inp.brake > 0 && vf > 3) { // brake balance: rear bias rotates the car, hard race brakes unsettle it
      gripLat *= 1 - inp.brake * (0.15 * Math.max(0, T.brakeBias) + T.brakeKick * Math.abs(st));
    }
    let slideLat = d.driftGrip * S.driftGrip * (0.75 + 0.25 * gS) * (T.rearGrip === 1 ? 1 : Math.sqrt(T.rearGrip));
    if (this.mode === 'spin') slideLat *= 0.32;
    else if (this.mode === 'reverse') slideLat *= hb ? 0.5 : 0.85;
    else {
      if (hb) slideLat *= T.hbGrip;
      slideLat = slideLat * (1 - 0.32 * thr) + (1 - thr) * (S.stability ? 1.6 : 0.85);
    }
    const latGrip = lerp(gripLat, slideLat, this.driftAmt) * (0.15 + 0.85 * tr);
    // spinning: tyres slide every way, so they don't bend the car's path - it keeps going straight while it rotates
    const inSpin = this.mode === 'spin';
    const nvl = inSpin ? vl : vl * Math.exp(-latGrip * dt);
    const lost = inSpin ? 0 : Math.abs(vl) - Math.abs(nvl);
    // part of the sideways energy the tyres scrub off is turned into forward speed (that's what keeps a
    // drift flowing). Energy-based, so a slide can never create speed out of nothing.
    const mom = sliding ? Math.min(0.97, d.momentum * S.momentum) : 0.12;
    if (lost > 0) vf = Math.sign(vf || 1) * Math.sqrt(vf * vf + (vl * vl - nvl * nvl) * mom * (sliding ? 1 : (vf > 0 ? 1 : 0.3)));
    vl = nvl;
    if (inSpin) { const sp = Math.hypot(vf, vl); if (sp > 1e-6) { const k = Math.max(0, sp - (hb ? 5.5 : 4) * tr * dt) / sp * Math.exp(-0.3 * dt); vf *= k; vl *= k; } }

    // ---------------- yaw
    const spd = clamp(speed / 14, 0.5, 1.25);
    let targetW, resp;
    if (this.mode === 'grip') {
      const ang = st * this.lock;
      targetW = (vf * Math.tan(ang)) / d.wb;
      let maxW = (d.lat * S.lat * gS * T.frontGrip * (1 + effPower * thr * 0.35)) / Math.max(3, speed);
      if (inp.brake > 0 && T.brakeBias < 0 && vf > 3) maxW *= 1 + 0.12 * T.brakeBias * inp.brake; // front bias: understeer
      maxW *= 1 - lf * (lf < 0 ? 0.2 : 0.06); // weight on the nose = sharper turn-in, weight on the tail = a little understeer
      targetW = clamp(targetW, -maxW, maxW);
      if (hb && speed > 3) targetW *= 1.35;
      // race style: stability assist. Normal cornering slip is left alone; only a real slide
      // (beyond ~6 degrees) is caught, so it can't eat the car's turning ability.
      if (S.stability && speed > 8) targetW -= Math.sign(rel) * Math.max(0, Math.abs(rel) - 0.1) * 3.0 * T.stab;
      resp = 11 * S.steerResp * T.yawResp;
    } else if (this.mode === 'drift') {
      // angle controller: throttle and steering set the drift angle
      // driftPower: how much angle the throttle buys (powerful drift cars swing wider on the throttle)
      let frac = S.minAngle + 0.5 * thr * d.driftPower + 0.36 * steerIn + (hb ? 0.25 : 0);
      frac = clamp(frac, 0.03, 1);
      // lifting off (no handbrake, not steering into it) lets the car straighten up and grip again
      if (thr < 0.25 && steerIn < 0.3 && !hb) frac = 0;
      let maxA = this.maxAngle;
      // donuts: at low speed with full lock + throttle the car can swing round past the normal limit
      if (speed < 13 && thr > 0.8 && steerIn > 0.85) maxA = Math.max(maxA, S.stability ? 1.25 : 1.45);
      let desired = this.dir * maxA * frac;
      // full counter-lock held = swing into a drift the other way (Drift style)
      // (Race style: a handbrake flick with opposite lock commits the swing until the car crosses over)
      if ((S.swing || this.hbRecent > 0 || this.swingLatch) && steerIn < (this.swingLatch ? -0.4 : -0.8) && speed > 6) {
        this.swingT += dt;
        if (this.swingT > (S.swing ? 0.12 : 0.06)) { desired = -this.dir * this.maxAngle * (0.45 + 0.4 * thr); if (this.hbRecent > 0) this.swingLatch = true; }
      } else { this.swingT = 0; this.swingLatch = false; }
      targetW = this.velRate + (desired - rel) * S.angleGain * T.angleGain * spd * (d.driftSteer / 2.1);
      if (absRel > maxA + 0.3) targetW -= Math.sign(rel) * (absRel - maxA - 0.3) * 8;
      targetW = clamp(targetW, this.velRate - 4.5, this.velRate + 4.5);
      resp = 7.5 / Math.sqrt(this.mass); // heavy cars swing their weight round more slowly
    } else if (this.mode === 'spin') {
      targetW = this.velRate + this.spinDir * (4.4 + Math.min(speed, 25) * 0.06);
      resp = 4.5;
    } else { // reverse: steering rotates the car, it self-aligns to straight-backwards
      targetW = this.velRate + st * 2.1 * spd - revRel * 1.7;
      resp = 6;
    }
    this.w = damp(this.w, targetW, resp * (0.08 + 0.92 * tr), dt);
    if (speed < 0.5 && !thr && !inp.brake) this.w *= 0.9;

    // front wheels for the visuals: while drifting they counter-steer toward the travel direction
    let vis = st * this.lock;
    if (this.mode === 'drift' && speed > 2) {
      const L = this.lock * 1.2, cs = clamp(-rel, -L, L) + st * this.lock * 0.35;
      vis = lerp(vis, clamp(cs, -L, L), this.driftAmt);
    }
    this.visSteer = damp(this.visSteer, vis, 16, dt);

    // rebuild world velocity from the OLD axes (heading change creates slip naturally)
    this.vx = fx * vf + rx * vl; this.vz = fz * vf + rz * vl;
    this.h = wrapAngle(this.h + this.w * dt);
    this.x += this.vx * dt; this.z += this.vz * dt;

    // ---------------- collisions
    this.impact = 0;
    this.collide();

    // ---------------- suspension
    this.suspension(dt, (vf - vfPrev) / dt, this.w * speed);
    this.bodyLean(dt, speed);

    // ---------------- telemetry
    const s2 = Math.sin(this.h), c2 = Math.cos(this.h);
    const vf2 = this.vx * s2 + this.vz * c2, vl2 = -this.vx * c2 + this.vz * s2;
    this.slip = speed > 1.5 ? Math.atan2(vl2, Math.abs(vf2)) : 0;
    const spinning = this.mode !== 'grip' && thr > 0.5;
    this.spin += (vf / this.dims.wheelR) * dt * (spinning ? 1.5 : 1) * (hb ? 0.2 : 1) + (spinning && speed < 8 ? thr * 18 * dt : 0);
    this.throttle = thr;
    const frac = Math.max(0, vf) / d.top;
    let g = 1; while (g < 6 && frac > this.gears[g]) g++;
    if (T.shiftKick && g > this.gear && this.gear >= 1) this.kickT = 0.15;
    if (g !== this.gear && this.gear >= 1 && g >= 1) this.shiftT = 0.12; // revs drop quickly on a gear change
    this.shiftT = Math.max(0, this.shiftT - dt);
    this.gear = vf < -0.5 ? -1 : g;
    const lo = this.gears[g - 1], hi = this.gears[g];
    let rpm = 0.25 + 0.7 * clamp((frac - lo) / (hi - lo), 0, 1.05);
    if (this.mode !== 'grip') rpm += thr * 0.18;
    if (speed < 1) rpm = 0.12 + thr * 0.5;
    if (tr < 0.5) rpm += thr * 0.2;
    rpm += this.wheelspin * 0.4;
    this.rpm = damp(this.rpm, clamp(rpm, 0.1, 1.05), this.shiftT > 0 ? 30 : 10, dt);
    if (!boostOn) this.boost = Math.min(1, this.boost + dt * (this.mode !== 'grip' ? 0.06 : 0.012));
  }

  // Visual-only body lean on the springs (does not change the physics): the body rolls out in corners,
  // squats when accelerating and dives when braking, with a little overshoot on quick direction changes.
  bodyLean(dt, speed) {
    const soft = (this.T.cgH / 0.42) * Math.min(1.4, (this.dims.H || 1.3) / 1.3) / Math.sqrt(this.T.susK);
    const rollT = clamp(this.w * speed * 0.0038 * soft, -0.065, 0.065) * this.contact;
    const pitchT = clamp(-this.load * 0.045 * soft, -0.05, 0.05) * this.contact;
    const om = 13, ze = 2 * 0.45 * om; // spring frequency (rad/s) and damping
    this.bodyRollVel += ((rollT - this.bodyRoll) * om * om - this.bodyRollVel * ze) * dt;
    this.bodyPitchVel += ((pitchT - this.bodyPitch) * om * om - this.bodyPitchVel * ze) * dt;
    this.bodyRoll += this.bodyRollVel * dt; this.bodyPitch += this.bodyPitchVel * dt;
  }

  enterDrift(dir) {
    this.mode = 'drift'; this.dir = dir || 1; this.straightT = 0; this.swingT = 0; this.powerT = 0;
  }

  // 4-corner spring/damper suspension following the terrain under each wheel
  suspension(dt, accelLong, accelLat) {
    const T = this.T;
    this.sampleWheels();
    const prev = this.prevGround || this.wheelGround;
    const sp = Math.sin(this.pitch), sr = Math.sin(this.roll);
    let Fy = 0, Tp = 0, Tr = 0, n = 0;
    for (let i = 0; i < 4; i++) {
      const [lx, lz] = this.wheelLocal[i];
      const g = this.wheelGround[i];
      let gRate = (g - prev[i]) / dt;
      if (Math.abs(g - prev[i]) > 1.5) gRate = 0; // teleport / reset
      gRate = clamp(gRate, -10, 10);
      const attachY = this.y - sp * lz + sr * lx;
      const attachV = this.vy - this.pitchVel * lz + this.rollVel * lx;
      const c = g - attachY; // + = compressed
      this.wheelComp[i] = c;
      this.wheelOffset[i] = clamp(c, -DROOP, T.bump + 0.05);
      if (c > -DROOP) {
        n++;
        const k = K * T.susK;
        let f = k * (c + G / (4 * k)) + KD * T.susD * (gRate - attachV);
        if (c > T.bump) f += k * 6 * (c - T.bump); // progressive bump stop (lower cars bottom out sooner)
        f = clamp(f, 0, G * 4.5); // tyre/suspension force limit (no catapulting off ledges)
        Fy += f; Tp += -f * lz; Tr += f * lx;
      }
      // hard limit: never let a wheel sink deep into the ground
      if (c > 0.45) { this.y += (c - 0.45) / 4; this.vy = Math.max(this.vy, 0); }
    }
    this.prevGround = this.wheelGround.slice();
    this.contact = n / 4;
    this.traction = damp(this.traction, this.contact, 25, dt);
    const speed = Math.hypot(this.vx, this.vz);
    const down = AERO * speed * speed + (n ? 0 : G * (AIR_G - 1)); // aero downforce + snappier arcade gravity in the air
    const hcg = T.cgH;
    // weight transfer: accelerating lifts the nose, cornering rolls to the outside
    Tp += -accelLong * hcg * 0.6 * (n / 4);
    Tr += clamp(accelLat, -25, 25) * hcg * 0.35 * (n / 4);
    // angular damping keeps the body from rocking when airborne
    this.vy += (Fy - G - down) * dt;
    this.pitchVel += (Tp / this.Ip - (n ? 0 : this.pitchVel * 0.5)) * dt;
    this.rollVel += (Tr / this.Ir - (n ? 0 : this.rollVel * 0.5)) * dt;
    this.y += this.vy * dt;
    this.pitch = clamp(this.pitch + this.pitchVel * dt, -0.6, 0.6);
    this.roll = clamp(this.roll + this.rollVel * dt, -0.6, 0.6);
    this.airTime = n ? 0 : this.airTime + dt;
    const gF = (this.wheelGround[0] + this.wheelGround[1]) / 2, gB = (this.wheelGround[2] + this.wheelGround[3]) / 2;
    this.slopeF = (gF - gB) / (this.wheelLocal[0][1] - this.wheelLocal[2][1]);
  }

  collide() {
    const W = this.world;
    const sh = Math.sin(this.h), ch = Math.cos(this.h);
    const r = this.radius;
    for (const k of [1, -1, 0]) {
      const cx = this.x + sh * this.offset * k, cz = this.z + ch * this.offset * k;
      for (const it of W.query(cx, cz)) {
        let nx, nz, pen;
        if (it.c) {
          const [ox, oz, or] = it.c;
          const dx = cx - ox, dz = cz - oz, dd = Math.hypot(dx, dz);
          if (dd >= r + or || dd < 1e-6) continue;
          nx = dx / dd; nz = dz / dd; pen = r + or - dd;
        } else {
          const [ax, az, bx, bz] = it.s;
          const ex = bx - ax, ez = bz - az, l2 = ex * ex + ez * ez || 1e-9;
          const t = clamp(((cx - ax) * ex + (cz - az) * ez) / l2, 0, 1);
          const px = ax + ex * t, pz = az + ez * t, dx = cx - px, dz = cz - pz, dd = Math.hypot(dx, dz);
          if (dd >= r || dd < 1e-6) continue;
          nx = dx / dd; nz = dz / dd; pen = r - dd;
        }
        this.resolve(nx, nz, pen, k, 0, 0, 1);
      }
    }
  }

  // push out along normal, bounce, add a bit of spin depending on contact point
  resolve(nx, nz, pen, k, ovx, ovz, massRatio) {
    this.x += nx * pen; this.z += nz * pen;
    const rvx = this.vx - ovx, rvz = this.vz - ovz;
    const vn = rvx * nx + rvz * nz;
    if (vn < 0) {
      const e = 0.25;
      const j = -(1 + e) * vn * massRatio;
      this.vx += j * nx; this.vz += j * nz;
      const tx = -nz, tz = nx, vt = this.vx * tx + this.vz * tz;
      this.vx -= tx * vt * 0.12; this.vz -= tz * vt * 0.12;
      const sh = Math.sin(this.h), ch = Math.cos(this.h);
      const cross = (sh * this.offset * k) * nz - (ch * this.offset * k) * nx;
      this.w += clamp(cross * j * 0.25, -2.5, 2.5);
      this.impact = Math.max(this.impact, -vn);
      this.lastImpact = -vn;
      // the bounce changed the travel direction instantly: don't count that as the car turning
      // (it would make the drift controller chase a huge yaw rate and spin the car)
      if (this.prevVelYaw !== null) this.prevVelYaw = Math.atan2(this.vx, this.vz);
    }
  }

  // collide against another car (each client resolves only its own car). The lighter car takes more
  // of the bounce: o.mass (or o.def.mass for AI cars) if known, else an equal-weight car.
  collideCar(o) {
    const mo = o.mass || (o.def && o.def.mass) || this.mass;
    const share = clamp(1.1 * mo / (this.mass + mo), 0.25, 0.85); // 0.55 for two equal cars
    const sh = Math.sin(this.h), ch = Math.cos(this.h), osh = Math.sin(o.h), och = Math.cos(o.h);
    const r = this.radius + (o.radius || 0.95);
    for (const k of [1, -1]) for (const m of [1, -1]) {
      const ax = this.x + sh * this.offset * k, az = this.z + ch * this.offset * k;
      const bx = o.x + osh * (o.offset || 1.1) * m, bz = o.z + och * (o.offset || 1.1) * m;
      const dx = ax - bx, dz = az - bz, dd = Math.hypot(dx, dz);
      if (dd < r && dd > 1e-4 && Math.abs(this.y - o.y) < 3) this.resolve(dx / dd, dz / dd, (r - dd) * share, k, o.vx || 0, o.vz || 0, share);
    }
  }
}
