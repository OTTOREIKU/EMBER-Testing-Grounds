import type { EmberApi } from './api';
import { onMechPresetsWrite, replaceMechPresets, savedMechPresets, type MechPreset } from './presets';
import { onSquadsWrite, replaceSquads, savedSquads, type SavedSquad } from './squadstore';
import { hiddenBuiltIns, onHiddenBuiltInsWrite, replaceHiddenBuiltIns } from './builtins';

// The saved units and squads, following the account. The two stores keep
// writing to this device as they always have; this watches them, pushes what
// the player saved to the account, and pulls it back on the next device. The
// built-in starters never travel - the client ships those.
//
// The same ownership rule as the collection: a copy made under one account is
// never pushed up as another's, and a different account signing in takes its
// own library from the server.

const META = 'ember-library-meta-v1';

interface Meta {
  updatedAt?: number;
  owner?: number;
}

const listeners = new Set<() => void>();
let api: EmberApi | null = null;
let pushTimer = 0;
// Set while a pull rewrites the stores, so their write hooks do not stamp the
// copy as a fresh local edit and push it straight back.
let quiet = false;

function meta(): Meta {
  try {
    const raw = JSON.parse(localStorage.getItem(META) ?? '{}') as Meta;
    return raw && typeof raw === 'object' ? raw : {};
  } catch {
    return {};
  }
}

function writeMeta(m: Meta): void {
  try {
    localStorage.setItem(META, JSON.stringify(m));
  } catch {
    // Storage blocked: the stores still hold the builds on this page.
  }
}

function announce(): void {
  for (const fn of listeners) fn();
}

export function onLibrary(fn: () => void): void {
  listeners.add(fn);
}

function mine(): boolean {
  const owner = meta().owner;
  return owner === undefined || owner === api?.user?.id;
}

function hasAnyLocal(): boolean {
  return savedMechPresets().length > 0 || savedSquads().length > 0 || hiddenBuiltIns().length > 0;
}

// A store was written by the player: stamp the copy as theirs and push it.
function changed(): void {
  if (quiet) return;
  writeMeta({ updatedAt: Date.now(), owner: api?.user?.id ?? meta().owner });
  announce();
  if (!api?.user) return;
  window.clearTimeout(pushTimer);
  pushTimer = window.setTimeout(() => { void pushLibrary(); }, 800);
}

export async function pushLibrary(): Promise<void> {
  if (!api?.user || !mine()) return;
  try {
    const r = await api.putLibrary(savedMechPresets(), savedSquads(), hiddenBuiltIns());
    writeMeta({ updatedAt: r.updatedAt, owner: api.user.id });
  } catch {
    // Offline: the device keeps its copy and tries again on the next change.
  }
}

export async function pullLibrary(): Promise<void> {
  if (!api?.user) return;
  let remote: { units: MechPreset[]; squads: SavedSquad[]; hidden?: string[]; updatedAt: number };
  try {
    remote = await api.getLibrary();
  } catch {
    return;
  }
  const local = meta();
  const localAt = local.updatedAt ?? 0;
  const remoteHas = remote.units.length + remote.squads.length + (remote.hidden?.length ?? 0) > 0;
  const adopt = (): void => {
    quiet = true;
    try {
      replaceMechPresets(remote.units);
      replaceSquads(remote.squads);
      replaceHiddenBuiltIns(remote.hidden ?? []);
    } finally {
      quiet = false;
    }
    writeMeta({ updatedAt: remote.updatedAt, owner: api!.user!.id });
    announce();
  };
  if (!mine()) { adopt(); return; }
  if (remote.updatedAt > localAt || (!hasAnyLocal() && remoteHas)) {
    adopt();
  } else if (hasAnyLocal() && localAt > remote.updatedAt) {
    await pushLibrary();
  } else {
    writeMeta({ ...local, owner: api.user.id });
  }
}

// Called once per page with its EmberApi.
export function bindLibrary(a: EmberApi): void {
  api = a;
  onMechPresetsWrite(changed);
  onSquadsWrite(changed);
  onHiddenBuiltInsWrite(changed);
  a.onChange((who) => { if (who) void pullLibrary(); });
  if (a.user) void pullLibrary();
  window.addEventListener('storage', (ev) => {
    if (ev.key === META || ev.key === 'ember-mech-presets-v1' || ev.key === 'ember-squads-v1' || ev.key === 'ember-hidden-builtins-v1') announce();
  });
}
