// MISSILES ALREADY ON THE WAY (`overkill`, M24, 2026-10-13). OTTO, watching the GOF missile squad empty every launcher
// at two Drones: "If 1 missile each hits and kills the enemy drones then there will be 5 missiles that have no target
// ... If I was playing I would maybe fire off 4 to see how they do and save my ammo for the mechs that are in the
// back"; "it would be good to have the computer also consider the missiles fired by its squad mates". A launch at an
// enemy counts as often as that enemy would still be standing once the squad's Projectiles already on the table have
// struck it, whoever launched them.
//
// Staged on the real engine, on an empty board, in round 1's Action Phase: RDL's Hail and Sleet (each an ML-32 Dual
// Launcher, Volley 2: MC-3 "Razor" Missiles) on Projectile dials, three Grids from UN's Raven EC Type; UN's Rifle far
// out of reach. The first of them to act launches (the Missile style); then the other's question.
import { botTable, loadEngine } from './_engine.mjs';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}\n       got  ${g}`); }
};

console.log('Missiles already on the way\n');

const { M, data } = await loadEngine('seatoverkill', ["export * as SEAT from '../src/seat';", "export * as AI from '../src/ai/index';"]);
const AI = M.AI;
data.solo.squads['t-hail'] = {
  name: 'Hail', faction: 'RDL', points: 0,
  mechs: [
    { name: 'Hail', loadout: { torso: '014', chasis: '020', leftHand: '029', rightHand: '033', pilot: 'FPA-14' } },
    { name: 'Sleet', loadout: { torso: '014', chasis: '020', leftHand: '029', rightHand: '033', pilot: 'FPA-63' } },
  ],
  drones: [],
};
data.solo.squads['t-raven'] = {
  name: 'Raven', faction: 'UN', points: 0,
  mechs: [{ name: 'Rifle', loadout: { torso: '539', chasis: '099', rightHand: '541', pilot: 'LPA-23-2' } }],
  drones: [{ cardId: '165' }],
};
const at = (x, c, r, f) => { x.col = c * 3; x.row = r * 3; if (f !== undefined) x.facing = f; };
const scenario = { ...data.solo.scenarios[0], id: 't-overkill', map: 'none', mission: 'none', seats: { s1: 't-hail', s2: 't-raven' } };
const t = botTable(M, data, scenario, { seed: 5, policies: { s1: AI.missilePolicy, s2: AI.eagerPolicy } });
await t.run({ until: (st) => M.SU.normaliseSetup(st.setup)?.stage === 'done' && st.round.phase === 2 });
const s = t.state;
const U = Object.fromEntries(s.tokens.map((x) => [x.kind === 'drone' ? 'Raven' : x.label, x]));
at(U.Hail, 4, 2, 2); at(U.Sleet, 6, 2, 2); at(U.Raven, 5, 5, 0); at(U.Rifle, 5, 13, 0);
for (const x of s.tokens) { x.stance = 'offensive'; x.timing = 'firing'; }
U.Hail.timing = 'projectile';
U.Sleet.timing = 'projectile';
s.script.revealed = ['s1', 's2'];
s.script.acted = [U.Rifle.uid, U.Raven.uid];
s.script.opp = null;
M.G.opportunity(data, s);
const first = t.drivers.s1.pending()?.unit;
const second = first === U.Hail.uid ? U.Sleet.uid : U.Hail.uid;
const mine = (st) => st.tokens.filter((x) => x.kind === 'projectile' && x.side === 's1' && x.deployed !== false);
await t.run({ maxSteps: 200, until: (st) => mine(st).length > 0 && t.drivers.s1.pending()?.unit === second && t.drivers.s1.pending()?.kind === 'opp.act' });
const d = t.drivers.s1.pending();
const view = M.SEAT.viewOf(data, s, 's1');
check('THE STAGE: the first Mech has launched at the Raven (its Missiles on the table); the other\'s Opportunity is open',
  [mine(s).length > 0, d?.kind, d?.unit === second, d?.options.some((o) => o.tags[0] === 'launch')], [true, 'opp.act', true, true]);

const launching = (r) => String(r.does).startsWith('a Projectile');
const bestLaunch = (skills, tune) => AI.weighed(d, view, skills, tune).filter(launching).reduce((a, b) => (!a || b.now > a.now ? b : a), null);
{
  const off = bestLaunch({}, {});
  const on = bestLaunch({}, { overkill: 1 });
  check('AS IT SHIPS (`overkill` 0) a launch at the Raven is worth as much as though nothing were on the way',
    [!!off, off ? off.now > 0 : null], [true, true]);
  check('WITH `overkill` 1 it is worth less: the squadmate\'s Missiles on the table will likely have destroyed the Raven',
    [!!on, on && off ? on.now < off.now : null], [true, true]);
}
{
  // The Missile style's flat amount for each launch counts only what the launch could still strike.
  const style = bestLaunch(AI.MISSILE_SKILLS, AI.MISSILE_WEIGHTS);
  const styled = bestLaunch(AI.MISSILE_SKILLS, { ...AI.MISSILE_WEIGHTS, overkill: 1 });
  check('and the Missile style\'s barrage counts only what is still standing', [!!style, !!styled && styled.now < style.now], [true, true]);
}
check('as it ships (2026-10-13): 0 until measured', AI.TACTICIAN.overkill, 0);
t.close();

console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
