// THE TIEBREAK (AI-OPPONENT-PLAN.md, M12: `tiebreak`, the Tactician's
// weight; 0 prices a Part by its points alone). Level on Victory Points, a
// game goes to the side with more Mech Parts not destroyed and Drones on the
// board (5.2.4), and half the Black Box and VIP games the computer plays end
// that way. Each Part and each Drone counts one there, whatever its points, so
// while the game is heading for level each one destroyed is worth `tiebreak` x
// the chance it ends level (`tieWorth`, read off the margin the Main Task is
// heading for, with a doubt of `tieSpread` a round).
import { loadEngine, tableAtRoundOne } from './_engine.mjs';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}\n       got  ${g}`); }
};

console.log('The tiebreak\n');

const { M, data } = await loadEngine('tiebreak', ["export * as SEAT from '../src/seat';", "export * as AI from '../src/ai/index';"]);
const AI = M.AI;
M.L.setLocalSeat(null);
// The copied Alley game on its VIP mission: nothing banked, nobody's Commander down.
const t = tableAtRoundOne(M, data, { ...data.solo.scenarios[0], mission: 'vip-assassination' });
if (t.refused.length) throw new Error(t.refused.join('; '));
const W = AI.TACTICIAN;
const on = { ...W, tiebreak: 1 };
const viewAt = (round, banked = 0) => {
  const s = JSON.parse(JSON.stringify(t.state));
  s.round.n = round;
  const v = M.SEAT.viewOf(data, s, 's1');
  return { ...v, vp: { ...v.vp, [v.seat]: (v.vp[v.seat] ?? 0) + banked } };
};
const last = viewAt(5);
const cat = last.units.find((u) => u.label === 'Wild Cat');
const drone = last.units.find((u) => u.side === cat.side && u.kind === 'drone' && !u.lowValue);
// A sure kill, a sure Part destroyed short of the kill, and a sure Damage.
const kill = { hit: 1, pen: 1, damage: 0, destroy: 1, kill: 1, link: 0, parts: [], pick: null };
const part = { ...kill, kill: 0 };
const dent = { hit: 1, pen: 1, damage: 1, destroy: 0, kill: 0, link: 0, parts: [], pick: null };
const live = cat.parts.filter((x) => x.state !== 'destroyed').length;
// How close the count of Parts and Drones standing is, with a doubt of `tieCount` (3) in the last round.
const count = AI.standingFor(last, last.seat) - AI.standingFor(last, last.other);
const close = Math.exp(-(count * count) / (2 * 9));
check('LEVEL IN THE LAST ROUND, each Part or Drone is worth `tiebreak` more, as close as the count is: a Drone destroyed one, the Wild Cat destroyed one for each Part it stands on, a Part of it destroyed one, a Damage nothing',
  [+AI.tieWorth(last, on).toFixed(9), +(AI.gainOf(kill, drone, last, on) - AI.gainOf(kill, drone, last, W)).toFixed(9), +(AI.gainOf(kill, cat, last, on) - AI.gainOf(kill, cat, last, W)).toFixed(9),
    +(AI.gainOf(part, cat, last, on) - AI.gainOf(part, cat, last, W)).toFixed(9), +(AI.gainOf(dent, cat, last, on) - AI.gainOf(dent, cat, last, W)).toFixed(9)],
  [+close.toFixed(9), +close.toFixed(9), +(live * close).toFixed(9), +close.toFixed(9), 0]);
check('and the count level, it is the whole of `tiebreak`', +AI.tieWorth(last, { ...on, tieCount: 1e9 }).toFixed(9), 1);
const ahead = viewAt(5, 8);
check('EIGHT VICTORY POINTS AHEAD IN THE LAST ROUND the game will not end level: a Part is worth next to nothing more', AI.tieWorth(ahead, on) < 1e-6, true);
const early = viewAt(1, 4);
check('four ahead in round 1, with four rounds of doubt to come, the tie is still in play: worth something, less than level', [AI.tieWorth(early, on) > 0.5, AI.tieWorth(early, on) < 1], [true, true]);
check('and at 0 nothing is added', AI.tieWorth(last, W), 0);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
