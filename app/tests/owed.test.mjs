// What a seat owes (src/owed.ts): the one question, with every legal answer.
//
// owed(data, state, seat, mind) is the whole of what a computer player is told
// about whose move it is and what may be done (AI-OPPONENT-PLAN.md, rule R2).
// botgame.test.mjs proves two seats can finish a game on it; this walks it a
// stage at a time on the real engine and pins what each question is, who is
// asked, and what the answers send, so that a change to the rules which
// changes an answer changes it HERE first.
import { loadEngine, freshState, tableAtRoundOne, tableCommands } from './_engine.mjs';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}\n       got  ${g}`); }
};

console.log('What a seat owes\n');

const { M, data } = await loadEngine('owed', ["export * as SEAT from '../src/seat';", "export * as TURN from '../src/turn';"]);
const { owed, newMind, gameOver } = M.SEAT;
const [alley, vip] = data.solo.scenarios;
const other = (s) => (s === 's1' ? 's2' : 's1');
const clone = (x) => JSON.parse(JSON.stringify(x));
const name = (t) => (t.label.startsWith('ADK15P') ? 'Porcupine' : t.label.startsWith('ADK60S') ? 'Raven' : t.label.startsWith('ADK30C') ? 'Tarantula' : t.label);

// One command the way a table takes it, the turn bookkeeping after it.
const run = (state, cmd) => {
  const v = M.C.check(data, state, cmd);
  if (v.ok) { M.C.apply(data, state, cmd); M.G.glueAfter(data, state, cmd); }
  return v;
};
// Takes the option a question offers under this id, and says whether it went.
const take = (state, d, id) => {
  const o = d?.options.find((x) => x.id === id);
  if (!o?.commands) return false;
  return o.commands.every((c) => run(state, c).ok);
};
const ids = (d) => (d ? d.options.map((o) => o.id) : null);
const asked = (state, mind = {}) => ['s1', 's2'].map((seat) => owed(data, state, seat, mind[seat] ?? newMind())?.kind ?? null);
// Every command-carrying option of a question, applied to a copy: all taken.
const allTaken = (state, d) => d.options.filter((o) => o.commands && !M.G.tableAfter(data, state, o.commands)).map((o) => o.id);

// The host builds the table while no seat is held; from then on s1 is the
// page's own seat, as in a game against the computer.
function table(scenario, over = {}) {
  M.L.setLocalSeat(null);
  const state = freshState(M, data);
  for (const cmd of tableCommands(M, data, { ...scenario, secondaries: !!over.secondaries })) M.C.perform(data, state, cmd);
  for (const seat of ['s1', 's2']) {
    const sq = data.solo.squads[scenario.seats[seat]];
    M.C.perform(data, state, { kind: 'importSquad', seat, name: sq.name, mechs: sq.mechs, drones: sq.drones });
  }
  const start = { kind: 'startMatch', seat: 's1' };
  M.C.perform(data, state, start);
  M.G.glueAfter(data, state, start);
  M.L.setLocalSeat('s1');
  return state;
}

// ---------- setup (3.1) ----------
{
  const s = table(vip);
  check('the battlefield is the host\'s to lock, and nobody else is asked anything', [asked(s), ids(owed(data, s, 's1', newMind()))], [['setup.lock', null], ['lock']]);
  take(s, owed(data, s, 's1', newMind()), 'lock');
  const roll = owed(data, s, 's2', newMind());
  check('then both squads roll for First Player, with the table\'s dice', [asked(s), roll.options.map((o) => o.run)], [['setup.roll', 'setup.roll'], [{ routine: 'rollSetup', args: { dice: 2 } }]]);
  run(s, { kind: 'rollSetup', seat: 's1', hits: [1, 0] });
  check('a squad that has rolled waits for the other', asked(s), [null, 'setup.roll']);
  run(s, { kind: 'rollSetup', seat: 's2', hits: [0, 1] });
  check('a tie is rolled again, by both', asked(s), ['setup.roll', 'setup.roll']);
  run(s, { kind: 'rollSetup', seat: 's1', hits: [1, 1] });
  run(s, { kind: 'rollSetup', seat: 's2', hits: [0, 1] });
  check('the winner takes the game on; the other squad is told', asked(s), ['setup.accept', null]);
  take(s, owed(data, s, 's1', newMind()), 'accept');
  const edge = owed(data, s, 's1', newMind());
  check('the First Player picks its table edge: two answers, each tagged with the edge it takes',
    [asked(s), edge.options.map((o) => [o.id, o.tags]), edge.fallback], [['setup.edge', null], [['edge:black', ['edge', 'edge:black']], ['edge:white', ['edge', 'edge:white']]], 'edge:black']);
  take(s, edge, 'edge:black');
  // The Tasks step: this mission wants a Commander of each squad.
  const lead = owed(data, s, 's1', newMind());
  check('a Task that names a unit asks its squad which: one answer per Mech of its own',
    [lead.kind, lead.options.map((o) => o.commands[0].uid).sort(), lead.options.every((o) => s.tokens.find((t) => t.uid === o.commands[0].uid).side === 's1' && o.commands[0].what === 'leader')],
    ['setup.designate.leader', s.tokens.filter((t) => t.side === 's1' && t.kind === 'mech').map((t) => t.uid).sort(), true]);
  check('and every one of them is a command the engine takes', allTaken(s, lead), []);
  take(s, lead, lead.options[0].id);
  const lead2 = owed(data, s, 's2', newMind());
  check('then the other squad names its own', [lead2.kind, lead2.options.length], ['setup.designate.leader', 1]);
  take(s, lead2, lead2.options[0].id);
  check('with every name given, the First Player closes the Tasks step', [asked(s), ids(owed(data, s, 's1', newMind()))], [['setup.tasks', null], ['done']]);
  take(s, owed(data, s, 's1', newMind()), 'done');
  // Deployment.
  const su = () => M.SU.normaliseSetup(s.setup);
  const first = M.SU.deployTurn(s, su(), data);
  const dep = owed(data, s, first, newMind());
  const mine = M.SU.deployable(s, first, data);
  const zone = [...M.TK.deployGrids(data.zoneData, s, su().edge[first])];
  check('deployment is asked of the squad whose turn it is to place', [dep.kind, owed(data, s, other(first), newMind())], ['setup.deploy', null]);
  // A Grid terrain fills has no room for a base that does not fit beside it.
  const terrain = M.TURN.terrainOf(data, s);
  const fits = (t) => zone.filter((k) => { const [c, r] = k.split(',').map(Number); return !!M.R.standingSpot(c, r, t.size, t.aerial, terrain, s.tokens, t.uid); }).length;
  check('one answer per unit, per free Grid of its own zone it fits in, and per Stance for a Mech',
    [dep.options.length, new Set(dep.options.map((o) => o.commands[0].uid)).size, zone.length, mine.every((t) => fits(t) > 12)],
    [mine.reduce((n, t) => n + fits(t) * (t.kind === 'mech' ? 3 : 1), 0), mine.length, 24, true]);
  check('every one lands the unit inside its zone, facing the other squad\'s, and the engine takes it',
    [dep.options.every((o) => zone.includes(`${Math.floor(o.commands[0].to.col / 3)},${Math.floor(o.commands[0].to.row / 3)}`)),
      [...new Set(dep.options.map((o) => o.commands[0].facing))], allTaken(s, dep)], [true, [first === 's1' ? 2 : 0], []]);
  check('a question that names no safe answer of its own takes the first it offers', [dep.fallback, dep.options[0].id === dep.fallback], [dep.options[0].id, true]);
  check('an answer says where it puts the unit, for a reader that never opens the command',
    [dep.options[0].facts.uid === dep.options[0].commands[0].uid, typeof dep.options[0].facts.to.c, dep.options[0].tags.includes('deploy')], [true, 'number', true]);
  // A Grid taken is a Grid no longer offered.
  const o0 = dep.options[0];
  take(s, dep, o0.id);
  const next = M.SU.deployTurn(s, su(), data);
  const dep2 = owed(data, s, next, newMind());
  const taken = `${Math.floor(o0.commands[0].to.col / 3)},${Math.floor(o0.commands[0].to.row / 3)}`;
  check('the turn passes, and a unit is never offered a Grid another stands in', [next === other(first) || mine.length > 1, dep2.options.some((o) => o.facts.uid === o0.commands[0].uid)], [true, false]);
  void taken;
  // A Stance is a Mech's. The engine would take a Drone deployed with one, so
  // it is the question that keeps it to one answer per Grid.
  const droneSeat = ['s1', 's2'].find((x) => M.SU.deployable(s, x, data).some((t) => t.kind !== 'mech'));
  const drones = M.SU.deployable(s, droneSeat, data).filter((t) => t.kind !== 'mech').map((t) => t.uid);
  const theirs2 = (droneSeat === next ? dep2 : owed(data, s, droneSeat, newMind()));
  check('a Drone is deployed with no Stance: one answer per Grid it fits in',
    [droneSeat === next, drones.length > 0, theirs2.options.filter((o) => drones.includes(o.facts.uid)).every((o) => !('stance' in o.commands[0]) && !('stance' in o.facts) && o.tags.length === 1),
      theirs2.options.filter((o) => o.facts.uid === drones[0]).length, new Set(theirs2.options.filter((o) => o.facts.uid === drones[0]).map((o) => `${o.facts.to.c},${o.facts.to.r}`)).size > 12],
    [true, true, true, new Set(theirs2.options.filter((o) => o.facts.uid === drones[0]).map((o) => `${o.facts.to.c},${o.facts.to.r}`)).size, true]);
  // Everything placed: the ready pair.
  for (let guard = 0; guard < 20 && !M.SU.deploymentComplete(s, data); guard++) {
    const seat = M.SU.deployTurn(s, su(), data);
    const d = owed(data, s, seat, newMind());
    take(s, d, d.options[0].id);
  }
  check('with every unit placed, each squad says its deployment is final', [asked(s), ids(owed(data, s, 's2', newMind())), owed(data, s, 's2', newMind()).options[0].commands.map((c) => c.kind)],
    [['setup.ready', 'setup.ready'], ['ready'], ['setReady']]);
  take(s, owed(data, s, 's2', newMind()), 'ready');
  check('the second to say so begins Round 1 in the same breath; the first has nothing left to say',
    [asked(s), owed(data, s, 's1', newMind()).options[0].commands.map((c) => c.kind)], [['setup.ready', null], ['setReady', 'finishDeployment']]);
  take(s, owed(data, s, 's1', newMind()), 'ready');
  check('and the game is on: Round 1, the Command Phase', [su().stage, s.round.n, s.round.phase], ['done', 1, 0]);
  M.L.setLocalSeat(null);
}
{
  // A table that plays Secondary Tasks asks for them, the First Player first.
  const s = table(alley, { secondaries: true });
  run(s, { kind: 'lockMap', seat: 's1' });
  run(s, { kind: 'acceptRoll', seat: 's1', first: 's2' });
  run(s, { kind: 'pickEdge', seat: 's2', edge: 'white' });
  const sec = owed(data, s, 's2', newMind());
  check('a table that plays Secondary Tasks asks each squad for one, the First Player first',
    [asked(s), sec.options.length, sec.options[0].commands[0].kind], [[null, 'setup.secondary'], data.secondary.length, 'pickSecondary']);
  check('a question with no answers is not asked: with no Secondary Task to pick from, the squad waits', owed({ ...data, secondary: [] }, s, 's2', newMind()), null);
  take(s, sec, sec.options[0].id);
  check('then the other squad', asked(s), ['setup.secondary', null]);
  M.L.setLocalSeat(null);
}
{
  const s = table(alley);
  run(s, { kind: 'lockMap', seat: 's1' });
  run(s, { kind: 'acceptRoll', seat: 's1', first: 's1' });
  run(s, { kind: 'pickEdge', seat: 's1', edge: 'black' });
  check('a table that plays none goes straight to closing the Tasks step', asked(s), ['setup.tasks', null]);
  M.L.setLocalSeat(null);
}

// ---------- a game on the table: Round 1, the Command Phase ----------
const base = (() => {
  const t = tableAtRoundOne(M, data, alley);
  if (t.refused.length) throw new Error(t.refused.join('; '));
  return t.state;
})();
const stage = (phase) => {
  const s = clone(base);
  s.map = 'none';
  const U = Object.fromEntries(s.tokens.map((t) => [name(t), t]));
  const at = (t, c, r, f) => { t.col = c * 3; t.row = r * 3; if (f !== undefined) t.facing = f; };
  at(U.Mire, 5, 4, 1); at(U.Dune, 0, 0, 2); at(U['Wild Cat'], 8, 4, 3); at(U.Porcupine, 5, 8, 0); at(U.Raven, 6, 4, 3); at(U.Tarantula, 11, 4, 0);
  if (phase !== undefined) { s.round.phase = phase; s.script.stage = `1:${phase}`; s.script.acted = []; s.script.passed = []; s.script.opp = null; }
  if (phase === 2) { s.script.revealed = ['s1', 's2']; for (const t of s.tokens) if (t.kind === 'mech') t.timing = 'firing'; }
  // The Action Opportunity of one Mech, the others having had theirs.
  const turnOf = (mech, timing, over = {}) => {
    mech.timing = timing ?? mech.timing;
    s.script.acted = s.tokens.filter((x) => x.kind === 'mech' && x.uid !== mech.uid).map((x) => x.uid);
    s.script.opp = null;
    const o = M.G.opportunity(data, s);
    Object.assign(o, over);
    return o;
  };
  // A Drone's activation.
  const activate = (unit) => { s.script.opp = M.TY.newOpportunity(unit.uid, undefined); return s.script.opp; };
  return { s, U, at, turnOf, activate };
};
M.L.setLocalSeat('s1');
{
  const { s, U } = stage();
  // RDL holds no Drone, so whoever is First Player it is the UN squad that
  // has something to Command.
  const d = owed(data, s, 's2', newMind());
  const drones = M.L.eligibleUnits(s, 'Command', 's2', data);
  check('in the Command Phase the squad with a Drone to Command designates one or passes; a squad with none is asked nothing',
    [d.kind, d.fallback, owed(data, s, 's1', newMind()), d.options.filter((o) => o.tags.includes('designate')).map((o) => o.facts.uid).sort(), drones.length > 0],
    ['loop.designate.command', 'pass', null, drones.map((t) => t.uid).sort(), true]);
  check('every answer is one the engine takes', allTaken(s, d), []);
  // s2 holds the Drones: its designation opens the Drone's activation.
  const seat = 's2';
  take(s, d, `designate:${U.Porcupine.uid}`);
  const act = owed(data, s, seat, newMind());
  const kinds = [...new Set(act.options.map((o) => o.tags[0]))].sort();
  check('a commanded Drone moves, or performs its Command Action, or ends its activation',
    [act.kind, act.unit, kinds, act.fallback], ['activation.act', U.Porcupine.uid, ['charge', 'end', 'move'], 'end']);
  check('its Charge is its own Action, paid as it stands', act.options.find((o) => o.tags.includes('charge')).commands, [{ kind: 'performAction', seat: 's2', uid: U.Porcupine.uid, actionId: '543_B', partKey: '543_B' }]);
  const moves = act.options.filter((o) => o.tags.includes('move'));
  const reach = M.TURN.reachableFor(data, s, U.Porcupine).filter((g) => !(g.c === 5 && g.r === 8));
  check('its Movement: every Grid its card reaches, ended on each of four facings, and a turn on the spot',
    [moves.filter((o) => !o.tags.includes('pivot')).length, moves.filter((o) => o.tags.includes('pivot')).length, moves.every((o) => o.commands.length === 1 && o.commands[0].kind === 'maneuver')],
    [reach.length * 4, 3, true]);
  check('the other squad is asked nothing while it acts', owed(data, s, 's1', newMind()), null);
  const m = moves.find((o) => !o.tags.includes('pivot'));
  take(s, act, m.id);
  check('having moved, it has spent its activation: only the end is left', ids(owed(data, s, seat, newMind())), ['end']);
  take(s, owed(data, s, seat, newMind()), 'end');
  check('and the designation goes back and forth until both pass', owed(data, s, s.script.turn, newMind()).kind, 'loop.designate.command');
}

// ---------- Planning (3.3) ----------
{
  const s = clone(base);
  for (const seat of ['s1', 's2']) run(s, { kind: 'passTurn', seat });
  for (const seat of ['s1', 's2']) run(s, { kind: 'setReady', seat, ready: true });
  run(s, { kind: 'advancePhase', seat: 's2' });
  const mind = { s1: newMind(), s2: newMind() };
  const d = owed(data, s, 's1', mind.s1);
  const mechs = s.tokens.filter((t) => t.side === 's1' && t.kind === 'mech');
  check('in the Planning Phase a squad is asked a dial for each of its Mechs, one at a time',
    [s.round.phase, d.kind, d.unit, d.options.map((o) => o.id), d.options[0].run], [1, 'planning.dial', mechs[0].uid, M.TY.TIMINGS.map((t) => `dial:${t.id}`), { routine: 'dial', args: { uid: mechs[0].uid, timing: M.TY.TIMINGS[0].id } }]);
  check('the safe dial is the Timing of an Action the Mech can perform', d.options.some((o) => o.id === d.fallback) && d.fallback !== '', true);
  check('both squads are asked at once: the dials are secret', asked(s, mind), ['planning.dial', 'planning.dial']);
  // The seat keeps its dials to itself (the driver writes them into its mind).
  mind.s1.dials = { round: 1, picks: { [mechs[0].uid]: 'firing' } };
  check('a dial chosen is kept in the seat\'s own memory, and the next Mech is asked', [owed(data, s, 's1', mind.s1).unit, s.tokens.find((t) => t.uid === mechs[0].uid).timing ?? null], [mechs[1].uid, null]);
  mind.s1.dials.picks[mechs[1].uid] = 'movement';
  check('with every dial chosen the squad commits', [owed(data, s, 's1', mind.s1).kind, owed(data, s, 's1', mind.s1).options[0].run.routine], ['planning.commit', 'commitDials']);
  check('dials chosen in an earlier round are not this round\'s', owed(data, s, 's1', { dials: { round: 0, picks: mind.s1.dials.picks } }).kind, 'planning.dial');
  // The commitment is the hash of the dials and a salt (secrecy.ts), as the
  // driver's routine makes it.
  const dialsOf = (seat, picks) => s.tokens.filter((t) => t.side === seat && t.kind === 'mech').map((t) => ({ uid: t.uid, timing: picks[t.uid] }));
  const theirs = Object.fromEntries(s.tokens.filter((t) => t.side === 's2' && t.kind === 'mech').map((t) => [t.uid, 'firing']));
  mind.s1.dials.salt = 'ab';
  run(s, { kind: 'commitTimings', seat: 's1', hash: await M.SEC.hashDials('ab', dialsOf('s1', mind.s1.dials.picks)) });
  check('committed, it waits: nothing is revealed until the other squad has committed too', [owed(data, s, 's1', mind.s1), owed(data, s, 's2', mind.s2).kind], [null, 'planning.dial']);
  run(s, { kind: 'commitTimings', seat: 's2', hash: await M.SEC.hashDials('cd', dialsOf('s2', theirs)) });
  check('then it reveals', [owed(data, s, 's1', mind.s1).kind, owed(data, s, 's1', mind.s1).options[0].run], ['planning.reveal', { routine: 'revealDials', args: {} }]);
  check('a seat whose dials were lost after it committed chooses them again', owed(data, s, 's1', newMind()).kind, 'planning.dial');
  mind.s2.dials = { round: 1, picks: theirs, salt: 'cd' };
  const shown = [run(s, { kind: 'revealTimings', seat: 's1', salt: 'ab', dials: dialsOf('s1', mind.s1.dials.picks) }).ok];
  check('one squad\'s reveal does not end the phase: it waits, and the other still owes its own', asked(s, mind), [null, 'planning.reveal']);
  shown.push(run(s, { kind: 'revealTimings', seat: 's2', salt: 'cd', dials: dialsOf('s2', theirs) }).ok);
  check('with both revealed, each says it is ready for the Action Phase, and the dials are on the board',
    [shown, asked(s, mind), s.tokens.filter((t) => t.kind === 'mech').map((t) => t.timing)], [[true, true], ['phase.ready', 'phase.ready'], ['firing', 'movement', 'firing']]);
  take(s, owed(data, s, 's1', mind.s1), 'ready');
  check('the second to be ready turns the phase with the same answer', [asked(s, mind), owed(data, s, 's2', mind.s2).options[0].commands.map((c) => c.kind)], [[null, 'phase.ready'], ['setReady', 'advancePhase']]);
  take(s, owed(data, s, 's2', mind.s2), 'ready');
  check('and the Action Phase begins with the first Mech in the order holding the Opportunity', [s.round.phase, !!s.script.opp], [2, true]);
}

// ---------- an Action Opportunity (3.4) ----------
{
  const { s, U, turnOf } = stage(2);
  turnOf(U.Mire, 'firing');
  const d = owed(data, s, 's1', newMind());
  const tags = (tag) => d.options.filter((o) => o.tags.includes(tag));
  check('the Mech holding the Opportunity is asked, and nobody else', [d.kind, d.unit, d.fallback, owed(data, s, 's2', newMind())], ['opp.act', U.Mire.uid, 'end', null]);
  check('until it has moved or acted it may change its Stance: the two it is not in', tags('stance').map((o) => o.commands[0].stance).sort(), ['defensive', 'mobility', 'offensive'].filter((x) => x !== U.Mire.stance));
  const man = tags('maneuver');
  const plain = man.filter((o) => !o.tags.includes('crush-unit'));
  const crushing = man.filter((o) => o.tags.includes('crush-unit'));
  check('its Maneuver: the Grids its Chassis reaches, four facings each, and three turns on the spot; the Grid a smaller unit stands in only as a Crush of it (M8.2p)',
    [M.TURN.reachableFor(data, s, U.Mire).map((g) => `${g.c},${g.r}`).sort(), [...new Set(plain.filter((o) => !o.tags.includes('pivot')).map((o) => `${o.facts.to.c},${o.facts.to.r}`))].sort(),
      plain.filter((o) => !o.tags.includes('pivot')).length, plain.filter((o) => o.tags.includes('pivot')).map((o) => o.facts.facing).sort(),
      [...new Set(crushing.map((o) => `${o.facts.to.c},${o.facts.to.r}`))], crushing.length > 0 && crushing.length % 4 === 0],
    [['4,4', '5,3', '5,5', '6,4'], ['4,4', '5,3', '5,5'], 12, [0, 2, 3], ['6,4'], true]);
  check('a Maneuver is one command, and says nothing of a facing it does not change; a Crush is the crushed unit\'s settling and then the Maneuver',
    [plain.every((o) => o.commands.length === 1 && o.commands[0].kind === 'maneuver' && !o.commands[0].free), plain.filter((o) => 'facing' in clone(o.commands[0])).length,
      crushing.every((o) => o.commands.at(-1).kind === 'maneuver' && o.commands.length >= 2)], [true, 9 + 3, true]);
  // Firing is on the dial: the two Firing Actions may start the Opportunity.
  // The Tarantula, six Grids off behind the Wild Cat, is in the Single Shot's
  // Range (obstructed, which costs dice and forbids nothing) and out of the
  // Burst's; the Porcupine is out of the arc.
  check('its Starting Action must match its dial: the gun\'s two Actions are offered, on each enemy in their arc and reach',
    tags('attack').map((o) => o.id).sort(), [`attack:536_A:${U.Raven.uid}`, `attack:536_A:${U['Wild Cat'].uid}`, `attack:536_A:${U.Tarantula.uid}`, `attack:536_B:${U.Raven.uid}`, `attack:536_B:${U['Wild Cat'].uid}`].sort());
  const shot = d.options.find((o) => o.id === `attack:536_A:${U.Raven.uid}`);
  check('an attack is a routine: what is sent before the window opens (the payment), then the window on its target',
    shot.run, { routine: 'attack', args: { uid: U.Mire.uid, actionId: '536_A', targetUid: U.Raven.uid, mode: 'attack', before: [{ kind: 'performAction', seat: 's1', uid: U.Mire.uid, actionId: '536_A', partKey: '536_A' }] } });
  check('nothing off its dial is offered to start with: no Sprint, no Missile, no Stabilize', [tags('moving').length, tags('launch').length, tags('stabilise').length], [0, 0, 0]);
  // A unit in Optical Camouflage is Scanned before it is attacked (4.12.2): it
  // is offered as a designation, the one free Scan with the attack behind it,
  // and never as an attack rolled at once (tests/seatcamo.test.mjs).
  U.Raven.statuses = ['camouflage'];
  const onRaven = owed(data, s, 's1', newMind()).options.filter((o) => o.tags.includes('attack') && o.facts.targetUid === U.Raven.uid);
  check('a unit in Optical Camouflage is offered only as a designation through its free Scan, never as an attack rolled at once',
    [onRaven.map((o) => o.id).sort(), onRaven.every((o) => o.tags.includes('hidden') && !o.run && o.commands.at(-1).kind === 'startCounterRoll' && o.commands.at(-1).thenAttack.actionId === o.facts.actionId)],
    [[`attack:536_A:${U.Raven.uid}:scan`, `attack:536_B:${U.Raven.uid}:scan`], true]);
  U.Raven.statuses = [];
  check('every answer that is commands is one the engine takes', allTaken(s, d), []);
  // Having Maneuvered, the Stance is fixed and the Maneuver is spent.
  take(s, d, man[0].id);
  const after = owed(data, s, 's1', newMind());
  check('having Maneuvered: no second Maneuver, and the Stance is the one it moved in',
    [after.options.filter((o) => o.tags.includes('maneuver')).length, after.options.filter((o) => o.tags.includes('stance')).length], [0, 0]);
  check('the question is a new one after every answer', after.id === d.id, false);
}
{
  // Some kinds of answer alone (AI-OPPONENT-PLAN.md, M6.0). Listing every Grid
  // a unit could walk to is most of the work of this question, and a seat that
  // is only looking ahead (what could I attack from there?) has no use for it.
  const { s, U, turnOf } = stage(2);
  turnOf(U.Mire, 'firing');
  const whole = owed(data, s, 's1', newMind());
  const only = (...kinds) => owed(data, s, 's1', newMind(), { only: kinds });
  const of = (tag) => whole.options.filter((o) => o.tags[0] === tag);
  const shots = only('attack');
  check('asked for the attacks alone: the same question, with the attacks of the whole of it and nothing else',
    [shots.kind, shots.id === whole.id, shots.unit, JSON.stringify(shots.options) === JSON.stringify(of('attack')), shots.options.length], ['opp.act', true, U.Mire.uid, true, 5]);
  check('with no Grid listed there are no roads to work out, and the whole question has them', ['roads' in shots.facts, 'roads' in whole.facts], [false, true]);
  check('nor are they worked out for any asker that is only looking: the roads are for a seat that must answer', 'roads' in only('move').facts, false);
  check('a kind is an answer\'s first tag: the Stances, the Grids it may move to, the end of the Opportunity',
    [ids(only('stance')), ids(only('move')), ids(only('end'))], [of('stance').map((o) => o.id), of('move').map((o) => o.id), ['end']]);
  check('several kinds may be wanted at once, and come in the order the whole question has them',
    ids(only('attack', 'stance')), whole.options.filter((o) => o.tags[0] === 'attack' || o.tags[0] === 'stance').map((o) => o.id));
  // The Mire's pilot (FPA-04-2) trades a Link for a Tick in Offensive Stance:
  // a kind of its own (M8.2l).
  check('every answer of the whole question is of one kind or another', ids(only('stance', 'tick', 'move', 'attack', 'end')), ids(whole));
  check('a kind nothing answers to leaves nothing to ask', [only('nothing'), only()], [null, null]);
  // The other routes an Action may take, each under its own kind.
  turnOf(U.Mire, 'projectile');
  const armed = owed(data, s, 's1', newMind());
  // (An asker that is only looking is given the launches that land within the
  // Missile's own reach of an enemy unit, and no others: seatblast.test has
  // the whole of that. Five of this Rack's twenty-five Landing Points are
  // further than that from every enemy.)
  const looked = ids(owed(data, s, 's1', newMind(), { only: ['launch'] }));
  const launches = armed.options.filter((o) => o.tags[0] === 'launch').map((o) => o.id);
  check('a launch is a kind of its own, and is no attack: asked for alone, the launches worth looking at, word for word and in the order the whole question has them',
    [looked.length, launches.length, JSON.stringify(looked) === JSON.stringify(launches.filter((id) => looked.includes(id))), owed(data, s, 's1', newMind(), { only: ['attack'] })], [20, 25, true, null]);
  turnOf(U.Mire, 'movement');
  const walking = owed(data, s, 's1', newMind());
  check('a Movement Action is a move, with the Maneuver',
    [ids(owed(data, s, 's1', newMind(), { only: ['move'] })), walking.options.some((o) => o.id.startsWith('move:534_A:'))], [walking.options.filter((o) => o.tags[0] === 'move').map((o) => o.id), true]);
  // One kind is narrower than a tag: the step before an attack, without every
  // Grid a Sprint reaches.
  check('`maneuver` is the Maneuver\'s moves alone, without the Movement Actions\'',
    [ids(owed(data, s, 's1', newMind(), { only: ['maneuver'] })), walking.options.filter((o) => o.tags.includes('maneuver')).length > 3],
    [walking.options.filter((o) => o.tags.includes('maneuver')).map((o) => o.id), true]);
}
{
  // Two kinds narrower still (M7.0), for a seat working out what one unit
  // could do to ONE other: the attacks on that unit alone, and the Maneuvers
  // after which there would be one.
  const { owedAfter } = M.SEAT;
  const { s, U, turnOf } = stage(2);
  turnOf(U.Mire, 'firing');
  const whole = owed(data, s, 's1', newMind());
  const only = (...kinds) => owed(data, s, 's1', newMind(), { only: kinds });
  const onto = (d, uid) => (d?.options ?? []).filter((o) => o.run?.routine === 'attack' && o.facts.targetUid === uid).map((o) => o.id);
  const raven = only(`strike:${U.Raven.uid}`);
  check('`strike:<uid>` is the attacks on that one enemy: those of the whole question, and no other answer',
    [ids(raven), ids(raven).length, raven.id === whole.id], [onto(whole, U.Raven.uid), 2, true]);
  check('each of them is the answer the whole question gives, routine and all',
    JSON.stringify(raven.options) === JSON.stringify(whole.options.filter((o) => o.run?.routine === 'attack' && o.facts.targetUid === U.Raven.uid)), true);
  // The Porcupine is in Range of the Shotgun, and behind the Mire's shoulder.
  check('an enemy it cannot attack from where it stands leaves nothing to ask', [onto(whole, U.Porcupine.uid), only(`strike:${U.Porcupine.uid}`)], [[], null]);
  check('asked with the attacks it changes nothing: every attack is listed', ids(only('attack', `strike:${U.Raven.uid}`)), ids(only('attack')));
  check('and it may be asked beside another kind', ids(only('end', `strike:${U.Raven.uid}`)), [...onto(whole, U.Raven.uid), 'end']);

  const steps = only(`reach:${U.Porcupine.uid}`);
  const maneuvers = whole.options.filter((o) => o.tags.includes('maneuver'));
  const after = (o, uid) => onto(owedAfter(data, s, 's1', newMind(), o.commands, { only: ['attack'] })?.decision, uid);
  check('`reach:<uid>` is the Maneuvers after which that enemy could be attacked: each is one of the Maneuver\'s own moves, and after each there is such an attack',
    [steps.options.length > 0, steps.options.every((o) => maneuvers.some((m) => JSON.stringify(m) === JSON.stringify(o))), steps.options.every((o) => after(o, U.Porcupine.uid).length > 0)],
    [true, true, true]);
  // The Porcupine stands at F9 (5,8): how far each step ends from it.
  const gap = (o) => Math.abs(o.facts.to.c - 5) + Math.abs(o.facts.to.r - 8);
  check('the nearest to it first, and three at most: a step toward it facing it, then a turn on the spot, then a step back still facing it',
    [steps.options.map((o) => o.id), steps.options.map(gap)], [['move:maneuver:5,5:2', 'move:maneuver:turn:2', 'move:maneuver:5,3:2'], [3, 4, 5]]);
  const others = maneuvers.filter((m) => !steps.options.some((o) => o.id === m.id));
  check('the moves it leaves out are the ones that bring nothing to bear, and (being three at most) the further of those that do',
    [others.length > 0, others.filter((m) => after(m, U.Porcupine.uid).length > 0).every((m) => steps.options.length === 3)], [true, true]);
  // An enemy no Maneuver brings into Range: thirteen Grids off.
  const far = stage(2);
  far.turnOf(far.U.Mire, 'firing');
  far.at(far.U['Wild Cat'], 11, 11, 0);
  check('an enemy no step brings an attack to bear on leaves nothing to ask',
    owed(data, far.s, 's1', newMind(), { only: [`reach:${far.U['Wild Cat'].uid}`] }), null);
  check('a unit that is not there, or is destroyed, is nobody to reach or to strike',
    [only('reach:4242'), only('strike:4242')], [null, null]);
  check('asked with the Maneuver\'s moves it changes nothing: every one is listed',
    [ids(only('maneuver', `reach:${U.Porcupine.uid}`)), ids(only('move', `reach:${U.Porcupine.uid}`))], [ids(only('maneuver')), ids(only('move'))]);
  check('and with the attacks beside it, the attacks from where it stands come with the steps',
    ids(only('attack', `reach:${U.Porcupine.uid}`)), [...ids(steps), ...ids(only('attack'))]);
  // Having Maneuvered, there is no step left to take.
  take(s, whole, maneuvers[0].id);
  check('once the Maneuver is spent there is no step to offer', owed(data, s, 's1', newMind(), { only: [`reach:${U.Porcupine.uid}`] }), null);
}
{
  // WHO WOULD SEE A UNIT in each of several Grids (M7.0): what a player reads
  // off the board when looking for cover. The alley, with its walls: the Wild
  // Cat at F6, the rest of its squad off in the far corner.
  const { sightedIn } = M.SEAT;
  const s = clone(base);
  const U = Object.fromEntries(s.tokens.map((t) => [name(t), t]));
  const at = (t, c, r) => { t.col = c * 3; t.row = r * 3; };
  at(U['Wild Cat'], 5, 5); at(U.Porcupine, 11, 11); at(U.Raven, 10, 11); at(U.Tarantula, 9, 11); at(U.Mire, 4, 2); at(U.Dune, 4, 1);
  const before = JSON.stringify(s);
  const cat = U['Wild Cat'].uid;
  const F4 = { c: 5, r: 3 }, F1 = { c: 5, r: 0 }, D1 = { c: 3, r: 0 }, E2 = { c: 4, r: 1 }, E3 = { c: 4, r: 2 };
  const seen = sightedIn(data, s, U.Mire.uid, [F4, F1, D1, E2, E3]);
  check('for each Grid, the enemy units with line of sight to the unit standing there: up the open lane the Wild Cat sees it, and behind the wall at F3 it does not',
    [seen[0].includes(cat), seen[1].includes(cat), seen[1].length > 0, seen[2]], [true, false, true, [cat]]);
  check('a Grid it could not stand in is seen by nobody (the Dune stands in E2), and the Grid it stands in is judged where it stands',
    [seen[3], seen[4].includes(cat)], [[], true]);
  // The board's own reading of each line, the unit put down where the board
  // would stand it.
  const lines = [];
  for (const [g, who] of [[F4, seen[0]], [F1, seen[1]], [D1, seen[2]]]) {
    const others = s.tokens.filter((t) => t.uid !== U.Mire.uid);
    const land = M.TURN.terrainOf(data, s);
    const spot = M.R.standingSpot(g.c, g.r, U.Mire.size, U.Mire.aerial, land, others, U.Mire.uid);
    const there = { ...U.Mire, col: spot.col, row: spot.row };
    const want = others.filter((e) => e.side === 's2' && ['clear', 'obstructed'].includes(M.R.firingSight(e, there, land, [...others, there], []))).map((e) => e.uid);
    lines.push(JSON.stringify(who) === JSON.stringify(want));
  }
  check('it is the board\'s own reading of the line (firingSight), from each enemy to the unit put down in that Grid', lines, [true, true, true]);
  check('sight is not Range: a Drone eleven Grids off sees it, and is named', seen[0].includes(U.Porcupine.uid), true);
  check('a Smoke Screen in the Grid hides it from everybody (4.16)',
    sightedIn(data, { ...s, smoke: [{ col: 5, row: 3, side: 's1' }] }, U.Mire.uid, [F4]), [[]]);
  const theirs = sightedIn(data, s, cat, [F4])[0];
  check('its own squad is not who it hides from: asked of a unit of either squad, the eyes are the other squad\'s',
    [seen.flat().includes(U.Dune.uid), theirs.length > 0, theirs.every((uid) => s.tokens.find((t) => t.uid === uid).side === 's1')], [false, true, true]);
  check('nothing is moved to look, no Grids asked is no answers, and a unit that is not there is seen nowhere',
    [JSON.stringify(s) === before, sightedIn(data, s, U.Mire.uid, []), sightedIn(data, s, 4242, [F4])], [true, [], [[]]]);
}
{
  // HOW LONG A WALK IS (M7.2): for a unit, from each Grid asked about to the
  // nearest of a set of Grids, the Grids on the road and the activations it
  // takes. The alley: Echo lies behind a Container from the north.
  const { walkIn } = M.SEAT;
  const s = clone(base);
  const U = Object.fromEntries(s.tokens.map((t) => [name(t), t]));
  const at = (t, c, r) => { t.col = c * 3; t.row = r * 3; };
  at(U['Wild Cat'], 5, 9); at(U.Porcupine, 11, 11); at(U.Raven, 10, 11); at(U.Tarantula, 9, 11); at(U.Mire, 4, 2); at(U.Dune, 4, 1);
  const before = JSON.stringify(s);
  const G = (ref) => ({ c: ref.charCodeAt(0) - 65, r: Number(ref.slice(1)) - 1 });
  const ECHO = ['F6', 'G6', 'F7', 'G7'].map(G);
  const BRAVO = ['B6', 'C6', 'B7', 'C7'].map(G);
  const walks = walkIn(data, s, U.Mire.uid, ['E3', 'D3', 'F6', 'F3'].map(G), ECHO);
  check('for each Grid: the Grids on the road and the activations it takes. From E3 the Maneuver crushes into the Container and the Sprint goes on (one activation); from D3 a Movement ends in it (two); a Grid of the zone is no walk; a walled Grid has none',
    walks, [{ grids: 4, turns: 1 }, { grids: 5, turns: 2 }, { grids: 0, turns: 0 }, null]);
  const field = M.TURN.walkField(data, s, U.Mire, ECHO);
  check('it is the engine\'s own field (turn.ts walkField), read at each Grid',
    [walks[0], walks[1]], [['4,2'], ['3,2']].map(([k]) => ({ grids: field.walks.get(k).grids, turns: field.walks.get(k).turns })));
  check('with what is left of an activation under way, the count begins after it: a Sprint still unspent reaches Echo from E4, a Maneuver does not, and from E3 the Sprint ends in the Container',
    [walkIn(data, s, U.Mire.uid, [G('E4')], ECHO, [4]), walkIn(data, s, U.Mire.uid, [G('E4')], ECHO, [1]), walkIn(data, s, U.Mire.uid, [G('E3')], ECHO, [4]), walkIn(data, s, U.Mire.uid, [G('E3')], ECHO, [])],
    [[{ grids: 3, turns: 0 }], [{ grids: 3, turns: 1 }], [{ grids: 4, turns: 1 }], [{ grids: 4, turns: 1 }]]);
  check('the Maneuver comes before the Sprint: from D3 the nearest zone by road, Bravo, is ONE activation by the longer road round the Container',
    walkIn(data, s, U.Mire.uid, [G('D3')], BRAVO), [{ grids: 4, turns: 1 }]);
  // The units on the board are left out, the unit itself among them: one not
  // yet deployed is asked as if it were put down in the Grid.
  const waiting = clone(s);
  waiting.tokens.find((t) => t.uid === U.Mire.uid).deployed = false;
  check('a unit not yet on the board has the same walk from a Grid as one standing in it, and so has one whose road another unit stands in',
    [walkIn(data, waiting, U.Mire.uid, ['E3', 'D3'].map(G), ECHO), walkIn(data, { ...s, tokens: s.tokens.map((t) => (t.uid === U.Dune.uid ? { ...t, col: 5 * 3, row: 3 * 3 } : t)) }, U.Mire.uid, ['E3', 'D3'].map(G), ECHO)],
    [walks.slice(0, 2), walks.slice(0, 2)]);
  // A memory handed in: one field for each unit and set of Grids, until the
  // terrain changes.
  const kept = new Map();
  const first = walkIn(data, s, U.Mire.uid, ['E3', 'D3', 'F6', 'F3'].map(G), ECHO, undefined, kept);
  const again = walkIn(data, s, U.Mire.uid, [G('B2')], ECHO, undefined, kept);
  const sizes = [kept.size];
  walkIn(data, s, U.Mire.uid, [G('B2')], BRAVO, undefined, kept); sizes.push(kept.size);
  walkIn(data, s, U.Dune.uid, [G('B2')], BRAVO, undefined, kept); sizes.push(kept.size);
  const container = M.TURN.terrainOf(data, s).filter((p) => p.isFragile && p.subCells.some((x) => Math.floor(x.col / 3) === 4 && Math.floor(x.row / 3) === 3)).map((p) => p.id);
  const opened = { ...s, removedTerrain: container };
  const later = walkIn(data, opened, U.Mire.uid, [G('D3')], ECHO, undefined, kept); sizes.push(kept.size);
  check('with a memory handed in the answers are the same, a field is kept for each unit and each set of Grids, and a Container destroyed makes it another field',
    [first, again, sizes, later, walkIn(data, opened, U.Mire.uid, [G('D3')], ECHO)],
    [walks, walkIn(data, s, U.Mire.uid, [G('B2')], ECHO), [1, 2, 3, 4], [{ grids: 5, turns: 1 }], [{ grids: 5, turns: 1 }]]);
  const shot = clone(s);
  shot.tokens.find((t) => t.uid === U.Mire.uid).kind = 'projectile';
  check('a unit that is not there, nowhere to walk to, and a unit that cannot move have no walk; nothing on the table is touched',
    [walkIn(data, s, 4242, [G('E3')], ECHO), walkIn(data, s, U.Mire.uid, [G('E3')], []), walkIn(data, shot, U.Mire.uid, [G('E3')], ECHO), walkIn(data, s, U.Mire.uid, [], ECHO), JSON.stringify(s) === before],
    [[null], [null], [null], [], true]);
}
{
  // A TABLE WITH ONE UNIT GONE FROM IT (M7.2): what a seat looks at to see what
  // destroying a unit would change. The Tarantula stands in Echo and holds it.
  const { tableWithout, viewOf } = M.SEAT;
  const s = clone(base);
  const U = Object.fromEntries(s.tokens.map((t) => [name(t), t]));
  const at = (t, c, r) => { t.col = c * 3; t.row = r * 3; };
  at(U['Wild Cat'], 5, 9); at(U.Porcupine, 11, 11); at(U.Raven, 10, 11); at(U.Tarantula, 5, 5); at(U.Mire, 4, 2); at(U.Dune, 4, 1);
  const before = JSON.stringify(s);
  const echo = (table) => viewOf(data, table, 's1').zones.find((z) => z.name === 'Echo').holder;
  const gone = tableWithout(s, U.Tarantula.uid);
  check('the unit is off that table and every other unit is on it; nothing of the table in play is touched',
    [gone.tokens.some((t) => t.uid === U.Tarantula.uid), gone.tokens.length, s.tokens.length, JSON.stringify(s) === before, gone === s], [false, 5, 6, true, false]);
  check('and the board\'s own reading says who would hold what without it: Echo, which it held, is nobody\'s',
    [echo(s), echo(gone), echo(tableWithout(s, U.Mire.uid)), echo(tableWithout(s, 4242))], ['s2', null, 's2', 's2']);
}
{
  // WHAT COMES NEXT (M6.0): the table an answer would leave, and the question
  // asked there.
  const { owedAfter, owedIfActivated } = M.SEAT;
  const { s, U, turnOf } = stage(2);
  turnOf(U.Mire, 'projectile');
  const d = owed(data, s, 's1', newMind());
  const before = JSON.stringify(s);
  const launch = d.options.find((o) => o.tags[0] === 'launch');
  check('a launch says how far its Projectile strikes from where it lands', [launch.facts.strike, launch.facts.cardId], [3, '071']);
  const after = owedAfter(data, s, 's1', newMind(), launch.commands);
  check('what comes next: the table as the answer\'s commands leave it, the question the seat is put there, and the unit they put on the board',
    [after.table.tokens.length - s.tokens.length, after.born.map((uid) => after.table.tokens.find((t) => t.uid === uid).cardId), after.decision.kind,
      ids(after.decision).filter((x) => x.startsWith('launch:')).length, after.table.tokens.find((t) => t.uid === U.Mire.uid).ammo['004_A'], U.Mire.ammo['004_A'], JSON.stringify(s) === before],
    [1, ['071'], 'opp.act', 25, 3, 4, true]);
  check('a kind may be wanted of it as of any question, and commands that put nothing on the board bear nothing',
    [ids(owedAfter(data, s, 's1', newMind(), launch.commands, { only: ['end'] }).decision), owedAfter(data, s, 's1', newMind(), d.options.find((o) => o.id === 'end').commands).born], [['end'], []]);
  check('an answer the engine would refuse has nothing after it', owedAfter(data, s, 's1', newMind(), [{ kind: 'endOpportunity', seat: 's1', uid: 4242 }]), null);

  // A UNIT'S OWN TURN, BEFORE IT COMES.
  const plan = stage(1);
  const was = JSON.stringify(plan.s);
  const real = (timing) => { const r = stage(2); r.turnOf(r.U.Mire, timing); return owed(data, r.s, 's1', newMind()); };
  check('the Opportunity a dial would open is the question the Mech would be put on that Timing, answer for answer',
    ['melee', 'projectile', 'firing', 'movement'].map((timing) => JSON.stringify(ids(owedIfActivated(data, plan.s, plan.U.Mire.uid, timing).decision)) === JSON.stringify(ids(real(timing)))),
    [true, true, true, true]);
  const seen = owedIfActivated(data, plan.s, plan.U.Mire.uid, 'firing');
  check('it is asked on a copy: the phase, the dial and the Opportunity are the copy\'s, and the table in play is as it was',
    [seen.table.round.phase, seen.table.tokens.find((t) => t.uid === plan.U.Mire.uid).timing, seen.table.script.opp.uid, plan.s.round.phase, plan.s.script.opp, JSON.stringify(plan.s) === was],
    [2, 'firing', plan.U.Mire.uid, 1, null, true]);
  check('the Timing is the asker\'s to name: with none named a Mech is not asked at all, for a dial not yet revealed is nobody\'s to read (3.3)',
    [owedIfActivated(data, plan.s, plan.U.Mire.uid), JSON.stringify(plan.s) === was], [null, true]);
  // In the Action Phase every Mech has its dial on the table, all on Firing.
  const live = stage(2);
  check('not even a dial already on the table is read: the Timing is named or the Mech is not asked',
    [owedIfActivated(data, live.s, live.U.Mire.uid), live.U.Mire.timing], [null, 'firing']);
  const last = owedIfActivated(data, live.s, live.U.Dune.uid, 'movement', { only: ['move'] });
  check('the Mech is asked as if every other Mech had had its turn, whatever dials they hold: the Dune on Movement, behind two Mechs on Firing',
    [last?.decision?.unit, last?.table.script.opp?.uid, last?.decision?.options.every((o) => o.tags[0] === 'move'), live.s.script.acted.length], [live.U.Dune.uid, live.U.Dune.uid, true, 0]);
  const theirs = owedIfActivated(data, plan.s, plan.U['Wild Cat'].uid, 'firing', { only: ['attack'] });
  check('it may be asked of the other squad\'s Mech, on a Timing the asker supposes, and of some kinds alone',
    [theirs.decision.seat, theirs.decision.unit, theirs.decision.options.length > 0, theirs.decision.options.every((o) => o.tags[0] === 'attack')], ['s2', plan.U['Wild Cat'].uid, true, true]);
  // A Drone's Automatic Action, asked in the middle of the Action Phase.
  const dr = stage(2);
  dr.at(dr.U.Mire, 5, 6, 0);
  const auto = owedIfActivated(data, dr.s, dr.U.Porcupine.uid);
  check('a Drone is asked as in the Automatic Phase, where its own Action is performed',
    [auto.table.round.phase, auto.decision.kind, ids(auto.decision), dr.s.round.phase], [3, 'activation.act', [`attack:543_A:${dr.U.Mire.uid}`, 'end'], 2]);
  dr.at(dr.U.Mire, 5, 7, 0);
  check('so a Melee Lock, a wall or an enemy out of its arc is the engine\'s to say: beside a Mech the Porcupine has no shot to take',
    ids(owedIfActivated(data, dr.s, dr.U.Porcupine.uid).decision), ['end']);
  const missile = owedIfActivated(data, after.table, after.born[0]);
  check('a Projectile is asked as in the Delay Phase: its Delayed Action, on the table its launch left',
    [missile.table.round.phase, missile.decision.kind, missile.decision.unit, missile.decision.options.every((o) => o.tags[0] === 'detonate' || o.id === 'end')], [4, 'activation.act', after.born[0], true]);
  // The Missile where it landed, with no enemy inside its Range of 3.
  const lone = stage(2);
  lone.s.tokens.push({ ...M.U.makeDroneToken(lone.s, data, data.byId.get('071'), 's1'), parentUid: lone.U.Mire.uid, col: 1, row: 31, facing: 0 });
  const m2 = lone.s.tokens[lone.s.tokens.length - 1];
  check('asked for the attacks alone, a Projectile says the Explosions it could make, and not the answer that finds no target',
    [ids(owedIfActivated(data, lone.s, m2.uid).decision).filter((x) => x.startsWith('detonate:')), owedIfActivated(data, lone.s, m2.uid, undefined, { only: ['attack'] }).decision,
      ids(owedIfActivated(data, lone.s, m2.uid, undefined, { only: ['detonate'] }).decision)],
    [['detonate:071_A:none'], null, ['detonate:071_A:none']]);
  // A TURN IN A LATER ROUND COMES AFTER THE END PHASE (M7.0). The Mire holds
  // the Opportunity, so the turn asked about is the one a round on; it wears a
  // Fire Control Interference Token, which bars its Firing while it is worn.
  {
    const jam = stage(2);
    jam.turnOf(jam.U.Mire, 'firing');
    const before = JSON.stringify(jam.s);
    const free = owedIfActivated(data, jam.s, jam.U.Mire.uid, 'firing', { only: ['attack'] });
    const shots = ids(free.decision);
    check('a unit whose turn is the one being taken is next activated a round on: the table asked is the next round\'s, and the table in play is as it was',
      [shots.length > 0, free.table.round.n, jam.s.round.n, JSON.stringify(jam.s) === before], [true, 2, 1, true]);
    // Red: it comes off at this round's End Phase. Yellow: it turns red there, and is worn through the next round.
    jam.U.Mire.statuses = ['fci'];
    jam.U.Mire.expiring = ['fci'];
    const red = owedIfActivated(data, jam.s, jam.U.Mire.uid, 'firing', { only: ['attack'] });
    jam.U.Mire.expiring = undefined;
    const yellow = owedIfActivated(data, jam.s, jam.U.Mire.uid, 'firing', { only: ['attack'] });
    check('the End Phase lies between: a red Token has come off by then and the unit fires as if it had never worn it; a yellow one has only turned, and bars its Firing still',
      [ids(red.decision), red.table.tokens.find((t) => t.uid === jam.U.Mire.uid).statuses, (ids(yellow?.decision ?? null) ?? []).filter((x) => x.startsWith('attack:536')),
        yellow.table.tokens.find((t) => t.uid === jam.U.Mire.uid).expiring], [shots, [], [], ['fci']]);
    // A unit whose turn of this round is still to come is asked on the table as it stands.
    const waiting = stage(2);
    waiting.U.Mire.statuses = ['fci'];
    waiting.U.Mire.expiring = ['fci'];
    const now = owedIfActivated(data, waiting.s, waiting.U.Mire.uid, 'firing', { only: ['attack'] });
    check('a unit whose turn of this round is still to come is asked on the table as it stands, Tokens and all',
      [now.table.round.n, now.table.tokens.find((t) => t.uid === waiting.U.Mire.uid).statuses, (ids(now.decision) ?? []).filter((x) => x.startsWith('attack:536'))], [1, ['fci'], []]);
    // The same for a unit whose turn is behind it, and for the phases past its own.
    const acted = stage(2);
    acted.turnOf(acted.U.Dune, 'firing');
    const past = stage(3);
    check('a Mech that has had its Opportunity, and any Mech once the Action Phase is over, is asked a round on',
      [owedIfActivated(data, acted.s, acted.U.Mire.uid, 'firing', { only: ['attack'] }).table.round.n, owedIfActivated(data, past.s, past.U.Mire.uid, 'firing', { only: ['attack'] }).table.round.n,
        owedIfActivated(data, past.s, past.U.Porcupine.uid).table.round.n], [2, 2, 1]);
    // After the last round there is no later turn.
    const last = stage(2);
    last.turnOf(last.U.Mire, 'firing');
    last.s.round.n = 5;
    check('after the last round there is no later turn to ask about',
      [owedIfActivated(data, last.s, last.U.Mire.uid, 'firing', { only: ['attack'] }), !!owedIfActivated(data, last.s, last.U['Wild Cat'].uid, 'firing', { only: ['attack'] })], [null, false]);
    // A Mech down to two Parts leaves at the End Phase (Integrity Loss): it has no later turn, and is nobody's threat by then.
    const dying = stage(2);
    dying.turnOf(dying.U.Mire, 'firing');
    Object.assign(dying.U['Wild Cat'].partStates, { leftHand: 'destroyed', rightHand: 'destroyed', backpack: 'destroyed' });
    dying.s.script.acted.push(dying.U['Wild Cat'].uid);
    const left = owedIfActivated(data, dying.s, dying.U.Mire.uid, 'firing', { only: ['attack'] });
    check('a Mech down to two Parts has left the board by then: it has no later turn of its own, and is no longer among the targets of anybody else\'s',
      [owedIfActivated(data, dying.s, dying.U['Wild Cat'].uid, 'firing', { only: ['attack'] }), left.table.tokens.some((t) => t.uid === dying.U['Wild Cat'].uid),
        (ids(left.decision) ?? []).some((x) => x.endsWith(`:${dying.U['Wild Cat'].uid}`)), dying.s.tokens.some((t) => t.uid === dying.U['Wild Cat'].uid)], [null, false, false, true]);
  }
  const gone = stage(2);
  gone.U.Porcupine.partStates.main = 'destroyed';
  check('a unit that is not there, or is destroyed, is asked nothing',
    [owedIfActivated(data, plan.s, 4242, 'firing'), owedIfActivated(data, gone.s, gone.U.Porcupine.uid)], [null, null]);
}
{
  // Movement Actions, once the Opportunity has started.
  const { s, U, turnOf } = stage(2);
  turnOf(U.Mire, 'movement');
  const d = owed(data, s, 's1', newMind());
  const sprint = d.options.filter((o) => o.id.startsWith('move:534_A:'));
  const reach = M.TURN.reachableFor(data, s, U.Mire, 4, undefined, '534_A');
  const crush = reach.filter((g) => M.TURN.moveOptsFor(data, s, U.Mire, false, '534_A').crushable(g.c, g.r)).length;
  const crushed = sprint.filter((o) => o.tags.includes('crush-unit'));
  check('a Movement Action: every Grid its own Range reaches, four facings each, and never a turn on the spot; the two a Crush would end in only as Crushes (M8.2p)',
    [reach.length, crush, sprint.length - crushed.length, sprint.some((o) => o.tags.includes('pivot')), new Set(crushed.map((o) => `${o.facts.to.c},${o.facts.to.r}`)).size],
    [35, 2, (35 - 2) * 4, false, 2]);
  check('it is paid first, and its move rides on the payment, free of the Maneuver Tick',
    [sprint[0].commands.map((c) => c.kind), sprint[0].commands[1].free, sprint[0].commands[1].actionId, sprint[0].tags.slice(0, 3)], [['performAction', 'maneuver'], true, '534_A', ['move', 'action', 'moving']]);
  check('the Crawl is one too, at its own Range', [...new Set(d.options.filter((o) => o.id.startsWith('move:COMMON_CRAWL')).map((o) => o.facts.grids))], [1]);
  check('every one is taken by the engine as it will stand once the Action is paid', allTaken(s, d), []);
  check('an answer says how far it goes and which way it ends', [typeof sprint[0].facts.grids, sprint.map((o) => o.facts.facing).slice(0, 4)], ['number', [0, 1, 2, 3]]);
}
{
  // A Mine on the way: the walk it would stop is not offered.
  const { s, U, turnOf } = stage(2);
  const mine = { ...M.U.makeDroneToken(s, data, data.byId.get('074'), 's2'), col: 16, row: 7, facing: 0 };
  s.tokens.push(mine);
  turnOf(U.Mire, 'movement');
  const ends = new Set(owed(data, s, 's1', newMind()).options.filter((o) => o.id.startsWith('move:534_A:')).map((o) => `${o.facts.to.c},${o.facts.to.r}`));
  check('a walk a Mine would stop is not offered: nothing past it up that column, and the Mine\'s own Grid is a landing like any other',
    [ends.has('5,2'), ends.has('5,1'), ends.has('5,0'), ends.has('5,3')], [true, false, false, true]);
}
{
  // A Charge up on the Part: the shot that spends it.
  const { s, U, turnOf } = stage(2);
  U['Wild Cat'].charge = ['leftHand'];
  U['Wild Cat'].col = 6 * 3; U['Wild Cat'].row = 4 * 3; U.Raven.col = 0; U.Raven.row = 33;
  turnOf(U['Wild Cat'], 'firing');
  const d = owed(data, s, 's2', newMind());
  const plain = d.options.find((o) => o.id === `attack:540_B:${U.Mire.uid}`);
  const spent = d.options.find((o) => o.id === `attack:540_B:${U.Mire.uid}:charged`);
  check('an Action whose Part is Charged is offered both ways', [!!plain, !!spent, spent.tags.includes('spend-charge')], [true, true, true]);
  check('spending it flips the token down BEFORE the Action is paid, and the attack is made with its [Charged] line',
    [spent.run.args.before.map((c) => (c.kind === 'setCharge' ? `${c.kind} ${c.slot} ${c.on}` : c.kind)), spent.run.args.charged, plain.run.args.charged ?? null],
    [['setCharge leftHand false', 'performAction'], true, null]);
  check('an Action whose Part is not Charged has no such answer', d.options.some((o) => /^attack:541_.*:charged$/.test(o.id)), false);
}
{
  // The Charge Action, and Stabilize System.
  const { s, U, turnOf } = stage(2);
  turnOf(U['Wild Cat'], 'swift');
  const d = owed(data, s, 's2', newMind());
  check('the Charge Action: one answer per Part that could be Charged, paid under that Part',
    d.options.filter((o) => o.tags.includes('charge')).map((o) => [o.id, o.commands]), [['charge:COMMON_CHARGE:leftHand', [{ kind: 'performAction', seat: 's2', uid: U['Wild Cat'].uid, actionId: 'COMMON_CHARGE', partKey: 'COMMON_CHARGE@leftHand' }]]]);
  U['Wild Cat'].charge = ['leftHand'];
  check('none once every Part is', owed(data, s, 's2', newMind()).options.filter((o) => o.tags.includes('charge')).length, 0);
  turnOf(U.Mire, 'tactical');
  check('Stabilize System changes nothing on a Mech at full Link with no Token, so it is not offered', owed(data, s, 's1', newMind()).options.filter((o) => o.tags.includes('stabilise')).length, 0);
  U.Mire.link = 2; U.Mire.statuses = ['fragile'];
  const st = owed(data, s, 's1', newMind()).options.filter((o) => o.tags.includes('stabilise'));
  check('with Link to recover and a Token to shed: one answer for the Token, one for the Link alone, each paid first',
    st.map((o) => [o.id, o.tags[1], o.commands.map((c) => c.kind), o.commands[1].statusId ?? null, o.commands[1].keepTokens ?? null]),
    [['stabilise:fragile:yellow', 'remove-token', ['performAction', 'stabilise'], 'fragile', null], ['stabilise:keep', 'restore-link', ['performAction', 'stabilise'], null, true]]);
}
{
  // A launch, and its Volley.
  const { s, U, turnOf } = stage(2);
  turnOf(U.Mire, 'projectile');
  const d = owed(data, s, 's1', newMind());
  const shots = d.options.filter((o) => o.tags.includes('launch'));
  check('a Projectile Action: one answer per legal Landing Point, the Action paid and the Missile launched',
    [shots.length, M.TURN.landingGrids(data, s, U.Mire, M.TURN.actionOf(data, s, U.Mire, '004_A')).filter((g) => g.ok).length, shots[0].commands.map((c) => c.kind), shots[0].commands[1].cardId, shots[0].tags],
    [25, 25, ['performAction', 'launch'], '071', ['launch', 'land']]);
  take(s, d, shots[0].id);
  const more = owed(data, s, 's1', newMind()).options.filter((o) => o.tags.includes('launch'));
  check('the Volley goes on: the same Landing Points, on the payment already made',
    [more.length, more[0].commands.map((c) => c.kind), more[0].tags.includes('volley')], [25, ['launch'], true]);
  take(s, owed(data, s, 's1', newMind()), more[1].id);
  check('and stops at Volley 2', [owed(data, s, 's1', newMind()).options.filter((o) => o.tags.includes('launch')).length, U.Mire.ammo['004_A']], [0, 2]);
  // An Interceptor in Range: the launch says what it owes.
  const t2 = stage(2);
  t2.s.tokens.push({ ...M.U.makeDroneToken(t2.s, data, data.byId.get('078'), 's2'), col: 18, row: 6, facing: 0 });
  t2.turnOf(t2.U.Mire, 'projectile');
  const watched = owed(data, t2.s, 's1', newMind()).options.filter((o) => o.tags.includes('launch'));
  check('with an enemy Interceptor in Range of the launcher, every launch carries the Interception it owes',
    [watched.every((o) => o.commands[o.commands.length - 1].kind === 'queueIntercepts'), allTaken(t2.s, { options: watched })], [true, []]);
}

// ---------- a Crush of Destructible Terrain, and the roads to the enemy ----------
{
  // The alley, as it is played: the Wild Cat in its corner with a Container in
  // the Grid ahead of it, its own Drone beside it, and the enemy far beyond.
  const { s, U, at, turnOf } = stage(2);
  s.map = 'alley';
  at(U.Mire, 3, 2, 2); at(U.Dune, 4, 2, 2); at(U['Wild Cat'], 7, 9, 0); at(U.Porcupine, 8, 9, 0); at(U.Raven, 10, 11, 0); at(U.Tarantula, 9, 11, 0);
  turnOf(U['Wild Cat'], 'movement');
  const d = owed(data, s, 's2', newMind());
  const grid = (o) => `${o.facts.to.c},${o.facts.to.r}`;
  const boxes = M.TURN.terrainOf(data, s).filter((p) => p.isFragile && p.subCells.some((c) => Math.floor(c.col / 3) === 7 && Math.floor(c.row / 3) === 8)).map((p) => p.id);
  const crush = d.options.filter((o) => o.tags.includes('crush') && grid(o) === '7,8');
  const byManeuver = crush.filter((o) => o.tags.includes('maneuver'));
  const byAction = crush.filter((o) => o.tags.includes('moving'));
  check('a Grid holding Destructible Terrain and no Unit is offered as a Crush: the terrain destroyed, then the Movement that ends there, on each facing',
    [boxes.length, byManeuver.length, byManeuver[0].commands.map((c) => c.kind), byManeuver[0].commands[0].pieces, byManeuver[0].facts.crush],
    [1, 4, ['destroyTerrain', 'maneuver'], boxes, true]);
  check('a Movement Action that ends in one is paid first', [byAction.length > 0, byAction[0].commands.map((c) => c.kind), byAction[0].commands[2].free], [true, ['performAction', 'destroyTerrain', 'maneuver'], true]);
  const own = d.options.filter((o) => o.tags.includes('move') && !o.tags.includes('pivot') && o.id.includes(':8,9:'));
  check('a Crush of a Unit is offered, its own Drone\'s too: every answer into the Grid its Drone stands in is a Crush of it (M8.2p; seatcrush.test)',
    [M.TURN.moveOptsFor(data, s, U['Wild Cat'], false).crushable(8, 9), own.length > 0, own.every((o) => o.tags.includes('crush-unit') && o.facts.crushed.includes(U.Porcupine.uid))], [true, true, true]);
  check('and every one of them is taken by the engine', allTaken(s, d), []);
  // The roads: where it would walk to stand beside each enemy.
  const roads = d.facts.roads;
  const step = (a, b) => Math.abs(a.c - b.c) + Math.abs(a.r - b.r);
  const walked = (road, from) => road.every((g, i) => step(g, i ? road[i - 1] : from) === 1);
  const mire = roads[U.Mire.uid];
  const dune = roads[U.Dune.uid];
  check('an activation says the road to each enemy: Grids in walking order from where it stands, ending beside the enemy',
    [Object.keys(roads).sort(), walked(mire, { c: 7, r: 9 }), walked(dune, { c: 7, r: 9 }), step(mire.at(-1), { c: 3, r: 2 }), step(dune.at(-1), { c: 4, r: 2 })],
    [[String(U.Mire.uid), String(U.Dune.uid)].sort(), true, true, 1, 1]);
  check('a Large Unit\'s road runs through the Destructible Terrain it would crush, which is the only way out of that corner',
    [`${dune[0].c},${dune[0].r}`, M.TURN.reachableFor(data, s, U['Wild Cat'], 40).some((g) => g.r < 5 && g.c < 7), dune.length > step({ c: 7, r: 9 }, { c: 4, r: 2 }) - 2], ['7,8', false, true]);
  // The Crush, taken: the terrain is gone, the Wild Cat stands where it stood, the Maneuver is spent.
  take(s, d, byManeuver.find((o) => o.facts.facing === 0).id);
  const after = owed(data, s, 's2', newMind());
  check('taken, the terrain is destroyed and the unit stands in its Grid, its Maneuver spent',
    [boxes.every((id) => (s.removedTerrain ?? []).includes(id)), Math.floor(U['Wild Cat'].col / 3), Math.floor(U['Wild Cat'].row / 3), after.options.filter((o) => o.tags.includes('maneuver')).length],
    [true, 7, 8, 0]);
  check('and its road is one Grid shorter', after.facts.roads[U.Dune.uid].length, dune.length - 1);
}
{
  // A Medium unit crushes nothing: its road goes around, or there is none.
  const { s, U, at, activate } = stage(0);
  s.map = 'alley';
  at(U.Mire, 3, 2, 2); at(U.Dune, 4, 2, 2); at(U['Wild Cat'], 11, 11, 0); at(U.Porcupine, 7, 9, 0); at(U.Raven, 10, 11, 0); at(U.Tarantula, 9, 11, 0);
  activate(U.Porcupine);
  const d = owed(data, s, 's2', newMind());
  const roads = d.facts.roads;
  // Its road is the walk the board allows AS IT STANDS (a smaller base may
  // share a Grid with a Container, and walks past it): the route its own
  // planner would draw to the same Grid, with every Movement it takes.
  const drawn = Object.values(roads).map((road) => {
    const end = road.at(-1);
    const route = M.TURN.extendRoute(data, s, U.Porcupine, [{ c: 7, r: 9 }], end, 48, M.TURN.movesAsFlight(data, s, U.Porcupine));
    return !!route && route.length - 1 === road.length;
  });
  check('a unit that cannot Crush is offered none, and its road is the walk the board allows as it stands',
    [d.options.some((o) => o.tags.includes('crush')), Object.keys(roads).length, drawn], [false, 2, [true, true]]);
  // Beside an enemy the road is empty; with nothing left to move with, no roads are worked out.
  const near = stage(2);
  near.at(near.U.Mire, 5, 4, 1); near.at(near.U.Raven, 6, 4, 3);
  near.turnOf(near.U.Mire, 'firing');
  const beside = owed(data, near.s, 's1', newMind());
  check('the road to an enemy it stands beside is empty', beside.facts.roads[near.U.Raven.uid], []);
  take(near.s, beside, beside.options.find((o) => o.tags.includes('maneuver') && !o.tags.includes('pivot')).id);
  const spent = owed(data, near.s, 's1', newMind());
  check('and a unit with no Movement left is told no roads', [spent.options.some((o) => o.tags.includes('move')), spent.facts.roads ?? null], [spent.options.some((o) => o.tags.includes('moving')), spent.options.some((o) => o.tags.includes('moving')) ? spent.facts.roads : null]);
}

// ---------- the Automatic and Delay Phases ----------
{
  const { s, U, activate } = stage(3);
  activate(U.Raven);
  const d = owed(data, s, 's2', newMind());
  check('the Raven\'s Automatic Action opens a Counter-roll on the nearest enemy in its Range',
    [d.kind, ids(d), d.options[0].commands, d.options[0].tags], ['activation.act', [`electronic:166_A:${U.Mire.uid}`, 'end'],
      [{ kind: 'performAction', seat: 's2', uid: U.Raven.uid, actionId: '166_A', partKey: '166_A' }, { kind: 'startCounterRoll', seat: 's2', uid: U.Raven.uid, actionId: '166_A', targetUid: U.Mire.uid }], ['electronic', 'automatic']]);
  take(s, d, d.options[0].id);
  check('with the Counter-roll on the table the turn asks nothing of anyone: it is answered in its own window', [!!s.script.counter, asked(s)], [true, [null, null]]);
  const far = stage(3);
  far.at(far.U.Raven, 11, 11, 0);
  far.activate(far.U.Raven);
  check('with no enemy in its Range it has nothing to do but end', ids(owed(data, far.s, 's2', newMind())), ['end']);
  const p = stage(3);
  p.at(p.U.Mire, 5, 6, 0);
  p.activate(p.U.Porcupine);
  check('the Porcupine\'s Automatic shot takes the nearest enemy it can', ids(owed(data, p.s, 's2', newMind())), [`attack:543_A:${p.U.Mire.uid}`, 'end']);
  // An Automatic Action with a legal target is OBLIGATORY (3.5): on a map whose
  // terrain the engine knows, the activation may not simply be ended.
  const real = stage(3);
  real.s.map = 'alley';
  const terrain = M.TURN.terrainOf(data, real.s);
  const open = (c, r) => !!M.R.standingSpot(c, r, 3, false, terrain, [], undefined);
  // Three clear Grids in a row: the Drone, a gap (next to an enemy it would be
  // Melee Locked, and a Firing Action has no target then), the Mech.
  let pair = null;
  for (let r = 0; r < 12 && !pair; r++) for (let c = 0; c < 10 && !pair; c++) if (open(c, r) && open(c + 1, r) && open(c + 2, r)) pair = [c, r];
  for (const t of real.s.tokens) { t.col = 0; t.row = 0; t.deployed = false; }
  for (const t of [real.U.Porcupine, real.U.Mire]) t.deployed = true;
  real.at(real.U.Porcupine, pair[0], pair[1], 1); real.at(real.U.Mire, pair[0] + 2, pair[1], 3);
  real.activate(real.U.Porcupine);
  check('where the engine knows the terrain, an Automatic Action with a legal target is obligatory: ending is not an answer',
    [ids(owed(data, real.s, 's2', newMind())), M.C.check(data, real.s, { kind: 'endOpportunity', seat: 's2', uid: real.U.Porcupine.uid }).ok], [[`attack:543_A:${real.U.Mire.uid}`], false]);
  // A HOUND BESIDE AN ENEMY IN OPTICAL CAMOUFLAGE (the computer's games, wave 5,
  // seed 8527): its Tear is owed, and its answer is the attack through the free
  // Scan. There was none: the engine refused that Scan ("beyond Range 0") as it
  // refused the end, and the game stood still in the Automatic Phase.
  const hid = stage(3);
  hid.s.map = 'alley';
  for (const t of hid.s.tokens) { t.col = 0; t.row = 0; t.deployed = false; }
  for (const t of [hid.U.Porcupine, hid.U.Mire]) t.deployed = true;
  hid.U.Porcupine.cardId = 'ZHDR-203';
  hid.at(hid.U.Porcupine, pair[0], pair[1], 1); hid.at(hid.U.Mire, pair[0] + 1, pair[1], 3);
  hid.U.Mire.statuses = ['camouflage'];
  hid.activate(hid.U.Porcupine);
  check('a Hound beside an enemy in Optical Camouflage owes its Tear, and is asked it: the attack through its free Scan, and no end',
    ids(owed(data, hid.s, 's2', newMind())), [`attack:ZHDR-203_A:${hid.U.Mire.uid}:scan`]);
}
{
  const { s, U, activate } = stage(4);
  const missile = { ...M.U.makeDroneToken(s, data, data.byId.get('071'), 's1'), parentUid: U.Mire.uid, col: 16, row: 7, facing: 0 };
  s.tokens.push(missile);
  const des = owed(data, s, s.script.turn === 's1' ? 's1' : (run(s, { kind: 'passTurn', seat: 's2' }), 's1'), newMind());
  check('in the Delay Phase a squad designates its Projectile', [des.kind, des.options.filter((o) => o.tags.includes('designate')).map((o) => o.facts.uid)], ['loop.designate.delay', [missile.uid]]);
  activate(missile);
  const d = owed(data, s, 's1', newMind());
  const hits = d.options.filter((o) => o.tags.includes('detonate'));
  check('its Delayed Action: an Explosion on each enemy in its Range, never on an ally',
    hits.map((o) => o.facts.targetUid).sort(), [U.Raven.uid].sort());
  check('the Action is paid, the Missile flies into its target\'s Grid, and the Explosion is an attack like any other',
    [hits[0].run.routine, hits[0].run.args.mode, hits[0].run.args.before.map((c) => c.kind), hits[0].run.args.before[1].targetUid], ['attack', 'explosion', ['performAction', 'flyToTarget'], U.Raven.uid]);
  const lone = stage(4);
  const m2 = { ...M.U.makeDroneToken(lone.s, data, data.byId.get('071'), 's1'), parentUid: lone.U.Mire.uid, col: 1, row: 31, facing: 0 };
  lone.s.tokens.push(m2);
  lone.activate(m2);
  const none = owed(data, lone.s, 's1', newMind()).options.filter((o) => o.tags.includes('detonate'));
  check('with no enemy in its Range the Missile is destroyed: paid, then removed',
    none.map((o) => [o.id, o.commands.map((c) => c.kind), o.commands[1].targetUid === m2.uid]), [['detonate:071_A:none', ['performAction', 'despawn'], true]]);
  const hid = stage(4);
  const m3 = { ...M.U.makeDroneToken(hid.s, data, data.byId.get('071'), 's1'), parentUid: hid.U.Mire.uid, col: 16, row: 7, facing: 0 };
  hid.s.tokens.push(m3);
  hid.U.Raven.statuses = ['camouflage'];
  hid.at(hid.U['Wild Cat'], 11, 11, 0);
  hid.activate(m3);
  check('a target in Optical Camouflage is Scanned first, which is not offered yet: the Missile is neither aimed at it nor destroyed',
    owed(data, hid.s, 's1', newMind()).options.filter((o) => o.tags.includes('detonate')).length, 0);
}

// ---------- a Shutdown Mech, and a tie ----------
{
  const { s, U, turnOf } = stage(2);
  U.Mire.stance = 'shutdown'; U.Mire.link = 0;
  turnOf(U.Mire, 'firing');
  const d = owed(data, s, 's1', newMind());
  check('a Shutdown Mech whose Opportunity has come Reboots, into one of three Stances, and does nothing else with it',
    [d.kind, d.options.map((o) => [o.commands[0].kind, o.commands[0].stance]), d.fallback], ['opp.reboot', [['reboot', 'defensive'], ['reboot', 'mobility'], ['reboot', 'offensive']], 'reboot:defensive']);
}
{
  const { s, U } = stage(2);
  U.Mire.timing = 'firing'; U.Dune.timing = 'firing'; U['Wild Cat'].timing = 'movement';
  // Two Mechs of one squad tied on initiative: the squad picks which goes.
  const init = M.G.makeInit(data);
  const tie = init(U.Mire, 'firing') === init(U.Dune, 'firing');
  s.script.acted = []; s.script.opp = null;
  M.G.opportunity(data, s);
  const d = owed(data, s, 's1', newMind());
  check('two Mechs of a squad tied on initiative: the one not holding the turn may take it instead',
    [d.options.filter((o) => o.tags.includes('tied')).map((o) => o.commands[0].kind), tie], [tie ? ['chooseTied'] : [], tie]);
}

// ---------- the End Phase (3.7) and the end of the game ----------
{
  const { s } = stage(5);
  const fp = s.round.firstPlayer;
  const d = owed(data, s, fp, newMind());
  check('the End Phase is bookkeeping either seat may take, asked of both, the First Player expected to',
    [d.kind, d.shared, d.seat, owed(data, s, other(fp), newMind()).seat, ids(d), d.options[0].commands.map((c) => c.kind)], ['end.step', true, fp, fp, ['remove'], ['markEndStep']]);
  take(s, d, 'remove');
  check('its steps come in the book\'s order', ids(owed(data, s, fp, newMind())), ['tokens']);
  take(s, owed(data, s, fp, newMind()), 'tokens');
  check('with no Smoke on the board the Smoke step is skipped', ids(owed(data, s, fp, newMind())), ['tasks']);
  take(s, owed(data, s, fp, newMind()), 'tasks');
  check('then each squad says it is ready for the next round', [asked(s), owed(data, s, 's1', newMind()).options[0].label], [['phase.ready', 'phase.ready'], 'Start Round 2']);
  check('a game still to be played is not over', gameOver(data, s).over, false);
}
{
  // The last round: the Tasks step pays, and the game ends with it.
  const { s, U } = stage(5);
  s.round.n = 5; s.script.stage = '5:5';
  const fp = s.round.firstPlayer;
  // The Mire alone in a scoring zone at the end of the game.
  const echo = M.SEAT.viewOf(data, s, 's1').zones.find((z) => z.id === 'echo');
  const [c0, r0] = echo.cells[0].split(',').map(Number);
  U.Mire.col = c0 * 3; U.Mire.row = r0 * 3;
  take(s, owed(data, s, fp, newMind()), 'remove');
  take(s, owed(data, s, fp, newMind()), 'tokens');
  const tasks = owed(data, s, fp, newMind());
  const preview = M.S.previewScore(data, s, true);
  check('the Tasks step carries the Award the engine previews, so both tables add the same points',
    [tasks.options[0].commands.map((c) => c.kind), tasks.options[0].commands[0].vp, preview.lines.length > 0], [['award', 'markEndStep'], { s1: preview.s1, s2: preview.s2 }, true]);
  take(s, tasks, 'tasks');
  const over = gameOver(data, s);
  check('with the last round\'s steps done the game is over, and nothing more is asked of anyone',
    [over.over, over.vp, asked(s), over.winner], [true, { s1: preview.s1, s2: preview.s2 }, [null, null], preview.s1 > preview.s2 ? 's1' : preview.s2 > preview.s1 ? 's2' : over.winner]);
}
{
  const { s } = stage(2);
  run(s, { kind: 'concede', seat: 's2' });
  check('a concession ends the game at once', [gameOver(data, s).over, gameOver(data, s).winner, asked(s)], [true, 's1', [null, null]]);
  check('a table with no game on asks nothing', owed(data, freshState(M, data), 's1', newMind()), null);
}

M.L.setLocalSeat(null);
console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
