// An ORIGINAL barcode: bar widths derived from a word, so it reads like a code
// without copying the publisher's mark (their EMBER barcode logo is a
// trademark). Each word draws its own pattern - a renamed unit gets a new one.
//
// Drawn in bar units and stretched to whatever box CSS gives it
// (preserveAspectRatio="none"), so it needs no measuring, survives a resize,
// and can go straight into a template string. Bars take currentColor.
//
// Every code fills the SAME number of units (OTTO, 2026-09-29): the first cut
// gave each character four units, so a three-letter name stretched into fat
// blocks and a thirty-character one bunched into hairlines. Now the word seeds
// a hash, the hash a stream of widths, mostly 1 with a 2 or a 3 now and then,
// and the stream is cut at the budget, so the codes read as one family with a
// slight variation each. Guard bars at both ends, the way a printed code has.
const UNITS = 72;

function hash(seed: string): number {
  // FNV-1a over the code points, so every character moves every bar.
  let h = 0x811c9dc5;
  for (const ch of seed) {
    h ^= ch.codePointAt(0) ?? 0;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h || 1;
}

export function barcodeSvg(seed: string, cls: string, vertical = false): string {
  if (!seed) return '';
  let x = hash(seed);
  const next = (): number => {
    // xorshift32: cheap, deterministic, and well spread for a few dozen draws.
    x ^= x << 13; x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5; x >>>= 0;
    return x;
  };
  // Widths: 1 more often than not, 2 sometimes, 3 rarely, so the code stays
  // fine-grained and the variation is in where the thicker bars fall.
  const width = (): number => { const r = next() % 20; return r < 11 ? 1 : r < 17 ? 2 : 3; };
  const widths: number[] = [1, 1, 1]; // the start guard: bar, gap, bar
  let total = 3;
  // Fill to four short of the budget: one unit for the gap the end guard
  // needs in front of it, three for the guard.
  while (total < UNITS - 4) {
    const w = Math.min(width(), UNITS - 4 - total);
    widths.push(w);
    total += w;
  }
  // The run must end on a gap before the guard: a bar last gets a gap after
  // it, a gap last grows by the spare unit. Either way the total is exact.
  if (widths.length % 2 === 1) widths.push(1);
  else widths[widths.length - 1] += 1;
  widths.push(1, 1, 1);
  total = UNITS;
  let at = 0;
  let on = true;
  let out = '';
  for (const w of widths) {
    if (on) out += vertical ? `<rect x="0" y="${at}" width="1" height="${w}"/>` : `<rect x="${at}" y="0" width="${w}" height="1"/>`;
    at += w;
    on = !on;
  }
  const box = vertical ? `0 0 1 ${total}` : `0 0 ${total} 1`;
  return `<svg class="${cls}" viewBox="${box}" preserveAspectRatio="none" fill="currentColor" aria-hidden="true">${out}</svg>`;
}
