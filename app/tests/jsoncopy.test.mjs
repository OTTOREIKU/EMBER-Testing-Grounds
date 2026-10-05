// A COPY OF A TABLE, AS JSON WOULD MAKE IT (src/jsoncopy.ts): the copy a seat
// makes of the table for every answer it looks ahead through is JSON's own,
// to the byte, on every table of a game played out and on everything JSON
// treats in a way of its own; and it is a copy, sharing nothing.
import { botTable, loadEngine } from './_engine.mjs';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}\n       got  ${g}`); }
};

console.log('A copy of a table, as JSON would make it\n');

const { M, data } = await loadEngine('jsoncopy', ["export * as AI from '../src/ai/index';", "export * as JC from '../src/jsoncopy';"]);
const { copyAsJson } = M.JC;
const json = (v) => JSON.parse(JSON.stringify(v));

// What JSON does of its own: left out, made null, made 0, kept as a key.
const odd = JSON.parse('{"__proto__": {"x": 1}}');
const sample = {
  a: undefined, f: () => 1, s: Symbol('s'), n: NaN, inf: -Infinity, negZero: -0, keep: 'k',
  list: [undefined, () => 1, Symbol('t'), NaN, 1, [2, undefined]],
  holes: [1, , 3], // eslint-disable-line no-sparse-arrays
  when: new Date(Date.UTC(2026, 9, 5)), set: new Set([1]), map: new Map([[1, 2]]),
  deep: { deeper: { deepest: [{ x: 1, y: undefined }] } }, odd,
};
check('EVERYTHING JSON TREATS ITS OWN WAY is treated its way: undefined, functions and symbols left out of an object and null in an array, NaN and Infinity null, -0 is 0, a Date its string, a Set and a Map empty',
  JSON.stringify(copyAsJson(sample)), JSON.stringify(json(sample)));
const kept = copyAsJson(odd);
check('a key named __proto__ stays a key, as JSON.parse keeps it, and changes no object\'s prototype',
  [Object.keys(kept), Object.getPrototypeOf(kept) === Object.prototype, kept.__proto__?.x, ({}).x], [['__proto__'], true, 1, undefined]);
check('-0 comes back as 0', Object.is(copyAsJson({ z: -0 }).z, 0), true);
let refused = '';
try { copyAsJson({ big: 1n }); } catch (err) { refused = err instanceof TypeError ? 'TypeError' : String(err); }
check('and a BigInt is refused, as JSON refuses it', refused, 'TypeError');

// Every table of a game played out, copied both ways.
const scenario = data.solo.scenarios[0];
const t = botTable(M, data, scenario, { seed: 3, policies: M.AI.brawlerPolicy });
let tables = 0, alike = 0;
await t.run({ maxSteps: 6000, onStep: () => { tables++; if (JSON.stringify(copyAsJson(t.state)) === JSON.stringify(json(t.state))) alike++; } });
check('EVERY TABLE OF A GAME PLAYED OUT is copied to the byte as JSON copies it', [tables > 100, alike === tables], [true, true]);
const copied = copyAsJson(t.state);
copied.tokens[0].col += 1;
copied.tokens[0].partStates.torso = 'changed';
copied.round.n += 1;
check('and the copy shares nothing with the table it was made of', [t.state.tokens[0].col === copied.tokens[0].col, t.state.tokens[0].partStates.torso === 'changed', t.state.round.n === copied.round.n], [false, false, false]);
t.close();

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
