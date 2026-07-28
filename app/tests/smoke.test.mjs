// Checks Smoke Screen grouping, dissipation and LoS against rulebook 4.16 / 4.2.3.
import { readFileSync, writeFileSync } from 'node:fs';

// Slice out the smoke helpers — rules.ts's other exports pull in DOM-facing types.
const srcUrl = new URL('../src/rules.ts', import.meta.url);
const src = readFileSync(srcUrl, 'utf8');
const start = src.indexOf('export function smokeKey');
const end = src.indexOf('export function canStandIn');
if (start < 0 || end < 0) throw new Error('could not locate smoke helpers in rules.ts');
const tmp = new URL('./_smoke.slice.ts', import.meta.url);
writeFileSync(tmp, 'type Side = any;\ntype SmokeScreen = any;\ntype Token = any;\n' + src.slice(start, end));
const { smokeGroups, dissipationFor, smokeNeighbours, smokeBlocks } = await import(tmp.href);

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}, got ${g}`); }
};
const S = (col, row, side = 'blue') => ({ col, row, side });
const sizes = (groups) => groups.map((g) => g.length).sort((a, b) => a - b);
// One End Phase: snapshot the groups, then remove. That ordering is what makes
// the merge and split notes on p.77 fall out without extra bookkeeping.
const round = (smoke, side) => {
  const d = dissipationFor(smoke, side);
  const doomed = new Set([...d.isolated, ...d.groups.map((g) => g[0])]);
  return smoke.filter((s) => !doomed.has(s));
};

console.log('Smoke Screens — rulebook 4.16\n');

// Contact is edge sharing at Small-Grid resolution, so a corner touch is not Contact (4.2.3).
check('orthogonal neighbours are in Contact', smokeNeighbours(S(3, 3), S(4, 3)), true);
check('diagonal touch is NOT Contact', smokeNeighbours(S(3, 3), S(4, 4)), false);
check('a gap is not Contact', smokeNeighbours(S(3, 3), S(5, 3)), false);

// Groups are per player: the enemy's screens never join yours.
check('one chain is one group', sizes(smokeGroups([S(1, 1), S(2, 1), S(3, 1)], 'blue')), [3]);
check('two separate blobs are two groups', sizes(smokeGroups([S(1, 1), S(2, 1), S(6, 6)], 'blue')), [1, 2]);
check('enemy screens do not join your group', sizes(smokeGroups([S(1, 1), S(2, 1, 'red')], 'blue')), [1]);
check('enemy screens form their own group', sizes(smokeGroups([S(1, 1), S(2, 1, 'red')], 'red')), [1]);

// Different players may share a Grid; the same player may not (enforced at placement).
check('overlapping enemy screens stay separate', sizes(smokeGroups([S(4, 4), S(4, 4, 'red')], 'blue')), [1]);

// End Phase: every isolated screen goes, plus one from each connected group.
const spread = [S(1, 1), S(5, 5), S(8, 8), S(8, 9)];
const d1 = dissipationFor(spread, 'blue');
check('isolated screens are all owed', d1.isolated.length, 2);
check('connected groups owe one each', d1.groups.length, 1);
check('a round of dissipation leaves the survivors', round(spread, 'blue').length, 1);

// Merge note (p.77 ①): two groups joined by a new screen are one group, so one removal.
const merged = [S(2, 2), S(3, 2), S(4, 2), S(5, 2)];
check('merged chain is a single group', sizes(smokeGroups(merged, 'blue')), [4]);
check('merged group loses only 1', merged.length - round(merged, 'blue').length, 1);

// Split note (p.77 ②): removing the middle splits the group, but the halves owe
// nothing more until the following End Phase.
const line = [S(2, 2), S(3, 2), S(4, 2), S(5, 2), S(6, 2)];
const afterFirst = line.filter((s) => s !== line[2]);
check('removing the middle splits it in two', sizes(smokeGroups(afterFirst, 'blue')), [2, 2]);
check('the split costs nothing extra that round', afterFirst.length, 4);
check('next round each half loses one', round(afterFirst, 'blue').length, 2);

// LoS: smoke blocks Firing through it, and blinds a unit standing in it.
const unit = (col, row, size = 1, aerial = false) => ({ col, row, size, aerial, uid: col * 100 + row });
check('clear line with no smoke', smokeBlocks(unit(1, 1), unit(1, 25), []), false);
check('smoke between two units blocks', smokeBlocks(unit(1, 1), unit(1, 25), [S(0, 4)]), true);
check('smoke off to the side does not block', smokeBlocks(unit(1, 1), unit(1, 25), [S(7, 4)]), false);
check('a unit standing in smoke is blind', smokeBlocks(unit(4, 4), unit(30, 30), [S(1, 1)]), true);
check('a unit standing in smoke cannot be seen', smokeBlocks(unit(30, 30), unit(4, 4), [S(1, 1)]), true);
// Aerial units are not exempt the way they are from terrain.
check('aerial cannot see through smoke either', smokeBlocks(unit(1, 1, 1, true), unit(1, 25), [S(0, 4)]), true);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
