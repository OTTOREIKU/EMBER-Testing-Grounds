// A BLADE CARRIED TO ITS TARGET (AI-OPPONENT-PLAN.md, "THE MORNING OF
// 2026-10-05"; the Tactician's weights `charge` and `blade`). A Mech's turn a
// round on was read from the Grid a plan left it in: a gun four Grids off
// counted, a blade only beside the enemy, while the exposure read every enemy's
// turn with its step first. So a melee Mech saw every danger in crossing the
// open and none of its own blows. With `charge` the blow its Maneuver (or its
// Sprint) would carry its blade to counts a round on; with `blade` the walk to
// a fight ends at the reach of its strongest attacks, not its longest.
import { botTable, loadEngine } from './_engine.mjs';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}\n       got  ${g}`); }
};

console.log('A blade carried to its target\n');

const { M, data } = await loadEngine('seatcharge', ["export * as SEAT from '../src/seat';", "export * as AI from '../src/ai/index';"]);
const AI = M.AI;
// RDL: a Volcano on the Swift Steed (Sprint 5) with a Cleaver (Chop) and a
// Buckler and Sabre (Slash): blades only. UN: a Cat with a Tactical Rifle.
data.solo.squads['t-blade'] = { name: 'Blade', faction: 'RDL', points: 0, mechs: [{ name: 'Blade', loadout: { torso: '016', chasis: '022', rightHand: '036', leftHand: '062', pilot: 'FPA-04-2' } }], drones: [] };
data.solo.squads['t-cat'] = { name: 'Cat', faction: 'UN', points: 0, mechs: [{ name: 'Cat', loadout: { torso: '539', chasis: '099', leftHand: '541', pilot: 'LPA-23-2' } }], drones: [] };
const scenario = { ...data.solo.scenarios[0], id: 't-charge', map: 'none', seats: { s1: 't-blade', s2: 't-cat' } };

// Round 2's Action Phase, the Blade's Melee Opportunity open, the Cat `gap`
// Grids south of it, its turn behind it.
const staged = async (gap) => {
  const t = botTable(M, data, scenario, { seed: 4, policies: AI.eagerPolicy });
  await t.run({ until: (st) => M.SU.normaliseSetup(st.setup)?.stage === 'done' && st.round.phase === 2 });
  const s = t.state;
  const U = Object.fromEntries(s.tokens.map((x) => [x.label, x]));
  const at = (x, c, r, f) => { x.col = c * 3; x.row = r * 3; x.facing = f; };
  at(U.Blade, 5, 2, 2); at(U.Cat, 5, 2 + gap, 0);
  for (const x of s.tokens) x.statuses = (x.statuses ?? []).filter((y) => y !== 'camouflage');
  s.round.n = 2; s.script.stage = '2:2'; s.script.revealed = ['s1', 's2']; s.script.passed = [];
  U.Blade.timing = 'melee'; U.Cat.timing = 'firing';
  s.script.acted = [U.Cat.uid];
  s.script.opp = null;
  M.G.opportunity(data, s);
  const d = t.drivers.s1.pending();
  return { t, d, view: M.SEAT.viewOf(data, s, 's1'), U };
};
const plans = (x, weights) => AI.weighed(x.d, x.view, {}, weights);
const best = (rows, f) => Math.max(0, ...rows.filter(f).map((r) => r.next));

{
  // Four Grids off: its Maneuver of two brings it within two of the Cat this
  // turn, and its Maneuver next turn beside it.
  const far = await staged(4);
  const apart = (r) => Math.max(Math.abs(r.at.col - 5), Math.abs(r.at.row - 6));
  const off = plans(far, { charge: 0 });
  const on = plans(far, { charge: 1 });
  check('FOUR GRIDS FROM THE CAT, nothing to strike this turn: without `charge` no plan that leaves the Blade off the Cat\'s flank counts a blow a round on',
    [far.d?.kind, best(off, (r) => apart(r) > 1)], ['opp.act', 0]);
  // (Three Grids off: a Maneuver of two and a blade. Two off, its Smoke
  // Grenade has something to do this turn, and that Grid is asked as a deed.)
  check('with it, a plan that leaves it a Maneuver and a blade from the Cat counts the blow its Maneuver would carry there',
    best(on, (r) => apart(r) === 3) > 0, true);
  check('and none of what the plans do now changes', off.map((r) => r.now).sort(), on.map((r) => r.now).sort());
  far.t.close();
}
{
  // Six Grids off a Maneuver leaves it four away, and a Sprint next turn would
  // spend the Ticks its blades need (it is offered a Link for a Tick, and the
  // end): the engine finds no blow, and none is counted.
  const out = await staged(6);
  check('SIX GRIDS OFF, with no Ticks left after a Sprint for a blow, nothing is counted even with `charge`',
    best(plans(out, { charge: 1 }), () => true), 0);
  out.t.close();
}
{
  // The blades outweigh the guns it does not carry: the walk to a fight ends a
  // Grid off the enemy with `blade`; at 0 it ends at its longest reach, which
  // is the Smoke Grenade's two (a reach with no dice).
  const near = await staged(4);
  const me = near.view.units.find((u) => u.label === 'Blade');
  check('THE BLADE\'S WEAPONS as the seat reads them: blades with dice, a Smoke Grenade with none',
    me.weapons.filter((w) => w.type === 'Melee').every((w) => w.red + w.yellow > 0) && me.weapons.some((w) => w.type === 'Projectile' && w.red + w.yellow === 0), true);
  near.t.close();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
