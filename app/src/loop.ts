import type { GameState, Side, Timing, Token } from './types';
import { TIMINGS } from './types';

// The pure turn-order rules of the guided game, shared by the play guide and
// the command layer. Nothing here touches the DOM or mutates state.

// ---------- alternating designation loops (rulebook 3.2.2, 3.5.1, 3.6.1) ----------

export const LOOP_PHASES = ['Command', 'Automatic', 'Delay'] as const;
export type LoopPhase = (typeof LOOP_PHASES)[number];

export function isLoopPhase(phase: string): phase is LoopPhase {
  return (LOOP_PHASES as readonly string[]).includes(phase);
}

export function alive(t: Token): boolean {
  if (t.kind !== 'mech') return (t.partStates.main ?? 'intact') !== 'destroyed';
  return Object.values(t.partStates).filter((p) => p !== 'destroyed').length > 0;
}

export function commandTokensFor(state: GameState, side: Side): number {
  return state.tokens.filter((t) => t.side === side && t.kind === 'mech' && alive(t)).length;
}

// Who this side may still designate this phase. A Drone commanded during the
// Command Phase does not act again in the Automatic Phase (3.5).
export function eligibleUnits(state: GameState, phase: LoopPhase, side: Side): Token[] {
  const sc = state.script;
  if (!sc) return [];
  const acted = new Set(sc.acted);
  const commanded = new Set(sc.commanded);
  if (phase === 'Command') {
    // Additional Instructions pays for its own designation, so a side out of
    // Command Tokens can still act on the Drone the card named.
    const free = new Set(sc.freeCommand);
    const broke = (state.commandTokens[side] ?? 0) <= 0;
    if (broke && !free.size) return [];
    return state.tokens.filter(
      (t) =>
        t.side === side
        && t.kind === 'drone'
        && alive(t)
        && !commanded.has(t.uid)
        && (!broke || free.has(t.uid)),
    );
  }
  if (phase === 'Automatic') {
    return state.tokens.filter(
      (t) => t.side === side && t.kind === 'drone' && alive(t) && !commanded.has(t.uid) && !acted.has(t.uid),
    );
  }
  return state.tokens.filter((t) => t.side === side && t.kind === 'projectile' && alive(t) && !acted.has(t.uid));
}

export function canAct(state: GameState, phase: LoopPhase, side: Side): boolean {
  const sc = state.script;
  if (!sc) return false;
  if (sc.passed.includes(side)) return false;
  return eligibleUnits(state, phase, side).length > 0;
}

export function loopComplete(state: GameState, phase: LoopPhase): boolean {
  return !canAct(state, phase, 's1') && !canAct(state, phase, 's2');
}

// A player who passes is out for the phase, but the opponent may keep going, so
// the turn only alternates to a side that can still do something (3.2.2).
export function nextTurn(state: GameState, phase: LoopPhase, from: Side): Side | null {
  const other: Side = from === 's1' ? 's2' : 's1';
  if (canAct(state, phase, other)) return other;
  if (canAct(state, phase, from)) return from;
  return null;
}

// ---------- action phase activation order (rulebook 3.4.1) ----------

export interface Activation {
  uid: number;
  timing: Timing;
  init?: number;
}

export type InitLookup = (t: Token, timing: Timing) => number | undefined;

// Timing order never changes, and within one Timing the lowest Pilot Initiative
// goes first. Mechs tied on both belong to no natural order, so the First
// Player's Mech goes first and the sides alternate from there.
export function activationOrder(state: GameState, init: InitLookup): Activation[] {
  const mechs = state.tokens.filter((t) => t.kind === 'mech' && alive(t) && t.timing);
  const out: Activation[] = [];
  for (const def of TIMINGS) {
    const group = mechs
      .filter((t) => t.timing === def.id)
      .map((t) => ({ t, init: init(t, def.id) }));
    if (!group.length) continue;
    const values = [...new Set(group.map((g) => g.init))].sort(
      (a, b) => (a ?? Infinity) - (b ?? Infinity),
    );
    for (const v of values) {
      const tied = group.filter((g) => g.init === v);
      const mine = tied.filter((g) => g.t.side === state.round.firstPlayer);
      const theirs = tied.filter((g) => g.t.side !== state.round.firstPlayer);
      let turn = mine;
      while (mine.length || theirs.length) {
        const next = (turn.length ? turn : turn === mine ? theirs : mine).shift()!;
        out.push({ uid: next.t.uid, timing: def.id, init: next.init });
        turn = turn === mine ? theirs : mine;
      }
    }
  }
  return out;
}

// The next Mech still owed an Action Opportunity this phase. Extra Opportunities
// are served once the normal order is exhausted, which is where they belong
// rather than a simplification: the only Action that grants one is a Tactic, and
// Tactical is the last Timing, so every other Mech has already acted by then.
export function nextActivation(state: GameState, init: InitLookup): Activation | null {
  const done = new Set(state.script?.acted ?? []);
  const order = activationOrder(state, init);
  const normal = order.find((a) => !done.has(a.uid));
  if (normal) return normal;
  const owed = state.script?.extraOpps ?? [];
  for (const uid of owed) {
    const found = order.find((a) => a.uid === uid);
    if (found) return found;
  }
  return null;
}

// An Extra Action Opportunity is a fresh one for a Mech that has already acted,
// so it must not be told apart by uid alone.
export function onExtraOpportunity(state: GameState, uid: number): boolean {
  const done = new Set(state.script?.acted ?? []);
  return done.has(uid) && (state.script?.extraOpps ?? []).includes(uid);
}

export function actionPhaseComplete(state: GameState, init: InitLookup): boolean {
  return nextActivation(state, init) === null;
}

// ---------- the one piece of hidden information (rulebook 3.3) ----------

// Players are entitled to keep their chosen Action Timings secret until the
// reveal. Everything else in the game is open information, so this is the
// whole of the view filter — but it covers two quite different situations.
//
// Pass-and-play hides the dial behind a screen: the Planning Phase runs as two
// sub-turns and the seat not holding the device is masked. That is a courtesy,
// and only as good as the players are honest.
//
// Over a network it is not a courtesy. The other player's dials are masked
// because their client has never been sent them — see the commit/reveal pair
// in commands.ts. Masking here is what makes the display agree with what this
// client actually knows.
// Which seat this browser is playing in a networked game, or null when the
// game is local. Per-client by nature — the two players hold different values
// — so it cannot live in the shared GameState.
let localSeat: Side | null = null;

export function setLocalSeat(seat: Side | null): void {
  localSeat = seat;
}

export function getLocalSeat(): Side | null {
  return localSeat;
}

export function dialHidden(state: GameState, t: Token): boolean {
  const sc = state.script;
  if (!sc) return false;
  if (state.round.phase !== 1) return false;

  // Networked: a seat's dials stay hidden until that seat has revealed them.
  // Mine are always visible to me, revealed or not.
  if (localSeat) return t.side !== localSeat && !sc.revealed.includes(t.side);

  if (sc.mode !== 'hidden') return false;
  if (sc.stage === `${state.round.n}:1:locked`) return false;
  return t.side !== sc.turn;
}
