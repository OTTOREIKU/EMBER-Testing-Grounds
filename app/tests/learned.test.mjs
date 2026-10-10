// THE LEARNED JUDGE (M17 L3: src/ai/learned.ts, and the Ace's weight `learned`). Trees trained offline on finished
// games read the chance a seat wins from the position it sees; the Ace prices a plan's walk by the change in that
// chance, `learned` times it.
//
// `learned.fixture.json` is a small model (12 trees of 7 leaves, trained on the M17 pilot's 340 games by
// scratchpad train_v.py and made compact by compact_v.py) with rows of numbers and LightGBM's own chance for each:
// the walk here must read the trees exactly as LightGBM does. Staged on the real engine, the board of squaddials.test.
// The judge the site ships (data/ai/judge-v4.json, learned.ts SHIPPED_JUDGE) is checked at the end.
import { readFileSync } from 'node:fs';
import { botTable, loadEngine } from './_engine.mjs';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}\n       got  ${g}`); }
};

console.log('The learned judge\n');

const { M, data } = await loadEngine('learned', ["export * as SEAT from '../src/seat';", "export * as AI from '../src/ai/index';", "export * as HUD from '../src/matchhud';"]);
const AI = M.AI;
const fixture = JSON.parse(readFileSync(new URL('./learned.fixture.json', import.meta.url), 'utf8'));

{
  // loadEngine sets the judge the site ships, as the page does for a game with the Ace; these start from none.
  AI.useModel(null);
  const shuffled = { ...fixture, names: [...fixture.names].reverse() };
  const short = { ...fixture, names: fixture.names.slice(1) };
  check('A MODEL OF OTHER NUMBERS IS REFUSED: its names in another order, or one short, and nothing is set',
    [AI.useModel(shuffled), AI.useModel(short), AI.hasModel(), AI.judgeFeatures(fixture.check[0].f)], [false, false, false, null]);
  check('the fixture\'s names are the first reading\'s numbers, in order (the model of the first data nights)',
    [fixture.names.length === AI.FIRST_READING, JSON.stringify(fixture.names) === JSON.stringify(AI.FEATURES.slice(0, AI.FIRST_READING))], [true, true]);
  const gap = { ...fixture, names: [...fixture.names.slice(0, 10), ...fixture.names.slice(11)] };
  check('a model missing a number in the middle is refused (the rest would be read one place off)', AI.useModel(gap), false);
  check('and the fixture is taken: a model of the first reading reads the first reading alone', [AI.useModel(fixture), AI.hasModel()], [true, true]);
  const worst = Math.max(...fixture.check.map((c) => Math.abs(AI.judgeFeatures(c.f) - c.p)));
  check(`THE TREES READ AS LIGHTGBM READS THEM: ${fixture.check.length} rows, every chance LightGBM's own`, [fixture.check.length >= 20, worst < 1e-12], [true, true]);
}

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
const scenario = { ...data.solo.scenarios[0], id: 't-learned', map: 'none', mission: 'none', seats: { s1: 't-ours', s2: 't-theirs' } };
const t = botTable(M, data, scenario, { seed: 5, policies: { s1: AI.eagerPolicy, s2: AI.makeTactician() }, glue: M.HUD.glueAfter });
await t.run({ until: (st) => M.SU.normaliseSetup(st.setup)?.stage === 'done' && st.round.phase === 1 });
const U = Object.fromEntries(t.state.tokens.map((x) => [x.cardId === '163' ? 'Drone' : x.label, x]));
const at = (x, c, r, f) => { x.col = c * 3; x.row = r * 3; x.facing = f; };
at(U.Blade, 4, 4, 2); at(U.Drone, 4, 6, 0); at(U.Gun, 2, 2, 2); at(U.Rifle, 10, 11, 0);
const view = M.SEAT.viewOf(data, t.state, 's1');
{
  const v = AI.judge(M.SEAT.lookOf(data, t.state, 's1'));
  check('ON THE STAGED BOARD the judge reads a chance, between nothing and certain', [typeof v === 'number', v > 0 && v < 1], [true, true]);
}
{
  // IN THE ACE: the Blade's turn on the Melee Timing (its dial question's Melee answer opens it), its plans weighed
  // with `learned` at 0 and at 40. The fixture's trees read only the score (worth, Victory Points, the Parts standing),
  // which no walk on this empty board changes; so the Ace is given a model of its own, one that reads how near the
  // squad's Mechs stand to the enemy (`my_near`, the nearer the better), three trees.
  const near = AI.FEATURES.indexOf('my_near');
  const step = (x, v) => ({ f: [near, -1, -1], t: [x], l: [1, -1, -1], r: [2, -1, -1], v: [0, v, -v] });
  check('a model of its own, reading how near the squad stands, is taken', AI.useModel({ names: [...AI.FEATURES], trees: [step(2.5, 0.3), step(3.5, 0.3), step(4.5, 0.3)] }), true);
  const dialQ = t.drivers.s1.pending();
  const turn = dialQ.options.find((o) => o.tags.includes('timing:melee'))?.then?.();
  const rows = (learned) => AI.weighed(turn, view, {}, { learned });
  const stay = (rs) => rs.find((r) => r.how === 'stay')?.worth;
  const off = rows(0);
  const on = rows(40);
  const moved = on.filter((r) => r.priced && r.how !== 'stay' && off.some((o) => o.label === r.label && o.priced && Math.abs(o.worth - r.worth) > 1e-9));
  check('IN THE ACE: with `learned`, a plan that walks is worth more or less by where it leaves the squad; staying, the same',
    [stay(off) === stay(on), moved.length > 0], [true, true]);
  // THE FIXTURE'S OWN TREES read the score; a plan whose deed may destroy the Drone is worth the chance it raises.
  AI.useModel(fixture);
  const scored = rows(40);
  const strikes = scored.filter((r) => r.priced && /Drone|ADK|Tarantula/i.test(r.does) && off.some((o) => o.label === r.label && o.priced && o.worth < r.worth - 1e-9));
  check('THE SCORE\'S TREES: a plan that may destroy the Drone is worth more by the chance the squad wins gaining from it',
    [strikes.length > 0, stay(scored) === stay(off)], [true, true]);
  AI.useModel(null);
  const none = rows(40);
  check('and with no model set, `learned` changes nothing', JSON.stringify(none) === JSON.stringify(off), true);
  check('the weight ships at 10 (ADOPTED 2026-10-10: the third data night\'s judge, v4)', AI.TACTICIAN.learned, 10);
}
{
  // THE JUDGE THE SITE SHIPS (data/ai/judge-v4.json): taken, every one of its numbers features.ts's, in order; a change
  // to features.ts that moves one of them would leave the Ace on the page without it, and is stopped here.
  const shipped = JSON.parse(readFileSync(new URL(`../../data/${AI.SHIPPED_JUDGE}`, import.meta.url), 'utf8'));
  check('THE SHIPPED JUDGE is taken: v4, all 144 numbers of the third reading, in features.ts\'s order',
    [AI.useModel(shipped), shipped.names.length, AI.hasModel()], [true, 144, true]);
  check('it reads a chance on the staged board', (() => { const v = AI.judge(M.SEAT.lookOf(data, t.state, 's1')); return typeof v === 'number' && v > 0 && v < 1; })(), true);
  check('the Ace reads it; the Veteran, the Brawler and the Recruit do not (each was measured without it)',
    [AI.tacticianPolicy, AI.veteranPolicy, AI.brawlerPolicy, AI.recruitPolicy].map((p) => !!p.judge), [true, false, false, false]);
  check('it lies in a folder of its own, out of the data files the service worker fetches for every visitor (sw.js reads the folder\'s top)',
    AI.SHIPPED_JUDGE.startsWith('ai/'), true);
}
t.close();

console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
