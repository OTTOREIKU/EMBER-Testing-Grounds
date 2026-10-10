// VIP, AS IT WILL BE PAID (AI-OPPONENT-PLAN.md: `vipPending`, the Tactician's weight; the challenger's game 3,
// 2026-10-10). VIP pays its Victory Points for a Commander's destroyed Parts only at the round limit, so the board read
// 0 to 0 while the Ace was 3 and then 6 behind: its margin (marginOf, read by `press` and `stakes`) counted the banked
// Victory Points alone, it never knew it was losing, and both its Mechs ended their turns idle for two rounds. At
// `vipPending` 1 the margin counts each Commander's destroyed Parts at the Task's 3 a Part; at 0 it reads as before.
import { loadEngine, tableAtRoundOne } from './_engine.mjs';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}, got ${g}`); }
};

console.log('VIP, as it will be paid\n');

const { M, data } = await loadEngine('vippending', ["export * as SEAT from '../src/seat';", "export * as AI from '../src/ai/index';"]);
const AI = M.AI;
const [alley, vip] = data.solo.scenarios;
const { state } = tableAtRoundOne(M, data, vip);
const lead = (side) => state.tokens.find((t) => t.side === side && t.kind === 'mech' && state.tokens.length && M.SEAT.viewOf(data, state, side).units.find((u) => u.uid === t.uid)?.commander);
const un = lead('s2');
const rdl = lead('s1');
check('both squads have a Commander', [!!un, !!rdl], [true, true]);

const at = (w) => ({ ...AI.TACTICIAN, ...w });
const margin = (side, w) => AI.marginOf(M.SEAT.viewOf(data, state, side), at(w));

check('the weight is 0 unless named', AI.TACTICIAN.vipPending, 0);
check('nothing destroyed: level either way', [margin('s1', {}), margin('s1', { vipPending: 1 })], [0, 0]);

// The UN Commander loses two Parts, as the Dune did in game 3.
un.partStates.rightHand = 'destroyed';
un.partStates.backpack = 'destroyed';
check('at 0 the board still reads level (the banked Victory Points alone)', [margin('s1', {}), margin('s2', {})], [0, 0]);
check('at 1 RDL is 6 ahead (3 a Part, two Parts) and UN 6 behind', [margin('s1', { vipPending: 1 }), margin('s2', { vipPending: 1 })], [6, -6]);
check('so UN knows it is behind', AI.behindNow(M.SEAT.viewOf(data, state, 's2'), at({ vipPending: 1 })), true);

// Each side's destroyed Parts count against it: one of RDL's Commander's off makes it 6 - 3.
rdl.partStates.leftHand = 'destroyed';
check("one of RDL's Commander's Parts too: RDL 3 ahead", margin('s1', { vipPending: 1 }), 3);

// A Repaired Part works again and does not pay.
un.repairedSlots = ['rightHand'];
check('a Repaired Part is not counted', margin('s1', { vipPending: 1 }), 0);
un.repairedSlots = [];

// A Commander destroyed has paid its Task and ended the game: no Parts are owed for it.
un.partStates.torso = 'destroyed';
check('a Commander destroyed: no Parts owed', margin('s1', { vipPending: 1 }), M.SEAT.viewOf(data, state, 's1').vp.s1 - M.SEAT.viewOf(data, state, 's1').vp.s2);

// Another Task: the weight reads nothing.
const other = tableAtRoundOne(M, data, alley).state;
check('another Task reads as before', AI.marginOf(M.SEAT.viewOf(data, other, 's1'), at({ vipPending: 1 })), AI.marginOf(M.SEAT.viewOf(data, other, 's1'), at({})));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
