// Tether X and runtime Part faces: PDLH-202 / PDLH-202-T Ols1B "Harpoon", and
// the same machinery lighting up 287/288 White Dwarf Cruise/Assault.
//
// The pair is one mechanic. 202-T's only Action is "when Tether Mode is
// removed, replace this card" — the tail of something whose head is the Hit on
// 202_A — so the head, the leash, the three removal conditions and the flip
// back are all pinned here together. Driven against the real cards.json,
// because every reader in this block is a reader of printed text.
import { readFileSync, writeFileSync } from 'node:fs';

const src = (f) => readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8');
const rules = src('rules.ts'), unitsSrc = src('units.ts'), dataSrc = src('data.ts');
const meleeSrc = src('melee.ts'), commandsSrc = src('commands.ts'), combatSrc = src('combat.ts');
const mainSrc = src('main.ts'), hudSrc = src('matchhud.ts'), secrecySrc = src('secrecy.ts');

const cut = (s, a, b, what) => {
  const i = s.indexOf(a);
  const j = b === null ? s.length : s.indexOf(b, i);
  if (i < 0 || j < 0 || j <= i) throw new Error(`could not locate ${what}`);
  return s.slice(i, j);
};

// Every cut here was checked against the ranges the rest of the suite already
// takes out of these files. The movement search is the same LG..losBetween cut
// breakaway/movepath/knockback/standing/tracepath use; rangeBetween sits after
// losBetween and so is taken separately, exactly as commands.test.mjs does.
const tmp = new URL('./_tether.slice.ts', import.meta.url);
writeFileSync(tmp, `type TerrainPiece = any;
type Token = any;
type Side = any;
type SmokeScreen = any;
type GameData = any;
type GameState = any;
type Card = any;
type CardAction = any;
type PartSlot = any;
type MechLoadout = any;
type TetherLink = any;
// The Tether block reads these two out of the rest of units.ts. tokenCards is
// mirrored minimally, as every harness in this suite mirrors it; syncMagazines
// records its calls, because what matters here is THAT a transformed Part is
// re-seeded — the seeding rule itself belongs to ammo.test.mjs.
export function tokenCards(data: any, t: any): any[] {
  if (t.kind === 'mech') {
    return Object.entries(t.mech ?? {}).map(([slot, id]) => ({ slot, card: data.byId.get(id) })).filter((x: any) => x.card);
  }
  return [{ slot: 'main', card: data.byId.get(t.cardId) }].filter((x: any) => x.card);
}
export const synced: any[] = [];
export function syncMagazines(_data: any, t: any): void { synced.push(t.uid); }
`
  + cut(rules, 'export const LG', 'export function losBetween', 'the movement search')
  + cut(rules, 'export function rangeBetween', 'export function inArc', 'rangeBetween')
  + cut(dataSrc, 'export function isModeFace', 'export function zeroCostReason', 'the face index')
  + cut(unitsSrc, 'export const PART_SLOTS', 'export const SLOT_LABEL', 'PART_SLOTS')
  + cut(unitsSrc, '// ---------- runtime Part faces and Tether X', 'function legacyZoneSet', 'the Tether block')
  + cut(meleeSrc, '// ---------- Tether X', null, 'tetherCap'));
const T = await import(tmp.href);

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}, got ${g}`); }
};

// ---------- the real cards ----------
const cards = JSON.parse(readFileSync(new URL('../../data/cards.json', import.meta.url), 'utf8'));
const byId = new Map(cards.map((c) => [c.id, c]));
const data = { cards, byId };
const act = (cardId, actionId) => (byId.get(cardId)?.actions ?? []).find((a) => a.id === actionId);

console.log('Tether X and runtime Part faces\n');

// ---------- the printed readers ----------

// "[On Hit] Tether 4" on the card's own English. The 牵引 glossary entry has no
// English at all (keyword_overrides.json), which is why this is read off the
// Action rather than off the keyword table — and why the card was never a
// BLOCKED_ON_DATA case.
check('Tether 4 is read off the Harpoon\'s own Action', T.tetherOf(act('PDLH-202', 'PDLH-202_A')), 4);
check('and off the Chinese when the English is missing',
  T.tetherOf({ id: 'x', name: {}, description: { zh: '· 【命中】牵引4。' } }), 4);
// The passive on the far face says "Tether Mode", with no number. A reader that
// matched the words alone would place a leash of 1 every time it flipped back.
check('the flip-back passive places no leash', T.tetherOf(act('PDLH-202-T', 'PDLH-202-T_A')), undefined);
check('and an ordinary Melee Action places none either', T.tetherOf(act('PDLH-202', 'PDLH-202_B')), undefined);

// The White Dwarf's Mode Actions carry the structured rule that was in the
// bundle all along and read nowhere.
check('287_B declares the Cruise transform',
  T.transformEffect(act('287', '287_B')), { partType: 'torso', targetPartId: '288' });
check('288_B declares the Assault transform',
  T.transformEffect(act('288', '288_B')), { partType: 'torso', targetPartId: '287' });
check('and a plain attack declares none', T.transformEffect(act('287', '287_A')), null);

// ---------- the face index ----------

// throwIndex is a one-way edge in the data. The reverse one is what makes the
// flip BACK possible, and nothing in the bundle carries it.
check('the printed edge is read', T.faceOf(cards, 'PDLH-202'), 'PDLH-202-T');
check('and the reverse edge the data does not carry is built', T.faceOf(cards, 'PDLH-202-T'), 'PDLH-202');
check('a card with no far face has none', T.faceOf(cards, '287'), undefined);

// The index is a lookup, never a permission: 61 of the 62 throwIndex edges
// point at a Discard Card, and flipping to one of those on demand would be
// 4.17 backwards.
check('the Harpoon may become its Tether Mode', T.transformFaces(data, byId.get('PDLH-202')), ['PDLH-202-T']);
check('and Tether Mode may become the Harpoon', T.transformFaces(data, byId.get('PDLH-202-T')), ['PDLH-202']);
check('a Discard Card is NOT a transform target', T.transformFaces(data, byId.get('023')), []);
check('nor is the Discard Card a way back', T.transformFaces(data, byId.get('024')), []);
check('the White Dwarf offers its other Mode', T.transformFaces(data, byId.get('287')), ['288']);
check('in both directions', T.transformFaces(data, byId.get('288')), ['287']);

// isModeFace reads the PRICE, not the name. Both White Dwarf Modes are printed
// at 72, so either is a legal build; Tether Mode is printed at 0 because it is
// a state you can only arrive at.
check('Tether Mode is a derived face', T.isModeFace(byId.get('PDLH-202-T')), true);
check('Cruise Mode is a paid build choice, not a derived face', T.isModeFace(byId.get('288')), false);
check('only the Tether face answers to a Tether ending', [
  T.isTetherFace(byId.get('PDLH-202-T')), T.isTetherFace(byId.get('288')),
], [true, false]);

// ---------- what a Hit owes ----------

const harpoonMech = (uid, side, c, r, left = 'PDLH-202') => ({
  uid, side, kind: 'mech', label: `M${uid}`, size: 3, aerial: false, deployed: true,
  col: c * 3, row: r * 3, facing: 0, stance: 'offensive',
  mech: { torso: '287', leftHand: left }, partStates: { torso: 'intact', leftHand: 'intact' },
  ammo: {}, intercept: {},
});
const plain = (uid, side, c, r) => ({
  uid, side, kind: 'mech', label: `M${uid}`, size: 3, aerial: false, deployed: true,
  col: c * 3, row: r * 3, facing: 0, stance: 'offensive',
  mech: { torso: '287' }, partStates: { torso: 'intact' }, ammo: {}, intercept: {},
});

const strike = T.tetherStrike(data, harpoonMech(1, 's1', 0, 0), act('PDLH-202', 'PDLH-202_A'));
check('a Hit owes the leash AND the slot to turn over',
  strike, { range: 4, slot: 'leftHand', into: 'PDLH-202-T' });
// The Impale on the same card places nothing, so the flip is not a side effect
// of holding the Part.
check('the card\'s other Action owes nothing',
  T.tetherStrike(data, harpoonMech(1, 's1', 0, 0), act('PDLH-202', 'PDLH-202_B')), null);

// ---------- the leash, and the asymmetry ----------

// PDLH-202 prints the cap on ONE side only: "the tethered unit cannot
// voluntarily move to a position beyond X grids from the initiating unit". The
// initiator walking out is a removal condition, not an illegal move — so it is
// not capped at all, and getting this backwards is the whole trap.
const pair = () => {
  const a = harpoonMech(1, 's1', 0, 0, 'PDLH-202-T');
  const b = plain(2, 's2', 2, 0);
  T.tetherTo(a, b, 4);
  return [a, b];
};
{
  const [a, b] = pair();
  check('both ends carry a chip naming the other', [a.tether, b.tether], [
    [{ uid: 2, range: 4, role: 'initiator' }],
    [{ uid: 1, range: 4, role: 'tethered' }],
  ]);
  check('the INITIATOR is not capped', T.tetherCap(a, [a, b]), undefined);
  const cap = T.tetherCap(b, [a, b]);
  check('the TETHERED unit is', typeof cap, 'function');
  check('4 Grids from the anchor is still legal', cap(4, 0), true);
  check('5 is not', cap(5, 0), false);
  // Manhattan on Large Grids, the same reading rangeBetween uses everywhere.
  check('and the leash is measured the way every other range is', [cap(2, 2), cap(3, 2)], [true, false]);
  check('an untethered unit is never capped', T.tetherCap(plain(3, 's1', 0, 0), [a, b]), undefined);
}

// ---------- the leash is a legality, not a price ----------

// The trap this exists to avoid: charged as exitCost, a Movement Range rich
// enough simply buys past the leash. Anchor at Grid 0, leash 4, Range 8.
{
  const [a, b] = pair();
  const opts = { allowed: T.tetherCap(b, [a, b]) };
  const reach = (steps, o) => T.reachableGrids(b, steps, [], [], false, o)
    .filter((g) => g.r === 0).map((g) => g.c).sort((x, y) => x - y);
  check('with 8 Movement Range the walk still stops at 4', reach(8, opts), [0, 1, 3, 4]);
  check('and without the leash it would not', reach(8, undefined).includes(7), true);
  // Impassable rather than merely un-endable: Movement is resolved a Grid at a
  // time and every Grid entered is a position (4.3), so there is no stepping
  // out to 5 and back to 4 on the far side.
  check('nor can a route step THROUGH a Grid off the leash',
    T.movePath(b, { c: 6, r: 0 }, 8, [], [], false, opts).length, 0);
  check('while a legal destination is still routable',
    T.movePath(b, { c: 4, r: 0 }, 8, [], [], false, opts).length, 3);
}

// ---------- the three removal conditions ----------

const board = (tokens) => ({ tokens, nextUid: 99, round: { n: 1, phase: 2, firstPlayer: 's1' } });

// (a) The initiator voluntarily walks out. Not an illegal move — the chips
// simply come off — and the Harpoon comes back with them.
{
  const [a, b] = pair();
  const s = board([a, b]);
  a.col = 21; // Large Grid 7, five away from the tethered unit at Grid 2
  T.settleTethers(data, s);
  check('the initiator walking out removes both chips', [a.tether, b.tether], [undefined, undefined]);
  check('and Tether Mode flips back to the Harpoon', a.mech.leftHand, 'PDLH-202');
}
// (b) Either unit is forcibly moved so the distance is greater than X.
{
  const [a, b] = pair();
  const s = board([a, b]);
  b.col = 24; // shoved to Grid 8
  T.settleTethers(data, s);
  check('a shove past the leash removes them too', [a.tether, b.tether], [undefined, undefined]);
  check('and the initiator\'s card turns back over', a.mech.leftHand, 'PDLH-202');
}
// (c) The initiating unit is Penetrated. Position-independent, so it is the one
// condition settleTethers cannot derive.
{
  const [a, b] = pair();
  const s = board([a, b]);
  T.cutTethersOn(data, s, a, 'initiator');
  check('Penetrating the initiator removes them', [a.tether, b.tether], [undefined, undefined]);
  check('and flips the card back', a.mech.leftHand, 'PDLH-202');
}
// The asymmetry again, on the other half of the rule: Penetrating the TETHERED
// unit does nothing at all, which is the point of harpooning something.
{
  const [a, b] = pair();
  const s = board([a, b]);
  T.cutTethersOn(data, s, b, 'initiator');
  check('Penetrating the tethered unit leaves the leash on',
    [a.tether?.length, b.tether?.length], [1, 1]);
  check('and the Harpoon stays in Tether Mode', a.mech.leftHand, 'PDLH-202-T');
}
// Still inside X: nothing happens, and the sweep is idempotent.
{
  const [a, b] = pair();
  const s = board([a, b]);
  T.settleTethers(data, s);
  T.settleTethers(data, s);
  check('a pair still within X is left alone', [a.tether?.length, b.tether?.length], [1, 1]);
  check('and the card stays flipped', a.mech.leftHand, 'PDLH-202-T');
}
// A chip needs two units. A destroyed Mech leaves the board (4.4.4), and a
// removed one is not in state.tokens at all.
{
  const [a, b] = pair();
  const s = board([a, b]);
  b.partStates.torso = 'destroyed';
  T.settleTethers(data, s);
  check('a destroyed far end drops the leash', [a.tether, b.tether], [undefined, undefined]);
}
{
  const [a, b] = pair();
  const s = board([a]);
  void b;
  T.settleTethers(data, s);
  check('and so does one that has left the board', a.tether, undefined);
}

// ---------- the generic rewrite ----------

{
  const t = harpoonMech(1, 's1', 0, 0);
  T.synced.length = 0;
  T.transformPartOn(data, t, 'leftHand', 'PDLH-202-T');
  check('the slot is rewritten', t.mech.leftHand, 'PDLH-202-T');
  check('and the magazines are re-seeded', T.synced, [1]);
  check('the Part keeps the damage it had', t.partStates.leftHand, 'intact');
}
{
  // A Torso IS the token's cardId for a Mech, so a Mode change has to move both
  // or every reader taking the short path keeps seeing the old face.
  const t = harpoonMech(1, 's1', 0, 0);
  t.cardId = '287';
  T.transformPartOn(data, t, 'torso', '288');
  check('a Torso transform moves cardId with the slot', [t.mech.torso, t.cardId], ['288', '288']);
}
{
  // The White Dwarf offer, read off the card rather than off its id.
  const t = harpoonMech(1, 's1', 0, 0);
  t.cardId = '287';
  const offer = T.transformOffer(data, t, act('287', '287_B'));
  check('287_B offers the Torso swap', [offer?.slot, offer?.from.id, offer?.into.id], ['torso', '287', '288']);
  check('an Action with no transform offers nothing', T.transformOffer(data, t, act('287', '287_A')), null);
  t.partStates.torso = 'destroyed';
  check('and a destroyed Part has no card left to turn over',
    T.transformOffer(data, t, act('287', '287_B')), null);
}

// ---------- where the wiring has to live ----------
//
// Source checks, because these are the "wired on one page only" failures this
// codebase keeps producing, and there is no way to catch them from a fixture.

// THREE construction sites, not two: matchhud builds its own opts twice.
check('every MoveOpts site carries the leash',
  (mainSrc + hudSrc).match(/allowed: tetherCap\(/g)?.length, 3);
check('and each page imports it', [
  /import \{[^}]*tetherCap[^}]*\} from '\.\/melee'/.test(mainSrc),
  /import \{[^}]*tetherCap[^}]*\} from '\.\/melee'/.test(hudSrc),
], [true, true]);
// Priced as exitCost it would be buyable; tested in the search it is not.
check('the leash is tested in searchMoves, not priced',
  /if \(opts\?\.allowed && !opts\.allowed\(n\.c, n\.r\)\) continue;/.test(rules), true);
check('and it is not folded into exitCost', /exitCost:[^\n]*tetherCap/.test(mainSrc + hudSrc), false);
// The overlay silently shrinking is the one thing a player cannot deduce, so
// both boards say why — out of one helper, so they cannot say it differently.
check('both boards explain the short reach from the same helper',
  [/tetherNote\(t, state\.tokens\)/.test(mainSrc), /tetherNote\(t, ctx\.state\.tokens\)/.test(hudSrc)], [true, true]);

// The Hit and the Penetration both land in SHARED code, so neither page can
// have a copy the other lacks. combat.ts is the one attack seam both pages run;
// commands.ts apply is the one place a Penetration becomes true on both boards.
check('the Hit is emitted from the shared attack seam', /tetherStrike\(this\.data, c\.attacker, c\.action/.test(combatSrc), true);
check('and before the Forced Movement rider, so a shove can cut it',
  combatSrc.indexOf('tetherStrike(this.data') < combatSrc.indexOf('const rider = {'), true);
check('the Penetration break rides applyPenetration, not a per-page callback',
  /cutTethersOn\(data, state, target, 'initiator'\);/.test(commandsSrc), true);
check('and neither page hooks it onto its own onPenetrated',
  /cutTethersOn/.test(mainSrc + hudSrc), false);
// One sweep for every command, so no mover can be forgotten.
check('apply sweeps the chips after every command',
  /applyCommand\(data, state, cmd\);\s*\n\s*settleTethers\(data, state\);/.test(commandsSrc), true);

// The two registries a new rules-bearing token field must reach, or it is
// dropped on load and desyncs the two clients.
check('migrateState rebuilds the Tether chips', /tether: tether\.length \? tether : undefined,/.test(unitsSrc), true);
check('and boardFingerprint hashes them', /t\.tether \?\? \[\]\)\.map\(\(x\) => `\$\{x\.uid\}:\$\{x\.range\}:\$\{x\.role\}`\)/.test(secrecySrc), true);

// BUG-8: a squad must not be able to START in Tether Mode, with no tether.
check('the build picker refuses a derived Mode face', /!isModeFace\(c\) \|\| this\.mech\[slot\.key\] === c\.id/.test(src('roster.ts')), true);

// A MUTUAL harpoon: both Mechs fire one at the other. Each then holds TWO
// chips naming the same partner, one per role. De-duping on uid alone silently
// destroyed the first chip and inverted which end was capped.
{
  const a = { uid: 1, tether: [] };
  const b = { uid: 2, tether: [] };
  T.tetherTo(a, b, 4);
  T.tetherTo(b, a, 3);
  check('a mutual harpoon leaves each end holding both chips',
    [a.tether.length, b.tether.length], [2, 2]);
  check('and A is initiator over B while B is initiator over A',
    [a.tether.map((x) => x.role).sort(), b.tether.map((x) => x.role).sort()],
    [['initiator', 'tethered'], ['initiator', 'tethered']]);
  check('each leash keeps its own range',
    a.tether.map((x) => `${x.role}:${x.range}`).sort(), ['initiator:4', 'tethered:3']);
  // Re-firing the SAME harpoon must still replace rather than stack.
  T.tetherTo(a, b, 6);
  check('re-firing the same harpoon replaces its own chip, not the other one',
    [a.tether.length, a.tether.find((x) => x.role === 'initiator').range], [2, 6]);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
