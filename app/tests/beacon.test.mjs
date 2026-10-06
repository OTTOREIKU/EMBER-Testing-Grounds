// A UNIT PUT DOWN TO SERVE THE SQUAD (`beacon`; OTTO's A6, 2026-10-05: "Yes
// lets start testing these less often used kits").
//
// The CP-3 Beacon Backpack (008) throws one of the three B3 Beacons (the type is
// locked at the first throw). The B3/1 Link Beacon's own turn is Link Support:
// each Ally Mech within 3 recovers 1 Link. The Ace priced a launch by the attack
// its blast would make, and deployed a B3 Beacon 0 times in 19 offers (the rare
// kit census). With the weight `beacon` a Landing Point is worth the Support its
// unit's turn would give, as `support` prices one made now. Staged on the real
// engine through the driver: the Carrier (a Support Arm, the Freehand a Throw
// needs) at C3 on its Projectile Opportunity, an Ally at D4 short of Link or
// not, the enemy far off.
import { botTable, loadEngine } from './_engine.mjs';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}\n       got  ${g}`); }
};

console.log('A Beacon put down to serve the squad\n');

const { M, data } = await loadEngine('beacon', ["export * as SEAT from '../src/seat';", "export * as AI from '../src/ai/index';", "export * as TURN from '../src/turn';"]);
const AI = M.AI;
const carrierOf = (leftHand) => ({ name: 'Carrier', loadout: { torso: '539', chasis: '099', ...(leftHand ? { leftHand } : {}), backpack: '008', pilot: 'LPA-23-2' } });
data.solo.squads['t-rifle'] = {
  name: 'Rifle', faction: 'UN', points: 0,
  mechs: [{ name: 'Rifle', loadout: { torso: '539', chasis: '099', rightHand: '541', pilot: 'LPA-23-2' } }],
  drones: [],
};

// The Carrier's whole Opportunity, with the Ally `short` Link below what it has.
async function carrierTurn(policy, { short, leftHand = 'ZHLA-303' }) {
  data.solo.squads['t-carrier'] = {
    name: 'Carrier', faction: 'UN', points: 0,
    mechs: [carrierOf(leftHand), { name: 'Ally', loadout: { torso: '539', chasis: '099', rightHand: '541', pilot: 'LPA-23-2' } }],
    drones: [],
  };
  const scenario = { ...data.solo.scenarios[0], id: 't-beacon', map: 'none', seats: { s1: 't-carrier', s2: 't-rifle' } };
  const seeded = new AI.Rng('7:beacon');
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
  at(U.Carrier, 2, 2, 2); at(U.Ally, 3, 3, 2); at(U.Rifle, 10, 11, 0);
  U.Ally.link = Math.max(0, (U.Ally.link ?? 0) - short);
  for (const x of t.state.tokens) if (x.kind === 'mech') x.stance = 'offensive';
  U.Carrier.timing = 'projectile';
  t.state.script.acted = t.state.tokens.filter((x) => x.kind === 'mech' && x.uid !== U.Carrier.uid).map((x) => x.uid);
  t.state.script.opp = null;
  M.G.opportunity(data, t.state);
  const answers = [];
  let offered = null;
  await t.run({
    until: (s) => answers.length >= 6 || (answers.length > 0 && !s.script.opp),
    onStep: (seat, step) => {
      if (seat === 's1' && step.decision.kind === 'opp.act') {
        const e = t.drivers.s1.log.at(-1);
        offered ??= step.decision.options.filter((o) => o.tags[0] === 'launch' && o.facts?.actionId === '008_A');
        answers.push({ label: step.option?.label ?? '', why: e?.why ?? '', reason: e?.reason ?? '', to: step.option?.facts?.to ?? null, card: step.option?.facts?.cardId ?? null });
      }
    },
    maxSteps: 80,
  });
  const out = { answers, offered: offered ?? [], refused: t.refused.map((x) => `${x.kind}: ${x.why}`) };
  t.close();
  return out;
}

const priced = AI.tacticianPolicy;
const unpriced = AI.makeTactician({}, { beacon: 0 });
{
  const off = await carrierTurn(unpriced, { short: 2 });
  check('THE SEAM offers the three B3 Beacons at every Landing Point (the type is locked at the first throw)',
    [off.offered.length > 0, [...new Set(off.offered.map((o) => o.facts.cardId))].sort()], [true, ['075', '076', '077']]);
  check('WITHOUT `beacon` the Ace throws none, its Ally short of Link or not', [off.answers.some((a) => a.card), off.refused], [false, []]);
  const on = await carrierTurn(priced, { short: 2 });
  const threw = on.answers.find((a) => a.reason === 'beacon_value');
  check('THE ACE AS SHIPPED, the Ally 2 Link short, it throws the B3/1 Link Beacon within 3 of the Ally, for its Link Support, and says so',
    [!!threw, threw?.card, threw ? Math.abs(threw.to.c - 3) + Math.abs(threw.to.r - 3) <= 3 : null, String(threw?.why).includes('Link Support'), on.refused],
    [true, '075', true, true, []]);
}
{
  const off = await carrierTurn(unpriced, { short: 0 });
  const on = await carrierTurn(priced, { short: 0 });
  check('with nobody short of Link it is worth nothing, and the turn is the same with the weight as without',
    [on.answers.map((a) => a.label)], [off.answers.map((a) => a.label)]);
}
{
  const bare = await carrierTurn(priced, { short: 2, leftHand: null });
  check('a Carrier with no Part with Freehand is offered no throw at all: Throw needs one to designate (4.17)', bare.offered.length, 0);
}
check('the shipped weight is 1 (adopted 2026-10-06: 115 of 200 against 113)', AI.TACTICIAN.beacon, 1);

console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
