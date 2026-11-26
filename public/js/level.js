// Player level: XP from drifting, distance driven and finishing races/battles/challenges.
// Each level needs a bit more XP than the last. Some levels unlock secret cars.
export const xpNeed = (L) => 400 + 200 * (L - 1);
export const MAX_LEVEL = 999;
export function levelInfo(xp) {
  let L = 1, x = Math.max(0, Math.floor(xp || 0));
  while (L < MAX_LEVEL && x >= xpNeed(L)) { x -= xpNeed(L); L++; }
  return { level: L, into: x, need: xpNeed(L) };
}
export const LEVEL_REWARDS = { 10: 'kitsune', 25: 'raijin' }; // level -> secret car unlock name
// XP for a finished competition (from App.saveRecord)
export function xpForRecord(type, d) {
  if (type === 'race') return (d.time ? 150 + Math.max(0, (d.field || 1) - (d.pos || 1)) * 60 + (d.pos === 1 && d.field > 1 ? 250 : 0) : 40) + (d.beatBoss ? 600 : 0);
  if (type === 'driftrace') return (d.finished ? 150 : 40) + Math.max(0, (d.field || 1) - (d.pos || 1)) * 60 + (d.pos === 1 && d.field > 1 ? 250 : 0) + (d.beatBoss ? 600 : 0);
  if (type === 'battle') return d.solo ? 120 + Math.min(300, (d.total || 0) * 3) : d.won ? 450 : d.draw ? 250 : 150;
  if (type === 'challenge') return 100 + Math.min(600, Math.round((d.total || d.bestChain || 0) / 100));
  return 0;
}
