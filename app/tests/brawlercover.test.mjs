// THE BRAWLER'S `cover` (OTTO, 2026-10-05: "aggressive with them but playing
// smart (out of range, using cover, not walking into the direct line of
// multiple enemy units)").
//
// A unit that cannot attack this turn still walks at the enemy, but of the
// Grids within one of the nearest it could reach, it takes the one fewest
// enemies could attack it in; the copy takes the nearest. Staged on the real
// engine: the Brawler's Walker (a Buckler, no gun) at J3 on its Movement
// Opportunity, the enemy Rifle at F12 and the enemy Blade at J9.
import { botTable, loadEngine } from './_engine.mjs';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}\n       got  ${g}`); }
};

console.log('The Brawler walks up under cover\n');

const { M, data } = await loadEngine('brawlercover', ["export * as SEAT from '../src/seat';", "export * as AI from '../src/ai/index';", "export * as TURN from '../src/turn';"]);
const AI = M.AI;

data.solo.squads['t-walker'] = {
  name: 'Walker', faction: 'GOF', points: 0,
  mechs: [{ name: 'Walker', loadout: { torso: '174', chasis: '179', leftHand: 'ZHLA-101', pilot: 'ZPA-43' } }],
  drones: [],
};
data.solo.squads['t-pair'] = {
  name: 'Pair', faction: 'UN', points: 0,
  mechs: [
    { name: 'Rifle', loadout: { torso: '539', chasis: '099', rightHand: '541', pilot: 'LPA-23-2' } },
    { name: 'Blade', loadout: { torso: '174', chasis: '179', leftHand: 'ZHLA-101', pilot: 'ZPA-43' } },
  ],
  drones: [],
};
const scenario = { ...data.solo.scenarios[0], id: 't-brawlercover', map: 'none', seats: { s1: 't-walker', s2: 't-pair' } };

// The Walker's first answer at its Movement Opportunity, and where it then stands.
async function walkerTurn(policy, start) {
  const seeded = new AI.Rng('7:brawlercover');
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
  at(U.Walker, start[0], start[1], 2); at(U.Rifle, 5, 11, 0); at(U.Blade, 9, 8, 0);
  for (const x of t.state.tokens) if (x.kind === 'mech') x.stance = 'offensive';
  U.Walker.timing = 'movement';
  t.state.script.acted = t.state.tokens.filter((x) => x.kind === 'mech' && x.uid !== U.Walker.uid).map((x) => x.uid);
  t.state.script.opp = null;
  M.G.opportunity(data, t.state);
  let first = null;
  await t.run({
    until: () => first !== null,
    onStep: (seat, step) => {
      if (seat === 's1' && step.decision.kind === 'opp.act' && first === null) {
        const e = t.drivers.s1.log.at(-1);
        first = { why: e?.why ?? '', tags: step.option?.tags ?? [] };
      }
    },
    maxSteps: 50,
  });
  const g = (x) => `${String.fromCharCode(65 + Math.floor(x.col / 3))}${Math.floor(x.row / 3) + 1}`;
  const out = { ...first, at: g(U.Walker), refused: t.refused.map((x) => `${x.kind}: ${x.why}`) };
  t.close();
  return out;
}

const cover = AI.makeBrawler({ ...AI.BRAWLER_COPY, cover: true }, 'brawler:cover');
{
  const copy = await walkerTurn(AI.brawlerPolicy, [9, 2]);
  check('THE COPY Sprints to J7, two Grids from the Blade, which could step into Contact with it there',
    [copy.tags[0], copy.at, copy.why, copy.refused], ['move', 'J7', 'closing on the nearest enemy', []]);
  const covered = await walkerTurn(cover, [9, 2]);
  check('WITH `cover` it stops one Grid short at J6, out of the Blade\'s reach, and says so',
    [covered.tags[0], covered.at, covered.why, covered.refused], ['move', 'J6', 'closing on the enemy, out of the line of fire', []]);
}
{
  const copy = await walkerTurn(AI.brawlerPolicy, [8, 1]);
  const covered = await walkerTurn(cover, [8, 1]);
  check('where no Grid near the nearest is safer, it walks as the copy does', [covered.at, covered.why], [copy.at, copy.why]);
}
check('the copy has the habit off', AI.BRAWLER_COPY.cover, false);

console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
