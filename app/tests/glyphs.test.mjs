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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
