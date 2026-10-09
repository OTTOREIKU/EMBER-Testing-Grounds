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
import { huntersCard, secondaryName } from './secondary';
import { apart, beside, couldStrike, endOf, facingAt, facingOf, foesOf, inFront, lockedAt, percent, reaches, ready, same, strikers, unitOf, type Grid, type Road } from './geometry';
import { attacking, declare, forecasts, hitLocation, reroll, surplus, type Worth } from './fight';

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

// THE BRAWLER OF THE SETUP DIALOG (OTTO, 2026-10-05, watching it play UN: "the
// Brawler may be a touch more aggressive than it needs to be and possibly
// should consider ranged aggression"; its Drones walked "directly into the
// line of fire of the enemy mechs causing them to all die before they could
// get an attack off", and the Carrier "never chose to stay near the UN mech to
// give it a bonus"). Still a fighter with no plan, with four habits a player
// has, each a switch so that each can be measured. The copy has none of them
// (`COPY`), and the Tactician's fallbacks answer as the copy does.
export interface BrawlerSkills {
  // A RANGED UNIT KEEPS ITS DISTANCE: of the Grids it could attack from, the
  // one fewest enemies could attack it in, and of those the farthest from the
  // enemy it would attack. Without it the nearest.
  kite: boolean;
  // A DRONE THAT CANNOT ATTACK YET KEEPS OUT OF THE LINE OF FIRE: walking at
  // the enemy, a Grid fewer enemies could attack it in beats one nearer the
  // enemy, and it stays where it is rather than step into one.
  screen: boolean;
  // A DRONE WITH NOTHING TO ATTACK WITH STAYS WITH ITS SQUAD: one carrying a
  // Load stands in Contact with an Ally Mech, which uses the Load as its own
  // Part; any other beside the nearest Mech of its squad. It never walks at the
  // enemy.
  escort: boolean;
  // AN ELECTRONIC ATTACK IS AN ATTACK: its Range counts as reach in choosing
  // where to stand, terrain and sight never in the way (4.11.1), and its target
  // is the one it stops most: a Mech before a Drone, one that can still fire.
  jams: boolean;
  // AN ATTACK FROM WHERE ONE ENEMY AT MOST COULD ANSWER IT (OTTO, 2026-10-05:
  // "aggressive with them but playing smart (out of range, using cover, not
  // walking into the direct line of multiple enemy units)"). Of the Grids it
  // could attack from, one in the lines of fire of one enemy or none beats one
  // in two or more's, and of those the best attack; a unit that would attack
  // from where two or more could answer it moves first to such a Grid, for an
  // attack worth most of this one; walking up, it keeps to such Grids. A Drone
  // that keeps out of the line of fire (`screen`) may still attack from where
  // one enemy could answer it. `kite` without the distance, and with a margin.
  safer: boolean;
  // A UNIT THAT CANNOT ATTACK YET WALKS UP UNDER COVER: of the Grids it could
  // reach within COVER_SLACK of the nearest the enemy (off the road too, so it
  // may step aside behind a wall), the one fewest enemies could attack it in.
  // Still a fighter closing in, a Mech as much as a Drone; `screen` is the
  // Drone's stricter habit and wins. MEASURED WORSE (2026-10-05): against the Ace
  // on random squads 17 of 200 where the copy wins 28 (p .01).
  cover: boolean;
  // IT FIGHTS FOR WHAT THE MISSION PAYS (OTTO, 2026-10-05: "should want to fight
  // the opponents and cause them to have to reposition or have to back off of
  // objectives"): an attack on an enemy standing in a zone the Main Task scores,
  // or carrying a Black Box, is worth CONTEST_SHARE more; where to stand counts
  // such a target CONTEST_STAND higher; and with nothing to attack it walks at
  // the nearest such enemy, where that is at most CONTEST_DETOUR Grids further
  // than the nearest enemy of all.
  contest: boolean;
  // IT STANDS IN THE ZONES THE ENEMY HOLDS (`claim`; OTTO, 2026-10-05: "cause
  // them to have to reposition or have to back off of objectives"). A zone is
  // held only by a squad with nobody of the other in it, and a Control dial
  // stays with its holder until the other squad takes the zone (5.3.2), so a
  // hit on whoever holds it takes nothing away. With nothing to attack, a Grid
  // in a scoring zone that is not yet its squad's comes before any other walk,
  // and standing in one it stays there.
  claim: boolean;
  // A HUNTER'S SECONDARY TASK (`hunter`; OTTO, 2026-10-09: the Brawler "would
  // probably be more inclined to take secondary tasks that are related to
  // killing enemy mechs rather than objectives since it's built to be more
  // aggressive"). It takes a card that pays for the enemy destroyed (Behead
  // against a squad of one Mech, else Annihilation; secondary.ts huntersCard)
  // and names for its card as the Ace does (secondaryName). His solo mode plays
  // no Secondary Tasks, so the copy takes the first card and the first Mech.
  hunter: boolean;
}
export const COPY: BrawlerSkills = { kite: false, screen: false, escort: false, jams: false, safer: false, cover: false, contest: false, claim: false, hunter: false };

// `contest`: how much more an attack on an enemy holding what the mission pays
// is worth, how much higher where to stand counts it (his target classes are a
// hundred apart), and how much further it will walk to reach one.
const CONTEST_SHARE = 0.5;
const CONTEST_STAND = 60;
const CONTEST_DETOUR = 4;

// A Grid in a zone the Main Task scores that is not yet this squad's (`claim`):
// neither held by it as the board stands nor named for it by the zone's dial.
function unclaimed(at: Grid, view: SeatView): boolean {
  const cell = `${at.col},${at.row}`;
  return view.zones.some((z) => z.scoring && z.cells.includes(cell) && z.holder !== view.seat && z.control !== view.seat);
}
// A Grid in a zone the Main Task scores whose dial does not yet name this
// squad (`claim`): one it stands in to keep, or to take.
function holding(at: Grid, view: SeatView): boolean {
  const cell = `${at.col},${at.row}`;
  return view.zones.some((z) => z.scoring && z.cells.includes(cell) && z.control !== view.seat);
}

// Whether an enemy stands on what the Main Task pays for (`contest`): in a Grid
// of a zone it scores, or carrying a Black Box.
function holds(t: UnitView, view: SeatView): boolean {
  const cell = `${t.grid.col},${t.grid.row}`;
  return view.zones.some((z) => z.scoring && z.cells.includes(cell)) || view.boxes.some((b) => b.bearer === t.uid);
}

// How many Grids short of its farthest step a unit walking up under cover may
// stop for a Grid fewer enemies could attack it in (`cover`).
const COVER_SLACK = 1;

// A Grid in the lines of fire of two enemies or more (`safer`).
const exposed = (danger: number | undefined): number => ((danger ?? 0) >= 2 ? 1 : 0);
// How much of the attack it could make where it stands one made from a safer
// Grid must be worth for it to move there first (`safer`). Ours, not his table's.
const SAFER_SHARE = 0.75;

// How far a unit could walk before it attacks: a Mech its Maneuver, twice it in
// Mobility Stance (3.4.3); a Drone not at all, a Command buying it a Movement
// or an Action and not both.
const stepOf = (u: UnitView): number => (u.kind === 'mech' ? u.maneuver * (u.stance === 'mobility' ? 2 : 1) : 0);

// The Electronic Attacks a unit carries (`jams`): a Tactic made at a Range on
// an enemy, not one that serves its own squad or hands an Ally a turn.
const jammers = (u: UnitView): WeaponView[] => u.weapons.filter((w) => ready(w) && w.type === 'Tactic' && w.range > 0 && !w.own && !w.grants);

// A unit with nothing of its own to attack with (`escort`): no gun, no blade,
// no launcher, no Electronic Attack.
const unarmed = (u: UnitView): boolean =>
  !strikers(u).length && !jammers(u).length && !u.weapons.some((w) => ready(w) && w.type === 'Projectile');

// HOW MANY ENEMIES COULD ATTACK A UNIT IN EACH OF SOME GRIDS at their next
// turn (`kite`, `screen`, `escort`): a gun whose Range its step before the
// attack brings within reach of the Grid, where it has sight of the Grid as it
// stands (the engine's sight, `seen`; geometry alone with nobody to ask); a
// launcher or an Electronic Attack likewise, sight or none; a blade it could
// step into Contact with.
function dangerAt(me: UnitView, grids: Grid[], d: Decision, foes: UnitView[]): number[] {
  const seers = d.here ? d.here().seen(me.uid, grids) : null;
  return grids.map((at, i) => foes.filter((f) => {
    const walk = stepOf(f);
    const far = apart(f.grid, at);
    const sees = !seers || (seers[i] ?? []).includes(f.uid);
    return f.weapons.some((w) => {
      if (!ready(w) || w.own || w.grants) return false;
      if (w.type === 'Melee') return !me.aerial && far <= walk + 1;
      if (w.type === 'Firing') return sees && far <= Math.max(1, w.range) + walk;
      if (w.type === 'Projectile') return far <= w.range + (w.strike ?? 0) + walk;
      return w.type === 'Tactic' && w.range > 0 && far <= w.range + walk;
    });
  }).length);
}

// Two square bases in Contact (4.2.3, rules.ts inContact): their Small Grids
// share an edge, or overlap; a corner alone is not Contact.
function touches(a: UnitView, b: UnitView): boolean {
  const gapX = Math.max(a.cell.col - (b.cell.col + b.size), b.cell.col - (a.cell.col + a.size));
  const gapY = Math.max(a.cell.row - (b.cell.row + b.size), b.cell.row - (a.cell.row + a.size));
  if (gapX < 0 && gapY < 0) return true;
  return (gapX === 0 && gapY < 0) || (gapY === 0 && gapX < 0);
}

// What an Electronic Attack on a unit stops (`jams`): a Mech's guns before a
// Drone's, a unit that can still fire before one that cannot, and one whose
// turn is still to come.
function jamWorth(t: UnitView): number {
  const fires = t.weapons.some((w) => ready(w) && w.type === 'Firing');
  return (t.kind === 'mech' ? 20 : 5) * (fires ? 1 : 0.2) + (t.done ? 0 : 5);
}

// A Grid an Electronic Attack could be made from (`jams`), as "where to stand"
// scores a Grid an attack could be made from: the enemy it would be made on
// there is the nearest within its Range (166_A: "1 nearest Enemy Unit within
// range"), Range read along the rows and columns, nothing in the way.
function jamAt(me: UnitView, at: Grid, foes: UnitView[]): number | null {
  const reach = Math.max(0, ...jammers(me).map((w) => w.range));
  const inside = foes.filter((f) => !f.camouflaged && apart(at, f.grid) <= reach);
  if (!reach || !inside.length) return null;
  const nearest = inside.reduce((a, b) => (apart(at, b.grid) < apart(at, a.grid) ? b : a));
  return B.ATTACK_GRID_SCORE + jamWorth(nearest);
}

// Looking the way it is going is worth a hair to a unit with nothing to
// attack: more than BETTER_BY, so that it will turn for it.
const FACING_EPSILON = 0.0005;
const EXACT = 1e-9;


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
function standingOn(at: Grid, targets: UnitView[], view: SeatView, foes: UnitView[], k: BrawlerSkills = COPY): number | null {
  if (!targets.length) return null;
  const best = Math.max(...targets.map((t) => targetScore(t, apart(at, t.grid)) + (k.contest && holds(t, view) ? CONTEST_STAND : 0)));
  const threats = foes.filter((f) => strikers(f).some((w) => reaches(w, f.grid, at))).length;
  const gain = view.zones.some((z) => z.scoring && z.cells.includes(`${at.col},${at.row}`)) ? 1 : 0;
  return B.ATTACK_GRID_SCORE + best + Math.atan(targets.length) * B.TARGET_COUNT_EPSILON
    + Math.atan(gain) * B.MISSION_TIEBREAK_EPSILON - Math.atan(threats) * B.THREAT_TIEBREAK_EPSILON;
}

// The same, as far as geometry can say what could be attacked from a Grid.
export function standing(me: UnitView, at: Grid, facing: number, view: SeatView, foes: UnitView[], k: BrawlerSkills = COPY): number | null {
  const locked = lockedAt(me, at, foes);
  return standingOn(at, foes.filter((f) => couldStrike(me, at, facing, f, locked)), view, foes, k);
}

// The same, by the engine's own word (`later`): what the unit would really be
// offered to attack from where this answer leaves it, when its turn next
// comes. A Mech is asked on each Timing one of its weapons opens. Undefined
// when the answer has nobody to ask, and geometry must stand.
function standingAfter(o: Option, me: UnitView, at: Grid, view: SeatView, foes: UnitView[], k: BrawlerSkills = COPY): number | null | undefined {
  if (!o.later) return undefined;
  const timings = me.kind === 'mech' ? [...new Set(strikers(me).map((w) => w.timing))] : [undefined];
  const targets = new Map<number, UnitView>();
  for (const timing of timings) {
    for (const a of o.later(['attack'], timing)?.options ?? []) {
      const t = isAttack(a) ? unitOf(view, a.facts?.targetUid) : undefined;
      if (t) targets.set(t.uid, t);
    }
  }
  return standingOn(at, [...targets.values()], view, foes, k);
}

// ---------- attacks ----------

// An attack the Brawler would make: never one that spends a Charge (his
// planner runs with Charges off, and declines them in play).
const isAttack = (o: Option): boolean => o.run?.routine === 'attack' && !o.tags.includes('spend-charge');

interface Shot { option: Option; value: number; tie: number; target: UnitView | undefined; forecast: Forecast | null }

// One attack and what it is worth. An attack with no odds on it (nobody put
// them there, or it cannot be read) is still worth making.
function shotOf(o: Option, view: SeatView, from: Grid, k: BrawlerSkills = COPY): Shot {
  const target = unitOf(view, o.facts?.targetUid);
  const forecast = o.chance ? o.chance() : null;
  // `contest`: a hit on an enemy holding what the mission pays is worth more.
  const held = k.contest && !!target && holds(target, view) ? 1 + CONTEST_SHARE : 1;
  return {
    option: o,
    value: (forecast ? attackWorth(forecast, target) : B.ATTACK_BASE) * held,
    tie: target ? targetScore(target, apart(from, target.grid)) : 0,
    target,
    forecast,
  };
}

// The attack worth most among some answers; of two worth the same, the one on
// the better target.
function bestShot(options: Option[], view: SeatView, from: Grid, k: BrawlerSkills = COPY): Shot | null {
  let best: Shot | null = null;
  for (const o of options) {
    if (!isAttack(o)) continue;
    const s = shotOf(o, view, from, k);
    if (!best || s.value > best.value + EXACT || (Math.abs(s.value - best.value) <= EXACT && s.tie > best.tie)) best = s;
  }
  return best;
}

const said = (s: Shot): string => (s.forecast ? `${percent(s.forecast.pen)} to Penetrate` : 'no odds to go by');

// ONE MOVE AHEAD: the move after which the best attack could be made, and
// that attack. Every Grid a move ends in that has an enemy in Range and in the
// arc it ends facing is tried, no more than his 24: the Grids it would not
// stand Melee Locked in first, and of those the nearest to its enemy. What
// could really be attacked from there, and at what odds, is the engine's
// answer (`then`), so sight and what the turn still pays for count.
interface Reached { move: Option; shot: Shot; tie: number; danger?: number; far?: number }

// `kite`: of two attacks worth the same, the one made from the Grid fewer
// enemies could attack it in, then from farther off.
function kiteBeats(a: Reached, b: Reached): boolean {
  const more = a.shot.value - b.shot.value;
  if (Math.abs(more) > EXACT) return more > 0;
  if ((a.danger ?? 0) !== (b.danger ?? 0)) return (a.danger ?? 0) < (b.danger ?? 0);
  if ((a.far ?? 0) !== (b.far ?? 0)) return (a.far ?? 0) > (b.far ?? 0);
  return a.tie > b.tie + EXACT;
}

// `safer`: an attack from where one enemy at most could answer it before one
// from where two or more could, then the better attack.
function saferBeats(a: Reached, b: Reached): boolean {
  if (exposed(a.danger) !== exposed(b.danger)) return exposed(a.danger) < exposed(b.danger);
  const more = a.shot.value - b.shot.value;
  if (Math.abs(more) > EXACT) return more > 0;
  return a.tie > b.tie + EXACT;
}

function reachedBy(d: Decision, view: SeatView, me: UnitView, foes: UnitView[], k: BrawlerSkills = COPY): Reached | null {
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
  const danger = k.kite || k.safer ? dangerAt(me, tried.map((l) => l.at), d, foes) : null;
  let best: Reached | null = null;
  for (const [i, l] of tried.entries()) {
    for (const move of l.moves) {
      const next = move.then?.(['attack']);
      const shot = next ? bestShot(next.options, view, l.at, k) : null;
      if (!shot || shot.value <= 0) continue;
      const tie = standing(me, l.at, facingOf(move) ?? me.facing, view, foes, k) ?? 0;
      if (danger) {
        const r: Reached = { move, shot, tie, danger: danger[i], far: shot.target ? apart(l.at, shot.target.grid) : 0 };
        if (!best || (k.kite ? kiteBeats(r, best) : saferBeats(r, best))) best = r;
        continue;
      }
      if (!best || shot.value > best.shot.value + EXACT || (Math.abs(shot.value - best.shot.value) <= EXACT && tie > best.tie + EXACT)) best = { move, shot, tie };
    }
  }
  return best;
}

// ---------- closing on the enemy ----------

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

// THE ROAD TO AN ENEMY HOLDING WHAT THE MISSION PAYS (`contest`): of the roads
// the walk is offered, the shortest to an enemy standing in a scoring zone or
// carrying a Black Box, where it is at most CONTEST_DETOUR Grids longer than the
// shortest of all. Null with none.
function contestRoad(d: Decision, view: SeatView): { uid: number; road: Road } | null {
  const roads = d.facts.roads as Record<string, Road> | undefined;
  const near = nearestRoad(d);
  if (!roads || !near) return null;
  let best: { uid: number; road: Road } | null = null;
  for (const [uid, road] of Object.entries(roads)) {
    const t = unitOf(view, Number(uid));
    if (!t || !holds(t, view)) continue;
    if (!best || road.length < best.road.length) best = { uid: Number(uid), road };
  }
  return best && best.road.length <= near.road.length + CONTEST_DETOUR ? best : null;
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
  const walk = roadOf(d, view, me, foes);
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

// THE ROAD TO THE ENEMY, as `approach` walks it: what a Grid with nothing to
// attack from it is worth, the nearer the enemy the better.
function roadOf(d: Decision, view: SeatView, me: UnitView, foes: UnitView[], k: BrawlerSkills = COPY): (at: Grid, facing: number) => number {
  const led = (k.contest ? contestRoad(d, view) : null) ?? nearestRoad(d);
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
  return (at: Grid, facing: number): number => {
    const to = onward(at);
    return -far(at) + (to && !same(at, to) && facing === facingAt(at, to) ? FACING_EPSILON : 0);
  };
}

// Whether one ranking beats another, term by term (`kite`, `screen`): the last
// term by more than BETTER_BY, as `approach` asks of a move over staying.
function ranksAbove(a: number[], b: number[]): boolean {
  for (let i = 0; i < a.length; i++) {
    const more = a[i] - b[i];
    const by = i === a.length - 1 ? B.BETTER_BY : EXACT;
    if (more > by) return true;
    if (more < -by) return false;
  }
  return false;
}

// MOVE TOWARD CONTACT WITH ITS HABITS (`kite`, `screen`, `jams`): `approach`'s
// Grids and its asking of the engine, ranked so that, of the Grids it could
// attack from, the one fewest enemies could attack it in comes first and then
// the farthest from the enemy it would attack (`kite`); of the Grids it could
// not, a Drone takes the one fewest enemies could attack it in before the one
// nearer the enemy, and stays put rather than step into the line of fire
// (`screen`); and an Electronic Attack's Range counts as reach (`jams`).
function approachWith(d: Decision, view: SeatView, me: UnitView, foes: UnitView[], trust: boolean, k: BrawlerSkills): Choice | null {
  const moves = d.options.filter((o) => o.tags[0] === 'move' && !!endOf(o));
  if (!moves.length || !foes.length) return null;
  const walk = roadOf(d, view, me, foes, k);
  const jamming = k.jams && !strikers(me).length && jammers(me).length > 0;
  const screened = k.screen && me.kind === 'drone';
  const covered = k.cover && !screened;
  const end = d.options.find((o) => o.tags.includes('end'));
  type Cand = { o: Option | null; at: Grid; facing: number; claim: number | null; s: number | null };
  const claimOf = (at: Grid, facing: number): number | null => (jamming ? jamAt(me, at, foes) : standing(me, at, facing, view, foes, k));
  // Staying first, so that a move must be better to be taken.
  const cands: Cand[] = [
    { o: null, at: me.grid, facing: me.facing, claim: claimOf(me.grid, me.facing), s: null },
    ...moves.map((o) => { const at = endOf(o)!; const facing = facingOf(o) ?? me.facing; return { o, at, facing, claim: claimOf(at, facing), s: null }; }),
  ];
  const danger = k.kite || screened || k.safer || covered ? dangerAt(me, cands.map((c) => c.at), d, foes) : cands.map(() => 0);
  const dangerOf = new Map(cands.map((c, i) => [c, danger[i]]));
  // How far off the enemy it would attack is, from there.
  const reachFrom = (c: Cand): number => {
    const targets = foes.filter((f) => (jamming ? apart(c.at, f.grid) <= Math.max(...jammers(me).map((w) => w.range)) : couldStrike(me, c.at, c.facing, f, lockedAt(me, c.at, foes))));
    return targets.length ? Math.min(...targets.map((f) => apart(c.at, f.grid))) : 0;
  };
  // Whether it could attack from each, by the engine's word as `approach` asks
  // it; an Electronic Attack by its Range alone. The likeliest are asked
  // first; with its habits, the Grids fewest enemies could attack it in and
  // the farthest off, which are the ones it would take.
  const order = k.kite || (screened && !k.safer)
    ? [...cands].sort((a, b) => (dangerOf.get(a) ?? 0) - (dangerOf.get(b) ?? 0) || reachFrom(b) - reachFrom(a) || (b.claim ?? 0) - (a.claim ?? 0))
    : k.safer
      ? [...cands].sort((a, b) => exposed(dangerOf.get(a)) - exposed(dangerOf.get(b)) || (b.claim ?? 0) - (a.claim ?? 0))
      : [...cands].sort((a, b) => (b.claim ?? 0) - (a.claim ?? 0));
  let asked = 0;
  for (const c of order) {
    if (c.claim === null) continue;
    if (jamming) { c.s = c.claim; continue; }
    const o = c.o ?? end;
    if (o?.later) {
      if (asked >= B.MOVEMENT_CELLS_PER_STEP) continue;
      asked += 1;
    }
    const answer = o ? standingAfter(o, me, c.at, view, foes, k) : undefined;
    c.s = answer === undefined ? (trust ? c.claim : null) : answer;
  }
  // A Drone moved now acts in the Automatic Phase, after every Mech of the
  // other squad has had its turn: a Grid it could attack from that a Mech
  // could attack it in first is no Grid to attack from (`screen`). And the
  // Mechs it would attack will have moved by then, so it keeps two Grids of
  // its Range in hand rather than stand at the end of it (`kite`).
  const arm = Math.max(0, ...(jamming ? jammers(me) : strikers(me)).map((w) => w.range));
  // How near the nearest enemy each Grid it cannot attack from is, and the
  // nearest of them (`cover`): a Grid off the road to the enemy counts too, so
  // it may step aside behind a wall.
  const walking = cands.filter((c) => !(c.s !== null && c.s >= B.ATTACK_GRID_SCORE));
  const gap = (c: Cand): number => Math.min(...foes.map((f) => apart(c.at, f.grid)));
  const closest = walking.length ? Math.min(...walking.map(gap)) : 0;
  const rank = (c: Cand, i: number): number[] => {
    const attack = c.s !== null && c.s >= B.ATTACK_GRID_SCORE;
    // `cover`: walking up, of the Grids within COVER_SLACK of the nearest the
    // enemy, the one fewest enemies could attack it in, then the nearer the
    // enemy, then the farther along the road.
    if (covered && !attack) {
      const near = gap(c) <= closest + COVER_SLACK;
      return [0, near ? 1 : 0, near ? -danger[i] : 0, -gap(c), walk(c.at, c.facing)];
    }
    // `safer` on a Drone that keeps out of the line of fire: an attack from
    // where one enemy at most could answer it is taken; walking, none.
    if (screened && k.safer) return attack ? [-exposed(danger[i]), 1, 0, c.s ?? 0] : [-danger[i], 0, 0, walk(c.at, c.facing)];
    if (screened) return [-danger[i], Number(attack), attack && k.kite ? Math.min(reachFrom(c), Math.max(1, arm - 2)) : 0, attack ? c.s ?? 0 : walk(c.at, c.facing)];
    if (attack) return k.kite ? [1, -danger[i], reachFrom(c), c.s ?? 0] : k.safer ? [1, -exposed(danger[i]), 0, c.s ?? 0] : [1, 0, 0, c.s ?? 0];
    return k.safer ? [0, -exposed(danger[i]), 0, walk(c.at, c.facing)] : [0, 0, 0, walk(c.at, c.facing)];
  };
  // `claim`: a walk into a scoring zone not yet this squad's comes first (the
  // first term says whether it attacks; a Drone keeping out of the line of
  // fire ranks by danger first and is left as it was).
  // Staying in a zone the dial does not yet name for this squad (held now, or
  // the enemy's) comes before walking into another: walking out gives it up.
  const claiming = k.claim && !screened;
  const claimTerm = (c: Cand): number => (!c.o && holding(c.at, view) ? 2 : unclaimed(c.at, view) ? 1 : 0);
  const ranks = cands.map((c, i) => {
    const r = rank(c, i);
    return claiming ? [r[0], r[0] === 0 ? claimTerm(c) : 0, ...r.slice(1)] : r;
  });
  let bi = 0;
  for (let i = 1; i < cands.length; i++) if (ranksAbove(ranks[i], ranks[bi])) bi = i;
  const best = cands[bi];
  if (!best.o) {
    // Nowhere better to stand: a Drone keeping out of the line of fire ends
    // its activation where it is rather than walk on for the Main Task.
    if (screened && end) return { option: end.id, reason: 'out_of_fire', why: 'keeping out of the line of fire' };
    // And one standing in a zone not yet its squad's holds it (`claim`).
    if (claiming && end && claimTerm(best) > 0) return { option: end.id, reason: 'hold_zone', why: 'holding a zone the mission scores' };
    return null;
  }
  const attack = best.s !== null && best.s >= B.ATTACK_GRID_SCORE;
  // Whether cover passed over a Grid nearer the enemy that more enemies could attack it in.
  const sheltered = covered && !attack && walking.some((c) => gap(c) < gap(best) && (dangerOf.get(c) ?? 0) > danger[bi]);
  return {
    option: best.o.id, reason: 'contact_before_occupation', score: best.s ?? walk(best.at, best.facing),
    why: attack ? (jamming ? 'to a Grid it can jam from' : 'to a Grid it can attack from') : claiming && unclaimed(best.at, view) ? 'into a zone the mission scores' : screened || sheltered ? 'closing on the enemy, out of the line of fire' : 'closing on the nearest enemy',
  };
}

// A DRONE WITH NOTHING TO ATTACK WITH STAYS WITH ITS SQUAD (`escort`): one
// carrying a Load in Contact with an Ally Mech, which then uses the Load as its
// own Part (162_A), and any other beside the nearest Mech of its squad; of
// those the Grid fewest enemies could attack it in. Null with no Mech left.
function escort(d: Decision, view: SeatView, me: UnitView, foes: UnitView[]): Choice | null {
  const mechs = view.units.filter((u) => u.side === view.seat && u.kind === 'mech' && u.deployed && u.alive);
  if (!mechs.length) return null;
  const end = d.options.find((o) => o.tags.includes('end'));
  const near = (at: Grid): number => Math.min(...mechs.map((m) => apart(at, m.grid)));
  type Cand = { o: Option | null; at: Grid; lends: number | null };
  const touching = me.lends ? mechs.find((m) => touches(me, m)) : undefined;
  const cands: Cand[] = [
    { o: null, at: me.grid, lends: touching?.uid ?? null },
    ...d.options.filter((o) => o.tags[0] === 'move' && !!endOf(o) && !o.tags.includes('crush-unit') && !o.tags.includes('mined'))
      .map((o) => ({ o, at: endOf(o)!, lends: me.lends && typeof o.facts?.lendsTo === 'number' ? o.facts.lendsTo : null })),
  ];
  const danger = dangerAt(me, cands.map((c) => c.at), d, foes);
  const rank = (c: Cand, i: number): number[] => [me.lends ? Number(c.lends !== null) : 0, -danger[i], -near(c.at)];
  const ranks = cands.map(rank);
  let bi = 0;
  for (let i = 1; i < cands.length; i++) if (ranksAbove(ranks[i], ranks[bi])) bi = i;
  const best = cands[bi];
  const lentTo = best.lends !== null ? unitOf(view, best.lends)?.label : undefined;
  if (!best.o) {
    return end ? { option: end.id, reason: 'escort', why: lentTo ? `lending its Load to ${lentTo} where it stands` : 'staying with its squad' } : null;
  }
  return { option: best.o.id, reason: 'escort', why: lentTo ? `to lend its Load to ${lentTo}` : 'back beside its squad' };
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
function activation(asked: Decision, view: SeatView, k: BrawlerSkills = COPY): Choice | null {
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
  const now = bestShot(d.options, view, me.grid, k);
  const launch = launching(d, view, foes, k);
  const worthNow = now && now.value > 0 ? now.value : 0;

  // Attack now, unless a Maneuver or a move Action reaches a strictly better
  // attack. A Projectile to launch is an attack like another, worth what its
  // blast is. With `kite`, an attack as good from a Grid fewer enemies could
  // attack it in, or from farther off, is better too.
  const ahead = reachedBy(d, view, me, foes, k);
  const fromHere = (): Reached | null => (now && ahead ? {
    move: ahead.move, shot: now, tie: standing(me, me.grid, me.facing, view, foes, k) ?? 0,
    danger: dangerAt(me, [me.grid], d, foes)[0], far: now.target ? apart(me.grid, now.target.grid) : 0,
  } : null);
  const kiting = k.kite && !!ahead && !!now && worthNow > 0 && worthNow >= (launch?.value ?? 0);
  const here = kiting ? fromHere() : null;
  // `safer`: standing where two or more enemies could answer, it moves first to
  // a Grid one at most could, for an attack worth most of this one; and it does
  // not walk into two or more's lines of fire for a better attack than the one
  // it has from where it stands.
  const attacksHere = !!now && worthNow > 0 && worthNow >= (launch?.value ?? 0);
  const hereExposed = k.safer && attacksHere ? exposed(dangerAt(me, [me.grid], d, foes)[0]) : 0;
  const shelter = k.safer && !!ahead && attacksHere && hereExposed === 1 && exposed(ahead.danger) === 0 && ahead.shot.value >= worthNow * SAFER_SHARE;
  const intoFire = k.safer && !!ahead && attacksHere && hereExposed === 0 && exposed(ahead.danger) === 1;
  if (shelter && ahead) {
    return {
      option: ahead.move.id, reason: 'safer_attack', score: ahead.shot.value,
      why: `from there, ${ahead.shot.option.label} (${said(ahead.shot)})`,
    };
  }
  if (ahead && !intoFire && (here ? kiteBeats(ahead, here) : ahead.shot.value > Math.max(worthNow, launch?.value ?? 0) + B.BETTER_BY)) {
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
    const scored = jams.map((o) => {
      const t = unitOf(view, o.facts?.targetUid);
      return { o, s: t ? (k.jams ? jamWorth(t) : targetScore(t, apart(me.grid, t.grid))) : 0 };
    });
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
    const shot = next ? bestShot(next.options, view, me.grid, k) : null;
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
  // A Drone with nothing to attack with stays with its squad (`escort`).
  if (k.escort && me.kind === 'drone' && unarmed(me)) {
    const stay = escort(d, view, me, foes);
    if (stay) return stay;
  }
  const step = k.kite || k.screen || k.jams || k.safer || k.cover || k.contest || k.claim ? approachWith(d, view, me, foes, !walled, k) : approach(d, view, me, foes, !walled);
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

function launching(d: Decision, view: SeatView, foes: UnitView[], k: BrawlerSkills = COPY): Launch | null {
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
      const shot = turn ? bestShot(turn.options, view, l.at, k) : null;
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
function dial(d: Decision, view: SeatView, k: BrawlerSkills = COPY): Choice | null {
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
    const opening = openingOf(o, view, me, foes, k);
    if (opening && (!best || opening.value > best.value + EXACT)) best = { o, ...opening };
  }
  if (best) return { option: best.o.id, reason: 'intent_opening', score: B.INTENT_OPENING_SCORE, why: best.why };
  const move = d.options.find((o) => o.tags.includes('timing:movement'));
  return move ? { option: move.id, reason: 'reposition_opening', score: B.REPOSITION_OPENING_SCORE, why: 'nothing it can open on, so it moves first' } : null;
}

// What the Opportunity a dial would open is worth, and what it begins with in
// words: the best of an attack on offer as it opens, a Projectile to launch at
// something, and an attack the Maneuver reaches. Null when it opens on none.
function openingOf(o: Option, view: SeatView, me: UnitView, foes: UnitView[], k: BrawlerSkills = COPY): { value: number; why: string } | null {
  const turn = o.then?.(['attack', 'maneuver', 'launch']);
  if (!turn) return null;
  let best: { value: number; why: string } | null = null;
  const now = bestShot(turn.options, view, me.grid, k);
  if (now && now.value > 0) best = { value: now.value, why: `it opens with ${now.option.label} (${said(now)})` };
  const launch = launching(turn, view, foes, k);
  if (launch && (!best || launch.value > best.value + EXACT)) best = { value: launch.value, why: `it opens with ${launch.why}` };
  const ahead = reachedBy(turn, view, me, foes, k);
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
function deploy(d: Decision, view: SeatView, k: BrawlerSkills = COPY): Choice | null {
  if (k.escort || k.kite) return deployWith(d, view, k);
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

// DEPLOYMENT WITH ITS HABITS: a Drone with nothing to attack with is set down
// last, in Contact with a Mech where it has a Load to lend and otherwise beside
// the nearest one (`escort`); a ranged unit that could attack from its zone
// takes the Grid of it fewest enemies could attack it in, then the farthest
// from them (`kite`); the rest as `deploy` sets them down.
function deployWith(d: Decision, view: SeatView, k: BrawlerSkills): Choice | null {
  const foes = foesOf(view);
  const aim = foes.length ? null : centreOf(view);
  const mechs = view.units.filter((u) => u.side === view.seat && u.kind === 'mech' && u.deployed && u.alive);
  const cands: { o: Option; me: UnitView; at: Grid; s: number }[] = [];
  for (const o of d.options) {
    const at = endOf(o);
    const me = unitOf(view, o.facts?.uid);
    if (!at || !me) continue;
    if (o.facts?.stance !== undefined && o.facts.stance !== 'offensive') continue;
    const s = standing(me, at, facingOf(o) ?? 0, view, foes) ?? -(aim ? apart(at, aim) : Math.min(...foes.map((f) => apart(at, f.grid))));
    cands.push({ o, me, at, s });
  }
  if (!cands.length) return null;
  const danger = k.kite && foes.length ? cands.map((c) => dangerAt(c.me, [c.at], d, foes)[0]) : cands.map(() => 0);
  const ranged = (u: UnitView): boolean => Math.max(0, ...strikers(u).map((w) => w.range)) > 1;
  const rank = (c: (typeof cands)[number], i: number): number[] => {
    if (k.escort && c.me.kind === 'drone' && unarmed(c.me)) {
      const lent = c.me.lends && typeof c.o.facts?.lendsTo === 'number' ? 1 : 0;
      return [0, lent, mechs.length ? -Math.min(...mechs.map((m) => apart(c.at, m.grid))) : c.s, 0];
    }
    // Any Grid it could attack from before any it could not, as `deploy` has it.
    if (c.s < B.ATTACK_GRID_SCORE) return [1, -100, 0, c.s];
    if (!k.kite || !ranged(c.me)) return [1, 0, 0, c.s];
    const far = foes.length ? Math.min(...foes.map((f) => apart(c.at, f.grid))) : 0;
    return [1, -danger[i], far, c.s];
  };
  const ranks = cands.map(rank);
  let bi = 0;
  for (let i = 1; i < cands.length; i++) if (ranksAbove(ranks[i], ranks[bi])) bi = i;
  const best = cands[bi];
  const why = k.escort && best.me.kind === 'drone' && unarmed(best.me)
    ? (typeof best.o.facts?.lendsTo === 'number' ? `deployed against ${unitOf(view, best.o.facts.lendsTo)?.label ?? 'a Mech'} to lend its Load` : 'deployed beside its squad')
    : 'deployed as far forward as its zone goes';
  return { option: best.o.id, reason: 'deploy_toward_enemy', score: best.s, why };
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
// about, by the copy's own reckoning.
export function worthIn(d: Decision, view: SeatView): Worth {
  const target = unitOf(view, d.facts.targetUid);
  return (f) => attackWorth(f, target);
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

// ---------- the policy ----------

function decide(d: Decision, view: SeatView, k: BrawlerSkills = COPY): Choice | null {
  switch (d.kind) {
    case 'opp.act':
    case 'activation.act':
      return activation(d, view, k);
    case 'opp.reboot': {
      const up = d.options.find((o) => o.tags.includes('stance:offensive'));
      return up ? { option: up.id, reason: 'reboot', why: 'back up, ready to attack' } : null;
    }
    case 'planning.dial':
      return dial(d, view, k);
    case 'setup.deploy':
      return deploy(d, view, k);
    case 'setup.designate.leader':
      // The Commander is the first eligible unit: no thought goes into it.
      return d.options.length ? { option: d.options[0].id, reason: 'first_eligible_commander', why: 'the first unit that may lead' } : null;
    case 'setup.secondary':
      return k.hunter ? huntersCard(d, view) : null;
    case 'setup.designate.target':
    case 'setup.designate.zone':
      return k.hunter ? secondaryName(d, view) : null;
    case 'loop.designate.command':
      return command(d, view);
    case 'loop.designate.automatic':
    case 'loop.designate.delay':
      return activate(d, view);
    case 'attack.part':
      return hitLocation(d, view, worthIn(d, view));
    case 'attack.partfocus': {
      // A Part Die is thrown again only when it found a Part already
      // destroyed, and here that die lands on the Torso by itself.
      const keep = d.options.find((o) => o.id === 'part.keep');
      return keep ? { option: keep.id, reason: 'skip_reroll', why: 'the Part Die stands' } : null;
    }
    case 'defence.declare':
      return declare(d, view, worthIn(d, view));
    case 'attack.focus':
    case 'defence.focus':
      return focus(d, view);
    case 'attack.reroll':
    case 'defence.reroll':
      return reroll(d, view, worthIn(d, view));
    case 'attack.surplus':
      return surplus(d, view, worthIn(d, view));
    case 'attack.finish':
      return finishing(d, view);
    default:
      return null;
  }
}

// WHAT A HIT DOES TO THE UNIT IT STRUCK (OTTO, 2026-10-05: "neither disarm or
// pull were performed"). A bonus attack first, as ever. Then each effect of the
// hit still on offer, one press at a time: a Shutdown, a Disarm, an Immobilized
// Token, a turn of its back, each of them the struck unit's loss. A Drag where
// nothing else is taken (the Thrust Pick's, a Grappling Hook's on a Part with no
// Discard Card): pulled straight in, to the Grid beside the attacker nearest
// where it stood, its back to the attacker.
function finishing(d: Decision, view: SeatView): Choice | null {
  const bonus = d.options.find((o) => o.id === 'finish.bonus');
  if (bonus) return { option: bonus.id, reason: 'attack_result_value', why: 'a bonus attack is an attack' };
  for (const tag of ['shutdown', 'disarm', 'immobilize', 'turn']) {
    const o = d.options.find((x) => x.tags.includes('rider') && x.tags.includes(tag));
    if (o) return { option: o.id, reason: 'hit_effect', why: o.label };
  }
  const drags = d.options.filter((o) => o.tags.includes('drag'));
  const away = drags.filter((o) => o.tags.includes('away'));
  const pool = away.length ? away : drags;
  if (!pool.length) return null;
  const stood = view.units.find((u) => u.uid === Number(pool[0].facts?.uid))?.grid;
  const far = (o: Option): [number, number] => {
    const to = o.facts?.to as { col: number; row: number } | undefined;
    if (!to || !stood) return [0, 0];
    const dc = Math.floor(to.col / 3) - stood.col;
    const dr = Math.floor(to.row / 3) - stood.row;
    return [Math.max(Math.abs(dc), Math.abs(dr)), dc * dc + dr * dr];
  };
  const best = pool.reduce((a, b) => {
    const [x, y] = [far(a), far(b)];
    return y[0] < x[0] || (y[0] === x[0] && y[1] < x[1]) ? b : a;
  });
  return { option: best.id, reason: 'hit_effect', why: `${best.label}: pulled straight in, its back to the attacker` };
}

export const brawlerPolicy: Policy = {
  name: 'brawler',
  choose(d: Decision, view: SeatView) {
    // What it has no rule for (a step of bookkeeping, a question his leaves
    // undone) takes the answer that is always safe, and the game goes on.
    return decide(d, view) ?? { option: d.fallback, reason: 'safe_answer', why: 'the safe answer' };
  },
};

// THE BRAWLER WITH ITS HABITS, each switched as `skills` has it on top of the
// copy (`BrawlerSkills`).
export function makeBrawler(skills: Partial<BrawlerSkills>, name = 'brawler'): Policy {
  const k: BrawlerSkills = { ...COPY, ...skills };
  return {
    name,
    choose(d: Decision, view: SeatView) {
      return decide(d, view, k) ?? { option: d.fallback, reason: 'safe_answer', why: 'the safe answer' };
    },
  };
}
