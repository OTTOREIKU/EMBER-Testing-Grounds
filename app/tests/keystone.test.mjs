// THE SQUAD'S LAST MECH (AI-OPPONENT-PLAN.md, M12: `keystone`, the
// Tactician's weight; 0 prices a Mech by its own worth alone). A Drone acts on
// a Command, and a Command comes from a Mech of its squad (4.15): with the last
// Mech gone the Drones stand idle but for what they do of themselves. So the
// last Mech of a squad that still has Drones is worth `keystone` of their worth
// besides its own: to its squad, where it stands, and to whoever destroys it.
import { loadEngine, tableAtRoundOne } from './_engine.mjs';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}\n       got  ${g}`); }
};

console.log('The squad\'s last Mech\n');

const { M, data } = await loadEngine('keystone', ["export * as SEAT from '../src/seat';", "export * as AI from '../src/ai/index';"]);
const AI = M.AI;
M.L.setLocalSeat(null);
// The copied Alley game: UN is the Wild Cat and three Drones, RDL two Mechs.
const t = tableAtRoundOne(M, data, data.solo.scenarios[0]);
if (t.refused.length) throw new Error(t.refused.join('; '));
const view = M.SEAT.viewOf(data, t.state, 's1');
const W = AI.TACTICIAN;
const on = { ...W, keystone: 1 };
const cat = view.units.find((u) => u.label === 'Wild Cat');
const drones = view.units.filter((u) => u.side === cat.side && u.kind === 'drone');
const rdl = view.units.filter((u) => u.side !== cat.side && u.kind === 'mech');
const expected = W.material * drones.filter((d) => !d.lowValue).reduce((n, d) => n + d.points, 0);
check('THE WILD CAT, UN\'S ONE MECH, IS WORTH ITS DRONES TOO WITH `keystone` 1: its own worth and the Drones\' at `material`; at 0 its own alone',
  [drones.length, Math.abs(AI.unitWorth(cat, view, on) - AI.unitWorth(cat, view, W) - expected) < 1e-9, expected > 0], [3, true, true]);
check('a Drone is worth what it was, and so is each of RDL\'s two Mechs (neither is the last, and RDL has no Drone)',
  [drones.every((d) => AI.unitWorth(d, view, on) === AI.unitWorth(d, view, W)), rdl.length, rdl.every((m) => AI.unitWorth(m, view, on) === AI.unitWorth(m, view, W))], [true, 2, true]);
// With a second UN Mech on the board the Wild Cat is no longer the last.
const two = JSON.parse(JSON.stringify(t.state));
const twin = { ...JSON.parse(JSON.stringify(two.tokens.find((x) => x.label === 'Wild Cat'))), uid: 999, label: 'Twin' };
two.tokens.push(twin);
const view2 = M.SEAT.viewOf(data, two, 's1');
const cat2 = view2.units.find((u) => u.label === 'Wild Cat');
check('WITH A SECOND MECH IN THE SQUAD, the Wild Cat is worth its own worth alone', AI.unitWorth(cat2, view2, on) === AI.unitWorth(cat2, view2, W), true);
// The Drones gone, it is worth its own again.
const bare = JSON.parse(JSON.stringify(t.state));
for (const x of bare.tokens) if (x.side === cat.side && x.kind === 'drone') x.partStates = { ...x.partStates, main: 'destroyed' };
const view3 = M.SEAT.viewOf(data, bare, 's1');
const cat3 = view3.units.find((u) => u.label === 'Wild Cat');
check('WITH ITS DRONES DESTROYED, the last Mech is worth its own worth alone', AI.unitWorth(cat3, view3, on) === AI.unitWorth(cat3, view3, W), true);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
