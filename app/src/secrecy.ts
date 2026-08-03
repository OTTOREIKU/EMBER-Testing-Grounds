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
