// Secret car unlock. The garage has a small "Enter code" box; the right code unlocks the hidden
// Creator category. Only a SHA-256 hash of the (trimmed, lower-cased) code lives in the source.
// The unlock is remembered in localStorage. Online, every player can still SEE the creator car
// (the server accepts its id); the code only gates picking it in the garage.

const CREATOR_HASH = '9f80b7d6dd66288901944a4145dc5562b31faa0db3bb01b6f4518c84f43c90b0';
const KEY = 'driftclub.creatorUnlocked';
let unlockedThisSession = false;

// tiny pure-JS SHA-256 (used when crypto.subtle is missing, e.g. plain http on a LAN address)
export function sha256Fallback(bytes) {
  const K = [], H = [];
  let n = 2;
  const frac = (x) => ((x - Math.floor(x)) * 4294967296) | 0;
  for (let i = 0; i < 64; n++) {
    let prime = true;
    for (let d = 2; d * d <= n; d++) if (n % d === 0) { prime = false; break; }
    if (prime) { if (i < 8) H[i] = frac(Math.pow(n, 1 / 2)); K[i++] = frac(Math.pow(n, 1 / 3)); }
  }
  const len = bytes.length, words = [];
  const total = (((len + 8) >> 6) + 1) << 4;
  for (let i = 0; i < total; i++) words[i] = 0;
  for (let i = 0; i < len; i++) words[i >> 2] |= bytes[i] << (24 - (i % 4) * 8);
  words[len >> 2] |= 0x80 << (24 - (len % 4) * 8);
  words[total - 1] = len * 8;
  const w = new Array(64), ror = (x, r) => (x >>> r) | (x << (32 - r));
  for (let j = 0; j < total; j += 16) {
    let [a, b, c, d, e, f, g, h] = H;
    for (let i = 0; i < 64; i++) {
      if (i < 16) w[i] = words[j + i] | 0;
      else {
        const s0 = ror(w[i - 15], 7) ^ ror(w[i - 15], 18) ^ (w[i - 15] >>> 3);
        const s1 = ror(w[i - 2], 17) ^ ror(w[i - 2], 19) ^ (w[i - 2] >>> 10);
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
      }
      const t1 = (h + (ror(e, 6) ^ ror(e, 11) ^ ror(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) | 0;
      const t2 = ((ror(a, 2) ^ ror(a, 13) ^ ror(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
      h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    H[0] = (H[0] + a) | 0; H[1] = (H[1] + b) | 0; H[2] = (H[2] + c) | 0; H[3] = (H[3] + d) | 0;
    H[4] = (H[4] + e) | 0; H[5] = (H[5] + f) | 0; H[6] = (H[6] + g) | 0; H[7] = (H[7] + h) | 0;
  }
  return H.map((x) => (x >>> 0).toString(16).padStart(8, '0')).join('');
}

export const sha256Hex = async (text) => {
  const bytes = new TextEncoder().encode(text);
  try {
    const c = globalThis.crypto;
    if (c && c.subtle && c.subtle.digest) {
      const buf = await c.subtle.digest('SHA-256', bytes);
      return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
    }
  } catch { /* fall through to the pure-JS version */ }
  return sha256Fallback(bytes);
};

export function creatorUnlocked() {
  try { return localStorage.getItem(KEY) === '1'; } catch { return false; }
}
// resolves true (and remembers it) when the code is right
export const tryCreatorCode = async (code) => {
  const norm = String(code || '').trim().toLowerCase();
  if (!norm) return false;
  const ok = (await sha256Hex(norm)) === CREATOR_HASH;
  if (ok) { try { localStorage.setItem(KEY, '1'); } catch { /* private mode: unlocked for this session only */ } unlockedThisSession = true; }
  return ok;
};
export const isCreatorUnlocked = () => unlockedThisSession || creatorUnlocked();
