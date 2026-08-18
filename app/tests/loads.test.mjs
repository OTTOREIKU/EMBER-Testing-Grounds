// Tarantula Loads (FAQ O3–O8, O16–O18).
//   An ally Mech in Contact with an ADK30C Carrier treats the Backpack on its
//   back as its own Part while it acts: the Load's Actions, its Electronic
//   Value and its Freehand all count, stacking with the Mech's own Backpack and
//   across several Tarantulas. The Carrier never uses what it carries, and a
//   passive Electronic Counter Roll gains nothing.
import { readFileSync, writeFileSync } from 'node:fs';

const unitsSrc = readFileSync(new URL('../src/units.ts', import.meta.url), 'utf8');

const slice = (from, to, what) => {
  const a = unitsSrc.indexOf(from);
  const b = to === null ? unitsSrc.length : unitsSrc.indexOf(to);
  if (a < 0 || b < 0 || b < a) throw new Error(`could not locate ${what}`);
  return unitsSrc.slice(a, b);
};

const loads = slice('// ---------- Tarantula Loads', 'export interface GuidedAction', 'the Loads block');
const relay = slice('// ---------- Repeaters (FAQ O19/O20)', '// How a Projectile Action delivers', 'the Repeaters block');
const radar = slice("// ---------- The Hyena's AA Radar", '// ---------- Repeaters (FAQ O19/O20)', 'the AA Radar block');
const auto = slice('// Auto-attack target selection', "// ---------- The Hyena's AA Radar", 'autoTargetsFor');
// actionRange is sliced in rather than mirrored, so the reach arithmetic under
// test is the real one. Only the AURA lookup is stubbed away — these fixtures
// carry no aura sources, and the aura path has its own coverage.
const rangeFn = slice("// A Firing Action", "export function hasFlexibleTiming", "actionRange");
const auraStub = `export function auraValueOn(_d: any, _t: any, _u: any, _k: string): number { return 0; }
`;
const ev = slice('export function electronicValue', 'export function defaultUnitLabel', 'electronicValue');
const freehand = slice('export function freehandSlots', '// ---------- Charge (rulebook 4.14)', 'freehandSlots');
const slotLabels = slice('export const SLOT_LABEL', 'let uidSource', 'SLOT_LABEL');

const tmp = new URL('./_loads.slice.ts', import.meta.url);
writeFileSync(
  tmp,
  'type Card = any;\ntype CardAction = any;\ntype GameData = any;\ntype Token = any;\ntype PartSlot = any;\ntype Side = any;\n'
    // Mirrored rather than sliced: the real ones drag in the whole app.
    + `function cardName(c: any): string { return c?.name?.en ?? c?.id ?? ''; }
function tokenCards(data: any, t: any): any[] {
  if (t.kind === 'mech') {
    return Object.entries(t.mech ?? {}).map(([slot, id]) => ({ slot, card: data.byId.get(id) })).filter((x: any) => x.card);
  }
  return [{ slot: 'main', card: data.byId.get(t.cardId) }].filter((x: any) => x.card);
}
function largeGridOf(t: any): any { return { c: Math.floor(t.col / 3), r: Math.floor(t.row / 3) }; }
function rangeBetween(a: any, b: any): any {
  const ga = largeGridOf(a), gb = largeGridOf(b);
  const dc = Math.abs(ga.c - gb.c), dr = Math.abs(ga.r - gb.r);
  return { range: dc + dr, adjacent: dc <= 1 && dr <= 1, sameGrid: dc === 0 && dr === 0 };
}
function statusCount(list: any, id: string): number { return (list ?? []).filter((x: any) => x === id).length; }
function isElectronicAttack(a: any): boolean {
  const hay = [a.description?.en ?? '', ...(a.keywords ?? []).map((k: any) => k.inline ?? k.key ?? '')].join(' ');
  return /Electronic ?attack/i.test(hay);
}
function inContact(a: any, b: any): boolean {
  const gapX = Math.max(a.col - (b.col + b.size), b.col - (a.col + a.size));
  const gapY = Math.max(a.row - (b.row + b.size), b.row - (a.row + a.size));
  if (gapX < 0 && gapY < 0) return true;
  return (gapX === 0 && gapY < 0) || (gapY === 0 && gapX < 0);
}
`
    + `function losBetween(a: any, b: any, terrain: any[], tokens: any[]): string { return terrain.length ? String(terrain[0].sight ?? "clear") : "clear"; }\n`
    + auraStub + rangeFn + slotLabels + loads + relay + radar + auto + ev + freehand,
);
const L = await import(tmp.href);

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}, got ${g}`); }
};

console.log('Tarantula Loads — FAQ O3-O8, O16-O18\n');

const raw = JSON.parse(readFileSync(new URL('../../data/cards.json', import.meta.url), 'utf8'));
const cards = Array.isArray(raw) ? raw : raw.cards ?? [];
const byId = new Map(cards.map((c) => [String(c.id), c]));
const data = { byId };

// ---------- the cards ----------

// One Carrier in the box, and it is the one the rulings are about.
check('the ADK30C Carrier is the one Load carrier', cards.filter((c) => L.isCarrier(c)).map((c) => String(c.id)), ['162']);
check('its sister Tarantulas carry nothing', [L.isCarrier(byId.get('163')), L.isCarrier(byId.get('164'))], [false, false]);

// O18 names the EBS/X40, but the printed text rules out five Backpacks in all -
// both Charger printings, the two Jetpacks and the Overloading Pack. Those
// three print the Load keyword themselves, to say they can never BE one.
check('every Backpack that says it cannot be a Load is refused (O18)',
  cards.filter((c) => c.type === 'backpack' && !L.canBeLoad(c)).map((c) => String(c.id)).sort(),
  ['081', '088', '090', '265', '538']);
check('an ordinary Backpack can be', L.canBeLoad(byId.get('083')), true);
// A Load is a Backpack and nothing else. The exclusion list above is the
// evidence: it lives entirely inside one slot, which only makes sense if that
// slot is the whole pool. Without this the Load pickers offered every Part and
// a Tarantula could be sent out carrying an arm.
check('an arm cannot be a Load', L.canBeLoad(byId.get('109')), false);
check('a torso cannot be a Load', L.canBeLoad(byId.get('014')), false);
check('a chassis cannot be a Load', L.canBeLoad(byId.get('020')), false);
check('nothing outside the Backpack slot survives the filter',
  cards.filter((c) => L.canBeLoad(c)).every((c) => c.type === 'backpack'), true);
check('a pilot is not a Load either', L.canBeLoad(byId.get('FPA-04-2')), false);

// ---------- who is lending what ----------

const mech = (uid, col, row, over = {}) => ({
  uid, side: 's1', kind: 'mech', col, row, size: 3, facing: 0, label: `M${uid}`,
  mech: { torso: '500' }, partStates: { torso: 'intact' }, ammo: {}, ...over,
});
// A Carrier with a Backpack on its back, standing where you put it.
const tara = (uid, col, row, load = '089', over = {}) => ({
  uid, side: 's1', kind: 'drone', cardId: '162', droneBackpack: load, col, row, size: 2,
  facing: 0, label: `T${uid}`, partStates: { main: 'intact', backpack: 'intact' }, ammo: {}, ...over,
});

// The Mech sits at cells 3..5; a Carrier at col 6 is edge-to-edge with it.
const me = mech(1, 3, 3);
check('a Carrier in Contact lends its Load',
  L.loanedParts(data, [me, tara(2, 6, 3)], me).map((x) => [x.slot, x.card.id]), [['load:2', '089']]);
check('one grid further away lends nothing', L.loanedParts(data, [me, tara(2, 9, 3)], me), []);
check('an enemy Carrier lends nothing', L.loanedParts(data, [me, tara(2, 6, 3, '089', { side: 's2' })], me), []);
check('a Carrier with an empty back lends nothing (O8)',
  L.loanedParts(data, [me, tara(2, 6, 3, '')], me), []);
check('a destroyed Carrier lends nothing',
  L.loanedParts(data, [me, tara(2, 6, 3, '089', { partStates: { main: 'destroyed', backpack: 'intact' } })], me), []);
check('and neither does a destroyed Load',
  L.loanedParts(data, [me, tara(2, 6, 3, '089', { partStates: { main: 'intact', backpack: 'destroyed' } })], me), []);
check('the Charger is refused even in Contact (O18)',
  L.loanedParts(data, [me, tara(2, 6, 3, '081')], me), []);
// O4: the Drone itself never uses what it is carrying.
check('a Drone is lent nothing by anyone', L.loanedParts(data, [me, tara(2, 6, 3)], tara(2, 6, 3)), []);

// O6/O17: two Tarantulas both lend, and they are distinct Parts (O7).
const two = L.loanedParts(data, [me, tara(2, 6, 3), tara(3, 1, 3)], me);
check('two Carriers lend two Parts (O6/O17)', two.map((x) => x.slot), ['load:2', 'load:3']);

// ---------- what the Mech gains ----------

// The HD-2 Data Backpack torso carries Electronic Value 1 on its own; the
// EC50 Pod lends another. O5: only while performing.
const evMech = mech(1, 3, 3, { mech: { torso: '500' } });
check('a Mech counts its own Electronic Value alone by default', L.electronicValue(data, evMech), 1);
check('and gains the Load while it acts (O5)',
  L.electronicValue(data, evMech, L.loanedParts(data, [evMech, tara(2, 6, 3)], evMech)), 2);
check('two Pods stack (O6)',
  L.electronicValue(data, evMech, L.loanedParts(data, [evMech, tara(2, 6, 3), tara(3, 1, 3)], evMech)), 3);

// O16: Freehand comes across too. The MSH2 Stabilizer Arm is the only Backpack
// that prints it.
const fhLoans = L.loanedParts(data, [me, tara(2, 6, 3, '087')], me);
check('a Load lends its Freehand (O16)', L.freehandSlots(data, me, [], fhLoans).length, 1);
check('and says whose back it is on', L.freehandSlots(data, me, [], fhLoans)[0].label.includes('T2'), true);
check('a Load without Freehand lends none',
  L.freehandSlots(data, me, [], L.loanedParts(data, [me, tara(2, 6, 3, '089')], me)).length, 0);

// ---------- Repeaters (FAQ O19/O20) ----------

// The EC Raven is the Repeater; its Scout and Interference sisters are not.
check('the EC Raven is the Repeater', cards.filter((c) => L.isRepeater(c)).map((c) => String(c.id)), ['165']);

const raven = (uid, col, row) => ({
  uid, side: 's1', kind: 'drone', cardId: '165', col, row, size: 2, facing: 0, label: `R${uid}`,
  partStates: { main: 'intact' }, ammo: {},
});
const foe = (uid, col, row) => ({
  uid, side: 's2', kind: 'mech', cardId: '500', col, row, size: 3, facing: 0, label: `E${uid}`,
  mech: { torso: '500' }, partStates: { torso: 'intact' }, statuses: [], ammo: {},
});

// The Raven's own passive Range is 6, so it covers an ally 6 Grids off.
const alli = mech(1, 3, 3);
check('a Raven within its Range covers the ally', L.repeatersFor(data, [alli, raven(2, 18, 3)], alli).map((r) => r.uid), [2]);
check('and one beyond it does not', L.repeatersFor(data, [alli, raven(2, 30, 3)], alli), []);
check('an enemy Raven relays nothing', L.repeatersFor(data, [alli, { ...raven(2, 18, 3), side: 's2' }], alli), []);
check('a destroyed Raven relays nothing',
  L.repeatersFor(data, [alli, { ...raven(2, 18, 3), partStates: { main: 'destroyed' } }], alli), []);
check('the origins list always starts with the unit itself',
  L.electronicOrigins(data, [alli, raven(2, 18, 3)], alli).map((o) => o.uid), [1, 2]);

// FAQ O20's worked case: the enemy one Grid from the Repeater is nearer than
// the one two Grids from the attacker, and it is the one that must be taken.
const ewAction = { id: 'EWX', type: 'Tactic', speed: 'auto', range: 4, keywords: [{ inline: 'Electronic attack' }], description: { en: 'Electronic Attack' } };
const relayWorld = [alli, raven(2, 15, 3), foe(3, 18, 3), foe(4, 9, 3)];
check('the nearest target is measured from the Repeater (O20)',
  L.autoTargetsFor(data, relayWorld, alli, ewAction).map((o) => o.uid), [3]);
// Without the Repeater the same board picks the other one.
check('and without it the attacker measures for itself',
  L.autoTargetsFor(data, [alli, foe(3, 18, 3), foe(4, 9, 3)], alli, ewAction).map((o) => o.uid), [4]);

// ---------- the Hyena's AA Radar (FAQ O12/O13) ----------

const hyena = (uid, col, row) => ({
  uid, side: 's1', kind: 'drone', cardId: '080', col, row, size: 2, facing: 0, label: `H${uid}`,
  partStates: { main: 'intact' }, ammo: {},
});
const missile = { uid: 9, side: 's2', kind: 'projectile', cardId: '074', col: 20, row: 3, size: 1, facing: 0, label: 'M', partStates: { main: 'intact' }, ammo: {} };
check('an allied Hyena Radar covers the shot',
  L.aaRadarCovers(data, [alli, hyena(2, 9, 3), missile], [], alli, missile)?.uid, 2);
check('an enemy one does not',
  L.aaRadarCovers(data, [alli, { ...hyena(2, 9, 3), side: 's2' }, missile], [], alli, missile), undefined);
check('nor does a destroyed one',
  L.aaRadarCovers(data, [alli, { ...hyena(2, 9, 3), partStates: { main: 'destroyed' } }, missile], [], alli, missile), undefined);
check('nor a Hyena that cannot see the target',
  L.aaRadarCovers(data, [alli, hyena(2, 9, 3), missile], [{ sight: 'blocked' }], alli, missile), undefined);
// The other two Hyenas carry guns, not the radar.
check('only the Radar Type carries it',
  L.aaRadarCovers(data, [alli, { ...hyena(2, 9, 3), cardId: '078' }, missile], [], alli, missile), undefined);

// FAQ F5, confirmed off the PDF layout rather than the interleaved text dump:
// "If the Hyena Radar is inside Smoke, or if Smoke blocks the line of sight
// between it and the intercepted target, does AA Radar still work?" — "Yes, it
// still works." That is easy to get WRONG later, because the card's own wording
// is "visible to this unit" and adding a smoke test would read like a fix. It
// works today only because aaRadarCovers takes terrain and tokens and NEVER a
// smoke list, so this pin guards the signature: the day someone threads smoke
// through it, F5 breaks and this says so.
const radarFn = slice('export function aaRadarCovers', '// ---------- Repeaters (FAQ O19/O20)', 'aaRadarCovers in units.ts');
check('F5: nothing in aaRadarCovers mentions smoke at all',
  /smoke/i.test(radarFn), false);
check('and its sight test is the terrain-and-tokens one, which has no smoke to consult',
  radarFn.includes('losBetween(r, target, terrain, tokens)'), true);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
