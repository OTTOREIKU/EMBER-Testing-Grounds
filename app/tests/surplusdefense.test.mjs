// The Surplus round strands the defender, reported from a live online game
// 2026-08-19: "Defender is trying to roll for surplus damage but is once again
// seeing nothing on their end to roll their second round of defender die. Up
// until then all of combat was working well."
//
// Rulebook 4.8 makes a Surplus round a SECOND Defense Roll inside the same
// attack: no Attack Roll is made, the defender simply rolls again. The helper
// runs it on the same Ctx, and `Ctx.defenseCalled` — the latch that stops the
// render loop asking for the same roll once per repaint — was set on the first
// round and never re-armed. So round two found the latch already set, skipped
// the ask, and printed only "Waiting for …". `defenseRoller` is the ONLY thing
// that sends `callDefense`, and `callDefense` is the ONLY thing that puts
// `script.combat` on the board, which is the sole gate for the defender's roll
// button on both of their surfaces. Nothing went on the wire, so the defender's
// screen had nothing to draw and the attacker waited forever.
//
// Freeplay never saw it: main.ts leaves `defenseRoller` null and the local roll
// button is gated on `!c.defenseRoll`, which IS reset. Match Centre only.
//
// Driven against the real AttackHelper with a real Mutilation card, because the
// bug is wiring: the count of `callDefense` calls that reach the wire is the
// whole assertion, and no amount of reading the source proves it.
import { installDom, loadCombat, makeEl, findButtons, label, textOf, mech, settle } from './_combatdrive.mjs';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}, got ${g}`); }
};

installDom();
const { AttackHelper, data, dice } = await loadCombat('surplusdef');

console.log('The Surplus round asks the defender again (4.8)\n');

const atk = mech(1, 's1', 'Attacker', 1);
const def = mech(2, 's2', 'Defender', 3);

// ZHRA-201 "MR21 Railgun", action _B: Firing, 4 Red, and it carries 毁伤
// (Mutilation) — one of the three keywords that resolve Surplus Damage.
const card = data.cards.find((c) => c.id === 'ZHRA-201');
const action = card?.actions?.find((a) => a.id === 'ZHRA-201_B');
if (!action) throw new Error('ZHRA-201_B is gone from the card data; pick another Mutilation Action');

const root = makeEl('div');
const helper = new AttackHelper(
  data, dice, root,
  () => {}, () => {}, () => {}, () => {}, () => {}, () => {},
  // The board lives on the page in the app; here the damage the helper commands
  // is applied straight to the tokens so the flow reads a truthful board.
  (cmd) => {
    if (cmd.kind === 'applyPenetration') {
      const t = [atk, def].find((x) => x.uid === cmd.targetUid);
      const cur = t.partStates[cmd.slot] ?? 'intact';
      t.partStates[cmd.slot] = cur === 'intact' ? 'damaged' : 'destroyed';
    }
  },
);
helper.tokens = () => [atk, def];
helper.terrain = () => [];
helper.smoke = () => [];
// The reported shape: two humans, the defender at another screen.
helper.focusRemote = (d) => d.side === 's2';
const views = [];
helper.publishView = (v) => views.push(v);

// THE MATCH CENTRE HOOK. match.ts sets this whenever the page is in a room, and
// every invocation is one `callDefense` on the wire — which is the thing the
// defending player's roll button is gated on. Counting invocations is counting
// what the defender was offered.
const calls = [];
const answers = [];
helper.defenseRoller = (pool, attacker, defender, actionId) => {
  calls.push({ white: pool.white, blue: pool.blue, defender: defender.label, actionId });
  return new Promise((res) => answers.push(res));
};

// ---------- round one, the ordinary defence ----------
helper.start(atk, action, def, '');
const c = helper.ctx;
helper.pickPart('torso');
// The Attack Roll itself is not what is under test; four Red on face 0 is a
// Penetration with damage to spare, which is what opens the Surplus round.
c.attackRoll = Array.from({ length: 4 }, () => ({ color: 'red', face: 0, selected: false }));
c.step = 'defense';
helper.render();

check('round one asks the defender for their dice', calls.length, 1);
check('and asks for the defender that is being shot at', calls[0]?.defender, 'Defender');

answers[0](Array.from({ length: calls[0].white }, () => ({ color: 'white', face: 7, selected: false })));
await settle();
check('the answer lands on the attacker\'s window', (c.defenseRoll ?? []).length > 0, true);

// Focus (4.4.1-5) is settled elsewhere and is not what this test drives.
c.focus = { stage: 'done', attackerUse: false, defenderUse: false };
c.step = 'resolve';
helper.render();

// ---------- the Surplus round, pressed the way a player presses it ----------
const apply = findButtons(root).find((b) => label(b).startsWith('Apply Penetration'));
if (!apply) throw new Error('the resolution step drew no Apply Penetration button; the roll no longer penetrates');
apply.click();
await settle();

check('the attack entered the Surplus round', c.surplusRound, 1);
check('on the same context, with the defence cleared', c.defenseRoll, null);
check('and no Attack Roll is made for it (4.8)', c.attackRoll, null);
check('the window is back on the defence step', c.step, 'defense');

// THE REGRESSION. One call means the defender was never asked, `script.combat`
// never went on the wire, and their screen has no button to press — the live
// report exactly.
check('the Surplus round asks the defender a SECOND time', calls.length, 2);
check('for the same defender', calls[1]?.defender, 'Defender');
check('with a defence pool of its own', (calls[1]?.white ?? 0) > 0, true);

// The waiting line is honest only if the ask actually went out.
const shown = textOf(root).join('\n');
check('the attacker is told they are waiting on the other player', /Waiting for/.test(shown), true);

// ---------- the second answer must be ACCEPTED ----------
//
// The `.then` guard is `this.ctx !== c || this.rollGen !== gen`. The Surplus
// round deliberately keeps the same context and the same generation, so
// re-arming the latch must not bump `rollGen`: a bumped generation would
// discard the defender's answer on arrival and trade one silent hang for
// another.
if (answers[1]) {
  answers[1](Array.from({ length: calls[1].white }, () => ({ color: 'white', face: 7, selected: false })));
  await settle();
}
check('and the Surplus round\'s answer is not discarded on arrival', (c.defenseRoll ?? []).length > 0, true);
check('the round is still the Surplus one when it lands', c.surplusRound, 1);

// ---------- and the round carries on from there ----------
//
// Only reachable now: the flow never got this far to be checked. A Surplus
// round makes no Attack Roll, so canFocus refuses the ATTACKER and Focus opens
// straight on the defender's declare — the very case focuspublish.test.mjs
// names, where nothing else would flush the stage. The published view has to
// carry that stage or the defending player is never told it is their move,
// which is the deadlock 8b78fab fixed showing up one round later.
check('Focus then opens on the defender alone (4.8, 4.4.1-5)', c.focus?.stage, 'declareD');
const last = views[views.length - 1];
check('and the mirror is told so', last?.focus?.stage, 'declareD');
check('with the Surplus round\'s own dice to reroll', (last?.defense ?? []).length > 0, true);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
