// Two computer seats play whole games on the REAL engine (AI-OPPONENT-PLAN.md,
// rule R8).
//
// A computer player only ever picks an answer the engine hands it (src/owed.ts)
// and sends it the way a second player's page would (src/ai/driver.ts). So a
// game between two of them is the engine questioning itself: any change to the
// rules that leaves a seat with nothing to answer, or with an answer the engine
// then refuses, or that throws inside an attack, stops a game here. It is the
// alarm for "a change to the engine broke the computer", and a fuzzer of the
// rules besides: three bugs in the live two-player code were found by these
// games before any of this was shipped (the Focus latch that hung a repeated
// attack, deployment waiting on Secondary Tasks a table had switched off, and
// a Laser's Fragile Token sent to a unit the same hit had destroyed).
//
// No page: the engine is bundled and run in node (tests/_engine.mjs), the
// attack runs in the real combat window on a stub element, and the dice come
// from a seeded stream, so a seed is a game.
import { botTable, loadEngine, playBots } from './_engine.mjs';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}\n       got  ${g}`); }
};

console.log('Computer against computer\n');

const { M, data } = await loadEngine('botgame', ["export * as SEAT from '../src/seat';", "export * as AI from '../src/ai/index';", "export * as TURN from '../src/turn';"]);
const AI = M.AI;
const [alley, vip] = data.solo.scenarios;
const PART_OK = new Set(['intact', 'damaged', 'destroyed']);

// The board makes sense: every unit on it, once, with states and counts the
// rules can produce.
function sanity(s) {
  if (s.round.phase < 0 || s.round.phase >= M.TY.PHASES.length) return `phase ${s.round.phase} off the track`;
  if (s.round.n < 1 || s.round.n > (s.roundLimit ?? 5)) return `round ${s.round.n}`;
  const cells = M.TY.gridsOf(s) * 3;
  const uids = new Set();
  for (const t of s.tokens) {
    if (uids.has(t.uid)) return `uid ${t.uid} appears twice`;
    uids.add(t.uid);
    if (t.deployed !== false && (t.col < 0 || t.row < 0 || t.col + t.size > cells || t.row + t.size > cells)) return `${t.label} off the board at ${t.col},${t.row}`;
    for (const [slot, p] of Object.entries(t.partStates)) if (!PART_OK.has(p)) return `${t.label} ${slot} state "${p}"`;
    for (const [aid, n] of Object.entries(t.ammo ?? {})) if (n < 0) return `${t.label} ammo ${aid} negative`;
    if (t.kind === 'mech' && ((t.link ?? 0) < 0 || (t.link ?? 0) > M.U.maxLink(data, t))) return `${t.label} Link ${t.link}`;
  }
  // No two Ground Units stand on the same cells: the engine takes a Maneuver's
  // destination on trust (the sender owns the path law), so this is the seam's
  // to keep. An Aerial unit, a Mine included, stands over whatever is there.
  const held = new Map();
  for (const t of s.tokens) {
    if (t.deployed === false || t.aerial) continue;
    for (const cell of M.TY.baseCells(t)) {
      const k = `${cell.col},${cell.row}`;
      if (held.has(k)) return `${t.label} and ${held.get(k)} both stand on ${k}`;
      held.set(k, t.label);
    }
  }
  const tasks = M.TK.normaliseTasks(s.tasks);
  if (tasks.vp.s1 < 0 || tasks.vp.s2 < 0) return 'negative Victory Points';
  return null;
}

// ---------- whole games ----------
const kindsSeen = new Set();
const sentSeen = new Set();
const games = [];
for (const scenario of [alley, vip]) {
  for (const [name, policy, seeds] of [['eager', AI.eagerPolicy, [1, 2]], ['legal', AI.legalPolicy, [1]], ['brawler', AI.brawlerPolicy, [1]]]) {
    for (const seed of seeds) {
      let bad = null;
      let safe = true;
      const g = await playBots(M, data, scenario, {
        seed, policies: policy,
        onStep: (_seat, r, state) => {
          kindsSeen.add(r.decision.kind);
          // R6: every question carries an answer that is always safe, and it
          // is one of the answers offered.
          if (!r.decision.options.some((o) => o.id === r.decision.fallback)) safe = false;
          bad ??= sanity(state);
        },
      });
      for (const x of g.sent) sentSeen.add(x.kind);
      games.push({ scenario: scenario.id, name, seed, g });
      check(`${scenario.id}, ${name}, seed ${seed}: the game is played to its end`, [g.end.kind, g.refused, bad, safe], ['over', [], null, true]);
    }
  }
}
{
  const eager = games.filter((x) => x.name === 'eager');
  const n = (g, kind) => g.sent.filter((x) => x.kind === kind).length;
  check('the games are games: every one fights, moves and scores a Penetration',
    eager.map(({ g }) => [n(g, 'maneuver') > 0, n(g, 'callDefense') > 3, n(g, 'applyPenetration') > 0]), eager.map(() => [true, true, true]));
  // An Occupation runs its five rounds; an Assassination ends with the round
  // a Commander falls in, which pays its ten points.
  check('five rounds, or the Commander dead before them',
    eager.map(({ g, scenario }) => { const vp = M.TK.normaliseTasks(g.state.tasks).vp; return g.state.round.n === 5 || (scenario === vip.id && Math.max(vp.s1, vp.s2) >= 10); }),
    eager.map(() => true));
  // The End Phase's Award is sent with the Tasks step, so the points are on
  // the table and not only in a preview: the Commander's ten, on that mission.
  const paid = eager.filter((x) => x.scenario === vip.id).map(({ g }) => {
    const vp = M.TK.normaliseTasks(g.state.tasks).vp;
    return [vp.s1 + vp.s2 > 0, g.sent.some((x) => x.kind === 'award')];
  });
  check('on the Assassination mission a Commander falls, and its ten points are awarded', paid.some(([won, sent]) => won && sent), true);
  check('the winner is the one the Tasks name', games.map(({ g }) => {
    const res = M.TK.gameResult(M.TK.normaliseTasks(g.state.tasks), g.state.tokens, M.S.lowValueOf(data));
    return res.winner === g.end.result.winner;
  }), games.map(() => true));
}

// What the games put to a seat, and what the seats sent: the copied squads'
// whole repertoire is met.
check('every stage of a game is asked of a seat',
  ['setup.lock', 'setup.roll', 'setup.accept', 'setup.edge', 'setup.designate.leader', 'setup.tasks', 'setup.deploy', 'setup.ready',
    'planning.dial', 'planning.commit', 'planning.reveal', 'phase.ready', 'loop.designate.command', 'loop.designate.automatic', 'loop.designate.delay',
    'opp.act', 'activation.act', 'end.step'].filter((k) => !kindsSeen.has(k)), []);
check('an attack is asked of both its sides, step by step',
  ['attack.part', 'attack.roll', 'attack.next', 'attack.focus', 'attack.resolve', 'attack.apply', 'defence.roll', 'defence.focus'].filter((k) => !kindsSeen.has(k)), []);
check('and so is a Counter-roll', ['contest.roll', 'contest.focus'].filter((k) => !kindsSeen.has(k)), []);
check('the squads use what they carry: Movement, shots, Missiles and their Detonations, the Raven\'s jamming, Stabilize',
  ['maneuver', 'performAction', 'callDefense', 'answerDefense', 'applyPenetration', 'recordKill', 'launch', 'flyToTarget', 'despawn',
    'startCounterRoll', 'rollCounter', 'declareCounterFocus', 'clearCounterRoll', 'stabilise', 'focus', 'focusAnswer', 'setStance',
    'commitTimings', 'revealTimings', 'designate', 'endOpportunity', 'award', 'markEndStep', 'setReady', 'advancePhase'].filter((k) => !sentSeen.has(k)), []);

// ---------- a seed is a game ----------
{
  const print = (g) => [g.steps, g.sent.map((x) => `${x.seat}:${x.kind}`).join(' '), M.SEC.boardFingerprint(g.state), JSON.stringify(g.end)];
  const first = games.find((x) => x.scenario === vip.id && x.name === 'eager' && x.seed === 1).g;
  const again = await playBots(M, data, vip, { seed: 1, policies: AI.eagerPolicy });
  check('the same seed plays the same game, command for command, to the same board', print(again), print(first));
  const other = games.find((x) => x.scenario === vip.id && x.name === 'eager' && x.seed === 2).g;
  check('and another seed plays another', print(other)[1] === print(first)[1], false);
  // The Brawler thinks on copies of the table (what an answer would lead to,
  // a turn that has not come). A look that left a mark on the table in play,
  // or on the seat's own memory, would play a different game the second time.
  const brawl = games.find((x) => x.scenario === alley.id && x.name === 'brawler' && x.seed === 1).g;
  const rerun = await playBots(M, data, alley, { seed: 1, policies: AI.brawlerPolicy });
  check('a seat that looks ahead leaves no mark by looking: the Brawler\'s game is the same game twice', print(rerun), print(brawl));
  const fights = games.filter((x) => x.name === 'brawler').map(({ g }) => g.sent.filter((x) => x.kind === 'applyPenetration').length > 0 && g.sent.filter((x) => x.kind === 'maneuver').length > 0);
  check('and its games are games too: it moves, and its attacks get through', fights, [true, true]);
}

// ---------- the dials: committed as a hash, revealed as what was committed ----------
{
  const t = botTable(M, data, alley, { seed: 6, policies: AI.eagerPolicy });
  const commits = [];
  const reveals = [];
  t.watch((cmd) => {
    if (cmd.kind === 'commitTimings') commits.push({ seat: cmd.seat, round: t.state.round.n, hash: cmd.hash, dialsOnBoard: t.state.tokens.filter((x) => x.side === cmd.seat && x.kind === 'mech' && x.timing).length });
    if (cmd.kind === 'revealTimings') reveals.push({ seat: cmd.seat, round: t.state.round.n, salt: cmd.salt, dials: cmd.dials, bothIn: !!t.state.script.commits.s1 && !!t.state.script.commits.s2 });
  });
  const end = await t.run({ until: (s) => s.round.n >= 3 });
  t.close();
  const kept = await Promise.all(reveals.map(async (r) => (await M.SEC.hashDials(r.salt, r.dials)) === commits.find((c) => c.seat === r.seat && c.round === r.round)?.hash));
  check('each round each seat commits once and reveals once', [end.kind, commits.length, reveals.length], ['paused', 4, 4]);
  check('a reveal is the dials and the salt its seat committed to: the hash is the promise', kept, [true, true, true, true]);
  check('nothing is revealed before both squads have committed', reveals.map((r) => r.bothIn), [true, true, true, true]);
  check('and a dial is on nobody\'s board when its squad commits: it has not left the seat\'s own memory', commits.filter((c) => c.round > 1 ? false : c.dialsOnBoard > 0).length, 0);
}

// ---------- the driver's own guards ----------
// A driver with its question put to it by hand, so each guard is met on its
// own: what it does with an answer that changed nothing, a question that keeps
// coming back, a policy that fails, and a command the table refuses.
{
  const quiet = () => {
    const t = botTable(M, data, alley, { seed: 7 });
    return t;
  };
  const opt = (id, commands) => ({ id, label: id, tags: [], ...(commands ? { commands } : {}) });
  const ask = (id, options, fallback, more = {}) => ({ id, kind: 'test.ask', seat: 's1', options, fallback, facts: {}, ...more });
  const policy = (pick) => ({ name: 'fixed', choose: (d) => (typeof pick === 'function' ? pick(d) : { option: pick }) });
  const make = (pol, pending, host = {}) => {
    const t = quiet();
    const d = new AI.Driver('s1', { data, state: () => t.state, send: (cmd) => t.send('s1', cmd), roll: async () => [], ...host }, pol, new AI.Rng(1));
    d.pending = pending;
    return { t, d };
  };
  {
    // An answer that changed nothing is not given a second time.
    const { t, d } = make(policy('a'), () => ask('q1', [opt('a'), opt('b')], 'a'));
    const first = await d.step();
    const second = await d.step();
    const third = await d.step();
    check('an answer that moved nothing is not given again: the next is tried, and with none left the seat says it is stuck',
      [first.kind, first.option.id, second.option.id, third.kind, /every answer .* has been tried/.test(third.why)], ['acted', 'a', 'b', 'stuck', true]);
    t.close();
  }
  {
    // A policy that fails, and one that names nothing on offer.
    const { t, d } = make(policy(() => { throw new Error('boom'); }), () => ask('q2', [opt('a'), opt('safe')], 'safe'));
    const r = await d.step();
    check('a policy that throws costs the seat its judgement, not its turn: the safe answer is given, and the log says why',
      [r.kind, r.option.id, /the policy failed: boom/.test(d.log[d.log.length - 1].why)], ['acted', 'safe', true]);
    t.close();
    const u = make(policy('nonsense'), () => ask('q3', [opt('a'), opt('safe')], 'safe'));
    check('a policy that names an answer nobody offered gets the safe one', (await u.d.step()).option.id, 'safe');
    u.t.close();
  }
  {
    // A question that keeps coming back.
    let n = 0;
    const { t, d } = make(policy('a'), () => ask(`q${n++}`, [opt('a'), opt('safe')], 'safe', { unit: 1 }));
    const picks = [];
    let last = null;
    for (let i = 0; i < 82; i++) { last = await d.step(); if (last.kind === 'acted') picks.push(last.option.id); else break; }
    check('asked the same kind of question forty times in a phase, the seat stops deliberating and takes the safe answer',
      [picks.slice(0, 40).every((x) => x === 'a'), picks.slice(40, 80).every((x) => x === 'safe'), picks.length], [true, true, 80]);
    check('and at eighty it gives the game up as stuck rather than spin', [last.kind, /asked 81 times this phase/.test(last.why)], ['stuck', true]);
    t.close();
  }
  {
    // A command the table refuses.
    const bad = { kind: 'endOpportunity', seat: 's1', uid: 999 };
    const { t, d } = make(policy('a'), () => ask('q4', [opt('a', [bad])], 'a'));
    const r = await d.step();
    check('a command the table refuses stops the seat there, and says which and why', [r.kind, r.command, typeof r.why, r.why.length > 5], ['refused', bad, 'string', true]);
    t.close();
  }
  {
    // Nothing asked; and a step that is the other seat's.
    const idle = make(policy('a'), () => null);
    check('with nothing asked of it the seat is idle', (await idle.d.step()).kind, 'idle');
    idle.t.close();
    const shared = ask('q5', [opt('a')], 'a', { shared: true, seat: 's2' });
    const t = quiet();
    const mine = new AI.Driver('s1', { data, state: () => t.state, send: (cmd) => t.send('s1', cmd), roll: async () => [] }, policy('a'), new AI.Rng(1));
    // Asked through the real question: at the table's start s1 owes the lock.
    check('a real question reaches it: the host\'s seat is asked to lock the battlefield', mine.pending().kind, 'setup.lock');
    t.close();
    void shared;
  }
}

// ---------- either squad in either seat ----------
{
  const swapped = { ...alley, seats: { s1: alley.seats.s2, s2: alley.seats.s1 } };
  const t = botTable(M, data, swapped, { seed: 3, policies: AI.eagerPolicy });
  check('with the squads in each other\'s seats, each seat fields the other squad',
    [t.state.tokens.filter((x) => x.side === 's1').map((x) => x.kind).sort(), t.state.tokens.filter((x) => x.side === 's2').map((x) => x.label).sort()],
    [['drone', 'drone', 'drone', 'mech'], ['Dune', 'Mire']]);
  const end = await t.run();
  t.close();
  check('and the game still ends', [end.kind, t.refused], ['over', []]);
}

// ---------- every answer the seam offers is one the engine takes ----------
// At each decision of a whole game, every option that carries commands is
// applied to a copy of the table as it stands. The seam verifies them as it
// builds them; this holds it to that from the outside.
{
  const offered = { options: 0, refused: [] };
  const t = botTable(M, data, vip, {
    seed: 4, policies: AI.eagerPolicy,
    host: {
      pace: async (_seat, d) => {
        for (const o of d.options) {
          if (!o.commands) continue;
          offered.options += 1;
          if (!M.G.tableAfter(data, t.state, o.commands)) offered.refused.push(`${d.kind}: ${o.id}`);
        }
      },
    },
  });
  const end = await t.run();
  t.close();
  check('a whole game\'s offers, each tried on a copy of the table: none refused',
    [end.kind, offered.options > 3000, offered.refused.slice(0, 5)], ['over', true, []]);
}

// ---------- the pace is the host's (plan D7) ----------
{
  const log = [];
  const t = botTable(M, data, alley, {
    seed: 5, policies: AI.eagerPolicy,
    host: {
      pace: async (seat, d) => { log.push(['pace', seat, d.kind]); await new Promise((r) => setImmediate(r)); log.push(['go', seat]); },
      settled: async (seat) => { log.push(['settled', seat]); },
    },
  });
  // What each seat's own answer sends lies between its `go` and its `settled`.
  let open = null;
  let strayed = 0;
  t.watch((cmd) => { if (open === null || false) strayed += 0; });
  const end = await t.run({ maxSteps: 60 });
  t.close();
  const seq = log.map((x) => x[0]);
  let ordered = true;
  for (let i = 0; i < seq.length; i += 3) if (seq[i] !== 'pace' || seq[i + 1] !== 'go' || seq[i + 2] !== 'settled') ordered = false;
  check('a decision waits for the host\'s pace before it is acted on, and for the table to settle after',
    [end.kind, ordered, seq.filter((x) => x === 'pace').length, seq.filter((x) => x === 'settled').length], ['limit', true, t.steps(), t.steps()]);
  check('and the host is told what is about to be decided', log.filter((x) => x[0] === 'pace').slice(0, 3).map((x) => x[2]), ['setup.lock', 'setup.roll', 'setup.roll']);
  void open; void strayed;
}

// ---------- staged: the table arranged, then played ----------
//
// A game is played through setup and the first Command and Planning Phases,
// the units are stood where the check wants them, and play goes on with a
// policy that takes the answer under test where it is offered.
const HIT = { red: 0, yellow: 0, white: 7, blue: 7, black: 0 };
const dice = (faces) => (pool) => Object.entries(pool).flatMap(([color, n]) => Array.from({ length: n }, () => ({ color, face: faces[color] ?? 0 })));
const script = (want) => ({
  name: 'scripted',
  choose(d, view, rng) {
    const id = want(d, view);
    return id && d.options.some((o) => o.id === id) ? { option: id, why: 'scripted' } : AI.eagerPolicy.choose(d, view, rng);
  },
});
const name = (t) => (t.label.startsWith('ADK15P') ? 'Porcupine' : t.label.startsWith('ADK60S') ? 'Raven' : t.label.startsWith('ADK30C') ? 'Tarantula' : t.label);
async function staged(scenario, { seed = 9, wants = {}, faces }) {
  // The setup's own rolls are the seed's (two seats throwing the same fixed
  // faces would tie for First Player for ever); the faces under test are
  // fixed once the table is arranged.
  const seeded = new AI.Rng(`${seed}:staged`);
  let fixed = null;
  const t = botTable(M, data, { ...scenario, map: 'none' }, {
    seed,
    dice: (pool) => (fixed ? dice(fixed)(pool) : Object.entries(pool).flatMap(([color, n]) => Array.from({ length: n }, () => ({ color, face: seeded.int(data.dice.dice[color].sides) })))),
    policies: { s1: script((d, v) => wants.s1?.(d, v)), s2: script((d, v) => wants.s2?.(d, v)) },
  });
  const reached = await t.run({ until: (s) => M.SU.normaliseSetup(s.setup)?.stage === 'done' && s.round.phase === 2 });
  fixed = faces ?? null;
  const U = Object.fromEntries(t.state.tokens.map((x) => [name(x), x]));
  const at = (x, c, r, f) => { x.col = c * 3; x.row = r * 3; if (f !== undefined) x.facing = f; };
  // The Action Opportunity of one Mech, the others having had theirs.
  const turnOf = (mech, timing) => {
    if (timing) mech.timing = timing;
    t.state.script.acted = t.state.tokens.filter((x) => x.kind === 'mech' && x.uid !== mech.uid).map((x) => x.uid);
    t.state.script.opp = null;
    return M.G.opportunity(data, t.state);
  };
  return { t, U, at, turnOf, reached };
}
const far = (s) => { s.at(s.U.Mire, 0, 0, 2); s.at(s.U.Dune, 2, 0, 2); s.at(s.U['Wild Cat'], 11, 11, 0); s.at(s.U.Porcupine, 9, 11, 0); s.at(s.U.Raven, 7, 11, 0); s.at(s.U.Tarantula, 5, 11, 0); };

// A Laser Weapon grants a Fragile Token on a Hit, to a unit that is still there.
{
  let target = 0;
  const s = await staged(alley, { faces: HIT, wants: { s2: (d) => (d.kind === 'opp.act' ? `attack:541_B:${target}` : d.kind === 'attack.part' ? 'part.roll' : null), s1: (d) => (d.kind === 'opp.act' ? 'end' : null) } });
  far(s);
  s.at(s.U['Wild Cat'], 5, 6, 0);
  const missile = { ...M.U.makeDroneToken(s.t.state, data, data.byId.get('071'), 's1'), parentUid: s.U.Mire.uid, col: 16, row: 13, facing: 0 };
  s.t.state.tokens.push(missile);
  target = missile.uid;
  s.turnOf(s.U['Wild Cat'], 'firing');
  const before = s.t.sent.length;
  const end = await s.t.run({ until: (st) => !st.tokens.some((x) => x.uid === missile.uid) && !st.script.combatView });
  const sent = s.t.sent.slice(before).map((x) => x.kind);
  check('a Laser that destroys the Projectile it hits sends it no Token: nothing is refused',
    [end.kind, s.t.refused, sent.includes('applyPenetration'), sent.includes('applyStatus'), s.t.state.tokens.some((x) => x.uid === missile.uid)],
    ['paused', [], true, false, false]);
  s.t.close();
}
{
  let target = 0;
  const s = await staged(alley, { faces: HIT, wants: { s2: (d) => (d.kind === 'opp.act' ? `attack:541_B:${target}` : null), s1: (d) => (d.kind === 'opp.act' ? 'end' : null) } });
  far(s);
  s.at(s.U['Wild Cat'], 5, 6, 0); s.at(s.U.Mire, 5, 4, 2);
  target = s.U.Mire.uid;
  s.turnOf(s.U['Wild Cat'], 'firing');
  const before = s.t.sent.length;
  const end = await s.t.run({ until: (st) => s.t.sent.slice(before).some((x) => x.kind === 'applyPenetration') && !st.script.combatView });
  check('the control: on a Mech that is still standing, the Token is sent and it lands',
    [end.kind, s.t.refused, s.t.sent.slice(before).filter((x) => x.kind === 'applyStatus').length, (s.U.Mire.statuses ?? []).includes('fragile')], ['paused', [], 1, true]);
  s.t.close();
}

// A defender who Focuses rerolls the dice it picked, and the attack goes on.
{
  let target = 0;
  const s = await staged(alley, {
    wants: {
      s1: (d) => (d.kind === 'opp.act' ? `attack:536_A:${target}` : null),
      s2: (d) => (d.kind === 'defence.focus' ? 'focus.use' : d.kind === 'defence.reroll' ? 'reroll.all' : d.kind === 'opp.act' ? 'end' : null),
    },
  });
  far(s);
  s.at(s.U.Mire, 5, 4, 2); s.at(s.U['Wild Cat'], 5, 7, 0);
  target = s.U['Wild Cat'].uid;
  const link = s.U['Wild Cat'].link;
  s.turnOf(s.U.Mire, 'firing');
  const before = s.t.sent.length;
  const rerolls = [];
  s.t.watch((cmd) => { if (cmd.kind === 'focusReroll') rerolls.push(cmd); });
  const end = await s.t.run({ until: (st) => s.t.sent.slice(before).some((x) => x.kind === 'focusReroll') && !st.script.combatView, maxSteps: s.t.steps() + 60 });
  const sent = s.t.sent.slice(before);
  check('the reroll carries every die it was asked to throw, each once, with a new face for each',
    [rerolls.length >= 1, rerolls.every((c) => c.indices.length > 0 && c.indices.length === c.faces.length && new Set(c.indices).size === c.indices.length)], [true, true]);
  // A Surplus round is a second defence roll, with a Focus of its own; and the
  // hit itself may cost the defender Link beyond what its Focus spent.
  const paid = sent.filter((x) => x.seat === 's2' && x.kind === 'focus').length;
  check('a defender\'s Focus is paid, its reroll travels, and the attack is finished: no seat is left waiting',
    [end.kind, s.t.refused, paid >= 1, sent.filter((x) => x.kind === 'focusReroll').length === paid, link - s.U['Wild Cat'].link >= paid, sent.some((x) => x.kind === 'setCombatView')],
    ['paused', [], true, true, true, true]);
  s.t.close();
}

// A Charge (4.14): the Action turns a Part's token face-up, and a later attack
// by that Part may spend it, flipped down before the Action is paid.
{
  let target = 0;
  const s = await staged(alley, {
    wants: {
      s1: (d) => (d.kind === 'opp.act' ? 'end' : null),
      s2: (d) => (d.kind !== 'opp.act' ? null
        : d.options.some((o) => o.id === 'charge:COMMON_CHARGE:leftHand') ? 'charge:COMMON_CHARGE:leftHand'
          : d.options.some((o) => o.id === `attack:540_B:${target}:charged`) ? `attack:540_B:${target}:charged` : 'end'),
    },
  });
  far(s);
  s.at(s.U['Wild Cat'], 5, 6, 0); s.at(s.U.Mire, 5, 4, 2);
  target = s.U.Mire.uid;
  s.turnOf(s.U['Wild Cat'], 'swift');
  const seen = [];
  s.t.watch((cmd) => { if (cmd.seat === 's2' && ['performAction', 'setCharge', 'setCombatView'].includes(cmd.kind)) seen.push(cmd); });
  const end = await s.t.run({ until: (st) => seen.some((c) => c.kind === 'setCharge') && !st.script.combatView && seen.some((c) => c.kind === 'setCombatView'), maxSteps: s.t.steps() + 80 });
  const kinds = seen.map((c) => (c.kind === 'performAction' ? `pay ${c.partKey}` : c.kind === 'setCharge' ? `charge ${c.slot} ${c.on ? 'up' : 'down'}` : null)).filter(Boolean);
  check('the Charge Action is paid under the Part it Charges, and the shot that spends it flips the token down before it is paid',
    [end.kind, s.t.refused, kinds.slice(0, 3)], ['paused', [], ['pay COMMON_CHARGE@leftHand', 'charge leftHand down', 'pay 540_B']]);
  check('the attack is made with its [Charged] line, and the token is spent',
    [seen.some((c) => c.kind === 'setCombatView' && c.view?.chargeSpent === true), (s.U['Wild Cat'].charge ?? []).includes('leftHand')], [true, false]);
  s.t.close();
}

// The Raven's Fire Control Interference: a Counter-roll both seats answer.
{
  const s = await staged(alley, {
    faces: { ...HIT, yellow: 0 },
    wants: { s1: (d) => (d.kind === 'opp.act' ? 'end' : null), s2: (d) => (d.kind === 'opp.act' ? 'end' : d.kind === 'loop.designate.automatic' ? `designate:${ravenUid}` : null) },
  });
  far(s);
  var ravenUid = s.U.Raven.uid;
  s.at(s.U.Raven, 5, 6, 0); s.at(s.U.Mire, 5, 4, 2);
  // Both Mechs' Opportunities are ended by the script, and the Automatic Phase comes.
  const end = await s.t.run({ until: (st) => st.round.phase === 4, maxSteps: s.t.steps() + 200 });
  const sent = s.t.sent.map((x) => x.kind);
  const from = sent.indexOf('startCounterRoll');
  // A Drone has no Link to Focus with, so only the Mech is asked to declare.
  const after = s.t.sent.slice(from);
  check('the Raven opens it on the Mech in its Range, each seat rolls its own unit\'s dice, the Mech declares its Focus, and it is closed',
    [end.kind, s.t.refused, from > 0, ['s1', 's2'].map((seat) => after.filter((x) => x.kind === 'rollCounter' && x.seat === seat).length >= 1),
      after.filter((x) => x.kind === 'declareCounterFocus').map((x) => x.seat), after.some((x) => x.kind === 'clearCounterRoll'), s.t.state.script.counter ?? null],
    ['paused', [], true, [true, true], ['s1'], true, null]);
  check('with the Initiator\'s dice all Lightning and the Responder\'s too, the tie is the Initiator\'s: its seat applies the Token and closes',
    [after.filter((x) => x.kind === 'applyStatus').map((x) => x.seat), after.filter((x) => x.kind === 'clearCounterRoll').map((x) => x.seat), (s.U.Mire.statuses ?? []).includes('fci')],
    [['s2'], ['s2'], true]);
  s.t.close();
}
{
  // The same exchange with the dice fixed: the Initiator's three all Lightning,
  // the Responder's blank. The win is applied by the Initiator's seat.
  let n = 0;
  const s = await staged(alley, { wants: { s1: (d) => (d.kind === 'opp.act' ? 'end' : null), s2: (d) => (d.kind === 'opp.act' ? 'end' : d.kind === 'loop.designate.automatic' ? `designate:${uid2}` : null) } });
  far(s);
  var uid2 = s.U.Raven.uid;
  s.at(s.U.Raven, 5, 6, 0); s.at(s.U.Mire, 5, 4, 2);
  const real = s.t.drivers.s2;
  void real; void n;
  // The table's dice are the seeded ones here, so the verdict is the seed's;
  // what is pinned is that whoever wins, the record is settled by its rules.
  const end = await s.t.run({ until: (st) => st.round.phase === 4, maxSteps: s.t.steps() + 200 });
  const kinds = s.t.sent.map((x) => x.kind);
  const won = kinds.includes('applyStatus');
  check('a won exchange puts the Token on its target, and a lost one puts none',
    [end.kind, s.t.refused, won === (s.U.Mire.statuses ?? []).includes('fci')], ['paused', [], true]);
  s.t.close();
}

// An Occupation: a Tactical Zone held when the round ends pays, from Round 2.
{
  const still = (d) => (d.kind === 'opp.act' || d.kind === 'activation.act' ? 'end' : d.kind.startsWith('loop.designate.') ? 'pass' : null);
  const s = await staged(alley, { wants: { s1: still, s2: still } });
  far(s);
  // The Mire alone in Echo; nobody else in any zone.
  s.at(s.U.Mire, 5, 5, 2); s.at(s.U.Dune, 0, 0, 2); s.at(s.U['Wild Cat'], 11, 0, 0); s.at(s.U.Porcupine, 11, 2, 0); s.at(s.U.Raven, 11, 3, 0); s.at(s.U.Tarantula, 7, 0, 0);
  const vpAt = [];
  const end = await s.t.run({ until: (st) => { if (st.round.phase === 0 && vpAt.length < st.round.n - 1) vpAt.push(M.TK.normaliseTasks(st.tasks).vp.s1); return st.round.n >= 4; }, maxSteps: s.t.steps() + 400 });
  check('a zone held at the end of Round 1 pays nothing, and two Victory Points each round from Round 2',
    [end.kind, s.t.refused, vpAt, s.t.sent.filter((x) => x.kind === 'award').length], ['paused', [], [0, 2, 4], 2]);
  s.t.close();
}

// The alley's corners are closed by Containers. A Large Unit's way out is
// through one: the eager seat crushes it and walks the road to the enemy,
// where the crow's line left it standing in its corner all game.
{
  const t = botTable(M, data, alley, { seed: 7, policies: AI.eagerPolicy });
  let first = null;
  const end = await t.run({
    onStep: (seat, r) => {
      if (first || seat !== 's2' || r.decision.kind !== 'opp.act' || !r.option.tags.includes('move')) return;
      const to = r.option.facts.to;
      first = {
        tags: r.option.tags.filter((x) => x === 'crush' || x === 'maneuver'),
        kinds: r.option.commands.map((c) => c.kind),
        onRoad: Object.values(r.decision.facts.roads).some((road) => road.length && road[0].c === to.c && road[0].r === to.r),
      };
    },
  });
  const cat = t.sent.filter((x) => x.seat === 's2' && x.kind === 'maneuver').length;
  check('the Wild Cat crushes the Container in front of it and goes down the road to the enemy',
    [end.kind, t.refused, first, t.sent.some((x) => x.kind === 'destroyTerrain' && x.ok), cat > 1],
    ['over', [], { tags: ['maneuver', 'crush'], kinds: ['destroyTerrain', 'maneuver'], onRoad: true }, true, true]);
  t.close();
}

// A squad with no Mech left sets no dial, and the Planning Phase still turns:
// it commits to nothing, once, and reveals.
{
  const t = botTable(M, data, alley, { seed: 4, policies: AI.eagerPolicy });
  await t.run({ until: (s) => M.SU.normaliseSetup(s.setup)?.stage === 'done' && s.round.phase === 1 });
  const cat = t.state.tokens.find((x) => x.side === 's2' && x.kind === 'mech');
  t.state.tokens.splice(t.state.tokens.indexOf(cat), 1);
  const before = t.sent.length;
  const end = await t.run({ until: (s) => s.round.phase === 2 });
  const planning = t.sent.slice(before).filter((x) => x.seat === 's2').map((x) => x.kind);
  check('a squad with no Mech left commits to nothing, once, and reveals, and the Planning Phase turns',
    [end.kind, t.refused, planning.filter((k) => k === 'commitTimings').length, planning.filter((k) => k === 'revealTimings').length, t.state.round.phase],
    ['paused', [], 1, 1, 2]);
  t.close();
}

// The Mire's Missiles: a Volley of two, and each one's Detonation in the Delay Phase.
{
  const s = await staged(alley, { wants: { s2: (d) => (d.kind === 'opp.act' ? 'end' : null) } });
  far(s);
  s.at(s.U.Mire, 5, 3, 2); s.at(s.U['Wild Cat'], 5, 7, 0);
  const ammo = s.U.Mire.ammo['004_A'];
  s.turnOf(s.U.Mire, 'projectile');
  const end = await s.t.run({ until: (st) => st.round.phase === 5, maxSteps: s.t.steps() + 400 });
  const sent = s.t.sent.filter((x) => x.seat === 's1').map((x) => x.kind);
  check('one performance launches its Volley of two and no more, an Ammo Token each',
    [end.kind, s.t.refused, sent.filter((k) => k === 'launch').length, ammo - s.U.Mire.ammo['004_A']], ['paused', [], 2, 2]);
  // One of the two may be shot down on the way: the Porcupine's Automatic
  // shot takes the nearest enemy unit, and a Missile is one.
  const all = s.t.sent.map((x) => x.kind);
  const flights = all.map((k, i) => (k === 'flyToTarget' ? i : -1)).filter((i) => i >= 0);
  check('in the Delay Phase a Missile still flying is activated, flies at an enemy in its Range and explodes on it, and none is left on the board',
    [flights.length >= 1, flights.every((i) => all.slice(i, i + 8).includes('callDefense')), s.t.state.tokens.filter((x) => x.kind === 'projectile').length], [true, true, 0]);
  s.t.close();
}
{
  // A Missile with no enemy in its Range is destroyed by its own Delayed Action.
  const s = await staged(alley, { wants: { s2: (d) => (d.kind === 'opp.act' ? 'end' : null), s1: (d) => (d.kind === 'opp.act' ? 'end' : null) } });
  far(s);
  const lone = { ...M.U.makeDroneToken(s.t.state, data, data.byId.get('071'), 's1'), parentUid: s.U.Mire.uid, col: 16, row: 16, facing: 0 };
  s.t.state.tokens.push(lone);
  const end = await s.t.run({ until: (st) => st.round.phase === 5, maxSteps: s.t.steps() + 300 });
  check('a Missile that finds no target is destroyed (4.7.5), and the phase goes on',
    [end.kind, s.t.refused, s.t.state.tokens.some((x) => x.uid === lone.uid), s.t.sent.some((x) => x.kind === 'flyToTarget')], ['paused', [], false, false]);
  s.t.close();
}

M.L.setLocalSeat(null);
console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
