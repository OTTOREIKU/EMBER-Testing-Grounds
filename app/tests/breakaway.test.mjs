// Checks Break Away movement costs and Crush targeting (rulebook 4.3.5, 4.3.6),
// including the worked numbers printed on book p.46.
import { readFileSync, writeFileSync } from 'node:fs';

const src = readFileSync(new URL('../src/rules.ts', import.meta.url), 'utf8');
const start = src.indexOf('export const LG');
const end = src.indexOf('export function losBetween');
if (start < 0 || end < 0) throw new Error('could not locate the movement search in rules.ts');
const tmp = new URL('./_breakaway.slice.ts', import.meta.url);
writeFileSync(tmp, 'type TerrainPiece = any;\ntype Token = any;\ntype Side = any;\ntype SmokeScreen = any;\n' + src.slice(start, end));
const { crushTargets, extendPath, movePath, pathCost, reachableGrids } = await import(tmp.href);

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}, got ${g}`); }
};

const unit = (c = 0, r = 0, size = 1, extra = {}) =>
  ({ uid: 1, size, aerial: false, col: c * 3 + (size === 3 ? 0 : 1), row: r * 3 + (size === 3 ? 0 : 1), partStates: {}, ...extra });
const at = (c, r, size = 1, uid = 2) =>
  ({ uid, size, aerial: false, col: c * 3 + (size === 3 ? 0 : 1), row: r * 3 + (size === 3 ? 0 : 1), partStates: {} });
const rubble = (c, r, isFragile) => ({
  id: `t${c}${r}`, type: 'container', height: 1, blocksLos: false, providesProtection: true, isFragile,
  subCells: [0, 1, 2].flatMap((dc) => [0, 1, 2].map((dr) => ({ col: c * 3 + dc, row: r * 3 + dr }))),
});
// Locks on the listed Large Grids, each entry naming how many enemies lock there.
const locks = (map) => ({ exitCost: (c, r) => map[`${c},${r}`] ?? 0 });
const reach = (t, steps, opts, terrain = [], tokens = []) =>
  reachableGrids(t, steps, terrain, tokens, false, opts).map((g) => `${g.c},${g.r}:${g.dist}`).sort();

console.log('Break Away and Crush\n');

// Without a lock, a step still costs exactly 1.
check('an unlocked step costs 1', reach(unit(0, 0), 1, undefined), ['0,1:1', '1,0:1']);

// Book p.46: move 3 Grids while locked at the start and locked again once along
// the way, so Break Away is paid twice and the move needs 5 Movement Range.
const twice = locks({ '0,0': 1, '0,1': 1 });
const straight = (t, steps, opts) => movePath(t, { c: 0, r: 3 }, steps, [], [], false, opts).length;
check('3 grids breaking away twice needs 5', straight(unit(0, 0), 5, twice), 4);
check('and 4 Movement Range is not enough', straight(unit(0, 0), 4, twice), 0);

// Book p.46: move 2 Grids breaking away once costs 3.
const once = locks({ '0,0': 1 });
check('2 grids breaking away once needs 3', movePath(unit(0, 0), { c: 0, r: 2 }, 3, [], [], false, once).length, 3);
check('and 2 Movement Range is not enough', movePath(unit(0, 0), { c: 0, r: 2 }, 2, [], [], false, once).length, 0);

// Book p.46: 1 Grid while locked by 2 Units at once costs 3.
const pair = locks({ '0,0': 2 });
check('1 grid locked by two units needs 3', movePath(unit(0, 0), { c: 0, r: 1 }, 3, [], [], false, pair).length, 2);
check('and 2 Movement Range is not enough', movePath(unit(0, 0), { c: 0, r: 1 }, 2, [], [], false, pair).length, 0);

// The cost is charged for LEAVING, so the Grid you stop in never bills you.
check('stopping in a locked grid is free', reach(unit(0, 0), 1, locks({ '0,1': 3 })), ['0,1:1', '1,0:1']);
// And a lock on the starting Grid taxes every direction equally.
check('a lock at the start taxes each exit', reach(unit(0, 0), 2, once), ['0,1:2', '1,0:2']);

// The search must route around the tax, not just count steps. Leaving (0,0)
// costs 3 extra, so a detour through (1,0) reaches (1,1) cheaper than the
// shortest step count would suggest is possible.
const taxed = locks({ '0,1': 3 });
check('the search prefers the cheaper route', movePath(unit(0, 0), { c: 1, r: 1 }, 2, [], [], false, taxed).map((g) => `${g.c},${g.r}`), ['0,0', '1,0', '1,1']);

// Flying and Forced Movement pass no cost function at all, which is how they
// stay exempt (4.3.2, 4.3.4).
check('no cost function means no tax', reach(unit(0, 0), 1, {}), ['0,1:1', '1,0:1']);

// A hand-traced route is billed the same way, so the budget left over is right.
check('an unlocked trace costs its length', pathCost([{ c: 0, r: 0 }, { c: 0, r: 1 }], false, once), 2);
check('a flying trace ignores the tax', pathCost([{ c: 0, r: 0 }, { c: 0, r: 1 }], true, once), 1);
check('a one-grid trace costs nothing', pathCost([{ c: 0, r: 0 }], false, once), 0);
check('tracing stops when the budget is gone', extendPath([{ c: 0, r: 0 }, { c: 0, r: 1 }], { c: 0, r: 2 }, unit(0, 0), 2, [], [], false, once), null);
check('and continues while it is not', extendPath([{ c: 0, r: 0 }, { c: 0, r: 1 }], { c: 0, r: 2 }, unit(0, 0), 3, [], [], false, once).length, 3);

// ---------- Crush (4.3.6) ----------

const big = unit(0, 0, 3);
const small = at(0, 1, 1);
check('a large unit crushes a smaller one', crushTargets(big, 0, 1, [], [big, small])?.units.map((u) => u.uid), [2]);
check('but not one its own size', crushTargets(big, 0, 1, [], [big, at(0, 1, 3)]), null);
check('and a small unit crushes nothing', crushTargets(unit(0, 0), 0, 1, [], [unit(0, 0), small]), null);
check('an empty grid is not a crush', crushTargets(big, 0, 1, [], [big]), null);
check('destructible terrain is crushable', crushTargets(big, 0, 1, [rubble(0, 1, true)], [big])?.terrain.map((p) => p.id), ['t01']);
check('solid terrain is not', crushTargets(big, 0, 1, [rubble(0, 1, false)], [big]), null);
check('solid terrain protects the unit behind it', crushTargets(big, 0, 1, [rubble(0, 1, false)], [big, small]), null);
check('an aerial unit is not crushed', crushTargets(big, 0, 1, [], [big, { ...small, aerial: true }]), null);
check('off the board is never a crush', crushTargets(big, -1, 0, [], [big]), null);

// A Crush square is reachable even though it is occupied, and the Movement Action
// ends there, so the search must never expand through it.
const crushOpts = { crushable: (c, r) => crushTargets(big, c, r, [], [big, small]) !== null };
check('a crush square is reachable', reach(big, 2, crushOpts, [], [big, small]).includes('0,1:1'), true);
check('and movement does not continue past it', reach(big, 2, crushOpts, [], [big, small]).includes('0,2:2'), false);
check('while an open route past it still works', reach(big, 2, crushOpts, [], [big, small]).includes('1,1:2'), true);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
