// WHAT WINS THE GAME (AI-OPPONENT-PLAN.md, M9.6): Victory Points decide it,
// and level on them the Mech Parts and Drones left on the board (5.2.4). The
// Tactician's price list is in Victory Points; `stakes` adds the game itself,
// at how sure the margin the Main Task is heading for is to hold
// (evaluate.ts stakesOf). Off (0) unless a measurement puts it on.
import { loadEngine, tableAtRoundOne } from './_engine.mjs';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}\n       got  ${g}`); }
};

console.log('What wins the game\n');

const { M, data } = await loadEngine('stakes', ["export * as SEAT from '../src/seat';", "export * as AI from '../src/ai/index';", "export * as TASKS from '../src/tasks';", "export * as SCORING from '../src/scoring';"]);
const { TACTICIAN, missionOf, stakesOf, standingFor } = M.AI;
const W = TACTICIAN;
const near = (a, b, e = 1e-9) => Math.abs(a - b) < e;

// ---------- views written out (as tactician.test writes them) ----------
const part = (slot, points, state = 'intact') => ({ slot, cardId: slot, state, armor: 4, structure: 1, points, repaired: false });
const unit = (uid, side, kind, col, row, more = {}) => {
  const parts = kind === 'mech' ? ['torso', 'chasis', 'leftHand', 'rightHand', 'backpack'].map((s) => part(s, 20)) : [part('main', more.points ?? 60)];
  return {
    uid, side, kind, cardId: 'x', label: `${kind} ${uid}`, grid: { col, row }, cell: { col: col * 3, row: row * 3 }, size: kind === 'mech' ? 3 : 1, facing: 0,
    deployed: true, alive: true, stance: 'offensive', link: kind === 'mech' ? 4 : undefined, linkMax: kind === 'mech' ? 4 : undefined, dialHidden: false, statuses: [],
    aerial: false, ground: true, locks: kind === 'mech', camouflaged: false, parts, health: 1, points: kind === 'mech' ? 110 : (more.points ?? 60),
    weapons: [], maneuver: kind === 'mech' ? 1 : 0, move: kind === 'mech' ? 1 : 5, commander: false, charged: [], lowValue: false, done: false, hands: 1, ...more,
  };
};
const viewOf = (units, more = {}) => ({
  seat: 's1', other: 's2', round: 5, roundLimit: 5, phase: 2, phaseName: 'Action', firstPlayer: 's1', setup: 'done', mission: null, task: null, noSecondary: true,
  units, zones: [], boxes: [], vp: { s1: 0, s2: 0 }, commandTokens: { s1: 0, s2: 0 }, opportunity: null, ...more,
});
const BOX = { family: 'blackbox', vp: 4, fromRound: 1, cadence: 'at-end', perPart: 0, scoringZone: null, reach: 0 };
const ON = { ...W, stakes: 4, stakesSpread: 1 };

// ---------- off by default ----------
{
  const me = unit(1, 's1', 'mech', 0, 0);
  check('OFF BY DEFAULT: the weight is 0, and the Main Task is worth its Victory Points alone, as before',
    [W.stakes, missionOf(viewOf([me], { vp: { s1: 6, s2: 2 } }), W), stakesOf(viewOf([me], { vp: { s1: 6, s2: 2 } }), W, 4)], [0, 4, 0]);
}

// ---------- the tiebreak, counted as the engine counts it ----------
{
  const { state } = tableAtRoundOne(M, data, data.solo.scenarios[0]);
  const verdict = () => {
    const why = M.TASKS.gameResult(M.TASKS.normaliseTasks(state.tasks), state.tokens, M.SCORING.lowValueOf(data)).why;
    const m = /(\d+) to (\d+)$/.exec(why) ?? /on (\d+) Mech Parts/.exec(why);
    return m[2] === undefined ? [Number(m[1]), Number(m[1])] : [Number(m[1]), Number(m[2])];
  };
  const counted = () => { const v = M.SEAT.viewOf(data, state, 's1'); return [standingFor(v, 's1'), standingFor(v, 's2')]; };
  const before = [verdict(), counted()];
  const U = Object.fromEntries(state.tokens.map((t) => [t.label, t]));
  U.Mire.partStates = { ...U.Mire.partStates, leftHand: 'destroyed', backpack: 'destroyed' };
  U['Wild Cat'].partStates = { ...U['Wild Cat'].partStates, rightHand: 'destroyed', chasis: 'damaged' };
  const after = [verdict(), counted()];
  check('the tiebreak is counted as the engine counts it (tasks.ts gameResult): the copied Alley squads stand 10 to 8, and with Parts lost on both sides 8 to 7 (a Damaged Part still counts)',
    [before, after], [[[10, 8], [10, 8]], [[8, 7], [8, 7]]]);
}

// ---------- the game itself ----------
{
  const me = unit(1, 's1', 'mech', 0, 0);
  const foe = unit(2, 's2', 'mech', 9, 9);
  const drone = unit(3, 's2', 'drone', 9, 8);
  // A level game this squad would lose on the Parts (5 to 6), a Box lying loose
  // and the same Box carried: the last round, then the first.
  const loose = (more = {}) => viewOf([me, foe, drone], { task: BOX, boxes: [{ id: 'b', grid: { col: 1, row: 0 }, bearer: null }], ...more });
  const held = (more = {}) => viewOf([me, foe, drone], { task: BOX, boxes: [{ id: 'b', grid: null, bearer: 1 }], ...more });
  const gain = (w, more = {}) => missionOf(held(more), w) - missionOf(loose(more), w);
  check('a level game this squad would lose on its Parts: the Box that wins it is worth its 4 Victory Points and most of the game besides',
    [near(gain(W), 4), near(gain(ON), 4 + 4 * (Math.tanh(3.5) - Math.tanh(-0.5)), 1e-9), gain(ON) > 9], [true, true, true]);
  check('twenty Victory Points behind, the same Box changes nothing that matters: it is worth its 4 and next to nothing more',
    near(gain(ON, { vp: { s1: 0, s2: 20 } }), 4, 0.01), true);
  check('with the rounds still to play the doubt is greater: in round 1 of 5 the same Box is worth less on top of its Victory Points than in the last round',
    [gain(ON, { round: 1 }) - missionOf(held({ round: 1 }), W) < gain(ON) - 4, gain(ON, { round: 1 }) > missionOf(held({ round: 1 }), W)], [true, true]);
  // Whose a level game is.
  const level = (mine, theirs) => stakesOf(viewOf([...mine, ...theirs], { task: BOX }), ON, 0);
  check('a level game goes to the squad with more standing: worth the game to it, against it to the other, and nothing when the Parts are level too',
    [level([me], [foe, drone]) < 0, level([me, unit(4, 's1', 'drone', 0, 1)], [foe]) > 0, level([me], [foe])], [true, true, 0]);
  // The walk's lever (`swingOf`): what a gain on the margin is worth with the game on top.
  const lost = viewOf([me, foe, drone], { task: BOX });
  check('A WALK\'S GAIN WITH THE GAME ON TOP (swingOf): exactly the gain while stakes is 0; in a level game lost on the Parts, a Box\'s 4 is worth the game besides; twenty behind, its 4',
    [M.AI.swingOf(lost, W, 0, 4), near(M.AI.swingOf(lost, ON, 0, 4), 4 + 4 * (Math.tanh(3.5) - Math.tanh(-0.5))), near(M.AI.swingOf(lost, ON, -20, 4), 4, 0.01)], [4, true, true]);
  const two = viewOf([me, foe, drone], { task: BOX, vp: { s1: 2, s2: 0 } });
  check('the game is the same game to both seats: what it is worth to one it costs the other',
    near(stakesOf(two, ON, 2) + stakesOf({ ...two, seat: 's2', other: 's1' }, ON, -2), 0), true);
  check('a Low Value unit, a destroyed one and one still waiting to deploy count nothing in the tiebreak',
    standingFor(viewOf([me, { ...drone, lowValue: true }, { ...drone, uid: 5, alive: false }, { ...drone, uid: 6, deployed: false }, { ...foe, side: 's1', uid: 7, parts: [part('torso', 20, 'destroyed'), part('chasis', 20, 'damaged'), part('leftHand', 20)] }]), 's1'),
    5 + 2);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
