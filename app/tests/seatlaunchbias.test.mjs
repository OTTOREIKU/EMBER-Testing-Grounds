// THE MISSILE BARRAGE (`launchBias`, the Missile style; M24 and M19, 2026-10-13). OTTO: "Lets bake in a missile
// strategy, mechs and drones that try to fire as many missiles as possible to disrupt the opponents". A launch with an
// enemy inside its strike is worth a flat `launchBias` more than its blast, each launch of a Volley counted so where
// the whole Volley is (`volleyLaunch`). The Ace keeps 0; the Missile style (styles.ts) plays it at 1, its Volleys whole.
//
// Staged on the real engine, on an empty board, in round 1's Action Phase: RDL's Salvo (an ML-94 Quad Missile Rack,
// Volley 4 at Range 6; an ML-32 Dual Launcher, Volley 2 at Range 3; an R-20 railgun) with its Opportunity open, four
// Grids from UN's Rifle.
import { botTable, loadEngine } from './_engine.mjs';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}\n       got  ${g}`); }
};

console.log('The missile barrage\n');

const { M, data } = await loadEngine('seatlaunchbias', ["export * as SEAT from '../src/seat';", "export * as AI from '../src/ai/index';"]);
const AI = M.AI;
data.solo.squads['t-salvo'] = {
  name: 'Salvo', faction: 'RDL', points: 0,
  mechs: [{ name: 'Salvo', loadout: { torso: '014', chasis: '020', leftHand: '029', rightHand: '033', backpack: '501', pilot: 'FPA-14' } }],
  drones: [],
};
data.solo.squads['t-rifle'] = {
  name: 'Rifle', faction: 'UN', points: 0,
  mechs: [{ name: 'Rifle', loadout: { torso: '539', chasis: '099', rightHand: '541', pilot: 'LPA-23-2' } }],
  drones: [],
};
const scenario = { ...data.solo.scenarios[0], id: 't-launchbias', map: 'none', mission: 'none', seats: { s1: 't-salvo', s2: 't-rifle' } };
const t = botTable(M, data, scenario, { seed: 5, policies: AI.eagerPolicy });
await t.run({ until: (st) => M.SU.normaliseSetup(st.setup)?.stage === 'done' && st.round.phase === 2 });
const s = t.state;
const U = Object.fromEntries(s.tokens.map((x) => [x.label, x]));
const at = (x, c, r, f) => { x.col = c * 3; x.row = r * 3; if (f !== undefined) x.facing = f; };
at(U.Salvo, 4, 1, 2); at(U.Rifle, 4, 5, 0);
for (const x of s.tokens) { x.stance = 'offensive'; x.timing = 'firing'; }
s.script.revealed = ['s1', 's2'];
s.script.acted = [U.Rifle.uid];
s.script.opp = null;
M.G.opportunity(data, s);
const d = t.drivers.s1.pending();
const view = M.SEAT.viewOf(data, s, 's1');
const salvo = view.units.find((u) => u.uid === U.Salvo.uid);
check('THE STAGE: the Salvo\'s Opportunity is open; it carries two launchers and a gun, and may launch at the Rifle or shoot it',
  [d?.kind, salvo.weapons.filter((x) => x.type === 'Projectile').map((x) => x.actionId).sort(), d.options.some((o) => o.tags[0] === 'launch'), d.options.some((o) => o.tags[0] === 'attack')],
  ['opp.act', ['029_B', '501_A'], true, true]);

const launching = (r) => String(r.does).startsWith('a Projectile');
const stayLaunch = (tune) => AI.weighed(d, view, {}, tune).find((r) => r.how === 'stay' && launching(r));
{
  // The ML-94's Volley 4 counted whole: each of its four launches is worth `launchBias` more.
  const off = stayLaunch({ launchBias: 0, volleyLaunch: 1 });
  const on = stayLaunch({ launchBias: 1, volleyLaunch: 1 });
  check('A LAUNCH IS WORTH `launchBias` MORE for each Projectile it puts down: the Volley of four, 4 more at 1',
    [!!off, !!on, off && on ? Math.round((on.now - off.now) * 100) / 100 : null], [true, true, 4]);
}
{
  const ace = AI.weighed(d, view, {}, {})[0];
  const missile = AI.weighed(d, view, AI.MISSILE_SKILLS, AI.MISSILE_WEIGHTS)[0];
  check('AS THE ACE PLAYS IT the railgun\'s Single Shot is the deed; AS THE MISSILE STYLE PLAYS IT, the whole Volley of Missiles',
    [String(ace?.does).startsWith('Single Shot'), launching(missile ?? {})], [true, true]);
}
check('as it ships (2026-10-13): 0 for every level; the Missile style at 1, its Volleys counted whole',
  [AI.TACTICIAN.launchBias, AI.MISSILE_WEIGHTS.launchBias, AI.MISSILE_WEIGHTS.volleyLaunch, AI.missilePolicy.name], [0, 1, 1, 'missile']);
t.close();

console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
