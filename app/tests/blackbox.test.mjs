// A Black Box mission, played by a seat (rulebook 5.3.1;
// AI-OPPONENT-PLAN.md, M8.2e).
//
// A Black Box is the one Task item that moves. A unit whose Movement passes a
// loose one may pick it up onto a Freehand Part; a bearer that is Penetrated
// drops it where the ATTACKER says; and the Task pays whoever carries one as
// the game ends. The random-squad games counted what each Main Task paid two
// computers: sixty-four Black Box games, and not one Victory Point, because no
// seat could pick a Box up. Staged here on the real engine: the pick-up as the
// seam offers it (held to the engine's own verdict for every Grid a Movement
// reaches), the Boxes as a seat sees them, the drop a computer's attack owes,
// what the Tactician makes of a Box, and whole games.
import { readFileSync } from 'node:fs';
import { botTable, loadEngine, tableAtRoundOne } from './_engine.mjs';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}\n       got  ${g}`); }
};

console.log('A Black Box mission\n');

const { M, data } = await loadEngine('blackbox', ["export * as SEAT from '../src/seat';", "export * as AI from '../src/ai/index';", "export * as TURN from '../src/turn';"]);
const { owed, newMind } = M.SEAT;
const viewOf = (state, seat) => M.SEAT.viewOf(data, state, seat);
const AI = M.AI;
const T = M.TURN;
const clone = (x) => JSON.parse(JSON.stringify(x));
const near = (a, b) => Math.abs(a - b) < 1e-9;
const src = (f) => readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

// The copied squads on the Alley: Key Facility (a Box in five zones, 4 Victory
// Points for each one held as the game ends), and Asset Preservation (a Box in
// four, paid only when held in Echo).
const keyGame = { ...data.solo.scenarios[0], id: 't-boxes', mission: 'blackbox-key-facilities' };
const assetGame = { ...data.solo.scenarios[0], id: 't-assets', mission: 'blackbox-asset-preservation' };
const run = (state, cmd) => {
  const v = M.C.check(data, state, cmd);
  if (v.ok) { M.C.apply(data, state, cmd); M.G.glueAfter(data, state, cmd); }
  return v;
};
const sendAll = (state, commands) => commands.map((c) => run(state, c).ok);
const ids = (d) => (d ? d.options.map((o) => o.id) : null);
const name = (t) => (t.label.startsWith('ADK15P') ? 'Porcupine' : t.label.startsWith('ADK60S') ? 'Raven' : t.label.startsWith('ADK30C') ? 'Tarantula' : t.label);
const gridOf = (x) => ({ c: Math.floor(x.col / 3), r: Math.floor(x.row / 3) });

// Both tables are built before a seat is held: a table with a local seat wants
// the second player's Ready, as a room does.
const bases = new Map([keyGame, assetGame, data.solo.scenarios[0]].map((scenario) => {
  const t = tableAtRoundOne(M, data, scenario);
  if (t.refused.length) throw new Error(t.refused.join('; '));
  return [scenario.id, t.state];
}));
const baseOf = (scenario) => bases.get(scenario.id);
// Round 1, the Action Phase, no terrain (or the Alley's, where a check is of a
// walk round it), the enemy in a far corner, one Box put where the check wants
// it and the rest out of everybody's way.
const stage = (scenario = keyGame, terrain = false) => {
  const s = clone(baseOf(scenario));
  if (!terrain) s.map = 'none';
  const U = Object.fromEntries(s.tokens.map((t) => [name(t), t]));
  const at = (t, c, r, f) => { t.col = c * 3; t.row = r * 3; if (f !== undefined) t.facing = f; };
  at(U.Mire, 2, 2, 1); at(U.Dune, 0, 0, 2); at(U['Wild Cat'], 11, 11, 0); at(U.Porcupine, 11, 9, 0); at(U.Raven, 9, 11, 0); at(U.Tarantula, 11, 10, 0);
  s.round.phase = 2; s.script.stage = '1:2'; s.script.passed = []; s.script.revealed = ['s1', 's2']; s.script.opp = null;
  for (const t of s.tokens) if (t.kind === 'mech') t.timing = 'movement';
  const tasks = M.TK.normaliseTasks(s.tasks);
  const boxes = tasks.items.filter((i) => i.kind === 'blackbox');
  // Every Box parked along the bottom edge; `put` lays one in a Grid.
  boxes.forEach((b, i) => { b.col = (4 + i) * 3 + 1; b.row = 11 * 3 + 1; b.bearerUid = undefined; b.bearerSlot = undefined; });
  const put = (i, c, r) => { boxes[i].col = c * 3 + 1; boxes[i].row = r * 3 + 1; };
  const sync = () => { s.tasks = tasks; };
  sync();
  const turnOf = (mech, timing) => {
    mech.timing = timing;
    s.script.acted = s.tokens.filter((x) => x.kind === 'mech' && x.uid !== mech.uid).map((x) => x.uid);
    s.script.opp = null;
    return M.G.opportunity(data, s);
  };
  const activate = (unit) => { s.script.opp = M.TY.newOpportunity(unit.uid, undefined); return s.script.opp; };
  return { s, U, at, turnOf, activate, tasks, boxes, put, sync };
};
const bearerOf = (state, id) => M.TK.normaliseTasks(state.tasks).items.find((i) => i.id === id).bearerUid ?? null;
M.L.setLocalSeat('s1');

// ---------- what a seat sees ----------
{
  const s = baseOf(keyGame);
  const v = viewOf(s, 's1');
  const items = M.TK.normaliseTasks(s.tasks).items.filter((i) => i.kind === 'blackbox');
  check('the Task is read off its card: 4 Victory Points for each Box held, once, as the game ends',
    v.task, { family: 'blackbox', vp: 4, fromRound: 1, cadence: 'at-end', perPart: 0, scoringZone: null, reach: 0 });
  check('every Box on the table is in the view, each lying in its Grid with nobody carrying it',
    [v.boxes.length, items.length, v.boxes.every((b) => b.bearer === null && !!b.grid), v.boxes.map((b) => [b.grid.col, b.grid.row]), JSON.stringify(v.boxes) === JSON.stringify(viewOf(s, 's2').boxes)],
    [5, 5, true, items.map((i) => [Math.floor(i.col / 3), Math.floor(i.row / 3)]), true]);
  const hands = Object.fromEntries(v.units.map((u) => [name(u), u.hands]));
  check('a unit says how many Boxes it could pick up: one for each Freehand Part, none for a Drone that has no such Part',
    hands, { Mire: 1, Dune: 2, 'Wild Cat': 1, Porcupine: 0, Raven: 0, Tarantula: 0 });
  const plain = viewOf(baseOf(data.solo.scenarios[0]), 's1');
  check('on a table with no Black Box there are none to see and no hand is counted', [plain.boxes, plain.units.every((u) => u.hands === 0)], [[], true]);
  // A Box picked up is seen carried, by both seats, and its hand is taken.
  const t = clone(s);
  const tasks = M.TK.normaliseTasks(t.tasks);
  const mire = t.tokens.find((x) => x.label === 'Mire');
  tasks.items.find((i) => i.id === items[0].id).bearerUid = mire.uid;
  tasks.items.find((i) => i.id === items[0].id).bearerSlot = 'leftHand';
  t.tasks = tasks;
  const held = viewOf(t, 's2');
  check('a Box a unit carries is seen carried, by both seats, and the hand that holds it is no longer free',
    [held.boxes.find((b) => b.id === items[0].id), held.units.find((u) => u.uid === mire.uid).hands], [{ id: items[0].id, grid: null, bearer: mire.uid }, 0]);
}

// ---------- the pick-up ----------
{
  const { s, U, turnOf, boxes, put, sync } = stage();
  // The Mire at C3 facing east; a Box two Grids on, at E3.
  put(0, 4, 2); sync();
  turnOf(U.Mire, 'movement');
  const d = owed(data, s, 's1', newMind());
  const moves = d.options.filter((o) => o.tags[0] === 'move' && !o.tags.includes('pivot'));
  const takes = moves.filter((o) => o.tags.includes('take'));
  const plain = moves.filter((o) => !o.tags.includes('take'));
  check('a Movement that passes a loose Box has a second answer, with the pick-up: the Maneuver cannot reach it, the Sprint can',
    [takes.length > 0, takes.every((o) => !o.tags.includes('maneuver')), takes.every((o) => o.facts.boxes === 1 && o.id.endsWith(':take'))], [true, true, true]);
  const take = takes.find((o) => o.facts.to.c === 4 && o.facts.to.r === 2);
  check('the answer is the Movement and then the Box, onto the Freehand Part that is free',
    [take.commands.map((c) => c.kind), take.commands.at(-1).itemId, take.commands.at(-1).slot, take.commands.at(-1).uid], [['performAction', 'maneuver', 'takeBlackBox'], boxes[0].id, 'leftHand', U.Mire.uid]);
  // HELD TO THE ENGINE: for every Grid and facing the Sprint or the Maneuver
  // reaches. Where the route drawn straight to the Grid passes the Box, the
  // engine would take the pick-up after it, and it is offered. Where it does
  // not, the only pick-up is a route drawn BY WAY OF the Box, and it says so.
  // And every pick-up offered is taken whole, and ends where it says with the
  // Box in hand.
  const wrong = [];
  const grab = { kind: 'takeBlackBox', seat: 's1', uid: U.Mire.uid, itemId: boxes[0].id, slot: 'leftHand' };
  let straight = 0, around = 0;
  for (const o of plain) {
    const passes = !!M.G.tableAfter(data, s, [...o.commands, grab]);
    const twin = takes.find((x) => x.id === `${o.id}:take`);
    if (passes && !twin) wrong.push(`${o.id}: the straight route passes the Box and no pick-up is offered`);
    if (!twin) continue;
    const by = / by way of /.test(twin.label);
    if (by === passes) wrong.push(`${o.id}: the straight route ${passes ? 'passes' : 'misses'} the Box and the pick-up is ${by ? 'by way of it' : 'on the way'}`);
    if (by) around += 1; else straight += 1;
    const table = M.G.tableAfter(data, s, twin.commands);
    const mire = table?.tokens.find((x) => x.uid === U.Mire.uid);
    if (!table || bearerOf(table, boxes[0].id) !== U.Mire.uid) wrong.push(`${twin.id}: not taken whole`);
    else if (gridOf(mire).c !== twin.facts.to.c || gridOf(mire).r !== twin.facts.to.r) wrong.push(`${twin.id}: ends somewhere else`);
    if (twin.facts.grids > 4 || twin.facts.grids < o.facts.grids) wrong.push(`${twin.id}: ${twin.facts.grids} Grids of a Sprint of 4, the straight route ${o.facts.grids}`);
    if (JSON.stringify(twin.facts.taken) !== JSON.stringify([boxes[0].id])) wrong.push(`${twin.id}: does not say which Box`);
  }
  check('FOR EVERY GRID A MOVEMENT REACHES, the pick-up is offered wherever the straight route passes the Box, taken whole by the engine, and names the Box it takes', [wrong, plain.length > 20, straight > 0], [[], true, true]);
  // D2 is two Grids from C3 by the straight route, which goes nowhere near
  // the Box at E3; by way of the Box it is four (D3, E3, E2, D2).
  const d2 = takes.find((o) => o.facts.to.c === 3 && o.facts.to.r === 1);
  const d2plain = plain.find((o) => o.facts.to.c === 3 && o.facts.to.r === 1 && o.id === d2?.id.replace(/:take$/, ''));
  check('A ROUTE BY WAY OF THE BOX is an answer too, as a player draws one with a waypoint: a Grid the straight route reaches without passing the Box, reached through it where the Sprint is long enough',
    [around > 0, !!d2 && / by way of the Black Box, which it picks up$/.test(d2.label), d2?.facts.grids, d2plain?.facts.grids], [true, true, 4, 2]);
  check('and not where it is not: a Grid behind the Mire has no pick-up, and the Box\'s own Grid and those straight beyond it have the plain one', [takes.length < plain.length * 2, takes.some((o) => o.facts.to.c === 0), takes.filter((o) => o.facts.to.c > 4 && o.facts.to.r === 2).every((o) => / on the way$/.test(o.label))], [true, false, true]);
  const after = clone(s);
  check('taken, the Mire carries it: the engine takes all three commands', [sendAll(after, take.commands), bearerOf(after, boxes[0].id), viewOf(after, 's1').boxes.find((b) => b.id === boxes[0].id).grid], [[true, true, true], U.Mire.uid, null]);

  // No hand free: nothing to pick up with.
  const full = stage();
  full.put(0, 4, 2);
  full.boxes[1].bearerUid = full.U.Mire.uid; full.boxes[1].bearerSlot = 'leftHand';
  full.sync();
  full.turnOf(full.U.Mire, 'movement');
  check('a unit whose one Freehand Part already carries a Box is offered no pick-up', owed(data, full.s, 's1', newMind()).options.filter((o) => o.tags.includes('take')), []);
  // A Drone with no Freehand Part.
  const drone = stage();
  drone.put(0, 5, 5); drone.sync();
  drone.at(drone.U.Porcupine, 5, 4, 2);
  drone.s.round.phase = 0; drone.s.script.stage = '1:0'; drone.s.script.acted = []; drone.s.script.turn = 's2';
  drone.activate(drone.U.Porcupine);
  const dm = owed(data, drone.s, 's2', newMind()).options.filter((o) => o.tags[0] === 'move');
  check('a Drone with no Freehand Part walks over a Box and is offered nothing', [dm.length > 8, dm.filter((o) => o.tags.includes('take'))], [true, []]);
  // Two Boxes in one Grid.
  const two = stage();
  two.put(0, 1, 0); two.put(1, 1, 0); two.sync();
  two.turnOf(two.U.Dune, 'movement');
  const both = owed(data, two.s, 's1', newMind()).options.filter((o) => o.tags.includes('take') && o.facts.to.c === 1 && o.facts.to.r === 0);
  check('two Boxes in a Grid are both picked up by a Mech with two hands free, each onto a Part of its own',
    [both.length > 0, both[0].facts.boxes, both[0].commands.filter((c) => c.kind === 'takeBlackBox').map((c) => c.slot).sort(), !!M.G.tableAfter(data, two.s, both[0].commands)], [true, 2, ['leftHand', 'rightHand'], true]);
  const one = stage();
  one.put(0, 3, 2); one.put(1, 3, 2); one.sync();
  one.turnOf(one.U.Mire, 'movement');
  const single = owed(data, one.s, 's1', newMind()).options.filter((o) => o.tags.includes('take') && o.facts.to.c === 3 && o.facts.to.r === 2);
  check('and one of them by a Mech with one', [single[0].facts.boxes, single[0].commands.filter((c) => c.kind === 'takeBlackBox').length], [1, 1]);
}
{
  // As the activation ends in the Box's Grid.
  const { s, U, turnOf, boxes, put, sync } = stage();
  put(0, 2, 2); sync();
  turnOf(U.Mire, 'movement');
  const d = owed(data, s, 's1', newMind());
  const end = d.options.find((o) => o.id === 'end:take');
  check('an activation that ends in a loose Box\'s Grid may pick it up as it ends: a second way to end, and ending without it is still the safe answer',
    [!!end, end.tags, end.commands.map((c) => c.kind), d.fallback, d.options.some((o) => o.id === 'end')], [true, ['end', 'take'], ['takeBlackBox', 'endOpportunity'], 'end', true]);
  check('it says how many Boxes it takes and which', [end.facts.boxes, end.facts.taken], [1, [boxes[0].id]]);
  check('an asker that wants the ends alone is given both', ids(owed(data, s, 's1', newMind(), { only: ['end'] })), ['end', 'end:take']);
  const after = clone(s);
  check('taken: the Box is the Mire\'s and its Opportunity is over', [sendAll(after, end.commands), bearerOf(after, boxes[0].id), after.script.opp?.uid === U.Mire.uid], [[true, true], U.Mire.uid, false]);
  const none = stage();
  none.turnOf(none.U.Mire, 'movement');
  check('with no Box underfoot there is the one way to end', owed(data, none.s, 's1', newMind()).options.filter((o) => o.tags.includes('end')).map((o) => o.id), ['end']);
}

// ---------- the readings, and the panel that reads them back ----------
{
  const { s, U, boxes, put, sync } = stage();
  put(0, 4, 2); put(1, 6, 2); sync();
  const path = [{ c: 2, r: 2 }, { c: 3, r: 2 }, { c: 4, r: 2 }, { c: 5, r: 2 }, { c: 6, r: 2 }];
  check('a walked route passes every Box in a Grid it entered; a flight only those where it leaves and where it lands',
    [T.boxesOn(s, path).map((b) => b.id), T.boxesOn(s, path, true).map((b) => b.id), T.boxesOn(s, path.slice(0, 2)).map((b) => b.id)], [[boxes[0].id, boxes[1].id], [boxes[1].id], []]);
  check('a unit\'s free hands are its Freehand Parts not already bearing a Box', [T.boxHandsFree(data, s, U.Dune).map((h) => h.slot), T.boxHandsFree(data, s, U.Porcupine)], [['leftHand', 'rightHand'], []]);
  check('picking up what a route passed is one command a Box, for as many as there are hands; a Projectile takes none',
    [T.boxTakes(data, s, U.Mire, path).map((c) => [c.kind, c.itemId, c.slot]), T.boxTakes(data, s, U.Dune, path).length, T.boxTakes(data, s, { ...U.Mire, kind: 'projectile' }, path)],
    [[['takeBlackBox', boxes[0].id, 'leftHand']], 2, []]);
  const hud = src('matchhud.ts');
  check('the Match Centre\'s panel reads which Boxes a route passed and which hands are free from turn.ts, where a seat with no panel reads them too',
    [/const on = turn\.boxesOn\(ctx\.state, path, flight\);/.test(hud), /return turn\.boxHandsFree\(ctx\.data, ctx\.state, t\);/.test(hud)], [true, true]);
}

// ---------- the drop a computer's attack owes ----------
M.L.setLocalSeat(null);
{
  const HIT = { red: 0, yellow: 0, white: 7, blue: 7, black: 0 };
  const play = async (prepare) => {
    const seeded = new AI.Rng('6:boxes');
    let fixed = false;
    let target = 0;
    const script = (want) => ({
      name: 'scripted',
      choose(d, view, rng) {
        const id = want(d, view);
        return id && d.options.some((o) => o.id === id) ? { option: id, why: 'scripted' } : AI.eagerPolicy.choose(d, view, rng);
      },
    });
    const t = botTable(M, data, { ...keyGame, map: 'none' }, {
      seed: 6,
      dice: (pool) => Object.entries(pool).flatMap(([color, n]) => Array.from({ length: n }, () => ({ color, face: fixed ? HIT[color] : seeded.int(data.dice.dice[color].sides) }))),
      policies: {
        s1: script((d) => (d.kind === 'opp.act' ? (d.options.find((o) => o.run?.routine === 'attack' && o.facts?.targetUid === target && !o.tags.includes('spend-charge'))?.id ?? 'end') : d.kind === 'attack.part' ? 'part.roll' : null)),
        s2: script((d) => (d.kind === 'opp.act' ? 'end' : null)),
      },
    });
    await t.run({ until: (st) => M.SU.normaliseSetup(st.setup)?.stage === 'done' && st.round.phase === 2 });
    fixed = true;
    const U = Object.fromEntries(t.state.tokens.map((x) => [name(x), x]));
    const at = (x, c, r, f) => { x.col = c * 3; x.row = r * 3; x.facing = f; };
    at(U.Mire, 5, 4, 2); at(U.Dune, 0, 0, 2); at(U['Wild Cat'], 5, 6, 0); at(U.Porcupine, 11, 9, 0); at(U.Raven, 9, 11, 0); at(U.Tarantula, 11, 10, 0);
    for (const x of t.state.tokens) if (x.kind === 'mech') x.stance = 'offensive';
    const tasks = M.TK.normaliseTasks(t.state.tasks);
    const box = tasks.items.find((i) => i.kind === 'blackbox');
    box.bearerUid = U['Wild Cat'].uid; box.bearerSlot = 'leftHand'; box.col = undefined; box.row = undefined;
    t.state.tasks = tasks;
    prepare?.(U);
    target = U['Wild Cat'].uid;
    U.Mire.timing = 'firing';
    t.state.script.revealed = ['s1', 's2'];
    t.state.script.acted = [U.Dune.uid, U['Wild Cat'].uid];
    t.state.script.opp = null;
    M.G.opportunity(data, t.state);
    const base = { col: U['Wild Cat'].col, row: U['Wild Cat'].row, size: U['Wild Cat'].size };
    const legal = M.R.boxDropCells(base, [], M.TY.gridsOf(t.state) * 3);
    const before = t.sent.length;
    const end = await t.run({ until: (st) => t.sent.slice(before).some((x) => x.kind === 'applyPenetration') && !st.script.combatView, maxSteps: 300 });
    const item = M.TK.normaliseTasks(t.state.tasks).items.find((i) => i.id === box.id);
    const out = { t, U, end: end.kind, sent: t.sent.slice(before).map((x) => `${x.seat}:${x.kind}`), item, legal, refused: t.refused.map((x) => `${x.kind}: ${x.why}`) };
    t.close();
    return out;
  };
  const a = await play();
  const where = { col: a.item.col, row: a.item.row };
  const far = (x) => Math.abs(x.col - a.U.Mire.col - 1) + Math.abs(x.row - a.U.Mire.row - 1);
  check('PLAYED: the Mire Penetrates the Wild Cat, which carries a Box; the attacker\'s seat puts the Box down, and nothing is refused',
    [a.end, a.refused, a.sent.filter((k) => k === 's1:dropBlackBox').length, a.item.bearerUid ?? null, a.sent.indexOf('s1:dropBlackBox') > a.sent.indexOf('s1:applyPenetration')], ['paused', [], 1, null, true]);
  check('in a Small Grid in Contact with the bearer\'s base, and of those the one nearest the attacker',
    [a.legal.some((x) => x.col === where.col && x.row === where.row), far(where), Math.min(...a.legal.map(far))], [true, Math.min(...a.legal.map(far)), Math.min(...a.legal.map(far))]);
  // The same hit destroys the bearer: its base is where the Penetration found it.
  const b = await play((U) => { U['Wild Cat'].partStates.torso = 'damaged'; });
  check('a bearer the same hit destroys still drops it, in Contact with where it stood: the Box is on the board, loose',
    [b.end, b.refused, b.sent.filter((k) => k === 's1:dropBlackBox').length, b.item.bearerUid ?? null, b.legal.some((x) => x.col === b.item.col && x.row === b.item.row),
      b.t.state.tokens.some((x) => x.uid === b.U['Wild Cat'].uid && x.partStates.torso !== 'destroyed')], ['paused', [], 1, null, true, false]);
  const bot = src('ai/botcombat.ts');
  check('the window notes each bearer its attack Penetrates and puts the Boxes down as the attack ends, on a cell the seam says is legal',
    [/\(victim, attacker\) => \{ this\.boxDrops\.push\(\{ bearerUid: victim\.uid, byUid: attacker\.uid \}\); \},/.test(bot), /const spots = boxDropSpots\(this\.host\.data, state, box\.id\);/.test(bot), /this\.dropBoxes\(\);\n  \}/.test(bot)], [true, true, true]);
}
M.L.setLocalSeat('s1');

// ---------- what a Box is worth ----------
{
  const W = AI.TACTICIAN;
  const { s, U, at, boxes, sync } = stage();
  const end = W.missionFuture ** 4;
  check('with every Box lying loose the Task is worth nothing to either squad yet', AI.missionOf(viewOf(s, 's1'), W), 0);
  boxes[0].bearerUid = U.Mire.uid; boxes[0].bearerSlot = 'leftHand'; sync();
  check('a Box carried pays as the game ends: 4 Victory Points, for less the further off the end is; and it is the other squad\'s loss',
    [near(AI.missionOf(viewOf(s, 's1'), W), 4 * end), near(AI.missionOf(viewOf(s, 's2'), W), -4 * end), near(AI.carried(viewOf(s, 's1').units.find((u) => u.uid === U.Mire.uid), viewOf(s, 's1'), W), 4 * end)], [true, true, true]);
  boxes[1].bearerUid = U['Wild Cat'].uid; boxes[1].bearerSlot = 'leftHand'; sync();
  check('one each is level', near(AI.missionOf(viewOf(s, 's1'), W), 0), true);
  const last = clone(s);
  last.round.n = 5;
  const lt = M.TK.normaliseTasks(last.tasks);
  lt.items.find((i) => i.id === boxes[1].id).bearerUid = undefined;
  last.tasks = lt;
  check('in the last round it is worth what it will pay', near(AI.missionOf(viewOf(last, 's1'), W), 4), true);
  const dead = clone(s);
  dead.tokens.find((t) => t.uid === U['Wild Cat'].uid).partStates.torso = 'destroyed';
  check('a bearer that is not standing holds nothing', near(AI.missionOf(viewOf(dead, 's1'), W), 4 * end), true);

  // Asset Preservation: only in Echo.
  const a = stage(assetGame);
  const echo = viewOf(a.s, 's1').zones.find((z) => z.name === 'Echo');
  const [ec, er] = echo.cells[0].split(',').map(Number);
  a.boxes[0].bearerUid = a.U.Mire.uid; a.boxes[0].bearerSlot = 'leftHand'; a.sync();
  const bearer = (state) => viewOf(state, 's1').units.find((u) => u.uid === a.U.Mire.uid);
  check('on a Task that pays only in one zone, a Box carried outside it pays nothing as the board stands: the Task is priced as it would be scored',
    [viewOf(a.s, 's1').task.scoringZone, AI.missionOf(viewOf(a.s, 's1'), W)], ['Echo', 0]);
  check('what a Penetration would cost its bearer is a share of a Box that is home', near(AI.carried(bearer(a.s), viewOf(a.s, 's1'), W), 4 * W.carry * end), true);
  a.at(a.U.Mire, ec, er, 1);
  check('carried in, it is worth the whole of one, to the Task and to its bearer', [near(AI.missionOf(viewOf(a.s, 's1'), W), 4 * end), near(AI.carried(bearer(a.s), viewOf(a.s, 's1'), W), 4 * end)], [true, true]);
  void at;

  // THE ENGINE'S OWN AWARD. The card names its zone ("Echo"); a Task item
  // carries a zone's id ("echo"). The scorers' lookup matched the id alone,
  // found no Grids for the name, and paid nobody for a Box carried into the
  // zone: on every board, for as long as the clause had been read.
  const cells = M.S.zoneCellsOf(data, a.s);
  check('the scorers find a zone by the NAME a mission card prints as well as by its id', [cells('Echo'), cells('Echo').length > 0, cells('ECHO'), cells('nowhere')], [cells('echo'), true, cells('echo'), []]);
  const final = clone(a.s);
  final.round.n = 5; final.round.phase = 5;
  const paid = M.S.previewScore(data, final, true);
  check('THE ENGINE PAYS a Box held in Echo as the game ends: 4 Victory Points to its bearer\'s squad', [paid.s1, paid.s2, paid.lines.length], [4, 0, 1]);
  check('and nothing before the last round', [M.S.previewScore(data, final, false).s1], [0]);
  const out = clone(final);
  const mover = out.tokens.find((x) => x.uid === a.U.Mire.uid);
  mover.col = 0; mover.row = 0;
  check('a Box held anywhere else pays nothing', [M.S.previewScore(data, out, true).s1, M.S.previewScore(data, out, true).s2], [0, 0]);
  const unnamed = [];
  for (const card of data.missions.cards) {
    for (const zone of [...(card.zones ?? []), ...(card.scoringZone ? [card.scoringZone] : [])]) if (!cells(zone).length) unnamed.push(`${card.id}: ${zone}`);
  }
  check('every zone a Main Task card names is one the scorers find Grids for', [unnamed, data.missions.cards.some((c) => !!c.scoringZone)], [[], true]);
}

// ---------- the walk by way of a Box ----------
//
// On a Task that pays for a Box only in Echo, a Box lying loose is worth
// walking to only if it can still be carried there. Fetching it and carrying
// it are ONE walk: the Movement that enters the Box's Grid has the Box and
// goes on with what is left of its Range. Counted on the Alley as it is laid
// out, for the Dune (Maneuver 1, Sprint 4), the Box at C3 where the Task puts
// it, Echo the four Grids in the middle.
{
  const BOX = { c: 2, r: 2 };
  // The Dune in a Grid, with the Box or without, its Movement Opportunity
  // open; everybody else along the bottom edge, where no walk here goes.
  const tableFor = (k, has) => {
    const x = stage(assetGame, true);
    const [c, r] = k.split(',').map(Number);
    x.at(x.U.Mire, 8, 11); x.at(x.U.Dune, c, r);
    if (has) { x.boxes[0].bearerUid = x.U.Dune.uid; x.boxes[0].bearerSlot = 'leftHand'; x.boxes[0].col = undefined; x.boxes[0].row = undefined; } else x.put(0, BOX.c, BOX.r);
    x.sync();
    x.turnOf(x.U.Dune, 'movement');
    return x;
  };
  const { s, U } = tableFor('0,0', false);
  const dune = U.Dune;
  const echo = viewOf(s, 's1').zones.find((z) => z.name === 'Echo').cells.map((cell) => { const [c, r] = cell.split(',').map(Number); return { c, r }; });
  const legs = M.TURN.movementsOf(data, dune);
  const walk = (from, to, left, via) => M.SEAT.walkIn(data, s, dune.uid, [from], to, left, undefined, via)[0];
  const carry = walk(BOX, echo);
  check('the Dune\'s activation is its Maneuver and then its Sprint; from the Box at C3 Echo is two activations (a Container ends any Movement that enters it)', [legs, carry], [[1, 4], { grids: 6, turns: 2 }]);
  // EVERY GRID OF THE BOARD. Fetching and then carrying is always a walk, so
  // the one walk is never more than the two counted apart; and it saves at
  // most what was left of the activation that fetched the Box, so never more
  // than one. With a whole activation still to make from a Grid, the count is
  // one fewer: the field read forwards agrees with the field worked backwards.
  const wrong = [];
  let counted = 0, saved = 0;
  for (let c = 0; c < 12; c++) {
    for (let r = 0; r < 12; r++) {
      const k = { c, r };
      const one = walk(k, echo, undefined, BOX);
      const fetch = walk(k, [BOX]);
      if (!one) { if (fetch) wrong.push(`${c},${r}: a walk to the Box and none by way of it`); continue; }
      counted += 1;
      const apart = fetch.turns + carry.turns;
      // Standing in the Box's Grid it has not picked the Box up: it ends an
      // activation there, or steps off and comes back through with its Sprint.
      if (c === BOX.c && r === BOX.r) { if (one.turns < carry.turns || one.turns > carry.turns + 1) wrong.push(`${c},${r}: standing in the Box's Grid, ${one.turns}`); }
      else if (one.turns > apart || one.turns < apart - 1) wrong.push(`${c},${r}: ${one.turns}, apart ${apart}`);
      else if (one.turns === apart - 1) saved += 1;
      if (one.grids !== fetch.grids + carry.grids) wrong.push(`${c},${r}: ${one.grids} Grids, ${fetch.grids} + ${carry.grids}`);
      const more = walk(k, echo, legs, BOX);
      if (!more || more.turns !== one.turns - 1) wrong.push(`${c},${r}: ${one.turns} from a whole activation, ${more?.turns} after one`);
      // And with two activations' Movements still to make, two fewer: a Box
      // fetched by one Movement is still in hand for the next.
      const two = walk(k, echo, [...legs, ...legs], BOX);
      if (!two || two.turns !== Math.max(0, one.turns - 2)) wrong.push(`${c},${r}: ${one.turns} from a whole activation, ${two?.turns} after two`);
    }
  }
  check('FOR EVERY GRID OF THE ALLEY the one walk is the fetch and the carry counted apart, or an activation fewer; never more, never two fewer; and the count read forwards is the count worked backwards',
    [wrong, counted > 100, saved > 20], [[], true, true]);
  check('from E2 the Box is fetched and carried to Echo in two activations, where counted apart they are three (one to end in C3, two from there)',
    [walk({ c: 4, r: 1 }, echo, undefined, BOX).turns, walk({ c: 4, r: 1 }, [BOX]).turns, carry.turns], [2, 1, 2]);
  check('a drawn route never crosses itself: from E3 the Box is past D3, a Sprint into it by D3 does not come back out by D3, and the walk is three',
    [walk({ c: 4, r: 2 }, echo, undefined, BOX).turns, walk({ c: 3, r: 2 }, echo, undefined, BOX).turns], [3, 2]);
  check('a walk by way of a Grid nothing can stand in is no walk, and one with no way given is the plain walk', [walk({ c: 4, r: 1 }, echo, undefined, { c: 3, r: 3 }), walk({ c: 4, r: 1 }, echo)], [null, { grids: 5, turns: 2 }]);

  // HELD TO THE SEAM'S OWN MOVEMENTS. From a Grid, every (Grid, Box in hand or
  // not) one activation can end in, by the answers owed() gives: a Maneuver
  // or none, a Movement Action or none, the end (which picks up a Box
  // underfoot). Searched an activation at a time for the fewest that end in
  // Echo with the Box.
  const inEcho = new Set(echo.map((g) => `${g.c},${g.r}`));
  const memo = new Map();
  const activation = (k, has) => {
    const id = `${k}|${has}`;
    if (memo.has(id)) return memo.get(id);
    const ends = new Set();
    const where = (state, uid) => { const t = state.tokens.find((x) => x.uid === uid); return `${Math.floor(t.col / 3)},${Math.floor(t.row / 3)}`; };
    const finish = (state, uid, boxId) => {
      const d = owed(data, state, 's1', newMind());
      const end = d?.options.find((o) => o.id === 'end:take') ?? d?.options.find((o) => o.id === 'end');
      const t = clone(state);
      if (end) sendAll(t, end.commands);
      ends.add(`${where(t, uid)}|${bearerOf(t, boxId) === uid}`);
    };
    const moves = (state, maneuver) => {
      const seen = new Map();
      for (const o of owed(data, state, 's1', newMind())?.options ?? []) {
        if (o.tags[0] !== 'move' || o.tags.includes('pivot') || o.tags.includes('maneuver') !== maneuver) continue;
        const spot = `${o.facts.to.c},${o.facts.to.r}`;
        const held = seen.get(spot);
        if (!held || (o.tags.includes('take') && !held.tags.includes('take'))) seen.set(spot, o);
      }
      return [...seen.values()];
    };
    const x = tableFor(k, has);
    const uid = x.U.Dune.uid;
    const boxId = x.boxes[0].id;
    finish(x.s, uid, boxId);
    for (const o of moves(x.s, false)) { const t = clone(x.s); sendAll(t, o.commands); finish(t, uid, boxId); }
    for (const m of moves(x.s, true)) {
      const t = clone(x.s);
      sendAll(t, m.commands);
      finish(t, uid, boxId);
      for (const o of moves(t, false)) { const u = clone(t); sendAll(u, o.commands); finish(u, uid, boxId); }
    }
    memo.set(id, ends);
    return ends;
  };
  const fewest = (k, depth) => {
    let layer = new Set([`${k}|false`]);
    const seen = new Set(layer);
    for (let n = 1; n <= depth; n++) {
      const next = new Set();
      for (const st of layer) {
        const [g, has] = st.split('|');
        for (const e of activation(g, has === 'true')) {
          const [eg, eh] = e.split('|');
          if (eh === 'true' && inEcho.has(eg)) return n;
          if (!seen.has(e)) { seen.add(e); next.add(e); }
        }
      }
      layer = next;
    }
    return null;
  };
  const from = ['4,1', '3,2', '4,2', '2,3'];
  check('HELD TO THE SEAM\'S OWN MOVEMENTS: from E2, D3, E3 and C4 the fewest activations that end in Echo with the Box, by a search of the answers a seat is given, are the walk\'s count',
    from.map((k) => fewest(k, 3)), from.map((k) => { const [c, r] = k.split(',').map(Number); return walk({ c, r }, echo, undefined, BOX).turns; }));
  // The answer that makes E2 two: after the Maneuver to D2, the Sprint to E3
  // by way of the Box (C2, C3, D3, E3), which the route drawn straight to E3
  // (two Grids) does not pass.
  const d2 = tableFor('3,1', false);
  const by = owed(data, d2.s, 's1', newMind()).options.filter((o) => o.tags.includes('take') && o.facts.to.c === 4 && o.facts.to.r === 2);
  check('from D2 the Sprint to E3 has a second answer by way of the Box: four Grids of its four, where the straight route is two and passes nothing',
    [by.length > 0, by.every((o) => o.facts.grids === 4 && / by way of the Black Box/.test(o.label)), !!M.G.tableAfter(data, d2.s, by[0]?.commands ?? [{ kind: 'nothing' }])], [true, true, true]);
}
M.L.setLocalSeat(null);
{
  // THE TACTICIAN FETCHES AND CARRIES IN TIME. Round 4 of 5 on the Alley, the
  // Dune at D3 beside the Box at C3, nobody to shoot. Echo is two activations
  // off by way of the Box and there are two left: it takes the Box and ends
  // where Echo is ONE activation on. (It used to take the Box and walk on
  // toward the next Box, and from there Echo was two.)
  const t = botTable(M, data, assetGame, { seed: 2, policies: { s1: AI.makeTactician({ focus: false }), s2: AI.eagerPolicy } });
  await t.run({ until: (st) => M.SU.normaliseSetup(st.setup)?.stage === 'done' && st.round.phase === 2 });
  const U = Object.fromEntries(t.state.tokens.map((x) => [name(x), x]));
  const at = (x, c, r, f) => { x.col = c * 3; x.row = r * 3; if (f !== undefined) x.facing = f; };
  at(U.Dune, 3, 2, 1); at(U.Mire, 8, 11, 0); at(U['Wild Cat'], 11, 11, 0); at(U.Porcupine, 11, 9, 0); at(U.Raven, 9, 11, 0); at(U.Tarantula, 11, 10, 0);
  const tasks = M.TK.normaliseTasks(t.state.tasks);
  const boxes = tasks.items.filter((i) => i.kind === 'blackbox');
  boxes.forEach((b, i) => { b.col = (4 + i) * 3 + 1; b.row = 11 * 3 + 1; b.bearerUid = undefined; b.bearerSlot = undefined; });
  boxes[0].col = 2 * 3 + 1; boxes[0].row = 2 * 3 + 1;
  t.state.tasks = tasks;
  t.state.round.n = 4; t.state.script.stage = '4:2';
  U.Dune.timing = 'movement';
  t.state.script.revealed = ['s1', 's2'];
  t.state.script.acted = t.state.tokens.filter((x) => x.kind === 'mech' && x.uid !== U.Dune.uid).map((x) => x.uid);
  t.state.script.opp = null;
  M.G.opportunity(data, t.state);
  const echo = viewOf(t.state, 's1').zones.find((z) => z.name === 'Echo').cells.map((cell) => { const [c, r] = cell.split(',').map(Number); return { c, r }; });
  const reasons = [];
  for (let i = 0; i < 5; i++) {
    const step = await t.drivers.s1.step();
    if (step.kind !== 'acted') break;
    reasons.push(step.option.tags.includes('take') ? 'take' : step.option.tags[0]);
    if (step.option.tags.includes('end')) break;
  }
  const g = gridOf(U.Dune);
  const on = M.SEAT.walkIn(data, t.state, U.Dune.uid, [g], echo)[0];
  check('THE TACTICIAN FETCHES A BOX IT CAN STILL CARRY HOME: with two activations left and Echo two off by way of the Box, the Dune takes the Box and ends one activation from Echo',
    [bearerOf(t.state, boxes[0].id), on?.turns, reasons.includes('take'), t.refused], [U.Dune.uid, 1, true, []]);
  t.close();
}
{
  // What the plans are worth, read off the Tactician's own weighing of one
  // decision (AI.weighed), on a table staged for it.
  const staged = async (scenario, { terrain = false, round = 1, unit = 'Dune', timing = 'movement' }, arrange) => {
    const t = botTable(M, data, terrain ? scenario : { ...scenario, map: 'none' }, { seed: 2, policies: { s1: AI.makeTactician({ focus: false }), s2: AI.eagerPolicy } });
    await t.run({ until: (st) => M.SU.normaliseSetup(st.setup)?.stage === 'done' && st.round.phase === 2 });
    const U = Object.fromEntries(t.state.tokens.map((x) => [name(x), x]));
    const at = (x, c, r, f) => { x.col = c * 3; x.row = r * 3; if (f !== undefined) x.facing = f; };
    at(U.Dune, 0, 0, 2); at(U.Mire, 8, 11, 0); at(U['Wild Cat'], 11, 11, 0); at(U.Porcupine, 11, 9, 0); at(U.Raven, 9, 11, 0); at(U.Tarantula, 11, 10, 0);
    const tasks = M.TK.normaliseTasks(t.state.tasks);
    const boxes = tasks.items.filter((i) => i.kind === 'blackbox');
    boxes.forEach((b, i) => { b.col = (4 + i) * 3 + 1; b.row = 11 * 3 + 1; b.bearerUid = undefined; b.bearerSlot = undefined; });
    arrange({ U, at, boxes });
    t.state.tasks = tasks;
    t.state.round.n = round; t.state.script.stage = `${round}:2`;
    U[unit].timing = timing;
    t.state.script.revealed = ['s1', 's2'];
    t.state.script.acted = t.state.tokens.filter((x) => x.kind === 'mech' && x.uid !== U[unit].uid).map((x) => x.uid);
    t.state.script.opp = null;
    M.G.opportunity(data, t.state);
    const d = t.drivers.s1.pending();
    const rows = AI.weighed(d, viewOf(t.state, 's1'), { focus: false });
    return { t, U, boxes, d, rows };
  };
  // THE DEADLINE. The Dune at D3, the Box at C3, Echo two activations off by
  // way of it. In round 4 the walk is worth making; in round 5 it is not.
  const lay = ({ U, at, boxes }) => { at(U.Dune, 3, 2, 1); boxes[0].col = 2 * 3 + 1; boxes[0].row = 2 * 3 + 1; };
  const r4 = await staged(assetGame, { terrain: true, round: 4 }, lay);
  const r5 = await staged(assetGame, { terrain: true, round: 5 }, lay);
  const best = (rows) => Math.max(...rows.map((p) => p.shape));
  check('a Box that can still be carried home is worth walking for, and one that cannot is worth nothing: the same table in round 4 and in round 5',
    [best(r4.rows) > 0.5, best(r5.rows) <= 0, r4.rows.some((p) => / picks? ?up|picking up/.test(p.label)), r4.rows.length > 5], [true, true, true, true]);
  r4.t.close(); r5.t.close();
  // AN ENEMY BEARER IS WORTH SHOOTING for the Boxes it would drop: the same
  // shot at the same Mech, with a Box in its hand and without.
  const shot = async (bears) => staged(keyGame, { timing: 'firing' }, ({ U, at, boxes }) => {
    at(U.Dune, 4, 4, 1); at(U['Wild Cat'], 8, 4, 3);
    if (bears) { boxes[0].bearerUid = U['Wild Cat'].uid; boxes[0].bearerSlot = 'leftHand'; boxes[0].col = undefined; boxes[0].row = undefined; }
  });
  const plain = await shot(false);
  const bears = await shot(true);
  const aim = (x) => x.d.options.find((o) => o.run?.routine === 'attack' && o.facts?.targetUid === x.U['Wild Cat'].uid && !o.tags.includes('spend-charge'));
  const stay = (x) => x.rows.find((p) => p.how === 'stay');
  const pen = aim(bears).chance().pen;
  const W = AI.TACTICIAN;
  const drop = pen * W.holder * 4 * W.boxFuture ** 4;
  check('an enemy carrying a Box is worth more to shoot, by what its Boxes are worth for the chance of the Penetration that makes it drop them',
    [!!aim(plain), pen > 0.3, stay(bears).now - stay(plain).now >= drop - 1e-9, / at Wild Cat/.test(stay(bears).does)], [true, true, true, true]);
  plain.t.close(); bears.t.close();
  // THE OTHER SQUAD'S BOXES (M11; OTTO, 2026-10-03: "if I saw someone go for
  // the box ... I would plan accordingly to try to intercept and stop them or
  // steal it myself"). Each loose Box is a race (`AI.races`): the round each
  // squad's soonest unit with a hand free could take it, and the enemy unit
  // that would. The Wild Cat stands a Grid from the Box at F5, the Dune four
  // Grids off; the Wild Cat has had its turn this round, as `staged` leaves it.
  const BOX = { boxRace: 0.5, boxSteal: 1, deny: 1 };
  const raced = await staged(keyGame, { round: 3 }, ({ U, at, boxes }) => {
    at(U.Dune, 1, 4, 1); at(U['Wild Cat'], 6, 4, 3); boxes[0].col = 5 * 3 + 1; boxes[0].row = 4 * 3 + 1;
  });
  const rv = viewOf(raced.t.state, 's1');
  const done = AI.races(raced.d, rv, BOX)[raced.boxes[0].id];
  raced.t.state.script.acted = raced.t.state.script.acted.filter((uid) => uid !== raced.U['Wild Cat'].uid);
  const ready = AI.races(raced.d, viewOf(raced.t.state, 's1'), BOX)[raced.boxes[0].id];
  // (Since 2026-10-03 the three weights ship on: `boxRace` 0.5, `boxSteal` 1, `deny` 1.)
  check('A LOOSE BOX IS A RACE: the Wild Cat beside it would take it, a round later for having had its turn this round; and with the Box weights off nothing is worked out',
    [Object.keys(AI.races(raced.d, rv, { boxRace: 1, boxSteal: 0, deny: 0 })).length, done?.by, ready?.by, done?.theirs - ready?.theirs, ready?.theirs, typeof done?.ours],
    [0, raced.U['Wild Cat'].uid, raced.U['Wild Cat'].uid, 1, 3, 'number']);
  const steal = (w) => Math.max(...AI.weighed(raced.d, rv, { focus: false }, w).map((p) => p.shape));
  check('a Box this squad would take first that the other squad would take otherwise is worth more to walk for (`boxSteal`): the Box it keeps from them',
    steal({ boxSteal: 1 }) > steal({ boxSteal: 0 }) + 0.5, true);
  raced.t.close();
  // The same Box, the Wild Cat's turn still to come and the Dune far off: the
  // Wild Cat takes it this round, and the walk for it is worth half (`boxRace`).
  const lost = await staged(keyGame, { round: 3 }, ({ U, at, boxes }) => {
    at(U.Dune, 0, 0, 2); at(U['Wild Cat'], 6, 4, 3); boxes[0].col = 5 * 3 + 1; boxes[0].row = 4 * 3 + 1;
  });
  lost.t.state.script.acted = lost.t.state.script.acted.filter((uid) => uid !== lost.U['Wild Cat'].uid);
  const lv = viewOf(lost.t.state, 's1');
  const stayAt = (w) => AI.weighed(lost.d, lv, { focus: false }, w).find((p) => p.how === 'stay');
  const lostRace = AI.races(lost.d, lv, BOX)[lost.boxes[0].id];
  check('a Box the other squad would take first is worth less to walk for (`boxRace`): the Dune\'s walk to it, from where it stands, is worth less than it was',
    [lostRace.theirs < lostRace.ours || lostRace.ours === null, stayAt({ boxRace: 0.5 }).shape < stayAt({ boxRace: 1 }).shape - 0.1], [true, true]);
  lost.t.close();
  // The Dune with the Wild Cat in its rifle's sights, a Box beside the Wild
  // Cat, whose turn is still to come and which would take it first, and its
  // Torso one Penetration from gone.
  const grab = await staged(keyGame, { timing: 'firing' }, ({ U, at, boxes }) => {
    at(U.Dune, 4, 4, 1); at(U['Wild Cat'], 8, 4, 3); boxes[0].col = 9 * 3 + 1; boxes[0].row = 4 * 3 + 1;
    U['Wild Cat'].partStates.torso = 'damaged';
  });
  grab.t.state.script.acted = grab.t.state.script.acted.filter((uid) => uid !== grab.U['Wild Cat'].uid);
  const gv = viewOf(grab.t.state, 's1');
  const aimed = grab.d.options.find((o) => o.run?.routine === 'attack' && o.facts?.targetUid === grab.U['Wild Cat'].uid && !o.tags.includes('spend-charge'));
  const kill = aimed?.chance().kill ?? 0;
  const shotAt = (w) => AI.weighed(grab.d, gv, { focus: false }, w).find((p) => p.how === 'stay').now;
  const graceRace = AI.races(grab.d, gv, BOX)[grab.boxes[0].id];
  // (The Wild Cat has one hand free: of the Box beside it, which it would take
  // first, and the four it would reach in the same round as the Dune, it is
  // worth the one. The Dune's plan fires twice, each shot with its chance.)
  const box = 4 * W.boxFuture ** 4;
  const more = shotAt({ deny: 1 }) - shotAt({ deny: 0 });
  check('AN ATTACK ON THE UNIT THAT WOULD TAKE A BOX FIRST is worth that Box more (`deny`), for the chance it is destroyed before it can: no more Boxes than it has hands free',
    [graceRace?.by, graceRace?.theirs < graceRace?.ours, kill > 0, more >= kill * box - 1e-9, more <= 2 * box + 1e-9], [grab.U['Wild Cat'].uid, true, true, true, true]);
  grab.t.close();
  // AND ITS OWN BEARER COSTS MORE TO LEAVE IN A LINE OF FIRE: the same Grid,
  // in the same rifle's sights, with a Box in the Dune's hand and without.
  const sighted = async (carries) => staged(keyGame, {}, ({ U, at, boxes }) => {
    at(U.Dune, 4, 4, 1); at(U['Wild Cat'], 8, 4, 3);
    if (carries) { boxes[0].bearerUid = U.Dune.uid; boxes[0].bearerSlot = 'leftHand'; boxes[0].col = undefined; boxes[0].row = undefined; }
  });
  const bare = await sighted(false);
  const laden = await sighted(true);
  check('a unit carrying a Box stands to lose it where an enemy could Penetrate it: staying in the rifle\'s sights costs more with a Box in hand',
    [stay(bare).cost > 0, stay(laden).cost - stay(bare).cost > 0.3], [true, true]);
  bare.t.close(); laden.t.close();
  // A BOX BESIDE THE ZONE. Onto the Box by the Maneuver and on into Echo by
  // the Sprint is planned as ONE move: priced as a Box held in Echo, which is
  // what the table it leaves is worth.
  const near2 = await staged(assetGame, { round: 3 }, ({ U, at, boxes }) => { at(U.Dune, 4, 4, 1); boxes[0].col = 5 * 3 + 1; boxes[0].row = 4 * 3 + 1; });
  // The plan that BEGINS with the Maneuver onto the Box's own Grid (F5): the
  // Box is in hand for the Sprint behind it.
  const entry = near2.rows.filter((p) => /Maneuver to F5, facing \w+, picking up the Black Box on the way, then /.test(p.label)).sort((a, b) => b.mission - a.mission)[0];
  const inEcho = new Set(viewOf(near2.t.state, 's1').zones.find((z) => z.name === 'Echo').cells);
  check('a Box beside the zone: the Maneuver that picks it up and the Sprint into Echo behind it are one plan, worth a Box held in Echo',
    [!!entry, near(entry?.mission ?? 0, 4 * W.boxFuture ** 2), inEcho.has(`${entry?.at.col},${entry?.at.row}`)], [true, true, true]);
  near2.t.close();
  // WITH NOTHING LEFT TO MOVE BY. The Mire stands in a Box's Grid with its
  // Maneuver and both its Ticks spent: the one way to have the Box is to end
  // the activation with the pick-up, and it does.
  const spent = await staged(keyGame, { unit: 'Mire' }, ({ U, at, boxes }) => { at(U.Mire, 2, 2, 1); boxes[0].col = 2 * 3 + 1; boxes[0].row = 2 * 3 + 1; });
  Object.assign(spent.t.state.script.opp, { maneuver: 0, action: 0, maneuvered: true, moved: true, started: true });
  const last = await spent.t.drivers.s1.step();
  check('a unit with nothing left to move by, standing in a Box\'s Grid, ends its activation with the pick-up',
    [last.kind, last.option?.id, bearerOf(spent.t.state, spent.boxes[0].id), spent.t.refused], ['acted', 'end:take', spent.U.Mire.uid, []]);
  spent.t.close();
}
{
  // The Tactician's own choices, through a driver, on a staged table.
  const table = async (scenario, arrange) => {
    const t = botTable(M, data, { ...scenario, map: 'none' }, { seed: 2, policies: { s1: AI.makeTactician({ focus: false }), s2: AI.eagerPolicy } });
    await t.run({ until: (st) => M.SU.normaliseSetup(st.setup)?.stage === 'done' && st.round.phase === 2 });
    const U = Object.fromEntries(t.state.tokens.map((x) => [name(x), x]));
    const at = (x, c, r, f) => { x.col = c * 3; x.row = r * 3; if (f !== undefined) x.facing = f; };
    at(U.Mire, 2, 2, 1); at(U.Dune, 0, 0, 2); at(U['Wild Cat'], 11, 11, 0); at(U.Porcupine, 11, 9, 0); at(U.Raven, 9, 11, 0); at(U.Tarantula, 11, 10, 0);
    const tasks = M.TK.normaliseTasks(t.state.tasks);
    const boxes = tasks.items.filter((i) => i.kind === 'blackbox');
    boxes.forEach((b, i) => { b.col = (4 + i) * 3 + 1; b.row = 11 * 3 + 1; b.bearerUid = undefined; b.bearerSlot = undefined; });
    arrange({ U, at, boxes });
    t.state.tasks = tasks;
    U.Mire.timing = 'movement';
    t.state.script.revealed = ['s1', 's2'];
    t.state.script.acted = t.state.tokens.filter((x) => x.kind === 'mech' && x.uid !== U.Mire.uid).map((x) => x.uid);
    t.state.script.opp = null;
    M.G.opportunity(data, t.state);
    return { t, U, boxes };
  };
  // A Box two Grids off, nothing to shoot.
  const a = await table(keyGame, ({ boxes }) => { boxes[0].col = 4 * 3 + 1; boxes[0].row = 2 * 3 + 1; });
  const made = [];
  for (let i = 0; i < 4 && bearerOf(a.t.state, a.boxes[0].id) === null; i++) {
    const step = await a.t.drivers.s1.step();
    if (step.kind !== 'acted') break;
    made.push(step.option.tags.includes('take') ? 'take' : step.option.tags[0]);
  }
  check('THE TACTICIAN WALKS TO A BOX AND PICKS IT UP: two Grids off, with nothing to shoot, the Mire has it within its Opportunity',
    [bearerOf(a.t.state, a.boxes[0].id), made.includes('take'), a.t.refused], [a.U.Mire.uid, true, []]);
  a.t.close();
  // THE STEAL IS THE PICK-UP'S TOO (`stealOf`, 2026-10-04): the Box the other
  // squad would take otherwise, picked up now, is worth what it pays and the
  // steal beside it (`boxSteal`), as the walk for it is; without it a walk for
  // the Box outweighed having it, and the Mire stood beside it (this check's
  // table, before the mend). The same table again, weighed with the steal on
  // and off.
  const s2 = await table(keyGame, ({ boxes }) => { boxes[0].col = 4 * 3 + 1; boxes[0].row = 2 * 3 + 1; });
  const sv = viewOf(s2.t.state, 's1');
  const sd = s2.t.drivers.s1.pending();
  const take = (w) => AI.weighed(sd, sv, { focus: false }, w).find((p) => /picking up the Black Box/.test(p.label));
  const stayOf = (w) => AI.weighed(sd, sv, { focus: false }, w).find((p) => p.how === 'stay');
  const on = take({});
  const off = take({ boxSteal: 0 });
  check('A BOX THE OTHER SQUAD WOULD TAKE OTHERWISE, PICKED UP NOW, IS WORTH THE STEAL TOO: twice what it is worth with `boxSteal` 0, and more than standing beside it',
    [!!on && !!off, on && off ? Math.abs(on.mission - 2 * off.mission) < 1e-6 : false, on && stayOf({}) ? on.worth > stayOf({}).worth : false], [true, true, true]);
  s2.t.close();
  // A Box underfoot.
  const b = await table(keyGame, ({ boxes }) => { boxes[0].col = 2 * 3 + 1; boxes[0].row = 2 * 3 + 1; });
  const picked = [];
  for (let i = 0; i < 4 && bearerOf(b.t.state, b.boxes[0].id) === null; i++) {
    const step = await b.t.drivers.s1.step();
    if (step.kind !== 'acted') break;
    picked.push(step.option.id);
  }
  check('a Box in the Grid it stands in is picked up before its Opportunity is over', [bearerOf(b.t.state, b.boxes[0].id), b.t.refused], [b.U.Mire.uid, []]);
  b.t.close();
  // Asset Preservation, carrying: it goes for Echo.
  const c = await table(assetGame, ({ U, at, boxes }) => { at(U.Mire, 2, 5, 1); boxes[0].bearerUid = U.Mire.uid; boxes[0].bearerSlot = 'leftHand'; boxes[0].col = undefined; boxes[0].row = undefined; });
  const echo = viewOf(c.t.state, 's1').zones.find((z) => z.name === 'Echo');
  const gap = () => Math.min(...echo.cells.map((cell) => { const [col, row] = cell.split(',').map(Number); const g = gridOf(c.U.Mire); return Math.abs(g.c - col) + Math.abs(g.r - row); }));
  const was = gap();
  for (let i = 0; i < 4; i++) { const step = await c.t.drivers.s1.step(); if (step.kind !== 'acted' || step.option.tags.includes('end')) break; }
  check('carrying a Box on a Task that pays for it only in Echo, it carries it there: three Grids off, it stands in Echo when its Opportunity is over',
    [was, gap(), bearerOf(c.t.state, c.boxes[0].id), c.t.refused], [3, 0, c.U.Mire.uid, []]);
  c.t.close();
}

// ---------- whole games ----------
{
  const tally = { games: 0, over: 0, refused: 0, mine: 0, theirs: 0, taken: 0, dropped: 0, broken: [], paid: {} };
  for (const scenario of [keyGame, assetGame]) {
    tally.paid[scenario.id] = 0;
    for (const seat of ['s1', 's2']) {
      for (const seed of [1, 2]) {
        const other = seat === 's1' ? 's2' : 's1';
        const t = botTable(M, data, scenario, { seed, policies: { [seat]: AI.makeTactician({ focus: false }), [other]: AI.eagerPolicy } });
        let end;
        try { end = await t.run({ maxSteps: 9000 }); } catch (err) { end = { kind: 'threw', why: err.message }; } finally { t.close(); }
        tally.games += 1;
        if (end.kind === 'over') tally.over += 1; else tally.broken.push(`${scenario.id} ${seat} ${seed}: ${end.kind} ${end.why ?? ''}`);
        tally.refused += t.refused.length;
        const vp = M.TK.normaliseTasks(t.state.tasks).vp;
        tally.mine += vp[seat]; tally.theirs += vp[other];
        tally.paid[scenario.id] += vp[seat];
        tally.taken += t.sent.filter((x) => x.seat === seat && x.kind === 'takeBlackBox').length;
        tally.dropped += t.sent.filter((x) => x.kind === 'dropBlackBox').length;
        // A Box is in one place: on the board, or with one standing unit.
        const items = M.TK.normaliseTasks(t.state.tasks).items.filter((i) => i.kind === 'blackbox');
        if (items.some((i) => (i.bearerUid === undefined) === (i.col === undefined))) tally.broken.push(`${scenario.id} ${seat} ${seed}: a Box is nowhere, or in two places`);
      }
    }
  }
  check('eight games of the copied squads on two Black Box missions, the Tactician in each seat against the eager policy (which fights and plays no Task): every one ends as a game should, nothing refused, every Box in one place',
    [tally.over, tally.games, tally.refused, tally.broken], [8, 8, 0, []]);
  check('and the Tactician plays the Task: it picks Boxes up and is paid for them on BOTH missions (on Asset Preservation only for one carried into Echo), where the eager policy is paid nothing',
    [tally.taken > 0, tally.paid[keyGame.id] > 0, tally.paid[assetGame.id] > 0, tally.theirs], [true, true, true, 0]);
  console.log(`       Victory Points ${tally.mine} to ${tally.theirs} (Key Facility ${tally.paid[keyGame.id]}, Asset Preservation ${tally.paid[assetGame.id]}); ${tally.taken} Boxes picked up by the Tactician, ${tally.dropped} knocked loose and put down`);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
