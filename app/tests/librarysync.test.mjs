// Saved units and squads following the account between devices (OTTO,
// 2026-11-11: "make sure all of the units/squads are perfectly syncing between
// devices and apps"). One device is driven with the real modules (api.ts,
// library.ts, the stores); the other device is the fake server's copy being
// rewritten, as its pushes would. The fake server keeps only the fields the
// real one's schema keeps (ember-api src/routes/library.ts), so a field the
// server would strip is caught here.
import { writeFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}, got ${g}`); }
};
console.log('Library sync between devices\n');

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { store.set(k, String(v)); },
  removeItem: (k) => { store.delete(k); },
  key: (i) => [...store.keys()][i] ?? null,
  get length() { return store.size; },
};
globalThis.window = { setTimeout: (fn) => setTimeout(fn, 2), clearTimeout, addEventListener() {} };
globalThis.document = { cookie: '' };
const tick = (ms = 40) => new Promise((r) => setTimeout(r, ms));

// What the server's zod schema keeps of a squad and a unit.
const pick = (o, keys) => Object.fromEntries(keys.filter((k) => o[k] !== undefined).map((k) => [k, o[k]]));
const keepSquad = (s) => pick(s, ['id', 'name', 'mechs', 'drones', 'tactics', 'cap', 'saved']);
const keepUnit = (u) => pick(u, ['id', 'name', 'mech', 'saved']);
const server = { online: true, lib: { units: [], squads: [], hidden: [], removed: [], updatedAt: 0 } };
let clock = 1_000_000;
const stamp = () => { clock = Math.max(clock + 1, Date.now()); return clock; };
globalThis.fetch = async (url, init = {}) => {
  if (!server.online) throw new TypeError('network down');
  const path = new URL(url).pathname;
  const method = init.method ?? 'GET';
  const body = init.body ? JSON.parse(init.body) : undefined;
  const reply = (status, json) => ({ ok: status < 400, status, text: async () => JSON.stringify(json) });
  if (path === '/auth/me') return reply(200, { user: { id: 1, username: 'otto', displayName: null, role: 'player' } });
  if (path === '/library/me' && method === 'GET') return reply(200, server.lib);
  if (path === '/library/me' && method === 'PUT') {
    server.lib = { units: body.units.map(keepUnit), squads: body.squads.map(keepSquad), hidden: body.hidden ?? [], removed: body.removed ?? [], updatedAt: stamp() };
    return reply(200, { ok: true, updatedAt: server.lib.updatedAt });
  }
  if (path === '/inventory/me') return reply(200, { boxes: {}, cards: {}, updatedAt: 0 });
  return reply(404, { error: 'Not found.' });
};
// The other device saving: what its push leaves on the server.
const otherDevice = (fn) => { fn(server.lib); server.lib.updatedAt = stamp(); };

const entry = new URL('./_librarysync.entry.ts', import.meta.url);
const out = new URL('./_librarysync.bundle.mjs', import.meta.url);
writeFileSync(entry, [
  "export { EmberApi } from '../src/api';",
  "export { bindLibrary, pullLibrary, librarySync } from '../src/library';",
  "export { saveSquad, savedSquads, updateSquad, deleteSquad, squadCap } from '../src/squadstore';",
  "export { saveMechPreset, savedMechPresets, deleteMechPreset } from '../src/presets';",
].join('\n') + '\n');
await build({
  entryPoints: [fileURLToPath(entry)], outfile: fileURLToPath(out),
  bundle: true, format: 'esm', platform: 'browser', logLevel: 'silent',
  define: { 'import.meta.env.BASE_URL': '"/"' },
});
const M = await import(`${out.href}?t=${Date.now()}`);
rmSync(entry); rmSync(out);

const api = new M.EmberApi('http://api.test');
M.bindLibrary(api);
await api.refresh();
await tick();
const names = () => M.savedSquads().map((s) => s.name).sort();
const onServer = () => server.lib.squads.map((s) => s.name).sort();
const mech = { loadout: { torso: '014', chasis: '534' } };

// ---------- a squad and its cap reach the account ----------
let [sq] = M.saveSquad('Silent Knives', [mech], [], Date.now()).filter((s) => s.name === 'Silent Knives');
M.updateSquad({ ...sq, cap: 1200 }, Date.now());
await tick();
check('a saved squad reaches the account', onServer(), ['Silent Knives']);
check('with its points cap', server.lib.squads[0].cap, 1200);
check('and nothing is left unsent', M.librarySync().unsent, false);

// ---------- another device's save arrives on a pull ----------
otherDevice((l) => l.squads.push({ id: 'sq-phone', name: 'Built on the phone', mechs: [mech], drones: [], cap: 900, saved: stamp() }));
await M.pullLibrary();
check('a squad saved on another device arrives', names(), ['Built on the phone', 'Silent Knives']);
check('with the cap that device set', M.savedSquads().find((s) => s.id === 'sq-phone').cap, 900);

// ---------- both sides changed: nothing is lost ----------
server.online = false;
M.saveSquad('Saved on the bus', [mech], [], Date.now());
await tick();
check('a save with no signal waits as unsent', M.librarySync().unsent, true);
server.online = true;
otherDevice((l) => l.squads.push({ id: 'sq-desk', name: 'Saved on the desktop', mechs: [mech], drones: [], saved: stamp() }));
await M.pullLibrary();
await tick();
check('a later save elsewhere does not throw away the unsent one', names(), ['Built on the phone', 'Saved on the bus', 'Saved on the desktop', 'Silent Knives']);
check('and the merged copy goes back to the account', onServer(), ['Built on the phone', 'Saved on the bus', 'Saved on the desktop', 'Silent Knives']);

// ---------- deletes travel ----------
const knives = M.savedSquads().find((s) => s.name === 'Silent Knives');
M.deleteSquad(knives.id);
await tick();
check('a delete here reaches the account', [onServer().includes('Silent Knives'), server.lib.removed.includes(knives.id)], [false, true]);
// The phone deletes a squad while this device, offline, saves another.
server.online = false;
M.saveSquad('Offline tweak', [mech], [], Date.now());
await tick();
server.online = true;
otherDevice((l) => { l.squads = l.squads.filter((s) => s.id !== 'sq-phone'); l.removed.push('sq-phone'); });
await M.pullLibrary();
await tick();
check('a delete on another device is not undone by a merge', names().includes('Built on the phone'), false);
check('while this device\'s unsent save survives it', [names().includes('Offline tweak'), onServer().includes('Offline tweak')], [true, true]);
check('and the account still has neither deleted squad', [onServer().includes('Built on the phone'), onServer().includes('Silent Knives')], [false, false]);

// ---------- units the same way ----------
M.saveMechPreset('Octopus Ghost', { torso: '096', chasis: '100' }, Date.now());
await tick();
const ghost = M.savedMechPresets().find((u) => u.name === 'Octopus Ghost');
check('a saved unit reaches the account', server.lib.units.map((u) => u.name), ['Octopus Ghost']);
M.deleteMechPreset(ghost.id);
await tick();
check('and its delete does too', [server.lib.units.length, server.lib.removed.includes(ghost.id)], [0, true]);

console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
