import type { MechLoadout } from './types';

// Whole squads remembered across games, kept in local storage next to the mech
// presets rather than in the board state, because a squad outlives any one
// game. The library fills itself: every squad file imported is remembered
// here, which is what the multiplayer "bring a squad" picker chooses from.

const KEY = 'ember-squads-v1';

export interface SavedSquad {
  id: string;
  name: string;
  mechs: { name?: string; loadout: MechLoadout }[];
  drones: { cardId: string; backpack?: string }[];
  // The Tactics Cards bought with the squad (5.4): part of the squad the same
  // way its points are, so saving and loading must carry them.
  tactics?: string[];
  saved: number;
}

const SLOTS: (keyof MechLoadout)[] = ['torso', 'chasis', 'leftHand', 'rightHand', 'backpack', 'pilot'];

// Squads that ship with the app, so a first-time player has two sides to put on
// the board without building anything. Both are drawn from a single Raid
// 2-Player Starter Set and land a point apart, 383 to 382 - a 600 point game
// needs a second box.
//
// The shape is forced by what the box holds: two RDL torsos, chassis and pilots
// but only one of each for UN, so RDL fields two mechs and UN one mech that
// makes up the difference in drones. Several Raid cards are two faces of ONE
// card, and no squad here uses both faces of any of them.
const BUILT_IN: SavedSquad[] = [
  {
    id: 'builtin:raid-rdl',
    name: 'RAID-RDL-Starter',
    saved: 0,
    // 197 + 186 = 383.
    mechs: [
      {
        name: 'Dune Brawler',
        loadout: { torso: '014', chasis: '534', leftHand: '535', rightHand: '025', backpack: '532', pilot: 'FPA-04-2' },
      },
      {
        name: 'Mire Fire Support',
        loadout: { torso: '533', chasis: '020', leftHand: '032', rightHand: '033', backpack: '004', pilot: 'FPA-63' },
      },
    ],
    drones: [],
  },
  {
    id: 'builtin:raid-un',
    name: 'RAID-UN-Starter',
    saved: 0,
    // 295 for the mech plus 87 of drones: Porcupine CIWS 51 and Raven
    // Interference 36. The CIWS is here for its Intercept 3, which is the answer
    // to the ML-34 rack on the RDL side and the reason to prefer it over the
    // Porcupine Ion - they are two faces of one card, so only one can be
    // fielded. The Tarantula Carrier is deliberately left out: its only keyword
    // is Load, and the carrier rules are the fiddliest thing in the box.
    mechs: [
      {
        name: 'Wild Cat',
        loadout: { torso: '539', chasis: '099', leftHand: '540', rightHand: '541', backpack: '538', pilot: 'LPA-23-2' },
      },
    ],
    drones: [{ cardId: '160' }, { cardId: '166' }],
  },
];

export function isBuiltInSquad(id: string): boolean {
  return id.startsWith('builtin:');
}

function clean(raw: unknown): SavedSquad | null {
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as Partial<SavedSquad>;
  if (typeof s.id !== 'string' || typeof s.name !== 'string') return null;
  const mechs: SavedSquad['mechs'] = [];
  for (const m of Array.isArray(s.mechs) ? s.mechs : []) {
    if (!m || typeof m !== 'object') continue;
    const loadout: MechLoadout = {};
    const src = ((m as { loadout?: unknown }).loadout ?? {}) as Record<string, unknown>;
    for (const slot of SLOTS) {
      const v = src[slot];
      if (typeof v === 'string' && v) loadout[slot] = v;
    }
    if (!loadout.torso && !loadout.chasis) continue;
    const name = (m as { name?: unknown }).name;
    mechs.push({ name: typeof name === 'string' ? name : undefined, loadout });
  }
  const drones: SavedSquad['drones'] = [];
  for (const d of Array.isArray(s.drones) ? s.drones : []) {
    if (!d || typeof d !== 'object' || typeof (d as { cardId?: unknown }).cardId !== 'string') continue;
    const backpack = (d as { backpack?: unknown }).backpack;
    drones.push({ cardId: (d as { cardId: string }).cardId, backpack: typeof backpack === 'string' ? backpack : undefined });
  }
  if (!mechs.length && !drones.length) return null;
  const tactics = (Array.isArray(s.tactics) ? s.tactics : []).filter((t): t is string => typeof t === 'string' && !!t);
  return {
    id: s.id, name: s.name, mechs, drones,
    ...(tactics.length ? { tactics } : {}),
    saved: typeof s.saved === 'number' ? s.saved : 0,
  };
}

export function loadSquads(): SavedSquad[] {
  let saved: SavedSquad[] = [];
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '[]') as unknown[];
    if (Array.isArray(raw)) saved = raw.map(clean).filter((x): x is SavedSquad => !!x);
  } catch {
    saved = [];
  }
  // A squad saved under a shipped name replaces it, so these can be reworked
  // rather than sitting there uneditable beside a near-duplicate.
  const taken = new Set(saved.map((s) => s.name.toLowerCase()));
  const shipped = BUILT_IN.filter((s) => !taken.has(s.name.toLowerCase()));
  return [...shipped, ...saved].sort((a, b) => a.name.localeCompare(b.name));
}

function write(list: SavedSquad[]): void {
  localStorage.setItem(KEY, JSON.stringify(list));
}

// Saving under a name that already exists overwrites it, so re-importing a
// tweaked squad file does not collect near-duplicates.
export function saveSquad(
  name: string,
  mechs: SavedSquad['mechs'],
  drones: SavedSquad['drones'],
  now: number,
  tactics?: string[],
): SavedSquad[] {
  const trimmed = name.trim();
  if (!trimmed || (!mechs.length && !drones.length)) return loadSquads();
  // Only this device's own squads are written back. Saving over a shipped name
  // is allowed and shadows it, but stores a NEW entry rather than editing the
  // shipped one in place.
  const saved = loadSquads().filter((s) => !isBuiltInSquad(s.id));
  const at = saved.findIndex((s) => s.name.toLowerCase() === trimmed.toLowerCase());
  const entry: SavedSquad = {
    id: at >= 0 ? saved[at].id : `sq${now}`, name: trimmed, mechs, drones,
    ...(tactics?.length ? { tactics: [...tactics] } : {}),
    saved: now,
  };
  if (at >= 0) saved[at] = entry;
  else saved.push(entry);
  write(saved);
  return loadSquads();
}

export function deleteSquad(id: string): SavedSquad[] {
  // Writing the merged list back would bake the shipped squads into local
  // storage, and a later change to them would never reach anyone who had opened
  // the tab once.
  if (isBuiltInSquad(id)) return loadSquads();
  const saved = loadSquads().filter((s) => !isBuiltInSquad(s.id) && s.id !== id);
  write(saved);
  return loadSquads();
}
