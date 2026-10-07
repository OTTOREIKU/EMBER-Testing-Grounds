// THE ROUND AS PLANNED (M18, S1 and S2: src/ai/squad.ts; OTTO, 2026-10-07: "the CPU needs to start thinking as
// one", and "go ahead with S1 and S2").
//
// A squad's planned turns laid on copies of the table in the order the round will be played (by Timing, then
// Initiative, ties alternating from the First Player): each of ours planned by the Tactician on the table the turns
// before it leave, an attack laid by its odds (a target destroyed at better than even odds taken off the table for
// those after it), and the enemy's likeliest attack between. Staged on the real engine: RDL's Blade (a Swift Steed,
// a Melee dial) two Grids from a UN Tarantula Drone, RDL's Gun (an R-20 Railgun, a Firing dial) six Grids from it,
// UN's Rifle far off on the other side of the table.
import { botTable, loadEngine } from './_engine.mjs';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}\n       got  ${g}`); }
};

console.log('The round as planned\n');

const { M, data } = await loadEngine('squadround', ["export * as SEAT from '../src/seat';", "export * as AI from '../src/ai/index';"]);
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
const scenario = { ...data.solo.scenarios[0], id: 't-squadround', map: 'none', mission: 'none', seats: { s1: 't-ours', s2: 't-theirs' } };
const label = (x) => (x.cardId === '163' ? 'Drone' : x.label);

// The table at the round's Action Phase, the board staged, the Blade's Opportunity open; its own policies to play on.
async function staged(policies = AI.eagerPolicy) {
  const t = botTable(M, data, scenario, { seed: 5, policies });
  await t.run({ until: (st) => M.SU.normaliseSetup(st.setup)?.stage === 'done' && st.round.phase === 2 });
  const s = t.state;
  const U = Object.fromEntries(s.tokens.map((x) => [label(x), x]));
  const at = (x, c, r, f) => { x.col = c * 3; x.row = r * 3; if (f !== undefined) x.facing = f; };
  at(U.Blade, 4, 4, 2); at(U.Drone, 4, 6, 0); at(U.Gun, 2, 2, 2); at(U.Rifle, 10, 11, 0);
  for (const x of s.tokens) x.stance = 'offensive';
  U.Blade.timing = 'melee'; U.Gun.timing = 'firing'; U.Rifle.timing = 'firing';
  s.script.revealed = ['s1', 's2'];
  s.script.acted = [];
  s.script.opp = null;
  M.G.opportunity(data, s);
  return { t, s, U, d: t.drivers.s1.pending(), view: M.SEAT.viewOf(data, s, 's1') };
}
const plan = AI.turnPlanner();
const project = (d, view, dials, enemies = true) => {
  const it = AI.projectRound(d.here(), view, new Map(dials), plan, AI.TACTICIAN, enemies);
  for (;;) { const r = it.next(); if (r.done) return r.value; }
};

{
  const { t, U, d, view } = await staged();
  const name = (uid) => Object.keys(U).find((k) => U[k].uid === uid) ?? (uid === null ? null : String(uid));
  check('the view gives each Mech its Initiative off its pilot\'s card (Melee 2 and Firing 7 for FPA-11, Firing 5 for LPA-23-2)',
    [view.units.find((u) => u.uid === U.Blade.uid)?.init?.melee, view.units.find((u) => u.uid === U.Gun.uid)?.init?.firing, view.units.find((u) => u.uid === U.Rifle.uid)?.init?.firing], [2, 7, 5]);
  check('THE ORDER: the Blade\'s Melee first; then on Firing the Rifle (Initiative 5) before the Gun (7); the enemy\'s dial, hidden, taken as its gun\'s Firing',
    AI.roundOrder(view, new Map([[U.Blade.uid, 'melee'], [U.Gun.uid, 'firing']])).map((x) => [name(x.uid), x.timing, x.mine]),
    [['Blade', 'melee', true], ['Rifle', 'firing', false], ['Gun', 'firing', true]]);
  const alone = project(d, view, [[U.Gun.uid, 'firing']], false);
  const both = project(d, view, [[U.Blade.uid, 'melee'], [U.Gun.uid, 'firing']]);
  const step = (r, who) => r.steps.find((x) => x.uid === U[who].uid);
  check('ALONE, the Gun\'s plan is the Railgun on the Drone in its Range', name(step(alone, 'Gun')?.target), 'Drone');
  check('THE BLADE FIRST: its plan strikes the Drone and destroys it at better than even odds, so the Drone is off the table it leaves',
    [name(step(both, 'Blade')?.target), step(both, 'Blade')?.kill >= AI.ROUND_KILL, step(both, 'Blade')?.removed], ['Drone', true, true]);
  check('and the Gun, planned on that table, does not aim at the Drone', step(both, 'Gun')?.target === U.Drone.uid, false);
  check('THE ENEMY BETWEEN: the Rifle\'s turn is laid between them, its attack (if it has one) on a unit of ours',
    [both.steps.map((x) => name(x.uid)), [null, U.Blade.uid, U.Gun.uid].includes(step(both, 'Rifle')?.target ?? null)], [['Blade', 'Rifle', 'Gun'], true]);
  t.close();
  // THE SAME PLAN AS THE PLAY: the Blade acts first on this very board, so its projected turn is the turn the
  // Tactician plays.
  const real = await staged({ s1: AI.makeTactician(), s2: AI.eagerPolicy });
  await real.t.run({ until: (st) => st.script.acted.includes(real.U.Blade.uid), maxSteps: real.t.steps() + 80 });
  const grid = (x) => ({ col: Math.floor(x.col / 3), row: Math.floor(x.row / 3) });
  check('THE SAME AS THE PLAY: the Tactician, playing the Blade\'s Opportunity on the real table, ends it where the projection said',
    [grid(real.U.Blade), real.t.refused.length], [step(both, 'Blade')?.at ?? null, 0]);
  real.t.close();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
