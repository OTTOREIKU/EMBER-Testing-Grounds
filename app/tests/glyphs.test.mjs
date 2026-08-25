// Checks that every placeholder printed on a card turns into a glyph, and that
// none are left showing their braces to the reader.
import { readFileSync, writeFileSync } from 'node:fs';

const src = readFileSync(new URL('../src/glyphs.ts', import.meta.url), 'utf8');
const tmp = new URL('./_glyphs.slice.ts', import.meta.url);
// The icon set is drawn elsewhere; a marker stands in for it so this stays a
// test of the placeholder grammar rather than of the SVG.
const stub = 'const iconSvg = (o, n) => `<svg data-icon="${o.type}" width="${n}"></svg>`;\n';
writeFileSync(tmp, stub + src.replace(/^import[^\n]*\n/gm, ''));
const G = await import(tmp.href);

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}, got ${g}`); }
};

console.log('Glyph placeholders\n');

const expands = (s) => !/[{}]/.test(G.expandGlyphs(s));

// ---------- named glyphs ----------

check('a die colour on its own expands', expands('{Y}'), true);
check('an icon expands', expands('{Dodge}'), true);
check('the misspelled lightning still expands', expands('{Lightining}'), true);
check('and the correctly spelled one does too', expands('{lightning}'), true);
check('the boxed automatic marker expands', expands('{!}'), true);

// ---------- counted dice ----------

// Cards write a count as often as a bare colour: "for every {3Y}, +{1Y}". A
// colour-only table leaves these printed as literal braces on the card.
check('a counted die expands', expands('{1Y}'), true);
check('a larger count expands', expands('{3R}'), true);
check('a counted white die expands', expands('{1W}'), true);
check('lower case works too', expands('{2b}'), true);
check('one die renders one pip', (G.expandGlyphs('{1R}').match(/glyph-die/g) ?? []).length, 1);
check('three dice render three pips', (G.expandGlyphs('{3R}').match(/glyph-die/g) ?? []).length, 3);
check('the count is named in the title', /title="3 Red dice"/.test(G.expandGlyphs('{3R}')), true);
check('a single die is not pluralised', /title="1 Red die"/.test(G.expandGlyphs('{1R}')), true);
check('counted dice stay on one line', /glyph-dice/.test(G.expandGlyphs('{3R}')), true);

// ---------- THE CLASS HAS TO MATCH A REAL RULE ----------
//
// This file already checked the TITLE of a counted die and the wrapper class,
// and both were right the whole time the colour was wrong: `{R}` emitted
// `die-s1` / `die-s2`, which are the SEAT colours, and nothing styles those, so
// every Blue and Red die in card text drew as an empty bordered box while the
// tooltip cheerfully said "Red die". Yellow and White hid it by having the same
// name in both vocabularies.
//
// So the assertion that matters is not the shape of the markup but whether the
// class it names EXISTS in the stylesheets that have to draw it.
check('a blue die names the blue class', /glyph-die die-blue/.test(G.expandGlyphs('{B}')), true);
check('a red die names the red class', /glyph-die die-red/.test(G.expandGlyphs('{R}')), true);
check('a counted red die too', /glyph-die die-red/.test(G.expandGlyphs('{3R}')), true);
check('and no die borrows a seat colour',
  /die-s[12]\b/.test(['{B}', '{Y}', '{R}', '{W}', '{3R}', '{2B}'].map(G.expandGlyphs).join(' ')), false);

{
  const css = ['../src/styles.css', '../src/reference.css']
    .map((p) => readFileSync(new URL(p, import.meta.url), 'utf8'));
  // Every colour the expander can emit, taken from its own output rather than
  // from a list here, so a colour added later is covered without editing this.
  const emitted = [...new Set(
    ['{B}', '{Y}', '{R}', '{W}']
      .map(G.expandGlyphs)
      .flatMap((h) => [...h.matchAll(/glyph-die die-([a-z0-9]+)/g)].map((m) => m[1])),
  )];
  check('the expander emits four die colours', emitted.length, 4);
  // BOTH stylesheets: glyphs.ts is shared by the board and the reference, so a
  // colour styled in one and not the other is broken on half the app.
  const missing = emitted.filter((c) => !css.every((s) => s.includes(`.glyph-die.die-${c}`)));
  check('and every one is styled in BOTH stylesheets', missing, []);
}

// ---------- things that are not glyphs ----------

check('an unknown placeholder is left alone', G.expandGlyphs('{Nonsense}'), '{Nonsense}');
check('a zero count is not a die', G.expandGlyphs('{0R}'), '{0R}');
check('an absurd count is left alone', G.expandGlyphs('{99R}'), '{99R}');
check('an unknown colour is left alone', G.expandGlyphs('{2Q}'), '{2Q}');

// ---------- masking ----------

// {Heavy Hit} and {Dodge} are also keyword names, so the linker would wrap an
// anchor inside the braces and the placeholder would stop matching.
const { masked, restore } = G.maskGlyphs('gains {Heavy Hit} and {2Y}');
check('masking hides the placeholders from the linker', /[{}]/.test(masked), false);
check('restoring brings the glyphs back', /glyph-ico/.test(restore(masked)), true);
check('and the counted die survives the round trip', (restore(masked).match(/glyph-die/g) ?? []).length, 2);

// ---------- THE ACTION LENGTH CAPSULE, as the cards print it ----------
//
// Measured off ZHRA-201 (Power Shot, Long) and ZHLA-102 (Command Coordination,
// Short) rather than invented: a THREE slot capsule filled BOTTOM UP. A Short
// action is one segment at the foot of a full-height capsule, NOT a short
// capsule, and that is the whole point of matching the print - a player should
// read it the same way on screen and on the table.
const fill = (h) => [...h.matchAll(/<i( class="on")?><\/i>/g)].map((m) => (m[1] ? '#' : '.')).join('');

check('a capsule always has three slots', fill(G.tickCapsule(1)).length, 3);
check('Short is one segment', fill(G.tickCapsule(1)), '..#');
check('Medium is two', fill(G.tickCapsule(2)), '.##');
check('Long is three', fill(G.tickCapsule(3)), '###');
// BOTTOM ANCHORED. Filling from the top would look tidy and be wrong.
check('and the fill is bottom anchored, never top', fill(G.tickCapsule(1)).startsWith('..'), true);
// A Passive costs no Ticks. An empty capsule would read as "free"; no capsule
// reads as "not a thing you choose to spend on", which is what a Passive is.
check('no ticks draws no capsule', /class="tick-cap none"/.test(G.tickCapsule(0)), true);
check('a count above three cannot overflow the capsule', fill(G.tickCapsule(9)), '###');
check('nor below zero', fill(G.tickCapsule(-2)), '...');
// The title is where OUR extra knowledge goes: the printed slots are identical,
// so the Maneuver Tick a Long action also costs is said in words rather than
// drawn in a second colour we invented.
check('the title carries the cost breakdown',
  /title="Long \(1 Maneuver Tick \+ 2 Action Ticks\)"/.test(G.tickCapsule(3, 'Long (1 Maneuver Tick + 2 Action Ticks)')), true);
check('and the capsule is styled in BOTH stylesheets',
  ['../src/styles.css', '../src/reference.css']
    .map((f) => readFileSync(new URL(f, import.meta.url), 'utf8'))
    .every((s) => s.includes('.tick-cap') && s.includes('.tick-cap i.on')), true);

// ---------- THE POOL DRAWN AS DICE ----------
// The card prints an Attack pool as a row of coloured squares, never "3Y 1R".
// This goes back through expandGlyphs rather than writing its own row, so there
// is ONE drawing of a die in the app: a second would be free to drift from the
// one the rules text renders, often in the same paragraph.
const pips = (h) => (h.match(/glyph-die/g) ?? []).length;

check('a red pool draws red pips', /die-red/.test(G.diePips(3, 'R')), true);
check('three of them', pips(G.diePips(3, 'R')), 3);
check('a yellow pool draws yellow', /die-yellow/.test(G.diePips(4, 'Y')), true);
check('and the count is named for a screen reader', /title="4 Yellow dice"/.test(G.diePips(4, 'Y')), true);
check('a single die is not pluralised', /title="1 Red die"/.test(G.diePips(1, 'R')), true);
// Nothing at all rather than an empty row: an action with no Red dice should
// not print a Red anything.
check('no dice draws nothing', G.diePips(0, 'R'), '');
check('and neither does a missing count', G.diePips(undefined, 'Y'), '');
// expandGlyphs only draws 1 to 9. A literal "{12R}" on screen would be worse
// than the plain text this replaced, so it falls back instead.
check('an out-of-range count falls back to text', G.diePips(12, 'R'), '12R');
check('rather than leaking the placeholder', /[{}]/.test(G.diePips(12, 'R')), false);


console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
