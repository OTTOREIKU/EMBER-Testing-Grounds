// Checks the Electronic Counter-roll winner against rulebook 4.11.2 step 2.
//   more [Lightning] wins; on a tie more [Light Hit] wins; level on both -> Initiator.
import { readFileSync, writeFileSync } from 'node:fs';

// Slice out just the exported comparator — combat.ts's other imports need the DOM.
const srcUrl = process.argv[2] ?? new URL('../src/combat.ts', import.meta.url);
const src = readFileSync(srcUrl, 'utf8');
const start = src.indexOf('export function resolveCounterRoll');
const end = src.indexOf('interface EwCtx');
if (start < 0 || end < 0) throw new Error('could not locate resolveCounterRoll in ' + srcUrl);
const tmp = new URL('./_counterroll.slice.ts', import.meta.url);
writeFileSync(tmp, src.slice(start, end));
const { resolveCounterRoll } = await import(tmp.href);

let pass = 0, fail = 0;
const check = (name, got, want) => {
  if (got === want) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${want}, got ${got}`); }
};
const win = (il, ilh, rl, rlh) =>
  resolveCounterRoll({ lightning: il, light: ilh }, { lightning: rl, light: rlh }).initiatorWins;

console.log('resolveCounterRoll — rulebook 4.11.2 step 2\n');

// Lightning is the primary comparison and outranks any number of Light Hits.
check('2 Lightning vs 1 -> Initiator', win(2, 0, 1, 9), true);
check('1 Lightning vs 2 -> Responder', win(1, 9, 2, 0), false);

// Only when Lightning is level does Light Hit decide it.
check('Lightning level, 3 Light vs 2 -> Initiator', win(1, 3, 1, 2), true);
check('Lightning level, 2 Light vs 3 -> Responder', win(1, 2, 1, 3), false);

// The rule this test exists for: a dead heat is an Initiator win, not a miss.
check('0/0 vs 0/0 -> Initiator takes the tie', win(0, 0, 0, 0), true);
check('2/5 vs 2/5 -> Initiator takes the tie', win(2, 5, 2, 5), true);

// A responder that rolls nothing cannot win, even against an empty initiator roll.
check('initiator whiffs, responder whiffs -> Initiator', win(0, 0, 0, 0), true);
check('initiator whiffs, responder scores -> Responder', win(0, 0, 0, 1), false);

// Sweep: the winner must never depend on Light Hits when Lightning differs.
let sweepBad = 0;
for (let il = 0; il <= 4; il++)
  for (let rl = 0; rl <= 4; rl++)
    if (il !== rl)
      for (let a = 0; a <= 4; a++)
        for (let b = 0; b <= 4; b++)
          if (win(il, a, rl, b) !== il > rl) sweepBad++;
check('sweep 400 combinations — Lightning strictly outranks Light Hit', sweepBad, 0);

// Sweep: with Lightning level the result must be light >= light, never a Responder tie win.
let tieBad = 0;
for (let l = 0; l <= 4; l++)
  for (let a = 0; a <= 6; a++)
    for (let b = 0; b <= 6; b++)
      if (win(l, a, l, b) !== a >= b) tieBad++;
check('sweep 245 combinations — ties resolve to the Initiator', tieBad, 0);

console.log(`\n${fail === 0 ? 'ALL PASS' : 'FAILURES'} — ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
