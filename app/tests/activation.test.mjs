// Checks the Action Phase activation order (rulebook 3.4.1).
import { readFileSync, writeFileSync } from 'node:fs';

const src = readFileSync(new URL('../src/loop.ts', import.meta.url), 'utf8');
const types = readFileSync(new URL('../src/types.ts', import.meta.url), 'utf8');
const timings = types.slice(types.indexOf('export const TIMINGS'), types.indexOf('export type TokenShape'));
if (!timings) throw new Error('could not locate TIMINGS in types.ts');
const tmp = new URL('./_activation.slice.ts', import.meta.url);
writeFileSync(
  tmp,
  'type GameState = any;\ntype Side = any;\ntype Timing = any;\ntype Token = any;\n' + timings + src.replace(/^import[^\n]*\n/gm, ''),
);
const { activationOrder, nextActivation, actionPhaseComplete, onExtraOpportunity } = await import(tmp.href);

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}, got ${g}`); }
};

// Initiative is looked up per mech and per timing, so the test supplies it directly.
const INIT = new Map();
const mech = (uid, side, timing, init) => {
  INIT.set(`${uid}:${timing}`, init);
  return { uid, side, timing, kind: 'mech', partStates: { torso: 'intact' } };
};
const lookup = (t, timing) => INIT.get(`${t.uid}:${timing}`);
const world = (tokens, firstPlayer = 's1', acted = [], extraOpps = []) => ({
  tokens,
  round: { n: 1, phase: 2, firstPlayer },
  script: { acted, extraOpps },
});
const order = (tokens, fp) => activationOrder(world(tokens, fp), lookup).map((a) => a.uid);

console.log('Action Phase activation order\n');

// Timing order is fixed and beats Initiative outright.
check(
  'timing order comes before initiative',
  order([mech(1, 's1', 'tactical', 1), mech(2, 's2', 'swift', 9)]),
  [2, 1],
);
check(
  'all six timings resolve in book order',
  order([
    mech(10, 's1', 'tactical', 1), mech(11, 's1', 'movement', 1), mech(12, 's1', 'firing', 1),
    mech(13, 's1', 'projectile', 1), mech(14, 's1', 'melee', 1), mech(15, 's1', 'swift', 1),
  ]),
  [15, 14, 13, 12, 11, 10],
);

// Inside one Timing, the LOWEST Initiative acts first.
check(
  'lowest initiative acts first',
  order([mech(1, 's1', 'firing', 7), mech(2, 's2', 'firing', 2), mech(3, 's1', 'firing', 5)]),
  [2, 3, 1],
);

// The worked example on book p.29: Melee/5, Melee/2 and Projectile/2 resolve B, A, C.
const a = mech(101, 's1', 'melee', 5);
const b = mech(102, 's2', 'melee', 2);
const c = mech(103, 's1', 'projectile', 2);
check('book p.29 example resolves B, A, C', order([a, b, c]), [102, 101, 103]);

// Tied on Timing AND Initiative: the First Player goes first, then the sides alternate.
const tie = () => [
  mech(1, 's1', 'firing', 4), mech(2, 's1', 'firing', 4),
  mech(3, 's2', 'firing', 4), mech(4, 's2', 'firing', 4),
];
check('a full tie alternates from the first player', order(tie(), 's1'), [1, 3, 2, 4]);
check('the other first player flips the alternation', order(tie(), 's2'), [3, 1, 4, 2]);
// When one side runs out mid-tie, the rest of the other side simply follows.
check(
  'an uneven tie finishes with whoever is left',
  order([mech(1, 's1', 'firing', 4), mech(2, 's1', 'firing', 4), mech(3, 's1', 'firing', 4), mech(4, 's2', 'firing', 4)], 's1'),
  [1, 4, 2, 3],
);
// Ties are broken per initiative value, not across the whole timing.
check(
  'each initiative value gets its own tie-break',
  order([mech(1, 's2', 'firing', 2), mech(2, 's1', 'firing', 2), mech(3, 's2', 'firing', 1), mech(4, 's1', 'firing', 1)], 's1'),
  [4, 3, 2, 1],
);

// A Mech with no dial set never activates, and neither do drones or wrecks.
check('a mech with no dial does not activate', order([{ uid: 5, side: 's1', kind: 'mech', partStates: { torso: 'intact' } }]), []);
check('drones do not activate in this phase', order([{ uid: 6, side: 's1', kind: 'drone', timing: 'firing', partStates: {} }]), []);
check(
  'a mech with every part destroyed does not activate',
  order([{ uid: 7, side: 's1', kind: 'mech', timing: 'firing', partStates: { torso: 'destroyed' } }]),
  [],
);
// A pilotless mech has no Initiative Value, so it goes last within its timing.
check(
  'an unknown initiative sorts last',
  order([mech(1, 's1', 'firing', undefined), mech(2, 's1', 'firing', 6)]),
  [2, 1],
);

// The driver walks the order, skipping whoever has already had their opportunity.
const three = [mech(1, 's1', 'swift', 3), mech(2, 's2', 'melee', 3), mech(3, 's1', 'firing', 3)];
check('the first activation is the head of the order', nextActivation(world(three), lookup).uid, 1);
check('an acted mech is skipped', nextActivation(world(three, 's1', [1]), lookup).uid, 2);
check('the phase is not over while one is owed', actionPhaseComplete(world(three, 's1', [1, 2]), lookup), false);
check('the phase ends when all have acted', actionPhaseComplete(world(three, 's1', [1, 2, 3]), lookup), true);
check('an empty board ends the phase at once', actionPhaseComplete(world([]), lookup), true);
check('the activation carries its timing and initiative', nextActivation(world(three), lookup), { uid: 1, timing: 'swift', init: 3 });

// ---------- Extra Action Opportunities (Echoes Support Backpack) ----------

// An Extra Opportunity waits for the normal order to finish. That is where it
// belongs rather than a simplification: only a Tactic grants one, and Tactical
// is the last Timing, so everyone else has already acted by the time it is cast.
check('an owed mech does not jump the queue', nextActivation(world(three, 's1', [], [3]), lookup).uid, 1);
check('the normal order runs first', nextActivation(world(three, 's1', [1], [3]), lookup).uid, 2);
check('the extra comes once everyone has acted', nextActivation(world(three, 's1', [1, 2, 3], [3]), lookup).uid, 3);
check('and it carries that mech\'s own timing', nextActivation(world(three, 's1', [1, 2, 3], [3]), lookup).timing, 'firing');
check('the phase is not over while an extra is owed', actionPhaseComplete(world(three, 's1', [1, 2, 3], [3]), lookup), false);
check('and ends once it is spent', actionPhaseComplete(world(three, 's1', [1, 2, 3], []), lookup), true);
check('two owed mechs are served in the order granted', nextActivation(world(three, 's1', [1, 2, 3], [2, 1]), lookup).uid, 2);

// A grant aimed at a destroyed or undialled mech has no slot in the order, so it
// must be dropped rather than stalling the phase forever.
check('an owed mech with no activation is skipped', actionPhaseComplete(world(three, 's1', [1, 2, 3], [99]), lookup), true);

check('a mech acting normally is not on an extra', onExtraOpportunity(world(three, 's1', [], [3]), 3), false);
check('one that has acted and is owed is', onExtraOpportunity(world(three, 's1', [3], [3]), 3), true);
check('and one merely finished is not', onExtraOpportunity(world(three, 's1', [3], []), 3), false);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
