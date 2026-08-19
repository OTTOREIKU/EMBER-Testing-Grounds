// Checks the Tick economy of one Action Opportunity (rulebook 3.4.5).
import { readFileSync, writeFileSync } from 'node:fs';

// The Opportunity shape lives in types.ts so the script can persist it; the
// rules that read it live in ticks.ts. The test needs both halves.
const src = readFileSync(new URL('../src/ticks.ts', import.meta.url), 'utf8');
const types = readFileSync(new URL('../src/types.ts', import.meta.url), 'utf8');
const shapes = types.slice(types.indexOf('export function newOpportunity'), types.indexOf('export interface ScriptState'));
if (!shapes) throw new Error('could not locate the opportunity helpers in types.ts');
// EVERY import goes, not just the first: ticks.ts also pulls TIMINGS in as a
// real value for the Flexible Timing adjacency, and a surviving import line
// would try to resolve './types' from the tests directory.
const timings = types.slice(types.indexOf('export const TIMINGS'), types.indexOf('export type TokenShape'));
if (!timings) throw new Error('could not locate TIMINGS in types.ts');
const stubs = 'type CardAction = any;\ntype Timing = any;\ntype ExtraTick = any;\ntype Opportunity = any;\ntype TimingDef = any;\ntype Stance = any;\n';
const body = src.replace(/^import[^\n]*\n/gm, '') + stubs + timings + shapes;
const tmp = new URL('./_ticks.slice.ts', import.meta.url);
writeFileSync(tmp, body);
const T = await import(tmp.href);

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}, got ${g}`); }
};

const act = (id, type, size, extra = {}) => ({ id, type, size, name: { en: id }, ...extra });
const fire = { s: act('f1', 'Firing', 's'), m: act('f2', 'Firing', 'm'), l: act('f3', 'Firing', 'l') };
const melee = { s: act('m1', 'Melee', 's'), m: act('m2', 'Melee', 'm') };
const passive = act('p1', 'Passive', 'm');

console.log('Tick economy of an Action Opportunity\n');

// Only the six dial Timings are Actions a player spends Ticks on.
check('a Firing action maps to the firing timing', T.timingOf(fire.s), 'firing');
check('the data spells Movement "Moving"', T.timingOf(act('x', 'Moving', 's')), 'movement');
check('the data spells Tactical "Tactic"', T.timingOf(act('x', 'Tactic', 's')), 'tactical');
check('a Passive has no timing', T.timingOf(passive), undefined);
// Passives carry a size in the card data, but it describes the printed block, not a cost.
check('a Passive costs nothing despite its size', T.costOf(passive), undefined);

// The three lengths, straight from the book.
check('Short costs 1 Action Tick', T.costOf(fire.s), { maneuver: 0, action: 1 });
check('Medium costs 2 Action Ticks', T.costOf(fire.m), { maneuver: 0, action: 2 });
check('Long costs the Maneuver Tick and both Action Ticks', T.costOf(fire.l), { maneuver: 1, action: 2 });
check('cost reads back in words', T.costLabel(T.costOf(fire.l)), '1 Maneuver Tick + 2 Action Ticks');

// A fresh Opportunity generates 1 Maneuver Tick and 2 Action Ticks.
const fresh = (timing = 'firing') => T.newOpportunity(1, timing);
check('a new opportunity has three ticks', T.ticksLeft(fresh()), 3);

// The Starting Action must match the dial; later Actions are unrestricted.
check('the starting action must match the dial', T.canPerform(fresh(), melee.s).ok, false);
check('a matching starting action is fine', T.canPerform(fresh(), fire.s).ok, true);

// ---------- Flexible Timing (keyword 灵活时机) ----------
//
// "This Action can be used in ADJACENT timings as a Starting Action. For
// example, a Movement Action with this Keyword can be used as Starting Action
// in Firing/Movement/Tactical Timing." The dial order is the printed one —
// swift, melee, projectile, firing, movement, tactical — and it does not wrap.
// The grant reaches a Mech from an ally's aura, so ticks.ts is told about it
// rather than reading a board it never sees.

const flex = { flexible: true };
const moving = act('mv1', 'Moving', 's');
const tactic = act('tc1', 'Tactic', 's');
const swiftAct = act('sw1', 'Swift', 's');

check('adjacency is symmetrical', T.timingsAdjacent('movement', 'firing'), true);
check('and the glossary example holds both ways', T.timingsAdjacent('movement', 'tactical'), true);
check('a timing is not adjacent to itself', T.timingsAdjacent('firing', 'firing'), false);
check('two steps apart is not adjacent', T.timingsAdjacent('firing', 'tactical'), false);
check('the dial does not wrap round', T.timingsAdjacent('tactical', 'swift'), false);

// The rulebook's own example: dial on Firing, a Movement Action opens.
check('without the aura a mismatched start is refused',
  T.canPerform(fresh('firing'), moving).ok, false);
check('Flexible Timing opens the neighbouring timing',
  T.canPerform(fresh('firing'), moving, moving.id, flex).ok, true);
check('and the other neighbour too',
  T.canPerform(fresh('tactical'), moving, moving.id, flex).ok, true);
check('but not a timing two steps away',
  T.canPerform(fresh('firing'), tactic, tactic.id, flex).ok, false);
check('and it says why rather than repeating the plain refusal',
  T.canPerform(fresh('firing'), tactic, tactic.id, flex).why.includes('either side'), true);
check('it never wraps Tactical round to Swift',
  T.canPerform(fresh('tactical'), swiftAct, swiftAct.id, flex).ok, false);
check('a matching Action is unaffected by the grant',
  T.canPerform(fresh('firing'), fire.s, fire.s.id, flex).ok, true);

// It is a STARTING Action rule, so once the Opportunity is under way the dial
// no longer gates anything and the grant is irrelevant either way.
const started = T.spendAction(fresh('firing'), fire.s);
check('after the Starting Action the dial stops mattering',
  T.canPerform(started, moving).ok, true);

// The spend must agree with the check that allowed it, or an Action let through
// by the aura would be re-read as needing an Extra Tick.
const flexStart = T.spendAction(fresh('firing'), moving, moving.id, flex);
check('a flexed Starting Action spends a real Tick, not an Extra',
  [flexStart.started, T.ticksLeft(flexStart)], [true, 2]);
const afterStart = T.spendAction(fresh(), fire.s);
check('a later action ignores the dial', T.canPerform(afterStart, melee.s).ok, true);
check('one short action leaves two ticks', T.ticksLeft(afterStart), 2);

// Ticks are consumed in order: the Maneuver Tick is unusable once an Action Tick is spent.
check('maneuvering first is allowed', T.canManeuver(fresh()).ok, true);
check('maneuvering after an action is not', T.canManeuver(afterStart).ok, false);
const moved = T.spendManeuver(fresh());
check('maneuvering twice is not allowed', T.canManeuver(moved).ok, false);
check('a maneuver leaves both action ticks', [moved.maneuver, moved.action], [0, 2]);
check('a medium action still fits after maneuvering', T.canPerform(moved, fire.m).ok, true);

// A Long Action needs the whole untouched pool, so it rules out Maneuvering.
check('a long action fits a fresh opportunity', T.canPerform(fresh(), fire.l).ok, true);
check('a long action does not fit after a maneuver', T.canPerform(moved, fire.l).ok, false);
check('a long action does not fit after a short one', T.canPerform(afterStart, fire.l).ok, false);
check('a long action uses everything', T.opportunityOver(T.spendAction(fresh(), fire.l)), true);

// Two Short Actions after a Maneuver is the common opening; a third does not fit.
const two = T.spendAction(T.spendAction(moved, fire.s), melee.s);
check('maneuver plus two shorts empties the pool', T.opportunityOver(two), true);
check('a third action has nothing to pay with', T.canPerform(two, act('m3', 'Melee', 's')).ok, false);

// Each Part Action is once per Opportunity on base Ticks.
check('repeating an action on base ticks is refused', T.canPerform(afterStart, fire.s).ok, false);

// Extra Ticks come only after the base pool, never mixed into one Action's cost,
// and a typed one only pays for its own Action Type.
const withExtra = { ...two, extras: [{ id: 'e1', label: 'Extra Firing Tick', timing: 'firing' }] };
check('an extra tick pays for a short action of its type', T.canPerform(withExtra, fire.s).ok, true);
check('an extra tick may repeat an action already performed', T.canPerform(withExtra, fire.s).extra.id, 'e1');

// The shared Charge Action is the one exception to once-only (FAQ H6/H7):
// each use Charges a different Part, so two may run in one Opportunity.
const chargeAct = act('COMMON_CHARGE', 'Tactic', 's');
const charged = { ...fresh(), timing: 'tactical', started: true, performed: ['COMMON_CHARGE'], action: 1 };
check('the common Charge may repeat on base ticks (H6)', T.canPerform(charged, chargeAct).ok, true);
check('other actions still refuse a repeat', T.canPerform({ ...charged, performed: ['f1'], timing: 'firing' }, fire.s).ok, false);
check('a typed extra tick refuses another type', T.canPerform(withExtra, melee.s).ok, false);
check('an extra tick cannot pay for a medium action', T.canPerform(withExtra, fire.m).ok, false);
const spent = T.spendAction(withExtra, fire.s);
check('spending an extra tick does not touch the base pool', [spent.maneuver, spent.action], [0, 0]);
check('an extra tick is gone once used', T.canPerform(spent, fire.s).ok, false);
// Base Ticks are spent first, so an extra cannot be reached while any base tick remains.
const earlyExtra = { ...T.spendManeuver(fresh()), extras: [{ id: 'e1', label: 'x', timing: 'firing' }] };
check('base ticks are spent before extras', T.canPerform(earlyExtra, fire.m).ok, true);
check('an untyped extra tick pays for anything short', T.canPerform({ ...two, extras: [{ id: 'e2', label: 'x' }] }, melee.s).ok, true);

// A Mech that never Maneuvers forfeits its Maneuver Tick rather than holding it,
// so it must still reach its Extra Tick. Getting this wrong locks Sustained Fire
// out of every Opportunity that did not happen to include a Maneuver.
const noMan = { ...T.spendAction(T.spendAction(fresh(), fire.s), melee.s), extras: [{ id: 'e1', label: 'x', timing: 'firing' }] };
check('an unspent maneuver tick does not hold the base pool open', [noMan.maneuver, noMan.action], [1, 0]);
check('the base pool still counts as spent', T.baseSpent(noMan), true);
check('so the extra tick is reachable without maneuvering', T.canPerform(noMan, fire.s).ok, true);
check('and the extra tick is what pays', T.canPerform(noMan, fire.s).extra.id, 'e1');
check('a typed extra still refuses the wrong type', T.canPerform(noMan, melee.s).ok, false);
// But a Maneuver Tick that is still legally spendable does hold the pool open.
const stillCould = { ...fresh(), extras: [{ id: 'e1', label: 'x', timing: 'firing' }] };
check('an untouched pool is not spent', T.baseSpent(stillCould), false);

// ---------- grant conditions ----------

// The Tempest core grants its Tick only while the Mech is Stationary, and the
// keyword measures that at the moment of use: "has not performed any Movement
// during its Action Opportunity before performing this Action". So the grant is
// read when the Tick is spent, not frozen when the Opportunity opens.
const move = act('mv', 'Moving', 's');
const tempest = { id: 'tempest', label: 'Extra Firing Tick', timing: 'firing', check: 'stationary' };
const stayed = { ...T.spendAction(T.spendAction(fresh(), fire.s), melee.s), extras: [tempest] };
check('a stationary mech keeps the tempest tick', T.canPerform(stayed, fire.s).ok, true);
check('and it counts as a tick in hand', T.ticksLeft(stayed), 2);

const walked = { ...T.spendAction(T.spendAction(fresh(), move), melee.s), extras: [tempest] };
check('spending an action tick on a Moving action counts as movement', walked.moved, true);
check('a mech that moved loses the tempest tick', T.canPerform(walked, fire.s).ok, false);
check('and is told which condition lapsed', /Stationary/.test(T.canPerform(walked, fire.s).why), true);
check('a lapsed grant is not a tick in hand', T.ticksLeft(walked), 1);
check('so the opportunity can end on it', T.opportunityOver({ ...walked, maneuver: 0 }), true);

// Maneuvering is Movement too, and the keyword counts a change of facing, which
// a Maneuver may be by itself.
const turned = T.spendManeuver(fresh());
check('maneuvering marks the mech as moved', turned.moved, true);
const afterMan = { ...T.spendAction(T.spendAction(turned, fire.s), melee.s), extras: [tempest] };
check('a mech that maneuvered loses the tempest tick', T.canPerform(afterMan, fire.s).ok, false);

// The Glacier core is the other shape: the grant exists only while the dial is
// set to Firing, which is a condition on holding the Tick rather than on what
// it may pay for.
const glacier = { id: 'glacier', label: 'Extra Firing Tick', timing: 'firing', check: 'timing' };
const onFiring = { ...T.spendAction(T.spendAction(fresh('firing'), fire.s), melee.s), extras: [glacier] };
check('the glacier tick exists on the firing dial', T.canPerform(onFiring, fire.s).ok, true);
const onMelee = { ...T.spendAction(T.spendAction(fresh('melee'), melee.s), fire.s), extras: [glacier] };
check('but not on another dial', T.canPerform(onMelee, fire.s).ok, false);
check('an unconditional grant is unaffected by movement', T.canPerform({ ...walked, extras: [{ id: 'e1', label: 'x', timing: 'firing' }] }, fire.s).ok, true);

// ---------- Overload (OCSP Overloading Pack, card 090) ----------

// The Pack buys ordinary Action Ticks, not Extra Ticks. That distinction is the
// whole point: two bought Ticks pay for one Medium Action, which no pair of
// Extra Ticks can do.
const drained = T.spendAction(T.spendAction(fresh(), fire.s), melee.s);
check('a spent pool cannot afford a medium action', T.canPerform(drained, fire.m).ok, false);
const bought = T.spendOverload(T.spendOverload(drained));
check('two overloaded ticks can', T.canPerform(bought, fire.m).ok, true);
check('and they land in the base pool, not the extras', [bought.action, bought.extras.length], [2, 0]);
check('overload is capped at two link', T.canOverload(bought, 5).ok, false);
check('and refused with no link to spend', T.canOverload(fresh(), 0).ok, false);
// The last Link can never be spent voluntarily (4.10, FAQ L1), so Overload
// needs at least 2 in hand.
check('the last link cannot buy an overload (L1)', T.canOverload(fresh(), 1).ok, false);
check('a fresh mech with spare link may overload', T.canOverload(fresh(), 2).ok, true);

// The trap this fix exists for. canManeuver once inferred "an Action Tick was
// spent" by comparing the pool to its usual size of two. Overload puts the pool
// above that size, so a Mech that had already acted read as untouched and could
// Maneuver out of turn order.
const overloadedFirst = T.spendOverload(fresh());
check('overloading before acting leaves the maneuver tick', T.canManeuver(overloadedFirst).ok, true);
check('and the pool is genuinely larger', overloadedFirst.action, 3);
const actedThenChecked = T.spendAction(overloadedFirst, fire.s);
check('the pool is still at the old full size after acting', actedThenChecked.action, 2);
check('but maneuvering is refused, because an action was performed', T.canManeuver(actedThenChecked).ok, false);
check('a long action is refused for the same reason', T.canPerform({ ...actedThenChecked, maneuver: 1 }, fire.l).ok, false);

// The three worked examples printed on book p.32, played out move by move.
// A: Movement dial. Maneuver, then a Medium Movement Action.
let a = T.newOpportunity(1, 'movement');
check('A: maneuver first', T.canManeuver(a).ok, true);
a = T.spendManeuver(a);
const sprint = act('a2', 'Moving', 'm');
check('A: then a medium movement action', T.canPerform(a, sprint).ok, true);
a = T.spendAction(a, sprint);
check('A: the opportunity is spent', T.opportunityOver(a), true);

// B: Swift dial. Maneuver, a Short Swift starting action, then any Short Action.
let b = T.newOpportunity(2, 'swift');
b = T.spendManeuver(b);
const swift = act('b2', 'Swift', 's');
check('B: the starting action matches the swift dial', T.canPerform(b, swift).ok, true);
b = T.spendAction(b, swift);
check('B: the second action is free of the dial', T.canPerform(b, melee.s).ok, true);
b = T.spendAction(b, melee.s);
check('B: the opportunity is spent', T.opportunityOver(b), true);

// C: Firing dial with Sustained Fire. A Long Firing Action, then a Short Firing
// Action paid by the Extra Firing Tick. No Maneuver is possible.
let c = { ...T.newOpportunity(3, 'firing'), extras: [{ id: 'sustained', label: 'Extra Firing Tick', timing: 'firing' }] };
check('C: a long firing action fits', T.canPerform(c, fire.l).ok, true);
c = T.spendAction(c, fire.l);
check('C: the base pool is empty', T.baseSpent(c), true);
check('C: the extra tick still pays for a short firing action', T.canPerform(c, fire.s).ok, true);
c = T.spendAction(c, fire.s);
check('C: the opportunity is spent', T.opportunityOver(c), true);

// A saved opportunity must survive a reload without losing its pool.
const round = T.normaliseOpportunity(JSON.parse(JSON.stringify(two)));
check('an opportunity round-trips', [round.maneuver, round.action, round.performed.length], [0, 0, 2]);
check('junk is refused rather than half-restored', T.normaliseOpportunity({ nope: 1 }), null);
check('a partial save is filled in', T.normaliseOpportunity({ uid: 4 }).action, 2);

// ---------- Attack Mode (H2-B "Crisis" II, card 547) ----------
//
// "[Offensive Stance] when this mech gains an Action Opportunity, may gains
// another 1 Action Tick." The whole ruling is which CLASS of Tick that is. The
// English and the structured `actionPoints: 1` say ordinary, so it behaves
// exactly like an Overloaded Tick and nothing like an Extra one.

const armed = T.spendAttackMode(T.newOpportunity(9, 'firing'));
check('the tick lands in the base pool, not the extras', [armed.action, armed.extras.length], [3, 0]);
// FAQ K14: an ordinary Tick combines with the base Ticks. This is the case an
// Extra Tick fails, and reading 时点 as an Extra Tick would have failed it too.
const oneLeft = T.spendAction(T.newOpportunity(9, 'firing'), fire.s);
check('a lone base tick cannot pay for a medium action', T.canPerform(oneLeft, fire.m).ok, false);
check('and it can once Attack Mode has added one', T.canPerform(T.spendAttackMode(oneLeft), fire.m).ok, true);
// K2/K12 give the repeat licence to Extra Ticks only. An ordinary Tick buys a
// DIFFERENT action, never the same one twice.
const repeated = T.spendAttackMode(T.spendAction(T.newOpportunity(9, 'firing'), fire.s));
check('it does not unlock repeating an action already performed', T.canPerform(repeated, fire.s).ok, false);
check('but it does pay for another one', T.canPerform(repeated, melee.s).ok, true);

// The declaration window is Overload's: before anything is performed.
check('a fresh opportunity in offensive stance may claim it',
  T.canAttackMode(T.newOpportunity(9, 'firing'), 'offensive', 'offensive').ok, true);
check('after an action it is too late',
  T.canAttackMode(T.spendAction(T.newOpportunity(9, 'firing'), fire.s), 'offensive', 'offensive').ok, false);
check('after a maneuver it is too late',
  T.canAttackMode(T.spendManeuver(T.newOpportunity(9, 'firing')), 'offensive', 'offensive').ok, false);
// The Stance is judged when the player declares, not when the Opportunity was
// minted — 4.1 lets the dial be cycled right up until the Mech does something.
check('another stance is refused',
  T.canAttackMode(T.newOpportunity(9, 'firing'), 'mobility', 'offensive').ok, false);
check('and the refusal names the stance the card wants',
  /offensive Stance/.test(T.canAttackMode(T.newOpportunity(9, 'firing'), 'mobility', 'offensive').why), true);
// A bonus whose card names no Stance is unconditional; the reader only reports
// what the effect prints.
check('a bonus with no printed stance is unconditional',
  T.canAttackMode(T.newOpportunity(9, 'firing'), 'defensive').ok, true);

// Banked, never re-checked. Twice is the abuse the flag exists to refuse.
check('it can only be taken once', T.canAttackMode(armed, 'offensive', 'offensive').ok, false);
// The whitelist trap, which has already shipped one bug in this project
// (preMoved). Dropped here, every rehydrate, rejoin and rollback hands the
// Tick back and the pool grows without limit.
check('the flag survives a save round trip',
  T.normaliseOpportunity(JSON.parse(JSON.stringify(armed))).attackMode, true);
check('and an opportunity that never took it stays clean',
  T.normaliseOpportunity(JSON.parse(JSON.stringify(T.newOpportunity(9, 'firing')))).attackMode, undefined);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
