// THE TACTICIAN: ours (AI-OPPONENT-PLAN.md, section 6). Where the Brawler is a
// ladder of rules, this is one question asked of every answer: what is it
// worth, in Victory Points, to end up there and do that?
//
// A unit's activation is planned as WHERE IT ENDS AND WHAT IT DOES THERE. Each
// plan is the sum of five things, all in one currency (evaluate.ts):
//
//   - what it does there now: the attacks it could make, by their odds;
//   - what it could do from there at its next turn, for less;
//   - what the Main Task gains by its standing there when the round ends;
//   - which way it is walking, when nothing above tells two Grids apart;
//   - LESS what the other squad could do to it there before it moves again.
//
// The last is the one the Brawler has no word for. Each enemy unit that could
// bring an attack to bear on a Grid, from where it stands or by stepping out
// first, is asked what it would do to the unit standing there, and its answer
// is priced as its own attacks are. So a Drone is not walked into two Mechs'
// guns, a Commander is kept out of the worst lanes, and a zone is taken by the
// unit that can stand in it.
//
// Every number it adds up is the engine's: the odds on an attack (`chance`),
// what an answer leads to (`then`, `later`), the table it would leave and what
// any unit would be asked on it (`after`, `here`: an Outlook). Geometry is used
// only to choose which of those questions are worth asking.
//
// EACH THING IT THINKS ABOUT CAN BE TURNED OFF (`Skills`), so that what each
// is worth can be measured by itself (section 8). With all of them off it is
// the Brawler's fighter with a different price list.
import type { Decision, Forecast, Option, Outlook, SeatView, UnitView, ZoneView } from '../seat';
import type { Choice, Policy } from './policy';
import {
  apart, attacking, brawlerPolicy, couldStrike, declare, endOf, facingAt, facingOf, foesOf, hitLocation, lockedAt, percent, reaches, ready, reroll,
  same, standing, strikers, surplus, unitOf, type Grid, type Road, type Worth,
} from './brawler';
import { behindNow, carried, gainOf, holds, marginOf, missionOf, payFrom, stride, swingOf, TACTICIAN, unitWorth, zoned, type Weights } from './evaluate';

export interface Skills {
  // The Main Task as a term of every plan (M7.2).
  mission: boolean;
  // What the other squad could do to a unit where a plan leaves it (M7.3).
  exposure: boolean;
  // A Stance chosen for what it is worth (M7.4).
  stance: boolean;
  // A Charge made and spent, where the attack it buys is worth it (M7.6).
  charge: boolean;
  // A Focus paid for when the reroll it buys is worth more than the Link
  // (M7.6).
  focus: boolean;
  // A Command given to the Drone it does most for, or to none (M7.3).
  command: boolean;
  // The Timing Dial chosen by the whole plan it would open (M7.7).
  dials: boolean;
  // The Commander chosen, and the squad deployed, for what each is worth
  // (M7.5).
  setup: boolean;
  // Smoke as cover, where what standing there costs is less behind it
  // (M8.2c): a Smoke card thrown at its own feet (`screen`), and Emergency
  // Smoke taken when it is shot at (`emergency`). Both read that cost, so
  // neither does anything without `exposure`.
  screen: boolean;
  emergency: boolean;
  // An Action that gives a squad back what it has lost (a Part mended or
  // Repaired, Link, a Token cleaned off, Ammo), weighed as a deed beside an
  // attack (M8.2f).
  support: boolean;
  // A Low Profile Token taken (Ambush), and a Mode changed, each where the
  // unit is better off for it: by what it could then do, and by what standing
  // there would then cost (M8.2f). The cost needs `exposure`.
  profile: boolean;
  mode: boolean;
  // A Command Coordination: a Command handed to a Drone in the middle of the
  // Mech's own turn, where the Drone gains by acting (M8.2f).
  coordinate: boolean;
  // A Command counted for what the Drone would DO with it where it stands, as
  // well as for where it would go: with none it does neither (M8.2f).
  orders: boolean;
  // OPTICAL CAMOUFLAGE (M8.2g). An attack on a unit in it, made through the
  // free Scan that designates it and weighed at the Scan's odds (`stalk`);
  // the State put on by its Action, as a plan like a Stance (`cloak`); and
  // where a unit of its own appears as it is Revealed, each Grid in reach
  // weighed as a Grid to deploy in is (`appear`).
  stalk: boolean;
  cloak: boolean;
  appear: boolean;
  // A unit in Optical Camouflage that ACTS where it stands is seen for it: its
  // plan to stay and do something is priced on the table its deed leaves, and
  // its plan to stay and do nothing as the unit hidden (M8.2g).
  shown: boolean;
  // The KK9's Overwatch Strike: a deed worth the shot it buys an Ally Mech,
  // less the Drone it costs (M8.2h).
  overwatch: boolean;
  // An Extra Action Opportunity handed to an Ally Mech (Coordinate): a deed
  // worth what the Mech would do with it, less the Link it costs (M8.2i).
  grant: boolean;
  // A Multi-Target's pool split between targets where the shares are worth
  // more together than the whole pool on the one clicked (M8.2j).
  spread: boolean;
  // Prototype Blink planned as a move to where the other Mech stood, on the
  // table the exchange leaves (M8.2k).
  blink: boolean;
  // An Action Tick bought (a pilot's Link for a Tick, Overload, Attack Mode)
  // where the plan it opens is worth more than the Link it costs (M8.2l).
  ticks: boolean;
  // A Scan paid for at a unit in Optical Camouflage is no jam: an attack that
  // designates the unit has its Scan free (M8.2m).
  scan: boolean;
  // Mines Laid along a walk (006_A), where an enemy stands nearer than this
  // squad does (M8.2n).
  mines: boolean;
  // The "White Dwarf" Bit's Stance Change (293_B, 294_B, 295_B): a face and the
  // walk it owes planned as any Movement is, on the table the face leaves, and
  // a face taken where it stands as a Mode is (M8.2o).
  bit: boolean;
  // A Crush of a Unit (4.3.6): a Movement that ends in one planned for each way
  // it comes out, and the Grids an enemy Mech could crush its way into counted
  // in what it could do a round on (M8.2p).
  crush: boolean;
  // Tactics Cards (5.4), each played where it does more than keeping it is
  // worth (M8.2q).
  tactics: boolean;
  // A Mech takes its Stance afresh as its next Opportunity begins (4.1: only
  // the first move or Action of an Opportunity fixes it). What it could do at
  // its next turn, and on a VIP mission its answer to a Mech walking up to it,
  // is read in Offensive Stance where it may take that, as well as in the
  // Stance a plan leaves it in. Without it a plan's next turn is fought in the
  // Stance the plan ends in, and Defensive Stance looks dearer than it is
  // (M8.2q).
  restance: boolean;
  // The pilot traits (M8.2r): Firewatch's Link for a Command Token, where the
  // Command Coordination it buys is worth more than the Link (`firewatch`);
  // Aster's Command Token for a Link, where nothing else would use it
  // (`aster`).
  firewatch: boolean;
  aster: boolean;
  // The Red Shoes (TM35NA_B): an enemy unit steered with its own Movement where
  // this squad could do most to it (M8.2s).
  steer: boolean;
  // A Maneuver into a Grid with something to do there may still be the first
  // of two Movements into a zone (`entryBy`): the plan of going on into the
  // zone is weighed beside the plan of acting there. Without it only a Grid
  // with nothing to do leads on, and a Black Box carrier with a blow to strike
  // on its way home struck it and never carried the Box in (M10.2).
  entryDeed: boolean;
  // A Forced Movement this seat's attack owes (Knockback X, Push X; M8.2t):
  // which way the victim is left facing, and for a Push where it goes, priced
  // as `steer` prices a Grid. Without it the move is made as the safe answer
  // makes it, the facing left as it was.
  shove: boolean;
  // System Repair (277) on another unit of the squad than the Mech whose
  // Opportunity it is: what that unit gets back by the Token gone at its next
  // turn is the plan's (`mended`). A Fire Control Interference Token keeps a
  // unit from firing at all; of 37 offers of the card in 30 random games with
  // every card in both hands it was played twice, never to give a gun back
  // (2026-10-03, night). Without it the card is weighed for the Mech itself.
  mend: boolean;
  // What standing in a Grid costs is kept for the facing the plan leaves it in
  // (`harmKey`). Without it the price of a Grid was kept for the Grid alone, so
  // a plan to stay and a plan to turn on the spot shared whichever of the two
  // was priced first, though an enemy behind a unit hits it harder than one in
  // front (found 2026-10-04 staging the Highlight: the Mire's stay cost 0.77,
  // its turn's, where its own was 1.01).
  faced: boolean;
  // A price stopped past its budget says so (`exposure`). The asking stops once
  // a plan cannot beat the best so far, and what it has cost by then must be
  // more than the budget it was given, or the plan is taken as if priced in
  // full. A VIP Commander's round after (`ahead`) was checked against the
  // budget and left out of the cost returned: a White Dwarf's Mode change came
  // back at 0.00 where it cost 1.23, was taken, and was undone the next Action
  // (random game 51001, found 2026-10-04 by a census of Modes changed twice in
  // one activation). Without it the old answer.
  bounded: boolean;
  // What a decision has worked out is kept while the table stands as it did
  // (`tableOf`), and a Mode or a Bit's face changed is a table changed: the key
  // reads which card each unit and each Part is. Without it a White Dwarf's
  // Mode change left the key as it was, the next question read the costs and
  // the turns worked out for the other Mode, and the Mech changed back without
  // making the launch it had changed for (random game 51040, found 2026-10-04).
  carded: boolean;
}

export const SKILLS: Skills = {
  mission: true, exposure: true, stance: true, charge: true, focus: true, command: true, dials: true, setup: true, screen: true, emergency: true,
  support: true, profile: true, mode: true, coordinate: true, orders: true, stalk: true, cloak: true, appear: true, shown: true, overwatch: true, grant: true,
  spread: true, blink: true, ticks: true, scan: true, mines: true, bit: true, crush: true, tactics: true, restance: true, firewatch: true, aster: true, steer: true,
  entryDeed: true, shove: true, mend: true, faced: true, bounded: true, carded: true,
};

// How much of the board is put to the engine in one decision.
const LIMITS = {
  // The Grids a move is tried from for an attack this activation, at most.
  LANDINGS: 24,
  // The Grids asked what could be attacked from them a turn later: fewer for
  // a Mech, which is asked on each Timing its weapons open.
  FUTURES: 10,
  MECH_FUTURES: 8,
  // The Grids a plan that acts now ends in, asked what it could still do there a
  // turn later (`nextAfter`): those of the best deeds.
  AFTERS: 4,
  // The plans, of those some enemy could reach, whose cost is asked of the
  // engine: the ones worth most before it. A plan no enemy could reach costs
  // nothing to price, and every one of those is weighed.
  PRICED: 8,
  // When every plan priced is a costly one, the plans asked about next: the
  // Grids fewest enemies could see, which is where cover is.
  COVER: 10,
  // The plans whose whole volley is worked out, the first attack and what
  // could follow it: the rest are ranked by their first attack.
  VOLLEYS: 3,
  // How much further than its printed Range an enemy's Firing is supposed to
  // reach when choosing whom to ask (a [Stationary] line adds Grids).
  SLACK: 2,
  // Of the Grids an enemy Mech could walk to this round, the ones nearest the
  // unit that are asked what it could do from there next round.
  CLOSING: 2,
  // The Grids asked what standing there would spare the squad's Commander
  // (`escort`).
  ESCORTS: 4,
} as const;

const EXACT = 1e-9;
// What standing somewhere must cost before cover is looked for.
const DANGER = 0.5;
// What an attack nobody could put odds on is taken to be worth: something.
const UNKNOWN_SHOT = 0.5;
// A Charge spent on an attack is a Charge not there for the next.
const CHARGE_COST = 0.05;

// ---------- what is being decided, and for whom ----------

interface Ctx {
  d: Decision;
  view: SeatView;
  me: UnitView;
  // The enemy units that can be fought, and everything of the enemy's that
  // could attack (its Projectiles on the board among them).
  foes: UnitView[];
  hostile: UnitView[];
  // The enemy units in Optical Camouflage, as geometry would read them seen:
  // each may be designated from where an attack could be made on its marker.
  hidden: UnitView[];
  w: Weights;
  skills: Skills;
  // The Main Task as the board stands, and the margin in Victory Points it is
  // heading for (`missionOf` without the game on top).
  mission: number;
  margin: number;
  // The game would be lost if it ended now (`behindNow`; read only for `press`).
  behind: boolean;
  // Its own Movement of this round is still to come, after what is being
  // decided: a unit being deployed. A walk begun from where it is put down
  // is a round sooner. (A Drone moved by a Command does NOT move again in the
  // Automatic Phase: it moves only when Commanded, 3.2.2.)
  soon: boolean;
  // Worked out once for a table (Memo): what each enemy's Firing is worth,
  // what standing in each Grid would cost this unit, what it could do from
  // each a turn later, how long each walk to a zone is, and which zones are
  // whose to walk to.
  firepower: Map<number, number>;
  harms: Map<string, Harm>;
  nexts: Map<string, number>;
  walks: Map<string, Stroll | null>;
  targets: Map<string, Target[]>;
  holdings: Map<number, number>;
  // What each Drone would gain by the Tactic that is a Command Coordination
  // (`handOff`), by the Mech and the answer: worked out in steps before the
  // deeds are weighed, since each is the planning of a Drone's whole turn.
  handed: Map<string, number | null>;
  // What a Firing attack on each unit of this squad in its sights is worth to
  // each enemy, as the board stands (`aimsOf`, the `decoy` weight).
  aims: Map<number, Map<number, number>>;
  // The table those are read on, where it is not the board as it stands: a
  // Highlight changes whom an enemy may shoot (`tauntOf`), and `aims` is then
  // that table's own.
  aimsOn?: Outlook;
  // The race for each loose Black Box, by its id (`racesOf`), worked out once
  // a table.
  races: { map: Map<string, Race> | null };
  // What each unit of this squad whose turn is still to come this round could
  // do to each enemy it has in its sights (`backsOf`, focus fire), worked out
  // once a table.
  backs: { map: Map<number, Back> | null };
}

// FOCUS FIRE (M13): an enemy, as the units of this squad whose turn is still
// to come this round could attack it from where they stand: of them, the most
// any one gains on the chance it destroys the enemy if the enemy's vital Part
// (a Mech's Torso, a Drone's one Part) were Damaged first.
interface Back { gain: number; by: number }

// A RACE FOR A LOOSE BOX (M11): the round each squad's soonest unit with a
// hand free could take it (Infinity: none before the game ends), and the enemy
// unit that would.
interface Race { ours: number; theirs: number; by: number | null }

// A walk as the engine counts it (Outlook.walk): the Grids on the road, and
// the activations it takes.
interface Stroll { grids: number; turns: number }

// A zone worth walking to: one the Main Task scores that is not this squad's.
interface Target {
  zone: ZoneView;
  cells: Grid[];
  // A Black Box lying loose in this Grid, which the walk goes by way of: it is
  // fetched and carried to `cells`, counted as the one walk it is.
  via?: Grid;
  // Taking a zone the other squad has pays twice: what it pays, and what it
  // stops paying them.
  swing: number;
  // How much of it is this unit's to walk for (1, or less when another unit
  // of the squad would be standing in it sooner).
  share: number;
  // Somebody of the other squad's stands in it: it cannot be taken yet.
  held: boolean;
}

// WHAT ONE TABLE HAS ALREADY BEEN ASKED, kept from one decision to the next for
// as long as the table is the same one. A dial is chosen by planning the
// Opportunity each Timing would open, and those plans stand in the same Grids;
// a Command is given by planning each Drone's activation, and the Drone it is
// given to is then asked the very question that was planned. The answers the
// engine gave are the same answers, so they are not asked for twice.
export interface Memo {
  table: string; harms: Map<string, Harm>; nexts: Map<string, number>; firepower: Map<number, number>;
  walks: Map<string, Stroll | null>; targets: Map<string, Target[]>; holdings: Map<number, number>;
  handed: Map<string, number | null>; aims: Map<number, Map<number, number>>; races: { map: Map<string, Race> | null };
  backs: { map: Map<number, Back> | null };
}
export const newMemo = (): Memo => ({ table: '', harms: new Map(), nexts: new Map(), firepower: new Map(), walks: new Map(), targets: new Map(), holdings: new Map(), handed: new Map(), aims: new Map(), races: { map: null }, backs: { map: null } });

// The table as far as those answers depend on it: every unit, where it stands
// and in what state. Whose activation is open is left out, and so is a Command
// Token on a unit: neither changes what an enemy could do to it.
function tableOf(view: SeatView, carded = true): string {
  // Whose view it is comes first: one policy may sit in both seats of a table
  // (a game that is only watched), and what one seat worked out is not the
  // other's.
  // (`carded`: and which card each unit and each Part is, and a Part repaired.)
  return JSON.stringify([view.seat, view.round, view.phase, view.units.map((u) => [
    u.uid, u.cell.col, u.cell.row, u.facing, u.stance, u.alive, u.deployed, u.done, u.timing ?? '', u.link ?? 0,
    carded ? `${u.cardId}:${u.parts.map((p) => `${p.cardId}${p.state[0]}${p.repaired ? 'r' : ''}`).join()}` : u.parts.map((p) => p.state[0]).join(''),
    u.statuses.filter((x) => !x.startsWith('command')).join(), u.charged.join(),
    u.weapons.map((x) => x.ammo ?? '').join(),
  ]), view.boxes.map((b) => [b.id, b.bearer, b.grid?.col, b.grid?.row])]);
}

// What standing somewhere would cost: the worth, to the enemy, of what it
// could do to the unit there; and the chance the unit is destroyed before this
// round is out, which is the chance it takes no zone and has no next turn.
interface Harm {
  cost: number;
  risk: number;
  partial?: boolean;
  // Who the cost is owed to: each enemy Mech's share of it, and the Timing its
  // attack would be made on. What a dial is charged for the Mechs that would
  // act before it.
  by?: { uid: number; cost: number; timing: string }[];
}
const UNHARMED: Harm = { cost: 0, risk: 0 };

const key = (g: Grid): string => `${g.col},${g.row}`;
const chebyshev = (a: Grid, b: Grid): number => Math.max(Math.abs(a.col - b.col), Math.abs(a.row - b.row));
const kindOf = (o: Option): string => o.tags[0] ?? '';
// An attack: a routine with dice in it, or the designation of a unit in
// Optical Camouflage, which is commands (the free Scan) with the attack
// behind them, and comes with the odds of both.
const isShot = (o: Option): boolean => o.run?.routine === 'attack' || (o.tags[0] === 'attack' && o.tags.includes('hidden'));

// ---------- what a unit can DO at a table ----------

// One thing done with an activation, and what it is worth.
interface Deed { option: Option; value: number; why: string; reason: string }

const said = (f: Forecast | null): string => (f ? `${percent(f.pen)} to Penetrate` : 'no odds to go by');

// Whether an attack's Hit puts a Fire Control Interference Token on its target
// (an [On Hit] rider: a Laser Suppression).
function jamsOnHit(o: Option, c: Ctx): boolean {
  const by = unitOf(c.view, o.facts?.uid);
  return !!by?.weapons.some((x) => x.actionId === o.facts?.actionId && (x.riders ?? []).includes('fci'));
}

// One attack, by its odds: what it does to its target, and what the Main Task
// gains if it destroys a unit that is holding a zone.
function shotValue(o: Option, c: Ctx): { value: number; f: Forecast | null; target: UnitView | undefined } {
  const target = unitOf(c.view, o.facts?.targetUid);
  const f = o.chance ? o.chance() : null;
  const spent = o.tags.includes('spend-charge') ? CHARGE_COST : 0;
  // A bearer that is Penetrated drops its Black Boxes: what they were worth to
  // its squad is this squad's gain, at the same share a zone-holder's is.
  const loose = f && target && c.skills.mission && target.side !== c.view.seat ? f.pen * c.w.holder * carried(target, c.view, c.w) : 0;
  // The enemy unit that would take a loose Box first, destroyed, takes none
  // (`deny`, M11).
  const denied = f && target && c.skills.mission && c.w.deny > 0 && target.side !== c.view.seat ? f.kill * c.w.deny * takesFirst(target, c) : 0;
  // A blow another unit of this squad could follow up this round (`gang`).
  const backed = f && target && c.w.gang > 0 && target.side !== c.view.seat ? gangOf(f, target, c) : 0;
  // A Hit that jams (`suppress`): the target's Firing, as an Electronic
  // Attack's won roll takes it, for the chance of a Hit.
  const jammed = f && target && c.w.suppress > 0 && target.side !== c.view.seat && jamsOnHit(o, c) ? c.w.suppress * 2 * c.w.jam * f.hit * firepower(target, c) : 0;
  const value = f && target ? gainOf(f, target, c.view, c.w, threatOf(target, c)) + f.kill * holding(target, c) + loose + denied + backed + jammed : UNKNOWN_SHOT;
  return { value: value - spent, f, target };
}

// WHAT AN ENEMY IS WORTH FOR WHERE IT STANDS. In a zone the Main Task scores it
// holds the zone, or keeps this squad from holding it; destroyed before the
// round ends, it does neither. What the Task would gain on the board without
// it is the engine's to say (`without`: its own reading of who would hold what
// with the unit gone). Nothing for a unit whose squad's dial already names the
// zone: the dial pays on after it.
function holding(e: UnitView, c: Ctx): number {
  if (!c.skills.mission || c.w.holder <= 0 || e.side === c.view.seat) return 0;
  const known = c.holdings.get(e.uid);
  if (known !== undefined) return known;
  let worth = 0;
  if (c.view.zones.some((z) => z.scoring && z.cells.includes(key(e.grid)))) {
    const gone = c.d.here?.().without(e.uid).view();
    if (gone) worth = c.w.holder * Math.max(0, missionOf(gone, c.w) - c.mission);
  }
  c.holdings.set(e.uid, worth);
  return worth;
}

// WHAT AN ENEMY WOULD GO ON TO DO, which is part of what destroying it is
// worth: a share of its best attack on this squad as the board stands, for
// each round it has left to make one in (two at most: further off than that
// is anybody's guess). A Drone with this squad's Commander in its sights is
// worth far more than its card.
function threatOf(e: UnitView, c: Ctx): number {
  if (e.side === c.view.seat) return 0;
  const rounds = Math.min(c.w.threatRounds, c.view.roundLimit - c.view.round + (e.done ? 0 : 1));
  return rounds > 0 ? c.w.threat * firepower(e, c) * rounds : 0;
}

// FOCUS FIRE (M13, `gang`). A unit's vital Part: a Mech's Torso, whose loss
// is the Mech's; a Drone's or a Projectile's one Part.
const vitalOf = (u: UnitView): string | undefined => (u.kind === 'mech' ? 'torso' : u.parts[0]?.slot);
// The chance an attack Penetrates a unit's vital Part, by its forecast.
const vitalPen = (f: Forecast, u: UnitView): number => {
  const slot = vitalOf(u);
  return f.parts.filter((x) => x.slot === slot).reduce((n, x) => n + x.share * x.pen, 0);
};

// WHAT THE UNITS STILL TO COME COULD DO WITH A BLOW STRUCK FIRST: for each
// enemy in the sights of a unit of this squad whose turn is still to come this
// round, from where that unit stands and on the Timing it has dialled, the
// most any one of them would gain on the chance it destroys the enemy if the
// enemy's vital Part were Damaged by then: its chance of Penetrating that
// Part (a Damaged vital Part Penetrated is the unit gone), over its chance of
// destroying the enemy as it stands. The engine's attacks and odds, asked once
// a table.
function backsOf(c: Ctx): Map<number, Back> {
  if (c.backs.map) return c.backs.map;
  const backs = new Map<number, Back>();
  c.backs.map = backs;
  const out = c.d.here?.();
  if (!out) return backs;
  for (const u of c.view.units) {
    if (u.side !== c.view.seat || u.uid === c.me.uid || u.done || !u.alive || !u.deployed || u.kind === 'projectile') continue;
    if (u.kind === 'mech' && !u.timing) continue;
    const turn = out.turnOf(u.uid, ['attack'], u.kind === 'mech' ? u.timing : undefined);
    for (const o of turn?.options ?? []) {
      const e = isShot(o) ? unitOf(c.view, o.facts?.targetUid) : undefined;
      const f = e && e.side !== c.view.seat ? o.chance?.() : null;
      if (!e || !f) continue;
      const gain = vitalPen(f, e) - f.kill;
      if (gain > (backs.get(e.uid)?.gain ?? 0)) backs.set(e.uid, { gain, by: u.uid });
    }
  }
  return backs;
}

// What a blow on an enemy is worth for the follow up it opens (`gang`): the
// chance it leaves the enemy's vital Part Damaged and the enemy standing,
// where that Part is Intact now, times what the unit still to come that gains
// most would gain on destroying it, at what destroying it is worth.
function gangOf(f: Forecast, e: UnitView, c: Ctx): number {
  const vital = e.parts.find((x) => x.slot === vitalOf(e));
  if (!vital || vital.state !== 'intact') return 0;
  const back = backsOf(c).get(e.uid);
  if (!back) return 0;
  const opens = Math.max(0, vitalPen(f, e) - f.kill);
  return c.w.gang * opens * back.gain * (unitWorth(e, c.view, c.w) + threatOf(e, c));
}

// THE ATTACKS OF ONE ACTIVATION: the attack worth most, and with `whole` what
// could still be made after it (`then` on an attack: the question once it is
// paid for). Two openings are tried, because the attack worth most may be the
// one that leaves no Tick for a second.
function volley(options: Option[], c: Ctx, whole: boolean): Deed | null {
  const shots = options
    // One Explosion of a blast on every unit in Range is not an attack to be
    // weighed by itself: the blast is weighed whole (blastDeed).
    .filter((o) => isShot(o) && !o.tags.includes('blast') && (c.skills.charge || !o.tags.includes('spend-charge')) && (c.skills.stalk || !o.tags.includes('hidden')))
    .map((o) => ({ o, ...shotValue(o, c) }))
    .filter((s) => s.value > EXACT)
    .sort((a, b) => b.value - a.value);
  if (!shots.length) return null;
  let best = { s: shots[0], total: shots[0].value };
  if (whole) {
    for (const s of shots.slice(0, 2)) {
      const rest = s.o.then ? volley(s.o.then(['attack'])?.options ?? [], c, false) : null;
      let total = s.value + (rest?.value ?? 0);
      // Two attacks on a unit of one Part that each only Damage it destroy it
      // between them (lostTo): what the second finishes is counted for the
      // zone the unit holds, which neither forecast could say by itself.
      const again = rest ? shotValue(rest.option, c) : null;
      if (s.f && s.target && again?.f && again.target?.uid === s.target.uid && s.target.parts.length === 1) {
        const apiece = s.f.kill + again.f.kill;
        total += Math.max(0, lostTo(s.target, [s.f, again.f]) - apiece) * holding(s.target, c);
      }
      if (s === shots[0] || total > best.total + EXACT) best = { s, total };
    }
  }
  // An attack that does no damage and jams is told by its chance to jam.
  const jamming = !!best.s.f && best.s.f.pen <= 0 && c.w.suppress > 0 && jamsOnHit(best.s.o, c);
  return { option: best.s.o, value: best.total, why: `${best.s.o.label} (${jamming ? `${percent(best.s.f!.hit)} to jam it` : said(best.s.f)})`, reason: 'attack_value' };
}

// WHAT ONE EXPLOSION COSTS THIS SQUAD when it lands on a unit of its own: what
// the same attack would be worth to an enemy making it, and what the unit
// carries lost to a Penetration.
function ownLoss(o: Option, c: Ctx): number {
  const target = unitOf(c.view, o.facts?.targetUid);
  const f = o.chance ? o.chance() : null;
  if (!target) return 0;
  return f ? gainOf(f, target, c.view, c.w) + (c.skills.mission ? f.pen * carried(target, c.view, c.w) : 0) : UNKNOWN_SHOT;
}

// A DETONATION, WEIGHED WHOLE. A blast on every unit in Range is one Explosion
// for each of them, allies too, and none of them may be left out: it is worth
// what it does to the other squad's units less what it does to this squad's.
// The first Explosion made is the one worth most. An effect with no dice (a
// Stun Grenade's Fire Control Interference) takes the Firing of every unit it
// catches for a round: each enemy's for, each of its own against. A blast on
// ONE unit is the attack on the enemy worth most, as any attack is.
// Null when the answers hold no Detonation.
interface Blast { value: number; first: Option; why: string }

function blastWorth(options: Option[], c: Ctx): Blast | null {
  const effect = options.find((o) => o.tags.includes('effect') && Array.isArray(o.facts?.caught));
  if (effect) {
    let value = 0;
    for (const uid of effect.facts?.caught as number[]) {
      const u = unitOf(c.view, uid);
      if (u) value += u.side === c.view.seat ? -ownFire(u, c) : firepower(u, c);
    }
    return { value, first: effect, why: effect.label };
  }
  const all = options.filter((o) => isShot(o) && o.tags.includes('blast'));
  if (!all.length) return null;
  let value = 0;
  let first: { o: Option; value: number } | null = null;
  for (const o of all) {
    const worth = o.tags.includes('ally') ? -ownLoss(o, c) : shotValue(o, c).value;
    value += worth;
    if (!first || worth > first.value) first = { o, value: worth };
  }
  return first ? { value, first: first.o, why: all.length > 1 ? `${first.o.label}, and ${all.length - 1} more of the same blast` : first.o.label } : null;
}

// A blast on every unit in Range on offer where the unit stands (a Projectile
// whose own Delayed Action it is): made when it is worth making.
function blastDeed(options: Option[], c: Ctx): Deed | null {
  const blast = blastWorth(options, c);
  return blast && blast.value > EXACT ? { option: blast.first, value: blast.value, why: blast.why, reason: 'blast_value' } : null;
}

// What the Projectile a launch puts down would do: asked of the engine as the
// Projectile's own turn (`later`). An Immediate Projectile's turn is the
// Detonation it owes as it lands, weighed whole; a Missile's is its attack in
// the Delay Phase; a folded Pholcus's is its Unfold, and what follows it: the
// blast it owes at once where it comes up among units, or failing that the
// jump it would make at its next Automatic Phase, a round on.
function landed(o: Option, c: Ctx): { value: number; why: string; soon: boolean } | null {
  const turn = o.later?.(['attack', 'unfold']);
  if (!turn) return null;
  const blast = blastWorth(turn.options, c);
  if (blast) return { value: blast.value, why: blast.why, soon: turn.kind === 'blast.resolve' };
  const unfold = turn.options.find((x) => kindOf(x) === 'unfold');
  if (unfold) {
    const among = volley(unfold.then?.(['attack'])?.options ?? [], c, false);
    if (among) return { value: among.value, why: `${among.why}, as it Unfolds`, soon: false };
    const jump = volley(unfold.later?.(['attack'])?.options ?? [], c, false);
    return jump ? { value: jump.value * c.w.future, why: `${jump.why}, a round on`, soon: false } : null;
  }
  const shot = volley(turn.options, c, false);
  return shot ? { value: shot.value, why: shot.why, soon: turn.kind === 'blast.resolve' } : null;
}

// A PROJECTILE TO LAUNCH, valued as the attack its blast would be: for each
// enemy a Landing Point would put inside its strike, the Landing Point nearest
// it is asked what the Projectile could do from there when its turn comes
// (`landed`). A Projectile that waits for the Delay Phase lands on a target
// that may have moved, and one that owes Interception may not land at all:
// either counts for less (`launch`). One that detonates as it lands, with
// nobody to intercept it, counts whole.
function launch(options: Option[], c: Ctx): Deed | null {
  // One Landing Point for each enemy AND each card: a unit that carries a
  // Grenade, a Stun Grenade and a Pholcus is asked about all three.
  const nearest = new Map<string, { o: Option; gap: number; foe: UnitView; strike: number }>();
  for (const o of options) {
    if (kindOf(o) !== 'launch' || !o.later) continue;
    // A "White Dwarf" Bit is launched as what its turn would do, as a
    // Projectile is (M8.2o).
    if (o.tags.includes('bit') && !c.skills.bit) continue;
    const at = endOf(o);
    const strike = typeof o.facts?.strike === 'number' ? o.facts.strike : 0;
    if (!at) continue;
    for (const f of c.foes) {
      const gap = apart(at, f.grid);
      if (f.camouflaged || gap > strike) continue;
      const spot = `${f.uid}:${String(o.facts?.cardId ?? '')}`;
      if (gap < (nearest.get(spot)?.gap ?? Infinity)) nearest.set(spot, { o, gap, foe: f, strike });
    }
  }
  let best: Deed | null = null;
  for (const { o, gap, foe, strike } of nearest.values()) {
    const blast = landed(o, c);
    if (!blast) continue;
    // A TARGET STILL TO MOVE (`launchMove`): a Projectile that strikes in the
    // Delay Phase finds an enemy whose turn this round is still to come where
    // that turn leaves it, and one that walks further than the strike has to
    // spare is out of it ("finds no target and is destroyed": four Missiles of
    // eleven in one traced game, 2026-10-04). Read as the chance it is still in
    // reach, the reach to spare against the walk it could make.
    const stays = !blast.soon && c.w.launchMove > 0 && !foe.done ? Math.min(1, (strike - gap + 1) / (stride(foe) + 1)) : 1;
    // AN INTERCEPTION OWED (`interceptOdds`): the chance the Projectile comes
    // through every attempt it draws there (`Option.survive`), so a Landing
    // Point outside an interceptor's Range is worth more than one inside it.
    const through = c.w.interceptOdds > 0 && o.survive ? o.survive() : null;
    const value = blast.value * (blast.soon && !o.facts?.intercepts ? 1 : c.w.launch) * (1 - c.w.launchMove * (1 - stays)) * (through === null ? 1 : through ** c.w.interceptOdds);
    if (value > EXACT && (!best || value > best.value + EXACT)) best = { option: o, value, why: `a Projectile for ${blast.why}`, reason: 'launch_value' };
  }
  return best;
}

// WHAT AN ENEMY'S FIRING IS WORTH TO IT, as the board stands: the best attack
// it could make on any of this squad's units if its turn came now. What an
// Electronic Attack takes away, for a round.
function firepower(e: UnitView, c: Ctx): number {
  const known = c.firepower.get(e.uid);
  if (known !== undefined) return known;
  let best = 0;
  if (strikers(e).some((x) => x.type === 'Firing')) {
    const turn = c.d.here?.().turnOf(e.uid, ['attack'], e.kind === 'mech' ? 'firing' : undefined);
    for (const o of turn?.options ?? []) {
      const target = isShot(o) && o.tags.includes('firing') ? unitOf(c.view, o.facts?.targetUid) : undefined;
      const f = target ? o.chance?.() : null;
      if (f && target) best = Math.max(best, gainOf(f, target, c.view, c.w));
    }
    // With nobody in its sights now, it is still a gun.
    if (best <= 0) best = c.w.jamIdle * unitWorth(e, c.view, c.w);
  }
  // A JAMMER'S weapon is the gun it takes away. An enemy that carries an
  // Electronic Attack is worth, each round, what this squad's best gun would
  // have done with the Firing it loses, for the chance the Counter-roll is
  // won: priced as this squad prices its own jamming (jam). It need not be in
  // Range now: it is where it will go.
  if (c.w.jammer > 0 && e.side !== c.view.seat && jams(e)) {
    const guns = c.view.units.filter((u) => u.side === c.view.seat && u.alive && u.deployed && strikers(u).some((x) => x.type === 'Firing'));
    best = Math.max(best, c.w.jammer * c.w.jam * Math.max(0, ...guns.map((u) => ownFire(u, c))));
  }
  c.firepower.set(e.uid, best);
  return best;
}

// Whether a unit carries an Electronic Attack: a Tactic it makes at a Range.
const jams = (u: UnitView): boolean => u.weapons.some((x) => ready(x) && x.type === 'Tactic' && x.range > 0);

// WHAT ONE OF THIS SQUAD'S OWN GUNS IS WORTH, as the board stands: the best
// Firing attack it could make if its turn came now, and for one with nobody
// in its sights (or jammed already), its share of the unit as a gun.
function ownFire(u: UnitView, c: Ctx): number {
  const known = c.firepower.get(u.uid);
  if (known !== undefined) return known;
  let best = 0;
  const turn = c.d.here?.().turnOf(u.uid, ['attack'], u.kind === 'mech' ? 'firing' : undefined);
  for (const o of turn?.options ?? []) {
    const target = isShot(o) && o.tags.includes('firing') ? unitOf(c.view, o.facts?.targetUid) : undefined;
    const f = target ? o.chance?.() : null;
    if (f && target) best = Math.max(best, gainOf(f, target, c.view, c.w));
  }
  best = Math.max(best, c.w.jamIdle * unitWorth(u, c.view, c.w));
  c.firepower.set(u.uid, best);
  return best;
}

// AN ELECTRONIC ATTACK: on the enemy whose Firing is worth most.
//
// A SCAN TAKES NO FIRING AWAY. At a unit in Optical Camouflage what it buys is
// the Reveal, and every attack that designates the unit makes one Scan for
// free with it (FAQ I12), so a Scan paid for is not weighed here at all: the
// designation is weighed as the attack it is, and a unit that could designate
// it from nowhere it stands walks to where it can (`claimAt`, under `stalk`).
// A Scan priced as a jam was taken, with a Tick to spare, over the designation
// that would have had it free (found by the proof of M8.2l). A Scan that
// strips Low Profile is priced as it was.
function jam(options: Option[], c: Ctx): Deed | null {
  let best: Deed | null = null;
  for (const o of options) {
    if (kindOf(o) !== 'electronic') continue;
    const target = unitOf(c.view, o.facts?.targetUid);
    if (c.skills.scan && o.tags.includes('scan') && target?.camouflaged) continue;
    // With the Counter-roll's odds read (`ewOdds`), `jam` is what a won one is
    // worth at even odds, and the odds say how even they are.
    const odds = c.w.ewOdds > 0 ? o.win?.() ?? null : null;
    const value = target ? c.w.jam * firepower(target, c) * (odds === null ? 1 : 2 * odds) : 0;
    if (value > EXACT && (!best || value > best.value + EXACT)) best = { option: o, value, why: `${o.label}: its Firing is what it would lose${odds === null ? '' : ` (${percent(odds)} to win the Counter-roll)`}`, reason: 'jam_value' };
  }
  return best;
}

// A REMOTE ACCESS: a Terminal accessed pays whoever accessed it as the round
// ends. Worth the chance of its Counter-roll (`access`) times what the Main
// Task gains by it, on the table the answer is offered at: nothing where this
// squad would hold the Terminal's zone as the round ends anyway, once where
// nobody would, twice where the other squad would (it pays this squad and not
// them).
function access(options: Option[], c: Ctx): Deed | null {
  const task = c.view.task;
  if (!c.skills.mission || task?.family !== 'terminal' || c.view.round < task.fromRound) return null;
  let best: Deed | null = null;
  for (const o of options) {
    if (kindOf(o) !== 'terminal') continue;
    const table = o.after?.()?.view() ?? c.view;
    const zone = table.zones.find((z) => z.id === o.facts?.zone);
    // (The seam offers the access only at a Terminal still open this round.)
    if (!zone) continue;
    const gain = zone.holder === c.view.seat ? 0 : zone.holder ? 2 : 1;
    // The Counter-roll's own odds, where they are read (`ewOdds`): `access` is
    // then a share of what a won roll is worth, and no longer the chance.
    const odds = c.w.ewOdds > 0 ? o.win?.() ?? null : null;
    const value = c.w.access * (odds === null ? 1 : odds) * task.vp * gain;
    if (value > EXACT && (!best || value > best.value + EXACT)) {
      best = { option: o, value, why: `${o.label}, which ${gain === 2 ? 'the other squad would have as the round ends' : 'nobody holds'}`, reason: 'access_terminal' };
    }
  }
  return best;
}

// The best thing to do at a table, of the five kinds.
function deedAt(options: Option[], c: Ctx, whole: boolean): Deed | null {
  let best: Deed | null = null;
  for (const deed of [volley(options, c, whole), launch(options, c), jam(options, c), access(options, c), blastDeed(options, c), support(options, c), handOff(options, c), strike(options, c)]) {
    if (deed && (!best || deed.value > best.value + EXACT)) best = deed;
  }
  return best;
}

// THE TACTIC THAT IS A COMMAND COORDINATION (the Discard faces of four GoF
// weapons: "Give 1 Command Token to 1 Ally Drone"): an Action like another,
// worth what the Drone it commands gains by acting now.
//
// Each gain is the planning of a Drone's whole turn, so it is worked out
// before the deeds are weighed, a Drone at a time (`plansSteps`), and read
// here: a deed is weighed in one go, and three Drones planned inside it held
// the thread a fifth of a second.
const handKey = (c: Ctx, o: Option): string => `${c.me.uid}:${o.id}`;

//
// AN EXTRA ACTION OPPORTUNITY HANDED TO AN ALLY MECH (Coordinate) is weighed the
// same way: what the Mech would do with a turn of its own now over doing
// nothing with it (it still takes its own turn later), less the Link the card
// takes from it, at the price of Link.
const handed = (o: Option, c: Ctx): boolean => (kindOf(o) === 'coordinate' && o.tags.includes('action') && c.skills.coordinate) || (kindOf(o) === 'grant' && c.skills.grant);

function handOff(options: Option[], c: Ctx): Deed | null {
  let best: Deed | null = null;
  for (const o of options) {
    if (!handed(o, c)) continue;
    const gain = c.handed.get(handKey(c, o));
    if (gain === undefined || gain === null) continue;
    const grant = kindOf(o) === 'grant';
    const value = gain - (grant ? c.w.link * (typeof o.facts?.linkCost === 'number' ? o.facts.linkCost : 0) : 0);
    if (value > EXACT && (!best || value > best.value + EXACT)) {
      best = { option: o, value, why: `${o.label}: it gains ${gain.toFixed(2)} by acting now`, reason: grant ? 'grant_by_value' : 'coordinate_by_value' };
    }
  }
  return best;
}

// A BLINK SETS THE OTHER MECH'S FACING TOO (FAQ E17): an enemy is turned with
// its back to where this Mech will stand, an ally to face the enemy nearest
// where it will stand. Of two answers alike in all else, that one; a tie-break
// and no more.
function turned(o: Option, c: Ctx): number {
  if (kindOf(o) !== 'blink') return 0;
  const other = unitOf(c.view, o.facts?.targetUid);
  const at = endOf(o);
  if (!other || !at || typeof o.facts?.targetFacing !== 'number') return 0;
  // The other Mech stands where this one stood.
  const from = c.me.grid;
  let want: number | null = null;
  if (other.side === c.view.seat) {
    const near = c.foes.length ? c.foes.reduce((a, b) => (apart(from, b.grid) < apart(from, a.grid) ? b : a)) : null;
    want = near ? facingAt(from, near.grid) : null;
  } else if (!same(from, at)) {
    want = (facingAt(from, at) + 2) % 4;
  }
  return want !== null && o.facts.targetFacing === want ? 1e-7 : 0;
}

// THE KK9's OVERWATCH STRIKE: the best Firing Action the Mech it calls on
// could then make at the enemy it designates (the question that Mech's seat
// would be asked once the call is made, with the odds on its attacks), less
// what the KK9 is worth to its squad, since it leaves the board: priced as an
// enemy would price destroying it outright.
const GONE: Forecast = { hit: 1, pen: 1, damage: 1, destroy: 1, kill: 1, link: 0, parts: [], pick: null };

function strike(options: Option[], c: Ctx): Deed | null {
  if (!c.skills.overwatch) return null;
  let best: Deed | null = null;
  const cost = gainOf(GONE, c.me, c.view, c.w);
  for (const o of options) {
    if (kindOf(o) !== 'overwatch') continue;
    const shots = (o.then?.(['reaction'])?.options ?? []).filter((x) => isShot(x));
    const shot = shots.reduce((a: number, x) => Math.max(a, shotValue(x, c).value), 0);
    const value = shot - cost;
    if (shot > 0 && value > EXACT && (!best || value > best.value + EXACT)) best = { option: o, value, why: `${o.label} (worth ${shot.toFixed(2)}, the Drone ${cost.toFixed(2)})`, reason: 'overwatch_value' };
  }
  return best;
}

// One Part put back a step, as the odds of the attack that would undo it: a
// Part Damaged for certain and nothing else.
const A_PART_DAMAGED: Forecast = { hit: 1, pen: 1, damage: 1, destroy: 0, kill: 0, link: 0, parts: [], pick: null };

// AN ACTION THAT GIVES BACK WHAT WAS LOST, priced off the list that prices
// losing it. A Part mended is what Damaging that Part is worth to whoever does
// it (`gainOf`: half a Part of that unit); a Repaired Token on a destroyed Part
// is priced the same, a Part given back and half way to gone. Link is what
// stripping it is worth (`link`), a Link at a time. A Token cleaned off an
// ally is worth the Firing a jammed unit loses to Fire Control Interference,
// as jamming an enemy is priced (`jam`), and a token's worth otherwise
// (`restore`), as Ammo is. Stance feedback has no price: what Stance an ally
// should stand in is that ally's plan, which nobody here has made.
function support(options: Option[], c: Ctx): Deed | null {
  if (!c.skills.support) return null;
  let best: Deed | null = null;
  for (const o of options) {
    if (kindOf(o) !== 'support') continue;
    const who = unitOf(c.view, o.facts?.targetUid);
    let value = 0;
    if (o.tags.includes('link')) value = c.w.link * (typeof o.facts?.links === 'number' ? o.facts.links : 0);
    else if (o.tags.includes('repair')) value = who ? gainOf(A_PART_DAMAGED, who, c.view, c.w) : 0;
    else if (o.tags.includes('cleanup')) value = who && o.facts?.statusId === 'fci' ? c.w.jam * ownFire(who, c) : c.w.restore;
    else if (o.tags.includes('resupply')) value = c.w.restore;
    if (value > EXACT && (!best || value > best.value + EXACT)) best = { option: o, value, why: o.label, reason: 'support_value' };
  }
  return best;
}

// The kinds of answer a deed is made of: what is asked for when looking ahead.
const DEEDS = ['attack', 'launch', 'electronic', 'terminal', 'support'];
// The answer that takes a Mech into Offensive Stance for nothing, before its
// Opportunity has moved or acted (owed.ts: the Action that switches a Stance is
// another answer, and costs its Action).
const OFFENSIVE = 'stance:offensive';

// ---------- what the other squad could do to it ----------

// Whether an enemy unit is worth asking about a Grid at all: by its Range,
// the step it could take first, and some slack for what a card adds.
function inReachOf(e: UnitView, at: Grid): boolean {
  const step = e.kind === 'mech' ? e.maneuver : 0;
  if (chebyshev(e.grid, at) <= 1 + step) return true;
  const far = Math.max(0, ...e.weapons.filter((x) => ready(x) && (x.type === 'Firing' || e.kind === 'projectile')).map((x) => x.range));
  return far > 0 && apart(e.grid, at) <= far + step + LIMITS.SLACK;
}

// The Timings an enemy Mech is asked on. A dial this seat can see, with the
// turn still to come, is the one. Otherwise its next dial is not known, and
// it is asked on what it would most likely want: Firing if it has a gun, and
// Melee if it is close enough to use one.
function timingsOf(e: UnitView, view: SeatView, at: Grid): (string | undefined)[] {
  if (e.kind !== 'mech') return [undefined];
  if (view.phaseName === 'Action' && !e.done && e.timing) return [e.timing];
  return likelyTimings(e, at);
}

// The Timings an enemy Mech would most likely want, its dial not known.
function likelyTimings(e: UnitView, at: Grid): string[] {
  const out: string[] = [];
  if (strikers(e).some((x) => x.type === 'Firing')) out.push('firing');
  if (chebyshev(e.grid, at) <= 1 + e.maneuver) out.push('melee');
  return out.length ? out : ['firing'];
}

const shotsOn = (turn: Decision | null | undefined, uid: number): Option[] =>
  (turn?.options ?? []).filter((o) => isShot(o) && o.facts?.targetUid === uid);

// What a set of attacks on this unit is worth to the enemy making them: the
// worst of them, and the worst that could follow it in the same activation;
// and the chance that between them they destroy it.
interface Barrage { value: number; kill: number; hits: Forecast[] }
const NO_BARRAGE: Barrage = { value: 0, kill: 0, hits: [] };

function barrage(shots: Option[], c: Ctx, more: boolean): Barrage {
  let worst: { o: Option; value: number; f: Forecast | null } | null = null;
  for (const o of shots) {
    const f = o.chance?.() ?? null;
    // What it carries is lost to a Penetration, whatever else the hit does.
    const value = f ? gainOf(f, c.me, c.view, c.w) + (c.skills.mission ? f.pen * carried(c.me, c.view, c.w) : 0) : UNKNOWN_SHOT;
    if (!worst || value > worst.value) worst = { o, value, f };
  }
  if (!worst) return NO_BARRAGE;
  const next = more && worst.o.then ? barrage(shotsOn(worst.o.then([`strike:${c.me.uid}`]), c.me.uid), c, false) : NO_BARRAGE;
  return {
    value: worst.value + next.value,
    kill: 1 - (1 - (worst.f?.kill ?? 0)) * (1 - next.kill),
    hits: [...(worst.f ? [worst.f] : []), ...next.hits],
  };
}

// THE CHANCE A UNIT OF ONE PART IS DESTROYED BY A RUN OF ATTACKS. Such a unit
// goes from Intact to Damaged to Destroyed, and each forecast was made of it
// as it stands: of an Intact Drone with Structure left, every attack says
// "Damaged, never destroyed", and two of them destroy it. So the run is
// followed a step at a time: an attack that finds it Damaged destroys it as
// often as it Penetrates.
function lostTo(me: UnitView, hits: Forecast[]): number {
  let intact = me.parts[0]?.state === 'intact' ? 1 : 0;
  let damaged = 1 - intact;
  let dead = 0;
  for (const f of hits) {
    const through = Math.max(f.pen, f.kill);
    dead += intact * f.kill + damaged * through;
    damaged = damaged * (1 - through) + intact * f.damage;
    intact *= Math.max(0, 1 - f.kill - f.damage);
  }
  return Math.min(1, dead);
}

// THE CHANCE A MECH IS DESTROYED BY A RUN OF ATTACKS (`compound`): its Torso,
// followed a step at a time as `lostTo` follows a unit of one Part. Each
// forecast reads the Mech as it stands, so a hit on an Intact Torso that
// Penetrates there (`vitalPen`) and does not destroy it leaves it Damaged, and
// a later Penetration there destroys it. An attacker that may designate the
// Part it hits (`pick`) designates the Damaged Torso: its Penetration, where
// it picks, finishes the Mech.
function torsoLost(me: UnitView, hits: Forecast[]): number {
  const torso = me.parts.find((x) => x.slot === 'torso');
  if (!torso || torso.state === 'destroyed') return 1;
  let intact = torso.state === 'intact' ? 1 : 0;
  let damaged = 1 - intact;
  let dead = 0;
  for (const f of hits) {
    const there = Math.max(vitalPen(f, me), f.kill);
    const finish = f.pick !== null ? Math.max(f.pen, there) : there;
    dead += intact * f.kill + damaged * finish;
    damaged = damaged * (1 - finish) + intact * Math.max(0, there - f.kill);
    intact *= Math.max(0, 1 - there);
  }
  return Math.min(1, dead);
}

// WHAT AN ENEMY WOULD RATHER SHOOT (`decoy`): of this squad's units it has in
// its sights as the board stands, what a Firing attack on each is worth to it.
// Asked once an enemy a table (Memo).
function aimsOf(e: UnitView, c: Ctx): Map<number, number> {
  const known = c.aims.get(e.uid);
  if (known) return known;
  const aims = new Map<number, number>();
  const turn = (c.aimsOn ?? c.d.here?.())?.turnOf(e.uid, ['attack'], e.kind === 'mech' ? 'firing' : undefined);
  for (const o of turn?.options ?? []) {
    const target = isShot(o) ? unitOf(c.view, o.facts?.targetUid) : undefined;
    const f = target && target.side === c.view.seat ? o.chance?.() : null;
    if (f && target) aims.set(target.uid, Math.max(aims.get(target.uid) ?? 0, gainOf(f, target, c.view, c.w)));
  }
  c.aims.set(e.uid, aims);
  return aims;
}

// An attack that may not be made: the odds of it, each at `p`.
const atChance = (f: Forecast, p: number): Forecast => ({ ...f, hit: f.hit * p, pen: f.pen * p, damage: f.damage * p, destroy: f.destroy * p, kill: f.kill * p, link: f.link * p, parts: f.parts.map((x) => ({ ...x, pen: x.pen * p })) });

// WHAT STANDING SOMEWHERE WOULD COST: for each enemy unit that could bring an
// attack to bear, what its attacks on this unit would be worth to it, from
// where it stands or after the step that brings one to bear. An enemy whose
// turn is still to come this round counts for more than one whose turn is a
// round away. `out` is the table to judge: the one a plan would leave. Past
// `budget` the plan has lost whatever the rest would say, and the asking
// stops there: the answer is then `partial`, and good for nothing else.
function exposure(out: Outlook | null | undefined, at: Grid, c: Ctx, budget = Infinity): Harm {
  if (!out) return UNHARMED;
  let cost = 0;
  let survives = 1;
  // Every attack that could land before the round is out, in the order made.
  const hits: Forecast[] = [];
  const single = c.me.parts.length === 1;
  // A Mech's Torso goes from Intact to Damaged to Destroyed as a unit of one
  // Part does (`compound`): a run of hits that each only Damages it, as each
  // forecast reads the Mech as it stands, destroys it between them.
  const lost = (): number => (single ? lostTo(c.me, hits) : c.w.compound > 0 ? Math.max(1 - survives, torsoLost(c.me, hits)) : 1 - survives);
  const by: NonNullable<Harm['by']> = [];
  // The enemies that could attack it there this round.
  const struck = new Set<number>();
  // Those whose turn is still to come first, and of them the nearest: the
  // ones most likely to settle it.
  const order = c.hostile.filter((e) => inReachOf(e, at)).sort((a, b) => Number(a.done) - Number(b.done) || apart(a.grid, at) - apart(b.grid, at));
  // What an enemy could do to the unit on each of some Timings: the worst.
  const read = (e: UnitView, timings: (string | undefined)[]): { worst: Barrage; on: string } => {
    let worst: Barrage = NO_BARRAGE;
    let on = '';
    for (const timing of timings) {
      // Its attacks on this unit and no other: the line to every other unit of
      // the squad is not this plan's to pay for.
      let shots = shotsOn(out.turnOf(e.uid, [`strike:${c.me.uid}`], timing), c.me.uid);
      if (!shots.length && e.kind === 'mech' && e.maneuver > 0) {
        for (const step of out.turnOf(e.uid, [`reach:${c.me.uid}`], timing)?.options ?? []) {
          shots = shotsOn(step.then?.([`strike:${c.me.uid}`]), c.me.uid);
          if (shots.length) break;
        }
      }
      const all = barrage(shots, c, true);
      if (all.value > worst.value) { worst = all; on = timing ?? ''; }
    }
    return { worst, on };
  };
  for (const e of order) {
    if (cost > budget) return { cost, risk: lost(), partial: true };
    let { worst, on } = read(e, timingsOf(e, c.view, at));
    // AN ENEMY WHOSE TURN THIS ROUND CANNOT TOUCH THE UNIT (its dial shown, on
    // a Timing with no attack on it: a Movement) is no danger this round, and
    // was no danger at all; its turn a round on is read as an enemy's whose
    // turn is behind it (`later`, M12: a Missile Artillery stood at "cost
    // 0.00" in reach of a VIP's rifle that had dialled Movement, and was shot
    // the round after).
    let after = e.done;
    if (!worst.value && !e.done && e.kind === 'mech' && e.timing && c.w.later > 0) {
      ({ worst, on } = read(e, likelyTimings(e, at)));
      after = true;
    }
    // AN ENEMY WITH A BETTER TARGET shoots this unit only as often as it is
    // worth shooting against the best other unit of this squad in its sights
    // (`decoy`): a Raven behind a wall is not what a Mech walks round it for
    // while the Wild Cat stands in the open (OTTO's playtest, 2026-10-03).
    let p = 1;
    if (c.w.decoy > 0 && worst.value > 0) {
      let rival = 0;
      for (const [uid, v] of aimsOf(e, c)) if (uid !== c.me.uid) rival = Math.max(rival, v);
      if (rival > worst.value) p = (worst.value / rival) ** c.w.decoy;
    }
    const share = p * (after ? c.w.exposureLater * (e.done ? 1 : c.w.later) : c.w.exposure) * worst.value;
    cost += share;
    if (!after) {
      survives *= 1 - p * worst.kill;
      hits.push(...(p < 1 ? worst.hits.map((f) => atChance(f, p)) : worst.hits));
    }
    if (share > 0 && e.kind === 'mech' && !after) by.push({ uid: e.uid, cost: share, timing: on });
    if (worst.value > 0) struck.add(e.uid);
  }
  // AN ENEMY'S PROJECTILE NOT YET LAUNCHED (`salvo`, M12). A Missile is no
  // attack as it is launched: it lands, and attacks in the Delay Phase, so the
  // enemy's turn above never counts it. For each enemy Mech with a Projectile
  // to launch whose turn is still to come this round on a Timing that may
  // launch it, what the Projectile could do to the unit from the Landing Point
  // nearest it (`salvoOn`), at `launch`'s discount: the unit may move before it
  // strikes, and it may be Intercepted.
  if (c.w.salvo > 0) {
    for (const e of c.hostile) {
      if (e.done || e.kind !== 'mech' || (e.timing && e.timing !== 'projectile') || !e.weapons.some((x) => ready(x) && x.type === 'Projectile')) continue;
      if (cost > budget) return { cost, risk: lost(), partial: true };
      const v = salvoOn(e, out, at, c);
      if (v.value <= 0) continue;
      cost += c.w.salvo * c.w.exposure * c.w.launch * v.value;
      hits.push(...v.hits.map((f) => atChance(f, Math.min(1, c.w.salvo * c.w.launch))));
    }
  }
  // THE ROUND AFTER. An enemy Mech that cannot attack the unit there this
  // round may walk up this round and attack it next round before it has moved
  // again: the Mech two Sprints off is one Sprint off when the next round
  // begins. For the unit whose loss is the game (a Commander on a VIP
  // mission), each such Mech is asked where its Movement could take it, and
  // from the nearest of those Grids what it could do to the unit a round on.
  // AND WHAT THE UNIT WOULD DO TO IT THERE: the round after is an exchange. A
  // Commander that outguns the one Mech coming at it has nothing to hide
  // from, and one with two Mechs coming answers one of them. So what counts
  // is all they could do, less the best it could do to one of them.
  if (c.w.ahead > 0 && c.me.commander && c.view.task?.family === 'vip') {
    let theirs = 0;
    let mine = 0;
    for (const e of c.hostile) {
      const owing = cost + c.w.ahead * Math.max(0, theirs - c.w.riposte * mine);
      if (owing > budget) return { cost: c.skills.bounded ? owing : cost, risk: lost(), partial: true };
      if (e.kind !== 'mech' || e.done || struck.has(e.uid)) continue;
      const round = closing(e, out, at, c);
      theirs += round.theirs;
      mine = Math.max(mine, round.mine);
    }
    cost += c.w.ahead * Math.max(0, theirs - c.w.riposte * mine);
  }
  // What the run of hits destroys between them that no one of them would: the
  // Mech, at what it is worth (`compound`).
  if (!single && c.w.compound > 0) cost += c.w.compound * Math.max(0, torsoLost(c.me, hits) - (1 - survives)) * unitWorth(c.me, c.view, c.w);
  return { cost, risk: lost(), by };
}

// WHAT AN ENEMY'S PROJECTILE COULD DO TO THE UNIT (`salvo`): of the enemy's
// launches on its Projectile Timing, for each card the Landing Point nearest
// the unit inside that card's strike, and what the Projectile could do to the
// unit from there when its own turn comes (`later`): the worst of them.
function salvoOn(e: UnitView, out: Outlook, at: Grid, c: Ctx): Barrage {
  const turn = out.turnOf(e.uid, ['launch'], 'projectile');
  const nearest = new Map<string, { o: Option; gap: number }>();
  for (const o of turn?.options ?? []) {
    const land = kindOf(o) === 'launch' && o.later ? endOf(o) : null;
    const strike = typeof o.facts?.strike === 'number' ? o.facts.strike : 0;
    if (!land) continue;
    const gap = apart(land, at);
    if (gap > strike) continue;
    const card = String(o.facts?.cardId ?? '');
    if (gap < (nearest.get(card)?.gap ?? Infinity)) nearest.set(card, { o, gap });
  }
  let worst: Barrage = NO_BARRAGE;
  for (const { o } of nearest.values()) {
    const b = barrage(shotsOn(o.later?.(['attack']), c.me.uid), c, false);
    if (b.value > worst.value) worst = b;
  }
  return worst;
}

// What an enemy Mech could do to the unit a round on, having walked toward it
// this round: of the Grids its Movement could end in, the few nearest the
// unit, and from each its attacks on the unit when its next turn comes (the
// engine's `later`, on the table that walk leaves: sight, Range and arc all
// counted, and the Tokens a round older).
function closing(e: UnitView, out: Outlook, at: Grid, c: Ctx): { theirs: number; mine: number } {
  const ends = new Map<string, { m: Option; gap: number }>();
  for (const m of out.turnOf(e.uid, ['move'], 'movement')?.options ?? []) {
    const end = kindOf(m) === 'move' ? endOf(m) : null;
    if (!end || !m.later || (!c.skills.crush && m.tags.includes('crush-unit'))) continue;
    const gap = apart(end, at);
    const held = ends.get(key(end));
    // One answer a Grid: the facing that looks at the unit.
    if (!held || (facingOf(m) === facingAt(end, at) && facingOf(held.m) !== facingAt(end, at))) ends.set(key(end), { m, gap });
  }
  // Of those Grids, the ones inside its arm of the unit that would SEE it (the
  // board's own sight, asked once for them all): the nearest few are asked.
  const arm = armOf(e);
  const inArm = [...ends.values()].filter((x) => x.gap <= arm).sort((a, b) => a.gap - b.gap);
  const none = { theirs: 0, mine: 0 };
  if (!inArm.length) return none;
  const sees = new Set(out.seen(c.me.uid, [at], inArm.map((x) => endOf(x.m) as Grid))[0] ?? []);
  let worst = none;
  for (const { m } of inArm.filter((_, i) => sees.has(i)).slice(0, LIMITS.CLOSING)) {
    const theirs = barrage(shotsOn(m.later?.([`strike:${c.me.uid}`], 'firing'), c.me.uid), c, true).value;
    if (theirs <= worst.theirs) continue;
    // And from where the unit stands, what it could do to the Mech standing
    // there, when its own next turn comes: the best attack on any Timing its
    // weapons are played on.
    let mine = 0;
    const there = m.after?.();
    // In Offensive Stance too, which it may take as that turn begins (`restance`).
    const restance = c.skills.restance && c.me.kind === 'mech';
    for (const timing of new Set(strikers(c.me).map((x) => x.timing))) {
      const turn = there?.turnOf(c.me.uid, restance ? [`strike:${e.uid}`, 'stance'] : [`strike:${e.uid}`], timing);
      for (const o of shotsOn(turn, e.uid)) mine = Math.max(mine, shotValue(o, c).value);
      const up = restance ? turn?.options.find((x) => x.id === OFFENSIVE) : undefined;
      for (const o of shotsOn(up?.then?.([`strike:${e.uid}`]), e.uid)) mine = Math.max(mine, shotValue(o, c).value);
    }
    worst = { theirs, mine };
  }
  return worst;
}

// ---------- which way to walk ----------

// How far its longest arm reaches: the Range it wants to be at.
function armOf(me: UnitView): number {
  const arms = me.weapons.filter(ready).map((x) => {
    if (x.type === 'Firing') return x.range;
    if (x.type === 'Melee') return Math.max(1, x.range);
    if (x.type === 'Projectile') return x.range + (x.strike ?? 0);
    if (x.type === 'Tactic' && x.range > 0) return x.range;
    return 0;
  });
  return Math.max(0, ...arms);
}

// How near a unit must stand to strike a carrier itself (`hunt`): its longest
// gun's Range, or beside it with only a blade. A launcher's reach counts only
// for a unit with nothing else: a Projectile lands a turn late, on a dial of its
// own, and may be Intercepted (a traced game: an RDL Missile Brawler reckoned
// its Missiles reached a UN carrier from its corner, and never launched one
// past the Porcupine's guard).
function huntArm(me: UnitView): number {
  const direct = Math.max(0, ...me.weapons.filter(ready).map((x) => (x.type === 'Firing' ? x.range : x.type === 'Melee' ? Math.max(1, x.range) : 0)));
  return direct > 0 ? direct : armOf(me);
}

// THE ENEMY WORTH WALKING TO: the one whose destruction is worth most for the
// walk it takes to bring this unit's arm to bear on it (what it cost, what it
// would go on to do, and on a VIP mission its Commander's price), with the
// road to it where the seam gave one. Null for a unit with nothing to attack
// with, and with nobody to walk to.
interface Quarry { foe: UnitView; road: Road | null; prize: number }

function quarryOf(c: Ctx): Quarry | null {
  const arm = armOf(c.me);
  if (arm <= 0) return null;
  const roads = c.d.facts.roads as Record<string, Road> | undefined;
  let best: (Quarry & { score: number }) | null = null;
  for (const foe of c.foes) {
    const road = roads?.[String(foe.uid)] ?? null;
    // With the roads known, an enemy that has none cannot be walked to.
    if (roads && !road) continue;
    const steps = road ? road.length + 1 : apart(c.me.grid, foe.grid);
    // With no weight on the prize, the enemy walked to is the nearest.
    const prize = c.w.approach > 0 ? unitWorth(foe, c.view, c.w) + threatOf(foe, c) : 0;
    const score = c.w.approach > 0 ? prize / (4 + Math.max(0, steps - arm)) : -steps;
    if (!best || score > best.score + EXACT) best = { foe, road, prize, score };
  }
  return best;
}

const cellOf = (ref: string): Grid => { const [col, row] = ref.split(',').map(Number); return { col, row }; };

// HOW LONG A WALK TO A ZONE IS, for a unit of the squad, from a Grid: the
// engine's count (Outlook.walk: the road round the walls, a Movement ending in
// the Container it crushes into), asked once for a table. `left` is what a
// plan leaves unspent of the activation under way. With no board to ask, it
// is the crow's flight at the unit's stride.
function walkOf(c: Ctx, u: UnitView, at: Grid, t: Target, left?: number[]): Stroll | null {
  const spot = `${u.uid}|${t.zone.id}|${key(at)}|${left ? left.join('+') : ''}`;
  const known = c.walks.get(spot);
  if (known !== undefined) return known;
  let walk: Stroll | null;
  const out = c.d.here?.();
  if (out) {
    walk = out.walk(u.uid, [at], t.cells, left, t.via)[0] ?? null;
  } else {
    const via = t.via;
    const grids = via ? apart(at, via) + Math.min(...t.cells.map((cell) => apart(via, cell))) : Math.min(...t.cells.map((cell) => apart(at, cell)));
    const spent = left ? left.reduce((n, x) => n + x, 0) : 0;
    walk = { grids, turns: Math.ceil(Math.max(0, grids - spent) / Math.max(1, stride(u))) };
  }
  c.walks.set(spot, walk);
  return walk;
}

// THE RACE FOR EACH LOOSE BOX (M11): the round each squad's soonest unit with
// a hand free could take it, as the engine walks it, and the enemy unit that
// would. A unit whose turn this round is still to come takes it this round if
// one activation brings it there, one that has had its turn a round later;
// one standing on it still wants its Opportunity to end there. The unit this
// question is about counts from its next activation: what it does with this
// one is its plans' to say. Worked out once a table, and only where one of the
// Box weights is on.
function racesOf(c: Ctx): Map<string, Race> {
  if (c.races.map) return c.races.map;
  const races = new Map<string, Race>();
  c.races.map = races;
  const { view, w } = c;
  if (view.task?.family !== 'blackbox' || (w.boxRace >= 1 && w.boxSteal <= 0 && w.deny <= 0)) return races;
  const takers = view.units.filter((u) => u.alive && u.deployed && u.hands > 0 && !u.lowValue && u.kind !== 'projectile');
  for (const b of view.boxes) {
    if (!b.grid || b.bearer !== null) continue;
    const box: Target = { zone: { id: `box:${b.id}:take`, name: 'Black Box', holder: null, control: null, scoring: true, cells: [key(b.grid)] }, cells: [b.grid], swing: 1, share: 1, held: false };
    const race: Race = { ours: Infinity, theirs: Infinity, by: null };
    for (const u of takers) {
      const walk = walkOf(c, u, u.grid, box);
      if (!walk) continue;
      const when = view.round + Math.max(1, walk.turns) - (u.done || u.uid === c.me.uid ? 0 : 1);
      if (when > view.roundLimit) continue;
      if (u.side === view.seat) race.ours = Math.min(race.ours, when);
      else if (when < race.theirs) { race.theirs = when; race.by = u.uid; }
    }
    races.set(b.id, race);
  }
  return races;
}

// THE ZONES WORTH WALKING TO, and whose each is. Every zone the Main Task
// scores that is not the squad's already. With a weight on sharing them out
// (`zoneShare` under 1), each goes to the unit of the squad that would be
// standing in it soonest, a unit taking one zone, the walks handed out
// shortest first: a zone that went to somebody else is worth that share to
// this unit, and one that went to nobody (more zones than units) is anybody's.
// MEASURED AND SET ASIDE: shared out, UN on the alley wins 88 in 100; with
// every zone at its full worth to every unit, 98. The unit a zone "belongs"
// to is often busy or dead, and a dial once set pays on without it.
// `took` names the Black Boxes a plan picks up on its way: what there is to
// walk to is then worked out for the unit with those in hand.
const NONE: readonly string[] = [];
const tookBy = (o: Option | null | undefined): readonly string[] => (Array.isArray(o?.facts?.taken) ? (o?.facts?.taken as string[]) : NONE);

// A UNIT OF THE OTHER SQUAD'S, HUNTED (`hunt`): the Grids an arm this long
// reaches it from (its Range in straight lines, and every Grid beside it), as a
// zone to walk to worth `swing` of the Main Task's Victory Points.
function hunted(foe: UnitView, arm: number, swing: number): Target {
  const cells: Grid[] = [];
  for (let dc = -arm; dc <= arm; dc++) {
    for (let dr = -arm; dr <= arm; dr++) {
      const g = { col: foe.grid.col + dc, row: foe.grid.row + dr };
      if (g.col < 0 || g.row < 0 || (!dc && !dr)) continue;
      if (Math.abs(dc) + Math.abs(dr) <= arm || (Math.abs(dc) <= 1 && Math.abs(dr) <= 1)) cells.push(g);
    }
  }
  return { zone: { id: `hunt:${foe.uid}`, name: foe.label, holder: null, control: null, scoring: true, cells: cells.map(key) }, cells, swing, share: 1, held: false };
}

function targetsOf(c: Ctx, took: readonly string[] = NONE): Target[] {
  const spot = took.length ? `${c.me.uid}|${took.join(',')}` : String(c.me.uid);
  const known = c.targets.get(spot);
  if (known) return known;
  const { view, me } = c;
  // A BLACK BOX TASK is walked for differently. Where the card pays for a Box
  // wherever it is held, the walk is to each Box lying loose, by a unit with a
  // hand free for it. Where it pays only in one zone, a Box lying loose is
  // worth walking to only if it can still be carried there: the walk is to the
  // zone BY WAY OF the Box, one walk as the engine counts it, for the share
  // `carry` of a Box already in hand; and a unit carrying Boxes walks to that
  // zone for the whole of them.
  if (view.task?.family === 'blackbox') {
    const name = view.task.scoringZone;
    const zone = name ? view.zones.find((z) => z.name === name || z.id === name) : undefined;
    const mine = view.boxes.filter((b) => b.bearer === me.uid).length + took.length;
    const found: Target[] = [];
    if (me.hands - took.length > 0) {
      for (const b of view.boxes) {
        if (!b.grid || took.includes(b.id)) continue;
        const lying = { id: `box:${b.id}`, name: 'Black Box', holder: null, control: null, scoring: true };
        // By way of a second Box the ones in hand come home too (`boxMore`).
        if (zone) found.push({ zone: { ...lying, cells: zone.cells }, cells: zone.cells.map(cellOf), via: b.grid, swing: c.w.carry + c.w.boxMore * mine, share: 1, held: false });
        else found.push({ zone: { ...lying, cells: [key(b.grid)] }, cells: [b.grid], swing: 1, share: 1, held: false });
      }
      // A Box is one unit's to fetch: of the squad's units with a hand free,
      // the one that would have it soonest, the walks handed out shortest
      // first and a unit taking one Box. To the rest it is worth `boxShare`.
      if (c.w.boxShare < 1 && found.length) {
        const hands = view.units.filter((u) => u.side === view.seat && u.alive && u.deployed && u.hands > 0);
        const walks: { u: UnitView; t: Target; grids: number; turns: number }[] = [];
        for (const u of hands) {
          for (const t of found) {
            const walk = walkOf(c, u, u.grid, t);
            if (walk) walks.push({ u, t, ...walk });
          }
        }
        walks.sort((a, b) => a.turns - b.turns || a.grids - b.grids || a.u.uid - b.u.uid);
        const goes = new Map<Target, number>();
        const busy = new Set<number>();
        for (const x of walks) {
          if (busy.has(x.u.uid) || goes.has(x.t)) continue;
          busy.add(x.u.uid);
          goes.set(x.t, x.u.uid);
        }
        for (const t of found) {
          const whose = goes.get(t);
          t.share = whose === undefined || whose === me.uid ? 1 : c.w.boxShare;
        }
      }
    }
    if (mine && zone) found.push({ zone, cells: zone.cells.map(cellOf), swing: mine, share: 1, held: false });
    // A CARRIER OF THE OTHER SQUAD'S (`hunt`, M11): Penetrated, it drops what
    // it carries (`carried`, priced on the attack), so a unit of this squad
    // with an arm and no Box of its own walks to where its arm reaches the
    // carrier, for `hunt` of the Boxes it carries, as it walks to a zone. At 0
    // a Box is walked for only while it lies loose (a traced game, 2026-10-04:
    // an RDL Missile Brawler sat in its corner all game at "worth 0.00" while a
    // UN Mech walked off with three Boxes).
    const arm = c.w.hunt > 0 && !mine ? huntArm(me) : 0;
    if (arm > 0) {
      for (const foe of view.units) {
        if (foe.side === view.seat || !foe.alive || !foe.deployed) continue;
        const held = view.boxes.filter((b) => b.bearer === foe.uid).length;
        if (held) found.push(hunted(foe, arm, c.w.hunt * held));
      }
    }
    c.targets.set(spot, found);
    return found;
  }
  // THE OTHER SQUAD'S COMMANDER ON A VIP MISSION (`hunt`): destroyed, it is the
  // Main Task's price (`vipKill`), so every unit of this squad with an arm but
  // its own Commander walks to where its arm reaches it, as to a carrier (a
  // traced game, 2026-10-04: an outranged RDL squad held its back line five
  // rounds at worths below nothing while UN's Precision shot it from twelve).
  if (view.task?.family === 'vip') {
    const lead = view.units.find((u) => u.side === view.other && u.commander && u.alive && u.deployed);
    const arm = c.w.hunt > 0 && lead && !me.commander ? huntArm(me) : 0;
    const found = arm > 0 && lead ? [hunted(lead, arm, c.w.hunt * c.w.vipKill)] : [];
    c.targets.set(spot, found);
    return found;
  }
  const all: Target[] = view.zones
    .filter((z) => z.scoring && z.cells.length > 0 && (z.holder ?? z.control) !== view.seat)
    .map((z) => ({
      zone: z,
      cells: z.cells.map(cellOf),
      swing: (z.holder ?? z.control) === view.other ? 2 : 1,
      share: 1,
      held: view.units.some((u) => u.side === view.other && holds(u) && z.cells.includes(key(u.grid))),
    }));
  if (c.w.zoneShare >= 1) {
    c.targets.set(spot, all);
    return all;
  }
  const walkers = view.units.filter((u) => u.side === view.seat && holds(u));
  const walks: { u: UnitView; t: Target; grids: number; turns: number }[] = [];
  for (const u of walkers) {
    for (const t of all) {
      const walk = walkOf(c, u, u.grid, t);
      if (walk) walks.push({ u, t, ...walk });
    }
  }
  walks.sort((a, b) => a.turns - b.turns || a.grids - b.grids || a.u.uid - b.u.uid);
  const goes = new Map<Target, number>();
  const busy = new Set<number>();
  for (const x of walks) {
    if (busy.has(x.u.uid) || goes.has(x.t)) continue;
    busy.add(x.u.uid);
    goes.set(x.t, x.u.uid);
  }
  for (const t of all) {
    const whose = goes.get(t);
    t.share = whose === undefined || whose === me.uid ? 1 : c.w.zoneShare;
  }
  c.targets.set(spot, all);
  return all;
}

// A Main Task there is somewhere to walk to for: its zones, or its Boxes.
// (On a VIP mission there is only the hunt, `targetsOf`: nothing at `hunt` 0.)
const walked = (view: SeatView): boolean => zoned(view) || view.task?.family === 'blackbox' || view.task?.family === 'vip';

// THE WALK TO A ZONE. A unit that can hold a zone, standing outside every zone
// worth taking: what the best of them will have paid by the end of the game
// if the unit walks there from this Grid, counted from the round it would
// first be standing in it. The engine says how many activations the walk is.
// A zone it could not reach before the last round ends is worth nothing to
// walk to. Standing IN such a zone is not this term's to price: the Main
// Task's own reading of the table does that. `took` is the Black Boxes the
// plan that ends in this Grid picks up on its way.
function zoneWalk(at: Grid, c: Ctx, left?: number[], took: readonly string[] = NONE): number {
  const task = c.view.task;
  if (!c.skills.mission || c.me.lowValue || !task || !walked(c.view)) return 0;
  let best = -Infinity;
  for (const t of targetsOf(c, took)) {
    const walk = walkOf(c, c.me, at, t, left);
    if (!walk || walk.grids === 0) continue;
    // What is left of this activation is spent before the count begins; a unit
    // whose own turn is still to come this round is an activation ahead.
    const away = walk.turns - (c.soon && !left ? 1 : 0);
    const arrives = c.view.round + away;
    // A Box pays the same whenever the walk for it is done, so a walk for one
    // is worth less for each activation it still takes (`walkTurn`).
    const sure = task.family === 'blackbox' ? c.w.walkTurn ** Math.max(0, away) : 1;
    // With the game on top (`stakesWalk`): what the walk would bring to the
    // margin is worth what it does to the game besides (M9.6).
    const brings = t.swing * task.vp * payFrom(arrives, c.view, c.w);
    const lever = c.w.stakes && c.w.stakesWalk && brings > 0 ? swingOf(c.view, c.w, c.margin, brings) / brings : 1;
    // A loose Box is a race the other squad may win (M11, `boxContest`).
    const contest = boxContest(t, at, c, away, left);
    // A carrier walked to (`hunt`) is a chase: it walks on, and each activation
    // the walk still takes is a chance less of catching it (`huntTurn`). A Box
    // pays the same whenever it is reached, and without this a Grid nearer the
    // carrier was worth no more than one further off.
    const chase = t.zone.id.startsWith('hunt:') ? c.w.huntTurn ** Math.max(0, away) : 1;
    const worth = t.swing * t.share * (t.held ? c.w.zoneHeld : 1) * task.vp * payFrom(arrives, c.view, c.w) * c.w.zonePull * sure * lever * contest * chase - c.w.zoneStep * walk.grids;
    if (worth > best) best = worth;
  }
  // With no zone left to walk to, the walk is worth nothing either way.
  return Number.isFinite(best) ? best : 0;
}

// A WALK FOR A LOOSE BOX AGAINST THE OTHER SQUAD'S (M11, `racesOf`): worth
// `boxRace` of itself where they would take it first, half way to that where
// the round is level, and `boxSteal` more where this unit would take it first
// and they would take it otherwise. When this unit would have it: the walk
// itself where the Box pays wherever it is held, else the walk to the Box on
// the way to the zone.
function boxContest(t: Target, at: Grid, c: Ctx, away: number, left?: number[]): number {
  if (!t.zone.id.startsWith('box:') || (c.w.boxRace >= 1 && c.w.boxSteal <= 0)) return 1;
  const id = t.zone.id.slice(4);
  const race = racesOf(c).get(id);
  if (!race || !Number.isFinite(race.theirs)) return 1;
  let mine = c.view.round + away;
  if (t.via) {
    const take: Target = { zone: { ...t.zone, id: `box:${id}:take`, cells: [key(t.via)] }, cells: [t.via], swing: 1, share: 1, held: false };
    const walk = walkOf(c, c.me, at, take, left);
    if (!walk) return 1;
    mine = c.view.round + walk.turns - (c.soon && !left ? 1 : 0);
  }
  if (race.theirs < mine) return c.w.boxRace;
  if (race.theirs === mine) return (1 + c.w.boxRace) / 2;
  return 1 + c.w.boxSteal;
}

// WHAT THE BOXES AN ENEMY UNIT WOULD TAKE FIRST ARE WORTH (M11, `racesOf`):
// each loose Box it would reach before this squad could, and half of one it
// would reach in the same round, no more of them than it has hands free (those
// it is surest of first), at what a Box pays as the game ends (where the card
// names a zone, the share `carry` of that: it has still to be carried there).
// A BOX TAKEN THAT THE OTHER SQUAD WOULD TAKE OTHERWISE (`boxSteal`, M11): a
// plan that picks it up has won the race outright, and is worth `boxSteal`
// more of it, as the walk for it is (`boxContest`). Without it a walk for a
// Box this unit would take first outweighed having the Box in hand, and a Mire
// two Grids from a Box stood beside it instead of picking it up (blackbox.test).
function stealOf(o: Option | null | undefined, c: Ctx): number {
  const task = c.view.task;
  if (!o || !task || task.family !== 'blackbox' || c.w.boxSteal <= 0) return 0;
  let n = 0;
  for (const id of tookBy(o)) {
    const race = racesOf(c).get(id);
    if (race && Number.isFinite(race.theirs)) n += 1;
  }
  return n * c.w.boxSteal * task.vp * payFrom(c.view.round, c.view, c.w) * (task.scoringZone ? c.w.carry : 1);
}

function takesFirst(u: UnitView, c: Ctx): number {
  const task = c.view.task;
  if (!task || task.family !== 'blackbox') return 0;
  let first = 0;
  let level = 0;
  for (const race of racesOf(c).values()) {
    if (race.by !== u.uid) continue;
    if (race.theirs < race.ours) first += 1;
    else if (race.theirs === race.ours) level += 1;
  }
  const n = Math.min(u.hands, first) + 0.5 * Math.max(0, Math.min(u.hands - first, level));
  return n * task.vp * payFrom(c.view.round, c.view, c.w) * (task.scoringZone ? c.w.carry : 1);
}

// SHAPING: pulls that say which way to walk when nothing a plan could do
// tells two Grids apart. Toward a zone worth taking (zoneWalk); and toward its
// own Range of the enemy worth walking to, along the road to it (the walk
// round a wall), no closer than its arm is long.
function shapeAt(at: Grid, c: Ctx, quarry: Quarry | null, left?: number[], took: readonly string[] = NONE): number {
  const walk = zoneWalk(at, c, left, took);
  let pull = walk;
  if (quarry) {
    let far: number;
    if (quarry.road) {
      const i = quarry.road.findIndex((g) => g.c === at.col && g.r === at.row);
      // A Grid off the road is no nearer than where it stands.
      far = i >= 0 && !same(at, c.me.grid) ? quarry.road.length - i : quarry.road.length + 1;
    } else {
      far = apart(at, quarry.foe.grid);
    }
    // OUTRANGED (`closeIn`): with nothing to walk to for the Main Task, a unit
    // an enemy shoots from beyond its own reach gains nothing by standing off,
    // and its step toward contact counts `closeIn` times over.
    const out = c.w.closeIn > 0 && walk <= EXACT && outranged(c) ? c.w.closeIn : 0;
    // BEHIND AS THE BOARD STANDS (`press`): nor does one of a squad that would
    // lose the game if it ended now (the more so the later the round, at
    // `pressLate`).
    const press = c.behind && walk <= EXACT ? c.w.press * (1 - c.w.pressLate * (1 - c.view.round / Math.max(1, c.view.roundLimit))) : 0;
    const step = c.w.contactStep * (out || press ? 1 + out + press : 1);
    pull -= (step + c.w.approach * quarry.prize) * Math.max(0, far - armOf(c.me));
  }
  return pull;
}

// Whether an enemy that could reach the unit where it stands has a gun that
// outreaches its own longest arm by more than a Grid (`closeIn`).
function outranged(c: Ctx): boolean {
  const arm = armOf(c.me);
  return c.hostile.some((e) => inReachOf(e, c.me.grid) && e.weapons.some((x) => ready(x) && x.type === 'Firing' && x.range > arm + 1));
}

// WHAT A MOVEMENT LEAVES UNSPENT of the activation under way, as Ranges. A
// Mech's Maneuver comes before any Action (3.4.5), so after the Maneuver the
// Movement Action on offer that goes furthest is still to make, and after a
// Movement Action nothing is: the Maneuver is behind it. A Sprint into a
// Container ends there; a Maneuver into it and then the Sprint goes four Grids
// further, and this is what lets a plan know it. Nothing for a unit whose
// activation is the one Movement.
function unspent(o: Option, c: Ctx): number[] | undefined {
  if (c.me.kind !== 'mech' || !o.tags.includes('maneuver')) return undefined;
  const offered = new Set(c.d.options.filter((x) => kindOf(x) === 'move').map((x) => x.facts?.actionId).filter((x): x is string => typeof x === 'string'));
  const far = Math.max(0, ...c.me.weapons.filter((x) => x.type === 'Moving' && offered.has(x.actionId)).map((x) => x.range || c.me.maneuver));
  return far > 0 ? [far] : undefined;
}

// ---------- the plans ----------

// WHERE IT ENDS AND WHAT IT DOES THERE.
interface Plan {
  // The answer that begins it; null for staying where it is.
  option: Option | null;
  // A plan of two Movements: the second, which ends it. It is `option` that
  // is answered now; the second is offered again once the first is made.
  via?: Option;
  how: string;
  at: Grid;
  deed: Deed | null;
  // Its terms: now, a turn later, the Main Task, the walk; and what standing
  // there would cost, once that has been asked.
  now: number;
  next: number;
  mission: number;
  shape: number;
  cost: number;
  risk: number;
  // What standing there would cost has been asked.
  priced?: boolean;
}

// The most a plan could be worth: every term, with nothing taken off for what
// standing there would cost.
const sumOf = (p: Plan): number => p.now + p.next + p.mission + p.shape;
// What it is worth: what it does now is done; what it would do a turn later,
// and the zone it would take, come only if it is still there when the round
// ends.
const worthOf = (p: Plan): number =>
  p.now + (p.next + Math.max(0, p.mission)) * (1 - p.risk) + Math.min(0, p.mission) + p.shape - p.cost;

// The Grids the Main Task scores: its zones, or for Black Boxes the one zone a
// Box must be carried into, where the card names one.
function scoringCells(view: SeatView): Set<string> {
  const task = view.task;
  if (task?.family === 'blackbox') return new Set(view.zones.filter((z) => !!task.scoringZone && (z.name === task.scoringZone || z.id === task.scoringZone)).flatMap((z) => z.cells));
  return new Set(view.zones.filter((z) => z.scoring).flatMap((z) => z.cells));
}

// What it could do at its NEXT turn from where an answer leaves it (`at`): a
// Mech on each Timing one of its weapons opens with an enemy inside that
// weapon's Range from there, a Drone in the Automatic Phase. The same answer
// leaves the same table whichever question it was offered in, so it is asked
// once for a table.
function nextTurn(o: Option, at: Grid, c: Ctx): number {
  const spot = `${c.me.uid}|${o.id}`;
  const known = c.nexts.get(spot);
  if (known !== undefined) return known;
  const value = nextTurnAsked(o, at, c);
  c.nexts.set(spot, value);
  return value;
}

function nextTurnAsked(o: Option, at: Grid, c: Ctx): number {
  if (!o.later) return 0;
  const arms = c.me.weapons.filter((x) => ready(x) && !!x.timing && (
    x.type === 'Projectile' ? c.foes.some((f) => apart(at, f.grid) <= x.range + (x.strike ?? 0))
      : (x.type === 'Firing' || x.type === 'Melee') && c.foes.some((f) => reaches(x, at, f.grid))));
  const timings: (string | undefined)[] = c.me.kind === 'mech' ? [...new Set(arms.map((x) => x.timing))] : [undefined];
  // As that Opportunity begins a Mech may take Offensive Stance (`restance`).
  const restance = c.skills.restance && c.me.kind === 'mech';
  let best = 0;
  for (const timing of timings) {
    const turn = o.later(restance ? [...DEEDS, 'stance'] : DEEDS, timing);
    const deed = deedAt(turn?.options ?? [], c, false);
    if (deed) best = Math.max(best, deed.value);
    const up = restance ? turn?.options.find((x) => x.id === OFFENSIVE) : undefined;
    const fought = up?.then ? deedAt(up.then(DEEDS)?.options ?? [], c, false) : null;
    if (fought) best = Math.max(best, fought.value);
  }
  // A Drone moved by a Command acts again in the same round.
  return best * (c.me.kind !== 'mech' && c.view.phaseName === 'Command' ? c.w.futureSoon : c.w.future);
}

// Whether geometry says anything could be done from a Grid: an enemy in the
// Range and the arc of something it carries.
function claimAt(at: Grid, facing: number, c: Ctx): number {
  const struck = standing(c.me, at, facing, c.view, c.foes);
  if (struck !== null) return struck;
  // A unit in Optical Camouflage is nothing to attack as geometry reads it for
  // the copy. One that could be designated from here is something to do, and
  // what it comes to is the engine's to say (`stalk`).
  if (c.hidden.length) {
    const locked = lockedAt(c.me, at, c.foes);
    if (c.hidden.some((f) => couldStrike(c.me, at, facing, f, locked))) return 1;
  }
  // A jammer or a launcher: an enemy inside its arm.
  const arm = Math.max(0, ...c.me.weapons.filter((x) => ready(x) && (x.type === 'Tactic' || x.type === 'Projectile')).map((x) => x.range + (x.strike ?? 0)));
  if (arm > 0 && c.foes.some((f) => !f.camouflaged && apart(at, f.grid) <= arm)) return 1;
  // A Mech within a Remote Access of a Terminal still open that is not its
  // squad's to have anyway.
  const task = c.view.task;
  if (c.skills.mission && c.me.kind === 'mech' && task?.family === 'terminal' && task.reach > 0) {
    const open = c.view.zones.some((z) => z.scoring && !z.accessed && z.holder !== c.view.seat && z.cells.some((cell) => apart(at, cellOf(cell)) <= task.reach));
    if (open) return 1;
  }
  return 0;
}

// A MINE UNDERFOOT. A Movement that ends in a Mine's Grid sets it off (the
// seam says which answers do: `mined`), and what the blast is likely to do to
// the unit is the answer's own odds: charged to the plan as an enemy's attack
// on it would be, with what it carries lost to a Penetration.
function mineCost(o: Option, c: Ctx): number {
  if (!o.tags.includes('mined')) return 0;
  const f = o.chance ? o.chance() : null;
  return f ? gainOf(f, c.me, c.view, c.w) + (c.skills.mission ? f.pen * carried(c.me, c.view, c.w) : 0) : UNKNOWN_SHOT;
}

// INTO A ZONE BY TWO MOVEMENTS. Where a Maneuver leaves a Movement Action that
// reaches a zone worth taking (the engine's count says so: no activation
// more), the two are planned as one: the engine is asked what the Movement
// Action would then offer, the plan ends in the zone, the Main Task's gain is
// read off the table it leaves, and it is priced for standing THERE. Left to
// the walk alone, the Maneuver would be priced for the Grid it passes through.
function entryBy(o: Option, at: Grid, c: Ctx, led: Quarry | null): Plan | null {
  const left = c.skills.mission && c.w.entry > 0 ? unspent(o, c) : undefined;
  if (!left || !o.then || !walked(c.view) || c.me.lowValue) return null;
  // The Boxes the Maneuver itself picks up are in hand for the Movement after.
  const took = tookBy(o);
  const within = targetsOf(c, took).filter((t) => {
    const walk = walkOf(c, c.me, at, t, left);
    return !!walk && walk.grids > 0 && walk.turns === 0;
  });
  if (!within.length) return null;
  const cells = new Set(within.flatMap((t) => t.zone.cells));
  const near = c.foes.length ? c.foes.reduce((a, b) => (apart(at, b.grid) < apart(at, a.grid) ? b : a)) : null;
  // One answer a Grid of the zone: the facing that looks at the nearest enemy.
  const ends = new Map<string, Option>();
  for (const m of o.then(['move'])?.options ?? []) {
    const end = kindOf(m) === 'move' ? endOf(m) : null;
    // (Not by way of a Mine: the walk into the zone is planned on clear ground.)
    if (!end || !cells.has(key(end)) || m.tags.includes('mined') || (!c.skills.crush && m.tags.includes('crush-unit'))) continue;
    const held = ends.get(key(end));
    // A Movement that picks up a Box on its way is the one planned.
    const takes = m.tags.includes('take');
    const took = !!held && held.tags.includes('take');
    if (!held || (takes && !took) || (takes === took && near && facingOf(m) === facingAt(end, near.grid) && facingOf(held) !== facingAt(end, near.grid))) ends.set(key(end), m);
  }
  let best: Plan | null = null;
  for (const m of ends.values()) {
    const end = endOf(m) as Grid;
    const plan: Plan = {
      option: o, via: m, how: 'move', at: end, deed: null, now: 0 - mineCost(o, c), next: 0,
      mission: missionOf(m.after?.()?.view() ?? c.view, c.w) - c.mission,
      shape: shapeAt(end, c, led, undefined, [...took, ...tookBy(m)]),
      cost: 0, risk: 0,
    };
    if (!best || sumOf(plan) > sumOf(best) + EXACT) best = plan;
  }
  return best;
}

// A DECISION WORKED OUT IN STEPS. Planning is a run of questions put to the
// engine (what could be done from this Grid, what an enemy could do to the
// unit there), and between any two of them the work may be put down and picked
// up again: a `yield`. Run straight through (`finish`) it is the decision; run
// with a pause at a yield (`makeTactician` ponder) it is the same decision, and
// a page that shares the thread is not held for the whole of it.
type Steps<T> = Generator<void, T, void>;
function finish<T>(steps: Steps<T>): T {
  let step = steps.next();
  while (!step.done) step = steps.next();
  return step.value;
}

// THE PLANS OF ONE DECISION, each with every term but what standing there
// would cost. One plan for staying; one for each Grid a Movement ends in, on
// the facing that looks at the most; one for each other answer that prepares
// something (a Stance, a Charge, a Token removed).
// A LOAD LENT (a Carrier, 162; OTTO's playtest, 2026-10-03: "It has the
// backpack on it so normally I would think that it would stick near the mech
// safely so the mech could utilize the backpack it loaded"): Ally Mechs in
// Contact with the Drone may use its Load as their own Part when they act. From
// a Grid it is worth, for each Ally Mech it would touch there, how much better
// that Mech's best deed at its next turn is on the table the Drone's move
// leaves than on the table without the Drone. The engine says whether the two
// touch and what the Load adds (a Cooler's Yellow die on a Laser, an Action of
// the Part), so a Load that adds nothing to a Mech is no reason to stand by it.
// Each Mech's turn without the Drone is asked once a decision.
function lender(c: Ctx): (out: Outlook | null | undefined, at: Grid) => number {
  const bases = new Map<number, number>();
  let bare: Outlook | null | undefined;
  const best = (out: Outlook, m: UnitView): number => {
    let top = 0;
    for (const timing of lendTimings(m)) top = Math.max(top, deedAt(out.turnOf(m.uid, DEEDS, timing)?.options ?? [], c, false)?.value ?? 0);
    return top;
  };
  return (out, at) => {
    if (!out) return 0;
    let worth = 0;
    for (const m of c.view.units) {
      if (m.side !== c.view.seat || m.kind !== 'mech' || !m.alive || !m.deployed || chebyshev(m.grid, at) > 1) continue;
      if (!bases.has(m.uid)) {
        if (bare === undefined) bare = c.d.here?.()?.without(c.me.uid) ?? null;
        bases.set(m.uid, bare ? best(bare, m) : 0);
      }
      worth += Math.max(0, best(out, m) - (bases.get(m.uid) ?? 0));
    }
    return c.w.lend * worth;
  };
}

// What a deployment against a Mech is worth where nothing yet says what the
// Load adds (no enemy in reach), as a share of `lend`: a tie-break, as
// `tempo` and `zoneStep` are.
const LEND_TIE = 0.25;

// The Timings a Mech is asked on to see what a Load adds to it: those of the
// attacks it has ready, Firing first, two at most. (A Movement Action's Timing
// asked here found no attack at all, and the Load was worth nothing.)
const ATTACKS = ['Firing', 'Melee', 'Projectile'];
const lendTimings = (m: UnitView): string[] =>
  [...new Set(m.weapons.filter((x) => ready(x) && !!x.timing && ATTACKS.includes(x.type))
    .sort((a, b) => ATTACKS.indexOf(a.type) - ATTACKS.indexOf(b.type)).map((x) => String(x.timing)))].slice(0, 2);

// WHAT A TOKEN TAKEN OFF ANOTHER UNIT GIVES IT BACK (System Repair on an
// Ally, `mend`): how much better its best deed at its next turn is on the
// table the card leaves than on the table as it stands, as the engine reckons
// both; for a Mech on the Timing it has dialled where it still has to act this
// round, else on those of its attacks (Firing first, two at most: a Token may
// be what keeps them from being ready). A turn next round counts at `future`.
function mended(o: Option, c: Ctx): number {
  const u = unitOf(c.view, o.facts?.uid);
  const after = o.after?.();
  const now = c.d.here?.();
  if (!u || !after || !now || !u.alive || !u.deployed) return 0;
  const timings: (string | undefined)[] = u.kind !== 'mech' ? [undefined]
    : u.timing && !u.done ? [u.timing]
      : [...new Set(u.weapons.filter((x) => !!x.timing && ATTACKS.includes(x.type)).sort((a, b) => ATTACKS.indexOf(a.type) - ATTACKS.indexOf(b.type)).map((x) => String(x.timing)))].slice(0, 2);
  let gain = 0;
  for (const timing of timings) {
    const was = deedAt(now.turnOf(u.uid, DEEDS, timing)?.options ?? [], c, false)?.value ?? 0;
    const is = deedAt(after.turnOf(u.uid, DEEDS, timing)?.options ?? [], c, false)?.value ?? 0;
    gain = Math.max(gain, is - was);
  }
  return u.done ? c.w.future * gain : gain;
}

// THE HARPY'S TOW (ZHDR-304, `tow`): a Command Movement that drags an Ally
// along and sets it down behind the Harpy (the seam's `towed`, `towedTo`).
// What the Ally gains by it: its best deed at its next turn on the table the
// tow leaves, less on the table as it stands, as `mended` reckons a Token
// taken off it; and its own walk to the Main Task from the Grid it is set down
// in, less from where it stands. Less the Command Token the tow spends
// (`towToken`). And whether the Main Task is to be read off the table it
// leaves: the Ally is set down in a zone, or taken out of one.
//
// A TOKEN TO SPARE. The Token is one a Drone of the squad would otherwise be
// Commanded with, and a Drone that is not Commanded does nothing this round:
// no tow is worth that. So a tow is planned only while the squad's Mechs hold
// more face-up Command Tokens than it has Drones still to be Commanded this
// phase (`spareToken`); null otherwise. (Measured without it: random GoF
// squads of one Mech and four Drones, no gain.)
function spareToken(c: Ctx): boolean {
  const mine = c.view.units.filter((x) => x.side === c.view.seat && x.alive && x.deployed);
  const tokens = mine.filter((x) => x.kind === 'mech').reduce((n, x) => n + x.statuses.filter((s) => s === 'command').length, 0);
  const waiting = mine.filter((x) => x.kind === 'drone' && x.uid !== c.me.uid && !x.statuses.includes('commandUsed')).length;
  return tokens > waiting;
}

function towed(o: Option, c: Ctx): { value: number; scores: boolean } | null {
  const u = unitOf(c.view, o.facts?.towed);
  const to = o.facts?.towedTo as { c: number; r: number } | undefined;
  if (!spareToken(c)) return null;
  if (!u || !to || !u.alive || !u.deployed) return { value: 0, scores: false };
  const at: Grid = { col: to.c, row: to.r };
  const after = o.after?.();
  const now = c.d.here?.();
  let gain = 0;
  if (after && now) {
    const timings: (string | undefined)[] = u.kind !== 'mech' ? [undefined]
      : u.timing && !u.done ? [u.timing]
        : [...new Set(u.weapons.filter((x) => !!x.timing && ATTACKS.includes(x.type)).sort((a, b) => ATTACKS.indexOf(a.type) - ATTACKS.indexOf(b.type)).map((x) => String(x.timing)))].slice(0, 2);
    for (const timing of timings) {
      const was = deedAt(now.turnOf(u.uid, DEEDS, timing)?.options ?? [], c, false)?.value ?? 0;
      const is = deedAt(after.turnOf(u.uid, DEEDS, timing)?.options ?? [], c, false)?.value ?? 0;
      gain = Math.max(gain, is - was);
    }
    if (u.done) gain *= c.w.future;
  }
  // Its walk as its own: a unit whose turn this round is still to come walks
  // a round sooner.
  const as: Ctx = { ...c, me: u, soon: !u.done };
  const walk = zoneWalk(at, as) - zoneWalk(u.grid, as);
  const zones = c.skills.mission ? scoringCells(c.view) : new Set<string>();
  return { value: c.w.tow * (gain + walk) - c.w.towToken, scores: zones.has(key(at)) || zones.has(key(u.grid)) };
}

// What the other squad could do to the Ally a tow sets down that it could not
// do to it where it stands: charged to the tow in full. (What it could do to
// it where it stands is the same for every other plan, and is asked once a
// table.)
function towHarm(o: Option, c: Ctx): number {
  const u = unitOf(c.view, o.facts?.towed);
  const to = o.facts?.towedTo as { c: number; r: number } | undefined;
  if (!u || !to) return 0;
  const as: Ctx = { ...c, me: u };
  const spot = `${u.uid}|${key(u.grid)}|stays`;
  let was = c.harms.get(spot);
  if (!was) {
    was = exposure(c.d.here?.(), u.grid, as);
    if (!was.partial) c.harms.set(spot, was);
  }
  const is = exposure(o.after?.(), { col: to.c, row: to.r }, as);
  return Math.max(0, is.cost - was.cost);
}

// AN ESCORT (`escort`, M13). On a VIP mission the squad's Commander is worth
// the Main Task, and a unit standing between it and an enemy's line of fire
// takes the line (rules.ts firingSight: the units between obstruct and block a
// line). For a plan that moves a unit within a few Grids of its Commander, what
// the other squad could do to the Commander on the table the plan leaves, less
// what it could do to it as the board stands: positive, the plan leaves it
// more open; negative, the plan screens it. At `escort` of the difference.
// What the Commander faces as the board stands is asked once a table.
const ESCORT_REACH = 3;
// Whether a Grid stands in the way between two others: inside the box they
// span, and within a Grid of the straight line between them.
function between(a: Grid, b: Grid, p: Grid): boolean {
  if (p.col < Math.min(a.col, b.col) - 1 || p.col > Math.max(a.col, b.col) + 1 || p.row < Math.min(a.row, b.row) - 1 || p.row > Math.max(a.row, b.row) + 1) return false;
  if (same(p, a) || same(p, b)) return false;
  const dx = b.col - a.col;
  const dy = b.row - a.row;
  const len = Math.hypot(dx, dy) || 1;
  return Math.abs(dx * (p.row - a.row) - dy * (p.col - a.col)) / len <= 1;
}
// The Grids of a decision whose plans are weighed for the Commander (`escort`):
// those in the way of an enemy that could reach it, and every Grid when the
// unit stands in such a way now (leaving it is what is weighed). Null where
// the escort is not asked.
function escortGrids(c: Ctx): ((at: Grid) => boolean) | null {
  if (c.w.escort <= 0 || c.view.task?.family !== 'vip' || c.me.commander) return null;
  const lead = c.view.units.find((u) => u.side === c.view.seat && u.commander && u.alive && u.deployed);
  if (!lead || chebyshev(lead.grid, c.me.grid) > ESCORT_REACH + c.me.move) return null;
  const threats = c.hostile.filter((e) => inReachOf(e, lead.grid));
  if (!threats.length) return null;
  const screening = threats.some((e) => between(e.grid, lead.grid, c.me.grid));
  return (at) => chebyshev(lead.grid, at) <= ESCORT_REACH && (screening || threats.some((e) => between(e.grid, lead.grid, at)));
}
function escortOf(o: Option, at: Grid, c: Ctx): number {
  if (c.view.task?.family !== 'vip' || c.me.commander) return 0;
  const lead = c.view.units.find((u) => u.side === c.view.seat && u.commander && u.alive && u.deployed);
  if (!lead || (chebyshev(lead.grid, at) > ESCORT_REACH && chebyshev(lead.grid, c.me.grid) > ESCORT_REACH)) return 0;
  // Only the enemies whose line to the Commander the unit stands in, where it
  // stands or where the plan leaves it: no other line is changed by the move.
  const lines = c.hostile.filter((e) => inReachOf(e, lead.grid) && (between(e.grid, lead.grid, at) || between(e.grid, lead.grid, c.me.grid)));
  if (!lines.length) return 0;
  const as: Ctx = { ...c, me: lead, hostile: lines };
  const spot = `${lead.uid}|${key(lead.grid)}|stays|${lines.map((e) => e.uid).join(',')}`;
  let was = c.harms.get(spot);
  if (!was) {
    was = exposure(c.d.here?.(), lead.grid, as);
    if (!was.partial) c.harms.set(spot, was);
  }
  const is = exposure(o.after?.(), lead.grid, as);
  return c.w.escort * (is.cost - was.cost);
}

// A HIGHLIGHT PUT ON A UNIT OF THIS SQUAD (`taunt`, M12). An enemy's Firing
// Action that can target a unit with Highlight must target it and no other
// (6.2.1; FAQ J18), so an enemy with the Highlighted unit in its sights shoots
// it: the rest of the squad is spared that enemy's fire, and the unit
// Highlighted takes it whatever it would rather have shot (`decoy` no longer
// shares it out). For each unit of the squad but the one acting (whose own Grid
// is its plan's price, read on the same table), what the enemies that could
// reach the Highlighted unit could do to it as the board stands, less on the
// table the Highlight leaves, with whom each would rather shoot read on that
// table (`aimsOn`). A Highlight on a unit tougher than what it covers spares
// the squad; on its most fragile unit it costs it.
function tauntOf(o: Option, c: Ctx): number {
  const x = unitOf(c.view, o.facts?.targetUid);
  const after = o.after?.();
  const now = c.d.here?.();
  if (!x || x.side !== c.view.seat || !after || !now) return 0;
  const lines = c.hostile.filter((e) => inReachOf(e, x.grid));
  if (!lines.length) return 0;
  const aims = new Map<number, Map<number, number>>();
  let spared = 0;
  for (const u of c.view.units) {
    if (u.side !== c.view.seat || !u.alive || !u.deployed || u.uid === c.me.uid) continue;
    const near = lines.filter((e) => inReachOf(e, u.grid));
    if (!near.length) continue;
    const as: Ctx = { ...c, me: u, hostile: near };
    const spot = `${u.uid}|${key(u.grid)}|stays|${near.map((e) => e.uid).join(',')}`;
    let was = c.harms.get(spot);
    if (!was) {
      was = exposure(now, u.grid, as);
      if (!was.partial) c.harms.set(spot, was);
    }
    spared += was.cost - exposure(after, u.grid, { ...as, aims, aimsOn: after }).cost;
  }
  return c.w.taunt * spared;
}
const highlights = (o: Option | null | undefined): boolean => !!o && kindOf(o) === 'token' && o.tags.includes('token:highlight') && !o.tags.includes('enemy');

function* plansSteps(c: Ctx): Steps<Plan[]> {
  const { d, view, me, w } = c;
  const led = quarryOf(c);
  const zones = c.skills.mission ? scoringCells(view) : new Set<string>();
  const end = d.options.find((o) => o.tags.includes('end'));
  // A Drone carrying a Load: what each Grid is worth to the Mechs it would
  // touch there (`lender`).
  const loan = me.lends && w.lend > 0 ? lender(c) : null;

  // The Tactic that is a Command Coordination, and an Extra Action Opportunity
  // handed to an Ally Mech: what each unit would gain by it, for `handOff` to
  // read.
  {
    const faces = d.options.filter((o) => handed(o, c) && !c.handed.has(handKey(c, o)));
    if (faces.length) {
      // What this table has been asked already is this decision's own to keep.
      const kept: Memo = { table: tableOf(view, c.skills.carded), harms: c.harms, nexts: c.nexts, firepower: c.firepower, walks: c.walks, targets: c.targets, holdings: c.holdings, handed: c.handed, aims: c.aims, races: c.races, backs: c.backs };
      for (const o of faces) {
        c.handed.set(handKey(c, o), yield* commandGain(o, view, w, c.skills, kept));
        yield;
      }
    }
  }
  // Staying: what it can do now, or failing that what it could do next turn.
  const here = deedAt(d.options, c, true);
  yield;
  // Ending here with a Box underfoot picks it up: what the Task gains by that.
  const pickup = c.skills.mission ? d.options.find((o) => o.tags.includes('end') && o.tags.includes('take')) : undefined;
  // (Doing it, `nextAfter` of what it could do there a turn later besides.)
  const after = (o: Option | undefined, at: Grid): number => (w.nextAfter > 0 && o ? w.nextAfter * nextTurn(o, at, c) : 0);
  const plans: Plan[] = [{
    option: null, how: 'stay', at: me.grid, deed: here,
    now: here?.value ?? 0,
    next: (here ? after(end, me.grid) : !end ? 0 : nextTurn(end, me.grid, c)) + (loan ? loan(d.here?.(), me.grid) : 0),
    mission: pickup ? missionOf(pickup.after?.()?.view() ?? view, w) - c.mission + stealOf(pickup, c) : 0,
    shape: shapeAt(me.grid, c, led, undefined, tookBy(pickup)) + w.better,
    cost: 0, risk: 0,
  }];

  // Each Movement's Grids, one answer a Grid: the facing geometry likes best,
  // and of equals the one that looks at the nearest enemy.
  const landings = new Map<string, { o: Option; at: Grid; claim: number; take: boolean }>();
  // A walk a Mine stops keeps Range to go on with, which ending the Movement
  // in the Mine's Grid does not: where both are offered, the stop is planned.
  const stops = new Set(d.options.filter((o) => o.tags.includes('halt')).map((o) => `${o.facts?.actionId ?? ''}:${key(endOf(o) ?? me.grid)}:${facingOf(o)}`));
  for (const o of d.options) {
    if (kindOf(o) !== 'move' && !(kindOf(o) === 'blink' && c.skills.blink)) continue;
    if (o.tags.includes('form') && !c.skills.bit) continue;
    if (o.tags.includes('crush-unit') && !c.skills.crush) continue;
    // A Load's Movement set down against a Mech is planned only where a Load
    // lent is worth something (`lend`).
    if (o.tags.includes('lend') && !loan) continue;
    // And a Harpy's tow only where a tow is (`tow`).
    if (o.tags.includes('tow') && !(w.tow > 0)) continue;
    const at = endOf(o);
    const facing = facingOf(o);
    if (!at || facing === null) continue;
    if (stops.size && o.tags.includes('mined') && !o.tags.includes('halt') && stops.has(`${o.facts?.actionId ?? ''}:${key(at)}:${facing}`)) continue;
    // A Bit's walk is planned for each face it may turn to (`into`).
    const face = o.facts?.into ? `>${String(o.facts.into)}` : '';
    // And a Crush of a Unit for each way it comes out (`way`): where the units
    // it crushed end up is the plan's to weigh.
    const way = o.tags.includes('crush-unit') ? `#${String(o.facts?.way ?? '')}` : '';
    // And the Movement set down against a Mech is a plan of its own, and so is
    // each tow.
    const lean = o.tags.includes('lend') ? '+lend' : '';
    const drag = o.tags.includes('tow') ? `+tow:${String(o.facts?.towed ?? '')}` : '';
    const spot = `${o.tags.includes('maneuver') ? 'maneuver' : String(o.facts?.actionId ?? 'move')}${face}${way}${lean}${drag}:${same(at, me.grid) ? `turn:${facing}` : key(at)}`;
    const near = c.foes.length ? c.foes.reduce((a, b) => (apart(at, b.grid) < apart(at, a.grid) ? b : a)) : null;
    const claim = claimAt(at, facing, c) + (near && !same(at, near.grid) && facing === facingAt(at, near.grid) ? 1e-6 : 0) + turned(o, c);
    const held = landings.get(spot);
    // Of two answers that end in the same Grid, the one that picks up a Box on
    // its way is the one planned: a Box is Victory Points and costs no Tick.
    const take = c.skills.mission && o.tags.includes('take');
    if (!held || (take && !held.take) || (take === held.take && claim > held.claim)) landings.set(spot, { o, at, claim, take });
  }
  const ranked = [...landings.values()].sort((a, b) => b.claim - a.claim);
  // What it could still do this activation from a Grid is the engine's to
  // say, for the Grids geometry gives a chance (a Drone that has moved has
  // nothing left to do).
  const deeds = new Map<Option, Deed | null>();
  if (me.kind === 'mech') {
    for (const l of ranked.filter((x) => x.claim >= 1 && !!x.o.then).slice(0, LIMITS.LANDINGS)) {
      deeds.set(l.o, deedAt(l.o.then?.(DEEDS)?.options ?? [], c, false));
      yield;
    }
  }
  // And what it could do from there a turn later, for the Grids with nothing
  // to do now. Not every Grid can be asked about, and two kinds are worth it:
  // the SAFEST (no enemy could reach it, then furthest from one), where a unit
  // with a long arm still has its shot and stands unharmed; and the STRONGEST
  // claims (the best target, nearest), where a unit with a short arm has a
  // shot at all. Half the asking goes to each: asking only the safest left a
  // Mech with a six-Grid gun no reason to walk toward a fight.
  const open = (at: Grid): boolean => !c.hostile.some((e) => inReachOf(e, at));
  const clear = (at: Grid): number => Math.min(...c.foes.map((f) => apart(at, f.grid)));
  const nexts = new Map<Option, number>();
  const idle = ranked.filter((x) => x.claim >= 1 && !deeds.get(x.o));
  const budget = me.kind === 'mech' ? LIMITS.MECH_FUTURES : LIMITS.FUTURES;
  const safest = idle
    .map((x) => ({ ...x, open: open(x.at), clear: c.foes.length ? clear(x.at) : 0 }))
    .sort((a, b) => Number(b.open) - Number(a.open) || b.clear - a.clear)
    .slice(0, Math.ceil(budget / 2));
  const strongest = idle.filter((x) => !safest.some((y) => y.o === x.o)).slice(0, budget - safest.length);
  for (const l of [...safest, ...strongest]) {
    nexts.set(l.o, nextTurn(l.o, l.at, c));
    yield;
  }
  // And for the Grids with the best deeds now, what could still be done there a
  // turn later (`nextAfter`).
  const afters = new Map<Option, number>();
  if (w.nextAfter > 0) {
    const acting = ranked.filter((x) => !!deeds.get(x.o)).sort((a, b) => (deeds.get(b.o)?.value ?? 0) - (deeds.get(a.o)?.value ?? 0)).slice(0, LIMITS.AFTERS);
    for (const l of acting) {
      afters.set(l.o, after(l.o, l.at));
      yield;
    }
  }
  // The Grids weighed for the Commander (`escort`): at most a few, the best
  // claims first.
  const guard = escortGrids(c);
  let guarded = 0;
  for (const l of ranked) {
    const deed = deeds.get(l.o) ?? null;
    // What the plan spares the Commander, or leaves it open to (`escortOf`):
    // weighed as what it does now, so the Grids in the way are asked before
    // the plans are priced.
    const shield = guard && guarded < LIMITS.ESCORTS && guard(l.at) ? (guarded++, -escortOf(l.o, l.at, c)) : 0;
    // A tow: what the Ally gains by it, now (`towed`); none without a Token
    // to spare.
    const drag = l.o.tags.includes('tow') ? towed(l.o, c) : null;
    if (l.o.tags.includes('tow') && !drag) continue;
    const scores = zones.has(key(l.at)) || zones.has(key(me.grid)) || l.take || !!drag?.scores;
    plans.push({
      option: l.o, how: 'move', at: l.at, deed,
      now: (deed?.value ?? 0) - mineCost(l.o, c) + (drag?.value ?? 0) + shield,
      next: (deed ? afters.get(l.o) ?? 0 : nexts.get(l.o) ?? 0) + (loan ? loan(l.o.after?.(), l.at) : 0),
      mission: (scores ? missionOf(l.o.after?.()?.view() ?? view, w) - c.mission : 0) + (l.take ? stealOf(l.o, c) : 0),
      // With nothing to do there, what is left of the activation goes on the
      // walk: a Movement still unspent is counted before the walk is.
      shape: shapeAt(l.at, c, led, deed ? undefined : unspent(l.o, c), l.take ? tookBy(l.o) : NONE),
      cost: 0, risk: 0,
    });
    const entry = deed && !c.skills.entryDeed ? null : entryBy(l.o, l.at, c, led);
    if (entry) plans.push(entry);
    yield;
  }

  // Answers that prepare something where it stands: asked what they lead to.
  for (const o of d.options) {
    const what = kindOf(o);
    // A Low Profile Token taken and a Mode changed are of the same kind: an
    // Action that changes what the unit is where it stands. Each is weighed
    // by what it could do afterwards and what standing there would then cost.
    const prepares = (what === 'stance' && c.skills.stance) || (what === 'charge' && c.skills.charge) || (what === 'stabilise' && o.tags.includes('remove-token'))
      || (what === 'token' && o.tags.includes('self') && o.tags.includes('token:lowProfile') && c.skills.profile) || (what === 'mode' && c.skills.mode)
      // Optical Camouflage is of that kind too: an enemy must win a Scan
      // before it may attack, which is what standing there then costs.
      || (what === 'token' && o.tags.includes('self') && o.tags.includes('token:camouflage') && c.skills.cloak)
      // And the Bit turned to another face where it stands, which changes what
      // it is as a Mode does.
      || (what === 'form' && c.skills.bit)
      // And a Tactics Card that does as much for the Mech whose Opportunity it
      // is: its Stance changed though the Stance is fixed (Tactical
      // Disposition), or a Token taken off it (System Repair).
      || (what === 'tactic' && c.skills.tactics && o.facts?.uid === me.uid && (o.tags.includes('card:277') || o.tags.includes('card:278')))
      // And System Repair on another unit of the squad (`mend`): the Mech goes
      // on with its Opportunity, and the unit repaired gets back what the
      // Token took (`mended`).
      || (what === 'tactic' && c.skills.tactics && c.skills.mend && o.facts?.uid !== me.uid && o.tags.includes('card:277'))
      // And a Highlight put on a unit of the squad, this one (Amplify Profile)
      // or another (Target Tag): whom the other squad may shoot (`taunt`).
      || (highlights(o) && w.taunt > 0);
    if (!prepares || !o.then) continue;
    const deed = deedAt(o.then(DEEDS)?.options ?? [], c, false);
    const back = what === 'tactic' && o.facts?.uid !== me.uid ? mended(o, c) : highlights(o) ? tauntOf(o, c) : 0;
    yield;
    plans.push({
      option: o, how: what, at: me.grid, deed,
      now: (deed?.value ?? 0) + back,
      next: deed ? after(o, me.grid) : nextTurn(o, me.grid, c),
      mission: 0,
      // A card is used once a game: it must do more than keeping it is worth.
      shape: shapeAt(me.grid, c, led) - (what === 'tactic' ? w.card : 0),
      cost: 0, risk: 0,
    });
  }

  // TAKING COVER BEHIND SMOKE. A Smoke card thrown at its own feet hides the
  // unit until the round ends (a unit in a Screen is not seen, 4.16, and a lone
  // Screen is gone with the round). It is a plan to stay where it stands, at
  // what standing there costs behind the one Screen: priced as every plan is,
  // and worth its Tick and its one use only where that is a good deal less.
  if (c.skills.exposure && c.skills.screen) {
    const smoke = d.options.find((o) => kindOf(o) === 'launch' && o.tags.includes('smoke') && !!o.then && same(endOf(o) ?? { col: -1, row: -1 }, me.grid));
    const hide = smoke?.then?.()?.options.find((o) => o.tags.includes('smoke') && Array.isArray(o.facts?.cells) && (o.facts?.cells as unknown[]).length === 1);
    if (smoke && hide) {
      plans.push({ option: smoke, via: hide, how: 'screen', at: me.grid, deed: null, now: -SMOKE_WORTH, next: plans[0].next, mission: 0, shape: plans[0].shape, cost: 0, risk: 0 });
      yield;
    }
  }

  // The few plans that lead: their whole volley, not only its first attack.
  const lead = plans.filter((p) => p.option && p.deed?.reason === 'attack_value').sort((a, b) => sumOf(b) - sumOf(a)).slice(0, LIMITS.VOLLEYS);
  for (const p of lead) {
    const whole = volley(p.option?.then?.(DEEDS)?.options ?? [], c, true);
    const mine = p.option ? mineCost(p.option, c) : 0;
    if (whole && whole.value - mine > p.now + EXACT) { p.deed = whole; p.now = whole.value - mine; }
  }
  return plans;
}

// The key what standing in a Grid costs is kept under (`harms`): the unit, the
// Grid, what the plan does there that changes what a hit costs it (`tail`), and
// the facing the plan leaves it in (`faced`): an answer's own where it says one,
// else the unit's as it stands.
function harmKey(c: Ctx, at: Grid, tail: string, o?: Option | null): string {
  return `${c.me.uid}|${key(at)}|${tail}${c.skills.faced ? `@${(o ? facingOf(o) : null) ?? c.me.facing}` : ''}`;
}

// THE PLAN WORTH MOST, what standing there would cost taken off. The cost is
// only ever a loss, so the plans are asked in order of everything else, and
// the asking stops at the first plan that could not beat the best so far.
function* bestSteps(c: Ctx): Steps<{ best: Plan; stay: Plan; plans: Plan[] } | null> {
  const plans = (yield* plansSteps(c)).sort((a, b) => sumOf(b) - sumOf(a));
  const stay = plans.find((p) => !p.option);
  if (!stay) return null;
  // A Stance changes what a hit costs, and a Screen who can make one, so each
  // is asked for itself; every other plan that leaves it in one Grid costs
  // what that Grid costs.
  //
  // A UNIT IN OPTICAL CAMOUFLAGE has more than one price for the Grid it
  // stands in. Doing nothing it stays hidden, and an enemy must win a Scan to
  // attack it. An Action or a Maneuver without Silence owes its Reveal
  // (4.12.2), so the plan to stay and act is priced on the table its deed
  // leaves, where a look ahead finds the unit seen (`shown`): the table an
  // answer of commands leaves, and for an attack, whose dice nobody knows,
  // the table once it is paid for (the question `then` asks there).
  const hiding = c.skills.shown && c.me.statuses.includes('camouflage');
  const price = (p: Plan, budget = Infinity): void => {
    if (!c.skills.exposure) return;
    const mark = hiding ? (p.option ? '|acts' : p.deed ? '|deed' : '') : '';
    // A Bit's face changes what a hit costs it, wherever it ends.
    const face = p.option?.facts?.into ? `>${String(p.option.facts.into)}` : '';
    // And an Ally towed beside it changes what the other squad shoots at.
    const tow = p.option?.tags.includes('tow') ? `+tow:${String(p.option.facts?.towed ?? '')}` : '';
    // The answers that change the unit itself where it stands.
    const self = p.how === 'stance' || p.how === 'token' || p.how === 'mode' || p.how === 'form' || p.how === 'tactic';
    const spot = harmKey(c, p.at, `${self || p.how === 'screen' ? p.option?.id : ''}${face}${tow}${mark}`, p.option);
    let harm = c.harms.get(spot);
    if (!harm) {
      const acted = hiding && p.deed ? p.deed.option.after?.() ?? p.deed.option.then?.(['end'])?.here?.() : undefined;
      const stands = acted ?? c.d.here?.();
      const table = p.via ? p.via.after?.() : p.option ? p.option.after?.() : stands;
      // THE UNIT AS THE PLAN LEAVES IT (`reshape`): a Mode, a Stance, a Token,
      // a Bit's face changed is a different unit to shoot at and to shoot back
      // with, read off the table the plan leaves; at 0 it is read as it stands.
      const reshaped = c.w.reshape > 0 && table && (self || face.length > 0) ? unitOf(table.view(), c.me.uid) : undefined;
      const as: Ctx = reshaped ? { ...c, me: reshaped } : c;
      // A Highlight on this unit draws every enemy that has it in its sights,
      // whatever each would rather shoot: read on the table it leaves.
      harm = exposure(table, p.at, highlights(p.option) && table ? { ...as, aims: new Map(), aimsOn: table } : as, budget);
      if (!harm.partial) c.harms.set(spot, harm);
    }
    // The Ally a tow sets down pays for where it is set down (`towHarm`).
    p.cost = harm.cost + (tow && p.option ? towHarm(p.option, c) : 0);
    p.risk = harm.risk;
  };
  const reachable = (p: Plan): boolean => c.hostile.some((e) => inReachOf(e, p.at));
  let best: Plan | null = null;
  let asked = 0;
  for (const p of plans) {
    if (best && sumOf(p) <= worthOf(best) + EXACT) break;
    if (c.skills.exposure && reachable(p)) {
      if (asked >= LIMITS.PRICED) continue;
      asked += 1;
    }
    price(p, best ? sumOf(p) - worthOf(best) : Infinity);
    p.priced = true;
    if (!best || worthOf(p) > worthOf(best) + EXACT) best = p;
    yield;
  }
  // Staying is what every other plan is measured against: priced in full, and
  // weighed whether or not the asking reached it.
  price(stay);
  stay.priced = true;
  yield;
  if (!best || worthOf(stay) > worthOf(best) + EXACT) best = stay;
  // TAKING COVER. The best of what was asked about still stands to lose
  // something real, and plans were left unasked. The ones worth most were
  // asked first, and those are the Grids in the fight; cover is somewhere
  // else. The board says who would SEE the unit in each Grid left (`seen`), and
  // the Grids fewest enemies would see are asked about next.
  if (c.skills.exposure && best.cost > DANGER) {
    const left = plans.filter((p) => !p.priced && sumOf(p) > worthOf(best!) + EXACT);
    const sight = left.length ? c.d.here?.().seen(c.me.uid, left.map((p) => p.at)) ?? [] : [];
    const hidden = left.map((p, i) => ({ p, eyes: sight[i]?.length ?? 0 })).sort((a, b) => a.eyes - b.eyes || sumOf(b.p) - sumOf(a.p)).slice(0, LIMITS.COVER);
    for (const { p } of hidden) {
      if (sumOf(p) <= worthOf(best) + EXACT) continue;
      price(p, sumOf(p) - worthOf(best));
      p.priced = true;
      if (worthOf(p) > worthOf(best) + EXACT) best = p;
      yield;
    }
  }
  return { best, stay, plans };
}
const bestPlan = (c: Ctx): { best: Plan; stay: Plan; plans: Plan[] } | null => finish(bestSteps(c));

// ITS WORKING, for whoever wants to see it (a probe; in time the reasons a
// player is shown): every plan it weighed for one activation, the best first,
// each with its terms. A plan whose cost was never asked (`priced` false) could
// not have won whatever the answer.
export interface Weighed {
  label: string; how: string; at: Grid; does: string;
  now: number; next: number; mission: number; shape: number; cost: number; risk: number; worth: number; priced: boolean;
}

// THE RACES FOR THE LOOSE BOXES as the Tactician reads them for the unit a
// question is about (`racesOf`, M11): for each Box id, the round each squad's
// soonest unit with a hand free could take it (null: none before the game
// ends), and the enemy unit that would. For the tests.
export function races(d: Decision, view: SeatView, weights: Partial<Weights> = {}): Record<string, { ours: number | null; theirs: number | null; by: number | null }> {
  const c = context(d, view, { ...TACTICIAN, ...weights }, SKILLS, newMemo());
  if (!c) return {};
  const fin = (n: number): number | null => (Number.isFinite(n) ? n : null);
  return Object.fromEntries([...racesOf(c)].map(([id, r]) => [id, { ours: fin(r.ours), theirs: fin(r.theirs), by: r.by }]));
}

// WHAT STANDING WHERE AN ANSWER LEAVES THE UNIT WOULD COST, asked with a
// budget as a plan is (`exposure`); null for staying where it stands. For the
// tests.
export function exposureAt(d: Decision, view: SeatView, optionId: string | null, budget = Infinity, skills: Partial<Skills> = {}, weights: Partial<Weights> = {}): { cost: number; partial: boolean } | null {
  const c = context(d, view, { ...TACTICIAN, ...weights }, { ...SKILLS, ...skills }, newMemo());
  if (!c) return null;
  const o = optionId ? d.options.find((x) => x.id === optionId) : undefined;
  const harm = exposure(o ? o.after?.() : d.here?.(), (o ? endOf(o) : null) ?? c.me.grid, c, budget);
  return { cost: harm.cost, partial: !!harm.partial };
}

export function weighed(d: Decision, view: SeatView, skills: Partial<Skills> = {}, weights: Partial<Weights> = {}): Weighed[] {
  const c = context(d, view, { ...TACTICIAN, ...weights }, { ...SKILLS, ...skills }, newMemo());
  // A Reveal: each Grid the unit may appear in, as it was weighed.
  if (c && d.kind === 'reveal.make') {
    return finish(spotsSteps(d, c))
      .map((x) => ({
        label: x.o.label, how: x.o.tags.includes('stay') ? 'stay' : 'appear', at: x.at, does: '',
        now: 0, next: x.next, mission: 0, shape: x.shape, cost: x.harm.cost, risk: x.harm.risk, worth: x.value, priced: true,
      }))
      .sort((a, b) => b.worth - a.worth);
  }
  const found = c ? bestPlan(c) : null;
  if (!found) return [];
  return found.plans
    .map((p) => ({
      label: p.option ? `${p.option.label}${p.via ? `, then ${p.via.label}` : ''}` : 'stay', how: p.how, at: p.at, does: p.deed?.why ?? '',
      now: p.now, next: p.next, mission: p.mission, shape: p.shape, cost: p.cost, risk: p.risk,
      worth: p.priced ? worthOf(p) : sumOf(p), priced: !!p.priced,
    }))
    .sort((a, b) => Number(b.priced) - Number(a.priced) || b.worth - a.worth);
}

// Why a plan was chosen, as a rule's name: its largest term.
function reasonOf(p: Plan, stay: Plan): string {
  if (!p.option) return p.deed?.reason ?? 'end_activation';
  if (p.how !== 'move') {
    return p.how === 'stance' ? 'stance_by_value' : p.how === 'charge' ? 'charge_for_attack' : p.how === 'screen' ? 'smoke_for_cover'
      : p.how === 'token' ? (p.option?.tags.includes('token:camouflage') ? 'cloak' : highlights(p.option) ? 'draw_fire' : 'low_profile') : p.how === 'mode' ? 'mode_by_value'
        : p.how === 'tactic' ? 'tactic_by_value' : 'clear_token';
  }
  const safer = stay.cost - p.cost;
  const terms: [string, number][] = [
    ['advance', EXACT], ['move_to_attack', p.now], ['move_to_strike_next', p.next], ['take_zone', p.mission], ['take_cover', safer],
  ];
  return terms.reduce((a, b) => (b[1] > a[1] + EXACT ? b : a))[0];
}

const told = (p: Plan): string =>
  `worth ${worthOf(p).toFixed(2)} (now ${p.now.toFixed(2)}, next ${p.next.toFixed(2)}, mission ${p.mission.toFixed(2)}, cost ${p.cost.toFixed(2)}${p.risk > 0.005 ? `, ${percent(p.risk)} to be lost` : ''})`;

function context(d: Decision, view: SeatView, w: Weights, skills: Skills, memo: Memo): Ctx | null {
  const me = unitOf(view, d.unit);
  if (!me) return null;
  const table = tableOf(view, skills.carded);
  if (memo.table !== table) {
    memo.table = table;
    memo.harms.clear();
    memo.nexts.clear();
    memo.firepower.clear();
    memo.walks.clear();
    memo.targets.clear();
    memo.holdings.clear();
    memo.handed.clear();
    memo.aims.clear();
    memo.races.map = null;
    memo.backs.map = null;
  }
  return {
    // A Projectile is there to be spent: nothing done to it is a loss.
    d, view, me, w, skills: me.kind === 'projectile' ? { ...skills, exposure: false } : skills,
    foes: foesOf(view),
    hostile: view.units.filter((u) => u.side !== view.seat && u.deployed && u.alive),
    hidden: skills.stalk ? foesOf(view).filter((f) => f.camouflaged).map((f) => ({ ...f, camouflaged: false })) : [],
    mission: skills.mission ? missionOf(view, w) : 0,
    margin: skills.mission && w.stakes ? marginOf(view, w) : 0,
    behind: skills.mission && w.press > 0 ? behindNow(view, w) : false,
    soon: d.kind === 'setup.deploy',
    firepower: memo.firepower,
    harms: memo.harms,
    nexts: memo.nexts,
    walks: memo.walks,
    targets: memo.targets,
    holdings: memo.holdings,
    handed: memo.handed,
    aims: memo.aims,
    races: memo.races,
    backs: memo.backs,
  };
}

// WHAT A COMMAND WOULD ADD TO A DRONE: its best plan with the Command, over
// its doing nothing at all, which is what it does without one (it neither
// moves nor performs a Command Action; what it does of itself in the Automatic
// Phase it does either way). Null where the Drone would not be asked anything.
function* commandGain(o: Option, view: SeatView, w: Weights, skills: Skills, memo: Memo): Steps<number | null> {
  const turn = o.then?.();
  const c = turn ? context(turn, view, w, skills, memo) : null;
  const found = c ? yield* bestSteps(c) : null;
  return found ? worthOf(found.best) - (worthOf(found.stay) - found.stay.now) : null;
}

// A COMMAND COORDINATION (4.15.3) is a Command given in the middle of the
// Mech's own turn: the Drone it is handed to acts at once. It costs the Mech a
// Command Token it kept and no Tick, and the chance is gone once the Mech does
// anything else, so it is weighed before the rest of the Opportunity is: it
// goes to the Drone that gains most by acting now, and where none would gain
// the Token is kept. (The Tactic that IS a Coordination costs its Ticks, and
// is weighed as a deed beside an attack: `handOff`.)
function* coordination(d: Decision, view: SeatView, w: Weights, skills: Skills, memo: Memo): Steps<Choice | null> {
  let best: { o: Option; gain: number } | null = null;
  for (const o of d.options) {
    if (kindOf(o) !== 'coordinate' || o.tags.includes('action')) continue;
    const gain = yield* commandGain(o, view, w, skills, memo);
    yield;
    if (gain !== null && gain > EXACT && (!best || gain > best.gain + EXACT)) best = { o, gain };
  }
  return best ? { option: best.o.id, reason: 'coordinate_by_value', score: best.gain, why: `${best.o.label}: it gains ${best.gain.toFixed(2)} by acting now` } : null;
}

// A UNIT'S ACTIVATION, one answer at a time: it is asked again after each.
function* activation(d: Decision, view: SeatView, w: Weights, skills: Skills, memo: Memo): Steps<Choice | null> {
  if (skills.coordinate) {
    const handed = yield* coordination(d, view, w, skills, memo);
    if (handed) return handed;
  }
  const c = context(d, view, w, skills, memo);
  if (!c) return null;
  const found = yield* bestSteps(c);
  if (!found) return null;
  if (skills.ticks) {
    const bought = yield* buyTick(d, view, w, skills, memo, found);
    if (bought) return bought;
  }
  const { best, stay } = found;
  if (best.option) {
    const then = best.via ? `and then ${best.via.label}; ` : '';
    return { option: best.option.id, reason: reasonOf(best, stay), score: worthOf(best), why: `${then}${best.deed ? `from there, ${best.deed.why}; ` : ''}${told(best)}` };
  }
  if (best.deed) return { option: best.deed.option.id, reason: best.deed.reason, score: best.deed.value, why: `${best.deed.why}; ${told(best)}` };
  // Nothing to do and nowhere better to be. A Projectile's own Delayed Action
  // with nothing to take is resolved; Link is restored; the activation ends.
  const spent = d.options.find((o) => kindOf(o) === 'detonate' && !o.run);
  if (spent) return { option: spent.id, reason: 'delayed_action', why: 'a Projectile resolves its Delayed Action' };
  if (c.me.link !== undefined && c.me.linkMax !== undefined && c.me.link < c.me.linkMax) {
    const link = d.options.find((o) => o.tags.includes('restore-link'));
    if (link) return { option: link.id, reason: 'restore_link', score: w.restore, why: 'restoring Link' };
  }
  // A Black Box in its Grid is picked up as the activation ends.
  const take = skills.mission ? d.options.find((o) => o.tags.includes('end') && o.tags.includes('take')) : undefined;
  if (take) return { option: take.id, reason: 'take_box', score: best.mission, why: `a Black Box underfoot; ${told(best)}` };
  const end = d.options.find((o) => o.tags.includes('end'));
  return end ? { option: end.id, reason: 'end_activation', why: `nothing better to do; ${told(best)}` } : null;
}

// AN ACTION TICK BOUGHT (M7.6; FAQ L2): a pilot's Link for a Tick, an
// Overloading Pack's Link for Ticks, a Part's Tick for the Stance it asks. Each
// is weighed by the turn it opens: the best plan of the Opportunity with the
// Tick (the question the Mech would be asked once it is bought, planned as this
// one was) over the best plan without it, less the Link it costs at `link`. The
// Stance two of them fix is in the plan they lead to, which can no longer
// change it. Bought first, before anything is done with the Ticks there are.
function* buyTick(d: Decision, view: SeatView, w: Weights, skills: Skills, memo: Memo, now: { best: Plan }): Steps<Choice | null> {
  let best: { o: Option; gain: number } | null = null;
  for (const o of d.options) {
    if (kindOf(o) !== 'tick' || !o.then || (o.tags.includes('firewatch') && !skills.firewatch)) continue;
    const turn = o.then();
    const c = turn ? context(turn, view, w, skills, memo) : null;
    const found = c ? yield* bestSteps(c) : null;
    yield;
    if (!found) continue;
    // FIREWATCH: a Command Token, which the best plan's first Action may then
    // hand to a Drone (a Command Coordination): what the Drone best served
    // would gain by acting at once, as `coordination` reckons it when the
    // Coordination is offered; less what the Tokens the Mech already holds
    // would buy after the best plan without it. A Mech that holds one already
    // has that Coordination either way.
    let handed = 0;
    if (o.tags.includes('firewatch')) {
      handed = (yield* coordinated(found.best.deed, view, w, skills, memo)) - (yield* coordinated(now.best.deed, view, w, skills, memo));
    }
    const link = o.tags.includes('attackMode') ? 0 : w.link;
    const gain = worthOf(found.best) - worthOf(now.best) + handed - link;
    if (gain > EXACT && (!best || gain > best.gain + EXACT)) best = { o, gain };
  }
  return best ? { option: best.o.id, reason: 'tick_by_value', score: best.gain, why: `${best.o.label}: the turn it opens is worth ${best.gain.toFixed(2)} more` } : null;
}

// WHAT A COMMAND COORDINATION AFTER A DEED WOULD BUY: of the Coordinations the
// table offers once the deed is made, the Drone best served's gain by acting at
// once (`commandGain`); nothing where none is offered.
function* coordinated(deed: Deed | null | undefined, view: SeatView, w: Weights, skills: Skills, memo: Memo): Steps<number> {
  let top = 0;
  for (const x of deed?.option.then?.()?.options ?? []) {
    if (kindOf(x) !== 'coordinate' || x.tags.includes('action')) continue;
    const g = yield* commandGain(x, view, w, skills, memo);
    yield;
    if (g !== null && g > top) top = g;
  }
  return top;
}

// A DETONATION OWED (a Mine under a unit, a Grenade that has landed, a Pholcus
// that must go off): where its card takes one unit, the one worth most to
// take, an enemy before any of its own; where it takes every unit in Range
// none may be left out, and the one worth most goes first.
function detonation(d: Decision, view: SeatView, w: Weights, skills: Skills, memo: Memo): Choice | null {
  const c = context(d, view, w, skills, memo);
  if (!c) return null;
  let best: { o: Option; value: number } | null = null;
  for (const o of d.options) {
    if (!isShot(o)) continue;
    const value = o.tags.includes('ally') ? -ownLoss(o, c) : shotValue(o, c).value;
    if (!best || value > best.value + EXACT) best = { o, value };
  }
  return best ? { option: best.o.id, reason: 'blast_by_value', score: best.value, why: `${best.o.label}: worth ${best.value.toFixed(2)}` } : null;
}

// A REACTION OWED. A Riposte is taken: it ends the attacker's Opportunity and
// costs nothing, and of the blows it may strike the one worth most is struck.
// Emergency Smoke is taken where it lowers what standing there costs: each
// placement on offer is asked what the other squad could still do to the unit
// behind it (`exposure`, on the table that answer leaves), and the best of them
// is taken if it beats declining by more than the use is worth keeping. A
// Defense Reaction and Target Tracing are left to the answer that is safe.
const SMOKE_WORTH = 0.1;

function* reaction(d: Decision, view: SeatView, w: Weights, skills: Skills, memo: Memo): Steps<Choice | null> {
  if (d.facts.reaction === 'control') return skills.steer ? yield* steer(d, view, w, skills, memo) : null;
  if (d.facts.reaction !== 'riposte' && d.facts.reaction !== 'smoke' && d.facts.reaction !== 'scanAttack' && d.facts.reaction !== 'overwatch') return null;
  const c = context(d, view, w, skills, memo);
  if (!c) return null;
  // The attack behind a won Scan is paid for: where it can still be made on
  // the unit that has appeared, it is made.
  if (d.facts.reaction === 'scanAttack') {
    const shot = d.options.find((o) => isShot(o));
    return shot ? { option: shot.id, reason: 'attack_revealed', score: shotValue(shot, c).value, why: `${shot.label} (${said(shot.chance?.() ?? null)})` } : null;
  }
  // The Firing Action an Overwatch Strike owes costs nothing: the one worth
  // most is made, and none where none is worth anything.
  if (d.facts.reaction === 'overwatch') {
    let best: { o: Option; value: number } | null = null;
    for (const o of d.options) {
      if (!isShot(o)) continue;
      const value = shotValue(o, c).value;
      if (!best || value > best.value + EXACT) best = { o, value };
    }
    if (best && best.value > EXACT) return { option: best.o.id, reason: 'overwatch_shot', score: best.value, why: `${best.o.label} (${said(best.o.chance?.() ?? null)})` };
    const skip = d.options.find((o) => o.tags.includes('decline'));
    return skip ? { option: skip.id, reason: 'overwatch_skipped', why: 'no shot worth making' } : null;
  }
  if (d.facts.reaction === 'riposte') {
    let best: { o: Option; value: number } | null = null;
    for (const o of d.options) {
      if (!isShot(o)) continue;
      const value = shotValue(o, c).value;
      if (!best || value > best.value + EXACT) best = { o, value };
    }
    if (best) return { option: best.o.id, reason: 'riposte_by_value', score: best.value, why: `${best.o.label}; the attacker's Opportunity ends` };
    const end = d.options.find((o) => o.id === 'riposte:end');
    return end ? { option: end.id, reason: 'riposte_ends_turn', why: 'no blow to strike, and the attacker\'s Opportunity ends' } : null;
  }
  if (!skills.exposure || !skills.emergency) return null;
  const decline = d.options.find((o) => o.tags.includes('decline'));
  const bare = exposure(d.here?.(), c.me.grid, c).cost;
  yield;
  let best: { o: Option; cost: number } | null = null;
  for (const o of d.options) {
    if (!o.tags.includes('smoke') || !o.after) continue;
    const cost: number = exposure(o.after(), c.me.grid, c, best ? best.cost : bare).cost;
    yield;
    // Of two placements that hide it as well, the one with fewer Screens.
    if (!best || cost < best.cost - EXACT) best = { o, cost };
  }
  if (best && bare - best.cost > SMOKE_WORTH) {
    return { option: best.o.id, reason: 'smoke_for_cover', score: bare - best.cost, why: `${best.o.label}: standing there costs ${best.cost.toFixed(2)} behind it, ${bare.toFixed(2)} without` };
  }
  return decline ? { option: decline.id, reason: 'smoke_kept', why: `no Screen is worth its one use (standing there costs ${bare.toFixed(2)})` } : null;
}

// A SMOKE SCREEN TO GIVE UP as a round ends: one no unit of the squad stands
// in, and of those the one furthest from any of them. The Screens that hide
// somebody are the ones kept.
function thin(d: Decision, view: SeatView): Choice | null {
  const mine = view.units.filter((u) => u.side === view.seat && u.alive && u.deployed && u.kind !== 'projectile');
  let best: { o: Option; empty: boolean; far: number } | null = null;
  for (const o of d.options) {
    const cell = o.facts?.cell as { c: number; r: number } | undefined;
    if (!cell) continue;
    const at = { col: cell.c, row: cell.r };
    const far = mine.length ? Math.min(...mine.map((u) => apart(u.grid, at))) : 0;
    const empty = far > 0;
    if (!best || (empty && !best.empty) || (empty === best.empty && far > best.far)) best = { o, empty, far };
  }
  return best ? { option: best.o.id, reason: 'thin_smoke', why: best.empty ? 'the Screen furthest from its own units' : 'every Screen left hides one of its own' } : null;
}

// A COMMAND goes to the Drone it does most for: the one whose best plan beats
// its staying put by most. Where no Drone would gain by it, none is given.
function* command(d: Decision, view: SeatView, w: Weights, skills: Skills, memo: Memo): Steps<Choice | null> {
  let best: { o: Option; gain: number } | null = null;
  for (const o of d.options) {
    if (!o.tags.includes('designate') || !o.then) continue;
    const turn = o.then();
    const c = turn ? context(turn, view, w, skills, memo) : null;
    const found = c ? yield* bestSteps(c) : null;
    yield;
    if (!found) continue;
    // What the Command adds: its best plan over what the unit does with no
    // Command. WITH NO COMMAND IT DOES NOTHING: it neither moves nor performs
    // a Command Action, so the Action its plan makes where it stands (a GoF
    // Drone's gun is a Command Action) is the Command's doing too (`orders`).
    // Until 2026-10-02 the plan of staying was taken whole for what it does
    // unbidden, deed and all, and no Command was ever given to fire from
    // where a Drone stood.
    if (!skills.orders && !found.best.option) continue;
    const gain = worthOf(found.best) - worthOf(found.stay) + (skills.orders ? found.stay.now : 0);
    if (gain > EXACT && (!best || gain > best.gain + EXACT)) best = { o, gain };
  }
  if (best) return { option: best.o.id, reason: 'command_by_value', score: best.gain, why: `the Command that does most (${best.gain.toFixed(2)})` };
  const pass = d.options.find((o) => o.tags.includes('pass'));
  return pass ? { option: pass.id, reason: 'command_withheld', why: 'no Drone gains by a Command' } : null;
}

// The Action a plan starts with, if it starts with one: a Movement Action it
// moves by, or, behind a Maneuver, a Stance or nothing at all, the Movement
// Action that follows it or the first thing it does where it ends.
function startOf(p: Plan): Option | null {
  if (p.option && typeof p.option.facts?.actionId === 'string') return p.option;
  return p.via ?? p.deed?.option ?? null;
}

// THE TIMING DIAL: the Timing whose Opportunity opens the plan worth most, on
// the board as it stands. Each Timing something of the Mech's is played on is
// asked for the whole of what it would offer (`then` on a dial), and that is
// planned as the Opportunity itself will be. Acting sooner is worth a little
// by itself, so of two plans worth the same the earlier Timing is taken: an
// attack made first is made before the Part it would destroy has fired.
//
// AND A DIAL IS CHARGED FOR WHO ACTS BEFORE IT. A plan is priced for where it
// ends; an enemy Mech whose turn comes first attacks the Mech where it stands
// NOW, whatever it meant to do afterwards. The other squad's dials are not
// known, so each enemy Mech that could attack it here is taken to act on the
// Timing of that attack, and a tie to go against this Mech. A Mech standing in
// a line of fire therefore sets a dial that comes before the guns on it.
function* dial(d: Decision, view: SeatView, w: Weights, skills: Skills, memo: Memo): Steps<Choice | null> {
  const me = unitOf(view, d.unit);
  if (!me) return null;
  // The order the Timings are played in is the order the dials are offered in.
  const order = new Map(d.options.map((o, i) => [o.tags.find((t) => t.startsWith('timing:'))?.slice(7) ?? '', i]));
  // EVERY Timing may be asked what it would open, not only the ones the Mech's
  // own Actions are printed with: a dial may open the Actions of the Timing
  // beside it (a gun fired on a Projectile dial is fired before the guns on a
  // Firing one). Each is planned for itself: two Timings that open the same
  // answers still differ in what follows them (a Maneuver that ends beside an
  // enemy leaves a Melee dial its Punch, and a Swift dial nothing).
  // On a Terminals mission every Mech has a Tactical Action besides: the Remote
  // Access.
  const played = w.dialAll > 0 ? null : new Set<string>([
    'melee', 'movement', ...(view.task?.family === 'terminal' ? ['tactical'] : []), ...me.weapons.filter(ready).map((x) => x.timing ?? ''),
  ]);
  let best: { o: Option; value: number; plan: Plan } | null = null;
  const holding: { o: Option; value: number; plan: Plan; timing: string; c: Ctx }[] = [];
  for (const [i, o] of d.options.entries()) {
    const timing = o.tags.find((t) => t.startsWith('timing:'))?.slice(7);
    if (!timing || !o.then || (played && !played.has(timing))) continue;
    const turn = o.then();
    const c = turn ? context(turn, view, w, skills, memo) : null;
    const found = c ? yield* bestSteps(c) : null;
    yield;
    if (!found || !c) continue;
    // What standing where it is costs, by the enemy it is owed to: those that
    // would act first are paid before this dial's plan begins.
    const here = c.harms.get(harmKey(c, me.grid, ''));
    const sooner = (x: { timing: string }): boolean => (order.get(x.timing) ?? Infinity) <= i;
    const first = (here?.by ?? []).filter(sooner).reduce((n, x) => n + x.cost, 0);
    // And where the plan ends, an enemy that has already acted is a round
    // away: what the plan was charged for it in full is given back in part,
    // so that each enemy is charged for acting once.
    const there = c.harms.get(harmKey(c, found.best.at, found.best.how === 'stance' ? String(found.best.option?.id) : '', found.best.option));
    const again = (there?.by ?? []).filter(sooner).reduce((n, x) => n + x.cost, 0);
    const back = w.exposure > 0 ? again * (1 - w.exposureLater / w.exposure) : 0;
    // A PLAN THAT BORROWS ITS TIMING. The first Action of an Opportunity must
    // be of the dial's own Timing (3.4.3) unless something lends the Timing
    // beside it: an ally's aura, while the ally stands near. The engine says
    // what a dial would open on the board AS IT STANDS; the lender may have
    // walked off by the time the Opportunity comes, and the plan with it (the
    // Mire set to Firing to Sprint, and the Dune gone from beside it). So a
    // plan that starts on its dial's own Timing is worth a little more than
    // the same plan started on a borrowed one.
    const opens = startOf(found.best);
    const own = opens ? me.weapons.find((x) => x.actionId === opens.facts?.actionId)?.timing : undefined;
    const lent = own !== undefined && own !== timing ? w.borrowed : 0;
    // AN ATTACK ON A MECH THAT MAY ACT FIRST (`dialDoubt`): it may walk out of
    // the line before this Timing comes, the more likely the more Timings come
    // before this one.
    const aim = w.dialDoubt > 0 ? found.best.deed : null;
    const prey = aim ? unitOf(view, aim.option.facts?.targetUid) : undefined;
    const doubt = aim && prey?.kind === 'mech' && prey.side !== view.seat && !prey.done && stride(prey) > 0 ? w.dialDoubt * (i / d.options.length) * Math.max(0, aim.value) : 0;
    const value = worthOf(found.best) - first + back + w.tempo * (d.options.length - i) - lent - doubt;
    if (!best || value > best.value + EXACT) best = { o, value, plan: found.best };
    if (w.cover > 0 && !found.best.option && !found.best.deed) holding.push({ o, value, plan: found.best, timing, c });
  }
  if (!best) return null;
  // A DIAL FOR HOLDING (`cover`): where the plan worth most holds and does
  // nothing, of the Timings whose plans hold too, the one whose weapons are
  // kept for most of the enemies that could walk into them this round.
  if (w.cover > 0 && !best.plan.option && !best.plan.deed) {
    let top: typeof best | null = null;
    for (const h of holding) {
      const value = h.value + w.cover * coverOf(me, h.timing, h.c);
      if (!top || value > top.value + EXACT) top = { o: h.o, value, plan: h.plan };
    }
    if (top) best = top;
  }
  const opens = best.plan.option ? best.plan.option.label : best.plan.deed ? best.plan.deed.option.label : 'holding where it is';
  return { option: best.o.id, reason: 'dial_by_plan', score: best.value, why: `it opens with ${opens}; ${told(best.plan)}` };
}

// The enemies a Timing would keep a weapon for (`cover`): each one out of the
// Range of every ready gun or blade of the Mech's played on that Timing, that
// could walk into one of them this round (its stride, `stride`).
function coverOf(me: UnitView, timing: string, c: Ctx): number {
  const arms = me.weapons.filter((x) => ready(x) && x.timing === timing && (x.type === 'Firing' || x.type === 'Melee'));
  if (!arms.length) return 0;
  return c.foes.filter((f) => !f.done && !arms.some((x) => reaches(x, me.grid, f.grid))
    && arms.some((x) => apart(me.grid, f.grid) - stride(f) <= Math.max(1, x.range))).length;
}

// THE COMMANDER (a VIP mission): the Mech that can do most from furthest
// back, which is the one with the longest arm; and of two that reach as far,
// the one whose Torso is hardest to destroy, since the Torso is the Commander.
function leader(d: Decision, view: SeatView): Choice | null {
  let best: { o: Option; arm: number; torso: number } | null = null;
  for (const o of d.options) {
    const u = o.id.startsWith('mech:') ? unitOf(view, Number(o.id.slice(5))) : undefined;
    if (!u) continue;
    const torso = u.parts.find((p) => p.slot === 'torso');
    const mine = { o, arm: armOf(u), torso: (torso?.armor ?? 0) + (torso?.structure ?? 0) };
    if (!best || mine.arm > best.arm || (mine.arm === best.arm && mine.torso > best.torso)) best = mine;
  }
  return best ? { option: best.o.id, reason: 'commander_by_reach', why: `the longest arm (${best.arm}) and the hardest Torso to destroy` } : null;
}

// DEPLOYMENT, a unit at a time and the one that matters least first, so that
// the units that matter most are put down with more of the other squad on the
// board. Each Grid of the Deployment Zone is weighed as a plan is: what the
// unit could do from it at its first turn, which way it has to walk, and what
// the enemy already down could do to it there. A Commander is also kept out of
// the lanes: each Grid of the other squad's Deployment Zone that would see it
// counts against a Grid, whoever comes to stand there.
function* deploy(d: Decision, view: SeatView, w: Weights, skills: Skills, memo: Memo): Steps<Choice | null> {
  const uids = [...new Set(d.options.map((o) => o.facts?.uid).filter((x): x is number => typeof x === 'number'))];
  const all = uids.map((uid) => unitOf(view, uid)).filter((u): u is UnitView => !!u);
  if (!all.length) return null;
  // A Drone with a Load to lend is set down after the Mechs it could lend it
  // to, so that it can be set down against one (`lend`): the cheapest unit
  // first put it down first, before there was a Mech to stand by.
  const waiting = w.lend > 0 && view.units.some((u) => u.side === view.seat && u.kind === 'mech' && !u.deployed);
  const units = waiting && all.some((u) => !u.lends) ? all.filter((u) => !u.lends) : all;
  const me = units.reduce((a, b) => (unitWorth(b, view, w) < unitWorth(a, view, w) - EXACT ? b : a));
  const c = context({ ...d, unit: me.uid }, view, w, skills, memo);
  if (!c) return null;
  const loan = me.lends && w.lend > 0 ? lender(c) : null;
  // The answer that sets a Load down against a Mech is weighed only where a
  // Load lent is worth something.
  const mine = d.options.filter((o) => o.facts?.uid === me.uid && (o.facts?.stance === undefined || o.facts.stance === 'offensive') && !!endOf(o) && (!o.tags.includes('lend') || !!loan));
  if (!mine.length) return null;
  const quarry = quarryOf(c);
  const cell = (ref: string): Grid => { const [col, row] = ref.split(',').map(Number); return { col, row }; };
  const lanes = me.commander && view.task?.family === 'vip'
    ? d.here?.().seen(me.uid, mine.map((o) => endOf(o) as Grid), ((d.facts.foeZone as string[] | undefined) ?? []).map(cell)) ?? []
    : [];
  const timings: (string | undefined)[] = me.kind === 'mech' ? [...new Set(strikers(me).map((x) => x.timing))] : [undefined];
  let best: { o: Option; value: number } | null = null;
  for (const [i, o] of mine.entries()) {
    const at = endOf(o) as Grid;
    const out = o.after?.();
    let next = 0;
    if (out && c.foes.length && claimAt(at, facingOf(o) ?? 0, c) >= 1) {
      for (const timing of timings) next = Math.max(next, deedAt(out.turnOf(me.uid, DEEDS, timing)?.options ?? [], c, false)?.value ?? 0);
    }
    const harm = skills.exposure ? exposure(out, at, c) : UNHARMED;
    // A Load lent from there to the Mechs it would touch. Before an enemy is in
    // reach of them the engine cannot say what it adds, and the spot against
    // a Mech is then the tie-break (`LEND_TIE` of `lend`).
    const lending = loan ? Math.max(loan(out, at), o.facts?.lendsTo !== undefined ? w.lend * LEND_TIE : 0) : 0;
    const value = (next + lending) * w.future * (1 - harm.risk) - harm.cost + shapeAt(at, c, quarry) - w.lane * (lanes[i]?.length ?? 0);
    if (!best || value > best.value + EXACT) best = { o, value };
    yield;
  }
  return best ? { option: best.o.id, reason: 'deploy_by_value', score: best.value, why: `the Grid of its zone worth most to stand in (${best.value.toFixed(2)})` } : null;
}

// WHERE A UNIT APPEARS AS IT IS REVEALED (4.12.2): where it stands, or any Grid
// within its Stealth value of there that it fits in. Each is weighed as a Grid
// to deploy in is: what the Main Task makes of standing there, what it could
// do from it at its next turn, and what the enemy could do to it there, seen.
// Of two worth the same it stays where it is.
interface Spot { o: Option; at: Grid; next: number; harm: Harm; shape: number; value: number }

function* spotsSteps(d: Decision, c: Ctx): Steps<Spot[]> {
  const me = c.me;
  const quarry = quarryOf(c);
  const timings: (string | undefined)[] = me.kind === 'mech' ? [...new Set(strikers(me).map((x) => x.timing))] : [undefined];
  const spots: Spot[] = [];
  // The answer that stays first, so that a Grid must be better to be taken.
  const order = [...d.options].sort((a, b) => Number(b.tags.includes('stay')) - Number(a.tags.includes('stay')));
  for (const o of order) {
    const at = endOf(o);
    if (!at || !o.tags.includes('reveal')) continue;
    const out = o.after?.();
    let next = 0;
    if (out && c.foes.length && claimAt(at, me.facing, c) >= 1) {
      for (const timing of timings) next = Math.max(next, deedAt(out.turnOf(me.uid, DEEDS, timing)?.options ?? [], c, false)?.value ?? 0);
    }
    const harm = c.skills.exposure ? exposure(out, at, c) : UNHARMED;
    const shape = shapeAt(at, c, quarry);
    spots.push({ o, at, next, harm, shape, value: next * c.w.future * (1 - harm.risk) - harm.cost + shape });
    yield;
  }
  return spots;
}

function* appear(d: Decision, view: SeatView, w: Weights, skills: Skills, memo: Memo): Steps<Choice | null> {
  const c = context(d, view, w, skills, memo);
  if (!c) return null;
  let best: Spot | null = null;
  for (const spot of yield* spotsSteps(d, c)) if (!best || spot.value > best.value + EXACT) best = spot;
  return best ? { option: best.o.id, reason: best.o.tags.includes('stay') ? 'reveal_in_place' : 'appear_by_value', score: best.value, why: `${best.o.label}: the Grid in reach worth most to stand in (${best.value.toFixed(2)})` } : null;
}

// A FOCUS, by what the reroll it buys is worth. One somebody else pays for is
// taken whenever it helps at all. One paid for in Link is taken when the best
// reroll moves the attack's worth, the owner's way, by more than a Link is
// worth; and never with the pilot's last Link but one. The Brawler asks for
// one chance in four of turning the roll, whatever turning it would do.
function focus(d: Decision, view: SeatView, w: Weights, worth: Worth | undefined): Choice | null {
  const pass = d.options.find((o) => o.id === 'focus.pass');
  const base = pass?.chance?.();
  if (!pass || !base || !worth) return null;
  const mine = attacking(d);
  // A defence counts a Part only Damaged at `focusDamaged` of its usual cost:
  // it still works, and a Link is not there for the next roll (OTTO's
  // playtest, 2026-10-03). Every other question weighs it in full.
  const target = unitOf(view, d.facts.targetUid);
  const weigh: Worth = !mine && w.focusDamaged !== 1 && target ? (f) => gainOf(f, target, view, { ...w, damaged: w.damaged * w.focusDamaged }) : worth;
  const adds = (o: Option | undefined): number => {
    const f = o?.chance?.();
    return f ? (mine ? weigh(f) - weigh(base) : weigh(base) - weigh(f)) : 0;
  };
  const free = d.options.find((o) => o.tags.includes('focus') && o.tags.includes('free'));
  if (free && adds(free) > EXACT) return { option: free.id, reason: 'free_reroll', score: adds(free), why: 'a reroll that costs nothing' };
  const paid = d.options.find((o) => o.id === 'focus.use');
  const link = unitOf(view, d.unit)?.link ?? 0;
  // The Link it costs: more when it leaves the Mech one Link from Shutdown.
  const price = w.focus * (link - 1 <= 1 ? 1 + w.focusLow : 1);
  if (paid && link >= 2 && adds(paid) > price) {
    return { option: paid.id, reason: 'focus_by_value', score: adds(paid), why: `a reroll worth ${adds(paid).toFixed(2)}, for a Link` };
  }
  return { option: pass.id, reason: 'skip_reroll', score: adds(paid), why: 'no reroll worth a Link' };
}

// A FOCUS IN AN ELECTRONIC COUNTER-ROLL (`ewFocus`). Both hands are in when
// it is declared (FAQ G4), and the question says what each side has rolled
// (`botcontest.ts`). Rerolling the dice that count nothing for this side can
// only better its hand: declared where those dice, thrown again, would turn a
// roll this side is losing into one it wins at least 0.25 / `ewFocus` of the
// time (the other side's hand as it lies: it may Focus too, which this does
// not try to read). Paid in Link where the pilot keeps two (as an attack's
// Focus is), else on a Whistle's Command Token; a free one wherever it helps.
// A roll already won is let lie.
type Count = { lightning: number; light: number };
function counterWins(mine: Count, theirs: Count, initiator: boolean): boolean {
  const init = initiator ? mine : theirs;
  const resp = initiator ? theirs : mine;
  const initWins = init.lightning !== resp.lightning ? init.lightning > resp.lightning : init.light !== resp.light ? init.light > resp.light : true;
  return initiator ? initWins : !initWins;
}
// The chance this side wins with its blank dice thrown again: each die one of
// the faces, alike likely, adding what that face counts for it.
function rerollWins(mine: Count, theirs: Count, initiator: boolean, blanks: number, faces: Count[]): number {
  let spread = new Map<string, number>([['0,0', 1]]);
  for (let i = 0; i < blanks; i++) {
    const next = new Map<string, number>();
    for (const [k, p] of spread) {
      const [l, h] = k.split(',').map(Number);
      for (const f of faces) {
        const key2 = `${l + f.lightning},${h + f.light}`;
        next.set(key2, (next.get(key2) ?? 0) + p / faces.length);
      }
    }
    spread = next;
  }
  let won = 0;
  for (const [k, p] of spread) {
    const [l, h] = k.split(',').map(Number);
    if (counterWins({ lightning: mine.lightning + l, light: mine.light + h }, theirs, initiator)) won += p;
  }
  return won;
}
function counterFocus(d: Decision, view: SeatView, w: Weights): Choice | null {
  const pass = d.options.find((o) => o.id === 'focus.pass');
  const mine = d.facts.mine as Count | undefined;
  const theirs = d.facts.theirs as Count | undefined;
  const blank = d.facts.blank as number[] | undefined;
  const faces = d.facts.faces as Count[] | undefined;
  if (!pass || !mine || !theirs || !blank || !faces?.length) return null;
  const initiator = d.facts.role === 'initiator';
  if (counterWins(mine, theirs, initiator)) return { option: pass.id, reason: 'skip_reroll', why: 'the roll is won as it lies' };
  const turns = blank.length ? rerollWins(mine, theirs, initiator, blank.length, faces) : 0;
  const use = d.options.find((o) => o.id === 'focus.use');
  const whistle = d.options.find((o) => o.id === 'focus.whistle');
  const link = unitOf(view, d.unit)?.link ?? 0;
  const free = use && /free/i.test(use.label);
  const why = `rerolling ${blank.length === 1 ? 'the die that counts' : `the ${blank.length} dice that count`} nothing wins ${percent(turns)} of the time`;
  if (turns * w.ewFocus >= 0.25 - EXACT || (free && turns > EXACT)) {
    if (use && (free || link >= 2)) return { option: use.id, reason: 'focus_by_value', score: turns, why: `${why}, for a Link` };
    if (whistle) return { option: whistle.id, reason: 'focus_by_value', score: turns, why: `${why}, on a Whistle's Command Token` };
  }
  return { option: pass.id, reason: 'skip_reroll', score: turns, why: `${why}: not worth a Link` };
}
// Its reroll, once declared: the dice that count nothing, and none else.
function counterReroll(d: Decision): Choice | null {
  const blanks = d.options.find((o) => o.id === 'reroll.blanks');
  if (blanks) return { option: blanks.id, reason: 'reroll_blanks', why: 'the dice that count nothing' };
  return null;
}

// WHERE A BLACK BOX IS PUT DOWN AT SETUP (`boxPlace`; 5.2.1: the squads take
// turns placing each Box anywhere in the Tactical Zone its Main Task names). A
// Box is a race to whoever reaches it first (M11), so of the Boxes this squad
// may place now and the Grids of their zones, the one furthest from where the
// other squad deploys for how near it is to where this one does (the seam says
// both, as it does for a deployment). Where none is better than another, where
// it stands. NOT where the Task pays only for a Box carried into one zone
// (Asset Preservation, Echo): a Box pulled toward this squad's edge is then
// further for anybody to carry home in time (measured: Key Facility 106 of 200
// head to head, Asset Preservation 93), and it is left where it stands.
function placeBox(d: Decision, view: SeatView): Choice | null {
  if (view.task?.scoringZone) return null;
  const ours = ((d.facts.zone as string[] | undefined) ?? []).map(cellOf);
  const theirs = ((d.facts.foeZone as string[] | undefined) ?? []).map(cellOf);
  if (!ours.length || !theirs.length) return null;
  const near = (g: Grid, zone: Grid[]): number => Math.min(...zone.map((z) => apart(g, z)));
  let best: { o: Option; score: number } | null = null;
  for (const o of d.options) {
    const at = o.facts?.at as { c: number; r: number } | undefined;
    if (!at) continue;
    const g = { col: at.c, row: at.r };
    const score = near(g, theirs) - near(g, ours);
    if (!best || score > best.score + EXACT) best = { o, score };
  }
  return best ? { option: best.o.id, reason: 'box_place', score: best.score, why: `${best.o.label}: ${best.score} Grids nearer this squad's Deployment Zone than the other's` } : null;
}

// WHERE A MINE IS LAID (006_A). A Mine goes off under the first Ground unit
// that enters its Grid, whoever's. Of the Grids the walk offers, one that an
// enemy stands nearer to than any unit of this squad does (the layer, which
// has walked on, apart), the nearest to an enemy first; none where every Grid
// is nearer this squad's own; and never the layer's own Grid, where it goes
// off at once.
function lay(d: Decision, view: SeatView): Choice | null {
  const none = d.options.find((o) => o.id === 'mine:none');
  const me = unitOf(view, d.unit);
  if (!none || !me) return null;
  const foes = view.units.filter((u) => u.side !== view.seat && u.deployed && u.alive && u.ground && u.kind !== 'projectile');
  const own = view.units.filter((u) => u.side === view.seat && u.deployed && u.alive && u.uid !== me.uid && u.kind !== 'projectile');
  let best: { o: Option; near: number; margin: number } | null = null;
  for (const o of d.options) {
    if (o.tags[0] !== 'mine' || o.tags.includes('none') || o.tags.includes('self')) continue;
    const at = endOf(o);
    if (!at || !foes.length) continue;
    const near = Math.min(...foes.map((f) => apart(at, f.grid)));
    // With no unit of its own left on the board but the layer, every Grid is
    // further from this squad than any board is wide.
    const ours = own.length ? Math.min(...own.map((u) => apart(at, u.grid))) : 99;
    const margin = ours - near;
    if (margin <= 0) continue;
    if (!best || near < best.near || (near === best.near && margin > best.margin)) best = { o, near, margin };
  }
  return best
    ? { option: best.o.id, reason: 'mine_toward_enemy', score: best.margin, why: `${best.o.label}: an enemy ${best.near} Grids off, this squad further` }
    : { option: none.id, reason: 'mine_kept', why: 'no Grid of the walk is nearer the enemy than this squad' };
}

// A MULTI-TARGET'S SPLIT (FAQ B7): the answer whose shares are worth most
// together, each share weighed as the window's other questions weigh a shot
// (what it is likely to do to the unit the dice land on). Begin, the whole
// pool on the target clicked, is one of the answers and keeps a tie. Worked
// a set of targets at a time, with a pause between.
function* spread(d: Decision, view: SeatView, w: Weights): Steps<Choice | null> {
  const begin = d.options.find((o) => o.id === 'split.begin');
  if (!begin?.shares) return null;
  const worth = (o: Option): number | null => {
    let sum = 0;
    for (const s of o.shares?.() ?? []) {
      const target = unitOf(view, s.targetUid);
      if (!target || !s.chance) return null;
      sum += gainOf(s.chance, target, view, w);
    }
    return sum;
  };
  const whole = worth(begin);
  if (whole === null) return null;
  let best = { o: begin, value: whole };
  let set = '';
  for (const o of d.options) {
    if (!o.tags.includes('split')) continue;
    const targets = (o.facts?.split as { uid: number }[] | undefined)?.map((s) => s.uid).join(',') ?? '';
    if (targets !== set) { set = targets; yield; }
    const value = worth(o);
    if (value !== null && value > best.value + EXACT) best = { o, value };
  }
  return best.o === begin
    ? { option: begin.id, reason: 'split_whole', score: whole, why: `the whole pool at one target is worth most (${whole.toFixed(2)})` }
    : { option: best.o.id, reason: 'split_by_value', score: best.value, why: `${best.o.label}: worth ${best.value.toFixed(2)} against ${whole.toFixed(2)} for the whole pool at one target` };
}

// THE RED SHOES (TM35NA_B, M8.2s): one of an enemy unit's own Movements, made
// by this seat. Each Grid it may be steered into is priced from this squad's
// side, as standing somewhere is priced for a unit of its own: what this
// squad's units could do to it there before the round is out (`exposure`, the
// enemy the unit standing there and this squad the units that could attack
// it), the Main Task as the board would read with it there, and a Mine it
// would set off. One answer a Grid, the facing that turns its back on this
// squad's nearest unit; the Grids most of this squad could reach are asked
// first. The Grid worth most is taken where it beats leaving the unit be.
function* steer(d: Decision, view: SeatView, w: Weights, skills: Skills, memo: Memo): Steps<Choice | null> {
  const base = context(d, view, w, skills, memo);
  const target = unitOf(view, d.facts.fromUid);
  const leave = d.options.find((o) => o.tags.includes('decline'));
  if (!base || !target || !leave) return null;
  const squad = view.units.filter((u) => u.side === view.seat && u.deployed && u.alive && u.kind !== 'projectile');
  const c: Ctx = { ...base, me: target, hostile: squad, foes: squad, hidden: [], harms: new Map(), nexts: new Map() };
  const stays = exposure(d.here?.(), target.grid, c).cost;
  yield;
  const nearest = (at: Grid): UnitView | null => (squad.length ? squad.reduce((a, b) => (apart(at, b.grid) < apart(at, a.grid) ? b : a)) : null);
  const ends = new Map<string, { o: Option; at: Grid; reach: number }>();
  for (const o of d.options) {
    const at = kindOf(o) === 'move' ? endOf(o) : null;
    const facing = facingOf(o);
    if (!at || facing === null) continue;
    const n = nearest(at);
    const away = n && !same(at, n.grid) ? (facingAt(at, n.grid) + 2) % 4 : facing;
    const held = ends.get(key(at));
    if (!held || (facing === away && facingOf(held.o) !== away)) ends.set(key(at), { o, at, reach: squad.filter((e) => inReachOf(e, at)).length });
  }
  let best: { o: Option; value: number } | null = null;
  for (const x of [...ends.values()].sort((a, b) => b.reach - a.reach).slice(0, LIMITS.PRICED + LIMITS.COVER)) {
    const out = x.o.after?.();
    if (!out) continue;
    const mission = skills.mission ? missionOf(out.view(), w) - c.mission : 0;
    const blast = mineCost(x.o, c);
    const harm = exposure(out, x.at, c);
    yield;
    const value = harm.cost + mission + blast - stays;
    if (!best || value > best.value + EXACT) best = { o: x.o, value };
  }
  if (!best || best.value <= EXACT) return { option: leave.id, reason: 'steer_left', why: 'nowhere it could be steered is worse for it than where it stands' };
  return { option: best.o.id, reason: 'steer_by_value', score: best.value, why: `${best.o.label}: worth ${best.value.toFixed(2)} more to this squad there` };
}

// A FORCED MOVEMENT THIS SEAT MAKES (Knockback X, Push X; M8.2t): which way
// the victim is left facing (3.4.4) is this seat's, and for a Push the line it
// is forced along. Each answer is priced as the Red Shoes price a Grid they
// steer an enemy into (`steer`): what this squad could do to the victim there
// before the round is out, the Main Task as the board would read with it
// there, a unit forced into an Abyss is a kill, and a Mech Pushed loses 1 Link
// (`link`). A Knockback's line is the rules', so its answers differ in the
// facing alone; the facing that turns the victim's back on this squad's
// nearest unit is asked first. Blocked, it is turned so where it stands, or
// left be. A SHOVE AFTER A MOVEMENT (M8.2u) may be made or not: each enemy in
// front is a victim of its own, and it is made only where it gains.
function* shove(d: Decision, view: SeatView, w: Weights, skills: Skills, memo: Memo): Steps<Choice | null> {
  const base = context(d, view, w, skills, memo);
  if (!base) return null;
  const squad = view.units.filter((u) => u.side === view.seat && u.deployed && u.alive && u.kind !== 'projectile');
  // What this squad could do to one victim, as `steer` asks it, kept for each.
  const ctxs = new Map<number, Ctx>();
  const ctxOf = (target: UnitView): Ctx => {
    let c = ctxs.get(target.uid);
    if (!c) ctxs.set(target.uid, c = { ...base, me: target, hostile: squad, foes: squad, hidden: [], harms: new Map(), nexts: new Map() });
    return c;
  };
  const victimOf = (o: Option): UnitView | undefined => unitOf(view, o.facts?.uid ?? d.facts.targetUid);
  // What standing where it is already costs a victim (as `steer` reads it): a
  // move is worth what it changes, which is what a shove that may be let go
  // by is weighed against.
  const stays = new Map<number, number>();
  const stayOf = (target: UnitView, c: Ctx): number => {
    let v = stays.get(target.uid);
    if (v === undefined) stays.set(target.uid, v = exposure(d.here?.(), target.grid, c).cost);
    return v;
  };
  const away = (at: Grid): number | null => {
    const n = squad.length ? squad.reduce((a, b) => (apart(at, b.grid) < apart(at, a.grid) ? b : a)) : null;
    return n && !same(at, n.grid) ? (facingAt(at, n.grid) + 2) % 4 : null;
  };
  const leave = d.options.find((o) => o.tags.includes('leave'));
  const made = d.options.filter((o) => o.tags.includes('shove') && !o.tags.includes('leave') && !o.tags.includes('turn') && !!endOf(o) && !!victimOf(o));
  if (!made.length) {
    const turned = d.options.find((o) => {
      const v = o.tags.includes('turn') ? victimOf(o) : undefined;
      return !!v && facingOf(o) === away(v.grid);
    });
    if (turned) return { option: turned.id, reason: 'shove_turned', why: `${turned.label}: its back to this squad` };
    return leave ? { option: leave.id, reason: 'shove_left', why: 'it cannot be moved, and turning it does no better' } : null;
  }
  const first = (o: Option): number => Number(facingOf(o) === away(endOf(o) as Grid));
  const asked = [...made].sort((a, b) => first(b) - first(a)).slice(0, LIMITS.PRICED + LIMITS.COVER);
  let best: { o: Option; value: number } | null = null;
  for (const o of asked) {
    const target = victimOf(o) as UnitView;
    const c = ctxOf(target);
    const out = o.after?.();
    if (!out) continue;
    const mission = skills.mission ? missionOf(out.view(), w) - c.mission : 0;
    const killed = o.tags.includes('kill') ? unitWorth(target, view, w) : 0;
    const link = w.link * Number(o.facts?.link ?? 0);
    const harm = exposure(out, endOf(o) as Grid, c);
    const before = stayOf(target, c);
    yield;
    const value = harm.cost - before + mission + killed + link;
    if (!best || value > best.value + EXACT) best = { o, value };
  }
  if (!best) return null;
  // A shove that may be let go by is made where it gains.
  if (d.facts.optional && leave && best.value <= EXACT) return { option: leave.id, reason: 'shove_left', why: `no shove gains anything (the best, ${best.value.toFixed(2)})` };
  return { option: best.o.id, reason: 'shove_by_value', score: best.value, why: `${best.o.label}: worth ${best.value.toFixed(2)} to this squad` };
}

// ---------- pilot traits (M8.2r) ----------

// ASTER: a Command Token turned into 1 Link on an Ally Mech, once a round. It is
// asked where `command` would pass, so no Drone gains by a Command now; and the
// Token is kept where Aster's own Mech could hand it to a Drone in the Action
// Phase (an Action of its own carries Command Coordination, and the squad has a
// Drone to give it to), unless it holds more Tokens than there are Drones. The
// Link goes to the Mech worth most of those short of one.
function aster(d: Decision, view: SeatView, w: Weights): Choice | null {
  const drones = view.units.filter((u) => u.side === view.seat && u.kind === 'drone' && u.alive && u.deployed).length;
  let best: { o: Option; worth: number } | null = null;
  for (const o of d.options) {
    if (kindOf(o) !== 'aster') continue;
    if (o.facts?.coordinates && drones > 0 && Number(o.facts?.held ?? 0) <= drones) continue;
    const u = unitOf(view, o.facts?.targetUid);
    const worth = u ? unitWorth(u, view, w) : 0;
    if (!best || worth > best.worth + EXACT) best = { o, worth };
  }
  return best ? { option: best.o.id, reason: 'aster_link', why: `${best.o.label}: a Command Token nothing else would use, for a Link` } : null;
}

// ---------- Tactics Cards (5.4; M8.2q) ----------

// THE END PHASE'S CARDS. Remote Restart whenever a Mech of the squad is in
// Shutdown: back in a Stance with a Link, the Mech that would spend its next
// Opportunity on a Reboot acts in it. Into Offensive Stance where it may, as a
// Reboot goes. Failing that, Battlefield Recovery's Link on the Mech short of
// one that is worth most: a Link is worth as much in this round's End Phase as
// in any later one, and one card a round leaves the next round's free.
function endCards(d: Decision, view: SeatView, w: Weights): Choice | null {
  const restarts = d.options.filter((o) => o.tags.includes('card:279'));
  if (restarts.length) {
    const pick = restarts.find((o) => o.facts?.pick === 'offensive') ?? restarts[0];
    return { option: pick.id, reason: 'tactic_restart', why: `${pick.label}: a Mech in Shutdown acts again` };
  }
  let best: { o: Option; worth: number } | null = null;
  for (const o of d.options) {
    if (!o.tags.includes('card:275')) continue;
    const u = unitOf(view, o.facts?.uid);
    const worth = u ? unitWorth(u, view, w) : 0;
    if (!best || worth > best.worth + EXACT) best = { o, worth };
  }
  return best ? { option: best.o.id, reason: 'tactic_link', why: `${best.o.label}: a Link for the Mech worth most that is short of one` } : null;
}

// HIT AND RUN (276): the Mech whose Action Opportunity has just ended may
// Maneuver. Each Grid the Maneuver reaches is weighed against staying where it
// stands: what the Main Task holds there, the walk it leaves to the zone or the
// enemy worth walking to, and what the other squad could do to it there before
// the round is out. Every Grid no enemy could reach is weighed, and of the
// others the ones fewest enemies would see. Played where the best beats staying
// by more than keeping the card is worth (`card`). Not into a Mine, and not a
// Crush of a Unit: a free Maneuver is a step aside.
function* hitAndRun(d: Decision, view: SeatView, w: Weights, skills: Skills, memo: Memo): Steps<Choice | null> {
  const c = context(d, view, w, skills, memo);
  if (!c) return null;
  const led = quarryOf(c);
  const zones = c.skills.mission ? scoringCells(view) : new Set<string>();
  const ends = new Map<string, { o: Option; at: Grid; claim: number }>();
  for (const o of d.options) {
    const at = kindOf(o) === 'move' ? endOf(o) : null;
    const facing = facingOf(o);
    if (!at || facing === null || same(at, c.me.grid) || o.tags.includes('mined') || o.tags.includes('crush-unit')) continue;
    const claim = claimAt(at, facing, c);
    const held = ends.get(key(at));
    if (!held || claim > held.claim) ends.set(key(at), { o, at, claim });
  }
  if (!ends.size) return null;
  const here = d.here?.();
  const priced = (out: Outlook | null | undefined, at: Grid, budget = Infinity): Harm => (c.skills.exposure ? exposure(out, at, c, budget) : UNHARMED);
  const stays = { shape: shapeAt(c.me.grid, c, led), cost: priced(here, c.me.grid).cost };
  yield;
  // What each step gains before what standing there would cost.
  const walks = [...ends.values()].map((x) => ({
    ...x,
    gain: (zones.has(key(x.at)) || zones.has(key(c.me.grid)) ? missionOf(x.o.after?.()?.view() ?? view, w) - c.mission : 0) + shapeAt(x.at, c, led) - stays.shape,
  }));
  yield;
  const reached = walks.filter((x) => c.skills.exposure && c.hostile.some((e) => inReachOf(e, x.at)));
  const eyes = reached.length ? here?.seen(c.me.uid, reached.map((x) => x.at)) ?? [] : [];
  const cover = reached.map((x, i) => ({ x, eyes: eyes[i]?.length ?? 0 })).sort((a, b) => a.eyes - b.eyes || b.x.gain - a.x.gain).slice(0, LIMITS.COVER).map((y) => y.x);
  // The step to beat: the best so far, and never less than keeping the card.
  let best: { o: Option; net: number } | null = null;
  for (const x of [...walks.filter((y) => !reached.includes(y)), ...cover]) {
    // The most it could come to, with nothing to pay for standing there.
    const most = x.gain + stays.cost;
    const bar = Math.max(best?.net ?? -Infinity, w.card);
    if (most <= bar + EXACT) continue;
    const harm = priced(x.o.after?.(), x.at, most - bar);
    yield;
    if (harm.partial) continue;
    const net = most - harm.cost;
    if (net > bar + EXACT) best = { o: x.o, net };
  }
  if (!best) {
    const pass = d.options.find((o) => o.tags.includes('pass'));
    return pass ? { option: pass.id, reason: 'tactic_kept', why: `no Grid is better placed than this one by more than the card is worth (${w.card.toFixed(2)})` } : null;
  }
  return { option: best.o.id, reason: 'tactic_hit_and_run', score: best.net, why: `${best.o.label}: better placed there by ${best.net.toFixed(2)}` };
}

// ADDITIONAL INSTRUCTIONS (274): one Ally Drone takes 1 more Command Action this
// Command Phase with no Command Token spent on it. Played on a Drone no Token
// can be given to now (it has had its Command, or the squad has none left), for
// what that Command would add, reckoned as a Command is (`command`): the turn it
// opens over the turn it does not. Where a Token would do, the Token is spent.
function* instructions(d: Decision, view: SeatView, w: Weights, skills: Skills, memo: Memo): Steps<Choice | null> {
  const paid = new Set(d.options.filter((o) => o.tags.includes('designate')).map((o) => o.facts?.uid));
  let best: { o: Option; gain: number } | null = null;
  for (const o of d.options) {
    if (!o.tags.includes('card:274') || paid.has(o.facts?.uid) || !o.then) continue;
    const give = o.then()?.options.find((x) => x.tags.includes('designate') && x.facts?.uid === o.facts?.uid);
    const turn = give?.then?.();
    const c = turn ? context(turn, view, w, skills, memo) : null;
    const found = c ? yield* bestSteps(c) : null;
    yield;
    if (!found) continue;
    const gain = worthOf(found.best) - worthOf(found.stay) + (skills.orders ? found.stay.now : 0);
    if (gain > w.card + EXACT && (!best || gain > best.gain + EXACT)) best = { o, gain };
  }
  return best ? { option: best.o.id, reason: 'tactic_command', score: best.gain, why: `${best.o.label}: a Command no Token pays for (${best.gain.toFixed(2)})` } : null;
}

// ---------- the policy ----------

export function makeTactician(skills: Partial<Skills> = {}, weights: Partial<Weights> = {}): Policy {
  const s: Skills = { ...SKILLS, ...skills };
  const w: Weights = { ...TACTICIAN, ...weights };
  // What the table in front of it has already been asked (Memo). It holds
  // nothing a seat may not see and nothing of an earlier table: a policy with
  // it chooses exactly what one without it would, sooner. One for each seat it
  // is put in: the same policy may sit in both seats of a table (a game that
  // is only watched), and one seat's thought may be put down while the other
  // seat is asked something.
  const memos = new Map<string, Memo>();
  const memoOf = (view: SeatView): Memo => {
    let memo = memos.get(view.seat);
    if (!memo) memos.set(view.seat, memo = newMemo());
    return memo;
  };
  // What a forecast is worth to the attacker, in the fight a question of the
  // combat is about.
  const worthIn = (d: Decision, view: SeatView): Worth | undefined => {
    const target = unitOf(view, d.facts.targetUid);
    return target ? (f) => gainOf(f, target, view, w) : undefined;
  };
  function* decide(d: Decision, view: SeatView): Steps<Choice | null> {
    const memo = memoOf(view);
    switch (d.kind) {
      case 'opp.act':
      case 'activation.act':
        return yield* activation(d, view, w, s, memo);
      case 'setup.designate.leader':
        return s.setup ? leader(d, view) : null;
      case 'setup.deploy':
        return s.setup ? yield* deploy(d, view, w, s, memo) : null;
      case 'planning.dial':
        return s.dials ? yield* dial(d, view, w, s, memo) : null;
      case 'loop.designate.command': {
        // A Command no Token can pay for, by a Tactics Card, comes first.
        const card = s.tactics ? yield* instructions(d, view, w, s, memo) : null;
        if (card) return card;
        const given = s.command ? yield* command(d, view, w, s, memo) : null;
        // Where no Drone gains by a Command, Aster may turn a Token into Link.
        if (s.aster && (!given || given.reason === 'command_withheld')) {
          const link = aster(d, view, w);
          if (link) return link;
        }
        return given;
      }
      case 'phase.ready': {
        // A squad with no Command left to give is asked nothing more of the
        // Command Phase but this: Additional Instructions comes here or never,
        // and Aster's Link where no Drone took the Token (a squad with no Drone
        // to command is asked no designation at all).
        const card = s.tactics && d.options.some((o) => o.tags.includes('card:274')) ? yield* instructions(d, view, w, s, memo) : null;
        if (card) return card;
        return s.aster ? aster(d, view, w) : null;
      }
      case 'tactic.end':
        return s.tactics ? endCards(d, view, w) : null;
      case 'tactic.after':
        return s.tactics ? yield* hitAndRun(d, view, w, s, memo) : null;
      case 'blast.resolve':
        return detonation(d, view, w, s, memo);
      case 'reaction.answer':
        return yield* reaction(d, view, w, s, memo);
      case 'reveal.make':
        return s.appear ? yield* appear(d, view, w, s, memo) : null;
      case 'smoke.thin':
        return thin(d, view);
      case 'attack.split':
        return s.spread ? yield* spread(d, view, w) : null;
      case 'mine.lay':
        return s.mines ? lay(d, view) : null;
      case 'shove.make':
        return s.shove ? yield* shove(d, view, w, s, memo) : null;
      case 'attack.part':
        return hitLocation(d, view, worthIn(d, view));
      case 'defence.declare':
        return declare(d, view, worthIn(d, view));
      case 'attack.reroll':
      case 'defence.reroll':
        return reroll(d, view, worthIn(d, view));
      case 'attack.surplus':
        return surplus(d, view, worthIn(d, view));
      case 'attack.focus':
      case 'defence.focus':
        return s.focus ? focus(d, view, w, worthIn(d, view)) : null;
      case 'setup.box':
        return w.boxPlace > 0 ? placeBox(d, view) : null;
      case 'contest.focus':
        return w.ewFocus > 0 ? counterFocus(d, view, w) : null;
      case 'contest.reroll':
        return w.ewFocus > 0 ? counterReroll(d) : null;
      default:
        return null;
    }
  }
  return {
    name: 'tactician',
    choose(d, view, rng) {
      // What it has no judgement of its own about yet is answered as the
      // Brawler answers it.
      return finish(decide(d, view)) ?? brawlerPolicy.choose(d, view, rng);
    },
    // The same, with a pause wherever the work may be put down.
    async ponder(d, view, rng, breathe) {
      const steps = decide(d, view);
      let step = steps.next();
      while (!step.done) {
        await breathe();
        step = steps.next();
      }
      return step.value ?? brawlerPolicy.choose(d, view, rng);
    },
  };
}

export const tacticianPolicy: Policy = makeTactician();
// How much of the board one decision puts to the engine, for the tests that
// stage a board at the edge of it.
export const TACTICIAN_LIMITS = LIMITS;
