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
const refSrc = readFileSync(new URL('../src/reference.ts', import.meta.url), 'utf8');

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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
