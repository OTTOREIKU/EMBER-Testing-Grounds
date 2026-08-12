// Flying Movement granted by a Part (PDBP-201 Ojs200, and the 117/119 Fairy pair).
//
// Two cards offer Flying Movement on genuinely different terms and a single
// boolean cannot carry both: the Ojs200 says the Maneuver "may" be Flying, the
// Fairy pair says movement "will be". Flying cannot Crush (FAQ E14), so turning
// the optional one on automatically would spend a choice the card gives away.
//
// Every string below is the PRINTED text, verified against the English scans of
// 117/119, the UN 1.02 parts list and the PD 1.02 revision PDF.
import { readFileSync, writeFileSync } from 'node:fs';

const src = readFileSync(new URL('../src/units.ts', import.meta.url), 'utf8');
const start = src.indexOf('// ---------- Flying Movement granted by a Part');
// The Loads banner sits BELOW the flight block. End markers that precede their
// start silently slice nothing and every assertion then passes on an empty
// module, which is why this pair is asserted rather than assumed.
const end = src.indexOf('// ---------- Tarantula Loads');
if (start < 0 || end < 0 || end <= start) throw new Error('could not slice flightGrant out of units.ts');

const tmp = new URL('./_flight.slice.ts', import.meta.url);
writeFileSync(tmp, `type GameData = any;
type Token = any;
type Card = any;
type PartSlot = any;
type LoanedPart = any;
const tokenCards = (data, t) => t.kind === 'mech'
  ? Object.entries(t.mech ?? {}).map(([slot, id]) => ({ slot, card: data.byId.get(id) })).filter((x) => x.card)
  : [{ slot: 'main', card: data.byId.get(t.cardId) }].filter((x) => x.card);
` + src.slice(start, end));
const { flightGrant, isAirborneAction } = await import(tmp.href);

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}, got ${g}`); }
};

const passive = (en, zh, gameRules) => ({ type: 'Passive', description: { en, zh }, gameRules });

// PDBP-201 verbatim, publisher's "considerd" typo included.
const OJS_EN = "· This mech's Maneuver may be considerd as Flying.";
const OJS_ZH = '· 本机的调整移动可视为飞行移动。';
// 117 and 119 verbatim, each naming the other hand.
const FAIRY_L = `· If the mech is equipped with this part and MDXS "Fairy" System + R6 SMG (R), it's movement will be considered as Flying.`;
const FAIRY_R = `· If the mech is equipped with this part and MDXS "Fairy" System + R6 SMG (L), it's movement will be considered as Flying.`;

const data = {
  byId: new Map([
    ['TORSO', { id: 'TORSO' }],
    ['CHASSIS', { id: 'CHASSIS', move: 1 }],
    ['OJS', { id: 'OJS', actions: [passive(OJS_EN, OJS_ZH, [{ id: 'adjust_move_as_flight', effects: [{ type: 'adjust_move_as_flight' }] }])] }],
    // The same card with its text stripped: the gameRule alone must still carry it.
    ['OJS_RULE_ONLY', { id: 'OJS_RULE_ONLY', actions: [passive('', '', [{ id: 'adjust_move_as_flight' }])] }],
    // ...and with the rule stripped, so the printed text alone carries it too.
    ['OJS_TEXT_ONLY', { id: 'OJS_TEXT_ONLY', actions: [passive(OJS_EN, '', undefined)] }],
    ['OJS_ZH_ONLY', { id: 'OJS_ZH_ONLY', actions: [passive('', OJS_ZH, undefined)] }],
    ['FAIRY_L', { id: 'FAIRY_L', actions: [passive(FAIRY_L, '', undefined)] }],
    ['FAIRY_R', { id: 'FAIRY_R', actions: [passive(FAIRY_R, '', undefined)] }],
    // 118/120, the (D) faces, print the same passive on the publisher's list.
    ['FAIRY_L_D', { id: 'FAIRY_L_D', actions: [passive(FAIRY_L, '', undefined)] }],
    // The RL-08's Jet Dash, the card that broke the loose version of the E21
    // Maneuver-bonus reader. A Moving Action describing its own reach must not
    // read as a standing grant of anything.
    ['JETDASH', { id: 'JETDASH', actions: [{ type: 'Moving', description: { en: '· [Moving in Straight Line] +2 grids.' } }] }],
    // A Passive that merely mentions flying without granting it.
    ['RADAR', { id: 'RADAR', actions: [passive('· May exchange a die when targeting a Flying unit.', '', undefined)] }],
    ['DRONECARD', { id: 'DRONECARD' }],
  ]),
};

const mech = (mechParts, partStates = {}) => ({ kind: 'mech', mech: { torso: 'TORSO', chasis: 'CHASSIS', ...mechParts }, partStates });

check('a bare Mech grants no flight', flightGrant(data, mech({})), 'none');
check('an Ojs200 offers it on the Maneuver', flightGrant(data, mech({ backpack: 'OJS' })), 'maneuver');
check('the gameRule alone is enough', flightGrant(data, mech({ backpack: 'OJS_RULE_ONLY' })), 'maneuver');
check('the printed English alone is enough', flightGrant(data, mech({ backpack: 'OJS_TEXT_ONLY' })), 'maneuver');
check('the Chinese alone is enough', flightGrant(data, mech({ backpack: 'OJS_ZH_ONLY' })), 'maneuver');

// The pair condition is the whole point of the Fairy: one arm is not a grant.
check('one Fairy arm grants nothing', flightGrant(data, mech({ leftHand: 'FAIRY_L' })), 'none');
check('the other Fairy arm alone grants nothing', flightGrant(data, mech({ rightHand: 'FAIRY_R' })), 'none');
check('both Fairy arms fly every move', flightGrant(data, mech({ leftHand: 'FAIRY_L', rightHand: 'FAIRY_R' })), 'always');
check('a (D) face still counts as a half', flightGrant(data, mech({ leftHand: 'FAIRY_L_D', rightHand: 'FAIRY_R' })), 'always');

// A wrecked Part grants nothing, the rule every other Part-borne effect follows.
check('a destroyed Ojs200 grants nothing', flightGrant(data, mech({ backpack: 'OJS' }, { backpack: 'destroyed' })), 'none');
check('a destroyed Fairy arm breaks the pair', flightGrant(data, mech({ leftHand: 'FAIRY_L', rightHand: 'FAIRY_R' }, { leftHand: 'destroyed' })), 'none');

// The false positives that the guards exist for.
check('a Moving Action describing its own reach is not a grant', flightGrant(data, mech({ leftHand: 'JETDASH' })), 'none');
check('merely naming Flying is not a grant', flightGrant(data, mech({ backpack: 'RADAR' })), 'none');

// A Load is the Mech's own Part while it acts (FAQ O3), and the Ojs200 is a
// Backpack - so a Carrier Tarantula in Contact can hand a Mech its wings.
check('an Ojs200 lent by a Tarantula counts', flightGrant(data, mech({}), [{ slot: 'load:9', card: data.byId.get('OJS') }]), 'maneuver');
check('a lent Ojs200 needs no backpack slot of its own', flightGrant(data, mech({ backpack: 'RADAR' }), [{ slot: 'load:9', card: data.byId.get('OJS') }]), 'maneuver');

// Maneuver is Mech-only, so a Drone is never offered this.
check('a Drone grants nothing', flightGrant(data, { kind: 'drone', cardId: 'DRONECARD', partStates: {} }), 'none');

// ---------- Airborne Movement (空中移动), the ACTION-level grant ----------
//
// "This Action is considered as Flying." Seven cards carry it, all on a Moving
// Action. Read off the KEYWORD because three of the seven print no English at
// all - matching on text would silently cover four of seven and look fine.
const airborne = (extra = {}) => ({ type: 'Moving', keywords: [{ inline: '空中移动' }], ...extra });

check('a Jump tagged Airborne Movement is Flying', isAirborneAction(airborne()), true);
check('the English keyword form counts too', isAirborneAction({ type: 'Moving', keywords: [{ en: 'Airborne Movement' }] }), true);
check('the key field counts too', isAirborneAction({ type: 'Moving', keywords: [{ key: '空中移动' }] }), true);
check('a Moving Action without it is not Flying', isAirborneAction({ type: 'Moving', keywords: [{ inline: '不可阻挡' }] }), false);
check('an Action with no keywords at all is not Flying', isAirborneAction({ type: 'Moving' }), false);
// The type guard: a movement keyword parked on something that is not a
// Movement grants nothing, the same shape of guard as the Maneuver bonus.
check('the keyword on a Firing Action grants nothing', isAirborneAction({ type: 'Firing', keywords: [{ inline: '空中移动' }] }), false);
check('the keyword on a Passive grants nothing', isAirborneAction({ type: 'Passive', keywords: [{ inline: '空中移动' }] }), false);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
