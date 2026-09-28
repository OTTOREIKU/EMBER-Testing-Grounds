// Hostile input (2026-09-28). Everything the other side can send - a command,
// a whole board - and everything a shared file can hold is checked before it
// is stored: the angle brackets come out of every string, and the fields the
// pages print are held to their types. The escaping where text is drawn is
// pinned by htmlsinks.test.mjs; this is the other half, run on the real engine.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { installDom } from './_combatdrive.mjs';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}, got ${g}`); }
};

installDom();
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
const entry = new URL('./_hostile.entry.ts', import.meta.url);
const out = new URL('./_hostile.bundle.mjs', import.meta.url);
writeFileSync(entry, [
  "export { applyRemote } from '../src/commands';",
  "export { loadData } from '../src/data';",
  "export { newScriptState } from '../src/types';",
  "export { migrateState, makeMechToken, makeDroneToken } from '../src/units';",
].join('\n') + '\n');
await build({
  entryPoints: [fileURLToPath(entry)], outfile: fileURLToPath(out),
  bundle: true, format: 'esm', platform: 'browser', logLevel: 'silent',
  define: { 'import.meta.env.BASE_URL': '"/"' },
});
const M = await import(`${out.href}?t=${Date.now()}`);
const data = await M.loadData();

console.log('Hostile input\n');

// The RAID-RDL starter's Dune Brawler, and a Porcupine.
const LOADOUT = { torso: '014', chasis: '534', leftHand: '535', rightHand: '025', backpack: '532', pilot: 'FPA-04-2' };
const XSS = '<img src=x onerror=alert(1)>';

// ---------- a board from a file or the other side ----------
const hostile = {
  v: 3, map: '', nextUid: '9<',
  round: { n: '<b>2</b>', phase: 'x', firstPlayer: 's1" onmouseover="x' },
  roundLimit: '5" autofocus',
  commandTokens: { s1: '1<', s2: 2 },
  sideNames: { s1: `${XSS}Reds`, s2: 7 },
  markers: [{ kind: '<x>', col: '1', row: 2 }, { kind: 'box', col: 3, row: 4 }],
  smoke: [{ col: 1, row: 1, side: 's3' }, { col: 2, row: 2, side: 's2' }],
  tokens: [
    {
      uid: 1, side: 's1" x="', kind: 'mech', cardId: '014', mech: LOADOUT, label: `${XSS}Brawler`,
      col: 3, row: 3, size: 3, facing: 9, stance: 'evil', link: '4<b>',
      partStates: { torso: 'intact', leftHand: '<x>' }, ammo: { a: '5' },
      log: [{ round: '1', text: '<b>hit</b>' }, 'junk'], statuses: ['burning', 5, '<x>'],
    },
    { uid: '2', side: 's2', kind: 'drone', cardId: '160', label: 'Stringy', col: 6, row: 6 },
    { uid: 3, side: 's2', kind: 'weird', cardId: '160', label: 'Porcupine', col: 9, row: 9, size: 7, stance: 'defensive' },
    { uid: 4, side: 's2', kind: 'drone', cardId: { evil: true }, label: 'Object id', col: 1, row: 1 },
  ],
};
const m = M.migrateState(hostile, data);
check('the board still loads', !!m, true);
const [t0, t3] = m.tokens;
check('a token whose uid or card id is not the right type is dropped', m.tokens.map((t) => t.uid), [1, 3]);
check('a unit name keeps its words and loses its brackets', t0.label, 'img src=x onerror=alert(1)Brawler');
check('so does a squad name, and one that is not text is dropped', m.sideNames, { s1: 'img src=x onerror=alert(1)Reds' });
check('side, facing, stance, kind and size hold to their values',
  [t0.side, t0.facing, t0.stance, t3.kind, t3.stance, t3.size], ['s1', 0, 'offensive', 'drone', 'defensive', 1]);
check('Link is only ever a number', t0.link, data.byId.get('FPA-04-2')?.LV ?? 3);
check('a Part state outside the three is dropped', t0.partStates, { torso: 'intact' });
check('an Ammo count that is not a number is dropped', [t0.ammo.a, Object.values(t0.ammo).every((n) => typeof n === 'number')], [undefined, true]);
check('log entries are rebuilt as a round and a text', t0.log, [{ round: 0, text: 'bhit/b' }]);
check('statuses are strings without brackets', t0.statuses, ['burning', 'x']);
check('the round, the limit, the tokens and the next uid are numbers',
  [m.round, m.roundLimit, m.commandTokens, m.nextUid], [{ n: 1, phase: 0, firstPlayer: 's1' }, 5, { s1: 0, s2: 2 }, 1]);
check('markers and smoke keep only well-formed entries',
  [m.markers, m.smoke], [[{ kind: 'box', col: 3, row: 4 }], [{ col: 2, row: 2, side: 's2' }]]);
check('nothing anywhere in it still holds a bracket', /[<>]/.test(JSON.stringify(m)), false);

// ---------- commands from the other side ----------
function table() {
  const s = {
    v: 3, map: '', tokens: [], nextUid: 1,
    round: { n: 1, phase: 2, firstPlayer: 's1' },
    commandTokens: { s1: 0, s2: 0 },
    script: { ...M.newScriptState('s1'), strict: false },
    setup: { stage: 'done', rolls: { s1: [], s2: [] }, edge: { s1: 'white', s2: 'black' }, placed: { s1: 0, s2: 0 } },
  };
  const mech = { ...M.makeMechToken(s, data, LOADOUT, 's1'), col: 4, row: 4, facing: 0, deployed: true, statuses: [], log: [] };
  s.tokens.push(mech);
  return { s, mech };
}
{
  const { s, mech } = table();
  const v = M.applyRemote(data, s, { kind: 'renameUnit', seat: 's1', uid: mech.uid, label: `${XSS}Dune` });
  check('a rename is stored without its brackets', [v.ok, mech.label], [true, 'img src=x onerror=alert(1)Dune']);
  const bare = M.applyRemote(data, s, { kind: 'renameUnit', seat: 's1', uid: mech.uid, label: '<>' });
  check('a name that was nothing but brackets is refused', [bare.ok, mech.label], [false, 'img src=x onerror=alert(1)Dune']);
}
{
  // A free table: a guided one only takes squads before deployment ends.
  const s = { v: 3, map: '', tokens: [], nextUid: 1, round: { n: 1, phase: 0, firstPlayer: 's1' }, commandTokens: { s1: 0, s2: 0 } };
  const v = M.applyRemote(data, s, { kind: 'importSquad', seat: 's2', name: '<script>alert(1)</script>Blues', mechs: [], drones: [{ cardId: '160' }] });
  check('a squad list names its squad without brackets', [v.ok, s.sideNames?.s2], [true, 'scriptalert(1)/scriptBlues']);
}
{
  const { s, mech } = table();
  const v = M.applyRemote(data, s, { kind: 'queueReactions', seat: 's1', items: [{ uid: mech.uid, actionId: 'x', count: XSS, range: 2, kind: 'smoke' }] });
  check('a reaction whose count is not a number is refused', v.ok, false);
  const fine = M.applyRemote(data, s, { kind: 'queueReactions', seat: 's1', items: [{ uid: mech.uid, actionId: 'x', count: 1, range: 2, kind: 'smoke' }] });
  check('a well-formed one still queues', [fine.ok, s.script.reactions.length], [true, 1]);
}
{
  const { s } = table();
  const v = M.applyRemote(data, s, { kind: 'setRollbackCatalog', seat: 's1', entries: [
    { round: '1" onmouseover="x', phase: 0, available: true, label: 'bad' },
    { round: 2, phase: 1, available: true, seq: 'y', label: 'fine' },
  ] });
  check('a rollback list keeps only well-formed entries, and their well-formed fields',
    [v.ok, s.script.rollbackCatalog], [true, [{ round: 2, phase: 1, available: true, label: 'fine' }]]);
  const junk = M.applyRemote(data, s, { kind: 'setRollbackCatalog', seat: 's1', entries: 'nope' });
  check('and one that is not a list is refused', junk.ok, false);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
