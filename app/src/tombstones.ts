// The ids of saved units and squads the player deleted, so a delete reaches
// the player's other devices instead of coming back the next time a device
// that still holds the build merges with the account (OTTO, 2026-11-11: "make
// sure all of the units/squads are perfectly syncing between devices and
// apps"). library.ts sends the list with the builds and leaves anything on it
// out of a merge. Every saved id is minted from the clock (mp…, sq…) and
// never reused, so an id on this list stays gone for good.

const KEY = 'ember-library-removed-v1';
// The newest kept: enough for years of deleting, small enough for the server.
export const REMOVED_MAX = 500;

const writers = new Set<() => void>();

export function onRemovedWrite(fn: () => void): void {
  writers.add(fn);
}

export function removedIds(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '[]') as unknown;
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string' && !!x && !x.startsWith('builtin:')) : [];
  } catch {
    return [];
  }
}

function write(list: string[], announce: boolean): void {
  try {
    localStorage.setItem(KEY, JSON.stringify([...new Set(list)].slice(-REMOVED_MAX)));
  } catch {
    // Storage blocked: the delete still happened on this device.
  }
  if (announce) for (const fn of writers) fn();
}

// A player's own build deleted on this device. A shipped one is put away
// instead (builtins.ts) and never lands here.
export function markRemoved(id: string): void {
  if (!id || id.startsWith('builtin:')) return;
  write([...removedIds().filter((x) => x !== id), id], false);
}

// The account's list, or the union of both after a merge. Quiet: library.ts
// writes this while it is already rewriting the stores.
export function replaceRemoved(list: unknown[]): void {
  write(list.filter((x): x is string => typeof x === 'string' && !!x && !x.startsWith('builtin:')), false);
}
