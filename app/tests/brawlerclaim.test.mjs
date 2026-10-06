// THE BRAWLER'S `claim` (OTTO, 2026-10-05: the Brawler should "cause them to
// have to reposition or have to back off of objectives").
//
// A zone is held only by a squad with nobody of the other in it, and a Control
// dial stays with its holder until the other squad takes the zone (5.3.2), so
// a hit on whoever holds it takes nothing away; standing in it does. With
// nothing to attack, a walk into a scoring zone not yet its squad's comes first,
// and standing in a zone its dial does not yet name for the squad it stays.
// Staged on the real engine on the Alley's Frontal Breakthrough with no terrain
// (Bravo B6, C6, B7, C7 scores): the Brawler's Walker (a blade, no gun) on its
// Movement Opportunity, the enemy Rifle far off at K12.
import { botTable, loadEngine } from './_engine.mjs';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}\n       got  ${g}`); }
};

console.log('The Brawler stands in the zones\n');

const { M, data } = await loadEngine('brawlerclaim', ["export * as SEAT from '../src/seat';", "export * as AI from '../src/ai/index';", "export * as TURN from '../src/turn';"]);
const AI = M.AI;
const rifle = { torso: '539', chasis: '099', rightHand: '541', pilot: 'LPA-23-2' };
data.solo.squads['t-walker'] = { name: 'Walker', faction: 'GOF', points: 0, mechs: [{ name: 'Walker', loadout: { torso: '174', chasis: '179', leftHand: 'ZHLA-101', pilot: 'ZPA-43' } }], drones: [] };
data.solo.squads['t-shooter'] = { name: 'Shooter', faction: 'UN', points: 0, mechs: [{ name: 'Walker', loadout: rifle }], drones: [] };
data.solo.squads['t-far'] = { name: 'Far', faction: 'UN', points: 0, mechs: [{ name: 'Rifle', loadout: rifle }], drones: [] };
const g = (c, r) => `${String.fromCharCode(65 + c)}${r + 1}`;

// The Walker's whole Opportunity on the Timing given: each answer's kind and reason, and where it ends.
async function turn(policy, squad, start, enemy, timing) {
  const scenario = { ...data.solo.scenarios[0], id: 't-brawlerclaim', map: 'none', seats: { s1: squad, s2: 't-far' } };
  const seeded = new AI.Rng('7:brawlerclaim');
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
  at(U.Walker, start[0], start[1], 2); at(U.Rifle, enemy[0], enemy[1], 0);
  for (const x of t.state.tokens) if (x.kind === 'mech') x.stance = 'offensive';
  U.Walker.timing = timing;
  t.state.script.acted = [U.Rifle.uid];
  t.state.script.opp = null;
  M.G.opportunity(data, t.state);
  const answers = [];
  await t.run({
    until: (s) => answers.length >= 3 || (answers.length > 0 && !s.script.opp),
    onStep: (seat, step) => {
      if (seat === 's1' && step.decision.kind === 'opp.act') { const e = t.drivers.s1.log.at(-1); answers.push({ kind: step.option?.tags[0] ?? '', reason: e?.reason ?? '', why: e?.why ?? '' }); }
    },
    maxSteps: 60,
  });
  const out = { answers, at: g(Math.floor(U.Walker.col / 3), Math.floor(U.Walker.row / 3)), refused: t.refused.map((x) => `${x.kind}: ${x.why}`) };
  t.close();
  return out;
}

const claim = AI.makeBrawler({ ...AI.BRAWLER_COPY, claim: true }, 'brawler:claim');
{
  const copy = await turn(AI.brawlerPolicy, 't-walker', [1, 1], [10, 11], 'movement');
  check('NOTHING IN REACH, the copy Sprints from B2 toward the enemy (to F2)', [copy.answers[0]?.kind, copy.at], ['move', 'F2']);
  const took = await turn(claim, 't-walker', [1, 1], [10, 11], 'movement');
  check('WITH `claim` it Sprints into the scoring zone Bravo instead (to B6), and says so',
    [took.answers[0]?.kind, took.at, took.answers[0]?.why, took.refused], ['move', 'B6', 'into a zone the mission scores', []]);
}
{
  const copy = await turn(AI.brawlerPolicy, 't-walker', [1, 5], [10, 11], 'movement');
  check('STANDING IN BRAVO, the copy walks out of it toward the enemy (to F6)', [copy.answers[0]?.kind, copy.at], ['move', 'F6']);
  const held = await turn(claim, 't-walker', [1, 5], [10, 11], 'movement');
  check('with `claim` it stays: the zone is held only while it stands there', [held.answers.map((a) => a.reason), held.at, held.refused], [['hold_zone'], 'B6', []]);
}
{
  const copy = await turn(AI.brawlerPolicy, 't-shooter', [1, 1], [4, 5], 'firing');
  const shot = await turn(claim, 't-shooter', [1, 1], [4, 5], 'firing');
  check('WITH AN ATTACK ON OFFER it fights as the copy does: no zone is worth an attack given up', shot.answers.map((a) => a.kind), copy.answers.map((a) => a.kind));
}
check('the copy has the habit off', AI.BRAWLER_COPY.claim, false);

console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
