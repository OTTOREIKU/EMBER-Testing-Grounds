// INTERCEPTOR COVER (`coverFire`, `coverMates`, M24, 2026-10-13). OTTO: "analyze why the community squads lost and
// then try to tune our ai models to deal with the threat better". A Missile flying at a unit owes an Interception to
// each of its enemies with Interception Tokens left whose Intercept Range reaches the Grid it flies into (4.9; FAQ
// M9/M20). With interceptors put into the community squads the missile squads struck 10.9 times a game where they had
// struck 12.4, for 4.6 Interceptions a game against 18 launches: nothing in the planner read the squad's own
// Interception. The view now gives each unit's (`intercept`); `coverFire` prices an enemy Projectile's strike as often
// as it would come through the squad's interceptors in reach, and `coverMates` makes an interceptor's Grid worth what
// it would stop of the fire on the squadmates in its Range.
//
// Staged on the real engine, on an empty board, in round 1's Action Phase: RDL's Guard (an AMS-190 Active Defense
// System on its back: Intercept 3, Range 3) with its Opportunity open on a Melee dial (Melee comes before Projectile),
// RDL's Dune four Grids off it (the Guard's Maneuver is one Grid); UN's Pod (an RKG70 Missile Pod) five Grids from Dune
// with its Projectile turn to come; UN's Rifle out of the way.
import { botTable, loadEngine } from './_engine.mjs';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}\n       got  ${g}`); }
};

console.log('Interceptor cover\n');

const { M, data } = await loadEngine('seatumbrella', ["export * as SEAT from '../src/seat';", "export * as AI from '../src/ai/index';"]);
const AI = M.AI;
data.solo.squads['t-guard'] = {
  name: 'Guard', faction: 'RDL', points: 0,
  mechs: [
    { name: 'Guard', loadout: { torso: '014', chasis: '020', leftHand: '032', backpack: '003', pilot: 'FPA-63' } },
    { name: 'Dune', loadout: { torso: '014', chasis: '020', leftHand: '032', rightHand: '033', pilot: 'FPA-01' } },
  ],
  drones: [],
};
data.solo.squads['t-pod'] = {
  name: 'Pod', faction: 'UN', points: 0,
  mechs: [
    { name: 'Pod', loadout: { torso: '539', chasis: '099', leftHand: '129', pilot: 'LPA-23-2' } },
    { name: 'Rifle', loadout: { torso: '539', chasis: '099', rightHand: '541', pilot: 'LPA-22' } },
  ],
  drones: [],
};
const at = (x, c, r, f) => { x.col = c * 3; x.row = r * 3; if (f !== undefined) x.facing = f; };
const scenario = { ...data.solo.scenarios[0], id: 't-umbrella', map: 'none', mission: 'none', seats: { s1: 't-guard', s2: 't-pod' } };
const t = botTable(M, data, scenario, { seed: 5, policies: AI.eagerPolicy });
await t.run({ until: (st) => M.SU.normaliseSetup(st.setup)?.stage === 'done' && st.round.phase === 2 });
const s = t.state;
const U = Object.fromEntries(s.tokens.map((x) => [x.label, x]));
at(U.Guard, 8, 10, 0); at(U.Dune, 4, 10, 0); at(U.Pod, 4, 5, 2); at(U.Rifle, 0, 0, 2);
for (const x of s.tokens) { x.stance = 'offensive'; x.timing = 'firing'; }
U.Guard.timing = 'melee';
U.Pod.timing = 'projectile';
s.script.revealed = ['s1', 's2'];
s.script.acted = [U.Dune.uid, U.Rifle.uid];
s.script.opp = null;
M.G.opportunity(data, s);
const d = t.drivers.s1.pending();
const view = M.SEAT.viewOf(data, s, 's1');
const V = Object.fromEntries(view.units.map((u) => [u.label, u]));
const apart = (a, b) => Math.abs(a.col - b.col) + Math.abs(a.row - b.row);
check('THE STAGE: the Guard\'s Opportunity is open; the view gives its Interception (Range 3, three Tokens) and nobody else\'s; Dune four Grids off',
  [d?.kind, d?.unit === U.Guard.uid, V.Guard.intercept, V.Dune.intercept ?? null, V.Pod.intercept ?? null, apart(V.Guard.grid, V.Dune.grid)],
  ['opp.act', true, { reach: 3, left: 3, slots: { backpack: 3 } }, null, null, 4]);

const best = (weights) => AI.weighed(d, view, {}, weights)[0];
const off = best({ coverMates: 0 });
const on = best({ coverMates: 1 });
check('WITHOUT `coverMates` (0) the Guard\'s best plan leaves Dune out of its Range', apart(off.at, V.Dune.grid) > 3, true);
check('WITH `coverMates` 1 its best plan walks it to where its Interception covers Dune', [on.how, apart(on.at, V.Dune.grid) <= 3], ['move', true]);

// `coverFire`: Dune's own question (its Opportunity open on a Melee dial, the Guard's turn behind it), the Guard three
// Grids off it (in its Intercept Range), then four. What standing where it stands costs Dune, the Pod's salvo read with
// `salvo` on both ways: it is off as the Ace plays, and `coverFire` then prices a Projectile already on the table.
const duneAsks = (col) => {
  at(U.Guard, col, 10, 0);
  U.Dune.timing = 'melee';
  s.script.acted = [U.Guard.uid, U.Rifle.uid];
  s.script.opp = null;
  M.G.opportunity(data, s);
  const d2 = t.drivers.s1.pending();
  const v2 = M.SEAT.viewOf(data, s, 's1');
  const cost = (weights) => AI.exposureAt(d2, v2, null, Infinity, {}, weights)?.cost;
  return { dune: d2?.unit === U.Dune.uid, bare: cost({ salvo: 1 }), shielded: cost({ salvo: 1, coverFire: 1 }) };
};
const covered = duneAsks(7);
const open = duneAsks(8);
check('WITH `coverFire` 1 Dune counts the Guard\'s Interception: the Pod\'s salvo costs it less with the Guard three Grids off, and the same with it four off',
  [covered.dune, covered.bare > 0, covered.shielded < covered.bare, open.dune, open.shielded === open.bare], [true, true, true, true, true]);
// `coverLaunch`: the Guard's turn again, four Grids east of the Pod. A launch owes an Interception to each interceptor in
// Range of the launcher's Grid too, so a Grid three off the Pod is worth what the Pod's Missiles stand to do to the
// squad; a Grid further off, nothing more.
U.Guard.timing = 'melee';
at(U.Guard, 8, 5, 0);
s.script.acted = [U.Dune.uid, U.Rifle.uid];
s.script.opp = null;
M.G.opportunity(data, s);
const d3 = t.drivers.s1.pending();
const v3 = M.SEAT.viewOf(data, s, 's1');
const shapes = (weights) => new Map(AI.weighed(d3, v3, {}, weights).map((r) => [`${r.at.col},${r.at.row}|${r.label}`, { r, gap: apart(r.at, V.Pod.grid) }]));
const bare3 = shapes({});
const on3 = shapes({ coverLaunch: 1 });
const rose = [...on3].filter(([k, x]) => x.r.shape > (bare3.get(k)?.r.shape ?? Infinity) + 1e-9);
const still = [...on3].filter(([k, x]) => x.gap > 3 && x.r.shape !== bare3.get(k)?.r.shape);
check('WITH `coverLaunch` 1 a Grid in Intercept Range of the Pod is worth more to the Guard, and a Grid out of it no more',
  [d3?.unit === U.Guard.uid, rose.length > 0 && rose.every(([, x]) => x.gap <= 3), still.length], [true, true, 0]);
check('AS IT SHIPS (2026-10-14): coverMates on at the measured stop chance, coverFire and coverLaunch off', [AI.TACTICIAN.coverFire, AI.TACTICIAN.coverMates, AI.TACTICIAN.coverLaunch, AI.TACTICIAN.coverStop], [0, 1, 0, 0.15]);
t.close();

console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
