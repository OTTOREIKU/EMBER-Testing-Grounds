// A JAMMER IS WORTH ITS JAMS TO COME (`jamKeep`, the Tactician's weight; the W5
// census, 2026-10-05: the computer's Drones jammed in sight of two or more
// enemies three times in four).
//
// A Drone whose own Action is an Electronic Attack on an enemy (the ADK60S Raven
// Interference Type, 166: Fire Control Interference at Range 4) counts its
// material worth 1 + `jamKeep` x the rounds left over, so the squad keeps it
// where fewer enemies could reach it and the other squad goes for it. A Drone
// with no such Action (the ADK60R Raven Scout Type, 164) is worth its points
// alone either way. Read off a real table at the start of round 1 of 5.
import { botTable, loadEngine } from './_engine.mjs';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}\n       got  ${g}`); }
};

console.log('A jammer is worth its jams to come\n');

const { M, data } = await loadEngine('jamkeep', ["export * as SEAT from '../src/seat';", "export * as AI from '../src/ai/index';"]);
const AI = M.AI;
const rifle = { torso: '539', chasis: '099', rightHand: '541', pilot: 'LPA-23-2' };
data.solo.squads['t-ravens'] = { name: 'Ravens', faction: 'UN', points: 0, mechs: [{ name: 'Lead', loadout: rifle }], drones: [{ cardId: '166' }, { cardId: '164' }] };
data.solo.squads['t-other'] = { name: 'Other', faction: 'UN', points: 0, mechs: [{ name: 'Far', loadout: rifle }], drones: [] };
const scenario = { ...data.solo.scenarios[0], id: 't-jamkeep', map: 'none', seats: { s1: 't-ravens', s2: 't-other' } };
const t = botTable(M, data, scenario, { seed: 7, policies: AI.eagerPolicy });
await t.run({ until: (s) => M.SU.normaliseSetup(s.setup)?.stage === 'done' && s.round.phase === 2 });
const view = M.SEAT.viewOf(data, t.state, 's1');
t.close();
const unit = (cardId) => view.units.find((u) => u.cardId === cardId);
const worth = (u, weights) => AI.unitWorth(u, view, { ...AI.TACTICIAN, ...weights });
const left = view.roundLimit - view.round + 1;
const near = (a, b) => Math.abs(a - b) < 1e-9;

check('the table is at round 1 of 5: five rounds left, this one too', [view.round, view.roundLimit, left], [1, 5, 5]);
const raven = unit('166');
const scout = unit('164');
check('AS SHIPPED (`jamKeep` 0) each Drone is worth its points alone', AI.TACTICIAN.jamKeep, 0);
check('WITH `jamKeep` 0.5 the Raven Interference counts its material 1 + 0.5 x 5 over',
  near(worth(raven, { jamKeep: 0.5 }), worth(raven, { jamKeep: 0 }) * (1 + 0.5 * left)), true);
check('and the Raven Scout, which jams nothing, is worth the same either way',
  near(worth(scout, { jamKeep: 0.5 }), worth(scout, { jamKeep: 0 })), true);
const mech = view.units.find((u) => u.kind === 'mech');
check('a Mech is never counted as a jammer', near(worth(mech, { jamKeep: 0.5 }), worth(mech, { jamKeep: 0 })), true);

console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
