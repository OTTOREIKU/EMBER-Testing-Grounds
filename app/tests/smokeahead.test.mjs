// SMOKE AHEAD OF THE SQUAD (`smokeAhead`, the Tactician; OTTO, 2026-10-05:
// "Would a unit smoke out an open area so that they or a friendly unit can move
// safely through it?").
//
// Smoke where the squad stands (`smokeSquad`) kept a melee squad where it stood
// (community.test's Key Facility game: no attack). With `smokeAhead` the Screens
// are read where the Allies still to act this round are about to stand: each
// one's walk at the nearest enemy. Staged on the real engine: the Smoker (a
// Volcano core, 016) at F4 on its Projectile Opportunity, the Buddy (a blade,
// no gun) at F2 still to act on the Movement Timing, two enemy Rifles at F11
// and I11. The Smoker steps to F5, shoots, and throws its Grenade at its own
// feet (`screen`); the Screens are then the question.
import { botTable, loadEngine } from './_engine.mjs';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}\n       got  ${g}`); }
};

console.log('Smoke ahead of the squad\n');

const { M, data } = await loadEngine('smokeahead', ["export * as SEAT from '../src/seat';", "export * as AI from '../src/ai/index';", "export * as TURN from '../src/turn';"]);
const AI = M.AI;
data.solo.squads['t-smokers'] = {
  name: 'Smokers', faction: 'RDL', points: 0,
  mechs: [
    { name: 'Smoker', loadout: { torso: '016', chasis: '020', rightHand: '033', pilot: 'FPA-63' } },
    { name: 'Buddy', loadout: { torso: '014', chasis: '020', leftHand: '062', pilot: 'FPA-04-2' } },
  ],
  drones: [],
};
data.solo.squads['t-gunners'] = {
  name: 'Gunners', faction: 'UN', points: 0,
  mechs: [
    { name: 'Gunner A', loadout: { torso: '174', chasis: '179', rightHand: '541', pilot: 'ZPA-43' } },
    { name: 'Gunner B', loadout: { torso: '174', chasis: '179', rightHand: '541', pilot: 'ZPA-43' } },
  ],
  drones: [],
};
const scenario = { ...data.solo.scenarios[0], id: 't-smokeahead', map: 'none', seats: { s1: 't-smokers', s2: 't-gunners' } };
const grid = (c, r) => `${String.fromCharCode(65 + c)}${r + 1}`;

// The Smoker's Opportunity to its end (the Screens its Grenade puts down, and the answer that put them).
async function smokerTurn(policy) {
  const seeded = new AI.Rng('7:smokeahead');
  const others = { name: 'others', choose: (d, v, rng) => {
    const end = d.kind === 'opp.act' ? d.options.find((o) => o.tags.includes('end')) : null;
    return end ? { option: end.id, why: 'ends' } : AI.eagerPolicy.choose(d, v, rng);
  } };
  const t = botTable(M, data, scenario, {
    seed: 7,
    dice: (pool) => Object.entries(pool).flatMap(([color, n]) => Array.from({ length: n }, () => ({ color, face: seeded.int(data.dice.dice[color].sides) }))),
    policies: { s1: policy, s2: others },
  });
  await t.run({ until: (s) => M.SU.normaliseSetup(s.setup)?.stage === 'done' && s.round.phase === 2 });
  const U = Object.fromEntries(t.state.tokens.map((x) => [x.label, x]));
  const at = (x, c, r, f) => { x.col = c * 3; x.row = r * 3; if (f !== undefined) x.facing = f; };
  at(U.Smoker, 5, 3, 2); at(U.Buddy, 5, 1, 2); at(U['Gunner A'], 5, 10, 0); at(U['Gunner B'], 8, 10, 0);
  for (const x of t.state.tokens) if (x.kind === 'mech') x.stance = 'offensive';
  U.Smoker.timing = 'projectile';
  U.Buddy.timing = 'movement';
  t.state.script.acted = [U['Gunner A'].uid, U['Gunner B'].uid];
  t.state.script.opp = null;
  M.G.opportunity(data, t.state);
  const blast = [];
  let threw = false;
  await t.run({
    until: (s) => threw && !s.tokens.some((x) => x.kind === 'projectile'),
    onStep: (seat, step) => {
      if (seat !== 's1') return;
      if (step.decision.kind === 'opp.act' && step.option?.tags.includes('smoke')) threw = true;
      if (step.decision.kind === 'blast.resolve') { const e = t.drivers.s1.log.at(-1); blast.push({ reason: e?.reason ?? '', label: step.option?.label ?? '' }); }
    },
    maxSteps: 120,
  });
  const out = { smoke: (t.state.smoke ?? []).filter((x) => x.side === 's1').map((x) => grid(x.col, x.row)).sort(), blast, refused: t.refused.map((x) => `${x.kind}: ${x.why}`) };
  t.close();
  return out;
}

{
  const plain = await smokerTurn(AI.tacticianPolicy);
  check('AS SHIPPED the Grenade thrown at its own feet puts down the safe answer, one Screen in F5, which the End Phase takes',
    [plain.smoke, plain.refused], [['F5'], []]);
  const ahead = await smokerTurn(AI.makeTactician({ smokeAhead: true }));
  check('WITH `smokeAhead` the same throw puts down three Connected Screens running from F5 toward the Rifles, down the Buddy\'s walk, and says why',
    [ahead.smoke, ahead.blast.map((b) => b.reason), ahead.refused], [['F5', 'F6', 'F7'], ['smoke_ahead'], []]);
}
check('the shipped Ace has it off (built, to be measured)', AI.SKILLS.smokeAhead, false);

console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
