// Terrain Protection and the firing arcs (rulebook 4.2/4.4.2, FAQ A1/E15/I24).
//   Two readings the FAQ changed and nothing pinned: terrain pressed against the
//   attacker's own base grants the defender nothing (A1), and units sharing a
//   Large Grid still have a front and a rear, read off the small grids (E15) —
//   unless their footprints overlap, which makes them mutually in front (I24).
import { readFileSync, writeFileSync } from 'node:fs';

const src = readFileSync(new URL('../src/rules.ts', import.meta.url), 'utf8');
const start = src.indexOf('export const LG');
// protectionFor is the last thing in the file, so the slice runs to the end.
if (start < 0) throw new Error('could not locate the sight rules in rules.ts');
const tmp = new URL('./_protection.slice.ts', import.meta.url);
writeFileSync(tmp, 'type TerrainPiece = any;\ntype Token = any;\ntype Side = any;\ntype SmokeScreen = any;\n' + src.slice(start));
const { inArc, losBetween, protectionFor, rangeBetween } = await import(tmp.href);

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}, got ${g}`); }
};

console.log('Protection and arcs — 4.2/4.4.2, FAQ A1/E15/I24\n');

// Small-cell coordinates throughout: a Large Grid is 3x3 of them.
const unit = (col, row, over = {}) =>
  ({ uid: over.uid ?? 1, side: over.side ?? 's1', kind: 'mech', col, row, size: over.size ?? 1,
     facing: over.facing ?? 0, aerial: over.aerial ?? false, partStates: {}, ...over });
// Terrain tall enough to obstruct: losBetween only cares about isFragile for
// crushing, height is what blocks.
const wall = (id, cells, over = {}) =>
  ({ id, height: 3, isFragile: false, subCells: cells.map(([col, row]) => ({ col, row })), ...over });
const firing = { type: 'Firing' };

// ---------- A1: terrain against your own base is not cover ----------

// Attacker at cell (4,4), defender four Grids away on the same row, with a wall
// in the cell directly in front of the attacker.
const me = unit(4, 4, { uid: 1 });
const far = unit(16, 4, { uid: 2, side: 's2' });
const hugged = wall('t1', [[5, 4]]);
const midway = wall('t2', [[10, 4]]);

check('a wall in the way is Terrain Protection',
  protectionFor(me, far, firing, [midway], [], []).white, 2);
check('but the wall the attacker is pressed against is not (A1)',
  protectionFor(me, far, firing, [hugged], [], []).white, 0);
// Contact is an edge, not a corner: a diagonal touch still shields. The shot
// has to run diagonally for the corner piece to be in the way at all.
const diag = unit(16, 16, { uid: 7, side: 's2' });
check('a corner touch is not Contact, so it still counts',
  protectionFor(me, diag, firing, [wall('t3', [[5, 5]])], [], []).white, 2);
// Both at once: the hugged piece drops out, the far one still protects.
check('only the hugged piece drops out',
  protectionFor(me, far, firing, [hugged, midway], [], []).white, 2);
check('and the note says which protection applied',
  protectionFor(me, far, firing, [midway], [], []).note.includes('Terrain Protection'), true);

// A 3x3 Mech is in Contact along its whole edge, not just from one cell.
const big = unit(3, 3, { uid: 1, size: 3 });
check('a large unit is in Contact along its whole face (A1)',
  protectionFor(big, far, firing, [wall('t4', [[6, 5]])], [], []).white, 0);

// Only Firing Actions ever roll Protection.
check('a Melee Action gets no Protection at all',
  protectionFor(me, far, { type: 'Melee' }, [midway], [], []).white, 0);

// ---------- E15/I24: arcs inside one Large Grid ----------

// Both in Large Grid (1,1), attacker facing north (0) at the bottom of it.
const a = unit(4, 5, { uid: 1, facing: 0 });
const infront = unit(4, 3, { uid: 2, side: 's2' });
const behind = unit(4, 5, { uid: 3, side: 's2' });

check('sharing a Grid is not a shrug: north is in front (E15)',
  [inArc(a, infront, 'forward'), inArc(a, infront, 'rear')], [true, false]);
check('and the same cell overlaps, so it is mutually in front (I24)',
  [inArc(a, behind, 'forward'), inArc(a, behind, 'rear')], [true, false]);
// The classic case the ruling is about: an Aerial unit sitting over a ground
// one can never Back Attack it.
const over = unit(4, 5, { uid: 4, side: 's2', aerial: true });
check('an Aerial unit above a ground one never gets the rear',
  inArc(a, over, 'rear'), false);
check('nor does the ground one, looking back up', inArc(over, a, 'rear'), false);

// A unit genuinely behind, still inside the Grid.
const a2 = unit(4, 3, { uid: 1, facing: 0 });
const trailing = unit(4, 5, { uid: 5, side: 's2' });
check('a unit south of a north-facing attacker is in its rear',
  [inArc(a2, trailing, 'rear'), inArc(a2, trailing, 'forward')], [true, false]);
// Sideways is neither arc: the cone test is 45 degrees off the facing.
check('directly beside is in neither arc',
  [inArc(a2, unit(3, 3, { uid: 6 }), 'forward'), inArc(a2, unit(3, 3, { uid: 6 }), 'rear')], [false, false]);

// Across Grids the test is the Large Grid, as before.
check('across Grids the arc reads the Large Grid',
  inArc(unit(4, 10, { facing: 0 }), unit(4, 1, { uid: 2 }), 'forward'), true);
check('and behind across Grids is the rear',
  inArc(unit(4, 1, { facing: 0 }), unit(4, 10, { uid: 2 }), 'rear'), true);

// rangeBetween agrees about sharing a Grid, which is what sends the arc test
// down the small-grid branch in the first place.
check('two units in one Grid are at range 0', rangeBetween(a, behind).range, 0);
check('and it says they share the Grid', rangeBetween(a, behind).sameGrid, true);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
