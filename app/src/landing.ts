import { registerOffline } from './offline';
import { warmAllImages, warmDecision } from './images';
import { assetUrl } from './data';
import { barcodeSvg } from './barcode';

// The Mech behind the wordmark, drawn from its Parts in the board's stacking
// order (chassis, backpack, torso, left, right): the RDL starter's Dune.
const MECH = ['534', '532', '014', '535', '025'];
const mech = document.getElementById('land-mech');
if (mech) {
  for (const id of MECH) {
    const img = document.createElement('img');
    img.src = assetUrl(`mech_parts/${id}.webp`);
    img.alt = '';
    img.decoding = 'async';
    img.addEventListener('error', () => img.remove(), { once: true });
    mech.appendChild(img);
  }
}

// The barcodes, drawn by the shared generator (src/barcode.ts) from each
// svg's data-seed: the strip down the edge and the code under the wordmark.
for (const svg of document.querySelectorAll<SVGSVGElement>('svg.land-bars')) {
  svg.outerHTML = barcodeSvg(svg.dataset.seed ?? '', svg.getAttribute('class') ?? '', !!svg.dataset.vertical);
}

// The tabletop was laid out for a desktop: a two-rail board with a hover-driven
// inspector. On a phone it is DISABLED, not just greyed: a row that looked off
// but still opened read as a bug (OTTO, 2026-09-24). A tap says why instead, in
// the row's own label. A touch screen narrower than a small tablet, or anything
// phone-narrow; width alone would disable it in a small desktop window, which
// the board copes with. A tablet held sideways (1024px+) keeps it.
const phone = window.matchMedia('(pointer: coarse) and (max-width: 1023px), (max-width: 599px)').matches;
const table = document.getElementById('land-table');
if (phone && table) {
  table.classList.add('off');
  table.removeAttribute('href');
  table.setAttribute('role', 'link');
  table.setAttribute('aria-disabled', 'true');
  table.setAttribute('title', 'Built for a desktop screen');
  table.addEventListener('click', () => {
    const label = table.querySelector('em');
    if (label) label.textContent = 'DESKTOP ONLY';
  });
}

// A tap on a section starts the image warm-up at once, so the pictures are
// already arriving while the next page loads. The service worker keeps what
// lands, and the next page's own preload finds it there. Not on a metered or
// slow connection - the same test every other page applies.
for (const a of document.querySelectorAll<HTMLAnchorElement>('.land-row:not(.off)')) {
  a.addEventListener('pointerdown', () => { if (warmDecision().warm) void warmAllImages(); }, { once: true });
}

registerOffline();
