// Armor Piercing X — rulebook 6.2.1 (book p.92), glossary line:
// "Target removes X [White] dice before rolling (defense dice removed pre-roll)."
//
// The keyword was entirely unmodelled: a grep for /Armor Piercing|armorPiercing/
// over app/src returned nothing at all, while eight Parts and one pilot carried
// it on real cards. This file covers the three things that had to be true for
// it to be wired and not merely written:
//
//   1. THE CARD AUDIT. A grep for 穿甲 over cards.json returns ELEVEN cards and
//      only NINE of them carry the keyword — the other two match on the NAME of
//      a shell ("PK3末敏穿甲弹"), not on any rule. Every carrier is pinned here,
//      with WHERE it holds it, because the keyword and the description disagree
//      about which cards have it in both directions (see the block below).
//   2. THE READER, run against the real cards rather than against fixtures
//      shaped to suit it.
//   3. THE WIRING, driven through the real AttackHelper. The assertion that
//      matters is the White count handed to `defenseRoller` — that call is the
//      ONLY thing that puts `callDefense` on the wire, so it is literally the
//      number the defending player is asked to roll in the Match Centre. A
//      reader test would have passed on a reader nothing called; this project
//      has shipped that bug (086_B Ammo Delivery) and does not intend to again.
//
// The Match Centre's own defence panel is sliced out and executed at the bottom,
// with the REAL reader imported into it, for the fourth thing: the defending
// seat has to be TOLD. A pool that silently shrinks reads as a bug at the table.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { findButtons, installDom, label, loadCombat, makeEl, textOf, settle } from './_combatdrive.mjs';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}, got ${g}`); }
};

installDom();
const { AttackHelper, data, dice } = await loadCombat('armorpiercing');

// The real reader, bundled straight out of units.ts. Used by the card audit
// below AND injected into the sliced Match Centre panel at the bottom, so both
// halves of this file ask the shipped function rather than a copy of it.
const entry = new URL('./_apunits.entry.ts', import.meta.url);
const outfile = new URL('./_apunits.bundle.mjs', import.meta.url);
// multiTargetLimit rides along so section 5 can ask the SHIPPED reader what a
// Multi-Target Part is worth rather than hand-writing a cap the app would never
// produce.
writeFileSync(entry, "export { armorPiercing, armorPiercingNote, multiTargetLimit } from '../src/units';\n");
await build({
  entryPoints: [fileURLToPath(entry)], outfile: fileURLToPath(outfile),
  bundle: true, format: 'esm', platform: 'browser', logLevel: 'silent',
  define: { 'import.meta.env.BASE_URL': '"/"' },
});
const { armorPiercing, armorPiercingNote, multiTargetLimit } = await import(`${outfile.href}?t=${Date.now()}`);

const cards = JSON.parse(readFileSync(new URL('../../data/cards.json', import.meta.url), 'utf8'));
const cardList = Array.isArray(cards) ? cards : cards.cards ?? [];
const byId = (id) => cardList.find((c) => c.id === id);

console.log('Armor Piercing X — 6.2.1\n');

// ---------- 1. the card audit ----------
//
// WHERE EACH CARD HOLDS IT, and the reason this table is worth its length:
// PARTS print their keywords as {key,en} and ACTIONS print {inline}, and the two
// disagree in BOTH directions on real cards.
//   * 032 R-20 (L) carries {inline:'穿甲X'} on its Action and does NOT list the
//     keyword at Part level at all.
//   * ZHRA-202_B (MR24 Power Shot) is the mirror image: its keywords array is
//     EMPTY, and only the description says 穿甲1.
// So neither keyword field is a complete index of the keyword, which is why the
// reader takes the printed DESCRIPTION line — the only place that is both
// complete and carries the number.
const partKeyword = (c) => (c.keywords ?? []).some((k) => (k.key ?? k.inline ?? '') === '穿甲X');
const inlineOn = (c) => (c.actions ?? []).filter((a) => (a.keywords ?? [])
  .some((k) => (k.inline ?? k.key ?? '') === '穿甲X')).map((a) => a.id);
// Asked through the SHIPPED reader with a pilotless Mech, so `printed` is the
// value the app reads and not a second regex written to agree with it.
const nobody = { uid: 99, side: 's1', kind: 'mech', mech: {}, partStates: {}, statuses: [] };
const printedOn = (c) => (c.actions ?? [])
  .map((a) => [a.id, armorPiercing(data, nobody, a).printed])
  .filter(([, x]) => x > 0);

const HITS = ['ZHRA-101', 'ZHRA-102', 'ZHRA-201', 'ZHRA-202', '032', '033', '043',
  'ZHDR-106', 'FPA-02', 'ZHLA-201', 'ZHAM-003'];

check('the grep for 穿甲 over cards.json still returns exactly these eleven cards',
  cardList.filter((c) => /穿甲|装甲貫通|Armou?r Piercing/i.test(JSON.stringify(c))).map((c) => c.id).sort(),
  [...HITS].sort());

// Card by card: keyword at Part level, keyword inline on the Action, and what
// the reader gets off the printed line.
const audit = (id) => {
  const c = byId(id);
  if (!c) throw new Error(`${id} is gone from the card data`);
  return { part: partKeyword(c), inline: inlineOn(c), printed: printedOn(c) };
};

check('ZHRA-101 MR14 Railgun — Part keyword, both Actions inline, both print 1',
  audit('ZHRA-101'),
  { part: true, inline: ['ZHRA-101_A', 'ZHRA-101_B'], printed: [['ZHRA-101_A', 1], ['ZHRA-101_B', 1]] });
check('ZHRA-102 MR16 Railgun — the same shape',
  audit('ZHRA-102'),
  { part: true, inline: ['ZHRA-102_A', 'ZHRA-102_B'], printed: [['ZHRA-102_A', 1], ['ZHRA-102_B', 1]] });
check('ZHRA-201 MR21 Railgun — the same shape',
  audit('ZHRA-201'),
  { part: true, inline: ['ZHRA-201_A', 'ZHRA-201_B'], printed: [['ZHRA-201_A', 1], ['ZHRA-201_B', 1]] });
// THE CARD THAT BREAKS A KEYWORD READER. _B carries no keywords at all and
// still prints "· 穿甲1 · 狙击 · 静默" on its line.
check('ZHRA-202 MR24 Railgun — _B holds it ONLY in the description, with an empty keywords array',
  audit('ZHRA-202'),
  { part: true, inline: ['ZHRA-202_A'], printed: [['ZHRA-202_A', 1], ['ZHRA-202_B', 1]] });
check('...and that empty array is really empty, not merely missing the keyword',
  byId('ZHRA-202').actions.find((a) => a.id === 'ZHRA-202_B').keywords, []);
// THE CARD THAT BREAKS A PART-KEYWORD READER, in the opposite direction.
check('032 R-20 (L) — no Part keyword at all, the Action carries it',
  audit('032'), { part: false, inline: ['032_A'], printed: [['032_A', 1]] });
check('033 R-20 (R) — its twin DOES list it at Part level',
  audit('033'), { part: true, inline: ['033_A'], printed: [['033_A', 1]] });
check('043 R-35 Heavy Railgun',
  audit('043'), { part: true, inline: ['043_A'], printed: [['043_A', 1]] });
// No English description at ALL on this one — zh 穿甲1 and jp 装甲貫通1 only.
check('ZHDR-106 Ballista — only _A, and its English description does not exist',
  audit('ZHDR-106'), { part: true, inline: ['ZHDR-106_A'], printed: [['ZHDR-106_A', 1]] });
check('...so the Ballista is read off a non-English line',
  byId('ZHDR-106').actions.find((a) => a.id === 'ZHDR-106_A').description.en, undefined);

// THE TWO FALSE POSITIVES. Both matched the grep on the NAME of the shell the
// mortar fires — 穿甲弹, "armour-piercing shell" — and neither carries the rule.
// Pinned so a later reader that widened to 徹甲 (the jp spelling in that same
// name, followed by a digit: "徹甲弾1発") cannot hand them a phantom AP 1.
check('ZHLA-201 GSD7 Mortar is NOT a carrier — it only names the shell it launches',
  audit('ZHLA-201'), { part: false, inline: [], printed: [] });
check('ZHAM-003 PK3 Sensor-fused Munition is NOT a carrier — 穿甲 is in its own name',
  audit('ZHAM-003'), { part: false, inline: [], printed: [] });
check('...and 穿甲 really is only in that card\'s name', byId('ZHAM-003').name.zh, 'PK3末敏穿甲弹');

// FPA-02 Spike: a pilot, so no Action of its own and nothing for the printed
// reader to find. It is dispatched by card id, and the data backs the claim.
check('FPA-02 Spike carries no keyword and no Action — it is a pilot',
  audit('FPA-02'), { part: false, inline: [], printed: [] });
check('...and its trait says Firing Action, Armor Piercing 1',
  /Firing Action.*Armor Piercing 1/i.test(byId('FPA-02').traitDescription.en), true);
check('...with the publisher\'s own structured effect agreeing',
  byId('FPA-02').traitEffects, [{ type: 'firing_gain_armor_piercing', value: 1 }]);

// THE PLACEHOLDER TRAP, stated as data. Every keyword entry in the set prints a
// LITERAL X, so `/穿甲\s*(\d+)/` over the KEYWORD matches nothing at all — the
// shape interceptCapacity uses for 拦截3 would have found the keyword and read
// X as zero on all eight Parts.
check('every Armor Piercing keyword entry in the set is the bare placeholder, X and all',
  [...new Set(cardList.flatMap((c) => [
    ...(c.keywords ?? []),
    ...(c.actions ?? []).flatMap((a) => a.keywords ?? []),
  ]).map((k) => k.key ?? k.inline ?? '').filter((s) => s.startsWith('穿甲')))],
  ['穿甲X']);
check('...so a digit-hunting regex over the keyword string finds nothing', /穿甲\s*(\d+)/.test('穿甲X'), false);

// Both English spellings are on real cards. The reader has to accept either.
check('the English prints "Armor Piercing" on 043 and "Armour Piercing" on ZHRA-101_B',
  [byId('043').actions[0].description.en.includes('Armor Piercing'),
    byId('ZHRA-101').actions.find((a) => a.id === 'ZHRA-101_B').description.en.includes('Armour Piercing')],
  [true, true]);
check('nine cards carry the keyword and the other two of the eleven do not',
  cardList.filter((c) => printedOn(c).length || c.id === 'FPA-02').map((c) => c.id).sort(),
  ['032', '033', '043', 'FPA-02', 'ZHDR-106', 'ZHRA-101', 'ZHRA-102', 'ZHRA-201', 'ZHRA-202']);

// ---------- 2. the reader, and the Spike grant ----------

const AP_FIRE = byId('ZHRA-101').actions.find((a) => a.id === 'ZHRA-101_A');   // MR14 Burst Fire, AP 1
const AP_QUIET = byId('ZHRA-202').actions.find((a) => a.id === 'ZHRA-202_B');  // the empty-keywords one
const PLAIN_FIRE = byId('545').actions.find((a) => a.id === '545_A');          // Ls297 Dual Autocannon, no AP
const MELEE = byId('ZHRA-103').actions.find((a) => a.id === 'ZHRA-103_A');     // M115 Spear
if (!AP_FIRE || !AP_QUIET || !PLAIN_FIRE || !MELEE) throw new Error('a fixture card changed id; re-pick it');
check('the non-AP control really is a Firing Action', PLAIN_FIRE.type, 'Firing');
check('and the melee control really is Melee', MELEE.type, 'Melee');

const spike = { uid: 5, side: 's1', kind: 'mech', mech: { pilot: 'FPA-02' }, partStates: {}, statuses: [] };
const plainPilot = { uid: 6, side: 's1', kind: 'mech', mech: { pilot: 'FPA-03' }, partStates: {}, statuses: [] };

check('an MR14 shot pierces 1', armorPiercing(data, nobody, AP_FIRE), { total: 1, printed: 1, granted: 0 });
check('the MR24 Power Shot pierces 1 too, off the description alone', armorPiercing(data, nobody, AP_QUIET).total, 1);
check('a non-AP Firing Action pierces nothing', armorPiercing(data, nobody, PLAIN_FIRE), { total: 0, printed: 0, granted: 0 });
check('Spike firing a non-AP gun gains 1 (FPA-02)', armorPiercing(data, spike, PLAIN_FIRE), { total: 1, printed: 0, granted: 1 });
// THE STACKING RULING, written down: they ADD.
check('Spike firing an MR14 pierces 2 — the grant STACKS with the printed value',
  armorPiercing(data, spike, AP_FIRE), { total: 2, printed: 1, granted: 1 });
check('Spike in MELEE gains nothing — the trait says Firing Action',
  armorPiercing(data, spike, MELEE), { total: 0, printed: 0, granted: 0 });
check('another pilot grants nothing', armorPiercing(data, plainPilot, PLAIN_FIRE).granted, 0);
check('a Drone firing the same Action is unaffected by any pilot question',
  armorPiercing(data, { uid: 7, side: 's1', kind: 'drone', cardId: '545', partStates: {}, statuses: [] }, AP_FIRE).total, 1);
// The breakdown is what the log prints, so it is asserted rather than assumed.
check('the note names both sources when both apply',
  armorPiercingNote(armorPiercing(data, spike, AP_FIRE), 'Target'),
  'Armor Piercing 2 (1 printed + 1 from FPA-02 Spike\'s Eagle Eye, which add): Target removes 2 White dice before rolling (6.2.1).');
check('and says "die" for one',
  /removes 1 White die before rolling/.test(armorPiercingNote(armorPiercing(data, nobody, AP_FIRE), 'Target')), true);

// ---------- 2b. the three language arms, one at a time ----------
//
// SAID PLAINLY FIRST, because it is the honest finding and not a gap this file
// papers over: NO card in the box isolates any single arm of this reader.
// Driven, arm by arm (round-5 reviewer, 2026-08-19): dropping the optional u
// from `Armou?r`, or deleting the English, Chinese or Japanese alternative
// outright, or dropping any one of the three description fields the loop walks,
// leaves all twelve carrier Actions still reading 1. Every one of them prints
// the value in Chinese AND in Japanese, and eleven of the twelve print it in
// English as well, so any single arm removed simply falls through to the next.
// A fixture claiming "this card needs the Chinese arm" would be a fixture
// asserting nothing.
//
// WHAT CAN HONESTLY BE PINNED is the arm rather than the card: hand the shipped
// reader ONE of a real card's printed lines and withhold the other two. The
// text is the card's own, unedited, so this is not a synthetic description; it
// is the same printed line the app reads, with the fallbacks that mask the arm
// taken away. Nothing in the app ever withholds a line, and that is the point:
// the redundancy is in the DATA, so the data has to be set aside to see the
// reader at all.
{
  const only = (act, lang) => armorPiercing(data, nobody,
    { ...act, description: { [lang]: act.description?.[lang] } }).printed;
  const carriers = cardList.flatMap((c) => (c.actions ?? [])
    .filter((a) => armorPiercing(data, nobody, a).printed > 0));
  check('twelve Actions in the box print a value for this reader to find', carriers.length, 12);
  check('the CHINESE line alone answers for every one of them',
    carriers.filter((a) => only(a, 'zh') === 1).length, 12);
  check('the JAPANESE line alone answers for every one of them too',
    carriers.filter((a) => only(a, 'jp') === 1).length, 12);
  check('the ENGLISH line alone answers for all but the Ballista, which prints none',
    carriers.filter((a) => only(a, 'en') !== 1).map((a) => a.id), ['ZHDR-106_A']);

  // THE BRITISH SPELLING, on the one card in the box that prints it. With the
  // optional u gone the English arm misses this line and the value arrives off
  // the CHINESE one instead. The number is the same today, so nothing visible
  // changes, which is exactly why it needs an assertion: this project's ruling
  // is that printed English outranks the Chinese-derived text, and a silent
  // demotion of the English line is how that ruling would stop holding.
  const ARMOUR = byId('ZHRA-101').actions.find((a) => a.id === 'ZHRA-101_B');
  check('ZHRA-101_B prints the British spelling on its English line',
    /Armour Piercing 1/.test(ARMOUR.description.en), true);
  check('...and its ENGLISH line alone still reads 1, u and all', only(ARMOUR, 'en'), 1);

  // THE PRECEDENCE, and the one place here where a written-out fixture earns
  // its keep: the ORDER of the three arms cannot be observed from any card,
  // because all twelve agree on the number in every language they print. So the
  // disagreement the ruling is about is written out. Labelled as invented, not
  // dressed up as data.
  const editions = { id: 'FAKE_A', type: 'Firing', description: { en: '· Armor Piercing 3.', zh: '· 穿甲1', jp: '· 装甲貫通2' } };
  check('where the editions disagree the reader takes the ENGLISH number',
    armorPiercing(data, nobody, editions).printed, 3);
  check('...the Chinese one when there is no English line',
    armorPiercing(data, nobody, { ...editions, description: { zh: editions.description.zh, jp: editions.description.jp } }).printed, 1);
  check('...and the Japanese one when there is neither',
    armorPiercing(data, nobody, { ...editions, description: { jp: editions.description.jp } }).printed, 2);
  check('...while a line in none of the three still reads nothing',
    armorPiercing(data, nobody, { ...editions, description: { en: '· Pierces armor thoroughly, 4 times over.' } }).printed, 0);
}

// ---------- 3. the wiring: the pool the defender is actually asked for ----------

// A real loadout on both sides. Torso 172 has Armor 5, the left hand ZHLA-201
// has Armor 1 — the low one is here so the floor can be driven onto 0.
const defender = (over = {}) => ({
  uid: 2, side: 's2', kind: 'mech', cardId: '172', label: 'Defender', col: 6, row: 1,
  size: 3, facing: 0, aerial: false, stance: 'offensive', link: 3, deployed: true,
  mech: { torso: '172', leftHand: 'ZHLA-201' },
  partStates: { torso: 'intact', leftHand: 'intact' }, ammo: {}, statuses: [], log: [], ...over,
});
const attacker = (pilot) => ({
  uid: 1, side: 's1', kind: 'mech', cardId: '172', label: 'Attacker', col: 1, row: 1,
  size: 3, facing: 0, aerial: false, stance: 'offensive', link: 3, deployed: true,
  mech: { torso: '172', rightHand: 'ZHRA-101', backpack: '545', ...(pilot ? { pilot } : {}) },
  partStates: { torso: 'intact', rightHand: 'intact', backpack: 'intact' }, ammo: {}, statuses: [], log: [],
});

// Drives the shipped helper up to the point where the defence pool is settled,
// and hands back everything the two screens would show: the pool, the log the
// mirror publishes, and the attacker's rendered window.
function poolFor(action, { pilot = null, def = defender(), slot = 'torso' } = {}) {
  const atk = attacker(pilot);
  const root = makeEl('div');
  const views = [];
  const helper = new AttackHelper(data, dice, root,
    () => {}, () => {}, () => {}, () => {}, () => {}, () => {}, () => {});
  helper.tokens = () => [atk, def];
  helper.terrain = () => [];
  helper.smoke = () => [];
  helper.publishView = (v) => views.push(v);
  helper.start(atk, action, def, '');
  helper.pickPart(slot);
  const c = helper.ctx;
  return { helper, ctx: c, root, views, atk, def, white: c.defensePool.white, blue: c.defensePool.blue };
}

// The baseline, so every later number is a delta against a real card rather
// than against an expectation. Torso 172 prints Armor 5.
const base = poolFor(PLAIN_FIRE);
check('the fixture never wanders into the Designate step', base.ctx.step, 'attack');
check('a non-AP Firing Action leaves the Armor alone (172 prints Armor 5)', base.white, 5);

const pierced = poolFor(AP_FIRE);
check('an MR14 attack takes 1 White off the defender (Armor Piercing 1)', pierced.white, 4);
check('...which is exactly one less than the same defender rolled a moment ago', base.white - pierced.white, 1);
check('the MR24 Power Shot does it too, on a description-only keyword', poolFor(AP_QUIET).white, 4);
check('and Blue is untouched — the keyword names White', pierced.blue, base.blue);

// The Spike arm, through the same board.
check('a Spike firing a non-AP gun takes 1 off', poolFor(PLAIN_FIRE, { pilot: 'FPA-02' }).white, 4);
check('a Spike firing an MR14 takes 2 off — the stacking ruling, on the board', poolFor(AP_FIRE, { pilot: 'FPA-02' }).white, 3);
check('a Spike in MELEE takes nothing off', poolFor(MELEE, { pilot: 'FPA-02' }).white, 5);
check('...and the same Melee swing without Spike is identical', poolFor(MELEE).white, 5);
check('a different pilot firing the same gun is not a Spike', poolFor(PLAIN_FIRE, { pilot: 'FPA-03' }).white, 5);

// Fragile is the neighbouring removal and the two are meant to stack: they are
// separate sources of the same pre-roll subtraction, and nothing on either
// prints a non-stacking clause.
const frail = defender({ statuses: ['fragile'] });
check('Fragile alone still removes its own die', poolFor(PLAIN_FIRE, { def: frail }).white, 4);
check('Fragile and Armor Piercing STACK', poolFor(AP_FIRE, { def: frail }).white, 3);
check('Fragile, Armor Piercing and Spike all stack', poolFor(AP_FIRE, { pilot: 'FPA-02', def: frail }).white, 2);

// THE FLOOR. ZHLA-201's Armor is 1, so one Fragile Token empties the pool and
// Armor Piercing has nothing left to take — it must clamp, not go negative.
const bare = defender({ statuses: ['fragile'] });
check('the low-Armor Part is the 1-Armor one', byId('ZHLA-201').armor, 1);
check('Armor 1 minus one Fragile is already 0', poolFor(PLAIN_FIRE, { def: bare, slot: 'leftHand' }).white, 0);
check('and Armor Piercing on top of that clamps at 0 rather than going negative',
  poolFor(AP_FIRE, { def: bare, slot: 'leftHand' }).white, 0);
check('a Spike firing an MR14 into it is still 0, not -2',
  poolFor(AP_FIRE, { pilot: 'FPA-02', def: bare, slot: 'leftHand' }).white, 0);

// ---------- the number that goes on the WIRE ----------
//
// `defenseRoller` is the Match Centre hook: match.ts sets it, and every call is
// one `callDefense` command, which is the ONLY thing that puts `script.combat`
// on the board — and `script.combat.white` is the number the defending player's
// button rolls. Anything that reduced the pool only in the attacker's own render
// would pass every assertion above and still ask the defender for full Armor.
{
  const atk = attacker('FPA-02');
  const def = defender();
  const root = makeEl('div');
  const calls = [];
  const helper = new AttackHelper(data, dice, root,
    () => {}, () => {}, () => {}, () => {}, () => {}, () => {}, () => {});
  helper.tokens = () => [atk, def];
  helper.terrain = () => [];
  helper.smoke = () => [];
  helper.focusRemote = (d) => d.side === 's2';
  helper.defenseRoller = (poolIn, _a, d) => {
    calls.push({ white: poolIn.white, blue: poolIn.blue, defender: d.label });
    return new Promise(() => {});
  };
  helper.start(atk, AP_FIRE, def, '');
  helper.pickPart('torso');
  const c = helper.ctx;
  c.attackRoll = Array.from({ length: 2 }, () => ({ color: 'red', face: 0, selected: false }));
  c.step = 'defense';
  helper.render();
  await settle();
  check('the defending seat is asked for exactly one roll', calls.length, 1);
  check('...for the unit being shot at', calls[0]?.defender, 'Defender');
  check('...and the White that crosses the wire is the PIERCED number, not the printed Armor',
    calls[0]?.white, 3);
}

// ---------- the narration, on both surfaces ----------

// The DEFENCE STEP is where the pool is drawn and where the explanation has to
// sit, beside the Fragile and Early Warning lines. Reaching it needs an Attack
// Roll on the context first, the same way surplusdefense.test.mjs reaches it.
function defenceStepHtml(p) {
  p.ctx.attackRoll = Array.from({ length: 2 }, () => ({ color: 'red', face: 0, selected: false }));
  p.ctx.step = 'defense';
  p.helper.render();
  return textOf(p.root).join('\n');
}
// The rendered PARAGRAPH, not the whole step: the step also draws the running
// log, and a plain search over it would pass on the log line alone and claim
// the pool was explained when nothing sat next to it. Keyed on the paragraph's
// own icon, which nothing else in the step uses.
const apLine = (html) => {
  const i = html.indexOf('🎯');
  return i < 0 ? '' : html.slice(i, html.indexOf('</p>', i));
};
{
  const shown = apLine(defenceStepHtml(poolFor(AP_FIRE)));
  check('the defence step draws its own line above the pool',
    /Armor Piercing 1: Defender removes 1 White die before rolling \(6\.2\.1\)/.test(shown), true);
  check('...and says the dice are already off the pool below, the way the Fragile line does',
    /−1 White.*already taken off the pool below/.test(shown), true);
  const spikeShown = apLine(defenceStepHtml(poolFor(AP_FIRE, { pilot: 'FPA-02' })));
  check('...and breaks a Spike\'s two dice apart on the same line',
    /Armor Piercing 2 \(1 printed \+ 1 from FPA-02 Spike/.test(spikeShown), true);
  check('a non-AP attack draws no such line on the defence step',
    apLine(defenceStepHtml(poolFor(PLAIN_FIRE))), '');
}
check('the attacker\'s own window carries it in the log as well',
  /Armor Piercing 1.*removes 1 White die before rolling \(6\.2\.1\)/.test(textOf(pierced.root).join('\n')),
  true);
check('a non-AP attack says nothing about it',
  /Armor Piercing/.test(textOf(base.root).join('\n')), false);

// THE LOG IS THE WIRE. publishView ships CombatView.log to the defending seat's
// mirror; the render above never leaves the attacker's screen. This is the only
// route by which the player whose dice shrank learns why.
{
  const view = pierced.views[pierced.views.length - 1];
  check('the mirror the defender reads carries the Armor Piercing line',
    (view?.log ?? []).some((l) => /Armor Piercing 1/.test(l)), true);
  const spikeView = poolFor(AP_FIRE, { pilot: 'FPA-02' }).views.slice(-1)[0];
  check('...and names both sources when a Spike is firing',
    (spikeView?.log ?? []).some((l) => /1 printed \+ 1 from FPA-02 Spike/.test(l)), true);
  check('a non-AP attack puts no such line in the log',
    (base.views.slice(-1)[0]?.log ?? []).some((l) => /Armor Piercing/.test(l)), false);
}
// Said ONCE per sequence, not once per render: suggestedDefensePool runs again
// on every repaint and on every Designate, and a note living there would read
// as four separate removals.
{
  const p = poolFor(AP_FIRE);
  p.helper.render();
  p.helper.render();
  check('the line is logged once however many times the window repaints',
    p.ctx.log.filter((l) => /Armor Piercing/.test(l)).length, 1);
}

// ---------- 4. the Match Centre's defence panel, executed ----------
//
// The turn panel the DEFENDING seat sees. Sliced out of matchhud.ts and run,
// with the real reader imported into it — the shipped lines execute, so an
// `apNote` that was computed and never interpolated fails here.
//
// Cut ranges, checked for overlap before adding: this file takes ONE range out
// of matchhud.ts, defensePanel through panelHtml. Both markers are unique in
// the file. The stubs below are the four collaborators the panel closes over,
// and esc is mirrored rather than stubbed away because the panel's output is
// what is being asserted.
const hudSrc = readFileSync(new URL('../src/matchhud.ts', import.meta.url), 'utf8');
const cut = (s, a, b, what) => {
  const i = s.indexOf(a), j = s.indexOf(b, i);
  if (i < 0 || j < 0 || j <= i) throw new Error(`could not locate ${what}`);
  if (s.indexOf(a, i + 1) >= 0) throw new Error(`${what}: start marker is not unique`);
  return s.slice(i, j);
};
const panelSrc = cut(hudSrc,
  'function defensePanel(ctx: HudCtx): string {',
  'function panelHtml(ctx: HudCtx): string {',
  'the Match Centre defence panel');

const slice = `
import { armorPiercing, armorPiercingNote } from './_apunits.bundle.mjs';
type HudCtx = any; type Token = any;
// Mirrored from matchhud.ts line 104. Apostrophes are deliberately NOT escaped
// there, which is why the assertions below can read Spike's name straight.
function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function head(eyebrow: string, title: string, sub: string, _mine: boolean): string {
  return \`<head>\${eyebrow}|\${title}|\${sub}</head>\`;
}
function ensureScript(s: any): any { return s.script ?? (s.script = {}); }
// The real one also walks loanedParts; the fixture holds its weapons itself.
function actionOn(ctx: any, t: any, actionId: string): any {
  for (const id of Object.values(t.mech ?? {})) {
    const found = (ctx.data.byId.get(id)?.actions ?? []).find((a: any) => a.id === actionId);
    if (found) return found;
  }
  return undefined;
}
export ${panelSrc}`;
const sliceUrl = new URL('./_armorpiercing.slice.ts', import.meta.url);
writeFileSync(sliceUrl, slice);
const Panel = await import(`${sliceUrl.href}?t=${Date.now()}`);

const hudCtx = (action, pilot) => {
  const atk = attacker(pilot);
  const def = defender();
  return {
    data,
    state: {
      tokens: [atk, def],
      script: { combat: { attackerUid: 1, targetUid: 2, actionId: action.id, white: 3, blue: 0, faces: null } },
    },
  };
};

{
  const html = Panel.defensePanel(hudCtx(AP_FIRE, 'FPA-02'));
  check('the defending seat is told the keyword by name',
    /Armor Piercing 2/.test(html), true);
  check('...told who is taking the dice and how many',
    /Defender removes 2 White dice before rolling \(6\.2\.1\)/.test(html), true);
  check('...told that the number above it is already reduced',
    /already off the number above/.test(html), true);
  check('...and told which half came from the pilot',
    /1 printed \+ 1 from FPA-02 Spike/.test(html), true);
}
{
  const html = Panel.defensePanel(hudCtx(PLAIN_FIRE, null));
  check('a plain shot adds no line to the defence panel', /Armor Piercing/.test(html), false);
  check('...and the panel still asks for the roll', /Roll your defence/.test(html), true);
}

// ---------- 5. the SECOND sequence of a Multi-Target ----------
//
// WHY THIS BLOCK EXISTS. combat.ts calls noteArmorPiercing() from exactly two
// places: the single-target declaration in start(), and openSequence(). Every
// assertion above this line reaches the first one through helper.start(), so
// disabling the call in openSequence left the whole 68-file suite at exit 0
// (round-5 reviewer, 2026-08-19) even though openSequence is live code with
// three callers of its own: startMulti, the "Begin the attack" button on the
// split screen, and advanceMulti.
//
// NOT DEAD, and the asymmetry is the point: a Multi-Target opens ONE sequence
// per target and each target rolls its OWN defence, so each defending player
// has to be told separately why their White shrank. The log is the only route
// there, because publishMirror ships CombatView.log and the attacker's render
// never leaves the attacker's screen.
//
// THE FIXTURE, and why it takes a pilot. No card in the box prints Armor
// Piercing AND Multi-Target: the four Multi-Target Parts are 038, 546, 547 and
// 556, and the AP carriers are the eight Railgun-family Parts, with no overlap.
// FPA-02 Spike grants Armor Piercing 1 to any FIRING Action, and all four
// Multi-Target Actions are Firing, so the Spike is the ONLY way this
// combination is reachable at a real table as well as here.
{
  const MT = byId('038').actions.find((a) => a.id === '038_A');
  if (!MT) throw new Error('038_A is gone from the card data; re-pick the Multi-Target fixture');
  check('the Multi-Target fixture really is a Firing Action, which is what the Spike answers',
    [MT.type, MT.range], ['Firing', 8]);
  const cap = multiTargetLimit(MT);
  check('...and the shipped reader gives it a real cap', cap.limit, 3);
  check('...that no printed Armor Piercing card also carries, so the pilot is the only bridge',
    HITS.filter((id) => ['038', '546', '547', '556'].includes(id)), []);

  const multi = (pilot) => {
    const atk = {
      uid: 1, side: 's1', kind: 'mech', cardId: '172', label: 'Attacker', col: 0, row: 0,
      size: 3, facing: 0, aerial: false, stance: 'offensive', link: 3, deployed: true,
      mech: { torso: '172', rightHand: '038', ...(pilot ? { pilot } : {}) },
      partStates: { torso: 'intact', rightHand: 'intact' }, ammo: {}, statuses: [], log: [],
    };
    const foe = (uid, name, col) => defender({ uid, label: name, col, row: 0 });
    const one = foe(2, 'Alpha', 9);
    const two = foe(3, 'Bravo', 15);
    const root = makeEl('div');
    const views = [];
    const helper = new AttackHelper(data, dice, root,
      () => {}, () => {}, () => {}, () => {}, () => {}, () => {}, () => {});
    helper.tokens = () => [atk, one, two];
    helper.terrain = () => [];
    helper.smoke = () => [];
    helper.publishView = (v) => views.push(v);
    helper.startMulti(atk, MT, one, cap);
    return { helper, root, views, atk, one, two };
  };

  // Sequence 1, opened by startMulti itself. This is the door start() never
  // goes through, and it is already enough to catch the disabled call.
  const spike = multi('FPA-02');
  check('a Multi-Target declaration opens on the split screen', spike.helper.ctx.step, 'split');
  check('the FIRST sequence of a Multi-Target tells the defender about the pierced dice',
    spike.helper.ctx.log.filter((l) => /Armor Piercing 1 \(from FPA-02 Spike/.test(l)).length, 1);
  check('...naming the unit whose dice are going', /Alpha removes 1 White die before rolling \(6\.2\.1\)/
    .test(spike.helper.ctx.log.join('\n')), true);

  // The SECOND target, added the way a player adds one: the ghost button the
  // split screen draws for every other enemy in range.
  spike.helper.render();
  const add = findButtons(spike.root).find((b) => label(b) === '+ Bravo');
  check('the split screen offers the second target as a button', !!add, true);
  add.click();
  check('...and taking it puts two targets on the Action', spike.helper.multi.targets.length, 2);

  // "Begin the attack", which is openSequence's second caller. The log the
  // player is about to read is a FRESH one, so the removal has to be said again.
  const begin = findButtons(spike.root).find((b) => label(b).startsWith('Begin the attack on'));
  check('the split screen offers the Begin button', !!begin, true);
  begin.click();
  check('the sequence the Begin button opens says it too',
    spike.helper.ctx.log.filter((l) => /Armor Piercing 1/.test(l)).length, 1);
  check('...for the first target', spike.helper.ctx.defender.label, 'Alpha');

  // THE ASSERTION NOTHING IN THE SUITE MADE. advanceMulti is openSequence's
  // third caller and the only one that opens a sequence after another has
  // already been resolved.
  const moved = spike.helper.advanceMulti();
  check('advanceMulti takes over rather than closing the window', moved, true);
  check('the SECOND target gets its own sequence', spike.helper.ctx.defender.label, 'Bravo');
  check('and that second sequence tells ITS defender about the pierced dice',
    /Armor Piercing 1 \(from FPA-02 Spike's Eagle Eye\): Bravo removes 1 White die before rolling \(6\.2\.1\)/
      .test(spike.helper.ctx.log.join('\n')), true);
  check('...once, not once per repaint', spike.helper.ctx.log.filter((l) => /Armor Piercing/.test(l)).length, 1);
  check('...and Alpha is not named in Bravo\'s log, so this is a fresh sequence and not a carry-over',
    /Alpha removes/.test(spike.helper.ctx.log.join('\n')), false);

  // THE WIRE. Bravo's seat reads the mirror, never the attacker's render, so
  // the published view is what decides whether that player is told at all.
  spike.helper.render();
  const wire = spike.views[spike.views.length - 1];
  check('the mirror published for the second sequence carries the line',
    (wire?.log ?? []).some((l) => /Armor Piercing 1.*Bravo removes 1 White die/.test(l)), true);

  // THE CONTROL, byte for byte the same drive without the pilot: no Armor
  // Piercing anywhere, so every assertion above is the keyword and not the
  // Multi-Target plumbing.
  const plain = multi(null);
  check('the same Multi-Target without a Spike says nothing in its first sequence',
    /Armor Piercing/.test(plain.helper.ctx.log.join('\n')), false);
  plain.helper.render();
  findButtons(plain.root).find((b) => label(b) === '+ Bravo').click();
  findButtons(plain.root).find((b) => label(b).startsWith('Begin the attack on')).click();
  plain.helper.advanceMulti();
  check('...nor in its second', /Armor Piercing/.test(plain.helper.ctx.log.join('\n')), false);
  check('...and it really did reach the second target', plain.helper.ctx.defender.label, 'Bravo');
}

// ---------- 6. the surfaces, and which of them owns the arithmetic ----------
//
// There is ONE pool computation and both boards run it: main.ts (freeplay) and
// match.ts (Match Centre) construct the SAME AttackHelper, which is why the
// drive above covers both pages rather than one. playguide.ts holds no combat
// surface at all — it routes an attack to the board and stops. commands.ts is
// not a reader here on purpose: Armor Piercing is derived from cards.json and
// the pilot slot, both of which are already in boardFingerprint via t.mech, and
// callDefense's check() bounds the pool without recomputing it. Nothing new
// travels, so no normalise* whitelist and no fingerprint field is owed.
const src = (f) => readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8');
check('both boards build the same AttackHelper',
  [/new AttackHelper\(/.test(src('main.ts')), /new AttackHelper\(/.test(src('match.ts'))], [true, true]);
check('playguide.ts still has no combat surface of its own',
  /AttackHelper|suggestedDefensePool/.test(src('playguide.ts')), false);
check('the defence pool is computed in exactly one place',
  (src('combat.ts').match(/private suggestedDefensePool/g) ?? []).length, 1);
check('and nothing outside combat.ts subtracts Armor Piercing from a pool',
  ['main.ts', 'match.ts', 'playguide.ts', 'commands.ts']
    .filter((f) => /white\s*[-=].*armorPiercing/.test(src(f))), []);
// The Match Centre's attacker-side disclosure: the target list says what the
// shot is worth against each unit, beside the Protection it already reported.
check('the Match Centre target picker discloses it to the attacker too',
  /Armor Piercing \$\{ap\.total\}: −\$\{ap\.total\} White off their roll/.test(src('matchhud.ts')), true);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
