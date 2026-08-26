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
// The property is the RING - capped, oldest falls off - not the number. The
// limit is read off the source so a measured depth change (40 -> 160 at U1)
// does not break a behaviour test; ledger.test.mjs pins the value itself.
const LIMIT = Number(/const LIMIT = (\d+);/.exec(readFileSync(new URL('../src/history.ts', import.meta.url), 'utf8'))[1]);
for (let i = 0; i < LIMIT + 5; i++) H.recordSnapshot(board(1, 0), `cmd${i}`);
check('the ring stops at its limit', H.historyDepth(), LIMIT);
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

// ---------- U3: the catalog learns UNITS ----------
// A unit target is named by SEQ - a monotonic stamp on every snapshot - and
// never by ring index, which goes stale on every eviction at the limit. The
// guest never interprets a seq; it echoes the host's number back.
H.clearHistory();
for (let r = 0; r < 3; r++) H.recordSnapshot(board(1, 1, { note: `s${r}` }), 'performAction', { human: `act ${r}`, role: 'begin' });
{
  const es = H.historyEntries();
  check('entries expose kind, words, role and seq', 
    es.map((e) => `${e.kind}:${e.human}:${e.role}`),
    ['performAction:act 0:begin', 'performAction:act 1:begin', 'performAction:act 2:begin']);
  check('seq is strictly increasing', es[0].seq < es[1].seq && es[1].seq < es[2].seq, true);
  const target = es[1].seq;
  const s2 = board(1, 1, { note: 'now' });
  const snap = H.undoToSeq(s2, target);
  check('undoToSeq restores the named board', s2.note, 's1');
  check('and truncates everything after it', H.historyDepth(), 1);
  check('a seq the ring no longer holds says so', H.undoToSeq(s2, target), null);
}
// Seq stays valid across the ring shifting at its limit - the exact failure a
// ring INDEX would have.
{
  H.clearHistory();
  for (let r = 0; r < LIMIT + 3; r++) H.recordSnapshot(board(1, 1, { note: `n${r}` }), 'maneuver', { role: 'begin' });
  const es = H.historyEntries();
  const live = es[1].seq;
  const s3 = board(1, 1, { note: 'now' });
  check('a live seq still resolves after eviction', H.undoToSeq(s3, live)?.label, 'maneuver');
  check('to the RIGHT board', s3.note, `n${4}`);
}

// ---------- normalising the v2 wire shape ----------
// The compatibility rule is ABSENCE: an entry without the v2 fields IS a v1
// phase boundary, so an old client parses a v2 catalog as the list it knows.
const T = await import('../src/types.ts');
{
  const sc = T.normaliseScript({ rollbackCatalog: [
    { round: 1, phase: 2, available: true },
    { round: 1, phase: 2, available: true, seq: 7, label: 'Thrust - Centurion', sealed: true },
    { round: 1, phase: 2, available: false, seq: 'junk', label: 42 },
    { round: 'x', phase: 2 },
  ] }, 's1');
  const cat = sc.rollbackCatalog;
  check('a v1 entry passes untouched', cat[0], { round: 1, phase: 2, available: true });
  check('a v2 entry keeps seq, label and seal', cat[1], { round: 1, phase: 2, available: true, seq: 7, label: 'Thrust - Centurion', sealed: true });
  check('half-written v2 fields fall back to the v1 reading', cat[2], { round: 1, phase: 2, available: false });
  check('a broken entry is dropped entirely', cat.length, 3);
}

// ---------- asking for a unit ----------
{
  const CAT2 = [
    { round: 1, phase: 2, available: true },
    { round: 1, phase: 2, available: true, seq: 11, label: 'Maneuver to F4' },
    { round: 1, phase: 2, available: false, seq: 12, label: 'Thrust', sealed: true },
    { round: 1, phase: 2, available: false, seq: 13, label: 'old move' },
  ];
  const st = (extra = {}) => ({ round: { n: 1, phase: 2 }, script: { rollback: null, rollbackCatalog: CAT2, ...extra } });
  check('a unit ask by seq is accepted',
    C.checkRollback(st(), { kind: 'rollbackRequest', seat: 's1', round: 1, phase: 2, seq: 11, label: 'x' }).ok, true);
  check('an unknown seq is refused',
    C.checkRollback(st(), { kind: 'rollbackRequest', seat: 's1', round: 1, phase: 2, seq: 99, label: 'x' }).ok, false);
  check('a SEALED unit is refused with the dice reason',
    /roll/.test(C.checkRollback(st(), { kind: 'rollbackRequest', seat: 's1', round: 1, phase: 2, seq: 12, label: 'x' }).why), true);
  check('an unavailable unit is refused',
    C.checkRollback(st(), { kind: 'rollbackRequest', seat: 's1', round: 1, phase: 2, seq: 13, label: 'x' }).ok, false);
  // A v1 phase ask must never accidentally match a UNIT that shares its round
  // and phase - it matches only entries with no seq at all.
  check('a phase ask matches only phase entries',
    C.checkRollback(st(), { kind: 'rollbackRequest', seat: 's1', round: 1, phase: 2, label: 'x' }).ok, true);
  const st2 = st();
  C.applyRollback(st2, { kind: 'rollbackRequest', seat: 's1', round: 1, phase: 2, seq: 11, label: 'Maneuver to F4' });
  check('the pending ask carries the seq', st2.script.rollback.seq, 11);
  check('and a phase ask carries none',
    (() => { const s3 = st(); C.applyRollback(s3, { kind: 'rollbackRequest', seat: 's1', round: 1, phase: 2, label: 'p' }); return s3.script.rollback.seq; })(), undefined);
}

// ---------- the host publishes units ----------
// Source-shape: the publish path folds the ring through the ONE grouper, draws
// the same sealed floor, skips decayed fragments, and keeps phase entries in
// the exact v1 wire shape so an old client still parses the list.
{
  const pub = matchSrc.slice(matchSrc.indexOf('function publishCatalog'), matchSrc.indexOf('\n}', matchSrc.indexOf('function publishCatalog')));
  check('units come from groupLedger over historyEntries', /groupLedger\(raw\)/.test(pub) && /historyEntries\(\)/.test(pub), true);
  check('the floor is drawn with the canonical sealed set', /SEALED_KINDS\.has\(raw\[i\]\.kind\)/.test(pub), true);
  check('quiet units never publish', /!u\.quiet/.test(pub), true);
  check('decayed fragments are skipped', /u\.start === 0 && \(raw\[0\]\?\.role === 'follow'/.test(pub), true);
  check('the list is capped', /\.slice\(-10\)/.test(pub), true);
  check('units are named by seq off their start entry', /seq: raw\[u\.start\]\.seq/.test(pub), true);
  check('phase entries keep the v1 shape', /\{ round: e\.round, phase: e\.phase, available: e\.available \}/.test(pub), true);
  // U7: phase machinery is not a player action. "Next phase" and "Set ready"
  // rows read as clutter beside the real actions, and the v1 phase entries
  // already offer every phase boundary as a target.
  check('boundary units never publish', /u\.role !== 'boundary'/.test(pub), true);
}

// ---------- U7: every server die seals the timeline ----------
// A MISSED attack fires none of the consequence kinds (applyPenetration,
// recordKill), so before this the whole attack - dice included - stayed
// undoable. sealedRoll is the one chokepoint every server-dice caller shares:
// the roll lands, then a noteRoll command travels to both rings and the
// catalog floor stops at it.
{
  const historySrc = readFileSync(new URL('../src/history.ts', import.meta.url), 'utf8');
  check('noteRoll is a sealed kind in history.ts', /const SEALED = new Set\(\[[^\]]*'noteRoll'/.test(historySrc), true);
  check('sealedRoll notes the roll on the shared record',
    /const rolled = await relay\.rollDice\(pool, tag, kind\);[\s\S]{0,200}?send\(\{ kind: 'noteRoll', seat, what: tag \?\? 'dice' \}\)/.test(matchSrc), true);
  // Every relay.rollDice in match.ts goes through the chokepoint - a new roll
  // site that bypasses it would quietly reopen the hole.
  check('match.ts rolls server dice only through sealedRoll',
    [...matchSrc.matchAll(/relay\.rollDice\(/g)].length, 1);
  check('noteRoll applies nothing to the board', /if \(cmd\.kind === 'noteRoll'\) return;/.test(commands), true);
}


// ---------- U4: the rewind honours the seq ----------
// Source-shape over match.ts, like the host-only rule above: two boards that
// disagree raise nothing, so the wiring is what gets pinned.
{
  const rew = matchSrc.slice(matchSrc.indexOf('function rewindIfAgreed'), matchSrc.indexOf('\n}', matchSrc.indexOf('function rewindIfAgreed')) + 2);
  check('the accepted ask carries the seq to the rewind',
    /asked = r \? \{ round: r\.round, phase: r\.phase, seq: r\.seq \} : null/.test(matchSrc), true);
  check('a unit ask rewinds by seq, a phase ask as before',
    /to\.seq !== undefined \? undoToSeq\(state, to\.seq\) : undoToPhase\(state, to\.round, to\.phase\)/.test(rew), true);
  // The ring was just truncated; a catalog describing the old ring is a menu
  // of lies. The republish must come AFTER the checkpoint publish, on the
  // same path.
  check('the host republishes its catalog after rewinding',
    /relay\.publishCheckpoint\(\);[\s\S]{0,500}?publishCatalog\(\);/.test(rew), true);
  // An evicted seq reports rather than half-working - the same visible-failure
  // rule the host-only fix established.
  check('an unreachable target still says so out loud', /too far back to return to/.test(rew), true);
}


// ---------- U5: the quiet fixed home ----------
// OTTO: "easy to find but not something that is in your face all the time."
// One icon in one constant spot, everything behind the press - and the two
// panel-foot offers are GONE, because they were both halves of his complaint
// at once: in the face on those two screens, invisible everywhere else.
{
  const hudSrc = readFileSync(new URL('../src/matchhud.ts', import.meta.url), 'utf8');
  check('the panel-foot offers are gone', /rollbackOffer/.test(hudSrc), false);
  check('the chrome renders beside the round strip on every refresh',
    /timelineHtml\(ctx\.state\) \+ undoChrome\(ctx\)/.test(hudSrc), true);
  const chrome = hudSrc.slice(hudSrc.indexOf('function undoChrome'), hudSrc.indexOf('function rollbackPanel'));
  check('the trigger is drawn even while the pop is closed', /return trig;/.test(chrome), true);
  check('a pending ask closes the pop but keeps the icon', /if \(!undoOpen \|\| sc\.rollback\) return trig;/.test(chrome), true);
  // U6's presentation, already carried by the rows: sealed and passed-over
  // targets stay LISTED, disabled, each with the dice reason - the ruling
  // wants the line visible so players learn where it sits.
  check('a sealed unit is listed disabled with the dice reason',
    /p\.sealed[\s\S]{0,200}?Dice were rolled inside this action/.test(chrome), true);
  check('a passed-over unit says dice have been rolled since',
    /Dice have been rolled since this/.test(chrome), true);
  check('the one-press row asks for the newest clean unit',
    /units\.find\(\(p\) => p\.available && !p\.sealed\)/.test(chrome), true);
  // The unit ask carries seq AND the label, so the consent screen can say what
  // it undoes; the consent panel reads it.
  check('a unit row sends the seq and label',
    /data-rb="u" data-seq="\$\{p\.seq\}"/.test(chrome), true);
  check('the consent panel names the unit ask by what it undoes',
    /ask\.seq !== undefined/.test(hudSrc), true);
  // Any press on the machinery closes the pop - the next screen is either the
  // waiting panel or the board.
  check('every rb press puts the menu away', /undoOpen = false;\s*\r?\n\s*const what = el\.dataset\.rb;/.test(hudSrc), true);
}


console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
