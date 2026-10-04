// A PRICE STOPPED PAST ITS BUDGET SAYS SO (AI-OPPONENT-PLAN.md: the Tactician's
// skill `bounded`). What standing somewhere would cost (`exposure`) is asked
// with a budget: once a plan cannot beat the best so far the asking stops, and
// the cost it returns must be more than that budget, or the plan is taken as if
// priced in full. A VIP Commander's round after (`ahead`) was checked against
// the budget and left out of the cost returned: a White Dwarf's Mode change came
// back at 0.00 where it cost 1.23, was taken, and was undone the next Action
// (random game 51001). Held here on that game, staged as `_squadprobe.mjs`
// dealt it: every price of the Commanders' answers of four rounds, asked again
// at half of what it costs in full.
import { botTable, loadEngine } from './_engine.mjs';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}\n       got  ${g}`); }
};

console.log('A price stopped past its budget says so\n');

const { M, data } = await loadEngine('seatbounded', ["export * as SEAT from '../src/seat';", "export * as AI from '../src/ai/index';", "export * as HUD from '../src/matchhud';"]);
const AI = M.AI;
data.solo.squads['bounded-s1'] = { name: 'UN 493', faction: 'UN', points: 493, mechs: [{ name: '(Cruise Mode)', loadout: { torso: '288', chasis: '289', leftHand: '291', rightHand: '290', backpack: '292', pilot: 'ACE-01' } }], drones: [{ cardId: '166' }, { cardId: '163' }, { cardId: '166' }, { cardId: '165' }, { cardId: '164' }] };
data.solo.squads['bounded-s2'] = { name: 'GOF 483', faction: 'GOF', points: 483, mechs: [{ name: 'Armored Core', loadout: { torso: '176', chasis: 'PLK400-SK', leftHand: 'ZHLA-201', rightHand: 'ZHRA-301', backpack: 'ZYBP-102', pilot: 'ZPA-38' } }], drones: [{ cardId: 'ZHDR-107' }, { cardId: 'ZHDR-104' }, { cardId: 'ZHDR-303' }] };
const vip = { id: 'probe-51001', map: 'alley', mission: 'vip-commander-assassination', rounds: 5, secondaries: false, tactics: false, seats: { s1: 'bounded-s1', s2: 'bounded-s2' } };
// (Played as the game was found, before `press` 10 and `nextAfter` 1 were adopted.)
const ace = AI.makeTactician({}, { press: 0, nextAfter: 0 });

// For each skill setting: answers priced again at half their cost, how many came
// back stopped, and how many of those came back at no more than that half.
const tally = { on: { asked: 0, stopped: 0, under: 0 }, off: { asked: 0, stopped: 0, under: 0 } };
const commanders = new Set();
const watch = {
  name: 'watch',
  choose(d, view, rng) {
    const pick = ace.choose(d, view, rng);
    const me = view.units.find((u) => u.uid === d.unit);
    if (me?.commander && (d.kind === 'opp.act' || d.kind === 'activation.act') && view.round <= 4) {
      commanders.add(me.label);
      for (const o of [null, ...d.options.filter((x) => x.after && (x.tags.includes('move') || x.tags.includes('stance')))].slice(0, 12)) {
        for (const [k, skills] of [['on', {}], ['off', { bounded: false }]]) {
          const full = AI.exposureAt(d, view, o?.id ?? null, Infinity, skills);
          if (!full || full.cost < 0.05) continue;
          const half = full.cost / 2;
          const part = AI.exposureAt(d, view, o?.id ?? null, half, skills);
          tally[k].asked += 1;
          if (part.partial) {
            tally[k].stopped += 1;
            if (part.cost <= half) tally[k].under += 1;
          }
        }
      }
    }
    return pick;
  },
};
const t = botTable(M, data, vip, { seed: 51001, policies: { s1: watch, s2: watch }, glue: M.HUD.glueAfter });
await t.run({ maxSteps: 12000, until: (st) => st.round.n > 4 });
t.close();

console.log(`  (Commanders read: ${[...commanders].join(', ')}; ${JSON.stringify(tally)})`);
check('EVERY PRICE STOPPED AT HALF ITS COST COMES BACK AT MORE THAN THAT HALF, on both Commanders\' answers of four rounds',
  [tally.on.stopped > 0, tally.on.under], [true, 0]);
check('WITHOUT IT (the old answer) the round after was left out, and prices came back under their budget',
  tally.off.under > 0, true);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
