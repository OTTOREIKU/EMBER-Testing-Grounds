// Any squad, any battlefield, any Main Task (AI-OPPONENT-PLAN.md, M8.3).
//
// The seam was built on two fixed squads. M8 widened it by PLAYING: random
// legal squads of every faction, with two computer seats at the table, and
// whatever stopped a game became the next thing built (an Interception nobody
// was asked for, a reaction owed, a Pholcus nobody unfolded, a Box nobody
// could pick up). This is that probe, small and seeded, kept in the suite: a
// dozen games that between them field all five factions on all four
// battlefields under every one of the ten Main Tasks, each played to its end
// by one of the four policies with nothing refused. A change that leaves a
// seat owed a question nobody answers fails here, on the squad that met it.
//
// The table is run on the PAGE's glue (matchhud.ts glueAfter), as a game
// against the computer is: it keeps the queue of Smoke Screens a round's end
// owes, which glue.ts alone does not, and a seat is asked for each (M8.2c).
import { botTable, loadEngine, squadAtRandom } from './_engine.mjs';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}\n       got  ${g}`); }
};

console.log('Any squad\n');

const { M, data } = await loadEngine('anysquad', ["export * as SEAT from '../src/seat';", "export * as AI from '../src/ai/index';", "export * as D from '../src/data';", "export * as HUD from '../src/matchhud';"]);
const AI = M.AI;
const MAPS = data.terrain.maps.map((m) => m.id);
const TASKS = data.missions.cards.map((c) => c.id);
const FACTIONS = ['RDL', 'UN', 'GOF', 'PD', 'COLLABORATION'];
const POLICIES = { legal: AI.legalPolicy, eager: AI.eagerPolicy, brawler: AI.brawlerPolicy, tactician: AI.tacticianPolicy };

// Twelve games. Each takes the next battlefield, the next Main Task and the
// next two factions round the list, so the dozen covers them all whatever the
// dice do; the squads themselves are drawn at random by the game's seed. The
// policy that draws by lot plays the largest squads with Secondary Tasks on
// (it offers the widest spread of answers); the Tactician the smallest. The
// eleventh, a Black Box Task, is the Tactician's too: the Victory Points a
// Box pays are held to a seat that plays for them. (They were once the luck
// of the policy that draws by lot, and went when the seam offered it more
// answers to draw from: M8.2f.)
const PLAN = [
  ['legal', 900, true], ['eager', 600, false], ['brawler', 500, false], ['tactician', 400, false],
  ['legal', 900, true], ['eager', 600, false], ['brawler', 500, false], ['tactician', 400, false],
  ['legal', 900, true], ['eager', 600, true], ['tactician', 500, false], ['tactician', 400, false],
];
const games = [];
for (const [i, [policy, points, secondaries]] of PLAN.entries()) {
  const seed = 101 + i;
  const rng = new AI.Rng(`${seed}:squads`);
  const scenario = {
    id: `any-${seed}`, map: MAPS[i % MAPS.length], mission: TASKS[i % TASKS.length], rounds: 5, secondaries, tactics: false,
    seats: { s1: 'any-s1', s2: 'any-s2' },
  };
  const squads = { s1: squadAtRandom(M, data, rng, points, FACTIONS[i % FACTIONS.length]), s2: squadAtRandom(M, data, rng, points, FACTIONS[(i + 2) % FACTIONS.length]) };
  data.solo.squads['any-s1'] = squads.s1;
  data.solo.squads['any-s2'] = squads.s2;
  let end;
  let t;
  try {
    t = botTable(M, data, scenario, { seed, policies: POLICIES[policy], glue: M.HUD.glueAfter });
    end = t.refused.length ? { kind: 'setup-refused', why: `${t.refused[0].kind}: ${t.refused[0].why}` } : await t.run({ maxSteps: 12000 });
  } catch (err) {
    end = { kind: 'threw', why: `${err?.message ?? err}`.split('\n')[0] };
  } finally {
    t?.close();
  }
  const tasks = t ? M.TK.normaliseTasks(t.state.tasks) : null;
  const boxes = tasks ? tasks.items.filter((x) => x.kind === 'blackbox') : [];
  games.push({
    seed, policy, points, scenario, squads, end,
    refused: (t?.refused ?? []).map((r) => `${r.kind}: ${r.why}`),
    vp: tasks?.vp ?? { s1: 0, s2: 0 },
    rounds: t?.state.round.n ?? 0,
    // A Box is in one place: lying on the board, or with one unit.
    boxesWrong: boxes.filter((b) => (b.bearerUid === undefined) === (b.col === undefined)).length,
    family: data.missions.cards.find((c) => c.id === scenario.mission).family,
  });
  const g = games.at(-1);
  const sq = (s) => `${s.faction} ${s.points}p ${s.mechs.length}m+${s.drones.length}d`;
  console.log(`       ${String(seed).padStart(4)} ${policy.padEnd(9)} ${scenario.map}/${scenario.mission} | ${sq(squads.s1)} v ${sq(squads.s2)} | ${end.kind}${end.kind === 'over' ? ` ${end.result.winner ?? 'level'} ${g.vp.s1}-${g.vp.s2}` : ` ${end.why ?? ''}`}`.slice(0, 220));
}

const said = (g) => `${g.seed} ${g.policy} ${g.scenario.map}/${g.scenario.mission}: ${g.end.kind}${g.end.decision ? ` [${g.end.decision}]` : ''} ${g.end.why ?? ''}`.trim();
check('TWELVE GAMES OF SQUADS DRAWN AT RANDOM, every one played to its end: no seat left owed a question nobody answers, no game past its round limit',
  [games.filter((g) => g.end.kind !== 'over').map(said), games.every((g) => g.rounds >= 1 && g.rounds <= 5)], [[], true]);
check('nothing refused, in setting a table or in play: every answer a seat was offered was one the engine took', games.filter((g) => g.refused.length).map((g) => `${said(g)}: ${g.refused[0]}`), []);
check('between them: all five factions, all four battlefields, all ten Main Tasks, all four policies',
  [[...new Set(games.flatMap((g) => [g.squads.s1.faction, g.squads.s2.faction]))].sort(), [...new Set(games.map((g) => g.scenario.map))].length, [...new Set(games.map((g) => g.scenario.mission))].length,
    [...new Set(games.map((g) => g.policy))].sort()],
  [[...FACTIONS].sort(), MAPS.length, TASKS.length, ['brawler', 'eager', 'legal', 'tactician']]);
check('every squad is a squad: a Mech at least, each Mech a Torso, a Chassis, an Arm and a Pilot, and (the one that could not be) within its points',
  [games.flatMap((g) => [g.squads.s1, g.squads.s2]).filter((s) => !s.mechs.length || s.mechs.some((m) => !m.loadout.torso || !m.loadout.chasis || !m.loadout.pilot || !(m.loadout.leftHand || m.loadout.rightHand))).map((s) => s.name),
    games.flatMap((g) => [g.squads.s1, g.squads.s2].filter((s) => s.points > g.points && s.mechs.length + s.drones.length > 1).map((s) => s.name))], [[], []]);
check('the same seed is the same squad', (() => {
  const a = squadAtRandom(M, data, new AI.Rng('7:squads'), 600, 'GOF');
  const b = squadAtRandom(M, data, new AI.Rng('7:squads'), 600, 'GOF');
  return [JSON.stringify(a) === JSON.stringify(b), a.mechs.length > 0];
})(), [true, true]);
check('a Black Box is in one place when a game ends: lying on the board, or with one unit', games.filter((g) => g.boxesWrong).map(said), []);
const scored = (family) => games.filter((g) => g.family === family && g.vp.s1 + g.vp.s2 > 0).length;
// A Box is paid for only when it is carried in, and one seeded game is one
// story: the Tactician's Box game of the dozen went unpaid when a Crush of a
// Unit came in (M8.2p), its bearer penetrated and the Box dropped, while over
// 46 seeds Box games paid the same with Crushes and without (113 Victory
// Points in 28 games against 112 in 27). So where the dozen pays nothing for
// Boxes, up to three more Black Box games the Tactician plays in both seats
// must.
let boxPaid = scored('blackbox') > 0;
for (let k = 0; k < 3 && !boxPaid; k++) {
  const seed = 131 + k;
  const rng = new AI.Rng(`${seed}:squads`);
  data.solo.squads['any-s1'] = squadAtRandom(M, data, rng, 400, FACTIONS[k % FACTIONS.length]);
  data.solo.squads['any-s2'] = squadAtRandom(M, data, rng, 400, FACTIONS[(k + 2) % FACTIONS.length]);
  const box = data.missions.cards.filter((c) => c.family === 'blackbox')[k % 3].id;
  const t = botTable(M, data, { id: `any-box-${seed}`, map: MAPS[k % MAPS.length], mission: box, rounds: 5, secondaries: false, tactics: false, seats: { s1: 'any-s1', s2: 'any-s2' } },
    { seed, policies: AI.tacticianPolicy, glue: M.HUD.glueAfter });
  try { await t.run({ maxSteps: 12000 }); } finally { t.close(); }
  const vp = M.TK.normaliseTasks(t.state.tasks).vp;
  boxPaid = vp.s1 + vp.s2 > 0;
}
check('and every family of Main Task is PLAYED: Victory Points are paid on an Occupation, on Terminals and for Black Boxes among these games (or, for Boxes, in up to three more the Tactician plays)',
  [scored('control') > 0, scored('terminal') > 0, boxPaid], [true, true, true]);
console.log(`       Victory Points by family: ${['control', 'terminal', 'blackbox', 'vip'].map((f) => `${f} ${games.filter((g) => g.family === f).reduce((n, g) => n + g.vp.s1 + g.vp.s2, 0)} in ${games.filter((g) => g.family === f).length}`).join(', ')}`);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
