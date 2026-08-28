// BEHAVIOURAL cover for the larger boards (E6).
//
// Everything else about board size is pinned by reading source. This file
// actually RUNS the geometry at 12, 16 and 18 Large Grids, because the bug that
// motivated it was invisible to every source-level check:
//
//   rules.ts kept `export const LG = 12` -- a module-level Large Grid extent
//   gating standingSpot, the movement search and the crush walk. On an 18x18
//   board every Grid from 12 outward was rejected, so the scaled White
//   deployment corner (Grids 14-17) had NO legal spot at all and a player could
//   not deploy. It rendered perfectly. The suite was green. The game was stuck.
//
// So: assert the geometry answers differently at different sizes, and that the
// default is still exactly the printed board.
import { readFileSync, writeFileSync } from 'node:fs';

const src = (f) => readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8');
const rules = src('rules.ts');

// rules.ts imports only types, so stripping imports leaves it standalone.
const tmp = new URL('./_largeboard.slice.ts', import.meta.url);
writeFileSync(
  tmp,
  'type TerrainPiece = any;\ntype Token = any;\ntype SmokeScreen = any;\ntype Side = any;\ntype Facing = any;\n'
  + rules.replace(/^import[^\n]*\n/gm, ''),
);
const R = await import(tmp.href);

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}, got ${g}`); }
};
const ok = (name, cond) => check(name, !!cond, true);

const mech = (uid, col, row, side = 's1') => ({
  uid, side, kind: 'mech', cardId: 'x', label: `m${uid}`,
  col, row, size: 1, facing: 2, aerial: false, statuses: [], partStates: {},
});

// ---------- the extent is settable, and validated ----------

check('the default is the printed board', R.boardGrids(), 12);
R.setBoardGrids(18);
check('18 is accepted', R.boardGrids(), 18);
R.setBoardGrids(16);
check('16 is accepted', R.boardGrids(), 16);
R.setBoardGrids(24);
check('a size we do not ship falls back to printed', R.boardGrids(), 12);
R.setBoardGrids(12);

// ---------- standingSpot: the deployment deadlock ----------
//
// Grid (16,16) exists only on an 18x18 board. This is the exact cell class the
// scaled White corner is made of.
const noTerrain = [];
const alone = [mech(1, 0, 0)];

check('printed board refuses a Grid it does not have', R.standingSpot(16, 16, 1, false, noTerrain, alone, 1), null);
check('and refuses the first Grid past its edge', R.standingSpot(12, 0, 1, false, noTerrain, alone, 1), null);
ok('printed board still accepts its own last Grid', !!R.standingSpot(11, 11, 1, false, noTerrain, alone, 1));

R.setBoardGrids(18);
ok('an 18x18 board accepts Grid (16,16)', !!R.standingSpot(16, 16, 1, false, noTerrain, alone, 1));
ok('and its own last Grid (17,17)', !!R.standingSpot(17, 17, 1, false, noTerrain, alone, 1));
check('but not one past ITS edge', R.standingSpot(18, 0, 1, false, noTerrain, alone, 1), null);

R.setBoardGrids(16);
ok('a 16x16 board accepts Grid (15,15)', !!R.standingSpot(15, 15, 1, false, noTerrain, alone, 1));
check('and refuses (16,16), which is off it', R.standingSpot(16, 16, 1, false, noTerrain, alone, 1), null);

// The whole scaled White deployment corner must be standable, since that is
// what had zero legal spots.
R.setBoardGrids(18);
const corner = [];
for (let c = 10; c <= 17; c++) for (let r = 14; r <= 17; r++) corner.push([c, r]);
const legal = corner.filter(([c, r]) => !!R.standingSpot(c, r, 1, false, noTerrain, alone, 1));
check('every Grid of the scaled 18x18 White corner is standable', legal.length, corner.length);

// ---------- the movement search ----------
//
// A Mech standing near the far corner must be able to move AWAY from the
// printed board's old edge, not be penned inside it.
R.setBoardGrids(18);
const far = mech(2, 45, 45); // Grid (15,15)
const reach18 = R.reachableGrids(far, 3, noTerrain, [far], false);
const beyond11 = reach18.filter((g) => g.c > 11 || g.r > 11);
ok('an 18x18 board reaches Grids past the printed edge', beyond11.length > 0);
ok('and reaches its own far corner', reach18.some((g) => g.c === 17 || g.r === 17));

R.setBoardGrids(12);
const reach12 = R.reachableGrids(far, 3, noTerrain, [far], false);
check('the printed board reaches nothing out there at all', reach12.length, 0);
R.setBoardGrids(18);

// ---------- every gate in rules.ts moved together ----------
//
// crushTargets and the crush walk share the same extent. They are not probed
// behaviourally here: crushTargets needs a real loadout to return anything at
// all, so a synthetic token answers null for every Grid and the assertion would
// be meaningless. What IS worth pinning is that no gate was left behind on a
// literal, which is exactly how this bug survived E1.
const gateLines = rules.split('\n').filter((l) => /boardGrids\(\)/.test(l) && />=/.test(l));
ok('rules.ts still has its board-extent gates', gateLines.length >= 4);
const literalGates = rules.split('\n').filter((l) => /[.\s][cr]\s*>=\s*12\b/.test(l));
check('and none of them is a literal 12 any more', literalGates.length, 0);

// ---------- both pages set the extent where they set the board's ----------
//
// The extent is module state, so it is only correct if every page derives it
// from the state it is about to draw or judge. If a page ever sets the Board's
// size without setting this one, geometry silently reverts to 12.
for (const [f, why] of [['main.ts', 'the freeplay board'], ['matchhud.ts', 'the Match Centre']]) {
  const s = src(f);
  ok(`${why} sets the board size`, /board\.setGrids\(gridsOf\(/.test(s));
  ok(`${why} sets the geometry extent too`, /setBoardGrids\(gridsOf\(/.test(s));
  // and in the same place, so one cannot be added without the other
  const at = s.indexOf('board.setGrids(gridsOf(');
  ok(`${why} sets them together`, at >= 0 && s.slice(at, at + 400).includes('setBoardGrids(gridsOf('));
}
ok('rules.ts no longer exports a fixed LG', !/export const LG\b/.test(rules));
// The pure command layer must NOT depend on this module state: it bounds
// against cellsOf(state) so a replayed command is judged by its own state.
const commands = src('commands.ts');
ok('the command layer does not read the geometry extent', !/boardGrids\(\)/.test(commands));
ok('it bounds against its own state instead', /cellsOf\(state\)/.test(commands));

R.setBoardGrids(12);
console.log(`\nlargeboard: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
