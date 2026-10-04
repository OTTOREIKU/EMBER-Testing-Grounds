// THE BRAWLER: the first opponent worth playing. It is Watermelon's solo
// opponent rebuilt rule for rule on this engine (AI-OPPONENT-PLAN.md, section
// 5), so that the two can be played side by side: his ladder, his scoring, his
// numbers, under his names. None of his code is here. What he works out from a
// model of the dice, this reads off the answers it is handed.
//
// What it is: a fighter with no plan. Asked what a unit does, it takes the
// best attack on offer, unless one move would open a better one; with nothing
// to attack it walks at the enemy. An attack is worth what it is likely to
// destroy and nothing else. It never looks for cover, never minds the mission
// beyond a tie-break, never spends a Charge, and never thinks about what the
// other squad does next. Those are his weaknesses, kept on purpose: the
// Tactician (M7) is where ours begins.
//
// WHERE IT DIFFERS FROM HIS, and why:
//   - The odds are the engine's own (Option.chance): the pools a played attack
//     would roll, every keyword counted. His model knows the Stances alone.
//     The same rule, better numbers.
//   - It looks one move ahead and is asked again after every answer, where his
//     searches a whole activation at once. A Maneuver, then a move Action,
//     then an attack still comes out of it, a step at a time; where no attack
//     is one move away it walks the road to the nearest enemy, where his tries
//     two moves in a few directions.
//   - The Timing Dial is the one whose opening attack is worth most, the
//     earliest of equals. His takes the earliest Timing that opens with any
//     attack at all; with the odds in hand, this does not open with a Punch
//     when a gun is in reach.
//   - A Parry is declared when it costs the attacker more than declaring
//     nothing would, by those odds. His declares whenever it adds dice.
//   - A reroll is the selection worth most, by those odds. His weighs each die.
//
// Like every policy it is shown a Decision and a SeatView and nothing else
// (rule R4). What an option IS it reads off its tags and facts; what it would
// do, off its odds; what it would lead to, off `then` and `later`. Range and
// arc are worked out here only to choose what to ask the engine about, and to
// stand in for it where an answer has nobody to ask.
//
// What is exported beside the policy is what the Tactician builds on: the
// reading of a view as a board (Range, arc, who could strike whom, as far as
// geometry goes), and the answers given in the middle of an attack, which take
// the worth they weigh by and so serve a policy that weighs differently.
import type { Decision, Forecast, Option, SeatView, UnitView, WeaponView, ZoneView } from '../seat';
import type { Choice, Policy } from './policy';

// His tuning table, by his names (AI-OPPONENT-STUDY.md, Part 1), with the
// numbers his ladder and his planner carry in their own code beside them.
// Left out, because the odds answer in their place: PARRY_BASE_SCORE,
// PARRY_REFERENCE_DICE, SKIP_PARRY_SCORE, SKIP_REROLL_SCORE,
// DEFENDER_REROLL_WEIGHT, ATTACKER_REROLL_WEIGHT. Left out, because nothing in
// the copied games asks for them: APPROACH_ACTION_SCORE, MOVE_ACTION_SCORE,
// NON_UNIT_OPENING_SCORE, LINK_BOOST_UNLOCKS_SCORE, LOW_PRIORITY,
// PRESET_STEP_SCORE.
export const BRAWLER = {
  // What an attack is worth: the unit eliminated, a Part destroyed, a Part
  // Damaged. A Drone is worth its points, and half of them Damaged.
  ELIMINATE_VALUE: 150,
  DESTROY_PART_VALUE: 50,
  DAMAGE_PART_VALUE: 25,
  DRONE_DAMAGE_SHARE: 0.5,
  // An attack nobody could put odds on, an Electronic Attack, a launch.
  ATTACK_BASE: 2,
  STANCE_UNLOCKS_SCORE: 1.8,
  // The Timing Dial: an attack to open with, or a move.
  INTENT_OPENING_SCORE: 10,
  REPOSITION_OPENING_SCORE: 1.5,
  // A Command: 1, the unit's health, and this for each target in its reach.
  COMMAND_OPPORTUNITY_PER_TARGET: 0.5,
  // An Automatic or a Delay unit: this, and the health its best target has lost.
  AUTO_ACTION_TARGET_SCORE: 0.5,
  // A target at or below this health is one that can be killed.
  TARGET_KILL_OPPORTUNITY_THRESHOLD: 0.5,
  // Where to stand: a Grid it can attack from beats every Grid it cannot, and
  // how many enemies could attack it there is a tie-break and no more.
  ATTACK_GRID_SCORE: 1000,
  TARGET_COUNT_EPSILON: 0.001,
  THREAT_TIEBREAK_EPSILON: 0.001,
  MISSION_TIEBREAK_EPSILON: 0.0001,
  // Holding ground: a Grid that takes a zone the Main Task scores, and what
  // each Grid still to walk to one costs.
  OBJECTIVE_POINT_TIER: 1,
  TASK_DISTANCE_WEIGHT: 0.02,
  // A paid reroll: this chance of turning the roll, and this much Link in hand.
  PAID_REROLL_CHANCE: 0.25,
  PAID_REROLL_LINK: 2,
  // "Strictly better", for a move that reaches a better attack.
  BETTER_BY: 0.0001,
  // The Grids a move is tried from, at most; and the Grids put to the engine
  // when it is only looking for somewhere to stand.
  LANDING_CELLS: 24,
  MOVEMENT_CELLS_PER_STEP: 8,
} as const;

const B = BRAWLER;

// Looking the way it is going is worth a hair to a unit with nothing to
// attack: more than BETTER_BY, so that it will turn for it.
const FACING_EPSILON = 0.0005;
const EXACT = 1e-9;

// ---------- the board, as far as a view shows it ----------

export interface Grid { col: number; row: number }

export const apart = (a: Grid, b: Grid): number => Math.abs(a.col - b.col) + Math.abs(a.row - b.row);
export const beside = (a: Grid, b: Grid): boolean => Math.abs(a.col - b.col) <= 1 && Math.abs(a.row - b.row) <= 1;
export const same = (a: Grid, b: Grid): boolean => a.col === b.col && a.row === b.row;

// 0 north, 1 east, 2 south, 3 west.
const AHEAD = [[0, -1], [1, 0], [0, 1], [-1, 0]];

// The Forward Arc from a Grid: the quarter of the board in front, its
// diagonals included (4.2.5). Two units in one Grid are in each other's.
export function inFront(from: Grid, facing: number, at: Grid): boolean {
  const dc = at.col - from.col;
  const dr = at.row - from.row;
  if (!dc && !dr) return true;
  const [fc, fr] = AHEAD[facing] ?? AHEAD[0];
  const along = dc * fc + dr * fr;
  return along > 0 && Math.abs(dc * fr - dr * fc) <= along;
}

// The facing that looks from one Grid at another: along whichever axis they
// are further apart on.
export function facingAt(from: Grid, at: Grid): number {
  const dc = at.col - from.col;
  const dr = at.row - from.row;
  if (Math.abs(dr) >= Math.abs(dc)) return dr >= 0 ? 2 : 0;
  return dc >= 0 ? 1 : 3;
}

// Where an option that ends somewhere ends, and facing which way.
export function endOf(o: Option): Grid | null {
  const to = o.facts?.to as { c?: number; r?: number } | undefined;
  return to && typeof to.c === 'number' && typeof to.r === 'number' ? { col: to.c, row: to.r } : null;
}
export const facingOf = (o: Option): number | null => (typeof o.facts?.facing === 'number' ? o.facts.facing : null);

export const unitOf = (view: SeatView, uid: unknown): UnitView | undefined =>
  (typeof uid === 'number' ? view.units.find((u) => u.uid === uid) : undefined);

// The enemy units on the board that can be fought.
export const foesOf = (view: SeatView): UnitView[] =>
  view.units.filter((u) => u.side !== view.seat && u.deployed && u.alive && u.kind !== 'projectile');

// The Actions a unit attacks with, that still work and still have Ammo.
export const ready = (w: WeaponView): boolean => w.usable && (w.ammo === undefined || w.ammo > 0);
export const strikers = (u: UnitView): WeaponView[] => u.weapons.filter((w) => ready(w) && (w.type === 'Firing' || w.type === 'Melee'));

// Range as the engine reads it: a printed Range counts Grids along the rows
// and the columns, and an Action that prints none needs its target in a Grid
// beside its own, corner to corner included.
export const reaches = (w: WeaponView, from: Grid, at: Grid): boolean => (w.range > 0 ? apart(from, at) <= w.range : beside(from, at));

// Melee Lock (4.3.5): a Ground unit with an enemy in a Grid beside its own
// that could strike it in Melee makes no Firing attack from there.
export const lockedAt = (me: UnitView, at: Grid, foes: UnitView[]): boolean =>
  me.ground && foes.some((f) => f.locks && !f.camouflaged && beside(at, f.grid));

// Whether `me`, standing in `from` and facing `facing`, could attack `foe` as
// far as Range, the Forward Arc and a Melee Lock go (`locked`: it would stand
// Melee Locked there). This is geometry: sight, cover and what the turn still
// allows are the engine's to say, and it says them in the answers it offers.
export function couldStrike(me: UnitView, from: Grid, facing: number, foe: UnitView, locked: boolean): boolean {
  if (foe.camouflaged || !inFront(from, facing, foe.grid)) return false;
  return strikers(me).some((w) => reaches(w, from, foe.grid) && !(w.type === 'Melee' && foe.aerial) && !(w.type === 'Firing' && locked));
}

// ---------- his scoring ----------

// HIS TARGET SCORE (`De`). Four classes: it can kill the enemy Commander, it
// can kill, it can hurt the Commander, anything else; "can kill" is a target
// at half its health or less. Within a class the more hurt comes first, and
// the nearer breaks what is left.
export function targetScore(t: UnitView, range: number): number {
  const killable = t.health <= B.TARGET_KILL_OPPORTUNITY_THRESHOLD;
  const cls = t.commander ? (killable ? 0 : 2) : killable ? 1 : 3;
  return (4 - cls) * 100 + (cls === 3 ? 0 : (1 - t.health) * 10) + 1 / (1 + range);
}

// WHAT AN ATTACK IS WORTH, by its odds: 150 for the unit eliminated, 50 for a
// Part destroyed, 25 for a Part Damaged. A Drone is worth its points removed,
// and half of them Damaged.
export function attackWorth(f: Forecast, target: UnitView | undefined): number {
  if (target && target.kind !== 'mech') return target.points * (f.kill + B.DRONE_DAMAGE_SHARE * f.damage);
  return B.ELIMINATE_VALUE * f.kill + B.DESTROY_PART_VALUE * f.destroy + B.DAMAGE_PART_VALUE * f.damage;
}

// HIS "WHERE TO STAND" (`Ht`), for a Grid it could attack these targets from:
// 1000, the best target's score, and three tie-breaks a thousand times smaller
// (how many targets, whether the Grid scores, how many enemies could attack it
// there). Null with nothing to attack from it.
function standingOn(at: Grid, targets: UnitView[], view: SeatView, foes: UnitView[]): number | null {
  if (!targets.length) return null;
  const best = Math.max(...targets.map((t) => targetScore(t, apart(at, t.grid))));
  const threats = foes.filter((f) => strikers(f).some((w) => reaches(w, f.grid, at))).length;
  const gain = view.zones.some((z) => z.scoring && z.cells.includes(`${at.col},${at.row}`)) ? 1 : 0;
  return B.ATTACK_GRID_SCORE + best + Math.atan(targets.length) * B.TARGET_COUNT_EPSILON
    + Math.atan(gain) * B.MISSION_TIEBREAK_EPSILON - Math.atan(threats) * B.THREAT_TIEBREAK_EPSILON;
}

// The same, as far as geometry can say what could be attacked from a Grid.
export function standing(me: UnitView, at: Grid, facing: number, view: SeatView, foes: UnitView[]): number | null {
  const locked = lockedAt(me, at, foes);
  return standingOn(at, foes.filter((f) => couldStrike(me, at, facing, f, locked)), view, foes);
}

// The same, by the engine's own word (`later`): what the unit would really be
// offered to attack from where this answer leaves it, when its turn next
// comes. A Mech is asked on each Timing one of its weapons opens. Undefined
// when the answer has nobody to ask, and geometry must stand.
function standingAfter(o: Option, me: UnitView, at: Grid, view: SeatView, foes: UnitView[]): number | null | undefined {
  if (!o.later) return undefined;
  const timings = me.kind === 'mech' ? [...new Set(strikers(me).map((w) => w.timing))] : [undefined];
  const targets = new Map<number, UnitView>();
  for (const timing of timings) {
    for (const a of o.later(['attack'], timing)?.options ?? []) {
      const t = isAttack(a) ? unitOf(view, a.facts?.targetUid) : undefined;
      if (t) targets.set(t.uid, t);
    }
  }
  return standingOn(at, [...targets.values()], view, foes);
}

// ---------- attacks ----------

// An attack the Brawler would make: never one that spends a Charge (his
// planner runs with Charges off, and declines them in play).
const isAttack = (o: Option): boolean => o.run?.routine === 'attack' && !o.tags.includes('spend-charge');

interface Shot { option: Option; value: number; tie: number; target: UnitView | undefined; forecast: Forecast | null }

// One attack and what it is worth. An attack with no odds on it (nobody put
// them there, or it cannot be read) is still worth making.
function shotOf(o: Option, view: SeatView, from: Grid): Shot {
  const target = unitOf(view, o.facts?.targetUid);
  const forecast = o.chance ? o.chance() : null;
  return {
    option: o,
    value: forecast ? attackWorth(forecast, target) : B.ATTACK_BASE,
    tie: target ? targetScore(target, apart(from, target.grid)) : 0,
    target,
    forecast,
  };
}

// The attack worth most among some answers; of two worth the same, the one on
// the better target.
function bestShot(options: Option[], view: SeatView, from: Grid): Shot | null {
  let best: Shot | null = null;
  for (const o of options) {
    if (!isAttack(o)) continue;
    const s = shotOf(o, view, from);
    if (!best || s.value > best.value + EXACT || (Math.abs(s.value - best.value) <= EXACT && s.tie > best.tie)) best = s;
  }
  return best;
}

export const percent = (p: number): string => `${Math.round(p * 100)}%`;
const said = (s: Shot): string => (s.forecast ? `${percent(s.forecast.pen)} to Penetrate` : 'no odds to go by');

// ONE MOVE AHEAD: the move after which the best attack could be made, and
// that attack. Every Grid a move ends in that has an enemy in Range and in the
// arc it ends facing is tried, no more than his 24: the Grids it would not
// stand Melee Locked in first, and of those the nearest to its enemy. What
// could really be attacked from there, and at what odds, is the engine's
// answer (`then`), so sight and what the turn still pays for count.
interface Reached { move: Option; shot: Shot; tie: number }

function reachedBy(d: Decision, view: SeatView, me: UnitView, foes: UnitView[]): Reached | null {
  const landings = new Map<string, { at: Grid; near: number; locked: boolean; moves: Option[] }>();
  for (const o of d.options) {
    if (o.tags[0] !== 'move' || !o.then) continue;
    const at = endOf(o);
    const facing = facingOf(o);
    if (!at || facing === null) continue;
    // A Melee Lock bars most Firing and not all of it, so it sorts a Grid
    // later and does not rule it out.
    const near = Math.min(...foes.filter((f) => couldStrike(me, at, facing, f, false)).map((f) => apart(at, f.grid)));
    if (!Number.isFinite(near)) continue;
    const key = `${at.col},${at.row}`;
    const l = landings.get(key) ?? { at, near, locked: lockedAt(me, at, foes), moves: [] };
    l.near = Math.min(l.near, near);
    l.moves.push(o);
    landings.set(key, l);
  }
  const tried = [...landings.values()].sort((a, b) => Number(a.locked) - Number(b.locked) || a.near - b.near).slice(0, B.LANDING_CELLS);
  let best: Reached | null = null;
  for (const l of tried) {
    for (const move of l.moves) {
      const next = move.then?.(['attack']);
      const shot = next ? bestShot(next.options, view, l.at) : null;
      if (!shot || shot.value <= 0) continue;
      const tie = standing(me, l.at, facingOf(move) ?? me.facing, view, foes) ?? 0;
      if (!best || shot.value > best.shot.value + EXACT || (Math.abs(shot.value - best.shot.value) <= EXACT && tie > best.tie + EXACT)) best = { move, shot, tie };
    }
  }
  return best;
}

// ---------- closing on the enemy ----------

export type Road = { c: number; r: number }[];

// The road to the enemy it can reach soonest on foot (the seam's `roads`: the
// walk around a wall, not the line through it).
export function nearestRoad(d: Decision): { uid: number; road: Road } | null {
  const roads = d.facts.roads as Record<string, Road> | undefined;
  let best: { uid: number; road: Road } | null = null;
  for (const [uid, road] of Object.entries(roads ?? {})) {
    if (!best || road.length < best.road.length) best = { uid: Number(uid), road };
  }
  return best;
}

// MOVE TOWARD CONTACT (`contact_before_occupation`: fighting comes before
// holding ground). The Grid to stand in is his "where to stand": one it could
// attack from, by its score; failing any, the one nearest the enemy, which is
// the furthest along the road to it. Geometry says which Grids look like ones
// it could attack from, and the best of them are put to the engine (`later`),
// his eight at most: a Grid behind a wall is no such Grid. With nobody to
// ask, `trust` is whether geometry may be believed (see `activation`).
function approach(d: Decision, view: SeatView, me: UnitView, foes: UnitView[], trust: boolean): Choice | null {
  const moves = d.options.filter((o) => o.tags[0] === 'move' && !!endOf(o));
  if (!moves.length || !foes.length) return null;
  const led = nearestRoad(d);
  const place = (at: Grid): number => (led ? led.road.findIndex((g) => g.c === at.col && g.r === at.row) : -1);
  // How far a Grid still is from the enemy: along the road where one is known,
  // and a Grid off the road is no nearer at all.
  const far = (at: Grid): number => {
    if (!led) return Math.min(...foes.map((f) => apart(at, f.grid)));
    if (same(at, me.grid)) return led.road.length;
    const i = place(at);
    return i < 0 ? Infinity : led.road.length - 1 - i;
  };
  // What a unit standing there would turn to look at: the next Grid of the
  // road, or the enemy at the end of it.
  const onward = (at: Grid): Grid | null => {
    if (!led) return foes.reduce((a, b) => (apart(at, b.grid) < apart(at, a.grid) ? b : a)).grid;
    const next = led.road[same(at, me.grid) ? 0 : place(at) + 1];
    return next ? { col: next.c, row: next.r } : unitOf(view, led.uid)?.grid ?? null;
  };
  // A Grid with nothing to attack from it: the nearer the enemy the better.
  const walk = (at: Grid, facing: number): number => {
    const to = onward(at);
    return -far(at) + (to && !same(at, to) && facing === facingAt(at, to) ? FACING_EPSILON : 0);
  };
  // A Grid geometry says it could attack from, by the engine's word where the
  // answer has one to give.
  const sure = (o: Option | undefined, at: Grid, claim: number): number | null => {
    const asked = o ? standingAfter(o, me, at, view, foes) : undefined;
    return asked === undefined ? (trust ? claim : null) : asked;
  };
  // Where it stands, which is where ending the activation leaves it.
  const stay = standing(me, me.grid, me.facing, view, foes);
  const here = (stay === null ? null : sure(d.options.find((o) => o.tags.includes('end')), me.grid, stay)) ?? walk(me.grid, me.facing);
  const ranked = moves
    .map((o) => { const at = endOf(o)!; const facing = facingOf(o) ?? me.facing; return { o, at, facing, claim: standing(me, at, facing, view, foes) }; })
    .sort((a, b) => (b.claim ?? 0) - (a.claim ?? 0));
  let best: { o: Option; s: number } | null = null;
  let asked = 0;
  for (const c of ranked) {
    let s = walk(c.at, c.facing);
    // Once a Grid is known to be one it can attack from, a lesser claim is
    // not worth the asking.
    const settled = !!best && best.s >= B.ATTACK_GRID_SCORE && best.s >= (c.claim ?? 0);
    if (c.claim !== null && !settled && (!c.o.later || asked < B.MOVEMENT_CELLS_PER_STEP)) {
      if (c.o.later) asked += 1;
      s = sure(c.o, c.at, c.claim) ?? s;
    }
    if (!best || s > best.s + EXACT) best = { o: c.o, s };
  }
  if (!best || !(best.s > here + B.BETTER_BY)) return null;
  return {
    option: best.o.id, reason: 'contact_before_occupation', score: best.s,
    why: best.s >= B.ATTACK_GRID_SCORE ? 'to a Grid it can attack from' : 'closing on the nearest enemy',
  };
}

// HOLD GROUND: what his rung's name puts second (contact BEFORE occupation).
// With nothing to attack and nobody to close on, a unit moves toward a zone
// the Main Task scores whose Control dial does not name its squad. A Grid of
// such a zone, with no enemy in the zone to dispute it, is worth his objective
// tier; any other Grid loses his task-distance weight for each Grid it still
// is from one. A Low Value unit holds nothing, and stays where it is.
function occupy(d: Decision, view: SeatView, me: UnitView, foes: UnitView[]): Choice | null {
  if (me.lowValue) return null;
  const open = view.zones.filter((z) => z.scoring && z.control !== view.seat && z.cells.length > 0);
  if (!open.length) return null;
  const cells = open.flatMap((z) => z.cells.map((c) => { const [col, row] = c.split(',').map(Number); return { col, row }; }));
  const disputed = (z: ZoneView): boolean => foes.some((f) => !f.lowValue && z.cells.includes(`${f.grid.col},${f.grid.row}`));
  const score = (at: Grid): number => {
    const inside = open.find((z) => z.cells.includes(`${at.col},${at.row}`));
    if (inside && !disputed(inside)) return B.OBJECTIVE_POINT_TIER;
    return -B.TASK_DISTANCE_WEIGHT * Math.min(...cells.map((c) => apart(at, c)));
  };
  const here = score(me.grid);
  let best: { o: Option; s: number } | null = null;
  for (const o of d.options) {
    const at = o.tags[0] === 'move' ? endOf(o) : null;
    if (!at) continue;
    const s = score(at);
    if (!best || s > best.s + EXACT) best = { o, s };
  }
  if (!best || best.s <= here + B.BETTER_BY) return null;
  return {
    option: best.o.id, reason: 'occupy_objective', score: best.s,
    why: best.s >= B.OBJECTIVE_POINT_TIER ? 'into a zone the mission scores' : 'toward a zone the mission scores',
  };
}

// ---------- an activation ----------

// THE LADDER, for a unit holding an Action Opportunity or an activation. It is
// asked again after every answer, so each rung is one step.
function activation(asked: Decision, view: SeatView): Choice | null {
  const me = unitOf(view, asked.unit);
  if (!me) return null;
  // His squads carry no Mines and his ladder has no rung about one: a
  // Movement that would set a Mine off is left out of what it chooses from.
  // Nor has it one about a Crush of a Unit (4.3.6): a Movement that ends in
  // one is left out too, and the copy walks as it always has. Nor about a
  // Harpy's tow (ZHDR-304): its squads have no Harpy.
  const left = (o: Option): boolean => o.tags.includes('mined') || o.tags.includes('crush-unit') || o.tags.includes('tow');
  const d = asked.options.some(left) ? { ...asked, options: asked.options.filter((o) => !left(o)) } : asked;
  const foes = foesOf(view);
  const now = bestShot(d.options, view, me.grid);
  const launch = launching(d, view, foes);
  const worthNow = now && now.value > 0 ? now.value : 0;

  // Attack now, unless a Maneuver or a move Action reaches a strictly better
  // attack. A Projectile to launch is an attack like another, worth what its
  // blast is.
  const ahead = reachedBy(d, view, me, foes);
  if (ahead && ahead.shot.value > Math.max(worthNow, launch?.value ?? 0) + B.BETTER_BY) {
    return {
      option: ahead.move.id, reason: 'movement_unlocks_better_target', score: ahead.shot.value,
      why: `from there, ${ahead.shot.option.label} (${said(ahead.shot)})`,
    };
  }
  if (now && worthNow > 0 && worthNow >= (launch?.value ?? 0)) {
    return { option: now.option.id, reason: 'attack_result_value', score: now.value, why: `the best attack on offer (${said(now)})` };
  }
  if (launch) return { option: launch.option.id, reason: 'projectile_blast_value', score: launch.value, why: launch.why };

  // An Electronic Attack has no dice of the attack kind: taken on the best
  // target it is offered.
  const jams = d.options.filter((o) => o.tags[0] === 'electronic');
  if (jams.length) {
    const scored = jams.map((o) => { const t = unitOf(view, o.facts?.targetUid); return { o, s: t ? targetScore(t, apart(me.grid, t.grid)) : 0 }; });
    const pick = scored.reduce((a, b) => (b.s > a.s ? b : a));
    return { option: pick.o.id, reason: 'attack_result_value', score: B.ATTACK_BASE, why: 'an Electronic Attack on offer' };
  }

  // A Projectile's own Delayed Action with nothing to take: it is resolved.
  const spent = d.options.find((o) => o.tags[0] === 'detonate' && !o.run);
  if (spent) return { option: spent.id, reason: 'delayed_action', why: 'a Projectile resolves its Delayed Action' };

  // A change of Stance that unlocks an attack it could not otherwise make.
  let prepared: { o: Option; shot: Shot } | null = null;
  for (const o of d.options) {
    if (o.tags[0] !== 'stance' || !o.then) continue;
    const next = o.then(['attack']);
    const shot = next ? bestShot(next.options, view, me.grid) : null;
    if (shot && shot.value > 0 && (!prepared || shot.value > prepared.shot.value + EXACT)) prepared = { o, shot };
  }
  if (prepared) {
    return {
      option: prepared.o.id, reason: 'preparation_unlocks_attack', score: B.STANCE_UNLOCKS_SCORE,
      why: `in that Stance, ${prepared.shot.option.label} (${said(prepared.shot)})`,
    };
  }

  // Move toward contact. Range and arc are believed about where it stands,
  // except on the evidence of the turn itself: a unit that has done nothing
  // yet, has an attack its Timing would open with and an enemy in that
  // attack's Range and arc, and is offered no attack, is looking at a wall.
  const fresh = !view.opportunity || !view.opportunity.performed.length;
  const opens = (w: WeaponView): boolean =>
    (me.kind === 'mech' ? w.timing === me.timing : w.mode === (view.phaseName === 'Command' ? 'command' : 'auto'));
  const locked = lockedAt(me, me.grid, foes);
  const walled = fresh && !now && strikers(me).some((w) => opens(w) && !(w.type === 'Firing' && locked)
    && foes.some((f) => !f.camouflaged && inFront(me.grid, me.facing, f.grid) && reaches(w, me.grid, f.grid) && !(w.type === 'Melee' && f.aerial)));
  const step = approach(d, view, me, foes, !walled);
  if (step) return step;

  // Contact before occupation: with nobody to close on, it holds ground.
  const hold = occupy(d, view, me, foes);
  if (hold) return hold;

  // The best positive option left: Link to recover.
  if (me.link !== undefined && me.linkMax !== undefined && me.link < me.linkMax) {
    const link = d.options.find((o) => o.tags.includes('restore-link'));
    if (link) return { option: link.id, reason: 'best_positive_option', why: 'restoring Link' };
  }
  const end = d.options.find((o) => o.tags.includes('end'));
  return end ? { option: end.id, reason: 'end_activation', why: 'nothing more to do with this activation' } : null;
}

// A PROJECTILE TO LAUNCH, valued as an attack is: by what its blast would do
// to the best target it could take from where it lands, as the board stands
// (`later`: the Projectile's own turn, asked of the engine). For each enemy a
// Landing Point would put inside its strike, the one Landing Point nearest it
// is tried. The Projectiles offered strike one unit, so none of its own are
// counted against it. With nobody to say what the blast would do, a launch
// that reaches a target is worth making and no more.
interface Launch { option: Option; value: number; tie: number; why: string }

function launching(d: Decision, view: SeatView, foes: UnitView[]): Launch | null {
  const nearest = new Map<number, { o: Option; at: Grid; tie: number }>();
  for (const o of d.options) {
    if (o.tags[0] !== 'launch') continue;
    const at = endOf(o);
    const strike = typeof o.facts?.strike === 'number' ? o.facts.strike : 0;
    if (!at) continue;
    for (const f of foes) {
      if (f.camouflaged || apart(at, f.grid) > strike) continue;
      const tie = targetScore(f, apart(at, f.grid));
      if (tie > (nearest.get(f.uid)?.tie ?? -1) + EXACT) nearest.set(f.uid, { o, at, tie });
    }
  }
  let best: Launch | null = null;
  for (const l of [...nearest.values()].sort((a, b) => b.tie - a.tie)) {
    let value: number = B.ATTACK_BASE;
    let why = 'a Projectile, where it reaches its best target';
    if (l.o.later) {
      const turn = l.o.later(['attack']);
      const shot = turn ? bestShot(turn.options, view, l.at) : null;
      if (!shot || shot.value <= 0) continue;
      value = shot.value;
      why = `a Projectile for ${shot.target?.label ?? 'its target'} (${said(shot)})`;
    }
    if (!best || value > best.value + EXACT || (Math.abs(value - best.value) <= EXACT && l.tie > best.tie + EXACT)) best = { option: l.o, value, tie: l.tie, why };
  }
  return best;
}

// ---------- the other decisions ----------

// THE TIMING DIAL: the Timing whose opening attack is worth most, the Maneuver
// before it counted, and the earliest of those worth the same; failing any, a
// move. Range says which Timings are worth a look, and the look is the
// engine's (`then`: the Opportunity that dial would open, on the board as it
// stands), so a wall, a Melee Lock and a Grid the Maneuver cannot reach all
// count.
function dial(d: Decision, view: SeatView): Choice | null {
  const me = unitOf(view, d.unit);
  if (!me) return null;
  const foes = foesOf(view).filter((f) => !f.camouflaged);
  const step = me.maneuver;
  // The Maneuver's Grids, then the target in a Grid beside the one it ends in.
  const closes = (f: UnitView): boolean =>
    Math.max(0, Math.abs(me.grid.col - f.grid.col) - 1) + Math.max(0, Math.abs(me.grid.row - f.grid.row) - 1) <= step;
  const hits = (w: WeaponView, f: UnitView): boolean => {
    if (w.type === 'Projectile') return apart(me.grid, f.grid) <= w.range + (w.strike ?? 0) + step;
    if (w.type !== 'Firing' && w.type !== 'Melee') return false;
    if (w.type === 'Melee' && f.aerial) return false;
    return w.range > 0 ? apart(me.grid, f.grid) <= w.range + step : closes(f);
  };
  // In the order the Timings are played, which is the order they are offered
  // in: of two openings worth the same, the earlier is kept.
  let best: { o: Option; value: number; why: string } | null = null;
  for (const o of d.options) {
    const timing = o.tags.find((t) => t.startsWith('timing:'))?.slice(7);
    if (!timing) continue;
    const opener = me.weapons.find((w) => ready(w) && w.timing === timing && foes.some((f) => hits(w, f)));
    // Every Mech has a Punch and a Kick, which are on no card.
    const fists = timing === 'melee' && foes.some((f) => !f.aerial && closes(f));
    if (!opener && !fists) continue;
    // With nobody to ask what the dial would open, the earliest Timing with
    // something in Range is all there is to go by.
    if (!o.then) return { option: o.id, reason: 'intent_opening', score: B.INTENT_OPENING_SCORE, why: `its ${opener?.name ?? 'Punch'} has an enemy in reach` };
    const opening = openingOf(o, view, me, foes);
    if (opening && (!best || opening.value > best.value + EXACT)) best = { o, ...opening };
  }
  if (best) return { option: best.o.id, reason: 'intent_opening', score: B.INTENT_OPENING_SCORE, why: best.why };
  const move = d.options.find((o) => o.tags.includes('timing:movement'));
  return move ? { option: move.id, reason: 'reposition_opening', score: B.REPOSITION_OPENING_SCORE, why: 'nothing it can open on, so it moves first' } : null;
}

// What the Opportunity a dial would open is worth, and what it begins with in
// words: the best of an attack on offer as it opens, a Projectile to launch at
// something, and an attack the Maneuver reaches. Null when it opens on none.
function openingOf(o: Option, view: SeatView, me: UnitView, foes: UnitView[]): { value: number; why: string } | null {
  const turn = o.then?.(['attack', 'maneuver', 'launch']);
  if (!turn) return null;
  let best: { value: number; why: string } | null = null;
  const now = bestShot(turn.options, view, me.grid);
  if (now && now.value > 0) best = { value: now.value, why: `it opens with ${now.option.label} (${said(now)})` };
  const launch = launching(turn, view, foes);
  if (launch && (!best || launch.value > best.value + EXACT)) best = { value: launch.value, why: `it opens with ${launch.why}` };
  const ahead = reachedBy(turn, view, me, foes);
  if (ahead && (!best || ahead.shot.value > best.value + B.BETTER_BY)) {
    best = { value: ahead.shot.value, why: `after its Maneuver, ${ahead.shot.option.label} (${said(ahead.shot)})` };
  }
  return best;
}

// The middle of what the game is fought over: the Grids the Main Task scores,
// or every zone of the board where it scores none.
function centreOf(view: SeatView): Grid {
  const scoring = view.zones.filter((z) => z.scoring);
  const cells = (scoring.length ? scoring : view.zones).flatMap((z) => z.cells).map((c) => c.split(',').map(Number));
  if (!cells.length) return { col: 5.5, row: 5.5 };
  return { col: cells.reduce((n, c) => n + c[0], 0) / cells.length, row: cells.reduce((n, c) => n + c[1], 0) / cells.length };
}

// DEPLOYMENT, by "where to stand": a Grid it could attack from if there is
// one, and otherwise as near the enemy as its zone goes, or the middle of the
// board while no enemy is down. A Mech is deployed ready to attack.
function deploy(d: Decision, view: SeatView): Choice | null {
  const foes = foesOf(view);
  const aim = foes.length ? null : centreOf(view);
  let best: { o: Option; s: number } | null = null;
  for (const o of d.options) {
    const at = endOf(o);
    const me = unitOf(view, o.facts?.uid);
    if (!at || !me) continue;
    if (o.facts?.stance !== undefined && o.facts.stance !== 'offensive') continue;
    const s = standing(me, at, facingOf(o) ?? 0, view, foes)
      ?? -(aim ? apart(at, aim) : Math.min(...foes.map((f) => apart(at, f.grid))));
    if (!best || s > best.s + EXACT) best = { o, s };
  }
  return best ? { option: best.o.id, reason: 'deploy_toward_enemy', score: best.s, why: 'deployed as far forward as its zone goes' } : null;
}

// The enemies inside the Range of anything a unit carries, whichever way it
// is facing.
const inReach = (u: UnitView, foes: UnitView[]): UnitView[] =>
  foes.filter((f) => !f.camouflaged && u.weapons.some((w) => ready(w) && (w.range > 0 || w.type === 'Melee') && reaches(w, u.grid, f.grid)));

// A COMMAND is always spent: on the unit scoring 1, its health, and half a
// point for each target in its reach.
function command(d: Decision, view: SeatView): Choice | null {
  const foes = foesOf(view);
  let best: { o: Option; s: number } | null = null;
  for (const o of d.options) {
    const u = o.tags.includes('designate') ? unitOf(view, o.facts?.uid) : undefined;
    if (!u) continue;
    const s = 1 + u.health + B.COMMAND_OPPORTUNITY_PER_TARGET * inReach(u, foes).length;
    if (!best || s > best.s + EXACT) best = { o, s };
  }
  return best ? { option: best.o.id, reason: 'command_opportunity', score: best.s, why: 'a Command is never left unspent' } : null;
}

// AN AUTOMATIC OR A DELAY UNIT to activate: the one whose best target has lost
// most. Every one of them is activated before the phase is passed.
function activate(d: Decision, view: SeatView): Choice | null {
  const foes = foesOf(view);
  let best: { o: Option; s: number } | null = null;
  for (const o of d.options) {
    const u = o.tags.includes('designate') ? unitOf(view, o.facts?.uid) : undefined;
    if (!u) continue;
    const s = B.AUTO_ACTION_TARGET_SCORE + Math.max(0, ...inReach(u, foes).map((f) => 1 - f.health));
    if (!best || s > best.s + EXACT) best = { o, s };
  }
  return best ? { option: best.o.id, reason: 'auto_action_target', score: best.s, why: 'a unit still to activate' } : null;
}

// ---------- in the middle of an attack ----------

// What a forecast is worth to the attacker, in the fight this question is
// about.
export type Worth = (f: Forecast) => number;
function worthIn(d: Decision, view: SeatView): Worth {
  const target = unitOf(view, d.facts.targetUid);
  return (f) => attackWorth(f, target);
}

// Whether one forecast is better for the attacker than another: worth more,
// or worth the same and likelier to Penetrate.
export function beats(worth: Worth, a: Forecast, b: Forecast): boolean {
  const more = worth(a) - worth(b);
  return more > EXACT || (Math.abs(more) <= EXACT && a.pen > b.pen + EXACT);
}

export const attacking = (d: Decision): boolean => d.facts.role !== 'defender';

// The answers that have odds on them, each with its forecast.
export const forecasts = (options: Option[]): { o: Option; f: Forecast }[] =>
  options.flatMap((o) => { const f = o.chance?.(); return f ? [{ o, f }] : []; });

// WHERE THE HIT LANDS, the attacker's to say: the Part worth most to hit
// (finishing a Damaged one, by the odds), and of two worth the same the one
// that cost more.
export function hitLocation(d: Decision, view: SeatView, worth: Worth = worthIn(d, view)): Choice | null {
  const picks = forecasts(d.options.filter((o) => o.id.startsWith('part.pick:')));
  if (!picks.length) return null;
  const target = unitOf(view, d.facts.targetUid);
  const cost = (o: Option): number => target?.parts.find((p) => p.slot === o.id.slice('part.pick:'.length))?.points ?? 0;
  const best = picks.reduce((a, b) => (beats(worth, b.f, a.f) || (!beats(worth, a.f, b.f) && cost(b.o) > cost(a.o)) ? b : a));
  return { option: best.o.id, reason: 'hit_location', score: worth(best.f), why: 'the Part worth most to hit' };
}

// WHAT THE DEFENDER DECLARES before the Part Die: the Part, and the Parry on
// it, that costs the attacker most; nothing, where nothing does better than
// that. KC Armor spends a Charge, and is never declared.
export function declare(d: Decision, view: SeatView, worth: Worth = worthIn(d, view)): Choice | null {
  const none = d.options.find((o) => o.id === 'declare.none');
  const base = none?.chance?.();
  if (!none || !base) return null;
  let best: { o: Option; f: Forecast } = { o: none, f: base };
  for (const x of forecasts(d.options.filter((o) => o.id.startsWith('declare.designate:')))) {
    if (beats(worth, best.f, x.f)) best = x;
  }
  return best.o === none
    ? { option: none.id, reason: 'skip_parry', score: worth(best.f), why: 'nothing it could declare would cost the attacker more' }
    : { option: best.o.id, reason: 'declare_parry', score: worth(best.f), why: 'declared where it costs the attacker most' };
}

// A FOCUS. One somebody else pays for is taken whenever the reroll it buys
// would help at all. One paid for in Link is taken when that reroll has one
// chance in four of turning the roll and the pilot has Link to spare; it is
// declined otherwise. A Command Token is never whistled away on one.
function focus(d: Decision, view: SeatView): Choice | null {
  const pass = d.options.find((o) => o.id === 'focus.pass');
  const base = pass?.chance?.();
  if (!pass || !base) return null;
  const mine = attacking(d);
  // The chance the best reroll turns the roll its owner's way.
  const turn = (o: Option | undefined): number => {
    const f = o?.chance?.();
    return f ? (mine ? f.pen - base.pen : base.pen - f.pen) : 0;
  };
  const free = d.options.find((o) => o.tags.includes('focus') && o.tags.includes('free'));
  if (free && turn(free) > EXACT) return { option: free.id, reason: 'free_reroll', score: turn(free), why: 'a reroll that costs nothing' };
  const paid = d.options.find((o) => o.id === 'focus.use');
  const link = unitOf(view, d.unit)?.link ?? 0;
  if (paid && turn(paid) >= B.PAID_REROLL_CHANCE - EXACT && link >= B.PAID_REROLL_LINK) {
    return { option: paid.id, reason: 'paid_reroll', score: turn(paid), why: `${percent(turn(paid))} to turn the roll, and Link to spare` };
  }
  return { option: pass.id, reason: 'skip_reroll', score: turn(paid), why: 'no reroll worth a Link' };
}

// THE REROLL a Focus bought: the dice worth most to throw again, by the odds
// of each selection; the roll is kept where throwing none of them is as good.
export function reroll(d: Decision, view: SeatView, worth: Worth = worthIn(d, view)): Choice | null {
  const all = forecasts(d.options);
  const keep = all.find((x) => x.o.id.startsWith('reroll.keep'));
  if (!all.length) return null;
  const mine = attacking(d);
  let best = keep ?? all[0];
  for (const x of all) if (mine ? beats(worth, x.f, best.f) : beats(worth, best.f, x.f)) best = x;
  return best === keep
    ? { option: best.o.id, reason: 'keep_roll', score: worth(best.f), why: 'no die worth throwing again' }
    : { option: best.o.id, reason: 'reroll_value', score: worth(best.f), why: 'the dice worth most to throw again' };
}

// WHAT A SURPLUS IS SPENT ON: the keyword worth most.
export function surplus(d: Decision, view: SeatView, worth: Worth = worthIn(d, view)): Choice | null {
  const all = forecasts(d.options.filter((o) => o.id.startsWith('surplus.effect:')));
  if (!all.length) return null;
  const best = all.reduce((a, b) => (beats(worth, b.f, a.f) ? b : a));
  return { option: best.o.id, reason: 'attack_result_value', score: worth(best.f), why: 'the Surplus where it is worth most' };
}

// ---------- the policy ----------

function decide(d: Decision, view: SeatView): Choice | null {
  switch (d.kind) {
    case 'opp.act':
    case 'activation.act':
      return activation(d, view);
    case 'opp.reboot': {
      const up = d.options.find((o) => o.tags.includes('stance:offensive'));
      return up ? { option: up.id, reason: 'reboot', why: 'back up, ready to attack' } : null;
    }
    case 'planning.dial':
      return dial(d, view);
    case 'setup.deploy':
      return deploy(d, view);
    case 'setup.designate.leader':
      // The Commander is the first eligible unit: no thought goes into it.
      return d.options.length ? { option: d.options[0].id, reason: 'first_eligible_commander', why: 'the first unit that may lead' } : null;
    case 'loop.designate.command':
      return command(d, view);
    case 'loop.designate.automatic':
    case 'loop.designate.delay':
      return activate(d, view);
    case 'attack.part':
      return hitLocation(d, view);
    case 'attack.partfocus': {
      // A Part Die is thrown again only when it found a Part already
      // destroyed, and here that die lands on the Torso by itself.
      const keep = d.options.find((o) => o.id === 'part.keep');
      return keep ? { option: keep.id, reason: 'skip_reroll', why: 'the Part Die stands' } : null;
    }
    case 'defence.declare':
      return declare(d, view);
    case 'attack.focus':
    case 'defence.focus':
      return focus(d, view);
    case 'attack.reroll':
    case 'defence.reroll':
      return reroll(d, view);
    case 'attack.surplus':
      return surplus(d, view);
    case 'attack.finish': {
      const bonus = d.options.find((o) => o.id === 'finish.bonus');
      return bonus ? { option: bonus.id, reason: 'attack_result_value', why: 'a bonus attack is an attack' } : null;
    }
    default:
      return null;
  }
}

export const brawlerPolicy: Policy = {
  name: 'brawler',
  choose(d: Decision, view: SeatView) {
    // What it has no rule for (a step of bookkeeping, a question his leaves
    // undone) takes the answer that is always safe, and the game goes on.
    return decide(d, view) ?? { option: d.fallback, reason: 'safe_answer', why: 'the safe answer' };
  },
};
