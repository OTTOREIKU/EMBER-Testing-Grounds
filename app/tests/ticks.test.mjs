// Checks the Tick economy of one Action Opportunity (rulebook 3.4.5).
import { readFileSync, writeFileSync } from 'node:fs';

// The Opportunity shape lives in types.ts so the script can persist it; the
// rules that read it live in ticks.ts. The test needs both halves.
const src = readFileSync(new URL('../src/ticks.ts', import.meta.url), 'utf8');
const types = readFileSync(new URL('../src/types.ts', import.meta.url), 'utf8');
const shapes = types.slice(types.indexOf('export function newOpportunity'), types.indexOf('export interface ScriptState'));
if (!shapes) throw new Error('could not locate the opportunity helpers in types.ts');
const body = src.replace(/^import[^\n]*\n/m, 'type CardAction = any;\ntype Timing = any;\ntype ExtraTick = any;\ntype Opportunity = any;\n') + shapes;
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
const fresh = () => T.newOpportunity(1, 'firing');
check('a new opportunity has three ticks', T.ticksLeft(fresh()), 3);

// The Starting Action must match the dial; later Actions are unrestricted.
check('the starting action must match the dial', T.canPerform(fresh(), melee.s).ok, false);
check('a matching starting action is fine', T.canPerform(fresh(), fire.s).ok, true);
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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
