// A MINE PUT DOWN BY AN ACTION (`mineLay`; OTTO, 2026-10-05: "More focus on
// using mines, missiles, or beacons could be a good study to further test").
//
// The GLP-15 Mine Layer (006) lays its GM-35 Mine with an Action (006_B, Range
// 1) besides as it walks. A Mine has no turn of its own, so the Ace priced the
// Action at nothing and took it 0 times in 21 offers (the rare kit census). The
// seam now tags such a launch `mine`; with the weight `mineLay` a Landing Point
// is worth a Part Damaged on the nearest enemy Ground unit, over one more than
// the Grids between, where that enemy stands nearer than any other unit of the
// squad (as the walk lays them). Staged on the real engine through the driver:
// the Layer at C3 on its Projectile Opportunity, an enemy Rifle down the board.
import { botTable, loadEngine } from './_engine.mjs';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}\n       got  ${g}`); }
};

console.log('A Mine put down by an Action\n');

const { M, data } = await loadEngine('minelaystage', ["export * as SEAT from '../src/seat';", "export * as AI from '../src/ai/index';", "export * as TURN from '../src/turn';"]);
const AI = M.AI;
data.solo.squads['t-carrier'] = {
  name: 'Carrier', faction: 'UN', points: 0,
  mechs: [{ name: 'Carrier', loadout: { torso: '539', chasis: '099', backpack: '006', pilot: 'LPA-23-2' } }],
  drones: [],
};
data.solo.squads['t-rifle'] = {
  name: 'Rifle', faction: 'UN', points: 0,
  mechs: [{ name: 'Rifle', loadout: { torso: '539', chasis: '099', rightHand: '541', pilot: 'LPA-23-2' } }],
  drones: [],
};
const scenario = { ...data.solo.scenarios[0], id: 't-minelay', map: 'none', seats: { s1: 't-carrier', s2: 't-rifle' } };

// The Carrier's whole Opportunity: each answer with its reason, the Drones of its squad after, and what was offered.
async function carrierTurn(policy, rifle) {
  const seeded = new AI.Rng('7:minelay');
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
        if (!offered.length) offered = step.decision.options.filter((o) => String(o.label).includes('Mine'));
        answers.push({ label: step.option?.label ?? '', why: e?.why ?? '', reason: e?.reason ?? '' });
      }
    },
    maxSteps: 80,
  });
  const g = (x) => `${String.fromCharCode(65 + Math.floor(x.col / 3))}${Math.floor(x.row / 3) + 1}`;
  const out = {
    answers, offered: offered.map((o) => [o.tags.slice(0, 2), o.tags.includes('mine'), o.facts?.cardId, o.facts?.strike]),
    drones: t.state.tokens.filter((x) => x.side === 's1' && x.kind === 'drone').map((x) => `${x.cardId}@${g(x)}`),
    refused: t.refused.map((x) => `${x.kind}: ${x.why}`),
  };
  t.close();
  return out;
}

const on = AI.makeTactician({}, { mineLay: 1 });
{
  const off = await carrierTurn(AI.tacticianPolicy, [2, 6]);
  check('THE SEAM offers the Mine as a launch tagged `mine`, at Range 1 of the Layer',
    off.offered.length > 0 && off.offered.every((o) => JSON.stringify(o) === JSON.stringify([['launch', 'land'], true, '074', 0])), true);
  check('AS SHIPPED the Ace lays none, nothing refused', [off.answers.some((a) => a.reason === 'mine_value'), off.refused], [false, []]);
  const got = await carrierTurn(on, [2, 6]);
  const laid = got.answers.find((a) => a.reason === 'mine_value');
  check('WITH `mineLay` it lays one in the Rifle\'s way, C4, and says so', [laid?.label, String(laid?.why).includes("in Rifle's way"), got.refused],
    ['Mine: GM-35 Anti-Armor Mine to C4', true, []]);
}
check('the shipped weight is 0 (measured before it is adopted)', AI.TACTICIAN.mineLay, 0);

console.log(`
${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
