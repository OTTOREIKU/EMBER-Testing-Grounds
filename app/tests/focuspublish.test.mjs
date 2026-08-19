// The combat mirror deadlock, reported from a live online game 2026-08-19.
//
// The attack reached the defence roll, the defender rolled, and then BOTH
// clients waited for each other forever. Cause: render() published the mirror
// BEFORE stepDefense() called beginFocus(), and beginFocus -> skipFocusStages
// mutates focus.stage without rendering again — so the defender was told
// focus: null and never learned it was their turn to declare.
//
// It only bit when the ATTACKER got no Focus prompt, because an attacker who
// does gets buttons whose click calls focusDeclare() -> render(), and that
// render was the accidental flush keeping ordinary Mech-vs-Mech combat alive.
// canFocus refuses the attacker in exactly three cases and all three hung:
// a DRONE attacker, a Mech at 0 Link, and any Surplus round (which is why a
// Mutilation follow-up hung a fight that had just resolved normally).
//
// Checked by SOURCE ORDER rather than by driving the helper: the fix is that
// one call moved, and a DOM-driven harness for AttackHelper is a bundling job
// (esbuild + a DOM shim) that no other test here carries. Order is the bug.
import { readFileSync } from 'node:fs';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}, got ${g}`); }
};
const src = readFileSync(new URL('../src/combat.ts', import.meta.url), 'utf8');

console.log('Combat mirror publish ordering\n');

// ---------- The fix: publish is no longer the first thing render() does ----------
const renderAt = src.indexOf('private render(): void {');
const renderEnd = src.indexOf('// ---------- Multi-Target', renderAt);
const render = src.slice(renderAt, renderEnd);
check('render() no longer publishes inline', /this\.publishView\?\.\(\{/.test(render), false);
check('it calls publishMirror instead', /this\.publishMirror\(\);/.test(render), true);

// The ordering IS the fix, so it is asserted directly.
const build = render.indexOf('this.root.replaceChildren(el);');
const publish = render.indexOf('this.publishMirror();');
check('and it publishes AFTER the step is built, not before',
  build > 0 && publish > build, true);

// ---------- The three attackers that get no Focus prompt ----------
// Each is a case where nothing else would ever flush the stage. They are read
// off canFocus so a change to its rules breaks this test rather than silently
// re-opening the deadlock.
const canFocus = src.slice(src.indexOf('private canFocus('), src.indexOf('private beginFocus('));
check('a Surplus round refuses the attacker — the Mutilation case',
  /side === 'attacker' && c\.surplusRound > 0/.test(canFocus), true);
check('a non-Mech attacker is refused — the Drone case', /t\.kind === 'mech'/.test(canFocus), true);
check('and a Mech at 0 Link is refused', /\(t\.link \?\? 0\) > 0/.test(canFocus), true);

// ---------- beginFocus still does not render, which is WHY order matters ----------
const beginFocus = src.slice(src.indexOf('private beginFocus('), src.indexOf('private focusDeclare('));
check('beginFocus still settles the stage without rendering',
  /this\.render\(\)/.test(beginFocus), false);
check('so the publish must come after it — the reason is recorded on publishMirror',
  /beginFocus\(\) while the DOM|beginFocus -> skipFocusStages/.test(src), true);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
