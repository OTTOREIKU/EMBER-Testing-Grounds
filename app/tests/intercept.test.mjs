// Checks Intercept X parsing against the real card data (rulebook 4.9).
//   Every card printing the Intercept keyword must yield a token count, and the
//   count must come from the card's own action, not a default.
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

// Slice out just the parser — units.ts's other imports need the DOM.
const srcUrl = new URL('../src/units.ts', import.meta.url);
const src = readFileSync(srcUrl, 'utf8');
const start = src.indexOf('export function interceptCapacity');
const end = src.indexOf('function initIntercept');
if (start < 0 || end < 0) throw new Error('could not locate interceptCapacity in units.ts');
const tmp = new URL('./_intercept.slice.ts', import.meta.url);
writeFileSync(tmp, 'type CardAction = any;\n' + src.slice(start, end));
const { interceptCapacity } = await import(tmp.href);

const dataUrl = new URL('../../data/cards.json', import.meta.url);
const raw = JSON.parse(readFileSync(dataUrl, 'utf8'));
const cards = Array.isArray(raw) ? raw : raw.cards ?? [];

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}, got ${g}`); }
};

console.log('Intercept X — rulebook 4.9\n');

// Known values read off the cards by hand.
const known = { '003_A': 3, '160_A': 3, 'ZHDR-102_A': 1, 'PRDR-101_C': 2, '553_B': 2, '284_A': 1 };
const byId = new Map();
for (const c of cards) for (const a of c.actions ?? []) byId.set(a.id, a);
for (const [id, want] of Object.entries(known)) {
  check(`${id} reads Intercept ${want}`, interceptCapacity(byId.get(id)), want);
}

// A card that prints the keyword but whose action yields nothing would silently
// deploy with no tokens, so the two views of the data must agree.
const kwCards = cards.filter((c) =>
  (c.keywords ?? []).some((k) => `${k.en ?? ''}${k.key ?? ''}`.includes('Intercept') || `${k.key ?? ''}`.includes('拦截')));
const missing = kwCards.filter((c) => !(c.actions ?? []).some((a) => interceptCapacity(a) !== undefined));
check('every Intercept card yields a count', missing.map((c) => c.id), []);

// Actions without the keyword must not pick a number out of neighbouring text.
const spurious = [];
for (const c of cards) {
  for (const a of c.actions ?? []) {
    const n = interceptCapacity(a);
    if (n === undefined) continue;
    const text = `${a.description?.en ?? ''}${a.description?.zh ?? ''}${a.description?.jp ?? ''}${(a.keywords ?? []).map((k) => k.inline ?? '').join('')}`;
    if (!/Intercept|拦截|迎撃/.test(text)) spurious.push(a.id);
    if (!Number.isInteger(n) || n < 1 || n > 9) spurious.push(`${a.id}=${n}`);
  }
}
check('no counts invented from unrelated text', spurious, []);

// The full set, so a data refresh that changes a value shows up here.
const all = [];
for (const c of cards) for (const a of c.actions ?? []) {
  const n = interceptCapacity(a);
  if (n !== undefined) all.push(`${a.id}:${n}`);
}
check('20 actions carry Intercept', all.length, 20);
check('token counts stay in the printed range', [...new Set(all.map((s) => Number(s.split(':')[1])))].sort(), [1, 2, 3]);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
