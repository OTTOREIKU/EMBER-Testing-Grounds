import { ammoAvailable, ammoHolder, ammoPay, checkAfter, liveIntercepts, rebootOwed, rebootWhy, clearDroneCommands, missionZones, readyCommands, seedCommandTokens, strictNow, taskDesignations, type Command, type CheckResult, swarmFor } from './commands';
import { choiceDialog, confirmDialog } from './dialog';
import { askIssuer, askTowFacing, asterBlockers, offerCoordination, offerHarpyDrag, runAster } from './commandpick';
import type { GameData } from './data';
import { actionIconUrl, cardName, parseGridRef, secondaryImageUrl, squadLabel, environmentLookup, environmentAllowance } from './data';
import { showInspect } from './inspector';
import { Board, footprint, snapPlacement, type BoardCallbacks } from './board';
import { printedDeployment, resolveZoneSetData } from './overlays';
import { interceptHeld, allyRepairTargets, overwatchOf, explosionCamo, detonationBar, immediatesOwed, blastScanState, chassisStop, blastTurn, blastsReady, bitPortOf, bitsToRecover, coordinationAfterManeuver, controlledMoveActions, actionRange, chargeChoices, stanceFeedbackOf, stanceFeedbackTargets, overloadPackOn, cruising, transformOffer, opportunityBonusOn, ripostePart, martyrdomOwed, targetTracingOn, immobilizedStop, activatesCamo, isScanAction, scanStrips, formSwitch, envCardAt, isGroundUnit, stealthValue, manifestationRange, manifestTargets, immediateDetonation, coordinationFor, coordinationOnOpportunityEnd, autoDetonationsOwed, containerTargets, blinkTargets, camoBrokenBy, isAirborneAction, isPositionSwap, loanedParts, minesLayable, minesOwed, pilotCard, unfoldsOwed, type MineLaying, type MineTrigger, extrasFor, SLOT_LABEL, repairSpec, actionSilenceDenier, isSilentAction, maneuverIsSilent, type AuraSource, canActivateCamo, chargeableSlots, electronicStrength, electronicValue, explosionScope, extraActivationOf, freehandSlots, guidedActions, initiativeFor, interceptCapacity, interceptLeft, interceptOwedAt, projectileReach, isChargeAction, isElectronicAttack, knockbackOf, maneuverRange, needsSightToLanding, resupplyOf, smokePlacement, squadAllegiance, type ExtraActivation, type Resupply, discardSlots, chassisGone, riposteMelees } from './units';
import { ElectronicHelper, type EwAct, type EwArg } from './combat';
import { contestAct as sendContestAct, counterResponder as contestResponder } from './contest';
import { tacticFitsPhase, tacticSpec, tacticTargets, tacticUsedRound, tacticWindowWhy, type TacticCtx } from './tactics';
import { smokePerGroup, syncSeason } from './season';
import { handIds, saltFor } from './tactichand';
import { boxDropCellIn, boxDropCells, inContact, canStandIn, attackDirection, crushEscapeGrids, crushExchange, crushExchangeSpots, crushTargets, dissipationFor, largeGridOf, boardGrids, setBoardGrids, losBetween, firingSight, losNote, smokeBlocks, pathCost, rangeBetween, reachableGrids, standingSpot, mineSpot, type LargeGrid } from './rules';
import { breakAwayNote, canBeForceMoved, crawlHolders, tetherNote } from './melee';
import { factionColour, ICON_DICE, linkIcon, squadColour } from './icons';
import { iconSvg } from './dice';
import { ensureScript, enterPhase, glueAfter as glueCore, makeInit, opportunity } from './glue';
import type { PartSlot, CardAction, CounterRoll, DiceData, DieColor, Facing, GameState, RollbackPoint, ScriptState, Side, Stance, TerrainPiece, Timing, Token, ExtraTick, Opportunity } from './types';
import { isLineUnit, statusCount, gridsOf, newOpportunity, newScriptState, PHASES, removableTokens, STATUSES, TIMINGS, zonesOf } from './types';
import { deployable, deployTurn, deploymentComplete, firstPlayerFrom, normaliseSetup, rollTotal, type SetupState } from './setup';
import { actionPhaseComplete, activationOrder, alive, canAct, eligibleUnits, isLoopPhase, loopComplete, nextActivation, nextTurn, tiedChoices, type InitLookup, type LoopPhase } from './loop';
import { actionIdOf, actionPipCount, canAttackMode, canManeuver, canOverload, costLabel, extrasLeft, grantHolds, LENGTH_NAME, lengthOf, OVERLOAD_MAX, whyGrantLapsed } from './ticks';
import { boxHands, boxPlaceTurn, deployGrids, deployOpenGrids, gameResult, normaliseTasks, TERMINAL_UID, terminalsInReach, zoneCentreGrid, type Designation, type ScoreResult } from './tasks';
import { gameEndsThisRound, lowValueOf, previewScore, zoneCellsOf } from './scoring';
import type { NoticeKind } from './notices';
import { firewatchOn, targetStatusGrant, targetStatusTargets, linkShockOf, tetheredBy, armorPiercing, armorPiercingNote, automaticShieldFor, canAffordFocus, grantAdjusted, shockAttackOf, shockMoveAllowed, stationaryAdjusted, twoHandedUse, tokenCards, vpRiderFor, straightLineBonus, selfStatusGrant, selfGrantWhy, linkTickTraitOn, isElectronicSupport, linkSupportOf, linkSupportTargets, maxLink, stabiliseAsk, stabiliseRowLabel, STABILISE_KEEP_LABEL, tokenCleanupOf, tokenCleanupTargets, type LinkSupport, type TokenCleanup } from './units';
import * as turn from './turn';
import type { Thought } from './solo';

// The in-match HUD (Match Centre part 3a): one question at a time, per seat.
// Everything here renders from the shared GameState and issues the same
// commands the board page does; the board drawing is an honest schematic and
// the full interactive board is part 3b.

export interface DiceLine {
  seat: Side;
  // What the roll was for, without the squad name — the feed puts that in
  // front, coloured, so the line reads as one sentence.
  label: string;
  // The result, counted rather than written out, so the number can carry the
  // weight and never gets wrapped away from the word it belongs to.
  result: { n: number; unit: string }[];
  kind: 'hits' | 'pool';
  // The faces that landed, so the feed can show the dice rather than only
  // report a number. Both players are given the same ones.
  dice: { color: string; face: number }[];
  // Rising, so a line that has only just arrived can tumble on screen once and
  // then sit still through every redraw after it.
  n: number;
}

export interface HudCtx {
  data: GameData;
  state: GameState;
  seat: Side | null;
  networked: boolean;
  // The room's code: what a sealed Tactics hand is kept under (tactichand.ts).
  room: string | null;
  send(cmd: Command): CheckResult;
  // Legality without paying for it. An Action that opens a tool is only
  // charged when the tool succeeds, so its cost has to be testable first.
  check(cmd: Command): CheckResult;
  // Rolls n yellow dice (server dice in a room, local in dev): the Hits per
  // die for the command, and the faces so the tray can show them.
  rollHits(n: number, label: string): Promise<{ hits: number[]; dice: { color: string; face: number }[] }>;
  // Rolls an attack pool; the result lands in the shared dice feed.
  rollPool(y: number, r: number, label: string): Promise<void>;
  // Rolls a defence pool and returns the faces — the defender's own button
  // behind the answerDefense handshake. Server dice in a room, so the attacker
  // watches the same faces land.
  rollDefense(white: number, blue: number): Promise<{ color: string; face: number }[]>;
  diceFeed: DiceLine[];
  // Says something in the notice line (notices.ts). The kind decides whether it
  // is shown: a confirmation ('done') is not, the board already shows the move.
  noteNow(text: string, kind?: NoticeKind): void;
  // The local zone-overlay preference: this player's clean board is their
  // own business, so it never crosses the wire.
  zonesOn: boolean;
  toggleZones(): void;
  // Builds the left side panel once the HUD shell exists (the freeplay
  // SquadTracker and Panel bind to ids inside it).
  mountSide(): void;
  // Redraws the side panel and shows a unit's card when one is selected.
  syncSide(uid: number | null): void;
  // True while the shared AttackHelper is resolving an attack, so the turn
  // panel steps out of the way instead of offering the manual buttons beside it.
  combatBusy(): boolean;
  // Points the shared AttackHelper at whatever attack is published, so this
  // client draws the SAME combat window the attacking player is looking at,
  // with the controls that are not theirs disabled rather than missing. Puts it
  // away and answers false when nothing is published, when the view names a
  // unit this client cannot resolve, or when the live helper owns the window.
  syncCombatMirror(): boolean;
  // Opens the §4.4 pipeline on a target the player has just picked. The mode
  // decides what the defender may claim: an ordinary attack reads Terrain and
  // Unit Protection off the board, an Interception grants none and needs no
  // arc or sight (4.9), and an Explosion grants none and ignores facing (4.7.6).
  startAttack(uid: number, actionId: string, targetUid: number, mode?: 'attack' | 'intercept' | 'explosion', opts?: { twoHandedDeclined?: boolean; charged?: boolean; chargeChoice?: string }): void;
  // Brings a side tab forward by name.
  showTab(name: SideTab): void;
  // The printed faces, for drawing the dice a roll landed on.
  diceData: DiceData | null;
  // Keeps the finished game on both accounts. Resolves to null when it landed,
  // or to why it did not — a failure here never stops the table closing.
  recordMatch(): Promise<string | null>;
  refresh(): void;
  // A game against the computer (match.ts startSolo): there is nothing to
  // record and nobody to agree an Undo with, and the game is this page's own
  // to play again or to leave. `thinking` is what the Thinking tab shows
  // (solo.ts thoughtsFor), and `watching` a game two computers play.
  solo?: { again(): void; leave(): void; watching?: boolean; thinking?(): Thought[] };
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ---------- the guide glue ----------
// The deterministic turn bookkeeping lives in glue.ts, shared with the pad's
// guided mode. This page adds the one piece a board needs on top: the smoke
// dissipation queue, which is geometry the pad never has.

export { ensureScript, enterPhase, makeInit } from './glue';

// Runs after any command lands, ours or theirs, so both clients derive the
// same turn bookkeeping without it ever crossing the wire.
export function glueAfter(data: GameData, state: GameState, cmd: Command): void {
  glueCore(data, state, cmd);
  if (!normaliseSetup(state.setup) && cmd.kind !== 'startMatch') return;
  // Smoke dissipation takes the isolated screens off both sides in one
  // judgement and then owes one removal per Connected group, chosen by its
  // owner (4.16). The queue is snapshotted here rather than re-derived, because
  // a removal that splits a group owes nothing further this round - and it is
  // built from the command itself so both seats hold the identical list.
  //
  // Kept in the script, which both seats share and a reload restores, rather
  // than in this page's memory (audit Phase 4, G7).
  const sc = ensureScript(state);
  if (cmd.kind === 'dissipateSmoke') {
    // Under Season 1.04 a group owes three screens, not one: the group rides
    // the queue once per screen owed, and each pick is one of its own screens
    // still standing (smokeOwedCells).
    const per = smokePerGroup(data, state);
    const order: Side[] = state.round.firstPlayer === 's1' ? ['s1', 's2'] : ['s2', 's1'];
    const owed = order.flatMap((side) =>
      dissipationFor(state.smoke ?? [], side, per).groups.flatMap((g) => {
        const cells = g.map((s) => ({ col: s.col, row: s.row }));
        return Array.from({ length: per }, () => ({ side, cells }));
      }),
    );
    sc.smokeOwed = owed.length ? owed : undefined;
  }
  if (cmd.kind === 'removeSmoke' && sc.smokeOwed) {
    const rest = sc.smokeOwed.slice(1);
    sc.smokeOwed = rest.length ? rest : undefined;
  }
  // Leaving the End Phase abandons anything still owed; next round judges the
  // board afresh.
  if (cmd.kind === 'advancePhase' || cmd.kind === 'setPhase' || cmd.kind === 'startMatch' || cmd.kind === 'endMatch') sc.smokeOwed = undefined;
}

// The Connected groups still owing a removal this End Phase (see glueAfter).
function smokeOwedOf(state: GameState): { side: Side; cells: { col: number; row: number }[] }[] {
  return state.script?.smokeOwed ?? [];
}

// The screens of the next owed group still standing: under Season 1.04 one
// group owes three picks, and a screen already taken is not offered again.
// Read in turn.ts, where a seat with no panel reads it too.
function smokeOwedCells(state: GameState): { col: number; row: number }[] {
  return turn.smokeOwedCells(state);
}

// ---------- zones & deployment geometry ----------

// One of FIVE copies of the grid-ref parser; gridref.test.mjs pins them in
// step. A-R / 1-18, the largest board we ship: see the note in data.ts.
function zref(ref: string): { col: number; row: number } | null {
  const m = /^([A-Ra-r])(\d{1,2})$/.exec(ref.trim());
  if (!m) return null;
  return { col: m[1].toUpperCase().charCodeAt(0) - 65, row: Number(m[2]) - 1 };
}

// Board cells (36-grid) of a mission's objective zones, from the Task Items.
export function objectiveCells(data: GameData, s: GameState): { c: number; r: number }[] {
  const tasks = normaliseTasks(s.tasks);
  const out: { c: number; r: number }[] = [];
  for (const item of tasks.items) {
    const zone = zonesOf(data.zoneData.zones, s).find((z) => z.id === item.zone);
    for (const cell of zone?.cells ?? []) {
      const p = zref(cell);
      if (p) for (let dc = 0; dc < 3; dc++) for (let dr = 0; dr < 3; dr++) out.push({ c: p.col * 3 + dc, r: p.row * 3 + dr });
    }
  }
  return out;
}

// Where a squad deploys and which way a unit lands facing are read in turn.ts
// (deployCellsFor, zoneCentre, deployFacing), which the seat seam asks too.
export const deployCellsFor = turn.deployCellsFor;
const zoneCentre = turn.zoneCentre;
export const deployFacing = turn.deployFacing;

// ---------- module UI state ----------

let placing: number | null = null; // uid being deployed via board clicks
// The Environment Card waiting for a Grid, or null. Only ever set while setup
// is running: the battlefield is settled before Round 1 and stays settled.
let envArm: string | null = null;
// Where this player has put a unit but not yet confirmed it. Nothing is sent
// and nothing lands on the board until they do, so the turn stays theirs.
let pending: { uid: number; col: number; row: number; size: 1 | 2 | 3; facing: Facing } | null = null;
// The Stance a Mech lands in, and whether it lands hidden. Chosen before the
// placement is confirmed, because both travel with it.
let deployStance: Stance = 'offensive';
let deployCamo = false;
// A route being drawn, exactly as the freeplay board does it: traced by the
// cursor so a deliberate zigzag is expressible, clicked to lock, confirmed
// from the turn panel. The engine only ever sees the destination.
let movePlan: {
  uid: number;
  side: Side;
  steps: number;
  flying: boolean;
  // An Ojs200 lends its Mech Flying Movement on the MANEUVER and says "may", so
  // this move can be flown or walked and the panel offers the switch. A Fairy
  // pair grants it outright instead, which sets `flying` and leaves this false.
  flightOptional?: boolean;
  path: LargeGrid[];
  // What is being spent: the Maneuver Tick by default, or a named Movement
  // Action, which carries its own Range and may owe a shove at the end of it.
  label: string;
  // How long `path` was after each click; marks[0] is the unit's own Grid, so
  // popping one is Back and there is always a floor.
  marks: number[];
  // The candidate under the cursor: drawn dashed, never committed until a click.
  preview: LargeGrid[] | null;
  // ZHDR-304 Harpy: the Ally being towed and the Mech whose Command Token pays,
  // declared before the route was drawn (the -2 already came off `steps`).
  drag?: { allyUid: number; funderUid: number };
  shoveActionId?: string;
  // Shock Attack: the walk happens BEFORE the strike, so once this move lands
  // the attack targeting for the named Action reopens. Rides the plan the way
  // shoveActionId does, and through a Crush the same way.
  attackAfter?: { actionId: string; refund?: { uid: number; slot: string; choice?: string } };
  // The Movement Action this plan is spending, carried so the `maneuver` it
  // sends can name it and the command layer can judge Unstoppable itself.
  actionId?: string;
  // A Movement Action has already paid with an Action Tick, so its move must
  // not also spend the Maneuver Tick.
  free?: boolean;
  // A Movement a Tactics Card handed out, which belongs to no Opportunity.
  granted?: boolean;
  // The rest of a Movement a Mine stopped (ruling I16; audit Phase 5, C1).
  resume?: boolean;
  // Turning on the spot costs no Movement Range but is still Movement, so the
  // facing is chosen inside the Movement and travels with it. A route of no
  // steps and a new facing is a legal Maneuver on its own.
  facing: Facing;
  turned: boolean;
  // The net quarter turns Q and E made: four one way is a full circle, which
  // ends facing where it began and is still a Movement (Supplementary Rules
  // 1.04, 1.8), so the pivot says so to the engine.
  spin: number;
  // The Red Shoes (TM35NA_B): the Mech whose won Counter-roll is steering
  // this ENEMY unit. The move travels as controlledMove from its seat, spends
  // no Tick, and ends in no Crush (audit Phase 3, D3).
  controller?: { uid: number; side: Side };
} | null = null;
// Whose card the Details tab is showing, when the player has asked for one
// rather than taking the active unit's.
let inspectUid: number | null = null;
// The Line of Sight control is on: the board shows what the unit whose card is
// open can see (turn.ts sightOf), or failing one the unit whose turn it is.
let sightOn = false;
// A card asking the board to show what an Action reaches. Held rather than
// drawn once, because every refresh clears the highlight layer.
let rangeOverlay: { uid: number; kind: 'move' | 'range'; n: number } | null = null;

// Drops the ring unless it belongs to the given unit — the selection-change
// hook, so a ring never outlives the card that asked for it. Says whether it
// dropped one, because some callers render BEFORE they sync the side panels
// and owe the board a redraw when the answer is yes.
export function clearRangeOverlayFor(uid: number | null): boolean {
  if (rangeOverlay && rangeOverlay.uid !== uid) {
    rangeOverlay = null;
    return true;
  }
  return false;
}

export function showRangeOverlay(uid: number, kind: 'move' | 'range', n: number): void {
  rangeOverlay = n > 0 ? { uid, kind, n } : null;
  hudRef?.refresh();
}
let keysWired = false;             // the document key handler is installed once
let recording = false;             // a record is being sent
let recorded = false;              // and the server took it
let recordNote: string | null = null;
let secOpen = false;               // the Secondary Task picker overlay
let secFor: Side | null = null;    // whose pick the overlay is making
let secPick: string | null = null; // highlighted card, not yet confirmed

// ---------- pieces ----------

function timelineHtml(s: GameState): string {
  const cells = PHASES.map((p, i) => {
    const cls = i < s.round.phase ? ' done' : i === s.round.phase ? ' now' : '';
    return `<div class="tl${cls}">${p}<b>${i < s.round.phase ? 'done' : i === s.round.phase ? 'now' : '—'}</b></div>`;
  }).join('');
  return `<div class="timeline"><div class="roundchip">R${s.round.n}/${s.roundLimit ?? 5}</div>${cells}</div>`;
}

// THE ACTIVATION ORDER, floating in the board's top-right corner (OTTO,
// 2026-08-20). It used to be in two places at once: this strip along the bottom
// of the board, which pushed the map up when it appeared, and the Activation
// order card above the squads list. The card is now hidden online (squads.ts)
// and this is the single copy, in the same corner freeplay puts its Guide panel
// so the two pages read as one app.
//
// It carries what the CARD had and the strip did not: the initiative number, and
// a tie marker. A tie is the one case where the printed order is not the whole
// answer, so losing it with the card would have cost a real rules warning.
function orderFloatHtml(ctx: HudCtx): string {
  const s = ctx.state;
  if (s.round.phase < 1 || s.round.phase > 2) return '';
  const sc = ensureScript(s);
  const acted = new Set(sc.acted);
  const order = activationOrder(s, makeInit(ctx.data));
  if (!order.length) return '';
  const cur = s.round.phase === 2 ? nextActivation(s, makeInit(ctx.data)) : null;
  // Two Mechs in the same Timing on the same initiative: 3.4.1 puts the First
  // Player's first and alternates the squads, and each squad picks which of
  // its own tied Mechs goes (audit Phase 2, E6). Counted here rather than read
  // off activationOrder, which has ALREADY broken the tie by alternating sides
  // and so no longer shows that there was one to break.
  const tally = new Map<string, number>();
  for (const a of order) {
    if (a.init === undefined) continue;
    const k = `${a.timing}:${a.init}`;
    tally.set(k, (tally.get(k) ?? 0) + 1);
  }
  const chips = order
    .map((a) => {
      const t = s.tokens.find((x) => x.uid === a.uid);
      if (!t) return '';
      const short = TIMINGS.find((x) => x.id === a.timing)?.short ?? '';
      const cls = cur && cur.uid === a.uid && !acted.has(a.uid) ? ' now' : acted.has(a.uid) ? ' past' : '';
      const tie = a.init !== undefined && (tally.get(`${a.timing}:${a.init}`) ?? 0) > 1;
      // A button, because the card's rows were clickable and moving them here
      // must not quietly cost that: this is the fastest way to a unit's card.
      return `<button class="ord ${t.side}${cls}" data-orderchip="${t.uid}" title="${esc(t.label)}: ${short}, initiative ${a.init ?? '?'}">
        <span class="sw"></span><span class="ord-nm">${esc(t.label)}</span>
        <span class="ord-t">${short}</span><span class="ord-i">${a.init ?? '?'}</span>
        ${tie ? '<span class="ord-tie" title="Tied initiative: the First Player\'s Mech goes first, then the squads alternate, and each squad picks which of its own goes">tie</span>' : ''}
      </button>`;
    })
    .join('');
  return `<div class="ordercol">${chips}</div>`;
}

// ---------- the real board, shared with the freeplay page ----------

let board: Board | null = null;
let hudRef: HudCtx | null = null;
// A unit mid-walk. Redrawing the token layer under a running animation kills
// it, so renderBoard leaves the layer alone until the walk is over.
let animatingUid: number | null = null;

// The same reachability the freeplay board offers: Large Grids within the
// unit's Movement Range, terrain-aware, with Break Away and Crush priced the
// same way. The path law lives in the UI on both pages — the engine's
// maneuver trusts the move it is handed.
function terrainOf(ctx: HudCtx) {
  return turn.terrainOf(ctx.data, ctx.state);
}

// `steps` is how far this particular Movement reaches — a Maneuver uses the
// Chassis Value, a Movement Action its own printed Range. Hardcoding the
// Maneuver here drew the Maneuver's reach under a Sprint that could go further,
// so the panel said 4 grids while the board highlighted 1.
// `asFlight` overrides the derivation while a route is being drawn: a Part can
// put a Mech into Flying Movement for this move only, and the highlight has to
// answer to the plan or the toggle would change nothing on the board.
function reachableFor(ctx: HudCtx, t: Token, steps = maneuverRange(ctx.data, t), asFlight?: boolean, actionId?: string) {
  // Read in turn.ts, where the overlay, the route and the seat seam all take a
  // Movement's reach from ONE set of MoveOpts.
  return turn.reachableFor(ctx.data, ctx.state, t, steps, asFlight, actionId);
}

function canReach(ctx: HudCtx, t: Token, col: number, row: number): boolean {
  const c = Math.floor(col / 3);
  const r = Math.floor(row / 3);
  return reachableFor(ctx, t).some((g) => g.c === c && g.r === r);
}

function moveOptsFor(ctx: HudCtx, t: Token, flying: boolean, actionId?: string) {
  return turn.moveOptsFor(ctx.data, ctx.state, t, flying, actionId);
}

// A Maneuver by default. A Movement Action passes its own Range instead: the
// chassis `move` is the Maneuver Value (1–2 Grids) and has nothing to do with a
// Sprint-style Action's printed range, which is usually 4.
function startMovePlan(ctx: HudCtx, t: Token, opts: { range?: number; label?: string; shoveActionId?: string; attackAfter?: { actionId: string; refund?: { uid: number; slot: string; choice?: string } }; actionId?: string; free?: boolean; granted?: boolean; resume?: boolean; maneuver?: boolean; airborne?: boolean; controller?: { uid: number; side: Side } } = {}): void {
  // Whether this unit may make the Movement at all, how far it reaches and
  // whether it is flown are read in turn.ts (moveStart), where a seat with no
  // planner reads them too: Immobilized, Non-humanoid X, the Range, a destroyed
  // Chassis that may only turn (FAQ E4), and flight from a Part or from
  // Anti-Gravity. A refusal is said before a route is drawn.
  const start = turn.moveStart(ctx.data, ctx.state, t, opts);
  if (!start.ok) {
    ctx.noteNow(start.why);
    return;
  }
  movePlan = {
    uid: t.uid,
    side: t.side,
    actionId: opts.actionId,
    steps: start.steps,
    flying: start.flying,
    flightOptional: start.flightOptional,
    path: [{ c: Math.floor(t.col / 3), r: Math.floor(t.row / 3) }],
    marks: [1],
    preview: null,
    label: opts.label ?? 'Maneuver',
    shoveActionId: opts.shoveActionId,
    attackAfter: opts.attackAfter,
    free: opts.free,
    granted: opts.granted,
    resume: opts.resume,
    facing: t.facing,
    turned: false,
    spin: 0,
    controller: opts.controller,
  };
}

// A Shock Attack's strike and a Movement's shove wait for the END of the
// Movement, so when a Mine stops one partway they wait for the Go on (C1).
let haltCarry: { uid: number; after?: { actionId: string; refund?: { uid: number; slot: string; choice?: string } }; shoveId?: string } | null = null;

// Q and E, the same two keys the freeplay board turns a unit with. A pivot is
// free of Movement Range but it is Movement, so it only happens inside one —
// or as the unit lands, where nothing has fixed its facing yet.
function rotate(ctx: HudCtx, dir: 1 | 3): boolean {
  if (movePlan) {
    movePlan.facing = ((movePlan.facing + dir) % 4) as Facing;
    movePlan.turned = true;
    movePlan.spin += dir === 1 ? 1 : -1;
  } else if (pending) {
    pending.facing = ((pending.facing + dir) % 4) as Facing;
  } else {
    return false;
  }
  ctx.refresh();
  return true;
}

// Traced by the cursor rather than solved, so a deliberate zigzag is
// expressible and terrain stops the route where the rules say it stops.
// Hovering PREVIEWS, clicking commits — the same split the freeplay board uses.
// The route used to follow the bare cursor and commit as it went, so moving the
// mouse rewrote where the unit was going.
function previewMove(ctx: HudCtx, c: number, r: number): void {
  const m = movePlan;
  if (!m || !board) return;
  const t = ctx.state.tokens.find((x) => x.uid === m.uid);
  if (!t) return;
  const cand = turn.extendRoute(ctx.data, ctx.state, t, m.path, { c, r }, m.steps, m.flying, m.actionId);
  m.preview = cand;
  board.showMovePath(cand ?? m.path, m.side, !cand);
  ctx.refresh();
}

// A click takes the previewed run; clicking on further chains a waypoint.
function commitWaypoint(ctx: HudCtx): void {
  const m = movePlan;
  if (!m || !m.preview || !board) return;
  m.path = m.preview;
  m.marks.push(m.path.length);
  m.preview = null;
  board.showMovePath(m.path, m.side, true);
  ctx.refresh();
}

// Back: drop the last committed waypoint, never past the starting Grid.
function undoWaypoint(ctx: HudCtx): void {
  const m = movePlan;
  if (!m || m.marks.length < 2 || !board) return;
  m.marks.pop();
  m.path = m.path.slice(0, m.marks[m.marks.length - 1]);
  m.preview = null;
  board.showMovePath(m.path, m.side, true);
  ctx.refresh();
}

function cancelMove(ctx: HudCtx): void {
  const after = movePlan?.attackAfter;
  const uid = movePlan?.uid;
  movePlan = null;
  // A Maneuver has nothing pending; a Movement Action backing out gives its
  // Ticks back.
  dropAction();
  board?.clearMovePath();
  board?.clearHighlights();
  // A Shock Attack walk is OPTIONAL and its Action is already paid, so backing
  // out of the move still owes the attack targeting - dropping it here would
  // spend the Tick on nothing.
  if (after && uid !== undefined) resumeShockAttack(ctx, uid, after);
  ctx.refresh();
}

// ZHDR-304 Harpy "Air Transport". The dragged Ally comes with it — towed
// BEHIND, into the Grid the Harpy just vacated, with the final Grid as the
// small-unit fallback: a Large Mech fills a whole 3x3 Grid, so a spot beside
// the Harpy can never fit one. spendCommand pays the funder's token and
// forceMove is the same command Knockback uses, so both travel.
//
// One home, called from BOTH endings of a Movement. A move that ends in a Crush
// leaves through finishCrush rather than the plain settle, and the tow lived
// only in the latter — so a Harpy that dragged an ally and then Crushed paid
// the -1 Movement, spent nothing, and left the ally standing where it was.
// Freeplay never had it: main.ts routes the crush back into the same settle
// closure, which already closed over the drag.
function towDraggedAlly(ctx: HudCtx, t: Token, path: LargeGrid[], drag: { allyUid: number; funderUid: number }): void {
  const ally = ctx.state.tokens.find((x) => x.uid === drag.allyUid);
  if (!ally) return;
  const terrain = terrainOf(ctx);
  const goalGrid = path[path.length - 1];
  const prevGrid = path[path.length - 2];
  const spot = (prevGrid
    ? standingSpot(prevGrid.c, prevGrid.r, ally.size, ally.aerial, terrain, ctx.state.tokens, ally.uid)
    : null)
    ?? (goalGrid
      ? standingSpot(goalGrid.c, goalGrid.r, ally.size, ally.aerial, terrain, ctx.state.tokens, ally.uid)
      : null);
  if (!spot) {
    ctx.noteNow(`${ally.label} could not be dragged: nothing free to stand in. The Command Token was not consumed.`);
    return;
  }
  // Each note below is written only when its command went through: a refused
  // one has already put its reason in the note line, and a success note would
  // have overwritten it (notices audit, 2026-09-28).
  // The drag is made only once it is paid for: a token the engine refused to
  // spend dragged the Ally for nothing.
  const paidTow = ctx.send({ kind: 'spendCommand', seat: t.side, uid: drag.funderUid }).ok;
  if (!paidTow) return;
  const towed = ctx.send({ kind: 'forceMove', seat: t.side, uid: t.uid, targetUid: ally.uid, to: spot }).ok;
  if (towed) ctx.noteNow(`${t.label} drags ${ally.label} along (-1 Movement, 1 Command Token consumed).`, 'done');
  // Forced Movement: the Harpy's player sets the facing (FAQ B4; audit Phase 4, B3).
  void askTowFacing(ally, t.label).then((f) => {
    if (f === null) return;
    ctx.send({ kind: 'forceMove', seat: t.side, uid: t.uid, targetUid: ally.uid, to: { col: ally.col, row: ally.row }, facing: f });
    ctx.refresh();
  });
}

// Each stop takes the free part of its Grid rather than the middle, so a unit
// crossing a Grid holding a low wall walks past it instead of onto it. Only
// the destination goes to the engine; the walk is local animation.
function commitMove(ctx: HudCtx): void {
  const m = movePlan;
  if (!m || !board) return;
  const t = ctx.state.tokens.find((x) => x.uid === m.uid);
  if (!t) return;
  // What the plan comes to is read in turn.ts (moveOrder), where a seat with
  // no planner reads it too: a turn on the spot, or the route's stops, the Mine
  // that cuts it short and the Range that stop keeps back, the Link an Obstruct
  // lock is owed, the Crush it ends in, and the command that makes the move.
  // What stays here is the page's: the walk, the sends, and what follows them.
  const order = turn.moveOrder(ctx.data, ctx.state, t, m);
  if (order.kind === 'idle') return;
  // Turning on the spot is a Movement in its own right and costs no Range, so a
  // Maneuver that only pivots is a finished Maneuver.
  if (order.kind === 'pivot') {
    movePlan = null;
    board.clearMovePath();
    board.clearHighlights();
    // The Red Shoes may spend its move on a pivot like any Maneuver.
    if (m.controller) {
      const v = ctx.send(order.command);
      ctx.noteNow(v.ok ? `${t.label} is turned on the spot (The Red Shoes).` : v.why ?? 'The move was refused.', v.ok ? 'done' : 'refused');
      ctx.refresh();
      return;
    }
    commitAction(ctx);
    const turned = ctx.send(order.command).ok;
    if (turned) ctx.noteNow(order.full
      ? `${t.label} turns a full circle on the spot. It faces the same way, and it has made a Movement, so it is no longer Stationary (Supplementary Rules 1.04, 1.8).`
      : `${t.label} turns on the spot. A pivot spends no Movement Range, but it is Movement.`, 'done');
    if (m.attackAfter) resumeShockAttack(ctx, t.uid, m.attackAfter);
    ctx.refresh();
    return;
  }
  // A Mine in a Grid the route enters stops the walk there (ruling I16), so
  // the route walked is the one moveOrder cut: everything below reads it.
  const { cut, halt, stops, last, facing, goal, linkDue, victims, crushes } = order;
  m.path = order.path;
  // The going on takes back what its stop held (C1).
  const carry = m.resume && haltCarry?.uid === t.uid ? haltCarry : null;
  if (carry) haltCarry = null;
  const shoveId = halt !== undefined ? undefined : m.shoveActionId ?? carry?.shoveId;
  const after = halt !== undefined ? undefined : m.attackAfter ?? carry?.after;
  if (halt !== undefined) haltCarry = { uid: t.uid, after: m.attackAfter ?? carry?.after, shoveId: m.shoveActionId ?? carry?.shoveId };
  const free = m.free;
  const granted = m.granted;
  const drag = m.drag;
  movePlan = null;
  board.clearMovePath();
  board.clearHighlights();
  if (!last) {
    ctx.refresh();
    return;
  }
  // A controlled move that ends in a Crush goes through the ordinary Crush
  // below, with the controller as the one placing the victims (ruling I5): its
  // seat sends every command, the exchange by the debt it holds (ruled R1;
  // audit Phase 7, P7D 1). It was refused here.
  if (m.controller && !(victims && crushes)) {
    const ctl = m.controller;
    const aerialStart = t.aerial ? { ...t } : null;
    board.animateMove(t.uid, stops, () => {
      const v = ctx.send(order.command!);
      if (!v.ok) ctx.noteNow(v.why ?? 'The move was refused.');
      else {
        ctx.noteNow(cut > 0
          ? `A Mine stops ${t.label} in its Grid, and The Red Shoes' Movement ends there (M19).`
          : `${t.label} moves under The Red Shoes' control.`, cut > 0 ? 'table' : 'done');
        // Its own Movement still triggers Interception by the side it is
        // moving against (4.9).
        const owed = turn.interceptsAfterMove(ctx.data, ctx.state, aerialStart, t.uid);
        if (owed.length) ctx.send({ kind: 'queueIntercepts', seat: ctl.side, items: owed });
      }
      ctx.refresh();
    });
    return;
  }
  // The route is committed, so a Movement Action pays here — and it has to pay
  // before the maneuver travels, since a free move is only legal once its Action
  // has been performed this Opportunity.
  commitAction(ctx);
  // The Crush found above: the victims give way before the crusher lands.
  if (victims && crushes) {
    crushPlan = {
      uid: t.uid,
      goal,
      terrain: victims.terrain.map((p) => p.id),
      queue: victims.units.map((v) => v.uid),
      stops,
      exchanges: [],
      free,
      granted,
      shoveActionId: shoveId,
      attackAfter: after,
      facing,
      path: m.path,
      steps: m.steps,
      flying: m.flying,
      // The tow rides through the Crush with everything else. Without this line
      // the plan lost it and finishCrush had nothing to run (BUG-1).
      drag,
      actionId: m.actionId,
      breakAwayLink: linkDue,
      resume: m.resume,
      controller: m.controller,
    };
    advanceCrush(ctx);
    ctx.refresh();
    return;
  }
  const walked = m.path;
  // Movement by an enemy AERIAL unit triggers Interception, checked at the
  // start and landing grids only (FAQ O11/O15, 4.9). The start is where it
  // stands right now, so the probe is taken before the command applies.
  const aerialStart = t.aerial ? { ...t } : null;
  board.animateMove(t.uid, stops, () => {
    // The route travels with the move so the other player watches the same walk.
    const moveOk = ctx.send(order.command!).ok;
    if (moveOk && halt !== undefined) {
      ctx.noteNow(`A Mine stops ${t.label} in its Grid. Resolve its blast, then Go on with the ${halt} Grid${halt === 1 ? '' : 's'} left (M19).`, 'table');
    }
    if (drag) towDraggedAlly(ctx, t, walked, drag);
    const owed = turn.interceptsAfterMove(ctx.data, ctx.state, aerialStart, t.uid);
    if (owed.length) {
      if (ctx.send({ kind: 'queueIntercepts', seat: t.side, items: owed }).ok) ctx.noteNow(`${t.label} is an Aerial Unit, so its Movement triggers Interception: ${owed.length} attempt${owed.length === 1 ? '' : 's'} owed (4.9).`, 'done');
    }
    // A Black Box in a Grid the route passed through may be picked up, which is
    // read off the whole route rather than the destination (5.3.1). Auto Mine
    // Laying reads the same route, and goes first (M7).
    // Not out of the Range a Mine's stop is keeping for the Go on (C1).
    if (halt === undefined) offerMinesOn(ctx, t, walked, m.steps, m.flying);
    offerBoxesOn(ctx, t.uid, walked, m.flying || !!t.aerial);
    // A shove rides on the Movement rather than replacing it, so it is offered
    // once the Mech has finished moving and is facing whatever it ended beside.
    if (shoveId) startShove(t.uid, shoveId);
    if (after) resumeShockAttack(ctx, t.uid, after);
    ctx.refresh();
  });
}

// A token dropped on the board in play is a Maneuver to that Grid, drawn by
// the planner itself and committed the way the Confirm button commits it, so
// the Crush, a Mine's stop, Obstruct's Link, the Boxes and the rest of the
// route's rules run on it. It was a bare `maneuver` to the drop: two units
// ended in one Grid, and a Mine was walked past (audit Phase 7, P7D 2). The
// engine is asked first, so a drop that is not this unit's Maneuver to make
// sends nothing.
function dropAsManeuver(ctx: HudCtx, t: Token, at: { col: number; row: number }): void {
  const goal = { c: Math.floor(at.col / 3), r: Math.floor(at.row / 3) };
  // Its own Grid is no Movement: the standing spot inside it is the side
  // panel's to change (placeInGrid).
  if (goal.c === Math.floor(t.col / 3) && goal.r === Math.floor(t.row / 3)) { ctx.refresh(); return; }
  const bare = ctx.check({ kind: 'maneuver', seat: t.side, uid: t.uid, to: at });
  if (!bare.ok) {
    ctx.noteNow(bare.why);
    ctx.refresh();
    return;
  }
  startMovePlan(ctx, t, { label: 'Maneuver', maneuver: true });
  const m = movePlan;
  if (!m || m.uid !== t.uid) { ctx.refresh(); return; }
  const route = turn.extendRoute(ctx.data, ctx.state, t, m.path, goal, m.steps, m.flying, m.actionId);
  if (!route || route.length < 2) {
    movePlan = null;
    ctx.noteNow(`${t.label} has no route to that Grid within its Maneuver.`);
    ctx.refresh();
    return;
  }
  m.path = route;
  commitMove(ctx);
  ctx.refresh();
}

// A snapped footprint counts only when every cell sits inside the zone.
// Where a unit may deploy, read the way the deployUnit check reads it (3.1.4;
// ruling I4): wholly within a Grid of its squad's zone with no unit in it, the
// base clear of terrain, and once every zone Grid is taken, the Grids next to
// it (FAQ P23). The zone was the only test, so a unit landed on another or on
// terrain (audit Phase 6, A3).
function fitsZone(ctx: HudCtx, t: Token, at: { col: number; row: number }, size: number): boolean {
  const su = normaliseSetup(ctx.state.setup);
  if (!su) return false;
  const c = Math.floor(at.col / 3);
  const r = Math.floor(at.row / 3);
  const cells = footprint({ ...at, size });
  if (!cells.every((x) => Math.floor(x.col / 3) === c && Math.floor(x.row / 3) === r)) return false;
  const taken = new Set(ctx.state.tokens
    .filter((x) => x.uid !== t.uid && x.deployed !== false && x.kind !== 'projectile')
    .map((x) => `${Math.floor(x.col / 3)},${Math.floor(x.row / 3)}`));
  if (taken.has(`${c},${r}`)) return false;
  const zone = deployGrids(ctx.data.zoneData, ctx.state, su.edge[t.side]);
  if (zone && !deployOpenGrids(zone, taken, gridsOf(ctx.state)).has(`${c},${r}`)) return false;
  if (t.aerial) return true;
  const solid = new Set(terrainOf(ctx).flatMap((p) => p.subCells.map((x) => `${x.col},${x.row}`)));
  return !cells.some((x) => solid.has(`${x.col},${x.row}`));
}

// How far apart two units are, in the words a player uses at the table. Same
// reading freeplay prints, kept identical on purpose: a measurement that says
// one thing on one board and another on the other is worse than none.
function rangeText(a: Token, b: Token): string {
  const ga = { c: Math.floor(a.col / 3), r: Math.floor(a.row / 3) };
  const gb = { c: Math.floor(b.col / 3), r: Math.floor(b.row / 3) };
  const dc = Math.abs(ga.c - gb.c);
  const dr = Math.abs(ga.r - gb.r);
  if (dc === 0 && dr === 0) return 'same grid';
  if (dc <= 1 && dr <= 1) return `adjacent · R${dc + dr}`;
  return `Range ${dc + dr}`;
}

// The terrain as it stands now, with anything destroyed taken out of it.
function terrainNow(ctx: HudCtx) {
  const gone = new Set(ctx.state.removedTerrain ?? []);
  return turn.mapPieces(ctx.data, ctx.state.map).filter((piece) => !gone.has(piece.id));
}

function boardCallbacks(): BoardCallbacks {
  return {
    // Board hovers had nowhere to go on this page: the Board builds the text for
    // every token badge and every terrain piece and fires it at onInspect, and
    // the Match Centre simply never supplied one, so all of it was thrown away.
    // Freeplay has done this since it was written (main.ts, showInspect).
    //
    // No mode flag is needed. inspector.ts picks its own: index.html carries a
    // docked #inspect-box, match.html does not, so this page gets the floating
    // popout automatically, the same one the keyword chips use. `at` is the
    // hovered element, which is what the floating box positions itself beside.
    //
    // Text only, deliberately, and it cannot be otherwise: InspectInfo carries
    // { title, sub, lines } with no image channel at all. A card image stacked
    // under a text panel is the pairing this app already refuses elsewhere via
    // `floating: false`, and a status Token is not a card, so there is nothing
    // here for it to compete with.
    onInspect(info, at) {
      showInspect(info, at);
    },
    // THE MEASURING LINE, the same one freeplay has always drawn: pick a unit,
    // hover another, and the board says how far apart they are and whether the
    // shot would see it. The Board already fired onHover on both pages and the
    // Match Centre simply never supplied one, so every hover was thrown away.
    //
    // WHICH unit is measuring FROM matters more here than in freeplay, because
    // this page has several ways to have a unit in hand. A live targeting wins
    // (that IS the question being asked), then the card the player opened, then
    // whoever holds the Opportunity -- so the line follows what you are doing
    // rather than jumping to whoever is active.
    onHover(uid) {
      const ctx = hudRef;
      if (!ctx || !board) return;
      const s = ctx.state;
      const fromUid = attackPick?.uid ?? ewPick?.uid ?? inspectUid ?? ensureScript(s).opp?.uid ?? null;
      const sel = fromUid !== null ? s.tokens.find((x) => x.uid === fromUid) : undefined;
      const hov = uid !== null ? s.tokens.find((x) => x.uid === uid) : undefined;
      if (!sel || !hov || sel.uid === hov.uid) { board.clearRange(); return; }
      // Smoke is asked FIRST because it beats the geometry: a Screen blocks the
      // line whatever the terrain says (4.6).
      // Terrain and smoke on the same lines, as a Firing Action is judged (audit
      // Phase 4, G1/G3).
      const los = firingSight(sel, hov, terrainNow(ctx), s.tokens, s.smoke ?? []);
      // Automatic Shield, said while the player is still choosing rather than
      // after the click: the redirect is mandatory (FAQ A12), so there is
      // nothing to veto and the only out is a different target. Read only for a
      // real attack targeting, since that is the only time a shield can move.
      const aimed = attackPick ? actionOn(ctx, sel, attackPick.actionId) : undefined;
      const shield = aimed ? automaticShieldFor(ctx.data, s.tokens, sel, hov, aimed) : null;
      board.showRange(sel, hov, `${rangeText(sel, hov)} · ${los}${shield ? ` · ⤳ ${shield.shield.label} shields it` : ''}`);
    },
    onSelect(uid) {
      const ctx = hudRef;
      if (!ctx) return;
      const s = ctx.state;
      const t = uid !== null ? s.tokens.find((x) => x.uid === uid) : undefined;
      // Clicking a unit opens ITS card, and it stays open. Without this the
      // Details tab snapped straight back to whoever held the Opportunity on
      // the very next render, which left a Projectile's own Detonate button
      // unreachable — there is no other way to a Projectile's card.
      inspectUid = t ? t.uid : null;
      ctx.refresh();
    },
    onMove(uid, col, row) {
      const ctx = hudRef;
      if (!ctx) return;
      // A spectator may look at a unit but never take hold of one. Dragging is
      // the one board gesture that reaches the engine without going through
      // the turn panel, so hiding the panel is not enough to close it.
      if (ctx.networked && !ctx.seat) { ctx.refresh(); return; }
      const t = ctx.state.tokens.find((x) => x.uid === uid);
      if (!t) return;
      // Only this player's own units. The relay takes only their seat, so a
      // drag of the other squad's unit applied on this board alone and the two
      // boards split (audit Phase 7, P7D 3). Solo, the dev harness walks both.
      if (ctx.seat && t.side !== ctx.seat) { ctx.refresh(); return; }
      const snap = snapPlacement(col, row, (t.size ?? 1) as 1 | 2 | 3, gridsOf(ctx.state)) ?? { col, row };
      // During deployment a drag nudges the unit inside its zone; in play it
      // is a Maneuver attempt the engine judges.
      const su = normaliseSetup(ctx.state.setup);
      if (su && su.stage === 'deploy') {
        if (!fitsZone(ctx, t, snap, t.size ?? 1)) { ctx.refresh(); return; }
        // Dragging the unit you are placing just moves the pending spot — it
        // must not land, because landing passes the alternation to the other
        // squad before you have confirmed anything.
        if (pending && pending.uid === uid) pending = { ...pending, col: snap.col, row: snap.row };
        else ctx.send({ kind: 'deployUnit', seat: t.side, uid, to: snap });
      } else if (canReach(ctx, t, snap.col, snap.row)) {
        // The drop only lands inside the unit's real Movement Range — the
        // same law the freeplay board enforces before offering a grid — and
        // it goes as the planner's own route to that Grid (dropAsManeuver).
        dropAsManeuver(ctx, t, snap);
        return;
      }
      ctx.refresh();
    },
    onCellHover(col, row) {
      const ctx = hudRef;
      if (!ctx || !board) return;
      const s = ctx.state;
      if (placing !== null) {
        const t = s.tokens.find((x) => x.uid === placing);
        if (!t) return;
        const size = (t.size ?? 1) as 1 | 2 | 3;
        const snap = snapPlacement(col, row, size, gridsOf(ctx.state)) ?? { col, row };
        board.showGhost(footprint({ ...snap, size }), fitsZone(ctx, t, snap, size));
      } else if (movePlan) {
        previewMove(ctx, Math.floor(col / 3), Math.floor(row / 3));
      }
    },
    onCellClick(col, row, erase) {
      const ctx = hudRef;
      if (!ctx) return;
      const s = ctx.state;
      // A launch takes its Landing Point from the highlighted picker in gPick,
      // which stops the event before it reaches here — so a press that does
      // arrive landed on an illegal Grid and must do nothing at all.
      if (launchPlan) return;
      if (movePlan) {
        // Right-click steps back a waypoint, left-click takes the preview.
        if (erase) undoWaypoint(ctx);
        else commitWaypoint(ctx);
        return;
      }
      // An armed Environment Card lands on the LARGE Grid the clicked cell
      // belongs to, because the card is the size of a Grid. Right-click clears
      // that Grid, which is also how one already down gets moved.
      if (envArm !== null) {
        const at = { col: Math.floor(col / 3), row: Math.floor(row / 3) };
        ctx.send({ kind: 'setEnvironment', seat: ctx.seat ?? 's1', at, card: erase ? null : envArm });
        ctx.refresh();
        return;
      }
      if (placing === null) return;
      const t = s.tokens.find((x) => x.uid === placing);
      if (!t) return;
      const size = (t.size ?? 1) as 1 | 2 | 3;
      const snap = snapPlacement(col, row, size, gridsOf(ctx.state)) ?? { col, row };
      // Strict placement: your whole footprint inside your own Deployment
      // Zone, aligned to the grid, or nothing lands (3.1.4). The seat is the
      // unit's side — a nudge stays legal after the alternation moves on.
      if (!fitsZone(ctx, t, snap, size)) return;
      // Held here rather than sent: a unit that lands on the board counts as
      // placed, and the alternation would move to the other squad before this
      // player had confirmed anything. The ghost stands in until they do.
      // Pointed at the other squad's Deployment Zone from where it actually
      // stands, which is what a player would turn it to anyway; Q/E still
      // override. A unit already placed keeps whatever it was turned to.
      pending = {
        uid: placing, col: snap.col, row: snap.row, size,
        facing: pending?.uid === placing ? pending.facing : deployFacing(ctx.data, s, t.side, snap),
      };
      board?.showGhost(footprint({ ...snap, size }), true);
      ctx.refresh();
    },
    onDestroyTerrain(id) {
      const ctx = hudRef;
      if (!ctx) return;
      // A Container is destroyed by an attack that targets it (Supplementary
      // Rules 1.04, 3.1), and every attack's list of targets offers it. Taking a
      // piece off by hand, with no Action, is a house rule on this strict page,
      // so it asks first (OTTO, 2026-09-30).
      void confirmDialog({
        title: 'Remove this terrain by hand?',
        body: 'A Container is destroyed by an attack that targets it: choose it from an attack\'s list of targets. Removing one by hand is a house rule, for when both players agree.',
        confirmLabel: 'Remove it',
        danger: true,
      }).then((ok) => {
        if (!ok) return;
        ctx.send({ kind: 'destroyTerrain', seat: ctx.seat ?? 's1', uid: 0, pieces: [id] });
        ctx.refresh();
      });
    },
  };
}

// Open while a card is being chosen. Kept out of the turn panel because that
// panel is rebuilt on every render and belongs to whoever's move it is, and
// laying out the battlefield is neither player's move in particular.
let envPickerOpen = false;

function toggleEnvPicker(ctx: HudCtx): void {
  envPickerOpen = !envPickerOpen;
  if (!envPickerOpen) envArm = null;
  ctx.refresh();
}

// While the battlefield is set up, before anything deploys (5.4.1). The
// picker stayed open through deployment (audit Phase 6, A7).
function envStage(ctx: HudCtx): boolean {
  const su = normaliseSetup(ctx.state.setup);
  return !!su && su.stage !== 'deploy' && su.stage !== 'done';
}

function renderEnvPicker(ctx: HudCtx): void {
  const host = document.getElementById('mc-board');
  if (!host) return;
  const open = envPickerOpen && envStage(ctx);
  let pop = host.querySelector<HTMLElement>('#mc-envpick');
  if (!open) { pop?.remove(); return; }
  if (!pop) {
    pop = document.createElement('div');
    pop.id = 'mc-envpick';
    pop.className = 'envpick';
    host.appendChild(pop);
  }
  const placed = ctx.state.environments ?? [];
  const cap = environmentAllowance(ctx.data, ctx.state);
  const ref = (c: number, r: number) => `${String.fromCharCode(65 + c)}${r + 1}`;
  pop.innerHTML = `<div class="envpick-head"><b>Environment Cards</b>
      <span>${placed.length} of ${cap}</span>
      <button class="dlg-close" data-envclose title="Close">✕</button></div>
    <p class="envpick-note">${envArm
      ? 'Click the Grid this card covers. Right-click a Grid to clear it.'
      : 'Pick a card, then click the Grid it covers. Both players place them alternately (5.4.1).'}</p>
    <div class="envpick-list">${ctx.data.environments.cards.map((c) => `<button
      class="envpick-card${envArm === c.id ? ' armed' : ''}" data-envpick="${esc(c.id)}">
      <b>${esc(c.name)}</b><span>${esc(c.text)}</span></button>`).join('')}</div>
    ${placed.length ? `<div class="envpick-placed">${placed.map((e) => {
      const def = ctx.data.environments.cards.find((c) => c.id === e.card);
      return `<span class="envpick-chip">${esc(def?.name ?? e.card)} · ${ref(e.col, e.row)}
        <button class="ui-x" data-envlift="${e.col},${e.row}" title="Take this card off">✕</button></span>`;
    }).join('')}</div>` : ''}`;
  pop.querySelector('[data-envclose]')!.addEventListener('click', () => toggleEnvPicker(ctx));
  for (const b of pop.querySelectorAll<HTMLElement>('[data-envpick]')) {
    b.addEventListener('click', () => {
      envArm = envArm === b.dataset.envpick ? null : b.dataset.envpick!;
      ctx.refresh();
    });
  }
  for (const b of pop.querySelectorAll<HTMLElement>('[data-envlift]')) {
    b.addEventListener('click', () => {
      const [c, r] = b.dataset.envlift!.split(',').map(Number);
      ctx.send({ kind: 'setEnvironment', seat: ctx.seat ?? 's1', at: { col: c, row: r }, card: null });
      ctx.refresh();
    });
  }
}

function renderBoard(ctx: HudCtx): void {
  if (!board) return;
  const s = ctx.state;
  // Your own Deployment Zone belongs at the bottom of your screen, because that
  // is where you would be standing. Worked out from where the zone actually is
  // rather than from which colour it is, so a corner deployment gets the same
  // treatment as the strips. Only with a real seat: the solo harness and anyone
  // watching keep the one canonical view.
  const own = ctx.seat ? zoneCentre(deployCellsFor(ctx.data, s, ctx.seat)) : null;
  board.setFlipped(!!own && own.row < 17.5);
  // The squad tints carry each side's faction, same custom properties the
  // freeplay page sets — without them every token reads as the default gold.
  for (const side of ['s1', 's2'] as Side[]) {
    const f = squadAllegiance(ctx.data, s.tokens.filter((t) => t.side === side)).faction;
    document.documentElement.style.setProperty(`--sq-${side}`, squadColour(f));
  }
  // Panning is the default; a placement or a route needs the cell instead.
  board.panEnabled = placing === null && envArm === null && !movePlan && !launchPlan && !smokePlan && !smokeOwedOf(s).length && !crushPlan?.queue.length && !boxDrop && !boxPlace;
  // Lit for the attacker choosing where a dropped Box lands. It outranks the
  // rest because it is asked mid-attack and nothing else can be open.
  if (boxDrop && mine(ctx, boxDrop.bySide)) {
    const base = dropBase(ctx, boxDrop);
    board.showSmokeTargets(
      base ? dropGrids(ctx, base).map((g) => ({ ...g, ok: true })) : [],
      (c, r) => placeDroppedBox(ctx, c, r),
    );
  } else if (boxPlace) {
    board.showSmokeTargets(boxPlaceGrids(ctx), (c, r) => placeBoxOn(ctx, c, r));
  } else if (movePlan) {
    const t = s.tokens.find((x) => x.uid === movePlan!.uid);
    // The same overlay freeplay shows: the Large Grids this unit can really
    // enter, with the step count on each.
    if (t) board.showReachable(reachableFor(ctx, t, movePlan.steps, movePlan.flying || !!t.aerial, movePlan.actionId), movePlan.steps);
  } else if (launchPlan) {
    // A spent volley keeps its panel for the undo but arms no targets - lit
    // Grids in that state read as "you may launch another", and clicking one
    // used to do exactly that.
    if (launchPlan.left > 0) board.showSmokeTargets(landingCandidates(ctx), (c, r) => placeLaunched(ctx, c, r));
    else board.clearHighlights();
  } else if (smokePlan) {
    board.showSmokeTargets(smokeCandidates(ctx), (c, r) => placeSmokeAt(ctx, c, r));
  } else if (crushPlan?.queue.length && !crushPlan.pendingSpot) {
    const v = s.tokens.find((x) => x.uid === crushPlan!.queue[0]);
    board.showSmokeTargets(
      v ? crushEscapes(ctx, v, crushPlan).map((g) => ({ ...g, ok: true })) : [],
      (c, r) => placeCrushed(ctx, c, r),
    );
  } else if (smokeOwedOf(s).length && mine(ctx, smokeOwedOf(s)[0].side)) {
    board.showSmokeTargets(
      smokeOwedCells(s).map((x) => ({ c: x.col, r: x.row, ok: true })),
      (c, r) => removeOwedSmoke(ctx, { col: c, row: r }),
    );
  } else {
    board.clearHighlights();
    // A range the player asked to see, redrawn because clearHighlights above
    // wipes it. It survives until they ask for something else.
    const ov = rangeOverlay ? s.tokens.find((x) => x.uid === rangeOverlay!.uid) : undefined;
    if (rangeOverlay && ov) {
      if (rangeOverlay.kind === 'move') {
        const flying = !!ctx.data.byId.get(ov.cardId)?.moveAsFlight || !!ov.aerial;
        board.showReachable(
          reachableGrids(ov, rangeOverlay.n, terrainOf(ctx), s.tokens, flying, moveOptsFor(ctx, ov, flying)),
          rangeOverlay.n,
        );
      } else {
        board.showRangeRings(ov, rangeOverlay.n);
      }
    } else if (rangeOverlay) {
      rangeOverlay = null;
    }
    // A placement waiting to be confirmed keeps its ghost through every
    // redraw: it is the only thing on the board showing where the unit went.
    if (pending) board.showGhost(footprint({ col: pending.col, row: pending.row, size: pending.size }), true);
    else if (placing === null) board.clearGhost();
  }
  const gone = new Set(s.removedTerrain ?? []);
  board.renderTerrain(turn.mapPieces(ctx.data, s.map).filter((p) => !gone.has(p.id)));
  // The Zones toggle is a local preference — a clean board to look at, not a
  // rule change — so it only suppresses the overlay and never crosses the wire.
  const showZones = ctx.zonesOn;
  // WHAT IS DRAWN IS WHAT SCORES: when the table resolved its own zones from an
  // authored map, those are the only truth. Otherwise the printed zone set.
  // Zones and Deployment Zones are INDEPENDENT decisions, the same split the
  // freeplay board makes: a map may author its deployment and no tactical
  // zones, or the reverse. Coupling them (authored deploy only shown when
  // zones are authored too) drew the printed shape over a board whose
  // placement gate was using the authored cells -- drawn and gated
  // disagreeing, which is the bug class this whole file just got swept for.
  const printedOv = showZones ? resolveZoneSetData(ctx.data, s.zoneSet ?? '') : { zones: [], deploy: null };
  const ov = !showZones
    ? { zones: [], deploy: null }
    : {
        zones: s.zones?.length
          ? s.zones
              .map((z) => ({ name: z.name, cells: z.cells.map(parseGridRef).filter(Boolean) as { col: number; row: number }[] }))
              .filter((z) => z.cells.length)
          : printedOv.zones,
        deploy: s.deployZones && (s.deployZones.black.length || s.deployZones.white.length)
          ? {
              black: { cells: s.deployZones.black.map(parseGridRef).filter(Boolean) as { col: number; row: number }[] },
              white: { cells: s.deployZones.white.map(parseGridRef).filter(Boolean) as { col: number; row: number }[] },
            }
          : printedOv.deploy,
      };
  // While setup runs, the printed Deployment Zones are always on the table,
  // whatever the zone overlay says (3.1.4).
  const su = normaliseSetup(s.setup);
  let deploy = ov.deploy;
  if (showZones && su && su.stage !== 'done' && !deploy) {
    const shapeId = (s.mission && ctx.data.zoneData.missionDeployment[s.mission]) || 'strips';
    deploy = printedDeployment(ctx.data, shapeId);
  }
  const tasks = normaliseTasks(s.tasks);
  // Which squads have named each Tactical Zone for a Secondary Task, so the
  // board can ring it. Designations are stored by zone id; zones are drawn by
  // name, which is the same translation the freeplay board makes.
  const claimed: Record<string, Side[]> = {};
  for (const side of ['s1', 's2'] as Side[]) {
    const id = tasks.zone[side];
    if (!id) continue;
    const name = zonesOf(ctx.data.zoneData.zones, ctx.state).find((z) => z.id === id)?.name ?? id;
    (claimed[name] ??= []).push(side);
  }
  // The size arrives with the map through configureTable, so a guest joining a
  // large table draws it correctly from the first frame. No-op when unchanged.
  board.setGrids(gridsOf(s));
  // Same as the freeplay board: rules.ts geometry is bounded by this.
  setBoardGrids(gridsOf(s));
  board.renderZones(ov.zones, deploy, claimed);
  board.renderTaskItems(tasks.items, (zone) => zoneCentreGrid(zonesOf(ctx.data.zoneData.zones, ctx.state), zone));
  // Everything else on the board still redraws while a unit is walking; only
  // the token layer waits, because rebuilding it would cut the animation short.
  // A pivot inside an open Movement shows before it is confirmed, the same way
  // an unconfirmed placement does.
  const preview = pending ?? (movePlan?.turned ? { uid: movePlan.uid, facing: movePlan.facing } : undefined);
  if (animatingUid === null) board.renderTokens(s, preview);
  // The control, and with it any armed card, only exists while the battlefield
  // is being laid out. Disarming here rather than only on close means a game
  // that starts with a card armed cannot leave a click primed on the board.
  const setting = envStage(ctx);
  if (!setting) { envArm = null; envPickerOpen = false; }
  const envBtn = document.getElementById('btn-envs');
  if (envBtn) {
    envBtn.hidden = !setting;
    envBtn.classList.toggle('on', envPickerOpen);
  }
  renderEnvPicker(ctx);
  board.renderEnvironments(s.environments ?? [], environmentLookup(ctx.data));
  board.renderSmoke(s.smoke ?? []);
  board.renderMarkers(s.markers ?? []);
  board.setSelected(ensureScript(s).opp?.uid ?? null);
  // What one unit can see, with the Line of Sight control on: the unit the
  // player picked (its card open), and that one only; with none picked, the
  // unit whose turn it is if it is the player's own. It used to follow
  // whichever unit was acting, so the other squad's turn drew one sight after
  // another over the board (OTTO, 2026-10-05: "if you select a mech/unit ...
  // it should only show LOS for that unit").
  const acting = ensureScript(s).opp?.uid;
  const actor = acting !== undefined ? s.tokens.find((x) => x.uid === acting) : undefined;
  const sightUid = inspectUid ?? (actor && mine(ctx, actor.side) ? actor.uid : null);
  const eyes = sightOn && sightUid !== null ? s.tokens.find((x) => x.uid === sightUid && x.deployed !== false) : undefined;
  board.showSight(eyes ? turn.sightOf(ctx.data, s, eyes) : null);
  const lb = document.getElementById('btn-los');
  if (lb) {
    lb.classList.toggle('on', sightOn);
    lb.setAttribute('aria-pressed', sightOn ? 'true' : 'false');
  }
}

// ---------- the turn panel: one question at a time ----------

function head(eyebrow: string, title: string, sub: string, mine: boolean): string {
  // In a game two computers play, the page's seat is a computer's move, not
  // the player's (`watchedSeat`).
  const said = watchedSeat && eyebrow === 'Your move' ? `${squadLabel(watchedSeat)} to move` : eyebrow;
  return `<div class="tp-head">
    <div class="tp-eyebrow${mine ? ' mine' : ''}">${esc(said)}</div>
    <div class="tp-title">${title}</div>
    ${sub ? `<div class="tp-sub">${sub}</div>` : ''}
  </div>`;
}

// The page's own seat in a game two computers play (set by ensureHud), else
// null.
let watchedSeat: Side | null = null;

// The Black Boxes placed at setup, alternately from the First Player (5.2.1;
// ruling I23): the squad whose turn it is picks a Box, then a Grid of its zone
// on the board, or keeps it on its default spot. A fixed spot on the zone's
// first Grid favoured the Black edge (audit Phase 6, F3).
let boxPlace: { itemId: string } | null = null;

function boxPlacePanel(ctx: HudCtx, turn: Side): string {
  const s = ctx.state;
  const zoneName = (id: string) => zonesOf(ctx.data.zoneData.zones, s).find((z) => z.id === id)?.name ?? id;
  if (!mine(ctx, turn)) {
    boxPlace = null;
    return head('Waiting', `${esc(squadLabel(turn))} places a Black Box`, 'Alternately, from the First Player (5.2.1).', false)
      + `<div class="tp-body">${waiting(turn, 'placing a Black Box')}</div><div class="tp-foot"></div>`;
  }
  const rows = normaliseTasks(s.tasks).items.filter((i) => i.kind === 'blackbox')
    .map((i) => `<div class="dialrow"><span class="nm">${esc(zoneName(i.zone))}</span>${i.set
      ? `<span class="pickchip set">placed by ${esc(squadLabel(i.set))}</span>`
      : `<button class="rowbtn${boxPlace?.itemId === i.id ? ' sel' : ''}" data-boxplace="${esc(i.id)}">Place</button><button class="rowbtn" data-boxkeep="${esc(i.id)}">Keep it there</button>`}</div>`)
    .join('');
  return head('Your move', 'Place a Black Box', `In its named zone, on the ground (5.2.1, FAQ P9). ${boxPlace ? 'Click a lit Grid of its zone.' : 'Pick one, then a Grid, or keep it where it stands.'}`, true)
    + `<div class="tp-body">${rows}</div><div class="tp-foot"></div>`;
}

function boxPlaceGrids(ctx: HudCtx): { c: number; r: number; ok: boolean }[] {
  const item = boxPlace ? normaliseTasks(ctx.state.tasks).items.find((i) => i.id === boxPlace!.itemId) : undefined;
  const zone = item ? zonesOf(ctx.data.zoneData.zones, ctx.state).find((z) => z.id === item.zone) : undefined;
  const terrain = terrainOf(ctx);
  return (zone?.cells ?? []).map(zref).filter((g): g is { col: number; row: number } => !!g)
    .map((g) => ({ c: g.col, r: g.row, ok: !!standingSpot(g.col, g.row, 1, false, terrain, [], undefined) }));
}

function placeBoxOn(ctx: HudCtx, c: number, r: number): void {
  const m = boxPlace;
  if (!m) return;
  const spot = standingSpot(c, r, 1, false, terrainOf(ctx), [], undefined);
  if (!spot) return;
  boxPlace = null;
  board?.clearHighlights();
  const v = ctx.send({ kind: 'placeTaskItem', seat: seatOf(ctx), itemId: m.itemId, to: spot });
  if (!v.ok) ctx.noteNow(v.why ?? 'That placement was refused.');
  ctx.refresh();
}

function waiting(side: Side, doing: string): string {
  return `<div class="waitbox"><div class="spin">◐</div><div class="msg">Waiting for <b class="${side}">${esc(squadLabel(side))}</b></div><div class="sub">${esc(doing)}</div></div>`;
}

function mine(ctx: HudCtx, side: Side): boolean {
  return !ctx.seat || ctx.seat === side;
}

function setupPanel(ctx: HudCtx, su: SetupState): string {
  const s = ctx.state;
  if (su.stage === 'map') {
    // The battlefield was settled in the lobby; the lock is sent for us.
    return head('Setup', 'Preparing the battlefield', '', true) + '<div class="tp-body"></div><div class="tp-foot"></div>';
  }
  if (su.stage === 'roll') {
    const winner = firstPlayerFrom(su);
    const both = !!su.rolls.s1.length && !!su.rolls.s2.length;
    const tie = both && !winner;
    const rows = (['s1', 's2'] as Side[])
      .map((side) => {
        const r = su.rolls[side];
        const isMe = mine(ctx, side);
        // A RE-ROLL ONLY EXISTS FOR A TIE, which is what the note under these rows
        // already tells the player. This used to offer one the moment you had
        // rolled anything, and kept offering it after a winner was settled, so a
        // player could press it over and over and keep throwing dice at a decision
        // that was already made.
        //
        // Rolled with no tie is a finished state, so it says so rather than
        // leaving a live control with nothing legitimate to do.
        const btn = !isMe
          ? `<span class="tp-dim">${r.length ? '' : 'rolling…'}</span>`
          : !r.length
            ? `<button class="rowbtn" data-roll="${side}">Roll 2 dice</button>`
            : tie
              ? `<button class="rowbtn" data-roll="${side}">Re-roll</button>`
              : '<span class="tp-dim">rolled</span>';
        return `<div class="dialrow"><span class="nm ${side}">${esc(squadLabel(side))}</span>${btn}<span class="pickchip${r.length ? ' set' : ''}">${r.length ? `${rollTotal(r)} Hits` : '—'}</span></div>`;
      })
      .join('');
    const verdict = tie
      ? `<p class="tp-note">A tie on ${rollTotal(su.rolls.s1)}. No tie procedure in the rulebook, so both roll again.<br>The first re-roll clears the other total.</p>`
      : winner ? `<p class="tp-note">${esc(squadLabel(winner))} rolls higher.</p>` : '';
    return head('Setup', 'Roll for First Player', 'Two dice each, most Hits goes first (3.1.2).', true)
      + `<div class="tp-body">${rows}${verdict}</div>
        <div class="tp-foot">${winner ? '<button class="bigbtn" data-act="accept">Continue</button>' : ''}</div>`;
  }
  if (su.stage === 'side') {
    // The edge, picked knowing the Main Task, which came with the table
    // (3.1.2; ruling I3). The Secondaries follow it.
    const fp = s.round.firstPlayer;
    const edge = mine(ctx, fp)
      ? `<div class="btnrow"><button class="rowbtn" data-edge="white">Take the White Deployment Zone</button><button class="rowbtn" data-edge="black">Take the Black Deployment Zone</button></div>`
      : waiting(fp, 'picking a table edge');
    return head(mine(ctx, fp) ? 'Your move' : 'Setup', `${esc(squadLabel(fp))} picks an edge`, s.noSecondary ? 'The other side takes the opposite edge (3.1.2). The Tasks are settled next (3.1.3).' : 'The other side takes the opposite edge (3.1.2). The Secondary Tasks come next (3.1.3).', mine(ctx, fp))
      + `<div class="tp-body">${edge}</div><div class="tp-foot"></div>`;
  }
  if (su.stage === 'tasks') {
    // After the edge (ruling I3): the Secondaries, the First Player revealing
    // first (FAQ P1); what each Task names; then the Black Boxes, placed
    // alternately from the First Player (5.2.1; ruling I23).
    const fp = s.round.firstPlayer;
    const taskState = normaliseTasks(s.tasks);
    // A game set up without Secondary Tasks goes straight to what the Main
    // Task names (commands.ts finishTasks holds the same line).
    const both = !!s.noSecondary || (!!taskState.secondary.s1 && !!taskState.secondary.s2);
    if (!both) {
      const meNow = !taskState.secondary[fp] ? mine(ctx, fp) : mine(ctx, fp === 's1' ? 's2' : 's1');
      return head(meNow ? 'Your move' : 'Setup', 'Choose Secondary Tasks',
        `${esc(squadLabel(fp))} goes first and reveals their Secondary Task first (FAQ P1).`, meNow)
        + `<div class="tp-body">${secondaryRows(ctx, fp)}</div><div class="tp-foot"></div>`;
    }
    const owed = taskDesignations(ctx.data, s);
    if (owed.length) return designatePanel(ctx, owed);
    const turn = s.noBoard ? null : boxPlaceTurn(taskState, fp);
    if (turn) return boxPlacePanel(ctx, turn);
    return head('Setup', 'The Tasks are set', s.noSecondary
      ? 'This game has no Secondary Tasks. Every target is named and every Black Box is down.'
      : 'Both Secondaries revealed, every target named, every Black Box down.', true)
      + `<div class="tp-body">${s.noSecondary ? '' : secondaryRows(ctx, fp)}</div>
        <div class="tp-foot"><button class="bigbtn" data-act="tasksdone">Continue to deployment</button></div>`;
  }
  // Tasks come before deployment (3.1.3 then 3.1.4), the same way the freeplay
  // guide holds its placement list back: the edge pick moves the stage on, so
  // without this the First Player could take an edge and start placing while
  // the other squad never got to choose a Task at all.
  // Named for the Tasks it holds, not `pending` — that is the module-level
  // placement waiting to be confirmed, and a local of the same name shadowed it
  // so every `pending !== null` below read a TaskState and was always true. The
  // Confirm button and its note then showed with nothing placed.
  const taskState = normaliseTasks(s.tasks);
  if (!s.noSecondary && (!taskState.secondary.s1 || !taskState.secondary.s2)) {
    return head('Setup', 'Secondary Tasks', 'Both are picked before anything deploys, so each side knows what the other is playing for (3.1.3).', !taskState.secondary[ctx.seat ?? 's1'])
      + `<div class="tp-body">${secondaryRows(ctx)}</div><div class="tp-foot"></div>`;
  }
  // A Task that names a Mech or a Zone is part of the same step, and the naming
  // is not always the scorer's to do — Behead has the opponent name one of
  // their own. Nothing deploys until every one of them is answered.
  const owed = taskDesignations(ctx.data, s);
  if (owed.length) return designatePanel(ctx, owed);
  // deploy — every button that ends or advances a step lives in the FOOT, so
  // the panel reads the same in every state.
  // The note goes above the button, never below it. The foot is anchored to
  // the bottom of the panel, so text that comes and goes grows upward and the
  // button it explains stays where the hand expects it.
  const confirmRow = pending !== null
    ? `<p class="tp-note">Or click another Grid in your zone to move it first. It lands when you confirm.</p>
       ${turnRow(FACING_NAME[pending.facing], 'Nothing in 3.1.4 fixes which way a unit lands facing, so point it where you want it before confirming.')}
       <button class="bigbtn" data-act="confirmplace">Confirm placement</button>`
    : '';
  const turn = deployTurn(s, su, ctx.data);
  if (!turn || deploymentComplete(s, ctx.data)) {
    const foot: string[] = [confirmRow];
    let sub = '';
    if (ctx.networked && ctx.seat) {
      // Round 1 begins only when BOTH squads have said their deployment is
      // final — neither player can push the other forward.
      const meReady = !!s.ready?.[ctx.seat];
      const otherSeat: Side = ctx.seat === 's1' ? 's2' : 's1';
      const otherReady = !!s.ready?.[otherSeat];
      sub = meReady && otherReady ? 'Both squads confirmed.' : 'Both squads confirm before Round 1.<br>Moves stay open until then.';
      if (!meReady) foot.push(`<button class="bigbtn${pending !== null ? ' ghost2' : ''}" data-act="deployready">My deployment is final</button>`);
      else if (!otherReady) foot.push(`<button class="bigbtn ghost2" data-act="deployunready" title="Tap to withdraw">✓ Ready · waiting for ${esc(squadLabel(otherSeat))}…</button>`);
      else foot.push('<button class="bigbtn" data-act="deploydone">Begin Round 1</button>');
    } else {
      foot.push(`<button class="bigbtn${pending !== null ? ' ghost2' : ''}" data-act="deploydone">Begin Round 1</button>`);
    }
    return head('Setup', 'Deployment complete', sub, true)
      + `<div class="tp-body"></div><div class="tp-foot">${foot.join('')}</div>`;
  }
  if (!mine(ctx, turn)) {
    placing = null;
    return head('Deployment', `${esc(squadLabel(turn))} places a unit`, '', false)
      + `<div class="tp-body">${waiting(turn, 'placing a unit')}</div><div class="tp-foot">${confirmRow}</div>`;
  }
  const waitingUnits = deployable(s, turn, ctx.data);
  const rows = waitingUnits
    .map(
      (t) => `<button class="rowwide${placing === t.uid ? ' sel' : ''}" data-place="${t.uid}">${esc(t.label)}<span class="ct">${t.kind}</span></button>`,
    )
    .join('');
  // A Mech chooses its Stance as it lands, and anything that can activate
  // Optical Camouflage may be deployed already in it (3.1.4, 4.12.2). Both
  // travel with the placement, so they are decided before it is confirmed.
  const chosen = placing !== null ? s.tokens.find((t) => t.uid === placing) : undefined;
  let landing = '';
  if (chosen) {
    const stances = chosen.kind === 'mech'
      ? `<div class="stancerow">${(['defensive', 'mobility', 'offensive'] as const)
          .map((x) => `<button class="stancebtn${deployStance === x ? ' sel' : ''}" data-depstance="${x}">${x[0].toUpperCase()}${x.slice(1)}</button>`)
          .join('')}</div>`
      : '';
    const camo = canActivateCamo(ctx.data, chosen)
      ? `<div class="stancerow"><button class="stancebtn${deployCamo ? ' sel' : ''}" data-depcamo="1">${deployCamo ? '✓ Deploying hidden' : 'Deploy in Optical Camouflage'}</button></div>`
      : '';
    landing = stances + camo;
  }
  return head('Your move', 'Place a unit', placing !== null ? `Hover shows the landing spot; click a Grid in your ${su.edge[turn]} zone.` : 'Pick a unit, then click a Grid on the board.', true)
    + `<div class="tp-body">${rows}${landing}</div><div class="tp-foot">${confirmRow}</div>`;
}

// Which Mech's dial is open. Six timings times a whole squad is more rows than
// the panel wants at once, so one Mech shows its choices at a time — the same
// trigger-then-stack shape the Squads tab uses, in a column that has no room
// for a popout.
let dialOpen: number | null = null;

function planningPanel(ctx: HudCtx): string {
  const s = ctx.state;
  const sc = ensureScript(s);
  const me = ctx.seat;
  const sides: Side[] = me ? [me] : ['s1', 's2'];
  const rows = sides
    .flatMap((side) => s.tokens.filter((t) => t.side === side && t.kind === 'mech' && alive(t) && t.partStates.torso !== 'destroyed'))
    .map((t) => {
      const cur = TIMINGS.find((x) => x.id === t.timing);
      const open = dialOpen === t.uid;
      const trig = `<button class="rowwide dialtrig${open ? ' sel' : ''}" data-dialopen="${t.uid}"${cur ? ` style="--t-tint:var(--t-${cur.id})"` : ''}>
        <span class="dotk"></span><span class="an">${esc(t.label)}</span>
        <span class="ct">${cur ? esc(cur.name) : 'no dial yet'} ▾</span></button>`;
      if (!open) return trig;
      // Initiative comes off the pilot card, and it is what the choice is
      // actually about: a low number acts earlier in its slot (3.4.2).
      const opts = TIMINGS.map((d) => {
        const init = initiativeFor(ctx.data, t, d.id);
        const ic = actionIconUrl(d.pilotKey);
        return `<button class="rowwide dialopt${t.timing === d.id ? ' sel' : ''}" data-dial="${t.uid}:${d.id}" style="--t-tint:var(--t-${d.id})">
          ${ic ? `<img src="${ic}" alt="">` : '<span class="dotk"></span>'}
          <span class="an">${esc(d.name)}</span><span class="ct">Initiative ${init ?? '—'}</span></button>`;
      }).join('');
      return `${trig}<div class="dialstack">${opts}</div>`;
    })
    .join('');
  // With no seat (solo, the dev harness) both squads' dials are this screen's
  // to set, and all of them count: this used to count none there, so the
  // phase turned with every dial blank and nobody activated (audit Phase 2, A2).
  const myMechs = s.tokens.filter((t) => (!me || t.side === me) && t.kind === 'mech' && alive(t) && t.partStates.torso !== 'destroyed');
  const left = myMechs.filter((t) => !t.timing).length;
  const committed = me ? !!sc.commits[me] : false;
  const bothRevealed = sc.revealed.includes('s1') && sc.revealed.includes('s2');
  const foot = ctx.networked && me
    ? committed
      ? bothRevealed
        ? advanceBtn(ctx, 'Continue to the Action Phase')
        : `<p class="tp-note">Committed. Waiting for ${esc(squadLabel(me === 's1' ? 's2' : 's1'))} to lock in…</p>`
      : `<button class="bigbtn" data-act="lockdials"${left ? ' disabled' : ''}>${left ? `Lock in (${left} dial${left === 1 ? '' : 's'} left)` : 'Lock in'}</button>`
    : advanceBtn(ctx, left ? `${left} dial${left === 1 ? '' : 's'} left` : 'Continue to the Action Phase', !!left);
  return head(me ? 'Your move' : 'Planning', 'Set your Timing Dials', me ? 'Your opponent cannot see these until both squads lock in.' : 'Both squads set dials.', true)
    + `<div class="tp-body">${rows}</div><div class="tp-foot">${foot}</div>`;
}

const FACING_NAME = ['north', 'east', 'south', 'west'];

// Turning, offered as buttons as well as Q and E — the keys are what the board
// page trained, but nothing on screen would otherwise say the option exists.
function turnRow(facing: string, why: string): string {
  return `<div class="turnrow" title="${esc(why)}">
      <button class="rowbtn" data-turn="ccw">↺ Q</button>
      <span class="ct">facing ${esc(facing)}</span>
      <button class="rowbtn" data-turn="cw">E ↻</button>
    </div>`;
}

// The Ticks in hand, labelled the way the freeplay guide labels them: the
// Maneuver Tick, the two Action Ticks, and any Extra Ticks a Part grants. A
// grant whose condition has lapsed shows as unavailable rather than spent,
// because those are different things and only one of them can come back.
function tickPool(o: Opportunity): string {
  const pip = (on: boolean, extra = '') => `<i class="pip${on ? '' : ' off'}${extra}"></i>`;
  const live = extrasLeft(o);
  const manUsable = canManeuver(o).ok;
  const extraPip = (x: ExtraTick) => {
    if (o.spentExtras.includes(x.id)) return pip(false);
    return grantHolds(o, x) ? `<i class="pip" title="${esc(x.label)}"></i>` : `<i class="pip off lapsed" title="${esc(whyGrantLapsed(x))}"></i>`;
  };
  return `<div class="hudticks">
    <span class="pips${manUsable ? '' : ' spent'}"><b class="pip-label">MAN</b>${pip(o.maneuver > 0 && manUsable)}</span>
    <span class="pips${o.action ? '' : ' spent'}"><b class="pip-label">ACT</b>${Array.from({ length: actionPipCount(o) }, (_, i) => pip(i < o.action)).join('')}</span>
    ${o.extras.length ? `<span class="pips${live.length ? '' : ' spent'}"><b class="pip-label">XTR</b>${o.extras.map(extraPip).join('')}</span>` : ''}
  </div>`;
}

function actionButtons(ctx: HudCtx, t: Token, o: Opportunity): string {
  // 4.1: a Mech chooses its Stance each Action Opportunity, before the choice
  // to Maneuver — and the choice USED to be a lock that refused every Action
  // until a Stance was pressed. That got in the way of the thing a player
  // actually does, which is cycle the dial to see what each Stance opens up.
  // So the dial stays live and the first Move or Action closes it, in
  // commands.ts lockStance(). The panel only has to say which state it is in.
  const stanceSet = t.kind === 'mech' && !!o.stanceLocked;
  // RWS (遥控武器): a Mech activated in the Command Phase was sent a Command
  // for its autocannon, and that is the whole of what it may do here.
  const rwsOnly = t.kind === 'mech' && PHASES[ctx.state.round.phase] === 'Command';
  // WHICH Actions may be performed now, and why not, is read in turn.ts
  // (actionRows): the list the seat seam reads too, so a row drawn live here
  // is an Action every other reader of the turn is offered.
  const rows = turn.actionRows(ctx.data, ctx.state, t, o)
    .map(({ a, key, slot, cardId, len, cost, v, lender, ammoLeft }) => {
      const kind = (a.type ?? '').toLowerCase();
      const pool = `${a.yellowDice ?? 0},${a.redDice ?? 0}`;
      // What it costs, in the Ticks it actually spends, the way the guide
      // writes it: M for the Maneuver Tick, a dot per Action Tick.
      // No printed length means no Tick cost — Passives, and every Drone Action
      // in the card data. Those show their type rather than a price they do
      // not have, the way the guide leaves them off its Tick list entirely.
      const price = rwsOnly ? 'RWS' : v.extra ? 'XTR' : cost ? `${cost.maneuver ? 'M' : ''}${'●'.repeat(cost.action)}` : (a.type ?? '—');
      const tip = `${lender ? `Load on ${lender} - ` : ''}${len ? LENGTH_NAME[len] : a.type ?? ''}${cost ? `: ${costLabel(cost)}` : ''}`;
      // Blocked Actions stay on the list, greyed, and say why in the notice
      // line: on a mouse hover or a long press. A press does nothing (OTTO's
      // picks 2 and 6, 2026-09-28); "the Starting Action must match the dial"
      // is exactly the thing a player needs told, so it is never hidden. The
      // row then carries no title, or the reason would be said twice.
      // data-tip-card puts the Part's own card up beside the panel, which is
      // the fastest way to see WHICH arm a duplicated Action belongs to; the
      // slot chip answers the same question without hovering at all.
      // 'main' is a Drone's own card — every one of its rows would say MAIN,
      // which tells a player nothing. The chip is for telling two PARTS apart.
      const where = slot && slot !== 'main' ? SLOT_LABEL[slot] : '';
      return `<button class="actrow k-${kind}${v.ok ? '' : ' warn'}" data-doact="${esc(key)}" data-pool="${pool}" data-an="${esc(a.name?.en || a.id)}"${
        cardId ? ` data-tip-card="${esc(cardId)}"` : ''
      }${v.ok ? ` title="${esc(tip)}"` : ` aria-disabled="true" data-why="${esc(v.why ?? '')}"`}>
        <span class="dotk"></span><span class="an">${esc((a.name?.en || a.id).slice(0, 26))}${lender ? ' (Load)' : ''}${ammoLeft !== undefined ? ` ×${ammoLeft}` : ''}</span>${
        where ? `<span class="aw">${esc(where)}</span>` : ''
      }<span class="ac">${price}</span>
      </button>`;
    })
    .join('');
  // Whether it may Maneuver, or a Drone move: turn.ts maneuverVerdict, the
  // same reading (Shutdown, RWS, the Automatic Phase's lock, Immobilized).
  const man = turn.maneuverVerdict(ctx.state, t, o);
  // Ticks are a Mech's Action Opportunity (3.4). A Drone or Projectile gets an
  // activation instead — one Action, no price printed on any of them — so the
  // pool is left off the way the freeplay guide leaves it off its phase panels.
  const ticks = t.kind === 'mech' ? tickPool(o) : '';
  // While a route is being drawn the panel becomes the move bar, the same way
  // the freeplay guide takes it over.
  if (movePlan && movePlan.uid === t.uid) return moveBarHtml(ctx, t, ticks);
  // The Overloading Pack buys Action Ticks with Link, two at most an
  // Opportunity. They are ordinary Action Ticks, so a pair pays for a Medium
  // Action — which no pair of Extra Ticks can do.
  const ovl = overloadPackOn(ctx.data, t) ? canOverload(o, t.link ?? 0) : null;
  const ovlRow = ovl
    ? `<button class="actrow k-tactic${ovl.ok ? '' : ' warn'}"${ovl.ok ? ` title="${esc(`Consume 1 Link for 1 Action Tick, up to ${OVERLOAD_MAX} an Action Opportunity.`)}"` : ` aria-disabled="true" data-why="${esc(ovl.why ?? '')}"`} data-act="overload">
        <span class="dotk"></span><span class="an">Overload</span><span class="ac">${o.overload}/${OVERLOAD_MAX} · Link ${t.link ?? 0}</span></button>`
    : '';
  // Card 547's Attack Mode: the same shape one card over. Also an ORDINARY
  // Action Tick, so it reads as a bigger base pool rather than as an Extra.
  // Offered, never applied for the player — the card prints "may", and once
  // the dial is set a Tick nobody wants is a Tick that locks the Stance.
  const bonus = t.kind === 'mech' ? opportunityBonusOn(ctx.data, t) : undefined;
  const bon = bonus ? canAttackMode(o, t.stance, bonus.stance) : null;
  // FPA-04-2 Domestic Expert (FAQ L2): Link for an ordinary Action Tick, in
  // Offensive Stance, once an Opportunity. Same shelf as Overload because it
  // is the same class of Tick; the command holds the rule, the row reports it.
  const trait = t.kind === 'mech' && !rwsOnly ? linkTickTraitOn(ctx.data, t) : null;
  const lt = trait ? ctx.check({ kind: 'linkTick', seat: t.side, uid: t.uid }) : null;
  const linkRow = trait && lt
    ? `<button class="actrow k-tactic${lt.ok ? '' : ' warn'}"${lt.ok ? ` title="${esc(`Consume 1 Link for 1 Action Tick (${trait.label}). Up to ${trait.maxLink} per Action Opportunity, in Offensive Stance, which is then locked (FAQ L2).`)}"` : ` aria-disabled="true" data-why="${esc(lt.why ?? '')}"`} data-act="linktick">
        <span class="dotk"></span><span class="an">${esc(trait.label.replace(/^Hammerhead /, ''))}</span><span class="ac">${o.linkTicks ?? 0}/${trait.maxLink} · Link ${t.link ?? 0}</span></button>`
    : '';
  // ZPA-38 Firewatch (GoF 1.021): 1 Link for a Command Token as the Mech gains
  // the Opportunity. Same shelf; the command holds the rule, the row reports it.
  const fwv = t.kind === 'mech' && !rwsOnly && firewatchOn(ctx.data, t) ? ctx.check({ kind: 'firewatch', seat: t.side, uid: t.uid }) : null;
  const fireRow = fwv
    ? `<button class="actrow k-tactic${fwv.ok ? '' : ' warn'}"${fwv.ok ? ` title="${esc('Firewatch: consume 1 Link to generate a Command Token, as this Mech gains its Action Opportunity. Once per Action Opportunity.')}"` : ` aria-disabled="true" data-why="${esc(fwv.why ?? '')}"`} data-act="firewatch">
        <span class="dotk"></span><span class="an">Firewatch</span><span class="ac">${o.firewatch ? 'taken' : `1 Link → Command Token · Link ${t.link ?? 0}`}</span></button>`
    : '';
  const bonRow = bon && bonus
    ? `<button class="actrow k-tactic${bon.ok ? '' : ' warn'}"${bon.ok
      ? ` title="${esc(`Take ${bonus.actionPoints} more Action Tick${bonus.actionPoints === 1 ? '' : 's'} for this Action Opportunity. Ordinary Ticks, so they combine with the base pool for a Medium Action, and taking them SETS the Stance (4.1).`)}"`
      : ` aria-disabled="true" data-why="${esc(bon.why ?? '')}"`} data-act="attackmode">
        <span class="dotk"></span><span class="an">${esc(bonus.label)}</span><span class="ac">${o.attackMode ? 'taken' : `+${bonus.actionPoints} Tick · locks Stance`}</span></button>`
    : '';
  // Stance is chosen before the Mech has done anything, and a Mech in Shutdown
  // may only Reboot (4.1.1) — which matters twice over now that Overload can
  // spend a Mech's last Link and shut it down.
  const shutdown = t.stance === 'shutdown';
  const active = ['defensive', 'mobility', 'offensive'] as const;
  // Before the lock the row is the whole panel's front door: the current
  // Stance reads "Keep" so staying put is one press, not a trap.
  // Its own block with a heading, because a player has to notice it before
  // reaching for an Action: the dial and the Action list used to run together
  // as one undifferentiated column of buttons.
  // Not during an RWS activation: that is a Command Phase Opportunity, not an
  // Action one, and the Stance is chosen in the Mech's own Action Opportunity
  // (3.4.2). The row used to draw there and never lock (audit Phase 2, A7).
  // In Cruise Mode Mobility is the only Stance (Ace Strategy additional rules).
  const cruise = cruising(ctx.data, t);
  const stanceRow = !shutdown && t.kind === 'mech' && !rwsOnly
    ? `<div class="tp-group stancegroup">
        <div class="tp-label">Stance${stanceSet ? ' <em>· set for this Opportunity</em>' : cruise ? ' <em>· Cruise Mode: Mobility only</em>' : ''}</div>
        <div class="stancerow">${active
          .map((x) => `<button class="stancebtn${t.stance === x ? ' sel' : ''}"${
            (stanceSet || cruise) && t.stance !== x ? ' disabled' : ''
          } data-stance="${x}">${x[0].toUpperCase()}${x.slice(1)}</button>`)
          .join('')}</div>
      </div>`
    : '';
  // Only where the engine takes it: the start of the Mech's own Opportunity
  // (FAQ K17). One shut down part-way through ends this one instead.
  const rebootNow = shutdown && t.kind === 'mech' && rebootWhy(ctx.state, t) === null;
  const rebootRow = !(shutdown && t.kind === 'mech')
    ? ''
    : rebootNow
      ? `<p class="tp-note">${esc(t.label)} is in Shutdown Stance, so it Reboots now: no Maneuver and no other Action (4.1.1, FAQ K17).</p>
       <div class="stancerow">${active
        .map((x) => `<button class="stancebtn" data-reboot="${x}">Reboot to ${x[0].toUpperCase()}${x.slice(1)}</button>`)
        .join('')}</div>`
      : `<p class="tp-note">${esc(rebootWhy(ctx.state, t) ?? '')} It can do nothing more this Action Opportunity.</p>`;
  // Only a Mech has both a Maneuver and Movement Actions to tell apart. A Drone
  // just moves, so calling its one option a Maneuver invented a distinction the
  // card never makes.
  const moveWord = t.kind === 'mech' ? 'Maneuver' : 'Movement';
  const moveTip = chassisGone(t)
    ? 'Its Chassis is destroyed, so its Maneuver may only change its Facing (FAQ E4): Q or E turns it, then confirm.'
    : t.kind === 'mech'
    ? `Draw a route, then confirm. The Maneuver Value comes off the Chassis Card${t.stance === 'mobility' ? ', doubled by Mobility Stance' : ''}. A Movement Action carries its own Range.`
    : 'Draw a route, then confirm. This activation buys a Movement or an Action, not both (2.4.1).';
  return `${ticks}${stanceRow}${rebootRow}
    <div class="tp-group">
      <div class="tp-label">Actions</div>
      <button class="actrow k-moving${man.ok ? '' : ' warn'}"${man.ok ? ` title="${esc(moveTip)}"` : ` aria-disabled="true" data-why="${esc(man.why ?? '')}"`} data-act="maneuver">
        <span class="dotk"></span><span class="an">${moveWord}</span><span class="ac">${
          chassisGone(t)
            ? 'turn only'
            : `${maneuverRange(ctx.data, t)} ${maneuverRange(ctx.data, t) === 1 ? 'grid' : 'grids'}`
        }</span></button>
      ${goOn(ctx, t, o)}
      ${ovlRow}
      ${linkRow}
      ${fireRow}
      ${bonRow}
      ${rows}
    </div>`;
}

// The rest of a Movement a Mine stopped (ruling I16): drawn while it is owed,
// greyed on a destroyed Chassis, which ends it (audit Phase 5, C1).
function goOn(ctx: HudCtx, t: Token, o: Opportunity): string {
  const left = o.uid === t.uid ? o.mineHalt ?? 0 : 0;
  if (left <= 0) return '';
  // The engine's own reading: a destroyed Chassis ends it, and the Mine's
  // blast comes first, which the other seat resolves. The row was live while
  // the blast was still owed, and going on walked the unit out of it (ruled
  // R4; audit Phase 7, P7D 4).
  const v = ctx.check({ kind: 'maneuver', seat: t.side, uid: t.uid, to: { col: t.col, row: t.row }, resume: true });
  const stop = v.ok ? null : v.why;
  return `<button class="actrow k-moving${stop ? ' warn' : ''}"${stop ? ` aria-disabled="true" data-why="${esc(stop)}"` : ` title="${esc('The rest of the Movement a Mine stopped (M19).')}"`} data-act="goon">
    <span class="dotk"></span><span class="an">Go on</span><span class="ac">${left} ${left === 1 ? 'grid' : 'grids'}</span></button>`;
}

// ZPA-36 Aster's Command Phase button, for the seats that own one. Hidden
// entirely when no Aster is fielded; greyed with the reason when it cannot
// fire, in the same style the guide uses.
function asterRows(ctx: HudCtx): string {
  const s = ctx.state;
  return s.tokens
    .filter((t) => t.kind === 'mech' && alive(t) && pilotCard(ctx.data, t)?.id === 'ZPA-36' && mine(ctx, t.side))
    .map((t) => {
      const why = asterBlockers(s, t) ?? '';
      return `<button class="rowwide${why ? ' dim' : ''}" data-aster="${t.uid}" title="${esc(why || 'Consume 1 Command Token to restore 1 Link to an Ally Mech.')}">
        ${esc(t.label)}: restore 1 Link<span class="ct">Aster · 1 Command Token</span></button>`;
    })
    .join('');
}

// The phase-turning button. Networked, it is a two-player agreement: the
// first press marks this seat ready and waits, the second player's press
// completes the pair and the phase turns — so nobody is thrown out of a card
// or a picker because their opponent was faster. Tapping again withdraws.
// Solo and in the dev harness it is the plain advance it always was.
function advanceBtn(ctx: HudCtx, label: string, disabled = false): string {
  if (!ctx.networked || !ctx.seat) {
    return `<button class="bigbtn" data-act="advance"${disabled ? ' disabled' : ''}>${esc(label)}</button>`;
  }
  const r = ctx.state.ready ?? {};
  if (!r[ctx.seat]) {
    const other: Side = ctx.seat === 's1' ? 's2' : 's1';
    return `<button class="bigbtn" data-act="advance"${disabled ? ' disabled' : ''}>${esc(label)}${r[other] ? ` · ${esc(squadLabel(other))} is ready` : ''}</button>`;
  }
  const other: Side = ctx.seat === 's1' ? 's2' : 's1';
  return `<button class="bigbtn ghost2" data-act="advance">✓ Waiting for ${esc(squadLabel(other))}, tap to withdraw</button>`;
}

function loopPanel(ctx: HudCtx, phase: LoopPhase): string {
  const s = ctx.state;
  const sc = ensureScript(s);
  const tokens = phase === 'Command'
    ? `<p class="tp-note">Command tokens · <b class="s1">${s.commandTokens.s1}</b> · <b class="s2">${s.commandTokens.s2}</b></p>${asterRows(ctx)}`
    : '';
  if (sc.opp) {
    const t = s.tokens.find((x) => x.uid === sc.opp!.uid);
    if (t) {
      if (!mine(ctx, t.side)) {
        return head('Waiting', `${esc(squadLabel(t.side))} is acting`, `${esc(t.label)} · ${phase} Phase.`, false)
          + `<div class="tp-body">${waiting(t.side, 'resolving its action')}</div><div class="tp-foot"></div>`;
      }
      return head('Your move', esc(t.label), phase === 'Command'
        ? (t.kind === 'mech' ? 'RWS: fire the commanded Part, then end (遥控武器).' : 'One Command Action, or move it.')
        : 'Resolve its action, then end.', true)
        + `<div class="tp-body">${actionButtons(ctx, t, sc.opp)}</div>
          <div class="tp-foot"><button class="bigbtn" data-act="endopp">End this activation</button></div>`;
    }
  }
  if (loopComplete(s, phase, ctx.data)) {
    return head(phase, `${phase} Phase complete`, '', true)
      + `<div class="tp-body">${tokens}</div><div class="tp-foot">${advanceBtn(ctx, 'Continue')}</div>`;
  }
  const turn = canAct(s, phase, sc.turn, ctx.data) ? sc.turn : (nextTurn(s, phase, sc.turn, ctx.data) ?? sc.turn);
  if (!mine(ctx, turn)) {
    return head('Waiting', `${esc(squadLabel(turn))} designates`, '', false)
      + `<div class="tp-body">${tokens}${waiting(turn, `picking a ${phase === 'Delay' ? 'projectile' : 'drone'} or passing`)}</div><div class="tp-foot"></div>`;
  }
  const units = eligibleUnits(s, phase, turn, ctx.data);
  // A Mech on this list is here for RWS (遥控武器): a Command sent to it fires
  // its Ls197R Autocannon. The chip says so, since "mech" on a Drone list reads
  // as a mistake.
  const rows = units.map((t) => `<button class="rowwide" data-designate="${t.uid}">${esc(t.label)}<span class="ct">${t.kind === 'mech' ? 'RWS' : t.kind}</span></button>`).join('');
  // Swarm Tactics going on (172_B): the Warrior's token moves on now, or stops.
  const going = phase === 'Command' ? swarmFor(s, turn) : null;
  const swarmNote = going
    ? `<p class="tp-note">Swarm Tactics: ${esc(s.tokens.find((x) => x.uid === going.issuer)?.label ?? 'the Warrior')}'s Command Token may go on to another Drone now, at no cost. Stop, and it stays on ${esc(s.tokens.find((x) => x.uid === going.from)?.label ?? 'that Drone')}.</p>`
    : '';
  return head('Your move', phase === 'Command' ? 'Command a drone' : phase === 'Delay' ? 'Activate a projectile' : 'Activate a drone', 'Or pass for the phase.', true)
    + `<div class="tp-body">${tokens}${swarmNote}${rows}</div>
      <div class="tp-foot">${going ? '<button class="bigbtn ghost2" data-act="swarmstop">Stop here</button>' : ''}<button class="bigbtn ghost2" data-act="pass">Pass</button></div>`;
}

// Tied on Timing and Initiative with more of this squad's Mechs: the owner
// picks which takes the turn, while the one holding it has done nothing (audit
// Phase 2, E6). The engine's own list, so every row drawn is taken.
function tieRow(ctx: HudCtx): string {
  const tied = tiedChoices(ctx.state, makeInit(ctx.data));
  if (!tied.length) return '';
  return `<div class="tp-group">
      <div class="tp-label">Tied turn <em>· your squad picks which goes (3.4.1)</em></div>
      ${tied.map((x) => `<button class="rowwide" data-tiepick="${x.uid}">${esc(x.label)} goes first<span class="ct">tied</span></button>`).join('')}
    </div>`;
}

function actionPanel(ctx: HudCtx): string {
  const s = ctx.state;
  const o = opportunity(ctx.data, s);
  if (!o) {
    return head('Action Phase', 'Every Mech has acted', '', true)
      + `<div class="tp-body"></div><div class="tp-foot">${advanceBtn(ctx, 'Continue')}</div>`;
  }
  const t = s.tokens.find((x) => x.uid === o.uid);
  if (!t) return head('Action Phase', 'The active Mech is gone', '', true) + `<div class="tp-body"></div><div class="tp-foot"><button class="bigbtn" data-act="endopp">Skip</button></div>`;
  const timing = TIMINGS.find((x) => x.id === o.timing)?.name ?? '';
  if (!mine(ctx, t.side)) {
    return head('Waiting', `${esc(squadLabel(t.side))} is acting`, `${esc(t.label)} · ${esc(timing)}.`, false)
      + `<div class="tp-body">${waiting(t.side, 'taking its Action Opportunity')}</div><div class="tp-foot"></div>`;
  }
  // A Shutdown Mech whose Opportunity has come must Reboot (FAQ K17), so the
  // Reboot row is its whole panel and there is nothing to end.
  const owed = rebootOwed(s, t);
  return head('Your move', `${esc(t.label)} · ${esc(timing)}`, owed ? 'Shutdown: Reboot now.' : '1 Maneuver, 2 Action ticks.', true)
    + `<div class="tp-body">${tieRow(ctx)}${actionButtons(ctx, t, o)}</div>
      <div class="tp-foot">${owed ? '' : '<button class="bigbtn" data-act="endopp">End this Opportunity</button>'}</div>`;
}

function endPanel(ctx: HudCtx): string {
  const s = ctx.state;
  const sc = ensureScript(s);
  const smoke = s.smoke ?? [];
  // In the book's order (3.7): Remove Units, then Token Management, then Check
  // Tasks. Smoke dissipation is judged with the tokens (4.16). The freeplay
  // guide already walked it this way; this page had the tokens first.
  const steps: { id: string; label: string }[] = [
    { id: 'remove', label: 'Integrity Loss: remove spent Mechs (3.7.1)' },
    { id: 'tokens', label: 'Age tokens & clear Command pools (3.7.2)' },
    // Only offered when there is smoke to judge, so a game that never sees a
    // grenade never grows a step it cannot do anything with.
    ...(smoke.length ? [{ id: 'smoke', label: `Smoke dissipation · ${smoke.length} screen${smoke.length === 1 ? '' : 's'}` }] : []),
    { id: 'tasks', label: 'Settle Task control (3.7.3)' },
  ];
  // "In the following order" (3.7): a step waits, disabled in its place, for
  // the ones before it; the engine refuses it out of order (audit Phase 6, B6).
  const at = (id: string) => sc.endDone.includes(`${s.round.n}:end:${id}`);
  const before: Record<string, string[]> = { tokens: ['remove'], tasks: ['remove', 'tokens'] };
  const rows = steps
    .map((st) => {
      const done = at(st.id);
      const wait = (before[st.id] ?? []).some((x) => !at(x));
      // Greyed with its reason, which a hold or a hover says in the notice
      // line; a truly disabled row hears neither (audit Phase 7, P7D 9).
      const why = done ? 'This step is done for this round.' : wait ? 'The steps above come first (3.7).' : '';
      return `<button class="rowwide${done ? ' donerow' : ''}" data-endstep="${st.id}"${why ? ` aria-disabled="true" data-why="${esc(why)}"` : ''}>${done ? '✓ ' : ''}${esc(st.label)}</button>`;
    })
    .join('');
  const all = steps.every((st) => sc.endDone.includes(`${s.round.n}:end:${st.id}`));
  const last = gameEndsThisRound(ctx.data, s);
  const vp = normaliseTasks(s.tasks).vp;
  // What the board owes each squad right now, judged rather than typed in.
  const owed = scorePreview(ctx, last);
  // Networked play scores itself: the Settle Task control step sends the
  // computed award as one command, so hand-editable +1 buttons would only
  // invite double-adding what the board already paid. They stay in a local
  // game, where the players ARE the referee.
  const settled = sc.endDone.includes(`${s.round.n}:end:tasks`);
  const plusBtn = (side: Side) => (ctx.networked ? '' : `<button class="rowbtn" data-award="${side}">+1</button>`);
  const score = `<div class="sect2" style="margin-top:10px">Victory Points</div>
    <div class="dialrow"><span class="nm s1">${esc(squadLabel('s1'))} · ${vp.s1} VP</span>${plusBtn('s1')}</div>
    <div class="dialrow"><span class="nm s2">${esc(squadLabel('s2'))} · ${vp.s2} VP</span>${plusBtn('s2')}</div>
    ${owed.lines.length
      ? `<div class="sect2" style="margin-top:10px">This round earns</div>
         ${owed.lines.map((l) => `<div class="dialrow"><span class="nm ${l.side}">${esc(l.why)}</span><span class="pickchip set">+${l.vp}</span></div>`).join('')}
         <p class="tp-note">${ctx.networked
           ? 'Read off the board, and added by itself when Settle Task control is pressed, so there is nothing to add by hand.'
           : 'Read off the board.<br>The +1 buttons stay for anything you settle by hand.'}</p>`
      : `<p class="tp-note">${settled ? '✓ This round\'s score has been settled.' : 'Nothing scores from the board this round.'}${ctx.networked ? '' : '<br>The +1 buttons stay for anything you settle by hand.'}</p>`}`;
  // The last round ends the game rather than rolling into another one. Without
  // this "Finish the game" started Round 6 and the match never ended at all.
  if (last && all) return resultPanel(ctx, vp);
  return head('End Phase', `Round ${s.round.n} wraps up`, '', true)
    + `<div class="tp-body">${rows}${score}</div>
      <div class="tp-foot">${advanceBtn(ctx, last ? 'Finish the game' : `Start Round ${s.round.n + 1}`, !all)}</div>`;
}

// What the game came to, and the offer to keep it. Recording is opt-in and
// never blocks ending: the match happened whether or not the server hears
// about it.
function resultPanel(ctx: HudCtx, vp: { s1: number; s2: number }): string {
  // Most Victory Points wins, but a tie goes to Mech Parts and Drones left on
  // the board and only a tie in both is a real draw (5.2.4). Deciding on VP
  // alone called a win a draw — and recorded it as one.
  const res = gameResult(normaliseTasks(ctx.state.tasks), ctx.state.tokens, lowValueOf(ctx.data));
  const winner = res.winner;
  // A concession decides the game whatever the scoreline (ruling I1).
  const conceded = normaliseTasks(ctx.state.tasks).conceded;
  const verdict = conceded && winner
    ? `${esc(squadLabel(winner))} wins: ${esc(squadLabel(conceded))} conceded`
    : winner
      ? `${esc(squadLabel(winner))} wins ${Math.max(vp.s1, vp.s2)}–${Math.min(vp.s1, vp.s2)}`
      : `A draw at ${vp.s1} VP each`;
  const rows = (['s1', 's2'] as Side[])
    .map((side) => `<div class="dialrow"><span class="nm ${side}">${esc(squadLabel(side))}</span><span class="pickchip${winner === side ? ' set' : ''}">${vp[side]} VP</span></div>`)
    .join('');
  const foot = ctx.solo
    ? `<button class="bigbtn" data-act="soloagain">Play again</button>
       <button class="bigbtn ghost2" data-act="sololeave" style="margin-top:6px">Back to the board</button>`
    : recorded
    ? '<p class="tp-note">Saved to both accounts.</p><button class="bigbtn ghost2" data-act="endmatch">Close the table</button>'
    : `<p class="tp-note">${esc(recordNote ?? 'Keep it on your record, or just close the table.')}</p>
       <button class="bigbtn" data-act="record"${recording ? ' disabled' : ''}>${recording ? 'Recording…' : 'Record this match'}</button>
       <button class="bigbtn ghost2" data-act="endmatch" style="margin-top:6px">Close the table</button>`;
  return head('Game over', verdict, `${ctx.state.round.n} rounds played.`, true)
    + `<div class="tp-body">${rows}<p class="tp-dim">${esc(res.why)}.</p></div><div class="tp-foot">${foot}</div>`;
}

// Watching, not playing. This owns the whole turn panel and comes before every
// other branch, because every one of them is a question put to a player who
// holds a seat — and a spectator holds none.
//
// Read-only is not a matter of hiding buttons. `mine()` answers true for a
// seatless client and `me()` falls back to whoever's turn it is, so without
// this branch a watcher is handed the CURRENT PLAYER's panel: their clicks
// would apply to their own board, never travel, and their view would drift
// away from the game in silence. send() refuses them as well; this is the half
// that means they are never asked in the first place.
function watchPanel(ctx: HudCtx): string {
  const s = ctx.state;
  const sc = ensureScript(s);
  const su = normaliseSetup(s.setup);
  // The round track reads "Round 1 · Command" all through setup, because the
  // loop has not started yet — echoing it here would tell a watcher a phase is
  // being played while the players are still placing units.
  const body = !su || su.stage !== 'done'
    ? '<p class="tp-note">The players are still setting the table: battlefield, Tasks, then edges and deployment.</p>'
    : `<p class="tp-note">Round ${s.round.n}, ${esc(PHASES[s.round.phase])} Phase. It is <b class="${sc.turn}">${esc(squadLabel(sc.turn))}</b>'s turn.</p>
       <p class="tp-dim">Everything both players do lands here as it happens. Nothing on this screen can change their board.</p>`;
  return head('Watching', 'Spectator', 'You hold no seat at this table.', false)
    + `<div class="tp-body">${body}</div><div class="tp-foot"></div>`;
}

// Your unit is being shot at, and the defence dice are yours to roll. Both
// players watch the same faces land — the roll goes through the server and
// into the shared feed — and the answer carries them back to the attacker's
// pipeline. This outranks nearly everything: the attack cannot move until it
// is answered, and the attacker is waiting.
function defensePanel(ctx: HudCtx): string {
  const s = ctx.state;
  const call = ensureScript(s).combat!;
  const attacker = s.tokens.find((t) => t.uid === call.attackerUid);
  const target = s.tokens.find((t) => t.uid === call.targetUid);
  const a = attacker && actionOn(ctx, attacker, call.actionId);
  const pool = `${call.white} White${call.blue ? ` + ${call.blue} Blue` : ''}`;
  // Armor Piercing (6.2.1) is the one adjustment this panel HAS to explain.
  // `call.white` arrived over the wire already reduced — combat.ts took the
  // dice off before callDefense was sent — so without this the defending player
  // is simply handed a smaller number than their Armor and told to roll it.
  // Every other term in the pool is either visible on their own card or is a
  // Token they can see; this one lives on the ENEMY's weapon.
  const ap = attacker && a ? armorPiercing(ctx.data, attacker, a) : null;
  const apNote = ap && ap.total
    ? `<p class="tp-dim">${esc(armorPiercingNote(ap, target?.label ?? 'Your unit'))} Those dice are already off the number above.</p>`
    : '';
  // When the attacker's window is mirrored on this screen, the roll button
  // lives in it — everything about the attack in one place. The turn panel
  // only points there. The button stays HERE when no mirror was published,
  // so an attacker on an older build still gets an answer.
  const mirrored = !!ensureScript(s).combatView;
  return head('Your move', `${esc(target?.label ?? 'Your unit')} is under fire`,
    `${esc(attacker?.label ?? 'The enemy')} attacks with ${esc(a?.name?.en || call.actionId)}.`, true)
    + `<div class="tp-body">
        <p class="tp-note">${mirrored
          ? `The combat window has the attack, and your defence roll (<b>${esc(pool)}</b>) is in it.`
          : `Roll your defence: <b>${esc(pool)}</b>. Both players see the dice land, and the attack resolves once they do.`}</p>
        ${apNote}
      </div>
      <div class="tp-foot">${mirrored ? '' : `<button class="bigbtn" data-act="rolldefense">${ICON_DICE} Roll ${esc(pool)}</button>`}</div>`;
}

function panelHtml(ctx: HudCtx): string {
  const s = ctx.state;
  if (ctx.networked && !ctx.seat) return watchPanel(ctx);
  // The owed defence roll, for the seat that owns the unit being shot at. It
  // has to come before combatBusy() — the DEFENDER is not combat-busy, their
  // helper is not running — and before every phase panel, because the whole
  // table is waiting on this one press.
  {
    const call = ensureScript(s).combat;
    if (call && !call.faces) {
      const target = s.tokens.find((t) => t.uid === call.targetUid);
      if (target && mine(ctx, target.side) && ctx.seat) return defensePanel(ctx);
    }
  }
  // A launch is waiting on a square, and a grant on an Ally: both are questions
  // already asked, so they come before whatever the phase would otherwise show.
  // An attack in the helper owns the screen until it is resolved; the turn
  // panel says so rather than offering a second set of damage buttons beside it.
  // A dropped Black Box is asked for as the attack that caused it resolves
  // (5.3.1), after any Forced Movement (FAQ E19), while the combat window may
  // still be open, so it has to outrank that window's own panel — the helper
  // keeps the dice, this keeps the question.
  if (boxDrop) return boxDropPanel(ctx);
  if (ctx.combatBusy()) {
    return head('Your move', 'Resolving the attack', 'The combat window has the dice.', true)
      + '<div class="tp-body"><p class="tp-note">The combat window has it. Everything it settles is applied for you<br>and reaches the other player on its own.</p></div><div class="tp-foot"></div>';
  }
  // A CONCESSION ENDS THE GAME, and outranks every question below it because
  // none of them can matter any more. Losing every unit does NOT: FAQ P21 has
  // the game run its rounds, the survivor playing on alone to score, and the
  // Victory Points decide (ruling I1; audit Phase 6, B8). This line used to end
  // the match the moment a squad had no Mech left, from OTTO's earlier report.
  //
  // Below boxDrop and the combat window on purpose: the Black Box a dying Mech
  // drops is asked for as the attack that killed it resolves (5.3.1), judged at
  // the base its Penetration stamped, since the Mech itself is gone (audit
  // Phase 6, F1), and the helper is still holding the dice that finished the
  // job. Both settle first, and this is waiting when they do.
  if (normaliseTasks(s.tasks).conceded) return resultPanel(ctx, normaliseTasks(s.tasks).vp);
  // A Blink is mid-Action and owes its two facing answers before anything else
  // makes sense, so it takes the panel until it is finished or cancelled.
  if (blinkPlan) return blinkPanel(ctx);
  // Mines before Boxes, matching M7's sequence: the Mine goes down on the way
  // through, and only then does the Mech finish entering the last Grid.
  if (minePick) return minePickPanel(ctx);
  if (boxPick) return boxPickPanel(ctx);
  // A Tactics Card is played into a moment, so its two questions come before
  // whatever the phase would otherwise be asking.
  if (tacticPlan) return tacticPanel(ctx);
  // A rollback request pauses the table for both seats: nothing else on this
  // board is worth doing until it is answered, and the asker is waiting.
  if (ensureScript(s).rollback) return rollbackPanel(ctx);
  if (launchPlan) return launchPanel(ctx);
  if (launchPick) return launchPickPanel(ctx);
  // A Counter-roll is a live two-player exchange, so it outranks everything
  // else on both screens until it is closed -- and it is resolved in the COMBAT
  // WINDOW now, beside the attack it is a sibling of, so the turn panel hands
  // off to it exactly as it does for an attack rather than drawing a second set
  // of dice beside it.
  if (ensureScript(s).counter) {
    return head('Your move', 'Electronic Counter-roll', 'The combat window has the dice.', true)
      + '<div class="tp-body"><p class="tp-note">The combat window has it. Everything it settles is applied for you<br>and reaches the other player on its own.</p></div><div class="tp-foot"></div>';
  }
  if (ewPick) return ewPanel(ctx);
  if (crushPlan?.queue.length) return crushPanel(ctx);
  if (resupplyPick) return resupplyPanel(ctx);
  if (linkPick) return linkPanel(ctx);
  if (cleanPick) return cleanPanel(ctx);
  if (terminalPick) return terminalPanel(ctx);
  if (manifestPick) return manifestPanel(ctx);
  if (formPick) return formPanel(ctx);
  if (repairPick) return repairPanel(ctx);
  if (chargePlan) return chargePanel(ctx);
  if (discardPick) return discardPanel(ctx);
  if (stabilisePick) return stabilisePanel(ctx);
  if (shockPick) return shockPanel(ctx);
  if (attackPick) return attackPanel(ctx);
  if (overwatchPick) return overwatchPanel(ctx);
  if (smokePlan) return smokePanel(ctx);
  if (smokeOwedOf(ctx.state).length) return smokeChoicePanel(ctx);
  pushOnReady(ctx);
  if (shovePlan) return shovePanel(ctx);
  // A Detonation waits for the Interception its own flight owes (4.9): the
  // other seat's attempts at this Projectile come first. Its panel stood above
  // theirs, so the Explosion could be opened before them (audit Phase 7, P7D 5).
  const flightOwed = !!detonateNow && owedItems(ctx).some((x) => x.targetUid === detonateNow!.uid);
  if (detonateNow && !flightOwed) return detonatePanel(ctx);
  // Interception fires the instant a Projectile is Launched and is resolved
  // before play goes on (4.9), so it outranks the phase — but only while there
  // is something drawable. Dead debt, whose Part or target has left the board,
  // must never take the panel over and strand the table.
  if (interceptNow || interceptPick || owedItems(ctx).length) return interceptPanel(ctx);
  // Martyrdom (ZHDR-302). "When this unit is destroyed, immediately detonate" —
  // so it outranks the end-of-attack debts below it, which wait for the whole
  // Action to finish. Derived off the board, like the Mine blast, and shown to
  // the OWNER because it is their unit that acts.
  if (martyrdomsOwed(ctx).length) return martyrdomPanel(ctx);
  // A reaction the DEFENDER owes itself for having been shot at — Emergency
  // Smoke. It waits in shared state until their own client answers it, which
  // is why it takes the panel here rather than on the attacker's screen.
  if (reactionsOwed(ctx).length) return reactionPanel(ctx);
  // A broken camouflage waits for its owner's say-so, but never blocks the
  // other player's view of the phase.
  if (revealsOwed(ctx).some((x) => mine(ctx, x.t.side))) return revealPanel(ctx);
  // A Mine that something has stepped on ALWAYS detonates, so it takes the
  // panel from its owner - the only side that may command it (M6). Nothing is
  // queued for this: the trigger is read off the board, so both clients agree
  // on it without a command and a rejoin re-derives it.
  if (mineTriggers(ctx).length) return minePanel(ctx);
  // An Immediate Projectile that came through its Interception detonates now
  // (4.7.4; A8), shown to its owner like the Mine.
  if (immediatesDue(ctx).length) return immediatePanel(ctx);
  // A Mine already under something outranks this: that blast is already owed,
  // and it may well remove the Pholcus before it ever gets to jump.
  if (autoBoomsOwed(ctx).length) return autoBoomPanel(ctx);
  // A grant is answered before anything else: the Action has been performed
  // and the Ally is owed its Opportunity.
  if (grantPick) return grantPanel(ctx);
  const su = normaliseSetup(s.setup);
  if (su && su.stage !== 'done') return setupPanel(ctx, su);
  const phase = PHASES[s.round.phase];
  if (s.round.phase === 1) return planningPanel(ctx);
  if (s.round.phase === 2) return actionPanel(ctx);
  if (isLoopPhase(phase)) return loopPanel(ctx, phase);
  return endPanel(ctx);
}



// The way back. Offers only ROUND/PHASE boundaries — never command indexes,
// because the two clients' undo rings are not the same length (setTiming is
// secret and never travels), and both agree on when a phase began.
//
// Points sealed by dice are listed and disabled rather than left out: a player
// can never rewind past a roll both of them watched land, and that is a rule
// rather than a glitch, so the list says so where it bites.
// THE QUIET FIXED HOME (U5; OTTO: "easy to find but not something that is in
// your face all the time"). One small icon at the end of the round strip - the
// same spot on every screen - and everything else behind the press: the
// one-press last-action request, the unit timeline, the phase starts. This
// REPLACED two panel-foot offers that were both halves of his complaint at
// once: in the face on those two screens, invisible everywhere else. A pending
// ask still pauses the whole table through rollbackPanel - the quietness is
// only the entry point, never an ask in flight.
let undoOpen = false;

function undoChrome(ctx: HudCtx): string {
  // A rollback is a bargain struck between the two players. A watcher is not a
  // party to it: they cannot ask, and nobody has to answer them. send() refuses
  // the request anyway — this is so it is never put in front of them.
  if (!ctx.networked || !ctx.seat) return '';
  // Against the computer too: its seat answers an ask, and agrees (the AI
  // plan's M9.4; owed.ts rollbackOwed).
  const sc = ensureScript(ctx.state);
  const trig = `<button class="undo-trig${undoOpen ? ' on' : ''}" data-act="undomenu" title="Walk the table back…" aria-label="Walk the table back">↩</button>`;
  if (!undoOpen || sc.rollback) return trig;
  // The HOST's list, not this client's: it is the host that rewinds, so it is
  // the host's ring that decides what can be returned to. Read out of shared
  // state, so both seats are looking at the same menu.
  const pts = sc.rollbackCatalog;
  const list = pts.slice().reverse();
  const units = list.filter((p) => p.seq !== undefined);
  const phases = list.filter((p) => p.seq === undefined).slice(0, 6);
  // Sealed and passed-over targets stay on the list, disabled with the reason.
  // Dropping them made the v1 menu quietly get shorter after a roll, which
  // reads as the feature breaking rather than as the rule it is - and OTTO's
  // ruling wants the line VISIBLE so players learn where it sits.
  const unitRow = (p: RollbackPoint, primary: boolean): string => {
    const why = p.sealed
      ? 'Dice were rolled inside this action. A rollback never reaches past a roll.'
      : !p.available
        ? 'Dice have been rolled since this. A rollback never reaches past a roll.'
        : '';
    const name = esc(p.label ?? 'an action');
    if (why) return `<button class="undo-row" disabled title="${esc(why)}">${name}<span class="ct">dice rolled</span></button>`;
    return `<button class="undo-row${primary ? ' primary' : ''}" data-rb="u" data-seq="${p.seq}" data-round="${p.round}" data-phase="${p.phase}" data-label="${name}">${primary ? `Undo last action<span class="ct">${name}</span>` : name}</button>`;
  };
  const first = units.find((p) => p.available && !p.sealed);
  const rest = units.filter((p) => p !== first).slice(0, 8);
  const here = (p: { round: number; phase: number }) => p.round === ctx.state.round.n && p.phase === ctx.state.round.phase;
  const phaseRows = phases.map((p) => {
    const label = here(p)
      ? `Start of this ${PHASES[p.phase]} Phase`
      : `Round ${p.round}, ${PHASES[p.phase]} Phase`;
    return p.available
      ? `<button class="undo-row" data-rb="${p.round}:${p.phase}">${label}</button>`
      : `<button class="undo-row" disabled title="A rollback never reaches past a die roll.">${label}<span class="ct">dice rolled</span></button>`;
  }).join('');
  const body = !units.length && !phases.length
    ? '<p class="undo-note">Nothing to return to yet.</p>'
    : `${first ? unitRow(first, true) : ''}
       ${rest.length ? `<div class="undo-h">Recent actions</div>${rest.map((p) => unitRow(p, false)).join('')}` : ''}
       ${phaseRows ? `<div class="undo-h">Phase starts</div>${phaseRows}` : ''}
       <p class="undo-note">${ctx.solo ? 'The computer answers, and agrees, before anything moves.' : 'Both players have to agree: the other side answers before anything moves.'}</p>`;
  return `${trig}<div class="undo-pop">${body}</div>`;
}

// The rollback handshake. A shared board cannot be rewound by one player, so
// one side asks and the other agrees — and the asker gets a waiting screen
// rather than a silent board.
function rollbackPanel(ctx: HudCtx): string {
  const ask = ensureScript(ctx.state).rollback!;
  // A unit ask is named by what it undoes; a phase ask by where it returns to.
  const to = ask.seq !== undefined
    ? `before “${ask.label}”`
    : `round ${ask.round}, ${PHASES[ask.phase]} Phase`;
  if (mine(ctx, ask.by)) {
    return head('Rollback', 'Waiting on an answer', `You asked to go back to ${esc(to)}.`, false)
      + `<div class="tp-body">${waiting(ask.by === 's1' ? 's2' : 's1', 'answering your rollback request')}</div>
        <div class="tp-foot"><button class="bigbtn ghost2" data-rb="cancel">Withdraw</button></div>`;
  }
  return head('Rollback', `${esc(squadLabel(ask.by))} asks to go back`, `To ${esc(to)}. Everything since then is undone for both of you.`, true)
    + `<div class="tp-body">
        <p class="tp-note">Agreeing rewinds both boards. Dice already rolled are not part of this. A rollback never reaches past a roll.</p>
      </div>
      <div class="tp-foot">
        <button class="bigbtn" data-rb="accept">Accept and roll back</button>
        <button class="bigbtn ghost2" data-rb="decline">Decline</button>
      </div>`;
}

// The last roll drawn. Anything newer than this has not been on screen yet and
// gets its one tumble; everything else is redrawn as it stands, so a roll does
// not re-roll itself every time something else on the page changes.
let feedSeen = 0;

// One die: its face's icons laid out in a row. They have to sit side by side —
// a face carrying two Hit icons drawn in one place looks like a single broken
// symbol, and reads as a die showing something it never showed.
function dieHtml(ctx: HudCtx, d: { color: string; face: number }): string {
  const face = ctx.diceData?.dice[d.color as DieColor]?.faces[d.face] ?? [];
  const icons = face.map((ic) => iconSvg(ic, 15)).join('');
  return `<span class="die die-${esc(d.color)}">${icons || '<span class="die-blank">·</span>'}</span>`;
}

// The naming step. One question at a time, asked of whoever the card says
// makes the choice, and the other player watches it happen — the freeplay
// guide asks the same questions in the same order, it just never has to
// decide whose screen to put them on.
function designatePanel(ctx: HudCtx, owed: Designation[]): string {
  const s = ctx.state;
  const mine = owed.filter((d) => !ctx.seat || d.by === ctx.seat);
  const now = mine[0] ?? owed[0];
  const theirCall = !!ctx.seat && now.by !== ctx.seat;
  const title = now.what === 'zone' ? `${now.label}: which Tactical Zone?`
    : now.what === 'leader' ? 'Designate your Commander'
      : `${esc(now.label)}: which Mech?`;
  const why = now.what === 'leader'
    ? 'Destroying the enemy Commander scores 10 VP and ends the game at once (5.2.3).'
    : now.side === now.by
      ? 'Named now, before anything deploys (5.2.3).'
      : `${esc(squadLabel(now.side))} is playing for this, so you name the Mech (5.2.3).`;
  if (theirCall) {
    return head('Setup', 'Task Setup', 'Every Task names its Mech or Zone before anything deploys (5.2.3).', false)
      + `<div class="tp-body">${waiting(now.by, now.what === 'zone' ? 'naming a Tactical Zone' : 'naming a Mech')}
        ${designationSummary(ctx, owed)}</div><div class="tp-foot"></div>`;
  }
  // The choice is sent as the squad the card says makes it, not as whoever is
  // to move: solo, nobody holds a seat, and Behead is named by the squad that
  // does not own the Mech.
  const rows = now.what === 'zone'
    ? missionZones(ctx.data, s)
      .map((z) => `<button class="rowwide" data-desigzone="${esc(z.id)}" data-desigby="${now.by}">${esc(z.name)}</button>`)
      .join('')
    : s.tokens
      .filter((t) => t.kind === 'mech' && t.side === now.owner)
      .map((t) => `<button class="rowwide" data-desigmech="${t.uid}" data-desigfor="${now.side}" data-desigby="${now.by}" data-desigwhat="${now.what}">${esc(t.label)}<span class="ct">${esc(squadLabel(t.side))}</span></button>`)
      .join('');
  return head('Your move', title, why, true)
    + `<div class="tp-body">${rows}${designationSummary(ctx, owed)}</div><div class="tp-foot"></div>`;
}

// What the whole step is still waiting on, so neither player is left guessing
// why the game has not started.
function designationSummary(ctx: HudCtx, owed: Designation[]): string {
  if (owed.length < 2) return '';
  const rows = owed.slice(1)
    .map((d) => `<div class="dialrow"><span class="nm ${d.side}">${esc(d.label)}</span><span class="tp-dim">${esc(squadLabel(d.by))} to name</span></div>`)
    .join('');
  return `<div class="tp-gap"></div>${rows}`;
}

// The other player's move, slid rather than snapped. They watched their unit
// walk the route; this is the same walk seen from the other chair, which is
// what makes a move read as something that happened rather than a jump cut.
// `via` is the route the mover actually walked. Without it the walk is a
// straight line from A to B, which slid a Mech through the wall it had just
// spent its Movement going around.
export function animateRemoteMove(
  uid: number,
  from: { col: number; row: number },
  to: { col: number; row: number },
  via?: { col: number; row: number }[],
): void {
  if (!board || (from.col === to.col && from.row === to.row)) return;
  const route = via?.length ? [from, ...via] : [from, to];
  // The command has already landed, so a render is moments away and
  // renderTokens would replace the very element being animated — which is why
  // the other player saw a snap while the mover saw a walk. Hold the token
  // layer still for the length of the walk and redraw when it finishes.
  animatingUid = uid;
  board.animateMove(uid, route, () => {
    // Two moves arriving back to back would have the first release the hold
    // out from under the second, so only the walk that set it clears it.
    if (animatingUid === uid) animatingUid = null;
    if (hudRef) renderBoard(hudRef);
  });
}

// Whether a unit is still being walked across this board. A computer seat
// waits for the walk to end before it does anything more (solo.ts).
export function walking(): boolean {
  return animatingUid !== null;
}

// ---------- launching a Projectile (rulebook 4.7) ----------
//
// The unit card picks the Action and the Projectile; all that is left is where
// it lands. Freeplay takes the board over with startLaunch for the same reason —
// a command that needs a square cannot be sent from a card alone — and this is
// the same flow: only legal Landing Points are offered, Volley X may place
// several off one Action, and the last one can be taken back before it counts.

let launchPlan: {
  uid: number;
  actionId: string;
  cardId: string;
  label: string;
  // Shots left in the volley and the ones already down, so the last can be
  // taken back with the Ammo that paid for it.
  left: number;
  placed: number;
  placedUids: number[];
  placedSizes: number[];
  // Which magazine paid each placement (the Pod's, or the Ammunition Pack's
  // under 086_B), so a take-back refunds that one.
  paidPools: string[];
  // A 1x3 line unit's facing (an AS3 wall, the Turtle Shell), picked in the
  // panel before the Landing Point; the launcher's own until then.
  facing?: Facing;
} | null = null;

export function startLaunchPlan(uid: number, actionId: string, cardId: string, label: string): void {
  const ctx = hudRef;
  if (!ctx) return;
  const t = ctx.state.tokens.find((x) => x.uid === uid);
  const a = t ? actionOn(ctx, t, actionId) : undefined;
  if (!t || !a) return;
  // Volley X caps the shots per Action and each one spends an Ammo Token, so
  // the real cap is whichever runs out first: turn.ts launchShots, the count a
  // seat with no plan reads too.
  const shots = turn.launchShots(ctx.data, ctx.state, t, a, actionId);
  if (shots <= 0) {
    ctx.noteNow(`${a.name?.en || actionId} has no Ammo Tokens left, so it cannot be performed (4.13).`);
    // Same as the branch that sent us here: no tool, no payment.
    dropAction();
    ctx.refresh();
    return;
  }
  launchPlan = { uid, actionId, cardId, label, left: shots, placed: 0, placedUids: [], placedSizes: [], paidPools: [] };
  ctx.refresh();
}

// A Landing Point is a Grid within the Action's Range. Direct Fire needs sight
// of it and cannot pick a Grid terrain fills; Fire in arc needs neither.
// Mirrors landingCandidates in main.ts.
// The launcher's own Opportunity, for its [Stationary] reach (audit Phase 4, E6).
function oppFor(ctx: HudCtx, uid: number): Opportunity | null {
  const o = ensureScript(ctx.state).opp;
  return o?.uid === uid ? o : null;
}

function landingCandidates(ctx: HudCtx): { c: number; r: number; ok: boolean }[] {
  const m = launchPlan;
  if (!m) return [];
  const t = ctx.state.tokens.find((x) => x.uid === m.uid);
  const a = t ? actionOn(ctx, t, m.actionId) : undefined;
  if (!t || !a) return [];
  return turn.landingGrids(ctx.data, ctx.state, t, a);
}

function placeLaunched(ctx: HudCtx, c: number, r: number): void {
  const m = launchPlan;
  if (!m) return;
  // A spent volley stays open only for the undo. Without this line a click in
  // that state launched a Projectile the volley never had - the ammo check
  // catches it for tracked magazines, but an Action with no printed Ammo has
  // nothing else saying no.
  if (m.left <= 0) return;
  const t = ctx.state.tokens.find((x) => x.uid === m.uid);
  const card = ctx.data.byId.get(m.cardId);
  if (!t || !card) return;
  // Where it stands in that Grid (a 1x3 line across the facing picked in the
  // panel, a Mine clear of terrain) and the command that launches it there are
  // read in turn.ts launchShot, the command a seat with no panel sends too.
  const placed = turn.launchShot(ctx.data, ctx.state, t, m.actionId, card, { c, r }, m.label, m.facing);
  if (!placed.ok) {
    ctx.noteNow(placed.why);
    ctx.refresh();
    return;
  }
  const shot: Command = placed.cmd;
  // A refused launch must not have cost anything, so the Ticks are only paid
  // once this one is going through. The first Projectile down is the Action;
  // the rest of a Volley ride on the same Ticks and commitAction is a no-op.
  if (!ctx.check(shot).ok) { ctx.send(shot); ctx.refresh(); return; }
  commitAction(ctx);
  const before = ctx.state.tokens.length;
  const pool = ammoPay(ctx.data, ctx.state, t, m.actionId).poolId;
  const v = ctx.send(shot);
  if (!v.ok) { ctx.refresh(); return; }
  m.paidPools.push(pool);
  // A Missile Group lands as several Units off one launch (6.2): each is owed
  // its own Interception, and taking the placement back takes them all.
  m.placedUids.push(...ctx.state.tokens.slice(before).map((x) => x.uid));
  m.placedSizes.push(Math.max(1, ctx.state.tokens.length - before));
  m.placed++;
  m.left--;
  // A single shot closes on its own; a volley stays open once it is spent so
  // the last Projectile can still be taken back before it counts.
  const ammoLeft = ammoAvailable(ctx.data, ctx.state, t, m.actionId);
  const spent = m.left <= 0 || (ammoLeft !== undefined && ammoLeft <= 0);
  if (spent && m.placed + m.left <= 1) finishLaunchPlan(ctx);
  else ctx.refresh();
}

// Interception is only owed once the launch is finished, so taking one back
// before then just undoes the placement and the Ammo that paid for it.
function undoLaunched(ctx: HudCtx): void {
  const m = launchPlan;
  if (!m || !m.placedUids.length) return;
  const size = m.placedSizes.pop() ?? 1;
  const gone = m.placedUids.splice(-size, size);
  const t = ctx.state.tokens.find((x) => x.uid === m.uid);
  if (t) {
    for (const uid of gone) ctx.send({ kind: 'despawn', seat: t.side, uid: t.uid, targetUid: uid });
    ctx.send({ kind: 'restoreAmmo', seat: t.side, uid: t.uid, actionId: m.paidPools.pop() ?? m.actionId });
  }
  m.placed--;
  m.left++;
  ctx.refresh();
}

function finishLaunchPlan(ctx: HudCtx): void {
  const m = launchPlan;
  launchPlan = null;
  // Stopping with nothing placed is a cancel, and the Ticks are still unspent.
  if (!m?.placed) dropAction();
  board?.clearHighlights();
  if (!m) { ctx.refresh(); return; }
  const owner = ctx.state.tokens.find((x) => x.uid === m.uid);
  const born = m.placedUids
    .map((uid) => ctx.state.tokens.find((x) => x.uid === uid))
    .filter((x): x is Token => !!x);
  // Only a LAUNCHED projectile triggers Interception (FAQ M20).
  if (owner && born.length && turn.launchTriggersInterception(ctx.data, owner, m.actionId)) queueInterceptsFor(ctx, owner, born);
  // 4.7.4, the Immediate type: it detonates as it lands (audit Phase 4, G8),
  // after any Interception it triggered (4.9). Mirrors main.ts
  // detonateOnLanding; a volley's others go off from their own cards.
  const card = ctx.data.byId.get(m.cardId);
  const now = card ? immediateDetonation(card) : null;
  if (now && born.length) {
    const owed = ensureScript(ctx.state).intercepts.some((x) => born.some((p) => p.uid === x.targetUid));
    if (owed) {
      ctx.noteNow(`${m.label} detonates as it lands (4.7.4), once the Interception it triggered is resolved: open its Detonation from its card if it survives.`, 'table');
    } else {
      if (born.length > 1) ctx.noteNow(`${born.length} of them landed, and each detonates at once (4.7.4). The first opens now; open the others from their cards in turn.`, 'table');
      startDetonation(born[0].uid, now.id);
    }
  }
  ctx.refresh();
}

function launchPanel(ctx: HudCtx): string {
  const m = launchPlan!;
  const t = ctx.state.tokens.find((x) => x.uid === m.uid);
  const a = t ? actionOn(ctx, t, m.actionId) : undefined;
  const total = m.left + m.placed;
  const cands = landingCandidates(ctx);
  const sight = a ? needsSightToLanding(a) : false;
  // A 1x3 line stands across its facing, inside the Grid (OTTO, 2026-09-28).
  const lineFace = isLineUnit({ cardId: m.cardId }) ? (m.facing ?? t?.facing ?? 0) : null;
  const faceRow = lineFace === null ? '' : `<div class="dialrow"><span class="nm">Facing</span><div class="btnrow">${(['N', 'E', 'S', 'W'] as const)
    .map((lbl, i) => `<button class="rowbtn${lineFace === i ? ' on' : ''}" data-launchface="${i}">${lbl}</button>`).join('')}</div></div>
    <p class="tp-dim">${esc(m.label)} is a 1x3 line and stands across its facing, inside the Grid: facing ${lineFace % 2 ? 'East or West it runs North-South' : 'North or South it runs East-West'}.</p>`;
  const foot = [
    m.placed ? `<button class="bigbtn ghost2" data-act="launchundo">↺ Take back the last one</button>` : '',
    `<button class="bigbtn${m.placed ? '' : ' ghost2'}" data-act="launchcancel">${m.placed ? 'Stop here' : 'Cancel'}</button>`,
  ].join('');
  return head('Your move', `Launch ${esc(m.label)}`, `${esc(a?.name?.en || m.actionId)}${total > 1 ? ` · ${m.placed} of ${total} launched` : ''}.`, true)
    + `<div class="tp-body">
        ${faceRow}
        <p class="tp-note">${sight
          ? 'Direct Fire: the Landing Point must be a Grid this unit can see, and one terrain does not fill.'
          : 'Fire in arc, so no line of sight to the Landing Point is needed.'} A Landing Point is a Grid, not a unit. Nothing is targeted yet.</p>
        <p class="tp-dim">${cands.length} legal ${cands.length === 1 ? 'Grid' : 'Grids'} within Range ${t && a ? projectileReach(ctx.data, t, a, oppFor(ctx, t.uid)) : 0}. ${total > 1
          ? `Volley ${total} lets you place up to ${total}, one Ammo Token each, and you may stop early.`
          : 'One Ammo Token is spent.'}</p>
        ${cands.length ? '' : '<p class="tp-note">Nothing is in range and in sight, so there is nowhere legal to put it.</p>'}
      </div>
      <div class="tp-foot">${foot}</div>`;
}

// ---------- Interception (rulebook 4.9) ----------
//
// Launching an Aerial Unit hands every enemy Part carrying Intercept X in range
// an attempt at it, at once, wherever the round happens to be. The owed list
// lives in the shared script state, so both clients see the same debt and only
// the squad that owns the intercepting Parts is asked to pay it.
//
// The attack itself is the Match Centre's ordinary manual combat: the same
// pool roll and the same damage bookkeeping as any other shot. What 4.9 changes
// is who may be shot at (only the Aerial Unit that triggered it), that terrain
// never blocks the line to it and no Forward Arc is needed, that no Terrain or
// Unit Protection dice may be claimed, and that a survivor must be shot at
// again. A Smoke Screen over every line still takes the shot away (4.16, FAQ
// F3), which the card's door ignored until audit Phase 4, G4.

// The attempt on the table right now. `script.intercepts` says what is OWED;
// this says what is being resolved, and it is the acting unit for as long as
// it is set — an Interception is made outside the activation order.
let interceptNow: { uid: number; actionId: string; targetUid: number } | null = null;
// An attempt started from the unit card instead of the owed list, where nobody
// has named the target yet.
let interceptPick: { uid: number; actionId: string } | null = null;

export function startInterceptPick(uid: number, actionId: string): void {
  interceptPick = { uid, actionId };
  interceptNow = null;
  hudRef?.refresh();
}

function actionOn(ctx: HudCtx, t: Token, actionId: string): CardAction | undefined {
  return turn.actionOf(ctx.data, ctx.state, t, actionId);
}

// Mirrors noteInterception in main.ts, which is the reference implementation.
// The Range test is per ACTION rather than per unit, because one unit may carry
// two Intercept Parts of different Range and only the longer one reaches. It
// takes the whole volley, since the debt is owed once the launch is finished
// rather than once per Projectile put down.
function queueInterceptsFor(ctx: HudCtx, launcher: Token, born: Token[]): void {
  // Every Unit this Launch placed, whatever its flag (4.7.2): read in turn.ts
  // interceptsAfterLaunch, where a seat with no panel reads what its launch owes.
  const owed = turn.interceptsAfterLaunch(ctx.data, ctx.state, launcher, born);
  if (!owed.length) return;
  const defender: Side = launcher.side === 's1' ? 's2' : 's1';
  if (ctx.send({ kind: 'queueIntercepts', seat: launcher.side, items: owed }).ok) ctx.noteNow(`The launch triggers Interception: ${owed.length} attempt${owed.length === 1 ? '' : 's'} owed to ${squadLabel(defender)} (4.9).`, 'done');
}

// The owed attempts that can still be drawn. An attempt whose Part or target
// has left the board is dead debt: the guide skips those rows, and here they
// must not take the panel over either.
// ---------- Optical Camouflage reveals (4.12.2, FAQ I4/I5/I7/I10/I14) ----------
//
// Read off script.revealDue, which the command that caused each one records, so
// both seats owe the same Reveal. The owner answers with a click; the online
// table is strict, so there is no house-rule way out (audit Phase 3, F2).

// Only the blasts that may go now: a Mine a jumping Pholcus set off waits for
// its blast (1.9), so the panel falls through to that Detonation instead.
function mineTriggers(ctx: HudCtx): { trigger: MineTrigger; t: Token }[] {
  return blastsReady(ctx.data, ctx.state.tokens)
    .map((trigger) => ({ trigger, t: ctx.state.tokens.find((x) => x.uid === trigger.uid) }))
    .filter((x): x is { trigger: MineTrigger; t: Token } => !!x.t && mine(ctx, x.t.side));
}

function minePanel(ctx: HudCtx): string {
  const all = mineTriggers(ctx);
  if (!all.length) return '';
  // Simultaneous blasts from both squads go round-robin from this round's First
  // Player (Supplementary Rules 1.04, 1.9; units.ts blastTurn): only the squad on
  // turn resolves, and it picks which of its own, so each owed one has a button.
  const turn = blastTurn(ctx.data, ctx.state);
  const mineNow = all.filter((x) => !turn || x.t.side === turn);
  if (!mineNow.length) {
    return head('Waiting', 'Simultaneous damage',
      `${esc(squadLabel(turn!))} resolves one of its own blasts first, ${ctx.state.blastLast ? 'as the squads take turns' : "as this round's First Player"}; then the squads alternate (Supplementary Rules 1.04, 1.9).`, false)
      + `<div class="tp-body">${waiting(turn!, 'resolving a Detonation')}</div><div class="tp-foot"></div>`;
  }
  const x = mineNow[0];
  const caught = (y: typeof x): string => y.trigger.victims
    .map((u) => ctx.state.tokens.find((o) => o.uid === u)?.label)
    .filter((l): l is string => !!l)
    .join(', ') || 'nothing else';
  const order = turn && mineTriggersAll(ctx) > mineNow.length
    ? '<p class="tp-note">Both squads owe a blast: they resolve in turn, one at a time, from this round\'s First Player (Supplementary Rules 1.04, 1.9).</p>' : '';
  return head('Your move', mineNow.length > 1 ? `${mineNow.length} Mines to Detonate` : `${esc(x.t.label)} Detonates`,
    `${esc(x.trigger.why)}, and a Ground Unit never Crushes a Mine - it sets it off. The Explosion catches every Ground Unit in that Grid, ally or not, but not the Flying or Aerial units above it. It causes no Reveal, and a Mech whose Chassis survives finishes its Movement (FAQ M6/M19/M22).`, true)
    + `<div class="tp-body">${order}${mineNow.length > 1 ? '<p class="tp-note">Choose which of your own resolves first (1.9).</p>' : ''}${
      mineNow.map((y) => `<p class="tp-note">${esc(y.t.label)}: in the blast, ${esc(caught(y))}</p>`).join('')}</div>
       <div class="tp-foot">${mineNow.map((y) => `<button class="bigbtn" data-minego="${y.t.uid}" data-mineact="${esc(y.trigger.actionId)}">Resolve ${mineNow.length > 1 ? esc(y.t.label) : 'the Detonation (4.7.6)'}</button>`).join('')}</div>`;
}

// Every owed blast on the table, both squads', for the note that they take turns.
function mineTriggersAll(ctx: HudCtx): number {
  return blastsReady(ctx.data, ctx.state.tokens).length;
}

// An Immediate Projectile still standing with no Interception owed at it: it
// detonates as it lands (4.7.4), and one that came through its Interception
// waited to be opened by hand (audit Phase 5, A8). Derived off the board and
// shown to its OWNER, the Mine's seat rule.
function immediatesDue(ctx: HudCtx): { uid: number; actionId: string; t: Token }[] {
  return immediatesOwed(ctx.data, ctx.state.tokens, liveIntercepts(ctx.state))
    .map((x) => ({ ...x, t: ctx.state.tokens.find((o) => o.uid === x.uid) }))
    .filter((x): x is { uid: number; actionId: string; t: Token } => !!x.t && mine(ctx, x.t.side));
}

function immediatePanel(ctx: HudCtx): string {
  const x = immediatesDue(ctx)[0];
  if (!x) return '';
  return head('Your move', `${esc(x.t.label)} detonates`,
    'It detonates as it lands, once the Interception it triggered is resolved (4.7.4, 4.9).', true)
    + `<div class="tp-body"><p class="tp-dim">Resolving removes it from the board (4.7.5).</p></div>
       <div class="tp-foot"><button class="bigbtn" data-minego="${x.t.uid}" data-mineact="${esc(x.actionId)}">Resolve the Detonation (4.7.6)</button></div>`;
}

// FAQ M18.6: an Unfolded Pholcus with an enemy in range MUST Detonate in the
// Automatic Phase. Derived, phase-gated, and shown to its OWNER - the same seat
// rule the Mine blast follows, since it is that player's unit that acts.
// Deliberately NOT wired into the designation loop: the rule names one unit, so
// blocking the squad's Pass would over-reach and would miss a phase advance
// anyway. Reading the board catches both.
function autoBoomsOwed(ctx: HudCtx): { uid: number; actionId: string; targets: number[]; t: Token }[] {
  if (PHASES[ctx.state.round.phase] !== 'Automatic') return [];
  return autoDetonationsOwed(ctx.data, ctx.state.tokens)
    .map((x) => ({ ...x, t: ctx.state.tokens.find((o) => o.uid === x.uid) }))
    .filter((x): x is { uid: number; actionId: string; targets: number[]; t: Token } => !!x.t && mine(ctx, x.t.side));
}

// Martyrdom (ZHDR-302 N52 "Zealot"). Derived rather than queued: onDestroyed
// records the kill but leaves the token standing, so "owes a Detonation" is a
// fact both clients read off the board without a command. It clears itself —
// resolving despawns the unit (`destroyAfter`), and the read stops returning it.
function martyrdomsOwed(ctx: HudCtx): { uid: number; actionId: string; range: number; targets: number[]; t: Token }[] {
  return martyrdomOwed(ctx.data, ctx.state.tokens)
    .map((x) => ({ ...x, t: ctx.state.tokens.find((o) => o.uid === x.uid) }))
    .filter((x): x is { uid: number; actionId: string; range: number; targets: number[]; t: Token } => !!x.t && mine(ctx, x.t.side));
}

function martyrdomPanel(ctx: HudCtx): string {
  const x = martyrdomsOwed(ctx)[0];
  if (!x) return '';
  const names = x.targets
    .map((u) => ctx.state.tokens.find((o) => o.uid === u))
    .filter((t): t is Token => !!t)
    .map((t) => `${t.label}${t.side === x.t.side ? ' (ally)' : ''}`);
  // No skip button: the card says 立刻引爆 — immediately. The only choices are
  // inside the Detonation flow, which resolves one target at a time.
  return head('Your move', `${esc(x.t.label)} detonates`,
    'It was destroyed, so it blows up where it stands. The blast takes every Unit in range, allies included.', true)
    + `<div class="tp-body"><p class="tp-note">In range: ${esc(names.join(', ') || 'nothing')}</p>
        <p class="tp-dim">Each one takes a separate Explosion attack. Resolving removes the wreck from the board (4.7.5).</p></div>
       <div class="tp-foot"><button class="bigbtn" data-minego="${x.t.uid}" data-mineact="${esc(x.actionId)}">Resolve the Detonation</button></div>`;
}

function autoBoomPanel(ctx: HudCtx): string {
  const x = autoBoomsOwed(ctx)[0];
  if (!x) return '';
  const names = x.targets
    .map((u) => ctx.state.tokens.find((o) => o.uid === u)?.label)
    .filter((l): l is string => !!l);
  // Resolving is the only button. There is no "skip" here because the FAQ leaves
  // no choice — where the player DOES still choose is which of several tied
  // nearest targets it jumps to, and that happens inside the detonation flow.
  return head('Your move', `${esc(x.t.label)} must Detonate`,
    'An enemy is inside its attack range, and this is not a choice: it jumps to the target\'s Grid, Detonates there and is removed (FAQ M18.6).', true)
    + `<div class="tp-body"><p class="tp-note">In range: ${esc(names.join(', ') || 'nothing')}${
        names.length > 1 ? '<br>Tied for nearest, so you pick which.' : ''
      }</p>
        <p class="tp-dim">It is a Low Value Unit, so neither destroying it nor its self-Detonation scores (M8).</p></div>
       <div class="tp-foot"><button class="bigbtn" data-minego="${x.t.uid}" data-mineact="${esc(x.actionId)}">Resolve the Detonation (4.7.6)</button></div>`;
}

// The move bar, while a route is being drawn: the unit's own Maneuver or
// Movement Action, or one The Red Shoes steers (the reaction panel draws it then).
function moveBarHtml(ctx: HudCtx, t: Token, ticks = ''): string {
  if (!movePlan) return '';
  const drawn = movePlan.path.length - 1;
  return `${ticks}
      <div class="moveplan">
        <p class="tp-dim">${esc(movePlan.label)}</p>
        ${movePlan.steps <= 0
          ? `<p class="tp-note">${esc(t.label)}'s Chassis is destroyed, so it cannot move, but its Maneuver may still turn it (FAQ E4). Q or E turns it, then Turn on the spot.</p>`
          : `<p class="tp-note">${(() => {
          const p = movePlan!.preview ? Math.max(0, movePlan!.preview.length - 1) : drawn;
          if (p !== drawn) return `${drawn} → ${p} of ${movePlan!.steps} grids`;
          return drawn
            ? `${drawn} of ${movePlan!.steps} grids`
            : `Click a lit grid to move. Up to ${movePlan!.steps} grid${movePlan!.steps === 1 ? '' : 's'}.`;
        })()}</p>
        <p class="tp-dim">Click a lit grid to move there. Click further on to add a waypoint, right-click or Backspace steps back.</p>`}
        ${(() => {
          // The same sentence the freeplay hint uses, from the same helper.
          const leash = tetherNote(t, ctx.state.tokens);
          return leash ? `<p class="tp-note">${esc(leash)}</p>` : '';
        })()}
        ${(() => {
          // [Moving in Straight Line] (直线移动): the reach the route has only
          // while it keeps running one way. Said here because the overlay lights
          // the extra Grids and nothing else explains why they go dark on a turn.
          const bonus = straightLineBonus(movePlan!.actionId ? actionOn(ctx, t, movePlan!.actionId) : null);
          return bonus ? `<p class="tp-note">[Moving in Straight Line] +${bonus}: a route that runs one way the whole time reaches ${movePlan!.steps + bonus} Grids. Turn a corner and ${movePlan!.steps} is the limit.</p>` : '';
        })()}
        ${(() => {
          // Break Away, likewise from the one helper that also prices it. This
          // board never explained a short overlay from a Melee Lock at all;
          // LPA-20's Obstruct is the first lock that costs something a player
          // cannot count off the board, and the "or 1 Link" alternative is only
          // usable if the app says it exists.
          // A Crawl says why it lights only its own Grid, flown or walked (6.1;
          // ruled R2, audit Phase 7, P7B 14).
          const held = crawlHolders(ctx.data, t, movePlan.actionId ? actionOn(ctx, t, movePlan.actionId) : null, ctx.state.tokens, terrainOf(ctx));
          if (held.length) return `<p class="tp-note">${esc(`Melee Locked by ${held.map((x) => x.label).join(', ')}, and a Crawl cannot be used to Break Away (6.1): it may only turn in its Grid.`)}</p>`;
          const lock = movePlan.flying || t.aerial ? '' : breakAwayNote(ctx.data, t, ctx.state.tokens, terrainOf(ctx));
          return lock ? `<p class="tp-note">${esc(lock)}</p>` : '';
        })()}
        ${
          // The Ojs200's optional Flying Movement. A toggle rather than a
          // question up front, because the reachable grids redraw either way
          // and seeing the difference IS the decision. Flying cannot Crush
          // (FAQ E14), so the cost is spelled out rather than implied.
          movePlan.flightOptional
            ? `<button class="bigbtn ghost2" data-act="flytoggle" style="margin-top:6px">${
                movePlan.flying ? 'Flying · cannot Crush' : 'Move normally'
              }</button>
               <p class="tp-dim">${
                 movePlan.flying
                   ? 'Crossing terrain and Melee Locks freely. Tap to walk instead.'
                   : 'Tap to fly this Maneuver instead.'
               }</p>`
            : ''
        }
        ${turnRow(FACING_NAME[movePlan.facing], 'A pivot costs no Movement Range, but it is still Movement, so it happens inside this one.')}
        <button class="bigbtn" data-act="commitmove"${drawn || movePlan.turned ? '' : ' disabled'}>${drawn ? 'Confirm move' : 'Turn on the spot'}</button>
        <button class="bigbtn ghost2" data-act="cancelmove" style="margin-top:6px">Cancel</button>
      </div>`;
}

// ---------- Owed reactions: Emergency Smoke (FAQ B7/D10) ----------
//
// The attacker's client queued these into `script.reactions` when the whole
// Action finished; only the DEFENDER's client may answer one, because placing
// the Screens and spending the use are commands on their own unit.
function reactionsOwed(ctx: HudCtx): { t: Token; r: ScriptState['reactions'][number] }[] {
  const owed = ensureScript(ctx.state).reactions ?? [];
  return owed
    .map((r) => ({ t: ctx.state.tokens.find((x) => x.uid === r.uid)!, r }))
    // Dead debt — the unit has left the board entirely — must never strand the
    // table, the same guard the Interception queue carries.
    .filter((x) => !!x.t && mine(ctx, x.t.side));
}

// The KK9's Overwatch Strike, asked in two steps: the enemy in Range, then
// the Ally Mech that fires at it from its own reaction row (FAQ K15; audit
// Phase 5, F8).
let overwatchPick: { uid: number; actionId: string; targetUid?: number } | null = null;

function overwatchPanel(ctx: HudCtx): string {
  const m = overwatchPick!;
  const s = ctx.state;
  const kk9 = s.tokens.find((x) => x.uid === m.uid);
  const a = kk9 ? actionOn(ctx, kk9, m.actionId) : undefined;
  if (!kk9 || !a) return head('Overwatch Strike', 'It is no longer available', '', true) + '<div class="tp-body"></div><div class="tp-foot"><button class="bigbtn ghost2" data-act="owcancel">Close</button></div>';
  const reach = a.range ?? 0;
  if (m.targetUid === undefined) {
    const rows = s.tokens
      .filter((x) => x.side !== kk9.side && x.deployed !== false && alive(x) && rangeBetween(kk9, x).range <= reach)
      .map((x) => `<button class="rowwide" data-owtarget="${x.uid}">${esc(x.label)}<span class="ct">R${rangeBetween(kk9, x).range}</span></button>`)
      .join('');
    return head('Your move', `${esc(a.name?.en || m.actionId)}: which enemy?`, `Within Range ${reach} of ${esc(kk9.label)}.`, true)
      + `<div class="tp-body">${rows || `<p class="tp-note">No enemy is within Range ${reach}.</p>`}</div>
         <div class="tp-foot"><button class="bigbtn ghost2" data-act="owcancel">Cancel</button></div>`;
  }
  const foe = s.tokens.find((x) => x.uid === m.targetUid);
  const rows = s.tokens
    .filter((x) => x.side === kk9.side && x.kind === 'mech' && alive(x))
    // Greyed with the reason for the notice line (audit Phase 7, P7D 9).
    .map((x) => `<button class="rowwide" data-owmech="${x.uid}"${x.stance === 'shutdown' ? ` aria-disabled="true" data-why="${esc(`${x.label} is in Shutdown Stance, so it performs nothing (4.1.1).`)}"` : ''}>${esc(x.label)}<span class="ct">${x.stance === 'shutdown' ? 'Shutdown' : 'fires'}</span></button>`)
    .join('');
  return head('Your move', 'Which Ally Mech fires?', `At ${esc(foe?.label ?? 'the enemy')}, 1 Firing Action of any length, for no Ticks (FAQ K15). Then ${esc(kk9.label)} is removed.`, true)
    + `<div class="tp-body">${rows || '<p class="tp-note">No Ally Mech can fire.</p>'}</div>
       <div class="tp-foot"><button class="bigbtn ghost2" data-act="owcancel">Cancel</button></div>`;
}

function reactionPanel(ctx: HudCtx): string {
  const { t, r } = reactionsOwed(ctx)[0];
  const card = ctx.data.byId.get(t.cardId ?? '');
  const what = (card?.actions ?? []).find((a) => a.id === r.actionId);
  const name = what?.name?.en || what?.name?.zh || 'Emergency Smoke';
  // SCANNED (4.12.4 into 4.12.2). An enemy Scan succeeded against this unit, so
  // it is Revealed - but the Manifestation Movement that comes with the Reveal
  // is ITS player's choice, not the scanner's, which is the whole reason this
  // is a reaction rather than something the scanner's client applied outright.
  // Both halves travel as the one `reveal` command the picker already sends.
  // The attack behind a free Scan (FAQ I12): the Scan succeeded, the target is
  // Revealing (its player chooses where), and the attacker's declared Action
  // resumes against it once it has appeared. The Tick was paid at the
  // designation, so calling it off now refunds nothing (I11).
  if (r.kind === 'scanAttack') {
    const target = ctx.state.tokens.find((x) => x.uid === r.fromUid);
    const act = actionOn(ctx, t, r.actionId);
    const hidden = !!target && statusCount(target.statuses, 'camouflage') > 0;
    const note = target && act && !hidden
      ? losNote(t, target, { ...act, range: actionRange(ctx.data, ctx.state.tokens, t, act) }, terrainOf(ctx), ctx.state.tokens, ctx.state.smoke ?? [], true)
      : '';
    const blocked = note.includes('✕');
    return head(hidden ? 'Waiting' : 'Your move', `${esc(t.label)}: ${esc(act?.name?.en || r.actionId)}`,
      !target ? 'The target has left the board.'
        : hidden ? `The free Scan succeeded. ${esc(target.label)} is Revealing: its player chooses where it appears (4.12.4), and the attack resumes after that.`
          : `${esc(target.label)} has Revealed, so the declared attack resumes against it (FAQ I12).`, true)
      + `<div class="tp-body">${note ? `<p class="tp-note${blocked ? ' bad' : ''}">${esc(note)}</p>` : ''}${
        blocked ? '<p class="tp-dim">Where it appeared, the attack cannot be made (4.4.1). It ends; the Tick was spent at the designation (FAQ I11).</p>' : ''}</div>
         <div class="tp-foot">${target && !hidden && !blocked ? `<button class="bigbtn" data-reactgo="${t.uid}:${esc(r.actionId)}">Attack ${esc(target.label)}</button>` : ''}
         <button class="bigbtn ghost2" data-reactskip="${t.uid}:${esc(r.actionId)}" style="margin-top:6px">${blocked || !target ? 'The attack ends' : 'Call off the attack'}</button></div>`;
  }
  // The Red Shoes (TM35NA_B). The won Counter-roll hands this player one of
  // the Responder's own Maneuvers or Move Actions, at no Tick cost, and
  // Immobilized still stops it (ruled 2026-09-25, audit Phase 3, F19). It did
  // nothing on any page before.
  if (r.kind === 'control') {
    const target = ctx.state.tokens.find((x) => x.uid === r.fromUid);
    if (target && movePlan?.controller?.uid === t.uid && movePlan.uid === target.uid) {
      return head('Your move', `The Red Shoes: ${esc(target.label)}`, `${esc(t.label)} is steering ${esc(target.label)}.`, true)
        + moveBarHtml(ctx, target);
    }
    const stop = target ? immobilizedStop(target) : null;
    const reach = target ? maneuverRange(ctx.data, target) : 0;
    const moves = target && !stop ? controlledMoveActions(ctx.data, target) : [];
    return head('Your move', `${esc(t.label)}: The Red Shoes`,
      target
        ? `The Electronic Attack succeeded, so you take control of ${esc(target.label)} to perform one of its own Maneuvers or Move Actions. It costs its player no Tick.`
        : 'The unit has left the board, so there is nothing to steer.', true)
      + `<div class="tp-body">${stop ? `<p class="tp-note">${esc(stop)}</p>` : ''}${
        target && !stop
          ? `${reach > 0 ? `<button class="rowwide" data-controlgo="${t.uid}:${target.uid}:">Maneuver<span class="ct">Move ${reach}</span></button>` : ''}
             ${moves.map((a) => `<button class="rowwide" data-controlgo="${t.uid}:${target.uid}:${esc(a.id)}">${esc(a.name?.en || a.name?.zh || a.id)}<span class="ct">R${a.range || reach}</span></button>`).join('')}`
          : ''}</div>
         <div class="tp-foot"><button class="bigbtn ghost2" data-reactskip="${t.uid}:${esc(r.actionId)}">${target && !stop ? 'Leave it be' : 'Done'}</button></div>`;
  }
  if (r.kind === 'manifest') {
    const range = manifestationRange(ctx.data, t);
    return head('Your move', `${esc(t.label)} has been Scanned`,
      `An enemy Scan succeeded, so ${esc(t.label)} leaves the Optical Camouflage State (4.12.4).${
        range > 0
          ? ` Its marker was only a SUSPECTED position: choose where it really is, within Range ${range} counted orthogonally (Stealth ${range}).`
          : ' It has no Stealth value, so it appears where its marker stood.'
      }`, true)
      + `<div class="tp-body"></div>
         <div class="tp-foot"><button class="bigbtn" data-reactgo="${t.uid}:${esc(r.actionId)}">${range > 0 ? 'Reveal and Manifest' : 'Reveal it'}</button></div>`;
  }
  // The KK9's Overwatch Strike: 1 Firing Action at the designated enemy, and
  // no other, for no Ticks (FAQ K15; audit Phase 5, F8).
  if (r.kind === 'overwatch') {
    const foe = ctx.state.tokens.find((x) => x.uid === r.fromUid);
    const guns = tokenCards(ctx.data, t)
      .filter((x) => x.slot !== 'pilot' && (t.partStates[x.slot as PartSlot | 'main'] ?? 'intact') !== 'destroyed')
      .flatMap(({ card }) => card.actions ?? [])
      .filter((a) => a.type === 'Firing');
    return head('Your move', `${esc(t.label)}: Overwatch Strike`,
      `${esc(t.label)} may perform 1 Firing Action against ${esc(foe?.label ?? 'the designated enemy')} at once, and against no one else.`, true)
      + `<div class="tp-body"><p class="tp-dim">It costs no Ticks: it belongs to the card, not to an Action Opportunity.</p>
         ${foe ? guns.map((a) => `<button class="rowwide" data-overwatchgo="${t.uid}:${esc(a.id)}">${esc(a.name?.en || a.name?.zh || a.id)}<span class="ct">R${a.range ?? 0}</span></button>`).join('')
           || '<p class="tp-note">No Firing Action is left to make.</p>' : '<p class="tp-note">The designated enemy has left the board.</p>'}</div>
         <div class="tp-foot"><button class="bigbtn ghost2" data-reactskip="${t.uid}:${esc(r.actionId)}">Skip it</button></div>`;
  }
  // Riposte / Reposte (050 / ZHLA-202). Two halves, and the first is not
  // optional: taking it ENDS the attacker's Action Opportunity. Declining the
  // whole thing leaves their turn alone, which is why there is a Skip.
  if (r.kind === 'riposte') {
    const from = ctx.state.tokens.find((x) => x.uid === r.fromUid);
    // Punch/Kick is a Melee Action every Mech has (ruled R4; audit Phase 7,
    // P7B 6), and a "--" reach reads as printed rather than "R0".
    const melees = riposteMelees(ctx.data, t);
    return head('Your move', `${esc(t.label)}: ${esc(name)}`,
      `${esc(t.label)} parried, so ${esc(from?.label ?? 'the attacker')} must end its Action Opportunity at once, and then ${esc(t.label)} may perform a Melee Action immediately.`, true)
      + `<div class="tp-body"><p class="tp-dim">The Action costs no Ticks: it belongs to the card, not to an Action Opportunity. Pick the one to make.</p>
         ${melees.map((a) => `<button class="rowwide" data-ripostego="${t.uid}:${esc(a.id)}">${esc(a.name?.en || a.name?.zh || a.id)}<span class="ct">${a.range ? `R${a.range}` : 'R --'}</span></button>`).join('')
           || '<p class="tp-note">No Melee Action is left to make, so only the Opportunity ends.</p>'}</div>
         <div class="tp-foot"><button class="bigbtn" data-ripostego="${t.uid}:">End the Opportunity only</button>
         <button class="bigbtn ghost2" data-reactskip="${t.uid}:${esc(r.actionId)}" style="margin-top:6px">Skip it</button></div>`;
  }
  // Defense Reaction (ZHLA-101 / ZHLA-301). Free -- no Token, no Ammo -- so the
  // only question is whether they want it.
  if (r.kind === 'stance') {
    return head('Your move', `${esc(t.label)}: ${esc(name)}`,
      `A Part of ${esc(t.label)} was Penetrated, so it may change to Defensive Stance immediately.`, true)
      + `<div class="tp-body"><p class="tp-dim">Now in ${esc(t.stance)} Stance. This is the one Stance change 4.1 allows outside the start of an Action Opportunity, and it costs nothing.</p></div>
         <div class="tp-foot"><button class="bigbtn" data-reactgo="${t.uid}:${esc(r.actionId)}">Change to Defensive</button>
         <button class="bigbtn ghost2" data-reactskip="${t.uid}:${esc(r.actionId)}" style="margin-top:6px">Stay in ${esc(t.stance)}</button></div>`;
  }
  // Target Tracing (174). A debt written before this existed carries no kind at
  // all, and those are all Emergency Smoke.
  if (r.kind === 'trace') {
    const from = ctx.state.tokens.find((x) => x.uid === r.fromUid);
    // The printed value, NOT electronicStrength: this number is the 4.11.2 gate
    // ("an Electronic Value of 0 cannot Initiate"), which reads the stat. The EW
    // Suppression aura reduces the ROLL, so it belongs to the pool the
    // Counter-roll panel offers, not to the question of whether one may open.
    const ev = electronicValue(ctx.data, t, loanedParts(ctx.data, ctx.state.tokens, t));
    return head('Your move', `${esc(t.label)}: ${esc(name)}`,
      `${esc(t.label)} was attacked by ${esc(from?.label ?? 'the attacker')}, so it may spend 1 Command Token to open an Electronic Counter-roll back at them. Succeed and they lose 1 Link.`, true)
      + `<div class="tp-body"><p class="tp-dim">Electronic Value ${ev}. Range does not apply: this answers the attack wherever it came from.</p>
         ${!from ? '<p class="tp-note">The attacker has left the board, so there is nothing to trace.</p>' : ''}
         ${ev <= 0 ? '<p class="tp-note">An Electronic Value of 0 cannot Initiate a Counter-roll (4.11.2).</p>' : ''}</div>
         <div class="tp-foot">${from && ev > 0 ? `<button class="bigbtn" data-reactgo="${t.uid}:${esc(r.actionId)}">Spend a Command Token and roll</button>` : ''}
         <button class="bigbtn ghost2" data-reactskip="${t.uid}:${esc(r.actionId)}" style="margin-top:6px">Skip it</button></div>`;
  }
  return head('Your move', `${esc(t.label)}: ${esc(name)}`,
    `${esc(t.label)} was attacked, so it may place ${r.count} Smoke Screen${r.count === 1 ? '' : 's'} within Range ${r.range}. Every attack in that Action has already resolved, so these cannot shield anyone else it shot at (FAQ B7).`, true)
    + `<div class="tp-body"><p class="tp-dim">Taking it spends its one use; skipping keeps it for a later attack.</p></div>
       <div class="tp-foot"><button class="bigbtn" data-reactgo="${t.uid}:${esc(r.actionId)}">Place them</button>
       <button class="bigbtn ghost2" data-reactskip="${t.uid}:${esc(r.actionId)}" style="margin-top:6px">Skip it</button></div>`;
}

// Both answers clear the debt; only one opens the picker. Taking it spends the
// use in the same command that clears it, so a drop mid-placement cannot leave
// a free Emergency Smoke behind. Skipping keeps the use (`placed: false`,
// audit Phase 4, G9).
function answerReaction(ctx: HudCtx, key: string, place: boolean): void {
  const [uidRaw, actionId] = key.split(':');
  const uid = Number(uidRaw);
  const t = ctx.state.tokens.find((x) => x.uid === uid);
  const r = (ensureScript(ctx.state).reactions ?? []).find((x) => x.uid === uid && x.actionId === actionId);
  if (!t || !r) { ctx.refresh(); return; }
  const trace = r.kind === 'trace';
  const stance = r.kind === 'stance';
  const what = trace ? 'Target Tracing' : stance ? 'Defense Reaction' : r.kind === 'control' ? 'control of the unit (The Red Shoes)' : 'Emergency Smoke';
  // The Scan debt has no decline: 4.12.4 Reveals the target on a success and
  // the only open question is WHERE it appears, which openManifest asks. Its
  // panel offers no Skip for the same reason. The Reveal itself pays the debt,
  // so a reload before the panel leaves it owed rather than lost (ruled R7;
  // audit Phase 7, P7C 7); it was cleared first. Only a unit no longer hidden
  // has it cleared here, with nothing left to Reveal.
  if (r.kind === 'manifest' && statusCount(t.statuses, 'camouflage') > 0) {
    openManifest(ctx, t, 'Scanned:');
    ctx.refresh();
    return;
  }
  if (!ctx.send({ kind: 'resolveReaction', seat: t.side, uid, actionId, placed: place }).ok) { ctx.refresh(); return; }
  if (r.kind === 'manifest') {
    ctx.refresh();
    return;
  }
  // The attack behind a free Scan (FAQ I12) resumes through the ordinary front
  // door; the Tick was paid when the target was designated.
  if (r.kind === 'scanAttack') {
    if (!place) {
      ctx.noteNow(`${t.label} calls off the attack. The Action Tick was spent at the designation (FAQ I11).`, 'done');
    } else if (r.fromUid !== undefined) {
      ctx.startAttack(uid, actionId, r.fromUid, 'attack', { charged: !!r.charged, chargeChoice: r.chargeChoice, twoHandedDeclined: !!r.twoHandedDeclined });
    }
    ctx.refresh();
    return;
  }
  if (!place) {
    ctx.noteNow(`${t.label} declines its ${what}.`, 'done');
    ctx.refresh();
    return;
  }
  if (stance) {
    if (ctx.send({ kind: 'defenseReaction', seat: t.side, uid }).ok) {
      ctx.noteNow(`${t.label} reacts to the Penetration and changes to Defensive Stance.`, 'done');
    }
    ctx.refresh();
    return;
  }
  if (trace) {
    // The Command Token is spent by the command that opens the roll, so a
    // refused Counter-roll cannot leave a Mech that paid for nothing. It used
    // to be spent first, by its own command, and a Mech with one Token then had
    // none face-up for the roll to find (audit Phase 3, D8).
    const v = ctx.send({ kind: 'startCounterRoll', seat: t.side, uid, targetUid: r.fromUid!, actionId, reaction: true });
    if (!v.ok && v.why) ctx.noteNow(v.why);
    ctx.refresh();
    return;
  }
  startSmokePlan({
    side: t.side,
    count: r.count,
    connected: false,
    range: { c: Math.floor(t.col / 3), r: Math.floor(t.row / 3), max: r.range },
    label: `${t.label}: Emergency Smoke`,
  });
  ctx.refresh();
}

// What a camouflaged unit owes (4.12.2), as the command that caused it
// recorded it: a non-Silence Action, a non-Silent Maneuver, or a Movement of
// either unit that ended in Contact with an enemy. This used to be derived here
// at render time, from the Opportunity and from the board, and it missed Common
// Actions (Punch/Kick, Crawl), lent Parts, anything outside the unit's own
// Opportunity and every Contact after the first; it held an Action taken BEFORE
// the camouflage went on against it; and a "Stay hidden" button stood in for
// FAQ I14, which the record now derives (audit Phase 3, C4/C5).
function revealsOwed(ctx: HudCtx): { t: Token; why: string }[] {
  const s = ctx.state;
  const out: { t: Token; why: string }[] = [];
  for (const d of ensureScript(s).revealDue ?? []) {
    const t = s.tokens.find((x) => x.uid === d.uid);
    if (!t || statusCount(t.statuses, 'camouflage') === 0 || t.deployed === false) continue;
    // One Reveal answers every trigger, so the first reason is the one given.
    if (out.some((x) => x.t.uid === t.uid)) continue;
    const by = d.byUid !== undefined ? s.tokens.find((x) => x.uid === d.byUid) : undefined;
    // For an Action, `byUid` names the enemy aura that took its Silence away
    // (ZHDR-206): a camouflage that breaks with nothing named reads as a bug.
    const why = d.why === 'touch' ? `ended a Movement in Contact with ${by?.label ?? 'an enemy'}`
      : d.why === 'move' ? 'moved without Silence'
        : by ? `performed an Action whose Silence ${by.label} (Dynamic Perception) takes away` : 'performed a non-Silence Action';
    out.push({ t, why });
  }
  return out;
}

function revealPanel(ctx: HudCtx): string {
  const owed = revealsOwed(ctx).filter((x) => mine(ctx, x.t.side));
  const x = owed[0];
  if (!x) return '';
  const range = manifestationRange(ctx.data, x.t);
  const stuck = !!immobilizedStop(x.t);
  return head('Your move', `${esc(x.t.label)} breaks camouflage`,
    `It ${esc(x.why)}, so under 4.12.2 the Optical Camouflage ends.${
      stuck ? ' It bears an Immobilized Token, so it Reveals where it stands (FAQ I20).'
        : range > 0 ? ` Revealing offers Manifestation Movement within Range ${range} (Stealth ${range}).` : ''}`, true)
    + `<div class="tp-body"></div>
      <div class="tp-foot"><button class="bigbtn" data-revealgo="${x.t.uid}">Reveal it (4.12.2)</button></div>`;
}

function owedItems(ctx: HudCtx): { uid: number; actionId: string; targetUid: number }[] {
  const s = ctx.state;
  // A Part with no Token left cannot pay (B2): spendIntercept strikes those off
  // as it empties the pool, and this skips any a saved table still holds. So
  // does the engine's one reading of what can still be made (Shutdown, Fire
  // Control Interference, a target gone): an attempt nobody can make held
  // this panel open for good once the spend refused it (audit Phase 5, B9).
  ensureScript(s);
  return liveIntercepts(s);
}

function interceptSide(ctx: HudCtx): Side | null {
  ensureScript(ctx.state);
  return turn.interceptSide(ctx.state);
}

// Whoever is acting: normally the unit holding the Action Opportunity, but for
// as long as an Interception is being resolved it is the intercepting unit —
// otherwise the damage would be attributed to whoever happened to be activating.
function actingToken(ctx: HudCtx): Token | undefined {
  const s = ctx.state;
  if (interceptNow) return s.tokens.find((x) => x.uid === interceptNow!.uid);
  // A detonating Projectile is the attacker for its own Explosion (4.7.6), and
  // it is nobody's Action Opportunity.
  if (detonateNow) return s.tokens.find((x) => x.uid === detonateNow!.uid);
  const sc = ensureScript(s);
  return sc.opp ? s.tokens.find((x) => x.uid === sc.opp!.uid) : undefined;
}

// The attempt is remembered so the 4.9 obligation can be judged when it ends,
// and the roll itself is the shared AttackHelper — the same pipeline every
// other attack goes through, just with no Protection and no arc.
function beginIntercept(ctx: HudCtx, by: Token, actionId: string, target: Token): void {
  interceptNow = { uid: by.uid, actionId, targetUid: target.uid };
  interceptPick = null;
  ctx.startAttack(by.uid, actionId, target.uid, 'intercept');
}

function interceptPanel(ctx: HudCtx): string {
  const s = ctx.state;
  if (interceptNow) {
    const by = s.tokens.find((x) => x.uid === interceptNow!.uid);
    const at = s.tokens.find((x) => x.uid === interceptNow!.targetUid);
    const a = by ? actionOn(ctx, by, interceptNow.actionId) : undefined;
    const left = by ? interceptHeld(ctx.data, s.tokens, by, interceptNow.actionId) : 0;
    return head('Your move', `Intercepting ${at ? esc(at.label) : 'the target'}`, `${by ? esc(by.label) : ''} · ${esc(a?.name?.en || interceptNow.actionId)}.`, true)
      + `<div class="tp-body">
          <p class="tp-note">No Forward Arc is required, and terrain never blocks a line to an Aerial Unit, though a Smoke Screen does. The target claims no Terrain or Unit Protection dice (4.9, 4.16, FAQ F3).</p>
          <p class="tp-dim">${left} Interception Token${left === 1 ? '' : 's'} left on that Part, for the rest of the game. Roll it out in the combat window.</p>
        </div>
        <div class="tp-foot"><button class="bigbtn" data-act="interceptdone">This attempt is resolved</button></div>`;
  }
  if (interceptPick) {
    const by = s.tokens.find((x) => x.uid === interceptPick!.uid);
    const a = by ? actionOn(ctx, by, interceptPick.actionId) : undefined;
    const reach = a?.range ?? 0;
    // Interception only ever attacks an Aerial Unit, which is what a Missile or
    // a Projectile is; anything else on the board is not a legal target. An
    // owed target is taken as it stands, Aerial or not: it was judged at both
    // ends when the Launch queued it (4.7.2; audit Phase 5, B1).
    const pickId = actionIdOf(interceptPick.actionId);
    const owed = (x: Token) => !!by && interceptOwedAt(s, by.uid, pickId, x.uid);
    const targets = by
      // A landed Mine is a Ground Unit (1.3), whatever its `aerial` flag says.
      ? s.tokens.filter((x) => x.side !== by.side && x.deployed !== false && ((x.aerial && !x.mine && rangeBetween(by, x).range <= reach) || owed(x)))
      : [];
    // An Interception is a Firing Action (FAQ M26), so a Smoke Screen over
    // every line to the target takes it away (FAQ F3). Shown and greyed, with
    // the reason for the notice line, so the player sees why rather than an
    // empty list (audit Phase 7, P7D 9).
    const rows = targets
      .map((x) => {
        const smoked = !owed(x) && smokeBlocks(by!, x, s.smoke ?? []);
        // A strict table makes only an owed attempt (ruling I11; audit Phase
        // 5, B9): the rest are shown and greyed.
        const unowed = !owed(x) && strictNow(s);
        const why = smoked
          ? `Every line from ${by!.label} to ${x.label} crosses a Smoke Screen, and an Interception is a Firing Action (4.16, FAQ F3).`
          : unowed ? `No Interception is owed at ${x.label}: only an owed attempt is made (4.9).` : '';
        return `<button class="rowwide${smoked ? ' warn' : ''}" data-inttarget="${x.uid}"${why ? ` aria-disabled="true" data-why="${esc(why)}"` : ''}>${esc(x.label)}<span class="ct">${
          smoked ? 'every line crosses a Smoke Screen' : unowed ? 'not owed' : `Range ${rangeBetween(by!, x).range}`}</span></button>`;
      })
      .join('');
    return head('Your move', 'Intercept what?', `Only the Aerial Unit that Moved or was Launched, within Range ${reach} (4.9).`, true)
      + `<div class="tp-body">${rows || `<p class="tp-note">Nothing Aerial is within Range ${reach} of ${by ? esc(by.label) : 'that Part'}.</p>`}</div>
         <div class="tp-foot"><button class="bigbtn ghost2" data-act="interceptcancel">Cancel, spend nothing</button></div>`;
  }
  const owed = owedItems(ctx);
  const side = interceptSide(ctx);
  if (side && !mine(ctx, side)) {
    return head('Waiting', `${esc(squadLabel(side))} is intercepting`, `${owed.length} attempt${owed.length === 1 ? '' : 's'} owed (4.9).`, false)
      + `<div class="tp-body">${waiting(side, 'resolving an Interception')}</div><div class="tp-foot"></div>`;
  }
  const rows = owed
    .map((x, i) => {
      const by = s.tokens.find((t) => t.uid === x.uid)!;
      const at = s.tokens.find((t) => t.uid === x.targetUid)!;
      const a = actionOn(ctx, by, x.actionId);
      const left = interceptHeld(ctx.data, s.tokens, by, x.actionId);
      return `<button class="rowwide" data-intercept="${i}">${esc(by.label)} → ${esc(at.label)}<span class="ct">${esc(a?.name?.en || x.actionId)} · ${left} left</span></button>`;
    })
    .join('');
  return head('Your move', 'Interception owed', 'A launch by an Aerial Unit triggers this at once, before anything else happens (4.9).', true)
    + `<div class="tp-body">${rows}
        <p class="tp-note">Each attempt spends a Token. A Part keeps going until its Tokens run out or the target dies.<br>Tokens are never restored.</p></div>
       <div class="tp-foot"></div>`;
}

// ---------- Electronic Warfare (rulebook 4.11) ----------
//
// The one interaction where both players roll and both may spend Link, so it
// cannot be driven from one chair: each seat submits its own faces for its own
// unit, and both clients derive the verdict from `resolveCounterRoll`. Range is
// the only reach test — Electronic Warfare ignores Terrain and line of sight
// outright (4.11.1) — so the target list deliberately says nothing about arcs.

let ewPick: { uid: number; actionId: string; refund?: { uid: number; slot: string; choice?: string } } | null = null;

export function startElectronicPick(uid: number, actionId: string): void {
  ewPick = { uid, actionId };
  hudRef?.refresh();
}

function ewPanel(ctx: HudCtx): string {
  const s = ctx.state;
  const m = ewPick!;
  // WHO it may be opened against is read in turn.ts (electronicReading): the
  // effective reach, both pools as they will be rolled, a Repeater's lent
  // position, and for an Automatic Action the nearest enemy. A seat with no
  // panel reads the same list, so a row drawn live here is one it is offered.
  const read = turn.electronicReading(ctx.data, s, m.uid, m.actionId);
  if (!read) return head('Electronic Warfare', 'That unit is gone', '', true)
    + '<div class="tp-body"></div><div class="tp-foot"><button class="bigbtn ghost2" data-act="ewcancel">Close</button></div>';
  const { by, a, reach, ev, evPrinted, scan, relay } = read;
  // An Action on every enemy in Range (Scream, the Scan Battlefield) picks
  // nobody: one Counter-roll per target, in turn, the engine queueing the rest
  // (audit Phase 3, D2 and A4). The Match Centre offered only the nearest.
  if (read.all) {
    const all = read.all;
    return head('Your move', `${esc(a.name?.en || m.actionId)}: every enemy in Range`,
      `${esc(by.label)} · Electronic Value ${ev}, Range ${reach}. One Electronic Counter-roll against each, in turn.`, true)
      + `<div class="tp-body">${all.length
        ? all.map((t) => `<p class="tp-dim">${esc(t.label)} · Range ${gridsApart(by, t)} · Electronic Value ${electronicStrength(ctx.data, s.tokens, t, 'responder')}</p>`).join('')
        : `<p class="tp-note">No enemy ${scan ? 'that a Scan could change' : 'it can target'} is within Range ${reach}.</p>`}</div>
       <div class="tp-foot">${all.length ? `<button class="bigbtn" data-ewtarget="${all[0].uid}">Roll against ${all.length === 1 ? esc(all[0].label) : `all ${all.length}`}</button>` : ''}
       <button class="bigbtn ghost2" data-act="ewcancel" style="margin-top:6px">${all.length ? 'Cancel' : 'Close'}</button></div>`;
  }
  const rows = read.rows
    .map(({ t, d, via, theirs, far, skipped, why }) => {
      const bits = [
        far ? `⚠ Range ${d}, beyond this Action's Range ${reach}` : `Range ${d}${via && via.uid !== by.uid ? ` via ${via.label}` : ''}`,
        skipped ? '✕ not the nearest enemy (3.5.2)' : '',
        `Electronic Value ${theirs}`,
      ].filter(Boolean);
      return `<button class="rowwide targrow${far || skipped ? ' warn' : ''}" data-ewtarget="${t.uid}"${why ? ` aria-disabled="true" data-why="${esc(why)}"` : ''}>
        <span class="tgname">${esc(t.label)}</span>
        <span class="tgbits">${bits.map((b) => `<span${/[⚠✕]/.test(b) ? ' class="bad"' : ''}>${esc(b)}</span>`).join('')}</span></button>`;
    })
    .join('');
  return head('Your move', `${esc(a.name?.en || m.actionId)}: which enemy?`,
    `${esc(by.label)} · Electronic Value ${ev}${ev < evPrinted ? ` (${evPrinted} − ${evPrinted - ev}, an enemy EW Suppression aura)` : ''}, Range ${reach}.${relay.length ? ` Range may be measured from ${esc(relay.map((r) => r.label).join(' or '))} instead (Repeater, FAQ O19).` : ''}`, true)
    + `<div class="tp-body">${rows || `<p class="tp-note">${scan ? 'No enemy is in the Optical Camouflage State or bearing a Low Profile Token, so a Scan could change nothing (4.12.4).' : 'No enemy unit this Action can target is on the board.'}</p>`}
        <p class="tp-dim">Only Range matters. Terrain and line of sight are ignored (4.11.1).<br>Both units roll Yellow dice equal to their Electronic Value.</p></div>
       <div class="tp-foot"><button class="bigbtn ghost2" data-act="ewcancel">Cancel</button></div>`;
}

// The Counter-roll's readers used to live here as well, so the turn panel could
// draw its own version of the exchange. They are the combat window's now:
// electronicStrength for the pools, resolveCounterRoll for the verdict, both
// read straight off the shared record by whichever client is drawing it.
// THE COUNTER-ROLL'S WINDOW. Electronic Warfare used to be a turn-panel string,
// which is why it could never animate: spinDice needs elements it can hold
// across ticks and a string is replaced wholesale on every render. It runs in
// the combat window now, on the same renderer the attack uses, so the dice roll
// and the verdict resolves the way they do for an attack.
//
// No mirror protocol, unlike the attack: a CounterRoll is already shared state
// and both clients derive the verdict from it, so each simply draws the record.
let ewHelper: ElectronicHelper | null = null;

// The seat this client holds, falling back to whose turn it is the same way the
// rest of the HUD's senders do.
function seatOf(ctx: HudCtx): Side { return ctx.seat ?? ensureScript(ctx.state).turn ?? 's1'; }

// The record's Responder: a unit, or for a Remote Access the Terminal's
// stand-in, placed where its token stands (ruling I25). Read in contest.ts.
function counterResponder(ctx: HudCtx, c: CounterRoll, init: Token | undefined): Token | undefined {
  return contestResponder(ctx.data, ctx.state, c, init);
}

// Every press the window can make, answered in one place. Each is a question
// one of the two seats owns, so it travels as a command. The sender is
// contest.ts contestAct, which a computer seat's Counter-roll goes through
// too: this hands it the page's own send, dice and notice line.
function contestAct(ctx: HudCtx, act: EwAct, arg?: EwArg): void {
  if (!ensureScript(ctx.state).counter) return;
  sendContestAct({
    data: ctx.data, state: ctx.state, seat: seatOf(ctx), send: ctx.send, rollHits: ctx.rollHits,
    say: (text, kind) => ctx.noteNow(text, kind), done: () => ctx.refresh(),
  }, act, arg);
}

// Points the window at the shared record, building it the first time. Returns
// whether a Counter-roll is on screen, which is what decides the pop's hidden.
function syncContest(ctx: HudCtx, host: HTMLElement): boolean {
  const s = ctx.state;
  const c = ensureScript(s).counter;
  const body = host.querySelector<HTMLElement>('#combat-body');
  if (!c || !body || !ctx.diceData) { ewHelper?.closeContest(); return false; }
  const init = s.tokens.find((x) => x.uid === c.initiatorUid);
  const resp = counterResponder(ctx, c, init);
  const action = init ? actionOn(ctx, init, c.actionId) : undefined;
  // A record naming a unit or a card this client cannot resolve draws nothing
  // rather than half a window, the same rule the attack mirror follows.
  if (!init || !resp || !action) { ewHelper?.closeContest(); return false; }
  if (!ewHelper) {
    ewHelper = new ElectronicHelper(ctx.data, ctx.diceData, body, () => ctx.refresh(), () => ctx.refresh());
  }
  ewHelper.remount(body);
  ewHelper.tokens = () => ctx.state.tokens;
  ewHelper.contestAct = (act, arg) => contestAct(ctx, act, arg);
  const seat = ctx.seat;
  // The role is asked of the CONTEST, not of the seat, so a watcher with no seat
  // comes out a spectator rather than accidentally owning a hand.
  const role = seat === init.side ? 'initiator' : seat === resp.side ? 'responder' : 'spectator';
  ewHelper.showContest(c, init, resp, action, role);
  // DRAWN HERE, as the pad draws it (pad/ew.ts syncContest). showContest only
  // stores the record, and remount() above draws only when the element
  // changed: #combat-body is one element for the life of the HUD, so without
  // this the window stayed empty, or kept the last attack's picture, and the
  // exchange could not be answered (found 2026-10-01, by a computer seat's
  // Counter-roll on a player).
  ewHelper.redraw();
  return true;
}

// ---------- Black Boxes (rulebook 5.3.1) ----------
//
// A Main Task item, and the only one that moves: a Unit whose Movement passes
// through a loose Box may pick it up onto a Freehand Part, and a bearer that is
// Penetrated drops it where the ATTACKER says, in contact with its base. Both
// halves are commands, so the Box changes hands on both screens at once — the
// freeplay board mutated `state.tasks` in place, which could never have
// travelled.

// Boxes the mover just walked over, offered one at a time. `slotFor` is the
// second question, asked only when the unit has more than one free Freehand.
// `endAfter`: offered as the Opportunity ends, which it does once answered.
let boxPick: { uid: number; queue: string[]; slotFor?: string; endAfter?: boolean } | null = null;
// The attacker choosing where a Penetrated bearer's Box lands.
let boxDrop: { itemId: string; bearerUid: number; bySide: Side; byUid: number } | null = null;

function taskItems(ctx: HudCtx) {
  return normaliseTasks(ctx.state.tasks).items;
}

// A Part already bearing a Box has its Freehand treated as invalid (5.3.1).
// A Carrier carries one on a Freehand Load (FAQ P11; ruling I19).
function freeHandsFor(ctx: HudCtx, t: Token) {
  return turn.boxHandsFree(ctx.data, ctx.state, t);
}

// Called once a Movement has landed: every loose Box in a Grid the route passed
// through is offered, which is the reading freeplay uses. A flight enters only
// its start and landing Grids (4.3.2; ruling I22; audit Phase 6, F10).
// `endAfter`: the offer as the Opportunity ends in the Box's Grid (F2), made
// only to a unit with a free Freehand. True when an offer is up.
function offerBoxesOn(ctx: HudCtx, uid: number, path: LargeGrid[], flight = false, endAfter = false): boolean {
  const t = ctx.state.tokens.find((x) => x.uid === uid);
  if (endAfter && (!t || !freeHandsFor(ctx, t).length)) return false;
  // Which Boxes a route passed is read in turn.ts (boxesOn), where a seat with
  // no panel reads it too.
  const on = turn.boxesOn(ctx.state, path, flight);
  if (on.length) boxPick = { uid, queue: on.map((i) => i.id), ...(endAfter ? { endAfter: true } : {}) };
  return on.length > 0;
}

// Auto Mine Laying, offered on the same signal as the Boxes: the route just
// walked. `left` is how many more the unspent Move Range can pay for, so it
// counts down as they go in rather than being asked once (FAQ M7/M29).
let minePick: (MineLaying & { left: number; flight: boolean; route: LargeGrid[] }) | null = null;

function offerMinesOn(ctx: HudCtx, t: Token, path: LargeGrid[], steps: number, flying: boolean): void {
  // What the walk may Lay is read in turn.ts (minesOnRoute), where a seat with
  // no panel reads it too.
  const lay = turn.minesOnRoute(ctx.data, ctx.state, t, path, steps, flying);
  if (lay) minePick = { ...lay, left: lay.max, flight: flying || !!t.aerial, route: [...path] };
}

function minePickPanel(ctx: HudCtx): string {
  const m = minePick!;
  const t = ctx.state.tokens.find((x) => x.uid === m.uid);
  const mine = ctx.data.byId.get(m.cardId);
  if (!t || !mine) {
    return head('Lay a Mine', 'It is no longer available', '', true)
      + '<div class="tp-body"></div><div class="tp-foot"><button class="bigbtn ghost2" data-act="mineskip">Close</button></div>';
  }
  const what = cardName(mine);
  const rows = m.grids
    // Its own end Grid is legal, and the Mine goes off as it enters (ruling
    // I15; audit Phase 5, C6).
    .map((g) => `<button class="rowwide" data-minelay="${g.c},${g.r}">${esc(gridName(g.c, g.r))}<span class="ct">${
      g.c === Math.floor(t.col / 3) && g.r === Math.floor(t.row / 3) ? 'its own Grid: it goes off' : 'lay here'}</span></button>`)
    .join('');
  return head('Your move', `Lay ${esc(what)}?`, `${esc(t.label)} held ${m.left} point${m.left === 1 ? '' : 's'} of Move Range back.`, true)
    + `<div class="tp-body">${rows}
        <p class="tp-dim">Each Mine costs 1 Move Range, which is why the route was short. No Action Tick and no Ammo (FAQ M7).${
          m.flight ? '<br>A Flight Move only has its starting and landing Grids to lay in (FAQ M29).' : ''
        }</p></div>
       <div class="tp-foot"><button class="bigbtn ghost2" data-act="mineskip">${m.left === m.max ? 'Lay none' : 'That is enough'}</button></div>`;
}

function layMineAt(ctx: HudCtx, c: number, r: number): void {
  const m = minePick;
  const t = m ? ctx.state.tokens.find((x) => x.uid === m.uid) : undefined;
  if (!m || !t) { minePick = null; ctx.refresh(); return; }
  // Online play is always strict, so a refusal really refuses — the offer must
  // survive it or a declined command silently eats a Mine the player still has
  // the Move Range for.
  // The route travels with it, so the engine judges the Grid against the
  // Movement it was laid along, a flight against its two ends (FAQ M29).
  // On a cell of the Grid that terrain leaves free: a Mine is a Ground Unit
  // (Supplementary Rules 1.04, 1.3). It used to go on the middle cell.
  const at = mineSpot(c, r, terrainOf(ctx));
  if (!at) {
    ctx.noteNow(`Terrain fills ${gridName(c, r)}, so there is nowhere to lay a Mine there: a Mine is a Ground Unit (Supplementary Rules 1.04, 1.3).`);
    ctx.refresh();
    return;
  }
  const v = ctx.send({
    kind: 'layMine', seat: t.side, uid: t.uid, actionId: m.actionId, cardId: m.cardId, to: at,
    route: m.route.map((g) => ({ col: g.c * 3 + 1, row: g.r * 3 + 1 })), ...(m.flight ? { flying: true } : {}),
  });
  if (!v.ok && v.why) ctx.noteNow(v.why);
  if (v.ok) {
    ctx.noteNow(`${t.label} Lays ${cardName(ctx.data.byId.get(m.cardId))} in ${gridName(c, r)}, paid for with 1 Move Range.`, 'done');
    m.left -= 1;
    if (m.left <= 0) minePick = null;
  }
  ctx.refresh();
}

function boxPickPanel(ctx: HudCtx): string {
  const m = boxPick!;
  const t = ctx.state.tokens.find((x) => x.uid === m.uid);
  const box = taskItems(ctx).find((i) => i.id === m.queue[0]);
  if (!t || !box || box.col === undefined || box.row === undefined) {
    return head('Black Box', 'It is no longer there', '', true)
      + '<div class="tp-body"></div><div class="tp-foot"><button class="bigbtn ghost2" data-act="boxskip">Close</button></div>';
  }
  const where = gridName(Math.floor(box.col / 3), Math.floor(box.row / 3));
  const hands = freeHandsFor(ctx, t);
  const left = m.queue.length > 1 ? `<p class="tp-dim">${m.queue.length - 1} more on this route after this one.</p>` : '';
  if (!hands.length) {
    return head('Your move', `The Black Box in ${where}`, `${esc(t.label)} walked over it.`, true)
      + `<div class="tp-body"><p class="tp-note">A Black Box goes onto a Part with the Freehand tag, and ${esc(t.label)} has none free.<br>A Part already carrying one does not count (5.3.1).</p>${left}</div>
         <div class="tp-foot"><button class="bigbtn" data-act="boxskip">Leave it</button></div>`;
  }
  // One Freehand Part is no question at all, so it is picked up in one press.
  const rows = hands
    .map((h) => `<button class="rowwide" data-boxtake="${esc(String(h.slot))}">${hands.length > 1 ? esc(h.label) : `Pick it up · ${esc(h.label)}`}<span class="ct">carries it</span></button>`)
    .join('');
  return head('Your move', `Pick up the Black Box in ${where}?`, m.endAfter
    ? `${esc(t.label)} ends its Action Opportunity in its Grid (3.4.4). ${hands.length > 1 ? 'Which Part carries it?' : 'Picking one up is optional.'}`
    : hands.length > 1 ? 'Which Part carries it?' : 'Picking one up is optional.', true)
    + `<div class="tp-body">${rows}
        <p class="tp-dim">That Part cannot take a second while it holds this one (5.3.1).<br>A Penetration makes the bearer drop it.</p>${left}</div>
       <div class="tp-foot"><button class="bigbtn ghost2" data-act="boxskip">Leave it</button></div>`;
}

function takeBox(ctx: HudCtx, slot: string): void {
  const m = boxPick;
  const t = m ? ctx.state.tokens.find((x) => x.uid === m.uid) : undefined;
  if (!m || !t) { boxPick = null; ctx.refresh(); return; }
  const itemId = m.queue[0];
  if (ctx.send({ kind: 'takeBlackBox', seat: t.side, uid: t.uid, itemId, slot }).ok) {
    ctx.noteNow(`${t.label} picks up the Black Box, carried on the ${freehandSlots(ctx.data, t).find((h) => h.slot === slot)?.label ?? slot}.`, 'done');
  }
  nextBox(ctx);
}

function nextBox(ctx: HudCtx): void {
  if (!boxPick) return;
  boxPick.queue.shift();
  if (!boxPick.queue.length) {
    const end = boxPick.endAfter;
    boxPick = null;
    if (end) { endOpportunityNow(ctx, true); return; }
  }
  ctx.refresh();
}

// Ending the acting unit's Opportunity. A Black Box in its Grid is offered
// first (3.4.4, 5.3.1, FAQ P8), optional (P10; ruling I27): only a Movement's
// route offered one, so P8's own example could not happen (audit Phase 6, F2).
// `boxesAsked`: the offer has been answered, and nextBox comes back here.
function endOpportunityNow(ctx: HudCtx, boxesAsked = false): void {
  const s = ctx.state;
  const sc = ensureScript(s);
  if (sc.opp) {
    const t = s.tokens.find((x) => x.uid === sc.opp!.uid);
    if (t && !boxesAsked && !boxPick && offerBoxesOn(ctx, t.uid, [{ c: Math.floor(t.col / 3), r: Math.floor(t.row / 3) }], false, true)) {
      dropAction();
      movePlan = null;
      inspectUid = null;
      board?.clearMovePath();
      ctx.refresh();
      return;
    }
    // A Coordination still held for an attack lapses with the Opportunity.
    if (t && coordHeld?.uid === t.uid) coordHeld = null;
    // The Integrated Data Link Pod coordinates when the Opportunity ENDS
    // rather than off an Action, so its offer goes here - a Passive is never
    // performed and commitAction can never reach it. The Opportunity closes
    // afterwards either way, so declining costs nothing.
    const owed = t ? coordinationOnOpportunityEnd(ctx.data, t) : 0;
    if (t && owed > 0 && readyCommands(t) > 0) {
      const uid = sc.opp.uid;
      void offerCoordination(ctx.data, s, t, owed, (mechUid, targetUid) => {
        ctx.send({ kind: 'coordinateCommand', seat: t.side, uid: mechUid, targetUid });
      }, (_d, text) => ctx.noteNow(text, 'done'), () => { ctx.send({ kind: 'endSwarm', seat: t.side }); }).then(() => {
        ctx.send({ kind: 'endOpportunity', seat: t.side, uid });
        ctx.refresh();
      });
      dropAction();
      movePlan = null;
      inspectUid = null;
      board?.clearMovePath();
      ctx.refresh();
      return;
    }
    ctx.send({ kind: 'endOpportunity', seat: t?.side ?? seatOf(ctx), uid: sc.opp.uid });
  }
  // Walking away from a tool that never resolved leaves its Action unperformed.
  dropAction();
  movePlan = null;
  inspectUid = null;
  board?.clearMovePath();
  ctx.refresh();
}

// The bearer's base for a drop: where it stands, or where the Penetration
// found it once the same attack has taken it off the board (audit Phase 6, F1).
function dropBase(ctx: HudCtx, m: { itemId: string; bearerUid: number }): { col: number; row: number; size: number } | null {
  const bearer = ctx.state.tokens.find((x) => x.uid === m.bearerUid);
  if (bearer) return { col: bearer.col, row: bearer.row, size: bearer.size };
  return taskItems(ctx).find((i) => i.id === m.itemId)?.dropFrom ?? null;
}

// Where a dropped Box may land: a Small Grid in Contact with the base, edge to
// edge, so never under it and never at a corner, and never on terrain (FAQ P9;
// ruling I24; audit Phase 6, F6). Units do not block it (P8). Offered as the
// Large Grids that hold one; the Box goes on the cell nearest their middle.
function dropCells(ctx: HudCtx, base: { col: number; row: number; size: number }): { col: number; row: number }[] {
  return boxDropCells(base, terrainOf(ctx), boardGrids() * 3);
}

function dropGrids(ctx: HudCtx, base: { col: number; row: number; size: number }): LargeGrid[] {
  const out: LargeGrid[] = [];
  for (const x of dropCells(ctx, base)) {
    const g = { c: Math.floor(x.col / 3), r: Math.floor(x.row / 3) };
    if (!out.some((o) => o.c === g.c && o.r === g.r)) out.push(g);
  }
  return out;
}

// Opened from the attack pipeline the moment a bearer is Penetrated. The
// attacker's own client asks, because the attacker chooses.
export function startBoxDrop(itemId: string, bearerUid: number, bySide: Side, byUid: number): void {
  boxDrop = { itemId, bearerUid, bySide, byUid };
  hudRef?.refresh();
}

// Forced Movement is part of the attack, so a Penetrated bearer's Box question
// waits until any shove has settled and is asked at the NEW position (FAQ E19).
// The queue drains one at a time through the normal picker.
let pendingBoxDrops: { itemId: string; bearerUid: number; bySide: Side; byUid: number }[] = [];

export function queueBoxDrop(itemId: string, bearerUid: number, bySide: Side, byUid: number): void {
  pendingBoxDrops.push({ itemId, bearerUid, bySide, byUid });
}

export function flushBoxDrops(): void {
  if (boxDrop || shovePlan) return;
  const next = pendingBoxDrops.shift();
  if (next) startBoxDrop(next.itemId, next.bearerUid, next.bySide, next.byUid);
}

function boxDropPanel(ctx: HudCtx): string {
  const m = boxDrop!;
  const bearer = ctx.state.tokens.find((x) => x.uid === m.bearerUid);
  const base = dropBase(ctx, m);
  // A bearer the attack destroyed still owes the drop, judged at the base the
  // Penetration found (F1): "The bearer is gone" lost the Box.
  if (!base) {
    return head('Black Box', 'The bearer is gone', '', true)
      + '<div class="tp-body"></div><div class="tp-foot"><button class="bigbtn ghost2" data-act="boxdropclose">Close</button></div>';
  }
  const who = bearer?.label ?? 'The bearer';
  if (!mine(ctx, m.bySide)) {
    return head('Waiting', `${esc(squadLabel(m.bySide))} places the Black Box`, `${esc(who)} was Penetrated carrying one.`, false)
      + `<div class="tp-body">${waiting(m.bySide, 'saying where the Box lands')}</div><div class="tp-foot"></div>`;
  }
  const rows = dropGrids(ctx, base)
    .map((g) => `<button class="rowwide" data-boxdrop="${g.c}:${g.r}">${gridName(g.c, g.r)}<span class="ct">in contact</span></button>`)
    .join('');
  return head('Your move', 'Where does the Black Box land?', `${esc(who)} was Penetrated and drops it. As the attacker, you choose (5.3.1).`, true)
    + `<div class="tp-body">${rows}
        <p class="tp-dim">In Contact with the bearer's base, edge to edge: never under it, and never on terrain (FAQ P9).<br>The choices are lit on the board.</p></div>
       <div class="tp-foot"></div>`;
}

function placeDroppedBox(ctx: HudCtx, c: number, r: number): void {
  const m = boxDrop;
  if (!m) return;
  const bearer = ctx.state.tokens.find((x) => x.uid === m.bearerUid);
  const base = dropBase(ctx, m);
  const to = base ? boxDropCellIn(c, r, dropCells(ctx, base)) : null;
  if (!to) return;
  boxDrop = null;
  board?.clearHighlights();
  if (ctx.send({ kind: 'dropBlackBox', seat: m.bySide, uid: m.byUid, itemId: m.itemId, to }).ok) {
    ctx.noteNow(`${bearer?.label ?? 'The bearer'} was Penetrated carrying a Black Box, which lands in ${gridName(c, r)} (5.3.1).`, 'done');
  }
  // A unit can carry more than one, so the next is asked for straight away.
  const still = taskItems(ctx).find((i) => i.kind === 'blackbox' && i.bearerUid === m.bearerUid);
  if (still) startBoxDrop(still.id, m.bearerUid, m.bySide, m.byUid);
  else {
    flushBoxDrops();
    ctx.refresh();
  }
}

// ---------- Crush (rulebook 4.3.6) ----------
//
// A Large Unit may end its Movement in a Grid holding smaller Units and
// Destructible Terrain, and everything in there gives way: the terrain is
// destroyed, each Unit is Force-Moved 1 Grid with the CRUSHING player choosing
// where, one with nowhere to go EXCHANGES POSITIONS with the crusher, and one
// that cannot be Force-Moved at all is destroyed instead — unless it is a
// Barricade, which FAQ E6/M13 puts out of reach of a Crush entirely and
// rules.ts crushTargets refuses before any of this is offered.
//
// The victims are cleared before the crusher lands, which is the order freeplay
// uses — moving the crusher in first would make the swap case place a unit into
// the Grid it is being pushed out of.
//
// The EXCHANGE is settled last for the same reason. A victim with no escape is
// noted here and shifted off the queue, and only finishCrush turns the whole set
// into a single crushSwap: the crusher must not land while anything is still
// standing in the Grid it is entering, and one command has to carry every token
// that moves or a snapshot between two of them leaves a half-swapped board.

let crushPlan: {
  uid: number;
  goal: LargeGrid;
  terrain: string[];
  queue: number[];
  stops: { col: number; row: number }[];
  // A picked escape grid waiting on the facing choice (3.4.4, FAQ L6).
  // `exchange` marks the 4.3.6 swap instead: there is no Grid to pick, because
  // the crushed Unit takes the one the crusher is vacating, but the crushing
  // player still chooses its Facing.
  pendingSpot?: { col: number; row: number; c: number; r: number; facing?: Facing; exchange?: boolean };
  // The crushed Units that had nowhere to go, with the Facing chosen for each.
  exchanges: { uid: number; facing?: Facing }[];
  free?: boolean;
  granted?: boolean;
  shoveActionId?: string;
  attackAfter?: { actionId: string; refund?: { uid: number; slot: string; choice?: string } };
  facing?: Facing;
  // The route, kept so the Boxes it walked over are still offered once the
  // crush has been worked through — and with it the budget it was drawn
  // against, since Auto Mine Laying is priced in the Move Range left over
  // and M7 allows Laying and Crushing inside one Movement.
  path: LargeGrid[];
  steps: number;
  flying: boolean;
  // ZHDR-304's tow, carried across the Crush. A Movement that ends in one
  // leaves through finishCrush instead of the plain settle, so without a home
  // on the plan the drag was simply dropped.
  drag?: { allyUid: number; funderUid: number };
  // The Movement Action being made, and the Link its route owes an Obstruct
  // lock (audit Phase 4, D2). Carried for the same reason as the drag: the
  // maneuver finishCrush sends named no Action, so a Sprint ending in a Crush
  // was judged as a bare Maneuver and paid no Non-humanoid Link.
  actionId?: string;
  breakAwayLink?: number;
  // The rest of a Movement a Mine stopped (C1).
  resume?: boolean;
  // The Red Shoes' controller, when the crusher is the unit it steers: its
  // seat makes the Crush (ruling I5; ruled R1, audit Phase 7, P7D 1).
  controller?: { uid: number; side: Side };
} | null = null;

// Who a Crush's commands travel under: the crusher's own seat, or, when The
// Red Shoes steers it, the controller's own unit. The relay takes only the
// sender's seat, and a unit destroyed by the Crush scores for the controller's
// side (ruled R1, R2; audit Phase 7, P7D 1).
function crushActor(m: { controller?: { uid: number; side: Side } }, crusher: Token): { seat: Side; uid: number } {
  return m.controller ? { seat: m.controller.side, uid: m.controller.uid } : { seat: crusher.side, uid: crusher.uid };
}

// Where a crushed Unit may be pushed: rules.ts crushEscapeGrids, the one copy
// both boards read, with the crusher standing in the Grid it steps out of
// (audit Phase 4, C1). Not into an Abyss: whether a Crush may drop a Ground
// Unit down one is a ruling we do not have, so the conservative table is the
// one where the crusher cannot pick that Grid at all.
function crushEscapes(ctx: HudCtx, v: Token, m: { uid: number; goal: LargeGrid; path: LargeGrid[] }): LargeGrid[] {
  const crusher = ctx.state.tokens.find((x) => x.uid === m.uid);
  const from = m.path.length >= 2 ? m.path[m.path.length - 2] : null;
  return crushEscapeGrids(v, m.goal, crusher, from, terrainOf(ctx), ctx.state.tokens,
    (c, r) => isGroundUnit(ctx.data, v) && envCardAt(ctx.state, c, r) === 'abyss');
}

// Works the queue down, handling everything that needs no choice, and stops as
// soon as it reaches a victim the player has to place.
function advanceCrush(ctx: HudCtx): void {
  const m = crushPlan;
  if (!m) return;
  const s = ctx.state;
  const crusher = s.tokens.find((x) => x.uid === m.uid);
  if (!crusher) { crushPlan = null; ctx.refresh(); return; }
  const by = crushActor(m, crusher);
  if (m.terrain.length) {
    if (ctx.send(turn.crushDestroy(by, m.terrain)).ok) ctx.noteNow(`${crusher.label} crushes ${m.terrain.length === 1 ? 'a piece of' : `${m.terrain.length} pieces of`} Destructible Terrain in ${gridName(m.goal.c, m.goal.r)}.`, 'done');
    m.terrain = [];
  }
  while (m.queue.length) {
    const v = s.tokens.find((x) => x.uid === m.queue[0]);
    if (!v) { m.queue.shift(); continue; }
    if (!canBeForceMoved(ctx.data, v)) {
      // A kill credited to the crusher, or to The Red Shoes' controller when it
      // steers the crusher (ruled R2); `despawn` recorded none (audit Phase 4, C6).
      if (ctx.send({ kind: 'recordKill', ...by, targetUid: v.uid, what: 'unit' }).ok) ctx.noteNow(`${v.label} cannot be Force-Moved, so being crushed destroys it (4.3.6).`, 'done');
      m.queue.shift();
      continue;
    }
    const out = crushEscapes(ctx, v, m);
    if (!out.length) {
      // 4.3.6: "If NONE of the Grids within Range of that Forced Movement can
      // be entered, the crushed Unit instead EXCHANGES POSITIONS with the
      // Crushing Unit." Only the Facing is a choice here — the Grid is the one
      // the crusher is vacating — so the panel goes straight to it and the
      // exchange itself is settled in finishCrush, once the rest of the Grid
      // has given way and every mover can travel as one command.
      //
      // THE GRID NAMED HERE IS THE ONE THE CRUSHER STEPS OUT OF, read exactly
      // as finishCrush reads it. `Math.floor(crusher.col / 3)` used to stand in
      // its place — the same expression the round before deleted from rules.ts,
      // and wrong for the same reason: nothing has written col/row yet, so it
      // answers with the Grid the whole Movement BEGAN in.
      //
      // HONEST ABOUT ITS REACH, because the guard directly below narrows it: an
      // exchange is only ever opened when the step-out Grid has no room for the
      // crushed Unit, and the only thing that can be filling it while the route
      // is still legal is the crusher's own 3x3 body — i.e. a route one Grid
      // long, where the two expressions agree. Measured by driving this function
      // over 13,312 routes x walls x blockers x victim sizes: 216 exchanges
      // opened, 0 of them from a Grid the crusher was not already standing in.
      // So this is not covering a live wrong-Grid case today; it is here because
      // it is what the line MEANS, and because the panel and finishCrush must
      // read the Grid from one place or they will drift apart again.
      const from = m.path.length >= 2 ? m.path[m.path.length - 2] : null;
      // AND WHETHER THERE IS AN EXCHANGE TO ASK ABOUT AT ALL. crushExchangeSpots
      // is the victim half of the reader finishCrush runs, so a `no` here is the
      // same `no` that would come back after the facing question — and a
      // question the engine has already decided to refuse is not a question.
      // On a multi-Grid route this is the common answer rather than the rare
      // one: the step-out Grid is one of the neighbours crushEscapes just tested
      // and found full, and the crusher is not standing in it to be the reason.
      // The Movement itself still happened and still pays, exactly as freeplay
      // charges it — it stops short one Grid on, which is a Movement, not a
      // refusal.
      const room = from && crushExchangeSpots(crusher, [...swappedSoFar(ctx, m), v], m.goal, from, terrainOf(ctx), ctx.state.tokens);
      if (!from || !room) {
        ctx.noteNow(from
          ? `${v.label} has nowhere to go, and ${gridName(from.c, from.r)}, the Grid ${crusher.label} is stepping out of, has no room for it either, so there are no positions to exchange (4.3.6).`
          : `${v.label} has nowhere to go, and ${crusher.label} has no Grid next door to trade for: an exchange trades places across a single Grid boundary (4.3.6).`, 'done');
        m.queue.shift();
        continue;
      }
      m.pendingSpot = { col: v.col, row: v.row, c: from.c, r: from.r, exchange: true };
      board?.clearHighlights();
      return;
    }
    return; // this one needs the player to choose
  }
  finishCrush(ctx);
}

// The Units already promised an exchange, in the order they were promised it —
// the same order finishCrush hands to crushExchange, because each one takes a
// cell of the step-out Grid and the next is measured around it.
function swappedSoFar(ctx: HudCtx, m: { exchanges: { uid: number }[] }): Token[] {
  return m.exchanges
    .map((x) => ctx.state.tokens.find((y) => y.uid === x.uid))
    .filter((x): x is Token => !!x);
}

function finishCrush(ctx: HudCtx): void {
  const m = crushPlan;
  crushPlan = null;
  board?.clearHighlights();
  if (!m) { ctx.refresh(); return; }
  const t = ctx.state.tokens.find((x) => x.uid === m.uid);
  const last = m.stops[m.stops.length - 1];
  if (!t || !last) { ctx.refresh(); return; }
  const terrain = terrainOf(ctx);
  // Where the Movement started. Read BEFORE anything is sent, because the
  // exchange below places the crusher itself and the `maneuver` that records
  // the Movement would otherwise measure zero Grids travelled.
  const began = { col: t.col, row: t.row };
  const swapped = swappedSoFar(ctx, m);
  // 4.3.6's exchange. crushExchange takes BOTH sides out of the occupancy list,
  // which is what the old fallback could not do, and answers null only when the
  // pair genuinely will not fit.
  //
  // The Grid the crusher STEPS OUT OF is the second-to-last Grid of the route,
  // and it is handed over rather than left to be derived: nothing has moved the
  // token yet — animateMove is SVG only and the maneuver below is what finally
  // writes col/row — so reading the crusher here answers with the Grid the
  // whole Movement began in. Routed (1,0)->(1,1)->(1,2) that sent the victim to
  // (1,0), two Grids away. A route with no second-to-last Grid cannot produce a
  // legal exchange at all, so it falls to the stops-short branch below.
  const from = m.path.length >= 2 ? m.path[m.path.length - 2] : null;
  const pair = swapped.length && from ? crushExchange(t, swapped, m.goal, from, terrain, ctx.state.tokens) : null;
  // The Grid is clear now, so the crusher takes the spot it can actually stand
  // in rather than the one computed before anything gave way. No snapPlacement
  // fallback: that helper does no occupancy and no terrain test, so falling back
  // to it is exactly how the crusher used to land on a unit that never moved.
  const spot = swapped.length
    ? pair?.crusher
    : turn.crushLanding(ctx.data, ctx.state, t, m.goal);
  // Nothing printed lets two units share a Large Grid, so the Crush stops short
  // of it rather than landing on top of one, and the Movement ends where the
  // route last had room. Said out loud: the silence is what made the old failure
  // impossible to diagnose at the table.
  //
  // Hoisted out of the `!spot` branch because a crushSwap that check() REFUSES
  // has to end the same way. It used to return after the send, recording no
  // maneuver at all, so the Match Centre left the crusher in the Grid the
  // Movement started in while freeplay left it at `held`, one Grid on — the two
  // pages disagreeing about where the same Movement finished. Low reach today
  // (after crushExchange has tested terrain and occupancy the only refusal left
  // is the PDLH-202 leash, which moveOptsFor already caps), but "cannot fit" and
  // "was refused" are the same outcome for the player and must read the same.
  const walk = m.stops.slice(0, -1);
  const held = walk[walk.length - 1] ?? { col: t.col, row: t.row };
  // The Movement is recorded by its own command: the crusher's `maneuver`, or
  // under The Red Shoes the controller's `controlledMove`, which spends the
  // debt (ruled R1; audit Phase 7, P7D 1).
  const ctl = m.controller;
  // controlledMove carries no `from`: after the exchange has placed the unit,
  // the Grid the Movement began in is left out of `via` instead, so the High
  // Temperature walk does not count it as entered.
  const startG = { c: Math.floor(began.col / 3), r: Math.floor(began.row / 3) };
  const walked = (via: { col: number; row: number }[]) => via.filter((p) => Math.floor(p.col / 3) !== startG.c || Math.floor(p.row / 3) !== startG.r);
  const record = (to: { col: number; row: number }, via: { col: number; row: number }[], from?: { col: number; row: number }): boolean => (ctl
    ? ctx.send({ kind: 'controlledMove', seat: ctl.side, uid: ctl.uid, targetUid: t.uid, to, via: from ? walked(via) : via, facing: m.facing, actionId: m.actionId }).ok
    : ctx.send(turn.crushRecord(t, m, to, via, from)).ok);
  // What follows a Movement is its own player's: the tow, the Mines, the Boxes,
  // a shove and a Shock strike. The controller offers none of it, as the plain
  // controlled route offers none.
  const after = (): void => {
    if (ctl) return;
    if (m.drag) towDraggedAlly(ctx, t, m.path, m.drag);
    offerMinesOn(ctx, t, m.path, m.steps, m.flying);
    offerBoxesOn(ctx, t.uid, m.path, m.flying || !!t.aerial);
    if (m.shoveActionId) startShove(t.uid, m.shoveActionId);
    if (m.attackAfter) resumeShockAttack(ctx, t.uid, m.attackAfter);
  };
  const stopShort = (why: string): void => {
    board?.animateMove(t.uid, walk, () => {
      if (record(held, walk)) ctx.noteNow(why, 'warn');
      after();
      ctx.refresh();
    });
  };
  if (!spot) {
    stopShort(swapped.length
      ? `${swapped.map((v) => v.label).join(' and ')} had nowhere to go, and there is no room to exchange places with ${t.label} either, so the Crush stops short of ${gridName(m.goal.c, m.goal.r)} and the Movement ends here (4.3.6).`
      : `${t.label} still cannot fit into ${gridName(m.goal.c, m.goal.r)} now the Crush is done, so it stops short and its Movement ends here (4.3.6).`);
    return;
  }
  const stops = [...m.stops.slice(0, -1), spot];
  board?.animateMove(t.uid, stops, () => {
    if (pair) {
      // ONE command for every token that moves. Split into a maneuver and a
      // nudge it would leave a board on which the crusher stands on the unit it
      // is trading places with, and both the undo ring and the networked
      // rollback take their snapshots between commands.
      // Under The Red Shoes the controller's seat makes it, by the debt it
      // holds, and the exchange stamps that debt (ruled R1; P7D 1).
      const verdict = ctx.send({
        kind: 'crushSwap',
        seat: ctl?.side ?? t.side,
        uid: t.uid,
        to: spot,
        facing: m.facing,
        swaps: pair.victims.map((v) => ({ uid: v.uid, to: v.to, facing: m.exchanges.find((x) => x.uid === v.uid)?.facing })),
      });
      // A refused exchange leaves everything standing, so the note must not
      // claim it happened — and the maneuver below must not then walk the
      // crusher into a Grid that never gave way. It ends where a Crush that
      // would not fit ends, which is what freeplay does with the same verdict.
      if (!verdict.ok) {
        stopShort(`${t.label} could not exchange places with ${swapped.map((v) => v.label).join(' and ')}: ${verdict.why} The Crush stops short of ${gridName(m.goal.c, m.goal.r)} and the Movement ends here (4.3.6).`);
        return;
      }
      ctx.noteNow(`${swapped.map((v) => v.label).join(' and ')} had nowhere to go, so ${swapped.length === 1 ? 'it exchanges' : 'they exchange'} positions with ${t.label} (4.3.6). Its Movement ends there.`, 'done');
    }
    // The Movement itself is recorded either way, and this is where the Maneuver
    // Tick is spent — crushSwap deliberately charges nothing, because a Crush
    // can end a Movement Action just as easily as a Maneuver. `from` is only
    // sent when the exchange has already placed the unit. A controlled one is
    // recorded where the exchange stamped the debt, the `to` its check holds.
    const crushedIn = record(spot, stops, pair ? began : undefined);
    if (crushedIn && !pair) ctx.noteNow(`${t.label} crushes into ${gridName(m.goal.c, m.goal.r)}, and its Movement ends there (4.3.6).`, 'done');
    // After the crusher has landed, exactly as on the plain settle: the Grid it
    // vacated is only free once it has actually left it.
    after();
    ctx.refresh();
  });
}

function placeCrushed(ctx: HudCtx, c: number, r: number): void {
  const m = crushPlan;
  const v = m ? ctx.state.tokens.find((x) => x.uid === m.queue[0]) : undefined;
  const crusher = m ? ctx.state.tokens.find((x) => x.uid === m.uid) : undefined;
  if (!m || !v || !crusher) return;
  const spot = standingSpot(c, r, v.size, v.aerial, terrainOf(ctx), ctx.state.tokens, v.uid);
  if (!spot) return;
  // The crushing player also decides the victim's facing (3.4.4, FAQ L6), so
  // the send waits for that choice in the panel.
  m.pendingSpot = { col: spot.col, row: spot.row, c, r };
  board?.clearHighlights();
  ctx.refresh();
}

function confirmCrushed(ctx: HudCtx): void {
  const m = crushPlan;
  const v = m ? ctx.state.tokens.find((x) => x.uid === m.queue[0]) : undefined;
  const crusher = m ? ctx.state.tokens.find((x) => x.uid === m.uid) : undefined;
  const p = m?.pendingSpot;
  if (!m || !v || !crusher || !p) return;
  if (p.exchange) {
    // The 4.3.6 exchange travels in finishCrush's single crushSwap, so all this
    // step records is the Facing the crushing player chose (3.4.4, FAQ E17).
    // Sending it now would move the crushed Unit into a Grid the crusher has not
    // left yet.
    m.exchanges = [...m.exchanges, { uid: v.uid, facing: p.facing }];
  } else {
    // Under The Red Shoes the shove travels as the controller's (ruled R1).
    if (ctx.send({ kind: 'forceMove', ...crushActor(m, crusher), targetUid: v.uid, to: { col: p.col, row: p.row }, facing: p.facing }).ok) ctx.noteNow(`${crusher.label} crushes ${v.label}, Force-Moved to ${gridName(p.c, p.r)}.`, 'done');
  }
  m.pendingSpot = undefined;
  m.queue.shift();
  advanceCrush(ctx);
  ctx.refresh();
}

function crushPanel(ctx: HudCtx): string {
  const m = crushPlan!;
  const v = ctx.state.tokens.find((x) => x.uid === m.queue[0]);
  const crusher = ctx.state.tokens.find((x) => x.uid === m.uid);
  if (!v || !crusher) return head('Crush', 'Nothing left to move', '', true)
    + '<div class="tp-body"></div><div class="tp-foot"><button class="bigbtn" data-act="crushauto">Continue</button></div>';
  if (m.pendingSpot) {
    const p = m.pendingSpot;
    const opts = (['N', 'E', 'S', 'W'] as const)
      .map((lbl, i) => `<button class="rowbtn${p.facing === i ? ' on' : ''}" data-crushface="${i}">${lbl}${v.facing === i ? ' ·' : ''}</button>`)
      .join('');
    const where = p.exchange
      ? `Nowhere to go, so it exchanges positions with ${esc(crusher.label)} in ${gridName(p.c, p.r)} (4.3.6). You choose the facing (3.4.4).`
      : `Force-Moved to ${gridName(p.c, p.r)}. You choose the facing too (3.4.4).`;
    return head('Your move', `Crush: which way does ${esc(v.label)} face?`, where, true)
      + `<div class="tp-body">
          <div class="dialrow"><span class="nm">Facing</span><div class="btnrow">${opts}<button class="rowbtn${p.facing === undefined ? ' on' : ''}" data-crushface="">leave</button></div></div>
        </div>
        <div class="tp-foot"><button class="bigbtn" data-act="crushgo">Confirm</button></div>`;
  }
  const out = crushEscapes(ctx, v, m);
  return head('Your move', `Crush: where does ${esc(v.label)} go?`, `${esc(crusher.label)} is entering ${gridName(m.goal.c, m.goal.r)}.`, true)
    + `<div class="tp-body">
        <p class="tp-note">Click a lit Grid. It moves 1 Grid, and you choose which, because you caused it (4.3.4).</p>
        <p class="tp-dim">${out.length} Grid${out.length === 1 ? '' : 's'} open${m.queue.length > 1 ? ` · ${m.queue.length - 1} more unit${m.queue.length === 2 ? '' : 's'} after this` : ''}.</p>
      </div>
      <div class="tp-foot"><button class="bigbtn ghost2" data-act="crushauto">Pick for me</button></div>`;
}

// ---------- Resupply (rulebook 4.13) ----------
//
// Ammo only comes back to a Part that has actually spent some, and never above
// what it started with. Some Actions reach an Ally as well as themselves, so
// the panel asks which unit gets it.

// Remote Access (5.3.3), mirroring performRemoteAccess in freeplay: which
// unaccessed Terminal within reach. Choosing one pays the Action and opens the
// Electronic Counter-roll against it in the shared window, the Terminal's
// stand-in as the Responder (ruling I25); the players used to roll it off the
// page and say how it went (OTTO, 2026-09-28).
let terminalPick: { uid: number; actionId: string; reach: number } | null = null;

let resupplyPick: { uid: number; actionId: string; rule: Resupply } | null = null;

// ---------- SH-15 Damage Control (FAQ D7/J21/J23) ----------
// MANIFESTATION MOVEMENT (4.12.2). The Reveal has been decided; what is open
// is where the unit really was. Offered as a list of Grids rather than a route
// because it is Teleportation - there is no path to draw, and every Grid within
// the Stealth value that the unit fits in is equally reachable.
// `facing` is the owner's to choose (FAQ I17: the move follows Flying Movement
// rules, and 4.3.2 lets a Movement set the Facing; ruled 2026-09-25, audit
// Phase 3, F4). It starts at the unit's own.
let manifestPick: { uid: number; why: string; facing: Facing } | null = null;

// Opens the Manifestation choice, or sends the plain Reveal when there is no
// choice to make - a Stealth 0 unit, an Immobilized one (FAQ I20), or one with
// nowhere in Range that fits.
function openManifest(ctx: HudCtx, t: Token, why: string): void {
  const range = manifestationRange(ctx.data, t);
  const spots = range > 0 ? manifestTargets(ctx.data, ctx.state.tokens, terrainOf(ctx), t, ctx.state) : [];
  if (!spots.length) {
    if (ctx.send({ kind: 'reveal', seat: t.side, uid: t.uid }).ok) {
      const where = immobilizedStop(t) ? ', where it stands: it is Immobilized (FAQ I20)'
        : range > 0 ? ', with nowhere in Range to Manifest into' : '';
      ctx.noteNow(`${why} ${t.label} leaves the Optical Camouflage State${where} (4.12.2).`, 'done');
    }
    return;
  }
  manifestPick = { uid: t.uid, why, facing: t.facing as Facing };
}

function manifestPanel(ctx: HudCtx): string {
  const m = manifestPick!;
  const t = ctx.state.tokens.find((x) => x.uid === m.uid);
  if (!t) return head('Reveal', 'That unit is gone', '', true)
    + '<div class="tp-body"></div><div class="tp-foot"><button class="bigbtn ghost2" data-act="manifeststay">Close</button></div>';
  const range = manifestationRange(ctx.data, t);
  const here = largeGridOf(t);
  const spots = manifestTargets(ctx.data, ctx.state.tokens, terrainOf(ctx), t, ctx.state)
    .slice()
    .sort((a, b) => (a.r - b.r) || (a.c - b.c));
  // Range, counted orthogonally (4.2.1): a diagonal neighbour is Range 2.
  const rows = spots.map((s) =>
    `<button class="rowwide" data-manifest="${s.col},${s.row}">Appear at ${gridName(s.c, s.r)}<span class="ct">Range ${Math.abs(s.c - here.c) + Math.abs(s.r - here.r)}</span></button>`).join('');
  const faces = [0, 1, 2, 3].map((f) =>
    `<button class="rowbtn${m.facing === f ? ' sel' : ''}" data-manifestface="${f}">${FACING_NAME[f]}</button>`).join('');
  return head('Your move', `${esc(t.label)} Manifests`,
    `${m.why} The camouflage model marked only a SUSPECTED position. This unit may appear within Range ${range} of ${gridName(here.c, here.r)} (Stealth ${range}) - Teleportation, so terrain and units in between do not matter.`, true)
    + `<div class="tp-body"><div class="turnrow">Facing: ${faces}</div>${rows || '<p class="tp-note">Nowhere within Range has room for it, so it Reveals where it stands.</p>'}</div>
       <div class="tp-foot"><button class="bigbtn ghost2" data-act="manifeststay">Stay at ${gridName(here.c, here.r)}</button></div>`;
}

// The "White Dwarf" Bit's Stance Change (293/294/295): pick the form, then make
// the one Movement the Action grants. Two steps, so it is a pick like the
// others rather than something routeAction can finish inline.
let formPick: { uid: number; actionId: string } | null = null;

function formPanel(ctx: HudCtx): string {
  const m = formPick!;
  const t = ctx.state.tokens.find((x) => x.uid === m.uid);
  const a = t ? actionOn(ctx, t, m.actionId) : undefined;
  if (!t || !a) return head('Stance Change', 'That unit is gone', '', true)
    + '<div class="tp-body"></div><div class="tp-foot"><button class="bigbtn ghost2" data-act="formcancel">Close</button></div>';
  const rows = (formSwitch(a) ?? [])
    .filter((id) => id !== t.cardId && ctx.data.byId.get(id))
    .map((id) => {
      const c = ctx.data.byId.get(id)!;
      return `<button class="rowwide" data-formgo="${esc(id)}">${esc(cardName(c))}<span class="ct">${esc(String(c.stance ?? 'no'))} stance</span></button>`;
    })
    .join('');
  return head('Your move', `${esc(a.name?.en || m.actionId)}: which Stance?`,
    `${esc(t.label)} turns its card over, then makes ONE Movement. Everything it carries - Ammo, Tokens, damage - comes with it; only the card changes.`, true)
    + `<div class="tp-body">${rows || '<p class="tp-note">No other form of this unit is in the card data.</p>'}</div>
       <div class="tp-foot"><button class="bigbtn ghost2" data-act="formcancel">${rows ? 'Cancel' : 'Close'}</button></div>`;
}

let shockPick: { uid: number; actionId: string; x: number; refund?: { uid: number; slot: string; choice?: string } } | null = null;

function shockPanel(ctx: HudCtx): string {
  const m = shockPick!;
  const t = ctx.state.tokens.find((x) => x.uid === m.uid);
  const a = t ? actionOn(ctx, t, m.actionId) : undefined;
  if (!t || !a) return head('Shock Attack', 'That unit is gone', '', true)
    + '<div class="tp-body"></div><div class="tp-foot"><button class="bigbtn ghost2" data-act="shockcancel">Close</button></div>';
  return head('Your move', `${esc(a.name?.en || m.actionId)}: Shock Attack ${m.x}`,
    `${esc(t.label)} may move up to ${m.x} Grid${m.x === 1 ? '' : 's'} before striking - Offensive Stance grants it. Taking the walk spends the Action, so the attack follows it either way.`, true)
    + `<div class="tp-body">
        <button class="rowwide" data-act="shockmove">Move first<span class="ct">up to ${m.x} Grid${m.x === 1 ? '' : 's'}, free</span></button>
        <button class="rowwide" data-act="shockskip">Straight to the attack</button>
      </div>
      <div class="tp-foot"><button class="bigbtn ghost2" data-act="shockcancel">Cancel</button></div>`;
}

// After the Shock walk lands - or is backed out of - the attack it belongs to
// reopens. shockAsked=true, or the door would put the same question again.
function resumeShockAttack(ctx: HudCtx, uid: number, after: { actionId: string; refund?: { uid: number; slot: string; choice?: string } }): void {
  const t = ctx.state.tokens.find((x) => x.uid === uid);
  if (!t) return;
  const a = actionOn(ctx, t, after.actionId);
  if (!a) return;
  openAttackPick(t, a, after.refund, true);
}

let repairPick: { uid: number; actionId: string; repair: boolean; mend: boolean; ally?: boolean; removeSelf?: boolean } | null = null;

function repairPanel(ctx: HudCtx): string {
  const m = repairPick!;
  const t = ctx.state.tokens.find((x) => x.uid === m.uid);
  const a = t ? actionOn(ctx, t, m.actionId) : undefined;
  if (!t || !a) return head('Repair', 'That unit is gone', '', true)
    + '<div class="tp-body"></div><div class="tp-foot"><button class="bigbtn ghost2" data-act="repaircancel">Close</button></div>';
  const rows: string[] = [];
  // The SU1's Armor Patch mends an ALLY, then leaves (audit Phase 6, C6).
  if (m.ally) {
    for (const x of allyRepairTargets(ctx.data, ctx.state.tokens, t, a, !!ctx.state.noBoard)) {
      rows.push(`<button class="rowwide" data-repairgo="mend:${x.slot}:${x.unit.uid}">Mend ${esc(x.unit.label)} · ${SLOT_LABEL[x.slot as PartSlot | 'main'] ?? x.slot}<span class="ct">Damaged becomes intact${m.removeSelf ? `, then ${esc(t.label)} leaves` : ''}</span></button>`);
    }
  }
  for (const { slot, card } of m.ally ? [] : tokenCards(ctx.data, t)) {
    if (slot === 'pilot') continue;
    const st = t.partStates[slot as PartSlot | 'main'] ?? 'intact';
    if (m.repair && st === 'destroyed' && !(t.repairedSlots ?? []).includes(slot)) {
      rows.push(`<button class="rowwide" data-repairgo="repaired:${slot}">Repair ${SLOT_LABEL[slot]}<span class="ct">${esc(cardName(card))} - its Actions return</span></button>`);
    }
    if (m.mend && st === 'damaged') {
      rows.push(`<button class="rowwide" data-repairgo="mend:${slot}">Mend ${SLOT_LABEL[slot]}<span class="ct">${esc(cardName(card))} - Damaged becomes intact</span></button>`);
    }
  }
  return head('Your move', `${esc(a.name?.en || m.actionId)}: repair what?`,
    'A Repaired Part acts again but stays destroyed for Integrity, gives back no Link, and a hit removes it with the attack moving to the Core (FAQ J21/J23).', true)
    + `<div class="tp-body">${rows.join('') || '<p class="tp-note">No destroyed Part is missing a Repaired Token and nothing is Damaged, so there is nothing this can change.</p>'}</div>
       <div class="tp-foot"><button class="bigbtn ghost2" data-act="repaircancel">${rows.length ? 'Skip' : 'Close'}</button></div>`;
}

function resupplyHolders(ctx: HudCtx, from: Token, rule: Resupply): Token[] {
  return ctx.state.tokens.filter((o) => {
    if (o.deployed === false) return false;
    if (o.uid !== from.uid && (!rule.allies || o.side !== from.side)) return false;
    // "Adjacent" is the eight Grids around, diagonals included (4.2.2; audit
    // Phase 4, F1); anything else is a Range.
    if (o.uid !== from.uid && rule.adjacent) {
      if (!rangeBetween(from, o).adjacent) return false;
    } else if (gridsApart(from, o) > rule.range) return false;
    const max = tokenCards(ctx.data, o).flatMap(({ card }) => card.actions ?? []).find((a) => a.id === rule.actionId)?.storage;
    if (!max) return false;
    return (o.ammo?.[rule.actionId] ?? max) < max;
  });
}

// Freeplay's first question: which Terminal. The roll follows in the window.
function terminalPanel(ctx: HudCtx): string {
  const m = terminalPick!;
  const s = ctx.state;
  const t = s.tokens.find((x) => x.uid === m.uid);
  if (!t) return head('Remote Access', 'That unit is gone', '', true)
    + '<div class="tp-body"></div><div class="tp-foot"><button class="bigbtn ghost2" data-act="terminalcancel">Close</button></div>';
  const zoneName = (id: string) => zonesOf(ctx.data.zoneData.zones, ctx.state).find((z) => z.id === id)?.name ?? id;
  // Measured to the nearest Grid of each zone (FAQ P6; audit Phase 6, E1).
  const open = terminalsInReach(normaliseTasks(s.tasks).items, t, m.reach, s.noBoard ? null : zoneCellsOf(ctx.data, s));
  const rows = open
    .map((i) => `<button class="rowwide" data-terminal="${esc(i.id)}">${esc(zoneName(i.zone))}<span class="ct">Terminal · EV 3</span></button>`)
    .join('');
  return head('Your move', 'Remote Access: which Terminal?', `A Terminal whose Tactical Zone is within Range ${m.reach}, not yet accessed this round (5.3.3).`, true)
    + `<div class="tp-body">${rows || '<p class="tp-note">No Terminal is in reach, or every one in reach has already been accessed this round. Each Terminal may only be accessed once per round (5.3.3).</p>'}</div>
       <div class="tp-foot"><button class="bigbtn ghost2" data-act="terminalcancel">${open.length ? 'Cancel' : 'Close'}</button></div>`;
}

function resupplyPanel(ctx: HudCtx): string {
  const m = resupplyPick!;
  const from = ctx.state.tokens.find((x) => x.uid === m.uid);
  const a = from ? actionOn(ctx, from, m.actionId) : undefined;
  if (!from) return head('Resupply', 'That unit is gone', '', true)
    + '<div class="tp-body"></div><div class="tp-foot"><button class="bigbtn ghost2" data-act="resupplycancel">Close</button></div>';
  const holders = resupplyHolders(ctx, from, m.rule);
  const rows = holders
    .map((o) => {
      const max = tokenCards(ctx.data, o).flatMap(({ card }) => card.actions ?? []).find((x) => x.id === m.rule.actionId)?.storage ?? 0;
      const held = o.ammo?.[m.rule.actionId] ?? max;
      return `<button class="rowwide" data-resupply="${o.uid}">${esc(o.label)}${o.uid === from.uid ? ' (this Mech)' : ''}<span class="ct">Ammo ${held}/${max} · +${m.rule.amount}</span></button>`;
    })
    .join('');
  return head('Your move', `${esc(a?.name?.en || m.actionId)}: resupply which unit?`, m.rule.range
    ? `This Mech, or an Ally within Range ${m.rule.range}, that has spent the Ammo this Action restores.`
    : 'Only this Mech is in reach.', true)
    + `<div class="tp-body">${rows || '<p class="tp-note">Nothing in reach has spent any of that Ammo.<br>Only a Part that has used some can be topped up, never past its Storage (4.13).</p>'}</div>
       <div class="tp-foot"><button class="bigbtn ghost2" data-act="resupplycancel">${holders.length ? 'Skip' : 'Close'}</button></div>`;
}

// ---------- Charge Tokens (rulebook 4.14) ----------
//
// A Charge Action turns one Part's token face-up; an Action marked [Charged]
// may flip it back down for its stronger effect, and keeping it for later is a
// real choice, so both are asked rather than assumed.

// `only` rides a spend for the KK9's Overwatch Strike, whose attack may target
// the designated enemy alone (FAQ K15).
let chargePlan: { uid: number; on: boolean; actionId?: string; only?: number } | null = null;
// |Discard| (6.1, 4.17): which Handheld Part, asked before the Tick is paid;
// the Action's own command turns it over (ruled R2). The panel paid the Tick
// and said to follow the card text, and no control here could turn a Part
// over (audit Phase 7, P7A 2).
let discardPick: { uid: number } | null = null;
// Stabilize System's one question (units.ts stabiliseAsk, shared with the
// tabletop and the pad): which Square or Hexagon Token comes off, face
// included, or none of them when a Link is missing (FAQ J4, J8). Asked BEFORE
// the Tick is paid, so Cancel really cancels - it used to be asked after, with
// no way out, and it only ever offered the first Token worn.
let stabilisePick: { uid: number } | null = null;

function stabilisePanel(ctx: HudCtx): string {
  const m = stabilisePick!;
  const t = ctx.state.tokens.find((x) => x.uid === m.uid);
  if (!t) return head('Stabilize System', 'That unit is gone', '', true)
    + '<div class="tp-body"></div><div class="tp-foot"><button class="bigbtn ghost2" data-act="stabcancel">Close</button></div>';
  const ask = stabiliseAsk(ctx.data, t);
  const rows = ask.picks.map((p) => `<button class="rowwide" data-stab="${esc(p.id)}">${esc(stabiliseRowLabel(p))}</button>`).join('')
    + (ask.keep ? `<button class="rowwide" data-stab="__keep">${esc(STABILISE_KEEP_LABEL)}</button>` : '');
  return head('Your move', 'Stabilize System', esc(ask.body), true)
    + `<div class="tp-body">${rows}</div>
       <div class="tp-foot"><button class="bigbtn ghost2" data-act="stabcancel">Cancel</button></div>`;
}

// Strengthen Link (018_B all, 504_A one), a Link Beacon's Link Support (075_A)
// and System Cleanup (504_B, TM31RS_B): units.ts linkSupportOf and
// tokenCleanupOf. Who is in reach is read off the board; the Ticks wait in
// pendingAction until the player confirms, so backing out costs nothing.
let linkPick: { uid: number; actionId: string; rule: LinkSupport } | null = null;
let cleanPick: { uid: number; actionId: string; rule: TokenCleanup; targetUid?: number } | null = null;

function linkPanel(ctx: HudCtx): string {
  const m = linkPick!;
  const from = ctx.state.tokens.find((x) => x.uid === m.uid);
  const a = from ? actionOn(ctx, from, m.actionId) : undefined;
  if (!from || !a) return head('Restore Link', 'That unit is gone', '', true)
    + '<div class="tp-body"></div><div class="tp-foot"><button class="bigbtn ghost2" data-act="linkcancel">Close</button></div>';
  const what = a.name?.en || a.id;
  const reach = actionRange(ctx.data, ctx.state.tokens, from, a);
  const targets = linkSupportTargets(ctx.data, ctx.state.tokens, from, a);
  const es = isElectronicSupport(a) ? ' Terrain and line of sight play no part (4.11.1).' : '';
  const sub = m.rule.selection === 'all'
    ? `Every Ally Mech within Range ${reach} recovers ${m.rule.amount} Link, and one in Shutdown takes it and stays down (FAQ L3).${es}`
    : `One Ally Mech within Range ${reach} recovers ${m.rule.amount} Link, even one in Shutdown (FAQ L3).${es}`;
  const ct = (x: Token): string => `<span class="ct">Link ${x.link ?? 0}/${maxLink(ctx.data, x)}${x.stance === 'shutdown' ? ' · Shutdown' : ''} · +${m.rule.amount}</span>`;
  const name = (x: Token): string => `${esc(x.label)}${x.uid === from.uid ? ' (this Mech)' : ''}`;
  const beacon = from.kind === 'projectile';
  let body: string;
  let foot: string;
  if (!targets.length) {
    // A Beacon's Delayed Action is its turn and resolves even when it changes
    // nothing; a Mech's Action that could change nothing cannot be performed
    // (FAQ H2), so its Tick stays unspent.
    body = `<p class="tp-note">No Ally Mech within Range ${reach} is short of Link.${beacon ? '' : ' An action that cannot produce any change cannot be performed (FAQ H2).'}</p>`;
    foot = beacon
      ? '<button class="bigbtn" data-act="linkgo">Done</button><button class="bigbtn ghost2" data-act="linkcancel">Cancel</button>'
      : '<button class="bigbtn ghost2" data-act="linkcancel">Close</button>';
  } else if (m.rule.selection === 'all') {
    body = targets.map((x) => `<div class="rowwide sel static">${name(x)}${ct(x)}</div>`).join('');
    foot = '<button class="bigbtn" data-act="linkgo">Restore Link</button><button class="bigbtn ghost2" data-act="linkcancel">Cancel</button>';
  } else {
    body = targets.map((x) => `<button class="rowwide" data-linkto="${x.uid}">${name(x)}${ct(x)}</button>`).join('');
    foot = '<button class="bigbtn ghost2" data-act="linkcancel">Cancel</button>';
  }
  return head('Your move', `${esc(what)}: ${m.rule.selection === 'all' ? 'restore Link' : 'which Ally Mech?'}`, sub, true)
    + `<div class="tp-body">${body}</div><div class="tp-foot">${foot}</div>`;
}

function cleanPanel(ctx: HudCtx): string {
  const m = cleanPick!;
  const from = ctx.state.tokens.find((x) => x.uid === m.uid);
  const a = from ? actionOn(ctx, from, m.actionId) : undefined;
  if (!from || !a) return head('Remove a Token', 'That unit is gone', '', true)
    + '<div class="tp-body"></div><div class="tp-foot"><button class="bigbtn ghost2" data-act="cleancancel">Close</button></div>';
  const what = a.name?.en || a.id;
  const reach = actionRange(ctx.data, ctx.state.tokens, from, a);
  const shape = m.rule.shape === 'square' ? 'Square' : 'Hexagon';
  const unit = m.targetUid !== undefined ? ctx.state.tokens.find((x) => x.uid === m.targetUid) : undefined;
  if (unit) {
    const rows = removableTokens(unit, [m.rule.shape])
      .map((p) => `<button class="rowwide" data-cleantok="${esc(p.id)}">Remove ${esc(p.label)}</button>`).join('');
    return head('Your move', `${esc(what)}: which Token comes off ${esc(unit.label)}?`, `One ${shape} Token, either face.`, true)
      + `<div class="tp-body">${rows}</div><div class="tp-foot"><button class="bigbtn ghost2" data-act="cleancancel">Cancel</button></div>`;
  }
  const units = tokenCleanupTargets(ctx.data, ctx.state.tokens, from, a, m.rule);
  const rows = units
    .map((x) => `<button class="rowwide" data-cleanunit="${x.uid}">${esc(x.label)}${x.uid === from.uid ? ' (this unit)' : ''}<span class="ct">${esc(removableTokens(x, [m.rule.shape]).map((p) => p.label).join(', '))}</span></button>`)
    .join('');
  return head('Your move', `${esc(what)}: which Ally Unit?`, `One ${shape} Token comes off one Ally Unit within Range ${reach}. Terrain and line of sight play no part (4.11.1).`, true)
    + `<div class="tp-body">${rows || `<p class="tp-note">No Ally Unit within Range ${reach} wears a ${shape} Token. An action that cannot produce any change cannot be performed (FAQ H2).</p>`}</div>
       <div class="tp-foot"><button class="bigbtn ghost2" data-act="cleancancel">${units.length ? 'Cancel' : 'Close'}</button></div>`;
}

// The Details card's door to a Link Beacon or a support Action outside an
// Opportunity (the sandbox, and a Beacon resolved from its card): the same
// panels, with nothing latched to pay.
export function startSupportPick(uid: number, actionId: string): boolean {
  const ctx = hudRef;
  if (!ctx) return false;
  const t = ctx.state.tokens.find((x) => x.uid === uid);
  const a = t ? actionOn(ctx, t, actionId) : undefined;
  if (!t || !a) return false;
  const link = linkSupportOf(a);
  if (link) { linkPick = { uid, actionId: a.id, rule: link }; ctx.refresh(); return true; }
  const clean = tokenCleanupOf(a);
  if (clean) { cleanPick = { uid, actionId: a.id, rule: clean }; ctx.refresh(); return true; }
  return false;
}

function chargePanel(ctx: HudCtx): string {
  const s = ctx.state;
  const m = chargePlan!;
  const t = s.tokens.find((x) => x.uid === m.uid);
  if (!t) return head('Charge', 'That unit is gone', '', true)
    + '<div class="tp-body"></div><div class="tp-foot"><button class="bigbtn ghost2" data-act="chargecancel">Close</button></div>';
  // A spend pays with the Charge on the Action's OWN Part: [Charged] applies
  // "if the Part has a face-up Charge Token". Every Charged Part used to be
  // offered, so a Torso's KC Charge bought an Ion gun its Mutilation and the
  // gun kept its own token (audit Phase 2, C5).
  const own = !m.on && m.actionId
    ? guidedActions(ctx.data, t, { tokens: s.tokens, terrain: terrainOf(ctx) }).find((g) => g.action.id === m.actionId)?.slot
    : undefined;
  const slots = chargeableSlots(ctx.data, t).filter((x) => x.charged !== m.on && (!own || x.slot === own));
  // An either/or [Charged] line is spent on ONE of its arms (R7MG 556_A:
  // Multi-target 3 or Suppression), so each arm is its own button (E9).
  const act = !m.on && m.actionId ? actionOn(ctx, t, m.actionId) : undefined;
  const arms = act ? chargeChoices(act) : [];
  // A Common Charge is paid under the Part it names, so each row asks the
  // engine about that key: the same Part twice in one Opportunity is a repeat,
  // which this page used to flip anyway (audit Phase 7, P7A 7).
  const paying = m.on && pendingAction?.kind === 'performAction' && pendingAction.actionId === 'COMMON_CHARGE' ? pendingAction : null;
  const refused = (slot: string): string => {
    if (!paying) return '';
    const v = ctx.check(turn.chargePayment(paying, slot));
    return v.ok ? '' : ` aria-disabled="true" data-why="${esc(v.why ?? 'Not now.')}"`;
  };
  const rows = slots
    .map((x) => arms.length && !m.on
      ? arms.map((arm) => `<button class="rowwide" data-chargeslot="${esc(String(x.slot))}" data-choice="${esc(arm.id)}">${esc(x.label)}<span class="ct">spend it: ${esc(arm.label)}</span></button>`).join('')
      : `<button class="rowwide" data-chargeslot="${esc(String(x.slot))}"${refused(String(x.slot))}>${esc(x.label)}<span class="ct">${m.on ? 'turn face-up' : 'spend it'}</span></button>`)
    .join('');
  const why = m.on
    ? 'Only one Part may be Charged per Charge Action, and only one whose token is still face-down.'
    : 'Flipping it back down applies the effect this Action marks as [Charged]. Keeping it for a later use is allowed.';
  const empty = m.on
    ? `${esc(t.label)} has no Chargeable Part whose token is still face-down (4.14).`
    : `${esc(t.label)} holds no face-up Charge Token.`;
  return head('Your move', m.on ? 'Charge which Part?' : 'Consume the Charge?', why, true)
    + `<div class="tp-body">${rows || `<p class="tp-note">${empty}</p>`}</div>
       <div class="tp-foot"><button class="bigbtn ghost2" data-act="chargecancel">${m.on ? 'Cancel' : 'Keep it'}</button></div>`;
}

// Each Handheld Part that may Discard now (units.ts discardSlots: a Repaired
// one included, FAQ J23), checked against the engine under its own key.
function discardPanel(ctx: HudCtx): string {
  const m = discardPick!;
  const t = ctx.state.tokens.find((x) => x.uid === m.uid);
  const held = t ? discardSlots(ctx.data, t) : [];
  const rows = t && pendingAction?.kind === 'performAction' ? held.map((x) => {
    const v = ctx.check({ ...(pendingAction as Command & { kind: 'performAction' }), partKey: `COMMON_DISCARD@${x.slot}` });
    return `<button class="rowwide" data-discardslot="${esc(x.slot)}"${v.ok ? '' : ` aria-disabled="true" data-why="${esc(v.why ?? 'Not now.')}"`}>${esc(SLOT_LABEL[x.slot])}<span class="ct">${esc(cardName(x.card))} → ${esc(cardName(x.into))}</span></button>`;
  }).join('') : '';
  return head('Your move', 'Discard which Part?', 'It turns over to its Discard Card, and a Discard drops one Part only (FAQ K5). Ammo, Charge and Interception Tokens go with it only to an Action there that uses them (4.17).', true)
    + `<div class="tp-body">${rows || `<p class="tp-note">${esc(t ? `${t.label} holds nothing it can Discard.` : 'That unit is gone.')}</p>`}</div>
       <div class="tp-foot"><button class="bigbtn ghost2" data-act="discardcancel">Cancel</button></div>`;
}

// ---------- what an Action opens ----------
//
// A faithful mirror of performGuided() in main.ts, in the same order: the guide
// plays the turn rather than tallying it, so every Action Type opens the tool
// that actually resolves it, and the Ticks are only spent when that tool
// reports success.
//
// Anything added to performGuided belongs here too, or the Match Centre goes
// back to spending Ticks and doing nothing.

// A Projectile Action that can put more than one thing on the board asks which.
let launchPick: { uid: number; actionId: string; cardIds: string[] } | null = null;

// An Action whose tool is open but whose Ticks are not yet spent. Freeplay only
// pays when the tool reports success, so backing out costs nothing; the Match
// Centre used to pay on declaration, which left a cancelled Action having eaten
// the Opportunity. The command waits here until the tool actually does
// something, and is dropped if the player changes their mind.
let pendingAction: Command | null = null;

// Called at the moment a tool succeeds, always BEFORE the tool's own command —
// a free Movement Action move, for one, is only legal once its Action has been
// performed this Opportunity.
function commitAction(ctx: HudCtx): CheckResult {
  const cmd = pendingAction;
  pendingAction = null;
  if (!cmd) return { ok: true };
  const verdict = ctx.send(cmd);
  // Command Coordination resolves AFTER the Action (4.15.3), and this is the
  // one place every Action lands — the direct ones and the ones a tool finishes
  // — so hanging the offer here is what stops it going missing down one route.
  if (verdict.ok && cmd.kind === 'performAction') offerCoordinationFor(ctx, cmd.uid, cmd.actionId);
  return verdict;
}

// A command asked of the table as it will stand once the Action in hand is
// paid. The engine opens only the Counter-roll a paid Action buys (ruled R2;
// audit Phase 7, P7C 2), and a refused target must still cost nothing, so the
// payment waits for the answer.
function checkPaid(ctx: HudCtx, then: Command): CheckResult {
  return pendingAction ? checkAfter(ctx.data, ctx.state, pendingAction, then) : ctx.check(then);
}

// The Mech may hand out up to X of its reserved Command Tokens, to X different
// Drones. The question itself is shared with the play guide so both pages ask
// identically; only the send differs.
function offerCoordinationFor(ctx: HudCtx, uid: number, actionId: string): void {
  const t = ctx.state.tokens.find((x) => x.uid === uid);
  if (!t || t.kind !== 'mech') return;
  const act = tokenCards(ctx.data, t)
    .flatMap((c) => c.card.actions ?? [])
    .find((a) => a.id === actionId);
  if (!act) return;
  // coordinationFor, not the bare keyword: a Passive can grant Coordination to
  // a whole Action type of this Mech's, which is what Melee Synergy does.
  const upTo = coordinationFor(ctx.data, t, act);
  if (upTo <= 0) return;
  // An ATTACK's Coordination waits for the attack (FAQ 1.04 C8/C9): this runs
  // as the target is picked, before a die is rolled. settleHeldCoordination
  // offers it once the attack is over.
  if (act.type === 'Firing' || act.type === 'Melee') {
    coordHeld = { uid: t.uid, upTo };
    return;
  }
  runCoordination(ctx, t, upTo);
}

function runCoordination(ctx: HudCtx, t: Token, upTo: number): Promise<void> {
  return offerCoordination(ctx.data, ctx.state, t, upTo, (mechUid, targetUid) => {
    ctx.send({ kind: 'coordinateCommand', seat: t.side, uid: mechUid, targetUid });
    ctx.refresh();
  }, (_drone, text) => ctx.noteNow(text, 'done'), () => { ctx.send({ kind: 'endSwarm', seat: t.side }); ctx.refresh(); });
}

// THE HELD COORDINATION (FAQ 1.04), the play guide's settleCoordination for
// this page. C8: a Riposte ends the attacker's Opportunity at once, and
// Command Coordination comes after the attack, so a Riposte skips it. C9: the
// attacker's effects resolve before the defender's, so it is offered before
// the defender's Target Tracing is due - here, the moment the attack window
// closes on the attacking client, unless the defender still owes a decision on
// a Riposte (C7: answered first). Asked on every render, so it settles as soon
// as the defender's answer reaches this client.
let coordHeld: { uid: number; upTo: number } | null = null;
let coordRunning = false;

function settleHeldCoordination(ctx: HudCtx): void {
  const p = coordHeld;
  if (!p || coordRunning || ctx.combatBusy()) return;
  const sc = ensureScript(ctx.state);
  if ((sc.reactions ?? []).some((r) => r.kind === 'riposte' && r.fromUid === p.uid)) return;
  coordHeld = null;
  const t = ctx.state.tokens.find((x) => x.uid === p.uid);
  if (!t) return;
  if (sc.opp?.uid !== p.uid) {
    ctx.noteNow(`${t.label}'s Action Opportunity ended before its Command Coordination came due, so the Coordination is skipped (a Riposte ends it at once: FAQ C8).`);
    return;
  }
  coordRunning = true;
  void runCoordination(ctx, t, p.upTo).finally(() => {
    coordRunning = false;
    ctx.refresh();
  });
}

// A2K Data Link (GoF 1.021, 175_A): "This Mech may perform one Command
// Coordination after Maneuver". match.ts asks this from its send, where every
// Maneuver this seat makes lands, the way commitAction asks after an Action. A
// free or granted move rides an Action and is not the Maneuver (audit Phase 5,
// F2).
export function offerCoordinationAfterManeuver(cmd: Command): void {
  const ctx = hudRef;
  if (!ctx || cmd.kind !== 'maneuver' || cmd.free || cmd.granted) return;
  const t = ctx.state.tokens.find((x) => x.uid === cmd.uid);
  if (!t || t.kind !== 'mech') return;
  const upTo = coordinationAfterManeuver(ctx.data, t);
  if (upTo <= 0) return;
  void offerCoordination(ctx.data, ctx.state, t, upTo, (mechUid, targetUid) => {
    ctx.send({ kind: 'coordinateCommand', seat: t.side, uid: mechUid, targetUid });
    ctx.refresh();
  }, (_drone, text) => ctx.noteNow(text, 'done'), () => { ctx.send({ kind: 'endSwarm', seat: t.side }); ctx.refresh(); });
}

// Backing out. The Extra Action Opportunity an Action would have handed out goes
// with it, or a cancelled Action could still be paying for someone else's turn.
function dropAction(): void {
  pendingAction = null;
  grantPick = null;
}

// Every tool on this page is module state drawn against the current board. A
// checkpoint or a rollback REPLACES that board, and a route, a launch or a
// half-run Crush queue drawn against the old one would commit onto the new
// one - the Ticks in pendingAction for an Opportunity that may no longer
// exist. Called from match.ts wherever `state` is replaced.
export function resetHudTools(): void {
  placing = null;
  pending = null;
  deployCamo = false;
  envArm = null;
  movePlan = null;
  launchPlan = null;
  launchPick = null;
  crushPlan = null;
  blinkPlan = null;
  interceptNow = null;
  interceptPick = null;
  ewPick = null;
  boxPick = null;
  boxDrop = null;
  minePick = null;
  pendingBoxDrops = [];
  terminalPick = null;
  resupplyPick = null;
  manifestPick = null;
  formPick = null;
  shockPick = null;
  repairPick = null;
  chargePlan = null;
  discardPick = null;
  stabilisePick = null;
  linkPick = null;
  cleanPick = null;
  attackPick = null;
  shovePlan = null;
  pushOn = null;
  detonateNow = null;
  tacticPlan = null;
  dropAction();
  if (board) {
    board.panEnabled = true;
    board.clearHighlights();
    board.clearMovePath();
  }
}

// Targeting. An Electronic Attack is answered by the defender rather than rolled
// against, so it opens the Counter-roll handshake instead (4.11).
//
// `refund` is a Charge Token already spent to open this targeting. It rides on
// the pick so that CANCELLING gives it back: OTTO spent one for Mutilation,
// found the target out of range, cancelled, and was simply down a token for an
// attack that never happened. The spend has to land before the targeting (the
// Charge is what the Action is being performed WITH, and the panel offers it
// first), so the only honest fix is to undo it when the attack is abandoned.
function openAttackPick(t: Token, a: CardAction, refund?: { uid: number; slot: string; choice?: string }, shockAsked = false, only?: number): void {
  // A Scan opens the same Counter-roll picker: it used to open the Firing and
  // Melee one (audit Phase 3, A1).
  if (isElectronicAttack(a) || isScanAction(a)) { ewPick = { uid: t.uid, actionId: a.id, refund }; return; }
  // Shock Attack X (冲锋X): "Before performing this Action, may move X grids."
  // Asked HERE because every attack door funnels through this function - the
  // plain route and the [Charged] question's continuation both - so no door
  // can forget the offer. The grant chain runs first: all three carriers only
  // gain the keyword in Offensive Stance, so the offer appears exactly when
  // the printed condition holds. An Immobilized Mech is not offered a walk it
  // cannot take (6.3.2), and the chassis gate is the keyword's own line.
  if (!shockAsked && hudRef) {
    const opp0 = ensureScript(hudRef.state).opp;
    const opp = opp0?.uid === t.uid ? opp0 : null;
    const x = shockAttackOf(grantAdjusted(stationaryAdjusted(a, opp), t, opp));
    if (x > 0 && shockMoveAllowed(t) && !immobilizedStop(t, null)) {
      shockPick = { uid: t.uid, actionId: a.id, x, refund };
      return;
    }
  }
  attackPick = { uid: t.uid, actionId: a.id, refund, ...(only !== undefined ? { only } : {}) };
}

// Put a spent Charge Token back, face-up, and say so. Called from every path
// that abandons an attack the token was spent for.
function refundCharge(ctx: HudCtx, refund?: { uid: number; slot: string; choice?: string } | null): void {
  if (!refund) return;
  const t = ctx.state.tokens.find((x) => x.uid === refund.uid);
  if (!t) return;
  if (ctx.send({ kind: 'setCharge', seat: t.side, uid: t.uid, slot: refund.slot, on: true }).ok) {
    ctx.noteNow(`${t.label}: the attack was cancelled, so the Charge Token on ${refund.slot} goes back face-up.`, 'done');
  }
}

// Returns true when it has opened a tool that will report back — the Ticks then
// wait in `pendingAction` until that tool succeeds. False means the Action is
// already done and should be paid for now.
function routeAction(ctx: HudCtx, t: Token, a: CardAction, ga?: ReturnType<typeof guidedActions>[number]): boolean {
  // WHICH tool an Action opens is read in turn.ts (actionRoute), in the order
  // this function has always asked, so the seat seam routes it the same way.
  const route = turn.actionRoute(ctx.data, t, a);
  // First, as it is in performGuided. Remote Access is typed like card text but
  // resolves against the board — without this branch it fell through to
  // "follow the card text" and a Terminals mission could not be scored online.
  if (route === 'terminal') {
    terminalPick = { uid: t.uid, actionId: a.id, reach: a.range ?? 4 };
    return true;
  }
  // 6.1: Discard is performed by one Handheld Part, so it asks which one
  // before it pays (audit Phase 7, P7A 2).
  if (route === 'discard') {
    discardPick = { uid: t.uid };
    return true;
  }
  // Stabilize System asks before it pays. A Mech wearing no Square or Hexagon
  // Token has only the Link to take, so there is no question; one at full
  // Link with none has nothing to do at all (FAQ J8), and backing out of
  // either costs nothing.
  if (route === 'stabilise') {
    if (stabiliseAsk(ctx.data, t).picks.length) {
      stabilisePick = { uid: t.uid };
      return true;
    }
    const cmd: Command = turn.stabiliseCommand(t, null);
    const v = ctx.check(cmd);
    if (!v.ok) {
      ctx.noteNow(v.why ?? 'Stabilize System was refused.');
      dropAction();
      return true;
    }
    const paid = commitAction(ctx);
    if (paid.ok && ctx.send(cmd).ok) ctx.noteNow(`Stabilize System: Link restored to ${t.link}.`, 'done');
    else if (!paid.ok && paid.why) ctx.noteNow(paid.why);
    return true;
  }
  // The KK9's Overwatch Strike (audit Phase 5, F8).
  if (route === 'overwatch') {
    overwatchPick = { uid: t.uid, actionId: a.id };
    return true;
  }
  if (route === 'charge') {
    chargePlan = { uid: t.uid, on: true };
    return true;
  }
  const supply = route === 'resupply' ? resupplyOf(a) : null;
  if (supply) {
    resupplyPick = { uid: t.uid, actionId: a.id, rule: supply };
    return true;
  }
  // Ahead of the Delay Phase's Detonation branch below: a Link Beacon restores
  // Link and stays on the board (4.7.5), it never Detonates.
  const link = route === 'link' ? linkSupportOf(a) : null;
  if (link) {
    linkPick = { uid: t.uid, actionId: a.id, rule: link };
    return true;
  }
  // ZHDR-206_B Stance feedback: which Ally Mech, then which Stance, and the
  // Action is paid once both are answered (audit Phase 2, D1).
  if (route === 'stanceFeedback') {
    void (async () => {
      const what = a.name?.en || a.id;
      const targets = stanceFeedbackTargets(ctx.data, ctx.state.tokens, t, a, !!ctx.state.noBoard);
      const stop = (note?: string): void => { if (note) ctx.noteNow(note); dropAction(); ctx.refresh(); };
      if (!targets.length) return stop(`${what}: no Ally Mech within Range, out of Shutdown Stance, to switch (FAQ H2).`);
      const id = targets.length === 1 ? String(targets[0].uid) : await choiceDialog({
        title: `${what}: which Ally Mech?`,
        body: 'It switches Stance now, outside its own Action Opportunity.',
        choices: [...targets.map((x) => ({ id: String(x.uid), label: `${x.label} · ${x.stance}` })), { id: '__cancel', label: 'Cancel', cancel: true }],
        stacked: true,
      });
      const to = targets.find((x) => String(x.uid) === id);
      if (!to) return stop();
      const stance = await choiceDialog({
        title: `${to.label}: which Stance?`,
        body: `${to.label} is in ${to.stance} Stance.`,
        choices: [...(['defensive', 'mobility', 'offensive'] as const).filter((x) => x !== to.stance).map((x) => ({ id: x, label: `${x[0].toUpperCase()}${x.slice(1)}` })), { id: '__cancel', label: 'Cancel', cancel: true }],
      });
      if (stance !== 'defensive' && stance !== 'mobility' && stance !== 'offensive') return stop();
      const paid = commitAction(ctx);
      if (!paid.ok) return stop(paid.why);
      if (ctx.send({ kind: 'stanceFeedback', seat: t.side, uid: t.uid, actionId: a.id, targetUid: to.uid, stance }).ok) {
        ctx.noteNow(`${what}: ${to.label} switches to ${stance} Stance.`, 'done');
      }
      ctx.refresh();
    })();
    return true;
  }
  const clean = route === 'cleanup' ? tokenCleanupOf(a) : null;
  if (clean) {
    cleanPick = { uid: t.uid, actionId: a.id, rule: clean };
    return true;
  }
  const rep = route === 'repair' ? repairSpec(a) : null;
  if (rep) {
    repairPick = { uid: t.uid, actionId: a.id, repair: rep.repair, mend: rep.mend, ally: rep.ally, removeSelf: rep.removeSelf };
    return true;
  }
  // The Bit's Stance Change: pick a form, then take the Movement it grants.
  if (route === 'form') {
    formPick = { uid: t.uid, actionId: a.id };
    return true;
  }
  // "Activate Optical Camouflage, Stealth X". Mirrors performCamo in main.ts:
  // before this the only door into the state was deploying already in it, so
  // the Octopus could not vanish mid-game on either board.
  //
  // Every other routeAction branch opens a TOOL and lets that tool commit; this
  // one is immediate, so it pays the Action itself. Returning true without the
  // commitAction was the first draft's bug: the Tick was never spent and the
  // latched pendingAction rode along to whatever tool ran next.
  if (route === 'camo') {
    const stealth = stealthValue(a) ?? 0;
    if (statusCount(t.statuses, 'camouflage') > 0) {
      ctx.noteNow(`${t.label} is already in the Optical Camouflage State.`);
      dropAction();
      return true;
    }
    const paid = commitAction(ctx);
    if (paid.ok) {
      if (ctx.send({ kind: 'applyStatus', seat: t.side, uid: t.uid, targetUid: t.uid, statusId: 'camouflage' }).ok) ctx.noteNow(`${t.label}: Optical Camouflage activated${stealth ? `, Stealth ${stealth}` : ''} (4.12.2). Every Hexagon Token comes off, and the Grid it stands on is now only a SUSPECTED position - on Reveal it may Manifest up to ${stealth} Grid${stealth === 1 ? '' : 's'} away.`, 'done');
    } else if (paid.why) {
      ctx.noteNow(paid.why);
    }
    return true;
  }
  // An Electronic Attack opens the Counter-roll targeting whatever its printed
  // TYPE says — the Raven's Fire Control Interference is typed Tactic, and
  // keying on the type let it fall through to "follow the card text" (4.11).
  // A Scan opens the same Counter-roll window through its own door, for the
  // reason units.ts isScanAction spells out: it is not an Electronic Attack and
  // must not be caught by anything that modifies one.
  if (route === 'electronic') {
    openAttackPick(t, a);
    return true;
  }
  if (route === 'attack') {
    // A [Charged] Part offers to spend its token before the attack, exactly as
    // offerChargeSpend does ahead of the targeting step. Answering that question
    // either way then opens the targeting.
    if (ga?.charge?.charged) chargePlan = { uid: t.uid, on: false, actionId: a.id };
    else openAttackPick(t, a);
    return true;
  }
  // Prototype Blink is typed Moving but teleports (FAQ E20.2), so it must not
  // reach startMovePlan — there is no route to draw. Mirrors performBlink in
  // freeplay; routeAction and performGuided have to stay faithful to each other.
  if (route === 'blink') {
    // Both facings start unanswered. Seeding this one with t.facing would skip
    // the Taurus's own question and leave freeplay asking three things where
    // the Match Centre asks two.
    blinkPlan = { uid: t.uid, actionId: a.id, targetUid: null, facing: null, targetFacing: null };
    ctx.refresh();
    return true;
  }
  if (route === 'move') {
    startMovePlan(ctx, t, {
      // The Action's own Range, free of the Maneuver Tick when it is paid in
      // Ticks, flown when it carries Airborne Movement: turn.ts actionMove,
      // which a seat with no planner opens the same Movement by.
      ...turn.actionMove(a),
      label: `${a.name?.en || a.id} · Range ${a.range || maneuverRange(ctx.data, t)}${straightLineBonus(a) ? ` (+${straightLineBonus(a)} in a straight line)` : ''}`,
      shoveActionId: knockbackOf(a, ctx.data.actionTranslation(a.id)?.english ?? undefined) ? a.id : undefined,
    });
    return true;
  }
  if (route === 'launch') {
    // The Bit Port Launches OR Recovers (292_A; ruling I23). An empty Port can
    // only Recover the Bit in Range, and the Token comes back (audit Phase 5,
    // H1).
    const port = bitPortOf(a);
    if (port && (ammoAvailable(ctx.data, ctx.state, t, a.id) ?? 1) <= 0) {
      const back = bitsToRecover(ctx.data, ctx.state.tokens, t, a)[0];
      if (!back) {
        ctx.noteNow(`The Bit Port is empty, and none of your "White Dwarf" Bits is within Range ${port.range}.`);
        dropAction();
        return true;
      }
      commitAction(ctx);
      if (ctx.send({ kind: 'recoverBit', seat: t.side, uid: t.uid, actionId: a.id, targetUid: back.uid }).ok) ctx.noteNow(`${t.label} recovers ${back.label}: the Bit Port holds its Ammo Token again.`, 'done');
      return true;
    }
    const shot = ga?.projectiles ?? [];
    if (!shot.length) {
      ctx.noteNow(`${a.name?.en || a.id} is a Projectile Action, but the card data does not say what it puts on the board. Place it by hand from the squad list.`);
      // Nothing opened, so nothing may be paid for: the Ticks latched for this
      // Action would otherwise be spent by the next tool that commits.
      dropAction();
      return true;
    }
    if (shot.length === 1) startLaunchPlan(t.uid, a.id, shot[0].id, shot[0].name?.en || shot[0].id);
    else launchPick = { uid: t.uid, actionId: a.id, cardIds: shot.map((c) => c.id) };
    return true;
  }
  // A Mode change (287/288 White Dwarf): the Action turns its own Part over to
  // the other face of the same physical card. Nothing else about the unit
  // moves, so like the Unfold below it resolves here and pays here rather than
  // opening a tool that would pay later. Mirrors the freeplay branch.
  const mode = route === 'transform' ? transformOffer(ctx.data, t, a) : null;
  if (mode) {
    commitAction(ctx);
    if (ctx.send({ kind: 'transformPart', seat: t.side, uid: t.uid, slot: mode.slot, cardId: mode.into.id }).ok) ctx.noteNow(`${t.label} transforms: ${cardName(mode.from)} becomes ${cardName(mode.into)}.`, 'done');
    return true;
  }
  // Pholcus does not resolve a payload: it becomes a Drone in place (FAQ M18).
  // If the Grid it comes up in is occupied, the derived blast list has it
  // detonate on the spot (M18.4).
  if (route === 'unfold') {
    // Nothing to wait on: the Unfold happens here, so it pays here. Returning
    // true without this left the activation sitting in pendingAction until
    // some later Action dropped it, which is how the folded Pholcus could
    // Unfold and then still act - freeplay's done(true) always charged it.
    commitAction(ctx);
    if (ctx.send({ kind: 'unfold', seat: t.side, uid: t.uid }).ok) ctx.noteNow(`${t.label} Unfolds into its Drone form. It cannot act until next round - the Automatic Phase has already passed (FAQ M8).`, 'done');
    return true;
  }
  // A Projectile resolving its payload in the Delay Phase opens the same
  // Detonation resolver its card button uses (3.6.2). Freeplay counts this as
  // performed the moment the resolver opens, and so does this.
  if (route === 'detonate') {
    startDetonation(t.uid, a.id);
    return false;
  }
  // A self-applied Token (Ambush: Low Profile; Amplify Profile: Highlight).
  // Placed by the app rather than left to "follow the card text", and refused
  // when the unit already wears it (6.1, FAQ J1). Immediate, so it pays here,
  // like the camouflage branch above. Mirrors performGuided in main.ts.
  const grant = route === 'selfStatus' ? selfStatusGrant(a) : null;
  if (grant) {
    const why = selfGrantWhy(t, grant);
    if (why) {
      ctx.noteNow(why);
      dropAction();
      return true;
    }
    const paid = commitAction(ctx);
    if (paid.ok) {
      const sent = ctx.send({ kind: 'applyStatus', seat: t.side, uid: t.uid, targetUid: t.uid, statusId: grant.statusId, stacks: grant.stacks });
      const label = STATUSES.find((x) => x.id === grant.statusId)?.label ?? grant.statusId;
      ctx.noteNow(sent.ok
        ? `${t.label}: ${a.name?.en || a.id} - gains ${grant.stacks > 1 ? `${grant.stacks} ` : 'a '}${label} Token${grant.stacks > 1 ? 's' : ''}.`
        : `${t.label}: the ${label} Token was refused. ${sent.why ?? ''}`, sent.ok ? 'done' : 'refused');
    } else if (paid.why) {
      ctx.noteNow(paid.why);
    }
    return true;
  }
  // A Token the Action puts on a chosen target: Target Tag's Highlight
  // (PRDR-202_A). It was left to "follow the card text" here, so it put no
  // Token on anyone (audit Phase 3, E2). Asked before the Tick is paid; the
  // picker offers only units in Range and sight that can bear it (not a Low
  // Value Unit, not a camouflaged one for a Highlight).
  const tag = route === 'targetStatus' ? targetStatusGrant(a) : null;
  if (tag) {
    const units = targetStatusTargets(ctx.data, ctx.state.tokens, t, a, tag, { terrain: terrainOf(ctx), smoke: ctx.state.smoke ?? [] });
    if (!units.length) {
      ctx.noteNow(`${a.name?.en || a.id}: no unit in Range and line of sight can gain it.`);
      dropAction();
      return true;
    }
    void choiceDialog({
      title: a.name?.en || a.id,
      body: `One target within Range ${actionRange(ctx.data, ctx.state.tokens, t, a)}, in line of sight.`,
      choices: [
        ...units.map((x) => ({ id: String(x.uid), label: `${x.side === t.side ? 'Ally' : 'Enemy'} · ${x.label}` })),
        { id: '', label: 'Cancel', cancel: true },
      ],
      stacked: true,
    }).then((pick) => {
      if (!pick) { dropAction(); ctx.refresh(); return; }
      const paid = commitAction(ctx);
      if (!paid.ok) { if (paid.why) ctx.noteNow(paid.why); ctx.refresh(); return; }
      const who = ctx.state.tokens.find((x) => x.uid === Number(pick));
      const sent = ctx.send({ kind: 'applyStatus', seat: t.side, uid: t.uid, targetUid: Number(pick), statusId: tag.statusId, stacks: tag.stacks });
      const label = STATUSES.find((x) => x.id === tag.statusId)?.label ?? tag.statusId;
      ctx.noteNow(sent.ok ? `${t.label}: ${a.name?.en || a.id} - ${who?.label ?? 'the target'} gains a ${label} Token.` : `${label} was refused. ${sent.why ?? ''}`, sent.ok ? 'done' : 'refused');
      ctx.refresh();
    });
    return true;
  }
  // Swift and Tactical Actions are card text rather than a board procedure, so
  // the card is put in front of the player to carry out. Nothing to back out of.
  ctx.showTab('details');
  ctx.noteNow(`${a.name?.en || a.id}: follow the Action text on the card.`, 'table');
  return false;
}

function launchPickPanel(ctx: HudCtx): string {
  const m = launchPick!;
  const t = ctx.state.tokens.find((x) => x.uid === m.uid);
  const rows = m.cardIds
    .map((id) => {
      const c = ctx.data.byId.get(id);
      return c ? `<button class="rowwide" data-launchpick="${esc(id)}">${esc(cardName(c))}<span class="ct">${esc(c.category ?? '')}</span></button>` : '';
    })
    .join('');
  return head('Your move', 'What are you launching?', `${t ? esc(t.label) : 'This Action'} can put more than one thing on the board.`, true)
    + `<div class="tp-body">${rows}</div>
       <div class="tp-foot"><button class="bigbtn ghost2" data-act="launchpickcancel">Cancel</button></div>`;
}

// ---------- attacking (rulebook 4.4) ----------
//
// The card picks the Action; the panel asks which enemy, then hands the whole
// §4.4 pipeline to the shared AttackHelper — the same class the freeplay board
// runs, rendering into the Combat tab. Every state change it makes travels as a
// command, so the other seat sees the damage even though the dice tray itself
// is the attacker's screen.

// `only`: the one legal target when the rules name it - a Riposte answers the
// Mech it parried and no one else (FAQ C1).
let attackPick: { uid: number; actionId: string; refund?: { uid: number; slot: string; choice?: string }; twoHanded?: 'declined'; only?: number } | null = null;

// The [Two-Handed] question, answered the same way for the panel and the press
// (FAQ A16): the designation unless the player has declined it, and a marked
// one-handed copy when they have, so the combat window can say so.
function handsFor(ctx: HudCtx, by: Token, granted: CardAction, choice?: 'declined'): { action: CardAction; use: ReturnType<typeof twoHandedUse> } {
  return turn.handsFor(ctx.data, ctx.state, by, granted, choice);
}

export function startAttackPick(uid: number, actionId: string, only?: number): void {
  attackPick = { uid, actionId, ...(only !== undefined ? { only } : {}) };
  hudRef?.refresh();
}

// The Details card's Attack button, for a unit holding the open Opportunity.
// It used to open the target list directly, which skipped the Tick the turn
// panel's row pays and the Shock Attack question it asks - a free attack, on
// the strict page. This is the [data-doact] door, reached from the card:
// legality read now, the Ticks latched until the tool succeeds, and the
// [Charged]/Shock questions asked by routeAction. Returns false when the unit
// does not hold the Opportunity, so the caller can decide what that means.
export function startActionFromCard(uid: number, actionId: string, onlyProjectile?: string): boolean {
  const ctx = hudRef;
  if (!ctx) return false;
  const s = ctx.state;
  const sc = ensureScript(s);
  const t = s.tokens.find((x) => x.uid === uid);
  if (!t || !sc.opp || sc.opp.uid !== uid) return false;
  const act = guidedActions(ctx.data, t, { tokens: s.tokens, terrain: terrainOf(ctx) })
    .find((g) => g.action.id === actionId);
  if (!act) return false;
  if (t.kind !== 'mech' || lengthOf(act.action)) {
    // [Two-Handed] is taken unless the picker's switch declines it, and it can
    // change the length paid (card 129), so the check asks about that length.
    const cmd: Command = { kind: 'performAction', seat: t.side, uid: t.uid, actionId, partKey: act.partKey, ...(twoHandedUse(ctx.data, t, act.action, boxHands(ctx.state.tasks, t.uid), loanedParts(ctx.data, ctx.state.tokens, t)) ? { twoHanded: true } : {}) };
    const v = ctx.check(cmd);
    if (!v.ok) {
      if (v.why) ctx.noteNow(v.why);
      ctx.refresh();
      return true;
    }
    pendingAction = cmd;
  }
  const grant = extraActivationOf(act.action);
  if (grant) grantPick = { from: t.uid, grant };
  // A Launch from the card has already named its Projectile (A7).
  const routed = onlyProjectile ? { ...act, projectiles: act.projectiles.filter((c) => c.id === onlyProjectile) } : act;
  if (!routeAction(ctx, t, act.action, routed)) {
    const paid = commitAction(ctx);
    if (!paid.ok && paid.why) ctx.noteNow(paid.why);
  }
  ctx.refresh();
  return true;
}

function attackPanel(ctx: HudCtx): string {
  const m = attackPick!;
  // The reading of every line is turn.ts attackReading: who may be named, what
  // each shot is worth and why a row is refused. The seat seam reads the same
  // one, so a target offered here is a target every reader is offered.
  const read = turn.attackReading(ctx.data, ctx.state, m);
  if (!read) return head('Attack', 'That unit is gone', '', true)
    + '<div class="tp-body"></div><div class="tp-foot"><button class="bigbtn ghost2" data-act="attackcancel">Close</button></div>';
  const { by, raw, action: a, hands, forced } = read;
  const stationary = a !== raw;
  const rows = read.rows
    .map(({ t, note, hidden, lit, blocked, bad, prot, shield, ap }) => {
      // One reading per line. Range, arc and line of sight are three separate
      // judgements and running them together on one line made the list unusable.
      // A zero carries its reason when there is one — the line above says
      // "obstructed" for a medium unit in the way, and 4.5.3 pays nothing for
      // it, so the row would otherwise look like the dice went missing. Not
      // repeated when the row is already ✕, where the note only echoes it.
      const bits = (lit ? [`✕ ${forced.map((x) => x.label).join(' or ')} has Highlight, and this Firing Action must target it (6.2.1)`] : [])
        .concat(hidden ? ['⚠ in Optical Camouflage: one free Scan first; the attack follows if it is Revealed (4.12.2, FAQ I12)'] : [], note.split(' · '),
        prot.white ? [`+${prot.white} White ${prot.white === 1 ? 'die' : 'dice'} of Protection`]
          : prot.note && !blocked ? [prot.note] : [],
        ap.total ? [`Armor Piercing ${ap.total}: −${ap.total} White off their roll${ap.granted ? ' (Spike adds 1)' : ''}`] : [],
        shield ? [`⤳ Automatic Shield: ${shield.shield.label} takes this shot (FAQ A12)`] : []);
      // A blocked row is greyed and its ✕ reason goes to the notice line too;
      // the row still prints it (audit Phase 7, P7D 9).
      const why = blocked ? bits.filter((b) => b.includes('✕')).map((b) => b.replace(/^✕\s*/, '')).join('; ') : '';
      return `<button class="rowwide targrow${bad ? ' warn' : ''}"${blocked ? ` aria-disabled="true" data-why="${esc(`${why || 'This target cannot be attacked'}.`)}"` : ''} data-attacktarget="${t.uid}">
        <span class="tgname">${esc(t.label)}</span>
        <span class="tgbits">${bits.map((b) => `<span${/[⚠✕]/.test(b) ? ' class="bad"' : ''}>${esc(b)}</span>`).join('')}</span></button>`;
    })
    .join('');
  // FAQ O9: with no enemy inside an Auto Action's range, the nearest Breakable
  // Terrain becomes a legal target — optional, and only the nearest. Named here
  // rather than made clickable because destroying terrain already has its own
  // path (click the piece on the board), and this is the half a player cannot
  // work out for themselves: that the option exists at all.
  const neutral = read.neutral;
  const neutralNote = neutral.length
    ? `<p class="tp-note">No enemy Unit is inside Range ${a.range ?? 0}, so ${esc(by.label)} MAY attack Breakable Terrain instead, and only the nearest, which is
       ${neutral.map((n) => esc(terrainLabel(ctx, n.id))).join(' or ')} (FAQ O9).<br>Click the piece on the board to destroy it. Buildings and Defense walls are never valid targets (O10).</p>`
    : '';
  // A Container named as the target (Supplementary Rules 1.04, 1.1.3, 3.1):
  // which ones is turn.ts's reading too.
  const boxRows = read.boxes.map((b) => `<button class="rowwide targrow" data-attackbox="${esc(b.id)}">
      <span class="tgname">${esc(terrainLabel(ctx, b.id))}</span>
      <span class="tgbits"><span>a Container: Breakable, destroyed with no roll (Supplementary Rules 1.04, 3.1)</span><span>${b.dist} Grid${b.dist === 1 ? '' : 's'} away</span></span></button>`).join('');
  // [Two-Handed] (FAQ A16): what the spare hand buys, and the switch to decline it.
  const handsRow = hands.use
    ? `<button class="rowwide" data-act="twohanded">${m.twoHanded === 'declined'
        ? `[Two-Handed] declined: one-handed, none of the rider (FAQ A16). Press to use ${esc(hands.use.label)}.`
        : `${esc(hands.use.note)}. Press to perform it one-handed instead (FAQ A16).`}</button>`
    : '';
  return head('Your move', `${esc(a.name?.en || m.actionId)}: which target?`,
    `${esc(by.label)} · ${a.yellowDice ?? 0}Y ${a.redDice ?? 0}R.${stationary ? ` Stationary applies: Range ${a.range ?? 0}${(a.yellowDice ?? 0) !== (raw?.yellowDice ?? 0) ? `, ${a.yellowDice}Y` : ''}, so no Movement this Opportunity.` : ''}`, true)
    + `<div class="tp-body">${handsRow}${rows || (boxRows ? '' : '<p class="tp-note">No enemy unit is on the board.</p>')}${boxRows}${neutralNote}</div>
       <div class="tp-foot"><button class="bigbtn ghost2" data-act="attackcancel">Cancel</button></div>`;
}

// ---------- Prototype Blink (FAQ E17/E20) ----------
//
// Three questions in one panel, in order: which Mech to swap with, then the
// facing of each, because it counts as Forced Movement and the Taurus player
// sets both (E17/E20.5). Nothing is sent until all three are answered, so the
// swap crosses the wire as ONE command and a mirrored seat can never see half
// of it.
// Both facings start null and the panel asks for whichever is still unanswered,
// so the order is data rather than a flag to keep in step.
let blinkPlan: {
  uid: number; actionId: string;
  targetUid: number | null;
  facing: Facing | null; targetFacing: Facing | null;
} | null = null;

const COMPASS: { id: Facing; label: string }[] = [
  { id: 0, label: 'North' }, { id: 1, label: 'East' }, { id: 2, label: 'South' }, { id: 3, label: 'West' },
];

function blinkPanel(ctx: HudCtx): string {
  const m = blinkPlan!;
  const t = ctx.state.tokens.find((x) => x.uid === m.uid);
  const a = t ? actionOn(ctx, t, m.actionId) : undefined;
  if (!t || !a) {
    return head('Prototype Blink', 'That unit is gone', '', true)
      + '<div class="tp-body"></div><div class="tp-foot"><button class="bigbtn ghost2" data-act="blinkcancel">Close</button></div>';
  }
  const targets = blinkTargets(ctx.data, ctx.state.tokens, t, a);
  if (!targets.length) {
    return head('Prototype Blink', 'Nothing to exchange with',
      `It takes a GROUND MECH the same size as ${esc(t.label)} within Range ${a.range ?? 0}, on either side. Drones, Terrain and anything a different size cannot be chosen (FAQ E20).`, true)
      + '<div class="tp-body"></div><div class="tp-foot"><button class="bigbtn" data-act="blinkcancel">Close</button></div>';
  }
  if (m.targetUid === null) {
    const rows = targets.map((o) => `<button class="rowwide" data-blinktarget="${o.uid}">${esc(o.label)}${
      o.side === t.side ? ' <span class="ct">ally</span>' : ' <span class="ct">enemy</span>'
    }</button>`).join('');
    return head('Your move', 'Prototype Blink: exchange with which Mech?',
      'Teleportation, so terrain and whatever lies between do not matter (FAQ E20).', true)
      + `<div class="tp-body">${rows}<p class="tp-dim">A Ground Mech of the same size within range, enemy or allied.</p></div>
         <div class="tp-foot"><button class="bigbtn ghost2" data-act="blinkcancel">Cancel</button></div>`;
  }
  const other = ctx.state.tokens.find((x) => x.uid === m.targetUid);
  const naming = m.facing === null ? t : other;
  // The same five choices freeplay offers, including leaving it alone — a
  // facing the player is happy with should not have to be re-picked off a
  // compass.
  const rows = COMPASS.map((f) => `<button class="rowwide" data-blinkface="${f.id}">${esc(f.label)}${
    naming?.facing === f.id ? ' <span class="ct">as it was</span>' : ''
  }</button>`).join('');
  return head('Your move', `Which way does ${esc(naming?.label ?? 'it')} face?`,
    'Prototype Blink is Forced Movement, so you set the facing of BOTH units (FAQ E17).', true)
    + `<div class="tp-body">${rows}<p class="tp-dim">${
        m.facing === null ? 'Then you will set the other one.' : 'Last question. The swap goes through after this.'
      }</p></div>
       <div class="tp-foot"><button class="bigbtn ghost2" data-act="blinkcancel">Cancel</button></div>`;
}

function blinkFace(ctx: HudCtx, f: Facing): void {
  const m = blinkPlan;
  if (!m || m.targetUid === null) return;
  // Whichever facing is still unanswered is the one being answered.
  if (m.facing === null) { m.facing = f; ctx.refresh(); return; }
  m.targetFacing = f;
  const t = ctx.state.tokens.find((x) => x.uid === m.uid);
  const other = ctx.state.tokens.find((x) => x.uid === m.targetUid);
  if (!t || !other) {
    blinkPlan = null;
    ctx.refresh();
    return;
  }
  const cmd = {
    kind: 'blink' as const, seat: t.side, uid: t.uid, actionId: m.actionId,
    targetUid: other.uid, facing: m.facing, targetFacing: f,
  };
  // Legality first, THEN the Ticks: paying before a refused swap would eat the
  // Opportunity for nothing. Once it checks, the Action pays for itself before
  // its own command like every other tool — without this the Taurus teleported
  // for free in the Match Centre while freeplay charged an Action Tick for it.
  const v = ctx.check(cmd);
  if (!v.ok) {
    if (v.why) ctx.noteNow(v.why);
  } else {
    commitAction(ctx);
    // One command carries the swap and both facings, so the two boards agree
    // in a single step rather than converging over three.
    if (ctx.send(cmd).ok) ctx.noteNow(`${t.label} exchanges positions with ${other.label} (Prototype Blink).`, 'done');
  }
  blinkPlan = null;
  ctx.refresh();
}

// A Breakable Terrain piece named the way a player sees it on the board: what
// it is, and which Grid to look in.
function terrainLabel(ctx: HudCtx, id: string): string {
  const p = terrainOf(ctx).find((x) => x.id === id);
  if (!p) return id;
  const c = p.subCells[0];
  const kind = p.type === 'container' ? 'Container' : p.type.replace(/_/g, ' ');
  return c ? `the ${kind} in ${gridName(Math.floor(c.col / 3), Math.floor(c.row / 3))}` : `the ${kind}`;
}

// ---------- Forced Movement: Knockback, Push and the shove (appendix) ----------
//
// The victim is Force-Moved in a straight line away from the attacker and stops
// the moment a Unit, Terrain or the board edge blocks it, so there is nothing
// for the player to choose about where it lands — the panel exists to show the
// working before it happens. A shove is the same thing with no Attack behind
// it: the card wants an enemy Ground Unit in the Grid the Mech is facing.

// `dir` is a Push's chosen direction (0 north, 1 east, 2 south, 3 west): Push
// X goes "in any (straight) direction" (GoF 1.021; ruled 2026-09-25, audit
// Phase 4, I9). Unset, and for Knockback always, it is the attack direction.
// `resume`: the rest of a line a Mine stopped (C1b), same direction, the
// Grids it had left; Push's Link was paid on the first leg.
let shovePlan: { uid: number; actionId: string; targetUid: number | null; facing?: Facing; dir?: number; resume?: { dir: { dc: number; dr: number }; grids: number } } | null = null;
const PUSH_DIRS = turn.PUSH_DIRS;
// A Knockback or Push a Mine stopped (C1b; ruling I16): the forcing seat holds
// the rest of the line and opens it once no Mine is owed on the unit, whichever
// seat resolved the blast.
let pushOn: { uid: number; actionId: string; targetUid: number; dir: { dc: number; dr: number }; grids: number } | null = null;

function pushOnReady(ctx: HudCtx): void {
  const p = pushOn;
  if (!p || shovePlan) return;
  const victim = ctx.state.tokens.find((x) => x.uid === p.targetUid);
  if (!victim || !alive(victim)) { pushOn = null; return; }
  if (minesOwed(ctx.data, ctx.state.tokens).some((x) => x.victims.includes(victim.uid))) return;
  pushOn = null;
  shovePlan = { uid: p.uid, actionId: p.actionId, targetUid: p.targetUid, resume: { dir: p.dir, grids: p.grids } };
}

export function startShove(uid: number, actionId: string, targetUid?: number): void {
  shovePlan = { uid, actionId, targetUid: targetUid ?? null };
  hudRef?.refresh();
}

// The Grid in front, and the enemy Ground Units in it ("an Enemy GROUND
// Unit": a Flying Raven is not one, audit Phase 4, B4): turn.ts, the reading a
// computer seat's shove makes too (M8.2u).
function gridAhead(t: Token): { c: number; r: number } {
  return turn.gridAhead(t);
}

function shoveVictims(ctx: HudCtx, t: Token): Token[] {
  return turn.shoveVictims(ctx.data, ctx.state, t);
}

function gridName(c: number, r: number): string {
  return `${String.fromCharCode(65 + c)}${r + 1}`;
}

// What the Forced Movement would do, or why it does nothing.
// It is turn.ts forcedMove, the one reading a computer seat makes too (M8.2t).
// The line ends early in an Abyss (the victim falls, resolveShove below
// resolves the death) or on a Fragile Platform (the settle sweep removes the
// Card once the victim stands on it).
function shoveOutcome(ctx: HudCtx, by: Token, victim: Token, a: CardAction, pushDir?: number, resume?: { dir: { dc: number; dr: number }; grids: number }) {
  return turn.forcedMove(ctx.data, ctx.state, by, victim, a, pushDir, resume);
}

function shovePanel(ctx: HudCtx): string {
  const s = ctx.state;
  const m = shovePlan!;
  const by = s.tokens.find((x) => x.uid === m.uid);
  const a = by ? actionOn(ctx, by, m.actionId) : undefined;
  if (!by || !a) return head('Forced Movement', 'That unit is gone', '', true)
    + '<div class="tp-body"></div><div class="tp-foot"><button class="bigbtn ghost2" data-act="shovecancel">Close</button></div>';
  const name = a.name?.en || m.actionId;
  const kb = knockbackOf(a);
  const label = kb ? (kb.push ? `Push ${kb.grids}` : `Knockback ${kb.grids}`) : 'Forced Movement';
  if (m.targetUid === null) {
    const ahead = gridAhead(by);
    // A Mech on the edge facing outward has no Grid in front at all, and
    // naming one that is not on the board reads as a bug.
    const offBoard = ahead.c < 0 || ahead.r < 0 || ahead.c >= boardGrids() || ahead.r >= boardGrids();
    const where = offBoard ? 'off the board' : gridName(ahead.c, ahead.r);
    const victims = offBoard ? [] : shoveVictims(ctx, by);
    const rows = victims
      .map((v) => `<button class="rowwide" data-shovepick="${v.uid}">${esc(v.label)}<span class="ct">${v.kind}</span></button>`)
      .join('');
    return head('Your move', `${esc(name)}: shove which unit?`, offBoard ? `${esc(by.label)} faces off the board.` : `The Grid in front is ${where}.`, true)
      + `<div class="tp-body">${rows || `<p class="tp-note">${offBoard
        ? `${esc(by.label)} is on the edge facing outward, so there is no Grid in front to shove anything out of.`
        : `No enemy Ground Unit in ${where}, the Grid in front, so there is nothing to shove.`}</p>`}</div>
         <div class="tp-foot"><button class="bigbtn ghost2" data-act="shovecancel">Cancel</button></div>`;
  }
  const victim = s.tokens.find((x) => x.uid === m.targetUid);
  if (!victim) return head('Forced Movement', 'That target is gone', '', true)
    + '<div class="tp-body"></div><div class="tp-foot"><button class="bigbtn ghost2" data-act="shovecancel">Close</button></div>';
  const out = shoveOutcome(ctx, by, victim, a, m.dir, m.resume);
  if (!out) return head('Forced Movement', `${esc(name)} carries none`, '', true)
    + '<div class="tp-body"></div><div class="tp-foot"><button class="bigbtn ghost2" data-act="shovecancel">Close</button></div>';
  const blocked = !out.path.length;
  // Push picks its own straight line; each button says how far that way goes.
  const dirRow = out.kb.push && !m.resume
    ? `<div class="dialrow"><span class="nm">Direction</span><div class="btnrow">${(['N', 'E', 'S', 'W'] as const)
      .map((lbl, i) => {
        const n = (shoveOutcome(ctx, by, victim, a, i)?.path.length) ?? 0;
        const on = (m.dir ?? PUSH_DIRS.findIndex((d) => d.dc === attackDirection(by, victim).dc && d.dr === attackDirection(by, victim).dr)) === i;
        return `<button class="rowbtn${on ? ' on' : ''}" data-shovedir="${i}">${lbl} ${n ? n : 'blocked'}</button>`;
      }).join('')}</div></div>
       <p class="tp-dim">Push goes in a straight line in any direction you choose; the number is how many Grids it gets that way.</p>`
    : '';
  return head('Your move', `${label} on ${esc(victim.label)}`, `${esc(name)} from ${esc(by.label)}.`, true)
    + `<div class="tp-body">
        ${dirRow}
        <p class="tp-note">${blocked
          ? `${esc(victim.label)} would be forced ${out.heading}, but a Unit, Terrain or the board edge is in the way, so it does not move. Forced Movement stops the moment it is blocked.`
          : `${esc(victim.label)} is forced ${out.path.length} Grid${out.path.length === 1 ? '' : 's'} ${out.heading} to ${gridName(out.end.c, out.end.r)}${out.rest > 0
            ? `, where a Mine stops it: the Mine goes off, then the other ${out.rest} Grid${out.rest === 1 ? '' : 's'} of the line follow if it is still standing (M19)`
            : out.short ? `, short of the full ${out.kb.grids} because something blocks the rest of the line` : ''}.`}</p>
        ${m.resume ? '<p class="tp-dim">The rest of the line a Mine stopped.</p>' : ''}
        ${out.kb.push && victim.kind === 'mech' && !m.resume ? '<p class="tp-dim">Push also costs it 1 Link, and a Mech on 0 Link Shuts Down.</p>' : ''}
        ${out.kb.onHit ? '<p class="tp-dim">This one only triggers On Hit, so skip it if the attack scored none.</p>' : ''}
      ${(() => {
        // The forcing player picks the victim's facing (3.4.4), and a victim
        // that cannot move may still be turned — optionally (FAQ B4/B5).
        const opts = (['N', 'E', 'S', 'W'] as const)
          .map((lbl, i) => `<button class="rowbtn${m.facing === i ? ' on' : ''}" data-shoveface="${i}">${lbl}${victim.facing === i ? ' ·' : ''}</button>`)
          .join('');
        return `<div class="dialrow"><span class="nm">Facing</span><div class="btnrow">${opts}<button class="rowbtn${m.facing === undefined ? ' on' : ''}" data-shoveface="">leave</button></div></div>
          <p class="tp-dim">You choose which way ${esc(victim.label)} ends up facing (3.4.4).${blocked ? ' It cannot move, but it may still be turned.' : ''}</p>`;
      })()}
      </div>
      <div class="tp-foot">${blocked
        ? (m.facing !== undefined ? '<button class="bigbtn" data-act="shoveturn">Turn it in place</button>' : '')
        : '<button class="bigbtn" data-act="shovego">Force the move</button>'}
        <button class="bigbtn ghost2" data-act="shovecancel" style="margin-top:6px">${blocked ? 'Close' : 'Skip'}</button></div>`;
}

function resolveShove(ctx: HudCtx): void {
  const m = shovePlan;
  const s = ctx.state;
  const by = m ? s.tokens.find((x) => x.uid === m.uid) : undefined;
  const victim = m?.targetUid !== null && m ? s.tokens.find((x) => x.uid === m.targetUid) : undefined;
  const a = by && m ? actionOn(ctx, by, m.actionId) : undefined;
  // The commands are turn.ts forcedCommands', the ones a computer seat sends.
  const made = by && victim && a ? turn.forcedCommands(ctx.data, s, by, victim, a, { dir: m?.dir, facing: m?.facing, resume: m?.resume }) : null;
  const out = made?.out ?? null;
  shovePlan = null;
  if (!made || !out || !out.path.length || !by || !victim) { flushBoxDrops(); ctx.refresh(); return; }
  const wasShut = victim.stance === 'shutdown';
  const fatal = made.fatal;
  const forced = ctx.send(made.commands[0]).ok;
  if (out.rest > 0 && !fatal && m) pushOn = { uid: by.uid, actionId: m.actionId, targetUid: victim.uid, dir: out.dir, grids: out.rest };
  const shut = out.kb.push && !out.resumed && victim.kind === 'mech' && !wasShut && victim.stance === 'shutdown';
  // The Abyss: a Ground Unit forced in is immediately Destroyed, and the kill
  // is the forcing player's - which is this seat, so it is resolved here with
  // no panel. A carried Black Box is left where the bearer fell, because the
  // falling is nobody's placement choice.
  if (fatal) {
    // The recordKill leaves a Box no Penetration owes in the Abyss Grid
    // (ruling I20); one a Penetration owes is still the attacker's drop.
    const fell = ctx.send(made.commands[1]).ok;
    if (forced && fell) ctx.noteNow(`${victim.label} is forced ${out.path.length} Grid${out.path.length === 1 ? '' : 's'} ${out.heading} into the Abyss Grid ${gridName(out.end.c, out.end.r)} and is immediately Destroyed.`, 'done');
    flushBoxDrops();
    ctx.refresh();
    return;
  }
  if (forced) ctx.noteNow(`${victim.label} is forced ${out.path.length} Grid${out.path.length === 1 ? '' : 's'} ${out.heading} to ${gridName(out.end.c, out.end.r)}.${
    out.kb.push && !out.resumed && victim.kind === 'mech' ? ` Push costs 1 Link (now ${victim.link}).` : ''}${shut ? ' Link has reached 0, so it shuts down.' : ''}${
    out.rest > 0 ? ` A Mine stops it there: its blast first, then ${out.rest} Grid${out.rest === 1 ? '' : 's'} of the line ${out.rest === 1 ? 'is' : 'are'} left (M19).` : ''}`, 'done');
  // The Forced Movement has settled, so a Penetrated bearer's Box question can
  // finally be asked at the position it ended up in (FAQ E19).
  flushBoxDrops();
  ctx.refresh();
}

// ---------- Detonation (rulebook 4.7.5 / 4.7.6) ----------
//
// A Projectile resolves its Delayed Action and is then Destroyed, whatever it
// achieved. Three shapes, the same three freeplay has: a smoke card places
// screens, a card with no dice applies an effect to everything it caught, and a
// card with a pool makes an Explosion attack. Explosion damage ignores line of
// sight and facing and the defender claims no Terrain or Unit Protection.

// `hit`: the units an "all Units" blast has already resolved (A1, below).
// `flew`: the target a Missile has already flown to (A2).
// `terrainHit`: it has already taken a Container, so it is spent.
let detonateNow: { uid: number; actionId: string; hit?: number[]; scanned?: number[]; flew?: number; terrainHit?: boolean } | null = null;
// Which token the effect-only detonation is about to hand out.
// Never "In smoke", which a board reads off its screens (audit Phase 4, G12).
let detonateStatus = 'fci';

export function startDetonation(uid: number, actionId: string): void {
  const ctx = hudRef;
  if (!ctx) return;
  const proj = ctx.state.tokens.find((x) => x.uid === uid);
  const a = proj ? actionOn(ctx, proj, actionId) : undefined;
  if (!proj || !a) return;
  // A Link Beacon's Delayed Action restores Link and the Beacon stays (4.7.5).
  if (linkSupportOf(a)) {
    startSupportPick(uid, actionId);
    return;
  }
  // A smoke card never targets anything: it puts screens down from where the
  // Projectile is standing and then the Projectile is spent.
  const smoke = smokePlacement(a);
  if (smoke) {
    startSmokePlan({
      side: proj.side,
      count: smoke.count,
      connected: smoke.connected,
      origin: { c: Math.floor(proj.col / 3), r: Math.floor(proj.row / 3) },
      label: `${a.name?.en || actionId} · ${proj.label}`,
      thenDespawn: proj.uid,
    });
    return;
  }
  detonateNow = { uid, actionId, hit: [] };
  detonateStatus = 'fci';
  ctx.refresh();
}

// A resolved Explosion strikes its unit off an "all Units" blast's list, and
// the Projectile stays until Done: every unit it caught takes its own attack
// (4.7.6, M21). match.ts calls this where it used to despawn the Projectile
// after the first attack, which left the panel with nothing to reach the
// second unit by (audit Phase 5, A1).
export function detonationHit(projUid: number, targetUid: number): boolean {
  if (!detonateNow || detonateNow.uid !== projUid) return false;
  const hit = detonateNow.hit ?? (detonateNow.hit = []);
  if (!hit.includes(targetUid)) hit.push(targetUid);
  return true;
}

// "Detonate Detonation" is what naming the Action naively produces, since half
// these cards call the Action exactly that.
function detonateHeading(actionName: string, projLabel: string): string {
  if (/^detonat\w*$/i.test(actionName.trim())) return `Detonate ${projLabel}`;
  return /detonat/i.test(actionName) ? actionName : `Detonate ${actionName}`;
}

// What the card actually says, in English where there is any. The printed EN
// field is often empty and the zh text is what the data carries, so the curated
// translation is the middle step — the same order freeplay reads them in.
function detonationText(ctx: HudCtx, a: CardAction): string {
  const en = a.description?.en?.trim();
  if (en && !/[぀-ヿ一-鿿]/.test(en)) return en;
  const tr = ctx.data.actionTranslation(a.id)?.english;
  return tr?.trim() || a.description?.zh?.trim() || 'See the card for what this detonation does.';
}

// Who and what a blast reaches are read in turn.ts, where a seat with no
// panel reads them too.
function unitsWithin(ctx: HudCtx, from: Token, range: number): { t: Token; dist: number }[] {
  return turn.unitsWithin(ctx.state, from, range);
}

function fragileTerrainWithin(ctx: HudCtx, from: Token, range: number) {
  return turn.fragileTerrainWithin(ctx.data, ctx.state, from, range);
}

function detonatePanel(ctx: HudCtx): string {
  const s = ctx.state;
  // WHAT the blast may take is read in turn.ts (detonationReading): the units
  // and Containers in Range, whether it is an Explosion or an effect, whether
  // it takes one unit or all, the card's own bar on each (4.7.5), and whether
  // it stays with nothing to take. A seat with no panel reads the same list.
  const read = turn.detonationReading(ctx.data, s, detonateNow!.uid, detonateNow!.actionId, detonateNow!);
  if (!read) return head('Detonation', 'That Projectile is gone', '', true)
    + '<div class="tp-body"></div><div class="tp-foot"><button class="bigbtn" data-act="detdone">Close</button></div>';
  const { proj, a, range, targets, terrain, damaging, scope, barOf, legal, stays } = read;
  const name = a?.name?.en || detonateNow!.actionId;
  // An effect detonation that prints "line of sight" reaches only the units
  // the Projectile can see - the gate freeplay already applies. Damage is not
  // gated: Explosion damage ignores line of sight (4.7.6).
  const needsSight = !damaging && !!a && /line of sight|视线/i.test(detonationText(ctx, a));
  const inSight = needsSight
    ? targets.filter(({ t }) => losBetween(proj, t, terrainOf(ctx), s.tokens) !== 'blocked')
    : targets;
  const struck = scope === 'all' ? detonateNow!.hit ?? [] : [];
  const reactions = ensureScript(s).reactions ?? [];
  const rows = targets
    .map(({ t, dist }) => {
      const done = struck.includes(t.uid);
      const bar = barOf(t);
      // p.71 (A3): a camouflaged target is Scanned first, the Projectile the
      // Initiator, or cannot be picked at all; a Scanned one waits until it
      // has appeared, and a failed Scan leaves the Projectile only Done.
      const camo = a ? explosionCamo(ctx.data, proj, a, t) : null;
      const state = camo && (detonateNow!.scanned ?? []).includes(t.uid) ? blastScanState(reactions, proj, t) : null;
      const barred = !!camo && ('why' in camo || !!state);
      const tip = camo && 'why' in camo ? camo.why : state === 'appearing' ? `${t.label} has not appeared yet: its Reveal comes first.` : state === 'failed' ? 'The Scan failed: the Explosion finds nothing, and the Projectile is Destroyed (p.71).' : '';
      const tag = done ? 'resolved' : bar || (state === 'appearing' ? 'appearing' : state === 'failed' ? 'Scan failed' : barred ? 'hidden' : camo ? 'Scan first' : `R${dist}`);
      // Greyed with the reason for the notice line, no title (audit Phase 7, P7D 9).
      const why = done ? `${t.label} has already taken this Explosion.` : bar ? `${t.label} is not this Detonation's target: ${bar}.` : barred ? tip || `${t.label} cannot be picked now.` : '';
      return `<button class="rowwide" ${camo && !barred ? 'data-detscan' : 'data-dettarget'}="${t.uid}"${why ? ` aria-disabled="true" data-why="${esc(why)}"` : ''}><span class="${t.side}">${t.side === proj.side ? 'ALLY' : 'ENEMY'}</span> ${esc(t.label)}<span class="ct">${tag}</span></button>`;
    })
    .join('');
  const terrainRows = terrain
    .map(({ piece, dist }) => `<button class="rowwide" data-detterrain="${esc(piece.id)}">TERRAIN ${esc(piece.type.replace('_', ' '))}<span class="ct">R${dist}</span></button>`)
    .join('');
  const body = damaging
    ? `<p class="tp-note">Explosion damage ignores line of sight and facing, and the defender gets no Terrain or Unit Protection. Only the defender may spend Link to Focus.</p>
       <p class="tp-dim">${legal.length
         ? scope === 'all'
           ? 'This card says all Units within range, so it hits allies too and every one takes a separate attack. Resolve them one at a time (4.7.6).'
           : 'This card damages a single target, so only one of these takes the attack (4.7.5).'
         : terrain.length
           ? stays
             ? 'No unit within range but a Container, a Neutral Unit it may take or leave (Supplementary Rules 1.04, 1.4.2). Left alone, this card is not removed: it stays for a later Delay Phase (GoF 1.021).'
             : 'No unit within range but a Container, a Neutral Unit this Projectile may still hit (Supplementary Rules 1.04, 1.4.2).'
           : stays
             ? 'No target and no Destructible Terrain within range. This card is not removed then: it stays for a later Delay Phase (GoF 1.021).'
             : 'No target and no Destructible Terrain within range. A Projectile whose Delayed Action needs a target is destroyed instead (4.7.5).'}</p>
       ${rows}
       ${terrainRows ? `<div class="sect2" style="margin-top:10px">${scope === 'all' ? 'The Containers it caught' : 'Or hit a Container'}</div><p class="tp-dim">${scope === 'all'
         ? 'A Container is a Neutral Unit, and this card says all Units within range, so each one here is caught too (Supplementary Rules 1.04, 1.4.2). Breakable: destroyed with no roll (3.1), and Destroy the Projectile takes any left.'
         : 'A Container is a Neutral Unit and Breakable: an attack that picks it destroys it with no roll (Supplementary Rules 1.04, 1.1.3, 3.1).'}</p>${terrainRows}` : ''}
       `
    : `<p class="tp-note">${esc(a ? detonationText(ctx, a) : 'See the card for what this detonation does.')}</p>
       <p class="tp-dim">This detonation causes an effect rather than damage, so there is no attack roll. Pick the token it applies, then the units inside the blast. The card text is what actually happens; the token is a reminder on the board.</p>
       <div class="stancerow">${STATUSES.filter((d) => d.id !== 'smoke' && d.handPlaced !== false && (!d.appliesTo || targets.some(({ t }) => d.appliesTo!.includes(t.kind))))
         .map((d) => `<button class="stancebtn${detonateStatus === d.id ? ' sel' : ''}" data-detstatus="${esc(d.id)}" title="${esc(d.note)}">${d.icon} ${esc(d.label)}</button>`)
         .join('')}</div>
       ${inSight.length
         ? `${inSight.map(({ t, dist }) => {
             const on = (t.statuses ?? []).includes(detonateStatus);
             return `<button class="rowwide${on ? ' sel' : ''}" data-deteffect="${t.uid}"><span class="${t.side}">${t.side === proj.side ? 'ALLY' : 'ENEMY'}</span> ${esc(t.label)}<span class="ct">R${dist}${on ? ' ✓' : ''}</span></button>`;
           }).join('')}`
         : '<p class="tp-dim">No units inside the blast.</p>'}`;
  return head('Your move', esc(detonateHeading(name, proj.label)), `${esc(proj.label)} · ${range === 0 ? 'this Grid' : `Range ${range}`}.`, true)
    + `<div class="tp-body">${body}</div>
       <div class="tp-foot">${stays
         ? '<button class="bigbtn" data-act="detkeep">Keep the Projectile</button>'
         : '<button class="bigbtn" data-act="detdone">Destroy the Projectile</button>'}
         <button class="bigbtn ghost2" data-act="detcancel" style="margin-top:6px">Cancel</button></div>`;
}

// ---------- Smoke Screens (rulebook 4.16) ----------
//
// A screen sits in one Large Grid, shares it freely with units and terrain, and
// cuts line of sight through it. Placement comes off a card that says how many
// and whether they must be Connected; freeplay reaches it by detonating a smoke
// grenade, and so does this.

let smokePlan: {
  side: Side;
  left: number;
  connected: boolean;
  placed: { col: number; row: number }[];
  origin: { c: number; r: number } | null;
  // A reaction places its Screens "within range" of the reacting unit rather
  // than on a landing point, so this is a reach from a Grid rather than a fixed
  // first cell. Freeplay's picker has always had it; this one had not.
  range: { c: number; r: number; max: number } | null;
  label: string;
  // Detonating spends the Projectile once the screens are down (4.7.5).
  thenDespawn: number | null;
  // Fires when the plan closes, placed or cancelled — a queued reaction behind
  // this one needs to know the panel is free again.
  onDone: (() => void) | null;
} | null = null;

export function startSmokePlan(o: {
  side: Side;
  count: number;
  connected: boolean;
  origin?: { c: number; r: number };
  range?: { c: number; r: number; max: number };
  label: string;
  thenDespawn?: number;
  onDone?: () => void;
}): void {
  smokePlan = {
    side: o.side,
    left: o.count,
    connected: o.connected,
    placed: [],
    origin: o.origin ?? null,
    range: o.range ?? null,
    label: o.label,
    thenDespawn: o.thenDespawn ?? null,
    onDone: o.onDone ?? null,
  };
  hudRef?.refresh();
}

// Mirrors smokeCandidates in main.ts.
function smokeCandidates(ctx: HudCtx): { c: number; r: number; ok: boolean }[] {
  const m = smokePlan;
  if (!m) return [];
  const mine = (ctx.state.smoke ?? []).filter((s) => s.side === m.side);
  const out: { c: number; r: number; ok: boolean }[] = [];
  for (let c = 0; c < boardGrids(); c++) {
    for (let r = 0; r < boardGrids(); r++) {
      if (m.range && Math.abs(c - m.range.c) + Math.abs(r - m.range.r) > m.range.max) continue;
      // The same player may not stack two screens in one Grid; the enemy may.
      if (mine.some((s) => s.col === c && s.row === r)) continue;
      if (!m.placed.length) {
        if (m.origin && (c !== m.origin.c || r !== m.origin.r)) continue;
        out.push({ c, r, ok: true });
        continue;
      }
      if (m.connected && !m.placed.some((s) => Math.abs(s.col - c) + Math.abs(s.row - r) === 1)) continue;
      out.push({ c, r, ok: true });
    }
  }
  return out;
}

function placeSmokeAt(ctx: HudCtx, c: number, r: number): void {
  const m = smokePlan;
  if (!m) return;
  // `for` carries the owning squad past the ATTRIBUTED seat stamp: a
  // defender's Emergency Smoke is driven from the attacking client, and
  // without it the Screen would be recorded as the attacker's.
  const v = ctx.send({ kind: 'placeSmoke', seat: m.side, for: m.side, at: { col: c, row: r } });
  if (!v.ok) { ctx.refresh(); return; }
  m.placed.push({ col: c, row: r });
  m.left--;
  if (m.left <= 0) finishSmokePlan(ctx);
  else ctx.refresh();
}

function finishSmokePlan(ctx: HudCtx): void {
  const m = smokePlan;
  smokePlan = null;
  board?.clearHighlights();
  let despawned = true;
  if (m?.thenDespawn !== null && m?.thenDespawn !== undefined) {
    const proj = ctx.state.tokens.find((x) => x.uid === m.thenDespawn);
    if (proj) despawned = ctx.send({ kind: 'despawn', seat: proj.side, uid: proj.uid, targetUid: proj.uid }).ok;
  }
  if (m && despawned) ctx.noteNow(`${m.label}: ${m.placed.length} Smoke Screen${m.placed.length === 1 ? '' : 's'} placed.`, 'done');
  ctx.refresh();
  m?.onDone?.();
}

function smokePanel(ctx: HudCtx): string {
  const m = smokePlan!;
  const cands = smokeCandidates(ctx);
  const total = m.left + m.placed.length;
  return head('Your move', 'Place Smoke Screens', `${esc(m.label)} · ${m.left} left.`, true)
    + `<div class="tp-body">
        <p class="tp-note">${!m.placed.length && m.origin
          ? 'The first screen goes on the landing point.'
          : m.connected
            ? 'Each screen must be in Contact with one already placed by this Action, so pick a Grid sharing an edge with the smoke.'
            : 'Pick any highlighted Grid. This Action does not require the screens to be Connected.'} A Smoke Screen sits in one Large Grid and may share it with units and terrain.</p>
        <p class="tp-dim">${cands.length} legal ${cands.length === 1 ? 'Grid' : 'Grids'}. You may stop early: the card says <i>up to</i> ${total}.</p>
      </div>
      <div class="tp-foot"><button class="bigbtn ghost2" data-act="smokestop">${m.placed.length ? 'Stop here' : 'Cancel'}</button></div>`;
}

// The Connected groups still owing a removal this End Phase are snapshotted
// when dissipation ran. A removal that splits a group owes nothing further
// until next round (4.16), so they cannot be re-derived from the board. Both
// clients build the list from the same command in glueAfter, into the script.
function smokeChoicePanel(ctx: HudCtx): string {
  const owed = smokeOwedOf(ctx.state);
  const next = owed[0];
  // Under Season 1.04 each group owes three picks, so the count is of picks.
  const per = smokePerGroup(ctx.data, ctx.state);
  const left = per > 1 ? `${owed.length} pick${owed.length === 1 ? '' : 's'} left (Season ${esc(ctx.state.season ?? '')}: ${per} from each group).` : `${owed.length} Connected group${owed.length === 1 ? '' : 's'} left.`;
  if (!mine(ctx, next.side)) {
    return head('Waiting', `${esc(squadLabel(next.side))} thins its smoke`, left, false)
      + `<div class="tp-body">${waiting(next.side, 'choosing a Smoke Screen to remove')}</div><div class="tp-foot"></div>`;
  }
  return head('Your move', 'Smoke dissipation', `Take one screen off this Connected group.<br>${left}`, true)
    + `<div class="tp-body">
        <p class="tp-note">Click one highlighted Smoke Screen on the board. Splitting the group costs nothing further this round (4.16).</p>
      </div>
      <div class="tp-foot"><button class="bigbtn ghost2" data-act="smokeauto">Pick for me</button></div>`;
}

function removeOwedSmoke(ctx: HudCtx, at: { col: number; row: number }): void {
  const next = smokeOwedOf(ctx.state)[0];
  if (!next) return;
  ctx.send({ kind: 'removeSmoke', seat: next.side, side: next.side, at });
  ctx.refresh();
}

// ---------- Extra Action Opportunities (Coordinate) ----------
//
// An Action carrying the grant lets an Ally Mech in range pay Link and
// IMMEDIATELY take a complete Opportunity of its own, nested inside this one
// (FAQ K21). The guide asks which Ally in a dialog; here the panel asks, which
// is the same question in the place this HUD asks all its questions.

let grantPick: { from: number; grant: ExtraActivation } | null = null;

// Range is counted in Large Grids, the same way the guide counts it (turn.ts).
function gridsApart(a: Token, b: Token): number {
  return turn.gridsApart(a, b);
}

function grantTargets(ctx: HudCtx, from: Token, g: ExtraActivation): Token[] {
  return ctx.state.tokens.filter(
    (t) => t.kind === 'mech'
      && t.side === from.side
      && t.deployed !== false
      && alive(t)
      && (!g.excludeSelf || t.uid !== from.uid)
      && gridsApart(from, t) <= g.range,
  );
}

function grantPanel(ctx: HudCtx): string {
  const from = ctx.state.tokens.find((t) => t.uid === grantPick!.from);
  const g = grantPick!.grant;
  if (!from) return '';
  const targets = grantTargets(ctx, from, g);
  // A Mech too low on Link is shown and refused rather than hidden: a player
  // needs to see why it cannot be chosen.
  const rows = targets
    .map((t) => {
      const short = (t.link ?? 0) < g.minimumLink;
      return `<button class="rowwide${short ? ' warn' : ''}" data-grant="${t.uid}"${short ? ` aria-disabled="true" data-why="${esc(`${t.label} needs at least ${g.minimumLink} Link to be chosen.`)}"` : ''}>${esc(t.label)}<span class="ct">Link ${t.link ?? 0}</span></button>`;
    })
    .join('');
  const none = !targets.some((t) => (t.link ?? 0) >= g.minimumLink);
  return head('Your move', 'Coordinate: which Ally Mech?', `That Mech pays ${g.linkCost} Link and immediately takes an Extra Action Opportunity - this Mech resumes when it ends (FAQ K21).`, true)
    + `<div class="tp-body">${none ? `<p class="tp-note">No Ally Mech within Range ${g.range} has the ${g.minimumLink} Link this needs.</p>` : rows}</div>
       <div class="tp-foot"><button class="bigbtn ghost2" data-act="grantcancel">Cancel</button></div>`;
}

// ---------- scoring, judged the way the guide judges it ----------
//
// The mission logic lives in tasks.ts and both pages read it the same way; the
// award command then carries the resulting numbers, so a mirrored seat applies
// the same VP without re-deriving them. Scoring by hand was the last place the
// Match Centre guessed where the guide knew.

export function scorePreview(ctx: HudCtx, finalRound: boolean): ScoreResult {
  // The glue moved to scoring.ts when the pad became a third page showing a
  // score. Control is settled in there, as it always was here: this page has a
  // board to settle it from.
  return previewScore(ctx.data, ctx.state, finalRound);
}

// One row per squad: the Task they have taken, or the way to take one. Shown
// while the edge is being picked and again before deployment, because both
// moments are waiting on the same two answers.
function secondaryRows(ctx: HudCtx, fpFirst?: Side): string {
  const tasks = normaliseTasks(ctx.state.tasks);
  // With a First Player named, the rows run in reveal order and the second
  // player's picker waits until the first has revealed (FAQ P1).
  const order: Side[] = fpFirst ? [fpFirst, fpFirst === 's1' ? 's2' : 's1'] : ['s1', 's2'];
  return order
    .map((side, i) => {
      const card = tasks.secondary[side] ? ctx.data.secondary.find((c) => c.id === tasks.secondary[side]) : undefined;
      const isMe = mine(ctx, side);
      const held = !!fpFirst && i === 1 && !tasks.secondary[order[0]];
      // Your own pick stays changeable until the other side has revealed
      // theirs; then both are final (ruling I5).
      const both = !!tasks.secondary.s1 && !!tasks.secondary.s2;
      const cell = card
        ? isMe && !both
          ? `<button class="rowbtn" data-sec="${side}" title="Change this Secondary Task">${esc(card.name)} ✎</button>`
          : `<span class="pickchip set">${esc(card.name)}</span>`
        : held
          ? `<span class="tp-dim">waits for ${esc(squadLabel(order[0]))}</span>`
          : isMe
            ? `<button class="rowbtn" data-sec="${side}">Pick a Secondary Task</button>`
            : '<span class="tp-dim">picking…</span>';
      return `<div class="dialrow"><span class="nm ${side}">${esc(squadLabel(side))}</span>${cell}</div>`;
    })
    .join('');
}

// ---------- Tactics Cards (rulebook 5.4.2) ----------
//
// The strip is the reminder: each card's printed timing names the phase it
// belongs to, and a squad may play one a round. Playing one is two questions —
// which unit, then which option — exactly as playTactic asks them in freeplay.
// The strip used to send the command with the side's first token and no pick,
// which check() refused for every card that needs either.

let tacticPlan: { side: Side; cardId: string; uid?: number } | null = null;

function tacticCtxOf(ctx: HudCtx): TacticCtx {
  return { maxLink: (t: Token) => tokenCards(ctx.data, t).find((c) => c.slot === 'pilot')?.card.LV ?? 0, cruising: (t: Token) => cruising(ctx.data, t) };
}

// The squad panel's Play button, for match.ts: the same two questions the strip
// asks. It used to send the command bare - first token, no pick - which the
// engine refused for every card that needs a target or a choice.
export function startTacticPick(side: Side, cardId: string): void {
  if (!hudRef) return;
  startTactic(hudRef, side, cardId);
  hudRef.refresh();
}

function startTactic(ctx: HudCtx, side: Side, cardId: string): void {
  const spec = tacticSpec(cardId);
  if (!spec) return;
  const targets = tacticTargets(spec, ctx.state, side, tacticCtxOf(ctx));
  if (!targets.length) { ctx.noteNow(`${spec.name}: ${spec.none}`); return; }
  // One legal unit is no question, so it goes straight to the second one.
  tacticPlan = { side, cardId, uid: targets.length === 1 ? targets[0].uid : undefined };
  if (targets.length === 1) advanceTactic(ctx);
}

// Sends the play once both questions are answered, and skips either that has
// only one answer — the same shortcuts the freeplay dialogs take.
function advanceTactic(ctx: HudCtx): void {
  const m = tacticPlan;
  const spec = m ? tacticSpec(m.cardId) : null;
  const t = m?.uid !== undefined ? ctx.state.tokens.find((x) => x.uid === m.uid) : undefined;
  if (!m || !spec || !t) return;
  if (spec.choices) {
    const opts = spec.choices(t, ctx.state, tacticCtxOf(ctx));
    if (!opts.length) { tacticPlan = null; ctx.noteNow(`${spec.name}: ${spec.none}`); return; }
    if (opts.length > 1) return; // the panel asks
    playTactic(ctx, opts[0].id);
    return;
  }
  playTactic(ctx, null);
}

function playTactic(ctx: HudCtx, pick: string | null): void {
  const m = tacticPlan;
  const spec = m ? tacticSpec(m.cardId) : null;
  const t = m?.uid !== undefined ? ctx.state.tokens.find((x) => x.uid === m.uid) : undefined;
  tacticPlan = null;
  if (!m || !spec || !t) { ctx.refresh(); return; }
  // A sealed card is shown with the salt that proves it (1.11; tactichand.ts).
  const salt = saltFor(ctx.state, m.side, m.cardId, ctx.room);
  const v = ctx.send({ kind: 'playTactic', seat: m.side, uid: t.uid, cardId: m.cardId, pick: pick ?? undefined, ...(salt ? { salt } : {}) });
  if (!v.ok) { ctx.refresh(); return; }
  // apply writes the card's own line into the unit's log, which is the only
  // place that knows what the effect worked out to.
  ctx.noteNow(t.log?.at(-1)?.text ?? `${squadLabel(m.side)} plays ${spec.name}.`, 'done');
  // Hit and Run hands out a Movement that no Opportunity paid for. It is still
  // a MANEUVER, so an Ojs200's optional flight is on offer here too - freeplay
  // asks on this path and the two drivers must not disagree.
  if (spec.maneuver) startMovePlan(ctx, t, { label: `${spec.name} · Maneuver`, granted: true, maneuver: true });
  ctx.refresh();
}

function tacticPanel(ctx: HudCtx): string {
  const m = tacticPlan!;
  const spec = tacticSpec(m.cardId)!;
  if (m.uid === undefined) {
    const rows = tacticTargets(spec, ctx.state, m.side, tacticCtxOf(ctx))
      .map((t) => `<button class="rowwide" data-tacticunit="${t.uid}">${esc(t.label)}<span class="ct">${t.stance.toUpperCase()}${t.link !== undefined ? ` · ${linkIcon(null)}${t.link}` : ''}</span></button>`)
      .join('');
    return head('Your move', esc(spec.name), esc(spec.prompt), true)
      + `<div class="tp-body">${rows}</div>
         <div class="tp-foot"><button class="bigbtn ghost2" data-act="tacticcancel">Cancel</button></div>`;
  }
  const t = ctx.state.tokens.find((x) => x.uid === m.uid);
  const opts = t && spec.choices ? spec.choices(t, ctx.state, tacticCtxOf(ctx)) : [];
  const rows = opts
    .map((o) => `<button class="rowwide" data-tacticpick="${esc(o.id)}">${esc(o.label)}${o.note ? `<span class="ct">${esc(o.note)}</span>` : ''}</button>`)
    .join('');
  return head('Your move', esc(spec.choiceTitle ?? spec.name), esc(t?.label ?? ''), true)
    + `<div class="tp-body">${rows}</div>
       <div class="tp-foot"><button class="bigbtn ghost2" data-act="tacticcancel">Cancel</button></div>`;
}
function tacticsHtml(ctx: HudCtx): string {
  const s = ctx.state;
  if (!normaliseSetup(s.setup)) return '';
  const phase = PHASES[s.round.phase];
  const sides: Side[] = ctx.seat ? [ctx.seat] : ['s1', 's2'];
  const rows: string[] = [];
  for (const side of sides) {
    // This device's own cards: a sealed hand's are kept here, never sent.
    const held = handIds(s, side, ctx.room);
    if (!held.length) continue;
    const spent = (s.tacticsPlayed?.[side] ?? []).filter((e) => e.startsWith(`${s.round.n}:`));
    const seen = new Set<string>();
    for (const id of held) {
      if (seen.has(id)) continue;
      seen.add(id);
      const card = ctx.data.byId.get(id);
      if (!card || !tacticFitsPhase(id, phase)) continue;
      const when = tacticSpec(id)?.timing ?? '';
      // Discarded once used, for the game (FAQ P2; audit Phase 6, H1).
      const usedIn = tacticUsedRound(s, side, id);
      // And the moment its own text names (5.4.2; audit Phase 6, H2).
      const spec = tacticSpec(id);
      const moment = spec ? tacticWindowWhy(spec, s, side) : null;
      const off = usedIn !== null || spent.length > 0 || !!moment;
      const why = usedIn !== null ? `Used in round ${usedIn}, and discarded for the game (FAQ P2).` : spent.length ? 'Only 1 Tactics Card per player per round (5.4.2).' : moment ?? '';
      // Greyed with the reason for the notice line, no title (audit Phase 7, P7D 9).
      rows.push(`<div class="dialrow"><span class="nm ${side}">${esc(cardName(card))}</span>
        <span class="tp-dim">${esc(when)}</span>
        <button class="rowbtn" data-tactic="${side}:${esc(id)}"${off ? ` aria-disabled="true" data-why="${esc(why || 'Not now.')}"` : ''}>${usedIn !== null ? `Used, round ${usedIn}` : spent.length ? 'Spent' : 'Play'}</button></div>`);
    }
  }
  if (!rows.length) return '';
  return `<div class="tacticstrip"><div class="sect2">Tactics you could play now</div>${rows.join('')}
    <p class="tp-dim">Only 1 per player per round (5.4.2), and each is used once in a game.<br>The card is in your hand. This just says when.</p></div>`;
}

function feedHtml(ctx: HudCtx): string {
  if (!ctx.diceFeed.length) return '';
  const lines = ctx.diceFeed.slice(-3);
  const highest = lines.reduce((n, d) => Math.max(n, d.n), feedSeen);
  const rows = lines
    .map((d) => {
      const dice = d.dice.length
        ? `<span class="rolldice">${d.dice.map((x) => dieHtml(ctx, x)).join('')}</span>`
        : '';
      // The count sits on its own line under what it was rolled for, so a long
      // label can never wrap the number away from the word it belongs to.
      const sum = d.result.length
        ? d.result.map((r) => `<b>${r.n}</b>${d.kind === 'pool' ? '× ' : ' '}${esc(r.unit)}`).join(', ')
        : 'all blank';
      return `<div class="feedline${d.n > feedSeen ? ' rolling' : ''}">
        <div class="feedwho"><b class="${d.seat}">${esc(squadLabel(d.seat))}</b> ${esc(d.label)}</div>
        <div class="feedres">${dice}<span class="feedsum">${sum}</span></div>
      </div>`;
    })
    .join('');
  feedSeen = highest;
  return `<div class="dicefeed">${rows}</div>`;
}

function secOverlay(ctx: HudCtx): string {
  if (!secOpen) return '';
  // A card that designates a Tactical Area needs the board to have some: any
  // of them, whatever the Main Task, VIP included (audit Phase 6, D9). The
  // same gate the freeplay picker applies, so an impossible Task can never be
  // chosen.
  const hasZones = missionZones(ctx.data, ctx.state).length > 0;
  // The box holds one of each, so the other squad's card is theirs (ruling
  // I17): shown, and greyed.
  const theirs = secFor ? normaliseTasks(ctx.state.tasks).secondary[secFor === 's1' ? 's2' : 's1'] : undefined;
  const rows = ctx.data.secondary
    .map((c) => {
      const held = c.id === theirs;
      const blocked = (c.designate === 'zone' && !hasZones) || held;
      return `<button class="pickrow${blocked ? ' blocked' : ''}${secPick === c.id ? ' sel' : ''}"${blocked ? ' disabled' : ''} data-picksec="${esc(c.id)}" data-img="${esc(secondaryImageUrl(c.id))}">
        <span class="nm">${esc(c.name)}</span>
        <span class="ct">${held ? 'the other squad holds it' : blocked ? 'needs Tactical Zones' : `${c.vp ?? 0} VP`}</span>
      </button>`;
    })
    .join('');
  const shown = secPick || ctx.data.secondary[0]?.id || '';
  // The card image rides on the left, filled in as rows are hovered — same
  // habit as the freeplay picker, so the details decide the pick.
  return `<div class="mc-veil" id="mc-secveil"><div class="acct seccards">
    <button class="x" id="mc-sec-x">✕</button>
    <div class="secsplit">
      <div class="seccard"><img id="mc-seccard" alt="" src="${esc(secondaryImageUrl(shown))}"></div>
      <div class="seclist">
        <h3>Pick a Secondary Task</h3>
        <div class="role">Open information: the other player sees your pick (3.1.3).<br>Hover to read a card, then confirm.</div>
        ${rows}
        ${!hasZones ? '<p class="quiet">This board has no Tactical Zones, so Tasks that designate one are unavailable.</p>' : ''}
        <button class="btn wide" id="mc-sec-ok"${secPick ? '' : ' disabled'}>Confirm this Task</button>
      </div>
    </div>
  </div></div>`;
}

// The shell, so a tab can be brought forward from outside the click handler —
// an attack starting has to put the Combat tab in front by itself.
let sideTabHost: HTMLElement | null = null;

export type SideTab = 'squad' | 'details' | 'thinking';

export function showSideTab(host: HTMLElement | null, name: SideTab): void {
  const root = host ?? sideTabHost;
  if (!root) return;
  for (const x of root.querySelectorAll<HTMLElement>('.hudtab')) x.classList.toggle('active', x.dataset.sidetab === name);
  for (const s of root.querySelectorAll<HTMLElement>('.side-tab')) s.classList.toggle('active', s.id === `tab-${name}`);
  if (name === 'thinking') paintThinking();
}

// THE THINKING TAB (a game against the computer; OTTO, 2026-10-05: "some sort
// of History or Thinking tab that becomes visible where I can watch how the
// computer chooses to make moves and follow along"): what each computer chose
// and why, the newest first, under the round and phase it was chosen in. In a
// game the player watches, a turn also lists the plans it weighed and what
// each was worth to it, and the answer it is about to give is marked.
let thinkingKey = '';

function signed(x: number): string {
  return `${x < 0 ? '−' : ''}${Math.abs(x).toFixed(2)}`;
}

// The terms of the plan chosen, the ones that came to anything.
function partsLine(p: NonNullable<NonNullable<Thought['considered']>[number]['parts']>): string {
  const terms: [string, number][] = [['now', p.now], ['next turn', p.next], ['mission', p.mission], ['position', p.shape], ['enemy fire', -p.cost]];
  const said = terms.filter(([, v]) => Math.abs(v) >= 0.005).map(([k, v]) => `${k} ${signed(v)}`);
  if (p.risk >= 0.005) said.push(`${Math.round(p.risk * 100)}% chance to be lost`);
  return said.join(' · ');
}

export function thinkingHtml(list: readonly Thought[], watching: boolean): string {
  const lead = watching
    ? 'What each computer chose and why, newest first. A number is what that plan was worth to it, in Victory Points.'
    : 'What the computer did and why, newest first.';
  if (!list.length) return `<p class="th-lead">${lead}</p><p class="th-empty">Nothing yet.</p>`;
  const groups: { head: string; rows: Thought[] }[] = [];
  for (let i = list.length - 1; i >= 0; i--) {
    const t = list[i];
    const head = t.round ? `Round ${t.round} · ${PHASES[t.phase] ?? ''}` : 'Setup';
    const g = groups[groups.length - 1];
    if (g && g.head === head) g.rows.push(t);
    else groups.push({ head, rows: [t] });
  }
  const row = (t: Thought): string => {
    const who = t.unit ?? squadLabel(t.seat);
    // A label that starts with the unit's name says it once, in front.
    const bare = (label: string): string => (t.unit && label.startsWith(`${t.unit}: `) ? label.slice(t.unit.length + 2) : label);
    const what = bare(t.label);
    const alts = watching && t.considered?.length
      ? `<ol class="th-alts">${t.considered.map((c, i) => `<li${i === 0 ? ' class="chosen"' : ''}><span>${esc(bare(c.label))}</span><em>${signed(c.worth)}</em></li>`).join('')}</ol>`
        + (t.considered[0].parts ? `<div class="th-parts">${esc(partsLine(t.considered[0].parts))}</div>` : '')
      : '';
    // Its own words, less the sum the list above already shows, and less the
    // reason already given in a player's words.
    const own = watching && t.why ? t.why.replace(/(^|;\s*)worth -?[\d.]+ \([^)]*\)\s*$/, '').replace(/;\s*$/, '').trim() : '';
    const said = !!t.because && own.toLowerCase().startsWith(t.because.toLowerCase());
    const why = own && !said ? `<div class="th-why">${esc(own)}</div>` : '';
    const state = t.given === null ? ' th-now' : t.given === 'refused' ? ' th-refused' : '';
    return `<li class="th-row${state}"><div class="th-line"><b class="${t.seat}">${esc(who)}</b> ${esc(what)}${t.given === 'refused' ? ' <em>(refused by the table)</em>' : ''}</div>`
      + `${t.because ? `<div class="th-because">${esc(t.because)}</div>` : ''}${why}${alts}</li>`;
  };
  return `<p class="th-lead">${lead}</p>${groups.map((g) => `<p class="th-head">${esc(g.head)}</p><ul class="th-list">${g.rows.map(row).join('')}</ul>`).join('')}`;
}

// Drawn again only when what it shows has changed: the computers think far
// more often than the page draws. In a game the player watches it is the tab
// in front when the game opens.
let thinkingShown = false;
export function paintThinking(): void {
  const host = sideTabHost;
  const ctx = hudRef;
  if (!host || !ctx) return;
  const list = ctx.solo?.thinking?.();
  const tab = host.querySelector<HTMLElement>('[data-sidetab="thinking"]');
  if (tab) tab.hidden = !list;
  if (list && ctx.solo?.watching && !thinkingShown) {
    thinkingShown = true;
    showSideTab(host, 'thinking');
    return;
  }
  const body = host.querySelector<HTMLElement>('#thinking-body');
  // Drawn only while it is the tab in front (`showSideTab` draws it as it
  // comes forward).
  if (!body || !list || !host.querySelector('#tab-thinking.active')) return;
  const key = `${ctx.solo?.watching ? 'w' : 'p'}|${list.map((t) => `${t.n}${t.given ? t.given[0] : '?'}`).join(',')}`;
  if (key === thinkingKey && body.childElementCount) return;
  thinkingKey = key;
  body.innerHTML = thinkingHtml(list, !!ctx.solo?.watching);
}

// Mounts the HUD once and updates it in place from then on. The board is the
// same stateful renderer the freeplay page uses — zoom, pan, art and all — so
// it must never be torn down by a re-render.
export function ensureHud(host: HTMLElement, ctx: HudCtx): void {
  hudRef = ctx;
  watchedSeat = ctx.solo?.watching ? ctx.seat : null;
  if (!host.querySelector('#hud-shell')) {
    // The shell is about to be written from scratch, so #combat-body will be a
    // NEW and empty element. Nothing has to be reset here for the mirror any
    // more: it used to be two module-level markup caches that outlived the DOM
    // they described, and a player who left the table and came back mid-attack
    // found the cache equal to the markup the unchanged view produces, skipped
    // the write and was left reading an empty Combat window. The helper answers
    // that question from its own state now and remount() redraws it in place.
    // The freeplay side panel moves to the LEFT here and keeps its own tabs,
    // so a player can read either squad and any card mid-match. The ids are
    // the ones SquadTracker and Panel bind to.
    // Squads and Details sit on the RIGHT, where a player coming from the
    // freeplay board expects them; the turn panel takes the left.
    host.innerHTML = `<div class="hud" id="hud-shell">
      <div class="turnpanel" id="hud-panel"></div>
      <div class="hudmain">
        <div id="hud-tl"></div>
        <!-- The activation order floats INSIDE the board host, which is already
             positioned and already the place freeplay hangs its Guide panel.
             Board appends its own scroll wrapper after this one and never
             replaces the host's children, so the overlay survives every redraw.
             It used to be a strip below the board, which took a slice of the
             map's height the moment the dials were set. -->
        <div id="mc-board" class="hudboardhost"><div id="hud-order" class="orderfloat"></div><div id="mc-notice" class="mc-notice" hidden></div></div>
      </div>
      <div class="hudside">
        <div class="hudtabs">
          <button class="hudtab active" data-sidetab="squad">Squads</button>
          <button class="hudtab" data-sidetab="details">Details</button>
          <button class="hudtab" data-sidetab="thinking" hidden>Thinking</button>
        </div>
        <section id="tab-squad" class="side-tab active"><div id="squad-body"></div></section>
        <section id="tab-details" class="side-tab"><div id="details-body"></div></section>
        <section id="tab-thinking" class="side-tab"><div id="thinking-body"></div></section>
      </div>
    </div>
    <!-- The freeplay AttackHelper renders straight into #combat-body, and
         match.html already loads styles.css, so its markup arrives styled. It
         floats over the board rather than living in a tab, because resolving an
         attack is the thing you are doing, not a panel you consult. Written
         once and never by a re-render: the helper owns its contents for as long
         as an attack is running. -->
    <div id="combat-pop" class="combatpop" hidden>
      <div class="combatpop-head"><span class="cp-grip" title="Drag to move">⠿</span><b>Combat</b><span class="cp-hint">4.4 · the roll, the defence and the damage</span>
        <button id="cp-min" class="cp-min" title="Roll it up out of the way. The attack keeps going.">–</button></div>
      <div id="combat-body"></div>
    </div>
    <div id="hud-veils"></div>`;
    board = new Board(host.querySelector('#mc-board')!, boardCallbacks());
    // The shell was written this frame, so the board's own fit ran against a
    // column that had not settled yet.
    requestAnimationFrame(() => board?.fit());
    // The zone toggle floats bottom-left INSIDE the board, exactly where the
    // freeplay page keeps it — same markup, same .zone-ctrl styling.
    const zc = document.createElement('div');
    zc.className = 'zone-ctrl';
    // Environment Cards ride the same rail: they are laid on the battlefield
    // while it is being set up, so the control lives on the board rather than
    // in the turn panel, and it goes away once Round 1 starts.
    // The Line of Sight control rides it too (OTTO's playtest, 2026-10-03:
    // "maybe above or next to the zone button").
    zc.innerHTML = '<button id="btn-zones" title="Shows or hides the tactical zone and deployment overlay drawn on the board." aria-pressed="true">Zones</button>'
      + '<button id="btn-los" title="Shows what the unit you picked can see (click a unit to open its card), and that unit only; with none picked, your unit whose turn it is: the Grids in its Forward Arc in the stronger tint, the Grids it would have to turn to see in the fainter one, and a Grid seen through cover lighter than one seen clear." aria-pressed="false">Line of Sight</button>'
      + '<button id="btn-envs" title="Lays Environment Cards on the battlefield. Both players place them alternately while setting up (5.4.1)." hidden>Environments</button>';
    host.querySelector('#mc-board')!.appendChild(zc);
    zc.querySelector('#btn-zones')!.addEventListener('click', () => hudRef?.toggleZones());
    zc.querySelector('#btn-los')!.addEventListener('click', () => {
      sightOn = !sightOn;
      if (hudRef) renderBoard(hudRef);
    });
    zc.querySelector('#btn-envs')!.addEventListener('click', () => {
      if (hudRef) toggleEnvPicker(hudRef);
    });
    attachCombatWindow(host);
    ctx.mountSide();
    for (const b of host.querySelectorAll<HTMLElement>('[data-sidetab]')) {
      b.addEventListener('click', () => showSideTab(host, b.dataset.sidetab as SideTab));
    }
    sideTabHost = host;
    thinkingKey = '';
    thinkingShown = false;
  }
  paintThinking();
  (host.querySelector('#hud-tl') as HTMLElement).innerHTML = timelineHtml(ctx.state) + undoChrome(ctx);
  (host.querySelector('#hud-order') as HTMLElement).innerHTML = orderFloatHtml(ctx);
  (host.querySelector('#hud-panel') as HTMLElement).innerHTML =
    `${panelHtml(ctx)}${tacticsHtml(ctx)}${feedHtml(ctx)}`;
  (host.querySelector('#hud-veils') as HTMLElement).innerHTML = secOverlay(ctx);
  const zb = host.querySelector<HTMLButtonElement>('#btn-zones');
  if (zb) {
    zb.classList.toggle('on', ctx.zonesOn);
    zb.setAttribute('aria-pressed', ctx.zonesOn ? 'true' : 'false');
  }
  // The combat window is up while an attack is being resolved: the live helper
  // on the attacking client, and the SAME helper drawing the published view
  // everywhere else, so every other player watches the same fight instead of a
  // dice feed. Nothing is written into #combat-body from here any more. The
  // helper owns those pixels in both cases, which is what makes the dice spin
  // and the offsetting play on a watching screen for the first time.
  const pop = host.querySelector<HTMLElement>('#combat-pop');
  if (pop) {
    // A COUNTER-ROLL OWNS THE WINDOW when there is one. The two cannot be live
    // at once -- an Electronic Attack IS the Action -- and the record on the
    // wire is what both clients draw, so the attack mirror stands down for it.
    const contest = syncContest(ctx, host);
    const mirror = contest ? false : ctx.syncCombatMirror();
    pop.hidden = !contest && !ctx.combatBusy() && !mirror;
  }
  wireHud(host, ctx);
  renderBoard(ctx);
  // A unit the player clicked wins over the active one, until it leaves the
  // board or they end the activation.
  if (inspectUid !== null && !ctx.state.tokens.some((t) => t.uid === inspectUid)) inspectUid = null;
  ctx.syncSide(inspectUid ?? ensureScript(ctx.state).opp?.uid ?? null);
  // After the paint, so the offer's dialog opens over the settled table.
  settleHeldCoordination(ctx);
}

// ---------- the combat window ----------
//
// Wired once, when the shell is built, and never by a re-render: the helper
// owns the window's contents for as long as an attack lasts, and rebinding
// under it would drop a drag halfway. Where it sits and whether it is rolled up
// survive being reopened, because a player who moved it out of the way meant it.

let combatSpot: { x: number; y: number } | null = null;
let combatRolled = false;

function attachCombatWindow(host: HTMLElement): void {
  const pop = host.querySelector<HTMLElement>('#combat-pop');
  if (!pop) return;
  const place = (): void => {
    if (!combatSpot) return;
    // Once dragged it is positioned by its own corner, so the centring
    // transform has to go or it lands half a window off.
    pop.style.transform = 'none';
    pop.style.left = `${combatSpot.x}px`;
    pop.style.top = `${combatSpot.y}px`;
  };
  host.querySelector('#cp-min')?.addEventListener('click', () => {
    combatRolled = !combatRolled;
    pop.classList.toggle('rolled', combatRolled);
  });
  let from: { x: number; y: number; l: number; t: number } | null = null;
  const move = (ev: PointerEvent): void => {
    if (!from) return;
    const b = host.getBoundingClientRect();
    const w = pop.getBoundingClientRect();
    // Kept inside the HUD, and by enough of its header that the grip and the
    // minimise button are always still there to grab.
    combatSpot = {
      x: Math.max(0, Math.min(from.l + (ev.clientX - from.x), b.width - 60)),
      y: Math.max(0, Math.min(from.t + (ev.clientY - from.y), b.height - Math.min(w.height, 40))),
    };
    place();
  };
  const up = (): void => {
    from = null;
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
  };
  pop.addEventListener('pointerdown', (ev) => {
    const el = ev.target as HTMLElement;
    if (!el.closest('.combatpop-head') || el.closest('button')) return;
    const b = host.getBoundingClientRect();
    const w = pop.getBoundingClientRect();
    from = { x: ev.clientX, y: ev.clientY, l: w.left - b.left, t: w.top - b.top };
    ev.preventDefault();
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  });
  place();
}

// ---------- the End Phase checklist (rulebook 3.7) ----------

// One press, one step. It sits out here rather than inside wireHud because the
// ORDER of the two commands it sends is itself a rule, and a rule buried in a
// click handler is a rule nothing can drive: the Award and the step mark BOTH
// write `${round}:end:tasks`, so the sequence has to be testable.
export function settleEndStep(ctx: HudCtx, seat: Side, step: string): void {
  // Dissipation takes the isolated screens off both sides at once and then
  // owes one from each Connected group; glueAfter turns that into the queue
  // the choice panel walks. Said out loud, because it changes the board.
  if (step === 'smoke') {
    const per = smokePerGroup(ctx.data, ctx.state);
    const was = (['s1', 's2'] as Side[]).map((side) => ({ side, ...dissipationFor(ctx.state.smoke ?? [], side, per) }));
    const iso = was.reduce((n, d) => n + d.isolated.length, 0);
    const groups = was.reduce((n, d) => n + d.groups.length, 0);
    const loses = per === 1 ? 'one' : String(per);
    // Once per End Phase (4.16): the command refuses a second, and a refusal
    // must not be reported as screens coming off (audit Phase 4, G7).
    const v = ctx.send({ kind: 'dissipateSmoke', seat });
    ctx.noteNow(!v.ok
      ? (v.why ?? 'The smoke has already dissipated this End Phase.')
      : iso || groups
        ? `${iso} ${per > 1 ? '' : 'isolated '}Smoke Screen${iso === 1 ? '' : 's'} removed${per > 1 ? `, every group of ${per} or fewer whole` : ''}${groups ? `, and ${groups === 1 ? `one Connected group loses ${loses}` : `each of ${groups} Connected groups loses ${loses}`}` : ''} (${per > 1 ? `Season ${ctx.state.season ?? ''}` : '4.16'}).`
        : 'Nothing to dissipate.', v.ok ? 'done' : 'refused');
  }
  // "Settle Task control" is the step that pays: the guide judges the board
  // and sends the numbers with the Award, so a mirrored seat applies the same
  // VP rather than working them out again and maybe differently.
  // Marking the step is idempotent; paying for it is not. Both players can
  // see this button, so without the guard two near-simultaneous presses
  // would award the round twice.
  const alreadySettled = ensureScript(ctx.state).endDone.includes(`${ctx.state.round.n}:end:tasks`);
  if (step === 'tasks' && !alreadySettled) {
    const last = gameEndsThisRound(ctx.data, ctx.state);
    const got = scorePreview(ctx, last);
    if (got.lines.length) {
      const paid = ctx.send({
        kind: 'award', seat,
        vp: { s1: got.s1, s2: got.s2 },
        keys: got.lines.map((l) => l.key).filter((k): k is string => !!k),
      });
      // A refused Award must never be followed by the step mark. Award's apply
      // and markEndStep's apply write the SAME `${round}:end:tasks` key, and
      // alreadySettled above reads that key to stop a second press — so
      // marking a step whose payment was refused threw the round's Victory
      // Points away for BOTH squads, with no retry and nothing said. Found
      // live. Returning here leaves the step open, which is what makes the
      // press repeatable once whatever refused it is gone.
      if (!paid.ok) {
        ctx.noteNow(`This round's score was NOT settled: ${paid.why} Nothing has been paid, so press Settle Task control again once that is dealt with.`);
        ctx.refresh();
        return;
      }
      // An allowed Award can still have something to say: a rider penalty that
      // would take a squad below zero is paid but floored (5.2.4), and the
      // score sheet would otherwise disagree with the lines above it.
      if (paid.note) ctx.noteNow(paid.note, 'warn');
    }
  }
  // The command does the work; this reads the board first so it can say what
  // the work was. A step that changes the board silently is the guide's one
  // habit worth not copying.
  const before = ctx.state.tokens.map((t) => ({
    uid: t.uid,
    label: t.label,
    expiring: [...(t.expiring ?? [])].filter((id) => (t.statuses ?? []).includes(id)),
  }));
  const stepped = ctx.send({ kind: 'markEndStep', seat, step }).ok;
  if (stepped && step === 'tokens') {
    const names = (ids: string[]) => [...new Set(ids)].map((id) => STATUSES.find((d) => d.id === id)?.label ?? id).join(', ');
    // The yellow faces that turned are read AFTER the command, as the guide
    // does: the markers before it were the red set leaving, so the note named
    // those twice and never a Fragile that turned (audit Phase 6, C9).
    const said = before
      .map((b) => {
        const now = ctx.state.tokens.find((x) => x.uid === b.uid);
        return { ...b, flipping: (now?.expiring ?? []).filter((id) => (now?.statuses ?? []).includes(id)) };
      })
      .filter((b) => b.expiring.length || b.flipping.length)
      .map((b) => `${b.label}: ${[b.expiring.length ? `${names(b.expiring)} expired` : '', b.flipping.length ? `${names(b.flipping)} flips to red` : ''].filter(Boolean).join(', ')}`);
    ctx.noteNow(said.length ? said.join(' · ') : 'Tokens aged and both Command pools cleared.', 'done');
  }
  if (stepped && step === 'remove') {
    const gone = before.filter((b) => !ctx.state.tokens.some((t) => t.uid === b.uid));
    ctx.noteNow(gone.length
      ? `Integrity Loss: ${gone.map((g) => g.label).join(', ')} left the board (4.4.4).`
      : 'No Mech was down to two Parts, so nothing left the board.', 'done');
  }
  ctx.refresh();
}

// ---------- wiring ----------

export function wireHud(root: HTMLElement, ctx: HudCtx): void {
  const s = ctx.state;
  // In a room this is simply my seat. Solo — the dev harness, where one screen
  // walks both squads — it has to be whoever is being asked, or the second
  // squad could never pass and the phase would never close.
  const me = (): Side => ctx.seat ?? ensureScript(ctx.state).turn ?? 's1';
  const on = (sel: string, fn: (el: HTMLElement) => void) => {
    for (const el of root.querySelectorAll<HTMLElement>(sel)) el.addEventListener('click', () => fn(el));
  };
  // The panel is rebuilt every render, so its buttons are rewired every render;
  // the keyboard is not part of the panel and is installed once.
  if (!keysWired) {
    keysWired = true;
    document.addEventListener('keydown', (ev) => {
      const c = hudRef;
      if (!c || ev.metaKey || ev.ctrlKey || ev.altKey) return;
      const el = document.activeElement as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
      // Backspace trims the route by one waypoint. Escape still cancels the
      // whole move, which is a different retreat and stays separate.
      if (movePlan && (ev.key === 'Backspace' || ev.key === 'Delete')) {
        ev.preventDefault();
        undoWaypoint(c);
        return;
      }
      const k = ev.key.toLowerCase();
      if ((k === 'q' || k === 'e') && rotate(c, k === 'q' ? 3 : 1)) ev.preventDefault();
    });
  }

  on('[data-act="lockmap"]', () => { ctx.send({ kind: 'lockMap', seat: me() }); ctx.refresh(); });
  on('[data-roll]', (el) => {
    const side = el.dataset.roll as Side;
    // The dice themselves reach the feed from the roll announcement, which
    // both players get; this only has to record what they were worth. The
    // squad's name is not in the label because the feed prints it in front.
    void ctx.rollHits(2, 'rolls for First Player').then((res) => {
      ctx.send({ kind: 'rollSetup', seat: side, hits: res.hits });
      ctx.refresh();
    }).catch(() => {
      ctx.noteNow('The server did not answer the roll. Press it again.', 'system');
      ctx.refresh();
    });
  });
  on('[data-act="accept"]', () => { ctx.send({ kind: 'acceptRoll', seat: me() }); ctx.refresh(); });
  on('[data-act="tasksdone"]', () => { ctx.send({ kind: 'finishTasks', seat: me() }); ctx.refresh(); });
  on('[data-boxplace]', (el) => {
    boxPlace = boxPlace?.itemId === el.dataset.boxplace ? null : { itemId: el.dataset.boxplace! };
    ctx.refresh();
  });
  on('[data-boxkeep]', (el) => {
    const item = normaliseTasks(s.tasks).items.find((i) => i.id === el.dataset.boxkeep);
    if (item?.col === undefined || item.row === undefined) return;
    boxPlace = null;
    const v = ctx.send({ kind: 'placeTaskItem', seat: me(), itemId: item.id, to: { col: item.col, row: item.row } });
    if (!v.ok) ctx.noteNow(v.why ?? 'That placement was refused.');
    ctx.refresh();
  });
  on('[data-edge]', (el) => { ctx.send({ kind: 'pickEdge', seat: s.round.firstPlayer, edge: el.dataset.edge as 'black' | 'white' }); ctx.refresh(); });
  on('[data-sec]', (el) => {
    secFor = el.dataset.sec as Side;
    secPick = null;
    secOpen = true;
    ctx.refresh();
  });
  // Choosing highlights; confirming commits. A Task is only locked in once
  // the player has read it and said so.
  on('[data-picksec]', (el) => {
    secPick = el.dataset.picksec!;
    ctx.refresh();
  });
  for (const el of root.querySelectorAll<HTMLElement>('[data-picksec]')) {
    el.addEventListener('mouseenter', () => {
      const img = root.querySelector<HTMLImageElement>('#mc-seccard');
      if (img && el.dataset.img) img.src = el.dataset.img;
    });
  }
  root.querySelector('#mc-sec-ok')?.addEventListener('click', () => {
    if (secPick) ctx.send({ kind: 'pickSecondary', seat: secFor ?? me(), cardId: secPick });
    secOpen = false;
    secPick = null;
    ctx.refresh();
  });
  root.querySelector('#mc-sec-x')?.addEventListener('click', () => { secOpen = false; secPick = null; ctx.refresh(); });
  on('[data-place]', (el) => {
    // Picking a different unit gives up an unconfirmed placement — it was
    // never sent, so there is nothing on the board to take back.
    pending = null;
    board?.clearGhost();
    deployStance = 'offensive';
    deployCamo = false;
    placing = placing === Number(el.dataset.place) ? null : Number(el.dataset.place);
    ctx.refresh();
  });
  on('[data-act="confirmplace"]', () => {
    // Now it lands, and only now does the turn pass to the other squad.
    if (pending) {
      const t = ctx.state.tokens.find((x) => x.uid === pending!.uid);
      const v = ctx.send({
        kind: 'deployUnit', seat: t?.side ?? me(), uid: pending.uid,
        to: { col: pending.col, row: pending.row },
        stance: t?.kind === 'mech' ? deployStance : undefined,
        camo: deployCamo || undefined,
        facing: pending.facing,
      });
      if (!v.ok) { ctx.refresh(); return; }
    }
    pending = null;
    placing = null;
    board?.clearGhost();
    ctx.refresh();
  });
  // Cell and token interaction now belongs to the shared Board's callbacks.
  on('[data-act="deployready"]', () => { ctx.send({ kind: 'setReady', seat: me(), ready: true }); ctx.refresh(); });
  on('[data-act="deployunready"]', () => { ctx.send({ kind: 'setReady', seat: me(), ready: false }); ctx.refresh(); });
  on('[data-act="deploydone"]', () => { ctx.send({ kind: 'finishDeployment', seat: me() }); ctx.refresh(); });

  on('[data-dialopen]', (el) => {
    const uid = Number(el.dataset.dialopen);
    dialOpen = dialOpen === uid ? null : uid;
    ctx.refresh();
  });
  on('[data-dial]', (el) => {
    const [uid, timing] = el.dataset.dial!.split(':');
    const t = s.tokens.find((x) => x.uid === Number(uid));
    // Picking the one already set clears it, which is the only way back to an
    // empty dial without a Clear row taking up a slot in the stack.
    if (t) ctx.send({ kind: 'setTiming', seat: t.side, uid: t.uid, timing: t.timing === timing ? undefined : timing as Timing });
    dialOpen = null;
    ctx.refresh();
  });

  on('[data-desigzone]', (el) => {
    ctx.send({ kind: 'designateTask', seat: (el.dataset.desigby as Side) ?? me(), what: 'zone', zone: el.dataset.desigzone! });
    ctx.refresh();
  });
  on('[data-desigmech]', (el) => {
    ctx.send({
      kind: 'designateTask', seat: (el.dataset.desigby as Side) ?? me(),
      what: el.dataset.desigwhat as 'target' | 'leader',
      for: el.dataset.desigfor as Side,
      uid: Number(el.dataset.desigmech),
    });
    ctx.refresh();
  });

  on('[data-designate]', (el) => {
    const t = s.tokens.find((x) => x.uid === Number(el.dataset.designate));
    if (!t) { ctx.refresh(); return; }
    // 4.15.2 asks which Mech issues before the token moves, but only in the
    // Command Phase - the Automatic and Delay Phases designate a unit that acts
    // on its own. Same picker as the guide, so the two pages ask identically.
    if (PHASES[s.round.phase] !== 'Command') {
      ctx.send({ kind: 'designate', seat: t.side, uid: t.uid });
      ctx.refresh();
      return;
    }
    const free = ensureScript(s).freeCommand.includes(t.uid);
    void askIssuer(ctx.data, s, t.side, t, free).then((pick) => {
      // Backing out spends nothing and leaves the phase exactly where it was.
      if (pick === 'cancelled') { ctx.refresh(); return; }
      ctx.send({ kind: 'designate', seat: t.side, uid: t.uid, fromUid: pick.uid || undefined });
      ctx.refresh();
    });
  });
  on('[data-act="pass"]', () => { ctx.send({ kind: 'passTurn', seat: me() }); ctx.refresh(); });
  on('[data-act="swarmstop"]', () => { ctx.send({ kind: 'endSwarm', seat: me() }); ctx.refresh(); });
  // The defender's Focus, Designate, KC Armor, Melee Evasion and Dodge
  // Enhancement all used to be delegated markup here, because the mirror was
  // markup. They are real controls inside the one renderer now and they send
  // themselves through AttackHelper.mirrorAct, so there is nothing to delegate.
  //
  // This one stays: it is the TURN PANEL's roll button, which is what a
  // defender sees when no view was published at all (an attacker on an older
  // build), and the panel is still markup.
  on('[data-act="rolldefense"]', (el) => {
    const call = ensureScript(s).combat;
    if (!call || call.faces) return;
    // One roll per call: the button dies the moment it is pressed, so a double
    // click cannot answer twice while the first roll is still in the air.
    (el as HTMLButtonElement).disabled = true;
    // The button was disabled a line above so the click cannot answer twice, so
    // a rejection here would leave the defender holding a dead button and the
    // attacker waiting on a roll that is never coming. Re-arm and say so.
    void ctx.rollDefense(call.white, call.blue).then((faces) => {
      ctx.send({ kind: 'answerDefense', seat: me(), faces });
      ctx.refresh();
    }).catch(() => {
      (el as HTMLButtonElement).disabled = false;
      ctx.noteNow('The dice did not come back. Nothing was recorded, so roll again.', 'system');
      ctx.refresh();
    });
  });
  on('[data-act="undomenu"]', () => {
    undoOpen = !undoOpen;
    ctx.refresh();
  });
  on('[data-rb]', (el) => {
    // Any press on the machinery puts the menu away: the next screen is either
    // the waiting panel or the board, and a pop left open over either is
    // clutter the quiet design exists to avoid.
    undoOpen = false;
    const what = el.dataset.rb;
    if (what === 'accept' || what === 'decline') {
      ctx.send({ kind: 'rollbackAnswer', seat: me(), accept: what === 'accept' });
      if (what === 'decline') ctx.noteNow('Rollback declined. The board stands.', 'done');
      ctx.refresh();
      return;
    }
    if (what === 'cancel') {
      // Withdrawing is declining your own ask. check() allows exactly that and
      // still refuses the asker APPROVING it, which is where consent matters.
      ctx.send({ kind: 'rollbackAnswer', seat: me(), accept: false });
      ctx.refresh();
      return;
    }
    // A UNIT ask (v2): the seq names the exact catalog entry, and the label
    // rides along so the other player's consent screen can say what it undoes.
    if (what === 'u') {
      const seq = Number(el.dataset.seq);
      const r = Number(el.dataset.round);
      const ph = Number(el.dataset.phase);
      if (!Number.isInteger(seq) || !Number.isInteger(r) || !Number.isInteger(ph)) return;
      ctx.send({ kind: 'rollbackRequest', seat: me(), round: r, phase: ph, seq, label: el.dataset.label || 'the last action' });
      ctx.refresh();
      return;
    }
    // Otherwise it names a target: "round:phase".
    const [r, ph] = (what ?? '').split(':').map(Number);
    if (!Number.isInteger(r) || !Number.isInteger(ph)) return;
    ctx.send({ kind: 'rollbackRequest', seat: me(), round: r, phase: ph, label: `round ${r}, ${PHASES[ph]} Phase` });
    ctx.refresh();
  });
  on('[data-stab]', (el) => {
    const m = stabilisePick;
    const t = m ? s.tokens.find((x) => x.uid === m.uid) : undefined;
    stabilisePick = null;
    if (!m || !t) { dropAction(); ctx.refresh(); return; }
    const id = el.dataset.stab ?? '';
    const ask = stabiliseAsk(ctx.data, t);
    const p = ask.picks.find((x) => x.id === id);
    if (id !== '__keep' && !p) { dropAction(); ctx.refresh(); return; }
    const cmd: Command = turn.stabiliseCommand(t, p ?? null);
    // Judged before the Tick is paid, so a refusal costs nothing.
    const v0 = ctx.check(cmd);
    if (!v0.ok) { ctx.noteNow(v0.why ?? 'Stabilize System was refused.'); dropAction(); ctx.refresh(); return; }
    const paid = commitAction(ctx);
    if (!paid.ok) { if (paid.why) ctx.noteNow(paid.why); ctx.refresh(); return; }
    const v = ctx.send(cmd);
    ctx.noteNow(!v.ok ? (v.why ?? 'Stabilize System was refused.')
      : p ? `Stabilize System: ${p.label} removed${ask.keep ? `, and Link restored to ${t.link}` : ''}.`
        : `Stabilize System: Link restored to ${t.link}.`, v.ok ? 'done' : 'refused');
    ctx.refresh();
  });
  on('[data-act="stabcancel"]', () => { stabilisePick = null; dropAction(); ctx.refresh(); });
  // Link support: every Ally Mech in reach ('all'), or the one picked.
  const restoreLinkTo = (targets: Token[]): void => {
    const m = linkPick;
    const from = m ? s.tokens.find((x) => x.uid === m.uid) : undefined;
    const a = m && from ? actionOn(ctx, from, m.actionId) : undefined;
    linkPick = null;
    if (!m || !from || !a) { dropAction(); ctx.refresh(); return; }
    const paid = commitAction(ctx);
    if (!paid.ok) { if (paid.why) ctx.noteNow(paid.why); ctx.refresh(); return; }
    const what = a.name?.en || a.id;
    const done: string[] = [];
    for (const x of targets) {
      let n = 0;
      for (let i = 0; i < m.rule.amount; i++) if (ctx.send({ kind: 'recoverLink', seat: from.side, uid: from.uid, targetUid: x.uid, actionId: a.id }).ok) n++;
      if (n) done.push(`${x.label} to ${x.link}${x.stance === 'shutdown' ? ' (still Shutdown)' : ''}`);
    }
    ctx.noteNow(done.length ? `${what}: Link restored - ${done.join(', ')}.` : `${what}: no Ally Mech in range was short of Link.`, 'done');
    ctx.refresh();
  };
  on('[data-act="linkgo"]', () => {
    const m = linkPick;
    const from = m ? s.tokens.find((x) => x.uid === m.uid) : undefined;
    const a = m && from ? actionOn(ctx, from, m.actionId) : undefined;
    restoreLinkTo(m && from && a ? linkSupportTargets(ctx.data, s.tokens, from, a) : []);
  });
  on('[data-linkto]', (el) => {
    const to = s.tokens.find((x) => x.uid === Number(el.dataset.linkto));
    restoreLinkTo(to ? [to] : []);
  });
  on('[data-act="linkcancel"]', () => { linkPick = null; dropAction(); ctx.refresh(); });
  // Token cleanup: the unit, then the Token (asked only when there is a choice).
  on('[data-cleanunit]', (el) => {
    if (!cleanPick) return;
    const unit = s.tokens.find((x) => x.uid === Number(el.dataset.cleanunit));
    if (!unit) { ctx.refresh(); return; }
    const picks = removableTokens(unit, [cleanPick.rule.shape]);
    if (picks.length === 1) { cleanTokenOff(unit, picks[0].id); return; }
    cleanPick = { ...cleanPick, targetUid: unit.uid };
    ctx.refresh();
  });
  on('[data-cleantok]', (el) => {
    const unit = cleanPick?.targetUid !== undefined ? s.tokens.find((x) => x.uid === cleanPick!.targetUid) : undefined;
    if (unit) cleanTokenOff(unit, el.dataset.cleantok ?? '');
  });
  const cleanTokenOff = (unit: Token, pickId: string): void => {
    const m = cleanPick;
    const from = m ? s.tokens.find((x) => x.uid === m.uid) : undefined;
    const a = m && from ? actionOn(ctx, from, m.actionId) : undefined;
    cleanPick = null;
    const p = m ? removableTokens(unit, [m.rule.shape]).find((x) => x.id === pickId) : undefined;
    if (!m || !from || !a || !p) { dropAction(); ctx.refresh(); return; }
    const cmd: Command = { kind: 'removeStatus', seat: from.side, uid: from.uid, targetUid: unit.uid, statusId: p.statusId, ...(p.face ? { face: p.face } : {}) };
    const v0 = ctx.check(cmd);
    if (!v0.ok) { ctx.noteNow(v0.why ?? 'That Token could not be removed.'); dropAction(); ctx.refresh(); return; }
    const paid = commitAction(ctx);
    if (!paid.ok) { if (paid.why) ctx.noteNow(paid.why); ctx.refresh(); return; }
    if (ctx.send(cmd).ok) ctx.noteNow(`${a.name?.en || a.id}: ${p.label} removed from ${unit.label}.`, 'done');
    ctx.refresh();
  };
  on('[data-act="cleancancel"]', () => { cleanPick = null; dropAction(); ctx.refresh(); });
  on('[data-aster]', (el) => {
    const t = s.tokens.find((x) => x.uid === Number(el.dataset.aster));
    if (!t) return;
    void runAster(ctx.data, s, t.uid, (targetUid) => {
      ctx.send({ kind: 'asterRestore', seat: t.side, uid: t.uid, targetUid });
      ctx.refresh();
    }, (_to, text) => ctx.noteNow(text, 'done'));
  });
  on('[data-doact]', (el) => {
    if (el.dataset.why) { ctx.noteNow(el.dataset.why); ctx.refresh(); return; }
    const sc = ensureScript(s);
    const t = sc.opp ? s.tokens.find((x) => x.uid === sc.opp!.uid) : undefined;
    if (t) {
      // An Action that grants an Extra Action Opportunity asks who takes it,
      // the same question the guide asks in its dialog. Everything else about
      // what the Action opens is routeAction's job, mirroring performGuided.
      const act = guidedActions(ctx.data, t, { tokens: s.tokens, terrain: terrainOf(ctx) })
        .find((g) => g.partKey === el.dataset.doact || g.action.id === el.dataset.doact);
      const performed = act?.action ?? ctx.data.commonActions.find((a) => a.id === actionIdOf(el.dataset.doact ?? ''));
      // The command that pays for it is built in turn.ts (actionPayment),
      // where a computer seat's is built too. Legality is read now, but nothing
      // is spent: the Ticks wait in pendingAction until the Action's tool
      // actually does something, so a misclick that gets cancelled leaves the
      // Opportunity intact.
      if (performed) {
        const pay = turn.actionPayment(ctx.data, ctx.state, t, performed, el.dataset.doact!);
        if (!pay.ok) {
          if (pay.why) ctx.noteNow(pay.why);
          ctx.refresh();
          return;
        }
        if (pay.cmd) pendingAction = pay.cmd;
      }
      const grant = act ? extraActivationOf(act.action) : undefined;
      if (grant) grantPick = { from: t.uid, grant };
      // No tool to wait on means the Action is already done, so it pays now.
      if (!performed || !routeAction(ctx, t, performed, act)) {
        const paid = commitAction(ctx);
        // Reveal does more than spend a Tick, and the work lives in its own
        // command: it leaves the Optical Camouflage State. Stabilize used to be
        // handled here too, after the Tick was paid; routeAction asks it first
        // now, so a Cancel costs nothing.
        if (paid.ok && el.dataset.doact === 'COMMON_REVEAL') {
          // The Reveal itself is only sent once Manifestation is settled: the
          // two are one event under 4.12.2, so the destination rides the same
          // command rather than following it.
          openManifest(ctx, t, 'Reveal:');
        }
      }
    }
    ctx.refresh();
  });
  on('[data-grant]', (el) => {
    if (el.dataset.why) { ctx.noteNow(el.dataset.why); ctx.refresh(); return; }
    const pick = s.tokens.find((x) => x.uid === Number(el.dataset.grant));
    if (pick && grantPick) {
      ctx.send({ kind: 'grantExtra', seat: pick.side, uid: pick.uid, linkCost: grantPick.grant.linkCost });
    }
    grantPick = null;
    ctx.refresh();
  });
  on('[data-act="grantcancel"]', () => { grantPick = null; ctx.refresh(); });
  // Stopping early is still a finished launch, so anything already placed owes
  // its Interceptions; cancelling with nothing down owes none.
  on('[data-act="launchcancel"]', () => finishLaunchPlan(ctx));
  on('[data-launchface]', (el) => {
    if (launchPlan) launchPlan = { ...launchPlan, facing: Number(el.dataset.launchface) as Facing };
    ctx.refresh();
  });
  on('[data-act="launchundo"]', () => undoLaunched(ctx));
  on('[data-launchpick]', (el) => {
    const m = launchPick;
    launchPick = null;
    const c = ctx.data.byId.get(el.dataset.launchpick!);
    if (m && c) startLaunchPlan(m.uid, m.actionId, c.id, c.name?.en || c.id);
    ctx.refresh();
  });
  on('[data-act="launchpickcancel"]', () => { launchPick = null; dropAction(); ctx.refresh(); });
  // A Container named as the target (Supplementary Rules 1.04, 3.1): the
  // Action is paid as for any target, and Breakable destroys the piece with no
  // roll. Read again before paying, from the same adjusted Action the row was
  // drawn with, so a board changed since costs nothing.
  on('[data-attackbox]', (el) => {
    const m = attackPick;
    if (!m) return;
    const s = ctx.state;
    const by = s.tokens.find((x) => x.uid === m.uid);
    const raw = by ? actionOn(ctx, by, m.actionId) : undefined;
    const opp0 = ensureScript(s).opp;
    const steadied = raw ? stationaryAdjusted(raw, opp0?.uid === by?.uid ? opp0 : null) : undefined;
    const granted = by && steadied ? grantAdjusted(steadied, by, opp0?.uid === by.uid ? opp0 : null) : steadied;
    const a = by && granted ? handsFor(ctx, by, granted, m.twoHanded).action : granted;
    const id = el.dataset.attackbox!;
    if (!by || !a || !containerTargets(ctx.data, s.tokens, terrainOf(ctx), by, a, s.smoke ?? []).some((b) => b.id === id)) {
      ctx.noteNow('That Container is no longer in this Action\'s reach and sight.');
      ctx.refresh();
      return;
    }
    attackPick = null;
    const paid = commitAction(ctx);
    if (!paid.ok) { if (paid.why) ctx.noteNow(paid.why); ctx.refresh(); return; }
    if (ctx.send({ kind: 'destroyTerrain', seat: by.side, uid: by.uid, pieces: [id] }).ok) {
      ctx.noteNow(`${by.label} targets ${terrainLabel(ctx, id)}, a Container: Breakable, so it is destroyed with no roll (Supplementary Rules 1.04, 3.1).`, 'done');
    }
    ctx.refresh();
  });
  on('[data-attacktarget]', (el) => {
    if (el.dataset.why) { ctx.noteNow(el.dataset.why); ctx.refresh(); return; }
    const m = attackPick;
    if (m) {
      // The greyed row is the gate; this re-check is for a stale panel,
      // where the board changed after the rows were drawn. Recomputed rather
      // than trusted, and BEFORE commitAction so a refused attack costs
      // nothing.
      const s = ctx.state;
      const by = s.tokens.find((x) => x.uid === m.uid);
      const t = s.tokens.find((x) => x.uid === Number(el.dataset.attacktarget));
      const raw = by ? actionOn(ctx, by, m.actionId) : undefined;
      const opp0 = ensureScript(s).opp;
      const steadied = raw ? stationaryAdjusted(raw, opp0?.uid === by?.uid ? opp0 : null) : undefined;
      const granted = by && steadied ? grantAdjusted(steadied, by, opp0?.uid === by.uid ? opp0 : null) : steadied;
      const a = by && granted ? handsFor(ctx, by, granted, m.twoHanded).action : granted;
      // A target in Optical Camouflage: the designation earns one FREE Scan
      // first (4.12.2, FAQ I12). The Tick is paid now - the attack is declared
      // - and the Counter-roll carries the attack behind it: a success owes this
      // seat a `scanAttack` reaction once the target has appeared, a failure
      // ends the attack (I11). Asked of the command before paying, so a Mech
      // that cannot Scan (Electronic Value 0) keeps its Tick and is told why.
      if (by && t && statusCount(t.statuses, 'camouflage') > 0) {
        // The declaration's answers ride along, or the resumed attack loses a
        // Charge already spent for it and a declined [Two-Handed] (Phase 2, C7).
        const scan: Command = {
          kind: 'startCounterRoll', seat: by.side, uid: by.uid, actionId: 'COMMON_SCAN', targetUid: t.uid,
          thenAttack: {
            actionId: m.actionId,
            ...(m.refund ? { charged: true } : {}),
            ...(m.refund?.choice ? { chargeChoice: m.refund.choice } : {}),
            ...(m.twoHanded === 'declined' ? { twoHandedDeclined: true } : {}),
          },
        };
        const can = checkPaid(ctx, scan);
        if (!can.ok) {
          ctx.noteNow(`${by.label} cannot Scan ${t.label}, so it cannot attack it while it is in Optical Camouflage (4.12.2). ${can.why ?? ''}`);
          ctx.refresh();
          return;
        }
        attackPick = null;
        const paid = commitAction(ctx);
        if (!paid.ok) { if (paid.why) ctx.noteNow(paid.why); ctx.refresh(); return; }
        if (ctx.send(scan).ok) ctx.noteNow(`${by.label} designates ${t.label}, which is in Optical Camouflage: one free Scan first (4.12.2, FAQ I12).`, 'done');
        ctx.refresh();
        return;
      }
      // Same reading the row was drawn from, strict and through the effective
      // reach, so the re-check cannot disagree with the gate it is backing up.
      // The pick's own rules first: a Riposte's one target (FAQ C1), and a
      // Link Shock's Tethered one, which also waives the board's reading.
      if (t && ((m.only !== undefined && t.uid !== m.only) || (a && by && linkShockOf(a) && !tetheredBy(by, t)))) {
        ctx.noteNow(m.only !== undefined
          ? 'A Riposte answers the Mech that was parried, and no one else (FAQ C1).'
          : 'Link Shock can only be used against a target Tethered by this unit (PDRH-202).');
        ctx.refresh();
        return;
      }
      const note = by && t && a
        ? losNote(by, t, { ...a, range: actionRange(ctx.data, s.tokens, by, a), anyDistance: linkShockOf(a) },
            terrainOf(ctx), s.tokens, s.smoke ?? [], true)
        : '';
      // Read off the refusals alone: the note's own "adjacent (R1)" made a
      // Punch stopped by a wall read as out of Range (audit Phase 7, P7B 1).
      const bad = note.split(' · ').filter((x) => x.startsWith('✕')).join(' · ');
      if (bad) {
        // Which of the two it was, because "cannot be made" with no reason is
        // the kind of refusal a player argues with.
        ctx.noteNow(bad.includes('Aerial')
          ? `${t?.label ?? 'That target'} is an Aerial unit, and a Melee Action may not target one (4.4.1).`
          : bad.includes('NOT in forward arc')
          ? `${t?.label ?? 'That target'} is outside the Forward Arc, so the attack cannot be made (4.2.5).`
          : bad.includes('range') || bad.includes('adjacent')
          ? `${t?.label ?? 'That target'} is outside this Action's Range, so the attack cannot be made (4.4.1).`
          : bad.includes('Melee needs line of sight')
          ? `3" terrain blocks the line of sight to ${t?.label ?? 'that target'}, and a Melee Action needs it (4.6), so the attack cannot be made.`
          : 'Line of sight is blocked, so this attack cannot be made (4.4.1).');
        ctx.refresh();
        return;
      }
    }
    attackPick = null;
    if (m) {
      if (m.twoHanded === 'declined' && pendingAction?.kind === 'performAction') pendingAction = { ...pendingAction, twoHanded: false };
      commitAction(ctx);
      // A Charge spent for this attack is its refund: the window folds the
      // [Charged] line in only when it was (chargeAdjusted).
      ctx.startAttack(m.uid, m.actionId, Number(el.dataset.attacktarget), 'attack', { twoHandedDeclined: m.twoHanded === 'declined', charged: !!m.refund, chargeChoice: m.refund?.choice });
    }
    ctx.refresh();
  });
  // FAQ A16: the [Two-Handed] designation may be declined. A switch on the
  // picker rather than a question, because seeing the rows redraw with the
  // one-handed Range IS the decision.
  on('[data-act="twohanded"]', () => {
    if (attackPick) attackPick = { ...attackPick, twoHanded: attackPick.twoHanded === 'declined' ? undefined : 'declined' };
    ctx.refresh();
  });
  on('[data-act="attackcancel"]', () => {
    refundCharge(ctx, attackPick?.refund);
    attackPick = null;
    dropAction();
    ctx.refresh();
  });
  // The order chips open a unit's card, which is what the Activation order rows
  // in the squads panel did before they moved onto the board. Selection only:
  // a chip is a way to LOOK at a unit, never a way to act out of turn.
  on('[data-orderchip]', (el) => {
    const t = ctx.state.tokens.find((x) => x.uid === Number(el.dataset.orderchip));
    inspectUid = t ? t.uid : null;
    ctx.refresh();
  });

  // ---------- Electronic Warfare (4.11) ----------
  on('[data-ewtarget]', (el) => {
    if (el.dataset.why) { ctx.noteNow(el.dataset.why); ctx.refresh(); return; }
    const m = ewPick;
    const by = m ? s.tokens.find((x) => x.uid === m.uid) : undefined;
    if (m && by) {
      // Asked before the Tick is paid, so a refused target costs nothing.
      const open = turn.electronicOpening(by, m.actionId, Number(el.dataset.ewtarget));
      const can = checkPaid(ctx, open);
      if (!can.ok) { ctx.noteNow(can.why ?? 'That Counter-roll cannot be opened.'); ctx.refresh(); return; }
      ewPick = null;
      commitAction(ctx);
      ctx.send(open);
    } else {
      ewPick = null;
    }
    ctx.refresh();
  });
  on('[data-act="ewcancel"]', () => {
    refundCharge(ctx, ewPick?.refund);
    ewPick = null;
    dropAction();
    ctx.refresh();
  });
  // The Counter-roll's own presses are NOT wired here any more. They live in
  // the combat window with the dice they belong to, and contestAct answers all
  // of them in one place -- see syncContest. A second set here is how the two
  // surfaces would come to disagree about what a Focus costs.
  on('[data-tactic]', (el) => {
    if (el.dataset.why) { ctx.noteNow(el.dataset.why); ctx.refresh(); return; }
    const [side, id] = el.dataset.tactic!.split(':');
    startTactic(ctx, side as Side, id);
    ctx.refresh();
  });
  on('[data-tacticunit]', (el) => {
    if (tacticPlan) tacticPlan.uid = Number(el.dataset.tacticunit);
    advanceTactic(ctx);
    ctx.refresh();
  });
  on('[data-tacticpick]', (el) => playTactic(ctx, el.dataset.tacticpick!));
  on('[data-act="tacticcancel"]', () => { tacticPlan = null; ctx.refresh(); });
  on('[data-chargeslot]', (el) => {
    if (el.dataset.why) { ctx.noteNow(el.dataset.why); ctx.refresh(); return; }
    const m = chargePlan;
    const t = m ? s.tokens.find((x) => x.uid === m.uid) : undefined;
    chargePlan = null;
    if (m && t) {
      const slot = el.dataset.chargeslot!;
      const part = SLOT_LABEL[slot as PartSlot] ?? slot;
      if (m.on) {
        // Charging is the whole Action, and its own command turns the token
        // face-up (ruled R2; audit Phase 7, P7A 7): this page flipped it after
        // a payment it never checked, so a refused repeat was a free Charge.
        // The shared Charge Action is keyed to the Part charged (FAQ H6/H7;
        // audit Phase 2, E7); a Drone's own Charge (543_B) Charges its hull.
        if (pendingAction?.kind === 'performAction') pendingAction = turn.chargePayment(pendingAction, slot);
        const paid = commitAction(ctx);
        if (paid.ok) ctx.noteNow(`${t.label}: the Charge Token on its ${part} is now face-up.`, 'done');
        else ctx.noteNow(paid.why ?? 'The Charge was refused.');
      } else if (ctx.send({ kind: 'setCharge', seat: t.side, uid: t.uid, slot, on: false }).ok) {
        // Spending is the run-up to an attack, and that attack is the tool the
        // Ticks are waiting on.
        ctx.noteNow(`${t.label}: the Charge Token on its ${part} is spent.`, 'done');
      }
      const next = m.actionId ? actionOn(ctx, t, m.actionId) : undefined;
      // A SPEND (`!m.on`) is refundable if the attack it paid for is abandoned;
      // charging a Part face-up is an Action in its own right and is not. The
      // arm of an either/or line rides the refund to chargeAdjusted (E9).
      const choice = el.dataset.choice || undefined;
      if (next) openAttackPick(t, next, m.on ? undefined : { uid: t.uid, slot, ...(choice ? { choice } : {}) }, false, m.only);
    }
    ctx.refresh();
  });
  // Keeping the Charge Token still leaves the attack to make; cancelling the
  // Charge Action itself gives the Ticks back.
  on('[data-act="chargecancel"]', () => {
    const m = chargePlan;
    const t = m ? s.tokens.find((x) => x.uid === m.uid) : undefined;
    chargePlan = null;
    const next = m?.actionId && t ? actionOn(ctx, t, m.actionId) : undefined;
    if (next && t) openAttackPick(t, next, undefined, false, m?.only);
    else dropAction();
    ctx.refresh();
  });
  // The Discard names its Part, and the Action's own command turns it over
  // (ruled R2; audit Phase 7, P7A 2). Keyed to the hand, so the other hand may
  // Discard too (audit Phase 2, E7).
  on('[data-discardslot]', (el) => {
    if (el.dataset.why) { ctx.noteNow(el.dataset.why); ctx.refresh(); return; }
    const m = discardPick;
    const t = m ? s.tokens.find((x) => x.uid === m.uid) : undefined;
    discardPick = null;
    const slot = el.dataset.discardslot as PartSlot | undefined;
    if (t && slot && pendingAction?.kind === 'performAction' && pendingAction.actionId === 'COMMON_DISCARD') {
      pendingAction = { ...pendingAction, partKey: `COMMON_DISCARD@${slot}` };
      const was = t.mech?.[slot];
      const paid = commitAction(ctx);
      const now = paid.ok && t.mech?.[slot] !== was ? ctx.data.byId.get(t.mech?.[slot] ?? '') : undefined;
      if (now) ctx.noteNow(`${t.label} Discards: the ${SLOT_LABEL[slot]} is now ${cardName(now)}.`, 'done');
      else if (!paid.ok) ctx.noteNow(paid.why ?? 'The Discard was refused.');
    } else {
      dropAction();
    }
    ctx.refresh();
  });
  on('[data-act="discardcancel"]', () => { discardPick = null; dropAction(); ctx.refresh(); });
  on('[data-resupply]', (el) => {
    const m = resupplyPick;
    const to = s.tokens.find((x) => x.uid === Number(el.dataset.resupply));
    resupplyPick = null;
    if (m && to) {
      const max = tokenCards(ctx.data, to).flatMap(({ card }) => card.actions ?? []).find((a) => a.id === m.rule.actionId)?.storage ?? 0;
      commitAction(ctx);
      // The command caps at the printed Storage, so the count is read back
      // rather than assumed.
      if (ctx.send({ kind: 'restoreAmmo', seat: to.side, uid: to.uid, actionId: m.rule.actionId, amount: m.rule.amount }).ok) {
        ctx.noteNow(`Resupply: ${to.label} is back to Ammo ${to.ammo?.[m.rule.actionId] ?? 0}/${max}.`, 'done');
      }
    }
    ctx.refresh();
  });
  on('[data-act="resupplycancel"]', () => { resupplyPick = null; dropAction(); ctx.refresh(); });
  on('[data-terminal]', (el) => {
    const m = terminalPick;
    terminalPick = null;
    const t = m ? s.tokens.find((x) => x.uid === m.uid) : undefined;
    const itemId = el.dataset.terminal;
    if (m && t && itemId) {
      // The attempt is made whatever the roll, so the Action pays first, as
      // freeplay's does; then the Counter-roll opens in the shared window,
      // joined to the payment for Undo. A refused opening says why.
      const paid = commitAction(ctx);
      if (!paid.ok) {
        if (paid.why) ctx.noteNow(paid.why);
      } else {
        const v = ctx.send({ kind: 'startCounterRoll', seat: t.side, uid: t.uid, actionId: m.actionId, targetUid: TERMINAL_UID, terminal: itemId, chain: 'join' });
        if (!v.ok) ctx.noteNow(v.why ?? 'The Remote Access roll could not open.');
      }
    }
    ctx.refresh();
  });
  on('[data-act="terminalcancel"]', () => { terminalPick = null; dropAction(); ctx.refresh(); });
  on('[data-repairgo]', (el) => {
    const m = repairPick;
    repairPick = null;
    const t = m ? s.tokens.find((x) => x.uid === m.uid) : undefined;
    if (!m || !t) { ctx.refresh(); return; }
    const [mode, slot, ally] = (el.dataset.repairgo ?? '').split(':');
    commitAction(ctx);
    if (ally) {
      const to = s.tokens.find((x) => x.uid === Number(ally));
      if (ctx.send({ kind: 'repairPart', seat: t.side, uid: t.uid, slot, mode: 'mend', targetUid: Number(ally), actionId: m.actionId }).ok) {
        ctx.noteNow(`${to?.label ?? 'The ally'}: ${SLOT_LABEL[slot as PartSlot | 'main'] ?? slot} is mended back to intact${m.removeSelf ? `, and ${t.label} is removed` : ''}.`, 'done');
      }
      ctx.refresh();
      return;
    }
    if (ctx.send({ kind: 'repairPart', seat: t.side, uid: t.uid, slot, mode: mode as 'repaired' | 'mend' }).ok) {
      ctx.noteNow(mode === 'mend'
        ? `${t.label}: ${SLOT_LABEL[slot as PartSlot | 'main']} is mended back to intact.`
        : `${t.label}: ${SLOT_LABEL[slot as PartSlot | 'main']} takes a Repaired Token - its Actions return, but it stays destroyed for Integrity (J21).`, 'done');
    }
    ctx.refresh();
  });
  on('[data-act="repaircancel"]', () => { repairPick = null; dropAction(); ctx.refresh(); });
  on('[data-formgo]', (el) => {
    const m = formPick;
    formPick = null;
    const t = m ? s.tokens.find((x) => x.uid === m.uid) : undefined;
    if (!m || !t) { ctx.refresh(); return; }
    const cardId = el.dataset.formgo ?? '';
    // The Action is paid before the switch, the same order every other tool
    // uses - and the Movement that follows belongs to the same Action, so it
    // opens the planner rather than costing a second Tick.
    const paid = commitAction(ctx);
    if (!paid.ok) {
      if (paid.why) ctx.noteNow(paid.why);
      ctx.refresh();
      return;
    }
    if (ctx.send({ kind: 'switchForm', seat: t.side, uid: t.uid, actionId: m.actionId, cardId }).ok) {
      ctx.noteNow(`${t.label} switches to ${cardName(ctx.data.byId.get(cardId))}. One Movement follows.`, 'done');
      startMovePlan(ctx, t, { label: 'Stance Change: Movement', actionId: m.actionId, free: true });
    }
    ctx.refresh();
  });
  on('[data-act="formcancel"]', () => { formPick = null; dropAction(); ctx.refresh(); });
  on('[data-act="shockmove"]', () => {
    const m = shockPick;
    shockPick = null;
    const t = m ? s.tokens.find((x) => x.uid === m.uid) : undefined;
    if (!m || !t) { ctx.refresh(); return; }
    // The walk belongs to the Action, and the command layer only allows a free
    // move once its Action has been PERFORMED this Opportunity - so the Action
    // pays here, before the maneuver travels. Same order the Stance Change
    // uses, and the reason cancelling the later targeting cannot refund it.
    const paid = commitAction(ctx);
    if (!paid.ok) {
      if (paid.why) ctx.noteNow(paid.why);
      refundCharge(ctx, m.refund);
      ctx.refresh();
      return;
    }
    startMovePlan(ctx, t, {
      label: `Shock Attack: up to ${m.x}`,
      actionId: m.actionId,
      range: m.x,
      free: true,
      attackAfter: { actionId: m.actionId, refund: m.refund },
    });
    // If the planner refused to open (a gate it checks itself), the paid attack
    // must still happen - fall straight through to the targeting.
    if (!movePlan) resumeShockAttack(ctx, t.uid, { actionId: m.actionId, refund: m.refund });
    ctx.refresh();
  });
  on('[data-act="shockskip"]', () => {
    const m = shockPick;
    shockPick = null;
    const t = m ? s.tokens.find((x) => x.uid === m.uid) : undefined;
    if (m && t) {
      const a = actionOn(ctx, t, m.actionId);
      if (a) openAttackPick(t, a, m.refund, true);
    }
    ctx.refresh();
  });
  on('[data-act="shockcancel"]', () => {
    refundCharge(ctx, shockPick?.refund);
    shockPick = null;
    dropAction();
    ctx.refresh();
  });
  on('[data-manifest]', (el) => {
    const m = manifestPick;
    manifestPick = null;
    const t = m ? s.tokens.find((x) => x.uid === m.uid) : undefined;
    if (!m || !t) { ctx.refresh(); return; }
    const [col, row] = (el.dataset.manifest ?? '').split(',').map(Number);
    const g = { c: Math.floor(col / 3), r: Math.floor(row / 3) };
    if (ctx.send({ kind: 'reveal', seat: t.side, uid: t.uid, to: { col, row }, facing: m.facing }).ok) {
      ctx.noteNow(`${m.why} ${t.label} leaves the Optical Camouflage State and Manifests to ${gridName(g.c, g.r)} (4.12.2).`, 'done');
    }
    ctx.refresh();
  });
  on('[data-manifestface]', (el) => {
    if (!manifestPick) return;
    manifestPick = { ...manifestPick, facing: Number(el.dataset.manifestface) as Facing };
    ctx.refresh();
  });
  on('[data-act="manifeststay"]', () => {
    const m = manifestPick;
    manifestPick = null;
    const t = m ? s.tokens.find((x) => x.uid === m.uid) : undefined;
    if (!m || !t) { ctx.refresh(); return; }
    if (ctx.send({ kind: 'reveal', seat: t.side, uid: t.uid }).ok) {
      ctx.noteNow(`${m.why} ${t.label} leaves the Optical Camouflage State where its marker stood (4.12.2).`, 'done');
    }
    ctx.refresh();
  });
  on('[data-act="crushauto"]', () => {
    const m = crushPlan;
    const v = m ? s.tokens.find((x) => x.uid === m.queue[0]) : undefined;
    if (!m || !v) { advanceCrush(ctx); ctx.refresh(); return; }
    const out = crushEscapes(ctx, v, m);
    // The auto path completes the whole placement, facing left as it stands.
    // With no escape Grid there is nothing to pick FOR the player: advanceCrush
    // opens the 4.3.6 exchange and its facing question instead.
    if (out.length) { placeCrushed(ctx, out[0].c, out[0].r); confirmCrushed(ctx); }
    else { advanceCrush(ctx); ctx.refresh(); }
  });
  on('[data-act="smokestop"]', () => finishSmokePlan(ctx));
  on('[data-reactgo]', (el) => answerReaction(ctx, el.dataset.reactgo!, true));
  on('[data-reactskip]', (el) => answerReaction(ctx, el.dataset.reactskip!, false));
  // ---------- Forced Movement ----------
  on('[data-shovepick]', (el) => {
    if (shovePlan) shovePlan = { ...shovePlan, targetUid: Number(el.dataset.shovepick) };
    ctx.refresh();
  });
  on('[data-act="shovego"]', () => resolveShove(ctx));
  on('[data-act="shovecancel"]', () => { shovePlan = null; flushBoxDrops(); ctx.refresh(); });
  // Riposte. The `riposte` command ends the attacker's Opportunity; the Melee
  // then rides the ordinary attack pick with `granted` set, and the debt is
  // spent by that Action's own apply.
  // The Red Shoes: draw the steered unit's route on the board. The debt is
  // spent by the controlledMove the route commits, not here, so a cancelled
  // route leaves the question standing.
  on('[data-controlgo]', (el) => {
    const [ctlRaw, targetRaw, actionId] = (el.dataset.controlgo ?? '').split(':');
    const ctl = s.tokens.find((x) => x.uid === Number(ctlRaw));
    const target = s.tokens.find((x) => x.uid === Number(targetRaw));
    if (!ctl || !target) { ctx.refresh(); return; }
    const a = actionId ? actionOn(ctx, target, actionId) : undefined;
    startMovePlan(ctx, target, {
      controller: { uid: ctl.uid, side: ctl.side },
      ...(a ? {
        actionId: a.id,
        range: a.range || undefined,
        label: `The Red Shoes: ${a.name?.en || a.id} · Range ${a.range || maneuverRange(ctx.data, target)}`,
        airborne: isAirborneAction(a),
      } : { label: `The Red Shoes: ${target.label}'s Maneuver`, maneuver: true }),
    });
    ctx.refresh();
  });
  on('[data-overwatchgo]', (el) => {
    const [uidRaw, actionId] = (el.dataset.overwatchgo ?? '').split(':');
    const uid = Number(uidRaw);
    const t = s.tokens.find((x) => x.uid === uid);
    const r = (ensureScript(s).reactions ?? []).find((x) => x.uid === uid && x.kind === 'overwatch');
    if (!t || !r || !actionId) { ctx.refresh(); return; }
    // The designated enemy, and only it; the grant pays for the Action.
    pendingAction = { kind: 'performAction', seat: t.side, uid, actionId, granted: true };
    // A Charged gun may consume its token as on any door: 4.14 makes no
    // exception for a granted Action (ruled R8; audit Phase 7, P7A 11).
    const gun = guidedActions(ctx.data, t, { tokens: s.tokens, terrain: terrainOf(ctx) }).find((g) => g.action.id === actionId);
    if (gun?.charge?.charged) chargePlan = { uid, on: false, actionId, only: r.fromUid };
    else startAttackPick(uid, actionId, r.fromUid);
    ctx.refresh();
  });
  on('[data-owtarget]', (el) => {
    if (overwatchPick) overwatchPick = { ...overwatchPick, targetUid: Number(el.dataset.owtarget) };
    ctx.refresh();
  });
  on('[data-owmech]', (el) => {
    if (el.dataset.why) { ctx.noteNow(el.dataset.why); ctx.refresh(); return; }
    const m = overwatchPick;
    const kk9 = m ? s.tokens.find((x) => x.uid === m.uid) : undefined;
    if (!m || !kk9 || m.targetUid === undefined) { ctx.refresh(); return; }
    const call: Command = { kind: 'overwatch', seat: kk9.side, uid: kk9.uid, actionId: m.actionId, targetUid: m.targetUid, mechUid: Number(el.dataset.owmech) };
    const v = ctx.check(call);
    if (!v.ok) { ctx.noteNow(v.why ?? 'The strike was refused.'); ctx.refresh(); return; }
    // The KK9's Action is paid first, then the call removes it.
    const paid = commitAction(ctx);
    if (!paid.ok) { if (paid.why) ctx.noteNow(paid.why); ctx.refresh(); return; }
    const called = ctx.send(call).ok;
    overwatchPick = null;
    if (called) ctx.noteNow(`${kk9.label} calls an Overwatch Strike: the Mech fires from its own row, and ${kk9.label} is removed.`, 'done');
    ctx.refresh();
  });
  on('[data-act="owcancel"]', () => { overwatchPick = null; dropAction(); ctx.refresh(); });
  on('[data-ripostego]', (el) => {
    const [uidRaw, actionId] = (el.dataset.ripostego ?? '').split(':');
    const uid = Number(uidRaw);
    const t = s.tokens.find((x) => x.uid === uid);
    const r = (ensureScript(s).reactions ?? []).find((x) => x.uid === uid && x.kind === 'riposte');
    if (!t || !r) { ctx.refresh(); return; }
    // Only if that Opportunity is still the open one. Backing out of the target
    // pick and coming back would otherwise be refused here and strand the debt,
    // since the first press already ended it.
    if (ensureScript(s).opp?.uid === r.fromUid) {
      if (!ctx.send({ kind: 'riposte', seat: t.side, uid, fromUid: r.fromUid! }).ok) { ctx.refresh(); return; }
      ctx.noteNow(`${t.label} parried: the Action Opportunity ends at once (050 / ZHLA-202).`, 'done');
    }
    if (!actionId) {
      ctx.send({ kind: 'resolveReaction', seat: t.side, uid, actionId: r.actionId });
      ctx.refresh();
      return;
    }
    pendingAction = { kind: 'performAction', seat: t.side, uid, actionId, granted: true };
    // The attacker, and only the attacker (FAQ C1). The list used to offer
    // every enemy on the board.
    startAttackPick(uid, actionId, r.fromUid);
    ctx.refresh();
  });
  on('[data-minego]', (el) => {
    startDetonation(Number(el.dataset.minego), el.dataset.mineact ?? '');
    ctx.refresh();
  });
  on('[data-revealgo]', (el) => {
    const uid = Number(el.dataset.revealgo);
    const t = ctx.state.tokens.find((x) => x.uid === uid);
    if (!t) return;
    openManifest(ctx, t, 'Revealed:');
    ctx.refresh();
  });
  on('[data-crushface]', (el) => {
    if (!crushPlan?.pendingSpot) return;
    const v = el.dataset.crushface;
    crushPlan.pendingSpot.facing = v === '' ? undefined : (Number(v) as Facing);
    ctx.refresh();
  });
  on('[data-act="crushgo"]', () => confirmCrushed(ctx));
  on('[data-shoveface]', (el) => {
    if (!shovePlan) return;
    const v = el.dataset.shoveface;
    shovePlan = { ...shovePlan, facing: v === '' ? undefined : (Number(v) as Facing) };
    ctx.refresh();
  });
  on('[data-shovedir]', (el) => {
    if (!shovePlan) return;
    shovePlan = { ...shovePlan, dir: Number(el.dataset.shovedir) };
    ctx.refresh();
  });
  on('[data-act="shoveturn"]', () => {
    // A blocked Forced Movement may still turn the victim in place, the
    // forcing player choosing — or leaving — the facing (FAQ B4/B5).
    const m = shovePlan;
    const by = m ? ctx.state.tokens.find((x) => x.uid === m.uid) : undefined;
    const victim = m?.targetUid !== null && m ? ctx.state.tokens.find((x) => x.uid === m.targetUid) : undefined;
    shovePlan = null;
    if (by && victim && m?.facing !== undefined) {
      if (ctx.send({ kind: 'forceMove', seat: by.side, uid: by.uid, targetUid: victim.uid, to: { col: victim.col, row: victim.row }, facing: m.facing }).ok) ctx.noteNow(`${victim.label} could not be moved, but is turned to face ${['North', 'East', 'South', 'West'][m.facing]}.`, 'done');
    }
    flushBoxDrops();
    ctx.refresh();
  });
  // Knockback is no longer a button either: the helper's onKnockback fires when
  // the attack finishes and opens the Forced Movement panel itself.
  // ---------- Detonation (4.7.5) ----------
  // The Explosion is the same pipeline as any other attack, just with facing,
  // sight and Protection all out of scope (4.7.6).
  on('[data-dettarget]', (el) => {
    if (el.dataset.why) { ctx.noteNow(el.dataset.why); ctx.refresh(); return; }
    const proj = s.tokens.find((x) => x.uid === detonateNow?.uid);
    const target = s.tokens.find((x) => x.uid === Number(el.dataset.dettarget));
    const a = proj && detonateNow ? actionOn(ctx, proj, detonateNow.actionId) : undefined;
    if (!proj || !detonateNow || !target || !a) { ctx.refresh(); return; }
    // The card's own target rule (4.7.5; A5): the row is greyed, and a stale
    // press is refused here too.
    const inRange = unitsWithin(ctx, proj, a.range ?? 0).map((x) => x.t);
    const bar = detonationBar(s.tokens, proj, a, inRange, target);
    if (bar) { ctx.noteNow(`${target.label} is not this Detonation's target: ${bar}.`); ctx.refresh(); return; }
    // A Missile flies into its target's Grid first, and the flight owes
    // Interception at either end (A2). The Interception outranks this panel,
    // which comes back once it is resolved; picking the target again then goes
    // straight to the Explosion, if the Missile is still flying.
    const flight = detonateNow.flew !== target.uid ? turn.detonationFlight(ctx.data, s, proj, a, target) : null;
    if (flight) {
      ctx.send(flight.fly);
      detonateNow.flew = target.uid;
      if (flight.owed.length) {
        if (ctx.send({ kind: 'queueIntercepts', seat: proj.side, items: flight.owed }).ok) ctx.noteNow(`${proj.label} flies into ${target.label}'s Grid, and its flight owes ${flight.owed.length} Interception attempt${flight.owed.length === 1 ? '' : 's'} (4.9). If it survives, pick the target again.`, 'table');
        ctx.refresh();
        return;
      }
    }
    // An Unfolded Pholcus jumps into its target's Grid and blows up there (167;
    // FAQ I19). A Ground Unit's landing: nothing Intercepts it, and a Mine it
    // sets off there waits for its own blast (Supplementary Rules 1.04, 1.9).
    const jump = turn.detonationJump(proj, a, target);
    if (jump) {
      const jumped = ctx.send(jump);
      if (!jumped.ok) { ctx.noteNow(jumped.why ?? `${proj.label} cannot jump there.`); ctx.refresh(); return; }
      const held = minesOwed(ctx.data, ctx.state.tokens).filter((x) => x.heldBy === proj.uid).length;
      ctx.noteNow(`${proj.label} jumps into ${target.label}'s Grid${held
        ? ` and sets off ${held === 1 ? 'the Mine' : `${held} Mines`} there, which go off once its own blast is done (Supplementary Rules 1.04, 1.9)` : ''}.`, 'table');
    }
    // And the Explosion waits while that Interception is owed: a second press
    // opened it with every attempt still to make (4.9; audit Phase 7, P7D 5).
    const owed = liveIntercepts(s).filter((x) => x.targetUid === proj.uid).length;
    if (owed) {
      ctx.noteNow(`${proj.label} still owes ${owed} Interception attempt${owed === 1 ? '' : 's'} from its flight, which come${owed === 1 ? 's' : ''} first (4.9).`);
      ctx.refresh();
      return;
    }
    ctx.startAttack(proj.uid, detonateNow.actionId, target.uid, 'explosion');
    ctx.refresh();
  });
  // A camouflaged target: the Projectile Scans it first (p.71; A3). The
  // Counter-roll outranks this panel while it runs, and the panel comes back
  // with the result read off the board.
  on('[data-detscan]', (el) => {
    if (el.dataset.why) { ctx.noteNow(el.dataset.why); ctx.refresh(); return; }
    const proj = s.tokens.find((x) => x.uid === detonateNow?.uid);
    const uid = Number(el.dataset.detscan);
    if (!proj || !detonateNow) { ctx.refresh(); return; }
    const v = ctx.send({ kind: 'startCounterRoll', seat: proj.side, uid: proj.uid, actionId: 'COMMON_SCAN', targetUid: uid });
    if (!v.ok) ctx.noteNow(v.why ?? 'The Scan was refused.');
    else detonateNow.scanned = [...(detonateNow.scanned ?? []), uid];
    ctx.refresh();
  });
  on('[data-detterrain]', (el) => {
    const proj = s.tokens.find((x) => x.uid === detonateNow?.uid);
    if (proj && ctx.send({ kind: 'destroyTerrain', seat: proj.side, uid: proj.uid, pieces: [el.dataset.detterrain!] }).ok) {
      ctx.noteNow('A Container is Breakable: it is destroyed with no roll (Supplementary Rules 1.04, 3.1).', 'done');
      // It has taken something now, so a PK3 no longer stays.
      if (detonateNow) detonateNow.terrainHit = true;
    }
    ctx.refresh();
  });
  on('[data-detstatus]', (el) => { detonateStatus = el.dataset.detstatus!; ctx.refresh(); });
  on('[data-deteffect]', (el) => {
    const proj = s.tokens.find((x) => x.uid === detonateNow?.uid);
    const hit = s.tokens.find((x) => x.uid === Number(el.dataset.deteffect));
    if (proj && hit) {
      // Re-read at the press, not only when the rows were drawn.
      const act = actionOn(ctx, proj, detonateNow!.actionId);
      if (act && /line of sight|视线/i.test(detonationText(ctx, act))
        && losBetween(proj, hit, terrainOf(ctx), s.tokens) === 'blocked') {
        ctx.noteNow(`${hit.label} is out of ${proj.label}'s line of sight, and this effect needs it.`);
        ctx.refresh();
        return;
      }
      ctx.send({ kind: 'applyStatus', seat: proj.side, uid: proj.uid, targetUid: hit.uid, statusId: detonateStatus });
    }
    ctx.refresh();
  });
  // The Projectile is Destroyed whatever it achieved (4.7.5), so both the Done
  // and the Cancel path have to say which one happened.
  on('[data-act="detdone"]', () => {
    const proj = s.tokens.find((x) => x.uid === detonateNow?.uid);
    const now = detonateNow;
    detonateNow = null;
    // "All Units" includes the Neutral Containers (1.4.2): any still standing
    // in range goes with the blast.
    const a = proj && now ? actionOn(ctx, proj, now.actionId) : undefined;
    if (proj && a && explosionScope(a, ctx.data.actionTranslation(a.id)?.english ?? undefined) === 'all') {
      const left = fragileTerrainWithin(ctx, proj, a.range ?? 0).map((x) => x.piece.id);
      if (left.length && ctx.send({ kind: 'destroyTerrain', seat: proj.side, uid: proj.uid, pieces: left }).ok) {
        ctx.noteNow(`${proj.label} catches ${left.length === 1 ? 'the Container' : `${left.length} Containers`} in range as well: a Neutral Unit, destroyed with no roll (Supplementary Rules 1.04, 1.4.2, 3.1).`, 'done');
      }
    }
    if (proj) {
      if (ctx.send({ kind: 'despawn', seat: proj.side, uid: proj.uid, targetUid: proj.uid }).ok) ctx.noteNow(`${proj.label} detonated and is destroyed (4.7.5).`, 'done');
    }
    ctx.refresh();
  });
  on('[data-act="detcancel"]', () => {
    detonateNow = null;
    ctx.refresh();
  });
  // The PK3 with nothing to take stays on the board (GoF 1.021; A6).
  on('[data-act="detkeep"]', () => {
    const proj = s.tokens.find((x) => x.uid === detonateNow?.uid);
    detonateNow = null;
    if (proj) ctx.noteNow(`${proj.label} finds no target within Range and stays on the board (GoF 1.021).`, 'done');
    ctx.refresh();
  });
  on('[data-act="smokeauto"]', () => {
    const left = smokeOwedCells(s);
    if (left.length) removeOwedSmoke(ctx, left[0]);
  });

  // ---------- Interception (4.9) ----------
  // Taking an owed attempt spends the Token and clears the debt in one move, so
  // a refused spend must not leave the attempt struck off the list.
  on('[data-intercept]', (el) => {
    const item = owedItems(ctx)[Number(el.dataset.intercept)];
    const by = item ? s.tokens.find((x) => x.uid === item.uid) : undefined;
    const at = item ? s.tokens.find((x) => x.uid === item.targetUid) : undefined;
    if (!item || !by || !at) { ctx.refresh(); return; }
    // What the attempt sends is read in turn.ts (interceptPayment), where a
    // seat with no panel reads it too: the Token, and the debt settled apart
    // only when spending the Token has not already struck it off (B2).
    const order = turn.interceptPayment(ctx.data, s, item);
    if (!order || !ctx.send(order[0]).ok) { ctx.refresh(); return; }
    if (order[1]) ctx.send(order[1]);
    beginIntercept(ctx, by, item.actionId, at);
    ctx.refresh();
  });
  on('[data-inttarget]', (el) => {
    if (el.dataset.why) { ctx.noteNow(el.dataset.why); ctx.refresh(); return; }
    const pick = interceptPick;
    const by = pick ? s.tokens.find((x) => x.uid === pick.uid) : undefined;
    const at = s.tokens.find((x) => x.uid === Number(el.dataset.inttarget));
    if (!pick || !by || !at) { ctx.refresh(); return; }
    // The row is greyed when smoke takes every line; the Token is not spent
    // on a shot that cannot be made (FAQ F3).
    if (!interceptOwedAt(s, by.uid, actionIdOf(pick.actionId), at.uid) && smokeBlocks(by, at, s.smoke ?? [])) {
      ctx.noteNow(`Every line from ${by.label} to ${at.label} crosses a Smoke Screen, and an Interception is a Firing Action (4.16, FAQ F3).`);
      ctx.refresh();
      return;
    }
    const paid = ctx.send({ kind: 'spendIntercept', seat: by.side, uid: by.uid, actionId: pick.actionId });
    if (!paid.ok) { ctx.refresh(); return; }
    // The same attempt may also be sitting in the owed list; paying it from the
    // card settles that debt too rather than leaving it to be asked again. Only
    // when it really is owed, though — sending it blind reports "That
    // Interception is not owed" over an attempt that was perfectly legal.
    const owedToo = ensureScript(s).intercepts.some(
      (x) => x.uid === by.uid && x.actionId === pick.actionId && x.targetUid === at.uid,
    );
    if (owedToo) ctx.send({ kind: 'resolveIntercept', seat: by.side, uid: by.uid, actionId: pick.actionId, targetUid: at.uid });
    beginIntercept(ctx, by, pick.actionId, at);
    ctx.refresh();
  });
  on('[data-act="interceptcancel"]', () => { interceptPick = null; ctx.refresh(); });
  on('[data-act="interceptskip"]', () => {
    ctx.send({ kind: 'clearIntercepts', seat: interceptSide(ctx) ?? me() });
    ctx.refresh();
  });
  // A target that survived obliges the SAME Part to try again until its Tokens
  // run out or the target dies (4.9), so the attempt goes back on the owed list
  // rather than being left to the players to remember.
  on('[data-act="interceptdone"]', () => {
    const f = interceptNow;
    interceptNow = null;
    if (f) {
      const by = s.tokens.find((x) => x.uid === f.uid);
      const at = s.tokens.find((x) => x.uid === f.targetUid);
      // Which of the four it is, and the attempt owed again, are read in
      // turn.ts (interceptAgain); the words are this page's.
      const next = turn.interceptAgain(ctx.data, s, f);
      const left = next.left;
      if (next.why === 'destroyed') {
        ctx.noteNow(`The target is destroyed, so the chain ends. ${left} Interception Token${left === 1 ? '' : 's'} left on that Part for the rest of the game.`, 'done');
      } else if (next.why === 'gone') {
        // The obligation died with the unit; nothing more is owed.
      } else if (next.why === 'spent') {
        ctx.noteNow(`${at!.label} survived, but ${by!.label} has spent every Interception Token on that Part and cannot try again (4.9).`, 'done');
      } else {
        if (ctx.send(next.command!).ok) ctx.noteNow(`${at!.label} survived, so ${by!.label} must Intercept again until its Tokens run out or the target is destroyed (4.9). ${left} left.`, 'table');
      }
    }
    ctx.refresh();
  });
  on('[data-depstance]', (el) => { deployStance = el.dataset.depstance as Stance; ctx.refresh(); });
  on('[data-depcamo]', () => { deployCamo = !deployCamo; ctx.refresh(); });
  on('[data-stance]', (el) => {
    const sc = ensureScript(s);
    const t = sc.opp ? s.tokens.find((x) => x.uid === sc.opp!.uid) : undefined;
    if (t) ctx.send({ kind: 'setStance', seat: t.side, uid: t.uid, stance: el.dataset.stance as Stance });
    ctx.refresh();
  });
  on('[data-reboot]', (el) => {
    const sc = ensureScript(s);
    const t = sc.opp ? s.tokens.find((x) => x.uid === sc.opp!.uid) : undefined;
    if (t) ctx.send({ kind: 'reboot', seat: t.side, uid: t.uid, stance: el.dataset.reboot as Stance });
    ctx.refresh();
  });
  on('[data-tiepick]', (el) => {
    const t = s.tokens.find((x) => x.uid === Number(el.dataset.tiepick));
    if (t && ctx.send({ kind: 'chooseTied', seat: t.side, uid: t.uid }).ok) {
      ctx.noteNow(`${t.label} takes the turn: Mechs tied on Timing and Initiative go in the order their squad picks.`, 'done');
    }
    ctx.refresh();
  });
  on('[data-act="firewatch"]', (el) => {
    if (el.dataset.why) { ctx.noteNow(el.dataset.why); ctx.refresh(); return; }
    const sc = ensureScript(s);
    const t = sc.opp ? s.tokens.find((x) => x.uid === sc.opp!.uid) : undefined;
    if (t && ctx.send({ kind: 'firewatch', seat: t.side, uid: t.uid }).ok) {
      ctx.noteNow(`${t.label}: Firewatch, 1 Link for a Command Token (Link now ${t.link}).`, 'done');
    }
    ctx.refresh();
  });
  on('[data-act="linktick"]', (el) => {
    if (el.dataset.why) { ctx.noteNow(el.dataset.why); ctx.refresh(); return; }
    const sc = ensureScript(s);
    const t = sc.opp ? s.tokens.find((x) => x.uid === sc.opp!.uid) : undefined;
    if (t && ctx.send({ kind: 'linkTick', seat: t.side, uid: t.uid }).ok) {
      ctx.noteNow(`${t.label} trades 1 Link for 1 Action Tick (Link now ${t.link}; Offensive Stance locked, FAQ L2).`, 'done');
    }
    ctx.refresh();
  });
  on('[data-act="overload"]', (el) => {
    if (el.dataset.why) { ctx.noteNow(el.dataset.why); ctx.refresh(); return; }
    const sc = ensureScript(s);
    const t = sc.opp ? s.tokens.find((x) => x.uid === sc.opp!.uid) : undefined;
    if (t) {
      // Link bought as Ticks is Link the Mech no longer has, and a Mech on 0
      // Link Shuts Down. The Pack does not exempt it, so the spend goes through
      // and the Shutdown is reported rather than the last point being refused.
      const wasShut = t.stance === 'shutdown';
      if (ctx.send({ kind: 'overload', seat: t.side, uid: t.uid }).ok && !wasShut && t.stance === 'shutdown') {
        ctx.noteNow(`Link has reached 0, so ${t.label} shuts down.`, 'done');
      }
    }
    ctx.refresh();
  });
  on('[data-act="attackmode"]', (el) => {
    if (el.dataset.why) { ctx.noteNow(el.dataset.why); ctx.refresh(); return; }
    const sc = ensureScript(s);
    const t = sc.opp ? s.tokens.find((x) => x.uid === sc.opp!.uid) : undefined;
    if (t && ctx.send({ kind: 'attackMode', seat: t.side, uid: t.uid }).ok) {
      // The Stance lock is the price, and it is not obvious from the button, so
      // it is said out loud the moment it is paid.
      ctx.noteNow(`${t.label} takes its extra Action Tick, and its Stance is now set for this Action Opportunity (4.1).`, 'done');
    }
    ctx.refresh();
  });
  on('[data-act="maneuver"]', (el) => {
    if (el.dataset.why) { ctx.noteNow(el.dataset.why); ctx.refresh(); return; }
    const sc = ensureScript(s);
    const t = sc.opp ? s.tokens.find((x) => x.uid === sc.opp!.uid) : undefined;
    if (!t) { ctx.refresh(); return; }
    // The Harpy asks about its drag BEFORE the plan exists, because the -1
    // comes out of the allowance the overlay is about to show. Same shared
    // offer as freeplay; anyone else starts the plan straight away.
    void offerHarpyDrag(ctx.data, s, t, maneuverRange(ctx.data, t)).then((drag) => {
      if (drag === 'cancelled') { ctx.refresh(); return; }
      startMovePlan(ctx, t, { label: t.kind === 'mech' ? 'Maneuver' : 'Movement', maneuver: true });
      if (drag && movePlan) {
        movePlan.steps -= 1;
        movePlan.drag = drag;
      }
      ctx.refresh();
    });
  });
  on('[data-act="goon"]', (el) => {
    if (el.dataset.why) { ctx.noteNow(el.dataset.why); ctx.refresh(); return; }
    const o = ensureScript(s).opp;
    const t = o ? s.tokens.find((x) => x.uid === o.uid) : undefined;
    if (!t || !o?.mineHalt) { ctx.refresh(); return; }
    startMovePlan(ctx, t, { label: 'Go on', range: o.mineHalt, resume: true });
    ctx.refresh();
  });
  on('[data-act="commitmove"]', () => commitMove(ctx));
  on('[data-act="cancelmove"]', () => cancelMove(ctx));
  on('[data-act="flytoggle"]', () => {
    if (!movePlan?.flightOptional) return;
    movePlan.flying = !movePlan.flying;
    // The route was drawn against the other rule set — a walked path may cross
    // a Grid that flying reaches and vice versa — so it goes back to the start
    // rather than being carried over and silently revalidated.
    movePlan.path = movePlan.path.slice(0, 1);
    movePlan.marks = [1];
    movePlan.preview = null;
    ctx.refresh();
  });
  on('[data-turn]', (el) => { rotate(ctx, el.dataset.turn === 'ccw' ? 3 : 1); });
  on('[data-boxtake]', (el) => takeBox(ctx, el.dataset.boxtake!));
  on('[data-act="boxskip"]', () => nextBox(ctx));
  on('[data-minelay]', (el) => {
    const [c, r] = el.dataset.minelay!.split(',').map(Number);
    layMineAt(ctx, c, r);
  });
  on('[data-act="mineskip"]', () => { minePick = null; ctx.refresh(); });
  on('[data-blinktarget]', (el) => {
    if (blinkPlan) blinkPlan.targetUid = Number(el.dataset.blinktarget);
    ctx.refresh();
  });
  on('[data-blinkface]', (el) => blinkFace(ctx, Number(el.dataset.blinkface) as Facing));
  // Cancelling gives the Ticks back, the same as backing out of any other tool.
  on('[data-act="blinkcancel"]', () => { blinkPlan = null; dropAction(); ctx.refresh(); });
  on('[data-boxdrop]', (el) => {
    const [c, r] = el.dataset.boxdrop!.split(':').map(Number);
    placeDroppedBox(ctx, c, r);
  });
  on('[data-act="boxdropclose"]', () => { boxDrop = null; board?.clearHighlights(); ctx.refresh(); });
  // Rolling the pool, choosing the Part, applying the Penetration and recording
  // the kill all used to be buttons here. They belong to the AttackHelper now:
  // it walks the whole of 4.4 and issues the same commands at the right moment,
  // which is what "the app does the work and says what it did" means.
  on('[data-award]', (el) => {
    const side = el.dataset.award as Side;
    // A VP written by hand touches the VP and nothing else. Sent as an Award
    // it marked the owed kills paid and ticked the round's Tasks step, so the
    // round's own score was never offered (audit Phase 6, D3).
    ctx.send({ kind: 'adjustVp', seat: me(), side, by: 1 });
    ctx.refresh();
  });
  on('[data-act="endopp"]', () => endOpportunityNow(ctx));
  on('[data-endstep]', (el) => {
    if (el.dataset.why) { ctx.noteNow(el.dataset.why); ctx.refresh(); return; }
    settleEndStep(ctx, me(), el.dataset.endstep!);
  });
  on('[data-act="advance"]', () => {
    // Networked, the press is one half of the two-player agreement: mark this
    // seat ready (or take it back). The completer's client sends the actual
    // advance — see advanceIfBothReady in match.ts. Solo advances directly.
    if (ctx.networked && ctx.seat) {
      const r = ctx.state.ready ?? {};
      ctx.send({ kind: 'setReady', seat: me(), ready: !r[ctx.seat] });
    } else {
      ctx.send({ kind: 'advancePhase', seat: me() });
    }
    ctx.refresh();
  });
  on('[data-act="record"]', () => {
    recording = true;
    recordNote = null;
    ctx.refresh();
    void ctx.recordMatch().then((why) => {
      recording = false;
      recorded = !why;
      recordNote = why;
      ctx.refresh();
    });
  });
  on('[data-act="soloagain"]', () => ctx.solo?.again());
  on('[data-act="sololeave"]', () => ctx.solo?.leave());
  on('[data-act="endmatch"]', () => {
    recorded = false;
    recordNote = null;
    ctx.send({ kind: 'endMatch', seat: me() });
    ctx.refresh();
  });
  on('[data-act="lockdials"]', () => {
    // The commit/reveal handshake lives in match.ts, which owns the salt.
    root.dispatchEvent(new CustomEvent('mc-lockdials', { bubbles: true }));
  });
}
