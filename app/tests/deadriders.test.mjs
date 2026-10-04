// What a hit owes a unit it has just destroyed: nothing (combat.ts finish()).
//
// An attack's riders are sent as its last screen opens: a Tether, an On Hit
// Token or Link loss, the defender's own reaction to being attacked. A unit
// the same attack destroyed is off the board by then, so each of those
// commands was refused, and the refusal ("That target is not on the board")
// was put in front of the attacker in a room. The Token rider was caught by
// the first computer games (botgame.test.mjs); the Tether, the Link rider and
// the Defense Reaction by the random-squad games of 2026-10-02
// (AI-OPPONENT-PLAN.md, M8). Each is staged here on the real engine, in the
// real combat window, with the dice fixed: the attack that destroys its
// target sends none of them and nothing is refused, and the same attack on a
// target that survives still sends every one.
import { botTable, loadEngine } from './_engine.mjs';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}\n       got  ${g}`); }
};

console.log('What a hit owes a unit it has destroyed\n');

const { M, data } = await loadEngine('deadriders', ["export * as SEAT from '../src/seat';", "export * as AI from '../src/ai/index';", "export * as TURN from '../src/turn';"]);
const AI = M.AI;

// The hunters: a Harpoon (On Hit: Tether 4) with an Electro Punch on the other
// arm, a Nail gun (On Hit: the target loses 1 Link), and a Whip (139: its Lash
// may Drag the target or give it an Immobilized Token, its Flog may turn it,
// each the attacker's to choose on the attack's last screen). The prey: a Mech
// with a Buckler (Defense Reaction: on a Penetration it may change to Defensive
// Stance), and a Drone one Penetration destroys.
data.solo.squads['t-hunters'] = {
  name: 'Hunters', faction: 'PD', points: 0,
  mechs: [
    { name: 'Harpooner', loadout: { torso: '547', chasis: '548', leftHand: 'PDLH-202', rightHand: 'PDRH-202', pilot: 'XPA-59' } },
    { name: 'Nailer', loadout: { torso: '539', chasis: '099', leftHand: '144', rightHand: '541', backpack: '538', pilot: 'LPA-23-2' } },
    { name: 'Whipper', loadout: { torso: '539', chasis: '099', leftHand: '139', rightHand: '541', pilot: 'LPA-23-2' } },
  ],
  drones: [],
};
data.solo.squads['t-prey'] = {
  name: 'Prey', faction: 'GOF', points: 0,
  mechs: [{ name: 'Tracer', loadout: { torso: '174', chasis: '179', leftHand: 'ZHLA-101', pilot: 'ZPA-43' } }],
  drones: [{ cardId: '162' }],
};
const scenario = { ...data.solo.scenarios[0], id: 't-deadriders', map: 'none', seats: { s1: 't-hunters', s2: 't-prey' } };

// Every Attack die a hit, every Defence die blank, the Part Die on the Torso.
const HIT = { red: 0, yellow: 0, white: 7, blue: 7, black: 0 };
const dice = (faces) => (pool) => Object.entries(pool).flatMap(([color, n]) => Array.from({ length: n }, () => ({ color, face: faces[color] ?? 0 })));
const script = (want) => ({
  name: 'scripted',
  choose(d, view, rng) {
    const id = want(d, view);
    return id && d.options.some((o) => o.id === id) ? { option: id, why: 'scripted' } : AI.eagerPolicy.choose(d, view, rng);
  },
});
const name = (t) => (t.cardId === '162' ? 'Drone' : t.label);
// A game played through setup to the first Action Phase by the seed's dice,
// then the units stood where the check wants them and the faces fixed.
async function staged(wants) {
  const seeded = new AI.Rng('7:staged');
  let fixed = null;
  const t = botTable(M, data, scenario, {
    seed: 7,
    dice: (pool) => (fixed ? dice(fixed)(pool) : Object.entries(pool).flatMap(([color, n]) => Array.from({ length: n }, () => ({ color, face: seeded.int(data.dice.dice[color].sides) })))),
    policies: { s1: script((d, v) => wants.s1?.(d, v)), s2: script((d, v) => wants.s2?.(d, v)) },
  });
  await t.run({ until: (s) => M.SU.normaliseSetup(s.setup)?.stage === 'done' && s.round.phase === 2 });
  fixed = HIT;
  const U = Object.fromEntries(t.state.tokens.map((x) => [name(x), x]));
  const at = (x, c, r, f) => { x.col = c * 3; x.row = r * 3; if (f !== undefined) x.facing = f; };
  at(U.Harpooner, 5, 4, 2); at(U.Nailer, 0, 0, 2); at(U.Whipper, 11, 0, 2); at(U.Tracer, 11, 11, 0); at(U.Drone, 9, 11, 0);
  for (const x of t.state.tokens) if (x.kind === 'mech') x.stance = 'offensive';
  const turnOf = (mech, timing) => {
    mech.timing = timing;
    t.state.script.acted = t.state.tokens.filter((x) => x.kind === 'mech' && x.uid !== mech.uid).map((x) => x.uid);
    t.state.script.opp = null;
    return M.G.opportunity(data, t.state);
  };
  return { t, U, at, turnOf };
}
// The attack named, played to its end: until its Penetration has been applied
// (or `done` says so) and the window has come down.
async function strike(s, done) {
  const before = s.t.sent.length;
  const end = await s.t.run({ until: (st) => (done ? done(st) : s.t.sent.slice(before).some((x) => x.kind === 'applyPenetration')) && !st.script.combatView, maxSteps: 400 });
  return { end: end.kind, sent: s.t.sent.slice(before).map((x) => x.kind), refused: s.t.refused.map((x) => `${x.kind}: ${x.why}`) };
}
const onBoard = (s, t) => s.t.state.tokens.some((x) => x.uid === t.uid);

// ---------- a Tether ----------
{
  let target = 0;
  const s = await staged({ s1: (d) => (d.kind === 'opp.act' ? `attack:PDLH-202_A:${target}` : null), s2: (d) => (d.kind === 'opp.act' ? 'end' : null) });
  s.at(s.U.Drone, 5, 6, 0);
  target = s.U.Drone.uid;
  s.turnOf(s.U.Harpooner, 'melee');
  const r = await strike(s, (st) => !st.tokens.some((x) => x.uid === target));
  check('a Harpoon that destroys the Drone it hits Tethers nothing: no Tether is sent, the arm does not turn over, and nothing is refused',
    [r.end, r.refused, r.sent.includes('applyPenetration'), r.sent.includes('tether'), r.sent.includes('transformPart'), onBoard(s, s.U.Drone), s.U.Harpooner.mech.leftHand],
    ['paused', [], true, false, false, false, 'PDLH-202']);
  s.t.close();
}
{
  let target = 0;
  const s = await staged({ s1: (d) => (d.kind === 'opp.act' ? `attack:PDLH-202_A:${target}` : d.kind === 'attack.part' ? 'part.roll' : null), s2: (d) => (d.kind === 'opp.act' ? 'end' : null) });
  s.at(s.U.Tracer, 5, 6, 0);
  target = s.U.Tracer.uid;
  s.turnOf(s.U.Harpooner, 'melee');
  const r = await strike(s);
  check('the control: on a Mech that is still standing the Tether is sent, it holds, and the arm turns to its Tether Mode face',
    [r.end, r.refused, r.sent.filter((x) => x === 'tether').length, r.sent.includes('transformPart'), (s.U.Harpooner.tether ?? []).some((x) => x.uid === target), s.U.Harpooner.mech.leftHand !== 'PDLH-202'],
    ['paused', [], 1, true, true, true]);
  s.t.close();
}

// ---------- an On Hit Link loss, and the defender's own reaction ----------
{
  let target = 0;
  const s = await staged({ s1: (d) => (d.kind === 'opp.act' ? `attack:144_A:${target}` : d.kind === 'attack.part' ? 'part.roll' : null), s2: (d) => (d.kind === 'opp.act' ? 'end' : null) });
  s.at(s.U.Nailer, 5, 4, 2); s.at(s.U.Harpooner, 0, 0, 2); s.at(s.U.Tracer, 5, 8, 0);
  // One Penetration from destroyed: the Torso is hit, and the Mech goes with it.
  s.U.Tracer.partStates.torso = 'damaged';
  target = s.U.Tracer.uid;
  const link = s.U.Tracer.link;
  s.turnOf(s.U.Nailer, 'firing');
  const r = await strike(s, (st) => !st.tokens.some((x) => x.uid === target) || (st.tokens.find((x) => x.uid === target).partStates.torso === 'destroyed'));
  check('a Nail that destroys the Mech it hits takes no Link from it and owes it no reaction: neither is sent, and nothing is refused',
    [r.end, r.refused, r.sent.includes('applyPenetration'), r.sent.includes('drainLink'), r.sent.includes('queueReactions'), s.t.state.script.reactions, s.U.Tracer.partStates.torso],
    ['paused', [], true, false, false, [], 'destroyed']);
  void link;
  s.t.close();
}
{
  let target = 0;
  const s = await staged({ s1: (d) => (d.kind === 'opp.act' ? `attack:144_A:${target}` : d.kind === 'attack.part' ? 'part.roll' : null), s2: (d) => (d.kind === 'opp.act' ? 'end' : null) });
  s.at(s.U.Nailer, 5, 4, 2); s.at(s.U.Harpooner, 0, 0, 2); s.at(s.U.Tracer, 5, 8, 0);
  target = s.U.Tracer.uid;
  const link = s.U.Tracer.link;
  s.turnOf(s.U.Nailer, 'firing');
  // What the attacker's window queued, as it queued it (the defender's seat
  // answers each at once: reaction.test.mjs).
  const queued = [];
  s.t.watch((cmd) => { if (cmd.kind === 'queueReactions') queued.push(...cmd.items.map((x) => [x.uid, x.kind, x.actionId])); });
  const r = await strike(s, () => queued.length > 0);
  check('the control: on a Mech that survives the hit, the Link is taken and its reactions are owed: the Defense Reaction its Buckler gives it, and the Target Tracing of its Torso',
    [r.end, r.refused, r.sent.filter((x) => x === 'drainLink').length, s.U.Tracer.link < link, s.U.Tracer.partStates.torso, queued],
    ['paused', [], 1, true, 'damaged', [[target, 'stance', 'ZHLA-101_A'], [target, 'trace', '174_B']]]);
  s.t.close();
}

// ---------- the same on a Drone, which has no Link and no reaction ----------
{
  let target = 0;
  const s = await staged({ s1: (d) => (d.kind === 'opp.act' ? `attack:144_A:${target}` : null), s2: (d) => (d.kind === 'opp.act' ? 'end' : null) });
  s.at(s.U.Nailer, 5, 4, 2); s.at(s.U.Harpooner, 0, 0, 2); s.at(s.U.Drone, 5, 8, 0);
  target = s.U.Drone.uid;
  s.turnOf(s.U.Nailer, 'firing');
  const r = await strike(s, (st) => !st.tokens.some((x) => x.uid === target));
  check('a Nail that destroys a Drone sends nothing after the Penetration but the kill', [r.end, r.refused, r.sent.includes('drainLink'), r.sent.includes('queueReactions'), onBoard(s, s.U.Drone)], ['paused', [], false, false, false]);
  s.t.close();
}

// ---------- a choice the attacker makes: the Whip's Immobilized Token, its Flog's turn ----------
// (Found by the random-squad games of 2026-10-03, wave 7: a computer seat pressed
// "Immobilize" on a Drone its Lash had destroyed, and "Turn ... to face away" on a
// Mech whose Torso had gone, and both were refused.)
const whipped = async (action, prey, pick) => {
  let target = 0;
  const s = await staged({ s1: (d) => (d.kind === 'opp.act' ? `attack:${action}:${target}` : d.kind === 'attack.part' ? 'part.roll' : d.kind === 'attack.finish' ? pick : null), s2: (d) => (d.kind === 'opp.act' ? 'end' : null) });
  s.at(s.U.Whipper, 5, 4, 2); s.at(s.U.Harpooner, 0, 0, 2); s.at(s.U.Nailer, 11, 0, 2); s.at(s.U[prey], 5, 5, 0);
  target = s.U[prey].uid;
  const offered = [];
  const before = s.t.sent.length;
  s.turnOf(s.U.Whipper, 'melee');
  const r = await s.t.run({
    until: (st) => s.t.sent.slice(before).some((x) => x.kind === 'applyPenetration') && !st.script.combatView,
    onStep: (seat, step) => { if (seat === 's1' && step.decision.kind === 'attack.finish') offered.push(...step.decision.options.map((o) => o.id)); },
    maxSteps: 400,
  });
  const sent = s.t.sent.slice(before).map((x) => x.kind);
  const out = { end: r.kind, refused: s.t.refused.map((x) => `${x.kind}: ${x.why}`), offered: offered.includes(pick), sent, there: onBoard(s, s.U[prey]), prey: s.U[prey] };
  s.t.close();
  return out;
};
{
  const r = await whipped('139_A', 'Drone', 'finish.immobilize');
  check('A LASH THAT DESTROYS THE DRONE IT HITS OFFERS NO DRAG AND NO IMMOBILIZED TOKEN: neither choice is on its last screen, no Token is sent, and nothing is refused',
    [r.end, r.refused, r.sent.includes('applyPenetration'), r.offered, r.sent.includes('applyStatus'), r.there], ['paused', [], true, false, false, false]);
  const live = await whipped('139_A', 'Tracer', 'finish.immobilize');
  check('the control: on a Mech that is still standing the choice is offered, and taken the Token is given',
    [live.end, live.refused, live.offered, live.sent.includes('applyStatus'), (live.prey.statuses ?? []).includes('immobilized')], ['paused', [], true, true, true]);
  // (A Drone, which one Penetration destroys: a Mech's last Torso is the same
  // guard, but its Part Die and its Focus make the kill a matter of dice.)
  const flogged = await whipped('139_B', 'Drone', 'finish.faceaway');
  check('A FLOG THAT DESTROYS WHAT IT HITS OFFERS NO TURN: the Drone is gone, no Forced Movement is sent, and nothing is refused',
    [flogged.end, flogged.refused, flogged.offered, flogged.sent.includes('forceMove'), flogged.there], ['paused', [], false, false, false]);
  const turned = await whipped('139_B', 'Tracer', 'finish.faceaway');
  check('the control: a Flog on a Mech that stands offers the turn, and the Mech is turned',
    [turned.end, turned.refused, turned.offered, turned.sent.includes('forceMove')], ['paused', [], true, true]);
}

// ---------- the source says so ----------
{
  const { readFileSync } = await import('node:fs');
  const combat = readFileSync(new URL('../src/combat.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  check('every rider of finish() that names the struck unit asks first whether it is still there',
    [/const tether = onHit > 0 && struck\.uid !== c\.attacker\.uid && this\.aliveNow\(struck\)/.test(combat),
      /\} else if \(r\.kind === 'link' && struck\.kind === 'mech'\) \{\n(?:\s+\/\/[^\n]*\n)*\s+if \(!this\.aliveNow\(struck\)\) continue;/.test(combat),
      /if \(!this\.aliveNow\(defender\)\) return \[\];/.test(combat),
      // (and, since 2026-10-03, skips a Hexagon Token for a Low Value Unit
      // before it sends anything: onhit.test holds that)
      /if \(!this\.aliveNow\(struck\)\) continue;\n(?:\s+\/\/[^\n]*\n)*\s+if \(def\.shape === 'hexagon' && lowValueOf\(this\.data\)\(struck\)\) continue;\n\s+this\.onCommand\(\{\n\s+kind: 'applyStatus'/.test(combat),
      // and the choices the attacker makes on the last screen (Drag, Disarm, an
      // Immobilized Token, a turn), since 2026-10-03
      /if \(onHit > 0 && struck\.uid !== c\.attacker\.uid && this\.aliveNow\(struck\)\n\s+&& \(disarmOn\(c\.action\) \|\| dragPrinted\(c\.action\) \|\| immobilizeChoiceOn\(c\.action\) \|\| faceAwayOnHit\(c\.action\)\)\) \{/.test(combat)], [true, true, true, true, true]);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
