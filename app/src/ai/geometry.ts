// THE BOARD AS A VIEW SHOWS IT (every policy's): Grids and how far apart they are, the Forward Arc, Range, a Melee
// Lock, and whether a unit standing somewhere could strike another, as far as geometry goes. Sight, cover and what
// the turn still allows are the engine's to say, and it says them in the answers it offers; these readings only
// choose what to ask it about, and stand in for it where an answer has nobody to ask. The rules they read: 4.2.5 (the
// Forward Arc), 4.3.5 (a Melee Lock bars Firing), a printed Range counted along the rows and the columns.
import type { Option, SeatView, UnitView, WeaponView } from '../seat';

export interface Grid { col: number; row: number }

// A road, as the engine draws one (its Grids in order).
export type Road = { c: number; r: number }[];

export const apart = (a: Grid, b: Grid): number => Math.abs(a.col - b.col) + Math.abs(a.row - b.row);
export const beside = (a: Grid, b: Grid): boolean => Math.abs(a.col - b.col) <= 1 && Math.abs(a.row - b.row) <= 1;
export const same = (a: Grid, b: Grid): boolean => a.col === b.col && a.row === b.row;

// 0 north, 1 east, 2 south, 3 west.
const AHEAD = [[0, -1], [1, 0], [0, 1], [-1, 0]];

// The Forward Arc from a Grid: the quarter of the board in front, its
// diagonals included (4.2.5). Two units in one Grid are in each other's.
export function inFront(from: Grid, facing: number, at: Grid): boolean {
  const dc = at.col - from.col;
  const dr = at.row - from.row;
  if (!dc && !dr) return true;
  const [fc, fr] = AHEAD[facing] ?? AHEAD[0];
  const along = dc * fc + dr * fr;
  return along > 0 && Math.abs(dc * fr - dr * fc) <= along;
}

// The facing that looks from one Grid at another: along whichever axis they
// are further apart on.
export function facingAt(from: Grid, at: Grid): number {
  const dc = at.col - from.col;
  const dr = at.row - from.row;
  if (Math.abs(dr) >= Math.abs(dc)) return dr >= 0 ? 2 : 0;
  return dc >= 0 ? 1 : 3;
}

// Where an option that ends somewhere ends, and facing which way.
export function endOf(o: Option): Grid | null {
  const to = o.facts?.to as { c?: number; r?: number } | undefined;
  return to && typeof to.c === 'number' && typeof to.r === 'number' ? { col: to.c, row: to.r } : null;
}
export const facingOf = (o: Option): number | null => (typeof o.facts?.facing === 'number' ? o.facts.facing : null);

export const unitOf = (view: SeatView, uid: unknown): UnitView | undefined =>
  (typeof uid === 'number' ? view.units.find((u) => u.uid === uid) : undefined);

// The enemy units on the board that can be fought.
export const foesOf = (view: SeatView): UnitView[] =>
  view.units.filter((u) => u.side !== view.seat && u.deployed && u.alive && u.kind !== 'projectile');

// The Actions a unit attacks with, that still work and still have Ammo.
export const ready = (w: WeaponView): boolean => w.usable && (w.ammo === undefined || w.ammo > 0);
export const strikers = (u: UnitView): WeaponView[] => u.weapons.filter((w) => ready(w) && (w.type === 'Firing' || w.type === 'Melee'));

// Range as the engine reads it: a printed Range counts Grids along the rows
// and the columns, and an Action that prints none needs its target in a Grid
// beside its own, corner to corner included.
export const reaches = (w: WeaponView, from: Grid, at: Grid): boolean => (w.range > 0 ? apart(from, at) <= w.range : beside(from, at));

// Melee Lock (4.3.5): a Ground unit with an enemy in a Grid beside its own
// that could strike it in Melee makes no Firing attack from there.
export const lockedAt = (me: UnitView, at: Grid, foes: UnitView[]): boolean =>
  me.ground && foes.some((f) => f.locks && !f.camouflaged && beside(at, f.grid));

// Whether `me`, standing in `from` and facing `facing`, could attack `foe` as
// far as Range, the Forward Arc and a Melee Lock go (`locked`: it would stand
// Melee Locked there). This is geometry: sight, cover and what the turn still
// allows are the engine's to say, and it says them in the answers it offers.
export function couldStrike(me: UnitView, from: Grid, facing: number, foe: UnitView, locked: boolean): boolean {
  if (foe.camouflaged || !inFront(from, facing, foe.grid)) return false;
  return strikers(me).some((w) => reaches(w, from, foe.grid) && !(w.type === 'Melee' && foe.aerial) && !(w.type === 'Firing' && locked));
}

// A chance as a player says it.
export const percent = (p: number): string => `${Math.round(p * 100)}%`;
