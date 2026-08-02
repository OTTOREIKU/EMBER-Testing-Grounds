import type { Facing, GameState, PartSlot, Side, Stance, Timing, Token } from './types';
import { addStatus, PHASES, STATUSES, TIMINGS } from './types';
import type { GameData } from './data';
import { maxLink, tokenCards } from './units';
import { canManeuver, canOverload, canPerform, spendAction, spendManeuver, spendOverload } from './ticks';
import { tacticSpec, tacticTargets, type TacticCtx } from './tactics';
import { deployTurn, normaliseSetup } from './setup';
import { applyKill, normaliseTasks } from './tasks';

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
  | { kind: 'overload'; seat: Side; uid: number }
  | { kind: 'playTactic'; seat: Side; uid: number; cardId: string; pick?: string }
  | { kind: 'deployUnit'; seat: Side; uid: number; to: { col: number; row: number }; stance?: Stance; camo?: boolean }
  | { kind: 'applyPenetration'; seat: Side; uid: number; targetUid: number; slot: PartSlot | 'main' }
  | { kind: 'applyStatus'; seat: Side; uid: number; targetUid: number; statusId: string; stacks?: number }
  | { kind: 'focus'; seat: Side; uid: number }
  | { kind: 'forceMove'; seat: Side; uid: number; targetUid: number; to: { col: number; row: number }; push?: boolean }
  | { kind: 'spendAmmo'; seat: Side; uid: number; actionId: string }
  | { kind: 'restoreAmmo'; seat: Side; uid: number; actionId: string; amount?: number }
  | { kind: 'recordKill'; seat: Side; uid: number; targetUid: number; what: 'part' | 'unit' }
  | { kind: 'destroyTerrain'; seat: Side; uid: number; pieces: string[] };

export type CheckResult = { ok: true } | { ok: false; why: string };

const STANCES: Stance[] = ['offensive', 'defensive', 'mobility', 'shutdown'];
const ok: CheckResult = { ok: true };
const no = (why: string): CheckResult => ({ ok: false, why });
const fromVerdict = (v: { ok: boolean; why?: string }): CheckResult => (v.ok ? ok : no(v.why ?? 'Not allowed.'));

const tacticCtx = (data: GameData): TacticCtx => ({ maxLink: (x) => maxLink(data, x) });

// A Low Value Unit has no Point Value (book p.82), which is how the card data
// marks them: the carried and generated Drones all cost 0.
function lowValueUnit(data: GameData, t: Token): boolean {
  if (t.kind === 'projectile') return true;
  if (t.kind !== 'drone') return false;
  return (data.byId.get(t.cardId ?? '')?.score ?? 0) === 0;
}

function ammoMax(data: GameData, t: Token, actionId: string): number | undefined {
  return tokenCards(data, t).flatMap(({ card }) => card.actions ?? []).find((a) => a.id === actionId)?.storage;
}

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

// Forced Movement, kill tallies and terrain destruction may outlive their
// actor: a grenade's Knockback resolves after the spent projectile has left
// the board. So these three carry the actor for attribution, and the on-board
// gate binds only while it is still standing.
function actorOptional(cmd: Command): cmd is Command & { kind: 'forceMove' | 'recordKill' | 'destroyTerrain' } {
  return cmd.kind === 'forceMove' || cmd.kind === 'recordKill' || cmd.kind === 'destroyTerrain';
}

export function check(data: GameData, state: GameState, cmd: Command): CheckResult {
  const t = state.tokens.find((x) => x.uid === cmd.uid);
  if (!actorOptional(cmd)) {
    if (!t) return no('That unit is not on the board.');
    if (t.side !== cmd.seat) return no(`${t.label} belongs to the other squad, and a player may only command their own units.`);
    return checkActed(data, state, cmd, t);
  }
  if (t && t.side !== cmd.seat) return no(`${t.label} belongs to the other squad, and a player may only command their own units.`);

  switch (cmd.kind) {
    case 'forceMove': {
      // The path and blocking rules stay with the caller, which computed where
      // the Forced Movement actually ends; this covers everything else.
      const target = state.tokens.find((x) => x.uid === cmd.targetUid);
      if (!target) return no('That target is not on the board.');
      const { col, row } = cmd.to;
      if (!Number.isInteger(col) || !Number.isInteger(row) || col < 0 || row < 0 || col > 35 || row > 35) {
        return no('That is not a place on the board.');
      }
      return ok;
    }
    case 'recordKill': {
      if (!state.tokens.some((x) => x.uid === cmd.targetUid)) return no('That target is not on the board.');
      return ok;
    }
    case 'destroyTerrain': {
      if (!cmd.pieces.length) return no('No terrain named.');
      const gone = new Set(state.removedTerrain ?? []);
      if (cmd.pieces.every((p) => gone.has(p))) return no('That terrain is already destroyed.');
      return ok;
    }
  }
}

function checkActed(data: GameData, state: GameState, cmd: Exclude<Command, { kind: 'forceMove' | 'recordKill' | 'destroyTerrain' }>, t: Token): CheckResult {
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
    case 'playTactic': {
      const spec = tacticSpec(cmd.cardId);
      if (!spec) return no('That card is not a Tactics Card the guide can resolve.');
      if (!(state.tactics?.[cmd.seat] ?? []).includes(cmd.cardId)) return no(`${spec.name} is not in this squad's hand.`);
      if ((state.tacticsPlayed?.[cmd.seat] ?? []).some((e) => e.startsWith(`${state.round.n}:`))) {
        return no('A squad may play only 1 Tactics Card per round (5.4.2).');
      }
      if (state.script && PHASES[state.round.phase] !== spec.phase) {
        return no(`${spec.name} is played in the ${spec.phase} Phase (${spec.timing.toLowerCase()}), and it is the ${PHASES[state.round.phase]} Phase.`);
      }
      const ctx = tacticCtx(data);
      if (!tacticTargets(spec, state, cmd.seat, ctx).some((x) => x.uid === cmd.uid)) return no(spec.none);
      if (spec.choices && !spec.choices(t, state, ctx).some((o) => o.id === cmd.pick)) {
        return no(`That is not a choice ${spec.name} offers here.`);
      }
      return ok;
    }
    case 'deployUnit': {
      // Like the maneuver, the Deployment Zone and the standing-spot rules stay
      // with the placement UI, which only offers legal Grids.
      if (t.kind === 'projectile') return no('A Projectile is never deployed; it arrives when something launches it.');
      if (t.deployed !== false) return no(`${t.label} is already on the board.`);
      const su = normaliseSetup(state.setup);
      if (!su || su.stage !== 'deploy') return no('Units are placed in the deployment stage of setup (3.1.4).');
      if (deployTurn(state, su) !== cmd.seat) return no('It is the other squad\'s turn to place a unit (3.1.4).');
      const { col, row } = cmd.to;
      if (!Number.isInteger(col) || !Number.isInteger(row) || col < 0 || row < 0 || col > 35 || row > 35) {
        return no('That is not a place on the board.');
      }
      if (cmd.stance !== undefined && !STANCES.includes(cmd.stance)) return no('That is not a Stance.');
      return ok;
    }
    case 'applyPenetration': {
      const target = state.tokens.find((x) => x.uid === cmd.targetUid);
      if (!target) return no('That target is not on the board.');
      const card = tokenCards(data, target).find((x) => x.slot === cmd.slot)?.card;
      if (!card) return no(`${target.label} has no such Part to hit.`);
      if ((target.partStates[cmd.slot] ?? 'intact') === 'destroyed') {
        return no('That Part is already destroyed, and cannot be Penetrated again (4.4.4).');
      }
      return ok;
    }
    case 'applyStatus': {
      const target = state.tokens.find((x) => x.uid === cmd.targetUid);
      if (!target) return no('That target is not on the board.');
      if (!STATUSES.some((s) => s.id === cmd.statusId)) return no('That is not a Token or State the game knows.');
      return ok;
    }
    case 'focus': {
      if ((t.link ?? 0) < 1) return no('Focus spends 1 Link, and this unit has none to spend (4.6).');
      return ok;
    }
    case 'spendAmmo': {
      const held = t.ammo[cmd.actionId];
      if (held === undefined) return no('That Action does not track Ammo.');
      if (held < 1) return no('No Ammo left for that Action (4.12).');
      return ok;
    }
    case 'restoreAmmo': {
      const held = t.ammo[cmd.actionId];
      if (held === undefined) return no('That Action does not track Ammo.');
      const max = ammoMax(data, t, cmd.actionId);
      if (max !== undefined && held >= max) return no('That Action is already at its full Storage.');
      return ok;
    }
  }
}

export function apply(data: GameData, state: GameState, cmd: Command): void {
  if (cmd.kind === 'forceMove') {
    const target = state.tokens.find((x) => x.uid === cmd.targetUid);
    if (!target) return;
    target.col = cmd.to.col;
    target.row = cmd.to.row;
    // Push costs the victim 1 Link on top of the movement (4.13), and losing
    // the last one is a Shutdown like any other.
    if (cmd.push && target.kind === 'mech') {
      target.link = Math.max(0, (target.link ?? 0) - 1);
      if (target.link === 0 && target.stance !== 'shutdown') target.stance = 'shutdown';
    }
    return;
  }
  if (cmd.kind === 'recordKill') {
    const victim = state.tokens.find((x) => x.uid === cmd.targetUid);
    if (!victim) return;
    const tasks = normaliseTasks(state.tasks);
    applyKill(tasks, { side: cmd.seat, uid: cmd.uid }, { side: victim.side, kind: victim.kind, lowValue: lowValueUnit(data, victim) }, cmd.what);
    state.tasks = tasks;
    // A destroyed Unit leaves the board (4.4.4); the tally above is all that
    // is left of it.
    if (cmd.what === 'unit') state.tokens = state.tokens.filter((x) => x.uid !== cmd.targetUid);
    return;
  }
  if (cmd.kind === 'destroyTerrain') {
    const gone = new Set(state.removedTerrain ?? []);
    state.removedTerrain = [...(state.removedTerrain ?? []), ...cmd.pieces.filter((p) => !gone.has(p))];
    return;
  }

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
    case 'playTactic': {
      const spec = tacticSpec(cmd.cardId);
      if (!spec) return;
      const log = spec.apply(t, state, tacticCtx(data), cmd.pick ?? null);
      if (spec.freeCommand && sc) {
        sc.commanded = sc.commanded.filter((x) => x !== t.uid);
        if (!sc.freeCommand.includes(t.uid)) sc.freeCommand.push(t.uid);
      }
      if (!state.tacticsPlayed) state.tacticsPlayed = { s1: [], s2: [] };
      state.tacticsPlayed[cmd.seat].push(`${state.round.n}:${cmd.cardId}`);
      // The card's log line embeds values computed during the effect, so it is
      // written here, where a mirrored seat writes the identical line. The UI
      // reads it back off the token.
      t.log = [...(t.log ?? []), { round: state.round.n, text: log }].slice(-200);
      return;
    }
    case 'deployUnit': {
      t.col = cmd.to.col;
      t.row = cmd.to.row;
      t.facing = t.side === 's1' ? 2 : 0;
      t.deployed = true;
      // A Mech picks its Stance as it lands; anything else keeps its printed one.
      if (t.kind === 'mech' && cmd.stance) t.stance = cmd.stance;
      if (cmd.camo) t.statuses = addStatus(t.statuses, 'camouflage');
      const su = normaliseSetup(state.setup);
      if (su) {
        su.placed = { ...su.placed, [t.side]: su.placed[t.side] + 1 };
        state.setup = su;
      }
      return;
    }
    case 'applyPenetration': {
      const target = state.tokens.find((x) => x.uid === cmd.targetUid);
      if (!target) return;
      const cur = target.partStates[cmd.slot] ?? 'intact';
      const card = tokenCards(data, target).find((x) => x.slot === cmd.slot)?.card;
      target.partStates[cmd.slot] = cur === 'intact' ? ((card?.structure ?? 0) > 0 ? 'damaged' : 'destroyed') : 'destroyed';
      if (target.partStates[cmd.slot] === 'destroyed' && target.kind === 'mech') {
        target.link = Math.max(0, (target.link ?? 0) - 1);
        if (target.link === 0 && target.stance !== 'shutdown') target.stance = 'shutdown';
      }
      return;
    }
    case 'applyStatus': {
      const target = state.tokens.find((x) => x.uid === cmd.targetUid);
      if (!target) return;
      // addStatus owns the single-Hexagon rule (2.5.3), so stacking through it
      // keeps the displacement identical on every seat.
      for (let i = 0; i < (cmd.stacks ?? 1); i++) target.statuses = addStatus(target.statuses, cmd.statusId);
      return;
    }
    case 'focus': {
      t.link = Math.max(0, (t.link ?? 0) - 1);
      if (t.link === 0 && t.kind === 'mech' && t.stance !== 'shutdown') t.stance = 'shutdown';
      return;
    }
    case 'spendAmmo': {
      if (t.ammo[cmd.actionId] !== undefined) t.ammo[cmd.actionId] = Math.max(0, t.ammo[cmd.actionId] - 1);
      return;
    }
    case 'restoreAmmo': {
      if (t.ammo[cmd.actionId] === undefined) return;
      const max = ammoMax(data, t, cmd.actionId);
      const next = t.ammo[cmd.actionId] + (cmd.amount ?? 1);
      t.ammo[cmd.actionId] = max !== undefined ? Math.min(max, next) : next;
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
