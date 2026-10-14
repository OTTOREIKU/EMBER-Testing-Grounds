// A PROJECTILE WITH NO TARGET IN THE DELAY PHASE (2026-10-14). OTTO, watching two computers: "an m60 Missile and a
// Mc-3 missile didnt have targets but stayed on the field after the delay phase". Every Projectile performs its Delayed
// Action in the Delay Phase (3.6.1), and one that needs a target and finds none in Range is destroyed (4.7.5), unless
// its card keeps it (the PK3). The seam offered "End this activation" beside "finds no target and is destroyed", and
// the computer, which never values losing a unit of its own, ended instead: the Missile stayed for the next round.
//
// Staged on the real engine, on an empty board: RDL's Hail launches its ML-32's Volley of two MC-3 "Razor" Missiles
// (Range 3) in round 1; both are set down where no enemy stands within 3 Grids, and the Delay Phase asks the first.
import { botTable, loadEngine } from './_engine.mjs';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}\n       got  ${g}`); }
};

console.log('A Projectile with no target in the Delay Phase\n');

const { M, data } = await loadEngine('seatnotarget', ["export * as SEAT from '../src/seat';", "export * as AI from '../src/ai/index';"]);
const AI = M.AI;
data.solo.squads['t-hail'] = {
  name: 'Hail', faction: 'RDL', points: 0,
  mechs: [{ name: 'Hail', loadout: { torso: '014', chasis: '020', leftHand: '029', rightHand: '033', pilot: 'FPA-14' } }],
  drones: [],
};
data.solo.squads['t-far'] = {
  name: 'Far', faction: 'UN', points: 0,
  mechs: [{ name: 'Rifle', loadout: { torso: '539', chasis: '099', rightHand: '541', pilot: 'LPA-23-2' } }],
  drones: [{ cardId: '165' }],
};
const at = (x, c, r, f) => { x.col = c * 3; x.row = r * 3; if (f !== undefined) x.facing = f; };
const scenario = { ...data.solo.scenarios[0], id: 't-notarget', map: 'none', mission: 'none', seats: { s1: 't-hail', s2: 't-far' } };
const t = botTable(M, data, scenario, { seed: 5, policies: { s1: AI.missilePolicy, s2: AI.eagerPolicy } });
await t.run({ until: (st) => M.SU.normaliseSetup(st.setup)?.stage === 'done' && st.round.phase === 2 });
const s = t.state;
const U = { Hail: s.tokens.find((x) => x.label === 'Hail'), Rifle: s.tokens.find((x) => x.label === 'Rifle'), Raven: s.tokens.find((x) => x.cardId === '165') };
at(U.Hail, 5, 1, 2); at(U.Rifle, 5, 6, 0); at(U.Raven, 3, 6, 0);
for (const x of s.tokens) { x.stance = 'offensive'; x.timing = 'firing'; }
U.Hail.timing = 'projectile';
s.script.revealed = ['s1', 's2'];
s.script.acted = [U.Rifle.uid, U.Raven.uid];
s.script.opp = null;
M.G.opportunity(data, s);
const mine = (st) => st.tokens.filter((x) => x.kind === 'projectile' && x.side === 's1' && x.deployed !== false);
await t.run({ maxSteps: 300, until: (st) => mine(st).length > 1 });
// Both Razors set down in the far corner: no enemy within their Range of 3.
for (const p of mine(s)) at(p, 11, 0);
await t.run({ maxSteps: 400, until: () => { const d = t.drivers.s1.pending(); return !!d && mine(s).some((p) => p.uid === d.unit); } });
const d = t.drivers.s1.pending();
const razor = d?.unit;
const ids = (d?.options ?? []).map((o) => o.id);
check('THE STAGE: the Delay Phase asks a Razor with no enemy within its Range',
  [M.TY.PHASES[s.round.phase], mine(s).length, mine(s).every((p) => p.col === 33 && p.row === 0)], ['Delay', 2, true]);
check('ITS DELAYED ACTION IS NOT TO BE PUT OFF: "finds no target and is destroyed" is offered, and ending its activation is not',
  [ids.some((id) => id.startsWith('detonate:') && id.endsWith(':none')), ids.includes('end')], [true, false]);
// The table holds a player to it too (OTTO: "No one should be able to end a turn and keep a missile on the board").
const ending = M.C.check(data, s, { kind: 'endOpportunity', seat: 's1', uid: razor });
const destroying = M.C.check(data, s, { kind: 'despawn', seat: 's1', uid: razor, targetUid: razor });
check('A PLAYER may not end its activation either, and may destroy it',
  [ending.ok, /Delayed Action in the Delay Phase \(3\.6\.1\)/.test(ending.why ?? ''), destroying.ok], [false, true, true]);
{
  // Nor pass the Delay Phase before the Missiles are activated (2026-10-14, played on the table: four M707s passed
  // over stayed on the board, one with an enemy Drone three Grids away). With none of its Missiles left, it may.
  const held = JSON.parse(JSON.stringify(s));
  held.script.opp = null;
  held.script.acted = held.script.acted.filter((u) => !mine(held).some((p) => p.uid === u));
  held.script.passed = [];
  held.script.turn = 's1';
  const passing = M.C.check(data, held, { kind: 'passTurn', seat: 's1' });
  held.tokens = held.tokens.filter((x) => !(x.kind === 'projectile' && x.side === 's1'));
  const clear = M.C.check(data, held, { kind: 'passTurn', seat: 's1' });
  check('NOR PASS THE PHASE with its Missiles not yet activated; with none left, the pass stands',
    [passing.ok, /Delayed Action in the Delay Phase \(3\.6\.1\)/.test(passing.why ?? ''), clear.ok], [false, true, true]);
}
const view = M.SEAT.viewOf(data, s, 's1');
const said = (p) => d.options.find((o) => o.id === p.choose(d, view, new AI.Rng('nt')).option)?.label ?? '';
check('and every computer gives it: the Ace, the Missile style and the eager answer',
  [/finds no target and is destroyed/.test(said(AI.tacticianPolicy)), /finds no target and is destroyed/.test(said(AI.missilePolicy)), /finds no target and is destroyed/.test(said(AI.eagerPolicy))], [true, true, true]);
await t.run({ maxSteps: 400, until: (st) => !st.tokens.some((x) => x.uid === razor && x.deployed !== false) || st.round.phase !== s.round.phase });
check('once it acts, the Razor is gone from the table', s.tokens.some((x) => x.uid === razor && x.deployed !== false), false);
{
  // THE OTHER RAZOR, its only target in Range a Raven in Optical Camouflage: the seam has no Scan for a Projectile to
  // make, and it is not kept on the board either: it finds no target it can pick, and is destroyed.
  const other = mine(s).find((p) => p.uid !== razor);
  at(U.Raven, 10, 1, 0);
  U.Raven.statuses = [...(U.Raven.statuses ?? []), 'camouflage'];
  await t.run({ maxSteps: 400, until: () => t.drivers.s1.pending()?.unit === other?.uid });
  const d2 = t.drivers.s1.pending();
  const ids2 = (d2?.options ?? []).map((o) => o.id);
  check('ITS ONLY TARGET IN OPTICAL CAMOUFLAGE: no end, and "finds no target and is destroyed"',
    [!!other, d2?.unit === other?.uid, ids2.includes('end'), ids2.some((id) => id.startsWith('detonate:') && id.endsWith(':none'))], [true, true, false, true]);
}
t.close();

console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
