// A DIAL FOR HOLDING (AI-OPPONENT-PLAN.md: `cover`, the Tactician's weight; 0
// leaves every dial as it was). Where every Timing opens the same plan, hold
// and do nothing, acting sooner (`tempo`) took the earliest: on the
// Intersection's VIP game RDL's Dune, two railguns and nobody in reach, set
// Melee round after round, and an enemy that walked into its Range that round
// was not shot. A Timing one of its own ready guns or blades is played on keeps
// that weapon for an enemy that could walk into it this round.
import { botTable, loadEngine } from './_engine.mjs';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}\n       got  ${g}`); }
};

console.log('A dial for holding\n');

const { M, data } = await loadEngine('seatcover', ["export * as SEAT from '../src/seat';", "export * as AI from '../src/ai/index';", "export * as HUD from '../src/matchhud';"]);
const AI = M.AI;
const vip = { ...data.solo.scenarios.find((s) => s.id === 'intersection-vip-assassination') };
const ace = AI.makeTactician({}, {});
// A weight far beyond any measured: however much it is, a plan that acts is
// never outweighed by it.
const covering = AI.makeTactician({}, { cover: 5 });
const timingOf = (d, id) => d.options.find((o) => o.id === id)?.tags.find((t) => t.startsWith('timing:'))?.slice(7);

// The game played by the Ace on both sides; each dial is read where it is set.
const seen = { dune: null, shot: null };
const watch = {
  name: 'watch',
  choose(d, view, rng) {
    const pick = ace.choose(d, view, rng);
    if (d.kind === 'planning.dial') {
      const me = view.units.find((u) => u.uid === d.unit);
      const c = covering.choose(d, view, new AI.Rng('cover'));
      if (me?.label === 'Dune' && view.round === 3 && !seen.dune) {
        seen.dune = { ace: timingOf(d, pick.option), cover: timingOf(d, c.option), why: pick.why?.startsWith('it opens with holding') };
      }
      // A plan that does something is never outweighed by it: every dial of
      // the game whose plan acts is set as it was.
      if (pick.why && !pick.why.startsWith('it opens with holding')) {
        seen.shot ??= { acting: 0, changed: 0 };
        seen.shot.acting += 1;
        if (c.option !== pick.option) seen.shot.changed += 1;
      }
    }
    return pick;
  },
};
const t = botTable(M, data, vip, { seed: 5, policies: { s1: watch, s2: watch }, glue: M.HUD.glueAfter });
await t.run({ maxSteps: 12000 });
t.close();
// And the Alley's game, where the squads fight from the first round: a dial
// that fires beside one that would hold.
const alley = { ...data.solo.scenarios.find((s) => s.id === 'alley-forward-advance') };
const ta = botTable(M, data, alley, { seed: 7, policies: { s1: watch, s2: watch }, glue: M.HUD.glueAfter });
await ta.run({ maxSteps: 12000 });
ta.close();

check('HOLDING WITH NOBODY IN REACH, Dune (two railguns) sets Melee on `tempo` alone; at `cover` it sets Firing, the Timing its railguns are played on',
  [seen.dune?.why, seen.dune?.ace, seen.dune?.cover], [true, 'melee', 'firing']);
check('A DIAL WHOSE PLAN DOES SOMETHING IS NEVER OUTWEIGHED: every one of the game set as it was',
  [seen.shot?.acting > 0, seen.shot?.changed], [true, 0]);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
