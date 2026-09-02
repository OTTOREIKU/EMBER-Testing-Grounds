import { assetUrl } from './data';

// Inline SVG so an icon inherits currentColor and stays flat next to the mono
// readouts, rather than a system emoji rendering as full-colour 3D art.

export const ICON_EDIT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3"'
  + ' stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
  + '<path d="M13 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7"/>'
  + '<path d="M18.4 2.6a2.1 2.1 0 0 1 3 3L12 15l-4.2 1.2L9 12Z"/></svg>';

// Electronic warfare only. Link used to borrow this bolt as well, which was
// simply the wrong symbol: the printed cards mark Link with the interlocking
// shape below, and a lightning bolt is the Lightning DIE FACE, which is what
// Electronic Counter-rolls are actually counted in.
export const ICON_BOLT = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">'
  + '<path d="M14 2 5 13.4h5.2L9 22l10-12.2h-6.1L14 2Z"/></svg>';

// ---------- the emoji sweep (2026-09-01) ----------
//
// These replace the nine emoji that were still sitting in combat notes and
// button labels. The tell that they never belonged was in styles.css:
// `.btn-ico { filter: grayscale(1); opacity: .7 }` - a CSS filter muting an
// emoji so it stopped shouting. A desaturated emoji is still an emoji, still
// renders differently on every platform, and still cannot take an accent
// colour. Each of these takes currentColor like the rest of the file.
//
// Two of them REUSE a symbol rather than inventing one: Protection is the
// Defense shield, and the counter-roll's versus mark is ICON_BOLT, which
// already stands for electronic warfare. Same idea, same shape.

// Roll dice. A die, not a pair - every button that carries it rolls one pool.
export const ICON_DICE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"'
  + ' stroke-linejoin="round" aria-hidden="true"><rect x="3.5" y="3.5" width="17" height="17" rx="3.4"/>'
  + '<circle cx="8.6" cy="8.6" r="1.5" fill="currentColor" stroke="none"/>'
  + '<circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none"/>'
  + '<circle cx="15.4" cy="15.4" r="1.5" fill="currentColor" stroke="none"/></svg>';

// Detonation. A burst, deliberately not the Heavy Hit die face: one is a die
// result and the other is a Projectile going off, and they appear together.
export const ICON_BURST = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">'
  + '<polygon points="12,1.5 14.6,7.4 20.6,5.2 18.2,11.1 23,13.4 17.2,14.6 19,20.8 13.4,17.9'
  + ' 12,23.5 10.6,17.9 5,20.8 6.8,14.6 1,13.4 5.8,11.1 3.4,5.2 9.4,7.4"/></svg>';

// Protection, in the shape of the Defense die face it is counted in.
export const ICON_SHIELD = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"'
  + ' stroke-linejoin="round" aria-hidden="true">'
  + '<path d="M12 2.4 20 5.8v6.1c0 5.2-3.4 8.7-8 10.1-4.6-1.4-8-4.9-8-10.1V5.8Z"/></svg>';

// Armor Piercing: dice coming off the defender's pool before it is rolled.
export const ICON_PIERCE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"'
  + ' aria-hidden="true"><circle cx="12" cy="12" r="8.4"/><circle cx="12" cy="12" r="3.4"/>'
  + '<path d="M12 1.4v3.2M12 19.4v3.2M1.4 12h3.2M19.4 12h3.2" stroke-linecap="round"/></svg>';

// Observation: a spotter feeding someone else's roll.
export const ICON_SIGNAL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"'
  + ' stroke-linecap="round" aria-hidden="true">'
  + '<circle cx="12" cy="18.5" r="2.1" fill="currentColor" stroke="none"/>'
  + '<path d="M7.4 14.4a6.5 6.5 0 0 1 9.2 0"/><path d="M4 11a11.2 11.2 0 0 1 16 0"/></svg>';

// A Stance that can no longer be changed.
export const ICON_LOCK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"'
  + ' stroke-linejoin="round" aria-hidden="true">'
  + '<rect x="4.6" y="10.4" width="14.8" height="11.2" rx="2.2"/>'
  + '<path d="M8.2 10.4V7.6a3.8 3.8 0 0 1 7.6 0v2.8"/></svg>';

// A line of sight that is held: smoke, or a unit standing in the way.
export const ICON_BLOCKED = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"'
  + ' stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="8.6"/>'
  + '<path d="M6.6 6.6 17.4 17.4"/></svg>';

// Something the player should read before it costs them.
export const ICON_WARN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"'
  + ' stroke-linejoin="round" aria-hidden="true"><path d="M12 3.4 22 20.6H2Z"/>'
  + '<path d="M12 9.6v4.6" stroke-linecap="round"/>'
  + '<circle cx="12" cy="17.4" r="1.15" fill="currentColor" stroke="none"/></svg>';

export const ICON_EXPAND = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"'
  + ' stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
  + '<path d="M14 4h6v6"/><path d="M10 20H4v-6"/><path d="M20 4l-7 7"/><path d="M4 20l7-7"/></svg>';

// Two panels side by side: what the compare pin does to the preview column.
export const ICON_COMPARE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"'
  + ' stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
  + '<rect x="3" y="5" width="7.5" height="14" rx="1.4"/><rect x="13.5" y="5" width="7.5" height="14" rx="1.4"/></svg>';

// The printed pilot cards tint the Link mark to the pilot's faction, so the
// readout follows suit. Electronic warfare keeps the gold accent instead.
const FACTION_VAR: Record<string, string> = {
  RDL: '--rdl',
  UN: '--un',
  GOF: '--gof',
  PD: '--pd',
  COLLABORATION: '--collab',
};

export function factionColour(faction: string | null | undefined): string {
  return `var(${(faction && FACTION_VAR[faction]) || '--accent'})`;
}

// A whole squad's colour, which is not the same question as one card's. A squad
// with no single allegiance — empty, mercenaries only, or two factions at once
// — has no faction to show, and borrowing the accent for it reads as GoF. Card
// -level lookups keep using factionColour, where the accent is a fine "not
// recorded" fallback.
export function squadColour(faction: string | null | undefined): string {
  return faction ? factionColour(faction) : 'var(--neutral)';
}

// The Link mark, which is the publisher's own icon rather than a redrawing of
// it. It is a flat silhouette, so it is used as a mask and painted with
// currentColor - that keeps the real artwork while still letting it take the
// pilot's faction colour the way the printed card does. The URL is built with
// assetUrl rather than written into the stylesheet because the asset folder
// sits outside the bundler's source tree, so a CSS url() could not be resolved
// for both the dev server and the built site.
//
// It MUST be absolute. A url() inside a custom property is resolved against the
// stylesheet that consumes it, not the element that declares it, so the relative
// path assetUrl returns was re-resolved against the bundled CSS in /build/ and
// 404'd on the live site while working perfectly on the dev server. A failed
// mask counts as no mask, so the icon painted as a solid coloured block.
//
// Resolved ON FIRST USE, not at import. As a module-scope const it read
// `document.baseURI` the instant anything imported this file, so importing it
// from a non-DOM context threw `Invalid URL` before a line of test code ran -
// which is exactly what happened the first time combat.ts pulled an icon in.
let linkSrc: string | null = null;

function linkMaskUrl(): string {
  if (linkSrc === null) {
    linkSrc = new URL(assetUrl('tokens/tab/icon_LV.webp'), document.baseURI).href;
  }
  return linkSrc;
}

export function linkIcon(faction?: string | null, extraClass = ''): string {
  return `<i class="lk-icon${extraClass ? ` ${extraClass}` : ''}" aria-hidden="true" style="color:${factionColour(
    faction,
  )};--lk-src:url(${linkMaskUrl()})"></i>`;
}
