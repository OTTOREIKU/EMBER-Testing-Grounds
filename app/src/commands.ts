import type { GameState, Side, Timing } from './types';
import { TIMINGS } from './types';

// ---------- the command layer (multiplayer phase 1) ----------

// A command is a named, serialisable intent: what a player is trying to do,
// rather than what became true afterwards. Everything downstream of 1v1 —
// hotseat handoff, the strict tracker, networking, stats, undo — needs that
// distinction, so mutations move behind this vocabulary one at a time.
//
// check() is the single place a rule lives, and it never mutates. apply()
// mutates the state it is given, in place like the rest of the app, and
// assumes the command was checked: given the same state and command it always
// does the same thing, which is what replaying a log or mirroring a remote
// seat requires. Dice will ride inside their commands as rolled faces, never
// re-rolled by the receiver.

export type Command = { kind: 'setTiming'; seat: Side; uid: number; timing?: Timing };

export type CheckResult = { ok: true } | { ok: false; why: string };

const ok: CheckResult = { ok: true };
const no = (why: string): CheckResult => ({ ok: false, why });

export function check(state: GameState, cmd: Command): CheckResult {
  switch (cmd.kind) {
    case 'setTiming': {
      const t = state.tokens.find((x) => x.uid === cmd.uid);
      if (!t) return no('That unit is not on the board.');
      if (t.kind !== 'mech') return no('Only a Mech has a Timing Dial. Drones act in the Command and Automatic Phases instead.');
      if (t.partStates.torso === 'destroyed') return no('A destroyed Mech cannot set a dial.');
      if (t.side !== cmd.seat) return no(`${t.label} belongs to the other squad, and a player may only set their own dials.`);
      if (cmd.timing !== undefined && !TIMINGS.some((x) => x.id === cmd.timing)) return no('That is not a Timing the dial can be set to.');
      if (state.round.phase !== 1) return no('Dials are set in the Planning Phase (3.3).');
      return ok;
    }
  }
}

export function apply(state: GameState, cmd: Command): void {
  switch (cmd.kind) {
    case 'setTiming': {
      const t = state.tokens.find((x) => x.uid === cmd.uid);
      if (t) t.timing = cmd.timing;
      return;
    }
  }
}

// The sandbox and the teaching guide warn rather than block, so they perform
// regardless and surface why when there is a why. The strict tracker will call
// check() first and refuse instead: one rule, two presentations.
export function perform(state: GameState, cmd: Command): CheckResult {
  const verdict = check(state, cmd);
  apply(state, cmd);
  return verdict;
}
