// Prototype Blink, answered by a seat (555_B; FAQ E17, E20; AI-OPPONENT-PLAN.md,
// M8.2k).
//
// The Taurus Experimental Core's Action exchanges the Mech's position with a
// Ground Mech of its own size within Range 4, enemy or allied: teleportation,
// so no route and nothing between matters, and Forced Movement, so the
// Taurus's squad sets both facings. The Match Centre asks it in a panel (the
// Mech, then each facing) and sends one command; the seam passed over it. Now
// it is an answer for each Mech and each pair of facings, and the Tactician
// plans it as a move to where the other Mech stood, on the table the exchange
// leaves.
import { botTable, loadEngine } from './_engine.mjs';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}\n       got  ${g}`); }
};

console.log('Prototype Blink\n');

const { M, data } = await loadEngine('seatblink', ["export * as SEAT from '../src/seat';", "export * as TURN from '../src/turn';", "export * as AI from '../src/ai/index';", "export * as HUD from '../src/matchhud';"]);
const AI = M.AI;
const T = M.TURN;
const viewOf = (state, seat) => M.SEAT.viewOf(data, state, seat);

// UN: the Taurus (the TM35BT Taurus Experimental Core) and a Wolf, with a
// Drone. RDL: two gunners.
const un = (name, torso = '539') => ({ name, loadout: { torso, chasis: '099', leftHand: '540', rightHand: '541', backpack: '538', pilot: 'LPA-23-2' } });
const rdl = (name) => ({ name, loadout: { torso: '533', chasis: '534', leftHand: '535', rightHand: '536', backpack: '004', pilot: 'FPA-04-2' } });
data.solo.squads['b-taurus'] = { name: 'Taurus', faction: 'UN', points: 0, mechs: [un('Taurus', '555'), un('Wolf')], drones: [{ cardId: 'PRDR-202' }] };
data.solo.squads['b-rdl'] = { name: 'Gunners', faction: 'RDL', points: 0, mechs: [rdl('Dune'), rdl('Sand')], drones: [] };
const scenario = { ...data.solo.scenarios[0], id: 't-blink', seats: { s1: 'b-taurus', s2: 'b-rdl' } };

// A table past its setup, staged in the Action Phase on an open board, the
// Taurus's Opportunity on its Movement dial.
const table = async (where, policies) => {
  const t = botTable(M, data, { ...scenario, map: 'none' }, { seed: 3, policies, glue: M.HUD.glueAfter });
  await t.run({ until: (st) => M.SU.normaliseSetup(st.setup)?.stage === 'done' });
  const s = t.state;
  const U = Object.fromEntries(s.tokens.map((x) => [x.kind === 'drone' ? 'Drone' : x.label, x]));
  const at = (x, c, r, f) => { x.col = c * 3; x.row = r * 3; if (f !== undefined) x.facing = f; };
  for (const [k, v] of Object.entries(where)) at(U[k], ...v);
  s.round.phase = 2; s.script.stage = '1:2'; s.script.opp = null; s.script.revealed = ['s1', 's2']; s.script.passed = [];
  for (const x of s.tokens) if (x.kind === 'mech') x.timing = 'firing';
  U.Taurus.timing = 'movement';
  s.script.acted = s.tokens.filter((x) => x.kind === 'mech' && x.uid !== U.Taurus.uid).map((x) => x.uid);
  M.G.opportunity(data, s);
  return { t, s, U, d: t.drivers.s1.pending() };
};
// The Wolf beside it, the Dune in front within Range 4, the Sand beyond it,
// the Drone at its side.
const NEAR = { Taurus: [4, 4, 2], Wolf: [2, 4, 2], Dune: [4, 7, 0], Sand: [4, 10, 0], Drone: [5, 5, 2] };
const blinks = (d) => (d?.options ?? []).filter((o) => o.tags[0] === 'blink');
const run = (s, commands) => commands.map((cmd) => { const v = M.C.check(data, s, cmd); if (v.ok) { M.C.apply(data, s, cmd); M.G.glueAfter(data, s, cmd); } return v.ok; });

// ---------- the card ----------
{
  const { s, U, t } = await table(NEAR);
  const a = data.byId.get('555').actions.find((x) => x.id === '555_B');
  check('the card is what the test means it to be: a Moving Action that exchanges positions, Range 4, opened by its own route; every Mech here is of one size',
    [M.U.isPositionSwap(a), a.type, a.range, T.actionRoute(data, U.Taurus, a), new Set(s.tokens.filter((x) => x.kind === 'mech').map((x) => x.size)).size], [true, 'Moving', 4, 'blink', 1]);
  t.close();
}

// ---------- the seam ----------
{
  const { s, U, t, d } = await table(NEAR);
  const all = blinks(d);
  const one = all.find((o) => o.facts.targetUid === U.Dune.uid && o.facts.facing === 0 && o.facts.targetFacing === 2);
  check('BLINK IS AN ANSWER FOR EACH MECH IN RANGE AND EACH PAIR OF FACINGS: the Wolf (an ally) and the Dune (an enemy), 16 each; not the Sand beyond Range 4, nor the Drone',
    [[...new Set(all.map((o) => o.facts.targetUid))].sort(), all.length, all.filter((o) => o.facts.targetUid === U.Dune.uid).length, new Set(all.map((o) => o.id)).size],
    [[U.Wolf.uid, U.Dune.uid].sort(), 32, 16, 32]);
  check('each is the Action paid for and the one command the Match Centre sends, weighed as a move to where the other Mech stands',
    [one?.tags, one?.commands, one?.facts],
    [['blink', 'enemy', 'facing:0'], [{ kind: 'performAction', seat: 's1', uid: U.Taurus.uid, actionId: '555_B', partKey: '555_B' }, { kind: 'blink', seat: 's1', uid: U.Taurus.uid, actionId: '555_B', targetUid: U.Dune.uid, facing: 0, targetFacing: 2 }],
      { uid: U.Taurus.uid, actionId: '555_B', targetUid: U.Dune.uid, to: { c: 4, r: 7 }, facing: 0, targetFacing: 2 }]);
  const was = { taurus: [U.Taurus.col, U.Taurus.row], dune: [U.Dune.col, U.Dune.row] };
  check('TAKEN, THE TWO EXCHANGE POSITIONS, each facing as chosen, the Action paid',
    [run(s, one.commands), [U.Taurus.col, U.Taurus.row], [U.Dune.col, U.Dune.row], [U.Taurus.facing, U.Dune.facing], s.script.opp.performed.includes('555_B')],
    [[true, true], was.dune, was.taurus, [0, 2], true]);
  M.L.setLocalSeat('s1');
  const again = await table(NEAR);
  check('it answers to the kind `blink`', M.SEAT.owed(data, again.s, 's1', M.SEAT.newMind(), { only: ['blink'] })?.options.length, 32);
  M.L.setLocalSeat(null);
  // An Immobilized unit performs no Movement Action, this one among them
  // (6.3.2): the engine refuses it, so the seat is not offered it.
  const stuck = await table(NEAR);
  stuck.U.Taurus.statuses = [...(stuck.U.Taurus.statuses ?? []), 'immobilized'];
  M.L.setLocalSeat('s1');
  check('AN IMMOBILIZED TAURUS IS OFFERED NO BLINK, the Mechs in Range notwithstanding', blinks(M.SEAT.owed(data, stuck.s, 's1', M.SEAT.newMind())).length, 0);
  M.L.setLocalSeat(null);
  stuck.t.close();
  const far = await table({ ...NEAR, Wolf: [9, 4, 2], Dune: [4, 9, 0] });
  const edge = await table({ ...NEAR, Wolf: [0, 4, 2], Dune: [4, 9, 0] });
  check('a Mech 5 Grids off is not offered it, one 4 off is', [blinks(far.d).length, [...new Set(blinks(edge.d).map((o) => o.facts.targetUid))]], [0, [edge.U.Wolf.uid]]);
  edge.t.close();
  for (const x of [t, again.t, far.t]) x.close();
}

// ---------- the Tactician ----------
{
  // The Dune holds a scoring zone (Echo) the Taurus stands outside of: the
  // exchange puts the Taurus in it and the Dune out.
  const ZONE = { Taurus: [5, 9, 2], Wolf: [1, 10, 2], Dune: [5, 6, 0], Sand: [10, 10, 0], Drone: [1, 9, 2] };
  const x = await table(ZONE, AI.tacticianPolicy);
  const view = viewOf(x.s, 's1');
  const pick = AI.tacticianPolicy.choose(x.d, view, new AI.Rng('t'));
  const o = x.d.options.find((y) => y.id === pick.option);
  const rows = AI.weighed(x.d, view, {});
  const swap = rows.find((r) => /places exchanged with Dune/.test(r.label));
  check('THE TACTICIAN PLANS A BLINK AS A MOVE TO WHERE THE OTHER MECH STOOD: an enemy holding a scoring zone is swapped out of it and the Taurus stands in it, worth more than any walk or shot',
    [o?.tags[0], o?.facts?.targetUid === x.U.Dune.uid, pick.reason, swap?.how, swap?.mission > 0, rows[0].label === swap?.label], ['blink', true, 'take_zone', 'move', true, true]);
  check('and it turns the enemy\'s back to where the Taurus will stand', o?.facts?.targetFacing, 2);
  // An ally exchanged with is set facing the enemy nearest where it will
  // stand: on the first board the Wolf goes where the Taurus stood, the Dune
  // south of it.
  const near = await table(NEAR, AI.tacticianPolicy);
  const wolf = AI.weighed(near.d, viewOf(near.s, 's1'), {}).find((r) => /places exchanged with Wolf/.test(r.label));
  check('an ally is set facing the enemy nearest where it will stand', /Wolf facing south$/.test(wolf?.label ?? ''), true);
  // The legal policy draws a Blink as it draws a Grid to move to: all of them
  // together are a place among the places, not thirty-two reasons to blink.
  const drawn = Array.from({ length: 200 }, (_, i) => AI.legalPolicy.choose(near.d, viewOf(near.s, 's1'), new AI.Rng(`l${i}`)).option).filter((id) => id.startsWith('blink')).length;
  check('and the legal policy draws the Blinks as places, as it draws the Grids of a move (a few in two hundred draws)', drawn < 40, true);
  near.t.close();
  const off = AI.makeTactician({ blink: false });
  const rowsOff = AI.weighed(x.d, view, { blink: false });
  check('with its skill off (`blink`) no plan is a Blink, and the Brawler and the eager policy never take one; the legal policy may, by lot',
    [off.choose(x.d, view, new AI.Rng('t')).option.startsWith('blink'), rowsOff.some((r) => /places exchanged/.test(r.label)),
      AI.brawlerPolicy.choose(x.d, view, new AI.Rng('t')).option.startsWith('blink'), AI.eagerPolicy.choose(x.d, view, new AI.Rng('t')).option.startsWith('blink')],
    [false, false, false, false]);
  x.t.close();
}

// ---------- whole games ----------
// The policies that draw by lot draw a Blink seldom, and the more answers the
// seam offers the more seldom (a Crush of a Unit, M8.2p, took the last of
// them), so beside the four a seat that takes every Blink it is offered plays,
// by lot among them, and is the Tactician otherwise: places are then exchanged
// in whole games, to their end.
const blinker = {
  name: 'blinker',
  choose(d, view, rng) {
    const xs = d.options.filter((o) => o.tags[0] === 'blink');
    return xs.length ? { option: xs[Math.floor(rng.next() * xs.length)].id, why: 'every Blink it may' } : AI.tacticianPolicy.choose(d, view, rng);
  },
};
M.L.setLocalSeat(null);
{
  const tally = { games: 0, over: 0, refused: 0, broken: [], blinks: 0 };
  for (const [policy, seeds] of [['legal', [1, 2]], ['eager', [1]], ['brawler', [1]], ['tactician', [1, 2]], ['blinker', [1, 2]]]) {
    for (const seed of seeds) {
      const t = botTable(M, data, scenario, { seed, policies: policy === 'blinker' ? { s1: blinker, s2: AI.tacticianPolicy } : AI[`${policy}Policy`], glue: M.HUD.glueAfter });
      t.watch((cmd) => { if (cmd.kind === 'blink') tally.blinks += 1; });
      let end;
      try { end = await t.run({ maxSteps: 16000 }); } catch (err) { end = { kind: 'threw', why: `${err?.message ?? err}`.split('\n')[0] }; } finally { t.close(); }
      tally.games += 1;
      if (end.kind === 'over') tally.over += 1; else tally.broken.push(`${policy} ${seed}: ${end.kind} ${end.why ?? ''} ${end.decision ?? ''}`);
      tally.refused += t.refused.length;
    }
  }
  check('EIGHT GAMES with a Taurus in them, on the page\'s glue, five policies: every one ends as a game should, nothing refused, and places were exchanged in them',
    [tally.over, tally.games, tally.refused, tally.broken, tally.blinks > 0], [8, 8, 0, [], true]);
  console.log(`       Blinks made ${tally.blinks}`);
}

console.log(`\n${pass} passed, ${fail} failed`);
M.L.setLocalSeat(null);
if (fail) process.exit(1);
