// THE BRAWLER'S `safer` (OTTO, 2026-10-05: "aggressive with them but playing
// smart (out of range, using cover, not walking into the direct line of
// multiple enemy units)").
//
// A Mech that could attack from where it stands, in the lines of fire of two
// enemies, steps first to a Grid only one of them could answer it in, where an
// attack worth most of this one is still on offer; the copy attacks from where
// it stands. Staged on the real engine: the Brawler's rifle Mech at F8, a rifle
// two Grids south (in its arc) and a Buckler two Grids east (a Melee one Grid
// after a one Grid step reaches it there, not one Grid further west).
import { botTable, loadEngine } from './_engine.mjs';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}\n       got  ${g}`); }
};

console.log('The Brawler steps out of two lines of fire before it shoots\n');

const { M, data } = await loadEngine('brawlersafer', ["export * as SEAT from '../src/seat';", "export * as AI from '../src/ai/index';", "export * as TURN from '../src/turn';"]);
const AI = M.AI;

data.solo.squads['t-shooter'] = {
  name: 'Shooters', faction: 'UN', points: 0,
  mechs: [{ name: 'Shooter', loadout: { torso: '539', chasis: '099', rightHand: '541', pilot: 'LPA-23-2' } }],
  drones: [],
};
data.solo.squads['t-pair'] = {
  name: 'Pair', faction: 'GOF', points: 0,
  mechs: [
    { name: 'Rifle', loadout: { torso: '174', chasis: '179', rightHand: '541', pilot: 'ZPA-43' } },
    { name: 'Buckler', loadout: { torso: '174', chasis: '179', leftHand: 'ZHLA-101', pilot: 'ZPA-43' } },
  ],
  drones: [],
};
const scenario = { ...data.solo.scenarios[0], id: 't-brawlersafer', map: 'none', seats: { s1: 't-shooter', s2: 't-pair' } };

// The Shooter's first answer of its turn, and where it then stands.
async function shooterTurn(policy) {
  const seeded = new AI.Rng('7:brawlersafer');
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
  at(U.Shooter, 6, 7, 2); at(U.Rifle, 5, 9, 0); at(U.Buckler, 8, 7, 3);
  for (const x of t.state.tokens) if (x.kind === 'mech') x.stance = 'offensive';
  U.Shooter.timing = 'firing';
  t.state.script.acted = t.state.tokens.filter((x) => x.kind === 'mech' && x.uid !== U.Shooter.uid).map((x) => x.uid);
  t.state.script.opp = null;
  M.G.opportunity(data, t.state);
  let first = null;
  await t.run({
    until: () => first !== null,
    onStep: (seat, step) => {
      if (seat === 's1' && step.decision.kind === 'opp.act' && first === null) {
        const e = t.drivers.s1.log.at(-1);
        first = { reason: e?.reason ?? '', tags: step.option?.tags ?? [] };
      }
    },
    maxSteps: 50,
  });
  const out = { ...first, col: Math.floor(U.Shooter.col / 3), row: Math.floor(U.Shooter.row / 3), refused: t.refused.map((x) => `${x.kind}: ${x.why}`) };
  t.close();
  return out;
}

{
  const copy = await shooterTurn(AI.brawlerPolicy);
  check('THE COPY attacks from where it stands, in the lines of fire of both', [copy.reason, copy.tags[0], copy.col, copy.refused], ['attack_result_value', 'attack', 6, []]);
}
{
  const safer = await shooterTurn(AI.makeBrawler({ ...AI.BRAWLER_COPY, safer: true }, 'brawler:safer'));
  check('WITH `safer` it steps first into the Grid only the rifle could answer it in (one Grid west), to attack from there',
    [safer.reason, safer.tags.includes('maneuver') || safer.tags[0] === 'move', safer.col, safer.refused], ['safer_attack', true, 5, []]);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
