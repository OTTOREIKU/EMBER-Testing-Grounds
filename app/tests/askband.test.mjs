// THE ASK BAND and THE STEP-GROUPED TRACE (regions 3 and 4 of the agreed
// design, COMBAT-PANEL-REDESIGN.md), the last two pieces of the combat panel
// redesign that were still unbuilt.
//
// The band exists because prompts used to be drawn wherever the rule that fired
// happened to live, so there was nowhere to learn to look. Its two load-bearing
// properties are that it is NEVER EMPTY and that there is exactly ONE of it, and
// both are asserted against the real renderer rather than against the source:
// the whole point of _combatdrive.mjs is that a reader test is not a wiring
// test.
//
// The trace exists because a flat run of equal-weight sentences makes "a roll
// happened" and "a rule explains why it counted" read identically.
import { installDom, loadCombat, makeEl, findButtons, label, mech, settle } from './_combatdrive.mjs';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}, got ${g}`); }
};

console.log('The ask band and the step-grouped trace\n');

installDom();
const { AttackHelper, data, dice, mod } = await loadCombat('askband', ['askOf', 'traceGroups']);
const { askOf, traceGroups } = mod;

// ---------- askOf: every demand the sequence can put, and whose it is ----------
//
// NEVER EMPTY is the property, so this walks every Step value rather than a
// sample: a step with no answer here would draw a band with no words in it, and
// the band's whole claim is that there is always something in it to read.
const ask = (over) => askOf({ step: 'attack', attackRoll: null, defenseRoll: null, focus: null, surplusRound: 0, ...over });

const STEPS = ['split', 'part', 'designate', 'attack', 'defense', 'resolve', 'surplus'];
check('every step names a demand', STEPS.every((s) => (ask({ step: s }).what || '').length > 0), true);
check('and names somebody to make it',
  STEPS.every((s) => ['attacker', 'defender'].includes(ask({ step: s }).who)), true);
check('an unknown step still answers rather than drawing an empty band',
  (ask({ step: 'nonsense' }).what || '').length > 0, true);

check('splitting the pool is the attacker\'s', ask({ step: 'split' }).who, 'attacker');
check('so is finding the Part', ask({ step: 'part' }).who, 'attacker');
// The one question inside the attacker's half that belongs to the other player.
check('but DESIGNATING where the hit lands is the defender\'s', ask({ step: 'designate' }).who, 'defender');
check('the attack roll is the attacker\'s', ask({ step: 'attack' }).who, 'attacker');
check('the defence roll is the defender\'s', ask({ step: 'defense' }).who, 'defender');
// THE HANDBACK. The step is still 'defense' once the dice are down, and without
// this the band would leave the defender named while the attacker works.
check('but once those dice are down the floor goes back to the attacker',
  ask({ step: 'defense', defenseRoll: [{ color: 'white', face: 0 }] }).who, 'attacker');
check('the surplus choice is the attacker\'s', ask({ step: 'surplus' }).who, 'attacker');

// FOCUS IS TESTED BEFORE THE STEP because its four stages run INSIDE the
// defence step. Reading the step first would report "rolling the Defense Dice"
// while the roll has long since landed and a Link is being weighed over it.
const focus = (stage, over) => ask({ step: 'defense', defenseRoll: null, focus: { stage, attackerUse: false, defenderUse: false }, ...over });
check('the attacker declares their own Focus', focus('declareA').who, 'attacker');
check('and rerolls their own dice', focus('rerollA').who, 'attacker');
check('the defender declares theirs', focus('declareD').who, 'defender');
check('and rerolls theirs', focus('rerollD').who, 'defender');
check('a Focus stage OUTRANKS the step it runs inside',
  focus('declareD').what.includes('Focus'), true);
check('which the step alone would have got wrong',
  ask({ step: 'defense', defenseRoll: null }).what.includes('Focus'), false);
check('a settled Focus falls back to the step', focus('done').who, 'defender');

// BLOCKING is what earns the attention treatment, and it is the same line
// viewAwaits draws: a finished attack is read, not answered.
check('a live demand blocks', ask({ step: 'defense' }).blocking, true);
check('but the resolved screen does not', ask({ step: 'resolve' }).blocking, false);

// THE KEY IS THE IDENTITY OF THE DEMAND, and it carries the Surplus round
// because 4.8 re-opens the same questions for a second round. Those are new
// asks and must animate again.
check('the same demand keeps its key', ask({ step: 'part' }).key, ask({ step: 'part' }).key);
check('a different demand does not',
  ask({ step: 'part' }).key === ask({ step: 'attack' }).key, false);
check('and a Surplus round makes the same question a NEW ask',
  ask({ step: 'defense', surplusRound: 1 }).key === ask({ step: 'defense', surplusRound: 0 }).key, false);

// ---------- traceGroups ----------
check('an empty log makes no groups', traceGroups([], []), []);
check('lines from one step collect into one row',
  traceGroups(['a', 'b'], ['attack', 'attack']).length, 1);
check('carrying both lines', traceGroups(['a', 'b'], ['attack', 'attack'])[0].lines, ['a', 'b']);
check('and naming the step', traceGroups(['a'], ['attack'])[0].title, 'Attack Roll');
// FOLDED for the same reason `designate` has no card of its own: it is a fork
// inside choosing the Part, not a beat of the attack.
check('designate folds into the Part step',
  traceGroups(['a', 'b'], ['part', 'designate']).length, 1);
check('under the Part heading', traceGroups(['a'], ['designate'])[0].title, 'Target Part');
// CONTIGUOUS RUNS, not one row per step name: a Surplus round genuinely
// revisits the attack step and that is a separate beat of the fight.
check('a revisited step is a SEPARATE row, not more lines on the first',
  traceGroups(['a', 'b', 'c'], ['attack', 'defense', 'attack']).length, 3);
check('and the two visits have different ids',
  traceGroups(['a', 'b', 'c'], ['attack', 'defense', 'attack'])[0].id
  !== traceGroups(['a', 'b', 'c'], ['attack', 'defense', 'attack'])[2].id, true);
// A view published before logStep existed arrives with no tags at all. Those
// lines still belong somewhere.
check('untagged lines still land somewhere', traceGroups(['a'], []).length, 1);
check('under a plain heading rather than crashing the lookup', traceGroups(['a'], [])[0].title, 'Trace');

// ---------- the RENDERED band, driven through the real helper ----------
const rifle = data.cards.find((c) => c.id === 'ZHRA-201');
const firing = rifle?.actions?.find((a) => a.id === 'ZHRA-201_B');
const torso = data.cards.find((c) => c.type === 'torso');
const chasis = data.cards.find((c) => c.type === 'chasis');
check('the fixture Action is still on the card', !!firing, true);

const kit = (t, hand) => {
  t.mech = { torso: torso.id, chasis: chasis.id, rightHand: hand ?? '', leftHand: '', backpack: '', pilot: '' };
  return t;
};

let __seed = 20260824;
Math.random = () => { __seed = (__seed * 1103515245 + 12345) % 2147483648; return __seed / 2147483648; };

function window_() {
  const root = makeEl('div');
  const h = new AttackHelper(data, dice, root, () => {}, () => {}, () => {}, () => {}, () => {}, () => {}, () => {});
  h.tokens = () => all;
  h.terrain = () => [];
  h.smoke = () => [];
  return { h, root };
}
const atk = kit(mech(1, 's1', 'Attacker', 1), rifle.id);
const def = kit(mech(2, 's2', 'Defender', 3));
const all = [atk, def];

// Walks the tree the way a player's eye does, since the shim does not parse
// innerHTML into children.
function byClass(el, cls, out = []) {
  if (!el) return out;
  if (String(el.className || '').split(/\s+/).includes(cls)) out.push(el);
  for (const c of el.children ?? []) byClass(c, cls, out);
  return out;
}
const bandOf = (root) => byClass(root, 'ah-ask')[0];
// The band writes its two spans as innerHTML, and the shim keeps innerHTML as a
// plain string rather than parsing it into children, so this reads the string.
const bandText = (b) => String(b?.innerHTML ?? '');
const press = (root, want) => {
  const b = findButtons(root).find((x) => label(x).includes(want));
  if (!b) throw new Error(`no control matching ${want}`);
  b.click();
  return b;
};

const W = window_();
W.h.start(atk, firing, def, 'Line of sight is clear.');

// EXACTLY ONE. "There is one place a demand can appear" is the entire claim,
// and two bands would be the old problem wearing the new design's clothes.
check('the window draws an ask band', !!bandOf(W.root), true);
check('and exactly one of them', byClass(W.root, 'ah-ask').length, 1);
check('with words in it', bandText(bandOf(W.root)).length > 0, true);

// NOT SWEPT INTO A COLUMN. The gather loop pulls every unclaimed child into
// .ah-main, and the band must survive it: inside the reading column it would
// sit below the step stack on a wide panel, which is the "prompts appear
// wherever" problem it exists to end.
check('the band is NOT inside the reading column',
  byClass(byClass(W.root, 'ah-main')[0], 'ah-ask').length, 0);
check('nor inside the side column',
  byClass(byClass(W.root, 'ah-side')[0], 'ah-ask').length, 0);

// THIS window is the attacker's, so an attacker demand is theirs and reads in
// the second person.
check('an attacker window owns the attacker\'s demand',
  String(bandOf(W.root).className).includes('mine'), true);
check('and says so in the second person', bandText(bandOf(W.root)).includes('You are'), true);

// The whole reason the band is never empty: you can see the other player is
// DECIDING rather than idle. Walk to the defence roll, which is theirs.
W.h.pickPart('torso');
press(W.root, 'Roll attack dice');
await settle();
press(W.root, 'Continue to Defense');
{
  const band = bandOf(W.root);
  check('a demand belonging to the other player is not "mine"',
    String(band.className).includes('mine'), false);
  check('it names them', bandText(band).includes('Defender'), true);
  check('and says what they are deciding', bandText(band).includes('Defense Dice'), true);
  // Still exactly one, in the same place, at a step that draws a different body.
  check('and there is still exactly one band', byClass(W.root, 'ah-ask').length, 1);
}

// MOTION FIRES ON A NEW DEMAND AND NEVER ON A REPAINT. render() runs many times
// per step (a log line, an arriving frame, a Provoke answer all redraw it), and
// an animation that replayed each time is precisely the annoyance the design
// warned about when it asked for the highlight to start light.
check('a new demand is marked fresh', String(bandOf(W.root).className).includes('fresh'), true);
W.h.render();
check('but a repaint of the SAME demand is not',
  String(bandOf(W.root).className).includes('fresh'), false);
W.h.render();
check('and it stays quiet however many times it redraws',
  String(bandOf(W.root).className).includes('fresh'), false);

// ---------- the RENDERED trace ----------
W.h.ctx.defensePool = { white: 2, blue: 1 };
press(W.root, 'Roll defense dice');
await settle();
{
  const groups = byClass(W.root, 'ah-tg');
  check('the trace draws step groups rather than a flat list', groups.length > 0, true);
  check('each with a heading', byClass(W.root, 'ah-tg-h').length, groups.length);
  // RATIFIED: the current step and the last two are open. Collapsed-by-default
  // was explicitly rejected ("the last two things open").
  const open = groups.filter((g) => String(g.className).includes('open'));
  check('the last three are open by default', open.length, Math.min(3, groups.length));
  check('and they are the LAST three, not the first',
    groups.slice(-open.length).every((g) => String(g.className).includes('open')), true);
  check('an open group draws its lines', byClass(W.root, 'ah-tg-b').length, open.length);
  // The lines live UNDER the step: that indent is what makes "a roll happened"
  // and "a rule explains why" structurally different.
  check('and those lines sit inside the group, not beside it',
    byClass(groups[groups.length - 1], 'ah-tg-b').length, 1);
}

// CLICKING A HEADING FLIPS IT, and the flip is stored as a DEPARTURE from the
// default rather than as the state itself: the default moves as the attack
// advances, so storing the state would fight the auto-expand instead of
// overriding it.
{
  const heads = byClass(W.root, 'ah-tg-h');
  const last = heads[heads.length - 1];
  last._h.click[0]();
  const groups = byClass(W.root, 'ah-tg');
  check('a click closes an auto-opened group',
    String(groups[groups.length - 1].className).includes('open'), false);
  const heads2 = byClass(W.root, 'ah-tg-h');
  heads2[heads2.length - 1]._h.click[0]();
  check('and clicking again reopens it',
    String(byClass(W.root, 'ah-tg')[byClass(W.root, 'ah-tg').length - 1].className).includes('open'), true);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
