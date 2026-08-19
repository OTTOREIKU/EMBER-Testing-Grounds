import type { GameData } from './data';
import type { CardAction, PartSlot, TerrainPiece, Token } from './types';
import { statusCount } from './types';
import { largeGridOf, losBetween, standingSpot } from './rules';
import { isDeployed } from './setup';
import { tokenCards } from './units';

const MELEE_FIRING = '近战射击';

// ---------- who can lock ----------

export function isMeleeFiring(a: CardAction): boolean {
  return (a.keywords ?? []).some((k) => k.key === MELEE_FIRING);
}

export function meleeCapable(data: GameData, t: Token): boolean {
  if (t.stance === 'shutdown' || !isDeployed(t)) return false;
  const intact = (slot: PartSlot | 'pilot' | 'main') => (t.partStates[slot as PartSlot | 'main'] ?? 'intact') !== 'destroyed';
  if (t.kind === 'mech') {
    const punch = data.commonActions.find((a) => a.id === 'COMMON_PUNCH_MELEE');
    if (punch && (punch.slots ?? []).some((s) => intact(s as PartSlot))) return true;
  }
  return tokenCards(data, t).some(({ slot, card }) => intact(slot) && (card.actions ?? []).some((a) => a.type === 'Melee'));
}

function lockable(t: Token): boolean {
  // Optical Camouflage does NOT protect from being locked — the exception runs
  // the other way: a camouflaged unit cannot APPLY Melee Lock (FAQ I8).
  return !t.aerial && isDeployed(t);
}

function shifted(t: Token, at: { c: number; r: number }, terrain: TerrainPiece[], tokens: Token[]): Token {
  const spot = standingSpot(at.c, at.r, t.size, t.aerial, terrain, tokens, t.uid)
    ?? { col: at.c * 3, row: at.r * 3 };
  return { ...t, col: spot.col, row: spot.row };
}

export function lockersOf(
  data: GameData,
  t: Token,
  tokens: Token[],
  terrain: TerrainPiece[],
  at?: { c: number; r: number },
): Token[] {
  if (!lockable(t)) return [];
  const me = at ? shifted(t, at, terrain, tokens) : t;
  const g = largeGridOf(me);
  return tokens.filter((o) => {
    if (o.side === t.side || o.uid === t.uid || !isDeployed(o)) return false;
    // A camouflaged unit locks nobody (FAQ I8).
    if (statusCount(o.statuses, 'camouflage') > 0) return false;
    const go = largeGridOf(o);
    if (Math.abs(go.c - g.c) > 1 || Math.abs(go.r - g.r) > 1) return false;
    if (!meleeCapable(data, o)) return false;
    return losBetween(o, me, terrain, tokens.filter((x) => x.uid !== t.uid)) !== 'blocked';
  });
}

export function meleeLocked(data: GameData, t: Token, tokens: Token[], terrain: TerrainPiece[]): boolean {
  return lockersOf(data, t, tokens, terrain).length > 0;
}

export function canBeForceMoved(data: GameData, t: Token): boolean {
  if (t.kind === 'mech') return true;
  return tokenCards(data, t).some(({ card }) =>
    (card.move ?? 0) > 0 || (card.actions ?? []).some((a) => a.type === 'Moving'));
}

// ---------- Break Away ----------

export function breakAwayCost(
  data: GameData,
  t: Token,
  tokens: Token[],
  terrain: TerrainPiece[],
): (c: number, r: number) => number {
  const cache = new Map<string, number>();
  return (c, r) => {
    const key = `${c},${r}`;
    const hit = cache.get(key);
    if (hit !== undefined) return hit;
    const n = lockersOf(data, t, tokens, terrain, { c, r }).length;
    cache.set(key, n);
    return n;
  };
}

// ---------- Tether X (PDLH-202 Ols1B "Harpoon") ----------

// Where a Tethered unit is still allowed to stand: "the tethered unit cannot
// voluntarily move to a position beyond X grids from the initiating unit".
//
// Only that end is capped. The initiator walking out is a REMOVAL condition
// (settleTethers) and not an illegal move at all, so this returns undefined for
// it and for everything else on the board — a unit with no leash pays nothing.
//
// It rides on MoveOpts.allowed rather than beside breakAwayCost on exitCost
// because a leash is a legality, not a toll: priced as Movement Range, a Sprint
// 6 would simply buy its way through a Tether 4. And the Grids beyond it are
// impassable rather than merely un-endable, because Movement is resolved a Grid
// at a time and every Grid entered is a position (4.3) — there is no slingshot
// out to Grid 5 and back to Grid 4.
export function tetherCap(t: Token, tokens: Token[]): ((c: number, r: number) => boolean) | undefined {
  const anchors = (t.tether ?? [])
    .filter((x) => x.role === 'tethered')
    .map((x) => ({ at: tokens.find((o) => o.uid === x.uid), range: x.range }))
    .filter((x): x is { at: Token; range: number } => !!x.at);
  if (!anchors.length) return undefined;
  // Same Large-Grid Manhattan reading rangeBetween uses, so the leash measures
  // the distance the rest of the app measures.
  return (c, r) => anchors.every(({ at, range }) => {
    const g = largeGridOf(at);
    return Math.abs(g.c - c) + Math.abs(g.r - r) <= range;
  });
}

// The one line a player needs when the highlight comes up short. Break Away is
// the only precedent for an overlay smaller than the printed Movement Range and
// it announces itself, so this does too — and it is written HERE rather than on
// each board, so the two cannot end up explaining the same leash differently.
// Empty for the initiator, which is capped by nothing.
export function tetherNote(t: Token, tokens: Token[]): string {
  const link = (t.tether ?? []).find((x) => x.role === 'tethered');
  if (!link) return '';
  const anchor = tokens.find((o) => o.uid === link.uid);
  return `Tethered ${link.range} to ${anchor?.label ?? 'an enemy unit'}: no Grid further than ${link.range} away is lit, and no amount of Movement Range buys past it (PDLH-202).`;
}
