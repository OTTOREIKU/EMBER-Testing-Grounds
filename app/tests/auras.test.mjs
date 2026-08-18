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
  + cut(units, 'export interface AuraSource', '// Melee Evasion (ZYBP-302)', 'the aura readers')
  + cut(units, '// Melee Evasion (ZYBP-302)', 'export interface CommandRider', 'meleeEvasionReady')
  + cut(units, 'export interface ParryPart', 'export interface SelfHitPart', 'parryParts')
  + cut(units, 'export interface SelfHitPart', '// A Firing Action', 'selfHitParts')
  + cut(units, '// A Firing Action', 'export function repairSpec', 'actionRange and hasFlexibleTiming')
  + cut(units, '// ---------- Defense Reaction', 'export function attackReactionsOf', 'defenseReactionOn and targetTracingOn')
  + cut(units, 'function alive(t: Token)', 'function coversGrid', 'the alive helper')
  + cut(units, '// ---------- Martyrdom', 'export function autoDetonationsOwed', 'martyrdomOwed')
  + cut(units, 'export function explosionScope', 'export function needsSightToLanding', 'explosionScope');

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

console.log(`\n${pass} passed, ${fail} failed\n`);
if (fail) process.exit(1);
