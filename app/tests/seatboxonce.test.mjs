// THE BOXES A UNIT CARRIES ARE LOST ONCE (AI-OPPONENT-PLAN.md, "THE MORNING OF
// 2026-10-05", item 4; the Tactician's skill `boxOnce`). A bearer that is
// Penetrated drops what it carries, and what standing somewhere costs charged
// each attack that could Penetrate it the whole of it: two Razor Missiles over
// Echo charged a carrier five Victory Points for a Box worth four (random game
// 92002). With the skill the Boxes are charged once, at the chance that any of
// the attacks Penetrates. Staged on the real engine, on Asset Preservation with
// no terrain: the Mire with a Box in hand, the Wild Cat (its turn still to
// come) and the Porcupine (its Automatic Phase still to come) in reach of it.
import { botTable, loadEngine } from './_engine.mjs';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}\n       got  ${g}`); }
};

console.log('The Boxes a unit carries are lost once\n');

const { M, data } = await loadEngine('seatboxonce', ["export * as SEAT from '../src/seat';", "export * as AI from '../src/ai/index';"]);
const AI = M.AI;
const name = (t) => (t.label.startsWith('ADK15P') ? 'Porcupine' : t.label.startsWith('ADK60S') ? 'Raven' : t.label.startsWith('ADK30C') ? 'Tarantula' : t.label);
const assetGame = { ...data.solo.scenarios[0], id: 't-boxonce', mission: 'blackbox-asset-preservation' };

// Round 2 of five, the Action Phase, the Mire's Melee Opportunity open at C3
// with a Box in hand (none with `box` false); the Wild Cat on Firing, its turn
// to come; the other squad's Drones at `drones`.
const staged = async (drones, box = true) => {
  const t = botTable(M, data, assetGame, { seed: 4, policies: AI.eagerPolicy });
  await t.run({ until: (st) => M.SU.normaliseSetup(st.setup)?.stage === 'done' && st.round.phase === 2 });
  const s = t.state;
  s.map = 'none';
  const U = Object.fromEntries(s.tokens.map((x) => [name(x), x]));
  const at = (x, [c, r], f) => { x.col = c * 3; x.row = r * 3; x.facing = f; };
  at(U.Mire, [2, 2], 1); at(U.Dune, [0, 0], 2); at(U['Wild Cat'], [2, 4], 0);
  ['Porcupine', 'Raven', 'Tarantula'].forEach((k, i) => at(U[k], drones[i], 0));
  for (const x of s.tokens) x.statuses = (x.statuses ?? []).filter((y) => y !== 'camouflage');
  s.round.n = 2; s.script.stage = '2:2'; s.script.passed = []; s.script.revealed = ['s1', 's2'];
  for (const x of s.tokens) if (x.kind === 'mech') x.timing = 'movement';
  U['Wild Cat'].timing = 'firing'; U.Mire.timing = 'melee';
  const tasks = M.TK.normaliseTasks(s.tasks);
  const boxes = tasks.items.filter((i) => i.kind === 'blackbox');
  boxes.forEach((b, i) => { b.col = (4 + i) * 3 + 1; b.row = 11 * 3 + 1; b.bearerUid = undefined; b.bearerSlot = undefined; });
  if (box) { boxes[0].bearerUid = U.Mire.uid; boxes[0].bearerSlot = 'leftHand'; boxes[0].col = undefined; boxes[0].row = undefined; }
  s.tasks = tasks;
  s.script.acted = s.tokens.filter((x) => x.kind === 'mech' && x.uid !== U.Mire.uid && x.uid !== U['Wild Cat'].uid).map((x) => x.uid);
  s.script.opp = null;
  M.G.opportunity(data, s);
  const d = t.drivers.s1.pending();
  const view = M.SEAT.viewOf(data, s, 's1');
  return { t, U, d, view };
};
const costOf = (x, skills, weights = {}) => AI.exposureAt(x.d, x.view, null, Infinity, skills, weights).cost;
// The skill is ON by default since 2026-10-05: without it is asked for in so many words.
const OFF = { boxOnce: false };

{
  // The Porcupine's Single Shot reaches twelve Grids: beside the Mire it is a
  // second attack that could Penetrate it.
  const two = await staged([[3, 3], [11, 0], [11, 1]]);
  check('STAGED: the Mire\'s Opportunity open with a Box in hand, the Wild Cat and the Porcupine still to act',
    [two.d?.kind, two.d?.unit === two.U.Mire.uid, two.view.boxes.filter((b) => b.bearer === two.U.Mire.uid).length,
      two.view.units.filter((u) => u.side === 's2' && !u.done && (u.label === 'Wild Cat' || u.label.startsWith('ADK15P'))).length],
    ['opp.act', true, 1, 2]);
  const off = costOf(two, OFF);
  const on = costOf(two, { boxOnce: true });
  const bare = costOf(two, { mission: false, boxOnce: false });
  check('TWO ATTACKS THAT COULD EACH PENETRATE IT: with the skill the Box is charged less than the two charges of it without',
    [on < off, on > bare], [true, true]);
  two.t.close();
}
{
  // The Drones out of reach: the Wild Cat alone, whose turn may hold two
  // attacks (the second after the first), each of which could Penetrate.
  const one = await staged([[11, 2], [11, 0], [11, 1]]);
  const off = costOf(one, OFF);
  const on = costOf(one, { boxOnce: true });
  check('ONE ENEMY: never charged more with the skill, and still charged for the Box',
    [on <= off + 1e-9, on > costOf(one, { mission: false, boxOnce: false })], [true, true]);
  one.t.close();
  // With no Box in hand the skill has nothing to change.
  const none = await staged([[3, 3], [11, 0], [11, 1]], false);
  check('NO BOX IN HAND: the same with the skill as without',
    costOf(none, { boxOnce: true }).toFixed(6), costOf(none, OFF).toFixed(6));
  none.t.close();
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
