// THE BUILD RULES, in one place for every builder: the Collection page, the
// Tabletop's roster and the Pad (OTTO, 2026-11-16: "design a system that
// will be used across all apps and is the same for everything"). Each answers
// "may this card go here?" the same way:
//
// 1. ONE FACTION PER MECH (rulebook 5.1), the pilot included (pilots are
//    faction-locked like Parts; see mechbuilder.ts buildFactions).
// 2. ONE FACTION PER SQUAD, and the mercenaries (PD, the Collaboration;
//    units.ts MERCENARY_FACTIONS) may join any squad. A squad takes its
//    faction from its first non-mercenary unit; while it has none (empty,
//    all mercenary) it takes anything, and a squad that is already mixed
//    (an import, an old save) is offered everything and warned about.
// 3. ONE PILOT PER UNIT, and a pilot is one person: a pilot already flying
//    another mech in the squad is not offered again (a player, 2026-11-16).
//
// A card whose faction the data cannot tell is never refused for faction.
// The card already in a slot always stays on offer, so opening a broken
// build never hides what it holds.
import type { Card, MechLoadout } from './types';
import type { GameData } from './data';
import { buildFactions, slotPool, type BuildSlot } from './mechbuilder';
import { MERCENARY_FACTIONS } from './units';

export const isMercenary = (f: string | null | undefined): boolean => !!f && MERCENARY_FACTIONS.includes(f);

// The other units of the squad a card or mech is joining.
export interface SquadUnits {
  mechs: MechLoadout[];
  drones: string[];
}

// The squad's own faction: its one non-mercenary faction, or null when it has
// none yet or already holds two.
export function squadFactionOf(data: GameData, units: SquadUnits): string | null {
  const own = new Set<string>();
  const add = (f: string | null | undefined): void => { if (f && !isMercenary(f)) own.add(f); };
  for (const m of units.mechs) buildFactions(data, m).factions.forEach(add);
  for (const id of units.drones) { const c = data.byId.get(id); add(c ? data.factionOf(c) : null); }
  return own.size === 1 ? [...own][0] : null;
}

// Rule 2 for one card (a Part, a Pilot or a Drone).
export function cardFitsSquadFaction(data: GameData, squadFaction: string | null, card: Card): boolean {
  if (!squadFaction) return true;
  const f = data.factionOf(card);
  return !f || f === squadFaction || isMercenary(f);
}

// Rule 2 for a whole mech (a saved unit going into a squad).
export function mechFitsSquadFaction(data: GameData, squadFaction: string | null, m: MechLoadout): boolean {
  return !squadFaction || buildFactions(data, m).factions.every((f) => f === squadFaction || isMercenary(f));
}

// Rule 3: the pilots flying the squad's other mechs.
export function pilotsInUse(units: SquadUnits): Set<string> {
  return new Set(units.mechs.map((m) => m.pilot).filter((p): p is string => !!p));
}

// A saved unit may join the squad: its faction fits and its pilot is free.
export function unitFitsSquad(data: GameData, units: SquadUnits, m: MechLoadout): boolean {
  return mechFitsSquadFaction(data, squadFactionOf(data, units), m) && !(m.pilot && pilotsInUse(units).has(m.pilot));
}

// Every card one slot of a mech may take, rules 1-3 on top of the shared pool
// (mechbuilder.ts slotPool). `squad` is the squad's OTHER units, or left out
// for a mech built on its own.
export function legalSlotCards(data: GameData, mech: MechLoadout, slot: BuildSlot, squad?: SquadUnits, pool?: Card[]): Card[] {
  const chosen = mech[slot.key];
  const rest = { ...mech };
  delete rest[slot.key];
  const mf = buildFactions(data, rest).factions;
  const mechFaction = mf.length === 1 ? mf[0] : null;
  const squadFaction = squad ? squadFactionOf(data, squad) : null;
  const flying = slot.key === 'pilot' && squad ? pilotsInUse(squad) : new Set<string>();
  return (pool ?? slotPool(data, slot, chosen)).filter((c) => {
    if (c.id === chosen) return true;
    const f = data.factionOf(c);
    if (mechFaction && f && f !== mechFaction) return false;
    if (!cardFitsSquadFaction(data, squadFaction, c)) return false;
    return !flying.has(c.id);
  });
}
