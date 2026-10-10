// WHAT A PLAN THAT ACTS NOW COULD STILL DO A TURN LATER (AI-OPPONENT-PLAN.md:
// `nextAfter`, the Tactician's weight; 0 leaves every plan as it was). A plan
// counted what it could do at its next turn only when it did nothing now
// ("what it can do now, or failing that what it could do next turn"). A random
// game read (seed 48056, Asset Preservation on the Steelworks): the COLLABORATION
// Mech set its dial for a Rail Gun shot at RDL's Tactical Core and, when its
// Opportunity came, Maneuvered instead: the shot now (1.20) against the walk's
// shot a turn later (1.24), as if firing now gave that up. Staged here as that
// game was dealt, stopped at that Opportunity; since each line of sight is
// walked cell by cell (2026-10-08, losexact.test.mjs) the walk's shot a turn
// later went through a corner at the Tactical Core where it stands, in C1, so
// the Tactical Core is put in C4 for the question, where the lines from C11
// reach it, and the numbers are the game's again.
import { botTable, dealt, loadEngine } from './_engine.mjs';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}\n       got  ${g}`); }
};

console.log('What a plan that acts now could still do a turn later\n');

const { M, data } = await loadEngine('seatnextafter', ["export * as SEAT from '../src/seat';", "export * as AI from '../src/ai/index';", "export * as HUD from '../src/matchhud';"]);
const AI = M.AI;
// The game as `_squadprobe.mjs` dealt seed 48056.
data.solo.squads['nextafter-s1'] = { name: 'COLLABORATION 500', faction: 'COLLABORATION', points: 500, mechs: [{ name: '(Cruise Mode)', loadout: { torso: '288', chasis: '289', leftHand: '291', rightHand: '290', backpack: '292', pilot: 'ACE-01' } }], drones: [{ cardId: 'PRDR-203' }, { cardId: 'PRDR-201' }, { cardId: 'PRDR-105' }] };
data.solo.squads['nextafter-s2'] = { name: 'RDL 500', faction: 'RDL', points: 500, mechs: [{ name: 'Tactical Core', loadout: { torso: '559', chasis: '534', leftHand: '252', backpack: '002', pilot: 'FPA-63' } }, { name: 'Artillery Core', loadout: { torso: '015', chasis: '249', leftHand: '041', rightHand: '025', backpack: '501', pilot: 'FPA-11' } }], drones: [{ cardId: '079' }, { cardId: '080' }, { cardId: '079' }] };
const scenario = { id: 'probe-48056', map: 'steelworks', mission: 'blackbox-asset-preservation', rounds: 5, secondaries: false, tactics: false, seats: { s1: 'nextafter-s1', s2: 'nextafter-s2' } };
// (The game as it was dealt and played, `press` 0 and `nextAfter` 0: both adopted since, at 10 and 1; the first
// changes how the squad behind deploys, the second is the thing held here.)
const ace = AI.makeTactician({}, { press: 0, nextAfter: 0 });
const after = AI.makeTactician({}, { nextAfter: 1, press: 0 });

let seen = null;
let t = null;
const watch = {
  name: 'watch',
  choose(asked, seenFrom, rng) {
    const pick = ace.choose(asked, seenFrom, rng);
    if (!seen && asked.kind === 'opp.act' && seenFrom.round === 1 && asked.options.some((o) => String(o.label).startsWith('(Cruise Mode)'))) {
      // The question asked again of the table with the Tactical Core in C4.
      const s = t.state;
      const core = s.tokens.find((x) => x.label === 'Tactical Core');
      const was = { col: core.col, row: core.row };
      core.col = 6; core.row = 9;
      const drv = t.drivers.s1;
      const d = drv.withOdds(M.SEAT.owed(data, s, 's1', drv.mind));
      const view = M.SEAT.viewOf(data, s, 's1');
      const label = (id) => d.options.find((o) => o.id === id)?.label;
      const rows = (w) => AI.weighed(d, view, {}, w);
      const stay = (w) => rows(w).find((r) => r.how === 'stay');
      const walk = (w) => rows(w).find((r) => r.label === '(Cruise Mode): Maneuver to C11, facing north');
      seen = {
        ace: label(ace.choose(d, view, new AI.Rng('ace')).option), after: label(after.choose(d, view, new AI.Rng('after')).option),
        stay: [stay({ nextAfter: 0 }).does.startsWith('Rail Gun at Tactical Core'), stay({ nextAfter: 0 }).next, stay({ nextAfter: 1 }).next > 0, Math.round(stay({ nextAfter: 1 }).next / stay({ nextAfter: 0.5 }).next * 1e9) / 1e9],
        walk: [walk({ nextAfter: 0 }).next, walk({ nextAfter: 1 }).next],
      };
      core.col = was.col; core.row = was.row;
    }
    return pick;
  },
};
// Deployed as this game was dealt before a squad could deploy where its own units waited (_engine.mjs dealt).
const DEALT = [['s2', 8, 3, 0, null, 0], ['s1', 2, 3, 10, null, 0], ['s2', 7, 3, 1, null, 0], ['s1', 3, 2, 10, null, 0], ['s2', 9, 2, 1, null, 0], ['s1', 4, 4, 10, null, 0], ['s2', 5, 1, 0, 'offensive', 0], ['s1', 1, 1, 10, 'offensive', 0], ['s2', 6, 4, 1, 'offensive', 0]];
t = botTable(M, data, scenario, { seed: 48056, policies: { s1: dealt(watch, 's1', DEALT), s2: dealt(ace, 's2', DEALT) }, glue: M.HUD.glueAfter });
await t.run({ maxSteps: 12000, until: () => !!seen });
t.close();

check('AS IT WAS: with a Rail Gun shot at the Tactical Core to make where it stands, the Mech Maneuvers toward a better shot a turn later',
  [seen?.ace, seen?.stay?.[0]], ['(Cruise Mode): Maneuver to C11, facing north', true]);
check('THE PLAN THAT FIRES NOW COUNTED NOTHING A TURN LATER; at `nextAfter` it counts that share of what it could do there then (twice as much at 1 as at 0.5)',
  [seen?.stay?.[1], seen?.stay?.[2], seen?.stay?.[3]], [0, true, 2]);
check('A PLAN WITH NOTHING TO DO NOW COUNTS ITS NEXT TURN AS EVER', seen?.walk?.[0] === seen?.walk?.[1] && seen?.walk?.[0] > 0, true);
check('AND THE MECH FIRES', seen?.after, 'Rail Gun at Tactical Core');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
