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
export function linkIcon(faction?: string | null, extraClass = ''): string {
  return `<i class="lk-icon${extraClass ? ` ${extraClass}` : ''}" aria-hidden="true" style="color:${factionColour(
    faction,
  )};--lk-src:url(${assetUrl('tokens/tab/icon_LV.webp')})"></i>`;
}
