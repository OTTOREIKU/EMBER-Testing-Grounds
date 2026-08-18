import { clearDroneCommands, missionZones, readyCommands, seedCommandTokens, taskDesignations, type Command, type CheckResult } from './commands';
import { askIssuer, asterBlockers, offerCoordination, offerHarpyDrag, runAster } from './commandpick';
import type { GameData } from './data';
import { actionIconUrl, cardName, isAerial, secondaryImageUrl, squadLabel, unitSize } from './data';
import { Board, footprint, snapPlacement, type BoardCallbacks } from './board';
import { printedDeployment, resolveZoneSetData } from './overlays';
import { coordinationFor, coordinationOnOpportunityEnd, autoDetonationsOwed, autoNeutralTargets, blinkTargets, camoBrokenBy, flightGrant, isAirborneAction, isPositionSwap, electronicOrigins, loanedParts, minesLayable, minesOwed, pilotCard, unfoldsOwed, type MineLaying, type MineTrigger, extrasFor, SLOT_LABEL, repairSpec, autoTargetsFor, isSilentAction, maneuverIsSilent, canActivateCamo, chargeableSlots, electronicValue, explosionScope, extraActivationOf, freehandSlots, guidedActions, initiativeFor, interceptCapacity, interceptLeft, interceptsOwed, projectileDelivery, isChargeAction, isElectronicAttack, knockbackOf, maneuverRange, needsSightToLanding, resupplyOf, smokePlacement, squadAllegiance, volleyOf, type ExtraActivation, type Resupply } from './units';
import { resolveCounterRoll, tallyCounter } from './combat';
import { tacticFitsPhase, tacticSpec, tacticTargets, type TacticCtx } from './tactics';
import { inContact, canStandIn, attackDirection, crushTargets, dissipationFor, extendPath, knockbackPath, largeGridOf, LG, losBetween, losNote, pathCost, protectionFor, rangeBetween, reachableGrids, standingSpot, type LargeGrid } from './rules';
import { breakAwayCost, canBeForceMoved } from './melee';
import { factionColour, linkIcon, squadColour } from './icons';
import { iconSvg } from './dice';
import type { PartSlot, CardAction, CounterRoll, DiceData, DieColor, Facing, GameState, Side, Stance, Timing, Token, ExtraTick, Opportunity } from './types';
import { statusCount, newOpportunity, newScriptState, PHASES, STATUSES, TIMINGS } from './types';
import { deployable, deployTurn, deploymentComplete, firstPlayerFrom, normaliseSetup, rollTotal, type SetupState } from './setup';
import { actionPhaseComplete, activationOrder, alive, canAct, droneActionWhy, droneMoveWhy, eligibleUnits, isLoopPhase, loopComplete, nextActivation, nextTurn, onExtraOpportunity, type InitLookup, type LoopPhase } from './loop';
import { actionIdOf, canActivate, canManeuver, canOverload, canPerform, costLabel, costOf, extrasLeft, grantHolds, LENGTH_NAME, lengthOf, OVERLOAD_MAX, whyGrantLapsed, type TickVerdict } from './ticks';
import { gameResult, normaliseTasks, scoreMain, scoreSecondary, settleControl, unpaidLines, zoneCentreGrid, type Designation, type ScoreLine, type ScoreResult, type SecondaryScoring } from './tasks';
import { stationaryAdjusted, tokenCards } from './units';

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
  note: string | null;
  // Shows a one-off message in the turn panel.
  noteNow(text: string): void;
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
  // The defender's read-only copy of the attacker's combat window, drawn into
  // the same floating pop when this client is NOT the one attacking. Null when
  // no attack is published or the live helper owns the window.
  combatMirrorHtml(): string | null;
  // The defending player's Focus buttons inside that mirror (4.4.1-5):
  // 'use'/'pass' answer the declare, 'die' toggles a Defense die by index,
  // 'reroll' rolls server faces for the picked dice, 'keep' ends without.
  mirrorFocus(act: 'use' | 'pass' | 'die' | 'reroll' | 'keep' | 'kc', dieIndex?: number): void;
  // Opens the §4.4 pipeline on a target the player has just picked. The mode
  // decides what the defender may claim: an ordinary attack reads Terrain and
  // Unit Protection off the board, an Interception grants none and needs no
  // arc or sight (4.9), and an Explosion grants none and ignores facing (4.7.6).
  startAttack(uid: number, actionId: string, targetUid: number, mode?: 'attack' | 'intercept' | 'explosion'): void;
  // Brings a side tab forward by name.
  showTab(name: 'squad' | 'details'): void;
  // The printed faces, for drawing the dice a roll landed on.
  diceData: DiceData | null;
  // Keeps the finished game on both accounts. Resolves to null when it landed,
  // or to why it did not — a failure here never stops the table closing.
  recordMatch(): Promise<string | null>;
  refresh(): void;
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ---------- the guide glue, mirrored from playguide.ts ----------
// Both clients run this same deterministic bookkeeping between commands; the
// Match Centre is a full peer, so it runs it too.

const PKEY: Record<Timing, 'swift' | 'melee' | 'projectile' | 'firing' | 'moving' | 'tactic'> = {
  swift: 'swift', melee: 'melee', projectile: 'projectile', firing: 'firing', movement: 'moving', tactical: 'tactic',
};

export function makeInit(data: GameData): InitLookup {
  return (t, timing) => {
    const p = t.mech?.pilot ? data.byId.get(t.mech.pilot) : undefined;
    const v = p?.[PKEY[timing]];
    return typeof v === 'number' ? v : undefined;
  };
}

export function ensureScript(state: GameState): NonNullable<GameState['script']> {
  if (!state.script) state.script = { ...newScriptState(state.round.firstPlayer), strict: true };
  return state.script;
}

export function enterPhase(data: GameData, s: GameState): void {
  const sc = ensureScript(s);
  if (s.round.phase === 0) {
    seedCommandTokens(data, s);
    sc.commanded = [];
    sc.freeCommand = [];
  } else if (sc.stage.split(':')[1] === '0') {
    // 3.2.3, on the way out of the Command Phase - and ONLY then: the Drones'
    // Command Tokens come off, the Mechs' reserved ones do not. sc.stage still
    // names the phase being left at this point, and the leaving check matters:
    // a token a Drone is handed later through Command Coordination stays on its
    // card until the End Phase sweep (4.15.4), so stripping Drones on every
    // phase entry would delete it one phase early.
    clearDroneCommands(s);
  }
  if (s.round.phase === 0 || s.round.phase === 2) sc.acted = [];
  sc.endDone = sc.endDone.filter((k) => k.startsWith(`${s.round.n}:`));
    // Once-per-round abilities are keyed by round for the same reason, so the
    // ledger is pruned the same way rather than growing all game.
    sc.oncePerRound = (sc.oncePerRound ?? []).filter((k) => k.startsWith(`${s.round.n}:`));
  sc.opp = null;
  sc.passed = [];
  sc.turn = s.round.firstPlayer;
  sc.stage = `${s.round.n}:${s.round.phase}`;
}

// Runs after any command lands, ours or theirs, so both clients derive the
// same turn bookkeeping without it ever crossing the wire.
export function glueAfter(data: GameData, state: GameState, cmd: Command): void {
  if (!normaliseSetup(state.setup) && cmd.kind !== 'startMatch') return;
  if (cmd.kind === 'startMatch' || cmd.kind === 'advancePhase' || cmd.kind === 'setPhase' || cmd.kind === 'finishDeployment') {
    enterPhase(data, state);
  } else if (cmd.kind === 'designate') {
    const sc = ensureScript(state);
    const t = state.tokens.find((x) => x.uid === cmd.uid);
    const opp = newOpportunity(cmd.uid, undefined);
    opp.extras = t ? extrasFor(data, t) : [];
    sc.opp = opp;
  }
  // Smoke dissipation takes the isolated screens off both sides in one
  // judgement and then owes one removal per Connected group, chosen by its
  // owner (4.16). The queue is snapshotted here rather than re-derived, because
  // a removal that splits a group owes nothing further this round — and it is
  // built from the command itself so both seats hold the identical list.
  if (cmd.kind === 'dissipateSmoke') {
    const order: Side[] = state.round.firstPlayer === 's1' ? ['s1', 's2'] : ['s2', 's1'];
    smokeOwed = order.flatMap((side) =>
      dissipationFor(state.smoke ?? [], side).groups.map((g) => ({ side, cells: g.map((s) => ({ col: s.col, row: s.row })) })),
    );
    if (!smokeOwed.length) smokeOwed = null;
  }
  if (cmd.kind === 'removeSmoke' && smokeOwed) {
    smokeOwed = smokeOwed.slice(1);
    if (!smokeOwed.length) smokeOwed = null;
  }
  // Leaving the End Phase abandons anything still owed; next round judges the
  // board afresh.
  if (cmd.kind === 'advancePhase' || cmd.kind === 'setPhase' || cmd.kind === 'startMatch' || cmd.kind === 'endMatch') smokeOwed = null;
  // Whose Action Opportunity it is, derived HERE — off the command, the way
  // every other piece of turn bookkeeping is.
  //
  // It used to be minted inside actionPanel(), which meant it only refreshed on
  // a client that happened to be *drawing* that panel, and eighteen other
  // panels return before it. A player with the combat window, an owed
  // Interception or a Tactics Card open therefore held a stale `opp`, and every
  // command the other player sent for the active unit was refused with "it is
  // not this Mech's Action Opportunity" — twice inside six seconds and the
  // table announced it would not settle. The same render-time derivation is
  // what made the board fingerprint cry wolf the day before.
  //
  // Both clients run this after every command, ours and theirs, so both reach
  // the same answer without it ever crossing the wire.
  if (state.round.phase === 2) opportunity(data, state);
}

function opportunity(data: GameData, s: GameState): Opportunity | null {
  const sc = ensureScript(s);
  // A nested Extra Action Opportunity (FAQ K21) belongs to whoever was just
  // granted it, NOT to whoever the activation order says is next - the
  // re-derivation below would clobber it on the very next command.
  if (sc.opp?.extra) return sc.opp;
  const next = nextActivation(s, makeInit(data));
  if (!next) return null;
  if (sc.opp && sc.opp.uid === next.uid) return sc.opp;
  const t = s.tokens.find((x) => x.uid === next.uid);
  const fresh = newOpportunity(next.uid, next.timing);
  fresh.extras = t ? extrasFor(data, t) : [];
  sc.opp = fresh;
  return fresh;
}

// ---------- zones & deployment geometry ----------

function zref(ref: string): { col: number; row: number } | null {
  const m = /^([A-La-l])(\d{1,2})$/.exec(ref.trim());
  if (!m) return null;
  return { col: m[1].toUpperCase().charCodeAt(0) - 65, row: Number(m[2]) - 1 };
}

// Board cells (36-grid) of a mission's objective zones, from the Task Items.
export function objectiveCells(data: GameData, s: GameState): { c: number; r: number }[] {
  const tasks = normaliseTasks(s.tasks);
  const out: { c: number; r: number }[] = [];
  for (const item of tasks.items) {
    const zone = data.zoneData.zones.find((z) => z.id === item.zone);
    for (const cell of zone?.cells ?? []) {
      const p = zref(cell);
      if (p) for (let dc = 0; dc < 3; dc++) for (let dr = 0; dr < 3; dr++) out.push({ c: p.col * 3 + dc, r: p.row * 3 + dr });
    }
  }
  return out;
}

// The board cells a side may deploy into, from its edge and the mission's
// printed deployment shape (2x12 strips when no mission says otherwise).
export function deployCellsFor(data: GameData, s: GameState, side: Side): Set<string> {
  const su = normaliseSetup(s.setup);
  const out = new Set<string>();
  if (!su) return out;
  const shapeId = (s.mission && data.zoneData.missionDeployment[s.mission]) || 'strips';
  const def = data.zoneData.deployments.find((d) => d.id === shapeId);
  const area = def?.[su.edge[side]];
  if (!area) return out;
  const a = zref(area.from);
  const b = zref(area.to);
  if (!a || !b) return out;
  for (let zc = Math.min(a.col, b.col); zc <= Math.max(a.col, b.col); zc++) {
    for (let zr = Math.min(a.row, b.row); zr <= Math.max(a.row, b.row); zr++) {
      for (let dc = 0; dc < 3; dc++) for (let dr = 0; dr < 3; dr++) out.add(`${zc * 3 + dc},${zr * 3 + dr}`);
    }
  }
  return out;
}

// The middle of a squad's Deployment Zone, in cells. Used to point a unit at
// the enemy as it lands, so nothing has to be turned by hand before confirming.
function zoneCentre(cells: Set<string>): { col: number; row: number } | null {
  if (!cells.size) return null;
  let c = 0;
  let r = 0;
  for (const k of cells) {
    const [cc, rr] = k.split(',').map(Number);
    c += cc;
    r += rr;
  }
  return { col: c / cells.size, row: r / cells.size };
}

// Which way a unit faces as it deploys: at the other squad's zone. Whichever
// axis the two zones are further apart on wins, so it works for the corner
// deployments as well as the strips along opposite edges. Falls back to facing
// the far side of the board if the enemy zone is unknown.
export function deployFacing(data: GameData, s: GameState, side: Side, at?: { col: number; row: number }): Facing {
  const mine = at ?? zoneCentre(deployCellsFor(data, s, side));
  const theirs = zoneCentre(deployCellsFor(data, s, side === 's1' ? 's2' : 's1'));
  const from = mine ?? { col: 17.5, row: 17.5 };
  const to = theirs ?? { col: 17.5, row: 35 - (from.row) };
  const dc = to.col - from.col;
  const dr = to.row - from.row;
  if (Math.abs(dr) >= Math.abs(dc)) return (dr >= 0 ? 2 : 0) as Facing;
  return (dc >= 0 ? 1 : 3) as Facing;
}

// ---------- module UI state ----------

let placing: number | null = null; // uid being deployed via board clicks
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
  // A Movement Action has already paid with an Action Tick, so its move must
  // not also spend the Maneuver Tick.
  free?: boolean;
  // A Movement a Tactics Card handed out, which belongs to no Opportunity.
  granted?: boolean;
  // Turning on the spot costs no Movement Range but is still Movement, so the
  // facing is chosen inside the Movement and travels with it. A route of no
  // steps and a new facing is a legal Maneuver on its own.
  facing: Facing;
  turned: boolean;
} | null = null;
// Whose card the Details tab is showing, when the player has asked for one
// rather than taking the active unit's.
let inspectUid: number | null = null;
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

function orderStripHtml(ctx: HudCtx): string {
  const s = ctx.state;
  if (s.round.phase < 1 || s.round.phase > 2) return '';
  const sc = ensureScript(s);
  const acted = new Set(sc.acted);
  const order = activationOrder(s, makeInit(ctx.data));
  if (!order.length) return '';
  const cur = s.round.phase === 2 ? nextActivation(s, makeInit(ctx.data)) : null;
  const chips = order
    .map((a) => {
      const t = s.tokens.find((x) => x.uid === a.uid);
      if (!t) return '';
      const short = TIMINGS.find((x) => x.id === a.timing)?.short ?? '';
      const cls = cur && cur.uid === a.uid && !acted.has(a.uid) ? ' now' : acted.has(a.uid) ? ' past' : '';
      return `<span class="ord ${t.side}${cls}"><span class="sw"></span>${esc(t.label)} · ${short}</span>`;
    })
    .join('');
  return `<div class="orderstrip">${chips}</div>`;
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
  const gone = new Set(ctx.state.removedTerrain ?? []);
  return (ctx.data.terrain.layouts[ctx.state.map] ?? []).filter((p) => !gone.has(p.id));
}

// `steps` is how far this particular Movement reaches — a Maneuver uses the
// Chassis Value, a Movement Action its own printed Range. Hardcoding the
// Maneuver here drew the Maneuver's reach under a Sprint that could go further,
// so the panel said 4 grids while the board highlighted 1.
// `asFlight` overrides the derivation while a route is being drawn: a Part can
// put a Mech into Flying Movement for this move only, and the highlight has to
// answer to the plan or the toggle would change nothing on the board.
function reachableFor(ctx: HudCtx, t: Token, steps = maneuverRange(ctx.data, t), asFlight?: boolean) {
  const terrain = terrainOf(ctx);
  // Same derivation as the freeplay board: a square-base flyer (moveAsFlight)
  // crosses terrain even though it is not Aerial. Reading only `aerial` here
  // grounded the Ravens on this page while the guide let them fly.
  const flying = asFlight ?? (!!ctx.data.byId.get(t.cardId)?.moveAsFlight || !!t.aerial);
  return reachableGrids(t, steps, terrain, ctx.state.tokens, flying, {
    exitCost: flying ? undefined : breakAwayCost(ctx.data, t, ctx.state.tokens, terrain),
    crushable: (c, r) => crushTargets(t, c, r, terrain, ctx.state.tokens) !== null,
  });
}

function canReach(ctx: HudCtx, t: Token, col: number, row: number): boolean {
  const c = Math.floor(col / 3);
  const r = Math.floor(row / 3);
  return reachableFor(ctx, t).some((g) => g.c === c && g.r === r);
}

function moveOptsFor(ctx: HudCtx, t: Token, flying: boolean) {
  const terrain = terrainOf(ctx);
  return {
    exitCost: flying || t.aerial ? undefined : breakAwayCost(ctx.data, t, ctx.state.tokens, terrain),
    crushable: (c: number, r: number) => crushTargets(t, c, r, terrain, ctx.state.tokens) !== null,
  };
}

// A Maneuver by default. A Movement Action passes its own Range instead: the
// chassis `move` is the Maneuver Value (1–2 Grids) and has nothing to do with a
// Sprint-style Action's printed range, which is usually 4.
function startMovePlan(ctx: HudCtx, t: Token, opts: { range?: number; label?: string; shoveActionId?: string; free?: boolean; granted?: boolean; maneuver?: boolean; airborne?: boolean } = {}): void {
  const steps = opts.range || maneuverRange(ctx.data, t);
  if (steps <= 0) {
    ctx.noteNow(`${t.label} has no Movement Range on its card.`);
    return;
  }
  // Flight from a Part, on the same reading the freeplay board uses. A Fairy
  // pair flies every move; an Ojs200 offers it on the Maneuver and may be
  // declined, so it starts walking and the panel carries the switch. An
  // Airborne Movement Action outranks all of it: that Jump simply IS Flying.
  const base = !!ctx.data.byId.get(t.cardId)?.moveAsFlight;
  const grant = base ? 'none' : flightGrant(ctx.data, t, loanedParts(ctx.data, ctx.state.tokens, t));
  const optional = !opts.airborne && grant === 'maneuver' && !!opts.maneuver;
  movePlan = {
    uid: t.uid,
    side: t.side,
    steps,
    flying: base || !!opts.airborne || grant === 'always',
    flightOptional: optional,
    path: [{ c: Math.floor(t.col / 3), r: Math.floor(t.row / 3) }],
    marks: [1],
    preview: null,
    label: opts.label ?? 'Maneuver',
    shoveActionId: opts.shoveActionId,
    free: opts.free,
    granted: opts.granted,
    facing: t.facing,
    turned: false,
  };
}

// Q and E, the same two keys the freeplay board turns a unit with. A pivot is
// free of Movement Range but it is Movement, so it only happens inside one —
// or as the unit lands, where nothing has fixed its facing yet.
function rotate(ctx: HudCtx, dir: 1 | 3): boolean {
  if (movePlan) {
    movePlan.facing = ((movePlan.facing + dir) % 4) as Facing;
    movePlan.turned = true;
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
  const cand = extendPath(m.path, { c, r }, t, m.steps, terrainOf(ctx), ctx.state.tokens, m.flying, moveOptsFor(ctx, t, m.flying));
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
  movePlan = null;
  // A Maneuver has nothing pending; a Movement Action backing out gives its
  // Ticks back.
  dropAction();
  board?.clearMovePath();
  board?.clearHighlights();
  ctx.refresh();
}

// Each stop takes the free part of its Grid rather than the middle, so a unit
// crossing a Grid holding a low wall walks past it instead of onto it. Only
// the destination goes to the engine; the walk is local animation.
function commitMove(ctx: HudCtx): void {
  const m = movePlan;
  if (!m || !board) return;
  const t = ctx.state.tokens.find((x) => x.uid === m.uid);
  if (!t) return;
  // Turning on the spot is a Movement in its own right and costs no Range, so a
  // Maneuver that only pivots is a finished Maneuver.
  if (m.path.length < 2) {
    if (!m.turned) return;
    movePlan = null;
    board.clearMovePath();
    board.clearHighlights();
    commitAction(ctx);
    ctx.send({ kind: 'maneuver', seat: t.side, uid: t.uid, to: { col: t.col, row: t.row }, facing: m.facing, free: m.free, granted: m.granted });
    ctx.noteNow(`${t.label} turns on the spot. A pivot spends no Movement Range, but it is Movement.`);
    ctx.refresh();
    return;
  }
  const terrain = terrainOf(ctx);
  const stops: { col: number; row: number }[] = [];
  let from = { col: t.col, row: t.row };
  for (const g of m.path) {
    const spot =
      standingSpot(g.c, g.r, t.size, m.flying || t.aerial, terrain, ctx.state.tokens, t.uid, from)
      ?? snapPlacement(g.c * 3 + 1, g.r * 3 + 1, t.size as 1 | 2 | 3);
    if (!spot) continue;
    stops.push(spot);
    from = spot;
  }
  const last = stops[stops.length - 1];
  const shoveId = m.shoveActionId;
  const free = m.free;
  const granted = m.granted;
  const facing = m.turned ? m.facing : undefined;
  const goal = m.path[m.path.length - 1];
  const drag = m.drag;
  movePlan = null;
  board.clearMovePath();
  board.clearHighlights();
  if (!last) {
    ctx.refresh();
    return;
  }
  // The route is committed, so a Movement Action pays here — and it has to pay
  // before the maneuver travels, since a free move is only legal once its Action
  // has been performed this Opportunity.
  commitAction(ctx);
  // Ending in an occupied Grid is a Crush, and everything in there has to give
  // way before the crusher lands (4.3.6). The Movement ends there either way.
  const victims = crushTargets(t, goal.c, goal.r, terrain, ctx.state.tokens);
  if (victims && (victims.units.length || victims.terrain.length)) {
    crushPlan = {
      uid: t.uid,
      goal,
      terrain: victims.terrain.map((p) => p.id),
      queue: victims.units.map((v) => v.uid),
      stops,
      free,
      granted,
      shoveActionId: shoveId,
      facing,
      path: m.path,
      steps: m.steps,
      flying: m.flying,
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
    ctx.send({ kind: 'maneuver', seat: t.side, uid: t.uid, to: last, free, granted, via: stops, facing });
    // The Harpy's dragged Ally comes with it — towed BEHIND, into the Grid the
    // Harpy just vacated, with the final Grid as the small-unit fallback: a
    // Large Mech fills a whole 3x3 Grid, so a spot beside the Harpy can never
    // fit one. spendCommand pays the funder's token and forceMove is the same
    // command Knockback uses, so both travel.
    if (drag) {
      const ally = ctx.state.tokens.find((x) => x.uid === drag.allyUid);
      const goalGrid = m.path[m.path.length - 1];
      const prevGrid = m.path[m.path.length - 2];
      const spot = ally
        ? (prevGrid
          ? standingSpot(prevGrid.c, prevGrid.r, ally.size, ally.aerial, terrain, ctx.state.tokens, ally.uid)
          : null)
          ?? standingSpot(goalGrid.c, goalGrid.r, ally.size, ally.aerial, terrain, ctx.state.tokens, ally.uid)
        : null;
      if (ally && spot) {
        ctx.send({ kind: 'spendCommand', seat: t.side, uid: drag.funderUid });
        ctx.send({ kind: 'forceMove', seat: t.side, uid: t.uid, targetUid: ally.uid, to: spot });
        ctx.noteNow(`${t.label} drags ${ally.label} along (-2 Movement, 1 Command Token consumed).`);
      } else if (ally) {
        ctx.noteNow(`${ally.label} could not be dragged: nothing free to stand in. The Command Token was not consumed.`);
      }
    }
    if (aerialStart) {
      const moved = ctx.state.tokens.find((x) => x.uid === t.uid);
      const owed = moved ? interceptsOwed(ctx.data, ctx.state.tokens, ctx.state.smoke ?? [], aerialStart, [moved]) : [];
      if (owed.length) {
        ctx.send({ kind: 'queueIntercepts', seat: t.side, items: owed });
        ctx.noteNow(`${t.label} is an Aerial Unit, so its Movement triggers Interception: ${owed.length} attempt${owed.length === 1 ? '' : 's'} owed (4.9).`);
      }
    }
    // A Black Box in a Grid the route passed through may be picked up, which is
    // read off the whole route rather than the destination (5.3.1). Auto Mine
    // Laying reads the same route, and goes first (M7).
    offerMinesOn(ctx, t, walked, m.steps, m.flying);
    offerBoxesOn(ctx, t.uid, walked);
    // A shove rides on the Movement rather than replacing it, so it is offered
    // once the Mech has finished moving and is facing whatever it ended beside.
    if (shoveId) startShove(t.uid, shoveId);
    ctx.refresh();
  });
}

// A snapped footprint counts only when every cell sits inside the zone.
function fitsZone(ctx: HudCtx, side: Side, at: { col: number; row: number }, size: number): boolean {
  const zone = deployCellsFor(ctx.data, ctx.state, side);
  return footprint({ ...at, size }).every((c) => zone.has(`${c.col},${c.row}`));
}

function boardCallbacks(): BoardCallbacks {
  return {
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
      const snap = snapPlacement(col, row, (t.size ?? 1) as 1 | 2 | 3) ?? { col, row };
      // During deployment a drag nudges the unit inside its zone; in play it
      // is a Maneuver attempt the engine judges.
      const su = normaliseSetup(ctx.state.setup);
      if (su && su.stage === 'deploy') {
        if (!fitsZone(ctx, t.side, snap, t.size ?? 1)) { ctx.refresh(); return; }
        // Dragging the unit you are placing just moves the pending spot — it
        // must not land, because landing passes the alternation to the other
        // squad before you have confirmed anything.
        if (pending && pending.uid === uid) pending = { ...pending, col: snap.col, row: snap.row };
        else ctx.send({ kind: 'deployUnit', seat: t.side, uid, to: snap });
      } else if (canReach(ctx, t, snap.col, snap.row)) {
        // The drop only lands inside the unit's real Movement Range — the
        // same law the freeplay board enforces before offering a grid.
        ctx.send({ kind: 'maneuver', seat: t.side, uid, to: snap });
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
        const snap = snapPlacement(col, row, size) ?? { col, row };
        board.showGhost(footprint({ ...snap, size }), fitsZone(ctx, t.side, snap, size));
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
      if (placing === null) return;
      const t = s.tokens.find((x) => x.uid === placing);
      if (!t) return;
      const size = (t.size ?? 1) as 1 | 2 | 3;
      const snap = snapPlacement(col, row, size) ?? { col, row };
      // Strict placement: your whole footprint inside your own Deployment
      // Zone, aligned to the grid, or nothing lands (3.1.4). The seat is the
      // unit's side — a nudge stays legal after the alternation moves on.
      if (!fitsZone(ctx, t.side, snap, size)) return;
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
      ctx.send({ kind: 'destroyTerrain', seat: ctx.seat ?? 's1', uid: 0, pieces: [id] });
      ctx.refresh();
    },
  };
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
  board.panEnabled = placing === null && !movePlan && !launchPlan && !smokePlan && !smokeOwed?.length && !crushPlan?.queue.length && !boxDrop;
  // Lit for the attacker choosing where a dropped Box lands. It outranks the
  // rest because it is asked mid-attack and nothing else can be open.
  if (boxDrop && mine(ctx, boxDrop.bySide)) {
    const bearer = s.tokens.find((x) => x.uid === boxDrop!.bearerUid);
    board.showSmokeTargets(
      bearer ? dropGrids(ctx, bearer).map((g) => ({ ...g, ok: true })) : [],
      (c, r) => placeDroppedBox(ctx, c, r),
    );
  } else if (movePlan) {
    const t = s.tokens.find((x) => x.uid === movePlan!.uid);
    // The same overlay freeplay shows: the Large Grids this unit can really
    // enter, with the step count on each.
    if (t) board.showReachable(reachableFor(ctx, t, movePlan.steps, movePlan.flying || !!t.aerial), movePlan.steps);
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
      v ? crushEscapes(ctx, v, crushPlan.goal).map((g) => ({ ...g, ok: true })) : [],
      (c, r) => placeCrushed(ctx, c, r),
    );
  } else if (smokeOwed?.length && mine(ctx, smokeOwed[0].side)) {
    board.showSmokeTargets(
      smokeOwed[0].cells.map((s) => ({ c: s.col, r: s.row, ok: true })),
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
  board.renderTerrain((ctx.data.terrain.layouts[s.map] ?? []).filter((p) => !gone.has(p.id)));
  // The Zones toggle is a local preference — a clean board to look at, not a
  // rule change — so it only suppresses the overlay and never crosses the wire.
  const showZones = ctx.zonesOn;
  const ov = showZones ? resolveZoneSetData(ctx.data, s.zoneSet ?? '') : { zones: [], deploy: null };
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
    const name = ctx.data.zoneData.zones.find((z) => z.id === id)?.name ?? id;
    (claimed[name] ??= []).push(side);
  }
  board.renderZones(ov.zones, deploy, claimed);
  board.renderTaskItems(tasks.items, (zone) => zoneCentreGrid(ctx.data.zoneData.zones, zone));
  // Everything else on the board still redraws while a unit is walking; only
  // the token layer waits, because rebuilding it would cut the animation short.
  // A pivot inside an open Movement shows before it is confirmed, the same way
  // an unconfirmed placement does.
  const preview = pending ?? (movePlan?.turned ? { uid: movePlan.uid, facing: movePlan.facing } : undefined);
  if (animatingUid === null) board.renderTokens(s, preview);
  board.renderSmoke(s.smoke ?? []);
  board.renderMarkers(s.markers ?? []);
  board.setSelected(ensureScript(s).opp?.uid ?? null);
}

// ---------- the turn panel: one question at a time ----------

function head(eyebrow: string, title: string, sub: string, mine: boolean): string {
  return `<div class="tp-head">
    <div class="tp-eyebrow${mine ? ' mine' : ''}">${esc(eyebrow)}</div>
    <div class="tp-title">${title}</div>
    ${sub ? `<div class="tp-sub">${sub}</div>` : ''}
  </div>`;
}

function waiting(side: Side, doing: string): string {
  return `<div class="waitbox"><div class="spin">◐</div><div class="msg">Waiting for <b class="${side}">${squadLabel(side)}</b></div><div class="sub">${esc(doing)}</div></div>`;
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
        const btn = isMe
          ? `<button class="rowbtn" data-roll="${side}">${r.length ? 'Re-roll' : 'Roll 2 dice'}</button>`
          : `<span class="tp-dim">${r.length ? '' : 'rolling…'}</span>`;
        return `<div class="dialrow"><span class="nm ${side}">${squadLabel(side)}</span>${btn}<span class="pickchip${r.length ? ' set' : ''}">${r.length ? `${rollTotal(r)} Hits` : '—'}</span></div>`;
      })
      .join('');
    const verdict = tie
      ? `<p class="tp-note">A tie on ${rollTotal(su.rolls.s1)}. No tie procedure in the rulebook, so both roll again.<br>The first re-roll clears the other total.</p>`
      : winner ? `<p class="tp-note">${squadLabel(winner)} rolls higher.</p>` : '';
    return head('Setup', 'Roll for First Player', 'Two dice each, most Hits goes first (3.1.2).', true)
      + `<div class="tp-body">${rows}${verdict}</div>
        <div class="tp-foot">${winner ? '<button class="bigbtn" data-act="accept">Continue</button>' : ''}</div>`;
  }
  if (su.stage === 'tasks') {
    // Secondaries come before the edges, First Player revealing first (FAQ P1).
    const fp = s.round.firstPlayer;
    const taskState = normaliseTasks(s.tasks);
    const both = !!taskState.secondary.s1 && !!taskState.secondary.s2;
    const meNow = !taskState.secondary[fp] ? mine(ctx, fp) : !both ? mine(ctx, fp === 's1' ? 's2' : 's1') : false;
    return head(meNow ? 'Your move' : 'Setup', 'Choose Secondary Tasks',
      `${squadLabel(fp)} goes first and reveals their Secondary Task first (FAQ P1). The Main Task came with the table.`, meNow)
      + `<div class="tp-body">${secondaryRows(ctx, fp)}</div>
        <div class="tp-foot">${both ? '<button class="bigbtn" data-act="tasksdone">Continue to edges</button>' : ''}</div>`;
  }
  if (su.stage === 'side') {
    const fp = s.round.firstPlayer;
    const edge = mine(ctx, fp)
      ? `<div class="btnrow"><button class="rowbtn" data-edge="white">Take the White Deployment Zone</button><button class="rowbtn" data-edge="black">Take the Black Deployment Zone</button></div>`
      : waiting(fp, 'picking a table edge');
    return head(mine(ctx, fp) ? 'Your move' : 'Setup', `${squadLabel(fp)} picks an edge`, 'The other side takes the opposite edge (3.1.2). Secondary Tasks are open information (3.1.3).', mine(ctx, fp))
      + `<div class="tp-body">${edge}<div class="tp-gap"></div>${secondaryRows(ctx)}</div><div class="tp-foot"></div>`;
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
  if (!taskState.secondary.s1 || !taskState.secondary.s2) {
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
  const turn = deployTurn(s, su);
  if (!turn || deploymentComplete(s)) {
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
      else if (!otherReady) foot.push(`<button class="bigbtn ghost2" data-act="deployunready" title="Tap to withdraw">✓ Ready · waiting for ${squadLabel(otherSeat)}…</button>`);
      else foot.push('<button class="bigbtn" data-act="deploydone">Begin Round 1</button>');
    } else {
      foot.push(`<button class="bigbtn${pending !== null ? ' ghost2' : ''}" data-act="deploydone">Begin Round 1</button>`);
    }
    return head('Setup', 'Deployment complete', sub, true)
      + `<div class="tp-body"></div><div class="tp-foot">${foot.join('')}</div>`;
  }
  if (!mine(ctx, turn)) {
    placing = null;
    return head('Deployment', `${squadLabel(turn)} places a unit`, '', false)
      + `<div class="tp-body">${waiting(turn, 'placing a unit')}</div><div class="tp-foot">${confirmRow}</div>`;
  }
  const waitingUnits = deployable(s, turn);
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
  const myMechs = me ? s.tokens.filter((t) => t.side === me && t.kind === 'mech' && alive(t) && t.partStates.torso !== 'destroyed') : [];
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
    <span class="pips${o.action ? '' : ' spent'}"><b class="pip-label">ACT</b>${pip(o.action > 0)}${pip(o.action > 1)}</span>
    ${o.extras.length ? `<span class="pips${live.length ? '' : ' spent'}"><b class="pip-label">XTR</b>${o.extras.map(extraPip).join('')}</span>` : ''}
  </div>`;
}

function actionButtons(ctx: HudCtx, t: Token, o: Opportunity): string {
  // The same list the freeplay guide builds, from the same function: it is
  // where a destroyed Part, Shutdown, Melee Lock, Fire Control Interference,
  // Immobilised and an empty magazine all take an Action away. Asking only the
  // Tick engine, as this panel used to, let every one of those through.
  const guided = guidedActions(ctx.data, t, { tokens: ctx.state.tokens, terrain: terrainOf(ctx) });
  const onExtra = onExtraOpportunity(ctx.state, o.uid);
  // 4.1: a Mech chooses its Stance each Action Opportunity, before the choice
  // to Maneuver — and the choice USED to be a lock that refused every Action
  // until a Stance was pressed. That got in the way of the thing a player
  // actually does, which is cycle the dial to see what each Stance opens up.
  // So the dial stays live and the first Move or Action closes it, in
  // commands.ts lockStance(). The panel only has to say which state it is in.
  const stanceSet = t.kind === 'mech' && !!o.stanceLocked;
  // Keyed by PART, not by Action: two Carrier Tarantulas lending the same
  // Backpack lend two distinct Parts, and each may be used once (FAQ O7).
  const blockedBy = new Map<string, string | undefined>();
  for (const g of guided) if (!g.available) blockedBy.set(g.partKey, g.reason);
  const ammoOf = new Map<string, number | undefined>();
  for (const g of guided) ammoOf.set(g.partKey, g.ammoLeft);
  const lentBy = new Map<string, string>();
  for (const g of guided) if (g.lentBy) lentBy.set(g.partKey, g.lentBy.label);
  // Common Actions belong to Mechs (6.1); a Drone plays only what its card prints.
  // A Passive is not a choice — it applies itself when its situation arises, so
  // offering it as a button only invited a press that did nothing but print
  // "follow the Action text on the card". They are listed further down the
  // Details tab, where they read as the standing rules they are.
  const isPassive = (a: CardAction): boolean => a.type === 'Passive' || a.speed === 'passive';
  // The Part rides along: two R-20 Railguns, one per arm, print the same Action
  // and used to list as two identical rows with nothing to tell them apart.
  const acts: { a: CardAction; key: string; slot?: PartSlot | 'pilot' | 'main'; cardId?: string }[] = [
    ...guided.filter((g) => !isPassive(g.action))
      .map((g) => ({ a: g.action, key: g.partKey, slot: g.slot, cardId: g.card.id })),
    ...(t.kind === 'mech' ? ctx.data.commonActions.filter((a) => !isPassive(a)).map((a) => ({ a, key: a.id })) : []),
  ];
  const seen = new Set<string>();
  const rows = acts
    .filter(({ key }) => (seen.has(key) ? false : (seen.add(key), true)))
    .map(({ a, key, slot, cardId }) => {
      const len = lengthOf(a);
      // Ticks are a Mech's economy. A Drone's Action costs its activation
      // instead — one Action or one Movement, never both — and asking
      // canPerform about one only ever came back "this is not an Action a Mech
      // performs with Ticks", which blocked every Drone Action there is. A
      // Mech's own Passives are length-less too, which is why this asks the
      // unit rather than the Action.
      const ticks: TickVerdict = t.kind !== 'mech' ? canActivate(o) : len ? canPerform(o, a, key) : { ok: true };
      // The board's reason comes first: being out of ammo is a truer answer
      // than "not enough Ticks" when both are true.
      const stopped = blockedBy.get(key);
      // An Extra Action Opportunity cannot hand out another one, or two
      // Coordinating Mechs would keep granting each other Opportunities for the
      // rest of the Round. The card carries the suppression itself.
      const chained = onExtra && extraActivationOf(a)?.suppressGrants
        ? 'This is already an Extra Action Opportunity, and it cannot grant another one.'
        : undefined;
      // The icon lock: with a Command a Drone performs Command-icon Actions,
      // in the Automatic Phase its Automatic ones — same rule check() enforces.
      const loopPh = PHASES[ctx.state.round.phase];
      const phased = t.kind === 'drone' && isLoopPhase(loopPh) ? droneActionWhy(loopPh, a) : null;
      const v: TickVerdict = chained ? { ok: false, why: chained } : stopped ? { ok: false, why: stopped } : phased ? { ok: false, why: phased } : ticks;
      const cost = costOf(a);
      const kind = (a.type ?? '').toLowerCase();
      const pool = `${a.yellowDice ?? 0},${a.redDice ?? 0}`;
      // What it costs, in the Ticks it actually spends, the way the guide
      // writes it: M for the Maneuver Tick, a dot per Action Tick.
      // No printed length means no Tick cost — Passives, and every Drone Action
      // in the card data. Those show their type rather than a price they do
      // not have, the way the guide leaves them off its Tick list entirely.
      const price = v.extra ? 'XTR' : cost ? `${cost.maneuver ? 'M' : ''}${'●'.repeat(cost.action)}` : (a.type ?? '—');
      const lender = lentBy.get(key);
      const tip = v.ok
        ? `${lender ? `Load on ${lender} - ` : ''}${len ? LENGTH_NAME[len] : a.type ?? ''}${cost ? `: ${costLabel(cost)}` : ''}`
        : v.why ?? '';
      // Blocked Actions stay on the list and say why when pressed. A disabled
      // row tells a player nothing, and "the Starting Action must match the
      // dial" is exactly the thing they need told.
      // data-tip-card puts the Part's own card up beside the panel, which is
      // the fastest way to see WHICH arm a duplicated Action belongs to; the
      // slot chip answers the same question without hovering at all.
      const where = slot ? SLOT_LABEL[slot] : '';
      return `<button class="actrow k-${kind}${v.ok ? '' : ' warn'}" data-doact="${esc(key)}" data-pool="${pool}" data-an="${esc(a.name?.en || a.id)}"${
        cardId ? ` data-tip-card="${esc(cardId)}"` : ''
      }${v.ok ? '' : ` data-why="${esc(v.why ?? '')}"`} title="${esc(tip)}">
        <span class="dotk"></span><span class="an">${esc((a.name?.en || a.id).slice(0, 26))}${lender ? ' (Load)' : ''}${ammoOf.get(key) !== undefined ? ` ×${ammoOf.get(key)}` : ''}</span>${
        where ? `<span class="aw">${esc(where)}</span>` : ''
      }<span class="ac">${price}</span>
      </button>`;
    })
    .join('');
  // A Drone's move is barred by the same one-thing-per-activation rule as its
  // Actions, so it needs that reason rather than the Mech one about Tick order.
  // And Movement is the COMMAND Phase's choice (3.2.2 ②): in the Automatic
  // Phase a Drone performs its Automatic Actions only (3.5), so the row locks.
  const dronePh = PHASES[ctx.state.round.phase];
  const droneMoveBlock = t.kind === 'drone' && isLoopPhase(dronePh) ? droneMoveWhy(dronePh) : null;
  const man = t.kind === 'mech'
    ? canManeuver(o)
    : droneMoveBlock ? { ok: false as const, why: droneMoveBlock } : canActivate(o);
  // Ticks are a Mech's Action Opportunity (3.4). A Drone or Projectile gets an
  // activation instead — one Action, no price printed on any of them — so the
  // pool is left off the way the freeplay guide leaves it off its phase panels.
  const ticks = t.kind === 'mech' ? tickPool(o) : '';
  // While a route is being drawn the panel becomes the move bar, the same way
  // the freeplay guide takes it over.
  if (movePlan && movePlan.uid === t.uid) {
    const drawn = movePlan.path.length - 1;
    return `${ticks}
      <div class="moveplan">
        <p class="tp-dim">${esc(movePlan.label)}</p>
        <p class="tp-note">${(() => {
          const p = movePlan!.preview ? Math.max(0, movePlan!.preview.length - 1) : drawn;
          if (p !== drawn) return `${drawn} → ${p} of ${movePlan!.steps} grids`;
          return drawn
            ? `${drawn} of ${movePlan!.steps} grids`
            : `Click a lit grid to move. Up to ${movePlan!.steps} grid${movePlan!.steps === 1 ? '' : 's'}.`;
        })()}</p>
        <p class="tp-dim">Click a lit grid to move there. Click further on to add a waypoint, right-click or Backspace steps back.</p>
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
  // The Overloading Pack buys Action Ticks with Link, two at most an
  // Opportunity. They are ordinary Action Ticks, so a pair pays for a Medium
  // Action — which no pair of Extra Ticks can do.
  const overloadIds = new Set(ctx.data.overload.map((g) => g.actionId));
  const hasOverload = tokenCards(ctx.data, t).some(({ card }) => (card.actions ?? []).some((a) => overloadIds.has(a.id)));
  const ovl = hasOverload ? canOverload(o, t.link ?? 0) : null;
  const ovlRow = ovl
    ? `<button class="actrow k-tactic${ovl.ok ? '' : ' warn'}"${ovl.ok ? '' : ` data-why="${esc(ovl.why ?? '')}"`} data-act="overload" title="${esc(ovl.ok ? `Consume 1 Link for 1 Action Tick, up to ${OVERLOAD_MAX} an Action Opportunity.` : ovl.why ?? '')}">
        <span class="dotk"></span><span class="an">Overload</span><span class="ac">${o.overload}/${OVERLOAD_MAX} · Link ${t.link ?? 0}</span></button>`
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
  const stanceRow = !shutdown && t.kind === 'mech'
    ? `<div class="tp-group stancegroup">
        <div class="tp-label">Stance${stanceSet ? ' <em>· set for this Opportunity</em>' : ''}</div>
        <div class="stancerow">${active
          .map((x) => `<button class="stancebtn${t.stance === x ? ' sel' : ''}"${
            stanceSet && t.stance !== x ? ' disabled' : ''
          } data-stance="${x}">${x[0].toUpperCase()}${x.slice(1)}</button>`)
          .join('')}</div>
      </div>`
    : '';
  const rebootRow = shutdown && t.kind === 'mech'
    ? `<p class="tp-note">${esc(t.label)} is in Shutdown Stance, so Reboot is the only thing it may do (4.1.1).</p>
       <div class="stancerow">${active
        .map((x) => `<button class="stancebtn" data-reboot="${x}">Reboot to ${x[0].toUpperCase()}${x.slice(1)}</button>`)
        .join('')}</div>`
    : '';
  // Only a Mech has both a Maneuver and Movement Actions to tell apart. A Drone
  // just moves, so calling its one option a Maneuver invented a distinction the
  // card never makes.
  const moveWord = t.kind === 'mech' ? 'Maneuver' : 'Movement';
  const moveTip = man.ok
    ? t.kind === 'mech'
      ? `Draw a route, then confirm. The Maneuver Value comes off the Chassis Card${t.stance === 'mobility' ? ', doubled by Mobility Stance' : ''}. A Movement Action carries its own Range.`
      : 'Draw a route, then confirm. This activation buys a Movement or an Action, not both (2.4.1).'
    : man.why ?? '';
  return `${ticks}${stanceRow}${rebootRow}
    <div class="tp-group">
      <div class="tp-label">Actions</div>
      <button class="actrow k-moving${man.ok ? '' : ' warn'}"${man.ok ? '' : ` data-why="${esc(man.why ?? '')}"`} data-act="maneuver" title="${esc(moveTip)}">
        <span class="dotk"></span><span class="an">${moveWord}</span><span class="ac">${maneuverRange(ctx.data, t)} ${maneuverRange(ctx.data, t) === 1 ? 'grid' : 'grids'}${t.stance === 'mobility' && t.kind === 'mech' ? ' ×2' : ''}</span></button>
      ${ovlRow}
      ${rows}
    </div>`;
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
    return `<button class="bigbtn" data-act="advance"${disabled ? ' disabled' : ''}>${label}</button>`;
  }
  const r = ctx.state.ready ?? {};
  if (!r[ctx.seat]) {
    const other: Side = ctx.seat === 's1' ? 's2' : 's1';
    return `<button class="bigbtn" data-act="advance"${disabled ? ' disabled' : ''}>${label}${r[other] ? ` · ${squadLabel(other)} is ready` : ''}</button>`;
  }
  const other: Side = ctx.seat === 's1' ? 's2' : 's1';
  return `<button class="bigbtn ghost2" data-act="advance">✓ Waiting for ${squadLabel(other)} — tap to withdraw</button>`;
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
        return head('Waiting', `${squadLabel(t.side)} is acting`, `${esc(t.label)} · ${phase} Phase.`, false)
          + `<div class="tp-body">${waiting(t.side, 'resolving its action')}</div><div class="tp-foot"></div>`;
      }
      return head('Your move', esc(t.label), phase === 'Command' ? 'One Command Action, or move it.' : 'Resolve its action, then end.', true)
        + `<div class="tp-body">${actionButtons(ctx, t, sc.opp)}</div>
          <div class="tp-foot">${rollbackOffer(ctx)}<button class="bigbtn" data-act="endopp">End this activation</button></div>`;
    }
  }
  if (loopComplete(s, phase)) {
    return head(phase, `${phase} Phase complete`, '', true)
      + `<div class="tp-body">${tokens}</div><div class="tp-foot">${advanceBtn(ctx, 'Continue')}</div>`;
  }
  const turn = canAct(s, phase, sc.turn) ? sc.turn : (nextTurn(s, phase, sc.turn) ?? sc.turn);
  if (!mine(ctx, turn)) {
    return head('Waiting', `${squadLabel(turn)} designates`, '', false)
      + `<div class="tp-body">${tokens}${waiting(turn, `picking a ${phase === 'Delay' ? 'projectile' : 'drone'} or passing`)}</div><div class="tp-foot"></div>`;
  }
  const units = eligibleUnits(s, phase, turn);
  const rows = units.map((t) => `<button class="rowwide" data-designate="${t.uid}">${esc(t.label)}<span class="ct">${t.kind}</span></button>`).join('');
  return head('Your move', phase === 'Command' ? 'Command a drone' : phase === 'Delay' ? 'Activate a projectile' : 'Activate a drone', 'Or pass for the phase.', true)
    + `<div class="tp-body">${tokens}${rows}</div>
      <div class="tp-foot">${rollbackOffer(ctx)}<button class="bigbtn ghost2" data-act="pass">Pass</button></div>`;
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
    return head('Waiting', `${squadLabel(t.side)} is acting`, `${esc(t.label)} · ${esc(timing)}.`, false)
      + `<div class="tp-body">${waiting(t.side, 'taking its Action Opportunity')}</div><div class="tp-foot"></div>`;
  }
  return head('Your move', `${esc(t.label)} · ${esc(timing)}`, '1 Maneuver, 2 Action ticks.', true)
    + `<div class="tp-body">${actionButtons(ctx, t, o)}</div>
      <div class="tp-foot"><button class="bigbtn" data-act="endopp">End this Opportunity</button></div>`;
}

function endPanel(ctx: HudCtx): string {
  const s = ctx.state;
  const sc = ensureScript(s);
  const smoke = s.smoke ?? [];
  const steps: { id: string; label: string }[] = [
    { id: 'tokens', label: 'Age tokens & clear Command pools' },
    // Only offered when there is smoke to judge, so a game that never sees a
    // grenade never grows a step it cannot do anything with.
    ...(smoke.length ? [{ id: 'smoke', label: `Smoke dissipation · ${smoke.length} screen${smoke.length === 1 ? '' : 's'}` }] : []),
    { id: 'remove', label: 'Integrity Loss: remove spent Mechs' },
    { id: 'tasks', label: 'Settle Task control' },
  ];
  const rows = steps
    .map((st) => {
      const done = sc.endDone.includes(`${s.round.n}:end:${st.id}`);
      return `<button class="rowwide${done ? ' donerow' : ''}" data-endstep="${st.id}"${done ? ' disabled' : ''}>${done ? '✓ ' : ''}${st.label}</button>`;
    })
    .join('');
  const all = steps.every((st) => sc.endDone.includes(`${s.round.n}:end:${st.id}`));
  const last = s.round.n >= (s.roundLimit ?? 5);
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
    <div class="dialrow"><span class="nm s1">${squadLabel('s1')} · ${vp.s1} VP</span>${plusBtn('s1')}</div>
    <div class="dialrow"><span class="nm s2">${squadLabel('s2')} · ${vp.s2} VP</span>${plusBtn('s2')}</div>
    ${owed.lines.length
      ? `<div class="sect2" style="margin-top:10px">This round earns</div>
         ${owed.lines.map((l) => `<div class="dialrow"><span class="nm ${l.side}">${esc(l.why)}</span><span class="pickchip set">+${l.vp}</span></div>`).join('')}
         <p class="tp-note">${ctx.networked
           ? 'Read off the board, and added by itself when Settle Task control is pressed — nothing to add by hand.'
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
  const res = gameResult(normaliseTasks(ctx.state.tasks), ctx.state.tokens);
  const winner = res.winner;
  const verdict = winner
    ? `${squadLabel(winner)} wins ${Math.max(vp.s1, vp.s2)}–${Math.min(vp.s1, vp.s2)}`
    : `A draw at ${vp.s1} VP each`;
  const rows = (['s1', 's2'] as Side[])
    .map((side) => `<div class="dialrow"><span class="nm ${side}">${squadLabel(side)}</span><span class="pickchip${winner === side ? ' set' : ''}">${vp[side]} VP</span></div>`)
    .join('');
  const foot = recorded
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
  // When the attacker's window is mirrored on this screen, the roll button
  // lives in it — everything about the attack in one place. The turn panel
  // only points there. The button stays HERE when no mirror was published,
  // so an attacker on an older build still gets an answer.
  const mirrored = !!ensureScript(s).combatView;
  return head('Your move', `${esc(target?.label ?? 'Your unit')} is under fire`,
    `${esc(attacker?.label ?? 'The enemy')} attacks with ${esc(a?.name?.en || call.actionId)}.`, true)
    + `<div class="tp-body">
        <p class="tp-note">${mirrored
          ? `The combat window has the attack — your defence roll (<b>${esc(pool)}</b>) is in it.`
          : `Roll your defence: <b>${esc(pool)}</b>. Both players see the dice land, and the attack resolves once they do.`}</p>
      </div>
      <div class="tp-foot">${mirrored ? '' : `<button class="bigbtn" data-act="rolldefense">🎲 Roll ${esc(pool)}</button>`}</div>`;
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
  // A dropped Black Box is asked for in the middle of the attack that caused it
  // (5.3.1), so it has to outrank the combat window's own panel — the helper
  // keeps the dice, this keeps the question.
  if (boxDrop) return boxDropPanel(ctx);
  if (ctx.combatBusy()) {
    return head('Your move', 'Resolving the attack', 'The combat window has the dice.', true)
      + '<div class="tp-body"><p class="tp-note">The combat window has it. Everything it settles is applied for you<br>and reaches the other player on its own.</p></div><div class="tp-foot"></div>';
  }
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
  // else on both screens until it is closed.
  if (ensureScript(s).counter) return counterPanel(ctx);
  if (ewPick) return ewPanel(ctx);
  if (crushPlan?.queue.length) return crushPanel(ctx);
  if (resupplyPick) return resupplyPanel(ctx);
  if (terminalPick) return terminalPanel(ctx);
  if (repairPick) return repairPanel(ctx);
  if (chargePlan) return chargePanel(ctx);
  if (attackPick) return attackPanel(ctx);
  if (smokePlan) return smokePanel(ctx);
  if (smokeOwed?.length) return smokeChoicePanel(ctx);
  if (shovePlan) return shovePanel(ctx);
  if (detonateNow) return detonatePanel(ctx);
  // Interception fires the instant a Projectile is Launched and is resolved
  // before play goes on (4.9), so it outranks the phase — but only while there
  // is something drawable. Dead debt, whose Part or target has left the board,
  // must never take the panel over and strand the table.
  if (interceptNow || interceptPick || owedItems(ctx).length) return interceptPanel(ctx);
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
function rollbackOffer(ctx: HudCtx): string {
  // A rollback is a bargain struck between the two players. A watcher is not a
  // party to it: they cannot ask, and nobody has to answer them. send() refuses
  // the request anyway — this is so it is never put in front of them.
  if (!ctx.networked || !ctx.seat || ensureScript(ctx.state).rollback) return '';
  // The HOST's list, not this client's: it is the host that rewinds, so it is
  // the host's ring that decides what can be returned to. Read out of shared
  // state, so both seats are looking at the same menu.
  const pts = ensureScript(ctx.state).rollbackCatalog;
  if (!pts.length) return '';
  // The phase you are standing in is a target like any other, and usually the
  // one meant — it is the board as this phase BEGAN, not the board now. Named
  // differently only because "back to round 2, Action Phase" while sitting in
  // round 2's Action Phase reads like it would do nothing.
  const here = (p: { round: number; phase: number }) => p.round === ctx.state.round.n && p.phase === ctx.state.round.phase;
  const opts = pts
    .slice(-6)
    .reverse()
    .map((p) => {
      const label = here(p)
        ? `Back to the start of this ${PHASES[p.phase]} Phase`
        : `Back to round ${p.round}, ${PHASES[p.phase]} Phase`;
      // Sealed points stay on the list, disabled. Dropping them made the menu
      // quietly get shorter after a roll, which reads as the feature breaking
      // rather than as the rule it is.
      return p.available
        ? `<button class="rowwide" data-rb="${p.round}:${p.phase}">${label}</button>`
        : `<button class="rowwide" disabled title="A rollback never reaches past a die roll.">${label} — dice rolled since</button>`;
    })
    .join('');
  return `<details class="tp-rollback"><summary>Ask to roll back</summary>
    <p class="tp-dim">Both players have to agree. Anything since the point you pick is undone for both of you, and a rollback never reaches past a die roll.</p>
    ${opts}</details>`;
}

// The rollback handshake. A shared board cannot be rewound by one player, so
// one side asks and the other agrees — and the asker gets a waiting screen
// rather than a silent board.
function rollbackPanel(ctx: HudCtx): string {
  const ask = ensureScript(ctx.state).rollback!;
  const to = `round ${ask.round}, ${PHASES[ask.phase]} Phase`;
  if (mine(ctx, ask.by)) {
    return head('Rollback', 'Waiting on an answer', `You asked to go back to ${esc(to)}.`, false)
      + `<div class="tp-body">${waiting(ask.by === 's1' ? 's2' : 's1', 'answering your rollback request')}</div>
        <div class="tp-foot"><button class="bigbtn ghost2" data-rb="cancel">Withdraw</button></div>`;
  }
  return head('Rollback', `${squadLabel(ask.by)} asks to go back`, `To ${esc(to)}. Everything since then is undone for both of you.`, true)
    + `<div class="tp-body">
        <p class="tp-note">Agreeing rewinds both boards. Dice already rolled are not part of this — a rollback never reaches past a roll.</p>
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
      : `${now.label}: which Mech?`;
  const why = now.what === 'leader'
    ? 'Destroying the enemy Commander scores 10 VP and ends the game at once (5.2.3).'
    : now.side === now.by
      ? 'Named now, before anything deploys (5.2.3).'
      : `${squadLabel(now.side)} is playing for this, so you name the Mech (5.2.3).`;
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
      .map((t) => `<button class="rowwide" data-desigmech="${t.uid}" data-desigfor="${now.side}" data-desigby="${now.by}" data-desigwhat="${now.what}">${esc(t.label)}<span class="ct">${squadLabel(t.side)}</span></button>`)
      .join('');
  return head('Your move', title, why, true)
    + `<div class="tp-body">${rows}${designationSummary(ctx, owed)}</div><div class="tp-foot"></div>`;
}

// What the whole step is still waiting on, so neither player is left guessing
// why the game has not started.
function designationSummary(ctx: HudCtx, owed: Designation[]): string {
  if (owed.length < 2) return '';
  const rows = owed.slice(1)
    .map((d) => `<div class="dialrow"><span class="nm ${d.side}">${esc(d.label)}</span><span class="tp-dim">${squadLabel(d.by)} to name</span></div>`)
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
} | null = null;

export function startLaunchPlan(uid: number, actionId: string, cardId: string, label: string): void {
  const ctx = hudRef;
  if (!ctx) return;
  const t = ctx.state.tokens.find((x) => x.uid === uid);
  const a = t ? actionOn(ctx, t, actionId) : undefined;
  if (!t || !a) return;
  // Volley X caps the shots per Action and each one spends an Ammo Token, so
  // the real cap is whichever runs out first.
  const ammo = t.ammo?.[actionId];
  const shots = Math.min(volleyOf(a), ammo === undefined ? volleyOf(a) : ammo);
  if (shots <= 0) {
    ctx.noteNow(`${a.name?.en || actionId} has no Ammo Tokens left, so it cannot be performed (4.13).`);
    ctx.refresh();
    return;
  }
  launchPlan = { uid, actionId, cardId, label, left: shots, placed: 0, placedUids: [] };
  ctx.refresh();
}

// A Landing Point is a Grid within the Action's Range. Direct Fire needs sight
// of it and cannot pick a Grid terrain fills; Fire in arc needs neither.
// Mirrors landingCandidates in main.ts.
function landingCandidates(ctx: HudCtx): { c: number; r: number; ok: boolean }[] {
  const m = launchPlan;
  if (!m) return [];
  const t = ctx.state.tokens.find((x) => x.uid === m.uid);
  const a = t ? actionOn(ctx, t, m.actionId) : undefined;
  if (!t || !a) return [];
  const sight = needsSightToLanding(a);
  const range = a.range ?? 0;
  const terrain = terrainOf(ctx);
  const from = { c: Math.floor(t.col / 3), r: Math.floor(t.row / 3) };
  const out: { c: number; r: number; ok: boolean }[] = [];
  for (let c = 0; c < LG; c++) {
    for (let r = 0; r < LG; r++) {
      if (Math.abs(c - from.c) + Math.abs(r - from.r) > range) continue;
      if (sight) {
        const probe = { ...t, col: c * 3 + 1, row: r * 3 + 1, size: 1 as const };
        if (losBetween(t, probe, terrain, ctx.state.tokens) === 'blocked') continue;
        if (!standingSpot(c, r, 1, false, terrain, ctx.state.tokens, t.uid)) continue;
      }
      out.push({ c, r, ok: true });
    }
  }
  return out;
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
  // Sized off the card rather than a probe token: minting one here would burn a
  // uid the launch command then cannot reproduce on the other seat.
  const spot = standingSpot(c, r, unitSize(card), isAerial(card), terrainOf(ctx), ctx.state.tokens, undefined, { col: t.col, row: t.row });
  if (!spot) {
    ctx.noteNow(`There is no room in that Grid for ${m.label}. 4.7.2 needs the Projectile's base entirely inside the Landing Point.`);
    ctx.refresh();
    return;
  }
  const shot: Command = {
    kind: 'launch', seat: t.side, uid: t.uid,
    actionId: m.actionId, cardId: m.cardId,
    to: { col: spot.col, row: spot.row }, facing: t.facing,
  };
  // A refused launch must not have cost anything, so the Ticks are only paid
  // once this one is going through. The first Projectile down is the Action;
  // the rest of a Volley ride on the same Ticks and commitAction is a no-op.
  if (!ctx.check(shot).ok) { ctx.send(shot); ctx.refresh(); return; }
  commitAction(ctx);
  const v = ctx.send(shot);
  if (!v.ok) { ctx.refresh(); return; }
  m.placedUids.push(ctx.state.tokens[ctx.state.tokens.length - 1].uid);
  m.placed++;
  m.left--;
  // A single shot closes on its own; a volley stays open once it is spent so
  // the last Projectile can still be taken back before it counts.
  const ammoLeft = t.ammo?.[m.actionId];
  const spent = m.left <= 0 || (ammoLeft !== undefined && ammoLeft <= 0);
  if (spent && m.placed + m.left <= 1) finishLaunchPlan(ctx);
  else ctx.refresh();
}

// Interception is only owed once the launch is finished, so taking one back
// before then just undoes the placement and the Ammo that paid for it.
function undoLaunched(ctx: HudCtx): void {
  const m = launchPlan;
  if (!m || !m.placedUids.length) return;
  const uid = m.placedUids.pop()!;
  const t = ctx.state.tokens.find((x) => x.uid === m.uid);
  if (t) {
    ctx.send({ kind: 'despawn', seat: t.side, uid: t.uid, targetUid: uid });
    ctx.send({ kind: 'restoreAmmo', seat: t.side, uid: t.uid, actionId: m.actionId });
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
  const act = owner
    ? tokenCards(ctx.data, owner).flatMap(({ card }) => card.actions ?? []).find((a) => a.id === m.actionId)
    : undefined;
  if (owner && born.length && (!act || projectileDelivery(act) === 'launch')) queueInterceptsFor(ctx, owner, born);
  ctx.refresh();
}

function launchPanel(ctx: HudCtx): string {
  const m = launchPlan!;
  const t = ctx.state.tokens.find((x) => x.uid === m.uid);
  const a = t ? actionOn(ctx, t, m.actionId) : undefined;
  const total = m.left + m.placed;
  const cands = landingCandidates(ctx);
  const sight = a ? needsSightToLanding(a) : false;
  const foot = [
    m.placed ? `<button class="bigbtn ghost2" data-act="launchundo">↺ Take back the last one</button>` : '',
    `<button class="bigbtn${m.placed ? '' : ' ghost2'}" data-act="launchcancel">${m.placed ? 'Stop here' : 'Cancel'}</button>`,
  ].join('');
  return head('Your move', `Launch ${esc(m.label)}`, `${esc(a?.name?.en || m.actionId)}${total > 1 ? ` · ${m.placed} of ${total} launched` : ''}.`, true)
    + `<div class="tp-body">
        <p class="tp-note">${sight
          ? 'Direct Fire: the Landing Point must be a Grid this unit can see, and one terrain does not fill.'
          : 'Fire in arc, so no line of sight to the Landing Point is needed.'} A Landing Point is a Grid, not a unit. Nothing is targeted yet.</p>
        <p class="tp-dim">${cands.length} legal ${cands.length === 1 ? 'Grid' : 'Grids'} within Range ${a?.range ?? 0}. ${total > 1
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
// is who may be shot at (only the Aerial Unit that triggered it), that line of
// sight always exists and no Forward Arc is needed, that no Terrain or Unit
// Protection dice may be claimed, and that a survivor must be shot at again.

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
  // The id may arrive as a part key when a Tarantula is lending the Part.
  const id = actionIdOf(actionId);
  return tokenCards(ctx.data, t).flatMap(({ card }) => card.actions ?? []).find((a) => a.id === id)
    ?? loanedParts(ctx.data, ctx.state.tokens, t).flatMap(({ card }) => card.actions ?? []).find((a) => a.id === id);
}

// Mirrors noteInterception in main.ts, which is the reference implementation.
// The Range test is per ACTION rather than per unit, because one unit may carry
// two Intercept Parts of different Range and only the longer one reaches. It
// takes the whole volley, since the debt is owed once the launch is finished
// rather than once per Projectile put down.
function queueInterceptsFor(ctx: HudCtx, launcher: Token, born: Token[]): void {
  const s = ctx.state;
  // Only an AERIAL Unit triggers Interception (4.9), and five launchable cards
  // are Drones rather than Projectiles. Freeplay filters on `kind` instead;
  // across the whole card database the two agree, since no launchable Drone is
  // Aerial, but this is the test the rule actually names.
  const fresh = born.filter((p) => p.parentUid === launcher.uid && p.aerial);
  if (!fresh.length || !s.script) return;
  const owed = interceptsOwed(ctx.data, s.tokens, s.smoke ?? [], launcher, fresh);
  if (!owed.length) return;
  const defender: Side = launcher.side === 's1' ? 's2' : 's1';
  ctx.send({ kind: 'queueIntercepts', seat: launcher.side, items: owed });
  ctx.noteNow(`The launch triggers Interception: ${owed.length} attempt${owed.length === 1 ? '' : 's'} owed to ${squadLabel(defender)} (4.9).`);
}

// The owed attempts that can still be drawn. An attempt whose Part or target
// has left the board is dead debt: the guide skips those rows, and here they
// must not take the panel over either.
// ---------- Optical Camouflage reveals (4.12.2, FAQ I4/I5/I7/I10/I14) ----------
//
// Derived from the state on every read, the way this page derives everything:
// an auto-send in the glue would replay on catch-up and double-fire. The owner
// confirms with a click, and a house-rule dismissal is remembered per debt.
const revealDismissed = new Set<string>();

function mineTriggers(ctx: HudCtx): { trigger: MineTrigger; t: Token }[] {
  return minesOwed(ctx.data, ctx.state.tokens)
    .map((trigger) => ({ trigger, t: ctx.state.tokens.find((x) => x.uid === trigger.uid) }))
    .filter((x): x is { trigger: MineTrigger; t: Token } => !!x.t && mine(ctx, x.t.side));
}

function minePanel(ctx: HudCtx): string {
  const x = mineTriggers(ctx)[0];
  if (!x) return '';
  const caught = x.trigger.victims
    .map((u) => ctx.state.tokens.find((o) => o.uid === u)?.label)
    .filter((l): l is string => !!l);
  return head('Your move', `${esc(x.t.label)} Detonates`,
    `${esc(x.trigger.why)}, and a Ground Unit never Crushes a Mine - it sets it off. The Explosion catches every unit in that Grid, ally or not, and the Flying or Aerial units above it too. It causes no Reveal, and a Mech whose Chassis survives finishes its Movement (FAQ M6/M19/M22).`, true)
    + `<div class="tp-body"><p class="tp-note">In the blast: ${esc(caught.join(', ') || 'nothing else')}</p></div>
       <div class="tp-foot"><button class="bigbtn" data-minego="${x.t.uid}" data-mineact="${esc(x.trigger.actionId)}">Resolve the Detonation (4.7.6)</button></div>`;
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

// ---------- Owed reactions: Emergency Smoke (FAQ B7/D10) ----------
//
// The attacker's client queued these into `script.reactions` when the whole
// Action finished; only the DEFENDER's client may answer one, because placing
// the Screens and spending the use are commands on their own unit.
function reactionsOwed(ctx: HudCtx): { t: Token; r: { uid: number; actionId: string; count: number; range: number } }[] {
  const owed = ensureScript(ctx.state).reactions ?? [];
  return owed
    .map((r) => ({ t: ctx.state.tokens.find((x) => x.uid === r.uid)!, r }))
    // Dead debt — the unit has left the board entirely — must never strand the
    // table, the same guard the Interception queue carries.
    .filter((x) => !!x.t && mine(ctx, x.t.side));
}

function reactionPanel(ctx: HudCtx): string {
  const { t, r } = reactionsOwed(ctx)[0];
  const card = ctx.data.byId.get(t.cardId ?? '');
  const what = (card?.actions ?? []).find((a) => a.id === r.actionId);
  const name = what?.name?.en || what?.name?.zh || 'Emergency Smoke';
  return head('Your move', `${esc(t.label)}: ${esc(name)}`,
    `${esc(t.label)} was attacked, so it may place ${r.count} Smoke Screen${r.count === 1 ? '' : 's'} within Range ${r.range}. Every attack in that Action has already resolved, so these cannot shield anyone else it shot at (FAQ B7).`, true)
    + `<div class="tp-body"><p class="tp-dim">The card allows this even if the unit did not survive (FAQ D10). Taking it spends its one use.</p></div>
       <div class="tp-foot"><button class="bigbtn" data-reactgo="${t.uid}:${esc(r.actionId)}">Place them</button>
       <button class="bigbtn ghost2" data-reactskip="${t.uid}:${esc(r.actionId)}" style="margin-top:6px">Skip it</button></div>`;
}

// Both answers clear the debt; only one opens the picker. Taking it spends the
// use in the same command that clears it, so a drop mid-placement cannot leave
// a free Emergency Smoke behind.
function answerReaction(ctx: HudCtx, key: string, place: boolean): void {
  const [uidRaw, actionId] = key.split(':');
  const uid = Number(uidRaw);
  const t = ctx.state.tokens.find((x) => x.uid === uid);
  const r = (ensureScript(ctx.state).reactions ?? []).find((x) => x.uid === uid && x.actionId === actionId);
  if (!t || !r) { ctx.refresh(); return; }
  if (!ctx.send({ kind: 'resolveReaction', seat: t.side, uid, actionId }).ok) { ctx.refresh(); return; }
  if (!place) {
    ctx.noteNow(`${t.label} declines its Emergency Smoke.`);
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

function revealsOwed(ctx: HudCtx): { t: Token; key: string; why: string }[] {
  const s = ctx.state;
  const sc = ensureScript(s);
  const out: { t: Token; key: string; why: string }[] = [];
  for (const t of s.tokens) {
    if (statusCount(t.statuses, 'camouflage') === 0 || t.deployed === false) continue;
    // A non-Silence action or a non-Silent Maneuver during the CURRENT
    // Action Opportunity (FAQ I2/I5), read off the opportunity script.
    if (sc.opp?.uid === t.uid) {
      const acted = (sc.opp.performed ?? []).some((key) => {
        const id = actionIdOf(key);
        const a = tokenCards(ctx.data, t).flatMap(({ card }) => card.actions ?? []).find((x) => x.id === id);
        return a ? !isSilentAction(a) : false;
      });
      if (acted) out.push({ t, key: `${t.uid}:act:${s.round.n}`, why: 'performed a non-Silence action' });
      else if (sc.opp.maneuvered && !maneuverIsSilent(ctx.data, t)) {
        out.push({ t, key: `${t.uid}:mov:${s.round.n}`, why: 'moved without Silence' });
      }
    }
    // Contact with an enemy that is neither Aerial nor camouflaged (I4/I7),
    // including a landed enemy Mine or Beacon (I10). If the camouflage was
    // activated AFTER the contact began, that is not "ending Movement in
    // Contact" and owes nothing (I14) - the copy says so and Stay hidden is
    // the answer there. The reading itself lives in units.ts now: this page
    // matched a card NAME for the I10 case, which freeplay never did at all.
    const toucher = camoBrokenBy(ctx.data, s.tokens, t);
    if (toucher) out.push({ t, key: `${t.uid}:touch:${toucher.uid}`, why: `is in Contact with ${toucher.label}` });
  }
  return out.filter((x) => !revealDismissed.has(x.key));
}

function revealPanel(ctx: HudCtx): string {
  const owed = revealsOwed(ctx).filter((x) => mine(ctx, x.t.side));
  const x = owed[0];
  if (!x) return '';
  return head('Your move', `${esc(x.t.label)} breaks camouflage`,
    `It ${esc(x.why)}, so under 4.12.2 the Optical Camouflage ends. Reveal movement up to its Stealth value may follow - move it by hand. If the camouflage was activated after this began (FAQ I14), stay hidden.`, true)
    + `<div class="tp-body"></div>
      <div class="tp-foot"><button class="bigbtn" data-revealgo="${x.t.uid}" data-revealkey="${esc(x.key)}">Reveal it (4.12.2)</button>
      <button class="bigbtn ghost2" data-revealskip="${esc(x.key)}" style="margin-top:6px">Stay hidden (house rule)</button></div>`;
}

function owedItems(ctx: HudCtx): { uid: number; actionId: string; targetUid: number }[] {
  const s = ctx.state;
  return ensureScript(s).intercepts.filter(
    (x) => s.tokens.some((t) => t.uid === x.uid && alive(t)) && s.tokens.some((t) => t.uid === x.targetUid),
  );
}

function interceptSide(ctx: HudCtx): Side | null {
  const first = owedItems(ctx)[0];
  return ctx.state.tokens.find((t) => t.uid === first?.uid)?.side ?? null;
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
    const left = by?.intercept?.[interceptNow.actionId] ?? 0;
    return head('Your move', `Intercepting ${at ? esc(at.label) : 'the target'}`, `${by ? esc(by.label) : ''} · ${esc(a?.name?.en || interceptNow.actionId)}.`, true)
      + `<div class="tp-body">
          <p class="tp-note">Line of sight always exists and no Forward Arc is required. The target claims no Terrain or Unit Protection dice (4.9).</p>
          <p class="tp-dim">${left} Interception Token${left === 1 ? '' : 's'} left on that Part, for the rest of the game. Roll it out in the combat window.</p>
        </div>
        <div class="tp-foot"><button class="bigbtn" data-act="interceptdone">This attempt is resolved</button></div>`;
  }
  if (interceptPick) {
    const by = s.tokens.find((x) => x.uid === interceptPick!.uid);
    const a = by ? actionOn(ctx, by, interceptPick.actionId) : undefined;
    const reach = a?.range ?? 0;
    // Interception only ever attacks an Aerial Unit, which is what a Missile or
    // a Projectile is; anything else on the board is not a legal target.
    const targets = by
      ? s.tokens.filter((x) => x.side !== by.side && x.aerial && x.deployed !== false && rangeBetween(by, x).range <= reach)
      : [];
    const rows = targets
      .map((x) => `<button class="rowwide" data-inttarget="${x.uid}">${esc(x.label)}<span class="ct">Range ${rangeBetween(by!, x).range}</span></button>`)
      .join('');
    return head('Your move', 'Intercept what?', `Only the Aerial Unit that Moved or was Launched, within Range ${reach} (4.9).`, true)
      + `<div class="tp-body">${rows || `<p class="tp-note">Nothing Aerial is within Range ${reach} of ${by ? esc(by.label) : 'that Part'}.</p>`}</div>
         <div class="tp-foot"><button class="bigbtn ghost2" data-act="interceptcancel">Cancel, spend nothing</button></div>`;
  }
  const owed = owedItems(ctx);
  const side = interceptSide(ctx);
  if (side && !mine(ctx, side)) {
    return head('Waiting', `${squadLabel(side)} is intercepting`, `${owed.length} attempt${owed.length === 1 ? '' : 's'} owed (4.9).`, false)
      + `<div class="tp-body">${waiting(side, 'resolving an Interception')}</div><div class="tp-foot"></div>`;
  }
  const rows = owed
    .map((x, i) => {
      const by = s.tokens.find((t) => t.uid === x.uid)!;
      const at = s.tokens.find((t) => t.uid === x.targetUid)!;
      const a = actionOn(ctx, by, x.actionId);
      const left = by.intercept?.[x.actionId] ?? 0;
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

let ewPick: { uid: number; actionId: string } | null = null;

export function startElectronicPick(uid: number, actionId: string): void {
  ewPick = { uid, actionId };
  hudRef?.refresh();
}

function ewPanel(ctx: HudCtx): string {
  const s = ctx.state;
  const m = ewPick!;
  const by = s.tokens.find((x) => x.uid === m.uid);
  const a = by ? actionOn(ctx, by, m.actionId) : undefined;
  if (!by || !a) return head('Electronic Warfare', 'That unit is gone', '', true)
    + '<div class="tp-body"></div><div class="tp-foot"><button class="bigbtn ghost2" data-act="ewcancel">Close</button></div>';
  const reach = a.range ?? 0;
  // The unit PERFORMING the Electronic Attack counts the Loads it is borrowing
  // (FAQ O5/O6); the target, rolling passively, counts only its own Parts.
  const ev = electronicValue(ctx.data, by, loanedParts(ctx.data, s.tokens, by));
  // An allied Repeater lends its position to the shot (FAQ O19), so the Range
  // shown is the best of the attacker's own and every Repeater covering it.
  const origins = electronicOrigins(ctx.data, s.tokens, by);
  const relay = origins.slice(1);
  const enemies = s.tokens
    .filter((t) => t.side !== by.side && t.deployed !== false && alive(t))
    .map((t) => {
      const own = gridsApart(by, t);
      const best = origins.reduce((n, from) => Math.min(n, gridsApart(from, t)), own);
      const via = best < own ? origins.find((from) => gridsApart(from, t) === best) : undefined;
      return { t, d: best, via };
    });
  // An AUTOMATIC Electronic Attack targets the nearest enemy in range, ties
  // chosen by the controller (3.5.2) — an aimed one picks freely.
  const nearest = a.speed === 'auto'
    ? enemies.filter((e) => e.d <= reach).reduce((n, e) => Math.min(n, e.d), Infinity)
    : Infinity;
  const rows = enemies
    .map(({ t, d, via }) => {
      const theirs = electronicValue(ctx.data, t);
      const far = d > reach;
      const skipped = !far && a.speed === 'auto' && d > nearest;
      const bits = [
        far ? `⚠ Range ${d}, beyond this Action's Range ${reach}` : `Range ${d}${via && via.uid !== by.uid ? ` via ${via.label}` : ''}`,
        skipped ? '✕ not the nearest enemy (3.5.2)' : '',
        `Electronic Value ${theirs}`,
      ].filter(Boolean);
      const why = far
        ? `${t.label} is at Range ${d}, beyond this Action's Range ${reach}.`
        : skipped ? 'An Automatic Action targets the NEAREST enemy in range (3.5.2).' : '';
      return `<button class="rowwide targrow${far || skipped ? ' warn' : ''}"${skipped ? ' disabled' : ''} data-ewtarget="${t.uid}"${why ? ` data-why="${esc(why)}"` : ''}>
        <span class="tgname">${esc(t.label)}</span>
        <span class="tgbits">${bits.map((b) => `<span${/[⚠✕]/.test(b) ? ' class="bad"' : ''}>${esc(b)}</span>`).join('')}</span></button>`;
    })
    .join('');
  return head('Your move', `${esc(a.name?.en || m.actionId)}: which enemy?`,
    `${esc(by.label)} · Electronic Value ${ev}, Range ${reach}.${relay.length ? ` Range may be measured from ${esc(relay.map((r) => r.label).join(' or '))} instead (Repeater, FAQ O19).` : ''}`, true)
    + `<div class="tp-body">${rows || '<p class="tp-note">No enemy unit is on the board.</p>'}
        <p class="tp-dim">Only Range matters. Terrain and line of sight are ignored (4.11.1).<br>Both units roll Yellow dice equal to their Electronic Value.</p></div>
       <div class="tp-foot"><button class="bigbtn ghost2" data-act="ewcancel">Cancel</button></div>`;
}

// Whose turn it is to act inside an open Counter-roll, and what they owe.
function counterStep(ctx: HudCtx, c: CounterRoll) {
  const s = ctx.state;
  const init = s.tokens.find((x) => x.uid === c.initiatorUid);
  const resp = s.tokens.find((x) => x.uid === c.responderUid);
  if (!init || !resp) return null;
  const both = c.initRoll !== null && c.respRoll !== null;
  return {
    init,
    resp,
    both,
    initEv: electronicValue(ctx.data, init, loanedParts(ctx.data, s.tokens, init)),
    respEv: electronicValue(ctx.data, resp),
  };
}

function counterVerdict(ctx: HudCtx, c: CounterRoll, init: Token, resp: Token) {
  const dice = ctx.diceData;
  if (!dice || !c.initRoll || !c.respRoll) return null;
  // Hollow faces count for a roller in Offensive Stance, so each side's dice
  // are read under its own stance (4.11.3).
  const a = tallyCounter(dice, c.initRoll, init.stance === 'offensive');
  const b = tallyCounter(dice, c.respRoll, resp.stance === 'offensive');
  return { a, b, ...resolveCounterRoll(a, b) };
}

function counterPanel(ctx: HudCtx): string {
  const s = ctx.state;
  const c = ensureScript(s).counter!;
  const step = counterStep(ctx, c);
  if (!step) {
    return head('Electronic Warfare', 'A unit in the Counter-roll is gone', '', true)
      + '<div class="tp-body"></div><div class="tp-foot"><button class="bigbtn" data-act="ewclose">Close it</button></div>';
  }
  const { init, resp, initEv, respEv } = step;
  const a = actionOn(ctx, init, c.actionId);
  const name = a?.name?.en || c.actionId;
  const sub = `${esc(init.label)} EV ${initEv} vs ${esc(resp.label)} EV ${respEv}.`;
  const rolled = (t: Token, faces: number[] | null) => faces
    ? `<span class="rolldice">${faces.map((f) => dieHtml(ctx, { color: 'yellow', face: f })).join('')}</span>`
    : `<span class="tp-dim">not rolled</span>`;
  const board = `<div class="dialrow"><span class="nm ${init.side}">${esc(init.label)}</span>${rolled(init, c.initRoll)}</div>
    <div class="dialrow"><span class="nm ${resp.side}">${esc(resp.label)}</span>${rolled(resp, c.respRoll)}</div>`;

  // Each seat is asked only about its own unit, which is what makes the whole
  // thing sendable: a player never issues a command for the other's Mech.
  const owed: { t: Token; ev: number; faces: number[] | null; focused: boolean }[] = [
    { t: init, ev: initEv, faces: c.initRoll, focused: c.initFocused },
    { t: resp, ev: respEv, faces: c.respRoll, focused: c.respFocused },
  ];
  const mineNow = owed.find((o) => mine(ctx, o.t.side) && o.faces === null);
  if (mineNow) {
    return head('Your move', `${esc(name)}: roll the Counter-roll`, sub, true)
      + `<div class="tp-body">${board}
          <p class="tp-note">${esc(mineNow.t.label)} rolls ${mineNow.ev} Yellow ${mineNow.ev === 1 ? 'die' : 'dice'}${mineNow.t.stance === 'offensive' ? ', and Offensive Stance makes hollow faces count' : ''}.</p></div>
         <div class="tp-foot"><button class="bigbtn" data-ewroll="${mineNow.t.uid}">🎲 Roll ${mineNow.ev} ${mineNow.ev === 1 ? 'die' : 'dice'}</button></div>`;
  }
  if (!step.both) {
    const waitOn = owed.find((o) => o.faces === null)!;
    return head('Waiting', `${squadLabel(waitOn.t.side)} is rolling`, sub, false)
      + `<div class="tp-body">${board}</div><div class="tp-foot"></div>`;
  }

  const v = counterVerdict(ctx, c, init, resp);
  const line = v
    ? `${esc(init.label)} ${v.initiatorWins ? 'succeeds' : 'fails'}. ${esc(v.why)}.`
    : 'Both sides have rolled.';
  // Focus is offered after the verdict is visible, which is when a player
  // actually knows whether they need it (4.10).
  // The last Link can never be spent voluntarily (4.10, FAQ L1).
  const canFocus = owed.filter((o) => mine(ctx, o.t.side) && !o.focused && (o.t.link ?? 0) > 1);
  const focusRows = canFocus
    .map((o) => `<button class="rowwide" data-ewfocus="${o.t.uid}">Focus with ${esc(o.t.label)}<span class="ct">1 Link · ${o.t.link} left</span></button>`)
    .join('');
  const winner = v?.initiatorWins ? init : resp;
  const iOwn = mine(ctx, init.side);
  return head(iOwn ? 'Your move' : 'Waiting', v?.initiatorWins ? 'The Counter-roll succeeds' : 'The Counter-roll fails', sub, iOwn)
    + `<div class="tp-body">${board}
        <p class="tp-note">${line}</p>
        ${v ? `<p class="tp-dim">Lightning ${v.a.lightning}–${v.b.lightning}, Light Hit ${v.a.light}–${v.b.light}. A tie on both goes to the Initiator (4.11.2).</p>` : ''}
        <p class="tp-dim">${esc(winner.label)} won this Counter-roll, so any "on successful Counter-roll" Passive it carries triggers. That works for the Responder too.</p>
        ${focusRows ? `<div class="sect2" style="margin-top:10px">Reroll with Focus</div><p class="tp-dim">1 Link, once each, and the verdict is re-read from the new dice.</p>${focusRows}` : ''}
      </div>
      <div class="tp-foot">${iOwn && v?.initiatorWins
        ? `<button class="bigbtn" data-ewapply="1">Apply ${esc(name)} to ${esc(resp.label)}</button><button class="bigbtn ghost2" data-act="ewclose" style="margin-top:6px">Done</button>`
        : '<button class="bigbtn" data-act="ewclose">Done</button>'}</div>`;
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
let boxPick: { uid: number; queue: string[]; slotFor?: string } | null = null;
// The attacker choosing where a Penetrated bearer's Box lands.
let boxDrop: { itemId: string; bearerUid: number; bySide: Side; byUid: number } | null = null;

function taskItems(ctx: HudCtx) {
  return normaliseTasks(ctx.state.tasks).items;
}

// A Part already bearing a Box has its Freehand treated as invalid (5.3.1).
function freeHandsFor(ctx: HudCtx, t: Token) {
  const taken = taskItems(ctx).filter((i) => i.bearerUid === t.uid && i.bearerSlot).map((i) => i.bearerSlot!);
  return freehandSlots(ctx.data, t, taken);
}

// Called once a Movement has landed: every loose Box in a Grid the route passed
// through is offered, which is the reading freeplay uses.
function offerBoxesOn(ctx: HudCtx, uid: number, path: LargeGrid[]): void {
  const on = taskItems(ctx).filter((i) => i.kind === 'blackbox' && i.bearerUid === undefined
    && i.col !== undefined && i.row !== undefined
    && path.some((g) => g.c === Math.floor(i.col! / 3) && g.r === Math.floor(i.row! / 3)));
  if (on.length) boxPick = { uid, queue: on.map((i) => i.id) };
}

// Auto Mine Laying, offered on the same signal as the Boxes: the route just
// walked. `left` is how many more the unspent Move Range can pay for, so it
// counts down as they go in rather than being asked once (FAQ M7/M29).
let minePick: (MineLaying & { left: number; flight: boolean }) | null = null;

function offerMinesOn(ctx: HudCtx, t: Token, path: LargeGrid[], steps: number, flying: boolean): void {
  const spare = steps - pathCost(path, flying || !!t.aerial, moveOptsFor(ctx, t, flying));
  const lay = minesLayable(ctx.data, t, path, spare, flying || !!t.aerial);
  if (lay) minePick = { ...lay, left: lay.max, flight: flying || !!t.aerial };
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
    .map((g) => `<button class="rowwide" data-minelay="${g.c},${g.r}">${esc(gridName(g.c, g.r))}<span class="ct">lay here</span></button>`)
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
  if (ctx.send({
    kind: 'layMine', seat: t.side, uid: t.uid, actionId: m.actionId, cardId: m.cardId, to: { col: c * 3 + 1, row: r * 3 + 1 },
  }).ok) {
    ctx.noteNow(`${t.label} Lays ${cardName(ctx.data.byId.get(m.cardId))} in ${gridName(c, r)}, paid for with 1 Move Range.`);
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
  return head('Your move', `Pick up the Black Box in ${where}?`, hands.length > 1 ? 'Which Part carries it?' : 'Picking one up is optional.', true)
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
    ctx.noteNow(`${t.label} picks up the Black Box, carried on the ${freehandSlots(ctx.data, t).find((h) => h.slot === slot)?.label ?? slot}.`);
  }
  nextBox(ctx);
}

function nextBox(ctx: HudCtx): void {
  if (!boxPick) return;
  boxPick.queue.shift();
  if (!boxPick.queue.length) boxPick = null;
  ctx.refresh();
}

// Where a dropped Box may land: the bearer's own Grid or one touching it.
function dropGrids(ctx: HudCtx, bearer: Token): LargeGrid[] {
  const g = { c: Math.floor(bearer.col / 3), r: Math.floor(bearer.row / 3) };
  const terrain = terrainOf(ctx);
  const out: LargeGrid[] = [];
  for (const [dc, dr] of [[0, 0], [0, -1], [1, 0], [0, 1], [-1, 0], [1, -1], [1, 1], [-1, 1], [-1, -1]] as const) {
    const c = g.c + dc;
    const r = g.r + dr;
    if (c < 0 || r < 0 || c >= LG || r >= LG) continue;
    // A dropped Box sits at ground level and cannot go on top of a building
    // (FAQ P9). Units do not block it — a Box may overlap one (P8) — so the
    // test is against terrain alone.
    if (!canStandIn(c, r, 1, false, terrain, [], undefined)) continue;
    out.push({ c, r });
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
  if (!bearer) {
    return head('Black Box', 'The bearer is gone', '', true)
      + '<div class="tp-body"></div><div class="tp-foot"><button class="bigbtn ghost2" data-act="boxdropclose">Close</button></div>';
  }
  if (!mine(ctx, m.bySide)) {
    return head('Waiting', `${squadLabel(m.bySide)} places the Black Box`, `${esc(bearer.label)} was Penetrated carrying one.`, false)
      + `<div class="tp-body">${waiting(m.bySide, 'saying where the Box lands')}</div><div class="tp-foot"></div>`;
  }
  const rows = dropGrids(ctx, bearer)
    .map((g) => `<button class="rowwide" data-boxdrop="${g.c}:${g.r}">${gridName(g.c, g.r)}<span class="ct">${g.c === Math.floor(bearer.col / 3) && g.r === Math.floor(bearer.row / 3) ? 'under it' : 'in contact'}</span></button>`)
    .join('');
  return head('Your move', 'Where does the Black Box land?', `${esc(bearer.label)} was Penetrated and drops it. As the attacker, you choose (5.3.1).`, true)
    + `<div class="tp-body">${rows}
        <p class="tp-dim">In contact with the bearer's base, its own Grid included.<br>The choices are lit on the board.</p></div>
       <div class="tp-foot"></div>`;
}

function placeDroppedBox(ctx: HudCtx, c: number, r: number): void {
  const m = boxDrop;
  if (!m) return;
  const bearer = ctx.state.tokens.find((x) => x.uid === m.bearerUid);
  boxDrop = null;
  board?.clearHighlights();
  if (ctx.send({ kind: 'dropBlackBox', seat: m.bySide, uid: m.byUid, itemId: m.itemId, to: { col: c * 3 + 1, row: r * 3 + 1 } }).ok) {
    ctx.noteNow(`${bearer?.label ?? 'The bearer'} was Penetrated carrying a Black Box, which lands in ${gridName(c, r)} (5.3.1).`);
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
// where, one with nowhere to go swaps places with the crusher, and one that
// cannot be Force-Moved at all is destroyed instead.
//
// The victims are cleared before the crusher lands, which is the order freeplay
// uses — moving the crusher in first would make the swap case place a unit into
// the Grid it is being pushed out of.

let crushPlan: {
  uid: number;
  goal: LargeGrid;
  terrain: string[];
  queue: number[];
  stops: { col: number; row: number }[];
  // A picked escape grid waiting on the facing choice (3.4.4, FAQ L6).
  pendingSpot?: { col: number; row: number; c: number; r: number; facing?: Facing };
  free?: boolean;
  granted?: boolean;
  shoveActionId?: string;
  facing?: Facing;
  // The route, kept so the Boxes it walked over are still offered once the
  // crush has been worked through — and with it the budget it was drawn
  // against, since Auto Mine Laying is priced in the Move Range left over
  // and M7 allows Laying and Crushing inside one Movement.
  path: LargeGrid[];
  steps: number;
  flying: boolean;
} | null = null;

// Where a crushed Unit may be pushed: an orthogonal neighbour that is on the
// board, is not the Grid being crushed into, and has room for it.
function crushEscapes(ctx: HudCtx, v: Token, goal: LargeGrid): LargeGrid[] {
  const from = { c: Math.floor(v.col / 3), r: Math.floor(v.row / 3) };
  return ([[0, -1], [1, 0], [0, 1], [-1, 0]] as const)
    .map(([dc, dr]) => ({ c: from.c + dc, r: from.r + dr }))
    .filter((g) => g.c >= 0 && g.r >= 0 && g.c < LG && g.r < LG)
    .filter((g) => !(g.c === goal.c && g.r === goal.r))
    .filter((g) => standingSpot(g.c, g.r, v.size, v.aerial, terrainOf(ctx), ctx.state.tokens, v.uid) !== null);
}

// Works the queue down, handling everything that needs no choice, and stops as
// soon as it reaches a victim the player has to place.
function advanceCrush(ctx: HudCtx): void {
  const m = crushPlan;
  if (!m) return;
  const s = ctx.state;
  const crusher = s.tokens.find((x) => x.uid === m.uid);
  if (!crusher) { crushPlan = null; ctx.refresh(); return; }
  if (m.terrain.length) {
    ctx.send({ kind: 'destroyTerrain', seat: crusher.side, uid: crusher.uid, pieces: m.terrain });
    ctx.noteNow(`${crusher.label} crushes ${m.terrain.length === 1 ? 'a piece of' : `${m.terrain.length} pieces of`} Destructible Terrain in ${gridName(m.goal.c, m.goal.r)}.`);
    m.terrain = [];
  }
  while (m.queue.length) {
    const v = s.tokens.find((x) => x.uid === m.queue[0]);
    if (!v) { m.queue.shift(); continue; }
    if (!canBeForceMoved(ctx.data, v)) {
      ctx.send({ kind: 'despawn', seat: crusher.side, uid: crusher.uid, targetUid: v.uid });
      ctx.noteNow(`${v.label} cannot be Force-Moved, so being crushed destroys it (4.3.6).`);
      m.queue.shift();
      continue;
    }
    const out = crushEscapes(ctx, v, m.goal);
    if (!out.length) {
      // Nowhere to go: the two swap, which is the crusher's Grid as it stands
      // now — it has not moved yet.
      const swap = standingSpot(Math.floor(crusher.col / 3), Math.floor(crusher.row / 3), v.size, v.aerial, terrainOf(ctx), s.tokens, v.uid);
      if (swap) {
        ctx.send({ kind: 'forceMove', seat: crusher.side, uid: crusher.uid, targetUid: v.uid, to: swap });
        ctx.noteNow(`${v.label} had nowhere to go, so it swaps places with ${crusher.label}.`);
      }
      m.queue.shift();
      continue;
    }
    return; // this one needs the player to choose
  }
  finishCrush(ctx);
}

function finishCrush(ctx: HudCtx): void {
  const m = crushPlan;
  crushPlan = null;
  board?.clearHighlights();
  if (!m) { ctx.refresh(); return; }
  const t = ctx.state.tokens.find((x) => x.uid === m.uid);
  const last = m.stops[m.stops.length - 1];
  if (!t || !last) { ctx.refresh(); return; }
  // The Grid is clear now, so the crusher takes the spot it can actually stand
  // in rather than the one computed before anything gave way.
  const spot = standingSpot(m.goal.c, m.goal.r, t.size, t.aerial, terrainOf(ctx), ctx.state.tokens, t.uid) ?? last;
  const stops = [...m.stops.slice(0, -1), spot];
  board?.animateMove(t.uid, stops, () => {
    ctx.send({ kind: 'maneuver', seat: t.side, uid: t.uid, to: spot, free: m.free, granted: m.granted, via: stops, facing: m.facing });
    ctx.noteNow(`${t.label} crushes into ${gridName(m.goal.c, m.goal.r)}, and its Movement ends there (4.3.6).`);
    offerMinesOn(ctx, t, m.path, m.steps, m.flying);
    offerBoxesOn(ctx, t.uid, m.path);
    if (m.shoveActionId) startShove(t.uid, m.shoveActionId);
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
  ctx.send({ kind: 'forceMove', seat: crusher.side, uid: crusher.uid, targetUid: v.uid, to: { col: p.col, row: p.row }, facing: p.facing });
  ctx.noteNow(`${crusher.label} crushes ${v.label}, Force-Moved to ${gridName(p.c, p.r)}.`);
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
    return head('Your move', `Crush: which way does ${esc(v.label)} face?`, `Force-Moved to ${gridName(p.c, p.r)} — you choose the facing too (3.4.4).`, true)
      + `<div class="tp-body">
          <div class="dialrow"><span class="nm">Facing</span><div class="btnrow">${opts}<button class="rowbtn${p.facing === undefined ? ' on' : ''}" data-crushface="">leave</button></div></div>
        </div>
        <div class="tp-foot"><button class="bigbtn" data-act="crushgo">Confirm</button></div>`;
  }
  const out = crushEscapes(ctx, v, m.goal);
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
// unaccessed Terminal within reach, then how the Electronic Counter-roll
// against its printed Value of 3 came out. `itemId` set means the Terminal is
// chosen and the second question is up.
let terminalPick: { uid: number; actionId: string; reach: number; itemId?: string } | null = null;

let resupplyPick: { uid: number; actionId: string; rule: Resupply } | null = null;

// ---------- SH-15 Damage Control (FAQ D7/J21/J23) ----------
let repairPick: { uid: number; actionId: string; repair: boolean; mend: boolean } | null = null;

function repairPanel(ctx: HudCtx): string {
  const m = repairPick!;
  const t = ctx.state.tokens.find((x) => x.uid === m.uid);
  const a = t ? actionOn(ctx, t, m.actionId) : undefined;
  if (!t || !a) return head('Repair', 'That unit is gone', '', true)
    + '<div class="tp-body"></div><div class="tp-foot"><button class="bigbtn ghost2" data-act="repaircancel">Close</button></div>';
  const rows: string[] = [];
  for (const { slot, card } of tokenCards(ctx.data, t)) {
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
    if (gridsApart(from, o) > rule.range) return false;
    const max = tokenCards(ctx.data, o).flatMap(({ card }) => card.actions ?? []).find((a) => a.id === rule.actionId)?.storage;
    if (!max) return false;
    return (o.ammo?.[rule.actionId] ?? max) < max;
  });
}

// The two questions freeplay asks, in the same order: which Terminal, then how
// the roll went. The verdict is the players' own reading of the dice — the
// same honesty the freeplay confirm asks for, with the tray in the shared feed.
function terminalPanel(ctx: HudCtx): string {
  const m = terminalPick!;
  const s = ctx.state;
  const t = s.tokens.find((x) => x.uid === m.uid);
  if (!t) return head('Remote Access', 'That unit is gone', '', true)
    + '<div class="tp-body"></div><div class="tp-foot"><button class="bigbtn ghost2" data-act="terminalcancel">Close</button></div>';
  const zoneName = (id: string) => ctx.data.zoneData.zones.find((z) => z.id === id)?.name ?? id;
  if (m.itemId) {
    return head('Your move', `Remote Access on ${esc(zoneName(normaliseTasks(s.tasks).items.find((i) => i.id === m.itemId)?.zone ?? ''))}`,
      'Make the Electronic Counter-roll now, against the Terminal\'s Electronic Value of 3.', true)
      + `<div class="tp-body"><p class="tp-note">Roll your Electronic dice from the panel — both players see them land in the feed.</p></div>
         <div class="tp-foot">
           <button class="bigbtn" data-tverdict="won">It succeeded</button>
           <button class="bigbtn ghost2" data-tverdict="lost">It failed</button>
         </div>`;
  }
  const from = largeGridOf(t);
  const open = normaliseTasks(s.tasks).items.filter((i) => {
    if (i.kind !== 'terminal' || i.accessed) return false;
    const centre = zoneCentreGrid(ctx.data.zoneData.zones, i.zone);
    return !!centre && Math.abs(centre.c - from.c) + Math.abs(centre.r - from.r) <= m.reach;
  });
  const rows = open
    .map((i) => `<button class="rowwide" data-terminal="${esc(i.id)}">${esc(zoneName(i.zone))}<span class="ct">Terminal · EV 3</span></button>`)
    .join('');
  return head('Your move', 'Remote Access: which Terminal?', `A Terminal within Range ${m.reach} that has not been accessed this round (5.3.3).`, true)
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

let chargePlan: { uid: number; on: boolean; actionId?: string } | null = null;

function chargePanel(ctx: HudCtx): string {
  const s = ctx.state;
  const m = chargePlan!;
  const t = s.tokens.find((x) => x.uid === m.uid);
  if (!t) return head('Charge', 'That unit is gone', '', true)
    + '<div class="tp-body"></div><div class="tp-foot"><button class="bigbtn ghost2" data-act="chargecancel">Close</button></div>';
  const slots = chargeableSlots(ctx.data, t).filter((x) => x.charged !== m.on);
  const rows = slots
    .map((x) => `<button class="rowwide" data-chargeslot="${esc(String(x.slot))}">${esc(x.label)}<span class="ct">${m.on ? 'turn face-up' : 'spend it'}</span></button>`)
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
  void offerCoordination(ctx.data, ctx.state, t, upTo, (mechUid, targetUid) => {
    ctx.send({ kind: 'coordinateCommand', seat: t.side, uid: mechUid, targetUid });
    ctx.refresh();
  }, (_drone, text) => ctx.noteNow(text));
}

// Backing out. The Extra Action Opportunity an Action would have handed out goes
// with it, or a cancelled Action could still be paying for someone else's turn.
function dropAction(): void {
  pendingAction = null;
  grantPick = null;
}

// Targeting. An Electronic Attack is answered by the defender rather than rolled
// against, so it opens the Counter-roll handshake instead (4.11).
function openAttackPick(t: Token, a: CardAction): void {
  if (isElectronicAttack(a)) ewPick = { uid: t.uid, actionId: a.id };
  else attackPick = { uid: t.uid, actionId: a.id };
}

// Returns true when it has opened a tool that will report back — the Ticks then
// wait in `pendingAction` until that tool succeeds. False means the Action is
// already done and should be paid for now.
function routeAction(ctx: HudCtx, t: Token, a: CardAction, ga?: ReturnType<typeof guidedActions>[number]): boolean {
  // First, as it is in performGuided. Remote Access is typed like card text but
  // resolves against the board — without this branch it fell through to
  // "follow the card text" and a Terminals mission could not be scored online.
  if (a.id === 'COMMON_REMOTE_ACCESS') {
    terminalPick = { uid: t.uid, actionId: a.id, reach: a.range ?? 4 };
    return true;
  }
  if (isChargeAction(a)) {
    chargePlan = { uid: t.uid, on: true };
    return true;
  }
  const supply = resupplyOf(a);
  if (supply) {
    resupplyPick = { uid: t.uid, actionId: a.id, rule: supply };
    return true;
  }
  const rep = repairSpec(a);
  if (rep) {
    repairPick = { uid: t.uid, actionId: a.id, repair: rep.repair, mend: rep.mend };
    return true;
  }
  // An Electronic Attack opens the Counter-roll targeting whatever its printed
  // TYPE says — the Raven's Fire Control Interference is typed Tactic, and
  // keying on the type let it fall through to "follow the card text" (4.11).
  if (isElectronicAttack(a)) {
    openAttackPick(t, a);
    return true;
  }
  if (a.type === 'Firing' || a.type === 'Melee') {
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
  if (isPositionSwap(a)) {
    // Both facings start unanswered. Seeding this one with t.facing would skip
    // the Taurus's own question and leave freeplay asking three things where
    // the Match Centre asks two.
    blinkPlan = { uid: t.uid, actionId: a.id, targetUid: null, facing: null, targetFacing: null };
    ctx.refresh();
    return true;
  }
  if (a.type === 'Moving') {
    startMovePlan(ctx, t, {
      range: a.range || undefined,
      label: `${a.name?.en || a.id} · Range ${a.range || maneuverRange(ctx.data, t)}`,
      shoveActionId: knockbackOf(a, ctx.data.actionTranslation(a.id)?.english ?? undefined) ? a.id : undefined,
      // Free means "the Action Tick already paid for this move". A Drone's
      // Action costs no Tick, so there is no performed Action for a free move to
      // ride on and it is an ordinary Movement.
      free: !!lengthOf(a),
      // A Jump carrying Airborne Movement IS a Flying Movement (空中移动), with
      // no choice in it - unlike the Ojs200's optional Maneuver.
      airborne: isAirborneAction(a),
    });
    return true;
  }
  if (a.type === 'Projectile') {
    const shot = ga?.projectiles ?? [];
    if (!shot.length) {
      ctx.noteNow(`${a.name?.en || a.id} is a Projectile Action, but the card data does not say what it puts on the board. Place it by hand from the squad list.`);
      return true;
    }
    if (shot.length === 1) startLaunchPlan(t.uid, a.id, shot[0].id, shot[0].name?.en || shot[0].id);
    else launchPick = { uid: t.uid, actionId: a.id, cardIds: shot.map((c) => c.id) };
    return true;
  }
  // Pholcus does not resolve a payload: it becomes a Drone in place (FAQ M18).
  // If the Grid it comes up in is occupied, the derived blast list has it
  // detonate on the spot (M18.4).
  if (unfoldsOwed(ctx.data, [t]).some((x) => x.actionId === a.id)) {
    // Nothing to wait on: the Unfold happens here, so it pays here. Returning
    // true without this left the activation sitting in pendingAction until
    // some later Action dropped it, which is how the folded Pholcus could
    // Unfold and then still act - freeplay's done(true) always charged it.
    commitAction(ctx);
    ctx.send({ kind: 'unfold', seat: t.side, uid: t.uid });
    ctx.noteNow(`${t.label} Unfolds into its Drone form. It cannot act until next round - the Automatic Phase has already passed (FAQ M8).`);
    return true;
  }
  // A Projectile resolving its payload in the Delay Phase opens the same
  // Detonation resolver its card button uses (3.6.2). Freeplay counts this as
  // performed the moment the resolver opens, and so does this.
  if (t.kind === 'projectile' && a.type !== 'Passive') {
    startDetonation(t.uid, a.id);
    return false;
  }
  // Swift and Tactical Actions are card text rather than a board procedure, so
  // the card is put in front of the player to carry out. Nothing to back out of.
  ctx.showTab('details');
  ctx.noteNow(`${a.name?.en || a.id}: follow the Action text on the card.`);
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

let attackPick: { uid: number; actionId: string } | null = null;

export function startAttackPick(uid: number, actionId: string): void {
  attackPick = { uid, actionId };
  hudRef?.refresh();
}

function attackPanel(ctx: HudCtx): string {
  const s = ctx.state;
  const m = attackPick!;
  const by = s.tokens.find((x) => x.uid === m.uid);
  const raw = by ? actionOn(ctx, by, m.actionId) : undefined;
  // [Stationary] pays out when the attacker has not moved this Opportunity:
  // the Mire's railguns reach 2 grids further, and nobody could see why not.
  const opp0 = ensureScript(s).opp;
  const a = raw ? stationaryAdjusted(raw, opp0?.uid === by?.uid ? opp0 : null) : undefined;
  const stationary = raw && a !== raw;
  if (!by || !a) return head('Attack', 'That unit is gone', '', true)
    + '<div class="tp-body"></div><div class="tp-foot"><button class="bigbtn ghost2" data-act="attackcancel">Close</button></div>';
  const terrain = terrainOf(ctx);
  const smoke = s.smoke ?? [];
  // Every enemy on the board is offered, with the reading of the line beside
  // it: out of range or out of arc is a warning the player may still overrule,
  // the same way the guide warns rather than blocks. An Automatic Action is
  // the exception: it takes the nearest legal target, Highlighted first
  // (3.5.2, FAQ O21), and networked play is strict, so only those show.
  const autoLegal = a.speed === 'auto' ? autoTargetsFor(ctx.data, s.tokens, by, a) : null;
  const rows = s.tokens
    .filter((t) => t.side !== by.side && t.deployed !== false && alive(t))
    .filter((t) => !autoLegal || !autoLegal.length || autoLegal.some((x) => x.uid === t.uid))
    .map((t) => {
      const note = losNote(by, t, a, terrain, s.tokens, smoke);
      // ⚠ is a warning the player may overrule; ✕ is blocked line of sight,
      // and 4.4.1 makes that attack illegal, not inadvisable. Freeplay warns
      // for both because a table can house-rule; networked play is strict, so
      // the row cannot be pressed. Only losNote's LOS readings emit ✕.
      const blocked = note.includes('✕');
      const bad = blocked || note.includes('⚠');
      const prot = protectionFor(by, t, a, terrain, s.tokens, smoke);
      // One reading per line. Range, arc and line of sight are three separate
      // judgements and running them together on one line made the list unusable.
      const bits = note.split(' · ').concat(prot.white ? [`+${prot.white} White ${prot.white === 1 ? 'die' : 'dice'} of Protection`] : []);
      return `<button class="rowwide targrow${bad ? ' warn' : ''}"${blocked ? ' disabled' : ''} data-attacktarget="${t.uid}">
        <span class="tgname">${esc(t.label)}</span>
        <span class="tgbits">${bits.map((b) => `<span${/[⚠✕]/.test(b) ? ' class="bad"' : ''}>${esc(b)}</span>`).join('')}</span></button>`;
    })
    .join('');
  // FAQ O9: with no enemy inside an Auto Action's range, the nearest Breakable
  // Terrain becomes a legal target — optional, and only the nearest. Named here
  // rather than made clickable because destroying terrain already has its own
  // path (click the piece on the board), and this is the half a player cannot
  // work out for themselves: that the option exists at all.
  const neutral = autoLegal && !autoLegal.length
    ? autoNeutralTargets(ctx.data, s.tokens, terrain, by, a)
    : [];
  const neutralNote = neutral.length
    ? `<p class="tp-note">No enemy Unit is inside Range ${a.range ?? 0}, so ${esc(by.label)} MAY attack Breakable Terrain instead — and only the nearest, which is
       ${neutral.map((n) => esc(terrainLabel(ctx, n.id))).join(' or ')} (FAQ O9).<br>Click the piece on the board to destroy it. Buildings and Defense walls are never valid targets (O10).</p>`
    : '';
  return head('Your move', `${esc(a.name?.en || m.actionId)}: which target?`,
    `${esc(by.label)} · ${a.yellowDice ?? 0}Y ${a.redDice ?? 0}R.${stationary ? ` Stationary applies: Range ${a.range ?? 0}${(a.yellowDice ?? 0) !== (raw?.yellowDice ?? 0) ? `, ${a.yellowDice}Y` : ''} — no Movement this Opportunity.` : ''}`, true)
    + `<div class="tp-body">${rows || '<p class="tp-note">No enemy unit is on the board.</p>'}${neutralNote}</div>
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
  const rows = COMPASS.map((f) => `<button class="rowwide" data-blinkface="${f.id}">${f.label}${
    naming?.facing === f.id ? ' <span class="ct">as it was</span>' : ''
  }</button>`).join('');
  return head('Your move', `Which way does ${esc(naming?.label ?? 'it')} face?`,
    'Prototype Blink is Forced Movement, so you set the facing of BOTH units (FAQ E17).', true)
    + `<div class="tp-body">${rows}<p class="tp-dim">${
        m.facing === null ? 'Then you will set the other one.' : 'Last question — the swap goes through after this.'
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
    if (ctx.send(cmd).ok) ctx.noteNow(`${t.label} exchanges positions with ${other.label} (Prototype Blink).`);
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

let shovePlan: { uid: number; actionId: string; targetUid: number | null; facing?: Facing } | null = null;

export function startShove(uid: number, actionId: string, targetUid?: number): void {
  shovePlan = { uid, actionId, targetUid: targetUid ?? null };
  hudRef?.refresh();
}

function gridAhead(t: Token): { c: number; r: number } {
  const g = { c: Math.floor(t.col / 3), r: Math.floor(t.row / 3) };
  const fv = [[0, -1], [1, 0], [0, 1], [-1, 0]][t.facing] as [number, number];
  return { c: g.c + fv[0], r: g.r + fv[1] };
}

function shoveVictims(ctx: HudCtx, t: Token): Token[] {
  const ahead = gridAhead(t);
  return ctx.state.tokens.filter((o) => {
    if (o.side === t.side || o.uid === t.uid || o.aerial || o.deployed === false) return false;
    return Math.floor(o.col / 3) === ahead.c && Math.floor(o.row / 3) === ahead.r;
  });
}

function gridName(c: number, r: number): string {
  return `${String.fromCharCode(65 + c)}${r + 1}`;
}

// What the Forced Movement would do, or why it does nothing.
function shoveOutcome(ctx: HudCtx, by: Token, victim: Token, a: CardAction) {
  const kb = knockbackOf(a);
  if (!kb) return null;
  const dir = attackDirection(by, victim);
  const path = knockbackPath(victim, dir, kb.grids, terrainOf(ctx), ctx.state.tokens);
  const heading = ['north', 'east', 'south', 'west'][dir.dr < 0 ? 0 : dir.dc > 0 ? 1 : dir.dr > 0 ? 2 : 3];
  const end = path[path.length - 1];
  return { kb, path, heading, end, short: path.length < kb.grids };
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
    const offBoard = ahead.c < 0 || ahead.r < 0 || ahead.c >= LG || ahead.r >= LG;
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
  const out = shoveOutcome(ctx, by, victim, a);
  if (!out) return head('Forced Movement', `${esc(name)} carries none`, '', true)
    + '<div class="tp-body"></div><div class="tp-foot"><button class="bigbtn ghost2" data-act="shovecancel">Close</button></div>';
  const blocked = !out.path.length;
  return head('Your move', `${label} on ${esc(victim.label)}`, `${esc(name)} from ${esc(by.label)}.`, true)
    + `<div class="tp-body">
        <p class="tp-note">${blocked
          ? `${esc(victim.label)} would be forced ${out.heading}, but a Unit, Terrain or the board edge is in the way, so it does not move. Forced Movement stops the moment it is blocked.`
          : `${esc(victim.label)} is forced ${out.path.length} Grid${out.path.length === 1 ? '' : 's'} ${out.heading} to ${gridName(out.end.c, out.end.r)}${out.short ? `, short of the full ${out.kb.grids} because something blocks the rest of the line` : ''}.`}</p>
        ${out.kb.push && victim.kind === 'mech' ? '<p class="tp-dim">Push also costs it 1 Link, and a Mech on 0 Link Shuts Down.</p>' : ''}
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
  const out = by && victim && a ? shoveOutcome(ctx, by, victim, a) : null;
  shovePlan = null;
  if (!out || !out.path.length || !by || !victim) { flushBoxDrops(); ctx.refresh(); return; }
  const spot = standingSpot(out.end.c, out.end.r, victim.size, victim.aerial, terrainOf(ctx), s.tokens, victim.uid, { col: victim.col, row: victim.row })
    ?? { col: victim.col, row: victim.row };
  const wasShut = victim.stance === 'shutdown';
  ctx.send({ kind: 'forceMove', seat: by.side, uid: by.uid, targetUid: victim.uid, to: spot, push: out.kb.push, facing: m?.facing });
  const shut = out.kb.push && victim.kind === 'mech' && !wasShut && victim.stance === 'shutdown';
  ctx.noteNow(`${victim.label} is forced ${out.path.length} Grid${out.path.length === 1 ? '' : 's'} ${out.heading} to ${gridName(out.end.c, out.end.r)}.${
    out.kb.push && victim.kind === 'mech' ? ` Push costs 1 Link (now ${victim.link}).` : ''}${shut ? ' Link has reached 0, so it shuts down.' : ''}`);
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

let detonateNow: { uid: number; actionId: string } | null = null;
// Which token the effect-only detonation is about to hand out.
let detonateStatus = 'smoke';

export function startDetonation(uid: number, actionId: string): void {
  const ctx = hudRef;
  if (!ctx) return;
  const proj = ctx.state.tokens.find((x) => x.uid === uid);
  const a = proj ? actionOn(ctx, proj, actionId) : undefined;
  if (!proj || !a) return;
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
  detonateNow = { uid, actionId };
  detonateStatus = /interfer|jam|stun/i.test(`${a.name?.en ?? ''} ${detonationText(ctx, a)}`) ? 'fci' : 'smoke';
  ctx.refresh();
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

function unitsWithin(ctx: HudCtx, from: Token, range: number): { t: Token; dist: number }[] {
  const gc = Math.floor(from.col / 3);
  const gr = Math.floor(from.row / 3);
  return ctx.state.tokens
    .filter((x) => x.uid !== from.uid && x.deployed !== false)
    .map((t) => ({ t, dist: Math.abs(Math.floor(t.col / 3) - gc) + Math.abs(Math.floor(t.row / 3) - gr) }))
    .filter((x) => x.dist <= range)
    .sort((a, b) => a.dist - b.dist);
}

// Destructible Terrain is always a legal target for a Projectile in range
// unless the card says otherwise (4.7.5), and only the 1-inch Containers are
// destructible: Buildings and both Defense walls are not (p.21).
function fragileTerrainWithin(ctx: HudCtx, from: Token, range: number) {
  const gc = Math.floor(from.col / 3);
  const gr = Math.floor(from.row / 3);
  return terrainOf(ctx)
    .filter((p) => p.isFragile)
    .map((piece) => {
      const cells = piece.subCells.map((c) => ({ c: Math.floor(c.col / 3), r: Math.floor(c.row / 3) }));
      return { piece, dist: Math.min(...cells.map((c) => Math.abs(c.c - gc) + Math.abs(c.r - gr))) };
    })
    .filter((x) => x.dist <= range)
    .sort((a, b) => a.dist - b.dist);
}

function detonatePanel(ctx: HudCtx): string {
  const s = ctx.state;
  const proj = s.tokens.find((x) => x.uid === detonateNow!.uid);
  if (!proj) return head('Detonation', 'That Projectile is gone', '', true)
    + '<div class="tp-body"></div><div class="tp-foot"><button class="bigbtn" data-act="detdone">Close</button></div>';
  const a = actionOn(ctx, proj, detonateNow!.actionId);
  const name = a?.name?.en || detonateNow!.actionId;
  const range = a?.range ?? 0;
  const targets = unitsWithin(ctx, proj, range);
  const terrain = fragileTerrainWithin(ctx, proj, range);
  const damaging = !!(a && ((a.yellowDice ?? 0) || (a.redDice ?? 0)));
  const scope = a ? explosionScope(a) : 'single';
  const rows = targets
    .map(({ t, dist }) => `<button class="rowwide" data-dettarget="${t.uid}"><span class="${t.side}">${t.side === proj.side ? 'ALLY' : 'ENEMY'}</span> ${esc(t.label)}<span class="ct">R${dist}</span></button>`)
    .join('');
  const terrainRows = terrain
    .map(({ piece, dist }) => `<button class="rowwide" data-detterrain="${esc(piece.id)}">TERRAIN ${esc(piece.type.replace('_', ' '))}<span class="ct">R${dist}</span></button>`)
    .join('');
  const body = damaging
    ? `<p class="tp-note">Explosion damage ignores line of sight and facing, and the defender gets no Terrain or Unit Protection. Only the defender may spend Link to Focus.</p>
       <p class="tp-dim">${targets.length
         ? scope === 'all'
           ? 'This card says all Units within range, so it hits allies too and every one takes a separate attack. Resolve them one at a time (4.7.6).'
           : 'This card damages a single target, so only one of these takes the attack.'
         : terrain.length
           ? 'No units within range, but Destructible Terrain is always a legal target (4.7.5).'
           : 'No units and no Destructible Terrain within range. A Projectile whose Delayed Action needs a target is destroyed instead (4.7.5).'}</p>
       ${rows}
       ${terrainRows ? `<div class="sect2" style="margin-top:10px">Or hit Destructible Terrain</div><p class="tp-dim">Terrain takes no roll. An attack that hits removes it (p.21).</p>${terrainRows}` : ''}
       `
    : `<p class="tp-note">${esc(a ? detonationText(ctx, a) : 'See the card for what this detonation does.')}</p>
       <p class="tp-dim">This detonation causes an effect rather than damage, so there is no attack roll. Pick the token it applies, then the units inside the blast. The card text is what actually happens; the token is a reminder on the board.</p>
       <div class="stancerow">${STATUSES.filter((d) => !d.appliesTo || targets.some(({ t }) => d.appliesTo!.includes(t.kind)))
         .map((d) => `<button class="stancebtn${detonateStatus === d.id ? ' sel' : ''}" data-detstatus="${esc(d.id)}" title="${esc(d.note)}">${d.icon} ${esc(d.label)}</button>`)
         .join('')}</div>
       ${targets.length
         ? `${targets.map(({ t, dist }) => {
             const on = (t.statuses ?? []).includes(detonateStatus);
             return `<button class="rowwide${on ? ' sel' : ''}" data-deteffect="${t.uid}"><span class="${t.side}">${t.side === proj.side ? 'ALLY' : 'ENEMY'}</span> ${esc(t.label)}<span class="ct">R${dist}${on ? ' ✓' : ''}</span></button>`;
           }).join('')}`
         : '<p class="tp-dim">No units inside the blast.</p>'}`;
  return head('Your move', esc(detonateHeading(name, proj.label)), `${esc(proj.label)} · ${range === 0 ? 'this Grid' : `Range ${range}`}.`, true)
    + `<div class="tp-body">${body}</div>
       <div class="tp-foot"><button class="bigbtn" data-act="detdone">${targets.length || terrain.length ? 'Destroy the Projectile' : 'Destroy the Projectile'}</button>
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
  for (let c = 0; c < LG; c++) {
    for (let r = 0; r < LG; r++) {
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
  if (m?.thenDespawn !== null && m?.thenDespawn !== undefined) {
    const proj = ctx.state.tokens.find((x) => x.uid === m.thenDespawn);
    if (proj) ctx.send({ kind: 'despawn', seat: proj.side, uid: proj.uid, targetUid: proj.uid });
  }
  if (m) ctx.noteNow(`${m.label}: ${m.placed.length} Smoke Screen${m.placed.length === 1 ? '' : 's'} placed.`);
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

// The Connected groups still owing a removal this End Phase, snapshotted when
// dissipation ran. A removal that splits a group owes nothing further until
// next round (4.16), so this cannot be re-derived from the board. Both clients
// build it from the same command in glueAfter, so both hold the same queue.
let smokeOwed: { side: Side; cells: { col: number; row: number }[] }[] | null = null;

function smokeChoicePanel(ctx: HudCtx): string {
  const next = smokeOwed![0];
  if (!mine(ctx, next.side)) {
    return head('Waiting', `${squadLabel(next.side)} thins its smoke`, `${smokeOwed!.length} Connected group${smokeOwed!.length === 1 ? '' : 's'} left.`, false)
      + `<div class="tp-body">${waiting(next.side, 'choosing a Smoke Screen to remove')}</div><div class="tp-foot"></div>`;
  }
  return head('Your move', 'Smoke dissipation', `Take one screen off this Connected group.<br>${smokeOwed!.length} group${smokeOwed!.length === 1 ? '' : 's'} left.`, true)
    + `<div class="tp-body">
        <p class="tp-note">Click one highlighted Smoke Screen on the board. Splitting the group costs nothing further this round (4.16).</p>
      </div>
      <div class="tp-foot"><button class="bigbtn ghost2" data-act="smokeauto">Pick for me</button></div>`;
}

function removeOwedSmoke(ctx: HudCtx, at: { col: number; row: number }): void {
  const next = smokeOwed?.[0];
  if (!next) return;
  ctx.send({ kind: 'removeSmoke', seat: next.side, at });
  ctx.refresh();
}

// ---------- Extra Action Opportunities (Coordinate) ----------
//
// An Action carrying the grant lets an Ally Mech in range pay Link and
// IMMEDIATELY take a complete Opportunity of its own, nested inside this one
// (FAQ K21). The guide asks which Ally in a dialog; here the panel asks, which
// is the same question in the place this HUD asks all its questions.

let grantPick: { from: number; grant: ExtraActivation } | null = null;

// Range is counted in Large Grids, the same way the guide counts it.
function gridsApart(a: Token, b: Token): number {
  return Math.abs(Math.floor(a.col / 3) - Math.floor(b.col / 3))
    + Math.abs(Math.floor(a.row / 3) - Math.floor(b.row / 3));
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
      return `<button class="rowwide${short ? ' warn' : ''}" data-grant="${t.uid}"${short ? ` data-why="${esc(`${t.label} needs at least ${g.minimumLink} Link to be chosen.`)}"` : ''}>${esc(t.label)}<span class="ct">Link ${t.link ?? 0}</span></button>`;
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

// A Drone printed at 0 points carries the Low Value tag; Projectiles are Low
// Value by default (p.82). Shared between control and the Secondary Tasks so a
// unit cannot be Low Value for one and not the other.
function lowValueOf(ctx: HudCtx) {
  return (t: Token): boolean =>
    t.kind === 'projectile' || (t.kind === 'drone' && (ctx.data.byId.get(t.cardId)?.score ?? 0) === 0);
}

function zoneCellsOf(ctx: HudCtx) {
  return (zone: string) => ctx.data.zoneData.zones.find((z) => z.id === zone)?.cells ?? [];
}

export function scorePreview(ctx: HudCtx, finalRound: boolean): ScoreResult {
  const s = ctx.state;
  const tasks = normaliseTasks(s.tasks);
  const low = lowValueOf(ctx);
  const cells = zoneCellsOf(ctx);
  // Control is judged as part of the same reading of the board that scores it.
  settleControl(tasks, cells, s.tokens, low);
  const mission = s.mission ? ctx.data.missions.cards.find((c) => c.id === s.mission) : undefined;
  const all: ScoreLine[] = [];
  if (mission) {
    all.push(...scoreMain(
      {
        family: mission.family as 'blackbox' | 'control' | 'terminal' | 'vip',
        vp: mission.vp ?? 0,
        zones: mission.zones ?? [],
        fromRound: mission.fromRound ?? 1,
        cadence: mission.cadence ?? 'per-round',
        scoringZone: mission.scoringZone,
      },
      tasks, s.tokens, s.round.n, finalRound, cells,
    ).lines);
  }
  for (const side of ['s1', 's2'] as Side[]) {
    const id = tasks.secondary[side];
    const card = id ? ctx.data.secondary.find((c) => c.id === id) : undefined;
    if (!card?.kind) continue;
    all.push(...scoreSecondary(
      { id: card.id, name: card.name, vp: card.vp ?? 0, kind: card.kind as SecondaryScoring['kind'] },
      side, tasks, s.tokens, cells, finalRound, low,
    ).lines);
  }
  // Anything already paid stays paid: a Task does not score twice for the same
  // reason in a later round.
  const open = unpaidLines(all, tasks.scored);
  let s1 = 0;
  let s2 = 0;
  for (const l of open) (l.side === 's1' ? (s1 += l.vp) : (s2 += l.vp));
  return { lines: open, s1, s2 };
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
      // Your own pick stays changeable until deployment begins — the Task is
      // open information, not a commitment you can be trapped by.
      const cell = card
        ? isMe
          ? `<button class="rowbtn" data-sec="${side}" title="Change this Secondary Task">${esc(card.name)} ✎</button>`
          : `<span class="pickchip set">${esc(card.name)}</span>`
        : held
          ? `<span class="tp-dim">waits for ${esc(squadLabel(order[0]))}</span>`
          : isMe
            ? `<button class="rowbtn" data-sec="${side}">Pick a Secondary Task</button>`
            : '<span class="tp-dim">picking…</span>';
      return `<div class="dialrow"><span class="nm ${side}">${squadLabel(side)}</span>${cell}</div>`;
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
  return { maxLink: (t: Token) => tokenCards(ctx.data, t).find((c) => c.slot === 'pilot')?.card.LV ?? 0 };
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
  const v = ctx.send({ kind: 'playTactic', seat: m.side, uid: t.uid, cardId: m.cardId, pick: pick ?? undefined });
  if (!v.ok) { ctx.refresh(); return; }
  // apply writes the card's own line into the unit's log, which is the only
  // place that knows what the effect worked out to.
  ctx.noteNow(t.log?.at(-1)?.text ?? `${squadLabel(m.side)} plays ${spec.name}.`);
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
    const held = s.tactics?.[side] ?? [];
    if (!held.length) continue;
    const spent = (s.tacticsPlayed?.[side] ?? []).filter((e) => e.startsWith(`${s.round.n}:`));
    const seen = new Set<string>();
    for (const id of held) {
      if (seen.has(id)) continue;
      seen.add(id);
      const card = ctx.data.byId.get(id);
      if (!card || !tacticFitsPhase(id, phase)) continue;
      const when = tacticSpec(id)?.timing ?? '';
      rows.push(`<div class="dialrow"><span class="nm ${side}">${esc(cardName(card))}</span>
        <span class="tp-dim">${esc(when)}</span>
        <button class="rowbtn" data-tactic="${side}:${esc(id)}"${spent.length ? ' disabled' : ''}>${spent.length ? 'Spent' : 'Play'}</button></div>`);
    }
  }
  if (!rows.length) return '';
  return `<div class="tacticstrip"><div class="sect2">Tactics you could play now</div>${rows.join('')}
    <p class="tp-dim">Only 1 per player per round (5.4.2).<br>The card is in your hand. This just says when.</p></div>`;
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
        <div class="feedwho"><b class="${d.seat}">${squadLabel(d.seat)}</b> ${esc(d.label)}</div>
        <div class="feedres">${dice}<span class="feedsum">${sum}</span></div>
      </div>`;
    })
    .join('');
  feedSeen = highest;
  return `<div class="dicefeed">${rows}</div>`;
}

function secOverlay(ctx: HudCtx): string {
  if (!secOpen) return '';
  // A card that designates a Tactical Area needs the board to have some. The
  // Main Task decides that, and VIP places none at all — the same gate the
  // freeplay picker applies, so an impossible Task can never be chosen.
  const mission = ctx.state.mission ? ctx.data.missions.cards.find((m) => m.id === ctx.state.mission) : undefined;
  const hasZones = (mission?.zones ?? []).length > 0;
  const rows = ctx.data.secondary
    .map((c) => {
      const blocked = c.designate === 'zone' && !hasZones;
      return `<button class="pickrow${blocked ? ' blocked' : ''}${secPick === c.id ? ' sel' : ''}"${blocked ? ' disabled' : ''} data-picksec="${esc(c.id)}" data-img="${esc(secondaryImageUrl(c.id))}">
        <span class="nm">${esc(c.name)}</span>
        <span class="ct">${blocked ? 'needs Tactical Zones' : `${c.vp ?? 0} VP`}</span>
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
        ${!hasZones ? '<p class="quiet">This Main Task places no Tactical Zones, so Tasks that designate one are unavailable.</p>' : ''}
        <button class="btn wide" id="mc-sec-ok"${secPick ? '' : ' disabled'}>Confirm this Task</button>
      </div>
    </div>
  </div></div>`;
}

// The shell, so a tab can be brought forward from outside the click handler —
// an attack starting has to put the Combat tab in front by itself.
let sideTabHost: HTMLElement | null = null;

export function showSideTab(host: HTMLElement | null, name: 'squad' | 'details'): void {
  const root = host ?? sideTabHost;
  if (!root) return;
  for (const x of root.querySelectorAll<HTMLElement>('.hudtab')) x.classList.toggle('active', x.dataset.sidetab === name);
  for (const s of root.querySelectorAll<HTMLElement>('.side-tab')) s.classList.toggle('active', s.id === `tab-${name}`);
}

// Mounts the HUD once and updates it in place from then on. The board is the
// same stateful renderer the freeplay page uses — zoom, pan, art and all — so
// it must never be torn down by a re-render.
export function ensureHud(host: HTMLElement, ctx: HudCtx): void {
  hudRef = ctx;
  if (!host.querySelector('#hud-shell')) {
    // The freeplay side panel moves to the LEFT here and keeps its own tabs,
    // so a player can read either squad and any card mid-match. The ids are
    // the ones SquadTracker and Panel bind to.
    // Squads and Details sit on the RIGHT, where a player coming from the
    // freeplay board expects them; the turn panel takes the left.
    host.innerHTML = `<div class="hud" id="hud-shell">
      <div class="turnpanel" id="hud-panel"></div>
      <div class="hudmain">
        <div id="hud-tl"></div>
        <div id="mc-board" class="hudboardhost"></div>
        <div id="hud-strip"></div>
      </div>
      <div class="hudside">
        <div class="hudtabs">
          <button class="hudtab active" data-sidetab="squad">Squads</button>
          <button class="hudtab" data-sidetab="details">Details</button>
        </div>
        <section id="tab-squad" class="side-tab active"><div id="squad-body"></div></section>
        <section id="tab-details" class="side-tab"><div id="details-body"></div></section>
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
    zc.innerHTML = '<button id="btn-zones" title="Shows or hides the tactical zone and deployment overlay drawn on the board." aria-pressed="true">Zones</button>';
    host.querySelector('#mc-board')!.appendChild(zc);
    zc.querySelector('#btn-zones')!.addEventListener('click', () => hudRef?.toggleZones());
    attachCombatWindow(host);
    ctx.mountSide();
    for (const b of host.querySelectorAll<HTMLElement>('[data-sidetab]')) {
      b.addEventListener('click', () => showSideTab(host, b.dataset.sidetab as 'squad' | 'details'));
    }
    sideTabHost = host;
  }
  (host.querySelector('#hud-tl') as HTMLElement).innerHTML = timelineHtml(ctx.state);
  (host.querySelector('#hud-strip') as HTMLElement).innerHTML = orderStripHtml(ctx);
  (host.querySelector('#hud-panel') as HTMLElement).innerHTML =
    `${ctx.note ? `<div class="mc-err" style="margin:10px 12px 0">${esc(ctx.note)}</div>` : ''}${panelHtml(ctx)}${tacticsHtml(ctx)}${feedHtml(ctx)}`;
  (host.querySelector('#hud-veils') as HTMLElement).innerHTML = secOverlay(ctx);
  const zb = host.querySelector<HTMLButtonElement>('#btn-zones');
  if (zb) {
    zb.classList.toggle('on', ctx.zonesOn);
    zb.setAttribute('aria-pressed', ctx.zonesOn ? 'true' : 'false');
  }
  // The combat window is up while an attack is being resolved — the live
  // helper on the attacking client, and the published mirror everywhere else,
  // so the defending player watches the same fight instead of a dice feed.
  const pop = host.querySelector<HTMLElement>('#combat-pop');
  if (pop) {
    const mirror = !ctx.combatBusy() ? ctx.combatMirrorHtml() : null;
    pop.hidden = !ctx.combatBusy() && !mirror;
    // Only the mirror is drawn by the re-render: while the live helper is up
    // it owns #combat-body, and writing into it would tear the attack down.
    // Compared against what WE wrote, not against innerHTML — the browser
    // normalises markup on the way in, so that comparison never matches and
    // the window would redraw on every render.
    if (mirror && mirror !== lastMirror) {
      const body = pop.querySelector<HTMLElement>('#combat-body');
      if (body) body.innerHTML = mirror;
      lastMirror = mirror;
    }
    if (!mirror) lastMirror = '';
  }
  wireHud(host, ctx);
  renderBoard(ctx);
  // A unit the player clicked wins over the active one, until it leaves the
  // board or they end the activation.
  if (inspectUid !== null && !ctx.state.tokens.some((t) => t.uid === inspectUid)) inspectUid = null;
  ctx.syncSide(inspectUid ?? ensureScript(ctx.state).opp?.uid ?? null);
}

// ---------- the combat window ----------
//
// Wired once, when the shell is built, and never by a re-render: the helper
// owns the window's contents for as long as an attack lasts, and rebinding
// under it would drop a drag halfway. Where it sits and whether it is rolled up
// survive being reopened, because a player who moved it out of the way meant it.

let combatSpot: { x: number; y: number } | null = null;
let combatRolled = false;
// The mirror markup this client last wrote into #combat-body.
let lastMirror = '';

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
    });
  });
  on('[data-act="accept"]', () => { ctx.send({ kind: 'acceptRoll', seat: me() }); ctx.refresh(); });
  on('[data-act="tasksdone"]', () => { ctx.send({ kind: 'finishTasks', seat: me() }); ctx.refresh(); });
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
  // The defending player's Focus flow inside the combat mirror (4.4.1-5).
  on('[data-act="focususe"]', () => ctx.mirrorFocus('use'));
  on('[data-act="focuspass"]', () => ctx.mirrorFocus('pass'));
  on('[data-act="focusreroll"]', () => ctx.mirrorFocus('reroll'));
  on('[data-act="focuskeep"]', () => ctx.mirrorFocus('keep'));
  on('[data-act="kcarmor"]', () => ctx.mirrorFocus('kc'));
  on('[data-fdie]', (el) => ctx.mirrorFocus('die', Number(el.dataset.fdie)));
  on('[data-act="rolldefense"]', (el) => {
    const call = ensureScript(s).combat;
    if (!call || call.faces) return;
    // One roll per call: the button dies the moment it is pressed, so a double
    // click cannot answer twice while the first roll is still in the air.
    (el as HTMLButtonElement).disabled = true;
    void ctx.rollDefense(call.white, call.blue).then((faces) => {
      ctx.send({ kind: 'answerDefense', seat: me(), faces });
      ctx.refresh();
    });
  });
  on('[data-rb]', (el) => {
    const what = el.dataset.rb;
    if (what === 'accept' || what === 'decline') {
      ctx.send({ kind: 'rollbackAnswer', seat: me(), accept: what === 'accept' });
      if (what === 'decline') ctx.noteNow('Rollback declined. The board stands.');
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
    // Otherwise it names a target: "round:phase".
    const [r, ph] = (what ?? '').split(':').map(Number);
    if (!Number.isInteger(r) || !Number.isInteger(ph)) return;
    ctx.send({ kind: 'rollbackRequest', seat: me(), round: r, phase: ph, label: `round ${r}, ${PHASES[ph]} Phase` });
    ctx.refresh();
  });
  on('[data-aster]', (el) => {
    const t = s.tokens.find((x) => x.uid === Number(el.dataset.aster));
    if (!t) return;
    void runAster(ctx.data, s, t.uid, (targetUid) => {
      ctx.send({ kind: 'asterRestore', seat: t.side, uid: t.uid, targetUid });
      ctx.refresh();
    }, (_to, text) => ctx.noteNow(text));
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
      // A Mech's Action is bought with Ticks and a Drone's with its whole
      // activation, but both are recorded by the same command — without it
      // nothing marked the activation spent and a Drone could move and then
      // shoot. Only a Mech's length-less Passive sends nothing.
      if (performed && (t.kind !== 'mech' || lengthOf(performed))) {
        // Legality is read now, but nothing is spent: the Ticks wait in
        // pendingAction until the Action's tool actually does something, so a
        // misclick that gets cancelled leaves the Opportunity intact.
        const key = el.dataset.doact!;
        const v = ctx.check({ kind: 'performAction', seat: t.side, uid: t.uid, actionId: actionIdOf(key), partKey: key });
        if (!v.ok) {
          if (v.why) ctx.noteNow(v.why);
          ctx.refresh();
          return;
        }
        pendingAction = { kind: 'performAction', seat: t.side, uid: t.uid, actionId: actionIdOf(key), partKey: key };
      }
      const grant = act ? extraActivationOf(act.action) : undefined;
      if (grant) grantPick = { from: t.uid, grant };
      // No tool to wait on means the Action is already done, so it pays now.
      if (!performed || !routeAction(ctx, t, performed, act)) {
        const paid = commitAction(ctx);
        // Two Common Actions do more than spend a Tick, and the work lives in
        // its own command: Stabilize sheds a Status and restores Link, Reveal
        // leaves the Optical Camouflage State. Performing them without this was
        // paying the cost and getting nothing.
        if (paid.ok && el.dataset.doact === 'COMMON_STABILIZE') {
          const shed = (t.statuses ?? []).find((id) => {
            const d = STATUSES.find((x) => x.id === id);
            return d?.shape === 'square' || d?.shape === 'hexagon';
          });
          if (shed) {
            ctx.send({ kind: 'stabilise', seat: t.side, uid: t.uid });
            ctx.noteNow(`Stabilize System: ${STATUSES.find((x) => x.id === shed)?.label ?? shed} removed and Link restored to ${t.link}.`);
          } else {
            ctx.noteNow('Stabilize System sheds a square or hexagon Status, and this Mech carries none.');
          }
        }
        if (paid.ok && el.dataset.doact === 'COMMON_REVEAL') {
          ctx.send({ kind: 'reveal', seat: t.side, uid: t.uid });
          ctx.noteNow('Reveal: out of the Optical Camouflage State. Now make Manifestation Movement, up to this unit\'s Stealth value, to where it really is.');
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
  on('[data-act="launchundo"]', () => undoLaunched(ctx));
  on('[data-launchpick]', (el) => {
    const m = launchPick;
    launchPick = null;
    const c = ctx.data.byId.get(el.dataset.launchpick!);
    if (m && c) startLaunchPlan(m.uid, m.actionId, c.id, c.name?.en || c.id);
    ctx.refresh();
  });
  on('[data-act="launchpickcancel"]', () => { launchPick = null; dropAction(); ctx.refresh(); });
  on('[data-attacktarget]', (el) => {
    const m = attackPick;
    if (m) {
      // The disabled row is the gate; this re-check is for a stale panel,
      // where the board changed after the rows were drawn. Recomputed rather
      // than trusted, and BEFORE commitAction so a refused attack costs
      // nothing.
      const s = ctx.state;
      const by = s.tokens.find((x) => x.uid === m.uid);
      const t = s.tokens.find((x) => x.uid === Number(el.dataset.attacktarget));
      const raw = by ? actionOn(ctx, by, m.actionId) : undefined;
      const opp0 = ensureScript(s).opp;
      const a = raw ? stationaryAdjusted(raw, opp0?.uid === by?.uid ? opp0 : null) : undefined;
      if (by && t && a && losNote(by, t, a, terrainOf(ctx), s.tokens, s.smoke ?? []).includes('✕')) {
        ctx.noteNow('Line of sight is blocked, so this attack cannot be made (4.4.1).');
        ctx.refresh();
        return;
      }
    }
    attackPick = null;
    if (m) {
      commitAction(ctx);
      ctx.startAttack(m.uid, m.actionId, Number(el.dataset.attacktarget));
    }
    ctx.refresh();
  });
  on('[data-act="attackcancel"]', () => { attackPick = null; dropAction(); ctx.refresh(); });

  // ---------- Electronic Warfare (4.11) ----------
  on('[data-ewtarget]', (el) => {
    if (el.dataset.why) { ctx.noteNow(el.dataset.why); ctx.refresh(); return; }
    const m = ewPick;
    const by = m ? s.tokens.find((x) => x.uid === m.uid) : undefined;
    ewPick = null;
    if (m && by) {
      commitAction(ctx);
      ctx.send({ kind: 'startCounterRoll', seat: by.side, uid: by.uid, actionId: m.actionId, targetUid: Number(el.dataset.ewtarget) });
    }
    ctx.refresh();
  });
  on('[data-act="ewcancel"]', () => { ewPick = null; dropAction(); ctx.refresh(); });
  // Each seat rolls its OWN unit's dice and sends them as faces. The receiver
  // never re-rolls them, so both clients read the same Counter-roll.
  on('[data-ewroll]', (el) => {
    const t = s.tokens.find((x) => x.uid === Number(el.dataset.ewroll));
    if (!t) return;
    const ev = electronicValue(ctx.data, t);
    void ctx.rollHits(ev, `rolls ${ev} for the Electronic Counter-roll`).then((res) => {
      ctx.send({ kind: 'rollCounter', seat: t.side, uid: t.uid, faces: res.dice.map((d) => d.face) });
      ctx.refresh();
    });
  });
  on('[data-ewfocus]', (el) => {
    const t = s.tokens.find((x) => x.uid === Number(el.dataset.ewfocus));
    if (!t) return;
    // The Link is spent by the unit's own player, which is the whole reason
    // this exchange is split across the two seats.
    if (!ctx.send({ kind: 'focus', seat: t.side, uid: t.uid }).ok) { ctx.refresh(); return; }
    const ev = electronicValue(ctx.data, t);
    void ctx.rollHits(ev, `spends 1 Link to Focus the Counter-roll`).then((res) => {
      ctx.send({ kind: 'rollCounter', seat: t.side, uid: t.uid, faces: res.dice.map((d) => d.face), focused: true });
      ctx.refresh();
    });
  });
  on('[data-ewapply]', () => {
    const c = ensureScript(s).counter;
    const init = c ? s.tokens.find((x) => x.uid === c.initiatorUid) : undefined;
    const resp = c ? s.tokens.find((x) => x.uid === c.responderUid) : undefined;
    if (c && init && resp) {
      const a = actionOn(ctx, init, c.actionId);
      // Fire Control Interference is what an Electronic Attack hands out unless
      // the card names another token, which the effect data would carry.
      const named = (a?.gameRules ?? []).flatMap((g) => g.effects ?? [])
        .find((e) => (e as { type?: string }).type === 'apply_status') as { status?: string; stacks?: number } | undefined;
      const def = STATUSES.find((x) => x.label === named?.status || x.id === named?.status) ?? STATUSES.find((x) => x.id === 'fci')!;
      ctx.send({ kind: 'applyStatus', seat: init.side, uid: init.uid, targetUid: resp.uid, statusId: def.id, stacks: named?.stacks ?? 1 });
      ctx.noteNow(`${init.label} succeeds: ${resp.label} gains ${def.label} (4.11.3).`);
      ctx.send({ kind: 'clearCounterRoll', seat: init.side });
    }
    ctx.refresh();
  });
  on('[data-act="ewclose"]', () => { ctx.send({ kind: 'clearCounterRoll', seat: me() }); ctx.refresh(); });
  on('[data-tactic]', (el) => {
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
    const m = chargePlan;
    const t = m ? s.tokens.find((x) => x.uid === m.uid) : undefined;
    chargePlan = null;
    if (m && t) {
      const slot = el.dataset.chargeslot!;
      // Charging is the whole Action; spending is the run-up to an attack, and
      // that attack is the tool the Ticks are waiting on.
      if (m.on) commitAction(ctx);
      if (ctx.send({ kind: 'setCharge', seat: t.side, uid: t.uid, slot, on: m.on }).ok) {
        ctx.noteNow(m.on
          ? `${t.label}: the Charge Token on ${slot} is now face-up.`
          : `${t.label}: the Charge Token on ${slot} is spent.`);
      }
      const next = m.actionId ? actionOn(ctx, t, m.actionId) : undefined;
      if (next) openAttackPick(t, next);
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
    if (next && t) openAttackPick(t, next);
    else dropAction();
    ctx.refresh();
  });
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
        ctx.noteNow(`Resupply: ${to.label} is back to Ammo ${to.ammo?.[m.rule.actionId] ?? 0}/${max}.`);
      }
    }
    ctx.refresh();
  });
  on('[data-act="resupplycancel"]', () => { resupplyPick = null; dropAction(); ctx.refresh(); });
  on('[data-terminal]', (el) => {
    if (terminalPick) terminalPick.itemId = el.dataset.terminal;
    ctx.refresh();
  });
  on('[data-tverdict]', (el) => {
    const m = terminalPick;
    terminalPick = null;
    if (m?.itemId) {
      const t = s.tokens.find((x) => x.uid === m.uid);
      const zone = normaliseTasks(s.tasks).items.find((i) => i.id === m.itemId)?.zone ?? '';
      const name = ctx.data.zoneData.zones.find((z) => z.id === zone)?.name ?? zone;
      // The attempt was made either way, so the Action pays either way —
      // freeplay's done(true) on a failed roll spends the Tick too.
      commitAction(ctx);
      if (el.dataset.tverdict === 'won' && t) {
        if (ctx.send({ kind: 'accessTerminal', seat: t.side, uid: t.uid, itemId: m.itemId }).ok) {
          ctx.noteNow(`Remote Access succeeded: the ${name} Terminal is face-down for the rest of the round.`);
        }
      } else {
        ctx.noteNow(`Remote Access on the ${name} Terminal failed.`);
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
    const [mode, slot] = (el.dataset.repairgo ?? '').split(':');
    commitAction(ctx);
    if (ctx.send({ kind: 'repairPart', seat: t.side, uid: t.uid, slot, mode: mode as 'repaired' | 'mend' }).ok) {
      ctx.noteNow(mode === 'mend'
        ? `${t.label}: ${SLOT_LABEL[slot as PartSlot | 'main']} is mended back to intact.`
        : `${t.label}: ${SLOT_LABEL[slot as PartSlot | 'main']} takes a Repaired Token - its Actions return, but it stays destroyed for Integrity (J21).`);
    }
    ctx.refresh();
  });
  on('[data-act="repaircancel"]', () => { repairPick = null; dropAction(); ctx.refresh(); });
  on('[data-act="crushauto"]', () => {
    const m = crushPlan;
    const v = m ? s.tokens.find((x) => x.uid === m.queue[0]) : undefined;
    if (!m || !v) { advanceCrush(ctx); ctx.refresh(); return; }
    const out = crushEscapes(ctx, v, m.goal);
    // The auto path completes the whole placement, facing left as it stands.
    if (out.length) { placeCrushed(ctx, out[0].c, out[0].r); confirmCrushed(ctx); }
    else { m.queue.shift(); advanceCrush(ctx); ctx.refresh(); }
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
  on('[data-minego]', (el) => {
    startDetonation(Number(el.dataset.minego), el.dataset.mineact ?? '');
    ctx.refresh();
  });
  on('[data-revealgo]', (el) => {
    const uid = Number(el.dataset.revealgo);
    const t = ctx.state.tokens.find((x) => x.uid === uid);
    if (!t) return;
    revealDismissed.add(el.dataset.revealkey ?? '');
    ctx.send({ kind: 'reveal', seat: t.side, uid });
    ctx.noteNow(`${t.label} is Revealed (4.12.2).`);
    ctx.refresh();
  });
  on('[data-revealskip]', (el) => {
    revealDismissed.add(el.dataset.revealskip ?? '');
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
  on('[data-act="shoveturn"]', () => {
    // A blocked Forced Movement may still turn the victim in place, the
    // forcing player choosing — or leaving — the facing (FAQ B4/B5).
    const m = shovePlan;
    const by = m ? ctx.state.tokens.find((x) => x.uid === m.uid) : undefined;
    const victim = m?.targetUid !== null && m ? ctx.state.tokens.find((x) => x.uid === m.targetUid) : undefined;
    shovePlan = null;
    if (by && victim && m?.facing !== undefined) {
      ctx.send({ kind: 'forceMove', seat: by.side, uid: by.uid, targetUid: victim.uid, to: { col: victim.col, row: victim.row }, facing: m.facing });
      ctx.noteNow(`${victim.label} could not be moved, but is turned to face ${['North', 'East', 'South', 'West'][m.facing]}.`);
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
    const proj = s.tokens.find((x) => x.uid === detonateNow?.uid);
    if (proj && detonateNow) ctx.startAttack(proj.uid, detonateNow.actionId, Number(el.dataset.dettarget), 'explosion');
    ctx.refresh();
  });
  on('[data-detterrain]', (el) => {
    const proj = s.tokens.find((x) => x.uid === detonateNow?.uid);
    if (proj) ctx.send({ kind: 'destroyTerrain', seat: proj.side, uid: proj.uid, pieces: [el.dataset.detterrain!] });
    ctx.noteNow('Destructible Terrain takes no roll: it is removed outright (p.21).');
    ctx.refresh();
  });
  on('[data-detstatus]', (el) => { detonateStatus = el.dataset.detstatus!; ctx.refresh(); });
  on('[data-deteffect]', (el) => {
    const proj = s.tokens.find((x) => x.uid === detonateNow?.uid);
    const hit = s.tokens.find((x) => x.uid === Number(el.dataset.deteffect));
    if (proj && hit) {
      ctx.send({ kind: 'applyStatus', seat: proj.side, uid: proj.uid, targetUid: hit.uid, statusId: detonateStatus });
    }
    ctx.refresh();
  });
  // The Projectile is Destroyed whatever it achieved (4.7.5), so both the Done
  // and the Cancel path have to say which one happened.
  on('[data-act="detdone"]', () => {
    const proj = s.tokens.find((x) => x.uid === detonateNow?.uid);
    detonateNow = null;
    if (proj) {
      ctx.send({ kind: 'despawn', seat: proj.side, uid: proj.uid, targetUid: proj.uid });
      ctx.noteNow(`${proj.label} detonated and is destroyed (4.7.5).`);
    }
    ctx.refresh();
  });
  on('[data-act="detcancel"]', () => {
    detonateNow = null;
    ctx.refresh();
  });
  on('[data-act="smokeauto"]', () => {
    const next = smokeOwed?.[0];
    if (next?.cells.length) removeOwedSmoke(ctx, next.cells[0]);
  });

  // ---------- Interception (4.9) ----------
  // Taking an owed attempt spends the Token and clears the debt in one move, so
  // a refused spend must not leave the attempt struck off the list.
  on('[data-intercept]', (el) => {
    const item = owedItems(ctx)[Number(el.dataset.intercept)];
    const by = item ? s.tokens.find((x) => x.uid === item.uid) : undefined;
    const at = item ? s.tokens.find((x) => x.uid === item.targetUid) : undefined;
    if (!item || !by || !at) { ctx.refresh(); return; }
    const paid = ctx.send({ kind: 'spendIntercept', seat: by.side, uid: by.uid, actionId: item.actionId });
    if (!paid.ok) { ctx.refresh(); return; }
    ctx.send({ kind: 'resolveIntercept', seat: by.side, uid: item.uid, actionId: item.actionId, targetUid: item.targetUid });
    beginIntercept(ctx, by, item.actionId, at);
    ctx.refresh();
  });
  on('[data-inttarget]', (el) => {
    const pick = interceptPick;
    const by = pick ? s.tokens.find((x) => x.uid === pick.uid) : undefined;
    const at = s.tokens.find((x) => x.uid === Number(el.dataset.inttarget));
    if (!pick || !by || !at) { ctx.refresh(); return; }
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
      const left = by?.intercept?.[f.actionId] ?? 0;
      if (!at) {
        ctx.noteNow(`The target is destroyed, so the chain ends. ${left} Interception Token${left === 1 ? '' : 's'} left on that Part for the rest of the game.`);
      } else if (!by || !alive(by)) {
        // The obligation died with the unit; nothing more is owed.
      } else if (left <= 0) {
        ctx.noteNow(`${at.label} survived, but ${by.label} has spent every Interception Token on that Part and cannot try again (4.9).`);
      } else {
        ctx.send({ kind: 'queueIntercepts', seat: by.side, items: [f] });
        ctx.noteNow(`${at.label} survived, so ${by.label} must Intercept again until its Tokens run out or the target is destroyed (4.9). ${left} left.`);
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
        ctx.noteNow(`Link has reached 0, so ${t.label} shuts down.`);
      }
    }
    ctx.refresh();
  });
  on('[data-act="maneuver"]', (el) => {
    if (el.dataset.why) { ctx.noteNow(el.dataset.why); ctx.refresh(); return; }
    const sc = ensureScript(s);
    const t = sc.opp ? s.tokens.find((x) => x.uid === sc.opp!.uid) : undefined;
    if (!t) { ctx.refresh(); return; }
    // The Harpy asks about its drag BEFORE the plan exists, because the -2
    // comes out of the allowance the overlay is about to show. Same shared
    // offer as freeplay; anyone else starts the plan straight away.
    void offerHarpyDrag(ctx.data, s, t, maneuverRange(ctx.data, t)).then((drag) => {
      if (drag === 'cancelled') { ctx.refresh(); return; }
      startMovePlan(ctx, t, { label: t.kind === 'mech' ? 'Maneuver' : 'Movement', maneuver: true });
      if (drag && movePlan) {
        movePlan.steps -= 2;
        movePlan.drag = drag;
      }
      ctx.refresh();
    });
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
    ctx.send({ kind: 'award', seat: me(), vp: { s1: side === 's1' ? 1 : 0, s2: side === 's2' ? 1 : 0 }, keys: [] });
    ctx.refresh();
  });
  on('[data-act="endopp"]', () => {
    const sc = ensureScript(s);
    if (sc.opp) {
      const t = s.tokens.find((x) => x.uid === sc.opp!.uid);
      // The Integrated Data Link Pod coordinates when the Opportunity ENDS
      // rather than off an Action, so its offer goes here - a Passive is never
      // performed and commitAction can never reach it. The Opportunity closes
      // afterwards either way, so declining costs nothing.
      const owed = t ? coordinationOnOpportunityEnd(ctx.data, t) : 0;
      if (t && owed > 0 && readyCommands(t) > 0) {
        const uid = sc.opp.uid;
        void offerCoordination(ctx.data, s, t, owed, (mechUid, targetUid) => {
          ctx.send({ kind: 'coordinateCommand', seat: t.side, uid: mechUid, targetUid });
        }, (_d, text) => ctx.noteNow(text)).then(() => {
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
      ctx.send({ kind: 'endOpportunity', seat: t?.side ?? me(), uid: sc.opp.uid });
    }
    // Walking away from a tool that never resolved leaves its Action unperformed.
    dropAction();
    movePlan = null;
    inspectUid = null;
    board?.clearMovePath();
    ctx.refresh();
  });
  on('[data-endstep]', (el) => {
    const step = el.dataset.endstep!;
    // Dissipation takes the isolated screens off both sides at once and then
    // owes one from each Connected group; glueAfter turns that into the queue
    // the choice panel walks. Said out loud, because it changes the board.
    if (step === 'smoke') {
      const before = (['s1', 's2'] as Side[]).map((side) => ({ side, ...dissipationFor(ctx.state.smoke ?? [], side) }));
      const iso = before.reduce((n, d) => n + d.isolated.length, 0);
      const groups = before.reduce((n, d) => n + d.groups.length, 0);
      ctx.send({ kind: 'dissipateSmoke', seat: me() });
      ctx.noteNow(iso || groups
        ? `${iso} isolated Smoke Screen${iso === 1 ? '' : 's'} removed${groups ? `, and ${groups === 1 ? 'one Connected group loses one' : `each of ${groups} Connected groups loses one`}` : ''} (4.16).`
        : 'Nothing to dissipate.');
    }
    // "Settle Task control" is the step that pays: the guide judges the board
    // and sends the numbers with the Award, so a mirrored seat applies the same
    // VP rather than working them out again and maybe differently.
    // Marking the step is idempotent; paying for it is not. Both players can
    // see this button, so without the guard two near-simultaneous presses
    // would award the round twice.
    const alreadySettled = ensureScript(ctx.state).endDone.includes(`${ctx.state.round.n}:end:tasks`);
    if (step === 'tasks' && !alreadySettled) {
      const last = ctx.state.round.n >= (ctx.state.roundLimit ?? 5);
      const got = scorePreview(ctx, last);
      if (got.lines.length) {
        ctx.send({
          kind: 'award', seat: me(),
          vp: { s1: got.s1, s2: got.s2 },
          keys: got.lines.map((l) => l.key).filter((k): k is string => !!k),
        });
      }
    }
    // The command does the work; this reads the board first so it can say what
    // the work was. A step that changes the board silently is the guide's one
    // habit worth not copying.
    const before = ctx.state.tokens.map((t) => ({
      uid: t.uid,
      label: t.label,
      expiring: [...(t.expiring ?? [])].filter((id) => (t.statuses ?? []).includes(id)),
      flipping: [...(t.expiring ?? [])],
    }));
    ctx.send({ kind: 'markEndStep', seat: me(), step });
    if (step === 'tokens') {
      const names = (ids: string[]) => [...new Set(ids)].map((id) => STATUSES.find((d) => d.id === id)?.label ?? id).join(', ');
      const said = before
        .filter((b) => b.expiring.length || b.flipping.length)
        .map((b) => `${b.label}: ${[b.expiring.length ? `${names(b.expiring)} expired` : '', b.flipping.length ? `${names(b.flipping)} flips to red` : ''].filter(Boolean).join(', ')}`);
      ctx.noteNow(said.length ? said.join(' · ') : 'Tokens aged and both Command pools cleared.');
    }
    if (step === 'remove') {
      const gone = before.filter((b) => !ctx.state.tokens.some((t) => t.uid === b.uid));
      ctx.noteNow(gone.length
        ? `Integrity Loss: ${gone.map((g) => g.label).join(', ')} left the board (4.4.4).`
        : 'No Mech was down to two Parts, so nothing left the board.');
    }
    ctx.refresh();
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
