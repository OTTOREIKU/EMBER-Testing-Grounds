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
