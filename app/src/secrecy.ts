import type { GameState, Side, Timing } from './types';

// The networked Timing Dial secrecy (3.3): each seat publishes a hash of its
// dials, and the dials themselves only once both hashes are in. Shared by the
// board page and the Match Centre, because the hash must be byte-identical
// across pages or a cross-page game reads an honest reveal as cheating.

export interface DialEntry {
  uid: number;
  timing?: Timing;
}

export function dialsOf(state: GameState, seat: Side): DialEntry[] {
  return state.tokens
    .filter((t) => t.side === seat && t.kind === 'mech')
    .map((t) => ({ uid: t.uid, timing: t.timing }));
}

// The commitment covers the dials in a fixed order, so the same choices
// always hash the same way regardless of token order on the board.
export async function hashDials(salt: string, dials: DialEntry[]): Promise<string> {
  const canonical = JSON.stringify(
    [...dials].sort((a, b) => a.uid - b.uid).map((d) => [d.uid, d.timing ?? null]),
  );
  const bytes = new TextEncoder().encode(`${salt}|${canonical}`);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function newSalt(): string {
  return [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ---------- board fingerprint ----------
//
// A short digest of everything the two clients must agree on, sent with each
// command so the receiver can tell that the boards matched *before* it. The
// revision machinery already catches a command going missing; this catches the
// case it structurally cannot — both sides applying the same command at the
// same revision and ending up different, which is what a non-deterministic
// apply() looks like. The numbers agree, so nothing else would ever notice.
//
// Three rules for what goes in:
//   1. Only facts a command put there. Anything local — a UI toggle, a hand of
//      Tactics Cards the other client was never told about, a Timing Dial
//      before its reveal — legitimately differs, and including it would report
//      an honest game as a desync every Planning Phase.
//   2. **Nothing derived.** `script` is turn bookkeeping each client works out
//      for itself and never sends: `enterPhase` derives it from a command, but
//      `opportunity()` mints `script.opp` from inside a *render*. The sender
//      hashes before its next render and the receiver after its last one, so
//      the two disagree by one frame on every command — which is exactly the
//      false alarm that stopped a live game on 2026-08-05. The board is
//      commanded; the bookkeeping is computed. Only hash what is commanded.
//   3. Fixed order, always. Sort by id, list fields explicitly rather than
//      leaning on object key order, or the same board hashes two ways.
//
// Not a security boundary: it detects accident, not tampering, so a fast
// non-cryptographic hash is the right tool. `hashDials` above is the one that
// has to resist a lying client.

function fold(s: string): string {
  // FNV-1a, 32-bit. Synchronous, which is what lets this ride along on the
  // send path instead of turning every command into a promise.
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

const keyed = (o: Record<string, unknown> | undefined | null): [string, unknown][] =>
  Object.entries(o ?? {}).sort((a, b) => a[0].localeCompare(b[0]));

export function boardFingerprint(state: GameState): string {
  const s = state as GameState & Record<string, unknown>;
  const tokens = [...(s.tokens ?? [])]
    .sort((a, b) => a.uid - b.uid)
    .map((t) => [
      t.uid, t.side, t.kind, t.cardId, t.col, t.row, t.facing, t.size,
      t.stance, t.link ?? null, t.deployed !== false, t.aerial === true,
      keyed(t.partStates as unknown as Record<string, unknown>),
      [...(t.statuses ?? [])].sort(),
      keyed(t.ammo), keyed(t.intercept as unknown as Record<string, unknown>),
      // Deliberately no `timing`: a dial is secret until both squads reveal
      // (3.3), so the two clients hold different ones and are meant to.
    ]);
  const tasks = (s.tasks ?? null) as { vp?: unknown; items?: { id: string }[] } | null;
  const items = [...(tasks?.items ?? [])]
    .sort((a, b) => String(a.id).localeCompare(String(b.id)))
    .map((i) => keyed(i as unknown as Record<string, unknown>));
  return fold(JSON.stringify([
    s.round?.n, s.round?.phase, s.round?.firstPlayer,
    s.map, s.mission ?? null, s.scale ?? null, s.roundLimit ?? null,
    keyed(s.commandTokens as unknown as Record<string, unknown>),
    tokens,
    [...(s.removedTerrain ?? [])].sort(),
    [...(s.smoke ?? [])].map((x) => keyed(x as unknown as Record<string, unknown>)),
    tasks?.vp ?? null, items,
    // No `script`: see rule 2. Where the units stand and what they have spent
    // is the thing worth agreeing on, and it is all commanded.
  ]));
}
