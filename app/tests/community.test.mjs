// SQUADS PLAYERS BUILT (AI-OPPONENT-PLAN.md, "OTTO'S COMMUNITY SQUADS"). The
// goal is a player's own squad against a computer playing a custom squad, and
// OTTO saves the builds other players use on the Discord. Six of them, as the
// builder exported them (a 900-point list each but one, every allegiance's
// Parts as they were chosen: four melee Mechs, five Mechs and two Hyenas, a
// Tarantula carrying a Pholcus Mine Rack, hired PD Drones), played here by the
// Ace on both seats, each pairing on a different battlefield and Main Task:
// each game played to its end, nothing the computer sent refused, and each
// squad attacking. A change that leaves a real squad stuck fails here.
import { botTable, dealt, loadEngine } from './_engine.mjs';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}\n       got  ${g}`); }
};

console.log('Squads players built\n');

const { M, data } = await loadEngine('community', ["export * as SEAT from '../src/seat';", "export * as AI from '../src/ai/index';", "export * as HUD from '../src/matchhud';"]);
const AI = M.AI;
const mech = (name, torso, chasis, leftHand, rightHand, backpack, pilot) => ({ name, loadout: Object.fromEntries(Object.entries({ torso, chasis, leftHand, rightHand, backpack, pilot }).filter(([, v]) => v)) });
const SQUADS = {
  'UN-2': { name: 'UN-2', faction: 'UN', mechs: [mech('UN-2 1', '096', '100', '103', '124', '083', 'LPA-21'), mech('UN-2 2', '092', '099', '111', '113', '085', 'LPA-19'), mech('UN-2 3', '094', '099', '107', '122', '087', 'LPA-24')], drones: [{ cardId: '163' }, { cardId: '164' }, { cardId: '166' }, { cardId: '162', backpack: '082' }] },
  'Top_Core_RDL': { name: 'Top_Core_RDL', faction: 'RDL', mechs: [mech('Top 1', '014', '020', '034', '027', '003', 'FPA-14'), mech('Top 2', '012', '021', '032', '033', null, 'FPA-02'), mech('Top 3', '012', '020', '023', '027', '001', 'FPA-10'), mech('Top 4', '012', '021', '029', '036', '001', 'FPA-09'), mech('Top 5', '012', '020', '029', '030', '001', 'FPA-01')], drones: [{ cardId: '078' }, { cardId: '079' }] },
  'HeavyDisruption': { name: 'HeavyDisruption', faction: 'UN', mechs: [mech('Heavy 1', '097', '099', '107', '106', '089', 'LPA-22'), mech('Heavy 2', '096', '100', '144', '140', '090', 'LPA-19'), mech('Heavy 3', '091', '099', '139', '113', '082', 'LPA-20')], drones: [{ cardId: '165' }, { cardId: '160' }, { cardId: '543' }, { cardId: '163' }] },
  'RDL_Melee1': { name: 'RDL_Melee1', faction: 'RDL', mechs: [mech('Melee 1', '016', '022', '062', '036', '001', 'FPA-03'), mech('Melee 2', '017', '022', '062', '063', '010', 'FPA-05'), mech('Melee 3', '015', '022', '520', '063', '010', 'FPA-04'), mech('Melee 4', '018', '022', null, '048', '009', 'FPA-01')], drones: [] },
  'New_Squad_2': { name: 'New_Squad_2', faction: 'UN', mechs: [mech('Nsq 1', 'TM35NA', '099', '126', '148', '090', 'LPA-19'), mech('Nsq 2', 'TM39D', '099', '126', '122', '082', 'LPA-33'), mech('Nsq 3', '097', '099', '146', '133', '083', 'LPA-20')], drones: [{ cardId: 'PRDR-101' }, { cardId: 'PRDR-202' }, { cardId: '160' }] },
  'silent_nonsense': { name: 'silent_nonsense', faction: 'UN', mechs: [mech('Silent 1', '096', '100', '131', '124', '083', 'LPA-24'), mech('Silent 2', '247', '100', '540', '127', '538', 'LPA-21'), mech('Silent 3', '098', '101', '144', '148', '090', 'LPA-20')], drones: [] },
};
for (const [id, sq] of Object.entries(SQUADS)) data.solo.squads[`community:${id}`] = sq;

check('EVERY CARD OF THE SIX IS ONE THE DATA KNOWS',
  Object.values(SQUADS).flatMap((s) => [...s.mechs.flatMap((m) => Object.values(m.loadout)), ...s.drones.flatMap((d) => [d.cardId, d.backpack].filter(Boolean))]).filter((id) => !data.byId.get(id)), []);

const GAMES = [
  { s1: 'UN-2', s2: 'Top_Core_RDL', map: 'crossroads', mission: 'vip-commander-assassination', seed: 1 },
  // Deployed as dealt before a squad could deploy where its own units waited (_engine.mjs dealt): dealt anew, RDL_Melee1
  // starts in the corner and wins 8 to 4 on the Boxes without one attack, a game that says nothing about being stuck.
  { s1: 'HeavyDisruption', s2: 'RDL_Melee1', map: 'alley', mission: 'blackbox-key-facilities', seed: 2,
    dealt: [['s1', 4, 3, 0, null, 0], ['s1', 7, 3, 1, null, 0], ['s1', 5, 2, 1, null, 0], ['s1', 6, 1, 1, null, 0], ['s1', 3, 2, 0, 'offensive', 0], ['s1', 1, 0, 1, 'offensive', 0], ['s1', 2, 4, 1, 'offensive', 0],
      ['s2', 11, 3, 10, 'offensive', 0], ['s2', 8, 4, 10, 'offensive', 0], ['s2', 10, 2, 10, 'offensive', 0], ['s2', 9, 5, 10, 'offensive', 0]] },
  { s1: 'New_Squad_2', s2: 'silent_nonsense', map: 'steelworks', mission: 'terminal-signal-reception', seed: 3 },
];
for (const g of GAMES) {
  const scenario = { id: `community-${g.seed}`, map: g.map, mission: g.mission, rounds: 5, secondaries: false, tactics: false, seats: { s1: `community:${g.s1}`, s2: `community:${g.s2}` } };
  const policies = g.dealt ? { s1: dealt(AI.tacticianPolicy, 's1', g.dealt), s2: dealt(AI.tacticianPolicy, 's2', g.dealt) } : AI.tacticianPolicy;
  const t = botTable(M, data, scenario, { seed: g.seed, policies, glue: M.HUD.glueAfter });
  const end = await t.run({ maxSteps: 12000 });
  const attacked = ['s1', 's2'].map((s) => t.drivers[s].log.some((e) => String(e.option).startsWith('attack:')));
  check(`${g.s1} AGAINST ${g.s2} (${g.mission}, ${g.map}): played to its end, nothing refused, both squads attacking`,
    [end.kind, t.refused.length, attacked], ['over', 0, [true, true]]);
  t.close();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
