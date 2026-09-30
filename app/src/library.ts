import { ApiError, type EmberApi } from './api';
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
//
// On a shared device that rule used to leak (security audit, 2026-09-30): a
// save stamped the copy with whoever was signed in NOW, so the next player's
// first save claimed the last player's builds and pushed them into their own
// account, and signing out left every build on the device for the next person
// to read. Now a save never changes a copy's owner - only a pull does - no
// push goes out for an account until its own copy has been read, and signing
// out sends anything unsent and then clears the device.

const META = 'ember-library-meta-v1';

interface Meta {
  updatedAt?: number;
  owner?: number;
  // A change on this device the account has not had yet. Kept with the copy,
  // so a reload does not forget that something is still to be sent.
  unsent?: boolean;
}

const listeners = new Set<() => void>();
let api: EmberApi | null = null;
let pushTimer = 0;
// Set while a pull rewrites the stores, so their write hooks do not stamp the
// copy as a fresh local edit and push it straight back.
let quiet = false;
// The account this page has read the library for. Until then nothing is
// pushed for it: a save made before its copy arrived (or after the read
// failed) would send whatever the device held.
let syncedFor: number | null = null;
let pulling: Promise<void> | null = null;
// Counts saves, so a push can tell whether another landed while it was on the
// wire and must not be marked as sent.
let changes = 0;

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

function hasAnyLocal(): boolean {
  return savedMechPresets().length > 0 || savedSquads().length > 0 || hiddenBuiltIns().length > 0;
}

// A store was written by the player. The copy keeps whatever owner it had.
function changed(): void {
  if (quiet) return;
  changes += 1;
  writeMeta({ ...meta(), updatedAt: Date.now(), unsent: true });
  announce();
  const me = api?.user;
  if (!me) return;
  // Not yet in step with this account: read its copy first, which sends this
  // change on if it is the newer.
  if (syncedFor !== me.id) { void pullLibrary(); return; }
  window.clearTimeout(pushTimer);
  pushTimer = window.setTimeout(() => { void pushLibrary(); }, 800);
}

// Sends this device's builds as the signed-in account's: only a copy that
// account owns, and only once its own copy has been read.
export async function pushLibrary(): Promise<boolean> {
  const me = api?.user;
  if (!api || !me || syncedFor !== me.id || meta().owner !== me.id) return false;
  const at = changes;
  try {
    const r = await api.putLibrary(savedMechPresets(), savedSquads(), hiddenBuiltIns());
    writeMeta({ updatedAt: r.updatedAt, owner: me.id, ...(changes !== at ? { unsent: true } : {}) });
    return true;
  } catch {
    // Offline: the device keeps its copy and tries again on the next change.
    return false;
  }
}

// The account's own copy in place of this device's, cleaned the same way a
// load is.
function adopt(owner: number, remote: { units: unknown[]; squads: unknown[]; hidden?: unknown[]; updatedAt: number }): void {
  quiet = true;
  try {
    replaceMechPresets(remote.units);
    replaceSquads(remote.squads);
    replaceHiddenBuiltIns(remote.hidden ?? []);
  } finally {
    quiet = false;
  }
  writeMeta({ updatedAt: remote.updatedAt, owner });
  announce();
}

// Both sides' builds, by id; where both hold one, the later save.
function mergeById<T extends { id: string; saved: number }>(remote: T[], local: T[]): T[] {
  const byId = new Map(remote.map((x) => [x.id, x]));
  for (const x of local) {
    const r = byId.get(x.id);
    if (!r || x.saved > r.saved) byId.set(x.id, x);
  }
  return [...byId.values()];
}

export function pullLibrary(): Promise<void> {
  if (!api?.user) return Promise.resolve();
  pulling ??= reconcile().finally(() => { pulling = null; });
  return pulling;
}

async function reconcile(): Promise<void> {
  const me = api?.user;
  if (!api || !me) return;
  let remote: { units: MechPreset[]; squads: SavedSquad[]; hidden?: string[]; updatedAt: number };
  try {
    remote = await api.getLibrary();
  } catch {
    return;
  }
  // Signed out, or somebody else signed in, while the copy was on its way.
  if (api.user?.id !== me.id) return;
  const local = meta();
  const localAt = local.updatedAt ?? 0;
  const remoteHas = remote.units.length + remote.squads.length + (remote.hidden?.length ?? 0) > 0;
  if (local.owner !== undefined && local.owner !== me.id) {
    // Someone else's builds on this device: the account takes its own,
    // whatever the clocks say, and theirs is never pushed into it.
    adopt(me.id, remote);
  } else if (local.owner === undefined) {
    // A copy no account has had: saved signed out, or since a sign-in that
    // had not been read yet. Neither side's builds are dropped.
    if (!hasAnyLocal()) {
      adopt(me.id, remote);
    } else {
      quiet = true;
      try {
        replaceMechPresets(mergeById(remote.units, savedMechPresets()));
        replaceSquads(mergeById(remote.squads, savedSquads()));
        replaceHiddenBuiltIns([...new Set([...(remote.hidden ?? []), ...hiddenBuiltIns()])]);
      } finally {
        quiet = false;
      }
      writeMeta({ updatedAt: Date.now(), owner: me.id, unsent: true });
      announce();
      syncedFor = me.id;
      await pushLibrary();
      return;
    }
  } else if (remote.updatedAt > localAt || (!hasAnyLocal() && remoteHas)) {
    adopt(me.id, remote);
  } else if (hasAnyLocal() && localAt > remote.updatedAt) {
    syncedFor = me.id;
    await pushLibrary();
    return;
  } else {
    writeMeta({ ...local, owner: me.id });
  }
  syncedFor = me.id;
}

// This device's copy, gone: at sign-out, and when an account signs in over a
// copy that belongs to a different one.
function forget(): void {
  window.clearTimeout(pushTimer);
  syncedFor = null;
  quiet = true;
  try {
    replaceMechPresets([]);
    replaceSquads([]);
    replaceHiddenBuiltIns([]);
  } catch {
    // Storage blocked: there was nothing kept to clear.
  } finally {
    quiet = false;
  }
  try {
    localStorage.removeItem(META);
  } catch {
    // As above.
  }
  announce();
}

// Before the session ends: anything the account has not had yet goes now.
// Throwing keeps the player signed in, so a failed send never becomes a wipe.
async function flush(): Promise<void> {
  const me = api?.user;
  if (!me) return;
  const m = meta();
  if (!m.unsent || (m.owner !== undefined && m.owner !== me.id)) return;
  window.clearTimeout(pushTimer);
  if (syncedFor === me.id) await pushLibrary();
  else await pullLibrary();
  const after = meta();
  if (after.unsent && (after.owner === undefined || after.owner === me.id)) {
    throw new ApiError('Your latest saved units and squads have not reached your account yet, so you are still signed in. Check the connection and try again.', { offline: true });
  }
}

// Called once per page with its EmberApi.
export function bindLibrary(a: EmberApi): void {
  api = a;
  onMechPresetsWrite(changed);
  onSquadsWrite(changed);
  onHiddenBuiltInsWrite(changed);
  const signedIn = (who: { id: number } | null): void => {
    // No account: whatever is on the device stays until someone signs out.
    if (!who) return;
    if (syncedFor !== who.id) syncedFor = null;
    const owner = meta().owner;
    if (owner !== undefined && owner !== who.id) forget();
    void pullLibrary();
  };
  a.onChange(signedIn);
  if (a.user) signedIn(a.user);
  a.beforeSignOut(flush);
  a.onSignedOut(forget);
  window.addEventListener('storage', (ev) => {
    if (ev.key === META || ev.key === 'ember-mech-presets-v1' || ev.key === 'ember-squads-v1' || ev.key === 'ember-hidden-builtins-v1') announce();
  });
}
