import type { Facing, GameState, MechLoadout, PartSlot, Side, SmokeScreen, Stance, Timing, Token } from './types';
import { addStatus, ageTokens, PHASES, STATUSES, TIMINGS } from './types';
import type { GameData } from './data';
import { consumesCharge, electronicValue, freehandSlots, interceptCapacity, makeDroneToken, makeMechToken, maxLink, tokenCards } from './units';
import { canManeuver, canOverload, canPerform, spendAction, spendManeuver, spendOverload } from './ticks';
import { tacticSpec, tacticTargets, type TacticCtx } from './tactics';
import { battlefieldLocked, deploymentComplete, deployTurn, firstPlayerFrom, newSetup, normaliseSetup } from './setup';
import { applyKill, normaliseTasks, pendingDesignations, settleControl, type Designation } from './tasks';
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
  // `free` is a Movement Action moving the unit on the Action Tick it has
  // already paid for, so it must not also spend the Maneuver Tick. Everything
  // else that moves a unit under its own power is a Maneuver.
  //
  // `via` is the route walked, purely so the other player watches the same walk
  // instead of a slide through the wall the mover went around. Nothing reads it
  // but the animation, and a command without it still lands correctly.
  //
  // `granted` is a Movement a card handed out rather than one the Opportunity
  // paid for — Hit and Run (276) moves a Mech as its Opportunity *ends*, when
  // there is no Opportunity left to check or to charge.
  | { kind: 'maneuver'; seat: Side; uid: number; to: { col: number; row: number }; facing?: Facing; free?: boolean; granted?: boolean; via?: { col: number; row: number }[] }
  | { kind: 'performAction'; seat: Side; uid: number; actionId: string }
  | { kind: 'overload'; seat: Side; uid: number }
  | { kind: 'playTactic'; seat: Side; uid: number; cardId: string; pick?: string }
  // Nothing in 3.1.4 fixes which way a unit faces as it lands, so the facing is
  // the player's to choose while the placement is still theirs to take back.
  | { kind: 'deployUnit'; seat: Side; uid: number; to: { col: number; row: number }; stance?: Stance; camo?: boolean; facing?: Facing }
  | { kind: 'applyPenetration'; seat: Side; uid: number; targetUid: number; slot: PartSlot | 'main' }
  | { kind: 'applyStatus'; seat: Side; uid: number; targetUid: number; statusId: string; stacks?: number }
  | { kind: 'focus'; seat: Side; uid: number }
  | { kind: 'forceMove'; seat: Side; uid: number; targetUid: number; to: { col: number; row: number }; push?: boolean }
  | { kind: 'spendAmmo'; seat: Side; uid: number; actionId: string }
  | { kind: 'restoreAmmo'; seat: Side; uid: number; actionId: string; amount?: number }
  // The Round Tokens an Intercept X Part carries (4.9). They are spent, never
  // regained; the restore is an undo for a misclick, which a networked table
  // needs to travel like anything else that changes a shared number.
  | { kind: 'spendIntercept'; seat: Side; uid: number; actionId: string }
  | { kind: 'restoreIntercept'; seat: Side; uid: number; actionId: string }
  // A Part's Charge Token turned face-up or back down (4.14). Which Parts hold
  // one is a shared fact, so the flip has to travel like Ammo does.
  | { kind: 'setCharge'; seat: Side; uid: number; slot: string; on: boolean }
  | { kind: 'recordKill'; seat: Side; uid: number; targetUid: number; what: 'part' | 'unit' }
  | { kind: 'destroyTerrain'; seat: Side; uid: number; pieces: string[] }
  // A Black Box changing hands (5.3.1). Picking one up is optional and happens
  // as a unit's Movement passes through its Grid; the route itself stays with
  // the move UI, the way it does for `maneuver`. `slot` is the Freehand Part
  // that carries it, and that Part's Freehand counts as spent while it does.
  | { kind: 'takeBlackBox'; seat: Side; uid: number; itemId: string; slot: string }
  // Dropped when the bearer is Penetrated, and it is the ATTACKER who says
  // where it lands — hence a seat that is not the bearer's. `uid` is the
  // attacker, for attribution only: it may be a Projectile that is already
  // spent by the time the Grid is chosen, so this one is actor-optional.
  | { kind: 'dropBlackBox'; seat: Side; uid: number; itemId: string; to: { col: number; row: number } }
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
  // An Electronic Counter-roll (4.11.2). Both sides roll their own Electronic
  // Value in Yellow dice and either may Focus, so it cannot be driven from one
  // chair: each seat submits its own faces, and both clients derive the verdict.
  | { kind: 'startCounterRoll'; seat: Side; uid: number; actionId: string; targetUid: number }
  | { kind: 'rollCounter'; seat: Side; uid: number; faces: number[]; focused?: boolean }
  | { kind: 'clearCounterRoll'; seat: Side }
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
  // A whole squad arriving at the table, as data rather than as a local
  // mutation, so both ends of a wire mint the same units.
  | { kind: 'importSquad'; seat: Side; name?: string; mechs: { name?: string; loadout: MechLoadout }[]; drones: { cardId: string; backpack?: string }[] }
  // The table itself: map, zones, mission and scale used to be local
  // mutations, which is why a host's picks never reached the guest. Tasks
  // ride in the command pre-derived, like dials ride in a reveal.
  | { kind: 'configureTable'; seat: Side; map?: string; zoneSet?: string; mission?: string | null; tasks?: GameState['tasks']; scale?: GameState['scale']; roundLimit?: number }
  | { kind: 'startMatch'; seat: Side }
  | { kind: 'endMatch'; seat: Side }
  // A squad's open-information Secondary Task pick (3.1.3). The seat is the
  // side choosing, so a player can only ever pick their own.
  | { kind: 'pickSecondary'; seat: Side; cardId: string }
  // Naming the Mech or the Tactical Zone a Task is about. `seat` is whoever
  // makes the choice, which is not always whose Task it is — Behead has the
  // opponent name one of their own — so `for` carries the squad that scores it.
  | { kind: 'designateTask'; seat: Side; what: 'target' | 'zone' | 'leader'; for?: Side; uid?: number; zone?: string }
  // A seat declaring itself ready in the lobby, so the host cannot start
  // while the other player is still reading the battlefield.
  | { kind: 'setReady'; seat: Side; ready: boolean }
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

function interceptMax(data: GameData, t: Token, actionId: string): number | undefined {
  const a = tokenCards(data, t).flatMap(({ card }) => card.actions ?? []).find((x) => x.id === actionId);
  return a ? interceptCapacity(a) : undefined;
}

// Large-grid Manhattan distance, the only reach test an Electronic Warfare
// Action needs (4.11.1).
function gridRange(a: Token, b: Token): number {
  return Math.abs(Math.floor(a.col / 3) - Math.floor(b.col / 3)) + Math.abs(Math.floor(a.row / 3) - Math.floor(b.row / 3));
}

// A Part may hold a Charge Token only if one of its own Actions spends one.
function chargeable(data: GameData, t: Token, slot: string): boolean {
  return tokenCards(data, t).some(
    ({ slot: s, card }) => s === slot
      && (t.partStates[s as PartSlot | 'main'] ?? 'intact') !== 'destroyed'
      && (card.actions ?? []).some((a) => consumesCharge(a)),
  );
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
function actorOptional(cmd: Command): cmd is Command & { kind: 'forceMove' | 'recordKill' | 'destroyTerrain' | 'resolveIntercept' | 'dropBlackBox' } {
  return cmd.kind === 'forceMove' || cmd.kind === 'recordKill' || cmd.kind === 'destroyTerrain'
    || cmd.kind === 'resolveIntercept' || cmd.kind === 'dropBlackBox';
}

// The round track, the pre-game stages, the smoke and intercept books, the
// designation loop's pass and the End Phase checklist belong to the table, not
// to a unit, so these carry a seat and nothing else.
type TableKind =
  | 'advancePhase' | 'setPhase' | 'resetRounds' | 'adjustCommandTokens' | 'passTurn' | 'markEndStep' | 'award'
  | 'lockMap' | 'rollSetup' | 'acceptRoll' | 'pickEdge' | 'lockDials' | 'finishDeployment'
  | 'queueIntercepts' | 'clearIntercepts' | 'placeSmoke' | 'removeSmoke' | 'dissipateSmoke'
  | 'clearCounterRoll'
  | 'setMode' | 'handOver' | 'setStrict' | 'commitTimings' | 'revealTimings' | 'importSquad'
  | 'configureTable' | 'startMatch' | 'endMatch' | 'pickSecondary' | 'setReady' | 'designateTask';
const TABLE_KINDS = new Set<Command['kind']>([
  'advancePhase', 'setPhase', 'resetRounds', 'adjustCommandTokens', 'passTurn', 'markEndStep', 'award',
  'lockMap', 'rollSetup', 'acceptRoll', 'pickEdge', 'lockDials', 'finishDeployment',
  'queueIntercepts', 'clearIntercepts', 'placeSmoke', 'removeSmoke', 'dissipateSmoke',
  'clearCounterRoll',
  'setMode', 'handOver', 'setStrict', 'commitTimings', 'revealTimings', 'importSquad',
  'configureTable', 'startMatch', 'endMatch', 'pickSecondary', 'setReady', 'designateTask',
]);

// Table commands whose seat is attribution rather than a choice one squad
// owns. Networked, they are stamped with the sender's own seat, because the
// relay refuses anything sent as the other player — a guest advancing the
// phase with a hard-coded 's1' would apply locally and silently never travel.
const ATTRIBUTED = new Set<Command['kind']>([
  'advancePhase', 'setPhase', 'resetRounds', 'markEndStep', 'award',
  'lockMap', 'acceptRoll', 'lockDials', 'finishDeployment',
  'queueIntercepts', 'clearIntercepts', 'placeSmoke', 'removeSmoke', 'dissipateSmoke',
  'setMode', 'setStrict', 'adjustCommandTokens', 'designateTask', 'clearCounterRoll',
  'configureTable', 'startMatch', 'endMatch',
]);
function tableLevel(cmd: Command): cmd is Command & { kind: TableKind } {
  return TABLE_KINDS.has(cmd.kind);
}

// The lookup the zone-control judgement reads its Grids from.
const zoneCells = (data: GameData) => (zone: string): string[] => data.zoneData.zones.find((z) => z.id === zone)?.cells ?? [];

// The first clear square for a newly arrived unit, scanning row by row from
// the squad's own edge — Squad 1 from the top of the board, Squad 2 from the
// bottom, the same orientation the interactive spot-finder uses. Pure function
// of the state, because a mirrored seat must land the unit on the same Grid.
const CELLS = 36;
function freeSpot(state: GameState, size: number, side: Side, aerial: boolean): { col: number; row: number } | null {
  const rows = [...Array(CELLS - size + 1).keys()];
  if (side === 's2') rows.reverse();
  for (const row of rows) {
    for (let col = 0; col <= CELLS - size; col++) {
      const clash = state.tokens.some(
        (t) =>
          t.deployed !== false
          && t.aerial === aerial
          && col < t.col + t.size && t.col < col + size
          && row < t.row + t.size && t.row < row + size,
      );
      if (!clash) return { col, row };
    }
  }
  return null;
}

function checkTable(data: GameData, state: GameState, cmd: Command & { kind: TableKind }): CheckResult {
  switch (cmd.kind) {
    case 'configureTable': {
      if (cmd.map === undefined && cmd.zoneSet === undefined && cmd.mission === undefined
        && cmd.tasks === undefined && cmd.scale === undefined && cmd.roundLimit === undefined) {
        return no('Nothing to configure.');
      }
      if (cmd.scale !== undefined && !['skirmish', 'standard', 'large'].includes(cmd.scale as string)) return no('That is not a battle scale.');
      if (cmd.roundLimit !== undefined && (!Number.isInteger(cmd.roundLimit) || cmd.roundLimit < 1 || cmd.roundLimit > 12)) return no('That is not a game length.');
      // The battlefield is fixed once the game starts (3.1.2).
      if ((cmd.map !== undefined || cmd.zoneSet !== undefined || cmd.mission !== undefined)
        && battlefieldLocked(normaliseSetup(state.setup))) {
        return no('The battlefield is locked once the game starts (3.1.2). End the game to change it.');
      }
      return ok;
    }
    case 'startMatch': {
      if (normaliseSetup(state.setup)) return no('A game is already running. End it before starting another.');
      // Across a table, the other player has to have said they are ready. A
      // disabled button is a hint, not a rule: the rule lives here, where both
      // clients run it and neither can start the game on the other's behalf.
      if (getLocalSeat()) {
        const other: Side = cmd.seat === 's1' ? 's2' : 's1';
        if (!state.ready?.[other]) return no('The other player has not pressed Ready yet.');
      }
      return ok;
    }
    case 'endMatch': {
      if (!normaliseSetup(state.setup)) return no('No game is running.');
      return ok;
    }
    case 'pickSecondary': {
      if (!(data.secondary ?? []).some((c) => c.id === cmd.cardId)) return no('That is not a Secondary Task card.');
      return ok;
    }
    case 'designateTask': {
      const owed = taskDesignations(data, state);
      const forSide: Side = cmd.for ?? cmd.seat;
      const want = owed.find((d) => d.side === forSide && d.what === cmd.what);
      if (!want) return no('Nothing is waiting to be named for that Task.');
      // The card decides who chooses. Naming on someone else's behalf is how a
      // player would hand themselves an easy target.
      if (want.by !== cmd.seat) return no('That choice belongs to the other player.');
      if (cmd.what === 'zone') {
        if (!missionZones(data, state).some((z) => z.id === cmd.zone)) {
          return no('That is not a Tactical Zone on this battlefield.');
        }
        return ok;
      }
      const t = state.tokens.find((x) => x.uid === cmd.uid);
      if (!t || t.kind !== 'mech') return no('That is not a Mech.');
      if (t.side !== want.owner) return no(`${want.label} names one of the other squad's Mechs.`);
      return ok;
    }
    case 'setReady': {
      // Two moments wait on a ready signal: the lobby before launch, and the
      // deployment stage, where "Begin Round 1" needs both squads to agree.
      const su = normaliseSetup(state.setup);
      if (su && su.stage !== 'deploy') return no('Nothing is waiting on a ready signal right now.');
      return ok;
    }
    case 'importSquad': {
      const mechs = Array.isArray(cmd.mechs) ? cmd.mechs : [];
      const drones = Array.isArray(cmd.drones) ? cmd.drones : [];
      if (!mechs.length && !drones.length) return no('The squad is empty.');
      for (const m of mechs) {
        if (!m.loadout?.torso && !m.loadout?.chasis) return no('A Mech needs at least a Torso or a Chassis.');
        for (const id of Object.values(m.loadout ?? {})) {
          if (id && !data.byId.get(id)) return no(`The database has no card "${id}", so this squad cannot be built.`);
        }
      }
      for (const d of drones) {
        if (!data.byId.get(d.cardId ?? '')) return no(`The database has no card "${d.cardId}", so this squad cannot be built.`);
        if (d.backpack && !data.byId.get(d.backpack)) return no(`The database has no card "${d.backpack}", so this squad cannot be built.`);
      }
      // In a running game a squad joins before deployment closes (3.1.4).
      // "Running" is what the round tracker calls it — a setup block exists.
      // End game clears the setup but leaves the script standing, so the
      // script alone must not lock a table that has gone back to free play.
      const su = normaliseSetup(state.setup);
      if (su && su.stage === 'done') {
        return no('Squads join before deployment is finished (3.1.4). End the game to change the table freely.');
      }
      return ok;
    }
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
      // Locking the battlefield is a step inside setup, so there has to be a
      // setup to be inside. Without this the command conjures one, which makes
      // it a second way to start a match — one that answers to none of the
      // agreements the real one does.
      if (!su) return no('No game is running.');
      if (su.stage !== 'map') return no('The battlefield is already locked (3.1.2).');
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
      // Both squads confirm before Round 1 begins, and the confirmation is
      // checked here rather than only drawn in the panel, so neither player
      // can push the other out of deployment.
      if (getLocalSeat() && !(state.ready?.s1 && state.ready?.s2)) {
        return no('Both squads confirm their deployment before Round 1 begins.');
      }
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
    case 'clearCounterRoll': {
      if (!state.script?.counter) return no('No Electronic Counter-roll is open.');
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

// The Tactical Zones this battlefield actually has: the Main Task places them,
// so anything else would be naming a place neither player can see.
export function missionZones(data: GameData, state: GameState): { id: string; name: string }[] {
  const mission = state.mission ? data.missions.cards.find((m) => m.id === state.mission) : undefined;
  const placed = new Set(mission?.zones ?? []);
  return (data.zoneData?.zones ?? []).filter((z) => placed.has(z.name) || placed.has(z.id));
}

// Everything Task Setup is still waiting to have named, and who names it.
export function taskDesignations(data: GameData, state: GameState): Designation[] {
  const mission = state.mission ? data.missions.cards.find((m) => m.id === state.mission) : undefined;
  return pendingDesignations(normaliseTasks(state.tasks), data.secondary ?? [], mission, state.tokens);
}

export function check(data: GameData, state: GameState, cmd: Command): CheckResult {
  if (tableLevel(cmd)) return checkTable(data, state, cmd);
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
    case 'dropBlackBox': {
      const box = normaliseTasks(state.tasks).items.find((i) => i.id === cmd.itemId);
      if (!box || box.kind !== 'blackbox') return no('That is not a Black Box.');
      if (box.bearerUid === undefined) return no('That Black Box is already on the board.');
      const bearer = state.tokens.find((x) => x.uid === box.bearerUid);
      if (!bearer) return no('Whatever was carrying that Black Box has left the board.');
      const { col, row } = cmd.to;
      if (!Number.isInteger(col) || !Number.isInteger(row) || col < 0 || row < 0 || col > 35 || row > 35) {
        return no('That is not a place on the board.');
      }
      // "In contact with the bearer's base" is the Grid it stands in or one
      // touching it, diagonals included (5.3.1).
      const near = Math.max(Math.abs(Math.floor(col / 3) - Math.floor(bearer.col / 3)), Math.abs(Math.floor(row / 3) - Math.floor(bearer.row / 3)));
      if (near > 1) return no(`A dropped Black Box lands in contact with ${bearer.label}'s base (5.3.1).`);
      return ok;
    }
  }
}

function checkActed(
  data: GameData,
  state: GameState,
  cmd: Exclude<Command, { kind: 'forceMove' | 'recordKill' | 'destroyTerrain' | 'resolveIntercept' | 'dropBlackBox' | TableKind }>,
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
      // A Movement a card handed out belongs to the card, not to an Action
      // Opportunity: Hit and Run moves a Mech as its Opportunity ends, when
      // there is no longer one to check against or to charge.
      if (cmd.granted) return ok;
      const o = oppOf(state, cmd.uid);
      if (!o) return no('It is not this Mech\'s Action Opportunity.');
      // A free move rides on an Action that has already been performed; without
      // one there is nothing that could have moved the unit.
      if (cmd.free) {
        return o.performed.length ? ok : no('No Action has been performed this Opportunity, so there is nothing to move with.');
      }
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
      const su = normaliseSetup(state.setup);
      if (!su || su.stage !== 'deploy') {
        return no(t.deployed !== false ? `${t.label} is already on the board.` : 'Units are placed in the deployment stage of setup (3.1.4).');
      }
      // A unit already down may be nudged until deployment closes; only a
      // fresh placement spends the alternation turn (3.1.4).
      if (t.deployed === false && deployTurn(state, su) !== cmd.seat) return no('It is the other squad\'s turn to place a unit (3.1.4).');
      // Tasks come before deployment (3.1.3 then 3.1.4). Across a table that
      // ordering has to be a rule rather than a drawn panel, or the First
      // Player could take an edge and start placing while the other squad
      // never got the chance to choose one.
      if (getLocalSeat() && t.deployed === false) {
        const picked = normaliseTasks(state.tasks).secondary;
        if (!picked.s1 || !picked.s2) return no('Both squads pick a Secondary Task before anything deploys (3.1.3).');
        // A Task that names a Mech or a Zone is not set up until it has, and
        // naming it after seeing where everything stands would be choosing
        // with the board in front of you.
        if (taskDesignations(data, state).length) {
          return no('Every Task names its Mech or Zone before anything deploys (5.2.3).');
        }
      }
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
    case 'takeBlackBox': {
      // A Low Value Unit may never interact with a Task Item (p.82), and a
      // Projectile is always one.
      if (t.kind === 'projectile') return no('A Projectile never picks up a Black Box.');
      const tasks = normaliseTasks(state.tasks);
      const box = tasks.items.find((i) => i.id === cmd.itemId);
      if (!box || box.kind !== 'blackbox') return no('That is not a Black Box.');
      if (box.bearerUid !== undefined) {
        return box.bearerUid === t.uid
          ? no(`${t.label} is already carrying that Black Box.`)
          : no('Another unit is already carrying that Black Box.');
      }
      if (box.col === undefined || box.row === undefined) return no('That Black Box is not on the board.');
      // A Part already bearing one has its Freehand treated as invalid (5.3.1),
      // so a Part can only ever hold a single Box.
      const taken = tasks.items.filter((i) => i.bearerUid === t.uid && i.bearerSlot).map((i) => i.bearerSlot!);
      const hands = freehandSlots(data, t, taken);
      if (!hands.length) {
        return no(`${t.label} has no free Freehand Part. Carrying a Black Box needs one, and a Part already holding one does not count (5.3.1).`);
      }
      if (!hands.some((h) => h.slot === cmd.slot)) return no('That Part cannot carry a Black Box.');
      return ok;
    }
    case 'spendIntercept': {
      const held = t.intercept?.[cmd.actionId];
      if (held === undefined) return no('That Action carries no Interception Tokens.');
      if (held < 1) return no('Every Interception Token on that Part is spent, and they are never restored (4.9).');
      return ok;
    }
    case 'restoreIntercept': {
      const held = t.intercept?.[cmd.actionId];
      if (held === undefined) return no('That Action carries no Interception Tokens.');
      const max = interceptMax(data, t, cmd.actionId);
      if (max !== undefined && held >= max) return no('That Part still holds every Interception Token it started with.');
      return ok;
    }
    case 'startCounterRoll': {
      const target = state.tokens.find((x) => x.uid === cmd.targetUid);
      if (!target) return no('That target is not on the board.');
      if (target.side === t.side) return no('An Electronic Attack is made against an enemy Unit (4.11.1).');
      if (state.script?.counter) return no('An Electronic Counter-roll is already open.');
      const a = findAction(data, state, cmd.uid, cmd.actionId);
      if (!a) return no('This unit has no such Action.');
      // Range only: Electronic Warfare ignores Terrain and line of sight
      // entirely (4.11.1), so the arc and sight checks a Firing Action needs
      // have no place here.
      const reach = a.range ?? 0;
      if (gridRange(t, target) > reach) return no(`${target.label} is beyond Range ${reach}.`);
      // EV 0 cannot Initiate; EV "-" cannot Respond (4.11.2).
      if (electronicValue(data, t) <= 0) return no(`${t.label} has an Electronic Value of 0, so it cannot Initiate a Counter-roll (4.11.2).`);
      if (electronicValue(data, target) < 0) return no(`${target.label} cannot be the Responder of a Counter-roll (4.11.2).`);
      return ok;
    }
    case 'rollCounter': {
      const c = state.script?.counter;
      if (!c) return no('No Electronic Counter-roll is open.');
      if (cmd.uid !== c.initiatorUid && cmd.uid !== c.responderUid) return no('That unit is not in this Counter-roll.');
      if (!Array.isArray(cmd.faces) || cmd.faces.some((f) => !Number.isInteger(f) || f < 0)) return no('That is not a roll.');
      const mine = cmd.uid === c.initiatorUid ? c.initRoll : c.respRoll;
      const focused = cmd.uid === c.initiatorUid ? c.initFocused : c.respFocused;
      // A first roll, or one Focus reroll: Focus costs Link and the Link spend
      // is its own command, so this only guards against a free second roll.
      if (mine && !cmd.focused) return no('That unit has already rolled.');
      if (cmd.focused && (!mine || focused)) return no('Focus rerolls a roll that has been made, and only once here.');
      return ok;
    }
    case 'setCharge': {
      if (!chargeable(data, t, cmd.slot)) return no('That Part has no Action that spends a Charge Token (4.14).');
      const already = (t.charge ?? []).includes(cmd.slot);
      if (cmd.on && already) return no('That Part is already Charged, and a Charged Action cannot be Charged again until the token is spent (4.14).');
      if (!cmd.on && !already) return no('That Part is not holding a Charge Token.');
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
  if (cmd.kind === 'importSquad') {
    const su = normaliseSetup(state.setup);
    const staging = !!su && su.stage !== 'done';
    // The first list a side brings names it. Topping up afterwards leaves the
    // name alone — adding one mech should not rename the whole squad.
    if (cmd.name && !state.sideNames?.[cmd.seat]) {
      state.sideNames = { ...(state.sideNames ?? {}), [cmd.seat]: cmd.name };
    }
    const facing: Facing = cmd.seat === 's1' ? 2 : 0;
    const arrive = (tok: Token) => {
      if (staging) {
        // Setup is running, so the unit joins the squad rather than the board
        // and goes through the 3.1.4 deployment alternation like everything.
        tok.deployed = false;
      } else {
        // The open table places it straight away, on the first clear spot from
        // the squad's own edge. Terrain-blind on purpose: a mirrored placement
        // only has to agree on both clients, and free play lets the owner drag
        // it from there — the careful spot-finding stays with the local UI.
        const spot = freeSpot(state, tok.size, cmd.seat, tok.aerial);
        if (spot) { tok.col = spot.col; tok.row = spot.row; }
        else tok.deployed = false;
      }
      state.tokens.push(tok);
    };
    for (const m of (Array.isArray(cmd.mechs) ? cmd.mechs : [])) {
      arrive({ ...makeMechToken(state, data, m.loadout, cmd.seat, m.name), col: 0, row: 0, facing } as Token);
    }
    for (const d of (Array.isArray(cmd.drones) ? cmd.drones : [])) {
      const card = data.byId.get(d.cardId);
      if (!card) continue;
      arrive({ ...makeDroneToken(state, data, card, cmd.seat, d.backpack), col: 0, row: 0, facing } as Token);
    }
    return;
  }
  if (cmd.kind === 'configureTable') {
    // A new battlefield starts whole: the rubble belonged to the old one.
    if (cmd.map !== undefined) {
      state.map = cmd.map;
      state.removedTerrain = [];
    }
    if (cmd.zoneSet !== undefined) state.zoneSet = cmd.zoneSet;
    if (cmd.mission !== undefined) state.mission = cmd.mission;
    if (cmd.tasks !== undefined) state.tasks = cmd.tasks === null ? null : normaliseTasks(cmd.tasks);
    if (cmd.scale !== undefined) state.scale = cmd.scale;
    if (cmd.roundLimit !== undefined) state.roundLimit = cmd.roundLimit;
    return;
  }
  if (cmd.kind === 'startMatch') {
    // The state half of "Start game": both ends of a wire begin the identical
    // match. Anything already standing goes back to its squad for deployment.
    state.tokens = state.tokens.filter((t) => t.kind !== 'projectile');
    for (const t of state.tokens) t.deployed = false;
    state.smoke = [];
    state.round = { n: 1, phase: 0, firstPlayer: 's1' };
    state.commandTokens = { s1: 0, s2: 0 };
    state.setup = newSetup();
    state.script = undefined;
    // Ready flags belong to the lobby that is now over.
    state.ready = {};
    return;
  }
  if (cmd.kind === 'setReady') {
    state.ready = { ...(state.ready ?? {}), [cmd.seat]: cmd.ready };
    return;
  }
  if (cmd.kind === 'pickSecondary') {
    const tasks = normaliseTasks(state.tasks);
    tasks.secondary[cmd.seat] = cmd.cardId;
    // Changing the card drops whatever the old one had named, so a Task never
    // carries a target chosen for a different card.
    tasks.secTarget[cmd.seat] = undefined;
    tasks.zone[cmd.seat] = undefined;
    state.tasks = tasks;
    return;
  }
  if (cmd.kind === 'designateTask') {
    const tasks = normaliseTasks(state.tasks);
    const forSide: Side = cmd.for ?? cmd.seat;
    if (cmd.what === 'zone') tasks.zone[forSide] = cmd.zone;
    else if (cmd.what === 'leader') tasks.leader[forSide] = cmd.uid;
    else tasks.secTarget[forSide] = cmd.uid;
    state.tasks = tasks;
    return;
  }
  if (cmd.kind === 'endMatch') {
    // The state half of "End game"; the result dialog and the recording offer
    // stay with the UI, which runs them before this lands.
    for (const t of state.tokens) t.deployed = undefined;
    state.setup = null;
    state.tasks = null;
    state.removedTerrain = [];
    state.tokens = state.tokens.filter((t) => t.kind !== 'projectile');
    state.smoke = [];
    state.tacticsPlayed = { s1: [], s2: [] };
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
    // A tie sends both squads back to the dice (3.1.2), so the first re-roll
    // clears the other side's stale total rather than being compared against
    // it — otherwise one player re-rolling alone would decide the tie.
    const tied = !!su.rolls.s1.length && !!su.rolls.s2.length && !firstPlayerFrom(su);
    const other: Side = cmd.seat === 's1' ? 's2' : 's1';
    su.rolls = { ...su.rolls, [cmd.seat]: cmd.hits };
    if (tied) su.rolls = { ...su.rolls, [other]: [] };
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
    // The deployment agreement is consumed; a fresh one is minted per stage.
    state.ready = {};
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
  if (cmd.kind === 'clearCounterRoll') {
    if (state.script) state.script.counter = null;
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
  // Above the actor lookup: the attacker who chose the Grid may be a Projectile
  // that is already spent by the time this lands.
  if (cmd.kind === 'dropBlackBox') {
    const tasks = normaliseTasks(state.tasks);
    const box = tasks.items.find((i) => i.id === cmd.itemId);
    if (!box) return;
    box.bearerUid = undefined;
    box.bearerSlot = undefined;
    box.col = cmd.to.col;
    box.row = cmd.to.row;
    state.tasks = tasks;
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
      // A Movement Action already paid with an Action Tick, and one a card
      // handed out was never charged to the Opportunity at all.
      if (o && sc && !cmd.free && !cmd.granted) sc.opp = spendManeuver(o);
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
      const fresh = t.deployed === false;
      t.col = cmd.to.col;
      t.row = cmd.to.row;
      // Facing its own table edge is the default; a player who turned it before
      // confirming gets the way they pointed it.
      t.facing = cmd.facing ?? (t.side === 's1' ? 2 : 0);
      t.deployed = true;
      // A Mech picks its Stance as it lands; anything else keeps its printed one.
      if (t.kind === 'mech' && cmd.stance) t.stance = cmd.stance;
      if (cmd.camo) t.statuses = addStatus(t.statuses, 'camouflage');
      // Nudging a unit already down is not a placement, so the alternation
      // count only moves on the first landing.
      const su = normaliseSetup(state.setup);
      if (su && fresh) {
        su.placed = { ...su.placed, [t.side]: su.placed[t.side] + 1 };
        state.setup = su;
      }
      // Moving a unit after declaring ready withdraws that agreement for
      // everyone — the other player was ready for a different board.
      if (!fresh) state.ready = {};
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
    case 'takeBlackBox': {
      const tasks = normaliseTasks(state.tasks);
      const box = tasks.items.find((i) => i.id === cmd.itemId);
      if (!box) return;
      box.bearerUid = t.uid;
      box.bearerSlot = cmd.slot;
      // Off the board and onto the unit: a carried Box has no square of its own.
      box.col = undefined;
      box.row = undefined;
      state.tasks = tasks;
      return;
    }
    case 'spendIntercept': {
      const bag = t.intercept;
      if (!bag || bag[cmd.actionId] === undefined) return;
      bag[cmd.actionId] = Math.max(0, bag[cmd.actionId] - 1);
      return;
    }
    case 'restoreIntercept': {
      const bag = t.intercept;
      if (!bag || bag[cmd.actionId] === undefined) return;
      const max = interceptMax(data, t, cmd.actionId);
      const next = bag[cmd.actionId] + 1;
      bag[cmd.actionId] = max !== undefined ? Math.min(max, next) : next;
      return;
    }
    case 'startCounterRoll': {
      if (!sc) return;
      sc.counter = {
        initiatorUid: cmd.uid,
        responderUid: cmd.targetUid,
        actionId: cmd.actionId,
        initRoll: null,
        respRoll: null,
        initFocused: false,
        respFocused: false,
      };
      return;
    }
    case 'rollCounter': {
      const c = sc?.counter;
      if (!c) return;
      if (cmd.uid === c.initiatorUid) {
        c.initRoll = [...cmd.faces];
        if (cmd.focused) c.initFocused = true;
      } else if (cmd.uid === c.responderUid) {
        c.respRoll = [...cmd.faces];
        if (cmd.focused) c.respFocused = true;
      }
      return;
    }
    case 'setCharge': {
      // Absent rather than empty when nothing is Charged, which is what
      // migrateState writes back and what isCharged reads.
      const held = new Set(t.charge ?? []);
      if (cmd.on) held.add(cmd.slot);
      else held.delete(cmd.slot);
      t.charge = held.size ? [...held] : undefined;
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
      const gone = state.tokens.find((x) => x.uid === cmd.targetUid);
      state.tokens = state.tokens.filter((x) => x.uid !== cmd.targetUid);
      // A side emptied of units keeps no squad name, so the next list brought
      // in gets to name it. Only ever true in the lobby.
      if (gone && state.sideNames?.[gone.side]
        && !state.tokens.some((x) => x.side === gone.side && x.kind !== 'projectile')) {
        delete state.sideNames[gone.side];
      }
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
  // Attribution seats are stamped with the sender's own seat when networked,
  // so a table command clicked from either chair both applies and travels.
  const me = getLocalSeat();
  if (me && ATTRIBUTED.has(cmd.kind) && cmd.seat !== me) cmd = { ...cmd, seat: me };
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
