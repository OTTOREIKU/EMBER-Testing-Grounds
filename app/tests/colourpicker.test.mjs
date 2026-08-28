// The app's own colour picker, which replaced <input type="color"> because
// that control hands the job to the operating system and Windows still answers
// with the dialog it shipped in 1995.
//
// The maths is pure and is RUN here. The widget needs a DOM, so the parts of it
// that carry a trap are pinned by reading source -- chiefly the one that makes
// hand-written colour pickers feel broken:
//
//   HSV IS THE STATE. Black and white have no hue to read back out of RGB, so a
//   picker that re-derives its position from the hex on every change snaps the
//   cursor to red the instant you drag brightness to the bottom.
import { readFileSync, writeFileSync } from 'node:fs';

const src = (f) => readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8');

// colourpicker.ts imports nothing at all, so the slice is the file with its
// types stripped.
const tmp = new URL('./_colourpicker.slice.ts', import.meta.url);
writeFileSync(tmp, src('colourpicker.ts'));
const C = await import(tmp.href);

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}, got ${g}`); }
};
const ok = (name, cond) => check(name, !!cond, true);

// ---------- reading a colour ----------

console.log('\nreading a hex');

check('a short hex is expanded', C.normaliseHex('#abc'), '#aabbcc');
check('case is normalised', C.normaliseHex('#B6CC2C'), '#b6cc2c');
check('whitespace is tolerated', C.normaliseHex('  #abc '), '#aabbcc');
// The hex FIELD is typed into, and people do not always type the hash.
check('the hash is optional', C.normaliseHex('b6cc2c'), '#b6cc2c');
check('and a short one without it works too', C.normaliseHex('abc'), '#aabbcc');
// A three-digit prefix of a six-digit colour is itself a colour, so typing
// "#b6cc2c" really does pass through "#b6c" and the board flashes that shade on
// the way. Every hex field behaves this way; refusing short hex to avoid it
// would cost more than the flash does.
check('a three-digit prefix is a colour in its own right', C.normaliseHex('#b6c'), '#bb66cc');
// null, not a fallback colour: the field has to tell "still typing" apart from
// "that is a colour", and a fallback would repaint on every keystroke.
check('a four-digit one is not', C.normaliseHex('#b6cc'), null);
check('a colour name is refused', C.normaliseHex('red'), null);
check('and rgb() notation', C.normaliseHex('rgb(1,2,3)'), null);
check('and a non-string', C.normaliseHex(42), null);
check('and nothing', C.normaliseHex(undefined), null);
check('four digits is not a colour', C.normaliseHex('#abcd'), null);
check('nor is five', C.normaliseHex('#abcde'), null);
check('nor seven', C.normaliseHex('#abcdef0'), null);

// ---------- the colour wheel ----------

console.log('\nhex to HSV and back');

// The six vertices of the hue wheel, which is where a wrong sector shows up.
const VERTEX = [
  ['#ff0000', 0], ['#ffff00', 1 / 6], ['#00ff00', 2 / 6],
  ['#00ffff', 3 / 6], ['#0000ff', 4 / 6], ['#ff00ff', 5 / 6],
];
for (const [hex, h] of VERTEX) {
  const got = C.hexToHsv(hex);
  check(`${hex} sits at hue ${Math.round(h * 360)}°`,
    [Math.round(got.h * 360), got.s, got.v], [Math.round(h * 360), 1, 1]);
  check(`and comes back out as ${hex}`, C.hsvToHex({ h, s: 1, v: 1 }), hex);
}

check('white is fully bright and unsaturated', C.hexToHsv('#ffffff'), { h: 0, s: 0, v: 1 });
check('black is neither', C.hexToHsv('#000000'), { h: 0, s: 0, v: 0 });
check('a grey has no saturation', C.hexToHsv('#808080').s, 0);
// THE TRAP, stated as a fact about the maths: a grey cannot say what hue it
// was, which is why the widget holds HSV instead of re-reading the hex.
check('and no hue to recover either', C.hexToHsv('#808080').h, 0);

// Every 24-bit colour must survive the trip, or a picker drifts as you use it.
let drift = 0, worst = null;
for (let r = 0; r < 256; r += 17) {
  for (let g = 0; g < 256; g += 11) {
    for (let b = 0; b < 256; b += 13) {
      const hex = `#${[r, g, b].map((n) => n.toString(16).padStart(2, '0')).join('')}`;
      const back = C.hsvToHex(C.hexToHsv(hex));
      if (back !== hex) { drift++; worst ??= `${hex} -> ${back}`; }
    }
  }
}
check(`every colour round-trips exactly (${16 * 24 * 20} sampled)`, [drift, worst], [0, null]);

// Hue is circular, and 1 is the same place as 0. The hue surface is dragged to
// its right edge constantly, so this is not a corner case.
check('the far end of the hue bar is red again', C.hsvToHex({ h: 1, s: 1, v: 1 }), '#ff0000');
check('and so is the near end', C.hsvToHex({ h: 0, s: 1, v: 1 }), '#ff0000');
// Value zero is black whatever the hue and saturation say.
check('no brightness is black at any hue', C.hsvToHex({ h: 0.7, s: 1, v: 0 }), '#000000');
check('no saturation is a grey at any hue', C.hsvToHex({ h: 0.7, s: 0, v: 0.5 }), '#808080');

// ---------- the presets ----------

console.log('\nthe presets');

check('every preset is a real colour',
  C.GRID_PRESETS.filter((c) => C.normaliseHex(c) !== c), []);
check('and none is listed twice', new Set(C.GRID_PRESETS).size, C.GRID_PRESETS.length);
check('they fill whole rows of six', C.GRID_PRESETS.length % 6, 0);
// Standardising the grid took each theme's own colour away. The presets are
// where they went, so nothing that used to be available became unreachable.
for (const [name, c] of [['Slate, the default', '#9fb2c4'], ['the official board lime', '#b6cc2c'],
  ['Trace teal', '#5ec9c0'], ['Canopy green', '#b6cf93']]) {
  ok(`${name} is one click away`, C.GRID_PRESETS.includes(c));
}
// A light board needs a dark grid, and none of the bright presets can give one.
ok('and at least one preset is dark enough for a light board',
  C.GRID_PRESETS.some((c) => C.hexToHsv(c).v < 0.45));

// ---------- the widget ----------

console.log('\nthe widget');

const cp = src('colourpicker.ts');

ok('HSV is held as the state rather than re-read from the hex',
  /const hsv = hexToHsv\(/.test(cp) && /hsv\.h = next\.s \? next\.h : hsv\.h/.test(cp));
// Two places take a colour from outside -- typing and the preset chips -- and
// both have to keep the held hue when what arrives is a grey.
check('and every place that takes an outside colour keeps the hue',
  (cp.match(/hsv\.h = next\.s \? next\.h : hsv\.h/g) ?? []).length, 2);

ok('the hex field is not rewritten under a caret mid-keystroke',
  /if \(!typing\) hex\.value = c;/.test(cp));
ok('and typing settles on change and on blur',
  /hex\.addEventListener\('change', settle\)/.test(cp) && /hex\.addEventListener\('blur', settle\)/.test(cp));

// Painting is free, saving is not: a drag fires onInput at pointer rate.
ok('dragging paints', /const live = \(\).*opts\.onInput\(/s.test(cp));
ok('while saving waits for the end of the drag', /const done = \(\)[^\n]*opts\.onDone\(/.test(cp));
ok('and the drag end is what calls it',
  /draggable\(sv,[\s\S]*?, done,/.test(cp) && /draggable\(hue,[\s\S]*?, done,/.test(cp));

// The popover cannot live inside the dialog that opens it: that dialog clips.
ok('the popover is mounted on the body', /document\.body\.appendChild\(pop\)/.test(cp));
ok('and is placed from its anchor', /anchor\.getBoundingClientRect\(\)/.test(cp));
ok('flipping above when there is no room below', /a\.top - h - 6/.test(cp));
ok('clamped into the viewport either way',
  /Math\.max\(4, Math\.min\(a\.left, window\.innerWidth - w - 4\)\)/.test(cp));

// A body-level popover outlives the dialog it belongs to unless it watches.
ok('it closes when its anchor leaves the page', /if \(!anchor\.isConnected\) close\(\)/.test(cp));
ok('Escape closes it', /ev\.key !== 'Escape'/.test(cp));
// Swallowed, or one Escape closes the picker AND the dialog behind it.
ok('and that Escape does not reach the dialog behind it', /ev\.stopPropagation\(\)/.test(cp));
ok('an outside click closes it',
  /!pop\.contains\(t\) && !anchor\.contains\(t\)/.test(cp));
// FOUND BY DRIVING IT, not by the suite: the picker closes ITSELF on Escape, on
// an outside click and when its anchor goes, so a caller keeping the returned
// close function to build a toggle holds a dead one after every normal close.
// The first click on the trigger afterwards was spent re-closing nothing and
// the picker did not reopen.
ok('and every way of closing tells the caller', /opts\.onClose\?\.\(\)/.test(cp));
ok('from inside close(), so no exit path can skip it',
  /const close = \(\)[\s\S]*?opts\.onClose\?\.\(\)/.test(cp));
// Capture phase: a dialog that stops propagation on its own backdrop would
// otherwise leave the picker open over a page that has moved on.
ok('listening in the capture phase so nothing can swallow it first',
  /addEventListener\('pointerdown', outside, true\)/.test(cp));

ok('the drag keeps following the pointer outside the popover',
  /setPointerCapture/.test(cp) && /releasePointerCapture/.test(cp));
ok('and a cancelled pointer ends the drag like a release',
  /'pointercancel', up/.test(cp));
ok('both surfaces are reachable from the keyboard',
  (cp.match(/tabindex="0"/g) ?? []).length === 2 && /ArrowLeft/.test(cp));

// ---------- what the board page does with it ----------

console.log('\nthe board page');

const main = src('main.ts');
ok('the grid colour opens our picker and not a native well',
  /openColourPicker\(\{/.test(main) && !/id="grid-colour" type="color"/.test(main));
ok('the trigger shows the colour it holds',
  /gridDot\.style\.background = state\.gridColour/.test(main));
ok('and its hex, so the setting reads without opening anything',
  /gridHex\.textContent = state\.gridColour/.test(main));
ok('painting happens on input', /onInput: \(hex\) =>/.test(main));
ok('and saving only when a change settles', /onDone: \(\) => save\(\)/.test(main));
ok('clicking the trigger again closes it rather than stacking a second',
  /if \(closePicker\) \{ closePicker\(\); closePicker = null; return; \}/.test(main));
// The other half of that toggle: without this the handle survives a close the
// caller did not make, and the trigger goes dead for exactly one click.
ok('and the handle is dropped when the picker closes on its own',
  /onClose: \(\) => \{ closePicker = null; \}/.test(main));
ok('Reset still works without a well to write a value into',
  /board\.setGridColour\(DEFAULT_GRID_COLOUR\)/.test(main));

const css = src('colourpicker.css');
ok('the picker sits above the dialog that opens it', /z-index: 1200/.test(css));
ok('and its surfaces do not scroll the page on a touch drag',
  (css.match(/touch-action: none/g) ?? []).length === 2);
ok('the cursor centres on the point it marks', /translate\(-50%, -50%\)/.test(css));

console.log(`\n  ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
