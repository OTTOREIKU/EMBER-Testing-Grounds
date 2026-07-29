// Checks End Phase token management: red comes off, yellow flips to red
// (rulebook 3.7.2; Square colours per 2.5.3 on book p.23, Hexagons per 6.3.3).
import { readFileSync, writeFileSync } from 'node:fs';

const src = readFileSync(new URL('../src/types.ts', import.meta.url), 'utf8');
const start = src.indexOf('export function statusCount');
const end = src.indexOf('export type BattleScale');
if (start < 0 || end < 0) throw new Error('could not locate the token helpers in types.ts');
const tmp = new URL('./_tokendecay.slice.ts', import.meta.url);
writeFileSync(
  tmp,
  'type Token = any;\ntype StatusDef = any;\ntype Side = any;\ntype ScriptState = any;\ntype Opportunity = any;\ntype ExtraTick = any;\ntype Timing = any;\ntype TokenShape = any;\n' +
    src.slice(start, end),
);
const T = await import(tmp.href);

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}, got ${g}`); }
};

const unit = (statuses, expiring) => ({ statuses: [...statuses], expiring: expiring ? [...expiring] : undefined });

console.log('End Phase token management\n');

// The Square Token colours, read off the printed tokens on book p.23.
const decayOf = (id) => T.STATUSES.find((d) => d.id === id)?.decay;
check('Fragile is yellow, as printed on the token', decayOf('fragile'), 'yellow');
check('Low Recognition is the green one', decayOf('lowProfile'), 'green');
check('Immobilized is yellow', decayOf('immobilized'), 'yellow');
check('Fire Control Interference is yellow', decayOf('fci'), 'yellow');
check('Highlight is yellow', decayOf('highlight'), 'yellow');
// The three hexagons are printed in 6.3.3: Highlight and Target Tracer show a
// red and a yellow face, Low Profile shows a single green one.
check('Low Profile is green', decayOf('lowProfile'), 'green');
check('Target Tracer is yellow', decayOf('targetTracer'), 'yellow');
// Every Square and Hexagon Token now has a colour, so nothing is left to guess.
const shaped = T.STATUSES.filter((d) => d.shape === 'square' || d.shape === 'hexagon');
check('every square and hexagon token has a colour', shaped.filter((d) => !d.decay).map((d) => d.id), []);
check('and there are six of them', shaped.length, 6);

// A yellow token flips on its first End Phase and leaves on the second.
const t = unit(['immobilized']);
const first = T.ageTokens(t);
check('a fresh yellow token is not removed', first.removed, []);
check('it flips to its red side', first.flipped, ['immobilized']);
check('and is still on the unit', t.statuses, ['immobilized']);
check('now marked as expiring', t.expiring, ['immobilized']);
const second = T.ageTokens(t);
check('the next End Phase removes it', second.removed, ['immobilized']);
check('the unit is clear', t.statuses, []);
check('and nothing is left expiring', t.expiring, undefined);

// Green tokens are untouched by either pass.
const g = unit(['lowProfile', 'lowProfile']);
T.ageTokens(g);
T.ageTokens(g);
check('green tokens survive two end phases', g.statuses, ['lowProfile', 'lowProfile']);
check('and never flip', g.expiring, undefined);

// Low Profile is green, so the End Phase never touches it; it comes off only by
// Maneuvering or a successful Scan.
const u = unit(['lowProfile']);
const uOut = T.ageTokens(u);
check('Low Profile does not flip', uOut.flipped, []);
check('and is not removed', u.statuses, ['lowProfile']);
// An id with no colour at all is still left alone, which is the safety net.
const x = unit(['notAToken']);
const xOut = T.ageTokens(x);
check('an unknown id does not flip', xOut.flipped, []);
check('and is not removed', x.statuses, ['notAToken']);

// Mixed unit: red goes, yellow flips, green and unknown stay, all in one pass.
const m = unit(['fci', 'immobilized', 'notAToken', 'lowProfile'], ['fci']);
const mOut = T.ageTokens(m);
check('the red one is removed', mOut.removed, ['fci']);
check('the yellow one flips', mOut.flipped, ['immobilized']);
check('green and unknown are untouched', m.statuses.sort(), ['immobilized', 'lowProfile', 'notAToken']);
check('only the flipped one is expiring', m.expiring, ['immobilized']);

// Removal happens before flipping, so a token cannot be added and removed in one
// pass, which is what makes the decay take two rounds rather than one.
const order = unit(['immobilized']);
T.ageTokens(order);
check('a token flipped this pass is not also removed', order.statuses, ['immobilized']);

// A stack keeps its count through the flip rather than being thinned one a round.
const stack = unit(['fragile', 'fragile', 'fragile']);
T.ageTokens(stack);
check('a stack is not thinned', T.statusCount(stack.statuses, 'fragile'), 3);

// An empty unit is a no-op rather than an error.
const empty = unit([]);
const eOut = T.ageTokens(empty);
check('an empty unit reports nothing', [eOut.removed, eOut.flipped], [[], []]);
check('and stays empty', empty.statuses, []);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
