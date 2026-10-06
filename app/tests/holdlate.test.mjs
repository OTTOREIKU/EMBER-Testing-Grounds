// A DIAL FOR A TURN WITH NOTHING TO DO NOW (`holdLate`; OTTO, 2026-10-05,
// watching two computers: "if both CPU are not in range of eachother they seem
// to default setting their timings to melee").
//
// Of dials whose plans are worth the same, the Ace took the earliest Timing, so
// a Mech holding a line set Melee round after round, where its rifle could not
// answer anyone who walked up. With the skill, a plan that does nothing now is
// held for the latest Timing of its STRONGEST weapons (within HOLD_SHARE of the
// best by dice): a rifle Mech waits for Firing, and a Mech whose blade is worth
// far more than its gun stays on Melee (the community melee squad, which held
// on Firing and never struck with the first version). Staged on the real
// engine: two Mechs in the zone Bravo of the Alley's Frontal Breakthrough, an
// Immobilized Token on each so that every Timing's plan is the same (hold), the
// enemy far off; the dials of round 1.
import { botTable, loadEngine } from './_engine.mjs';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}\n       got  ${g}`); }
};

console.log('A dial for a turn with nothing to do now\n');

const { M, data } = await loadEngine('holdlate', ["export * as SEAT from '../src/seat';", "export * as AI from '../src/ai/index';", "export * as TURN from '../src/turn';"]);
const AI = M.AI;
const sq = (name, faction, mechs) => ({ name, faction, points: 0, mechs, drones: [] });
data.solo.squads['t-hold'] = sq('Hold', 'UN', [
  { name: 'Rifle', loadout: { torso: '539', chasis: '099', rightHand: '541', pilot: 'LPA-23-2' } },
  { name: 'Blade', loadout: { torso: '016', chasis: '022', leftHand: '062', rightHand: '036', pilot: 'FPA-03' } },
]);
data.solo.squads['t-far'] = sq('Far', 'UN', [
  { name: 'Far A', loadout: { torso: '539', chasis: '099', rightHand: '541', pilot: 'LPA-23-2' } },
]);
const scenario = { ...data.solo.scenarios[0], id: 't-holdlate', map: 'none', seats: { s1: 't-hold', s2: 't-far' } };

// Round 1's dial for each of the two, as the policy sets it.
async function dials(policy) {
  const seeded = new AI.Rng('7:holdlate');
  const t = botTable(M, data, scenario, {
    seed: 7,
    dice: (pool) => Object.entries(pool).flatMap(([color, n]) => Array.from({ length: n }, () => ({ color, face: seeded.int(data.dice.dice[color].sides) }))),
    policies: { s1: policy, s2: AI.eagerPolicy },
  });
  await t.run({ until: (s) => M.SU.normaliseSetup(s.setup)?.stage === 'done' });
  const U = Object.fromEntries(t.state.tokens.map((x) => [x.label, x]));
  const at = (x, c, r, f) => { x.col = c * 3; x.row = r * 3; if (f !== undefined) x.facing = f; };
  at(U.Rifle, 1, 5, 1); at(U.Blade, 2, 6, 1); at(U['Far A'], 10, 11, 0);
  for (const x of [U.Rifle, U.Blade]) x.statuses = [...(x.statuses ?? []), 'immobilized'];
  const got = {};
  await t.run({
    until: () => Object.keys(got).length >= 2 || t.state.round.phase > 2,
    onStep: (seat, step) => {
      if (seat === 's1' && step.decision.kind === 'planning.dial') {
        const u = t.state.tokens.find((x) => x.uid === step.decision.unit);
        const e = t.drivers.s1.log.at(-1);
        got[u.label] = { timing: step.option?.tags.find((x) => x.startsWith('timing:'))?.slice(7), holds: String(e?.why ?? '').startsWith('it opens with holding where it is') };
      }
    },
    maxSteps: 400,
  });
  const out = { got, refused: t.refused.map((x) => `${x.kind}: ${x.why}`) };
  t.close();
  return out;
}

{
  const off = await dials(AI.makeTactician({ holdLate: false }));
  check('WITHOUT THE SKILL both hold, and both are set to Melee, the earliest Timing (OTTO\'s report)',
    [off.got.Rifle, off.got.Blade, off.refused], [{ timing: 'melee', holds: true }, { timing: 'melee', holds: true }, []]);
  const on = await dials(AI.tacticianPolicy);
  check('THE ACE AS SHIPPED holds the Rifle for Firing, where its rifle answers whoever walks up',
    [on.got.Rifle, on.refused], [{ timing: 'firing', holds: true }, []]);
  check('and leaves the Blade on Melee: its gun is no reason to wait, its blade worth far more',
    on.got.Blade, { timing: 'melee', holds: true });
}
check('the skill is on as shipped (adopted 2026-10-05, night)', AI.SKILLS.holdLate, true);

console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
