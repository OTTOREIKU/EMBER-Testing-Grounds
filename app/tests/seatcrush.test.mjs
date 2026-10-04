// A Crush of a Unit, answered by a seat (4.3.6; AI-OPPONENT-PLAN.md, M8.2p).
//
// A Large Ground Unit that ends a Movement in a Grid a smaller unit stands in
// Crushes it: each crushed unit is Force-Moved one Grid, its Grid chosen by the
// crushing player, or destroyed where it cannot be Force-Moved, or, with no
// Grid open to it, exchanges places with the crusher; then the crusher lands.
// The Match Centre works it a piece at a time in its Crush panel; the seam
// passed every such Movement over. Now each way it may come out is one whole
// answer, made of the commands the panel sends, in its order.
import { botTable, loadEngine } from './_engine.mjs';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}\n       got  ${g}`); }
};

console.log('A Crush of a Unit\n');

const { M, data } = await loadEngine('seatcrush', ["export * as SEAT from '../src/seat';", "export * as TURN from '../src/turn';", "export * as AI from '../src/ai/index';", "export * as HUD from '../src/matchhud';"]);
const AI = M.AI;
const viewOf = (state, seat) => M.SEAT.viewOf(data, state, seat);

const gunner = (name) => ({ name, loadout: { torso: '533', chasis: '534', leftHand: '535', rightHand: '536', backpack: '004', pilot: 'FPA-04-2' } });
const rifle = (name) => ({ name, loadout: { torso: '539', chasis: '099', leftHand: '540', rightHand: '541', backpack: '538', pilot: 'LPA-23-2' } });
// RDL: two gunners, Large Mechs. UN: a rifleman and four Drones: a Raven Scout
// (medium, moves 8), a Delphinium (small, moves nothing: it cannot be
// Force-Moved), a Tarantula (medium, moves 6) and a Porcupine (medium, moves
// nothing).
data.solo.squads['p-crushers'] = { name: 'Crushers', faction: 'RDL', points: 0, mechs: [gunner('Dune'), gunner('Sand')], drones: [] };
data.solo.squads['p-drones'] = { name: 'Drones', faction: 'UN', points: 0, mechs: [rifle('Wolf')], drones: [{ cardId: '164' }, { cardId: '159' }, { cardId: '163' }, { cardId: '161' }] };
const scenario = { ...data.solo.scenarios[0], id: 't-crush', seats: { s1: 'p-crushers', s2: 'p-drones' } };
const grid = (x) => ({ c: Math.floor(x.col / 3), r: Math.floor(x.row / 3) });
const OFF = { Sand: [0, 12, 0], Wolf: [12, 12, 0], Raven: [12, 0, 0], Delphinium: [11, 0, 0], Tarantula: [10, 0, 0], Porcupine: [9, 0, 0] };

// A table past its setup on an open board, the Dune on its Movement dial in
// the Action Phase; every unit the board does not name parked out of the way.
const table = async (where, policies = AI.tacticianPolicy) => {
  const t = botTable(M, data, { ...scenario, map: 'none' }, { seed: 3, policies, glue: M.HUD.glueAfter });
  await t.run({ until: (st) => M.SU.normaliseSetup(st.setup)?.stage === 'done' });
  const s = t.state;
  const U = {};
  for (const x of s.tokens) U[x.label.split(' ').find((w) => ['Raven', 'Delphinium', 'Tarantula', 'Porcupine'].includes(w.replace(/[^A-Za-z]/g, '')))?.replace(/[^A-Za-z]/g, '') ?? x.label] = x;
  // A unit stands from the top-left cell of its Grid: a Large one fills it.
  const at = (x, c, r, f) => { x.col = c * 3; x.row = r * 3; if (f !== undefined) x.facing = f; };
  for (const [k, v] of Object.entries({ ...OFF, ...where })) if (U[k]) at(U[k], ...v);
  s.round.phase = 2; s.script.stage = '1:2'; s.script.opp = null; s.script.revealed = ['s1', 's2']; s.script.passed = [];
  for (const x of s.tokens) if (x.kind === 'mech') x.timing = 'firing';
  U.Dune.timing = 'movement';
  s.script.acted = s.tokens.filter((x) => x.kind === 'mech' && x.uid !== U.Dune.uid).map((x) => x.uid);
  M.G.opportunity(data, s);
  const send = (cmds) => cmds.map((cmd) => { const v = M.C.perform(data, s, cmd); if (v.ok) M.HUD.glueAfter(data, s, cmd); return v.ok; });
  return { t, s, U, send, d: t.drivers.s1.pending() };
};
// The Maneuver's Crushes into Grid (c, r), on a facing (a Sprint makes its own).
const crushes = (d, c, r, f) => d.options.filter((o) => o.tags.includes('crush-unit') && o.id.startsWith(`move:maneuver:${c},${r}:`) && (f === undefined || o.facts.facing === f));

// ---------- the cards ----------
{
  const card = (id) => data.byId.get(id);
  check('the cards are what the test means them to be: the Raven moves 9, the Tarantula 6, the Porcupine 5, the Delphinium not at all',
    ['164', '163', '161', '159'].map((id) => card(id).move), [9, 6, 5, 0]);
}

// ---------- pushed one Grid ----------
{
  // The Dune a Grid north of the Raven, its Maneuver into the Raven's Grid.
  const x = await table({ Dune: [5, 6, 2], Raven: [5, 7, 0] });
  const ways = crushes(x.d, 5, 7, 2);
  const pushedTo = ways.map((o) => o.facts.pushed.map((p) => `${p.to.c},${p.to.r}`).join('')).sort();
  check('A MOVEMENT THAT ENDS IN A GRID A SMALLER UNIT STANDS IN IS OFFERED, ONCE FOR EACH GRID THE CRUSHED UNIT MAY BE PUSHED INTO: every open Grid beside its own but the one the crusher steps out of',
    [pushedTo, ways.every((o) => o.facts.crushed.length === 1 && o.facts.crushed[0] === x.U.Raven.uid && !o.facts.short)], [['4,7', '5,8', '6,7'], true]);
  const one = ways.find((o) => o.facts.pushed[0].to.c === 6);
  check('each is the panel\'s commands in its order: the push, by the crusher, the facing left, then the crusher\'s Movement into the Grid',
    [one.commands.map((c) => c.kind), one.commands[0].uid, one.commands[0].targetUid, one.commands[0].facing, one.commands[1].to && grid(one.commands[1].to)],
    [['forceMove', 'maneuver'], x.U.Dune.uid, x.U.Raven.uid, undefined, { c: 5, r: 7 }]);
  const ids = x.d.options.map((o) => o.id);
  check('every answer has an id of its own, the ways into one Grid included (a seat\'s pick is named by it)', ids.length === new Set(ids).size, true);
  const facing = x.U.Raven.facing;
  check('the engine takes it: the Raven stands in the Grid it was pushed into, facing as it did, and the Dune stands in the Raven\'s',
    [x.send(one.commands), grid(x.U.Raven), x.U.Raven.facing === facing, grid(x.U.Dune)], [[true, true], { c: 6, r: 7 }, true, { c: 5, r: 7 }]);
  x.t.close();
}
{
  // A longer walk: the Sprint from three Grids off. The crushed unit is pushed
  // as the panel pushes it, measured with the crusher in the Grid it steps out
  // of (F7), never into it; the Grid the walk began in is no part of it.
  const x = await table({ Dune: [5, 4, 2], Raven: [5, 7, 0] });
  const sprint = x.d.options.filter((o) => o.tags.includes('crush-unit') && o.id.startsWith('move:534_A:5,7:') && o.facts.facing === 2);
  check('A LONGER WALK PUSHES AS THE PANEL DOES: into the open Grids beside the crushed one, not the one the crusher steps out of',
    sprint.map((o) => o.facts.pushed.map((p) => `${p.to.c},${p.to.r}`).join('')).sort(), ['4,7', '5,8', '6,7']);
  x.t.close();
}

// ---------- nowhere to go: the exchange ----------
{
  // The Raven's other three Grids are taken: the Sand west of it, the
  // Porcupine east (two Medium units do not share a Grid), the Tarantula
  // south. (The Wolf, armed for Melee, would lock the Dune corner to corner,
  // and a Maneuver of 1 Grid pays no Break Away.)
  const x = await table({ Dune: [5, 6, 2], Raven: [5, 7, 0], Sand: [4, 7, 0], Porcupine: [6, 7, 0], Tarantula: [5, 8, 0] });
  const ways = crushes(x.d, 5, 7, 2);
  check('WITH NO GRID OPEN TO IT, THE CRUSHED UNIT EXCHANGES PLACES WITH THE CRUSHER (4.3.6): one way, the exchange in one command and the Movement recorded from where it began',
    [ways.length, ways[0]?.facts.exchanged, ways[0]?.commands.map((c) => c.kind), ways[0]?.commands[1]?.from && grid(ways[0].commands[1].from)],
    [1, [x.U.Raven.uid], ['crushSwap', 'maneuver'], { c: 5, r: 6 }]);
  check('the engine takes it: the Raven stands where the Dune stood, the Dune in the Raven\'s Grid',
    [x.send(ways[0].commands), grid(x.U.Raven), grid(x.U.Dune)], [[true, true], { c: 5, r: 6 }, { c: 5, r: 7 }]);
  x.t.close();
}

// ---------- a unit that cannot be Force-Moved ----------
{
  const x = await table({ Dune: [5, 6, 2], Delphinium: [5, 7, 0] });
  const ways = crushes(x.d, 5, 7, 2);
  check('A UNIT THAT CANNOT BE FORCE-MOVED IS DESTROYED BY THE CRUSH: one way, the kill credited to the crusher, then its Movement',
    [ways.length, ways[0]?.facts.destroyed, ways[0]?.commands.map((c) => [c.kind, c.uid]), ways[0]?.tags.includes('kill')],
    [1, [x.U.Delphinium.uid], [['recordKill', x.U.Dune.uid], ['maneuver', x.U.Dune.uid]], true]);
  check('the engine takes it: the Delphinium leaves the board (4.4.4), and the Dune stands in its Grid',
    [x.send(ways[0].commands), x.s.tokens.some((y) => y.uid === x.U.Delphinium.uid), grid(x.U.Dune)], [[true, true], false, { c: 5, r: 7 }]);
  x.t.close();
}

// ---------- two units in the Grid ----------
{
  const x = await table({ Dune: [5, 6, 2], Delphinium: [5, 7, 0], Raven: [5, 7, 0] });
  x.U.Delphinium.col = 5 * 3; x.U.Delphinium.row = 7 * 3;
  x.U.Raven.col = 5 * 3 + 1; x.U.Raven.row = 7 * 3 + 1;
  const ways = crushes(x.d, 5, 7, 2);
  check('TWO UNITS CRUSHED: each way settles both, in the order the planner queues them: the Delphinium destroyed and the Raven pushed to each Grid open to it',
    [ways.length, ways.every((o) => o.facts.destroyed.length === 1 && o.facts.pushed.length === 1), [...new Set(ways.map((o) => o.facts.pushed[0].to.c * 100 + o.facts.pushed[0].to.r))].length],
    [3, true, 3]);
  check('and the engine takes each', ways.map((o) => !!M.G.tableAfter(data, x.s, o.commands)), [true, true, true]);
  x.t.close();
}

// ---------- what an asker is given, and who takes them ----------
{
  const x = await table({ Dune: [5, 6, 2], Raven: [5, 7, 0] });
  const view = viewOf(x.s, 's1');
  const only = (kinds) => M.SEAT.owed(data, x.s, 's1', M.SEAT.newMind(), { only: kinds })?.options ?? [];
  check('an asker that wants Movements is given them; one that wants attacks is not',
    [only(['move']).filter((o) => o.tags.includes('crush-unit')).length === x.d.options.filter((o) => o.tags.includes('crush-unit')).length, only(['attack']).some((o) => o.tags.includes('crush-unit'))], [true, false]);
  const rows = AI.weighed(x.d, view, {});
  // The plans of the Maneuver alone, at the facing each likes best.
  const planned = new Set(rows.map((r) => /^Dune: Maneuver to F8, crushing .*Raven.* pushed to ([A-Z]\d+)\), facing \w+$/.exec(r.label ?? '')?.[1]).filter(Boolean));
  check('THE TACTICIAN PLANS EACH WAY APART: the same Grid, the Raven pushed to each of its Grids, is three plans', [...planned].sort(), ['E8', 'F9', 'G8']);
  check('with its skill off (`crush`) no plan is a Crush', AI.weighed(x.d, view, { crush: false }).some((r) => /crushing/.test(r.label ?? '')), false);
  const brawled = AI.brawlerPolicy.choose(x.d, view, new AI.Rng('b'));
  check('THE BRAWLER, A COPY OF A LADDER WITH NO RUNG FOR A CRUSH, TAKES NONE', x.d.options.find((o) => o.id === brawled.option)?.tags.includes('crush-unit') ?? false, false);
  x.t.close();
}

// ---------- whole games ----------
// A seat that takes a Crush whenever one is offered, by lot, and is the
// Tactician otherwise: every way a Crush comes out then runs through the
// engine in whole games, to their end.
const crusher = {
  name: 'crusher',
  choose(d, view, rng) {
    const xs = d.options.filter((o) => o.tags.includes('crush-unit'));
    return xs.length ? { option: xs[Math.floor(rng.next() * xs.length)].id, why: 'every Crush it may' } : AI.tacticianPolicy.choose(d, view, rng);
  },
};
M.L.setLocalSeat(null);
{
  const tally = { games: 0, over: 0, refused: 0, broken: [], crushed: 0, swapped: 0, killed: 0 };
  for (const [policy, seeds] of [['legal', [1, 2]], ['eager', [1]], ['brawler', [1]], ['tactician', [1, 2]], ['crusher', [1, 2]]]) {
    for (const seed of seeds) {
      const t = botTable(M, data, scenario, { seed, policies: { s1: policy === 'crusher' ? crusher : AI[`${policy}Policy`], s2: AI.tacticianPolicy }, glue: M.HUD.glueAfter });
      t.watch((cmd) => {
        if (cmd.kind === 'forceMove' && cmd.seat === 's1') tally.crushed += 1;
        if (cmd.kind === 'crushSwap') tally.swapped += 1;
        if (cmd.kind === 'recordKill' && cmd.seat === 's1') tally.killed += 1;
      });
      let end;
      try { end = await t.run({ maxSteps: 16000 }); } catch (err) { end = { kind: 'threw', why: `${err?.message ?? err}`.split('\n')[0] }; } finally { t.close(); }
      tally.games += 1;
      if (end.kind === 'over') tally.over += 1; else tally.broken.push(`${policy} ${seed}: ${end.kind} ${end.why ?? ''} ${end.decision ?? ''}`);
      tally.refused += t.refused.length;
    }
  }
  check('EIGHT GAMES of Large Mechs against Drones, on the page\'s glue, five policies: every one ends as a game should, nothing refused, and units were crushed in them',
    [tally.over, tally.games, tally.refused, tally.broken, tally.crushed + tally.swapped > 0], [8, 8, 0, [], true]);
  console.log(`       pushed ${tally.crushed}, exchanged ${tally.swapped}, kills recorded by the crushers ${tally.killed}`);
}

console.log(`\n${pass} passed, ${fail} failed`);
M.L.setLocalSeat(null);
if (fail) process.exit(1);
