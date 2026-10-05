// WHAT A SEAT OWES. One function answers "what must this seat decide now",
// with every legal answer beside it (AI-OPPONENT-PLAN.md, rule R2).
//
// The order of the questions is the order the Match Centre's turn panel asks
// them in (matchhud.ts panelHtml): what is owed across the table first (a
// defence roll, an answer somebody is waiting on), then the setup stage, then
// the phase. Every option is made here, out of the same readings the panels
// draw from (turn.ts) and the engine's own check(), so a rule that changes
// changes what is offered, and nothing that reads a Decision has to know why.
//
// Pure: it reads the table and the seat's own memory and returns data. It
// sends nothing and changes nothing; whoever asked sends the option it picks.
import { ammoAvailable, apply, check, checkAfter, liveIntercepts, missionZones, readyCommands, rebootOwed, taskDesignations, type CheckResult, type Command } from './commands';
import { copyAsJson } from './jsoncopy';
import type { GameData } from './data';
import { cardName, isMine, unfoldsInto } from './data';
import { makeInit, opportunity, tableAfter } from './glue';
import { alive, canAct, eligibleUnits, isLoopPhase, loopComplete, nextActivation, nextTurn, tiedChoices, type LoopPhase } from './loop';
import { crushEscapeGrids, crushExchange, crushExchangeSpots, firingSight, inArc, inContact, largeGridOf, losBetween, mineSpot, rangeBetween, spotsInGrid, standingSpot, type LargeGrid } from './rules';
import { canBeForceMoved } from './melee';
import { gameEndsThisRound, lowValueOf, previewScore, zoneCellsOf } from './scoring';
import { deployable, deployTurn, deploymentComplete, firstPlayerFrom, normaliseSetup, type SetupState } from './setup';
import { boxPlaceTurn, cellToGrid, deployGrids, deployOpenGrids, gameResult, normaliseTasks, TERMINAL_UID, terminalsInReach } from './tasks';
import { actionIdOf, timingOf } from './ticks';
import * as turn from './turn';
import { gridsOf, isLineUnit, newOpportunity, PHASES, removableTokens, statusCount, STATUSES, TIMINGS, zonesOf } from './types';
import { tacticSpec, tacticTargets, tacticUsedRound, tacticWindowWhy, type TacticCtx } from './tactics';
import { sealTactic } from './secrecy';
import type { CardAction, Facing, GameState, Opportunity, Side, Stance, Timing, Token } from './types';
import type { Decision, Option } from './seat';
import {
  actionRange, allyRepairTargets, autoDetonationsOwed, bitPortOf, bitsToRecover, blastsReady, blastTurn, blinkTargets, cruising, pilotCard, canActivateCamo, chargeableSlots, chargeChoices, commandCoordination, coordinationAfterManeuver, coordinationFor,
  detonationToken, discardSlots, envCardAt, explosionCamo, extraActivationOf, fliesToTarget, formSwitch, immediateDetonation, immediatesOwed, isGroundUnit, linkSupportOf, linkSupportTargets, manifestTargets, martyrdomOwed, maxLink, minesLayable, repairSpec,
  resupplyHolders, resupplyOf, riposteMelees, selfGrantWhy, selfStanceShift, selfRepairOptions, selfStatusGrant, smokePlacement, stabiliseAsk, STABILISE_KEEP_LABEL, stabiliseRowLabel, stanceFeedbackTargets,
  targetStatusGrant, targetStatusTargets, tokenCards, tokenCleanupOf, tokenCleanupTargets, transformOffer, unfoldsOwed, controlledMoveActions, knockbackOf,
  interceptPayer, overwatchOf,
} from './units';

// ---------- what a seat keeps to itself ----------

// The one thing a seat knows that the table does not: the Timing Dials it has
// chosen and not yet revealed (3.3). They are in no shared state, exactly as
// a second player's are on their own screen until both squads have committed.
//
// And one thing it remembers of its own doing: a blast on every unit in Range
// is one Explosion attack for each unit it caught, made one at a time (4.7.6,
// FAQ M21), and which of them have had theirs is on no table. A player's page
// keeps it in the Detonation panel (matchhud.ts detonateNow.hit); a seat keeps
// it here, for as long as the unit that is blowing up stands.
//
// And, as the Match Centre's Mine panel keeps it (matchhud.ts minePick), the
// Mines a Movement it has just made may still Lay along its route (006_A): the
// Range the walk left unspent is on no table. Recorded by whoever sends the
// walk (the driver), as `walked` the round, phase and route the Opportunity
// then held: stale the moment the unit walks again or the activation passes.
export interface MineOffer {
  uid: number;
  actionId: string;
  cardId: string;
  grids: { c: number; r: number }[];
  max: number;
  route: { c: number; r: number }[];
  flight: boolean;
}

export interface SeatMind {
  dials: { round: number; picks: Record<number, Timing>; salt?: string } | null;
  blast?: { uid: number; actionId: string; hit: number[] } | null;
  mines?: (MineOffer & { left: number; walked: string }) | null;
  // A sealed hand of Tactics Cards (Supplementary Rules 1.04, 1.11): the cards
  // and the salts that prove them, which the table never holds (it holds the
  // commitments). Absent for a plain hand, which the table lists.
  hand?: { id: string; salt: string }[] | null;
  // The moments it has let a Tactics Card go by, so each is asked once.
  passed?: string[] | null;
  // A Forced Movement its own attack owes (Knockback X, Push X): the attacker,
  // the Action, the victim, and where a Mine stopped the line the rest of it
  // (the Match Centre's `shovePlan` and `pushOn`, M8.2t). A shove after a
  // Movement names no victim (`targetUid` null): whoever stands in front (M8.2u).
  shove?: { uid: number; actionId: string; targetUid: number | null; resume?: { dir: { dc: number; dr: number }; grids: number } } | null;
  // A shove whose walk a Mine stopped, owed once the Go on has landed (the
  // page's `haltCarry`), in the round it was made.
  shoveLater?: { uid: number; actionId: string; round: number } | null;
}

export function newMind(): SeatMind {
  return { dials: null, blast: null, mines: null, hand: null, passed: null, shove: null, shoveLater: null };
}

// What an Opportunity has walked, as a seat's memory of a Mine offer names it.
export function walkedKey(state: GameState): string {
  return `${state.round.n}:${state.round.phase}:${(state.script?.opp?.route ?? []).join(';')}`;
}

// What an asker wants built of an activation's answers. Listing every Grid a
// unit could walk to is most of the work of the question, and a seat that is
// only looking ahead (what could I attack from there?) has no use for it. The
// kinds are an answer's first tag: 'move', 'attack', 'launch', 'electronic',
// 'charge', 'stabilise', 'detonate', 'stance', 'tied', 'end'. Absent, every
// kind is built, which is what a seat that must ANSWER is always given. One
// kind is narrower than a tag: 'maneuver' is the Maneuver's moves without the
// Movement Actions', for an asker that wants the step before an attack and
// not every Grid a Sprint reaches. And one is narrower still: 'reach:<uid>'
// is the Maneuver's moves after which the unit could attack that one enemy,
// the nearest to it first and three at most, for an asker working out what a
// unit could do to another by stepping out first. In the same way
// 'strike:<uid>' is the attacks on that one enemy and no other: an asker that
// wants to know what a unit could do to ONE of its enemies is not made to pay
// for the line to every one of them.
export interface Want {
  only?: string[];
}
const wants = (want: Want | undefined, kind: string): boolean => !want?.only || want.only.includes(kind);
// The enemy a 'reach:<uid>' names, or null: every other kind is asked for.
// 'reachAll:<uid>' is the same with the Movement Actions' moves besides (a
// Sprint as the Starting Action of a Movement dial, after which any Action
// may follow, 3.4.3): the moves of either after which the unit could attack
// that enemy, the nearest to it first and three at most of each.
function reachOf(want: Want | undefined): number | null {
  if (!want?.only || want.only.includes('move') || want.only.includes('maneuver')) return null;
  const kind = want.only.find((k) => k.startsWith('reach:') || k.startsWith('reachAll:'));
  return kind ? Number(kind.slice(kind.indexOf(':') + 1)) : null;
}
function reachAllOf(want: Want | undefined): number | null {
  if (!want?.only || want.only.includes('move') || want.only.includes('maneuver')) return null;
  const kind = want.only.find((k) => k.startsWith('reachAll:'));
  return kind ? Number(kind.slice(9)) : null;
}
const REACH_LIMIT = 3;
// The enemy a 'strike:<uid>' names, or null.
function strikeOf(want: Want | undefined): number | null {
  const kind = want?.only?.find((k) => k.startsWith('strike:'));
  return kind ? Number(kind.slice(7)) : null;
}

// ---------- the end of the game ----------

export interface GameOver {
  over: boolean;
  winner: Side | null;
  why: string;
  vp: Record<Side, number>;
}

const END_STEPS = ['remove', 'tokens', 'smoke', 'tasks'] as const;

// The End Phase steps this round still owes, in the book's order (3.7):
// Remove Units, Token Management, the Smoke's dissipation when there is Smoke
// to judge, then the Tasks.
function endStepsLeft(state: GameState): string[] {
  const sc = state.script;
  if (!sc) return [];
  const done = (step: string): boolean => sc.endDone.includes(`${state.round.n}:end:${step}`);
  return END_STEPS.filter((step) => (step !== 'smoke' || (state.smoke ?? []).length > 0) && !done(step));
}

// A concession ends the game at once; otherwise the last round's End Phase
// does, once its steps are done (3.7.3, 3.7.4). Losing every unit does not
// (FAQ P21).
export function gameOver(data: GameData, state: GameState): GameOver {
  const tasks = normaliseTasks(state.tasks);
  const result = (): GameOver => {
    const res = gameResult(tasks, state.tokens, lowValueOf(data));
    return { over: true, winner: res.winner, why: res.why, vp: { s1: tasks.vp.s1, s2: tasks.vp.s2 } };
  };
  if (tasks.conceded) return result();
  const ended = normaliseSetup(state.setup)?.stage === 'done' && !!state.script
    && state.round.phase === PHASES.length - 1 && gameEndsThisRound(data, state) && !endStepsLeft(state).length;
  return ended ? result() : { over: false, winner: null, why: '', vp: { s1: tasks.vp.s1, s2: tasks.vp.s2 } };
}

// ---------- building a Decision ----------

const other = (s: Side): Side => (s === 's1' ? 's2' : 's1');
const grid = (n: number): number => Math.floor(n / 3);

interface Asked {
  unit?: number;
  facts?: Record<string, unknown>;
  // A step of table bookkeeping either seat may take; `seat` names the one
  // expected to.
  shared?: boolean;
}

// One question and its answers. No answers is no question: the caller falls
// through to waiting.
function ask(kind: string, seat: Side, key: string, options: Option[], fallback: string, more: Asked = {}): Decision | null {
  if (!options.length) return null;
  return {
    id: `${kind}|${key}`,
    kind,
    seat,
    ...(more.unit !== undefined ? { unit: more.unit } : {}),
    options,
    fallback: options.some((o) => o.id === fallback) ? fallback : options[0].id,
    facts: more.facts ?? {},
    ...(more.shared ? { shared: true } : {}),
  };
}

// An option that sends commands, kept only when the engine would take them:
// the first as the table stands, each later one as it will stand after the
// one before it.
function sends(data: GameData, state: GameState, id: string, label: string, tags: string[], commands: Command[]): Option | null {
  let v: CheckResult = check(data, state, commands[0]);
  for (let i = 1; v.ok && i < commands.length; i++) v = checkAfter(data, state, commands[i - 1], commands[i]);
  return v.ok ? { id, label, tags, commands } : null;
}

const runs = (id: string, label: string, tags: string[], routine: string, args: Record<string, unknown> = {}): Option =>
  ({ id, label, tags, run: { routine, args } });

const kept = (list: (Option | null)[]): Option[] => list.filter((o): o is Option => !!o);

const stamp = (state: GameState): string => `${state.round.n}:${state.round.phase}`;

// ---------- a phase both squads are done with ----------

// Turning a phase is an agreement: each seat says it is ready, and whoever
// completes the pair turns it (match.ts advanceIfBothReady). So the second
// seat to be ready sends both.
function readyOwed(data: GameData, state: GameState, seat: Side, what: string): Decision | null {
  const r = state.ready ?? {};
  if (r[seat]) return null;
  const ready: Command = { kind: 'setReady', seat, ready: true };
  const commands: Command[] = r[other(seat)] ? [ready, { kind: 'advancePhase', seat }] : [ready];
  // The turn itself must be one the engine will take once both are ready, or
  // the phase is not over and saying so would only strand the table.
  const both = { ...state, ready: { s1: true, s2: true } } as GameState;
  if (!check(data, both, { kind: 'advancePhase', seat }).ok) return null;
  return ask('phase.ready', seat, stamp(state), kept([sends(data, state, 'ready', what, ['ready'], commands)]), 'ready');
}

// ---------- setup (3.1) ----------

function setupOwed(data: GameData, state: GameState, seat: Side, su: SetupState): Decision | null {
  const fp = state.round.firstPlayer;
  if (su.stage === 'map') {
    // The battlefield was settled before the game began; the host locks it.
    if (seat !== 's1') return null;
    return ask('setup.lock', seat, 'map', kept([sends(data, state, 'lock', 'Lock the battlefield', ['setup'], [{ kind: 'lockMap', seat }])]), 'lock');
  }
  if (su.stage === 'roll') {
    const winner = firstPlayerFrom(su);
    const tied = !!su.rolls.s1.length && !!su.rolls.s2.length && !winner;
    if (!su.rolls[seat].length || tied) {
      return ask('setup.roll', seat, `roll:${su.rolls.s1.length}:${su.rolls.s2.length}`, [runs('roll', 'Roll for First Player', ['roll'], 'rollSetup', { dice: 2 })], 'roll');
    }
    // The winner takes the game on; the other squad waits to be told.
    if (winner !== seat) return null;
    return ask('setup.accept', seat, 'accept', kept([sends(data, state, 'accept', 'Continue as First Player', ['setup'], [{ kind: 'acceptRoll', seat }])]), 'accept');
  }
  if (su.stage === 'side') {
    if (fp !== seat) return null;
    return ask('setup.edge', seat, 'edge', kept((['black', 'white'] as const).map((edge) =>
      sends(data, state, `edge:${edge}`, `Take the ${edge === 'black' ? 'Black' : 'White'} Deployment Zone`, ['edge', `edge:${edge}`], [{ kind: 'pickEdge', seat, edge }]))), 'edge:black');
  }
  if (su.stage === 'tasks') return tasksOwed(data, state, seat);
  if (su.stage === 'deploy') return deployOwed(data, state, seat, su);
  return null;
}

// The Tasks step: the Secondary Tasks (a game may play none), what each Task
// names, the Black Boxes, then on to deployment. The First Player closes it.
function tasksOwed(data: GameData, state: GameState, seat: Side): Decision | null {
  const fp = state.round.firstPlayer;
  const tasks = normaliseTasks(state.tasks);
  if (!state.noSecondary && (!tasks.secondary.s1 || !tasks.secondary.s2)) {
    // The First Player reveals first (FAQ P1).
    const turnNow = !tasks.secondary[fp] ? fp : other(fp);
    if (turnNow !== seat) return null;
    const cards = (data.secondary ?? []).map((c) =>
      sends(data, state, `secondary:${c.id}`, `Secondary Task: ${c.name || c.id}`, ['secondary'], [{ kind: 'pickSecondary', seat, cardId: c.id }]));
    return ask('setup.secondary', seat, 'secondary', kept(cards), '');
  }
  const owedNames = taskDesignations(data, state);
  if (owedNames.length) {
    const mine = owedNames.find((d) => d.by === seat);
    if (!mine) return null;
    const options = mine.what === 'zone'
      ? missionZones(data, state).map((z) =>
          sends(data, state, `zone:${z.id}`, `${mine.label}: ${z.name}`, ['designate', 'zone'], [{ kind: 'designateTask', seat, what: 'zone', zone: z.id }]))
      : state.tokens.filter((t) => t.kind === 'mech' && t.side === mine.owner).map((t) =>
          sends(data, state, `mech:${t.uid}`, mine.what === 'leader' ? `Commander: ${t.label}` : `${mine.label}: ${t.label}`,
            ['designate', mine.what], [{ kind: 'designateTask', seat, what: mine.what, for: mine.side, uid: t.uid }]));
    return ask(`setup.designate.${mine.what}`, seat, `${mine.what}:${mine.side}:${owedNames.length}`, kept(options), '', { facts: { what: mine.what, for: mine.side, owner: mine.owner ?? null } });
  }
  const boxTurn = state.noBoard ? null : boxPlaceTurn(tasks, fp);
  if (boxTurn) {
    if (boxTurn !== seat) return null;
    // Kept where it stands, or put down in another Large Grid of its zone
    // (5.2.1: anywhere in the Tactical Zone its Main Task names, at ground
    // level and never on terrain, FAQ P9): a Small Grid of each the engine
    // takes, the middle one first. The kept ones come first. Each answer says
    // which Box and the Large Grid it ends in; the question, where each squad
    // deploys (as `setup.deploy` says it), for a seat with a view on where it
    // wants a Box.
    const loose = tasks.items.filter((i) => i.kind === 'blackbox' && !i.set && i.col !== undefined && i.row !== undefined);
    const gridOf = (col: number, row: number): { c: number; r: number } => ({ c: Math.floor(col / 3), r: Math.floor(row / 3) });
    const keep = loose.map((i) => {
      const o = sends(data, state, `box:${i.id}`, 'Leave the Black Box where it stands', ['box', 'keep'], [{ kind: 'placeTaskItem', seat, itemId: i.id, to: { col: i.col!, row: i.row! } }]);
      return o ? { ...o, facts: { box: i.id, at: gridOf(i.col!, i.row!) } } : null;
    });
    const cellsOf = zoneCellsOf(data, state);
    const SPOTS = [[1, 1], [0, 0], [2, 0], [0, 2], [2, 2], [1, 0], [0, 1], [2, 1], [1, 2]];
    const moved = loose.flatMap((i) => {
      const here = gridOf(i.col!, i.row!);
      return cellsOf(i.zone).map((ref) => cellToGrid(ref)).filter((g): g is { c: number; r: number } => !!g && (g.c !== here.c || g.r !== here.r)).map((g) => {
        for (const [dc, dr] of SPOTS) {
          const o = sends(data, state, `box:${i.id}@${g.c},${g.r}`, `Put the Black Box in ${String.fromCharCode(65 + g.c)}${g.r + 1}`, ['box', 'place'],
            [{ kind: 'placeTaskItem', seat, itemId: i.id, to: { col: g.c * 3 + dc, row: g.r * 3 + dr } }]);
          if (o) return { ...o, facts: { box: i.id, at: g } };
        }
        return null;
      });
    });
    const su = normaliseSetup(state.setup);
    const ours = su?.edge?.[seat] ? deployGrids(data.zoneData, state, su.edge[seat]) : null;
    const theirs = su?.edge?.[other(seat)] ? deployGrids(data.zoneData, state, su.edge[other(seat)]) : null;
    return ask('setup.box', seat, `box:${tasks.items.filter((i) => i.set).length}`, kept([...keep, ...moved]), '',
      { facts: { zone: ours ? [...ours].sort() : [], foeZone: theirs ? [...theirs].sort() : [] } });
  }
  if (fp !== seat) return null;
  return ask('setup.tasks', seat, 'tasks', kept([sends(data, state, 'done', 'Continue to deployment', ['setup'], [{ kind: 'finishTasks', seat }])]), 'done');
}

// Deployment (3.1.4): the squads place in turn, one unit to a Grid of its
// squad's zone, and Round 1 begins when both say their deployment is final.
function deployOwed(data: GameData, state: GameState, seat: Side, su: SetupState): Decision | null {
  const turnNow = deployTurn(state, su, data);
  if (!turnNow || deploymentComplete(state, data)) {
    const r = state.ready ?? {};
    if (r[seat]) {
      // Ready first, and the other squad has since agreed: either may begin.
      if (!r[other(seat)]) return null;
      return ask('setup.begin', seat, 'begin', kept([sends(data, state, 'begin', 'Begin Round 1', ['ready'], [{ kind: 'finishDeployment', seat }])]), 'begin');
    }
    const ready: Command = { kind: 'setReady', seat, ready: true };
    const commands: Command[] = r[other(seat)] ? [ready, { kind: 'finishDeployment', seat }] : [ready];
    return ask('setup.ready', seat, 'deployed', kept([sends(data, state, 'ready', 'My deployment is final', ['ready'], commands)]), 'ready');
  }
  if (turnNow !== seat) return null;
  const terrain = turn.terrainOf(data, state);
  const taken = new Set(state.tokens
    .filter((x) => x.deployed !== false && x.kind !== 'projectile')
    .map((x) => `${grid(x.col)},${grid(x.row)}`));
  const zone = deployGrids(data.zoneData, state, su.edge[seat]);
  const open = zone ? [...deployOpenGrids(zone, taken, gridsOf(state))] : [];
  // In reading order, so the same table always lists the same options.
  open.sort((a, b) => {
    const [ac, ar] = a.split(',').map(Number);
    const [bc, br] = b.split(',').map(Number);
    return ar - br || ac - bc;
  });
  const options: Option[] = [];
  for (const t of deployable(state, seat, data)) {
    const stances: (Stance | undefined)[] = t.kind === 'mech' ? ['offensive', 'defensive', 'mobility'] : [undefined];
    // A unit with a Part that Activates Optical Camouflage may deploy in it
    // (4.12.2; the Match Centre's deployment panel has the tick box). It costs
    // nothing and nothing is given up for it, so a seat's unit that can, does.
    const camo = canActivateCamo(data, t);
    // A Drone with a Load to lend: the Mech it would touch where it is set down.
    const lender = t.kind === 'drone' && !!t.droneBackpack && (t.partStates.backpack ?? 'intact') !== 'destroyed';
    for (const key of open) {
      const [c, r] = key.split(',').map(Number);
      const spot = standingSpot(c, r, t.size, t.aerial, terrain, state.tokens, t.uid);
      if (!spot) continue;
      const facing = turn.deployFacing(data, state, seat, spot);
      const lent = lender ? touchedMech(state, t, { c, r }, spot) : null;
      for (const stance of stances) {
        const o = sends(data, state, `deploy:${t.uid}:${c},${r}${stance ? `:${stance}` : ''}`,
          `Deploy ${t.label} at ${String.fromCharCode(65 + c)}${r + 1}${stance ? `, ${stance}` : ''}${camo ? ', in Optical Camouflage' : ''}`,
          ['deploy', ...(stance ? [`stance:${stance}`] : []), ...(camo ? ['camo'] : [])],
          [{ kind: 'deployUnit', seat, uid: t.uid, to: spot, facing, ...(stance ? { stance } : {}), ...(camo ? { camo: true } : {}) }]);
        if (o) options.push({ ...o, facts: { uid: t.uid, to: { c, r }, facing, ...(stance ? { stance } : {}), ...(camo ? { camo: true } : {}), ...(lent ? { lendsTo: lent.uid } : {}) } });
      }
      // A Drone with a Load to lend may be set down against an Ally Mech
      // already down, which then uses the Load as its own Part (`besideMech`).
      const beside = lender ? besideMech(data, state, t, { c, r }, spot) : null;
      if (beside) {
        const o = sends(data, state, `deploy:${t.uid}:${c},${r}:lend`,
          `Deploy ${t.label} at ${String.fromCharCode(65 + c)}${r + 1}${camo ? ', in Optical Camouflage' : ''}, against ${beside.mech.label}`,
          ['deploy', 'lend', ...(camo ? ['camo'] : [])],
          [{ kind: 'deployUnit', seat, uid: t.uid, to: beside.spot, facing, ...(camo ? { camo: true } : {}) }]);
        if (o) options.push({ ...o, facts: { uid: t.uid, to: { c, r }, facing, lendsTo: beside.mech.uid, ...(camo ? { camo: true } : {}) } });
      }
    }
  }
  // Where the other squad deploys is printed on the same battlefield card: a
  // seat choosing where to stand may read it, as a player does.
  const theirs = deployGrids(data.zoneData, state, su.edge[other(seat)]);
  return ask('setup.deploy', seat, `deploy:${su.placed.s1}:${su.placed.s2}`, options, '', { facts: { zone: open, foeZone: theirs ? [...theirs].sort() : [] } });
}

// ---------- Planning (3.3) ----------

// The Mechs that set a dial: on the board and standing, a Shutdown one
// included (FAQ K17).
const dialMechs = (state: GameState, seat: Side): Token[] =>
  state.tokens.filter((t) => t.side === seat && t.kind === 'mech' && t.deployed !== false && alive(t));

// The Timing a Mech would take with no better idea: that of the first Action
// it can still perform, so its Opportunity can at least begin.
function plainTiming(data: GameData, state: GameState, t: Token): Timing {
  // Asked as if the Opportunity had already started, so the answer is about
  // the Part and the board and not about a dial that is not set yet.
  const o = { ...newOpportunity(t.uid, undefined), started: true };
  for (const row of turn.actionRows(data, state, t, o)) {
    const timing = timingOf(row.a);
    if (timing && row.slot && row.v.ok) return timing;
  }
  return 'movement';
}

function planningOwed(data: GameData, state: GameState, seat: Side, mind: SeatMind): Decision | null {
  const sc = state.script;
  if (!sc) return null;
  const bothRevealed = sc.revealed.includes('s1') && sc.revealed.includes('s2');
  if (bothRevealed) return readyOwed(data, state, seat, 'Continue to the Action Phase');
  if (sc.revealed.includes(seat)) return null;
  const mechs = dialMechs(state, seat);
  const held = mind.dials && mind.dials.round === state.round.n ? mind.dials : null;
  // Committed, with the dials behind the commitment still in hand: the reveal
  // waits for the other squad's commitment and then follows.
  if (sc.commits[seat] && held?.salt) {
    if (!sc.commits[other(seat)]) return null;
    return ask('planning.reveal', seat, `reveal:${state.round.n}`, [runs('reveal', 'Reveal the dials', ['dials'], 'revealDials')], 'reveal');
  }
  // A commitment whose dials are lost can be replaced until anyone reveals.
  const unset = mechs.find((t) => !held || !held.picks[t.uid]);
  if (unset) {
    const safe = plainTiming(data, state, unset);
    return ask('planning.dial', seat, `dial:${state.round.n}:${unset.uid}`,
      TIMINGS.map((d) => runs(`dial:${d.id}`, `${unset.label}: ${d.name}`, ['dial', `timing:${d.id}`], 'dial', { uid: unset.uid, timing: d.id })),
      `dial:${safe}`, { unit: unset.uid });
  }
  return ask('planning.commit', seat, `commit:${state.round.n}`, [runs('commit', 'Lock in the dials', ['dials'], 'commitDials')], 'commit');
}

// ---------- the designation loops (3.2.2, 3.5.1, 3.6.1) ----------

function loopOwed(data: GameData, state: GameState, seat: Side, phase: LoopPhase, want?: Want): Decision | null {
  const sc = state.script;
  if (!sc) return null;
  if (sc.opp) {
    const t = state.tokens.find((x) => x.uid === sc.opp!.uid);
    if (t) return t.side === seat ? activationOwed(data, state, seat, t, want) : null;
  }
  if (loopComplete(state, phase, data)) return readyOwed(data, state, seat, 'Continue');
  const turnNow = canAct(state, phase, sc.turn, data) ? sc.turn : (nextTurn(state, phase, sc.turn, data) ?? sc.turn);
  if (turnNow !== seat) return null;
  const options = kept([
    ...eligibleUnits(state, phase, seat, data).map((t) => {
      const o = sends(data, state, `designate:${t.uid}`, `${phase === 'Command' ? 'Command' : 'Activate'} ${t.label}`, ['designate', t.kind], [{ kind: 'designate', seat, uid: t.uid }]);
      return o ? { ...o, facts: { uid: t.uid } } : null;
    }),
    sends(data, state, 'pass', 'Pass for the phase', ['pass'], [{ kind: 'passTurn', seat }]),
  ]);
  return ask(`loop.designate.${phase.toLowerCase()}`, seat, `${stamp(state)}:${sc.acted.length}:${sc.commanded.length}:${sc.passed.length}`, options, 'pass');
}

// ---------- Movement (4.3) ----------

const FACINGS: Facing[] = [0, 1, 2, 3];
const FACING_NAME = ['north', 'east', 'south', 'west'] as const;
const gridName = (g: { c: number; r: number }): string => `${String.fromCharCode(65 + g.c)}${g.r + 1}`;

// What one Movement is made with: the Maneuver, or a Movement Action and the
// command that pays for it.
interface MoveSpec {
  // Names the Movement inside the option ids: `maneuver`, or the Action's row.
  key: string;
  name: string;
  tags: string[];
  // Sent first: a Movement Action's payment. Empty for the Maneuver.
  prefix: Command[];
  actionId?: string;
  range?: number;
  free?: boolean;
  airborne?: boolean;
  maneuver?: boolean;
  // A Maneuver a Tactics Card hands out (Hit and Run), which belongs to no
  // Opportunity and takes the card's grant (commands.ts grantedMoveKey).
  granted?: boolean;
  // The Red Shoes (TM35NA_B): the unit of THIS seat steering the enemy unit
  // that moves; its seat sends the Movement as a `controlledMove`.
  controller?: { uid: number; side: Side };
  // The rest of a Movement a Mine stopped (ruling I16): on the Range it had
  // left, and on the Tick already paid for it.
  resume?: boolean;
  // Flown, where flying is the unit's to choose: an Ojs200 lends its Mech
  // Flying Movement on the Maneuver, and the page's panel offers the switch
  // (turn.ts moveStart `flightOptional`).
  fly?: boolean;
  // The Harpy's tow (ZHDR-304): the Ally dragged along, and the Mech whose
  // Command Token pays for it (`towOf`).
  tow?: { allyUid: number; funderUid: number };
}

// THE HARPY'S TOW (ZHDR-304, "Air Transport"): "When performing a Command
// Movement, may consume 1 additional Command Token and -1 Movement to drag 1
// adjacent Ally Unit." The page asks it before the route is drawn, the Range
// one less (commandpick.ts offerHarpyDrag), and once the Movement has landed
// sets the Ally down in the Grid the route left last, else in the one it ended
// in (matchhud.ts towDraggedAlly): the funder's Command Token spent, and the
// Ally moved by the Forced Movement Knockback is made with. Here: where the
// Ally is set down on the table the Movement leaves, and those two commands;
// null where nothing is free for it to stand in (the page then drags nothing
// and spends nothing). The Ally keeps its facing, which the page lets the
// Harpy's player leave as it was.
function towOf(data: GameData, table: GameState, t: Token, tow: { allyUid: number; funderUid: number }, route: LargeGrid[]): { commands: Command[]; to: LargeGrid } | null {
  const ally = table.tokens.find((x) => x.uid === tow.allyUid);
  const goal = route[route.length - 1];
  if (!ally || !goal) return null;
  const terrain = turn.terrainOf(data, table);
  const prev = route.length >= 2 ? route[route.length - 2] : null;
  const behind = prev ? standingSpot(prev.c, prev.r, ally.size, ally.aerial, terrain, table.tokens, ally.uid) : null;
  const spot = behind ?? standingSpot(goal.c, goal.r, ally.size, ally.aerial, terrain, table.tokens, ally.uid);
  if (!spot) return null;
  const to = behind && prev ? prev : goal;
  return {
    commands: [
      { kind: 'spendCommand', seat: t.side, uid: tow.funderUid },
      { kind: 'forceMove', seat: t.side, uid: t.uid, targetUid: ally.uid, to: { col: spot.col, row: spot.row } },
    ],
    to: { c: to.c, r: to.r },
  };
}

// The Harpy's Command Movements that drag an Ally (`towOf`): for each Ally Unit
// adjacent to it that can be Force-Moved, the Movement on the Range the drag
// leaves, each answer carrying the drag. Paid by the first Mech of the squad
// with a face-up Command Token that could spend it, as the page pays it.
function towMoves(data: GameData, state: GameState, t: Token): Option[] {
  if (t.cardId !== 'ZHDR-304' || PHASES[state.round.phase] !== 'Command') return [];
  const opened = turn.moveStart(data, state, t, { maneuver: true });
  if (!opened.ok || opened.steps <= 1) return [];
  const funder = state.tokens.find((m) => m.side === t.side && m.kind === 'mech' && m.deployed !== false && alive(m) && m.stance !== 'shutdown' && readyCommands(m) > 0);
  if (!funder) return [];
  const out: Option[] = [];
  for (const ally of state.tokens) {
    if (ally.uid === t.uid || ally.side !== t.side || ally.deployed === false || !alive(ally) || !rangeBetween(t, ally).adjacent || !canBeForceMoved(data, ally)) continue;
    out.push(...movementOptions(data, state, t, {
      key: `tow:${ally.uid}`, name: `${t.label}: move, dragging ${ally.label}`, tags: ['maneuver', 'tow'], prefix: [], maneuver: true,
      range: opened.steps - 1, tow: { allyUid: ally.uid, funderUid: funder.uid },
    }));
  }
  return out;
}

// One Movement's options: each Grid the board would light for it, reached by
// the route the planner would draw there (turn.ts extendRoute) and ended on
// each facing; and, for the Maneuver, a turn on the spot. Every option carries
// what the planner's Confirm would send (turn.ts moveOrder), judged against
// the table as it stands once the payment has landed: one copy for the lot.
// A Grid holding Destructible Terrain and no Unit is a Crush that asks nothing
// (4.3.6): the terrain is destroyed, then the Movement ends there.
//
// A MINE IN THE WAY (FAQ M6, M19; ruling I16). A Ground unit that enters a
// Mine's Grid sets it off, its own squad's Mine as surely as the other's, so a
// Movement that ENDS in such a Grid is offered and says so (`mined`): a seat
// that chooses it has chosen the blast. A walk whose route passes THROUGH one
// stops there: it is offered as the stop it is, in the Mine's Grid, with the
// Range it keeps for the Go on once the blast is resolved (`halt`); every Grid
// beyond the Mine on that route is that one stop, so it is offered once for
// each facing, with the most Range any of them keeps.
//
// The Black Boxes a pick-up takes, by id: an asker planning what comes after
// it needs to know which Boxes are no longer lying there.
const taken = (takes: Command[]): string[] => takes.map((c) => ('itemId' in c ? String(c.itemId) : '')).filter(Boolean);

// A CRUSH OF A UNIT (4.3.6): a Movement that ends in a Grid a smaller unit
// stands in. The Match Centre works it a piece at a time (matchhud.ts
// advanceCrush, confirmCrushed, finishCrush), and every way it may come out is
// one whole answer here, made of the same commands in the same order: the
// Destructible Terrain crushed; then each crushed unit, in the order the
// planner queues them, destroyed where it cannot be Force-Moved (`recordKill`,
// credited to the crusher), pushed one Grid into an open Grid beside its own
// (`forceMove`: the crushing player picks the Grid, and here leaves its
// facing, which the panel lets it), or, with no Grid open, promised the
// exchange with the crusher where the Grid the crusher steps out of has room
// for it; then the crusher landed in the Grid once it has given way (its
// `maneuver`), or with an exchange the one `crushSwap` that moves every token
// and the Movement recorded from where it began; and where it still cannot
// fit, the Movement stopped short in the Grid before, as the panel stops it.
// The pushes multiply (each victim's Grids), so the ways are capped.
interface CrushWay {
  commands: Command[];
  landed: { col: number; row: number };
  short: boolean;
  pushed: { uid: number; to: { c: number; r: number } }[];
  destroyed: number[];
  exchanged: number[];
}
const CRUSH_WAYS = 16;

function crushWays(data: GameData, state: GameState, t: Token, order: Extract<turn.MoveOrder, { kind: 'route' }>, spec: MoveSpec): CrushWay[] {
  const victims = order.victims;
  if (!victims) return [];
  const by = { seat: t.side, uid: t.uid };
  const goal = order.goal;
  const from = order.path.length >= 2 ? order.path[order.path.length - 2] : null;
  const began = { col: t.col, row: t.row };
  const plan = { free: spec.free, granted: spec.granted, facing: order.facing, actionId: spec.actionId, breakAwayLink: order.linkDue, resume: spec.resume };
  const first: Command[] = victims.terrain.length ? [turn.crushDestroy(by, victims.terrain.map((p) => p.id))] : [];
  const start = first.length ? tableAfter(data, state, first) : state;
  if (!start) return [];
  const out: CrushWay[] = [];
  const step = (table: GameState, queue: number[], cmds: Command[], pushed: CrushWay['pushed'], destroyed: number[], swaps: number[]): void => {
    if (out.length >= CRUSH_WAYS) return;
    const crusher = table.tokens.find((x) => x.uid === t.uid);
    if (!crusher) return;
    const terrain = turn.terrainOf(data, table);
    if (!queue.length) {
      const swapped = swaps.map((u) => table.tokens.find((x) => x.uid === u)).filter((x): x is Token => !!x);
      const pair = swapped.length && from ? crushExchange(crusher, swapped, goal, from, terrain, table.tokens) : null;
      const spot = swapped.length ? pair?.crusher ?? null : turn.crushLanding(data, table, crusher, goal);
      if (!spot) {
        const walk = order.stops.slice(0, -1);
        const held = walk[walk.length - 1] ?? began;
        out.push({ commands: [...cmds, turn.crushRecord(crusher, plan, held, walk)], landed: held, short: true, pushed, destroyed, exchanged: [] });
        return;
      }
      const stops = [...order.stops.slice(0, -1), spot];
      const tail: Command[] = pair
        ? [{ kind: 'crushSwap', seat: t.side, uid: t.uid, to: spot, facing: order.facing, swaps: pair.victims.map((v) => ({ uid: v.uid, to: v.to, facing: undefined })) }, turn.crushRecord(crusher, plan, spot, stops, began)]
        : [turn.crushRecord(crusher, plan, spot, stops)];
      out.push({ commands: [...cmds, ...tail], landed: spot, short: false, pushed, destroyed, exchanged: pair ? swaps : [] });
      return;
    }
    const [head, ...rest] = queue;
    const v = table.tokens.find((x) => x.uid === head);
    if (!v) { step(table, rest, cmds, pushed, destroyed, swaps); return; }
    if (!canBeForceMoved(data, v)) {
      const kill: Command = { kind: 'recordKill', ...by, targetUid: v.uid, what: 'unit' };
      const next = tableAfter(data, table, [kill]);
      if (next) step(next, rest, [...cmds, kill], pushed, [...destroyed, v.uid], swaps);
      return;
    }
    const escapes = crushEscapeGrids(v, goal, crusher, from, terrain, table.tokens, (c, r) => isGroundUnit(data, v) && envCardAt(table, c, r) === 'abyss');
    if (!escapes.length) {
      const promised = swaps.map((u) => table.tokens.find((x) => x.uid === u)).filter((x): x is Token => !!x);
      const room = from && crushExchangeSpots(crusher, [...promised, v], goal, from, terrain, table.tokens);
      step(table, rest, cmds, pushed, destroyed, room ? [...swaps, v.uid] : swaps);
      return;
    }
    for (const g of escapes) {
      const at = standingSpot(g.c, g.r, v.size, v.aerial, terrain, table.tokens, v.uid);
      if (!at) continue;
      const push: Command = { kind: 'forceMove', ...by, targetUid: v.uid, to: { col: at.col, row: at.row } };
      const next = tableAfter(data, table, [push]);
      if (next) step(next, rest, [...cmds, push], [...pushed, { uid: v.uid, to: { c: g.c, r: g.r } }], destroyed, swaps);
    }
  };
  step(start, victims.units.map((v) => v.uid), first, [], [], []);
  return out;
}

// The Ally Mechs standing in or beside Grid `g`, any of which a unit there
// might touch.
function mechsBy(state: GameState, t: Token, g: LargeGrid): Token[] {
  return state.tokens.filter((m) => m.uid !== t.uid && m.side === t.side && m.kind === 'mech' && m.deployed !== false && alive(m)
    && Math.max(Math.abs(largeGridOf(m).c - g.c), Math.abs(largeGridOf(m).r - g.r)) <= 1);
}

// The Ally Mech a Drone with a Load would touch standing at `spot` (rules.ts
// inContact), or null: what the Load is lent to from there (`lendsTo`).
function touchedMech(state: GameState, t: Token, g: LargeGrid, spot: { col: number; row: number }): Token | null {
  const here = { ...t, col: spot.col, row: spot.row };
  return mechsBy(state, t, g).find((m) => inContact(here, m)) ?? null;
}

// THE SPOT BESIDE A MECH. A Drone carrying a Load lends it to an Ally Mech in
// Contact with it (162: "Ally Mechs in Contact with this drone may regard the
// Load of this drone as their own Part"), and Contact is bases meeting edge to
// edge (rules.ts inContact). Of a Grid's free spots, the one nearest `last` (the
// spot the Movement would take of itself) whose base would meet an Ally Mech's,
// where `last` meets none. Null where `last` already touches one, or no spot
// would.
function besideMech(data: GameData, state: GameState, t: Token, g: LargeGrid, last: { col: number; row: number }): { spot: { col: number; row: number }; mech: Token } | null {
  const mechs = mechsBy(state, t, g);
  if (!mechs.length) return null;
  const at = (s: { col: number; row: number }): Token => ({ ...t, col: s.col, row: s.row });
  if (mechs.some((m) => inContact(at(last), m))) return null;
  let best: { spot: { col: number; row: number }; mech: Token; far: number } | null = null;
  for (const s of spotsInGrid(at({ col: g.c * 3, row: g.r * 3 }), turn.terrainOf(data, state), state.tokens)) {
    if (!s.ok) continue;
    const m = mechs.find((x) => inContact(at(s), x));
    const far = Math.abs(s.col - last.col) + Math.abs(s.row - last.row);
    if (m && (!best || far < best.far)) best = { spot: { col: s.col, row: s.row }, mech: m, far };
  }
  return best ? { spot: best.spot, mech: best.mech } : null;
}

function movementOptions(data: GameData, state: GameState, t: Token, spec: MoveSpec): Option[] {
  const opened = turn.moveStart(data, state, t, { range: spec.range, actionId: spec.actionId, maneuver: spec.maneuver, airborne: spec.airborne });
  if (!opened.ok || (spec.fly && !opened.flightOptional)) return [];
  const start = spec.fly ? { ...opened, flying: true } : opened;
  const paid = spec.prefix.length ? tableAfter(data, state, spec.prefix) : state;
  if (!paid) return [];
  const here = largeGridOf(t);
  const out: Option[] = [];
  // A Harpy's tow (`towOf`): the drag worked out once a route, on the table
  // the Movement leaves, and kept only where the engine takes it there. A
  // route it cannot be made on is offered without it, as the Movement alone.
  const tows = new Map<string, { commands: Command[]; to: LargeGrid } | null>();
  const towFor = (route: LargeGrid[], move: Command): { commands: Command[]; to: LargeGrid } | null => {
    if (!spec.tow) return null;
    const id = route.map((x) => `${x.c},${x.r}`).join('>');
    if (!tows.has(id)) {
      const moved = tableAfter(data, paid, [move]);
      const tow = moved ? towOf(data, moved, t, spec.tow, route) : null;
      tows.set(id, moved && tow && tableAfter(data, moved, tow.commands) ? tow : null);
    }
    return tows.get(id) ?? null;
  };
  // An Aerial unit's Movement owes Interception where an interceptor of the
  // other squad reaches the Grid it leaves or the one it lands in (4.9). The
  // debt travels with the move, as the page queues it once the walk has
  // ended; it is worked out only on a table where some enemy holds a Token.
  const watched = !spec.controller && !!t.aerial && turn.interceptorsAgainst(state, t.side);
  // A loose Black Box in a Grid the route passes may be picked up as the
  // Movement ends (5.3.1): a second answer for that Grid, with the pick-up.
  // Worked out only on a table with a Box lying loose and a hand free for it.
  const carries = !spec.controller && normaliseTasks(state.tasks).items.some((i) => i.kind === 'blackbox' && i.bearerUid === undefined)
    && turn.boxHandsFree(data, state, t).length > 0;
  const draft = (path: LargeGrid[], facing: Facing, spin = 0): turn.MoveDraft => ({
    uid: t.uid, steps: start.steps, flying: start.flying, path, actionId: spec.actionId, free: spec.free,
    facing, turned: facing !== t.facing, spin, ...(spec.resume ? { resume: true } : {}), ...(spec.granted ? { granted: true } : {}),
    ...(spec.controller ? { controller: spec.controller } : {}),
  });
  // The Grids that hold a Mine this unit would set off by entering (FAQ M6: a
  // Ground unit, whoever's the Mine is), and the walks one of them stops.
  // Each with the Mine and the Action its blast is made with, so that whoever
  // puts the question to a seat can put odds on the answer.
  const mined = new Map<string, { uid: number; actionId: string }>();
  if (isGroundUnit(data, t)) {
    for (const m of state.tokens) {
      const card = m.uid !== t.uid && m.deployed !== false && alive(m) ? data.byId.get(m.cardId) : undefined;
      const blast = card && isMine(card) ? (card.actions ?? []).find((x) => (x.redDice ?? 0) + (x.yellowDice ?? 0) > 0) : undefined;
      const spot = `${largeGridOf(m).c},${largeGridOf(m).r}`;
      if (blast && !mined.has(spot)) mined.set(spot, { uid: m.uid, actionId: blast.id });
    }
  }
  const stopped = new Map<string, { command: Command; halt: number; stop: LargeGrid; facing: Facing; grids: number }>();
  // The route to every Grid the Movement reaches, from one search of the board
  // (turn.ts extendRoutes): each is the planner's own first leg to that Grid.
  const grids = turn.reachableFor(data, state, t, start.steps, start.flying, spec.actionId).filter((g) => !(g.c === here.c && g.r === here.r));
  const routes = turn.extendRoutes(data, state, t, here, grids, start.steps, start.flying, spec.actionId);
  // The loose Boxes this Movement reaches, each with the route to its Grid: a
  // route may be drawn BY WAY OF one, as a player sets a waypoint, and go on
  // to a Grid beyond it with what the Movement has left.
  // A drawn route never crosses itself, so the Box's Grid is come at from each
  // side that can be: the straight route to it, and the route to each Grid
  // beside it with one Grid more. Which of them goes on to a Grid beyond
  // depends on the side it came in by.
  const flown = start.flying || !!t.aerial;
  // A Mech with a Mine Layer may Lay along any route it walks (006_A).
  const layer = !spec.controller && t.kind === 'mech' && !!minesLayable(data, t, [here], 1, false, state.tokens);
  // A Movement Action that may shove at its end (181_A, PLK400-SK_A): an answer
  // that ends with an Enemy Ground Unit in front carries it, for the seat's
  // memory (SeatMind.shove), as the page opens its shove panel once the walk
  // has landed (matchhud.ts startShove); a walk a Mine stops carries it to the
  // Go on. Not for a unit steered by The Red Shoes.
  const shoveAction = spec.actionId && !spec.controller && t.kind === 'mech' ? turn.actionOf(data, state, t, spec.actionId) : undefined;
  const shoveId = shoveAction && knockbackOf(shoveAction, data.actionTranslation(shoveAction.id)?.english ?? undefined) ? shoveAction.id : null;
  const shoves = (end: { c: number; r: number }, f: Facing): { shoves?: { uid: number; actionId: string } } =>
    (shoveId && turn.shoveVictims(data, state, t, { c: end.c, r: end.r, facing: f }).length ? { shoves: { uid: t.uid, actionId: shoveId } } : {});
  // A Drone with a Load to lend, whole, moving itself (`besideMech`).
  const lends = !spec.controller && t.kind === 'drone' && !!t.droneBackpack && (t.partStates.backpack ?? 'intact') !== 'destroyed';
  const waypoints: LargeGrid[][] = [];
  if (carries && !flown) {
    const named = new Set<string>();
    const keep = (leg: LargeGrid[] | null): void => {
      if (!leg || leg.length < 2) return;
      const id = leg.map((x) => `${x.c},${x.r}`).join('>');
      if (!named.has(id)) { named.add(id); waypoints.push(leg); }
    };
    for (const [i, g] of grids.entries()) {
      const route = routes[i];
      if (!route || route.length < 2 || !turn.boxesOn(state, [g]).length) continue;
      keep(route);
      for (const [j, n] of grids.entries()) {
        const side = routes[j];
        if (Math.abs(n.c - g.c) + Math.abs(n.r - g.r) !== 1 || !side || side.length < 2) continue;
        if (side.some((x) => x.c === g.c && x.r === g.r)) continue;
        const leg = turn.extendRoute(data, state, t, side, g, start.steps, start.flying, spec.actionId);
        if (leg && leg.length === side.length + 1) keep(leg);
      }
    }
  }
  for (const [i, g] of grids.entries()) {
    const route = routes[i];
    if (!route || route.length < 2) continue;
    // Where the route drawn straight to this Grid passes no Box, the first
    // route by way of one that reaches it: worked out once for the four facings.
    let detour: LargeGrid[] | null | undefined;
    const byBox = (): LargeGrid[] | null => {
      if (detour !== undefined) return detour;
      detour = null;
      for (const leg of waypoints) {
        const on = turn.extendRoute(data, state, t, leg, g, start.steps, start.flying, spec.actionId);
        if (on && on.length > leg.length && on[on.length - 1].c === g.c && on[on.length - 1].r === g.r) { detour = on; break; }
      }
      return detour;
    };
    // The table once this Grid's Destructible Terrain has been crushed, and
    // where the crusher lands on it: worked out once for the four facings.
    let crushed: { destroy: Command; table: GameState; spot: { col: number; row: number } } | null = null;
    // The Mines this walk may Lay along its route with the Range it leaves
    // unspent (006_A): the offer travels with the answer, and the seat that
    // takes it remembers it (SeatMind.mines). Worked out once for the facings.
    const laying = layer ? turn.minesOnRoute(data, state, t, route, start.steps, start.flying) : null;
    const lay: { lay?: MineOffer } = laying
      ? { lay: { uid: t.uid, actionId: laying.actionId, cardId: laying.cardId, grids: laying.grids.map((x) => ({ c: x.c, r: x.r })), max: laying.max, route: route.map((x) => ({ c: x.c, r: x.r })), flight: flown } }
      : {};
    for (const f of FACINGS) {
      const order = turn.moveOrder(data, state, t, draft(route, f));
      if (order.kind !== 'route' || !order.command) break;
      // A tow is made on a walk that lands: not on one a Mine stops, nor in a
      // Crush (the Harpy flies, and makes neither).
      if (spec.tow && (order.cut > 0 || order.crushes)) break;
      // A walk a Mine stops: the stop is the answer, in the Mine's Grid,
      // whichever Grid beyond it the route was drawn to.
      if (order.cut > 0) {
        const spot = `${order.goal.c},${order.goal.r}:${f}`;
        const halt = order.halt ?? 0;
        if (!order.crushes && halt > (stopped.get(spot)?.halt ?? -1) && check(data, paid, order.command).ok) {
          stopped.set(spot, { command: order.command, halt, stop: order.goal, facing: f, grids: order.path.length - 1 });
        }
        continue;
      }
      // A unit steered by The Red Shoes ends in no Crush (audit Phase 3, D3).
      if (spec.controller && order.crushes) continue;
      // A CRUSH OF A UNIT: every way it may come out, each one whole answer
      // (crushWays), judged whole by the engine. Each names what became of
      // every unit it crushed (`way`), so two ways into one Grid are two plans.
      if (order.crushes && order.victims?.units.length) {
        const names = order.victims.units.map((v) => v.label).join(' and ');
        for (const way of crushWays(data, paid, t, order, spec)) {
          const commands = [...spec.prefix, ...way.commands];
          if (!tableAfter(data, state, commands)) continue;
          const end = { c: Math.floor(way.landed.col / 3), r: Math.floor(way.landed.row / 3) };
          const unitName = (uid: number): string => state.tokens.find((x) => x.uid === uid)?.label ?? String(uid);
          const what = [
            ...way.pushed.map((p) => `${unitName(p.uid)} pushed to ${gridName(p.to)}`),
            ...way.destroyed.map((u) => `${unitName(u)} destroyed`),
            ...way.exchanged.map((u) => `${unitName(u)} exchanging places with it`),
          ];
          const key = [...way.pushed.map((p) => `${p.uid}>${p.to.c},${p.to.r}`), ...way.destroyed.map((u) => `${u}x`), ...way.exchanged.map((u) => `${u}=`), ...(way.short ? ['short'] : [])].join(';');
          out.push({
            id: `move:${spec.key}:${g.c},${g.r}:${f}:crush:${key}`,
            label: way.short
              ? `${spec.name} toward ${gridName(g)}, crushing ${names} (${what.join(', ') || 'nobody moved'}), and stopping short in ${gridName(end)}, facing ${FACING_NAME[f]}`
              : `${spec.name} to ${gridName(g)}, crushing ${names} (${what.join(', ')}), facing ${FACING_NAME[f]}`,
            tags: ['move', ...spec.tags, `facing:${f}`, 'crush', 'crush-unit', ...(way.short ? ['short'] : []), ...(way.destroyed.length ? ['kill'] : [])],
            commands,
            facts: {
              uid: t.uid, to: end, facing: f, grids: way.short ? Math.max(0, route.length - 2) : route.length - 1, crush: true,
              crushed: order.victims.units.map((v) => v.uid), pushed: way.pushed, destroyed: way.destroyed, exchanged: way.exchanged, way: key,
              ...(way.short ? { short: true } : {}), ...(spec.actionId ? { actionId: spec.actionId } : {}), ...shoves(end, f),
            },
          });
        }
        continue;
      }
      // A Crush of Destructible Terrain alone.
      if (order.crushes) {
        const victims = order.victims;
        if (!victims || victims.units.length || !victims.terrain.length) break;
        if (!crushed) {
          const destroy = turn.crushDestroy({ seat: t.side, uid: t.uid }, victims.terrain.map((p) => p.id));
          const table = tableAfter(data, state, [...spec.prefix, destroy]);
          const mover = table?.tokens.find((x) => x.uid === t.uid);
          const spot = table && mover ? turn.crushLanding(data, table, mover, order.goal) : null;
          if (!table || !spot) break;
          crushed = { destroy, table, spot };
        }
        const record = turn.crushRecord(t, { free: spec.free, granted: spec.granted, facing: order.facing, actionId: spec.actionId, breakAwayLink: order.linkDue },
          crushed.spot, [...order.stops.slice(0, -1), crushed.spot]);
        if (!check(data, crushed.table, record).ok) continue;
        out.push({
          id: `move:${spec.key}:${g.c},${g.r}:${f}`,
          label: `${spec.name} to ${gridName(g)}, crushing the terrain there, facing ${FACING_NAME[f]}`,
          tags: ['move', ...spec.tags, `facing:${f}`, 'crush'],
          commands: [...spec.prefix, crushed.destroy, record],
          facts: { uid: t.uid, to: { c: g.c, r: g.r }, facing: f, grids: route.length - 1, crush: true, ...(spec.actionId ? { actionId: spec.actionId } : {}), ...shoves(g, f) },
        });
        continue;
      }
      if (!check(data, paid, order.command).ok) continue;
      // The drag the route can carry: none, and the route is no tow.
      const tow = towFor(route, order.command);
      if (spec.tow && !tow) break;
      const drag = tow?.commands ?? [];
      const drawn = watched && order.last ? turn.interceptsForMove(data, state, t, order.last) : [];
      const owes: Command[] = drawn.length ? [{ kind: 'queueIntercepts', seat: t.side, items: drawn }] : [];
      // It ends in a Mine's Grid, and sets the Mine off.
      const boom = mined.get(`${g.c},${g.r}`);
      // A Load lent from where it ends, to the Mech it would touch there.
      const lent = lends && order.last ? touchedMech(paid, t, g, order.last) : null;
      const facts = {
        uid: t.uid, to: { c: g.c, r: g.r }, facing: f, grids: route.length - 1, ...(spec.actionId ? { actionId: spec.actionId } : {}),
        ...(drawn.length ? { intercepts: drawn.length } : {}), ...(boom ? { mined: true, mine: boom } : {}), ...lay, ...shoves(g, f),
        ...(lent ? { lendsTo: lent.uid } : {}), ...(tow && spec.tow ? { towed: spec.tow.allyUid, funder: spec.tow.funderUid, towedTo: tow.to } : {}),
      };
      out.push({
        id: `move:${spec.key}:${g.c},${g.r}:${f}`,
        label: `${spec.name} to ${gridName(g)}, facing ${FACING_NAME[f]}${boom ? ', onto the Mine there' : ''}${tow ? `, and sets it down in ${gridName(tow.to)}` : ''}`,
        tags: ['move', ...spec.tags, `facing:${f}`, ...(drawn.length ? ['intercepted'] : []), ...(boom ? ['mined'] : [])],
        commands: [...spec.prefix, order.command, ...drag, ...owes],
        facts,
      });
      // THE SAME MOVEMENT, ITS BASE PUT AGAINST AN ALLY MECH'S, where the spot
      // it would take of itself touches none: a player sets the Carrier down
      // touching the Mech that uses its Load. The engine's own spot leans the
      // way the walk came in, and met the Mech only by chance (OTTO's
      // playtest, 2026-10-03: "The carrier drone also seems to be in the top
      // left corner not moving").
      const beside = lends && order.last && !boom && !spec.tow ? besideMech(data, paid, t, g, order.last) : null;
      if (beside && order.command.kind === 'maneuver') {
        const put: Command = { ...order.command, to: beside.spot, via: [...order.stops.slice(0, -1), beside.spot] };
        const drawnThere = watched ? turn.interceptsForMove(data, state, t, beside.spot) : [];
        if (check(data, paid, put).ok) {
          out.push({
            id: `move:${spec.key}:${g.c},${g.r}:${f}:lend`,
            label: `${spec.name} to ${gridName(g)}, facing ${FACING_NAME[f]}, against ${beside.mech.label}`,
            tags: ['move', ...spec.tags, `facing:${f}`, 'lend', ...(drawnThere.length ? ['intercepted'] : [])],
            commands: [...spec.prefix, put, ...(drawnThere.length ? [{ kind: 'queueIntercepts', seat: t.side, items: drawnThere } as Command] : [])],
            facts: { ...facts, lendsTo: beside.mech.uid, ...(drawnThere.length ? { intercepts: drawnThere.length } : {}) },
          });
        }
      }
      // The same Movement, picking up what it passed: kept when the engine
      // takes the whole of it.
      const takes = carries ? turn.boxTakes(data, state, t, route, flown) : [];
      if (takes.length) {
        if (tableAfter(data, state, [...spec.prefix, order.command, ...drag, ...takes])) {
          out.push({
            id: `move:${spec.key}:${g.c},${g.r}:${f}:take`,
            label: `${spec.name} to ${gridName(g)}, facing ${FACING_NAME[f]}, picking up ${takes.length === 1 ? 'the Black Box' : `${takes.length} Black Boxes`} on the way${tow ? `, and sets it down in ${gridName(tow.to)}` : ''}`,
            tags: ['move', ...spec.tags, `facing:${f}`, 'take', ...(drawn.length ? ['intercepted'] : []), ...(boom ? ['mined'] : [])],
            commands: [...spec.prefix, order.command, ...drag, ...takes, ...owes],
            facts: { ...facts, boxes: takes.length, taken: taken(takes) },
          });
        }
        continue;
      }
      // Or the same Grid by way of a Box the straight route does not pass: the
      // route a player draws with a waypoint on the Box's Grid.
      const around = waypoints.length ? byBox() : null;
      if (!around) continue;
      const turned = turn.moveOrder(data, state, t, draft(around, f));
      if (turned.kind !== 'route' || !turned.command || turned.cut > 0 || turned.crushes || !check(data, paid, turned.command).ok) continue;
      // A tow by way of the Box sets the Ally down behind that route's end.
      const towAround = towFor(around, turned.command);
      if (spec.tow && !towAround) continue;
      const dragAround = towAround?.commands ?? [];
      const fetched = turn.boxTakes(data, state, t, around, flown);
      if (!fetched.length || !tableAfter(data, state, [...spec.prefix, turned.command, ...dragAround, ...fetched])) continue;
      out.push({
        id: `move:${spec.key}:${g.c},${g.r}:${f}:take`,
        label: `${spec.name} to ${gridName(g)}, facing ${FACING_NAME[f]}, by way of ${fetched.length === 1 ? 'the Black Box' : `${fetched.length} Black Boxes`}, which it picks up${towAround ? `, and sets it down in ${gridName(towAround.to)}` : ''}`,
        tags: ['move', ...spec.tags, `facing:${f}`, 'take', ...(drawn.length ? ['intercepted'] : []), ...(boom ? ['mined'] : [])],
        commands: [...spec.prefix, turned.command, ...dragAround, ...fetched, ...owes],
        facts: { ...facts, grids: around.length - 1, boxes: fetched.length, taken: taken(fetched), lay: undefined, ...(towAround ? { towedTo: towAround.to } : {}) },
      });
    }
  }
  for (const s of stopped.values()) {
    out.push({
      id: `move:${spec.key}:${s.stop.c},${s.stop.r}:${s.facing}:halt`,
      label: `${spec.name} into the Mine in ${gridName(s.stop)}, which stops it there with ${s.halt} Grid${s.halt === 1 ? '' : 's'} to go on with, facing ${FACING_NAME[s.facing]}`,
      tags: ['move', ...spec.tags, `facing:${s.facing}`, 'mined', 'halt'],
      commands: [...spec.prefix, s.command],
      facts: {
        uid: t.uid, to: { c: s.stop.c, r: s.stop.r }, facing: s.facing, grids: s.grids, mined: true, halt: s.halt,
        ...(mined.has(`${s.stop.c},${s.stop.r}`) ? { mine: mined.get(`${s.stop.c},${s.stop.r}`) } : {}), ...(spec.actionId ? { actionId: spec.actionId } : {}),
        ...(shoveId ? { shovesLater: { uid: t.uid, actionId: shoveId } } : {}),
      },
    });
  }
  // Turning on the spot is a Movement in its own right and costs no Range: the
  // Maneuver may be spent on it, a quarter turn either way or a half. (Flown,
  // it is the same turn: the walked Maneuver's answers carry it.)
  if (spec.maneuver && !spec.fly && !spec.tow) {
    for (const f of FACINGS) {
      if (f === t.facing) continue;
      const quarter = (f - t.facing + 4) % 4;
      const order = turn.moveOrder(data, state, t, draft([here], f, quarter === 3 ? -1 : quarter));
      if (order.kind !== 'pivot' || !check(data, paid, order.command).ok) continue;
      out.push({
        id: `move:${spec.key}:turn:${f}`,
        label: `${spec.name}: turn to face ${FACING_NAME[f]}`,
        tags: ['move', ...spec.tags, 'pivot', `facing:${f}`],
        commands: [...spec.prefix, order.command],
        facts: { uid: t.uid, to: { c: here.c, r: here.r }, facing: f, grids: 0 },
      });
    }
  }
  return out;
}

// THE STEPS THAT BRING AN ATTACK TO BEAR: of a Maneuver's moves, those after
// which the unit could attack `targetUid`, by the turn panel's own readings of
// the table each move leaves (the Actions still live there, each one's line to
// that target). Nearest the target first, and no more than a few: the asker
// wants to know whether there is such a step, not every one. A move that ends
// out of every attack's Range, or with the target behind it, is passed over
// before the table is worked out.
function reaching(data: GameData, state: GameState, t: Token, o: Opportunity, moves: Option[], targetUid: number, starting = false): Option[] {
  const target = state.tokens.find((x) => x.uid === targetUid);
  if (!target || target.deployed === false || !alive(target)) return [];
  const at = largeGridOf(target);
  // (`starting`: the moves are a Movement Action's, the Starting Action of a
  // Movement dial, before which no attack is live: every attack the unit
  // carries is read for how far it reaches, and the table each move leaves
  // says whether one is live then, a few moves asked at most.)
  const attacks = turn.actionRows(data, state, t, o).filter((row) => (starting || row.v.ok) && turn.actionRoute(data, t, row.a) === 'attack');
  if (!attacks.length) return [];
  // How far the longest of them reaches: a Range of none is a Grid beside it.
  // As the attack would be built (turn.ts attackActionBuilt: a [Two-Handed]
  // rider, [Stationary]), not as printed: a Tactical Rifle held in two hands
  // reaches two Grids further, and every step from which only that reached was
  // passed over, so an enemy that would step out and shoot from there was
  // counted as no danger (a traced game, 2026-10-03: a Missile Artillery stood
  // in a VIP's rifle's reach at "cost 0.00" and was shot every round). A Range
  // the move then loses ([Stationary]) is judged on the table the move leaves.
  const far = Math.max(...attacks.map((row) => Math.max(actionRange(data, state.tokens, t, row.a), actionRange(data, state.tokens, t, turn.attackActionBuilt(data, state, t, row.a.id) ?? row.a)) || 1));
  const ends = moves
    .map((move) => ({ move, to: move.facts?.to as { c: number; r: number } | undefined, facing: move.facts?.facing as Facing | undefined }))
    .filter((x): x is { move: Option; to: { c: number; r: number }; facing: Facing } => !!x.to && x.facing !== undefined)
    .map((x) => ({ ...x, apart: Math.abs(x.to.c - at.c) + Math.abs(x.to.r - at.r), beside: Math.abs(x.to.c - at.c) <= 1 && Math.abs(x.to.r - at.r) <= 1 }))
    .filter((x) => (x.apart <= far || x.beside) && inArc({ ...t, col: x.to.c * 3, row: x.to.r * 3, facing: x.facing }, target, 'forward'))
    .sort((a, b) => a.apart - b.apart);
  const out: Option[] = [];
  let tried = 0;
  for (const { move } of ends) {
    if (out.length >= REACH_LIMIT || (starting && tried >= 2 * REACH_LIMIT)) break;
    tried += 1;
    const table = move.commands ? tableAfter(data, state, move.commands) : null;
    const mover = table?.tokens.find((x) => x.uid === t.uid);
    const opp = table?.script?.opp;
    if (!table || !mover || !opp || opp.uid !== t.uid) continue;
    const open = turn.actionRows(data, table, mover, opp).some((row) => row.v.ok
      && turn.actionRoute(data, mover, row.a) === 'attack'
      && turn.actionPayment(data, table, mover, row.a, row.key).ok
      && !!turn.attackLines(data, table, { uid: mover.uid, actionId: row.a.id, only: targetUid })?.lines.some((l) => !l.blocked && !l.hidden));
    if (open) out.push(move);
  }
  return out;
}

// THE ROADS TO THE ENEMY: for each enemy unit on the board, the Grids this
// unit would walk, in order, to stand beside it, however many Movements that
// takes (turn.ts roadTo: the route search its own Movement is drawn with, so
// terrain, Break Away, a leash and flight all count, and a Large Unit's road
// runs through the Destructible Terrain it would crush). A seat that wants to
// close on something reads the road instead of guessing at one: the nearest
// enemy as the crow flies may stand behind a wall. Empty for an enemy it
// already stands beside; absent for one it cannot reach, and for a unit that
// cannot move.
function roadsTo(data: GameData, state: GameState, t: Token): Record<string, { c: number; r: number }[]> {
  const start = turn.moveStart(data, state, t, { maneuver: true });
  if (!start.ok || start.steps <= 0) return {};
  const here = largeGridOf(t);
  const size = gridsOf(state);
  // Every Grid beside an enemy, asked for in one search of the board
  // (turn.ts roadsToAll): the road to each is the one roadTo finds.
  const foes = state.tokens.filter((foe) => foe.side !== t.side && foe.kind !== 'projectile' && foe.deployed !== false && alive(foe));
  const beside = foes.map((foe) => {
    const at = largeGridOf(foe);
    return [[0, -1], [1, 0], [0, 1], [-1, 0]].map(([dc, dr]) => ({ c: at.c + dc, r: at.r + dr })).filter((g) => g.c >= 0 && g.r >= 0 && g.c < size && g.r < size);
  });
  const goals = beside.flat();
  const roads = turn.roadsToAll(data, state, t, goals, start.flying);
  const out: Record<string, { c: number; r: number }[]> = {};
  let n = 0;
  for (const [i, foe] of foes.entries()) {
    let best: LargeGrid[] | null = null;
    for (const g of beside[i]) {
      const road = roads[n++];
      if (best && !best.length) continue;
      if (g.c === here.c && g.r === here.r) { best = []; continue; }
      if (road && (!best || road.length - 1 < best.length)) best = road.slice(1);
    }
    if (best) out[String(foe.uid)] = best.map((g) => ({ c: g.c, r: g.r }));
  }
  return out;
}

// A unit holding an activation: what it may do with it, and ending it.
function activationOwed(data: GameData, state: GameState, seat: Side, t: Token, want?: Want): Decision | null {
  const sc = state.script!;
  const o = sc.opp!;
  const options: (Option | null)[] = [];
  if (rebootOwed(state, t)) {
    // A Shutdown Mech whose Opportunity has come Reboots, and does nothing
    // else with it (4.1.1, FAQ K17).
    for (const stance of ['defensive', 'mobility', 'offensive'] as const) {
      options.push(sends(data, state, `reboot:${stance}`, `Reboot to ${stance} Stance`, ['reboot', `stance:${stance}`], [{ kind: 'reboot', seat, uid: t.uid, stance }]));
    }
    return ask('opp.reboot', seat, `${stamp(state)}:${t.uid}`, kept(options), 'reboot:defensive', { unit: t.uid });
  }
  if (state.round.phase === 2) {
    for (const x of wants(want, 'tied') ? tiedChoices(state, makeInit(data)) : []) {
      if (x.side === seat) options.push(sends(data, state, `tied:${x.uid}`, `${x.label} takes this turn instead`, ['tied'], [{ kind: 'chooseTied', seat, uid: x.uid }]));
    }
    if (wants(want, 'stance') && t.kind === 'mech' && !o.stanceLocked && t.stance !== 'shutdown') {
      for (const stance of ['defensive', 'mobility', 'offensive'] as const) {
        if (stance === t.stance) continue;
        options.push(sends(data, state, `stance:${stance}`, `${t.label}: ${stance} Stance`, ['stance', `stance:${stance}`], [{ kind: 'setStance', seat, uid: t.uid, stance }]));
      }
    }
  }
  // TICKS BOUGHT (M7.6): a pilot's Link for an Action Tick (FPA-04-2, FAQ L2),
  // an Overloading Pack's Link for Ticks, a Part's Tick for the Stance it asks
  // (Attack Mode). Each is one command in the Mech's own Opportunity, as the
  // turn panel sends it; the engine holds the rest (the Stance, which two of
  // them then fix; once an Opportunity; never the last Link; not after a
  // Reboot), and what it refuses is not offered.
  if (wants(want, 'tick') && t.kind === 'mech' && t.stance !== 'shutdown') {
    options.push(sends(data, state, 'tick:link', `${t.label}: a Link for an Action Tick`, ['tick', 'linkTick'], [{ kind: 'linkTick', seat, uid: t.uid }]));
    options.push(sends(data, state, 'tick:overload', `${t.label}: Overload, Link for Action Ticks`, ['tick', 'overload'], [{ kind: 'overload', seat, uid: t.uid }]));
    options.push(sends(data, state, 'tick:attack-mode', `${t.label}: Attack Mode, an Action Tick for its Stance`, ['tick', 'attackMode'], [{ kind: 'attackMode', seat, uid: t.uid }]));
    // FIREWATCH (ZPA-38): a Link for a Command Token as the Opportunity opens,
    // before the Mech Maneuvers or performs anything (the engine holds when).
    options.push(sends(data, state, 'tick:firewatch', `${t.label}: Firewatch, a Link for a Command Token`, ['tick', 'firewatch'], [{ kind: 'firewatch', seat, uid: t.uid }]));
  }
  // The Maneuver, or a Drone's Movement: the row the panel draws above the
  // Actions, live on the same reading (turn.ts maneuverVerdict).
  const reach = reachOf(want);
  if ((wants(want, 'move') || wants(want, 'maneuver') || reach !== null) && turn.maneuverVerdict(state, t, o).ok) {
    const moves = movementOptions(data, state, t, {
      key: 'maneuver', name: t.kind === 'mech' ? `${t.label}: Maneuver` : `${t.label}: move`, tags: ['maneuver'], prefix: [], maneuver: true,
    });
    // The same Maneuver flown, where an Ojs200 lends the flight: over terrain
    // and Melee Locks, and no Crush (FAQ E14). Its own answers, as the panel's
    // switch makes it a move of its own.
    const flown = movementOptions(data, state, t, {
      key: 'maneuver-fly', name: `${t.label}: Maneuver, flying`, tags: ['maneuver', 'fly'], prefix: [], maneuver: true, fly: true,
    });
    moves.push(...flown);
    // And the Harpy's Command Movement dragging an Ally along (`towMoves`).
    moves.push(...towMoves(data, state, t));
    options.push(...(reach === null ? moves : reaching(data, state, t, o, moves, reach)));
  }
  // The rest of a Movement a Mine stopped (ruling I16, M19): the Go on, with
  // the Range that Movement kept, once the Mine's blast is resolved (the
  // engine holds it until then) and unless the blast took the Chassis.
  if ((o.mineHalt ?? 0) > 0 && (wants(want, 'move') || wants(want, 'maneuver'))) {
    options.push(...movementOptions(data, state, t, { key: 'goon', name: `${t.label}: go on`, tags: ['resume'], prefix: [], range: o.mineHalt, resume: true }));
  }
  options.push(...actionOptions(data, state, seat, t, want));
  if (wants(want, 'coordinate')) options.push(...coordinationOptions(data, state, t, o));
  // A folded Pholcus "must" Unfold in the Delay Phase (FAQ M18.3). A strict
  // table refuses the end of its activation before it has (since 2026-10-03;
  // it took it, and the phase could then never be left), and a Teaching one
  // takes it, so ending is not an answer while the Unfold is on offer.
  const folded = options.some((x) => !!x && x.tags[0] === 'unfold');
  if (wants(want, 'end') && !folded) {
    const end: Command = { kind: 'endOpportunity', seat, uid: t.uid };
    options.push(sends(data, state, 'end', state.round.phase === 2 ? 'End this Opportunity' : 'End this activation', ['end'], [end]));
    // An activation that ends in a loose Black Box's Grid may pick it up as it
    // ends (3.4.4, 5.3.1, FAQ P8).
    const underfoot = turn.boxTakes(data, state, t, [largeGridOf(t)]);
    if (underfoot.length) {
      const o = sends(data, state, 'end:take', `Pick up ${underfoot.length === 1 ? 'the Black Box' : `${underfoot.length} Black Boxes`} in its Grid, and end`, ['end', 'take'], [...underfoot, end]);
      if (o) options.push({ ...o, facts: { uid: t.uid, boxes: underfoot.length, taken: taken(underfoot) } });
    }
  }
  const live = kept(options);
  // (A Command handed out in between leaves the Opportunity as it was: the
  // Drones it has commanded tell the two questions apart.)
  const spent = `${o.maneuver}:${o.action}:${o.performed.length}:${o.spentExtras.length}:${o.maneuvered ? 1 : 0}:${o.stanceLocked ? 1 : 0}:${t.stance}:${coordinated(state, t)}`;
  // The roads are worth their search only while the unit may still move, and
  // only to a seat that must answer: an asker looking ahead wants none.
  const mobile = !want?.only && live.some((x) => x.tags.includes('move'));
  return ask(state.round.phase === 2 ? 'opp.act' : 'activation.act', seat, `${stamp(state)}:${t.uid}:${spent}`, live, 'end',
    { unit: t.uid, facts: mobile ? { roads: roadsTo(data, state, t) } : {} });
}

// ---------- Command Coordination (4.15.3) ----------
//
// "May immediately issue X Commands to Ally Drones." A Mech that has just
// performed an Action carrying Command Coordination (most of a GoF Mech's do)
// hands a Command Token it kept face-up to a Drone that bears none, and the
// Drone acts at once, in an activation nested inside the Mech's own, as it
// would on a Command in the Command Phase (commands.ts coordinateCommand). The
// Match Centre asks in a dialog as the Action lands, and for an attack once
// the attack is over (matchhud.ts offerCoordinationFor; FAQ 1.04 C8, C9); the
// nested activation is then asked of the Drone's seat like any other.
//
// THE COUNT IS THE SENDER'S TO KEEP. The engine holds only that something this
// Mech did in its Opportunity carries Coordination, and takes a second and a
// third Command while there are Tokens. So it is kept here, off the table: an
// answer is offered while the LAST thing the Mech did allows one (the Action
// last performed; the Maneuver, for a Dragoon's A2K Data Link, while no Action
// has been) and it has handed out fewer than everything it has done allows.
// The Drones it has commanded since the Command Phase are the ones that bear
// its Token now: that phase's Tokens were taken off as it ended.
//
// SWARM TACTICS (172_B, the Warrior): the Token given to a GoF Medium Drone may
// go on to another Drone for nothing (script.swarm), which is one more answer
// while it stands.
function coordinated(state: GameState, t: Token): number {
  return state.tokens.filter((x) => x.kind === 'drone' && x.commandedBy === t.uid && (x.statuses ?? []).includes('commandUsed')).length;
}

function coordinationOptions(data: GameData, state: GameState, t: Token, o: Opportunity): Option[] {
  if (t.kind !== 'mech' || PHASES[state.round.phase] !== 'Action' || o.uid !== t.uid) return [];
  const acts = tokenCards(data, t).flatMap(({ card }) => card.actions ?? []);
  const allowed = (key: string): number => {
    const a = acts.find((x) => x.id === actionIdOf(key));
    return a ? coordinationFor(data, t, a) : 0;
  };
  const stepped = o.maneuvered ? coordinationAfterManeuver(data, t) : 0;
  const last = o.performed.at(-1);
  const now = last !== undefined ? allowed(last) : stepped;
  const all = o.performed.reduce((n, key) => n + allowed(key), 0) + stepped;
  const swarm = state.script?.swarm?.issuer === t.uid;
  if (!swarm && Math.min(now, all - coordinated(state, t)) <= 0) return [];
  const out: Option[] = [];
  for (const x of state.tokens) {
    if (x.kind !== 'drone' || x.side !== t.side || x.deployed === false || !alive(x)) continue;
    const o2 = sends(data, state, `coordinate:${x.uid}`, `${t.label}: Command Coordination, a Command to ${x.label}`, ['coordinate'],
      [{ kind: 'coordinateCommand', seat: t.side, uid: t.uid, targetUid: x.uid }]);
    if (o2) out.push({ ...o2, facts: { uid: t.uid, targetUid: x.uid } });
  }
  return out;
}

// What the unit holding the activation may perform: every Action its panel
// would draw live (turn.ts actionRows), opened the way the panel opens it
// (actionRoute). Each option is one whole answer: the Action, and what it is
// done to.
function actionOptions(data: GameData, state: GameState, seat: Side, t: Token, want?: Want): Option[] {
  const o = state.script?.opp;
  if (!o) return [];
  const out: Option[] = [];
  // The kind of answer each route makes (a Detonation on a unit is an attack).
  const KIND: Record<string, string[]> = {
    attack: ['attack'], launch: ['launch', 'recover'], charge: ['charge'], stabilise: ['stabilise'], detonate: ['detonate', 'attack'], electronic: ['electronic'], move: ['move'], terminal: ['terminal'], unfold: ['unfold'],
    transform: ['mode'], selfStatus: ['token'], targetStatus: ['token'], camo: ['token'], overwatch: ['overwatch'], discard: ['discard'], blink: ['blink'],
    stanceFeedback: ['support'], resupply: ['support'], link: ['support'], cleanup: ['support'], repair: ['support'],
    card: ['coordinate', 'grant', 'stance'], form: ['move', 'form'],
  };
  // One enemy named: the attacks on it alone, an Explosion on it among them.
  const struck = strikeOf(want);
  const strikes = (route: string): boolean => struck !== null && (route === 'attack' || route === 'detonate');
  // One enemy to step out at by a Movement Action besides the Maneuver.
  const reachAll = reachAllOf(want);
  for (const row of turn.actionRows(data, state, t, o)) {
    const name = row.a.name?.en || row.a.id;
    const route = turn.actionRoute(data, t, row.a);
    if (want?.only && !(KIND[route] ?? []).some((kind) => wants(want, kind)) && !strikes(route) && !(route === 'move' && reachAll !== null)) continue;
    // A Volley under way: the Action is paid and performed, so its row is no
    // longer live, and the shots it has left ride on that payment (4.7.3).
    if (route === 'launch' && !row.v.ok && (o.launched ?? []).some((x) => x.actionId === row.a.id)) {
      out.push(...launchOptions(data, state, t, row, [], name, true, !!want?.only));
      continue;
    }
    // A Detonation under way: the Missile has paid for its Action and flown,
    // and the Interception its flight owed has been made (4.9). The Explosion
    // is what is left of it, and it rides on that payment.
    if (route === 'detonate' && !row.v.ok && fliesToTarget(row.a) && (o.performed.includes(row.key) || o.performed.includes(row.a.id))) {
      out.push(...detonationOptions(data, state, t, row, null, name, true)
        .filter((x) => wants(want, 'detonate') || (!!x.run && (wants(want, 'attack') || x.facts?.targetUid === struck))));
      continue;
    }
    if (!row.v.ok) continue;
    const pay = turn.actionPayment(data, state, t, row.a, row.key);
    if (!pay.ok) continue;
    if (route === 'launch') out.push(...launchOptions(data, state, t, row, pay.cmd ? [pay.cmd] : [], name, false, !!want?.only));
    if (route === 'attack') {
      const narrowed = struck !== null && !wants(want, 'attack');
      const reading = turn.attackLines(data, state, { uid: t.uid, actionId: row.a.id, ...(narrowed ? { only: struck } : {}) });
      if (!reading) continue;
      for (const target of reading.lines) {
        if (target.blocked) continue;
        const tags = ['attack', (row.a.type ?? '').toLowerCase(), ...(row.a.speed === 'auto' ? ['automatic'] : [])];
        const facts = { uid: t.uid, targetUid: target.t.uid, actionId: row.a.id };
        const paid: Command[] = pay.cmd ? [pay.cmd] : [];
        // A UNIT IN OPTICAL CAMOUFLAGE is designated through ONE FREE SCAN
        // (4.12.2; FAQ I11, I12): the Action is paid for, and the Counter-roll
        // it opens carries the attack behind it. Won, the target Reveals (its
        // own player says where it appears) and the attack resumes against it
        // as a reaction owed to the attacker (`scanAttack`, below); lost, the
        // attack is over and its Ticks are spent. It is designated only where
        // the attack could be made on its marker (the engine holds the free
        // Scan to the Action's own Range and arc), and judged again where it
        // appears. The answer is commands and no routine: the dice are the
        // Counter-roll's.
        if (target.hidden) {
          const scan: Command = { kind: 'startCounterRoll', seat: t.side, uid: t.uid, actionId: 'COMMON_SCAN', targetUid: target.t.uid, thenAttack: { actionId: row.a.id } };
          const o2 = paid.length ? sends(data, state, `attack:${row.key}:${target.t.uid}:scan`, `${name} at ${target.t.label}, in Optical Camouflage: one free Scan first`, [...tags, 'hidden'], [...paid, scan]) : null;
          if (o2) out.push({ ...o2, facts: { ...facts, hidden: true } });
          continue;
        }
        out.push({
          id: `attack:${row.key}:${target.t.uid}`,
          label: `${name} at ${target.t.label}`,
          tags,
          run: { routine: 'attack', args: { uid: t.uid, actionId: row.a.id, targetUid: target.t.uid, mode: 'attack', before: paid } },
          facts,
        });
        // A face-up Charge Token on the Action's own Part may be spent on it
        // (4.14): flipped down first, then the Action is paid, and the attack
        // is made with its [Charged] line. An either/or line is spent on one
        // of its arms.
        if (row.charge?.charged && row.slot) {
          const spend: Command = { kind: 'setCharge', seat: t.side, uid: t.uid, slot: String(row.slot), on: false };
          const arms = chargeChoices(row.a);
          for (const arm of arms.length ? arms : [null]) {
            out.push({
              id: `attack:${row.key}:${target.t.uid}:charged${arm ? `:${arm.id}` : ''}`,
              label: `${name} at ${target.t.label}, spending the Charge${arm ? ` on ${arm.label}` : ''}`,
              tags: [...tags, 'spend-charge'],
              run: { routine: 'attack', args: { uid: t.uid, actionId: row.a.id, targetUid: target.t.uid, mode: 'attack', charged: true, ...(arm ? { chargeChoice: arm.id } : {}), before: [spend, ...paid] } },
              facts: { ...facts, charged: true },
            });
          }
        }
      }
      // SHOCK ATTACK X (turn.ts shockWalk): the walk before the attack, as the
      // Match Centre makes it ("Move first", matchhud.ts shockmove): the Action
      // paid, the free Movement it owes made, and the attack from where that
      // ends, on the table the walk leaves. One answer each end Grid and target;
      // not a walk that sets a Mine off, owes an Interception, picks up a Box,
      // or crushes a unit (each has a question of its own to answer). Tagged
      // `shock`, with the Grid it ends in (`to`) and its facing.
      const shock = pay.cmd ? turn.shockWalk(state, t, row.a) : 0;
      if (shock > 0 && pay.cmd) {
        const walkName = `${name}: Shock Attack`;
        const walks = movementOptions(data, state, t, { key: `shock:${row.key}`, name: walkName, tags: ['shock'], prefix: [pay.cmd], actionId: row.a.id, range: shock, free: true });
        for (const w of walks) {
          if (['mined', 'intercepted', 'take', 'crush-unit', 'halt', 'tow', 'lend', 'pivot'].some((x) => w.tags.includes(x))) continue;
          const walked = w.commands?.length ? tableAfter(data, state, w.commands) : null;
          if (!walked) continue;
          const reading = turn.attackLines(data, walked, { uid: t.uid, actionId: row.a.id, ...(narrowed ? { only: struck } : {}) });
          for (const target of reading?.lines ?? []) {
            if (target.blocked || target.hidden) continue;
            out.push({
              id: `attack:${row.key}:${target.t.uid}:${w.id}`,
              label: `${name} at ${target.t.label}, after a Shock Attack walk${w.label.slice(walkName.length)}`,
              tags: ['attack', (row.a.type ?? '').toLowerCase(), 'shock'],
              run: { routine: 'attack', args: { uid: t.uid, actionId: row.a.id, targetUid: target.t.uid, mode: 'attack', before: w.commands } },
              facts: { uid: t.uid, targetUid: target.t.uid, actionId: row.a.id, to: w.facts?.to, facing: w.facts?.facing },
            });
          }
        }
      }
    }
    // Charging is the whole Action: its payment, named for the Part Charged,
    // turns that Part's token face-up. One Part per Charge Action, and only
    // one whose token is still face-down (4.14).
    if (route === 'charge' && pay.cmd && pay.cmd.kind === 'performAction') {
      for (const part of chargeableSlots(data, t).filter((x) => !x.charged)) {
        const o2 = sends(data, state, `charge:${row.key}:${part.slot}`, `${name}: ${part.label}`, ['charge'], [turn.chargePayment(pay.cmd, String(part.slot))]);
        if (o2) out.push({ ...o2, facts: { uid: t.uid, slot: String(part.slot) } });
      }
    }
    // Stabilize System (6.1): one Square or Hexagon Token off, or every Token
    // kept and the Link alone, each judged as it will stand once the Action is
    // paid.
    if (route === 'stabilise') {
      const question = stabiliseAsk(data, t);
      const answers: [string, string, string[], Command][] = question.picks.map((p) =>
        [`stabilise:${p.id}`, `${name}: ${stabiliseRowLabel(p)}`, ['stabilise', 'remove-token'], turn.stabiliseCommand(t, p)]);
      if (question.keep || !question.picks.length) answers.push(['stabilise:keep', `${name}: ${STABILISE_KEEP_LABEL}`, ['stabilise', 'restore-link'], turn.stabiliseCommand(t, null)]);
      for (const [id, label, tags, cmd] of answers) {
        const o2 = sends(data, state, id, label, tags, pay.cmd ? [pay.cmd, cmd] : [cmd]);
        if (o2) out.push({ ...o2, facts: { uid: t.uid } });
      }
    }
    // A Projectile's Delayed Action (3.6.2). An asker that wants the attacks
    // alone is given the Explosions, and not the answer that finds no target.
    if (route === 'detonate') {
      out.push(...detonationOptions(data, state, t, row, pay.cmd, name)
        .filter((x) => wants(want, 'detonate') || (!!x.run && (wants(want, 'attack') || x.facts?.targetUid === struck))));
    }
    // A folded Pholcus becomes its Drone form in place (FAQ M18): the Action is
    // paid and it Unfolds, and what it owes for coming up in an occupied Grid
    // is asked of its owner once it has (blastOwed, below).
    if (route === 'unfold') {
      const unfold: Command = { kind: 'unfold', seat: t.side, uid: t.uid };
      const o2 = sends(data, state, `unfold:${row.key}`, `${t.label} Unfolds`, ['unfold'], pay.cmd ? [pay.cmd, unfold] : [unfold]);
      if (o2) out.push({ ...o2, facts: { uid: t.uid } });
    }
    // An Electronic Attack or a Scan opens a Counter-roll on one enemy its
    // panel would list live (turn.ts electronicReading); an Action on every
    // enemy in Range opens on the first, and the engine queues the rest. The
    // exchange itself is answered in its own window, by both seats.
    if (route === 'electronic') {
      const reading = turn.electronicReading(data, state, t.uid, row.a.id);
      if (!reading) continue;
      const targets = reading.all ? reading.all.slice(0, 1) : reading.rows.filter((x) => !x.why).map((x) => x.t);
      for (const target of targets) {
        const open = turn.electronicOpening(t, row.a.id, target.uid);
        const o = sends(data, state, `electronic:${row.key}:${target.uid}`, reading.all && reading.all.length > 1 ? `${name} at every enemy in Range` : `${name} at ${target.label}`,
          ['electronic', ...(reading.scan ? ['scan'] : []), ...(row.a.speed === 'auto' ? ['automatic'] : [])], pay.cmd ? [pay.cmd, open] : [open]);
        if (o) out.push({ ...o, facts: { uid: t.uid, targetUid: target.uid, actionId: row.a.id } });
      }
    }
    // Remote Access (5.3.3, p.87): a Counter-roll against a Terminal whose
    // Tactical Zone is within the Action's Range and that nobody has accessed
    // this round, one answer for each. The attempt is paid for whatever the
    // roll; the roll is answered where every Counter-roll is, the Terminal's
    // dice thrown by the other squad, and a win accesses it.
    if (route === 'terminal') {
      const items = normaliseTasks(state.tasks).items;
      const zones = zonesOf(data.zoneData.zones, state);
      for (const item of terminalsInReach(items, t, row.a.range ?? 4, state.noBoard ? null : zoneCellsOf(data, state))) {
        const open: Command = { kind: 'startCounterRoll', seat: t.side, uid: t.uid, actionId: row.a.id, targetUid: TERMINAL_UID, terminal: item.id };
        const o2 = sends(data, state, `terminal:${row.key}:${item.id}`, `${name}: the Terminal in ${zones.find((z) => z.id === item.zone)?.name ?? item.zone}`,
          ['terminal', 'electronic'], pay.cmd ? [pay.cmd, open] : [open]);
        if (o2) out.push({ ...o2, facts: { uid: t.uid, actionId: row.a.id, zone: item.zone, itemId: item.id } });
      }
    }
    // A Movement Action: its own Range, paid for with its Ticks, and the move
    // it buys rides on the payment.
    if (route === 'move') {
      const moves = movementOptions(data, state, t, {
        key: row.key, name: `${t.label}: ${name}`, tags: ['action', 'moving'], prefix: pay.cmd ? [pay.cmd] : [], ...turn.actionMove(row.a),
      });
      out.push(...(reachAll !== null && !wants(want, 'move') ? reaching(data, state, t, o, moves, reachAll, true) : moves));
    }
    // The Bit's Stance Change: the card turned over, and the walk it owes.
    if (route === 'form') out.push(...formOptions(data, state, t, row, pay.cmd, name));
    out.push(...settledOptions(data, state, t, row, route, pay.cmd));
  }
  return out;
}

// THE "WHITE DWARF" BIT'S STANCE CHANGE (293_B, 294_B, 295_B: one Drone printed
// on three cards, one per Stance; units.ts formSwitch): "Switch the Stance and
// perform one movement". The Action paid for, the card turned over
// (`switchForm`), and the one Movement the Action leaves owed (`opp.moveOwed`),
// free, made by the card it has switched to: each face moves by its own card
// (294, Mobility, 8 Grids; the others 6), so the walk is worked out on the
// table after the switch. And the switch with no walk after it: the Movement
// is the Action's to make or to leave. The Match Centre asks the face in a
// panel and then opens its planner on the same free Movement (matchhud.ts
// formPanel, `data-formgo`). Every answer names the face it turns to (`into`):
// two faces that end in one Grid are two different plans.
function formOptions(data: GameData, state: GameState, t: Token, row: turn.ActionRow, pay: Command | null, name: string): Option[] {
  const a = row.a;
  const seat = t.side;
  const out: Option[] = [];
  for (const id of formSwitch(a) ?? []) {
    const card = id !== t.cardId ? data.byId.get(id) : undefined;
    if (!card) continue;
    const swap: Command = { kind: 'switchForm', seat, uid: t.uid, actionId: a.id, cardId: id };
    const prefix: Command[] = pay ? [pay, swap] : [swap];
    const face = cardName(card);
    const here = largeGridOf(t);
    const stay = sends(data, state, `form:${row.key}:${id}`, `${t.label}: ${name}, to ${face}, where it stands`, ['form', 'stay', `into:${id}`], prefix);
    if (!stay) continue;
    out.push({ ...stay, facts: { uid: t.uid, actionId: a.id, into: id, to: { c: here.c, r: here.r }, facing: t.facing } });
    const after = tableAfter(data, state, prefix);
    const turned = after?.tokens.find((x) => x.uid === t.uid);
    if (!after || !turned) continue;
    const walks = movementOptions(data, after, turned, { key: `form:${row.key}:${id}`, name: `${t.label}: ${name}, to ${face}, and its Movement`, tags: ['form', `into:${id}`], prefix: [], actionId: a.id, free: true });
    for (const o of walks) out.push({ ...o, commands: [...prefix, ...(o.commands ?? [])], facts: { ...o.facts, into: id } });
  }
  return out;
}

// THE ACTIONS THAT ARE SETTLED AS THEY ARE PAID FOR: no dice and no window,
// only what the Action is done to. The Match Centre asks each in a small panel
// or a dialog of its own (matchhud.ts routeAction) and then sends a command or
// two; here each is one whole answer, read off the same readers the panels
// list their rows from (units.ts), so what a panel would grey is not offered.
//   a Mode change (287_B, 288_B: the Part turned over to its other face);
//   a Token the unit gives itself (Ambush: Low Profile; Amplify Profile:
//     Highlight), not one it already bears (FAQ J1);
//   a Token put on a unit it picks (Target Tag: Highlight, in Range and sight);
//   Stance feedback (ZHDR-206_B: an Ally Mech in Range to another Stance);
//   Discard (6.1, 4.17: one Handheld Part turned over to its Discard Card,
//     named in the Action's own payment);
//   Resupply (086_A: Ammo back to itself or an Ally in reach that has spent it);
//   Link support (018_B every Ally Mech in Range, 504_A one of them; and a Link
//     Beacon's Delayed Action, 075_A, which is its turn whether or not anybody
//     gains by it: 4.7.5);
//   a Token cleaned off an Ally Unit in Range (504_B, TM31RS_B: which unit,
//     and which Token);
//   Repair (001_A: a Repaired Token on a destroyed Part of its own, or a
//     Damaged one mended; ZYDR-108_B: an Ally's Damaged Part mended).
// An Action that could change nothing is not offered: it cannot be performed
// (FAQ H2).
function settledOptions(data: GameData, state: GameState, t: Token, row: turn.ActionRow, route: turn.ActionRoute, pay: Command | null): Option[] {
  const a = row.a;
  const seat = t.side;
  const name = a.name?.en || a.id;
  const paid: Command[] = pay ? [pay] : [];
  const noBoard = !!state.noBoard;
  const out: Option[] = [];
  const offer = (id: string, label: string, tags: string[], commands: Command[], facts: Record<string, unknown> = {}): void => {
    const o = commands.length ? sends(data, state, id, label, tags, commands) : null;
    if (o) out.push({ ...o, facts: { uid: t.uid, actionId: a.id, ...facts } });
  };
  const tokenName = (statusId: string): string => STATUSES.find((x) => x.id === statusId)?.label ?? statusId;
  const whom = (x: Token): string => (x.uid === t.uid ? 'itself' : x.label);
  if (route === 'transform') {
    const mode = transformOffer(data, t, a);
    if (mode) {
      offer(`mode:${row.key}`, `${t.label}: ${name}, ${cardName(mode.from)} becomes ${cardName(mode.into)}`, ['mode'],
        [...paid, { kind: 'transformPart', seat, uid: t.uid, slot: mode.slot, cardId: mode.into.id }], { slot: mode.slot, into: mode.into.id });
    }
  }
  if (route === 'selfStatus') {
    const grant = selfStatusGrant(a);
    if (grant && !selfGrantWhy(t, grant)) {
      offer(`token:${row.key}`, `${t.label}: ${name}, a ${tokenName(grant.statusId)} Token`, ['token', 'self', `token:${grant.statusId}`],
        [...paid, { kind: 'applyStatus', seat, uid: t.uid, targetUid: t.uid, statusId: grant.statusId, stacks: grant.stacks }], { targetUid: t.uid, statusId: grant.statusId });
    }
  }
  // AN EXTRA ACTION OPPORTUNITY HANDED TO AN ALLY MECH (009_A Coordinate; FAQ
  // K3, K21): the Action paid for and the grant, an answer for each Ally Mech
  // the engine takes (its Range, the Link the card asks of the Mech chosen, not
  // the Mech itself). The Mech chosen loses the Link and acts at once, in an
  // Opportunity nested inside this one on its own dial's Timing; this one
  // resumes when it ends, and the Mech still takes its own turn (K19). The
  // Match Centre asks it in a panel of Ally Mechs (matchhud.ts grantPanel).
  const grant = route === 'card' ? extraActivationOf(a) : undefined;
  if (grant) {
    for (const x of state.tokens) {
      if (x.side !== seat || x.kind !== 'mech' || !alive(x) || x.deployed === false) continue;
      offer(`grant:${row.key}:${x.uid}`, `${t.label}: ${name}, an Extra Action Opportunity for ${x.label}`, ['grant'],
        [...paid, { kind: 'grantExtra', seat, uid: x.uid, linkCost: grant.linkCost }], { targetUid: x.uid, linkCost: grant.linkCost });
    }
  }
  // AN ACTION THAT SWITCHES THE MECH'S OWN STANCE (045_B Barricade): the
  // payment is the whole of it, the engine switching the Stance as the Action
  // is performed. It is the one way to a Stance once the Stance is fixed for
  // the Opportunity. A Mech already in it is not offered it (FAQ H2).
  const shift = route === 'card' ? selfStanceShift(a) : null;
  if (shift && t.stance !== shift) {
    offer(`stance-act:${row.key}`, `${t.label}: ${name}, to ${shift} Stance`, ['stance', `stance:${shift}`, 'action'], [...paid], { stance: shift });
  }
  // THE KK9's OVERWATCH STRIKE (LHDR-KK9_B): "Designate 1 Enemy Unit within
  // range as the target, allow 1 Ally Mech to immediately perform 1 Firing
  // Action against it. Then remove this Drone." An answer for each enemy and
  // each Ally Mech the engine takes: the Action paid for and the call, which
  // removes the KK9 and leaves the Mech its Firing Action owed, a reaction of
  // its seat's (reactionOwed, `overwatch`). The Match Centre lists every Ally
  // Mech not in Shutdown, whether or not one of its guns reaches; so does this.
  if (route === 'overwatch') {
    for (const foe of state.tokens) {
      if (foe.side === seat || foe.deployed === false || !alive(foe)) continue;
      for (const mech of state.tokens) {
        if (mech.side !== seat || mech.kind !== 'mech' || !alive(mech)) continue;
        offer(`overwatch:${row.key}:${foe.uid}:${mech.uid}`, `${t.label}: ${name} on ${foe.label}, ${mech.label} to fire`, ['overwatch'],
          [...paid, { kind: 'overwatch', seat, uid: t.uid, actionId: a.id, targetUid: foe.uid, mechUid: mech.uid }], { targetUid: foe.uid, mechUid: mech.uid });
      }
    }
  }
  // "Activate Optical Camouflage, Stealth X" (096_B, 247_B, ZYBP-201_A; 4.12.2):
  // the Action paid for and the State put on the unit itself, as the Match
  // Centre sends it. A unit already in it is not offered it: it could change
  // nothing (FAQ H2).
  if (route === 'camo' && statusCount(t.statuses, 'camouflage') === 0) {
    offer(`token:${row.key}`, `${t.label}: ${name}`, ['token', 'self', 'token:camouflage'],
      [...paid, { kind: 'applyStatus', seat, uid: t.uid, targetUid: t.uid, statusId: 'camouflage' }], { targetUid: t.uid, statusId: 'camouflage' });
  }
  // PROTOTYPE BLINK (555_B; FAQ E17, E20): the unit exchanges positions with a
  // Ground Mech of its own size within Range, enemy or allied. Teleportation,
  // so there is no route and nothing between matters; Forced Movement, so this
  // squad sets BOTH facings. An answer for each Mech the engine takes and each
  // pair of facings: the Action paid for and the one command the Match Centre
  // sends (matchhud.ts blinkFace), weighed as a move to where the other stood.
  // The swap is checked once a Mech: the facings change nothing of whether the
  // engine takes it.
  if (route === 'blink') {
    for (const x of blinkTargets(data, state.tokens, t, a, noBoard)) {
      const to = largeGridOf(x);
      const swap = (facing: Facing, targetFacing: Facing): Command => ({ kind: 'blink', seat, uid: t.uid, actionId: a.id, targetUid: x.uid, facing, targetFacing });
      if (!sends(data, state, 'blink', '', [], [...paid, swap(t.facing, x.facing)])) continue;
      for (const facing of [0, 1, 2, 3] as Facing[]) {
        for (const targetFacing of [0, 1, 2, 3] as Facing[]) {
          out.push({
            id: `blink:${row.key}:${x.uid}:${facing}:${targetFacing}`,
            label: `${t.label}: ${name}, places exchanged with ${x.label}, facing ${FACING_NAME[facing]}, ${x.label} facing ${FACING_NAME[targetFacing]}`,
            tags: ['blink', x.side === seat ? 'ally' : 'enemy', `facing:${facing}`],
            commands: [...paid, swap(facing, targetFacing)],
            facts: { uid: t.uid, actionId: a.id, targetUid: x.uid, to: { c: to.c, r: to.r }, facing, targetFacing },
          });
        }
      }
    }
  }
  if (route === 'targetStatus') {
    const tag = targetStatusGrant(a);
    const units = tag ? targetStatusTargets(data, state.tokens, t, a, tag, noBoard ? undefined : { terrain: turn.terrainOf(data, state), smoke: state.smoke ?? [] }) : [];
    for (const x of units) {
      offer(`token:${row.key}:${x.uid}`, `${t.label}: ${name}, a ${tokenName(tag!.statusId)} Token on ${x.label}`, ['token', x.side === seat ? 'ally' : 'enemy', `token:${tag!.statusId}`],
        [...paid, { kind: 'applyStatus', seat, uid: t.uid, targetUid: x.uid, statusId: tag!.statusId, stacks: tag!.stacks }], { targetUid: x.uid, statusId: tag!.statusId });
    }
  }
  if (route === 'stanceFeedback') {
    for (const x of stanceFeedbackTargets(data, state.tokens, t, a, noBoard)) {
      for (const stance of ['defensive', 'mobility', 'offensive'] as const) {
        if (stance === x.stance) continue;
        offer(`feedback:${row.key}:${x.uid}:${stance}`, `${t.label}: ${name}, ${x.label} to ${stance} Stance`, ['support', 'feedback', `to:${stance}`],
          [...paid, { kind: 'stanceFeedback', seat, uid: t.uid, actionId: a.id, targetUid: x.uid, stance }], { targetUid: x.uid, stance });
      }
    }
  }
  if (route === 'discard' && pay?.kind === 'performAction') {
    for (const d of discardSlots(data, t)) {
      offer(`discard:${d.slot}`, `${t.label}: ${name}, ${cardName(d.card)} becomes ${cardName(d.into)}`, ['discard'],
        [{ ...pay, partKey: `${a.id}@${d.slot}` }], { slot: d.slot, into: d.into.id });
    }
  }
  if (route === 'resupply') {
    const rule = resupplyOf(a);
    for (const x of rule ? resupplyHolders(data, state.tokens, t, rule, noBoard) : []) {
      offer(`resupply:${row.key}:${x.uid}`, `${t.label}: ${name}, Ammo to ${whom(x)}`, ['support', 'resupply'],
        [...paid, { kind: 'restoreAmmo', seat: x.side, uid: x.uid, actionId: rule!.actionId, amount: rule!.amount }], { targetUid: x.uid });
    }
  }
  if (route === 'link') {
    const rule = linkSupportOf(a);
    const short = rule ? linkSupportTargets(data, state.tokens, t, a, noBoard) : [];
    // As much as the Action gives and no more than the Mech is short of: a
    // Link it cannot hold is refused, and would take the whole answer with it.
    const to = (list: Token[]): Command[] => list.flatMap((x) =>
      Array.from({ length: Math.min(rule!.amount, maxLink(data, x) - (x.link ?? 0)) }, (): Command => ({ kind: 'recoverLink', seat, uid: t.uid, targetUid: x.uid, actionId: a.id })));
    if (rule?.selection === 'all') {
      if (short.length || t.kind === 'projectile') {
        offer(`link:${row.key}`, `${t.label}: ${name}${short.length ? `, Link to ${short.map(whom).join(', ')}` : ', and nobody in Range is short of Link'}`, ['support', 'link'],
          [...paid, ...to(short)], { targets: short.map((x) => x.uid), links: to(short).length });
      }
    } else if (rule) {
      for (const x of short) offer(`link:${row.key}:${x.uid}`, `${t.label}: ${name}, Link to ${whom(x)}`, ['support', 'link'], [...paid, ...to([x])], { targetUid: x.uid, targets: [x.uid], links: to([x]).length });
    }
  }
  if (route === 'cleanup') {
    const rule = tokenCleanupOf(a);
    for (const x of rule ? tokenCleanupTargets(data, state.tokens, t, a, rule, noBoard) : []) {
      for (const p of removableTokens(x, [rule!.shape])) {
        offer(`cleanup:${row.key}:${x.uid}:${p.id}`, `${t.label}: ${name}, ${p.label} off ${whom(x)}`, ['support', 'cleanup'],
          [...paid, { kind: 'removeStatus', seat, uid: t.uid, targetUid: x.uid, statusId: p.statusId, ...(p.face ? { face: p.face } : {}) }], { targetUid: x.uid, statusId: p.statusId });
      }
    }
  }
  // The Tactic that IS a Command Coordination ("Give 1 Command Token to 1 Ally
  // Drone": the Discard faces of four GoF weapons). Performed with nobody to
  // command it would change nothing, so it is the Action and the hand-off in
  // one answer, a Drone each; the Drone then acts as on any Coordination.
  if (route === 'card' && commandCoordination(a) > 0 && t.kind === 'mech' && PHASES[state.round.phase] === 'Action') {
    for (const x of state.tokens) {
      if (x.kind !== 'drone' || x.side !== seat || x.deployed === false || !alive(x)) continue;
      offer(`coordinate:${row.key}:${x.uid}`, `${t.label}: ${name}, a Command to ${x.label}`, ['coordinate', 'action'],
        [...paid, { kind: 'coordinateCommand', seat, uid: t.uid, targetUid: x.uid }], { targetUid: x.uid });
    }
  }
  if (route === 'repair') {
    const rep = repairSpec(a);
    if (rep?.ally) {
      for (const x of allyRepairTargets(data, state.tokens, t, a, noBoard)) {
        offer(`repair:${row.key}:${x.unit.uid}:${x.slot}`, `${t.label}: ${name}, a Damaged Part of ${x.unit.label} mended (${x.slot})`, ['support', 'repair', 'mend'],
          [...paid, { kind: 'repairPart', seat, uid: t.uid, slot: x.slot, mode: 'mend', targetUid: x.unit.uid, actionId: a.id }], { targetUid: x.unit.uid, slot: x.slot, mode: 'mend' });
      }
    } else if (rep) {
      for (const x of selfRepairOptions(data, t, rep)) {
        offer(`repair:${row.key}:${x.slot}:${x.mode}`, `${t.label}: ${name}, ${cardName(x.card)} ${x.mode === 'mend' ? 'mended' : 'given a Repaired Token'}`, ['support', 'repair', x.mode === 'mend' ? 'mend' : 'repaired'],
          [...paid, { kind: 'repairPart', seat, uid: t.uid, slot: x.slot, mode: x.mode }], { targetUid: t.uid, slot: x.slot, mode: x.mode });
      }
    }
  }
  return out;
}

// A Projectile Action (4.7): one option per Projectile it may put down and
// per legal Landing Point, each a single shot. Volley X is the same question
// asked again while the performance has shots left, and stopping early is
// simply doing something else.
//
// AN ASKER THAT IS LOOKING AHEAD (`ahead`: it named the kinds it wants) is
// given the Landing Points its Projectile could do something from: those
// within the Projectile's own reach (`strike`) of a unit of the other squad.
// No policy weighs any other (a blast is priced by the units it catches), and
// a launcher that reaches the whole board (the RA-81 Rocket, Direct Fire at
// Range 12) would otherwise have a line of sight walked to every Grid of it,
// and a launch made up for each, at every look. The question a seat is PUT
// lists every Landing Point there is.
function launchOptions(data: GameData, state: GameState, t: Token, row: turn.ActionRow, prefix: Command[], name: string, underWay: boolean, ahead: boolean): Option[] {
  const a = row.a;
  // A BIT PORT (292_A; ruling I23) Launches a "White Dwarf" Bit in any of its
  // three Stances while it holds its Token: each face is a card on the list,
  // launched as any other. An EMPTY Port Recovers one of this squad's Bits in
  // Range instead, and its Token comes back (`recoverBit`): an answer for each
  // such Bit, as the Match Centre recovers the first it finds (matchhud.ts
  // routeAction). The Bit leaves the board, and comes back as a new unit if it
  // is launched again (FAQ N4, N8).
  const port = bitPortOf(a);
  if (port && !underWay && (ammoAvailable(data, state, t, a.id) ?? 1) <= 0) {
    const out: Option[] = [];
    for (const bit of bitsToRecover(data, state.tokens, t, a, !!state.noBoard)) {
      const o = sends(data, state, `recover:${row.key}:${bit.uid}`, `${name}: ${bit.label} recovered`, ['recover'],
        [...prefix, { kind: 'recoverBit', seat: t.side, uid: t.uid, actionId: a.id, targetUid: bit.uid }]);
      if (o) out.push({ ...o, facts: { uid: t.uid, actionId: a.id, targetUid: bit.uid } });
    }
    return out;
  }
  if (turn.launchLeft(data, state, t, a, a.id) <= 0) return [];
  const paid = prefix.length ? tableAfter(data, state, prefix) : state;
  if (!paid) return [];
  // Interception is worked out only on a table where some enemy holds a Token
  // for it, and only for a Launch (FAQ M20).
  const watched = turn.interceptorsAgainst(state, t.side) && turn.launchTriggersInterception(data, t, a.id);
  const before = new Set(state.tokens.map((x) => x.uid));
  const foes = ahead ? state.tokens.filter((x) => x.side !== t.side && x.deployed !== false).map((x) => largeGridOf(x)) : [];
  // And the units of its own squad with a Damaged Part, for a Drone that mends
  // one (`mends`, below).
  const hurt = ahead ? state.tokens.filter((x) => x.side === t.side && x.deployed !== false && alive(x)
    && Object.entries(x.partStates).some(([slot, st]) => slot !== 'pilot' && st === 'damaged')).map((x) => largeGridOf(x)) : [];
  // Where the Action may land is the same for every card it launches.
  let anywhere: ReturnType<typeof turn.landingGrids> | undefined;
  const out: Option[] = [];
  for (const card of row.projectiles ?? []) {
    // A 1x3 line asks its facing, and a Projectile whose Detonation as it
    // lands is one nobody answers (an effect nothing has read off its card):
    // each is more than a Landing Point, and neither is offered until the rest
    // of it is. A Mine, an Immediate Projectile that deals damage, hands out a
    // Token or puts down Smoke, and a folded Pholcus ARE: what each owes after
    // it lands is asked of its owner when it is owed (blastOwed), and the
    // Pholcus is Unfolded in the Delay Phase. (One launched with nobody asked
    // to Unfold it left that phase with no way out: found by the random-squad
    // games, 2026-10-02.)
    const now = immediateDetonation(card);
    if (isLineUnit({ cardId: card.id }) || (now && !blastAnswered(now))) continue;
    // A Smoke card is no attack on anybody, and says so.
    const smoky = !!now && !!smokePlacement(now);
    const what = cardName(card);
    // How far from its Landing Point this Projectile's own Action reaches: for
    // a Pholcus, the Action of the Drone it Unfolds into.
    const form = unfoldsInto(card);
    const strike = Math.max(0, ...[...(card.actions ?? []), ...((form ? data.byId.get(form)?.actions : undefined) ?? [])].map((x) => x.range ?? 0));
    // A DRONE THAT MENDS AN ALLY (the SU1 a Nest Guardian Swarm puts down:
    // "Remove 1 Damaged Token from an Ally Unit, then remove this Unit"). It
    // mends nobody as it lands: its Action is a Command Action, and a Command
    // buys a Movement OR one such Action (3.2.2 ②), so the ally it could mend
    // at its next Command is one within that Action's Range of its Landing
    // Point. An asker looking ahead is given the Landing Points within that
    // reach of an ally with a Damaged Part as well.
    const mender = (card.actions ?? []).find((x) => { const r = repairSpec(x); return !!r?.mend && r.ally; });
    const mends = mender ? mender.range ?? 0 : 0;
    // A DRONE THAT CALLS IN A SHOT (the KK9 Snake Eyes a Cobra core puts down:
    // its Overwatch Strike designates an enemy in Range for an Ally Mech to fire
    // on at once, then it leaves): the Range it calls a shot in. A look ahead
    // is given the Landing Points within it of an enemy already (`strike`).
    const caller = (card.actions ?? []).find((x) => overwatchOf(x));
    const calls = caller ? caller.range ?? 0 : 0;
    const grids = ahead
      ? turn.landingGrids(data, state, t, a, (c, r) => foes.some((f) => Math.abs(f.c - c) + Math.abs(f.r - r) <= strike)
        || (mends > 0 && hurt.some((f) => Math.abs(f.c - c) + Math.abs(f.r - r) <= mends)))
      : (anywhere ??= turn.landingGrids(data, state, t, a));
    // THE INTERCEPTION A LAUNCH WOULD OWE is read off the table it leaves
    // (turn.ts interceptsAfterLaunch): the units it put down, where they
    // stand, and where they were launched from. For one card that table is
    // the same at every Landing Point but for where the Projectile stands, so
    // it is made once, by the first launch that can be made, and the
    // Projectile is stood at each Landing Point in turn. (It was a copy of
    // the table for every Landing Point: a hundred and more of them for a
    // Rocket, at every look ahead.)
    let landed: { table: GameState; launcher: Token; born: Token[] } | undefined;
    for (const g of grids) {
      if (!g.ok) continue;
      const shot = turn.launchShot(data, state, t, a.id, card, g, what);
      if (!shot.ok || !check(data, paid, shot.cmd).ok) continue;
      const commands: Command[] = [...prefix, shot.cmd];
      let drawn = 0;
      let tries: number[] = [];
      if (watched) {
        if (!landed) {
          const table = tableAfter(data, state, commands);
          const launcher = table?.tokens.find((x) => x.uid === t.uid);
          if (table && launcher) landed = { table, launcher, born: table.tokens.filter((x) => !before.has(x.uid)) };
        }
        if (landed) for (const p of landed.born) { p.col = shot.cmd.to.col; p.row = shot.cmd.to.row; p.facing = shot.cmd.facing; }
        const owed = landed ? turn.interceptsAfterLaunch(data, landed.table, landed.launcher, landed.born) : [];
        if (owed.length) commands.push({ kind: 'queueIntercepts', seat: t.side, items: owed });
        drawn = owed.length;
        // How often each interceptor may try (FAQ M5: again while the
        // Projectile stands and it has Interception Tokens left), in the
        // order of the queue: for a seat that weighs the launch by its odds.
        tries = owed.map((it) => {
          const by = state.tokens.find((x) => x.uid === it.uid);
          const payer = by ? interceptPayer(data, state.tokens, by, it.actionId) : null;
          return Math.max(1, payer?.intercept?.[it.actionId] ?? 1);
        });
      }
      out.push({
        id: `launch:${row.key}:${card.id}:${g.c},${g.r}`,
        label: `${name}: ${what} to ${gridName(g)}`,
        tags: ['launch', 'land', ...(underWay ? ['volley'] : []), ...(drawn ? ['intercepted'] : []), ...(smoky ? ['smoke'] : []), ...(port ? ['bit'] : [])],
        commands,
        facts: { uid: t.uid, actionId: a.id, cardId: card.id, to: { c: g.c, r: g.r }, strike, ...(mends ? { mends } : {}), ...(calls ? { calls } : {}), ...(drawn ? { intercepts: drawn, interceptTries: tries } : {}) },
      });
    }
  }
  return out;
}

// A Projectile's Delayed Action, where it is an Explosion on one unit (4.7.5,
// 4.7.6): each unit its card lets it take. The Action is paid as the resolver
// opens, a Missile flies into its target's Grid, and the Explosion is an attack
// like any other, which destroys the Projectile as it ends. With nothing to
// take, the Projectile is destroyed, or stays where its card keeps it.
//
// A MISSILE'S FLIGHT MAY OWE INTERCEPTION (4.9; A2): judged at the Grid it
// leaves and at its target's. The answer is then the payment, the flight and
// the debt, and no Explosion yet (`waits`): the other squad's attempts come
// first. A Missile that comes through them is asked again with its Action
// already paid (`flown`), and what is left is the Explosion, on the unit whose
// Grid it came down in and no other.
function detonationOptions(data: GameData, state: GameState, proj: Token, row: turn.ActionRow, pay: Command | null, name: string, flown = false): Option[] {
  const a = row.a;
  // A smoke card places Screens and an effect card hands out Tokens: neither
  // is offered until its own answers are.
  if (smokePlacement(a)) return [];
  const reading = turn.detonationReading(data, state, proj.uid, a.id);
  if (!reading || !reading.a || !reading.damaging) return [];
  // An Interception still owed on the Projectile comes first (4.9).
  if (liveIntercepts(state).some((x) => x.targetUid === proj.uid)) return [];
  const paid: Command[] = pay ? [pay] : [];
  // A blast on every unit in Range (the Shrapnel Shell): the Action is paid
  // with the first of its Explosions, or with its end where it catches nobody,
  // and the rest of it is the blast under way (blastOwed).
  if (reading.scope !== 'single') return flown ? [] : blastAnswers(data, state, proj, reading, 'delayed', undefined, [], paid, `detonate:${row.key}`);
  const out: Option[] = [];
  let held = false;
  const at = largeGridOf(proj);
  for (const { t: target } of reading.legal) {
    if (flown) {
      const g = largeGridOf(target);
      if (g.c !== at.c || g.r !== at.r) continue;
    }
    // A unit in Optical Camouflage is Scanned first, the Projectile the
    // Initiator (p.71): not offered yet, and not a reason to destroy the
    // Projectile.
    if (explosionCamo(data, proj, a, target)) { held = true; continue; }
    const flight = flown ? null : turn.detonationFlight(data, state, proj, a, target);
    const drawn = flight?.owed.length ?? 0;
    const jump = flight || flown ? null : turn.detonationJump(proj, a, target);
    const before: Command[] = [
      ...paid, ...(flight ? [flight.fly] : []),
      ...(flight && drawn ? [{ kind: 'queueIntercepts', seat: proj.side, items: flight.owed } as Command] : []),
      ...(jump ? [jump] : []),
    ];
    out.push({
      id: `detonate:${row.key}:${target.uid}`,
      label: drawn
        ? `${proj.label}: flies at ${target.label}, through ${drawn} Interception attempt${drawn === 1 ? '' : 's'}`
        : `${proj.label}: ${name} on ${target.label}`,
      tags: ['detonate', 'attack', 'explosion', ...(drawn ? ['intercepted'] : [])],
      run: { routine: 'attack', args: { uid: proj.uid, actionId: a.id, targetUid: target.uid, mode: 'explosion', before, ...(drawn ? { waits: true } : {}) } },
      facts: { uid: proj.uid, targetUid: target.uid, actionId: a.id, ...(drawn ? { intercepts: drawn } : {}) },
    });
  }
  if (out.length || held) return out;
  if (flown) {
    // It flew, and the unit it flew at is gone from that Grid: it has nothing
    // left to take, and its Action is spent.
    const lost = sends(data, state, `detonate:${row.key}:none`, `${proj.label} finds no target and is destroyed`, ['detonate', 'destroy'],
      [{ kind: 'despawn', seat: proj.side, uid: proj.uid, targetUid: proj.uid }]);
    return lost ? [{ ...lost, facts: { uid: proj.uid } }] : [];
  }
  const gone: Command = { kind: 'despawn', seat: proj.side, uid: proj.uid, targetUid: proj.uid };
  const o = reading.stays
    ? (paid.length ? sends(data, state, `detonate:${row.key}:keep`, `${proj.label} finds no target and stays on the board`, ['detonate', 'keep'], paid) : null)
    : sends(data, state, `detonate:${row.key}:none`, `${proj.label} finds no target and is destroyed`, ['detonate', 'destroy'], [...paid, gone]);
  return o ? [{ ...o, facts: { uid: proj.uid } }] : [];
}

// ---------- an Interception owed (4.9) ----------

// A Launch, a Missile's flight or an Aerial unit's Movement owes the other
// squad's interceptors their attempts, and they are made at once, before play
// goes on: the squad that owes the first is asked, and the other waits
// (matchhud.ts interceptPanel). Each answer is one attempt: its Token, the
// debt settled, and the attack an Interception is (no arc, no Protection). A
// target that survives is owed the same attempt again while the Part has
// Tokens, which whoever runs the attack queues as it ends (turn.ts
// interceptAgain). An owed attempt "must be performed" while it can be (M5),
// so making none is offered only on a table that lets the debt be dropped.
function interceptOwed(data: GameData, state: GameState, seat: Side): Decision | null {
  if (turn.interceptSide(state) !== seat) return null;
  const live = liveIntercepts(state);
  const options: (Option | null)[] = [];
  const seen = new Set<string>();
  for (const x of live) {
    const by = state.tokens.find((t) => t.uid === x.uid);
    const at = state.tokens.find((t) => t.uid === x.targetUid);
    const id = `intercept:${x.uid}:${x.actionId}:${x.targetUid}`;
    if (!by || !at || by.side !== seat || seen.has(id)) continue;
    seen.add(id);
    const before = turn.interceptPayment(data, state, x);
    if (!before || !check(data, state, before[0]).ok) continue;
    const name = turn.actionOf(data, state, by, x.actionId)?.name?.en || x.actionId;
    options.push({
      id,
      label: `${by.label} intercepts ${at.label}: ${name}`,
      tags: ['intercept', 'attack'],
      run: { routine: 'attack', args: { uid: x.uid, actionId: x.actionId, targetUid: x.targetUid, mode: 'intercept', before } },
      facts: { uid: x.uid, targetUid: x.targetUid, actionId: x.actionId },
    });
  }
  options.push(sends(data, state, 'skip', 'Make no Interception', ['intercept', 'decline'], [{ kind: 'clearIntercepts', seat }]));
  const answers = kept(options);
  // An attempt owed again after it was made is a new question: the Tokens
  // left on the Part tell the two apart.
  const key = live.map((x) => `${x.uid}.${x.actionId}.${x.targetUid}.${state.tokens.find((t) => t.uid === x.uid)?.intercept?.[x.actionId] ?? 0}`).join(',');
  return ask('intercept.attempt', seat, `${stamp(state)}:${key}`, answers, answers[0]?.id ?? '');
}

// ---------- a reaction owed (FAQ B7, D10) ----------

// What being attacked owes the DEFENDER, queued by the attacker's window as
// the attack ends and answered by the defender alone (matchhud.ts
// reactionPanel): a Defense Reaction (change to Defensive Stance), Target
// Tracing (a Command Token for a Counter-roll back at the attacker), Emergency
// Smoke, a Riposte. Each may be declined, which clears the debt and spends
// nothing; a Scan's Manifestation alone may not, and is not offered here.
//
// THE STANCE AND THE COUNTER-ROLL are commands and nothing else: taken or left.
//
// EMERGENCY SMOKE (546_B, the Reapers): "may place N Smoke Screens within
// Range", in no shape. Taking it spends its one use and puts the Screens down,
// as the page's Smoke plan does one press at a time: an answer for each Grid in
// Range alone, and for each pair that holds the unit's own Grid (a unit in a
// Screen is not seen, which is what the reaction is for; of the other pairs
// there are too many to list, and none hides it better).
//
// A RIPOSTE (050_B, ZHLA-202_B): "the Attacker must immediately end the
// current Action Opportunity, and then the Defender may immediately perform a
// Melee Action". Taken, it is the `riposte` that ends that Opportunity (while
// it is still the open one), and then one of the unit's Melee Actions as a
// granted attack, on the attacker and nobody else (FAQ C1), where the blow can
// be struck at all; or the end of the Opportunity and no blow. The granted
// Action spends the debt as it is paid (commands.ts performAction).
function reactionOwed(data: GameData, state: GameState, seat: Side): Decision | null {
  for (const r of state.script?.reactions ?? []) {
    const t = state.tokens.find((x) => x.uid === r.uid);
    // Dead debt, the unit having left the board, asks nobody anything.
    if (!t || t.side !== seat) continue;
    const kind = r.kind ?? 'smoke';
    // A Scan's Manifestation is the Reveal of the unit Scanned, and is asked as
    // every Reveal is (revealOwed): the Reveal itself pays this debt.
    if (kind === 'manifest') continue;
    const name = turn.actionOf(data, state, t, r.actionId)?.name?.en || r.actionId;
    const settle = (placed: boolean): Command => ({ kind: 'resolveReaction', seat, uid: r.uid, actionId: r.actionId, placed });
    const options: (Option | null)[] = [];
    let safe = 'decline';
    // THE ATTACK BEHIND A FREE SCAN (FAQ I12): the Scan was won, the target has
    // Revealed where its own player chose, and the attack that designated it
    // resumes against it where it now stands, if it can still be made from
    // here (4.4.1); or it is called off. Its Ticks were spent at the
    // designation either way (I11). While the target is still Revealing,
    // nothing is asked: the debt waits behind the Reveal.
    if (kind === 'scanAttack' && r.fromUid !== undefined) {
      const target = state.tokens.find((x) => x.uid === r.fromUid);
      if (target && alive(target) && target.deployed !== false && statusCount(target.statuses, 'camouflage') > 0) continue;
      const line = target ? turn.attackLines(data, state, { uid: t.uid, actionId: r.actionId, only: r.fromUid })?.lines.find((l) => l.t.uid === r.fromUid) : undefined;
      if (target && line && !line.blocked && !line.hidden) {
        const a = turn.actionOf(data, state, t, r.actionId);
        options.push({
          id: `resume:${r.actionId}`,
          label: `${t.label}: ${name} at ${target.label}, which has Revealed`,
          tags: ['reaction', 'scan', 'attack', (a?.type ?? '').toLowerCase()],
          run: {
            routine: 'attack',
            args: {
              uid: t.uid, actionId: r.actionId, targetUid: r.fromUid, mode: 'attack', before: [settle(true)],
              ...(r.charged ? { charged: true } : {}), ...(r.chargeChoice ? { chargeChoice: r.chargeChoice } : {}), ...(r.twoHandedDeclined ? { twoHandedDeclined: true } : {}),
            },
          },
          facts: { targetUid: r.fromUid, actionId: r.actionId },
        });
        // It is paid for: with no better idea it is made.
        safe = `resume:${r.actionId}`;
      }
    }
    if (kind === 'stance') {
      options.push(sends(data, state, 'take', `${t.label}: ${name}, to Defensive Stance`, ['reaction', 'stance', 'stance:defensive'],
        [settle(true), { kind: 'defenseReaction', seat, uid: r.uid }]));
      // A Stance costs nothing and is chosen again at the unit's next turn, so
      // it is the answer with no better idea; anything that spends is not.
      safe = 'take';
    }
    if (kind === 'trace' && r.fromUid !== undefined) {
      options.push(sends(data, state, 'take', `${t.label}: ${name}, a Command Token for a Counter-roll`, ['reaction', 'electronic', 'spend-command'],
        [settle(true), { kind: 'startCounterRoll', seat, uid: r.uid, targetUid: r.fromUid, actionId: r.actionId, reaction: true }]));
    }
    if (kind === 'smoke') {
      const here = largeGridOf(t);
      const spots = turn.smokeSpots(state, seat, here, r.range);
      const own = spots.find((g) => g.c === here.c && g.r === here.r);
      const sets = [...spots.map((g) => [g]), ...(own && r.count >= 2 ? spots.filter((g) => g !== own).map((g) => [own, g]) : [])];
      for (const cells of sets) {
        const o = sends(data, state, `smoke:${cells.map((g) => `${g.c},${g.r}`).join('+')}`,
          `${t.label}: ${name}, ${cells.length === 1 ? 'a Smoke Screen' : `${cells.length} Smoke Screens`} in ${cells.map(gridName).join(' and ')}`, ['reaction', 'smoke'],
          [settle(true), ...cells.map((g): Command => ({ kind: 'placeSmoke', seat, for: seat, at: { col: g.c, row: g.r } }))]);
        if (o) options.push({ ...o, facts: { cells: cells.map((g) => ({ c: g.c, r: g.r })) } });
      }
    }
    // THE FIRING ACTION AN OVERWATCH STRIKE OWES the Mech it called on: one,
    // of any length, for no Ticks (FAQ K15), at the designated enemy and no
    // other, granted as a Riposte's blow is (the grant settles the debt as it
    // is paid); one answer for each Firing Action of a Part it still has that
    // could be made at it from where it stands; or none.
    if (kind === 'overwatch' && r.fromUid !== undefined) {
      const foe = state.tokens.find((x) => x.uid === r.fromUid);
      const guns = foe && alive(foe) && foe.deployed !== false
        ? tokenCards(data, t).filter((x) => x.slot !== 'pilot' && (t.partStates[x.slot as keyof typeof t.partStates] ?? 'intact') !== 'destroyed').flatMap(({ card }) => card.actions ?? []).filter((a) => a.type === 'Firing')
        : [];
      for (const a of guns) {
        const line = turn.attackLines(data, state, { uid: t.uid, actionId: a.id, only: r.fromUid })?.lines.find((l) => l.t.uid === r.fromUid);
        const grant: Command = { kind: 'performAction', seat, uid: t.uid, actionId: a.id, granted: true };
        if (!line || line.blocked || line.hidden || !sends(data, state, 'x', '', [], [grant])) continue;
        options.push({
          id: `overwatch:${a.id}`,
          label: `${t.label}: ${name}, ${a.name?.en || a.id} at ${foe!.label}`,
          tags: ['reaction', 'overwatch', 'attack', 'firing'],
          run: { routine: 'attack', args: { uid: t.uid, actionId: a.id, targetUid: r.fromUid, mode: 'attack', before: [grant] } },
          facts: { targetUid: r.fromUid, actionId: a.id },
        });
      }
      // It costs nothing: with no better idea the first shot is taken.
      safe = kept(options)[0]?.id ?? 'decline';
    }
    if (kind === 'riposte' && r.fromUid !== undefined) {
      const from = state.tokens.find((x) => x.uid === r.fromUid);
      const ends: Command[] = state.script?.opp?.uid === r.fromUid ? [{ kind: 'riposte', seat, uid: r.uid, fromUid: r.fromUid }] : [];
      for (const a of from && alive(from) && from.deployed !== false ? riposteMelees(data, t) : []) {
        const line = turn.attackLines(data, state, { uid: t.uid, actionId: a.id, only: r.fromUid })?.lines.find((l) => l.t.uid === r.fromUid);
        const grant: Command = { kind: 'performAction', seat, uid: t.uid, actionId: a.id, granted: true };
        if (!line || line.blocked || line.hidden || !sends(data, state, 'x', '', [], [...ends, grant])) continue;
        options.push({
          id: `riposte:${a.id}`,
          label: `${t.label}: ${name}, and ${a.name?.en || a.id} at ${from!.label}`,
          tags: ['reaction', 'riposte', 'attack', 'melee'],
          run: { routine: 'attack', args: { uid: t.uid, actionId: a.id, targetUid: r.fromUid, mode: 'attack', before: [...ends, grant] } },
          facts: { targetUid: r.fromUid, actionId: a.id },
        });
      }
      // Ending the Opportunity is worth having with no blow to strike. It costs
      // nothing, so with no better idea a Riposte is taken.
      if (ends.length) options.push(sends(data, state, 'riposte:end', `${t.label}: ${name}, and no blow: ${from?.label ?? 'the attacker'}'s Action Opportunity ends`, ['reaction', 'riposte'], [...ends, settle(true)]));
      safe = kept(options)[0]?.id ?? 'decline';
    }
    // THE RED SHOES (TM35NA_B, M8.2s): the won Counter-roll hands this seat ONE
    // of the enemy unit's own Maneuvers or Move Actions, no Tick, the
    // controller's seat sending it (commands.ts controlledMove, which spends
    // the debt; matchhud.ts's reaction panel). Each Grid its Maneuver reaches,
    // and each its Move Actions reach, is an answer: never a Crush (audit Phase
    // 3, D3), and no Box picked up and no Mine Laid for it. Leaving it be is
    // the safe answer.
    if (kind === 'control' && r.fromUid !== undefined) {
      const target = state.tokens.find((x) => x.uid === r.fromUid);
      if (target && alive(target) && target.deployed !== false) {
        const controller = { uid: t.uid, side: t.side };
        options.push(...movementOptions(data, state, target, {
          key: `control:${target.uid}`, name: `The Red Shoes: ${target.label}'s Maneuver`, tags: ['reaction', 'control', 'maneuver'], prefix: [], maneuver: true, controller,
        }));
        for (const a of controlledMoveActions(data, target)) {
          const mv = turn.actionMove(a);
          options.push(...movementOptions(data, state, target, {
            key: `control:${target.uid}:${a.id}`, name: `The Red Shoes: ${target.label}'s ${a.name?.en || a.id}`, tags: ['reaction', 'control'], prefix: [],
            actionId: mv.actionId, range: mv.range, airborne: mv.airborne, controller,
          }));
        }
      }
    }
    options.push(sends(data, state, 'decline', `${t.label}: no ${name}`, ['reaction', 'decline'], [settle(false)]));
    const answers = kept(options).map((o) => ({ ...o, facts: { ...(o.facts ?? {}), uid: r.uid, reaction: kind, ...(r.fromUid !== undefined ? { fromUid: r.fromUid } : {}) } }));
    const d = ask('reaction.answer', seat, `${stamp(state)}:${r.uid}:${r.actionId}:${kind}:${(state.script?.reactions ?? []).length}`, answers,
      safe, { unit: r.uid, facts: { reaction: kind, ...(r.fromUid !== undefined ? { fromUid: r.fromUid } : {}) } });
    if (d) return d;
  }
  return null;
}

// ---------- a Reveal owed (4.12.2) ----------

// A unit in Optical Camouflage is Revealed when it performs an Action or a
// Maneuver without Silence, when a Movement ends with an enemy in Contact, and
// when an enemy's Scan against it succeeds. Each is recorded by the command
// that caused it (script.revealDue; a won Scan queues a `manifest` reaction),
// and the unit's own player makes the Reveal: the Reveal and its Manifestation
// Movement are one event, the unit appearing where it stands or in any Grid
// within its Stealth value of there that it fits in (Teleportation: nothing in
// between is asked). The Match Centre asks its owner in a panel of Grids
// (matchhud.ts revealPanel, manifestPanel). A seat is asked the same: an answer
// for staying, and one for each of those Grids. A Reveal may not be declined.
//
// It is the owner's alone, and the other squad goes on with its turn: except
// behind a won Scan, where the attack that earned the Scan waits for the unit
// to appear (FAQ I12), and its squad with it.
function revealOwed(data: GameData, state: GameState, seat: Side): Decision | null | undefined {
  const sc = state.script;
  if (!sc) return undefined;
  const scanned = (sc.reactions ?? []).filter((r) => r.kind === 'manifest').map((r) => r.uid);
  const due = [...scanned, ...(sc.revealDue ?? []).map((x) => x.uid)];
  let waits = false;
  for (const uid of due) {
    const t = state.tokens.find((x) => x.uid === uid);
    if (!t || !alive(t) || t.deployed === false || statusCount(t.statuses, 'camouflage') === 0) continue;
    if (t.side !== seat) {
      waits = waits || scanned.includes(uid);
      continue;
    }
    const options: (Option | null)[] = [];
    const stay = sends(data, state, 'reveal:stay', `${t.label} Reveals where it stands`, ['reveal', 'stay'], [{ kind: 'reveal', seat, uid: t.uid }]);
    if (stay) options.push({ ...stay, facts: { uid: t.uid, to: { c: largeGridOf(t).c, r: largeGridOf(t).r } } });
    for (const g of state.noBoard ? [] : manifestTargets(data, state.tokens, turn.terrainOf(data, state), t, state)) {
      const o = sends(data, state, `reveal:${g.c},${g.r}`, `${t.label} Reveals, and appears in ${gridName(g)}`, ['reveal', 'manifest'],
        [{ kind: 'reveal', seat, uid: t.uid, to: { col: g.col, row: g.row } }]);
      if (o) options.push({ ...o, facts: { uid: t.uid, to: { c: g.c, r: g.r } } });
    }
    const d = ask('reveal.make', seat, `${stamp(state)}:${t.uid}:${due.length}`, kept(options), 'reveal:stay', { unit: t.uid, facts: { scanned: scanned.includes(uid) } });
    if (d) return d;
  }
  return waits ? null : undefined;
}

// ---------- a Smoke Screen to give up (4.16) ----------

// In the End Phase a lone Screen goes, and each Connected group of a squad's
// Screens gives ONE up (three, under Season 1.04), which its owner chooses. The
// groups are snapshotted into the script as the Smoke dissipates, because a
// removal that splits a group owes nothing more, and that snapshot is taken by
// the PAGE's glue (matchhud.ts glueAfter): a table run on glue.ts alone keeps
// no such queue, and asks nobody. The squad that owes the next removal is
// asked, an answer for each Screen of that group still standing; the other
// squad waits. A group with nothing left to give up holds nobody.
function smokeOwed(data: GameData, state: GameState, seat: Side): Decision | null | undefined {
  const next = state.script?.smokeOwed?.[0];
  if (!next) return undefined;
  const options = kept(turn.smokeOwedCells(state).map((c) => {
    const o = sends(data, state, `thin:${c.col},${c.row}`, `Take the Smoke Screen in ${gridName({ c: c.col, r: c.row })} off the board`, ['smoke', 'remove'],
      [{ kind: 'removeSmoke', seat: next.side, side: next.side, at: { col: c.col, row: c.row } }]);
    return o ? { ...o, facts: { cell: { c: c.col, r: c.row } } } : null;
  }));
  if (!options.length) return undefined;
  if (next.side !== seat) return null;
  return ask('smoke.thin', seat, `${stamp(state)}:${state.script?.smokeOwed?.length ?? 0}:${(state.smoke ?? []).length}`, options, options[0].id);
}

// ---------- a Detonation owed off the board (4.7.4, 4.7.6; FAQ M6, M18) ----------

// Some units blow up of their own accord, with nobody's activation behind it,
// and each is a debt read off the board (units.ts), so both seats see the same
// one with nothing queued for it. In the order the turn panel takes them
// (matchhud.ts panelHtml):
//
//   - MARTYRDOM: a unit whose card detonates it as it is destroyed (the Zealot,
//     the Explosive Wall). "Immediately", so it comes before a reaction.
//   - A MINE something has entered the Grid of, and an Unfolded Pholcus that
//     came up among units (FAQ M6, M18.4). When both squads owe one they take
//     turns, from this round's First Player (Supplementary Rules 1.04, 1.9).
//   - AN IMMEDIATE PROJECTILE that has landed and come through the
//     Interception its launch owed (4.7.4, 4.9).
//   - In the Automatic Phase, AN UNFOLDED PHOLCUS with an enemy in reach, which
//     must jump and Detonate (FAQ M18.6).
//
// Each is resolved by the OWNER of the unit that blows up, the other squad
// waiting, and none may be declined.
type BlastKind = 'martyrdom' | 'mine' | 'immediate' | 'automatic' | 'delayed';
interface BlastDebt { uid: number; actionId: string; kind: BlastKind; only?: number[] }

function blastDebts(data: GameData, state: GameState, tier: 'martyrdom' | 'board'): BlastDebt[] {
  // A table with no board keeps every unit on one cell: it resolves its own.
  if (state.noBoard) return [];
  if (tier === 'martyrdom') return martyrdomOwed(data, state.tokens).map((x) => ({ uid: x.uid, actionId: x.actionId, kind: 'martyrdom' as const, only: x.targets }));
  const out: BlastDebt[] = [];
  const ready = blastsReady(data, state.tokens);
  const next = ready.length ? blastTurn(data, state) : null;
  for (const m of ready) {
    const by = state.tokens.find((t) => t.uid === m.uid);
    if (by && (!next || by.side === next)) out.push({ uid: m.uid, actionId: m.actionId, kind: 'mine', only: m.victims });
  }
  for (const x of immediatesOwed(data, state.tokens, liveIntercepts(state))) out.push({ uid: x.uid, actionId: x.actionId, kind: 'immediate' });
  if (PHASES[state.round.phase] === 'Automatic') {
    for (const x of autoDetonationsOwed(data, state.tokens)) out.push({ uid: x.uid, actionId: x.actionId, kind: 'automatic', only: x.targets });
  }
  return out;
}

// Whether the Detonation an Immediate Projectile owes as it lands is one a seat
// can answer: an Explosion (it has dice), Smoke (its Screens), or an effect
// whose Token its card names.
const blastAnswered = (a: CardAction): boolean => !!smokePlacement(a) || (a.yellowDice ?? 0) + (a.redDice ?? 0) > 0 || !!detonationToken(a);

// THE EXPLOSIONS OF ONE DETONATION, as answers: what the page's Detonation
// panel lists (turn.ts detonationReading), for a seat with no panel.
//
// A card that damages ONE target is one answer for each unit it may take, and
// the attack's end removes what blew up (botcombat.ts afterAttack). A card that
// damages EVERY unit in Range is one Explosion attack for each of them, allies
// too, made one at a time in whatever order its owner likes: the unit that
// blows up is held between them (`hold`), each attack is named as part of the
// blast (`blast`: whoever runs it remembers who has had theirs, `hit`), and
// when nobody is left the answer is the end of it (`done`): the Containers in
// Range go with the blast (a Neutral Unit, destroyed with no roll: Supplementary
// Rules 1.04, 1.4.2, 3.1) and the unit is removed. `only` narrows the targets
// to those the debt names (a Mine's Ground units, the Pholcus's nearest
// enemies); `paid` is sent before the first of it (a Delayed Action's payment).
function blastAnswers(
  data: GameData, state: GameState, by: Token, reading: turn.DetonationReading, kind: BlastKind,
  only: number[] | undefined, hit: number[], paid: Command[], prefix: string,
): Option[] {
  const a = reading.a;
  if (!a) return [];
  const seat = by.side;
  const name = a.name?.en || a.id;
  const all = reading.scope === 'all';
  const left = reading.legal.map((x) => x.t).filter((t) => alive(t) && (!only || only.includes(t.uid)) && !hit.includes(t.uid));
  const pieces = all ? reading.terrain.map((x) => x.piece.id) : [];
  const gone: Command = { kind: 'despawn', seat, uid: by.uid, targetUid: by.uid };
  // A unit whose own destruction set it off is not removed by an attack's end.
  const stays = all && (left.length > 1 || pieces.length > 0 || kind === 'martyrdom');
  const out: Option[] = [];
  let hidden = false;
  for (const target of left) {
    // A unit in Optical Camouflage is Scanned first by a card that takes one
    // target (p.71): not offered yet.
    if (!all && explosionCamo(data, by, a, target)) { hidden = true; continue; }
    // The Unfolded Pholcus jumps into its target's Grid first (167), where the
    // engine lets it: at an enemy, and once. Never for the blast it owes as it
    // Unfolds, in the Grid it is already in (turn.ts detonationJump).
    const jump = turn.detonationJump(by, a, target);
    const before: Command[] = [...paid, ...(jump && check(data, state, jump).ok ? [jump] : [])];
    out.push({
      id: `${prefix}:${target.uid}`,
      label: `${by.label}: ${name} on ${target.label}`,
      tags: ['detonate', 'attack', 'explosion', ...(all ? ['blast'] : []), ...(target.side === seat ? ['ally'] : [])],
      run: { routine: 'attack', args: { uid: by.uid, actionId: a.id, targetUid: target.uid, mode: 'explosion', before, ...(all ? { blast: true } : {}), ...(stays ? { hold: true } : {}) } },
      facts: { uid: by.uid, targetUid: target.uid, actionId: a.id },
    });
  }
  if (out.length) return out;
  // Only hidden units to take: an Immediate Projectile has no later turn to
  // wait for, and is destroyed; anything else waits.
  if (hidden && kind !== 'immediate') return [];
  if (all) {
    const took = hit.length > 0;
    const o = sends(data, state, `${prefix}:done`,
      `${by.label} ${took ? 'has detonated' : 'detonates on nothing'}${pieces.length ? `, taking ${pieces.length === 1 ? 'the Container' : `${pieces.length} Containers`} in Range with it,` : ''} and is removed`,
      ['detonate', 'destroy', 'done'],
      [...paid, ...(pieces.length ? [{ kind: 'destroyTerrain', seat, uid: by.uid, pieces } as Command] : []), gone]);
    return o ? [{ ...o, facts: { uid: by.uid } }] : [];
  }
  const o = sends(data, state, `${prefix}:none`, `${by.label} finds no target and is destroyed`, ['detonate', 'destroy'], [...paid, gone]);
  return o ? [{ ...o, facts: { uid: by.uid } }] : [];
}

// One blast, asked of the squad whose unit it is. A Detonation that deals no
// damage is one answer: the Token its card names on every unit in Range (in
// its sight, where the card says so), and the unit removed.
//
// A SMOKE CARD puts Screens down in place of a blast (4.16): one answer for
// each shape they may take from where it landed (turn.ts smokeShapes: "up to
// 3, Connected, starting at the landing point"), each the Screens and the
// removal of the Projectile, as the page's Smoke plan sends them one at a
// time. Where no Screen can be placed (the squad has one in that Grid
// already), the Projectile is removed and that is all.
function blastAsk(data: GameData, state: GameState, by: Token, debt: BlastDebt, mind: SeatMind): Decision | null {
  const seat = by.side;
  const reading = turn.detonationReading(data, state, by.uid, debt.actionId);
  const a = reading?.a;
  if (!reading || !a || linkSupportOf(a)) return null;
  const name = a.name?.en || a.id;
  const hit = mind.blast && mind.blast.uid === by.uid && mind.blast.actionId === a.id ? mind.blast.hit : [];
  const screens = smokePlacement(a);
  let options: Option[];
  if (screens) {
    const gone: Command = { kind: 'despawn', seat, uid: by.uid, targetUid: by.uid };
    options = kept(turn.smokeShapes(state, seat, largeGridOf(by), screens.count, screens.connected).map((cells) => {
      const o = sends(data, state, `blast:${by.uid}:smoke:${cells.map((g) => `${g.c},${g.r}`).join('+')}`,
        `${by.label}: ${cells.length === 1 ? 'a Smoke Screen' : `${cells.length} Smoke Screens`} in ${cells.map(gridName).join(', ')}, and it is removed`,
        ['detonate', 'smoke', 'done'],
        [...cells.map((g): Command => ({ kind: 'placeSmoke', seat, for: seat, at: { col: g.c, row: g.r } })), gone]);
      return o ? { ...o, facts: { uid: by.uid, cells: cells.map((g) => ({ c: g.c, r: g.r })) } } : null;
    }));
    if (!options.length) {
      const o = sends(data, state, `blast:${by.uid}:none`, `${by.label} has nowhere to put a Smoke Screen and is removed`, ['detonate', 'destroy'], [gone]);
      options = o ? [{ ...o, facts: { uid: by.uid, cells: [] } }] : [];
    }
  } else if (reading.damaging) {
    options = blastAnswers(data, state, by, reading, debt.kind, debt.only, hit, [], `blast:${by.uid}`);
  } else {
    const token = detonationToken(a);
    if (!token) return null;
    const terrain = turn.terrainOf(data, state);
    const caught = reading.targets.map((x) => x.t)
      .filter((t) => alive(t) && (!token.sight || losBetween(by, t, terrain, state.tokens) !== 'blocked'))
      .map((t) => ({ t, cmd: { kind: 'applyStatus', seat, uid: by.uid, targetUid: t.uid, statusId: token.statusId } as Command }))
      .filter((x) => check(data, state, x.cmd).ok);
    const o = sends(data, state, `blast:${by.uid}:effect`,
      `${by.label}: ${name}, on ${caught.length ? caught.map((x) => x.t.label).join(', ') : 'nobody in Range'}, and it is removed`,
      ['detonate', 'effect', 'done'], [...caught.map((x) => x.cmd), { kind: 'despawn', seat, uid: by.uid, targetUid: by.uid }]);
    options = o ? [{ ...o, facts: { uid: by.uid, caught: caught.map((x) => x.t.uid) } }] : [];
  }
  return ask('blast.resolve', seat, `${stamp(state)}:${by.uid}:${a.id}:${hit.length}`, options, options[0]?.id ?? '',
    { unit: by.uid, facts: { blast: debt.kind, actionId: a.id, scope: reading.scope } });
}

// What a blast owes `seat` now. A Decision when the first one that can be
// answered is its own; null when it is the other squad's (this seat waits);
// undefined when nothing is owed, and the turn goes on.
const NOBODY: SeatMind = { dials: null, blast: null, mines: null };

// MINES LAID ALONG A WALK (006_A; FAQ M7, M29): once a Movement has landed, the
// Range it left unspent pays for Mines, 1 each, in Grids of the route walked (a
// flight: its two ends), the walker's own Grid among them, where a Mine goes
// off at once. The offer is this seat's own memory, as it is the Match
// Centre's Mine panel's: asked while the unit that walked holds the activation
// and has walked no further, one Mine a question; or none, which forgets it.
function minesOwed(data: GameData, state: GameState, seat: Side, mind: SeatMind): Decision | null {
  const m = mind.mines;
  const o = state.script?.opp;
  if (!m || !o || o.uid !== m.uid || m.left <= 0 || walkedKey(state) !== m.walked) return null;
  const t = state.tokens.find((x) => x.uid === m.uid && x.side === seat);
  if (!t || !alive(t)) return null;
  const terrain = turn.terrainOf(data, state);
  const here = largeGridOf(t);
  const route = m.route.map((g) => ({ col: g.c * 3 + 1, row: g.r * 3 + 1 }));
  const options: Option[] = [];
  for (const g of m.grids) {
    const to = mineSpot(g.c, g.r, terrain);
    if (!to) continue;
    const self = g.c === here.c && g.r === here.r;
    const o2 = sends(data, state, `mine:${g.c},${g.r}`, `${t.label}: a Mine laid in ${gridName(g)}${self ? ', its own Grid, where it goes off' : ''}`, ['mine', ...(self ? ['self'] : [])],
      [{ kind: 'layMine', seat, uid: t.uid, actionId: m.actionId, cardId: m.cardId, to, route, ...(m.flight ? { flying: true } : {}) }]);
    if (o2) options.push({ ...o2, facts: { uid: t.uid, to: { c: g.c, r: g.r }, mine: 'laid', left: m.left } });
  }
  options.push(runs('mine:none', `${t.label} lays ${m.left === m.max ? 'no Mine' : 'no more Mines'}`, ['mine', 'none'], 'forget', { what: 'mines' }));
  return ask('mine.lay', seat, `${stamp(state)}:${t.uid}:${m.walked}:${m.left}`, options, 'mine:none', { unit: t.uid, facts: { left: m.left, max: m.max } });
}
function blastOwed(data: GameData, state: GameState, seat: Side, mind: SeatMind, tier: 'martyrdom' | 'board'): Decision | null | undefined {
  const debts = blastDebts(data, state, tier);
  // A blast begun inside its Projectile's own activation (a Delayed Action on
  // every unit in Range) goes on from the seat's memory of it, while the
  // Projectile stands: the board alone does not say it has begun.
  const under = tier === 'board' && mind.blast ? state.tokens.find((t) => t.uid === mind.blast!.uid && t.side === seat) : undefined;
  if (under && mind.blast && !debts.some((x) => x.uid === under.uid)) debts.unshift({ uid: under.uid, actionId: mind.blast.actionId, kind: 'delayed' });
  for (const debt of debts) {
    const by = state.tokens.find((t) => t.uid === debt.uid);
    if (!by) continue;
    // A debt its owner has no answer to asks nobody, and nobody waits on it.
    const d = blastAsk(data, state, by, debt, by.side === seat ? mind : NOBODY);
    if (d) return by.side === seat ? d : null;
  }
  return undefined;
}

// ---------- Forced Movement (Knockback X, Push X; M8.2t) ----------

// A FORCED MOVEMENT OWED by an attack of this seat's that carried one (the
// attack window remembers it: botcombat.ts afterAttack; the driver keeps it as
// SeatMind.shove), asked as the Match Centre's Forced Movement panel asks it
// (matchhud.ts shovePanel). The line is the rules' (turn.ts forcedMove); the
// forcing player picks which way the victim is left facing (3.4.4), or leaves
// it, and for a Push the direction too. It is not optional: the safe answer
// makes the move, the facing left as it was (for a Push, along the attack
// direction). Blocked from its first Grid, the victim may still be turned, or
// left be. A line a Mine stopped goes on once nobody owes that Mine's blast on
// the victim (the page's `pushOn`); nothing is asked while it is owed. A
// victim that is gone, or an attacker, owes nothing: that is all it is asked.
// A SHOVE AFTER A MOVEMENT (M8.2u) names no victim: each enemy Ground Unit in
// the Grid in front is one (turn.ts shoveVictims, the page's list), it "may"
// be made, so leaving it be is the safe answer, and a Mech Pushed loses 1 Link
// (`link` in the facts).
function shoveOwed(data: GameData, state: GameState, seat: Side, mind: SeatMind): Decision | null {
  const m = mind.shove;
  if (!m) return null;
  const ahead = m.targetUid === null;
  const key = `${stamp(state)}:${m.uid}:${ahead ? 'ahead' : m.targetUid}:${m.resume ? m.resume.grids : 'all'}`;
  const forget = runs('shove:leave', 'Leave it be', ['shove', 'leave'], 'forget', { what: 'shove' });
  const by = state.tokens.find((x) => x.uid === m.uid && x.side === seat);
  const a = by && alive(by) ? turn.actionOf(data, state, by, m.actionId) : undefined;
  const victims = !by || !a ? [] : ahead ? turn.shoveVictims(data, state, by)
    : state.tokens.filter((x) => x.uid === m.targetUid && alive(x) && x.deployed !== false);
  if (!by || !a || !victims.length) return ask('shove.make', seat, key, [forget], forget.id, { unit: m.uid, facts: { targetUid: m.targetUid } });
  if (m.resume && victims.some((v) => turn.minesOwedOn(data, state, v.uid))) return null;
  const options: Option[] = [];
  let safe = '';
  let pushes = false;
  for (const victim of victims) {
    const kb = turn.forcedMove(data, state, by, victim, a, undefined, m.resume)?.kb;
    const push = !!kb?.push && !m.resume;
    pushes ||= push;
    const attackDir = turn.PUSH_DIRS.findIndex((x) => { const d = turn.forcedMove(data, state, by, victim, a)?.dir; return !!d && x.dc === d.dc && x.dr === d.dr; });
    for (const dir of push ? [0, 1, 2, 3] : [undefined]) {
      for (const facing of [undefined, 0, 1, 2, 3] as (Facing | undefined)[]) {
        const made = turn.forcedCommands(data, state, by, victim, a, { dir, facing, resume: m.resume });
        const out = made.out;
        if (!out || !out.path.length || !made.commands.length) continue;
        const id = `shove:${ahead ? `${victim.uid}:` : ''}${dir ?? '-'}:${facing ?? '-'}`;
        const turned = facing === undefined ? '' : `, left facing ${['north', 'east', 'south', 'west'][facing]}`;
        const o = sends(data, state, id, `${victim.label} forced ${out.path.length} Grid${out.path.length === 1 ? '' : 's'} ${out.heading} to ${gridName({ c: out.end.c, r: out.end.r })}${turned}`,
          ['shove', ...(facing === undefined ? [] : [`facing:${facing}`]), ...(made.fatal ? ['kill'] : [])], made.commands);
        if (!o) continue;
        const link = out.kb.push && !out.resumed && victim.kind === 'mech' ? 1 : 0;
        options.push({ ...o, facts: { shove: 'made', uid: victim.uid, to: { c: out.end.c, r: out.end.r }, ...(facing === undefined ? {} : { facing }), ...(link ? { link } : {}), ...(out.rest > 0 && !made.fatal ? { rest: { dir: out.dir, grids: out.rest } } : {}) } });
        if (!ahead && facing === undefined && (!safe || dir === attackDir)) safe = id;
      }
    }
  }
  if (!options.length) {
    // Blocked: it may be turned where it stands, or left be (FAQ B4/B5).
    for (const victim of victims) {
      for (const facing of [0, 1, 2, 3] as Facing[]) {
        if (facing === victim.facing) continue;
        const o = sends(data, state, `shove:turn:${ahead ? `${victim.uid}:` : ''}${facing}`, `${victim.label} cannot be moved; turned to face ${['north', 'east', 'south', 'west'][facing]}`, ['shove', 'turn', `facing:${facing}`],
          [{ kind: 'forceMove', seat, uid: by.uid, targetUid: victim.uid, to: { col: victim.col, row: victim.row }, facing }]);
        const here = largeGridOf(victim);
        if (o) options.push({ ...o, facts: { shove: 'made', uid: victim.uid, to: { c: here.c, r: here.r }, facing } });
      }
    }
    options.push(forget);
    return ask('shove.make', seat, key, options, forget.id, { unit: by.uid, facts: { targetUid: ahead ? null : victims[0].uid, blocked: true, ...(ahead ? { optional: true } : {}) } });
  }
  if (ahead) {
    options.push(forget);
    safe = forget.id;
  }
  return ask('shove.make', seat, key, options, safe || options[0].id, { unit: by.uid, facts: { targetUid: ahead ? null : victims[0].uid, push: pushes, ...(ahead ? { optional: true } : {}) } });
}

// ---------- Tactics Cards (5.4; tactics.ts) ----------
//
// A squad's hand: plain, as the table lists it, or sealed (Supplementary Rules
// 1.04, 1.11), as the seat itself keeps it: each card with the salt that proves
// it against a commitment on the table (commands.ts playTactic). Six cards,
// each used once a game (FAQ P2) and one a round (5.4.2), at the moment its own
// text names (tactics.ts tacticWindowWhy): the engine judges all of it, and an
// answer it would refuse is not offered.
function handHeld(state: GameState, seat: Side, mind: SeatMind): { id: string; salt?: string }[] {
  const sealed = state.tacticsSealed?.[seat];
  if (sealed?.length) {
    const want = new Set(sealed);
    return (mind.hand ?? []).filter((c) => want.has(sealTactic(c.id, c.salt)));
  }
  return (state.tactics?.[seat] ?? []).map((id) => ({ id }));
}

const tacticCtxOf = (data: GameData): TacticCtx => ({ maxLink: (x) => maxLink(data, x), cruising: (x) => cruising(data, x) });

// THE CARDS A SEAT MAY PLAY NOW, of those named: for each card of its hand not
// yet used, each Ally unit it may take (tacticTargets) and each choice it
// offers, the play as the Match Centre's Tactics panel sends it (matchhud.ts
// tacticPanel).
function tacticOptions(data: GameData, state: GameState, seat: Side, mind: SeatMind, ids: string[]): Option[] {
  const out: Option[] = [];
  const ctx = tacticCtxOf(data);
  for (const c of handHeld(state, seat, mind)) {
    const spec = ids.includes(c.id) ? tacticSpec(c.id) : null;
    if (!spec || tacticUsedRound(state, seat, c.id) !== null) continue;
    for (const t of tacticTargets(spec, state, seat, ctx)) {
      for (const p of spec.choices ? spec.choices(t, state, ctx) : [null]) {
        const play: Command = { kind: 'playTactic', seat, uid: t.uid, cardId: c.id, ...(p ? { pick: p.id } : {}), ...(c.salt ? { salt: c.salt } : {}) };
        const o = sends(data, state, `tactic:${c.id}:${t.uid}${p ? `:${p.id}` : ''}`, `${spec.name}: ${t.label}${p ? `, ${p.label}` : ''}`, ['tactic', `card:${c.id}`], [play]);
        if (o) out.push({ ...o, facts: { uid: t.uid, cardId: c.id, ...(p ? { pick: p.id } : {}) } });
      }
    }
  }
  return out;
}

// The cards a seat may play at the moment a question of the table's is put to
// it, beside that question's own answers: Additional Instructions among the
// Command Phase's designations, System Repair and Tactical Disposition in one
// of its Mechs' Action Opportunity.
function withCards(data: GameData, state: GameState, seat: Side, mind: SeatMind, d: Decision | null, ids: string[], want?: Want): Decision | null {
  if (!d || d.seat !== seat || !ids.length || (want?.only && !wants(want, 'tactic'))) return d;
  const cards = tacticOptions(data, state, seat, mind, ids);
  return cards.length ? { ...d, options: [...d.options, ...cards] } : d;
}

// HIT AND RUN (276): "when the Action Opportunity of an Ally Mech ends", on that
// Mech, until the next unit begins to act (ruling I28): a question of its own
// for the seat whose Mech has just ended, asked once (its pass is remembered).
// Each answer is the card and the Maneuver it grants, worked out on the table
// after the play (the grant is taken by a `granted` Maneuver).
function hitAndRunOwed(data: GameData, state: GameState, seat: Side, mind: SeatMind): Decision | null {
  const last = state.script?.lastEnded;
  if (!last || last.round !== state.round.n) return null;
  const key = `${state.round.n}:276:${last.uid}`;
  const spec = tacticSpec('276');
  if (!spec || (mind.passed ?? []).includes(key) || tacticWindowWhy(spec, state, seat)) return null;
  const options: Option[] = [];
  for (const play of tacticOptions(data, state, seat, mind, ['276'])) {
    const after = play.commands ? tableAfter(data, state, play.commands) : null;
    const mover = after?.tokens.find((x) => x.uid === play.facts?.uid);
    if (!after || !mover) continue;
    for (const m of movementOptions(data, after, mover, { key: `hitandrun:${mover.uid}`, name: `Hit and Run: ${mover.label}'s Maneuver`, tags: ['tactic', 'card:276'], prefix: [], maneuver: true, granted: true })) {
      options.push({ ...m, commands: [...(play.commands ?? []), ...(m.commands ?? [])], facts: { ...m.facts, cardId: '276' } });
    }
  }
  if (!options.length) return null;
  options.push(runs(`tactic:pass:${key}`, 'Let Hit and Run go by', ['tactic', 'pass'], 'forget', { what: 'tactic', key }));
  return ask('tactic.after', seat, key, options, `tactic:pass:${key}`, { unit: last.uid });
}

// ASTER (ZPA-36): in the Command Phase a face-up Command Token of Aster's Mech
// is consumed for 1 Link on an Ally Mech short of it, once a round (commands.ts
// asterRestore). Offered beside the designations, where the Token would
// otherwise go to a Drone, and never inside a Drone's activation. Its facts say
// what else the Token could do, which the brain may not read off the cards
// (rule R4): how many Tokens Aster's Mech holds face-up, and whether an Action
// of its own carries Command Coordination (a Token kept for the Action Phase).
function asterOptions(data: GameData, state: GameState, seat: Side): Option[] {
  const out: Option[] = [];
  for (const m of state.tokens) {
    if (m.side !== seat || m.kind !== 'mech' || !alive(m) || pilotCard(data, m)?.id !== 'ZPA-36') continue;
    const coordinates = tokenCards(data, m).some(({ card }) => (card.actions ?? []).some((a) => coordinationFor(data, m, a) > 0));
    for (const to of state.tokens) {
      if (to.side !== seat || to.kind !== 'mech') continue;
      const o = sends(data, state, `aster:${m.uid}:${to.uid}`, `Aster: ${m.label} restores 1 Link to ${to.label}`, ['aster'],
        [{ kind: 'asterRestore', seat, uid: m.uid, targetUid: to.uid }]);
      if (o) out.push({ ...o, facts: { uid: m.uid, targetUid: to.uid, held: readyCommands(m), coordinates } });
    }
  }
  return out;
}

function withAster(data: GameData, state: GameState, seat: Side, d: Decision | null, want?: Want): Decision | null {
  if (!d || d.seat !== seat || (want?.only && !wants(want, 'aster'))) return d;
  const more = asterOptions(data, state, seat);
  return more.length ? { ...d, options: [...d.options, ...more] } : d;
}

// THE END PHASE'S CARDS (275 Battlefield Recovery, 279 Remote Restart): asked of
// each seat that holds one it may play, once an End Phase (its pass
// remembered), ahead of the End Phase's own steps, whoever takes those.
function endCardsOwed(data: GameData, state: GameState, seat: Side, mind: SeatMind): Decision | null {
  const key = `${state.round.n}:end`;
  if ((mind.passed ?? []).includes(key)) return null;
  const options = tacticOptions(data, state, seat, mind, ['275', '279']);
  if (!options.length) return null;
  options.push(runs(`tactic:pass:${key}`, 'No Tactics Card this End Phase', ['tactic', 'pass'], 'forget', { what: 'tactic', key }));
  return ask('tactic.end', seat, key, options, `tactic:pass:${key}`);
}

// ---------- the Action Phase (3.4) ----------

function actionOwed(data: GameData, state: GameState, seat: Side, want?: Want): Decision | null {
  const sc = state.script;
  if (!sc) return null;
  const o = sc.opp;
  if (!o) {
    // Derived off each command by the glue: with a Mech still to act and no
    // Opportunity minted yet, the table is between two commands.
    if (nextActivation(state, makeInit(data))) return null;
    return readyOwed(data, state, seat, 'Continue');
  }
  const t = state.tokens.find((x) => x.uid === o.uid);
  if (!t) return null;
  return t.side === seat ? activationOwed(data, state, seat, t, want) : null;
}

// ---------- the End Phase (3.7) ----------

const END_LABEL: Record<string, string> = {
  remove: 'Remove Units (3.7.1)', tokens: 'Token Management (3.7.2)', smoke: 'Smoke dissipation (4.16)', tasks: 'Check the Tasks (3.7.3)',
};

function endOwed(data: GameData, state: GameState, seat: Side): Decision | null {
  const sc = state.script;
  if (!sc) return null;
  const left = endStepsLeft(state);
  if (!left.length) return readyOwed(data, state, seat, state.round.n >= (state.roundLimit ?? 5) ? 'Finish the game' : `Start Round ${state.round.n + 1}`);
  const step = left[0];
  const commands: Command[] = [];
  if (step === 'smoke') commands.push({ kind: 'dissipateSmoke', seat });
  if (step === 'tasks') {
    // The step that pays: the board is judged and the numbers travel with the
    // Award, so both tables add the same Victory Points.
    const got = previewScore(data, state, gameEndsThisRound(data, state));
    if (got.lines.length) {
      commands.push({ kind: 'award', seat, vp: { s1: got.s1, s2: got.s2 }, keys: got.lines.map((l) => l.key).filter((k): k is string => !!k) });
    }
  }
  commands.push({ kind: 'markEndStep', seat, step });
  // Bookkeeping either seat may do; the First Player is the one expected to.
  return ask('end.step', state.round.firstPlayer, `${state.round.n}:${step}`, kept([sends(data, state, step, END_LABEL[step] ?? step, ['end-step', step], commands)]), step, { shared: true });
}

// ---------- the one question ----------

// What `seat` must decide now, or null: nothing is being asked of it (it is
// the other squad's move, or the game is over). `mind` is the seat's own
// memory, which no table holds. `want` narrows the answers of an activation
// to some kinds, for an asker that is looking ahead and not answering.
// ---------- an Undo asked (the Match Centre's rollback) ----------
//
// One seat asks to walk the table back, to before an action or to a phase's
// start, and the table waits for the other to answer (matchhud.ts
// rollbackPanel, ahead of everything but a panel already open). Accepted, the
// host rewinds both boards to that point from its own ring, and a rollback
// never reaches past a roll (match.ts rewindIfAgreed, history.ts). The seat
// asked answers: accept (the safe answer) or decline. The seat that asked waits.
function rollbackOwed(data: GameData, state: GameState, seat: Side): Decision | null {
  const rb = state.script?.rollback;
  if (!rb) return null;
  if (rb.by === seat) return null;
  const to = rb.seq !== undefined ? `before "${rb.label}"` : `round ${rb.round}, ${PHASES[rb.phase] ?? rb.phase} Phase`;
  return ask('rollback.answer', seat, `rollback:${rb.by}:${rb.round}:${rb.phase}:${rb.seq ?? ''}`, kept([
    sends(data, state, 'accept', `Agree to walk the table back, to ${to}`, ['rollback', 'accept'], [{ kind: 'rollbackAnswer', seat, accept: true }]),
    sends(data, state, 'decline', 'Decline the rollback', ['rollback', 'decline'], [{ kind: 'rollbackAnswer', seat, accept: false }]),
  ]), 'accept');
}

export function owed(data: GameData, state: GameState, seat: Side, mind: SeatMind, want?: Want): Decision | null {
  const su = normaliseSetup(state.setup);
  if (!su) return null;
  if (normaliseTasks(state.tasks).conceded) return null;
  if (su.stage !== 'done') return setupOwed(data, state, seat, su);
  if (!state.script || gameOver(data, state).over) return null;
  // An Undo asked of one seat holds the table for both until it is answered.
  if (state.script.rollback) return rollbackOwed(data, state, seat);
  // An Electronic Counter-roll on the table is answered in its own window, by
  // both seats, before anything else of the turn (4.11): what each owes there
  // is read off that window's live controls, not here.
  if (state.script.counter) return null;
  // An attack on the table is rolled out in the attacker's window, and what
  // the other seat owes it (a defence roll, a Focus) is asked there. Nothing
  // else of the turn is asked of either seat until it is over: the unit that
  // holds the activation may not be the one attacking (an Interception is the
  // other squad's), and two attacks at once would each wait on the other.
  if (state.script.combatView) return null;
  // What is owed across the table comes before the phase, in the order the
  // turn panel asks (matchhud.ts panelHtml): a Smoke Screen a round's end
  // takes away, first of all.
  const thin = smokeOwed(data, state, seat);
  if (thin !== undefined) return thin;
  // A Forced Movement this seat's attack owes, as the Forced Movement panel
  // comes next (matchhud.ts panelHtml).
  const shoved = shoveOwed(data, state, seat, mind);
  if (shoved) return shoved;
  if (liveIntercepts(state).length) return interceptOwed(data, state, seat);
  // A unit whose destruction detonates it does so "immediately": its squad
  // resolves the blast, and the other waits.
  const martyr = blastOwed(data, state, seat, mind, 'martyrdom');
  if (martyr !== undefined) return martyr;
  // A reaction is the defender's, to be had "immediately": its squad answers,
  // and the other waits for an answer that is really going to be asked for.
  if (state.script.reactions?.length) {
    const mine = reactionOwed(data, state, seat);
    if (mine) return mine;
    if (reactionOwed(data, state, other(seat))) return null;
  }
  // A camouflaged unit that owes its Reveal makes it, and says where it
  // appears; the squad whose won Scan it is waits for it.
  const reveal = revealOwed(data, state, seat);
  if (reveal !== undefined) return reveal;
  // Then the blasts the board owes: a Mine under a unit, an Immediate
  // Projectile that has landed, a Pholcus that must Detonate.
  const blast = blastOwed(data, state, seat, mind, 'board');
  if (blast !== undefined) return blast;
  // Mines a walk this seat's unit has just made may still Lay (006_A).
  const lay = minesOwed(data, state, seat, mind);
  if (lay) return lay;
  const phase = PHASES[state.round.phase];
  if (state.round.phase === 1) return planningOwed(data, state, seat, mind);
  // The cards' own questions are put to a seat that answers, and to an asker
  // looking ahead that names them: one that wants only some kinds of answer is
  // shown what comes next as though the card were let go.
  const cardsWanted = !want?.only || wants(want, 'tactic');
  if (state.round.phase === 2) {
    // Hit and Run, in the gap after one of its Mechs' Opportunity ends.
    const run = cardsWanted ? hitAndRunOwed(data, state, seat, mind) : null;
    if (run) return run;
    return withCards(data, state, seat, mind, actionOwed(data, state, seat, want), ['277', '278'], want);
  }
  // Additional Instructions beside the Command Phase's designations and at its
  // Continue: not inside a Drone's activation, which the card has no part in.
  if (isLoopPhase(phase)) {
    const d = withCards(data, state, seat, mind, loopOwed(data, state, seat, phase, want), phase === 'Command' && !state.script.opp ? ['274'] : [], want);
    // And Aster's Link, beside the same designations.
    return phase === 'Command' && !state.script.opp ? withAster(data, state, seat, d, want) : d;
  }
  // A seat's End Phase cards, before the steps.
  const cards = cardsWanted ? endCardsOwed(data, state, seat, mind) : null;
  if (cards) return cards;
  const end = endOwed(data, state, seat);
  // A shared step is asked of both seats and marked, so whoever runs the table
  // can say which of them takes it.
  return end;
}

// WHAT COMES NEXT: the table as these commands would leave it, and what `seat`
// would be asked there. Null when the engine would refuse one of them. Nothing
// is sent and the table in play is not touched: an asker that is thinking
// ahead thinks on a copy, and is handed the copy so that whatever it works out
// about the next question (the odds of an attack in it) is worked out there.
// `born` names the units the commands put on the board (a Projectile launched).
export function owedAfter(
  data: GameData, state: GameState, seat: Side, mind: SeatMind, commands: Command[], want?: Want,
): { table: GameState; decision: Decision | null; born: number[] } | null {
  const table = tableAfter(data, state, commands);
  if (!table) return null;
  const was = new Set(state.tokens.map((x) => x.uid));
  return { table, decision: owed(data, table, seat, mind, want), born: table.tokens.filter((x) => !was.has(x.uid)).map((x) => x.uid) };
}

// WHO WOULD SEE A UNIT in each of several Grids: for each Grid, the units of
// the other squad that would have line of sight to it standing there, as the
// board stands (4.2.4: terrain three inches high blocks a line; 4.16: so does a
// Smoke Screen). What a player reads off the table when looking for cover, and
// nothing more: not Range, not an arc, not whether anything could be fired. It
// is the board's own reading (rules.ts firingSight), the unit put down in each
// Grid where the board would stand it. A Grid it could not stand in is seen
// by nobody.
//
// With `from`, the eyes are not units but Grids: for each Grid asked about,
// which of the `from` Grids a Large unit standing in would see it from (their
// places in that list). How a seat reads a lane before anybody stands in it:
// the Grids the other squad will deploy in are known, the units are not yet
// there.
// A TABLE WITH ONE UNIT GONE FROM IT, as it would be had the unit been
// destroyed: for LOOKING at, by a seat that wants to know what destroying it
// would change (who would hold which zone without it). The unit is taken off
// the list and nothing else is touched; the table in play is not, and nothing
// is sent. A turn in progress may still name the unit, so this is a table to
// read a view of and not one to play on.
export function tableWithout(state: GameState, uid: number): GameState {
  return { ...state, tokens: state.tokens.filter((t) => t.uid !== uid) };
}

// HOW LONG A WALK IS: for a unit, from each Grid of `from` to the nearest Grid
// of `to`, the Grids on the shortest road and the fewest activations a walk
// takes (turn.ts walkField: the board as its own Movement reads it, a Mech's
// Maneuver before its Movement Action, a Movement ending in the Grid it
// crushes its way into, the units on the board left out). Null where no road
// leads, and for a unit that is not there or cannot move.
//
// `left` is what is still unspent of an activation under way, as Ranges in the
// order they would be made: the walk is then counted from after it, and 0
// activations says those Movements reach by themselves.
//
// A field is the same until the terrain changes, and working one out is a
// search of the board for every Grid of `to`. `kept` is a memory the asker
// may hand in: a field is kept there by everything it was read from (turn.ts
// walkKey), so one taken from it is the one that would be worked out again.
//
// `via` is a Grid the walk goes by way of: a Black Box lying there, fetched on
// the way to the Grids that pay for it. The fetch and the carry are counted as
// one walk (turn.ts walkField), and the Grids are those of both roads.
export type WalkMemo = Map<string, turn.WalkField>;
export function walkIn(
  data: GameData, state: GameState, uid: number, from: { c: number; r: number }[], to: { c: number; r: number }[],
  left?: number[], kept?: WalkMemo, via?: { c: number; r: number },
): ({ grids: number; turns: number } | null)[] {
  const t = state.tokens.find((x) => x.uid === uid);
  if (!t || !to.length) return from.map(() => null);
  const key = `${turn.walkKey(data, state, t)}|${to.map((g) => `${g.c},${g.r}`).join(';')}${via ? `|via ${via.c},${via.r}` : ''}`;
  let field = kept?.get(key);
  if (!field) {
    field = turn.walkField(data, state, t, to, via);
    kept?.set(key, field);
  }
  const { walks, after } = field;
  return from.map((g) => {
    const walk = walks.get(`${g.c},${g.r}`);
    if (!walk) return null;
    if (!left) return { grids: walk.grids, turns: walk.turns };
    const more = after(g, left);
    return more === null ? null : { grids: walk.grids, turns: more };
  });
}

export function sightedIn(data: GameData, state: GameState, uid: number, grids: { c: number; r: number }[], from?: { c: number; r: number }[]): number[][] {
  const t = state.tokens.find((x) => x.uid === uid);
  if (!t) return grids.map(() => []);
  const terrain = turn.terrainOf(data, state);
  const smoke = state.smoke ?? [];
  const others = state.tokens.filter((x) => x.uid !== uid);
  const foes = others.filter((x) => x.side !== t.side && x.deployed !== false && alive(x));
  const here = largeGridOf(t);
  if (from) {
    // A unit that fills its Grid, standing in each of them in turn.
    const eyes = from.map((g) => ({ ...t, uid: -1, size: 3, aerial: false, mine: undefined, deployed: true, col: g.c * 3, row: g.r * 3 }) as Token);
    return grids.map((g) => {
      const spot = standingSpot(g.c, g.r, t.size, t.aerial, terrain, others, t.uid);
      if (!spot) return [];
      const there = { ...t, col: spot.col, row: spot.row };
      const tokens = [...others, there];
      return eyes.flatMap((e, i) => {
        if (e.col === there.col && e.row === there.row) return [];
        const sight = firingSight(e, there, terrain, tokens, smoke);
        return sight === 'clear' || sight === 'obstructed' ? [i] : [];
      });
    });
  }
  return grids.map((g) => {
    const spot = g.c === here.c && g.r === here.r && t.deployed !== false
      ? { col: t.col, row: t.row }
      : standingSpot(g.c, g.r, t.size, t.aerial, terrain, others, t.uid);
    if (!spot) return [];
    const there = { ...t, col: spot.col, row: spot.row };
    const tokens = [...others, there];
    return foes.filter((e) => {
      const sight = firingSight(e, there, terrain, tokens, smoke);
      return sight === 'clear' || sight === 'obstructed';
    }).map((e) => e.uid);
  });
}

// Whether a unit's turn of this round is behind it, or is the one being taken:
// each kind of unit acts of its own accord in one phase (a Mech in the Action
// Phase, a Drone in the Automatic Phase, a Projectile in the Delay Phase).
function turnBehind(state: GameState, t: Token): boolean {
  const own = PHASES.indexOf(t.kind === 'mech' ? 'Action' : t.kind === 'drone' ? 'Automatic' : 'Delay');
  if (state.round.phase !== own) return state.round.phase > own;
  const sc = state.script;
  return !!sc && (sc.acted.includes(t.uid) || sc.opp?.uid === t.uid);
}

// A UNIT'S OWN TURN, LOOKED AT BEFORE IT COMES: what it would be asked if its
// activation opened now, on the table as it stands. A Mech is asked as on the
// Timing given, every other Mech having had its Opportunity: the question that
// dial would open (3.4.2). A Drone is asked in the Automatic Phase and a
// Projectile in the Delay Phase, where their own Actions are performed. The
// other squad will have moved by the time the turn really comes; this is the
// board a dial is chosen on, and a Landing Point.
//
// The Timing is the asker's to name and never read off the unit: a dial not
// yet revealed is nobody's to look at (3.3). Null for a unit that is not
// there, and for a Mech with no Timing named.
//
// A TURN IN A LATER ROUND COMES AFTER THE END PHASE. A unit whose turn of this
// round is behind it (or is the one being taken) is next activated a round
// on, and by then the End Phase has run: a Mech down to two Parts has left
// the board, a yellow Token has turned and a red one has come off (3.7.1,
// 3.7.2). Those two steps are run on the copy first, by the engine's own
// command, so a unit jammed for this round is asked as the unit it will be
// when its turn comes, and one that will not be there is asked nothing. After
// the last round there is no later turn at all.
export function owedIfActivated(
  data: GameData, state: GameState, uid: number, timing?: Timing, want?: Want,
): { table: GameState; decision: Decision | null } | null {
  const table = copyAsJson(state);
  let t = table.tokens.find((x) => x.uid === uid);
  const sc = table.script;
  if (!t || !sc || t.deployed === false || !alive(t)) return null;
  if (turnBehind(table, t)) {
    if (table.round.n >= (table.roundLimit ?? 5)) return null;
    for (const step of ['remove', 'tokens'] as const) apply(data, table, { kind: 'markEndStep', seat: t.side, step });
    table.round.n += 1;
    t = table.tokens.find((x) => x.uid === uid);
    if (!t || !alive(t)) return null;
  }
  sc.counter = null;
  sc.passed = [];
  // A Reveal that is owed is made at once (4.12.2), before any later turn
  // comes: a unit that owes one stands on the copy as it will by then, seen.
  // (Where it appears is its player's to say; where it stands is the one
  // place that can be reckoned with.)
  const shown = new Set([...(sc.revealDue ?? []).map((x) => x.uid), ...(sc.reactions ?? []).filter((r) => r.kind === 'manifest').map((r) => r.uid)]);
  if (shown.size) {
    for (const x of table.tokens) if (shown.has(x.uid)) x.statuses = (x.statuses ?? []).filter((id) => id !== 'camouflage');
    sc.revealDue = [];
    sc.reactions = (sc.reactions ?? []).filter((r) => r.kind !== 'manifest');
  }
  if (t.kind === 'mech') {
    if (!timing) return null;
    t.timing = timing;
    table.round.phase = PHASES.indexOf('Action');
    sc.revealed = ['s1', 's2'];
    sc.acted = table.tokens.filter((x) => x.kind === 'mech' && x.uid !== uid).map((x) => x.uid);
    sc.opp = null;
    sc.oppStack = [];
    // The Opportunity as the turn order mints it, Extra Ticks and all.
    if (opportunity(data, table)?.uid !== uid) return null;
  } else {
    table.round.phase = PHASES.indexOf(t.kind === 'projectile' ? 'Delay' : 'Automatic');
    sc.acted = sc.acted.filter((x) => x !== uid);
    sc.opp = newOpportunity(uid, undefined);
    sc.oppStack = [];
  }
  sc.stage = `${table.round.n}:${table.round.phase}`;
  // A unit that blows up of its own accord is asked that, and no activation:
  // an Immediate Projectile where it has landed (taken to have come through
  // whatever Interception its launch owes), and an Unfolded Pholcus with an
  // enemy in reach as the Automatic Phase finds it.
  const now = immediatesOwed(data, [t], [])[0] ?? (t.kind === 'drone' ? autoDetonationsOwed(data, table.tokens).find((x) => x.uid === uid) : undefined);
  if (now) {
    const debt: BlastDebt = { uid, actionId: now.actionId, kind: t.kind === 'drone' ? 'automatic' : 'immediate', ...('targets' in now ? { only: now.targets as number[] } : {}) };
    return { table, decision: blastAsk(data, table, t, debt, NOBODY) };
  }
  return { table, decision: activationOwed(data, table, t.side, t, want) };
}
