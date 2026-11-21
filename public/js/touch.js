// Touch controls for phones and tablets: a steering pad on the left (drag, or tilt the device),
// Gas / Brake / Handbrake / Boost thumb buttons on the right, and a small top bar (pause, camera,
// reset, chat). Everything feeds the same Input object the keyboard and gamepad use.
// Shown only on touch devices; hidden again as soon as a keyboard or gamepad is used.

export function isTouchDevice() {
  try {
    if (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) return true;
  } catch { /* old browser */ }
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || '') && (navigator.maxTouchPoints || 0) > 0;
}

const STEER_RANGE = 74;   // px of drag for full lock
const STEER_DEAD = 0.07;  // dead zone (fraction of full lock)
const TILT_FULL = 24;     // degrees of tilt for full lock (scaled by the tilt sensitivity setting)

export class TouchControls {
  constructor(app) {
    this.app = app; this.input = app.input;
    this.state = { throttle: 0, brake: 0, steer: 0, handbrake: false, boost: false };
    this.held = { gas: 0, brake: 0, hb: 0, boost: 0 }; // pointer counts per button
    this.hbLatch = false; // a quick handbrake flick (down+up between two frames) still counts once
    this.steerPtr = null; this.steerX0 = 0; this.steerDrag = 0;
    this.tilt = null; this.tiltZero = 0; this.tiltOn = false;
    this.active = this.mode() === 'on' || (this.mode() === 'auto' && isTouchDevice());
    this.build();
    this.bindGlobal();
    this.applyLayout();
    if (this.S.touchSteer === 'tilt') this.enableTilt(false);
    this.input.touch = this; // Input.read() merges our state
    this.sync(true);
  }
  get S() { return this.app.settings; }
  mode() { return this.S.touchControls || 'auto'; } // auto | on | off

  // ------------------------------------------------------------- DOM
  build() {
    const root = this.root = document.createElement('div');
    root.id = 'touch';
    root.className = 'hidden';
    root.innerHTML = `
      <div class="tc-steer" data-z="steer"><div class="tc-track"><div class="tc-mid"></div><div class="tc-knob"></div></div><div class="tc-tilt-label">TILT</div></div>
      <div class="tc-pedals">
        <button class="tc-btn tc-boost" data-b="boost" aria-label="Boost"><span>BOOST</span></button>
        <button class="tc-btn tc-hb" data-b="hb" aria-label="Handbrake"><span>HAND<br>BRAKE</span></button>
        <button class="tc-btn tc-brake" data-b="brake" aria-label="Brake / reverse"><span>BRAKE</span></button>
        <button class="tc-btn tc-gas" data-b="gas" aria-label="Gas"><span>GAS</span></button>
      </div>`;
    document.body.appendChild(root);
    const bar = this.bar = document.createElement('div');
    bar.id = 'touch-bar';
    bar.className = 'hidden';
    const svg = (d) => `<svg viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
    bar.innerHTML = `<button class="tc-top" data-a="pause" aria-label="Pause menu">${svg('<rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/>')}</button>
      <button class="tc-top" data-a="camera" aria-label="Change camera">${svg('<path d="M4 8h3l2-2.5h6L17 8h3v11H4z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><circle cx="12" cy="13" r="3.2" fill="none" stroke="currentColor" stroke-width="2"/>')}</button>
      <button class="tc-top tc-reset" data-a="reset" aria-label="Reset car">${svg('<path d="M5.5 12a6.5 6.5 0 1 0 2-4.7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><path d="M4 4.5v4.5h4.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>')}</button>
      <button class="tc-top tc-chat" data-a="chat" aria-label="Chat">${svg('<path d="M4 5h16v10H10l-4 4v-4H4z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>')}</button>`;
    document.body.appendChild(bar);
    const rot = this.rotate = document.createElement('div');
    rot.id = 'rotate';
    rot.className = 'hidden';
    rot.innerHTML = '<div class="rot-phone"></div><b>Rotate your phone</b><p>Drift Club is played sideways (landscape).</p>';
    document.body.appendChild(rot);
    this.knob = root.querySelector('.tc-knob');
    this.track = root.querySelector('.tc-track');
    this.steerZone = root.querySelector('.tc-steer');

    // ---- steering: touch anywhere in the left zone; the slider jumps under your thumb
    const z = this.steerZone;
    z.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (this.steerPtr !== null || this.tiltOn) return;
      this.steerPtr = e.pointerId; this.steerX0 = e.clientX; this.steerDrag = 0;
      try { z.setPointerCapture(e.pointerId); } catch { /* synthetic */ }
      const r = z.getBoundingClientRect();
      this.track.style.left = `${Math.max(STEER_RANGE + 20, Math.min(r.width - STEER_RANGE - 20, e.clientX - r.left))}px`;
      this.track.style.top = `${Math.max(40, Math.min(r.height - 40, e.clientY - r.top))}px`;
      z.classList.add('on');
      this.drawKnob();
    });
    const mv = (e) => {
      if (e.pointerId !== this.steerPtr) return;
      e.preventDefault();
      this.steerDrag = Math.max(-1, Math.min(1, (e.clientX - this.steerX0) / STEER_RANGE));
      this.drawKnob();
    };
    const up = (e) => {
      if (e.pointerId !== this.steerPtr) return;
      this.steerPtr = null; this.steerDrag = 0; z.classList.remove('on');
      this.track.style.left = ''; this.track.style.top = '';
      this.drawKnob();
    };
    z.addEventListener('pointermove', mv);
    z.addEventListener('pointerup', up); z.addEventListener('pointercancel', up); z.addEventListener('lostpointercapture', up);

    // ---- buttons: each pointer counts separately, so several fingers / slides work
    root.querySelectorAll('.tc-btn').forEach((b) => {
      const k = b.dataset.b, ptrs = new Set();
      const set = () => { this.held[k] = ptrs.size; b.classList.toggle('down', ptrs.size > 0); };
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        ptrs.add(e.pointerId);
        try { b.releasePointerCapture(e.pointerId); } catch { /* fine */ }
        if (k === 'hb') this.hbLatch = true;
        set();
      });
      const off = (e) => { if (ptrs.delete(e.pointerId)) set(); };
      b.addEventListener('pointerup', off); b.addEventListener('pointercancel', off);
      b.addEventListener('pointerleave', off);
      // sliding a thumb onto a button presses it (e.g. roll from gas onto handbrake)
      b.addEventListener('pointerenter', (e) => { if (e.pointerType === 'touch' && e.buttons) { ptrs.add(e.pointerId); if (k === 'hb') this.hbLatch = true; set(); } });
      b.addEventListener('contextmenu', (e) => e.preventDefault());
    });

    bar.querySelectorAll('[data-a]').forEach((b) => {
      b.addEventListener('pointerdown', (e) => { e.preventDefault(); b.classList.add('down'); });
      const off = () => b.classList.remove('down');
      b.addEventListener('pointerup', off); b.addEventListener('pointercancel', off); b.addEventListener('pointerleave', off);
      b.addEventListener('click', (e) => { e.preventDefault(); this.input.pressedQ.push(b.dataset.a); });
    });

    for (const el of [root, bar, rot]) {
      el.addEventListener('contextmenu', (e) => e.preventDefault());
      el.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });
    }
  }
  drawKnob() {
    const v = this.tiltOn ? this.state.steer * -1 : this.steerDrag;
    this.knob.style.transform = `translate(${(v * STEER_RANGE).toFixed(1)}px, -50%)`;
  }

  // ------------------------------------------------------------- show / hide
  bindGlobal() {
    // any real touch -> touch mode on; keyboard (not typing into a field) -> off
    window.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'touch' && this.mode() !== 'off' && !this.active) { this.active = true; this.sync(); }
    }, true);
    window.addEventListener('keydown', (e) => {
      if (this.mode() === 'on' || !this.active) return;
      const tag = (e.target && e.target.tagName) || '';
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.key === 'Unidentified' || e.keyCode === 229 || e.isComposing) return; // phone soft keyboards
      this.active = false; this.release(); this.sync();
    });
    const orient = () => { this.calcOrient(); this.sync(); };
    window.addEventListener('resize', orient);
    window.addEventListener('orientationchange', orient);
    document.addEventListener('fullscreenchange', () => this.sync(true));
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.release(); });
    window.addEventListener('blur', () => this.release());
    this.calcOrient();
  }
  calcOrient() { this.portrait = window.innerHeight > window.innerWidth * 1.05; }
  release() {
    this.held = { gas: 0, brake: 0, hb: 0, boost: 0 }; this.hbLatch = false;
    this.steerPtr = null; this.steerDrag = 0;
    this.root.querySelectorAll('.down').forEach((b) => b.classList.remove('down'));
    if (this.steerZone) this.steerZone.classList.remove('on');
    this.drawKnob();
  }
  // called every frame by the app (cheap: only touches the DOM when something changed)
  sync(force) {
    const g = this.app.game;
    const inGame = !!(g && g.ready);
    if (this.mode() === 'off') this.active = false;
    if (this.input.usingPad && this.active && this.mode() !== 'on') { this.active = false; this.release(); }
    const res = document.getElementById('results');
    const playing = inGame && !g.paused && !g.spectator && this.active && !(res && !res.classList.contains('hidden'));
    const key = [this.active, inGame, playing, this.app.ui && this.app.ui.current, !!(g && g.paused), !!(g && g.mp), !!(g && g.spectator), this.portrait, this.tiltOn].join();
    if (!force && key === this.key) return;
    this.key = key;
    document.body.classList.toggle('touch-on', this.active);
    this.root.classList.toggle('hidden', !playing);
    this.bar.classList.toggle('hidden', !(inGame && this.active));
    this.bar.classList.toggle('mp', !!(g && g.mp));
    this.bar.classList.toggle('spec', !!(g && g.spectator));
    this.rotate.classList.toggle('hidden', !(inGame && this.active && this.portrait));
    this.root.classList.toggle('tilt', this.tiltOn);
    if (!playing) this.release();
  }
  applyLayout() {
    const sz = { s: 62, m: 72, l: 84 }[this.S.touchSize || 'm'] || 72;
    document.documentElement.style.setProperty('--tc', `${sz}px`);
  }

  // ------------------------------------------------------------- tilt steering
  // iOS needs DeviceOrientationEvent.requestPermission() from a tap; Android Chrome doesn't.
  async enableTilt(fromTap) {
    const DOE = window.DeviceOrientationEvent;
    if (!DOE) return { ok: false, msg: 'This device has no tilt sensor.' };
    if (typeof DOE.requestPermission === 'function') {
      if (!fromTap) return { ok: false, msg: 'Tap "Tilt" in Settings to allow motion access.' };
      try { if ((await DOE.requestPermission()) !== 'granted') return { ok: false, msg: 'Motion access was not allowed.' }; } catch (e) { return { ok: false, msg: 'Motion access failed: ' + e.message }; }
    }
    if (!this.onTilt) {
      this.onTilt = (e) => {
        if (e.beta == null) return;
        this.tilt = this.tiltValue(e.beta, e.gamma);
        if (this.needZero) { this.tiltZero = this.tilt; this.needZero = false; }
      };
      window.addEventListener('deviceorientation', this.onTilt);
    }
    this.tiltOn = true; this.needZero = true; this.sync(true);
    return { ok: true };
  }
  disableTilt() {
    if (this.onTilt) window.removeEventListener('deviceorientation', this.onTilt);
    this.onTilt = null; this.tiltOn = false; this.tilt = null; this.sync(true); this.drawKnob();
  }
  recalibrate() { this.needZero = true; }
  // "how far is the phone turned like a steering wheel": the component of the up-vector along the
  // screen's horizontal axis (device y in landscape), which works held upright or lying fairly flat
  tiltValue(beta, gamma) {
    const d = Math.PI / 180;
    const ang = (screen.orientation && typeof screen.orientation.angle === 'number') ? screen.orientation.angle : (window.orientation || 0);
    const a = ((ang % 360) + 360) % 360;
    if (a === 90) return Math.sin(beta * d);        // landscape, top of phone to the left
    if (a === 270) return -Math.sin(beta * d);      // landscape, top of phone to the right
    const x = -Math.sin(gamma * d) * Math.cos(beta * d); // portrait (rotate overlay shows anyway)
    return a === 180 ? -x : x;
  }

  // ------------------------------------------------------------- per-frame state for Input.read()
  read() {
    const st = this.state, h = this.held;
    st.throttle = h.gas ? 1 : 0;
    st.brake = h.brake ? 1 : 0;
    st.handbrake = h.hb > 0 || this.hbLatch;
    this.hbLatch = false;
    st.boost = h.boost > 0;
    let s = 0;
    if (this.tiltOn && this.tilt !== null) {
      const full = Math.sin(TILT_FULL / (this.S.tiltSens || 1) * Math.PI / 180);
      s = -(this.tilt - this.tiltZero) / full; // tilt right (clockwise) -> steer right (negative)
    } else s = -this.steerDrag; // drag right -> steer right (negative = right in Input)
    const a = Math.abs(s);
    st.steer = a < STEER_DEAD ? 0 : Math.sign(s) * Math.min(1, (a - STEER_DEAD) / (1 - STEER_DEAD));
    if (this.tiltOn) this.drawKnob();
    st.any = !!(h.gas || h.brake || h.hb || h.boost || st.steer || st.handbrake);
    return st;
  }
}

// Fullscreen + landscape lock (both optional; every browser handles these differently)
export async function goFullscreen(lock = true) {
  try {
    const el = document.documentElement;
    if (!document.fullscreenElement) {
      if (el.requestFullscreen) await el.requestFullscreen({ navigationUI: 'hide' });
      else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
    }
  } catch { /* not allowed (no user tap, iPhone Safari, ...) */ }
  if (lock) { try { if (screen.orientation && screen.orientation.lock) await screen.orientation.lock('landscape'); } catch { /* unsupported */ } }
}
export function exitFullscreen() { try { if (document.fullscreenElement) document.exitFullscreen(); } catch { /* fine */ } }
