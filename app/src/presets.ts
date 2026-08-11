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

// Builds that ship with the app rather than being saved on one device, so
// somebody opening the tabletop for the first time has something to drop on the
// board. Everything below comes from a single Raid 2-Player Starter Set and the
// two sides come to 413 points each, which is as far as that box stretches.
//
// The Raid box prints several cards as two faces of ONE card, so these use at
// most one face of each: the RDL chassis is RL-08 (its other face is RL-08C),
// the RDL torso RTX-06SR (or RT-06), the right arm PC-6 (or AC-32), the UN
// torso TM31Q (or TM31R), the UN left arm the Ion Shotgun (or the Pile Bunker)
// and the UN right arm R7K (or R7, or R6). RDL fields two mechs because the box
// holds two RDL torsos, chassis and pilots but only one of each for UN, which is
// also why UN makes up its points in drones instead.
const BUILT_IN: MechPreset[] = [
  {
    id: 'builtin:raid-rdl-1',
    name: 'RAID-RDL-Starter 1',
    saved: 0,
    // Dune brawler, 227 points.
    mech: { torso: '014', chasis: '021', leftHand: '535', rightHand: '536', backpack: '532', pilot: 'FPA-04-2' },
  },
  {
    id: 'builtin:raid-rdl-2',
    name: 'RAID-RDL-Starter 2',
    saved: 0,
    // Mire fire support, 186 points. Its ML-34 rack is what the box's two MC-3
    // Razor Missiles are for.
    mech: { torso: '533', chasis: '020', leftHand: '032', rightHand: '033', backpack: '004', pilot: 'FPA-63' },
  },
  {
    id: 'builtin:raid-un',
    name: 'RAID-UN-Starter',
    saved: 0,
    // Wild Cat, 295 points. The other 118 are the three drones the box ships -
    // Porcupine Ion, Raven Interference and Tarantula Carrier - which are added
    // from the Drones tab rather than built here.
    mech: { torso: '539', chasis: '099', leftHand: '540', rightHand: '541', backpack: '538', pilot: 'LPA-23-2' },
  },
];

export function isBuiltInPreset(id: string): boolean {
  return id.startsWith('builtin:');
}

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
  let saved: MechPreset[] = [];
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '[]') as unknown[];
    if (Array.isArray(raw)) saved = raw.map(clean).filter((x): x is MechPreset => !!x);
  } catch {
    saved = [];
  }
  // A build saved under a built-in's name replaces it, so the shipped ones can
  // be reworked rather than sitting there uneditable next to a near-duplicate.
  const taken = new Set(saved.map((p) => p.name.toLowerCase()));
  const shipped = BUILT_IN.filter((p) => !taken.has(p.name.toLowerCase()));
  return [...shipped, ...saved].sort((a, b) => a.name.localeCompare(b.name));
}

function write(list: MechPreset[]): void {
  localStorage.setItem(KEY, JSON.stringify(list));
}

// Saving under a name that already exists overwrites it, so a build can be
// tweaked and re-saved without collecting near-duplicates.
export function saveMechPreset(name: string, mech: MechLoadout, now: number): MechPreset[] {
  const trimmed = name.trim();
  if (!trimmed) return loadMechPresets();
  const copy: MechLoadout = {};
  for (const slot of SLOTS) if (mech[slot]) copy[slot] = mech[slot];
  // Only this device's own builds are written back. Saving over a built-in's
  // name is allowed and shadows it, but it must be stored as a NEW entry rather
  // than by editing the shipped one in place.
  const saved = loadMechPresets().filter((p) => !isBuiltInPreset(p.id));
  const at = saved.findIndex((p) => p.name.toLowerCase() === trimmed.toLowerCase());
  const entry: MechPreset = { id: at >= 0 ? saved[at].id : `mp${now}`, name: trimmed, mech: copy, saved: now };
  if (at >= 0) saved[at] = entry;
  else saved.push(entry);
  write(saved);
  return loadMechPresets();
}

export function deleteMechPreset(id: string): MechPreset[] {
  // Only what this device saved is stored, so writing the merged list back would
  // bake the shipped builds into local storage and a later change to them would
  // never reach anyone who had opened the builder once.
  if (isBuiltInPreset(id)) return loadMechPresets();
  const saved = loadMechPresets().filter((p) => !isBuiltInPreset(p.id) && p.id !== id);
  write(saved);
  return loadMechPresets();
}
