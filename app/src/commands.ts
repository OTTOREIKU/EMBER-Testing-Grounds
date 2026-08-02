import type { Facing, GameState, Side, Stance, Timing } from './types';
import { TIMINGS } from './types';
import type { GameData } from './data';
import { maxLink, tokenCards } from './units';
import { canManeuver, canOverload, canPerform, spendAction, spendManeuver, spendOverload } from './ticks';

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
// seat requires. Both take the card database, because a command carries ids
// and both ends of a wire already hold the same cards. Dice will ride inside
// their commands as rolled faces, never re-rolled by the receiver.
//
// Movement commands record the destination the interactive move arrived at,
// so their apply is a no-op locally and the real move on a mirrored seat.
// Path legality stays with the move UI, which only offers reachable grids;
// check() covers everything that does not need the pathfinder.

export type Command =
  | { kind: 'setTiming'; seat: Side; uid: number; timing?: Timing }
  | { kind: 'setStance'; seat: Side; uid: number; stance: Stance }
  | { kind: 'reboot'; seat: Side; uid: number; stance: Stance }
  | { kind: 'maneuver'; seat: Side; uid: number; to: { col: number; row: number }; facing?: Facing }
  | { kind: 'performAction'; seat: Side; uid: number; actionId: string }
  | { kind: 'overload'; seat: Side; uid: number };

export type CheckResult = { ok: true } | { ok: false; why: string };

const STANCES: Stance[] = ['offensive', 'defensive', 'mobility', 'shutdown'];
const ok: CheckResult = { ok: true };
const no = (why: string): CheckResult => ({ ok: false, why });
const fromVerdict = (v: { ok: boolean; why?: string }): CheckResult => (v.ok ? ok : no(v.why ?? 'Not allowed.'));

function findAction(data: GameData, state: GameState, uid: number, actionId: string) {
  const t = state.tokens.find((x) => x.uid === uid);
  if (!t) return undefined;
  for (const { card } of tokenCards(data, t)) {
    const a = (card.actions ?? []).find((x) => x.id === actionId);
    if (a) return a;
  }
  return data.commonActions.find((x) => x.id === actionId);
}

// The Action Opportunity being spent, but only if it belongs to this unit:
// commands never invent one, they spend the one the guide opened.
function oppOf(state: GameState, uid: number) {
  const o = state.script?.opp;
  return o && o.uid === uid ? o : undefined;
}

export function check(data: GameData, state: GameState, cmd: Command): CheckResult {
  const t = state.tokens.find((x) => x.uid === cmd.uid);
  if (!t) return no('That unit is not on the board.');
  if (t.side !== cmd.seat) return no(`${t.label} belongs to the other squad, and a player may only command their own units.`);

  switch (cmd.kind) {
    case 'setTiming': {
      if (t.kind !== 'mech') return no('Only a Mech has a Timing Dial. Drones act in the Command and Automatic Phases instead.');
      if (t.partStates.torso === 'destroyed') return no('A destroyed Mech cannot set a dial.');
      if (cmd.timing !== undefined && !TIMINGS.some((x) => x.id === cmd.timing)) return no('That is not a Timing the dial can be set to.');
      if (state.round.phase !== 1) return no('Dials are set in the Planning Phase (3.3).');
      return ok;
    }
    case 'setStance': {
      if (t.kind !== 'mech') return no('Only a Mech chooses a Stance. A Drone plays the one printed on its card.');
      if (t.partStates.torso === 'destroyed') return no('A destroyed Mech has no Stance to change.');
      if (!STANCES.includes(cmd.stance)) return no('That is not a Stance.');
      if (t.stance === 'shutdown' && cmd.stance !== 'shutdown') {
        return no('Leaving Shutdown Stance takes a Reboot, which costs the Action Opportunity (4.1.1).');
      }
      return ok;
    }
    case 'reboot': {
      if (t.kind !== 'mech') return no('Only a Mech Reboots.');
      if (t.partStates.torso === 'destroyed') return no('A destroyed Mech cannot Reboot.');
      if (t.stance !== 'shutdown') return no('Only a Mech in Shutdown Stance may Reboot (4.1.1).');
      if (!STANCES.includes(cmd.stance) || cmd.stance === 'shutdown') return no('A Reboot ends in one of the three active Stances.');
      return ok;
    }
    case 'maneuver': {
      const { col, row } = cmd.to;
      if (!Number.isInteger(col) || !Number.isInteger(row) || col < 0 || row < 0 || col > 35 || row > 35) {
        return no('That is not a place on the board.');
      }
      const o = oppOf(state, cmd.uid);
      if (!o) return no('It is not this Mech\'s Action Opportunity.');
      return fromVerdict(canManeuver(o));
    }
    case 'performAction': {
      const a = findAction(data, state, cmd.uid, cmd.actionId);
      if (!a) return no('This unit has no such Action.');
      const o = oppOf(state, cmd.uid);
      if (!o) return no('It is not this unit\'s Action Opportunity.');
      return fromVerdict(canPerform(o, a));
    }
    case 'overload': {
      const ids = new Set(data.overload.map((g) => g.actionId));
      const has = tokenCards(data, t).some(({ card }) => (card.actions ?? []).some((a) => ids.has(a.id)));
      if (!has) return no('This Mech has no Overloading Pack.');
      const o = oppOf(state, cmd.uid);
      if (!o) return no('It is not this Mech\'s Action Opportunity.');
      return fromVerdict(canOverload(o, t.link ?? 0));
    }
  }
}

export function apply(data: GameData, state: GameState, cmd: Command): void {
  const t = state.tokens.find((x) => x.uid === cmd.uid);
  if (!t) return;
  const sc = state.script;

  switch (cmd.kind) {
    case 'setTiming':
      t.timing = cmd.timing;
      return;
    case 'setStance':
      t.stance = cmd.stance;
      return;
    case 'reboot': {
      t.stance = cmd.stance;
      t.link = Math.min(maxLink(data, t), (t.link ?? 0) + 1);
      const o = oppOf(state, cmd.uid);
      if (o) {
        // 4.1.1: the Reboot consumes the Opportunity except for one Action
        // Tick, which must match the freshly chosen dial, so the Starting
        // Action rule is re-armed rather than already satisfied.
        o.maneuver = 0;
        o.maneuvered = true;
        o.action = 1;
        o.started = false;
        o.performed = [...o.performed, 'COMMON_REBOOT'];
      }
      return;
    }
    case 'maneuver': {
      t.col = cmd.to.col;
      t.row = cmd.to.row;
      if (cmd.facing !== undefined) t.facing = cmd.facing;
      const o = oppOf(state, cmd.uid);
      if (o && sc) sc.opp = spendManeuver(o);
      return;
    }
    case 'performAction': {
      const a = findAction(data, state, cmd.uid, cmd.actionId);
      const o = oppOf(state, cmd.uid);
      if (a && o && sc) sc.opp = spendAction(o, a);
      return;
    }
    case 'overload': {
      t.link = Math.max(0, (t.link ?? 0) - 1);
      const o = oppOf(state, cmd.uid);
      if (o && sc) sc.opp = spendOverload(o);
      // Spending the last Link is a Shutdown like any other: the consequence
      // lives inside the command so a mirrored seat reaches the same state.
      if (t.link === 0 && t.stance !== 'shutdown') t.stance = 'shutdown';
      return;
    }
  }
}

// The sandbox and the teaching guide warn rather than block, so they perform
// regardless and surface why when there is a why. The strict tracker will call
// check() first and refuse instead: one rule, two presentations.
export function perform(data: GameData, state: GameState, cmd: Command): CheckResult {
  const verdict = check(data, state, cmd);
  apply(data, state, cmd);
  return verdict;
}
