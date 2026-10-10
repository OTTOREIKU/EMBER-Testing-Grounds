// EACH RANGE AS IT WOULD BE MADE (AI-OPPONENT-PLAN.md: `trueRange`, the Tactician's skill; the challenger games,
// 2026-10-10, AI finding 1). The seat's view gave every weapon its PRINTED Range: no [Two-Handed] rider, no Firing aura,
// no Amplify. Reading the Wild Cat's rifle as 8, the Ace walked its Commander to 10 Grids from it and lost it. Now every
// weapon carries `printed`, `reach` (the Range as the unit would make it now) and `still` (a [Stationary] bonus, apart);
// `range`, which every reader reads, is `reach` for a seat in seat.ts TRUE_RANGE and `printed` otherwise. A seat is put
// there by a policy playing with `trueRange` (OFF until measured) and cleared by its driver as each game begins.
import { botTable, loadEngine, tableAtRoundOne } from './_engine.mjs';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}, got ${g}`); }
};

console.log('Each Range as it would be made\n');

const { M, data } = await loadEngine('seattruerange', ["export * as SEAT from '../src/seat';", "export * as AI from '../src/ai/index';", "export * as HUD from '../src/matchhud';"]);
const [, vip] = data.solo.scenarios;
const { state } = tableAtRoundOne(M, data, vip);
const { TRUE_RANGE, viewOf } = M.SEAT;
const gun = (view, label, id) => view.units.find((u) => u.label === label)?.weapons.find((w) => w.actionId === id);

TRUE_RANGE.clear();
const s1 = viewOf(data, state, 's1');
const rifle = gun(s1, 'Wild Cat', '541_A');
check("the Wild Cat's R7K rifle: printed 8, made 10 with the shield arm free for its [Two-Handed] rider",
  [rifle?.printed, rifle?.reach], [8, 10]);
check('a seat not in TRUE_RANGE reads the printed Range, as every view did', rifle?.range, 8);
const rail = gun(s1, 'Dune', '032_A');
check("the Dune's railgun: printed 6, made 6, and 8 standing still ([Stationary] Range +2, carried apart)",
  [rail?.printed, rail?.reach, rail?.range, rail?.still], [6, 6, 6, 8]);
check('a weapon with no rider reads the same three ways', (() => { const w = gun(s1, 'Mire', '536_B'); return [w?.printed, w?.reach, w?.range, w?.still]; })(), [3, 3, 3, undefined]);

TRUE_RANGE.add('s1');
check('in TRUE_RANGE, the seat reads the Range as made: the rifle reaches 10', gun(viewOf(data, state, 's1'), 'Wild Cat', '541_A')?.range, 10);
check('and the other seat, not in it, still reads 8', gun(viewOf(data, state, 's2'), 'Wild Cat', '541_A')?.range, 8);
TRUE_RANGE.clear();

// Without its shield arm the rifle has no Freehand to support it: 8 as made too.
const naked = JSON.parse(JSON.stringify(state));
naked.tokens.find((t) => t.label === 'Wild Cat').partStates.leftHand = 'destroyed';
const bare = gun(viewOf(data, naked, 's1'), 'Wild Cat', '541_A');
check('with the shield arm destroyed, no [Two-Handed] rider: the rifle is made at 8', [bare?.printed, bare?.reach], [8, 8]);

// The policy puts its seat in TRUE_RANGE; the driver clears the seat as each game begins.
const truly = M.AI.makeTactician({ trueRange: true });
check('the skill is OFF unless named', [M.AI.SKILLS.trueRange, M.AI.tacticianPolicy.trueRange, truly.trueRange], [false, false, true]);
TRUE_RANGE.add('s2');
const t = botTable(M, data, vip, { seed: 3, policies: { s1: truly, s2: M.AI.tacticianPolicy }, glue: M.HUD.glueAfter });
check('as a game begins, each driver sets its seat by its policy', [TRUE_RANGE.has('s1'), TRUE_RANGE.has('s2')], [true, false]);
// A wrapper that hides the skill from the driver: the Tactician puts its seat in at its first question.
const wrapped = { name: 'wrapped', choose: (d, v, r) => truly.choose(d, v, r) };
t.close();
const u = botTable(M, data, vip, { seed: 3, policies: { s1: M.AI.tacticianPolicy, s2: wrapped }, glue: M.HUD.glueAfter });
check('a wrapper round it: the driver clears the seat', TRUE_RANGE.has('s2'), false);
await u.run({ maxSteps: 40 });
check('and the Tactician puts it in at its first question', [TRUE_RANGE.has('s1'), TRUE_RANGE.has('s2')], [false, true]);
u.close();
TRUE_RANGE.clear();

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
