// 027 AC-32M Marksman Rifle — the contested {Eye}, driven through the real UI.
//
// pilottraits.test.mjs proves the ARITHMETIC of the split. This proves the
// window actually offers it, because the arithmetic was never the risky part:
// the offer is thirty lines of DOM in stepDefense, and a reader test cannot see
// a button that throws or never renders. The lesson _combatdrive.mjs already
// records — "a reader test is not a wiring test; the wiring is what breaks".
//
// The build is legal and the collision is real in play: 503 Avalanche Assault
// Core is a TORSO and reads every {Eye} as a Heavy Hit; the rifle is a
// RIGHT HAND and reads the same {Eye} as 2 Light Hits. Rulebook 4.4.1 step 6
// (p51) says each die may only be Exchanged once, so one of them has to lose,
// and the FAQ answers that shape three times over (A5/A6/D1): only one may be
// CHOSEN. This file drives the choosing.
import { installDom, loadCombat, makeEl, findButtons, label, mech, settle, textOf } from './_combatdrive.mjs';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}, got ${g}`); }
};

installDom();
const { AttackHelper, data, dice } = await loadCombat('singleshot');

const rifle = data.cards.find((c) => c.id === '027');
const single = rifle.actions.find((a) => a.id === '027_A');
check('027_A Single Shot is the Action under test', [rifle.type, single.type], ['rightHand', 'Firing']);
check('and 503 Avalanche is a Torso, so one Mech can legally carry both',
  data.cards.find((c) => c.id === '503').type, 'torso');

// red face 7 and yellow face 6 are both a solid {Eye} in the shipped dice.
const EYES = [{ color: 'red', face: 7 }, { color: 'yellow', face: 6 }];

// Drives one Single Shot to the point where the Exchange is asked, with `torso`
// deciding whether anything contests the {Eye} at all.
async function toExchange(torso) {
  const atk = mech(1, 's1', 'Attacker', 1);
  const def = mech(2, 's2', 'Defender', 3);
  atk.mech = { torso, chasis: '179', leftHand: '', rightHand: '027', backpack: '', pilot: '' };
  def.mech = { torso: '172', chasis: '179', leftHand: '', rightHand: '', backpack: '', pilot: '' };
  const root = makeEl('div');
  const h = new AttackHelper(
    data, dice, root,
    () => {}, () => {}, () => {}, () => {}, () => {}, () => {},
    () => {},
  );
  h.tokens = () => [atk, def];
  h.terrain = () => [];
  h.smoke = () => [];
  h.start(atk, single, def, 'clear');
  h.pickPart('torso');

  const press = async (rx) => {
    const b = findButtons(root).find((x) => rx.test(label(x)) && !x.disabled);
    if (b) b.click();
    await settle();
    return !!b;
  };

  await press(/roll attack dice/i);
  // The roll is REPLACED rather than boosted: this file is about what happens
  // when two {Eye} show, and waiting for the RNG to produce them would make the
  // test flaky in exactly the way a rules test must not be.
  h.ctx.attackRoll = EYES.map((d) => ({ ...d }));
  h.render();
  await press(/continue to defense/i);
  await press(/roll defense dice/i);
  // Focus is offered to each side in turn; decline both so step 6 is reached.
  for (let i = 0; i < 4; i++) await press(/^Pass$/);
  return { h, root, findAll: () => findButtons(root), text: () => textOf(root).join(' | ') };
}

// ---------- contested: 503 in the torso ----------
{
  const { h, root, findAll, text } = await toExchange('503');
  check('both readers see the same two {Eye}', h.eyeContest(h.ctx).contested, 2);
  check('the window says so, and says which way they are going',
    /Single Shot contests 2 \[Eye\]: 0 as 2 Light Hits each, 2 as a Heavy Hit/.test(text()), true);

  const take = findAll().find((b) => /take an \[Eye\] as 2 Light Hits/i.test(label(b)));
  check('and offers the exchange as a button', !!take, true);
  check('with the rule on it, not just a verb',
    /each die may only be Exchanged once/i.test(take.title ?? ''), true);
  // Nothing to take back yet, so only the one direction is offered.
  check('and does not offer to take one back before one has been given',
    findAll().some((b) => /take an \[Eye\] back/i.test(label(b))), false);

  take.click();
  await settle();
  check('pressing it moves one {Eye} to the rifle',
    [h.ctx.eyeToLight, h.eyeContest(h.ctx).toLight], [1, 1]);
  check('and the window redraws the new split',
    /Single Shot contests 2 \[Eye\]: 1 as 2 Light Hits each, 1 as a Heavy Hit/.test(text()), true);
  check('the tally follows: 1 Heavy Hit and 2 Light Hits, no {Eye} left',
    [h.attackIcons(h.ctx).heavyHit ?? 0, h.attackIcons(h.ctx).lightHit ?? 0, h.attackIcons(h.ctx).eye ?? 0],
    [1, 2, 0]);

  const back = findAll().find((b) => /take an \[Eye\] back/i.test(label(b)));
  check('and now the way back is offered too', !!back, true);
  back.click();
  await settle();
  check('which undoes it', h.ctx.eyeToLight, 0);

  // Both to the rifle, then check the resolution NAMES what happened.
  findAll().find((b) => /take an \[Eye\] as 2 Light Hits/i.test(label(b))).click();
  await settle();
  findAll().find((b) => /take an \[Eye\] as 2 Light Hits/i.test(label(b))).click();
  await settle();
  check('with both assigned the rifle takes everything',
    [h.attackIcons(h.ctx).heavyHit ?? 0, h.attackIcons(h.ctx).lightHit ?? 0], [0, 4]);
  check('and the offer stops asking once nothing is left to give',
    findAll().some((b) => /take an \[Eye\] as 2 Light Hits/i.test(label(b))), false);

  const res = findAll().find((b) => /^Resolve/.test(label(b)));
  check('Resolve is still reachable with the exchange made', !!res, true);
  res.click();
  await settle();
  check('and the resolution credits Single Shot by name',
    /Single Shot: 2 \[Eye\] counted as 4 Light Hits/.test(textOf(root).join(' | ')), true);
}

// ---------- uncontested: an ordinary torso ----------
{
  const { h, findAll, text } = await toExchange('172');
  check('with nothing contesting them the rifle just takes both {Eye}',
    [h.attackIcons(h.ctx).lightHit ?? 0, h.attackIcons(h.ctx).heavyHit ?? 0], [4, 0]);
  check('and nothing is asked', h.eyeContest(h.ctx).contested, 0);
  check('so the window shows no contest line',
    /Single Shot contests/.test(text()), false);
  check('and no exchange button', findAll().some((b) => /take an \[Eye\]/i.test(label(b))), false);
}

console.log(`\n  ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
