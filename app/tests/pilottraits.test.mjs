// Phase-7 pilot traits, driven against the REAL cards.json and the REAL
// dice.json.
//
// Pilots carry no actions and no gameRules, so every one of these rules is
// dispatched on the CARD ID and the only assertion worth making is the paired
// one: the rule fires for the pilot who prints it, and does NOT fire for a
// pilot who does not. A fixture pilot would pass against a reader keyed on the
// wrong card, which is the exact failure this file exists to catch — so the
// pilots are the shipped ones and the negative control is a real pilot too.
//
// The tally methods live inside combat.ts's AttackHelper, which cannot be
// imported (it wants the DOM), so they are sliced into a thin class shim below.
// The dice faces are the shipped ones: red face 7 and yellow face 6 are a solid
// {Eye}, which is what makes these rolls reachable in a real game at all.
import { readFileSync, writeFileSync } from 'node:fs';

const src = (f) => readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8');
const combat = src('combat.ts'), units = src('units.ts'), types = src('types.ts'), ticks = src('ticks.ts');
const rules = src('rules.ts');
const cut = (s, a, b, what) => {
  const i = s.indexOf(a), j = s.indexOf(b);
  if (i < 0 || j < 0 || j <= i) throw new Error(`could not locate ${what}`);
  return s.slice(i, j);
};

// The AttackHelper's tally block, from countIcons down to (not including)
// resolve(). Everything in that range is pure arithmetic over the roll plus the
// readers below; nothing in it touches the DOM or `this.multi`.
const tally = cut(combat, '  private countIcons(roll: Rolled[]', '  private resolve()', 'the attack tally in combat.ts');

const body = `
type Rolled = any; type Ctx = any; type DieColor = any; type Token = any; type GameData = any;
type Card = any; type CardAction = any; type PartSlot = any; type Timing = any;
type TerrainPiece = any; type SmokeScreen = any; type CounterRoll = any;
export function tokenCards(data: any, t: any): any[] {
  const out: any[] = [];
  for (const slot of ['torso', 'chasis', 'leftHand', 'rightHand', 'backpack']) {
    const id = t.mech?.[slot]; const c = id ? data.byId.get(id) : undefined;
    if (c) out.push({ slot, card: c });
  }
  // The PILOT slot is emitted here exactly as the real tokenCards emits it,
  // purely for FIDELITY with the shipped shape. It pins nothing on its own, and
  // an earlier version of this comment claimed otherwise: partSays reads only
  // \`card.actions[].description\`, and NO pilot card in cards.json carries an
  // actions array, so a pilot slot can never match a Part regex whether or not
  // partSays guards it. The guard is still load-bearing -- but what drives it is
  // autoshield.test.mjs, which seats an actions-bearing DRONE card in the pilot
  // slot. That file fails when the guard is deleted; this one does not.
  const p = t.mech?.pilot ? data.byId.get(t.mech.pilot) : undefined;
  if (p) out.push({ slot: 'pilot', card: p });
  if (t.kind !== 'mech') { const c = data.byId.get(t.cardId); if (c) out.push({ slot: 'main', card: c }); }
  return out;
}
`
  // The REAL Large-Grid measurement, because "within 3 grids" is a rule and a
  // mirrored Manhattan sum here could drift from the one the app applies.
  + cut(rules, 'export function largeGridOf', '// Where inside Large Grid', 'largeGridOf')
  + cut(rules, 'export function rangeBetween', 'export function inArc', 'rangeBetween')
  // The REAL line of sight, because "has line of sight to the target" IS the
  // Tracking rule. Disjoint from the rangeBetween cut above (losBetween ends
  // where rangeBetween begins).
  + cut(rules, 'export function losBetween', 'export function rangeBetween', 'losBetween')
  + cut(types, 'export function statusCount', 'export const STATUSES', 'statusCount')
  // The tracer's Offensive-Stance treatment, SLICED rather than stubbed: the
  // attack-icon math this file drives now asks it, and a stub answering
  // stance-only would quietly test a pipeline the shipped one no longer is.
  + cut(units, 'export function treatedAsOffensive', '// ---------- DISARM', 'treatedAsOffensive')
  + cut(ticks, 'export const TIMING_OF_TYPE', 'export const LENGTH_OF_SIZE', 'TIMING_OF_TYPE')
  + cut(ticks, 'export function timingOf', '// An Action only costs Ticks', 'timingOf')
  // The REAL partSays, because its `if (slot === 'pilot') continue;` is the one
  // line stopping card 503's regex from matching LPA-24 Sealock's own Chinese
  // trait text. A stub would hide that guard, which is precisely the landmine
  // the phase-7 plan records.
  + cut(units, '// A shared helper: does any live Part on this unit print', '// 094 Multispectral Tracking', 'partSays')
  + cut(units, '// 503 Close Assault: firing at a target within range', '// ZHDR-301 Dense Armor Hand', 'eyesAreHeavyHits')
  + cut(units, 'export function lightningExchangeOf', 'export function lightningLinkDrain', 'lightningExchangeOf')
  // ZPA-37's spotter count, with the REAL line-of-sight and the REAL 4.16 smoke
  // test underneath it — the whole rule is "can this drone see that unit", and
  // a stubbed answer would test nothing. losBetween is sliced above; smokeKey
  // and smokeBlocks come with it. Overlap-checked against every cut here: this
  // range sits between eyesAreHeavyHits (~1203) and pilotCard (~2761).
  + cut(rules, 'export function smokeKey', 'export function smokeAt', 'smokeKey')
  + cut(rules, 'export function smokeBlocks', 'export interface LargeGrid', 'smokeBlocks')
  + cut(units, "// ---------- ZPA-37 Foxhound's 寻踪 Tracking", '// ---------- Repeaters (FAQ O19/O20) ----------', 'trackingCover')
  // LPA-21's stealth test, with the REAL aura reader under it: Low Profile has
  // two sources and one of them is an ally's aura, so a stub would test half
  // the rule. Runs from AuraSource down to auraValueOn — the same range
  // auras.test.mjs takes, checked to be disjoint from every cut above.
  + cut(units, 'export interface AuraSource', '// EVERY one of these auras prints', 'the aura readers and phasesThroughUnits')
  // pilotCard, maxLink and the whole phase-7 predicate block, sliced rather
  // than mirrored: WHICH pilot a rule answers to is the rule.
  + cut(units, 'export function pilotCard', '// A Mech Maneuvers at the Maneuver Value', 'the pilot readers')
  + `
export class Helper {
  data: any;
  dice: any;
  constructor(data: any, dice: any) { this.data = data; this.dice = dice; }
${tally}
}
`;

const tmp = new URL('./_pilottraits.slice.ts', import.meta.url);
writeFileSync(tmp, body);
const A = await import(tmp.href);

const rawCards = JSON.parse(readFileSync(new URL('../../data/cards.json', import.meta.url), 'utf8'));
const cards = Array.isArray(rawCards) ? rawCards : rawCards.cards;
const byId = new Map(cards.map((c) => [String(c.id), c]));
const data = { byId };
const dice = JSON.parse(readFileSync(new URL('../../data/dice.json', import.meta.url), 'utf8'));

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}, got ${g}`); }
};
const pilot = (id) => {
  const c = byId.get(id);
  if (!c) throw new Error(`pilot ${id} is missing from cards.json`);
  if (c.category !== 'pilot') throw new Error(`${id} is not a pilot card`);
  return c;
};

console.log('\nPilot traits, against the shipped cards and dice\n');

// ---------- FPA-04 Hammerhead — 猛攻 Fierce Assault ----------
//
// "[Offensive Stance] Melee Action may exchange {Eye} for {Light Hit}."
{
  const hammerhead = pilot('FPA-04');
  // The negative control is a real RDL pilot of the same level whose trait is a
  // Structure floor, so it can never accidentally satisfy an icon rule.
  const anser = pilot('FPA-05');
  check('FPA-04 is the Fierce Assault card', hammerhead.trait, '猛攻');
  check('and the printed English is the one this reader was written against',
    /\[Offensive Stance\][\s\S]*Melee Action[\s\S]*\{Eye\}[\s\S]*\{Light Hit\}/.test(hammerhead.traitDescription.en), true);
  // The curator's annotation is a second opinion on the reading, never the
  // dispatcher — see the note on Card.traitEffects.
  check('and the curated effect agrees with that reading',
    hammerhead.traitEffects?.map((e) => e.type), ['melee_offensive_eye_to_light_optional']);

  const helper = new A.Helper(data, dice);
  const mech = (uid, pilotId, over = {}) => ({
    uid, side: uid === 1 ? 's1' : 's2', kind: 'mech', label: `M${uid}`, col: 3, row: 3, size: 3, facing: 0,
    stance: 'offensive', mech: { torso: '002', pilot: pilotId }, partStates: { torso: 'intact' }, ...over,
  });
  const melee = { id: 'X_A', type: 'Melee', size: 'm', name: { en: 'Punch' } };
  const firing = { id: 'X_B', type: 'Firing', size: 'm', name: { en: 'Shot' } };
  // red face 7 and yellow face 6 are both a solid {Eye} in the shipped dice.
  const eyes = [{ color: 'red', face: 7 }, { color: 'yellow', face: 6 }];
  const ctx = (attackerPilot, action, over = {}) => ({
    attacker: mech(1, attackerPilot), defender: mech(2, 'FPA-05'),
    action, attackRoll: eyes, eyeSwaps: 0, ...over,
  });

  const on = helper.attackIcons(ctx('FPA-04', melee));
  check('FPA-04 turns every leftover {Eye} into a Light Hit on a Melee Action',
    [on.eye ?? 0, on.lightHit ?? 0, on.heavyHit ?? 0], [0, 2, 0]);

  const off = helper.attackIcons(ctx('FPA-05', melee));
  check('a pilot without the trait leaves the Eyes alone',
    [off.eye ?? 0, off.lightHit ?? 0], [2, 0]);

  const shot = helper.attackIcons(ctx('FPA-04', firing));
  check('and it does not reach a Firing Action', [shot.eye ?? 0, shot.lightHit ?? 0], [2, 0]);

  const defensive = helper.attackIcons(ctx('FPA-04', melee, { attacker: mech(1, 'FPA-04', { stance: 'mobility' }) }));
  check('nor a Melee Action outside Offensive Stance', [defensive.eye ?? 0, defensive.lightHit ?? 0], [2, 0]);

  // ---------- the ordering ruling ----------
  //
  // {Eye}->{Heavy Hit} is strictly better than {Eye}->{Light Hit}, so a heavy
  // source must win the race for a given {Eye}. A Chef-style paid swap is the
  // cheapest way to put a heavy claim on the same icons.
  const paid = helper.attackIcons(ctx('FPA-04', melee, { eyeSwaps: 1 }));
  check('a heavy source takes its {Eye} first, and only the rest go Light',
    [paid.heavyHit ?? 0, paid.lightHit ?? 0, paid.eye ?? 0], [1, 1, 0]);
  const bothPaid = helper.attackIcons(ctx('FPA-04', melee, { eyeSwaps: 2 }));
  check('and with enough heavy claims Fierce Assault gets nothing',
    [bothPaid.heavyHit ?? 0, bothPaid.lightHit ?? 0], [2, 0]);

  // ---------- the audit's Trap #1: the per-die replay ----------
  //
  // Dodge Enhancement offsets whole DICE, so every swap has to be replayed
  // per-die or a swapped icon belongs to no die and can never be cancelled.
  check('the per-die tally replays Fierce Assault',
    helper.attackIconsPerDie(ctx('FPA-04', melee)), [{ heavy: 0, light: 1 }, { heavy: 0, light: 1 }]);
  check('and without the trait the same dice carry nothing',
    helper.attackIconsPerDie(ctx('FPA-05', melee)), [{ heavy: 0, light: 0 }, { heavy: 0, light: 0 }]);
  check('the per-die heavy claim wins the same race the totals do',
    helper.attackIconsPerDie(ctx('FPA-04', melee, { eyeSwaps: 1 })), [{ heavy: 1, light: 0 }, { heavy: 0, light: 1 }]);

  // The free arm was NOT replayed per-die before this phase: card 503 Close
  // Assault swaps every {Eye} without touching c.eyeSwaps, so its Heavy Hits
  // belonged to no die at all. Driven off the real card, not a fixture.
  const closeAssault = byId.get('503');
  check('503 Close Assault is still the card whose text drives the free swap',
    A.eyesAreHeavyHits(data, { kind: 'mech', mech: { torso: '503' }, partStates: { torso: 'intact' } }), true);
  const free = ctx('FPA-05', melee, {
    attacker: { ...mech(1, 'FPA-05'), mech: { torso: '503', pilot: 'FPA-05' } },
  });
  check('a 503 attacker gets its free {Eye}->{Heavy Hit} in the totals',
    [helper.attackIcons(free).heavyHit ?? 0, helper.attackIcons(free).eye ?? 0], [2, 0]);
  check('and now in the per-die breakdown too, so Dodge Enhancement can reach it',
    helper.attackIconsPerDie(free), [{ heavy: 1, light: 0 }, { heavy: 1, light: 0 }]);
  if (!closeAssault) throw new Error('card 503 is missing from cards.json');
}

// ---------- 027 AC-32M Marksman Rifle — 点射 Single Shot ----------
//
// "{Eye} counts as {2 Light Hit}" (zh: {眼睛}视为{2轻击}) — the only exchange in
// the box that pays MORE than one icon for a die, and the last of the eleven
// {Eye} cards to get a reader at all.
//
// A Part, not a pilot, so it does not belong to this file by subject. It lives
// here because this is where the attack-icon harness is, and the block above
// already drives card 503 off the real cards.json for exactly that reason.
{
  const helper = new A.Helper(data, dice);
  const rifle = byId.get('027');
  if (!rifle) throw new Error('card 027 is missing from cards.json');
  const single = (rifle.actions ?? [])[0];

  check('027 is the Marksman Rifle, and Single Shot is the Action that prints the clause',
    [rifle.name.en, single.id, single.type], ['AC-32M Marksman Rifle', '027_A', 'Firing']);
  check('and the printed text is the one this reader was written against',
    [/\{眼睛\}视为\{2轻击\}/.test(single.description.zh),
      /\{Eye\}[^.]*2 \{Light Hit\}/.test(single.description.en)], [true, true]);

  // The RATE is the whole point of the reader: a boolean could not say "2".
  check('the reader returns the rate, not a verdict', A.eyeLightExchangeOf(single), 2);
  check('and 0 for an Action that prints no exchange',
    A.eyeLightExchangeOf({ id: 'X_B', type: 'Firing', description: { en: 'Shoot it.', zh: '射击。' } }), 0);
  // A rate-1 sentence must buy nothing here: FPA-04 prints the same wording
  // without a digit, and a reader that took it would put two claims on one
  // {Eye}. This does NOT pin the \d+ spelling -- \d* returns 0 too, since the
  // capture would be '' and Number('') is 0. What it pins is that a bare match
  // is not defaulted to 1, which is the mutation that would actually break it.
  check('a rate-1 sentence buys no exchange from this reader',
    A.eyeLightExchangeOf({ id: 'X_C', type: 'Melee', description: { zh: '·【攻击姿态】近战动作{眼睛}视为{轻击}。', en: '' } }), 0);

  const mech027 = (uid, over = {}) => ({
    uid, side: uid === 1 ? 's1' : 's2', kind: 'mech', label: `M${uid}`, col: 3, row: 3, size: 3, facing: 0,
    stance: 'offensive', mech: { torso: '002', rightHand: '027', pilot: 'FPA-05' },
    partStates: { torso: 'intact', rightHand: 'intact' }, ...over,
  });
  const eyes = [{ color: 'red', face: 7 }, { color: 'yellow', face: 6 }];
  const shot = (over = {}) => ({
    attacker: mech027(1), defender: mech027(2), action: single, attackRoll: eyes, eyeSwaps: 0, ...over,
  });

  const fired = helper.attackIcons(shot());
  check('Single Shot pays TWO Light Hits for every {Eye}',
    [fired.eye ?? 0, fired.lightHit ?? 0, fired.heavyHit ?? 0], [0, 4, 0]);

  const plain = helper.attackIcons(shot({ action: { id: 'X_B', type: 'Firing', size: 'm', name: { en: 'Shot' } } }));
  check('and another Firing Action off the same Mech leaves the Eyes alone',
    [plain.eye ?? 0, plain.lightHit ?? 0], [2, 0]);

  // ---------- the ordering: an INTERIM DEFAULT, pinned as one ----------
  //
  // A heavy source still takes its {Eye} first. At rate 1 that was because a
  // Heavy Hit is strictly better; at rate 2 it is NOT, and the rulebook does not
  // back it either: 4.4.1 step 6 (p51) runs the Exchange AFTER both rolls and
  // says "Each Dice may only be Exchanged once", which makes this a conflict the
  // FAQ resolves the same way three times over (A5, A6, D1) -- only one may be
  // CHOSEN, by the attacker, who can see the Defence Roll by then.
  //
  // So these two assertions are a CHANGE DETECTOR, not an endorsement. When the
  // attacker is offered the choice the way ZPA-35 Chef already is, they are the
  // ones that should fail, and they should be rewritten rather than deleted.
  const paid = helper.attackIcons(shot({ eyeSwaps: 1 }));
  check('a heavy claim takes its {Eye} first, and the rifle pays 2 for the rest',
    [paid.heavyHit ?? 0, paid.lightHit ?? 0, paid.eye ?? 0], [1, 2, 0]);
  const bothPaid = helper.attackIcons(shot({ eyeSwaps: 2 }));
  check('and with enough heavy claims the rifle gets nothing',
    [bothPaid.heavyHit ?? 0, bothPaid.lightHit ?? 0], [2, 0]);

  // ---------- the per-die replay ----------
  //
  // Both Light Hits ride the ONE die that rolled the {Eye}, which is what makes
  // a single Dodge cancel the pair — correct, because a Dodge offsets the die.
  check('the per-die tally replays the rifle, both Hits on the one die',
    helper.attackIconsPerDie(shot()), [{ heavy: 0, light: 2 }, { heavy: 0, light: 2 }]);
  check('and the per-die heavy claim wins the same race the totals do',
    helper.attackIconsPerDie(shot({ eyeSwaps: 1 })), [{ heavy: 1, light: 0 }, { heavy: 0, light: 2 }]);

  // ---------- the contest, and the attacker's answer to it ----------
  //
  // Rulebook 4.4.1 step 6 (p51): the Exchange runs after both rolls and before
  // offsetting, and "Each Dice may only be Exchanged once". Card 503 Close
  // Assault reads every {Eye} as a Heavy Hit; this rifle reads the same {Eye}
  // as 2 Light Hits. Both are printed 视为 -- automatic -- so they genuinely
  // collide, and the FAQ answers that shape three times over (A5, A6, D1):
  // only one may be CHOSEN. c.eyeToLight is the attacker's answer.
  //
  // Driven off the real 503, not a fixture, for the reason the block above
  // gives: a fixture would pass against a reader keyed on the wrong card.
  const armed = (over = {}) => shot({
    attacker: mech027(1, { mech: { torso: '503', rightHand: '027', pilot: 'FPA-05' } }),
    ...over,
  });

  check('503 and the rifle both read the same {Eye}, so 2 are contested',
    (({ claim, contested, rate }) => [claim, contested, rate])(helper.eyeContest(armed())),
    [2, 2, 2]);

  check('unassigned, the contested {Eye} default to the conservative heavy arm',
    [helper.attackIcons(armed()).heavyHit ?? 0, helper.attackIcons(armed()).lightHit ?? 0], [2, 0]);

  const one = armed({ eyeToLight: 1 });
  check('assigning one hands it to the rifle and leaves the other a Heavy Hit',
    [helper.attackIcons(one).heavyHit ?? 0, helper.attackIcons(one).lightHit ?? 0, helper.attackIcons(one).eye ?? 0],
    [1, 2, 0]);
  check('and the per-die replay splits it the same way, so Dodge Enhancement still reaches both',
    helper.attackIconsPerDie(one), [{ heavy: 1, light: 0 }, { heavy: 0, light: 2 }]);

  const both = armed({ eyeToLight: 2 });
  check('assigning both gives the rifle everything',
    [helper.attackIcons(both).heavyHit ?? 0, helper.attackIcons(both).lightHit ?? 0], [0, 4]);
  check('and the per-die replay agrees', helper.attackIconsPerDie(both),
    [{ heavy: 0, light: 2 }, { heavy: 0, light: 2 }]);

  // A Focus reroll can shrink the {Eye} count under an assignment already made,
  // so the split is clamped rather than trusted.
  check('an over-large assignment is clamped to what is actually contested',
    [helper.attackIcons(armed({ eyeToLight: 99 })).lightHit ?? 0,
      helper.attackIcons(armed({ eyeToLight: -5 })).heavyHit ?? 0], [4, 2]);

  // A PAID Chef token bought its {Eye}; the rifle may not steal it back.
  check('a paid swap is excluded from the contest, so its token is never wasted',
    helper.eyeContest(armed({ eyeSwaps: 1 })).contested, 1);

  check('with no rifle in the Action there is nothing to contest, and nothing is asked',
    helper.eyeContest(armed({ action: { id: 'X_B', type: 'Firing', size: 'm', name: { en: 'Shot' } } })).contested, 0);
}

// ---------- LPA-23-2 Onyx Mellow Chord — 装饰音 Grace Note ----------
//
// "When piloted Mech performs a Firing Action, if the target is within 3 grids,
// this Firing Action +1Y."
{
  const chord = pilot('LPA-23-2');
  const onyx = pilot('LPA-23');   // the plain Onyx: same UN pilot, different trait
  check('LPA-23-2 is the Grace Note card', chord.trait, '装饰音');
  check('and the curated effect agrees on the range and the die',
    chord.traitEffects?.map((e) => [e.type, e.range, e.value]),
    [['firing_close_range_yellow_dice_bonus', 3, 1]]);

  // Large Grids are 3 board cells across, so col 3 -> grid 1, col 12 -> grid 4.
  const at = (uid, pilotId, col) => ({
    uid, side: uid === 1 ? 's1' : 's2', kind: 'mech', label: `M${uid}`, col, row: 3, size: 3, facing: 0,
    stance: 'offensive', mech: { torso: '002', pilot: pilotId }, partStates: { torso: 'intact' },
  });
  const firing = { id: 'X_B', type: 'Firing', size: 'm', name: { en: 'Shot' } };
  const melee = { id: 'X_A', type: 'Melee', size: 'm', name: { en: 'Punch' } };

  const near = at(2, 'LPA-23', 3 + 9);      // 3 Large Grids away
  const far = at(2, 'LPA-23', 3 + 12);      // 4 Large Grids away
  const same = at(2, 'LPA-23', 3);          // the same Large Grid

  check('the fixture distances are the ones the rule turns on',
    [A.rangeBetween(at(1, 'LPA-23-2', 3), same).range,
      A.rangeBetween(at(1, 'LPA-23-2', 3), near).range,
      A.rangeBetween(at(1, 'LPA-23-2', 3), far).range], [0, 3, 4]);

  check('Grace Note adds +1Y at exactly 3 grids',
    A.pilotDiceBonus(data, at(1, 'LPA-23-2', 3), near, firing), { red: 0, yellow: 1 });
  check('and inside the same Large Grid, which is range 0',
    A.pilotDiceBonus(data, at(1, 'LPA-23-2', 3), same, firing), { red: 0, yellow: 1 });
  check('but not at 4', A.pilotDiceBonus(data, at(1, 'LPA-23-2', 3), far, firing), { red: 0, yellow: 0 });
  check('a pilot without Grace Note gets nothing at any range',
    A.pilotDiceBonus(data, at(1, 'LPA-23', 3), near, firing), { red: 0, yellow: 0 });
  check('and it is a FIRING rider, so a Melee Action at the same range gets nothing',
    A.pilotDiceBonus(data, at(1, 'LPA-23-2', 3), near, melee), { red: 0, yellow: 0 });

  // The wiring, not just the reader: task #7's lesson is that a reader test
  // passes happily while nothing calls it. AttackHelper cannot be imported
  // (it wants the DOM), so the two pool-construction sites are asserted by
  // source, the way dodgedie.test.mjs pins its own five-file round trip.
  check('the single-target pool calls the reader',
    /const bonus = coolingBonus\(this\.data, attacker, action, printed\);[\s\S]{0,600}?const pilot = pilotDiceBonus\(this\.data, attacker, defender, action\);[\s\S]{0,200}?printed\.yellow \+ bonus\.yellow \+ pilot\.yellow/.test(combat), true);
  check('and so does the Multi-Target pool, which is settled once and split',
    /const cooled = coolingBonus\(this\.data, attacker, action, printed\);[\s\S]{0,700}?const pilot = pilotDiceBonus\(this\.data, attacker, primary, action\);[\s\S]{0,200}?printed\.yellow \+ cooled\.yellow \+ pilot\.yellow/.test(combat), true);
  check('and both pools are still built in exactly two places',
    (combat.match(/pilotDiceBonus\(this\.data/g) ?? []).length, 2);
}

// ---------- ZPA-40 Shrike — 欢愉 Elation ----------
//
// The command half (gate, clamp, seat) is driven for real in commands.test.mjs.
// What is left is the EMIT, which lives inside AttackHelper and so is pinned by
// source — and the emit is the half that is easy to get wrong, because the two
// pages each own an onDestroyed callback that would have been the tempting home.
{
  const shrike = pilot('ZPA-40');
  check('ZPA-40 prints the Offensive-Stance Melee condition the emit checks',
    /\[Offensive Stance\][\s\S]*Melee Actions?, restore 1 Link/.test(shrike.traitDescription.en), true);

  const emit = combat.slice(combat.indexOf("if (next === 'destroyed') {"), combat.indexOf('const how = c.explosion'));
  check('the emit sits on the ONE line where a Penetration becomes a destruction',
    /c\.killedPart = true;/.test(emit), true);
  check('it is gated on the pilot', /pilotIs\(this\.data, c\.attacker, 'ZPA-40'\)/.test(emit), true);
  check('on Offensive Stance', /c\.attacker\.stance === 'offensive'/.test(emit), true);
  check('on a Melee Action', /timingOf\(c\.action\) === 'melee'/.test(emit), true);
  check('and on the Part being an ENEMY Part', /c\.defender\.side !== c\.attacker\.side/.test(emit), true);
  check('and it sends the command rather than writing the token',
    /this\.onCommand\(\{ kind: 'restoreLink'/.test(emit), true);
  // The trap this is here to hold: onDestroyed is written once per page and a
  // rule hung there is live on one screen only.
  check('nothing hangs Elation on a per-page onDestroyed callback',
    /ZPA-40/.test(src('main.ts')) || /ZPA-40/.test(src('match.ts')), false);
}

// ---------- ZPA-39 Cadaver — 求生意志 Will to Survive ----------
//
// The rule itself is driven for real in commands.test.mjs. What is pinned here
// is that FOUR independent Focus surfaces now ask the same question. Before
// this phase they asked four different ones — `> 0` in the attack window,
// `> 1` in the freeplay counter-roll, `> 1` in the Match Centre and NO gate at
// all on the remote defender's mirror — so a Mech on exactly 1 Link was offered
// a Focus the command refused, and on the mirror rerolled for free.
{
  const cadaver = pilot('ZPA-39');
  const hud = src('matchhud.ts'), mirror = src('match.ts');
  check('ZPA-39 is the Will to Survive card', cadaver.trait, '求生意志');

  check('surface 1 — the attack window asks the shared reader',
    /canAffordFocus\(this\.data, t\) && !!roll/.test(combat), true);
  check('surface 2 — the freeplay counter-roll asks it too',
    /if \(!spent && canAffordFocus\(this\.data, t\)\)/.test(combat), true);
  // Surface 3 was the Match Centre's own counter-roll rows. Those are GONE the
  // same way surface 4 went: Electronic Warfare is resolved in the combat
  // window now, so the networked player presses SURFACE 2, the same reader the
  // freeplay counter-roll uses. Three surfaces, one question.
  check('the Match Centre no longer asks it a third way',
    /canAffordFocus\(ctx\.data/.test(hud), false);
  check('because its counter-roll rows are gone entirely',
    /data-ewfocus|data-ewroll/.test(hud), false);
  // Surface 4 was the remote defender's hand-written mirror, and it is GONE.
  // The Match Centre draws the same window the attacker is looking at now, so
  // the defending player presses surface 1: a page that asks the question in no
  // place of its own cannot answer it differently from the renderer.
  check('surface 4 is gone, because the mirror IS surface 1 now',
    /focusIsFree\(/.test(mirror), false);
  check('and the defender reaches surface 1 by sending their declare',
    /act === 'focususe'/.test(mirror), true);

  // The old gates are gone rather than merely joined by a new one.
  check('no surface still asks the wrong question',
    [/\(t\.link \?\? 0\) > 0 && !!roll/.test(combat), /!spent && \(t\.link \?\? 0\) > 1/.test(combat),
      /!o\.focused && \(o\.t\.link \?\? 0\) > 1/.test(hud)], [false, false, false]);

  // And the debit stays in ONE place: all FIVE keep sending a plain `focus`.
  // The fifth is the Black Die's own Focus (4.10's note: the Part Die can be
  // rerolled too), which OTTO ratified on 2026-08-23 -- a separate roll, so a
  // separate spend through the same command.
  check('every surface still sends the same plain focus command',
    (combat.match(/kind: 'focus'/g) ?? []).length
    + (hud.match(/kind: 'focus'/g) ?? []).length
    + (mirror.match(/kind: 'focus'/g) ?? []).length, 5);
  check('and nothing outside the command decides what a Focus costs',
    /focusIsFree\(data, t\)/.test(src('commands.ts')), true);
}

// ---------- FPA-05 Anser — 不竭 Inexhaustible ----------
//
// Three readers, and the third is the one that would have gone quietly wrong.
{
  pilot('FPA-05');
  const squads = src('squads.ts');
  check('the damage ladder asks structureOf, which is where the rule lives',
    /structureOf\(data, target, cmd\.slot\) > 0 \? 'damaged' : 'destroyed'/.test(src('commands.ts')), true);
  check('the defence pool asks it too, so an Anser Chassis rolls 2 not the min-1 clamp',
    /st === 'damaged' \? structureOf\(this\.data, d, slot as PartSlot \| 'main'\)/.test(combat), true);
  check('and so does the freeplay inspector, whose click cycles the state by hand',
    /const structure = structureOf\(this\.data, t, slot as PartSlot \| 'main'\)/.test(squads), true);
  check('nothing reads card.structure raw any more',
    [/card\?\.structure \?\? 0/.test(src('commands.ts')), /card\?\.structure \?\? 0/.test(combat),
      /card\.structure \?\? 0/.test(squads)], [false, false, false]);

  // Every 0-Structure Chassis in the pool is a card Anser can actually be flown
  // with, so the reader is worth pointing at the real list rather than one card.
  const zeroChassis = cards.filter((c) => c.type === 'chasis' && (c.structure ?? 0) === 0).map((c) => c.id);
  check('the ten 0-Structure Chassis the trait exists for are still there',
    zeroChassis.length >= 10, true);
  const wearing = (id, pilotId) => ({
    uid: 1, side: 's1', kind: 'mech', col: 3, row: 3, size: 3, facing: 0, stance: 'offensive',
    mech: { torso: '002', chasis: id, pilot: pilotId }, partStates: { torso: 'intact', chasis: 'intact' },
  });
  check('Anser gives every one of them 2',
    zeroChassis.map((id) => A.structureOf(data, wearing(id, 'FPA-05'), 'chasis')), zeroChassis.map(() => 2));
  check('and a pilot without the trait leaves every one of them at 0',
    zeroChassis.map((id) => A.structureOf(data, wearing(id, 'LPA-19'), 'chasis')), zeroChassis.map(() => 0));
  // A Chassis that prints its own Structure is untouched, in either direction.
  const printed = cards.filter((c) => c.type === 'chasis' && (c.structure ?? 0) > 0);
  check('a printed Structure is never overwritten',
    printed.map((c) => A.structureOf(data, wearing(c.id, 'FPA-05'), 'chasis')), printed.map((c) => c.structure));
}

// ---------- ZPA-37 Foxhound — 寻踪 Tracking ----------
//
// "If there are 2 or more Ally Drones that have line of sight to the target,
// Firing Actions of this Mech ignore Low Profile."
{
  const foxhound = pilot('ZPA-37');
  check('ZPA-37 is the Tracking card', foxhound.trait, '寻踪');
  // The one pilot in this cluster with NO curated effect, so the reading has to
  // come off the print — worth pinning, because a later data patch that adds
  // one must not be assumed to already exist.
  check('and it carries no traitEffects, so the reading is the printed text',
    foxhound.traitEffects, undefined);
  check('the printed threshold is 2 or more', /2 or more Ally Drones/.test(foxhound.traitDescription.en), true);

  const mech = (uid, side, pilotId, col) => ({
    uid, side, kind: 'mech', label: `M${uid}`, col, row: 3, size: 3, facing: 0, stance: 'offensive',
    mech: { torso: '002', pilot: pilotId }, partStates: { torso: 'intact' },
  });
  const drone = (uid, side, col, over = {}) => ({
    uid, side, kind: 'drone', label: `D${uid}`, col, row: 3, size: 1, facing: 0,
    cardId: '160', partStates: { main: 'intact' }, ...over,
  });
  const shot = mech(1, 's1', 'ZPA-37', 0);
  const mark = mech(2, 's2', 'FPA-05', 24);
  const d1 = drone(3, 's1', 6), d2 = drone(4, 's1', 12), d3 = drone(5, 's2', 15);

  const cover = (tokens, shooter = shot) => A.trackingCover(data, tokens, [], [], shooter, mark).map((d) => d.uid);
  check('one ally Drone in sight is not enough', cover([shot, mark, d1]), []);
  check('two are', cover([shot, mark, d1, d2]), [3, 4]);
  check('an ENEMY drone does not spot for you', cover([shot, mark, d1, d3]), []);
  check('and a pilot without Tracking is never covered',
    cover([mech(1, 's1', 'FPA-05', 0), mark, d1, d2], mech(1, 's1', 'FPA-05', 0)), []);

  // A Projectile in flight is its own kind, not a drone — otherwise a pair of
  // missiles mid-air would spot for the shooter.
  const missile = drone(6, 's1', 9, { kind: 'projectile' });
  check('a Projectile is not a spotter', cover([shot, mark, d1, missile]), []);
  // Liveness, copied from earlyWarningCover rather than invented.
  check('a destroyed Drone does not spot', cover([shot, mark, d1, drone(7, 's1', 9, { partStates: { main: 'destroyed' } })]), []);
  check('nor an undeployed one', cover([shot, mark, d1, drone(8, 's1', 9, { deployed: false })]), []);
  // The target itself cannot be one of its own spotters.
  check('and the target is never counted', cover([shot, mark, d1, { ...mark, kind: 'drone', side: 's1' }]), []);

  // Terrain that BLOCKS line of sight takes a spotter out; 4.16 Smoke does the
  // same, which is the reading this card takes with 164 and against the Radar.
  const wall = { subCells: [{ col: 9, row: 3 }, { col: 9, row: 4 }, { col: 10, row: 3 }], blocksLos: true };
  check('a blocking wall between a Drone and the target removes it',
    A.trackingCover(data, [shot, mark, d1, d2], [wall], [], shot, mark).length < 2, true);
  // Smoke Screens are placed on LARGE Grids, so the target at cell (24,3) is
  // covered by the screen on Large Grid (8,1).
  const smokeOnTarget = [{ col: 8, row: 1, side: 's2' }];
  check('and a Smoke Screen on the target hides it from both (4.16)',
    A.trackingCover(data, [shot, mark, d1, d2], [], smokeOnTarget, shot, mark), []);

  // The wiring: one `&&` in the single Low Profile disjunction, which is the
  // only rules consumer of Low Profile in the app.
  check('Tracking joins the ONE Low Profile decision',
    /&& !ignoresLowProfile\(this\.data, c\.attacker\)\s*\n\s*&& !tracking\.length/.test(combat), true);
  check('and the spotters are computed from the shared AttackHelper, so both pages get it',
    /const tracking = c\.action\.type === 'Firing' && this\.tokens/.test(combat), true);
  check('and the drones are named in the notes, so the shooter can see why',
    /Tracking: \$\{tracking\.slice\(0, TRACKING_SPOTTERS_NEEDED\)/.test(combat), true);
}

// ---------- FPA-01 Misty — 变招 Feint ----------
//
// "In Tactical Timing, may perform Starting Action from any timing."
// The behaviour is driven in ticks.test.mjs, which owns canPerform. What is
// pinned here is the pilot half and the THREE-READER rule: commands.ts is
// authoritative, matchhud.ts draws the Match Centre row and playguide.ts draws
// the freeplay one — and the SPEND has to agree with all of them.
{
  const misty = pilot('FPA-01');
  check('FPA-01 is the Feint card', misty.trait, '变招');
  check('and the curated effect names the Tactical-only grant',
    misty.traitEffects?.map((e) => e.type), ['any_tactic_starting_action']);
  check('the reader answers for Misty', A.anyStartTiming(data, {
    kind: 'mech', mech: { pilot: 'FPA-01' }, partStates: { torso: 'intact' },
  }), true);
  check('and not for a pilot without it', A.anyStartTiming(data, {
    kind: 'mech', mech: { pilot: 'FPA-05' }, partStates: { torso: 'intact' },
  }), false);

  const cmds = src('commands.ts'), hud = src('matchhud.ts'), guide = src('playguide.ts');
  check('reader 1 — the authoritative check passes it', /anyTiming: anyStartTiming\(data, t\)/.test(cmds), true);
  check('reader 2 — the Match Centre panel passes it', /anyTiming: anyStartTiming\(ctx\.data, t\)/.test(hud), true);
  check('reader 3 — the freeplay guide passes it, in both of its call sites',
    (guide.match(/anyTiming: anyStartTiming\(this\.data, t\)/g) ?? []).length, 2);
  check('and the SPEND agrees with the check that allowed it',
    /spendAction\(o, a, cmd\.partKey \|\| a\.id, \{ flexible:[^}]*anyTiming: anyStartTiming\(data, t\) \}\)/.test(cmds), true);

  // The trait must NOT be folded into hasFlexibleTiming: that boolean means
  // "adjacent on the dial", and widening it would hand every aura source and
  // card 017 CQC the full dial.
  const flex = units.slice(units.indexOf('export function hasFlexibleTiming'), units.indexOf('// An action that hands out Repaired Tokens'));
  check('hasFlexibleTiming still means "adjacent" and knows nothing about Misty',
    /FPA-01|anyStartTiming/.test(flex), false);
  // ticks.ts must not grow an import of units.ts: it is sliced by
  // ticks.test.mjs and by _attackmode.slice.ts, and a new module reference is a
  // ReferenceError inside both. The pilot boolean crosses as an ARGUMENT, which
  // is the pattern canOverload and canAttackMode already use for Link and
  // Stance.
  check('ticks.ts still imports types only, never units',
    (ticks.match(/^import .*/gm) ?? []).every((l) => l.includes("'./types'")), true);
}

// ---------- XPA-62 海鸥 — 高抛发射 ----------
//
// Chinese only. No English, no Japanese, no traitEffects — this is the one
// trait in the phase where the zh text is the entire source, so the test pins
// what it says as well as what the reader does with it.
{
  const seagull = pilot('XPA-62');
  check('XPA-62 is the 高抛发射 card', seagull.trait, '高抛发射');
  check('and it really is Chinese-only, so the zh governs',
    [!!seagull.traitDescription?.zh, seagull.traitDescription?.en, seagull.traitEffects],
    [true, undefined, undefined]);
  check('the printed bonus is +2 on Projectile Actions',
    /抛射动作距离\+2/.test(seagull.traitDescription.zh), true);

  const flier = (pilotId) => ({
    uid: 1, side: 's1', kind: 'mech', col: 3, row: 3, size: 3, facing: 0, stance: 'offensive',
    mech: { torso: '002', pilot: pilotId }, partStates: { torso: 'intact' },
  });
  const lob = { id: 'X_P', type: 'Projectile', size: 'm', range: 4, name: { en: 'Grenade' } };
  const shoot = { id: 'X_F', type: 'Firing', size: 'm', range: 4, name: { en: 'Shot' } };

  check('a Projectile Action reaches 2 Grids further', A.projectileReach(data, flier('XPA-62'), lob), 6);
  check('and a pilot without the trait gets the printed range',
    A.projectileReach(data, flier('LPA-19'), lob), 4);
  check('a Firing Action is untouched, on either pilot',
    [A.projectileReach(data, flier('XPA-62'), shoot), A.projectileReach(data, flier('LPA-19'), shoot)], [4, 4]);
  // 抛射动作 is the whole timing, so a Mine LAY and a Wall DEPLOY ride along
  // with a launch — they are all type 'Projectile'.
  check('a range-0 layer still gains it, because Lay is a Projectile Action too',
    A.projectileReach(data, flier('XPA-62'), { id: 'LAY', type: 'Projectile', range: 0, name: { en: 'Auto Mine Laying' } }), 2);

  // CROSS-PAGE: landingCandidates is written twice, and matchhud.ts's own
  // comment says it mirrors main.ts. Patch one and the two boards disagree
  // about where a grenade may land.
  const mainSrc = src('main.ts'), hud = src('matchhud.ts');
  check('the freeplay landing gate reads the trait-aware reach',
    /const range = projectileReach\(data, t, m\.action\);/.test(mainSrc), true);
  check('and so does its mirror in the Match Centre',
    /const range = projectileReach\(ctx\.data, t, a\);/.test(hud), true);
  check('no landing gate still reads a raw a.range',
    [/const range = m\.action\.range \?\? 0;/.test(mainSrc), /const range = a\.range \?\? 0;/.test(hud)], [false, false]);
  // The two "within Range N" labels beside them, which a player reads to decide
  // whether the gate is working.
  check('both "within Range N" labels agree with their gate',
    [/within Range \$\{projectileReach\(data,/.test(mainSrc),
      /within Range \$\{t && a \? projectileReach\(ctx\.data, t, a\)/.test(hud)], [true, true]);
}

// ---------- LPA-21 Firefly — 匿踪 Stealth ----------
//
// "Piloted Mech's movement route may pass through other units when Optical
// Camouflage is on or in Low Profile." The movement rule the flag buys is
// driven in breakaway.test.mjs, which owns searchMoves. What is checked here is
// the CONDITION — both halves of it, because the aura half is easy to miss.
{
  const firefly = pilot('LPA-21');
  check('LPA-21 is the Stealth card', firefly.trait, '匿踪');
  check('and the curated effect names both stealth conditions',
    firefly.traitEffects?.map((e) => e.type), ['phase_through_units_when_stealthed_or_low_profile']);

  const sneak = (pilotId, statuses = []) => ({
    uid: 1, side: 's1', kind: 'mech', col: 3, row: 3, size: 3, facing: 0, stance: 'offensive',
    mech: { torso: '002', pilot: pilotId }, partStates: { torso: 'intact' }, statuses,
  });
  const alone = (t) => [t];

  check('a plain Firefly phases through nothing', A.phasesThroughUnits(data, alone(sneak('LPA-21')), sneak('LPA-21')), false);
  const camo = sneak('LPA-21', ['camouflage']);
  check('with Optical Camouflage up, it does', A.phasesThroughUnits(data, alone(camo), camo), true);
  const low = sneak('LPA-21', ['lowProfile']);
  check('and with a Low Profile Token too', A.phasesThroughUnits(data, alone(low), low), true);
  const other = sneak('FPA-05', ['camouflage']);
  check('but a pilot without the trait never does, however stealthed',
    A.phasesThroughUnits(data, alone(other), other), false);

  // The SECOND source of Low Profile: card 072_A projects it as an aura at
  // Range 1. Missing this arm under-grants an MES-Beacon Firefly, and
  // rules/05:218 says an aura Low Profile cannot be Scanned off, so the two
  // sources really do differ.
  const beacon = {
    uid: 2, side: 's1', kind: 'mech', col: 3, row: 3, size: 3, facing: 0, stance: 'offensive',
    mech: { torso: '072' }, partStates: { torso: 'intact' },
  };
  const beside = sneak('LPA-21');
  check('072 still projects the low_profile aura this arm depends on',
    A.auraEffectsOn(data, [beacon, beside], beside).has('low_profile'), true);
  check('so a Firefly standing in an ally aura phases too',
    A.phasesThroughUnits(data, [beacon, beside], beside), true);
  const farOff = { ...sneak('LPA-21'), uid: 3, col: 30 };
  check('and one outside the aura does not',
    A.phasesThroughUnits(data, [beacon, farOff], farOff), false);

  // THREE construction sites across two files, and matchhud.ts's own comment
  // warns that a rule added to one of its two paints Grids the other refuses.
  const mainSrc = src('main.ts'), hud = src('matchhud.ts');
  check('the freeplay board fills the flag in its single moveOpts helper',
    (mainSrc.match(/phaseThrough: phasesThroughUnits\(data, state\.tokens, t\)/g) ?? []).length, 1);
  check('and the Match Centre fills it in BOTH of its builders',
    (hud.match(/phaseThrough: phasesThroughUnits\(ctx\.data, ctx\.state\.tokens, t\)/g) ?? []).length, 2);
  // Route only: the landing test is untouched, so a phased Grid is crossable
  // but never a place to stop.
  check('and the landing test still demands a legal spot',
    /if \(\(standable \|\| crush\) && \(opts\?\.landing\?\.\(n\.c, n\.r\) \?\? true\)\) reachable\.push/.test(rules), true);
}

// ZPA-39's free reroll must be said the same way on every screen. combat.ts's
// own button was unconditional while match.ts's mirror already branched, so the
// attacker was told to spend a Link the engine had stopped charging. There is
// one button now, which is the strongest form of "they agree": the two labels
// cannot disagree if there is only one label.
{
  const src = readFileSync(new URL('../src/combat.ts', import.meta.url), 'utf8');
  const mt  = readFileSync(new URL('../src/match.ts', import.meta.url), 'utf8');
  check('the Focus button says free when it is free',
    /focusIsFree\(this\.data, t\) \? .Focus: free./.test(src), true);
  // Deliberately LOOSER than the label itself: this is an absence check, so it
  // should catch any reintroduced way of saying the same thing, not only the
  // exact string the retired one used.
  check('and there is no second one left to disagree with it',
    /Focus[^'"\n]*free/i.test(mt), false);
}

// ---------- LPA-24 Sealock — 追击 Pursuit ----------
//
// "When attacking a target with a Fragile Token, may exchange {Eye} as
// {Heavy Hit}." Free — no Command Token, no Link — so it joins the FREE arm of
// the shared eyeSwaps clamp beside card 503 rather than growing an arm of its
// own.
{
  const sealock = pilot('LPA-24');
  // The negative control is a real UN LV4 pilot whose trait is a movement
  // legality, so it can never satisfy an icon rule by accident.
  const firefly = pilot('LPA-21');
  check('LPA-24 is the Pursuit card', sealock.trait, '追击');
  check('and the printed English is the one this reader was written against',
    /Fragile Token[\s\S]*\{Eye\}[\s\S]*\{Heavy Hit\}/.test(sealock.traitDescription.en), true);
  check('and the curated effect agrees with that reading',
    sealock.traitEffects?.map((e) => e.type), ['fragile_target_eye_to_heavy_optional']);

  // ---------- the landmine, pinned ----------
  //
  // Card 503's regex matches Sealock's own Chinese trait text. If it were ever
  // read as a Part, this Mech would gain an unconditional always-on
  // {Eye}->{Heavy Hit} against every target on the board — no Fragile Token
  // needed. Two assertions, because the guard has two halves.
  check("503's regex really does match Sealock's printed trait text",
    /\{?眼睛\}?视为\{?重击\}?/.test(sealock.traitDescription.zh), true);
  // This pins the OUTCOME -- a Sealock gains no always-on swap -- and NOT the
  // mechanism. It still passes with partSays's pilot guard deleted, because a
  // pilot card has no actions for that regex to reach in the first place.
  const wearingSealock = { kind: 'mech', mech: { torso: '002', pilot: 'LPA-24' }, partStates: { torso: 'intact' } };
  check('a Sealock gains no unconditional swap from its own trait text',
    A.eyesAreHeavyHits(data, wearingSealock), false);

  const helper = new A.Helper(data, dice);
  const mech = (uid, pilotId, over = {}) => ({
    uid, side: uid === 1 ? 's1' : 's2', kind: 'mech', label: `M${uid}`, col: 3, row: 3, size: 3, facing: 0,
    stance: 'offensive', mech: { torso: '002', pilot: pilotId }, partStates: { torso: 'intact' }, statuses: [], ...over,
  });
  const melee = { id: 'X_A', type: 'Melee', size: 'm', name: { en: 'Punch' } };
  const firing = { id: 'X_B', type: 'Firing', size: 'm', name: { en: 'Shot' } };
  // red face 7 and yellow face 6 are both a solid {Eye} in the shipped dice.
  const eyes = [{ color: 'red', face: 7 }, { color: 'yellow', face: 6 }];
  const ctx = (attackerPilot, action, defenderStatuses, over = {}) => ({
    attacker: mech(1, attackerPilot),
    defender: mech(2, 'LPA-21', { statuses: defenderStatuses }),
    action, attackRoll: eyes, eyeSwaps: 0, surplusRound: 0, ...over,
  });

  const fragile = helper.attackIcons(ctx('LPA-24', firing, ['fragile']));
  check('LPA-24 turns every {Eye} into a Heavy Hit against a Fragile target',
    [fragile.eye ?? 0, fragile.heavyHit ?? 0], [0, 2]);
  const healthy = helper.attackIcons(ctx('LPA-24', firing, []));
  check('and does nothing at all when the target bears no Fragile Token',
    [healthy.eye ?? 0, healthy.heavyHit ?? 0], [2, 0]);
  const other = helper.attackIcons(ctx('LPA-21', firing, ['fragile']));
  check('a pilot without the trait leaves a Fragile target\'s Eyes alone',
    [other.eye ?? 0, other.heavyHit ?? 0], [2, 0]);

  // "When ATTACKING" — not Firing, not Melee. The card names no attack type,
  // so every attack that runs through this helper is covered.
  const punch = helper.attackIcons(ctx('LPA-24', melee, ['fragile']));
  check('and the trade covers a Melee Action too, because the card says "attacking"',
    [punch.eye ?? 0, punch.heavyHit ?? 0], [0, 2]);

  // The note has to be able to name the condition, or the attacker watches
  // Eyes become Heavy Hits with nothing on screen to credit.
  const noted = ctx('LPA-24', firing, ['fragile']);
  helper.attackIcons(noted);
  check('the tally records how many Eyes Pursuit took, for the note', noted.pursuitSwapped, 2);
  const quiet = ctx('LPA-24', firing, []);
  helper.attackIcons(quiet);
  check('and records none when the trait did not apply', quiet.pursuitSwapped, 0);
  check('resolve() prints that count as a named line',
    /Pursuit: \$\{c\.defender\.label\} bears a Fragile Token/.test(combat), true);

  // ---------- the shared counter ----------
  //
  // Chef's paid swap and this free one ride ONE clamp, so a Command Token and
  // a Fragile Token can never spend the same {Eye} twice.
  const paid = helper.attackIcons(ctx('LPA-24', firing, ['fragile'], { eyeSwaps: 2 }));
  check('a Chef token and Pursuit cannot double-count one {Eye}',
    [paid.eye ?? 0, paid.heavyHit ?? 0], [0, 2]);

  // ---------- the audit's Trap #1: the per-die replay ----------
  //
  // Dodge Enhancement offsets whole DICE. A free swap left out of the per-die
  // tally puts its Heavy Hits on no die at all, which is exactly the bug card
  // 503 shipped with.
  check('the per-die tally replays Pursuit, so Dodge Enhancement can reach it',
    helper.attackIconsPerDie(ctx('LPA-24', firing, ['fragile'])), [{ heavy: 1, light: 0 }, { heavy: 1, light: 0 }]);
  check('and leaves the dice alone against a target with no Fragile Token',
    helper.attackIconsPerDie(ctx('LPA-24', firing, [])), [{ heavy: 0, light: 0 }, { heavy: 0, light: 0 }]);
  check('nor does a pilot without the trait get a per-die claim',
    helper.attackIconsPerDie(ctx('LPA-21', firing, ['fragile'])), [{ heavy: 0, light: 0 }, { heavy: 0, light: 0 }]);
}

// ---------- FPA-06-2 KeyHole — 功率隐匿 Power Concealment ----------
//
// "When piloted Mech is within range of allied Aura, gains Low Profile."
// Publisher name "Hidden in Plain Sight", id FPA-19 / QR 362, and a genuinely
// different card from FPA-06 — traits.test.mjs pins that apart, so this file
// checks the RULE and takes the identity from there.
//
// Driven against real aura cards, because every question this trait raises —
// whose aura, reaching what, at what distance — lives in the shipped data and
// no fixture aura could ask it.
{
  const keyhole = pilot('FPA-06-2');
  const amplify = pilot('FPA-06');
  check('FPA-06-2 is the Power Concealment card', keyhole.trait, '功率隐匿');
  check('and FPA-06 is still the OTHER KeyHole, not this one', amplify.trait, '功率加大');
  check('and the printed English is the one this reader was written against',
    /within range of allied Aura[\s\S]*Low Profile/.test(keyhole.traitDescription.en), true);
  check('and the curated effect agrees with that reading',
    keyhole.traitEffects?.map((e) => e.type), ['low_profile_when_in_allied_aura']);

  // col 3 is Large Grid (1,1); col 12 is (4,1) — three Grids apart.
  const at = (uid, side, col, torso, pilotId) => ({
    uid, side, kind: 'mech', label: `M${uid}`, col, row: 3, size: 3, facing: 0, stance: 'offensive',
    mech: { torso, pilot: pilotId }, partStates: { torso: 'intact' }, statuses: [],
  });
  const drone = (uid, side, col, cardId) => ({
    uid, side, kind: 'drone', label: `D${uid}`, col, row: 3, size: 1, facing: 0, stance: 'offensive',
    cardId, partStates: { main: 'intact' }, statuses: [],
  });
  const hidden = at(1, 's1', 12, '002', 'FPA-06-2');

  check('a KeyHole with no aura anywhere near it is not concealed',
    !!A.hiddenByAlliedAura(data, [hidden], hidden), false);

  // 559 RT-18T is an ALLY aura at Range 6 that grants a Defense bonus, NOT Low
  // Profile — which is the point: the trait asks for an aura, not for the
  // low_profile keyword the arm beside it already reads.
  const escarpment = at(2, 's1', 3, '559');
  const board = [hidden, escarpment];
  check('559 still projects an ally aura that is not low_profile',
    A.aurasOn(data, board, hidden).map((s) => s.kinds).flat(), ['defense_white_dice_bonus']);
  check('so a KeyHole standing in ANY friendly aura is concealed',
    A.hiddenByAlliedAura(data, board, hidden)?.source.uid, 2);
  const plain = at(3, 's1', 12, '002', 'FPA-06');
  check('and the other KeyHole, in the same aura, is not',
    !!A.hiddenByAlliedAura(data, [plain, escarpment], plain), false);
  const far = at(4, 's1', 33, '002', 'FPA-06-2');
  check('nor is a KeyHole outside the aura reach',
    !!A.hiddenByAlliedAura(data, [far, escarpment], far), false);

  // ALLY MEANS ALLY. aurasOn deliberately hands back enemy-sourced auras, so
  // without the side filter an enemy EW Suppression field would conceal this
  // Mech — the opposite of what the card says.
  const watchdog = drone(5, 's2', 3, 'ZHDR-202');
  check('the enemy Watchdog aura really does reach this Mech',
    A.aurasOn(data, [hidden, watchdog], hidden).length, 1);
  check('but standing in an ENEMY aura conceals nobody',
    !!A.hiddenByAlliedAura(data, [hidden, watchdog], hidden), false);

  // THE RULING, pinned so it cannot drift silently: "within range" is answered
  // as "affected by". ZYBP-202 is an ally aura at Range 4 that only touches
  // DRONES, so a Mech three Grids away is inside the printed ring and still
  // gets nothing here.
  const whistle = at(6, 's1', 3, 'ZYBP-202');
  check('a drone-only ally aura leaves a Mech unaffected, so it does not conceal',
    [A.aurasOn(data, [hidden, whistle], hidden).length, !!A.hiddenByAlliedAura(data, [hidden, whistle], hidden)],
    [0, false]);

  // FAQ Q4: a unit is its own ally, which aurasOn already implements. The
  // consequence is a permanent Low Profile, and it is a decision, not an
  // oversight.
  const selfAura = at(7, 's1', 12, '559', 'FPA-06-2');
  check('a KeyHole carrying its OWN aura Part conceals itself (FAQ Q4)',
    A.hiddenByAlliedAura(data, [selfAura], selfAura)?.source.uid, 7);

  // THE WIRING. The decision lives in resolve(), which is outside this file's
  // slice, so the arm is pinned at the source — a reader test is not a wiring
  // test, and that gap has shipped here before.
  check('resolve() reads the trait as a fourth Low Profile source',
    /const concealed = this\.tokens \? hiddenByAlliedAura\(this\.data, this\.tokens\(\), c\.defender\) : undefined;/.test(combat), true);
  check('and ORs it into the one Low Profile disjunction',
    // `\s*` rather than `\n\s*`: this tree is CRLF, and a slice keyed on a bare
    // \n silently matched nothing the last time one was written that way.
    /\|\| !!concealed\s*\|\| !!mistyEagle\);/.test(combat), true);
  // Low Profile is a Firing-only consequence in this engine, and the trait
  // inherits that gate rather than carrying one of its own.
  // Located by SLICING the method rather than by matching the binding's name.
  // This previously pinned `const lowProfile = c.action.type === 'Firing'` and
  // broke when that answer was extracted into lowProfileOn() so the live-die
  // ring could share it, which punished the refactor rather than a bug. What
  // matters is that the verdict is Firing-gated, wherever it is computed.
  const lpFn = combat.slice(combat.indexOf('private lowProfileOn('), combat.indexOf('private defenseIconsPerDie('));
  check('the Low Profile verdict has one home', lpFn.length > 400, true);
  check('which is still gated on a Firing Action',
    /c\.action\.type === 'Firing'/.test(lpFn), true);
  // It grants the KEYWORD, not a Token: Scan cannot strip it (FAQ Q3), so the
  // Scan picker must keep listing Tokens only.
  check('and the Scan picker still offers Tokens only',
    /statusCount\(t\.statuses, 'camouflage'\) > 0 \|\| statusCount\(t\.statuses, 'lowProfile'\) > 0/
      .test(src('playguide.ts')), true);
}

// ---------- LPA-23 Onyx — 不屈 Indomitable ----------
//
// "Piloted mech may Crush large units." The rule itself is driven in
// breakaway.test.mjs, which owns crushTargets and already builds size-3
// fixtures. What is checked here is the card, the ruling and the SHAPE of the
// wiring — because the shape is the reason six call sites needed no edit.
{
  const onyx = pilot('LPA-23');
  const chord = pilot('LPA-23-2');
  check('LPA-23 is the Indomitable card', onyx.trait, '不屈');
  check('and LPA-23-2 Mellow Chord is still a different card', chord.trait, '装饰音');
  check('and the printed English is the one this reader was written against',
    /Piloted mech may Crush large units/i.test(onyx.traitDescription.en), true);

  // rules.ts sits UNDER units.ts and melee.ts in the import graph, so it cannot
  // ask pilotIs without closing a cycle. It reads the same card id off the live
  // loadout instead — and reading the LIVE field is what keeps freeplay's
  // onSaveMech, which rewrites t.mech wholesale including the pilot, from
  // leaving a stale answer behind.
  check('rules.ts dispatches on the card id, off the live loadout',
    /const INDOMITABLE_PILOT = 'LPA-23';/.test(rules)
      && /t\.kind === 'mech' && t\.mech\?\.pilot === INDOMITABLE_PILOT/.test(rules), true);
  check('and rules.ts still imports nothing from units.ts',
    /from '\.\/units'/.test(rules), false);
  // The signature is the wiring: six call sites across main.ts and matchhud.ts
  // read this function, and none of them had to learn about the trait.
  check('crushTargets still takes exactly its five original arguments',
    /export function crushTargets\(\s*t: Token,\s*c: number,\s*r: number,\s*terrain: TerrainPiece\[\],\s*tokens: Token\[\],\s*\): CrushVictims \| null/.test(rules), true);
  check('so all six call sites are unchanged and cannot disagree',
    ((src('main.ts') + src('matchhud.ts')).match(/crushTargets\(t, /g) ?? []).length, 6);
  // The RULING, pinned: the trait adds a target class, not a crusher class.
  check('the "only a Large Unit Crushes" gate is untouched',
    /if \(t\.size !== 3 \|\| t\.aerial\) return null;/.test(rules), true);
}

// ---------- LPA-20 Panzer — 阻拦 Obstruct ----------
//
// "When Breaking Away from the piloted mech, the Enemy Unit needs to consume 1
// additional Move Range or 1 Link." The price is driven in meleelock.test.mjs,
// which owns breakAwayCost. What is checked here is the card and the CROSS-PAGE
// wiring — commands.ts's `maneuver` deliberately does not re-price the path
// (it leaves that to the caller), so a board that missed this would let the
// enemy walk out a Grid cheap with nothing behind it to refuse.
{
  const panzer = pilot('LPA-20');
  check('LPA-20 is the Obstruct card', panzer.trait, '阻拦');
  check('and the printed English is the one this reader was written against',
    /Breaking Away[\s\S]*1 additional Move Range or 1 Link/i.test(panzer.traitDescription.en), true);

  const melee = src('melee.ts'), mainSrc = src('main.ts'), hud = src('matchhud.ts');
  check('melee.ts dispatches on the card id, off the live loadout',
    /const OBSTRUCT_PILOT = 'LPA-20';/.test(melee)
      && /o\.kind === 'mech' && o\.mech\?\.pilot === OBSTRUCT_PILOT/.test(melee), true);
  // The slice trap that has bitten here before: meleelock.test.mjs hand-stubs
  // every import melee.ts has, so a new one is a ReferenceError inside it.
  check('and melee.ts still imports only what its test slice stubs',
    (melee.match(/^import .*$/gm) ?? []).length, 6);

  // The price reaches BOTH boards because both build exitCost from the one
  // function — three construction sites, one in main.ts and two in matchhud.ts,
  // whose own comment warns that a rule added to one paints Grids the other
  // refuses.
  check('the freeplay board prices Break Away through breakAwayCost',
    (mainSrc.match(/const away = flying \|\| t\.aerial \? undefined : breakAwayCost\(/g) ?? []).length, 1);
  check('and the Match Centre does it in BOTH of its builders',
    (hud.match(/breakAwayCost\(ctx\.data, t, ctx\.state\.tokens, terrain\)/g) ?? []).length, 2);
  // The disclosure has to reach both too, or the "or 1 Link" alternative exists
  // on one page only — which for this rule is the same as not existing.
  check('and both boards print the same Break Away sentence from the same helper',
    [/breakAwayNote\(data, t, state\.tokens, currentTerrain\(\)\)/.test(mainSrc),
      /breakAwayNote\(ctx\.data, t, ctx\.state\.tokens, terrainOf\(ctx\)\)/.test(hud)], [true, true]);
  check('and neither counts lockers by hand any more',
    /costs \$\{locked\.length\} extra Movement Range/.test(mainSrc), false);
}

// ---------- LPA-22 Yoyu — 挑衅 Provoke ----------
//
// " · When Electronic Counter Roll is successful, may switch the Responder mech
// to Offensive Stance."
//
// THE RULING (OTTO, 2026-08-19), and every assertion below is one half of it:
// Yoyu is the RESPONDER, and the Mech that may be switched is the INITIATOR.
// The reasoning is written out over provokeWhy in units.ts; what is pinned here
// is that the shipped cards still say what that reading was built on, and that
// the reader turns the right way round on the real data.
{
  const yoyu = pilot('LPA-22');
  // The negative control is a real UN pilot whose trait is ALSO about the
  // Electronic Counter-roll — Firewatch trades {Eye} for {Lightning} inside one
  // — so a reader keyed on "an EW pilot" rather than on THIS card would pass
  // the positive case and fail here.
  const firewatch = pilot('ZPA-38');
  check('LPA-22 is the Provoke card', yoyu.trait, '挑衅');
  check('and the printed English is the one this reader was written against',
    /When Electronic Counter Roll is successful, may switch the Responder mech to Offensive Stance/
      .test(yoyu.traitDescription.en), true);
  // The curator's annotation is a second opinion on the reading, never the
  // dispatcher — see the note on Card.traitEffects.
  check('and the curated effect agrees with that reading',
    yoyu.traitEffects?.map((e) => e.type), ['electronic_success_change_responder_stance_optional']);
  check('and it names the Stance the switch ends in', yoyu.traitEffects?.[0].stance, 'offensive');

  // ---------- the three lines the ruling rests on ----------
  //
  // 电子对抗投骰 is fixed as "Electronic Counter Roll" off a SECOND card rather
  // than a guess: ZPA-38 prints the phrase in zh against the phrase in en.
  check('ZPA-38 fixes 电子对抗投骰 as the Electronic Counter Roll',
    [/电子对抗投骰/.test(firewatch.traitDescription.zh), /Electronic Counter Roll/i.test(firewatch.traitDescription.en)],
    [true, true]);
  // 本机 — THIS unit — puts Yoyu at that roll, and FAQ O5 calls it the roll a
  // unit makes passively while being targeted: the RESPONDER's.
  check('LPA-22 zh puts Yoyu at 本机, the unit making the roll',
    /当本机电子对抗投骰成功时/.test(yoyu.traitDescription.zh), true);
  // 对方机甲 — the OTHER party's Mech — is who switches, which is what makes the
  // printed English "the Responder mech" a slip for 对方 rather than a rule.
  check('and names 对方机甲, the other party, as the Mech that switches',
    /可使对方机甲切换为攻击姿态/.test(yoyu.traitDescription.zh), true);
  // jp says it again and more plainly still: the enemy Mech that CONDUCTED the
  // counter-roll, which on the responder reading is the Initiator.
  check('and jp names the enemy Mech that CONDUCTED the counter-roll',
    /対抗ロールを行った敵機甲/.test(yoyu.traitDescription.jp), true);

  // ---------- the reader, against the real cards ----------
  const mech = (uid, side, pilotId, over = {}) => ({
    uid, side, kind: 'mech', label: `M${uid}`, col: 3, row: 3, size: 3, facing: 0,
    stance: 'defensive', mech: { torso: '002', pilot: pilotId }, partStates: { torso: 'intact' }, ...over,
  });
  // uid 1 opens the Electronic Attack; uid 2 is Yoyu, the Responder answering it.
  const roll = (over = {}) => ({
    initiatorUid: 1, responderUid: 2, actionId: 'X_A',
    initRoll: [0], respRoll: [0], initFocused: false, respFocused: false, provoke: null, ...over,
  });
  const world = (over = {}) => [mech(1, 's1', 'ZPA-38'), mech(2, 's2', 'LPA-22', over)];

  // THE POSITIVE CASE. Yoyu held the Counter-roll — initiatorWins false — so
  // the offer stands, and it stands against the INITIATOR.
  const offer = A.provokeOffer(data, world(), roll(), false);
  check('Provoke fires for a Yoyu that WINS as Responder', !!offer, true);
  check('and it targets the INITIATOR', offer?.uid, 1);
  check('and never Yoyu itself, which is what the printed English reads as',
    offer?.uid === 2, false);

  // THE PILOT. Swap Yoyu for another real pilot and nothing is offered — the
  // assertion a reader keyed on the wrong card would fail.
  check('a Responder with a different pilot is offered nothing',
    A.provokeOffer(data, [mech(1, 's1', 'ZPA-38'), mech(2, 's2', 'FPA-05')], roll(), false), null);
  // And the trait does not travel with the SEAT: Yoyu sitting in the Initiator's
  // chair is not what this reading fires on.
  check('and Yoyu in the Initiator seat is offered nothing either',
    A.provokeOffer(data, [mech(1, 's1', 'LPA-22'), mech(2, 's2', 'FPA-05')], roll(), false), null);

  // THE VERDICT. "When Electronic Counter Roll is successful" — Yoyu's own. The
  // Initiator taking the tie is a Yoyu LOSS (4.11.2) and offers nothing.
  check('Provoke does NOT fire when Yoyu LOSES', A.provokeOffer(data, world(), roll(), true), null);
  check('nor before both sides have rolled',
    A.provokeOffer(data, world(), roll({ respRoll: null }), false), null);
  check('nor before the Initiator has rolled',
    A.provokeOffer(data, world(), roll({ initRoll: null }), false), null);

  // ASKED ONCE. `provoke` is what a checkpoint carries back (script.test.mjs
  // owns that round-trip), and a re-offer after a resync would put the same
  // question twice.
  check('an accepted offer is not offered again',
    A.provokeOffer(data, world(), roll({ provoke: 'taken' }), false), null);
  check('and neither is a declined one — a decline closes the question',
    A.provokeOffer(data, world(), roll({ provoke: 'passed' }), false), null);

  // ---------- what may be switched ----------
  const why = (initiator, over = {}) => A.provokeWhy(data, mech(2, 's2', 'LPA-22', over), initiator);
  check('an enemy Mech in Defensive Stance may be switched', why(mech(1, 's1', 'ZPA-38')), null);
  // 对方机甲 is a MECH. A Drone plays the Stance printed on its card and has no
  // dial to turn, which is the line setStance holds too.
  check('a Drone has no Stance to switch',
    /Only a Mech has a Stance to switch/.test(why({ uid: 1, side: 's1', kind: 'drone', label: 'D1', stance: 'offensive', partStates: { main: 'intact' } })), true);
  check('an ALLY is never the target — 对方 is the other party',
    /ENEMY Mech/.test(why(mech(1, 's2', 'ZPA-38'))), true);
  // 4.1.1: leaving Shutdown Stance takes a Reboot, and nothing on this card buys
  // one. Provoke can push a Mech into Offensive Stance; it cannot wake it.
  check('a Shut Down Mech is not woken by Provoke (4.1.1)',
    /Reboot \(4\.1\.1\)/.test(why(mech(1, 's1', 'ZPA-38', { stance: 'shutdown' }))), true);
  check('and a Mech already in Offensive Stance has nothing to switch',
    /already in Offensive Stance/.test(why(mech(1, 's1', 'ZPA-38', { stance: 'offensive' }))), true);
  check('a destroyed Mech has no Stance to change',
    /destroyed Mech/.test(why(mech(1, 's1', 'ZPA-38', { partStates: { torso: 'destroyed' } }))), true);

  // ---------- the wiring, which is where this class of card dies ----------
  //
  // Two Electronic Warfare implementations share NO code — freeplay's
  // ElectronicHelper runs its own contest in combat.ts, the Match Centre drives
  // shared `script.counter` from matchhud.ts — so a rule wired to one of them is
  // live on one page, which is this codebase's signature bug.
  const cmds = src('commands.ts'), combatSrc = src('combat.ts'), hudSrc = src('matchhud.ts');
  check('units.ts dispatches on the CARD ID, as every phase-7 reader does',
    /pilotIs\(data, responder, 'LPA-22'\)/.test(units), true);
  // NOT a trait-name or trait-text regex, and this is the assertion that keeps
  // it that way. `traitDescription` is the only field such a helper could match
  // on, and eyesAreHeavyHits's own regex already matches LPA-24 Sealock's
  // Chinese trait text — which is why partSays skips slot === 'pilot'. The
  // names collide too ("CQC" is both ZPA-35 and card 017's part passive).
  //
  // ONE rules reader is allowed to match pilot trait text and it is pinned by
  // name here, because it earns it: 4.15.4's Command-Token spend has to see
  // FOUR effects and two of them are pilot traits with no Action to read. Every
  // rule reader added since — this one included — goes through the card id.
  const rulesReaders = units + cmds + combatSrc + hudSrc + src('main.ts') + src('rules.ts') + src('melee.ts');
  check('and the only rules reader matching pilot trait TEXT is the 4.15.4 Command sweep',
    (rulesReaders.match(/traitDescription\?\./g) ?? []).length, 2);
  check('which is textConsumesCommand, and nothing else reads the field',
    /textConsumesCommand\(pilot\.traitDescription\?\.zh, pilot\.traitDescription\?\.en\)/.test(units), true);

  check('commands.ts carries the answer as a command',
    /kind: 'provoke'; seat: Side; uid: number; targetUid: number; take: boolean/.test(cmds), true);
  check('and check() gates it on the one shared reader',
    /const why = provokeWhy\(data, t, target\);/.test(cmds), true);
  // The Stance is written by the COMMAND and by nothing else: it is a
  // fingerprinted token field, so a page assigning it directly is the desync.
  check('and apply() is the only place the Stance is turned',
    (cmds.match(/target\.stance = 'offensive';/g) ?? []).length, 1);
  check('and no page turns it itself',
    /stance = 'offensive'/.test(combatSrc + hudSrc + src('main.ts')), false);
  // Yoyu answers as the Responder of THIS Counter-roll, and check() says so —
  // the half a stale networked client could otherwise get wrong.
  check('check() binds the answer to the Counter-roll it claims',
    /c\.responderUid !== cmd\.uid/.test(cmds) && /c\.initiatorUid !== cmd\.targetUid/.test(cmds), true);

  // The Match Centre no longer reads the offer itself. Electronic Warfare is
  // resolved in the COMBAT WINDOW now, so the one renderer asks the question on
  // both screens and the page only carries the answer.
  check('the Match Centre reads no offer of its own',
    /provokeOffer\(/.test(hudSrc), false);
  // Both answers travel, because a decline has to close the question on the far
  // screen too — the offer lives in shared state precisely so both seats agree.
  check('and sends BOTH answers as the same command',
    /kind: 'provoke', seat: resp\.side, uid: resp\.uid, targetUid: init\.uid, take \}/.test(hudSrc), true);
  check('and offers it to YOYU\'s seat, not the Initiator\'s',
    /take\.disabled = !this\.mayPress\('resp'\);/.test(combatSrc), true);

  check('freeplay\'s ElectronicHelper reads the same rule',
    /provokeWhy\(this\.data, c\.responder, c\.initiator\) === null/.test(combatSrc), true);
  check('and sends the same command',
    /kind: 'provoke', seat: c\.responder\.side, uid: c\.responder\.uid, targetUid: c\.initiator\.uid, take: true/.test(combatSrc), true);
  // The printed "may" is a real decision here, unlike Pulse, Ion, Fierce Assault
  // and Pursuit: Offensive Stance is a trade, so forcing it can HELP the enemy.
  // Both boards therefore ASK, and an applied-not-offered wiring would show up
  // as the second button going missing.
  check('and offers the decline as well as the switch',
    /Leave its Stance alone/.test(combatSrc) && /leave\.disabled = !this\.mayPress\('resp'\);/.test(combatSrc), true);
}

// ---------- Low Profile: the note credits the arm that actually fired ----------
//
// FOUR things grant Low Profile in resolve() — a Token, an aura granting the
// keyword, FPA-06-2's Power Concealment, and ZHDR-204's Misty Eagle — and the
// line under the tally names a cause so the shooter is not left watching Eyes
// evaporate with nothing on screen to blame.
//
// The attribution used to be picked independently of the disjunction: whichever
// of the two invisible sources happened to be present got the credit. A
// defender already wearing a lowProfile Token AND piloted by a KeyHole inside a
// friendly aura was reported as "Power Concealment" when the Token alone
// sufficed. No rules consequence — the dice are identical either way — but it
// named a cause that was not load-bearing, and the Token is the ONE source the
// shooter can see sitting on the target.
//
// Pinned at the source because resolve() wants the DOM and cannot be sliced,
// which is the same reason the Power Concealment wiring above is pinned here.
{
  check('the Token is hoisted out of the disjunction so the note can read it',
    /const lpToken = statusCount\(c\.defender\.statuses, 'lowProfile'\) > 0;/.test(combat), true);
  // lpToken FIRST, and its arm is the empty string: nothing is credited when
  // something the shooter can already see explains the swap.
  check('and it leads the attribution, crediting nobody',
    /const why = lpToken\s*\?\s*''/.test(combat), true);
  check('with the two invisible sources behind it, never in front',
    /const why = lpToken[\s\S]{0,40}: mistyEagle[\s\S]{0,400}: concealed/.test(combat), true);
  // Narrowing the ATTRIBUTION must not narrow the RULE: all four arms still
  // grant Low Profile, whatever the note ends up saying about it.
  check('while the rule itself still reads all four sources',
    /\(lpToken[\s\S]{0,200}'low_profile'\)[\s\S]{0,40}\|\| !!concealed\s*\|\| !!mistyEagle\);/.test(combat), true);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
