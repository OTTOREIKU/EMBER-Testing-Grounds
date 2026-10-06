// A BEACON THAT GIVES THE SQUAD LOW PROFILE (`veil`; OTTO's A6, 2026-10-05:
// "Yes lets start testing these less often used kits", and "More focus on using
// mines, missiles, or beacons").
//
// The Type 55 Shield + MES Beacon Launcher (064) launches one MES Beacon (072,
// Decoy: Direct Fire, Silence). The Beacon strikes nothing: its Aura gives each
// Ally Unit within 1 Low Profile (an {Eye} rolled in Defence against a Firing
// Attack counts as a {Dodge}). The Ace priced a launch by the attack its blast
// would make, and launched it 0 times in 17 offers (the rare kit census). With
// the weight `veil` a Landing Point is worth what standing where they stand
// would cost the units of the squad it covers, less on the table the launch
// leaves, where the engine's odds read the Aura. Staged on the real engine
// through the driver: the Veiler (the Launcher and nothing else to act with) at
// C3 on its Projectile Opportunity, an Ally at D5 in the Rifle's sights or not.
import { botTable, loadEngine } from './_engine.mjs';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}\n       got  ${g}`); }
};

console.log('A Beacon that gives the squad Low Profile\n');

const { M, data } = await loadEngine('veil', ["export * as SEAT from '../src/seat';", "export * as AI from '../src/ai/index';", "export * as TURN from '../src/turn';"]);
const AI = M.AI;
data.solo.squads['t-veiler'] = {
  name: 'Veiler', faction: 'RDL', points: 0,
  mechs: [
    { name: 'Veiler', loadout: { torso: '012', chasis: '249', leftHand: '064', pilot: 'FPA-11' } },
    { name: 'Ally', loadout: { torso: '012', chasis: '249', rightHand: '536', pilot: 'FPA-11' } },
  ],
  drones: [],
};
data.solo.squads['t-rifle'] = {
  name: 'Rifle', faction: 'UN', points: 0,
  mechs: [{ name: 'Rifle', loadout: { torso: '539', chasis: '099', rightHand: '541', pilot: 'LPA-23-2' } }],
  drones: [],
};
const scenario = { ...data.solo.scenarios[0], id: 't-veil', map: 'none', seats: { s1: 't-veiler', s2: 't-rifle' } };

// The Veiler's whole Opportunity, the Rifle at `rifle` with its Firing still to come.
async function veilerTurn(policy, rifle) {
  const seeded = new AI.Rng('7:veil');
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
  at(U.Veiler, 2, 2, 2); at(U.Ally, 3, 4, 2); at(U.Rifle, rifle[0], rifle[1], 0);
  for (const x of t.state.tokens) if (x.kind === 'mech') x.stance = 'offensive';
  U.Veiler.timing = 'projectile';
  U.Rifle.timing = 'firing';
  t.state.script.acted = [U.Ally.uid];
  t.state.script.opp = null;
  M.G.opportunity(data, t.state);
  const answers = [];
  let offered = null;
  await t.run({
    until: (s) => answers.length >= 6 || (answers.length > 0 && s.script.opp?.uid !== U.Veiler.uid),
    onStep: (seat, step) => {
      if (seat === 's1' && step.decision.kind === 'opp.act') {
        const e = t.drivers.s1.log.at(-1);
        offered ??= step.decision.options.filter((o) => o.tags[0] === 'launch' && o.facts?.actionId === '064_A');
        answers.push({ label: step.option?.label ?? '', why: e?.why ?? '', reason: e?.reason ?? '', to: step.option?.facts?.to ?? null, card: step.option?.facts?.cardId ?? null });
      }
    },
    maxSteps: 80,
  });
  const out = { answers, offered: offered ?? [], refused: t.refused.map((x) => `${x.kind}: ${x.why}`), ally: { c: U.Ally.col / 3, r: U.Ally.row / 3 } };
  t.close();
  return out;
}

const priced = AI.makeTactician({}, { veil: 1 });
const unpriced = AI.makeTactician({}, { veil: 0 });
const near = (to, g) => !!to && Math.max(Math.abs(to.c - g.c), Math.abs(to.r - g.r)) <= 1;
{
  const off = await veilerTurn(unpriced, [4, 10]);
  check('THE SEAM offers the MES Beacon at its Landing Points, each with the Range its Aura reaches',
    [off.offered.length > 0, [...new Set(off.offered.map((o) => o.facts.cardId))], [...new Set(off.offered.map((o) => o.facts.veil))]], [true, ['072'], [1]]);
  check('WITHOUT `veil` the Ace launches none, the Ally in the Rifle\'s sights', [off.answers.some((a) => a.card === '072'), off.refused], [false, []]);
  const on = await veilerTurn(priced, [4, 10]);
  const veiled = on.answers.find((a) => a.reason === 'veil_value');
  check('WITH IT the Ace launches the MES Beacon within 1 of the Ally, for its Low Profile, and says so',
    [!!veiled, veiled?.card, near(veiled?.to, on.ally), String(veiled?.why).includes('Low Profile'), on.refused],
    [true, '072', true, true, []]);
}
{
  // Out of every enemy's reach the Ally is worth covering not at all.
  const off = await veilerTurn(unpriced, [11, 11]);
  const on = await veilerTurn(priced, [11, 11]);
  check('with nobody able to reach the Ally it is worth nothing, and the turn is the same with the weight as without',
    [on.answers.some((a) => a.reason === 'veil_value'), on.answers.map((a) => a.label)], [false, off.answers.map((a) => a.label)]);
}
check('the shipped weight is 0 (adopted, then returned to 0 on the melee test bed: RDL_Melee1b 11 of 24 with it against 16)', AI.TACTICIAN.veil, 0);

console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
