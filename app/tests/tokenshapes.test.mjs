// Checks token-shape stacking against rulebook 2.5.3 and 4.12.2.
//   Square Tokens accumulate; a unit bears at most 1 Hexagon Token; entering
//   Optical Camouflage strips every Hexagon Token it is carrying.
import { pathToFileURL } from 'node:url';

const srcUrl = process.argv[2] ? pathToFileURL(process.argv[2]) : new URL('../src/types.ts', import.meta.url);
const { addStatus, STATUSES, statusesFor } = await import(srcUrl.href);

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}, got ${g}`); }
};
const build = (...ids) => ids.reduce((acc, id) => addStatus(acc, id), undefined);

console.log('token shapes — rulebook 2.5.3 / 4.12.2\n');

// Every status must declare a shape, or the board cannot draw it.
check('all statuses carry a shape', STATUSES.filter((s) => !s.shape).map((s) => s.id), []);

// Square Tokens have no cap and stack with each other.
check('squares accumulate', build('fragile', 'fragile', 'fci'), ['fragile', 'fragile', 'fci']);

// A Hexagon Token replaces whichever one the unit already had.
check('hexagon replaces hexagon', build('lowProfile', 'targetTracer'), ['targetTracer']);
check('third hexagon still leaves one', build('lowProfile', 'targetTracer', 'highlight'), ['highlight']);
check('re-adding the same hexagon does not duplicate', build('highlight', 'highlight'), ['highlight']);

// Swapping a Hexagon leaves Square Tokens where they are.
check('hexagon swap keeps squares', build('fragile', 'lowProfile', 'fci', 'targetTracer'), ['fragile', 'fci', 'targetTracer']);

// Optical Camouflage is a State, and taking it drops every Hexagon Token.
check('camouflage strips hexagons', build('fragile', 'targetTracer', 'camouflage'), ['fragile', 'camouflage']);
check('camouflage keeps part-card tokens', build('repaired', 'lowProfile', 'camouflage'), ['repaired', 'camouflage']);

// Interception is counted per Part from Intercept X, not toggled by hand, so it
// must not appear as a manual chip alongside the automatic counter.
check('interception is not a manual status', STATUSES.filter((s) => s.id === 'interception').length, 0);

// Which tokens a unit can legally bear, per the rulebook.
const ids = (kind) => statusesFor(kind).map((s) => s.id);

// Repaired repairs a Destroyed Part, and only Mechs are built from Parts (2.2.2).
// The attack sequence skips the target-Part step for everything else (4.5.1) and a
// Destroyed Drone or Projectile leaves the board at once (4.4.4).
check('Repaired is offered on mechs', ids('mech').includes('repaired'), true);
check('Repaired is not offered on drones', ids('drone').includes('repaired'), false);
check('Repaired is not offered on projectiles', ids('projectile').includes('repaired'), false);

// Optical Camouflage has two entry paths and a Projectile can use neither: it has
// no activating Action, and it cannot be placed during Deployment (5.1).
check('Optical Camouflage is not offered on projectiles', ids('projectile').includes('camouflage'), false);
check('Optical Camouflage stays on mechs', ids('mech').includes('camouflage'), true);

// Everything else is a Unit-level rule with no kind restriction, so it stays on
// every kind rather than being guessed away.
for (const id of ['fci', 'fragile', 'immobilized', 'lowProfile', 'highlight', 'targetTracer', 'smoke']) {
  check(`${id} applies to every unit kind`, ['mech', 'drone', 'projectile'].filter((k) => !ids(k).includes(id)), []);
}
check('projectiles keep the majority of tokens', ids('projectile').length, STATUSES.length - 2);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
