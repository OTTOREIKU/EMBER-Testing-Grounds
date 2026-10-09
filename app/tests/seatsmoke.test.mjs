// Smoke, and a Riposte: answered by a seat (rulebook 4.16; cards 268, 546_B,
// 050_B; AI-OPPONENT-PLAN.md, M8.2c).
//
// A Smoke Screen fills a Large Grid: a unit in one neither sees out nor is
// seen, and a Firing line that crosses one is cut. Three questions come with
// it, and the Match Centre asks each in a panel of its own: where the Screens
// of a Smoke Grenade go as it lands (up to three, Connected, from the Landing
// Point); whether a unit that has just been shot at places its Emergency Smoke,
// and where; and, as a round ends, which Screen each Connected group gives up.
// A Riposte is the fourth of the kind: a Parry that ends the attacker's
// Opportunity and buys a Melee Action in return. The seam declined the two
// reactions and launched no Smoke; this stages each on the real engine.
//
// THE REMOVALS OWED ARE THE PAGE'S: the queue (`script.smokeOwed`) is built by
// matchhud.ts glueAfter, which wraps glue.ts. So the tables here that ask for
// them are run with the page's glue, as a game against the computer is.
import { botTable, loadEngine, tableAtRoundOne } from './_engine.mjs';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}\n       got  ${g}`); }
};

console.log('Smoke, and a Riposte\n');

const { M, data } = await loadEngine('seatsmoke', ["export * as SEAT from '../src/seat';", "export * as TURN from '../src/turn';", "export * as AI from '../src/ai/index';", "export * as HUD from '../src/matchhud';"]);
const { owed, newMind } = M.SEAT;
const T = M.TURN;
const AI = M.AI;
const clone = (x) => JSON.parse(JSON.stringify(x));
const src = async (f) => (await import('node:fs')).readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const viewOf = (state, seat) => M.SEAT.viewOf(data, state, seat);

// RDL: a Mech with a Smoke Grenade in its Torso and a Grappler (a Riposte) on
// its arm; a second Mech with a gun; a Reaper, which carries Emergency Smoke.
// UN: two Mechs with guns.
data.solo.squads['t-smokers'] = {
  name: 'Smokers', faction: 'RDL', points: 0,
  mechs: [
    { name: 'Volcano', loadout: { torso: '016', chasis: '020', leftHand: '050', rightHand: '033', backpack: '532', pilot: 'FPA-63' } },
    { name: 'Dune', loadout: { torso: '533', chasis: '534', leftHand: '535', rightHand: '536', backpack: '004', pilot: 'FPA-04-2' } },
  ],
  drones: [{ cardId: 'PRDR-103' }],
};
data.solo.squads['t-shooters'] = {
  name: 'Shooters', faction: 'UN', points: 0,
  mechs: [
    { name: 'Wolf', loadout: { torso: '539', chasis: '099', leftHand: '540', rightHand: '541', backpack: '538', pilot: 'LPA-23-2' } },
    { name: 'Cat', loadout: { torso: '539', chasis: '099', leftHand: '540', rightHand: '541', backpack: '538', pilot: 'LPA-23-2' } },
  ],
  drones: [],
};
const scenario = { ...data.solo.scenarios[0], id: 't-smoke', seats: { s1: 't-smokers', s2: 't-shooters' } };

// One command as a table takes it, with the glue of the test's choosing.
const runWith = (glue) => (state, cmd) => {
  const v = M.C.check(data, state, cmd);
  if (v.ok) { M.C.apply(data, state, cmd); glue(data, state, cmd); }
  return v;
};
const run = runWith(M.G.glueAfter);
const page = runWith(M.HUD.glueAfter);
const sendAll = (state, commands, by = run) => commands.map((c) => by(state, c).ok);
const ids = (d) => (d ? d.options.map((o) => o.id) : null);
const asked = (state) => ['s1', 's2'].map((seat) => owed(data, state, seat, newMind())?.kind ?? null);
const name = (t) => (t.cardId === 'PRDR-103' ? 'Reaper' : t.label);
const gridOf = (t) => [Math.floor(t.col / 3), Math.floor(t.row / 3)];
const at2 = (g) => `${g.c},${g.r}`;

const base = (() => {
  const t = tableAtRoundOne(M, data, scenario);
  if (t.refused.length) throw new Error(t.refused.map((r) => `${r.kind}: ${r.why}`).join('; '));
  return t.state;
})();
const stage = (phase) => {
  const s = clone(base);
  s.map = 'none';
  const U = Object.fromEntries(s.tokens.map((t) => [name(t), t]));
  const at = (t, c, r, f) => { t.col = c * 3; t.row = r * 3; if (f !== undefined) t.facing = f; };
  at(U.Volcano, 5, 5, 2); at(U.Dune, 0, 0, 2); at(U.Reaper, 2, 2, 2); at(U.Wolf, 5, 7, 0); at(U.Cat, 11, 11, 0);
  s.round.phase = phase; s.script.stage = `1:${phase}`; s.script.acted = []; s.script.passed = []; s.script.opp = null;
  if (phase >= 2) { s.script.revealed = ['s1', 's2']; for (const t of s.tokens) if (t.kind === 'mech') t.timing = 'firing'; }
  const turnOf = (mech, timing) => {
    mech.timing = timing ?? mech.timing;
    s.script.acted = s.tokens.filter((x) => x.kind === 'mech' && x.uid !== mech.uid).map((x) => x.uid);
    s.script.opp = null;
    return M.G.opportunity(data, s);
  };
  return { s, U, at, turnOf };
};
const debt = (U, kind) => ({
  smoke: { uid: U.Reaper.uid, actionId: 'PRDR-103_D', count: 2, range: 1, kind: 'smoke' },
  riposte: { uid: U.Volcano.uid, actionId: '050_B', count: 0, range: 0, kind: 'riposte', fromUid: U.Wolf.uid },
}[kind]);
M.L.setLocalSeat('s1');

// ---------- the cards, and where a Screen may go ----------
{
  const { s } = stage(2);
  check('the cards are what the test means them to be: a Smoke Grenade that puts down up to three Connected Screens as it lands, Emergency Smoke on the Reaper (two Screens within one Grid, one use), a Riposte on the Grappler',
    [M.U.smokePlacement(data.byId.get('268').actions[0]), !!M.U.immediateDetonation(data.byId.get('268')),
      M.U.attackReactionsOf(data, s.tokens.find((t) => t.cardId === 'PRDR-103')).map((r) => [r.actionId, r.smoke]),
      data.byId.get('050').actions.map((a) => a.name.en)],
    [{ count: 3, connected: true }, true, [['PRDR-103_D', { count: 2, range: 1 }]], ['Grappling Hook', 'Riposte']]);
  const shapes = T.smokeShapes(s, 's1', { c: 5, r: 5 }, 3, true);
  const connected = (cells) => cells.every((g, i) => i === 0 || cells.slice(0, i).some((x) => Math.abs(x.c - g.c) + Math.abs(x.r - g.r) === 1));
  check('THE SHAPES A CARD OF THREE MAY TAKE on open ground: the Landing Point alone, with each of the four Grids beside it, and the eighteen threes; each begins at the Landing Point and is put down in Contact with what is already there; no shape twice',
    [shapes.length, [1, 2, 3].map((n) => shapes.filter((x) => x.length === n).length), shapes.every((x) => x[0].c === 5 && x[0].r === 5), shapes.every(connected),
      new Set(shapes.map((x) => x.map(at2).sort().join(';'))).size, shapes[0].map(at2)],
    [23, [1, 4, 18], true, true, 23, ['5,5']]);
  check('the board\'s edge cuts them short, a card of one is one Screen, and one that need not be Connected is offered its first alone',
    [T.smokeShapes(s, 's1', { c: 0, r: 0 }, 3, true).length, T.smokeShapes(s, 's1', { c: 5, r: 5 }, 1, true).length, T.smokeShapes(s, 's1', { c: 5, r: 5 }, 3, false).length, T.smokeShapes(s, 's1', { c: 5, r: 5 }, 0, true)],
    [8, 1, 1, []]);
  const smoked = clone(s);
  smoked.smoke = [{ col: 5, row: 4, side: 's1' }, { col: 6, row: 5, side: 's2' }];
  const round = T.smokeShapes(smoked, 's1', { c: 5, r: 5 }, 3, true);
  check('ONE SCREEN A SQUAD A GRID: no shape uses a Grid the squad already has a Screen in; the other squad\'s Screen is no bar',
    [round.some((x) => x.some((g) => g.c === 5 && g.r === 4)), round.some((x) => x.some((g) => g.c === 6 && g.r === 5)), round.filter((x) => x.length === 2).length], [false, true, 3]);
  smoked.smoke.push({ col: 5, row: 5, side: 's1' });
  check('and with its own Screen already at the Landing Point there is nowhere for the first, so no shape at all', T.smokeShapes(smoked, 's1', { c: 5, r: 5 }, 3, true), []);
  check('a reaction\'s Screens go "within Range": the unit\'s own Grid first, then those beside it; not where the squad has one, and not off the board',
    [T.smokeSpots(s, 's1', { c: 5, r: 5 }, 1).map(at2), T.smokeSpots(smoked, 's1', { c: 5, r: 5 }, 1).map(at2), T.smokeSpots(s, 's1', { c: 0, r: 0 }, 1).map(at2), T.smokeSpots(s, 's1', { c: 5, r: 5 }, 2).length],
    [['5,5', '4,5', '5,4', '5,6', '6,5'], ['4,5', '5,6', '6,5'], ['0,0', '0,1', '1,0'], 13]);
}

// ---------- a Smoke Grenade ----------
{
  const { s, U, turnOf } = stage(2);
  turnOf(U.Volcano, 'projectile');
  const d = owed(data, s, 's1', newMind());
  const smokes = d.options.filter((o) => o.tags[0] === 'launch' && o.facts.cardId === '268');
  check('THE SMOKE GRENADE IS LAUNCHED, where the seam passed it over: at every Landing Point within Range 2 it can see, its own Grid among them, and each answer says it is Smoke and no attack',
    [smokes.length, smokes.every((o) => o.tags.includes('smoke') && o.tags[0] === 'launch'), smokes.some((o) => o.facts.to.c === 5 && o.facts.to.r === 5),
      smokes.every((o) => Math.abs(o.facts.to.c - 5) + Math.abs(o.facts.to.r - 5) <= 2), d.options.filter((o) => o.tags[0] === 'launch' && !o.tags.includes('smoke')).length],
    [13, true, true, true, 0]);
  const keen = AI.eagerPolicy.choose(d, viewOf(s, 's1'), new AI.Rng('keen'));
  check('the eager policy, which throws every Projectile it has at the nearest enemy, keeps its Smoke: a Screen on the enemy would be the enemy\'s cover',
    [d.options.find((o) => o.id === keen.option).tags.includes('smoke'), d.options.find((o) => o.id === keen.option).tags[0]], [false, 'move']);
  const shot = smokes.find((o) => o.facts.to.c === 5 && o.facts.to.r === 6);
  check('launched, it owes its Screens at once, and its owner is asked', [shot.commands.map((c) => c.kind), sendAll(s, shot.commands), asked(s)], [['performAction', 'launch'], [true, true], ['blast.resolve', null]]);
  const g = s.tokens.find((t) => t.cardId === '268');
  const q = owed(data, s, 's1', newMind());
  check('ONE ANSWER FOR EACH SHAPE the Screens may take from where it landed; with no better idea it is the one Screen on the Landing Point',
    [q.unit, q.options.length, q.fallback, q.options.every((o) => o.tags.join() === 'detonate,smoke,done'), q.options.map((o) => o.facts.cells.length).filter((n, i, a) => a.indexOf(n) === i)],
    [g.uid, 23, `blast:${g.uid}:smoke:5,6`, true, [1, 2, 3]]);
  const three = q.options.find((o) => o.facts.cells.length === 3);
  check('each is the Screens put down for its own squad, then the Grenade removed: what the page sends a press at a time',
    [three.commands.map((c) => c.kind), three.commands.slice(0, 3).map((c) => [c.for, `${c.at.col},${c.at.row}`]), three.facts.cells.map(at2)],
    [['placeSmoke', 'placeSmoke', 'placeSmoke', 'despawn'], three.facts.cells.map((c) => ['s1', at2(c)]), three.facts.cells.map(at2)]);
  check('the engine takes it: three Screens of that squad on the board, the Grenade gone, and the Opportunity goes on',
    [sendAll(s, three.commands), s.smoke.map((x) => x.side), s.smoke.map((x) => `${x.col},${x.row}`), s.tokens.some((t) => t.uid === g.uid), asked(s)],
    [[true, true, true, true], ['s1', 's1', 's1'], three.facts.cells.map(at2), false, ['opp.act', null]]);
}
{
  // Nowhere to put the first.
  const { s, U } = stage(2);
  s.smoke = [{ col: 5, row: 6, side: 's1' }];
  const g = { ...M.U.makeDroneToken(s, data, data.byId.get('268'), 's1'), parentUid: U.Volcano.uid, col: 16, row: 19, facing: 0 };
  s.tokens.push(g);
  const q = owed(data, s, 's1', newMind());
  check('a Grenade that lands where its squad already has a Screen has nowhere to put the first: it is removed, by the one answer there is',
    [ids(q), q.options[0].commands, sendAll(s, q.options[0].commands), s.smoke.length], [[`blast:${g.uid}:none`], [{ kind: 'despawn', seat: 's1', uid: g.uid, targetUid: g.uid }], [true], 1]);
}

// ---------- Emergency Smoke ----------
{
  const { s, U, at, turnOf } = stage(2);
  at(U.Reaper, 5, 7, 0); at(U.Wolf, 5, 10, 0);
  turnOf(U.Wolf, 'firing');
  s.script.reactions = [debt(U, 'smoke')];
  const d = owed(data, s, 's1', newMind());
  const takes = d.options.filter((o) => o.tags.includes('smoke'));
  check('EMERGENCY SMOKE MAY BE TAKEN, where the seam could only decline it: a Screen in each Grid within its Range, or two with one of them on the unit itself; or declined, which is still the safe answer',
    [asked(s), takes.map((o) => o.facts.cells.map(at2).join('+')), d.options.at(-1).id, d.fallback, d.facts],
    [['reaction.answer', null], ['5,7', '4,7', '5,6', '5,8', '6,7', '5,7+4,7', '5,7+5,6', '5,7+5,8', '5,7+6,7'], 'decline', 'decline', { reaction: 'smoke' }]);
  check('taking it is the debt settled as taken, then the Screens, for its own squad',
    [takes.at(-1).commands, takes.every((o) => o.tags.join() === 'reaction,smoke' && o.facts.reaction === 'smoke' && o.facts.uid === U.Reaper.uid)],
    [[{ kind: 'resolveReaction', seat: 's1', uid: U.Reaper.uid, actionId: 'PRDR-103_D', placed: true },
      { kind: 'placeSmoke', seat: 's1', for: 's1', at: { col: 5, row: 7 } }, { kind: 'placeSmoke', seat: 's1', for: 's1', at: { col: 6, row: 7 } }], true]);
  const taken = clone(s);
  check('taken: the Screens are down, its one use is spent, nothing is owed, and the attacker\'s turn goes on',
    [sendAll(taken, takes.at(-1).commands), taken.smoke.map((x) => `${x.side}:${x.col},${x.row}`), taken.tokens.find((t) => t.uid === U.Reaper.uid).ammo['PRDR-103_D'], taken.script.reactions, asked(taken)],
    [[true, true, true], ['s1:5,7', 's1:6,7'], 0, [], [null, 'opp.act']]);
  const left = clone(s);
  check('declined: no Screen, the use kept for a later attack', [sendAll(left, d.options.at(-1).commands), left.smoke ?? [], left.tokens.find((t) => t.uid === U.Reaper.uid).ammo['PRDR-103_D'], left.script.reactions],
    [[true], [], 1, []]);
  check('and from the Reaper the Wolf has a line now and none once its own Grid is Smoke: a unit in a Screen is not seen', (() => {
    const wolf = (st) => st.tokens.find((t) => t.uid === U.Wolf.uid);
    const reaper = (st) => st.tokens.find((t) => t.uid === U.Reaper.uid);
    const sight = (st) => M.R.firingSight(wolf(st), reaper(st), T.terrainOf(data, st), st.tokens, st.smoke ?? []);
    return [sight(s), sight(taken)];
  })(), ['clear', 'smoked']);
  // A card of one Screen.
  const one = clone(s);
  one.script.reactions = [{ ...debt(U, 'smoke'), count: 1 }];
  check('a reaction that places one Screen is offered no pair', owed(data, one, 's1', newMind()).options.filter((o) => o.tags.includes('smoke')).every((o) => o.facts.cells.length === 1), true);
}

// ---------- a Riposte ----------
{
  const { s, U, at, turnOf } = stage(2);
  at(U.Volcano, 5, 5, 2); at(U.Wolf, 5, 6, 0);
  turnOf(U.Wolf, 'melee');
  s.script.reactions = [debt(U, 'riposte')];
  const d = owed(data, s, 's1', newMind());
  check('A RIPOSTE MAY BE TAKEN: a blow with each Melee Action it could strike the attacker with, or no blow, or none of it; with no better idea it is taken (it costs nothing)',
    [asked(s), ids(d), d.fallback, d.facts, M.U.riposteMelees(data, U.Volcano).map((a) => a.id)],
    [['reaction.answer', null], ['riposte:050_A', 'riposte:COMMON_PUNCH_MELEE', 'riposte:end', 'decline'], 'riposte:050_A', { reaction: 'riposte', fromUid: U.Wolf.uid }, ['050_A', 'COMMON_PUNCH_MELEE']]);
  const blow = d.options[0];
  check('the blow is an attack on THE ATTACKER and nobody else, with the Riposte sent before it (the attacker\'s Opportunity ends) and the Melee Action paid for by the grant',
    [blow.run.routine, blow.run.args.mode, blow.run.args.uid, blow.run.args.targetUid, blow.run.args.before, blow.tags, blow.facts.targetUid],
    ['attack', 'attack', U.Volcano.uid, U.Wolf.uid, [{ kind: 'riposte', seat: 's1', uid: U.Volcano.uid, fromUid: U.Wolf.uid }, { kind: 'performAction', seat: 's1', uid: U.Volcano.uid, actionId: '050_A', granted: true }],
      ['reaction', 'riposte', 'attack', 'melee'], U.Wolf.uid]);
  check('no blow: the Riposte, and the debt settled', d.options[2].commands,
    [{ kind: 'riposte', seat: 's1', uid: U.Volcano.uid, fromUid: U.Wolf.uid }, { kind: 'resolveReaction', seat: 's1', uid: U.Volcano.uid, actionId: '050_B', placed: true }]);
  const struck = clone(s);
  check('taken: the attacker\'s Action Opportunity is over and it has had its turn; the granted Action spends the debt as it is paid, so nothing is owed',
    [sendAll(struck, blow.run.args.before), struck.script.opp, struck.script.acted.includes(U.Wolf.uid), struck.script.reactions], [[true, true], null, true, []]);
  const ended = clone(s);
  check('with no blow the same Opportunity ends, and nothing is owed', [sendAll(ended, d.options[2].commands), ended.script.opp, ended.script.reactions], [[true, true], null, []]);
  const kept = clone(s);
  check('declined, the attacker\'s Opportunity stands', [sendAll(kept, d.options[3].commands), kept.script.opp?.uid, kept.script.reactions], [[true], U.Wolf.uid, []]);
  // What the engine would refuse is not offered.
  const down = clone(s);
  down.tokens.find((t) => t.uid === U.Volcano.uid).stance = 'shutdown';
  check('A BLOW THE ENGINE WOULD REFUSE IS NOT OFFERED: a Mech in Shutdown performs no Action, a granted one included, so it strikes none; the Opportunity may still be ended',
    [ids(owed(data, down, 's1', newMind())), M.C.check(data, down, { kind: 'performAction', seat: 's1', uid: U.Volcano.uid, actionId: '050_A', granted: true }).ok], [['riposte:end', 'decline'], false]);
  const armless = clone(s);
  const stump = armless.tokens.find((t) => t.uid === U.Volcano.uid);
  stump.partStates = { ...stump.partStates, leftHand: 'destroyed' };
  check('with the Grappler\'s own arm destroyed since, the blow left is a Punch', ids(owed(data, armless, 's1', newMind())), ['riposte:COMMON_PUNCH_MELEE', 'riposte:end', 'decline']);
  const unseen = clone(s);
  const ghost = unseen.tokens.find((t) => t.uid === U.Wolf.uid);
  ghost.statuses = [...(ghost.statuses ?? []), 'camouflage'];
  check('and no blow is offered at a unit in Optical Camouflage, which is Scanned before it is attacked', ids(owed(data, unseen, 's1', newMind())), ['riposte:end', 'decline']);
  // Out of every blow's reach.
  const far = stage(2);
  far.at(far.U.Volcano, 5, 5, 2); far.at(far.U.Wolf, 5, 10, 0);
  far.turnOf(far.U.Wolf, 'firing');
  far.s.script.reactions = [debt(far.U, 'riposte')];
  const f = owed(data, far.s, 's1', newMind());
  check('WITH THE ATTACKER OUT OF EVERY BLOW\'S REACH (five Grids, and the Grappling Hook reaches three) no blow is offered: the Opportunity may still be ended, and that is then the safe answer',
    [ids(f), f.fallback], [['riposte:end', 'decline'], 'riposte:end']);
  const mid = stage(2);
  mid.at(mid.U.Volcano, 5, 5, 2); mid.at(mid.U.Wolf, 5, 8, 0);
  mid.turnOf(mid.U.Wolf, 'firing');
  mid.s.script.reactions = [debt(mid.U, 'riposte')];
  check('at three Grids the Grappling Hook reaches and a Punch does not', ids(owed(data, mid.s, 's1', newMind())), ['riposte:050_A', 'riposte:end', 'decline']);
  // The attacker's Opportunity is already over.
  const late = clone(s);
  late.script.opp = null;
  const l = owed(data, late, 's1', newMind());
  check('with the attacker\'s Opportunity already over there is nothing to end: the blow alone, with no Riposte sent before it, or none',
    [ids(l), l.options[0].run.args.before.map((c) => c.kind)], [['riposte:050_A', 'riposte:COMMON_PUNCH_MELEE', 'decline'], ['performAction']]);
  // The attacker has left the board.
  const gone = clone(s);
  gone.tokens = gone.tokens.filter((t) => t.uid !== U.Wolf.uid);
  gone.script.opp = null;
  check('and with the attacker gone from the board it can only be let go', ids(owed(data, gone, 's1', newMind())), ['decline']);
}

// ---------- the Screens a round's end takes away ----------
{
  const end = () => {
    const { s } = stage(5);
    s.smoke = [{ col: 2, row: 2, side: 's1' }, { col: 3, row: 2, side: 's1' }, { col: 4, row: 2, side: 's1' }, { col: 8, row: 8, side: 's1' }, { col: 9, row: 2, side: 's2' }, { col: 9, row: 3, side: 's2' }];
    s.round.firstPlayer = 's1';
    for (const step of ['remove', 'tokens']) run(s, { kind: 'markEndStep', seat: 's1', step });
    return s;
  };
  const s = end();
  const step = owed(data, s, 's1', newMind());
  check('the End Phase\'s Smoke step is the dissipation and the step marked', [step.kind, step.options[0].commands.map((c) => c.kind)], ['end.step', ['dissipateSmoke', 'markEndStep']]);
  sendAll(s, step.options[0].commands, page);
  check('on a table run by the PAGE\'s glue the dissipation takes the lone Screen and leaves a removal owed by each Connected group, the First Player\'s first',
    [s.smoke.length, s.script.smokeOwed.map((x) => `${x.side}:${x.cells.length}`), T.smokeOwedCells(s).map((c) => `${c.col},${c.row}`)], [5, ['s1:3', 's2:2'], ['2,2', '3,2', '4,2']]);
  const q = owed(data, s, 's1', newMind());
  check('THE SQUAD THAT OWES THE NEXT REMOVAL IS ASKED WHICH SCREEN, before the round\'s last step; the other squad waits',
    [asked(s), q.kind, ids(q), q.fallback, q.options.map((o) => o.tags)], [['smoke.thin', null], 'smoke.thin', ['thin:2,2', 'thin:3,2', 'thin:4,2'], 'thin:2,2', [['smoke', 'remove'], ['smoke', 'remove'], ['smoke', 'remove']]]);
  check('each answer takes that squad\'s own Screen off, and says which Grid it stands in',
    [q.options[1].commands, q.options.map((o) => o.facts.cell)], [[{ kind: 'removeSmoke', seat: 's1', side: 's1', at: { col: 3, row: 2 } }], [{ c: 2, r: 2 }, { c: 3, r: 2 }, { c: 4, r: 2 }]]);
  const given = AI.makeTactician({ focus: false }).choose(q, viewOf(s, 's1'), new AI.Rng('thin'));
  check('asked this very question, the Tactician keeps the Screen its Reaper stands in and gives up the one furthest from it', [given.option, given.reason], ['thin:4,2', 'thin_smoke']);
  sendAll(s, q.options[1].commands, page);
  check('taken (the middle one, which splits the group and owes nothing more): the other squad is asked for its own',
    [s.smoke.filter((x) => x.side === 's1').map((x) => `${x.col},${x.row}`), asked(s), ids(owed(data, s, 's2', newMind()))], [['2,2', '4,2'], [null, 'smoke.thin'], ['thin:9,2', 'thin:9,3']]);
  sendAll(s, owed(data, s, 's2', newMind()).options[0].commands, page);
  check('with nothing more owed the round\'s last step is asked', [s.script.smokeOwed ?? [], asked(s).map((k) => k), owed(data, s, 's1', newMind()).options[0].id], [[], ['end.step', 'end.step'], 'tasks']);
  // The suite's own glue keeps no queue.
  const plain = end();
  sendAll(plain, owed(data, plain, 's1', newMind()).options[0].commands);
  check('a table run on glue.ts alone keeps no such queue, and asks nobody: the lone Screen goes, the groups stand, and the round goes on',
    [plain.smoke.length, plain.script.smokeOwed ?? null, asked(plain)], [5, null, ['end.step', 'end.step']]);
  // A group whose Screens are all gone holds nobody.
  const stale = end();
  sendAll(stale, owed(data, stale, 's1', newMind()).options[0].commands, page);
  stale.smoke = stale.smoke.filter((x) => x.side !== 's1');
  // The other squad's Screen in one of those Grids is not this group's.
  stale.smoke.push({ col: 2, row: 2, side: 's2' });
  check('a group with no Screen left standing has nothing to give up (the other squad\'s Screen in one of its Grids is not its own), and holds neither squad: the next question is the round\'s',
    [T.smokeOwedCells(stale), asked(stale)], [[], ['end.step', 'end.step']]);
  // Season 1.04: three from each group.
  const season = end();
  season.season = '1.04';
  season.smoke = [0, 1, 2, 3, 4].map((i) => ({ col: i, row: 6, side: 's1' }));
  sendAll(season, owed(data, season, 's1', newMind()).options[0].commands, page);
  const picks = [];
  for (let i = 0; i < 5; i++) {
    const d = owed(data, season, 's1', newMind());
    if (d?.kind !== 'smoke.thin') break;
    picks.push(d.options.length);
    sendAll(season, d.options[0].commands, page);
  }
  check('under Season 1.04 a group gives up three, asked one at a time, each from the Screens of that group still standing', [picks, season.smoke.length, season.script.smokeOwed ?? []], [[5, 4, 3], 2, []]);
}

// ---------- played: two drivers, the real window ----------
M.L.setLocalSeat(null);
const blank = (pool) => Object.entries(pool).flatMap(([color, n]) => Array.from({ length: n }, () => ({ color, face: Math.max(0, data.dice.dice[color].faces.findIndex((f) => !f.length)) })));
const script = (want) => ({
  name: 'scripted',
  choose(d, view, rng) {
    const id = want(d, view);
    return id && d.options.some((o) => o.id === id) ? { option: id, why: 'scripted' } : AI.eagerPolicy.choose(d, view, rng);
  },
});
const table = async ({ policies, seed = 5, glue }) => {
  const first = new AI.Rng(`${seed}:first`);
  let fixed = false;
  const t = botTable(M, data, { ...scenario, map: 'none' }, {
    seed, policies, glue,
    dice: (pool, label) => (!fixed || /First Player/.test(label) ? Object.entries(pool).flatMap(([color, n]) => Array.from({ length: n }, () => ({ color, face: first.int(data.dice.dice[color].sides) }))) : blank(pool)),
  });
  await t.run({ until: (st) => M.SU.normaliseSetup(st.setup)?.stage === 'done' });
  fixed = true;
  const landed = [];
  t.watch((cmd) => landed.push(cmd));
  const U = Object.fromEntries(t.state.tokens.map((x) => [name(x), x]));
  const at = (x, c, r, f) => { x.col = c * 3; x.row = r * 3; if (f !== undefined) x.facing = f; };
  at(U.Volcano, 5, 5, 2); at(U.Dune, 0, 0, 2); at(U.Reaper, 2, 2, 2); at(U.Wolf, 5, 7, 0); at(U.Cat, 11, 11, 0);
  const sc = t.state.script;
  t.state.round.phase = 2; sc.stage = '1:2'; sc.acted = []; sc.opp = null; sc.revealed = ['s1', 's2']; sc.passed = [];
  for (const x of t.state.tokens) if (x.kind === 'mech') x.timing = 'firing';
  const turnOf = (mech, timing) => {
    mech.timing = timing;
    sc.acted = t.state.tokens.filter((x) => x.kind === 'mech' && x.uid !== mech.uid).map((x) => x.uid);
    sc.opp = null;
    return M.G.opportunity(data, t.state);
  };
  return { t, U, at, turnOf, landed };
};
{
  // A Riposte through the window: the blow is struck and the attacker's turn is over.
  const x = await table({ policies: { s1: script((d) => (d.kind === 'reaction.answer' ? 'riposte:050_A' : null)), s2: script((d) => (d.kind === 'opp.act' ? d.options.find((o) => o.tags.includes('end'))?.id ?? null : null)) } });
  x.at(x.U.Volcano, 5, 5, 2); x.at(x.U.Wolf, 5, 6, 0);
  x.turnOf(x.U.Wolf, 'melee');
  x.t.state.script.reactions = [debt(x.U, 'riposte')];
  const end = await x.t.run({ until: (st) => x.landed.some((c) => c.kind === 'setCombatView' && c.view === null) && !st.script.combatView, maxSteps: 200 });
  const views = x.landed.filter((c) => c.kind === 'setCombatView' && c.view).map((c) => [c.view.attackerUid, c.view.targetUid, c.view.actionId]);
  check('PLAYED: the Volcano answers a Parry with its Riposte: the Wolf\'s Opportunity ends at once, the Grappling Hook is struck at the Wolf through the window for no Tick, and nothing is refused',
    [end.kind, x.t.refused, x.landed.slice(0, 2).map((c) => c.kind), x.landed[1].granted, views[0], x.t.state.script.reactions, x.t.state.script.acted.includes(x.U.Wolf.uid)],
    ['paused', [], ['riposte', 'performAction'], true, [x.U.Volcano.uid, x.U.Wolf.uid, '050_A'], [], true]);
  x.t.close();
}
{
  // A round's end through two drivers, on the page's glue.
  const x = await table({ policies: AI.legalPolicy, glue: M.HUD.glueAfter });
  const st = x.t.state;
  st.round.phase = 5; st.script.stage = '1:5'; st.script.acted = []; st.script.opp = null;
  st.smoke = [{ col: 2, row: 2, side: 's1' }, { col: 3, row: 2, side: 's1' }, { col: 4, row: 2, side: 's1' }, { col: 8, row: 8, side: 's1' }, { col: 9, row: 2, side: 's2' }, { col: 9, row: 3, side: 's2' }];
  const first = st.round.firstPlayer;
  const end = await x.t.run({ until: (now) => now.round.n === 2, maxSteps: 200 });
  const thinned = x.landed.filter((c) => c.kind === 'removeSmoke').map((c) => c.side);
  check('PLAYED: both seats give up a Screen of their own group as the round ends, the First Player before the other, and the next round begins: of six Screens the lone one and one of each group are gone',
    [end.kind, x.t.refused, thinned, st.smoke.length, st.smoke.filter((s2) => s2.side === 's1').length, x.landed.filter((c) => c.kind === 'dissipateSmoke').length],
    ['paused', [], [first, first === 's1' ? 's2' : 's1'], 3, 2, 1]);
  check('each removal was sent by the squad whose Screen it was', x.landed.filter((c) => c.kind === 'removeSmoke').every((c) => c.seat === c.side), true);
  x.t.close();
}

// ---------- what the Tactician makes of it ----------
{
  const tact = AI.makeTactician({ focus: false });
  const staged = async ({ seat = 's1', arrange }) => {
    const x = await table({ policies: AI.eagerPolicy, seed: 2 });
    arrange(x);
    const d = x.t.drivers[seat].pending();
    const pick = (p = tact) => { const c = p.choose(d, viewOf(x.t.state, seat), new AI.Rng('pick')); return { ...c, o: d.options.find((o) => o.id === c.option) }; };
    return { ...x, d, pick };
  };
  // Emergency Smoke: a gun still to fire on it, or none.
  const shot = await staged({ arrange: (x) => { x.at(x.U.Reaper, 5, 7, 0); x.at(x.U.Wolf, 5, 10, 0); x.at(x.U.Cat, 5, 4, 2); x.turnOf(x.U.Wolf, 'firing'); x.t.state.script.reactions = [debt(x.U, 'smoke')]; } });
  const took = shot.pick();
  check('THE TACTICIAN TAKES EMERGENCY SMOKE WHERE IT IS WORTH ITS ONE USE: shot at by a Mech whose turn is still open, with a second gun on it, the Reaper puts a Screen on its own Grid; and one Screen, where a second would hide it no better',
    [shot.d.kind, took.reason, took.o.facts.cells, took.o.tags], ['reaction.answer', 'smoke_for_cover', [{ c: 5, r: 7 }], ['reaction', 'smoke']]);
  const safe = await staged({ arrange: (x) => { x.at(x.U.Reaper, 0, 6, 0); x.at(x.U.Wolf, 11, 0, 0); x.at(x.U.Cat, 11, 11, 0); for (const u of [x.U.Wolf, x.U.Cat]) u.partStates = { ...u.partStates, leftHand: 'destroyed', rightHand: 'destroyed' }; x.turnOf(x.U.Wolf, 'firing'); x.t.state.script.reactions = [debt(x.U, 'smoke')]; } });
  check('and keeps it where nothing could be done to the unit anyway: the use is not spent on a Screen that hides it from nobody',
    [safe.pick().reason, safe.pick().o.id], ['smoke_kept', 'decline']);
  check('a policy with no rule for it declines: the safe answer', [shot.pick(AI.safePolicy).o.id, shot.d.fallback], ['decline', 'decline']);
  const unscreened = AI.makeTactician({ focus: false, screen: false });
  const calm = AI.makeTactician({ focus: false, emergency: false });
  check('and so does the Tactician with that skill switched off (`emergency`: how the play is measured, on against off); the switch for the thrown Grenade (`screen`) is another, and leaves this alone',
    [AI.SKILLS.emergency, AI.SKILLS.screen, shot.pick(calm).o.id, shot.pick(unscreened).reason], [true, true, 'decline', 'smoke_for_cover']);
  shot.t.close(); safe.t.close();
  // A Riposte: the blow worth most.
  const parry = await staged({ arrange: (x) => { x.at(x.U.Volcano, 5, 5, 2); x.at(x.U.Wolf, 5, 6, 0); x.turnOf(x.U.Wolf, 'melee'); x.t.state.script.reactions = [debt(x.U, 'riposte')]; } });
  const blows = parry.d.options.filter((o) => o.run).map((o) => ({ id: o.id, pen: o.chance().pen }));
  const best = blows.reduce((a, b) => (b.pen > a.pen ? b : a));
  check('A RIPOSTE IS TAKEN, with the blow worth most: each Melee Action it may strike carries its own odds, and the Tactician strikes the better',
    [blows.length, blows.every((b) => b.pen > 0), parry.pick().reason, parry.pick().o.tags.includes('attack'), parry.pick().o.id === best.id], [2, true, 'riposte_by_value', true, true]);
  const reach = await staged({ arrange: (x) => { x.at(x.U.Volcano, 5, 5, 2); x.at(x.U.Wolf, 5, 10, 0); x.turnOf(x.U.Wolf, 'firing'); x.t.state.script.reactions = [debt(x.U, 'riposte')]; } });
  check('and with the attacker out of reach it still ends that Opportunity', [reach.pick().o.id, reach.pick().reason], ['riposte:end', 'riposte_ends_turn']);
  check('a policy with no rule for it takes the safe answer, which is the Riposte', [parry.pick(AI.safePolicy).o.id, reach.pick(AI.safePolicy).o.id], ['riposte:050_A', 'riposte:end']);
  parry.t.close(); reach.t.close();
  // The Screen to give up.
  const thin = (smoke, units) => {
    const view = { seat: 's1', units: units.map(([col, row], i) => ({ uid: i + 1, side: 's1', alive: true, deployed: true, kind: 'mech', grid: { col, row } })) };
    const d = { kind: 'smoke.thin', seat: 's1', options: smoke.map(([c, r]) => ({ id: `thin:${c},${r}`, tags: ['smoke', 'remove'], facts: { cell: { c, r } } })), fallback: `thin:${smoke[0][0]},${smoke[0][1]}`, facts: {} };
    return tact.choose(d, view, new AI.Rng('t')).option;
  };
  check('THE SCREEN GIVEN UP is one none of its units stands in, and of those the one furthest from any of them; where every Screen hides somebody, it gives up the first',
    [thin([[2, 2], [3, 2], [4, 2]], [[2, 2]]), thin([[2, 2], [3, 2], [4, 2]], [[4, 2]]), thin([[2, 2], [3, 2], [4, 2]], [[3, 2], [9, 9]]), thin([[2, 2], [3, 2]], [[2, 2], [3, 2]])],
    ['thin:4,2', 'thin:2,2', 'thin:2,2', 'thin:2,2']);
  // Cover: a Smoke Grenade at its own feet.
  const cover = await staged({ arrange: (x) => {
    x.at(x.U.Volcano, 5, 5, 2); x.at(x.U.Wolf, 5, 9, 0); x.at(x.U.Cat, 9, 5, 3);
    // Nothing to attack with: the Volcano's arms are gone, and its Torso's Grenade is what it has.
    x.U.Volcano.partStates = { ...x.U.Volcano.partStates, leftHand: 'destroyed', rightHand: 'destroyed' };
    x.turnOf(x.U.Volcano, 'projectile');
  } });
  const rows = AI.weighed(cover.d, viewOf(cover.t.state, 's1'), { focus: false });
  const screen = rows.find((p) => p.how === 'screen');
  const stay = rows.find((p) => p.how === 'stay');
  check('A SMOKE GRENADE IS A WAY OF TAKING COVER: with two guns on it and nothing to strike back with, the plan to put a Screen on its own Grid is weighed, and standing there costs less behind it',
    [!!screen, /GS-2 Smoke Grenade to F6, then .*: a Smoke Screen in F6, and it is removed$/.test(screen.label), screen.cost < stay.cost - 0.2, screen.at], [true, true, true, { col: 5, row: 5 }]);
  check('the Screen is not free: the plan is charged what its one use is worth keeping, so it is thrown only where it saves more than that',
    [screen.now, screen.next === stay.next], [-0.1, true]);
  const chosen = cover.pick();
  check('and it is the plan chosen where that is worth more than anything else its Tick would buy', [chosen.o.tags.includes('smoke'), chosen.reason, chosen.o.facts.to], [true, 'smoke_for_cover', { c: 5, r: 5 }]);
  check('with its skill off (`screen`) no such plan is weighed and the Grenade is not thrown; the switch for Emergency Smoke leaves it alone',
    [AI.weighed(cover.d, viewOf(cover.t.state, 's1'), { focus: false, screen: false }).some((p) => p.how === 'screen'), cover.pick(unscreened).o.tags.includes('smoke'), cover.pick(calm).reason], [false, false, 'smoke_for_cover']);
  const idle = await staged({ arrange: (x) => {
    x.at(x.U.Volcano, 0, 6, 2); x.at(x.U.Wolf, 11, 0, 0); x.at(x.U.Cat, 11, 11, 0);
    for (const u of [x.U.Wolf, x.U.Cat]) u.partStates = { ...u.partStates, leftHand: 'destroyed', rightHand: 'destroyed' };
    x.turnOf(x.U.Volcano, 'projectile');
  } });
  check('with nobody able to do anything to it, the Grenade is kept', [idle.pick().o.tags.includes('smoke'), AI.weighed(idle.d, viewOf(idle.t.state, 's1'), { focus: false }).some((p) => p.how === 'screen' && p.worth > 0 && p.priced && p.cost > 0)], [false, false]);
  cover.t.close(); idle.t.close();
}

// ---------- the seam's own text ----------
{
  const seam = await src('owed.ts');
  const hud = await src('matchhud.ts');
  // (A Forced Movement this seat owes comes between, as the panel ranks it: M8.2t.)
  check('the removal is asked where the Match Centre\'s panel asks it: before a Forced Movement, an Interception and everything after them',
    /if \(state\.script\.combatView\) return null;[\s\S]{0,400}const thin = smokeOwed\(data, state, seat\);\n\s+if \(thin !== undefined\) return thin;\n(?:\s+\/\/[^\n]*\n)*\s+const shoved = shoveOwed\(data, state, seat, mind\);\n\s+if \(shoved\) return shoved;\n\s+if \(liveIntercepts\(state\)\.length\) return interceptOwed\(data, state, seat\);/.test(seam), true);
  check('and the panel reads the Screens a group has left from turn.ts, where a seat with no panel reads them too',
    /function smokeOwedCells\(state: GameState\): \{ col: number; row: number \}\[\] \{\n\s+return turn\.smokeOwedCells\(state\);\n\}/.test(hud), true);
}

// ---------- whole games, on the page's glue ----------
{
  const tally = { games: 0, over: 0, refused: 0, broken: [], sent: {}, asked: {} };
  const bump = (bag, k) => { bag[k] = (bag[k] ?? 0) + 1; };
  // The seeds are the ones a probe found Smoke in (`tests/_smokegames.mjs`):
  // the eager seat takes Emergency Smoke as a pair, which is a group to thin.
  for (const [policy, seeds] of [['legal', [1, 2]], ['eager', [4, 5, 6]], ['brawler', [6]], ['tactician', [1, 3]]]) {
    for (const seed of seeds) {
      const t = botTable(M, data, scenario, { seed, policies: AI[`${policy}Policy`], glue: M.HUD.glueAfter });
      t.watch((cmd) => {
        if (cmd.kind === 'placeSmoke' || cmd.kind === 'removeSmoke' || cmd.kind === 'riposte' || cmd.kind === 'dissipateSmoke') bump(tally.sent, cmd.kind);
        if (cmd.kind === 'launch' && cmd.cardId === '268') bump(tally.sent, 'launch:268');
      });
      let end;
      try {
        end = await t.run({ maxSteps: 12000, onStep: (seat, r) => { if (r.decision.kind === 'smoke.thin' || r.decision.kind === 'reaction.answer') bump(tally.asked, r.decision.kind === 'smoke.thin' ? 'thin' : r.decision.facts.reaction); } });
      } catch (err) { end = { kind: 'threw', why: `${err?.message ?? err}`.split('\n')[0] }; } finally { t.close(); }
      tally.games += 1;
      if (end.kind === 'over') tally.over += 1; else tally.broken.push(`${policy} ${seed}: ${end.kind} ${end.why ?? ''} ${end.decision ?? ''}`);
      tally.refused += t.refused.length;
    }
  }
  check('EIGHT GAMES with a Smoke Grenade, a Grappler and a Reaper in them, on the page\'s own glue, four policies: every one ends as a game should, nothing refused',
    [tally.over, tally.games, tally.refused, tally.broken], [8, 8, 0, []]);
  check('Smoke was launched and its Screens put down in them, Emergency Smoke was asked about, and every Screen a round\'s end owed was given up by the seat asked',
    [(tally.sent['launch:268'] ?? 0) > 0, (tally.sent.placeSmoke ?? 0) > 0, (tally.sent.dissipateSmoke ?? 0) > 0, (tally.asked.smoke ?? 0) > 0, (tally.asked.thin ?? 0) > 0, (tally.asked.thin ?? 0) === (tally.sent.removeSmoke ?? 0)],
    [true, true, true, true, true, true]);
  console.log(`       sent ${JSON.stringify(tally.sent)}; asked ${JSON.stringify(tally.asked)}`);
}

console.log(`\n${pass} passed, ${fail} failed`);
M.L.setLocalSeat(null);
if (fail) process.exit(1);
