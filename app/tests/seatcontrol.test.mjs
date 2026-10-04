// The Red Shoes, answered by a seat (TM35NA_B; AI-OPPONENT-PLAN.md, M8.2s).
//
// A won Counter-roll of the UN Electronic Attack queues a `control` debt: its
// player performs ONE of the enemy unit's own Maneuvers or Move Actions, no
// Tick, still stopped by Immobilized, and ending in no Crush (commands.ts
// controlledMove, which spends the debt). The Match Centre asks in its
// reaction panel; the seam let it go by. Now each Grid the enemy's Maneuver
// and each its Move Actions reach is an answer, the controller's seat sending
// it, and leaving it be is the safe answer.
import { readFileSync } from 'node:fs';
import { botTable, loadEngine } from './_engine.mjs';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}\n       got  ${g}`); }
};

console.log('The Red Shoes\n');

const { M, data } = await loadEngine('seatcontrol', ["export * as SEAT from '../src/seat';", "export * as AI from '../src/ai/index';", "export * as HUD from '../src/matchhud';"]);
const AI = M.AI;
const viewOf = (state, seat) => M.SEAT.viewOf(data, state, seat);
const src = (f) => readFileSync(new URL(f, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

const un = (name, torso = '539') => ({ name, loadout: { torso, chasis: '099', leftHand: '540', rightHand: '541', backpack: '538', pilot: 'LPA-23-2' } });
const gunner = (name) => ({ name, loadout: { torso: '533', chasis: '534', leftHand: '535', rightHand: '536', backpack: '004', pilot: 'FPA-04-2' } });
// UN: a Dancer (the TM35NA Torso, The Red Shoes) and a rifleman; RDL: two
// gunners. The VIP game's Main Task scores no zones.
data.solo.squads['s-shoes'] = { name: 'Shoes', faction: 'UN', points: 0, mechs: [un('Dancer', 'TM35NA'), un('Wolf')], drones: [] };
data.solo.squads['s-gunners'] = { name: 'Gunners', faction: 'RDL', points: 0, mechs: [gunner('Dune'), gunner('Sand')], drones: [] };
const scenario = { ...data.solo.scenarios[1], id: 't-control', seats: { s1: 's-shoes', s2: 's-gunners' } };
const grid = (x) => ({ c: Math.floor(x.col / 3), r: Math.floor(x.row / 3) });
const apart = (a, b) => Math.abs(a.c - b.c) + Math.abs(a.r - b.r);

// A table past its setup on an open board; the Dancer's Opportunity open on the
// Tactical dial, the others on Firing and still to act; and the debt its won
// Counter-roll left over the Dune.
const table = async (where, policies = AI.tacticianPolicy) => {
  const t = botTable(M, data, { ...scenario, map: 'none' }, { seed: 3, policies, glue: M.HUD.glueAfter });
  await t.run({ until: (st) => M.SU.normaliseSetup(st.setup)?.stage === 'done' });
  const s = t.state;
  const U = Object.fromEntries(s.tokens.map((x) => [x.label, x]));
  // A unit stands from the top-left cell of its Grid: a Large one fills it.
  const at = (x, c, r, f) => { x.col = c * 3; x.row = r * 3; if (f !== undefined) x.facing = f; };
  for (const [k, v] of Object.entries(where)) at(U[k], ...v);
  s.round.n = 1; s.round.phase = 2; s.script.stage = '1:2'; s.script.opp = null; s.script.revealed = ['s1', 's2']; s.script.passed = [];
  for (const x of s.tokens) if (x.kind === 'mech') x.timing = 'firing';
  U.Dancer.timing = 'swift';
  s.script.acted = [];
  M.G.opportunity(data, s);
  s.script.reactions = [{ uid: U.Dancer.uid, actionId: 'TM35NA_B', count: 1, range: 0, kind: 'control', fromUid: U.Dune.uid }];
  const send = (cmds) => cmds.map((cmd) => { const v = M.C.perform(data, s, cmd); if (v.ok) M.HUD.glueAfter(data, s, cmd); return v.ok; });
  return { t, s, U, at, send, d: t.drivers.s1.pending() };
};
const steers = (d) => (d?.options ?? []).filter((o) => o.tags.includes('control'));

// ---------- the card ----------
{
  const b = data.byId.get('TM35NA').actions.find((a) => a.id === 'TM35NA_B');
  check('the card is what the test means it to be: TM35NA_B, an Electronic Attack of Range 6', [b.type, b.range], ['Tactic', 6]);
}

// ---------- the seam ----------
{
  const x = await table({ Dancer: [5, 0, 2], Wolf: [8, 0, 2], Dune: [5, 6, 0], Sand: [11, 11, 0] });
  const d = x.d;
  const moves = steers(d);
  const maneuver = moves.filter((o) => o.tags.includes('maneuver'));
  const sprint = moves.filter((o) => o.facts.actionId === '534_A');
  check('THE SEAT THAT WON IS ASKED WHERE TO STEER THE DUNE: each Grid its Maneuver reaches, each its Sprint reaches, and leaving it be, the safe answer',
    [d?.kind, d?.facts.reaction, d?.facts.fromUid, maneuver.length > 0, sprint.length > maneuver.length, d?.fallback, d?.options.some((o) => o.id === 'decline')],
    ['reaction.answer', 'control', x.U.Dune.uid, true, true, 'decline', true]);
  const one = sprint.find((o) => o.facts.to.c === 5 && o.facts.to.r === 3 && o.facts.facing === 2);
  check('each is one controlledMove, the controller\'s seat sending it: the Dancer steering the Dune with the Dune\'s own Sprint',
    [one?.commands.map((c) => [c.kind, c.seat, c.uid, c.targetUid, c.actionId ?? null]), one?.commands.length],
    [[['controlledMove', 's1', x.U.Dancer.uid, x.U.Dune.uid, '534_A']], 1]);
  check('a turn on the spot is one too, as a Maneuver may be', moves.some((o) => o.tags.includes('pivot')), true);
  check('THE ENGINE TAKES IT: the Dune stands where it was steered, on the facing chosen, and the debt is spent',
    [x.send(one.commands), grid(x.U.Dune), x.U.Dune.facing, x.s.script.reactions.length], [[true], { c: 5, r: 3 }, 2, 0]);
  x.t.close();
}
{
  // No Crush: the Wolf stands beside the Dune, and no answer ends in its Grid.
  const x = await table({ Dancer: [5, 0, 2], Wolf: [5, 5, 2], Dune: [5, 6, 0], Sand: [11, 11, 0] });
  check('NO ANSWER IS A CRUSH: none ends in the Wolf\'s Grid beside it',
    [steers(x.d).length > 0, steers(x.d).some((o) => o.facts.to.c === 5 && o.facts.to.r === 5)], [true, false]);
  x.t.close();
}
{
  // Immobilized (6.3.2): nothing to steer.
  const x = await table({ Dancer: [5, 0, 2], Wolf: [8, 0, 2], Dune: [5, 6, 0], Sand: [11, 11, 0] });
  x.U.Dune.statuses = [...(x.U.Dune.statuses ?? []), 'immobilized'];
  const d = x.t.drivers.s1.pending();
  check('AN IMMOBILIZED UNIT IS NOT STEERED: leaving it be is the one answer', [d?.kind, d?.options.map((o) => o.id)], ['reaction.answer', ['decline']]);
  x.t.close();
}
{
  const x = await table({ Dancer: [5, 0, 2], Wolf: [8, 0, 2], Dune: [5, 6, 0], Sand: [11, 11, 0] });
  const only = (kinds) => M.SEAT.owed(data, x.s, 's1', M.SEAT.newMind(), { only: kinds });
  check('the reaction is asked first, whatever an asker names (as every reaction is)', only(['attack'])?.kind, 'reaction.answer');
  x.t.close();
}

// ---------- the Tactician ----------
{
  // The Dune far down the board, out of reach of both riflemen; its Sprint
  // can bring it up the column into their Range.
  const x = await table({ Dancer: [4, 0, 2], Wolf: [5, 0, 2], Dune: [5, 11, 0], Sand: [11, 11, 0] });
  const view = viewOf(x.s, 's1');
  const pick = AI.tacticianPolicy.choose(x.d, view, new AI.Rng('s'));
  const o = x.d.options.find((y) => y.id === pick.option);
  const from = apart(grid(x.U.Dune), grid(x.U.Wolf));
  check('THE TACTICIAN STEERS THE DUNE UP INTO ITS SQUAD\'S RANGE, its back to the riflemen',
    [pick.reason, o?.facts?.to ? apart(o.facts.to, grid(x.U.Wolf)) < from : null, o?.facts?.facing, pick.score > 0], ['steer_by_value', true, 2, true]);
  const off = AI.makeTactician({ steer: false }).choose(x.d, view, new AI.Rng('s'));
  check('with the skill off it is left be (the safe answer)', off.option ?? null, 'decline');
  x.t.close();
}
{
  // Out of every reach of this squad wherever it may be steered, and not its
  // squad's Commander: no Grid is worth more to this squad than another.
  const x = await table({ Dancer: [0, 0, 2], Wolf: [1, 0, 2], Dune: [11, 11, 0], Sand: [10, 11, 0] });
  const tk = M.TK.normaliseTasks(x.s.tasks);
  tk.leader.s2 = x.U.Sand.uid;
  x.s.tasks = tk;
  const d = x.t.drivers.s1.pending();
  const pick = AI.tacticianPolicy.choose(d, viewOf(x.s, 's1'), new AI.Rng('s'));
  check('WHERE NOTHING OF THIS SQUAD COULD REACH IT ANYWHERE, IT IS LEFT BE', [steers(d).length > 0, pick.option, pick.reason], [true, 'decline', 'steer_left']);
  x.t.close();
}
{
  // A unit destroyed before its Movement is made is steered nowhere.
  const x = await table({ Dancer: [5, 0, 2], Wolf: [8, 0, 2], Dune: [5, 6, 0], Sand: [11, 11, 0] });
  x.U.Dune.partStates = { ...x.U.Dune.partStates, torso: 'destroyed' };
  const d = x.t.drivers.s1.pending();
  check('A DESTROYED UNIT IS NOT STEERED', d ? steers(d).length : 0, 0);
  x.t.close();
}
{
  // The Dune already stands where both riflemen have it; nowhere it could be
  // steered is worse for it.
  const x = await table({ Dancer: [4, 0, 2], Wolf: [5, 0, 2], Dune: [5, 3, 0], Sand: [11, 11, 0] });
  const pick = AI.tacticianPolicy.choose(x.d, viewOf(x.s, 's1'), new AI.Rng('s'));
  check('WHERE THE DUNE STANDS IS ALREADY THE WORST FOR IT, IT IS LEFT BE, or steered to no better than where it stands',
    [pick.option === 'decline' ? 'decline' : pick.reason, pick.option === 'decline' || pick.score > 0], [pick.option === 'decline' ? 'decline' : 'steer_by_value', true]);
  x.t.close();
}

// ---------- the register ----------
{
  const cover = src('./aicover.mjs');
  check('the coverage register has the steering as an answer a seat gives', /controlledMove: \['seat'/.test(cover), true);
}

// ---------- whole games ----------
// The Dancer in whole games, five policies; and a seat that makes The Red
// Shoes whenever it is offered and steers by lot (the Tactician otherwise), so
// that the steering runs through the engine to the game's end.
const shoes = {
  name: 'shoes',
  choose(d, view, rng) {
    const ea = d.options.filter((o) => o.facts?.actionId === 'TM35NA_B' && o.tags[0] === 'electronic');
    if (ea.length) return { option: ea[Math.floor(rng.next() * ea.length)].id, why: 'The Red Shoes whenever it may' };
    const steer = d.options.filter((o) => o.tags.includes('control'));
    if (steer.length) return { option: steer[Math.floor(rng.next() * steer.length)].id, why: 'steered by lot' };
    return AI.tacticianPolicy.choose(d, view, rng);
  },
};
M.L.setLocalSeat(null);
{
  const games = { ...data.solo.scenarios[0], id: 't-control-games', seats: { s1: 's-shoes', s2: 's-gunners' } };
  const tally = { games: 0, over: 0, refused: 0, broken: [], steered: 0, shoes: 0 };
  for (const [policy, seeds] of [['legal', [1, 2]], ['eager', [1]], ['brawler', [1]], ['tactician', [1, 2]], ['shoes', [1, 2]]]) {
    for (const seed of seeds) {
      const t = botTable(M, data, games, { seed, policies: { s1: policy === 'shoes' ? shoes : AI[`${policy}Policy`], s2: AI.tacticianPolicy }, glue: M.HUD.glueAfter });
      t.watch((cmd) => { if (cmd.kind === 'controlledMove') tally.steered += 1; if (cmd.kind === 'performAction' && cmd.actionId === 'TM35NA_B') tally.shoes += 1; });
      let end;
      try { end = await t.run({ maxSteps: 16000 }); } catch (err) { end = { kind: 'threw', why: `${err?.message ?? err}`.split('\n')[0] }; } finally { t.close(); }
      tally.games += 1;
      if (end.kind === 'over') tally.over += 1; else tally.broken.push(`${policy} ${seed}: ${end.kind} ${end.why ?? ''} ${end.decision ?? ''}`);
      tally.refused += t.refused.length;
    }
  }
  check('EIGHT GAMES with The Red Shoes in them, on the page\'s glue, five policies: every one ends as a game should, nothing refused, and a unit was steered in them',
    [tally.over, tally.games, tally.refused, tally.broken, tally.shoes > 0, tally.steered > 0], [8, 8, 0, [], true, true]);
  console.log(`       The Red Shoes made ${tally.shoes}, units steered ${tally.steered}`);
}

console.log(`\n${pass} passed, ${fail} failed`);
M.L.setLocalSeat(null);
if (fail) process.exit(1);
