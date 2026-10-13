// A LAUNCHER'S THREAT (`launchThreat`, M24, 2026-10-13). What destroying an enemy is worth counts what it would go on
// to do (`threat`), and that was read off its Firing Actions alone: a Drone whose every attack is a Missile was no
// threat at all, so the Ace shot the gun beside it first. The missile squads built for the red team won 73 of 100
// against the community squads with the Ace on both sides; OTTO: "analyze why the community squads lost and then try
// to tune our ai models to deal with the threat better". With the weight, a launcher's threat is the worst its
// Projectiles could do to a unit of this squad (`launchFire`).
//
// Staged on the real engine, on an empty board, in round 1's Action Phase: UN's Rifle with its Opportunity open, an
// RDL Hyena Missile Type (its Missile a Command Action) and a Tarantula Firepower Type (a gun), both in its sights,
// their Mech out of reach.
import { botTable, loadEngine } from './_engine.mjs';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}\n       got  ${g}`); }
};

console.log('A launcher\'s threat\n');

const { M, data } = await loadEngine('seatlaunchthreat', ["export * as SEAT from '../src/seat';", "export * as AI from '../src/ai/index';"]);
const AI = M.AI;
data.solo.squads['t-rifle'] = {
  name: 'Rifle', faction: 'UN', points: 0,
  mechs: [{ name: 'Rifle', loadout: { torso: '539', chasis: '099', rightHand: '541', pilot: 'LPA-23-2' } }],
  drones: [],
};
data.solo.squads['t-theirs'] = {
  name: 'Theirs', faction: 'RDL', points: 0,
  mechs: [{ name: 'Dune', loadout: { torso: '014', chasis: '020', leftHand: '032', rightHand: '033', pilot: 'FPA-63' } }],
  drones: [{ cardId: '079' }, { cardId: '163' }],
};
const scenario = { ...data.solo.scenarios[0], id: 't-launchthreat', map: 'none', mission: 'none', seats: { s1: 't-rifle', s2: 't-theirs' } };
const t = botTable(M, data, scenario, { seed: 5, policies: AI.eagerPolicy });
await t.run({ until: (st) => M.SU.normaliseSetup(st.setup)?.stage === 'done' && st.round.phase === 2 });
const s = t.state;
const U = {};
for (const x of s.tokens) U[x.cardId === '079' ? 'Hyena' : x.cardId === '163' ? 'Tarantula' : x.label] = x;
const at = (x, c, r, f) => { x.col = c * 3; x.row = r * 3; if (f !== undefined) x.facing = f; };
at(U.Rifle, 4, 9, 0); at(U.Hyena, 3, 5, 2); at(U.Tarantula, 5, 5, 2); at(U.Dune, 0, 0, 2);
for (const x of s.tokens) { x.stance = 'offensive'; x.timing = 'firing'; }
s.script.revealed = ['s1', 's2'];
s.script.acted = s.tokens.filter((x) => x.kind === 'mech' && x.side === 's2').map((x) => x.uid);
s.script.opp = null;
M.G.opportunity(data, s);
const d = t.drivers.s1.pending();
const view = M.SEAT.viewOf(data, s, 's1');
const hyena = view.units.find((u) => u.uid === U.Hyena.uid);
const shotAt = (uid) => d.options.some((o) => o.tags[0] === 'attack' && o.facts?.targetUid === uid);
check('THE STAGE: the Rifle\'s Opportunity is open, the Hyena and the Tarantula both in its sights; the Hyena strikes with a Missile alone',
  [d?.kind, d?.unit === U.Rifle.uid, shotAt(U.Hyena.uid), shotAt(U.Tarantula.uid), hyena.weapons.filter((x) => ['Firing', 'Melee', 'Projectile'].includes(x.type)).map((x) => x.type)],
  ['opp.act', true, true, true, ['Projectile']]);
const target = (lt) => {
  const c = AI.makeTactician({}, { launchThreat: lt }).choose(d, view, new AI.Rng('lt'));
  return d.options.find((o) => o.id === c.option)?.facts?.targetUid;
};
check('AS IT SHIPS the Rifle shoots the Tarantula, the gun: the Hyena\'s Missiles count for nothing', target(0) === U.Tarantula.uid, true);
check('WITH `launchThreat` 1 it shoots the Hyena first', target(1) === U.Hyena.uid, true);
check('as it ships (2026-10-13): 0 until measured', AI.TACTICIAN.launchThreat, 0);
t.close();

console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
