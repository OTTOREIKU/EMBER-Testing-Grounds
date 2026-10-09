// AN ENEMY THAT WALKS UP BESIDE IT (the Tactician's weight `walkUp`, 0 as it
// ships). On the copied Alley (the Ace at s1 against the Veteran) the Mire
// Sprinted into G6, the Wild Cat Sprinted to G7 beside it and shot it, and on a
// Melee dial finished it the round after: the read had priced the one
// activation (AI-OPPONENT-PLAN.md section 12, "THE LINES OF SIGHT WALKED CELL
// BY CELL, MEASURED"). With `walkUp` that blow counts again, a round on.
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
const scenario = { ...data.solo.scenarios[0] };
const ace = AI.makeTactician({}, {});
let seen = null;
const watch = {
  name: 'watch',
  choose(d, view, rng) {
    const pick = ace.choose(d, view, rng);
    const label = d.options.find((o) => o.id === pick.option)?.label ?? '';
    if (!seen && view.seat === 's1' && d.kind === 'opp.act' && /Mire: Sprint to G6/.test(label)) {
      const cost = (id, w) => AI.exposureAt(d, view, id, Infinity, {}, w)?.cost ?? NaN;
      const wc = view.units.find((u) => u.label === 'Wild Cat');
      seen = {
        ships: cost(pick.option, {}), off: cost(pick.option, { walkUp: 0 }), on: cost(pick.option, { walkUp: 1 }), half: cost(pick.option, { walkUp: 0.5 }),
        stay: cost(null, {}), stayOn: cost(null, { walkUp: 1 }), wildCat: `${String.fromCharCode(65 + wc.grid.col)}${wc.grid.row + 1} ${wc.timing}`,
      };
    }
    return pick;
  },
};
const t = botTable(M, data, scenario, { seed: 7, policies: { s1: watch, s2: AI.veteranPolicy } });
await t.run({ maxSteps: 8000, until: () => !!seen });
t.close();

const round2 = (x) => Math.round(x * 100) / 100;
check('the game as dealt: the Mire picks Sprint to G6 with the Wild Cat in H9 on a Movement dial, the plan read at 1.77 as it ships', [!!seen, seen?.wildCat, round2(seen?.ships ?? NaN)], [true, 'H9 movement', 1.77]);
check('AT 0 NOTHING MORE IS COUNTED: as it ships, staying in D6 too', [seen?.off === seen?.ships, seen?.stayOn === seen?.stay], [true, true]);
// The Wild Cat's Sprint to G7 and its Single Shot are the whole of the 1.77 (2.21 x `exposure` 0.8); a round on its
// blow from G7 adds 2.21 x `exposureLater` 0.35 x `walkUp`.
const w = AI.TACTICIAN;
const blow = seen.ships / w.exposure;
check('AT 1 THE BLOW FROM BESIDE IT COUNTS AGAIN, A ROUND ON: walkUp x exposureLater of it more, and half of that at 0.5',
  [round2(seen.on - seen.ships), round2(seen.half - seen.ships)], [round2(blow * w.exposureLater), round2(blow * w.exposureLater * 0.5)]);
check('it ships at 0', w.walkUp, 0);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
