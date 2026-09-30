import { registerOffline } from './offline';
import { warmAllImages, warmDecision } from './images';
import { mechArtLayers } from './data';
import { barcodeSvg } from './barcode';
import { watchForUpdates } from './updates';

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

// The Tabletop row links nowhere, on every screen, and says UNDER CONSTRUCTION
// (OTTO, 2026-09-30): the focus is the Reference and the Pad until the tabletop's
// next changes land. The page itself still opens at /table/ for anyone who has
// the address. That is markup alone (index.html), with no href to take away; it
// replaces the phone-only DESKTOP ONLY state it had since 2026-09-24.

// A tap on a section starts the image warm-up at once, so the pictures are
// already arriving while the next page loads. The service worker keeps what
// lands, and the next page's own preload finds it there. Not on a metered or
// slow connection - the same test every other page applies.
for (const a of document.querySelectorAll<HTMLAnchorElement>('.land-row:not(.off)')) {
  a.addEventListener('pointerdown', () => { if (warmDecision().warm) void warmAllImages(); }, { once: true });
}

registerOffline();

// A newer build turns the status line's right end (LINK OK) into NEW VERSION ·
// RELOAD. Nothing on this page can be lost, so there is no Later.
watchForUpdates({
  compact: true,
  place: (notice) => document.querySelector('.land-status span:last-child')?.replaceWith(notice),
});
