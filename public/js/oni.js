// Midnight Oni's brain: he learns every race track, one 30 m stretch at a time.
// After each race he's in he compares himself with the player:
//  - stretches where the player was faster -> he carries more speed there next time
//  - stretches where the player was faster -> he also shifts toward the player's line
//  - stretches where he left the road or had to reset -> he backs off there
//  - lost the race -> a bit more power overall
// The brain lives on the game server (shared by everyone who races him) with a copy on this device.
export const BIN = 10; // path samples per stretch (3 m each = 30 m)
const LOCAL = (map, boss) => (boss === 'oni' ? 'driftclub.oni.' + map : `driftclub.boss.${boss}.${map}`);
const MAX_POWER = 0.2;

export function emptyBrain(nBins) { return { v: 1, bins: nBins, speed: new Array(nBins).fill(1), line: new Array(nBins).fill(0), power: 0, races: 0, wins: 0, losses: 0 }; }
export function validBrain(b, nBins) { return b && b.v === 1 && b.bins === nBins && Array.isArray(b.speed) && b.speed.length === nBins && Array.isArray(b.line) && b.line.length === nBins; }

export async function loadBrain(account, map, nBins, boss = 'oni') {
  let local = null;
  try { local = JSON.parse(localStorage.getItem(LOCAL(map, boss)) || 'null'); } catch { /* */ }
  try {
    const r = await account.call('oni/get', { map, boss, bins: nBins }, 5000);
    if (validBrain(r.brain, nBins)) return r.brain;
  } catch { /* offline: use this device's copy */ }
  return validBrain(local, nBins) ? local : emptyBrain(nBins);
}
export function saveBrain(account, map, brain, boss = 'oni') {
  try { localStorage.setItem(LOCAL(map, boss), JSON.stringify(brain)); } catch { /* */ }
  account.call('oni/learn', { map, boss, brain }, 15000).catch(() => {});
}

// what happened on each stretch during one race
export class OniRecorder {
  constructor(path, width) {
    this.p = path; this.half = width / 2; this.n = Math.ceil(path.n / BIN);
    const z = () => new Float64Array(this.n);
    this.me = { sp: z(), lat: z(), c: z() }; this.oni = { sp: z(), c: z(), trouble: z() };
    this.meIdx = 0;
  }
  nearest(from, x, z) {
    const p = this.p; let best = 1e18, bi = from;
    for (let k = -25; k <= 25; k++) {
      const i = ((from + k) % p.n + p.n) % p.n, d = (p.x[i] - x) ** 2 + (p.z[i] - z) ** 2;
      if (d < best) { best = d; bi = i; }
    }
    return bi;
  }
  lat(i, x, z) { const p = this.p; return (x - p.x[i]) * -p.tz[i] + (z - p.z[i]) * p.tx[i]; }
  player(x, z, speed, teleport) {
    this.meIdx = teleport || !this.seen ? this.globalNearest(x, z) : this.nearest(this.meIdx, x, z); this.seen = true;
    const i = this.meIdx, l = this.lat(i, x, z), b = Math.floor(i / BIN);
    if (teleport || speed < 3 || Math.abs(l) > this.half + 2) return;
    this.me.sp[b] += speed; this.me.lat[b] += l; this.me.c[b]++;
  }
  globalNearest(x, z) { const p = this.p; let best = 1e18, bi = 0; for (let i = 0; i < p.n; i++) { const d = (p.x[i] - x) ** 2 + (p.z[i] - z) ** 2; if (d < best) { best = d; bi = i; } } return bi; }
  boss(idx, x, z, speed, teleported, slide = 0) {
    const b = Math.floor(idx / BIN), l = this.lat(idx, x, z);
    if (teleported || Math.abs(l) > this.half + 1.5 || Math.abs(slide) > 0.45) { // off the road, reset, or sliding wide
      this.oni.trouble[b]++; if (teleported) for (let k = 1; k <= 2; k++) this.oni.trouble[(b - k + this.n) % this.n]++; }
    if (speed > 1) { this.oni.sp[b] += speed; this.oni.c[b]++; }
  }
  // turn this race into an updated brain
  learn(brain, oniWon, played) {
    const B = JSON.parse(JSON.stringify(brain)), lim = this.half - 1.5;
    let faster = 0, careful = 0;
    for (let b = 0; b < this.n; b++) {
      if (this.oni.trouble[b] > 0) { // slipped up here: back off, and a bit on the stretch before it (the braking zone)
        B.speed[b] = Math.max(0.85, Math.min(1, B.speed[b]) * 0.95); B.line[b] *= 0.5;
        const pb = (b - 1 + this.n) % this.n; B.speed[pb] = Math.max(0.85, B.speed[pb] * 0.97);
        careful++; continue;
      }
      if (!this.me.c[b] || !this.oni.c[b]) continue;
      const ps = this.me.sp[b] / this.me.c[b], os = this.oni.sp[b] / this.oni.c[b];
      if (ps > os * 1.03) {
        B.speed[b] = Math.min(1.3, B.speed[b] * Math.min(1.04, ps / os));
        const pl = this.me.lat[b] / this.me.c[b];
        B.line[b] = Math.max(-lim, Math.min(lim, B.line[b] + (pl - B.line[b]) * 0.3));
        faster++;
      }
    }
    if (played) {
      B.races++;
      if (oniWon) { B.wins++; B.power = Math.max(0, B.power - 0.004); }
      else { B.losses++; B.power = Math.min(MAX_POWER, B.power + 0.02); }
    }
    return { brain: B, faster, careful };
  }
}
