// Small readers the pad's sheet and bar print with, kept apart from pad.ts so
// the tests can load them without the page (player feedback, 2026-11-25).

// An Action's Range on its row, as the card prints it ("Range --" for 0),
// with what the auras add to it. None for an Action that prints no Range.
export function rangeMeta(printed: number | undefined, reach: number): string {
  if (printed === undefined) return '';
  if (printed === 0 && reach === 0) return 'Range --';
  return `Range ${reach}`;
}

// "Season 1.04" as the bar shows it: "S1.04".
export function seasonShort(label: string): string {
  return label.replace(/^Season\s*/i, 'S');
}

// Where an Action is listed on the sheet (player feedback, 2026-11-25): by its
// Timing for the ones the dial sets, then Command Actions and Automatic
// Actions apart (they shared one heading), anything else with no Timing
// (Delay, Immediate, Detonation) under its own type, and Passives last.
// `rank` orders the headings.
export function actionGroupOf(a: { speed?: string; type?: string }, timing?: { index: number; name: string }): { name: string; rank: number } {
  if (a.speed === 'command') return { name: 'Command Actions', rank: 95 };
  if (a.speed === 'auto') return { name: 'Automatic Actions', rank: 96 };
  if (timing && a.speed !== 'passive') return { name: timing.name, rank: timing.index };
  if (a.type === 'Passive' || a.speed === 'passive') return { name: 'Passive', rank: 98 };
  return { name: a.type || 'Other', rank: 97 };
}
