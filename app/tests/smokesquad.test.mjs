// SMOKE FOR THE SQUAD (`smokeSquad`, the Tactician; OTTO, 2026-10-05: "Would a
// unit smoke out an open area so that they or a friendly unit can move safely
// through it?", and "more choices based on squad tactics rather than the unit
// thinking mostly about itself").
//
// A Smoke Grenade puts down up to 3 Connected Screens from where it lands
// (268_A). The computer was offered every shape and answered with the safe
// one, a lone Screen, which the End Phase takes the same round (4.16); and it
// threw one only to hide the unit throwing it. With the skill the shape is the
// one that hides the most of the squad from enemies that could attack it, and
// of two that hide as much the larger. Staged on the real engine: a Volcano
// core (016) throws its Smoke Grenade at its own feet with an Ally in the next
// Grid and two Rifles in sight of both.
import { botTable, loadEngine } from './_engine.mjs';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}\n       got  ${g}`); }
};

console.log('Smoke for the squad\n');

const { M, data } = await loadEngine('smokesquad', ["export * as SEAT from '../src/seat';", "export * as AI from '../src/ai/index';", "export * as TURN from '../src/turn';"]);
const AI = M.AI;

data.solo.squads['t-smokers'] = {
  name: 'Smokers', faction: 'RDL', points: 0,
  mechs: [
    { name: 'Smoker', loadout: { torso: '016', chasis: '020', rightHand: '033', pilot: 'FPA-63' } },
    { name: 'Buddy', loadout: { torso: '014', chasis: '020', rightHand: '033', pilot: 'FPA-04-2' } },
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
const scenario = { ...data.solo.scenarios[0], id: 't-smokesquad', map: 'none', seats: { s1: 't-smokers', s2: 't-gunners' } };
const grid = (c, r) => `${String.fromCharCode(65 + c)}${r + 1}`;

// The Smoker's turn: the Smoke Grenade thrown at its own feet (the script), and
// the Screens answered by the policy under test.
async function throwSmoke(policy) {
  const seeded = new AI.Rng('7:smokesquad');
  const script = (d, v) => {
    if (d.kind === 'opp.act' && d.unit === t.state.tokens.find((x) => x.label === 'Smoker')?.uid) {
      const o = d.options.find((x) => x.tags[0] === 'launch' && x.tags.includes('smoke') && x.label.endsWith(` to ${grid(5, 5)}`));
      if (o) return o.id;
      return d.options.find((x) => x.tags.includes('end'))?.id;
    }
    if (d.kind === 'opp.act') return d.options.find((x) => x.tags.includes('end'))?.id;
    return null;
  };
  const scripted = (inner) => ({
    name: 'scripted',
    choose(d, view, rng) {
      const id = script(d, view);
      if (id && d.options.some((o) => o.id === id)) return { option: id, why: 'scripted' };
      return (d.kind === 'blast.resolve' ? inner : AI.eagerPolicy).choose(d, view, rng);
    },
  });
  const t = botTable(M, data, scenario, {
    seed: 7,
    dice: (pool) => Object.entries(pool).flatMap(([color, n]) => Array.from({ length: n }, () => ({ color, face: seeded.int(data.dice.dice[color].sides) }))),
    policies: { s1: scripted(policy), s2: scripted(AI.eagerPolicy) },
  });
  await t.run({ until: (s) => M.SU.normaliseSetup(s.setup)?.stage === 'done' && s.round.phase === 2 });
  const U = Object.fromEntries(t.state.tokens.map((x) => [x.label, x]));
  const at = (x, c, r, f) => { x.col = c * 3; x.row = r * 3; if (f !== undefined) x.facing = f; };
  at(U.Smoker, 5, 5, 2); at(U.Buddy, 6, 5, 2); at(U['Gunner A'], 5, 9, 0); at(U['Gunner B'], 8, 9, 0);
  for (const x of t.state.tokens) if (x.kind === 'mech') x.stance = 'offensive';
  U.Smoker.timing = 'projectile';
  t.state.script.acted = t.state.tokens.filter((x) => x.kind === 'mech' && x.uid !== U.Smoker.uid).map((x) => x.uid);
  t.state.script.opp = null;
  M.G.opportunity(data, t.state);
  const asked = [];
  const r = await t.run({
    until: (s) => (s.smoke ?? []).length > 0 && !s.tokens.some((x) => x.kind === 'projectile'),
    onStep: (seat, step) => { if (step.decision.kind === 'blast.resolve') asked.push({ n: step.decision.options.length, took: step.option?.id }); },
    maxSteps: 200,
  });
  const smoke = (t.state.smoke ?? []).filter((x) => x.side === 's1').map((x) => grid(x.col, x.row)).sort();
  const out = { end: r.kind, refused: t.refused.map((x) => `${x.kind}: ${x.why}`), smoke, asked };
  t.close();
  return out;
}

{
  const plain = await throwSmoke(AI.tacticianPolicy);
  check('WITHOUT THE SKILL the Ace answers the Screens with the safe answer: one Screen where it landed, which the End Phase takes',
    [plain.refused, plain.smoke, plain.asked[0]?.n > 1], [[], [grid(5, 5)], true]);
}
{
  const squad = await throwSmoke(AI.makeTactician({ smokeSquad: true }));
  check('WITH IT the Screens hide the Ally beside it too: three Connected, its own Grid and the Ally\'s among them, and nothing is refused',
    [squad.refused, squad.smoke.length, squad.smoke.includes(grid(5, 5)), squad.smoke.includes(grid(6, 5))], [[], 3, true, true]);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
