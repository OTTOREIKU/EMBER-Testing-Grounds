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
// The Mech test and the Link floor moved OUT of canFocus and into units.ts's
// canAffordFocus, which is now asked by all four Focus surfaces rather than
// each keeping its own answer (they used to disagree: > 0 here, > 1 in two
// places and no gate at all on the mirror). Both refusals still hold; this
// follows them to their new home rather than pinning the old wording.
check('canFocus asks the one shared affordability reader',
  /canAffordFocus\(this\.data, t\)/.test(canFocus), true);
const units = readFileSync(new URL('../src/units.ts', import.meta.url), 'utf8');
const afford = units.slice(units.indexOf('export function canAffordFocus'), units.indexOf('// LPA-23-2 Onyx Mellow Chord'));
check('a non-Mech attacker is refused — the Drone case', /t\.kind !== 'mech'/.test(afford), true);
// > 1, not > 0: a Mech at exactly 1 Link cannot spend it (4.10, FAQ L1), and
// this gate used to admit it and then watch the command refuse.
check('and a Mech that cannot spend a Link is refused', /\(t\.link \?\? 0\) > 1/.test(afford), true);
// ZPA-39 Cadaver is the one exception, because it consumes nothing.
check('unless the reroll costs nothing at all', /focusIsFree\(data, t\)/.test(afford), true);

// ---------- beginFocus still does not render, which is WHY order matters ----------
const beginFocus = src.slice(src.indexOf('private beginFocus('), src.indexOf('private focusDeclare('));
check('beginFocus still settles the stage without rendering',
  /this\.render\(\)/.test(beginFocus), false);
check('so the publish must come after it — the reason is recorded on publishMirror',
  /beginFocus\(\) while the DOM|beginFocus -> skipFocusStages/.test(src), true);

// ---------- the resolution box reaches the defender, drawn ONCE ----------
//
// Otto, playing online 2026-08-19: "sometimes as a defender I don't see this
// animated resolution box". The duel was computed by resolve() and rendered
// only into the attacker's window, so the mirror had nothing to draw from.
//
// Checked by source shape for the same reason the ordering above is: driving
// AttackHelper needs a DOM shim no test here carries. What is being defended is
// that there stays exactly ONE renderer — this app has drifted every time the
// same thing was drawn twice, and a strip reading "dodged" on one screen and
// "blocked" on the other is worse than the nothing the defender used to get.
const matchSrc = readFileSync(new URL('../src/match.ts', import.meta.url), 'utf8');
const hudSrc = readFileSync(new URL('../src/matchhud.ts', import.meta.url), 'utf8');

check('the strip is published on the view', /resolution: c\.step === 'resolve'/.test(src), true);
// Only at the resolution step: before it nothing is settled, and a strip left
// over from the round before a Surplus would describe dice about to be rerolled.
check('and only from the resolution step', /c\.step === 'resolve' \? c\.resolution \?\? null : null/.test(src), true);
// The published strip is the one that was DRAWN, not a second derivation of it.
const stepResolve = src.slice(src.indexOf('private stepResolve()'), src.indexOf('private finish('));
check('stepResolve hands the drawn duel to the view', /c\.resolution = \{ duel, text \}/.test(stepResolve), true);
check('and draws it through the shared renderer', /resolutionHtml\(\{ duel, text \}\)/.test(stepResolve), true);

// One producer of the markup, one player of the animation.
const producers = (src.match(/<div class="duel">/g) ?? []).length;
check('combat.ts builds the strip markup in exactly one place', producers, 1);
check('the mirror imports that renderer rather than owning one',
  /import \{[^}]*resolutionHtml[^}]*\} from '\.\/combat'/.test(matchSrc), true);
check('and the mirror never builds duel markup itself', /class="duel-col|class="duel-grid"/.test(matchSrc), false);
check('the HUD plays the shared animation', /import \{[^}]*playDuel[^}]*\} from '\.\/combat'/.test(hudSrc), true);

// The strip is written settled and the animation only ever TAKES those classes
// away, so a defender on a backgrounded tab — where nothing composites and
// playDuel bails out early — still ends up with a readable box.
check('every column is born shown and resolved', /duel-col shown resolved/.test(src), true);
check('a hidden tab skips the animation and settles instead',
  /document\.hidden\) return done\(\)/.test(src), true);
// requestAnimationFrame does not fire on a page that is not compositing, which
// is why both callers kick the strip with a timeout instead.
check('the attacker kicks it with a timeout', /window\.setTimeout\(\(\) => playDuel\(duelEl\), 0\)/.test(src), true);
check('and so does the mirror', /window\.setTimeout\(\(\) => playDuel\(duel\), 0\)/.test(hudSrc), true);
// The mirror's body is rewritten whenever ANY part of the view changes — a log
// line is enough — so the replay is keyed on the strip rather than the rewrite.
check('the mirror replays only when the strip itself changed',
  /key !== lastMirrorDuel/.test(hudSrc), true);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
