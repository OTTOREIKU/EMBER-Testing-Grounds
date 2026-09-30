// A squad's Tactics Cards are hidden information (Supplementary Rules 1.04,
// 1.11): revealed to the opponent only when played. OTTO, 2026-09-30: "we just
// need to adjust the hidden mechanic in the engine/pad".
//
// Across a room the hand therefore never travels. A seat publishes one
// commitment per card (secrecy.ts sealTactic: SHA-256 of the card and a salt),
// keeps the cards and their salts on this device, and reveals a card with its
// salt only when it plays it; both engines prove the pair against a commitment
// (commands.ts playTactic). At one table (the pad's Offline Game, pass-and-play)
// the screen is the secrecy, and the hand stays plain as before.
//
// One module for every page, so the pad, the Match Centre and the tabletop
// seal, read and play a hand the same way.
import type { Command } from './commands';
import { newSalt, sealTactic } from './secrecy';
import type { GameState, Side } from './types';

export interface HeldCard {
  id: string;
  salt: string;
}

const storeKey = (room: string, seat: Side): string => `ember-hand:${room}:${seat}`;

// The room this page is in, for the readers handed only a state (the
// tabletop's squad panel and guide): set by the page as it joins or leaves one,
// the way loop.ts setLocalSeat is. The pad and the Match Centre pass theirs.
let pageRoom: string | null = null;
export function setHandRoom(room: string | null): void {
  pageRoom = room;
}

// Every card this device has sealed for a seat in a room, kept whatever was
// refused or replaced: a card's own commitment picks it out of the table's
// current hand, so extras are harmless and a reload loses nothing.
export function recallHand(room: string, seat: Side): HeldCard[] {
  try {
    const raw = JSON.parse(localStorage.getItem(storeKey(room, seat)) ?? '[]') as unknown;
    return Array.isArray(raw)
      ? raw.filter((c): c is HeldCard => !!c && typeof c.id === 'string' && typeof c.salt === 'string')
      : [];
  } catch {
    return [];
  }
}

function rememberHand(room: string, seat: Side, held: HeldCard[]): void {
  const all = [...recallHand(room, seat), ...held];
  const unique = all.filter((c, i) => all.findIndex((x) => x.id === c.id && x.salt === c.salt) === i);
  try {
    localStorage.setItem(storeKey(room, seat), JSON.stringify(unique.slice(-64)));
  } catch {
    // Private windows refuse storage: the hand still seals, and this device
    // simply cannot play it after a reload.
  }
}

// The command that sets a seat's hand: sealed across a room, plain at one
// table. The commitments go in sorted order, so their order says nothing
// about which card was added when.
export function handCommand(seat: Side, ids: string[], room: string | null): Command {
  if (!room) return { kind: 'setTactics', seat, cards: [...ids] };
  const held = ids.map((id) => ({ id, salt: newSalt() }));
  rememberHand(room, seat, held);
  return { kind: 'setTactics', seat, sealed: held.map((c) => sealTactic(c.id, c.salt)).sort() };
}

// The cards this device can see in a seat's hand: all of a plain hand; of a
// sealed one, only this device's own cards (never the other seat's).
function sealedCards(state: GameState, seat: Side, room: string | null): HeldCard[] {
  const sealed = state.tacticsSealed?.[seat];
  if (!sealed?.length || !room) return [];
  const want = new Set(sealed);
  const seen = new Set<string>();
  return recallHand(room, seat).filter((c) => {
    const h = sealTactic(c.id, c.salt);
    if (!want.has(h) || seen.has(h)) return false;
    seen.add(h);
    return true;
  });
}

export function handIds(state: GameState, seat: Side, room: string | null = pageRoom): string[] {
  if (!state.tacticsSealed?.[seat]?.length) return state.tactics?.[seat] ?? [];
  return sealedCards(state, seat, room).map((c) => c.id);
}

// How many cards a seat holds, whoever is asking: what a sealed hand shows the
// other player, and what its squad's points count (30 each, 1.11).
export function handCount(state: GameState, seat: Side): number {
  return state.tacticsSealed?.[seat]?.length ?? state.tactics?.[seat]?.length ?? 0;
}

export function handSealed(state: GameState, seat: Side): boolean {
  return !!state.tacticsSealed?.[seat]?.length;
}

// The salt that proves a sealed card when it is played; nothing for a plain
// hand, whose card is simply in the list.
export function saltFor(state: GameState, seat: Side, cardId: string, room: string | null): string | undefined {
  return sealedCards(state, seat, room).find((c) => c.id === cardId)?.salt;
}
