// THE TIEBREAK AS IT IS GOING (AI-OPPONENT-PLAN.md, "THE NIGHT OF 2026-10-04";
// the weight `erode`, for `press`; 0 leaves every game as it was). A traced VIP
// game of OTTO's community squads (random game 61305, the Alley): RDL_Melee1's
// four melee Mechs, ahead on the Mech Parts 19 to 15 and level on Victory
// Points, counted themselves winning, braced in their zone for three rounds
// under silent_nonsense's guns, and lost the game 0 to 0 on the Parts left.
// With `erode` the Parts are read as they would stand at the end: each unit
// with an enemy within its arm and its Maneuver takes `erode` of one a round
// from the other squad, so a squad the other outguns from where both stand is
// losing its lead, and is behind, and `press` moves it; and the squad that
// outguns it, behind on the Parts as they stand, is not.
import { botTable, loadEngine } from './_engine.mjs';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}\n       got  ${g}`); }
};

console.log('The tiebreak as it is going\n');

const { M, data } = await loadEngine('seaterode', ["export * as SEAT from '../src/seat';", "export * as AI from '../src/ai/index';", "export * as HUD from '../src/matchhud';"]);
const AI = M.AI;
const mech = (name, torso, chasis, leftHand, rightHand, backpack, pilot) => ({ name, loadout: Object.fromEntries(Object.entries({ torso, chasis, leftHand, rightHand, backpack, pilot }).filter(([, v]) => v)) });
// The two squads as the builder exported them (tests/community.test.mjs).
data.solo.squads['erode-s1'] = { name: 'RDL_Melee1', faction: 'RDL', mechs: [mech('Melee 1', '016', '022', '062', '036', '001', 'FPA-03'), mech('Melee 2', '017', '022', '062', '063', '010', 'FPA-05'), mech('Melee 3', '015', '022', '520', '063', '010', 'FPA-04'), mech('Melee 4', '018', '022', null, '048', '009', 'FPA-01')], drones: [] };
data.solo.squads['erode-s2'] = { name: 'silent_nonsense', faction: 'UN', mechs: [mech('Silent 1', '096', '100', '131', '124', '083', 'LPA-24'), mech('Silent 2', '247', '100', '540', '127', '538', 'LPA-21'), mech('Silent 3', '098', '101', '144', '148', '090', 'LPA-20')], drones: [] };
const scenario = { id: 'erode', map: 'none', mission: 'vip-commander-assassination', rounds: 5, secondaries: false, tactics: false, seats: { s1: 'erode-s1', s2: 'erode-s2' } };

// The table set up, then the units stood where the moment wants them: the
// melee Mechs along row 2, the UN Mechs eight rows south facing them (two of
// their guns reach, with Range 8 and a Maneuver; nothing of the RDL squad's
// does, its Burst Fire of 4 and its blades), round 1's Action Phase, the
// Opportunity of the unit named, on the Timing named.
const t = botTable(M, data, scenario, { seed: 7, policies: AI.eagerPolicy, glue: M.HUD.glueAfter });
await t.run({ until: (st) => M.SU.normaliseSetup(st.setup)?.stage === 'done' });
const s = t.state;
const U = Object.fromEntries(s.tokens.map((x) => [x.label, x]));
const at = (x, c, r, f) => { x.col = c * 3; x.row = r * 3; x.facing = f; };
['Melee 1', 'Melee 2', 'Melee 3', 'Melee 4'].forEach((n, i) => at(U[n], 2 + i * 2, 1, 2));
['Silent 1', 'Silent 2', 'Silent 3'].forEach((n, i) => at(U[n], 3 + i * 2, 9, 0));
for (const x of s.tokens) x.statuses = (x.statuses ?? []).filter((y) => y !== 'camouflage');
const sc = s.script;
s.round.phase = 2; sc.stage = '1:2'; sc.passed = []; sc.revealed = ['s1', 's2'];
for (const x of s.tokens) if (x.kind === 'mech') x.timing = 'firing';
const ask = (name, timing) => {
  U[name].timing = timing;
  sc.acted = s.tokens.filter((x) => x.kind === 'mech' && x.uid !== U[name].uid).map((x) => x.uid);
  sc.opp = null;
  M.G.opportunity(data, s);
  const d = t.drivers[U[name].side].pending();
  return { d, view: M.SEAT.viewOf(data, s, U[name].side) };
};
const shapes = (q, w) => Object.fromEntries(AI.weighed(q.d, q.view, {}, w).map((r) => [r.label, r.shape]));
const ratios = (q) => {
  const off = shapes(q, {});
  const on = shapes(q, { erode: 0.5 });
  return Object.keys(off).filter((l) => l !== 'stay' && Math.abs(off[l]) > 1e-6).map((l) => Math.round((on[l] / off[l]) * 1000) / 1000);
};
const one = (xs) => [...new Set(xs)];

const melee = ask('Melee 3', 'melee');
check('THE MELEE SQUAD COUNTS ITSELF AHEAD AS THE BOARD STANDS: level on Victory Points, 19 Mech Parts to 15, so `press` alone leaves it as it was',
  [AI.behindNow(melee.view, AI.TACTICIAN), AI.standingFor(melee.view, 's1'), AI.standingFor(melee.view, 's2')], [false, 19, 15]);
check('WITH `erode` 0.5 IT IS BEHIND (two UN guns reach it, nothing of its own reaches them): a step toward contact counts `press` times over besides, eleven times what it did',
  one(ratios(melee)), [11]);
const gun = ask('Silent 2', 'firing');
check('THE SQUAD THAT OUTGUNS IT is behind on the Parts as they stand, and presses; with `erode` it is ahead as the Parts are going, and its step toward contact counts once again',
  [AI.behindNow(gun.view, AI.TACTICIAN), one(ratios(gun))], [true, [Math.round((1 / 11) * 1000) / 1000]]);
check('at 0 every plan of both squads is priced as it was',
  [JSON.stringify(shapes(melee, { erode: 0 })) === JSON.stringify(shapes(melee, {})), JSON.stringify(shapes(gun, { erode: 0 })) === JSON.stringify(shapes(gun, {}))], [true, true]);
t.close();

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
