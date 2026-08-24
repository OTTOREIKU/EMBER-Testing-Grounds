// The keyword chips on a card are only useful if they open something. This
// pins the LINK: every keyword the cards actually print must resolve through
// the same merge and index the loader builds, and the rendered glossary must
// not show the same keyword twice.
//
// The bug this exists to stop: keyword_overrides.json is keyed by the Chinese
// term, and an override whose key matches no entry in keywords.json is not an
// error -- the loader APPENDS it as a brand new glossary entry. That is
// deliberate (the card-banner archetype tags arrive that way), which is
// exactly why a TYPO in a key looks identical to a new entry and is silent.
// 直線移動 was keyed in traditional characters while every card prints the
// simplified 直线移动, so the improved text never reached the three cards that
// needed it and the glossary listed "Moving in Straight Line" twice.
//
// So the intentional new keys are pinned by name below: a new arrival in that
// list is either a deliberate addition (add it here) or a mis-keyed override.
import { readFileSync } from 'node:fs';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}, got ${g}`); }
};

console.log('Keyword linking: every printed chip resolves\n');

const json = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8'));
const cardsRaw = json('../../data/cards.json');
const cards = Array.isArray(cardsRaw) ? cardsRaw : cardsRaw.cards;
const kwRaw = json('../../data/keywords.json');
const rawKeywords = Array.isArray(kwRaw) ? kwRaw : (kwRaw.keywords ?? []);
const overrides = json('../../data/keyword_overrides.json').overrides ?? {};

// ---------- the merge, replicated exactly (data.ts: loadData) ----------
const keywords = rawKeywords.map((k) => {
  const o = overrides[k.key];
  return o ? { ...k, ...o, en: { ...k.en, ...o.en } } : k;
});
const haveKeys = new Set(keywords.map((k) => k.key));
const appended = [];
for (const [key, def] of Object.entries(overrides)) {
  if (!haveKeys.has(key)) { keywords.push({ key, ...def }); appended.push(key); }
}

// ---------- the index and lookup, replicated exactly (data.ts) ----------
const index = new Map();
const add = (key, def) => { if (key) index.set(String(key).trim().toLowerCase(), def); };
for (const k of keywords) {
  add(k.key, k);
  add(k.zh?.name, k);
  add(k.en?.name?.replace(/^[•·\s]+/, ''), k);
  add(k.jp?.name, k);
}
const keyword = (nameOrKey) => {
  if (!nameOrKey) return undefined;
  const raw = String(nameOrKey).trim().replace(/^[•·\s]+/, '').toLowerCase();
  return index.get(raw) ?? index.get(raw.replace(/\d+/g, 'x')) ?? index.get(raw.replace(/\d+/g, ''));
};

// Guard the reader: if the shapes above ever stop matching the data, every
// other assertion here would pass by reading nothing.
check('the glossary was actually read', keywords.length > 50, true);
check('the cards were actually read', cards.length > 200, true);

// ---------- every keyword the CARDS print ----------
const printed = new Map();
const note = (s, id) => {
  if (!s) return;
  const k = String(s).trim();
  if (!printed.has(k)) printed.set(k, new Set());
  printed.get(k).add(String(id));
};
for (const c of cards) {
  for (const k of c.keywords ?? []) note(k?.key ?? k?.inline ?? k?.en?.name ?? k, c.id);
  for (const a of c.actions ?? []) {
    for (const k of a.keywords ?? []) note(k?.inline ?? k?.key ?? k?.en?.name ?? k, c.id);
  }
}
check('cards do print keywords', printed.size > 40, true);

const unresolved = [...printed.keys()].filter((k) => !keyword(k)).sort();
check('every printed keyword opens a glossary entry', unresolved, []);

// An entry that resolves but says nothing is the same dead end to a reader.
const empty = [...printed.keys()]
  .filter((k) => !((keyword(k)?.en?.value ?? '').trim()))
  .sort();
check('and every one of them has English text', empty, []);

// ---------- the rendered list has no twins ----------
// The Keywords tab lists data.keywords straight through, so two entries
// sharing an English name are two rows a reader cannot tell apart.
const byName = new Map();
for (const k of keywords) {
  const n = (k.en?.name ?? '').trim();
  if (!n) continue;
  if (!byName.has(n)) byName.set(n, []);
  byName.get(n).push(k.key);
}
const twins = [...byName.entries()].filter(([, ks]) => ks.length > 1).map(([n, ks]) => `${n}: ${ks.join(' + ')}`);
check('no keyword is listed twice under one English name', twins, []);

// ---------- override keys that appended rather than patched ----------
// These are the card-banner archetype and subtype tags, plus the handful of
// real keywords the community bundle simply lacks. Anything else here is a
// key that failed to match the entry it meant to patch.
const INTENTIONAL = [
  '信标', '命中', '地雷', '墙', '导弹', '导弹组X', '巡航', '抛射物', '机动掩体',
  '榴弹', '牵引X', '火箭', '烟幕弹', '电子对抗', '自行地雷', '设置物',
  '路障', '智能榴弹',
].sort();
const surprises = appended.slice().sort().filter((k) => !INTENTIONAL.includes(k));
check('no override key silently appended a new entry', surprises, []);

// And the reverse: a pinned key that stops appending means keywords.json grew
// an entry of its own, so the override is now patching instead of adding.
const stale = INTENTIONAL.filter((k) => !appended.includes(k));
check('every pinned new-entry key is still a new entry', stale, []);

console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
