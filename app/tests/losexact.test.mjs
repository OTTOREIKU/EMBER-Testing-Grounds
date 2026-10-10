// THE LINES OF SIGHT, EXACT (OTTO, 2026-10-08: "My wildcat is attempting to
// shoot the enemy Dune. There are two 3'' walls blocking but it only says
// obstructed"). rules.ts walked each of the 81 lines between two Bases by a
// point every third of a cell, and a line that cut a building's corner by a
// sliver passed between two of its points: the one line that did so was taken
// for sight. Each line is now walked cell by cell (rules.ts lineCells), with
// 4.2.4's note: "A line that passes through the edge or corner of an occupied
// Grid is considered to have Obstructed Line of Sight", save that a line "in
// alignment with the edges" of the Grids is not. Held here against the Wild
// Cat's own table, against the rule's two cases built by hand, and against a
// second reckoning of every line on boards drawn at random.
import { loadEngine, freshState } from './_engine.mjs';
import { meets, reckonLines } from './_sightref.mjs';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}\n       got  ${g}`); }
};

console.log('Lines of sight, exact\n');

const { M, data } = await loadEngine('losexact', ["export * as TU from '../src/turn';"]);
const unit = (uid, col, row, size, extra = {}) => ({ uid, label: `U${uid}`, cardId: 'x', side: 's1', col, row, size, facing: 0, statuses: [], aerial: false, ...extra });
const wall = (id, cells, height = 3) => ({
  id, type: height >= 3 ? 'high_wall' : 'low_wall', subCells: cells.map(([col, row]) => ({ col, row })),
  height, blocksLos: height >= 3, providesProtection: height >= 2, isFragile: false,
});

// The Wild Cat's table (bot game 2, 2026-10-08, played back to the board it was
// logged on): the Wild Cat in C7, the Dune in G3, the two 3-inch buildings of the
// Intersection in D5 and E5 between them, the Raven and the Tarantula by the Wild
// Cat, two Razor missiles in the air.
{
  const s = freshState(M, data);
  s.map = 'crossroads';
  const terrain = M.TU.terrainOf(data, s);
  const cat = unit(3, 6, 18, 3);
  const dune = unit(2, 18, 6, 3);
  const tokens = [unit(1, 15, 3, 3), dune, cat, unit(5, 10, 15, 2), unit(6, 3, 18, 2),
    unit(9, 13, 10, 1, { aerial: true }), unit(10, 13, 10, 1, { aerial: true })];
  check('the Wild Cat has no line of sight to the Dune: every line meets a building, the best of them its corner',
    [M.R.losBetweenNow(cat, dune, terrain, tokens), M.R.firingSightNow(cat, dune, terrain, tokens, [])], ['blocked', 'blocked']);
  check('nor the Dune to the Wild Cat', M.R.losBetweenNow(dune, cat, terrain, tokens), 'blocked');
  // The Porcupine that day stood in E6, under the second building: lines from the
  // Dune pass the building's corner on the open side, so the Dune saw it.
  const porcupine = unit(4, 12, 16, 2);
  check('the Porcupine below the building was in sight of the Dune, past the building\'s corner',
    M.R.losBetweenNow(dune, porcupine, terrain, [...tokens, porcupine]), 'obstructed');
  // THE LINE THE BOARD DRAWS (OTTO, 2026-10-10: "lets have the engine draw the line in the way thats it's using to
  // calculate obstructed vs blocked"): the one the reading was taken on, judged here by the second reckoning's own
  // clipping: it meets no 3-inch cell, where the line between the centres would.
  const seen = [...tokens, porcupine];
  const drawn = M.R.firingSightLine(dune, porcupine, terrain, seen, []);
  const walls = terrain.filter((p) => p.blocksLos).flatMap((p) => p.subCells);
  const crosses = (x0, y0, x1, y1) => walls.some((c) => meets({ x: x0, y: y0 }, { x: x1, y: y1 }, c.col, c.row, c.col + 1, c.row + 1));
  const centres = [dune.col + dune.size / 2, dune.row + dune.size / 2, porcupine.col + porcupine.size / 2, porcupine.row + porcupine.size / 2];
  check('the board draws the line the sight was read on: past the corner, where the line between the centres meets the building',
    [drawn.sight, crosses(drawn.x0, drawn.y0, drawn.x1, drawn.y1), crosses(...centres)], ['obstructed', false, true]);
  const none = M.R.firingSightLine(cat, dune, terrain, tokens, []);
  check('with no line of sight at all it draws the line between the centres',
    [none.sight, [none.x0, none.y0, none.x1, none.y1]], ['blocked', [cat.col + 1.5, cat.row + 1.5, dune.col + 1.5, dune.row + 1.5]]);
  check('and its reading is firingSight\'s own', drawn.sight === M.R.firingSightNow(dune, porcupine, terrain, seen, []), true);
}
{
  // On open ground every line is clear, and the one drawn is the line between the centres.
  const open = M.R.firingSightLine(unit(1, 0, 0, 3), unit(2, 9, 6, 2), [], [], []);
  check('on open ground the line drawn is clear and runs between the centres', [open.sight, open.x0, open.y0, open.x1, open.y1], ['clear', 1.5, 1.5, 10, 7]);
}

// A corner touched is passed through. Two Small units a Grid apart corner to
// corner, 3-inch walls in the two cells beside the first one's corner: every
// line leaves its cell through one wall, the other, or the point where they
// meet.
{
  const a = unit(1, 0, 0, 1);
  const b = unit(2, 2, 2, 1);
  const walls = [wall('w1', [[1, 0]]), wall('w2', [[0, 1]])];
  check('a line through the point where two walls meet sees nothing', M.R.losBetweenNow(a, b, walls, [a, b]), 'blocked');
  check('one wall alone leaves the lines past its corner on the open side', M.R.losBetweenNow(a, b, [walls[0]], [a, b]), 'obstructed');
  const c = unit(3, 1, 0, 1);
  check('a unit in a cell the line passes only at the corner obstructs it', M.R.losBetweenNow(a, b, [], [a, b, c]), 'obstructed');
}

// A line along a Grid's edge (only a Medium Base's middle draws one) passes
// through what fills both sides of it: the line down the middle of a wall two
// cells wide is no sight.
{
  const a = unit(1, 0, 0, 2);
  const b = unit(2, 0, 6, 2);
  check('the line down the middle of a wall is no sight', M.R.losBetweenNow(a, b, [wall('w1', [[0, 3], [1, 3]])], [a, b]), 'blocked');
  check('a wall in one column leaves the other', M.R.losBetweenNow(a, b, [wall('w1', [[0, 3]])], [a, b]), 'obstructed');
}

// A second reckoning of every line (_sightref.mjs): each cell's square against
// the line, clipped, edges and corners included; a line along a Grid's edge by
// the two cells either side. Not the walk's column-by-column way, so the two
// can only agree by both being right.
const reckon = (a, b, terrain, tokens, smokeGrids) => {
  if (smokeGrids) {
    const inSmoke = (t) => M.TY.baseCells(t).some((c) => smokeGrids.has(`${Math.floor(c.col / 3)},${Math.floor(c.row / 3)}`));
    if (inSmoke(a) || inSmoke(b)) return 'smoked';
  }
  return reckonLines(M, a, b, terrain, tokens, smokeGrids);
};

{
  let seed = 20261008;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296);
  const maps = Object.keys(data.terrain.layouts);
  let pairs = 0, same = 0, smokePairs = 0, smokeSame = 0, shieldPairs = 0, shieldSame = 0;
  const odd = [];
  for (let n = 0; n < 120; n++) {
    const s = freshState(M, data);
    s.map = maps[n % maps.length];
    const terrain = M.TU.terrainOf(data, s);
    const filled = new Set();
    for (const p of terrain) for (const c of p.subCells) filled.add(`${c.col},${c.row}`);
    const tokens = [];
    for (let tries = 0; tokens.length < 8 && tries < 400; tries++) {
      const size = [1, 2, 3][Math.floor(rnd() * 3)];
      const col = Math.floor(rnd() * (36 - size + 1)), row = Math.floor(rnd() * (36 - size + 1));
      const cells = [];
      for (let dc = 0; dc < size; dc++) for (let dr = 0; dr < size; dr++) cells.push(`${col + dc},${row + dr}`);
      if (cells.some((k) => filled.has(k))) continue;
      for (const k of cells) filled.add(k);
      tokens.push(unit(tokens.length + 1, col, row, size));
    }
    const smoke = [];
    for (let i = 0; i < 3; i++) smoke.push({ col: Math.floor(rnd() * 12), row: Math.floor(rnd() * 12), side: 's1' });
    const smokeGrids = new Set(smoke.map((x) => `${x.col},${x.row}`));
    for (const a of tokens) for (const b of tokens) {
      if (a.uid >= b.uid) continue;
      pairs++;
      const got = M.R.losBetweenNow(a, b, terrain, tokens), want = reckon(a, b, terrain, tokens, null);
      if (got === want) same++; else if (odd.length < 3) odd.push(`${s.map} ${a.size}@(${a.col},${a.row}) ${b.size}@(${b.col},${b.row}): walk ${got}, reckoned ${want}`);
      smokePairs++;
      const gotS = M.R.firingSightNow(a, b, terrain, tokens, smoke), wantS = reckon(a, b, terrain, tokens, smokeGrids);
      if (gotS === wantS) smokeSame++; else if (odd.length < 3) odd.push(`smoke ${s.map} ${a.size}@(${a.col},${a.row}) ${b.size}@(${b.col},${b.row}): walk ${gotS}, reckoned ${wantS}`);
      for (const u of tokens) {
        if (u === a || u === b) continue;
        shieldPairs++;
        const crosses = M.R.lineCrossesUnit(a, b, u);
        const alone = reckon(a, b, [], [a, b, u], null);
        if (crosses === (alone !== 'clear')) shieldSame++; else if (odd.length < 3) odd.push(`shield ${a.size}@(${a.col},${a.row}) ${b.size}@(${b.col},${b.row}) through ${u.size}@(${u.col},${u.row}): ${crosses} v ${alone}`);
      }
    }
  }
  for (const o of odd) console.log('       ', o);
  check(`every reading on random boards agrees with the second reckoning (${pairs} pairs)`, same, pairs);
  check(`and with smoke on the board (${smokePairs} pairs)`, smokeSame, smokePairs);
  check(`a unit in the line (Automatic Shield) is read on the same lines (${shieldPairs} readings)`, shieldSame, shieldPairs);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
