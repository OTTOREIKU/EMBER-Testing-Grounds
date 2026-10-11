// A FINISHED GAME, AS IT IS LOGGED (gamelog.ts; OTTO, 2026-10-10): a game
// played on the real engine with a GameTrack watching it, logged as the Match
// Centre and the Pad log one. The score by round adds up to the score, each
// unit destroyed is a card of its squad in a round the game had, every id
// holds the server's shape, no name a player typed is in it, both players'
// pages make the same key for the match, and a page that came in mid-game
// sends the result without a history it only half saw.
import { botTable, loadEngine } from './_engine.mjs';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}\n       got  ${g}`); }
};

console.log('A finished game, as it is logged\n');

const { M, data } = await loadEngine('gamelog', [
  "export * as AI from '../src/ai/index';",
  "export * as GL from '../src/gamelog';",
  "export * as OW from '../src/owed';",
]);

// The server's own shapes (ember-api src/lib/gamerecord.ts).
const CARD_ID = /^[A-Za-z0-9][A-Za-z0-9+-]{0,23}$/;
const FACTION_ID = /^[A-Z][A-Z0-9_]{0,23}$/;
const MISSION_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAP_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const SCORE_KEY = /^[a-z][a-z-]{1,15}(?::[A-Za-z0-9+_-]{1,24}){1,4}$/;
const GAME_KEY = /^[a-f0-9]{16,64}$/;

// The Alley's Control game, seed 5: two Mechs fall in round 3.
const scenario = data.solo.scenarios.find((x) => x.id === 'alley-forward-advance') ?? data.solo.scenarios[0];
const t = botTable(M, data, scenario, { seed: 5, policies: M.AI.tacticianPolicy });
const track = new M.GL.GameTrack();
const twin = new M.GL.GameTrack();
const late = new M.GL.GameTrack();
let lateFrom = null;
track.observe(t.state);
twin.observe(t.state);
const end = await t.run({
  maxSteps: 6000,
  onStep: () => {
    track.observe(t.state);
    twin.observe(t.state);
    // A page opened in round 3 sees the game from there on.
    if (t.state.round.n >= 3) { if (lateFrom === null) lateFrom = t.state.round.n; late.observe(t.state); }
  },
});
const state = t.state;
const tasks = M.TK.normaliseTasks(state.tasks);
check('THE GAME is played out on the engine', [end.kind, M.OW.gameOver(data, state).over], ['over', true]);

const hands = { s1: state.tactics?.s1 ?? [], s2: state.tactics?.s2 ?? [] };
const report = M.GL.gameReport(data, state, track, { source: 'match', mode: 'online', mySeat: 's1', gameKey: null, ended: 'rounds', hands });
const d = report.detail;
check('the page watched it from before the battle began, so its history is whole', [track.whole, typeof report.minutes, report.firstSeat === state.round.firstPlayer || report.firstSeat === 's1' || report.firstSeat === 's2'], [true, 'number', true]);
check('THE SCORE BY ROUND adds up to the score, a round for each round played',
  [d.vpByRound.s1.reduce((a, b) => a + b, 0), d.vpByRound.s2.reduce((a, b) => a + b, 0), d.vpByRound.s1.length, d.vpByRound.s2.length],
  [tasks.vp.s1, tasks.vp.s2, report.rounds, report.rounds]);
const fielded = (side) => new Set(Object.values(state.fielded?.[side] ?? {}).flat());
check('EACH UNIT DESTROYED is a card its squad brought, lost in a round the game had',
  [d.destroyed.length > 0, d.destroyed.every((x) => fielded(x.seat).has(x.card) && x.round >= 1 && x.round <= report.rounds)], [true, true]);
check('the Tactics played are the ones the table holds, each with its round',
  [d.tactics.length, d.tactics.every((x) => x.round >= 1 && x.round <= report.rounds)],
  [(state.tacticsPlayed?.s1?.length ?? 0) + (state.tacticsPlayed?.s2?.length ?? 0), true]);
check('the scores paid and the Secondary Tasks are the table\'s own',
  [d.scored.length === tasks.scored.filter((k) => SCORE_KEY.test(k)).length, d.secondary.s1.id === (tasks.secondary.s1 ?? null), d.secondary.s2.id === (tasks.secondary.s2 ?? null)],
  [true, true, true]);

check('EVERY ID holds the server\'s shape',
  [report.players.every((p) => p.squad.every((e) => CARD_ID.test(e.id)) && (p.faction === null || FACTION_ID.test(p.faction))),
    report.mission === null || MISSION_ID.test(report.mission), report.map === null || MAP_ID.test(report.map),
    d.scored.every((k) => SCORE_KEY.test(k)), d.destroyed.every((x) => CARD_ID.test(x.card)), d.tactics.every((x) => CARD_ID.test(x.card)),
    report.players.every((p) => Number.isInteger(p.points) && p.points > 0)],
  [true, true, true, true, true, true, true]);
const typed = ['s1', 's2'].map((seat) => data.solo.squads[scenario.seats[seat]].name).filter(Boolean);
const text = JSON.stringify(report);
check('NO NAME a player typed is in it (the squads came with names), and only the fields the server takes',
  [typed.length > 0, typed.some((n) => text.includes(n)), Object.keys(report).sort().join()],
  [true, false, 'build,detail,ended,firstSeat,gameKey,map,minutes,mission,mode,players,rounds,scale,season,source,winnerSeat,mySeat'.split(',').sort().join()]);

const key = await M.GL.matchKey('ROOM1', track, state);
const key2 = await M.GL.matchKey('ROOM1', twin, state);
const other = await M.GL.matchKey('ROOM2', track, state);
check('BOTH PLAYERS\' PAGES make the same key for the match, and another room another', [GAME_KEY.test(key), key === key2, key === other], [true, true, false]);

const part = M.GL.gameReport(data, state, late, { source: 'pad', mode: 'online', mySeat: 's2', gameKey: null, ended: 'rounds', hands });
check('A PAGE THAT CAME IN MID-GAME (round 3) sends the result without a history',
  [lateFrom !== null, late.whole, 'vpByRound' in part.detail, 'destroyed' in part.detail, part.minutes, part.winnerSeat === report.winnerSeat],
  [true, false, false, false, null, true]);

// A squad with no Mech left: one way a Pad game is complete (though the rules run the rounds out, FAQ P21).
const gone = JSON.parse(JSON.stringify(state));
for (const u of gone.tokens) if (u.side === 's1' && u.kind === 'mech') u.partStates = { ...u.partStates, torso: 'destroyed' };
const both = JSON.parse(JSON.stringify(state));
both.tokens.push({ uid: 99999, side: 's1', kind: 'mech', cardId: '023', deployed: true, col: 0, row: 0, size: 3, partStates: { torso: 'intact' } });
both.tokens.push({ uid: 99998, side: 's2', kind: 'mech', cardId: '023', deployed: true, col: 3, row: 0, size: 3, partStates: { torso: 'intact' } });
check('A SQUAD WITH NO MECH LEFT is seen, and none while both stand', [M.GL.squadWiped(gone), M.GL.squadWiped(both)], ['s1', null]);

// The table set up again after the battle (the match ended, another begun): a new game, seen from its start.
const next = JSON.parse(JSON.stringify(state));
next.setup = { ...next.setup, stage: 'deploy' };
next.tasks = M.TK.newTaskState();
next.round = { ...next.round, n: 1, phase: 0 };
track.observe(next);
next.setup = { ...next.setup, stage: 'done' };
track.observe(next);
const fresh = track.history(next);
check('A TABLE SET UP AGAIN is a new game: its history starts empty, seen whole',
  [track.whole, fresh.vpByRound.s1.concat(fresh.vpByRound.s2).every((n) => n === 0), fresh.destroyed.length], [true, true, 0]);

console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
