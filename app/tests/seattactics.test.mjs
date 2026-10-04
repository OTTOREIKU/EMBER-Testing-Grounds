// Tactics Cards, played by a seat (5.4; Supplementary Rules 1.04, 1.11;
// AI-OPPONENT-PLAN.md, M8.2q).
//
// Six cards, each used once a game (FAQ P2) and one a round (5.4.2), at the
// moment its own text names (tactics.ts tacticWindowWhy). The Match Centre's
// Tactics panel plays them; the seam offered none. Now each is an answer at its
// moment: Additional Instructions beside the Command Phase's designations, and
// at its Continue (the last chance a squad with no Command left has); System
// Repair and Tactical Disposition in one of the seat's Mechs' Opportunity; Hit
// and Run as one ends, a question of its own whose answers are the card and the
// Maneuver it grants; Battlefield Recovery and Remote Restart in the End Phase,
// a question of their own. A sealed hand is played from the seat's own memory,
// which holds the salts the table never sees.
import { readFileSync } from 'node:fs';
import { botTable, loadEngine } from './_engine.mjs';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}\n       got  ${g}`); }
};

console.log('Tactics Cards\n');

const { M, data } = await loadEngine('seattactics', ["export * as SEAT from '../src/seat';", "export * as TURN from '../src/turn';", "export * as AI from '../src/ai/index';", "export * as HUD from '../src/matchhud';", "export * as TAC from '../src/tactics';"]);
const AI = M.AI;
const viewOf = (state, seat) => M.SEAT.viewOf(data, state, seat);
const src = (f) => readFileSync(new URL(f, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

const ALL = ['274', '275', '276', '277', '278', '279'];
const rifle = (name) => ({ name, loadout: { torso: '539', chasis: '099', leftHand: '540', rightHand: '541', backpack: '538', pilot: 'LPA-23-2' } });
const gunner = (name) => ({ name, loadout: { torso: '533', chasis: '534', leftHand: '535', rightHand: '536', backpack: '004', pilot: 'FPA-04-2' } });
// UN: two riflemen and a Porcupine, whose Microwave (Range 12) is a Command
// Action; RDL: two gunners. The copied Alley game's Main Task scores zones in
// the middle of the open board; the VIP game's scores none, and there a plan is
// about what the other squad could do (`game: 1`).
data.solo.squads['q-rifles'] = { name: 'Riflemen', faction: 'UN', points: 0, mechs: [rifle('Wolf'), rifle('Cat')], drones: [{ cardId: '161' }] };
data.solo.squads['q-gunners'] = { name: 'Gunners', faction: 'RDL', points: 0, mechs: [gunner('Dune'), gunner('Sand')], drones: [] };
const scenarioOf = (game) => ({ ...data.solo.scenarios[game], id: `t-tactics-${game}`, seats: { s1: 'q-rifles', s2: 'q-gunners' } });
const scenario = scenarioOf(0);
const grid = (x) => ({ c: Math.floor(x.col / 3), r: Math.floor(x.row / 3) });
const apart = (a, b) => Math.abs(a.c - b.c) + Math.abs(a.r - b.r);
const cards = (d, id) => (d?.options ?? []).filter((o) => o.tags.includes('tactic') && (!id || o.tags.includes(`card:${id}`)));

// A table past its setup on an open board, the hand dealt plain. `stage` puts
// the units where it is told; the phases are staged by the helpers below.
const table = async (where, { policies = AI.tacticianPolicy, hand = ALL, game = 0 } = {}) => {
  const t = botTable(M, data, { ...scenarioOf(game), map: 'none' }, { seed: 3, policies, glue: M.HUD.glueAfter });
  await t.run({ until: (st) => M.SU.normaliseSetup(st.setup)?.stage === 'done' });
  const s = t.state;
  s.tactics = { s1: [...hand], s2: [] };
  const U = {};
  for (const x of s.tokens) U[/Porcupine/.test(x.label) ? 'Porcupine' : x.label] = x;
  // A unit stands from the top-left cell of its Grid: a Large one fills it.
  const at = (x, c, r, f) => { x.col = c * 3; x.row = r * 3; if (f !== undefined) x.facing = f; };
  for (const [k, v] of Object.entries(where)) at(U[k], ...v);
  const send = (cmds) => cmds.map((cmd) => { const v = M.C.perform(data, s, cmd); if (v.ok) M.HUD.glueAfter(data, s, cmd); return v.ok; });
  // The Action Phase of a round, `first` on `dial` and the first to act; the
  // Mechs in `acted` have had their turn, every other Mech is on Firing.
  const action = (first, { round = 1, dial = 'projectile', acted = [] } = {}) => {
    s.round.n = round; s.round.phase = 2; s.script.stage = `${round}:2`; s.script.opp = null; s.script.revealed = ['s1', 's2']; s.script.passed = [];
    for (const x of s.tokens) if (x.kind === 'mech') x.timing = 'firing';
    U[first].timing = dial;
    s.script.acted = acted.map((k) => U[k].uid);
    M.G.opportunity(data, s);
    return t.drivers.s1.pending();
  };
  // The Command Phase of a round; `broke` takes this squad's Command Tokens off.
  const command = ({ round = 1, broke = false } = {}) => {
    s.round.n = round; s.round.phase = 0; s.script.stage = `${round}:0`; s.script.opp = null; s.script.acted = []; s.script.passed = []; s.script.commanded = []; s.script.turn = 's1';
    s.ready = {};
    M.G.enterPhase(data, s);
    if (broke) {
      for (const x of s.tokens) if (x.side === 's1' && x.kind === 'mech') x.statuses = (x.statuses ?? []).filter((y) => y !== 'command');
      M.C.syncCommandPool(s);
    }
    return t.drivers.s1.pending();
  };
  // The End Phase of a round, none of its steps taken.
  const end = ({ round = 1 } = {}) => {
    s.round.n = round; s.round.phase = 5; s.script.stage = `${round}:5`; s.script.opp = null; s.script.acted = []; s.ready = {};
    return t.drivers.s1.pending();
  };
  return { t, s, U, at, send, action, command, end };
};
const FAR = { Dune: [5, 14, 0], Sand: [9, 14, 0], Porcupine: [0, 0, 2] };

// ---------- the cards ----------
{
  const spec = (id) => M.TAC.tacticSpec(id);
  check('the six cards are what the test means them to be: Additional Instructions in the Command Phase on a Drone, two in the End Phase on a Mech, three in the Action Phase',
    ALL.map((id) => [spec(id).phase, spec(id).targets]),
    [['Command', 'drone'], ['End', 'mech'], ['Action', 'mech'], ['Action', 'unit'], ['Action', 'mech'], ['End', 'mech']]);
  check('the Porcupine\'s Microwave is a Command Action, Range 12', [data.byId.get('161').actions[0].speed, data.byId.get('161').actions[0].range], ['command', 12]);
}

// ---------- in one of its Mechs' Opportunity: System Repair, Tactical Disposition ----------
{
  const x = await table({ Wolf: [5, 4, 2], Cat: [8, 4, 2], ...FAR });
  x.U.Wolf.statuses = [...(x.U.Wolf.statuses ?? []), 'fci'];
  const d = x.action('Wolf');
  const mechs = [x.U.Wolf, x.U.Cat];
  const want278 = mechs.flatMap((m) => ['defensive', 'mobility', 'offensive'].filter((st) => st !== m.stance).map((st) => `tactic:278:${m.uid}:${st}`)).sort();
  check('IN ONE OF ITS MECHS\' OPPORTUNITY, TACTICAL DISPOSITION IS OFFERED BESIDE ITS OWN ANSWERS: for each Ally Mech and each Stance it is not in; SYSTEM REPAIR for the Token the Wolf wears; no other card',
    [d.kind, d.unit, cards(d, '278').map((o) => o.id).sort(), cards(d, '277').map((o) => o.id), cards(d).filter((o) => !/card:27[78]/.test(o.tags.join())).length],
    ['opp.act', x.U.Wolf.uid, want278, [`tactic:277:${x.U.Wolf.uid}:fci:yellow`], 0]);
  const one = cards(d, '278').find((o) => o.id === `tactic:278:${x.U.Cat.uid}:defensive`);
  check('each is the play the Tactics panel sends: one command, the seat, the unit, the card and its pick',
    [one.commands, one.facts], [[{ kind: 'playTactic', seat: 's1', uid: x.U.Cat.uid, cardId: '278', pick: 'defensive' }], { uid: x.U.Cat.uid, cardId: '278', pick: 'defensive' }]);
  const only = (kinds) => M.SEAT.owed(data, x.s, 's1', M.SEAT.newMind(), { only: kinds });
  check('an asker that names its kinds is given the cards only when it names `tactic`',
    [cards(only(['attack', 'move'])).length, cards(only(['move', 'tactic'])).length === cards(d).length], [0, true]);
  check('THE ENGINE TAKES IT: the Cat is in Defensive Stance, and the card is used in round 1',
    [x.send(one.commands), x.U.Cat.stance, M.TAC.tacticUsedRound(x.s, 's1', '278')], [[true], 'defensive', 1]);
  check('and no other card is offered this round (one a round, 5.4.2)', cards(x.t.drivers.s1.pending()).length, 0);
  const next = x.action('Wolf', { round: 2 });
  check('the next round, System Repair is offered again and Tactical Disposition is not: it is used once a game (FAQ P2)',
    [cards(next, '277').length, cards(next, '278').length], [1, 0]);
  x.t.close();
}
{
  // Not in the other squad's turn, and not in a Drone's activation.
  const x = await table({ Wolf: [5, 4, 2], Cat: [8, 4, 2], ...FAR });
  x.action('Dune', { dial: 'swift' });
  check('NOT IN THE OTHER SQUAD\'S TURN: with the Dune\'s Opportunity open this seat is asked nothing at all', M.SEAT.owed(data, x.s, 's1', M.SEAT.newMind()), null);
  const c = x.command();
  const des = c.options.find((o) => o.id === `designate:${x.U.Porcupine.uid}`);
  x.send(des.commands);
  const act = x.t.drivers.s1.pending();
  check('nor in a Drone\'s activation (ruling I29): the Porcupine commanded is offered no card', [act?.kind, act?.unit, cards(act).length], ['activation.act', x.U.Porcupine.uid, 0]);
  x.t.close();
}

// ---------- Hit and Run, as one of its Mechs' Opportunity ends ----------
{
  const x = await table({ Wolf: [5, 4, 2], Cat: [8, 4, 2], ...FAR });
  const d = x.action('Wolf', { acted: ['Cat'] });
  check('its Mech\'s Opportunity open, Hit and Run is not offered: it is played as one ends', cards(d, '276').length, 0);
  x.send(d.options.find((o) => o.id === 'end').commands);
  const run = x.t.drivers.s1.pending();
  const walks = cards(run, '276');
  const pass276 = run?.options.find((o) => o.tags.includes('pass'));
  check('AS THE WOLF\'S OPPORTUNITY ENDS, A QUESTION OF ITS OWN: Hit and Run, each answer the card and a Grid its Maneuver reaches, and letting it go by',
    [run?.kind, run?.unit, walks.length > 4, !!pass276, run?.fallback === pass276?.id], ['tactic.after', x.U.Wolf.uid, true, true, true]);
  check('an asker looking ahead for other kinds of answer is shown what comes after the card let go, not the card\'s question',
    [M.SEAT.owed(data, x.s, 's1', M.SEAT.newMind(), { only: ['attack', 'move'] })?.kind ?? null, M.SEAT.owed(data, x.s, 's1', M.SEAT.newMind(), { only: ['tactic'] })?.kind], [null, 'tactic.after']);
  const w = walks.find((o) => o.facts.to && apart(o.facts.to, grid(x.U.Wolf)) === 1);
  check('each is the play and the Maneuver it grants, made on the table after the play (`granted`)',
    [w.commands.map((c) => c.kind), w.commands[0].cardId, w.commands[1].granted, w.commands[1].uid], [['playTactic', 'maneuver'], '276', true, x.U.Wolf.uid]);
  const to = w.facts.to;
  check('THE ENGINE TAKES IT: the Wolf stands where the walk ends, the card is used, and the grant with it',
    [x.send(w.commands), grid(x.U.Wolf), M.TAC.tacticUsedRound(x.s, 's1', '276'), x.t.drivers.s1.pending()?.kind === 'tactic.after'], [[true, true], to, 1, false]);
  x.t.close();
}
{
  // Let go by: asked once.
  const x = await table({ Wolf: [5, 4, 2], Cat: [8, 4, 2], ...FAR }, { policies: AI.brawlerPolicy });
  const d = x.action('Wolf', { acted: ['Cat'] });
  x.send(d.options.find((o) => o.id === 'end').commands);
  const run = x.t.drivers.s1.pending();
  const step = await x.t.drivers.s1.step();
  check('LET GO BY, IT IS NOT ASKED AGAIN for that Mech\'s ending: the seat remembers it (a policy with no rule for it takes the safe answer, which is the pass)',
    [run?.kind, step.kind, step.option?.id, x.t.drivers.s1.mind.passed, x.t.drivers.s1.pending()?.kind === 'tactic.after', M.TAC.tacticUsedRound(x.s, 's1', '276')],
    ['tactic.after', 'acted', `tactic:pass:1:276:${x.U.Wolf.uid}`, [`1:276:${x.U.Wolf.uid}`], false, null]);
  x.t.close();
}
{
  // The other squad's Mech ending is no moment of this seat's.
  const x = await table({ Wolf: [5, 4, 2], Cat: [8, 4, 2], ...FAR });
  x.action('Dune', { dial: 'swift', acted: ['Wolf', 'Cat'] });
  x.send([{ kind: 'endOpportunity', seat: 's2', uid: x.U.Dune.uid }]);
  check('NOT AS THE OTHER SQUAD\'S MECH ENDS: the Dune\'s ending asks this seat nothing', M.SEAT.owed(data, x.s, 's1', M.SEAT.newMind())?.kind ?? null, null);
  x.t.close();
}

// ---------- the End Phase: Battlefield Recovery, Remote Restart ----------
{
  const x = await table({ Wolf: [5, 4, 2], Cat: [8, 4, 2], ...FAR });
  const max = M.U.maxLink(data, x.U.Wolf);
  x.U.Wolf.link = max - 1;
  x.U.Cat.stance = 'shutdown'; x.U.Cat.link = 0;
  const d = x.end();
  check('IN THE END PHASE, A QUESTION OF ITS OWN BEFORE THE STEPS: Battlefield Recovery for the Mech short of Link and out of Shutdown, Remote Restart for the Mech in Shutdown into each Stance, and no card at all',
    [d?.kind, cards(d, '275').map((o) => o.facts.uid), cards(d, '279').map((o) => o.facts.pick).sort(), d?.options.some((o) => o.tags.includes('pass')), cards(d).filter((o) => !/card:27[59]/.test(o.tags.join()) && !o.tags.includes('pass')).length],
    ['tactic.end', [x.U.Wolf.uid], ['defensive', 'mobility', 'offensive'], true, 0]);
  check('and an asker looking ahead for other kinds of answer is shown the steps', M.SEAT.owed(data, x.s, 's1', M.SEAT.newMind(), { only: ['attack'] })?.kind, 'end.step');
  const pick = AI.tacticianPolicy.choose(d, viewOf(x.s, 's1'), new AI.Rng('end'));
  check('THE TACTICIAN RESTARTS THE MECH IN SHUTDOWN, into Offensive Stance as a Reboot goes', [pick.option, pick.reason], [`tactic:279:${x.U.Cat.uid}:offensive`, 'tactic_restart']);
  x.send(d.options.find((o) => o.id === pick.option).commands);
  check('the engine takes it: the Cat is in Offensive Stance with Link 1, and the End Phase\'s own steps come next', [x.U.Cat.stance, x.U.Cat.link, x.t.drivers.s1.pending()?.kind], ['offensive', 1, 'end.step']);
  x.t.close();
}
{
  const x = await table({ Wolf: [5, 4, 2], Cat: [8, 4, 2], ...FAR });
  x.U.Wolf.link = M.U.maxLink(data, x.U.Wolf) - 1;
  x.U.Cat.link = M.U.maxLink(data, x.U.Cat) - 1;
  // The Cat has lost its rifle arm: it is worth less.
  x.U.Cat.partStates = { ...x.U.Cat.partStates, rightHand: 'destroyed' };
  const d = x.end();
  const view = viewOf(x.s, 's1');
  const worth = (u) => AI.unitWorth(view.units.find((y) => y.uid === u.uid), view, AI.TACTICIAN);
  const pick = AI.tacticianPolicy.choose(d, view, new AI.Rng('end'));
  check('WITH NO MECH IN SHUTDOWN IT RECOVERS A LINK ON THE MECH WORTH MOST that is short of one',
    [cards(d, '275').length, worth(x.U.Wolf) > worth(x.U.Cat), pick.option, pick.reason], [2, true, `tactic:275:${x.U.Wolf.uid}`, 'tactic_link']);
  x.t.close();
}
{
  // Let go by in the End Phase: asked once, and the steps go on.
  const x = await table({ Wolf: [5, 4, 2], Cat: [8, 4, 2], ...FAR }, { policies: AI.brawlerPolicy });
  x.U.Wolf.link = M.U.maxLink(data, x.U.Wolf) - 1;
  x.end();
  const step = await x.t.drivers.s1.step();
  check('let go by, the End Phase\'s cards are not asked again that End Phase, and its steps go on',
    [step.option?.id, x.t.drivers.s1.pending()?.kind], ['tactic:pass:1:end', 'end.step']);
  x.t.close();
}

// ---------- Additional Instructions ----------
{
  const x = await table({ Wolf: [5, 4, 2], Cat: [8, 4, 2], Porcupine: [5, 6, 2], Dune: [5, 12, 0], Sand: [9, 14, 0] });
  const d = x.command();
  check('BESIDE THE COMMAND PHASE\'S DESIGNATIONS: Additional Instructions on each Ally Drone',
    [d?.kind, cards(d, '274').map((o) => o.facts.uid), d?.options.some((o) => o.id === `designate:${x.U.Porcupine.uid}`)], ['loop.designate.command', [x.U.Porcupine.uid], true]);
  const first = AI.tacticianPolicy.choose(d, viewOf(x.s, 's1'), new AI.Rng('c'));
  check('WHERE A TOKEN WOULD PAY FOR THE COMMAND, THE TACTICIAN SPENDS THE TOKEN AND KEEPS THE CARD', [first.option, first.reason], [`designate:${x.U.Porcupine.uid}`, 'command_by_value']);
  // Commanded once with a Token, the Drone may take a Command Action more by the card.
  x.send(d.options.find((o) => o.id === `designate:${x.U.Porcupine.uid}`).commands);
  const act = x.t.drivers.s1.pending();
  const fired = act.options.find((o) => o.tags[0] === 'attack');
  if (fired?.commands) x.send(fired.commands);
  else {
    const endIt = act.options.find((o) => o.id === 'end');
    x.send(endIt.commands);
  }
  let next = x.t.drivers.s1.pending();
  for (let i = 0; i < 4 && next && next.kind !== 'loop.designate.command' && next.kind !== 'phase.ready'; i++) {
    const endIt = next.options.find((o) => o.id === 'end');
    if (!endIt) break;
    x.send(endIt.commands);
    next = x.t.drivers.s1.pending();
  }
  const card = cards(next, '274').find((o) => o.facts.uid === x.U.Porcupine.uid);
  check('a Drone that has had its Command is offered the card still', [!!card, next?.options.some((o) => o.id === `designate:${x.U.Porcupine.uid}`)], [true, false]);
  x.send(card.commands);
  const again = x.t.drivers.s1.pending();
  const free = again?.options.find((o) => o.id === `designate:${x.U.Porcupine.uid}`);
  check('THE ENGINE TAKES IT: the Porcupine may be designated again, and no Command Token is spent on it',
    [M.TAC.tacticUsedRound(x.s, 's1', '274'), !!free, x.s.script.freeCommand.includes(x.U.Porcupine.uid)], [1, true, true]);
  const pool = x.s.commandTokens.s1;
  x.send(free.commands);
  check('designated by the card, it acts with no Token spent, a Command Action and no Move (ruling I7)',
    [x.s.commandTokens.s1, x.s.script.opp?.uid, x.s.script.opp?.commandOnly, x.t.drivers.s1.pending()?.options.some((o) => o.tags[0] === 'move')], [pool, x.U.Porcupine.uid, true, false]);
  x.t.close();
}
{
  // Out of Command Tokens, the squad is asked nothing more of the Command
  // Phase but its Continue: the card is offered there.
  const x = await table({ Wolf: [5, 4, 2], Cat: [8, 4, 2], Porcupine: [5, 6, 2], Dune: [5, 12, 0], Sand: [9, 14, 0] });
  const d = x.command({ broke: true });
  check('A SQUAD WITH NO COMMAND LEFT IS OFFERED THE CARD AT THE COMMAND PHASE\'S CONTINUE',
    [x.s.commandTokens.s1, d?.kind, cards(d, '274').map((o) => o.facts.uid)], [0, 'phase.ready', [x.U.Porcupine.uid]]);
  const pick = AI.tacticianPolicy.choose(d, viewOf(x.s, 's1'), new AI.Rng('c'));
  check('THE TACTICIAN PLAYS IT ON THE DRONE WITH SOMETHING TO DO: the Porcupine\'s Microwave on the Dune 6 Grids off',
    [pick.option, pick.reason, pick.score > AI.TACTICIAN.card], [`tactic:274:${x.U.Porcupine.uid}`, 'tactic_command', true]);
  x.send(d.options.find((o) => o.id === pick.option).commands);
  const des = x.t.drivers.s1.pending();
  const pick2 = AI.tacticianPolicy.choose(des, viewOf(x.s, 's1'), new AI.Rng('c'));
  check('and then designates it', [des?.kind, pick2.option], ['loop.designate.command', `designate:${x.U.Porcupine.uid}`]);
  x.t.close();
  // Nothing in its Range: the card is kept.
  const y = await table({ Wolf: [5, 4, 2], Cat: [8, 4, 2], Porcupine: [0, 0, 2], Dune: [12, 14, 0], Sand: [14, 14, 0] });
  const d2 = y.command({ broke: true });
  const keep = AI.tacticianPolicy.choose(d2, viewOf(y.s, 's1'), new AI.Rng('c'));
  check('with no enemy in the Microwave\'s Range it keeps the card and goes on', [d2?.kind, keep.option], ['phase.ready', 'ready']);
  y.t.close();
}
{
  // Too late once passed (FAQ A21).
  const x = await table({ Wolf: [5, 4, 2], Cat: [8, 4, 2], Porcupine: [5, 6, 2], Dune: [5, 12, 0], Sand: [9, 14, 0] });
  const d = x.command();
  x.send(d.options.find((o) => o.id === 'pass').commands);
  check('PASSED, THE SQUAD IS OFFERED IT NO MORE that Command Phase (FAQ A21)', cards(x.t.drivers.s1.pending()).length, 0);
  x.t.close();
}

// ---------- a sealed hand ----------
{
  const x = await table({ Wolf: [5, 4, 2], Cat: [8, 4, 2], ...FAR }, { hand: [] });
  const held = [{ id: '278', salt: 'a'.repeat(32) }, { id: '277', salt: 'b'.repeat(32) }];
  x.s.tactics = { s1: [], s2: [] };
  x.s.tacticsSealed = { s1: held.map((c) => M.SEC.sealTactic(c.id, c.salt)).sort() };
  const blind = x.action('Wolf');
  check('A SEALED HAND IS NOTHING TO A SEAT THAT DOES NOT HOLD ITS SALTS: no card is offered', cards(blind).length, 0);
  x.t.drivers.s1.deal(held);
  const d = x.t.drivers.s1.pending();
  const o = cards(d, '278').find((y) => y.facts.uid === x.U.Wolf.uid && y.facts.pick === 'defensive');
  check('held in the seat\'s own memory it is played as the panel plays it, the salt with the card, and the engine proves it against the commitment',
    [cards(d, '278').length > 0, o?.commands[0].salt, x.send(o.commands), x.U.Wolf.stance], [true, 'a'.repeat(32), [true], 'defensive']);
  check('a rollback\'s forgetting keeps the hand: it was dealt before the game', (() => { x.t.drivers.s1.forget(); return x.t.drivers.s1.mind.hand?.length; })(), 2);
  x.t.close();
}

// ---------- the Tactician ----------
{
  // System Repair: Fire Control Interference keeps the Wolf from firing, and
  // the Dune stands in its rifle's Range.
  const x = await table({ Wolf: [5, 4, 2], Cat: [8, 1, 2], Dune: [5, 10, 0], Sand: [11, 11, 0], Porcupine: [0, 0, 2] }, { game: 1 });
  x.U.Wolf.statuses = [...(x.U.Wolf.statuses ?? []), 'fci'];
  let d = x.action('Wolf', { dial: 'firing', acted: ['Cat', 'Sand'] });
  const plans = AI.weighed(d, viewOf(x.s, 's1'));
  const repair = plans.find((p) => p.how === 'tactic' && /System Repair/.test(p.label));
  const stay = plans.find((p) => p.how === 'stay');
  check('THE TACTICIAN WEIGHS SYSTEM REPAIR AS A PLAN: with Fire Control Interference off it the Wolf fires from where it stands, and staying it cannot',
    [!!repair, repair?.now > 0, stay?.now], [true, true, 0]);
  check('with the skill off (`tactics`) no plan plays a card', AI.weighed(d, viewOf(x.s, 's1'), { tactics: false }).some((p) => p.how === 'tactic'), false);
  const dear = AI.makeTactician({}, { card: 99 }).choose(d, viewOf(x.s, 's1'), new AI.Rng('r'));
  check('and a card reckoned worth more than anything it could do is kept', /^tactic:/.test(dear.option), false);
  // Its Opportunity, a step at a time.
  const steps = [];
  for (let i = 0; i < 6 && d?.kind === 'opp.act'; i++) {
    const pick = AI.tacticianPolicy.choose(d, viewOf(x.s, 's1'), new AI.Rng(`r${i}`));
    const o = d.options.find((y) => y.id === pick.option);
    steps.push(o?.tags[0] === 'tactic' ? `${o.id}|${pick.reason}` : o?.tags[0] ?? pick.option);
    if (!o?.commands) break;
    x.send(o.commands);
    d = x.t.drivers.s1.pending();
  }
  check('AND PLAYS IT FIRST, THEN FIRES: the card, and an attack after it in the same Opportunity',
    [steps[0], steps.indexOf('attack') > 0], [`tactic:277:${x.U.Wolf.uid}:fci:yellow|tactic_by_value`, true]);
  x.t.close();
}
{
  // System Repair on ANOTHER unit (`mend`): Fire Control Interference keeps the
  // Cat, still to act this round on its Firing dial, from firing at the Dune in
  // its rifle's Range. The Wolf's Opportunity is first.
  const x = await table({ Wolf: [5, 4, 2], Cat: [5, 6, 2], Dune: [5, 10, 0], Sand: [11, 11, 0], Porcupine: [0, 0, 2] }, { game: 1 });
  x.U.Cat.statuses = [...(x.U.Cat.statuses ?? []), 'fci'];
  const d = x.action('Wolf', { dial: 'firing', acted: ['Sand'] });
  const view = viewOf(x.s, 's1');
  const onCat = `tactic:277:${x.U.Cat.uid}:fci:yellow`;
  const plans = AI.weighed(d, view);
  const mend = plans.find((p) => p.how === 'tactic' && d.options.find((o) => o.id === onCat)?.label === p.label);
  const shot = plans.filter((p) => p.how !== 'tactic').reduce((a, b) => (b.now > a.now ? b : a), { now: 0 });
  check('SYSTEM REPAIR ON ANOTHER UNIT IS WEIGHED FOR WHAT IT GIVES BACK: the card on the Cat is offered, and as a plan it is worth what the Wolf does after it and the Cat\'s gun back',
    [d.options.some((o) => o.id === onCat), !!mend, mend ? mend.now > shot.now + AI.TACTICIAN.card : null], [true, true, true]);
  const pick = AI.tacticianPolicy.choose(d, view, new AI.Rng('m'));
  check('so the Wolf plays it on the Cat in its own Opportunity', [pick.option, pick.reason], [onCat, 'tactic_by_value']);
  check('without the skill (`mend`) the card is weighed for the Wolf alone, and kept',
    [AI.weighed(d, view, { mend: false }).some((p) => p.how === 'tactic' && p.label === mend?.label), /^tactic:277/.test(AI.makeTactician({ mend: false }).choose(d, view, new AI.Rng('m')).option)], [false, false]);
  // The Cat has had its turn this round: its gun back is next round's.
  const later = x.action('Wolf', { dial: 'firing', acted: ['Sand', 'Cat'] });
  const laterView = viewOf(x.s, 's1');
  const laterPlans = AI.weighed(later, laterView);
  const laterMend = laterPlans.find((p) => p.how === 'tactic' && p.label === mend?.label);
  const laterShot = laterPlans.filter((p) => p.how !== 'tactic').reduce((a, b) => (b.now > a.now ? b : a), { now: 0 });
  check('a unit that has had its turn gets its gun back next round, which counts for less (`future`)',
    [!!laterMend, laterMend ? laterMend.now - laterShot.now > 0 && laterMend.now - laterShot.now < mend.now - shot.now : null], [true, true]);
  // The dial it acted on is spent: next round's is not known, and its gun is
  // weighed on the Timing of its attacks, whatever it dialled this round.
  const spent = x.action('Wolf', { dial: 'firing', acted: ['Sand', 'Cat'] });
  x.U.Cat.timing = 'projectile';
  const spentPlans = AI.weighed(spent, viewOf(x.s, 's1'));
  const spentMend = spentPlans.find((p) => p.how === 'tactic' && p.label === mend?.label);
  const spentShot = spentPlans.filter((p) => p.how !== 'tactic').reduce((a, b) => (b.now > a.now ? b : a), { now: 0 });
  check('and a dial it has spent on something else changes nothing of it',
    [!!spentMend, spentMend ? Math.abs((spentMend.now - spentShot.now) - (laterMend.now - laterShot.now)) < 1e-9 : null], [true, true]);
  x.t.close();
}
{
  // Hit and Run: the Wolf, its turn over, stands in the Dune's Shotgun Range
  // with both gunners still to act; a step back takes it out of their reach.
  const x = await table({ Wolf: [5, 4, 2], Cat: [8, 1, 2], Dune: [5, 10, 0], Sand: [6, 10, 0], Porcupine: [0, 0, 2] }, { game: 1 });
  const d = x.action('Wolf', { acted: ['Cat'] });
  x.send(d.options.find((o) => o.id === 'end').commands);
  const run = x.t.drivers.s1.pending();
  const view = viewOf(x.s, 's1');
  const pick = AI.tacticianPolicy.choose(run, view, new AI.Rng('h'));
  const o = run.options.find((y) => y.id === pick.option);
  const near = (g) => Math.min(apart(g, grid(x.U.Dune)), apart(g, grid(x.U.Sand)));
  check('THE TACTICIAN TAKES HIT AND RUN OUT OF THE GUNS STILL TO COME: the step it makes ends further from them than it stood, by more than the card is worth',
    [run?.kind, pick.reason, o?.facts?.to ? near(o.facts.to) > near(grid(x.U.Wolf)) : null, pick.score > AI.TACTICIAN.card], ['tactic.after', 'tactic_hit_and_run', true, true]);
  const kept = AI.makeTactician({}, { card: 99 }).choose(run, view, new AI.Rng('h'));
  check('a card reckoned dearer than that is kept, and it says why', [kept.option, kept.reason], [`tactic:pass:1:276:${x.U.Wolf.uid}`, 'tactic_kept']);
  const off = AI.makeTactician({ tactics: false }).choose(run, view, new AI.Rng('h'));
  check('with the skill off it is let go by (the safe answer)', off.option, `tactic:pass:1:276:${x.U.Wolf.uid}`);
  x.t.close();
}
{
  // Nowhere to hide: a gunner on either side, every Grid the step reaches is
  // in both their Ranges. A step aside buys nothing, and the card is kept.
  const x = await table({ Wolf: [5, 5, 2], Cat: [8, 1, 2], Dune: [5, 9, 0], Sand: [5, 1, 2], Porcupine: [0, 0, 2] }, { game: 1 });
  const d = x.action('Wolf', { acted: ['Cat'] });
  x.send(d.options.find((o) => o.id === 'end').commands);
  const run = x.t.drivers.s1.pending();
  const pick = AI.tacticianPolicy.choose(run, viewOf(x.s, 's1'), new AI.Rng('h'));
  check('WITH NOWHERE THE GUNS CANNOT REACH, THE CARD IS KEPT: every step is priced, and none is worth it',
    [run?.kind, pick.option, pick.reason], ['tactic.after', `tactic:pass:1:276:${x.U.Wolf.uid}`, 'tactic_kept']);
  x.t.close();
}
{
  // Tactical Disposition: the Wolf, on its Projectile dial (so it has nothing
  // to fire now), has made its Maneuver up to the gunners, so its Stance is
  // fixed; it stands in front of both in Offensive Stance, facing them, and
  // has a shot at them in its next turn.
  const x = await table({ Wolf: [5, 4, 2], Cat: [8, 1, 2], Dune: [5, 10, 0], Sand: [6, 10, 0], Porcupine: [0, 0, 2] });
  x.U.Wolf.stance = 'offensive';
  let d = x.action('Wolf', { acted: ['Cat'] });
  const step = d.options.find((o) => o.tags.includes('maneuver') && o.facts?.to?.c === 5 && o.facts?.to?.r === 5 && o.facts?.facing === 2);
  x.send(step.commands);
  d = x.t.drivers.s1.pending();
  const plans = AI.weighed(d, viewOf(x.s, 's1'));
  const def = plans.find((p) => p.how === 'tactic' && /Tactical Disposition: Wolf, Defensive/.test(p.label));
  const stay = plans.find((p) => p.how === 'stay');
  check('ITS STANCE FIXED, TACTICAL DISPOSITION IS THE ONE WAY TO ANOTHER: no Stance answer of its own is offered, and the card to Defensive Stance is a plan that costs less to stand in',
    [x.s.script.opp?.stanceLocked, d.options.some((o) => o.tags[0] === 'stance'), !!def, def ? def.cost < stay.cost : null], [true, false, true, true]);
  // A Mech chooses its Stance again as its next Opportunity begins
  // (`restance`): the card buys nothing for its next turn.
  const off = plans.find((p) => p.how === 'tactic' && /Tactical Disposition: Wolf, Mobility/.test(p.label));
  check('AND A MECH TAKES ITS STANCE AFRESH AS ITS NEXT TURN BEGINS: its next turn, a shot at the gunners, is worth the same whatever Stance the card leaves it in (`restance`)',
    [stay?.next > 0, def?.next === stay?.next, off ? off.next === stay?.next : true], [true, true, true]);
  const blind = AI.weighed(d, viewOf(x.s, 's1'), { restance: false }).find((p) => p.how === 'tactic' && /Tactical Disposition: Wolf, Defensive/.test(p.label));
  check('without it, the next turn is fought in Defensive Stance and the card seems to cost a shot it does not', blind ? blind.next < stay.next : null, true);
  x.t.close();
}

// ---------- the register ----------
{
  const cover = src('./aicover.mjs');
  check('the coverage register has the play as an answer a seat gives, and the two questions of the cards\' own',
    [/playTactic: \['seat'/.test(cover), /'tactic\.after': \[/.test(cover), /'tactic\.end': \[/.test(cover)], [true, true, true]);
}

// ---------- whole games ----------
// Every card in both hands, five policies; and a seat that plays every card it
// is offered at once (the Tactician otherwise), so that each runs through the
// engine in whole games, to their end.
const eager = {
  name: 'player',
  choose(d, view, rng) {
    const xs = d.options.filter((o) => o.tags.includes('tactic') && !o.tags.includes('pass'));
    if (xs.length) return { option: xs[Math.floor(rng.next() * xs.length)].id, why: 'every card it may' };
    return AI.tacticianPolicy.choose(d, view, rng);
  },
};
M.L.setLocalSeat(null);
{
  data.solo.squads['q-riflepack'] = { name: 'Riflemen', faction: 'UN', points: 0, mechs: [rifle('Wolf'), rifle('Cat')], drones: [{ cardId: '161' }, { cardId: '163' }] };
  const games = { ...scenario, id: 't-tactics-games', seats: { s1: 'q-riflepack', s2: 'q-gunners' } };
  const tally = { games: 0, over: 0, refused: 0, broken: [], played: {} };
  for (const [policy, seeds] of [['legal', [1, 2]], ['eager', [1]], ['brawler', [1]], ['tactician', [1, 2]], ['player', [1, 2]]]) {
    for (const seed of seeds) {
      const p = policy === 'player' ? eager : AI[`${policy}Policy`];
      const t = botTable(M, data, games, { seed, policies: { s1: p, s2: policy === 'player' ? eager : AI.tacticianPolicy }, glue: M.HUD.glueAfter });
      t.state.tactics = { s1: [...ALL], s2: [...ALL] };
      t.watch((cmd) => { if (cmd.kind === 'playTactic') tally.played[cmd.cardId] = (tally.played[cmd.cardId] ?? 0) + 1; });
      let end;
      try { end = await t.run({ maxSteps: 16000 }); } catch (err) { end = { kind: 'threw', why: `${err?.message ?? err}`.split('\n')[0] }; } finally { t.close(); }
      tally.games += 1;
      if (end.kind === 'over') tally.over += 1; else tally.broken.push(`${policy} ${seed}: ${end.kind} ${end.why ?? ''} ${end.decision ?? ''}`);
      tally.refused += t.refused.length;
    }
  }
  check('EIGHT GAMES with every card in both hands, on the page\'s glue, five policies: every one ends as a game should, nothing refused, and every card was played in them',
    [tally.over, tally.games, tally.refused, tally.broken, ALL.filter((id) => !tally.played[id])], [8, 8, 0, [], []]);
  console.log(`       played ${JSON.stringify(tally.played)}`);
}

console.log(`\n${pass} passed, ${fail} failed`);
M.L.setLocalSeat(null);
if (fail) process.exit(1);
