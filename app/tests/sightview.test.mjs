// WHAT A UNIT CAN SEE: the board's Line of Sight control (OTTO's playtest,
// 2026-10-03: "This would help to see what each unit's line of sight covers so
// I know to turn the unit if needed"). turn.ts sightOf lists every Grid a unit
// has a line of sight to, as a unit filling that Grid would be seen (rules.ts
// firingSight), and whether it lies in the Forward Arc; the Match Centre draws
// it (board.ts showSight) for the unit whose card is open.
import { readFileSync } from 'node:fs';
import { loadEngine, tableAtRoundOne } from './_engine.mjs';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}\n       got  ${g}`); }
};

console.log('What a unit can see\n');

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
const look = (t) => M.TURN.sightOf(data, s, t);
const find = (list, c, r) => list.find((x) => x.c === c && x.r === r) ?? null;

// The Mire in F4, facing north, the high wall between it and F2.
at(mire, 5, 3, 0);
const north = look(mire);
check('the Grid beyond the high wall is not seen, nor is the unit\'s own Grid listed',
  [find(north, 5, 1), find(north, 5, 3)], [null, null]);
check('a Grid ahead in the open is seen, in the Forward Arc', [find(north, 2, 0)?.arc ?? null, find(north, 2, 0) !== null], [true, true]);
check('the Grid behind it is seen only by turning (outside the Forward Arc)', find(north, 5, 5)?.arc ?? null, false);
// Turned to face south, the two swap.
at(mire, 5, 3, 2);
const south = look(mire);
check('turned round, the Grid behind is now in the Forward Arc, and the one ahead out of it',
  [find(south, 5, 5)?.arc ?? null, find(south, 2, 0)?.arc ?? null], [true, false]);
check('every Grid listed is on the board, and none twice',
  [south.every((x) => x.c >= 0 && x.r >= 0 && x.c < 12 && x.r < 12), new Set(south.map((x) => `${x.c},${x.r}`)).size === south.length], [true, true]);
// An Aerial unit sees over everything (losBetween: always Unobstructed).
const flier = { ...mire, aerial: true };
check('a unit in the air sees past the wall', find(look(flier), 5, 1) !== null, true);

// The page: the control on the board's rail, drawn for the unit the player
// picked and that one only (OTTO, 2026-10-05: following whichever unit acted
// drew one sight after another over the board on the other squad's turn), on
// a layer of its own that no pick or highlight clears.
const hud = readFileSync(new URL('../src/matchhud.ts', import.meta.url), 'utf8');
const board = readFileSync(new URL('../src/board.ts', import.meta.url), 'utf8');
check('THE PAGE: the Line of Sight button sits beside Zones; on, the board draws what the picked unit can see, and with none picked the player\'s own unit whose turn it is, never the other squad\'s as it acts',
  [/<button id="btn-los"[^>]*aria-pressed="false">Line of Sight<\/button>/.test(hud), /board\.showSight\(eyes \? turn\.sightOf\(ctx\.data, s, eyes\) : null\)/.test(hud),
    /const sightUid = inspectUid \?\? \(actor && mine\(ctx, actor\.side\) \? actor\.uid : null\);/.test(hud)], [true, true, true]);
check('and the sight has its own layer, under the highlights, which clearHighlights does not touch',
  [/this\.gWorld\.appendChild\(this\.gSight\);\s*\n\s*this\.gWorld\.appendChild\(this\.gHighlight\);/.test(board), /clearHighlights\(\): void \{\s*\n\s*this\.gHighlight\.replaceChildren\(\);\s*\n\s*this\.gPick\.replaceChildren\(\);\s*\n\s*\}/.test(board)],
  [true, true]);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
