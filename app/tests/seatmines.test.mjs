// Auto Mine Laying, answered by a seat (006_A; FAQ M7, M29; AI-OPPONENT-PLAN.md,
// M8.2n).
//
// "When the mech Moves or Maneuvers, it may spend 1 move range to Lay 1 GM-35
// Anti-Armor Mine anywhere on the route." The Match Centre offers the Mines
// once a walk has landed, as many as the Range it left unspent pays for, a Grid
// of the route each, and keeps the offer in its Mine panel: the table records
// the route, not the Range left. A seat now does the same: a Movement answer
// carries the offer (`facts.lay`, read off turn.ts minesOnRoute, which the panel
// reads too), the driver that sends it remembers it (SeatMind.mines), and the
// seam asks `mine.lay` while it stands, one Mine at a time.
import { readFileSync } from 'node:fs';
import { botTable, loadEngine } from './_engine.mjs';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}\n       got  ${g}`); }
};

console.log('Auto Mine Laying\n');

const { M, data } = await loadEngine('seatmines', ["export * as SEAT from '../src/seat';", "export * as TURN from '../src/turn';", "export * as AI from '../src/ai/index';", "export * as HUD from '../src/matchhud';"]);
const AI = M.AI;
const T = M.TURN;
const viewOf = (state, seat) => M.SEAT.viewOf(data, state, seat);
const src = (f) => readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

// RDL: the Dune with the GLP-15 Mine Layer (006), and one without. UN: a
// rifleman, and two.
const rdl = (name, extra = {}) => ({ name, loadout: { torso: '533', chasis: '534', leftHand: '535', rightHand: '536', backpack: '006', pilot: 'FPA-04-2', ...extra } });
const rifle = (name) => ({ name, loadout: { torso: '539', chasis: '099', leftHand: '540', rightHand: '541', backpack: '538', pilot: 'LPA-23-2' } });
data.solo.squads['n-layer'] = { name: 'Layers', faction: 'RDL', points: 0, mechs: [rdl('Dune'), rdl('Sand', { backpack: '004' })], drones: [] };
data.solo.squads['n-rifles'] = { name: 'Riflemen', faction: 'UN', points: 0, mechs: [rifle('Wolf'), rifle('Cat')], drones: [] };
const scenario = { ...data.solo.scenarios[0], id: 't-mines', seats: { s1: 'n-layer', s2: 'n-rifles' } };

// A table past its setup, staged in the Action Phase on an open board, the
// Mech named on its Movement dial.
const table = async (who, where, policies = AI.tacticianPolicy) => {
  const t = botTable(M, data, { ...scenario, map: 'none' }, { seed: 3, policies, glue: M.HUD.glueAfter });
  await t.run({ until: (st) => M.SU.normaliseSetup(st.setup)?.stage === 'done' });
  const s = t.state;
  const U = Object.fromEntries(s.tokens.map((x) => [x.label, x]));
  const at = (x, c, r, f) => { x.col = c * 3; x.row = r * 3; if (f !== undefined) x.facing = f; };
  for (const [k, v] of Object.entries(where)) at(U[k], ...v);
  s.round.phase = 2; s.script.stage = '1:2'; s.script.opp = null; s.script.revealed = ['s1', 's2']; s.script.passed = [];
  for (const x of s.tokens) if (x.kind === 'mech') x.timing = 'firing';
  U[who].timing = 'movement';
  s.script.acted = s.tokens.filter((x) => x.kind === 'mech' && x.uid !== U[who].uid).map((x) => x.uid);
  M.G.opportunity(data, s);
  return { t, s, U, d: t.drivers.s1.pending() };
};
// The Dune and the Sand side by side, the riflemen far off down the board.
const BOARD = { Dune: [3, 3, 2], Sand: [6, 3, 2], Wolf: [4, 9, 0], Cat: [6, 10, 0] };
const sprint = (d, c, r) => d.options.find((o) => o.tags[0] === 'move' && o.facts?.actionId === '534_A' && o.facts.to.c === c && o.facts.to.r === r);

// ---------- the card and the count ----------
{
  const { t, s, U } = await table('Dune', BOARD);
  const a = data.byId.get('006').actions.find((x) => x.id === '006_A');
  const path = [{ c: 3, r: 3 }, { c: 3, r: 2 }, { c: 3, r: 1 }];
  const lay = T.minesOnRoute(data, s, U.Dune, path, 4, false);
  check('the card is what the test means it to be: 006_A Lays the GM-35 (074); a walk of two Grids on a Range of 4 leaves 2 for Mines, on the three Grids of its route',
    [M.U.projectileDelivery(a), data.byId.get('006').projectile, lay && { actionId: lay.actionId, cardId: lay.cardId, grids: lay.grids, max: lay.max }],
    ['lay', ['074'], { actionId: '006_A', cardId: '074', grids: path, max: 2 }]);
  check('a Mech with no Mine Layer Lays nothing; and the Match Centre\'s Mine panel reads the count from the same place',
    [T.minesOnRoute(data, s, U.Sand, path, 4, false), /const lay = turn\.minesOnRoute\(ctx\.data, ctx\.state, t, path, steps, flying\);/.test(src('matchhud.ts'))], [null, true]);
  t.close();
}

// ---------- the seam ----------
{
  const { t, U, d } = await table('Dune', BOARD);
  const two = sprint(d, 3, 1);
  const far = d.options.find((o) => o.tags[0] === 'move' && o.facts?.actionId === '534_A' && o.facts.grids === 4 && !o.tags.includes('take'));
  check('A MOVEMENT ANSWER CARRIES THE MINES ITS WALK MAY LAY: the Sprint of two Grids, 2 on its route; one that spends the whole Range, none',
    [two?.facts?.lay, far ? far.facts.lay ?? null : 'no such walk'],
    [{ uid: U.Dune.uid, actionId: '006_A', cardId: '074', grids: [{ c: 3, r: 3 }, { c: 3, r: 2 }, { c: 3, r: 1 }], max: 2, route: [{ c: 3, r: 3 }, { c: 3, r: 2 }, { c: 3, r: 1 }], flight: false }, null]);
  t.close();
}
{
  // Through two drivers: the walk taken, the Mines asked one at a time.
  const asked = [];
  // The first Mine in C3, and no second.
  const pick = (q) => (asked.length === 1 ? 'mine:3,2' : 'mine:none');
  const scripted = {
    name: 'scripted',
    choose(q, view, rng) {
      if (q.kind === 'opp.act' && !asked.length) { const w = sprint(q, 3, 1); if (w) return { option: w.id, why: 'scripted' }; }
      if (q.kind === 'mine.lay') { asked.push(q); return { option: pick(q) ?? q.fallback, why: 'scripted' }; }
      return { option: q.options.find((o) => o.tags.includes('end'))?.id ?? q.fallback, why: 'scripted' };
    },
  };
  const x = await table('Dune', BOARD, { s1: scripted, s2: AI.tacticianPolicy });
  const laid = [];
  x.t.watch((cmd) => { if (cmd.kind === 'layMine') laid.push(cmd); });
  await x.t.run({ until: (st) => asked.length >= 2 || st.script.opp?.uid !== x.U.Dune.uid, maxSteps: x.t.steps() + 40 });
  const [first, second] = asked;
  check('ONCE THE WALK HAS LANDED THE SEAT IS ASKED WHERE TO LAY: a Grid of the route each and none, its own Grid saying it goes off there, the none the safe answer',
    [first?.kind, first?.options.map((o) => o.id), first?.options.find((o) => o.id === 'mine:3,1')?.tags, first?.fallback, first?.facts],
    ['mine.lay', ['mine:3,3', 'mine:3,2', 'mine:3,1', 'mine:none'], ['mine', 'self'], 'mine:none', { left: 2, max: 2 }]);
  const mine = x.s.tokens.find((t) => t.mine);
  check('A MINE LAID is the command the Mine panel sends, in the Grid chosen, with the route walked; and the seat is asked again for the one the Range still pays for',
    [laid[0] && { kind: laid[0].kind, actionId: laid[0].actionId, cardId: laid[0].cardId, grid: [Math.floor(laid[0].to.col / 3), Math.floor(laid[0].to.row / 3)], route: laid[0].route.length },
      !!mine, second?.facts, x.t.refused],
    [{ kind: 'layMine', actionId: '006_A', cardId: '074', grid: [3, 2], route: 3 }, true, { left: 1, max: 2 }, []]);
  // None to the second: the seat forgets the offer, and the activation goes on.
  check('NONE forgets it: nothing more is laid, and the next question is the turn\'s own', [laid.length, x.t.drivers.s1.mind.mines, x.t.drivers.s1.pending()?.kind ?? 'none'], [1, null, 'opp.act']);
  x.t.close();
  // A memory that does not belong to the walk the table shows asks nothing.
  const y = await table('Dune', BOARD);
  const mind = M.SEAT.newMind();
  mind.mines = { uid: y.U.Dune.uid, actionId: '006_A', cardId: '074', grids: [{ c: 3, r: 3 }], max: 1, route: [{ c: 3, r: 3 }], flight: false, left: 1, walked: 'some other walk' };
  M.L.setLocalSeat('s1');
  check('an offer remembered of another walk, or of another unit, is asked of nobody',
    [M.SEAT.owed(data, y.s, 's1', mind)?.kind, M.SEAT.owed(data, y.s, 's1', { ...mind, mines: { ...mind.mines, walked: M.SEAT.walkedKey(y.s), uid: y.U.Sand.uid } })?.kind,
      M.SEAT.owed(data, y.s, 's1', { ...mind, mines: { ...mind.mines, walked: M.SEAT.walkedKey(y.s) } })?.kind],
    ['opp.act', 'opp.act', 'mine.lay']);
  M.L.setLocalSeat(null);
  y.t.close();
}

// ---------- the Tactician ----------
{
  const view = (s) => viewOf(s, 's1');
  const ask = (s, U, grids) => {
    const mind = M.SEAT.newMind();
    mind.mines = { uid: U.Dune.uid, actionId: '006_A', cardId: '074', grids, max: grids.length, route: grids, flight: false, left: grids.length, walked: M.SEAT.walkedKey(s) };
    M.L.setLocalSeat('s1');
    const q = M.SEAT.owed(data, s, 's1', mind);
    M.L.setLocalSeat(null);
    return q;
  };
  // The Dune has walked down the board towards the riflemen; the Sand stays
  // far back.
  const x = await table('Dune', { Dune: [3, 5, 2], Sand: [10, 0, 2], Wolf: [3, 9, 0], Cat: [6, 10, 0] });
  const q = ask(x.s, x.U, [{ c: 3, r: 3 }, { c: 3, r: 4 }, { c: 3, r: 5 }]);
  const pick = AI.tacticianPolicy.choose(q, view(x.s), new AI.Rng('m'));
  check('THE TACTICIAN LAYS WHERE AN ENEMY STANDS NEARER THAN ANY UNIT OF ITS OWN, the nearest to an enemy first; never in its own Grid',
    [pick.option, pick.reason], ['mine:3,4', 'mine_toward_enemy']);
  // The walk ran back behind the Sand: every Grid of it is nearer the squad.
  const back = await table('Dune', { Dune: [6, 1, 2], Sand: [6, 3, 2], Wolf: [4, 9, 0], Cat: [6, 10, 0] });
  const qb = ask(back.s, back.U, [{ c: 4, r: 1 }, { c: 5, r: 1 }, { c: 6, r: 1 }]);
  check('and keeps them where every Grid of the walk is nearer its own squad than the enemy',
    [AI.tacticianPolicy.choose(qb, view(back.s), new AI.Rng('m')).option, AI.tacticianPolicy.choose(qb, view(back.s), new AI.Rng('m')).reason], ['mine:none', 'mine_kept']);
  check('with its skill off (`mines`) it lays none, nor do the Brawler and the eager policy; the legal policy may, by lot',
    [AI.makeTactician({ mines: false }).choose(q, view(x.s), new AI.Rng('m')).option, AI.brawlerPolicy.choose(q, view(x.s), new AI.Rng('m')).option, AI.eagerPolicy.choose(q, view(x.s), new AI.Rng('m')).option],
    ['mine:none', 'mine:none', 'mine:none']);
  x.t.close(); back.t.close();
}

// ---------- whole games ----------
// The Tactician lays only where an enemy stands nearer than its own squad,
// which two Mechs that keep together seldom leave, so beside the four policies
// a seat that lays every Mine it is offered, on the first Grid not its own,
// plays: the Mines are then laid in whole games, to their end.
const layer = {
  name: 'layer',
  choose(d, view, rng) {
    const o = d.kind === 'mine.lay' ? d.options.find((x) => x.tags[0] === 'mine' && !x.tags.includes('self') && !x.tags.includes('none')) : undefined;
    return o ? { option: o.id, why: 'every Mine it may' } : AI.tacticianPolicy.choose(d, view, rng);
  },
};
M.L.setLocalSeat(null);
{
  const tally = { games: 0, over: 0, refused: 0, broken: [], laid: 0, asked: 0 };
  for (const [policy, seeds] of [['legal', [1, 2, 3]], ['eager', [1]], ['brawler', [1]], ['tactician', [1, 2, 3]], ['layer', [1, 2]]]) {
    for (const seed of seeds) {
      const t = botTable(M, data, scenario, { seed, policies: policy === 'layer' ? { s1: layer, s2: AI.tacticianPolicy } : AI[`${policy}Policy`], glue: M.HUD.glueAfter });
      t.watch((cmd) => { if (cmd.kind === 'layMine') tally.laid += 1; });
      let end;
      try {
        end = await t.run({ maxSteps: 16000, onStep: (seat, r) => { if (r.decision?.kind === 'mine.lay') tally.asked += 1; } });
      } catch (err) { end = { kind: 'threw', why: `${err?.message ?? err}`.split('\n')[0] }; } finally { t.close(); }
      tally.games += 1;
      if (end.kind === 'over') tally.over += 1; else tally.broken.push(`${policy} ${seed}: ${end.kind} ${end.why ?? ''} ${end.decision ?? ''}`);
      tally.refused += t.refused.length;
    }
  }
  check('TEN GAMES with a Mine Layer in them, on the page\'s glue, five policies: every one ends as a game should, nothing refused, the seat is asked where to lay, and Mines are laid',
    [tally.over, tally.games, tally.refused, tally.broken, tally.asked > 0, tally.laid > 0], [10, 10, 0, [], true, true]);
  console.log(`       asked ${tally.asked} times, Mines laid ${tally.laid}`);
}

console.log(`\n${pass} passed, ${fail} failed`);
M.L.setLocalSeat(null);
if (fail) process.exit(1);
