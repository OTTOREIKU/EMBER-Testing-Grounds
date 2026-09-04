// [Moving in Straight Line] +N (直线移动) - the RL-08 family's Jet Dash and the
// "Chance" Chassis - driven through the real movement search in rules.ts. The
// printed Range is what the Action always has; the bonus is paid only while the
// whole route runs one way, and a turn anywhere caps it at the printed number.
// FAQ E16 rides the same search: a Crush ends the Movement whatever is left.
import { readFileSync, writeFileSync } from 'node:fs';

const rules = readFileSync(new URL('../src/rules.ts', import.meta.url), 'utf8');
const units = readFileSync(new URL('../src/units.ts', import.meta.url), 'utf8');
const start = rules.indexOf('let GRIDS');
const end = rules.indexOf('export function losBetween');
if (start < 0 || end < 0) throw new Error('could not locate the movement search in rules.ts');
const tmp = new URL('./_straightline.slice.ts', import.meta.url);
writeFileSync(tmp, 'type TerrainPiece = any;\ntype Token = any;\ntype Side = any;\ntype SmokeScreen = any;\n' + rules.slice(start, end));
const { movePath, reachableGrids, extendPath, pathDirection } = await import(tmp.href);

// The reader, sliced from units.ts: standalone, so nothing else comes with it.
const rFrom = units.indexOf('export function straightLineBonus');
const rTo = units.indexOf('// ---------- Tarantula Loads');
if (rFrom < 0 || rTo <= rFrom) throw new Error('could not locate straightLineBonus in units.ts');
const tmp2 = new URL('./_straightline.reader.ts', import.meta.url);
writeFileSync(tmp2, 'type CardAction = any;\n' + units.slice(rFrom, rTo));
const { straightLineBonus } = await import(tmp2.href);

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}, got ${g}`); }
};

const unit = (c = 0, r = 0, size = 1) => ({ uid: 1, size, aerial: false, col: c * 3 + 1, row: r * 3 + 1, partStates: {} });
const cells = (p) => p.map((g) => `${g.c},${g.r}`);
const has = (list, c, r) => list.some((g) => g.c === c && g.r === r);
const dash = { straightBonus: 2 };

console.log('[Moving in Straight Line] +2 on a Range 3 Movement\n');

// ---------- the reader ----------
const raw = JSON.parse(readFileSync(new URL('../../data/cards.json', import.meta.url), 'utf8'));
const cards = Array.isArray(raw) ? raw : raw.cards;
const act = (id) => cards.flatMap((c) => c.actions ?? []).find((a) => a.id === id);
for (const id of ['021_A', '249_A', '281_A', 'PDCH-202_A']) {
  check(`${id} Jet Dash prints +2 in a straight line`, straightLineBonus(act(id)), 2);
}
check('a plain Sprint prints none', straightLineBonus(act('179_A')), 0);
check('a Firing Action prints none, whatever its text', straightLineBonus({ type: 'Firing', description: { en: '[Moving in Straight Line] +2 grids.' } }), 0);
check('nothing prints none', straightLineBonus(null), 0);

// ---------- the overlay ----------
const reach = reachableGrids(unit(), 3, [], [], false, dash);
check('the printed Range still reaches its 3 Grids on a turn', has(reach, 1, 2), true);
check('the straight run reaches 4', has(reach, 4, 0), true);
check('and 5', has(reach, 5, 0), true);
check('but not 6', has(reach, 6, 0), false);
check('a 4-Grid route with one turn is NOT reachable', has(reach, 3, 1), false);
check('nor a 5-Grid one', has(reach, 4, 1), false);
check('every ray pays the bonus, not just one', [has(reach, 0, 5), has(reach, 0, 4)], [true, true]);
const plain = reachableGrids(unit(), 3, [], [], false);
check('without the keyword the same walk stops at 3', [has(plain, 3, 0), has(plain, 4, 0)], [true, false]);

// ---------- the route ----------
check('the straight route to 5 is the six-Grid line', cells(movePath(unit(), { c: 5, r: 0 }, 3, [], [], false, dash)), ['0,0', '1,0', '2,0', '3,0', '4,0', '5,0']);
check('a turned route past the printed Range is no route at all', movePath(unit(), { c: 4, r: 1 }, 3, [], [], false, dash), []);

// ---------- chaining waypoints ----------
const two = [{ c: 0, r: 0 }, { c: 1, r: 0 }, { c: 2, r: 0 }];
check('pathDirection reads a straight run', pathDirection(two), '1,0');
check('and a route that has not stepped', pathDirection([{ c: 0, r: 0 }]), '');
check('and null once it has turned', pathDirection([...two, { c: 2, r: 1 }]), null);
const onward = extendPath(two, { c: 4, r: 0 }, unit(), 3, [], [], false, dash);
check('a straight run may be extended past the printed Range in its own direction', cells(onward ?? []), ['0,0', '1,0', '2,0', '3,0', '4,0']);
check('but not past the bonus', extendPath(two, { c: 6, r: 0 }, unit(), 3, [], [], false, dash), null);
check('a turn from the straight run keeps only the printed Range', cells(extendPath(two, { c: 2, r: 1 }, unit(), 3, [], [], false, dash) ?? []), ['0,0', '1,0', '2,0', '2,1']);
check('and cannot spend the bonus after turning', extendPath(two, { c: 2, r: 2 }, unit(), 3, [], [], false, dash), null);
const turned = [{ c: 0, r: 0 }, { c: 1, r: 0 }, { c: 1, r: 1 }];
check('a route already turned reaches its third Grid', cells(extendPath(turned, { c: 1, r: 2 }, unit(), 3, [], [], false, dash) ?? []), ['0,0', '1,0', '1,1', '1,2']);
check('and no further, even straight on from there', extendPath(turned, { c: 1, r: 3 }, unit(), 3, [], [], false, dash), null);
// Four straight Grids already walked: the base allowance is spent and only the
// straight bonus is left, which the extension must still honour.
const four = [{ c: 0, r: 0 }, { c: 1, r: 0 }, { c: 2, r: 0 }, { c: 3, r: 0 }, { c: 4, r: 0 }];
check('the fifth straight Grid is still reachable from four', cells(extendPath(four, { c: 5, r: 0 }, unit(), 3, [], [], false, dash) ?? []).at(-1), '5,0');
check('a sideways step from four is not', extendPath(four, { c: 4, r: 1 }, unit(), 3, [], [], false, dash), null);

// ---------- FAQ E16: a Crush still ends the Movement ----------
// A Large unit at (2,0) that the mover may Crush: the Grid is entered and the
// walk ends there, so the straight bonus cannot carry it on to (3,0).
const mover = unit(0, 0, 3);
const victim = { uid: 2, size: 1, aerial: false, col: 7, row: 1, partStates: {} };
const crushed = reachableGrids(mover, 3, [], [victim], false, { ...dash, crushable: (c, r) => c === 2 && r === 0 });
check('the Crush Grid is a legal landing', has(crushed, 2, 0), true);
check('and nothing lies beyond it on that ray', [has(crushed, 3, 0), has(crushed, 4, 0), has(crushed, 5, 0)], [false, false, false]);

// ---------- wiring ----------
const cmds = readFileSync(new URL('../src/commands.ts', import.meta.url), 'utf8');
const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
const hud = readFileSync(new URL('../src/matchhud.ts', import.meta.url), 'utf8');
check('the crushSwap ceiling knows the bonus reach',
  (cmds.match(/reach = Math\.max\(reach, \(a\.range \?\? 0\) \+ straightLineBonus\(a\)\)/g) ?? []).length, 2);
check('freeplay hands the Movement Action to its MoveOpts', /straightBonus: straightLineBonus\(action\),/.test(main), true);
check('and the Match Centre to both of its builders', (hud.match(/straightBonus: straightLineBonus\(actionId \? actionOn\(ctx, t, actionId\) : null\)/g) ?? []).length, 2);
check('the Match Centre route extension names the Action', /moveOptsFor\(ctx, t, m\.flying, m\.actionId\)/.test(hud), true);
check('and so does its overlay', /reachableFor\(ctx, t, movePlan\.steps, movePlan\.flying \|\| !!t\.aerial, movePlan\.actionId\)/.test(hud), true);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
