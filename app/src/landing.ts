import { registerOffline } from './offline';
import { warmAllImages, warmDecision } from './images';
import { mechArtLayers } from './data';
import { barcodeSvg } from './barcode';

// The Mechs behind the wordmark, built by the same function as every other
// tool (data.ts mechArtLayers), so they stack exactly as they do on the board.
// The BACKPACK is left out of the loadout here: the board and the pad draw it
// beside the Mech so a player can see which one is fitted, but as a picture it
// floats loose (OTTO, 2026-09-24).
// An RDL Dune in front, OTTO's pick (2026-09-24): Dune Tactical Core, RL-08
// Armored Chassis, Type 77 Bulwark shield, AC-150 HMG. A UN Caracal behind it,
// also OTTO's pick: TM31R Caracal Battle Core, LM210S Stealth Chassis, S100
// Shield, IGX350 Ion Shotgun - facing the other way, on a wide screen only
// (the CSS hides it on a phone).
const MECHS: [string, { torso: string; chasis: string; leftHand: string; rightHand: string }][] = [
  ['land-mech', { torso: '014', chasis: '021', leftHand: '034', rightHand: '030' }],
  ['land-mech-un', { torso: '092', chasis: '100', leftHand: '142', rightHand: '140' }],
];
for (const [id, loadout] of MECHS) {
  const mech = document.getElementById(id);
  if (!mech) continue;
  for (const src of mechArtLayers(loadout)) {
    const img = document.createElement('img');
    img.src = src;
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
