// WHAT IS IN THE WAY, IN ONE WALK OF THE LINES (rules.ts obstructorsOf; the
// code audit, 2026-10-11): the pieces and units named in a shot's way are
// exactly the ones the old reading named, each line walked with that piece or
// that unit alone (about thirty walks of 81 lines for one note, 45% of the
// computer's thinking). Random tables of every kind - units of each size
// anywhere, on the Grid lines too where a line runs along a cell's edge,
// terrain of each height, 3-inch Barricades, Aerial units, a Mine - and the
// hand cases of 4.2.4.
import { loadEngine } from './_engine.mjs';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}\n       got  ${g}`); }
};

console.log('What is in the way, in one walk of the lines\n');

const { M } = await loadEngine('obstructors', []);

// The old reading: each piece and each unit asked alone, on the very lines.
const reference = (a, b, terrain, tokens) => {
  if ((a.aerial && !a.mine) || (b.aerial && !b.mine)) return { terrain: [], units: [] };
  return {
    terrain: terrain.filter((p) => M.R.losBetweenNow(a, b, [p], []) !== 'clear'),
    units: tokens.filter((t) => t.uid !== a.uid && t.uid !== b.uid && !t.aerial && M.R.losBetweenNow(a, b, [], [t]) !== 'clear'),
  };
};
const named = (r) => ({ terrain: r.terrain.map((p) => p.id), units: r.units.map((t) => t.uid) });

// A table drawn by lot, the same every run.
let seed = 20261011;
const rnd = () => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return seed / 2 ** 32; };
const pick = (n) => Math.floor(rnd() * n);
const unit = (uid) => {
  const size = [1, 2, 3, 3][pick(4)];
  const barricade = size === 3 && rnd() < 0.08;
  const aerial = !barricade && rnd() < 0.1;
  return {
    uid, side: uid % 2 ? 's1' : 's2', kind: size === 3 && !barricade ? 'mech' : 'drone', cardId: barricade ? 'PDAM-003' : 'X',
    col: pick(37 - size), row: pick(37 - size), size, aerial, mine: aerial && rnd() < 0.3, facing: pick(4), statuses: [], partStates: {},
  };
};
const piece = (i) => {
  const w = 1 + pick(4), h = 1 + pick(4), c0 = pick(34), r0 = pick(34);
  const subCells = [];
  for (let dc = 0; dc < w; dc++) for (let dr = 0; dr < h; dr++) subCells.push({ col: c0 + dc, row: r0 + dr });
  const height = [1, 2, 3][pick(3)];
  return { id: `p${i}`, type: 'building', subCells, height, blocksLos: height >= 3, providesProtection: true, isFragile: false };
};

let tables = 0, asked = 0, differ = 0, named0 = 0, first = null;
for (let n = 0; n < 4000; n++) {
  const tokens = Array.from({ length: 4 + pick(12) }, (_, i) => unit(i + 1));
  const terrain = Array.from({ length: pick(10) }, (_, i) => piece(i));
  tables++;
  for (let k = 0; k < 3; k++) {
    const a = tokens[pick(tokens.length)];
    const b = tokens[pick(tokens.length)];
    if (a === b) continue;
    asked++;
    const want = named(reference(a, b, terrain, tokens));
    const got = named(M.R.obstructorsOf(a, b, terrain, tokens));
    if (want.terrain.length + want.units.length) named0++;
    if (JSON.stringify(got) !== JSON.stringify(want)) { differ++; first ??= { a, b, want, got }; }
  }
}
console.log(`  (${tables} tables, ${asked} lines of sight asked, ${named0} with something in the way)`);
check('ON RANDOM TABLES the one walk names exactly what each piece and unit asked alone named, in the same order', [differ, first], [0, null]);
check('and the tables were worth asking: a good share of the lines had something in the way', named0 > asked / 3, true);

// The hand cases (4.2.4): a unit at a corner the lines only touch, a line along a Grid's edge.
{
  const at = (uid, col, row, size = 3) => ({ uid, side: 's1', kind: 'mech', cardId: 'X', col, row, size, aerial: false, facing: 0, statuses: [], partStates: {} });
  const a = at(1, 0, 0);
  const b = at(2, 12, 12);
  const corner = at(3, 3, 3);
  const beside = at(4, 12, 0);
  check('a unit standing where the lines pass is named; one off to the side is not',
    named(M.R.obstructorsOf(a, b, [], [a, b, corner, beside])).units, named(reference(a, b, [], [a, b, corner, beside])).units);
  const wall = { id: 'w', type: 'high_wall', subCells: [{ col: 6, row: 5 }, { col: 6, row: 6 }, { col: 6, row: 7 }], height: 3, blocksLos: true, providesProtection: true, isFragile: false };
  check('a wall across the lines is named, as the old reading named it',
    named(M.R.obstructorsOf(a, b, [wall], [a, b])), named(reference(a, b, [wall], [a, b])));
  const m1 = at(5, 0, 0, 2);
  const m2 = at(6, 8, 0, 2);
  const edge = at(7, 4, 1, 1);
  check('a Medium base\'s middle line along a Grid\'s edge skims a unit filling one side only, as it did',
    named(M.R.obstructorsOf(m1, m2, [], [m1, m2, edge])), named(reference(m1, m2, [], [m1, m2, edge])));
  const air = { ...at(8, 6, 6), aerial: true };
  check('nothing is in the way of a line to an Aerial unit, and an Aerial unit is in nobody\'s',
    [named(M.R.obstructorsOf(a, air, [wall], [a, air, corner])), named(M.R.obstructorsOf(a, b, [], [a, b, air])).units], [{ terrain: [], units: [] }, []]);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
