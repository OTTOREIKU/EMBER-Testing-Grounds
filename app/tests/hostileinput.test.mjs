// Hostile input (2026-09-28). Everything the other side can send - a command,
// a whole board - and everything a shared file can hold is checked before it
// is stored: the angle brackets come out of every string, and the fields the
// pages print are held to their types. The escaping where text is drawn is
// pinned by htmlsinks.test.mjs; this is the other half, run on the real engine.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build, transform } from 'esbuild';
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
  "export { FACTION_LABEL, loadData } from '../src/data';",
  "export { newScriptState, SCALES } from '../src/types';",
  "export { migrateState, makeMechToken, makeDroneToken } from '../src/units';",
  "export { tacticSpec } from '../src/tactics';",
  "export { cleanStrings, escapeHtml } from '../src/safetext';",
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
  scale: 'huge" onmouseover="x', mission: 'control-flank-attack" autofocus x="',
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
check('a scale outside the three is the standard one, and a Main Task that is not an id is none',
  [m.scale, m.mission], ['standard', null]);
{
  const loaded = (extra) => M.migrateState({ v: 3, map: '', tokens: [], ...extra }, data);
  const scales = M.SCALES.map((s) => s.id);
  const missions = data.missions.cards.map((c) => c.id);
  check('every scale the setup offers survives a load', scales.map((id) => loaded({ scale: id }).scale), scales);
  check('and so does every Main Task the data ships', missions.map((id) => loaded({ mission: id }).mission), missions);
  check('a Main Task that is not text, or runs on past any id, is none',
    [loaded({ mission: { evil: true } }).mission, loaded({ mission: 'a'.repeat(65) }).mission],
    [null, null]);
}

// ---------- the words every object inherits ----------
// 'constructor', 'toString' and the rest are found on any plain object, so a
// lookup table keyed by text from outside answered them with a function. The
// loader's old side names did it to every string in a board; the faction
// labels did it to a recorded game's faction; the Tactics Cards to a played id.
{
  const WORDS = ['constructor', 'toString', 'valueOf', 'hasOwnProperty', '__proto__'];
  const board = (word) => M.migrateState({
    v: 3, map: word, tokens: [
      { uid: 1, side: word, kind: 'drone', cardId: '160', label: word, col: 1, row: 1, statuses: [word] },
    ], round: { n: 1, phase: 0, firstPlayer: word }, sideNames: { s1: word }, mission: word, [word]: 1,
  }, data);
  const seen = WORDS.map((w) => { const b = board(w); return [typeof b.map, b.tokens[0]?.label, b.tokens[0]?.side, b.round.firstPlayer, b.sideNames.s1]; });
  check('a board holding one keeps it as the text it is, and never as a side',
    seen, WORDS.map((w) => ['string', w, 's1', 's1', w]));
  check('no function is left anywhere in such a board', WORDS.map((w) => {
    let fn = false;
    JSON.stringify(board(w), (_k, v) => { if (typeof v === 'function') fn = true; return v; });
    return fn;
  }), WORDS.map(() => false));
  check('a faction label is found among its own five and nothing inherited',
    [...WORDS, 'RDL'].map((k) => typeof M.FACTION_LABEL[k]), [...WORDS.map(() => 'undefined'), 'string']);
  check('a Tactics Card is found among its own six',
    [...WORDS.map((k) => M.tacticSpec(k) === null), M.tacticSpec('274')?.id], [...WORDS.map(() => true), '274']);
  // A key that is only __proto__ once its brackets are out is dropped with the rest.
  const cleaned = M.cleanStrings(JSON.parse('{"a":1,"<__proto__>":{"evil":true},"__proto__":{"evil":true}}'));
  check('a key that would become the prototype is dropped, however it is spelled',
    [Object.keys(cleaned), cleaned.evil, Object.getPrototypeOf(cleaned) === Object.prototype], [['a'], undefined, true]);
}

// ---------- what a finished game's record may carry ----------
// The API holds a recorded game to these shapes (ember-api, src/routes/games.ts).
// It has no card data of its own, so the two are pinned together here: a card,
// faction, Main Task or scale that stopped fitting would be refused on record.
{
  const API = {
    card: /^[A-Za-z0-9][A-Za-z0-9+-]{0,23}$/,
    faction: /^[A-Z][A-Z0-9_]{0,23}$/,
    mission: /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    scale: /^(?:skirmish|standard|large)$/,
  };
  const factions = [...new Set(data.cards.map((c) => data.factionOf(c)).filter(Boolean))];
  check('every card id fits the shape the API records', [...data.byId.keys()].filter((id) => !API.card.test(id)), []);
  check('every faction does', [factions.length > 2, factions.filter((f) => !API.faction.test(f))], [true, []]);
  check('every Main Task does', data.missions.cards.map((c) => c.id).filter((id) => id.length > 64 || !API.mission.test(id)), []);
  check('every scale does', M.SCALES.map((s) => s.id).filter((id) => !API.scale.test(id)), []);
}

// ---------- a recorded game, read back in the Stats panel ----------
// Any account may have recorded it, so the panel prints a faction only by its
// label and a Main Task only by its card's name. The three helpers are the
// Match Centre's own, lifted out of the page and run here.
{
  const page = readFileSync(new URL('../src/match.ts', import.meta.url), 'utf8');
  const from = page.indexOf("const NO_FACTION = 'unknown';");
  const to = page.indexOf('// A squad has no name, so it is called by its pilots', from);
  const js = (await transform(page.slice(from, to), { loader: 'ts' })).code;
  const stats = new Function('FACTION_LABEL', 'esc', 'data',
    `${js}\nreturn { factionTag, knownFactions, recordedMission };`)(M.FACTION_LABEL, M.escapeHtml, data);
  const rows = ['RDL', 'constructor', 'unknown', '<b>x</b>', '__proto__', 'GOF', 'toString', 'ANYTHING'].map((faction) => ({ faction, played: 1, wins: 0 }));
  check('the faction list keeps the factions the page knows and the no-single-faction row',
    [from > 0 && to > from, stats.knownFactions(rows).map((f) => f.faction)], [true, ['RDL', 'unknown', 'GOF']]);
  check("a squad's faction is printed by its label, or not at all",
    ['GOF', 'constructor', '__proto__', '<img>', 'ANYTHING', null].map((f) => stats.factionTag(f)), ['GoF \u00b7 ', '', '', '', '', '']);
  const real = data.missions.cards[0];
  check('a recorded Main Task is named by its card, and an unknown one is not printed',
    [real.id, 'constructor', '<b>x</b>', null, ''].map((id) => stats.recordedMission(id)),
    [real.name, 'Main Task', 'Main Task', 'Free battle', 'Free battle']);
  check('the panel uses them for every faction and Main Task it prints',
    [/knownFactions\(t\.factions\)\.map/.test(page), /esc\(recordedMission\(g\.mission\)\)/.test(page),
      (page.match(/factionTag\((?:r|sq)\.faction\)/g) ?? []).length, /\?\? (?:r|sq)\.faction/.test(page), /g\.mission \|\|/.test(page)],
    [true, true, 2, false, false]);
}

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
  // The table's setup, sent by the other side.
  const s = { v: 3, map: '', tokens: [], nextUid: 1, round: { n: 1, phase: 0, firstPlayer: 's1' }, commandTokens: { s1: 0, s2: 0 } };
  const real = data.missions.cards[0].id;
  const bad = M.applyRemote(data, s, { kind: 'configureTable', seat: 's1', mission: 'x" onmouseover="y' });
  const typed = M.applyRemote(data, s, { kind: 'configureTable', seat: 's1', mission: { evil: true } });
  check('a Main Task that is not an id is refused', [bad.ok, typed.ok, s.mission], [false, false, undefined]);
  const good = M.applyRemote(data, s, { kind: 'configureTable', seat: 's1', mission: real });
  check('a real one is taken', [good.ok, s.mission], [true, real]);
  const cleared = M.applyRemote(data, s, { kind: 'configureTable', seat: 's1', mission: null });
  check('and null clears it', [cleared.ok, s.mission], [true, null]);
  const scale = M.applyRemote(data, s, { kind: 'configureTable', seat: 's1', scale: 'huge' });
  check('a scale outside the three is refused', [scale.ok, s.scale], [false, undefined]);
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
