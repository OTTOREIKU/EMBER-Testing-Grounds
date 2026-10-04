// The Tactician (src/ai/tactician.ts) and its price list (src/ai/evaluate.ts):
// AI-OPPONENT-PLAN.md, M7 and section 6.
//
// The Tactician asks one question of every answer: what is it worth, in
// Victory Points, to end up there and do that? So this file holds it to that
// sum, a term at a time.
//
// Four kinds of check:
//   1. THE PRICE LIST, by hand: what a unit, an attack and the Main Task are
//      worth, on views written out here.
//   2. PLANS, by hand: questions written out, with the looks a driver would
//      hang on them given (the odds, what an answer leads to, the table it
//      would leave), so that each term of a plan can be moved by itself.
//   3. ON THE ENGINE: staged tables, the question the seat's driver would hand
//      the policy, and what the policy does with it.
//   4. WHOLE GAMES against the Brawler and against itself, to the end, with
//      nothing refused. TACTICIAN_GAMES=0 leaves them out (a mutation run).
import { botTable, loadEngine, tableAtRoundOne } from './_engine.mjs';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}\n       got  ${g}`); }
};

console.log('The Tactician\n');

const { M, data } = await loadEngine('tactician', ["export * as SEAT from '../src/seat';", "export * as TURN from '../src/turn';", "export * as AI from '../src/ai/index';"]);
const { makeTactician, tacticianPolicy, brawlerPolicy, TACTICIAN, SKILLS, gainOf, holds, missionOf, payFrom, unitWorth, weighed } = M.AI;
const W = TACTICIAN;
const [alley, vip] = data.solo.scenarios;
const near = (a, b) => Math.abs(a - b) < 1e-9;
const rng = new M.AI.Rng('tactician');

// ---------- views and questions written out ----------

const part = (slot, points, state = 'intact') => ({ slot, cardId: slot, state, armor: 4, structure: 1, points, repaired: false });
const gun = (range, more = {}) => ({ slot: 'rightHand', actionId: 'gun', name: 'Gun', type: 'Firing', timing: 'firing', length: 'short', range, yellow: 3, red: 1, usable: true, ...more });
// A unit as a view shows it. A Mech has five Parts of 20 points and a pilot of
// 10 (110 in all); a Drone one Part worth all of it.
const unit = (uid, side, kind, col, row, more = {}) => {
  const parts = kind === 'mech' ? ['torso', 'chasis', 'leftHand', 'rightHand', 'backpack'].map((s) => part(s, 20)) : [part('main', more.points ?? 60)];
  return {
    uid, side, kind, cardId: 'x', label: more.label ?? `${kind} ${uid}`, grid: { col, row }, cell: { col: col * 3, row: row * 3 }, size: kind === 'mech' ? 3 : 1, facing: 0,
    deployed: true, alive: true, stance: 'offensive', link: kind === 'mech' ? 4 : undefined, linkMax: kind === 'mech' ? 4 : undefined, dialHidden: false, statuses: [],
    aerial: false, ground: true, locks: kind === 'mech', camouflaged: false, parts, health: 1, points: kind === 'mech' ? 110 : (more.points ?? 60),
    weapons: [], maneuver: kind === 'mech' ? 1 : 0, move: kind === 'mech' ? 1 : 5, commander: false, charged: [], lowValue: false, done: false, hands: 0, ...more,
  };
};
const viewOf = (units, more = {}) => ({
  seat: 's1', other: 's2', round: 1, roundLimit: 5, phase: 2, phaseName: 'Action', firstPlayer: 's1', setup: 'done', mission: null, task: null, noSecondary: true,
  units, zones: [], boxes: [], vp: { s1: 0, s2: 0 }, commandTokens: { s1: 0, s2: 0 }, opportunity: null, ...more,
});
const odds = (kill, destroy, damage, more = {}) => ({ hit: 1, pen: Math.max(kill, destroy, damage), damage, destroy, kill, link: 0, parts: [], pick: null, ...more });
const CONTROL = { family: 'control', vp: 2, fromRound: 2, cadence: 'per-round', perPart: 0, scoringZone: null };
const VIP = { family: 'vip', vp: 10, fromRound: 1, cadence: 'per-round', perPart: 3, scoringZone: null };
const zone = (id, cells, more = {}) => ({ id, name: id, cells, holder: null, control: null, scoring: true, ...more });

// ---------- 1. the price list ----------
{
  check('the weights are numbers, every one, and a Part Damaged is half a Part destroyed (which is what lets the odds of two attacks be added)',
    [Object.values(W).every((x) => typeof x === 'number' && Number.isFinite(x)), W.damaged, Object.keys(W).length > 20], [true, 0.5, true]);
  // What a unit is worth.
  const mech = unit(1, 's2', 'mech', 0, 0);
  const drone = unit(2, 's2', 'drone', 0, 0, { points: 70 });
  const v = viewOf([mech, drone]);
  check('a unit is worth the points of its cards, at the rate: a Drone of 70, a Mech of 110 (its Parts and its pilot)',
    [near(unitWorth(drone, v, W), 70 * W.material), near(unitWorth(mech, v, W), 110 * W.material)], [true, true]);
  const hurt = { ...mech, parts: [part('torso', 20), part('chasis', 20, 'damaged'), part('leftHand', 20, 'destroyed'), part('rightHand', 20), part('backpack', 20)] };
  check('a Part destroyed is worth nothing and a Part Damaged its share: what is standing in the unit, and its pilot while it stands',
    near(unitWorth(hurt, v, W), W.material * (20 + 20 * (1 - W.damaged) + 0 + 20 + 20 + 10)), true);
  check('a unit that is destroyed is worth nothing', unitWorth({ ...mech, alive: false }, v, W), 0);
  // The Commander's own price, on a VIP mission.
  const lead = { ...mech, commander: true };
  const mine = { ...unit(3, 's1', 'mech', 0, 0), commander: true };
  const onVip = viewOf([lead, mine], { task: VIP });
  check('on a VIP mission the enemy Commander is worth the Main Task\'s Victory Points besides, and this squad\'s own more than that: nothing is won back after it',
    [near(unitWorth(lead, onVip, W), 110 * W.material + VIP.vp * W.vipKill), near(unitWorth(mine, onVip, W), 110 * W.material + VIP.vp * W.vipOwn), W.vipOwn > W.vipKill],
    [true, true, true]);
  check('and on any other mission a Commander is a Mech like another', near(unitWorth(lead, viewOf([lead], { task: CONTROL }), W), 110 * W.material), true);
  check('on a VIP mission it is the Commander that carries the Task\'s price: any other unit is worth its cards', near(unitWorth(mech, viewOf([lead, mech, mine], { task: VIP }), W), 110 * W.material), true);

  // What an attack is worth.
  const whole = unitWorth(drone, v, W);
  check('an attack on a Drone is worth the Drone destroyed and its share Damaged, each by its chance',
    [near(gainOf(odds(1, 1, 0), drone, v, W), whole), near(gainOf(odds(0, 0, 1), drone, v, W), whole * W.damaged), near(gainOf(odds(0.25, 0.25, 0.5), drone, v, W), whole * (0.25 + 0.5 * W.damaged)),
      gainOf(odds(0, 0, 0), drone, v, W)], [true, true, true, 0]);
  // Two attacks that each have chance p to Damage, one after the other: the
  // second finishes what the first began with chance p of p.
  const p = 0.6;
  const together = whole * (p * p + W.damaged * 2 * p * (1 - p));
  check('at a half for Damaged, two such attacks are worth together what their two forecasts add up to, though neither forecast knows of the other',
    near(2 * gainOf(odds(0, 0, p), drone, v, W), together), true);
  const all = unitWorth(mech, v, W);
  check('a Part of a Mech is one of the three it can lose before it is lost whole (Integrity Loss): a Part destroyed is a third of the Mech, and a Part Damaged half of that',
    [near(gainOf(odds(0, 1, 0), mech, v, W), all / 3), near(gainOf(odds(0, 0, 1), mech, v, W), W.damaged * all / 3), near(gainOf(odds(1, 1, 0), mech, v, W), all)], [true, true, true]);
  const three = { ...mech, parts: [part('torso', 20), part('chasis', 20), part('leftHand', 20), part('rightHand', 20, 'destroyed'), part('backpack', 20, 'destroyed')] };
  check('with two Parts gone already the next is the Mech: priced as the whole of what is left',
    near(gainOf(odds(0, 1, 0), three, v, W), unitWorth(three, v, W)), true);
  check('a destroyed Torso is a kill and a destroyed Part both, and is counted once', near(gainOf(odds(0.4, 0.4, 0), mech, v, W), 0.4 * all), true);
  check('Link stripped is worth its weight', near(gainOf(odds(0, 0, 0, { link: 2 }), mech, v, W), 2 * W.link), true);
  check('on a VIP mission a destroyed Part of a Commander is also what it pays at the round limit, for the chance the game gets there',
    near(gainOf(odds(0, 1, 0), lead, onVip, W), unitWorth(lead, onVip, W) / 3 + VIP.perPart * W.vipPart), true);
  check('what a target would go on to do is added to what it is worth, whole and by the Part',
    [near(gainOf(odds(1, 1, 0), drone, v, W, 2), whole + 2), near(gainOf(odds(0, 1, 0), mech, v, W, 3), (all + 3) / 3)], [true, true]);
  check('an attack is worth the same whoever makes it: an enemy\'s on this squad\'s unit is priced as this squad\'s on an enemy\'s',
    near(gainOf(odds(0.3, 0.5, 0.4), mine, viewOf([mine]), W), gainOf(odds(0.3, 0.5, 0.4), { ...mine, side: 's2' }, viewOf([mine]), W)), true);
}
{
  // What the Main Task is worth as the board stands.
  const me = unit(1, 's1', 'mech', 0, 0);
  const foe = unit(2, 's2', 'mech', 11, 11);
  const board = (zones, more = {}) => viewOf([me, foe], { task: CONTROL, zones, ...more });
  const rounds = (from, to, now) => { let n = 0; for (let r = Math.max(now, from); r <= to; r++) n += W.missionFuture ** (r - now); return n; };
  check('with no Main Task, or one that is no Occupation, the mission is what is banked: this squad\'s Victory Points less the other\'s',
    [missionOf(viewOf([me], { vp: { s1: 6, s2: 2 } }), W), missionOf(viewOf([me], { task: VIP, vp: { s1: 3, s2: 10 } }), W)], [4, -7]);
  check('an Occupation adds each zone that would be a squad\'s as the round ended, paid every round still to come, each round further off for less: nothing in round 1, which pays nothing',
    [near(missionOf(board([zone('a', ['5,5'], { holder: 's1' })]), W), CONTROL.vp * rounds(2, 5, 1)), near(missionOf(board([zone('a', ['5,5'], { holder: 's1' })], { round: 3 }), W), CONTROL.vp * rounds(2, 5, 3)),
      near(missionOf(board([zone('a', ['5,5'], { holder: 's1' })], { round: 5 }), W), CONTROL.vp)], [true, true, true]);
  check('a zone the other squad holds counts against, a zone nobody holds stays with the squad its dial names, and one that is nobody\'s counts for nothing',
    [near(missionOf(board([zone('a', ['5,5'], { holder: 's2' })], { round: 5 }), W), -CONTROL.vp), near(missionOf(board([zone('a', ['5,5'], { control: 's1' })], { round: 5 }), W), CONTROL.vp),
      missionOf(board([zone('a', ['5,5'])], { round: 5 }), W), near(missionOf(board([zone('a', ['5,5'], { holder: 's2', control: 's1' })], { round: 5 }), W), -CONTROL.vp)],
    [true, true, 0, true]);
  check('a zone the Main Task does not score counts for nothing, and what is banked is added to the rest',
    [missionOf(board([zone('a', ['5,5'], { holder: 's1', scoring: false })], { round: 5 }), W), near(missionOf(board([zone('a', ['5,5'], { holder: 's1' })], { round: 5, vp: { s1: 4, s2: 6 } }), W), -2 + CONTROL.vp)],
    [0, true]);
  check('a Task that pays once, as the game ends, is that payment at the distance the end is at',
    near(missionOf(board([zone('a', ['5,5'], { holder: 's1' })], { round: 3, task: { ...CONTROL, cadence: 'at-end' } }), W), CONTROL.vp * W.missionFuture ** 2), true);
  // A zone held by its dial alone, with an enemy near enough to walk in.
  const risky = { ...W, contest: 0.4 };
  const at = (u, col, row) => ({ ...u, grid: { col, row } });
  const dial = [zone('a', ['5,5', '6,5'], { control: 's1' })];
  const last = (units) => viewOf(units, { task: CONTROL, zones: dial, round: 5 });
  check('a zone held by its dial alone is at risk while an enemy that could hold it stands within a Movement of it: it counts for less by the weight on that',
    [near(missionOf(last([at(me, 0, 0), at(foe, 7, 5)]), risky), CONTROL.vp * (1 - risky.contest)), near(missionOf(last([at(me, 0, 0), at(foe, 9, 9)]), risky), CONTROL.vp)], [true, true]);
  check('a Mech\'s reach is its Maneuver and the Movement Action it carries: with a Sprint of 4 it is a threat from five Grids',
    [near(missionOf(last([at(me, 0, 0), at({ ...foe, weapons: [{ ...gun(4), type: 'Moving', timing: 'movement' }] }, 11, 5)]), risky), CONTROL.vp * (1 - risky.contest)),
      near(missionOf(last([at(me, 0, 0), at(foe, 11, 5)]), risky), CONTROL.vp)], [true, true]);
  check('a unit of the dial\'s own squad standing in the zone keeps it whoever comes; a Low Value unit and a Shutdown Mech neither take a zone nor keep one',
    [near(missionOf(last([at({ ...me, lowValue: true }, 0, 0), at(unit(3, 's1', 'drone', 5, 5), 5, 5), at(foe, 6, 5)]), risky), CONTROL.vp),
      near(missionOf(last([at(me, 0, 0), at({ ...foe, lowValue: true }, 7, 5)]), risky), CONTROL.vp), near(missionOf(last([at(me, 0, 0), at({ ...foe, stance: 'shutdown' }, 7, 5)]), risky), CONTROL.vp)],
    [true, true, true]);
  check('the same holds the other way: a zone the other squad\'s dial names counts for less against while this squad stands near enough to take it',
    near(missionOf(viewOf([at(me, 7, 5), at(foe, 0, 0)], { task: CONTROL, zones: [zone('a', ['5,5', '6,5'], { control: 's2' })], round: 5 }), risky), -CONTROL.vp * (1 - risky.contest)), true);
  check('with no weight on it a dial is a dial, whoever is near', near(missionOf(last([at(me, 0, 0), at(foe, 7, 5)]), { ...W, contest: 0 }), CONTROL.vp), true);
  // What a zone pays from a round on: what walking to one is counted in.
  const f = W.missionFuture;
  const in2 = viewOf([me], { task: CONTROL, round: 2 });
  check('a zone pays from the round a unit stands in it to the last, each round further off than this one for less; one it could not stand in before the last round ends pays nothing',
    [near(payFrom(2, in2, W), 1 + f + f ** 2 + f ** 3), near(payFrom(4, in2, W), f ** 2 + f ** 3), near(payFrom(5, in2, W), f ** 3), payFrom(6, in2, W)], [true, true, true, 0]);
  check('taken before the Task begins to score, it pays from the round the Task does: round 1 and round 2 are the same',
    [near(payFrom(1, viewOf([me], { task: CONTROL, round: 1 }), W), f + f ** 2 + f ** 3 + f ** 4), payFrom(1, viewOf([me], { task: CONTROL, round: 1 }), W) === payFrom(2, viewOf([me], { task: CONTROL, round: 1 }), W)], [true, true]);
  const once = viewOf([me], { task: { ...CONTROL, cadence: 'at-end' }, round: 3 });
  check('a Task that pays once pays that once if the zone is held by then, and nothing with no Task at all',
    [near(payFrom(4, once, W), f ** 2), near(payFrom(5, once, W), f ** 2), payFrom(6, once, W), payFrom(2, viewOf([me]), W)], [true, true, 0, 0]);
  check('a unit holds a zone if it is on the board, is no Low Value unit, no Projectile and no Shutdown Mech',
    [holds(me), holds(unit(3, 's1', 'drone', 0, 0)), holds({ ...me, lowValue: true }), holds({ ...me, kind: 'projectile' }), holds({ ...me, stance: 'shutdown' }), holds({ ...me, deployed: false }), holds({ ...me, alive: false })],
    [true, true, false, false, false, false, false]);
}

// ---------- 2. plans, by hand ----------
//
// A question as a driver hands it over: the odds on an attack (`chance`), what
// an answer leads to (`then`), what its unit could do a turn later (`later`),
// the table it would leave (`after`) and the table the question was asked of
// (`here`). Each is given here, so each term of a plan is moved by itself.
const end = (looks = {}) => ({ id: 'end', label: 'End this Opportunity', tags: ['end'], commands: [{}], ...looks });
const shot = (id, targetUid, f, more = {}) => ({ id, label: id, tags: ['attack', 'firing'], run: { routine: 'attack', args: {} }, facts: { uid: 1, targetUid }, chance: () => f, ...more });
const step = (c, r, facing, looks = {}) => ({
  id: `move:maneuver:${c},${r}:${facing}`, label: `Maneuver to ${c},${r}`, tags: ['move', 'maneuver', `facing:${facing}`], commands: [{}],
  facts: { uid: 1, to: { c, r }, facing, grids: 1 }, ...looks,
});
// A question a look gives back, and a table looked at.
const looked = (options, more = {}) => ({ id: 'look', kind: 'opp.act', seat: 's1', options, fallback: 'end', facts: {}, ...more });
// How long a walk is, where a check gives no board of its own: as the crow
// flies, five Grids an activation, what is left of an activation spent first.
const crow = (uid, from, to, left) => from.map((g) => {
  const grids = Math.min(...to.map((z) => Math.abs(z.col - g.col) + Math.abs(z.row - g.row)));
  return { grids, turns: Math.ceil(Math.max(0, grids - (left ?? []).reduce((a, b) => a + b, 0)) / 5) };
});
const outlook = (v, turns = {}, seen = (uid, grids) => grids.map(() => []), more = {}) => ({
  view: () => v, owed: () => null, turnOf: (uid, only, timing) => (turns[uid] ? turns[uid](only, timing) : null), seen,
  walk: crow, without: () => outlook(v), ...more,
});
const ask = (v, options, more = {}) => ({ id: 'q', kind: 'opp.act', seat: 's1', unit: 1, options, fallback: 'end', facts: {}, here: () => outlook(v), ...more });
// A policy with only some skills, and nothing pulling it anywhere unless a
// check says so: no walk toward a zone or an enemy.
const still = { zoneStep: 0, zonePull: 0, contactStep: 0, approach: 0 };
// A policy remembers what the table in front of it has been asked. Here one
// table is asked different things from one check to the next, so every check
// is put to a policy that has been asked nothing.
const made = (skills, weights = {}) => makeTactician({ ...Object.fromEntries(Object.keys(SKILLS).map((k) => [k, false])), ...skills }, { ...still, ...weights });
const only = (skills, weights = {}) => ({ choose: (d, v, r) => made(skills, weights).choose(d, v, r) });
const plain = only({});

{
  // WHAT IT DOES NOW. A Mech with a gun, a Drone three Grids ahead of it.
  const me = unit(1, 's1', 'mech', 0, 0, { facing: 1, weapons: [gun(6)] });
  const foe = unit(2, 's2', 'drone', 3, 0, { points: 60 });
  const v = viewOf([me, foe]);
  const a = shot('attack:a', 2, odds(0.5, 0.5, 0.2));
  const b = shot('attack:b', 2, odds(0.2, 0.2, 0.2));
  let c = plain.choose(ask(v, [b, a, end()]), v, rng);
  check('with attacks on offer it makes the one worth most by its odds, and says what it is worth',
    [c.option, c.reason, near(c.score, gainOf(a.chance(), foe, v, W))], ['attack:a', 'attack_value', true]);
  check('an attack worth nothing is not made: with nothing better to do the Opportunity is ended',
    [plain.choose(ask(v, [shot('attack:z', 2, odds(0, 0, 0)), end()]), v, rng).option, plain.choose(ask(v, [shot('attack:z', 2, odds(0, 0, 0)), end()]), v, rng).reason], ['end', 'end_activation']);
  check('an attack nobody could put odds on is still worth making', plain.choose(ask(v, [{ ...a, chance: undefined }, end()]), v, rng).option, 'attack:a');
  // The whole of an activation's attacks: the first, and what could follow it.
  const single = shot('attack:big', 2, odds(0.6, 0.6, 0));
  const first = shot('attack:first', 2, odds(0.5, 0.5, 0), { then: (kinds) => (kinds.includes('attack') ? looked([shot('attack:second', 2, odds(0.4, 0.4, 0))]) : null) });
  c = plain.choose(ask(v, [single, first, end()]), v, rng);
  check('it weighs what could still be made behind an attack: the attack worth most alone is passed over for one that leaves a second to make',
    [c.option, near(c.score, gainOf(odds(0.5, 0.5, 0), foe, v, W) + gainOf(odds(0.4, 0.4, 0), foe, v, W))], ['attack:first', true]);
  // A Charge spent on an attack.
  const charged = shot('attack:charged', 2, odds(0.9, 0.9, 0), { tags: ['attack', 'firing', 'spend-charge'] });
  check('an attack that spends a Charge is not made by a policy that keeps its Charges, and is by one that does not, where the Charge buys more than it costs',
    [plain.choose(ask(v, [a, charged, end()]), v, rng).option, only({ charge: true }).choose(ask(v, [a, charged, end()]), v, rng).option,
      only({ charge: true }).choose(ask(v, [a, { ...charged, chance: () => odds(0.5, 0.5, 0.2) }, end()]), v, rng).option], ['attack:a', 'attack:charged', 'attack:a']);
}
{
  // WHAT A TARGET WOULD GO ON TO DO is part of what destroying it is worth: a
  // share of its best attack on this squad as the board stands, for each
  // round it has left to make one in (two at most).
  const me = unit(1, 's1', 'mech', 0, 0, { facing: 1, weapons: [gun(6)] });
  const gunner = unit(2, 's2', 'mech', 3, 0, { weapons: [gun(6)], timing: 'firing' });
  const theirs = odds(0.2, 0.5, 0.3);
  const mine = odds(0, 0.5, 0);
  const asked = [];
  const table = (view, fires) => outlook(view, { 2: (kinds, timing) => { asked.push(`${kinds.join()}@${timing}`); return kinds[0] === 'attack' && fires ? looked([shot('attack:theirs', 1, theirs)], { seat: 's2' }) : null; } });
  const at = (round, more = {}) => viewOf([me, { ...gunner, ...more }], { round });
  const worth = (view, fires = true) => made({}, { threat: W.threat }).choose(ask(view, [shot('attack:a', 2, mine), end()], { here: () => table(view, fires) }), view, rng).score;
  const v1 = at(1);
  check('an attack on an enemy with this squad in its sights is worth more by what that enemy would go on to do: its best attack, by the weight, for two rounds',
    [near(worth(v1), gainOf(mine, gunner, v1, W, W.threat * gainOf(theirs, me, v1, W) * 2)), asked.includes('attack@firing'), W.threat > 0, W.threatRounds], [true, true, true, 2]);
  const v5 = at(5);
  const v5done = at(5, { done: true });
  check('in the last round it has one turn left to make it in, and none if that turn is behind it',
    [near(worth(v5), gainOf(mine, gunner, v5, W, W.threat * gainOf(theirs, me, v5, W))), near(worth(v5done), gainOf(mine, { ...gunner, done: true }, v5done, W))], [true, true]);
  check('with nobody in its sights now it is still a gun: its share of what it is worth, for as long',
    near(worth(v1, false), gainOf(mine, gunner, v1, W, W.threat * W.jamIdle * unitWorth(gunner, v1, W) * 2)), true);
  check('and an enemy with no gun threatens nothing', near(made({}, { threat: W.threat }).choose(ask(viewOf([me, { ...gunner, weapons: [] }]), [shot('attack:a', 2, mine), end()], { here: () => table(v1, true) }), viewOf([me, { ...gunner, weapons: [] }]), rng).score,
    gainOf(mine, gunner, v1, W)), true);
  // Its own Range of the enemy is as close as the walk to a fight takes it.
  const far = unit(2, 's2', 'drone', 4, 0, { points: 60 });
  const fv = viewOf([me, far]);
  const closer = step(1, 0, 1);
  check('the walk to a fight ends at its own Range: with the enemy inside its arm already, a step nearer is worth nothing, and with a shorter arm it is worth the step',
    [made({}, { contactStep: 0.04 }).choose(ask(fv, [closer, end()]), fv, rng).option,
      made({}, { contactStep: 0.04 }).choose(ask(viewOf([{ ...me, weapons: [gun(2)] }, far]), [closer, end()]), viewOf([{ ...me, weapons: [gun(2)] }, far]), rng).option], ['end', closer.id]);
  // OUTRANGED (`closeIn`): a Mech with a gun of 2 that an enemy rifle of 8
  // reaches where it stands counts its step toward contact five times over at
  // `closeIn` 4; against a gun no longer than its own, once.
  const shortArm = { ...me, weapons: [gun(2)] };
  const sniper = unit(3, 's2', 'mech', 6, 0, { weapons: [gun(8)] });
  const brawler = unit(3, 's2', 'mech', 6, 0, { weapons: [gun(2)] });
  const pace = (foe, w) => { const v = viewOf([shortArm, foe]); return made({}, { contactStep: 0.04, ...w }).choose(ask(v, [closer, end()]), v, rng); };
  check('OUTRANGED (`closeIn` 4): the step toward an enemy whose rifle outreaches it where it stands counts five times over; toward one whose gun is no longer, once',
    [pace(sniper, {}).option, near(pace(sniper, { closeIn: 4 }).score, 5 * pace(sniper, {}).score), near(pace(brawler, { closeIn: 4 }).score, pace(brawler, {}).score)], [closer.id, true, true]);
}
{
  // A MOVE THAT OPENS AN ATTACK. Nothing to attack from where it stands; from
  // the Grid ahead, facing the Drone, there is.
  const me = unit(1, 's1', 'mech', 0, 0, { facing: 0, weapons: [gun(6)] });
  const foe = unit(2, 's2', 'drone', 3, 0, { points: 60 });
  const v = viewOf([me, foe]);
  const asked = [];
  const there = (id, f) => (kinds) => { asked.push(id); return kinds.includes('attack') ? looked([shot('attack:there', 2, f)]) : null; };
  const toward = step(1, 0, 1, { then: there('toward', odds(0.5, 0.5, 0)) });
  const away = step(0, 1, 3, { then: there('away', odds(0.9, 0.9, 0)) });
  const c = plain.choose(ask(v, [toward, away, end()]), v, rng);
  check('with nothing to attack from where it stands it moves to where it could: a move is worth the attack the engine says it leads to',
    [c.option, c.reason, near(c.score, gainOf(odds(0.5, 0.5, 0), foe, v, W))], [toward.id, 'move_to_attack', true]);
  check('and the engine is asked only about a Grid geometry gives a chance: one that ends with the enemy behind it is not asked about at all', [...new Set(asked)], ['toward']);
  const now = shot('attack:now', 2, odds(0.5, 0.5, 0));
  check('a move is not made for an attack no better than the one it has: staying is worth a little by itself',
    plain.choose(ask(v, [now, toward, end()]), v, rng).option, 'attack:now');
  check('and is made for a better one',
    plain.choose(ask(v, [now, step(1, 0, 1, { then: () => looked([shot('attack:there', 2, odds(0.8, 0.8, 0))]) }), end()]), v, rng).option, toward.id);
  // A Drone that has moved has nothing left to do, so it is not asked.
  const drone = unit(1, 's1', 'drone', 0, 0, { facing: 1, weapons: [gun(6, { mode: 'auto', timing: undefined })] });
  const dv = viewOf([drone, foe]);
  let dronesAsked = 0;
  plain.choose(ask(dv, [step(1, 0, 1, { then: () => { dronesAsked += 1; return null; } }), end()], { kind: 'activation.act' }), dv, rng);
  check('a Drone\'s activation is a move or an Action, so nothing is asked of what it could do after a move', dronesAsked, 0);
}
{
  // WHAT IT COULD DO A TURN LATER. Nothing to attack now, here or after a move;
  // from one Grid there would be at its next turn.
  const me = unit(1, 's1', 'mech', 0, 0, { facing: 1, weapons: [gun(6)] });
  const foe = unit(2, 's2', 'drone', 3, 0, { points: 60 });
  const v = viewOf([me, foe]);
  const timings = [];
  const later = (kinds, timing) => { timings.push(timing); return looked([shot('attack:later', 2, odds(0.5, 0.5, 0))]); };
  const ahead = step(1, 0, 1, { then: () => null, later });
  let c = plain.choose(ask(v, [ahead, end({ later: () => null })]), v, rng);
  check('a Grid it could attack from at its NEXT turn is worth that attack for less: a Mech is asked on the Timing its weapon opens',
    [c.option, c.reason, near(c.score, gainOf(odds(0.5, 0.5, 0), foe, v, W) * W.future), timings], [ahead.id, 'move_to_strike_next', true, ['firing']]);
  check('and where it stands is asked the same of, through the answer that ends its turn: it stays where the next turn is as good',
    plain.choose(ask(v, [ahead, end({ later })]), v, rng).option, 'end');
  // A Drone moved by a Command acts again in the same round.
  const drone = unit(1, 's1', 'drone', 0, 0, { facing: 1, weapons: [gun(6, { mode: 'auto', timing: undefined })] });
  const dv = viewOf([drone, foe], { phase: 0, phaseName: 'Command' });
  const seenTimings = [];
  const droneLater = (kinds, timing) => { seenTimings.push(timing ?? null); return looked([shot('attack:later', 2, odds(0.5, 0.5, 0))]); };
  c = plain.choose(ask(dv, [step(1, 0, 1, { later: droneLater }), end({ later: () => null })], { kind: 'activation.act' }), dv, rng);
  check('a Drone moved by a Command fires in the same round\'s Automatic Phase: its next turn is worth nearly the whole of the attack, and it names no Timing',
    [c.option, near(c.score, gainOf(odds(0.5, 0.5, 0), foe, dv, W) * W.futureSoon), seenTimings, W.futureSoon > W.future], [ahead.id, true, [null], true]);
}

{
  // THE MAIN TASK. A zone one Grid away; the table the move leaves is the one
  // on which this squad holds it.
  const me = unit(1, 's1', 'mech', 0, 0, { facing: 1 });
  const zones = [zone('echo', ['1,0'])];
  const v = viewOf([me], { task: CONTROL, zones });
  const held = viewOf([{ ...me, grid: { col: 1, row: 0 } }], { task: CONTROL, zones: [zone('echo', ['1,0'], { holder: 's1' })] });
  let looks = 0;
  const into = step(1, 0, 1, { after: () => { looks += 1; return outlook(held); } });
  const aside = step(0, 1, 2, { after: () => { looks += 1; return outlook(v); } });
  const c = only({ mission: true }).choose(ask(v, [aside, into, end()]), v, rng);
  check('a move into a zone the Main Task scores is worth what the Task gains on the table the move leaves: every round the dial would pay, from the board\'s own reading of who holds it',
    [c.option, c.reason, near(c.score, missionOf(held, W) - missionOf(v, W)), near(c.score, CONTROL.vp * (W.missionFuture + W.missionFuture ** 2 + W.missionFuture ** 3 + W.missionFuture ** 4))],
    [into.id, 'take_zone', true, true]);
  check('the table is looked at only for a move that begins or ends in a scoring zone', looks, 1);
  check('a policy with no thought for the Main Task ends its turn where it stands', plain.choose(ask(v, [aside, into, end()]), v, rng).option, 'end');
  // Standing in a zone it does not yet hold, it does not walk out of it.
  const inside = viewOf([{ ...me, grid: { col: 1, row: 0 } }], { task: CONTROL, zones: [zone('echo', ['1,0'], { holder: 's1' })] });
  const left = viewOf([me], { task: CONTROL, zones });
  const foe = unit(2, 's2', 'drone', 3, 0, { points: 60 });
  const out = step(0, 0, 1, { after: () => outlook(left), then: () => looked([shot('attack:there', 2, odds(0.4, 0.4, 0))]) });
  const withFoe = viewOf([{ ...me, grid: { col: 1, row: 0 }, weapons: [gun(6)] }, { ...foe, grid: { col: 6, row: 0 } }], { task: CONTROL, zones: [zone('echo', ['1,0'], { holder: 's1' })] });
  check('leaving a zone before the round ends gives it up: an attack worth less than the zone does not draw it out',
    [only({ mission: true }).choose(ask(withFoe, [out, end()]), withFoe, rng).option, gainOf(odds(0.4, 0.4, 0), foe, withFoe, W) < missionOf(inside, W) - missionOf(left, W)], ['end', true]);
  // The walk toward a zone, when nothing else tells two Grids apart.
  const far = viewOf([me], { task: CONTROL, zones: [zone('echo', ['4,0'])] });
  const nearer = step(1, 0, 1);
  const further = step(0, 1, 2);
  const walked = made({ mission: true }, { zoneStep: W.zoneStep }).choose(ask(far, [further, nearer, end()]), far, rng);
  check('with a zone too far to reach it walks toward it: each Grid nearer is worth the step, and that is all the walk is worth',
    [walked.option, walked.reason, near(walked.score, -3 * W.zoneStep)], [nearer.id, 'advance', true]);
  check('a Low Value unit holds no zone, and is not walked to one',
    made({ mission: true }, { zoneStep: W.zoneStep }).choose(ask(viewOf([{ ...me, lowValue: true }], { task: CONTROL, zones: [zone('echo', ['4,0'])] }), [further, nearer, end()]), viewOf([{ ...me, lowValue: true }], { task: CONTROL, zones: [zone('echo', ['4,0'])] }), rng).option, 'end');
}
{
  // THE WALK TO A ZONE IS PRICED BY WHAT THE ZONE WILL PAY, from the round the
  // unit would stand in it: the engine says how many activations the walk is.
  const me = unit(1, 's1', 'mech', 0, 0, { facing: 1 });
  const pulled = (weights = {}) => made({ mission: true }, { zonePull: W.zonePull, zoneStep: W.zoneStep, ...weights });
  const walkBy = (table) => (uid, from) => from.map((g) => table[`${g.col},${g.row}`] ?? null);
  const board = (zones, units = [me], more = {}) => viewOf(units, { task: CONTROL, round: 2, zones, ...more });
  // From the Grid ahead the zone is one activation off; from the Grid aside,
  // and from where it stands, two.
  const field = { '1,0': { grids: 3, turns: 1 }, '0,1': { grids: 5, turns: 2 }, '0,0': { grids: 4, turns: 2 } };
  const ahead = step(1, 0, 1);
  const aside = step(0, 1, 2);
  const v = board([zone('echo', ['4,0'])]);
  const put = (view, table, options = [aside, ahead, end()]) => ask(view, options, { here: () => outlook(view, {}, undefined, { walk: walkBy(table) }) });
  let c = pulled().choose(put(v, field), v, rng);
  check('a Grid is worth what the zone will pay from the round the unit would be standing in it: one activation off, that is from next round',
    [c.option, c.reason, near(c.score, CONTROL.vp * payFrom(3, v, W) * W.zonePull - 3 * W.zoneStep)], [ahead.id, 'advance', true]);
  const level = { ...field, '1,0': { grids: 3, turns: 2 } };
  check('a Grid two activations off is a round of its pay behind, and of two Grids the same number of activations off only the Grids on the road tell them apart',
    [pulled().choose(put(v, level), v, rng).option, near(pulled().choose(put(v, level), v, rng).score, CONTROL.vp * payFrom(4, v, W) * W.zonePull - 3 * W.zoneStep),
      payFrom(3, v, W) > payFrom(4, v, W)], [ahead.id, true, true]);
  const theirs = board([zone('echo', ['4,0'], { control: 's2' })]);
  c = pulled().choose(put(theirs, field), theirs, rng);
  check('a zone the other squad\'s dial names is worth twice the walk: taking it pays, and ends what it pays them',
    near(c.score, 2 * CONTROL.vp * payFrom(3, theirs, W) * W.zonePull - 3 * W.zoneStep), true);
  const guard = unit(2, 's2', 'drone', 4, 0, { points: 20 });
  const guarded = board([zone('echo', ['4,0'], { holder: 's2' })], [me, guard]);
  c = pulled().choose(put(guarded, field), guarded, rng);
  check('a zone an enemy unit stands in cannot be taken while it stands there: the walk to it is worth its share of that',
    [near(c.score, 2 * W.zoneHeld * CONTROL.vp * payFrom(3, guarded, W) * W.zonePull - 3 * W.zoneStep), W.zoneHeld < 1], [true, true]);
  const ours = board([zone('echo', ['4,0'], { control: 's1' })]);
  const lastRound = board([zone('echo', ['4,0'])], [me], { round: 5 });
  check('a zone that is the squad\'s already is not walked to, and neither is one no road leads to; a zone it could not stand in before the last round ends is worth only the steps',
    [pulled().choose(put(ours, field), ours, rng).option, pulled().choose(put(v, {}), v, rng).option, near(pulled().choose(put(lastRound, field), lastRound, rng).score, -3 * W.zoneStep)],
    ['end', 'end', true]);
  // Of two zones, the one worth most from each Grid.
  const two = board([zone('echo', ['4,0']), zone('hotel', ['0,4'], { control: 's2' })]);
  const other = { '1,0': { grids: 5, turns: 2 }, '0,1': { grids: 3, turns: 1 }, '0,0': { grids: 4, turns: 2 } };
  const fields = (uid, from, to) => from.map((g) => (to[0].col === 4 ? field : other)[`${g.col},${g.row}`] ?? null);
  c = pulled().choose(ask(two, [aside, ahead, end()], { here: () => outlook(two, {}, undefined, { walk: fields }) }), two, rng);
  check('with two zones to walk to, each Grid is worth the better of them from there: here the one the other squad holds, at twice the pay',
    [c.option, near(c.score, 2 * CONTROL.vp * payFrom(3, two, W) * W.zonePull - 3 * W.zoneStep)], [aside.id, true]);
  // A Movement still unspent is counted before the walk is.
  const sprinter = unit(1, 's1', 'mech', 0, 0, { facing: 1, weapons: [{ ...gun(4), type: 'Moving', timing: 'movement', actionId: 'sprint' }] });
  const sv = board([zone('echo', ['5,0'])], [sprinter]);
  const sprint = { id: 'move:sprint:1,0:1', label: 'Sprint to 1,0', tags: ['move', 'facing:1'], commands: [{}], facts: { uid: 1, to: { c: 1, r: 0 }, facing: 1, grids: 1, actionId: 'sprint' } };
  const asked = [];
  // With a Sprint left the zone is reached this activation; with the Maneuver left, or nothing, it is an activation off.
  const reach = (uid, from, to, left) => from.map((g) => { asked.push({ at: `${g.col},${g.row}`, left: left ? left.join('+') : null }); return { grids: 5 - g.col, turns: left?.includes(4) ? 0 : 1 }; });
  c = pulled().choose(ask(sv, [sprint, ahead, end()], { here: () => outlook(sv, {}, undefined, { walk: reach }) }), sv, rng);
  check('a Maneuver leaves the Movement Action unspent, and the walk is counted from after it: the Maneuver first, with the Sprint still to make, is in the zone THIS round. A Sprint leaves nothing: the Maneuver comes before any Action (3.4.5)',
    [c.option, near(c.score, CONTROL.vp * payFrom(2, sv, W) * W.zonePull - 4 * W.zoneStep),
      asked.filter((x) => x.at === '1,0').map((x) => x.left), asked.filter((x) => x.at === '0,0').map((x) => x.left)],
    [ahead.id, true, [null, '4'], [null]]);
  asked.length = 0;
  const firing = step(1, 0, 1, { then: () => looked([shot('attack:there', 2, odds(0.5, 0.5, 0))]) });
  const prey = unit(2, 's2', 'drone', 3, 0, { points: 60 });
  const fv = board([zone('echo', ['5,0'])], [{ ...sprinter, weapons: [...sprinter.weapons, gun(6)] }, prey]);
  pulled().choose(ask(fv, [sprint, firing, end()], { here: () => outlook(fv, {}, undefined, { walk: reach }) }), fv, rng);
  check('and a Maneuver made for an attack spends the activation on the attack: nothing is counted as left for the walk',
    asked.filter((x) => x.at === '1,0').map((x) => x.left), [null]);
  // INTO A ZONE BY TWO MOVEMENTS, planned as one. The Maneuver leaves the
  // Sprint, and the Sprint from there reaches the zone: the engine is asked
  // what the Sprint would offer, and the plan ends in the zone.
  const taken = viewOf([{ ...sprinter, grid: { col: 5, row: 0 } }], { task: CONTROL, round: 2, zones: [zone('echo', ['5,0'], { holder: 's1' })] });
  const into = { id: 'move:sprint:5,0:1', label: 'Sprint to 5,0', tags: ['move', 'facing:1'], commands: [{}], facts: { uid: 1, to: { c: 5, r: 0 }, facing: 1, grids: 4, actionId: 'sprint' }, after: () => outlook(taken) };
  const shy = { ...into, id: 'move:sprint:3,0:1', label: 'Sprint to 3,0', facts: { ...into.facts, to: { c: 3, r: 0 } }, after: () => outlook(sv) };
  const followed = [];
  const first = step(1, 0, 1, { then: (kinds) => { followed.push(kinds.join()); return looked([shy, into]); } });
  c = pulled().choose(ask(sv, [sprint, first, end()], { here: () => outlook(sv, {}, undefined, { walk: reach }) }), sv, rng);
  check('where a Maneuver leaves a Sprint that reaches a zone, the two are planned as one: the engine is asked what the Sprint would offer, the plan ends IN the zone, and it is worth what the Main Task gains on the table it leaves',
    [c.option, c.reason, near(c.score, missionOf(taken, W) - missionOf(sv, W)), c.why.includes('and then Sprint to 5,0'), followed], [first.id, 'take_zone', true, true, ['move']]);
  followed.length = 0;
  const far2 = (uid, from, to, left) => from.map((g) => ({ grids: 9 - g.col, turns: left?.includes(4) ? 1 : 2 }));
  pulled().choose(ask(sv, [sprint, first, end()], { here: () => outlook(sv, {}, undefined, { walk: far2 }) }), sv, rng);
  check('and where the Sprint would not reach, the engine is not asked what it would offer', followed, []);
  // It is priced for standing in the zone, not for the Grid the Maneuver passes through.
  const gunner = unit(2, 's2', 'mech', 9, 0, { weapons: [gun(6)], timing: 'firing' });
  const hv = board([zone('echo', ['5,0'])], [sprinter, gunner]);
  const takenUnderFire = viewOf([{ ...sprinter, grid: { col: 5, row: 0 } }, gunner], { task: CONTROL, round: 2, zones: [zone('echo', ['5,0'], { holder: 's1' })] });
  const hit = odds(0, 0.5, 0.5);
  const sights = { 2: (kinds) => (kinds[0] === 'strike:1' ? looked([shot('attack:it', 1, hit)], { seat: 's2' }) : null) };
  const exposedEntry = { ...into, after: () => outlook(takenUnderFire, sights) };
  const quiet = step(1, 0, 1, { then: () => looked([exposedEntry]), after: () => outlook(hv, {}) });
  c = made({ mission: true, exposure: true }, { zonePull: W.zonePull, zoneStep: W.zoneStep }).choose(ask(hv, [sprint, quiet, end()], { here: () => outlook(hv, {}, undefined, { walk: reach }) }), hv, rng);
  check('it is priced for standing in the zone, where the plan ends, and not for the Grid the Maneuver passes through: the gun on the zone is its cost',
    [c.option, c.reason, c.why.includes(`cost ${(W.exposure * gainOf(hit, sprinter, hv, W)).toFixed(2)}`)], [quiet.id, 'take_zone', true]);
  // With no board to ask (a question nobody hung a table on), the crow's flight at the unit's stride.
  const bare = { id: 'q', kind: 'opp.act', seat: 's1', unit: 1, options: [sprint, ahead, end()], fallback: 'end', facts: {} };
  c = pulled().choose(bare, sv, rng);
  check('with no board to ask, a walk is the crow\'s flight at the unit\'s stride (its Maneuver and its Sprint): four Grids from the Grid ahead, with a Movement still to make, is this round',
    [c.option === sprint.id || c.option === ahead.id, near(c.score, CONTROL.vp * payFrom(2, sv, W) * W.zonePull - 4 * W.zoneStep)], [true, true]);
}
{
  // AN ENEMY WITH A BETTER TARGET (`decoy`; OTTO's playtest, 2026-10-03): it
  // shoots this unit only as often as this unit is worth shooting against the
  // best other unit of the squad in its sights as the board stands.
  const me = unit(1, 's1', 'mech', 0, 0, { facing: 1 });
  const mate = unit(3, 's1', 'mech', 1, 1, { facing: 1 });
  const foe = unit(2, 's2', 'mech', 4, 0, { weapons: [gun(6)], timing: 'firing' });
  const v = viewOf([me, mate, foe]);
  const onMe = odds(0.4, 0.4, 0);
  const sights = (onMate) => ({ 2: (kinds) => (kinds[0] === 'strike:1' ? looked([shot('attack:me', 1, onMe)], { seat: 's2' })
    : kinds[0] === 'attack' ? looked([shot('attack:me', 1, onMe), ...(onMate ? [shot('attack:mate', 3, onMate)] : [])], { seat: 's2' }) : null) });
  const stay = (onMate, decoy) => weighed(ask(v, [end()], { here: () => outlook(v, sights(onMate)) }), v, { ...Object.fromEntries(Object.keys(SKILLS).map((k) => [k, false])), exposure: true }, { ...still, decoy }).find((p) => p.how === 'stay');
  const better = odds(0.9, 0.9, 0);
  const share = gainOf(onMe, me, v, W) / gainOf(better, mate, v, W);
  const [plain0, plain1, plain2] = [stay(better, 0), stay(better, 1), stay(better, 2)];
  check('with a better target of the squad\'s in the enemy\'s sights, what it could do to this unit counts that much less (as a share, to the power `decoy`), its chance to destroy it too',
    [share < 1, near(plain1.cost, plain0.cost * share), near(plain2.cost, plain0.cost * share * share), near(plain0.risk, 0.4), near(plain1.risk, 0.4 * share), near(plain2.risk, 0.4 * share * share)],
    [true, true, true, true, true, true]);
  const [none0, none1] = [stay(null, 0), stay(null, 1)];
  const [worse0, worse1] = [stay(odds(0.1, 0.1, 0), 0), stay(odds(0.1, 0.1, 0), 1)];
  check('with no other target in its sights, or only a worse one, this unit is what it would shoot: `decoy` changes nothing',
    [near(none1.cost, none0.cost), near(none1.risk, none0.risk), near(worse1.cost, worse0.cost), near(worse1.risk, worse0.risk), none0.cost > 0], [true, true, true, true, true]);
  check('and as shipped `decoy` is 1: an enemy with the better target in its sights shoots this unit that much less', [W.decoy, near(stay(better, W.decoy).cost, plain1.cost)], [1, true]);
}
{
  // WHAT THE OTHER SQUAD COULD DO TO IT THERE. Two Grids to move to, alike in
  // everything but this: in one an enemy Mech has it in its sights.
  const me = unit(1, 's1', 'mech', 0, 0, { facing: 1 });
  const foe = unit(2, 's2', 'mech', 4, 0, { weapons: [gun(6)], timing: 'firing' });
  const v = viewOf([me, foe]);
  const hit = odds(0.1, 0.4, 0.5);
  const calls = [];
  // The enemy's own turn, on a table: its attacks on the unit named, and what
  // is left behind the first.
  const turns = (shots) => ({ 2: (kinds, timing) => { calls.push(`${kinds.join()}@${timing}`); return kinds[0] === 'strike:1' && shots.length ? looked(shots, { seat: 's2' }) : null; } });
  const second = shot('attack:second', 1, odds(0, 0.2, 0.2));
  const first = shot('attack:first', 1, hit, { then: () => looked([second], { seat: 's2' }) });
  const open = step(1, 0, 1, { after: () => outlook(v, turns([first])) });
  const cover = step(0, 1, 1, { after: () => outlook(v, turns([])) });
  const d = ask(v, [open, cover, end()], { here: () => outlook(v, turns([first])) });
  const c = only({ exposure: true }).choose(d, v, rng);
  const cost = W.exposure * (gainOf(hit, me, v, W) + gainOf(second.chance(), me, v, W));
  check('it ends its move where the enemy could do least to it: the Grid in the enemy\'s sights costs what its attacks there are worth to the enemy, the first and what could follow it',
    [c.option, c.reason, near(c.score, 0)], [cover.id, 'take_cover', true]);
  check('the enemy is asked as its own seat would be, on the Timing of the dial it shows, for its attacks on this unit alone; and where it has none from where it stands, for the step that would bring one to bear',
    [calls.includes('strike:1@firing'), calls.includes('reach:1@firing'), calls.every((x) => x.endsWith('@firing'))], [true, true, true]);
  const exposed = only({ exposure: true }).choose(ask(v, [open, end()], { here: () => outlook(v, turns([first])) }), v, rng);
  check('with nowhere better to go it stays, and says what staying costs', [exposed.option, exposed.why.includes(`cost ${cost.toFixed(2)}`)], ['end', true]);
  check('a policy with no thought for it walks into the sights for the price of a step',
    made({}, { contactStep: 0.04 }).choose(ask(viewOf([{ ...me, weapons: [gun(2)] }, foe]), [open, cover, end()], { here: () => outlook(v, turns([first])) }), viewOf([{ ...me, weapons: [gun(2)] }, foe]), rng).option, open.id);
  // An enemy that must step out first.
  const stepped = [];
  const lurk = { 2: (kinds) => {
    if (kinds[0] === 'strike:1') return null;
    if (kinds[0] === 'reach:1') return looked([{ ...step(3, 0, 3), then: (k) => { stepped.push(k.join()); return looked([first], { seat: 's2' }); } }], { seat: 's2' });
    return null;
  } };
  const peek = only({ exposure: true }).choose(ask(v, [step(1, 0, 1, { after: () => outlook(v, lurk) }), cover, end()], { here: () => outlook(v, lurk) }), v, rng);
  check('an enemy that has no attack from where it stands is asked for the Maneuver that would give it one, and what it could do after it counts the same',
    [peek.option, stepped.includes('strike:1')], [cover.id, true]);
  // An enemy whose turn is behind it counts for less: it comes a round later.
  const spent = viewOf([me, { ...foe, done: true }]);
  const late = only({ exposure: true }).choose(ask(spent, [open, end()], { here: () => outlook(spent, turns([first])) }), spent, rng);
  check('an enemy whose turn is still to come this round counts for more than one whose turn is a round away',
    [late.why.includes(`cost ${(cost * W.exposureLater / W.exposure).toFixed(2)}`), W.exposure > W.exposureLater], [true, true]);
  // A dial this seat cannot see: asked on what the enemy would most likely want.
  const hidden = viewOf([me, { ...foe, timing: undefined, dialHidden: true }], { phase: 1, phaseName: 'Planning' });
  calls.length = 0;
  only({ exposure: true }).choose(ask(hidden, [open, end()], { here: () => outlook(hidden, turns([first])) }), hidden, rng);
  check('an enemy Mech whose dial is not known is asked on Firing, having a gun; and on Melee too only when close enough to use one',
    [[...new Set(calls.map((x) => x.split('@')[1]))], (() => { calls.length = 0; const close = viewOf([me, { ...foe, grid: { col: 2, row: 0 }, timing: undefined }], { phase: 1, phaseName: 'Planning' });
      only({ exposure: true }).choose(ask(close, [end()], { here: () => outlook(close, turns([first])) }), close, rng); return [...new Set(calls.map((x) => x.split('@')[1]))]; })()],
    [['firing'], ['firing', 'melee']]);
  // An enemy too far off to matter is not asked at all.
  calls.length = 0;
  const distant = viewOf([me, { ...foe, grid: { col: 11, row: 0 } }]);
  only({ exposure: true }).choose(ask(distant, [step(1, 0, 1, { after: () => outlook(distant, turns([first])) }), end()], { here: () => outlook(distant, turns([first])) }), distant, rng);
  check('an enemy out of its Range, its step and some slack is not asked about at all: such a Grid costs nothing to price', calls, []);
  // A Projectile is there to be spent.
  calls.length = 0;
  const missile = viewOf([{ ...me, kind: 'projectile' }, foe]);
  only({ exposure: true }).choose(ask(missile, [end()], { here: () => outlook(missile, turns([first])), kind: 'activation.act' }), missile, rng);
  check('nothing is asked about a Projectile: nothing done to it is a loss', calls, []);
}
{
  // IT MAY NOT BE THERE WHEN THE ROUND ENDS. A zone to take, in the sights of
  // an enemy that would destroy the unit half the time.
  const me = unit(1, 's1', 'drone', 0, 0, { facing: 1, points: 20 });
  const foe = unit(2, 's2', 'mech', 4, 0, { weapons: [gun(6)], timing: 'firing' });
  const zones = [zone('echo', ['1,0'])];
  const v = viewOf([me, foe], { task: CONTROL, zones });
  const held = viewOf([{ ...me, grid: { col: 1, row: 0 } }, foe], { task: CONTROL, zones: [zone('echo', ['1,0'], { holder: 's1' })] });
  const kill = odds(0.5, 0.5, 0);
  const sights = { 2: (kinds) => (kinds[0] === 'strike:1' ? looked([shot('attack:it', 1, kill)], { seat: 's2' }) : null) };
  const into = step(1, 0, 1, { after: () => outlook(held, sights) });
  const c = only({ mission: true, exposure: true }).choose(ask(v, [into, end()], { kind: 'activation.act' }), v, rng);
  const gain = missionOf(held, W) - missionOf(v, W);
  check('a zone is taken only by a unit still standing in it when the round ends: what the Task would gain is scaled by the chance it survives the enemies still to act, and its own loss is taken off',
    [c.option, near(c.score, gain * 0.5 - W.exposure * gainOf(kill, me, v, W)), c.why.includes('50% to be lost')], [into.id, true, true]);
  const done = viewOf([me, { ...foe, done: true }], { task: CONTROL, zones });
  const safe = only({ mission: true, exposure: true }).choose(ask(done, [step(1, 0, 1, { after: () => outlook(held, sights) }), end()], { kind: 'activation.act' }), done, rng);
  check('an enemy whose turn is behind it cannot stop it this round: the zone counts in full',
    near(safe.score, gain - W.exposureLater * gainOf(kill, me, done, W)), true);
  // A unit of one Part goes from Intact to Damaged to Destroyed, and every
  // forecast is made of it as it stands: two attacks that each say "Damaged,
  // never destroyed" destroy it between them.
  const dent = odds(0, 0, 0.8);
  const twice = { 2: (kinds) => (kinds[0] === 'strike:1' ? looked([shot('attack:1', 1, dent, { then: () => looked([shot('attack:2', 1, dent)], { seat: 's2' }) })], { seat: 's2' }) : null) };
  const walked = only({ mission: true, exposure: true }).choose(ask(v, [step(1, 0, 1, { after: () => outlook(held, twice) }), end()], { kind: 'activation.act' }), v, rng);
  check('a Drone with Structure left is destroyed by two attacks that each only Damage it: the second finds it Damaged, and destroys it as often as it Penetrates',
    [walked.why.includes('64% to be lost'), near(walked.score, gain * (1 - 0.64) - W.exposure * 2 * gainOf(dent, me, v, W))], [true, true]);
  const worn = { ...me, parts: [part('main', 20, 'damaged')] };
  const wv = viewOf([worn, foe], { task: CONTROL, zones });
  const once = { 2: (kinds) => (kinds[0] === 'strike:1' ? looked([shot('attack:1', 1, odds(0.8, 0.8, 0))], { seat: 's2' }) : null) };
  check('one already Damaged is destroyed by the first that Penetrates, as its forecast says',
    only({ mission: true, exposure: true }).choose(ask(wv, [step(1, 0, 1, { after: () => outlook(held, once) }), end()], { kind: 'activation.act' }), wv, rng).why.includes('80% to be lost'), true);
  // A Mech has several Parts: an attack that Damages one does not bring the next nearer to destroying it.
  const mech = unit(1, 's1', 'mech', 0, 0, { facing: 1 });
  const mv = viewOf([mech, foe], { task: CONTROL, zones });
  const mheld = viewOf([{ ...mech, grid: { col: 1, row: 0 } }, foe], { task: CONTROL, zones: [zone('echo', ['1,0'], { holder: 's1' })] });
  const safeMech = only({ mission: true, exposure: true }).choose(ask(mv, [step(1, 0, 1, { after: () => outlook(mheld, twice) }), end()]), mv, rng);
  check('a Mech is not followed that way: its Parts are several, and it is lost as often as its attackers\' forecasts say it is',
    [safeMech.option, safeMech.why.includes('to be lost')], [step(1, 0, 1).id, false]);
}
{
  // THE ROUND AFTER. A Commander on a VIP mission, and an enemy Mech too far
  // off to attack it this round: it could Sprint up now and fire next round
  // before the Commander has moved again.
  const lead = unit(1, 's1', 'mech', 0, 0, { facing: 1, commander: true });
  const foe = unit(2, 's2', 'mech', 11, 0, { weapons: [gun(6)], timing: 'firing' });
  const v = viewOf([lead, foe], { task: VIP });
  const hit = odds(0, 0.5, 0.5);
  const asked = [];
  // Where the enemy's Movement could end, and what it could do from each a round on.
  const sprintTo = (c, r) => ({ id: `move:sprint:${c},${r}:3`, label: `Sprint to ${c},${r}`, tags: ['move', 'facing:3'], commands: [{}], facts: { uid: 2, to: { c, r }, facing: 3, grids: 4, actionId: 'sprint' },
    later: (kinds, timing) => { asked.push(`later:${c},${r}:${kinds.join()}@${timing}`); return kinds[0] === 'strike:1' ? looked([shot('attack:it', 1, hit)], { seat: 's2' }) : null; } });
  // The board: a unit is seen from every Grid the enemy could walk to unless it stands in the Grid at 0,1.
  const table = (at) => outlook(v,
    { 2: (kinds, timing) => { asked.push(`${kinds.join()}@${timing}`); return kinds[0] === 'move' ? looked([sprintTo(5, 0), sprintTo(9, 0)], { seat: 's2' }) : null; } },
    (uid, grids, from) => grids.map((g) => (from ? from.map((f, i) => (!(g.col === 0 && g.row === 1) ? i : -1)).filter((i) => i >= 0) : [])));
  const open = step(1, 0, 1, { after: () => table() });
  const hidden = step(0, 1, 1, { after: () => table() });
  const wary = (weights = {}) => made({ exposure: true }, { ahead: 0.5, ...weights });
  let c = wary().choose(ask(v, [open, hidden, end()], { here: () => table() }), v, rng);
  check('a Commander counts what an enemy Mech that cannot attack it this round could do NEXT round, having walked up: it ends its move where the Grids that Mech could walk to would not see it',
    [c.option, c.reason, near(c.score, 0)], [hidden.id, 'take_cover', true]);
  check('the enemy is asked where its Movement could end, and from the Grid of those inside its arm that would see the Commander, what it could do when its next turn comes',
    [asked.includes('move@movement'), asked.includes('later:5,0:strike:1@firing'), asked.some((x) => x.startsWith('later:9,0'))], [true, true, false]);
  const stays = wary().choose(ask(v, [open, end()], { here: () => table() }), v, rng);
  check('with nowhere out of sight it stays, and says what the round after would cost: the weight\'s share of that attack',
    [stays.option, stays.why.includes(`cost ${(0.5 * gainOf(hit, lead, v, W)).toFixed(2)}`)], ['end', true]);
  asked.length = 0;
  const plainMech = viewOf([{ ...lead, commander: false }, foe], { task: VIP });
  const elsewhere = viewOf([lead, foe], { task: CONTROL });
  wary().choose(ask(plainMech, [open, hidden, end()], { here: () => table() }), plainMech, rng);
  wary().choose(ask(elsewhere, [open, hidden, end()], { here: () => table() }), elsewhere, rng);
  wary({ ahead: 0 }).choose(ask(v, [open, hidden, end()], { here: () => table() }), v, rng);
  check('it is asked for a Commander on a VIP mission alone, and only with a weight on it: nothing is asked for another Mech, on another mission, or at no weight', asked, []);
  asked.length = 0;
  const done = viewOf([lead, { ...foe, done: true }], { task: VIP });
  wary().choose(ask(done, [open, hidden, end()], { here: () => table() }), done, rng);
  check('an enemy whose turn of this round is behind it walks nowhere before the next: it is not asked', asked, []);
  // AN EXCHANGE. What the Commander would do to the Mech that walked up, from
  // where it stands, is taken off what that Mech could do to it; and with two
  // Mechs coming it answers one of them.
  const armed = unit(1, 's1', 'mech', 0, 0, { facing: 1, commander: true, weapons: [gun(6)] });
  const second = unit(3, 's2', 'mech', 11, 1, { weapons: [gun(6)], timing: 'firing' });
  const mineOn = (f) => (kinds) => (kinds[0].startsWith('strike:') ? looked([shot('attack:mine', Number(kinds[0].slice(7)), f)]) : null);
  const arrives = (uid, answer) => ({ id: `move:sprint:5,0:3:${uid}`, label: 'Sprint to 5,0', tags: ['move', 'facing:3'], commands: [{}], facts: { uid, to: { c: 5, r: 0 }, facing: 3, grids: 4, actionId: 'sprint' },
    later: (kinds) => (kinds[0] === 'strike:1' ? looked([shot('attack:it', 1, hit)], { seat: 's2' }) : null),
    after: () => outlook(av, { 1: answer }) });
  // The Mech coming is the other squad's Commander: worth the game to destroy.
  const boss = { ...foe, commander: true };
  const av = viewOf([armed, boss, second], { task: VIP });
  const duel = (answer, uids) => outlook(av, Object.fromEntries(uids.map((uid) => [uid, (kinds) => (kinds[0] === 'move' ? looked([arrives(uid, answer)], { seat: 's2' }) : null)])),
    (uid, grids, from) => grids.map(() => (from ? from.map((f, i) => i) : [])));
  const theirs = gainOf(hit, armed, av, W);
  const said = (answer, uids, riposte = 1) => made({ exposure: true }, { ahead: 0.5, riposte, threat: 0 }).choose(ask(av, [end()], { here: () => duel(answer, uids) }), av, rng).why;
  const weak = odds(0, 0.1, 0.1);
  const strong = odds(0.5, 0.9, 0);
  check('the round after is an exchange: what the Commander could do to the Mech that walked up is taken off what that Mech could do to it',
    [said(mineOn(weak), [2]).includes(`cost ${(0.5 * (theirs - gainOf(weak, boss, av, W))).toFixed(2)}`), gainOf(weak, boss, av, W) > 0, gainOf(weak, boss, av, W) < theirs], [true, true, true]);
  check('a Commander that outguns the one Mech coming at it has nothing to hide from',
    [said(mineOn(strong), [2]).includes('cost 0.00'), gainOf(strong, boss, av, W) > theirs], [true, true]);
  check('and with two Mechs coming it answers one of them: all they could do, less the best it could do to one',
    [said(mineOn(strong), [2, 3]).includes(`cost ${(0.5 * Math.max(0, 2 * theirs - gainOf(strong, boss, av, W))).toFixed(2)}`), 2 * theirs > gainOf(strong, boss, av, W), gainOf(strong, boss, av, W) > gainOf(strong, second, av, W)], [true, true, true]);
  check('how much of its own answer is taken off is a weight: at a half, half of it (so one Mech it outguns still costs it something), and at none it hides from any Mech that could walk up',
    [said(mineOn(strong), [2], 0.5).includes(`cost ${(0.5 * Math.max(0, theirs - 0.5 * gainOf(strong, boss, av, W))).toFixed(2)}`), theirs > 0.5 * gainOf(strong, boss, av, W),
      said(mineOn(strong), [2], 0).includes(`cost ${(0.5 * theirs).toFixed(2)}`), [W.ahead, W.riposte]], [true, true, true, [0.35, 0.5]]);
}
{
  // AN ENEMY HOLDING A ZONE. Destroyed before the round ends, it holds
  // nothing: the Task gains what the board without it says.
  const me = unit(1, 's1', 'mech', 0, 0, { facing: 1, weapons: [gun(6)] });
  const foe = unit(2, 's2', 'drone', 3, 0, { points: 60 });
  const zones = [zone('echo', ['3,0'], { holder: 's2' })];
  const v = viewOf([me, foe], { task: CONTROL, zones, round: 2 });
  const gone = viewOf([me], { task: CONTROL, zones: [zone('echo', ['3,0'])], round: 2 });
  const asked = [];
  const table = (after) => outlook(v, {}, undefined, { without: (uid) => { asked.push(uid); return outlook(after); } });
  const kill = odds(0.5, 0.5, 0);
  const fire = shot('attack:a', 2, kill);
  const keen = (weights = {}) => made({ mission: true }, { threat: 0, holder: 1, ...weights });
  let c = keen().choose(ask(v, [fire, end()], { here: () => table(gone) }), v, rng);
  const freed = missionOf(gone, W) - missionOf(v, W);
  check('an attack on a unit that holds a zone is worth, besides what it destroys, what the Main Task gains on the board without the unit, for the chance it is destroyed: the engine is asked what that board is',
    [c.option, near(c.score, gainOf(kill, foe, v, W) + 0.5 * freed), freed > 0, asked], ['attack:a', true, true, [2]]);
  asked.length = 0;
  keen({ holder: 0 }).choose(ask(v, [fire, end()], { here: () => table(gone) }), v, rng);
  check('with no weight on it the board is not asked at all', asked, []);
  check('by the weight on it: at none the attack is worth what it destroys, and at a half, half of what the board says',
    [near(keen({ holder: 0 }).choose(ask(v, [fire, end()], { here: () => table(gone) }), v, rng).score, gainOf(kill, foe, v, W)), near(keen({ holder: 0.5 }).choose(ask(v, [fire, end()], { here: () => table(gone) }), v, rng).score, gainOf(kill, foe, v, W) + 0.25 * freed)],
    [true, true]);
  const dialled = viewOf([me], { task: CONTROL, zones: [zone('echo', ['3,0'], { control: 's2' })], round: 2 });
  const named = viewOf([me, foe], { task: CONTROL, zones: [zone('echo', ['3,0'], { holder: 's2', control: 's2' })], round: 2 });
  check('a unit whose squad\'s dial already names the zone is worth nothing more for standing in it: the dial pays on without it',
    near(keen().choose(ask(named, [fire, end()], { here: () => outlook(named, {}, undefined, { without: () => outlook(dialled) }) }), named, rng).score, gainOf(kill, foe, named, W)), true);
  const off = viewOf([me, { ...foe, grid: { col: 3, row: 1 } }], { task: CONTROL, zones, round: 2 });
  asked.length = 0;
  keen().choose(ask(off, [fire, end()], { here: () => table(gone) }), off, rng);
  check('and of a unit standing in no zone the board is not asked at all', asked, []);
  // Two attacks that each only Damage a unit of one Part destroy it between them.
  const dent = odds(0, 0, 0.8);
  const pair = shot('attack:first', 2, dent, { then: (kinds) => (kinds.includes('attack') ? looked([shot('attack:second', 2, dent)]) : null) });
  c = keen().choose(ask(v, [pair, end()], { here: () => table(gone) }), v, rng);
  check('two attacks that each only Damage it destroy it between them, and that is counted for the zone: neither forecast says so by itself',
    near(c.score, 2 * gainOf(dent, foe, v, W) + 0.64 * freed), true);
}

{
  // HOW MUCH IS ASKED. Twelve Grids to move to, every one within an enemy
  // gun's Range; the nearer the enemy the more a Grid is worth before its
  // cost, and in every one of those the enemy has a shot. Cover is the Grid
  // furthest back, which only the board's sight says.
  const LIMITS = M.AI.TACTICIAN_LIMITS;
  const me = unit(1, 's1', 'mech', 0, 0, { facing: 1, weapons: [gun(1)] });
  const foe = unit(2, 's2', 'mech', 11, 0, { weapons: [gun(12)], timing: 'firing' });
  const v = viewOf([me, foe]);
  const hit = odds(0.2, 0.5, 0.5);
  const priced = [];
  const sights = (col) => ({ 2: (kinds) => { if (kinds[0] === 'strike:1') priced.push(col); return kinds[0] === 'strike:1' && col > 0 ? looked([shot('attack:it', 1, hit)], { seat: 's2' }) : null; } });
  const moves = [];
  for (let row = 1; row <= 3; row++) for (let col = 1; col <= 11; col++) moves.push(step(col, row, 1, { after: () => outlook(v, sights(col)) }));
  // One Grid behind a wall: in Range, and out of every line.
  const hole = step(0, 1, 1, { after: () => outlook(v, sights(0)) });
  const eyes = (uid, grids) => grids.map((g) => (g.col === 0 && g.row === 1 ? [] : [2]));
  const d = ask(v, [...moves, hole, end()], { here: () => outlook(v, sights(99), eyes) });
  const walking = { contactStep: 0.05 };
  const c = made({ exposure: true }, walking).choose(d, v, rng);
  check('with every plan it priced a costly one, it looks for cover where the board says fewest enemies would see it, and takes it',
    [c.option, c.reason, priced.includes(0)], [hole.id, 'take_cover', true]);
  check('the plans priced by asking the engine are capped: the ones worth most before their cost, then the ones fewest enemies would see, and never the whole board',
    [moves.length, priced.filter((x) => x !== 99).length <= LIMITS.PRICED + LIMITS.COVER, priced.filter((x) => x !== 99).length < moves.length], [33, true, true]);
  // The same board with the enemy's turn behind it and nothing to fear: no
  // cover is looked for.
  let looks = 0;
  const calm = ask(v, [...moves.map((m) => ({ ...m, after: () => outlook(v, {}) })), end()], { here: () => outlook(v, {}, (uid, grids) => { looks += 1; return grids.map(() => []); }) });
  made({ exposure: true }, walking).choose(calm, v, rng);
  check('where what it priced costs nothing, the board is not asked who would see it', looks, 0);
}
{
  // A COMMAND. Two Drones that may be given one, and passing.
  const mech = unit(9, 's1', 'mech', 0, 5);
  const a = unit(1, 's1', 'drone', 0, 0, { facing: 1, weapons: [gun(6, { mode: 'auto', timing: undefined })] });
  const b = unit(3, 's1', 'drone', 0, 2, { facing: 1, weapons: [gun(6, { mode: 'auto', timing: undefined })] });
  const foe = unit(2, 's2', 'drone', 9, 0, { points: 60 });
  const v = viewOf([mech, a, b, foe], { phase: 0, phaseName: 'Command' });
  // Under a Command, Drone 1 could move to where it has a shot in the
  // Automatic Phase; Drone 3 has nowhere better to be.
  const turn = (uid, options) => ({ id: `turn${uid}`, kind: 'activation.act', seat: 's1', unit: uid, options, fallback: 'end', facts: {}, here: () => outlook(v) });
  const fires = () => looked([shot('attack:auto', 2, odds(0.5, 0.5, 0))]);
  const order = (uid, options) => ({ id: `designate:${uid}`, label: `Command ${uid}`, tags: ['designate', 'drone'], commands: [{}], facts: { uid }, then: () => turn(uid, options) });
  const pass = { id: 'pass', label: 'Pass for the phase', tags: ['pass'], commands: [{}] };
  const useful = order(1, [step(3, 0, 1, { later: fires }), end({ later: () => null })]);
  const idle = order(3, [step(1, 2, 1, { later: () => null }), end({ later: () => null })]);
  const d = { id: 'c', kind: 'loop.designate.command', seat: 's1', options: [idle, useful, pass], fallback: 'pass', facts: {} };
  const c = only({ command: true }).choose(d, v, rng);
  check('a Command goes to the Drone it does most for: the one whose best plan beats its staying where it is by most',
    [c.option, c.reason, near(c.score, gainOf(odds(0.5, 0.5, 0), foe, v, W) * W.futureSoon - W.better)], ['designate:1', 'command_by_value', true]);
  const none = only({ command: true }).choose({ ...d, options: [idle, pass] }, v, rng);
  check('and where no Drone would gain by one, none is given', [none.option, none.reason], ['pass', 'command_withheld']);
  check('a policy with no thought for it gives a Command as the Brawler does: always', plain.choose({ ...d, options: [idle, pass] }, v, rng).option, 'designate:3');
  let breaths = 0;
  const pondered = await made({ command: true }).ponder(d, v, rng, async () => { breaths += 1; });
  check('worked out in steps, with a pause offered at each step of each Drone planned, it is the same Command', [pondered.option, pondered.reason, near(pondered.score, c.score), breaths >= 2], [c.option, c.reason, true, true]);
}
{
  // THE TIMING DIAL. Three Timings a Mech with a gun plays on; each opens an
  // Opportunity, and each is planned as the Opportunity would be.
  const me = unit(1, 's1', 'mech', 0, 0, { facing: 1, weapons: [gun(6)], timing: undefined });
  const foe = unit(2, 's2', 'drone', 3, 0, { points: 60 });
  const v = viewOf([me, foe], { phase: 1, phaseName: 'Planning' });
  const opened = (options, sights = {}) => ({ id: 'opened', kind: 'opp.act', seat: 's1', unit: 1, options, fallback: 'end', facts: {}, here: () => outlook(v, sights) });
  const dialOf = (timing, opens) => ({ id: `dial:${timing}`, label: timing, tags: ['dial', `timing:${timing}`], run: { routine: 'dial', args: { uid: 1, timing } }, then: () => opens });
  const TIMINGS = ['swift', 'melee', 'projectile', 'firing', 'movement', 'tactical'];
  const fire = shot('attack:fire', 2, odds(0.5, 0.5, 0));
  const punch = shot('attack:punch', 2, odds(0.1, 0.1, 0), { tags: ['attack', 'melee'] });
  const asked = [];
  const dials = (by) => TIMINGS.map((t) => ({ ...dialOf(t, by[t] ?? opened([end()])), then: () => { asked.push(t); return by[t] ?? opened([end()]); } }));
  const d = (by) => ({ id: 'dial', kind: 'planning.dial', seat: 's1', unit: 1, options: dials(by), fallback: 'dial:movement', facts: {} });
  let c = only({ dials: true }).choose(d({ firing: opened([fire, end()]), melee: opened([punch, end()]) }), v, rng);
  check('the dial is the Timing whose Opportunity opens the plan worth most, by the same sum an Opportunity is planned by',
    [c.option, c.reason, c.why.includes('attack:fire')], ['dial:firing', 'dial_by_plan', true]);
  check('the Timings planned are the ones something of the Mech\'s is played on: its weapons\', and Melee and Movement, which every Mech has', [...new Set(asked)].sort(), ['firing', 'melee', 'movement']);
  asked.length = 0;
  only({ dials: true }, { dialAll: 1 }).choose(d({ firing: opened([fire, end()]), melee: opened([punch, end()]) }), v, rng);
  check('with the weight on it, every Timing offered is asked what it would open (a dial may open the Actions of the Timing beside it, where something lends it)',
    [...new Set(asked)].sort(), ['firing', 'melee', 'movement', 'projectile', 'swift', 'tactical']);
  // A gun fired on the dial BEFORE its own Timing is fired before the guns on that Timing.
  const wide = (skills, weights = {}) => only(skills, { dialAll: 1, ...weights });
  c = wide({ dials: true }).choose(d({ firing: opened([fire, end()]), projectile: opened([fire, end()]) }), v, rng);
  check('then, where the dial before a weapon\'s own Timing opens the same attack, that is the dial set: the attack is made sooner', c.option, 'dial:projectile');
  // A PLAN THAT BORROWS ITS TIMING. The Starting Action must be of the dial's
  // own Timing unless something on the board lends the one beside it, and the
  // lender may be gone when the Opportunity comes.
  const own = shot('attack:own', 2, odds(0.5, 0.5, 0), { facts: { uid: 1, targetUid: 2, actionId: 'gun' } });
  const both = d({ firing: opened([own, end()]), projectile: opened([own, end()]) });
  const LENT = 0.5;
  check('with a weight on it, of two dials that open the same attack the one whose own Timing the attack is printed with is set, though the other acts sooner: a Timing a dial only borrows may not be there when the Opportunity comes',
    [wide({ dials: true }, { borrowed: LENT }).choose(both, v, rng).option, wide({ dials: true }).choose(both, v, rng).option, W.borrowed], ['dial:firing', 'dial:projectile', 0]);
  const better = shot('attack:own', 2, odds(0.5 + (LENT + 0.1) / gainOf(odds(1, 1, 0), foe, v, W), 0.5, 0), { facts: { uid: 1, targetUid: 2, actionId: 'gun' } });
  check('and a borrowed Timing is still set where what it opens is worth more than that',
    wide({ dials: true }, { borrowed: LENT }).choose(d({ firing: opened([own, end()]), projectile: opened([better, end()]) }), v, rng).option, 'dial:projectile');
  // What a plan starts with: the Movement Action it moves by, or behind a Maneuver the first thing it does.
  const runner = unit(1, 's1', 'mech', 0, 0, { facing: 1, timing: undefined, weapons: [gun(6), { ...gun(4), type: 'Moving', timing: 'movement', actionId: 'sprint' }] });
  const rv = viewOf([runner, foe], { phase: 1, phaseName: 'Planning' });
  const dash = { id: 'move:sprint:1,0:1', label: 'Sprint to 1,0', tags: ['move', 'facing:1'], commands: [{}], facts: { uid: 1, to: { c: 1, r: 0 }, facing: 1, grids: 1, actionId: 'sprint' },
    later: () => looked([shot('attack:later', 2, odds(0.5, 0.5, 0))]) };
  const openedFor = (options) => ({ id: 'opened', kind: 'opp.act', seat: 's1', unit: 1, options, fallback: 'end', facts: {}, here: () => outlook(rv) });
  const sprints = { id: 'dial', kind: 'planning.dial', seat: 's1', unit: 1, fallback: 'dial:movement', facts: {},
    options: TIMINGS.map((t) => dialOf(t, openedFor(t === 'firing' || t === 'movement' ? [dash, end({ later: () => null })] : [end({ later: () => null })]))) };
  check('a plan that starts with a Sprint is set on the Movement dial, whose own Timing a Sprint is, and not on the Firing dial that would open it sooner',
    [wide({ dials: true }, { borrowed: LENT }).choose(sprints, rv, rng).option, wide({ dials: true }).choose(sprints, rv, rng).option], ['dial:movement', 'dial:firing']);
  const stepThenFire = step(1, 0, 1, { then: (kinds) => (kinds.includes('attack') ? looked([own]) : null) });
  const stepped = { id: 'dial', kind: 'planning.dial', seat: 's1', unit: 1, fallback: 'dial:movement', facts: {},
    options: TIMINGS.map((t) => dialOf(t, openedFor(t === 'projectile' || t === 'firing' ? [stepThenFire, end({ later: () => null })] : [end({ later: () => null })]))) };
  check('behind a Maneuver it is the attack that starts the plan: the dial set is the attack\'s own',
    wide({ dials: true }, { borrowed: LENT }).choose(stepped, rv, rng).option, 'dial:firing');
  // Each Timing is planned for itself: two that open the same answers may differ in what follows them.
  const reaches = (f) => opened([step(1, 0, 1, { then: (kinds) => (kinds.includes('attack') && f ? looked([shot('attack:after', 2, f, { tags: ['attack', 'melee'] })]) : null) }), end()]);
  c = wide({ dials: true }).choose(d({ swift: reaches(null), melee: reaches(odds(0.6, 0.6, 0)) }), v, rng);
  check('two Timings that open the same answers are still planned each for itself: the same Maneuver leads to an attack on one dial and to nothing on the other', [c.option, c.reason], ['dial:melee', 'dial_by_plan']);
  c = only({ dials: true }).choose(d({ firing: opened([fire, end()]), melee: opened([fire, end()]) }), v, rng);
  check('of two Timings that open plans worth the same, the earlier is taken: acting sooner is worth a little by itself', c.option, 'dial:melee');
  const whole60 = gainOf(odds(1, 1, 0), foe, v, W);
  const hair = shot('attack:fire', 2, odds(0.5 + (W.tempo / 2) / whole60, 0.5, 0));
  const more = shot('attack:fire', 2, odds(0.5 + (W.tempo * 3) / whole60, 0.5, 0));
  check('and it is worth a little: a later Timing whose plan is better by less than the sooner one\'s head start is passed over, and one better by more is taken',
    [only({ dials: true }).choose(d({ firing: opened([hair, end()]), melee: opened([fire, end()]) }), v, rng).option,
      only({ dials: true }).choose(d({ firing: opened([more, end()]), melee: opened([fire, end()]) }), v, rng).option, W.tempo > 0], ['dial:melee', 'dial:firing', true]);
  let pauses = 0;
  const slow = await made({ dials: true }).ponder(d({ firing: opened([fire, end()]), melee: opened([punch, end()]) }), v, rng, async () => { pauses += 1; });
  const fast = made({ dials: true }).choose(d({ firing: opened([fire, end()]), melee: opened([punch, end()]) }), v, rng);
  check('worked out in steps, with a pause offered at each step of each Timing planned, the dial is the same dial for the same reason',
    [slow.option, slow.reason, slow.why === fast.why, pauses >= 3], [fast.option, 'dial_by_plan', true, true]);
  const taken = pauses;
  const handed = await made({}).ponder(d({ firing: opened([fire, end()]) }), v, rng, async () => { pauses += 100; });
  check('and a question it leaves to the Brawler is handed over in one go, with no pause taken', [handed.reason, pauses - taken], ['intent_opening', 0]);
  // WHO ACTS FIRST. An enemy Mech with this one in its sights, on Firing: a
  // Firing dial is shot before it acts, where it stands; a Melee dial moves
  // out first.
  const gunner = unit(2, 's2', 'mech', 4, 0, { weapons: [gun(6)], timing: undefined, dialHidden: true });
  const lane = viewOf([me, gunner], { phase: 1, phaseName: 'Planning' });
  const hit = odds(0.1, 0.5, 0.5);
  const sights = (inLine) => ({ 2: (kinds) => (kinds[0] === 'strike:1' && inLine ? looked([shot('attack:it', 1, hit)], { seat: 's2' }) : null) });
  const safe = step(0, 1, 1, { after: () => outlook(lane, sights(false)) });
  const there = (options) => ({ id: 'opened', kind: 'opp.act', seat: 's1', unit: 1, options, fallback: 'end', facts: {}, here: () => outlook(lane, sights(true)) });
  const big = shot('attack:big', 2, odds(0.3, 0.3, 0.3));
  // On Firing: the attack, from the lane. On Melee: only the step out of it.
  const laneDials = (firingPlan) => ({ id: 'dial', kind: 'planning.dial', seat: 's1', unit: 1, fallback: 'dial:movement', facts: {},
    options: TIMINGS.map((t) => dialOf(t, t === 'firing' ? there(firingPlan) : there([safe, end()]))) });
  // (What the enemy would go on to do is left out of the attack's worth, so
  // that the sum can be done by hand.)
  const harm = W.exposure * gainOf(hit, me, lane, W);
  const worthFire = gainOf(big.chance(), gunner, lane, W) - harm;
  c = only({ dials: true, exposure: true }, { threat: 0 }).choose(laneDials([big, safe, end()]), lane, rng);
  check('a dial is charged for the enemy that would act before it: standing in a line of fire, the Mech sets the dial that comes before the gun on it and steps out, though the attack on the later dial is worth more than the step',
    [c.option, worthFire > 0, worthFire - harm * (W.exposureLater / W.exposure) < 0], ['dial:melee', true, true]);
  const light = odds(0, 0, 0.05);
  const lightly = { 2: (kinds) => (kinds[0] === 'strike:1' ? looked([shot('attack:it', 1, light)], { seat: 's2' }) : null) };
  const brave = { id: 'dial', kind: 'planning.dial', seat: 's1', unit: 1, fallback: 'dial:movement', facts: {},
    options: TIMINGS.map((t) => dialOf(t, { id: 'opened', kind: 'opp.act', seat: 's1', unit: 1, fallback: 'end', facts: {}, here: () => outlook(lane, lightly),
      options: t === 'firing' ? [big, end()] : [step(0, 1, 1, { after: () => outlook(lane, {}) }), end()] })) };
  check('and where what the enemy could do first is worth less than the attack, the attack\'s dial is set and the charge is paid once',
    only({ dials: true, exposure: true }).choose(brave, lane, rng).option, 'dial:firing');
  check('a policy with no thought for it sets the dial as the Brawler does', plain.choose(d({ firing: opened([fire, end()]) }), v, rng).reason, 'intent_opening');
}
{
  // A FOCUS, by what the reroll is worth.
  const me = unit(1, 's1', 'mech', 0, 0);
  const foe = unit(2, 's2', 'drone', 3, 0, { points: 60 });
  const v = viewOf([me, foe]);
  const q = (kind, role, base, use, more = {}) => ({ id: 'f', kind, seat: 's1', unit: 1, fallback: 'focus.pass', facts: { targetUid: role === 'defender' ? 1 : 2, role },
    options: [{ id: 'focus.pass', label: 'pass', tags: ['pass'], run: {}, chance: () => base }, { id: 'focus.use', label: 'use', tags: ['focus', 'spend-link'], run: {}, chance: () => use }, ...(more.options ?? [])] });
  const worth = (f) => gainOf(f, foe, v, W);
  const small = odds(0.5, 0.5, 0);
  const much = odds(0.5 + (W.focus + 0.2) / worth(odds(1, 1, 0)), 0.5, 0);
  const little = odds(0.5 + (W.focus - 0.2) / worth(odds(1, 1, 0)), 0.5, 0);
  check('a Focus is paid for when the reroll it buys adds more to the attack than a Link is worth, and not when it adds less',
    [only({ focus: true }).choose(q('attack.focus', 'attacker', small, much), v, rng).option, only({ focus: true }).choose(q('attack.focus', 'attacker', small, much), v, rng).reason,
      only({ focus: true }).choose(q('attack.focus', 'attacker', small, little), v, rng).option], ['focus.use', 'focus_by_value', 'focus.pass']);
  const mine = (f) => gainOf(f, me, v, W);
  const saved = odds(0, 0, 0);
  const hurt = odds(0, 3 * (W.focus + 0.2) / mine(odds(0, 3, 0)), 0);
  check('the defender pays for one that takes that much off the attack on it',
    [only({ focus: true }).choose(q('defence.focus', 'defender', hurt, saved), v, rng).option, only({ focus: true }).choose(q('defence.focus', 'defender', saved, hurt), v, rng).option], ['focus.use', 'focus.pass']);
  check('never with the pilot\'s last Link but one', only({ focus: true }).choose(q('attack.focus', 'attacker', small, much), viewOf([{ ...me, link: 1 }, foe]), rng).option, 'focus.pass');
  const lent = { id: 'focus.lent', label: 'lent', tags: ['focus', 'free'], run: {}, chance: () => odds(0.51, 0.5, 0) };
  check('a reroll somebody else pays for is taken whenever it helps at all',
    [only({ focus: true }).choose(q('attack.focus', 'attacker', small, small, { options: [lent] }), v, rng).option, only({ focus: true }).choose(q('attack.focus', 'attacker', small, small, { options: [lent] }), v, rng).reason], ['focus.lent', 'free_reroll']);
  check('a policy with no thought for it answers as the Brawler does: one chance in four of turning the roll',
    [plain.choose(q('attack.focus', 'attacker', small, odds(0.8, 0.8, 0)), v, rng).reason, plain.choose(q('attack.focus', 'attacker', small, odds(0.6, 0.6, 0)), v, rng).reason], ['paid_reroll', 'skip_reroll']);
  // OTTO's playtest, 2026-10-03: a Link spent to turn a hit that would only
  // have Damaged a Part with Structure left (`focusDamaged`), and one that left
  // the Mech a Link from Shutdown (`focusLow`).
  const dented = odds(0, 0, 1.5 * W.focus / mine(odds(0, 0, 1)));
  check('a defence pays no Link to turn a hit that would only Damage a Part (it still works after it), where counted in full it would',
    [W.focusDamaged, only({ focus: true }).choose(q('defence.focus', 'defender', dented, saved), v, rng).option,
      only({ focus: true }, { focusDamaged: 1 }).choose(q('defence.focus', 'defender', dented, saved), v, rng).option], [0.5, 'focus.pass', 'focus.use']);
  check('and a Part destroyed is bought off as before', only({ focus: true }).choose(q('defence.focus', 'defender', hurt, saved), v, rng).option, 'focus.use');
  check('a Link that would leave the Mech one from Shutdown costs more: the reroll worth a Link at 4 is not worth one at 2',
    [W.focusLow, only({ focus: true }).choose(q('attack.focus', 'attacker', small, much), v, rng).option,
      only({ focus: true }).choose(q('attack.focus', 'attacker', small, much), viewOf([{ ...me, link: 2 }, foe]), rng).option,
      only({ focus: true }, { focusLow: 0 }).choose(q('attack.focus', 'attacker', small, much), viewOf([{ ...me, link: 2 }, foe]), rng).option], [2, 'focus.use', 'focus.pass', 'focus.use']);
}
{
  // IN THE MIDDLE OF AN ATTACK, the Brawler's answers by the Tactician's price
  // list: where a hit lands, on a VIP mission.
  const me = unit(1, 's1', 'mech', 0, 0);
  const lead = unit(2, 's2', 'mech', 3, 0, { commander: true });
  const v = viewOf([me, lead], { task: VIP });
  const pick = (slot, f) => ({ id: `part.pick:${slot}`, label: slot, tags: ['pick'], run: {}, chance: () => f });
  // One Part gives a chance of the kill; the other a surer Part.
  const kill = odds(0.3, 0.3, 0);
  const sure = odds(0, 0.9, 0);
  const d = { id: 'p', kind: 'attack.part', seat: 's1', unit: 1, fallback: 'part.pick:torso', facts: { targetUid: 2, role: 'attacker' }, options: [pick('torso', kill), pick('leftHand', sure)] };
  const c = plain.choose(d, v, rng);
  check('where a hit lands is chosen by what the Tactician prices each ending at: a Part of the enemy Commander is a third of the way to the Commander, so a sure Part outweighs three chances in ten of the kill',
    [c.option, c.reason, gainOf(sure, lead, v, W) > gainOf(kill, lead, v, W)], ['part.pick:leftHand', 'hit_location', true]);
  check('by the Brawler\'s own sum the same choice goes the other way: 150 for the kill and 50 for the Part with it, against 50 for a Part',
    [brawlerPolicy.choose(d, v, rng).option, 200 * 0.3 > 50 * 0.9], ['part.pick:torso', true]);
}

{
  // ANSWERS THAT PREPARE SOMETHING where it stands: a Stance, a Charge, a
  // Token taken off. Each is worth what it leads to.
  const me = unit(1, 's1', 'mech', 0, 0, { facing: 1, weapons: [gun(6)] });
  const foe = unit(2, 's2', 'drone', 3, 0, { points: 60 });
  const v = viewOf([me, foe]);
  const weak = shot('attack:fire', 2, odds(0.2, 0.2, 0));
  const strong = shot('attack:fire', 2, odds(0.6, 0.6, 0));
  const prep = (id, tags, opens, more = {}) => ({ id, label: id, tags, commands: [{}], then: () => looked(opens), after: () => outlook(v), ...more });
  const stance = prep('stance:offensive', ['stance', 'stance:offensive'], [strong]);
  let c = only({ stance: true }).choose(ask(v, [weak, stance, end()]), v, rng);
  check('a Stance is changed for what it is worth: the attack it would make in the new one against the attack it has now',
    [c.option, c.reason, near(c.score, gainOf(odds(0.6, 0.6, 0), foe, v, W))], ['stance:offensive', 'stance_by_value', true]);
  check('and is left alone where the attack is no better for it, and by a policy that does not weigh its Stance',
    [only({ stance: true }).choose(ask(v, [strong, prep('stance:defensive', ['stance', 'stance:defensive'], [weak]), end()]), v, rng).option, plain.choose(ask(v, [weak, stance, end()]), v, rng).option],
    ['attack:fire', 'attack:fire']);
  // A Stance for what it saves: nothing to attack, an enemy with it in its sights, and the hit worth less in Defensive.
  const gunner = unit(2, 's2', 'mech', 4, 0, { weapons: [gun(6)], timing: 'firing' });
  const lane = viewOf([me, gunner]);
  const sights = (f) => ({ 2: (kinds) => (kinds[0] === 'strike:1' ? looked([shot('attack:it', 1, f)], { seat: 's2' }) : null) });
  const braced = prep('stance:defensive', ['stance', 'stance:defensive'], [], { after: () => outlook(lane, sights(odds(0, 0.1, 0.2))) });
  c = only({ stance: true, exposure: true }).choose(ask(lane, [braced, end()], { here: () => outlook(lane, sights(odds(0, 0.4, 0.5))) }), lane, rng);
  check('a Stance is also worth what it saves: with an enemy\'s gun on it, the Stance in which the hit costs less',
    [c.option, c.reason, c.why.includes(`cost ${(W.exposure * gainOf(odds(0, 0.1, 0.2), me, lane, W)).toFixed(2)}`)], ['stance:defensive', 'stance_by_value', true]);
  // A Charge, for the attack it buys a turn later.
  const drone = unit(1, 's1', 'drone', 0, 0, { facing: 1, weapons: [gun(12, { mode: 'auto', timing: undefined })] });
  const dv = viewOf([drone, foe], { phase: 0, phaseName: 'Command' });
  const plainShot = () => looked([shot('attack:auto', 2, odds(0.3, 0.3, 0.3))]);
  const chargedShot = () => looked([shot('attack:auto', 2, odds(0.3, 0.3, 0.3)), shot('attack:auto:charged', 2, odds(0.7, 0.7, 0.1), { tags: ['attack', 'firing', 'spend-charge'] })]);
  const charge = { id: 'charge:main', label: 'Charge', tags: ['charge'], commands: [{}], then: () => null, later: chargedShot, after: () => outlook(dv) };
  c = only({ charge: true }).choose(ask(dv, [charge, end({ later: plainShot })], { kind: 'activation.act' }), dv, rng);
  check('a Charge is made for the attack it buys: the charged attack a turn later against the plain one, the Charge spent counted',
    [c.option, c.reason, near(c.score, (gainOf(odds(0.7, 0.7, 0.1), foe, dv, W) - 0.05) * W.futureSoon)], ['charge:main', 'charge_for_attack', true]);
  check('a policy that keeps its Charges does not make one', plain.choose(ask(dv, [charge, end({ later: plainShot })], { kind: 'activation.act' }), dv, rng).option, 'end');
  // A Token taken off that gives the attack back.
  const clear = prep('stabilise:fci', ['stabilise', 'remove-token'], [strong]);
  c = plain.choose(ask(v, [clear, end()]), v, rng);
  check('a Token is taken off where that gives it back an attack', [c.option, c.reason], ['stabilise:fci', 'clear_token']);
}
{
  // THE OTHER THINGS AN ACTIVATION MAY BE SPENT ON.
  const me = unit(1, 's1', 'mech', 0, 0, { facing: 1, weapons: [gun(3, { type: 'Projectile', timing: 'projectile', strike: 3 })] });
  const near1 = unit(2, 's2', 'drone', 4, 0, { points: 60 });
  const far1 = unit(3, 's2', 'drone', 5, 3, { points: 90 });
  const v = viewOf([me, near1, far1]);
  // A Projectile to launch: two Landing Points, each with a different enemy
  // inside its strike, and what the Projectile could do from each.
  const land = (c, r, target, f) => ({ id: `launch:${c},${r}`, label: `launch to ${c},${r}`, tags: ['launch', 'land'], commands: [{}], facts: { uid: 1, to: { c, r }, strike: 3 },
    later: (kinds) => (kinds.includes('attack') ? looked([shot('detonate:it', target, f, { tags: ['detonate', 'attack', 'explosion'] })]) : null) });
  const onNear = land(3, 0, 2, odds(0.5, 0.5, 0));
  const onFar = land(3, 2, 3, odds(0.5, 0.5, 0));
  let c = plain.choose(ask(v, [onNear, onFar, end()]), v, rng);
  check('a Projectile is launched where its blast is worth most: the attack it could make when its turn comes, for a little less than an attack made now',
    [c.option, c.reason, near(c.score, gainOf(odds(0.5, 0.5, 0), far1, v, W) * W.launch)], [onFar.id, 'launch_value', true]);
  // A TARGET STILL TO MOVE (`launchMove`): the Projectile strikes in the Delay
  // Phase, and an enemy whose turn is still to come may walk out of its strike.
  // The far drone stands at the strike's edge (3 of 3) with a walk of 5: there
  // still a sixth of the time; the near one has two Grids to spare: half.
  c = only({}, { launchMove: 1 }).choose(ask(v, [onNear, onFar, end()]), v, rng);
  check('`launchMove` 1: a Projectile aimed at an enemy still to move is worth the chance it is still in the strike, the reach to spare against its walk: the near drone now',
    [c.option, near(c.score, gainOf(odds(0.5, 0.5, 0), near1, v, W) * W.launch * 0.5)], [onNear.id, true]);
  const acted = viewOf([me, near1, { ...far1, done: true }]);
  c = only({}, { launchMove: 1 }).choose(ask(acted, [onNear, onFar, end()]), acted, rng);
  check('and an enemy that has had its turn this round is read where it stands: the far drone again', [c.option, near(c.score, gainOf(odds(0.5, 0.5, 0), far1, acted, W) * W.launch)], [onFar.id, true]);
  // AN INTERCEPTION OWED (`interceptOdds`): the far Landing Point under an
  // interceptor's guard, its Projectile through it a fifth of the time; the
  // near one clear of it.
  const guarded = { ...onFar, tags: [...onFar.tags, 'intercepted'], facts: { ...onFar.facts, intercepts: 1 }, survive: () => 0.2 };
  c = only({}, { interceptOdds: 1 }).choose(ask(v, [onNear, guarded, end()]), v, rng);
  check('`interceptOdds` 1: a launch that owes Interception is worth the chance its Projectile comes through, and the Landing Point clear of the guard is taken; at 0, the guarded one as before',
    [c.option, near(c.score, gainOf(odds(0.5, 0.5, 0), near1, v, W) * W.launch), plain.choose(ask(v, [onNear, guarded, end()]), v, rng).option], [onNear.id, true, guarded.id]);
  // An Electronic Attack: on the enemy whose Firing is worth most.
  const jammer = unit(1, 's1', 'drone', 0, 0, { weapons: [gun(4, { type: 'Tactic', mode: 'auto', timing: undefined })] });
  const armed = unit(2, 's2', 'mech', 3, 0, { weapons: [gun(6)] });
  const unarmed = unit(3, 's2', 'mech', 3, 1);
  const jv = viewOf([jammer, armed, unarmed]);
  const fires = shot('attack:fire', 1, odds(0.4, 0.4, 0.2));
  const jamOn = (uid) => ({ id: `electronic:x:${uid}`, label: `Interference at ${uid}`, tags: ['electronic'], commands: [{}], facts: { uid: 1, targetUid: uid } });
  const table = outlook(jv, { 2: (kinds) => (kinds[0] === 'attack' ? looked([fires], { seat: 's2' }) : null) });
  c = plain.choose(ask(jv, [jamOn(3), jamOn(2), end()], { kind: 'activation.act', here: () => table }), jv, rng);
  check('an Electronic Attack is made on the enemy whose Firing is worth most: what its best attack on this squad would be, for the chance the Counter-roll is won',
    [c.option, c.reason, near(c.score, W.jam * gainOf(fires.chance(), jammer, jv, W))], ['electronic:x:2', 'jam_value', true]);
  check('and an enemy with no gun is not worth jamming', plain.choose(ask(jv, [jamOn(3), end()], { kind: 'activation.act', here: () => table }), jv, rng).option, 'end');
  // What is left when there is nothing to do.
  const tired = viewOf([{ ...me, link: 2 }, near1]);
  const restore = { id: 'stabilise:keep', label: 'restore Link', tags: ['stabilise', 'restore-link'], commands: [{}], then: () => null };
  check('with nothing to do and Link lost, Link is restored; with its Link whole the Opportunity is ended',
    [plain.choose(ask(tired, [restore, end()]), tired, rng).reason, plain.choose(ask(v, [restore, end()]), v, rng).reason], ['restore_link', 'end_activation']);
  const spent = { id: 'detonate:x:none', label: 'finds no target', tags: ['detonate', 'destroy'], commands: [{}] };
  const missile = viewOf([{ ...me, kind: 'projectile' }, near1]);
  check('a Projectile with nothing to take resolves its Delayed Action', plain.choose(ask(missile, [spent, end()], { kind: 'activation.act' }), missile, rng).reason, 'delayed_action');
  check('a question it has no judgement of its own about is answered as the Brawler answers it, and a question about a unit that is not there takes the safe answer',
    [plain.choose({ id: 'x', kind: 'opp.reboot', seat: 's1', unit: 1, options: [{ id: 'reboot:offensive', label: 'r', tags: ['reboot', 'stance:offensive'], commands: [{}] }], fallback: 'reboot:offensive', facts: {} }, v, rng).reason,
      plain.choose(ask(v, [end()], { unit: 99 }), v, rng).reason], ['reboot', 'safe_answer']);
}
{
  // THE COMMANDER AND THE DEPLOYMENT (a VIP mission).
  const long = unit(1, 's1', 'mech', 0, 0, { deployed: false, weapons: [gun(8)] });
  const short = unit(2, 's1', 'mech', 0, 0, { deployed: false, weapons: [gun(3)], parts: ['torso', 'chasis', 'leftHand', 'rightHand', 'backpack'].map((s) => ({ ...part(s, 20), armor: 9 })) });
  const v = viewOf([long, short], { task: VIP, setup: 'tasks' });
  const name = (uid) => ({ id: `mech:${uid}`, label: `Commander: ${uid}`, tags: ['designate', 'leader'], commands: [{}] });
  const q = (options) => ({ id: 'l', kind: 'setup.designate.leader', seat: 's1', options, fallback: options[0].id, facts: {} });
  check('the Commander is the Mech with the longest arm, which can do most from furthest back; a harder Torso does not outweigh that',
    [only({ setup: true }).choose(q([name(2), name(1)]), v, rng).option, only({ setup: true }).choose(q([name(2), name(1)]), v, rng).reason], ['mech:1', 'commander_by_reach']);
  const same = viewOf([long, { ...short, weapons: [gun(8)] }], { task: VIP });
  check('of two that reach as far, the one whose Torso is hardest to destroy', only({ setup: true }).choose(q([name(1), name(2)]), same, rng).option, 'mech:2');
  check('a policy with no thought for it takes the first Mech that may lead, as the Brawler does', plain.choose(q([name(2), name(1)]), v, rng).reason, 'first_eligible_commander');

  // Deployment: the unit that matters least first, and a Commander out of the lanes.
  const lead = { ...long, commander: true };
  const drone = unit(3, 's1', 'drone', 0, 0, { deployed: false, points: 20 });
  const dv = viewOf([lead, drone], { task: VIP, setup: 'deploy' });
  const put = (uid, c, r, stance) => ({ id: `deploy:${uid}:${c},${r}${stance ? `:${stance}` : ''}`, label: `Deploy ${uid}`, tags: ['deploy'], commands: [{}],
    facts: { uid, to: { c, r }, facing: 2, ...(stance ? { stance } : {}) }, after: () => outlook(dv) });
  const asked = [];
  // The board: the Grid at 5,0 is seen from two Grids of the other squad's zone, the Grid at 2,0 from none.
  const lanes = (uid, grids, from) => { asked.push({ uid, from: from?.length ?? 0 }); return grids.map((g) => (g.col === 5 ? [0, 1] : [])); };
  const d = (options) => ({ id: 'dep', kind: 'setup.deploy', seat: 's1', options, fallback: options[0].id, facts: { zone: ['2,0', '5,0'], foeZone: ['5,11', '6,11'] }, here: () => outlook(dv, {}, lanes) });
  let c = only({ setup: true }).choose(d([put(1, 5, 0, 'offensive'), put(1, 2, 0, 'offensive'), put(3, 5, 0), put(3, 2, 0)]), dv, rng);
  check('the squad is deployed a unit at a time, the one that matters least first, so the Commander goes down with more of the other squad on the board',
    [c.option.startsWith('deploy:3:'), c.reason], [true, 'deploy_by_value']);
  c = only({ setup: true }).choose(d([put(1, 5, 0, 'offensive'), put(1, 5, 0, 'defensive'), put(1, 2, 0, 'offensive'), put(1, 2, 0, 'defensive')]), dv, rng);
  check('a Commander is kept out of the lanes: each Grid of the other squad\'s Deployment Zone that would see it counts against a Grid, and it is deployed ready to attack',
    [c.option, near(c.score, 0), asked.at(-1)], ['deploy:1:2,0:offensive', true, { uid: 1, from: 2 }]);
  check('a policy with no thought for it deploys as the Brawler does', plain.choose(d([put(1, 5, 0, 'offensive'), put(1, 2, 0, 'offensive')]), dv, rng).reason, 'deploy_toward_enemy');
  let rests = 0;
  const four = [put(1, 5, 0, 'offensive'), put(1, 5, 0, 'defensive'), put(1, 2, 0, 'offensive'), put(1, 2, 0, 'defensive')];
  const placed = await made({ setup: true }).ponder(d(four), dv, rng, async () => { rests += 1; });
  check('worked out in steps, with a pause after each Grid weighed, the deployment is the same', [placed.option, placed.reason, rests], [c.option, 'deploy_by_value', 2]);
  // A unit being deployed still has this round's activation to come: a zone
  // one activation from where it is put down is stood in THIS round.
  const early = { ...CONTROL, fromRound: 1 };
  const zv = viewOf([{ ...drone, lowValue: false }], { task: early, setup: 'deploy', zones: [zone('echo', ['2,4'])] });
  const field = { '2,0': { grids: 4, turns: 1 }, '5,0': { grids: 7, turns: 2 } };
  const walked = (uid, from) => from.map((g) => field[`${g.col},${g.row}`] ?? null);
  const zd = { id: 'dep', kind: 'setup.deploy', seat: 's1', options: [put(3, 5, 0), put(3, 2, 0)].map((o) => ({ ...o, after: () => outlook(zv, {}, undefined, { walk: walked }) })), fallback: 'x',
    facts: { zone: ['2,0', '5,0'], foeZone: [] }, here: () => outlook(zv, {}, undefined, { walk: walked }) };
  const near1 = made({ setup: true, mission: true }, { zonePull: W.zonePull, zoneStep: W.zoneStep }).choose(zd, zv, rng);
  check('a unit being deployed has this round\'s activation still to come, so a zone one activation from the Grid it is put down in pays from THIS round: it is deployed there',
    [near1.option, near(near1.score, early.vp * payFrom(1, zv, W) * W.zonePull - 4 * W.zoneStep), payFrom(1, zv, W) > payFrom(2, zv, W)], ['deploy:3:2,0', true, true]);
}

// ---------- 3. on the engine ----------
//
// A real table, the question the seat's driver hands the policy, and the
// answer checked against the engine's own word on the table it leaves.
const clone = (x) => JSON.parse(JSON.stringify(x));
const short = (t) => (t.label.startsWith('ADK15P') ? 'Porcupine' : t.label.startsWith('ADK60S') ? 'Raven' : t.label.startsWith('ADK30C') ? 'Tarantula' : t.label);
// A seat at a table: its driver, the question it is being put, and the
// policy's answer to it.
function seated(s, seat, policy) {
  M.L.setLocalSeat(seat);
  const send = (cmd) => { const v = seat === 's1' ? M.C.perform(data, s, cmd) : M.C.applyRemote(data, s, cmd); if (v.ok) M.G.glueAfter(data, s, cmd); return v; };
  const driver = new M.AI.Driver(seat, { data, state: () => s, send, roll: async () => [] }, policy, rng);
  const turn = () => {
    const d = driver.pending();
    const view = M.SEAT.viewOf(data, s, seat);
    const c = d ? policy.choose(d, view, rng) : null;
    return { d, view, c, picked: d?.options.find((o) => o.id === c?.option) ?? null };
  };
  const take = (o) => (o.commands ?? []).map((cmd) => send(cmd).ok);
  return { turn, take, close: () => M.L.setLocalSeat(null) };
}
{
  // THE ALLEY, ROUND 1, THE COMMAND PHASE, as UN: the position the Brawler
  // loses the game in. It walks the Porcupine and the Raven at two Mechs, which
  // destroy both before either has fired.
  const table = tableAtRoundOne(M, data, alley);
  const s = clone(table.state);
  const U = Object.fromEntries(s.tokens.map((t) => [short(t), t]));
  // As the Brawler deploys them: the Mechs up the middle, the Drones forward.
  const at = (t, c, r, f) => { t.col = c * 3; t.row = r * 3; t.facing = f; };
  at(U.Mire, 4, 2, 2); at(U.Dune, 4, 1, 2); at(U['Wild Cat'], 8, 9, 0); at(U.Porcupine, 7, 9, 0); at(U.Raven, 7, 10, 0); at(U.Tarantula, 9, 9, 0);
  const seat = seated(s, 's2', tacticianPolicy);
  const first = seat.turn();
  check('asked whom to Command, it gives the Command where it does most, and says what for',
    [first.d.kind, first.c.reason, first.picked.tags.includes('designate'), first.c.score > 0], ['loop.designate.command', 'command_by_value', true, true]);
  seat.take(first.picked);
  const move = seat.turn();
  const mover = s.tokens.find((t) => t.uid === move.d.unit);
  const landed = M.G.tableAfter(data, s, move.picked.commands);
  const after = M.SEAT.viewOf(data, landed, 's2');
  const zoneNow = after.zones.filter((z) => z.scoring && z.holder === 's2').map((z) => z.name);
  check('the Drone it Commands is moved into a zone the Main Task scores, which no unit held: by the board\'s own reading it holds it there',
    [move.d.kind, move.c.reason, move.picked.tags[0], zoneNow.length, move.view.zones.filter((z) => z.scoring && z.holder).length], ['activation.act', 'take_zone', 'move', 1, 0]);
  // The engine's own word on that Grid: neither Mech could attack it there, from where it stands or after its Maneuver.
  const threats = [];
  for (const mech of [U.Mire, U.Dune]) {
    for (const timing of ['firing', 'melee', 'projectile']) {
      const turn = M.SEAT.owedIfActivated(data, landed, mech.uid, timing, { only: [`strike:${mover.uid}`, `reach:${mover.uid}`] });
      if (turn?.decision?.options.length) threats.push(`${mech.label} on ${timing}`);
    }
  }
  check('and it is a Grid neither enemy Mech could attack it in, by the engine\'s own word on the table the move leaves: from where each stands, and after its Maneuver', threats, []);
  seat.close();
}
{
  // The same question put to the Brawler, to say what is different.
  const table = tableAtRoundOne(M, data, alley);
  const s = clone(table.state);
  const U = Object.fromEntries(s.tokens.map((t) => [short(t), t]));
  const at = (t, c, r, f) => { t.col = c * 3; t.row = r * 3; t.facing = f; };
  at(U.Mire, 4, 2, 2); at(U.Dune, 4, 1, 2); at(U['Wild Cat'], 8, 9, 0); at(U.Porcupine, 7, 9, 0); at(U.Raven, 7, 10, 0); at(U.Tarantula, 9, 9, 0);
  const seat = seated(s, 's2', brawlerPolicy);
  const first = seat.turn();
  seat.take(first.picked);
  const move = seat.turn();
  const mover = s.tokens.find((t) => t.uid === move.d.unit);
  const landed = M.G.tableAfter(data, s, move.picked.commands);
  const threats = [];
  for (const mech of [U.Mire, U.Dune]) {
    for (const timing of ['firing', 'melee', 'projectile']) {
      const turn = M.SEAT.owedIfActivated(data, landed, mech.uid, timing, { only: [`strike:${mover.uid}`, `reach:${mover.uid}`] });
      if (turn?.decision?.options.length) threats.push(mech.label);
    }
  }
  check('  (the Brawler, asked the same, walks its Drone to where an enemy Mech can attack it: "contact before occupation")',
    [move.c.reason, [...new Set(threats)].length > 0], ['contact_before_occupation', true]);
  seat.close();
}
{
  // WHAT IT SAYS AN ATTACK IS WORTH is the price list's sum on the engine's own
  // odds. The Mire on its Firing dial, the Wild Cat two Grids ahead, on an
  // open board.
  const table = tableAtRoundOne(M, data, alley);
  const s = clone(table.state);
  s.map = 'none';
  const U = Object.fromEntries(s.tokens.map((t) => [short(t), t]));
  const at = (t, c, r, f) => { t.col = c * 3; t.row = r * 3; t.facing = f; };
  at(U.Mire, 5, 4, 1); at(U.Dune, 0, 0, 1); at(U['Wild Cat'], 7, 4, 3); at(U.Porcupine, 11, 11, 0); at(U.Raven, 11, 9, 3); at(U.Tarantula, 11, 7, 3);
  s.round.phase = 2; s.script.stage = '1:2'; s.script.passed = []; s.script.opp = null; s.script.revealed = ['s1', 's2'];
  for (const t of s.tokens) if (t.kind === 'mech') { t.timing = 'firing'; t.stance = 'offensive'; }
  s.script.acted = s.tokens.filter((x) => x.kind === 'mech' && x.uid !== U.Mire.uid).map((x) => x.uid);
  // Its Stance confirmed and its Maneuver made: the attacks are what is left.
  Object.assign(M.G.opportunity(data, s), { stanceLocked: true, maneuvered: true });
  // No thought for anything but the attack, and nothing added for what the
  // target would go on to do: the sum is the forecast's alone.
  const bare = made({}, { threat: 0 });
  const seat = seated(s, 's1', bare);
  const { d, view, c, picked } = seat.turn();
  const cat = view.units.find((u) => u.uid === U['Wild Cat'].uid);
  const shots = d.options.filter((o) => o.run?.routine === 'attack' && !o.tags.includes('spend-charge'));
  const follow = (o) => Math.max(0, ...(o.then?.(['attack'])?.options ?? []).filter((x) => x.run?.routine === 'attack' && !x.tags.includes('spend-charge')).map((x) => gainOf(x.chance(), view.units.find((u) => u.uid === x.facts.targetUid), view, W)));
  const whole = (o) => gainOf(o.chance(), view.units.find((u) => u.uid === o.facts.targetUid), view, W) + follow(o);
  const two = [...shots].sort((a, b) => gainOf(b.chance(), cat, view, W) - gainOf(a.chance(), cat, view, W)).slice(0, 2);
  const best = two.reduce((a, b) => (whole(b) > whole(a) + 1e-9 ? b : a));
  check('on the engine: the attack it makes is the one worth most by the price list on the engine\'s own odds, what could follow it counted, and the worth it states is that sum',
    [d.kind, shots.length > 1, picked.id, c.reason, near(c.score, whole(best))], ['opp.act', true, best.id, 'attack_value', true]);
  seat.close();
}

// ---------- 4. whole games ----------
if (process.env.TACTICIAN_GAMES !== '0') {
  const play = async (scenario, seed, policies, host = {}) => {
    const t = botTable(M, data, scenario, { seed, policies, host });
    let end;
    try { end = await t.run({ maxSteps: 8000 }); } catch (err) { end = { kind: 'threw', why: err.message }; } finally { t.close(); }
    const log = ['s1', 's2'].map((seat) => t.drivers[seat].log.map((e) => `${e.kind}>${e.option}`).join('|')).join('||');
    return { end, refused: t.refused.length, vp: M.TK.normaliseTasks(t.state.tasks).vp, log, steps: t.steps() };
  };
  const games = [];
  for (const [scenario, label] of [[alley, 'the alley'], [vip, 'the Intersection']]) {
    for (const [s1, s2, who] of [[tacticianPolicy, brawlerPolicy, 'as RDL against the Brawler'], [brawlerPolicy, tacticianPolicy, 'as UN against the Brawler'], [tacticianPolicy, tacticianPolicy, 'against itself']]) {
      const g = await play(scenario, 1, { s1, s2 });
      games.push(g);
      check(`a whole game on ${label}, ${who}: played to its end, nothing refused, nothing stuck`, [g.end.kind, g.refused, g.steps > 100], ['over', 0, true]);
    }
  }
  const again = await play(alley, 1, { s1: tacticianPolicy, s2: brawlerPolicy });
  check('the same seed is the same game, answer for answer: what a policy remembers of a table changes nothing it chooses', again.log === games[0].log, true);
  // What it remembers is only ever a saving: a policy made new for every
  // question plays the game a policy that remembers plays.
  const forgetful = { name: 'tactician', choose: (d, view, r) => makeTactician().choose(d, view, r) };
  const fresh = await play(alley, 1, { s1: forgetful, s2: brawlerPolicy });
  check('and a Tactician that remembers nothing from one question to the next plays the same game', fresh.log === games[0].log, true);
  // A host that offers a pause: the long decisions are worked out in steps.
  let pausesTaken = 0;
  const paused = await play(alley, 1, { s1: tacticianPolicy, s2: brawlerPolicy }, { breathe: async () => { pausesTaken += 1; } });
  check('at a table whose host offers a pause, its long decisions are put down between their steps and it plays the same game, answer for answer',
    [paused.log === games[0].log, pausesTaken > 40], [true, true]);
  // One policy in both seats, each seat's thought put down while the other is asked: neither is disturbed.
  const both = await play(alley, 1, { s1: tacticianPolicy, s2: tacticianPolicy }, { breathe: async () => {} });
  check('and one policy sat in both seats keeps a memory for each: paused or not, the game against itself is the same game', both.log === games[2].log, true);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
