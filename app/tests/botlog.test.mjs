// THE COMPUTER'S GAMES, KEPT FOR ITS TUNING (botlog.ts, botsend.ts): a game
// against the computer, logged as the page logs it, plays back from its log to
// the very board it ended on; the log says how the game ended and what the
// computer answered and how long it thought; a log too large for the server
// sheds its commands first; and a log is kept and sent only for a signed-in
// player, sent once, kept when it cannot be sent, and gone after a sign-out.
import { botTable, freshState, loadEngine, tableCommands } from './_engine.mjs';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}\n       got  ${g}`); }
};

console.log('The computer\'s games, kept for its tuning\n');

const { M, data } = await loadEngine('botlog', [
  "export * as AI from '../src/ai/index';",
  "export * as BL from '../src/botlog';",
  "export * as BS from '../src/botsend';",
  "export * as OW from '../src/owed';",
]);

// ---------- a game, logged and played back ----------
{
  const scenario = data.solo.scenarios.find((x) => x.mission === 'vip-commander-assassination') ?? data.solo.scenarios[0];
  // Heard as the page's relay hears them: as each lands, the page's own (s1)
  // only once it is no secret (its Timing Dials travel in its reveal), the
  // computer's every one.
  let log = null;
  const tap = (seat, cmd) => { if (!(seat === 's1' && M.C.isSecret(cmd))) log.landed(cmd, seat); };
  const t = botTable(M, data, scenario, { seed: 11, policies: M.AI.tacticianPolicy, tap });
  log = new M.BL.BotLog({
    data,
    state: () => t.state,
    spec: { scenario: scenario.id, map: scenario.map, mission: scenario.mission, opponent: 'tactician', speed: () => 'normal', human: 's1', bot: 's2', seed: 11 },
  });
  // What seatTable sent to set the table, before either seat was held.
  const setup = [
    ...tableCommands(M, data, scenario),
    ...['s1', 's2'].map((seat) => { const sq = data.solo.squads[scenario.seats[seat]]; return { kind: 'importSquad', seat, name: sq.name, mechs: sq.mechs, drones: sq.drones }; }),
    { kind: 'startMatch', seat: 's1' },
  ];
  for (const cmd of setup) log.host(cmd);
  const end =await t.run({ maxSteps: 6000, onStep: (seat) => log.decided(seat, t.drivers[seat].log.at(-1)) });
  const body = log.body('left');
  const over = M.OW.gameOver(data, t.state);
  check('A GAME PLAYED OUT is logged as over, with the table\'s own result and the board\'s fingerprint',
    [end.kind, body.ended, body.winner, body.vp, body.round, body.fp], ['over', 'over', over.winner, over.vp, t.state.round.n, M.SEC.boardFingerprint(t.state)]);
  const answers = t.drivers.s2.log;
  check('every answer of the computer\'s seat is in it, and only that seat\'s, each with how long it thought',
    [body.decisions.length, body.decisions.every((d) => Number.isInteger(d.t) && d.t >= 0 && d.t <= d.ms), body.decisions.at(-1).o],
    [answers.length, true, answers.at(-1).option]);
  check('the window drawn on the other screen is left out, and nothing else is', [body.commands.some((x) => x.c.kind === 'setCombatView'), body.dropped], [false, 0]);

  // Played back on a fresh table: the setup with no seat held, then each
  // seat's commands as the page holds them (its own performed, the other's
  // arriving), the bookkeeping after each.
  const replay = (commands) => {
    M.L.setLocalSeat(null);
    const s = freshState(M, data);
    const refused = [];
    for (const { s: by, c } of commands) {
      if (by !== 'host' && M.L.getLocalSeat() !== 's1') M.L.setLocalSeat('s1');
      const v = by === 'host' || by === 's1' ? M.C.perform(data, s, c) : M.C.applyRemote(data, s, c);
      if (v.ok) M.G.glueAfter(data, s, c);
      else refused.push(`${c.kind}: ${v.why}`);
    }
    M.L.setLocalSeat(null);
    return { s, refused };
  };
  const back = replay(body.commands);
  check('AND PLAYED BACK FROM ITS LOG the game is the same game: every command taken, the same board at the end',
    [back.refused.slice(0, 3), M.SEC.boardFingerprint(back.s) === body.fp, back.s.round.n, JSON.stringify(back.s.tasks?.vp)],
    [[], true, t.state.round.n, JSON.stringify(t.state.tasks?.vp)]);
  const walk = body.commands.findIndex((x) => x.c.kind === 'maneuver');
  const short = replay(body.commands.filter((_, i) => i !== walk));
  check('(one walk left out of it, and the game played back is another: the comparison sees a single command)',
    M.SEC.boardFingerprint(short.s) === M.SEC.boardFingerprint(t.state), false);
  const size = JSON.stringify(body).length;
  check('and the whole of it sits well under the server\'s limit', size < M.BL.MAX_BYTES / 2, true);
  console.log(`       (${body.commands.length} commands, ${body.decisions.length} answers, ${Math.round(size / 1024)} kB)`);
  t.close();
}

// ---------- too large for the server ----------
{
  const filler = Array.from({ length: 3000 }, (_, i) => ({ s: 's1', c: { kind: 'maneuver', uid: i, note: 'x'.repeat(90) } }));
  const base = { v: 1, build: null, startedAt: 1, scenario: 'x', map: null, mission: null, opponent: 'tactician', speed: 'normal', human: 's1', seed: 1, ended: 'left', winner: null, why: '', vp: { s1: 0, s2: 0 }, conceded: null, round: 2, phase: 1, cores: 4, stops: [], errors: [], decisions: [{ n: 1, r: 1, p: 0, k: 'k', o: 'o', l: 'l', y: '', w: '', c: 2, t: 3, ms: 9 }], commands: filler, dropped: 2 };
  const out = M.BL.fitted(base);
  check('A LOG TOO LARGE sheds its commands, counted, and keeps the computer\'s answers',
    [JSON.stringify(out).length <= M.BL.MAX_BYTES, out.commands.length, out.dropped, out.decisions.length], [true, 0, 3002, 1]);
  check('one under the limit goes as it is', M.BL.fitted({ ...base, commands: filler.slice(0, 10) }).commands.length, 10);
}

// ---------- kept and sent only for a signed-in player ----------
{
  const store = new Map();
  globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
  const body = (n) => ({ v: 1, startedAt: 1000 + n, seed: n, ended: 'over' });
  const fake = (user, answer = () => ({ id: 1 })) => {
    const hooks = { change: [], before: [], after: [] };
    const posted = [];
    return {
      posted, hooks,
      get user() { return user; },
      set user(u) { user = u; },
      async postBotGame(b) { const r = answer(b); if (r instanceof Error) throw r; posted.push(b.seed); return r; },
      onChange(fn) { hooks.change.push(fn); },
      beforeSignOut(fn) { hooks.before.push(fn); },
      onSignedOut(fn) { hooks.after.push(fn); },
    };
  };
  const failing = (status) => () => Object.assign(new Error('no'), { status });

  const out = fake(null);
  await M.BS.fileLog(out, body(1));
  check('SIGNED OUT, a finished game is neither kept on the device nor sent', [store.size, out.posted], [0, []]);

  const me = fake({ id: 7 });
  await M.BS.fileLog(me, body(2));
  check('SIGNED IN, it is sent, and the device keeps nothing once the server has it', [me.posted, M.BS.keptFor(7)], [[2], 0]);

  const offline = fake({ id: 7 }, failing(0));
  await M.BS.fileLog(offline, body(3));
  check('a send that fails (no connection) keeps it on the device', [offline.posted, M.BS.keptFor(7)], [[], 1]);
  const limited = fake({ id: 7 }, failing(429));
  await M.BS.sendKept(limited);
  check('as does a server that says not today', M.BS.keptFor(7), 1);
  M.BS.keepLog(8, body(4));
  await M.BS.sendKept(me);
  check('the next page signed in to that account sends it; another account\'s waits for that account', [me.posted, M.BS.keptFor(7), M.BS.keptFor(8)], [[2, 3], 0, 1]);

  const strict = fake({ id: 8 }, failing(400));
  await M.BS.sendKept(strict);
  check('a log the server refuses as malformed is dropped, not sent again and again', M.BS.keptFor(8), 0);

  M.BS.keepLog(7, body(5));
  M.BS.keepLog(7, { ...body(5), ended: 'over' });
  check('the same game kept twice (left, then finished) is kept once, the later', [M.BS.keptFor(7), JSON.parse(store.get('ember-botgames-unsent-v1'))[0].body.ended], [1, 'over']);
  for (let i = 10; i < 16; i++) M.BS.keepLog(7, body(i));
  check('and a device keeps a few at most, the newest', M.BS.keptFor(7), 4);

  const bound = fake({ id: 9 });
  M.BS.bindBotLogs(bound);
  M.BS.keepLog(9, body(20));
  bound.hooks.after.forEach((fn) => fn());
  check('A SIGN-OUT leaves no log on the device, whoever\'s it was', store.size, 0);
  M.BS.keepLog(9, body(21));
  bound.hooks.change.forEach((fn) => fn({ id: 9 }));
  await new Promise((r) => setTimeout(r, 0));
  await M.BS.sendKept(bound);
  check('and an account signing in sends what waits for it', [bound.posted.includes(21), M.BS.keptFor(9)], [true, 0]);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
