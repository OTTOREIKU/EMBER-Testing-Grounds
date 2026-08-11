// Who breaks Optical Camouflage by standing in Contact (4.12.2, FAQ I4/I7/I10/
// I14/I23).
//
// THE PREMISE THIS FILE EXISTS TO CORRECT: task #64 was written as "forced
// arrivals must NOT Reveal a camouflaged unit", reading FAQ E12 ("Is Forced
// Movement considered Silence? Yes") as an exemption. It is not one. E12 says
// the MOVEMENT does not Reveal — that is 4.12.2's second trigger, the
// non-Silence action. The THIRD trigger is Contact, and I4 spells out that
// "any Movement" there expressly includes "Forced Movement of A or B (such as
// being affected by Crush, Drag, or Knockback)". I23 then answers it for a
// Taurus swap in as many words: forced movement itself does not Reveal, "However,
// after the reposition is complete, if the camouflaged unit is in base contact
// with an enemy unit that is neither Airborne nor under Optical Camouflage, it is
// considered to have made contact as a result of movement and is immediately
// Revealed."
//
// So a shoved camouflaged unit that lands in Contact DOES Reveal, the
// board-derived sweep is the correct shape, and the pins below say so.
import { readFileSync, writeFileSync } from 'node:fs';

const unitsSrc = readFileSync(new URL('../src/units.ts', import.meta.url), 'utf8');
const dataSrc = readFileSync(new URL('../src/data.ts', import.meta.url), 'utf8');
const rulesSrc = readFileSync(new URL('../src/rules.ts', import.meta.url), 'utf8');
const slice = (src, from, to, what) => {
  const a = src.indexOf(from);
  const b = src.indexOf(to, a);
  if (a < 0 || b < 0 || b <= a) throw new Error('could not locate ' + what);
  return src.slice(a, b);
};
const tmp = new URL('./_camo.slice.ts', import.meta.url);
writeFileSync(
  tmp,
  'type Card = any;\ntype GameData = any;\ntype Token = any;\ntype PartSlot = any;\n'
    // The real statusCount, so "camouflage" is counted the way the app counts
    // it. End marker is ageTokens, NOT addStatus: addStatus sits ABOVE
    // statusCount in types.ts, and an end marker before the start yields an
    // empty slice that fails as "statusCount is not defined".
    + slice(readFileSync(new URL('../src/types.ts', import.meta.url), 'utf8'),
      'export function statusCount', 'export function ageTokens', 'statusCount')
    + slice(rulesSrc, 'export function inContact', 'export function largeGridOf', 'inContact')
    + slice(dataSrc, 'export const BARRICADE_CARDS', 'export const UNFOLDS_INTO', 'isBarricade')
    + slice(unitsSrc, '// ---------- Who breaks Optical Camouflage', 'export function canActivateCamo', 'the camo block'),
);
const { isDeployable, breaksCamoByContact, camoBrokenBy } = await import(tmp.href);

const raw = JSON.parse(readFileSync(new URL('../../data/cards.json', import.meta.url), 'utf8'));
const cards = Array.isArray(raw) ? raw : raw.cards ?? [];
const byId = new Map(cards.map((c) => [String(c.id), c]));
const data = { byId };

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}, got ${g}`); }
};

console.log('Optical Camouflage broken by Contact — FAQ I4/I7/I10/I23\n');

// A camouflaged Mech, and the things that might stand next to it. Grids are
// 3 small cells, so col 12 and col 15 are adjacent Large Grids: bases touch.
const hidden = (over = {}) => ({
  uid: 1, side: 's1', kind: 'mech', label: 'Ghost', cardId: '547', mech: { torso: '547' },
  partStates: { torso: 'intact' }, statuses: ['camouflage'], col: 12, row: 12, size: 3,
  aerial: false, deployed: true, ...over,
});
const near = (over = {}) => ({
  uid: 2, side: 's2', kind: 'mech', label: 'Hunter', cardId: '547', mech: { torso: '547' },
  partStates: { torso: 'intact' }, statuses: [], col: 15, row: 12, size: 3,
  aerial: false, deployed: true, ...over,
});
const far = (o) => ({ ...o, col: 30 });

// ---------- the plain trigger (I7) ----------

check('an enemy Mech in Contact breaks it (I7)',
  camoBrokenBy(data, [hidden(), near()], hidden())?.uid, 2);
check('the same Mech out of Contact does not',
  camoBrokenBy(data, [hidden(), far(near())], hidden()), undefined);
check('an ALLY in Contact does not — the trigger names an enemy',
  camoBrokenBy(data, [hidden(), near({ side: 's1' })], hidden()), undefined);
// I23's own wording for who qualifies: "neither Airborne nor under Optical
// Camouflage".
check('an Airborne enemy does not (I23)',
  camoBrokenBy(data, [hidden(), near({ aerial: true })], hidden()), undefined);
check('nor one that is itself camouflaged (I23)',
  camoBrokenBy(data, [hidden(), near({ statuses: ['camouflage'] })], hidden()), undefined);
check('nor one still waiting to deploy',
  camoBrokenBy(data, [hidden(), near({ deployed: false })], hidden()), undefined);
// The camouflaged unit has to actually be camouflaged.
check('an uncamouflaged unit is owed nothing',
  camoBrokenBy(data, [hidden({ statuses: [] }), near()], hidden({ statuses: [] })), undefined);

// ---------- I10: the landed Deployable, which the Aerial model hides ----------
//
// This app marks every Deployable Aerial so units can share its Grid (E10), so
// the plain Airborne test threw away exactly the units I10 names. 074 is the
// GM-35 Anti-Armor Mine, 072 the MES Beacon, 071 the MC-3 "Razor" Missile.
const proj = (cardId, over = {}) => near({
  uid: 3, kind: 'projectile', cardId, mech: undefined, label: cardId,
  partStates: { main: 'intact' }, size: 1, aerial: true, ...over,
});
check('a landed enemy Mine breaks camouflage (I10)',
  camoBrokenBy(data, [hidden(), proj('074')], hidden())?.uid, 3);
check('and a landed enemy Beacon does too (I10)',
  camoBrokenBy(data, [hidden(), proj('072')], hidden())?.uid, 3);
// I10 excludes Missiles BY NAME, which is why the Deployable keyword is the
// test rather than "is it a projectile token".
check('but a Missile in flight does NOT (I10)',
  camoBrokenBy(data, [hidden(), proj('071')], hidden()), undefined);
check('nor a Smoke Grenade', camoBrokenBy(data, [hidden(), proj('268')], hidden()), undefined);
// A Barricade is a Deployable too, and carries its own flag on the token.
check('a Barricade breaks it', camoBrokenBy(data, [hidden(), proj('158', { barricade: true })], hidden())?.uid, 3);

// The keyword partition itself, pinned so a data refresh that drops it is loud.
const deployables = cards.filter((c) => isDeployable(c)).map((c) => String(c.id)).sort();
check('exactly the walls, beacons, mine and barricade are Deployable',
  deployables, ['072', '074', '075', '076', '077', '158', 'PDAM-003', 'PDAM-004', 'PDAM-006']);

// ---------- the premise correction ----------
//
// Nothing about breaksCamoByContact asks HOW the enemy or the hidden unit got
// where it is, and that is deliberate: I4 counts Forced Movement, and a
// board-derived answer covers a shove, a Crush, a Knockback and a Taurus swap
// with one rule. A test that "fixed" this by exempting forced arrivals would
// have to break one of these.
check('a shoved arrival is judged exactly like a walked one (I4/I23)',
  camoBrokenBy(data, [hidden(), near()], hidden())?.uid,
  camoBrokenBy(data, [hidden({ col: 12 }), near()], hidden({ col: 12 }))?.uid);
check('the derivation takes no movement argument at all',
  breaksCamoByContact.length, 2);

console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
