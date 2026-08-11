// Maneuver Value and the Mobility Stance doubling (rulebook 4.1, 3.4, 4.3.1).
//
// Mobility doubles "the Movement Range for Maneuver", and Maneuver is Mech-only:
// only a Mech generates a Maneuver Tick, the Maneuver Value is printed on a
// Chassis Card, and 4.3.1 lists a Drone's movement separately as a Command
// Action. Doubling a Drone's printed Move moved 18 of the 44 Drones at twice
// their range, so this is pinned.
import { readFileSync, writeFileSync } from 'node:fs';

const src = readFileSync(new URL('../src/units.ts', import.meta.url), 'utf8');
// From the Maneuver-bonus block, NOT from maneuverRange: the E21 bonus reader
// and its two regexes sit above it and are what maneuverRange now calls.
const start = src.indexOf('// ---------- Maneuver bonuses from Parts');
const end = src.indexOf('export function initiativeFor');
// The Silence classifiers ride in the same slice: they only need tokenCards,
// which this harness mirrors below.
const silStart = src.indexOf('// ---------- Silence');
const silEnd = src.indexOf('export function canActivateCamo');
if (start < 0 || end < 0) throw new Error('could not locate maneuverRange in units.ts');
const tmp = new URL('./_maneuver.slice.ts', import.meta.url);
writeFileSync(tmp, `type GameData = any;
type Token = any;
type CardAction = any;
type PartSlot = any;
const tokenCards = (data, t) => t.kind === 'mech'
  ? Object.entries(t.mech ?? {}).map(([slot, id]) => ({ slot, card: data.byId.get(id) })).filter((x) => x.card)
  : [{ slot: 'main', card: data.byId.get(t.cardId) }].filter((x) => x.card);
` + src.slice(silStart, silEnd) + src.slice(start, end));
const { maneuverRange, maneuverBonus, isSilentAction, maneuverIsSilent } = await import(tmp.href);

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}, got ${g}`); }
};

const data = {
  byId: new Map([
    ['CH1', { id: 'CH1', move: 1 }],
    ['CH2', { id: 'CH2', move: 2 }],
    ['DRN', { id: 'DRN', move: 6 }],
    ['NOMOVE', { id: 'NOMOVE' }],
    // An ordinary Core prints no Move; only a TRANSFORMED one does. Modelled on
    // White Dwarf: card 287 the Core Part, 288 the Cruise Mode core at Move 3,
    // 289 the Chassis Part at Move 1.
    ['CORE', { id: 'CORE' }],
    ['CRUISE', { id: 'CRUISE', move: 3 }],
    // The JP5 Mobility Enhancement Pack (538) verbatim: a Passive naming the
    // Move ATTRIBUTE of the lower limbs.
    ['JP5', { id: 'JP5', actions: [{ type: 'Passive', description: { en: "· The Move attribute of this mech's lower limbs +1." } }] }],
    // The FAQ paraphrases the same card as "Maneuver distance ... +1", so a
    // future printing in those words has to read the same.
    ['JP5ALT', { id: 'JP5ALT', actions: [{ type: 'Passive', description: { en: '· The Maneuver distance of this mech +1.' } }] }],
    // The RL-08's Jet Dash: a MOVING action whose own reach grows, not a
    // standing Maneuver bonus. The loose first version of the reader took it.
    ['JETDASH', { id: 'JETDASH', move: 1, actions: [{ type: 'Moving', range: 3, description: { en: '· [Moving in Straight Line]+2 grids.' } }] }],
  ]),
};
const mech = (chasis, stance, torso = 'CORE') => ({ kind: 'mech', stance, mech: { chasis, torso }, cardId: 'ignored' });
const drone = (stance, cardId = 'DRN') => ({ kind: 'drone', stance, cardId });

console.log('Maneuver Value and Mobility Stance\n');

// A Mech reads its Chassis Card, and Mobility doubles it.
check('a mech maneuvers on its chassis value', maneuverRange(data, mech('CH2', 'offensive')), 2);
check('and mobility stance doubles that', maneuverRange(data, mech('CH2', 'mobility')), 4);
check('the common maneuver 1 doubles to 2', maneuverRange(data, mech('CH1', 'mobility')), 2);
check('defensive stance changes nothing', maneuverRange(data, mech('CH2', 'defensive')), 2);
check('nor does shutdown', maneuverRange(data, mech('CH2', 'shutdown')), 2);
check('a chassis with no printed move is 0', maneuverRange(data, mech('NOMOVE', 'mobility')), 0);
check('a mech with no chassis at all is 0', maneuverRange(data, { kind: 'mech', stance: 'mobility', mech: {} }), 0);

// A Drone reads its own card and is NEVER doubled: it has no Chassis Card, no
// Maneuver Tick and no Maneuver Value, so there is nothing for 4.1 to double.
check('a drone moves its printed range', maneuverRange(data, drone('offensive')), 6);
check('and mobility stance does NOT double it', maneuverRange(data, drone('mobility')), 6);
check('a defensive drone is unchanged too', maneuverRange(data, drone('defensive')), 6);
// Projectiles are in the same boat as Drones on this.
check('a mobility projectile is not doubled', maneuverRange(data, { kind: 'projectile', stance: 'mobility', cardId: 'DRN' }), 6);

// A destroyed Chassis cannot carry the Mech anywhere (3.4.4, FAQ E4) — only
// the free change of Facing remains, and that costs no range.
check('a destroyed chassis moves nothing (E4)', maneuverRange(data, { ...mech('CH2', 'offensive'), partStates: { chasis: 'destroyed' } }), 0);
check('even in mobility stance (E4)', maneuverRange(data, { ...mech('CH2', 'mobility'), partStates: { chasis: 'destroyed' } }), 0);
check('a damaged chassis still moves', maneuverRange(data, { ...mech('CH2', 'offensive'), partStates: { chasis: 'damaged' } }), 2);


// ---------- Silence (FAQ I2/I5/I18) ----------
check('a common-action silence flag is silent', isSilentAction({ id: 'X', silence: true }), true);
check('the printed keyword is silent', isSilentAction({ id: 'X', keywords: [{ key: '静默' }] }), true);
check('the zh text alone still counts', isSilentAction({ id: 'X', description: { zh: '静默 action' } }), true);
check('a plain action is not silent', isSilentAction({ id: 'X', keywords: [], description: { en: 'Silencer-brand ammo' } }), false);
const stealthData = { byId: new Map([['ST', { id: 'ST', keywords: [{ key: '静默', en: 'Silence' }] }], ['T1', { id: 'T1' }]]) };
check('a live Silence part makes the maneuver silent (I2)', maneuverIsSilent(stealthData, { kind: 'mech', mech: { chasis: 'ST', torso: 'T1' }, partStates: {} }), true);
check('a destroyed Silence part does not (I2)', maneuverIsSilent(stealthData, { kind: 'mech', mech: { chasis: 'ST', torso: 'T1' }, partStates: { chasis: 'destroyed' } }), false);

// ---------- E23: a transformed core carries its own Movement ----------
//
// White Dwarf's Cruise Mode core prints Move 3 while its Chassis Part prints 1.
// Reading the chassis regardless walked a Cruise White Dwarf at 1 instead of 3.
// The torso only wins WHEN IT HAS a Move value, which in the whole box is the
// Cruise core alone — every one of the 21 chassis carries one, and 288 is the
// only torso that does, so this cannot catch an ordinary Mech.
check('a Cruise core moves on its own value, not the legs',
  maneuverRange(data, mech('CH1', 'offensive', 'CRUISE')), 3);
check('and E23 doubles it in Mobility like anything else',
  maneuverRange(data, mech('CH1', 'mobility', 'CRUISE')), 6);
check('an ordinary Core still leaves the chassis in charge',
  maneuverRange(data, mech('CH2', 'offensive', 'CORE')), 2);
// E4 is the explicit rule and is deliberately NOT excepted for Cruise Mode:
// nothing in the FAQ says a transformed core flies on a wrecked chassis.
check('a destroyed chassis still grounds a Cruise core (E4)',
  maneuverRange(data, { kind: 'mech', stance: 'mobility', mech: { chasis: 'CH1', torso: 'CRUISE' }, partStates: { chasis: 'destroyed' } }), 0);

// ---------- E21: a Part bonus joins the base BEFORE Mobility doubles ----------
//
// The whole ruling is the order. With the LM231 Standard Chassis at Move 1 and
// the JP5 Pack fitted, Mobility Stance gives (1+1)x2 = 4 — the FAQ names
// 1x2+1 = 3 as the WRONG answer, so the two are pinned against each other.
const packed = (stance, backpack = 'JP5', chasis = 'CH1') =>
  ({ kind: 'mech', stance, mech: { chasis, torso: 'CORE', backpack }, cardId: 'ignored', partStates: {} });

check('the JP5 Pack adds 1 to the Chassis Move', maneuverRange(data, packed('offensive')), 2);
check('and Mobility doubles the TOTAL: (1+1)x2 = 4 (E21)', maneuverRange(data, packed('mobility')), 4);
// State the rejected reading outright, so a regression cannot look plausible.
check('not 1x2+1 = 3, which E21 names as wrong', maneuverRange(data, packed('mobility')) !== 3, true);
check('the FAQ wording of the same card reads identically',
  maneuverRange(data, packed('mobility', 'JP5ALT')), 4);

// Jet Dash is a Moving ACTION with its own Range 3 (and the subject of E16).
// Counting it as a Maneuver bonus gave every RL-08 two free Grids.
check('a Moving action bonus is NOT a Maneuver bonus',
  maneuverBonus(data, packed('offensive', 'JETDASH')), 0);
check('so an RL-08 still maneuvers on its chassis alone',
  maneuverRange(data, packed('offensive', 'JETDASH')), 1);

// A wrecked Pack grants nothing, like every other Part-borne rule here.
check('a destroyed Pack grants no bonus',
  maneuverRange(data, { ...packed('offensive'), partStates: { backpack: 'destroyed' } }), 1);
// A Mech with no bonus Part is untouched — the ordinary case must not move.
check('an ordinary Mech is unchanged', maneuverRange(data, mech('CH2', 'mobility')), 4);
// A Drone has no Parts to carry one.
check('a Drone gets no Part bonus', maneuverBonus(data, drone('mobility')), 0);
// E23 meets E21: a transformed core moves on its OWN value and the legs are out
// of the picture, so the bonus to the lower limbs does not ride along.
const cruisePacked = { kind: 'mech', stance: 'offensive', mech: { chasis: 'CH1', torso: 'CRUISE', backpack: 'JP5' }, cardId: 'x', partStates: {} };
check('a Cruise core does not stack the lower-limb bonus', maneuverRange(data, cruisePacked), 3);

// The box itself: exactly one card grants this today, and 538 rides in the
// RDL/UN starter preset, which is why the missing bonus was wrong in the first
// squad a new player loads. A second card appearing should be noticed.
const raw = JSON.parse(readFileSync(new URL('../../data/cards.json', import.meta.url), 'utf8'));
const cards = Array.isArray(raw) ? raw : raw.cards ?? [];
const granters = cards.filter((c) => (c.actions ?? []).some((a) => a.type === 'Passive'
  && /(?:Move\s+attribute|Maneuver(?:\s+distance)?)[^.\n]{0,40}?\+\s*\d/i.test(a.description?.en ?? '')));
check('exactly one card grants a Maneuver bonus', granters.map((c) => String(c.id)), ['538']);
// And the real card, through the real reader, at the real number.
const realData = { byId: new Map(cards.map((c) => [String(c.id), c])) };
check('the real JP5 on a real chassis reads (1+1)x2 = 4',
  maneuverRange(realData, { kind: 'mech', stance: 'mobility', cardId: '539',
    mech: { torso: '539', chasis: '099', backpack: '538' }, partStates: {} }),
  (realData.byId.get('099')?.move ?? 0) * 2 + 2);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
