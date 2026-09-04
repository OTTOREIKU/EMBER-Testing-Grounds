// The drift stamp, driven with two REAL peers over a fake socket.
//
// Every command carries `fp`, the sender's board before the command, and the
// receiver holds its own board against it before applying. That only works if
// the stamp really is the board BEFORE: publish() runs after apply(), so a
// stamp read off the live board described the board the command PRODUCED, and
// every state-changing opponent command raised a false desync and a full
// resync. net.test.mjs uses constant fingerprints and could never see it.
//
// Bundled with esbuild the way _combatdrive.mjs bundles combat.ts, because
// net.ts and commands.ts import without extensions.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}, got ${g}`); }
};

globalThis.__EMBER_BASE__ = '/';
class FakeSocket {
  static OPEN = 1;
  static instances = [];
  constructor() { this.readyState = 1; this.sent = []; FakeSocket.instances.push(this); }
  send(raw) { this.sent.push(JSON.parse(raw)); }
  close() {}
  deliver(m) { this.onmessage?.({ data: JSON.stringify(m) }); }
}
globalThis.WebSocket = FakeSocket;
globalThis.window = { setTimeout: () => 1, clearTimeout: () => {}, setInterval: () => 1, clearInterval: () => {} };
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };

const entry = new URL('./_fpstamp.entry.ts', import.meta.url);
const out = new URL('./_fpstamp.bundle.mjs', import.meta.url);
writeFileSync(entry, "export { Relay } from '../src/net';\nexport { perform, applyRemote, onPerformed, onBeforeApply } from '../src/commands';\nexport { boardFingerprint } from '../src/secrecy';\n");
await build({
  entryPoints: [fileURLToPath(entry)], outfile: fileURLToPath(out),
  bundle: true, format: 'esm', platform: 'browser', logLevel: 'silent',
  define: { 'import.meta.env.BASE_URL': '"/"' },
});
const M = await import(`${out.href}?t=${Date.now()}`);

const data = { byId: new Map(), cards: [], commonActions: [] };
const fresh = () => ({ v: 3, map: '', tokens: [], nextUid: 1, round: { n: 1, phase: 0, firstPlayer: 's1' }, commandTokens: { s1: 0, s2: 0 }, markers: [], smoke: [] });
const room = { id: 'A', epoch: 1, revision: 0, seats: { s1: 'a', s2: 'b' }, online: { s1: true, s2: true }, hasCheckpoint: true };

// Exactly the wiring match.ts does: the hash captured in onBeforeApply, keyed
// by the command object, is what stampFor hands back at publish time.
const preHash = new WeakMap();
M.onBeforeApply((s, cmd) => { preHash.set(cmd, M.boardFingerprint(s)); });

function peer(seat) {
  const st = fresh();
  const log = [];
  const relay = new M.Relay('http://x', {
    onCommand(cmd) { const v = M.applyRemote(data, st, cmd); log.push(['applied', cmd.kind, v.ok]); },
    onCheckpoint() { log.push(['checkpoint']); },
    onCatchUp() {}, onNeedCheckpoint() {}, onRolled() {}, onClosed() {}, onChange() {},
    snapshot: () => ({}),
    fingerprint: () => M.boardFingerprint(st),
    stampFor: (cmd) => preHash.get(cmd) ?? null,
  });
  relay.host();
  const ws = FakeSocket.instances.at(-1);
  ws.onopen?.();
  ws.deliver({ t: 'room', you: { seat, host: seat === 's1' }, room });
  ws.sent.length = 0;
  return { st, relay, ws, log, seat };
}

console.log('The drift stamp is the board BEFORE the command\n');
{
  const A = peer('s1'), B = peer('s2');
  M.onPerformed((cmd) => A.relay.publish(cmd));
  const before = M.boardFingerprint(A.st);
  M.perform(data, A.st, { kind: 'adjustCommandTokens', seat: 's1', pool: 's1', delta: 2 });
  const after = M.boardFingerprint(A.st);
  check('the command changed the board, so the two hashes differ', before !== after, true);
  const wire = A.ws.sent.pop();
  check('the stamp carries the board before the command', wire.fp, `0:0:${before}`);
  const echo = { t: 'cmd', rev: 1, seat: 's1', seq: wire.seq, cmd: wire.cmd, fp: wire.fp };
  A.ws.deliver(echo);
  B.ws.deliver(echo);
  check('B applied it', B.log, [['applied', 'adjustCommandTokens', true]]);
  check('and did NOT ask for a resync', B.ws.sent.map((m) => m.t), []);
  check('nor flag a desync', [B.relay.state.desynced, B.relay.state.error], [false, null]);
  check('and the two boards agree afterwards', M.boardFingerprint(B.st) === after, true);
}

console.log('\nReal drift is still caught');
{
  FakeSocket.instances.length = 0;
  const A = peer('s1'), B = peer('s2');
  M.onPerformed((cmd) => A.relay.publish(cmd));
  // B's board is quietly different before A's command arrives.
  B.st.commandTokens.s2 = 5;
  M.perform(data, A.st, { kind: 'adjustCommandTokens', seat: 's1', pool: 's1', delta: 1 });
  const wire = A.ws.sent.pop();
  const echo = { t: 'cmd', rev: 1, seat: 's1', seq: wire.seq, cmd: wire.cmd, fp: wire.fp };
  B.ws.deliver(echo);
  check('a board that really differs asks for the checkpoint', B.ws.sent.map((m) => m.t), ['resync']);
  check('and says so', B.relay.state.desynced, true);
  check('while still applying the command', B.log, [['applied', 'adjustCommandTokens', true]]);
}

console.log('\nA throw inside apply is a refusal, not a dropped command');
{
  FakeSocket.instances.length = 0;
  const B = peer('s2');
  const relay = new M.Relay('http://x', {
    onCommand() { throw new Error('boom'); },
    onCheckpoint() {}, onCatchUp() {}, onNeedCheckpoint() {}, onRolled() {}, onClosed() {}, onChange() {},
    snapshot: () => ({}), fingerprint: () => null,
  });
  relay.host();
  const ws = FakeSocket.instances.at(-1);
  ws.onopen?.();
  ws.deliver({ t: 'room', you: { seat: 's2', host: false }, room });
  ws.sent.length = 0;
  let threw = false;
  try { ws.deliver({ t: 'cmd', rev: 1, seat: 's1', seq: 1, cmd: { kind: 'award', seat: 's1' }, fp: null }); } catch { threw = true; }
  check('receive() survives the throw', threw, false);
  check('and asks for the board', ws.sent.map((m) => m.t), ['resync']);
  check('with the desync shown', relay.state.desynced, true);
  void B;
}

console.log('\nmatch.ts wires the stamp the same way');
{
  const match = readFileSync(new URL('../src/match.ts', import.meta.url), 'utf8');
  check('the hash is captured in onBeforeApply', /preHash\.set\(cmd, boardFingerprint\(s\)\)/.test(match), true);
  check('and handed to the relay per command', /stampFor: \(cmd\) => preHash\.get\(cmd\)/.test(match), true);
  check('the checkpoint strips unrevealed dials, like the board page', /if \(t\.kind === 'mech' && !revealed\.includes\(t\.side\)\) t\.timing = undefined;/.test(match), true);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
