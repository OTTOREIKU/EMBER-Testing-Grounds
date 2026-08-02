// Checks the command layer: check() as the single home of a rule, apply() as a
// deterministic mutation, perform() as the warn-don't-block pairing.
import { readFileSync, writeFileSync } from 'node:fs';

const src = readFileSync(new URL('../src/commands.ts', import.meta.url), 'utf8');
const types = readFileSync(new URL('../src/types.ts', import.meta.url), 'utf8');
const timings = types.slice(types.indexOf('export const TIMINGS'), types.indexOf('export type TokenShape'));
const tmp = new URL('./_commands.slice.ts', import.meta.url);
writeFileSync(
  tmp,
  'type GameState = any;\ntype Side = any;\ntype Timing = any;\ntype TimingDef = any;\n'
    + timings
    + src.replace(/^import[^\n]*\n/gm, ''),
);
const C = await import(tmp.href);

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}, got ${g}`); }
};

const mech = (uid, side, extra = {}) => ({ uid, side, kind: 'mech', partStates: { torso: 'intact' }, ...extra });
const world = (tokens, phase = 1) => ({ tokens, round: { n: 1, phase, firstPlayer: 's1' } });

console.log('The command layer\n');

// ---------- setTiming: check ----------

const s = world([mech(1, 's1'), mech(2, 's2'), { uid: 3, side: 's1', kind: 'drone', partStates: {} }]);
const cmd = (over = {}) => ({ kind: 'setTiming', seat: 's1', uid: 1, timing: 'firing', ...over });

check('a legal dial set passes', C.check(s, cmd()).ok, true);
check('clearing the dial is legal too', C.check(s, cmd({ timing: undefined })).ok, true);
check('a missing unit is refused', C.check(s, cmd({ uid: 99 })).ok, false);
check('a drone has no dial', C.check(s, cmd({ uid: 3 })).ok, false);
check('another squad\'s mech is refused', C.check(s, cmd({ uid: 2 })).ok, false);
check('and the reason names the rule', /own dials/.test(C.check(s, cmd({ uid: 2 })).why), true);
check('a made-up timing is refused', C.check(s, cmd({ timing: 'sideways' })).ok, false);
check('a destroyed mech is refused', C.check(world([mech(1, 's1', { partStates: { torso: 'destroyed' } })]), cmd()).ok, false);
check('outside the planning phase it is refused', C.check(world([mech(1, 's1')], 2), cmd()).ok, false);
check('check never mutates', (() => { const w = world([mech(1, 's1')]); C.check(w, cmd()); return w.tokens[0].timing; })(), undefined);

// ---------- setTiming: apply ----------

const w1 = world([mech(1, 's1')]);
C.apply(w1, cmd());
check('apply sets the dial', w1.tokens[0].timing, 'firing');
C.apply(w1, cmd({ timing: undefined }));
check('apply clears the dial', w1.tokens[0].timing, undefined);
C.apply(w1, cmd({ uid: 99 }));
check('apply on a missing unit changes nothing', w1.tokens.length, 1);

// The same command on the same state must always do the same thing, or a
// mirrored seat and a replayed log would diverge from the original.
const a = world([mech(1, 's1')]);
const b = world([mech(1, 's1')]);
C.apply(a, cmd());
C.apply(b, cmd());
check('apply is deterministic across copies', a.tokens[0].timing, b.tokens[0].timing);

// ---------- perform: warn, do not block ----------

const w2 = world([mech(2, 's2')], 2);
const verdict = C.perform(w2, cmd({ uid: 2 }));
check('perform applies even when the check refuses', w2.tokens[0].timing, 'firing');
check('and hands back the why', verdict.ok, false);
check('a clean perform reports ok', C.perform(world([mech(1, 's1')]), cmd()).ok, true);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
