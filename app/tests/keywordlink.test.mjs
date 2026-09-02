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

// ---------- the word that carries the rule ----------
//
// OTTO read Concussion in the reference and asked what "reduces target by 1"
// meant - 1 what? It meant Link, and the sentence never said so: the community
// bundle our keywords.json is generated from had dropped the word. Three of
// these lost exactly one load-bearing word each, and in every case the CHINESE,
// the JAPANESE and the publisher's championship-legal English parts lists all
// agreed on what it should be.
//
// The engine was right throughout - Armor Piercing really does take WHITE dice
// off, Concussion really does drain Link - so nothing played wrong. Only the
// sentence a player answers a rules question from was wrong, which is worse in
// its own way: the board did the right thing and the glossary could not say why.
console.log('\nthe word that carries the rule');

const byEnName = (n) => keywords.find((k) => (k.en?.name ?? '').replace(/^[•·\s]+/, '') === n);
const glossOf = (n) => (byEnName(n)?.en?.value ?? '');
check('Concussion says WHICH value it reduces', /reduces target Link by 1/.test(glossOf('Concussion')), true);
check('Armor Piercing says WHICH dice come off', /X white dice/.test(glossOf('Armor Piercing X')), true);
check('Disarm names the HIT Part, not any target Part', /hit Part/.test(glossOf('Disarm')), true);

// A different failure with the same result: the glyph never rendered, so the
// reader saw literal text where a symbol belongs. `(Eye}` opens with a
// PARENTHESIS, which no glyph pass matches.
const GLYPHS = ['Eye', 'Dodge', 'Lightning', 'Defense', 'Heavy Hit', 'Light Hit'];
const malformed = [];
for (const k of keywords) {
  const v = k.en?.value ?? '';
  for (const g of GLYPHS) {
    // an opening paren or bracket where a brace belongs, closed by a brace
    if (new RegExp(`[(\\[]${g}\\}`, 'i').test(v)) malformed.push(`${k.en?.name ?? k.key}: ${g}`);
  }
}
check('no glossary glyph is opened with the wrong bracket', malformed, []);
// And the same sweep over card text, since the bundle produces both.
const cardMalformed = [];
for (const c of cards) {
  const texts = [c.description?.en ?? '', ...(c.actions ?? []).map((a) => a.description?.en ?? '')];
  for (const v of texts) {
    for (const g of GLYPHS) {
      if (new RegExp(`[(\\[]${g}\\}`, 'i').test(v)) cardMalformed.push(`${c.id}: ${g}`);
    }
  }
}
check('nor is one on a card', cardMalformed, []);

// ---------- the reverse link: what NAMES a keyword, not just what prints it ----------
//
// A keyword sheet used to answer one question - which cards print this chip -
// and for a keyword that is a Token rather than a weapon trait that is nobody
// useful. Fragile is printed by exactly one card, while Laser Weapon hands one
// out on every hit and Ion Weapon cares whether the target has one. Both of
// those already LINK to Fragile in their own glossary text; Fragile could not
// see either of them.
//
// The relationships are pinned HERE, against the merged data, because they are
// what makes the feature worth having: if the glossary text is ever reworded so
// Laser Weapon stops naming Fragile, the sheet quietly loses the link and only
// this notices.
console.log('\nthe reverse link');

const glossText = (k) => (k.en?.value ?? '');
const named = (n) => keywords.find((k) => (k.en?.name ?? '').replace(/^[•·\s]+/, '') === n);

const laser = named('Laser Weapon');
const ion = named('Ion Weapon');
const fragile = named('Fragile');
check('the three keywords the report named are all in the glossary',
  [!!laser, !!ion, !!fragile], [true, true, true]);
check('Laser Weapon still hands out a Fragile Token', /\bFragile\b/.test(glossText(laser)), true);
check('Ion Weapon still cares about one', /\bFragile\b/.test(glossText(ion)), true);
// The half that makes it matter: nothing PRINTS Fragile as a chip worth
// speaking of, so without the reverse link the sheet is a dead end.
const printsFragile = cards.filter((c) =>
  [...(c.keywords ?? []), ...((c.actions ?? []).flatMap((a) => a.keywords ?? []))]
    .some((k) => keyword(k.key || k.inline || k.en || '')?.key === fragile.key));
check('and barely any card prints Fragile itself', printsFragile.length <= 1, true);

// The index is built from linksIn, which is linkKeywords' OWN hit finder. That
// is the guarantee worth pinning: "referenced by" lists a keyword exactly when
// a reader can see the link in its text and click it. A mirror could drift,
// and the drift would show as an index naming a keyword whose text has no link.
const refcards = readFileSync(new URL('../src/refcards.ts', import.meta.url), 'utf8');
const ref = readFileSync(new URL('../src/reference.ts', import.meta.url), 'utf8');
check('the hit finder is shared, not duplicated', /function linkHits\(src: string\)/.test(refcards), true);
check('linkKeywords paints those hits', /const hits = linkHits\(src\);/.test(refcards), true);
check('and linksIn reports the same ones', /export function linksIn\(text: string\)/.test(refcards), true);
check('the index reads keyword text through it', /linksIn\(k\.en\?\.value \?\? ''\)\.keywords/.test(ref), true);
check('and card text through it too', /linksIn\(text\)\.keywords/.test(ref), true);
// Built once for the whole glossary: it is a pass over every keyword and every
// card, and opening a second keyword must not pay for it again.
check('the index is cached rather than rebuilt per sheet', /if \(xref\) return xref;/.test(ref), true);
// A keyword naming itself is not a cross-reference, and several do.
check('self-references are dropped', /hit\.key !== k\.key/.test(ref), true);
// A card in the "Appears on" list is not news in the "named in the text of" one.
check('a printed chip is not also reported as a mention', /!printed\.has\(hit\.key\)/.test(ref), true);
// ONE card list, not two. A card that prints the chip and a card whose rules
// text merely says the word are both "cards this keyword is on" to a reader;
// two headings made them look like different kinds of answer. Printed ones
// lead, because that is the stronger claim, but nothing labels them apart.
check('the sheet renders two sections, not three', [
  /Related keywords/.test(ref), /Appears on \$\{users\.length\} card/.test(ref),
], [true, true]);
check('the printed and the merely-named cards are one list',
  /const users = \[\.\.\.prints, \.\.\.says\];/.test(ref), true);
check('and the printed ones lead it', ref.indexOf('const prints') < ref.indexOf('const says'), true);
check('no section carries an explanatory line any more', /class="ref-hint"/.test(ref), false);
// The two lists that REMAIN open different things, so they must not look alike.
const refcss = readFileSync(new URL('../src/reference.css', import.meta.url), 'utf8');
check('a related keyword reads apart from a card link', /\.ref-userlink\.kw \{/.test(refcss), true);

// ---------- what a search puts first ----------
//
// Every predicate tests one haystack of name PLUS body text, and every list
// used to come out in data order -- so typing "Proje" listed the six keywords
// that TALK about Projectiles above Projectile itself.
console.log('\nwhat a search puts first');

const rankSrc = ref.slice(ref.indexOf('function rank(name: string, q: string)'), ref.indexOf('function found<T>'));
if (!rankSrc) throw new Error('could not locate rank() in reference.ts');
const rankFn = new Function('norm', `${rankSrc.replace(/: string|: number/g, '')} return rank;`)((s) => s.toLowerCase());

check('an exact name is first', rankFn('Projectile', 'projectile'), 0);
check('a name the query starts is next', rankFn('Projectile', 'proje'), 1);
check('then a word inside the name', rankFn('Smoke Grenade', 'grenade'), 2);
check('then a match buried mid-word', rankFn('Anti-Gravity', 'gravity') <= 2, true);
check('and a body-only match comes last', rankFn('Volley X', 'proje'), 4);
// The ordering that fixes the reported case, in the order a reader sees it.
const order = ['Projectile', 'Volley X', 'Missile', 'Rocket'].map((n) => rankFn(n, 'proje'));
check('so Projectile outranks everything that mentions it', order, [1, 4, 4, 4]);

// AND THE RANK IS ACTUALLY APPLIED. found() is run here, not just rank(),
// because a ranker that nothing sorts by is precisely the bug: every pool was
// already matching Projectile, and every pool still listed it fourth. Pinning
// rank() alone passed happily with the sort removed.
const foundSrc = ref.slice(ref.indexOf('function found<T>'), ref.indexOf('// The name each pool'));
if (!foundSrc) throw new Error('could not locate found() in reference.ts');
const foundFn = new Function('norm', 'rank',
  `${foundSrc.replace(/function found<T>\([\s\S]*?\): T\[\] \{/, 'function found(list, q, match, nameOf, cmp) {')} return found;`,
)((s) => s.toLowerCase(), rankFn);

const pool = [{ n: 'Volley X' }, { n: 'Projectile' }, { n: 'Missile' }, { n: 'Smoke Grenade' }];
const names = (list) => list.map((x) => x.n);
const all = () => true;
const nOf = (x) => x.n;
check('found() lifts the name match to the top',
  names(foundFn(pool, 'proje', all, nOf)), ['Projectile', 'Volley X', 'Missile', 'Smoke Grenade']);
// Data order is the tiebreak inside a rank, so equally-relevant rows do not
// shuffle: Volley X, Missile and Smoke Grenade all rank 4 and stay as given.
check('and leaves everything below it in the order it came',
  names(foundFn(pool, 'proje', all, nOf)).slice(1), ['Volley X', 'Missile', 'Smoke Grenade']);
check('with no query it is the plain filtered list',
  names(foundFn(pool, '', all, nOf)), ['Volley X', 'Projectile', 'Missile', 'Smoke Grenade']);
// A tab's resting order still applies when nothing is typed...
const alpha = (a, b) => a.n.localeCompare(b.n);
check('a resting sort is honoured with no query',
  names(foundFn(pool, '', all, nOf, alpha)), ['Missile', 'Projectile', 'Smoke Grenade', 'Volley X']);
// ...and becomes the tiebreak once something is.
check('and becomes the tiebreak under a query',
  names(foundFn(pool, 'e', all, nOf, alpha))[0], 'Missile');
check('the filter still filters', names(foundFn(pool, 'proje', (x) => x.n !== 'Missile', nOf)).includes('Missile'), false);
// Bullet prefixes are stripped before ranking, or "•Omni-direction Firing"
// could never match a query starting "omni".
check('a printed bullet does not block a name match', rankFn('•Omni-direction Firing', 'omni'), 1);

// EVERY pool that is RENDERED goes through the ranker, or a tab quietly keeps
// data order. Counted rather than spot-checked: a new list added with a bare
// .filter is the failure this catches. The badge counts are exempt and say so
// by taking .length straight off the filter -- a badge shows a number, and a
// number has no order to get wrong.
check('no rendered pool is filtered without being ranked',
  (ref.match(/\.filter\(\((\w+)\) => match[A-Z]\w*\(\1, q\)\)(?!\.length)/g) ?? []).length, 0);
// 19 since the Rules tab's badge learned to count the DICE as well. Pinned to a
// number rather than "> 0" so the two assertions work as a pair: adding a pool
// without ranking its RENDER still trips the one above.
check('while the badge counts stay plain filters',
  (ref.match(/\.filter\(\((\w+)\) => match[A-Z]\w*\(\1, q\)\)\.length/g) ?? []).length, 19);
check('and they all go through found()', (ref.match(/= found\(/g) ?? []).length >= 20, true);

console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
