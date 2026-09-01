// Environment Cards (rulebook 5.4.1).
//
// A Card the size of one Large Grid, laid on the board to give that Grid an
// effect. We had NOTHING on these until now, in data or in code, so this file
// is mostly about the data being complete and honest rather than about
// behaviour: the board does not read any of it yet.
//
// The text was transcribed off the publisher's own English card scans, so the
// thing most worth guarding is that it stays verbatim. A rule someone tidied
// into better English is a rule that no longer matches the card in the player's
// hand.
//
// The cards now go on the board as well, so the back half of this file covers
// the reload path and the two pages that draw them. What is NOT covered, and is
// not built: the effects themselves. Placing an Abyss card does not yet stop a
// Ground Unit walking into that Grid. The card is laid on the table and the
// players read it, the way the app treats every rule it has not modelled.
import { readFileSync, existsSync, writeFileSync } from 'node:fs';

const root = new URL('../../', import.meta.url);
const env = JSON.parse(readFileSync(new URL('data/environments.json', root), 'utf8'));
const src = (f) => readFileSync(new URL(`app/src/${f}`, root), 'utf8');

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}, got ${g}`); }
};
const ok = (name, cond) => check(name, !!cond, true);

console.log('\nthe five cards');

check('all five are here', env.cards.map((c) => c.id),
  ['abyss', 'anti-gravity', 'fragile-platform', 'high-temperature', 'rugged']);
check('and they carry the rulebook section', env.rule, '5.4.1');

// VERBATIM off the English scans. If one of these ever fails, check the card
// before changing the test: the card is the authority, not this file.
const TEXT = {
  abyss: 'Ground Units cannot voluntarily enter this Grid. If a Ground Unit enters this Grid due to Forced Movement, the Unit is immediately Destroyed.',
  'anti-gravity': 'When a Ground Unit performs Movement originating in this Grid, the Movement Type is Flying.',
  'fragile-platform': 'When a Ground Unit enters this Grid, its Movement ends immediately and this Card is removed.',
  'high-temperature': 'When a Unit enters this Grid, it gains 1 Fragile Token.',
  rugged: 'Ground Units require 1 additional Movement Range to exit this Grid.',
};
for (const c of env.cards) {
  check(`${c.id} reads exactly as printed`, c.text, TEXT[c.id]);
}

// The printed title is "Anti-gravity", lower-case g. The scan's FILENAME says
// Anti-Gravity, which is the easy thing to copy by mistake.
check('the printed capitalisation is kept',
  env.cards.find((c) => c.id === 'anti-gravity').name, 'Anti-gravity');

console.log('\nwho each one catches');

// Four of the five are written to catch GROUND Units only, which is most of
// what makes them interesting. High Temperature is the exception and says
// "a Unit", so it reaches flyers too.
for (const c of env.cards) {
  const saysGround = /Ground Unit/.test(c.text);
  check(`${c.id} declares the same reach its text does`,
    c.affects, saysGround ? 'ground' : 'all');
}
check('and exactly one reaches every Unit',
  env.cards.filter((c) => c.affects === 'all').map((c) => c.id), ['high-temperature']);

// Fragile Platform is the only one that removes itself.
check('only Fragile Platform is one-shot',
  env.cards.filter((c) => c.oneShot).map((c) => c.id), ['fragile-platform']);
ok('and its text is what says so',
  /this Card is removed/.test(env.cards.find((c) => c.id === 'fragile-platform').text));

console.log('\nthe art');

for (const c of env.cards) {
  ok(`${c.id} has its card art`,
    existsSync(new URL(`assets/environments/${c.id}.webp`, root)));
}
// The id IS the filename, so a rename that misses one leaves a card with a
// broken image and nothing else complaining.
ok('the helper builds the path from the id',
  /environments\/\$\{id\}\.webp/.test(src('data.ts')));

const ref0 = src('reference.ts');

console.log('\nthe four battlefields');

const terrain = JSON.parse(readFileSync(new URL('data/terrain_layouts.json', root), 'utf8'));

check('all four maps are here', terrain.maps.map((m) => m.id),
  ['alley', 'crossroads', 'hotspot', 'steelworks']);

// STEELWORKS was missing entirely until now: three maps where the publisher
// prints four. Its terrain was read off the publisher's own board rendering,
// and the check that the read is right is that it matches the printed legend
// exactly -- 6 of each, with the containers split 6 large and 6 small.
{
  const sw = terrain.layouts.steelworks;
  const by = {};
  for (const p of sw) by[p.type] = (by[p.type] ?? 0) + 1;
  check('Steelworks has the terrain its card lists',
    by, { low_wall: 6, high_wall: 6, container: 12, building: 6 });
  const sizes = {};
  for (const p of sw) {
    if (p.type === 'container') sizes[p.subCells.length] = (sizes[p.subCells.length] ?? 0) + 1;
  }
  check('and its containers are 6 large and 6 small', sizes, { 1: 6, 2: 6 });

  // Every piece must be a footprint the game actually has, on the board, and
  // not on top of another. A misread would show up here rather than as a board
  // that merely looks a bit odd.
  const LEGAL = { building: [9], high_wall: [3], low_wall: [3], container: [1, 2] };
  check('every piece is a legal footprint',
    sw.filter((p) => !LEGAL[p.type].includes(p.subCells.length)).map((p) => p.id), []);
  const seen = new Set();
  const clash = [];
  for (const p of sw) {
    for (const c of p.subCells) {
      const k = `${c.col},${c.row}`;
      if (c.col < 0 || c.col > 35 || c.row < 0 || c.row > 35) clash.push(`${p.id} off board`);
      if (seen.has(k)) clash.push(`${p.id} overlaps at ${k}`);
      seen.add(k);
    }
  }
  check('nothing overlaps or falls off the board', clash, []);
  check('which is 108 cells of terrain', seen.size, 108);
}

// The allowance is printed on the Battlefield Card and nowhere else, which is
// why OTTO could not find it on the Task cards.
check('every map carries its Environment Card allowance',
  terrain.maps.filter((m) => m.envCards !== 4).map((m) => m.id), []);
// The names ARE the printed ones now. We used to say The Alley, Crossroads and
// Hotspot against the cards' Alley, Intersection and Hot Zone, and the
// reference had to carry a "printed on the card as..." line to explain itself.
check('the maps are named as the cards name them',
  terrain.maps.map((m) => m.name.en),
  ['Alley', 'Intersection', 'Hot Zone', 'Steelworks']);
// The IDS keep the old names, because saved boards and scenarios carry them --
// and because the reference searches the id, which is what keeps someone who
// knows the map as "Hotspot" able to find it.
check('while the ids stay what saved boards refer to',
  terrain.maps.map((m) => m.id), ['alley', 'crossroads', 'hotspot', 'steelworks']);
ok('so the old names are still searchable through the id',
  /\$\{m\.id\}/.test(ref0));
check('and the alias field is gone from the map type',
  /cardName/.test(src('types.ts')), false);
check('and from the data',
  terrain.maps.filter((m) => 'cardName' in m).map((m) => m.id), []);

for (const m of terrain.maps) {
  ok(`${m.id} has its battlefield card art`,
    existsSync(new URL(`assets/battlefield/${m.id}.webp`, root)));
}

console.log('\nwired into the reference');

const ref = src('reference.ts');
ok('there is a Battlefield tab', /'battlefield'/.test(ref));
ok('it shows the maps as well as the environments', /function battlefieldCard/.test(ref));
ok('and both are searchable there', /function matchMap/.test(ref));
// Freeplay and the Match Centre both build their map pickers from this one
// array, so adding a map to it reaches both without touching either page.
ok('the Match Centre picks its maps from the same list',
  /data\?\.terrain\.maps \?\? \[\]/.test(src('match.ts')));
ok('it renders the cards', /function environmentCard/.test(ref));
ok('search reaches them', /function matchEnvironment/.test(ref));
// The tab strip counts matches per tab. Counting them without listing them
// showed a number with nothing behind it.
ok('and a match appears in the all-tabs results, not just the count',
  /t: 'battlefield',/.test(ref));
// The placement rules are the half that is NOT printed on the cards.
ok('the tab explains how many may be placed', /alternately/.test(ref) && /Battlefield Card/.test(ref));

console.log('\nreading a card at full size');

// The reference column is narrow: a battlefield card's terrain legend and an
// environment card's rule are both unreadable in place. Both now get the
// Task cards' existing tap-to-enlarge rather than a second mechanism.
ok('the lightbox takes any card, not just a mission',
  /function showCardImage\(src: string, label: string\)/.test(ref));
ok('and the mission view is now one of its callers',
  /showCardImage\(kind === 'secondary' \? secondaryImageUrl/.test(ref));
ok('battlefield cards enlarge', /data-battlefield="/.test(ref) && /\[data-battlefield\]/.test(ref));
ok('environment cards enlarge', /data-envcard="/.test(ref) && /\[data-envcard\]/.test(ref));
check('four card kinds now use the one thumb',
  (ref.match(/class="mis-thumb"/g) ?? []).length, 4);

// A phone showed ten tabs in a 347px strip holding 731px of them, so six sat
// off the right edge with nothing to say they were there.
const refcss = src('reference.css');
ok('the phone strip is an even grid, not a scroller or a ragged wrap',
  /#ref-tabs \{[^}]*grid-template-columns: repeat\(5, 1fr\)/.test(refcss));
ok('and nothing is left scrolling horizontally there',
  !/#ref-tabs \{[^}]*overflow-x/.test(refcss));
// One row on a desktop: five columns there would stack ten tabs that fit on a
// single line in the 1136px column.
ok('while the desktop keeps them on one row',
  /#ref-tabs \{ display: flex; flex-wrap: wrap; \}/.test(refcss));
// The search count sits in the corner rather than in the line. Inline it took
// 10px of a 61px column, which is what pushed the longest label over the edge.
ok('the search count is a corner badge on a phone',
  /#ref-tabs button \.tab-n \{[^}]*position: absolute/.test(refcss));

// High Temperature hands out a Fragile Token, which the app already models.
ok('the Fragile Token it grants is a real status',
  /id: 'fragile'/.test(src('types.ts')));

console.log('\nsurviving a reload');

// migrateState rebuilds GameState field by field, so a field it does not name
// is dropped on EVERY load: the placements would sit on the board until the
// page was refreshed and no longer. Run the real reader rather than grep for
// it, because a line that is present but filters everything out reads the same.
const unitsSrc = src('units.ts');
const normFrom = unitsSrc.indexOf('function normaliseEnvironments(');
const normTo = unitsSrc.indexOf('export function migrateState(');
if (normFrom < 0 || normTo <= normFrom) throw new Error('could not locate normaliseEnvironments in units.ts');
const slice = new URL('./_environments.slice.ts', import.meta.url);
writeFileSync(slice, 'type GameState = any;\ntype GameData = any;\nexport '
  + unitsSrc.slice(normFrom, normTo));
const { normaliseEnvironments: norm } = await import(slice.href);

ok('migrateState names the field at all', /^\s+environments: normaliseEnvironments\(/m.test(unitsSrc));
check('placements come back off a save',
  norm([{ card: 'abyss', col: 1, row: 2 }]), [{ card: 'abyss', col: 1, row: 2 }]);
check('a save from before the feature is untouched', norm(undefined), undefined);
// Absence is the default, so a board with no cards on it has to serialise the
// way every board did before Environment Cards existed.
check('an empty table stays absent rather than empty', norm([]), undefined);
check('and an all-junk list collapses to absent', norm([{ card: 5, col: 1, row: 1 }]), undefined);
check('a junk entry is dropped without taking the good ones with it',
  norm([{ card: 'abyss', col: 1, row: 1 }, { col: 2, row: 2 }, { card: 'rugged', col: 3, row: 3 }]),
  [{ card: 'abyss', col: 1, row: 1 }, { card: 'rugged', col: 3, row: 3 }]);
check('a negative Grid is not a Grid', norm([{ card: 'abyss', col: -1, row: 1 }]), undefined);
check('nor is half a Grid', norm([{ card: 'abyss', col: 1.5, row: 1 }]), undefined);
check('a stray extra field does not ride along',
  norm([{ card: 'abyss', col: 1, row: 1, side: 's1' }]), [{ card: 'abyss', col: 1, row: 1 }]);
check('a list that is not a list is refused', norm('abyss'), undefined);

console.log('\ndrawn on the board');

const board = src('board.ts');
ok('the board has a layer of its own for them', /this\.gEnv = el\('g', \{ class: 'env-layer'/.test(board));
// Above the ZONES and below terrain: a card is laid on the mat, and the
// terrain, markers and units all stand on top of it.
ok('and it sits directly on the mat',
  board.indexOf("class: 'zones'") < board.indexOf("class: 'env-layer'"));
ok('a card covers a whole Large Grid, not a cell', /e\.col \* 3 \* CELL/.test(board));
// The board holds no card data, so the hover box would otherwise read an id.
ok('the hover box reads the rule off the card', /def\?\.text \?\?/.test(board));
ok('a redraw replaces the layer rather than appending to it',
  /this\.gEnv\.replaceChildren\(\)/.test(board));

// BOTH pages. The Match Centre is the half that is easy to leave behind, since
// nothing there fails loudly when a layer is simply never drawn.
for (const [page, file] of [['freeplay', 'main.ts'], ['the Match Centre', 'matchhud.ts']]) {
  ok(`${page} draws them`, /board\.renderEnvironments\(/.test(src(file)));
  ok(`and ${page} hands over the card text, not just the ids`,
    /renderEnvironments\([^)]*environmentLookup\(/.test(src(file)));
}

// Freeplay is the only one that PLACES them. The Match Centre is a live game,
// where the cards went down while the battlefield was being set up.
const mainSrc = src('main.ts');
ok('freeplay has a placement dialog', /function openEnvironments\(/.test(mainSrc));
ok('an armed card lands on the Grid the clicked cell belongs to',
  /Math\.floor\(col \/ 3\), row: Math\.floor\(row \/ 3\)/.test(mainSrc));
// onCellClick only fires while panning is OFF, which is how the map editor gets
// its clicks. Arming a card without this is a dialog whose clicks go nowhere.
ok('arming a card turns panning off so the clicks arrive',
  /board\.panEnabled = envArmed === null/.test(mainSrc));
// The dialog also has to let the board through while a card is armed, or "pick
// a card, then click a Grid" is impossible: the backdrop covers the board.
ok('and the dialog steps out of the way while one is armed',
  /#env-dialog\.arming/.test(src('styles.css')));
ok('the armed card does not outlive the dialog that armed it',
  /envArmed = null;/.test(mainSrc));
// Freeplay is not strict, so perform() APPLIES a refused placement and only
// reports why. Saving on the ok path alone left the board and the state
// disagreeing about what was on the table.
const cellClick = mainSrc.slice(mainSrc.indexOf('if (envArmed !== null) {'), mainSrc.indexOf('if (!editor.active) return;'));
ok('a refused placement still redraws and saves', /setHint\(v\.ok \? '' :/.test(cellClick)
  && cellClick.indexOf('save();') > cellClick.indexOf('setHint(v.ok'));

console.log('\nplacing them in a match');

// The Match Centre lays them out too, because a real game never passes through
// freeplay. setEnvironment is already a TABLE command, so a placement mirrors
// to the other seat with no new plumbing: this is a control and a board click,
// not a new setup stage.
const hud = src('matchhud.ts');
ok('the Match Centre can place them, not only draw them',
  /kind: 'setEnvironment'/.test(hud));
ok('and it arms a card the same way freeplay does',
  /if \(envArm !== null\) \{/.test(hud));
ok('the armed card turns panning off there too',
  /board\.panEnabled = placing === null && envArm === null/.test(hud));
ok('the control sits on the board beside the Zones toggle',
  /id="btn-envs"/.test(hud));
ok('and the picker lists what is already down',
  /data-envlift=/.test(hud) && /data-envpick=/.test(hud));

// The battlefield is settled before Round 1 and stays settled, so the control
// goes away with the setup. Run the REAL predicate against the REAL stage
// reader rather than grep for the comparison: `!== 'done'` reads correct
// whichever way round it is written.
const setupSrc = src('setup.ts');
// From newSetup, not from normaliseSetup: normaliseSetup CALLS it for its
// defaults, and a cut that starts at the reader leaves that call undefined.
const nsFrom = setupSrc.indexOf('export function newSetup(');
const nsAt = setupSrc.indexOf('export function normaliseSetup(');
if (nsFrom < 0 || nsAt <= nsFrom) throw new Error('could not locate the setup readers in setup.ts');
const nsTo = setupSrc.indexOf('export function', nsAt + 10);
const esFrom = hud.indexOf('function envStage(');
const esTo = hud.indexOf('function renderEnvPicker(');
if (esFrom < 0 || esTo <= esFrom) throw new Error('could not locate envStage in matchhud.ts');
const stageSlice = new URL('./_envstage.slice.ts', import.meta.url);
writeFileSync(stageSlice,
  'type Side = any;\ntype SetupStage = any;\ntype SetupState = any;\ntype HudCtx = any;\n'
  + setupSrc.slice(nsFrom, nsTo > nsAt ? nsTo : undefined)
  + '\nexport ' + hud.slice(esFrom, esTo));
const { envStage } = await import(stageSlice.href);

const at = (stage) => envStage({ state: { setup: { stage, rolls: { s1: [], s2: [] }, edge: { s1: 'black', s2: 'white' }, placed: { s1: 0, s2: 0 } } } });
check('the control is up while the map is being settled', at('map'), true);
check('and through the First Player roll', at('roll'), true);
check('and the Tasks', at('tasks'), true);
check('and the edge pick', at('side'), true);
check('and deployment', at('deploy'), true);
check('but it is gone once Round 1 starts', at('done'), false);
check('and there is none of it before a match exists', envStage({ state: {} }), false);

// A game that started with a card armed would leave a click primed on a board
// that is no longer being laid out, so the disarm rides the render, not the
// picker's close button.
const rbFrom = hud.indexOf('function renderBoard(');
const rbTo = hud.indexOf('\nfunction ', rbFrom + 10);
if (rbFrom < 0 || rbTo <= rbFrom) throw new Error('could not locate renderBoard in matchhud.ts');
const rb = hud.slice(rbFrom, rbTo);
ok('and the render disarms rather than only hiding the control',
  /if \(!setting\) \{ envArm = null; envPickerOpen = false; \}/.test(rb));

console.log('\nthe effects, driven');

// The five cards' rules, run through the REAL movement search and the REAL
// settle sweep - sliced, not mirrored, so a passing line here is the line the
// boards execute. The cuts follow commands.test.mjs and crush.test.mjs.
const rulesSrc = src('rules.ts');
const typesSrc = src('types.ts');
const dataSrc2 = src('data.ts');
const cut = (s, a, b, what) => {
  const i = s.indexOf(a);
  const j = s.indexOf(b, i);
  if (i < 0 || j <= i) throw new Error(`could not locate ${what}`);
  return s.slice(i, j);
};
const fxTmp = new URL('./_enveffects.slice.ts', import.meta.url);
writeFileSync(fxTmp, 'type Token = any;\ntype GameData = any;\ntype GameState = any;\ntype SmokeScreen = any;\ntype Side = any;\ntype TerrainPiece = any;\ntype Card = any;\ntype LargeGrid = { c: number; r: number };\ntype StatusDef = any;\ntype TokenShape = any;\n'
  + cut(typesSrc, 'export function hexagonIds', 'export interface RoundState', 'the status machinery')
  + cut(dataSrc2, 'export function isFlyingBase', '\nexport', 'isFlyingBase')
  + cut(rulesSrc, 'let GRIDS', 'export function smokeKey', 'the board size')
  + cut(rulesSrc, 'export function largeGridOf', 'export interface CrushVictims', 'the movement search')
  + cut(rulesSrc, 'export function reachableGrids', 'export function losBetween', 'the path readers')
  + 'export ' + cut(unitsSrc, 'function alive(t: Token)', '// ---------- ENVIRONMENT CARDS', 'alive')
  + cut(unitsSrc, '// ---------- ENVIRONMENT CARDS', "// A Mine's trigger asks for a GROUND Unit", 'the env readers')
  + cut(unitsSrc, 'export function isGroundUnit', 'export function minesOwed', 'isGroundUnit'));
const FX = await import(fxTmp.href);

// A 12-Grid board with nothing on it, so every refusal below is the card's.
const fxData = { byId: new Map([['T1', {}], ['RAVEN', { flyingOrElevated: 'flying' }]]) };
const mech = (c, r, over = {}) => ({ uid: 1, col: c * 3, row: r * 3, size: 3, aerial: false, cardId: 'T1', label: 'M1', ...over });
const world = (envs) => ({ tokens: [], environments: envs });
const has = (list, c, r) => list.some((g) => g.c === c && g.r === r);
const reach = (t, steps, flying, st) => {
  const env = FX.envMoveRules(fxData, st, t, flying);
  return FX.reachableGrids(t, steps, [], [t], flying, env);
};

// ---- Abyss, walking: impassable, and the search routes around it ----
const abyss = world([{ card: 'abyss', col: 2, row: 2 }]);
const walker = mech(1, 2);
check('a walk cannot enter an Abyss Grid', has(reach(walker, 4, false, abyss), 2, 2), false);
check('but the search routes AROUND it', has(reach(walker, 4, false, abyss), 3, 2), true);
check('and two steps cannot reach past it', has(reach(walker, 2, false, abyss), 3, 2), false);

// ---- Abyss, flying: the air above it is open, the landing is not ----
check('a flight passes OVER the Abyss', has(reach(walker, 2, true, abyss), 3, 2), true);
check('but may not land in it', has(reach(walker, 4, true, abyss), 2, 2), false);
check('and no path may end there',
  FX.movePath(walker, { c: 2, r: 2 }, 4, [], [walker], true, FX.envMoveRules(fxData, abyss, walker, true)).length, 0);

// ---- and neither rule touches a unit that is not Ground ----
const raven = mech(1, 2, { cardId: 'RAVEN' });
check('a flying base ignores the Abyss entirely', FX.envMoveRules(fxData, abyss, raven, false), {});
check('and so does an Aerial unit', FX.envMoveRules(fxData, abyss, mech(1, 2, { aerial: true }), false), {});

// ---- Rugged: one more Movement Range to exit, and only to exit ----
const rugged = world([{ card: 'rugged', col: 1, row: 2 }]);
const stuck = mech(1, 2);
check('leaving a Rugged Grid costs one extra', has(reach(stuck, 2, false, rugged), 2, 2), true);
check('so two steps of Range walk one Grid', has(reach(stuck, 2, false, rugged), 3, 2), false);
check('while ENTERING one costs the ordinary step', has(reach(mech(0, 2), 1, false, rugged), 1, 2), true);
check('and the exit toll is charged when the route walks on', has(reach(mech(0, 2), 2, false, rugged), 2, 2), false);
check('and a flight is not charged', FX.envMoveRules(fxData, rugged, stuck, true), {});

// ---- Fragile Platform: enterable, terminal ----
const fragile = world([{ card: 'fragile-platform', col: 2, row: 2 }]);
check('the Grid itself is reachable', has(reach(walker, 2, false, fragile), 2, 2), true);
check('but nothing is reachable THROUGH it', has(reach(walker, 2, false, fragile), 3, 2), false);
check('going around still works with the Range for it', has(reach(walker, 4, false, fragile), 3, 2), true);
check('and a route that has entered it cannot chain on',
  FX.extendPath([{ c: 1, r: 2 }, { c: 2, r: 2 }], { c: 3, r: 2 }, walker, 6, [], [walker], false,
    FX.envMoveRules(fxData, fragile, walker, false)), null);

// ---- Anti-Gravity: the movement mode at the start grid ----
const anti = world([{ card: 'anti-gravity', col: 1, row: 2 }]);
check('a Ground Unit standing there flies its move', FX.envFlightFrom(fxData, anti, mech(1, 2)), true);
check('one standing elsewhere does not', FX.envFlightFrom(fxData, anti, mech(2, 2)), false);
check('and a flying base was never Ground to begin with', FX.envFlightFrom(fxData, anti, mech(1, 2, { cardId: 'RAVEN' })), false);

// ---- the Forced Movement line ----
const both = world([{ card: 'abyss', col: 3, row: 2 }]);
const victim = mech(1, 2, { uid: 7 });
check('a knockback line stops IN the Abyss it enters',
  FX.knockbackPath(victim, { dc: 1, dr: 0 }, 3, [], [victim], FX.envForcedStop(fxData, both, victim)).map((g) => `${g.c},${g.r}`),
  ['2,2', '3,2']);
check('an Aerial victim is pushed straight past it',
  FX.envForcedStop(fxData, both, mech(1, 2, { aerial: true })), undefined);

// ---- the settle sweep ----
const hotWorld = () => ({
  // Standing at Grid (6,6) - cells are Grids times three, which is exactly the
  // arithmetic slip the first draft of this fixture made.
  tokens: [{ uid: 1, col: 18, row: 18, size: 3, aerial: false, cardId: 'T1', label: 'M1', partStates: { torso: 'intact' } }],
  environments: [{ card: 'high-temperature', col: 2, row: 2 }, { card: 'fragile-platform', col: 4, row: 4 }],
});
const frg = (t) => (t.statuses ?? []).filter((s) => s === 'fragile').length;
{
  const s = hotWorld();
  FX.settleEnvironments(fxData, s);
  check('a unit standing clear of everything is untouched', frg(s.tokens[0]), 0);
  // Walk it into the hot Grid: entry.
  s.tokens[0].col = 2 * 3; s.tokens[0].row = 2 * 3;
  const ev1 = FX.settleEnvironments(fxData, s);
  check('entering a High Temperature Grid costs 1 Fragile Token', frg(s.tokens[0]), 1);
  check('and the sweep says so', ev1, [{ what: 'hot', uid: 1, c: 2, r: 2 }]);
  FX.settleEnvironments(fxData, s);
  FX.settleEnvironments(fxData, s);
  check('standing in it costs nothing more', frg(s.tokens[0]), 1);
  // Step out, step back in: a second entry.
  s.tokens[0].col = 18; s.tokens[0].row = 18;
  FX.settleEnvironments(fxData, s);
  check('leaving clears the marker', s.tokens[0].envSeen ?? null, null);
  s.tokens[0].col = 2 * 3; s.tokens[0].row = 2 * 3;
  FX.settleEnvironments(fxData, s);
  check('re-entering cooks again, and the tokens stack', frg(s.tokens[0]), 2);
  // Onto the platform: the card comes off.
  s.tokens[0].col = 4 * 3; s.tokens[0].row = 4 * 3;
  const ev2 = FX.settleEnvironments(fxData, s);
  check('a Ground Unit on the Fragile Platform removes the Card', (s.environments ?? []).map((e) => e.card), ['high-temperature']);
  check('and that is said too', ev2, [{ what: 'collapse', uid: 1, c: 4, r: 4 }]);
}
{
  // An Aerial unit is not Ground, but High Temperature says Unit.
  const s = { tokens: [{ uid: 2, col: 2 * 3 + 1, row: 2 * 3 + 1, size: 1, aerial: true, cardId: 'T1', label: 'D1', partStates: {} }],
    environments: [{ card: 'high-temperature', col: 2, row: 2 }, { card: 'fragile-platform', col: 2, row: 2 }] };
  // (two cards never share a Grid in play; the fixture only proves the filters)
  s.environments = [{ card: 'high-temperature', col: 2, row: 2 }];
  FX.settleEnvironments(fxData, s);
  check('an Aerial unit is cooked like anything else', frg(s.tokens[0]), 1);
  // And an Aerial unit on a platform does not collapse it.
  s.environments = [{ card: 'fragile-platform', col: 2, row: 2 }];
  delete s.tokens[0].envSeen;
  FX.settleEnvironments(fxData, s);
  check('but only a Ground Unit collapses a platform', (s.environments ?? []).length, 1);
}
{
  // The last card off the table leaves the field absent, not empty.
  const s = { tokens: [{ uid: 1, col: 4 * 3, row: 4 * 3, size: 3, aerial: false, cardId: 'T1', label: 'M1', partStates: {} }],
    environments: [{ card: 'fragile-platform', col: 4, row: 4 }] };
  FX.settleEnvironments(fxData, s);
  check('the last collapse drops the field entirely', 'environments' in s, false);
}

console.log('\nwired into both boards');

// The Non-humanoid lesson, applied: movement does not share a road between the
// boards, so every rule above has to be COUNTED at its sites or it is true on
// one page and absent on the other.
const mainSrc2 = src('main.ts');
check('freeplay flies the Anti-Gravity start in all three derivations',
  (mainSrc2.match(/envFlightFrom\(data, state, t\)/g) ?? []).length, 3);
check('the Match Centre in both of its own',
  (src('matchhud.ts').match(/envFlightFrom\(ctx\.data, ctx\.state, t\)/g) ?? []).length, 2);
check('both knockback resolvers stop the line on the cards', [
  /knockbackPath\(victim, dir, kb\.grids, currentTerrain\(\), state\.tokens, envForcedStop\(data, state, victim\)\)/.test(mainSrc2),
  /knockbackPath\(victim, dir, kb\.grids, terrainOf\(ctx\), ctx\.state\.tokens, envForcedStop\(ctx\.data, ctx\.state, victim\)\)/.test(src('matchhud.ts')),
], [true, true]);
check('both resolve the Abyss death with the kill credited', [
  (mainSrc2.match(/envCardAt\(state, end\.c, end\.r\) === 'abyss'/g) ?? []).length,
  (src('matchhud.ts').match(/envCardAt\(ctx\.state, out\.end\.c, out\.end\.r\) === 'abyss'/g) ?? []).length,
], [1, 1]);
check('both crush displacements filter the Abyss out', [
  /isGroundUnit\(data, v\) && envCardAt\(state, g\.c, g\.r\) === 'abyss'/.test(mainSrc2),
  /isGroundUnit\(ctx\.data, v\) && envCardAt\(ctx\.state, g\.c, g\.r\) === 'abyss'/.test(src('matchhud.ts')),
], [true, true]);
check('both forced-movement senders carry the line for the heat', [
  (mainSrc2.match(/via: path\.map\(\(g\) => \(\{ col: g\.c \* 3 \+ 1, row: g\.r \* 3 \+ 1 \}\)\)/g) ?? []).length,
  (src('matchhud.ts').match(/via: out\.path\.map\(\(g\) => \(\{ col: g\.c \* 3 \+ 1, row: g\.r \* 3 \+ 1 \}\)\)/g) ?? []).length,
], [1, 1]);
// Freeplay's endpoint roads: renderAll settles BEFORE it saves, so the grants
// are in the state that save writes - and the DRAG handler settles too,
// because its happy path saves and redraws without ever reaching renderAll.
// That second call is where a dragged unit entered a hot Grid, was saved, and
// was never cooked until this pin's session found it live.
check('freeplay settles on both of its non-command roads',
  (mainSrc2.match(/settleEnvNow\(\);/g) ?? []).length, 2);
{
  const ra = mainSrc2.slice(mainSrc2.indexOf('settleEnvNow();'));
  check('and renderAll settles before it saves',
    ra.indexOf('save();') > -1 && ra.indexOf('save();') < 600, true);
}
check('freeplay grants pass-through heat through the command layer, not a page write',
  /kind: 'applyStatus', seat: t\.side, uid: t\.uid, targetUid: t\.uid, statusId: 'fragile'/.test(mainSrc2), true);
check('the maneuver carries its movement mode for the same reason',
  /flying: m\.flying \|\| undefined/.test(src('matchhud.ts')), true);
check('and the abyss catch-all sweep is registered',
  /sweepAbyss\(\);/.test(mainSrc2), true);

console.log(`\n  ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
