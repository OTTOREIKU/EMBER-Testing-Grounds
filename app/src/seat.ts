// THE SEAT SEAM. What one seat can SEE of the table, and what it OWES and may
// do next: the whole of what a computer player is ever told about the rules.
//
// OTTO, 2026-10-01: "we need to make sure the scaffolding for the AI code has
// an easy time picking up the engine so if we make fundamental changes down
// the line it doesnt break the AI, or if we add new features it will more
// easily be able to understand how to use them or at least make it easy for us
// to wire them in." This file is that scaffolding (Project-Documents/
// AI-OPPONENT-PLAN.md, section 3):
//
//   - A computer player imports this module and nothing else of the engine.
//     If the engine is rebuilt, this is the one file to rewrite for it.
//   - It never builds a command. It picks an Option; the Option carries the
//     commands. When a rule changes, the options change with it, here.
//   - It reads the table through viewOf(), which leaves out the one thing a
//     seat may not see: the other squad's Timing Dials before the reveal (3.3).
//
// Nothing here is strategy, and nothing here knows a computer exists: a view
// is what a second player's screen would show, and a decision is what their
// turn panel would ask.
import type { Command } from './commands';
import type { GameData } from './data';
import { parseGridRef } from './data';
import { alive } from './loop';
import { meleeCapable } from './melee';
import { lowValueOf, missionScoring, zoneCellsOf } from './scoring';
import { normaliseSetup, type SetupStage } from './setup';
import { boxHands, controlOf, normaliseTasks } from './tasks';
import { canManeuver, extrasLeft, lengthOf, timingOf, type ActionLength } from './ticks';
import { actionRoute, shockWalk, type ActionRoute } from './turn';
import { PHASES, statusCount, zonesOf } from './types';
import type { CardAction, Facing, GameState, PartState, Side, Stance, Timing, Token } from './types';
import { extraActivationOf, freehandSlots, isGroundUnit, maneuverRange, maxLink, onHitRiders, structureOf, tokenCards } from './units';

// ---------- the view ----------

// One Part of a unit as the table shows it. A Drone or a Projectile has the
// one, `main`.
export interface PartView {
  slot: string;
  cardId: string;
  state: PartState;
  armor: number;
  structure: number;
  points: number;
  // Bears a Repaired Token: destroyed, and its Actions work again (FAQ J21).
  repaired: boolean;
}

// One Action a unit carries that a player chooses to perform. What it IS, read
// off the card and the unit: whether it may be performed now is a question of
// the turn, and is answered by the options of a Decision.
export interface WeaponView {
  // The Part it sits on (`main` for a Drone), or `pilot`.
  slot: string;
  actionId: string;
  name: string;
  // The card's Action Type: Firing, Melee, Moving, Projectile, Swift, Tactic,
  // Immediate, Delay.
  type: string;
  // A Mech's Action has a Timing and a length; a Drone's has a control mode
  // (`command`, `auto`) in their place.
  timing?: Timing;
  length?: ActionLength;
  mode?: string;
  range: number;
  yellow: number;
  red: number;
  // Ammo Tokens still face up, for an Action that carries them.
  ammo?: number;
  // A Projectile Action: how far from the Grid it lands in the Projectile it
  // launches can strike (the farthest of them, where it may launch several).
  strike?: number;
  // The Tokens a Hit puts on the target, where the Action carries an [On Hit]
  // rider (units.ts onHitRiders, as the combat window reads it): `fci` for a
  // Laser Suppression, `fragile` for a Laser Weapon.
  riders?: string[];
  // A Tactic made at a Range that serves its own squad alone: a Part mended,
  // Link or Ammo given back, a Token cleaned off an ally, a Stance fed back,
  // or a change to the unit itself (turn.ts actionRoute). Its Range is no reach
  // on an enemy.
  own?: boolean;
  // A Tactic that hands an Ally Mech an Extra Action Opportunity (Coordinate,
  // 009_A): its Range is where the Ally stands, no reach on an enemy either.
  // Routed as card text (units.ts extraActivationOf), so not `own`.
  grants?: boolean;
  // A Melee Action's Shock Attack X as the unit stands (turn.ts shockWalk): how
  // far it may walk before the attack. Absent for none.
  shock?: number;
  // Its Part still works: not destroyed, or destroyed and Repaired.
  usable: boolean;
}

// A Melee Action's Shock Attack walk, where it has one (`shock`).
function shockOf(state: GameState, t: Token, a: CardAction): { shock?: number } {
  const x = a.type === 'Melee' ? shockWalk(state, t, a) : 0;
  return x > 0 ? { shock: x } : {};
}

// The Action Routes of a Tactic that serves its own squad alone (`own`).
const OWN_ROUTES = new Set<ActionRoute>(['resupply', 'link', 'stanceFeedback', 'cleanup', 'repair', 'charge', 'form', 'camo', 'transform', 'selfStatus', 'discard', 'stabilise']);

export interface UnitView {
  uid: number;
  side: Side;
  kind: 'mech' | 'drone' | 'projectile';
  cardId: string;
  label: string;
  // The Large Grid it stands in, and its own cell and footprint for the pages
  // that need them.
  grid: { col: number; row: number };
  cell: { col: number; row: number };
  size: number;
  facing: Facing;
  // False while it waits in its squad to be deployed.
  deployed: boolean;
  alive: boolean;
  stance: Stance;
  link?: number;
  linkMax?: number;
  // The dial this seat may see. Absent when none is set, AND when it is the
  // other squad's and not yet revealed; `dialHidden` tells those two apart.
  timing?: Timing;
  dialHidden: boolean;
  statuses: string[];
  aerial: boolean;
  // A Ground unit: one an enemy in a Grid beside its own may Melee Lock,
  // which bars its Firing Actions (4.3.5). An Aerial or a Flying unit is not.
  ground: boolean;
  // It could strike in Melee as it stands, so it Melee Locks an enemy Ground
  // unit beside it (unless it is in Optical Camouflage).
  locks: boolean;
  camouflaged: boolean;
  parts: PartView[];
  // 1 whole, 0 gone: each Part counting 1 intact, a half damaged, 0 destroyed.
  health: number;
  points: number;
  weapons: WeaponView[];
  // How far its Maneuver goes, in Grids (a Mech; 0 otherwise).
  maneuver: number;
  // How far one Movement of its own takes it, in Grids: a Mech's Maneuver, a
  // Drone's move. A Projectile does not move itself.
  move: number;
  // This squad's Commander on a VIP mission.
  commander: boolean;
  // The slots holding a Charge Token that is face up.
  charged: string[];
  // Low Value: it neither holds a Tactical Zone nor keeps the other squad
  // from holding it (a Projectile, a Drone that costs nothing).
  lowValue: boolean;
  // It has had its turn this round: a Mech its Action Opportunity, a Drone
  // its activation of the Automatic Phase, a Projectile its Delayed Action.
  // False while the turn is still to come, and while it is being taken.
  done: boolean;
  // How many Black Boxes it could still pick up: its Freehand Parts not
  // already bearing one (5.3.1). 0 on a table with no Black Box.
  hands: number;
  // A Drone carrying a Load (a Carrier, 162: "Ally Mechs in Contact with this
  // drone may regard the Load of this drone as their own Part when they
  // perform actions"). The Load's Actions are the Mech's it is lent to, never
  // the Drone's own, so they are not among its weapons.
  lends: boolean;
}

// A Black Box, on a table whose Main Task put some there (5.3.1): lying in a
// Grid for whoever passes, or carried. It pays whoever carries it as the game
// ends.
export interface BoxView {
  id: string;
  // The Large Grid it lies in; null while a unit carries it.
  grid: { col: number; row: number } | null;
  // The unit carrying it, or null.
  bearer: number | null;
}

// The Main Task as its card prints it: what it pays, for what, and when.
export interface TaskView {
  // 'control' (zones held), 'vip' (the Commanders), 'blackbox', 'terminal'.
  family: string;
  // The Victory Points it pays each time: for a zone, a Box, a Terminal, the
  // enemy Commander destroyed.
  vp: number;
  // The first round it pays in, and whether it pays every round from then or
  // once, as the game ends.
  fromRound: number;
  cadence: string;
  // VIP: what each destroyed Part of the enemy Commander pays at the round
  // limit, when neither Commander has been destroyed.
  perPart: number;
  // The one zone a held Box must be carried into, where the card names one.
  scoringZone: string | null;
  // Terminals: how far from a Terminal's zone, in Grids, a Mech may stand and
  // still access it with a Remote Access (5.3.3). 0 for any other Task.
  reach: number;
}

export interface ZoneView {
  id: string;
  name: string;
  // Its Large Grids, as "col,row".
  cells: string[];
  // Who controls it as the board stands now (5.3.2), or nobody.
  holder: Side | null;
  // Who its Control dial names, on a mission that has one. The dial keeps its
  // holder until the other squad takes the zone, so it may name a squad with
  // nobody left inside; it is what the Main Task pays on.
  control: Side | null;
  // One of the zones the Main Task scores.
  scoring: boolean;
  // A zone holding a Terminal: who has accessed it this round, or null while
  // nobody has. It pays whoever that is as the round ends, and whoever holds
  // the zone then takes one still open; every Terminal opens again for the
  // next round (5.3.3). Absent where there is no Terminal.
  accessed?: Side | null;
}

// The Action Opportunity that is open, whoever's it is.
export interface OpportunityView {
  uid: number;
  mine: boolean;
  // The Maneuver Tick can still be used; the Action Ticks left in the pool;
  // the Extra Ticks still in hand (each pays for one Short Action, 3.4.5).
  maneuver: boolean;
  actionTicks: number;
  extraTicks: number;
  // The Stance has been confirmed this Opportunity (4.1).
  stanceLocked: boolean;
  performed: string[];
  // An Extra Action Opportunity (FAQ K21), or one a Command opened.
  extra: boolean;
  commanded: boolean;
}

export interface SeatView {
  seat: Side;
  other: Side;
  round: number;
  roundLimit: number;
  // The phase, by index into PHASES and by name.
  phase: number;
  phaseName: string;
  firstPlayer: Side;
  // Where setup stands: null with no game on, `done` once the rounds begin.
  setup: SetupStage | null;
  mission: string | null;
  // The Main Task's terms, read off its card; null with no Main Task set.
  task: TaskView | null;
  noSecondary: boolean;
  units: UnitView[];
  zones: ZoneView[];
  // The Black Boxes on the table; none on a table whose Main Task has none.
  boxes: BoxView[];
  vp: Record<Side, number>;
  commandTokens: Record<Side, number>;
  opportunity: OpportunityView | null;
}

const HEALTH: Record<string, number> = { intact: 1, damaged: 0.5, destroyed: 0 };

// A Timing Dial is the one thing a seat may not see (3.3): the other squad's,
// through the Planning Phase, until that squad has revealed or the dials are
// locked. Read off the STATE alone and never off which browser is asking, so a
// computer seat sharing the player's page is shown exactly what a second
// player's screen would have been sent.
function dialSeen(state: GameState, t: Token, seat: Side): boolean {
  if (t.side === seat) return true;
  if (state.round.phase !== 1) return true;
  const sc = state.script;
  if (!sc) return true;
  if (sc.revealed.includes(t.side)) return true;
  return sc.stage === `${state.round.n}:1:locked`;
}

// How far the Projectiles a Part may launch reach from where they land: the
// longest Range any of their own Actions prints.
function strikeOf(data: GameData, launched: unknown): number {
  const ids = Array.isArray(launched) ? launched as string[] : [];
  return Math.max(0, ...ids.flatMap((id) => (data.byId.get(id)?.actions ?? []).map((a) => a.range ?? 0)));
}

// Whether a unit's own turn of this round is behind it. Each kind of unit has
// one phase it acts in of its own accord (3.4, 3.5, 3.6): before that phase
// its turn is still to come, after it the turn is gone, and inside it the
// table's own record of who has acted says which.
const OWN_PHASE: Record<Token['kind'], number> = {
  mech: PHASES.indexOf('Action'), drone: PHASES.indexOf('Automatic'), projectile: PHASES.indexOf('Delay'),
};
function turnDone(state: GameState, t: Token): boolean {
  const own = OWN_PHASE[t.kind];
  if (state.round.phase !== own) return state.round.phase > own;
  // A Drone or a Projectile is recorded as having acted the moment it is
  // designated, a Mech when its Opportunity is ended: either way the turn is
  // behind it once the activation is no longer the open one.
  const sc = state.script;
  return !!sc && sc.acted.includes(t.uid) && sc.opp?.uid !== t.uid;
}

// The Tokens an Action's Hit puts on its target, read once a card Action: the
// cards do not change while a page is open, and a view is made of every table a
// seat thinks about.
const RIDERS = new WeakMap<CardAction, string[]>();
function ridersOf(a: CardAction): string[] {
  let out = RIDERS.get(a);
  if (!out) RIDERS.set(a, out = onHitRiders(a).filter((r) => r.kind === 'status' && !!r.statusId).map((r) => String(r.statusId)));
  return out;
}

function unitView(data: GameData, state: GameState, t: Token, seat: Side, commander: boolean, lowValue: boolean, hands: number): UnitView {
  const cards = tokenCards(data, t);
  const repaired = new Set(t.repairedSlots ?? []);
  // A Mech's five Parts; anything else is its one card. A Load is its
  // Carrier's cargo, not a Part of it: a hit on a Tarantula lands on `main`.
  const bodies = t.kind === 'mech' ? cards.filter((c) => c.slot !== 'pilot') : cards.filter((c) => c.slot === 'main');
  const parts: PartView[] = bodies.map(({ slot, card }) => ({
    slot,
    cardId: card.id,
    state: (t.partStates[slot as keyof Token['partStates']] ?? 'intact') as PartState,
    armor: card.armor ?? 0,
    structure: structureOf(data, t, slot as Parameters<typeof structureOf>[2]),
    points: card.score ?? 0,
    repaired: repaired.has(slot),
  }));
  const stateOf = new Map(parts.map((p) => [p.slot, p]));
  const weapons: WeaponView[] = [];
  for (const { slot, card } of cards) {
    // A Load's Actions are the Mech's it is lent to, never the Carrier's own
    // (FAQ O4), so a Drone lists its own card's alone.
    if (t.kind !== 'mech' && slot !== 'main') continue;
    for (const a of card.actions ?? []) {
      if (a.type === 'Passive' || a.speed === 'passive') continue;
      const part = stateOf.get(slot);
      const riders = ridersOf(a);
      weapons.push({
        slot,
        actionId: a.id,
        name: a.name?.en || a.name?.zh || a.id,
        type: a.type ?? '',
        timing: t.kind === 'mech' ? timingOf(a) : undefined,
        length: t.kind === 'mech' ? lengthOf(a) : undefined,
        mode: t.kind === 'mech' ? undefined : a.speed,
        range: a.range ?? 0,
        yellow: a.yellowDice ?? 0,
        red: a.redDice ?? 0,
        ammo: a.id in t.ammo ? t.ammo[a.id] : undefined,
        ...(a.type === 'Projectile' ? { strike: strikeOf(data, card.projectile) } : {}),
        ...(riders.length ? { riders } : {}),
        ...(a.type === 'Tactic' && (a.range ?? 0) > 0 && OWN_ROUTES.has(actionRoute(data, t, a)) ? { own: true } : {}),
        ...(a.type === 'Tactic' && extraActivationOf(a) ? { grants: true } : {}),
        ...shockOf(state, t, a),
        usable: !part || part.state !== 'destroyed' || part.repaired,
      });
    }
  }
  // Only a Mech has a dial to hide.
  const seen = t.kind !== 'mech' || dialSeen(state, t, seat);
  return {
    uid: t.uid,
    side: t.side,
    kind: t.kind,
    cardId: t.cardId,
    label: t.label,
    grid: { col: Math.floor(t.col / 3), row: Math.floor(t.row / 3) },
    cell: { col: t.col, row: t.row },
    size: t.size,
    facing: t.facing,
    deployed: t.deployed !== false,
    alive: alive(t),
    stance: t.stance,
    link: t.kind === 'mech' ? t.link : undefined,
    linkMax: t.kind === 'mech' ? maxLink(data, t) : undefined,
    timing: seen ? t.timing : undefined,
    dialHidden: !seen,
    statuses: [...(t.statuses ?? [])],
    aerial: t.aerial,
    ground: isGroundUnit(data, t),
    locks: meleeCapable(data, t),
    camouflaged: statusCount(t.statuses, 'camouflage') > 0,
    parts,
    health: parts.length ? parts.reduce((n, p) => n + (HEALTH[p.state] ?? 1), 0) / parts.length : 0,
    points: cards.reduce((n, c) => n + (c.card.score ?? 0), 0),
    weapons,
    maneuver: t.kind === 'mech' ? maneuverRange(data, t) : 0,
    move: t.kind === 'projectile' ? 0 : maneuverRange(data, t),
    commander,
    charged: [...(t.charge ?? [])],
    lowValue,
    done: turnDone(state, t),
    hands,
    lends: t.kind === 'drone' && cards.some((c) => c.slot !== 'main' && c.slot !== 'pilot'),
  };
}

// The table as `seat` may see it. A fresh object every call, sharing nothing
// with the state, so a reader can keep it or pick it apart freely.
export function viewOf(data: GameData, state: GameState, seat: Side): SeatView {
  const other: Side = seat === 's1' ? 's2' : 's1';
  const tasks = normaliseTasks(state.tasks);
  const mission = state.mission ? data.missions.cards.find((c) => c.id === state.mission) : undefined;
  const scoring = new Set((mission?.zones ?? []).map((z) => z.toLowerCase()));
  const cellsOf = zoneCellsOf(data, state);
  const lowValue = lowValueOf(data);
  // Each zone's Control dial, where the Main Task laid one.
  const dials = new Map(tasks.items.filter((i) => i.kind === 'control').map((i) => [i.zone, i.control ?? null]));
  // Each zone's Terminal, where the Main Task put one: who accessed it this round.
  const terminals = new Map(tasks.items.filter((i) => i.kind === 'terminal').map((i) => [i.zone, i.accessed ?? null]));
  const zones: ZoneView[] = zonesOf(data.zoneData.zones, state).map((z) => {
    const refs = cellsOf(z.id);
    return {
      id: z.id,
      name: z.name,
      cells: refs.map((r) => parseGridRef(r)).filter((g): g is { col: number; row: number } => !!g).map((g) => `${g.col},${g.row}`),
      holder: controlOf(refs, state.tokens, lowValue),
      control: dials.get(z.id) ?? null,
      scoring: scoring.has(z.name.toLowerCase()) || scoring.has(z.id.toLowerCase()),
      ...(terminals.has(z.id) ? { accessed: terminals.get(z.id) ?? null } : {}),
    };
  });
  const boxes: BoxView[] = tasks.items.filter((i) => i.kind === 'blackbox').map((i) => ({
    id: i.id,
    grid: i.bearerUid === undefined && i.col !== undefined && i.row !== undefined ? { col: Math.floor(i.col / 3), row: Math.floor(i.row / 3) } : null,
    bearer: i.bearerUid ?? null,
  }));
  // A hand free for a Box is worked out only where there is a Box to take.
  const hands = (t: Token): number => (boxes.length && t.kind !== 'projectile' ? freehandSlots(data, t, boxHands(state.tasks, t.uid), [], true).length : 0);
  const o = state.script?.opp ?? null;
  const holder = o ? state.tokens.find((t) => t.uid === o.uid) : undefined;
  // The scorer's own reading of the card (scoring.ts), so the terms a seat
  // plans by are the terms the Award pays by.
  const terms = mission ? missionScoring(mission) : null;
  return {
    seat,
    other,
    round: state.round.n,
    roundLimit: state.roundLimit ?? 5,
    phase: state.round.phase,
    phaseName: PHASES[state.round.phase] ?? '',
    firstPlayer: state.round.firstPlayer,
    setup: normaliseSetup(state.setup)?.stage ?? null,
    mission: state.mission ?? null,
    task: terms
      ? {
          family: terms.family ?? '', vp: terms.vp, fromRound: terms.fromRound, cadence: terms.cadence, perPart: terms.vpPerPart ?? 0, scoringZone: terms.scoringZone ?? null,
          reach: terms.family === 'terminal' ? data.commonActions.find((a) => a.id === 'COMMON_REMOTE_ACCESS')?.range ?? 4 : 0,
        }
      : null,
    noSecondary: !!state.noSecondary,
    units: state.tokens.map((t) => unitView(data, state, t, seat, tasks.leader[t.side] === t.uid, lowValue(t), hands(t))),
    zones,
    boxes,
    vp: { s1: tasks.vp.s1, s2: tasks.vp.s2 },
    commandTokens: { s1: state.commandTokens.s1 ?? 0, s2: state.commandTokens.s2 ?? 0 },
    opportunity: o && holder
      ? {
          uid: o.uid,
          mine: holder.side === seat,
          maneuver: canManeuver(o).ok,
          actionTicks: o.action,
          extraTicks: extrasLeft(o).length,
          stanceLocked: !!o.stanceLocked,
          performed: [...o.performed],
          extra: !!o.extra,
          commanded: !!o.commanded,
        }
      : null,
  };
}

// ---------- what a seat owes: the types ----------
//
// A Decision is one open question put to one seat, with every legal answer.
// The answers are built here, by the engine, from the same functions the
// pages use; a computer player only ever chooses one of them.

// What an attack is likely to do, before a die is thrown: chances from 0 to
// 1, worked out from the combat window's own pools and its own reading of
// every face (ai/odds.ts). They assume what a table usually sees: neither side
// spends a Link on a reroll, the defender declares the Parry or the Shield that
// costs the attacker most, and an attacker who may choose the Part chooses the
// one that is worth most to it.
export interface Forecast {
  // At least one Hit, which is what an On Hit effect asks for; and a
  // Penetration.
  hit: number;
  pen: number;
  // A Part that was Intact ends the attack Damaged; a Part is destroyed; the
  // unit is destroyed, or is left with so few Parts that it leaves at the end
  // of the round (Integrity Loss). Not exclusive: a destroyed Torso is all of
  // the last two.
  damage: number;
  destroy: number;
  kill: number;
  // The Link the target is expected to lose: 1 for each Part destroyed, and
  // what a Concussion or Wrecking strips.
  link: number;
  // Where the hit is expected to land, and the chance of a Penetration there.
  parts: { slot: string; share: number; pen: number }[];
  // The Part this assumes the attacker designates, where it may.
  pick: string | null;
}

// A TABLE A SEAT IS ONLY THINKING ABOUT: the one an answer would leave, or the
// one its question was asked of. Three readings of it, each the seam's own
// (viewOf, owed, owedIfActivated) and each worked out when asked: nothing here
// is sent and the table in play is never touched.
export interface Outlook {
  // That table, as the seat sees it: who would hold which zone, who stands
  // where, in what Stance.
  view(): SeatView;
  // What the seat would be asked there, with the odds on its attacks; null
  // when it would be asked nothing, or nothing of the kinds wanted.
  owed(only?: string[]): Decision | null;
  // What a unit would be asked if its own activation opened on that table:
  // one of this squad's, or one of the OTHER squad's, which is how a seat
  // works out what an enemy could do to it from where an answer leaves things.
  // A Mech is asked on the Timing the asker names (a dial it can see, or one it
  // supposes), and not at all if it names none; a Drone in the Automatic
  // Phase; a Projectile in the Delay Phase. The question is put as that unit's
  // own seat would be put it, so its answers' `then` are that seat's.
  turnOf(uid: number, only?: string[], timing?: string): Decision | null;
  // Who would SEE a unit in each of several Grids of that table: for each
  // Grid, the units of the other squad with line of sight to it standing
  // there. Sight alone, as a player looking for cover reads it off the board:
  // whether anything could be fired along the line is `turnOf`'s to say.
  // With `from`, the eyes are Grids and not units: for each Grid asked about,
  // the places in `from` of the Grids a Large unit would see it from.
  seen(uid: number, grids: { col: number; row: number }[], from?: { col: number; row: number }[]): number[][];
  // How long a walk is, for a unit, from each Grid of `from` to the nearest
  // Grid of `to`: the Grids on the road and the activations it takes, by the
  // road its own Movement is drawn with (a wall is walked round, and a
  // Movement ends in the Grid it crushes its way into). The units standing on
  // the board are left out of it: this is the terrain's answer, for a walk of
  // several rounds. `left` is what is still unspent of an activation under
  // way, as Ranges: the activations are then counted from after it, and 0
  // says those Movements reach by themselves. Null where no road leads.
  // `via` is a Grid the walk goes by way of: a Black Box lying there, fetched
  // and then carried to `to`, counted as the one walk it is (a Movement that
  // enters the Box's Grid has the Box and goes on with what is left of it).
  walk(
    uid: number, from: { col: number; row: number }[], to: { col: number; row: number }[], left?: number[],
    via?: { col: number; row: number },
  ): ({ grids: number; turns: number } | null)[];
  // The same table with one unit gone from it, as it would be had the unit
  // been destroyed: what a seat looks at to see what destroying it would
  // change. Its view says who would hold which zone without it.
  without(uid: number): Outlook;
}

export interface Option {
  // Stable inside its Decision, so a choice can be named, logged and replayed.
  id: string;
  // What it is, in plain words, for the log and for the player.
  label: string;
  // What kind of thing choosing it does, so a rule can be written about a
  // kind and not about a card: 'move', 'attack', 'pass', 'stance', 'decline',
  // 'spend-link', and so on.
  tags: string[];
  // What choosing it sends. An answer that is more than commands (an attack
  // has dice in it) names a routine in `run` and gives it its arguments.
  commands?: Command[];
  run?: { routine: string; args: Record<string, unknown> };
  // What the answer is, in values a rule can read without taking the label or
  // the commands apart: the unit, the Grid and facing a Movement ends on, the
  // target and Action of an attack. By kind, like a Decision's facts.
  facts?: Record<string, unknown>;
  // An answer with dice in it (an attack): what it is likely to do, worked out
  // when asked. Null where no forecast can be made. Whoever puts the question
  // to a seat adds this; the question itself is plain data.
  chance?: () => Forecast | null;
  // An answer that opens an Electronic Counter-roll (an Electronic Attack, a
  // Scan, a Remote Access): the chance the Initiator wins it, neither side
  // taken to Focus (ai/odds.ts counterChance), on the table once its payment
  // has landed. Null where no reading can be made. Added, as `chance` is, by
  // whoever puts the question.
  win?: () => number | null;
  // A launch that owes Interception (4.9): the chance the Projectile comes
  // through it, each interceptor trying while it has Interception Tokens left
  // (FAQ M5), each try at the window's own odds of destroying it. Null where
  // no reading can be made. Added, as `chance` is, by whoever puts the question.
  survive?: () => number | null;
  // An answer that splits an attack's dice between targets (a Multi-Target's
  // split, FAQ B7): each target's share and what it is likely to do there,
  // the unit named being the one the dice land on. Added, as `chance` is, by
  // whoever puts the question.
  shares?: () => { targetUid: number; pool: { red: number; yellow: number }; chance: Forecast | null }[];
  // An answer that is commands alone: what this seat would be asked NEXT if it
  // gave it (the table after those commands, asked again), with the odds on
  // whatever attacks that question holds. Null when the seat would be asked
  // nothing, or nothing of the kinds wanted. `only` names the kinds of answer
  // worth building (their first tag: 'attack', 'move', 'stance' ...): a seat
  // looking for what it could shoot from a Grid asks for the attacks alone.
  // A Timing Dial has one too: what its Mech would be asked as the Action
  // Opportunity that dial opens began, on the table as it stands. And so has
  // an attack that is paid for before it is rolled: what would be asked once
  // it had been made, had its dice changed nothing, which says how much of
  // the activation is left behind it.
  then?: (only?: string[]) => Decision | null;
  // An answer of a unit's activation: what would be asked when a turn LATER
  // than this one comes, on the table as the answer leaves it, with the odds
  // on its attacks. For a launch that is the Projectile it puts down, in its
  // own phase. For anything else it is the unit itself, the next time it is
  // activated: a Drone's Automatic Action, a Mech's Action Opportunity on the
  // Timing the asker names (and null if it names none). So "could I attack
  // from the Grid this move ends in?" is the engine's to answer, walls and
  // Melee Locks included. Null when it would be asked nothing.
  later?: (only?: string[], timing?: string) => Decision | null;
  // An answer that is commands alone: the table it would leave, to be looked
  // at any way the seat likes. Null when the engine would refuse the answer.
  after?: () => Outlook | null;
}

export interface Decision {
  // The identity of the QUESTION, the same for as long as it stays open, so a
  // driver can tell it is being asked the same thing again.
  id: string;
  // What is being asked: 'setup.deploy', 'planning.dials', 'opp.act',
  // 'defence.focus'. Open-ended on purpose: a kind nobody has written a rule
  // for takes its `fallback` and the game goes on.
  kind: string;
  seat: Side;
  unit?: number;
  options: Option[];
  // The option that is always safe: decline, pass, or the first legal answer.
  fallback: string;
  // What the question is about, by kind: the attack in progress, the pool, the
  // unit being placed.
  facts: Record<string, unknown>;
  // A step of table bookkeeping (the End Phase's steps) that either seat may
  // take. `seat` names the one expected to; whoever runs the table may let the
  // other take it.
  shared?: boolean;
  // The table the question was asked of, for a seat that wants to look at it
  // as it stands: what an enemy could do to a unit that stays where it is.
  // Whoever puts the question to a seat adds this, as it adds the odds.
  here?: () => Outlook;
}

// A SEAT THINKING: everything asked of the board inside `pondering` is asked of
// boards that do not change while it runs, so a line of sight is walked once
// however many looks ask for it (rules.ts thinking). Whoever puts a question
// to a seat's judgement puts it inside one. It changes no answer, only how
// long the answers take.
export { thinking as pondering, musing } from './rules';

// What a seat owes, and when the game is over: built in owed.ts, read from
// here, so this module stays the whole of what a player of a seat imports.
export { owed, owedAfter, owedIfActivated, sightedIn, tableWithout, walkIn, gameOver, newMind, walkedKey, type MineOffer, type SeatMind, type GameOver, type WalkMemo, type Want } from './owed';
