// THE LAST ROUND (AI-OPPONENT-PLAN.md, "THE MORNING OF 2026-10-05", item 4;
// the Tactician's skill `lastRound`). The game ends with its last round, so
// no unit has a turn after it. The engine already asks no unit for one
// (owedIfActivated); but a plan's walk toward an enemy to fight later is the
// Tactician's own, and so is the price of a Box carried outside the zone that
// pays. Without the skill the Ace's carriers walked off from Echo on the last
// turn of Asset Preservation (random game 92036: a Mech beside Echo with a Box
// in hand weighed the walk in at -1.20 and a step toward the fight it would
// never have at -0.48, and took the step). Staged on the real engine, on
// Asset Preservation with no terrain: the Mire's Movement Opportunity.
import { botTable, loadEngine } from './_engine.mjs';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}\n       got  ${g}`); }
};

console.log('The last round\n');

const { M, data } = await loadEngine('seatlastround', ["export * as SEAT from '../src/seat';", "export * as AI from '../src/ai/index';"]);
const AI = M.AI;
const name = (t) => (t.label.startsWith('ADK15P') ? 'Porcupine' : t.label.startsWith('ADK60S') ? 'Raven' : t.label.startsWith('ADK30C') ? 'Tarantula' : t.label);
const assetGame = { ...data.solo.scenarios[0], id: 't-lastround', mission: 'blackbox-asset-preservation' };

// Round `round` of five, the Action Phase, the Mire's Movement Opportunity
// open at `mire` (its Melee one where the Wild Cat is still to act); the
// other squad at `foes` (the Wild Cat first, its turn behind it unless `cat`
// is still to act); the Mire carrying a Box if `box`, every other Box along
// the bottom edge.
const staged = async ({ round, mire, foes, box, cat = 'done' }) => {
  const t = botTable(M, data, assetGame, { seed: 4, policies: AI.eagerPolicy });
  await t.run({ until: (st) => M.SU.normaliseSetup(st.setup)?.stage === 'done' && st.round.phase === 2 });
  const s = t.state;
  s.map = 'none';
  const U = Object.fromEntries(s.tokens.map((x) => [name(x), x]));
  const at = (x, [c, r], f) => { x.col = c * 3; x.row = r * 3; x.facing = f; };
  at(U.Mire, mire, 1); at(U.Dune, [0, 0], 2);
  ['Wild Cat', 'Porcupine', 'Raven', 'Tarantula'].forEach((k, i) => at(U[k], foes[i], 0));
  for (const x of s.tokens) x.statuses = (x.statuses ?? []).filter((y) => y !== 'camouflage');
  s.round.n = round; s.script.stage = `${round}:2`; s.script.passed = []; s.script.revealed = ['s1', 's2'];
  for (const x of s.tokens) if (x.kind === 'mech') x.timing = 'movement';
  // (A Wild Cat still to act comes after the Mire: the Mire on Melee, the Cat
  // on Firing.)
  U['Wild Cat'].timing = 'firing';
  if (cat !== 'done') U.Mire.timing = 'melee';
  const tasks = M.TK.normaliseTasks(s.tasks);
  const boxes = tasks.items.filter((i) => i.kind === 'blackbox');
  boxes.forEach((b, i) => { b.col = (4 + i) * 3 + 1; b.row = 11 * 3 + 1; b.bearerUid = undefined; b.bearerSlot = undefined; });
  if (box) { boxes[0].bearerUid = U.Mire.uid; boxes[0].bearerSlot = 'leftHand'; boxes[0].col = undefined; boxes[0].row = undefined; }
  s.tasks = tasks;
  s.script.acted = s.tokens.filter((x) => x.kind === 'mech' && x.uid !== U.Mire.uid && (cat === 'done' || x.uid !== U['Wild Cat'].uid)).map((x) => x.uid);
  s.script.opp = null;
  M.G.opportunity(data, s);
  const d = t.drivers.s1.pending();
  const view = M.SEAT.viewOf(data, s, 's1');
  return { t, U, d, view };
};
const plans = (x, skills, weights = {}) => AI.weighed(x.d, x.view, skills, weights);
// The skill is the Ace's own since 2026-10-05: "without" is asked for by name.
const OFF = { lastRound: false };
const corner = [[0, 11], [11, 0], [11, 1], [10, 0]];
const far = [[11, 11], [11, 10], [10, 11], [10, 10]];

{
  // A Box in hand, Echo a Maneuver and a Sprint away.
  const x = await staged({ round: 5, mire: [2, 5], foes: corner, box: true });
  const echo = new Set(x.view.zones.find((z) => z.name === 'Echo').cells);
  const inEcho = (g) => echo.has(`${g.col},${g.row}`);
  check('STAGED: the last round of five, the Mire\'s Opportunity open with a Box in its hand outside Echo',
    [x.view.round, x.view.roundLimit, x.d?.kind, x.d?.unit === x.U.Mire.uid, x.view.boxes.filter((b) => b.bearer === x.U.Mire.uid).length, inEcho(x.view.units.find((u) => u.uid === x.U.Mire.uid).grid)],
    [5, 5, 'opp.act', true, 1, false]);
  const on = plans(x, { lastRound: true });
  check('WITH `lastRound` the plan worth most carries the Box into Echo, for the whole of its 4 Victory Points',
    [inEcho(on[0].at), on[0].mission], [true, 4]);
  check('THE ENGINE ASKS NO TURN AFTER THE LAST, with the skill or without: no plan counts what the Mire could do a turn on',
    [plans(x, OFF).every((r) => r.next === 0), on.every((r) => r.next === 0)], [true, true]);
  x.t.close();
}
{
  // The other squad far off in one corner, nothing to walk to for the Task
  // (`zonePull` and `zoneStep` 0, so a plan's shape is its walk to a fight).
  const flat = { zonePull: 0, zoneStep: 0 };
  const x = await staged({ round: 5, mire: [1, 1], foes: far, box: false });
  const off = plans(x, OFF, flat);
  const on = plans(x, { lastRound: true }, flat);
  const moves = (rows) => rows.filter((r) => r.how === 'move');
  check('A STEP TOWARD A FIGHT LATER: in the last round without the skill the Mire\'s walks are still drawn toward the enemy nine Grids off',
    moves(off).some((r) => r.shape < -1e-9), true);
  check('with it they are not: on its last turn of the game no walk is worth more or less for where it leaves the Mire',
    moves(on).every((r) => Math.abs(r.shape) < 1e-9), true);
  const y = await staged({ round: 4, mire: [1, 1], foes: far, box: false });
  check('in round four of five the walk toward the fight is drawn as before, with the skill or without',
    plans(y, { lastRound: true }, flat).map((r) => [r.label, r.shape.toFixed(6)]), plans(y, OFF, flat).map((r) => [r.label, r.shape.toFixed(6)]));
  x.t.close(); y.t.close();
}
{
  // A Box in hand outside Echo, the Wild Cat two Grids off with its turn
  // still to come: a Penetration drops the Box.
  const x = await staged({ round: 5, mire: [2, 2], foes: [[2, 4], [11, 0], [11, 1], [10, 0]], box: true, cat: 'to come' });
  const off = AI.exposureAt(x.d, x.view, null, Infinity, OFF, {}).cost;
  const on = AI.exposureAt(x.d, x.view, null, Infinity, { lastRound: true }, {}).cost;
  check('A BOX THAT WILL NEVER BE CARRIED HOME: standing outside Echo on its last turn, the Mire\'s Box no longer adds to what the Wild Cat\'s attack would cost it',
    [off > 0, on > 0, on < off], [true, true, true]);
  const y = await staged({ round: 4, mire: [2, 2], foes: [[2, 4], [11, 0], [11, 1], [10, 0]], box: true, cat: 'to come' });
  check('in round four of five it costs the same with the skill as without',
    AI.exposureAt(y.d, y.view, null, Infinity, { lastRound: true }, {}).cost.toFixed(6), AI.exposureAt(y.d, y.view, null, Infinity, OFF, {}).cost.toFixed(6));
  x.t.close(); y.t.close();
}
{
  // Round four: the skill changes nothing at all.
  const x = await staged({ round: 4, mire: [2, 5], foes: corner, box: true });
  check('IN ROUND FOUR OF FIVE the skill changes nothing: every plan weighed the same',
    plans(x, { lastRound: true }).map((r) => [r.label, r.worth.toFixed(6)]), plans(x, OFF).map((r) => [r.label, r.worth.toFixed(6)]));
  x.t.close();
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
