// A reaction owed, and a seat that answers it (FAQ B7, D10;
// AI-OPPONENT-PLAN.md, M8.2b).
//
// Being attacked may owe the DEFENDER something of its own: a Defense Reaction
// (to Defensive Stance on a Penetration), Target Tracing (a Command Token for
// a Counter-roll back at the attacker), Emergency Smoke, a Riposte (those two
// are seatsmoke.test's). The
// attacker's window queues the debt as the attack ends, and only the
// defender's seat may answer it. The Match Centre asks in a panel
// (matchhud.ts reactionPanel); a computer seat is asked by owed(). Until it
// was, the debts a computer's units were owed sat on the table unanswered for
// the whole game. Staged here on the real engine: who is asked, what the
// answers send, and a played attack whose reactions are both taken.
import { botTable, loadEngine, tableAtRoundOne } from './_engine.mjs';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}\n       got  ${g}`); }
};

console.log('A reaction owed\n');

const { M, data } = await loadEngine('reaction', ["export * as SEAT from '../src/seat';", "export * as AI from '../src/ai/index';", "export * as TURN from '../src/turn';"]);
const { owed, newMind } = M.SEAT;
const AI = M.AI;
const clone = (x) => JSON.parse(JSON.stringify(x));

// The attacker: a Nail gun. The defender: a Mech with a Buckler (Defense
// Reaction) on a Hunter core (Target Tracing), and a Reaper (Emergency Smoke).
data.solo.squads['t-shooter'] = {
  name: 'Shooter', faction: 'UN', points: 0,
  mechs: [{ name: 'Nailer', loadout: { torso: '539', chasis: '099', leftHand: '144', rightHand: '541', backpack: '538', pilot: 'LPA-23-2' } }],
  drones: [],
};
data.solo.squads['t-reactor'] = {
  name: 'Reactor', faction: 'GOF', points: 0,
  mechs: [{ name: 'Tracer', loadout: { torso: '174', chasis: '179', leftHand: 'ZHLA-101', pilot: 'ZPA-43' } }],
  drones: [{ cardId: 'PRDR-103' }],
};
const scenario = { ...data.solo.scenarios[0], id: 't-reaction', map: 'none', seats: { s1: 't-shooter', s2: 't-reactor' } };

const run = (state, cmd) => {
  const v = M.C.check(data, state, cmd);
  if (v.ok) { M.C.apply(data, state, cmd); M.G.glueAfter(data, state, cmd); }
  return v;
};
const sendAll = (state, commands) => commands.map((c) => run(state, c).ok);
const ids = (d) => (d ? d.options.map((o) => o.id) : null);
const asked = (state) => ['s1', 's2'].map((seat) => owed(data, state, seat, newMind())?.kind ?? null);
const name = (t) => (t.cardId === 'PRDR-103' ? 'Reaper' : t.label);

const base = (() => {
  const t = tableAtRoundOne(M, data, scenario);
  if (t.refused.length) throw new Error(t.refused.join('; '));
  return t.state;
})();
// Round 1, the Action Phase, the Nailer holding its Opportunity.
const stage = () => {
  const s = clone(base);
  const U = Object.fromEntries(s.tokens.map((t) => [name(t), t]));
  const at = (t, c, r, f) => { t.col = c * 3; t.row = r * 3; if (f !== undefined) t.facing = f; };
  at(U.Nailer, 5, 4, 2); at(U.Tracer, 5, 8, 0); at(U.Reaper, 9, 9, 0);
  s.round.phase = 2; s.script.stage = '1:2'; s.script.passed = []; s.script.revealed = ['s1', 's2'];
  for (const t of s.tokens) if (t.kind === 'mech') { t.timing = 'firing'; t.stance = 'offensive'; }
  s.script.acted = [U.Tracer.uid];
  s.script.opp = null;
  M.G.opportunity(data, s);
  // Target Tracing is paid with a Command Token the Mech itself bears.
  if (!(U.Tracer.statuses ?? []).includes('command')) U.Tracer.statuses = [...(U.Tracer.statuses ?? []), 'command'];
  return { s, U };
};
const debt = (U, kind) => ({
  stance: { uid: U.Tracer.uid, actionId: 'ZHLA-101_A', count: 0, range: 0, kind: 'stance' },
  trace: { uid: U.Tracer.uid, actionId: '174_B', count: 0, range: 0, kind: 'trace', fromUid: U.Nailer.uid },
  smoke: { uid: U.Reaper.uid, actionId: 'PRDR-103_D', count: 2, range: 1, kind: 'smoke' },
}[kind]);
M.L.setLocalSeat('s1');

// ---------- the Defense Reaction ----------
{
  const { s, U } = stage();
  check('with nothing owed the turn is the attacker\'s, and the defender is asked nothing', asked(s), ['opp.act', null]);
  s.script.reactions = [debt(U, 'stance')];
  check('A REACTION OWED IS THE DEFENDER\'S TO ANSWER, at once: its squad is asked, and the squad whose Opportunity it is waits', asked(s), [null, 'reaction.answer']);
  const d = owed(data, s, 's2', newMind());
  check('a Defense Reaction may be taken or declined; with no better idea it is taken, since a Stance costs nothing and is chosen again at the unit\'s next turn',
    [ids(d), d.fallback, d.unit, d.facts], [['take', 'decline'], 'take', U.Tracer.uid, { reaction: 'stance' }]);
  check('taking it settles the debt and changes the Stance; declining it settles the debt and nothing else',
    [d.options[0].commands, d.options[1].commands],
    [[{ kind: 'resolveReaction', seat: 's2', uid: U.Tracer.uid, actionId: 'ZHLA-101_A', placed: true }, { kind: 'defenseReaction', seat: 's2', uid: U.Tracer.uid }],
      [{ kind: 'resolveReaction', seat: 's2', uid: U.Tracer.uid, actionId: 'ZHLA-101_A', placed: false }]]);
  check('each answer says what it is, for a rule about a kind', [d.options.map((o) => o.tags), d.options.every((o) => o.facts.reaction === 'stance' && o.facts.uid === U.Tracer.uid)],
    [[['reaction', 'stance', 'stance:defensive'], ['reaction', 'decline']], true]);
  const taken = clone(s);
  check('taken: the engine takes both commands, the Mech stands in Defensive Stance, nothing is owed, and the turn goes on',
    [sendAll(taken, d.options[0].commands), taken.tokens.find((t) => t.uid === U.Tracer.uid).stance, taken.script.reactions, asked(taken)], [[true, true], 'defensive', [], ['opp.act', null]]);
  const left = clone(s);
  check('declined: the Stance stands, nothing is owed, and the turn goes on',
    [sendAll(left, d.options[1].commands), left.tokens.find((t) => t.uid === U.Tracer.uid).stance, left.script.reactions, asked(left)], [[true], 'offensive', [], ['opp.act', null]]);
  // Already Defensive: there is nothing to take.
  const dug = clone(s);
  dug.tokens.find((t) => t.uid === U.Tracer.uid).stance = 'defensive';
  const only = owed(data, dug, 's2', newMind());
  check('a Mech already in Defensive Stance has nothing to take: the debt is declined, and that is the safe answer', [ids(only), only.fallback], [['decline'], 'decline']);
}

// ---------- Target Tracing ----------
{
  const { s, U } = stage();
  s.script.reactions = [debt(U, 'trace')];
  const d = owed(data, s, 's2', newMind());
  check('Target Tracing may be taken for a Command Token or declined; it spends, so declining is the safe answer',
    [asked(s), ids(d), d.fallback, d.facts, d.options[0].tags], [[null, 'reaction.answer'], ['take', 'decline'], 'decline', { reaction: 'trace', fromUid: U.Nailer.uid }, ['reaction', 'electronic', 'spend-command']]);
  check('taking it settles the debt and opens a Counter-roll back at the attacker, as a reaction',
    d.options[0].commands, [{ kind: 'resolveReaction', seat: 's2', uid: U.Tracer.uid, actionId: '174_B', placed: true },
      { kind: 'startCounterRoll', seat: 's2', uid: U.Tracer.uid, targetUid: U.Nailer.uid, actionId: '174_B', reaction: true }]);
  const taken = clone(s);
  check('the engine takes both: a Counter-roll is on the table, the Tracer its Initiator and the attacker its Responder, and nothing else is asked until it is rolled',
    [sendAll(taken, d.options[0].commands), taken.script.counter?.initiatorUid, taken.script.counter?.responderUid, taken.script.reactions, asked(taken)],
    [[true, true], U.Tracer.uid, U.Nailer.uid, [], [null, null]]);
  const broke = clone(s);
  const poor = broke.tokens.find((t) => t.uid === U.Tracer.uid);
  poor.statuses = poor.statuses.filter((x) => x !== 'command');
  check('with no Command Token on the Mech to spend it can only be declined', ids(owed(data, broke, 's2', newMind())), ['decline']);
  const gone = clone(s);
  gone.tokens = gone.tokens.filter((t) => t.uid !== U.Nailer.uid);
  gone.script.opp = null;
  check('with the attacker gone from the board there is nobody to trace', ids(owed(data, gone, 's2', newMind())), ['decline']);
}

// ---------- Emergency Smoke declined, and dead debt asks nobody ----------
{
  const { s, U } = stage();
  s.script.reactions = [debt(U, 'smoke')];
  const d = owed(data, s, 's2', newMind());
  // (Since M8.2c it may be taken too: where its Screens go, and a Riposte, are
  // seatsmoke.test's.)
  const decline = d.options.find((o) => o.id === 'decline');
  check('Emergency Smoke may be taken, with a Screen or two, or declined; it spends its one use, so declining is the safe answer, and declining keeps the use',
    [d.options.filter((o) => o.tags.includes('smoke')).length, d.options.at(-1).id, d.fallback, decline.commands],
    [9, 'decline', 'decline', [{ kind: 'resolveReaction', seat: 's2', uid: U.Reaper.uid, actionId: 'PRDR-103_D', placed: false }]]);
  const ammo = clone(s);
  const before = clone(ammo.tokens.find((t) => t.uid === U.Reaper.uid).ammo ?? {});
  sendAll(ammo, decline.commands);
  check('declined, the debt is gone and the use is not spent', [ammo.script.reactions, ammo.tokens.find((t) => t.uid === U.Reaper.uid).ammo ?? {}], [[], before]);

  // Two debts: one at a time, in the order they were queued.
  s.script.reactions = [debt(U, 'stance'), debt(U, 'trace')];
  const first = owed(data, s, 's2', newMind());
  sendAll(s, first.options.find((o) => o.id === 'decline').commands);
  const second = owed(data, s, 's2', newMind());
  check('two debts are asked one at a time, in the order they were owed, each a question of its own',
    [first.facts.reaction, second.facts.reaction, first.id === second.id, s.script.reactions.length], ['stance', 'trace', false, 1]);

  // The unit has left the board.
  const dead = stage();
  dead.s.script.reactions = [{ ...debt(dead.U, 'stance'), uid: 4242 }];
  check('a debt whose unit has left the board asks nobody and holds nobody: the turn goes on', asked(dead.s), ['opp.act', null]);
  // A debt of the squad whose Opportunity it is.
  const own = stage();
  own.s.script.reactions = [{ uid: own.U.Nailer.uid, actionId: '144_A', count: 0, range: 0, kind: 'stance' }];
  const mine = owed(data, own.s, 's1', newMind());
  check('a debt of the squad that holds the Opportunity is asked of that squad, before its turn goes on', [asked(own.s), mine.unit], [['reaction.answer', null], own.U.Nailer.uid]);
  // While an attack is on the table nothing is asked, a reaction included.
  const mid = stage();
  mid.s.script.reactions = [debt(mid.U, 'stance')];
  mid.s.script.combatView = { attackerUid: mid.U.Nailer.uid, targetUid: mid.U.Tracer.uid, actionId: '144_A', step: 'attack' };
  check('while the attack is still on the table the reaction waits with everything else', asked(mid.s), [null, null]);
}

// ---------- played: an attack whose reactions are both taken ----------
M.L.setLocalSeat(null);
{
  const HIT = { red: 0, yellow: 0, white: 7, blue: 7, black: 0 };
  const seeded = new AI.Rng('7:staged');
  let fixed = null;
  let target = 0;
  const script = (want) => ({
    name: 'scripted',
    choose(d, view, rng) {
      const id = want(d, view);
      return id && d.options.some((o) => o.id === id) ? { option: id, why: 'scripted' } : AI.eagerPolicy.choose(d, view, rng);
    },
  });
  const t = botTable(M, data, scenario, {
    seed: 7,
    dice: (pool) => (fixed
      ? Object.entries(pool).flatMap(([color, n]) => Array.from({ length: n }, () => ({ color, face: fixed[color] ?? 0 })))
      : Object.entries(pool).flatMap(([color, n]) => Array.from({ length: n }, () => ({ color, face: seeded.int(data.dice.dice[color].sides) })))),
    policies: {
      s1: script((d) => (d.kind === 'opp.act' ? `attack:144_A:${target}` : d.kind === 'attack.part' ? 'part.roll' : null)),
      s2: script((d) => (d.kind === 'reaction.answer' ? 'take' : d.kind === 'opp.act' ? 'end' : null)),
    },
  });
  await t.run({ until: (s) => M.SU.normaliseSetup(s.setup)?.stage === 'done' && s.round.phase === 2 });
  fixed = HIT;
  const U = Object.fromEntries(t.state.tokens.map((x) => [name(x), x]));
  const at = (x, c, r, f) => { x.col = c * 3; x.row = r * 3; x.facing = f; };
  at(U.Nailer, 5, 4, 2); at(U.Tracer, 5, 8, 0); at(U.Reaper, 11, 11, 0);
  for (const x of t.state.tokens) if (x.kind === 'mech') x.stance = 'offensive';
  if (!(U.Tracer.statuses ?? []).includes('command')) U.Tracer.statuses = [...(U.Tracer.statuses ?? []), 'command'];
  U.Nailer.timing = 'firing';
  t.state.script.acted = [U.Tracer.uid];
  t.state.script.opp = null;
  M.G.opportunity(data, t.state);
  target = U.Tracer.uid;
  const before = t.sent.length;
  const tokens = U.Tracer.statuses.filter((x) => x === 'command').length;
  const asks = [];
  const end = await t.run({
    until: (st) => t.sent.slice(before).some((x) => x.kind === 'clearCounterRoll') && !st.script.counter && !st.script.combatView,
    maxSteps: 400, onStep: (seat, r) => { if (r.decision.kind === 'reaction.answer') asks.push([seat, r.decision.facts.reaction, r.option.id]); },
  });
  const sent = t.sent.slice(before);
  const kinds = sent.map((x) => `${x.seat}:${x.kind}`);
  check('PLAYED: a Nail hits the Tracer, which survives; its seat is asked for both reactions, in order, and takes both',
    [end.kind, t.refused, asks], ['paused', [], [['s2', 'stance', 'take'], ['s2', 'trace', 'take']]]);
  check('the Tracer changes to Defensive Stance, and its Counter-roll is rolled out by both seats and closed',
    [U.Tracer.stance, kinds.filter((k) => k === 's2:defenseReaction').length, kinds.filter((k) => k === 's2:startCounterRoll').length,
      kinds.includes('s1:rollCounter'), kinds.includes('s2:rollCounter'), t.state.script.counter, t.state.script.reactions],
    ['defensive', 1, 1, true, true, null, []]);
  check('the Command Token is spent by the roll it opened', [tokens > 0, U.Tracer.statuses.filter((x) => x === 'command').length], [true, tokens - 1]);
  // The attacker does not act on between the attack and the answers.
  const afterAttack = kinds.indexOf('s1:queueReactions');
  const firstAnswer = kinds.indexOf('s2:resolveReaction');
  check('nothing of the attacker\'s turn is sent between the attack that owed the reactions and the first answer to them',
    [afterAttack >= 0, firstAnswer > afterAttack, kinds.slice(afterAttack, firstAnswer).filter((k) => k.startsWith('s1:') && !['s1:queueReactions', 's1:setCombatView'].includes(k))], [true, true, []]);
  t.close();
}

// ---------- the source says so ----------
{
  const { readFileSync } = await import('node:fs');
  const seam = readFileSync(new URL('../src/owed.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  // (Since M8.2d a Martyrdom's blast is asked between the Interception and the
  // reaction, and the board's other blasts between the reaction and the phase:
  // seatblast.test pins those.)
  check('the question sits above the phase and below an Interception: the squad that owes is asked, and the other waits only for an answer that will be asked for (a Reveal owed comes after it, M8.2g, and the board\'s blasts after that)',
    /if \(liveIntercepts\(state\)\.length\) return interceptOwed\(data, state, seat\);\n[\s\S]{0,700}if \(state\.script\.reactions\?\.length\) \{\n\s+const mine = reactionOwed\(data, state, seat\);\n\s+if \(mine\) return mine;\n\s+if \(reactionOwed\(data, state, other\(seat\)\)\) return null;\n\s+\}\n[\s\S]{0,300}const reveal = revealOwed\(data, state, seat\);\n\s+if \(reveal !== undefined\) return reveal;\n[\s\S]{0,400}const phase = PHASES\[state\.round\.phase\];/.test(seam), true);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
