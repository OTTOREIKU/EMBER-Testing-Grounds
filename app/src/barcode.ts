// An ORIGINAL barcode: bar widths derived from a word, so it reads like a code
// without copying the publisher's mark (their EMBER barcode logo is a
// trademark). Each word draws its own pattern - a renamed unit gets a new one.
//
// Drawn in word units and stretched to whatever box CSS gives it
// (preserveAspectRatio="none"), so it needs no measuring, survives a resize,
// and can go straight into a template string. Bars take currentColor.
export function barcodeSvg(seed: string, cls: string, vertical = false): string {
  const widths: number[] = [];
  for (const ch of seed) {
    const c = ch.charCodeAt(0);
    widths.push(1 + (c % 3), 1 + ((c >> 2) % 2), 1 + ((c >> 3) % 4), 1 + ((c >> 1) % 2));
  }
  if (!widths.length) return '';
  let at = 0;
  let on = true;
  let out = '';
  for (const w of widths) {
    if (on) out += vertical ? `<rect x="0" y="${at}" width="1" height="${w}"/>` : `<rect x="${at}" y="0" width="${w}" height="1"/>`;
    at += w;
    on = !on;
  }
  const box = vertical ? `0 0 1 ${at}` : `0 0 ${at} 1`;
  return `<svg class="${cls}" viewBox="${box}" preserveAspectRatio="none" fill="currentColor" aria-hidden="true">${out}</svg>`;
}
