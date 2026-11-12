// ONE MECH, EVERYWHERE IT IS SAVED (OTTO, 2026-11-11: "if someone makes an
// edit on a mech inside of a squad that is a saved mech we need to make sure
// that the individual mech also takes those changes and vice versa").
//
// A squad keeps its own copy of each mech's loadout, which is what lets a squad
// open on a device that never saw the saved unit. So the link between a saved
// unit and the squads it went into is the BUILD ITSELF: a squad mech whose six
// slots match a saved unit's is that unit. An edit made in either place is
// carried to every other place holding the same build before the edit, and
// because they are all changed together they still match afterwards, so the
// link holds for the next edit. No id is stored, so nothing new has to travel
// to the account or survive the server's schema.
//
// The shipped starters (builtins) are never rewritten: a starter unit stays as
// it ships, and a starter squad changes only when the player edits it
// directly (squadstore.updateSquad turns it into their own copy then).
import type { MechLoadout } from './types';
import { isBuiltInPreset, loadMechPresets, updateMechPreset, type MechPreset } from './presets';
import { isBuiltInSquad, loadSquads, updateSquad, type SavedSquad } from './squadstore';

const SLOTS: (keyof MechLoadout)[] = ['torso', 'chasis', 'leftHand', 'rightHand', 'backpack', 'pilot'];

export function sameBuild(a: MechLoadout, b: MechLoadout): boolean {
  return SLOTS.every((k) => (a[k] ?? '') === (b[k] ?? ''));
}

// An empty build matches nothing: two half-started mechs are not one unit.
const isEmpty = (m: MechLoadout): boolean => SLOTS.every((k) => !m[k]);

export interface MechLinks {
  units: MechPreset[];
  squads: { squad: SavedSquad; index: number }[];
}

// Everywhere the build `m` is held, leaving out the place being edited.
export function linksOf(m: MechLoadout, skip: { unit?: string; squad?: string; index?: number } = {}): MechLinks {
  if (isEmpty(m)) return { units: [], squads: [] };
  const units = loadMechPresets().filter((p) => !isBuiltInPreset(p.id) && p.id !== skip.unit && sameBuild(p.mech, m));
  const squads: MechLinks['squads'] = [];
  for (const sq of loadSquads()) {
    if (isBuiltInSquad(sq.id)) continue;
    sq.mechs.forEach((x, index) => {
      if (sq.id === skip.squad && index === skip.index) return;
      if (sameBuild(x.loadout, m)) squads.push({ squad: sq, index });
    });
  }
  return { units, squads };
}

// What the editor says the save will also change, in plain words, or ''.
export function linksSummary(l: MechLinks): string {
  const parts: string[] = [];
  if (l.units.length) parts.push(l.units.length === 1 ? `the saved unit ${l.units[0].name}` : `${l.units.length} saved units`);
  const names = [...new Set(l.squads.map((s) => s.squad.name))];
  if (names.length) parts.push(names.length === 1 ? `its copy in ${names[0]}` : `its copies in ${names.length} squads`);
  return parts.join(' and ');
}

// Carries an edit from `was` to `now` to every other place holding `was`.
// Each place keeps its own name. Returns how many places changed.
export function carryMechEdit(was: MechLoadout, now: MechLoadout, at: number, skip: { unit?: string; squad?: string; index?: number } = {}): number {
  if (sameBuild(was, now)) return 0;
  const l = linksOf(was, skip);
  for (const u of l.units) updateMechPreset({ ...u, mech: { ...now } }, at);
  // One write per squad, however many of its mechs matched.
  const bySquad = new Map<string, number[]>();
  for (const s of l.squads) bySquad.set(s.squad.id, [...(bySquad.get(s.squad.id) ?? []), s.index]);
  for (const [id, idx] of bySquad) {
    const sq = loadSquads().find((x) => x.id === id);
    if (!sq) continue;
    updateSquad({ ...sq, mechs: sq.mechs.map((x, i) => (idx.includes(i) ? { ...x, loadout: { ...now } } : x)) }, at);
  }
  return l.units.length + l.squads.length;
}
