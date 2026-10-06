// A HIGHLIGHT PUT ON AN ENEMY (the Tactician's weight `targetTag`; the community
// kit census of 2026-10-06: the LD-5M Vigilant MG's Target Tag, PRDR-202_A,
// chosen 0 times in 36 offers).
//
// A Firing Action that can target a Highlighted unit must target it (6.2.1;
// FAQ J18), so a squad's Automatic Drones, which take the nearest enemy, take
// the tagged one instead. The Ace gave the Tag no worth. With `targetTag`, the
// Tag is worth what the squad's guns still to act this round gain on the table
// it leaves: here a Porcupine Ion that would spend its four Red dice on the cheap
// Tarantula in front of it shoots the Wild Cat behind it instead. Played on the
// real engine from round 1's Command Phase.
import { botTable, loadEngine } from './_engine.mjs';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}\n       got  ${g}`); }
};

console.log('A Highlight put on an enemy\n');

const { M, data } = await loadEngine('seattargettag', ["export * as SEAT from '../src/seat';", "export * as AI from '../src/ai/index';", "export * as HUD from '../src/matchhud';"]);
const AI = M.AI;
data.solo.squads['t-taggers'] = {
  name: 'Taggers', faction: 'UN', points: 0,
  mechs: [{ name: 'Rifle', loadout: { torso: '539', chasis: '099', rightHand: '541', pilot: 'LPA-23-2' } }],
  drones: [{ cardId: 'PRDR-202' }, { cardId: '543' }],
};
data.solo.squads['t-tagged'] = {
  name: 'Tagged', faction: 'UN', points: 0,
  mechs: [{ name: 'Cat', loadout: { torso: '539', chasis: '099', rightHand: '541', pilot: 'LPA-23-2' } }],
  drones: [{ cardId: '163' }],
};
const scenario = { ...data.solo.scenarios[0], id: 't-targettag', map: 'none', mission: 'none', seats: { s1: 't-taggers', s2: 't-tagged' } };
const label = (x) => (x.cardId === 'PRDR-202' ? 'Vigilant' : x.cardId === '543' ? 'Porcupine' : x.cardId === '163' ? 'Tarantula' : x.label);

// Round 1's Command Phase, the board set; who the Vigilant tags in it, played by `policy`.
async function played(policy) {
  const t = botTable(M, data, scenario, { seed: 4, policies: { s1: policy, s2: AI.makeTactician({}, { targetTag: 0 }) }, glue: M.HUD.glueAfter });
  await t.run({ until: (st) => M.SU.normaliseSetup(st.setup)?.stage === 'done' });
  const s = t.state;
  const U = Object.fromEntries(s.tokens.map((x) => [label(x), x]));
  const at = (x, c, r, f) => { x.col = c * 3; x.row = r * 3; if (f !== undefined) x.facing = f; };
  at(U.Rifle, 1, 1, 2); at(U.Vigilant, 3, 1, 2); at(U.Porcupine, 5, 1, 2);
  at(U.Tarantula, 5, 4, 0); at(U.Cat, 6, 9, 0);
  const tags = [];
  t.watch((cmd) => { if (cmd.kind === 'applyStatus' && cmd.uid === U.Vigilant.uid && cmd.statusId === 'highlight') tags.push(cmd.targetUid); });
  const out = await t.run({ until: (st) => st.round.n === 1 && st.round.phase >= 1, maxSteps: t.steps() + 200 });
  const r = { tags: tags.map((uid) => label(s.tokens.find((x) => x.uid === uid) ?? { label: String(uid) })), cat: U.Cat.statuses ?? [], end: out.kind, refused: t.refused.map((x) => `${x.kind}: ${x.why}`) };
  t.close();
  return r;
}

const off = await played(AI.makeTactician({}, { targetTag: 0 }));
check('WITHOUT `targetTag` the Vigilant tags nobody in the Command Phase', [off.tags, off.refused], [[], []]);
const on = await played(AI.makeTactician({}, { targetTag: 1 }));
check('WITH IT the Vigilant is given its Command and tags the Wild Cat behind the Tarantula, so the Porcupine Ion\'s four Red dice go on the Cat',
  [on.tags, on.cat.includes('highlight'), on.refused], [['Cat'], true, []]);
check('the weight ships at 0 until it is measured', AI.TACTICIAN.targetTag, 0);

console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
