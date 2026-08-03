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
  saved: number;
}

const SLOTS: (keyof MechLoadout)[] = ['torso', 'chasis', 'leftHand', 'rightHand', 'backpack', 'pilot'];

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
  return { id: s.id, name: s.name, mechs, drones, saved: typeof s.saved === 'number' ? s.saved : 0 };
}

export function loadSquads(): SavedSquad[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '[]') as unknown[];
    if (!Array.isArray(raw)) return [];
    return raw.map(clean).filter((x): x is SavedSquad => !!x);
  } catch {
    return [];
  }
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
): SavedSquad[] {
  const list = loadSquads();
  const trimmed = name.trim();
  if (!trimmed || (!mechs.length && !drones.length)) return list;
  const at = list.findIndex((s) => s.name.toLowerCase() === trimmed.toLowerCase());
  const entry: SavedSquad = { id: at >= 0 ? list[at].id : `sq${now}`, name: trimmed, mechs, drones, saved: now };
  if (at >= 0) list[at] = entry;
  else list.push(entry);
  list.sort((a, b) => a.name.localeCompare(b.name));
  write(list);
  return list;
}

export function deleteSquad(id: string): SavedSquad[] {
  const list = loadSquads().filter((s) => s.id !== id);
  write(list);
  return list;
}
