// The seat seam, part one: what one seat SEES (AI-OPPONENT-PLAN.md, M1.1).
//
// A computer player reads the table through src/seat.ts viewOf() and through
// nothing else, so this drives the real engine to a real table (both copied
// scenarios, played through setup by commands) and holds the view to it: every
// unit, Part and Action as the cards have them, the Tactical Zones and who
// holds them, the open Action Opportunity, and the one secret of the game
// (3.3): the other squad's Timing Dials, absent until they are revealed.
import { loadEngine, tableAtRoundOne } from './_engine.mjs';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}\n       got  ${g}`); }
};

console.log('The seat seam: what a seat sees\n');

const { M, data } = await loadEngine('seat', ["export * as SEAT from '../src/seat';"]);
const viewOf = (state, seat) => M.SEAT.viewOf(data, state, seat);
const [advance, vip] = data.solo.scenarios;
const copy = (x) => JSON.parse(JSON.stringify(x));
// A command on any state, the way the harness runner sends one.
const send = (state, cmd) => {
  const v = M.C.check(data, state, cmd);
  if (!v.ok) return v;
  M.C.perform(data, state, cmd);
  M.G.glueAfter(data, state, cmd);
  return v;
};
// The same for a table some unit has acted on: the passes are sent where they
// are still wanted and the turn itself must be taken.
const turnPhaseKeeping = (state) => {
  for (const seat of ['s1', 's2']) send(state, { kind: 'passTurn', seat });
  for (const seat of ['s1', 's2']) send(state, { kind: 'setReady', seat, ready: true });
  return send(state, { kind: 'advancePhase', seat: 's2' }).ok;
};
// Both squads done with a phase: each passes where the phase is a loop, both
// press Continue, and the one completing the pair turns the phase.
const turnPhase = (state) => {
  const out = [];
  if (M.L.isLoopPhase(M.TY.PHASES[state.round.phase])) for (const seat of ['s1', 's2']) out.push(send(state, { kind: 'passTurn', seat }).ok);
  for (const seat of ['s1', 's2']) out.push(send(state, { kind: 'setReady', seat, ready: true }).ok);
  out.push(send(state, { kind: 'advancePhase', seat: 's2' }).ok);
  return out.every(Boolean);
};

// ---------- a real table, by commands ----------
const A = tableAtRoundOne(M, data, advance);
const V = tableAtRoundOne(M, data, vip);
check('both copied scenarios play through setup to Round 1 with nothing refused', [A.refused, V.refused], [[], []]);

// ---------- the table ----------
const a1 = viewOf(A.state, 's1');
const a2 = viewOf(A.state, 's2');
check('the view names its seat and the other one', [a1.seat, a1.other, a2.seat, a2.other], ['s1', 's2', 's2', 's1']);
check('the round, its limit, the phase by number and by name, the First Player and the setup stage',
  [a1.round, a1.roundLimit, a1.phase, a1.phaseName, a1.firstPlayer, a1.setup],
  [1, 5, 0, 'Command', 's1', 'done']);
check('the Main Task, and that this game has no Secondary Tasks', [a1.mission, a1.noSecondary], ['control-frontal-breakthrough', true]);
check('a table that plays them says so', viewOf({ ...A.state, noSecondary: undefined }, 's1').noSecondary, false);
check('nobody has scored, and each squad holds the Command Tokens its Mechs generated (two Mechs; KN Data Link)',
  [a1.vp, a1.commandTokens], [{ s1: 0, s2: 0 }, { s1: 2, s2: 2 }]);
check('no Action Opportunity is open in the Command Phase', a1.opportunity, null);
check('before a game is set up the stage is null and the view still draws',
  [viewOf(M.U.migrateState(copy({ ...A.state, setup: null, script: null }), data), 's1').setup], [null]);

// ---------- the units ----------
const byLabel = (view) => Object.fromEntries(view.units.map((u) => [u.label, u]));
const U = byLabel(a1);
const NAMES = ['Mire', 'Dune', 'Wild Cat', 'ADK15P Porcupine Ion Type', 'ADK60S Raven Interference Type', 'ADK30C Tarantula Carrier Type'];
check('every unit of both squads is in the view, with its side and kind',
  a1.units.map((u) => [u.label, u.side, u.kind]),
  [['Mire', 's1', 'mech'], ['Dune', 's1', 'mech'], ['Wild Cat', 's2', 'mech'],
    ['ADK15P Porcupine Ion Type', 's2', 'drone'], ['ADK60S Raven Interference Type', 's2', 'drone'], ['ADK30C Tarantula Carrier Type', 's2', 'drone']]);
check('each squad is worth what the file promises: 400 and 410',
  ['s1', 's2'].map((s) => a1.units.filter((u) => u.side === s).reduce((n, u) => n + u.points, 0)), [400, 410]);
check('a unit is worth its cards: a Mech its Parts and Pilot, a Carrier its Load too',
  NAMES.map((n) => U[n].points), [182, 218, 259, 70, 36, 45]);
check('a Mech shows five Parts and never its Pilot; a Drone shows one, and a Load is not a Part',
  NAMES.map((n) => U[n].parts.map((p) => `${p.slot}:${p.cardId}`).join(' ')),
  ['torso:533 chasis:534 leftHand:535 rightHand:536 backpack:004', 'torso:014 chasis:020 leftHand:032 rightHand:033 backpack:532',
    'torso:539 chasis:099 leftHand:540 rightHand:541 backpack:538', 'main:543', 'main:166', 'main:162']);
{
  const wrong = [];
  for (const u of a1.units) for (const p of u.parts) {
    const card = data.byId.get(p.cardId);
    const token = A.state.tokens.find((t) => t.uid === u.uid);
    if (p.armor !== (card.armor ?? 0) || p.points !== (card.score ?? 0) || p.structure !== M.U.structureOf(data, token, p.slot)) wrong.push(`${u.label} ${p.slot}`);
    if (p.state !== 'intact' || p.repaired) wrong.push(`${u.label} ${p.slot} state`);
  }
  check('every Part carries its card\'s Armor and points and the unit\'s Structure, intact at the start', wrong, []);
}
check('the Mire\'s Torso: Armor 6, Structure 2, 26 points', U.Mire.parts[0], { slot: 'torso', cardId: '533', state: 'intact', armor: 6, structure: 2, points: 26, repaired: false });
check('a whole unit has health 1', a1.units.map((u) => u.health), [1, 1, 1, 1, 1, 1]);
check('where a unit stands: its Large Grid, its own cell and footprint, its facing',
  NAMES.map((n) => [U[n].grid, U[n].cell, U[n].size, U[n].facing]).map(([g, c, s, f]) => `${g.col},${g.row} ${c.col},${c.row} ${s} ${f}`),
  A.state.tokens.map((t) => `${Math.floor(t.col / 3)},${Math.floor(t.row / 3)} ${t.col},${t.row} ${t.size} ${t.facing}`));
check('every unit is deployed and alive', a1.units.map((u) => [u.deployed, u.alive]), a1.units.map(() => [true, true]));
check('a Mech has Link and its ceiling, a Drone has neither',
  NAMES.map((n) => [U[n].link ?? null, U[n].linkMax ?? null]), [[4, 4], [4, 4], [4, 4], [null, null], [null, null], [null, null]]);
check('how far a Maneuver goes: 1 Grid on the two RDL chassis, 2 on the Wild Cat (Skimming), none for a Drone',
  NAMES.map((n) => U[n].maneuver), [1, 1, 2, 0, 0, 0]);
check('the Command Tokens a Mech bears show as its statuses', [U.Mire.statuses, U['Wild Cat'].statuses], [['command'], ['command', 'command']]);
check('nobody is a Commander on a mission that names none', a1.units.some((u) => u.commander), false);

// ---------- the Actions a player chooses ----------
check('a unit lists the Actions a player performs, never a Passive, and a Carrier never its Load\'s',
  NAMES.map((n) => U[n].weapons.map((w) => w.actionId).sort().join(' ')),
  ['004_A 534_A 535_A 536_A 536_B', '020_A 032_A 033_A', '099_A 540_A 540_B 541_A 541_B', '543_A 543_B', '166_A', '']);
{
  const wrong = [];
  for (const u of a1.units) for (const w of u.weapons) {
    const card = data.byId.get(u.parts.find((p) => p.slot === w.slot)?.cardId);
    const a = card?.actions.find((x) => x.id === w.actionId);
    if (!a || w.range !== (a.range ?? 0) || w.yellow !== (a.yellowDice ?? 0) || w.red !== (a.redDice ?? 0) || w.type !== a.type) wrong.push(w.actionId);
    if (a?.type === 'Passive') wrong.push(`${w.actionId} is Passive`);
  }
  check('each Action carries the Part it sits on and its card\'s type, Range and dice', wrong, []);
}
{
  // The copied Carrier's Load is a Cooler, all Passive. Lend it a Missile Rack
  // and the rule shows: the Missile is the Mech's it is lent to (FAQ O4).
  const s = copy(A.state);
  const carrier = s.tokens.find((t) => t.cardId === '162');
  carrier.droneBackpack = '004';
  const u = viewOf(s, 's1').units.find((x) => x.uid === carrier.uid);
  check('a Load with an Action of its own adds nothing to its Carrier\'s list, though the Carrier is worth it',
    [u.weapons.map((w) => w.actionId), u.parts.map((p) => p.cardId), u.points], [[], ['162'], 18 + 36]);
}
const weapon = (unit, id) => { const w = { ...unit.weapons.find((x) => x.actionId === id) }; delete w.name; return w; };
// (It prints Melee Firing, so a Melee Lock does not bar it: 4.3.5, the seat's `meleeFiring`.)
check('a Mech\'s Action has a Timing and a length: the Shotgun\'s Single Shot is a Medium Firing Action, Range 6, four Yellow and a Red',
  weapon(U.Mire, '536_A'), { slot: 'rightHand', actionId: '536_A', type: 'Firing', timing: 'firing', length: 'medium', range: 6, yellow: 4, red: 1, meleeFiring: true, usable: true });
check('an Action that carries Ammo shows what is left: the Missile Rack\'s four',
  [weapon(U.Mire, '004_A').ammo, weapon(U.Mire, '536_A').ammo ?? null], [4, null]);
check('a Projectile Action says how far what it launches strikes from where it lands (the Razor Missile\'s Range 3), and no other Action says anything of it',
  [weapon(U.Mire, '004_A').strike, a1.units.flatMap((u) => u.weapons).filter((w) => 'strike' in w).map((w) => w.actionId)], [3, ['004_A']]);
{
  // Melee Lock (4.3.5): who an enemy in a Grid beside it may lock, and who
  // locks. Every Mech has a Punch, so every Mech locks; a Drone with no Melee
  // Action locks nobody; the Raven flies, and is nobody's to lock.
  check('a Ground unit is one a Melee Lock can hold, and a unit that could strike in Melee is one that holds it',
    NAMES.map((n) => [U[n].ground, U[n].locks]), [[true, true], [true, true], [true, true], [true, false], [false, false], [true, false]]);
  const s = copy(A.state);
  s.tokens.find((t) => t.label === 'Mire').stance = 'shutdown';
  check('a Shutdown Mech strikes nobody, so it locks nobody', byLabel(viewOf(s, 's2')).Mire.locks, false);
  // Low Value: a Projectile, and a Drone that costs nothing. Neither holds a
  // zone nor keeps the other squad from holding it.
  const missile = { ...M.U.makeDroneToken(s, data, data.byId.get('071'), 's1'), col: 0, row: 0, facing: 0 };
  s.tokens.push(missile);
  const seen = viewOf(s, 's2');
  check('a unit says whether it is Low Value: a Projectile is, and none of the copied squads\' Mechs or Drones',
    [seen.units.find((u) => u.uid === missile.uid).lowValue, NAMES.map((n) => byLabel(seen)[n].lowValue)], [true, [false, false, false, false, false, false]]);
}
check('a Drone\'s Action has a control mode in place of a Timing and a length',
  U['ADK15P Porcupine Ion Type'].weapons.map((w) => [w.actionId, w.mode, w.timing ?? null, w.length ?? null]),
  [['543_A', 'auto', null, null], ['543_B', 'command', null, null]]);

// ---------- damage ----------
{
  const s = copy(A.state);
  const mire = s.tokens.find((t) => t.label === 'Mire');
  mire.partStates.rightHand = 'destroyed';
  mire.partStates.chasis = 'damaged';
  const u = byLabel(viewOf(s, 's2')).Mire;
  check('a damaged and a destroyed Part show, and the unit\'s health falls by a half and a whole Part of five',
    [u.parts.map((p) => p.state), u.health], [['intact', 'damaged', 'intact', 'destroyed', 'intact'], 0.7]);
  check('the Actions of a destroyed Part are not usable; the others still are',
    u.weapons.map((w) => `${w.actionId}:${w.usable}`).sort(), ['004_A:true', '534_A:true', '535_A:true', '536_A:false', '536_B:false']);
  mire.repairedSlots = ['rightHand'];
  const r = byLabel(viewOf(s, 's2')).Mire;
  check('a Repaired Token gives them back (FAQ J21)',
    [r.parts[3].repaired, r.weapons.filter((w) => w.slot === 'rightHand').map((w) => w.usable)], [true, [true, true]]);
  mire.partStates.torso = 'destroyed';
  check('a Mech whose Torso is destroyed is not alive (4.4.4)', byLabel(viewOf(s, 's2')).Mire.alive, false);
  const waiting = copy(A.state);
  waiting.tokens[0].deployed = false;
  check('a unit still waiting in its squad says so', viewOf(waiting, 's1').units.map((x) => x.deployed), [false, true, true, true, true, true]);
  const charged = copy(A.state);
  charged.tokens[2].charge = ['leftHand'];
  charged.tokens[2].statuses = [...charged.tokens[2].statuses, 'camouflage'];
  const wc = byLabel(viewOf(charged, 's1'))['Wild Cat'];
  check('a face-up Charge Token and Optical Camouflage show on the unit', [wc.charged, wc.camouflaged, U['Wild Cat'].charged, U['Wild Cat'].camouflaged], [['leftHand'], true, [], false]);
}

// ---------- the Tactical Zones ----------
const ZONES = {
  Alpha: ['1,1', '2,2'], Bravo: ['1,5', '2,5', '1,6', '2,6'], Charlie: ['2,9', '1,10'], Delta: ['5,3', '6,3'],
  Echo: ['5,5', '6,5', '5,6', '6,6'], Foxtrot: ['5,8', '6,8'], Golf: ['10,1', '9,2'], Hotel: ['9,5', '10,5', '9,6', '10,6'], India: ['9,9', '10,10'],
};
check('all nine Tactical Zones, each with its Large Grids',
  Object.fromEntries(a1.zones.map((z) => [z.name, [...z.cells].sort()])),
  Object.fromEntries(Object.entries(ZONES).map(([k, v]) => [k, [...v].sort()])));
check('Forward Advance scores Bravo, Echo and Hotel', a1.zones.filter((z) => z.scoring).map((z) => z.name), ['Bravo', 'Echo', 'Hotel']);
check('the Commander\'s mission scores no zone', viewOf(V.state, 's1').zones.filter((z) => z.scoring).map((z) => z.name), []);
{
  // The Control dial is what the Main Task pays on, and it outlives whoever
  // set it: a zone taken and then left is still its taker's.
  const s = copy(A.state);
  const tasks = s.tasks;
  const dial = tasks.items.find((i) => i.kind === 'control' && s.tokens.every((t) => !M.TK.inZone?.(t, M.S.zoneCellsOf(data, s)(i.zone))));
  dial.control = 's2';
  const z = viewOf(s, 's1').zones.find((x) => x.id === dial.zone);
  check('each zone says who its Control dial names, which may be a squad with nobody inside it: the dial keeps its holder until the zone is taken from it',
    [z.scoring, z.control, z.holder, viewOf(s, 's1').zones.filter((x) => x.control).length, a1.zones.every((x) => x.control === null)], [true, 's2', null, 1, true]);
  check('a zone the Main Task lays no dial on names nobody', [...new Set(viewOf(V.state, 's1').zones.map((x) => x.control))], [null]);
}
check('the one zone a unit was deployed in is held by its squad (India, under the Wild Cat), and no other is held',
  a1.zones.filter((z) => z.holder).map((z) => [z.name, z.holder]), [['India', 's2']]);
{
  const s = copy(A.state);
  const at = (label, col, row) => { const t = s.tokens.find((x) => x.label === label); t.col = col * 3; t.row = row * 3; };
  at('Dune', 5, 5);
  const one = Object.fromEntries(viewOf(s, 's2').zones.map((z) => [z.name, z.holder]));
  at('Wild Cat', 9, 6);
  at('Mire', 10, 5);
  const two = Object.fromEntries(viewOf(s, 's2').zones.map((z) => [z.name, z.holder]));
  check('a Mech standing in a zone alone holds it; a zone both squads stand in is held by neither (5.3.2)',
    [one.Echo, one.Hotel, two.Echo, two.Hotel], ['s1', null, 's1', null]);
  check('who holds a zone is the engine\'s own reading of the board',
    viewOf(s, 's1').zones.map((z) => z.holder),
    data.zoneData.zones.map((z) => M.TK.controlOf(M.S.zoneCellsOf(data, s)(z.id), s.tokens, M.S.lowValueOf(data))));
}

// ---------- the Commander ----------
{
  const v = viewOf(V.state, 's2');
  check('on the Commander\'s mission each squad\'s Commander is marked, and nobody else',
    v.units.filter((u) => u.commander).map((u) => u.label), ['Mire', 'Wild Cat']);
  check('and the mission is named', v.mission, 'vip-commander-assassination');
}

// ---------- the Main Task's terms ----------
{
  check('the Main Task\'s terms are read off its card: Occupation pays 2 for each zone, every round from the second',
    a1.task, { family: 'control', vp: 2, fromRound: 2, cadence: 'per-round', perPart: 0, scoringZone: null, reach: 0 });
  check('the Commander\'s mission pays 10 for the enemy Commander, and 3 for each of its Parts destroyed when the rounds run out',
    viewOf(V.state, 's2').task, { family: 'vip', vp: 10, fromRound: 1, cadence: 'per-round', perPart: 3, scoringZone: null, reach: 0 });
  check('both seats read the same terms', JSON.stringify(a1.task) === JSON.stringify(a2.task), true);
  const kept = viewOf({ ...A.state, mission: 'blackbox-asset-preservation' }, 's1').task;
  check('a Task that pays once, as the game ends, and only in the zone it names, says both',
    kept, { family: 'blackbox', vp: 4, fromRound: 1, cadence: 'at-end', perPart: 0, scoringZone: 'Echo', reach: 0 });
  // Terminals: the terms say how far off a Remote Access may be made, which is
  // the Common Action's own Range.
  const wired = viewOf({ ...A.state, mission: 'terminal-signal-reception' }, 's1').task;
  check('a Terminals Task pays 2 for each Terminal accessed, every round, and says how far from its zone a Remote Access reaches',
    [wired, data.commonActions.find((a) => a.id === 'COMMON_REMOTE_ACCESS').range ?? 4], [{ family: 'terminal', vp: 2, fromRound: 1, cadence: 'per-round', perPart: 0, scoringZone: null, reach: 4 }, 4]);
  check('a table with no Main Task has no terms', viewOf({ ...A.state, mission: null }, 's1').task, null);
  // The terms a seat plans by are the terms the Award pays by: the scorer's
  // own reading of every Main Task card.
  const wrong = [];
  for (const card of data.missions.cards) {
    const terms = M.S.missionScoring(card);
    const seen = viewOf({ ...A.state, mission: card.id }, 's1').task;
    const want = { family: terms.family, vp: terms.vp, fromRound: terms.fromRound, cadence: terms.cadence, perPart: terms.vpPerPart ?? 0, scoringZone: terms.scoringZone ?? null, reach: terms.family === 'terminal' ? 4 : 0 };
    if (JSON.stringify(seen) !== JSON.stringify(want)) wrong.push(card.id);
  }
  check('for every Main Task in the game they are the scorer\'s own reading of its card', [wrong, data.missions.cards.length > 5], [[], true]);
  // A zone holding a Terminal says who has accessed it this round.
  const s = JSON.parse(JSON.stringify(A.state));
  const tasks = M.TK.normaliseTasks(s.tasks);
  const zone = viewOf(s, 's1').zones.find((z) => z.scoring);
  tasks.items = [{ id: 'terminal:t1', kind: 'terminal', zone: zone.id, col: 0, row: 0 }];
  s.tasks = tasks;
  const open = viewOf(s, 's1').zones;
  check('a zone with a Terminal in it says nobody has accessed it yet; a zone with none says nothing of one',
    [open.find((z) => z.id === zone.id).accessed, open.filter((z) => 'accessed' in z).length], [null, 1]);
  tasks.items[0].accessed = 's2';
  s.tasks = tasks;
  check('once it is accessed, both seats are shown by whom', ['s1', 's2'].map((seat) => viewOf(s, seat).zones.find((z) => z.id === zone.id).accessed), ['s2', 's2']);
  check('a table with no Terminal shows none: the copied games\' zones are as they were', a1.zones.some((z) => 'accessed' in z), false);
}

// ---------- the view is a copy ----------
{
  const before = JSON.stringify(A.state);
  const v = viewOf(A.state, 's1');
  const held = new Set();
  const walk = (x, fn) => { if (x && typeof x === 'object') { fn(x); for (const k of Object.keys(x)) walk(x[k], fn); } };
  walk(A.state, (o) => held.add(o));
  let shared = 0;
  walk(v, (o) => { if (held.has(o)) shared++; });
  check('the view shares no object with the state', shared, 0);
  walk(v, (o) => { for (const k of Object.keys(o)) { if (typeof o[k] === 'number') o[k] = -9; else if (typeof o[k] === 'string') o[k] = 'x'; else if (Array.isArray(o[k])) o[k].push('x'); } });
  check('so pulling a view apart leaves the table as it was', JSON.stringify(A.state) === before, true);
  check('and reading the view changes nothing', [JSON.stringify(viewOf(A.state, 's1')) === JSON.stringify(a1), JSON.stringify(A.state) === before], [true, true]);
  // The lists a unit only sometimes carries, filled in, so they are walked too.
  const full = copy(A.state);
  for (const t of full.tokens) { t.charge = ['main']; t.repairedSlots = ['main']; t.statuses = [...(t.statuses ?? []), 'fragile']; }
  const kept = new Set();
  walk(full, (o) => kept.add(o));
  let again = 0;
  walk(viewOf(full, 's2'), (o) => { if (kept.has(o)) again++; });
  check('nor with a state whose units carry Charge, Repaired Tokens and statuses', again, 0);
  let fns = 0;
  walk(viewOf(A.state, 's1'), (o) => { for (const k of Object.keys(o)) if (typeof o[k] === 'function') fns++; });
  check('a view is plain data, so it can be kept, logged or sent', fns, 0);
}

// ---------- the one secret: the other squad's Timing Dials (3.3) ----------
const P = { state: copy(A.state) };
check('the Command Phase ends and Planning begins', [turnPhase(P.state), P.state.round.phase], [true, 1]);
const dials = (state, seat) => viewOf(state, seat).units.filter((u) => u.kind === 'mech').map((u) => [u.label, u.timing ?? null, u.dialHidden]);
check('in Planning a seat\'s own dials are open to it and the other squad\'s are hidden, set or not',
  [dials(P.state, 's1'), dials(P.state, 's2')],
  [[['Mire', null, false], ['Dune', null, false], ['Wild Cat', null, true]], [['Mire', null, true], ['Dune', null, true], ['Wild Cat', null, false]]]);
check('a Drone has no dial to hide', viewOf(P.state, 's1').units.filter((u) => u.kind === 'drone').map((u) => u.dialHidden), [false, false, false]);
{
  const mire = P.state.tokens.find((t) => t.label === 'Mire');
  const dune = P.state.tokens.find((t) => t.label === 'Dune');
  const blind = JSON.stringify(viewOf(P.state, 's2'));
  const seen = [];
  for (const timing of M.TY.TIMINGS.map((x) => x.id)) {
    send(P.state, { kind: 'setTiming', seat: 's1', uid: mire.uid, timing });
    send(P.state, { kind: 'setTiming', seat: 's1', uid: dune.uid, timing });
    seen.push(JSON.stringify(viewOf(P.state, 's2')) === blind);
  }
  check('whatever the First Player sets its dials to, the other seat\'s view does not change by a byte', seen, [true, true, true, true, true, true]);
  send(P.state, { kind: 'setTiming', seat: 's1', uid: mire.uid, timing: 'firing' });
  send(P.state, { kind: 'setTiming', seat: 's1', uid: dune.uid, timing: 'melee' });
  check('while its owner reads them', dials(P.state, 's1').slice(0, 2), [['Mire', 'firing', false], ['Dune', 'melee', false]]);
  const hidden = viewOf(P.state, 's2');
  // A unit's Actions carry their own printed Timing, which is no secret, so
  // the dial is looked for on the unit with its Actions set aside.
  check('and a hidden dial is nowhere in what is sent: the unit carries no dial at all',
    hidden.units.filter((u) => u.side === 's1').map((u) => [u.timing ?? null, JSON.stringify({ ...u, weapons: [] }).includes('timing')]),
    [[null, false], [null, false]]);
  check('where the copy its owner reads does', JSON.stringify({ ...viewOf(P.state, 's1').units[0], weapons: [] }).includes('"timing":"firing"'), true);
  send(P.state, { kind: 'setTiming', seat: 's2', uid: P.state.tokens.find((t) => t.label === 'Wild Cat').uid, timing: 'movement' });
  check('the same holds the other way round', dials(P.state, 's1')[2], ['Wild Cat', null, true]);
  send(P.state, { kind: 'commitTimings', seat: 's1', hash: 'a'.repeat(64) });
  send(P.state, { kind: 'commitTimings', seat: 's2', hash: 'b'.repeat(64) });
  check('a commitment is a promise, not a reveal: both squads committed and both are still hidden',
    [dials(P.state, 's2').slice(0, 2), dials(P.state, 's1')[2]], [[['Mire', null, true], ['Dune', null, true]], ['Wild Cat', null, true]]);
  send(P.state, { kind: 'revealTimings', seat: 's1', salt: 'salt', dials: M.SEC.dialsOf(P.state, 's1') });
  check('a squad that has revealed is read by the other seat, and the squad that has not stays hidden',
    [dials(P.state, 's2'), dials(P.state, 's1')],
    [[['Mire', 'firing', false], ['Dune', 'melee', false], ['Wild Cat', 'movement', false]], [['Mire', 'firing', false], ['Dune', 'melee', false], ['Wild Cat', null, true]]]);
  send(P.state, { kind: 'revealTimings', seat: 's2', salt: 'salt', dials: M.SEC.dialsOf(P.state, 's2') });
  check('with both revealed every dial is open', dials(P.state, 's1'), [['Mire', 'firing', false], ['Dune', 'melee', false], ['Wild Cat', 'movement', false]]);
}
{
  // Pass-and-play has no reveal: the lock opens both squads' dials at once.
  const s = copy(A.state);
  turnPhase(s);
  for (const t of s.tokens.filter((x) => x.kind === 'mech')) send(s, { kind: 'setTiming', seat: t.side, uid: t.uid, timing: 'swift' });
  const before = dials(s, 's2');
  const locked = send(s, { kind: 'lockDials', seat: 's1' }).ok;
  check('on a table that locks its dials the lock opens them',
    [before.map((d) => d[2]), locked, dials(s, 's2')],
    [[true, true, false], true, [['Mire', 'swift', false], ['Dune', 'swift', false], ['Wild Cat', 'swift', false]]]);
  const bare = copy(A.state);
  turnPhase(bare);
  bare.tokens[0].timing = 'tactical';
  bare.script = null;
  check('and a table running no guided game keeps no secret', dials(bare, 's2')[0], ['Mire', 'tactical', false]);
}

// ---------- the open Action Opportunity ----------
check('the Planning Phase ends and the Action Phase begins', [turnPhase(P.state), P.state.round.phase, viewOf(P.state, 's1').phaseName], [true, 2, 'Action']);
check('outside the Planning Phase no dial is hidden from anybody',
  [dials(P.state, 's1').map((d) => d[2]), dials(P.state, 's2').map((d) => d[2])], [[false, false, false], [false, false, false]]);
{
  // Melee comes before Firing and Movement, so the Dune holds the first one.
  const dune = P.state.tokens.find((t) => t.label === 'Dune');
  const mine = viewOf(P.state, 's1').opportunity;
  const theirs = viewOf(P.state, 's2').opportunity;
  check('the open Opportunity is the unit the order names, whole: the Maneuver Tick and two Action Ticks',
    mine, { uid: dune.uid, mine: true, maneuver: true, actionTicks: 2, extraTicks: 0, stanceLocked: false, performed: [], extra: false, commanded: false });
  check('the other seat is shown the same Opportunity, as somebody else\'s', [theirs.uid, theirs.mine], [dune.uid, false]);
  send(P.state, { kind: 'setStance', seat: 's1', uid: dune.uid, stance: 'offensive' });
  const moved = send(P.state, { kind: 'maneuver', seat: 's1', uid: dune.uid, to: { col: dune.col + 3, row: dune.row }, facing: dune.facing });
  const after = viewOf(P.state, 's2');
  check('after its Maneuver the Tick is gone, the Stance is confirmed, and the unit stands in its new Grid',
    [moved.ok, after.opportunity.maneuver, after.opportunity.actionTicks, after.opportunity.stanceLocked, byLabel(after).Dune.grid],
    [true, false, 2, true, { col: Math.floor(dune.col / 3), row: Math.floor(dune.row / 3) }]);
  const granted = copy(P.state);
  granted.script.opp.extras = [{ id: 'x1', label: 'Test Tick' }, { id: 'x2', label: 'Stationary', check: 'stationary' }];
  check('an Extra Tick in hand is counted, and one whose condition has lapsed is not (Stationary, after moving)',
    viewOf(granted, 's1').opportunity.extraTicks, 1);
}

// ---------- whose turn of the round is behind it ----------
{
  const short = (label) => label.split(' ').slice(0, 2).join(' ');
  const done = (state) => Object.fromEntries(viewOf(state, 's2').units.map((u) => [short(u.label), u.done]));
  const none = { Mire: false, Dune: false, 'Wild Cat': false, 'ADK15P Porcupine': false, 'ADK60S Raven': false, 'ADK30C Tarantula': false };
  check('in the Command Phase nobody has had its turn: each unit\'s own phase is still to come', done(A.state), none);
  // P is in the Action Phase, the Dune part way through its Opportunity.
  check('a Mech taking its turn has not had it', done(P.state), none);
  const mech = (label) => P.state.tokens.find((t) => t.label === label);
  const ended = send(P.state, { kind: 'endOpportunity', seat: 's1', uid: mech('Dune').uid }).ok;
  check('once its Opportunity is ended it has, and the Mechs still to act have not; no Drone has, whose turn is the Automatic Phase',
    [ended, done(P.state)], [true, { ...none, Dune: true }]);
  // The Mire is next (Firing), then the Wild Cat (Movement).
  const rest = [];
  for (const [seat, label] of [['s1', 'Mire'], ['s2', 'Wild Cat']]) {
    rest.push(P.state.script.opp?.uid === mech(label).uid, send(P.state, { kind: 'endOpportunity', seat, uid: mech(label).uid }).ok);
  }
  check('each Mech in its turn', [rest, done(P.state)], [[true, true, true, true], { ...none, Mire: true, Dune: true, 'Wild Cat': true }]);
  check('the Action Phase ends and the Automatic Phase begins', [turnPhaseKeeping(P.state), P.state.round.phase], [true, 3]);
  check('in the Automatic Phase every Mech\'s turn is behind it and no Drone\'s is', done(P.state), { ...none, Mire: true, Dune: true, 'Wild Cat': true });
  const raven = P.state.tokens.find((t) => t.cardId === '166');
  const acted = [send(P.state, { kind: 'designate', seat: 's2', uid: raven.uid }).ok];
  check('a Drone taking its activation has not had its turn', [acted, done(P.state)['ADK60S Raven']], [[true], false]);
  acted.push(send(P.state, { kind: 'endOpportunity', seat: 's2', uid: raven.uid }).ok);
  check('and has once the activation is ended, while the Drones not yet activated have not',
    [acted, done(P.state)], [[true, true], { ...none, Mire: true, Dune: true, 'Wild Cat': true, 'ADK60S Raven': true }]);
  // A Projectile's own phase is the Delay Phase.
  const staged = copy(P.state);
  const missile = { ...M.U.makeDroneToken(staged, data, data.byId.get('071'), 's1'), col: 0, row: 0, facing: 0 };
  staged.tokens.push(missile);
  const shown = (state) => viewOf(state, 's2').units.find((u) => u.uid === missile.uid).done;
  const inDelay = copy(staged);
  inDelay.round.phase = 4;
  const fired = copy(inDelay);
  fired.script.acted.push(missile.uid);
  const atEnd = copy(staged);
  atEnd.round.phase = 5;
  check('a Projectile\'s turn is the Delay Phase: to come before it, behind it once it has been activated there, and behind it after',
    [missile.kind, shown(staged), shown(inDelay), shown(fired), shown(atEnd)], ['projectile', false, false, true, true]);
  const next = copy(P.state);
  next.round.phase = 0;
  next.round.n = 2;
  next.script.acted = [];
  check('and a new round gives every unit its turn back', done(next), none);
}

// ---------- the seam's types reach a caller ----------
check('viewOf is the module\'s reader and takes the data, the state and a seat', [typeof M.SEAT.viewOf, M.SEAT.viewOf.length], ['function', 3]);

console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
