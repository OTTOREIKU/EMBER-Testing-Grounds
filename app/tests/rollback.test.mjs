// Undo and the networked rollback. Two halves that have to agree: the snapshot
// ring in history.ts, and the two commands that let one player ask the other to
// rewind. The ring is imported straight — its only import is a type, so it runs
// as written rather than as a copy that could drift.
import { readFileSync, writeFileSync } from 'node:fs';
import * as H from '../src/history.ts';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}, got ${g}`); }
};

console.log('Undo and rollback\n');

const board = (n, phase, extra = {}) => ({ round: { n, phase }, tokens: [], ...extra });

// ---------- The ring ----------
H.clearHistory();
check('nothing to undo yet', H.undoLast(board(1, 0)), null);

// A snapshot is the board BEFORE the command, so undoing puts that board back.
const s = board(1, 0, { note: 'before' });
H.recordSnapshot(s, 'moveToken');
s.note = 'after';
const undone = H.undoLast(s);
check('undo names the command it reversed', undone?.label, 'moveToken');
check('undo puts the earlier board back', s.note, 'before');

// The restore has to land IN the object every page is already holding. If it
// returned a new one instead, the board, the guide and the trackers would all
// still be pointing at the pre-undo state.
H.clearHistory();
const held = board(2, 3, { note: 'keep' });
const alias = held;
H.recordSnapshot(held, 'doact');
held.note = 'changed';
H.undoLast(held);
check('undo restores into the same object', alias.note, 'keep');
check('the reference did not move', alias === held, true);

// A key the command ADDED has to go, not just the ones it changed. Object.assign
// alone would leave it behind and the undone board would keep a field it never
// had.
H.clearHistory();
const grew = board(1, 1);
H.recordSnapshot(grew, 'takeBlackBox');
grew.carried = 'box-1';
H.undoLast(grew);
check('undo drops keys the command added', 'carried' in grew, false);

// The ring is bounded, so a long game does not sit on dead boards.
H.clearHistory();
for (let i = 0; i < 45; i++) H.recordSnapshot(board(1, 0), `cmd${i}`);
check('the ring stops at 40', H.historyDepth(), 40);
check('it is the OLDEST that fall off', H.historyList()[0].label, 'cmd5');

// ---------- Rollback targets ----------
//
// Offered at round/phase boundaries rather than per command, because the two
// clients' rings are NOT the same length — a secret command like setTiming is
// recorded locally and never travels — so an index means a different board on
// each side. A phase boundary both clients derive for themselves.
H.clearHistory();
H.recordSnapshot(board(1, 0), 'setTiming');
H.recordSnapshot(board(1, 0), 'moveToken');
H.recordSnapshot(board(1, 1), 'doact');
H.recordSnapshot(board(1, 1), 'moveToken');
H.recordSnapshot(board(2, 0), 'advance');
check('one target per round/phase, at its first snapshot',
  H.rollbackCatalog(), [
    { round: 1, phase: 0, index: 0, available: true },
    { round: 1, phase: 1, index: 2, available: true },
    { round: 2, phase: 0, index: 4, available: true },
  ]);

// Dice are the line. The faces came from the server and both players watched
// them land, so rewinding past one is fishing rather than undoing. Ratified:
// online rollback covers moves and actions only.
H.clearHistory();
H.recordSnapshot(board(1, 0), 'moveToken');
H.recordSnapshot(board(1, 0), 'acceptRoll');
H.recordSnapshot(board(1, 1), 'moveToken');
H.recordSnapshot(board(1, 1), 'doact');
// Listed, not dropped — the offer greys them so the rule is visible.
check('a roll seals everything before it',
  H.rollbackCatalog(), [
    { round: 1, phase: 0, index: 0, available: false },
    { round: 1, phase: 1, index: 2, available: true },
  ]);
// And the whole list can be empty, which is the case the UI has to explain
// rather than show as an empty menu.
H.clearHistory();
H.recordSnapshot(board(1, 0), 'moveToken');
H.recordSnapshot(board(1, 0), 'acceptRoll');
check('a roll as the last thing leaves nothing available',
  H.rollbackCatalog().filter((p) => p.available), []);

// The current phase IS offerable — "put this phase back" is the common ask, and
// the board as the phase began is not the board now.
H.clearHistory();
H.recordSnapshot(board(3, 2), 'moveToken');
H.recordSnapshot(board(3, 2), 'doact');
check('the phase you are in is a target', H.rollbackCatalog(), [{ round: 3, phase: 2, index: 0, available: true }]);

// Setup snapshots share "round 1, phase 0" with the real Command Phase — the
// round track has nowhere else to sit while units deploy — so they are not
// boundaries. Found live: a rejoining client replayed the First Player roll
// into its ring at 1:0 and the seal greyed Round 1's Command Phase as "dice
// rolled since", when the dice came before the phase ever began.
H.clearHistory();
H.recordSnapshot({ ...board(1, 0), setup: { stage: 'roll' } }, 'rollSetup');
H.recordSnapshot({ ...board(1, 0), setup: { stage: 'roll' } }, 'acceptRoll');
H.recordSnapshot({ ...board(1, 0), setup: { stage: 'deploy' } }, 'deployUnit');
H.recordSnapshot({ ...board(1, 0), setup: { stage: 'done' } }, 'designate');
check('setup is not a boundary, and its dice seal nothing in play',
  H.rollbackCatalog(), [{ round: 1, phase: 0, index: 3, available: true }]);

// ---------- Rewinding to a named phase ----------
H.clearHistory();
const live = board(1, 0, { note: 'start' });
H.recordSnapshot(live, 'moveToken');
live.note = 'p0-b';
H.recordSnapshot(board(1, 1, { note: live.note }), 'doact');
live.round = { n: 1, phase: 1 };
live.note = 'p1-b';
H.recordSnapshot(live, 'moveToken');
live.note = 'now';
check('rewinding to a phase restores its first board', H.undoToPhase(live, 1, 0)?.label, 'moveToken');
check('the board came back', live.note, 'start');
check('everything after the target is dropped', H.historyDepth(), 0);
check('an unknown phase rewinds nothing', H.undoToPhase(live, 9, 9), null);

// ---------- The two commands ----------
//
// Sliced out of commands.ts rather than mirrored, so the rules under test are
// the ones that ship.
const commands = readFileSync(new URL('../src/commands.ts', import.meta.url), 'utf8');
const tmp = new URL('./_rollback.slice.ts', import.meta.url);
const checkFn = commands.slice(commands.indexOf("    case 'rollbackRequest': {"), commands.indexOf("    case 'setReady': {"));
if (!checkFn.includes('rollbackAnswer')) throw new Error('could not locate the rollback checks in commands.ts');
// Both apply branches, taken from the second half of the file. Every kind
// appears twice — check() then apply() — so this deliberately searches from the
// apply side; indexOf would find the check branch.
const applyStart = commands.indexOf("  if (cmd.kind === 'rollbackRequest') {");
const applyFn = commands.slice(applyStart, commands.indexOf('\n  }', commands.indexOf("  if (cmd.kind === 'rollbackAnswer') {")) + 4);
if (!applyFn.includes('rollback = null')) throw new Error('could not locate the rollback applies in commands.ts');

writeFileSync(tmp, `type Side = any;
const ok = { ok: true } as any;
const no = (why: string) => ({ ok: false, why }) as any;
export function checkRollback(state: any, cmd: any): any {
  switch (cmd.kind) {
${checkFn}
  }
  return ok;
}
export function applyRollback(state: any, cmd: any): void {
${applyFn}
}
`);
const C = await import(tmp.href);

// The catalog the HOST published. check() reads its targets out of here rather
// than out of any client's undo ring, so a point the host cannot reach is never
// a point anyone can ask for.
const CATALOG = [
  { round: 1, phase: 0, available: true },
  { round: 1, phase: 1, available: false },
  { round: 2, phase: 1, available: true },
];
const running = (rollback = null) => ({ round: { n: 2, phase: 1 }, script: { stage: 'round:1', rollback, rollbacks: 0, rollbackCatalog: CATALOG } });
const ask = (over = {}) => ({ kind: 'rollbackRequest', seat: 'RAID', round: 1, phase: 0, label: 'Round 1 · Command', ...over });

check('no game, nothing to roll back',
  C.checkRollback({ round: { n: 0, phase: 0 }, script: null }, ask()).why, 'There is no game running to roll back.');
check('a backwards target is allowed', C.checkRollback(running(), ask()).ok, true);
check('the current phase is allowed',
  C.checkRollback(running(), ask({ round: 2, phase: 1 })).ok, true);
check('a later phase is refused',
  C.checkRollback(running(), ask({ round: 2, phase: 2 })).why, 'A rollback goes backwards.');
check('a later round is refused',
  C.checkRollback(running(), ask({ round: 3, phase: 0 })).why, 'A rollback goes backwards.');
// A point the host never published is not a point the table can return to.
// Before this, the request was accepted, both players watched it fail, and the
// board did not move.
check('a target outside the catalog is refused',
  C.checkRollback(running(), ask({ round: 1, phase: 3 })).why,
  'That point is no longer one the table can return to.');
// Sealed points ARE in the catalog — listed so the offer can grey them and say
// why — so the rule has to be enforced here rather than by their absence.
check('a target sealed by dice is refused',
  C.checkRollback(running(), ask({ round: 1, phase: 1 })).why,
  'Dice have been rolled since then, and a rollback never reaches past a roll.');
// One ask at a time, or two rewinds race each other across the wire.
check('a second request waits its turn',
  C.checkRollback(running({ by: 'UN', round: 1, phase: 0, label: 'x' }), ask()).why,
  'A rollback request is already waiting on an answer.');

const answer = (seat, accept) => ({ kind: 'rollbackAnswer', seat, accept });
check('answering nothing is refused',
  C.checkRollback(running(), answer('UN', true)).why, 'Nothing has been asked.');
const pending = () => running({ by: 'RAID', round: 1, phase: 0, label: 'Round 1 · Command' });
check('the other seat may accept', C.checkRollback(pending(), answer('UN', true)).ok, true);
check('the other seat may decline', C.checkRollback(pending(), answer('UN', false)).ok, true);
// Consent is the whole point: a board one player rewound alone is a desync.
check('the asker cannot approve their own',
  C.checkRollback(pending(), answer('RAID', true)).why, 'The other player has to agree to a rollback.');
// But they can take it back, which is the only way to withdraw one.
check('the asker may withdraw', C.checkRollback(pending(), answer('RAID', false)).ok, true);

// apply() RECORDS the ask and CLEARS it, and does nothing else. The rewind
// itself lives outside the command layer on purpose: a command that rewrote the
// board from inside apply() would be undoing the history entry it just made.
const st = running();
C.applyRollback(st, ask());
check('the ask is recorded against its asker', st.script.rollback, { by: 'RAID', round: 1, phase: 0, label: 'Round 1 · Command' });
C.applyRollback(st, answer('UN', true));
check('an answer clears the ask', st.script.rollback, null);
// The branch count moves inside the COMMAND, not on the page, which is what
// carries it to a player who joins after the rollback: it rides in the
// checkpoint like any other shared fact.
check('accepting leaves the old branch', st.script.rollbacks, 1);
const declined = running({ by: 'RAID', round: 1, phase: 0, label: 'x' });
C.applyRollback(declined, answer('UN', false));
check('declining changes no branch', declined.script.rollbacks, 0);
// Comments stripped first: the branch EXPLAINS that it does not call undoTo, so
// a naive search finds the prose that promises the opposite of what it means.
const applyCode = applyFn.replace(/\/\/[^\n]*/g, '');
check('apply never rewinds the board itself', /undoTo|restoreInto|historyList/.test(applyCode), false);

// ---------- One ring decides the board ----------
//
// The rewind reads the HOST's ring and nothing else. Both clients undoing their
// own looks equivalent and is not: the rings differ in length because secret
// commands are recorded locally and never travel, so a client missing the
// target would quietly do nothing while the other rewound. Read from the source
// because there is no way to catch that at runtime — two boards that disagree
// is exactly the thing that produces no error.
const matchSrc = readFileSync(new URL('../src/match.ts', import.meta.url), 'utf8');
const rewind = matchSrc.slice(matchSrc.indexOf('function rewindIfAgreed'), matchSrc.indexOf('\n}', matchSrc.indexOf('function rewindIfAgreed')));
check('rewindIfAgreed was located', rewind.length > 200, true);
check('a guest never rewinds its own ring', /if \(!isHost\(\)\) \{[\s\S]*?return;/.test(rewind), true);
// And the guest's stale snapshots go, or an undo could reach into the board the
// incoming checkpoint is about to throw away.
check('a guest drops its ring while it waits', rewind.indexOf('clearHistory()') < rewind.indexOf('undoToPhase'), true);
// A target the host cannot reach must say so. The first version returned in
// silence, which read as a rollback that simply did not happen.
check('an unreachable target is reported', /if \(!snap\) \{[\s\S]*?lobbyNote =/.test(rewind), true);
// Both seats must leave the old branch, and BEFORE the host/guest split — that
// is what lets the two agree on the number without it ever being sent. Put it
// inside the host arm and the guest keeps stamping the abandoned branch, and
// the host drops everything the guest does for the rest of the game.
check('both seats leave the branch, before the split',
  rewind.indexOf('setBranch(') < rewind.indexOf('if (!isHost())'), true);
check('the branch is left exactly once', [...rewind.matchAll(/setBranch\(/g)].length, 1);

console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
