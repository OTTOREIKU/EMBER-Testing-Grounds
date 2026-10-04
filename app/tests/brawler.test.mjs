// The Brawler (src/ai/brawler.ts): AI-OPPONENT-PLAN.md, M6 and section 5.
//
// The Brawler is Watermelon's solo opponent rebuilt rule for rule: his ladder,
// his scoring, his numbers. So this file is one staged position for each rung
// of the ladder and each row of the scoring, and says which answer the policy
// takes there and by which rule (its reason code).
//
// Three kinds of position:
//   1. ON THE ENGINE. A table is staged, the question is the one the seat's
//      driver would hand the policy (the odds on its attacks, what each answer
//      leads to), and what is expected is worked out here from those same
//      answers: "the attack worth most" is found by weighing every attack on
//      offer, not by naming one.
//   2. BY HAND. Questions written out, with the odds given: the rules of an
//      attack in mid-roll (a Parry, a Focus, a reroll), where the numbers that
//      matter are the forecasts themselves.
//   3. WHOLE GAMES. The Brawler against itself and against the eager policy,
//      to the end, with nothing refused.
import { botTable, loadEngine, tableAtRoundOne } from './_engine.mjs';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}\n       got  ${g}`); }
};

console.log('The Brawler\n');

const { M, data } = await loadEngine('brawler', ["export * as SEAT from '../src/seat';", "export * as TURN from '../src/turn';", "export * as AI from '../src/ai/index';"]);
const { brawlerPolicy, BRAWLER, targetScore, attackWorth } = M.AI;
const [alley, vip] = data.solo.scenarios;
const clone = (x) => JSON.parse(JSON.stringify(x));
const name = (t) => (t.label.startsWith('ADK15P') ? 'Porcupine' : t.label.startsWith('ADK60S') ? 'Raven' : t.label.startsWith('ADK30C') ? 'Tarantula' : t.label);
const near = (a, b) => Math.abs(a - b) < 1e-9;
const rng = new M.AI.Rng('brawler');

// ---------- a table to play on ----------
const base = (() => {
  const t = tableAtRoundOne(M, data, alley);
  if (t.refused.length) throw new Error(t.refused.join('; '));
  return t.state;
})();
// The squads on an open board, the Action Phase unless `over` says otherwise:
// the Mire facing the Wild Cat across one Grid, the others about them.
const stage = (over = () => {}) => {
  const s = clone(base);
  s.map = 'none';
  const U = Object.fromEntries(s.tokens.map((t) => [name(t), t]));
  const at = (t, c, r, f) => { t.col = c * 3; t.row = r * 3; if (f !== undefined) t.facing = f; };
  at(U.Mire, 5, 4, 1); at(U.Dune, 0, 0, 1); at(U['Wild Cat'], 7, 4, 3); at(U.Porcupine, 11, 11, 0); at(U.Raven, 11, 9, 3); at(U.Tarantula, 11, 7, 3);
  s.round.phase = 2; s.script.stage = '1:2'; s.script.acted = []; s.script.passed = []; s.script.opp = null;
  s.script.revealed = ['s1', 's2'];
  for (const t of s.tokens) if (t.kind === 'mech') { t.timing = 'firing'; t.stance = 'offensive'; }
  over(s, U, at);
  // The Action Opportunity of one Mech, the others having had theirs.
  const turnOf = (mech, timing) => {
    mech.timing = timing ?? mech.timing;
    s.script.acted = s.tokens.filter((x) => x.kind === 'mech' && x.uid !== mech.uid).map((x) => x.uid);
    s.script.opp = null;
    return M.G.opportunity(data, s);
  };
  // A Drone's or a Projectile's activation, in a phase of its own.
  const activate = (unit, phase, more = {}) => {
    s.round.phase = phase; s.script.stage = `1:${phase}`;
    s.script.opp = { ...M.TY.newOpportunity(unit.uid, undefined), ...more };
    return s.script.opp;
  };
  return { s, U, at, turnOf, activate };
};
// The question a seat is put on a table, as its driver hands it to a policy
// (the odds on the attacks, what each answer leads to), and the Brawler's
// answer to it.
function asked(s, seat) {
  M.L.setLocalSeat(seat);
  const send = (cmd) => { const v = M.C.perform(data, s, cmd); if (v.ok) M.G.glueAfter(data, s, cmd); return v; };
  const driver = new M.AI.Driver(seat, { data, state: () => s, send, roll: async () => [] }, brawlerPolicy, rng);
  const d = driver.pending();
  const view = M.SEAT.viewOf(data, s, seat);
  const c = d ? brawlerPolicy.choose(d, view, rng) : null;
  M.L.setLocalSeat(null);
  return { d, view, c, picked: d?.options.find((o) => o.id === c?.option) ?? null };
}
const unit = (view, uid) => view.units.find((u) => u.uid === uid);
// What an attack on offer is worth, by his sum.
const worthOf = (o, view) => attackWorth(o.chance(), unit(view, o.facts.targetUid));
const attacks = (d) => d.options.filter((o) => o.run?.routine === 'attack' && !o.tags.includes('spend-charge'));
const best = (list, score) => list.reduce((a, b) => (score(b) > score(a) + 1e-9 ? b : a));

// ---------- 1. his numbers ----------
check('his tuning table, by his names: what an attack is worth, the dial, a Command, an Automatic unit, a target that can be killed, where to stand, a paid reroll, the search',
  BRAWLER, {
    ELIMINATE_VALUE: 150, DESTROY_PART_VALUE: 50, DAMAGE_PART_VALUE: 25, DRONE_DAMAGE_SHARE: 0.5, ATTACK_BASE: 2, STANCE_UNLOCKS_SCORE: 1.8,
    INTENT_OPENING_SCORE: 10, REPOSITION_OPENING_SCORE: 1.5, COMMAND_OPPORTUNITY_PER_TARGET: 0.5, AUTO_ACTION_TARGET_SCORE: 0.5,
    TARGET_KILL_OPPORTUNITY_THRESHOLD: 0.5, ATTACK_GRID_SCORE: 1000, TARGET_COUNT_EPSILON: 0.001, THREAT_TIEBREAK_EPSILON: 0.001,
    MISSION_TIEBREAK_EPSILON: 0.0001, OBJECTIVE_POINT_TIER: 1, TASK_DISTANCE_WEIGHT: 0.02, PAID_REROLL_CHANCE: 0.25, PAID_REROLL_LINK: 2, BETTER_BY: 0.0001,
    LANDING_CELLS: 24, MOVEMENT_CELLS_PER_STEP: 8,
  });
{
  const f = (kill, destroy, damage) => ({ hit: 1, pen: 1, damage, destroy, kill, link: 0, parts: [], pick: null });
  const mech = { kind: 'mech', points: 200 };
  const drone = { kind: 'drone', points: 70 };
  check('an attack on a Mech is worth 150 for the unit eliminated, 50 for a Part destroyed, 25 for a Part Damaged, each by its chance',
    [attackWorth(f(1, 1, 0), mech), attackWorth(f(0, 1, 0), mech), attackWorth(f(0, 0, 1), mech), near(attackWorth(f(0.1, 0.4, 0.3), mech), 15 + 20 + 7.5), attackWorth(f(0, 0, 0), mech)],
    [200, 50, 25, true, 0]);
  check('and on a Drone, its points removed and half of them Damaged', [attackWorth(f(1, 1, 0), drone), attackWorth(f(0, 0, 1), drone), near(attackWorth(f(0.5, 0.5, 0.2), drone), 70 * 0.6)], [70, 35, true]);
  // His target score: four classes, then the health lost, then the Range.
  const t = (health, commander = false) => ({ health, commander });
  check('his target score puts the Commander it can kill first, then any unit it can kill, then the Commander, then the rest: "can kill" is half its health or less',
    [targetScore(t(0.5, true), 0), targetScore(t(0.5), 0), targetScore(t(1, true), 0), targetScore(t(1), 0)].map((x) => Math.floor(x / 100)), [4, 3, 2, 1]);
  check('within a class the more hurt comes first (ten for the whole of its health), and the nearer breaks what is left',
    [near(targetScore(t(0.3), 2), 300 + 7 + 1 / 3), near(targetScore(t(1), 2), 100 + 1 / 3), targetScore(t(0.2), 5) > targetScore(t(0.4), 1), targetScore(t(1), 1) > targetScore(t(1), 2),
      targetScore(t(0.51), 0) < 200],
    [true, true, true, true, true]);
}

// ---------- 2. the ladder: an Action Opportunity ----------
{
  // ATTACK NOW. The Mire on its Firing dial, the Wild Cat two Grids ahead: the
  // gun's two Actions, and the Wild Cat the only target in the arc.
  const st = stage();
  st.turnOf(st.U.Mire, 'firing');
  const { d, view, c, picked } = asked(st.s, 's1');
  const top = best(attacks(d), (o) => worthOf(o, view));
  check('with an attack on offer it takes the one worth most by its odds, and says so',
    [d.kind, attacks(d).length > 1, c.option, c.reason, near(c.score, worthOf(top, view)), c.score > 0, picked.run.routine],
    ['opp.act', true, top.id, 'attack_result_value', true, true, 'attack']);
  check('  (the attacks on offer are not worth the same: it is the odds that choose)', new Set(attacks(d).map((o) => worthOf(o, view).toFixed(6))).size > 1, true);
}
{
  // Of two attacks worth the same, the better target. A hand-made question:
  // two Mechs, the same forecast on each, one of them at half its health.
  const view = { seat: 's1', units: [
    { uid: 1, side: 's1', kind: 'mech', grid: { col: 0, row: 0 }, facing: 1, deployed: true, alive: true, weapons: [], health: 1, points: 100, parts: [] },
    { uid: 2, side: 's2', kind: 'mech', grid: { col: 2, row: 0 }, deployed: true, alive: true, weapons: [], health: 1, points: 100, commander: false, parts: [] },
    { uid: 3, side: 's2', kind: 'mech', grid: { col: 3, row: 0 }, deployed: true, alive: true, weapons: [], health: 0.5, points: 100, commander: false, parts: [] },
  ], zones: [], opportunity: null };
  const f = { hit: 1, pen: 0.5, damage: 0.5, destroy: 0, kill: 0, link: 0, parts: [], pick: null };
  const shot = (uid) => ({ id: `attack:x:${uid}`, label: `x at ${uid}`, tags: ['attack'], run: { routine: 'attack', args: {} }, facts: { uid: 1, targetUid: uid }, chance: () => f });
  const d = { id: 'q', kind: 'opp.act', seat: 's1', unit: 1, options: [shot(2), shot(3), { id: 'end', label: 'End', tags: ['end'], commands: [] }], fallback: 'end', facts: {} };
  check('of two attacks worth the same, it takes the one on the better target: the unit at half its health, though it stands further off',
    [brawlerPolicy.choose(d, view, rng).option, brawlerPolicy.choose({ ...d, options: [shot(3), shot(2), d.options[2]] }, view, rng).option], ['attack:x:3', 'attack:x:3']);
  // An attack whose odds come to nothing is not made; one nobody could put
  // odds on still is.
  const dud = { ...shot(2), chance: () => ({ ...f, damage: 0, pen: 0 }) };
  const blind = { ...shot(2), chance: () => null };
  check('an attack that can do nothing is not made, and one the odds cannot read is still worth making',
    [brawlerPolicy.choose({ ...d, options: [dud, d.options[2]] }, view, rng).option, brawlerPolicy.choose({ ...d, options: [blind, d.options[2]] }, view, rng).reason], ['end', 'attack_result_value']);
}
{
  // A MOVE THAT REACHES A BETTER ATTACK. The Mire on its Melee dial with its
  // back to the Wild Cat, which stands in the Grid behind it: nothing to
  // attack as it stands, and the Chop one turn on the spot away.
  const st = stage((s, V, at) => { at(V.Mire, 5, 4, 3); at(V['Wild Cat'], 6, 4, 3); });
  st.turnOf(st.U.Mire, 'melee');
  const { d, view, c, picked } = asked(st.s, 's1');
  const after = picked.then(['attack']);
  const reached = best(attacks(after), (o) => worthOf(o, view));
  check('with nothing to attack as it stands, it takes the move after which the best attack can be made: here, the turn that puts the enemy behind it in its arc',
    [attacks(d).length, c.reason, picked.tags.includes('pivot'), picked.facts.facing, near(c.score, worthOf(reached, view)), reached.facts.actionId],
    [0, 'movement_unlocks_better_target', true, 1, true, '535_A']);
}
{
  // Attack now UNLESS a move reaches a strictly better one. The Mire on its
  // Firing dial, the Wild Cat in its sights: the same shot from another Grid
  // is no better, so it shoots from where it stands.
  const st = stage();
  st.turnOf(st.U.Mire, 'firing');
  const { d, view, c } = asked(st.s, 's1');
  const now = Math.max(...attacks(d).map((o) => worthOf(o, view)));
  const ahead = Math.max(0, ...d.options.filter((o) => o.tags[0] === 'move').flatMap((o) => attacks(o.then(['attack']) ?? { options: [] }).map((a) => worthOf(a, view))));
  check('a move that reaches an attack no better than the one on offer is not made: it attacks from where it stands',
    [ahead <= now + BRAWLER.BETTER_BY, c.reason], [true, 'attack_result_value']);
  // And where one move does reach a better attack, it moves first. From three
  // Grids the Burst is out of Range and the Single Shot is all there is; one
  // Grid nearer, the Burst is on.
  const far = stage((s, V, at) => { at(V['Wild Cat'], 9, 4, 3); });
  far.turnOf(far.U.Mire, 'firing');
  const q = asked(far.s, 's1');
  const here = Math.max(0, ...attacks(q.d).map((o) => worthOf(o, q.view)));
  const moves = q.d.options.filter((o) => o.tags[0] === 'move');
  const there = Math.max(0, ...moves.flatMap((o) => attacks(o.then(['attack']) ?? { options: [] }).map((a) => worthOf(a, q.view))));
  check('and where a move does reach a strictly better attack, the move comes first',
    [q.c.reason === (there > here + BRAWLER.BETTER_BY ? 'movement_unlocks_better_target' : 'attack_result_value'), q.c.score >= here - 1e-9, near(q.c.score, Math.max(here, there))],
    [true, true, true]);
}
{
  // A CHARGE IS NEVER SPENT. The Wild Cat's Ion Shotgun with its Charge up is
  // offered both ways; the Brawler weighs the plain attacks alone.
  const st = stage((s, V, at) => { V['Wild Cat'].charge = ['leftHand']; at(V['Wild Cat'], 6, 4, 3); });
  st.turnOf(st.U['Wild Cat'], 'firing');
  const { d, view, c } = asked(st.s, 's2');
  const spends = d.options.filter((o) => o.tags.includes('spend-charge'));
  const top = best(attacks(d), (o) => worthOf(o, view));
  check('an attack that spends a Charge is offered and never taken: the plain attack worth most is',
    [spends.length > 0, c.option, c.reason, spends.some((o) => o.id === c.option)], [true, top.id, 'attack_result_value', false]);
  const swift = stage((s, V, at) => { at(V['Wild Cat'], 11, 0, 3); });
  swift.turnOf(swift.U['Wild Cat'], 'swift');
  const q = asked(swift.s, 's2');
  check('nor is a Part ever Charged', [q.d.options.some((o) => o.tags[0] === 'charge'), q.picked.tags[0] === 'charge'], [true, false]);
}
{
  // A PROJECTILE TO LAUNCH. The Mire on its Projectile dial, the Wild Cat five
  // Grids off: no gun reaches, and a Missile put down inside its strike of
  // the Wild Cat does.
  const st = stage((s, V, at) => { at(V['Wild Cat'], 10, 4, 3); });
  st.turnOf(st.U.Mire, 'projectile');
  const { d, view, c, picked } = asked(st.s, 's1');
  const cat = st.U['Wild Cat'];
  const blast = picked.later(['attack']);
  const off = Math.abs(picked.facts.to.c - 10) + Math.abs(picked.facts.to.r - 4);
  check('a Projectile is launched where its blast is worth most: valued as an attack is, by the odds of the Explosion it would make from that Landing Point',
    [attacks(d).length, c.reason, picked.tags[0], off <= picked.facts.strike, near(c.score, Math.max(...attacks(blast).map((o) => worthOf(o, view)))), attacks(blast).every((o) => o.facts.targetUid === cat.uid)],
    [0, 'projectile_blast_value', 'launch', true, true, true]);
  const none = stage((s, V, at) => { at(V['Wild Cat'], 11, 11, 3); });
  none.turnOf(none.U.Mire, 'projectile');
  const q = asked(none.s, 's1');
  check('and never where it would reach nobody', [q.d.options.some((o) => o.tags[0] === 'launch'), q.picked.tags[0] === 'launch'], [true, false]);
}
{
  // A CHANGE OF STANCE THAT UNLOCKS AN ATTACK, and only then. By hand: a unit
  // with nothing to attack, and one Stance from which it could.
  const me = { uid: 1, side: 's1', kind: 'mech', grid: { col: 0, row: 0 }, facing: 1, deployed: true, alive: true, weapons: [], health: 1, points: 100, parts: [], stance: 'defensive' };
  const foe = { uid: 2, side: 's2', kind: 'mech', grid: { col: 9, row: 9 }, deployed: true, alive: true, weapons: [], health: 1, points: 100, commander: false, parts: [] };
  const view = { seat: 's1', units: [me, foe], zones: [], opportunity: null, phaseName: 'Action' };
  const f = { hit: 1, pen: 0.5, damage: 0.5, destroy: 0, kill: 0, link: 0, parts: [], pick: null };
  const shot = { id: 'attack:x:2', label: 'x at 2', tags: ['attack'], run: { routine: 'attack', args: {} }, facts: { uid: 1, targetUid: 2 }, chance: () => f };
  const stance = (id, next) => ({ id: `stance:${id}`, label: id, tags: ['stance', `stance:${id}`], commands: [{}], then: () => next });
  const end = { id: 'end', label: 'End', tags: ['end'], commands: [] };
  const d = { id: 'q', kind: 'opp.act', seat: 's1', unit: 1, options: [stance('mobility', null), stance('offensive', { options: [shot] }), end], fallback: 'end', facts: {} };
  const c = brawlerPolicy.choose(d, view, rng);
  check('a Stance is changed when the new one unlocks an attack it could not otherwise make',
    [c.option, c.reason, c.score], ['stance:offensive', 'preparation_unlocks_attack', BRAWLER.STANCE_UNLOCKS_SCORE]);
  check('and for no other reason: with no attack behind either Stance it ends its turn where it stands',
    brawlerPolicy.choose({ ...d, options: [stance('mobility', null), stance('offensive', null), end] }, view, rng).reason, 'end_activation');
  // On the engine: the Mire far from everything, free to change its Stance.
  const st = stage((s, V, at) => { at(V['Wild Cat'], 11, 0, 3); V.Mire.stance = 'defensive'; });
  st.turnOf(st.U.Mire, 'firing');
  const q = asked(st.s, 's1');
  check('on the table: a Mech with nobody in reach leaves its Stance alone', [q.d.options.some((o) => o.tags[0] === 'stance'), q.picked.tags[0] === 'stance'], [true, false]);
}
{
  // MOVE TOWARD CONTACT. The Mire on its Movement dial, the enemy across the
  // board: nothing to attack this turn, so it walks the road to the nearest
  // enemy, as far along it as one Movement goes.
  const st = stage((s, V, at) => { at(V.Mire, 0, 4, 1); at(V['Wild Cat'], 11, 4, 3); });
  st.turnOf(st.U.Mire, 'movement');
  const { d, c, picked } = asked(st.s, 's1');
  check('  (no Grid it can reach this turn is one it could attack from: the gun\'s Range is six, and the Sprint ends seven Grids off)',
    [c.score < BRAWLER.ATTACK_GRID_SCORE, Math.abs(picked.facts.to.c - 11) + Math.abs(picked.facts.to.r - 4)], [true, 7]);
  const roads = Object.values(d.facts.roads);
  const road = roads.reduce((a, b) => (b.length < a.length ? b : a));
  const onRoad = (o) => road.findIndex((g) => g.c === o.facts.to.c && g.r === o.facts.to.r);
  const furthest = Math.max(...d.options.filter((o) => o.tags[0] === 'move').map(onRoad));
  check('with nothing to attack and no attack one move away, it closes on the nearest enemy: the Movement that ends furthest along the road to it, facing along the road',
    [c.reason, onRoad(picked), furthest > 2, picked.facts.facing, picked.tags.includes('moving')], ['contact_before_occupation', furthest, true, 1, true]);
}
{
  // WHERE TO STAND is the engine's to confirm. The Porcupine under a Command,
  // the Mire six Grids up the column: its gun reaches from where it stands and
  // from most of the Grids it could move to, and it does not walk into the
  // Grids beside the Mech, where a Melee Lock would stop its fire.
  const st = stage((s, V, at) => { at(V.Mire, 5, 2, 2); at(V['Wild Cat'], 11, 0, 3); at(V.Porcupine, 5, 8, 0); });
  st.activate(st.U.Porcupine, 0, { commanded: true });
  const { d, view, c, picked } = asked(st.s, 's2');
  const mire = unit(view, st.U.Mire.uid);
  const end = picked.facts?.to ? { col: picked.facts.to.c, row: picked.facts.to.r } : unit(view, st.U.Porcupine.uid).grid;
  const beside = Math.abs(end.col - mire.grid.col) <= 1 && Math.abs(end.row - mire.grid.row) <= 1;
  check('a Drone sent a Command stands where the engine says it could take its shot: nearer its target, and never in a Grid beside the Mech',
    [d.kind, c.reason, beside, (picked.later?.(['attack'])?.options ?? []).map((o) => o.facts.targetUid), Math.abs(end.col - 5) + Math.abs(end.row - 2) < 6],
    ['activation.act', 'contact_before_occupation', false, [st.U.Mire.uid], true]);
  // With the Mire beside it already, the only Grids it can fire from are away.
  const locked = stage((s, V, at) => { at(V.Mire, 5, 7, 2); at(V['Wild Cat'], 11, 0, 3); at(V.Porcupine, 5, 8, 0); });
  locked.activate(locked.U.Porcupine, 0, { commanded: true });
  const q = asked(locked.s, 's2');
  const to = q.picked.facts?.to;
  check('Melee Locked where it stands, it moves to a Grid it could fire from, which is one that is not beside the Mech',
    [q.c.reason, !!to && (Math.abs(to.c - 5) > 1 || Math.abs(to.r - 7) > 1), (q.picked.later?.(['attack'])?.options ?? []).length > 0], ['contact_before_occupation', true, true]);
}
{
  // A wall is the engine's to see. By hand: a unit whose geometry says it can
  // attack from two Grids. The engine (`later`) says no to the nearer and yes
  // to the other, and it is the other it walks to.
  const gun = { slot: 'rightHand', actionId: 'g', name: 'Gun', type: 'Firing', timing: 'firing', range: 6, yellow: 0, red: 3, usable: true };
  const me = { uid: 1, side: 's1', kind: 'mech', grid: { col: 0, row: 0 }, facing: 1, deployed: true, alive: true, weapons: [gun], health: 1, points: 100, parts: [], ground: true, locks: true, timing: 'movement' };
  const foe = { uid: 2, side: 's2', kind: 'mech', grid: { col: 9, row: 0 }, deployed: true, alive: true, weapons: [], health: 1, points: 100, commander: false, parts: [], ground: true, locks: true };
  const view = { seat: 's1', units: [me, foe], zones: [], opportunity: null, phaseName: 'Action' };
  const shot = { id: 'attack:g:2', label: 'Gun at 2', tags: ['attack'], run: { routine: 'attack', args: {} }, facts: { uid: 1, targetUid: 2 } };
  const asks = [];
  const move = (c, sees) => ({
    id: `move:${c}`, label: `to ${c}`, tags: ['move'], commands: [{}], facts: { to: { c, r: 0 }, facing: 1 },
    then: () => null,
    later: (only, timing) => { asks.push(`${c}:${timing}`); return sees ? { options: [shot] } : null; },
  });
  const end = { id: 'end', label: 'End', tags: ['end'], commands: [{}], later: () => null };
  const d = { id: 'q', kind: 'opp.act', seat: 's1', unit: 1, options: [move(4, false), move(3, true), move(1, false), end], fallback: 'end', facts: { roads: { 2: [{ c: 1, r: 0 }, { c: 2, r: 0 }, { c: 3, r: 0 }, { c: 4, r: 0 }] } } };
  const c = brawlerPolicy.choose(d, view, rng);
  check('a Grid that looks like one it could attack from is put to the engine before it is walked to: behind a wall the nearer Grid is no such Grid, and the next is taken',
    [c.option, c.reason, c.score >= BRAWLER.ATTACK_GRID_SCORE, asks.includes('4:firing'), asks.includes('3:firing'), asks.some((x) => x.startsWith('1:'))],
    ['move:3', 'contact_before_occupation', true, true, true, false]);
  // The engine saying no to both, it falls back on the road.
  const blind = { ...d, options: [move(4, false), move(3, false), move(1, false), end] };
  check('and with no Grid the engine will vouch for, it walks the road as far as it goes', brawlerPolicy.choose(blind, view, rng).option, 'move:4');
  // Standing where it can already attack from, it stays.
  const here = { ...me, grid: { col: 3, row: 0 } };
  const settled = { ...d, options: [move(4, false), { ...end, later: () => ({ options: [shot] }) }] };
  check('a unit that already stands where it could attack from stays there', brawlerPolicy.choose(settled, { ...view, units: [here, foe] }, rng).reason, 'end_activation');
}
{
  // HIS "WHERE TO STAND", row by row. By hand, and with nobody to ask (these
  // answers say nothing of a later turn), so Range and arc are all there is:
  // a unit that has already acted, with one move left and a gun of Range 4.
  const gun = (range) => ({ slot: 'rightHand', actionId: 'g', name: 'Gun', type: 'Firing', timing: 'firing', range, yellow: 0, red: 3, usable: true });
  const me = { uid: 1, side: 's1', kind: 'mech', grid: { col: 0, row: 5 }, facing: 1, deployed: true, alive: true, weapons: [gun(4)], health: 1, points: 100, parts: [], ground: true, locks: true, timing: 'firing' };
  const foe = (uid, col, row, more = {}) => ({ uid, side: 's2', kind: 'mech', grid: { col, row }, facing: 3, deployed: true, alive: true, weapons: [], health: 1, points: 100, commander: false, parts: [], ground: true, locks: false, camouflaged: false, aerial: false, ...more });
  const move = (c, r, facing) => ({ id: `move:${c},${r}:${facing}`, label: '', tags: ['move'], commands: [{}], facts: { to: { c, r }, facing }, then: () => null });
  const end = { id: 'end', label: 'End', tags: ['end'], commands: [{}] };
  const stand = (foes, moves, zones = [], self = me) => brawlerPolicy.choose(
    { id: 'q', kind: 'opp.act', seat: 's1', unit: 1, options: [...moves, end], fallback: 'end', facts: {} },
    { seat: 's1', units: [self, ...foes], zones, opportunity: { performed: ['g'] }, phaseName: 'Action' }, rng);
  const A = foe(2, 8, 5);
  check('a Grid it could attack from beats every Grid it could not, however near the enemy the other is',
    [stand([A], [move(7, 9, 1), move(4, 5, 1)]).option, stand([A], [move(7, 9, 1), move(4, 5, 1)]).reason, stand([A], [move(4, 5, 1)]).score >= BRAWLER.ATTACK_GRID_SCORE],
    ['move:4,5:1', 'contact_before_occupation', true]);
  check('and it is facing its target there: the same Grid with its back to it is not such a Grid', stand([A], [move(4, 5, 3), move(4, 5, 1)]).option, 'move:4,5:1');
  // One Grid ahead and three to the side is ahead of it, and not in its arc.
  check('the Forward Arc is the quarter of the board in front, not the half: an enemy further to the side than it is ahead is in the arc of another facing',
    stand([foe(2, 6, 8)], [move(5, 5, 1), move(5, 5, 2)]).option, 'move:5,5:2');
  check('of two it could attack the same target from, the nearer', stand([A], [move(4, 5, 1), move(5, 5, 1)]).option, 'move:5,5:1');
  // A unit at half its health, further off, against a whole one nearby.
  const hurt = foe(3, 8, 0, { health: 0.5 });
  check('the better target decides before the Range does: a Grid that reaches the unit it can kill, though from further off',
    stand([A, hurt], [move(5, 5, 1), move(4, 0, 1)]).option, 'move:4,0:1');
  check('and the Commander it can kill before any other', stand([A, hurt, foe(4, 0, 9, { health: 0.5, commander: true })], [move(4, 0, 1), move(0, 6, 2)]).option, 'move:0,6:2');
  // The three tie-breaks, each a thousandth and less. Two Grids three from A.
  const second = foe(5, 7, 4);
  check('with the best target the same, the Grid it could attack more enemies from', stand([A, second], [move(11, 5, 3), move(5, 5, 1)]).option, 'move:5,5:1');
  const shooter = foe(6, 6, 9, { weapons: [gun(3)] });
  check('then the Grid fewer enemies could attack it in', stand([A, shooter], [move(8, 8, 0), move(5, 5, 1)]).option, 'move:5,5:1');
  const zones = [{ id: 'z', name: 'Z', cells: ['11,5'], holder: null, scoring: true }];
  check('and of two alike in all of that, a Grid the Main Task scores',
    [stand([A], [move(5, 5, 1), move(11, 5, 3)], zones).option, stand([A], [move(5, 5, 1), move(11, 5, 3)], [{ ...zones[0], scoring: false }]).option], ['move:11,5:3', 'move:5,5:1']);
  // What makes a Grid one it could NOT attack from.
  // The nearer Grid has an enemy beside it that could strike in Melee.
  const lock = foe(7, 7, 6, { locks: true });
  check('a Grid beside an enemy that could strike it in Melee is no Grid for a gun (a Melee Lock), though the target is in Range of it',
    [stand([A, lock], [move(5, 5, 1), move(6, 5, 1)]).option, stand([A, { ...lock, locks: false }], [move(5, 5, 1), move(6, 5, 1)]).option], ['move:5,5:1', 'move:6,5:1']);
  check('unless it flies: an Aerial unit is nobody\'s to lock, and an enemy in Optical Camouflage locks nobody',
    [stand([A, lock], [move(5, 5, 1), move(6, 5, 1)], [], { ...me, ground: false }).option, stand([A, { ...lock, camouflaged: true }], [move(5, 5, 1), move(6, 5, 1)]).option], ['move:6,5:1', 'move:6,5:1']);
  check('an enemy in Optical Camouflage is no target to stand for, and a gun out of Ammo reaches nobody',
    [stand([{ ...A, camouflaged: true }], [move(4, 5, 1)]).score < BRAWLER.ATTACK_GRID_SCORE, stand([A], [move(4, 5, 1)], [], { ...me, weapons: [{ ...gun(4), ammo: 0 }] }).score < BRAWLER.ATTACK_GRID_SCORE,
      stand([A], [move(4, 5, 1)], [], { ...me, weapons: [{ ...gun(4), usable: false }] }).score < BRAWLER.ATTACK_GRID_SCORE], [true, true, true]);
  const blade = { slot: 'leftHand', actionId: 'b', name: 'Blade', type: 'Melee', timing: 'melee', range: 0, yellow: 0, red: 3, usable: true };
  check('a Melee Action with no Range reaches the Grids beside its own, corner to corner, and never an Aerial unit',
    [stand([A], [move(6, 5, 1), move(7, 4, 1)], [], { ...me, weapons: [blade] }).option, stand([A], [move(7, 4, 1)], [], { ...me, weapons: [blade] }).score >= BRAWLER.ATTACK_GRID_SCORE,
      stand([{ ...A, aerial: true }], [move(7, 5, 1)], [], { ...me, weapons: [blade] }).score < BRAWLER.ATTACK_GRID_SCORE], ['move:7,4:1', true, true]);
  // Standing where it can attack from already, it moves only for a better Grid.
  const there = { ...me, grid: { col: 4, row: 5 } };
  check('already standing where it could attack from, it moves for a strictly better Grid and for nothing less',
    [stand([A], [move(4, 6, 1)], [], there).reason, stand([A], [move(5, 5, 1)], [], there).option], ['end_activation', 'move:5,5:1']);
  // With no Grid to attack from, the crow's line, where no road is known.
  check('with no Grid to attack from and no road known, the Grid nearest the enemy, turned to face it',
    [stand([foe(2, 11, 5)], [move(2, 5, 3), move(2, 5, 1), move(1, 5, 1)]).option, stand([foe(2, 11, 5)], [move(0, 5, 3)]).reason], ['move:2,5:1', 'end_activation']);
}
{
  // THE ORDER OF THE RUNGS, by hand, with the worths given: an attack on offer,
  // an attack one move away, and a Projectile to launch are weighed together,
  // each by what it is likely to destroy (here 25 for each point of damage).
  const gun = { slot: 'rightHand', actionId: 'g', name: 'Gun', type: 'Firing', timing: 'firing', range: 6, yellow: 0, red: 3, usable: true };
  const me = { uid: 1, side: 's1', kind: 'mech', grid: { col: 0, row: 0 }, facing: 1, deployed: true, alive: true, weapons: [gun], health: 1, points: 100, parts: [], ground: true, locks: true, link: 4, linkMax: 4, timing: 'firing' };
  const foe = { uid: 2, side: 's2', kind: 'mech', grid: { col: 4, row: 0 }, facing: 3, deployed: true, alive: true, weapons: [], health: 1, points: 100, commander: false, parts: [], ground: true, locks: false, camouflaged: false, aerial: false };
  const view = (self = me, more = []) => ({ seat: 's1', units: [self, foe, ...more], zones: [], opportunity: null, phaseName: 'Action' });
  const F = (damage) => ({ hit: damage > 0 ? 1 : 0, pen: damage, damage, destroy: 0, kill: 0, link: 0, parts: [], pick: null });
  const shot = (id, damage) => ({ id, label: id, tags: ['attack'], run: { routine: 'attack', args: {} }, facts: { uid: 1, targetUid: 2 }, chance: () => F(damage) });
  const end = { id: 'end', label: 'End', tags: ['end'], commands: [{}] };
  const launch = (damage, c = 2) => ({ id: `launch:${c}`, label: 'launch', tags: ['launch', 'land'], commands: [{}], facts: { to: { c, r: 0 }, strike: 3 },
    then: () => null, later: () => (damage === null ? null : { options: [shot('detonate:x:2', damage)] }) });
  const move = (c, damage, r = 0) => ({ id: `move:${c},${r}`, label: 'move', tags: ['move'], commands: [{}], facts: { to: { c, r }, facing: 1 },
    then: () => (damage === null ? null : { options: [shot(`attack:from${c}:2`, damage)] }) });
  const ask = (options, v = view(), facts = {}) => brawlerPolicy.choose({ id: 'q', kind: 'opp.act', seat: 's1', unit: 1, options: [...options, end], fallback: 'end', facts }, v, rng);
  check('a Projectile to launch holds it from a move that reaches less: the launch is taken, and scored as its blast',
    [ask([launch(0.8), move(1, 0.4)]).option, ask([launch(0.8), move(1, 0.4)]).reason, ask([launch(0.8), move(1, 0.4)]).score], ['launch:2', 'projectile_blast_value', 20]);
  check('and a move that reaches more than the launch is worth comes first', [ask([launch(0.4), move(1, 0.8)]).option, ask([launch(0.4), move(1, 0.8)]).reason], ['move:1,0', 'movement_unlocks_better_target']);
  check('an attack on offer worth more than the launch is made before it, and one worth less after it',
    [ask([shot('attack:a:2', 0.8), launch(0.4)]).option, ask([shot('attack:a:2', 0.4), launch(0.8)]).option, ask([shot('attack:a:2', 0.4), launch(0.4)]).option], ['attack:a:2', 'launch:2', 'attack:a:2']);
  check('a Projectile whose blast would do nothing, or would find nobody, is not launched',
    [ask([launch(0)]).option, ask([launch(null)]).option], ['end', 'end']);
  // With nobody to say what the blast would do, the strike is all there is.
  const bare = (c) => { const l = launch(0.8, c); delete l.later; return l; };
  check('with nobody to ask about its blast, a Projectile is launched where its strike reaches an enemy, for what an attack with no odds is worth, and nowhere else',
    [ask([bare(0), bare(2)]).option, ask([bare(0), bare(2)]).score, ask([bare(0)]).option], ['launch:2', BRAWLER.ATTACK_BASE, 'end']);
  // Every Grid a move ends in is tried, not the nearest alone.
  check('the best attack may be from a Grid that is not the nearest its enemy: every Grid in reach is tried',
    [ask([move(3, 0.2), move(2, 0.8), move(1, 0.4)]).option, ask([move(3, 0.2), move(2, 0.8), move(1, 0.4)]).score], ['move:2,0', 20]);
  check('a move that reaches only an attack worth nothing is not made for that attack: if it is made, it is a step toward the enemy like any other',
    [ask([move(3, 0)]).reason, ask([move(0, 0)]).reason], ['contact_before_occupation', 'end_activation']);
  // The road: with nothing to attack from anywhere, the walk to the NEAREST
  // enemy, and a Grid that is on no road is no nearer.
  const unarmed = { ...me, weapons: [] };
  const far = { ...foe, uid: 3, grid: { col: 0, row: 9 } };
  const roads = { 2: [{ c: 1, r: 0 }, { c: 2, r: 0 }, { c: 3, r: 0 }], 3: [{ c: 0, r: 1 }, { c: 0, r: 2 }, { c: 0, r: 3 }, { c: 0, r: 4 }, { c: 0, r: 5 }, { c: 0, r: 6 }, { c: 0, r: 7 }, { c: 0, r: 8 }] };
  check('of the roads to the enemy, the shortest is the one walked',
    ask([move(0, null, 4), move(2, null)], view(unarmed, [far]), { roads }).option, 'move:2,0');
  check('and a Grid on no road is no step toward anybody, however near the crow would find it',
    [ask([move(3, null, 1), move(1, null)], view(unarmed, [far]), { roads }).option, ask([move(3, null, 1)], view(unarmed, [far]), { roads }).reason], ['move:1,0', 'end_activation']);
  // Link is restored only where some is lost.
  const mend = { id: 'stabilise:keep', label: 'Stabilize', tags: ['stabilise', 'restore-link'], commands: [{}] };
  check('Link is restored when some is lost, and the Action is not spent on a pilot at full Link',
    [ask([mend], view({ ...unarmed, link: 2 })).option, ask([mend], view({ ...unarmed, link: 2 })).reason, ask([mend], view(unarmed)).option], ['stabilise:keep', 'best_positive_option', 'end']);
}
{
  // HOLD GROUND. Contact comes before occupation, and occupation comes: with
  // nothing to attack and nobody to close on, a unit goes for a zone the Main
  // Task scores that its squad's Control dial does not name. By hand: a zone of
  // two Grids at (5,0) and (6,0), the unit at (0,0), one move to each of three
  // Grids.
  const me = { uid: 1, side: 's1', kind: 'mech', grid: { col: 0, row: 0 }, facing: 1, deployed: true, alive: true, weapons: [], health: 1, points: 100, parts: [], ground: true, locks: true, lowValue: false, link: 4, linkMax: 4 };
  const foe = (col, row, more = {}) => ({ uid: 2, side: 's2', kind: 'mech', grid: { col, row }, facing: 3, deployed: true, alive: true, weapons: [], health: 1, points: 100, commander: false, parts: [], ground: true, locks: true, camouflaged: false, aerial: false, lowValue: false, ...more });
  const zone = (control, cells = ['5,0', '6,0'], scoring = true) => ({ id: 'bravo', name: 'Bravo', cells, holder: null, control, scoring });
  const move = (c, r = 0) => ({ id: `move:${c},${r}`, label: 'move', tags: ['move'], commands: [{}], facts: { to: { c, r }, facing: 1 }, then: () => null });
  const end = { id: 'end', label: 'End', tags: ['end'], commands: [{}] };
  const hold = (zones, moves, units = [me], facts = {}) => brawlerPolicy.choose({ id: 'q', kind: 'opp.act', seat: 's1', unit: units[0].uid, options: [...moves, end], fallback: 'end', facts },
    { seat: 's1', units, zones, opportunity: null, phaseName: 'Action' }, rng);
  let c = hold([zone(null)], [move(2), move(4), move(3, 3)]);
  check('with nobody to fight, a unit walks toward a zone the Main Task scores that is not its squad\'s: the Grid nearest it, at his task-distance weight a Grid',
    [c.option, c.reason, near(c.score, -BRAWLER.TASK_DISTANCE_WEIGHT)], ['move:4,0', 'occupy_objective', true]);
  c = hold([zone(null)], [move(4), move(5)]);
  check('a Grid of the zone itself is worth his objective tier', [c.option, c.score], ['move:5,0', BRAWLER.OBJECTIVE_POINT_TIER]);
  check('a zone held by the other squad is one to take, and a zone its own Control dial names is not: there it stays where it is',
    [hold([zone('s2')], [move(5)]).option, hold([zone('s1')], [move(5)]).reason, hold([zone(null, ['5,0'], false)], [move(5)]).reason], ['move:5,0', 'end_activation', 'end_activation']);
  check('standing in the zone it is taking, it stays', hold([zone(null)], [move(6), move(2)], [{ ...me, grid: { col: 5, row: 0 } }]).reason, 'end_activation');
  check('of two zones to take, the nearer', hold([zone(null, ['9,0']), { ...zone(null, ['0,3']), id: 'echo', name: 'Echo' }], [move(1), move(0, 1)]).option, 'move:0,1');
  check('a Low Value unit holds nothing, and does not walk to a zone', hold([zone(null)], [move(5)], [{ ...me, lowValue: true }]).reason, 'end_activation');
  // CONTACT BEFORE OCCUPATION: an enemy to close on comes first.
  const far = foe(0, 9);
  c = hold([zone(null)], [move(5), move(0, 1)], [me, far]);
  check('contact comes before occupation: with an enemy on the board it closes on the enemy, though a zone stands open the other way',
    [c.option, c.reason], ['move:0,1', 'contact_before_occupation']);
  // An enemy standing in a zone disputes it: a Grid there takes nothing. The
  // unit stands two Grids from that enemy and neither move brings it nearer
  // (so there is no contact to make): one into the disputed zone, one into
  // another that stands empty.
  const squatter = foe(6, 0);
  const two = [zone(null, ['4,0', '6,0']), { ...zone(null, ['5,2']), id: 'echo', name: 'Echo' }];
  const here = { ...me, grid: { col: 5, row: 1 }, facing: 0 };
  c = hold(two, [move(4, 0), move(5, 2)], [here, squatter], { roads: {} });
  check('a zone with an enemy standing in it is not taken by standing in it too: the empty zone is the one worth his tier',
    [c.option, c.reason, c.score], ['move:5,2', 'occupy_objective', BRAWLER.OBJECTIVE_POINT_TIER]);
  check('  (a Low Value enemy disputes nothing: either zone is worth taking, and the first offered is)',
    hold(two, [move(4, 0), move(5, 2)], [here, { ...squatter, lowValue: true }], { roads: {} }).option, 'move:4,0');
}
{
  // On the engine: the alley, the enemy gone from the board. The Mire, with
  // nobody left to fight, makes for the nearest of the three Control zones.
  const st = stage((s, V, at) => {
    s.map = 'alley';
    at(V.Mire, 4, 2, 2); at(V.Dune, 4, 1, 2);
    for (const t of s.tokens) if (t.side === 's2') { for (const k of Object.keys(t.partStates)) t.partStates[k] = 'destroyed'; t.deployed = false; }
  });
  st.turnOf(st.U.Mire, 'movement');
  const { d, view, c, picked } = asked(st.s, 's1');
  const open = view.zones.filter((z) => z.scoring && z.control !== 's1');
  const off = (g) => Math.min(...open.flatMap((z) => z.cells.map((x) => x.split(',').map(Number))).map(([col, row]) => Math.abs(col - g.c) + Math.abs(row - g.r)));
  const moves = d.options.filter((o) => o.tags[0] === 'move');
  check('with the enemy gone, a Mech holds ground: it takes the Movement that ends nearest a zone the Main Task scores',
    [open.map((z) => z.name), c.reason, off(picked.facts.to), off(picked.facts.to) < off({ c: 4, r: 2 }), view.units.filter((u) => u.side === 's2' && u.deployed && u.alive).length],
    [['Bravo', 'Echo', 'Hotel'], 'occupy_objective', Math.min(...moves.map((o) => off(o.facts.to))), true, 0]);
}
{
  // THE REST OF THE LADDER.
  // Link to recover is the best thing left to do.
  const st = stage((s, V, at) => { at(V['Wild Cat'], 11, 0, 3); V.Mire.link = 2; });
  const spent = st.turnOf(st.U.Mire, 'tactical');
  const walking = asked(st.s, 's1');
  check('closing on the enemy comes before anything of its own: with its Maneuver in hand it walks', walking.c.reason, 'contact_before_occupation');
  spent.maneuvered = true; spent.maneuver = 0;
  const q = asked(st.s, 's1');
  check('with nothing to attack and nowhere nearer to stand, Link is restored if any is lost',
    [q.d.options.some((o) => o.tags[0] === 'move'), q.d.options.some((o) => o.tags.includes('restore-link')), q.c.reason, q.picked.tags.includes('restore-link')], [false, true, 'best_positive_option', true]);
  // And with nothing at all, the activation is ended.
  const idle = stage((s, V, at) => { at(V.Mire, 5, 4, 1); at(V['Wild Cat'], 6, 4, 3); V.Mire.partStates.rightHand = 'destroyed'; V.Mire.partStates.leftHand = 'destroyed'; V.Mire.partStates.backpack = 'destroyed'; });
  const o = idle.turnOf(idle.U.Mire, 'tactical');
  o.maneuvered = true; o.maneuver = 0; o.action = 0; o.started = true; o.performed = ['COMMON_STABILIZE'];
  const e = asked(idle.s, 's1');
  check('and with nothing left to do, the activation is ended', [e.c.option, e.c.reason], ['end', 'end_activation']);
}
{
  // An Electronic Attack, and a Projectile's Delayed Action.
  const st = stage((s, V, at) => { at(V.Raven, 6, 5, 3); });
  st.activate(st.U.Raven, 3);
  const { d, c, picked } = asked(st.s, 's2');
  check('an Electronic Attack on offer is made', [d.kind, picked.tags[0], c.reason], ['activation.act', 'electronic', 'attack_result_value']);
  const air = stage();
  const far = { ...M.U.makeDroneToken(air.s, data, data.byId.get('071'), 's1'), parentUid: air.U.Mire.uid, col: 1, row: 31, facing: 0 };
  air.s.tokens.push(far);
  air.activate(far, 4);
  const q = asked(air.s, 's1');
  check('a Missile with nothing to take resolves its Delayed Action', [q.c.option, q.c.reason], ['detonate:071_A:none', 'delayed_action']);
  const hot = stage();
  const close = { ...M.U.makeDroneToken(hot.s, data, data.byId.get('071'), 's1'), parentUid: hot.U.Mire.uid, col: 18, row: 12, facing: 0 };
  hot.s.tokens.push(close);
  hot.activate(close, 4);
  const h = asked(hot.s, 's1');
  const top = best(attacks(h.d), (o) => worthOf(o, h.view));
  check('and one with an enemy inside its Range takes the Explosion worth most', [h.c.option, h.c.reason, h.picked.tags.includes('explosion')], [top.id, 'attack_result_value', true]);
}

// ---------- 3. the other decisions ----------
{
  // THE TIMING DIAL: the Timing whose opening attack is worth most, the
  // earliest of equals; a move when nothing opens with an attack.
  const plan = (over) => stage((s, V, at) => {
    s.round.phase = 1; s.script.stage = '1:1'; s.script.revealed = []; s.script.commits = {};
    for (const t of s.tokens) delete t.timing;
    over?.(s, V, at);
  });
  const st = plan();
  const { d, view, c } = asked(st.s, 's1');
  // What each dial would open with, weighed as the policy weighs it.
  const opening = (o) => {
    const q = o.then(['attack', 'maneuver', 'launch']);
    if (!q) return 0;
    const now = Math.max(0, ...attacks(q).map((a) => worthOf(a, view)));
    const walk = Math.max(0, ...q.options.filter((x) => x.tags[0] === 'move').flatMap((x) => attacks(x.then(['attack']) ?? { options: [] }).map((a) => worthOf(a, view))));
    const blast = Math.max(0, ...q.options.filter((x) => x.tags[0] === 'launch').flatMap((x) => attacks(x.later(['attack']) ?? { options: [] }).map((a) => worthOf(a, view))));
    return Math.max(now, walk, blast);
  };
  const worths = d.options.map((o) => opening(o));
  const top = Math.max(...worths);
  check('the dial is the Timing whose opening attack is worth most, and of two worth the same the earlier: the Mire, with the Wild Cat two Grids off',
    [d.kind, d.unit, c.reason, c.score, d.options.findIndex((o) => o.id === c.option), top > 0], ['planning.dial', st.U.Mire.uid, 'intent_opening', BRAWLER.INTENT_OPENING_SCORE, worths.findIndex((w) => w > top - 1e-9), true]);
  check('  (the dials do not all open the same: the Swift and the Tactical dial open with no attack at all)',
    [worths[d.options.findIndex((o) => o.id === 'dial:swift')], worths[d.options.findIndex((o) => o.id === 'dial:tactical')], new Set(worths.map((w) => w.toFixed(6))).size > 2], [0, 0, true]);
  const lone = plan((s, V, at) => { at(V['Wild Cat'], 11, 11, 3); });
  const q = asked(lone.s, 's1');
  check('with nothing any dial would open on, it moves first', [q.c.option, q.c.reason, q.c.score], ['dial:movement', 'reposition_opening', BRAWLER.REPOSITION_OPENING_SCORE]);
  // A wall between them: Range says the gun reaches, and the engine says no.
  const walled = plan((s, V, at) => { s.map = 'alley'; at(V.Mire, 1, 1, 1); at(V['Wild Cat'], 4, 1, 3); });
  const w = asked(walled.s, 's1');
  const opens = w.d.options.map((o) => opening(o));
  check('what a dial would open is asked of the engine, so an enemy in Range and out of sight opens nothing',
    [w.c.reason === (Math.max(...opens) > 0 ? 'intent_opening' : 'reposition_opening'), w.d.options.findIndex((o) => o.id === w.c.option) === (Math.max(...opens) > 0 ? opens.findIndex((x) => x > Math.max(...opens) - 1e-9) : w.d.options.findIndex((o) => o.id === 'dial:movement'))],
    [true, true]);
}
{
  // THE DIAL, by hand: what each Timing would open, given.
  const blade = { slot: 'leftHand', actionId: 'b', name: 'Blade', type: 'Melee', timing: 'melee', range: 0, yellow: 0, red: 3, usable: true };
  const gun = { slot: 'rightHand', actionId: 'g', name: 'Gun', type: 'Firing', timing: 'firing', range: 6, yellow: 0, red: 3, usable: true };
  const rack = { slot: 'backpack', actionId: 'm', name: 'Missile', type: 'Projectile', timing: 'projectile', range: 3, yellow: 0, red: 0, usable: true, strike: 3 };
  const me = { uid: 1, side: 's1', kind: 'mech', grid: { col: 0, row: 0 }, facing: 1, deployed: true, alive: true, weapons: [blade, gun, rack], health: 1, points: 100, parts: [], ground: true, locks: true, maneuver: 1 };
  const foe = (col) => ({ uid: 2, side: 's2', kind: 'mech', grid: { col, row: 0 }, facing: 3, deployed: true, alive: true, weapons: [], health: 1, points: 100, commander: false, parts: [], ground: true, locks: false, camouflaged: false, aerial: false });
  const F = (damage) => ({ hit: damage > 0 ? 1 : 0, pen: damage, damage, destroy: 0, kill: 0, link: 0, parts: [], pick: null });
  const shot = (id, damage) => ({ id, label: id, tags: ['attack'], run: { routine: 'attack', args: {} }, facts: { uid: 1, targetUid: 2 }, chance: () => F(damage) });
  const opens = (damage) => () => ({ options: [shot('attack:now:2', damage)] });
  const walks = (damage) => () => ({ options: [{ id: 'move:maneuver:1,0:1', label: 'step', tags: ['move', 'maneuver'], commands: [{}], facts: { to: { c: 1, r: 0 }, facing: 1 }, then: () => ({ options: [shot('attack:after:2', damage)] }) }] });
  const lobs = (damage) => () => ({ options: [{ id: 'launch:m:1,0', label: 'lob', tags: ['launch', 'land'], commands: [{}], facts: { to: { c: 1, r: 0 }, strike: 3 }, then: () => null, later: () => ({ options: [shot('detonate:m:2', damage)] }) }] });
  const nothing = () => null;
  let looked = 0;
  const dialOf = (timing, then) => ({ id: `dial:${timing}`, label: timing, tags: ['dial', `timing:${timing}`], run: { routine: 'dial', args: {} }, ...(then ? { then: (only) => { looked += 1; return then(only); } } : {}) });
  const set = (dials, col = 2) => brawlerPolicy.choose({ id: 'q', kind: 'planning.dial', seat: 's1', unit: 1, options: [...dials, dialOf('movement', nothing)], fallback: 'dial:movement', facts: {} },
    { seat: 's1', units: [me, foe(col)], zones: [], opportunity: null, phaseName: 'Planning' }, rng);
  check('the dial is the Timing whose opening is worth most, though a lesser one comes earlier in the round',
    [set([dialOf('melee', opens(0.4)), dialOf('firing', opens(0.8))]).option, set([dialOf('melee', opens(0.4)), dialOf('firing', opens(0.8))]).reason], ['dial:firing', 'intent_opening']);
  check('and of two worth the same, the earlier', set([dialOf('melee', opens(0.8)), dialOf('firing', opens(0.8))]).option, 'dial:melee');
  check('an attack the Maneuver reaches is an opening, and so is a Projectile to launch at something: each for what it is worth',
    [set([dialOf('melee', walks(0.8)), dialOf('firing', opens(0.4))]).option, set([dialOf('projectile', lobs(0.8)), dialOf('firing', opens(0.4))]).option,
      set([dialOf('melee', walks(0.4)), dialOf('projectile', lobs(0.4)), dialOf('firing', opens(0.8))]).option], ['dial:melee', 'dial:projectile', 'dial:firing']);
  check('a Timing with an enemy in Range that the engine says opens on nothing is no dial to set: it moves first',
    [set([dialOf('melee', nothing), dialOf('firing', nothing)]).option, set([dialOf('melee', nothing), dialOf('firing', nothing)]).reason, set([dialOf('melee', walks(0)), dialOf('firing', opens(0))]).option],
    ['dial:movement', 'reposition_opening', 'dial:movement']);
  looked = 0;
  check('a Timing with nobody in its Range is not looked into at all', [set([dialOf('melee', opens(0.8)), dialOf('firing', opens(0.8))], 11).option, looked], ['dial:movement', 0]);
  check('with nobody to ask what a dial would open, the earliest Timing with an enemy in its Range is all there is to go by',
    [set([dialOf('melee'), dialOf('firing')], 5).option, set([dialOf('melee'), dialOf('firing')], 2).option, set([dialOf('melee'), dialOf('firing')], 11).option], ['dial:firing', 'dial:melee', 'dial:movement']);
}
{
  // DEPLOYMENT, by hand: with an enemy on the board the aim is that enemy, and
  // the middle of the board only while there is none.
  const unit = (uid, side, col, row, deployed) => ({ uid, side, kind: 'mech', grid: { col, row }, facing: 0, deployed, alive: true, weapons: [], health: 1, points: 100, commander: false, parts: [], ground: true, locks: true, camouflaged: false, aerial: false });
  const spot = (c, r, stance = 'offensive') => ({ id: `deploy:1:${c},${r}:${stance}`, label: '', tags: ['deploy', `stance:${stance}`], commands: [{}], facts: { uid: 1, to: { c, r }, facing: 2, stance } });
  const zones = [{ id: 'z', name: 'Z', cells: ['9,0', '9,1'], holder: null, scoring: true }];
  const place = (foes, options = [spot(0, 0), spot(4, 0)]) => brawlerPolicy.choose({ id: 'q', kind: 'setup.deploy', seat: 's1', options, fallback: options[0].id, facts: {} },
    { seat: 's1', units: [unit(1, 's1', 0, 0, false), ...foes], zones, opportunity: null, phaseName: 'Command' }, rng);
  check('with an enemy on the board it deploys toward that enemy, and toward what the game is fought over only while there is none',
    [place([unit(2, 's2', 0, 5, true)]).option, place([]).option, place([unit(2, 's2', 0, 5, false)]).option], ['deploy:1:0,0:offensive', 'deploy:1:4,0:offensive', 'deploy:1:4,0:offensive']);
  check('and in Offensive Stance, whichever Stance is listed first',
    place([], [spot(4, 0, 'defensive'), spot(4, 0, 'mobility'), spot(4, 0, 'offensive')]).option, 'deploy:1:4,0:offensive');
}
{
  // DEPLOYMENT: as far toward the enemy as its zone goes, a Mech in Offensive
  // Stance.
  M.L.setLocalSeat(null);
  const t = botTable(M, data, alley, { seed: 1, policies: brawlerPolicy });
  const seen = [];
  await t.run({
    until: (state) => M.SU.normaliseSetup(state.setup)?.stage === 'done',
    onStep: (seat, r, state) => {
      if (r.decision.kind !== 'setup.deploy') return;
      // The enemy already on the board when it chose: its own unit, just put down, is not one.
      const foes = state.tokens.filter((x) => x.side !== seat && x.deployed !== false).map((x) => ({ c: Math.floor(x.col / 3), r: Math.floor(x.row / 3) }));
      seen.push({ seat, option: r.option, decision: r.decision, foes, zones: M.SEAT.viewOf(data, state, seat).zones, log: t.drivers[seat].log.at(-1) });
    },
  });
  t.close();
  const off = (o, aims) => Math.min(...aims.map((g) => Math.abs(o.facts.to.c - g.c) + Math.abs(o.facts.to.r - g.r)));
  // With no enemy down yet, the aim is the middle of the Grids the Main Task scores.
  const middle = (zones) => {
    const cells = zones.filter((z) => z.scoring).flatMap((z) => z.cells).map((c) => c.split(',').map(Number));
    return [{ c: cells.reduce((n, x) => n + x[0], 0) / cells.length, r: cells.reduce((n, x) => n + x[1], 0) / cells.length }];
  };
  const forward = seen.map((x) => {
    const aims = x.foes.length ? x.foes : middle(x.zones);
    return Math.abs(off(x.option, aims) - Math.min(...x.decision.options.map((o) => off(o, aims)))) < 1e-9;
  });
  check('every unit is deployed in the Grid of its zone nearest the enemy already on the board (the first of all, nearest the middle of what the game is fought over), and every Mech in Offensive Stance',
    [seen.length, seen.filter((x) => !x.foes.length).length, forward.every(Boolean), seen.filter((x) => x.option.facts.stance).every((x) => x.option.facts.stance === 'offensive'),
      seen.filter((x) => x.option.facts.stance).length, seen.every((x) => x.log.reason === 'deploy_toward_enemy')],
    [6, 1, true, true, 3, true]);
}
{
  // THE COMMANDER is the first unit that may lead.
  M.L.setLocalSeat(null);
  const t = botTable(M, data, vip, { seed: 1, policies: brawlerPolicy });
  const seen = [];
  await t.run({
    until: (state) => M.SU.normaliseSetup(state.setup)?.stage === 'done',
    onStep: (seat, r) => { if (r.decision.kind.startsWith('setup.designate.')) seen.push({ kind: r.decision.kind, first: r.decision.options[0].id, took: r.option.id, reason: t.drivers[seat].log.at(-1).reason }); },
  });
  t.close();
  check('the Commander is the first unit that may lead: no thought goes into it',
    [seen.length, seen.every((x) => x.kind === 'setup.designate.leader' && x.took === x.first && x.reason === 'first_eligible_commander')], [2, true]);
}
{
  // A COMMAND is always spent, on the unit scoring 1 + its health + half a
  // point for each target in its reach.
  const st = stage((s, V, at) => {
    s.round.phase = 0; s.script.stage = '1:0'; s.script.turn = 's2'; s.script.commanded = [];
    at(V.Mire, 5, 4, 2); at(V['Wild Cat'], 11, 0, 3); at(V.Porcupine, 5, 9, 0); at(V.Raven, 11, 9, 3); at(V.Tarantula, 11, 7, 3);
    s.commandTokens = { s1: 0, s2: 2 };
  });
  const { d, view, c, picked } = asked(st.s, 's2');
  const units = d ? d.options.filter((o) => o.tags.includes('designate')) : [];
  check('a Command is spent on the unit with the most to shoot at: the Porcupine, with the Mire inside its Range, before the Drones with nobody in theirs',
    [d?.kind, units.length > 1, d?.options.some((o) => o.id === 'pass'), picked?.facts?.uid, c?.reason, c && near(c.score, 1 + unit(view, st.U.Porcupine.uid).health + BRAWLER.COMMAND_OPPORTUNITY_PER_TARGET)],
    ['loop.designate.command', true, true, st.U.Porcupine.uid, 'command_opportunity', true]);
  st.U.Porcupine.partStates.main = 'damaged';
  st.at(st.U.Mire, 0, 0, 2);
  const hurt = asked(st.s, 's2');
  check('with nobody in anybody\'s reach, the healthiest unit is Commanded, and it is never passed',
    [hurt.c.reason, hurt.picked.facts.uid !== st.U.Porcupine.uid, hurt.c.option !== 'pass', near(hurt.c.score, 2)], ['command_opportunity', true, true, true]);
}
{
  // AN AUTOMATIC UNIT TO ACTIVATE: the one whose best target has lost most.
  const st = stage((s, V, at) => {
    s.round.phase = 3; s.script.stage = '1:3'; s.script.turn = 's2';
    at(V.Mire, 0, 4, 0); at(V.Dune, 11, 11, 0); at(V['Wild Cat'], 6, 6, 3); at(V.Porcupine, 0, 0, 2); at(V.Raven, 11, 9, 2); at(V.Tarantula, 6, 8, 3);
    V.Dune.partStates.leftHand = 'destroyed'; V.Dune.partStates.rightHand = 'damaged';
  });
  const { d, view, c, picked } = asked(st.s, 's2');
  const lost = 1 - unit(view, st.U.Dune.uid).health;
  check('an Automatic unit is activated in the order of what its best target has lost: the Raven, two Grids from the damaged Dune, before the Porcupine with only the whole Mire inside its Range',
    [d?.kind, picked?.facts?.uid, c?.reason, c && near(c.score, BRAWLER.AUTO_ACTION_TARGET_SCORE + lost), lost > 0],
    ['loop.designate.automatic', st.U.Raven.uid, 'auto_action_target', true, true]);
}
{
  // A REBOOT: back up ready to attack.
  const st = stage((s, V) => { V.Mire.stance = 'shutdown'; });
  st.turnOf(st.U.Mire, 'firing');
  const { d, c } = asked(st.s, 's1');
  check('a Shutdown Mech Reboots into Offensive Stance', [d.kind, c.option, c.reason], ['opp.reboot', 'reboot:offensive', 'reboot']);
}
{
  // WHAT IT HAS NO RULE FOR takes the answer that is always safe.
  const d = { id: 'q', kind: 'something.new', seat: 's1', options: [{ id: 'a', label: 'A', tags: [] }, { id: 'b', label: 'B', tags: [] }], fallback: 'b', facts: {} };
  const view = { seat: 's1', units: [], zones: [], opportunity: null };
  check('a question it has no rule for takes the safe answer, and the game goes on', [brawlerPolicy.choose(d, view, rng).option, brawlerPolicy.choose(d, view, rng).reason], ['b', 'safe_answer']);
  check('so does a step of bookkeeping', brawlerPolicy.choose({ ...d, kind: 'phase.ready' }, view, rng).reason, 'safe_answer');
}

// ---------- 4. in the middle of an attack, by hand ----------
{
  const F = (pen, damage, destroy = 0, kill = 0) => ({ hit: Math.max(pen, 0.1), pen, damage, destroy, kill, link: 0, parts: [], pick: null });
  const mine = { uid: 1, side: 's1', kind: 'mech', grid: { col: 0, row: 0 }, deployed: true, alive: true, weapons: [], health: 1, points: 200, link: 3, parts: [] };
  const theirs = { uid: 2, side: 's2', kind: 'mech', grid: { col: 1, row: 0 }, deployed: true, alive: true, weapons: [], health: 1, points: 200, link: 3,
    parts: [{ slot: 'torso', points: 60 }, { slot: 'leftHand', points: 20 }, { slot: 'rightHand', points: 45 }] };
  const view = (link = 3) => ({ seat: 's1', units: [{ ...mine, link }, theirs], zones: [], opportunity: null });
  const o = (id, f, tags = []) => ({ id, label: id, tags, run: { routine: 'combat', args: { id } }, ...(f === undefined ? {} : { chance: () => f }) });
  const q = (kind, options, fallback, role = 'attacker', unit = 1) => ({ id: 'combat|1|0|' + kind, kind, seat: 's1', unit, options, fallback, facts: { attackerUid: role === 'attacker' ? 1 : 2, targetUid: role === 'attacker' ? 2 : 1, role } });
  const pick = (d, v = view()) => brawlerPolicy.choose(d, v, rng);

  // WHERE THE HIT LANDS.
  let c = pick(q('attack.part', [o('part.roll', F(0.5, 0.5)), o('part.pick:torso', F(0.6, 0.6)), o('part.pick:leftHand', F(0.6, 0, 0.6)), o('part.pick:rightHand', F(0.9, 0.9))], 'part.roll'));
  check('an attacker who may place the hit puts it on the Part worth most to hit: a Part it would destroy before one it would only Damage, by the odds',
    [c.option, c.reason, near(c.score, 30)], ['part.pick:leftHand', 'hit_location', true]);
  c = pick(q('attack.part', [o('part.pick:torso', F(0.5, 0.5)), o('part.pick:leftHand', F(0.7, 0.5))], 'part.pick:torso'));
  check('of two worth the same, the one likelier to Penetrate', c.option, 'part.pick:leftHand');
  c = pick(q('attack.part', [o('part.roll', F(0.5, 0.5)), o('part.pick:leftHand', F(0.6, 0, 0.6)), o('part.pick:rightHand', F(0.6, 0, 0.6))], 'part.roll'));
  check('of two Parts worth the same to hit, the one that cost more', c.option, 'part.pick:rightHand');
  check('with no Part to place it on, the die is rolled', pick(q('attack.part', [o('part.roll', F(0.5, 0.5))], 'part.roll')).option, 'part.roll');
  check('and a Part Die is not thrown again for a Link', [pick(q('attack.partfocus', [o('part.keep', F(0.5, 0.5)), o('part.focus', F(0.9, 0.9), ['focus', 'spend-link'])], 'part.keep')).option,
    pick(q('attack.partfocus', [o('part.keep', F(0.5, 0.5)), o('part.focus', F(0.9, 0.9), ['focus', 'spend-link'])], 'part.keep')).reason], ['part.keep', 'skip_reroll']);

  // WHAT THE DEFENDER DECLARES.
  const declare = (parry) => q('defence.declare', [o('declare.designate:leftHand', parry, ['designate']), o('declare.kc', undefined, ['spend-charge']), o('declare.none', F(0.6, 0.6), ['decline'])], 'declare.none', 'defender');
  c = pick(declare(F(0.3, 0.3)));
  check('a defender declares the Parry that costs the attacker more than declaring nothing would', [c.option, c.reason, near(c.score, 7.5)], ['declare.designate:leftHand', 'declare_parry', true]);
  c = pick(declare(F(0.5, 0, 0.5)));
  check('and declares nothing where the Parry would cost its own unit more: a Part destroyed for a Part Damaged', [c.option, c.reason], ['declare.none', 'skip_parry']);
  check('it never spends a Charge on KC Armor', pick(q('defence.declare', [o('declare.kc', undefined, ['spend-charge']), o('declare.none', F(0.6, 0.6), ['decline'])], 'declare.none', 'defender')).option, 'declare.none');

  // A FOCUS: a paid reroll at one chance in four of turning the roll, with two
  // Link or more in hand.
  const focus = (use, role = 'attacker', pass = role === 'attacker' ? F(0, 0) : F(1, 1)) =>
    q(role === 'attacker' ? 'attack.focus' : 'defence.focus', [o('focus.use', use, ['focus', 'spend-link']), o('focus.pass', pass, ['decline'])], 'focus.pass', role);
  check('an attacker pays a Link for a reroll that has one chance in four of turning a miss into a Penetration, and not for less',
    [pick(focus(F(0.25, 0.25))).option, pick(focus(F(0.25, 0.25))).reason, pick(focus(F(0.24, 0.24))).option, pick(focus(F(0.24, 0.24))).reason], ['focus.use', 'paid_reroll', 'focus.pass', 'skip_reroll']);
  check('and not with less than two Link in hand', [pick(focus(F(0.9, 0.9)), view(1)).option, pick(focus(F(0.9, 0.9)), view(2)).option], ['focus.pass', 'focus.use']);
  check('a roll that already Penetrates has nothing to gain', pick(focus(F(1, 1), 'attacker', F(1, 1))).option, 'focus.pass');
  check('a defender pays for a reroll that has one chance in four of turning the Penetration aside',
    [pick(focus(F(0.75, 0.75), 'defender')).option, pick(focus(F(0.76, 0.76), 'defender')).option, pick(focus(F(0.2, 0.2), 'defender', F(0, 0))).option], ['focus.use', 'focus.pass', 'focus.pass']);
  const lent = q('attack.focus', [o('focus.lent', F(0.1, 0.1), ['focus', 'free']), o('focus.use', F(0.1, 0.1), ['focus', 'spend-link']), o('focus.pass', F(0, 0), ['decline'])], 'focus.pass');
  check('a reroll that costs nothing is taken whenever it could help at all', [pick(lent).option, pick(lent).reason], ['focus.lent', 'free_reroll']);
  const whistle = q('attack.focus', [o('focus.whistle', F(0.9, 0.9), ['focus', 'spend-command']), o('focus.pass', F(0, 0), ['decline'])], 'focus.pass');
  check('and a Command Token is never whistled away on one', pick(whistle).option, 'focus.pass');

  // THE REROLL a Focus bought.
  const rolls = (role) => q(role === 'attacker' ? 'attack.reroll' : 'defence.reroll',
    [o('reroll.all', F(0.5, 0.5), ['reroll', 'all']), o('reroll.pick:0', F(0.7, 0.7), ['reroll']), o('reroll.pick:0,1', F(0.4, 0.4), ['reroll']), o(`reroll.keep:${role === 'attacker' ? 'attack' : 'defense'}`, F(0.2, 0.2), ['decline'])],
    `reroll.keep:${role === 'attacker' ? 'attack' : 'defense'}`, role);
  check('the attacker throws again the dice worth most to throw, by the odds of each selection', [pick(rolls('attacker')).option, pick(rolls('attacker')).reason], ['reroll.pick:0', 'reroll_value']);
  check('and the defender the selection that leaves the attacker least: here, keeping the roll', [pick(rolls('defender')).option, pick(rolls('defender')).reason], ['reroll.keep:defense', 'keep_roll']);
  const flat = q('attack.reroll', [o('reroll.all', F(0.2, 0.2), ['reroll', 'all']), o('reroll.keep:attack', F(0.2, 0.2), ['decline'])], 'reroll.keep:attack');
  check('the roll is kept where throwing nothing is as good', pick(flat).option, 'reroll.keep:attack');

  // A SURPLUS, and a bonus attack.
  c = pick(q('attack.surplus', [o('surplus.effect:Mutilation', F(1, 0, 0.4)), o('surplus.effect:Scatter-shot', F(1, 0.5, 0.5))], 'surplus.effect:Mutilation'));
  check('a Surplus is spent on the keyword worth most', c.option, 'surplus.effect:Scatter-shot');
  check('a bonus attack is taken', [pick(q('attack.finish', [o('finish.bonus', undefined, ['attack']), o('finish.decline', undefined, ['decline'])], 'finish.decline')).option,
    pick(q('attack.finish', [o('finish.done', undefined, ['end'])], 'finish.done')).option], ['finish.bonus', 'finish.done']);
  // A Drone is weighed by its points, not by the Mech's sum.
  const drone = { ...theirs, kind: 'drone', points: 70, parts: [{ slot: 'main', points: 70 }] };
  c = brawlerPolicy.choose(q('attack.reroll', [o('reroll.all', F(0.5, 0.5, 0, 0), ['reroll']), o('reroll.pick:0', F(0.4, 0, 0.4, 0.4), ['reroll']), o('reroll.keep:attack', F(0, 0), ['decline'])], 'reroll.keep:attack'),
    { seat: 's1', units: [mine, drone], zones: [], opportunity: null }, rng);
  check('against a Drone the odds are weighed by its points: removing it, at forty in a hundred, before Damaging it at fifty', [c.option, near(c.score, 28)], ['reroll.pick:0', true]);
}

// ---------- 5. whole games ----------
// BRAWLER_GAMES=0 leaves them out: a run that only wants the staged positions
// (a mutation run, which plays them a hundred times over) is four times as
// quick without them.
if (process.env.BRAWLER_GAMES !== '0') {
  M.L.setLocalSeat(null);
  const reasons = new Set();
  const games = [];
  const spent = [];
  for (const [scenario, s1, s2, seed] of [[alley, 'brawler', 'brawler', 1], [vip, 'brawler', 'brawler', 1], [alley, 'brawler', 'eager', 2], [vip, 'eager', 'brawler', 2]]) {
    const POL = { brawler: brawlerPolicy, eager: M.AI.eagerPolicy };
    const t = botTable(M, data, scenario, { seed, policies: { s1: POL[s1], s2: POL[s2] } });
    let slow = 0;
    let end;
    try {
      end = await t.run({
        maxSteps: 6000,
        onStep: (seat, r) => {
          const e = t.drivers[seat].log.at(-1);
          const brawler = (seat === 's1' ? s1 : s2) === 'brawler';
          if (brawler && e.reason) reasons.add(e.reason);
          if (brawler && (r.option.tags.includes('spend-charge') || r.option.tags[0] === 'charge')) spent.push(r.option.id);
          if (brawler && /REFUSED|policy failed/.test(e.why)) spent.push(`${e.kind}: ${e.why}`);
          slow = Math.max(slow, e.ms);
        },
      });
    } catch (err) {
      end = { kind: 'threw', why: err.message };
    } finally {
      t.close();
    }
    games.push({ id: `${scenario.id} ${s1} v ${s2}`, end: end.kind, why: end.why ?? '', refused: t.refused.length, rounds: t.state.round.n, slow });
  }
  check('the Brawler plays whole games to the end, against itself and against the eager policy, on both scenarios: nothing refused, nothing stuck',
    games.filter((g) => g.end !== 'over' || g.refused).map((g) => `${g.id}: ${g.end} ${g.why} (${g.refused} refused)`), []);
  // Said, not held: a clock is no judge on a machine busy with other things.
  console.log(`       (the slowest decision in those games took ${Math.max(...games.map((g) => g.slow))} ms)`);
  check('it never spent a Charge, never Charged a Part, and its policy never failed', spent, []);
  const LADDER = ['attack_result_value', 'movement_unlocks_better_target', 'contact_before_occupation', 'occupy_objective', 'end_activation', 'intent_opening', 'reposition_opening',
    'deploy_toward_enemy', 'first_eligible_commander', 'command_opportunity', 'auto_action_target', 'skip_reroll', 'safe_answer'];
  check('and in them every rung of the ladder it is sure to meet was climbed', LADDER.filter((r) => !reasons.has(r)), []);
}

M.L.setLocalSeat(null);
console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
