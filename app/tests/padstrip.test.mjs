// THE PAD'S GUIDED STRIP FOLD AND THE ROUND CHIP'S GO CHEVRON (OTTO,
// 2026-09-29). The Planning dials filled the strip to its cap and left half a
// screen for the sheet, so the strip's head folds it to one line; and the way
// on, the round chip at the top, wears the site's go chevron while a tap
// turns the phase, since Guided players did not always find it. Pinned as
// text: the fold is a render-time rewrite of the strip's html, and the pad's
// wiring is a page module.
import { readFileSync } from 'node:fs';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}, got ${g}`); }
};
const src = (p) => readFileSync(new URL(p, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const pad = src('../pad/pad.ts');
const css = src('../pad/pad.css');
const guided = src('../pad/guided.ts');

console.log('The strip fold and the go chevron\n');

check('the strip is painted through the fold, which marks the strip folded',
  [/paint\('pad-turn', foldableTurn\(pending \? pendingGuidedHtml\(\) : turnHtml\(guide\)\)\);\s*turn\.classList\.toggle\('folded', turnFold !== null\);/.test(pad)], [true]);
check('the head becomes a button that folds and opens, and says which it is',
  [/head\.dataset\.act = 'turn-fold';/.test(pad), /head\.setAttribute\('aria-expanded', String\(!folded\)\);/.test(pad), /case 'turn-fold':\s*turnFold = turnFold === null \? \(el\.textContent \?\? ''\)\.trim\(\) : null;/.test(pad)],
  [true, true, true]);
check('folded, only the body after the head goes: a reaction owed above it stays in view',
  /if \(folded\) while \(head\.nextSibling\) head\.nextSibling\.remove\(\);/.test(pad), true);
check('a new step opens the fold by itself: the fold is keyed to the head it was made on',
  /if \(turnFold !== null && turnFold !== key\) turnFold = null;/.test(pad), true);
check('the head is styled as the pad fold: the width of the strip, the arrow at its end, down when folded',
  [/\.pad-turn > button\.pad-turn-h \{[^}]*width: 100%;/.test(css), /\.pad-turn > button\.pad-turn-h::after \{ content: '▴';/.test(css), /\.pad-turn\.folded > button\.pad-turn-h::after \{ content: '▾'; \}/.test(css)],
  [true, true, true]);

check('the round chip wears the go chevron only while a tap turns the phase in a Guided game',
  [/const go = guided && !stalled \? '<span class="ui-go" aria-hidden="true">›<\/span>' : '';/.test(pad), /\$\{roundLabel\}\$\{hint\}\$\{go\}/.test(pad)],
  [true, true]);
check('solo Guided reads Continue on the chip too, where the strip\'s notes point',
  /const hint = !room \? \(guided && !stalled \? '<em>Continue<\/em>' : ''\) : rd\.me && !rd\.them/.test(pad), true);
check('the chip\'s hover fills the chevron, as the landing\'s rows do',
  /\.pad-bar-round:hover \.ui-go, \.pad-bar-round\.go \.ui-go \{ background: var\(--accent\); color: var\(--on-accent\); \}/.test(css), true);
check('the strip\'s notes say where Continue is',
  [(guided.match(/Continue at the top/g) ?? []).length >= 4, /Continue when ready\.|Continue when both are ready\./.test(guided)], [true, false]);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
