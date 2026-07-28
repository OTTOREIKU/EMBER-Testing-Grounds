// Checks where a unit actually stands inside a Large Grid it shares with terrain.
import { readFileSync, writeFileSync } from 'node:fs';

const src = readFileSync(new URL('../src/rules.ts', import.meta.url), 'utf8');
const start = src.indexOf('export const LG');
const end = src.indexOf('export function losBetween');
if (start < 0 || end < 0) throw new Error('could not locate the placement helpers in rules.ts');
const tmp = new URL('./_standing.slice.ts', import.meta.url);
writeFileSync(tmp, 'type TerrainPiece = any;\ntype Token = any;\ntype Side = any;\ntype SmokeScreen = any;\n' + src.slice(start, end));
const { standingSpot, canStandIn } = await import(tmp.href);

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}, got ${g}`); }
};

// Terrain covering named small cells of Large Grid (0,0). Cells are listed as
// [dc, dr] offsets inside the 3x3 Grid.
const piece = (cells, height = 2) => ({
  id: 'w', type: 'low_wall', height, blocksLos: true, providesProtection: true, isFragile: false,
  subCells: cells.map(([dc, dr]) => ({ col: dc, row: dr })),
});
const spot = (size, terrain = [], tokens = [], toward) =>
  standingSpot(0, 0, size, false, terrain, tokens, 99, toward);

console.log('Standing spots inside a Large Grid\n');

// With the Grid empty, a unit sits where it looks centred.
check('a 1x1 takes the middle of an empty grid', spot(1), { col: 1, row: 1 });
check('a 3x3 fills the grid', spot(3), { col: 0, row: 0 });
// A 2x2 has no true centre, so any of the four offsets is equidistant; the first
// in scan order wins and it must be a real offset rather than the middle cell.
check('a 2x2 takes a corner', spot(2), { col: 0, row: 0 });

// The bug: a unit crossing a Grid that holds a barricade must step around it.
const wallTop = piece([[0, 0], [1, 0], [2, 0]]);
// The nearest free cell to the middle wins, not the far corner.
check('a 1x1 steps off a wall on the centre cell', spot(1, [piece([[1, 1]])]), { col: 0, row: 1 });
check('a 2x2 slides below a wall along the top', spot(2, [wallTop]), { col: 0, row: 1 });
const wallLeft = piece([[0, 0], [0, 1], [0, 2]]);
check('a 2x2 slides right of a wall down the left', spot(2, [wallLeft]), { col: 1, row: 0 });
// A single blocked corner still leaves three placements for a 1x1.
check('a 1x1 prefers the centre when the corner is blocked', spot(1, [piece([[0, 0]])]), { col: 1, row: 1 });

// A 3x3 cannot dodge anything, so any terrain in the Grid rules it out entirely.
check('a 3x3 cannot share a grid with terrain', spot(3, [piece([[2, 2]])]), null);
check('and canStandIn agrees', canStandIn(0, 0, 3, false, [piece([[2, 2]])], [], 99), false);

// Terrain filling the whole Grid leaves nowhere for anyone.
const full = piece([0, 1, 2].flatMap((dc) => [0, 1, 2].map((dr) => [dc, dr])));
check('a full grid has no spot', spot(1, [full]), null);
check('canStandIn reports the same', canStandIn(0, 0, 1, false, [full], [], 99), false);

// Other units block the same way terrain does.
const sitting = { uid: 1, size: 2, aerial: false, col: 0, row: 0 };
check('a 1x1 avoids a unit already in the grid', spot(1, [], [sitting]), { col: 1, row: 2 });
check('a 2x2 cannot fit beside a 2x2', spot(2, [], [sitting]), null);
// The unit being moved does not block itself.
check('the moving unit ignores its own footprint', standingSpot(0, 0, 2, false, [], [{ ...sitting, uid: 99 }], 99), { col: 0, row: 0 });

// Aerial units stand anywhere, including over terrain.
check('an aerial unit ignores terrain', standingSpot(0, 0, 1, true, [full], [], 99), { col: 1, row: 1 });

// Every 2x2 placement in a 3x3 Grid covers the middle cell, so blocking the
// middle rules a 2x2 out of the Grid entirely.
check('a blocked centre cell excludes any 2x2', spot(2, [piece([[1, 1]])]), null);

// The approach biases which of several equally central free cells is taken, so a
// unit hugs the side it came from instead of crossing the Grid.
const blockedMiddle = [piece([[1, 1]])];
check('coming from the left takes the left cell', spot(1, blockedMiddle, [], { col: -2, row: 1 }), { col: 0, row: 1 });
check('coming from below takes the lower cell', spot(1, blockedMiddle, [], { col: 1, row: 8 }), { col: 1, row: 2 });
check('coming from above takes the upper cell', spot(1, blockedMiddle, [], { col: 1, row: -6 }), { col: 1, row: 0 });

// Off-board grids have no spot at all.
check('a grid off the board has no spot', standingSpot(-1, 0, 1, false, [], [], 99), null);
check('and neither does one past the far edge', standingSpot(12, 0, 1, false, [], [], 99), null);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
