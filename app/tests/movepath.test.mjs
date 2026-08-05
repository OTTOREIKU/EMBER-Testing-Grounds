// Checks the movement route search: range, terrain blocking, and path shape.
import { readFileSync, writeFileSync } from 'node:fs';

const srcUrl = new URL('../src/rules.ts', import.meta.url);
const src = readFileSync(srcUrl, 'utf8');
const start = src.indexOf('export const LG');
const end = src.indexOf('export function losBetween');
if (start < 0 || end < 0) throw new Error('could not locate the movement search in rules.ts');
const tmp = new URL('./_movepath.slice.ts', import.meta.url);
writeFileSync(tmp, 'type TerrainPiece = any;\ntype Token = any;\ntype Side = any;\ntype SmokeScreen = any;\n' + src.slice(start, end));
const { movePath, reachableGrids } = await import(tmp.href);

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}, got ${g}`); }
};

// A size-1 unit sitting in Large Grid (0,0).
const unit = (c = 0, r = 0, size = 1, aerial = false) => ({ uid: 1, size, aerial, col: c * 3 + 1, row: r * 3 + 1, partStates: {} });
// A terrain piece filling every small cell of one Large Grid.
const wall = (c, r) => ({
  id: `w${c}${r}`, type: 'building', height: 3, blocksLos: true, providesProtection: true, isFragile: false,
  subCells: [0, 1, 2].flatMap((dc) => [0, 1, 2].map((dr) => ({ col: c * 3 + dc, row: r * 3 + dr }))),
});
const cells = (p) => p.map((g) => `${g.c},${g.r}`);

console.log('Movement route search\n');

// A clear board gives the direct orthogonal route, inclusive of both ends.
check('path includes start and end', cells(movePath(unit(), { c: 3, r: 0 }, 5, [], [], false)), ['0,0', '1,0', '2,0', '3,0']);
check('staying put is a one-cell path', cells(movePath(unit(), { c: 0, r: 0 }, 5, [], [], false)), ['0,0']);

// Out of range is not a route at all, rather than a truncated one.
check('beyond range yields no path', movePath(unit(), { c: 6, r: 0 }, 3, [], [], false), []);
check('exactly at range still works', cells(movePath(unit(), { c: 3, r: 0 }, 3, [], [], false)).length, 4);

// Terrain must block, and the route must go around it rather than through.
const blocked = [wall(1, 0)];
check('a wall is not reachable', reachableGrids(unit(), 4, blocked, [], false).some((g) => g.c === 1 && g.r === 0), false);
const around = movePath(unit(), { c: 2, r: 0 }, 6, blocked, [], false);
check('the route reaches the far side', cells(around).at(-1), '2,0');
check('the route does not cross the wall', cells(around).includes('1,0'), false);
check('going around costs more than the direct line', around.length - 1 > 2, true);

// A wall sealing the only corridor makes the target unreachable.
const sealed = [wall(1, 0), wall(1, 1), wall(1, 2), wall(1, 3), wall(1, 4), wall(1, 5), wall(1, 6),
  wall(1, 7), wall(1, 8), wall(1, 9), wall(1, 10), wall(1, 11)];
check('a full wall blocks the board', movePath(unit(), { c: 3, r: 0 }, 20, sealed, [], false), []);

// A small unit occupies one small cell, and small units may share a Large Grid,
// so it does NOT close the grid off. A size-3 mech fills the grid and does.
const smallUnit = { uid: 2, size: 1, aerial: false, col: 4, row: 1, partStates: {} };
const mech = { uid: 3, size: 3, aerial: false, col: 3, row: 0, partStates: {} };
const canEnter = (blockers) => reachableGrids(unit(), 3, [], blockers, false).some((g) => g.c === 1 && g.r === 0);
check('a small unit does not close its grid', canEnter([smallUnit]), true);
check('a mech fills its grid and blocks it', canEnter([mech]), false);
check('a mech does not block routes around it', movePath(unit(), { c: 1, r: 1 }, 4, [], [mech], false).length > 0, true);

// Aerial units ignore both.
check('an aerial unit crosses terrain', cells(movePath(unit(0, 0, 1, true), { c: 2, r: 0 }, 4, blocked, [], false)), ['0,0', '1,0', '2,0']);

// Every step is orthogonal and one grid long, which the animation relies on.
const long = movePath(unit(), { c: 3, r: 3 }, 10, [], [], false);
const hops = long.slice(1).map((g, i) => Math.abs(g.c - long[i].c) + Math.abs(g.r - long[i].r));
check('every hop is one orthogonal grid', [...new Set(hops)], [1]);

// ---------- the overlay and the tracer must be the same answer ----------
//
// The green squares come from reachableGrids and the route the cursor draws
// comes from movePath. They share one search, and this is the property that
// says so: a Grid is lit if and only if a route to it exists inside the budget.
// Asked because a wall in the way made the overlay look wrong — it was not, the
// detour around it simply costs the steps it costs.

const maze = [wall(1, 0), wall(1, 1)]; // a wall two Grids tall, open below
for (const steps of [1, 2, 3, 4, 5, 6]) {
  const lit = new Set(cells(reachableGrids(unit(), steps, maze, [], false)));
  const walkable = new Set();
  // Wider than the biggest budget tested, or the sweep misses Grids the search
  // legitimately reaches and the invariant reads as broken.
  for (let c = 0; c <= 7; c++) {
    for (let r = 0; r <= 7; r++) {
      if (c === 0 && r === 0) continue;
      const p = movePath(unit(), { c, r }, steps, maze, [], false);
      if (p.length) walkable.add(`${c},${r}`);
    }
  }
  const litNotWalkable = [...lit].filter((k) => !walkable.has(k));
  const walkableNotLit = [...walkable].filter((k) => !lit.has(k));
  check(`at ${steps} steps every lit Grid has a route`, litNotWalkable, []);
  check(`at ${steps} steps every reachable Grid is lit`, walkableNotLit, []);
}
// And the detour is genuinely what costs the steps. (2,0) is two Grids away as
// the crow flies, but the wall is two Grids tall, so the way round is
// (0,1)(0,2)(1,2)(2,2)(2,1)(2,0) — six. That gap between what looks close and
// what the route costs is why the overlay reads as if terrain had eaten it.
check('a Grid behind a wall is out of reach at five steps', cells(movePath(unit(), { c: 2, r: 0 }, 5, maze, [], false)), []);
check('and reachable at six, the long way round', cells(movePath(unit(), { c: 2, r: 0 }, 6, maze, [], false)).length, 7);
check('so at five steps it is correctly NOT lit', cells(reachableGrids(unit(), 5, maze, [], false)).includes('2,0'), false);
check('and at six steps it is', cells(reachableGrids(unit(), 6, maze, [], false)).includes('2,0'), true);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
