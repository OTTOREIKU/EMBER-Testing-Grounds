// Command Coordination, answered by a seat (rulebook 4.15.3; FAQ 1.04 C7 to
// C9; AI-OPPONENT-PLAN.md, M8.2f).
//
// "May immediately issue X Commands to Ally Drones." Most of what a GoF Mech
// does carries it: every GoF Chassis's Sprint, most of its guns and blades.
// A Mech that has just performed such an Action hands a Command Token it kept
// face-up to a Drone that bears none, and the Drone acts at once, in an
// activation nested inside the Mech's own. A GoF Drone's weapon is a Command
// Action: without the Command it does not fire. The Match Centre asks in a
// dialog as the Action lands. The seam offered nothing, so a computer's GoF
// squad Commanded its Drones in the Command Phase and never again.
//
// The engine holds only that something the Mech did carries Coordination: it
// takes a second and a third Command while there are Tokens. How many have
// been handed out is the sender's to keep, and the seam keeps it off the
// table. Each case is staged here on the real engine.
import { botTable, loadEngine, tableAtRoundOne } from './_engine.mjs';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}\n       got  ${g}`); }
};

console.log('Command Coordination\n');

const { M, data } = await loadEngine('seatcoord', ["export * as SEAT from '../src/seat';", "export * as TURN from '../src/turn';", "export * as AI from '../src/ai/index';", "export * as HUD from '../src/matchhud';"]);
const { owed, newMind } = M.SEAT;
const T = M.TURN;
const AI = M.AI;
const clone = (x) => JSON.parse(JSON.stringify(x));

// GOF: a Tracer (a Sprint, a blade and a Railgun that each carry one Command),
// a Chariot (the M2 Data Link: up to two), a Dragoon (the A2K Data Link: one
// after a Maneuver) holding a Discard face whose one Action IS a Coordination,
// a Warrior (Swarm Tactics); a Patrol Eagle (a GoF Medium Drone), a Ram (a
// gun) and a Zealot (a blade). A pack: one Mech and two Drones with guns.
data.solo.squads['t-gof'] = {
  name: 'GoF', faction: 'GOF', points: 0,
  mechs: [
    { name: 'Tracer', loadout: { torso: '174', chasis: '179', leftHand: 'ZHLA-101', rightHand: 'ZHRA-101', pilot: 'ZPA-43' } },
    { name: 'Chariot', loadout: { torso: '176', chasis: '180', leftHand: 'ZHLA-302', rightHand: 'ZHRA-102', pilot: 'ZPA-43' } },
    { name: 'Dragoon', loadout: { torso: '175', chasis: '182', leftHand: 'ZHLA-102-T', rightHand: 'ZHRA-201', pilot: 'ZPA-43' } },
    { name: 'Warrior', loadout: { torso: '172', chasis: '180', leftHand: 'ZHLA-302', rightHand: 'ZHRA-304', pilot: 'ZPA-43' } },
  ],
  drones: [{ cardId: 'ZHDR-206' }, { cardId: 'ZHDR-107' }, { cardId: 'ZHDR-302' }],
};
data.solo.squads['t-pack'] = {
  name: 'Pack', faction: 'GOF', points: 0,
  mechs: [{ name: 'Tracer', loadout: { torso: '174', chasis: '179', leftHand: 'ZHLA-101', rightHand: 'ZHRA-101', pilot: 'ZPA-43' } }],
  drones: [{ cardId: 'ZHDR-107' }, { cardId: 'ZHDR-106' }],
};
data.solo.squads['t-rifles'] = {
  name: 'Riflemen', faction: 'UN', points: 0,
  mechs: [
    { name: 'Wolf', loadout: { torso: '539', chasis: '099', leftHand: '540', rightHand: '541', backpack: '538', pilot: 'LPA-23-2' } },
    { name: 'Cat', loadout: { torso: '539', chasis: '099', leftHand: '540', rightHand: '541', backpack: '538', pilot: 'LPA-23-2' } },
  ],
  drones: [],
};
data.solo.squads['t-wolf'] = { name: 'Rifleman', faction: 'UN', points: 0, mechs: [data.solo.squads['t-rifles'].mechs[0]], drones: [] };
// A Mech with a blade in each hand: two Actions in one Opportunity that each
// carry a Command.
data.solo.squads['t-duel'] = {
  name: 'Duel', faction: 'GOF', points: 0,
  mechs: [{ name: 'Duelist', loadout: { torso: '174', chasis: '179', leftHand: 'ZHLA-101', rightHand: 'ZHRA-304', pilot: 'ZPA-43' } }],
  drones: [{ cardId: 'ZHDR-206' }, { cardId: 'ZHDR-107' }, { cardId: 'ZHDR-302' }],
};
// RDL: a Grappler, whose Parry is a Riposte.
data.solo.squads['t-grapplers'] = {
  name: 'Grapplers', faction: 'RDL', points: 0,
  mechs: [
    { name: 'Volcano', loadout: { torso: '016', chasis: '020', leftHand: '050', rightHand: '033', backpack: '532', pilot: 'FPA-63' } },
    { name: 'Mire', loadout: { torso: '014', chasis: '020', leftHand: '056', rightHand: '033', backpack: '006', pilot: 'FPA-04-2' } },
  ],
  drones: [],
};
const TABLES = {
  g: { ...data.solo.scenarios[0], id: 't-coord-g', seats: { s1: 't-gof', s2: 't-rifles' } },
  r: { ...data.solo.scenarios[0], id: 't-coord-r', seats: { s1: 't-gof', s2: 't-grapplers' } },
  c: { ...data.solo.scenarios[0], id: 't-coord-c', seats: { s1: 't-pack', s2: 't-wolf' } },
  d: { ...data.solo.scenarios[0], id: 't-coord-d', seats: { s1: 't-duel', s2: 't-wolf' } },
  m: { ...data.solo.scenarios[0], id: 't-coord-m', seats: { s1: 't-gof', s2: 't-gof' } },
};
const NAMES = { 'ZHDR-206': 'Eagle', 'ZHDR-107': 'Ram', 'ZHDR-302': 'Zealot', 'ZHDR-106': 'Ballista' };
const name = (t) => NAMES[t.cardId] ?? t.label;

const run = (state, cmd) => {
  const v = M.C.check(data, state, cmd);
  if (v.ok) { M.C.apply(data, state, cmd); M.G.glueAfter(data, state, cmd); }
  return v;
};
const sendAll = (state, commands) => commands.map((c) => run(state, c).ok);
const ids = (list) => list.map((o) => o.id);
// The Coordinations a question offers: a Command for nothing but the Token
// (`plain`), and the Tactic that is one (`faces`).
const co = (d) => (d ? d.options.filter((o) => o.tags[0] === 'coordinate') : []);
const plain = (d) => co(d).filter((o) => !o.tags.includes('action'));
const faces = (d) => co(d).filter((o) => o.tags.includes('action'));
const held = (t) => (t.statuses ?? []).filter((x) => x === 'command').length;
const borne = (t) => (t.statuses ?? []).filter((x) => x === 'commandUsed').length;
const hands = (mech, drone) => ({ kind: 'coordinateCommand', seat: mech.side, uid: mech.uid, targetUid: drone.uid });
const pays = (unit, key, partKey = key) => ({ kind: 'performAction', seat: unit.side, uid: unit.uid, actionId: key, partKey });

const bases = Object.fromEntries(['g', 'r', 'c', 'd'].map((k) => {
  M.L.setLocalSeat(null);
  const t = tableAtRoundOne(M, data, TABLES[k]);
  if (t.refused.length) throw new Error(`table ${k}: ${t.refused.join('; ')}`);
  return [k, t.state];
}));
// A table at a phase on open ground: the first squad in two rows across the
// north, the Drones east of the Mechs; the second squad to the south, its
// first Mech four Grids in front of the Ram.
const stage = (table = 'g', phase = 2) => {
  const s = clone(bases[table]);
  s.map = 'none';
  const U = Object.fromEntries(s.tokens.map((t) => [name(t), t]));
  const at = (t, c, r, f) => { t.col = c * 3; t.row = r * 3; if (f !== undefined) t.facing = f; };
  s.tokens.filter((t) => t.side === 's1').forEach((t, i) => at(t, 1 + i, 3 + (i % 2) * 2, 2));
  s.tokens.filter((t) => t.side === 's2').forEach((t, i) => at(t, 6 + i * 5, 9 + i * 2, 0));
  s.round.phase = phase; s.script.stage = `1:${phase}`; s.script.acted = []; s.script.passed = []; s.script.opp = null;
  if (phase >= 2) { s.script.revealed = ['s1', 's2']; for (const t of s.tokens) if (t.kind === 'mech') t.timing = 'firing'; }
  const ask = (seat = 's1') => { M.L.setLocalSeat(seat); return owed(data, s, seat, newMind()); };
  // A Mech's Action Opportunity on the Timing named; a Drone's activation, as
  // its phase opens it.
  const turnOf = (unit, timing) => {
    if (unit.kind !== 'mech') { s.script.opp = M.TY.newOpportunity(unit.uid, undefined); return ask(unit.side); }
    unit.timing = timing;
    s.script.acted = s.tokens.filter((x) => x.kind === 'mech' && x.uid !== unit.uid).map((x) => x.uid);
    s.script.opp = null;
    M.G.opportunity(data, s);
    return ask(unit.side);
  };
  // The Mech's Sprint, as its seat would send it: the first Grid its answers
  // name. And the activation of a Drone it has commanded, ended.
  const sprint = (mech, id) => sendAll(s, turnOf(mech, 'movement').options.find((o) => o.tags[0] === 'move' && o.facts.actionId === id).commands);
  const take = (d, drone) => sendAll(s, co(d).find((o) => o.facts.targetUid === drone.uid).commands);
  const endDrone = () => sendAll(s, ask().options.find((o) => o.tags.includes('end')).commands);
  return { s, U, at, ask, turnOf, sprint, take, endDrone };
};

// ---------- the cards ----------
{
  const { U } = stage();
  const acts = (u) => M.U.tokenCards(data, u).flatMap(({ card }) => card.actions ?? []);
  const worth = (u, id) => M.U.coordinationFor(data, u, acts(u).find((a) => a.id === id));
  let carried = 0;
  const factions = new Set();
  const tactics = [];
  for (const c of data.cards) {
    for (const a of c.actions ?? []) {
      if (M.U.commandCoordination(a) <= 0) continue;
      carried += 1;
      factions.add(data.factionOf(c));
      if (a.type === 'Tactic') tactics.push(a.id);
    }
  }
  check('the cards are what the test means them to be: 33 Actions carry Command Coordination, every one of them GoF; four are a Tactic that IS one; the Tracer\'s Sprint, blade and Railgun carry one Command each',
    [carried, [...factions], tactics, worth(U.Tracer, '179_A'), worth(U.Tracer, 'ZHLA-101_B'), worth(U.Tracer, 'ZHRA-101_A'), worth(U.Tracer, 'ZHRA-101_B')],
    [33, ['GOF'], ['ZHLA-102-T_A', 'ZHLA-201-T_A', 'ZHRA-201-T_A', 'ZHRA-202-T_A'], 1, 1, 1, 1]);
  check('the Chariot\'s M2 Data Link makes every Coordination of its own two; the Dragoon\'s A2K Data Link gives it one after a Maneuver, and the Discard face it holds is opened as plain card text; the Warrior has Swarm Tactics; the Eagle is the one GoF Medium Drone',
    [M.U.coordinationCap(data, U.Chariot), worth(U.Chariot, '180_A'), M.U.coordinationAfterManeuver(data, U.Dragoon), worth(U.Dragoon, 'ZHLA-102-T_A'), T.actionRoute(data, U.Dragoon, acts(U.Dragoon).find((a) => a.id === 'ZHLA-102-T_A')),
      M.U.swarmTacticsOn(data, U.Warrior), [U.Eagle, U.Ram, U.Zealot].map((d) => M.U.isGofMediumDrone(data, d))],
    [2, 2, 1, 1, 'card', true, [true, false, false]]);
  check('and the Command Tokens each Mech begins the Action Phase holding are its Torso\'s Command Generation', [U.Tracer, U.Chariot, U.Dragoon, U.Warrior].map(held), [4, 2, 2, 1]);
}

// ---------- after an Action that carries it ----------
{
  const { s, U, ask, turnOf, take, endDrone } = stage();
  const first = turnOf(U.Tracer, 'movement');
  check('NOTHING IS OFFERED UNTIL THE MECH HAS DONE SOMETHING THAT CARRIES IT: at the start of its Opportunity no Coordination is an answer, and the engine refuses one sent',
    [ids(co(first)), M.C.check(data, s, hands(U.Tracer, U.Eagle)).ok], [[], false]);
  const moved = sendAll(s, first.options.find((o) => o.tags[0] === 'move' && o.facts.actionId === '179_A').commands);
  const after = ask();
  check('AFTER ITS SPRINT (179_A, Command Coordination 1) there is one answer for each Ally Drone on the board that bears no Command Token: the Command, and nothing else',
    [moved.every(Boolean), ids(co(after)), co(after)[1].tags, co(after)[1].commands, co(after)[1].facts],
    [true, [U.Eagle, U.Ram, U.Zealot].map((d) => `coordinate:${d.uid}`), ['coordinate'], [hands(U.Tracer, U.Ram)], { uid: U.Tracer.uid, targetUid: U.Ram.uid }]);
  check('taken, the Token leaves the Mech and lies face-down on the Drone, which holds an activation nested inside the Mech\'s own (4.15.3)',
    [take(after, U.Ram), held(U.Tracer), borne(U.Ram), U.Ram.commandedBy === U.Tracer.uid, s.script.opp.uid === U.Ram.uid, s.script.opp.commanded, s.script.oppStack.map((o) => o.uid)],
    [[true], 3, 1, true, true, true, [U.Tracer.uid]]);
  const nested = ask();
  check('THE DRONE ACTS AT ONCE: its seat is asked its turn, with its move and the Command Action it performs on no other terms (the Ram\'s Full-auto, at the Mech four Grids in front of it); a Drone has no Coordination of its own',
    [nested.kind, nested.unit === U.Ram.uid, nested.options.some((o) => o.id === `attack:ZHDR-107_A:${U.Wolf.uid}`), nested.options.some((o) => o.tags[0] === 'move'), co(nested).length],
    ['opp.act', true, true, true, 0]);
  check('ended, the Opportunity is the Mech\'s again, and neither of them is marked as having acted by it (FAQ K21)',
    [endDrone(), s.script.opp.uid === U.Tracer.uid, s.script.oppStack.length, s.script.acted.includes(U.Ram.uid), s.script.acted.includes(U.Tracer.uid)], [[true], true, 0, false, false]);
  const back = ask();
  check('ONE ONLY: the Sprint allowed one Command and one has been handed out. No second is offered, though the Mech has three Tokens left and THE ENGINE WOULD TAKE ONE: the count is the sender\'s to keep',
    [back.kind, back.unit === U.Tracer.uid, ids(co(back)), held(U.Tracer), M.C.check(data, s, hands(U.Tracer, U.Eagle)).ok], ['opp.act', true, [], 3, true]);
  check('and a hand-off makes a new question of what the Mech is asked: its id ends with how many Commands it has handed out', [after.id.endsWith(':0'), back.id.endsWith(':1'), after.id.slice(0, -1) === back.id.slice(0, -1)], [true, true, true]);
}
{
  const { s, U, at, ask, turnOf } = stage();
  at(U.Tracer, 6, 6, 2);
  const shot = turnOf(U.Tracer, 'firing').options.find((o) => o.id === `attack:ZHRA-101_A:${U.Wolf.uid}`);
  // (The Action paid for, as the attack's own answer pays for it. The attack
  // itself is made in the window, and is held to in the played checks below.)
  check('A SHOT CARRIES ONE TOO (ZHRA-101_A): once the Railgun has fired, one Command is on offer',
    [sendAll(s, shot.run.args.before), ids(co(ask()))], [[true], [U.Eagle, U.Ram, U.Zealot].map((x) => `coordinate:${x.uid}`)]);
}
{
  // Two Actions that each carry one: two Commands. A Mech with two blades
  // strikes with each for a Tick.
  const { s, U, at, ask, turnOf, take, endDrone } = stage('d');
  at(U.Wolf, 1, 4, 0);
  turnOf(U.Duelist, 'melee');
  const blade = (id) => ask().options.find((o) => o.id === `attack:${id}:${U.Wolf.uid}`);
  const all = [U.Eagle, U.Ram, U.Zealot].map((x) => `coordinate:${x.uid}`);
  const one = [sendAll(s, blade('ZHLA-101_B').run.args.before), ids(co(ask())), take(ask(), U.Eagle), endDrone(), ids(co(ask()))];
  const second = blade('ZHRA-304_A');
  check('A SECOND ACTION THAT CARRIES ONE ALLOWS A SECOND COMMAND: its first blow struck and its one Command handed out, there is none; its other blade struck (the Tick it has left), one is on offer again, to a Drone that bears no Token yet',
    [one, !!second && sendAll(s, second.run.args.before), ids(co(ask())), s.script.opp.performed], [[[true], all, [true], [true], []], [true], all.slice(1), ['ZHLA-101_B', 'ZHRA-304_A']]);
  check('that one handed out too, it has given two Commands for two Actions, and is offered no third',
    [take(ask(), U.Zealot), endDrone(), ids(co(ask())), held(U.Duelist), [U.Eagle, U.Ram, U.Zealot].map(borne)], [[true], [true], [], 2, [1, 0, 1]]);
  // "May IMMEDIATELY issue": the Command is the last Action's, and goes with it.
  const lapse = stage('d');
  lapse.at(lapse.U.Wolf, 1, 4, 0);
  lapse.turnOf(lapse.U.Duelist, 'melee');
  const struck = sendAll(lapse.s, lapse.ask().options.find((o) => o.id === `attack:ZHLA-101_B:${lapse.U.Wolf.uid}`).run.args.before);
  const open = co(lapse.ask()).length;
  const cast = sendAll(lapse.s, lapse.ask().options.find((o) => o.tags[0] === 'discard').commands);
  check('IT IS HANDED OUT AT ONCE OR NOT AT ALL ("may immediately issue"): the Command its blow allowed is on offer until the Mech does something else; a Discard performed, which carries none, it is gone',
    [struck, open, cast, co(lapse.ask()).length, lapse.s.script.opp.performed], [[true], 3, [true], 0, ['ZHLA-101_B', 'COMMON_DISCARD@rightHand']]);
}
{
  // A Drone Commanded in the Command Phase gives its Token up as that phase
  // ends (4.15.2, which is why it may take another now), and goes on naming
  // the Mech that Commanded it.
  const { s, U, ask, sprint } = stage('g', 0);
  M.L.setLocalSeat('s1');
  s.script.turn = 's1';
  const sent = run(s, { kind: 'designate', seat: 's1', uid: U.Eagle.uid, fromUid: U.Tracer.uid }).ok;
  const during = [borne(U.Eagle), U.Eagle.commandedBy === U.Tracer.uid, held(U.Tracer)];
  M.C.clearDroneCommands(s);
  s.round.phase = 2; s.script.stage = '1:2'; s.script.opp = null; s.script.revealed = ['s1', 's2'];
  for (const t of s.tokens) if (t.kind === 'mech') t.timing = 'firing';
  sprint(U.Tracer, '179_A');
  check('A COMMAND OF THE COMMAND PHASE IS NOT COUNTED AGAINST IT: the Drone the Mech Commanded then has given its Token up and still names the Mech; the Mech\'s Sprint allows its one Command all the same, to that Drone as to the others',
    [sent, during, borne(U.Eagle), U.Eagle.commandedBy === U.Tracer.uid, ids(co(ask())), held(U.Tracer)], [true, [1, true, 3], 0, true, [U.Eagle, U.Ram, U.Zealot].map((x) => `coordinate:${x.uid}`), 3]);
}

// ---------- who may not be commanded, and who may not command ----------
{
  const offered = (change) => {
    const x = stage();
    x.sprint(x.U.Tracer, '179_A');
    change(x.U, x.s);
    return ids(co(x.ask()));
  };
  const all = (U) => [U.Eagle, U.Ram, U.Zealot].map((d) => `coordinate:${d.uid}`);
  const U0 = stage().U;
  check('a Drone that bears a Command Token is not offered (4.15.2: one at a time), nor one off the board, nor one destroyed',
    [offered((U) => { U.Zealot.statuses = [...(U.Zealot.statuses ?? []), 'commandUsed']; }), offered((U) => { U.Ram.deployed = false; }), offered((U) => { U.Eagle.partStates = { ...U.Eagle.partStates, main: 'destroyed' }; }), offered(() => {})],
    [all(U0).slice(0, 2), [all(U0)[0], all(U0)[2]], all(U0).slice(1), all(U0)]);
  check('a Mech with no Command Token left has none to hand out, whatever it has just done',
    offered((U) => { U.Tracer.statuses = (U.Tracer.statuses ?? []).filter((x) => x !== 'command'); }), []);
}

// ---------- the Chariot: up to two ----------
{
  const { s, U, ask, sprint, take, endDrone } = stage();
  // (Four Tokens, so that it is the Data Link's two that stops it and not the
  // two it begins with.)
  U.Chariot.statuses = [...U.Chariot.statuses, 'command', 'command'];
  const moved = sprint(U.Chariot, '180_A');
  const one = ids(co(ask()));
  const took = [take(ask(), U.Eagle), endDrone()];
  const two = ids(co(ask()));
  const again = [take(ask(), U.Ram), endDrone()];
  check('THE CHARIOT (176_A, "Command Coordination may issue up to 2 Commands"): its one Sprint hands out two, to two different Drones, and no third though it has Tokens left',
    [moved.every(Boolean), one.length, took, two, again, ids(co(ask())), held(U.Chariot), [U.Eagle, U.Ram, U.Zealot].map(borne)],
    [true, 3, [[true], [true]], [U.Ram, U.Zealot].map((d) => `coordinate:${d.uid}`), [[true], [true]], [], 2, [1, 1, 0]]);
  void s;
}

// ---------- the Dragoon: after a Maneuver, and the Tactic that is one ----------
{
  const { s, U, ask, turnOf, take, endDrone } = stage();
  const d = turnOf(U.Dragoon, 'tactical');
  check('THE DRAGOON (175_A, the A2K Data Link: "one Command Coordination after Maneuver"): before it has moved no Command is offered for nothing; what is offered is the Tactic that IS one, a Drone each',
    [ids(plain(d)), ids(faces(d))], [[], [U.Eagle, U.Ram, U.Zealot].map((x) => `coordinate:ZHLA-102-T_A:${x.uid}`)]);
  const step = d.options.find((o) => o.tags.includes('maneuver') && !o.tags.includes('pivot'));
  check('after its Maneuver, one for each Drone; and one only',
    [sendAll(s, step.commands).every(Boolean), ids(plain(ask())), take({ options: plain(ask()) }, U.Eagle), endDrone(), ids(plain(ask())), held(U.Dragoon)],
    [true, [U.Eagle, U.Ram, U.Zealot].map((x) => `coordinate:${x.uid}`), [true], [true], [], 1]);
  const swift = stage();
  const sd = swift.turnOf(swift.U.Dragoon, 'swift');
  const stepped = sendAll(swift.s, sd.options.find((o) => o.tags.includes('maneuver') && !o.tags.includes('pivot')).commands);
  const open = plain(swift.ask()).length;
  const cast = sendAll(swift.s, swift.ask().options.find((o) => o.tags[0] === 'discard').commands);
  const then = swift.ask();
  check('and the Command its Maneuver allowed goes when it does something else: having Maneuvered and then Discarded its gun, the Dragoon is offered none for nothing; what it is offered is the Tactic of each of its two Discard faces',
    [stepped.every(Boolean), open, cast, ids(plain(then)), [...new Set(faces(then).map((o) => o.facts.actionId))], faces(then).length], [true, 3, [true], [], ['ZHLA-102-T_A', 'ZHRA-201-T_A'], 6]);
  // The Tactic face.
  const f = stage();
  const tac = faces(f.turnOf(f.U.Dragoon, 'tactical'))[1];
  check('THE TACTIC THAT IS A COORDINATION (ZHLA-102-T_A, the Discard face of a GoF arm: "Give 1 Command Token to 1 Ally Drone") is one whole answer: the Action paid for and the Command sent',
    [tac.id, tac.tags, tac.commands, tac.facts],
    [`coordinate:ZHLA-102-T_A:${f.U.Ram.uid}`, ['coordinate', 'action'], [pays(f.U.Dragoon, 'ZHLA-102-T_A'), hands(f.U.Dragoon, f.U.Ram)], { uid: f.U.Dragoon.uid, actionId: 'ZHLA-102-T_A', targetUid: f.U.Ram.uid }]);
  check('taken, the Drone acts and the Mech has a Token fewer; back with the Mech, the Action it performed has had its one Command, and none is offered for nothing',
    [sendAll(f.s, tac.commands), f.s.script.opp.uid === f.U.Ram.uid, f.endDrone(), f.s.script.opp.uid === f.U.Dragoon.uid, held(f.U.Dragoon), ids(co(f.ask())), f.s.script.opp.performed],
    [[true, true], true, [true], true, 1, [], ['ZHLA-102-T_A']]);
  const kind = stage();
  kind.turnOf(kind.U.Dragoon, 'tactical');
  check('it answers to the kind `coordinate` like the rest: an asker that wants those alone is given it',
    ids(owed(data, kind.s, 's1', newMind(), { only: ['coordinate'] })?.options ?? []), [kind.U.Eagle, kind.U.Ram, kind.U.Zealot].map((x) => `coordinate:ZHLA-102-T_A:${x.uid}`));
  const bare = stage();
  bare.U.Dragoon.statuses = (bare.U.Dragoon.statuses ?? []).filter((x) => x !== 'command');
  const worn = stage();
  worn.U.Ram.statuses = [...(worn.U.Ram.statuses ?? []), 'commandUsed'];
  check('the Tactic is offered only where the engine would take the whole of it: not by a Mech with no Token, and not to a Drone that bears one',
    [ids(faces(bare.turnOf(bare.U.Dragoon, 'tactical'))), ids(faces(worn.turnOf(worn.U.Dragoon, 'tactical')))],
    [[], [worn.U.Eagle, worn.U.Zealot].map((x) => `coordinate:ZHLA-102-T_A:${x.uid}`)]);
}

// ---------- the Warrior: Swarm Tactics ----------
{
  const { s, U, ask, sprint, take, endDrone } = stage();
  sprint(U.Warrior, '180_A');
  check('SWARM TACTICS (172_B: after a Command to a GoF Medium Drone the Token may go on to another Drone): the Warrior\'s one Token to the Eagle leaves it with none, and the Token waits to go on',
    [ids(co(ask())).length, take(ask(), U.Eagle), held(U.Warrior), s.script.swarm], [3, [true], 0, { issuer: U.Warrior.uid, from: U.Eagle.uid }]);
  endDrone();
  const on = ask();
  check('back with the Warrior, a Command to each of the other Drones is offered FOR NOTHING: its one Coordination is handed out and it holds no Token, and the Eagle keeps the Token it was given',
    [on.unit === U.Warrior.uid, ids(co(on)), borne(U.Eagle)], [true, [U.Ram, U.Zealot].map((d) => `coordinate:${d.uid}`), 1]);
  check('taken, the Ram is commanded and the Warrior pays nothing; the Ram is no Medium Drone, so it stops there',
    [take(on, U.Ram), held(U.Warrior), borne(U.Ram), U.Ram.commandedBy === U.Warrior.uid, s.script.swarm ?? null, endDrone(), ids(co(ask()))], [[true], 0, 1, true, null, [true], []]);
  const lapse = stage();
  lapse.sprint(lapse.U.Warrior, '180_A');
  lapse.take(lapse.ask(), lapse.U.Eagle);
  lapse.endDrone();
  const end = lapse.ask().options.find((o) => o.tags.includes('end'));
  check('it goes on at once or not at all: the Warrior ending its Opportunity with the Token waiting lets it lapse, and no seat is asked about it afterwards',
    [!!lapse.s.script.swarm, sendAll(lapse.s, end.commands), lapse.s.script.swarm ?? null, co(lapse.ask('s1')).length, co(lapse.ask('s2')).length], [true, [true], null, 0, 0]);
}

// ---------- only in a Mech's own Action Opportunity ----------
{
  const auto = stage('g', 3);
  const d = auto.turnOf(auto.U.Ram);
  check('a Drone with no Command does not fire: in the Automatic Phase the Ram\'s activation offers no Full-auto, at the same Mech four Grids in front of it',
    [d.kind, d.options.some((o) => o.tags[0] === 'attack')], ['activation.act', false]);
  const { s, U, ask, sprint } = stage();
  sprint(U.Tracer, '179_A');
  const only = (...kinds) => { M.L.setLocalSeat('s1'); return owed(data, s, 's1', newMind(), { only: kinds }); };
  check('`coordinate` is a kind of answer an asker may want alone, and one looking ahead for attacks is given none',
    [ids(only('coordinate').options), co(only('attack', 'move')).length, co(ask()).every((o) => o.tags[0] === 'coordinate')], [[U.Eagle, U.Ram, U.Zealot].map((x) => `coordinate:${x.uid}`), 0, true]);
}

// ---------- a Riposte comes first, and skips it (FAQ 1.04 C7, C8, C9) ----------
{
  const { s, U, at, ask, turnOf } = stage('r');
  at(U.Tracer, 5, 5, 2); at(U.Volcano, 5, 6, 0); at(U.Mire, 11, 11, 0);
  const d = turnOf(U.Tracer, 'melee');
  const blow = d.options.find((o) => o.id === `attack:ZHLA-101_B:${U.Volcano.uid}`);
  sendAll(s, blow.run.args.before);
  // The blow has been parried, and the Grappler may Riposte.
  s.script.reactions = [{ uid: U.Volcano.uid, actionId: '050_B', count: 0, range: 0, kind: 'riposte', fromUid: U.Tracer.uid }];
  check('THE DEFENDER\'S RIPOSTE IS ANSWERED FIRST (C7): while it is owed the attacker is asked nothing, so its Coordination is not on offer yet',
    [ask('s1'), ask('s2')?.kind], [null, 'reaction.answer']);
  const left = clone(s);
  M.L.setLocalSeat('s2');
  const declined = sendAll(left, owed(data, left, 's2', newMind()).options.find((o) => o.id === 'decline').commands);
  M.L.setLocalSeat('s1');
  const offered = owed(data, left, 's1', newMind());
  check('DECLINED, the attack is over and the Coordination its Action carried is offered (C9)',
    [declined.every(Boolean), offered.kind, offered.unit === U.Tracer.uid, co(offered).length], [true, 'opp.act', true, 3]);
  const taken = sendAll(s, ask('s2').options.find((o) => o.id === 'riposte:end').commands);
  const after = ask('s1');
  check('TAKEN, IT ENDS THE ATTACKER\'S OPPORTUNITY AT ONCE AND THE COORDINATION IS SKIPPED (C8): the Mech is not asked again, and no Command is on offer to anybody',
    [taken.every(Boolean), s.script.opp?.uid === U.Tracer.uid, after?.unit === U.Tracer.uid, co(after).length, co(ask('s2')).length, held(U.Tracer)], [true, false, false, 0, 0, 4]);
}

// ---------- what the Tactician makes of it ----------
M.L.setLocalSeat(null);
{
  const viewOf = (state, seat) => M.SEAT.viewOf(data, state, seat);
  const SK = { focus: false };
  const tact = AI.makeTactician(SK);
  // Two drivers at a table that has been set up, the units then stood where
  // the check wants them: the first squad along the north edge, the second in
  // the far corner.
  const staged = async (table, arrange, policies = { s1: tact, s2: AI.eagerPolicy }) => {
    const t = botTable(M, data, { ...TABLES[table], map: 'none' }, { seed: 3, policies, glue: M.HUD.glueAfter });
    await t.run({ until: (st) => M.SU.normaliseSetup(st.setup)?.stage === 'done' });
    const s = t.state;
    const U = Object.fromEntries(s.tokens.map((x) => [name(x), x]));
    const at = (x, c, r, f) => { x.col = c * 3; x.row = r * 3; if (f !== undefined) x.facing = f; };
    s.tokens.filter((x) => x.side === 's1').forEach((x, i) => at(x, i, 0, 2));
    s.tokens.filter((x) => x.side === 's2').forEach((x, i) => at(x, 11 - i, 11, 0));
    const sc = s.script;
    const turnOf = (mech, timing) => {
      s.round.phase = 2; sc.stage = '1:2'; sc.opp = null; sc.revealed = ['s1', 's2']; sc.passed = [];
      for (const x of s.tokens) if (x.kind === 'mech') x.timing = 'firing';
      mech.timing = timing;
      sc.acted = s.tokens.filter((x) => x.kind === 'mech' && x.uid !== mech.uid).map((x) => x.uid);
      return M.G.opportunity(data, s);
    };
    arrange({ s, U, at, turnOf });
    return { t, s, U, d: t.drivers.s1.pending() };
  };
  // What each Drone would gain by a Command, as the price list has it: its
  // best plan with one, over its standing where it is and doing nothing.
  const gains = (d, view, skills = SK) => co(d).map((o) => {
    const rows = AI.weighed(o.then(), view, skills);
    const stay = rows.find((p) => p.how === 'stay');
    return { id: o.id, gain: rows[0].worth - (stay.worth - stay.now), best: rows[0].how, does: rows[0].does };
  });
  const top = (list) => list.reduce((a, b) => (b.gain > a.gain + 1e-9 ? b : a));
  const told = (x, steps) => (seat, r) => steps.push(`${seat}:${r.option.id}:${x.t.drivers[seat].log.at(-1)?.reason ?? ''}`);
  const over = (unit) => (st) => st.script.opp === null || (st.script.opp.uid !== unit.uid && !(st.script.oppStack ?? []).length);

  // The Tracer shoots, and then hands a Command to the Drone that gains most.
  const fire = ({ U, at, turnOf }) => { at(U.Tracer, 5, 5, 2); at(U.Ram, 4, 6, 2); at(U.Wolf, 5, 9, 0); turnOf(U.Tracer, 'firing'); };
  const x = await staged('g', fire);
  const steps = [];
  await x.t.run({ until: () => co(x.t.drivers.s1.pending()).length > 0, maxSteps: x.t.steps() + 40, onStep: told(x, steps) });
  const d = x.t.drivers.s1.pending();
  const view = viewOf(x.s, 's1');
  const list = gains(d, view);
  const pick = tact.choose(d, view, new AI.Rng('pick'));
  const next = co(d)[0].then();
  check('as a driver puts the question, each answer says what would be asked next, on a copy of the table: the Drone\'s own turn; the table in play is not touched',
    [next?.kind, next?.unit === co(d)[0].facts.targetUid, held(x.U.Tracer), [x.U.Eagle, x.U.Ram, x.U.Zealot].map(borne)], ['opp.act', true, 4, [0, 0, 0]]);
  // (Since 2026-10-04 the Tracer takes Defensive Stance first: the seam's reach look reads the Wolf's
  // rifle held two-handed, two Grids further, and the Grid the Tracer shoots from costs it more. A Stance
  // is no Action: the attack is still the one Action, and the Coordination its shot carried.)
  const shot = steps.findIndex((y) => y.startsWith('s1:attack:'));
  check('PLAYED BY THE TACTICIAN: with an enemy in its sights the Tracer attacks (a Stance taken first, if any), the attack is rolled out in its window, and only then is the Coordination its shot carried on offer (FAQ 1.04 C9)',
    [shot >= 0 && steps[shot].startsWith(`s1:attack:ZHRA-101_`), shot >= 0 && steps[shot].endsWith(':attack_value') && steps.slice(0, shot).every((y) => /^s1:stance:/.test(y)), steps.some((y) => y.startsWith('s2:defense.roll')), x.s.script.opp.performed.length, x.s.script.combatView ?? null, co(d).length],
    [true, true, true, 1, null, 3]);
  check('IT IS WEIGHED BEFORE ANYTHING ELSE, AND GOES TO THE DRONE THAT GAINS MOST BY ACTING NOW: what a Command adds is the Drone\'s best plan with it over its doing nothing, as a Command in the Command Phase is priced',
    [pick.option === top(list).id, pick.reason, Math.abs(pick.score - top(list).gain) < 1e-6, top(list).gain > 0, list.every((g) => g.gain > 0)], [true, 'coordinate_by_value', true, true, true]);
  await x.t.run({ until: over(x.U.Tracer), maxSteps: x.t.steps() + 60, onStep: told(x, steps) });
  const commanded = x.s.tokens.find((u) => `coordinate:${u.uid}` === pick.option);
  check('and its Opportunity played out hands that Command over, the Drone acts on it, and the Mech then ends: nothing refused',
    [steps.includes(`s1:${pick.option}:coordinate_by_value`), borne(commanded), commanded.commandedBy === x.U.Tracer.uid, held(x.U.Tracer), steps.filter((y) => /^s1:coordinate:/.test(y)).length, x.t.refused], [true, 1, true, 3, 1, []]);
  x.t.close();

  const off = await staged('g', fire, { s1: AI.makeTactician({ ...SK, coordinate: false }), s2: AI.eagerPolicy });
  const plainSteps = [];
  await off.t.run({ until: over(off.U.Tracer), maxSteps: off.t.steps() + 60, onStep: told(off, plainSteps) });
  check('with its skill off (`coordinate`) the same Opportunity hands out nothing: the Tokens stay on the Mech and no Drone acts; and the policies with no rule for it never take one',
    [plainSteps.some((y) => /^s1:coordinate:/.test(y)), plainSteps.some((y) => y.startsWith('s1:attack:')), held(off.U.Tracer), [off.U.Eagle, off.U.Ram, off.U.Zealot].map(borne), off.t.refused,
      [AI.brawlerPolicy, AI.eagerPolicy].map((p) => d.options.find((o) => o.id === p.choose(d, view, new AI.Rng('x')).option).tags[0] === 'coordinate')],
    [false, true, 4, [0, 0, 0], [], [false, false]]);
  off.t.close();

  // Where no Drone gains, the Token is kept.
  const idle = await staged('g', ({ s, U, at, turnOf }) => {
    at(U.Tracer, 5, 5, 2); at(U.Wolf, 5, 9, 0);
    for (const dr of [U.Eagle, U.Ram, U.Zealot]) dr.statuses = [...(dr.statuses ?? []), 'immobilized'];
    turnOf(U.Tracer, 'firing');
    M.L.setLocalSeat('s1');
    const shot = owed(data, s, 's1', newMind()).options.find((o) => o.id === `attack:ZHRA-101_A:${U.Wolf.uid}`);
    for (const cmd of shot.run.args.before) run(s, cmd);
  });
  const none = gains(idle.d, viewOf(idle.s, 's1'));
  const kept = tact.choose(idle.d, viewOf(idle.s, 's1'), new AI.Rng('pick'));
  check('WHERE NO DRONE WOULD GAIN THE TOKEN IS KEPT: with every Drone Immobilized and out of reach of anything, a Command is on offer to each, each would gain nothing, and the Mech goes on with its own turn',
    [co(idle.d).length, none.map((g) => Math.abs(g.gain) < 1e-9), kept.reason === 'coordinate_by_value', idle.d.options.find((o) => o.id === kept.option).tags[0] === 'coordinate'], [3, [true, true, true], false, false]);
  idle.t.close();

  // The Tactic that is a Coordination is a deed like another.
  const give = ({ U, at, turnOf }) => { at(U.Dragoon, 5, 5, 2); at(U.Ram, 4, 6, 2); at(U.Wolf, 5, 9, 0); turnOf(U.Dragoon, 'tactical'); };
  const drag = await staged('g', give);
  const rows = AI.weighed(drag.d, viewOf(drag.s, 's1'), SK);
  const stay = rows.find((p) => p.how === 'stay');
  const deed = tact.choose(drag.d, viewOf(drag.s, 's1'), new AI.Rng('pick'));
  const faceGains = faces(drag.d).map((o) => { const r = AI.weighed(o.then(), viewOf(drag.s, 's1'), SK); const st = r.find((p) => p.how === 'stay'); return { id: o.id, gain: r[0].worth - (st.worth - st.now) }; });
  check('THE TACTIC THAT IS A COORDINATION IS A DEED BESIDE AN ATTACK, worth what the Drone it commands gains by acting now: where the Dragoon stands it is the deed it would make, for the Drone that gains most',
    [/Command Coordination, a Command to/.test(stay.does), Math.abs(stay.now - top(faceGains).gain) < 1e-6, stay.now > 0, plain(drag.d).length], [true, true, true, 0]);
  const dragSteps = [];
  await drag.t.run({ until: over(drag.U.Dragoon), maxSteps: drag.t.steps() + 60, onStep: told(drag, dragSteps) });
  check('and its Opportunity played out performs it: the Action and the Command in one answer, the Drone\'s turn, and nothing refused',
    [deed.option === top(faceGains).id, deed.reason, dragSteps[0] === `s1:${deed.option}:coordinate_by_value`, drag.s.tokens.filter((u) => u.kind === 'drone' && borne(u) === 1).length, held(drag.U.Dragoon) < 2, drag.t.refused],
    [true, 'coordinate_by_value', true, dragSteps.filter((y) => /^s1:coordinate:/.test(y)).length, true, []]);
  drag.t.close();
  // The Tactic costs the Mech its Action, so it is weighed against the rest of
  // the turn, where a Command for nothing is taken before anything else.
  const dear = await staged('g', ({ U, at, turnOf }) => {
    at(U.Dragoon, 5, 5, 2); at(U.Ram, 4, 6, 2); at(U.Wolf, 5, 9, 0);
    for (const dr of [U.Eagle, U.Ram, U.Zealot]) dr.statuses = [...(dr.statuses ?? []), 'immobilized'];
    turnOf(U.Dragoon, 'tactical');
  });
  const dearRows = AI.weighed(dear.d, viewOf(dear.s, 's1'), SK);
  const dearStay = dearRows.find((p) => p.how === 'stay');
  const first = tact.choose(dear.d, viewOf(dear.s, 's1'), new AI.Rng('pick'));
  // (Since `restance`, M8.2q, a Stance taken first may be worth most: Defensive
  // no longer seems to cost the next turn's shot.)
  check('and it is weighed against the rest of the turn, as an Action is: with Drones that can only fire from where they stand, the Tactic is still the deed it would make standing there, a plan of the rest of the turn is worth more, and that is made first',
    [/Command Coordination, a Command to/.test(dearStay.does), dearStay.now > 0, ['move', 'stance'].includes(dearRows[0].how), ['move', 'stance'].includes(dear.d.options.find((o) => o.id === first.option).tags[0]), first.reason === 'coordinate_by_value'],
    [true, true, true, true, false]);
  dear.t.close();
  const noDeed = await staged('g', give, { s1: AI.makeTactician({ ...SK, coordinate: false }), s2: AI.eagerPolicy });
  const without = AI.weighed(noDeed.d, viewOf(noDeed.s, 's1'), { ...SK, coordinate: false }).find((p) => p.how === 'stay');
  check('with the skill off the Tactic is no deed of its: standing there it would do nothing', [without.does, without.now], ['', 0]);
  noDeed.t.close();

  // THE COMMAND PHASE: a Command is credited with the Action the Drone makes
  // where it stands, not only with where it would go.
  const orders = async (place) => {
    const y = await staged('c', ({ U, at }) => place(U, at));
    const v = viewOf(y.s, 's1');
    const byDrone = y.d.options.filter((o) => o.tags.includes('designate')).map((o) => {
      const r = AI.weighed(o.then(), v, SK);
      const st = r.find((p) => p.how === 'stay');
      return { id: o.id, unit: name(y.s.tokens.find((u) => u.uid === o.then().unit)), best: r[0].how, fires: st.now > 0, gain: r[0].worth - (st.worth - st.now), moved: r[0].worth - st.worth };
    });
    const on = tact.choose(y.d, v, new AI.Rng('pick'));
    const was = AI.makeTactician({ ...SK, orders: false }).choose(y.d, v, new AI.Rng('pick'));
    y.t.close();
    return { kind: y.d.kind, byDrone, on, was };
  };
  const both = await orders((U, at) => { at(U.Tracer, 0, 0, 2); at(U.Ram, 2, 5, 2); at(U.Ballista, 0, 1, 2); at(U.Wolf, 2, 9, 0); });
  const bestOf = top(both.byDrone);
  check('IN THE COMMAND PHASE A DRONE WHOSE BEST USE IS TO FIRE FROM WHERE IT STANDS IS COMMANDED: with a shot for each of two Drones and no better Grid for either, the Command goes to the one whose shot is worth most',
    [both.kind, both.byDrone.map((g) => [g.unit, g.best, g.fires]), both.on.option === bestOf.id, both.on.reason, Math.abs(both.on.score - bestOf.gain) < 1e-6],
    ['loop.designate.command', [['Ram', 'stay', true], ['Ballista', 'stay', true]], true, 'command_by_value', true]);
  check('which the rule of M7 did not do: it took the shot for something the Drone does unbidden, and withheld the Command (the switch `orders`, off)',
    [both.was.option, both.was.reason], ['pass', 'command_withheld']);
  const near = await orders((U, at) => { at(U.Tracer, 0, 0, 2); at(U.Ram, 11, 11, 3); at(U.Ballista, 0, 1, 2); at(U.Wolf, 9, 11, 1); });
  const ram = near.byDrone.find((g) => g.unit === 'Ram');
  const ballista = near.byDrone.find((g) => g.unit === 'Ballista');
  check('and of a Drone with a shot where it stands and a Drone with somewhere better to be, the one that gains more is commanded; the old rule sent the other to walk',
    [[ram.best, ram.fires], [ballista.best, ballista.fires], ram.gain > ballista.gain, near.on.option === ram.id, near.was.option === ballista.id, near.was.reason, Math.abs(near.was.score - ballista.moved) < 1e-6],
    [['stay', true], ['move', false], true, true, true, 'command_by_value', true]);
}

// ---------- whole games ----------
M.L.setLocalSeat(null);
{
  const tally = { games: 0, over: 0, refused: 0, broken: [], handed: 0, free: 0, beyond: [], afterAttack: 0 };
  // The scripted seat takes a Coordination whenever one is offered and draws
  // by lot otherwise: the count is held to in play nobody planned.
  const keen = {
    name: 'keen',
    choose(d, view, rng) {
      const mine = co(d);
      return mine.length ? { option: mine[rng.int(mine.length)].id, why: 'scripted' } : AI.legalPolicy.choose(d, view, rng);
    },
  };
  const POLICIES = { keen, legal: AI.legalPolicy, eager: AI.eagerPolicy, brawler: AI.brawlerPolicy, tactician: AI.tacticianPolicy };
  for (const [table, policy, seeds] of [['g', 'keen', [1, 2, 3]], ['m', 'keen', [1, 2]], ['g', 'legal', [1]], ['g', 'eager', [1]], ['g', 'brawler', [1]], ['g', 'tactician', [1]], ['m', 'tactician', [1]]]) {
    for (const seed of seeds) {
      const t = botTable(M, data, TABLES[table], { seed, policies: POLICIES[policy], glue: M.HUD.glueAfter });
      // What each Mech has done this round that carries Coordination, and
      // what it has handed out: a Command that costs it a Token is one of its
      // own; one that costs nothing is Swarm Tactics going on.
      const allowed = new Map();
      const used = new Map();
      const tokens = new Map();
      const keyOf = (uid) => `${t.state.round.n}:${uid}`;
      const count = () => { for (const u of t.state.tokens) if (u.kind === 'mech') tokens.set(u.uid, held(u)); };
      count();
      t.watch((cmd) => {
        const mech = t.state.tokens.find((u) => u.uid === cmd.uid);
        if (cmd.kind === 'performAction' && mech?.kind === 'mech') {
          const a = M.U.tokenCards(data, mech).flatMap(({ card }) => card.actions ?? []).find((x) => x.id === cmd.actionId);
          const n = a ? M.U.coordinationFor(data, mech, a) : 0;
          if (n > 0) { allowed.set(keyOf(mech.uid), (allowed.get(keyOf(mech.uid)) ?? 0) + n); if (a.type === 'Firing' || a.type === 'Melee') tally.afterAttack += 1; }
        }
        if (cmd.kind === 'maneuver' && !cmd.free && !cmd.granted && mech?.kind === 'mech') {
          const n = M.U.coordinationAfterManeuver(data, mech);
          if (n > 0) allowed.set(keyOf(mech.uid), (allowed.get(keyOf(mech.uid)) ?? 0) + n);
        }
        if (cmd.kind === 'coordinateCommand') {
          if (held(mech) < tokens.get(mech.uid)) {
            tally.handed += 1;
            used.set(keyOf(mech.uid), (used.get(keyOf(mech.uid)) ?? 0) + 1);
            if (used.get(keyOf(mech.uid)) > (allowed.get(keyOf(mech.uid)) ?? 0)) tally.beyond.push(`${table} ${policy} ${seed}: ${mech.label}, round ${t.state.round.n}: ${used.get(keyOf(mech.uid))} handed out, ${allowed.get(keyOf(mech.uid)) ?? 0} allowed`);
          } else tally.free += 1;
        }
        count();
      });
      let end;
      try { end = await t.run({ maxSteps: 16000 }); } catch (err) { end = { kind: 'threw', why: `${err?.message ?? err}`.split('\n')[0] }; } finally { t.close(); }
      tally.games += 1;
      if (end.kind === 'over') tally.over += 1; else tally.broken.push(`${table} ${policy} ${seed}: ${end.kind} ${end.why ?? ''} ${end.decision ?? ''}`);
      tally.refused += t.refused.length;
    }
  }
  check('TEN GAMES with GoF squads in them, two of them GoF against GoF, on the page\'s glue, five policies: every one ends as a game should, nothing refused',
    [tally.over, tally.games, tally.refused, tally.broken], [10, 10, 0, []]);
  check('Commands were handed out in them by Coordination, some for nothing by Swarm Tactics, and IN NO ROUND DID A MECH HAND OUT MORE THAN WHAT IT HAD DONE ALLOWED',
    [tally.handed > 20, tally.free > 0, tally.beyond], [true, true, []]);
  console.log(`       handed out ${tally.handed}, for nothing ${tally.free}; attacks made that carried one: ${tally.afterAttack}`);
}

console.log(`\n${pass} passed, ${fail} failed`);
M.L.setLocalSeat(null);
if (fail) process.exit(1);
