// Undo against the computer (AI-OPPONENT-PLAN.md, M9.4).
//
// One seat asks to walk the table back, to before an action or to a phase's
// start, and the table waits for the other to answer (the Match Centre's
// rollback). Against the computer the Undo was not offered at all: its seat
// answered no ask, and an ask nobody answers holds the table. Now the seam asks
// the seat that was asked (`rollback.answer`, whose safe answer is `accept`),
// every policy that plays a person agrees, the page's host rewinds as it does
// for two players (match.ts rewindIfAgreed: the host's ring, never past a
// roll), and the computer lets go of what it remembered of the board it was
// playing and reads the new one.
import { readFileSync } from 'node:fs';
import { botTable, loadEngine, freshState } from './_engine.mjs';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}\n       got  ${g}`); }
};

console.log('Undo against the computer\n');

const { M, data } = await loadEngine('seatundo', [
  "export * as SEAT from '../src/seat';", "export * as AI from '../src/ai/index';",
  "export * as LOOP from '../src/loopback';", "export * as SOLO from '../src/solo';", "export * as HUD from '../src/matchhud';",
]);
const AI = M.AI;
const { LoopbackRelay } = M.LOOP;
const { SoloTable, soloSpec, soloSetup, OPPONENTS } = M.SOLO;
const [alley] = data.solo.scenarios;
const tick = () => new Promise((r) => { setImmediate(r); });
const sidesOf = (color) => data.dice.dice[color].sides;
const src = (f) => readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

// ---------- the seam ----------
{
  const t = botTable(M, data, alley, { seed: 3, policies: AI.tacticianPolicy, glue: M.HUD.glueAfter });
  await t.run({ until: (st) => st.round.phase === 2 && !!st.script?.opp });
  const s = t.state;
  s.script.rollback = { by: 's1', round: 1, phase: 2, label: 'Dune: Maneuver to E5', seq: 7 };
  const asked = M.SEAT.owed(data, s, 's2', M.SEAT.newMind());
  check('AN UNDO ASKED OF A SEAT HOLDS THE TABLE UNTIL IT ANSWERS: the seat asked is asked, accept or decline, accept the safe answer; the seat that asked is asked nothing',
    [asked?.kind, asked?.options.map((o) => [o.id, o.commands.map((c) => [c.kind, c.accept])]), asked?.fallback, M.SEAT.owed(data, s, 's1', M.SEAT.newMind())],
    ['rollback.answer', [['accept', [['rollbackAnswer', true]]], ['decline', [['rollbackAnswer', false]]]], 'accept', null]);
  check('it says where the table would go back to', /before "Dune: Maneuver to E5"/.test(asked.options[0].label), true);
  const view = M.SEAT.viewOf(data, s, 's2');
  check('THE COMPUTER AGREES: the Tactician, the Brawler and the eager policy accept; the legal policy draws by lot',
    [AI.tacticianPolicy.choose(asked, view, new AI.Rng('u')).option, AI.brawlerPolicy.choose(asked, view, new AI.Rng('u')).option, AI.eagerPolicy.choose(asked, view, new AI.Rng('u')).option,
      new Set(Array.from({ length: 40 }, (_, i) => AI.legalPolicy.choose(asked, view, new AI.Rng(`l${i}`)).option)).size],
    ['accept', 'accept', 'accept', 2]);
  s.script.rollback = { by: 's1', round: 1, phase: 1, label: 'x' };
  check('a phase ask is named by its round and phase', /round 1, Planning Phase/.test(M.SEAT.owed(data, s, 's2', M.SEAT.newMind()).options[0].label), true);
  s.script.counter = { initiatorUid: 1, responderUid: 2 };
  check('it comes before anything else the table owes, a Counter-roll included (the page\'s rollback panel outranks it)', M.SEAT.owed(data, s, 's2', M.SEAT.newMind())?.kind, 'rollback.answer');
  t.close();
}

// ---------- the page in miniature, the host's rewind included ----------
//
// As solo.test's: the computer in the other seat behind a relay with no
// server, a driver standing in for the person. The page's host keeps a board
// for every phase begun, and rewinds to one when an Undo is agreed to, as
// match.ts rewindIfAgreed does from its ring.
function page(human, { seed = 3, opponent = 'tactician' } = {}) {
  M.L.setLocalSeat(null);
  const state = freshState(M, data);
  const spec = soloSpec(data, { solo: alley.id, side: human, seed: String(seed), ai: opponent }, () => seed, null);
  const sent = [];
  const refused = [];
  const boards = [];
  const rewinds = [];
  let player = null;
  const replace = (board) => {
    for (const k of Object.keys(state)) delete state[k];
    Object.assign(state, JSON.parse(JSON.stringify(board)));
  };
  // A board kept at the start of every phase (match.ts recordSnapshot keeps
  // one before every command; a phase's first is all a phase ask needs).
  const keep = () => {
    const at = `${state.round.n}:${state.round.phase}`;
    if (state.script && !boards.some((b) => b.at === at)) boards.push({ at, board: JSON.parse(JSON.stringify(state)) });
  };
  const rewind = (target, branch) => {
    const b = boards.find((x) => x.at === `${target.round}:${target.phase}`);
    if (!b) return;
    replace(b.board);
    state.script.rollbacks = branch;
    boards.splice(boards.indexOf(b) + 1);
    rewinds.push(`${target.round}:${target.phase}`);
  };
  const landed = (cmd, target) => {
    M.G.glueAfter(data, state, cmd);
    if (cmd.kind === 'rollbackAnswer' && cmd.accept && target) rewind(target, state.script.rollbacks);
    keep();
  };
  const hooks = {
    onCommand(cmd, seat) {
      const target = cmd.kind === 'rollbackAnswer' ? state.script?.rollback ?? null : null;
      const v = M.C.applyRemote(data, state, cmd);
      sent.push({ seat, kind: cmd.kind, ok: v.ok, via: 'relay' });
      if (!v.ok) { refused.push({ seat, kind: cmd.kind, why: v.why }); return; }
      landed(cmd, target);
      player?.observe(cmd);
    },
    onRolled() {},
    onChange: (view) => M.L.setLocalSeat(view.room ? view.seat : null),
    onCheckpoint() {}, onCatchUp() {}, onClosed() {}, onNeedCheckpoint() {}, snapshot: () => state,
  };
  const loop = new LoopbackRelay(hooks);
  M.C.onPerformed((cmd) => loop.publish(cmd));
  const send = (cmd) => {
    const v = M.C.perform(data, state, cmd);
    sent.push({ seat: cmd.seat, kind: cmd.kind, ok: v.ok, via: 'page' });
    if (!v.ok) { refused.push({ seat: cmd.seat, kind: cmd.kind, why: v.why }); return v; }
    landed(cmd, null);
    player?.observe(cmd);
    return v;
  };
  for (const cmd of soloSetup(data, spec.scenario, spec.squads)) send(cmd);
  loop.open({ id: 'SOLO', seat: spec.human, names: { [spec.human]: 'Player', [spec.bot]: OPPONENTS[spec.opponent].name }, dice: new AI.Rng(`${seed}:dice`), sides: sidesOf });
  const sealedRoll = async (pool, label, kind) => { const dice = await loop.rollDice(pool, label, kind ?? 'pool'); send({ kind: 'noteRoll', seat: spec.human, what: label }); return dice; };
  const table = new SoloTable({ data, state: () => state, loop, walking: () => false, changed: () => {}, sleep: tick, heartbeatMs: 0 }, spec);
  player = new AI.Driver(spec.human, {
    data, state: () => state, send,
    roll: (pool, label, kind) => ('black' in pool ? loop.roll(spec.human, pool, label, 'pool', true) : sealedRoll(pool, label, kind)),
  }, AI.eagerPolicy, new AI.Rng(`${seed}:${spec.human}`), { prefer: spec.scenario.edges ? [`edge:${spec.scenario.edges[spec.human]}`] : [] });
  const play = async ({ until, maxIdle = 3000 } = {}) => {
    let idle = 0;
    for (let i = 0; i < 40000; i++) {
      if (until?.(state)) return { kind: 'paused' };
      if (table.trouble) return { kind: 'trouble', why: table.trouble.why };
      const r = await player.step();
      if (r.kind === 'over') { await tick(); return { kind: 'over', result: r.result }; }
      if (r.kind === 'refused' || r.kind === 'stuck') return { kind: r.kind, why: r.why, decision: r.decision?.kind };
      if (r.kind === 'idle') { idle++; await tick(); if (idle > maxIdle) return { kind: 'stalled', round: state.round.n, phase: state.round.phase }; } else idle = 0;
    }
    return { kind: 'limit' };
  };
  const close = () => { table.stop(); M.C.onPerformed(null); M.L.setLocalSeat(null); loop.leave(); };
  return { state, spec, table, player, sent, refused, rewinds, boards, send, play, close };
}

for (const [human, opponent] of [['s1', 'tactician'], ['s2', 'brawler']]) {
  const p = page(human, { opponent });
  p.table.start();
  // Into round 2, the computer having set and played its round 1.
  const first = await p.play({ until: (s) => s.round.n === 2 && s.round.phase === 2 && !!s.script?.opp });
  const before = { dials: !!p.table.driver.mind.dials, ran: p.table.driver.taken };
  // The page's host publishes the points it can go back to, and the person asks
  // for the start of round 1's Action Phase.
  const to = { round: 1, phase: 2 };
  p.send({ kind: 'setRollbackCatalog', seat: human, entries: [{ round: to.round, phase: to.phase, available: true }] });
  const ask = p.send({ kind: 'rollbackRequest', seat: human, round: to.round, phase: to.phase, label: `round ${to.round}, Action Phase` });
  for (let i = 0; i < 400 && p.state.script.rollback; i++) await new Promise((r) => { setTimeout(r, 0); });
  // The computer reads the new board at its next look (its pump), a few turns on.
  for (let i = 0; i < 40; i++) await tick();
  p.player.forget();
  check(`AGAINST THE ${opponent.toUpperCase()}, THE PERSON AS ${human}: an Undo asked in round 2 is answered by the computer, which agrees, and the host walks the table back to round 1's Action Phase`,
    [first.kind, ask.ok, p.state.script.rollback, p.rewinds, [p.state.round.n, p.state.round.phase], p.state.script.rollbacks,
      p.sent.filter((x) => x.kind === 'rollbackAnswer').map((x) => [x.seat, x.via])],
    ['paused', true, null, ['1:2'], [1, 2], 1, [[p.spec.bot, 'relay']]]);
  check('  the computer had dials in hand for round 2, and lets go of what it remembered of that board', [before.dials, p.table.driver.mind.dials], [true, null]);
  const end = await p.play();
  check('  and the game is played on from there to its end: nothing refused, the computer never stuck',
    [end.kind, p.refused, p.table.trouble, p.state.round.n >= 2], ['over', [], null, true]);
  p.close();
}

// ---------- the page ----------
{
  const hud = src('matchhud.ts');
  check('THE PAGE OFFERS THE UNDO AGAINST THE COMPUTER, and says the computer agrees',
    [/if \(ctx\.solo\) return '';/.test(hud), /ctx\.solo \? 'The computer answers, and agrees, before anything moves\.' :/.test(hud)], [false, true]);
  check('the solo host lets the computer forget the board a rollback replaced, as the table counts them',
    /const rolled = this\.h\.state\(\)\.script\?\.rollbacks \?\? 0;\n\s+if \(rolled !== this\.rollbacks\) \{\n\s+this\.rollbacks = rolled;\n\s+for \(const x of this\.runners\) x\.driver\.forget\(\);/.test(src('solo.ts')), true);
}

console.log(`\n${pass} passed, ${fail} failed`);
M.L.setLocalSeat(null);
if (fail) process.exit(1);
