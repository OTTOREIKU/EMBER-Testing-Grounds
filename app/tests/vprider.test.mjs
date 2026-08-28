// Printed Victory Point riders on a Part: 300 OCS85 Black Box Carrying Pack and
// 500 HD-2 Data Backpack. Both print a bonus settled at the end of the game and
// a matching -1 "if this Part is destroyed" — 本部件, THE PART, so a Mech that
// survives with a blown backpack still pays it and a Mech that dies with the
// backpack intact pays it too.
//
// Two things this file exists to hold down.
//
// ONE: the -1 needs a LEDGER. A destroyed Unit leaves state.tokens (4.4.4) and
// a Torso kill never writes 'destroyed' into the backpack slot, so at game end
// the board can no longer answer "was this Part destroyed" either way. The fact
// is stamped as it happens, and the stamp has to survive normaliseTasks or it
// is dropped on every reload, network round-trip and rollback.
//
// TWO: an award may now be NEGATIVE. The penalty settles once, at the end, with
// no matching + in the same award to net against — so clamping the DELTA makes
// a lone -1 vanish, which is the base case the card exists to produce. The
// floor belongs on the running total, and that half is pinned in commands.ts.
//
// Driven against the real card database: the numbers and the gates are read off
// the printed text, and a fixture would only test the regex against itself.
import { readFileSync, writeFileSync } from 'node:fs';

const src = (f) => readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8');
const tasksSrc = src('tasks.ts'), units = src('units.ts');
const commands = src('commands.ts'), hud = src('matchhud.ts'), guide = src('playguide.ts');

const cut = (s, a, b, what) => {
  const i = s.indexOf(a), j = s.indexOf(b);
  if (i < 0 || j < 0 || j <= i) throw new Error(`could not locate ${what}`);
  return s.slice(i, j);
};

// ONE cut, out of units.ts, and nothing else in this file cuts that file — so
// there is no range here to collide with. It sits between noMeleeBackAttack and
// the White Dwarf Thruster block. tasks.ts is taken whole instead, the way
// tasks.test.mjs takes it, because the producer, the ledger and the Main Task
// scorer all have to be the same copy.
const rider = cut(units, '// ---------- printed Victory Point riders (300, 500)', '// ---------- White Dwarf Thruster', 'vpRiderFor');

const tmp = new URL('./_vprider.slice.ts', import.meta.url);
writeFileSync(
  tmp,
  tasksSrc.replace(/^import[^\n]*\n/m, 'type Side = any;\ntype Token = any;\ntype GameData = any;\n')
    + '\nfunction cardName(c: any): string { return c ? (c.name.en || c.name.zh || c.id) : "?"; }\n'
    + rider,
);
const T = await import(tmp.href);

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}, got ${g}`); }
};

console.log('Printed Victory Point riders\n');

// ---------- the real card database ----------

const raw = JSON.parse(readFileSync(new URL('../../data/cards.json', import.meta.url), 'utf8'));
const cards = Array.isArray(raw) ? raw : raw.cards;
const data = { byId: new Map(cards.map((c) => [String(c.id), c])) };

// ---------- reading the print ----------

const r300 = T.vpRiderFor(data, '300');
const r500 = T.vpRiderFor(data, '500');
check('300 reads as a per-Box bonus', r300?.perBlackBox, 1);
check('and it is not an Escort rider', r300?.escortSurvives, undefined);
check('500 reads as an Escort survival bonus', r500?.escortSurvives, 1);
check('and it is not a per-Box rider', r500?.perBlackBox, undefined);
// The English on 500 is typo'd in the shipped data ("lose lose 1 Victroy
// Point"), which is why every clause is tried in both languages.
check('both print the same -1', [r300?.penalty, r500?.penalty], [1, 1]);
check('and both name themselves for the score sheet', [r300?.name, r500?.name], ['OCS85 Black Box Carrying Pack', 'HD-2 Data Backpack']);
// The reader runs over every card at scoring time, so it must stay silent on
// the 400-odd that print no VP line at all.
check('an ordinary backpack carries no rider', T.vpRiderFor(data, '086'), undefined);
check('a card that is not in the database is not a rider', T.vpRiderFor(data, 'nope'), undefined);
let riders = 0;
for (const c of cards) if (T.vpRiderFor(data, String(c.id))) riders++;
check('and exactly two cards in the whole set carry one', riders, 2);

// ---------- fixtures ----------

const riderOf = (id) => T.vpRiderFor(data, id);
// A Mech sitting in Large Grid (c,r) wearing `mech` in its slots.
const mech = (uid, side, c, r, loadout, over = {}) => ({
  uid, side, kind: 'mech', stance: 'offensive', col: c * 3 + 1, row: r * 3 + 1,
  mech: { torso: '001', ...loadout }, label: 'M',
  partStates: { torso: 'intact', backpack: 'intact' }, ...over,
});
const box = (id, bearerUid) => ({ id, kind: 'blackbox', zone: 'Alpha', bearerUid, bearerSlot: 'leftHand', control: null, accessed: null });
const BLACKBOX = { family: 'blackbox', vp: 2, zones: [], fromRound: 1, cadence: 'at-end' };
const ASSET = { ...BLACKBOX, vp: 4, scoringZone: 'Echo' };
const CONTROL = { family: 'control', vp: 2, zones: [], fromRound: 1, cadence: 'per-round' };
const ECHO = ['B2'];
const zcells = (z) => (z === 'Echo' ? ECHO : []);
const state = (over = {}) => ({ ...T.newTaskState(), ...over });

// ---------- 300: PER BOX, on top of the Task ----------

const carrier = mech(1, 's1', 1, 1, { backpack: '300' });
const twoBoxes = state({ items: [box('bb1', 1), box('bb2', 1)] });
check('the Task itself pays for both Boxes',
  T.scoreMain(BLACKBOX, twoBoxes, [carrier], 5, true, zcells).s1, 4);
// FAQ P7: each Freehand keyword carries one Box, so multi-carry is legal and
// the rider has to scale with it.
check('and the rider adds one VP per Box on top',
  T.scoreRiders(BLACKBOX, twoBoxes, [carrier], true, zcells, {}, riderOf).s1, 2);
check('one Box is worth one', T.scoreRiders(BLACKBOX, state({ items: [box('bb1', 1)] }), [carrier], true, zcells, {}, riderOf).s1, 1);
check('and carrying nothing is worth nothing', T.scoreRiders(BLACKBOX, state(), [carrier], true, zcells, {}, riderOf).s1, 0);
// A Box carried by somebody else's Mech is somebody else's Box.
const plain = mech(2, 's2', 4, 4, {});
check('the rider only counts the Boxes on its own bearer',
  T.scoreRiders(BLACKBOX, state({ items: [box('bb1', 2)] }), [carrier, plain], true, zcells, {}, riderOf).s1, 0);

// Under Asset Preservation a Box outside Echo scores 0 base, so it must earn no
// rider either — which is the whole reason the rider runs through the Main
// Task's own held-Box filter rather than a second copy of it.
const inEcho = mech(1, 's1', 1, 1, { backpack: '300' });
const outside = mech(1, 's1', 7, 7, { backpack: '300' });
const oneBox = state({ items: [box('bb1', 1)] });
check('a Box carried into the scoring zone still scores base', T.scoreMain(ASSET, oneBox, [inEcho], 5, true, zcells).s1, 4);
check('and earns its rider', T.scoreRiders(ASSET, oneBox, [inEcho], true, zcells, {}, riderOf).s1, 1);
check('a Box left outside it scores no base', T.scoreMain(ASSET, oneBox, [outside], 5, true, zcells).s1, 0);
check('and no rider either', T.scoreRiders(ASSET, oneBox, [outside], true, zcells, {}, riderOf).s1, 0);

// ---------- 500: the Escort Target, and only the Escort Target ----------

const escortee = mech(3, 's2', 2, 2, { backpack: '500' });
const escortSet = state({ secondary: { s2: 'escort' }, secTarget: { s2: 3 } });
const kindOf = (id) => (id === 'escort' ? 'survive-designated' : 'destroy-designated');
const esc = T.escortTargets(escortSet, kindOf);
check('the Escort designation is found', esc, { s2: 3 });
check('and the surviving Part pays', T.scoreRiders(CONTROL, escortSet, [escortee], true, zcells, esc, riderOf).s2, 1);
// st.secTarget is one slot shared by every designation a Secondary Task makes —
// Behead's victim and the Weapons Test unit live there too — so the uid alone
// cannot mean "Escort Target".
const beheadSet = state({ secondary: { s2: 'behead' }, secTarget: { s2: 3 } });
check('a Behead designation is not an Escort designation', T.escortTargets(beheadSet, kindOf), {});
check('so the same Part pays nothing under it',
  T.scoreRiders(CONTROL, beheadSet, [escortee], true, zcells, T.escortTargets(beheadSet, kindOf), riderOf).s2, 0);
// FAQ P22: with no designation there is no bonus.
check('and nothing at all with no Secondary Task taken',
  T.scoreRiders(CONTROL, state(), [escortee], true, zcells, {}, riderOf).s2, 0);
const other = mech(4, 's2', 2, 2, { backpack: '500' });
check('a second copy on a Mech that is not the target pays nothing',
  T.scoreRiders(CONTROL, escortSet, [escortee, other], true, zcells, esc, riderOf).s2, 1);

// ---------- both bonuses settle at the END of the game ----------

check('300 owes nothing before the final round', T.scoreRiders(BLACKBOX, twoBoxes, [carrier], false, zcells, {}, riderOf).s1, 0);
check('500 owes nothing before it either', T.scoreRiders(CONTROL, escortSet, [escortee], false, zcells, esc, riderOf).s2, 0);
// Freeplay passes no reader at all, and must not crash or invent points.
check('and with no card reader nothing scores', T.scoreRiders(BLACKBOX, twoBoxes, [carrier], true, zcells).lines, []);

// ---------- the -1, off the ledger ----------

const lost = state({ partsLost: [{ side: 's1', uid: 1, slot: 'backpack', cardId: '300' }] });
check('a destroyed 300 docks a point', T.scoreRiders(BLACKBOX, lost, [], true, zcells, {}, riderOf).s1, -1);
// FLAT: once per card instance, however many Boxes it was carrying.
const lostCarrying = state({ items: [box('bb1', 1), box('bb2', 1)], partsLost: [{ side: 's1', uid: 1, slot: 'backpack', cardId: '300' }] });
check('and it is flat, not per Box', T.scoreRiders(BLACKBOX, lostCarrying, [], true, zcells, {}, riderOf).s1, -1);
// FAQ P22 read the other way: the gate is the same for the penalty as for the
// bonus. A Black Box card in a Control Zone game prints a rule about a Task
// nobody is playing.
check('but only while the Black Box Task is the one in play',
  T.scoreRiders(CONTROL, lost, [], true, zcells, {}, riderOf).s1, 0);
const lost500 = state({ secondary: { s2: 'escort' }, secTarget: { s2: 3 }, partsLost: [{ side: 's2', uid: 3, slot: 'backpack', cardId: '500' }] });
check('a destroyed 500 docks a point on the Escort Target',
  T.scoreRiders(CONTROL, lost500, [], true, zcells, T.escortTargets(lost500, kindOf), riderOf).s2, -1);
// The Mech is off the board by now, and the designation still points at its
// uid — which is exactly why the ledger records the uid.
check('and it still does with the Mech gone from the board',
  T.scoreRiders(CONTROL, lost500, [], true, zcells, T.escortTargets(lost500, kindOf), riderOf).lines.length, 1);
const lostUndesignated = state({ partsLost: [{ side: 's2', uid: 3, slot: 'backpack', cardId: '500' }] });
check('with no Escort designation there is no penalty either (FAQ P22)',
  T.scoreRiders(CONTROL, lostUndesignated, [], true, zcells, {}, riderOf).s2, 0);
// A dead Part cannot also be a live one, so the two halves never both fire —
// but they carry different keys so that a scored line can never mask the other.
check('the bonus and the penalty are keyed apart', [
  T.scoreRiders(BLACKBOX, twoBoxes, [carrier], true, zcells, {}, riderOf).lines[0].key,
  T.scoreRiders(BLACKBOX, lost, [], true, zcells, {}, riderOf).lines[0].key,
], ['rider:s1:300:1', 'riderlost:s1:300:1']);
// unpaidLines is what stops a line paying twice across two presses of Award.
check('a paid rider is not offered again',
  T.unpaidLines(T.scoreRiders(BLACKBOX, lost, [], true, zcells, {}, riderOf).lines, ['riderlost:s1:300:1']), []);

// A destroyed Part on a LIVE Mech pays the -1 and no bonus: the scope is the
// Part, not the Mech.
const blown = mech(1, 's1', 1, 1, { backpack: '300' }, { partStates: { torso: 'intact', backpack: 'destroyed' } });
const blownState = state({ items: [box('bb1', 1)], partsLost: [{ side: 's1', uid: 1, slot: 'backpack', cardId: '300' }] });
check('a live Mech with a blown backpack takes the penalty and earns no bonus',
  T.scoreRiders(BLACKBOX, blownState, [blown], true, zcells, {}, riderOf).s1, -1);

// ---------- the ledger itself ----------

const led = T.newTaskState();
const victim = mech(9, 's2', 3, 3, { backpack: '300', leftHand: '129' });
T.recordPartLoss(led, victim, 'backpack');
check('a destroyed Part is stamped with the card that was in the slot', led.partsLost, [{ side: 's2', uid: 9, slot: 'backpack', cardId: '300' }]);
// A second Penetration into an already-destroyed Part re-runs the same line.
T.recordPartLoss(led, victim, 'backpack');
check('and stamping it twice records it once', led.partsLost.length, 1);
T.recordPartLoss(led, victim, 'chasis');
check('an empty slot stamps nothing', led.partsLost.length, 1);
// A whole Unit leaving takes every Part still on it — a Torso kill never writes
// 'destroyed' into the backpack slot, so without this the rider Part reads
// intact on a Mech that is no longer on the table.
const led2 = T.newTaskState();
T.recordUnitLoss(led2, victim);
check('a removed Unit stamps every Part it was wearing',
  led2.partsLost.map((p) => p.slot).sort(), ['backpack', 'leftHand', 'torso']);
T.recordUnitLoss(led2, victim);
check('and removing it again changes nothing', led2.partsLost.length, 3);
const led3 = T.newTaskState();
T.recordUnitLoss(led3, { uid: 5, side: 's1', kind: 'drone', cardId: '173', partStates: {} });
check('a Drone wears no Parts to lose', led3.partsLost, []);

// THE WHITELIST. A field missing from normaliseTasks is dropped on every
// rehydrate, network round-trip and rollback — the -1 would quietly come back
// to life on a reload, and this project has already shipped that bug once.
check('the ledger round-trips',
  T.normaliseTasks({ partsLost: [{ side: 's2', uid: 9, slot: 'backpack', cardId: '300' }] }).partsLost,
  [{ side: 's2', uid: 9, slot: 'backpack', cardId: '300' }]);
check('a fresh state has an empty one', T.newTaskState().partsLost, []);
check('and junk in it is dropped', T.normaliseTasks({ partsLost: [{ uid: 'x' }, null, 3] }).partsLost, []);

// ---------- the award contract, and where the floor lives ----------

// The floor goes on the RUNNING TOTAL, one site. Clamping the delta instead
// would make a lone -1 vanish — a side on 6 would finish on 6 instead of 5.
check('the Award floors the total, not the delta',
  /tasks\.vp\.s1 = Math\.max\(0, tasks\.vp\.s1 \+ cmd\.vp\.s1\);/.test(commands), true);
check('on both sides', /tasks\.vp\.s2 = Math\.max\(0, tasks\.vp\.s2 \+ cmd\.vp\.s2\);/.test(commands), true);
check('and nothing clamps the delta on the way in',
  /cmd\.vp\.s1 < 0 \|\| cmd\.vp\.s2 < 0/.test(commands), false);
check('the check takes integers and bounds the magnitude',
  /!Number\.isInteger\(cmd\.vp\.s1\) \|\| !Number\.isInteger\(cmd\.vp\.s2\)/.test(commands), true);
// Warn, don't block: refusing would cost BOTH squads the whole round's VP over
// one card, which is the defect endaward.test.mjs was written for.
check('and a total heading below zero is a note, not a refusal',
  /return \{ ok: true, note: 'A squad cannot finish below zero/.test(commands), true);
// A warning nobody shows is not a warning, and both pages have their own panel.
check('the Match Centre shows the note', /if \(paid\.note\) ctx\.noteNow\(paid\.note\);/.test(hud), true);
check('and the play guide shows it too', /paid\.ok\s*\n\s*\? paid\.note \?\? null/.test(guide), true);

// ---------- both destruction sites stamp ----------

check('applyPenetration stamps the Part it just destroyed',
  /if \(target\.partStates\[cmd\.slot\] === 'destroyed'\) \{[\s\S]{0,400}recordPartLoss\(tasks, target, cmd\.slot\);/.test(commands), true);
check('the End Phase Integrity-Loss removal stamps the whole unit',
  /applyKill\(tasks, v\.lastDamagedBy[\s\S]{0,400}recordUnitLoss\(tasks, v\);/.test(commands), true);
// recordKill's payload carries no slot, so the victim token is read instead —
// and it has to be read BEFORE the filter that removes it.
check('and recordKill stamps from the victim before removing it',
  /recordUnitLoss\(tasks, victim\);[\s\S]{0,400}state\.tokens = state\.tokens\.filter\(\(x\) => x\.uid !== cmd\.targetUid\)/.test(commands), true);

// ---------- ONE copy of this glue, and every page reaching it ----------
//
// There used to be two - matchhud and playguide each carried it - and these
// assertions checked both, because wiring only one is how a rule ends up live
// on half the app. The pad would have been a third, so the glue moved to
// scoring.ts. The invariant is stronger now and the last check is the one that
// keeps it: no page may grow its own copy back.

const scoring = src('scoring.ts');

check('the shared preview runs the riders', /all\.push\(\.\.\.scoreRiders\(/.test(scoring), true);
check('and hands it the real card reader', /\(cardId\) => vpRiderFor\(data, cardId\)/.test(scoring), true);
check('and the Escort designation', /escortTargets\(tasks, \(id\) => data\.secondary/.test(scoring), true);
// The rider producer must get the SAME mission terms the Main Task scorer got,
// or card 300's gate and its scoringZone come from nowhere.
check('the mission terms are built once and shared',
  /if \(scoring\) all\.push\(\.\.\.scoreMain\(scoring, tasks/.test(scoring), true);
check('and both scorers read that one reading',
  /const scoring = mission \? missionScoring\(mission\) : undefined;/.test(scoring), true);

check('the Match Centre reaches it', /previewScore\(ctx\.data, ctx\.state, finalRound\)/.test(hud), true);
check('and the play guide reaches it', /previewScore\(this\.data, s, finalRound, \{ tasks \}\)/.test(guide), true);

// THE GUARD. A page that grows its own scoreRiders call is a second copy, and
// the drift starts there.
check('the Match Centre keeps no copy of its own', /scoreRiders/.test(hud), false);
check('nor does the play guide', /scoreRiders/.test(guide), false);
// Freeplay scores no Tasks at all, so it stays out of this.
check('freeplay is left alone', /scoreRiders/.test(src('main.ts')), false);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
