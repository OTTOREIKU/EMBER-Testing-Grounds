// A DRONE LAUNCHED TO CALL IN A SHOT (AI-OPPONENT-PLAN.md, the Log of
// 2026-10-04 night; the weight `spotter`). A TM39D Cobra core launches the KK9
// Snake Eyes (TM39D_B, Range 18, Fire in Arc), a Drone that strikes nothing
// itself: given a Command, or handed one at once (a Command Coordination,
// 4.15.3), its Overwatch Strike has an Ally Mech fire on an enemy within 2 of
// it, and then it leaves the board (seatoverwatch.test.mjs holds the Strike).
// In the census of OTTO's community squads (2026-10-04 night) the launch was
// offered 60 times and never made: a launch was worth what the Projectile's own
// turn would do to an enemy, and the KK9's turn does nothing to anybody.
// Staged here: what the seam says of the launch, what the Tactician makes of it
// with the weight and without, and the whole of it played on.
import { botTable, loadEngine } from './_engine.mjs';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}\n       got  ${g}`); }
};

console.log('A Drone launched to call in a shot\n');

const { M, data } = await loadEngine('seatspotter', ["export * as SEAT from '../src/seat';", "export * as AI from '../src/ai/index';", "export * as HUD from '../src/matchhud';"]);
const { owed, newMind } = M.SEAT;
const AI = M.AI;

// UN: a Cobra (TM39D, which launches the KK9) and a Wolf, each with a gun in
// each hand. RDL: a Dune and a Sand. (The squads of seatoverwatch.test.mjs.)
const un = (name, torso) => ({ name, loadout: { torso, chasis: '099', leftHand: '540', rightHand: '541', backpack: '538', pilot: 'LPA-23-2' } });
const rdl = (name) => ({ name, loadout: { torso: '533', chasis: '534', leftHand: '535', rightHand: '536', backpack: '004', pilot: 'FPA-04-2' } });
data.solo.squads['t-eyes'] = { name: 'Eyes', faction: 'UN', points: 0, mechs: [un('Cobra', 'TM39D'), un('Wolf', '539')], drones: [] };
data.solo.squads['t-rdl'] = { name: 'Gunners', faction: 'RDL', points: 0, mechs: [rdl('Dune'), rdl('Sand')], drones: [] };
const SCENARIO = { ...data.solo.scenarios[0], id: 't-spotter', map: 'none', seats: { s1: 't-eyes', s2: 't-rdl' } };
const KK9 = 'LHDR-KK9';
const viewOf = (state, seat) => M.SEAT.viewOf(data, state, seat);
const near = (o, t, reach) => Math.abs(Math.floor(t.col / 3) - o.facts.to.c) + Math.abs(Math.floor(t.row / 3) - o.facts.to.r) <= reach;
const said = (p) => /a Drone to call a shot on/.test(p.does ?? '');

// A table set up and then rearranged: the Cobra's Opportunity of the round
// named, on its Projectile Timing, every other Mech done; its own guns gone
// (it has nothing to fire), the Wolf beside it with the Dune in its sights,
// the Sand far off.
const staged = async ({ round = 1, policies = AI.eagerPolicy, token = false } = {}) => {
  const t = botTable(M, data, SCENARIO, { seed: 3, policies, glue: M.HUD.glueAfter });
  await t.run({ until: (st) => M.SU.normaliseSetup(st.setup)?.stage === 'done' });
  const s = t.state;
  const U = Object.fromEntries(s.tokens.map((x) => [x.label, x]));
  const at = (x, c, r, f) => { x.col = c * 3; x.row = r * 3; if (f !== undefined) x.facing = f; };
  at(U.Cobra, 3, 4, 2); at(U.Wolf, 5, 4, 2); at(U.Dune, 4, 8, 0); at(U.Sand, 11, 11, 0);
  U.Cobra.partStates = { ...U.Cobra.partStates, leftHand: 'destroyed', rightHand: 'destroyed' };
  U.Cobra.statuses = (U.Cobra.statuses ?? []).filter((x) => x !== 'command');
  if (token) U.Cobra.statuses = [...U.Cobra.statuses, 'command'];
  const sc = s.script;
  s.round.n = round;
  s.round.phase = 2; sc.stage = `${round}:2`; sc.passed = []; sc.revealed = ['s1', 's2'];
  for (const x of s.tokens) if (x.kind === 'mech') x.timing = 'firing';
  U.Cobra.timing = 'projectile';
  sc.acted = s.tokens.filter((x) => x.kind === 'mech' && x.uid !== U.Cobra.uid).map((x) => x.uid);
  sc.opp = null;
  M.G.opportunity(data, s);
  return { t, s, U, d: t.drivers.s1.pending() };
};

// ---------- the seam ----------
{
  const { t, s, U, d } = await staged();
  M.L.setLocalSeat('s1');
  const all = d.options.filter((o) => o.tags[0] === 'launch' && o.facts.cardId === KK9);
  const ahead = owed(data, s, 's1', newMind(), { only: ['launch'] }).options.filter((o) => o.tags[0] === 'launch' && o.facts.cardId === KK9);
  check('THE KK9 IS OFFERED at every Landing Point in Range 18, each saying the Range it calls a shot in: the Overwatch Strike\'s 2',
    [all.length > 100, all.every((o) => o.facts.calls === 2)], [true, true]);
  check('and a look ahead is given the Landing Points within that Range of an enemy, as for any Projectile (`strike`)',
    [ahead.length > 0, ahead.every((o) => near(o, U.Dune, 2) || near(o, U.Sand, 2)), JSON.stringify(ahead.map((o) => o.id)) === JSON.stringify(all.filter((o) => near(o, U.Dune, 2) || near(o, U.Sand, 2)).map((o) => o.id))],
    [true, true, true]);
  M.L.setLocalSeat(null);
  t.close();
}

// ---------- the Tactician ----------
{
  const { t, s, U, d } = await staged();
  const rows = (w, sk = {}) => AI.weighed(d, viewOf(s, 's1'), { focus: false, ...sk }, w).filter(said);
  const on = rows({ spotter: 1 });
  check('WITH `spotter` AT 0 NO PLAN LAUNCHES IT; at 1 one does, worth at `future` the shot it calls (the Cobra holds no Command Token to hand it at once)',
    [rows({ spotter: 0 }).length, on.length > 0, on.every((p) => p.now > 0 && /a round on/.test(p.does))], [0, true, true]);
  const pick = (w) => { const c = AI.makeTactician({ focus: false }, w).choose(d, viewOf(s, 's1'), new AI.Rng('pick')); return { ...c, o: d.options.find((o) => o.id === c.option) }; };
  const off = pick({ spotter: 0 });
  const taken = pick({ spotter: 1 });
  check('and the choice: at 0 the Cobra\'s plan launches nothing; at 1 its plan ends in the launch (here after a Maneuver toward a zone), to call a shot on the Dune, which the Wolf has in its sights',
    [off.o.tags[0] === 'launch' || /call a shot/.test(off.why), /call a shot on Dune/.test(taken.why)], [false, true]);
  t.close();
  const held = await staged({ token: true });
  const now = AI.weighed(held.d, viewOf(held.s, 's1'), { focus: false }, { spotter: 1 }).filter(said);
  check('with a Command Token in hand to give it at once, the shot is worth its whole price',
    [now.length > 0, now.every((p) => !/a round on/.test(p.does)), Math.max(...now.map((p) => p.now)) > Math.max(...on.map((p) => p.now))], [true, true, true]);
  held.t.close();
  const last = await staged({ round: 5 });
  check('in the last round with no Token to hand, there is no Command to come: nothing',
    AI.weighed(last.d, viewOf(last.s, 's1'), { focus: false }, { spotter: 1 }).filter(said).length, 0);
  last.t.close();
}

// ---------- played on ----------
{
  const policies = { s1: AI.makeTactician({}, { spotter: 1 }), s2: AI.tacticianPolicy };
  const { t, s, U } = await staged({ policies });
  const sent = [];
  t.watch((cmd) => {
    if (cmd.kind === 'launch' || cmd.kind === 'overwatch' || (cmd.kind === 'performAction' && cmd.granted)) sent.push({ kind: cmd.kind, round: s.round.n, cardId: cmd.cardId, uid: cmd.uid, targetUid: cmd.targetUid, mechUid: cmd.mechUid, to: cmd.to });
  });
  await t.run({ until: (st) => st.round.n >= 2 && st.round.phase >= 2, maxSteps: t.steps() + 600 });
  const launched = sent.find((x) => x.kind === 'launch' && x.cardId === KK9);
  const called = sent.find((x) => x.kind === 'overwatch');
  const shot = sent.find((x) => x.kind === 'performAction');
  const dune = [Math.floor(U.Dune.col / 3), Math.floor(U.Dune.row / 3)];
  check('PLAYED ON, the Cobra launches the KK9 in round 1 within 2 of the Dune; by the Command Phase of round 2 it has called a shot on the Dune and left the board, and a Mech of the squad has fired the shot it was granted',
    [launched?.round, !!launched && Math.abs(Math.floor(launched.to.col / 3) - dune[0]) + Math.abs(Math.floor(launched.to.row / 3) - dune[1]) <= 2,
      !!called, called?.targetUid === U.Dune.uid, s.tokens.some((x) => x.cardId === KK9), !!shot && [U.Cobra.uid, U.Wolf.uid].includes(shot.uid), t.refused],
    [1, true, true, true, false, true, []]);
  console.log(`       ${JSON.stringify(sent)}`);
  t.close();
}

console.log(`\n${pass} passed, ${fail} failed`);
M.L.setLocalSeat(null);
if (fail) process.exit(1);
