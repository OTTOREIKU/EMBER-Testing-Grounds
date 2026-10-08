// WHAT A TURN OFFERS, read off the table with no page in it.
//
// The Match Centre's panels worked these out inline, between the lines that
// draw them: which of a unit's Actions may be performed now and why not, which
// Grids a Movement reaches, which enemies an attack may take and what each
// would cost, where a Projectile may land. A second reader of the same rules
// (the seat seam, src/seat.ts, and through it a computer player) needs the
// same answers, and a copy would drift from the panel a player is looking at.
// So the reading lives here, the panels draw from it, and the two cannot
// disagree (AI-OPPONENT-PLAN.md, rule R3). Every comment below came across
// with the line it explains.
//
// Nothing here touches the DOM, holds state, or sends a command.
import { ammoAvailable, check, liveIntercepts, type CheckResult, type Command } from './commands';
import type { GameData } from './data';
import { isAerial, isMine, unitSize } from './data';
import { idleWorldFor } from './glue';
import { alive, droneActionWhy, droneLockPhase, droneMoveWhy, isLoopPhase, onExtraOpportunity } from './loop';
import { breakAwayCost, breakAwayLinkBudget, canBeForceMoved, crawlHolders, obstructSurcharge, tetherCap } from './melee';
import {
  attackDirection, boardGrids, boxDropCells, breakAwayLinkDue, crushTargets, extendPath, firingSight, inArc, knockbackPath, largeGridOf, lineSpot, losNote, mineSpot, movePaths, pathCost, protectionFor,
  reachableGrids, routeStops, sightBetween, standingSpot, type CrushVictims, type LargeGrid,
} from './rules';
import { zoneCellsOf } from './scoring';
import { normaliseSetup } from './setup';
import { boxHands, deployGrids, normaliseTasks, remoteAccessWhy, type TaskItem } from './tasks';
import { actionIdOf, canActivate, canManeuver, canPerform, costOf, lengthOf, type ActionLength, type TickCost, type TickVerdict } from './ticks';
import type { Card, CardAction, Facing, GameState, Opportunity, PartSlot, Side, TerrainPiece, Token, TokenPick } from './types';
import { gridsOf, isLineUnit, PHASES, statusCount } from './types';
import {
  actionIdleWhy, actionPartWhy, actionRange, activatesCamo, armorPiercing, automaticShieldFor, autoNeutralTargets, autoTargetsFor,
  chargeAdjusted, chassisGone, commonPartSlots, multiTargetLimit, tokenCards,
  commonActionStop, commonPartKey, containerTargets, detonationBar, electronicAll, electronicAllTargets, electronicDash, electronicOrigins,
  electronicStrength, electronicTargetWhy, electronicValue, explosionScope, fliesToTarget, jumpsToTarget, keptWithoutTarget, missileFlight,
  projectileDelivery, scannable, volleyFor,
  envCardAt, envFlightFrom, envForcedStop, envMoveRules, extraActivationOf, flightGrant, formSwitch, freehandSlots, grantAdjusted, isGroundUnit, knockbackOf,
  guidedActions, highlightTargets, ignoresProtection, immobilizedStop, interceptHeld, interceptOwedAt, interceptsOwed, isAirborneAction, isChargeAction, isElectronicAttack, isPositionSwap,
  isRwsAction, isScanAction, linkShockOf, linkSupportOf, loanedParts, maneuverRange, mineStopIndex, needsSightToLanding, nonHumanoidCost,
  nonHumanoidStop, overwatchOf, ownCards, phasesThroughUnits, projectileReach, providesUnitProtectionToAllies, repairSpec, resupplyOf,
  riderOnDrone, selfStatusGrant, shockAttackOf, shockMoveAllowed, stanceFeedbackOf, stanceShaped, startOpts, stationaryAdjusted, straightLineBonus,
  targetStatusGrant, tetheredBy, tokenCleanupOf, transformOffer, twoHandedUse, unfoldsOwed,
  type Knockback, type MultiTarget, minesLayable, minesOwed, type MineLaying,
} from './units';

// ---------- the board ----------

// The terrain on the table. A SHIPPED AUTHORED map (E4) brings its own pieces;
// a terrain-only layout is looked up by id as before. One place, because three
// call sites read this and a disagreement between them would draw one board and
// shoot through another.
export function mapPieces(data: GameData, map: string): TerrainPiece[] {
  // Optional-chained: test fixtures build partial GameData objects, and a
  // missing boardMaps must read as "no authored maps", never throw.
  return data.boardMaps?.find((m) => m.id === map)?.pieces ?? data.terrain.layouts[map] ?? [];
}

// The terrain as it stands now, with anything destroyed taken out of it.
export function terrainOf(data: GameData, state: GameState): TerrainPiece[] {
  const gone = new Set(state.removedTerrain ?? []);
  return mapPieces(data, state.map).filter((p) => !gone.has(p.id));
}

export function actionOf(data: GameData, state: GameState, t: Token, actionId: string): CardAction | undefined {
  // The id may arrive as a part key when a Tarantula is lending the Part.
  const id = actionIdOf(actionId);
  // A Common Action last: every Mech has them and no card prints them. Without
  // it the Scan could never be found, so no Counter-roll window drew for one
  // and its win granted Fire Control Interference (audit Phase 3, A1).
  return ownCards(data, t).flatMap(({ card }) => card.actions ?? []).find((a) => a.id === id)
    ?? loanedParts(data, state.tokens, t).flatMap(({ card }) => card.actions ?? []).find((a) => a.id === id)
    ?? (data.commonActions ?? []).find((a) => a.id === id) as CardAction | undefined;
}

// ---------- deployment (3.1.4) ----------

// The board cells a side may deploy into, from its edge and the mission's
// printed deployment shape (2x12 strips when no mission says otherwise).
// The reading is the engine's (tasks.ts deployGrids), so what a board lights
// is what the deployUnit check accepts. An authored map's own Deployment Zones
// win over the printed shape: without them a 16 or 18 Grid board would deploy
// into A1-L12, putting the White zone in the middle of the table.
export function deployCellsFor(data: GameData, s: GameState, side: Side): Set<string> {
  const su = normaliseSetup(s.setup);
  const out = new Set<string>();
  if (!su) return out;
  for (const k of deployGrids(data.zoneData, s, su.edge[side]) ?? []) {
    const [zc, zr] = k.split(',').map(Number);
    for (let dc = 0; dc < 3; dc++) for (let dr = 0; dr < 3; dr++) out.add(`${zc * 3 + dc},${zr * 3 + dr}`);
  }
  return out;
}

// The middle of a squad's Deployment Zone, in cells. Used to point a unit at
// the enemy as it lands, so nothing has to be turned by hand before confirming.
export function zoneCentre(cells: Set<string>): { col: number; row: number } | null {
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

// ---------- Movement ----------
//
// The same reachability the freeplay board offers: Large Grids within the
// unit's Movement Range, terrain-aware, with Break Away and Crush priced the
// same way. The path law lives with the sender on every page — the engine's
// maneuver trusts the move it is handed.

export function moveOptsFor(data: GameData, state: GameState, t: Token, flying: boolean, actionId?: string) {
  const terrain = terrainOf(data, state);
  const env = envMoveRules(data, state, t, flying || !!t.aerial);
  const away = flying || t.aerial ? undefined : breakAwayCost(data, t, state.tokens, terrain);
  // A Crawl never leaves a Grid in which the Mech is Melee Locked, flown or
  // walked (6.1; ruled R2, audit Phase 7, P7B 14), as main.ts moveOpts.
  const home = crawlHolders(data, t, actionId ? actionOf(data, state, t, actionId) : null, state.tokens, terrain).length ? largeGridOf(t) : null;
  const stay = home ? (c: number, r: number): boolean => c === home.c && r === home.r : undefined;
  const tethered = tetherCap(t, state.tokens);
  const leash = tethered && stay ? (c: number, r: number): boolean => tethered(c, r) && stay(c, r) : tethered ?? stay;
  return {
    exitCost: away && env.exitCost ? (c: number, r: number) => away(c, r) + env.exitCost!(c, r) : away ?? env.exitCost,
    crushable: (c: number, r: number) => crushTargets(t, c, r, terrain, state.tokens) !== null,
    allowed: leash && env.allowed ? (c: number, r: number) => leash(c, r) && env.allowed!(c, r) : leash ?? env.allowed,
    stop: env.stop,
    landing: env.landing,
    phaseThrough: phasesThroughUnits(data, state.tokens, t),
    straightBonus: straightLineBonus(actionId ? actionOf(data, state, t, actionId) : null),
    // Obstruct's "or 1 Link" (LPA-20; audit Phase 4, D2), as main.ts moveOpts.
    linkPay: away
      ? { budget: breakAwayLinkBudget(t, nonHumanoidCost(actionId ? actionOf(data, state, t, actionId) ?? null : null)), payable: obstructSurcharge(data, t, state.tokens, terrain) }
      : undefined,
  };
}

// AUTO MINE LAYING (006_A; FAQ M7, M29): what a Movement that walks `path`
// may Lay along it, paid for with the Move Range it leaves unspent, 1 a Mine.
// The Match Centre's Mine panel reads it once the walk has landed, and a seat
// reads it of the walk it is offered.
export function minesOnRoute(data: GameData, state: GameState, t: Token, path: LargeGrid[], steps: number, flying: boolean): MineLaying | null {
  const flown = flying || !!t.aerial;
  const spare = steps - pathCost(path, flown, moveOptsFor(data, state, t, flying));
  return minesLayable(data, t, path, spare, flown, state.tokens);
}

// Same derivation as the freeplay board: a square-base flyer (moveAsFlight)
// crosses terrain even though it is not Aerial. Reading only `aerial` here
// grounded the Ravens on the Match Centre while the guide let them fly.
export function movesAsFlight(data: GameData, state: GameState, t: Token): boolean {
  return !!data.byId.get(t.cardId)?.moveAsFlight || !!t.aerial || envFlightFrom(data, state, t);
}

// `steps` is how far this particular Movement reaches — a Maneuver uses the
// Chassis Value, a Movement Action its own printed Range. Hardcoding the
// Maneuver here drew the Maneuver's reach under a Sprint that could go further,
// so the panel said 4 grids while the board highlighted 1.
// `asFlight` overrides the derivation while a route is being drawn: a Part can
// put a Mech into Flying Movement for this move only, and the highlight has to
// answer to the plan or the toggle would change nothing on the board.
export function reachableFor(data: GameData, state: GameState, t: Token, steps = maneuverRange(data, t), asFlight?: boolean, actionId?: string) {
  const flying = asFlight ?? movesAsFlight(data, state, t);
  // The overlay and the route read ONE set of MoveOpts. They were built twice,
  // and a rule added to one only painted Grids the confirm step refused, or
  // left dark Grids it took: Obstruct's "or 1 Link" was on the route alone, so
  // a Mech in a Panzer lock saw nothing lit it could reach (LPA-20; audit
  // Phase 7, P7D 6). The leash, the Abyss, the Firefly, a Crawl's hold and the
  // straight line all ride the same opts.
  return reachableGrids(t, steps, terrainOf(data, state), state.tokens, flying, moveOptsFor(data, state, t, flying, actionId));
}

// ---------- a Movement, from the plan to the command ----------
//
// The planner's two ends, with no planner in them: how a Movement opens, and
// what a drawn route comes to. The Match Centre draws the route between the
// two with a cursor; a seat that only picks a Grid asks the same two
// questions, so both send the same command for the same route.

// How a Movement opens: how far it reaches and whether it is flown.
export interface MoveStart {
  steps: number;
  flying: boolean;
  // An Ojs200 lends its Mech Flying Movement on the MANEUVER and says "may", so
  // this move can be flown or walked and the choice is offered. A Fairy pair
  // grants it outright instead, which sets `flying` and leaves this false.
  flightOptional: boolean;
}

// A Maneuver by default. A Movement Action passes its own Range instead: the
// chassis `move` is the Maneuver Value (1–2 Grids) and has nothing to do with a
// Sprint-style Action's printed range, which is usually 4.
export function moveStart(
  data: GameData, state: GameState, t: Token,
  opts: { range?: number; actionId?: string; maneuver?: boolean; airborne?: boolean } = {},
): ({ ok: true } & MoveStart) | { ok: false; why: string } {
  // IMMOBILIZED (6.3.2), asked before the planner opens. This board had NO
  // enforcement of the movement ban at all - the token simply moved - so this
  // and the command gate behind it are the whole of the rule online.
  const stopped = immobilizedStop(t, opts.actionId ? actionOf(data, state, t, opts.actionId) : null);
  if (stopped) return { ok: false, why: stopped };
  // NON-HUMANOID X, asked here for the same reason: the command behind this
  // will refuse it anyway, but a player should be told before drawing a route
  // rather than after committing to one.
  const shortLink = nonHumanoidStop(t, opts.actionId ? actionOf(data, state, t, opts.actionId) : null);
  if (shortLink) return { ok: false, why: shortLink };
  const steps = opts.range || maneuverRange(data, t);
  // FAQ E4: a Mech whose Chassis is destroyed cannot move, but its Maneuver
  // may still turn it. The planner refused to open at Range 0, and Q and E only
  // turn inside a plan, so the turn was out of reach here (audit Phase 4, E4).
  // It opens at 0, and the commit sends the pivot as the Maneuver it is. A
  // Repaired Chassis moves as normal (ruled R5; audit Phase 7, P7B 12).
  const pivotOnly = steps <= 0 && !opts.actionId && !opts.range && chassisGone(t);
  if (steps <= 0 && !pivotOnly) return { ok: false, why: `${t.label} has no Movement Range on its card.` };
  // Flight from a Part, on the same reading the freeplay board uses. A Fairy
  // pair flies every move; an Ojs200 offers it on the Maneuver and may be
  // declined, so it starts walking and the panel carries the switch. An
  // Airborne Movement Action outranks all of it: that Jump simply IS Flying.
  const base = !!data.byId.get(t.cardId)?.moveAsFlight;
  const grant = base ? 'none' : flightGrant(data, t, loanedParts(data, state.tokens, t));
  // Anti-Gravity: a Ground Unit whose Movement originates in that Grid flies
  // it, with no choice in it - so the Ojs200's walk/fly switch is pinned off.
  const envFly = envFlightFrom(data, state, t);
  const optional = !opts.airborne && grant === 'maneuver' && !!opts.maneuver && !envFly;
  return { ok: true, steps, flying: base || !!opts.airborne || grant === 'always' || envFly, flightOptional: optional };
}

// The Movement a Moving Action makes, as the planner is opened for it: its own
// printed Range (the Maneuver's when it prints none), named so the command
// layer can judge the Action, flown when it carries Airborne Movement.
export function actionMove(a: CardAction): { actionId: string; range: number | undefined; free: boolean; airborne: boolean } {
  return {
    actionId: a.id,
    range: a.range || undefined,
    // Free means "the Action Tick already paid for this move". A Drone's
    // Action costs no Tick, so there is no performed Action for a free move to
    // ride on and it is an ordinary Movement.
    free: !!lengthOf(a),
    // A Jump carrying Airborne Movement IS a Flying Movement (空中移动), with
    // no choice in it - unlike the Ojs200's optional Maneuver.
    airborne: isAirborneAction(a),
  };
}

// SHOCK ATTACK X (冲锋X; Supplementary Rules 1.04, 3.8): "Before performing
// this Action, may move X grids." How far the walk before the attack may go,
// as the Match Centre's attack door offers it (matchhud.ts openAttackPick):
// the keyword as the Stance and the Opportunity grant it (the Spear, the
// Lance and the Halberd gain it in Offensive Stance), for a Mech with its
// Chassis, and not for a unit that is Immobilized (6.3.2). 0 for none.
export function shockWalk(state: GameState, t: Token, a: CardAction): number {
  const opp0 = state.script?.opp;
  const opp = opp0?.uid === t.uid ? opp0 : null;
  const x = shockAttackOf(grantAdjusted(stationaryAdjusted(a, opp), t, opp));
  return x > 0 && shockMoveAllowed(t) && !immobilizedStop(t, null) ? x : 0;
}

// One leg of a route: from the end of the route drawn so far to a Grid, by the
// shortest legal run within what the Movement has left. Null when the Grid
// changes nothing or cannot be reached (rules.ts extendPath), read against the
// same MoveOpts the overlay lights its Grids by.
export function extendRoute(data: GameData, state: GameState, t: Token, path: LargeGrid[], to: LargeGrid, steps: number, flying: boolean, actionId?: string): LargeGrid[] | null {
  return extendPath(path, to, t, steps, terrainOf(data, state), state.tokens, flying, moveOptsFor(data, state, t, flying, actionId));
}

// The first leg of a route to each of several Grids, from where the unit
// stands: each exactly what extendRoute gives for a route of that one Grid
// (rules.ts extendPath, which for a route not yet begun is the shortest legal
// run from the Grid it starts in). One search of the board serves every goal,
// where asking a Grid at a time searches it once for each: a seat listing all
// the Grids a Movement reaches asks for forty or more.
export function extendRoutes(
  data: GameData, state: GameState, t: Token, from: LargeGrid, goals: LargeGrid[], steps: number, flying: boolean, actionId?: string,
): (LargeGrid[] | null)[] {
  const opts = moveOptsFor(data, state, t, flying, actionId);
  // A route that stands in a stop Grid is finished, and one with no Range
  // left goes nowhere (a straight run's bonus is Range too).
  if (opts.stop?.(from.c, from.r) || steps + (opts.straightBonus ?? 0) <= 0) return goals.map(() => null);
  const mover = { ...t, col: from.c * 3 + 1, row: from.r * 3 + 1 };
  const runs = movePaths(mover, goals, steps, terrainOf(data, state), state.tokens, flying, opts);
  return goals.map((to, i) => {
    if (to.c === from.c && to.r === from.r) return null;
    const run = runs[i].slice(1);
    return run.length ? [from, ...run] : null;
  });
}

// THE ROAD to a Grid: the walk there from where the unit stands, however many
// Movements it takes, as the route search its own Movement is drawn with finds
// it (terrain, Break Away, a leash, flight). A Large Ground Unit reads the
// board with its Destructible Terrain gone, because it crushes its way through
// (4.3.6): each such Grid ends the Movement that enters it, and the next one
// goes on from there. Null when nothing leads there.
export function roadTo(data: GameData, state: GameState, t: Token, to: LargeGrid, flying: boolean): LargeGrid[] | null {
  const crusher = t.size === 3 && !t.aerial && !flying && statusCount(t.statuses, 'camouflage') === 0;
  const terrain = terrainOf(data, state).filter((p) => !(crusher && p.isFragile));
  return extendPath([largeGridOf(t)], to, t, gridsOf(state) * 4, terrain, state.tokens, flying, moveOptsFor(data, state, t, flying));
}

// THE ROADS to several Grids at once: each exactly the road roadTo finds for
// that Grid, all read off one search of the board. The road to a Grid is the
// planner's first leg from where the unit stands (rules.ts extendPath on a
// route of one Grid), which is a shortest run from that Grid: the same run for
// every goal, so one search serves them all.
export function roadsToAll(data: GameData, state: GameState, t: Token, goals: LargeGrid[], flying: boolean): (LargeGrid[] | null)[] {
  const crusher = t.size === 3 && !t.aerial && !flying && statusCount(t.statuses, 'camouflage') === 0;
  const terrain = terrainOf(data, state).filter((p) => !(crusher && p.isFragile));
  const here = largeGridOf(t);
  const opts = moveOptsFor(data, state, t, flying);
  // A unit standing in a Grid that ends a Movement has no route out to draw.
  if (opts.stop?.(here.c, here.r)) return goals.map(() => null);
  const from = { ...t, col: here.c * 3 + 1, row: here.r * 3 + 1 };
  const runs = movePaths(from, goals, gridsOf(state) * 4, terrain, state.tokens, flying, opts);
  return goals.map((to, i) => {
    if (to.c === here.c && to.r === here.r) return null;
    const run = runs[i].slice(1);
    return run.length ? [here, ...run] : null;
  });
}

// ---------- how long a walk is ----------
//
// A road says which Grids lead somewhere. A seat planning over several rounds
// wants to know WHEN it would be there, and the board decides that as much as
// the distance does. A Large Ground Unit crushes its way through a Container,
// and the Movement that enters that Grid ends in it (4.3.6). And a Mech's
// Ticks are spent in order (3.4.5): its Maneuver comes BEFORE any Action, so
// an activation is the Maneuver and then a Movement Action, never the other
// way about. Four Grids with a Container in the first of them is a Maneuver
// into the Container and a Sprint on from it, one activation; with the
// Container in the second it is two, because the Sprint ends there and the
// Maneuver is already behind it.

// THE MOVEMENTS ONE ACTIVATION IS MADE OF, as Ranges, in the order they are
// made: a Mech's Maneuver, then the longest Movement Action printed on a Part
// of it that still works; any other unit's one Movement; nothing for a
// Projectile. What a walk of several activations is counted in.
export function movementsOf(data: GameData, t: Token): number[] {
  if (t.kind === 'projectile') return [];
  const maneuver = maneuverRange(data, t);
  if (t.kind !== 'mech') return maneuver > 0 ? [maneuver] : [];
  const repaired = new Set<string>(t.repairedSlots ?? []);
  let action = 0;
  for (const { slot, card } of ownCards(data, t)) {
    if (slot !== 'pilot' && slot !== 'main' && (t.partStates?.[slot] ?? 'intact') === 'destroyed' && !repaired.has(slot)) continue;
    for (const a of card.actions ?? []) {
      // A Movement Action that prints no Range of its own moves the Maneuver's.
      if (a.type === 'Moving' && a.speed !== 'passive') action = Math.max(action, a.range || maneuver);
    }
  }
  return [maneuver, action].filter((n) => n > 0);
}

// Whether a unit's every Movement is flown: a flying base, an Aerial unit, a
// Part that grants flight outright. A flight it may choose, or is lent by the
// Grid it stands in, is not counted on for a walk of several rounds.
function walksAsFlight(data: GameData, state: GameState, t: Token): boolean {
  return !!data.byId.get(t.cardId)?.moveAsFlight || !!t.aerial || flightGrant(data, t, loanedParts(data, state.tokens, t)) === 'always';
}

// Whether a unit crushes its way through Destructible Terrain (4.3.6).
function crushesTerrain(data: GameData, state: GameState, t: Token): boolean {
  return t.size === 3 && !t.aerial && !walksAsFlight(data, state, t) && statusCount(t.statuses, 'camouflage') === 0;
}

// One walk: the Grids on the shortest road, and the fewest activations a walk
// takes (which may be by a longer road with no Container on it).
export interface Walk { grids: number; turns: number }

// Every walk of one unit to one set of Grids. `walks` is by Grid ('c,r'), for
// a walk begun with a whole activation. `after` is for one begun in the middle
// of an activation: with these Movements still to make from this Grid, in this
// order, how many activations MORE the walk takes (0: they reach by
// themselves), or null where no road leads.
export interface WalkField {
  walks: Map<string, Walk>;
  after: (from: LargeGrid, left: number[]) => number | null;
}

// Everything a unit's walks are read from, as a key: who keeps a field
// (walkField) keeps it by this, and a field kept by it is the field that would
// be worked out again.
export function walkKey(data: GameData, state: GameState, t: Token): string {
  return [
    t.uid, t.size, t.aerial ? 1 : 0, walksAsFlight(data, state, t) ? 1 : 0, crushesTerrain(data, state, t) ? 1 : 0, movementsOf(data, t).join('+'),
    state.map, gridsOf(state), (state.removedTerrain ?? []).join(','), JSON.stringify(state.environments ?? []),
  ].join('|');
}

// The Grids that end a Movement the moment it enters them, for this unit: the
// Destructible Terrain a Large Ground Unit crushes its way into (4.3.6), and a
// Fragile Platform.
export function walkStops(data: GameData, state: GameState, t: Token): Set<string> {
  const stops = new Set<string>();
  if (crushesTerrain(data, state, t)) {
    for (const p of terrainOf(data, state)) {
      if (p.isFragile) for (const cell of p.subCells) stops.add(`${Math.floor(cell.col / 3)},${Math.floor(cell.row / 3)}`);
    }
  }
  const stop = envMoveRules(data, state, t, walksAsFlight(data, state, t)).stop;
  if (stop) for (let c = 0; c < gridsOf(state); c++) for (let r = 0; r < gridsOf(state); r++) if (stop(c, r)) stops.add(`${c},${r}`);
  return stops;
}

const STEPS = [[0, -1], [1, 0], [0, 1], [-1, 0]] as const;

// HOW LONG A WALK IS, for one unit, from every Grid of the board to the nearest
// Grid of `to`: the Grids on the shortest road, and the fewest ACTIVATIONS a
// walk there takes.
//
// The board is read as the unit's own Movement reads it: a Grid may be stood
// in where `standingSpot` finds room for it (for a Large Ground Unit, with the
// Destructible Terrain it would crush taken away), a flown Movement crosses
// anything and lands where the unit could stand, an Abyss is closed. Movement
// is a Grid at a time, north, east, south or west, as the route search
// (rules.ts searchMoves) steps. An activation is the unit's Movements in
// order (movementsOf), each as long as its Range or less, and one that enters
// a Grid that stops it (walkStops) ends there.
//
// The count is worked BACKWARDS from the Grids walked to: the Grids one
// activation away are those from which the Movements, in order, can end among
// them; two away, those from which they can end among those; and so on. That
// is one sweep of the board for each activation of the longest walk, however
// many Grids are asked about.
//
// THE UNITS ON THE BOARD ARE LEFT OUT, the walker's own leash and Break Away
// with them, and what leaving a Grid costs on Rugged ground: a walk of
// several rounds is made across a board on which nobody stands where they
// stand now. So this is where the terrain lets the unit go and how soon, and
// it changes only when the terrain does (walkKey).
//
// BY WAY OF A GRID (`via`): the walk is to that Grid first and then on to the
// Grids walked to, as a unit fetches a Black Box and carries it to the zone
// that pays for it (5.3.1). A Movement that enters the Box's Grid has the Box
// and goes on with what is left of its Range, and an activation that ends in
// that Grid has it too, so the fetch and the carry are counted as ONE walk:
// counted apart they are often an activation more than the walk takes.
export function walkField(data: GameData, state: GameState, t: Token, to: LargeGrid[], via?: LargeGrid): WalkField {
  const walks = new Map<string, Walk>();
  const legs = movementsOf(data, t);
  const none: WalkField = { walks, after: () => null };
  if (!legs.length) return none;
  const flying = walksAsFlight(data, state, t);
  const crusher = crushesTerrain(data, state, t);
  const terrain = terrainOf(data, state).filter((p) => !(crusher && p.isFragile));
  const stops = walkStops(data, state, t);
  const allowed = envMoveRules(data, state, t, flying).allowed;
  const landing = envMoveRules(data, state, t, flying).landing;
  const size = gridsOf(state);
  // Where it may end a Movement, and what a Movement may cross.
  const land = new Set<string>();
  const pass = new Set<string>();
  for (let c = 0; c < size; c++) {
    for (let r = 0; r < size; r++) {
      if (allowed && !allowed(c, r)) continue;
      const stands = standingSpot(c, r, t.size, !!t.aerial, terrain, [], t.uid) !== null;
      if (stands && (landing?.(c, r) ?? true)) land.add(`${c},${r}`);
      if (stands || flying) pass.add(`${c},${r}`);
    }
  }
  const beside = (k: string): string[] => {
    const [c, r] = k.split(',').map(Number);
    return STEPS.map(([dc, dr]) => `${c + dc},${r + dr}`).filter((n) => pass.has(n));
  };
  // ONE MOVEMENT, BACKWARDS: every Grid from which a Movement of this Range can
  // end in one of `into`. A Grid that stops a Movement may be where it ends,
  // or where it begins, and never a Grid it passes through.
  const back = (into: Set<string>, range: number): Set<string> => {
    const from = new Set(into);
    const crossed = new Set(into);
    let edge = [...into];
    for (let step = 0; step < range && edge.length; step++) {
      const next: string[] = [];
      for (const x of edge) {
        for (const q of beside(x)) {
          if (land.has(q)) from.add(q);
          if (!stops.has(q) && !crossed.has(q)) { crossed.add(q); next.push(q); }
        }
      }
      edge = next;
    }
    return from;
  };
  // ONE MOVEMENT, FORWARDS: every Grid a Movement of this Range from one of
  // `from` can end in, staying put among them.
  const onward = (from: Set<string>, range: number): Set<string> => {
    const ends = new Set(from);
    const crossed = new Set(from);
    let edge = [...from];
    for (let step = 0; step < range && edge.length; step++) {
      const next: string[] = [];
      for (const x of edge) {
        for (const n of beside(x)) {
          if (crossed.has(n)) continue;
          crossed.add(n);
          if (land.has(n)) ends.add(n);
          if (!stops.has(n)) next.push(n);
        }
      }
      edge = next;
    }
    return ends;
  };
  const goals = new Set(to.map((g) => `${g.c},${g.r}`).filter((k) => land.has(k)));
  if (!goals.size) return none;
  // The activations: the Grids no walk away, then one activation away, two ...
  const turns = new Map<string, number>();
  for (const k of goals) turns.set(k, 0);
  let reach = goals;
  for (let n = 1; n <= size * size; n++) {
    let wider = reach;
    for (let i = legs.length - 1; i >= 0; i--) wider = back(wider, legs[i]);
    if (wider.size === reach.size) break;
    for (const k of wider) if (!turns.has(k)) turns.set(k, n);
    reach = wider;
  }
  // The Grids on the shortest road, a Grid at a time from the Grids walked to.
  const grids = new Map<string, number>();
  for (const k of goals) grids.set(k, 0);
  let edge = [...goals];
  for (let d = 1; edge.length; d++) {
    const next: string[] = [];
    for (const x of edge) for (const q of beside(x)) if (!grids.has(q)) { grids.set(q, d); next.push(q); }
    edge = next;
  }
  if (!via) {
    for (const [k, n] of turns) walks.set(k, { grids: grids.get(k) ?? 0, turns: n });
    return {
      walks,
      after: (from, left) => {
        let ends = new Set([`${from.c},${from.r}`]);
        if (!land.has(`${from.c},${from.r}`) && !turns.has(`${from.c},${from.r}`)) return null;
        for (const range of left) ends = onward(ends, range);
        let best: number | null = null;
        for (const k of ends) {
          const n = turns.get(k);
          if (n !== undefined && (best === null || n < best)) best = n;
        }
        return best;
      },
    };
  }

  // ---------- by way of a Grid ----------
  // `turns` above is the walk WITH the Box in hand. `fetched` is the walk of a
  // unit that has still to fetch it, worked backwards the same way, an
  // activation at a time: a Grid is n activations away when the Movements, in
  // order, can leave the unit either with the Box in a Grid n-1 away with it,
  // or without it in a Grid n-1 away without it.
  const box = `${via.c},${via.r}`;
  const carry = grids.get(box);
  if (!pass.has(box) || carry === undefined) return none;
  const boxStops = stops.has(box);
  // A DRAWN ROUTE NEVER CROSSES ITSELF (rules.ts extendPath): a Movement that
  // goes on from the Box's Grid does not go back by the Grid it came in by.
  // So the walk through the Box is counted a side at a time: `side` is the
  // Grid beside the Box that the Movement enters it from.
  const sides = beside(box);
  // The fewest Grids a Movement that came in by `side` goes on for, to end in
  // one of `into` (0: it ends in the Box's Grid), within `range`; null if none.
  const onFrom = (into: Set<string>, range: number, side: string): number | null => {
    if (land.has(box) && into.has(box)) return 0;
    if (boxStops) return null;
    const crossed = new Set([box, side]);
    let edge = [box];
    for (let step = 1; step <= range && edge.length; step++) {
      const next: string[] = [];
      for (const x of edge) {
        for (const n of beside(x)) {
          if (crossed.has(n)) continue;
          crossed.add(n);
          if (land.has(n) && into.has(n)) return step;
          if (!stops.has(n)) next.push(n);
        }
      }
      edge = next;
    }
    return null;
  };
  // Every Grid a Movement of this Range reaches `side` from, free to go on a
  // Grid more: `side` itself, and the Grids it is reached from without
  // crossing the Box's Grid. A side that stops a Movement is gone on from only
  // by a unit that begins in it.
  const toSide = (side: string, range: number): Set<string> => {
    const from = new Set<string>();
    if (land.has(side)) from.add(side);
    if (stops.has(side)) return from;
    const crossed = new Set([side, box]);
    let edge = [side];
    for (let step = 0; step < range && edge.length; step++) {
      const next: string[] = [];
      for (const x of edge) {
        for (const q of beside(x)) {
          if (q === box) continue;
          if (land.has(q)) from.add(q);
          if (!stops.has(q) && !crossed.has(q)) { crossed.add(q); next.push(q); }
        }
      }
      edge = next;
    }
    return from;
  };
  // The same two, forwards. The fewest Grids a Movement from one of `from`
  // takes to stand in `side` (0: it begins there), not by the Box's Grid.
  const stepsTo = (from: Set<string>, side: string, range: number): number | null => {
    if (from.has(side)) return 0;
    if (stops.has(side)) return null;
    const crossed = new Set(from);
    crossed.add(box);
    let edge = [...from].filter((k) => k !== box);
    for (let step = 1; step <= range && edge.length; step++) {
      const next: string[] = [];
      for (const x of edge) {
        for (const n of beside(x)) {
          if (n === side) return step;
          if (crossed.has(n)) continue;
          crossed.add(n);
          if (!stops.has(n)) next.push(n);
        }
      }
      edge = next;
    }
    return null;
  };
  // Where a Movement that came into the Box's Grid by `side` can end, with
  // this much Range left.
  const onBy = (side: string, range: number): Set<string> => {
    const ends = new Set<string>();
    if (land.has(box)) ends.add(box);
    if (boxStops) return ends;
    const crossed = new Set([box, side]);
    let edge = [box];
    for (let step = 0; step < range && edge.length; step++) {
      const next: string[] = [];
      for (const x of edge) {
        for (const n of beside(x)) {
          if (crossed.has(n)) continue;
          crossed.add(n);
          if (land.has(n)) ends.add(n);
          if (!stops.has(n)) next.push(n);
        }
      }
      edge = next;
    }
    return ends;
  };
  const fetched = new Map<string, number>();
  let have = goals;
  let lack = new Set<string>();
  for (let n = 1; n <= size * size; n++) {
    let x1 = have;
    let x0 = new Set(lack);
    // An activation that ends in the Box's Grid picks the Box up as it ends.
    if (land.has(box) && have.has(box)) x0.add(box);
    for (let i = legs.length - 1; i >= 0; i--) {
      const range = legs[i];
      const before = back(x0, range);
      // Through the Box: into its Grid by one side, with a Grid of the
      // Movement, and on from it by the fewest Grids that end among those
      // wanted with the Box in hand.
      for (const side of sides) {
        const more = onFrom(x1, range - 1, side);
        if (more !== null) for (const q of toSide(side, range - 1 - more)) before.add(q);
      }
      x0 = before;
      x1 = back(x1, range);
    }
    let grew = x1.size > have.size;
    for (const k of x0) if (!fetched.has(k)) { fetched.set(k, n); grew = true; }
    have = x1;
    lack = x0;
    if (!grew) break;
  }
  // The Grids on the road: to the Box, and from it to the Grids walked to.
  const fetch = new Map<string, number>([[box, 0]]);
  let rim = [box];
  for (let d = 1; rim.length; d++) {
    const next: string[] = [];
    for (const x of rim) for (const q of beside(x)) if (!fetch.has(q)) { fetch.set(q, d); next.push(q); }
    rim = next;
  }
  for (const [k, n] of fetched) walks.set(k, { grids: (fetch.get(k) ?? 0) + carry, turns: n });
  return {
    walks,
    after: (from, left) => {
      const k = `${from.c},${from.r}`;
      if (!land.has(k) && !fetched.has(k)) return null;
      // Where the Movements still to make could leave it: without the Box, and
      // with it.
      let lacking = new Set([k]);
      let having = new Set<string>();
      for (const range of left) {
        const next = having.size ? onward(having, range) : new Set<string>();
        for (const side of sides) {
          const d = stepsTo(lacking, side, range - 1);
          if (d !== null) for (const x of onBy(side, range - 1 - d)) next.add(x);
        }
        lacking = onward(lacking, range);
        having = next;
      }
      if (land.has(box) && lacking.has(box)) having.add(box);
      let best: number | null = null;
      const least = (n: number | undefined): void => { if (n !== undefined && (best === null || n < best)) best = n; };
      for (const x of having) least(turns.get(x));
      for (const x of lacking) least(fetched.get(x));
      return best;
    },
  };
}

// ---------- a Movement that ends in a Crush (4.3.6) ----------
//
// What the planner sends when a route ends in a Grid something stands in
// (matchhud.ts advanceCrush, finishCrush), a piece at a time, so that a seat
// with no planner sends the same: the Destructible Terrain crushed, where the
// crusher lands once the Grid has given way, and the Movement's own record.

// The Destructible Terrain in the Grid, destroyed by whoever makes the Crush.
export function crushDestroy(by: { seat: Side; uid: number }, pieces: string[]): Command {
  return { kind: 'destroyTerrain', ...by, pieces };
}

// Where the crusher stands in the Grid once everything in it has given way, or
// null when it still cannot fit.
export function crushLanding(data: GameData, state: GameState, t: Token, goal: LargeGrid): { col: number; row: number } | null {
  return standingSpot(goal.c, goal.r, t.size, t.aerial, terrainOf(data, state), state.tokens, t.uid);
}

// The Movement, recorded as the crusher's own. `from` is given only when an
// exchange has already placed the unit.
export function crushRecord(
  t: Token,
  m: { free?: boolean; granted?: boolean; facing?: Facing; actionId?: string; breakAwayLink?: number; resume?: boolean },
  to: { col: number; row: number },
  via: { col: number; row: number }[],
  from?: { col: number; row: number },
): Command {
  return { kind: 'maneuver', seat: t.side, uid: t.uid, to, free: m.free, granted: m.granted, via, facing: m.facing, from, actionId: m.actionId, breakAwayLink: m.breakAwayLink, ...(m.resume ? { resume: true } : {}) };
}

// A Movement as it is planned: whose it is, how far it reaches, the route in
// Large Grids and the facing it ends on. The Match Centre's planner holds one
// while a route is drawn; a seat that picks a Grid builds one to ask what
// moving there would send.
export interface MoveDraft {
  uid: number;
  steps: number;
  flying: boolean;
  path: LargeGrid[];
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
  // The net quarter turns made: four one way is a full circle, which ends
  // facing where it began and is still a Movement (Supplementary Rules 1.04,
  // 1.8), so the pivot says so to the engine.
  spin: number;
  // The Red Shoes (TM35NA_B): the Mech whose won Counter-roll is steering
  // this ENEMY unit. The move travels as controlledMove from its seat, spends
  // no Tick, and ends in no Crush (audit Phase 3, D3).
  controller?: { uid: number; side: Side };
  // Where in the route's last Grid the unit stands, chosen by the player (a unit smaller than its Grid; OTTO,
  // 2026-10-08): rules.ts routeStops, where it fits. None: the free part of the Grid, as ever.
  spot?: { col: number; row: number } | null;
}

// What a planned Movement comes to.
export type MoveOrder =
  // Neither a route nor a turn: nothing to commit.
  | { kind: 'idle' }
  // A turn on the spot. `full` is the full circle that ends facing where it
  // began.
  | { kind: 'pivot'; full: boolean; command: Command }
  | {
      kind: 'route';
      // The route as it will be walked: cut short at the first Mine it enters.
      path: LargeGrid[];
      // The index of that Mine's Grid on the route drawn, or -1.
      cut: number;
      // The Range a Mine's stop keeps back for the Go on; undefined with no stop.
      halt: number | undefined;
      // Where the unit stands in each Grid of the walk, and the last of them.
      stops: { col: number; row: number }[];
      last: { col: number; row: number } | undefined;
      goal: LargeGrid;
      // The facing it ends on, when one was chosen.
      facing: Facing | undefined;
      // The Link the route owes an Obstruct lock its Range could not cover.
      linkDue: number | undefined;
      // What the last Grid holds that the unit Crushes by ending there.
      victims: CrushVictims | null;
      crushes: boolean;
      // The command that makes the move when it ends in no Crush: `maneuver`,
      // or `controlledMove` for a steered unit. Null when there is nowhere to
      // stand at the end of the route.
      command: Command | null;
    };

// Each stop takes the free part of its Grid rather than the middle, so a unit
// crossing a Grid holding a low wall walks past it instead of onto it. Only
// the destination goes to the engine; the walk is local animation.
export function moveOrder(data: GameData, state: GameState, t: Token, m: MoveDraft): MoveOrder {
  // Turning on the spot is a Movement in its own right and costs no Range, so a
  // Maneuver that only pivots is a finished Maneuver.
  if (m.path.length < 2) {
    if (!m.turned) return { kind: 'idle' };
    // The Red Shoes may spend its move on a pivot like any Maneuver.
    if (m.controller) {
      return { kind: 'pivot', full: false, command: { kind: 'controlledMove', seat: m.controller.side, uid: m.controller.uid, targetUid: t.uid, to: { col: t.col, row: t.row }, facing: m.facing, actionId: m.actionId } };
    }
    const full = m.facing === t.facing && Math.abs(m.spin) >= 4;
    return { kind: 'pivot', full, command: { kind: 'maneuver', seat: t.side, uid: t.uid, to: { col: t.col, row: t.row }, facing: m.facing, free: m.free, granted: m.granted, actionId: m.actionId, ...(full ? { spun: true } : {}) } };
  }
  // A Mine in a Grid the route enters stops the walk there (ruling I16): the
  // Mine owes its blast, and the Range left is kept for a Go on once it is
  // resolved (audit Phase 5, C1). Never a flight, which enters only its landing.
  // A controlled route stops there too, and The Red Shoes' one Movement ends in
  // the Mine's Grid: the rest is lost, so nothing is kept (ruled R5; audit
  // Phase 7, P7D 7). It used to pass through.
  const cut = mineStopIndex(data, state.tokens, t, m.path, m.flying);
  const halt = cut > 0 && !m.controller
    ? Math.max(0, m.steps - pathCost(m.path.slice(0, cut + 1), m.flying || !!t.aerial, moveOptsFor(data, state, t, m.flying, m.actionId)))
    : undefined;
  const path = cut > 0 ? m.path.slice(0, cut + 1) : m.path;
  const terrain = terrainOf(data, state);
  const stops = routeStops(t, path, m.flying || !!t.aerial, terrain, state.tokens, gridsOf(state), m.spot);
  const last = stops[stops.length - 1] as { col: number; row: number } | undefined;
  const facing = m.turned ? m.facing : undefined;
  const goal = path[path.length - 1];
  // What the route owes in Link for an Obstruct surcharge its Range could not
  // cover (LPA-20; audit Phase 4, D2), read before anything moves.
  const linkDue = breakAwayLinkDue(path, m.steps, m.flying || !!t.aerial, moveOptsFor(data, state, t, m.flying, m.actionId)) || undefined;
  // Ending in an occupied Grid is a Crush, and everything in there has to give
  // way before the crusher lands (4.3.6). The Movement ends there either way.
  const victims = crushTargets(t, goal.c, goal.r, terrain, state.tokens);
  const crushes = !!victims && (victims.units.length > 0 || victims.terrain.length > 0);
  // The route travels with the move so the other player watches the same walk.
  const command: Command | null = !last ? null : m.controller
    ? { kind: 'controlledMove', seat: m.controller.side, uid: m.controller.uid, targetUid: t.uid, to: last, via: stops, facing, actionId: m.actionId }
    : { kind: 'maneuver', seat: t.side, uid: t.uid, to: last, free: m.free, granted: m.granted, via: stops, facing, actionId: m.actionId, flying: m.flying || undefined, breakAwayLink: linkDue,
        ...(halt !== undefined ? { halt } : {}), ...(m.resume ? { resume: true } : {}) };
  return { kind: 'route', path, cut, halt, stops, last, goal, facing, linkDue, victims, crushes, command };
}

// Movement by an enemy AERIAL unit triggers Interception, checked at the
// start and landing grids only (FAQ O11/O15, 4.9). The start is where it
// stood before the move, so the probe is taken before the command applies:
// `start` is that copy (null for a unit that is not Aerial), and this is asked
// once the move has landed. What it returns is what the mover's side queues.
export function interceptsAfterMove(data: GameData, state: GameState, start: Token | null, uid: number): { uid: number; actionId: string; targetUid: number }[] {
  if (!start) return [];
  const moved = state.tokens.find((x) => x.uid === uid);
  return moved ? interceptsOwed(data, state.tokens, state.smoke ?? [], start, [moved]) : [];
}

// ---------- the Actions a unit may perform now ----------

export interface ActionRow {
  a: CardAction;
  // The Part it is taken from: the Action id, `id@uid` for a Load, `id@slot`
  // for a Common Action keyed to the Part that makes it.
  key: string;
  slot?: PartSlot | 'pilot' | 'main';
  cardId?: string;
  // The Action as this Stance prices it.
  priced: CardAction;
  len?: ActionLength;
  cost?: TickCost;
  // Whether it may be performed now, and the reason when it may not. `extra`
  // names the Extra Tick that would pay for it.
  v: TickVerdict;
  // A Mech commanded through RWS fires that Part and nothing else.
  rws: boolean;
  lender?: string;
  ammoLeft?: number;
  // Present only on an Action carrying the Charge Icon (4.14): whether the
  // Charge Token on its Part is face-up, to be spent on it.
  charge?: { charged: boolean };
  // What a Projectile Action may put on the board.
  projectiles?: Card[];
}

export function actionRows(data: GameData, state: GameState, t: Token, o: Opportunity): ActionRow[] {
  const terrain = terrainOf(data, state);
  // The same list the freeplay guide builds, from the same function: it is
  // where a destroyed Part, Shutdown, Melee Lock, Fire Control Interference,
  // Immobilised and an empty magazine all take an Action away. Asking only the
  // Tick engine, as the turn panel used to, let every one of those through.
  const guided = guidedActions(data, t, { tokens: state.tokens, terrain });
  const onExtra = onExtraOpportunity(state, o.uid);
  // What may bend the Starting Action rule, read the way check() reads it
  // (units.ts startOpts): an ally's Flexible Timing aura, Misty's Feint, CQC.
  // Keyed by PART, not by Action: two Carrier Tarantulas lending the same
  // Backpack lend two distinct Parts, and each may be used once (FAQ O7).
  const blockedBy = new Map<string, string | undefined>();
  for (const g of guided) if (!g.available) blockedBy.set(g.partKey, g.reason);
  // The board as units.ts actionIdleWhy reads it: an Action with nothing to do
  // (every Part Charged, nothing spent in reach, nobody to switch...) is
  // greyed with the reason, the same reading the other pages grey by, where
  // the panel it opened used to say so after the press (notices, 2026-09-29).
  const idleWorld = idleWorldFor(data, state, terrain);
  const ammoOf = new Map<string, number | undefined>();
  for (const g of guided) ammoOf.set(g.partKey, g.ammoLeft);
  const lentBy = new Map<string, string>();
  for (const g of guided) if (g.lentBy) lentBy.set(g.partKey, g.lentBy.label);
  // Remote Access has no row in a mission with no Terminal, as on the guide
  // and the pad, and says why when none is left to access (ruling I26; audit
  // Phase 6, E3).
  const items = normaliseTasks(state.tasks).items;
  const hasTerminals = items.some((i) => i.kind === 'terminal');
  const ra = t.kind === 'mech' && hasTerminals ? data.commonActions.find((a) => a.id === 'COMMON_REMOTE_ACCESS') : undefined;
  const raWhy = ra ? remoteAccessWhy(items, t, ra.range ?? 4, state.noBoard ? null : zoneCellsOf(data, state)) : null;
  if (raWhy) blockedBy.set('COMMON_REMOTE_ACCESS', raWhy);
  // Common Actions belong to Mechs (6.1); a Drone plays only what its card prints.
  // A Passive is not a choice — it applies itself when its situation arises, so
  // offering it as a button only invited a press that did nothing but print
  // "follow the Action text on the card". They are listed further down the
  // Details tab, where they read as the standing rules they are.
  const isPassive = (a: CardAction): boolean => a.type === 'Passive' || a.speed === 'passive';
  // The Part rides along: two R-20 Railguns, one per arm, print the same Action
  // and used to list as two identical rows with nothing to tell them apart.
  // A Punch/Kick or Crawl is keyed to the first of its Parts still free, so a
  // second one by another Part is its own Action (ruled R3; audit Phase 7,
  // P7B 9); every other Common Action keeps its own id.
  const acts: { a: CardAction; key: string; slot?: PartSlot | 'pilot' | 'main'; cardId?: string; charge?: { charged: boolean }; projectiles?: Card[] }[] = [
    ...guided.filter((g) => !isPassive(g.action))
      .map((g) => ({ a: g.action, key: g.partKey, slot: g.slot, cardId: g.card.id, charge: g.charge, projectiles: g.projectiles })),
    ...(t.kind === 'mech' ? data.commonActions.filter((a) => !isPassive(a) && (a.id !== 'COMMON_REMOTE_ACCESS' || hasTerminals)).map((a) => ({ a, key: commonPartKey(data, t, a, o.performed) })) : []),
  ];
  // RWS (遥控武器): a Mech activated in the Command Phase was sent a Command
  // for its autocannon, and that is the whole of what it may do here.
  const rwsOnly = t.kind === 'mech' && PHASES[state.round.phase] === 'Command';
  const seen = new Set<string>();
  return acts
    .filter(({ a }) => !rwsOnly || isRwsAction(a))
    .filter(({ key }) => (seen.has(key) ? false : (seen.add(key), true)))
    .map(({ a, key, slot, cardId, charge, projectiles }) => {
      // Priced in this Stance: ZHRA-102_A is Short in Offensive (Phase 2, D2).
      const priced = t.kind === 'mech' ? stanceShaped(a, t.stance) : a;
      const len = lengthOf(priced);
      // Ticks are a Mech's economy. A Drone's Action costs its activation
      // instead — one Action or one Movement, never both — and asking
      // canPerform about one only ever came back "this is not an Action a Mech
      // performs with Ticks", which blocked every Drone Action there is. A
      // Mech's own Passives are length-less too, which is why this asks the
      // unit rather than the Action.
      const ticks: TickVerdict = t.kind !== 'mech' || rwsOnly
        ? canActivate(o)
        : len ? canPerform(o, priced, key, startOpts(data, state.tokens, t, a)) : { ok: true };
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
      // droneLockPhase: a Coordination's activation takes the Command
      // Phase's lock in the middle of the Action Phase (F1).
      const lockPh = droneLockPhase(state);
      const phased = t.kind === 'drone' && lockPh
        ? droneActionWhy(lockPh, a, { autoActions: riderOnDrone(data, state.tokens, t).autoActions })
        : null;
      // A Part that can initiate it (3.4.3): a Common Action with every Part it
      // lists destroyed, or any Part but the Torso in Cruise Mode, was offered
      // here with no gate at all (audit Phase 2, B5).
      const partWhy = t.kind === 'mech' ? actionPartWhy(data, t, a) : null;
      // Shutdown, and for the Crawl Immobilized, as check() refuses them: a
      // Common row was drawn live under the Reboot line (audit Phase 7, P7B 7).
      const commonStop = t.kind === 'mech' && !slot ? commonActionStop(t, a) : null;
      const idle = actionIdleWhy(data, t, a, idleWorld);
      const v: TickVerdict = chained ? { ok: false, why: chained } : stopped ? { ok: false, why: stopped }
        : commonStop ? { ok: false, why: commonStop }
        : partWhy ? { ok: false, why: partWhy } : idle ? { ok: false, why: idle } : phased ? { ok: false, why: phased } : ticks;
      return { a, key, slot, cardId, priced, len, cost: costOf(priced), v, rws: rwsOnly, lender: lentBy.get(key), ammoLeft: ammoOf.get(key), charge, projectiles };
    });
}

// Whether the unit holding this Opportunity may Maneuver (a Mech) or move (a
// Drone).
export function maneuverVerdict(state: GameState, t: Token, o: Opportunity): TickVerdict {
  const rwsOnly = t.kind === 'mech' && PHASES[state.round.phase] === 'Command';
  // A Drone's move is barred by the same one-thing-per-activation rule as its
  // Actions, so it needs that reason rather than the Mech one about Tick order.
  // And Movement is the COMMAND Phase's choice (3.2.2 ②): in the Automatic
  // Phase a Drone performs its Automatic Actions only (3.5), so the row locks.
  const dronePh = PHASES[state.round.phase];
  const droneMoveBlock = t.kind === 'drone' && isLoopPhase(dronePh) ? droneMoveWhy(dronePh) : null;
  // 4.1.1: a Mech in Shutdown Stance cannot Maneuver or perform any Action
  // other than Reboot. The engine refuses it too; this is the row's reason.
  const man0 = t.kind === 'mech'
    ? (t.stance === 'shutdown'
      ? { ok: false as const, why: 'A Mech in Shutdown Stance cannot Maneuver or act until it Reboots (4.1.1).' }
      : rwsOnly
        ? { ok: false as const, why: 'A Mech commanded through RWS fires that Part and does not move (遥控武器); it Maneuvers in its own Action Opportunity.' }
        : canManeuver(o))
    : droneMoveBlock ? { ok: false as const, why: droneMoveBlock } : canActivate(o);
  // Immobilized: no Maneuver, not even a turn (6.3.2). The row was live and
  // the planner refused it after the press (audit Phase 7, P7B 7).
  const pinned = man0.ok ? immobilizedStop(t, null) : null;
  return pinned ? { ok: false as const, why: pinned } : man0;
}

// ---------- launching a Projectile (rulebook 4.7) ----------
//
// The unit card picks the Action and the Projectile; all that is left is where
// it lands. Only legal Landing Points are offered (landingGrids, below), and
// Volley X may place several off one Action.

// How many Projectiles one performance of the Action may put down.
export function launchShots(data: GameData, state: GameState, t: Token, a: CardAction, actionId: string): number {
  // Volley X caps the shots per Action and each one spends an Ammo Token, so
  // the real cap is whichever runs out first. Off ammoHolder, not off `t`: a
  // launcher lent by a Carrier Tarantula keeps its magazine on the Drone (FAQ
  // O3/O16), and reading the Mech found undefined and offered the full Volley.
  // And ammoAvailable, not one magazine: an empty Pod still fires out of an
  // Ammunition Pack carrying 086_B (audit Phase 2, C6).
  const ammo = ammoAvailable(data, state, t, actionId);
  // volleyFor: Opal's Projectile Actions at Projectile Timing count as
  // Volley 2 (UN parts list 1.04), which the printed Volley cannot say.
  const o = state.script?.opp;
  const volley = volleyFor(data, t, a, o?.uid === t.uid ? o : null);
  return Math.min(volley, ammo === undefined ? volley : ammo);
}

// What is left of a Volley already under way: the engine counts the launches
// of this Opportunity (commands.ts `launch`; audit Phase 2, C12), whatever has
// become of each Unit since (one that detonated as it landed was launched all
// the same; a take-back strikes its launch off the record), and this counts
// the same ones, so a reader with no plan of its own knows whether another
// may follow.
export function launchLeft(data: GameData, state: GameState, t: Token, a: CardAction, actionId: string): number {
  const o = state.script?.opp;
  const mine = o?.uid === t.uid ? o : null;
  const live = (mine?.launched ?? []).filter((x) => x.actionId === actionId).length;
  const cap = volleyFor(data, t, a, mine) - live;
  const ammo = ammoAvailable(data, state, t, actionId);
  return Math.max(0, Math.min(cap, ammo === undefined ? cap : ammo));
}

// One Projectile on one Landing Point: where it stands in that Grid, and the
// command that launches it there. `label` is what the refusal calls it.
export function launchShot(
  data: GameData, state: GameState, t: Token, actionId: string, card: Card, grid: LargeGrid, label: string, facing?: Facing,
): { ok: true; cmd: Extract<Command, { kind: 'launch' }> } | { ok: false; why: string } {
  const { c, r } = grid;
  // Sized off the card rather than a probe token: minting one here would burn a
  // uid the launch command then cannot reproduce on the other seat. A 1x3 line
  // stands across the facing picked in the panel.
  const line = isLineUnit({ cardId: card.id });
  const face = line ? (facing ?? t.facing) : t.facing;
  const spot = line
    ? lineSpot(c, r, face, terrainOf(data, state), state.tokens)
    // A Mine keeps clear of terrain and may share its Grid with a unit (1.3).
    : isMine(card)
      ? mineSpot(c, r, terrainOf(data, state), { col: t.col, row: t.row })
      : standingSpot(c, r, unitSize(card), isAerial(card), terrainOf(data, state), state.tokens, undefined, { col: t.col, row: t.row });
  if (!spot) {
    return { ok: false, why: line
      ? `${label} is a 1x3 line: facing ${['North', 'East', 'South', 'West'][face]} it needs a clear ${face % 2 ? 'column' : 'row'} of that Grid, and none is. Pick another Grid or another facing.`
      : `There is no room in that Grid for ${label}. 4.7.2 needs the Projectile's base entirely inside the Landing Point.` };
  }
  return { ok: true, cmd: {
    kind: 'launch', seat: t.side, uid: t.uid,
    actionId, cardId: card.id,
    to: { col: spot.col, row: spot.row }, facing: face,
  } };
}

// Only a LAUNCHED projectile triggers Interception (FAQ M20): a Deploy or a
// Lay triggers nothing.
export function launchTriggersInterception(data: GameData, owner: Token, actionId: string): boolean {
  const act = tokenCards(data, owner).flatMap(({ card }) => card.actions ?? []).find((a) => a.id === actionId);
  return !act || projectileDelivery(act) === 'launch';
}

// The Interception a finished launch owes (4.9): every enemy Part carrying
// Intercept in Range of where it was launched from or of where it landed.
export function interceptsAfterLaunch(data: GameData, state: GameState, launcher: Token, born: Token[]): { uid: number; actionId: string; targetUid: number }[] {
  // Every Unit this Launch placed, whatever its flag: "Regardless of whether
  // the Projectile is an Aerial Unit, during Launching the Projectile is
  // considered an Aerial Unit at the Grid it was Launched from and at the
  // Landing Point" (4.7.2), and a Drone a Projectile Action places is Launched
  // the same way. Keeping only the Aerial ones dropped every Beacon once Phase
  // 4 made them ground units (audit Phase 5, B1). The caller asks only for a
  // Launch: a Deploy or a Lay triggers nothing.
  const fresh = born.filter((p) => p.parentUid === launcher.uid);
  if (!fresh.length || !state.script) return [];
  return interceptsOwed(data, state.tokens, state.smoke ?? [], launcher, fresh);
}

// ---------- Detonation (rulebook 4.7.5 / 4.7.6) ----------

export function unitsWithin(state: GameState, from: Token, range: number): { t: Token; dist: number }[] {
  const gc = Math.floor(from.col / 3);
  const gr = Math.floor(from.row / 3);
  return state.tokens
    .filter((x) => x.uid !== from.uid && x.deployed !== false)
    .map((t) => ({ t, dist: Math.abs(Math.floor(t.col / 3) - gc) + Math.abs(Math.floor(t.row / 3) - gr) }))
    .filter((x) => x.dist <= range)
    .sort((a, b) => a.dist - b.dist);
}

// Destructible Terrain is always a legal target for a Projectile in range
// unless the card says otherwise (4.7.5), and only the 1-inch Containers are
// destructible: Buildings and both Defense walls are not (p.21).
export function fragileTerrainWithin(data: GameData, state: GameState, from: Token, range: number): { piece: TerrainPiece; dist: number }[] {
  const gc = Math.floor(from.col / 3);
  const gr = Math.floor(from.row / 3);
  return terrainOf(data, state)
    .filter((p) => p.isFragile)
    .map((piece) => {
      const cells = piece.subCells.map((c) => ({ c: Math.floor(c.col / 3), r: Math.floor(c.row / 3) }));
      return { piece, dist: Math.min(...cells.map((c) => Math.abs(c.c - gc) + Math.abs(c.r - gr))) };
    })
    .filter((x) => x.dist <= range)
    .sort((a, b) => a.dist - b.dist);
}

// What a Projectile's Delayed Action may take, from where it stands.
export interface DetonationReading {
  proj: Token;
  a: CardAction | undefined;
  range: number;
  // Every unit in Range, nearest first, and every Container.
  targets: { t: Token; dist: number }[];
  terrain: { piece: TerrainPiece; dist: number }[];
  // A pool makes it an Explosion attack; none makes it an effect.
  damaging: boolean;
  scope: 'single' | 'all';
  // Why the card does not let it take this unit, or ''.
  barOf: (t: Token) => string;
  legal: { t: Token; dist: number }[];
  // With nothing to take it is not removed: it stays for a later Delay Phase.
  stays: boolean;
}

// `terrainHit`: it has already taken a Container, so it is spent.
export function detonationReading(data: GameData, state: GameState, uid: number, actionId: string, soFar: { terrainHit?: boolean } = {}): DetonationReading | null {
  const s = state;
  const proj = s.tokens.find((x) => x.uid === uid);
  if (!proj) return null;
  const a = actionOf(data, s, proj, actionId);
  const range = a?.range ?? 0;
  const targets = unitsWithin(s, proj, range);
  const terrain = fragileTerrainWithin(data, s, proj, range);
  const damaging = !!(a && ((a.yellowDice ?? 0) || (a.redDice ?? 0)));
  // The translation fallback, the same one freeplay passes. explosionScope
  // reads the printed English first and drops to the CHINESE when there is
  // none; 63 damaging actions have no English in cards.json, and for those this
  // page was reading the zh while freeplay read the English translation. They
  // agree on every card today, which is precisely why the day they stop would
  // have been a scope that differed between the two boards and nothing to say so.
  const scope = a ? explosionScope(a, data.actionTranslation(a.id)?.english ?? undefined) : 'single';
  // What the card lets it take (4.7.5; A5), and whether it stays with nothing
  // to take (the PK3; A6). A Container is a Neutral Unit (Supplementary Rules
  // 1.04, 1.1.3), which a single-target Explosion MAY take and so may leave
  // alone (1.4.2): it no longer stops the PK3 staying. An "all Units" one MUST
  // take it, and Done destroys any left (3.1).
  const pool = targets.map((x) => x.t);
  const barOf = (t: Token): string => (a && damaging ? detonationBar(s.tokens, proj, a, pool, t) : '');
  const legal = targets.filter(({ t }) => !barOf(t));
  const stays = damaging && !!a && !legal.length && !soFar.terrainHit && keptWithoutTarget(a);
  return { proj, a, range, targets, terrain, damaging, scope, barOf, legal, stays };
}

// A Missile flies into its target's Grid first, and the flight owes
// Interception at either end (A2): the command that flies it, and what the
// flight owes, read before it flies. Null for a Projectile that does not fly.
export function detonationFlight(data: GameData, state: GameState, proj: Token, a: CardAction, target: Token): { fly: Command; owed: { uid: number; actionId: string; targetUid: number }[] } | null {
  if (!fliesToTarget(a)) return null;
  const flight = missileFlight(data, state.tokens, state.smoke ?? [], proj, target);
  return { fly: { kind: 'flyToTarget', seat: proj.side, uid: proj.uid, actionId: a.id, targetUid: target.uid }, owed: flight.owed };
}

// An Unfolded Pholcus jumps into its target's Grid and blows up there (167;
// FAQ I19). A Ground Unit's landing: nothing Intercepts it. Null for a
// Projectile that does not jump, or has. And null for the blast it owes as it
// Unfolds in an occupied Grid (M18.4): it is already in that Grid, among the
// units its blast may take, an ally as well as an enemy (rulings I18, I19).
// The jump the pages sent there was refused at an ally ("jumps only at an
// Enemy Unit"), and the Match Centre's Detonation stopped on the refusal.
export function detonationJump(proj: Token, a: CardAction, target: Token): Command | null {
  if (!jumpsToTarget(a) || proj.jumpBlast || proj.unfoldBlast) return null;
  return { kind: 'flyToTarget', seat: proj.side, uid: proj.uid, actionId: a.id, targetUid: target.uid };
}

// ---------- Smoke Screens (rulebook 4.16) ----------
//
// Where a Screen may go and which a round's end takes away. The Match Centre
// asks for them one press at a time (matchhud.ts smokeCandidates, a panel of
// its own); a seat with no panel is offered whole answers, read here.

// A Grid a squad may put a Screen in: on the board, and not one it already has
// a Screen in (one a squad a Grid; the other squad's Screen is no bar).
function smokeFree(state: GameState, side: Side): (g: LargeGrid) => boolean {
  const own = new Set((state.smoke ?? []).filter((x) => x.side === side).map((x) => `${x.col},${x.row}`));
  const n = gridsOf(state);
  return (g) => g.c >= 0 && g.r >= 0 && g.c < n && g.r < n && !own.has(`${g.c},${g.r}`);
}

// THE SHAPES A SMOKE CARD'S SCREENS MAY TAKE: "place up to N Smoke Screens that
// are Connected, starting at the landing point" (268). Every set of one to N
// Grids that begins with the origin, each Grid after it in Contact with one
// already placed (edge to edge, 4.2.3), in an order they could be put down in.
// On open ground a card of three has 23: the Landing Point alone, with each of
// the four Grids beside it, and the eighteen threes. None where the squad
// already has a Screen in the origin's Grid: the first cannot be placed. A card
// that does not ask for them Connected is offered its first Screen alone.
export function smokeShapes(state: GameState, side: Side, origin: LargeGrid, count: number, connected: boolean): LargeGrid[][] {
  const free = smokeFree(state, side);
  if (count < 1 || !free(origin)) return [];
  const out: LargeGrid[][] = [];
  const seen = new Set<string>();
  const grow = (shape: LargeGrid[]): void => {
    const id = shape.map((g) => `${g.c},${g.r}`).sort().join(';');
    if (seen.has(id)) return;
    seen.add(id);
    out.push(shape);
    if (!connected || shape.length >= count) return;
    for (const g of shape) {
      for (const [dc, dr] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
        const next = { c: g.c + dc, r: g.r + dr };
        if (free(next) && !shape.some((x) => x.c === next.c && x.r === next.r)) grow([...shape, next]);
      }
    }
  };
  grow([{ c: origin.c, r: origin.r }]);
  // The fewest Screens first: the Landing Point alone, then the pairs.
  return out.sort((a, b) => a.length - b.length);
}

// The Grids a reaction may put a Screen in: "may place N Smoke Screens within
// Range" of the unit (546_B), its own Grid first and then the nearest.
export function smokeSpots(state: GameState, side: Side, at: LargeGrid, range: number): LargeGrid[] {
  const free = smokeFree(state, side);
  const out: LargeGrid[] = [];
  for (let dc = -range; dc <= range; dc++) {
    for (let dr = -range; dr <= range; dr++) {
      const g = { c: at.c + dc, r: at.r + dr };
      if (Math.abs(dc) + Math.abs(dr) <= range && free(g)) out.push(g);
    }
  }
  const far = (g: LargeGrid): number => Math.abs(g.c - at.c) + Math.abs(g.r - at.r);
  return out.sort((a, b) => far(a) - far(b));
}

// The Screens of the group that owes the next removal of this End Phase that
// are still standing: a group may owe more than one (three, under Season 1.04),
// and a Screen already taken is not offered again. The queue is the page's
// (matchhud.ts glueAfter snapshots it as the Smoke dissipates).
export function smokeOwedCells(state: GameState): { col: number; row: number }[] {
  const next = state.script?.smokeOwed?.[0];
  if (!next) return [];
  const up = new Set((state.smoke ?? []).filter((x) => x.side === next.side).map((x) => `${x.col},${x.row}`));
  return next.cells.filter((c) => up.has(`${c.col},${c.row}`));
}

// ---------- Black Boxes (rulebook 5.3.1) ----------
//
// The one Task item that moves: a unit whose Movement passes a loose Box may
// pick it up onto a Freehand Part, and a bearer that is Penetrated drops it
// where the ATTACKER says. The Match Centre's panels worked these out between
// their buttons; a seat with no panel reads them here.

// The loose Boxes in the Grids a Movement entered: every Grid of a walked
// route, and of a flight only the Grid it leaves and the one it lands in
// (4.3.2; ruling I22; audit Phase 6, F10). A unit standing still names the one
// Grid it stands in.
export function boxesOn(state: GameState, path: LargeGrid[], flight = false): TaskItem[] {
  const grids = flight && path.length > 1 ? [path[0], path[path.length - 1]] : path;
  return normaliseTasks(state.tasks).items.filter((i) => i.kind === 'blackbox' && i.bearerUid === undefined
    && i.col !== undefined && i.row !== undefined
    && grids.some((g) => g.c === Math.floor(i.col! / 3) && g.r === Math.floor(i.row! / 3)));
}

// The Parts of a unit that could take a Box now: a Part already bearing one
// has its Freehand treated as invalid (5.3.1), and a Carrier carries one on a
// Freehand Load (FAQ P11; ruling I19).
export function boxHandsFree(data: GameData, state: GameState, t: Token): { slot: PartSlot | 'pilot' | 'main'; label: string }[] {
  return freehandSlots(data, t, boxHands(state.tasks, t.uid), [], true);
}

// What picking up the Boxes a Movement passed sends: one for each, on the next
// free Freehand Part, for as many as the unit has hands. Nothing for a
// Projectile, which never picks one up.
export function boxTakes(data: GameData, state: GameState, t: Token, path: LargeGrid[], flight = false): Command[] {
  if (t.kind === 'projectile') return [];
  const loose = boxesOn(state, path, flight);
  if (!loose.length) return [];
  const hands = boxHandsFree(data, state, t);
  return loose.slice(0, hands.length).map((box, i) => ({ kind: 'takeBlackBox', seat: t.side, uid: t.uid, itemId: box.id, slot: String(hands[i].slot) }));
}

// The Boxes a unit bears that a Penetration has knocked loose: each is owed a
// drop by the attacker (the engine stamps the bearer's base on it as the
// Penetration lands, commands.ts).
export function boxesKnocked(state: GameState, bearerUid: number): TaskItem[] {
  return normaliseTasks(state.tasks).items.filter((i) => i.kind === 'blackbox' && i.bearerUid === bearerUid && !!i.dropFrom);
}

// Where the attacker may put down a Box its Penetration knocked loose: the
// Small Grids in Contact with the bearer's base, edge to edge and not on
// terrain (rules.ts boxDropCells), judged at the base the Penetration found
// when the same attack has taken the bearer off the board. Empty for a Box
// nobody bears, and for one no Penetration owes.
export function boxDropSpots(data: GameData, state: GameState, itemId: string): { col: number; row: number }[] {
  const box = normaliseTasks(state.tasks).items.find((i) => i.id === itemId);
  if (!box || box.kind !== 'blackbox' || box.bearerUid === undefined || !box.dropFrom) return [];
  const bearer = state.tokens.find((x) => x.uid === box.bearerUid);
  const base = bearer ? { col: bearer.col, row: bearer.row, size: bearer.size } : box.dropFrom;
  return boxDropCells(base, terrainOf(data, state), gridsOf(state) * 3);
}

// ---------- paying for an Action ----------

// The command that records an Action as performed, or the reason it may not
// be. A Mech's Action is bought with Ticks and a Drone's with its whole
// activation, but both are recorded by the same command — without it nothing
// marked the activation spent and a Drone could move and then shoot. Only a
// Mech's length-less Passive sends nothing (`cmd` null).
//
// `key` is the row's own: the Part the Action is taken from.
export function actionPayment(data: GameData, state: GameState, t: Token, a: CardAction, key: string): { ok: true; cmd: Command | null } | { ok: false; why: string } {
  if (!(t.kind !== 'mech' || lengthOf(a))) return { ok: true, cmd: null };
  // The Charge and the Discard are paid under the Part they name, which a
  // guided game requires (ruled R2), so legality is read under the first
  // Part the engine takes; the pick then names the real one. A Punch/Kick
  // or a Crawl is paid under that first Part itself: which of them makes
  // it changes nothing else, and a second one by another Part is its own
  // Action (ruled R3; audit Phase 7, P7B 9).
  const named = commonPartSlots(data, t, a).map((s) => `${a.id}@${s}`);
  const probe = (k: string): CheckResult => check(data, state, { kind: 'performAction', seat: t.side, uid: t.uid, actionId: actionIdOf(k), partKey: k });
  const first = named.find((k) => probe(k).ok);
  const v = named.length ? probe(first ?? named[0]) : probe(key);
  if (!v.ok) return { ok: false, why: v.why };
  const own = a.id === 'COMMON_PUNCH_MELEE' || a.id === 'COMMON_CRAWL';
  return { ok: true, cmd: { kind: 'performAction', seat: t.side, uid: t.uid, actionId: actionIdOf(key), partKey: own && first ? first : key } };
}

// Charging is the whole Action, and its own command turns the token face-up
// (ruled R2; audit Phase 7, P7A 7). The shared Charge Action is keyed to the
// Part charged (FAQ H6/H7; audit Phase 2, E7); a Drone's own Charge (543_B)
// Charges its hull and is paid as it stands.
export function chargePayment<T extends Extract<Command, { kind: 'performAction' }>>(pay: T, slot: string): T {
  return pay.actionId === 'COMMON_CHARGE' ? { ...pay, partKey: `COMMON_CHARGE@${slot}` } : pay;
}

// Stabilize System's one answer (6.1; FAQ J4, J8) as its command: one Square
// or Hexagon Token off, face included, or every Token kept and the Link alone.
export function stabiliseCommand(t: Token, pick: TokenPick | null): Command {
  return pick
    ? { kind: 'stabilise', seat: t.side, uid: t.uid, statusId: pick.statusId, ...(pick.face ? { face: pick.face } : {}) }
    : { kind: 'stabilise', seat: t.side, uid: t.uid, keepTokens: true };
}

// Whether any unit of the other squad holds an Intercept Token. With none on
// the table no Interception can be owed, whatever moves or is launched (every
// attempt spends one: units.ts interceptsOwed), so a reader about to work one
// out for many candidates may ask this first.
export function interceptorsAgainst(state: GameState, side: Side): boolean {
  return state.tokens.some((x) => x.side !== side && x.deployed !== false && Object.values(x.intercept ?? {}).some((n) => (n ?? 0) > 0));
}

// ---------- an Interception owed (rulebook 4.9) ----------
//
// A Launch, a Missile's flight or an Aerial unit's Movement owes the other
// squad's interceptors their attempts, and they are made at once, before play
// goes on. The Match Centre's panel worked these out between its buttons; a
// seat with no panel answers the same debt, so they are read here.

export interface InterceptAttempt {
  uid: number;
  actionId: string;
  targetUid: number;
}

// Whose attempts come first: the squad of the unit that owes the first one
// that can still be made (commands.ts liveIntercepts). Null with none owed.
export function interceptSide(state: GameState): Side | null {
  const first = liveIntercepts(state)[0];
  return state.tokens.find((t) => t.uid === first?.uid)?.side ?? null;
}

// What taking an owed attempt sends before its attack opens: the Token, then
// the debt settled. Spending a Part's last Token strikes its owed attempts off
// in the same command, this one with them (B2), so the debt is settled on its
// own only while a Token is left behind the one spent. Null for an attempt
// whose unit is gone.
export function interceptPayment(data: GameData, state: GameState, item: InterceptAttempt): Command[] | null {
  const by = state.tokens.find((x) => x.uid === item.uid);
  if (!by) return null;
  const spend: Command = { kind: 'spendIntercept', seat: by.side, uid: by.uid, actionId: item.actionId };
  const still = interceptOwedAt(state, item.uid, item.actionId, item.targetUid)
    && interceptHeld(data, state.tokens, by, item.actionId, !!state.noBoard) > 1;
  return still ? [spend, { kind: 'resolveIntercept', seat: by.side, uid: item.uid, actionId: item.actionId, targetUid: item.targetUid }] : [spend];
}

// What an attempt that has been resolved leaves owed. A target that survived
// obliges the SAME Part to try again until its Tokens run out or the target
// dies (4.9), so the attempt goes back on the owed list rather than being left
// to the players to remember. `why` says which of the four it was: the target
// `destroyed`, the interceptor `gone` (the obligation died with it), its
// Tokens `spent`, or the attempt owed `again`; `left` is the Tokens still on
// that Part.
export function interceptAgain(
  data: GameData, state: GameState, f: InterceptAttempt,
): { why: 'destroyed' | 'gone' | 'spent' | 'again'; left: number; command: Command | null } {
  const by = state.tokens.find((x) => x.uid === f.uid);
  const at = state.tokens.find((x) => x.uid === f.targetUid);
  const left = by ? interceptHeld(data, state.tokens, by, f.actionId) : 0;
  if (!at) return { why: 'destroyed', left, command: null };
  if (!by || !alive(by)) return { why: 'gone', left, command: null };
  if (left <= 0) return { why: 'spent', left, command: null };
  return { why: 'again', left, command: { kind: 'queueIntercepts', seat: by.side, items: [{ uid: f.uid, actionId: f.actionId, targetUid: f.targetUid }] } };
}

// What an AERIAL unit's Movement to `to` would owe (FAQ O11/O15: judged at the
// Grid it leaves and at the one it lands in), read BEFORE it moves, for a
// reader that sends the debt with the move. It is the reading
// interceptsAfterMove makes once the move has landed.
export function interceptsForMove(data: GameData, state: GameState, t: Token, to: { col: number; row: number }): InterceptAttempt[] {
  if (!t.aerial) return [];
  const moved = { ...t, col: to.col, row: to.row };
  return interceptsOwed(data, state.tokens.map((x) => (x.uid === t.uid ? moved : x)), state.smoke ?? [], { ...t }, [moved]);
}

// ---------- what performing an Action opens ----------

// The procedure an Action runs once it is chosen: a target list, a route, a
// Landing Point, a pick of Parts, or nothing but its card text.
export type ActionRoute =
  | 'terminal' | 'discard' | 'stabilise' | 'overwatch' | 'charge' | 'resupply' | 'link' | 'stanceFeedback'
  | 'cleanup' | 'repair' | 'form' | 'camo' | 'electronic' | 'attack' | 'blink' | 'move' | 'launch'
  | 'transform' | 'unfold' | 'detonate' | 'selfStatus' | 'targetStatus' | 'card';

// ONE classification, in the order the Match Centre has always asked: the
// order is part of the rule, because several Actions answer to more than one
// reading and the first one wins.
export function actionRoute(data: GameData, t: Token, a: CardAction): ActionRoute {
  // First, as it is in performGuided. Remote Access is typed like card text but
  // resolves against the board.
  if (a.id === 'COMMON_REMOTE_ACCESS') return 'terminal';
  // 6.1: Discard is performed by one Handheld Part, so it asks which one
  // before it pays (audit Phase 7, P7A 2).
  if (a.id === 'COMMON_DISCARD') return 'discard';
  // Stabilize System asks before it pays.
  if (a.id === 'COMMON_STABILIZE') return 'stabilise';
  // The KK9's Overwatch Strike (audit Phase 5, F8).
  if (overwatchOf(a)) return 'overwatch';
  if (isChargeAction(a)) return 'charge';
  if (resupplyOf(a)) return 'resupply';
  // Ahead of the Delay Phase's Detonation branch below: a Link Beacon restores
  // Link and stays on the board (4.7.5), it never Detonates.
  if (linkSupportOf(a)) return 'link';
  // ZHDR-206_B Stance feedback (audit Phase 2, D1).
  if (stanceFeedbackOf(a)) return 'stanceFeedback';
  if (tokenCleanupOf(a)) return 'cleanup';
  if (repairSpec(a)) return 'repair';
  // The Bit's Stance Change: pick a form, then take the Movement it grants.
  if (formSwitch(a)) return 'form';
  // "Activate Optical Camouflage, Stealth X".
  if (activatesCamo(a)) return 'camo';
  // An Electronic Attack opens the Counter-roll targeting whatever its printed
  // TYPE says — the Raven's Fire Control Interference is typed Tactic, and
  // keying on the type let it fall through to "follow the card text" (4.11).
  // A Scan opens the same Counter-roll window through its own door, for the
  // reason units.ts isScanAction spells out: it is not an Electronic Attack and
  // must not be caught by anything that modifies one.
  if (isElectronicAttack(a) || isScanAction(a)) return 'electronic';
  if (a.type === 'Firing' || a.type === 'Melee') return 'attack';
  // Prototype Blink is typed Moving but teleports (FAQ E20.2), so it must not
  // reach the route planner — there is no route to draw.
  if (isPositionSwap(a)) return 'blink';
  if (a.type === 'Moving') return 'move';
  if (a.type === 'Projectile') return 'launch';
  // A Mode change (287/288 White Dwarf): the Action turns its own Part over to
  // the other face of the same physical card.
  if (transformOffer(data, t, a)) return 'transform';
  // Pholcus does not resolve a payload: it becomes a Drone in place (FAQ M18).
  if (unfoldsOwed(data, [t]).some((x) => x.actionId === a.id)) return 'unfold';
  // A Projectile resolving its payload in the Delay Phase opens the Detonation
  // resolver (3.6.2).
  if (t.kind === 'projectile' && a.type !== 'Passive') return 'detonate';
  // A self-applied Token (Ambush: Low Profile; Amplify Profile: Highlight).
  if (selfStatusGrant(a)) return 'selfStatus';
  // A Token the Action puts on a chosen target: Target Tag's Highlight
  // (PRDR-202_A).
  if (targetStatusGrant(a)) return 'targetStatus';
  // Swift and Tactical Actions are card text rather than a board procedure.
  return 'card';
}

// ---------- the targets of an Electronic Attack (rulebook 4.11) ----------
//
// Range is the only reach test — Electronic Warfare ignores Terrain and line
// of sight outright (4.11.1) — so the target list says nothing about arcs.

// Range is counted in Large Grids, the same way the guide counts it.
export function gridsApart(a: Token, b: Token): number {
  return Math.abs(Math.floor(a.col / 3) - Math.floor(b.col / 3))
    + Math.abs(Math.floor(a.row / 3) - Math.floor(b.row / 3));
}

export interface ElectronicRow {
  t: Token;
  // Range in Large Grids: the best of the attacker's own and every Repeater
  // covering it, and the Repeater it was measured from when that is nearer.
  d: number;
  via?: Token;
  // The Electronic Value the target would roll.
  theirs: number;
  // Beyond the Action's Range.
  far: boolean;
  // In Range, but an Automatic Action targets the NEAREST enemy (3.5.2).
  skipped: boolean;
  // Why it may not be picked, or ''.
  why: string;
}

export interface ElectronicReading {
  by: Token;
  a: CardAction;
  // The EFFECTIVE reach, and the pool that will be ROLLED beside the printed one.
  reach: number;
  ev: number;
  evPrinted: number;
  scan: boolean;
  // An Action on every enemy in Range picks nobody: its Responders, in the
  // order they are rolled against. Null for an Action that picks one enemy.
  all: Token[] | null;
  // The Repeaters lending this shot their position (FAQ O19).
  relay: Token[];
  rows: ElectronicRow[];
}

// Who an Electronic Attack or a Scan may be opened against, or null when the
// unit or its Action is gone.
export function electronicReading(data: GameData, state: GameState, uid: number, actionId: string): ElectronicReading | null {
  const s = state;
  const by = s.tokens.find((x) => x.uid === uid);
  const a = by ? actionOf(data, s, by, actionId) : undefined;
  if (!by || !a) return null;
  // The EFFECTIVE reach: FPA-06 Amplify adds a Grid to an Electronic Attack,
  // and the command judges the same number.
  const reach = actionRange(data, s.tokens, by, a);
  // The unit PERFORMING the Electronic Attack counts the Loads it is borrowing
  // (FAQ O5/O6); the target, rolling passively, counts only its own Parts. Both
  // numbers on this screen are the pool that will be ROLLED, so they carry the
  // EW Suppression aura too (ZHDR-202_B / PDTR-202_B) - showing the printed
  // stat here and a smaller pool one panel later reads as a bug.
  const ev = electronicStrength(data, s.tokens, by, 'initiator', a);
  const evPrinted = electronicValue(data, by, loanedParts(data, s.tokens, by));
  const scan = isScanAction(a);
  // An Action on every enemy in Range (Scream, the Scan Battlefield) picks
  // nobody: one Counter-roll per target, in turn, the engine queueing the rest
  // (audit Phase 3, D2 and A4). The Match Centre offered only the nearest.
  if (electronicAll(a)) {
    return { by, a, reach, ev, evPrinted, scan, all: electronicAllTargets(data, s.tokens, by, a), relay: [], rows: [] };
  }
  // An allied Repeater lends its position to the shot (FAQ O19), so the Range
  // shown is the best of the attacker's own and every Repeater covering it. An
  // Electronic Attack's only: a Scan measures from the scanner (A5, F9).
  const origins = scan ? [by] : electronicOrigins(data, s.tokens, by);
  const relay = origins.slice(1);
  const enemies = s.tokens
    // Electronic Value "-" cannot be a Responder at all (4.11.2), so those are
    // not offered rather than offered and then refused at the command. Nor
    // is a unit the card does not name ("Mech/Drone", "Drone/Projectile"), or
    // one a Scan could change nothing on (audit Phase 3, D5, A1).
    .filter((t) => t.side !== by.side && t.deployed !== false && alive(t) && !electronicDash(data, t)
      && !electronicTargetWhy(a, t) && (!scan || scannable(t)))
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
  const rows = enemies.map(({ t, d, via }) => {
    const theirs = electronicStrength(data, s.tokens, t, 'responder');
    const far = d > reach;
    const skipped = !far && a.speed === 'auto' && d > nearest;
    const why = far
      ? `${t.label} is at Range ${d}, beyond this Action's Range ${reach}.`
      : skipped ? 'An Automatic Action targets the NEAREST enemy in range (3.5.2).' : '';
    return { t, d, via, theirs, far, skipped, why };
  });
  return { by, a, reach, ev, evPrinted, scan, all: null, relay, rows };
}

// The command that opens the Counter-roll on a target picked from that list.
export function electronicOpening(by: Token, actionId: string, targetUid: number): Extract<Command, { kind: 'startCounterRoll' }> {
  return { kind: 'startCounterRoll', seat: by.side, uid: by.uid, actionId, targetUid };
}

// ---------- the targets of an attack (rulebook 4.4) ----------

export interface AttackPick {
  uid: number;
  actionId: string;
  // [Two-Handed] declined (FAQ A16).
  twoHanded?: 'declined';
  // The one legal target when the rules name it: a Riposte answers the Mech it
  // parried and no one else (FAQ C1).
  only?: number;
}

// One enemy an attack could name, and whether the rules allow it.
export interface TargetLine {
  t: Token;
  // The line's reading, " · " between its judgements: ✕ is a refusal, ⚠ a
  // warning.
  note: string;
  // In Optical Camouflage: it may be designated, and is Scanned first.
  hidden: boolean;
  // Another unit has Highlight, and this Firing Action must take that one.
  lit: boolean;
  // The rules do not allow this attack at all.
  blocked: boolean;
  bad: boolean;
}

// The same, with what the shot is worth against it.
export interface TargetRow extends TargetLine {
  prot: ReturnType<typeof protectionFor>;
  shield: ReturnType<typeof automaticShieldFor>;
  ap: ReturnType<typeof armorPiercing>;
}

export interface AttackReading {
  by: Token;
  // As printed, and as it will be rolled.
  raw: CardAction;
  action: CardAction;
  hands: { action: CardAction; use: ReturnType<typeof twoHandedUse> };
  // An Automatic Action's legal targets, or null for any other Action.
  autoLegal: Token[] | null;
  forced: Token[];
  shock: boolean;
  reach: number;
  rows: TargetRow[];
  neutral: ReturnType<typeof autoNeutralTargets>;
  boxes: ReturnType<typeof containerTargets>;
}

// The [Two-Handed] question, answered the same way for the panel and the press
// (FAQ A16): the designation unless the player has declined it, and a marked
// one-handed copy when they have, so the combat window can say so.
export function handsFor(data: GameData, state: GameState, by: Token, granted: CardAction, choice?: 'declined'): { action: CardAction; use: ReturnType<typeof twoHandedUse> } {
  // A Load lent by a Carrier in Contact can be the Freehand (FAQ O16).
  const use = twoHandedUse(data, by, granted, boxHands(state.tasks, by.uid), loanedParts(data, state.tokens, by));
  if (!use) return { action: granted, use: null };
  if (choice === 'declined') return { action: { ...granted, twoHandedDeclined: true }, use };
  return { action: use.action, use };
}

// WHO an attack could name: every enemy on the board, each with the reading of
// its line and whether the rules allow it. This is the part of attackReading
// that says which attacks are legal, without what each shot would be worth
// (Protection, an Automatic Shield, Armor Piercing) and without the Neutral
// targets: all a reader needs that only asks what may be attacked, which the
// seat seam does a few hundred times a turn when a computer seat looks ahead.
// Null when the unit or the Action is gone.
export interface AttackLines extends Omit<AttackReading, 'rows' | 'neutral' | 'boxes'> {
  lines: TargetLine[];
  // The board the lines were read on, for whoever reads the rest off it.
  terrain: ReturnType<typeof terrainOf>;
  smoke: NonNullable<GameState['smoke']>;
}

export function attackLines(data: GameData, state: GameState, pick: AttackPick): AttackLines | null {
  const s = state;
  const by = s.tokens.find((x) => x.uid === pick.uid);
  const raw = by ? actionOf(data, s, by, pick.actionId) : undefined;
  if (!by || !raw) return null;
  // [Stationary] pays out when the attacker has not moved this Opportunity:
  // the Mire's railguns reach 2 grids further, and nobody could see why not.
  const opp0 = s.script?.opp ?? null;
  const steadied = stationaryAdjusted(raw, opp0?.uid === by.uid ? opp0 : null);
  // [condition] 获得X, folded in so a granted keyword reads as a printed one.
  const granted = grantAdjusted(steadied, by, opp0?.uid === by.uid ? opp0 : null);
  // [Two-Handed]: offered, not applied. FAQ A16: the player may decline the
  // designation and perform the Action one-handed; the panel's row says which
  // way this attack is going, and the press reads the same helper.
  const hands = handsFor(data, s, by, granted, pick.twoHanded);
  const a = hands.action;
  const terrain = terrainOf(data, s);
  const smoke = s.smoke ?? [];
  // Every enemy on the board is offered, with the reading of the line beside
  // it: out of arc is a warning the player may still overrule, the same way the
  // guide warns rather than blocks. An Automatic Action is the exception: it
  // takes the nearest legal target, Highlighted first (3.5.2, FAQ O21), and
  // networked play is strict, so only those show.
  const autoLegal = a.speed === 'auto' ? autoTargetsFor(data, s.tokens, by, a, { terrain, smoke }) : null;
  // THE EFFECTIVE REACH, not the printed one. actionRange folds in an ally's
  // firing-range aura, and passing the raw card number here would refuse a shot
  // the aura legitimately extends. Electronic Attacks never reach this picker
  // (they take ewPick at the ⌖ press), so the Repeater origins autoTargetsFor
  // has to consider do not arise on this path.
  const reach = actionRange(data, s.tokens, by, a);
  // PDRH-202_B Link Shock: only a unit this one Tethers, at any distance and
  // with no line of sight needed. The board is still read for the rest: the
  // Forward Arc and the no-Aerial Melee rule stay (ruled 2026-09-25, audit
  // Phase 4, I14), which this row used to skip by not asking at all.
  const shock = linkShockOf(a);
  // One line's reading, worked out once: Highlight asks it of every enemy and
  // the rows ask it again. STRICT, so the Range reading comes back as ✕ rather
  // than ⚠ and the row disables itself on it. OTTO shot a Mech ten Grids away
  // with a Range 6 weapon and the game let him roll: range was a warning nobody
  // was stopped by, on the one page that is supposed to stop them.
  const notes = new Map<number, string>();
  const noteOf = (t: Token): string => {
    let note = notes.get(t.uid);
    if (note === undefined) notes.set(t.uid, note = losNote(by, t, { ...a, range: reach, anyDistance: shock }, terrain, s.tokens, smoke, true));
    return note;
  };
  // HIGHLIGHT (6.2.1): a Firing Action "able to target an Enemy Unit that has
  // Highlight ... must target that Unit" (FAQ J18: Firing only; F15). Only the
  // Drones' Automatic Actions were bound, so Amplify Profile and Target Tag did
  // nothing against a Mech's fire (audit Phase 3, E1). Networked play is
  // strict, so every other row disables while one of those can be taken.
  // Who is Highlighted is asked first and the line second: a line is a walk
  // of the board, and on most boards nobody is Highlighted, so an asker that
  // wants one target's line (`pick.only`) does not pay for every enemy's.
  const forced = a.type === 'Firing' && !shock
    ? highlightTargets(data, s.tokens, a, s.tokens.filter((t) => t.side !== by.side && t.deployed !== false && alive(t)
      && statusCount(t.statuses, 'camouflage') === 0), by).filter((t) => !noteOf(t).includes('✕'))
    : [];
  const lines = s.tokens
    .filter((t) => t.side !== by.side && t.deployed !== false && alive(t))
    .filter((t) => !autoLegal || !autoLegal.length || autoLegal.some((x) => x.uid === t.uid))
    .filter((t) => pick.only === undefined || t.uid === pick.only)
    .filter((t) => !shock || tetheredBy(by, t))
    .map((t): TargetLine => {
      const note = noteOf(t);
      // ⚠ is a warning the player may overrule; ✕ is an attack the rules do not
      // allow at all, and both Range (4.4.1) and blocked line of sight are that.
      // Freeplay warns for both because a table can house-rule; networked play
      // is strict, so the row cannot be pressed.
      // 4.12.2 (FAQ I11/I12): a unit in the Optical Camouflage State cannot
      // simply be named - the attacker Scans it first, and only an attack on
      // every unit in range skips the Scan. The free Scan-on-designation is
      // not automated yet, so the row says what to do instead of letting the
      // shot through.
      const hidden = statusCount(t.statuses, 'camouflage') > 0;
      // Not the Highlighted one, while one can be taken.
      const lit = forced.length > 0 && !forced.some((x) => x.uid === t.uid);
      // A camouflaged unit MAY be designated: its marker is only a suspected
      // position, so range and sight are judged after the Reveal, not now.
      const blocked = (!hidden && note.includes('✕')) || lit;
      const bad = blocked || hidden || note.includes('⚠');
      return { t, note, hidden, lit, blocked, bad };
    });
  return { by, raw, action: a, hands, autoLegal, forced, shock, reach, lines, terrain, smoke };
}

// Every enemy an attack could name, each with the reading of its line and what
// the shot is worth against it, and the Neutral targets it may take. Null when
// the unit or the Action is gone.
export function attackReading(data: GameData, state: GameState, pick: AttackPick): AttackReading | null {
  const read = attackLines(data, state, pick);
  if (!read) return null;
  const s = state;
  const { by, raw, action: a, hands, autoLegal, forced, shock, reach, terrain, smoke } = read;
  const rows = read.lines.map((line): TargetRow => {
    const t = line.t;
    const prot = protectionFor(by, t, a, terrain, s.tokens, smoke,
      ignoresProtection(data, by, t, s.script?.opp),
      (u) => providesUnitProtectionToAllies(data, u));
    // 自动盾牌 Automatic Shield: read-only disclosure, and the row stays
    // pressable. The redirect is mandatory (FAQ A12), so this is not a veto to
    // offer — the attacker's real choice is a DIFFERENT target, and that
    // choice is this list. Rows are only ever greyed on ✕ blocked line of
    // sight, and a unit in the way obstructs without blocking.
    const shield = automaticShieldFor(data, s.tokens, by, t, a);
    // Armor Piercing (6.2.1), on the row rather than only in the combat
    // window: it is the same class of disclosure the Protection bit above is
    // — what this shot is worth against THIS target — and a Spike's grant is
    // the half a player cannot read off the weapon card at all. Constant
    // across the rows of one Action, but so is Protection when the board is
    // open, and splitting the two would be the odd choice.
    const ap = armorPiercing(data, by, a);
    return { ...line, prot, shield, ap };
  });
  // FAQ O9: with no enemy inside an Auto Action's range, the nearest Breakable
  // Terrain becomes a legal target — optional, and only the nearest.
  const neutral = autoLegal && !autoLegal.length
    ? autoNeutralTargets(data, s.tokens, terrain, by, a, smoke)
    : [];
  // A Container is a Neutral Unit (Supplementary Rules 1.04, 1.1.3): a Firing or
  // Melee Action may target one in its reach and sight, and Breakable (3.1)
  // destroys it with no roll (OTTO, 2026-09-30). Not while a Highlighted enemy
  // must be the target (6.2.1), nor for a pick the rules have already named.
  const boxes = !autoLegal && !shock && pick.only === undefined && !forced.length && (a.type === 'Firing' || a.type === 'Melee')
    ? containerTargets(data, s.tokens, terrain, by, a, smoke) : [];
  return { by, raw, action: a, hands, autoLegal, forced, shock, reach, rows, neutral, boxes };
}

// ---------- opening an attack (rulebook 4.4) ----------

// The Action a unit and an id name, as the combat window needs it: the unit's
// own equipped Parts first, then the common Actions every unit has, with
// [Stationary] applied from shared state so the printed Range and pool are the
// ones the condition earned.
export function attackActionBuilt(data: GameData, state: GameState, t: Token | undefined, actionId: string, twoHandedDeclined = false): CardAction | undefined {
  if (!t) return undefined;
  const printed = tokenCards(data, t)
    .flatMap(({ card }) => card.actions ?? [])
    .find((a) => a.id === actionId) ?? data.commonActions.find((a) => a.id === actionId);
  const oppNow = state.script?.opp;
  // The stationary bonus AND the [condition] grants, in that order, so the
  // AttackHelper's ctx.action carries a granted keyword (Stationary Snipe,
  // stance-granted Shock) the same way it carries a printed one.
  const opp = oppNow?.uid === t.uid ? oppNow : null;
  if (!printed) return printed;
  const granted = grantAdjusted(stationaryAdjusted(printed, opp), t, opp);
  // [Two-Handed] LAST, as on every other site (twohanded.test.mjs). The Match
  // Centre used to stop at the grants, so it rolled a Two-Handed weapon
  // without its rider while the turn panel had promised it. FAQ A16: the
  // player may decline, and the declined copy is marked so the window says so.
  // A Load lent by a Carrier in Contact can be the Freehand (FAQ O16).
  const loans = loanedParts(data, state.tokens, t);
  if (twoHandedDeclined) return twoHandedUse(data, t, granted, boxHands(state.tasks, t.uid), loans) ? { ...granted, twoHandedDeclined: true } : granted;
  return twoHandedUse(data, t, granted, boxHands(state.tasks, t.uid), loans)?.action ?? granted;
}

export function attackActionOf(data: GameData, state: GameState, t: Token | undefined, actionId: string, twoHandedDeclined = false, charge?: { spent?: boolean; choice?: string }): CardAction | undefined {
  const built = attackActionBuilt(data, state, t, actionId, twoHandedDeclined);
  // The Charge last, as the attacker's own door applies it (audit Phase 2,
  // C13): the mirror used to leave a consumed Mutilation out of its Surplus.
  return built && charge?.spent ? chargeAdjusted(built, true, charge.choice) : built;
}

export type AttackMode = 'attack' | 'intercept' | 'explosion';

export interface AttackOpening {
  attacker: Token;
  defender: Token;
  action: CardAction;
  // What the window says about the line, and the Protection it starts on.
  note: string;
  protection: ReturnType<typeof protectionFor>;
  // A Multi-Target's limit, when the attack opens on the split.
  multi: ReturnType<typeof multiTargetLimit>;
}

// What the 4.4 pipeline is opened with on a target just picked. The mode
// decides what the defender may claim: an ordinary attack reads Terrain and
// Unit Protection off the board, an Interception grants none and needs no arc
// or sight (4.9), and an Explosion grants none and ignores facing (4.7.6).
// Null when a unit or the Action is gone.
export function attackOpening(
  data: GameData, state: GameState, uid: number, actionId: string, targetUid: number, mode: AttackMode = 'attack',
  opts: { twoHandedDeclined?: boolean; charged?: boolean; chargeChoice?: string } = {},
): AttackOpening | null {
  const attacker = state.tokens.find((t) => t.uid === uid);
  const defender = state.tokens.find((t) => t.uid === targetUid);
  const adjusted = attackActionOf(data, state, attacker, actionId, !!opts.twoHandedDeclined);
  // [Charged] (4.14): folded in only when the Charge Token was consumed for
  // this attack, the same fold the pad and freeplay make.
  const action = adjusted ? chargeAdjusted(adjusted, !!opts.charged, opts.chargeChoice) : adjusted;
  if (!attacker || !defender || !action) return null;
  const terrain = terrainOf(data, state);
  const smoke = state.smoke ?? [];
  // Interception and Explosion both hand the defender no Terrain or Unit
  // Protection, and neither checks arc or line of sight — so the reading of the
  // board that an ordinary attack needs would be wrong guidance for them.
  const note = mode === 'intercept'
    ? 'Interception: no Forward Arc is required, terrain never blocks a line to an Aerial Unit though a Smoke Screen does, and the target claims no Terrain or Unit Protection (4.9, 4.16, FAQ F3).'
    : mode === 'explosion'
      ? 'Explosion damage ignores line of sight and facing, and the defender claims no Terrain or Unit Protection (4.7.6).'
      : losNote(attacker, defender, action, terrain, state.tokens, smoke);
  // Both card-data arguments, both once dropped by the Match Centre: it rolled
  // Protection with no knowledge of 095 Responsive Targetting at all.
  const protection = mode === 'attack'
    ? protectionFor(attacker, defender, action, terrain, state.tokens, smoke,
        ignoresProtection(data, attacker, defender, state.script?.opp),
        (t) => providesUnitProtectionToAllies(data, t))
    : { white: 0, note: '' };
  // Interception and Explosion are single-target by rule.
  const multi = mode === 'attack' ? multiTargetLimit(action) : undefined;
  return { attacker, defender, action, note, protection, multi };
}

// A MULTI-TARGET'S LIMIT WHERE IT HOLDS (FAQ B7). The window opens every
// Multi-Target Action on its split and names a card's condition for the
// player to check. A seat adds a target only where the limit is the
// attacker's: a card that prints it outright; one that gains it under
// [Charged] with the Charge spent on that arm (chargeAdjusted leaves the rule
// only then, and drops its condition); one that gains it under [Two-Handed]
// with a Freehand designated for it, which is exactly when the declined copy
// of the Action is marked as declined. Null where the attack takes one target.
export function multiTargetHeld(
  data: GameData, state: GameState, a: { uid: number; actionId: string; targetUid: number; twoHandedDeclined?: boolean; charged?: boolean; chargeChoice?: string },
): MultiTarget | null {
  const open = attackOpening(data, state, a.uid, a.actionId, a.targetUid, 'attack', a);
  if (!open?.multi) return null;
  const designated = !a.twoHandedDeclined && !!attackActionBuilt(data, state, open.attacker, a.actionId, true)?.twoHandedDeclined;
  const cap = multiTargetLimit(open.action, designated);
  return cap && !cap.condition ? cap : null;
}

// ---------- where a Projectile may land (rulebook 4.7) ----------

// A Landing Point is a Grid within the Action's Range. Direct Fire needs sight
// of it and cannot pick a Grid terrain fills; Fire in arc needs neither.
// Mirrors landingCandidates in main.ts.
//
// `only` leaves Grids out before anything is asked of them: a reader that
// wants the Landing Points near something (a seat looking ahead, which has no
// use for the rest) is spared the sight of every other Grid. The Grids that
// are left are judged exactly as they are with none left out.
export function landingGrids(
  data: GameData, state: GameState, t: Token, a: CardAction, only?: (c: number, r: number) => boolean,
): { c: number; r: number; ok: boolean }[] {
  const sight = needsSightToLanding(a);
  // Mirrors landingCandidates in main.ts, including this line: XPA-62's +2 has
  // to be read here too or the two boards paint different Grids. The
  // launcher's own Opportunity, for its [Stationary] reach (audit Phase 4, E6).
  const o = state.script?.opp ?? null;
  const range = projectileReach(data, t, a, o?.uid === t.uid ? o : null);
  const terrain = terrainOf(data, state);
  const from = { c: Math.floor(t.col / 3), r: Math.floor(t.row / 3) };
  const out: { c: number; r: number; ok: boolean }[] = [];
  for (let c = 0; c < boardGrids(); c++) {
    for (let r = 0; r < boardGrids(); r++) {
      if (Math.abs(c - from.c) + Math.abs(r - from.r) > range) continue;
      if (only && !only(c, r)) continue;
      if (sight) {
        const probe = { ...t, col: c * 3 + 1, row: r * 3 + 1, size: 1 as const };
        // Whether there is a line at all, and nothing more: the walk stops at
        // the first (rules.ts sightBetween).
        if (!sightBetween(t, probe, terrain, state.tokens)) continue;
        // A Grid TERRAIN fills (4.7.1), and only that: a unit standing in a
        // Grid does not make it one. The units were counted here too, and a
        // Mech fills its Grid, so no Direct Fire Projectile could be landed on
        // a Mech at all: not the RA-81 Rocket, whose card takes "1 Enemy Unit
        // within landing point" (found by a computer seat's launch options,
        // 2026-10-03). Whether the Projectile itself fits beside the units in
        // the Grid is asked as it is placed (launchShot; 4.7.3).
        if (!standingSpot(c, r, 1, false, terrain, [], t.uid)) continue;
      }
      out.push({ c, r, ok: true });
    }
  }
  return out;
}

// ---------- Forced Movement (Knockback X, Push X; appendix; 4.3.4) ----------

// The four straight lines a Push may be made along (0 north, 1 east, 2 south,
// 3 west): Push X goes "in any (straight) direction" (GoF 1.021; ruled
// 2026-09-25, audit Phase 4, I9).
export const PUSH_DIRS: readonly { dc: number; dr: number }[] = [{ dc: 0, dr: -1 }, { dc: 1, dr: 0 }, { dc: 0, dr: 1 }, { dc: -1, dr: 0 }];

export interface ForcedMove {
  kb: Knockback;
  path: LargeGrid[];
  heading: string;
  end: LargeGrid;
  short: boolean;
  // What is left of the line where a Mine stopped it: followed once the Mine's
  // blast is resolved (C1b; ruling I16).
  rest: number;
  dir: { dc: number; dr: number };
  resumed: boolean;
}

// WHAT A KNOCKBACK OR A PUSH WOULD DO TO ITS VICTIM, the one reading the Match
// Centre's Forced Movement panel and a computer seat both make (it was the
// panel's own, matchhud.ts shoveOutcome, until a seat needed it, M8.2t). The
// line is straight: the attack direction for a Knockback, and for a Push the
// direction the forcing player chose (`pushDir`; the attack direction unset).
// It stops the moment a Unit, Terrain or the board edge blocks it, ends early
// in an Abyss (the victim falls) or on a Fragile Platform (the floor goes), and
// a Ground unit forced through a mined Grid stops there (C1b): `rest` is the
// rest of the line, and `resume` asks for that rest. A Deployable is not moved
// at all (4.3.4; audit Phase 4, B2). Null for an Action that carries none.
export function forcedMove(
  data: GameData, state: GameState, by: Token, victim: Token, a: CardAction,
  pushDir?: number, resume?: { dir: { dc: number; dr: number }; grids: number },
): ForcedMove | null {
  const printed = knockbackOf(a);
  if (!printed) return null;
  const kb = resume ? { ...printed, grids: resume.grids } : printed;
  const dir = resume?.dir ?? (kb.push && pushDir !== undefined ? PUSH_DIRS[pushDir] : attackDirection(by, victim));
  const line = canBeForceMoved(data, victim)
    ? knockbackPath(victim, dir, kb.grids, terrainOf(data, state), state.tokens, envForcedStop(data, state, victim))
    : [];
  const stop = mineStopIndex(data, state.tokens, victim, [largeGridOf(victim), ...line], false);
  const path = stop > 0 ? line.slice(0, stop) : line;
  const rest = stop > 0 ? kb.grids - stop : 0;
  const heading = ['north', 'east', 'south', 'west'][dir.dr < 0 ? 0 : dir.dc > 0 ? 1 : dir.dr > 0 ? 2 : 3];
  const end = path[path.length - 1];
  return { kb, path, heading, end, short: path.length < kb.grids, rest, dir, resumed: !!resume };
}

// THE GRID IN FRONT OF A UNIT, and the enemy Ground Units standing in it:
// what a shove after a Movement Action may Push (181_A, PLK400-SK_A: "if there
// is an Enemy Ground Unit in the adjacent grid in front of the Mech after
// performing this Action, may cause Push 1"). A Flying Raven is not a Ground
// Unit (audit Phase 4, B4). `at` reads it for a Grid and a facing the unit is
// not in yet: where a Movement would leave it. The Match Centre's shove panel
// reads the same (it was the panel's own until a seat needed it, M8.2u).
export function gridAhead(t: Token, at?: { c: number; r: number; facing: Facing }): LargeGrid {
  const g = at ?? { c: Math.floor(t.col / 3), r: Math.floor(t.row / 3), facing: t.facing };
  const fv = [[0, -1], [1, 0], [0, 1], [-1, 0]][g.facing] as [number, number];
  return { c: g.c + fv[0], r: g.r + fv[1] };
}

export function shoveVictims(data: GameData, state: GameState, t: Token, at?: { c: number; r: number; facing: Facing }): Token[] {
  const ahead = gridAhead(t, at);
  return state.tokens.filter((o) => {
    if (o.side === t.side || o.uid === t.uid || !isGroundUnit(data, o) || o.deployed === false) return false;
    return Math.floor(o.col / 3) === ahead.c && Math.floor(o.row / 3) === ahead.r;
  });
}

// Whether a Mine's blast is owed on a unit: a line a Mine stopped waits for it
// (the page's pushOnReady).
export function minesOwedOn(data: GameData, state: GameState, uid: number): boolean {
  return minesOwed(data, state.tokens).some((x) => x.victims.includes(uid));
}

// THE COMMANDS A FORCED MOVEMENT IS SENT AS, the panel's "Force the move" and a
// seat's answer alike: the forceMove onto the Grid the line ends in, the victim
// turned to `facing` where the forcing player chose one (3.4.4), and for a Push
// its Link (not for the rest of a line, paid on the first leg); and in an
// Abyss the kill, which is the forcing player's. Nothing for a line blocked
// from its first Grid.
export function forcedCommands(
  data: GameData, state: GameState, by: Token, victim: Token, a: CardAction,
  opts: { dir?: number; facing?: Facing; resume?: { dir: { dc: number; dr: number }; grids: number } } = {},
): { out: ForcedMove | null; commands: Command[]; fatal: boolean } {
  const out = forcedMove(data, state, by, victim, a, opts.dir, opts.resume);
  if (!out || !out.path.length) return { out, commands: [], fatal: false };
  const spot = standingSpot(out.end.c, out.end.r, victim.size, victim.aerial, terrainOf(data, state), state.tokens, victim.uid, { col: victim.col, row: victim.row })
    ?? { col: victim.col, row: victim.row };
  const fatal = isGroundUnit(data, victim) && envCardAt(state, out.end.c, out.end.r) === 'abyss';
  const commands: Command[] = [{
    kind: 'forceMove', seat: by.side, uid: by.uid, targetUid: victim.uid, to: spot, push: out.kb.push && !out.resumed, facing: opts.facing,
    via: out.path.map((g) => ({ col: g.c * 3 + 1, row: g.r * 3 + 1 })),
  }];
  if (fatal) commands.push({ kind: 'recordKill', seat: by.side, uid: by.uid, targetUid: victim.uid, what: 'unit' });
  return { out, commands, fatal };
}

// ---------- what a unit can see ----------

// EVERY GRID A UNIT HAS A LINE OF SIGHT TO, for the board's Line of Sight
// control (OTTO's playtest, 2026-10-03: "This would help to see what each
// unit's line of sight covers so I know to turn the unit if needed"): seen as a
// unit filling that Grid would be (rules.ts firingSight: the terrain, the units
// and the Smoke on the line; the units standing in that Grid are what would be
// looked at, never in the way), and whether the Grid lies in its Forward Arc
// (4.2.5). A line through cover is `clear: false`. Its own Grid is not listed.
// THE GRIDS A UNIT CAN AIM AT, for the board's Firing Arc control (OTTO,
// 2026-10-08: "change the LOS button to actually be firing arc ... it'll help
// the user know where his mech can hit vs LOS shows a lot of details the user
// probably doesnt need"): every Grid of its Forward Arc (4.2.5, as rules.ts
// inArc reads it, the Grids the sector's edges cut included), where its Melee
// and Firing Actions may pick a target. Its own Grid is not listed.
export function arcOf(state: GameState, t: Token): { c: number; r: number }[] {
  const here = largeGridOf(t);
  const size = gridsOf(state);
  const out: { c: number; r: number }[] = [];
  for (let c = 0; c < size; c++) {
    for (let r = 0; r < size; r++) {
      if (c === here.c && r === here.r) continue;
      if (inArc(t, { ...t, uid: -1, col: c * 3, row: r * 3, size: 3, aerial: false } as Token, 'forward')) out.push({ c, r });
    }
  }
  return out;
}

export function sightOf(data: GameData, state: GameState, t: Token): { c: number; r: number; arc: boolean; clear: boolean }[] {
  const terrain = terrainOf(data, state);
  const smoke = state.smoke ?? [];
  const standing = state.tokens.filter((x) => x.deployed !== false && x.uid !== t.uid);
  const here = largeGridOf(t);
  const size = gridsOf(state);
  const out: { c: number; r: number; arc: boolean; clear: boolean }[] = [];
  for (let c = 0; c < size; c++) {
    for (let r = 0; r < size; r++) {
      if (c === here.c && r === here.r) continue;
      const there = { ...t, uid: -1, cardId: '', kind: 'mech', col: c * 3, row: r * 3, size: 3, aerial: false } as Token;
      const between = standing.filter((x) => { const g = largeGridOf(x); return g.c !== c || g.r !== r; });
      const sight = firingSight(t, there, terrain, between, smoke);
      if (sight === 'blocked' || sight === 'smoked') continue;
      out.push({ c, r, arc: inArc(t, there, 'forward'), clear: sight === 'clear' });
    }
  }
  return out;
}
