// A VOLLEY'S LATER PROJECTILES (the Tactician's weight `volleyLaunch`; OTTO,
// 2026-10-07: "look into why the Quad Missile Rack never fires": the ML-34 Quad
// Missile Rack's Missile, 004_A, launched 0 times in 67 offers in the community
// kit census).
//
// RDL_Melee3's fourth Mech carries the Rack (Volley 2) beside an ML-32B Dual
// Launcher (Volley 1), and both launch the same MC-3 "Razor" Missile. The Ace
// kept one Landing Point an enemy for each CARD, so the Rack's launches were
// never priced at all, and a launch was priced as its one Projectile, so it
// could not have told the two apart anyway: the Dual Launcher, listed first,
// won every time. With `volleyLaunch`, each Action's launches are priced, and a
// Volley's next launch counts too. Played on the real engine: the Mech's
// Projectile dial open, a Rifle within the Missiles' reach.
import { botTable, loadEngine } from './_engine.mjs';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}\n       got  ${g}`); }
};

console.log('A Volley\'s later Projectiles\n');

const { M, data } = await loadEngine('seatvolleylaunch', ["export * as SEAT from '../src/seat';", "export * as AI from '../src/ai/index';"]);
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
const scenario = { ...data.solo.scenarios[0], id: 't-volleylaunch', map: 'none', mission: 'none', seats: { s1: 't-rack', s2: 't-rifle' } };

// The Rack's Projectile Opportunity played by the Tactician with these weights: the launches it makes.
async function played(weights) {
  const t = botTable(M, data, scenario, { seed: 3, policies: { s1: AI.makeTactician({}, weights), s2: AI.eagerPolicy } });
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
  const launches = [];
  t.watch((cmd) => { if (cmd.kind === 'launch' && cmd.uid === U.Rack.uid) launches.push(cmd.actionId); });
  await t.run({ until: (st) => st.script.acted.includes(U.Rack.uid), maxSteps: t.steps() + 120 });
  const r = { launches, refused: t.refused.map((x) => `${x.kind}: ${x.why}`) };
  t.close();
  return r;
}

const off = await played({ volleyLaunch: 0 });
check('WITHOUT `volleyLaunch` the Mech launches one Missile, from the Dual Launcher listed first',
  [off.launches, off.refused], [['299_B'], []]);
const on = await played({ volleyLaunch: 1 });
check('WITH IT the Quad Missile Rack fires, both Missiles of its Volley',
  [on.launches, on.refused], [['004_A', '004_A'], []]);
const shipped = await played({});
check('AS IT SHIPS (0.05, a tie-break: measured 199 of 200 random games and 164 of 168 melee games the very same) the Rack fires both of its Volley too',
  [AI.TACTICIAN.volleyLaunch, shipped.launches, shipped.refused], [0.05, ['004_A', '004_A'], []]);

console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
