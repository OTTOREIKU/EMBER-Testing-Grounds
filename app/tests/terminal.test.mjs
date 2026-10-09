// A Terminals mission, played by a seat (rulebook 5.3.3;
// AI-OPPONENT-PLAN.md, M8.2e).
//
// A Terminal pays whoever has accessed it as a round ends: a squad holding its
// Tactical Zone at the End Phase accesses it there, and a Mech within Range 4
// of the zone may access it sooner with a Remote Access, a Counter-roll
// against the Terminal's Electronic Value of 3. The random-squad games showed
// the computer playing these three Tasks for a quarter of what it plays an
// Occupation for: the seam offered no Remote Access, and the Tactician's
// price list knew the Occupation alone. Staged here on the real engine: what
// the seam offers and to whom, the roll played out between two seats, what the
// view says of a Terminal, what the Tactician makes of it, and whole games.
import { botTable, loadEngine, tableAtRoundOne } from './_engine.mjs';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}\n       got  ${g}`); }
};

console.log('A Terminals mission\n');

const { M, data } = await loadEngine('terminal', ["export * as SEAT from '../src/seat';", "export * as AI from '../src/ai/index';", "export * as TURN from '../src/turn';"]);
const { owed, newMind } = M.SEAT;
const viewOf = (state, seat) => M.SEAT.viewOf(data, state, seat);
const AI = M.AI;
const clone = (x) => JSON.parse(JSON.stringify(x));
const near = (a, b) => Math.abs(a - b) < 1e-9;

// The copied squads, on the Alley, with a Terminal in Bravo, Echo and Hotel.
const scenario = { ...data.solo.scenarios[0], id: 't-terminal', mission: 'terminal-signal-reception' };
const run = (state, cmd) => {
  const v = M.C.check(data, state, cmd);
  if (v.ok) { M.C.apply(data, state, cmd); M.G.glueAfter(data, state, cmd); }
  return v;
};
const sendAll = (state, commands) => commands.map((c) => run(state, c).ok);
const ids = (d) => (d ? d.options.map((o) => o.id) : null);
const asked = (state) => ['s1', 's2'].map((seat) => owed(data, state, seat, newMind())?.kind ?? null);
const name = (t) => (t.label.startsWith('ADK15P') ? 'Porcupine' : t.label.startsWith('ADK60S') ? 'Raven' : t.label.startsWith('ADK30C') ? 'Tarantula' : t.label);

const base = (() => {
  const t = tableAtRoundOne(M, data, scenario);
  if (t.refused.length) throw new Error(t.refused.join('; '));
  return t.state;
})();
// Round 1, the Action Phase, no terrain, the enemy far off in a corner.
const stage = () => {
  const s = clone(base);
  s.map = 'none';
  const U = Object.fromEntries(s.tokens.map((t) => [name(t), t]));
  const at = (t, c, r, f) => { t.col = c * 3; t.row = r * 3; if (f !== undefined) t.facing = f; };
  at(U.Mire, 3, 3, 2); at(U.Dune, 0, 0, 2); at(U['Wild Cat'], 11, 11, 0); at(U.Porcupine, 11, 9, 0); at(U.Raven, 9, 11, 0); at(U.Tarantula, 11, 10, 0);
  s.round.phase = 2; s.script.stage = '1:2'; s.script.passed = []; s.script.revealed = ['s1', 's2']; s.script.opp = null;
  for (const t of s.tokens) if (t.kind === 'mech') t.timing = 'firing';
  const turnOf = (mech, timing) => {
    mech.timing = timing;
    s.script.acted = s.tokens.filter((x) => x.kind === 'mech' && x.uid !== mech.uid).map((x) => x.uid);
    s.script.opp = null;
    return M.G.opportunity(data, s);
  };
  const items = M.TK.normaliseTasks(s.tasks).items;
  const zone = (label) => viewOf(s, 's1').zones.find((z) => z.name === label);
  const terminal = (label) => items.find((i) => i.kind === 'terminal' && i.zone === zone(label).id);
  return { s, U, at, turnOf, zone, terminal };
};
M.L.setLocalSeat('s1');

// ---------- what the view says of a Terminals Task ----------
{
  const { s, zone } = stage();
  const v = viewOf(s, 's1');
  check('the Task is read off its card: 2 Victory Points for each Terminal accessed, every round from the first, a Remote Access from four Grids off',
    v.task, { family: 'terminal', vp: 2, fromRound: 1, cadence: 'per-round', perPart: 0, scoringZone: null, reach: 4 });
  check('it puts a Terminal in Bravo, Echo and Hotel, and those are the zones it scores',
    [M.TK.normaliseTasks(s.tasks).items.filter((i) => i.kind === 'terminal').length, v.zones.filter((z) => z.scoring).map((z) => z.name).sort(), v.zones.filter((z) => 'accessed' in z).map((z) => z.name).sort()],
    [3, ['Bravo', 'Echo', 'Hotel'], ['Bravo', 'Echo', 'Hotel']]);
  check('every Terminal is open as the round begins, and nobody stands in its zone', ['Bravo', 'Echo', 'Hotel'].map((z) => [zone(z).accessed, zone(z).holder]), [[null, null], [null, null], [null, null]]);
}

// ---------- the Remote Access ----------
{
  const { s, U, turnOf, zone, terminal } = stage();
  // The Mire at D4: three Grids from Bravo, four from Echo, eight from Hotel.
  turnOf(U.Mire, 'tactical');
  const d = owed(data, s, 's1', newMind());
  const access = d.options.filter((o) => o.tags[0] === 'terminal');
  check('on a Tactical dial a Mech is offered a Remote Access at each Terminal whose zone is within its Range and still open: Bravo and Echo, not Hotel',
    access.map((o) => o.id), [`terminal:COMMON_REMOTE_ACCESS:${terminal('Bravo').id}`, `terminal:COMMON_REMOTE_ACCESS:${terminal('Echo').id}`]);
  const echo = access.find((o) => o.facts.zone === zone('Echo').id);
  check('the answer pays for the Action and opens a Counter-roll against that Terminal',
    [echo.commands.map((c) => c.kind), echo.commands[0].actionId, echo.commands[1].terminal, echo.commands[1].targetUid, echo.commands[1].uid, echo.tags, echo.facts],
    [['performAction', 'startCounterRoll'], 'COMMON_REMOTE_ACCESS', terminal('Echo').id, M.TK.TERMINAL_UID, U.Mire.uid, ['terminal', 'electronic'],
      { uid: U.Mire.uid, actionId: 'COMMON_REMOTE_ACCESS', zone: zone('Echo').id, itemId: terminal('Echo').id }]);
  check('it is a kind of its own for an asker that is only looking, and no attack', [ids(owed(data, s, 's1', newMind(), { only: ['terminal'] })), owed(data, s, 's1', newMind(), { only: ['attack'] })], [access.map((o) => o.id), null]);
  const t2 = clone(s);
  check('the engine takes both commands: the roll is on the table, the Mech its Initiator and the Terminal its Responder, and nothing else is asked until it is rolled',
    [sendAll(t2, echo.commands), t2.script.counter.initiatorUid, t2.script.counter.responderUid, t2.script.counter.terminal, asked(t2)],
    [[true, true], U.Mire.uid, M.TK.TERMINAL_UID, terminal('Echo').id, [null, null]]);

  // Where it is not offered.
  const far = stage();
  far.at(far.U.Mire, 0, 0, 2); far.at(far.U.Dune, 3, 3, 2);
  far.turnOf(far.U.Mire, 'tactical');
  check('out of Range of every Terminal\'s zone there is none to make', owed(data, far.s, 's1', newMind()).options.filter((o) => o.tags[0] === 'terminal'), []);
  const done = stage();
  const items = M.TK.normaliseTasks(done.s.tasks);
  items.items.find((i) => i.id === done.terminal('Echo').id).accessed = 's2';
  done.s.tasks = items;
  done.turnOf(done.U.Mire, 'tactical');
  check('a Terminal already accessed this round is nobody\'s to access again: only Bravo is offered',
    owed(data, done.s, 's1', newMind()).options.filter((o) => o.tags[0] === 'terminal').map((o) => o.facts.zone), [done.zone('Bravo').id]);
  const fire = stage();
  fire.turnOf(fire.U.Mire, 'firing');
  check('it is a Tactical Action: a Firing dial does not open with it', owed(data, fire.s, 's1', newMind()).options.filter((o) => o.tags[0] === 'terminal'), []);
  const drone = stage();
  drone.at(drone.U.Porcupine, 3, 3, 0);
  drone.s.round.phase = 3; drone.s.script.stage = '1:3'; drone.s.script.acted = [];
  drone.s.script.opp = M.TY.newOpportunity(drone.U.Porcupine.uid, undefined);
  check('a Drone has no Remote Access: the Common Actions are a Mech\'s', owed(data, drone.s, 's2', newMind()).options.filter((o) => o.tags[0] === 'terminal'), []);
}

// ---------- what the Tactician makes of it ----------
{
  const { s, U, at, zone, terminal } = stage();
  const W = AI.TACTICIAN;
  const later = [1, 2, 3, 4].reduce((n, r) => n + W.missionFuture ** r, 0);
  check('with nobody in any zone and nothing accessed, the Task is worth what is banked: nothing', AI.missionOf(viewOf(s, 's1'), W), 0);
  // The Mire in Echo.
  at(U.Mire, 5, 5, 2);
  check('a zone held pays its Terminal this round and every round after while it is held, each further off for less',
    [zone('Echo').holder, near(AI.missionOf(viewOf(s, 's1'), W), 2 * (1 + later)), near(AI.missionOf(viewOf(s, 's2'), W), -2 * (1 + later))], ['s1', true, true]);
  // The other squad accesses it from afar before the round ends.
  const tasks = M.TK.normaliseTasks(s.tasks);
  tasks.items.find((i) => i.id === terminal('Echo').id).accessed = 's2';
  s.tasks = tasks;
  check('a Terminal the other squad has accessed pays THEM this round, whoever stands in its zone; next round it is open again and the zone\'s holder has it',
    [zone('Echo').accessed, near(AI.missionOf(viewOf(s, 's1'), W), 2 * (-1 + later))], ['s2', true]);
  tasks.items.find((i) => i.id === terminal('Echo').id).accessed = 's1';
  s.tasks = tasks;
  check('and one this squad has accessed is its own for the round', near(AI.missionOf(viewOf(s, 's1'), W), 2 * (1 + later)), true);
  check('only a Terminals Task has a reach: every other Main Task says 0',
    data.missions.cards.filter((c) => c.family !== 'terminal').map((c) => viewOf({ ...base, mission: c.id }, 's1').task.reach).filter((r) => r !== 0), []);
  check('a Task scored by standing in its zones is an Occupation or Terminals, and no other',
    data.missions.cards.filter((c) => AI.zoned(viewOf({ ...base, mission: c.id }, 's1'))).map((c) => c.family).filter((f, i, a) => a.indexOf(f) === i).sort(), ['control', 'terminal']);
}
M.L.setLocalSeat(null);
{
  // Its own choice, asked of the policy through a driver, on a staged table:
  // the Mire on a Tactical dial with nobody to shoot, four Grids from Echo and
  // three from Bravo, and the other squad's Drone standing in Echo.
  const table = async (weights) => {
    const t = botTable(M, data, { ...scenario, map: 'none' }, { seed: 3, policies: { s1: AI.makeTactician({ focus: false }, weights), s2: AI.eagerPolicy } });
    await t.run({ until: (st) => M.SU.normaliseSetup(st.setup)?.stage === 'done' && st.round.phase === 2 });
    const U = Object.fromEntries(t.state.tokens.map((x) => [name(x), x]));
    const at = (x, c, r, f) => { x.col = c * 3; x.row = r * 3; if (f !== undefined) x.facing = f; };
    at(U.Mire, 3, 3, 0); at(U.Dune, 0, 0, 2); at(U['Wild Cat'], 11, 11, 0); at(U.Porcupine, 5, 5, 0); at(U.Raven, 9, 11, 0); at(U.Tarantula, 11, 10, 0);
    U.Mire.timing = 'tactical';
    t.state.script.revealed = ['s1', 's2'];
    t.state.script.acted = t.state.tokens.filter((x) => x.kind === 'mech' && x.uid !== U.Mire.uid).map((x) => x.uid);
    t.state.script.opp = null;
    M.G.opportunity(data, t.state);
    return { t, U };
  };
  const zoneId = (t, label) => viewOf(t.state, 's1').zones.find((z) => z.name === label).id;
  // The worth of an access is a weight, 0 as it ships (measured: the plan,
  // section 12); given one, this is what it does with it.
  const a = await table({ access: 0.5, ewOdds: 0 });
  const d = a.t.drivers.s1.pending();
  const plans = AI.weighed(d, viewOf(a.t.state, 's1'), { focus: false }, { access: 0.5, ewOdds: 0 });
  const best = plans[0];
  check('with the other squad\'s Drone standing in Echo, the Tactician\'s best plan is a Remote Access at ECHO: taken from them it pays twice, and Bravo, which nobody holds, pays once',
    [/Remote Access: the Terminal in Echo/.test(best.does) || /Remote Access: the Terminal in Echo/.test(best.label), near(best.now, 0.5 * 2 * 2)], [true, true]);
  // The plan may begin with its Maneuver (which comes before any Action): the
  // access is made within the next answers.
  const made = [];
  for (let i = 0; i < 3 && !made.some((x) => x[0] === 'terminal'); i++) {
    const step = await a.t.drivers.s1.step();
    if (step.kind !== 'acted') break;
    made.push([step.option.tags[0], step.option.facts?.zone ?? null]);
  }
  check('and that is what it does, behind its Maneuver if the plan begins with one',
    [made.at(-1), made.slice(0, -1).every((x) => x[0] === 'move' || x[0] === 'stance')], [['terminal', zoneId(a.t, 'Echo')], true]);
  a.t.close();
  // With the Counter-roll's odds read (`ewOdds`, M12), an access is weighed at
  // the chance its roll is won (`Option.win`), not at a chance it never read.
  const o = await table({ access: 1, ewOdds: 1 });
  const od = o.t.drivers.s1.pending();
  const echo = od.options.find((x) => x.tags[0] === 'terminal' && x.facts?.zone === zoneId(o.t, 'Echo'));
  const p = echo?.win?.();
  const oplans = AI.weighed(od, viewOf(o.t.state, 's1'), { focus: false }, { access: 1, ewOdds: 1 });
  const top = oplans.find((x) => /Remote Access: the Terminal in Echo/.test(x.does) || /Remote Access: the Terminal in Echo/.test(x.label));
  check('WITH THE COUNTER-ROLL\'S ODDS READ, an access is worth the chance its roll is won: Echo\'s, taken from the Drone there, at that chance of twice what it pays',
    [typeof p === 'number' && p > 0 && p < 1, !!top && near(top.now, p * 2 * 2)], [true, true]);
  o.t.close();
  const b = await table({});
  const none = AI.weighed(b.t.drivers.s1.pending(), viewOf(b.t.state, 's1'), { focus: false });
  // (Since 2026-10-04 the access ships at its roll's odds: `access` 1, `ewOdds` 1.)
  check('as it ships an access is weighed at the odds of its Counter-roll, and with the Drone of the other squad in Echo it is planned',[AI.TACTICIAN.access, AI.TACTICIAN.ewOdds, none.some((p) => /Remote Access/.test(p.does) || /Remote Access/.test(p.label))], [1, 1, true]);
  b.t.close();
  // A zone this squad already holds pays its Terminal as the round ends: an
  // access there gains nothing. The Mire at F3, with Echo alone in its Range,
  // and the squad's own Dune standing in Echo.
  const own = await table({ access: 0.5, ewOdds: 0 });
  const put = (x, c, r) => { x.col = c * 3; x.row = r * 3; };
  put(own.U.Mire, 5, 2); put(own.U.Dune, 5, 5); put(own.U.Porcupine, 11, 9);
  own.t.state.script.opp = null;
  M.G.opportunity(data, own.t.state);
  const asked = own.t.drivers.s1.pending();
  const offered = asked.options.filter((o) => o.tags[0] === 'terminal').map((o) => o.facts.zone);
  const weighed = AI.weighed(asked, viewOf(own.t.state, 's1'), { focus: false }, { access: 0.5, ewOdds: 0 });
  check('a Terminal in a zone the squad already holds is offered and is worth nothing to access: no plan makes one',
    [offered, viewOf(own.t.state, 's1').zones.find((z) => z.name === 'Echo').holder, weighed.some((p) => /Remote Access/.test(p.does) || /Remote Access/.test(p.label))],
    [[zoneId(own.t, 'Echo')], 's1', false]);
  own.t.close();
}

// ---------- the roll, played between two seats ----------
{
  // The Mech's dice all hit and the Terminal's all blank: the roll is won.
  const seeded = new AI.Rng('4:terminal');
  let fixed = false;
  let want = '';
  const script = (pick) => ({
    name: 'scripted',
    choose(d, view, rng) {
      const id = pick(d);
      return id && d.options.some((o) => o.id === id) ? { option: id, why: 'scripted' } : AI.eagerPolicy.choose(d, view, rng);
    },
  });
  const t = botTable(M, data, { ...scenario, map: 'none' }, {
    seed: 4,
    dice: (pool, label) => Object.entries(pool).flatMap(([color, n]) => Array.from({ length: n }, () => ({
      color, face: !fixed ? seeded.int(data.dice.dice[color].sides) : /Electronic Counter-roll/.test(label) ? 0 : 7,
    }))),
    policies: { s1: script((d) => (d.kind === 'opp.act' ? (d.options.some((o) => o.id === want) ? want : 'end') : null)), s2: script((d) => (d.kind === 'opp.act' ? 'end' : null)) },
  });
  await t.run({ until: (st) => M.SU.normaliseSetup(st.setup)?.stage === 'done' && st.round.phase === 2 });
  fixed = true;
  const U = Object.fromEntries(t.state.tokens.map((x) => [name(x), x]));
  const at = (x, c, r) => { x.col = c * 3; x.row = r * 3; };
  at(U.Mire, 3, 3); at(U.Dune, 0, 0); at(U['Wild Cat'], 11, 11); at(U.Porcupine, 11, 9); at(U.Raven, 9, 11); at(U.Tarantula, 11, 10);
  const echo = viewOf(t.state, 's1').zones.find((z) => z.name === 'Echo');
  const item = M.TK.normaliseTasks(t.state.tasks).items.find((i) => i.kind === 'terminal' && i.zone === echo.id);
  want = `terminal:COMMON_REMOTE_ACCESS:${item.id}`;
  U.Mire.timing = 'tactical';
  t.state.script.revealed = ['s1', 's2'];
  t.state.script.acted = t.state.tokens.filter((x) => x.kind === 'mech' && x.uid !== U.Mire.uid).map((x) => x.uid);
  t.state.script.opp = null;
  M.G.opportunity(data, t.state);
  const before = t.sent.length;
  const end = await t.run({ until: (st) => t.sent.slice(before).some((x) => x.kind === 'clearCounterRoll') && !st.script.counter, maxSteps: 200 });
  const kinds = t.sent.slice(before).map((x) => `${x.seat}:${x.kind}`);
  check('PLAYED: the Mire pays and opens the roll, the OTHER squad throws the Terminal\'s dice, and the roll won, the Terminal is accessed',
    [end.kind, t.refused, kinds.slice(0, 2), kinds.includes('s1:rollCounter'), kinds.includes('s2:rollTerminal'), kinds.includes('s1:accessTerminal'),
      viewOf(t.state, 's2').zones.find((z) => z.id === echo.id).accessed],
    ['paused', [], ['s1:performAction', 's1:startCounterRoll'], true, true, true, 's1']);
  // On to the End Phase: the Award pays it.
  const vp = M.TK.normaliseTasks(t.state.tasks).vp.s1;
  const paid = await t.run({ until: (st) => st.round.n === 2, maxSteps: 400 });
  check('and it pays as the round ends: 2 Victory Points, to the squad that accessed it', [paid.kind, M.TK.normaliseTasks(t.state.tasks).vp.s1 - vp, t.refused], ['paused', 2, []]);
  check('the next round every Terminal is open again', viewOf(t.state, 's1').zones.filter((z) => 'accessed' in z).map((z) => z.accessed), [null, null, null]);
  t.close();
}

// ---------- whole games ----------
{
  const tally = { games: 0, over: 0, refused: 0, mine: 0, theirs: 0, access: 0, broken: [] };
  for (const seat of ['s1', 's2']) {
    for (const seed of [1, 2, 3]) {
      const other = seat === 's1' ? 's2' : 's1';
      const t = botTable(M, data, scenario, { seed, policies: { [seat]: AI.makeTactician({ focus: false }), [other]: AI.eagerPolicy } });
      let end;
      try { end = await t.run({ maxSteps: 9000 }); } catch (err) { end = { kind: 'threw', why: err.message }; } finally { t.close(); }
      tally.games += 1;
      if (end.kind === 'over') tally.over += 1; else tally.broken.push(`${seat} ${seed}: ${end.kind} ${end.why ?? ''}`);
      tally.refused += t.refused.length;
      const vp = M.TK.normaliseTasks(t.state.tasks).vp;
      tally.mine += vp[seat]; tally.theirs += vp[other];
      tally.access += t.sent.filter((x) => x.seat === seat && x.kind === 'accessTerminal').length;
    }
  }
  check('six games of the copied squads on a Terminals mission, the Tactician in each seat against the eager policy (which fights and plays no Task): every one ends as a game should, nothing refused',
    [tally.over, tally.games, tally.refused, tally.broken], [6, 6, 0, []]);
  check('and the Tactician plays the Task: it outscores the eager policy over them', tally.mine > tally.theirs, true);
  console.log(`       Victory Points ${tally.mine} to ${tally.theirs}; ${tally.access} Terminals accessed from afar by the Tactician`);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
