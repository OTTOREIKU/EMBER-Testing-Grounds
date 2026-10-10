// THE CARRIER KEPT BY ITS MECH (`leash`, 2026-10-09; OTTO, watching the Ace play itself: "the tarantula with the
// backpack is still sitting still"; "we need to build a leash system for the drone where if it can move it should stay
// nearby or get out of the way"; "The leash system makes more sense for the drones with load").
//
// A Carrier lends its Load to the Ally Mechs in Contact with it (162), and `lend` prices a Grid by what the Load adds
// to the Mech's NEXT deed, as the engine reckons it. With no enemy within the Mech's reach next turn that is nothing at
// every Grid, so the Carrier was worth no Command for it and stood where it was while its Mech walked on. With the
// skill, a Grid where it touches an Ally Mech is worth the deployment's tie-break (a quarter of `lend`), a share more
// behind the Mech (further from the nearest enemy than the Mech stands: its Large base Obstructs the lines to the
// Carrier, 4.5.3), and a Grid from which it touches one only after more Commands that much less for each Command
// (`future`); what `lend` reads besides (the Load's use at the Mech's next deed) is added to it.
//
// Staged on the copied VIP game (the Intersection: its Main Task scores no zones, so no zone draws the Carrier) at round
// 1's Command Phase: the Wild Cat (its R7K Tactical Rifle a Laser) and the Carrier (its Load a CSC60 Cooler, +1 Yellow
// to a Laser Firing Action), the RDL Mechs either far in the other corner, beyond anything the Wild Cat could reach
// next turn, or within it.
import { botTable, loadEngine } from './_engine.mjs';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}\n       got  ${g}`); }
};

console.log('The Carrier kept by its Mech\n');

const { M, data } = await loadEngine('seatleash', ["export * as SEAT from '../src/seat';", "export * as AI from '../src/ai/index';", "export * as HUD from '../src/matchhud';"]);
const AI = M.AI;
const CARRIER = 'ADK30C Tarantula Carrier Type';
const RAVEN = 'ADK60S Raven Interference Type';
const PORCUPINE = 'ADK15P Porcupine Ion Type';
// FAR: the Wild Cat in K11, the Carrier in I12, the RDL Mechs in A1 and B1 (19 Grids and more off: its Maneuver and
// its rifle reach 12). NEAR: the Wild Cat in F9, the RDL Mechs in E4 and H4.
const FAR = { cat: [10, 10], car: [8, 11], mire: [0, 0], dune: [1, 0], others: [[0, 11], [1, 11]] };
const NEAR = { cat: [5, 8], car: [3, 10], mire: [4, 3], dune: [7, 3], others: [[10, 11], [11, 11]] };

// `command`: staged at the Command designation (the squad to name a Drone); else the Carrier's activation.
const staged = async ({ cat, car, mire, dune, others }, { command = false, alone = false } = {}) => {
  const t = botTable(M, data, data.solo.scenarios[1], { seed: 1, policies: { s1: AI.brawlerPolicy, s2: AI.tacticianPolicy }, glue: M.HUD.glueAfter });
  await t.run({ until: (st) => st.setup?.stage === 'done' && st.script && M.TY.PHASES[st.round.phase] === 'Command' });
  const s = t.state;
  const U = Object.fromEntries(s.tokens.map((x) => [x.label, x]));
  const at = (x, [c, r], f) => { x.col = c * 3; x.row = r * 3; x.facing = f; x.deployed = true; };
  at(U['Wild Cat'], cat, 0); at(U[CARRIER], car, 0); at(U[PORCUPINE], others[0], 0); at(U[RAVEN], others[1], 0);
  at(U.Mire, mire, 2); at(U.Dune, dune, 2);
  // The Raven and the Porcupine gone (OTTO's game: the Raven died, and a Command went unspent).
  if (alone) { U[RAVEN].partStates.main = 'destroyed'; U[PORCUPINE].partStates.main = 'destroyed'; }
  s.round.phase = M.TY.PHASES.indexOf('Command');
  s.script.stage = `${s.round.n}:${s.round.phase}`;
  s.script.turn = 's2'; s.script.acted = []; s.script.passed = [];
  if (command) { s.script.commanded = []; delete s.script.opp; }
  else { s.script.commanded = [U[CARRIER].uid]; s.script.opp = M.TY.newOpportunity(U[CARRIER].uid, undefined); }
  return { t, s, U, d: t.drivers.s2.pending(), view: M.SEAT.viewOf(data, s, 's2') };
};
const rows = (d, view, skills, tune) => M.SEAT.pondering(() => AI.weighed(d, view, skills, tune));
const tie = AI.TACTICIAN.lend * 0.25;
const near = (a, b) => Math.abs(a - b) < 1e-9;
const lent = (d, p, cat) => d.options.find((o) => o.label === p.label)?.facts?.lendsTo === cat.uid;

{
  // THE VIEW: what the Carrier's base touches where it stands.
  const away = await staged(FAR);
  const carrier = (v) => v.units.find((u) => u.label === CARRIER);
  check('a Carrier away from its Mech touches nothing; the Raven, which carries no Load, is not asked',
    [carrier(away.view)?.touches, away.view.units.find((u) => u.label === RAVEN)?.touches], [[], undefined]);
  const cat = away.U['Wild Cat'];
  away.U[CARRIER].col = cat.col; away.U[CARRIER].row = cat.row + 3;
  const v = M.SEAT.viewOf(data, away.s, 's2');
  check('one whose base meets the Wild Cat\'s touches it (Contact, rules.ts inContact)',
    [M.R.inContact(away.U[CARRIER], cat), carrier(v)?.touches], [true, [cat.uid]]);
  away.t.close();
}
{
  // FAR: no enemy within the Wild Cat's reach next turn.
  const { t, U, d, view } = await staged(FAR);
  const cat = U['Wild Cat'];
  const off = rows(d, view, { leash: false });
  check('THE STAGE, FAR: the Carrier is asked its activation, may walk into Contact with the Wild Cat, and what its Load adds reads nothing anywhere',
    [d?.kind, off.some((p) => p.how === 'move' && lent(d, p, cat)), off.every((p) => p.next === 0)], ['activation.act', true, true]);
  check('without the skill the Contact is worth nothing to the Carrier; as it ships the skill is on (measured)', [off.filter((p) => lent(d, p, cat)).every((p) => p.next === 0), AI.SKILLS.leash], [true, true]);
  const on = rows(d, view, { leash: true });
  const stay = on.find((p) => p.how === 'stay');
  check('WITH THE SKILL: staying where the Wild Cat is touched only after more Commands is worth the tie-break at `future` for each',
    [stay?.next > 0, stay?.next <= tie * AI.TACTICIAN.future + 1e-9], [true, true]);
  const touching = on.filter((p) => p.how === 'move' && lent(d, p, cat));
  check('a Movement that ends touching the Wild Cat is worth the tie-break, or a quarter more behind it',
    [touching.length > 0, touching.every((p) => near(p.next, tie) || near(p.next, tie * 1.25)), touching.some((p) => near(p.next, tie * 1.25))], [true, true, true]);
  // Behind: further from the nearest enemy (the Dune in B1; Grids along the rows and the columns) than the Wild Cat
  // stands. K12 and L11 are; J12, J11 and L10 are not.
  const worth = (c, r) => touching.filter((p) => p.at.col === c && p.at.row === r).map((p) => p.next);
  check('behind it (K12, L11, away from the RDL Mechs) more than beside or in front of it (J11, J12, L10)',
    [[...worth(10, 11), ...worth(11, 10)].every((x) => near(x, tie * 1.25)), [...worth(9, 10), ...worth(9, 11), ...worth(11, 9)].every((x) => near(x, tie))], [true, true]);
  const chosen = AI.makeTactician({ leash: true }).choose(d, view, new AI.Rng('x'));
  const o = d.options.find((x) => x.id === chosen.option);
  check('and with the skill the Carrier is walked to the Wild Cat and set down touching it',
    [o?.facts?.lendsTo, o?.tags[0]], [cat.uid, 'move']);
  t.close();
}
{
  // NEAR: the RDL Mechs within the Wild Cat's reach, and what the Load adds to its next shot read.
  const { t, U, d, view } = await staged(NEAR);
  const cat = U['Wild Cat'];
  const off = rows(d, view, { leash: false });
  const on = rows(d, view, { leash: true });
  const pair = off.filter((p) => p.how === 'move' && lent(d, p, cat)).map((p) => [p, on.find((q) => q.label === p.label)]);
  check('NEAR: a Grid in Contact is worth what `lend` reads there and the tie-break besides (a quarter more behind the Wild Cat), and `lend` reads something',
    [pair.length > 0, pair.some(([p]) => p.next > 0), pair.every(([p, q]) => near((q?.next ?? NaN) - p.next, tie) || near((q?.next ?? NaN) - p.next, tie * 1.25))], [true, true, true]);
  t.close();
}
{
  // THE COMMAND GIVEN, FAR: the Raven and the Porcupine gone, the Carrier the one Drone left.
  const { t, d, view } = await staged(FAR, { command: true, alone: true });
  check('THE STAGE: the squad is asked which Drone its Command goes to, and the Carrier is the one it may name',
    [d?.kind, d?.options.filter((o) => o.tags.includes('designate')).length], ['loop.designate.command', 1]);
  const on = AI.makeTactician({ leash: true }).choose(d, view, new AI.Rng('x'));
  check('with the skill the Carrier is Commanded', [on.reason, d.options.find((o) => o.id === on.option)?.tags.includes('designate')], ['command_by_value', true]);
  t.close();
}
{
  // A DRONE WITH NO LOAD is not held by it.
  const { t, U, s } = await staged(FAR);
  s.script.commanded = [U[RAVEN].uid]; s.script.opp = M.TY.newOpportunity(U[RAVEN].uid, undefined);
  const d = t.drivers.s2.pending();
  const view = M.SEAT.viewOf(data, s, 's2');
  const same = (a, b) => JSON.stringify(a.map((p) => [p.label, p.next])) === JSON.stringify(b.map((p) => [p.label, p.next]));
  check('the Raven, which carries no Load, weighs every Grid as it did', [d?.unit === U[RAVEN].uid, same(rows(d, view, { leash: false }), rows(d, view, { leash: true }))], [true, true]);
  t.close();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
