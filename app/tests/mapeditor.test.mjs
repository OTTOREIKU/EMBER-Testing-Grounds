// Task layers (E2): one map holds a BASE plus a layer per Main Task.
//
// The two things worth guarding here are the ones that fail SILENTLY:
//
// 1. THE FALLBACK CHAIN. resolveLayer is the single place that answers "what
//    does this Task play on for this map". If a caller ever reimplements it,
//    a map would resolve one way in the editor and another in play.
// 2. MISSION IDS AS KEYS. A layer is keyed by mission id, so re-keying a
//    mission orphans every map authored for it with no error anywhere -- the
//    same failure class as a mis-keyed keyword override in the reference data.
import { readFileSync, writeFileSync } from 'node:fs';

const src = readFileSync(new URL('../src/mapeditor.ts', import.meta.url), 'utf8');
// mapeditor.ts imports only a TYPE from types.ts, so stripping imports leaves a
// module that stands alone.
const tmp = new URL('./_mapeditor.slice.ts', import.meta.url);
writeFileSync(tmp, 'type BoardGrids = any;\ntype TerrainPiece = any;\n' + src.replace(/^import[^\n]*\n/gm, ''));
const M = await import(tmp.href);

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}, got ${g}`); }
};
const ok = (name, cond) => check(name, !!cond, true);

// ---------- the fallback chain ----------

const baseZone = { id: 'z1', name: 'Bravo', cells: [{ col: 2, row: 2 }] };
const layerZone = { id: 'z9', name: 'Bravo', cells: [{ col: 7, row: 7 }] };
const map = {
  pieces: [], zones: [baseZone], deploy: { black: [], white: [] },
  tasks: { 'blackbox-fragment-recovery': { zones: [layerZone], objectives: [{ kind: 'blackbox', zone: 'Bravo', col: 22, row: 22 }] } },
};

check('no task resolves the base', M.resolveLayer(map, null).zones[0].cells, [{ col: 2, row: 2 }]);
check('a configured task resolves its own layer', M.resolveLayer(map, 'blackbox-fragment-recovery').zones[0].cells, [{ col: 7, row: 7 }]);
check('an UNconfigured task falls back to the base', M.resolveLayer(map, 'control-frontal-breakthrough').zones[0].cells, [{ col: 2, row: 2 }]);
ok('and says it is not configured', !M.resolveLayer(map, 'control-frontal-breakthrough').configured);
ok('while a configured one says so', M.resolveLayer(map, 'blackbox-fragment-recovery').configured);
check('objectives come from the layer', M.resolveLayer(map, 'blackbox-fragment-recovery').objectives.length, 1);
check('and are empty when nothing authored them', M.resolveLayer(map, null).objectives, []);
check('a null map resolves to empty rather than throwing', M.resolveLayer(null, 'blackbox-fragment-recovery').zones, []);

// ---------- absence stays absence ----------

const plain = { pieces: [], zones: [], deploy: { black: [], white: [] } };
M.saveCustomMap && null; // saveCustomMap needs localStorage; not exercised here.

// normalise() is private, so it is exercised through the exported shape it
// guards: a map with no layers must not GROW an empty tasks object, or every
// printed map would start claiming it had been authored for tasks.
const roundTrip = (m) => JSON.parse(JSON.stringify(m));
ok('a plain map has no tasks key', !('tasks' in roundTrip(plain)));

// ---------- mission ids are real ----------

const missions = JSON.parse(readFileSync(new URL('../../data/missions.json', import.meta.url), 'utf8'));
const zoneData = JSON.parse(readFileSync(new URL('../../data/zones.json', import.meta.url), 'utf8'));
const ids = new Set((missions.cards ?? []).map((m) => m.id));
ok('the mission list is not empty', ids.size > 0);
for (const id of Object.keys(map.tasks)) {
  ok(`the fixture's layer key "${id}" is a real mission id`, ids.has(id));
}

// Every mission names its zones BY NAME, which is what a layer binds. If a card
// ever stopped carrying zone names, the editor would have no variables to offer
// and the whole task-layer idea would silently degrade to free-form painting.
const withZones = (missions.cards ?? []).filter((m) => (m.zones ?? []).length);
ok('mission cards still name their zones', withZones.length > 0);
check('Fragment Recovery still names Bravo',
  (missions.cards.find((m) => m.id === 'blackbox-fragment-recovery')?.zones ?? []).includes('Bravo'), true);

// ---------- the editor cannot place an objective for a task that places none ----------

const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
ok('the objective palette is driven by the mission FAMILY', /function objectiveForTask/.test(main));
ok('objectives are refused outside their own zone', /has to sit inside/.test(main));
ok('an objective drop is a click, never a drag', /p\.kind === 'objective'\) return;/.test(main));
ok('editor undo remembers which layer an edit belonged to', /snap\.task !== editor\.task/.test(main));
ok('switching task stashes before loading', /stashLayer\(\);\s*\r?\n\s*loadLayer\(/.test(main));
// An unconfigured layer seeds from a COPY of the base; sharing the array would
// make editing a task silently rewrite the base map.
ok('a seeded layer deep-copies the base', /clone\(editor\.baseZones\)/.test(main));

// ---------- E3: what the TABLE plays with ----------

// tableZonesFor is the ONE conversion from authored {col,row} to the grid refs
// the whole engine speaks. A map that authored nothing must return null, not an
// empty list: null keeps the shipped nine, empty would hand the table a board
// with no objectives on it at all.
check('an unpainted map authors no zones', M.tableZonesFor({ pieces: [], zones: [], deploy: { black: [], white: [] } }, null), null);
check('a painted base converts to refs', M.tableZonesFor(map, null), [{ id: 'z1', name: 'Bravo', cells: ['C3'] }]);
check('a task layer converts its own', M.tableZonesFor(map, 'blackbox-fragment-recovery'), [{ id: 'z9', name: 'Bravo', cells: ['H8'] }]);
check('a zone with no painted cells is dropped', M.tableZonesFor({ pieces: [], zones: [{ id: 'z', name: 'Bravo', cells: [] }], deploy: { black: [], white: [] } }, null), null);
check('gridRefOf is the inverse of the parser', [M.gridRefOf(0, 0), M.gridRefOf(3, 3), M.gridRefOf(17, 17)], ['A1', 'D4', 'R18']);

// taskItemsFor must PREFER an authored spot and otherwise keep the old derived
// one, for every kind -- a Terminal could not be placed at all before E3.
const tasksSrc = readFileSync(new URL('../src/tasks.ts', import.meta.url), 'utf8');
const tmp2 = new URL('./_tasks.e3.slice.ts', import.meta.url);
writeFileSync(tmp2, 'type Side = any;\ntype TaskState = any;\n' + tasksSrc.replace(/^import[^\n]*\n/gm, ''));
const T = await import(tmp2.href);

const zones = [{ id: 'zb', name: 'Bravo', cells: ['C3'] }, { id: 'zc', name: 'Charlie', cells: ['E5'] }];
const mission = { family: 'blackbox', zones: ['Bravo', 'Charlie'] };

const derived = T.taskItemsFor(zones, mission);
check('with nothing authored, a Box still lands on the first Grid centre',
  { col: derived.items[0].col, row: derived.items[0].row }, { col: 2 * 3 + 1, row: 2 * 3 + 1 });

const authored = T.taskItemsFor(zones, mission, [{ kind: 'blackbox', zone: 'Bravo', col: 10, row: 11 }]);
check('an authored spot wins', { col: authored.items[0].col, row: authored.items[0].row }, { col: 10, row: 11 });
check('and the unauthored one still derives',
  { col: authored.items[1].col, row: authored.items[1].row }, { col: 4 * 3 + 1, row: 4 * 3 + 1 });

// Matching is on the zone NAME the card prints, case-insensitively, because the
// editor binds names and an id would break the moment a zone was repainted.
const cased = T.taskItemsFor(zones, mission, [{ kind: 'blackbox', zone: 'bravo', col: 9, row: 9 }]);
check('the name match ignores case', { col: cased.items[0].col, row: cased.items[0].row }, { col: 9, row: 9 });
// A spot for the WRONG kind must not be picked up by another family's task.
const wrongKind = T.taskItemsFor(zones, mission, [{ kind: 'terminal', zone: 'Bravo', col: 9, row: 9 }]);
check('a spot for another kind is ignored', { col: wrongKind.items[0].col, row: wrongKind.items[0].row }, { col: 7, row: 7 });

// Terminals and Control could carry no explicit spot at all before E3.
const term = T.taskItemsFor(zones, { family: 'terminal', zones: ['Bravo'] }, [{ kind: 'terminal', zone: 'Bravo', col: 4, row: 5 }]);
check('a Terminal can now be placed', { col: term.items[0].col, row: term.items[0].row }, { col: 4, row: 5 });
const ctrl = T.taskItemsFor(zones, { family: 'control', zones: ['Bravo'] });
check('an unplaced Control still has no spot of its own', ctrl.items[0].col, undefined);

// ---------- the private copy in commands.ts must not drift ----------
//
// commands.ts spells the "which zones is this table playing with" fallback out
// by hand, because two dozen test slices strip its imports. Same precedent as
// the grid-ref parsers: allowed, but pinned.
const commands = readFileSync(new URL('../src/commands.ts', import.meta.url), 'utf8');
const zc = commands.slice(commands.indexOf('const zoneCells ='), commands.indexOf('const zoneCells =') + 700);
ok('commands.ts reads the table zones first', /const own = state\.zones/.test(zc));
ok('and falls back to the shipped nine', /data\.zoneData\.zones/.test(zc));
ok('with the same empty-means-shipped rule as zonesOf', /own && own\.length/.test(zc));
const types = readFileSync(new URL('../src/types.ts', import.meta.url), 'utf8');
ok('zonesOf uses that identical rule', /own && own\.length \? own : shipped/.test(types));

// ---------- the readers all went through ----------
for (const [file, why] of [['main.ts', 'freeplay'], ['matchhud.ts', 'Match Centre'], ['playguide.ts', 'the guide']]) {
  const s = readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8');
  ok(`${why} resolves zones through zonesOf`, /zonesOf\(/.test(s));
  ok(`${why} has no raw zoneData.zones reader left`, !/(?<!zonesOf\()\bdata\.zoneData\.zones\.find/.test(s));
}
// The overlay must draw what scores.
ok('the overlay draws the resolved zones', /state\.zones\?\.length/.test(readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8')));
// And the size/zones must survive a load, like grids.
const units = readFileSync(new URL('../src/units.ts', import.meta.url), 'utf8');
ok('migrateState carries the table zones', /zones: \(\(s as \{ zones: TableZone\[\] \}\)\.zones\)/.test(units));

// ---------- E4: export, import, ship ----------
//
// A SHIPPED map is how an authored board reaches multiplayer: it lives in
// data/, so both seats resolve the identical document instead of one of them
// reading the other's localStorage. That makes data/board_maps.json a contract,
// and a hand-added entry is exactly where a broken one would come from.
const shipped = JSON.parse(readFileSync(new URL('../../data/board_maps.json', import.meta.url), 'utf8'));
ok('board_maps.json has a maps array', Array.isArray(shipped.maps));

for (const m of shipped.maps ?? []) {
  ok(`shipped map "${m.id}" has an id`, typeof m.id === 'string' && m.id.length > 0);
  ok(`shipped map "${m.id}" has an English name`, !!m.name?.en);
  ok(`shipped map "${m.id}" has a pieces list`, Array.isArray(m.pieces));
  // Only sizes we actually ship; anything else would be read as the printed
  // board by gridsOf and the file would be lying about itself.
  ok(`shipped map "${m.id}" declares a size we ship`, m.grids === undefined || m.grids === 12 || m.grids === 16 || m.grids === 18);
  // THE ORPHAN TRAP: a task layer keyed by a mission id that no longer exists
  // is silently ignored for the rest of the map's life.
  for (const key of Object.keys(m.tasks ?? {})) {
    ok(`shipped map "${m.id}" layer key "${key}" is a real mission id`, ids.has(key));
  }
  // A zone the map paints but no Task ever names is dead weight; a Task name
  // with no zone is the unbound-slot case the editor already shows. Only the
  // first is checkable from data alone.
  const named = new Set((missions.cards ?? []).flatMap((x) => x.zones ?? []).map((z) => z.toLowerCase()));
  for (const z of m.zones ?? []) {
    ok(`shipped map "${m.id}" zone "${z.name}" is a name some Task uses`, named.has(String(z.name).toLowerCase()));
  }
  // And every authored objective must sit in a zone the same document defines,
  // or it would resolve to a spot outside the area the Task card names.
  const zoneNames = new Set([...(m.zones ?? []), ...Object.values(m.tasks ?? {}).flatMap((l) => l.zones ?? [])].map((z) => String(z.name).toLowerCase()));
  const allObjectives = [...(m.objectives ?? []), ...Object.values(m.tasks ?? {}).flatMap((l) => l.objectives ?? [])];
  for (const o of allObjectives) {
    ok(`shipped map "${m.id}" objective in "${o.zone}" names a zone it defines`, zoneNames.has(String(o.zone).toLowerCase()));
  }
}

// The loader must tolerate the file being absent or junk: a map file is not
// worth failing the whole app over.
const dataSrc = readFileSync(new URL('../src/data.ts', import.meta.url), 'utf8');
ok('board_maps.json is fetched', /board_maps\.json/.test(dataSrc));
ok('and a missing file falls back to no maps', /\.catch\(\(\) => \(\{ maps: \[\] as BoardMapDef\[\] \}\)\)/.test(dataSrc));
ok('and idless entries are dropped', /typeof m\.id === 'string' && m\.id/.test(dataSrc));

// ONE map resolver on the board page: the four places that used to test
// `custom:` themselves are the kind that drift apart.
ok('main.ts resolves every map through mapDoc', /function mapDoc\(id: string\)/.test(main));
ok('mapDoc knows both storages', /startsWith\('custom:'\)[\s\S]{0,200}boardMaps/.test(main));
ok('the export carries the whole document', /\.\.\.editorDoc\(\)/.test(main));
ok('the export is shaped for board_maps.json', /id: slugOf\(name\), name: \{ en: name \}/.test(main));
ok('import goes through saveCustomMap so it is normalised', /saveCustomMap\(name\.trim\(\), raw as CustomMap\)/.test(main));
ok('import rejects a file with no pieces list', /A map file has a `pieces` list/.test(main));

// The Match Centre must offer shipped authored maps and resolve their zones,
// and must NOT offer browser-local ones (the other seat cannot read them).
const matchSrc = readFileSync(new URL('../src/match.ts', import.meta.url), 'utf8');
ok('the Match Centre lists shipped authored maps', /data\?\.boardMaps \?\? \[\]/.test(matchSrc));
// Code only, not prose: the comments above these call sites legitimately
// mention `custom:` to explain WHY none is offered.
const matchCode = matchSrc
  .split('\n')
  .filter((l) => !/^\s*(\/\/|\*)/.test(l))
  .join('\n');
ok('and never reads a custom: map', !/custom:/.test(matchCode));
ok('nor loads one from storage', !/loadCustomMap/.test(matchCode));
ok('picking a map carries its size', /grids: gridsOf\(doc\)/.test(matchSrc));
ok('picking a Task resolves the map layer', /tableZonesFor\(doc, m\.id\)/.test(matchSrc));
const hudSrc2 = readFileSync(new URL('../src/matchhud.ts', import.meta.url), 'utf8');
ok('the Match Centre draws an authored map terrain', /function mapPieces\(/.test(hudSrc2));
ok('and draws the resolved zones', /s\.zones\?\.length/.test(hudSrc2));

// ---------- E5: the scaled drafts ----------
//
// The printed nine are a POINT-SYMMETRIC layout: mirroring any zone through the
// board centre lands on its opposite number. A scaled draft that loses that has
// gone wrong in a way no bounds check would catch, and it would hand one player
// a better board than the other.
const PAIRS = [['alpha', 'india'], ['charlie', 'golf'], ['bravo', 'hotel'], ['delta', 'foxtrot']];
const keyOf = (c) => `${c.col},${c.row}`;

for (const m of (shipped.maps ?? []).filter((x) => /^draft-/.test(x.id))) {
  const n = m.grids;
  const zoneOf = (id) => m.zones.find((z) => z.id === id);
  const mirror = (cells) => new Set(cells.map((c) => keyOf({ col: n - 1 - c.col, row: n - 1 - c.row })));
  const setOf = (cells) => new Set(cells.map(keyOf));

  ok(`${m.id} carries all nine printed zones`, m.zones.length === 9);
  for (const [a, b] of PAIRS) {
    const za = zoneOf(a), zb = zoneOf(b);
    if (!za || !zb) { ok(`${m.id} has ${a} and ${b}`, false); continue; }
    const want = mirror(za.cells), got = setOf(zb.cells);
    ok(`${m.id}: ${b} is the point-mirror of ${a}`, want.size === got.size && [...want].every((k) => got.has(k)));
  }
  // The centre zone must be its own mirror, or the middle of the board is
  // off-centre and both players are fighting over a lopsided objective.
  const echo = zoneOf('echo');
  ok(`${m.id}: echo is self-symmetric`, echo && [...mirror(echo.cells)].every((k) => setOf(echo.cells).has(k)));

  // No zone may overlap another or leave the board.
  const seen = new Map();
  let clash = null, oob = null;
  for (const z of m.zones) for (const c of z.cells) {
    if (c.col < 0 || c.row < 0 || c.col >= n || c.row >= n) oob ??= `${z.id} ${keyOf(c)}`;
    if (seen.has(keyOf(c))) clash ??= `${z.id} over ${seen.get(keyOf(c))}`;
    seen.set(keyOf(c), z.id);
  }
  ok(`${m.id}: every zone is on the board`, !oob);
  ok(`${m.id}: no two zones overlap`, !clash);

  // Each zone keeps its PRINTED footprint: the draft moves zones, it does not
  // resize them. If that ever changes deliberately, this assertion is the place
  // to record the new intent.
  const printedSize = { alpha: 2, bravo: 4, charlie: 2, delta: 2, echo: 4, foxtrot: 2, golf: 2, hotel: 4, india: 2 };
  for (const z of m.zones) {
    ok(`${m.id}: ${z.id} keeps its printed footprint`, z.cells.length === printedSize[z.id]);
  }

  // Deployment: the base is the edge strips, and the corner-deployment Tasks
  // override it through a layer that defines ONLY deploy, so their zones fall
  // through to the base.
  ok(`${m.id}: the base deploys along both edges`, m.deploy.black.length > 0 && m.deploy.white.length === m.deploy.black.length);
  const depRows = (cells) => new Set(cells.map((c) => c.row)).size;
  ok(`${m.id}: the strips are deeper than the printed two`, depRows(m.deploy.black) >= 3);
  for (const [id, layer] of Object.entries(m.tasks ?? {})) {
    ok(`${m.id}: corner layer ${id} overrides only the deploy`, !layer.zones && !layer.objectives && !!layer.deploy);
    ok(`${m.id}: corner layer ${id} keeps the sides apart`,
      !layer.deploy.black.some((b) => layer.deploy.white.some((w) => w.col === b.col && w.row === b.row)));
  }
  // Every mission the printed data deploys into corners must have a layer here,
  // or that Task would silently play with edge strips on the larger board.
  const cornerMissions = Object.entries(zoneData.missionDeployment).filter(([, v]) => v === 'corners').map(([k]) => k);
  for (const id of cornerMissions) {
    ok(`${m.id}: ${id} keeps its corner deployment`, !!m.tasks?.[id]);
  }
}

// ---------- the deployment must travel too ----------
//
// This is the half that makes a larger board PLAYABLE rather than merely
// pretty. The printed shapes are written in A1-L12, so on a 16 or 18 Grid board
// the White corner resolves into the MIDDLE of the table. The authored zones
// therefore have to reach the placement gate, not just the drawing.
const types2 = readFileSync(new URL('../src/types.ts', import.meta.url), 'utf8');
ok('the state carries deployZones', /deployZones\?: \{ black: string\[\]; white: string\[\] \}/.test(types2));
ok('mapeditor converts them to refs', /export function tableDeployFor/.test(src));
ok('configureTable carries them', /deployZones\?: GameState\['deployZones'\] \| null/.test(commands));
ok('and clears them for a printed board', /delete state\.deployZones/.test(commands));
ok('migrateState carries them through a load', /deployZones: \{ black, white \}/.test(units));

// freeplay: overlayDeployment is BOTH the picture and the gate that
// startDeployPlacement reads, so one preference covers placement and drawing.
ok('freeplay prefers the authored deployment', /const dz = state\.deployZones/.test(main));
ok('and startDeployPlacement gates on that same function', /const shape = overlayDeployment\(\)\?\.\[su\.edge\[t\.side\]\]/.test(main));

// the Match Centre: deployCellsFor is the gate there.
const hud3 = readFileSync(new URL('../src/matchhud.ts', import.meta.url), 'utf8');
const gate = hud3.slice(hud3.indexOf('export function deployCellsFor'), hud3.indexOf('export function deployCellsFor') + 1400);
ok('the Match Centre gate prefers the authored deployment', /s\.deployZones\?\.\[su\.edge\[side\]\]/.test(gate));
ok('and still falls back to the printed shape', /missionDeployment\[s\.mission\]/.test(gate));

// ---------- EXECUTABLE deployment cover (E6) ----------
//
// The E5 deployment assertions were all source regexes. A verification agent
// proved the hole empirically: it gutted ALL FOUR sites at once (tableDeployFor
// forced to null, resolveLayer's deploy fallback dropped, and both readers
// short-circuited) and `npm test` still exited 0. These assertions RUN the
// resolver and the converter instead, so the same mutation fails loudly.
const map18 = {
  pieces: [], zones: [], deploy: { black: [{ col: 0, row: 0 }], white: [{ col: 0, row: 15 }] },
  tasks: {
    'blackbox-fragment-recovery': { deploy: { black: [{ col: 0, row: 0 }], white: [{ col: 10, row: 14 }] } },
  },
};
check('a task layer deploy wins over the base',
  M.resolveLayer(map18, 'blackbox-fragment-recovery').deploy.white, [{ col: 10, row: 14 }]);
check('an unconfigured task falls back to the base deploy',
  M.resolveLayer(map18, 'no-such-mission').deploy.white, [{ col: 0, row: 15 }]);
check('and so does no task at all — deployment belongs to the battlefield',
  M.resolveLayer(map18, null).deploy.white, [{ col: 0, row: 15 }]);

check('tableDeployFor converts a layer to grid refs',
  M.tableDeployFor(map18, 'blackbox-fragment-recovery').white, ['K15']);
check('and converts the base when the task has none',
  M.tableDeployFor(map18, null).white, ['A16']);
check('and answers null when nothing is painted, so the printed shape survives',
  M.tableDeployFor({ pieces: [], zones: [], deploy: { black: [], white: [] } }, null), null);

// The shipped drafts must really carry deployment, or the converter above has
// nothing to convert on the boards a player actually picks.
for (const m of (shipped.maps ?? []).filter((x) => /^draft-/.test(x.id))) {
  const base = M.tableDeployFor(m, null);
  ok(`${m.id} resolves base Deployment Zones`, !!base && base.black.length > 0 && base.white.length > 0);
  // A corner Task must resolve to something DIFFERENT from the base strips,
  // which is the whole reason the deploy-only layers exist.
  const corner = M.tableDeployFor(m, 'blackbox-fragment-recovery');
  ok(`${m.id} resolves a corner Task to its own deployment`, !!corner);
  ok(`${m.id} corner deployment differs from the base strips`,
    JSON.stringify(corner) !== JSON.stringify(base));
  // Opposite ends: no cell may appear in both sides' zones.
  const overlap = (corner?.black ?? []).some((b) => (corner?.white ?? []).includes(b));
  ok(`${m.id} keeps the two sides apart`, !overlap);
}

// The senders must not throw the battlefield's deployment away when the Main
// Task is cleared. This is the exact regression the sweep found in BOTH pages.
for (const [f, why] of [['main.ts', 'freeplay'], ['match.ts', 'the Match Centre']]) {
  const s = readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8');
  const bad = /deployZones:\s*\w+\s*\?\s*tableDeployFor\([^)]*\)\s*:\s*null/.test(s);
  ok(`${why} keeps the map's Deployment Zones when no Task is chosen`, !bad);
  ok(`${why} resolves them with an optional mission`, /tableDeployFor\([^)]*\?\.\s*id\s*\?\?\s*null\)|tableDeployFor\(mapDoc\([^)]*\),\s*\w+\?\.\s*id\s*\?\?\s*null\)/.test(s));
}

// A checkpoint REPLACES the board. Merging let a 16/18 Grid game's geometry
// survive under a printed board that carries none of those fields.
ok('the freeplay checkpoint replaces rather than merges',
  /for \(const k of Object\.keys\(live\)\) if \(!\(k in next\)\) delete live\[k\]/.test(main));

// Reading a Task must not WRITE to it: editorSnapshot runs on every render.
ok('the dirty check never stashes into the open layer', /editorDoc\(false\)/.test(main));
ok('and editorDoc only stashes when asked', /function editorDoc\(stash = true\)/.test(main));

// The command layer offers the TABLE's zones for a designation, not the
// shipped nine, or an authored map's zone can be named but never scored.
ok('missionZones reads the table zones', /const own = state\.zones;[\s\S]{0,200}placed\.has/.test(commands));

// ---------- the final sweep's findings, pinned ----------
//
// Each of these was a live bug found by re-reading the whole unpushed diff
// after E6. They share one family: a field or a working set added late, and a
// path written earlier that never learned about it.

// 1. The dirty check must SEE the active working set. editorDoc used to read
//    only the STASHED copy of the open Task's layer (and, after an editor undo,
//    a stale base array), so unsaved work was invisible to the exit prompt and
//    could be discarded silently.
ok('editorDoc overlays the live task layer for read-only calls', /live\[editor\.task\]/.test(main));
ok('and reads the working set for the base when it is open', /editor\.task === null\s*\r?\n?\s*\? \{ zones: editor\.zones/.test(main));

// 2. configureTable arrives over the wire; a malformed zones/deployZones
//    payload must be NORMALISED, not stored raw -- a throw inside apply() stops
//    the receiving seat's command stream dead.
ok('configureTable apply normalises zones off the wire', /const zs = \(Array\.isArray\(cmd\.zones\)/.test(commands));
ok('and deployZones', /const dz = \{ black: refs\(cmd\.deployZones\?\.black\)/.test(commands));

// 3. Every reset path clears the derived board trio. clearTerrain, clearZones,
//    deleting the map, and BOTH scenario loaders each left grids/zones/
//    deployZones standing from the previous map.
const trioClears = (main.match(/delete state\.deployZones;/g) ?? []).length;
ok('at least five reset paths clear deployZones (clears, delete-map, two scenario loads)', trioClears >= 5);
ok('and the map size goes with the map', (main.match(/delete state\.grids;/g) ?? []).length >= 4);

// 4. The Match Centre overlay decides zones and deployment INDEPENDENTLY: a
//    map may author deployment and no zones, and what is drawn must be what
//    the placement gate uses.
const hud = readFileSync(new URL('../src/matchhud.ts', import.meta.url), 'utf8');
ok('the Match Centre overlay decouples zones from deployment', /printedOv\.deploy/.test(hud) && /printedOv\.zones/.test(hud));

// 5. Saving or importing a map re-resolves the TASK ITEMS against the new
//    document, and never writes state.map around a battlefield lock.
ok('saveMapFlow re-resolves tasks against the saved map', /tasksForMission\(missionCard, mapId\)/.test(main));
ok('and importMapFile does the same', /tasksForMission\(data\.missions\.cards\.find\(\(m\) => m\.id === state\.mission\), imported\)/.test(main));
const saveBlock = main.slice(main.indexOf('async function saveMapFlow'), main.indexOf('async function requestExitEditor'));
ok('a refused save never writes state.map around the lock', !/if \(!saved\.ok\) \{\s*\r?\n\s*state\.map/.test(saveBlock));


// ---------- the stash writes only what the layer OWNS ----------
//
// loadLayer fills any field a layer does not define with a COPY of the base.
// stashLayer used to write all three fields back, so merely VISITING a Task
// materialised those copies: the dirty check tripped on an untouched map, and
// a save after the visit froze the base's zones into the layer - from then on
// base edits silently stopped reaching that Task. Found by driving the real
// editor on the shipped 18x18 draft, whose blackbox layer defines ONLY deploy.
//
// Behavioural, not a regex: the three functions are sliced out of main.ts and
// driven against a fake editor, so gutting the ownership test goes red here.
{
  const start = main.indexOf('  function stashLayer(): void {');
  const end = main.indexOf('  function selectEditorTask(');
  if (start < 0 || end <= start) throw new Error('could not slice the stash trio from main.ts');
  const trio = main.slice(start, end);
  const tmp3 = new URL('./_mapeditor.stash.slice.ts', import.meta.url);
  writeFileSync(tmp3, `type TaskLayer = any; type CustomZone = any; type MapObjective = any; type CustomMap = any;
export const editor: any = {
  task: null, zones: [], deploy: { black: [], white: [] }, objectives: [],
  baseZones: [], baseDeploy: { black: [], white: [] }, baseObjectives: [],
  layers: {}, layerOwned: { zones: false, deploy: false, objectives: false },
};
${trio}
export { stashLayer, loadLayer, stashedLayer };
`);
  const S = await import(tmp3.href);
  const ed = S.editor;

  // The shipped-draft shape: a layer that defines ONLY deploy.
  ed.baseZones = [{ id: 'z1', name: 'Bravo', cells: [{ col: 1, row: 1 }] }];
  ed.baseDeploy = { black: [{ col: 0, row: 0 }], white: [{ col: 9, row: 9 }] };
  ed.baseObjectives = [];
  ed.layers = { bb: { deploy: { black: [{ col: 3, row: 3 }], white: [{ col: 5, row: 5 }] } } };
  ed.task = null;
  ed.zones = ed.baseZones;
  ed.deploy = ed.baseDeploy;
  ed.objectives = ed.baseObjectives;

  // Visit the task and come straight back.
  S.stashLayer(); S.loadLayer('bb');
  S.stashLayer(); S.loadLayer(null);
  check('a visit stashes only what the layer defined', Object.keys(ed.layers.bb), ['deploy']);
  ok('and the base zones were not frozen into it', !ed.layers.bb.zones);

  // Visit again and actually EDIT the zones this time.
  S.stashLayer(); S.loadLayer('bb');
  ed.zones = [{ id: 'z2', name: 'Bravo', cells: [{ col: 7, row: 7 }] }];
  S.stashLayer(); S.loadLayer(null);
  ok('an edited field IS stashed', Array.isArray(ed.layers.bb.zones) && ed.layers.bb.zones[0].id === 'z2');
  check('and the untouched field still falls through', Object.keys(ed.layers.bb).sort(), ['deploy', 'zones']);

  // A task with NO layer at all: visiting must not create one.
  S.stashLayer(); S.loadLayer('never-authored');
  S.stashLayer(); S.loadLayer(null);
  ok('visiting an unauthored task creates no layer', !('never-authored' in ed.layers));
}


// ---------- the editor shows what PLAY would use ----------
//
// The editor drew only what was painted, so opening it on any map without
// authored zones showed an empty board for every Main Task while the table on
// that same map plays the shipped nine - switching Task looked like it did
// nothing at all. Unpainted zones are drawn as ghosts now.

{
  const oz = main.slice(main.indexOf('function overlayZones()'), main.indexOf('function overlayDeployment()'));
  ok('the editor ghosts what it does not author', /ghost: true/.test(oz));
  // The SOURCE matters: resolveZoneSet answers "which overlay is displayed",
  // which is empty until someone picks one. taskItemsFor matches a mission's
  // printed zone names against data.zoneData.zones, so that is what a Task
  // would really play here.
  ok('and ghosts come from the shipped zone data', /data\.zoneData\.zones/.test(oz));
  ok('painted zones suppress their own ghost', /!have\.has\(z\.name\)/.test(oz));
  // THE GHOST MUST FOLLOW THE OPEN TASK. A Main Task names a SUBSET of the nine,
  // so ghosting all of them made every Task look identical - the ghost appeared
  // but never changed, which reads as more broken than showing nothing.
  ok('and the ghost is filtered to the Task the editor has open', /taskZoneNames\(editor\.task\)/.test(oz));

  const od = main.slice(main.indexOf('function overlayDeployment()'), main.indexOf('function overlayDeployment()') + 1600);
  // printedDeployment takes a SHAPE id ('corners' / 'strips'); missionDeployment
  // is the map from mission id to shape. Passing a mission id straight in
  // matches nothing and the ghost silently never appears.
  ok('the deployment ghost resolves the shape through missionDeployment',
    /data\.zoneData\.missionDeployment\[editor\.task\]/.test(od));
  ok('an unauthored deployment ghosts the printed shape', /printedDeployment\(data, shape\)/.test(od));
  ok('and an authored one is never ghosted', /if \(painted\) return own;/.test(od));
}

// ---------- the board size selector ----------
//
// A map used to inherit the TABLE's size with no way to change it, so authoring
// a 16 or 18 Grid map meant knowing to load a scaled draft first.

{
  const bar = main.slice(main.indexOf("<p class=\"ed-glabel\">Board size</p>"), main.indexOf("<p class=\"ed-glabel\">Main Task</p>"));
  ok('the editor offers the three board sizes', /\[12, 16, 18\] as const/.test(bar));

  const fn = main.slice(main.indexOf('async function setEditorGrids'), main.indexOf('function selectEditorTask'));
  ok('a shrink that would cut work asks first', /confirmDialog\(\{[\s\S]{0,200}Shrink to/.test(fn));
  ok('and a refusal leaves the board alone', /if \(!sure\) \{/.test(fn));
  // EVERY layer is trimmed, not just the open one: a Grid left outside on a
  // Task nobody has open would reappear the moment that Task was selected.
  ok('every task layer is trimmed, not just the open one', /Object\.entries\(editor\.layers\)/.test(fn));
  ok('the size travels as a command so a second seat gets it', /kind: 'configureTable'[^\n]*grids: want/.test(fn));
  ok('and both the renderer and the geometry gates are told', /board\.setGrids\(gridsOf\(state\)\);[\s\S]{0,80}setBoardGrids\(gridsOf\(state\)\)/.test(fn));
  ok('the edit is undoable', /pushUndo\(\)/.test(fn));
}


// ---------- printed geometry is CENTRED on a larger board ----------
//
// The shipped zones and the printed deployment shapes are authored A1-L12, so
// on a 16 or 18 Grid board they hug one corner and leave the rest of the table
// empty. The real large mat centres the same play area.

{
  const off = main.slice(main.indexOf('function printedOffset()'), main.indexOf('function overlayZones()'));
  ok('the offset is half the growth over the printed board', /\(gridsOf\(state\) - DEFAULT_GRIDS\) \/ 2/.test(off));

  const oz = main.slice(main.indexOf('function overlayZones()'), main.indexOf('function overlayDeployment()'));
  ok('the ghost is centred', /centreZones\(ghosts, printedOffset\(\)\)/.test(oz));

  // WHAT IS DRAWN IS WHAT SCORES. Scoring reads the shipped refs UNSHIFTED
  // through zonesOf(), so centring the real overlay would draw one Bravo and
  // score another - the defect the E3 note in overlayZones describes. Only the
  // editor's ghost moves, because a ghost scores nothing.
  ok('but the real overlay is NOT', /return resolveZoneSet\(state\.zoneSet \?\? ''\)\.zones;/.test(oz));

  const od = main.slice(main.indexOf('function overlayDeployment()'), main.indexOf('const BOARD_SETS'));
  ok('the deployment ghost is centred too', /centreDeploy\(/.test(od));
  // This function also gates startDeployPlacement, so moving the real one would
  // move where units may legally be placed.
  ok('and the real deployment is not moved', /return resolveZoneSet\(state\.zoneSet \?\? ''\)\.deploy;/.test(od));
}

// ---------- resizing recentres the map ----------
{
  const fn = main.slice(main.indexOf('async function setEditorGrids'), main.indexOf('function selectEditorTask'));
  ok('a resize shifts the map by half the change', /const shift = Math\.floor\(\(want - now\) \/ 2\)/.test(fn));
  // Grids and SUBCELLS are different units: zones and deployment are Grids,
  // terrain and objectives are subcells, three to a Grid.
  ok('and shifts subcell coordinates by three times as much', /shift \* 3/.test(fn));
  ok('every layer moves with it', /moveZones\(layer\.zones\)/.test(fn));
  // Recentre BEFORE the trim, or a shrink drops what fell outside the old
  // position rather than the new one.
  ok('the shift happens before the trim', fn.indexOf('const shift =') < fn.indexOf('const inside ='));
}

// ---------- the map list is grouped by board size ----------
{
  ok('the sizes are the sections', /MAP_SIZE_GROUPS/.test(main));
  ok('and each names the game it is for', /12x12 \(900pt\)/.test(main) && /16x16 \(1200pt\)/.test(main));
  const fn = main.slice(main.indexOf('function populateMapSelect()'), main.indexOf('function populateMapSelect()') + 2600);
  ok('an empty section is not drawn', /if \(!mine\.length\) continue;/.test(fn));
  ok('and Empty board stays outside the groups', fn.indexOf("empty.textContent = 'Empty board'") < fn.indexOf('MAP_SIZE_GROUPS'));
}


// ---------- the deployment label sits ON its zone ----------
//
// An AUTHORED deployment is a list of cells; only the PRINTED shapes are rects.
// The cells branch centred its label on the single topmost Grid, so a ~190px
// label hung off a 90px Grid - and when that Grid was at column 0 the left half
// fell outside the viewBox and was clipped, showing "CK DEPLOYMENT ZONE".
{
  const board = readFileSync(new URL('../src/board.ts', import.meta.url), 'utf8');
  const dz = board.slice(board.indexOf('if (deploy) {'), board.indexOf('for (const z of zones)'));
  ok('the cells branch centres on the whole shape', /Math\.min\(\.\.\.cols\) \+ Math\.max\(\.\.\.cols\)/.test(dz));
  ok('vertically too', /Math\.min\(\.\.\.rows\) \+ Math\.max\(\.\.\.rows\)/.test(dz));
  ok('and no longer on the topmost Grid alone', !/const top = \[\.\.\.shape\.cells\]/.test(dz));
  // A zone narrower than its own label still overflows it - fine over the
  // battlefield, not fine over the edge, where it is simply cut off.
  ok('the label is clamped to the board', /boardPx - half/.test(dz));
  ok('and the clamp reads the board its own size', /this\.grids \* LG/.test(dz));
}


// ---------- one zone, one area ----------
//
// A Tactical Zone is a PLACE: Bravo is somewhere, not several somewheres.
// Nothing stopped a second unattached Bravo being painted across the table.
//
// DIAGONALS COUNT AS TOUCHING. Four of the nine PRINTED zones are diagonal
// pairs - Alpha B2+C3, Charlie C10+B11, Golf K2+J3, India J10+K11 - so an
// orthogonal-only rule calls the real game board broken. The first version did
// exactly that: it refused every edit on every shipped map and left those four
// zones unrepairable. The data below is the real thing, not a fixture.
{
  const start = main.indexOf('  const cellKey = (c: { col: number; row: number })');
  const end = main.indexOf('  function commitDrag(): void {');
  if (start < 0 || end <= start) throw new Error('could not slice the contiguity helpers from main.ts');
  const tmp4 = new URL('./_mapeditor.contig.slice.ts', import.meta.url);
  writeFileSync(tmp4, `export const editor: any = { zones: [] };
${main.slice(start, end)}
export { areaCount, zonesAfter, zonesBrokenBy };
`);
  const C = await import(tmp4.href);
  const cell = (col, row) => ({ col, row });
  const ref = (r) => {
    const m = /^([A-La-l])(\d{1,2})$/.exec(r);
    return cell(m[1].toUpperCase().charCodeAt(0) - 65, +m[2] - 1);
  };

  // THE PRINTED BOARD IS THE SPEC. Every shipped zone must read as one area, or
  // the editor refuses to let anyone touch the maps we ship.
  const zonesJson = JSON.parse(readFileSync(new URL('../../data/zones.json', import.meta.url), 'utf8'));
  const notOne = zonesJson.zones
    .filter((z) => C.areaCount(z.cells.map(ref)) !== 1)
    .map((z) => z.name);
  check('every printed zone is one area', notOne, []);

  // And every zone on every shipped authored map.
  const boardMaps = JSON.parse(readFileSync(new URL('../../data/board_maps.json', import.meta.url), 'utf8'));
  const badMapZones = [];
  for (const m of boardMaps.maps ?? []) {
    for (const z of m.zones ?? []) {
      if (C.areaCount(z.cells) !== 1) badMapZones.push(`${m.id}/${z.name}`);
    }
  }
  check('and every zone on every shipped map', badMapZones, []);

  check('a diagonal pair is one area, as Alpha is', C.areaCount([ref('B2'), ref('C3')]), 1);
  check('a solid block is one', C.areaCount([cell(0, 0), cell(1, 0), cell(0, 1), cell(1, 1)]), 1);
  check('two far-apart Grids are two', C.areaCount([cell(0, 0), cell(5, 5)]), 2);
  check('and nothing is nothing', C.areaCount([]), 0);

  const bravo = { id: 'b', name: 'Bravo', cells: [cell(0, 5), cell(1, 5), cell(0, 6), cell(1, 6)] };
  const echo = { id: 'e', name: 'Echo', cells: [cell(5, 0), cell(6, 0), cell(7, 0)] };
  // A zone that is ALREADY split, which the printed data made routine.
  // Two Grids with exactly one gap between them, so painting the gap really
  // does mend it. The first version used Grids nine apart and called the Grid
  // in the middle a bridge, which it was not - it was a third island.
  const split = { id: 's', name: 'Split', cells: [cell(0, 0), cell(2, 0)] };
  C.editor.zones = [bravo, echo, split];

  // Drives the REAL predicate rather than restating it here. The first version
  // of this test copied the rule, so fixing the rule in main.ts left the copy
  // wrong and the test kept failing against correct code.
  const worse = (block, erase, id) => C.zonesBrokenBy(block, erase, id).map((a) => a.zone.name);
  const after = (block, erase, id) => [block, erase, id];

  // THE REPORTED BUG: a second, unattached Bravo.
  check('an unattached Grid would break Bravo', worse(...after([cell(1, 0)], false, 'b')), ['Bravo']);
  check('but growing where it touches is fine', worse(...after([cell(2, 5)], false, 'b')), []);
  check('and a CORNER counts as touching', worse(...after([cell(2, 4)], false, 'b')), []);
  check('overlapping what is already there is fine', worse(...after([cell(1, 5), cell(2, 5)], false, 'b')), []);

  // THE BUG OTTO HIT: an already-split zone must stay editable, or the only way
  // to fix one is to delete it.
  check('an already-split zone can still be grown', worse(...after([cell(3, 0)], false, 's')), []);
  // Painting the gap takes it from two pieces to one: the repair the old rule
  // made impossible, because it judged the result on its own and refused
  // everything the moment a zone was already broken.
  check('and mended by bridging its halves', worse(...after([cell(1, 0)], false, 's')), []);
  check('a THIRD island on it is still refused', worse(...after([cell(15, 12)], false, 's')), ['Split']);
  // And a gesture must never be judged on a zone it did not touch.
  check('painting Bravo says nothing about Split', worse(...after([cell(2, 5)], false, 'b')).includes('Split'), false);

  check('erasing the middle of Echo would split it', worse(...after([cell(6, 0)], true, 'e')), ['Echo']);
  check('erasing from an edge is fine', worse(...after([cell(7, 0)], true, 'e')), []);
  check('and clearing a zone outright is always allowed',
    worse(...after([cell(5, 0), cell(6, 0), cell(7, 0)], true, 'e')), []);

  // Painting over ANOTHER zone takes the Grid from them, which cuts their area
  // just as surely - the same invariant, reached from the other side.
  check('painting through the middle of Echo would cut Echo',
    worse(...after([cell(6, 0)], false, 'b')).includes('Echo'), true);

  C.editor.zones = [{ id: 'n', name: 'New', cells: [] }];
  check('a zone with nothing on the table is free to place', worse(...after([cell(9, 9)], false, 'n')), []);
}

// The refusal has to be SEEN: the editor bar is a tall column and the note used
// to sit under Deployment, off the bottom of a laptop screen.
ok('the editor warning is at the top of the bar',
  main.indexOf('class="ed-warn"') < main.indexOf('class="ed-glabel">Terrain'));

console.log(`\nmapeditor: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
