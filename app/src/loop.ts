import type { GameData } from './data';
import type { GameState, Side, Timing, Token } from './types';
import { TIMINGS } from './types';
import { commandGeneration, rwsCommandsLeft } from './units';

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

// What this side's Mechs are about to generate. 3.2.1: 1 each by default, or
// the printed Command Generation X, which is why this reads the cards rather
// than counting Mechs as it used to.
export function commandTokensFor(data: GameData, state: GameState, side: Side): number {
  return state.tokens
    .filter((t) => t.side === side && t.kind === 'mech' && alive(t))
    .reduce((n, t) => n + commandGeneration(data, t), 0);
}

// Who this side may still designate this phase. A Drone commanded during the
// Command Phase STILL performs its Automatic Actions in the Automatic Phase:
// 3.5 has "all Drones operating normally on the Game Board" attempt them, and
// 2.4.1 ties the [Automatic] icon to the phase, not to whether a Command was
// taken. The old exclusion here was ours and appeared in no rule; FAQ M18.5-6
// has a commanded Pholcus obliged to detonate the same round.
export function eligibleUnits(state: GameState, phase: LoopPhase, side: Side, data?: GameData): Token[] {
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
    const drones = state.tokens.filter(
      (t) =>
        t.side === side
        && t.kind === 'drone'
        && alive(t)
        && !commanded.has(t.uid)
        && (!broke || free.has(t.uid)),
    );
    // RWS (遥控武器, FAQ A20/A22): a Mech carrying an Ls197R Autocannon may be
    // sent a Command to fire it, once per Part per round - the one case where a
    // Mech is designated here. It needs the cards, so a caller without `data`
    // sees the Drones alone; a Shutdown Mech performs nothing (4.1.1).
    const mechs = data
      ? state.tokens.filter(
          (t) => t.side === side && t.kind === 'mech' && alive(t) && t.stance !== 'shutdown'
            && (!broke || free.has(t.uid)) && rwsCommandsLeft(data, state, t) > 0,
        )
      : [];
    return [...drones, ...mechs];
  }
  if (phase === 'Automatic') {
    return state.tokens.filter(
      (t) => t.side === side && t.kind === 'drone' && alive(t) && !acted.has(t.uid),
    );
  }
  return state.tokens.filter((t) => t.side === side && t.kind === 'projectile' && alive(t) && !acted.has(t.uid));
}

// What a Drone's activation may actually do, per phase. 3.2.2 ②: a Command
// buys a Move OR one Action bearing the COMMAND icon. 3.5: the Automatic Phase
// performs the Drone's AUTOMATIC Actions, and only those — Movement does not
// exist there. One home for the panels of both pages and for check(), because
// the icon lock lived nowhere and both starter Drones were firing their
// Automatic Actions off Commands.
export function droneMoveWhy(phase: LoopPhase): string | null {
  if (phase === 'Command') return null;
  return 'A Drone moves only when Commanded (3.2.2). The Automatic Phase performs its Automatic Actions, and only those (3.5).';
}

export function droneActionWhy(
  phase: LoopPhase,
  a: { speed?: string; type?: string },
  // A2 Data Link: this Drone's Command came from a Mech that lets it perform
  // Automatic Actions. The caller works it out, because this module is handed
  // a phase and an Action and never sees the board.
  opts: { autoActions?: boolean } = {},
): string | null {
  if (a.speed === 'passive' || a.type === 'Passive') return null;
  if (phase === 'Command') {
    if (a.speed === 'command') return null;
    if (a.speed === 'auto' && opts.autoActions) return null;
    return a.speed === 'auto'
      ? 'This is an Automatic Action, performed in the Automatic Phase without a Command (3.5). A Command lets this Drone MOVE instead, or fire an Action bearing the Command icon (3.2.2).'
      : 'Only an Action bearing the Command icon may be performed with a Command (3.2.2).';
  }
  if (phase === 'Automatic') {
    return a.speed === 'auto' ? null : 'The Automatic Phase performs the Drone\'s Automatic Actions only (3.5).';
  }
  return null;
}

export function canAct(state: GameState, phase: LoopPhase, side: Side, data?: GameData): boolean {
  const sc = state.script;
  if (!sc) return false;
  if (sc.passed.includes(side)) return false;
  return eligibleUnits(state, phase, side, data).length > 0;
}

export function loopComplete(state: GameState, phase: LoopPhase, data?: GameData): boolean {
  return !canAct(state, phase, 's1', data) && !canAct(state, phase, 's2', data);
}

// A player who passes is out for the phase, but the opponent may keep going, so
// the turn only alternates to a side that can still do something (3.2.2).
export function nextTurn(state: GameState, phase: LoopPhase, from: Side, data?: GameData): Side | null {
  const other: Side = from === 's1' ? 's2' : 's1';
  if (canAct(state, phase, other, data)) return other;
  if (canAct(state, phase, from, data)) return from;
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
  // The live case: a nested Extra Opportunity carries its own flag (FAQ K21).
  const opp = state.script?.opp;
  if (opp?.uid === uid && opp.extra) return true;
  // Ledger-era saves served extras at the end of the order instead.
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
