// THE STEPS THAT BRING AN ATTACK TO BEAR, as the attack would be built
// (AI-OPPONENT-PLAN.md, M12). The seam's `reach:<uid>` look (owed.ts
// `reaching`) offers the Maneuver's moves after which a unit could attack one
// enemy; it is how the Tactician reads what an enemy could do to a unit by
// stepping out first. It measured each attack's Range as PRINTED, so a step
// from which only a [Two-Handed] rider's +2 reached was passed over, and an
// enemy that would step out and shoot from there counted as no danger (a
// traced game, 2026-10-03: a Missile Artillery stood in a VIP's Tactical
// Rifle's reach at "cost 0.00" and was shot every round). It reads the Range
// as the attack would be built (turn.ts attackActionBuilt) now.
import { loadEngine, tableAtRoundOne } from './_engine.mjs';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}\n       got  ${g}`); }
};

console.log('The steps that bring an attack to bear\n');

const { M, data } = await loadEngine('seatreach', ["export * as SEAT from '../src/seat';", "export * as TURN from '../src/turn';"]);
const { owed, newMind } = M.SEAT;
const clone = (x) => JSON.parse(JSON.stringify(x));

// The UN VIP Command of the scripted Missile Umbrella game: an R9B Tactical
// Rifle (Silent Single Shot, Range 8, [Two-Handed]) beside an S9 Meteor
// Shield, which is Freehand: held in two hands the rifle reaches 10. And the
// same Mech with a Shield that is not Freehand (the S100, 142).
const sniper = (left) => ({ name: 'Sniper', loadout: { torso: '091', chasis: '101', leftHand: left, rightHand: '127', backpack: '081', pilot: 'LPA-19' } });
data.solo.squads['r-two'] = { name: 'Two hands', faction: 'UN', points: 0, mechs: [sniper('540')], drones: [] };
data.solo.squads['r-one'] = { name: 'One hand', faction: 'UN', points: 0, mechs: [sniper('142')], drones: [] };
data.solo.squads['r-mark'] = { name: 'Mark', faction: 'RDL', points: 0, mechs: [data.solo.squads['raid-rdl'].mechs[0]], drones: [] };
const base = (squad) => {
  M.L.setLocalSeat(null);
  const t = tableAtRoundOne(M, data, { ...data.solo.scenarios[0], id: `r-${squad}`, seats: { s1: squad, s2: 'r-mark' } });
  if (t.refused.length) throw new Error(t.refused.join('; '));
  return t.state;
};
// The Sniper at B3, facing south, on its Firing Opportunity in round 1; the
// Mark eleven Grids off at D12 (two columns, nine rows): out of the rifle's
// Range from where it stands, and in it after one step south held two-handed.
const stage = (squad) => {
  const s = clone(base(squad));
  s.map = 'none';
  const sn = s.tokens.find((x) => x.side === 's1' && x.kind === 'mech');
  const mark = s.tokens.find((x) => x.side === 's2' && x.kind === 'mech');
  sn.col = 1 * 3; sn.row = 2 * 3; sn.facing = 2;
  mark.col = 3 * 3; mark.row = 11 * 3; mark.facing = 0;
  s.round.phase = 2; s.script.stage = '1:2';
  for (const x of s.tokens) if (x.kind === 'mech') x.timing = 'firing';
  s.script.revealed = ['s1', 's2'];
  s.script.acted = [mark.uid];
  s.script.opp = null;
  M.G.opportunity(data, s);
  M.L.setLocalSeat('s1');
  return { s, sn, mark };
};

{
  const { s, sn, mark } = stage('r-two');
  const now = owed(data, s, 's1', newMind(), { only: [`strike:${mark.uid}`] });
  const steps = owed(data, s, 's1', newMind(), { only: [`reach:${mark.uid}`] })?.options ?? [];
  // Each step made on a copy of the table, and the Sniper asked there what it could do to the Mark.
  const shots = steps.map((o) => {
    const after = M.G.tableAfter(data, s, o.commands);
    return after ? (owed(data, after, 's1', newMind(), { only: [`strike:${mark.uid}`] })?.options ?? []).filter((x) => x.facts?.targetUid === mark.uid).length : 0;
  });
  const built = M.TURN.attackActionBuilt(data, s, sn, '127_A');
  check('HELD IN TWO HANDS, THE RIFLE REACHES 10: from B3 it cannot shoot the Mark at D12 (11 Grids), and the reach look offers the step from which it can, each with the shot behind it',
    [built?.range, (now?.options ?? []).filter((x) => x.facts?.targetUid === mark.uid).length, steps.length > 0, shots.every((n) => n > 0)], [10, 0, true, true]);
}
{
  const { s, mark } = stage('r-one');
  const steps = owed(data, s, 's1', newMind(), { only: [`reach:${mark.uid}`] })?.options ?? [];
  check('WITH ONE HAND ON THE RIFLE (the S100 is no Freehand) it reaches 8, and no single step brings it to bear', steps.length, 0);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
