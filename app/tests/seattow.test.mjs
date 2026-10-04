// THE HARPY'S TOW, offered to a seat (AI-OPPONENT-PLAN.md, M12: the seam's
// to-do list, "the Harpy's tow").
//
// ZHDR-304 Harpy, "Air Transport": "When performing a Command Movement, may
// consume 1 additional Command Token and -1 Movement to drag 1 adjacent Ally
// Unit." The page asks it before the route is drawn (commandpick.ts
// offerHarpyDrag) and, once the Movement lands, sets the Ally down in the Grid
// the route left last (matchhud.ts towDraggedAlly): the funder's Command Token
// spent, and the Ally Force-Moved. A computer seat was offered the Movement
// alone. Now the seam offers each tow as answers of their own (`tow`), on the
// Range the drag leaves, each sending what the page sends, each judged by the
// engine. Staged on the real engine.
import { loadEngine, tableAtRoundOne } from './_engine.mjs';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}\n       got  ${g}`); }
};

console.log('The Harpy\'s tow\n');

const { M, data } = await loadEngine('seattow', ["export * as SEAT from '../src/seat';", "export * as TURN from '../src/turn';", "export * as AI from '../src/ai/index';", "export * as HUD from '../src/matchhud';"]);
const { owed, newMind } = M.SEAT;
const T = M.TURN;
const AI = M.AI;
const clone = (x) => JSON.parse(JSON.stringify(x));

// GoF: a Tracer and a Chariot, a Harpy and a Patrol Eagle; against one UN
// Rifleman.
data.solo.squads['t-tow'] = {
  name: 'Tow', faction: 'GOF', points: 0,
  mechs: [
    { name: 'Tracer', loadout: { torso: '174', chasis: '179', leftHand: 'ZHLA-101', rightHand: 'ZHRA-101', pilot: 'ZPA-43' } },
    { name: 'Chariot', loadout: { torso: '176', chasis: '180', leftHand: 'ZHLA-302', rightHand: 'ZHRA-102', pilot: 'ZPA-43' } },
  ],
  drones: [{ cardId: 'ZHDR-304' }, { cardId: 'ZHDR-206' }],
};
data.solo.squads['t-wolf'] = {
  name: 'Rifleman', faction: 'UN', points: 0,
  mechs: [{ name: 'Wolf', loadout: { torso: '539', chasis: '099', leftHand: '540', rightHand: '541', backpack: '538', pilot: 'LPA-23-2' } }],
  drones: [],
};
const NAMES = { 'ZHDR-304': 'Harpy', 'ZHDR-206': 'Eagle' };
const name = (t) => NAMES[t.cardId] ?? t.label;
M.L.setLocalSeat(null);
const base = tableAtRoundOne(M, data, { ...data.solo.scenarios[0], id: 't-tow', seats: { s1: 't-tow', s2: 't-wolf' } });
if (base.refused.length) throw new Error(base.refused.join('; '));

const run = (state, cmd) => {
  const v = M.C.check(data, state, cmd);
  if (v.ok) { M.C.apply(data, state, cmd); M.G.glueAfter(data, state, cmd); }
  return v;
};
const held = (t) => (t.statuses ?? []).filter((x) => x === 'command').length;
const tokens = (t, n) => { t.statuses = [...(t.statuses ?? []).filter((x) => x !== 'command'), ...Array(n).fill('command')]; };
const grid = (t) => `${Math.floor(t.col / 3)},${Math.floor(t.row / 3)}`;
// The Command Phase on open ground: the Tracer at B4 with the Harpy beside it
// at C4, the Chariot two Grids off at E4, the Eagle at C1; the Rifleman far to
// the south. The Tracer holds two Command Tokens face-up and the Chariot one.
// The Harpy is given one of the Tracer's and asked what it does.
const stage = (change = () => {}, phase = 0) => {
  const s = clone(base.state);
  s.map = 'none';
  const U = Object.fromEntries(s.tokens.map((t) => [name(t), t]));
  const at = (t, c, r, f) => { t.col = c * 3; t.row = r * 3; if (f !== undefined) t.facing = f; };
  at(U.Tracer, 1, 3, 2); at(U.Harpy, 2, 3, 2); at(U.Chariot, 4, 3, 2); at(U.Eagle, 2, 0, 2); at(U.Wolf, 6, 10, 0);
  tokens(U.Tracer, 2); tokens(U.Chariot, 1);
  s.round.phase = phase; s.script.stage = `1:${phase}`; s.script.acted = []; s.script.passed = []; s.script.opp = null; s.script.commanded = [];
  s.script.turn = 's1';
  change(U, s);
  M.L.setLocalSeat('s1');
  const designated = phase === 0 ? run(s, { kind: 'designate', seat: 's1', uid: U.Harpy.uid, fromUid: U.Tracer.uid }).ok : true;
  if (phase !== 0) s.script.opp = M.TY.newOpportunity(U.Harpy.uid, undefined);
  const d = owed(data, s, 's1', newMind());
  return { s, U, d, designated };
};
const tows = (d) => (d ? d.options.filter((o) => o.tags.includes('tow')) : []);
const walks = (d) => (d ? d.options.filter((o) => o.tags[0] === 'move' && o.tags.includes('maneuver') && !o.tags.includes('tow') && !o.tags.includes('pivot')) : []);
const ends = (list) => [...new Set(list.map((o) => `${o.facts?.to?.c},${o.facts?.to?.r}`))].sort();

{
  const { s, U, d, designated } = stage();
  const card = data.byId.get('ZHDR-304');
  const start = T.moveStart(data, s, U.Harpy, { maneuver: true });
  const tow = tows(d);
  const towed = [...new Set(tow.map((o) => o.facts?.towed))].sort();
  check('THE HARPY, COMMANDED, IS OFFERED ITS TOW: answers of their own for each adjacent Ally (the Tracer beside it; not the Chariot two Grids off, nor the Eagle), paid with the Tracer\'s Command Token',
    [designated, d?.kind, d?.unit === U.Harpy.uid, start.ok && start.steps > 1, tow.length > 0, towed, tow.every((o) => o.facts?.funder === U.Tracer.uid && o.id.startsWith(`move:tow:${U.Tracer.uid}:`) && o.label.includes('dragging'))],
    [true, 'activation.act', true, true, true, [U.Tracer.uid], true]);
  check('each sends the Movement, then the Token spent and the Ally moved, as the page sends them',
    tow.every((o) => { const k = (o.commands ?? []).map((c) => c.kind); return k[0] === 'maneuver' && k[1] === 'spendCommand' && k[2] === 'forceMove' && o.commands[2].targetUid === U.Tracer.uid && o.commands[1].uid === U.Tracer.uid; }), true);
  check('and the engine takes every one of them whole', tow.every((o) => !!M.G.tableAfter(data, s, o.commands)), true);
  // -1 Movement: the tow reaches the Grids the Movement one shorter reaches,
  // but those whose route leaves last a Grid another unit stands in (the
  // Eagle's C1, the Chariot's E4): the Tracer, a Large Mech, is set down in
  // that Grid or else in the Harpy's own, and fits in neither, so the page
  // drags nothing there (matchhud.ts towDraggedAlly).
  const short = T.reachableFor(data, s, U.Harpy, start.steps - 1, start.flying).map((g) => `${g.c},${g.r}`).filter((g) => g !== grid(U.Harpy)).sort();
  check('ON ONE MOVEMENT LESS: the tow reaches what the Movement one Grid shorter reaches, less the four Grids the Tracer cannot be set down behind (B1 and D1 by way of the Eagle, E5 and F4 by way of the Chariot); the Movement alone reaches further',
    [ends(tow).every((g) => short.includes(g)), short.filter((g) => !ends(tow).includes(g)), ends(walks(d)).length > ends(tow).length, card?.id], [true, ['1,0', '3,0', '4,4', '5,3'], true, 'ZHDR-304']);
  // One made: the Harpy lands, the Tracer is set down behind it, its Token spent.
  const pick = tow.find((o) => o.facts?.to?.c === 4 && o.facts?.to?.r === 5) ?? tow[0];
  const before = held(U.Tracer);
  const after = M.G.tableAfter(data, s, pick.commands);
  const A = Object.fromEntries(after.tokens.map((t) => [name(t), t]));
  check('MADE: the Harpy where the answer said, the Tracer set down in the Grid it named (the one the route left last), the Tracer\'s Token spent',
    [grid(A.Harpy), grid(A.Tracer), held(A.Tracer)], [`${pick.facts.to.c},${pick.facts.to.r}`, `${pick.facts.towedTo.c},${pick.facts.towedTo.r}`, before - 1]);
  // The Tactician weighs them among its plans where a tow is worth something
  // (`tow`), and the Brawler, whose squads have no Harpy, leaves them be.
  const view = M.SEAT.viewOf(data, s, 's1');
  const rows = AI.weighed(d, view, {}, { tow: 1 });
  check('the Tactician weighs them among its plans with a weight on a tow, and not without one',
    [rows.some((p) => p.label.includes('dragging')), AI.weighed(d, view).some((p) => p.label.includes('dragging'))], [true, false]);
  const brawled = AI.brawlerPolicy.choose(d, view, new AI.Rng('tow'));
  check('the Brawler never tows', !!brawled && !d.options.find((o) => o.id === brawled.option)?.tags.includes('tow'), true);
  // What a tow is worth is the Tracer's gain by where it is set down, less the
  // Token: the same Grids for the Harpy, the Tracer set down nearer the zones
  // it walks for or further from them, are worth different amounts, and with
  // the Token free some tow is worth something.
  const free = AI.weighed(d, view, {}, { tow: 1, towToken: 0 }).filter((p) => p.label.includes('dragging'));
  const nows = [...new Set(free.map((p) => p.now.toFixed(4)))];
  check('A TOW IS WORTH WHAT THE ALLY GAINS BY IT: tows to different Grids are worth different amounts, and with the Token free the best is worth something',
    [nows.length > 1, Math.max(...free.map((p) => p.now)) > 0], [true, true]);
  const dear = AI.weighed(d, view, {}, { tow: 1, towToken: 5 }).filter((p) => p.label.includes('dragging'));
  check('and a dear Token makes every tow worth less than nothing', dear.length > 0 && dear.every((p) => p.now < 0), true);
  // A TOKEN TO SPARE: the Tracer's one left and the Chariot's are two, for the
  // Eagle still to be Commanded; with the Chariot holding none, the Tracer's
  // one is the Eagle's, and no tow is planned.
  const tight = stage((U) => { tokens(U.Chariot, 0); });
  const tightRows = AI.weighed(tight.d, M.SEAT.viewOf(data, tight.s, 's1'), {}, { tow: 1, towToken: 0 });
  check('NO TOW IS PLANNED WITH NO TOKEN TO SPARE: one face-up Token left and one Drone still to Command (the seam still offers it)',
    [tows(tight.d).length > 0, tightRows.some((p) => p.label.includes('dragging'))], [true, false]);
}
{
  // Nobody to pay: the Tracer's one Token gone on the designation, the Chariot holding none.
  const none = stage((U) => { tokens(U.Tracer, 1); tokens(U.Chariot, 0); });
  check('NO TOW WITHOUT A FACE-UP TOKEN TO PAY IT WITH: the Tracer\'s one Token went on the designation and the Chariot holds none',
    [none.designated, held(none.U.Tracer), held(none.U.Chariot), tows(none.d).length, walks(none.d).length > 0], [true, 0, 0, 0, true]);
  // A Mech in Shutdown Stance cannot spend its Token (the engine refuses it).
  const shut = stage((U) => { U.Tracer.stance = 'shutdown'; tokens(U.Chariot, 1); });
  const alone = stage((U) => { U.Tracer.stance = 'shutdown'; tokens(U.Chariot, 0); });
  check('NOR WITH ONLY A SHUTDOWN MECH\'S TOKEN (the engine refuses its spend; the page dragged for nothing): with the Tracer shut down the Chariot pays; with the Tracer the only one holding, no tow',
    [tows(shut.d).length > 0 && tows(shut.d).every((o) => o.facts?.funder === shut.U.Chariot.uid), alone.designated, held(alone.U.Tracer), tows(alone.d).length],
    [true, true, 1, 0]);
  // Not in the Automatic Phase: that Movement is no Command Movement.
  const auto = stage(() => {}, 3);
  check('NOR IN THE AUTOMATIC PHASE, which is no Command Movement', [auto.d?.kind, auto.d?.unit === auto.U.Harpy.uid, tows(auto.d).length], ['activation.act', true, 0]);
  // Nor on a Command handed over in the Action Phase (a Command Coordination,
  // 4.15.3): the Harpy moves on it, and the page offers no drag outside the
  // Command Phase (commandpick.ts offerHarpyDrag).
  const coord = stage((U, s) => { U.Harpy.statuses = [...(U.Harpy.statuses ?? []), 'commandUsed']; U.Harpy.commandedBy = U.Tracer.uid; }, 2);
  coord.s.script.opp = { ...M.TY.newOpportunity(coord.U.Harpy.uid, undefined), extra: true, commanded: true };
  const asked = owed(data, coord.s, 's1', newMind());
  check('NOR ON A COMMAND HANDED OVER IN THE ACTION PHASE (a Coordination): it moves, and drags nobody',
    [asked?.unit === coord.U.Harpy.uid, walks(asked).length > 0, tows(asked).length], [true, true, 0]);
  // An Ally that cannot be Force-Moved is not dragged.
  const far = stage((U) => { U.Tracer.col = 0; U.Tracer.row = 0; U.Chariot.col = 3 * 3; U.Chariot.row = 3 * 3; });
  check('the Ally must be adjacent: with the Chariot beside it the Chariot is offered, the Tracer at A1 is not',
    [...new Set(tows(far.d).map((o) => o.facts?.towed))], [far.U.Chariot.uid]);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
