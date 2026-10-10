// A DRONE PUT DOWN TO JAM EVERY ROUND (`sentry`; OTTO's A6, 2026-10-05: "Yes
// lets start testing these less often used kits").
//
// The AMDS210 Delphinium Carrier (085) deploys a Delphinium (159), a Drone whose
// own turn is Fire Control Interference on the nearest enemy within 8. The Ace
// priced a launch by the attack its blast would make, so a Drone that jams was
// worth nothing and was deployed 0 times in 11 offers (the rare kit census).
// With the weight `sentry` the Landing Point is worth the best jam the Drone's
// turn is offered from there, for this round and each round left. Staged on the
// real engine through the driver (which gives each answer its `later`): the
// Carrier, with no gun, at C3 on its Projectile Opportunity; the enemy Rifle at
// F7, within 8 of where it could land, or at G9 or I10, beyond.
import { botTable, loadEngine } from './_engine.mjs';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}\n       got  ${g}`); }
};

console.log('A Drone put down to jam every round\n');

const { M, data } = await loadEngine('sentry', ["export * as SEAT from '../src/seat';", "export * as AI from '../src/ai/index';", "export * as TURN from '../src/turn';"]);
const AI = M.AI;
data.solo.squads['t-carrier'] = {
  name: 'Carrier', faction: 'UN', points: 0,
  mechs: [{ name: 'Carrier', loadout: { torso: '539', chasis: '099', backpack: '085', pilot: 'LPA-23-2' } }],
  drones: [],
};
data.solo.squads['t-rifle'] = {
  name: 'Rifle', faction: 'UN', points: 0,
  mechs: [{ name: 'Rifle', loadout: { torso: '539', chasis: '099', rightHand: '541', pilot: 'LPA-23-2' } }],
  drones: [],
};
const scenario = { ...data.solo.scenarios[0], id: 't-sentry', map: 'none', seats: { s1: 't-carrier', s2: 't-rifle' } };

// The Carrier's whole Opportunity: each answer with its reason, the Drones of its squad after, and what was offered.
async function carrierTurn(policy, rifle) {
  const seeded = new AI.Rng('7:sentry');
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
  at(U.Carrier, 2, 2, 2); at(U.Rifle, rifle[0], rifle[1], 0);
  for (const x of t.state.tokens) if (x.kind === 'mech') x.stance = 'offensive';
  U.Carrier.timing = 'projectile';
  t.state.script.acted = t.state.tokens.filter((x) => x.kind === 'mech' && x.uid !== U.Carrier.uid).map((x) => x.uid);
  t.state.script.opp = null;
  M.G.opportunity(data, t.state);
  const answers = [];
  let offered = [];
  await t.run({
    until: (s) => answers.length >= 6 || (answers.length > 0 && !s.script.opp),
    onStep: (seat, step) => {
      if (seat === 's1' && step.decision.kind === 'opp.act') {
        const e = t.drivers.s1.log.at(-1);
        if (!offered.length) offered = step.decision.options.filter((o) => String(o.label).includes('Delphinium'));
        answers.push({ label: step.option?.label ?? '', why: e?.why ?? '', reason: e?.reason ?? '' });
      }
    },
    maxSteps: 80,
  });
  const g = (x) => `${String.fromCharCode(65 + Math.floor(x.col / 3))}${Math.floor(x.row / 3) + 1}`;
  const out = {
    answers, offered: offered.map((o) => [o.tags.slice(0, 2), o.facts?.cardId, o.facts?.strike]),
    drones: t.state.tokens.filter((x) => x.side === 's1' && x.kind === 'drone').map((x) => `${x.cardId}@${g(x)}`),
    refused: t.refused.map((x) => `${x.kind}: ${x.why}`),
  };
  t.close();
  return out;
}

const priced = AI.tacticianPolicy;
const unpriced = AI.makeTactician({}, { sentry: 0 });
{
  const off = await carrierTurn(unpriced, [5, 6]);
  check('THE SEAM offers the Deploy from C3 on its Projectile Opportunity: a launch that lands the Delphinium (159), its jam at Range 8',
    off.offered.length > 0 && off.offered.every((o) => JSON.stringify(o) === JSON.stringify([['launch', 'land'], '159', 8])), true);
  check('WITHOUT `sentry` the Ace never deploys it, nothing refused', [off.drones, off.answers.some((a) => a.reason === 'sentry_value'), off.refused], [[], false, []]);
  const on = await carrierTurn(priced, [5, 6]);
  const dep = on.answers.find((a) => a.reason === 'sentry_value');
  check('THE ACE AS SHIPPED deploys the Delphinium within its Opportunity, to jam the Rifle every round, and says so in plain words',
    [!!dep, dep?.label.startsWith('Deploy "Delphinium"'), String(dep?.why).startsWith('a Drone to jam Rifle every round'), on.drones.length, on.drones[0]?.startsWith('159@'), on.refused],
    [true, true, true, 1, true, []]);
}
// Beyond its Range the weight alone is asked, on the Ace without the learned judge (`learned` 0 on both sides): the
// judge moves the Carrier's walk (to D3 at G9, from where a Delphinium landing at D4 reaches the Rifle at 8), and with
// it whether there is a jam to price at all.
for (const rifle of [[6, 8], [8, 9]]) {
  const off = await carrierTurn(AI.makeTactician({}, { sentry: 0, learned: 0 }), rifle);
  const on = await carrierTurn(AI.makeTactician({}, { learned: 0 }), rifle);
  check(`with the Rifle beyond its Range (at ${String.fromCharCode(65 + rifle[0])}${rifle[1] + 1}) it is worth nothing, and the turn is the same with the weight as without`,
    [on.drones, on.answers.map((a) => a.label)], [[], off.answers.map((a) => a.label)]);
}
check('the shipped weight is 1 (adopted 2026-10-05, late night: 96 of 200 against 89)', AI.TACTICIAN.sentry, 1);

console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
