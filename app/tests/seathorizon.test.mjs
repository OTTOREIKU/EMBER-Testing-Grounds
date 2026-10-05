// THE LAST ROUND'S POINTS (AI-OPPONENT-PLAN.md, "THE MORNING OF 2026-10-05",
// item 4; the Tactician's weight `horizon`). A unit's points stand for what it
// will go on to do, and in the last round there is no round to go on to: there
// they count `1 - horizon` of their worth. In random game 96032 a Mech with a
// Box two Grids from Echo in the last round set its dial to fire a Full-auto
// worth 5.15 rather than carry in the 4 Victory Points that won the game, and
// the game was lost on Parts. Staged on the real engine: a Black Box table
// and a VIP table, round four and round five of five.
import { botTable, loadEngine } from './_engine.mjs';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}\n       got  ${g}`); }
};

console.log('The last round\'s points\n');

const { M, data } = await loadEngine('seathorizon', ["export * as SEAT from '../src/seat';", "export * as AI from '../src/ai/index';"]);
const AI = M.AI;
const W = AI.TACTICIAN;
const near = (a, b) => Math.abs(a - b) < 1e-9;

// A table at the Action Phase of round `n` of five.
const tableAt = async (scenario, n) => {
  const t = botTable(M, data, { ...scenario, map: 'none' }, { seed: 4, policies: AI.eagerPolicy });
  await t.run({ until: (st) => M.SU.normaliseSetup(st.setup)?.stage === 'done' && st.round.phase === 2 });
  t.state.round.n = n;
  t.state.script.stage = `${n}:2`;
  const view = M.SEAT.viewOf(data, t.state, 's1');
  t.close();
  return view;
};

{
  const box = { ...data.solo.scenarios[0], id: 't-horizon-box', mission: 'blackbox-asset-preservation' };
  const four = await tableAt(box, 4);
  const five = await tableAt(box, 5);
  const units = (v) => v.units.filter((u) => u.alive && u.deployed);
  const worth = (v, h) => units(v).map((u) => AI.unitWorth(u, v, { ...W, horizon: h }));
  check('STAGED: round four and round five of five',
    [four.round, five.round, five.roundLimit, units(five).length > 0], [4, 5, 5, true]);
  check('IN ROUND FOUR a unit is worth its points with `horizon` 1 as at 0',
    worth(four, 1).every((x, i) => near(x, worth(four, 0)[i])), true);
  check('IN THE LAST ROUND, at `horizon` 1, a unit\'s points count for nothing, and at a half for half',
    [worth(five, 1).every((x) => near(x, 0)), worth(five, 0.5).every((x, i) => near(x, worth(five, 0)[i] / 2)), worth(five, 0).some((x) => x > 0)], [true, true, true]);
  // What an attack is worth: in the last round, at `horizon` 1, the Link it
  // strips and nothing for the Part it destroys (the tiebreak is priced apart,
  // `tiebreak`).
  const mech = units(five).find((u) => u.side === 's2' && u.kind === 'mech');
  const f = { hit: 0.9, pen: 0.6, damage: 0.3, destroy: 0.3, kill: 0.1, link: 0.5, parts: [], pick: null };
  check('AN ATTACK ON A MECH in the last round at `horizon` 1 is worth the Link it strips alone',
    near(AI.gainOf(f, mech, five, { ...W, horizon: 1 }), f.link * W.link), true);
  check('and with the tiebreak priced (`tiebreak` 1), the Parts it destroys count in it',
    AI.gainOf(f, mech, five, { ...W, horizon: 1, tiebreak: 1 }) > f.link * W.link, true);
}
{
  // On a VIP mission the Commander's own price is the Main Task's, not its
  // points: it stands in the last round as in any other.
  const vip = data.solo.scenarios.find((s) => /vip/.test(s.mission)) ?? data.solo.scenarios[1];
  const five = await tableAt(vip, 5);
  const leader = five.units.find((u) => u.commander && u.side === 's2' && u.alive);
  const at = (h) => AI.unitWorth(leader, five, { ...W, horizon: h });
  check('ON A VIP MISSION the other squad\'s Commander keeps its price in the last round at `horizon` 1',
    [!!leader, five.task?.family, at(1) > 0, near(at(1), five.task.vp * W.vipKill)], [true, 'vip', true, true]);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
