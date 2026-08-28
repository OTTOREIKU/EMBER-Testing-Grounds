// The board dimension is data (E1), and two things guard that.
//
// 1. THE FIVE GRID-REF PARSERS. data.ts has the canonical one; tasks.ts holds
//    TWO private copies because that module is compiled standalone by the test
//    slices (the imports-nothing-but-types rule), and matchhud.ts and
//    scenarios.ts hold one each. They cannot be deduplicated into an import
//    without breaking the slices, so they are pinned in step instead: if one
//    widens to a bigger board and another does not, a zone ref silently stops
//    resolving on exactly one code path, which no behavioural test would catch.
//    The plan said there were THREE. There are five; the extra two were found
//    by grepping for the old character class after fixing the known ones.
//
// 2. THE SIZE CONSTANT IS GONE. board.ts must not reintroduce a module-level
//    CELLS/SIZE: the whole point of E1 is that no module caches the board's
//    dimension at load.
import { readFileSync } from 'node:fs';

const src = (f) => readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8');

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}, got ${g}`); }
};
const ok = (name, cond, why = '') => check(name + (why ? ` (${why})` : ''), !!cond, true);

// ---------- 1. the five parsers agree ----------

// file, the function's own name, whether it clamps (two of them deliberately
// do not - they are fed already-validated data and only split the ref).
const PARSERS = [
  { file: 'data.ts', fn: 'parseGridRef', clamps: true },
  { file: 'tasks.ts', fn: 'gridRef', clamps: false },
  { file: 'tasks.ts', fn: 'zoneRef', clamps: true },
  { file: 'matchhud.ts', fn: 'zref', clamps: false },
  { file: 'scenarios.ts', fn: 'parseGrid', clamps: true },
];

const bodyOf = (file, fn) => {
  const t = src(file);
  const at = t.indexOf(`function ${fn}(ref: string)`);
  if (at < 0) return null;
  // To the first closing brace at column 0 after it.
  const end = t.indexOf('\n}', at);
  return t.slice(at, end);
};

const CLASS = /\[A-Ra-r\]/;
const BOUND = /> 17\b/;

check('all five parsers are still present', PARSERS.filter((p) => bodyOf(p.file, p.fn)).length, 5);

for (const p of PARSERS) {
  const body = bodyOf(p.file, p.fn);
  ok(`${p.file}:${p.fn} accepts A-R`, body && CLASS.test(body));
  ok(`${p.file}:${p.fn} rejects the old A-L class`, body && !/\[A-La-l\]/.test(body));
  if (p.clamps) ok(`${p.file}:${p.fn} bounds at 17`, body && BOUND.test(body), '18 Grids max');
}

// Nothing anywhere may still carry the printed-board character class.
for (const f of ['data.ts', 'tasks.ts', 'matchhud.ts', 'scenarios.ts', 'main.ts', 'commands.ts', 'board.ts']) {
  ok(`${f} has no A-L grid-ref class left`, !/\[A-La-l\]/.test(src(f)));
}

// ---------- 2. no module-level board dimension ----------

const board = src('board.ts');
ok('board.ts exports no CELLS constant', !/export const CELLS\b/.test(board));
ok('board.ts has no module-level SIZE', !/^const SIZE =/m.test(board));
ok('board.ts exports cellsFor()', /export function cellsFor\(/.test(board));
ok('Board has a setGrids()', /setGrids\(grids: BoardGrids\)/.test(board));
// setGrids must not go through setTheme, which early-returns on an unchanged
// theme id and would leave the previous board's grid painted.
const setGrids = board.slice(board.indexOf('setGrids(grids: BoardGrids)'));
ok('setGrids rebuilds the grid directly', /buildGrid\(\)/.test(setGrids.slice(0, 900)));

const commands = src('commands.ts');
ok('commands.ts no longer caches CELLS', !/^const CELLS = 36;/m.test(commands));
ok('commands.ts bounds against the state', /cellsOf\(state\)/.test(commands));
ok('commands.ts has no literal subcell bound left', !/col > 35\b/.test(commands));
ok('commands.ts has no literal Grid bound left', !/col > 11\b/.test(commands));

// ---------- 3. the state helpers behave ----------

const types = src('types.ts');
const slice = types.slice(types.indexOf('export type BoardGrids'), types.indexOf('export interface GameState'));
const mod = new URL('./_gridref.slice.ts', import.meta.url);
readFileSync; // keep the import used even if the write below is skipped
const { writeFileSync } = await import('node:fs');
writeFileSync(mod, slice);
const T = await import(mod.href);

check('absent grids reads as the printed board', T.gridsOf({}), 12);
check('absent state reads as the printed board', T.gridsOf(undefined), 12);
check('16 is carried', T.gridsOf({ grids: 16 }), 16);
check('18 is carried', T.gridsOf({ grids: 18 }), 18);
check('a size we do not ship falls back', T.gridsOf({ grids: 24 }), 12);
check('a hand-edited string falls back', T.gridsOf({ grids: '18' }), 12);
check('cellsOf is 3 subcells per Grid', [T.cellsOf({}), T.cellsOf({ grids: 16 }), T.cellsOf({ grids: 18 })], [36, 48, 54]);

// The largest board must fit inside what the parsers accept, or an authored
// zone on an 18x18 map would not resolve. R is index 17, row 18 is index 17.
check('the biggest board fits the parser bound', T.gridsOf({ grids: 18 }) - 1, 17);

// ---------- 4. the save must CARRY the size ----------
//
// migrateState rebuilds GameState from a field WHITELIST, so a field missing
// from it is dropped on every load with no error. That is not hypothetical:
// this slice shipped with `grids` missing there, and a saved 16x16 game came
// back as a printed board. Any future board-level field needs the same pin.
const units = src('units.ts');
const migrate = units.slice(units.indexOf('export function migrateState'), units.indexOf('for (const rawTok of s.tokens)'));
ok('migrateState carries grids through a load', /grids/.test(migrate));
ok('migrateState uses gridsOf rather than a raw copy', /gridsOf\(/.test(migrate));
// Absent must STAY absent: writing grids:12 onto every printed save would make
// gridsOf's absence rule meaningless and bloat every checkpoint.
ok('migrateState leaves a printed board with no grids field', /DEFAULT_GRIDS \? \{\}/.test(migrate));

// configureTable is how the size reaches a second seat; without it a guest
// draws the host's large map at 12 and every coordinate silently disagrees.
ok('configureTable carries grids', /grids\?: BoardGrids/.test(commands));
ok('configureTable validates the size', /That is not a board size/.test(commands));
ok('configureTable deletes grids for a printed board', /delete state\.grids/.test(commands));

console.log(`\ngridref: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
