// WHERE IN THE GRID A MOVE ENDS (OTTO, 2026-10-08: "when moving a medium unit
// like a drone the current table doesnt let me decide where the drone is
// sitting at inside of the grid. it always places it automatically in the top
// right"). A unit smaller than its Grid now stands where the player puts it in
// the route's last Grid, as at deployment, where it fits (rules.ts spotInGrid,
// fitsAt, routeStops); with no spot chosen it stands in the free part of the
// Grid as before. Both boards hand the spot to the one reading of a route.
import { readFileSync } from 'node:fs';
import { loadEngine, tableAtRoundOne } from './_engine.mjs';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}\n       got  ${g}`); }
};

console.log('Where in the Grid a move ends\n');

const { M, data } = await loadEngine('movespot', ["export * as TURN from '../src/turn';"]);
const R = M.R;
const T = M.TURN;
const { state } = tableAtRoundOne(M, data, data.solo.scenarios[0]);

// The spot a pointer chooses: the cell is the base's corner, kept inside the Grid.
check('a Medium base in Grid (6,3) has four places: a cell in its last row or column puts the corner one back',
  [R.spotInGrid(6, 3, { col: 20, row: 11 }, 2), R.spotInGrid(6, 3, { col: 18, row: 9 }, 2), R.spotInGrid(6, 3, { col: 19, row: 11 }, 2)],
  [{ col: 19, row: 10 }, { col: 18, row: 9 }, { col: 19, row: 10 }]);
check('a Small base stands on the cell itself, a Large one only on the Grid',
  [R.spotInGrid(6, 3, { col: 20, row: 11 }, 1), R.spotInGrid(6, 3, { col: 20, row: 11 }, 3)], [{ col: 20, row: 11 }, { col: 18, row: 9 }]);
check('a cell outside the Grid chooses nothing', R.spotInGrid(6, 3, { col: 21, row: 11 }, 2), null);

// Where a base fits.
const wall = { id: 'w', type: 'low_wall', subCells: [{ col: 20, row: 11 }], height: 2, blocksLos: false, providesProtection: true, isFragile: false };
const other = { uid: 99, label: 'other', cardId: 'x', side: 's2', col: 18, row: 9, size: 1, facing: 0, statuses: [], aerial: false };
check('a base fits on open board, not over terrain, not over another base, not off the board',
  [R.fitsAt({ col: 19, row: 10 }, 2, false, [], []), R.fitsAt({ col: 19, row: 10 }, 2, false, [wall], []), R.fitsAt({ col: 18, row: 9 }, 2, false, [], [other]), R.fitsAt({ col: 35, row: 35 }, 2, false, [], [])],
  [true, false, false, false]);
check('an Aerial base fits over terrain and bases, and its own place never counts against it',
  [R.fitsAt({ col: 19, row: 10 }, 2, true, [wall], [other]), R.fitsAt({ col: 18, row: 9 }, 2, false, [], [other], 99)], [true, true]);

// A planned move, read the way both boards read it (turn.ts moveOrder): the
// Porcupine, a Medium Ground drone, from Grid (6,5) north.
const s = JSON.parse(JSON.stringify(state));
s.map = 'none';
s.round.phase = 2;
const drone = s.tokens.find((t) => t.label.startsWith('ADK15P'));
s.tokens.forEach((t, i) => { t.col = i * 3; t.row = 33; });
drone.col = 18; drone.row = 15; drone.facing = 0;
const path = [{ c: 6, r: 5 }, { c: 6, r: 4 }];
const draft = (over = {}) => ({ uid: drone.uid, steps: 2, flying: false, path, facing: 0, turned: false, spin: 0, ...over });
const freePart = () => R.standingSpot(6, 4, 2, false, [], s.tokens, drone.uid, { col: 18, row: 15 });
const plain = T.moveOrder(data, s, drone, draft());
check('with no spot chosen the unit stands in the free part of its last Grid, as before', [plain.last, plain.command.to], [freePart(), freePart()]);
const placed = T.moveOrder(data, s, drone, draft({ spot: { col: 19, row: 13 } }));
check('a spot chosen in the last Grid is where it stands, and where the command sends it', [placed.last, placed.command.to, placed.stops[placed.stops.length - 1]],
  [{ col: 19, row: 13 }, { col: 19, row: 13 }, { col: 19, row: 13 }]);
check('the walk to it is unchanged up to the last Grid', placed.stops.slice(0, -1), plain.stops.slice(0, -1));
// A unit in the Grid's corner cell leaves three of the four places.
other.col = 20; other.row = 14;
s.tokens.push(other);
const taken = T.moveOrder(data, s, drone, draft({ spot: { col: 19, row: 13 } }));
check('a spot another base covers is not taken: the unit stands in the free part instead',
  [taken.last, R.fitsAt(taken.last, 2, false, [], s.tokens, drone.uid)], [freePart(), true]);
s.tokens.pop();
check('a spot outside the last Grid is ignored', T.moveOrder(data, s, drone, draft({ spot: { col: 18, row: 15 } })).last, freePart());
// A Mine on the way stops the walk short of the Grid the spot was chosen in.
const mine = { ...M.U.makeDroneToken(s, data, data.byId.get('074'), 's2'), col: 19, row: 13, facing: 0 };
s.tokens.push(mine);
const cut = T.moveOrder(data, s, drone, draft({ path: [{ c: 6, r: 5 }, { c: 6, r: 4 }, { c: 6, r: 3 }], steps: 3, spot: { col: 19, row: 10 } }));
check('a walk a Mine stops short ends in the Mine\'s Grid, the spot chosen further on unused',
  [cut.cut, cut.last ? R.largeGridOf({ ...drone, ...cut.last }) : null], [1, { c: 6, r: 4 }]);
s.tokens.pop();

// Both boards: the table's own walk and the Match Centre's draft carry the spot.
const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
const hud = readFileSync(new URL('../src/matchhud.ts', import.meta.url), 'utf8');
check('the table and the Match Centre each choose the spot with the pointer and send it with the move',
  [/spotInGrid\(c, r, cell, t\.size\)/.test(main), /routeStops\(t, path, .*, m\.spot\)/.test(main), /spotInGrid\(c, r, cell, t\.size\)/.test(hud), /spot\?: \{ col: number; row: number \} \| null;/.test(hud) && /turn\.moveOrder\(ctx\.data, ctx\.state, t, m\)/.test(hud)],
  [true, true, true, true]);
check('a click reads the cell it lands on, as a hover there would (a tap on a touch screen comes with no hover first)',
  [/previewMove\(Math\.floor\(col \/ 3\), Math\.floor\(row \/ 3\), \{ col, row \}\);\s*\n\s*commitWaypoint\(\);/.test(main),
    /previewMove\(ctx, Math\.floor\(col \/ 3\), Math\.floor\(row \/ 3\), \{ col, row \}\);\s*\n\s*commitWaypoint\(ctx\);/.test(hud)],
  [true, true]);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
