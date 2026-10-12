// WHERE A UNIT CAN AIM. The board's Line of Sight control (OTTO's playtest,
// 2026-10-03) became the Firing Arc (OTTO, 2026-10-08: "show the firing arc
// it'll help the user know where his mech can hit vs LOS shows a lot of details
// the user probably doesnt need"): turn.ts arcOf lists the Grids of the unit's
// Forward Arc, and the Match Centre draws them (board.ts showArc) for the unit
// whose card is open. (Its reader of the line of sight, turn.ts sightOf, went
// with the control: the code audit, 2026-10-12.)
import { readFileSync } from 'node:fs';
import { loadEngine, tableAtRoundOne } from './_engine.mjs';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}\n       got  ${g}`); }
};

console.log('Where a unit can aim\n');

const { M, data } = await loadEngine('sightview', ["export * as TURN from '../src/turn';"]);
// The copied Alley: a high wall (3", blocks sight) fills the bottom row of F3,
// cells 15 to 17 of row 8.
const { state } = tableAtRoundOne(M, data, data.solo.scenarios[0]);
const s = JSON.parse(JSON.stringify(state));
const U = Object.fromEntries(s.tokens.map((x) => [x.label, x]));
// Everyone else out of the way along the bottom edge.
s.tokens.forEach((x, i) => { x.col = (11 - i) * 3; x.row = 33; });
const mire = U.Mire;
const at = (t, c, r, f) => { t.col = c * 3; t.row = r * 3; t.facing = f; };
// WHERE IT CAN AIM: the Grids of its Forward Arc (4.2.5), the cone widening a
// Grid each side for each Grid ahead, the Grids its edges cut included.
const aim = (t) => M.TURN.arcOf(s, t);
const has = (list, c, r) => list.some((x) => x.c === c && x.r === r);
at(mire, 5, 3, 0);
const up = aim(mire);
check('facing north from F4 it aims up the board: the Grid ahead and both beside it, five Grids wide in the next row, seven in the last',
  [[2, 1, 0].map((r) => up.filter((x) => x.r === r).map((x) => x.c)), up.length], [[[4, 5, 6], [3, 4, 5, 6, 7], [2, 3, 4, 5, 6, 7, 8]], 15]);
check('not behind it, not beside it, not its own Grid; and F2, past the high wall, is in the arc: the arc is not the line of sight',
  [has(up, 5, 5), has(up, 4, 3), has(up, 5, 3), has(up, 5, 1)], [false, false, false, true]);
at(mire, 5, 3, 1);
const east = aim(mire);
check('turned to face east it aims east, and every Grid listed is in its Forward Arc as an attack reads it',
  [has(east, 6, 3), has(east, 5, 2), has(east, 4, 3), east.every((g) => M.R.inArc(mire, { ...mire, uid: -1, col: g.c * 3, row: g.r * 3, size: 3 }, 'forward')),
    east.length === Array.from({ length: 144 }, (_, i) => ({ c: i % 12, r: Math.floor(i / 12) })).filter((g) => !(g.c === 5 && g.r === 3) && M.R.inArc(mire, { ...mire, uid: -1, col: g.c * 3, row: g.r * 3, size: 3 }, 'forward')).length],
  [true, false, false, true, true]);

// The page: the control on the board's rail, drawn for the unit the player
// picked and that one only (OTTO, 2026-10-05: following whichever unit acted
// drew one after another over the board on the other squad's turn), on a
// layer of its own that no pick or highlight clears.
const hud = readFileSync(new URL('../src/matchhud.ts', import.meta.url), 'utf8');
const board = readFileSync(new URL('../src/board.ts', import.meta.url), 'utf8');
check('THE PAGE: the Firing Arc button sits beside Zones; on, the board draws where the picked unit can aim, and with none picked the player\'s own unit whose turn it is, never the other squad\'s as it acts',
  [/<button id="btn-arc"[^>]*aria-pressed="false">Firing Arc<\/button>/.test(hud), /board\.showArc\(aimer \? turn\.arcOf\(s, aimer\) : null\)/.test(hud),
    /const arcUid = inspectUid \?\? \(actor && mine\(ctx, actor\.side\) \? actor\.uid : null\);/.test(hud), /btn-los|showSight/.test(hud + board)], [true, true, true, false]);
const table = readFileSync(new URL('../table/index.html', import.meta.url), 'utf8');
const mainSrc = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
check('THE TABLE TOO (OTTO, 2026-10-08: "we might want to have it on the freeplay table"): the Firing Arc button beside Zones, drawing the selected unit\'s arc, again as the table changes or another unit is selected',
  [/<button id="btn-zones"[^>]*>Zones<\/button>\s*\n\s*<button id="btn-arc"[^>]*aria-pressed="false">Firing Arc<\/button>/.test(table),
    /board\.showArc\(t \? arcGrids\(t, gridsOf\(state\)\) : null\);/.test(mainSrc),
    /board\.setSelected\(uid\);\s*\n\s*renderArc\(\);/.test(mainSrc),
    /board\.renderTokens\(state\);\s*\n\s*renderArc\(\);/.test(mainSrc)],
  [true, true, true, true]);
check('and both boards read the one arc (rules.ts arcGrids)', JSON.stringify(M.TURN.arcOf(s, mire)) === JSON.stringify(M.R.arcGrids(mire, 12)) && east.length > 0, true);
check('and the arc has its own layer, under the highlights, which clearHighlights does not touch',
  [/this\.gWorld\.appendChild\(this\.gSight\);\s*\n\s*this\.gWorld\.appendChild\(this\.gHighlight\);/.test(board), /clearHighlights\(\): void \{\s*\n\s*this\.gHighlight\.replaceChildren\(\);\s*\n\s*this\.gPick\.replaceChildren\(\);\s*\n\s*\}/.test(board)],
  [true, true]);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
