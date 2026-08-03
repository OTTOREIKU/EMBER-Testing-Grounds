import type { Facing, GameState, PartSlot, Side, SmokeScreen, Stance, Timing, Token } from './types';
import { addStatus, ageTokens, PHASES, STATUSES, TIMINGS } from './types';
import type { GameData } from './data';
import { makeDroneToken, maxLink, tokenCards } from './units';
import { canManeuver, canOverload, canPerform, spendAction, spendManeuver, spendOverload } from './ticks';
import { tacticSpec, tacticTargets, type TacticCtx } from './tactics';
import { deploymentComplete, deployTurn, firstPlayerFrom, newSetup, normaliseSetup } from './setup';
import { applyKill, normaliseTasks, settleControl } from './tasks';
import { dialHidden, eligibleUnits, getLocalSeat, isLoopPhase, nextTurn, onExtraOpportunity } from './loop';
import { dissipationFor } from './rules';

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
  | { kind: 'destroyTerrain'; seat: Side; uid: number; pieces: string[] }
  | { kind: 'advancePhase'; seat: Side }
  | { kind: 'setPhase'; seat: Side; phase: number }
  | { kind: 'resetRounds'; seat: Side }
  | { kind: 'adjustCommandTokens'; seat: Side; pool: Side; delta: number }
  | { kind: 'endOpportunity'; seat: Side; uid: number }
  | { kind: 'designate'; seat: Side; uid: number }
  | { kind: 'passTurn'; seat: Side }
  | { kind: 'grantExtra'; seat: Side; uid: number; linkCost: number }
  | { kind: 'markEndStep'; seat: Side; step: string }
  | { kind: 'award'; seat: Side; vp: { s1: number; s2: number }; keys: string[] }
  | { kind: 'stabilise'; seat: Side; uid: number }
  | { kind: 'reveal'; seat: Side; uid: number }
  | { kind: 'lockMap'; seat: Side }
  | { kind: 'rollSetup'; seat: Side; hits: number[] }
  | { kind: 'acceptRoll'; seat: Side }
  | { kind: 'pickEdge'; seat: Side; edge: 'black' | 'white' }
  | { kind: 'lockDials'; seat: Side }
  | { kind: 'finishDeployment'; seat: Side }
  | { kind: 'queueIntercepts'; seat: Side; items: { uid: number; actionId: string; targetUid: number }[] }
  | { kind: 'resolveIntercept'; seat: Side; uid: number; actionId: string; targetUid: number }
  | { kind: 'clearIntercepts'; seat: Side }
  | { kind: 'launch'; seat: Side; uid: number; actionId: string; cardId: string; to: { col: number; row: number }; facing: Facing }
  | { kind: 'despawn'; seat: Side; uid: number; targetUid: number }
  | { kind: 'placeSmoke'; seat: Side; at: { col: number; row: number } }
  | { kind: 'removeSmoke'; seat: Side; at: { col: number; row: number } }
  | { kind: 'dissipateSmoke'; seat: Side }
  | { kind: 'setMode'; seat: Side; mode: 'hotseat' | 'hidden' }
  | { kind: 'handOver'; seat: Side }
  | { kind: 'setStrict'; seat: Side; strict: boolean }
  // The two halves of the networked dial reveal (3.3). A seat publishes a
  // hash of its dials first and the dials themselves only once both hashes
  // are in, so neither player can see the other's before fixing their own.
  | { kind: 'commitTimings'; seat: Side; hash: string }
  | { kind: 'revealTimings'; seat: Side; salt: string; dials: { uid: number; timing?: Timing }[] };

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

// Forced Movement, kill tallies, terrain destruction and the intercept queue
// may outlive their actor: a grenade's Knockback resolves after the spent
// projectile has left the board, and an owed Interception survives its unit
// dying. So these carry the actor for attribution, and the on-board gate binds
// only while it is still standing.
function actorOptional(cmd: Command): cmd is Command & { kind: 'forceMove' | 'recordKill' | 'destroyTerrain' | 'resolveIntercept' } {
  return cmd.kind === 'forceMove' || cmd.kind === 'recordKill' || cmd.kind === 'destroyTerrain' || cmd.kind === 'resolveIntercept';
}

// The round track, the pre-game stages, the smoke and intercept books, the
// designation loop's pass and the End Phase checklist belong to the table, not
// to a unit, so these carry a seat and nothing else.
type TableKind =
  | 'advancePhase' | 'setPhase' | 'resetRounds' | 'adjustCommandTokens' | 'passTurn' | 'markEndStep' | 'award'
  | 'lockMap' | 'rollSetup' | 'acceptRoll' | 'pickEdge' | 'lockDials' | 'finishDeployment'
  | 'queueIntercepts' | 'clearIntercepts' | 'placeSmoke' | 'removeSmoke' | 'dissipateSmoke'
  | 'setMode' | 'handOver' | 'setStrict' | 'commitTimings' | 'revealTimings';
const TABLE_KINDS = new Set<Command['kind']>([
  'advancePhase', 'setPhase', 'resetRounds', 'adjustCommandTokens', 'passTurn', 'markEndStep', 'award',
  'lockMap', 'rollSetup', 'acceptRoll', 'pickEdge', 'lockDials', 'finishDeployment',
  'queueIntercepts', 'clearIntercepts', 'placeSmoke', 'removeSmoke', 'dissipateSmoke',
  'setMode', 'handOver', 'setStrict', 'commitTimings', 'revealTimings',
]);
function tableLevel(cmd: Command): cmd is Command & { kind: TableKind } {
  return TABLE_KINDS.has(cmd.kind);
}

// The lookup the zone-control judgement reads its Grids from.
const zoneCells = (data: GameData) => (zone: string): string[] => data.zoneData.zones.find((z) => z.id === zone)?.cells ?? [];

function checkTable(state: GameState, cmd: Command & { kind: TableKind }): CheckResult {
  switch (cmd.kind) {
    case 'advancePhase': {
      const su = normaliseSetup(state.setup);
      if (su && su.stage !== 'done') return no('Finish the pre-game roll and deployment first (3.1).');
      return ok;
    }
    case 'setPhase': {
      if (!Number.isInteger(cmd.phase) || cmd.phase < 0 || cmd.phase >= PHASES.length) return no('That is not a phase.');
      return ok;
    }
    case 'resetRounds':
      return ok;
    case 'adjustCommandTokens': {
      if (!Number.isInteger(cmd.delta) || cmd.delta === 0) return no('Nothing to adjust.');
      if ((state.commandTokens?.[cmd.pool] ?? 0) + cmd.delta < 0) return no('A Command Token pool cannot go below zero.');
      return ok;
    }
    case 'passTurn': {
      if (!state.script) return no('There is no guided game running.');
      if (!isLoopPhase(PHASES[state.round.phase])) return no('There is no designation loop to pass in this phase.');
      if (state.script.passed.includes(cmd.seat)) return no('This squad has already passed for the phase (3.2.2).');
      return ok;
    }
    case 'markEndStep': {
      if (!state.script) return no('The End Phase checklist belongs to a guided game.');
      if (state.round.phase !== PHASES.length - 1) return no('These steps belong to the End Phase (3.7).');
      return ok;
    }
    case 'award': {
      if (!Number.isFinite(cmd.vp.s1) || !Number.isFinite(cmd.vp.s2) || cmd.vp.s1 < 0 || cmd.vp.s2 < 0) return no('That is not a score.');
      return ok;
    }
    case 'lockMap': {
      const su = normaliseSetup(state.setup);
      if (su && su.stage !== 'map') return no('The battlefield is already locked (3.1.2).');
      return ok;
    }
    case 'rollSetup': {
      const su = normaliseSetup(state.setup);
      if (!su || su.stage !== 'roll') return no('The table-edge roll comes after the battlefield is locked (3.1.2).');
      if (!Array.isArray(cmd.hits) || !cmd.hits.length || cmd.hits.some((h) => !Number.isInteger(h) || h < 0)) return no('That is not a roll.');
      return ok;
    }
    case 'acceptRoll': {
      const su = normaliseSetup(state.setup);
      if (!su || !firstPlayerFrom(su)) return no('The roll is tied, so it must be made again (3.1.2).');
      return ok;
    }
    case 'pickEdge': {
      const su = normaliseSetup(state.setup);
      if (!su || su.stage !== 'side') return no('The table-edge pick follows the First Player roll (3.1.2).');
      if (cmd.seat !== state.round.firstPlayer) return no('The First Player picks the table edge (3.1.2).');
      if (cmd.edge !== 'black' && cmd.edge !== 'white') return no('That is not a table edge.');
      return ok;
    }
    case 'lockDials': {
      if (!state.script) return no('There is no guided game running.');
      if (state.round.phase !== 1) return no('Dials lock at the end of the Planning Phase (3.3).');
      return ok;
    }
    case 'finishDeployment': {
      if (!deploymentComplete(state)) return no('Units are still waiting to deploy (3.1.4).');
      return ok;
    }
    case 'queueIntercepts': {
      if (!state.script) return no('There is no guided game running.');
      if (!cmd.items.length) return no('No Interceptions owed.');
      if (cmd.items.some((x) => !Number.isInteger(x.uid) || !Number.isInteger(x.targetUid) || typeof x.actionId !== 'string')) {
        return no('That is not an Interception.');
      }
      return ok;
    }
    case 'clearIntercepts': {
      if (!state.script) return no('There is no guided game running.');
      return ok;
    }
    case 'placeSmoke': {
      const { col, row } = cmd.at;
      if (!Number.isInteger(col) || !Number.isInteger(row) || col < 0 || row < 0 || col > 11 || row > 11) return no('That is not a Grid.');
      return ok;
    }
    case 'removeSmoke': {
      if (!(state.smoke ?? []).some((x) => x.col === cmd.at.col && x.row === cmd.at.row)) return no('There is no Smoke Screen there.');
      return ok;
    }
    case 'dissipateSmoke':
      return ok;
    case 'setMode': {
      if (cmd.mode !== 'hotseat' && cmd.mode !== 'hidden') return no('That is not a table mode.');
      if (!state.script) return no('There is no guided game running.');
      return ok;
    }
    case 'handOver': {
      const sc = state.script;
      if (!sc || sc.mode !== 'hidden') return no('Handing over belongs to pass-and-play.');
      if (state.round.phase !== 1) return no('The device is handed over during the Planning Phase (3.3).');
      if (sc.stage === `${state.round.n}:1:locked`) return no('The dials are already locked in.');
      if (sc.turn !== cmd.seat) return no('The device is not with this squad.');
      return ok;
    }
    case 'setStrict': {
      if (!state.script) return no('There is no guided game running.');
      return ok;
    }
    case 'commitTimings': {
      const sc = state.script;
      if (!sc) return no('There is no guided game running.');
      if (state.round.phase !== 1) return no('Dials are committed in the Planning Phase (3.3).');
      if (typeof cmd.hash !== 'string' || cmd.hash.length < 16) return no('That is not a commitment.');
      if (sc.commits[cmd.seat]) return no('This squad has already committed its dials this round.');
      return ok;
    }
    case 'revealTimings': {
      const sc = state.script;
      if (!sc) return no('There is no guided game running.');
      // A reveal is only meaningful against a commitment made earlier — that
      // pairing is the whole guarantee, so an uncommitted reveal is refused.
      if (!sc.commits[cmd.seat]) return no('That squad never committed its dials, so there is nothing to check the reveal against.');
      if (sc.revealed.includes(cmd.seat)) return no('This squad has already revealed.');
      if (typeof cmd.salt !== 'string' || !Array.isArray(cmd.dials)) return no('That is not a reveal.');
      return ok;
    }
  }
}

export function check(data: GameData, state: GameState, cmd: Command): CheckResult {
  if (tableLevel(cmd)) return checkTable(state, cmd);
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
    case 'resolveIntercept': {
      const sc = state.script;
      if (!sc) return no('There is no guided game running.');
      if (!sc.intercepts.some((x) => x.uid === cmd.uid && x.actionId === cmd.actionId && x.targetUid === cmd.targetUid)) {
        return no('That Interception is not owed.');
      }
      return ok;
    }
  }
}

function checkActed(
  data: GameData,
  state: GameState,
  cmd: Exclude<Command, { kind: 'forceMove' | 'recordKill' | 'destroyTerrain' | 'resolveIntercept' | TableKind }>,
  t: Token,
): CheckResult {
  switch (cmd.kind) {
    case 'setTiming': {
      if (t.kind !== 'mech') return no('Only a Mech has a Timing Dial. Drones act in the Command and Automatic Phases instead.');
      if (t.partStates.torso === 'destroyed') return no('A destroyed Mech cannot set a dial.');
      if (cmd.timing !== undefined && !TIMINGS.some((x) => x.id === cmd.timing)) return no('That is not a Timing the dial can be set to.');
      if (state.round.phase !== 1) return no('Dials are set in the Planning Phase (3.3).');
      if (dialHidden(state, t)) return no('In pass-and-play a squad sets its dials on its own planning turn (3.3).');
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
    case 'endOpportunity': {
      if (!oppOf(state, cmd.uid)) return no('It is not this unit\'s Action Opportunity.');
      return ok;
    }
    case 'designate': {
      const phase = PHASES[state.round.phase];
      if (!isLoopPhase(phase)) return no('Designation happens in the Command, Automatic and Delay Phases.');
      const sc = state.script;
      if (!sc) return no('There is no guided game running.');
      if (sc.turn !== cmd.seat) return no('It is the other squad\'s turn to designate (3.2.2).');
      if (!eligibleUnits(state, phase, cmd.seat).some((x) => x.uid === cmd.uid)) return no(`${t.label} cannot be designated this phase.`);
      return ok;
    }
    case 'grantExtra': {
      if (t.kind !== 'mech') return no('Only a Mech takes an Extra Action Opportunity.');
      if ((t.link ?? 0) < cmd.linkCost) return no(`This needs ${cmd.linkCost} Link, and ${t.label} has ${t.link ?? 0}.`);
      return ok;
    }
    case 'stabilise': {
      const shed = (t.statuses ?? []).some((id) => {
        const d = STATUSES.find((x) => x.id === id);
        return d?.shape === 'square' || d?.shape === 'hexagon';
      });
      if (!shed) return no('No Square or Hexagon Token to remove (6.1).');
      return ok;
    }
    case 'reveal': {
      if (!(t.statuses ?? []).includes('camouflage')) return no('This unit is not in the Optical Camouflage State.');
      return ok;
    }
    case 'launch': {
      if (!data.byId.get(cmd.cardId)) return no('That is not a card the database knows.');
      if (!findAction(data, state, cmd.uid, cmd.actionId)) return no('This unit has no such Action.');
      const { col, row } = cmd.to;
      if (!Number.isInteger(col) || !Number.isInteger(row) || col < 0 || row < 0 || col > 35 || row > 35) {
        return no('That is not a place on the board.');
      }
      return ok;
    }
    case 'despawn': {
      if (!state.tokens.some((x) => x.uid === cmd.targetUid)) return no('That unit is not on the board.');
      return ok;
    }
  }
}

export function apply(data: GameData, state: GameState, cmd: Command): void {
  if (cmd.kind === 'advancePhase') {
    const r = state.round;
    if (r.phase < PHASES.length - 1) {
      r.phase++;
    } else {
      r.phase = 0;
      r.n++;
      r.firstPlayer = r.firstPlayer === 's1' ? 's2' : 's1';
      state.commandTokens = { s1: 0, s2: 0 };
      for (const x of state.tokens) x.timing = undefined;
      // Last round's commitments describe dials that no longer exist, and
      // leaving them would let the next round's reveal check against them.
      if (state.script) {
        state.script.commits = {};
        state.script.revealed = [];
      }
      // All Terminal Tokens flip back face-up at the End Phase (5.3.3), so the
      // new round starts with every Terminal accessible again.
      for (const i of state.tasks?.items ?? []) if (i.kind === 'terminal') i.accessed = null;
    }
    return;
  }
  if (cmd.kind === 'setPhase') {
    state.round.phase = cmd.phase;
    return;
  }
  if (cmd.kind === 'resetRounds') {
    state.round.n = 1;
    state.round.phase = 0;
    state.commandTokens = { s1: 0, s2: 0 };
    // Plays are stamped with a round number, so winding the track back to 1
    // would leave round 1's cards reading as already spent.
    state.tacticsPlayed = { s1: [], s2: [] };
    if (state.script) {
      state.script.commits = {};
      state.script.revealed = [];
    }
    return;
  }
  if (cmd.kind === 'adjustCommandTokens') {
    if (!state.commandTokens) state.commandTokens = { s1: 0, s2: 0 };
    state.commandTokens[cmd.pool] = Math.max(0, state.commandTokens[cmd.pool] + cmd.delta);
    return;
  }
  if (cmd.kind === 'passTurn') {
    const sc = state.script;
    const phase = PHASES[state.round.phase];
    if (!sc || !isLoopPhase(phase)) return;
    if (!sc.passed.includes(cmd.seat)) sc.passed.push(cmd.seat);
    sc.turn = nextTurn(state, phase, cmd.seat) ?? cmd.seat;
    return;
  }
  if (cmd.kind === 'markEndStep') {
    const sc = state.script;
    if (!sc) return;
    if (cmd.step === 'tokens') {
      // Yellow tokens flip, red tokens come off (2.5.3), and unspent Command
      // Tokens never carry over (3.2.3).
      for (const x of state.tokens) ageTokens(x);
      state.commandTokens = { s1: 0, s2: 0 };
    }
    if (cmd.step === 'remove') {
      // Integrity Loss (4.4.4): a Mech down to 2 Parts leaves in the End Phase.
      state.tokens = state.tokens.filter((x) => !(x.kind === 'mech' && Object.values(x.partStates).filter((p) => p !== 'destroyed').length <= 2));
    }
    if (cmd.step === 'tasks') {
      const tasks = normaliseTasks(state.tasks);
      settleControl(tasks, zoneCells(data), state.tokens, (x) => lowValueUnit(data, x));
      state.tasks = tasks;
    }
    const key = `${state.round.n}:end:${cmd.step}`;
    if (!sc.endDone.includes(key)) sc.endDone.push(key);
    return;
  }
  if (cmd.kind === 'award') {
    const tasks = normaliseTasks(state.tasks);
    // The Award judges control as part of the same reading of the board that
    // it scores (5.3.2), so the settlement happens here too.
    settleControl(tasks, zoneCells(data), state.tokens, (x) => lowValueUnit(data, x));
    tasks.vp.s1 += cmd.vp.s1;
    tasks.vp.s2 += cmd.vp.s2;
    for (const k of cmd.keys) if (!tasks.scored.includes(k)) tasks.scored.push(k);
    tasks.paidKills = { s1: { ...tasks.kills.s1 }, s2: { ...tasks.kills.s2 } };
    tasks.paidTestKills = { ...tasks.testKills };
    state.tasks = tasks;
    const sc = state.script;
    if (sc) {
      const key = `${state.round.n}:end:tasks`;
      if (!sc.endDone.includes(key)) sc.endDone.push(key);
    }
    return;
  }
  if (cmd.kind === 'lockMap') {
    state.setup = { ...(normaliseSetup(state.setup) ?? newSetup()), stage: 'roll' };
    return;
  }
  if (cmd.kind === 'rollSetup') {
    // The dice were rolled by the sender; the command carries the Hits, so a
    // mirrored seat never re-rolls them.
    const su = normaliseSetup(state.setup) ?? newSetup();
    su.rolls = { ...su.rolls, [cmd.seat]: cmd.hits };
    state.setup = su;
    return;
  }
  if (cmd.kind === 'acceptRoll') {
    const su = normaliseSetup(state.setup) ?? newSetup();
    const winner = firstPlayerFrom(su);
    if (!winner) return;
    state.round.firstPlayer = winner;
    state.setup = { ...su, stage: 'side' };
    return;
  }
  if (cmd.kind === 'pickEdge') {
    const su = normaliseSetup(state.setup) ?? newSetup();
    const fp = state.round.firstPlayer;
    const other: Side = fp === 's1' ? 's2' : 's1';
    state.setup = { ...su, stage: 'deploy', edge: { ...su.edge, [fp]: cmd.edge, [other]: cmd.edge === 'black' ? 'white' : 'black' } };
    return;
  }
  if (cmd.kind === 'lockDials') {
    if (state.script) state.script.stage = `${state.round.n}:1:locked`;
    return;
  }
  if (cmd.kind === 'finishDeployment') {
    state.setup = { ...(normaliseSetup(state.setup) ?? newSetup()), stage: 'done' };
    // The Command Phase stage was entered before the roll decided the First
    // Player; clearing it makes the guide's stage sync run again now that the
    // real one is known (3.2.2 starts the command loop from them).
    if (state.script) state.script.stage = '';
    return;
  }
  if (cmd.kind === 'queueIntercepts') {
    if (state.script) state.script.intercepts = [...state.script.intercepts, ...cmd.items];
    return;
  }
  if (cmd.kind === 'resolveIntercept') {
    const sc = state.script;
    if (!sc) return;
    const at = sc.intercepts.findIndex((x) => x.uid === cmd.uid && x.actionId === cmd.actionId && x.targetUid === cmd.targetUid);
    if (at >= 0) sc.intercepts = sc.intercepts.filter((_, i) => i !== at);
    return;
  }
  if (cmd.kind === 'clearIntercepts') {
    if (state.script) state.script.intercepts = [];
    return;
  }
  if (cmd.kind === 'placeSmoke') {
    state.smoke = [...(state.smoke ?? []), { col: cmd.at.col, row: cmd.at.row, side: cmd.seat }];
    return;
  }
  if (cmd.kind === 'removeSmoke') {
    const list = [...(state.smoke ?? [])];
    const at = list.findIndex((x) => x.col === cmd.at.col && x.row === cmd.at.row);
    if (at >= 0) list.splice(at, 1);
    state.smoke = list;
    return;
  }
  if (cmd.kind === 'setMode') {
    if (state.script) state.script.mode = cmd.mode;
    return;
  }
  if (cmd.kind === 'setStrict') {
    if (state.script) state.script.strict = cmd.strict;
    return;
  }
  if (cmd.kind === 'commitTimings') {
    if (state.script) state.script.commits = { ...state.script.commits, [cmd.seat]: cmd.hash };
    return;
  }
  if (cmd.kind === 'revealTimings') {
    const sc = state.script;
    if (!sc) return;
    // Only ever writes dials onto that seat's own units, so a reveal cannot
    // reach across and rewrite the other player's plan.
    for (const d of cmd.dials) {
      const t = state.tokens.find((x) => x.uid === d.uid);
      if (t && t.side === cmd.seat) t.timing = d.timing;
    }
    if (!sc.revealed.includes(cmd.seat)) sc.revealed = [...sc.revealed, cmd.seat];
    return;
  }
  if (cmd.kind === 'handOver') {
    // Pass-and-play planning runs as two sub-turns on sc.turn: the First
    // Player sets their dials, hands the device over, and the other squad
    // sets theirs before the lock reveals both at once.
    const sc = state.script;
    if (sc) sc.turn = cmd.seat === 's1' ? 's2' : 's1';
    return;
  }
  if (cmd.kind === 'dissipateSmoke') {
    // Isolated screens come off for both sides in one judgement (4.16); the
    // Connected-group picks arrive as removeSmoke commands afterwards.
    const smoke = state.smoke ?? [];
    const doomed = new Set<SmokeScreen>();
    for (const side of ['s1', 's2'] as Side[]) for (const iso of dissipationFor(smoke, side).isolated) doomed.add(iso);
    state.smoke = smoke.filter((x) => !doomed.has(x));
    return;
  }
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
    case 'endOpportunity': {
      if (!sc) return;
      // Ending an Extra Opportunity spends the grant. Ending a normal one
      // records the Mech as having acted. A Mech granted one before its own
      // turn comes up takes the normal Opportunity first, then the extra.
      if (onExtraOpportunity(state, cmd.uid)) {
        const at = sc.extraOpps.indexOf(cmd.uid);
        if (at >= 0) sc.extraOpps.splice(at, 1);
      } else if (!sc.acted.includes(cmd.uid)) {
        sc.acted.push(cmd.uid);
      }
      sc.opp = null;
      return;
    }
    case 'designate': {
      const phase = PHASES[state.round.phase];
      if (!sc || !isLoopPhase(phase)) return;
      if (phase === 'Command') {
        // Additional Instructions buys one Command Action outright, so the
        // token stays in the pool for this designation only.
        const free = sc.freeCommand.includes(cmd.uid);
        if (free) sc.freeCommand = sc.freeCommand.filter((x) => x !== cmd.uid);
        else state.commandTokens[t.side] = Math.max(0, (state.commandTokens[t.side] ?? 0) - 1);
        if (!sc.commanded.includes(cmd.uid)) sc.commanded.push(cmd.uid);
      } else if (!sc.acted.includes(cmd.uid)) {
        sc.acted.push(cmd.uid);
      }
      sc.turn = nextTurn(state, phase, t.side) ?? t.side;
      return;
    }
    case 'grantExtra': {
      t.link = Math.max(0, (t.link ?? 0) - cmd.linkCost);
      if (sc) sc.extraOpps.push(cmd.uid);
      return;
    }
    case 'stabilise': {
      // Stabilize System (6.1): Torso removes 1 Square or Hexagon Token from
      // this Mech, then restores 1 Link.
      const shed = (t.statuses ?? []).find((id) => {
        const d = STATUSES.find((x) => x.id === id);
        return d?.shape === 'square' || d?.shape === 'hexagon';
      });
      if (!shed) return;
      const list = [...(t.statuses ?? [])];
      list.splice(list.indexOf(shed), 1);
      t.statuses = list;
      t.expiring = (t.expiring ?? []).filter((id) => id !== shed);
      if (!t.expiring.length) t.expiring = undefined;
      t.link = Math.min(maxLink(data, t), (t.link ?? 0) + 1);
      return;
    }
    case 'reveal': {
      t.statuses = (t.statuses ?? []).filter((id) => id !== 'camouflage');
      return;
    }
    case 'launch': {
      const card = data.byId.get(cmd.cardId);
      if (!card) return;
      // The uid counter lives in the state, so a mirrored seat mints the same
      // one. The Ammo that paid for the shot is spent in the same breath.
      const tok = makeDroneToken(state, data, card, t.side);
      state.tokens.push({ ...tok, parentUid: t.uid, col: cmd.to.col, row: cmd.to.row, facing: cmd.facing });
      if (t.ammo[cmd.actionId] !== undefined) t.ammo[cmd.actionId] = Math.max(0, t.ammo[cmd.actionId] - 1);
      return;
    }
    case 'despawn': {
      state.tokens = state.tokens.filter((x) => x.uid !== cmd.targetUid);
      return;
    }
  }
}

// What a strict refusal does with its reason. The command layer cannot toast,
// so the app registers a presenter once and every call site inherits it.
let refused: ((why: string) => void) | null = null;
export function onRefused(fn: (why: string) => void): void {
  refused = fn;
}

// Where a command goes after it has been applied locally, when a networked
// game is running. Registering it here rather than at each call site is the
// whole reason the command layer exists: every move in the app becomes
// sendable at once, and none of the UI has to know a socket is involved.
let mirror: ((cmd: Command) => void) | null = null;
export function onPerformed(fn: ((cmd: Command) => void) | null): void {
  mirror = fn;
}

// Commands that must never leave this client. Setting a Timing Dial is the
// game's one piece of hidden information (3.3): it travels only inside a
// revealTimings, once both squads have committed to what they chose. Keeping
// the rule here rather than at the call site makes it structural — no future
// caller can forget it, and it can be tested.
const SECRET_KINDS = new Set<Command['kind']>(['setTiming']);

export function isSecret(cmd: Command): boolean {
  return SECRET_KINDS.has(cmd.kind);
}

// True while a command that arrived from the other player is being applied.
// Without it the mirror would bounce every received command straight back and
// the two clients would volley forever.
let applyingRemote = false;

// A command from the other player, checked with the same engine before it is
// allowed anywhere near this board.
//
// The relay orders and forwards but does not referee, and the client at the
// other end is not ours to trust — it could be modified. So the move is put
// through check() here, exactly as a local move is, and refused if the rules
// refuse it. Returning the verdict rather than throwing lets the caller tell
// the player and ask the server to resync, because a refusal can also mean the
// two boards have drifted rather than that anyone is cheating.
export function applyRemote(data: GameData, state: GameState, cmd: Command): CheckResult {
  const verdict = check(data, state, cmd);
  if (!verdict.ok) return verdict;
  applyingRemote = true;
  try {
    apply(data, state, cmd);
  } finally {
    applyingRemote = false;
  }
  return verdict;
}

// The sandbox and the teaching guide warn rather than block, so they perform
// regardless and surface why when there is a why. The strict tracker refuses
// instead, right here, which is what makes every call site strict at once:
// one rule, two presentations.
export function perform(data: GameData, state: GameState, cmd: Command): CheckResult {
  const verdict = check(data, state, cmd);
  // An online game is always strict, whatever the guide is set to. Both
  // clients have to refuse the same things or their boards drift apart, and a
  // player who waved a rule away locally would otherwise push the result onto
  // an opponent who never agreed to it.
  const strict = !!state.script?.strict || !!getLocalSeat();
  if (!verdict.ok && strict) {
    refused?.(verdict.why);
    return verdict;
  }
  apply(data, state, cmd);
  // Mirrored only after it has actually landed here, so the other player never
  // sees a move this client refused to make — and never if it is secret.
  if (!applyingRemote && !isSecret(cmd)) mirror?.(cmd);
  return verdict;
}
