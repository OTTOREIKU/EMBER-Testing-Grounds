// A MISSILE'S FLIGHT THROUGH INTERCEPTION (`flightOdds`, `icptBurn`, M24, 2026-10-14). OTTO, watching the missile
// squads against RDL_Melee2: "the missile chose to attack a unit that was in range of another enemy with interception
// however if it would have attacked a nearby unit the enemy interception would have been out of range ... should the
// attacking missiles try to calculate that and see if it's worth burning the interception or if it would rather go for
// a direct hit". The driver now reads a Missile's flight as it reads a launch: the chance it comes through the
// Interception its flight draws (`survive`) and the Tokens those tries would cost the enemy (`drain`).
//
// Staged on the real engine, on an empty board: RDL's Hail launches its ML-32's Volley of two MC-3 "Razor" Missiles in
// round 1, and the Delay Phase asks the first where it flies: at UN's Rifle (a Porcupine CIWS three Grids off it,
// Intercept 3 at Range 4) or at UN's Raven EC Type (out of the CIWS's Range).
import { botTable, loadEngine } from './_engine.mjs';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}\n       got  ${g}`); }
};

console.log('A Missile\'s flight through Interception\n');

const { M, data } = await loadEngine('seatflight', ["export * as SEAT from '../src/seat';", "export * as AI from '../src/ai/index';"]);
const AI = M.AI;
data.solo.squads['t-hail'] = {
  name: 'Hail', faction: 'RDL', points: 0,
  mechs: [{ name: 'Hail', loadout: { torso: '014', chasis: '020', leftHand: '029', rightHand: '033', pilot: 'FPA-14' } }],
  drones: [],
};
data.solo.squads['t-guard'] = {
  name: 'Guarded', faction: 'UN', points: 0,
  mechs: [{ name: 'Rifle', loadout: { torso: '539', chasis: '099', rightHand: '541', pilot: 'LPA-23-2' } }],
  drones: [{ cardId: '160' }, { cardId: '165' }],
};
const at = (x, c, r, f) => { x.col = c * 3; x.row = r * 3; if (f !== undefined) x.facing = f; };
const scenario = { ...data.solo.scenarios[0], id: 't-flight', map: 'none', mission: 'none', seats: { s1: 't-hail', s2: 't-guard' } };
const t = botTable(M, data, scenario, { seed: 5, policies: { s1: AI.missilePolicy, s2: AI.eagerPolicy } });
await t.run({ until: (st) => M.SU.normaliseSetup(st.setup)?.stage === 'done' && st.round.phase === 2 });
const s = t.state;
const U = { Hail: s.tokens.find((x) => x.label === 'Hail'), Rifle: s.tokens.find((x) => x.label === 'Rifle'), CIWS: s.tokens.find((x) => x.cardId === '160'), Raven: s.tokens.find((x) => x.cardId === '165') };
at(U.Hail, 5, 1, 2); at(U.Rifle, 5, 8, 0); at(U.Raven, 2, 6, 0); at(U.CIWS, 5, 11, 0);
for (const x of s.tokens) { x.stance = 'offensive'; x.timing = 'firing'; }
U.Hail.timing = 'projectile';
s.script.revealed = ['s1', 's2'];
s.script.acted = [U.Rifle.uid, U.CIWS.uid, U.Raven.uid];
s.script.opp = null;
M.G.opportunity(data, s);
const mine = (st) => st.tokens.filter((x) => x.kind === 'projectile' && x.side === 's1' && x.deployed !== false);
await t.run({ maxSteps: 300, until: (st) => mine(st).length > 1 });
// Both Razors set down two Grids from the Rifle and three from the Raven, out of the CIWS's Range.
for (const p of mine(s)) at(p, 5, 6);
await t.run({ maxSteps: 400, until: () => { const d = t.drivers.s1.pending(); return !!d && mine(s).some((p) => p.uid === d.unit); } });
const d = t.drivers.s1.pending();
const view = M.SEAT.viewOf(data, s, 's1');
const at_ = (uid) => d?.options.find((o) => o.facts?.targetUid === uid);
const guarded = at_(U.Rifle.uid);
const open = at_(U.Raven.uid);
check('THE STAGE: the Delay Phase asks a Razor where it flies: at the Rifle through the CIWS\'s Interception (three tries), or at the Raven through none',
  [M.TY.PHASES[s.round.phase], mine(s).length, guarded?.facts?.intercepts, guarded?.facts?.interceptTries, !!open, open?.facts?.intercepts ?? 0],
  ['Delay', 2, 1, [3], true, 0]);
check('THE DRIVER READS THE FLIGHT AS A LAUNCH: at the Rifle it almost never comes through, and would cost the CIWS a Token or more; at the Raven nothing stands in its way',
  [guarded?.survive?.() < 0.05, guarded?.drain?.()?.spent > 1, guarded?.drain?.()?.stop > 0.5, open?.survive === undefined], [true, true, true, true]);

const target = (skills, tune, vv = view) => { const c = AI.makeTactician(skills, tune).choose(d, vv, new AI.Rng('flight')); return d.options.find((o) => o.id === c.option)?.facts?.targetUid; };
check('WITHOUT `flightOdds` (0) it flies at the Rifle, into the Interception', target({}, { flightOdds: 0 }), U.Rifle.uid);
check('WITH `flightOdds` 1 it takes the direct hit on the Raven', target({}, { flightOdds: 1 }), U.Raven.uid);
check('WITH `icptBurn` 1 beside it, the other Razor still to fly, it burns the CIWS\'s Tokens on the Rifle',
  target({}, { flightOdds: 1, icptBurn: 1 }), U.Rifle.uid);
{
  // With no Missile to come after it, the Tokens it would cost the CIWS are worth nothing to the squad.
  const other = mine(s).find((p) => p.uid !== d.unit);
  const alone = { ...view, units: view.units.filter((u) => u.uid !== other.uid) };
  check('and with no other Missile to come, the direct hit again', target({}, { flightOdds: 1, icptBurn: 1 }, alone), U.Raven.uid);
}
check('AS IT SHIPS (2026-10-15): flightOdds 1 for every level, the Brawler with the Ace; icptBurn 0',
  [AI.TACTICIAN.flightOdds, AI.TACTICIAN.icptBurn, AI.BRAWLER_WEIGHTS.flightOdds ?? AI.TACTICIAN.flightOdds], [1, 0, 1]);
check('and as it ships, it takes the direct hit on the Raven', target({}, {}), U.Raven.uid);
t.close();

console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
