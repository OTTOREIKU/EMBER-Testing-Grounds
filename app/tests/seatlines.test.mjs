// A SQUADMATE'S LINE (`clearLines`, 2026-10-09; OTTO, watching the Ace play itself: a UN Mech stepped in front of its
// own Porcupine before it fired). Only a Large unit gives Unit Protection, two White Dice more on the Defense Roll
// (4.5.3), and it gives it to the target whichever squad it belongs to. So a Mech standing between a squadmate still to
// act and the enemy it would shoot costs that shot: the Ace weighs it with the skill, and not without.
//
// Staged on the real engine: UN's Rifle (a Large Mech) a Grid off the line between its own Porcupine (whose Single
// Shot fires by itself in the Automatic Phase) and RDL's Gun. The Rifle's turn, opened on its Firing dial, weighed.
import { botTable, loadEngine } from './_engine.mjs';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}\n       got  ${g}`); }
};

console.log('A squadmate\'s line\n');

const { M, data } = await loadEngine('seatlines', ["export * as SEAT from '../src/seat';", "export * as AI from '../src/ai/index';", "export * as HUD from '../src/matchhud';"]);
const AI = M.AI;
data.solo.squads['t-ours'] = {
  name: 'Ours', faction: 'UN', points: 0,
  mechs: [{ name: 'Rifle', loadout: { torso: '539', chasis: '099', rightHand: '541', pilot: 'LPA-23-2' } }],
  drones: [{ cardId: '543' }],
};
data.solo.squads['t-theirs'] = {
  name: 'Theirs', faction: 'RDL', points: 0,
  mechs: [{ name: 'Gun', loadout: { torso: '016', chasis: '021', rightHand: '033', pilot: 'FPA-03' } }],
  drones: [],
};
const scenario = { ...data.solo.scenarios[0], id: 't-lines', map: 'none', mission: 'none', seats: { s1: 't-ours', s2: 't-theirs' } };
const t = botTable(M, data, scenario, { seed: 5, policies: { s1: AI.eagerPolicy, s2: AI.eagerPolicy }, glue: M.HUD.glueAfter });
await t.run({ until: (st) => M.SU.normaliseSetup(st.setup)?.stage === 'done' && st.round.phase === 1 });
const U = Object.fromEntries(t.state.tokens.map((x) => [x.cardId === '543' ? 'Porcupine' : x.label, x]));
const at = (x, c, r, f) => { x.col = c * 3; x.row = r * 3; x.facing = f; };
at(U.Porcupine, 5, 10, 0); at(U.Gun, 5, 3, 2); at(U.Rifle, 6, 7, 0);
const view = M.SEAT.viewOf(data, t.state, 's1');
const porcupine = view.units.find((u) => u.uid === U.Porcupine.uid);
const gun = porcupine.weapons.find((x) => x.type === 'Firing');
check('THE STAGE: the Porcupine\'s Single Shot fires by itself, and the Gun is in its Range', [gun?.mode, Math.abs(5 - 5) + Math.abs(10 - 3) <= gun?.range], ['auto', true]);
const dialQ = t.drivers.s1.pending();
const turn = dialQ?.options.find((o) => o.tags.includes('timing:firing'))?.then?.();
check('and the Rifle\'s turn, opened on its Firing dial, offers it the Grid in the line and the Grids beside it', [!!turn, ['5,7', '7,7'].every((g) => turn.options.some((o) => o.facts?.to && `${o.facts.to.c},${o.facts.to.r}` === g))], [true, true]);
const rowAt = (rows, col, row) => rows.filter((r) => r.priced && r.at.col === col && r.at.row === row);
{
  const on = AI.weighed(turn, view, { clearLines: true }, { clearLines: 1 });
  const inLine = rowAt(on, 5, 7);
  const beside = rowAt(on, 7, 7);
  const stay = on.find((r) => r.how === 'stay');
  check('WITH THE SKILL: a plan that leaves the Rifle in the line is charged what the Porcupine\'s shot loses to the two dice',
    [inLine.length > 0, inLine.every((r) => r.lines > 0)], [true, true]);
  check('one that leaves it beside the line, or where it stands a Grid off it, is charged nothing',
    [beside.every((r) => r.lines === 0), stay?.lines], [true, 0]);
  check('and the charge is taken off what the plan is worth', inLine.every((r) => Math.abs(r.worth + r.lines - AI.weighed(turn, view, { clearLines: false }).find((x) => x.label === r.label)?.worth) < 1e-6), true);
}
{
  const off = AI.weighed(turn, view);
  check('without it (as it ships) nothing is charged', [off.every((r) => r.lines === 0), AI.SKILLS.clearLines], [true, false]);
}
{
  // An Aerial target is never Obstructed (4.2.4): with the Gun flying, no line costs anything.
  const flying = { ...view, units: view.units.map((u) => (u.uid === U.Gun.uid ? { ...u, aerial: true } : u)) };
  const air = AI.weighed(turn, flying, { clearLines: true }, { clearLines: 1 });
  check('a line to an Aerial target is never Obstructed: nothing charged', air.every((r) => r.lines === 0), true);
}
t.close();

console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
