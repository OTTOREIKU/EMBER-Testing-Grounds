// Checks the hand-traced movement route: extending, backtracking, and refusals.
import { readFileSync, writeFileSync } from 'node:fs';

const srcUrl = new URL('../src/rules.ts', import.meta.url);
const src = readFileSync(srcUrl, 'utf8');
const start = src.indexOf('export const LG');
const end = src.indexOf('export function losBetween');
if (start < 0 || end < 0) throw new Error('could not locate the movement search in rules.ts');
const tmp = new URL('./_tracepath.slice.ts', import.meta.url);
writeFileSync(tmp, 'type TerrainPiece = any;\ntype Token = any;\ntype Side = any;\ntype SmokeScreen = any;\n' + src.slice(start, end));
const { extendPath } = await import(tmp.href);

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}, got ${g}`); }
};

const unit = { uid: 1, size: 1, aerial: false, col: 1, row: 1, partStates: {} };
const wall = (c, r) => ({
  id: `w${c}${r}`, type: 'building', height: 3, blocksLos: true, providesProtection: true, isFragile: false,
  subCells: [0, 1, 2].flatMap((dc) => [0, 1, 2].map((dr) => ({ col: c * 3 + dc, row: r * 3 + dr }))),
});
const g = (s) => s.split(' ').map((p) => { const [c, r] = p.split(',').map(Number); return { c, r }; });
const cells = (p) => (p ? p.map((x) => `${x.c},${x.r}`).join(' ') : p);
const trace = (path, to, steps = 6, terrain = [], tokens = [], flying = false) =>
  cells(extendPath(g(path), g(to)[0], unit, steps, terrain, tokens, flying));

console.log('Hand-traced movement route\n');

// The ordinary case: one grid at a time, in whatever order the cursor visits.
check('a neighbour extends the route', trace('0,0', '1,0'), '0,0 1,0');
check('a zigzag is expressible', trace('0,0 1,0', '1,1'), '0,0 1,0 1,1');
check('and keeps going', trace('0,0 1,0 1,1', '2,1'), '0,0 1,0 1,1 2,1');

// Hovering where you already are is not a change, so the route is left alone.
check('the current grid changes nothing', trace('0,0 1,0', '1,0'), null);

// Backing onto the grid you came from rubs the last step out.
check('backtracking pops the last step', trace('0,0 1,0 1,1', '1,0'), '0,0 1,0');
check('backtracking to the start empties the route', trace('0,0 1,0', '0,0'), '0,0');

// A route may not cross itself, either by hovering onto it or by bridging over it.
check('recrossing the route is refused', trace('0,0 1,0 1,1 0,1', '0,0'), null);

// A cursor that outruns the pointer samples leaves a gap, bridged by the short route.
check('a gap is bridged', trace('0,0', '3,0'), '0,0 1,0 2,0 3,0');
check('the bridge respects what is left of the budget', trace('0,0 1,0 2,0', '5,0', 4), null);
check('a bridge inside the budget lands', trace('0,0 1,0 2,0', '4,0', 4), '0,0 1,0 2,0 3,0 4,0');

// Terrain blocks, and a bridge routes around it rather than through.
const blocked = [wall(1, 0)];
check('a wall cannot be entered', trace('0,0', '1,0', 6, blocked), null);
check('a bridge goes around a wall', trace('0,0', '2,0', 6, blocked), '0,0 0,1 1,1 2,1 2,0');
check('flight crosses a wall', trace('0,0', '1,0', 6, blocked, [], true), '0,0 1,0');

// A route already at its full length cannot grow, but can still be rubbed back.
check('a full route refuses more', trace('0,0 1,0 2,0', '3,0', 2), null);
check('a full route still backtracks', trace('0,0 1,0 2,0', '1,0', 2), '0,0 1,0');

// A sealed board leaves nothing to bridge to.
const sealed = Array.from({ length: 12 }, (_, r) => wall(1, r));
check('an unreachable grid is refused', trace('0,0', '3,0', 20, sealed), null);

// An empty route has no last grid to work from.
check('an empty route is refused', cells(extendPath([], { c: 0, r: 0 }, unit, 5, [], [], false)), null);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
