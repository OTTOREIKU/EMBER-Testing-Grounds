// Checks Break Away movement costs and Crush targeting (rulebook 4.3.5, 4.3.6),
// including the worked numbers printed on book p.46.
import { readFileSync, writeFileSync } from 'node:fs';

const src = readFileSync(new URL('../src/rules.ts', import.meta.url), 'utf8');
const start = src.indexOf('let GRIDS');
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

// ---------- LPA-21 Firefly's 匿踪 Stealth: phaseThrough ----------
//
// "Piloted Mech's movement route may pass through other units when Optical
// Camouflage is on or in Low Profile." WHICH pilot turns the flag on is
// asserted in pilottraits.test.mjs against the real cards; what is checked here
// is the movement rule the flag buys, which is where it could go badly wrong.
{
  // Size 3, because a Large Grid is 3x3 cells and two SMALL units share one
  // happily — only a Large unit fills a Grid so that nothing else may enter.
  const walker = unit(0, 0, 3);
  const blocker = at(0, 1, 3);
  const world = [walker, blocker];
  const phase = { phaseThrough: true };

  // Without it, a unit in the way is a wall: the Grid beyond is unreachable.
  check('a blocked Grid stops the search',
    reach(walker, 2, undefined, [], world).includes('0,2:2'), false);
  check('and the blocked Grid itself is not reachable either',
    reach(walker, 2, undefined, [], world).includes('0,1:1'), false);

  // With it, the route passes THROUGH and the far side opens up.
  check('phaseThrough lets the route cross an occupied Grid',
    reach(walker, 2, phase, [], world).includes('0,2:2'), true);
  // ROUTE, not destination: the occupied Grid is still not somewhere to stop.
  check('but the occupied Grid is still not a legal place to stand',
    reach(walker, 2, phase, [], world).includes('0,1:1'), false);

  // THE TRAP. standingSpot folds terrain and unit footprints into one blocked
  // set, so a naive `passable = true` walks through buildings. The re-check
  // against an EMPTY token list is what keeps them solid.
  const building = rubble(0, 1, false);
  check('and a BUILDING is still solid, which is the whole point of the empty-token re-check',
    reach(walker, 2, phase, [building], [walker]).includes('0,2:2'), false);
  // Both at once: a unit standing in a building's Grid is still not passable.
  check('a unit inside terrain does not open it either',
    reach(walker, 2, phase, [building], world).includes('0,2:2'), false);

  // Break Away is still charged: this is pass-through, not flight.
  const locked = { ...phase, exitCost: (c, r) => (c === 0 && r === 0 ? 1 : 0) };
  check('Break Away is still paid, so the step out costs 2',
    reach(walker, 2, locked, [], world).includes('0,2:2'), false);
  check('and with the Range to afford it, the same route opens — at 3, not 2',
    reach(walker, 3, locked, [], world).includes('0,2:3'), true);
}

// ---------- LPA-23 Onyx's 不屈 Indomitable: crushing equals and larger ----------
//
// "Piloted mech may Crush large units." crushTargets lives in this file's slice,
// so the rule is driven here — but the PILOT is taken from the shipped
// cards.json rather than invented, because "which pilot" is the whole rule and
// a fixture id would pass against a reader keyed on the wrong card.
{
  const raw = JSON.parse(readFileSync(new URL('../../data/cards.json', import.meta.url), 'utf8'));
  const cards = Array.isArray(raw) ? raw : raw.cards;
  const byId = new Map(cards.map((c) => [String(c.id), c]));
  const onyx = byId.get('LPA-23');
  // The negative control is a real UN LV4 pilot from the same faction whose
  // trait is a dice exchange, so it can never bend a movement legality.
  const sealock = byId.get('LPA-24');
  if (!onyx || !sealock) throw new Error('LPA-23 or LPA-24 is missing from cards.json');
  check('LPA-23 is the Indomitable card and LPA-24 is not',
    [onyx.trait, sealock.trait], ['不屈', '追击']);
  check('and its curated effect names the target class it adds',
    onyx.traitEffects?.map((e) => e.type), ['can_overrun_large_units']);

  const piloted = (id) => unit(0, 0, 3, { kind: 'mech', mech: { torso: '002', pilot: id } });
  const equal = at(0, 1, 3);
  const onyxMech = piloted(onyx.id);
  check('an Onyx Crushes a unit of its own size',
    crushTargets(onyxMech, 0, 1, [], [onyxMech, equal])?.units.map((u) => u.uid), [2]);
  const otherMech = piloted(sealock.id);
  check('and a Mech with any other pilot still cannot',
    crushTargets(otherMech, 0, 1, [], [otherMech, equal]), null);
  const pilotless = unit(0, 0, 3, { kind: 'mech', mech: { torso: '002' } });
  check('nor can a pilotless Mech', crushTargets(pilotless, 0, 1, [], [pilotless, equal]), null);

  // The trait adds a TARGET class, not a crusher class: a Medium Onyx still
  // Crushes nothing, because 4.3.6's "only Large Units Crush" is untouched.
  const medium = unit(0, 0, 2, { kind: 'mech', mech: { torso: '002', pilot: onyx.id } });
  check('a Medium chassis carrying the trait still Crushes nothing',
    crushTargets(medium, 0, 1, [], [medium, at(0, 1, 1)]), null);

  // Everything else the function refuses, it still refuses.
  check('an Onyx still cannot Crush a Barricade of any size (FAQ E6)',
    crushTargets(onyxMech, 0, 1, [], [onyxMech, { ...equal, barricade: true }]), null);
  check('nor an Aerial unit',
    crushTargets(onyxMech, 0, 1, [], [onyxMech, { ...equal, aerial: true }]), null);
  check('nor anything at all while Optically Camouflaged (FAQ I3/I9)',
    crushTargets({ ...onyxMech, statuses: ['camouflage'] }, 0, 1, [], [onyxMech, equal]), null);
  check('and a Large victim is still a route-ending Crush square, not a through-route',
    [reach(onyxMech, 2, { crushable: (c, r) => crushTargets(onyxMech, c, r, [], [onyxMech, equal]) !== null }, [], [onyxMech, equal]).includes('0,1:1'),
      reach(onyxMech, 2, { crushable: (c, r) => crushTargets(onyxMech, c, r, [], [onyxMech, equal]) !== null }, [], [onyxMech, equal]).includes('0,2:2')],
    [true, false]);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
