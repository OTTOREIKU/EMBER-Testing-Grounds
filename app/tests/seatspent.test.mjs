// A UNIT WITH ITS LAST SHOT SPENT GOES IN (`spentClose`, M24, 2026-10-13). OTTO: "another behavior for ammo could be
// that when a unit runs out of ammo and doesn't have any other way to attack, they could focus on getting up in melee
// range of an enemy to help the rest of the team". Beside an enemy a unit Melee Locks it, and a locked enemy makes no
// Firing attack but with a weapon printing Melee Firing (4.3.5): a Mech with nothing left to shoot can still take an
// enemy's guns off its squad. Before, a unit with no attack left had no enemy to walk to at all.
//
// Staged on the real engine, on an empty board, in round 1's Action Phase: UN's Pod (its one weapon an RKG70 Missile
// Pod, one Missile Group, or none left) with its Opportunity open; RDL's Dune (two railguns) six Grids off, its turn
// this round behind it; UN's Rifle out of the way.
import { botTable, loadEngine } from './_engine.mjs';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}\n       got  ${g}`); }
};

console.log('A unit with its last shot spent goes in\n');

const { M, data } = await loadEngine('seatspent', ["export * as SEAT from '../src/seat';", "export * as AI from '../src/ai/index';"]);
const AI = M.AI;
data.solo.squads['t-pod'] = {
  name: 'Pod', faction: 'UN', points: 0,
  mechs: [
    { name: 'Pod', loadout: { torso: '539', chasis: '099', leftHand: '129', pilot: 'LPA-23-2' } },
    { name: 'Rifle', loadout: { torso: '539', chasis: '099', rightHand: '541', pilot: 'LPA-22' } },
  ],
  drones: [],
};
data.solo.squads['t-dune'] = {
  name: 'Dune', faction: 'RDL', points: 0,
  mechs: [{ name: 'Dune', loadout: { torso: '014', chasis: '020', leftHand: '032', rightHand: '033', pilot: 'FPA-63' } }],
  drones: [],
};
const at = (x, c, r, f) => { x.col = c * 3; x.row = r * 3; if (f !== undefined) x.facing = f; };
async function staged(left, spentClose) {
  const scenario = { ...data.solo.scenarios[0], id: 't-spent', map: 'none', mission: 'none', seats: { s1: 't-pod', s2: 't-dune' } };
  const t = botTable(M, data, scenario, { seed: 5, policies: AI.eagerPolicy });
  await t.run({ until: (st) => M.SU.normaliseSetup(st.setup)?.stage === 'done' && st.round.phase === 2 });
  const s = t.state;
  const U = Object.fromEntries(s.tokens.map((x) => [x.label, x]));
  at(U.Pod, 4, 10, 0); at(U.Rifle, 0, 12, 0); at(U.Dune, 4, 4, 2);
  if (left !== undefined) U.Pod.ammo = { ...U.Pod.ammo, '129_A': left };
  for (const x of s.tokens) { x.stance = 'offensive'; x.timing = 'firing'; }
  U.Pod.timing = 'movement';
  s.script.revealed = ['s1', 's2'];
  s.script.acted = [U.Rifle.uid, U.Dune.uid];
  s.script.opp = null;
  M.G.opportunity(data, s);
  const d = t.drivers.s1.pending();
  const view = M.SEAT.viewOf(data, s, 's1');
  const pod = view.units.find((u) => u.uid === U.Pod.uid);
  const rows = AI.weighed(d, view, {}, { spentClose });
  const best = rows[0];
  const gap = best ? Math.abs(best.at.col - 4) + Math.abs(best.at.row - 4) : null;
  t.close();
  return { kind: d?.kind, unit: d?.unit === U.Pod.uid, ammo: pod.weapons.find((w) => w.actionId === '129_A')?.ammo, locks: pod.locks, how: best?.how, gap };
}
{
  const off = await staged(0, 0);
  check('THE STAGE: the Pod\'s Opportunity is open, its Missile Pod spent, and it can Melee Lock (a Punch)',
    [off.kind, off.unit, off.ammo, off.locks], ['opp.act', true, 0, true]);
  const on = await staged(0, 1);
  check('AS IT SHIPS the spent Pod has no enemy to walk to: its best plan leaves it six Grids off',
    off.gap >= 6, true);
  // (At 0.3 the railguns' fire on every Grid it could reach this turn, 2.22, outweighs the walk, and it keeps to the one
  // Grid out of their sight: the planner's own judgement, for the games to weigh.)
  check('WITH `spentClose` 1 its best plan walks it in toward Dune', [on.how, on.gap < off.gap], ['move', true]);
  const loaded = await staged(undefined, 0);
  const loadedOn = await staged(undefined, 1);
  check('and nothing changes while its Missile Group is still loaded', [loaded.ammo, loadedOn.gap === loaded.gap, loadedOn.how === loaded.how], [1, true, true]);
}
check('as it ships (2026-10-13): 0 until measured', AI.TACTICIAN.spentClose, 0);

console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
