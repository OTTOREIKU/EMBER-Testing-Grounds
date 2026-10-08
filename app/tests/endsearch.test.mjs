// THE LAST ROUND SEARCHED (M16, OTTO's item 2; AI-OPPONENT-PLAN.md section 4, M16 "THE LAST ROUND SEARCHED"). What
// the census of what another answer would have won (E1, the probe's ENDCHOICES) reads of the Ace: the first answers of
// its best plans for one activation (`firstAnswers`), one plan for each, the best first.
//
// Staged on the real engine, the board of squaddials.test: RDL's Blade (a Swift Steed) two Grids from a UN Tarantula
// Drone, RDL's Gun (an R-20 Railgun) six from it, UN's Rifle far off. The Blade's turn on the Melee Timing is the one
// its dial question's Melee answer opens (`then`).
import { botTable, loadEngine } from './_engine.mjs';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}\n       got  ${g}`); }
};

console.log('The last round searched\n');

const { M, data } = await loadEngine('endsearch', ["export * as SEAT from '../src/seat';", "export * as AI from '../src/ai/index';", "export * as HUD from '../src/matchhud';"]);
const AI = M.AI;
data.solo.squads['t-ours'] = {
  name: 'Ours', faction: 'RDL', points: 0,
  mechs: [
    { name: 'Blade', loadout: { torso: '012', chasis: '022', leftHand: '062', rightHand: '036', pilot: 'FPA-11' } },
    { name: 'Gun', loadout: { torso: '016', chasis: '021', rightHand: '033', pilot: 'FPA-03' } },
  ],
  drones: [],
};
data.solo.squads['t-theirs'] = {
  name: 'Theirs', faction: 'UN', points: 0,
  mechs: [{ name: 'Rifle', loadout: { torso: '539', chasis: '099', rightHand: '541', pilot: 'LPA-23-2' } }],
  drones: [{ cardId: '163' }],
};
const scenario = { ...data.solo.scenarios[0], id: 't-endsearch', map: 'none', mission: 'none', seats: { s1: 't-ours', s2: 't-theirs' } };
const t = botTable(M, data, scenario, { seed: 5, policies: { s1: AI.eagerPolicy, s2: AI.makeTactician() }, glue: M.HUD.glueAfter });
await t.run({ until: (st) => M.SU.normaliseSetup(st.setup)?.stage === 'done' && st.round.phase === 1 });
const U = Object.fromEntries(t.state.tokens.map((x) => [x.cardId === '163' ? 'Drone' : x.label, x]));
const at = (x, c, r, f) => { x.col = c * 3; x.row = r * 3; x.facing = f; };
at(U.Blade, 4, 4, 2); at(U.Drone, 4, 6, 0); at(U.Gun, 2, 2, 2); at(U.Rifle, 10, 11, 0);
const dialQ = t.drivers.s1.pending();
const view = M.SEAT.viewOf(data, t.state, 's1');
const turn = dialQ.options.find((o) => o.tags.includes('timing:melee'))?.then?.();
const list = turn ? AI.firstAnswers(turn, view) : [];
const own = turn ? AI.makeTactician().choose(turn, view, new AI.Rng('endsearch')) : null;
const firsts = list.map((x) => x.first);
check('THE FIRST ANSWERS: the Blade\'s Melee turn weighed, more than one first answer, each once, the best first',
  [turn?.unit === U.Blade.uid, list.length > 1, new Set(firsts).size === firsts.length, list.every((x, i) => i === 0 || list[i - 1].worth >= x.worth)],
  [true, true, true, true]);
check('and the first of them is the Ace\'s own answer to the same question, each a real answer to it (or staying)',
  [list[0]?.first === own?.option, list.every((x) => x.first === null || turn.options.some((o) => o.id === x.first))], [true, true]);
t.close();

console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
