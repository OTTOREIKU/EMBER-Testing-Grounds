// The board's art layer: which themes a board of a given size may wear, and
// how far down the art can be turned.
//
// Two of these pin traps that were live while the feature was being written:
//
//   1. buildGrid() THROWS THE ART NODE AWAY on every theme and every size
//      change. A dimmer that only wrote to the node it created would come back
//      at full strength the moment you resized the board or picked a different
//      style -- and it would look like the setting had not saved.
//
//   2. migrateState in units.ts rebuilds GameState field by field. A field it
//      does not name is silently dropped on EVERY load, so a display setting
//      that is never listed there survives until you reload and no further.
import { readFileSync, existsSync, writeFileSync } from 'node:fs';

const src = (f) => readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8');

// boards.ts reaches into data.ts for one thing: assetUrl, to resolve an image
// path against the deploy base. Stubbing it leaves the module standalone and
// makes the returned URL readable.
const tmp = new URL('./_boardart.slice.ts', import.meta.url);
writeFileSync(
  tmp,
  'const assetUrl = (p: string): string => `ASSET:${p}`;\n'
  + src('boards.ts').replace(/^import[^\n]*\n/gm, ''),
);
const B = await import(tmp.href);

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}, got ${g}`); }
};
const ok = (name, cond) => check(name, !!cond, true);

const ids = (list) => list.map((t) => t.id);

// ---------- a printed board is offered at its printed size ----------

console.log('\nwhich themes a board may wear');

check('the printed 12x12 board is offered on a 12x12 table',
  ids(B.themesFor(12)).includes('official'), true);
check('and not on a 16x16 one',
  ids(B.themesFor(16)).includes('official'), false);
check('the printed 16x16 board is offered on a 16x16 table',
  ids(B.themesFor(16)).includes('official-large'), true);
check('and not on a 12x12 one',
  ids(B.themesFor(12)).includes('official-large'), false);
// 18x18 is ours, not the publisher's. Neither photo fits it.
check('an 18x18 table is offered no printed board at all',
  ids(B.themesFor(18)).filter((id) => id.startsWith('official')), []);

// The generated themes draw themselves to whatever extent they are handed, so
// they are never gated. If this ever fails, a `grids` has been added by mistake.
for (const size of [12, 16, 18]) {
  const offered = ids(B.themesFor(size));
  check(`every drawn theme is offered at ${size}x${size}`,
    B.BOARD_THEMES.filter((t) => !t.grids).every((t) => offered.includes(t.id)), true);
}

// A board keeps what it is wearing even when the size no longer fits it, so the
// picker can never hide the board in front of you.
check('the painted theme is listed even where it does not fit',
  ids(B.themesFor(12, 'official-large')).includes('official-large'), true);
check('and asking to keep a theme adds nothing else',
  ids(B.themesFor(12, 'official-large')).length, ids(B.themesFor(12)).length + 1);
check('keeping a theme that already fits does not double it',
  ids(B.themesFor(12, 'official')).filter((id) => id === 'official').length, 1);

// Every gate has to name a real board size, or a theme silently disappears.
check('no theme is gated to a size the game does not have',
  B.BOARD_THEMES.filter((t) => t.grids && ![12, 16, 18].includes(t.grids)).map((t) => t.id), []);

// ---------- the new art is real ----------

console.log('\nthe 16x16 board art');

const large = B.BOARD_THEMES.find((t) => t.id === 'official-large');
ok('the theme exists', !!large);
check('it points at its own file', B.boardArtUrl(large, 1080), 'ASSET:boards/official-large.webp');
check('which is NOT the 12x12 board art',
  B.boardArtUrl(large, 1080) === B.boardArtUrl(B.boardTheme('official'), 1080), false);
ok('and the file is actually shipped',
  existsSync(new URL('../../assets/boards/official-large.webp', import.meta.url)));
// The board draws art into a square viewport and the printed board is square,
// so a size argument must not change an image theme's URL.
check('an image theme ignores the size it is drawn at',
  B.boardArtUrl(large, 1080) === B.boardArtUrl(large, 1440), true);

// ---------- how far the art can be turned down ----------

console.log('\nthe dimmer');

check('full strength by default', B.clampBoardArt(undefined), 1);
check('and for anything that is not a number', B.clampBoardArt('0.5'), 1);
check('and for NaN, which Number() hands back on a bad parse', B.clampBoardArt(NaN), 1);
check('a middling value is kept', B.clampBoardArt(0.55), 0.55);
check('1 is the ceiling', B.clampBoardArt(4), 1);
// FLOORED, not zeroed: at 0 the art vanishes and the board is a flat colour,
// which reads as a broken image rather than a dimmed one.
check('and it floors rather than going dark', B.clampBoardArt(0), B.BOARD_ART_MIN);
check('the floor is above nothing', B.BOARD_ART_MIN > 0, true);
check('a negative is floored too', B.clampBoardArt(-3), B.BOARD_ART_MIN);

// Only a board with something painted over its base has anything to fade.
check('a photographed board has art', B.themeHasArt(B.boardTheme('official')), true);
check('so does a drawn one', B.themeHasArt(B.boardTheme('canopy')), true);
check('a bare colour and grid does not', B.themeHasArt(B.boardTheme('slate')), false);
check('nor does Classic', B.themeHasArt(B.boardTheme('classic')), false);
// The claim above has to match what actually gets painted, or the control is
// disabled over a board that does have art.
check('and that answer agrees with whether any art is drawn',
  B.BOARD_THEMES.filter((t) => B.themeHasArt(t) !== (B.boardArtUrl(t, 100) !== null)).map((t) => t.id), []);

// ---------- the wiring, which needs a DOM to run ----------

console.log('\nthe wiring');

const board = src('board.ts');
const buildGrid = board.slice(board.indexOf('private buildGrid('), board.indexOf('private buildGrid(') + 900);

ok('the art node is painted at the held strength when the grid is rebuilt',
  /img\.setAttribute\('opacity', String\(this\.artOpacity\)\)/.test(buildGrid));
// Cleared BEFORE the branch: switching to a theme with no art must not leave
// the previous theme's node behind for the dimmer to write to. Presence is
// asserted separately because indexOf answers -1 for a line that is GONE, and
// -1 comes before everything.
ok('the held node is cleared on every rebuild', buildGrid.includes('this.artImg = null'));
ok('and cleared before the branch that sets a new one',
  buildGrid.indexOf('this.artImg = null') < buildGrid.indexOf('this.artImg = img'));
ok('the dimmer holds the value rather than only writing it',
  /this\.artOpacity = clampBoardArt\(v\)/.test(board));
// SEPARATE FROM setBoardTheme, and this is the reason: that setter early-returns
// when the theme id has not changed, which is every single dimmer drag.
const setTheme = board.slice(board.indexOf('  setBoardTheme('), board.indexOf('\n  }', board.indexOf('  setBoardTheme(')));
ok('setBoardTheme still bails out when the theme has not changed',
  /if \(next\.id === this\.theme\.id/.test(setTheme));
ok('so dimming is its own method and does not go through it',
  /setBoardArt\(v: number\)/.test(board) && !/artOpacity/.test(setTheme));

const units = src('units.ts');
ok('a load keeps the dimmer setting', /boardArt: clampBoardArt\(/.test(units));

const main = src('main.ts');
const apply = main.slice(main.indexOf('function applyBoardTheme('), main.indexOf('function applyBoardTheme(') + 700);
ok('the board is dimmed on load, not just when the dialog is open',
  /board\.setBoardArt\(/.test(apply));
// AFTER: setBoardTheme rebuilds the grid, so dimming first writes to a node
// that is about to be replaced.
ok('and it is dimmed after the theme is set, not before',
  apply.indexOf('board.setBoardTheme(') < apply.indexOf('board.setBoardArt('));
ok('the picker only offers what the board can wear',
  /themesFor\(gridsOf\(state\), state\.boardTheme\)/.test(main));
ok('and the slider follows the drag rather than waiting for release',
  /artRange\.addEventListener\('input'/.test(main));
ok('while saving on release, not on every pixel',
  /artRange\.addEventListener\('change', \(\) => save\(\)\)/.test(main));

// ---------- one grid palette, not one per theme ----------

console.log('\nthe grid palette');

// THE COMPLAINT THIS ANSWERS: Classic drew its letters in brown, the official
// board in lime, Trace in teal. Flipping through the styles changed the colour
// of the numbers you were reading co-ordinates off.
check('no theme carries a grid colour of its own',
  B.BOARD_THEMES.filter((t) => t.minor || t.major || t.label || t.border).map((t) => t.id), []);

const pal = B.gridPalette(B.DEFAULT_GRID_COLOUR);
check('the default palette is Slate\'s blue-grey', pal.label, 'rgb(159,178,196)');
// The four strengths are what separates a Large Grid line from a small one and
// a label from either. Collapsing any two makes the board unreadable.
check('the four strengths are all different',
  new Set([pal.minor, pal.major, pal.label, pal.border]).size, 4);
ok('minor is the faintest', pal.minor.endsWith('0.14)'));
ok('major is the strongest line', pal.major.endsWith('0.5)'));
ok('the border sits between them', pal.border.endsWith('0.4)'));
ok('and the label alone is solid', /^rgb\(/.test(pal.label));

// One colour in, one family out.
const lime = B.gridPalette('#b6cc2c');
check('a picked colour reaches every part of the grid',
  [lime.minor, lime.major, lime.label, lime.border].every((c) => c.includes('182,204,44')), true);
check('and it is not the default any more', lime.label === pal.label, false);

// A bad value must not paint the grid black or, worse, `rgba(NaN,...)`.
check('junk falls back to the default', B.gridPalette('not a colour').label, pal.label);
check('so does a colour NAME, which is valid CSS but not a hex',
  B.gridPalette('red').label, pal.label);
check('and so does nothing at all', B.gridPalette(undefined).label, pal.label);
check('no palette can contain a NaN',
  Object.values(B.gridPalette('#zzzzzz')).some((c) => c.includes('NaN')), false);

console.log('\nnormalising a picked colour');

// <input type="color" ROUND-TRIPS ONLY #rrggbb. Hand it #abc or a name and it
// silently shows black, so the stored value is normalised on the way in.
check('a short hex is expanded', B.clampGridColour('#abc'), '#aabbcc');
check('a full hex is kept', B.clampGridColour('#B6CC2C'), '#b6cc2c');
check('case is normalised so the well matches what was stored',
  B.clampGridColour('#B6CC2C'), B.clampGridColour('#b6cc2c'));
check('whitespace is tolerated', B.clampGridColour('  #abc  '), '#aabbcc');
check('a colour name is refused', B.clampGridColour('red'), B.DEFAULT_GRID_COLOUR);
check('so is rgb() notation', B.clampGridColour('rgb(1,2,3)'), B.DEFAULT_GRID_COLOUR);
check('a hex without the hash is refused', B.clampGridColour('aabbcc'), B.DEFAULT_GRID_COLOUR);
check('a non-string is refused', B.clampGridColour(42), B.DEFAULT_GRID_COLOUR);
check('nothing is refused', B.clampGridColour(undefined), B.DEFAULT_GRID_COLOUR);
// Whatever comes out must be feedable straight back in.
check('and the default is itself already normal',
  B.clampGridColour(B.DEFAULT_GRID_COLOUR), B.DEFAULT_GRID_COLOUR);

// ---------- boards that print their own grid ----------

console.log('\nthe printed grid');

check('exactly the two photographed boards print their own',
  B.BOARD_THEMES.filter((t) => t.printsOwnGrid).map((t) => t.id), ['official', 'official-large']);
check('and every board that does is a photograph',
  B.BOARD_THEMES.filter((t) => t.printsOwnGrid && !t.image).map((t) => t.id), []);

// ---------- what dimmed art fades into ----------

console.log('\nthe fade colour');

check('art fades to Slate\'s dark', B.BOARD_FADE_BASE, B.boardTheme('slate').base);
// THE BUG: the official boards sit on a dark OLIVE base, so dimming one faded
// the photo toward green-yellow and read as the art going yellow rather than
// going away.
check('and not toward the official board\'s own olive',
  B.BOARD_FADE_BASE === B.boardTheme('official').base, false);
check('nor the large one\'s', B.BOARD_FADE_BASE === B.boardTheme('official-large').base, false);

// ---------- the wiring, again ----------

console.log('\nthe grid wiring');

const build = board.slice(board.indexOf('private buildGrid('));
ok('the backdrop under art is the neutral fade colour, not the theme\'s own',
  /fill: art \? BOARD_FADE_BASE : t\.base/.test(build));
// Left uncoloured at construction so ONE routine decides the colour.
ok('grid lines are classed rather than given a colour inline',
  /class: cls, 'stroke-width'/.test(build) && !/stroke,\s*'stroke-width'/.test(build));
ok('and the builder paints through the same routine the pickers use',
  /this\.paintGrid\(g\);/.test(build));

const paint = board.slice(board.indexOf('private paintGrid('), board.indexOf('private buildGrid('));
ok('a printed grid is only covered when the player asks',
  /this\.alwaysGrid \|\| !this\.theme\.printsOwnGrid/.test(paint));
ok('hidden lines are made transparent rather than removed',
  /: 'transparent'/.test(paint));
// The letters and numbers are drawn OUTSIDE the board, where no art can reach
// them, so they follow the colour but never the toggle. Anchored to the start
// of the statement: an ordering check alone passes just as happily on
// `if (show) this.svg.style...`, which is the mistake being ruled out.
ok('the labels are recoloured unconditionally',
  /^\s*this\.svg\.style\.setProperty\('--grid-label'/m.test(paint));
ok('so is the border', /gridBorder\?\.setAttribute\('stroke'/.test(paint));
// Recolouring must not go through buildGrid: it re-encodes a generated theme's
// art into a data URI of several thousand polygons, on every tick of a drag.
ok('recolouring does not rebuild the grid',
  !/buildGrid\(\)/.test(board.slice(board.indexOf('setGridColour('), board.indexOf('private paintGrid('))));

ok('a load keeps the grid colour', /gridColour: clampGridColour\(/.test(units));
ok('and the always-show toggle', /alwaysGrid: !!\(s as/.test(units));

// ORDER: buildGrid paints the fresh grid from what the Board is already
// holding, so the grid settings have to be in before the theme is set.
ok('the grid colour is set before the theme rebuild',
  apply.indexOf('board.setGridColour(') < apply.indexOf('board.setBoardTheme('));
ok('and so is the toggle',
  apply.indexOf('board.setAlwaysGrid(') < apply.indexOf('board.setBoardTheme('));
ok('while the art dimmer stays after it, since that node does not exist yet',
  apply.indexOf('board.setBoardTheme(') < apply.indexOf('board.setBoardArt('));

// The native <input type="color"> is gone -- it handed the job to the operating
// system, which on Windows is still the 1995 dialog. colourpicker.test.mjs
// covers the replacement; these two pin what the BOARD does with it.
ok('the board follows the picker while it is being dragged',
  /onInput: \(hex\) =>[\s\S]*?board\.setGridColour\(state\.gridColour\)/.test(main));
ok('and saves once the change settles', /onDone: \(\) => save\(\)/.test(main));
// All three halves, because a substring match on the id alone is happy with a
// listener bound to a selector that matches nothing.
ok('there is a way back to the default without knowing the hex',
  /id="grid-colour-reset"/.test(main)
  && /'#grid-colour-reset'\)!\.addEventListener\('click'/.test(main)
  && /board\.setGridColour\(DEFAULT_GRID_COLOUR\)/.test(main));

console.log(`\n  ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
