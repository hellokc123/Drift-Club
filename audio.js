// Procedural audio: synthesized engine, tyre squeal, wind, impacts + a small
// generative music sequencer. No audio files needed.
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

const STYLES = {
  menu: { bpm: 88, chords: [[57, [0, 3, 7, 10, 14]], [53, [0, 4, 7, 11]], [48, [0, 4, 7, 11, 14]], [55, [0, 4, 7, 9]]], drums: 'lofi', arp: 0.35, bass: 'soft', bright: 900 },
  chill: { bpm: 78, chords: [[57, [0, 3, 7, 10, 14]], [53, [0, 4, 7, 11]], [48, [0, 4, 7, 11, 14]], [55, [0, 4, 7, 9]]], drums: 'lofi', arp: 0.4, bass: 'soft', bright: 800 },
  bright: { bpm: 112, chords: [[48, [0, 4, 7, 11]], [55, [0, 4, 7, 14]], [57, [0, 3, 7, 10]], [53, [0, 4, 7, 11]]], drums: 'pop', arp: 0.7, bass: 'pump', bright: 1800 },
  warm: { bpm: 96, chords: [[50, [0, 3, 7, 10]], [45, [0, 3, 7, 10]], [46, [0, 4, 7, 11]], [48, [0, 4, 7, 10]]], drums: 'pop', arp: 0.55, bass: 'pump', bright: 1300 },
  dusk: { bpm: 100, chords: [[52, [0, 3, 7, 10, 14]], [48, [0, 4, 7, 11]], [55, [0, 4, 7, 14]], [50, [0, 4, 7, 9]]], drums: 'pop', arp: 0.6, bass: 'pump', bright: 1200 },
  calm: { bpm: 84, chords: [[53, [0, 4, 7, 11]], [52, [0, 3, 7, 10]], [50, [0, 3, 7, 10]], [48, [0, 4, 7, 11]]], drums: 'lofi', arp: 0.45, bass: 'soft', bright: 1000 },
  night: { bpm: 108, chords: [[57, [0, 3, 7, 12]], [53, [0, 4, 7, 12]], [48, [0, 4, 7, 12]], [55, [0, 4, 7, 12]]], drums: 'synth', arp: 0.9, bass: 'octave', bright: 1600 },
  compete: { bpm: 124, chords: [[53, [0, 3, 7, 10]], [49, [0, 4, 7, 11]], [56, [0, 4, 7, 10]], [51, [0, 4, 7, 10]]], drums: 'synth', arp: 0.9, bass: 'octave', bright: 2000 },
};

export class AudioEngine {
  constructor() { this.ctx = null; this.vol = { master: 0.8, sfx: 0.8, music: 0.5 }; this.musicOn = true; this.style = null; }

  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = this.ctx = new AC();
    this.master = ctx.createGain(); this.master.connect(ctx.destination);
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 4; comp.connect(this.master);
    this.sfx = ctx.createGain(); this.sfx.connect(comp);
    this.mus = ctx.createGain(); this.mus.connect(comp);
    // music bus with simple echo for space
    this.musDry = ctx.createGain(); this.musDry.connect(this.mus);
    const delay = ctx.createDelay(1); delay.delayTime.value = 0.36;
    const fb = ctx.createGain(); fb.gain.value = 0.32; const dl = ctx.createBiquadFilter(); dl.type = 'lowpass'; dl.frequency.value = 2200;
    delay.connect(dl); dl.connect(fb); fb.connect(delay); dl.connect(this.mus);
    this.musSend = ctx.createGain(); this.musSend.gain.value = 0.35; this.musSend.connect(delay);
    // shared noise
    const len = ctx.sampleRate * 2, buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noiseBuf = buf;
    this.applyVolumes();
    this._tick = setInterval(() => this.schedule(), 25);
  }
  setVolumes(v) { Object.assign(this.vol, v); this.applyVolumes(); }
  applyVolumes() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this.vol.master, t, 0.05);
    this.sfx.gain.setTargetAtTime(this.vol.sfx, t, 0.05);
    this.mus.gain.setTargetAtTime(this.musicOn ? this.vol.music * 0.55 : 0, t, 0.2);
  }
  toggleMusic() { this.musicOn = !this.musicOn; this.applyVolumes(); return this.musicOn; }
  noise(loop = true) { const s = this.ctx.createBufferSource(); s.buffer = this.noiseBuf; s.loop = loop; return s; }

  // ------------------------------------------------ engine
  startEngine(p) {
    if (!this.ctx) return;
    this.stopEngine();
    const c = this.ctx, e = this.eng = { p, nodes: [] };
    const out = c.createGain(); out.gain.value = 0; out.connect(this.sfx); e.out = out;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 2.5; lp.connect(out); e.lp = lp;
    const shaper = c.createWaveShaper(); const k = 4 + p.grit * 30, curve = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) { const x = (i / 1023) * 2 - 1; curve[i] = ((1 + k) * x) / (1 + k * Math.abs(x)); }
    shaper.curve = curve; shaper.connect(lp);
    const mk = (type, mult, g) => { const o = c.createOscillator(); o.type = type; const gn = c.createGain(); gn.gain.value = g; o.connect(gn); gn.connect(shaper); o.start(); e.nodes.push(o); return { o, mult }; };
    e.oscs = [mk('sawtooth', 1, 0.32), mk('square', 0.5, 0.25 + p.grit * 0.2), mk('sawtooth', 2.01, 0.12), mk('triangle', 0.25, 0.3)];
    // tyre squeal
    const tn = this.noise(); const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1150; bp.Q.value = 9;
    const bp2 = c.createBiquadFilter(); bp2.type = 'bandpass'; bp2.frequency.value = 2300; bp2.Q.value = 12;
    const tg = c.createGain(); tg.gain.value = 0; tn.connect(bp); tn.connect(bp2); bp.connect(tg); bp2.connect(tg); tg.connect(this.sfx); tn.start();
    e.tire = tg; e.tireBp = bp; e.nodes.push(tn);
    // rumble (off-road / kerbs)
    const rn = this.noise(); const rl = c.createBiquadFilter(); rl.type = 'lowpass'; rl.frequency.value = 260;
    const rg = c.createGain(); rg.gain.value = 0; rn.connect(rl); rl.connect(rg); rg.connect(this.sfx); rn.start(); e.rumble = rg; e.nodes.push(rn);
    // wind
    const wn = this.noise(); const wb = c.createBiquadFilter(); wb.type = 'bandpass'; wb.frequency.value = 600; wb.Q.value = 0.4;
    const wg = c.createGain(); wg.gain.value = 0; wn.connect(wb); wb.connect(wg); wg.connect(this.sfx); wn.start(); e.wind = wg; e.nodes.push(wn);
    // boost hiss
    const bn = this.noise(); const bh = c.createBiquadFilter(); bh.type = 'highpass'; bh.frequency.value = 2500;
    const bg = c.createGain(); bg.gain.value = 0; bn.connect(bh); bh.connect(bg); bg.connect(this.sfx); bn.start(); e.boost = bg; e.nodes.push(bn);
  }
  stopEngine() {
    if (!this.eng) return;
    const e = this.eng; this.eng = null;
    const t = this.ctx.currentTime;
    for (const g of [e.out, e.tire, e.rumble, e.wind, e.boost]) g.gain.setTargetAtTime(0, t, 0.05);
    setTimeout(() => e.nodes.forEach((n) => { try { n.stop(); } catch { /* */ } }), 300);
  }
  // s: {rpm 0..1, throttle, speed m/s, slip rad, drifting, rumble 0..1, boosting, paused}
  updateEngine(s) {
    const e = this.eng; if (!e) return;
    const t = this.ctx.currentTime, p = e.p;
    if (s.paused) { for (const g of [e.out, e.tire, e.rumble, e.wind, e.boost]) g.gain.setTargetAtTime(0, t, 0.1); return; }
    const f = (26 + s.rpm * 165) * p.pitch * (p.cyl >= 8 ? 0.85 : 1);
    for (const { o, mult } of e.oscs) o.frequency.setTargetAtTime(f * mult, t, 0.03);
    e.lp.frequency.setTargetAtTime(350 + s.throttle * 1600 + s.rpm * 1700, t, 0.05);
    e.out.gain.setTargetAtTime(0.12 + s.throttle * 0.14 + s.rpm * 0.06, t, 0.05);
    const sq = Math.min(1, Math.max(0, (Math.abs(s.slip) - 0.12) * 2.2)) * Math.min(1, s.speed / 12) * (s.paved ? 1 : 0.25);
    e.tire.gain.setTargetAtTime(sq * 0.22, t, 0.06);
    e.tireBp.frequency.setTargetAtTime(1000 + Math.abs(s.slip) * 500 + Math.sin(t * 13) * 40, t, 0.05);
    e.rumble.gain.setTargetAtTime(s.rumble * Math.min(1, s.speed / 8) * 0.35, t, 0.05);
    e.wind.gain.setTargetAtTime(Math.min(0.18, (s.speed / 70) ** 2 * 0.18), t, 0.2);
    e.boost.gain.setTargetAtTime(s.boosting ? 0.08 : 0, t, 0.08);
  }

  impact(strength) {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime, v = Math.min(1, strength / 15);
    const n = this.noise(false); const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900 + v * 1500;
    const g = c.createGain(); g.gain.setValueAtTime(0.5 * v + 0.1, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
    n.connect(lp); lp.connect(g); g.connect(this.sfx); n.start(t); n.stop(t + 0.4);
    const o = c.createOscillator(); o.frequency.setValueAtTime(110, t); o.frequency.exponentialRampToValueAtTime(40, t + 0.2);
    const og = c.createGain(); og.gain.setValueAtTime(0.5 * v, t); og.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
    o.connect(og); og.connect(this.sfx); o.start(t); o.stop(t + 0.3);
  }
  blip(freq = 880, dur = 0.06, type = 'triangle', vol = 0.12) {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime, o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.value = freq; g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(this.sfx); o.start(t); o.stop(t + dur + 0.02);
  }
  chime(good = true) { [0, 4, 7, 12].forEach((s, i) => setTimeout(() => this.blip(mtof((good ? 72 : 60) + (good ? s : -s)), 0.18, 'sine', 0.1), i * 70)); }

  // ------------------------------------------------ music sequencer
  playMusic(style) {
    if (!this.ctx) { this.pendingStyle = style; return; }
    if (this.style === style) return;
    this.style = style; this.seq = { step: 0, next: this.ctx.currentTime + 0.1, bar: 0 };
  }
  stopMusic() { this.style = null; }
  schedule() {
    if (!this.ctx) return;
    if (this.pendingStyle) { const s = this.pendingStyle; this.pendingStyle = null; this.playMusic(s); }
    if (!this.style || !this.musicOn) return;
    const S = STYLES[this.style], sq = this.seq, stepDur = 60 / S.bpm / 4;
    while (sq.next < this.ctx.currentTime + 0.12) {
      this.playStep(S, sq.step, sq.bar, sq.next, stepDur);
      sq.step++; if (sq.step >= 16) { sq.step = 0; sq.bar++; }
      sq.next += stepDur;
    }
  }
  playStep(S, step, bar, t, sd) {
    const [root, iv] = S.chords[Math.floor(bar / 2) % S.chords.length];
    const swing = S.drums === 'lofi' && step % 2 ? sd * 0.18 : 0; t += swing;
    // pad on chord change
    if (step === 0 && bar % 2 === 0) for (const i of iv.slice(0, 4)) this.pad(mtof(root + i), t, sd * 32, S.bright);
    // drums
    if (S.drums === 'lofi') {
      if (step === 0 || step === 10) this.kick(t, 0.5);
      if (step === 4 || step === 12) this.snare(t, 0.18, true);
      if (step % 2 === 0) this.hat(t, step % 4 === 2 ? 0.05 : 0.025);
    } else if (S.drums === 'pop') {
      if (step === 0 || step === 8 || step === 11) this.kick(t, 0.6);
      if (step === 4 || step === 12) this.snare(t, 0.25);
      if (step % 2 === 0) this.hat(t, 0.04);
    } else {
      if (step % 4 === 0) this.kick(t, 0.65);
      if (step === 4 || step === 12) this.snare(t, 0.22);
      this.hat(t, step % 2 ? 0.025 : 0.045);
    }
    // bass
    const bassNote = root - 12;
    if (S.bass === 'soft') { if (step === 0 || step === 7 || step === 10) this.bass(mtof(bassNote), t, sd * 3, 0.22); }
    else if (S.bass === 'pump') { if (step % 4 === 2 || step === 0) this.bass(mtof(bassNote), t, sd * 1.6, 0.22); }
    else if (step % 2 === 0) this.bass(mtof(bassNote + (step % 4 === 2 ? 12 : 0)), t, sd * 1.4, 0.2);
    // arp
    if (Math.random() < S.arp && (S.arp > 0.8 ? true : step % 2 === 0)) {
      const n = root + 12 + iv[(step * 3 + bar) % iv.length];
      this.pluck(mtof(n), t, sd * 2.5, 0.06, S.bright * 1.6);
    }
  }
  pad(f, t, dur, cutoff) {
    const c = this.ctx, g = c.createGain(), lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = cutoff;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.035, t + 0.6); g.gain.setValueAtTime(0.035, t + dur - 0.8); g.gain.linearRampToValueAtTime(0, t + dur);
    for (const det of [-7, 7]) { const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = det; o.connect(lp); o.start(t); o.stop(t + dur + 0.05); }
    lp.connect(g); g.connect(this.musDry); g.connect(this.musSend);
  }
  bass(f, t, dur, v) {
    const c = this.ctx, o = c.createOscillator(), g = c.createGain(); o.type = 'triangle'; o.frequency.value = f;
    g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(this.musDry); o.start(t); o.stop(t + dur + 0.02);
  }
  pluck(f, t, dur, v, cutoff) {
    const c = this.ctx, o = c.createOscillator(), g = c.createGain(), lp = c.createBiquadFilter(); o.type = 'square'; o.frequency.value = f;
    lp.type = 'lowpass'; lp.frequency.setValueAtTime(cutoff, t); lp.frequency.exponentialRampToValueAtTime(300, t + dur);
    g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(lp); lp.connect(g); g.connect(this.musDry); g.connect(this.musSend); o.start(t); o.stop(t + dur + 0.02);
  }
  kick(t, v) {
    const c = this.ctx, o = c.createOscillator(), g = c.createGain();
    o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    o.connect(g); g.connect(this.musDry); o.start(t); o.stop(t + 0.32);
  }
  snare(t, v, soft) {
    const c = this.ctx, n = this.noise(false), bp = c.createBiquadFilter(), g = c.createGain();
    bp.type = 'bandpass'; bp.frequency.value = soft ? 1400 : 1900; bp.Q.value = 0.8;
    g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.001, t + (soft ? 0.12 : 0.18));
    n.connect(bp); bp.connect(g); g.connect(this.musDry); g.connect(this.musSend); n.start(t); n.stop(t + 0.2);
  }
  hat(t, v) {
    const c = this.ctx, n = this.noise(false), hp = c.createBiquadFilter(), g = c.createGain();
    hp.type = 'highpass'; hp.frequency.value = 7500;
    g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
    n.connect(hp); hp.connect(g); g.connect(this.musDry); n.start(t); n.stop(t + 0.06);
  }
}
