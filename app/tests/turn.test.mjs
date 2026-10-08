// What a turn offers, read with no page (AI-OPPONENT-PLAN.md, M1.2).
//
// src/turn.ts holds the readings the Match Centre's panels used to work out
// between the lines that drew them: which Actions a unit may perform now, the
// Grids a Movement reaches, the enemies an attack may name, where a Projectile
// may land, and what performing an Action opens. The panels draw from it and
// the seat seam (src/seat.ts) reads it, so a computer player is offered what a
// player's panel offers. This runs it on the real engine with the copied solo
// squads on an open board, and pins that the Match Centre asks it and nothing
// else.
import { readFileSync } from 'node:fs';
import { loadEngine, tableAtRoundOne } from './_engine.mjs';
import { reckonLines } from './_sightref.mjs';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}\n       got  ${g}`); }
};

console.log('What a turn offers\n');

const { M, data } = await loadEngine('turn', ["export * as TURN from '../src/turn';"]);
const T = M.TURN;
const base = tableAtRoundOne(M, data, data.solo.scenarios[0]);

// The copied squads in the Action Phase on a board with no terrain: the Mire
// in the middle facing East, a Raven in the next Grid ahead of it, the Wild
// Cat three Grids ahead, the Tarantula six, a Porcupine four Grids to the
// South, out of its arc.
const stage = () => {
  const s = JSON.parse(JSON.stringify(base.state));
  s.map = 'none';
  const name = (t) => (t.label.startsWith('ADK15P') ? 'Porcupine' : t.label.startsWith('ADK60S') ? 'Raven' : t.label.startsWith('ADK30C') ? 'Tarantula' : t.label);
  const U = Object.fromEntries(s.tokens.map((t) => [name(t), t]));
  const at = (t, c, r, f) => { t.col = c * 3; t.row = r * 3; if (f !== undefined) t.facing = f; };
  at(U.Mire, 5, 4, 1); at(U.Dune, 0, 0, 2); at(U['Wild Cat'], 8, 4, 3); at(U.Porcupine, 5, 8, 0); at(U.Raven, 6, 4, 3); at(U.Tarantula, 11, 4, 0);
  s.round.phase = 2; s.script.stage = '1:2'; s.script.revealed = ['s1', 's2'];
  for (const t of s.tokens) if (t.kind === 'mech') t.timing = 'firing';
  const open = (t, timing = 'firing', over = {}) => {
    const o = { ...M.TY.newOpportunity(t.uid, timing), ...over };
    o.extras = M.U.extrasFor(data, t);
    s.script.opp = o;
    return o;
  };
  return { s, U, at, open, name };
};
const grids = (list) => list.map((g) => `${g.c},${g.r}`).sort();
const name0 = (t) => (t.label.startsWith('ADK15P') ? 'Porcupine' : t.label.startsWith('ADK60S') ? 'Raven' : t.label.startsWith('ADK30C') ? 'Tarantula' : t.label);

// ---------- the board ----------
{
  const s = JSON.parse(JSON.stringify(base.state));
  const all = T.terrainOf(data, s);
  check('the terrain of a shipped map is read off the map', [all.length, [...new Set(all.map((p) => p.type))].sort()], [30, ['building', 'container', 'high_wall', 'low_wall']]);
  s.removedTerrain = [all[0].id, all[1].id];
  check('with anything destroyed taken out of it', [T.terrainOf(data, s).length, T.terrainOf(data, s).some((p) => p.id === all[0].id)], [28, false]);
  check('a map with no layout has none, and never throws', [T.terrainOf(data, { ...s, map: 'none' }), T.mapPieces({ terrain: { layouts: {} } }, 'x')], [[], []]);
  check('an authored map brings its own pieces',
    T.mapPieces({ boardMaps: [{ id: 'mine', pieces: [{ id: 'p1' }] }], terrain: { layouts: { mine: [{ id: 'old' }] } } }, 'mine').map((p) => p.id), ['p1']);
}

// ---------- the Actions a unit may perform now ----------
{
  const { s, U, open } = stage();
  const o = open(U.Mire);
  const rows = T.actionRows(data, s, U.Mire, o);
  check('a Mech is offered its Parts\' Actions and the Common ones, never a Passive',
    rows.map((r) => r.key),
    ['534_A', '535_A', '536_A', '536_B', '004_A', 'COMMON_CHARGE', 'COMMON_DISCARD', 'COMMON_PUNCH_MELEE@chasis', 'COMMON_CRAWL@chasis', 'COMMON_REVEAL', 'COMMON_STABILIZE', 'COMMON_SCAN']);
  const verdict = Object.fromEntries(rows.map((r) => [r.key, r.v.ok ? 'ok' : r.v.code ?? 'board']));
  check('the Starting Action must match the dial: on Firing, the two Firing Actions and nothing else',
    verdict, { '534_A': 'dial', '535_A': 'dial', '536_A': 'ok', '536_B': 'ok', '004_A': 'dial', COMMON_CHARGE: 'board', COMMON_DISCARD: 'dial',
      'COMMON_PUNCH_MELEE@chasis': 'dial', 'COMMON_CRAWL@chasis': 'dial', COMMON_REVEAL: 'board', COMMON_STABILIZE: 'dial', COMMON_SCAN: 'board' });
  check('a row carries its Part, its card, its length and its cost',
    rows.filter((r) => r.key.startsWith('536')).map((r) => [r.slot, r.cardId, r.len, r.cost]),
    [['rightHand', '536', 'medium', { maneuver: 0, action: 2 }], ['rightHand', '536', 'short', { maneuver: 0, action: 1 }]]);
  check('and the Ammo left, for an Action that spends it', rows.find((r) => r.key === '004_A').ammoLeft, 4);
  check('the board\'s reason comes before the Ticks\': a Charge with no Part to Charge says so',
    /no Part it could Charge/.test(rows.find((r) => r.key === 'COMMON_CHARGE').v.why), true);
  const started = { ...o, started: true, action: 1, performed: ['536_B'] };
  const after = Object.fromEntries(T.actionRows(data, s, U.Mire, started).map((r) => [r.key, r.v.ok ? 'ok' : r.v.code ?? 'board']));
  check('once it has started, the dial binds nothing: a Short Action fits the Tick left, a Medium does not, the one performed is not repeated',
    [after['535_A'], after['534_A'], after['536_A'], after['536_B']], ['ok', 'cost', 'cost', 'repeat']);
  const spent = Object.fromEntries(T.actionRows(data, s, U.Mire, { ...o, started: true, action: 0, maneuver: 0 }).map((r) => [r.key, r.v.code ?? (r.v.ok ? 'ok' : 'board')]));
  check('and with no Ticks nothing is', [spent['535_A'], spent['536_B']], ['noTicks', 'noTicks']);
  U.Mire.partStates.rightHand = 'destroyed';
  check('a destroyed Part takes its Actions away',
    T.actionRows(data, s, U.Mire, o).filter((r) => r.key.startsWith('536')).map((r) => r.v.ok), [false, false]);
  U.Mire.partStates.rightHand = 'intact';
  U.Mire.stance = 'shutdown';
  check('a Mech in Shutdown is offered none of them', T.actionRows(data, s, U.Mire, o).filter((r) => r.v.ok).map((r) => r.key), []);
}
{
  const { s, U } = stage();
  const o = M.TY.newOpportunity(U.Porcupine.uid, undefined);
  s.script.opp = o;
  s.round.phase = 3; s.script.stage = '1:3';
  check('in the Automatic Phase a Drone performs its Automatic Action and not its Command one',
    T.actionRows(data, s, U.Porcupine, o).map((r) => [r.key, r.v.ok]), [['543_A', true], ['543_B', false]]);
  check('and does not move', [T.maneuverVerdict(s, U.Porcupine, o).ok, /moves only when Commanded/.test(T.maneuverVerdict(s, U.Porcupine, o).why)], [false, true]);
  s.round.phase = 0; s.script.stage = '1:0';
  check('with a Command it is the other way round, and it may move instead',
    [T.actionRows(data, s, U.Porcupine, o).map((r) => [r.key, r.v.ok]), T.maneuverVerdict(s, U.Porcupine, o).ok], [[['543_A', false], ['543_B', true]], true]);
  check('a moved Drone has spent its activation: no Action and no second move',
    [T.actionRows(data, s, U.Porcupine, { ...o, maneuvered: true }).map((r) => r.v.ok), T.maneuverVerdict(s, U.Porcupine, { ...o, maneuvered: true }).ok], [[false, false], false]);
  check('a Carrier lists none of its Load\'s Actions', T.actionRows(data, s, U.Tarantula, M.TY.newOpportunity(U.Tarantula.uid, undefined)).map((r) => r.key), []);
}

// ---------- the Maneuver ----------
{
  const { s, U, open } = stage();
  const o = open(U.Mire);
  check('a fresh Mech may Maneuver', T.maneuverVerdict(s, U.Mire, o), { ok: true });
  check('not twice, and not once an Action Tick is spent',
    [T.maneuverVerdict(s, U.Mire, { ...o, maneuvered: true, maneuver: 0 }).ok, T.maneuverVerdict(s, U.Mire, { ...o, started: true }).ok], [false, false]);
  U.Mire.statuses = [...U.Mire.statuses, 'immobilized'];
  check('nor while Immobilized (6.3.2)', T.maneuverVerdict(s, U.Mire, o).ok, false);
  U.Mire.statuses = U.Mire.statuses.filter((x) => x !== 'immobilized');
  U.Mire.stance = 'shutdown';
  check('nor in Shutdown (4.1.1)', /Shutdown Stance/.test(T.maneuverVerdict(s, U.Mire, o).why), true);
}

// ---------- Movement ----------
{
  const { s, U, at } = stage();
  check('a Maneuver reaches the Grids its Chassis allows: one, on the Mire, and the Raven\'s Grid is a Crush',
    grids(T.reachableFor(data, s, U.Mire)), ['4,4', '5,3', '5,5', '6,4']);
  const sprint = grids(T.reachableFor(data, s, U.Mire, 4, undefined, '534_A'));
  check('a Movement Action reaches its own printed Range', [sprint.length, sprint.includes('5,0'), sprint.includes('5,8'), sprint.includes('1,4')], [35, true, true, true]);
  check('never into the Grid of a unit it cannot Crush, nor through it', [sprint.includes('8,4'), sprint.includes('9,4')], [false, false]);
  const opts = T.moveOptsFor(data, s, U.Mire, false);
  check('the route\'s rules name the Grids a Crush may end in', [opts.crushable(6, 4), opts.crushable(8, 4), opts.crushable(5, 3)], [true, false, false]);
  check('a square-base flyer moves as a flight, a Mech does not', [T.movesAsFlight(data, s, U.Raven), T.movesAsFlight(data, s, U.Mire)], [true, false]);
  check('and a flight is not priced for Break Away', [typeof T.moveOptsFor(data, s, U.Mire, true).exitCost, typeof opts.exitCost], ['undefined', 'function']);
  // A Mech next to an enemy Mech pays to leave: Break Away (4.6.4).
  at(U['Wild Cat'], 6, 4, 3); at(U.Raven, 2, 2, 0);
  const locked = T.moveOptsFor(data, s, U.Mire, false);
  check('leaving a Melee Lock is priced into the route, so the Mire\'s one Grid of Maneuver reaches nothing',
    [locked.exitCost(5, 4) > 0, grids(T.reachableFor(data, s, U.Mire))], [true, []]);
}

// ---------- a Movement, from the plan to the command ----------
const cardAction = (id) => data.cards.flatMap((c) => c.actions ?? []).find((a) => a.id === id) ?? data.commonActions.find((a) => a.id === id);
{
  const { s, U } = stage();
  check('a Maneuver opens on the Chassis Value, walked',
    T.moveStart(data, s, U.Mire, { maneuver: true }), { ok: true, steps: 1, flying: false, flightOptional: false });
  check('a Movement Action brings its own Range, and its move is free of the Maneuver Tick because its Ticks paid for it',
    [T.actionMove(cardAction('534_A')), T.moveStart(data, s, U.Mire, T.actionMove(cardAction('534_A')))],
    [{ actionId: '534_A', range: 4, free: true, airborne: false }, { ok: true, steps: 4, flying: false, flightOptional: false }]);
  check('a Drone\'s Action costs no Tick, so a move it made would ride on nothing', T.actionMove(cardAction('543_B')).free, false);
  check('a square-base flyer flies every Movement, with no choice in it',
    T.moveStart(data, s, U.Raven, { maneuver: true }), { ok: true, steps: 9, flying: true, flightOptional: false });
  U.Mire.statuses = ['immobilized'];
  const pinned = T.moveStart(data, s, U.Mire, { maneuver: true });
  check('an Immobilized unit opens no Movement, and is told why (6.3.2)', [pinned.ok, /Immobilized Token/.test(pinned.why)], [false, true]);
  U.Mire.statuses = [];
  U.Mire.partStates.chasis = 'destroyed';
  check('a destroyed Chassis leaves a Maneuver that may only turn: it opens at no Range (FAQ E4)',
    T.moveStart(data, s, U.Mire, { maneuver: true }), { ok: true, steps: 0, flying: false, flightOptional: false });
  U.Mire.partStates.chasis = 'intact';
  const mine = { ...M.U.makeDroneToken(s, data, data.byId.get('074'), 's2'), col: 16, row: 7, facing: 0 };
  check('a unit with no Movement Range on its card opens none',
    T.moveStart(data, s, mine, { maneuver: true }), { ok: false, why: 'GM-35 Anti-Armor Mine has no Movement Range on its card.' });
}
{
  const { s, U } = stage();
  const here = M.R.largeGridOf(U.Mire);
  const sprint = (to) => T.extendRoute(data, s, U.Mire, [here], to, 4, false, '534_A');
  const route = sprint({ c: 5, r: 0 });
  check('a route runs Grid by Grid from where the unit stands to the Grid picked', grids(route).length === 5 && route.map((g) => `${g.c},${g.r}`), ['5,4', '5,3', '5,2', '5,1', '5,0']);
  check('there is none to a Grid it cannot enter, nor to its own', [sprint({ c: 8, r: 4 }), sprint(here)], [null, null]);
  // The Action a route is made with shapes it: [Moving in Straight Line] +N
  // lets a run that never turns go N Grids past the printed Range.
  {
    const found = data.cards.flatMap((c) => (c.actions ?? []).map((a) => ({ c, a }))).find(({ c, a }) => c.category === 'mech_part' && M.U.straightLineBonus(a) > 0 && (a.range ?? 0) > 0);
    const runner = { ...M.U.makeMechToken(s, data, { torso: '533', chasis: '534', leftHand: '535', rightHand: '536', backpack: '004', pilot: 'FPA-04-2', [found.c.type]: found.c.id }, 's1', 'Runner'), col: 0, row: 33, facing: 1 };
    s.tokens.push(runner);
    const from = M.R.largeGridOf(runner);
    const past = { c: from.c + found.a.range + M.U.straightLineBonus(found.a), r: from.r };
    check('a route is drawn by the Action it is made with: a straight run goes its bonus past the Range, and only for that Action',
      [T.extendRoute(data, s, runner, [from], past, found.a.range, false, found.a.id)?.length ?? null, T.extendRoute(data, s, runner, [from], past, found.a.range, false)],
      [found.a.range + M.U.straightLineBonus(found.a) + 1, null]);
    s.tokens.pop();
  }
  const draft = (over = {}) => ({ uid: U.Mire.uid, steps: 4, flying: false, path: route, actionId: '534_A', free: true, facing: U.Mire.facing, turned: false, spin: 0, ...over });
  const plain = T.moveOrder(data, s, U.Mire, draft());
  check('a drawn route comes to a walk: a stop in each Grid, the last of them where it ends',
    [plain.kind, plain.cut, plain.halt ?? null, plain.stops.map((p) => `${p.col},${p.row}`), plain.last, plain.goal, plain.crushes],
    ['route', -1, null, ['15,12', '15,9', '15,6', '15,3', '15,0'], { col: 15, row: 0 }, { c: 5, r: 0 }, false]);
  check('and to ONE command: the destination, the walk to it, the Action it rides, and no facing when none was chosen',
    plain.command, { kind: 'maneuver', seat: 's1', uid: U.Mire.uid, to: { col: 15, row: 0 }, free: true, via: plain.stops, actionId: '534_A' });
  const turned = T.moveOrder(data, s, U.Mire, draft({ facing: 0, turned: true, resume: true, free: undefined, granted: true }));
  check('a facing chosen travels with it, and so do a granted Movement and the Go on after a Mine',
    [turned.facing, turned.command.facing, turned.command.granted, turned.command.resume, 'free' in JSON.parse(JSON.stringify(turned.command))], [0, 0, true, true, false]);
  check('a flown route says so, for the engine to price it as a flight', T.moveOrder(data, s, U.Mire, draft({ flying: true })).command.flying, true);
  // A MINE in a Grid the walk enters stops it there (ruling I16; M19).
  const mine = { ...M.U.makeDroneToken(s, data, data.byId.get('074'), 's2'), col: 16, row: 7, facing: 0 };
  s.tokens.push(mine);
  const stopped = T.moveOrder(data, s, U.Mire, draft());
  check('a Mine on the route cuts the walk at its Grid and keeps back the Range not yet spent',
    [stopped.cut, stopped.halt, stopped.path.map((g) => `${g.c},${g.r}`), stopped.last, stopped.command.halt, stopped.command.to],
    [2, 2, ['5,4', '5,3', '5,2'], { col: 15, row: 6 }, 2, { col: 15, row: 6 }]);
  check('a flight enters only its landing, so nothing stops it', [T.moveOrder(data, s, U.Mire, draft({ flying: true })).cut, T.moveOrder(data, s, U.Mire, draft({ flying: true })).command.to], [-1, { col: 15, row: 0 }]);
  mine.row = 1;
  check('a Mine in the landing Grid is the landing\'s own, and stops nothing', [T.moveOrder(data, s, U.Mire, draft()).cut, T.moveOrder(data, s, U.Mire, draft()).halt ?? null], [-1, null]);
  mine.row = 7;
  const steered = T.moveOrder(data, s, U.Mire, draft({ controller: { uid: U['Wild Cat'].uid, side: 's2' } }));
  check('a steered unit moves by the controller\'s command, stops at the Mine too, and keeps nothing back (R5)',
    [steered.command, steered.cut, steered.halt ?? null],
    [{ kind: 'controlledMove', seat: 's2', uid: U['Wild Cat'].uid, targetUid: U.Mire.uid, to: { col: 15, row: 6 }, via: steered.stops, actionId: '534_A' }, 2, null]);
  s.tokens.pop();
  // Turning on the spot.
  check('a plan with no route and no turn is nothing to commit', T.moveOrder(data, s, U.Mire, draft({ path: [here] })), { kind: 'idle' });
  check('a turn on the spot is a Movement of its own, sent as the Maneuver it is',
    T.moveOrder(data, s, U.Mire, { uid: U.Mire.uid, steps: 1, flying: false, path: [here], facing: 2, turned: true, spin: 1 }),
    { kind: 'pivot', full: false, command: { kind: 'maneuver', seat: 's1', uid: U.Mire.uid, to: { col: 15, row: 12 }, facing: 2 } });
  const circle = T.moveOrder(data, s, U.Mire, { uid: U.Mire.uid, steps: 1, flying: false, path: [here], facing: U.Mire.facing, turned: true, spin: -4 });
  check('four quarter turns one way end facing where they began, and the engine is told it was a Movement (1.04, 1.8)',
    [circle.full, circle.command.spun, circle.command.facing], [true, true, U.Mire.facing]);
  check('three turns and one back are not a full circle', T.moveOrder(data, s, U.Mire, { uid: U.Mire.uid, steps: 1, flying: false, path: [here], facing: U.Mire.facing, turned: true, spin: 2 }).full, false);
  check('a steered unit is turned by the controller\'s command',
    T.moveOrder(data, s, U.Mire, { uid: U.Mire.uid, steps: 1, flying: false, path: [here], facing: 3, turned: true, spin: -1, controller: { uid: U['Wild Cat'].uid, side: 's2' } }).command,
    { kind: 'controlledMove', seat: 's2', uid: U['Wild Cat'].uid, targetUid: U.Mire.uid, to: { col: 15, row: 12 }, facing: 3 });
  // Ending in an occupied Grid is a Crush (4.3.6).
  const crush = T.moveOrder(data, s, U.Mire, { uid: U.Mire.uid, steps: 1, flying: false, path: [here, { c: 6, r: 4 }], facing: U.Mire.facing, turned: false, spin: 0 });
  check('a route that ends on a smaller unit is a Crush: it names what gives way, and the crusher lands on the Grid itself',
    [crush.crushes, crush.victims.units.map((u) => name0(u)), crush.victims.terrain.length, crush.last], [true, ['Raven'], 0, { col: 18, row: 12 }]);
  check('one that ends on a free Grid is not', [plain.victims, plain.crushes], [null, false]);
}
{
  // OBSTRUCT (LPA-20 Panzer): the lock's surcharge may be paid in Link.
  const { s, U, at } = stage();
  at(U['Wild Cat'], 6, 4, 3); at(U.Raven, 2, 2, 0);
  U['Wild Cat'].mech.pilot = 'LPA-20';
  const here = M.R.largeGridOf(U.Mire);
  const order = (to) => {
    const route = T.extendRoute(data, s, U.Mire, [here], to, 4, false, '534_A');
    return route ? T.moveOrder(data, s, U.Mire, { uid: U.Mire.uid, steps: 4, flying: false, path: route, actionId: '534_A', free: true, facing: 1, turned: false, spin: 0 }) : null;
  };
  check('a route its Range covers owes no Link', [order({ c: 5, r: 3 }).linkDue ?? null, 'breakAwayLink' in JSON.parse(JSON.stringify(order({ c: 5, r: 3 }).command))], [null, false]);
  check('one that only Link makes affordable says how much, and the command carries it', [order({ c: 5, r: 2 }).linkDue, order({ c: 5, r: 2 }).command.breakAwayLink], [2, 2]);
  check('and one past both is no route at all', order({ c: 5, r: 1 }), null);
}
{
  // Movement by an AERIAL unit owes Interception at its start and its landing (4.9).
  const { s, U } = stage();
  const hyena = { ...M.U.makeDroneToken(s, data, data.byId.get('078'), 's2'), col: 18, row: 18, facing: 0 };
  const fly = { ...M.U.makeDroneToken(s, data, data.byId.get('522'), 's1'), col: 15, row: 12, facing: 0 };
  s.tokens.push(hyena, fly);
  const start = { ...fly };
  fly.col = 18; fly.row = 15;
  const owed = T.interceptsAfterMove(data, s, start, fly.uid);
  check('an Aerial unit that moved within an Interceptor\'s Range is owed its attempts',
    [fly.aerial, owed.length > 0, owed.every((x) => x.uid === hyena.uid && x.targetUid === fly.uid)], [true, true, true]);
  check('a unit that is not Aerial owes none: no start was taken', T.interceptsAfterMove(data, s, null, U.Mire.uid), []);
  check('nor does one that is gone', T.interceptsAfterMove(data, s, start, 999), []);
  hyena.col = 33; hyena.row = 33;
  check('nor one out of every Interceptor\'s Range at both ends', T.interceptsAfterMove(data, s, start, fly.uid), []);
}

// ---------- the targets of an Electronic Attack ----------
{
  const { s, U, at, name } = stage();
  s.round.phase = 3; s.script.stage = '1:3';
  const rows = (rd) => rd.rows.map((r) => [name(r.t), r.d, r.far, r.skipped]);
  const fci = T.electronicReading(data, s, U.Raven.uid, '166_A');
  check('the Raven\'s Fire Control Interference: its reach, the pool it rolls, and each enemy with its Range and its own pool',
    [fci.reach, fci.ev, fci.evPrinted, fci.scan, fci.all, rows(fci), fci.rows.map((r) => r.theirs)], [4, 3, 3, false, null, [['Mire', 1, false, false], ['Dune', 10, true, false]], [2, 3]]);
  check('an enemy out of Range is listed, and says why it may not be picked',
    fci.rows.map((r) => r.why), ['', 'Dune is at Range 10, beyond this Action\'s Range 4.']);
  at(U.Dune, 6, 2, 2);
  check('an Automatic Action takes the NEAREST enemy in Range: the further one is refused (3.5.2)',
    [rows(T.electronicReading(data, s, U.Raven.uid, '166_A')), T.electronicReading(data, s, U.Raven.uid, '166_A').rows[1].why],
    [[['Mire', 1, false, false], ['Dune', 2, false, true]], 'An Automatic Action targets the NEAREST enemy in range (3.5.2).']);
  at(U.Dune, 6, 5, 2);
  check('and a tie is its controller\'s to break: both stay open', rows(T.electronicReading(data, s, U.Raven.uid, '166_A')), [['Mire', 1, false, false], ['Dune', 1, false, false]]);
  s.round.phase = 2; s.script.stage = '1:2';
  check('a Scan lists only what it could change: nobody, on a table with nothing hidden', T.electronicReading(data, s, U.Mire.uid, 'COMMON_SCAN').rows, []);
  U['Wild Cat'].statuses = ['camouflage'];
  const scan = T.electronicReading(data, s, U.Mire.uid, 'COMMON_SCAN');
  check('and the unit in Optical Camouflage, once there is one', [scan.scan, scan.reach, rows(scan)], [true, 6, [['Wild Cat', 3, false, false]]]);
  check('a unit or an Action that is gone gives no list', [T.electronicReading(data, s, 99, 'COMMON_SCAN'), T.electronicReading(data, s, U.Mire.uid, 'nope')], [null, null]);
  check('Range is counted in Large Grids, down and across', [T.gridsApart(U.Mire, U.Porcupine), T.gridsApart(U.Mire, U.Dune)], [4, 2]);
  check('the Counter-roll is opened by the attacker\'s own seat, on the target picked',
    T.electronicOpening(U.Raven, '166_A', U.Mire.uid), { kind: 'startCounterRoll', seat: 's2', uid: U.Raven.uid, actionId: '166_A', targetUid: U.Mire.uid });
  // An Action on every enemy in Range picks nobody.
  const scout = { ...M.U.makeDroneToken(s, data, data.byId.get('080'), 's1'), col: 21, row: 12, facing: 0 };
  s.tokens.push(scout);
  const all = T.electronicReading(data, s, scout.uid, '080_A');
  check('an Action on every enemy in Range lists its Responders and offers no pick',
    [all.all.map((t) => name(t)), all.rows], [['Wild Cat'], []]);
}

// ---------- the targets of an attack ----------
const row = (r) => [r.blocked ? 'refused' : r.bad ? 'warned' : 'clear', r.prot.white];
{
  const { s, U, open, name } = stage();
  open(U.Mire);
  const read = (id, extra = {}) => T.attackReading(data, s, { uid: U.Mire.uid, actionId: id, ...extra });
  const by = (rd) => Object.fromEntries(rd.rows.map((r) => [name(r.t), row(r)]));
  const shot = read('536_A');
  check('the Shotgun\'s Single Shot, Range 6: every enemy is listed with the reading of its line',
    by(shot), { 'Wild Cat': ['warned', 0], Porcupine: ['refused', 0], Raven: ['clear', 0], Tarantula: ['warned', 2] });
  check('out of the Forward Arc is a refusal, and says so', shot.rows.find((r) => name(r.t) === 'Porcupine').note, 'Range 4 · ✕ NOT in forward arc · LOS clear ✓');
  check('a Large unit in the line obstructs and pays the far target two White dice (4.5)',
    /obstructed/.test(shot.rows.find((r) => name(r.t) === 'Tarantula').note), true);
  check('the Burst Fire, Range 3: the Tarantula is out of Range', by(read('536_B')),
    { 'Wild Cat': ['warned', 0], Porcupine: ['refused', 0], Raven: ['clear', 0], Tarantula: ['refused', 2] });
  check('a Melee Action takes the Adjacent unit in its arc and nobody else', by(read('535_A')),
    { 'Wild Cat': ['refused', 0], Porcupine: ['refused', 0], Raven: ['clear', 0], Tarantula: ['refused', 0] });
  check('the reading names the unit, the Action as printed and as rolled, and its reach', [shot.by.uid, shot.raw.id, shot.action.id, shot.reach, shot.autoLegal, shot.shock], [U.Mire.uid, '536_A', '536_A', 6, null, false]);
  check('a target the rules have named is the only row (a Riposte, FAQ C1)', read('536_A', { only: U.Tarantula.uid }).rows.map((r) => name(r.t)), ['Tarantula']);
  check('a unit or an Action that is gone gives no reading', [T.attackReading(data, s, { uid: 99, actionId: '536_A' }), read('nope')], [null, null]);
  check('an ally is never a row', shot.rows.some((r) => r.t.side === 's1'), false);
  // HIGHLIGHT (6.2.1): a Firing Action able to take the Highlighted unit must.
  // The Porcupine in the Grid diagonally ahead: in reach of the gun and
  // Adjacent for the Cleaver, as the Raven is.
  U.Porcupine.statuses = ['highlight']; U.Porcupine.col = 6 * 3; U.Porcupine.row = 5 * 3;
  const lit = read('536_A');
  check('a Highlighted enemy in reach must be the target: every other row is refused',
    [lit.forced.map((x) => name(x)), by(lit)], [['Porcupine'], { 'Wild Cat': ['refused', 0], Porcupine: ['warned', 0], Raven: ['refused', 0], Tarantula: ['refused', 2] }]);
  check('a Melee Action is not bound by it (FAQ J18): both Adjacent units stay open',
    [read('535_A').forced.length, by(read('535_A')).Raven, by(read('535_A')).Porcupine], [0, ['clear', 0], ['clear', 0]]);
  // CAMOUFLAGE (4.12.2): the marker may be designated; the Scan comes first.
  U.Porcupine.statuses = [];
  U['Wild Cat'].statuses = [...U['Wild Cat'].statuses, 'camouflage'];
  const hid = read('536_A').rows.find((r) => name(r.t) === 'Wild Cat');
  check('a unit in Optical Camouflage is a row that may be pressed, marked as hidden', [hid.hidden, hid.blocked, hid.bad], [true, false, true]);
}
{
  // [Stationary] (the Dune's Railguns): two Grids further while it has not moved.
  const { s, U, at, open } = stage();
  at(U.Dune, 5, 8, 0); at(U['Wild Cat'], 5, 0, 2); at(U.Porcupine, 0, 11, 0); at(U.Mire, 11, 11, 0); at(U.Raven, 11, 9, 0);
  open(U.Dune);
  const far = (rd) => rd.rows.find((r) => r.t.label === 'Wild Cat').blocked;
  const still = T.attackReading(data, s, { uid: U.Dune.uid, actionId: '032_A' });
  check('a [Stationary] weapon reaches further while its Mech has not moved', [still.raw.range, still.action.range, still.reach, still.action === still.raw], [6, 8, 8, false]);
  check('so a target eight Grids off is in its Range', far(still), false);
  open(U.Dune, 'firing', { maneuver: 0, maneuvered: true, moved: true });
  const moved = T.attackReading(data, s, { uid: U.Dune.uid, actionId: '032_A' });
  check('and is the printed Action once it has, with that target out of it', [moved.action.range, moved.reach, moved.action === moved.raw, far(moved)], [6, 6, true, true]);
}
{
  // An Automatic Action takes the nearest legal target and no other.
  const { s, U, at, name } = stage();
  s.round.phase = 3; s.script.stage = '1:3';
  at(U.Mire, 5, 4, 2); at(U.Dune, 5, 2, 2);
  s.script.opp = M.TY.newOpportunity(U.Porcupine.uid, undefined);
  const auto = T.attackReading(data, s, { uid: U.Porcupine.uid, actionId: '543_A' });
  check('an Automatic Action lists the nearest legal target alone (3.5.2)', [auto.autoLegal.map((x) => name(x)), auto.rows.map((r) => [name(r.t), r.blocked])], [['Mire'], [['Mire', false]]]);
}
{
  // The same reading on the shipped map: walls block the line.
  const { s, U, open } = stage();
  s.map = 'alley';
  open(U.Mire);
  const walled = T.attackReading(data, s, { uid: U.Mire.uid, actionId: '536_A' }).rows.find((r) => r.t.label === 'Wild Cat');
  check('on the Alley, 3-inch terrain in the line refuses the shot', [walled.blocked, /LOS blocked/.test(walled.note)], [true, true]);
}

// ---------- where a Projectile may land ----------
{
  const { s, U, open } = stage();
  open(U.Mire, 'projectile');
  const missile = T.actionOf(data, s, U.Mire, '004_A');
  const land = T.landingGrids(data, s, U.Mire, missile);
  check('the Missile, Fire in arc at Range 3: every Grid within three, seen or not',
    [M.U.needsSightToLanding(missile), land.length, land.every((g) => Math.abs(g.c - 5) + Math.abs(g.r - 4) <= 3), land.every((g) => g.ok)], [false, 25, true, true]);
}

// ---------- launching a Projectile ----------
const droneAt = (s, id, side, c, r, extra = {}) => { const t = { ...M.U.makeDroneToken(s, data, data.byId.get(id), side), col: c * 3 + 1, row: c === undefined ? 0 : r * 3 + 1, facing: 0, ...extra }; s.tokens.push(t); return t; };
{
  const { s, U, open } = stage();
  const a = cardAction('004_A');
  open(U.Mire, 'projectile');
  const counts = () => [T.launchShots(data, s, U.Mire, a, '004_A'), T.launchLeft(data, s, U.Mire, a, '004_A')];
  check('a Volley 2 Action with Ammo to spare puts down two', counts(), [2, 2]);
  U.Mire.ammo['004_A'] = 1;
  check('the magazine caps it', counts(), [1, 1]);
  U.Mire.ammo['004_A'] = 0;
  check('and an empty one launches nothing', counts(), [0, 0]);
  U.Mire.ammo['004_A'] = 4;
  const down = droneAt(s, '071', 's1', 5, 2, { parentUid: U.Mire.uid });
  s.script.opp.launched = [{ actionId: '004_A', uids: [down.uid] }];
  check('a Volley under way has what it has not launched: one down, one left', T.launchLeft(data, s, U.Mire, a, '004_A'), 1);
  // A launch is counted whatever has become of its Unit: one that detonated
  // as it landed, or was shot down, was launched all the same. Only a
  // take-back frees its shot, and the engine strikes that launch off the
  // record itself (commands.ts `despawn`; mechanics2.test C12).
  s.script.opp.launched.push({ actionId: '004_A', uids: [999] });
  check('a launch whose Unit has since left the board was made all the same: with one standing and one gone, the Volley is spent', T.launchLeft(data, s, U.Mire, a, '004_A'), 0);
  s.script.opp.launched.pop();
  check('struck off the record (a take-back), it frees its shot', T.launchLeft(data, s, U.Mire, a, '004_A'), 1);
  s.script.opp.launched.push({ actionId: '004_A', uids: [U.Dune.uid] });
  check('two on the board is the whole Volley', T.launchLeft(data, s, U.Mire, a, '004_A'), 0);
  s.script.opp.launched = [{ actionId: 'other', uids: [down.uid] }];
  check('another Action\'s launches are not counted against it', T.launchLeft(data, s, U.Mire, a, '004_A'), 2);
  const missile = data.byId.get('071');
  check('a shot is the command that launches the card onto the Grid picked, facing as its launcher does',
    T.launchShot(data, s, U.Mire, '004_A', missile, { c: 5, r: 2 }, 'the Missile'),
    { ok: true, cmd: { kind: 'launch', seat: 's1', uid: U.Mire.uid, actionId: '004_A', cardId: '071', to: { col: 16, row: 7 }, facing: 1 } });
  check('an Aerial Projectile lands over a unit; a ground one takes the free part of the Grid beside it',
    [T.launchShot(data, s, U.Mire, 'x', missile, { c: 6, r: 4 }, 'm').cmd.to, T.launchShot(data, s, U.Mire, 'x', data.byId.get('072'), { c: 6, r: 4 }, 'b').cmd.to],
    [{ col: 19, row: 13 }, { col: 19, row: 14 }]);
  const line = data.byId.get('158');
  check('a 1x3 line stands across the facing it is given, its launcher\'s by default',
    [T.launchShot(data, s, U.Mire, 'x', line, { c: 5, r: 2 }, 'l').cmd, T.launchShot(data, s, U.Mire, 'x', line, { c: 5, r: 2 }, 'l', 0).cmd].map((c) => [c.to, c.facing]),
    [[{ col: 16, row: 6 }, 1], [{ col: 15, row: 7 }, 0]]);
  const walled = { ...s, map: 'alley' };
  check('a ground Projectile has no room in a Grid terrain fills, and says so; an Aerial one lands there',
    [T.launchShot(data, walled, U.Mire, 'x', data.byId.get('072'), { c: 6, r: 4 }, 'the Beacon'), T.launchShot(data, walled, U.Mire, 'x', missile, { c: 6, r: 4 }, 'm').ok],
    [{ ok: false, why: 'There is no room in that Grid for the Beacon. 4.7.2 needs the Projectile\'s base entirely inside the Landing Point.' }, true]);
  // Interception (4.9).
  const layer = { ...M.U.makeMechToken(s, data, { torso: '533', chasis: '534', leftHand: '535', rightHand: '536', backpack: '006', pilot: 'FPA-04-2' }, 's1', 'Layer'), col: 0, row: 30, facing: 0 };
  check('only a Launch triggers Interception: a Deploy does not (FAQ M20)',
    [T.launchTriggersInterception(data, U.Mire, '004_A'), T.launchTriggersInterception(data, layer, '006_B')], [true, false]);
  check('no unit of either squad holds an Intercept Token', [T.interceptorsAgainst(s, 's1'), T.interceptorsAgainst(s, 's2')], [false, false]);
  const hyena = droneAt(s, '078', 's2', 6, 2);
  check('one that does is a reason to work an Interception out, for the other squad\'s launches alone',
    [T.interceptorsAgainst(s, 's1'), T.interceptorsAgainst(s, 's2')], [true, false]);
  hyena.intercept['078_A'] = 0;
  check('one whose Tokens are spent is not', T.interceptorsAgainst(s, 's1'), false);
  hyena.intercept['078_A'] = 1;
  check('a launch in its Range owes it an attempt at the Projectile',
    T.interceptsAfterLaunch(data, s, U.Mire, [down]), [{ uid: hyena.uid, actionId: '078_A', targetUid: down.uid }]);
  check('a unit this launcher did not place owes none, and neither does a table with no game on',
    [T.interceptsAfterLaunch(data, s, U.Dune, [down]), T.interceptsAfterLaunch(data, { ...s, script: undefined }, U.Mire, [down])], [[], []]);
}

// ---------- Detonation ----------
{
  const { s, U, name } = stage();
  s.round.phase = 4; s.script.stage = '1:4';
  const m = droneAt(s, '071', 's1', 5, 2, { parentUid: U.Mire.uid });
  const hyena = droneAt(s, '078', 's2', 6, 2);
  const a = cardAction('071_A');
  check('who a blast reaches: every unit in Range of it, nearest first, itself left out',
    T.unitsWithin(s, m, 2).map((x) => [name0(x.t) === x.t.label ? x.t.label.slice(0, 8) : name0(x.t), x.dist]), [['DTG-30M ', 1], ['Mire', 2]]);
  const rd = T.detonationReading(data, s, m.uid, '071_A');
  check('the Missile\'s Guided Attack: an Explosion on one unit within three Grids',
    [rd.range, rd.damaging, rd.scope, rd.stays, rd.terrain.length], [3, true, 'single', false, 0]);
  check('the card names an ENEMY: an ally in Range is barred, and says why',
    [rd.targets.map((x) => [x.dist, rd.barOf(x.t)]), rd.legal.map((x) => x.t.uid)], [[[1, ''], [2, 'ally'], [3, '']], [hyena.uid, U.Raven.uid]]);
  check('a Projectile that is gone gives no reading', T.detonationReading(data, s, 9999, '071_A'), null);
  check('a Missile flies into its target\'s Grid first, and the flight owes Interception at either end',
    T.detonationFlight(data, s, m, a, U.Raven),
    { fly: { kind: 'flyToTarget', seat: 's1', uid: m.uid, actionId: '071_A', targetUid: U.Raven.uid }, owed: [{ uid: hyena.uid, actionId: '078_A', targetUid: m.uid }] });
  hyena.col = 33; hyena.row = 33;
  check('with no Interceptor in Range of either end it owes none', T.detonationFlight(data, s, m, a, U.Raven).owed, []);
  check('it does not jump', T.detonationJump(m, a, U.Raven), null);
  const grenade = droneAt(s, '154', 's1', 5, 5, { parentUid: U.Mire.uid });
  const blast = T.detonationReading(data, s, grenade.uid, '154_A');
  check('a Grenade is a blast on every unit in its own Grid, and flies nowhere',
    [blast.range, blast.scope, blast.damaging, T.detonationFlight(data, s, grenade, cardAction('154_A'), U.Raven)], [0, 'all', true, null]);
  const pk3 = droneAt(s, 'ZHAM-003', 's1', 0, 11, { parentUid: U.Mire.uid });
  check('a PK3 with nothing in Range stays for a later Delay Phase, unless it has already taken a Container',
    [T.detonationReading(data, s, pk3.uid, 'ZHAM-003_A').stays, T.detonationReading(data, s, pk3.uid, 'ZHAM-003_A', { terrainHit: true }).stays, rd.stays], [true, false, false]);
  const lone = droneAt(s, '071', 's1', 0, 9, { parentUid: U.Mire.uid });
  const none = T.detonationReading(data, s, lone.uid, '071_A');
  check('a Missile with nothing in Range does not stay: its card keeps nothing', [none.legal.length, none.stays], [0, false]);
  const spider = droneAt(s, '167', 's1', 7, 7, { parentUid: U.Mire.uid });
  const leap = data.byId.get('167').actions.find((x) => M.U.jumpsToTarget(x));
  check('an Unfolded Pholcus jumps into its target\'s Grid, once',
    [T.detonationJump(spider, leap, U['Wild Cat']), T.detonationJump({ ...spider, jumpBlast: true }, leap, U['Wild Cat'])],
    [{ kind: 'flyToTarget', seat: 's1', uid: spider.uid, actionId: leap.id, targetUid: U['Wild Cat'].uid }, null]);
  const walled = { ...s, map: 'alley' };
  check('the Containers in Range are named, nearest first, and nothing that is not Destructible',
    T.fragileTerrainWithin(data, walled, { ...m, col: 16, row: 16 }, 3).map((x) => [x.piece.type, x.dist]), [['container', 2], ['container', 3], ['container', 3], ['container', 3]]);
}

// ---------- a Charge, and Stabilize System ----------
{
  const { s, U, open } = stage();
  const o = open(U['Wild Cat'], 'firing', { started: true });
  const rows = T.actionRows(data, s, U['Wild Cat'], o);
  check('a row says whether its Action carries the Charge Icon, and whether the token is up',
    rows.filter((r) => r.charge).map((r) => [r.key, r.slot, r.charge.charged]), [['540_B', 'leftHand', false]]);
  U['Wild Cat'].charge = ['leftHand'];
  check('up, once the Part is Charged', T.actionRows(data, s, U['Wild Cat'], o).find((r) => r.key === '540_B').charge, { charged: true });
  check('and a Projectile Action says what it launches',
    T.actionRows(data, s, U.Mire, { ...M.TY.newOpportunity(U.Mire.uid, 'firing'), started: true }).filter((r) => r.projectiles?.length).map((r) => [r.key, r.projectiles.map((c) => c.id)]), [['004_A', ['071']]]);
  const pay = { kind: 'performAction', seat: 's2', uid: 3, actionId: 'COMMON_CHARGE', partKey: 'COMMON_CHARGE' };
  check('the shared Charge Action is paid under the Part it Charges', T.chargePayment(pay, 'leftHand'), { ...pay, partKey: 'COMMON_CHARGE@leftHand' });
  const own = { kind: 'performAction', seat: 's2', uid: 4, actionId: '543_B', partKey: '543_B' };
  check('a Drone\'s own Charge is paid as it stands', T.chargePayment(own, 'main') === own, true);
  check('Stabilize System keeps every Token and takes the Link alone',
    T.stabiliseCommand(U.Mire, null), { kind: 'stabilise', seat: 's1', uid: U.Mire.uid, keepTokens: true });
  check('or takes one Token off, by its face where it has one',
    [T.stabiliseCommand(U.Mire, { id: 'fragile:yellow', statusId: 'fragile', face: 'yellow', label: 'Fragile, yellow', n: 1, shape: 'square' }),
      T.stabiliseCommand(U.Mire, { id: 'fci', statusId: 'fci', label: 'x', n: 1, shape: 'square' })],
    [{ kind: 'stabilise', seat: 's1', uid: U.Mire.uid, statusId: 'fragile', face: 'yellow' }, { kind: 'stabilise', seat: 's1', uid: U.Mire.uid, statusId: 'fci' }]);
}

// ---------- the Action a unit and an id name ----------
{
  const { s, U } = stage();
  check('a Part\'s own Action, a Common one, and none for an id nothing prints',
    [T.actionOf(data, s, U.Mire, '536_A')?.id, T.actionOf(data, s, U.Mire, 'COMMON_SCAN')?.id, T.actionOf(data, s, U.Mire, '541_A') ?? null],
    ['536_A', 'COMMON_SCAN', null]);
  check('a part key names the same Action as its id', T.actionOf(data, s, U.Mire, 'COMMON_PUNCH_MELEE@chasis')?.id, 'COMMON_PUNCH_MELEE');
}

// ---------- what performing an Action opens ----------
{
  const { U } = stage();
  const act = (id) => data.cards.flatMap((c) => c.actions ?? []).find((a) => a.id === id) ?? data.commonActions.find((a) => a.id === id);
  check('the copied squads\' Actions: a route, a target list, a Landing Point, a Counter-roll, a Part to Charge',
    ['534_A', '535_A', '536_A', '004_A', '032_A', '099_A', '540_A', '543_A', '543_B', '166_A'].map((id) => T.actionRoute(data, U.Mire, act(id))),
    ['move', 'attack', 'attack', 'launch', 'attack', 'move', 'attack', 'attack', 'charge', 'electronic']);
  check('the Common Actions',
    Object.fromEntries(data.commonActions.filter((a) => a.type !== 'Passive').map((a) => [a.id, T.actionRoute(data, U.Mire, a)])),
    { COMMON_CHARGE: 'charge', COMMON_DISCARD: 'discard', COMMON_PUNCH_MELEE: 'attack', COMMON_CRAWL: 'move', COMMON_REVEAL: 'card',
      COMMON_STABILIZE: 'stabilise', COMMON_REMOTE_ACCESS: 'terminal', COMMON_SCAN: 'electronic' });
  // The order is part of the rule. Each of these answers to a later reading
  // too, and must take the earlier one.
  const all = data.cards.flatMap((c) => (c.actions ?? []).map((a) => ({ c, a }))).filter(({ a }) => a.type !== 'Passive' && a.speed !== 'passive');
  const unit = (c) => ({ kind: c.category === 'projectile' ? 'projectile' : c.category === 'drone' ? 'drone' : 'mech', cardId: c.id, mech: {}, statuses: [], partStates: {} });
  const routed = all.map(({ c, a }) => ({ c, a, route: T.actionRoute(data, unit(c), a) }));
  check('an Electronic Attack is a Counter-roll whatever its printed type (the Raven\'s is typed Tactic)',
    routed.filter((x) => M.U.isElectronicAttack(x.a)).every((x) => x.route === 'electronic'), true);
  check('a Projectile\'s Link support is not a Detonation',
    routed.filter((x) => x.c.category === 'projectile' && M.U.linkSupportOf(x.a)).map((x) => x.route).every((r) => r === 'link'), true);
  check('a position swap is not a route to draw, though it is typed Moving',
    routed.filter((x) => M.U.isPositionSwap(x.a)).map((x) => [x.a.type, x.route]), [['Moving', 'blink']]);
  check('every other Projectile Action that is not Passive is its Detonation',
    routed.filter((x) => x.c.category === 'projectile' && x.route === 'detonate').length > 10, true);
  const KINDS = ['terminal', 'discard', 'stabilise', 'overwatch', 'charge', 'resupply', 'link', 'stanceFeedback', 'cleanup', 'repair', 'form', 'camo',
    'electronic', 'attack', 'blink', 'move', 'launch', 'transform', 'unfold', 'detonate', 'selfStatus', 'targetStatus', 'card'];
  check('and every Action in the data takes one of the routes', [...new Set(routed.map((x) => x.route))].filter((r) => !KINDS.includes(r)), []);
}

// ---------- the Match Centre draws from it ----------
{
  const src = (f) => readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const hud = src('matchhud.ts'), turn = src('turn.ts');
  check('the turn panel\'s rows, its Maneuver row and its target list are turn.ts\'s readings',
    [/const rows = turn\.actionRows\(ctx\.data, ctx\.state, t, o\)/.test(hud), /const man = turn\.maneuverVerdict\(ctx\.state, t, o\);/.test(hud),
      /const read = turn\.attackReading\(ctx\.data, ctx\.state, m\);/.test(hud)], [true, true, true]);
  check('and so are its reach, its route rules, its Landing Points, its terrain and the Action a key names',
    [/return turn\.reachableFor\(ctx\.data, ctx\.state, t, steps, asFlight, actionId\);/.test(hud), /return turn\.moveOptsFor\(ctx\.data, ctx\.state, t, flying, actionId\);/.test(hud),
      /return turn\.landingGrids\(ctx\.data, ctx\.state, t, a\);/.test(hud), /return turn\.terrainOf\(ctx\.data, ctx\.state\);/.test(hud),
      /return turn\.actionOf\(ctx\.data, ctx\.state, t, actionId\);/.test(hud), /return turn\.handsFor\(ctx\.data, ctx\.state, by, granted, choice\);/.test(hud)],
    [true, true, true, true, true, true]);
  // Twenty-three routes: the page has a branch for each but `card`, which is
  // what is left when none of them took the Action.
  const branches = [...hud.matchAll(/if \(route === '(\w+)'\) \{|= route === '(\w+)' \? /g)].map((m) => m[1] ?? m[2]).sort();
  const routes = [...turn.matchAll(/return '(\w+)';/g)].map((m) => m[1]).sort();
  check('what an Action opens is classified once, and the page branches on every answer',
    [/const route = turn\.actionRoute\(ctx\.data, t, a\);/.test(hud), branches.length, branches, routes.length],
    [true, 22, routes.filter((r) => r !== 'card'), 23]);
  check('the page keeps no second copy of the row verdicts or the target readings',
    [/canPerform\(o, priced/.test(hud), /const forced = a\.type === 'Firing'/.test(hud), /function mapPieces\(/.test(hud), /breakAwayCost\(ctx\.data/.test(hud)], [false, false, false, false]);
  // No page, no state, no command: nothing a reader of the rules could not run.
  const imports = [...turn.matchAll(/from '\.\/(\w+)'/g)].map((m) => m[1]).sort();
  check('turn.ts imports the rules and nothing with a page in it',
    imports, ['commands', 'data', 'data', 'glue', 'loop', 'melee', 'rules', 'scoring', 'setup', 'tasks', 'ticks', 'types', 'types', 'units']);
  check('where a squad deploys and how a unit lands facing are its readings too',
    [/export const deployCellsFor = turn\.deployCellsFor;/.test(hud), /export const deployFacing = turn\.deployFacing;/.test(hud), /function zoneCentre\(/.test(hud)], [true, true, false]);
  check('and touches no document, no window and sends no command',
    [/\bdocument\./.test(turn), /\bwindow\./.test(turn), /\bperform\(|\.send\(|\bapply\(|applyRemote\(/.test(turn), /^let /m.test(turn)], [false, false, false, false]);
  check('of the command layer it takes only the engine\'s verdict and its readings of a magazine and of the Interceptions that can still be made',
    /import \{ ammoAvailable, check, liveIntercepts, type CheckResult, type Command \} from '\.\/commands';/.test(turn), true);
  // A Movement's two ends, and the Counter-roll's target list (2026-10-01).
  check('the planner opens through moveStart and says its refusal',
    /const start = turn\.moveStart\(ctx\.data, ctx\.state, t, opts\);\s*\n\s*if \(!start\.ok\) \{\s*\n\s*ctx\.noteNow\(start\.why\);\s*\n\s*return;/.test(hud), true);
  check('every leg of its route is extendRoute\'s, the cursor\'s and a dropped token\'s alike',
    (hud.match(/turn\.extendRoute\(ctx\.data, ctx\.state, t, m\.path, (?:\{ c, r \}|goal), m\.steps, m\.flying, m\.actionId\)/g) ?? []).length, 2);
  check('its Confirm asks moveOrder what the plan comes to, and sends the command it was handed, turn and walk alike',
    [/const order = turn\.moveOrder\(ctx\.data, ctx\.state, t, m\);/.test(hud), (hud.match(/ctx\.send\(order\.command!?\)/g) ?? []).length], [true, 4]);
  check('an Aerial unit\'s Interception is asked once the move has landed, on both of its roads',
    (hud.match(/const owed = turn\.interceptsAfterMove\(ctx\.data, ctx\.state, aerialStart, t\.uid\);/g) ?? []).length, 2);
  check('a Movement Action opens the planner by actionMove', /startMovePlan\(ctx, t, \{[\s\S]{0,300}?\.\.\.turn\.actionMove\(a\),/.test(hud), true);
  check('the page keeps no second copy of a Movement\'s opening or of what a route comes to',
    [/flightGrant\(/.test(hud), /nonHumanoidStop\(/.test(hud), /breakAwayLinkDue\(/.test(hud), /mineStopIndex\(ctx\.data, ctx\.state\.tokens, t, m\.path/.test(hud),
      /kind: 'maneuver', seat: t\.side, uid: t\.uid, to: last/.test(hud), /extendPath\(/.test(hud)], [false, false, false, false, false, false]);
  check('the Electronic picker draws electronicReading\'s list, and its press opens the Counter-roll by electronicOpening',
    [/const read = turn\.electronicReading\(ctx\.data, s, m\.uid, m\.actionId\);/.test(hud), /const open = turn\.electronicOpening\(by, m\.actionId, Number\(el\.dataset\.ewtarget\)\);/.test(hud),
      /electronicOrigins\(/.test(hud), /return turn\.gridsApart\(a, b\);/.test(hud)], [true, true, false, true]);
  // A launch, a Detonation, a Charge and Stabilize System (2026-10-01).
  check('the launch plan counts its shots by launchShots, and each one is launchShot\'s command',
    [/const shots = turn\.launchShots\(ctx\.data, ctx\.state, t, a, actionId\);/.test(hud),
      /const placed = turn\.launchShot\(ctx\.data, ctx\.state, t, m\.actionId, card, \{ c, r \}, m\.label, m\.facing\);\s*\n\s*if \(!placed\.ok\) \{\s*\n\s*ctx\.noteNow\(placed\.why\);/.test(hud),
      /const shot: Command = placed\.cmd;/.test(hud)], [true, true, true]);
  check('what a finished launch owes is interceptsAfterLaunch\'s, for a Launch alone',
    [/const owed = turn\.interceptsAfterLaunch\(ctx\.data, ctx\.state, launcher, born\);/.test(hud),
      /if \(owner && born\.length && turn\.launchTriggersInterception\(ctx\.data, owner, m\.actionId\)\) queueInterceptsFor\(ctx, owner, born\);/.test(hud)], [true, true]);
  check('the Detonation panel draws detonationReading, and its press flies and jumps by turn.ts\'s commands',
    [/const read = turn\.detonationReading\(ctx\.data, s, detonateNow!\.uid, detonateNow!\.actionId, detonateNow!\);/.test(hud),
      /const flight = detonateNow\.flew !== target\.uid \? turn\.detonationFlight\(ctx\.data, s, proj, a, target\) : null;/.test(hud),
      /const jump = turn\.detonationJump\(proj, a, target\);/.test(hud)], [true, true, true]);
  check('a Charge is paid, and Stabilize System answered, by the commands turn.ts builds',
    [(hud.match(/turn\.chargePayment\(/g) ?? []).length, (hud.match(/turn\.stabiliseCommand\(/g) ?? []).length], [2, 2]);
  check('and the page keeps no second copy of any of them',
    [/kind: 'launch', seat: t\.side/.test(hud), /kind: 'flyToTarget'/.test(hud), /kind: 'stabilise'/.test(hud), /detonationBar\(s\.tokens, proj, a, pool/.test(hud), /volleyFor\(/.test(hud), /partKey: `COMMON_CHARGE@/.test(hud)],
    [false, false, false, false, false, false]);
  // A Crush of Destructible Terrain, and the road (2026-10-01).
  check('a Crush is sent by the three pieces turn.ts builds: the terrain destroyed, the landing, the Movement\'s record',
    [/if \(ctx\.send\(turn\.crushDestroy\(by, m\.terrain\)\)\.ok\) ctx\.noteNow\(/.test(hud), /: turn\.crushLanding\(ctx\.data, ctx\.state, t, m\.goal\);/.test(hud),
      /: ctx\.send\(turn\.crushRecord\(t, m, to, via, from\)\)\.ok\);/.test(hud), /kind: 'destroyTerrain', \.\.\.by/.test(hud)], [true, true, true, false]);
  check('snapPlacement is geometry: it lives beside standingSpot, and the board re-exports it',
    [/export function snapPlacement\(/.test(src('rules.ts')), /export \{ snapPlacement \} from '\.\/rules';/.test(src('board.ts')), /export function snapPlacement\(/.test(src('board.ts'))], [true, true, false]);
}

// ---------- the road, and a Crush of Destructible Terrain (the alley map) ----------
{
  const s = JSON.parse(JSON.stringify(base.state));
  const U = Object.fromEntries(s.tokens.map((t) => [name0(t), t]));
  const at = (t, c, r, f = 0) => { t.col = c * 3; t.row = r * 3; t.facing = f; };
  // The Wild Cat in its corner of the alley, a Container in the Grid ahead.
  at(U.Mire, 3, 2, 2); at(U.Dune, 4, 2, 2); at(U['Wild Cat'], 7, 9); at(U.Porcupine, 11, 11); at(U.Raven, 10, 11); at(U.Tarantula, 9, 11);
  const cat = U['Wild Cat'];
  const fragile = (c, r) => T.terrainOf(data, s).filter((p) => p.isFragile && p.subCells.some((x) => Math.floor(x.col / 3) === c && Math.floor(x.row / 3) === r));
  const here = { c: 7, r: 9 };
  const steps = (road) => road.every((g, i) => i === 0 || Math.abs(g.c - road[i - 1].c) + Math.abs(g.r - road[i - 1].r) === 1);
  const goal = { c: 4, r: 3 };
  const road = T.roadTo(data, s, cat, goal, false);
  check('a Large Unit\'s road to a Grid is a walk, a Grid at a time, from where it stands to there',
    [!!road, `${road[0].c},${road[0].r}`, `${road.at(-1).c},${road.at(-1).r}`, steps(road)], [true, '7,9', '4,3', true]);
  check('and runs through Destructible Terrain, which its own Movement cannot pass: the planner finds no route there at any Range',
    [road.some((g) => fragile(g.c, g.r).length > 0), T.extendRoute(data, s, cat, [here], goal, 48, false)], [true, null]);
  check('a unit that cannot Crush reads the board as it stands: its road is the planner\'s route, or there is none',
    [JSON.stringify(T.roadTo(data, s, { ...U.Porcupine, col: 21, row: 27 }, goal, false)) === JSON.stringify(T.extendRoute(data, s, { ...U.Porcupine, col: 21, row: 27 }, [here], goal, 48, false)),
      JSON.stringify(T.roadTo(data, s, { ...cat, statuses: ['camouflage'] }, goal, false)) === JSON.stringify(T.extendRoute(data, s, { ...cat, statuses: ['camouflage'] }, [here], goal, 48, false))],
    [true, true]);
  check('a Grid nothing leads to has no road', T.roadTo(data, s, cat, { c: 3, r: 2 }, false), null);
  // The roads to many Grids at once are read off ONE search of the board, and
  // each is the road asked for alone: every Grid of the board, for a unit of
  // each kind, walked and flown, on both copied maps.
  {
    const every = [];
    for (let c = 0; c < 12; c++) for (let r = 0; r < 12; r++) every.push({ c, r });
    const differ = [];
    let roads = 0;
    for (const map of ['alley', 'crossroads']) {
      const board = { ...s, map };
      for (const [label, t, flying] of [['Wild Cat', cat, false], ['Mire', U.Mire, false], ['Porcupine', U.Porcupine, false], ['Raven', U.Raven, true],
        ['a camouflaged Mech', { ...cat, statuses: ['camouflage'] }, false], ['a Mech in another Grid', { ...U.Dune, col: 15, row: 18 }, false]]) {
        const all = T.roadsToAll(data, board, t, every, flying);
        every.forEach((g, i) => {
          const one = T.roadTo(data, board, t, g, flying);
          if (one) roads += 1;
          if (JSON.stringify(one) !== JSON.stringify(all[i])) differ.push(`${map} ${label} to ${g.c},${g.r}`);
        });
      }
    }
    check('the roads to several Grids, read off one search, are each the road to that Grid asked for alone (1,728 roads asked both ways)',
      [differ, roads > 1000, T.roadsToAll(data, s, cat, [], false)], [[], true, []]);
    check('and a road to the Grid a unit stands in is no road, asked either way',
      [T.roadTo(data, s, cat, here, false), T.roadsToAll(data, s, cat, [here, goal], false).map((x) => x?.length ?? null)], [null, [null, road.length]]);
    // The same for the first leg of a Movement: every Grid, at each Range a
    // Movement of these squads has (a Maneuver of 1 and of 2, a Mobility
    // Stance's 4, a Sprint's 4, a Drone's 5, 6 and 9), walked and flown, and a
    // Movement Action by name (a Sprint; a Crawl, which may not leave a Grid
    // it is locked in).
    const odd = [];
    let legs = 0;
    for (const map of ['alley', 'crossroads']) {
      const board = { ...s, map };
      for (const [label, t, flying, actionId] of [['Wild Cat', cat, false], ['Mire', U.Mire, false], ['Mire, Sprint', U.Mire, false, '534_A'], ['Mire, Crawl', U.Mire, false, 'COMMON_CRAWL'],
        ['Porcupine', U.Porcupine, false], ['Raven', U.Raven, true], ['Tarantula', U.Tarantula, false], ['a camouflaged Mech', { ...cat, statuses: ['camouflage'] }, false]]) {
        const from = { c: Math.floor(t.col / 3), r: Math.floor(t.row / 3) };
        for (const range of [0, 1, 2, 4, 5, 6, 9]) {
          const all = T.extendRoutes(data, board, t, from, every, range, flying, actionId);
          every.forEach((g, i) => {
            const one = T.extendRoute(data, board, t, [from], g, range, flying, actionId);
            if (one) legs += 1;
            if (JSON.stringify(one) !== JSON.stringify(all[i])) odd.push(`${map} ${label} range ${range} to ${g.c},${g.r}`);
          });
        }
      }
    }
    check('the first leg of a Movement to several Grids, read off one search, is the planner\'s own leg to each (16,128 asked both ways)',
      [odd.slice(0, 5), legs > 2000], [[], true]);
  }
  // LINES WALKED ONCE, while a seat is thinking (rules.ts thinking). Every
  // line of sight between two units, both ways, on both maps, with the units
  // moved about between askings: inside one thought each is the line walked
  // afresh, and so is a line asked a second time.
  {
    const R = M.R;
    const wrong = [];
    let asked = 0;
    for (const map of ['alley', 'crossroads']) {
      const board = JSON.parse(JSON.stringify({ ...s, map }));
      const land = T.terrainOf(data, board);
      const smoke = [{ col: 5, row: 5, side: 's1' }];
      R.thinking(() => {
        for (let turn = 0; turn < 12; turn++) {
          // Each unit somewhere new, by a rule of thumb that spreads them over the board.
          board.tokens.forEach((t, i) => { t.col = ((turn * 7 + i * 5) % 12) * 3; t.row = ((turn * 5 + i * 11) % 12) * 3; t.facing = (turn + i) % 4; });
          for (const a of board.tokens) for (const b of board.tokens) {
            if (a === b) continue;
            for (const pass of [0, 1]) {
              asked += 1;
              const kept = [R.losBetween(a, b, land, board.tokens), R.firingSight(a, b, land, board.tokens, smoke), R.firingSight(a, b, land, board.tokens, [])];
              const fresh = [R.losBetweenNow(a, b, land, board.tokens), R.firingSightNow(a, b, land, board.tokens, smoke), R.firingSightNow(a, b, land, board.tokens, [])];
              if (JSON.stringify(kept) !== JSON.stringify(fresh)) wrong.push(`${map} turn ${turn} ${a.label} to ${b.label} pass ${pass}`);
            }
          }
        }
      });
    }
    check('a line of sight kept while a seat is thinking is the line walked afresh: every pair of units, both ways, asked twice, the units moved between askings, with and without smoke',
      [wrong.slice(0, 5), asked], [[], 2 * 12 * 6 * 5 * 2]);
    // What it keeps, it keeps only while the thought lasts.
    const land = T.terrainOf(data, s);
    const a = s.tokens[0];
    const b = s.tokens[2];
    let walks = 0;
    const counted = () => { walks += 1; return R.losBetween(a, b, land, s.tokens); };
    const before = R.walked();
    R.thinking(() => { counted(); counted(); R.thinking(() => counted()); });
    const inside = R.walked() - before;
    counted(); counted();
    check('inside one thought a line asked three times is walked once, a thought inside a thought shares it, and outside any thought every asking is a walk',
      [walks, inside, R.walked() - before - inside], [5, 1, 2]);
    check('a thought that throws leaves nothing kept behind it',
      [(() => { try { R.thinking(() => { throw new Error('x'); }); } catch { /* the point */ } const n = R.walked(); counted(); counted(); return R.walked() - n; })()], [2]);
  }
  // THE WALK ITSELF, held to a second reckoning of the lines. A line of sight
  // is the engine's (4.2.4): 81 lines from base to base. The walk was made
  // cheaper (2026-10-03: the two bases read once in place of once a sample),
  // and a reader that asks only "is there a line at all" is stopped at the
  // first (rules.ts sightBetween: where a Projectile may land is asked of every
  // Grid in Range, at every look a computer seat takes ahead). It was held then
  // to the walk as it stood, word for word; since each line is walked cell by
  // cell (2026-10-08, losexact.test.mjs) it is held to the lines reckoned a
  // second way (_sightref.mjs): every pair of units on every battlefield, a
  // wall and an Aerial unit among them, moved about; and every Grid a unit
  // could be asked the sight of.
  {
    const R = M.R;
    const TY = M.TY;
    const reference = (a, b, terrain, tokens, smokeGrids) => reckonLines(M, a, b, terrain, tokens, smokeGrids);
    const fired = (a, b, terrain, tokens, smoke) => {
      if (!smoke.length) return reference(a, b, terrain, tokens, null);
      const grids2 = new Set(smoke.map((x) => `${x.col},${x.row}`));
      const inSmoke = (t) => TY.baseCells(t).some((c) => grids2.has(`${Math.floor(c.col / 3)},${Math.floor(c.row / 3)}`));
      return inSmoke(a) || inSmoke(b) ? 'smoked' : reference(a, b, terrain, tokens, grids2);
    };
    const wrong = [];
    const seen = { clear: 0, obstructed: 0, blocked: 0, smoked: 0 };
    let asked = 0;
    let probes = 0;
    let dark = 0;
    const TURNS = 5;
    for (const map of data.terrain.maps.map((m) => m.id)) {
      const board = JSON.parse(JSON.stringify({ ...s, map }));
      // A wall three inches high (it blocks a line as terrain does), a 1x3 line
      // across its facing, and a unit on an Aerial base beside the six.
      const wall = { ...M.U.makeDroneToken(board, data, data.byId.get('PDAM-003'), 's2') };
      board.tokens.push(wall);
      const flier = { ...M.U.makeDroneToken(board, data, data.byId.get('LHDR-KK9'), 's1') };
      board.tokens.push(flier);
      const land = T.terrainOf(data, board);
      const smoke = [{ col: 5, row: 5, side: 's1' }, { col: 6, row: 5, side: 's2' }, { col: 2, row: 8, side: 's1' }];
      for (let turn = 0; turn < TURNS; turn++) {
        board.tokens.forEach((t, i) => { t.col = ((turn * 7 + i * 5) % 12) * 3; t.row = ((turn * 5 + i * 11) % 12) * 3; t.facing = (turn + i) % 4; });
        const ask = () => {
          for (const a of board.tokens) for (const b of board.tokens) {
            if (a === b) continue;
            asked += 1;
            const was = [reference(a, b, land, board.tokens, null), fired(a, b, land, board.tokens, smoke), fired(a, b, land, board.tokens, [])];
            const is = [R.losBetween(a, b, land, board.tokens), R.firingSight(a, b, land, board.tokens, smoke), R.firingSight(a, b, land, board.tokens, [])];
            seen[was[0]] += 1; seen[was[1]] += 1;
            if (JSON.stringify(was) !== JSON.stringify(is)) wrong.push(`${map} turn ${turn} ${a.label} to ${b.label}: ${was} now ${is}`);
            if (R.sightBetween(a, b, land, board.tokens) !== (was[0] !== 'blocked')) wrong.push(`${map} turn ${turn} sight ${a.label} to ${b.label}`);
          }
        };
        ask();
        R.thinking(() => { ask(); ask(); });
        // The Grids a launcher asks the sight of (turn.ts landingGrids): a unit
        // one cell wide in the middle of each, which is the unit's own probe.
        for (const t of [board.tokens[0], board.tokens[3]]) {
          for (const think of [false, true]) {
            const run = () => {
              for (let c = 0; c < 12; c++) for (let r = 0; r < 12; r++) {
                const probe = { ...t, col: c * 3 + 1, row: r * 3 + 1, size: 1 };
                probes += 1;
                const was = reference(t, probe, land, board.tokens, null) !== 'blocked';
                if (!was) dark += 1;
                if (R.sightBetween(t, probe, land, board.tokens) !== was) wrong.push(`${map} turn ${turn} ${t.label} to Grid ${c},${r}${think ? ' (thinking)' : ''}`);
              }
            };
            if (think) R.thinking(run); else run();
          }
        }
      }
    }
    check('THE WALK IS THE LINES RECKONED: every line of sight between two units on every battlefield, a wall and an Aerial unit among them, with smoke and without, kept and afresh, is what the second reckoning answers; and "is there a line at all" is that answer asked only whether it is blocked',
      [wrong.slice(0, 5), asked, Object.values(seen).every((n) => n > 50)], [[], data.terrain.maps.length * TURNS * 3 * 8 * 7, true]);
    check('and so is the sight of every Grid from where a launcher stands, in a thought and out of one (some of them dark, or it would prove nothing)',
      [probes, dark > 500, dark < probes / 2], [data.terrain.maps.length * TURNS * 2 * 2 * 144, true, true]);
    // The two readings do not answer for one another inside a thought.
    const board = JSON.parse(JSON.stringify({ ...s, map: 'alley' }));
    const land = T.terrainOf(data, board);
    const pairs = [];
    for (const a of board.tokens) for (const b of board.tokens) if (a !== b && reference(a, b, land, board.tokens, null) === 'obstructed') pairs.push([a, b]);
    const [a, b] = pairs[0] ?? [];
    check('a line asked only for its sight is not handed back as the line itself: obstructed stays obstructed, asked before and after, in one thought',
      [pairs.length > 0, a && R.thinking(() => [R.losBetween(a, b, land, board.tokens), R.sightBetween(a, b, land, board.tokens), R.losBetween(a, b, land, board.tokens), R.sightBetween(a, b, land, board.tokens)])],
      [true, ['obstructed', true, 'obstructed', true]]);
    // With nobody else on the board there is nothing but the reading itself
    // to tell the two apart by: each still answers for itself.
    const lone = { ...board.tokens[0], col: 15, row: 15, facing: 0 };
    let other = null;
    for (let c = 0; c < 12 && !other; c++) for (let r = 0; r < 12 && !other; r++) {
      const there = { ...board.tokens[1], col: c * 3, row: r * 3, facing: 0 };
      if ((c !== 5 || r !== 5) && reference(lone, there, land, [lone, there], null) === 'obstructed') other = there;
    }
    const two = [lone, other];
    check('and with only the two of them on the board each reading still answers for itself, whichever is asked first',
      [!!other, other && R.thinking(() => [R.sightBetween(lone, other, land, two), R.losBetween(lone, other, land, two)]), other && R.thinking(() => [R.losBetween(lone, other, land, two), R.sightBetween(lone, other, land, two)])],
      [true, [true, 'obstructed'], ['obstructed', true]]);
    // And each is kept by the terrain it was asked of: a wall destroyed in the
    // middle of a thought (a look ahead that crushes a Container) is gone.
    let hid = null;
    for (let c = 0; c < 12 && !hid; c++) for (let r = 0; r < 12 && !hid; r++) {
      const there = { ...board.tokens[1], col: c * 3, row: r * 3, facing: 0 };
      if ((c !== 5 || r !== 5) && reference(lone, there, land, [lone, there], null) === 'blocked') hid = there;
    }
    const pair = [lone, hid];
    check('and each is kept by the terrain it was asked of: the same two units, asked across the battlefield and then across open ground in one thought, are hidden from each other and then in plain sight',
      [!!hid, hid && R.thinking(() => [R.sightBetween(lone, hid, land, pair), R.sightBetween(lone, hid, [], pair), R.sightBetween(lone, hid, land, pair), R.losBetween(lone, hid, land, pair), R.losBetween(lone, hid, [], pair)])],
      [true, [false, true, false, 'blocked', 'clear']]);
    // What "is there a line" is kept by: a unit that only obstructs is not read.
    const others = board.tokens.filter((t) => t !== a && t !== b && !t.aerial);
    const bystander = others[0];
    const wall = { ...M.U.makeDroneToken(board, data, data.byId.get('PDAM-003'), 's2'), col: 30, row: 30 };
    const walksFor = (move) => R.thinking(() => {
      const n = R.walked();
      R.sightBetween(a, b, land, board.tokens);
      move();
      R.sightBetween(a, b, land, board.tokens);
      return R.walked() - n;
    });
    const aside = walksFor(() => { bystander.col = (bystander.col + 9) % 36; });
    board.tokens.push(wall);
    const walled = walksFor(() => { wall.col = 27; });
    const mover = walksFor(() => { a.col = (a.col + 3) % 36; });
    check('kept by what it reads: a unit that only obstructs, moved elsewhere, costs no second walk; a wall moved, or either end, does',
      [bystander !== undefined && !R.blocksAsTerrain(bystander), R.blocksAsTerrain(wall), aside, walled, mover], [true, true, 1, 2, 2]);
    // WHERE A PROJECTILE MAY LAND, with Grids left out before they are judged.
    const rocket = data.byId.get('056').actions.find((x) => x.type === 'Projectile');
    const arc = data.byId.get('108').actions.find((x) => x.type === 'Projectile');
    const mire = board.tokens.find((t) => t.label === 'Mire');
    mire.col = 15; mire.row = 15;
    const near = (c, r) => (c + r) % 3 === 0;
    const full = T.landingGrids(data, board, mire, rocket);
    const some = T.landingGrids(data, board, mire, rocket, near);
    check('the Landing Points of a Direct Fire launcher are the Grids in its Range it has a line to, a Grid terrain fills left out: some of the board, not all of it',
      [M.U.needsSightToLanding(rocket), full.length > 40, full.length < 144, full.every((g) => g.ok)], [true, true, true, true]);
    check('asked for some Grids only, it answers with those of them it would have answered with anyway, in the same order; and so does a launcher that fires in an arc',
      [JSON.stringify(some) === JSON.stringify(full.filter((g) => near(g.c, g.r))), some.length > 10,
        JSON.stringify(T.landingGrids(data, board, mire, arc, near)) === JSON.stringify(T.landingGrids(data, board, mire, arc).filter((g) => near(g.c, g.r))), M.U.needsSightToLanding(arc)],
      [true, true, true, false]);
    check('and the sight it asks for is the one that stops at the first line: the Match Centre\'s own reading of where a Projectile may land walks no line it does not need',
      [/if \(only && !only\(c, r\)\) continue;\n\s+if \(sight\) \{[\s\S]{0,400}if \(!sightBetween\(t, probe, terrain, state\.tokens\)\) continue;/.test(readFileSync(new URL('../src/turn.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n'))], [true]);
  }
  // THE CELLS TERRAIN FILLS, gathered once for a list while a seat is thinking
  // (rules.ts standingSpot): where a unit of each size stands in every Grid,
  // asked of two lists of terrain turn about, is what it is with nothing kept.
  {
    const R = M.R;
    const full = T.terrainOf(data, s);
    const bare = full.filter((p) => !p.isFragile);
    const spots = (list) => {
      const out = [];
      for (let c = 0; c < 12; c++) for (let r = 0; r < 12; r++) for (const size of [1, 2, 3]) out.push(R.standingSpot(c, r, size, false, list, s.tokens, U.Mire.uid));
      return JSON.stringify(out);
    };
    const fresh = [spots(full), spots(bare)];
    const kept = R.thinking(() => [spots(full), spots(bare), spots(full), spots(bare)]);
    const reach = (t, steps) => JSON.stringify(R.reachableGrids(t, steps, full, s.tokens, false, T.moveOptsFor(data, s, t, false)));
    check('where a unit stands in a Grid is the same answer inside a thought as outside one, for two lists of terrain asked turn about (432 spots a list)',
      [kept[0] === fresh[0], kept[1] === fresh[1], kept[2] === fresh[0], kept[3] === fresh[1], fresh[0] !== fresh[1]], [true, true, true, true, true]);
    // Outside a thought nothing is kept: a list changed where it stands after a
    // thought has read it is read afresh.
    const list = [...full];
    const walled = { c: 5, r: 2 };
    const inThought = R.thinking(() => R.standingSpot(walled.c, walled.r, 3, false, list, [], U.Mire.uid));
    list.length = 0;
    check('what a thought gathered is gone when the thought ends: the same list, emptied afterwards, is read as it stands',
      [inThought, R.standingSpot(walled.c, walled.r, 3, false, list, [], U.Mire.uid) !== null, R.thinking(() => R.standingSpot(walled.c, walled.r, 3, false, list, [], U.Mire.uid)) !== null], [null, true, true]);
    check('and so are the Grids a Movement reaches',
      [[U.Mire, cat, U.Porcupine, U.Tarantula].map((t) => R.thinking(() => reach(t, 4)) === reach(t, 4)), reach(cat, 4).length > 20], [[true, true, true, true], true]);
  }
  // HOW LONG A WALK IS (walkField): from every Grid to a set of Grids, the
  // Grids on the shortest road and the fewest activations a walk takes.
  {
    const R = M.R;
    const G = (ref) => ({ c: ref.charCodeAt(0) - 65, r: Number(ref.slice(1)) - 1 });
    const K = (ref) => `${G(ref).c},${G(ref).r}`;
    const BRAVO = ['B6', 'C6', 'B7', 'C7'].map(G);
    const ECHO = ['F6', 'G6', 'F7', 'G7'].map(G);
    const HOTEL = ['J6', 'K6', 'J7', 'K7'].map(G);
    check('the Movements one activation is made of, in the order they are made: a Mech\'s Maneuver and then its longest Movement Action, any other unit\'s one Movement, nothing for a Projectile',
      [T.movementsOf(data, U.Mire), T.movementsOf(data, cat), T.movementsOf(data, U.Porcupine), T.movementsOf(data, U.Raven), T.movementsOf(data, U.Tarantula),
        T.movementsOf(data, { ...U.Mire, kind: 'projectile' })],
      [[1, 4], [2, 4], [5], [9], [6], []]);
    check('a Mobility Stance doubles the Maneuver, and a Mech with no Chassis has neither the Maneuver nor the Sprint printed on it',
      [T.movementsOf(data, { ...U.Mire, stance: 'mobility' }), T.movementsOf(data, { ...U.Mire, partStates: { ...U.Mire.partStates, chasis: 'destroyed' } })], [[2, 4], []]);
    const told = (f, ref) => { const w = f.walks.get(K(ref)); return w ? [w.grids, w.turns] : null; };
    // On a board with no terrain a walk is its Grids over the unit's stride.
    const open = { ...s, map: 'none' };
    const flat = T.walkField(data, open, U.Mire, [G('F1')]);
    check('on an open board five Grids is a Maneuver and a Sprint, six is two activations, and the Grid walked to is no walk',
      [told(flat, 'A1'), told(flat, 'G1'), told(flat, 'L1'), told(flat, 'F1'), told(flat, 'F6'), told(flat, 'F7')], [[5, 1], [1, 1], [6, 2], [0, 0], [5, 1], [6, 2]]);
    check('an activation under way is counted from what is left of it: with the Sprint still to make, four Grids is this activation and five is one more; with nothing left, a whole one',
      [flat.after(G('B1'), [4]), flat.after(G('A1'), [4]), flat.after(G('B1'), []), flat.after(G('F1'), []), flat.after(G('L12'), [4])], [0, 1, 1, 0, 3]);
    check('a unit with no Movement has no walk', [T.walkField(data, s, { ...U.Mire, kind: 'projectile' }, ECHO).walks.size, T.walkField(data, s, { ...U.Mire, kind: 'projectile' }, ECHO).after(G('E3'), [4])], [0, null]);
    // The alley, for the Mire: Echo is behind a Container from the north.
    const field = T.walkField(data, s, U.Mire, ECHO);
    check('a Grid of the zone is no walk; a Grid beside it is one Grid and one activation; a walled Grid has no walk at all',
      [told(field, 'F6'), told(field, 'F5'), told(field, 'F3')], [[0, 0], [1, 1], null]);
    check('from E3 Echo is four Grids through the Container in E4, and ONE activation: the Maneuver into the Container, then the Sprint on from it',
      [told(field, 'E3'), T.walkStops(data, s, U.Mire).has(K('E4')), field.after(G('E4'), [4]), field.after(G('E3'), [4])], [[4, 1], true, 0, 1]);
    check('from D3 it is five Grids and TWO: the Maneuver comes first (3.4.5), so it is the Sprint that meets the Container and ends in it',
      [told(field, 'D3')], [[5, 2]]);
    const bravo = T.walkField(data, s, U.Mire, BRAVO);
    check('the fewest activations may be by a longer road: from D3 the shortest road to Bravo is four Grids through a Container (two activations), and round it by column B is five Grids and ONE',
      [told(bravo, 'D3'), told(bravo, 'B2'), told(bravo, 'E3')], [[4, 1], [4, 1], [5, 2]]);
    check('Hotel is two activations from J2 (the Sprint ends in the Container at K5) and one from K4',
      [told(T.walkField(data, s, U.Mire, HOTEL), 'J2'), told(T.walkField(data, s, U.Mire, HOTEL), 'K4')], [[5, 2], [2, 1]]);
    // THE ENGINE'S OWN MOVEMENT SEARCH, a Movement at a time. From every Grid:
    // the Grids on the road are the road asked for alone on an empty board;
    // and the activations are one more than the fewest among the Grids the
    // unit's Movements, made in order from that Grid, could end in. Which, the
    // Grids walked to being none, is the whole count.
    const every = [];
    for (let c = 0; c < 12; c++) for (let r = 0; r < 12; r++) every.push({ c, r });
    const land = T.terrainOf(data, s);
    const wrong = [];
    let walks = 0;
    for (const [label, t, zone, flying] of [['Mire', U.Mire, ECHO, false], ['Mire', U.Mire, BRAVO, false], ['Wild Cat', cat, HOTEL, false], ['Porcupine', U.Porcupine, ECHO, false],
      ['Tarantula', U.Tarantula, BRAVO, false], ['Raven', U.Raven, HOTEL, true]]) {
      const f = T.walkField(data, s, t, zone);
      const legs = T.movementsOf(data, t);
      // Every Grid one Movement from a Grid could end in: the unit put down
      // there alone, what it would have crushed to stand there gone.
      const ends = (k, range) => {
        const [c, r] = k.split(',').map(Number);
        const mover = { ...t, col: c * 3, row: r * 3 };
        const here = land.filter((p) => !(p.isFragile && t.size === 3 && p.subCells.some((x) => Math.floor(x.col / 3) === c && Math.floor(x.row / 3) === r)));
        const opts = { crushable: (cc, rr) => R.crushTargets(mover, cc, rr, here, [mover]) !== null };
        return [k, ...R.reachableGrids(mover, range, here, [mover], flying, opts).map((g) => `${g.c},${g.r}`)];
      };
      for (const g of every) {
        const k = `${g.c},${g.r}`;
        const w = f.walks.get(k);
        if (!w) continue;
        walks += 1;
        const inside = zone.some((z) => z.c === g.c && z.r === g.r);
        const mover = { ...t, col: g.c * 3, row: g.r * 3 };
        const roads = T.roadsToAll(data, { ...s, tokens: [mover] }, mover, zone, flying).filter(Boolean).map((x) => x.length - 1);
        const shortest = inside ? 0 : Math.min(...roads);
        // After its Movements in order, where could it be, and how far from there?
        let at = [k];
        for (const leg of legs) at = [...new Set(at.flatMap((x) => ends(x, leg)))];
        const best = Math.min(...at.map((x) => f.walks.get(x)?.turns ?? Infinity));
        const want = inside ? 0 : best + 1;
        // And with only the last of its Movements left to make from here.
        const last = Math.min(...ends(k, legs.at(-1)).map((x) => f.walks.get(x)?.turns ?? Infinity));
        if (w.grids !== shortest || w.turns !== want || f.after(g, [legs.at(-1)]) !== (inside ? 0 : last)) {
          wrong.push(`${label} from ${k}: ${w.grids}/${w.turns} after ${f.after(g, [legs.at(-1)])}, against ${shortest}/${want} after ${last}`);
        }
      }
    }
    check('from every Grid, for a unit of each kind: the road is the road asked for alone, and the activations are one more than the fewest among the Grids the engine\'s own Movement search says its Movements, made in order, could end in',
      [wrong.slice(0, 5), walks > 600], [[], true]);
    check('a flown walk is as the crow flies, a Grid at a time: nine Grids an activation for a Raven',
      [...['A1', 'F1', 'L12'].map((ref) => told(T.walkField(data, s, U.Raven, ECHO), ref))], [[10, 2], [5, 1], [10, 2]]);
    // A building: a flown Movement crosses it, and nothing begins or ends a walk standing in it.
    const building = 'G5';
    check('a Grid no unit can stand in is where no walk begins, though a flown walk crosses it; and a walk TO such a Grid is no walk at all',
      [R.standingSpot(G(building).c, G(building).r, 2, false, land, [], U.Raven.uid), T.walkField(data, s, U.Raven, ECHO).walks.has(K(building)), told(T.walkField(data, s, U.Raven, ECHO), 'G4'),
        T.walkField(data, s, U.Mire, [G(building)]).walks.size, T.walkField(data, s, U.Raven, [G(building)]).walks.size, T.walkField(data, s, U.Mire, [G(building)]).after(G('G4'), [4])],
      [null, false, [2, 1], 0, 0, null]);
    check('a Projectile has no Movement to walk with, whatever its card moves', T.movementsOf(data, { ...U.Porcupine, kind: 'projectile' }), []);
    // The units on the board are left out of it.
    const same = (x, y) => JSON.stringify([...x.walks].map(([k, w]) => [k, w.grids, w.turns]).sort()) === JSON.stringify([...y.walks].map(([k, w]) => [k, w.grids, w.turns]).sort());
    const crowded = JSON.parse(JSON.stringify(s));
    crowded.tokens.forEach((t, i) => { if (t.uid !== U.Mire.uid) { t.col = (4 + (i % 3)) * 3; t.row = (3 + i) * 3; } });
    check('the walk is the terrain\'s answer: it is the same with every other unit moved into the road, or taken off the board',
      [same(field, T.walkField(data, crowded, crowded.tokens.find((t) => t.uid === U.Mire.uid), ECHO)), same(field, T.walkField(data, { ...s, tokens: [U.Mire] }, U.Mire, ECHO))], [true, true]);
    // And it changes when the terrain does, which its key says.
    const opened = { ...s, removedTerrain: fragile(4, 3).map((p) => p.id) };
    check('with the Container in E4 gone the walk from D3 is one activation, and the key of the field is another key',
      [told(T.walkField(data, opened, U.Mire, ECHO), 'D3'), T.walkStops(data, opened, U.Mire).has(K('E4')), T.walkKey(data, opened, U.Mire) === T.walkKey(data, s, U.Mire)],
      [[5, 1], false, false]);
    check('the key is the same for the same board whoever else has moved, and another for a unit that moves differently',
      [T.walkKey(data, crowded, crowded.tokens.find((t) => t.uid === U.Mire.uid)) === T.walkKey(data, s, U.Mire),
        T.walkKey(data, s, { ...U.Mire, stance: 'mobility' }) === T.walkKey(data, s, U.Mire),
        T.walkKey(data, s, { ...U.Mire, statuses: ['camouflage'] }) === T.walkKey(data, s, U.Mire),
        T.walkKey(data, s, U.Dune) === T.walkKey(data, s, U.Mire)],
      [true, false, false, false]);
    check('a camouflaged Mech crushes nothing: a Container is a wall to it, and no Grid of its walk stops a Movement',
      [T.walkStops(data, s, { ...U.Mire, statuses: ['camouflage'] }).size, told(T.walkField(data, s, { ...U.Mire, statuses: ['camouflage'] }, ECHO), 'E4')], [0, null]);
  }
  // The Crush itself, piece by piece.
  const box = fragile(7, 8).map((p) => p.id);
  const destroy = T.crushDestroy({ seat: 's2', uid: cat.uid }, box);
  check('the Crush destroys the terrain in the Grid, as the crusher\'s own command', destroy, { kind: 'destroyTerrain', seat: 's2', uid: cat.uid, pieces: box });
  check('before it is gone the crusher has nowhere to stand there; once it is, it lands in the Grid',
    [box.length, T.crushLanding(data, s, cat, { c: 7, r: 8 })], [1, null]);
  M.C.apply(data, s, destroy);
  const spot = T.crushLanding(data, s, cat, { c: 7, r: 8 });
  check('and lands in it', [Math.floor(spot.col / 3), Math.floor(spot.row / 3)], [7, 8]);
  check('the Movement is recorded as the crusher\'s own, with what the plan carried and nothing it did not',
    [T.crushRecord(cat, { free: true, facing: 3, actionId: '099_A', breakAwayLink: 1 }, spot, [spot]),
      JSON.parse(JSON.stringify(T.crushRecord(cat, {}, spot, [spot], { col: 21, row: 27 })))],
    [{ kind: 'maneuver', seat: 's2', uid: cat.uid, to: spot, free: true, granted: undefined, via: [spot], facing: 3, from: undefined, actionId: '099_A', breakAwayLink: 1 },
      { kind: 'maneuver', seat: 's2', uid: cat.uid, to: spot, via: [spot], from: { col: 21, row: 27 } }]);
  check('a Movement it resumes says so', T.crushRecord(cat, { resume: true }, spot, [spot]).resume, true);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
