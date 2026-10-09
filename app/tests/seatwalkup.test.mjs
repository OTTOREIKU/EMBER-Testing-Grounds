// AN ENEMY THAT WALKS UP BESIDE IT (the Tactician's weight `walkUp`, 0 as it
// ships). On the copied Alley (the Ace at s1 against the Veteran) the Mire
// Sprinted into G6, the Wild Cat Sprinted to G7 beside it and shot it, and on a
// Melee dial finished it the round after: the read had priced the one
// activation (AI-OPPONENT-PLAN.md section 12, "THE LINES OF SIGHT WALKED CELL
// BY CELL, MEASURED"). With `walkUp` that blow counts again, a round on.
// (Staged since 2026-10-09: once the Ace answered every question itself, M21,
// that game went otherwise. The Mire in D6 on a Movement dial, the Wild Cat in
// H9 on one too, its turn still to come; the Mire's walks into G6 read.)
import { botTable, loadEngine } from './_engine.mjs';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}\n       got  ${g}`); }
};

console.log('An enemy that walks up beside it\n');

const { M, data } = await loadEngine('seatwalkup', ["export * as SEAT from '../src/seat';", "export * as AI from '../src/ai/index';"]);
const AI = M.AI;
const t = botTable(M, data, { ...data.solo.scenarios[0] }, { seed: 7, policies: { s1: AI.tacticianPolicy, s2: AI.veteranPolicy } });
await t.run({ maxSteps: 8000, until: (st) => M.SU.normaliseSetup(st.setup)?.stage === 'done' && M.TY.PHASES[st.round.phase] === 'Action' });
const s = t.state;
const U = Object.fromEntries(s.tokens.map((x) => [x.label, x]));
const at = (x, c, r, f) => { x.col = c * 3; x.row = r * 3; x.facing = f; x.deployed = true; };
at(U.Mire, 3, 5, 1); at(U.Dune, 0, 0, 2); at(U['Wild Cat'], 7, 8, 0);
at(U['ADK15P Porcupine Ion Type'], 11, 11, 0); at(U['ADK60S Raven Interference Type'], 10, 11, 0); at(U['ADK30C Tarantula Carrier Type'], 9, 11, 0);
U.Mire.timing = 'movement'; U['Wild Cat'].timing = 'movement'; U.Dune.timing = 'firing';
s.script.turn = 's1';
s.script.acted = [U.Dune.uid];
s.script.opp = M.TY.newOpportunity(U.Mire.uid, 'movement');
const d = t.drivers.s1.pending();
const view = M.SEAT.viewOf(data, s, 's1');
const intoG6 = d?.options.filter((o) => o.tags[0] === 'move' && o.facts?.to?.c === 6 && o.facts?.to?.r === 5) ?? [];
const cost = (id, w) => AI.exposureAt(d, view, id, Infinity, {}, w)?.cost ?? NaN;
const read = intoG6.map((o) => ({ label: o.label, ships: cost(o.id, {}), off: cost(o.id, { walkUp: 0 }), on: cost(o.id, { walkUp: 1 }), half: cost(o.id, { walkUp: 0.5 }) }));
const seen = read.find((x) => x.on > x.off + 0.1) ?? null;
const stay = [cost(null, {}), cost(null, { walkUp: 1 })];
t.close();

const round2 = (x) => Math.round(x * 100) / 100;
check('THE STAGE: the Mire is asked its Opportunity, and may walk into G6, where the Wild Cat could Sprint up beside it and shoot',
  [d?.kind, d?.unit === U.Mire.uid, intoG6.length > 0, !!seen], ['opp.act', true, true, true]);
console.log(`       ${seen?.label}: ${round2(seen?.ships ?? NaN)} as it ships, ${round2(seen?.on ?? NaN)} at 1`);
check('AT 0 NOTHING MORE IS COUNTED: as it ships, staying in D6 too (no enemy walks up beside it there)', [seen?.off === seen?.ships, stay[1] === stay[0]], [true, true]);
// What the Wild Cat's Sprint and its shot this round would do is the whole of the cost as it ships. A round on its
// blows follow these, and what they would finish is priced at the Mire's worth, a round on: more at 1, exactly half
// as much more at 0.5.
const w = AI.TACTICIAN;
const more = (seen?.on ?? 0) - (seen?.ships ?? 0);
check('AT 1 WHAT ITS BLOWS A ROUND ON WOULD FINISH COUNTS: the plan costs more, and at 0.5 half as much more',
  [more > 0.1, round2((seen?.half ?? 0) - (seen?.ships ?? 0)), round2(seen?.on ?? NaN)], [true, round2(more / 2), round2((seen?.ships ?? 0) + more)]);
check('it ships at 0', w.walkUp, 0);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
