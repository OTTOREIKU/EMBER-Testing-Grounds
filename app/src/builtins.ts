// The shipped starter units and squads a player has put away. An experienced
// player does not want the Raid starters at the top of every list, so
// "removing" a built-in hides it - here, on this device, and on the account
// through library.ts - and one link brings them all back. The shipped entries
// themselves are never written anywhere, so a later change to them still
// reaches everyone.

const KEY = 'ember-hidden-builtins-v1';

const writers = new Set<() => void>();

export function onHiddenBuiltInsWrite(fn: () => void): void {
  writers.add(fn);
}

export function hiddenBuiltIns(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '[]') as unknown;
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string' && x.startsWith('builtin:')) : [];
  } catch {
    return [];
  }
}

function write(list: string[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify([...new Set(list)]));
  } catch {
    // Storage blocked: the list simply shows the starters again next time.
  }
  for (const fn of writers) fn();
}

export function hideBuiltIn(id: string): void {
  if (!id.startsWith('builtin:')) return;
  write([...hiddenBuiltIns(), id]);
}

// The built-in SQUADS used to share ids with the built-in units ('builtin:
// raid-un' was both), so putting the UN starter unit away put the UN starter
// squad away with it. The squads now carry 'builtin:squad-' ids; a hidden list
// written before that is read as having meant the unit only.

export function restoreBuiltIns(): void {
  write([]);
}

// The account's list replacing this device's.
export function replaceHiddenBuiltIns(list: unknown[]): void {
  write(list.filter((x): x is string => typeof x === 'string' && x.startsWith('builtin:')));
}
