// Keyboard (rebindable) + Xbox/PlayStation gamepad input.
export const ACTIONS = [
  { id: 'throttle', label: 'Accelerate' }, { id: 'brake', label: 'Brake / Reverse' },
  { id: 'left', label: 'Steer Left' }, { id: 'right', label: 'Steer Right' },
  { id: 'handbrake', label: 'Handbrake' }, { id: 'boost', label: 'Boost' },
  { id: 'camera', label: 'Change Camera' }, { id: 'reset', label: 'Reset Vehicle' },
  { id: 'pause', label: 'Pause Menu' }, { id: 'hud', label: 'Hide HUD' }, { id: 'music', label: 'Music On/Off' },
  { id: 'chat', label: 'Chat (multiplayer)' }, { id: 'minimap', label: 'Minimap On/Off' },
];
export const DEFAULT_BINDINGS = {
  throttle: ['KeyW', 'ArrowUp'], brake: ['KeyS', 'ArrowDown'], left: ['KeyA', 'ArrowLeft'], right: ['KeyD', 'ArrowRight'],
  handbrake: ['Space'], boost: ['ShiftLeft', 'ShiftRight'], camera: ['KeyC'], reset: ['KeyR'], pause: ['Escape', 'KeyP'],
  hud: ['KeyH'], music: ['KeyM'], chat: ['KeyT', 'Enter'], minimap: ['KeyN'],
};
const ONE_SHOT = ['camera', 'reset', 'pause', 'hud', 'music', 'chat', 'minimap'];

export function keyLabel(code) {
  if (!code) return '—';
  const map = { ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Space: 'Space', Escape: 'Esc', ShiftLeft: 'L-Shift', ShiftRight: 'R-Shift',
    ControlLeft: 'L-Ctrl', ControlRight: 'R-Ctrl', AltLeft: 'L-Alt', AltRight: 'R-Alt', Enter: 'Enter', Tab: 'Tab', Backspace: 'Bksp' };
  return map[code] || code.replace(/^Key/, '').replace(/^Digit/, '').replace(/^Numpad/, 'Num ');
}

export class Input {
  constructor(settings) {
    this.settings = settings;
    this.down = new Set();
    this.pressedQ = [];
    this.gpPrev = [];
    this.usingPad = false;
    this.enabled = true;
    this.kThr = 0; this.kBrk = 0; this.lastRead = 0; // smoothed keyboard pedals
    this.capture = null; // rebinding callback
    window.addEventListener('keydown', (e) => {
      if (this.capture) { e.preventDefault(); const cb = this.capture; this.capture = null; cb(e.code); return; }
      const tag = (e.target && e.target.tagName) || '';
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
      if (!this.down.has(e.code)) for (const a of ONE_SHOT) if (this.bound(a).includes(e.code)) this.pressedQ.push(a);
      this.down.add(e.code);
      this.usingPad = false;
    });
    window.addEventListener('keyup', (e) => this.down.delete(e.code));
    window.addEventListener('blur', () => this.down.clear());
  }
  bound(a) { return (this.settings.bindings && this.settings.bindings[a]) || DEFAULT_BINDINGS[a] || []; }
  key(a) { for (const k of this.bound(a)) if (this.down.has(k)) return true; return false; }
  pressed() { const q = this.pressedQ; this.pressedQ = []; return q; }

  pad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) if (p && p.connected && p.buttons.length >= 10) return p;
    return null;
  }

  // Gamepad menu buttons (Start = pause, Y = camera, ...). Call every frame - also while paused or
  // chatting - so the controller can always open and close the pause menu.
  pollPad() {
    const p = this.settings.gamepad !== false ? this.pad() : null;
    if (!p) return;
    const b = (i) => (p.buttons[i] ? p.buttons[i].value || (p.buttons[i].pressed ? 1 : 0) : 0);
    // edge-triggered buttons: Y camera, Back reset, Start pause, R3 music
    const map = { 3: 'camera', 8: 'reset', 9: 'pause', 11: 'music' };
    for (const [i, a] of Object.entries(map)) {
      const now = b(+i) > 0.5;
      if (now && !this.gpPrev[i]) this.pressedQ.push(a);
      this.gpPrev[i] = now;
    }
  }

  // Keyboard keys are on/off; real pedals aren't. Ramp the keyboard throttle/brake smoothly
  // (about 0.15 s to full, a bit quicker to release) so the car doesn't lurch.
  rampKeys(thrKey, brkKey) {
    const now = performance.now(), dt = Math.min(0.05, Math.max(0, (now - (this.lastRead || now)) / 1000));
    this.lastRead = now;
    const step = (v, on) => (on ? Math.min(1, v + dt * 7) : Math.max(0, v - dt * 11));
    this.kThr = step(this.kThr, thrKey); this.kBrk = step(this.kBrk, brkKey);
    // a fresh press always gives an instant bit of pedal, so taps still register
    if (thrKey && this.kThr < 0.25) this.kThr = 0.25;
    if (brkKey && this.kBrk < 0.25) this.kBrk = 0.25;
  }

  // driving input snapshot
  read() {
    const s = this.settings;
    this.rampKeys(this.key('throttle'), this.key('brake'));
    let throttle = this.kThr, brake = this.kBrk;
    let steer = (this.key('left') ? 1 : 0) - (this.key('right') ? 1 : 0);
    let handbrake = this.key('handbrake'), boost = this.key('boost'), analog = false;
    const p = s.gamepad !== false ? this.pad() : null;
    if (p) {
      const dz = s.deadzone ?? 0.15;
      const ax = p.axes[0] || 0;
      const sx = Math.abs(ax) < dz ? 0 : (ax - Math.sign(ax) * dz) / (1 - dz);
      const b = (i) => (p.buttons[i] ? p.buttons[i].value || (p.buttons[i].pressed ? 1 : 0) : 0);
      const rt = b(7), lt = b(6);
      if (Math.abs(sx) > 0.01 || rt > 0.05 || lt > 0.05 || b(0) || b(5)) this.usingPad = true;
      if (this.usingPad) {
        if (Math.abs(sx) > 0.01) { steer = -Math.sign(sx) * Math.pow(Math.abs(sx), 1.4); analog = true; }
        if (b(14)) steer = 1; if (b(15)) steer = -1;
        throttle = Math.max(throttle, rt); brake = Math.max(brake, lt);
        handbrake = handbrake || b(0) > 0.5 || b(5) > 0.5;
        boost = boost || b(2) > 0.5 || b(1) > 0.5;
      }
    }
    if (!this.enabled) return { throttle: 0, brake: 0, steer: 0, handbrake: false, boost: false, analog };
    return { throttle, brake, steer, handbrake, boost, analog, steerSens: s.steerSens || 1 };
  }
}
