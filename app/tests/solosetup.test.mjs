// The games against the computer, as data (AI-OPPONENT-PLAN.md, M0).
//
// OTTO, 2026-10-01: "We can start with a direct unit copy from their version so
// I can compare ours to their". data/solo.json holds that copy: the Raid combat
// pack's two squads and two map and Main Task pairs, five rounds, no Secondary
// Tasks, no Tactics Cards. A squad there is an importSquad payload, so this
// drives the real engine with it: every card exists and sits in its slot, both
// squads import, they total what the file promises, and each scenario starts.
import { readFileSync } from 'node:fs';
import { loadEngine, freshState, runner } from './_engine.mjs';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}, got ${g}`); }
};

console.log('Games against the computer: the setup\n');

const { M, data } = await loadEngine('solosetup');
const file = JSON.parse(readFileSync(new URL('../../data/solo.json', import.meta.url), 'utf8'));
const solo = data.solo;

// ---------- the file arrives whole ----------
check('the loader carries every squad and scenario in the file',
  [Object.keys(solo.squads), solo.scenarios.map((x) => x.id)],
  [Object.keys(file.squads), file.scenarios.map((x) => x.id)]);
check('the copy is two squads and two scenarios',
  [Object.keys(solo.squads), solo.scenarios.map((x) => `${x.map}+${x.mission}`)],
  [['raid-rdl', 'raid-un'], ['alley+control-frontal-breakthrough', 'crossroads+vip-commander-assassination']]);
check('five rounds, no Secondary Tasks, no Tactics Cards, RDL in the first seat on the Black edge',
  solo.scenarios.map((x) => [x.rounds, x.secondaries, x.tactics, x.seats.s1, x.seats.s2, x.edges?.s1, x.edges?.s2]),
  [[5, false, false, 'raid-rdl', 'raid-un', 'black', 'white'], [5, false, false, 'raid-rdl', 'raid-un', 'black', 'white']]);

// ---------- the same table as the copied mode, Grid for Grid ----------
//
// Read from its code on 2026-10-01 (0-based column, row): its first squad
// deploys in columns 0-4 of rows 0-2 on a control mission and in rows 0-1 on
// the VIP mission, its second in columns 7-11 of rows 9-11 or in rows 10-11;
// its zones are the nine below. Ours come from zones.json and must agree, or
// the two computer opponents are not playing the same game.
const cells = (cols, rows) => rows.flatMap((r) => cols.map((c) => `${c},${r}`)).sort();
const span = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
const THEIR_DEPLOY = {
  'control-frontal-breakthrough': { black: cells(span(0, 4), span(0, 2)), white: cells(span(7, 11), span(9, 11)) },
  'vip-commander-assassination': { black: cells(span(0, 11), [0, 1]), white: cells(span(0, 11), [10, 11]) },
};
check('each side deploys from the same Grids as in the copied mode',
  solo.scenarios.map((x) => ['black', 'white'].map((edge) =>
    JSON.stringify([...M.TK.deployGrids(data.zoneData, { mission: x.mission, zoneSet: '' }, edge)].sort()) === JSON.stringify(THEIR_DEPLOY[x.mission][edge]))),
  [[true, true], [true, true]]);
const THEIR_ZONES = {
  Alpha: ['1,1', '2,2'], Bravo: ['1,5', '2,5', '1,6', '2,6'], Charlie: ['2,9', '1,10'], Delta: ['5,3', '6,3'],
  Echo: ['5,5', '6,5', '5,6', '6,6'], Foxtrot: ['5,8', '6,8'], Golf: ['10,1', '9,2'], Hotel: ['9,5', '10,5', '9,6', '10,6'], India: ['9,9', '10,10'],
};
const grid = (ref) => `${ref.toUpperCase().charCodeAt(0) - 65},${Number(ref.slice(1)) - 1}`;
check('the nine Tactical Zones cover the same Grids',
  Object.fromEntries(data.zoneData.zones.map((z) => [z.name, z.cells.map(grid).sort()])),
  Object.fromEntries(Object.entries(THEIR_ZONES).map(([k, v]) => [k, [...v].sort()])));
const frontal = data.missions.cards.find((c) => c.id === 'control-frontal-breakthrough');
check('and Forward Advance scores the same three for the same points from the same round',
  [frontal.zones, frontal.vp, frontal.fromRound], [['Bravo', 'Echo', 'Hotel'], 2, 2]);

// ---------- every name in it is real ----------
const maps = new Set((data.terrain.maps ?? []).map((m) => m.id));
const missions = new Set(data.missions.cards.map((c) => c.id));
check('every scenario plays a shipped map and a Main Task card',
  solo.scenarios.filter((x) => !maps.has(x.map) || !missions.has(x.mission)).map((x) => x.id), []);
const SLOT_TYPE = { torso: 'torso', chasis: 'chasis', leftHand: 'leftHand', rightHand: 'rightHand', backpack: 'backpack' };
const wrong = [];
for (const [key, sq] of Object.entries(solo.squads)) {
  for (const m of sq.mechs) {
    for (const [slot, id] of Object.entries(m.loadout)) {
      const c = data.byId.get(id);
      if (!c) { wrong.push(`${key} ${m.name}: no card ${id}`); continue; }
      if (slot === 'pilot') {
        if (c.category !== 'pilot' && c.type !== 'pilot') wrong.push(`${key} ${m.name}: ${id} is not a pilot`);
        if (sq.faction && c.faction !== sq.faction) wrong.push(`${key} ${m.name}: pilot ${id} is ${c.faction}`);
      } else if (c.type !== SLOT_TYPE[slot]) wrong.push(`${key} ${m.name}: ${id} is a ${c.type}, not a ${slot}`);
    }
    if (M.SU.incompleteMechWhy(m.loadout, m.name)) wrong.push(`${key} ${m.name}: ${M.SU.incompleteMechWhy(m.loadout, m.name)}`);
  }
  for (const d of sq.drones) {
    const c = data.byId.get(d.cardId);
    if (!c) { wrong.push(`${key}: no Drone ${d.cardId}`); continue; }
    if (d.backpack) {
      const b = data.byId.get(d.backpack);
      if (!b || b.type !== 'backpack') wrong.push(`${key}: Load ${d.backpack} is not a Backpack`);
      if (!M.U.isCarrier(c)) wrong.push(`${key}: ${d.cardId} carries a Load and is no Carrier`);
    }
  }
}
check('every card exists and sits in the slot it is named for', wrong, []);

// ---------- each scenario builds and starts on the real engine ----------
for (const sc of solo.scenarios) {
  const state = freshState(M, data);
  const run = runner(M, data, state);
  const said = [];
  const step = (label, cmd) => { const v = run(cmd); if (!v.ok) said.push(`${label}: ${v.why}`); };
  step('configure', { kind: 'configureTable', seat: 's1', map: sc.map, mission: sc.mission, roundLimit: sc.rounds });
  for (const seat of ['s1', 's2']) {
    const sq = solo.squads[sc.seats[seat]];
    step(`import ${seat}`, { kind: 'importSquad', seat, name: sq.name, mechs: sq.mechs, drones: sq.drones });
  }
  check(`${sc.id}: the table is set and both squads come on`, said, []);
  const units = (seat) => state.tokens.filter((t) => t.side === seat);
  check(`${sc.id}: two Mechs against one Mech and three Drones, the Tarantula carrying its Cooler`,
    [units('s1').map((t) => `${t.kind}:${t.label}`), units('s2').map((t) => t.kind),
      units('s2').find((t) => t.cardId === '162')?.droneBackpack],
    [['mech:Mire', 'mech:Dune'], ['mech', 'drone', 'drone', 'drone'], '083']);
  check(`${sc.id}: each squad totals what the file promises`,
    ['s1', 's2'].map((seat) => M.U.squadPoints(data, state.tokens, seat)),
    ['s1', 's2'].map((seat) => solo.squads[sc.seats[seat]].points));
  check(`${sc.id}: no Tactics Card is in either hand`, [state.tactics.s1, state.tactics.s2], [[], []]);
  const started = run({ kind: 'startMatch', seat: 's1' });
  check(`${sc.id}: the game starts, at the map stage, five rounds long`,
    [started.ok, M.SU.normaliseSetup(state.setup)?.stage, state.roundLimit, state.mission, state.map],
    [true, 'map', 5, sc.mission, sc.map]);
}
check('the two squads total 400 and 410, the figures the copied mode states',
  [solo.squads['raid-rdl'].points, solo.squads['raid-un'].points], [400, 410]);

// ---------- a game with no Secondary Tasks (M0.2) ----------
//
// The copied mode plays without them, and a strict table would not let the
// Tasks step close without both. configureTable's `noSecondary` says so for the
// table: a pick is refused, the step closes with none, and what the Main Task
// itself names is still owed.
const toTasks = (sc, noSecondary) => {
  const state = freshState(M, data);
  const run = runner(M, data, state);
  const log = [];
  const step = (label, cmd) => { const v = run(cmd); log.push(`${label}:${v.ok ? 'ok' : v.why}`); return v; };
  step('configure', { kind: 'configureTable', seat: 's1', map: sc.map, mission: sc.mission, roundLimit: sc.rounds, ...(noSecondary === undefined ? {} : { noSecondary }) });
  for (const seat of ['s1', 's2']) {
    const sq = solo.squads[sc.seats[seat]];
    step(`import ${seat}`, { kind: 'importSquad', seat, name: sq.name, mechs: sq.mechs, drones: sq.drones });
  }
  step('start', { kind: 'startMatch', seat: 's1' });
  step('lock', { kind: 'lockMap', seat: 's1' });
  step('first', { kind: 'acceptRoll', seat: 's1', first: 's1' });
  step('edge', { kind: 'pickEdge', seat: 's1', edge: 'black' });
  return { state, run, log, stage: () => M.SU.normaliseSetup(state.setup)?.stage };
};
const [control, vip] = solo.scenarios;
const secondaryCard = data.secondary[0].id;
{
  const t = toTasks(control, true);
  check('with no Secondary Tasks the setup still reaches the Tasks step on a strict table',
    [t.log.filter((l) => !l.endsWith(':ok')), t.stage(), !!t.state.script?.strict, t.state.noSecondary], [[], 'tasks', true, true]);
  check('a Secondary Task cannot be picked in that game',
    t.run({ kind: 'pickSecondary', seat: 's1', cardId: secondaryCard }), { ok: false, why: 'This game is played without Secondary Tasks.' });
  check('and the Tasks step closes without one', [t.run({ kind: 'finishTasks', seat: 's1' }).ok, t.stage()], [true, 'deploy']);
  // Across a table (a seat is held, as the page a game against the computer
  // runs on holds one) the engine itself keeps deployment back until the Tasks
  // are set, and it used to wait there for two Secondary Tasks whatever the
  // game: nothing could ever deploy.
  const mech = t.state.tokens.find((x) => x.side === 's1' && x.kind === 'mech');
  const place = { kind: 'deployUnit', seat: 's1', uid: mech.uid, to: { col: 0, row: 0 } };
  M.L.setLocalSeat('s1');
  const across = M.C.check(data, t.state, place);
  const withThem = M.C.check(data, { ...t.state, noSecondary: undefined }, place);
  M.L.setLocalSeat(null);
  check('across a table, a unit deploys in that game with no Secondary Task picked', across, { ok: true });
  check('where a game that plays them still waits for both', withThem, { ok: false, why: 'Both squads pick a Secondary Task before anything deploys (3.1.3).' });
}
{
  const t = toTasks(control, undefined);
  check('a game that plays them still refuses to close the step without both',
    [t.state.noSecondary, t.run({ kind: 'finishTasks', seat: 's1' })],
    [undefined, { ok: false, why: 'Both squads choose a Secondary Task first (3.1.3).' }]);
  check('and once one is chosen the game cannot be switched to none',
    [t.run({ kind: 'pickSecondary', seat: 's1', cardId: secondaryCard }).ok,
      t.run({ kind: 'configureTable', seat: 's1', noSecondary: true })],
    [true, { ok: false, why: 'A Secondary Task is already chosen, so this game is played with them.' }]);
}
{
  const t = toTasks(vip, true);
  const mechOf = (seat) => t.state.tokens.find((x) => x.side === seat && x.kind === 'mech').uid;
  check('what the Main Task names is still owed: a VIP game waits for both Commanders',
    t.run({ kind: 'finishTasks', seat: 's1' }), { ok: false, why: 'Every Task names its Mech or Zone first (5.2.3).' });
  const named = ['s1', 's2'].map((seat) => t.run({ kind: 'designateTask', seat, what: 'leader', uid: mechOf(seat) }).ok);
  check('and closes once each squad has named one',
    [named, t.run({ kind: 'finishTasks', seat: 's1' }).ok, t.stage(), Object.keys(M.TK.normaliseTasks(t.state.tasks).leader).sort()],
    [[true, true], true, 'deploy', ['s1', 's2']]);
}
{
  const state = freshState(M, data);
  const run = runner(M, data, state);
  const before = M.SEC.boardFingerprint(state);
  run({ kind: 'configureTable', seat: 's1', noSecondary: true });
  const on = M.SEC.boardFingerprint(state);
  const kept = M.U.migrateState(JSON.parse(JSON.stringify(state)), data);
  run({ kind: 'configureTable', seat: 's1', noSecondary: false });
  check('the setting is on the table: kept by a saved board, told apart by the two boards\' fingerprint, and cleared by false',
    [kept.noSecondary, on !== before, state.noSecondary, 'noSecondary' in JSON.parse(JSON.stringify(state)), M.SEC.boardFingerprint(state) === before],
    [true, true, undefined, false, true]);
  check('configuring nothing is still refused', run({ kind: 'configureTable', seat: 's1' }), { ok: false, why: 'Nothing to configure.' });
}
// A table that plays its Secondary Tasks must hash as it did before the option
// existed, or two players on different builds would read every command as a
// drift. So the fingerprint carries the setting only when it is set.
check('the fingerprint carries the setting only when it is set',
  /\n\s*\.\.\.\(s\.noSecondary \? \['noSecondary'\] : \[\]\),\n/.test(readFileSync(new URL('../src/secrecy.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n')), true);
// The three pages that draw the Tasks step read the same flag (the
// three-reader rule): the Match Centre HUD, the tabletop guide, the pad.
const srcOf = (p) => readFileSync(new URL(p, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
check('each page that draws the Tasks step asks for no Secondary in such a game',
  [/const both = !!s\.noSecondary \|\| \(!!taskState\.secondary\.s1 && !!taskState\.secondary\.s2\);/.test(srcOf('../src/matchhud.ts')),
    /if \(!s\.noSecondary && \(!taskState\.secondary\.s1 \|\| !taskState\.secondary\.s2\)\) \{/.test(srcOf('../src/matchhud.ts')),
    /\$\{s\.noSecondary \? '' : this\.secondaryHtml\(s\)\}/.test(srcOf('../src/playguide.ts')),
    /const both = !!s\.noSecondary \|\| \(!!tasks\.secondary\.s1 && !!tasks\.secondary\.s2\);/.test(srcOf('../pad/guided.ts'))],
  [true, true, true, true]);

// ---------- a broken file offers nothing it cannot start ----------
{
  const real = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (!String(url).endsWith('solo.json')) return real(url);
    const doc = structuredClone(file);
    doc.scenarios.push({ ...doc.scenarios[0], id: 'no-such-squad', seats: { s1: 'raid-rdl', s2: 'missing' } });
    doc.scenarios.push({ id: 'half', map: 'alley' });
    doc.squads.broken = { name: 'Broken' };
    return { ok: true, json: async () => doc, text: async () => JSON.stringify(doc) };
  };
  const again = await M.loadData();
  globalThis.fetch = real;
  check('a scenario naming a squad the file lacks, a half-written one and a half-written squad are dropped',
    [again.solo.scenarios.map((x) => x.id), Object.keys(again.solo.squads)],
    [file.scenarios.map((x) => x.id), Object.keys(file.squads)]);
  globalThis.fetch = async (url) => (String(url).endsWith('solo.json') ? { ok: false } : real(url));
  const none = await M.loadData();
  globalThis.fetch = real;
  check('and with no file at all the game still loads, offering none', [none.solo.scenarios, none.solo.squads], [[], {}]);
}

// ---------- what a table is configured with (src/tableconfig.ts) ----------
// A Main Task is more than its id: the page works out its zones and its Task
// items and hands them over inside configureTable. A table built with no lobby
// (a game against the computer) sends the same two payloads the lobby sends.
{
  const { tableCommands, tableAtRoundOne } = await import('./_engine.mjs');
  const [alley, vip] = data.solo.scenarios;
  const forMap = M.TC.mapConfig(data, 'alley', null);
  check('a battlefield picked with no Main Task: the map and its size, and nothing a Task would bring',
    [forMap.map, forMap.grids, forMap.zones, 'tasks' in forMap], ['alley', 12, null, false]);
  const control = M.TC.missionConfig(data, 'alley', alley.mission);
  check('an Occupation brings a control dial for each zone its card names, nobody holding any',
    [control.mission, control.zoneSet, control.tasks.items.map((i) => [i.kind, i.zone, i.control ?? null])],
    [alley.mission, `mission:${alley.mission}`, [['control', 'bravo', null], ['control', 'echo', null], ['control', 'hotel', null]]]);
  const hunt = M.TC.missionConfig(data, 'crossroads', vip.mission);
  check('an Assassination brings no Task item: its Task is a unit each squad names', [hunt.mission, hunt.tasks.items], [vip.mission, []]);
  check('a Task cleared takes its items and its zone set with it', [M.TC.missionConfig(data, 'alley', null).tasks, M.TC.missionConfig(data, 'alley', null).zoneSet, M.TC.missionConfig(data, 'alley', null).mission], [null, '', null]);
  check('a Task picked before the map is re-resolved when the map is', M.TC.mapConfig(data, 'alley', alley.mission).tasks.items.length, 3);
  // The harness, and the game against the computer, set a table up with them.
  const cmds = tableCommands(M, data, alley);
  check('a table set up with no lobby sends the battlefield, then the Main Task, then the game\'s own settings',
    cmds.map((c) => Object.keys(c).filter((k) => k !== 'kind' && k !== 'seat').sort().join(',')),
    ['deployZones,grids,map,zones', 'deployZones,mission,tasks,zoneSet,zones', 'noSecondary,roundLimit']);
  const t = tableAtRoundOne(M, data, alley);
  const items = M.TK.normaliseTasks(t.state.tasks).items;
  check('so the game it starts has the Task\'s items on it', [t.refused, items.map((i) => i.zone), t.state.zoneSet], [[], ['bravo', 'echo', 'hotel'], `mission:${alley.mission}`]);
  // And what an Occupation with no dials is worth: nothing, all game.
  const bare = freshState(M, data);
  const go = runner(M, data, bare);
  go({ kind: 'configureTable', seat: 's1', map: 'alley', mission: alley.mission, roundLimit: 5 });
  const mire = { ...M.U.makeMechToken(bare, data, data.solo.squads['raid-rdl'].mechs[0].loadout, 's1'), col: 15, row: 15, facing: 0 };
  bare.tokens.push(mire);
  bare.round.n = 3;
  const full = JSON.parse(JSON.stringify(t.state));
  full.round.n = 3;
  for (const x of full.tokens) { x.col = 0; x.row = 33; }
  full.tokens[0].col = 15; full.tokens[0].row = 15;
  check('a table handed only the Task\'s id scores nothing for a zone a squad holds; one set up properly pays its two points',
    [M.S.previewScore(data, bare, false).s1, M.S.previewScore(data, full, false).s1], [0, 2]);
  const src = (f) => readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  check('the Match Centre\'s lobby sends the same two payloads',
    [/perform\(data, state, \{ kind: 'configureTable', seat: mySeat\(\) \?\? 's1', \.\.\.mapConfig\(data, id, state\.mission\) \}\);/.test(src('match.ts')),
      /perform\(data, state, \{ kind: 'configureTable', seat: mySeat\(\) \?\? 's1', \.\.\.missionConfig\(data, state\.map, id \|\| null\) \}\);/.test(src('match.ts')),
      /taskItemsFor\(/.test(src('match.ts'))], [true, true, false]);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
