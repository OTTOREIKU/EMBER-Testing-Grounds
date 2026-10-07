// A harness that RUNS the real engine with no page.
//
// Checked in by hand, like _combatdrive.mjs beside it: the `_` only keeps it
// out of the test list. simgame.test.mjs plays whole games on a copy of the
// engine it slices out of the source text and stubs; this bundles the modules
// themselves (commands, glue, loop, units, rules, scoring, setup, ticks, tasks,
// combat) with esbuild, as linkaudit and tabletokens bundle the Reference, so a
// computer seat is tested on the code a player's page runs. Measured
// 2026-10-01: the bundle takes about 190 ms, a copy of a mid-game state about
// 60 microseconds and a check() about 2.5.
import { writeFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { installDom } from './_combatdrive.mjs';

const MODULES = [
  ['C', 'commands'], ['G', 'glue'], ['L', 'loop'], ['U', 'units'], ['R', 'rules'], ['S', 'scoring'],
  ['SU', 'setup'], ['T', 'ticks'], ['TK', 'tasks'], ['TY', 'types'], ['SEC', 'secrecy'], ['K', 'combat'], ['TC', 'tableconfig'],
];

// The table a scenario is played on, set up the way the Match Centre's lobby
// sets one up: the battlefield, then the Main Task with its zones and its Task
// items (tableconfig.ts), then the rounds and the Secondary Tasks switch, and
// the Season Rules as solo.ts soloSetup sets them (the scenario's `season`, or
// SEASON=<id> in the environment for a measurement). A table handed only the
// Task's id plays a Task that can never score.
export function tableCommands(M, data, scenario) {
  const season = scenario.season ?? process.env.SEASON ?? null;
  return [
    { kind: 'configureTable', seat: 's1', ...M.TC.mapConfig(data, scenario.map, null) },
    { kind: 'configureTable', seat: 's1', ...M.TC.missionConfig(data, scenario.map, scenario.mission) },
    { kind: 'configureTable', seat: 's1', roundLimit: scenario.rounds, ...(scenario.secondaries === false ? { noSecondary: true } : {}) },
    ...(season ? [{ kind: 'configureTable', seat: 's1', season }] : []),
  ];
}

// `name` keeps two suites' scratch files apart. `extra` adds entry lines, for a
// suite that needs a module this list does not carry.
export async function loadEngine(name, extra = []) {
  installDom();
  globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  const entry = new URL(`./_${name}.entry.ts`, import.meta.url);
  const out = new URL(`./_${name}.bundle.mjs`, import.meta.url);
  writeFileSync(entry, [
    "export { loadData } from '../src/data';",
    ...MODULES.map(([as, file]) => `export * as ${as} from '../src/${file}';`),
    ...extra,
  ].join('\n') + '\n');
  await build({
    entryPoints: [fileURLToPath(entry)], outfile: fileURLToPath(out),
    bundle: true, format: 'esm', platform: 'browser', logLevel: 'silent',
    define: { 'import.meta.env.BASE_URL': '"/"', 'import.meta.env.PROD': 'false', 'import.meta.env.DEV': 'true' },
  });
  const M = await import(`${out.href}?t=${Date.now()}`);
  rmSync(entry); rmSync(out);
  const data = await M.loadData();
  return { M, data };
}

// The smallest valid table: match.ts freshBoard(), through the loader every
// saved board goes through.
export function freshState(M, data) {
  return M.U.migrateState({
    v: 3, map: 'alley', tokens: [], nextUid: 1, round: { n: 1, phase: 0, firstPlayer: 's1' },
    commandTokens: { s1: 0, s2: 0 }, markers: [], smoke: [], removedTerrain: [],
    tactics: { s1: [], s2: [] }, tacticsPlayed: { s1: [], s2: [] }, tasks: null, mission: null,
    scenario: null, roundLimit: 5, scale: 'standard', sideNames: {}, zoneSet: '', showZones: false,
  }, data);
}

// One command the way a page sends it: checked, performed, then the glue every
// client runs after a command lands. A refused command is NOT applied, strict
// table or not, so a suite can never walk on from a state the rules refused.
export function runner(M, data, state) {
  return (cmd) => {
    const verdict = M.C.check(data, state, cmd);
    if (!verdict.ok) return verdict;
    M.C.perform(data, state, cmd);
    M.G.glueAfter(data, state, cmd);
    return verdict;
  };
}

// ---------- two computer seats at one table ----------
//
// The table as the page of a game against the computer holds it: built by the
// host (the map, the Main Task, both squads, the start) while no seat is held,
// and from then on s1 is the page's own seat, whose commands go through
// perform(), and s2 a second player's, whose commands arrive through
// applyRemote(). The local seat is SET, as a room sets it: check() applies
// nine rules only then (the ready pair, the loop-complete test, who closes a
// Counter-roll), and a table without it plays a looser game than a player gets.
// Call `close()` when the game is done, or the seat leaks into the next test.
//
// `glue` is the bookkeeping run after every command that lands: glue.ts's, by
// default. The Match Centre's page runs its own on top of that (matchhud.ts
// glueAfter: the queue of Smoke Screens a round's end owes), so a suite about
// what only the page keeps hands that one in.
//
// `tap(seat, cmd)` hears each command the moment it lands, before the glue and
// before anyone at the table answers it: in the order the board took them, as
// a page's relay hears them. (A watcher hears a command only once the answers
// it set off have landed, so watchers hear an answer before its question.)
export function seatTable(M, data, scenario, glue = M.G.glueAfter, tap = null) {
  M.L.setLocalSeat(null);
  const state = freshState(M, data);
  const sent = [];
  const refused = [];
  const host = (cmd) => { const v = M.C.perform(data, state, cmd); if (v.ok) glue(data, state, cmd); else refused.push({ seat: 'host', kind: cmd.kind, why: v.why }); return v; };
  for (const cmd of tableCommands(M, data, scenario)) host(cmd);
  for (const seat of ['s1', 's2']) {
    const sq = data.solo.squads[scenario.seats[seat]];
    host({ kind: 'importSquad', seat, name: sq.name, mechs: sq.mechs, drones: sq.drones });
  }
  host({ kind: 'startMatch', seat: 's1' });
  M.L.setLocalSeat('s1');
  // Whoever sits at the table is told of every command that lands, the way a
  // page's relay tells a second player's.
  const watchers = [];
  const send = (seat, cmd) => {
    const v = seat === 's1' ? M.C.perform(data, state, cmd) : M.C.applyRemote(data, state, cmd);
    sent.push({ seat, kind: cmd.kind, ok: v.ok });
    if (v.ok) {
      tap?.(seat, cmd);
      glue(data, state, cmd);
      for (const w of watchers) w(cmd);
    } else refused.push({ seat, kind: cmd.kind, why: v.why, cmd });
    return v;
  };
  return { state, send, sent, refused, watch: (fn) => watchers.push(fn), close: () => M.L.setLocalSeat(null) };
}

// Two drivers at one table, for a suite to step. `policies` is one policy for
// both seats or one each; the dice come from a stream of their own, so the same
// seed is the same game. `host` adds to what each driver's host answers: the
// pace hooks (`pace`, `settled`), which a page uses and a suite records.
// `dice` replaces the table's dice: (pool, label) => faces. `tap` is
// seatTable's.
export function botTable(M, data, scenario, { seed = 1, policies, host = {}, dice: fixed, glue, tap } = {}) {
  const AI = M.AI;
  const table = seatTable(M, data, scenario, glue, tap);
  const dice = new AI.Rng(`${seed}:dice`);
  const roll = fixed
    ? async (pool, label) => fixed(pool, label)
    : async (pool) => Object.entries(pool).flatMap(([color, n]) =>
      Array.from({ length: n }, () => ({ color, face: dice.int(data.dice.dice[color].sides) })));
  const policyOf = (seat) => (policies?.[seat] ?? policies ?? AI.legalPolicy);
  const drivers = Object.fromEntries(['s1', 's2'].map((seat) => [seat, new AI.Driver(
    seat,
    { data, state: () => table.state, send: (cmd) => table.send(seat, cmd), roll, ...Object.fromEntries(Object.entries(host).map(([k, fn]) => [k, (...a) => fn(seat, ...a)])) },
    policyOf(seat), new AI.Rng(`${seed}:${seat}`),
    { prefer: scenario.edges ? [`edge:${scenario.edges[seat]}`] : [] },
  )]));
  for (const d of Object.values(drivers)) table.watch((cmd) => d.observe(cmd));
  let steps = 0;
  // One round of the table: each seat takes a decision if it is asked one.
  // Answers with how the game stands: null to go on, or why it stopped.
  const step = async (onStep) => {
    const results = [];
    for (const seat of ['s1', 's2']) {
      const r = await drivers[seat].step();
      results.push(r);
      if (r.kind === 'acted') { steps++; onStep?.(seat, r, table.state); }
    }
    const over = results.find((r) => r.kind === 'over');
    if (over) return { kind: 'over', result: over.result };
    const bad = results.find((r) => r.kind === 'refused' || r.kind === 'stuck');
    if (bad) return { kind: bad.kind, why: bad.why, decision: bad.decision?.kind, option: bad.option?.id ?? null };
    if (results.every((r) => r.kind === 'idle')) {
      return { kind: 'stalled', why: `neither seat is asked anything in round ${table.state.round.n}, ${M.TY.PHASES[table.state.round.phase]} Phase` };
    }
    return null;
  };
  // Plays on until the game stops or `until(state)` says so.
  const run = async ({ until, maxSteps = 6000, onStep } = {}) => {
    while (steps < maxSteps) {
      if (until?.(table.state)) return { kind: 'paused' };
      const end = await step(onStep);
      if (end) return end;
    }
    return { kind: 'limit', why: `no end after ${maxSteps} decisions` };
  };
  return { ...table, drivers, step, run, steps: () => steps };
}

// Two drivers play the scenario out. Stops at the end of the game, at a
// refusal, at a seat that is stuck, or when neither seat has anything to do
// and the game is not over.
export async function playBots(M, data, scenario, { maxSteps = 6000, onStep, ...opts } = {}) {
  const t = botTable(M, data, scenario, opts);
  let end;
  try {
    end = await t.run({ maxSteps, onStep });
  } finally {
    t.close();
  }
  return { ...t, steps: t.steps(), end };
}

// ---------- a squad at random ----------
//
// A legal squad of one allegiance, built at random from the card data: Mechs
// (a Torso, a Chassis, an Arm or two, a Backpack most times, a Pilot) and
// Drones of that faction, a Carrier given a Load, and now and then a unit of a
// faction anybody may hire. `rng` is an AI.Rng; the same seed is the same
// squad. For the suites that play ANY squad (the engine must be loaded with
// `export * as D from '../src/data'`).
const SQUAD_SLOTS = ['torso', 'chasis', 'leftHand', 'rightHand', 'backpack', 'pilot'];
const HIRED = ['PD', 'COLLABORATION'];
export function squadAtRandom(M, data, rng, budget, faction) {
  const buildable = (c) => !M.D.isDiscardCard(c) && !M.D.isModeFace(c) && !c.referenceOnly;
  const price = (id) => (id ? data.byId.get(id)?.score ?? 0 : 0);
  const pool = (f, key) => data.cards.filter((c) => (key === 'pilot' ? c.category === 'pilot' : c.category === 'mech_part' && c.type === key) && buildable(c) && data.factionOf(c) === f);
  const drones = (f) => data.cards.filter((c) => c.category === 'drone' && (c.score ?? 0) > 0 && (c.score ?? 0) < 99 && data.factionOf(c) === f);
  const mechOf = (f) => {
    const p = Object.fromEntries(SQUAD_SLOTS.map((key) => [key, pool(f, key)]));
    if (!p.torso.length || !p.chasis.length || !p.pilot.length || !(p.leftHand.length + p.rightHand.length)) return null;
    const pick = (key, odds) => (p[key].length && rng.next() < odds ? rng.pick(p[key]).id : undefined);
    const loadout = { torso: pick('torso', 1), chasis: pick('chasis', 1), leftHand: pick('leftHand', 0.85), rightHand: pick('rightHand', 0.85), backpack: pick('backpack', 0.8), pilot: pick('pilot', 1) };
    if (!loadout.leftHand && !loadout.rightHand) loadout[p.leftHand.length ? 'leftHand' : 'rightHand'] = rng.pick(p.leftHand.length ? p.leftHand : p.rightHand).id;
    for (const k of Object.keys(loadout)) if (!loadout[k]) delete loadout[k];
    return { name: M.D.cardName(data.byId.get(loadout.torso)).split(' ').slice(-2).join(' '), loadout, points: Object.values(loadout).reduce((n, id) => n + price(id), 0) };
  };
  const droneOf = (f) => {
    const p = drones(f);
    if (!p.length) return null;
    const card = rng.pick(p);
    const out = { cardId: card.id, points: card.score ?? 0 };
    if (M.U.isCarrier(card)) {
      const loads = data.cards.filter((c) => M.U.canBeLoad(c) && buildable(c) && data.factionOf(c) === f);
      if (loads.length) { const load = rng.pick(loads); out.backpack = load.id; out.points += load.score ?? 0; }
    }
    return out;
  };
  const mechs = [];
  const drone = [];
  let total = 0;
  for (let tries = 0; tries < 40 && mechs.length + drone.length < 7; tries++) {
    const from = rng.next() < 0.15 ? rng.pick(HIRED) : faction;
    const wantMech = !mechs.length || rng.next() < 0.45;
    const unit = wantMech ? mechOf(from) : droneOf(from);
    if (!unit || total + unit.points > budget) continue;
    total += unit.points;
    if (wantMech) mechs.push({ name: unit.name, loadout: unit.loadout });
    else drone.push({ cardId: unit.cardId, ...(unit.backpack ? { backpack: unit.backpack } : {}) });
  }
  if (!mechs.length) {
    // The budget fitted none at random: the cheapest of sixty tries, whatever it costs.
    let best = null;
    for (let i = 0; i < 60; i++) { const m = mechOf(faction); if (m && (!best || m.points < best.points)) best = m; }
    if (best) { mechs.push({ name: best.name, loadout: best.loadout }); total += best.points; }
  }
  return { name: `${faction} ${total}`, faction, points: total, mechs, drones: drone };
}

// A scenario of data/solo.json built and played through setup to the first
// Command Phase, by plain commands: the table, both squads, the battlefield
// locked, `first` as First Player, the edges the scenario fixes, a Commander
// each where the Main Task wants one (each squad's first Mech), every Black
// Box left where its Task put it, every unit deployed in its zone in turn. Returns the state, the runner and every
// refusal met on the way, which a suite expects to be none.
export function tableAtRoundOne(M, data, scenario, first = 's1') {
  const state = freshState(M, data);
  const run = runner(M, data, state);
  const refused = [];
  const step = (label, cmd) => { const v = run(cmd); if (!v.ok) refused.push(`${label}: ${v.why}`); return v; };
  for (const cmd of tableCommands(M, data, scenario)) step('configure', cmd);
  for (const seat of ['s1', 's2']) {
    const sq = data.solo.squads[scenario.seats[seat]];
    step(`import ${seat}`, { kind: 'importSquad', seat, name: sq.name, mechs: sq.mechs, drones: sq.drones });
  }
  step('start', { kind: 'startMatch', seat: 's1' });
  step('lock', { kind: 'lockMap', seat: 's1' });
  step('first', { kind: 'acceptRoll', seat: 's1', first });
  step('edge', { kind: 'pickEdge', seat: first, edge: scenario.edges?.[first] ?? 'black' });
  for (const d of M.C.taskDesignations(data, state)) {
    if (d.what !== 'leader') continue;
    const mech = state.tokens.find((t) => t.side === d.by && t.kind === 'mech');
    step(`commander ${d.by}`, { kind: 'designateTask', seat: d.by, what: 'leader', uid: mech.uid });
  }
  // A Black Box Task's Boxes, placed in turn from the First Player (5.2.1),
  // each left where the Task's card put it.
  for (let guard = 0; guard < 12; guard++) {
    const tasks = M.TK.normaliseTasks(state.tasks);
    const seat = state.noBoard ? null : M.TK.boxPlaceTurn(tasks, first);
    const box = tasks.items.find((i) => i.kind === 'blackbox' && !i.set);
    if (!seat || !box) break;
    if (!step(`box ${box.id}`, { kind: 'placeTaskItem', seat, itemId: box.id, to: { col: box.col, row: box.row } }).ok) break;
  }
  step('tasks', { kind: 'finishTasks', seat: first });
  for (let guard = 0; guard < 40; guard++) {
    const su = M.SU.normaliseSetup(state.setup);
    if (!su || su.stage !== 'deploy' || M.SU.deploymentComplete(state, data)) break;
    const seat = M.SU.deployTurn(state, su, data);
    if (!seat) break;
    const unit = M.SU.deployable(state, seat, data)[0];
    const taken = new Set(state.tokens.filter((t) => t.deployed !== false && t.kind !== 'projectile')
      .map((t) => `${Math.floor(t.col / 3)},${Math.floor(t.row / 3)}`));
    const zone = M.TK.deployGrids(data.zoneData, state, su.edge[seat]);
    const [c, r] = [...M.TK.deployOpenGrids(zone, taken, 12)].sort()[0].split(',').map(Number);
    if (!step(`deploy ${unit.label}`, { kind: 'deployUnit', seat, uid: unit.uid, to: { col: c * 3, row: r * 3 } }).ok) break;
  }
  step('deployed', { kind: 'finishDeployment', seat: 's1' });
  return { state, run, refused };
}
