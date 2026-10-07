// THE SQUAD'S DIALS CHOSEN TOGETHER (M18 S3: squad.ts chooseDials, the Tactician's skill `squadDials`; OTTO,
// 2026-10-07: "the CPU needs to start thinking as one", and "go ahead and start on S3").
//
// Each Mech's dial was set alone, on the board as it stands. Chosen together, the dials are tried on the round
// projected (each Mech planned on the table its allies, and the enemy's likeliest attacks, will have left it), and
// kept where the squad's worth rises. Staged on the real engine, the board of squadround.test: RDL's Blade (a Swift
// Steed) two Grids from a UN Tarantula Drone, RDL's Gun (an R-20 Railgun) six from it, UN's Rifle far off. Alone,
// both are dialled at the Drone: the Blade on Melee strikes it first, and the Gun's Firing then has nothing to shoot.
import { botTable, loadEngine } from './_engine.mjs';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}\n       got  ${g}`); }
};

console.log('The squad\'s dials chosen together\n');

const { M, data } = await loadEngine('squaddials', ["export * as SEAT from '../src/seat';", "export * as AI from '../src/ai/index';", "export * as HUD from '../src/matchhud';"]);
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
const scenario = { ...data.solo.scenarios[0], id: 't-squaddials', map: 'none', mission: 'none', seats: { s1: 't-ours', s2: 't-theirs' } };
const label = (x) => (x.cardId === '163' ? 'Drone' : x.label);
const place = (s) => {
  const U = Object.fromEntries(s.tokens.map((x) => [label(x), x]));
  const at = (x, c, r, f) => { x.col = c * 3; x.row = r * 3; if (f !== undefined) x.facing = f; };
  at(U.Blade, 4, 4, 2); at(U.Drone, 4, 6, 0); at(U.Gun, 2, 2, 2); at(U.Rifle, 10, 11, 0);
  return U;
};
const run = (it) => { for (;;) { const r = it.next(); if (r.done) return r.value; } };

// The round's Planning Phase, the board staged; the first dial question and the view.
async function planning(policy = AI.eagerPolicy) {
  const t = botTable(M, data, scenario, { seed: 5, policies: { s1: policy, s2: AI.makeTactician() }, glue: M.HUD.glueAfter });
  await t.run({ until: (st) => M.SU.normaliseSetup(st.setup)?.stage === 'done' && st.round.phase === 1 });
  const U = place(t.state);
  return { t, U, d: t.drivers.s1.pending(), view: M.SEAT.viewOf(data, t.state, 's1') };
}

{
  const { t, U, d, view } = await planning();
  let asked = 0;
  const base = AI.turnPlanner();
  const counting = (dq, v) => { asked += 1; return base(dq, v); };
  const dials = new Map([[U.Blade.uid, 'melee'], [U.Gun.uid, 'firing']]);
  const plain = run(AI.projectRound(d.here(), view, dials, base));
  const cache = new Map();
  const first = run(AI.projectRound(d.here(), view, dials, counting, AI.TACTICIAN, true, cache));
  const before = asked;
  const again = run(AI.projectRound(d.here(), view, dials, counting, AI.TACTICIAN, true, cache));
  const steps = (r) => r.steps.map((x) => [x.uid, x.timing, x.target, x.removed, Math.round(x.worth * 1e6)]);
  check('A ROUND KEPT (RoundCut): the same round projected with and without the cache; asked again, nothing is planned anew',
    [JSON.stringify(steps(first)) === JSON.stringify(steps(plain)), JSON.stringify(steps(again)) === JSON.stringify(steps(plain)), before > 0, asked - before], [true, true, true, 0]);
  const choice = run(AI.chooseDials(d.here(), view, new Map([[U.Blade.uid, ['melee', 'movement']], [U.Gun.uid, ['firing']]]), base));
  const chosen = run(AI.projectRound(d.here(), view, choice.dials, base));
  const onDrone = (r) => r.steps.filter((x) => x.mine && x.target === U.Drone.uid).length;
  check('CHOSEN TOGETHER, the Blade is moved off the Drone the Gun will shoot: its Movement dial, the Gun\'s Firing kept, the squad worth more than each alone',
    [choice.dials.get(U.Blade.uid), choice.dials.get(U.Gun.uid), choice.total > choice.alone + 0.01, choice.tried > 1], ['movement', 'firing', true, true]);
  check('and in the round it chose, one Mech of ours attacks the Drone, not two', onDrone(chosen), 1);
  t.close();
}
{
  // The skill in play: the Blade's dial question, answered by the Tactician with it and without.
  const off = await planning();
  const plain = AI.makeTactician().choose(off.d, off.view, new AI.Rng('dial'));
  off.t.close();
  const on = await planning();
  const together = AI.makeTactician({ squadDials: true }).choose(on.d, on.view, new AI.Rng('dial'));
  const timing = (q, c) => q.options.find((o) => o.id === c.option)?.tags.find((x) => x.startsWith('timing:'))?.slice(7);
  check('IN PLAY: alone the Blade is dialled Melee; with `squadDials` the same question answers Movement, the squad\'s choice',
    [on.d.unit === on.U.Blade.uid, timing(off.d, plain), plain.reason, timing(on.d, together), together.reason], [true, 'melee', 'dial_by_plan', 'movement', 'dial_by_squad']);
  on.t.close();
}
{
  // THE LOCK BEFORE THE GUN (S3's second form, the harm counted: 2026-10-07): the Rifle three Grids south of the
  // Blade, in reach of the Gun, the Drone far off. With the Blade's Melee first it ends beside the Rifle, which then
  // has no shot (a Melee Lock bars its Firing); with the Blade on Movement the Rifle fires first, at the Gun.
  const { t, U, d, view } = await planning();
  const at = (x, c, r, f) => { x.col = c * 3; x.row = r * 3; if (f !== undefined) x.facing = f; };
  at(U.Blade, 4, 4, 2); at(U.Rifle, 4, 7, 0); at(U.Gun, 2, 2, 2); at(U.Drone, 11, 0, 2);
  const v = M.SEAT.viewOf(data, t.state, 's1');
  const base = AI.turnPlanner();
  const rifle = (dials) => run(AI.projectRound(d.here(), v, new Map(dials), base)).steps.find((x) => x.uid === U.Rifle.uid);
  const locked = rifle([[U.Blade.uid, 'melee'], [U.Gun.uid, 'firing']]);
  const free = rifle([[U.Blade.uid, 'movement'], [U.Gun.uid, 'firing']]);
  check('THE LOCK BEFORE THE GUN: with the Blade\'s Melee first the Rifle, Locked, harms nobody; with the Blade on Movement it shoots first, at the Gun',
    [locked?.harm, locked?.target, free?.harm > 0.5, free?.target === U.Gun.uid], [0, null, true, true]);
  const choice = run(AI.chooseDials(d.here(), v, new Map([[U.Blade.uid, ['movement', 'melee']], [U.Gun.uid, ['firing', 'movement']]]), base));
  check('and chosen together from the Blade\'s Movement, its dial goes to Melee: the squad worth far more (the harm withheld)',
    [choice.dials.get(U.Blade.uid), choice.dials.get(U.Gun.uid), choice.total > choice.alone + 1], ['melee', 'firing', true]);
  t.close();
}
check('the skill ships off until it is measured', AI.SKILLS.squadDials, false);

console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
