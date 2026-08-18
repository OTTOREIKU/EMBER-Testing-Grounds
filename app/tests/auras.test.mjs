// Auras (FAQ Q1-Q4, J2) read against the REAL card database, because every bug
// this file exists to catch was invisible to a fixture: an aura's reach, who it
// may land on, and which Actions it touches all live in the shipped data.
import { readFileSync, writeFileSync } from 'node:fs';

const units = readFileSync(new URL('../src/units.ts', import.meta.url), 'utf8');
const rules = readFileSync(new URL('../src/rules.ts', import.meta.url), 'utf8');
const cut = (s, a, b, what) => {
  const i = s.indexOf(a), j = s.indexOf(b);
  if (i < 0 || j < 0) throw new Error(`could not locate ${what}`);
  return s.slice(i, j);
};

// tokenCards and largeGridOf are mirrored; everything under test is sliced.
const body = `
type Token = any; type GameData = any; type PartSlot = any; type CardAction = any; type Card = any;
function cardName(c: any): string { return c?.name?.en ?? c?.id ?? ''; }
export function tokenCards(data: any, t: any): any[] {
  const out: any[] = [];
  for (const slot of ['torso', 'chasis', 'leftHand', 'rightHand', 'backpack']) {
    const id = t.mech?.[slot]; const c = id ? data.byId.get(id) : undefined;
    if (c) out.push({ slot, card: c });
  }
  if (t.kind !== 'mech') { const c = data.byId.get(t.cardId); if (c) out.push({ slot: 'main', card: c }); }
  return out;
}
function largeGridOf(t: any): any { return { c: Math.floor(t.col / 3), r: Math.floor(t.row / 3) }; }
`
  + cut(rules, 'export function rangeBetween', 'export function inArc', 'rangeBetween')
  + cut(units, 'export interface AuraSource', 'export interface ParryPart', 'the aura readers')
  + cut(units, 'export interface ParryPart', 'export interface SelfHitPart', 'parryParts')
  + cut(units, 'export interface SelfHitPart', '// A Firing Action', 'selfHitParts')
  + cut(units, '// A Firing Action', 'export function repairSpec', 'actionRange and hasFlexibleTiming');

const tmp = new URL('./_auras.slice.ts', import.meta.url);
writeFileSync(tmp, body);
const A = await import(tmp.href);

const raw = JSON.parse(readFileSync(new URL('../../data/cards.json', import.meta.url), 'utf8'));
const cards = Array.isArray(raw) ? raw : raw.cards;
// The app patches actions at load from action_overrides.json, and an aura's
// REACH is one of the things that gets corrected there — card 173 reads 0 in
// cards.json and 6 on the printed card. Reading the raw file would test a
// range no player ever sees, so the same patch is applied here.
const patch = JSON.parse(readFileSync(new URL('../../data/action_overrides.json', import.meta.url), 'utf8')).actions ?? {};
for (const c of cards) {
  for (const a of c.actions ?? []) {
    const fix = patch[a.id];
    if (!fix) continue;
    for (const [k, v] of Object.entries(fix)) {
      if (k.startsWith('_')) continue;
      if (k === 'name' && v && typeof v === 'object') a.name = { ...a.name, ...v };
      else a[k] = v;
    }
  }
}
const data = { byId: new Map(cards.map((c) => [c.id, c])) };

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}`);
  if (!ok) { console.log(`       want ${JSON.stringify(want)}, got ${JSON.stringify(got)}`); fail++; } else pass++;
};

const mech = (uid, side, torso, col) =>
  ({ uid, side, kind: 'mech', col, row: 9, size: 3, facing: 0, mech: { torso }, partStates: { torso: 'intact' } });
const drone = (uid, side, cardId, col) =>
  ({ uid, side, kind: 'drone', col, row: 9, size: 1, facing: 0, cardId, partStates: { main: 'intact' } });

const firing = { type: 'Firing', range: 4 };
const moving = { type: 'Moving', range: 0 };

console.log('\nAuras, against the shipped card data\n');

// 014 RT-07T Dune: "All actions of Ally MECHS within range gain Flexible Timing", aura Range 3.
const dune = mech(1, 's1', '014', 9);
const ally = mech(2, 's1', '002', 15);      // 2 Large Grids away
const farAlly = mech(3, 's1', '002', 30);   // 7 away
const foe = mech(4, 's2', '002', 12);       // 1 away, wrong side
const alliedDrone = drone(5, 's1', '003', 15);
const world = [dune, ally, farAlly, foe, alliedDrone];

check('a unit is its own ally, so the carrier flexes itself (Q4)',
  A.hasFlexibleTiming(data, world, dune, moving), true);
check('an ally inside the aura Range is flexed',
  A.hasFlexibleTiming(data, world, ally, moving), true);
check('an ally beyond it is not',
  A.hasFlexibleTiming(data, world, farAlly, moving), false);
check('an enemy inside it is not',
  A.hasFlexibleTiming(data, world, foe, moving), false);
// targetUnitType on this aura is "mech"; ignoring it handed Drones a Mech-only grant.
check('a Drone is untouched by a MECH-only aura',
  A.hasFlexibleTiming(data, world, alliedDrone, moving), false);

// 558 RT-12T Oasis grants to FIRING Actions only, where 014/077 grant to all.
const oasis = mech(6, 's1', '558', 9);
const nearOasis = mech(7, 's1', '002', 15);
const w2 = [oasis, nearOasis];
check('a Firing-only aura reaches a Firing Action',
  A.hasFlexibleTiming(data, w2, nearOasis, firing), true);
check('and does NOT reach a Movement Action',
  A.hasFlexibleTiming(data, w2, nearOasis, moving), false);
check('while an all-actions aura does',
  A.hasFlexibleTiming(data, world, ally, moving), true);
check('with no Action to judge, only the unrestricted sources answer',
  [A.hasFlexibleTiming(data, w2, nearOasis), A.hasFlexibleTiming(data, world, ally)], [false, true]);

// Values: +1 Range for Mechs, +2 for Drones, both on Firing Actions only.
check('Firing Coordination lengthens a Firing Action by 1',
  A.actionRange(data, w2, nearOasis, firing), 5);
check('and leaves a Movement Action alone',
  A.actionRange(data, w2, nearOasis, moving), 0);
const node = mech(8, 's1', '173', 9);
const dr = drone(9, 's1', '003', 9);
check('Fire Control Planning lengthens an ally DRONE by 2',
  A.actionRange(data, [node, dr], dr, firing), 6);
check('but not an ally Mech, since that aura is drone-only',
  A.actionRange(data, [node, mech(10, 's1', '002', 9)], mech(10, 's1', '002', 9), firing), 4);
// Card 173's reach is 6 on the printed card and 0 in cards.json; the override
// is what makes this pass, so this asserts the whole load path, not just the aura.
const farDrone = drone(16, 's1', '003', 24);   // 5 Large Grids from the Node Core
check('the Node Core aura reaches across its corrected Range 6',
  A.actionRange(data, [node, farDrone], farDrone, firing), 6);
const tooFar = drone(17, 's1', '003', 30);     // 7 away
check('and stops beyond it',
  A.actionRange(data, [node, tooFar], tooFar, firing), 4);

// Defence and the electronic contest.
const escarp = mech(11, 's1', '559', 9);
check('Defense optimization is +1 White for an ally',
  A.auraValueOn(data, [escarp, ally], ally, 'defense_white_dice_bonus'), 1);
const chance = mech(12, 's2', 'PDTR-202', 9);
check('EW Suppression is Strength -1 on an ENEMY',
  A.auraValueOn(data, [chance, ally], ally, 'electronic_contest_strength_penalty'), -1);
const ownSide = mech(13, 's2', '002', 12);
check('and never on its own side',
  A.auraValueOn(data, [chance, ownSide], ownSide, 'electronic_contest_strength_penalty'), 0);

// "This effect does not stack" is printed on every one of them.
const twoEscarps = [escarp, mech(14, 's1', '559', 12), ally];
check('two sources of the same aura do not add up',
  A.auraValueOn(data, twoEscarps, ally, 'defense_white_dice_bonus'), 1);

// A destroyed Part carries no aura.
const deadNode = { ...mech(15, 's1', '014', 9), partStates: { torso: 'destroyed' } };
check('a destroyed carrier projects nothing',
  A.hasFlexibleTiming(data, [deadNode, ally], ally, moving), false);

// ---------- Shield Up / Mobile Defense (phase 2) ----------
//
// "This Mech may Designate this part to resolve damage [in the Defensive
// Stance]." The difference between the two is a printed CONDITION in the data,
// not the name: Shield Up carries a defensive-stance condition, Mobile Defense
// carries none.

const withPart = (leftHand, stance, states = {}, repaired = []) => ({
  uid: 20, side: 's1', kind: 'mech', col: 9, row: 9, size: 3, facing: 0, stance,
  mech: { torso: '002', leftHand }, partStates: { torso: 'intact', ...states }, repairedSlots: repaired,
});
const shieldSlots = (t) => A.selfHitParts(data, t).map((x) => x.slot);

check('Shield Up offers the Part in Defensive Stance',
  shieldSlots(withPart('034', 'defensive')), ['leftHand']);
check('and offers nothing outside it',
  shieldSlots(withPart('034', 'offensive')), []);
check('Mobile Defense has no stance condition, so it always offers',
  shieldSlots(withPart('107', 'offensive')), ['leftHand']);
check('a destroyed Part cannot be volunteered',
  shieldSlots(withPart('034', 'defensive', { leftHand: 'destroyed' })), []);
// A Repaired Part is removed outright when hit (FAQ J23), which is not
// "resolving damage", so it must not be offered as a shield.
check('nor can a Repaired one (J23)',
  shieldSlots(withPart('034', 'defensive', {}, ['leftHand'])), []);
check('a Drone has no Parts to designate',
  A.selfHitParts(data, { uid: 21, side: 's1', kind: 'drone', col: 9, row: 9, cardId: '003', partStates: { main: 'intact' } }), []);
check('the offer names the ability, not the card',
  A.selfHitParts(data, withPart('034', 'defensive')).map((x) => x.label), ['Shield Up']);

// ---------- Parry (rulebook 4.6.3) ----------
//
// "A melee-only defence. The defender designates a Part with a Parry Value as
// the target Part and adds that many White dice to the Defense Roll. Not
// available while in Shutdown or against a Back Attack."
//
// The two gates the CALLER must judge — is the Action Melee, is the attacker in
// the defender's rear arc — are passed in, because a Part cannot see either.

const parryMech = (leftHand, stance = 'defensive', states = {}, repaired = []) => ({
  uid: 30, side: 's1', kind: 'mech', col: 9, row: 9, size: 3, facing: 0, stance,
  mech: { torso: '002', leftHand }, partStates: { torso: 'intact', ...states }, repairedSlots: repaired,
});
const melee = { melee: true, backAttack: false };
// ZHLA-202 carries Parry 3, and is one of the 76 cards whose printed Parry
// Value did nothing before this.
const parryOf = (t, o = melee) => A.parryParts(data, t, o).map((x) => x.slot + ':' + x.value);

check('a Part with a Parry Value is offered against a Melee attack',
  parryOf(parryMech('ZHLA-202')), ['leftHand:3']);
check('Parry is melee-only',
  parryOf(parryMech('ZHLA-202'), { melee: false, backAttack: false }), []);
check('and is barred against a Back Attack',
  parryOf(parryMech('ZHLA-202'), { melee: true, backAttack: true }), []);
check('and while Shutdown',
  parryOf(parryMech('ZHLA-202', 'shutdown')), []);
check('a destroyed Part cannot Parry',
  parryOf(parryMech('ZHLA-202', 'defensive', { leftHand: 'destroyed' })), []);
check('nor can a Repaired one (J23)',
  parryOf(parryMech('ZHLA-202', 'defensive', {}, ['leftHand'])), []);
// ZYBP-101 is a Backpack with no Parry Value. 034 is deliberately NOT used
// here: the Type 77 Bulwark carries Parry 1 as well as Shield Up, and 10 of
// the 13 Shield Up cards do the same — a Part being both is the NORM, which
// is why designateOffers merges them into one entry rather than listing it twice.
check('a Part with no Parry Value is not offered',
  parryOf(parryMech('ZYBP-101')), []);
check('a shield that also Parries reports its Parry Value',
  parryOf(parryMech('034')), ['leftHand:1']);
check('a Drone never Parries',
  A.parryParts(data, { uid: 31, side: 's1', kind: 'drone', col: 9, row: 9, cardId: '003', partStates: { main: 'intact' } }, melee), []);
// The stat is real and widespread: this is why it was worth building.
check('the Parry Value comes off the card, not a guess',
  A.parryParts(data, parryMech('ZHLA-202'), melee)[0].value,
  data.byId.get('ZHLA-202').parray);


console.log(`\n${pass} passed, ${fail} failed\n`);
if (fail) process.exit(1);
