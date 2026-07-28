// Checks the Action Phase activation order (rulebook 3.4.1).
import { readFileSync, writeFileSync } from 'node:fs';

const src = readFileSync(new URL('../src/playguide.ts', import.meta.url), 'utf8');
const types = readFileSync(new URL('../src/types.ts', import.meta.url), 'utf8');
const timings = types.slice(types.indexOf('export const TIMINGS'), types.indexOf('export type TokenShape'));
const start = src.indexOf('function alive(');
const end = src.indexOf('export interface GuideCallbacks');
if (start < 0 || end < 0 || !timings) throw new Error('could not locate the activation order in playguide.ts');
const tmp = new URL('./_activation.slice.ts', import.meta.url);
writeFileSync(
  tmp,
  'type GameState = any;\ntype Side = any;\ntype Timing = any;\ntype Token = any;\n' + timings + src.slice(start, end),
);
const { activationOrder, nextActivation, actionPhaseComplete } = await import(tmp.href);

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
const world = (tokens, firstPlayer = 'blue', acted = []) => ({
  tokens,
  round: { n: 1, phase: 2, firstPlayer },
  script: { acted },
});
const order = (tokens, fp) => activationOrder(world(tokens, fp), lookup).map((a) => a.uid);

console.log('Action Phase activation order\n');

// Timing order is fixed and beats Initiative outright.
check(
  'timing order comes before initiative',
  order([mech(1, 'blue', 'tactical', 1), mech(2, 'red', 'swift', 9)]),
  [2, 1],
);
check(
  'all six timings resolve in book order',
  order([
    mech(10, 'blue', 'tactical', 1), mech(11, 'blue', 'movement', 1), mech(12, 'blue', 'firing', 1),
    mech(13, 'blue', 'projectile', 1), mech(14, 'blue', 'melee', 1), mech(15, 'blue', 'swift', 1),
  ]),
  [15, 14, 13, 12, 11, 10],
);

// Inside one Timing, the LOWEST Initiative acts first.
check(
  'lowest initiative acts first',
  order([mech(1, 'blue', 'firing', 7), mech(2, 'red', 'firing', 2), mech(3, 'blue', 'firing', 5)]),
  [2, 3, 1],
);

// The worked example on book p.29: Melee/5, Melee/2 and Projectile/2 resolve B, A, C.
const a = mech(101, 'blue', 'melee', 5);
const b = mech(102, 'red', 'melee', 2);
const c = mech(103, 'blue', 'projectile', 2);
check('book p.29 example resolves B, A, C', order([a, b, c]), [102, 101, 103]);

// Tied on Timing AND Initiative: the First Player goes first, then the sides alternate.
const tie = () => [
  mech(1, 'blue', 'firing', 4), mech(2, 'blue', 'firing', 4),
  mech(3, 'red', 'firing', 4), mech(4, 'red', 'firing', 4),
];
check('a full tie alternates from the first player', order(tie(), 'blue'), [1, 3, 2, 4]);
check('the other first player flips the alternation', order(tie(), 'red'), [3, 1, 4, 2]);
// When one side runs out mid-tie, the rest of the other side simply follows.
check(
  'an uneven tie finishes with whoever is left',
  order([mech(1, 'blue', 'firing', 4), mech(2, 'blue', 'firing', 4), mech(3, 'blue', 'firing', 4), mech(4, 'red', 'firing', 4)], 'blue'),
  [1, 4, 2, 3],
);
// Ties are broken per initiative value, not across the whole timing.
check(
  'each initiative value gets its own tie-break',
  order([mech(1, 'red', 'firing', 2), mech(2, 'blue', 'firing', 2), mech(3, 'red', 'firing', 1), mech(4, 'blue', 'firing', 1)], 'blue'),
  [4, 3, 2, 1],
);

// A Mech with no dial set never activates, and neither do drones or wrecks.
check('a mech with no dial does not activate', order([{ uid: 5, side: 'blue', kind: 'mech', partStates: { torso: 'intact' } }]), []);
check('drones do not activate in this phase', order([{ uid: 6, side: 'blue', kind: 'drone', timing: 'firing', partStates: {} }]), []);
check(
  'a mech with every part destroyed does not activate',
  order([{ uid: 7, side: 'blue', kind: 'mech', timing: 'firing', partStates: { torso: 'destroyed' } }]),
  [],
);
// A pilotless mech has no Initiative Value, so it goes last within its timing.
check(
  'an unknown initiative sorts last',
  order([mech(1, 'blue', 'firing', undefined), mech(2, 'blue', 'firing', 6)]),
  [2, 1],
);

// The driver walks the order, skipping whoever has already had their opportunity.
const three = [mech(1, 'blue', 'swift', 3), mech(2, 'red', 'melee', 3), mech(3, 'blue', 'firing', 3)];
check('the first activation is the head of the order', nextActivation(world(three), lookup).uid, 1);
check('an acted mech is skipped', nextActivation(world(three, 'blue', [1]), lookup).uid, 2);
check('the phase is not over while one is owed', actionPhaseComplete(world(three, 'blue', [1, 2]), lookup), false);
check('the phase ends when all have acted', actionPhaseComplete(world(three, 'blue', [1, 2, 3]), lookup), true);
check('an empty board ends the phase at once', actionPhaseComplete(world([]), lookup), true);
check('the activation carries its timing and initiative', nextActivation(world(three), lookup), { uid: 1, timing: 'swift', init: 3 });

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
