// SIGHT BEFORE SAFETY (`sighted`, 2026-10-12; OTTO, watching the Veteran's UN squad: "They keep moving the porcupine
// away from a shooting angle so it's on the other side of the map unable to attack much"). The Porcupine's Single
// Shot reaches 12 Grids, so geometry claims a shot from every Grid its Move could take it to, and of those the Grids
// asked what it could do a turn later (`FUTURES`) were the safest, in its corner behind the buildings: none had a
// shot, and no Command was given. With the skill the board says who would be seen from each Grid (`seen`), and a
// Grid where no enemy its guns claim would be seen is asked about after the rest.
//
// Staged on the real engine, on the Intersection: UN's Porcupine in the corner it was deployed to in the VIP games,
// RDL's Gun across the buildings. The Command Phase's question, weighed as the Veteran weighs it.
import { botTable, loadEngine } from './_engine.mjs';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}\n       got  ${g}`); }
};

console.log('Sight before safety\n');

const { M, data } = await loadEngine('seatsighted', ["export * as SEAT from '../src/seat';", "export * as AI from '../src/ai/index';", "export * as HUD from '../src/matchhud';"]);
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
const scenario = { ...data.solo.scenarios[0], id: 't-sighted', map: 'crossroads', mission: 'none', seats: { s1: 't-ours', s2: 't-theirs' } };
const t = botTable(M, data, scenario, { seed: 5, policies: { s1: AI.eagerPolicy, s2: AI.eagerPolicy }, glue: M.HUD.glueAfter });
await t.run({ until: (st) => M.SU.normaliseSetup(st.setup)?.stage === 'done' });
const U = Object.fromEntries(t.state.tokens.map((x) => [x.cardId === '543' ? 'Porcupine' : x.label, x]));
const at = (x, c, r, f) => { x.col = c * 3; x.row = r * 3; x.facing = f; };
// (OTTO's games: the Porcupine at A12, the RDL Mechs at C2 and C3.)
const CORNER = { col: 0, row: 11 };
const UP = { col: 0, row: 7 };
at(U.Porcupine, CORNER.col, CORNER.row, 0); at(U.Rifle, 3, 11, 0); at(U.Gun, 2, 2, 2);
const d = t.drivers.s1.pending();
const view = M.SEAT.viewOf(data, t.state, 's1');
const porcupine = view.units.find((u) => u.uid === U.Porcupine.uid);
const gun = porcupine.weapons.find((x) => x.type === 'Firing');
const sight = d?.here?.().seen(U.Porcupine.uid, [CORNER, UP]) ?? [];
check('THE STAGE: the Command Phase asks who is given a Command; the Porcupine\'s Single Shot reaches the Gun from its corner by Range',
  [d?.kind, gun?.range >= 12, Math.abs(CORNER.col - 2) + Math.abs(CORNER.row - 2) <= gun?.range], ['loop.designate.command', true, true]);
check('and the board says the Gun would not see it in its corner, and would see it four Grids up the edge',
  [sight[0]?.includes(U.Gun.uid), sight[1]?.includes(U.Gun.uid)], [false, true]);
const designate = d.options.find((o) => o.tags.includes('designate') && o.facts?.uid === U.Porcupine.uid);
const turn = designate?.then?.();
const asked = (rows) => rows.filter((r) => r.priced && r.how === 'move');
{
  const SK = { ...AI.VETERAN_SKILLS, sighted: false };
  const rows = AI.weighed(turn, view, SK, AI.VETERAN_WEIGHTS);
  const choice = AI.makeTactician(SK, AI.VETERAN_WEIGHTS).choose(d, view, new AI.Rng('pick'));
  check('WITHOUT THE SKILL the Grids asked about a turn on have no shot, and no Command is given (as OTTO watched)',
    [asked(rows).every((r) => r.next === 0), choice.reason], [true, 'command_withheld']);
}
{
  const SK = { ...AI.VETERAN_SKILLS, sighted: true };
  const rows = AI.weighed(turn, view, SK, AI.VETERAN_WEIGHTS);
  const best = rows[0];
  const seenFrom = best ? d.here().seen(U.Porcupine.uid, [best.at])[0] ?? [] : [];
  const choice = AI.makeTactician(SK, AI.VETERAN_WEIGHTS).choose(d, view, new AI.Rng('pick'));
  check('WITH IT a Grid where the Gun would be seen is asked about, and has a shot a turn on: the best plan walks there',
    [best?.how, best?.next > 0, seenFrom.includes(U.Gun.uid)], ['move', true, true]);
  check('and the Command goes to the Porcupine', [choice.reason, choice.option === designate.id], ['command_by_value', true]);
}
check('as it ships (2026-10-12): on for every level',
  [AI.SKILLS.sighted, AI.VETERAN_SKILLS.sighted ?? AI.SKILLS.sighted, AI.BRAWLER_SKILLS.sighted ?? AI.SKILLS.sighted], [true, true, true]);
t.close();

console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
