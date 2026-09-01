// Checks the box-contents data that the inventory filter depends on.
//   Pilots record their set as a scalar `box`; parts and drones use the
//   `containedIn` array. The app folds the former into the latter, so both the
//   data and the fold have to hold up.
import { readFileSync, writeFileSync } from 'node:fs';

// Slice out the normaliser — data.ts's other imports need fetch and the DOM.
const srcUrl = new URL('../src/data.ts', import.meta.url);
const src = readFileSync(srcUrl, 'utf8');
const start = src.indexOf('function normaliseBoxes');
const end = src.indexOf('function buildFactionIndex');
if (start < 0 || end < 0) throw new Error('could not locate normaliseBoxes in data.ts');
const tmp = new URL('./_boxes.slice.ts', import.meta.url);
writeFileSync(tmp, 'type Card = any;\nexport ' + src.slice(start, end));
const { normaliseBoxes } = await import(tmp.href);

const cards = JSON.parse(readFileSync(new URL('../../data/cards.json', import.meta.url), 'utf8'));
const list = Array.isArray(cards) ? cards : cards.cards ?? [];
const boxes = JSON.parse(readFileSync(new URL('../../data/boxes.json', import.meta.url), 'utf8'));
const boxList = Array.isArray(boxes) ? boxes : boxes.boxes ?? [];
const boxKeys = new Set(boxList.map((b) => b.key));

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}, got ${g}`); }
};

console.log('Box contents and the inventory filter\n');

const pilots = list.filter((c) => c.category === 'pilot');
check('every pilot names a box', pilots.filter((p) => !p.box).map((p) => p.id), []);
check('every pilot box is a real box', pilots.filter((p) => !boxKeys.has(p.box)).map((p) => `${p.id}:${p.box}`), []);

// The fold is what makes pilots visible to ownedCount / passes / the contents panel.
const folded = JSON.parse(JSON.stringify(list));
normaliseBoxes(folded);
check('folding gives every pilot containedIn', folded.filter((c) => c.category === 'pilot' && !c.containedIn?.length).map((c) => c.id), []);
check('folded quantity is 1 per box', [...new Set(folded.filter((c) => c.category === 'pilot').map((c) => c.containedIn[0].quantityPerBox))], [1]);

// Folding must not disturb cards that already carried the array.
const partsBefore = list.filter((c) => c.containedIn?.length).length;
const partsAfter = folded.filter((c) => c.containedIn?.length && c.category !== 'pilot').length;
check('existing containedIn is left alone', partsAfter, partsBefore);

// Spot-check against the printed product listing for RDL Heavy Metal.
const heavy = folded
  .filter((c) => c.category === 'pilot' && c.containedIn.some((e) => e.box === 'RDL_HEAVY_METAL'))
  .map((c) => c.id)
  .sort();
check('RDL Heavy Metal ships 4 pilots', heavy, ['FPA-03', 'FPA-04', 'FPA-12', 'FPA-13']);

// Cards with no box data at all must not be treated as unowned, or the filter
// silently hides them forever.
// All 6 Tactics, all 26 Projectiles and 12 Parts have no box listed anywhere in
// the source data, so `passes` has to show them rather than read the gap as
// "not owned". Projectiles are launched by a Part and never picked directly.
const noData = folded.filter((c) => !(c.containedIn ?? []).length);
check('gaps are confined to tactics, projectiles and a few parts', [...new Set(noData.map((c) => c.category))].sort(), [
  'mech_part',
  'projectile',
  'tactics_or_upgrade',
]);
check('no pilot or drone is left without a box', noData.filter((c) => c.category === 'pilot' || c.category === 'drone').map((c) => c.id), []);
check('the parts gap has not grown', noData.filter((c) => c.category === 'mech_part').length, 12);

// quantityPerBox 0 means the card ships with its parent rather than as a counted
// copy — 14 Discard Cards that sit under their Part Card (4.17), plus alternate
// modes like White Dwarf's Cruise Mode. Dropping them loses real box contents,
// and treating the 0 as "unowned" hid them from the Add tab even when the box
// was owned, so both readers must special-case it.
const zeroEntries = [];
for (const c of folded) for (const e of c.containedIn ?? []) if (!e.quantityPerBox) zeroEntries.push(c.id);
check('the paired-card count is unchanged', zeroEntries.length, 21);
check('White Dwarf Cruise Mode is one of them', zeroEntries.includes('288'), true);

// The reference lists every containedIn entry regardless of quantity.
const inBox = (key) => folded.filter((c) => (c.containedIn ?? []).some((e) => e.box === key)).map((c) => c.id).sort();
check('White Dwarf lists all 10 cards', inBox('LAB_WHITE_DWARF').length, 10);

// The app counts a 0 as 1 copy, since you do get the card with the box.
const ownedCount = (card, owned) =>
  (card.containedIn ?? []).reduce((n, e) => n + (owned[e.box] ?? 0) * Math.max(1, e.quantityPerBox), 0);
const cruise = folded.find((c) => c.id === '288');
check('a paired card counts as owned', ownedCount(cruise, { LAB_WHITE_DWARF: 1 }), 1);
check('a paired card scales with copies of the box', ownedCount(cruise, { LAB_WHITE_DWARF: 2 }), 2);
check('an unowned box still yields nothing', ownedCount(cruise, {}), 0);

// The box-contents override is authoritative for whatever box it names, so a
// typo in a card id or box key would silently empty that box instead of erroring.
const patch = JSON.parse(readFileSync(new URL('../../data/box_contents_overrides.json', import.meta.url), 'utf8'));
const patched = patch.boxes ?? {};
// cards_extra.json holds cards the community bundle lacks, and the override may
// name one, so ids come from both files.
const extra = JSON.parse(readFileSync(new URL('../../data/cards_extra.json', import.meta.url), 'utf8'));
const cardIds = new Set([...list.map((c) => c.id), ...(extra.cards ?? []).map((c) => c.id)]);
check('cards_extra never redefines a real card',
  (extra.cards ?? []).map((c) => c.id).filter((id) => list.some((c) => c.id === id)), []);
const badKeys = Object.keys(patched).filter((k) => !boxKeys.has(k));
const badCards = Object.values(patched).flatMap((d) => Object.keys(d.cards ?? {})).filter((id) => !cardIds.has(id));
check('override box keys all exist', badKeys, []);
check('override card ids all exist', badCards, []);
// 0 is meaningful, not a mistake: it marks a card that ships as another card's
// second face rather than as a counted copy, which is how the Raid box's slot
// counts add up instead of double counting. Negative or fractional is still wrong.
check('override quantities are whole and not negative',
  Object.values(patched).flatMap((d) => Object.values(d.cards ?? {})).filter((n) => !Number.isInteger(n) || n < 0), []);

// Each Reaper ships alone, two to a box, so the override must leave exactly one
// card in each of the boxes it corrects.
for (const [key, def] of Object.entries(patched)) {
  if (!key.startsWith('LAB_PD_REAPER')) continue;
  check(`${key} holds a single card`, Object.keys(def.cards ?? {}).length, 1);
  check(`${key} ships 2 copies`, Object.values(def.cards ?? {}), [2]);
}

// ---------- the two inventory panels must agree ----------
//
// The contents panel and the Compare panel list the same box from the same
// boxContents(), but Compare printed only the NAME. A box holding four Mire
// Cores therefore read as holding one, and the two panels quietly disagreed
// about the same box. OTTO found it by comparing two boxes and counting.
{
  const inv = readFileSync(new URL('../src/inventory.ts', import.meta.url), 'utf8');
  check('both panels print the copy count, by the same rule',
    (inv.match(/i\.n > 1 \?/g) ?? []).length, 2);
  // A tally that counts rows but not copies says "30 cards" for a box holding
  // 60 pieces, which is the same misreading one line up.
  check('and both tallies count pieces, not just rows',
    (inv.match(/reduce\(\(s, i\) => s \+ i\.n, 0\)/g) ?? []).length, 2);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
