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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
