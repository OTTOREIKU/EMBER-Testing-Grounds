// Inline SVG so an icon inherits currentColor and stays flat next to the mono
// readouts, rather than a system emoji rendering as full-colour 3D art.

export const ICON_EDIT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3"'
  + ' stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
  + '<path d="M13 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7"/>'
  + '<path d="M18.4 2.6a2.1 2.1 0 0 1 3 3L12 15l-4.2 1.2L9 12Z"/></svg>';

export const ICON_BOLT = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">'
  + '<path d="M14 2 5 13.4h5.2L9 22l10-12.2h-6.1L14 2Z"/></svg>';

// The printed pilot cards tint the Link bolt to the pilot's faction, so the
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
