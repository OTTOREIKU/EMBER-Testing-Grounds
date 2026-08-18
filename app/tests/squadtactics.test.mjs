// A squad's Tactics Cards are part of the squad (5.4): saved with it, loaded
// with it, and carried by a squad file. This pins the store round-trip and the
// file parser, because the lobby no longer has a picker to fix a hand that
// arrived wrong.
import { readFileSync, writeFileSync } from 'node:fs';

// The store leans on localStorage; node has none, so a plain map stands in.
const bag = new Map();
globalThis.localStorage = {
  getItem: (k) => (bag.has(k) ? bag.get(k) : null),
  setItem: (k, v) => bag.set(k, String(v)),
  removeItem: (k) => bag.delete(k),
};

const storeSrc = readFileSync(new URL('../src/squadstore.ts', import.meta.url), 'utf8');
const storeTmp = new URL('./_squadstore.slice.ts', import.meta.url);
writeFileSync(storeTmp, 'type MechLoadout = Record<string, string | undefined>;\n'
  + storeSrc.replace(/^import[^\n]*\n/m, ''));
const { saveSquad, loadSquads } = await import(storeTmp.href);

const impSrc = readFileSync(new URL('../src/importer.ts', import.meta.url), 'utf8');
const impTmp = new URL('./_importer.slice.ts', import.meta.url);
writeFileSync(impTmp, 'type Card = any;\ntype ImportedSquad = any;\ntype MechLoadout = any;\ntype PartSlot = string;\n'
  + impSrc.replace(/^import[^\n]*\n/m, ''));
const { parseSquadJson } = await import(impTmp.href);

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}, got ${g}`); }
};

console.log('Tactics travel with the squad\n');

// ---------- the store round-trip ----------

const mechs = [{ name: 'Wild Cat', loadout: { torso: '539', chasis: '099' } }];
saveSquad('Hand Carrier', mechs, [], 1000, ['274', '276']);
const back = loadSquads().find((s) => s.name === 'Hand Carrier');
check('a saved hand comes back with the squad', back?.tactics, ['274', '276']);

saveSquad('Empty Hand', mechs, [], 2000);
check('no hand saves as no field, not an empty list',
  'tactics' in (loadSquads().find((s) => s.name === 'Empty Hand') ?? {}), false);

// Overwriting under the same name replaces the hand along with the units — a
// re-save after dropping a card must not resurrect it.
saveSquad('Hand Carrier', mechs, [], 3000, ['274']);
check('a re-save replaces the hand', loadSquads().find((s) => s.name === 'Hand Carrier')?.tactics, ['274']);
saveSquad('Hand Carrier', mechs, [], 4000);
check('a re-save with no hand clears it',
  loadSquads().find((s) => s.name === 'Hand Carrier')?.tactics, undefined);

// A hand-edited or older store entry must not smuggle junk into setTactics,
// which refuses whole hands: clean() keeps only real string ids.
const raw = JSON.parse(bag.get('ember-squads-v1'));
raw.push({ id: 'sqX', name: 'Junk Hand', mechs: [{ loadout: { torso: '539' } }], drones: [], tactics: ['274', 7, null, ''], saved: 5000 });
bag.set('ember-squads-v1', JSON.stringify(raw));
check('junk in a stored hand is dropped on load',
  loadSquads().find((s) => s.name === 'Junk Hand')?.tactics, ['274']);

// ---------- the file parser ----------

const byId = new Map([
  ['539', { id: '539', category: 'mech_torso' }],
  ['274', { id: '274', category: 'tactics_or_upgrade' }],
  ['276', { id: '276', category: 'tactics_or_upgrade' }],
  ['032', { id: '032', category: 'mech_arm' }],
]);
const parsed = parseSquadJson({
  name: 'From File',
  mechs: [{ parts: { torso: '539' } }],
  drones: [],
  tactics: ['274', '276'],
}, byId);
check('a file hand is read', parsed.tactics, ['274', '276']);
check('a file without one reads back empty',
  parseSquadJson({ name: 'x', mechs: [], drones: [] }, byId).tactics, []);
// A weapon id in the tactics list is a corrupt or hand-edited file; letting it
// through would have setTactics refuse the whole hand later.
check('a non-Tactics id in the list is dropped',
  parseSquadJson({ name: 'x', mechs: [], drones: [], tactics: ['274', '032', 'nope'] }, byId).tactics, ['274']);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
