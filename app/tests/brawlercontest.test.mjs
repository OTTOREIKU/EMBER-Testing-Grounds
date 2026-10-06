// THE BRAWLER'S `contest` (OTTO, 2026-10-05: the Brawler "should want to fight
// the opponents and cause them to have to reposition or have to back off of
// objectives").
//
// An attack on an enemy standing in a zone the Main Task scores (or carrying a
// Black Box) is worth more, and with nothing to attack it walks at the nearest
// such enemy rather than the nearest enemy of all. Staged on the real engine on
// the Alley's Frontal Breakthrough with no terrain: the Brawler's Rifle, and two
// of the same enemy Mech, the Holder in the scoring zone Bravo and the Other
// outside any zone.
import { botTable, loadEngine } from './_engine.mjs';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}\n       got  ${g}`); }
};

console.log('The Brawler fights for what the mission pays\n');

const { M, data } = await loadEngine('brawlercontest', ["export * as SEAT from '../src/seat';", "export * as AI from '../src/ai/index';", "export * as TURN from '../src/turn';"]);
const AI = M.AI;
const rifle = { torso: '539', chasis: '099', rightHand: '541', pilot: 'LPA-23-2' };
data.solo.squads['t-brawl'] = { name: 'Brawl', faction: 'UN', points: 0, mechs: [{ name: 'Shooter', loadout: rifle }], drones: [] };
data.solo.squads['t-pair'] = { name: 'Pair', faction: 'UN', points: 0, mechs: [{ name: 'Holder', loadout: rifle }, { name: 'Other', loadout: rifle }], drones: [] };
const scenario = { ...data.solo.scenarios[0], id: 't-brawlercontest', map: 'none', seats: { s1: 't-brawl', s2: 't-pair' } };
const g = (c, r) => `${String.fromCharCode(65 + c)}${r + 1}`;

// The Shooter's first answer on the Timing given, and where it then stands.
async function turn(policy, pos, timing) {
  const seeded = new AI.Rng('7:brawlercontest');
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
  at(U.Shooter, ...pos.me, 2); at(U.Holder, ...pos.holder, 0); at(U.Other, ...pos.other, 0);
  for (const x of t.state.tokens) if (x.kind === 'mech') x.stance = 'offensive';
  U.Shooter.timing = timing;
  t.state.script.acted = [U.Holder.uid, U.Other.uid];
  t.state.script.opp = null;
  M.G.opportunity(data, t.state);
  const view = M.SEAT.viewOf(data, t.state, 's1');
  const inBravo = (u) => view.zones.some((z) => z.id === 'bravo' && z.scoring && z.cells.includes(`${Math.floor(u.col / 3)},${Math.floor(u.row / 3)}`));
  let first = null;
  await t.run({
    until: () => first !== null,
    onStep: (seat, step) => {
      if (seat === 's1' && step.decision.kind === 'opp.act' && first === null) {
        const id = step.option?.facts?.targetUid;
        first = { kind: step.option?.tags[0] ?? '', target: id === U.Holder.uid ? 'Holder' : id === U.Other.uid ? 'Other' : null };
      }
    },
    maxSteps: 60,
  });
  const out = { ...first, at: g(Math.floor(U.Shooter.col / 3), Math.floor(U.Shooter.row / 3)), holderInBravo: inBravo(U.Holder), otherInBravo: inBravo(U.Other), refused: t.refused.map((x) => `${x.kind}: ${x.why}`) };
  t.close();
  return out;
}

const contest = AI.makeBrawler({ ...AI.BRAWLER_COPY, contest: true }, 'brawler:contest');
{
  const pos = { me: [3, 2], holder: [1, 5], other: [4, 5] };
  const copy = await turn(AI.brawlerPolicy, pos, 'firing');
  check('the Holder stands in Bravo, the Other in no zone', [copy.holderInBravo, copy.otherInBravo], [true, false]);
  check('THE COPY, both in Range, steps aside to E3 to shoot the Other, the better shot', [copy.kind, copy.at, copy.refused], ['move', 'E3', []]);
  const fought = await turn(contest, pos, 'firing');
  check('WITH `contest` it shoots the Holder from where it stands, to push it off the zone', [fought.kind, fought.target, fought.at, fought.refused], ['attack', 'Holder', 'D3', []]);
}
{
  const pos = { me: [5, 0], holder: [2, 6], other: [8, 6] };
  const copy = await turn(AI.brawlerPolicy, pos, 'movement');
  check('NOTHING IN RANGE, the copy Sprints toward the Other (to I2)', [copy.kind, copy.at], ['move', 'I2']);
  const fought = await turn(contest, pos, 'movement');
  check('with `contest` it Sprints toward the Holder in Bravo instead (to D3)', [fought.kind, fought.at, fought.refused], ['move', 'D3', []]);
}
check('the copy has the habit off', AI.BRAWLER_COPY.contest, false);

console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
