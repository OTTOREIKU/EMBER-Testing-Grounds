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

// ---------- Ammo Delivery (086_B RKG70 Ammunition Pack) ----------
//
// Driven off the REAL cards, because the whole point of this reader is that the
// Pack->Pod link is structural (086_A's resupply names 129_A) rather than
// hardcoded. If the publisher ever renames either action these break, which is
// the intent.
const raw = JSON.parse(readFileSync(new URL('../../data/cards.json', import.meta.url), 'utf8'));
const all = Array.isArray(raw) ? raw : raw.cards;
const byId = new Map(all.map((c) => [String(c.id), c]));
const realData = { cardsOf: (t) => Object.entries(t.mech ?? {}).map(([slot, id]) => ({ slot, card: byId.get(id) })).filter((x) => x.card) };
const gunner = (ammo, states = {}) => ({
  kind: 'mech', mech: { leftHand: '129', backpack: '086' },
  partStates: { leftHand: 'intact', backpack: 'intact', ...states }, ammo,
});
// The structural link the reader depends on, asserted directly so a rename is
// caught here rather than as a silently dead passive.
check('086_A really does name 129_A as the action it refills',
  U.resupplyOf(byId.get('086').actions.find((x) => x.id === '086_A')).actionId, '129_A');
check('and 086_B really does print the delivery phrase',
  /可选择消耗本部件的弹药/.test(byId.get('086').actions.find((x) => x.id === '086_B').description.zh), true);

check('an empty Pod may be paid from the Pack',
  U.ammoDeliveryPool(realData, gunner({ '129_A': 0, '086_A': 2 }), '129_A'), '086_A');
check('an empty Pack offers nothing',
  U.ammoDeliveryPool(realData, gunner({ '129_A': 0, '086_A': 0 }), '129_A'), undefined);
check('a destroyed Pack delivers nothing',
  U.ammoDeliveryPool(realData, gunner({ '129_A': 0, '086_A': 2 }, { backpack: 'destroyed' }), '129_A'), undefined);
check('a Mech without the Pack has no second pool',
  U.ammoDeliveryPool(realData, { kind: 'mech', mech: { leftHand: '129' }, partStates: { leftHand: 'intact' }, ammo: { '129_A': 0 } }, '129_A'),
  undefined);
check('it pays only for the action the Pack actually refills',
  U.ammoDeliveryPool(realData, gunner({ '129_A': 0, '086_A': 2 }), 'SOMETHING_ELSE'), undefined);
check('a Drone never delivers',
  U.ammoDeliveryPool(realData, { ...gunner({ '129_A': 0, '086_A': 2 }), kind: 'drone' }, '129_A'), undefined);

// ---------- Covert carry: lock_one (008_A, PRDR-105_B) ----------
//
// Exactly two actions in the shipped set carry it, and the reader is asserted
// against both rather than a fixture.
const lockCards = all.filter((c) => (c.actions ?? []).some((a) => a.projectileSelection?.mode === 'lock_one'));
check('exactly two cards lock a Projectile choice', lockCards.map((c) => String(c.id)).sort(), ['008', 'PRDR-105']);
check('008_A locks', U.covertCarryLock(byId.get('008').actions.find((x) => x.id === '008_A')), true);
check('PRDR-105_B locks', U.covertCarryLock(byId.get('PRDR-105').actions.find((x) => x.id === 'PRDR-105_B')), true);
check('an ordinary Projectile action does not',
  U.covertCarryLock(byId.get('129').actions.find((x) => x.id === '129_A')), false);
// The printed-text arm, so a card the generator missed still locks.
check('the printed phrase alone is enough',
  U.covertCarryLock({ description: { zh: '本机在游戏开始前，秘密携带1枚B3系列信标。' } }), true);
check('and an unrelated action is untouched', U.covertCarryLock({ description: { zh: '发射1个导弹组。' } }), false);
// 008 really does print three options and PRDR-105 two, which is what makes the
// lock worth anything.
check('008 offers three beacons before it commits', byId.get('008').projectile.length, 3);
check('PRDR-105 offers two walls', byId.get('PRDR-105').projectile.length, 2);

// ---------- A CANCELLED ATTACK GIVES THE CHARGE BACK (4.14) ----------
// OTTO from live play: "I am attacking a mech and my weapon gains mutilation if
// I use a charge token. I choose the attack action, it prompts me to use a
// charge token, I say yes, then when choosing the unit to attack I realize they
// are out of range. So I hit cancel and then my charge token never gets
// refunded so I am without a charge token now even though I didnt go through
// with the attack."
//
// The spend HAS to land before the targeting -- the Charge is what the Action is
// being performed with, and both pages offer it first -- so the only honest fix
// is to undo it when the attack is abandoned. Both pages carry the spent slot on
// the pending targeting and hand it back at the cancel.
//
// Source-level, because this is handler wiring in matchhud.ts and main.ts rather
// than a helper the harness can slice and call.
{
  const hud = readFileSync(new URL('../src/matchhud.ts', import.meta.url), 'utf8');
  const app = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');

  // --- the Match Centre ---
  // The signature grew a shockAsked flag when Shock Attack joined the door
  // (shockattack.test.mjs); the refund parameter is the part this pins.
  check('the targeting can be opened with a Charge to refund',
    /function openAttackPick\(t: Token, a: CardAction, refund\?: \{ uid: number; slot: string \}, shockAsked = false\)/.test(hud), true);
  check('and both kinds of targeting carry it',
    (hud.match(/(attackPick|ewPick) = \{ uid: t\.uid, actionId: a\.id, refund \}/g) ?? []).length, 2);
  // Only a SPEND is refundable. Charging a Part face-up is an Action in its own
  // right, and handing that back on a cancel would be inventing a token.
  check('only a spend is recorded as refundable',
    /openAttackPick\(t, next, m\.on \? undefined : \{ uid: t\.uid, slot \}\)/.test(hud), true);
  const cancels = hud.match(/refundCharge\(ctx, (attackPick|ewPick)\?\.refund\)/g) ?? [];
  check('and both cancels give it back', cancels.length, 2);
  check('the refund puts the token FACE-UP again',
    /kind: 'setCharge'[^\n]*slot: refund\.slot, on: true/.test(hud), true);

  // THE GUARD THAT MATTERS MOST. Refunding a token that was legitimately spent
  // is worse than failing to refund one, because it hands back a resource the
  // rules already took. The success path must never call it.
  const commit = hud.slice(hud.indexOf("on('[data-attacktarget]'"), hud.indexOf("on('[data-act=\"attackcancel\"]'"));
  check('and pressing a TARGET refunds nothing', /refundCharge\(/.test(commit), false);

  // --- freeplay ---
  check('freeplay records the spend on the targeting it paid for',
    /pendingAttack\.refund = \{ slot: found\.slot \}/.test(app), true);
  // The offer is fire-and-forget, so by the time it answers the player may have
  // moved on to a different Action entirely.
  check('and only when the targeting is still the one that asked',
    /pendingAttack\?\.attackerUid === t\.uid && pendingAttack\.actionId === actionId/.test(app), true);
  check('freeplay refunds when the targeting is CANCELLED',
    /const back = cancelled \? pendingAttack\?\.refund : null/.test(app), true);
  check('and puts it back face-up', /setCharge\(owner, back\.slot, true\)/.test(app), true);
  // endTargeting runs on the successful path too, which is exactly why the
  // refund is gated on `cancelled` rather than on the token being present.
  const ends = app.slice(app.indexOf('function endTargeting('), app.indexOf('function endTargeting(') + 900);
  check('the refund is inside the cancelled branch and nowhere else',
    (ends.match(/setCharge\(owner, back\.slot, true\)/g) ?? []).length, 1);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
