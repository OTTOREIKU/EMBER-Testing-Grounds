// THE POSITION AS NUMBERS (M17 L1, the learned evaluator: src/ai/features.ts). One table as a seat sees it, read into
// one fixed list of numbers, the same for the probe that writes the training data and for the Ace in play.
//
// Staged on the real engine, the board of squaddials.test: RDL's Blade (a Swift Steed) and Gun (an R-20 Railgun)
// against UN's Rifle and a Tarantula Drone. Read from both seats of the same table, the two readings must mirror each
// other exactly: what is one seat's own is the other's other.
import { botTable, loadEngine } from './_engine.mjs';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}\n       got  ${g}`); }
};

console.log('The position as numbers\n');

const { M, data } = await loadEngine('features', ["export * as SEAT from '../src/seat';", "export * as AI from '../src/ai/index';", "export * as HUD from '../src/matchhud';"]);
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
const scenario = { ...data.solo.scenarios[0], id: 't-features', map: 'none', mission: 'none', seats: { s1: 't-ours', s2: 't-theirs' } };
const t = botTable(M, data, scenario, { seed: 5, policies: { s1: AI.eagerPolicy, s2: AI.eagerPolicy }, glue: M.HUD.glueAfter });
await t.run({ until: (st) => M.SU.normaliseSetup(st.setup)?.stage === 'done' && st.round.phase === 1 });
const U = Object.fromEntries(t.state.tokens.map((x) => [x.cardId === '163' ? 'Drone' : x.label, x]));
const at = (x, c, r, f) => { x.col = c * 3; x.row = r * 3; x.facing = f; };
at(U.Blade, 4, 4, 2); at(U.Drone, 4, 6, 0); at(U.Gun, 2, 2, 2); at(U.Rifle, 10, 11, 0);
const read = (seat) => AI.featureMap(M.SEAT.viewOf(data, t.state, seat));

{
  const view = M.SEAT.viewOf(data, t.state, 's1');
  const f = AI.featuresOf(view);
  check('ONE FIXED LIST: every name once, a number for each, every one finite',
    [new Set(AI.FEATURES).size === AI.FEATURES.length, f.length === AI.FEATURES.length, f.every((x) => typeof x === 'number' && Number.isFinite(x))], [true, true, true]);
  const m = read('s1');
  check('ON THE STAGED BOARD, from RDL\'s seat: two Mechs of its own and no Drone against a Mech and a Drone, round 1, no Main Task',
    [m.my_mechs, m.my_drones, m.their_mechs, m.their_drones, m.d_mechs, m.round, m.task_none, m.my_partsDestroyed], [2, 0, 1, 1, 1, 1, 1, 0]);
  check('and every unit standing whole: what it is worth is what it costs, the tiebreak count its Parts and Drones',
    [m.my_worth === m.my_points, m.their_worth === m.their_points, m.my_standing > 0, m.their_standing > 0], [true, true, true, true]);
}
{
  // THE MIRROR: the same table read from both seats.
  const a = read('s1');
  const b = read('s2');
  const sides = AI.FEATURES.filter((n) => n.startsWith('my_')).map((n) => n.slice(3));
  const flipped = sides.filter((n) => a[`my_${n}`] !== b[`their_${n}`] || a[`their_${n}`] !== b[`my_${n}`]);
  const diffs = AI.FEATURES.filter((n) => n.startsWith('d_')).filter((n) => a[n] !== -b[n]);
  const table = AI.FEATURES.filter((n) => !/^(my_|their_|d_)/.test(n) && n !== 'firstPlayer').filter((n) => a[n] !== b[n]);
  check('THE MIRROR: one seat\'s own is the other\'s other, each difference turned round, the table the same (the First Player one seat\'s)',
    [flipped, diffs, table, a.firstPlayer + b.firstPlayer], [[], [], [], 1]);
}
{
  // A MELEE LOCK: the Blade put beside the Rifle (a Grid apart, diagonally).
  at(U.Blade, 9, 10, 2);
  const a = read('s1');
  const b = read('s2');
  check('A MELEE LOCK, counted from both seats: the Rifle beside the Blade is UN\'s locked Mech, RDL\'s none',
    [b.my_locked, a.their_locked, a.my_locked === b.their_locked], [1, 1, true]);
  at(U.Blade, 4, 4, 2);
}
{
  // PACE: the Ace reads it in play (L3), inside the 2 s a decision; one reading must cost well under a millisecond.
  const view = M.SEAT.viewOf(data, t.state, 's1');
  const t0 = performance.now();
  for (let i = 0; i < 2000; i++) AI.featuresOf(view);
  const each = (performance.now() - t0) / 2000;
  check('PACE: a reading takes well under a millisecond', each < 0.5, true);
}
t.close();

console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
