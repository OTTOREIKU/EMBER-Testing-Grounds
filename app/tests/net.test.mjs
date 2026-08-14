// The client half of the relay: what it does when messages arrive, and above
// all what it does when one goes missing. The server's side of resync is
// covered in the api repo; this is the half that decides to ask.
import { readFileSync, writeFileSync } from 'node:fs';

// A socket that records what was sent and lets the test push messages in.
class FakeSocket {
  static OPEN = 1;
  static instances = [];
  constructor(url) {
    this.url = url;
    this.readyState = FakeSocket.OPEN;
    this.sent = [];
    FakeSocket.instances.push(this);
  }
  send(raw) { this.sent.push(JSON.parse(raw)); }
  close() { this.readyState = 3; this.onclose?.(); }
  // Test-side helpers.
  deliver(msg) { this.onmessage?.({ data: JSON.stringify(msg) }); }
  kinds() { return this.sent.map((m) => m.t); }
}
globalThis.WebSocket = FakeSocket;
// Timers are collected rather than run, so a test decides when the reconnect
// backoff fires instead of racing it.
const timers = [];
// The heartbeat's interval is collected the same way, so a test can fire a
// beat on demand rather than waiting fifteen real seconds for one.
const beats = new Map();
let nextBeat = 1;
globalThis.window = {
  setTimeout: (fn) => { timers.push(fn); return timers.length; },
  clearTimeout: () => {},
  setInterval: (fn) => { const id = nextBeat++; beats.set(id, fn); return id; },
  clearInterval: (id) => { beats.delete(id); },
};
const flushTimers = () => { const due = timers.splice(0); for (const fn of due) fn(); };
const beat = () => { for (const fn of [...beats.values()]) fn(); };

const src = readFileSync(new URL('../src/net.ts', import.meta.url), 'utf8');
const tmp = new URL('./_net.slice.ts', import.meta.url);
writeFileSync(tmp, 'type Command = any;\ntype Side = any;\n' + src.replace(/^import[^\n]*\n/gm, ''));
const { Relay } = await import(tmp.href);

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}, got ${g}`); }
};

const ROOM = { id: 'AB2CD', epoch: 1, revision: 0, seats: { s1: 'me', s2: 'them' }, online: { s1: true, s2: true }, hasCheckpoint: true };

// A relay already seated in a room, which is the state everything below tests.
function seated(seat = 's1', fingerprint) {
  const applied = [];
  const boards = [];
  const catchup = [];
  let needed = 0;
  const relay = new Relay('http://localhost:3002', {
    onCommand: (cmd) => applied.push(cmd),
    onCheckpoint: (state) => boards.push(state),
    onCatchUp: (active) => catchup.push(active),
    onNeedCheckpoint: () => { needed++; },
    onChange: () => {},
    snapshot: () => ({ board: true }),
    ...(fingerprint ? { fingerprint } : {}),
  });
  relay.host();
  const ws = FakeSocket.instances.at(-1);
  ws.onopen?.();
  ws.deliver({ t: 'welcome', protocol: 1, user: { id: 1, username: 'me' } });
  ws.deliver({ t: 'room', you: { seat, host: true }, room: ROOM });
  ws.sent.length = 0;
  return { relay, ws, applied, boards, catchup, needed: () => needed };
}

console.log('The relay client\n');

// ---------- ordinary traffic ----------

const a = seated();
a.ws.deliver({ t: 'cmd', rev: 1, seat: 's2', seq: 1, cmd: { kind: 'one' } });
a.ws.deliver({ t: 'cmd', rev: 2, seat: 's2', seq: 2, cmd: { kind: 'two' } });
check('commands in order are applied in order', a.applied.map((c) => c.kind), ['one', 'two']);
check('and nothing is sent back', a.ws.kinds(), []);

// Our own command echoed back is an acknowledgement, not something to apply.
const b = seated();
b.relay.publish({ kind: 'mine' });
check('publishing sends the command with a sequence number', b.ws.sent.map((m) => [m.t, m.seq]), [['cmd', 1]]);
b.ws.deliver({ t: 'cmd', rev: 1, seat: 's1', seq: 1, cmd: { kind: 'mine' } });
check('our own command is not applied twice', b.applied, []);

// ---------- the gap ----------

const c = seated();
c.ws.deliver({ t: 'cmd', rev: 1, seat: 's2', seq: 1, cmd: { kind: 'one' } });
check('the first command applies', c.applied.map((x) => x.kind), ['one']);
// rev 2 never arrives.
c.ws.deliver({ t: 'cmd', rev: 3, seat: 's2', seq: 3, cmd: { kind: 'three' } });
check('a command past a gap is NOT applied', c.applied.map((x) => x.kind), ['one']);
check('and the client asks the server to resync', c.ws.kinds(), ['resync']);
check('and says it has fallen behind', c.relay.state.desynced, true);

// Asking once is the point: a burst of later commands must not become a burst
// of resync requests.
c.ws.deliver({ t: 'cmd', rev: 4, seat: 's2', seq: 4, cmd: { kind: 'four' } });
c.ws.deliver({ t: 'cmd', rev: 5, seat: 's2', seq: 5, cmd: { kind: 'five' } });
check('further commands do not each trigger another resync', c.ws.kinds(), ['resync']);
check('and none of them are applied', c.applied.map((x) => x.kind), ['one']);

// The server answers with the board and the tail.
c.ws.deliver({ t: 'checkpoint', rev: 5, state: { caughtUp: true } });
check('the checkpoint is handed to the app', c.boards, [{ caughtUp: true }]);
check('and clears the fallen-behind state', [c.relay.state.desynced, c.relay.state.error], [false, null]);
c.ws.deliver({ t: 'cmd', rev: 6, seat: 's2', seq: 6, cmd: { kind: 'six' } });
check('play resumes from the new revision', c.applied.map((x) => x.kind), ['one', 'six']);

// ---------- reconnecting ----------

// A host that drops must rejoin the room it was in. Creating a fresh one would
// strand the other player in the old room with no way back.
const d = seated();
d.ws.close();
flushTimers(); // the reconnect backoff
const reopened = FakeSocket.instances.at(-1);
reopened.onopen?.();
check('a dropped host rejoins its own room rather than making a new one',
  reopened.sent.map((m) => [m.t, m.room]), [['join', 'AB2CD']]);

// Leaving is deliberate, so it should not reconnect at all.
const e = seated();
const before = FakeSocket.instances.length;
e.relay.leave();
check('leaving does not reconnect', FakeSocket.instances.length, before);
check('and clears the room', e.relay.state.room, null);

// ---------- coming back to a game in progress ----------

// The bug this guards against: a player who rejoins is sent the stored board
// and then every command since, their own included — the checkpoint was taken
// before any of it. Treating those as acknowledgements, the way a live echo is
// treated, rebuilt the match out of the other player's moves alone and left
// the rejoining player looking at an empty table.
const g = seated('s1');
g.ws.deliver({ t: 'checkpoint', rev: 0, through: 3, state: { fromRoomOpening: true } });
check('a catch-up announces itself before the board lands', g.catchup, [true]);
g.ws.deliver({ t: 'cmd', rev: 1, seat: 's1', seq: 7, cmd: { kind: 'iDeployed' } });
g.ws.deliver({ t: 'cmd', rev: 2, seat: 's2', seq: 4, cmd: { kind: 'theyDeployed' } });
g.ws.deliver({ t: 'cmd', rev: 3, seat: 's1', seq: 8, cmd: { kind: 'iMoved' } });
check('history is replayed whoever made it',
  g.applied.map((c) => c.kind), ['iDeployed', 'theyDeployed', 'iMoved']);
check('and the catch-up closes at the revision it was told to run to', g.catchup, [true, false]);

// Past the tail the ordinary rule is back: our own work is already on this
// board, and applying the echo would double it.
g.relay.publish({ kind: 'mineNow' });
g.ws.deliver({ t: 'cmd', rev: 4, seat: 's1', seq: 1, cmd: { kind: 'mineNow' } });
check('once live again, our own command is an acknowledgement',
  g.applied.map((c) => c.kind), ['iDeployed', 'theyDeployed', 'iMoved']);
check('and no further catch-up was declared', g.catchup, [true, false]);

// A checkpoint with nothing behind it is just a board, not a replay.
const h = seated();
h.ws.deliver({ t: 'checkpoint', rev: 2, through: 2, state: { current: true } });
check('a board that is already current starts no catch-up', h.catchup, []);
check('and is still handed to the app', h.boards, [{ current: true }]);

// The board is filed under the revision it actually reflects. Filing it as
// whatever the server had reached would discard any command that landed while
// the snapshot was being taken.
const i = seated();
i.ws.deliver({ t: 'cmd', rev: 1, seat: 's2', seq: 1, cmd: { kind: 'one' } });
i.relay.publishCheckpoint();
check('a published board says which revision it reflects',
  i.ws.sent.filter((m) => m.t === 'checkpoint').map((m) => m.rev), [1]);

// Publishing a board while our own command is still in flight is the trap:
// the board already shows that command's work, but the number cannot say so
// yet. Sent as it stands, the server would keep the command in its log and the
// next player to join would apply it twice — once from the board, once from
// the tail. So it waits for the acknowledgement.
const j = seated();
j.relay.publish({ kind: 'broughtSquad' });
j.relay.publishCheckpoint();
check('a board is not published over work still in flight',
  j.ws.sent.filter((m) => m.t === 'checkpoint').length, 0);
j.ws.deliver({ t: 'cmd', rev: 1, seat: 's1', seq: 1, cmd: { kind: 'broughtSquad' } });
const late = j.ws.sent.filter((m) => m.t === 'checkpoint');
check('and goes out once the command is acknowledged', late.length, 1);
check('carrying the revision that now includes it', late[0]?.rev, 1);

// ---------- the server asking us ----------

const f = seated();
f.ws.deliver({ t: 'needCheckpoint' });
check('a request for the board reaches the app', f.needed(), 1);

// ---------- the heartbeat ----------

const hb1 = seated();
beat();
check('a quiet socket gets a ping', hb1.ws.kinds(), ['ping']);
hb1.ws.sent.length = 0;
hb1.ws.deliver({ t: 'pong' });
check('and the pong is not mistaken for a command', hb1.applied.length, 0);
// Anything arriving counts as a sign of life, so a busy game never pings.
const hb2 = seated();
hb2.ws.deliver({ t: 'cmd', rev: 1, seat: 's2', seq: 1, cmd: { kind: 'one' } });
hb2.ws.sent.length = 0;
beat();
check('traffic postpones the ping', hb2.ws.kinds(), ['ping']);
// A black-holed socket never fires onclose by itself, so the beat closes it —
// that is the only path that schedules a reconnect.
const hb3 = seated();
hb3.relay.heard = Date.now() - 60_000;
beat();
check('a socket that has gone deaf is closed', hb3.ws.readyState, 3);
check('and closing it asks for a reconnect', hb3.relay.state.status, 'connecting');

// ---------- drift ----------
//
// Stamps are `<rev>:<branch>:<hash>` — where the sender was, which branch of
// history they were on, and the board they held.

const same = () => 'aaaa1111';
// The sender was at revision 0 and so are we, and the boards agree.
const d1 = seated('s1', same);
d1.ws.deliver({ t: 'cmd', rev: 1, seat: 's2', seq: 1, cmd: { kind: 'ok' }, fp: '0:0:aaaa1111' });
check('a matching fingerprint applies as normal', d1.applied.map((c) => c.kind), ['ok']);
check('and asks for nothing', d1.ws.kinds(), []);

const d2 = seated('s1', same);
d2.ws.deliver({ t: 'cmd', rev: 1, seat: 's2', seq: 1, cmd: { kind: 'no' }, fp: '0:0:bbbb2222' });
check('a resync is asked for when the boards disagree', d2.ws.kinds(), ['resync']);
check('the desync is flagged for the UI', d2.relay.state.desynced, true);
// Applied anyway: the checkpoint on its way overwrites it, so a fingerprint
// that is wrong about something costs a resync rather than the whole match.
check('but the command still lands', d2.applied.map((c) => c.kind), ['no']);
// And play carries on rather than reading the next revision as a gap.
d2.ws.deliver({ t: 'cmd', rev: 2, seat: 's2', seq: 2, cmd: { kind: 'next' }, fp: '1:0:aaaa1111' });
check('the next command is not mistaken for a gap', d2.applied.map((c) => c.kind), ['no', 'next']);

// The sender may have been behind when it stamped: it had not yet seen the
// commands we already applied, so the two hashes describe different moments
// and comparing them would cry wolf.
const d3 = seated('s1', same);
d3.ws.deliver({ t: 'cmd', rev: 1, seat: 's2', seq: 1, cmd: { kind: 'one' }, fp: '0:0:aaaa1111' });
d3.ws.deliver({ t: 'cmd', rev: 2, seat: 's2', seq: 2, cmd: { kind: 'two' }, fp: '0:0:bbbb2222' });
check('a stale fingerprint is ignored rather than trusted', d3.applied.map((c) => c.kind), ['one', 'two']);

// Our own command echoed back carries our own fingerprint; comparing it to
// ourselves proves nothing and the board has already moved on.
const d4 = seated('s1', () => String(Math.random()));
d4.relay.publish({ kind: 'mine', seat: 's1' });
d4.ws.sent.length = 0;
d4.ws.deliver({ t: 'cmd', rev: 1, seat: 's1', seq: 1, cmd: { kind: 'mine' }, fp: '0:0:whatever' });
check('our own echo is never drift-checked', d4.ws.kinds(), []);

// An app that offers no fingerprint keeps the old behaviour exactly.
const d5 = seated();
d5.ws.deliver({ t: 'cmd', rev: 1, seat: 's2', seq: 1, cmd: { kind: 'ok' }, fp: '0:0:bbbb2222' });
check('no fingerprint hook means no drift checking', d5.applied.map((c) => c.kind), ['ok']);

// And the stamp we send carries the revision we were at.
const d6 = seated('s1', same);
d6.ws.deliver({ t: 'cmd', rev: 1, seat: 's2', seq: 1, cmd: { kind: 'one' }, fp: '0:0:aaaa1111' });
d6.ws.sent.length = 0;
d6.relay.publish({ kind: 'mine', seat: 's1' });
check('our own stamp names the revision it describes', d6.ws.sent[0].fp, '1:0:aaaa1111');

// ---------- branches ----------
//
// A rollback abandons one line of history and starts another. Everything the
// other player had already composed belongs to the line being thrown away, and
// it CANNOT be caught by the drift check: a stale command's revision is not
// ours, so the comparison above bails before it ever looks at the hash. Without
// the branch it lands on the rewound board in silence.
const b1 = seated('s1', same);
b1.relay.setBranch(1);
b1.ws.deliver({ t: 'cmd', rev: 1, seat: 's2', seq: 1, cmd: { kind: 'stale' }, fp: '0:0:aaaa1111' });
check('a command from the abandoned branch is dropped', b1.applied.map((c) => c.kind), []);
// The revision still has to move, or the next one reads as a gap and this
// client resyncs over something that was working exactly as intended.
b1.ws.deliver({ t: 'cmd', rev: 2, seat: 's2', seq: 2, cmd: { kind: 'fresh' }, fp: '1:1:aaaa1111' });
check('and the next one is not mistaken for a gap', b1.applied.map((c) => c.kind), ['fresh']);
check('dropping asks for nothing', b1.ws.kinds(), []);

// Our own stamp names the branch we are on, so the other end can do the same.
const b2 = seated('s1', same);
b2.relay.setBranch(1);
b2.ws.sent.length = 0;
b2.relay.publish({ kind: 'mine', seat: 's1' });
check('our stamp names our branch', b2.ws.sent[0].fp, '0:1:aaaa1111');

// A client that rejoins starts at branch 0 while everyone else has moved on. It
// has to learn where they are from the first command it sees — otherwise it
// refuses everything they send for the rest of the game AND keeps stamping a
// branch they refuse right back, which is a mute client that looks connected.
const b3 = seated('s1', same);
b3.ws.deliver({ t: 'cmd', rev: 1, seat: 's2', seq: 1, cmd: { kind: 'ahead' }, fp: '0:2:aaaa1111' });
check('a newer branch is adopted, not refused', b3.applied.map((c) => c.kind), ['ahead']);
b3.ws.sent.length = 0;
b3.relay.publish({ kind: 'mine', seat: 's1' });
check('and we stamp the branch we learned', b3.ws.sent[0].fp, '1:2:aaaa1111');

// Same revision, same branch, different board is still ordinary drift.
const b4 = seated('s1', same);
b4.relay.setBranch(1);
b4.ws.deliver({ t: 'cmd', rev: 1, seat: 's2', seq: 1, cmd: { kind: 'no' }, fp: '0:1:bbbb2222' });
check('drift on the current branch still reports', b4.ws.kinds(), ['resync']);
check('and still applies', b4.applied.map((c) => c.kind), ['no']);

// A stale command must not ALSO be reported as drift. It is expected, it is
// handled, and crying desync over it would turn every rollback into a resync.
const b5 = seated('s1', same);
b5.relay.setBranch(1);
b5.ws.deliver({ t: 'cmd', rev: 1, seat: 's2', seq: 1, cmd: { kind: 'old' }, fp: '0:0:bbbb2222' });
check('an abandoned branch is not also called drift', b5.ws.kinds(), []);
check('nor flagged for the UI', b5.relay.state.desynced, false);

// ---------- what the line is doing ----------
//
// None of this changes play. It exists because every desync we have been told
// about arrived as "the boards disagreed" with nothing attached, and because a
// player staring at a quiet board cannot tell a dead connection from an
// opponent who has switched tabs.
const t1 = seated('s1', same);
check('nothing to report before any beats', t1.relay.health().latencyMs, null);
check('and no loss is claimed on no evidence', t1.relay.health().lossPct, 0);

beat();
check('a beat goes out', t1.ws.kinds(), ['ping']);
t1.ws.deliver({ t: 'pong' });
check('the pong gives a round trip', typeof t1.relay.health().latencyMs, 'number');

// Loss needs a few beats behind it, or the first unanswered one reads as a
// connection that has lost everything.
const t2 = seated('s1', same);
beat(); beat();
check('two unanswered beats are not yet a verdict', t2.relay.health().lossPct, 0);
beat();
check('three are', t2.relay.health().lossPct, 100);

// The report is the deliverable. It has to name the room and carry the trace,
// and it must NOT carry the board — a player pasting this into a chat should
// not be pasting their position with it.
const t3 = seated('s1', same);
beat();
const rep = t3.relay.diagnostics();
check('the report names the room', rep.room, 'AB2CD');
check('and the seat', rep.seat, 's1');
check('and carries the samples', Array.isArray(rep.samples), true);
check('and the lifecycle trace', Array.isArray(rep.lifecycle), true);
check('and counts commands dropped as stale', rep.staleDropped, 0);
check('but never the board', 'state' in rep || 'snapshot' in rep, false);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
