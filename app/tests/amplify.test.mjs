// FPA-06 KeyHole, 功率加大 Amplify: "Range of Aura, Electronic Attack and
// Electronic Support of the piloted mech +1 grid." Driven against the shipped
// cards through the real aura walker and the real actionRange; FAQ L4's Beacon
// (an independent unit once deployed) falls out of asking the aura's SOURCE.
import { readFileSync, writeFileSync } from 'node:fs';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}, got ${g}`); }
};

console.log('Amplify: auras and Electronic Warfare reach one Grid further\n');

const units = readFileSync(new URL('../src/units.ts', import.meta.url), 'utf8');
const cut = (a, b, what) => {
  const i = units.indexOf(a), j = units.indexOf(b);
  if (i < 0 || j <= i) throw new Error(`could not locate ${what}`);
  return units.slice(i, j);
};
const tmp = new URL('./_amplify.slice.ts', import.meta.url);
writeFileSync(tmp, `type Token = any; type GameData = any; type PartSlot = any; type CardAction = any; type Card = any;
function tokenCards(data: any, t: any): any[] {
  const out: any[] = [];
  for (const slot of ['torso', 'chasis', 'leftHand', 'rightHand', 'backpack', 'pilot']) {
    const id = t.mech?.[slot]; const c = id ? data.byId.get(id) : undefined;
    if (c) out.push({ slot, card: c });
  }
  if (t.kind !== 'mech') { const c = data.byId.get(t.cardId); if (c) out.push({ slot: 'main', card: c }); }
  return out;
}
function largeGridOf(t: any): any { return { c: Math.floor(t.col / 3), r: Math.floor(t.row / 3) }; }
function rangeBetween(a: any, b: any): any {
  const ga = largeGridOf(a), gb = largeGridOf(b);
  return { range: Math.abs(ga.c - gb.c) + Math.abs(ga.r - gb.r) };
}
// The Electronic Attack test stands in for the real reader, which lives far
// outside these cuts: here an Action is Electronic when the fixture says so.
function isElectronicAttack(a: any): boolean { return !!a.electronic; }
// The Firing-range auras are auras.test.mjs's; here they add nothing, which is
// what lets the Firing check below read the printed number.
function auraValueOn(_d: any, _t: any, _u: any, _k: string): number { return 0; }
`
  // AuraSource, amplifyBonus, auraReach, isElectronicSupport and aurasOn.
  + cut('export interface AuraSource', '// An aura is judged at the moment', 'the aura readers')
  // auraValueOn and actionRange.
  + cut('// A Firing Action', 'export function hasFlexibleTiming', 'actionRange'));
const A = await import(tmp.href);

const raw = JSON.parse(readFileSync(new URL('../../data/cards.json', import.meta.url), 'utf8'));
const cards = Array.isArray(raw) ? raw : raw.cards;
const data = { byId: new Map(cards.map((c) => [c.id, c])) };

// A Torso printing an ALLY aura with a real reach, found in the data rather
// than named, so a renumbered card cannot silently hollow this out.
const auraOf = (c) => (c.actions ?? []).find((a) => (a.gameRules ?? []).some((g) => (g.effects ?? []).some((e) => e.type === 'aura' && e.targetSide !== 'enemy' && (e.effectTypes ?? []).length)) && (a.range ?? 0) >= 2);
const torso = cards.find((c) => c.category === 'mech_part' && c.type === 'torso' && auraOf(c));
if (!torso) throw new Error('no torso with an ally aura of Range 2+ in the data');
const aura = auraOf(torso);
const R = aura.range;
console.log(`  (aura: ${torso.id} ${aura.name?.en ?? aura.id}, Range ${R})`);

const mech = (uid, col, pilot, extra = {}) => ({
  uid, side: 's1', kind: 'mech', label: `M${uid}`, col, row: 9, size: 3, facing: 0, stance: 'offensive',
  mech: { torso: torso.id, pilot }, partStates: { torso: 'intact' }, statuses: [], ...extra,
});
const ally = (col) => ({ uid: 2, side: 's1', kind: 'mech', label: 'Ally', col, row: 9, size: 3, facing: 0, stance: 'offensive', mech: { torso: '014' }, partStates: { torso: 'intact' }, statuses: [] });

const plain = mech(1, 0, undefined);
const keyhole = mech(1, 0, 'FPA-06');
const hidden = mech(1, 0, 'FPA-06-2');
check('FPA-06 amplifies by 1', A.amplifyBonus(data, keyhole), 1);
check('the OTHER KeyHole (Power Concealment) does not', A.amplifyBonus(data, hidden), 0);
check('nor a pilotless Mech', A.amplifyBonus(data, plain), 0);
check('nor a Shutdown KeyHole (4.1, FAQ L4)', A.amplifyBonus(data, mech(1, 0, 'FPA-06', { stance: 'shutdown' })), 0);
check('the aura reaches its printed Range plus one', A.auraReach(data, keyhole, aura), R + 1);
check('and its printed Range without the pilot', A.auraReach(data, plain, aura), R);

const at = (grids) => ally(grids * 3);
const reached = (src, a) => A.aurasOn(data, [src, a], a).some((s) => s.source.uid === src.uid);
check(`an ally ${R} Grids out is inside the plain aura`, reached(plain, at(R)), true);
check(`and one ${R + 1} out is not`, reached(plain, at(R + 1)), false);
check(`with KeyHole aboard, ${R + 1} is inside`, reached(keyhole, at(R + 1)), true);
check(`and ${R + 2} is not`, reached(keyhole, at(R + 2)), false);
check('a Shutdown KeyHole projects no aura at all', reached(mech(1, 0, 'FPA-06', { stance: 'shutdown' }), at(1)), false);

// FAQ L4: the B3 Beacon is its own unit once deployed, so a KeyHole's pilot is
// not aboard it. The aura's SOURCE is the Beacon and the Beacon has no pilot.
const beaconCard = cards.find((c) => c.category === 'drone' && auraOf(c));
if (beaconCard) {
  const b = auraOf(beaconCard);
  const beacon = { uid: 5, side: 's1', kind: 'drone', label: 'Beacon', col: 0, row: 9, size: 1, facing: 0, stance: 'offensive', cardId: beaconCard.id, partStates: { main: 'intact' }, statuses: [] };
  check(`a deployed aura Drone (${beaconCard.id}) gains nothing from the KeyHole that placed it (L4)`, A.auraReach(data, beacon, b), b.range);
  check('and the KeyHole standing beside it lends it no reach', A.aurasOn(data, [beacon, keyhole, at(b.range + 1)], at(b.range + 1)).some((s) => s.source.uid === 5), false);
} else {
  console.log('  (no aura Drone in the data to drive L4 against)');
}

// ---------- Electronic Attack and Electronic Support ----------
const ew = { id: 'EW', type: 'Tactic', range: 6, electronic: true, description: { en: 'Electronic Attack.' } };
const es = { id: 'ES', type: 'Tactic', range: 6, description: { en: 'This Action is Electronic Support (ES). Restore 1 Link.' } };
const shot = { id: 'F', type: 'Firing', range: 6 };
const scan = { id: 'COMMON_SCAN', type: 'Tactic', range: 6, description: { en: 'Scan.' } };
check('an Electronic Attack reaches one further with KeyHole', A.actionRange(data, [keyhole], keyhole, ew), 7);
check('and its printed Range without', A.actionRange(data, [plain], plain, ew), 6);
check('Electronic Support too', A.actionRange(data, [keyhole], keyhole, es), 7);
check('the ES reader keys on the printed phrase', [A.isElectronicSupport(es), A.isElectronicSupport(shot)], [true, false]);
// 009 Repair Drone Backpack, 018 Command Backpack and 504 print the line.
check('and the shipped cards that print it are read', ['009', '018', '504'].map((id) => cards.find((c) => c.id === id)?.actions.some((a) => A.isElectronicSupport(a))), [true, true, true]);
check('while a Firing weapon is not', cards.find((c) => c.id === '027')?.actions.some((a) => A.isElectronicSupport(a)), false);
check('a Firing Action is untouched by Amplify', A.actionRange(data, [keyhole], keyhole, shot), 6);
check('and so is a Scan, which is neither', A.actionRange(data, [keyhole], keyhole, scan), 6);

// ---------- wiring ----------
const cmds = readFileSync(new URL('../src/commands.ts', import.meta.url), 'utf8');
const hud = readFileSync(new URL('../src/matchhud.ts', import.meta.url), 'utf8');
const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
check('the aura walker measures the amplified reach', /rangeBetween\(src, t\)\.range > auraReach\(data, src, a\)/.test(units), true);
check('the Counter-roll command judges the effective reach', /const reach = actionRange\(data, state\.tokens, t, a\);/.test(cmds), true);
check('the Match Centre picker shows it', /const reach = actionRange\(ctx\.data, s\.tokens, by, a\);/.test(hud), true);
check('and freeplay draws its rings at it', /const ewReach = actionRange\(data, state\.tokens, t, action\);/.test(main), true);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
