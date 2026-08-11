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

// ---------- F3: Smoke is the one thing that blocks an Interception ----------
//
// Rulebook 4.9 says that because only Aerial Units trigger Interception, "Line
// of Sight always exists" — no terrain, no arc, no Protection. FAQ F3 carves out
// the single exception: "Can a Projectile whose Starting Grid or Landing Grid is
// inside Smoke be Intercepted?" — "No. Smoke blocks line of sight for
// Interception." So Smoke overrides the rulebook here, and NOTHING ELSE does.
//
// The trigger is written "starting Grid OR end Grid" (4.9), so Smoke removes one
// grid from consideration rather than cancelling the Interception outright: a
// shot the interceptor can still see from the other end is still owed. That is
// the reading built, and this is where it is held.
const rulesSrc = readFileSync(new URL('../src/rules.ts', import.meta.url), 'utf8');
const cut = (src, from, to, what) => {
  const a = src.indexOf(from);
  const b = to === null ? src.length : src.indexOf(to, a);
  if (a < 0 || b < 0) throw new Error(`could not locate ${what}`);
  return src.slice(a, b);
};
const tmp2 = new URL('./_intercept.owed.ts', import.meta.url);
writeFileSync(
  tmp2,
  'type Card = any;\ntype CardAction = any;\ntype GameData = any;\ntype Token = any;\ntype SmokeScreen = any;\ntype PartSlot = any;\n'
    + 'const PART_SLOTS = ["torso","chasis","leftHand","rightHand","backpack"];\n'
    + 'function largeGridOf(t: any): any { return { c: Math.floor(t.col / 3), r: Math.floor(t.row / 3) }; }\n'
    + 'function rangeBetween(a: any, b: any): any { const p = largeGridOf(a), q = largeGridOf(b);\n'
    + '  return { range: Math.abs(p.c - q.c) + Math.abs(p.r - q.r) }; }\n'
    + 'function statusCount(list: any, id: string): number { return (list ?? []).filter((x: any) => x === id).length; }\n'
    // The real smoke reader, not a stand-in: it is the thing under test.
    + cut(rulesSrc, 'export function smokeKey', 'export function smokeBlocks', 'smokeKey')
    + cut(rulesSrc, 'export function smokeBlocks', '\n}\n', 'smokeBlocks') + '\n}\n'
    + src.slice(src.indexOf('export function interceptCapacity'), src.indexOf('function initIntercept'))
    + src.slice(src.indexOf('export function interceptsOwed'), src.indexOf('function alive(t: Token)'))
    + src.slice(src.indexOf('export function tokenCards'), src.indexOf('// ---------- Tarantula Loads')),
);
const O = await import(tmp2.href);

// ADK15D Porcupine (160) prints Intercept 3 at Range 4 — a real card, so the
// reach and the token count come from the data rather than from this file.
const guard = (uid, c, r) => ({
  uid, side: 's2', kind: 'drone', cardId: '160', col: c * 3 + 1, row: r * 3 + 1, size: 1,
  facing: 0, aerial: false, label: 'Porcupine', partStates: { main: 'intact' },
  ammo: {}, intercept: { '160_A': 3 }, statuses: [],
});
const shooter = { uid: 20, side: 's1', kind: 'mech', cardId: '539', col: 1, row: 1, size: 3, facing: 0,
  aerial: false, label: 'Launcher', partStates: { torso: 'intact' }, ammo: {}, intercept: {}, statuses: [] };
// The missile is Aerial, which is what makes it interceptable at all.
const shot = (c, r) => ({ uid: 30, side: 's1', kind: 'projectile', cardId: '074', col: c * 3 + 1, row: r * 3 + 1,
  size: 1, facing: 0, aerial: true, label: 'Missile', partStates: { main: 'intact' }, ammo: {}, intercept: {}, statuses: [] });
const cardData = { byId: new Map(cards.map((c) => [String(c.id), c])) };
const owed = (smoke, g, p) => O.interceptsOwed(cardData, [g, shooter, p], smoke, shooter, [p])
  .map((x) => [x.uid, x.actionId]);

const g1 = guard(2, 4, 4);
check('with no Smoke, a missile inside reach is owed an Interception',
  owed([], g1, shot(5, 4)), [[2, '160_A']]);
// The whole of F3, in one line: cover the landing Grid and the shot is safe.
check('Smoke over the landing Grid takes the Interception away (F3)',
  owed([{ col: 5, row: 4 }], g1, shot(5, 4)), []);
// The OR in 4.9's trigger is what keeps this from being a blanket immunity: the
// interceptor could still see the launcher, so the debt stands.
check('but Smoke on the landing Grid alone leaves the START grid to trigger on',
  owed([{ col: 5, row: 4 }], guard(2, 1, 2), shot(5, 4)).length > 0, true);
check('and Smoke over BOTH ends is what actually cancels it',
  owed([{ col: 5, row: 4 }, { col: 0, row: 0 }], guard(2, 1, 2), shot(5, 4)), []);
// Sanity: the exemption is Smoke's alone. Range still gates normally.
check('a missile beyond Range 4 is never owed, Smoke or not',
  owed([], g1, shot(11, 11)), []);
check('an ally never intercepts its own side',
  O.interceptsOwed(cardData, [{ ...g1, side: 's1' }, shooter, shot(5, 4)], [], shooter, [shot(5, 4)]), []);
// Fire Control Interference grounds an interceptor outright (FAQ J5).
check('an FCI-jammed interceptor owes nothing',
  owed([], { ...g1, statuses: ['fci'] }, shot(5, 4)), []);
check('nor does one with its Interception Tokens spent',
  owed([], { ...g1, intercept: { '160_A': 0 } }, shot(5, 4)), []);

// The full set, so a data refresh that changes a value shows up here.
const all = [];
for (const c of cards) for (const a of c.actions ?? []) {
  const n = interceptCapacity(a);
  if (n !== undefined) all.push(`${a.id}:${n}`);
}
check('20 actions carry Intercept', all.length, 20);
check('token counts stay in the printed range', [...new Set(all.map((s) => Number(s.split(':')[1])))].sort(), [1, 2, 3]);

console.log(`\n${pass} passed, ${fail} failed`);
// `process.exitCode` rather than `process.exit()`: this file is the only one in
// the suite with TWO dynamic imports, and exiting hard while the second module
// loader is still settling trips a libuv assertion on Windows
// (`!(handle->flags & UV_HANDLE_CLOSING)`). It surfaced only under the suite
// runner, never on a standalone run, so it reads as a random suite failure.
// Setting the code and letting Node drain is the fix.
process.exitCode = fail ? 1 : 0;
