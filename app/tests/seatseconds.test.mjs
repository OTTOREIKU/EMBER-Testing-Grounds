// AN ENEMY ON A SWIFT OR TACTICAL DIAL (AI-OPPONENT-PLAN.md, "THE NIGHT OF
// 2026-10-04"; the Tactician's skill `seconds`). Only the Starting Action of an
// Opportunity must match the dial (3.4.3): a Mech dialled to Tactical may make
// its Electronic Attack and then fire with the Tick left. The exposure asked
// such an enemy's turn on the Tactical Timing, where no attack is live before
// the Starting Action, and read it as no danger this round. (Tactical comes last
// in a round, so such an enemy is still to act when most of this squad's units
// are asked; Swift comes first, and is still to come only within its own.) With `seconds` a Mech that carries an
// Action of its dial's Timing is read on the Timings a dial not shown is read on
// as well; one that carries none could start nothing, and is no danger still.
import { botTable, loadEngine } from './_engine.mjs';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}\n       got  ${g}`); }
};

console.log('An enemy on a Swift or Tactical dial\n');

const { M, data } = await loadEngine('seatseconds', ["export * as SEAT from '../src/seat';", "export * as AI from '../src/ai/index';"]);
const AI = M.AI;
// RDL: a Dune. UN: a Gator (the Alligator core's Manipulation Interference, a
// Tactic at Range 4, and a Tactical Rifle: Single Shot at 8) and a Cat (the same
// rifle, and no Swift Action or Tactic at all).
data.solo.squads['t-dune'] = { name: 'Dune', faction: 'RDL', points: 0, mechs: [{ name: 'Dune', loadout: { torso: '533', chasis: '534', leftHand: '535', rightHand: '536', backpack: '004', pilot: 'FPA-04-2' } }], drones: [] };
data.solo.squads['t-vipers'] = {
  name: 'Vipers', faction: 'UN', points: 0,
  mechs: [
    { name: 'Gator', loadout: { torso: '097', chasis: '099', leftHand: '541', pilot: 'LPA-23-2' } },
    { name: 'Cat', loadout: { torso: '539', chasis: '099', leftHand: '541', pilot: 'LPA-23-2' } },
  ],
  drones: [],
};
const scenario = { ...data.solo.scenarios[0], id: 't-seconds', map: 'none', seats: { s1: 't-dune', s2: 't-vipers' } };

// Round 2's Action Phase, the Dune's Firing Opportunity open; the UN Mechs four
// and five Grids south of it facing it, each on the dial named, its turn still
// to come (or done).
const staged = async (gator, cat) => {
  const t = botTable(M, data, scenario, { seed: 4, policies: AI.eagerPolicy });
  await t.run({ until: (st) => M.SU.normaliseSetup(st.setup)?.stage === 'done' && st.round.phase === 2 });
  const s = t.state;
  const U = Object.fromEntries(s.tokens.map((x) => [x.label, x]));
  const at = (x, c, r, f) => { x.col = c * 3; x.row = r * 3; x.facing = f; };
  at(U.Dune, 5, 3, 2); at(U.Gator, 5, 7, 0); at(U.Cat, 6, 7, 0);
  for (const x of s.tokens) x.statuses = (x.statuses ?? []).filter((y) => y !== 'camouflage');
  s.round.n = 2; s.script.stage = '2:2'; s.script.revealed = ['s1', 's2']; s.script.passed = [];
  U.Dune.timing = 'firing'; U.Gator.timing = gator.timing; U.Cat.timing = cat.timing;
  s.script.acted = [...(gator.done ? [U.Gator.uid] : []), ...(cat.done ? [U.Cat.uid] : [])];
  s.script.opp = null;
  M.G.opportunity(data, s);
  const d = t.drivers.s1.pending();
  return { t, d, view: M.SEAT.viewOf(data, s, 's1') };
};
const cost = (x, skills) => AI.exposureAt(x.d, x.view, null, Infinity, { focus: false, ...skills }).cost;

{
  const gator = await staged({ timing: 'tactical' }, { timing: 'firing', done: true });
  // (The Mech whose turn is behind it is read for its next round either way: what is compared is what `seconds` adds.)
  check('THE GATOR ON TACTICAL, ITS TURN TO COME, is no danger to the Dune this round without `seconds`; with it, its Electronic Attack and the shot after it are priced',
    [gator.d?.kind, cost(gator, { seconds: true }) > cost(gator, { seconds: false }) + 0.2], ['opp.act', true]);
  gator.t.close();
  const cat = await staged({ timing: 'firing', done: true }, { timing: 'tactical' });
  check('THE CAT ON TACTICAL carries no Tactic to start with, so it can do nothing in that Opportunity: no danger, with `seconds` or without',
    cost(cat, { seconds: true }), cost(cat, { seconds: false }));
  cat.t.close();
  const done = await staged({ timing: 'tactical', done: true }, { timing: 'firing', done: true });
  check('and a Gator whose turn is behind it is read as before', [cost(done, { seconds: true }), cost(done, { seconds: false })], [cost(done, { seconds: false }), cost(done, { seconds: false })]);
  done.t.close();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
