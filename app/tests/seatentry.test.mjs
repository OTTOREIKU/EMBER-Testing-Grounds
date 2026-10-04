// A blow on the way home (AI-OPPONENT-PLAN.md, M10.2).
//
// The Tactician plans a Maneuver and the Movement Action behind it as one walk
// into a zone (tactician.ts `entryBy`), and until 2026-10-03 it did so only
// from a Grid where the Maneuver left nothing to do. A Black Box carrier with
// an enemy to strike on its way home was never planned on into the zone: in a
// game of random squads (seed 7815, Asset Preservation) the Lava's Maneuver
// into the Grid before Echo left it a Chop at a Drone, so no dial's plan went
// on into Echo, the dial was set to Melee (which opens no Sprint), and the Box
// that would have paid 4 Victory Points stayed in its hand. The skill
// `entryDeed` weighs going on into the zone beside acting there.
import { botTable, loadEngine } from './_engine.mjs';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}\n       got  ${g}`); }
};

console.log('A blow on the way home\n');

const { M, data } = await loadEngine('seatentry', ["export * as SEAT from '../src/seat';", "export * as AI from '../src/ai/index';", "export * as HUD from '../src/matchhud';"]);
const AI = M.AI;
const viewOf = (state, seat) => M.SEAT.viewOf(data, state, seat);

// RDL: the Lava of that game, whose Torso (RT-15B, 017) lets a Melee Short
// Action open an Opportunity on any dial (CQC): a Cleaver, and the Armored
// Chassis's Sprint. UN: a rifleman and a Tarantula Firepower Type (163), a
// Drone with no Melee Action, so it Melee Locks nobody and leaving it costs
// nothing (Break Away).
data.solo.squads['e-lava'] = { name: 'Lava', faction: 'RDL', points: 0, mechs: [{ name: 'Lava', loadout: { torso: '017', chasis: '534', leftHand: '535', pilot: 'FPA-03' } }], drones: [] };
data.solo.squads['e-un'] = { name: 'UN', faction: 'UN', points: 0, mechs: [{ name: 'Wolf', loadout: { torso: '539', chasis: '099', leftHand: '540', rightHand: '541', backpack: '538', pilot: 'LPA-23-2' } }], drones: [{ cardId: '163' }] };
const scenario = { ...data.solo.scenarios[0], id: 't-entry', mission: 'blackbox-asset-preservation', map: 'none', seats: { s1: 'e-lava', s2: 'e-un' } };
const gridOf = (x) => `${Math.floor(x.col / 3)},${Math.floor(x.row / 3)}`;

// Round 5, a Box in the Lava's Cleaver hand, the Lava at A6 facing east in
// Offensive Stance (a Maneuver of one Grid, a Sprint of four); the Tarantula
// at B7; the Wolf in the far corner. The Sprint alone ends a Grid short of
// Echo; only the Maneuver to B6 and the Sprint behind it (four Grids, to F6)
// put the Box in Echo, and from B6 the Cleaver also reaches the Tarantula.
// `phase`: the Planning Phase with the Lava's dial still to set, or its
// Opportunity open on the Movement dial (the Wolf has acted).
const table = async (phase, skills = {}) => {
  const policy = AI.makeTactician({ focus: false, ...skills });
  const t = botTable(M, data, scenario, { seed: 3, policies: { s1: policy, s2: AI.legalPolicy }, glue: M.HUD.glueAfter });
  await t.run({ until: (st) => M.SU.normaliseSetup(st.setup)?.stage === 'done' });
  const s = t.state;
  const U = Object.fromEntries(s.tokens.map((x) => [x.label.startsWith('ADK30F') ? 'Tarantula' : x.label, x]));
  const at = (x, c, r, f) => { x.col = c * 3; x.row = r * 3; if (f !== undefined) x.facing = f; };
  at(U.Lava, 0, 5, 1); at(U.Tarantula, 1, 6, 0); at(U.Wolf, 11, 11, 0);
  U.Lava.stance = 'offensive';
  const tasks = M.TK.normaliseTasks(s.tasks);
  const boxes = tasks.items.filter((i) => i.kind === 'blackbox');
  const far = [[11, 0], [10, 11], [10, 0], [11, 1]];
  boxes.forEach((b, i) => { b.col = far[i][0] * 3 + 1; b.row = far[i][1] * 3 + 1; b.bearerUid = undefined; b.bearerSlot = undefined; });
  Object.assign(boxes[0], { bearerUid: U.Lava.uid, bearerSlot: 'leftHand', col: undefined, row: undefined });
  s.tasks = tasks;
  s.round.n = 5; s.script.opp = null; s.script.passed = [];
  if (phase === 'planning') {
    s.round.phase = 1; s.script.stage = '5:1'; s.script.revealed = []; s.script.acted = [];
    for (const x of s.tokens) if (x.kind === 'mech') delete x.timing;
  } else {
    s.round.phase = 2; s.script.stage = '5:2'; s.script.revealed = ['s1', 's2'];
    U.Lava.timing = 'movement'; U.Wolf.timing = 'firing';
    s.script.acted = [U.Wolf.uid];
    M.G.opportunity(data, s);
  }
  return { t, s, U, box: boxes[0], d: t.drivers.s1.pending() };
};
const sprints = (d) => (d?.options ?? []).filter((o) => o.tags.includes('move') && o.facts?.actionId === '534_A');
const chops = (d) => (d?.options ?? []).filter((o) => /^Chop at ADK30F/.test(o.label));
const into = (rows) => rows.filter((p) => p.mission > 0.5);

// ---------- the table ----------
const on = await table('action');
const echo = new Set(viewOf(on.s, 's1').zones.find((z) => z.name === 'Echo').cells);
check('the staging: the Lava\'s Opportunity with a Box in its hand; Echo at F6 to G7 and out of the Sprint\'s reach from A6',
  [on.d.kind, on.d.unit === on.U.Lava.uid, viewOf(on.s, 's1').boxes.filter((b) => b.bearer === on.U.Lava.uid).length, echo.has('5,5'),
    sprints(on.d).length > 0, sprints(on.d).some((o) => echo.has(`${o.facts.to.c},${o.facts.to.r}`))],
  ['opp.act', true, 1, true, true, false]);
const toB6 = on.d.options.find((o) => o.tags.includes('maneuver') && o.tags.includes('facing:2') && o.facts?.to?.c === 1 && o.facts?.to?.r === 5);
check('the Maneuver to B6 (facing the Tarantula) leaves a Chop at it, on the Movement dial, and a Sprint into F6 behind it',
  [chops(toB6?.then?.()).length > 0, sprints(toB6?.then?.()).some((o) => o.facts.to.c === 5 && o.facts.to.r === 5)], [true, true]);

// ---------- the plans of the Opportunity ----------
const rowsOn = AI.weighed(on.d, viewOf(on.s, 's1'), { focus: false });
const rowsOff = AI.weighed(on.d, viewOf(on.s, 's1'), { focus: false, entryDeed: false });
const struck = (rows) => rows.find((p) => /^Lava: Maneuver to B6/.test(p.label) && !/, then /.test(p.label));
check('both ways, the Maneuver to B6 is planned for the Chop it leaves there (something to do in that Grid)',
  [(struck(rowsOn)?.now ?? 0) > 0, (struck(rowsOff)?.now ?? 0) > 0], [true, true]);
const home = into(rowsOn)[0];
check('WITH the skill the Maneuver to B6 also leads on: a plan into Echo by the Sprint behind it, worth the Box held there (4 Victory Points in the last round), and the best plan',
  [!!home && /^Lava: Maneuver to B6, facing \w+, then Lava: Sprint to F6/.test(home.label), Math.abs((home?.mission ?? 0) - 4) < 1e-9, rowsOn[0] === home], [true, true, true]);
check('WITHOUT it nothing is planned into Echo (the blow stops the walk), as before',
  into(rowsOff).length, 0);

// ---------- the Opportunity, played ----------
const steps = [];
for (let i = 0; i < 6 && on.s.script.opp; i++) {
  const step = await on.t.drivers.s1.step();
  if (step.kind !== 'acted') break;
  steps.push(step.option.label);
}
const lava = on.s.tokens.find((x) => x.uid === on.U.Lava.uid);
check('the Tactician plays it: the Maneuver, then the Sprint into Echo, the Box still in hand, and the Task pays the 4',
  [/^Lava: Maneuver to B6/.test(steps[0] ?? ''), /^Lava: Sprint to F6/.test(steps[1] ?? ''), echo.has(gridOf(lava)), on.box.bearerUid === lava.uid, M.S.previewScore(data, on.s, true).s1, on.t.refused],
  [true, true, true, true, 4, []]);
on.t.close();

// ---------- the dial (where the game of seed 7815 was lost) ----------
// The Movement dial is the one dial that opens a Sprint; the Chop opens any.
const dialOf = async (skills) => {
  const x = await table('planning', skills);
  const view = viewOf(x.s, 's1');
  const movement = x.d.options.find((o) => o.id === 'dial:movement');
  const plans = AI.weighed(movement.then(), view, { focus: false, ...skills });
  const pick = AI.makeTactician({ focus: false, ...skills }).choose(x.d, view, new AI.Rng('dial'));
  x.t.close();
  return { kind: x.d.kind, unit: x.d.unit === x.U.Lava.uid, intoEcho: into(plans).length > 0, pick: pick?.option };
};
const dialOn = await dialOf({});
const dialOff = await dialOf({ entryDeed: false });
check('the dial: WITH the skill the Movement dial\'s Opportunity has its plan into Echo and the Lava\'s dial is set to Movement',
  [dialOn.kind, dialOn.unit, dialOn.intoEcho, dialOn.pick], ['planning.dial', true, true, 'dial:movement']);
check('WITHOUT it no dial\'s plan goes into Echo and another dial is set, which opens no Sprint (seed 7815: Melee)',
  [dialOff.intoEcho, dialOff.pick !== 'dial:movement'], [false, true]);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
