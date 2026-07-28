import type { MechLoadout } from './types';

// Saved mech builds, kept in local storage next to the custom maps rather than in
// the board state, because a preset outlives any one game.

const KEY = 'ember-mech-presets-v1';

export interface MechPreset {
  id: string;
  name: string;
  mech: MechLoadout;
  saved: number;
}

const SLOTS: (keyof MechLoadout)[] = ['torso', 'chasis', 'leftHand', 'rightHand', 'backpack', 'pilot'];

function clean(raw: unknown): MechPreset | null {
  if (!raw || typeof raw !== 'object') return null;
  const p = raw as Partial<MechPreset>;
  if (typeof p.id !== 'string' || typeof p.name !== 'string') return null;
  const mech: MechLoadout = {};
  const src = (p.mech ?? {}) as Record<string, unknown>;
  for (const slot of SLOTS) {
    const v = src[slot];
    if (typeof v === 'string' && v) mech[slot] = v;
  }
  if (!mech.torso && !mech.chasis) return null;
  return { id: p.id, name: p.name, mech, saved: typeof p.saved === 'number' ? p.saved : 0 };
}

export function loadMechPresets(): MechPreset[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '[]') as unknown[];
    if (!Array.isArray(raw)) return [];
    return raw.map(clean).filter((x): x is MechPreset => !!x);
  } catch {
    return [];
  }
}

function write(list: MechPreset[]): void {
  localStorage.setItem(KEY, JSON.stringify(list));
}

// Saving under a name that already exists overwrites it, so a build can be
// tweaked and re-saved without collecting near-duplicates.
export function saveMechPreset(name: string, mech: MechLoadout, now: number): MechPreset[] {
  const list = loadMechPresets();
  const trimmed = name.trim();
  if (!trimmed) return list;
  const copy: MechLoadout = {};
  for (const slot of SLOTS) if (mech[slot]) copy[slot] = mech[slot];
  const at = list.findIndex((p) => p.name.toLowerCase() === trimmed.toLowerCase());
  const entry: MechPreset = { id: at >= 0 ? list[at].id : `mp${now}`, name: trimmed, mech: copy, saved: now };
  if (at >= 0) list[at] = entry;
  else list.push(entry);
  list.sort((a, b) => a.name.localeCompare(b.name));
  write(list);
  return list;
}

export function deleteMechPreset(id: string): MechPreset[] {
  const list = loadMechPresets().filter((p) => p.id !== id);
  write(list);
  return list;
}
