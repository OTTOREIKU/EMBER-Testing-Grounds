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
type SmokeScreen = any; type LoanedPart = any;
// electronicStrength asks loanedParts what a Tarantula is lending the Initiator.
// Stubbed empty: no fixture here carries a Carrier, and loads.test.mjs owns that
// half. What this file is for is the OTHER rider on the same number, the EW
// Suppression aura, which no fixture can fake because the reach lives in the data.
export function loanedParts(_d: any, _t: any[], _u: any): any[] { return []; }
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
  + cut(rules, 'export function losBetween', 'export function rangeBetween', 'losBetween')
  // The REAL smokeBlocks, not a stub: earlyWarningCover asks whether the
  // attacker is visible to the drone, and 4.16 makes a Smoke Screen part of
  // that answer. 7-9 and 58-84 today, both well clear of the two cuts above
  // (losBetween starts at 439), so nothing here is declared twice.
  + cut(rules, 'export function smokeKey', 'export function smokeAt', 'smokeKey')
  + cut(rules, 'export function smokeBlocks', 'export interface LargeGrid', 'smokeBlocks')
  + cut(units, 'export interface AuraSource', '// Melee Evasion (ZYBP-302)', 'the aura readers')
  + cut(units, '// Melee Evasion (ZYBP-302)', 'export interface CommandRider', 'meleeEvasionReady')
  + cut(units, 'export interface ParryPart', 'export interface SelfHitPart', 'parryParts')
  + cut(units, 'export interface SelfHitPart', '// A Firing Action', 'selfHitParts')
  + cut(units, '// A Firing Action', 'export function repairSpec', 'actionRange and hasFlexibleTiming')
  + cut(units, 'export const SLOT_LABEL', 'let uidSource', 'SLOT_LABEL')
  + cut(units, '// ---------- [Two-Handed] and the Freehand designation', 'export function attackReactionsOf', 'coolingBonus, ripostePart, defenseReactionOn and targetTracingOn')
  + cut(units, 'function alive(t: Token)', 'function coversGrid', 'the alive helper')
  + cut(units, '// ---------- Martyrdom', 'export function autoDetonationsOwed', 'martyrdomOwed')
  + cut(units, 'export function explosionScope', 'export function needsSightToLanding', 'explosionScope')
  // 1617-1696 today, and inside none of the cuts above — checked before adding,
  // because a range that overlaps one declares the same function twice.
  + cut(units, '// ---------- The Hyena', '// ---------- Repeaters', 'aaRadarCovers and earlyWarningCover')
  // 437-484 today. Same check: the nearest cut above ends at needsSightToLanding
  // (427) and the nearest below starts at [Two-Handed] (531), so nothing here is
  // declared twice. Stops short of camoBrokenBy on purpose — that block wants
  // statusCount, inContact and isBarricade, and camo.test.mjs already owns it.
  + cut(units, '// ---------- Silence (rulebook 4.12', '// ---------- Who breaks Optical Camouflage', 'the Silence classifiers')
  // 2568-2602 today. Checked against every cut above before adding, as the
  // header at the top of this list demands: the nearest one ends at
  // autoDetonationsOwed (2459) and the nearest below starts nowhere — this is
  // the last cut in the file — so nothing here is declared twice.
  + cut(units, 'export function electronicValue', 'export function defaultUnitLabel', 'electronicValue and electronicStrength');

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


// ---------- Melee Evasion (ZYBP-302) ----------
//
// "On Parry, this mech may spend 1 Command Token to gain 1 additional {Dodge}."
// Read off the Mech's own Parts, and it needs a face-up Command Token. The
// Chinese says 招架 for Parry, not 格挡 — the first pattern written here used
// the wrong word and silently never matched.

const evadeMech = (torso, statuses = ['command'], states = {}) => ({
  uid: 40, side: 's1', kind: 'mech', col: 9, row: 9, size: 3, facing: 0, stance: 'defensive',
  mech: { torso }, partStates: { torso: 'intact', ...states }, statuses,
});
check('a Mech with Melee Evasion and a Command Token is ready',
  A.meleeEvasionReady(data, evadeMech('ZYBP-302')), true);
check('without a face-up Command Token it is not',
  A.meleeEvasionReady(data, evadeMech('ZYBP-302', [])), false);
check('a spent token does not pay for it',
  A.meleeEvasionReady(data, evadeMech('ZYBP-302', ['commandUsed'])), false);
check('a Mech without the ability is never ready',
  A.meleeEvasionReady(data, evadeMech('002')), false);
check('a destroyed Part offers nothing',
  A.meleeEvasionReady(data, evadeMech('ZYBP-302', ['command'], { torso: 'destroyed' })), false);
// ZYBP-302 also carries Dodge Enhancement, which is a DIFFERENT ability with a
// different trigger; the matcher must not confuse the two.
check('and it is Melee Evasion that matched, not Dodge Enhancement',
  data.byId.get('ZYBP-302').actions.some((a) => /Dodge Enhancement/.test(a.name?.en ?? '')), true);


// ---------- Dodge Enhancement (ZYBP-302) ----------
//
// Same card as Melee Evasion, but no Parry condition: any hit will do. The two
// matchers are checked against each other because they read the same card.
check('a Mech with Dodge Enhancement and a Command Token is ready',
  A.dodgeEnhanceReady(data, evadeMech('ZYBP-302')), true);
check('Dodge Enhancement without a face-up Command Token is not ready',
  A.dodgeEnhanceReady(data, evadeMech('ZYBP-302', [])), false);
check('a spent token does not pay for Dodge Enhancement either',
  A.dodgeEnhanceReady(data, evadeMech('ZYBP-302', ['commandUsed'])), false);
check('a Mech without Dodge Enhancement is never ready',
  A.dodgeEnhanceReady(data, evadeMech('002')), false);
check('a destroyed Part offers no Dodge Enhancement',
  A.dodgeEnhanceReady(data, evadeMech('ZYBP-302', ['command'], { torso: 'destroyed' })), false);
check('a Drone never gets Dodge Enhancement',
  A.dodgeEnhanceReady(data, { ...evadeMech('ZYBP-302'), kind: 'drone' }), false);
// The zh line prints only the effect, no trigger, so it is the effect that is
// matched -- checked against the real card string, not against the English.
check('the Chinese Dodge Enhancement line is matched on the effect it prints',
  /闪避\}?可抵消1枚攻击骰/.test(
    data.byId.get('ZYBP-302').actions.find((a) => /Dodge Enhancement/.test(a.name?.en ?? '')).description.zh), true);

// ---------- Target Tracing (174) ----------
//
// The trap this one carries: `targetTracer` in the codebase is the STATUS TOKEN
// 标靶追踪, which has nothing to do with card 174's 标靶追溯. Grepping the
// English root finds the wrong thing, so these assertions name the card.
const traceMech = (torso, statuses = ['command'], states = {}) => ({
  uid: 9, kind: 'mech', side: 's1', col: 0, row: 0,
  mech: { torso }, partStates: { torso: 'intact', ...states }, statuses,
});
check('a Mech with Target Tracing and a Command Token is ready',
  A.targetTracingOn(data, traceMech('174'))?.actionId, '174_B');
check('and it names the ability, not the Data Link on the same card',
  A.targetTracingOn(data, traceMech('174'))?.name, 'Target Tracing');
check('without a face-up Command Token it offers nothing',
  A.targetTracingOn(data, traceMech('174', [])), null);
check('a spent token does not pay for it',
  A.targetTracingOn(data, traceMech('174', ['commandUsed'])), null);
check('a destroyed Part offers nothing',
  A.targetTracingOn(data, traceMech('174', ['command'], { torso: 'destroyed' })), null);
check('a Mech without the ability is never ready',
  A.targetTracingOn(data, traceMech('002')), null);
check('a Drone never gets it', A.targetTracingOn(data, { ...traceMech('174'), kind: 'drone' }), null);
// The card carries no gameRules at all, which is why the rule is authored from
// the printed text -- if that ever changes, this should be revisited.
check('the card still prints no structured rules for it',
  data.byId.get('174').actions.find((x) => x.id === '174_B').gameRules ?? null, null);

// ---------- Defense Reaction (ZHLA-101, ZHLA-301) ----------
//
// ANY Part being Penetrated triggers it, not the Part carrying the shield, and
// it asks for no Command Token -- the only price is the Stance change happening
// outside the moment 4.1 allows.
const shieldMech = (torso, states = {}) => ({
  uid: 7, kind: 'mech', side: 's1', col: 0, row: 0, stance: 'offensive',
  mech: { torso }, partStates: { torso: 'intact', ...states }, statuses: [],
});
check('the Buckler reacts to a Penetration', A.defenseReactionOn(data, shieldMech('ZHLA-101'))?.name, 'Defense Reaction');
check('and so does the Heavy Shield', A.defenseReactionOn(data, shieldMech('ZHLA-301'))?.name, 'Defense Reaction');
check('it needs no Command Token, unlike the ZYBP-302 pair',
  A.defenseReactionOn(data, { ...shieldMech('ZHLA-101'), statuses: [] })?.actionId, 'ZHLA-101_A');
check('a destroyed Part offers nothing', A.defenseReactionOn(data, shieldMech('ZHLA-101', { torso: 'destroyed' })), null);
check('a Mech without the ability is never ready', A.defenseReactionOn(data, shieldMech('002')), null);
check('a Drone never gets it', A.defenseReactionOn(data, { ...shieldMech('ZHLA-101'), kind: 'drone' }), null);
// ZHLA-301 carries Shield Up as well, which is a different ability on the same
// card -- the same confusion Melee Evasion and Dodge Enhancement set up.
check('and it is Defense Reaction that matched, not Shield Up',
  A.defenseReactionOn(data, shieldMech('ZHLA-301'))?.actionId,
  data.byId.get('ZHLA-301').actions.find((x) => /Defense Reaction/.test(x.name?.en ?? '')).id);

// ---------- Martyrdom (ZHDR-302) ----------
//
// Derived off the board from a unit that is already DESTROYED, which is exactly
// the case every other owed-reader filters out.
const zealot = (over = {}) => ({
  uid: 20, kind: 'drone', side: 's1', col: 0, row: 0, size: 1, cardId: 'ZHDR-302',
  partStates: { main: 'destroyed' }, statuses: [], stance: 'defensive', ...over,
});
const bystander = (uid, side, col, row) => ({
  uid, kind: 'drone', side, col, row, size: 1, cardId: '002',
  partStates: { main: 'intact' }, statuses: [], stance: 'offensive',
});
check('a destroyed Zealot owes a Detonation',
  A.martyrdomOwed(data, [zealot()]).map((x) => x.actionId), ['ZHDR-302_B']);
check('an intact one owes nothing', A.martyrdomOwed(data, [zealot({ partStates: { main: 'intact' } })]), []);
check('and one that has left the board owes nothing',
  A.martyrdomOwed(data, [zealot({ deployed: false })]), []);
check('a unit without the ability never owes one',
  A.martyrdomOwed(data, [{ ...zealot(), cardId: '002' }]), []);
// filter: 'any' -- the blast is not narrowed by side, which is the whole trap.
const near = [zealot(), bystander(21, 's2', 1, 1), bystander(22, 's1', 2, 2)];
check('the blast takes the enemy AND the ally',
  A.martyrdomOwed(data, near)[0].targets, [21, 22]);
check('and never the corpse itself', A.martyrdomOwed(data, near)[0].targets.includes(20), false);
check('a unit out of range is not in it',
  A.martyrdomOwed(data, [zealot(), bystander(21, 's2', 30, 30)])[0].targets, []);
check('nor is one already destroyed',
  A.martyrdomOwed(data, [zealot(), { ...bystander(21, 's2', 1, 1), partStates: { main: 'destroyed' } }])[0].targets, []);
check('the range comes off the card, not a guess',
  A.martyrdomOwed(data, [zealot()])[0].range, data.byId.get('ZHDR-302').actions.find((x) => x.id === 'ZHDR-302_B').range);

// The Detonation panel's whole copy turns on this: 'all' means every unit in
// range takes a SEPARATE attack, 'single' means one of them does. Martyrdom
// prints its scope only in Chinese, so the English matcher cannot carry it.
check('Martyrdom reads as an all-units blast',
  A.explosionScope(data.byId.get('ZHDR-302').actions.find((x) => x.id === 'ZHDR-302_B')), 'all');

// ---------- Riposte / Reposte (050, ZHLA-202) ----------
//
// Asked about ONE SLOT, not about the Mech: "with this part" means the Parry
// has to have been declared on the Part that carries it.
const clawMech = (slot, id, states = {}) => ({
  uid: 8, kind: 'mech', side: 's1', col: 0, row: 0, stance: 'offensive',
  mech: { torso: '002', [slot]: id }, partStates: { torso: 'intact', [slot]: 'intact', ...states }, statuses: [],
});
check('the Combat Claw ripostes', A.ripostePart(data, clawMech('leftHand', 'ZHLA-202'), 'leftHand')?.name, 'Reposte');
// The two cards spell it differently, which is why the matcher reads the
// sentence and not the ability name.
check('and so does the Grappler, spelled the other way',
  A.ripostePart(data, clawMech('rightHand', '050'), 'rightHand')?.name, 'Riposte');
check('but only for the slot that holds it',
  A.ripostePart(data, clawMech('leftHand', 'ZHLA-202'), 'rightHand'), null);
check('a destroyed Part ripostes with nothing',
  A.ripostePart(data, clawMech('leftHand', 'ZHLA-202', { leftHand: 'destroyed' }), 'leftHand'), null);
check('a Part without the ability never does',
  A.ripostePart(data, clawMech('leftHand', '002'), 'leftHand'), null);
check('a Drone never does', A.ripostePart(data, { ...clawMech('leftHand', 'ZHLA-202'), kind: 'drone' }, 'leftHand'), null);

// ---------- The Coolers (002 Power, 532 System, 083 Laser) ----------
//
// None of the three carries gameRules, so all three are read off printed text
// and all three are checked against the shipped cards rather than a fixture.
const cooled = (torso, stance = 'offensive', states = {}) => ({
  uid: 30, kind: 'mech', side: 's1', col: 0, row: 0, stance,
  mech: { torso, chasis: '532' }, partStates: { torso: 'intact', chasis: 'intact', ...states }, statuses: [],
});
const coolShot = (over = {}) => ({ id: 'X', type: 'Firing', name: { en: 'Shot' }, keywords: [], ...over });
// A real Laser Weapon action off the board, so the keyword match is not assumed.
const laserAct = data.byId.get('160').actions.find((x) => x.id === '160_A');
check('Power Cooling adds a Yellow for every three',
  A.coolingBonus(data, cooled('002'), coolShot(), { red: 0, yellow: 6 }).yellow, 2);
check('and rounds down', A.coolingBonus(data, cooled('002'), coolShot(), { red: 0, yellow: 5 }).yellow, 1);
check('and gives nothing under three', A.coolingBonus(data, cooled('002'), coolShot(), { red: 0, yellow: 2 }).yellow, 0);
check('System Cooling does the same for Red',
  A.coolingBonus(data, cooled('002'), coolShot(), { red: 3, yellow: 0 }).red, 1);
// Both Coolers are on the same Mech above, so this also pins that they do not
// feed each other: each reads the PRINTED pool.
check('the two Coolers read the printed pool, not each other',
  A.coolingBonus(data, cooled('002'), coolShot(), { red: 3, yellow: 3 }), { red: 1, yellow: 1 });
check('neither works outside Offensive Stance',
  A.coolingBonus(data, cooled('002', 'defensive'), coolShot(), { red: 3, yellow: 6 }), { red: 0, yellow: 0 });
check('nor on a Melee Action',
  A.coolingBonus(data, cooled('002'), coolShot({ type: 'Melee' }), { red: 3, yellow: 6 }), { red: 0, yellow: 0 });
check('a destroyed Cooler cools nothing',
  A.coolingBonus(data, cooled('002', 'offensive', { torso: 'destroyed', chasis: 'destroyed' }), coolShot(), { red: 3, yellow: 6 }),
  { red: 0, yellow: 0 });
// 083 keys on the ACTION's keyword, which is printed in Chinese only.
check('the Laser Cooler adds a Yellow to a Laser Weapon Action',
  A.coolingBonus(data, { ...cooled('083'), mech: { torso: '083' }, partStates: { torso: 'intact' } }, laserAct, { red: 0, yellow: 1 }).yellow, 1);
check('and nothing to an Action without the keyword',
  A.coolingBonus(data, { ...cooled('083'), mech: { torso: '083' }, partStates: { torso: 'intact' } }, coolShot(), { red: 0, yellow: 1 }).yellow, 0);
check('it does not need Offensive Stance, because its card does not ask for one',
  A.coolingBonus(data, { ...cooled('083', 'defensive'), mech: { torso: '083' }, partStates: { torso: 'intact' } }, laserAct, { red: 0, yellow: 1 }).yellow, 1);
check('a Drone is never cooled', A.coolingBonus(data, { ...cooled('002'), kind: 'drone' }, coolShot(), { red: 3, yellow: 6 }), { red: 0, yellow: 0 });

// ---------- The Freehand Supports (ZHLA-303, 040) ----------
//
// NAMED, not applied: the Two-Handed Freehand designation is not tracked, and
// these follow MULTI_CONDITION's decision rather than inventing a second one.
const armed = (slot, id, type = 'Melee', states = {}) => ({
  uid: 31, kind: 'mech', side: 's1', col: 0, row: 0, stance: 'offensive',
  mech: { torso: '002', [slot]: id }, partStates: { torso: 'intact', [slot]: 'intact', ...states }, statuses: [],
});
const act = (type) => ({ id: 'X', type, name: { en: 'Swing' }, keywords: [] });
check('the Support Arm names its Red bonus on a Melee Action',
  /adds \+1R/.test(A.freehandSupportNote(data, armed('leftHand', 'ZHLA-303'), act('Melee'))), true);
// ZHLA-303 says Melee; 040 does not.
check('and says nothing on a Firing Action, because its card says Melee',
  A.freehandSupportNote(data, armed('leftHand', 'ZHLA-303'), act('Firing')), '');
check('the Supporting Arm names a Yellow bonus',
  /adds \+1Y/.test(A.freehandSupportNote(data, armed('leftHand', '040'), act('Melee'))), true);
check('and it is not limited to Melee',
  /adds \+1Y/.test(A.freehandSupportNote(data, armed('leftHand', '040'), act('Firing'))), true);
check('a destroyed arm supports nothing',
  A.freehandSupportNote(data, armed('leftHand', '040', 'Melee', { leftHand: 'destroyed' }), act('Melee')), '');
check('a Mech with neither says nothing',
  A.freehandSupportNote(data, armed('leftHand', '002'), act('Melee')), '');
check('a Drone never supports', A.freehandSupportNote(data, { ...armed('leftHand', '040'), kind: 'drone' }, act('Melee')), '');
// The two cards really do differ on colour, which is the thing worth pinning.
check('the two arms name different colours',
  /\+1R/.test(A.freehandSupportNote(data, armed('leftHand', 'ZHLA-303'), act('Melee')))
  && /\+1Y/.test(A.freehandSupportNote(data, armed('leftHand', '040'), act('Melee'))), true);

// ---------- White Dwarf Thruster (292) ----------
//
// The Ammo is a CONDITION, not a cost: the Bit stays launchable, so this is
// checked against the ammo bag rather than against anything being spent.
const dwarf = (ammo, states = {}) => ({
  uid: 32, kind: 'mech', side: 's1', col: 0, row: 0, stance: 'offensive',
  mech: { torso: '002', backpack: '292' },
  partStates: { torso: 'intact', backpack: 'intact', ...states }, statuses: [], ammo,
});
check('a loaded Bit turns Blue Lightning into Dodge', A.blueLightningDodges(data, dwarf({ '292_A': 1 })), true);
check('an empty one does not', A.blueLightningDodges(data, dwarf({ '292_A': 0 })), false);
check('and neither does a missing ammo bag', A.blueLightningDodges(data, dwarf({})), false);
check('a destroyed Bit Port offers nothing',
  A.blueLightningDodges(data, dwarf({ '292_A': 1 }, { backpack: 'destroyed' })), false);
check('a Mech without the Part never gets it',
  A.blueLightningDodges(data, { ...dwarf({ '292_A': 1 }), mech: { torso: '002' }, partStates: { torso: 'intact' } }), false);
check('a Drone never gets it', A.blueLightningDodges(data, { ...dwarf({ '292_A': 1 }), kind: 'drone' }), false);
// The condition names a DIFFERENT action on the same card -- the Bit, not the
// Passive that carries the rule.
check('the ammo condition points at the Bit, not at the Passive',
  data.byId.get('292').actions.find((x) => x.type === 'Passive').gameRules[0]
    .conditions.find((c) => c.type === 'action_storage_available').actionId, '292_A');

// ---------- Guidance Support (PDAM-006) ----------
//
// Driven with the REAL beacon and a REAL missile, because the whole gate is
// data-shaped: the Missile keyword lives in `inline` on the projectile's own
// card, not in key/en, and reading the wrong field matches nothing silently.
const beacon = (col, row) => ({
  uid: 40, kind: 'projectile', side: 's1', col, row, size: 1, cardId: 'PDAM-006',
  partStates: { main: 'intact' }, statuses: [], stance: 'offensive',
});
const missile = (side = 's1') => ({
  uid: 41, kind: 'projectile', side, col: 0, row: 0, size: 1, cardId: 'ZHAM-001A',
  partStates: { main: 'intact' }, statuses: [], stance: 'offensive',
});
const mark = (col, row) => ({
  uid: 42, kind: 'mech', side: 's2', col, row, size: 1,
  mech: { torso: '002' }, partStates: { torso: 'intact' }, statuses: [], stance: 'offensive',
});
const shot = (type = 'Firing') => ({ id: 'M', type, name: { en: 'Strike' }, keywords: [] });
const guide = (b, atk, def, a = shot()) => A.missileGuidance(data, [b, atk, def], atk, def, a).map((x) => x.uid);
check('a Beacon covering the target guides an allied Missile',
  guide(beacon(0, 0), missile(), mark(0, 0)), [40]);
// The Range is measured from the BEACON to the TARGET, not to the attacker.
check('and the Range is measured from the Beacon to the target',
  guide(beacon(0, 0), missile(), mark(33, 33)), []);
check('an enemy Beacon guides nothing', guide(beacon(0, 0), missile('s2'), mark(0, 0)), []);
check('and a Mech is not a Missile',
  A.missileGuidance(data, [beacon(0, 0), mark(0, 0)], mark(0, 0), mark(0, 0), shot()), []);
check('a Melee Action is out of scope, since the card names Firing and Tactic',
  guide(beacon(0, 0), missile(), mark(0, 0), shot('Melee')), []);
check('a Tactic is in scope', guide(beacon(0, 0), missile(), mark(0, 0), shot('Tactic')).length, 1);
check('a destroyed Beacon guides nothing',
  guide({ ...beacon(0, 0), partStates: { main: 'destroyed' } }, missile(), mark(0, 0)), []);
// The trap this one nearly shipped with.
check('the Missile keyword really is on the card as inline',
  (data.byId.get('ZHAM-001A').keywords ?? []).some((k) => k.inline === '导弹'), true);
check('and a projectile without it is not guided',
  guide(beacon(0, 0), { ...missile(), cardId: 'PDAM-006' }, mark(0, 0)), []);

// ---------- [Two-Handed] and the Freehand designation ----------
//
// Driven against every printed card that uses it, because the rider is parsed
// out of Chinese prose and one missed phrasing is a silently wrong Action.
const actOf = (cid, aid) => data.byId.get(cid).actions.find((x) => x.id === aid);
check('+2 Range is read', A.twoHandedRider(actOf('025', '025_A')).range, 2);
check('Mutilation is read', A.twoHandedRider(actOf('145', '145_B')).keywords, ['毁伤']);
// ZHRA-303 prints two on one line: "获得压制，毁伤".
check('and a two-item list is not truncated to the first',
  A.twoHandedRider(actOf('ZHRA-303', 'ZHRA-303_B')).keywords, ['压制', '毁伤']);
check('Sniper is read', A.twoHandedRider(actOf('516', '516_A')).keywords, ['狙击']);
check('Multi-Target 3 is read', A.twoHandedRider(actOf('038', '038_A')).keywords.includes('多目标3'), true);
check('and the Medium rider is read', A.twoHandedRider(actOf('129', '129_A')).medium, true);
check('an Action without the marker has no rider', A.twoHandedRider(actOf('002', '002_A') ?? { id: 'x' }), null);
// Every printed card is walked, so a phrasing none of the cases above covers
// still cannot slip through as "no rider at all".
const twoHanded = [...data.byId.values()].flatMap((c) => (c.actions ?? []))
  .filter((x) => /【双手】|\[双手\]/.test(`${x.description?.zh ?? ''}`))
  .filter((x) => !/作为空手被/.test(`${x.description?.zh ?? ''}`));
check('every printed [Two-Handed] Action yields a rider',
  twoHanded.filter((x) => !A.twoHandedRider(x)).map((x) => x.id), []);

// The adjusted Action, which is what actually gets rolled.
check('declining leaves the Action untouched',
  A.twoHandedAdjusted(actOf('025', '025_A'), false).range, actOf('025', '025_A').range);
check('designating adds the Range',
  A.twoHandedAdjusted(actOf('025', '025_A'), true).range, (actOf('025', '025_A').range ?? 0) + 2);
check('and appends the keyword the way every printed one is written',
  A.twoHandedAdjusted(actOf('145', '145_B'), true).keywords.some((k) => k.inline === '毁伤'), true);
check('the Medium rider changes the size', A.twoHandedAdjusted(actOf('129', '129_A'), true).size, 'm');
check('and the original card object is never mutated',
  (actOf('145', '145_B').keywords ?? []).some((k) => k.inline === '毁伤'), false);

// Multi-Target stops being advisory once the hand is really designated.
check('Multi-Target names its condition when undesignated',
  A.multiTargetLimit(actOf('038', '038_A'))?.condition !== null, true);
check('and drops it once designated', A.multiTargetLimit(actOf('038', '038_A'), true)?.condition, null);
check('but the limit is the same either way',
  A.multiTargetLimit(actOf('038', '038_A'), true)?.limit, A.multiTargetLimit(actOf('038', '038_A'))?.limit);

// What the designated Part gives back. Each of the four names a different
// Action type, and getting that wrong hands a Melee bonus to a rifle.
const holding = (slot, id) => ({
  uid: 50, kind: 'mech', side: 's1', col: 0, row: 0, stance: 'offensive',
  mech: { torso: '002', [slot]: id }, partStates: { torso: 'intact', [slot]: 'intact' }, statuses: [],
});
const thSwing = { id: 'M', type: 'Melee', name: { en: 'Swing' }, keywords: [] };
const thShot = { id: 'F', type: 'Firing', name: { en: 'Shot' }, keywords: [] };
check('the Support Arm gives +1R on a Melee', A.freehandSupport(data, holding('leftHand', 'ZHLA-303'), 'leftHand', thSwing)?.red, 1);
check('and nothing on a Firing Action', A.freehandSupport(data, holding('leftHand', 'ZHLA-303'), 'leftHand', thShot), null);
check('the Supporting Arm gives +1Y on either', A.freehandSupport(data, holding('leftHand', '040'), 'leftHand', thShot)?.yellow, 1);
check('Dynamic Equilibrium grants Omnidirectional Fire on a Firing Action',
  A.freehandSupport(data, holding('leftHand', '087'), 'leftHand', thShot)?.keywords, ['全向射击']);
check('Tracking Assist takes 2 Blue off the target',
  A.freehandSupport(data, holding('leftHand', '121'), 'leftHand', thShot)?.targetBlue, 2);
check('and neither of those fires on a Melee Action',
  A.freehandSupport(data, holding('leftHand', '121'), 'leftHand', thSwing), null);
check('a Part that supports nothing gives nothing',
  A.freehandSupport(data, holding('leftHand', '002'), 'leftHand', thSwing), null);

// The bug this reader shipped with for one commit: TM31RS and 539 carry the
// SAME reroll effect, gated on line of sight instead of the beacon's Range.
// Unknown keys used to be skipped, which offered those two as beacons for any
// allied shot anywhere on the board. An unimplemented condition must refuse.
const observer = (col, row, cardId) => ({
  uid: 43, kind: 'mech', side: 's1', col, row, size: 1, cardId,
  mech: { torso: '002' }, partStates: { torso: 'intact', main: 'intact' }, statuses: [], stance: 'offensive',
});
// Coordinated Observation is now IMPLEMENTED rather than refused, but only
// when a world is supplied: without terrain to look through, it still fails
// closed rather than assuming sight.
check('Coordinated Observation needs a world to judge sight, and refuses without one',
  A.missileGuidance(data, [observer(0, 0, 'TM31RS'), missile(), mark(0, 0)], missile(), mark(0, 0), shot()), []);
check('given a clear world it does grant the reroll',
  A.missileGuidance(data, [observer(0, 0, 'TM31RS'), missile(), mark(0, 0)], missile(), mark(0, 0), shot(), { terrain: [] }).map((x) => x.uid), [43]);
check('and 539 carries the same effect, so it lands too',
  A.missileGuidance(data, [observer(0, 0, '539'), missile(), mark(0, 0)], missile(), mark(0, 0), shot(), { terrain: [] }).length, 1);
// It is SIGHT, not Range: an observer far away still guides, where the Beacon
// would not -- which is the whole difference between the two cards.
check('sight does not care how far the observer is',
  A.missileGuidance(data, [observer(30, 30, 'TM31RS'), missile(), mark(0, 0)], missile(), mark(0, 0), shot(), { terrain: [] }).length, 1);
check('the real Beacon still works, so the guard did not block everything',
  A.missileGuidance(data, [beacon(0, 0), missile(), mark(0, 0)], missile(), mark(0, 0), shot()).length, 1);
check('and their condition really is the one not implemented',
  data.byId.get('TM31RS').actions.find((x) => x.type === 'Passive')
    .gameRules[0].effects[0].requireSourceLosToTarget, true);

// ---------- CQC (017) ----------
//
// The same freedom Flexible Timing grants, but from a SELF passive and scoped
// to Melee SHORT Actions -- so the scope is the whole of the test.
const cqcMech = (torso, states = {}) => ({
  uid: 60, kind: 'mech', side: 's1', col: 0, row: 0, stance: 'offensive',
  mech: { torso }, partStates: { torso: 'intact', ...states }, statuses: [],
});
const mShort = { id: 'a', type: 'Melee', size: 's', name: { en: 'Jab' } };
const mLong = { id: 'b', type: 'Melee', size: 'l', name: { en: 'Cleave' } };
const fShort = { id: 'c', type: 'Firing', size: 's', name: { en: 'Snap' } };
check('CQC frees a Melee short Action', A.cqcFlexible(data, cqcMech('017'), mShort), true);
check('but not a long one', A.cqcFlexible(data, cqcMech('017'), mLong), false);
check('and not a Firing Action, short or not', A.cqcFlexible(data, cqcMech('017'), fShort), false);
check('with no Action to judge it answers no, rather than over-granting',
  A.cqcFlexible(data, cqcMech('017')), false);
check('a Mech without it is never freed', A.cqcFlexible(data, cqcMech('002'), mShort), false);
check('a destroyed Part frees nothing', A.cqcFlexible(data, cqcMech('017', { torso: 'destroyed' }), mShort), false);
check('a Drone never gets it', A.cqcFlexible(data, { ...cqcMech('017'), kind: 'drone' }, mShort), false);
// It reaches the same gate the auras do, so no caller needed changing.
check('and it reaches the shared Flexible Timing gate',
  A.hasFlexibleTiming(data, [cqcMech('017')], cqcMech('017'), mShort), true);
check('which still says no for the Action it does not cover',
  A.hasFlexibleTiming(data, [cqcMech('017')], cqcMech('017'), mLong), false);

// ---------- The one-off riders (094, 095, 503, ZHDR-301, 533) ----------
//
// All five are read off printed text with no usable gameRules, so all five are
// driven against the shipped cards.
const wearing = (torso, states = {}) => ({
  uid: 61, kind: 'mech', side: 's1', col: 0, row: 0, stance: 'offensive',
  mech: { torso }, partStates: { torso: 'intact', ...states }, statuses: [],
});
check('094 ignores Low Profile', A.ignoresLowProfile(data, wearing('094')), true);
check('and a Mech without it does not', A.ignoresLowProfile(data, wearing('002')), false);
check('095 ignores Protection against a Highlight', A.ignoresProtectionOnHighlight(data, wearing('095')), true);
check('and 094 is not 095', A.ignoresProtectionOnHighlight(data, wearing('094')), false);
check('503 turns Eyes into Heavy Hits', A.eyesAreHeavyHits(data, wearing('503')), true);
check('ZHDR-301 has Dense Armor in prose', A.denseArmorByText(data, wearing('ZHDR-301')), true);
// The keyword-bearing cards must NOT also match the prose reader, or the two
// would both claim one card and the reasoning would be muddled.
check('and the keyword cards are left to denseArmorOn', A.denseArmorByText(data, wearing('002')), false);
check('533 cannot be Back-attacked in Melee', A.noMeleeBackAttack(data, wearing('533')), true);
check('a destroyed Part grants none of them',
  [A.ignoresLowProfile(data, wearing('094', { torso: 'destroyed' })),
   A.eyesAreHeavyHits(data, wearing('503', { torso: 'destroyed' })),
   A.noMeleeBackAttack(data, wearing('533', { torso: 'destroyed' }))], [false, false, false]);
check('and a Drone gets none of the Mech-only ones',
  [A.ignoresLowProfile(data, { ...wearing('094'), kind: 'drone' }),
   A.eyesAreHeavyHits(data, { ...wearing('503'), kind: 'drone' })], [false, false]);

// ---------- 538 Skimming is ALREADY wired, and this pins it ----------
//
// It was flagged as unwired by two separate audit sweeps and is not: both of
// its lines are covered. Asserted against the shipped card so a future sweep
// cannot cost anyone the same hour again.
const jp5 = data.byId.get('538').actions.find((x) => x.type === 'Passive');
check('the Move bonus line is the shape maneuverBonus reads',
  /(?:move\s*属性|机动距离|移动力)[^。\n]{0,20}?\+\s*(\d+)/i.test(jp5.description.zh), true);
check('and its Load restriction is the shape the Load reader reads',
  /无法作为负载/.test(jp5.description.zh), true);

// ---------- 164 ADK60R Raven Scout, Early Warning Observation ----------
//
// Deliberately NOT an aura, so it is driven directly: the card gates on the
// DEFENDER's stance and on the scout's sight of a THIRD unit, and aurasOn can
// express neither. Everything else it gates on — Range 3, "Ally Mech",
// Mobility Stance — is printed data, so the shipped card is the fixture.
const shooterAt = (uid, side, col, row, stance = 'offensive') => ({
  uid, side, kind: 'mech', col, row, size: 3, facing: 0, stance,
  mech: { torso: '002' }, partStates: { torso: 'intact' }, statuses: [], aerial: false,
});
const scoutAt = (uid, side, col, row, extra = {}) => ({
  uid, side, kind: 'drone', col, row, size: 1, facing: 0, cardId: '164',
  partStates: { main: 'intact' }, statuses: [], aerial: false, ...extra,
});
const wall164 = (c, r) => ({
  id: `w${c}${r}`, type: 'building', height: 3, blocksLos: true, providesProtection: true, isFragile: false,
  subCells: [0, 1, 2].flatMap((dc) => [0, 1, 2].map((dr) => ({ col: c * 3 + dc, row: r * 3 + dr }))),
});
const firingAt = { id: 'x', type: 'Firing', range: 12 };
const meleeAt = { id: 'y', type: 'Melee', range: 1 };

const gunman = shooterAt(70, 's2', 0, 9);                 // Large Grid (0,3)
const guarded = shooterAt(71, 's1', 30, 9, 'mobility');   // Large Grid (10,3)
const raven = scoutAt(72, 's1', 30, 0);                   // (10,0): exactly Range 3
const board164 = [gunman, guarded, raven];
// Smoke is the fifth argument and defaults to none, so every check below reads
// as "no smoke on the table"; the Smoke Screen cases are at the end of the file.
const covers = (tokens, terrain, defender = guarded, action = firingAt, smoke = []) =>
  A.earlyWarningCover(data, tokens, terrain, smoke, gunman, defender, action)?.uid ?? null;

check('a Raven Scout in Range with sight of the ATTACKER covers the Mech',
  covers(board164, []), 72);
check('and it answers with the drone itself, not a count (此效果不可叠加)',
  A.earlyWarningCover(data, board164, [], [], gunman, guarded, firingAt)?.kind, 'drone');
check('a second Scout adds nothing — the effect does not stack',
  A.earlyWarningCover(data, [...board164, scoutAt(73, 's1', 33, 0)], [], [], gunman, guarded, firingAt)?.kind, 'drone');
check('the card covers a Firing Action only',
  covers(board164, [], guarded, meleeAt), null);
check('and only a Mech in Mobility Stance',
  covers(board164, [], { ...guarded, stance: 'offensive' }), null);
check('a Drone is not an "Ally Mech", however well covered',
  covers([gunman, raven, { ...guarded, kind: 'drone', cardId: '164', partStates: { main: 'intact' } }], [],
    { ...guarded, kind: 'drone', cardId: '164', partStates: { main: 'intact' } }), null);
check('an enemy Scout covers nobody',
  covers([gunman, guarded, { ...raven, side: 's2' }], []), null);
check('a Scout still in reserve covers nobody',
  covers([gunman, guarded, { ...raven, deployed: false }], []), null);
check('nor does a wreck',
  covers([gunman, guarded, { ...raven, partStates: { main: 'destroyed' } }], []), null);
check('a Mech with no Scout beside it gets nothing',
  covers([gunman, guarded], []), null);

// The Range is the ACTION's 3, measured Scout -> defender.
check('Range 3 is the edge, and the edge is inside it',
  covers([gunman, guarded, scoutAt(74, 's1', 39, 9)], []), 74);
check('one Grid further and the cover is gone',
  covers([gunman, guarded, scoutAt(75, 's1', 42, 9)], []), null);
// That far Scout is looking at the gunman THROUGH the Mech it is covering.
check('an obstructed line is still a line — only BLOCKED hides the attacker',
  covers([gunman, guarded, scoutAt(76, 's1', 39, 9)], []), 76);

// The trap this reader exists to avoid: 539 Coordinated Observation measures
// source -> DEFENDER and reads almost the same in English. Blocking the wrong
// leg must change nothing.
check('sight to the ATTACKER is what matters: blocking it removes the cover',
  covers(board164, [wall164(5, 1), wall164(5, 2)]), null);
check('while blocking Scout -> defender changes nothing at all',
  covers(board164, [wall164(10, 2)]), 72);

// Data pins, so a regenerated cards.json cannot quietly unwire the card.
const raven164 = data.byId.get('164').actions.find((a) => a.type === 'Passive');
check('164_A still prints Range 3', raven164.range, 3);
check('and still prints the line both halves of the reader match',
  [/Attacker is visible to this drone/i.test(raven164.description.en ?? ''),
   /对攻击方有视线/.test(raven164.description.zh ?? '')], [true, true]);
check('and still prints "does not stack"', /此效果不可叠加/.test(raven164.description.zh ?? ''), true);
// A 'flying' base is NOT Aerial in token terms (isAerial reads 'elevated'), so
// the sight check is live for this drone rather than short-circuited to clear.
check('the Raven flies on a square base, which does not make it Aerial',
  [data.byId.get('164').flyingOrElevated, data.byId.get('164').category], ['flying', 'drone']);

// ---------- ZHDR-204 Misty Eagle, Feature Reduction ----------
//
// "When an enemy unit within range performs a Firing Action, the TARGET counts
// as having Low Profile." The aura is authored in action_overrides.json and is
// keyed on the SHOOTER, which is why it needs a kind of its own: under
// `low_profile` it would have landed on the Eagle's own side and buffed the
// enemy instead of hindering them.
const eagle = drone(80, 's2', 'ZHDR-204', 0);       // Large Grid (0,3)
const nearFoe = mech(81, 's1', '002', 15);          // (5,3): Range 5
const farFoe = mech(82, 's1', '002', 18);           // (6,3): Range 6
const eagleAlly = mech(83, 's2', '002', 15);
const marks = (t, world) => A.auraEffectsOn(data, world, t).has('target_counts_low_profile');

check('the Eagle marks an ENEMY shooter at Range 5', marks(nearFoe, [eagle, nearFoe]), true);
check('and not one a Grid beyond it', marks(farFoe, [eagle, farFoe]), false);
check('its own side is never marked — the card hinders, it does not help',
  marks(eagleAlly, [eagle, eagleAlly]), false);
check('and it grants no plain low_profile to anybody, which is the inversion',
  [A.auraEffectsOn(data, [eagle, nearFoe], nearFoe).has('low_profile'),
   A.auraEffectsOn(data, [eagle, eagleAlly], eagleAlly).has('low_profile')], [false, false]);
// 072 Decoy is the card that legitimately owns the ally-side kind. Both must
// keep working, or one of them has swallowed the other.
const decoy = drone(84, 's1', '072', 9);
const beside = mech(85, 's1', '002', 9);
check('072 Decoy still carries the ally-side kind',
  A.auraEffectsOn(data, [decoy, beside], beside).has('low_profile'), true);
check('and 072 never carries the shooter-side one',
  marks(beside, [decoy, beside]), false);

// Data pins for the override, since the rule lives outside cards.json.
const eagleAction = data.byId.get('ZHDR-204').actions.find((a) => a.type === 'Passive');
// Named for the card. The harness prints only the check name on failure, so
// two cards sharing a wording leave a CI line that cannot say which regressed.
check('ZHDR-204: the action_overrides aura reached the shipped action',
  eagleAction.gameRules?.[0]?.effects?.[0]?.effectTypes, ['target_counts_low_profile']);
check('ZHDR-204: aimed at the enemy, at any unit type, at the printed Range 5',
  [eagleAction.gameRules[0].effects[0].targetSide, eagleAction.gameRules[0].effects[0].targetUnitType, eagleAction.range],
  ['enemy', 'unit', 5]);

// ---------- ZHDR-206 Patrol Eagle, Dynamic Perception ----------
//
// "All actions of enemy units within range lose Silence." Enemy side, Range 3,
// any unit type — nothing but the gates aurasOn already applies — so the card is
// a structured aura plus a denial at the top of both Silence classifiers.
//
// HALF THE KEYWORD, and the checks say so rather than leaving the gap to be
// rediscovered as a bug. 4.12 Silence also KEEPS the acting unit's Low Profile
// Token, and that half does nothing here — but NOT because Low Profile is
// unmodelled, which is what this comment used to claim and is false: it is a
// full status with green decay in types.ts, printed faces in data.ts, and the
// attack helper counts it for the [Eye]->[Dodge] swap.
//
// Nor is it "nothing ever removes one", which is what the SECOND version of this
// comment claimed and is also false — Stabilize System, Tactics 277 and entering
// Optical Camouflage all shed one. Every one of those keys on shape 'hexagon'
// rather than on the name, so Silence is none of their business.
// What is genuinely missing is the one removal Silence exists to prevent: no
// Movement, facing change or Scan takes the Token off. types.ts already promises
// that removal, and whoever implements it is who must gate it on Silence.
const patrol = drone(90, 's2', 'ZHDR-206', 0);        // Large Grid (0,3)
// PL29 Stealth Chassis (180) carries 静默 on the CARD, which is the only way a
// Maneuver is ever Silent — so it is the only fixture that can show the aura
// taking Silence away rather than the unit never having had it.
const stealth = (uid, side, col) => ({
  uid, side, kind: 'mech', col, row: 9, size: 3, facing: 0,
  mech: { torso: '002', chasis: '180' }, partStates: { torso: 'intact', chasis: 'intact' },
});
const seen = stealth(91, 's1', 9);                    // (3,3): Range 3, the last Grid inside
const unseen = stealth(92, 's1', 12);                 // (4,3): one Grid clear
const silentAct = { id: 'X', description: { zh: '静默' } };

check('an enemy inside the Eagle Range loses Silence on a Silent Action',
  A.isSilentAction(data, [patrol, seen], seen, silentAct), false);
check('and keeps it one Large Grid further out',
  A.isSilentAction(data, [patrol, unseen], unseen, silentAct), true);
check('a live PL29 Maneuver is Silent outside the aura and not inside it (I2)',
  [A.maneuverIsSilent(data, [patrol, unseen], unseen), A.maneuverIsSilent(data, [patrol, seen], seen)],
  [true, false]);
check('with no Eagle on the board nothing is denied',
  [A.isSilentAction(data, [seen], seen, silentAct), A.maneuverIsSilent(data, [seen], seen)], [true, true]);

// Side, unit type and the source's own survival, one check each.
const patrolAlly = stealth(93, 's2', 9);
check('the Eagle never denies its own side',
  [A.isSilentAction(data, [patrol, patrolAlly], patrolAlly, silentAct),
   A.maneuverIsSilent(data, [patrol, patrolAlly], patrolAlly)], [true, true]);
const foeDrone = drone(94, 's1', '072', 9);
check('an enemy DRONE is denied too — the aura lands on any unit type',
  A.isSilentAction(data, [patrol, foeDrone], foeDrone, silentAct), false);
const wreck = { ...patrol, partStates: { main: 'destroyed' } };
check('a destroyed Eagle projects nothing',
  A.isSilentAction(data, [wreck, seen], seen, silentAct), true);
check('and the aura grants no Low Profile of its own: it denies, it does not give',
  A.auraEffectsOn(data, [patrol, seen], seen).has('low_profile'), false);

// THE TRAP THIS CARD IS BUILT AROUND: isSilentAction matches any Chinese action
// text containing 静默, and the Eagle's own printed line is 失去静默 — so a
// text-driven reading hands the card the very keyword it exists to strip. Both
// halves are pinned, because the day someone "simplifies" the aura back into a
// text scan these two are what catch it.
const perception = data.byId.get('ZHDR-206').actions.find((a) => a.id === 'ZHDR-206_A');
check('the Eagle still prints the phrase that fools a text scan',
  /失去静默/.test(perception.description.zh ?? ''), true);
check('and the classifier still reads that text as Silent, which is why the rule is structured',
  A.isSilentAction(data, [patrol], patrol, perception), true);

// Data pins for the override, since the rule lives outside cards.json.
check('ZHDR-206: the action_overrides aura reached the shipped action',
  perception.gameRules?.[0]?.effects?.[0]?.effectTypes, ['silence_denied']);
check('ZHDR-206: aimed at the enemy, at any unit type, at the printed Range 3',
  [perception.gameRules[0].effects[0].targetSide, perception.gameRules[0].effects[0].targetUnitType, perception.range],
  ['enemy', 'unit', 3]);
const deniers = cards.filter((c) => (c.actions ?? []).some((a) => (a.gameRules ?? [])
  .some((g) => (g.effects ?? []).some((e) => (e.effectTypes ?? []).includes('silence_denied')))));
check('and no other card in the set carries the kind, so nothing is swept up with it',
  deniers.map((c) => c.id), ['ZHDR-206']);

// ---------- 164 and the Smoke Screen (rulebook 4.16) ----------
//
// The card asks whether the ATTACKER is visible to the drone, and this engine's
// answer to "visible" for a Firing line is BOTH legs: `!smokeBlocks(...) &&
// losBetween(...) !== 'blocked'`. rules.ts writes it that way twice — losNote
// and protectionFor, the latter commented "Smoke removes line of sight
// outright". The first draft of earlyWarningCover asked losBetween alone, so a
// Smoke Screen anywhere on the scout's line left it seeing through the cloud
// and still lending the Blue. smokeBlocks is sliced in from the real rules.ts
// for these, so what is under test is the shipped model rather than a stub.
//
// The gunman is at Large Grid (0,3), the Raven at (10,0), the covered Mech at
// (10,3). smokeBlocks fires on either endpoint's own Grid or on the line, so
// all three placements are worth one check each.
const puff = (c, r) => ({ col: c, row: r, side: 's2' });

check('a Smoke Screen on the SCOUT\'s Grid blinds it, so the cover is gone',
  covers(board164, [], guarded, firingAt, [puff(10, 0)]), null);
check('and one on the ATTACKER\'s Grid does the same',
  covers(board164, [], guarded, firingAt, [puff(0, 3)]), null);
check('and one part way along the Scout -> attacker line does too',
  covers(board164, [], guarded, firingAt, [puff(5, 1)]), null);
// The whole point of measuring the RIGHT leg: smoke that only sits between the
// scout and the Mech it is covering is not on the line the card asks about.
check('while smoke on the Scout -> DEFENDER leg alone changes nothing',
  covers(board164, [], guarded, firingAt, [puff(10, 2)]), 72);
check('smoke somewhere else entirely is not the drone\'s problem',
  covers(board164, [], guarded, firingAt, [puff(3, 9)]), 72);
// Both legs of the model, not one: terrain still blocks with no smoke at all,
// and an empty smoke list must leave every check above this section standing.
check('with no smoke on the table the cover is back',
  covers(board164, [], guarded, firingAt, []), 72);

// ---------- A Maneuver OUT of the Patrol Eagle aura (FAQ O11/O15) ----------
//
// A Movement "is judged at the start and landing grids only", which is the same
// reading main.ts gives interceptsOwed six lines from the Silence check. Judged
// at the landing square alone, a unit that STARTED inside the aura and walked
// out was treated as though it had never been in it and got its Silence back.
//
// `seen` stands at Large Grid (3,3), the last Grid inside Range 3 of the Eagle
// at (0,3); `unseen` at (4,3) is one Grid clear of it. The `from` argument is
// the SAME unit at its old column, which is what the callers hand in.
const walkedOut = { ...unseen, col: 9 };    // started at (3,3), landed at (4,3)
const walkedIn = { ...seen, col: 12 };      // started at (4,3), landed at (3,3)
const stayedOut = { ...unseen, col: 15 };   // (5,3) -> (4,3), clear throughout
check('a Maneuver that STARTS inside the aura is denied, wherever it lands',
  A.maneuverIsSilent(data, [patrol, unseen], unseen, walkedOut), false);
check('and one that LANDS inside it is denied just as much',
  A.maneuverIsSilent(data, [patrol, seen], seen, walkedIn), false);
check('a Maneuver clear of the aura at both ends keeps its Silence',
  A.maneuverIsSilent(data, [patrol, unseen], unseen, stayedOut), true);
check('and a caller with no start position still judges the landing grid',
  [A.maneuverIsSilent(data, [patrol, seen], seen), A.maneuverIsSilent(data, [patrol, unseen], unseen)],
  [false, true]);

// ---------- The denial names its source ----------
//
// A camouflage that breaks with nothing named reads as a bug at the table,
// which is why AuraSource carries the projecting Token. Both classifiers hand
// back the whole AuraSource so a message can print unit AND ability.
const denial = A.silenceDenied(data, [patrol, seen], seen);
check('silenceDenied answers with the Eagle itself, not a bare boolean',
  [denial?.source?.uid, denial?.kinds], [90, ['silence_denied']]);
check('and carries the ability label the Reveal lines print beside it',
  typeof denial?.label === 'string' && denial.label.length > 0, true);
check('an Action denier is the same source',
  A.actionSilenceDenier(data, [patrol, seen], seen, silentAct)?.source?.uid, 90);
// The narrow half of this: an Action that never printed Silence must name
// NOBODY, or a plain Reveal blames a bystander for taking away what was never
// there. Same for a Maneuver by a Mech with no Silence-granting Part.
const plainAct = { id: 'P', keywords: [], description: { en: 'Silencer-brand ammo' } };
check('but an Action that never printed Silence blames nobody',
  A.actionSilenceDenier(data, [patrol, seen], seen, plainAct), undefined);
const noStealth = mech(95, 's1', '002', 9);
check('and neither does a Maneuver that had no Silence to lose',
  A.maneuverSilenceDenier(data, [patrol, noStealth], noStealth), undefined);
check('while the PL29 Maneuver inside the aura names the Eagle',
  A.maneuverSilenceDenier(data, [patrol, seen], seen)?.source?.uid, 90);
check('including when only the START grid was inside it',
  A.maneuverSilenceDenier(data, [patrol, unseen], unseen, walkedOut)?.source?.uid, 90);

// ---------- The call-site seams, read out of the sources ----------
//
// Everything above tests units.ts in isolation, which is exactly where these
// two cards CANNOT go wrong: both bugs available here are arguments passed at a
// call site, and no sliced-reader test can see one. Same reason and same shape
// as dodgedie.test.mjs, which reads the sources for a round trip that spans
// five files.
const combatSrc = readFileSync(new URL('../src/combat.ts', import.meta.url), 'utf8');
const mainSrc = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
const hudSrc = readFileSync(new URL('../src/matchhud.ts', import.meta.url), 'utf8');

// SEAM 1: ZHDR-204 is read off the ATTACKER. The line immediately below it
// genuinely does take the DEFENDER — that is the ordinary Low Profile aura,
// 072 Decoy's — so the two sit one line apart with different arguments, and
// swapping them silently hands the buff to the player it was meant to hinder.
// Both halves are pinned, because seeing only one of them is what makes the
// wrong one look right.
check('ZHDR-204 asks aurasOn about the ATTACKER',
  /aurasOn\(this\.data, this\.tokens\(\), c\.attacker\)[\s\S]{0,80}?'target_counts_low_profile'/.test(combatSrc), true);
check('and the reader on the next line still asks about the DEFENDER, which is the trap',
  /auraEffectsOn\(this\.data, this\.tokens\(\), c\.defender\)\.has\('low_profile'\)/.test(combatSrc), true);
check('nothing asks aurasOn about the defender for the ZHDR-204 kind',
  /aurasOn\(this\.data, this\.tokens\(\), c\.defender\)[\s\S]{0,80}?'target_counts_low_profile'/.test(combatSrc), false);

// SEAM 2: the +1 Blue is added ABOVE the Immobilized line, not below it. An
// Immobilized unit rolls no Blue at all, and a bonus added afterwards would
// survive the status whose whole job is to delete the pool. Adjacency is
// pinned, so moving either line past the other fails here.
check('the 164 Blue is added BEFORE Immobilized zeroes the pool',
  /if \(this\.earlyWarning\(\)\) blue \+= 1;\s+if \(statusCount\(d\.statuses, 'immobilized'\) > 0\) blue = 0;/.test(combatSrc), true);

// The three arguments the four reviewed defects were: a missing one each.
check('combat.ts feeds earlyWarningCover the smoke as well as the terrain (4.16)',
  /earlyWarningCover\(\s*this\.data,\s*this\.tokens\(\),\s*this\.terrain \? this\.terrain\(\) : \[\],\s*this\.smoke \? this\.smoke\(\) : \[\],/.test(combatSrc), true);
check('freeplay judges the Maneuver at the START grid as well (FAQ O11/O15)',
  /maneuverIsSilent\(data, state\.tokens, t, startPos\)/.test(mainSrc), true);
// The Match Centre sweeps at render time, so it has no start position in scope
// the way freeplay does. It reads one the maneuver command wrote down; all
// three links are pinned, because a break in any one of them leaves the rule
// right on the freeplay page and wrong on this one.
check('the Match Centre builds the start position from the Opportunity',
  /const from = sc\.opp\.movedFrom\s*\?\s*\{ \.\.\.t, col: sc\.opp\.movedFrom\.col, row: sc\.opp\.movedFrom\.row \}/.test(hudSrc), true);
check('and hands it to maneuverIsSilent, having no other copy of where the unit stood',
  /maneuverIsSilent\(ctx\.data, s\.tokens, t, from\)/.test(hudSrc), true);
check('and the maneuver command records it, or that sweep reads an empty field forever',
  (readFileSync(new URL('../src/commands.ts', import.meta.url), 'utf8').match(/movedFrom: from/g) ?? []).length, 2);

// ---------- ZHDR-101 Mobile Bunker, read off the shipped card ----------
//
// The exception to "only Large Units provide Unit Protection" (4.5.3). The text
// has no English in cards.json — action_translations.json carries the printed
// "May provide Unit Protection to Ally Units" — so the reader has to match the
// Chinese, which is why it is driven against the real database rather than a
// fixture with convenient prose in it.
const droneOf = (cardId, states = {}) => ({
  uid: 62, kind: 'drone', side: 's1', col: 0, row: 0, stance: 'defensive',
  cardId, partStates: { main: 'intact', ...states }, statuses: [],
});
check('ZHDR-101 provides Unit Protection to Allies', A.providesUnitProtectionToAllies(data, droneOf('ZHDR-101')), true);
// Without this the card is worth nothing: a Large Drone would already provide
// Unit Protection under the baseline, and only a medium one needs the printed
// exception. If the shipped stats ever say otherwise, the wiring is pointless.
check('and it is a medium Drone, which is the only reason the card does anything',
  data.byId.get('ZHDR-101').type, 'medium');
check('its sibling Vanguard does not provide it', A.providesUnitProtectionToAllies(data, droneOf('ZHDR-102')), false);
// 095 is the trap: its text names 单位保护 too, and says the opposite.
check('095 talks about Unit Protection and must not be read as providing it',
  A.providesUnitProtectionToAllies(data, wearing('095')), false);
check('a destroyed Part provides nothing', A.providesUnitProtectionToAllies(data, droneOf('ZHDR-101', { main: 'destroyed' })), false);
// A text reader over 400 cards is only as good as its false positives, so the
// whole database is swept: exactly one card may claim this.
check('and exactly one card in the shipped data provides it',
  cards.filter((c) => A.providesUnitProtectionToAllies(data, droneOf(c.id))).map((c) => c.id), ['ZHDR-101']);

// ---------- EW Suppression, the Strength -1 on a Counter-roll ----------
//
// PDTR-202_B: "Enemy units within range suffer Strength -1 when making
// Electronic Counter Rolls. This effect does not stack." ZHDR-202_B prints the
// same rule in Chinese and Japanese only. This is the pool a unit ROLLS, not
// the Electronic Value printed on its Parts, which is why electronicStrength
// exists beside electronicValue rather than inside it: 4.11.2's "an Electronic
// Value of 0 cannot Initiate" gate reads the STAT and must not see the aura.
//
// Regression guard for BUG-3. The Match Centre's counter-roll had its own copy
// of this arithmetic with the aura missing, so both cards were dead in every
// match while freeplay honoured them.
const ewMech = mech(70, 's1', '174', 9);           // P22 "Hunter" EW Core, Electronic 4
const watchdog = drone(71, 's2', 'ZHDR-202', 12);  // aura Range 4, 1 Large Grid away
const chanceII = mech(72, 's2', 'PDTR-202', 12);   // the same aura on a torso
const ewWorld = [ewMech, watchdog];

check('the printed Electronic Value is untouched by the aura',
  A.electronicValue(data, ewMech), 4);
check('but the pool it ROLLS is one lower inside an enemy EW Suppression aura',
  A.electronicStrength(data, ewWorld, ewMech, 'responder'), 3);
check('and the Initiator is hit by it just the same — the aura names units, not roles',
  A.electronicStrength(data, ewWorld, ewMech, 'initiator'), 3);
// Range 4 aura: col 9 is Large Grid 3, col 27 is Grid 9, so six apart.
check('out of the aura Range it rolls the printed value',
  A.electronicStrength(data, [ewMech, drone(71, 's2', 'ZHDR-202', 27)], ewMech, 'responder'), 4);
check('the same aura printed on a Mech torso reaches just as far',
  A.electronicStrength(data, [ewMech, chanceII], ewMech, 'responder'), 3);
// "This effect does not stack" — two sources are still -1, never -2.
check('two sources do not stack',
  A.electronicStrength(data, [ewMech, watchdog, chanceII], ewMech, 'responder'), 3);
// targetSide is "enemy", so a Watchdog never weakens its own side.
const ewAlly = mech(73, 's2', '174', 9);
check('an ally standing in it is untouched',
  A.electronicStrength(data, [ewAlly, watchdog], ewAlly, 'responder'), 4);
// The clamp. ZYBP-101 is a Backpack worth 1, so a Mech wearing only that would
// otherwise be asked to roll -1 dice.
const thinMech = { uid: 74, side: 's1', kind: 'mech', col: 9, row: 9, size: 3, facing: 0,
  mech: { backpack: 'ZYBP-101' }, partStates: { backpack: 'intact' } };
check('an Electronic Value of 1 is dropped to 0, never below it',
  A.electronicStrength(data, [thinMech, watchdog], thinMech, 'responder'), 0);
// A destroyed Part carries no aura, which aurasOn already enforces — pinned
// here because it is the difference between a live rule and a dead drone.
const deadWatchdog = { ...watchdog, partStates: { main: 'destroyed' } };
check('a destroyed Watchdog suppresses nothing',
  A.electronicStrength(data, [ewMech, deadWatchdog], ewMech, 'responder'), 4);
// The whole database is swept, so a data edit that spreads this aura to a third
// card has to come back through this test rather than silently changing pools.
const suppressors = cards.filter((c) => (c.actions ?? []).some((a) => (a.gameRules ?? [])
  .some((g) => (g.effects ?? []).some((e) => (e.effectTypes ?? []).includes('electronic_contest_strength_penalty')))));
check('exactly two cards in the shipped data carry EW Suppression',
  suppressors.map((c) => c.id).sort(), ['PDTR-202', 'ZHDR-202']);

// ---------- Warfare Node X, no longer "blocked" ----------
// This rule sat recorded as "defined nowhere, needs the Rules Supplement" for
// months while the glossary specified it completely (06_missions_and_appendix
// :451): allies within range MAY use the node Mech's Electronic value + X on
// their Counter-rolls; it never changes initiator or responder; and FAQ Q4 adds
// that allies include the node itself. Card 018 Aurora: EV 3, Warfare Node 1,
// Passive range 4.
{
  const aurora = mech(80, 's1', '018', 9);
  const weak = mech(81, 's1', '172', 12);   // torso 172, printed EV lower than the node offers
  const own = A.electronicValue(data, weak);
  check('the fixture ally really is weaker than the node', own < 4, true);
  check('inside the range it rolls the node EV + X',
    A.electronicStrength(data, [aurora, weak], weak, 'responder'), 4);
  check('the printed stat is untouched, so the 4.11.2 initiate gate still reads it',
    A.electronicValue(data, weak), own);
  // FAQ Q4: allies include the unit itself.
  check('the Aurora itself rolls its own EV + 1',
    A.electronicStrength(data, [aurora], aurora, 'responder'), 4);
  // A MAY: a node weaker than the ally changes nothing.
  const strong = mech(82, 's1', '174', 12); // EV 4, the node offers 4 - no worse, no better
  check('a node never lowers a stronger ally',
    A.electronicStrength(data, [aurora, strong], strong, 'responder'), 4);
  // Out of the Passive's range 4 the ally is on its own. col 27 is six Grids off.
  check('out of range the ally rolls its own value',
    A.electronicStrength(data, [aurora, mech(81, 's1', '172', 27)], mech(81, 's1', '172', 27), 'responder'), own);
  // An enemy node offers nothing.
  check('an enemy node is not yours to borrow',
    A.electronicStrength(data, [mech(80, 's2', '018', 9), weak], weak, 'responder'), own);
  // The Suppression aura lands on whatever is rolled: the node substitutes the
  // BASE and the -1 still applies, because the aura names the roll, not the stat.
  const watchdogHere = drone(83, 's2', 'ZHDR-202', 12);
  check('an enemy Suppression aura still lands on a node-boosted roll',
    A.electronicStrength(data, [aurora, weak, watchdogHere], weak, 'responder'), 3);
  // A destroyed Aurora torso is a dead node.
  const deadAurora = { ...mech(80, 's1', '018', 9), partStates: { torso: 'destroyed' } };
  check('a destroyed node Part offers nothing',
    A.electronicStrength(data, [deadAurora, weak], weak, 'responder'), own);
}

console.log(`\n${pass} passed, ${fail} failed\n`);
if (fail) process.exit(1);
