// What a game against the computer is asked for by: the speeds a player may
// pick, and the address that names a game. Kept apart from solo.ts, which sits
// the computer in its seat, so that a page which only OFFERS a game (the
// tabletop's Setup tab) carries none of the machinery that plays one.
import type { SoloSquad } from './data';
import type { MechLoadout, Side } from './types';

export type Speed = 'relaxed' | 'normal' | 'brisk';

// The speeds a player may pick, slowest first, and what each does to every
// pause the computer takes (solo.ts thinkMs, restMs). Normal is the one those
// pauses are written for.
export const SPEEDS: { id: Speed; name: string; note: string; scale: number }[] = [
  { id: 'relaxed', name: 'Relaxed', note: 'time to read every step', scale: 1.6 },
  { id: 'normal', name: 'Normal', note: 'a person\'s pace', scale: 1 },
  { id: 'brisk', name: 'Brisk', note: 'for a table you know', scale: 0.55 },
];

// The opponents a player may pick: what each is called and what it does, in a
// line. The three levels first, easiest first (M9.1, OTTO 2026-10-03), then the
// Brawler. The policies themselves are solo.ts's (OPPONENTS, which also has two
// more that only an address asks for), so a page that offers a game carries
// none of them. The Ace keeps the Tactician's name in an address and in what a
// device remembers, so a game set up before the levels came is the same game.
export const RIVALS: { id: string; name: string; note: string }[] = [
  { id: 'recruit', name: 'Recruit', note: 'makes mistakes' },
  { id: 'veteran', name: 'Veteran', note: 'plays a turn at a time' },
  { id: 'tactician', name: 'Ace', note: 'plays for the mission' },
  { id: 'brawler', name: 'Brawler', note: 'attacks what it can reach' },
];
// The one a game is played against unless another is picked: the Ace.
export const RIVAL = 'tactician';

// A GAME THE PLAYER PUT TOGETHER (solosetup.ts): any battlefield, any Main
// Task, and a squad for each seat. It is asked for by this name, and the game
// itself is kept in this device's storage under this key: an address is no
// place for two squads, and a rematch asks for the same game again.
export const SOLO_OWN = 'own';
export const SOLO_OWN_KEY = 'ember-solo-own';

export interface SoloOwn {
  map: string;
  mission: string;
  rounds: number;
  secondaries: boolean;
  // Each seat's squad, as the table imports one (commands.ts importSquad).
  squads: Record<Side, SoloSquad>;
}

const SLOTS: (keyof MechLoadout)[] = ['torso', 'chasis', 'leftHand', 'rightHand', 'backpack', 'pilot'];

// One squad out of storage, kept to the shape the table imports: names and
// card ids as plain text, nothing else carried over. Whether the cards exist
// and the squad is legal is the table's to say when it is imported.
function ownSquad(raw: unknown): SoloSquad | null {
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as { name?: unknown; faction?: unknown; mechs?: unknown; drones?: unknown };
  const mechs: SoloSquad['mechs'] = [];
  for (const m of Array.isArray(s.mechs) ? s.mechs : []) {
    if (!m || typeof m !== 'object') continue;
    const src = ((m as { loadout?: unknown }).loadout ?? {}) as Record<string, unknown>;
    const loadout: MechLoadout = {};
    for (const slot of SLOTS) { const v = src[slot]; if (typeof v === 'string' && v) loadout[slot] = v; }
    if (!loadout.torso && !loadout.chasis) continue;
    const name = (m as { name?: unknown }).name;
    mechs.push({ ...(typeof name === 'string' && name ? { name } : {}), loadout });
  }
  const drones: SoloSquad['drones'] = [];
  for (const d of Array.isArray(s.drones) ? s.drones : []) {
    if (!d || typeof d !== 'object' || typeof (d as { cardId?: unknown }).cardId !== 'string') continue;
    const backpack = (d as { backpack?: unknown }).backpack;
    drones.push({ cardId: (d as { cardId: string }).cardId, ...(typeof backpack === 'string' && backpack ? { backpack } : {}) });
  }
  if (!mechs.length && !drones.length) return null;
  // Its Tactics Cards, as ids, each once: whether they are cards a squad may
  // hold is the table's to say when the hand is dealt.
  const cards = (s as { tactics?: unknown }).tactics;
  const tactics = [...new Set((Array.isArray(cards) ? cards : []).filter((t): t is string => typeof t === 'string' && !!t))].slice(0, 8);
  return {
    name: typeof s.name === 'string' && s.name.trim() ? s.name.trim().slice(0, 60) : 'Squad', ...(typeof s.faction === 'string' ? { faction: s.faction } : {}), mechs, drones,
    ...(tactics.length ? { tactics } : {}),
  };
}

// The game out of storage, or null when what is there is not one.
export function ownGame(raw: unknown): SoloOwn | null {
  if (!raw || typeof raw !== 'object') return null;
  const g = raw as { map?: unknown; mission?: unknown; rounds?: unknown; secondaries?: unknown; squads?: unknown };
  const squads = (g.squads && typeof g.squads === 'object' ? g.squads : {}) as Record<string, unknown>;
  const s1 = ownSquad(squads.s1);
  const s2 = ownSquad(squads.s2);
  if (typeof g.map !== 'string' || typeof g.mission !== 'string' || !s1 || !s2) return null;
  const rounds = Number(g.rounds);
  return { map: g.map, mission: g.mission, rounds: Number.isInteger(rounds) && rounds >= 1 && rounds <= 9 ? rounds : 5, secondaries: g.secondaries === true, squads: { s1, s2 } };
}

// What a page's address asks for, before the card data is in:
// ?solo=<scenario id, or own>&side=<faction, or s1 / s2>&seed=<n>&pace=<speed>&ai=<opponent>&watch=1
export function soloAsk(search: string): Record<string, string> | null {
  const q = new URLSearchParams(search);
  const id = q.get('solo');
  if (!id) return null;
  const out: Record<string, string> = { solo: id };
  for (const k of ['side', 'seed', 'pace', 'ai', 'watch']) { const v = q.get(k); if (v) out[k] = v; }
  return out;
}

// The address of a game, for the page that offers one and for a rematch. It
// says only what is not the default.
export function soloQuery(o: { scenario: string; side: string; seed?: number; speed?: Speed; opponent?: string; watch?: boolean }): string {
  const q = new URLSearchParams({ solo: o.scenario, side: o.side });
  if (o.seed !== undefined) q.set('seed', String(o.seed));
  if (o.speed && o.speed !== 'normal') q.set('pace', o.speed);
  if (o.opponent && o.opponent !== RIVAL) q.set('ai', o.opponent);
  if (o.watch) q.set('watch', '1');
  return `?${q.toString()}`;
}
