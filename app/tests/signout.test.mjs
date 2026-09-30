// Shared devices and signing out (security audit, 2026-09-30).
//
// W1: a save used to stamp the device's builds with whoever was signed in NOW,
// so the next player's first save claimed the last player's builds and pushed
// them into their own account; signing out left every build on the device.
// W3: a sign-out that never reached the server was shown as done while the
// httpOnly session cookie lived on. W4: room codes, Rejoin offers and game
// secrets outlived sign-out. W2: the pad published its unrevealed Timing Dials
// in the room's checkpoint.
//
// Driven with the real modules (api.ts, library.ts, collection.ts, the stores,
// net.ts) against a fake server, with a fake cookie jar standing in for the
// browser's.
import { writeFileSync, rmSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}, got ${g}`); }
};

console.log('Shared devices and signing out\n');

// ---------- a browser, a cookie jar and a server ----------
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { store.set(k, String(v)); },
  removeItem: (k) => { store.delete(k); },
  key: (i) => [...store.keys()][i] ?? null,
  get length() { return store.size; },
};
// The push debounce, made short: what matters is the order, not the delay.
globalThis.window = { setTimeout: (fn) => setTimeout(fn, 2), clearTimeout, addEventListener() {} };
globalThis.document = { cookie: '' };

const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms));
const server = {
  users: { alice: { id: 1, username: 'alice', displayName: null, role: 'player' }, bob: { id: 2, username: 'bob', displayName: null, role: 'player' } },
  library: {}, inventory: {},
  session: null,             // the uid the cookie jar's session cookie is for
  down: false,               // nothing answers at all
  logoutDown: false,         // only the sign-out request is lost
  getDelay: 0,
  puts: [],                  // every PUT, as [uid, what]
};
const empty = () => ({ units: [], squads: [], hidden: [], updatedAt: 0 });
server.library[1] = empty();
server.library[2] = { units: [], squads: [{ id: 'sq-bob', name: 'Bob list', mechs: [{ loadout: { torso: '092' } }], drones: [], saved: 5 }], hidden: [], updatedAt: 1000 };
server.inventory[1] = { boxes: {}, cards: {}, updatedAt: 0 };
server.inventory[2] = { boxes: { BOB_BOX: 2 }, cards: {}, updatedAt: 1000 };

globalThis.fetch = async (url, init = {}) => {
  const path = new URL(url).pathname;
  const method = init.method ?? 'GET';
  if (server.down || (path === '/auth/logout' && server.logoutDown)) throw new TypeError('network down');
  const body = init.body ? JSON.parse(init.body) : undefined;
  const reply = (status, json) => ({ ok: status < 400, status, text: async () => JSON.stringify(json) });
  const me = server.session;
  if (path === '/auth/me') return reply(200, { user: me ? Object.values(server.users).find((u) => u.id === me) : null });
  if (path === '/auth/login') { const u = server.users[body.username]; server.session = u.id; return reply(200, { user: u, csrfToken: 'csrf' }); }
  if (path === '/auth/logout') { server.session = null; return reply(200, { ok: true }); }
  if (!me) return reply(401, { error: 'Sign in to do that.' });
  if (path === '/library/me' && method === 'GET') { await tick(server.getDelay); return reply(200, server.library[me]); }
  if (path === '/library/me' && method === 'PUT') {
    server.puts.push([me, 'library', body.squads.map((s) => s.name).sort()]);
    server.library[me] = { ...body, updatedAt: Date.now() };
    return reply(200, { ok: true, updatedAt: server.library[me].updatedAt });
  }
  if (path === '/inventory/me' && method === 'GET') { await tick(server.getDelay); return reply(200, server.inventory[me]); }
  if (path === '/inventory/me' && method === 'PUT') {
    server.puts.push([me, 'inventory', Object.keys(body.boxes).sort()]);
    server.inventory[me] = { ...body, updatedAt: Date.now() };
    return reply(200, { ok: true, updatedAt: server.inventory[me].updatedAt });
  }
  return reply(404, { error: 'Not found.' });
};

// ---------- the real modules ----------
const entry = new URL('./_signout.entry.ts', import.meta.url);
const out = new URL('./_signout.bundle.mjs', import.meta.url);
writeFileSync(entry, [
  "export { EmberApi } from '../src/api';",
  "export { bindLibrary } from '../src/library';",
  "export { bindCollection, loadCollection, saveCollection, collectionOn, setCollectionOn } from '../src/collection';",
  "export { saveSquad, savedSquads } from '../src/squadstore';",
  "export { withoutSecretDials } from '../src/net';",
].join('\n') + '\n');
await build({
  entryPoints: [fileURLToPath(entry)], outfile: fileURLToPath(out),
  bundle: true, format: 'esm', platform: 'browser', logLevel: 'silent',
  define: { 'import.meta.env.BASE_URL': '"/"' },
});
const M = await import(`${out.href}?t=${Date.now()}`);
rmSync(entry); rmSync(out);

const api = new M.EmberApi('http://api.test');
M.bindCollection(api);
M.bindLibrary(api);
const squads = () => M.savedSquads().map((s) => s.name).sort();
const save = (name) => M.saveSquad(name, [{ loadout: { torso: '014' } }], [], Date.now());
const boxes = () => Object.keys(M.loadCollection().boxes).sort();
const addBox = (key) => { const c = M.loadCollection(); M.saveCollection({ ...c, boxes: { ...c.boxes, [key]: 1 } }); };
const reload = async () => { await api.refresh(); await tick(); };

// ---------- one player, start to finish ----------
await reload();
await api.login('alice', 'x');
await tick();
save('Alice list');
addBox('ALICE_BOX');
await tick(60);
check('a signed-in save reaches that account', [server.library[1].squads.map((s) => s.name), Object.keys(server.inventory[1].boxes)], [['Alice list'], ['ALICE_BOX']]);

// The tables and secrets a game leaves behind, and what is the device's own.
for (const k of ['ember.pad.rooms', 'ember-last-room', 'ember.pad.dials', 'ember-hand:ROOM1:s1', 'mc-dialsecret-ROOM1', 'ember.pad.notes']) store.set(k, 'x');
M.setCollectionOn(true);

await api.logout();
check('signing out ends the session on the server', [api.user, server.session], [null, null]);
check('and clears the saved builds and the collection from the device', [squads(), boxes(), store.has('ember-library-meta-v1')], [[], [], false]);
check('but keeps this device\'s own switches', M.collectionOn(), true);
check('and forgets the tables sat at and the secrets of their games',
  ['ember.pad.rooms', 'ember-last-room', 'ember.pad.dials', 'ember-hand:ROOM1:s1', 'mc-dialsecret-ROOM1'].map((k) => store.has(k)), [false, false, false, false, false]);
check('while a player\'s own notes stay', store.has('ember.pad.notes'), true);
check('and signing back in brings the builds back from the account', await (async () => {
  await api.login('alice', 'x'); await tick(60);
  return [squads(), boxes()];
})(), [['Alice list'], ['ALICE_BOX']]);

// ---------- a session that ran out, then someone else ----------
// Alice never signs out: her session simply ends, so her builds are still on
// the device with her name on them when Bob signs in there.
server.session = null;
store.set('ember-hand:ROOM2:s1', 'x');
await reload();
check('a page opened with no session clears nothing', [api.user, squads(), store.has('ember-hand:ROOM2:s1')], [null, ['Alice list'], true]);

server.puts.length = 0;
server.getDelay = 200;
await api.login('bob', 'x');
check('the moment Bob signs in, Alice\'s builds are gone from view', [squads(), boxes()], [[], []]);
save('Bob quick save');
addBox('BOB_NEW');
await tick(400);
server.getDelay = 0;
check('Bob\'s save made before his copy arrived is kept beside it, never Alice\'s',
  [server.library[2].squads.map((s) => s.name).sort(), Object.keys(server.inventory[2].boxes).sort()],
  [['Bob list', 'Bob quick save'], ['BOB_BOX', 'BOB_NEW']]);
check('no push ever carried Alice\'s builds into Bob\'s account',
  server.puts.filter(([uid, , what]) => uid === 2 && (what.includes('Alice list') || what.includes('ALICE_BOX'))), []);
check('and Alice\'s own copy on the server is untouched', [server.library[1].squads.map((s) => s.name), Object.keys(server.inventory[1].boxes)], [['Alice list'], ['ALICE_BOX']]);

// ---------- a sign-out that cannot reach the server ----------
server.logoutDown = true;
let said = null;
try { await api.logout(); } catch (e) { said = e.message; }
check('a sign-out the server never got is refused, and says so', [!!said && /still signed in/.test(said), api.user?.username], [true, 'bob']);
check('and nothing is wiped', squads(), ['Bob list', 'Bob quick save']);
server.logoutDown = false;

// A save not yet sent when the network drops: signing out must not wipe it.
server.down = true;
save('Unsent on the bus');
await tick(60);
said = null;
try { await api.logout(); } catch (e) { said = e.message; }
check('a save not yet on the account stops the sign-out', [!!said && /have not reached your account/.test(said), api.user?.username, squads().includes('Unsent on the bus')], [true, 'bob', true]);
server.down = false;
await api.logout();
check('once the network is back, it is sent and the sign-out completes',
  [server.library[2].squads.map((s) => s.name).includes('Unsent on the bus'), api.user, squads()], [true, null, []]);

// ---------- the pad's hidden dials ----------
const board = {
  tokens: [
    { uid: 1, kind: 'mech', side: 's1', timing: 'fast' },
    { uid: 2, kind: 'mech', side: 's2', timing: 'slow' },
    { uid: 3, kind: 'drone', side: 's1', timing: 'fast' },
  ],
  script: { revealed: ['s2'] },
};
const sent = M.withoutSecretDials(board);
check('a checkpoint carries no dial for a squad that has not revealed', sent.tokens.map((t) => t.timing ?? null), [null, 'slow', 'fast']);
check('and leaves the page\'s own board as it was', board.tokens[0].timing, 'fast');
check('with nothing revealed, no Mech dial leaves', M.withoutSecretDials({ tokens: [{ kind: 'mech', side: 's2', timing: 'fast' }] }).tokens[0].timing ?? null, null);
check('anything that is not a board passes through', [M.withoutSecretDials(null), M.withoutSecretDials('x')], [null, 'x']);
const net = readFileSync(new URL('../src/net.ts', import.meta.url), 'utf8');
check('every page\'s checkpoint passes through the strip', /state: withoutSecretDials\(this\.hooks\.snapshot\(\)\)/.test(net), true);
// Pad against pad, the leak used to hand a phone its own dials back inside the
// other phone's board. Without it the pad keeps them as the board page does.
const pad = readFileSync(new URL('../pad/pad.ts', import.meta.url), 'utf8');
check('the pad puts its own unrevealed dials back on an arriving board',
  /onCheckpoint: \(s\) => \{[\s\S]{0,700}if \(seat && !table\.script\?\.revealed\.includes\(seat\)\)[\s\S]{0,250}if \(u\) u\.timing = t\.timing;[\s\S]{0,40}table = m;/.test(pad), true);

console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
