// Checks the Charge token economy, Resupply targeting and Explosion scope
// (rulebook 4.14, 4.13 and 4.7.6).
import { readFileSync, writeFileSync } from 'node:fs';

const src = readFileSync(new URL('../src/units.ts', import.meta.url), 'utf8');
const start = src.indexOf('export interface Resupply');
const end = src.indexOf('export function needsSightToLanding');
if (start < 0 || end < 0) throw new Error('could not locate the charge helpers in units.ts');
const tmp = new URL('./_charge.slice.ts', import.meta.url);
writeFileSync(
  tmp,
  `type CardAction = any;\ntype Token = any;\ntype GameData = any;\ntype PartSlot = any;
const SLOT_LABEL: any = { torso: 'Torso', chasis: 'Chassis', leftHand: 'L.Arm', rightHand: 'R.Arm', backpack: 'Pack', main: 'Hull' };
const tokenCards = (data: any, t: any) => data.cardsOf(t);
` + src.slice(start, end),
);
const U = await import(tmp.href);

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}, got ${g}`); }
};

console.log('Charge, Resupply and Explosion scope\n');

// ---------- which Actions carry the Charge Icon ----------

const charged = { gameRules: [{ consumesCharge: true, conditions: [{ type: 'charge_available' }], effects: [] }] };
const conditionOnly = { gameRules: [{ conditions: [{ type: 'charge_available' }] }] };
const chargeAction = { gameRules: [{ effects: [{ type: 'set_unit_charge', amount: 1 }] }] };
check('an action flagged consumesCharge is chargeable', U.consumesCharge(charged), true);
check('so is one that only names the condition', U.consumesCharge(conditionOnly), true);
check('a plain action is not', U.consumesCharge({ gameRules: [{ effects: [{ type: 'gain_keyword' }] }] }), false);
check('and neither is one with no rules', U.consumesCharge({}), false);
check('the Charge Action itself is recognised', U.isChargeAction(chargeAction), true);
check('as is the Common Action', U.isChargeAction({ id: 'COMMON_CHARGE' }), true);
check('a chargeable action is not the Charge Action', U.isChargeAction(charged), false);

// ---------- the token on a Part ----------

const mech = (extra = {}) => ({
  uid: 1, kind: 'mech', label: 'Alpha', ammo: {},
  partStates: { torso: 'intact', chasis: 'intact', leftHand: 'intact', rightHand: 'intact' },
  cards: [
    { slot: 'torso', card: { actions: [charged] } },
    { slot: 'rightHand', card: { actions: [charged] } },
    { slot: 'leftHand', card: { actions: [{ gameRules: [] }] } },
  ],
  ...extra,
});
const data = { cardsOf: (t) => t.cards ?? [] };

check('a fresh unit holds no face-up token', U.isCharged(mech(), 'torso'), false);
check('a charged slot reads back', U.isCharged(mech({ charge: ['torso'] }), 'torso'), true);
check('and does not leak to another slot', U.isCharged(mech({ charge: ['torso'] }), 'rightHand'), false);

// Only Parts that actually carry a Chargeable Action are offered.
check('only chargeable parts are listed', U.chargeableSlots(data, mech()).map((x) => x.slot), ['torso', 'rightHand']);
check('their state comes back with them', U.chargeableSlots(data, mech({ charge: ['rightHand'] })).map((x) => x.charged), [false, true]);
check('a destroyed part drops off', U.chargeableSlots(data, mech({ partStates: { torso: 'destroyed', rightHand: 'intact' } })).map((x) => x.slot), ['rightHand']);
check('labels come through for the picker', U.chargeableSlots(data, mech()).map((x) => x.label), ['Torso', 'R.Arm']);

// ---------- Resupply ----------

const supply = { gameRules: [{ effects: [{ type: 'resupply_action_ammo', actionId: '129_A', amount: 1, targetSide: 'self_or_ally', range: 1 }] }] };
check('a resupply action is read', U.resupplyOf(supply), { actionId: '129_A', amount: 1, range: 1, allies: true });
check('self-only is flagged', U.resupplyOf({ gameRules: [{ effects: [{ type: 'resupply_action_ammo', actionId: 'X', targetSide: 'self' }] }] }),
  { actionId: 'X', amount: 1, range: 0, allies: false });
check('an ordinary action has none', U.resupplyOf({ gameRules: [{ effects: [{ type: 'gain_keyword' }] }] }), undefined);
check('and an empty one has none', U.resupplyOf({}), undefined);
check('a rule with no actionId is ignored', U.resupplyOf({ gameRules: [{ effects: [{ type: 'resupply_action_ammo' }] }] }), undefined);

// ---------- Explosion scope ----------

// Card 155 hits everything in reach; card 154 hits one unit.
check('all units within range reads as an area attack', U.explosionScope({ description: { en: '· On Detonation, all units within range gain 1 Fire Control Interference Token.' } }), 'all');
check('target unit reads as a single attack', U.explosionScope({ description: { en: '· On Detonation, cause Explosion damage to target unit.' } }), 'single');
// The printed English wins over the Chinese here too.
check('printed english beats the chinese', U.explosionScope({ description: { zh: '对所在格的所有单位造成爆炸伤害。', en: 'cause Explosion damage to target unit.' } }), 'single');
check('chinese is read when there is no english', U.explosionScope({ description: { zh: '对所在格的所有单位造成爆炸伤害。' } }), 'all');
check('a supplied translation counts as english', U.explosionScope({ description: { zh: '所有单位' } }, 'damage to target unit'), 'single');
check('an action with no text is single', U.explosionScope({}), 'single');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
