// An Interception owed, and a seat that answers it (rulebook 4.9;
// AI-OPPONENT-PLAN.md, M8.2a).
//
// A Launch, a Missile's flight and an Aerial unit's Movement each owe the
// other squad's interceptors their attempts, made at once and before play goes
// on. The Match Centre asks for them in a panel; a computer seat is asked by
// owed(), from the same readings (turn.ts interceptSide, interceptPayment,
// interceptAgain, interceptsForMove). The first random-squad games found the
// debt queued by the seam's own launch and asked of nobody, which left the
// table waiting for good. This stages each way the debt arises on the real
// engine, pins who is asked and what the answers send, and then plays whole
// games with an interceptor in them.
import { botTable, loadEngine, tableAtRoundOne } from './_engine.mjs';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}\n       got  ${g}`); }
};

console.log('An Interception owed\n');

const { M, data } = await loadEngine('seatintercept', ["export * as SEAT from '../src/seat';", "export * as TURN from '../src/turn';", "export * as AI from '../src/ai/index';"]);
const { owed, newMind } = M.SEAT;
const T = M.TURN;
const clone = (x) => JSON.parse(JSON.stringify(x));
const src = async (f) => (await import('node:fs')).readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

// A Missile Rack and an AMS on one side; a CIWS Drone, a Raven and a KK9 on the
// other. RDL launches at UN's interceptor, and UN flies past RDL's. Only the
// KK9 stands on an Aerial base: a Raven is a Flying unit, which is not one.
data.solo.squads['t-rack'] = {
  name: 'Rack', faction: 'RDL', points: 0,
  mechs: [
    { name: 'Mire', loadout: { torso: '533', chasis: '534', leftHand: '535', rightHand: '536', backpack: '004', pilot: 'FPA-04-2' } },
    { name: 'Dune', loadout: { torso: '014', chasis: '020', leftHand: '032', rightHand: '033', backpack: '003', pilot: 'FPA-63' } },
  ],
  drones: [],
};
data.solo.squads['t-ciws'] = {
  name: 'CIWS', faction: 'UN', points: 0,
  mechs: [{ name: 'Wild Cat', loadout: { torso: '539', chasis: '099', leftHand: '540', rightHand: '541', backpack: '538', pilot: 'LPA-23-2' } }],
  drones: [{ cardId: '160' }, { cardId: '166' }, { cardId: 'LHDR-KK9' }],
};
const scenario = { ...data.solo.scenarios[0], id: 't-intercept', seats: { s1: 't-rack', s2: 't-ciws' } };

const run = (state, cmd) => {
  const v = M.C.check(data, state, cmd);
  if (v.ok) { M.C.apply(data, state, cmd); M.G.glueAfter(data, state, cmd); }
  return v;
};
const sendAll = (state, commands) => commands.map((c) => run(state, c).ok);
const ids = (d) => (d ? d.options.map((o) => o.id) : null);
const asked = (state) => ['s1', 's2'].map((seat) => owed(data, state, seat, newMind())?.kind ?? null);
const name = (t) => (t.cardId === '160' ? 'CIWS' : t.cardId === '166' ? 'Raven' : t.cardId === 'LHDR-KK9' ? 'KK9' : t.label);

const base = (() => {
  const t = tableAtRoundOne(M, data, scenario);
  if (t.refused.length) throw new Error(t.refused.join('; '));
  return t.state;
})();
// The table at a phase, with no terrain, every unit where the test wants it.
const stage = (phase) => {
  const s = clone(base);
  s.map = 'none';
  const U = Object.fromEntries(s.tokens.map((t) => [name(t), t]));
  const at = (t, c, r, f) => { t.col = c * 3; t.row = r * 3; if (f !== undefined) t.facing = f; };
  at(U.Mire, 5, 4, 2); at(U.Dune, 0, 0, 2); at(U['Wild Cat'], 11, 11, 0); at(U.CIWS, 5, 8, 0); at(U.Raven, 11, 0, 3); at(U.KK9, 11, 2, 3);
  s.round.phase = phase; s.script.stage = `1:${phase}`; s.script.acted = []; s.script.passed = []; s.script.opp = null;
  if (phase >= 2) { s.script.revealed = ['s1', 's2']; for (const t of s.tokens) if (t.kind === 'mech') t.timing = 'firing'; }
  const turnOf = (mech, timing) => {
    mech.timing = timing ?? mech.timing;
    s.script.acted = s.tokens.filter((x) => x.kind === 'mech' && x.uid !== mech.uid).map((x) => x.uid);
    s.script.opp = null;
    return M.G.opportunity(data, s);
  };
  const activate = (unit) => { s.script.opp = M.TY.newOpportunity(unit.uid, undefined); return s.script.opp; };
  return { s, U, at, turnOf, activate };
};
M.L.setLocalSeat('s1');

// ---------- a Launch owes it, and the other squad is asked ----------
{
  const { s, U, turnOf } = stage(2);
  check('the squads are what the test means them to be: an interceptor on each side with its Tokens, and one Aerial unit (a Raven flies, and is not one)',
    [U.CIWS.intercept, U.Dune.intercept, U.KK9.aerial, U.Raven.aerial, U.CIWS.aerial], [{ '160_A': 3 }, { '003_A': 3 }, true, false, false]);
  check('with nothing owed nobody is asked for an Interception, and no side is named', [T.interceptSide(s), M.C.liveIntercepts(s)], [null, []]);
  turnOf(U.Mire, 'projectile');
  const d = owed(data, s, 's1', newMind());
  const launches = d.options.filter((o) => o.tags[0] === 'launch');
  // The CIWS stands four Grids south of the Mire and reaches four: every
  // Landing Point is within its Range of the Grid launched from.
  check('a launch inside an interceptor\'s reach carries the debt it owes: the last command of the answer, one attempt for the Projectile it puts down',
    [launches.length > 0, launches.every((o) => o.commands.at(-1).kind === 'queueIntercepts' && o.commands.at(-1).items.length === 1 && o.commands.at(-1).items[0].uid === U.CIWS.uid)],
    [true, true]);
  check('and the answer says so, for a reader that never opens the commands', [launches.every((o) => o.facts.intercepts === 1 && o.tags.includes('intercepted'))], [true]);
  const shot = launches.find((o) => o.facts.to.c === 5 && o.facts.to.r === 6);
  check('it is taken as it is offered', sendAll(s, shot.commands).every(Boolean), true);
  const missile = s.tokens.find((t) => t.kind === 'projectile');
  check('the Missile is on the board and the attempt at it is owed', [!!missile, s.script.intercepts], [true, [{ uid: U.CIWS.uid, actionId: '160_A', targetUid: missile.uid }]]);
  check('THE OTHER SQUAD IS ASKED AT ONCE, and the squad that launched waits, its Opportunity still open',
    [asked(s), T.interceptSide(s), s.script.opp.uid], [[null, 'intercept.attempt'], 's2', U.Mire.uid]);
  const q = owed(data, s, 's2', newMind());
  check('one answer for each attempt it can make; on a table that holds every rule there is no declining (M5)', [ids(q), q.fallback], [[`intercept:${U.CIWS.uid}:160_A:${missile.uid}`], `intercept:${U.CIWS.uid}:160_A:${missile.uid}`]);
  const o = q.options[0];
  check('the answer is an attack in Interception mode, by the unit that owes it, on the Projectile',
    [o.run.routine, o.run.args.mode, o.run.args.uid, o.run.args.targetUid, o.run.args.actionId, o.tags], ['attack', 'intercept', U.CIWS.uid, missile.uid, '160_A', ['intercept', 'attack']]);
  check('paid for before it opens: the Token, then the debt settled (Tokens are left behind the one spent)',
    o.run.args.before, [{ kind: 'spendIntercept', seat: 's2', uid: U.CIWS.uid, actionId: '160_A' }, { kind: 'resolveIntercept', seat: 's2', uid: U.CIWS.uid, actionId: '160_A', targetUid: missile.uid }]);
  check('which is the reading the Match Centre\'s panel sends (turn.ts interceptPayment)', T.interceptPayment(data, s, s.script.intercepts[0]), o.run.args.before);
  check('the engine takes both', sendAll(s, o.run.args.before), [true, true]);
  check('a Token is gone, nothing is owed, and the turn goes on where it stood', [U.CIWS.intercept['160_A'], s.script.intercepts, asked(s)], [2, [], ['opp.act', null]]);

  // What the attempt leaves owed, once its attack is over.
  const item = { uid: U.CIWS.uid, actionId: '160_A', targetUid: missile.uid };
  const again = T.interceptAgain(data, s, item);
  check('a target that survived is owed the SAME attempt again while that Part has Tokens',
    [again.why, again.left, again.command], ['again', 2, { kind: 'queueIntercepts', seat: 's2', items: [item] }]);
  const spent = clone(s);
  spent.tokens.find((t) => t.uid === U.CIWS.uid).intercept['160_A'] = 0;
  check('not once its Tokens are spent', [T.interceptAgain(data, spent, item).why, T.interceptAgain(data, spent, item).command], ['spent', null]);
  const dead = clone(s);
  dead.tokens.find((t) => t.uid === U.CIWS.uid).partStates.main = 'destroyed';
  check('nor when the interceptor is gone: the obligation died with it', [T.interceptAgain(data, dead, item).why, T.interceptAgain(data, dead, item).command], ['gone', null]);
  const hit = clone(s);
  hit.tokens = hit.tokens.filter((t) => t.uid !== missile.uid);
  check('and a target destroyed ends the chain', [T.interceptAgain(data, hit, item).why, T.interceptAgain(data, hit, item).command, T.interceptAgain(data, hit, item).left], ['destroyed', null, 2]);

  // Owed again: the same question comes back, a Token fewer.
  run(s, again.command);
  const q2 = owed(data, s, 's2', newMind());
  check('owed again, it is asked again, and it is a new question', [asked(s), ids(q2), q2.id === q.id], [[null, 'intercept.attempt'], ids(q), false]);
  sendAll(s, q2.options[0].run.args.before);
  run(s, T.interceptAgain(data, s, item).command);
  const last = owed(data, s, 's2', newMind());
  check('THE LAST TOKEN settles the debt by itself: spending it strikes the attempt off (B2), so nothing is sent after it',
    [U.CIWS.intercept['160_A'], last.options[0].run.args.before], [1, [{ kind: 'spendIntercept', seat: 's2', uid: U.CIWS.uid, actionId: '160_A' }]]);
  check('the engine agrees: one command, and the debt is gone', [sendAll(s, last.options[0].run.args.before), s.script.intercepts, U.CIWS.intercept['160_A']], [[true], [], 0]);
  check('with every Token spent nothing is owed again, and nobody is asked', [T.interceptAgain(data, s, item).why, asked(s)], ['spent', ['opp.act', null]]);
  check('an attempt whose unit has left the table costs nothing and sends nothing', T.interceptPayment(data, s, { uid: 4242, actionId: '160_A', targetUid: missile.uid }), null);
}

// ---------- who is asked, when both squads owe, and what cannot be made ----------
{
  const { s, U, turnOf } = stage(2);
  turnOf(U.Mire, 'projectile');
  const shot = owed(data, s, 's1', newMind()).options.find((o) => o.tags[0] === 'launch' && o.facts.to.c === 5 && o.facts.to.r === 6);
  sendAll(s, shot.commands);
  const missile = s.tokens.find((t) => t.kind === 'projectile');
  // An attempt of the OTHER squad's queued behind it.
  s.script.intercepts.push({ uid: U.Dune.uid, actionId: '003_A', targetUid: U.KK9.uid });
  check('with both squads owing, the squad that owes the FIRST is asked, and the other waits its turn', [T.interceptSide(s), asked(s)], ['s2', [null, 'intercept.attempt']]);
  check('and it is offered its own attempts alone', ids(owed(data, s, 's2', newMind())), [`intercept:${U.CIWS.uid}:160_A:${missile.uid}`]);
  s.script.intercepts.reverse();
  check('the order is the order they were owed in', [T.interceptSide(s), asked(s), ids(owed(data, s, 's1', newMind()))], ['s1', ['intercept.attempt', null], [`intercept:${U.Dune.uid}:003_A:${U.KK9.uid}`]]);
  s.script.intercepts.reverse();
  s.script.intercepts.pop();
  // A debt that can no longer be made stands ahead of one that can.
  const mixed = clone(s);
  mixed.script.intercepts = [{ uid: U.Dune.uid, actionId: '003_A', targetUid: 4242 }, ...mixed.script.intercepts];
  check('a debt that can no longer be made, ahead of one that can, names nobody: the squad asked is the one that owes the first attempt still LIVE',
    [T.interceptSide(mixed), asked(mixed)], ['s2', [null, 'intercept.attempt']]);

  // A debt nobody can pay is no debt: the engine's own reading of what can still be made.
  const shut = clone(s);
  shut.tokens.find((t) => t.uid === U.CIWS.uid).statuses = ['fci'];
  check('an interceptor under Fire Control Interference owes nothing it can make: the turn goes on', [M.C.liveIntercepts(shut), asked(shut)], [[], ['opp.act', null]]);
  const gone = clone(s);
  gone.tokens = gone.tokens.filter((t) => t.uid !== missile.uid);
  check('nor does a target that has left the board hold the table', [M.C.liveIntercepts(gone), asked(gone)], [[], ['opp.act', null]]);

  // The same attempt owed twice over (a Volley of two at one Part) is one answer.
  s.script.intercepts.push({ ...s.script.intercepts[0] });
  check('the same attempt owed twice is offered once', ids(owed(data, s, 's2', newMind())).length, 1);
  s.script.intercepts.pop();

  // A table that does not hold every rule may drop the debt.
  M.L.setLocalSeat(null);
  const loose = clone(s);
  loose.script.strict = false;
  const d = owed(data, loose, 's2', newMind());
  check('on a table that lets a debt be dropped, making none is offered beside the attempt, and the attempt is still the safe answer',
    [ids(d), d.fallback, d.options[1].commands, d.options[1].tags], [[`intercept:${U.CIWS.uid}:160_A:${missile.uid}`, 'skip'], `intercept:${U.CIWS.uid}:160_A:${missile.uid}`, [{ kind: 'clearIntercepts', seat: 's2' }], ['intercept', 'decline']]);
  M.L.setLocalSeat('s1');

  // An attack on the table is rolled out before anything else is asked.
  const mid = clone(s);
  mid.script.intercepts = [];
  mid.script.combatView = { attackerUid: U.CIWS.uid, targetUid: missile.uid, actionId: '160_A', step: 'attack' };
  check('WHILE AN ATTACK IS ON THE TABLE neither seat is asked anything of the turn: the launcher does not act on while the Interception is rolled',
    [asked(mid), asked({ ...mid, script: { ...mid.script, combatView: null } })], [[null, null], ['opp.act', null]]);
}

// ---------- an Aerial unit's Movement owes it ----------
{
  const { s, U, at, activate } = stage(0);
  // The KK9 two Grids from the Dune's AMS, which reaches three.
  at(U.Dune, 5, 5, 0); at(U.KK9, 5, 7, 0);
  s.script.turn = 's2';
  activate(U.KK9);
  const d = owed(data, s, 's2', newMind());
  const moves = d.options.filter((o) => o.tags.includes('move') && !o.tags.includes('pivot'));
  const owes = moves.filter((o) => o.commands.at(-1).kind === 'queueIntercepts');
  check('a commanded Aerial Drone moving within an interceptor\'s reach sends what its Movement owes with the move', [moves.length > 8, owes.length > 0], [true, true]);
  // Held to the reading the page makes once the move has landed: the copy it
  // takes of an Aerial unit before the move, and nothing for any other unit.
  const landedFor = (table, unit, option) => T.interceptsAfterMove(data, M.G.tableAfter(data, table, option.commands.filter((c) => c.kind !== 'queueIntercepts')), unit.aerial ? clone(unit) : null, unit.uid);
  const wrongIn = (table, unit, options) => options.filter((o) => {
    const landed = landedFor(table, unit, o);
    const sent = o.commands.at(-1).kind === 'queueIntercepts' ? o.commands.at(-1).items : [];
    return JSON.stringify(landed) !== JSON.stringify(sent) || (o.facts.intercepts ?? 0) !== landed.length || o.tags.includes('intercepted') !== landed.length > 0;
  }).map((o) => o.id);
  check('for EVERY Grid it could move to, what is sent is what the page would queue once the move had landed (turn.ts interceptsAfterMove), and the answer says how many', wrongIn(s, U.KK9, moves), []);
  // It starts inside the AMS's reach, so every move owes: judged at the Grid it leaves too (FAQ O11).
  check('it is judged at the Grid it leaves as well as the one it lands in: starting inside the reach, every move owes one attempt', [owes.length, owes.every((o) => o.facts.intercepts === 1)], [moves.length, true]);
  check('a turn on the spot is no flight: it owes nothing', d.options.filter((o) => o.tags.includes('pivot')).every((o) => o.commands.every((c) => c.kind !== 'queueIntercepts')), true);
  // Starting out of reach: only the moves that END inside it owe.
  const edge = stage(0);
  edge.s.script.turn = 's2';
  edge.at(edge.U.Dune, 5, 5, 0); edge.at(edge.U.KK9, 5, 10, 0);
  edge.activate(edge.U.KK9);
  const some = owed(data, edge.s, 's2', newMind()).options.filter((o) => o.tags.includes('move') && !o.tags.includes('pivot'));
  const inReach = (o) => Math.abs(o.facts.to.c - 5) + Math.abs(o.facts.to.r - 5) <= 3;
  check('starting out of reach, the moves that land inside it owe and the others do not',
    [some.some(inReach), some.some((o) => !inReach(o)), some.filter((o) => inReach(o) !== o.tags.includes('intercepted')).map((o) => o.id), wrongIn(edge.s, edge.U.KK9, some)], [true, true, [], []]);
  const far = stage(0);
  far.s.script.turn = 's2';
  far.at(far.U.Dune, 0, 0, 0); far.at(far.U.KK9, 9, 9, 0);
  far.activate(far.U.KK9);
  const free = owed(data, far.s, 's2', newMind()).options.filter((o) => o.tags.includes('move'));
  check('out of every interceptor\'s reach at both ends, a move owes nothing', [free.length > 8, free.every((o) => o.commands.length === 1 && !('intercepts' in o.facts))], [true, true]);
  const o = owes[0];
  check('taken, the debt is the other squad\'s, at once, in the middle of the Command Phase', [sendAll(s, o.commands).every(Boolean), asked(s), ids(owed(data, s, 's1', newMind()))],
    [true, ['intercept.attempt', null], [`intercept:${U.Dune.uid}:003_A:${U.KK9.uid}`]]);
  // A Flying unit is not an Aerial one, and a unit on the ground still less.
  for (const [label, who] of [['a Raven, which flies but stands on no Aerial base,', 'Raven'], ['a Drone on the ground', 'CIWS']]) {
    const g = stage(0);
    g.s.script.turn = 's2';
    g.at(g.U.Dune, 5, 5, 0); g.at(g.U[who], 5, 7, 0);
    g.activate(g.U[who]);
    const walk = owed(data, g.s, 's2', newMind()).options.filter((x) => x.tags.includes('move'));
    check(`${label} owes nothing by moving past the same interceptor`, [walk.length > 8, walk.every((x) => x.commands.every((c) => c.kind !== 'queueIntercepts')), wrongIn(g.s, g.U[who], walk)], [true, true, []]);
  }
  check('and the reading itself says so: no Movement but an Aerial unit\'s',
    [T.interceptsForMove(data, s, U.CIWS, { col: 15, row: 18 }), T.interceptsForMove(data, s, U.Raven, { col: 15, row: 18 }), T.interceptsForMove(data, s, U.KK9, { col: 15, row: 18 }).length], [[], [], 1]);
  // No Tokens on the other side: nothing is worked out at all.
  const dry = stage(0);
  dry.s.script.turn = 's2';
  dry.at(dry.U.Dune, 5, 5, 0); dry.at(dry.U.KK9, 5, 7, 0);
  dry.U.Dune.intercept['003_A'] = 0;
  dry.activate(dry.U.KK9);
  check('an interceptor with no Token left is owed nothing', owed(data, dry.s, 's2', newMind()).options.filter((x) => x.tags.includes('move')).every((x) => x.commands.length === 1), true);
}

// ---------- a Missile's flight owes it ----------
{
  const { s, U, at, turnOf } = stage(2);
  // Launched from out of the CIWS's reach, to a Grid out of it too; the Wild
  // Cat is the Missile's target, and the CIWS stands beside the Wild Cat.
  at(U.Mire, 5, 1, 2); at(U['Wild Cat'], 5, 6, 0); at(U.CIWS, 8, 6, 0);
  turnOf(U.Mire, 'projectile');
  const shot = owed(data, s, 's1', newMind()).options.find((o) => o.tags[0] === 'launch' && o.facts.to.c === 5 && o.facts.to.r === 3);
  check('launched out of reach of every interceptor, the launch owes nothing', [shot.commands.some((c) => c.kind === 'queueIntercepts'), 'intercepts' in shot.facts], [false, false]);
  sendAll(s, shot.commands);
  const missile = s.tokens.find((t) => t.kind === 'projectile');
  // Its own turn: the Delay Phase.
  s.round.phase = 4; s.script.stage = '1:4'; s.script.acted = []; s.script.passed = []; s.script.turn = 's1';
  s.script.opp = M.TY.newOpportunity(missile.uid, undefined);
  const d = owed(data, s, 's1', newMind());
  const boom = d.options.find((o) => o.tags.includes('detonate') && o.facts.targetUid === U['Wild Cat'].uid);
  check('its flight into its target\'s Grid passes the CIWS: the answer is the payment, the flight and the debt, and the Explosion WAITS',
    [boom.run.routine, boom.run.args.waits, boom.run.args.before.map((c) => c.kind), boom.facts.intercepts, boom.tags.includes('intercepted')],
    ['attack', true, ['performAction', 'flyToTarget', 'queueIntercepts'], 1, true]);
  check('what it owes is what the page would queue for that flight (turn.ts detonationFlight)',
    boom.run.args.before[2].items, T.detonationFlight(data, s, missile, M.TURN.actionOf(data, s, missile, boom.facts.actionId), U['Wild Cat']).owed);
  check('the engine takes all three', sendAll(s, boom.run.args.before), [true, true, true]);
  check('the Missile is in its target\'s Grid, and the other squad\'s attempt comes first: the Missile\'s squad waits',
    [[Math.floor(missile.col / 3), Math.floor(missile.row / 3)], asked(s)], [[5, 6], [null, 'intercept.attempt']]);
  const q = owed(data, s, 's2', newMind());
  // The attempt is made and misses; the CIWS is left one Token, so that is the end of it.
  U.CIWS.intercept['160_A'] = 1;
  sendAll(s, owed(data, s, 's2', newMind()).options[0].run.args.before);
  check('the attempt made and its Tokens spent, nothing more is owed', [q.kind, s.script.intercepts, T.interceptAgain(data, s, { uid: U.CIWS.uid, actionId: '160_A', targetUid: missile.uid }).why], ['intercept.attempt', [], 'spent']);
  const after = owed(data, s, 's1', newMind());
  const blast = after.options.find((o) => o.tags.includes('detonate'));
  check('THE MISSILE THAT CAME THROUGH is asked again, its Action already paid: the Explosion on the unit it flew at, with nothing more to send before it',
    [after.kind, ids(after), blast.run.args.before, blast.run.args.waits, blast.run.args.mode, blast.facts.targetUid], ['activation.act', [`detonate:${blast.id.split(':')[1]}:${U['Wild Cat'].uid}`, 'end'], [], undefined, 'explosion', U['Wild Cat'].uid]);
  check('an asker that wants the attacks alone is given it', ids(owed(data, s, 's1', newMind(), { only: ['attack'] })), [blast.id]);
  // The unit it flew at has left that Grid.
  const left = clone(s);
  const cat = left.tokens.find((t) => t.uid === U['Wild Cat'].uid);
  cat.col = 0; cat.row = 0;
  const lost = owed(data, left, 's1', newMind());
  check('with the unit it flew at gone from that Grid it has nothing left to take: it is destroyed, or its activation ended',
    [ids(lost), lost.options[0].commands], [[`detonate:${blast.id.split(':')[1]}:none`, 'end'], [{ kind: 'despawn', seat: 's1', uid: missile.uid, targetUid: missile.uid }]]);
  // A Missile destroyed on the way asks nothing.
  const shotDown = clone(s);
  shotDown.tokens = shotDown.tokens.filter((t) => t.uid !== missile.uid);
  M.G.glueAfter(data, shotDown, { kind: 'despawn', seat: 's1', uid: missile.uid, targetUid: missile.uid });
  check('a Missile shot down on the way leaves no question behind it that cannot be answered',
    ['s1', 's2'].map((seat) => { const x = owed(data, shotDown, seat, newMind()); return x ? x.options.length > 0 : true; }), [true, true]);
}
{
  // A flight nobody can intercept is as it always was.
  const { s, U, at, turnOf } = stage(2);
  at(U.Mire, 5, 1, 2); at(U['Wild Cat'], 5, 6, 0); at(U.CIWS, 11, 0, 0);
  turnOf(U.Mire, 'projectile');
  sendAll(s, owed(data, s, 's1', newMind()).options.find((o) => o.tags[0] === 'launch' && o.facts.to.c === 5 && o.facts.to.r === 3).commands);
  const missile = s.tokens.find((t) => t.kind === 'projectile');
  s.round.phase = 4; s.script.stage = '1:4'; s.script.acted = []; s.script.passed = []; s.script.turn = 's1';
  s.script.opp = M.TY.newOpportunity(missile.uid, undefined);
  const boom = owed(data, s, 's1', newMind()).options.find((o) => o.tags.includes('detonate'));
  check('a flight no interceptor reaches is the attack it always was: paid, flown and exploded in one answer',
    [boom.run.args.before.map((c) => c.kind), 'waits' in boom.run.args, 'intercepts' in boom.facts, boom.tags], [['performAction', 'flyToTarget'], false, false, ['detonate', 'attack', 'explosion']]);
}

// ---------- the panel reads the same readings ----------
{
  const hud = await src('matchhud.ts');
  const bot = await src('ai/botcombat.ts');
  const seam = await src('owed.ts');
  check('the Match Centre\'s panel takes who is asked, what an attempt sends and what it leaves owed from turn.ts, where a seat with no panel reads them too',
    [/return turn\.interceptSide\(ctx\.state\);/.test(hud), /const order = turn\.interceptPayment\(ctx\.data, s, item\);/.test(hud), /const next = turn\.interceptAgain\(ctx\.data, s, f\);/.test(hud),
      /kind: 'spendIntercept'/.test(hud.slice(hud.indexOf("on('[data-intercept]'"), hud.indexOf("on('[data-inttarget]'")))], [true, true, true, false]);
  check('the computer\'s window queues the attempt owed again as its attack ends, by that same reading',
    [/this\.intercepting = a\.mode === 'intercept' \? \{ uid: a\.uid, actionId: a\.actionId, targetUid: a\.targetUid \} : null;/.test(bot),
      /const next = interceptAgain\(this\.host\.data, this\.host\.state\(\), attempt\);\n\s+if \(next\.command\) this\.host\.send\(next\.command\);/.test(bot)], [true, true]);
  check('and the question sits above the phase, below the Counter-roll and an attack on the table',
    /if \(state\.script\.counter\) return null;[\s\S]{0,700}if \(state\.script\.combatView\) return null;[\s\S]{0,600}if \(liveIntercepts\(state\)\.length\) return interceptOwed\(data, state, seat\);\n[\s\S]{0,1300}const phase = PHASES\[state\.round\.phase\];/.test(seam), true);
}

// ---------- whole games with interceptors in them ----------
M.L.setLocalSeat(null);
{
  const tally = { games: 0, over: 0, spent: 0, again: 0, flights: 0, refused: 0, broken: [] };
  for (const policy of ['legal', 'eager', 'brawler']) {
    for (const seed of [1, 2, 3]) {
      const t = botTable(M, data, scenario, { seed, policies: M.AI[`${policy}Policy`] });
      let end;
      try { end = await t.run({ maxSteps: 9000 }); } catch (err) { end = { kind: 'threw', why: err.message }; } finally { t.close(); }
      tally.games += 1;
      if (end.kind === 'over') tally.over += 1; else tally.broken.push(`${policy} ${seed}: ${end.kind} ${end.why ?? ''}`);
      tally.refused += t.refused.length;
      tally.spent += t.sent.filter((x) => x.kind === 'spendIntercept').length;
      tally.flights += t.sent.filter((x) => x.kind === 'flyToTarget').length;
      // An attempt owed again is queued by the squad that INTERCEPTS; a launch's by the squad that launched.
      const bag = t.state.tokens.flatMap((x) => Object.values(x.intercept ?? {}));
      if (bag.some((n) => n < 0)) tally.broken.push(`${policy} ${seed}: a Token count under nought`);
    }
  }
  check('nine games between a Missile Rack with an AMS and a squad with a CIWS and an Aerial Drone, three policies: every one ends as a game should, nothing refused',
    [tally.over, tally.games, tally.refused, tally.broken], [9, 9, 0, []]);
  check('and Interceptions were really made in them', tally.spent > 0, true);
  console.log(`       ${tally.spent} Interception Tokens spent, ${tally.flights} Missile flights`);
}
{
  // The chain, with the dice fixed: every attempt misses until the Tokens are gone.
  const blank = (pool) => Object.entries(pool).flatMap(([color, n]) => Array.from({ length: n }, () => {
    const faces = data.dice.dice[color].faces;
    const face = Math.max(0, faces.findIndex((f) => !f.length));
    return { color, face };
  }));
  let games = 0, chained = 0;
  const seen = [];
  for (const seed of [1, 2, 3, 4, 5, 6]) {
    // The roll for First Player is a real one, or it would tie for ever.
    const first = new M.AI.Rng(`${seed}:first`);
    const t = botTable(M, data, scenario, {
      seed, policies: M.AI.eagerPolicy,
      dice: (pool, label) => (/First Player/.test(label)
        ? Object.entries(pool).flatMap(([color, n]) => Array.from({ length: n }, () => ({ color, face: first.int(data.dice.dice[color].sides) })))
        : blank(pool)),
    });
    let end;
    try { end = await t.run({ maxSteps: 9000 }); } catch (err) { end = { kind: 'threw', why: err.message }; } finally { t.close(); }
    games += 1;
    const spends = t.sent.filter((x) => x.kind === 'spendIntercept').length;
    // Queued by an intercepting seat right after its own attack: owed again.
    let again = 0;
    for (let i = 1; i < t.sent.length; i++) if (t.sent[i].kind === 'queueIntercepts' && t.sent[i - 1].kind === 'setCombatView' && t.sent[i - 1].seat === t.sent[i].seat) again += 1;
    chained += again;
    seen.push(`${end.kind}:${spends}:${again}:${t.refused.length}`);
  }
  check('with every die blank an attempt never destroys its target, so it is owed again until the Part\'s Tokens are gone, and the games still end',
    [games, seen.every((x) => x.startsWith('over:') && x.endsWith(':0')), chained > 0], [6, true, true]);
  console.log(`       per game (end:Tokens spent:owed again:refused): ${seen.join('  ')}`);
}

{
  // A flight played through the driver: the Explosion waits for the attempts
  // its flight owed. No Attack die hits, so every attempt misses, the Part's
  // three Tokens go, and the Missile comes through to explode.
  const MISS = { red: 7, yellow: 7, white: 7, blue: 7, black: 0 };
  const seeded = new M.AI.Rng('5:flight');
  let fixed = null;
  let target = 0;
  const script = (want) => ({
    name: 'scripted',
    choose(d, view, rng) {
      const id = want(d, view);
      return id && d.options.some((o) => o.id === id) ? { option: id, why: 'scripted' } : M.AI.eagerPolicy.choose(d, view, rng);
    },
  });
  const t = botTable(M, data, { ...scenario, map: 'none' }, {
    seed: 5,
    dice: (pool) => Object.entries(pool).flatMap(([color, n]) => Array.from({ length: n }, () => ({ color, face: fixed ? fixed[color] : seeded.int(data.dice.dice[color].sides) }))),
    policies: {
      s1: script((d) => (d.kind === 'activation.act' ? d.options.find((o) => o.tags.includes('detonate') && o.facts?.targetUid === target)?.id ?? null : null)),
      s2: script(() => null),
    },
  });
  await t.run({ until: (st) => M.SU.normaliseSetup(st.setup)?.stage === 'done' && st.round.phase === 2 });
  fixed = MISS;
  const U = Object.fromEntries(t.state.tokens.map((x) => [name(x), x]));
  const at = (x, c, r, f) => { x.col = c * 3; x.row = r * 3; x.facing = f; };
  at(U.Mire, 5, 0, 2); at(U.Dune, 0, 0, 2); at(U['Wild Cat'], 5, 6, 0); at(U.CIWS, 8, 6, 0); at(U.Raven, 11, 11, 0); at(U.KK9, 11, 9, 0);
  // The Missile, launched earlier to a Grid out of the CIWS's reach, on its own turn.
  const missile = { ...M.U.makeDroneToken(t.state, data, data.byId.get('071'), 's1'), parentUid: U.Mire.uid, col: 16, row: 10, facing: 2 };
  t.state.tokens.push(missile);
  target = U['Wild Cat'].uid;
  const sc = t.state.script;
  t.state.round.phase = 4; sc.stage = '1:4'; sc.acted = [missile.uid]; sc.passed = []; sc.turn = 's1'; sc.revealed = ['s1', 's2'];
  sc.opp = M.TY.newOpportunity(missile.uid, undefined);
  const before = t.sent.length;
  const end = await t.run({ until: (st) => !st.tokens.some((x) => x.uid === missile.uid) && !st.script.combatView, maxSteps: 600 });
  const sent = t.sent.slice(before).map((x) => `${x.seat}:${x.kind}`);
  const firstBlast = sent.findIndex((k, i) => k === 's1:setCombatView' && i > sent.indexOf('s1:queueIntercepts'));
  const lastAttempt = sent.lastIndexOf('s2:spendIntercept');
  check('PLAYED: the Missile pays, flies and queues what its flight owes, and its Explosion is not opened until every attempt at it has been made',
    [end.kind, t.refused, sent.slice(0, 3), sent.filter((k) => k === 's2:spendIntercept').length, lastAttempt > 0, firstBlast > lastAttempt],
    ['paused', [], ['s1:performAction', 's1:flyToTarget', 's1:queueIntercepts'], 3, true, true]);
  check('every attempt having missed, the CIWS has no Token left, and the Missile that came through explodes once and is spent',
    [U.CIWS.intercept['160_A'], sent.filter((k) => k === 's1:flyToTarget').length, sent.filter((k) => k === 's1:despawn').length, t.state.script.intercepts], [0, 1, 1, []]);
  t.close();
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
