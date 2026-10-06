// AN ACTION OPPORTUNITY WHOSE MECH IS DESTROYED INSIDE IT (glue.ts
// `closeDeadOpportunity`; found 2026-10-06 in a random-squad game of the
// computer against itself: the White Dwarf shot an N52 "Zealot", the Zealot's
// Martyrdom destroyed the White Dwarf, and the Action Phase stalled with nobody
// asked anything).
//
// A destroyed Unit leaves the board (4.4.4). endOpportunity refuses a unit no
// longer on the board, and where the Mech was the last of the round to act no
// other Opportunity replaced its own, so the open one held the table. The glue
// now closes it as ending it would: the Mech has acted, and what it owed lapses.
// Staged on the copied Alley game at round 1's Action Phase.
import { loadEngine, tableAtRoundOne } from './_engine.mjs';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}\n       got  ${g}`); }
};

console.log('An Opportunity whose Mech is destroyed inside it\n');

const { M, data } = await loadEngine('deadopp', ["export * as SEAT from '../src/seat';"]);
const base = tableAtRoundOne(M, data, data.solo.scenarios[0]);
if (base.refused.length) throw new Error(base.refused.join('; '));
const clone = (x) => JSON.parse(JSON.stringify(x));

// The Action Phase with one Mech's Opportunity open and begun; `others` says whether the other Mechs have acted.
function staged(othersActed) {
  const s = clone(base.state);
  s.round.phase = 2; s.script.stage = '1:2'; s.script.passed = []; s.script.revealed = ['s1', 's2'];
  const mechs = s.tokens.filter((t) => t.kind === 'mech');
  // Every Mech's dial on the same Timing, so the activation order has them all.
  for (const m of mechs) m.timing = 'firing';
  const dead = mechs[0];
  const sc = s.script;
  sc.acted = othersActed ? mechs.filter((m) => m.uid !== dead.uid).map((m) => m.uid) : [];
  sc.opp = { ...M.TY.newOpportunity(dead.uid, dead.timing ?? 'firing'), started: true, performed: ['an attack'] };
  sc.counterOwed = { uid: dead.uid };
  return { s, dead, mechs };
}

{
  const { s, dead } = staged(true);
  // The Mech is destroyed and leaves the board, as recordKill takes it off.
  s.tokens = s.tokens.filter((t) => t.uid !== dead.uid);
  const next = M.G.opportunity(data, s);
  check('THE LAST MECH OF THE ROUND, destroyed in its own Opportunity: the Opportunity is closed and nothing opens after it',
    [next, s.script.opp], [null, null]);
  check('it is counted as having acted, and the Counter-roll it owed lapses', [s.script.acted.includes(dead.uid), s.script.counterOwed ?? null], [true, null]);
  const d = M.SEAT.owed(data, s, 's1', M.SEAT.newMind());
  check('and the seat is asked something again (the table no longer waits on a Mech that is gone)', !!d, true);
}
{
  const { s, dead, mechs } = staged(false);
  s.tokens = s.tokens.filter((t) => t.uid !== dead.uid);
  const next = M.G.opportunity(data, s);
  check('WITH ANOTHER MECH STILL TO ACT, its Opportunity opens after the one closed',
    [!!next, next?.uid !== dead.uid, mechs.some((m) => m.uid === next?.uid), s.script.acted.includes(dead.uid)], [true, true, true, true]);
}
{
  const { s, dead } = staged(true);
  const next = M.G.opportunity(data, s);
  check('A MECH STILL STANDING keeps its open Opportunity: nothing is closed under it', [next?.uid, s.script.opp?.uid, s.script.acted.includes(dead.uid)], [dead.uid, dead.uid, false]);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
