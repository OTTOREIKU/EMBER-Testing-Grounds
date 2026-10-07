// THE TIE CENSUS (tactician.ts `TIES`; OTTO, 2026-10-07: "yes go ahead with the
// near-tie census"). Where answers of two DIFFERENT Actions price within EXACT
// of each other the one listed first wins, and nothing in the pricing told them
// apart: the ML-34 Quad Missile Rack lost every such tie to the Dual Launcher
// beside it. A census sets `TIES.hook` and hears of each such tie; unset, it
// changes no answer. Staged on the real engine: RDL_Melee3's fourth Mech, its
// Projectile dial open, a Rifle within the Missiles' reach.
import { botTable, loadEngine } from './_engine.mjs';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}\n       got  ${g}`); }
};

console.log('The tie census\n');

const { M, data } = await loadEngine('seattiecensus', ["export * as SEAT from '../src/seat';", "export * as AI from '../src/ai/index';"]);
const AI = M.AI;
data.solo.squads['t-rack'] = {
  name: 'Rack', faction: 'RDL', points: 0,
  mechs: [{ name: 'Rack', loadout: { torso: '533', chasis: '534', leftHand: '299', rightHand: '068', backpack: '004', pilot: 'FPA-03' } }],
  drones: [],
};
data.solo.squads['t-rifle'] = {
  name: 'Rifle', faction: 'UN', points: 0,
  mechs: [{ name: 'Rifle', loadout: { torso: '539', chasis: '099', rightHand: '541', pilot: 'LPA-23-2' } }],
  drones: [],
};
const scenario = { ...data.solo.scenarios[0], id: 't-tiecensus', map: 'none', mission: 'none', seats: { s1: 't-rack', s2: 't-rifle' } };
const t = botTable(M, data, scenario, { seed: 3, policies: AI.eagerPolicy });
await t.run({ until: (st) => M.SU.normaliseSetup(st.setup)?.stage === 'done' && st.round.phase === 2 });
const s = t.state;
const U = Object.fromEntries(s.tokens.map((x) => [x.label, x]));
const at = (x, c, r, f) => { x.col = c * 3; x.row = r * 3; if (f !== undefined) x.facing = f; };
at(U.Rack, 4, 2, 2); at(U.Rifle, 4, 6, 0);
for (const x of s.tokens) { x.stance = 'offensive'; x.timing = 'firing'; }
U.Rack.timing = 'projectile';
s.script.revealed = ['s1', 's2'];
s.script.acted = [];
s.script.opp = null;
M.G.opportunity(data, s);
const d = t.drivers.s1.pending();
const view = M.SEAT.viewOf(data, s, 's1');
const ask = (weights) => AI.makeTactician({}, weights).choose(d, view, new AI.Rng('tie')).option;

check('the hook ships unset', AI.TIES.hook, null);
const quiet = ask({});
const heard = [];
AI.TIES.hook = (x) => heard.push(x);
const loud = ask({});
AI.TIES.hook = null;
const launches = heard.filter((x) => x.where === 'launch');
check('WITH IT SET, as the Ace ships, the Rack and the Dual Launcher are heard tied at the launch (the same Missile from the same Grid, priced alike: the Volley\'s next launch is what breaks it)',
  [launches.length > 0, launches.every((x) => [x.actionA, x.actionB].sort().join() === '004_A,299_B' && x.unit === U.Rack.uid)], [true, true]);
check('and hearing changes no answer', loud, quiet);
t.close();

console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
