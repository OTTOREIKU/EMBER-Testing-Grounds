// Checks the mechanics glossary and the gate that decides whether a card shows
// its blocks.
//   mechanicsFor is a plain substring test, so a careless `match` term fires on
//   unrelated cards forever and nobody notices. And the reference only renders
//   the card-level blocks when the card has something to attach them to, which
//   is the part that broke once already: englishOnly() empties the English text
//   on a Chinese-only card, and gating the block on that text threw away
//   mechanics that had matched the zh perfectly well.
import { readFileSync } from 'node:fs';

const mech = JSON.parse(readFileSync(new URL('../../data/mechanics.json', import.meta.url), 'utf8'));
const list = mech.mechanics ?? [];
const cards = JSON.parse(readFileSync(new URL('../../data/cards.json', import.meta.url), 'utf8'));
const cardList = Array.isArray(cards) ? cards : cards.cards ?? [];
// The reference page is TWO files: the card and keyword renderers live in
// refcards.ts so the pad can draw the same cards without a second copy. The
// gate asserted below sits in cardDetail, which is over there now.
const refSrc = [
  readFileSync(new URL('../src/reference.ts', import.meta.url), 'utf8'),
  readFileSync(new URL('../src/refcards.ts', import.meta.url), 'utf8'),
].join('\n');

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}, got ${g}`); }
};

console.log('Mechanics glossary and its render gate\n');

// ---------- the data holds together

// `match` is deliberately optional: an entry with none is a Rules-tab general
// like Victory Points, which no card names and none should.
check('every entry has id, name and text',
  list.filter((m) => !m.id || !m.name || !m.text || !Array.isArray(m.match)).map((m) => m.id ?? m.name),
  []);
check('ids are unique',
  Object.entries(list.reduce((a, m) => ((a[m.id] = (a[m.id] ?? 0) + 1), a), {})).filter(([, n]) => n > 1).map(([k]) => k),
  []);
check('names are unique',
  Object.entries(list.reduce((a, m) => ((a[m.name] = (a[m.name] ?? 0) + 1), a), {})).filter(([, n]) => n > 1).map(([k]) => k),
  []);
// A one-character term matches most of the set. Chinese carries a whole term in
// two characters (烟幕, 监视, 黑匣), so the floor differs by script.
const CJK_ANY = /[぀-ヿ一-鿿]/;
check('no match term is too short to be a term',
  list.flatMap((m) => m.match
    .filter((p) => p.trim().length < (CJK_ANY.test(p) ? 2 : 3))
    .map((p) => `${m.id}: ${JSON.stringify(p)}`)),
  []);
// One entry's term sitting inside another's is usually a copy-paste, but twice
// it is the point: a card reading "Extra Action Opportunity" wants the Ticks
// rules as well, and a Pholcus really is a mine. Anything else is a mistake.
check('the only nested match terms are the two intended ones',
  list.flatMap((m) => m.match.flatMap((p) => list
    .filter((o) => o.id !== m.id)
    .flatMap((o) => o.match.filter((q) => q !== p && q.toLowerCase().includes(p.toLowerCase()))
      .map((q) => `${m.id}:${p} inside ${o.id}:${q}`)))).sort(),
  ['mines:地雷 inside pholcus:自行地雷', 'ticks:action opportunity inside extra_action_opportunity:extra action opportunity']);

// ---------- mechanicsFor, replicated exactly (data.ts: hay.includes(p))

const g = (d, k) => (d && typeof d === 'object' && d[k]) || '';
const mechanicsFor = (...text) => {
  const hay = text.filter(Boolean).join(' ').toLowerCase();
  if (!hay) return [];
  return list.filter((m) => m.match.some((p) => hay.includes(p.toLowerCase())));
};

// An entry that matches nothing is either a Rules-tab general or a typo in a
// match term, and the two look identical from here. So the generals are pinned
// by name: a new arrival in this list is a term that stopped working.
const reach = new Map(list.map((m) => [m.id, 0]));
for (const c of cardList) {
  const seen = new Set();
  const bump = (ms) => ms.forEach((m) => seen.add(m.id));
  bump(mechanicsFor(g(c.description, 'en'), g(c.description, 'zh')));
  for (const a of c.actions ?? []) {
    bump(mechanicsFor(g(a.name, 'en'), g(a.name, 'zh'), g(a.description, 'en'), g(a.description, 'zh')));
  }
  bump(mechanicsFor(String(c.trait ?? ''), g(c.traitDescription, 'en'), g(c.traitDescription, 'zh')));
  for (const id of seen) reach.set(id, reach.get(id) + 1);
}

// Missions carry their own text, so an entry may legitimately be reachable only
// from there — those are listed rather than treated as unreachable.
const missions = JSON.parse(readFileSync(new URL('../../data/missions.json', import.meta.url), 'utf8'));
for (const m of missions.cards ?? []) {
  for (const x of mechanicsFor(String(m.setup ?? ''), String(m.scoring ?? ''))) reach.set(x.id, reach.get(x.id) + 1);
}

check('only the Rules-tab generals reach no card or mission',
  [...reach].filter(([, n]) => n === 0).map(([id]) => id).sort(),
  ['activation_order', 'deployment', 'end_phase', 'integrity_loss', 'main_task_cards',
   'reboot', 'remote_access', 'secondary_task_cards', 'squad_building', 'tactics_cards',
   'victory_points']);

// The four written for the reference audit, pinned to what they should hit so a
// later widening of a match term shows up here instead of on the page.
const hitCount = (id) => reach.get(id);
check('overwatch reaches only the Cobra and its Snake Eye', hitCount('overwatch'), 2);
check('black_box reaches the carrying pack and its three missions', hitCount('black_box'), 4);
check('extra_action_opportunity reaches only the Echoes backpack', hitCount('extra_action_opportunity'), 1);
check('smoke_screen reaches the ten smoke cards', hitCount('smoke_screen'), 10);
// The same pin for Armor Piercing. Nine, not eleven: 穿甲 also appears inside
// the NAME of the shell ZHLA-201 launches, and the zh match term is 穿甲1 with
// the digit precisely so the mortar and the shell itself stay out. A count of
// 10 or 11 here means someone widened it to 穿甲 and handed two cards a rule
// they do not have. tests/armorpiercing.test.mjs pins the same two out.
check('armor_piercing reaches the eight weapons and the pilot, and not the mortar',
  hitCount('armor_piercing'), 9);

// K21 overturned the old reading. The entry used to end by saying the extra
// Opportunity was taken after every Mech had acted; the engine takes it inline.
const echo = list.find((m) => m.id === 'extra_action_opportunity');
check('the Echoes entry states the inline timing', /immediately/i.test(echo.text), true);
check('the Echoes entry no longer says it waits for the others',
  /after every Mech has acted/i.test(echo.text), false);

// ---------- the render gate

// A Chinese-only description leaves cardText empty, so a gate of `cardText &&`
// silently drops blocks that matched the zh. Eleven cards lose thirteen blocks
// that way, TM39D's Overwatch among them.
const gate = refSrc.match(/const cardBlock = ([^\n]*)/)?.[1] ?? '';
check('the card block is gated on the text OR the mechanics',
  /\(\s*cardText\s*\|\|\s*cardMechs\s*\)/.test(gate), true);

const CJK = /[぀-ヿ一-鿿]/;
const englishOnly = (s) => {
  const t = (s ?? '').trim();
  return t && !CJK.test(t) ? t : '';
};
const stranded = cardList.filter((c) => c.category !== 'pilot'
  && !englishOnly(g(c.description, 'en'))
  && mechanicsFor(g(c.description, 'en'), g(c.description, 'zh')).length);
check('cards whose only card-level rules are Chinese still carry blocks',
  stranded.length > 0 && /\(\s*cardText\s*\|\|\s*cardMechs\s*\)/.test(gate), true);
check('TM39D is one of them', stranded.some((c) => c.id === 'TM39D'), true);

// ---------- the basic view (OTTO, 2026-09-25)
//
// The audited text grew into a page of rulings a new player cannot use. An
// entry now leads with a short basic view (`basic` plus a few `points`) and
// keeps the full breakdown, with its FAQ rows and sources, behind Advanced. The
// basic view stays plain: short, a handful of points, and no rule numbers, FAQ
// rows or card ids, which are what made the old text read like a ruling.
const basics = list.filter((m) => m.basic);
check('every entry has a basic view', list.filter((m) => !m.basic).map((m) => m.id), []);
check('a basic view has 2 to 5 points',
  basics.filter((m) => !Array.isArray(m.points) || m.points.length < 2 || m.points.length > 5).map((m) => m.id),
  []);
check('a basic view is short',
  basics.flatMap((m) => [
    ...(m.basic.length > 200 ? [`${m.id}: basic ${m.basic.length}`] : []),
    ...m.points.filter((p) => p.length > 140).map((p) => `${m.id}: "${p.slice(0, 40)}..." ${p.length}`),
  ]),
  []);
const CITES = /\bFAQ\b|\b\d+\.\d+(?:\.\d+)?\b|\b[A-Q]\d{1,2}\b|\b[A-Z]{2,5}-\d{2,3}\b|\b\d{3}_[A-Z]\b|\bcard \d{3}\b|\bRulebook\b/;
check('a basic view cites no rule numbers, FAQ rows or card ids',
  basics.flatMap((m) => [m.basic, ...m.points].filter((s) => CITES.test(s)).map((s) => `${m.id}: "${s.match(CITES)[0]}"`)),
  []);
// The full text is broken up too (OTTO: "one giant text block makes it hard to
// read"): paragraphs split on a blank line, and "- " lines are a list. A long
// entry has at least two blocks, and no plain paragraph runs past 520
// characters, which is about seven lines of the card.
const blocksOf = (t) => t.split(/\n\s*\n/);
check('a long full text is broken into paragraphs',
  list.filter((m) => m.text.length > 400 && blocksOf(m.text).length < 2).map((m) => m.id),
  []);
check('no paragraph of the full text is a wall',
  list.flatMap((m) => blocksOf(m.text).filter((b) => !/(^|\n)- /.test(b) && b.length > 520).map((b) => `${m.id}: ${b.length}`)),
  []);

// The full text and the sources draw behind Advanced, through the one body
// renderer that the Rules tab and a card's mechanic panel share.
check('the full text and sources render behind Advanced',
  /<details class="mech-adv"[\s\S]*?<summary>Advanced<\/summary>[\s\S]*?ruleBlocks\(m\.text\)[\s\S]*?esc\(m\.ref\)/.test(refSrc), true);
check('the Rules tab and the card panels share that renderer',
  [/<div class="card-body">\$\{mechanicBody\(m, q\)\}<\/div>/.test(refSrc), /<div class="ref-mech-b">\$\{mechanicBody\(m\)\}<\/div>/.test(refSrc)],
  [true, true]);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
