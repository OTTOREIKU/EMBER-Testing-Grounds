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
globalThis.window = {
  setTimeout: (fn) => { timers.push(fn); return timers.length; },
  clearTimeout: () => {},
};
const flushTimers = () => { const due = timers.splice(0); for (const fn of due) fn(); };

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
function seated(seat = 's1') {
  const applied = [];
  const boards = [];
  let needed = 0;
  const relay = new Relay('http://localhost:3002', {
    onCommand: (cmd) => applied.push(cmd),
    onCheckpoint: (state) => boards.push(state),
    onNeedCheckpoint: () => { needed++; },
    onChange: () => {},
    snapshot: () => ({ board: true }),
  });
  relay.host();
  const ws = FakeSocket.instances.at(-1);
  ws.onopen?.();
  ws.deliver({ t: 'welcome', protocol: 1, user: { id: 1, username: 'me' } });
  ws.deliver({ t: 'room', you: { seat, host: true }, room: ROOM });
  ws.sent.length = 0;
  return { relay, ws, applied, boards, needed: () => needed };
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

// ---------- the server asking us ----------

const f = seated();
f.ws.deliver({ t: 'needCheckpoint' });
check('a request for the board reaches the app', f.needed(), 1);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
