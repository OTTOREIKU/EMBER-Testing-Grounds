// The "White Dwarf" Bit, answered by a seat (293, 294, 295 and the Bit Port
// 292_A; ruling I23; AI-OPPONENT-PLAN.md, M8.2o).
//
// The Bit is ONE Drone printed on three cards, one per Stance, and its Swift
// "Stance Change" says "Switch the Stance and perform one movement". The
// Match Centre asks the face in a panel, pays the Action, sends `switchForm`
// and opens its planner on the one free Movement the Action leaves owed. The
// White Dwarf's Bit Port launches a Bit in any of its Stances while it holds
// its Token, and an empty Port recovers one in Range. The seam passed the Port
// over and offered no Stance Change; now it offers each as whole answers: a
// launch for each face and Landing Point, a recover for each Bit in Range, and
// for each other face the turn where it stands and every walk that face's own
// Movement makes, worked out on the table after the switch.
import { readFileSync } from 'node:fs';
import { botTable, loadEngine } from './_engine.mjs';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}\n       got  ${g}`); }
};

console.log('The "White Dwarf" Bit\n');

const { M, data } = await loadEngine('seatbit', ["export * as SEAT from '../src/seat';", "export * as TURN from '../src/turn';", "export * as AI from '../src/ai/index';", "export * as HUD from '../src/matchhud';"]);
const AI = M.AI;
const T = M.TURN;
const viewOf = (state, seat) => M.SEAT.viewOf(data, state, seat);
const src = (f) => readFileSync(new URL(f, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

const rifle = (name) => ({ name, loadout: { torso: '539', chasis: '099', leftHand: '540', rightHand: '541', backpack: '538', pilot: 'LPA-23-2' } });
const DWARF = { name: 'Dwarf', loadout: { torso: '287', chasis: '289', leftHand: '291', rightHand: '290', backpack: '292', pilot: 'ACE-01' } };
data.solo.squads['o-dwarf'] = { name: 'Dwarf', faction: 'GOF', points: 0, mechs: [DWARF], drones: [] };
data.solo.squads['o-rifles'] = { name: 'Riflemen', faction: 'UN', points: 0, mechs: [rifle('Wolf'), rifle('Cat')], drones: [] };
const scenario = { ...data.solo.scenarios[0], id: 't-bit', seats: { s1: 'o-dwarf', s2: 'o-rifles' } };
const FACES = ['293', '294', '295'];
const portAction = data.byId.get('292').actions.find((a) => a.id === '292_A');
const grid = (x) => ({ c: Math.floor(x.col / 3), r: Math.floor(x.row / 3) });
const apart = (a, b) => Math.abs(a.c - b.c) + Math.abs(a.r - b.r);

// A table past its setup on an open board. `stage` puts the units where it is
// told; `action` gives the Dwarf the Action Phase on its Projectile dial.
const table = async (where, policies = AI.tacticianPolicy) => {
  const t = botTable(M, data, { ...scenario, map: 'none' }, { seed: 3, policies, glue: M.HUD.glueAfter });
  await t.run({ until: (st) => M.SU.normaliseSetup(st.setup)?.stage === 'done' });
  const s = t.state;
  const U = Object.fromEntries(s.tokens.map((x) => [x.label, x]));
  // A unit stands from the top-left cell of its Grid: a Large one fills it.
  const at = (x, c, r, f) => { x.col = c * 3; x.row = r * 3; if (f !== undefined) x.facing = f; };
  for (const [k, v] of Object.entries(where)) at(U[k], ...v);
  const send = (cmds) => cmds.map((cmd) => { const v = M.C.perform(data, s, cmd); if (v.ok) M.HUD.glueAfter(data, s, cmd); return v.ok; });
  const action = (round = 1) => {
    s.round.n = round; s.round.phase = 2; s.script.stage = `${round}:2`; s.script.opp = null; s.script.revealed = ['s1', 's2']; s.script.passed = [];
    for (const x of s.tokens) if (x.kind === 'mech') x.timing = 'firing';
    U.Dwarf.timing = 'projectile';
    s.script.acted = s.tokens.filter((x) => x.kind === 'mech' && x.uid !== U.Dwarf.uid).map((x) => x.uid);
    M.G.opportunity(data, s);
    return t.drivers.s1.pending();
  };
  // The Command Phase of a round, the Bit designated with a Command.
  const command = (bit, round = 2) => {
    if (s.script.opp) M.C.perform(data, s, { kind: 'endOpportunity', seat: 's1', uid: s.script.opp.uid });
    s.round.n = round; s.round.phase = 0; s.script.stage = `${round}:0`; s.script.opp = null; s.script.acted = []; s.script.passed = []; s.script.commanded = []; s.script.turn = 's1';
    U.Dwarf.statuses = [...(U.Dwarf.statuses ?? []).filter((x) => x !== 'commandUsed'), 'command'];
    M.G.enterPhase(data, s);
    const loop = t.drivers.s1.pending();
    const des = loop?.options.find((o) => o.id === `designate:${bit.uid}`);
    if (des) send(des.commands);
    return { loop, d: t.drivers.s1.pending() };
  };
  return { t, s, U, at, send, action, command };
};
const launches = (d, face) => d.options.filter((o) => o.tags[0] === 'launch' && (!face || o.facts.cardId === face));

// ---------- the cards ----------
{
  const bit = (id) => data.byId.get(id);
  check('the cards are what the test means them to be: the Port launches or recovers one of the three faces within Range 6, and each face\'s Stance Change turns it into another; Mobility moves 8, the others 6',
    [M.U.bitPortOf(portAction), FACES.map((id) => M.U.formSwitch(bit(id).actions.find((a) => a.type === 'Swift'))), FACES.map((id) => bit(id).move), portAction.storage],
    [{ formIds: FACES, range: 6 }, [FACES, FACES, FACES], [6, 8, 6], 1]);
}

// ---------- the Bit Port, with its Token ----------
{
  const x = await table({ Dwarf: [5, 5, 2], Wolf: [5, 10, 0], Cat: [9, 10, 0] });
  const d = x.action();
  const here = grid(x.U.Dwarf);
  const lit = T.landingGrids(data, x.s, x.U.Dwarf, portAction).filter((g) => g.ok);
  check('A PORT WITH ITS TOKEN LAUNCHES A BIT IN ANY OF ITS STANCES: a launch for each face at each Landing Point the launch panel lights, within Range 6',
    [FACES.map((f) => launches(d, f).length === lit.length), lit.length > 50, launches(d).every((o) => apart(o.facts.to, here) <= 6)], [[true, true, true], true, true]);
  const one = launches(d, '293').find((o) => o.facts.to.c === 5 && o.facts.to.r === 7);
  check('each is the Action paid and the face launched, marked as a Bit, and strikes as far as that face\'s own Action reaches (6, 2, none)',
    [one?.commands.map((c) => [c.kind, c.actionId, c.cardId ?? null]), one?.tags.includes('bit'), FACES.map((f) => launches(d, f)[0]?.facts.strike)],
    [[['performAction', '292_A', null], ['launch', '292_A', '293']], true, [6, 2, 0]]);
  check('the engine takes it: the Bit stands there, an Offensive Drone of this squad, and the Port\'s Token is spent',
    [x.send(one.commands), (() => { const b = x.s.tokens.find((y) => y.cardId === '293'); return b && [b.kind, b.side, grid(b)]; })(), x.U.Dwarf.ammo['292_A']],
    [[true, true], ['drone', 's1', { c: 5, r: 7 }], 0]);
  const after = x.t.drivers.s1.pending();
  check('and the Port is offered nothing more this activation: its Action is performed', launches(after).length + after.options.filter((o) => o.tags[0] === 'recover').length, 0);
  x.t.close();
}

// ---------- the Stance Change ----------
{
  const x = await table({ Dwarf: [5, 5, 2], Wolf: [5, 12, 0], Cat: [9, 12, 0] });
  x.send(launches(x.action(), '293').find((o) => o.facts.to.c === 5 && o.facts.to.r === 7).commands);
  const bit = x.s.tokens.find((y) => y.cardId === '293');
  const { loop, d } = x.command(bit);
  check('the Bit is commanded in the Command Phase as any Drone is', [loop?.kind, d?.kind, d?.unit], ['loop.designate.command', 'activation.act', bit.uid]);
  const forms = d.options.filter((o) => o.tags.includes('form'));
  const stays = forms.filter((o) => o.tags[0] === 'form');
  const walks = (face) => forms.filter((o) => o.tags[0] === 'move' && o.facts.into === face);
  check('ITS STANCE CHANGE IS OFFERED FOR EACH OTHER FACE: the turn where it stands, the Action paid and the card turned over, and none to the face it has',
    [stays.map((o) => [o.facts.into, o.commands.map((c) => c.kind)]), forms.some((o) => o.facts.into === '293')],
    [[['294', ['performAction', 'switchForm']], ['295', ['performAction', 'switchForm']]], false]);
  // The walk each face owes, worked out on the table after the switch.
  const reach = (face) => {
    const pay = stays.find((o) => o.facts.into === face).commands;
    const table2 = M.G.tableAfter(data, x.s, pay);
    const turned = table2.tokens.find((y) => y.uid === bit.uid);
    const start = T.moveStart(data, table2, turned, { actionId: '293_B' });
    const lit2 = T.reachableFor(data, table2, turned, start.steps, start.flying, '293_B').filter((g) => !(g.c === grid(bit).c && g.r === grid(bit).r));
    return { steps: start.steps, lit: lit2.map((g) => `${g.c},${g.r}`).sort() };
  };
  const ends = (face) => [...new Set(walks(face).map((o) => `${o.facts.to.c},${o.facts.to.r}`))].sort();
  const mob = reach('294');
  const def = reach('295');
  check('AND THE ONE MOVEMENT IT OWES, MADE BY THE FACE IT TURNS TO: as Mobility every Grid 8 reaches, as Defensive every Grid 6 reaches, the Grids the planner would light',
    [mob.steps, def.steps, ends('294').length === mob.lit.length && ends('294').every((k) => mob.lit.includes(k)), ends('295').length === def.lit.length && ends('295').every((k) => def.lit.includes(k)), ends('294').length > ends('295').length],
    [8, 6, true, true, true]);
  // What an asker that names its kinds is given.
  const only = (kinds) => M.SEAT.owed(data, x.s, 's1', M.SEAT.newMind(), { only: kinds })?.options ?? [];
  check('an asker that wants only attacks is given no Stance Change; one that wants Movements is given every walk of it',
    [only(['attack']).some((o) => o.tags.includes('form')), only(['move']).filter((o) => o.tags.includes('form') && o.tags[0] === 'move').length === forms.filter((o) => o.tags[0] === 'move').length],
    [false, true]);
  const w = walks('294').find((o) => o.facts.grids === 8);
  check('a walk is the payment, the switch and the free Movement on the Tick the Action paid',
    [w?.commands.map((c) => c.kind), w?.commands[2]?.free, w?.commands[2]?.actionId], [['performAction', 'switchForm', 'maneuver'], true, '293_B']);
  check('the engine takes the whole of it: the Bit is the Mobility card where the walk ends, and the Movement it owed is spent',
    [x.send(w.commands), bit.cardId, grid(bit), !!x.s.script.opp?.moveOwed], [[true, true, true], '294', w.facts.to, false]);
  check('and its activation is then over but for its end', x.t.drivers.s1.pending()?.options.map((o) => o.id), ['end']);
  // The turn where it stands, on another table.
  const y = await table({ Dwarf: [5, 5, 2], Wolf: [5, 12, 0], Cat: [9, 12, 0] });
  y.send(launches(y.action(), '294').find((o) => o.facts.to.c === 5 && o.facts.to.r === 7).commands);
  const b2 = y.s.tokens.find((z) => z.cardId === '294');
  const c2 = y.command(b2);
  const stay = c2.d.options.find((o) => o.tags[0] === 'form' && o.facts.into === '295');
  check('turned where it stands: the Defensive card, the same unit with what it carries, in the same Grid',
    [y.send(stay.commands), b2.cardId, b2.uid, grid(b2), M.U.formSwitch(data.byId.get('294').actions.find((a) => a.type === 'Swift')).includes(b2.cardId)],
    [[true, true], '295', b2.uid, { c: 5, r: 7 }, true]);
  x.t.close(); y.t.close();
}

// ---------- the Bit Port, empty ----------
{
  const x = await table({ Dwarf: [5, 5, 2], Wolf: [5, 12, 0], Cat: [9, 12, 0] });
  x.send(launches(x.action(), '293').find((o) => o.facts.to.c === 5 && o.facts.to.r === 7).commands);
  const bit = x.s.tokens.find((y) => y.cardId === '293');
  // A second Bit of the squad's (another Port's) stands 8 Grids off: out of Range.
  const stray = { ...JSON.parse(JSON.stringify(bit)), uid: 900, col: 13 * 3 + 1, row: 5 * 3 + 1 };
  x.s.tokens.push(stray);
  const d = x.action(2);
  const recover = d.options.filter((o) => o.tags[0] === 'recover');
  check('AN EMPTY PORT RECOVERS A BIT OF ITS OWN IN RANGE: one answer for it, the Action paid and the recover, and none for the one out of Range; no launch while the Port is empty',
    [recover.map((o) => [o.facts.targetUid, o.commands.map((c) => c.kind)]), launches(d).length], [[[bit.uid, ['performAction', 'recoverBit']]], 0]);
  x.s.tokens = x.s.tokens.filter((y) => y.uid !== stray.uid);
  check('the engine takes it: the Bit leaves the board and the Port holds its Token again',
    [x.send(recover[0].commands), x.s.tokens.some((y) => y.uid === bit.uid), x.U.Dwarf.ammo['292_A']], [[true, true], false, 1]);
  const again = x.action(3);
  check('and the next activation may launch again, a new unit', [launches(again).length > 0, again.options.some((o) => o.tags[0] === 'recover')], [true, false]);
  // Out of Range there is nothing to recover, and the row is not live: the
  // page greys it the same way.
  const far = await table({ Dwarf: [5, 5, 2], Wolf: [5, 12, 0], Cat: [9, 12, 0] });
  far.send(launches(far.action(), '293').find((o) => o.facts.to.c === 5 && o.facts.to.r === 11).commands);
  const out = far.s.tokens.find((y) => y.cardId === '293');
  out.col = 12 * 3 + 1; out.row = 5 * 3 + 1;
  const d2 = far.action(2);
  check('a Bit 7 Grids away is not recovered, and the empty Port offers nothing',
    [apart(grid(out), grid(far.U.Dwarf)), d2.options.filter((o) => o.tags[0] === 'recover' || o.tags[0] === 'launch').length], [7, 0]);
  x.t.close(); far.t.close();
}

// ---------- the Tactician ----------
{
  // The riflemen down the board: a Mobility Bit landed two Grids from the Wolf
  // fires on it in the Automatic Phase, which is what a launch is worth.
  const x = await table({ Dwarf: [5, 4, 2], Wolf: [5, 10, 0], Cat: [11, 13, 0] });
  let d = x.action();
  const plans = AI.weighed(d, viewOf(x.s, 's1'), {});
  check('THE TACTICIAN PLANS A BIT AS WHAT ITS TURN WOULD DO: the plan worth most launches one whose Automatic gun reaches an enemy',
    /^a Projectile for .* at (Wolf|Cat)/.test(plans[0]?.does ?? ''), true);
  check('with its skill off (`bit`) no plan launches one', AI.weighed(d, viewOf(x.s, 's1'), { bit: false }).some((r) => /^a Projectile for/.test(r.does ?? '')), false);
  // Its steps: the Maneuver comes before the Action (3.4.5), then the launch.
  let o = null;
  for (let i = 0; i < 4 && !o; i++) {
    const pick = AI.tacticianPolicy.choose(d, viewOf(x.s, 's1'), new AI.Rng(`t${i}`));
    const step = d.options.find((y) => y.id === pick.option);
    if (!step?.commands) break;
    if (step.tags.includes('bit')) o = step;
    x.send(step.commands);
    d = x.t.drivers.s1.pending();
  }
  check('and it makes it: the Mobility face, landed within its gun\'s 2 Grids of an enemy',
    [o?.facts?.cardId, o ? Math.min(apart(o.facts.to, grid(x.U.Wolf)), apart(o.facts.to, grid(x.U.Cat))) <= 2 : false], ['294', true]);
  // Commanded, the Bit's walks are planned for each face it may turn to: two
  // faces ending in one Grid are two plans.
  const bit = x.s.tokens.find((y) => y.cardId === '294');
  const c = x.command(bit);
  const rows = AI.weighed(c.d, viewOf(x.s, 's1'), {});
  const faceOf = (label) => (/Offensive Stance\), and its Movement/.test(label) ? '293' : /Defensive Stance\), and its Movement/.test(label) ? '295' : null);
  const byGrid = new Map();
  for (const r of rows) {
    const f = faceOf(r.label ?? '');
    const g = /Movement to ([A-Z]\d+)/.exec(r.label ?? '')?.[1];
    if (f && g) byGrid.set(g, new Set([...(byGrid.get(g) ?? []), f]));
  }
  check('COMMANDED, ITS WALKS ARE PLANNED FOR EACH FACE IT MAY TURN TO: some Grid is planned twice, as the Offensive face and as the Defensive one',
    [[...byGrid.values()].some((s) => s.size === 2)], [true]);
  const rowsOff = AI.weighed(c.d, viewOf(x.s, 's1'), { bit: false });
  check('and with the skill off none is', rowsOff.some((r) => faceOf(r.label ?? '')), false);
  check('a face taken where it stands is a plan of its own, as a Mode is; not with the skill off',
    [rows.filter((r) => r.how === 'form').length, rowsOff.some((r) => r.how === 'form')], [2, false]);
  x.t.close();
}

// ---------- the register ----------
{
  const cover = src('./aicover.mjs');
  check('the coverage register has the switch and the recover as answers a seat gives',
    [/switchForm: \['seat'/.test(cover), /recoverBit: \['seat'/.test(cover)], [true, true]);
}

// ---------- whole games ----------
// The Tactician launches a Bit for the gun its turn has and sees nothing to
// buy in another face (a Low Value unit is worth nothing to its price list),
// so beside the four policies a seat that takes every Bit answer it is offered
// plays: it launches, commands the Bit, turns it and recovers it, by lot among
// those, and is the Tactician otherwise. Every one of those answers then runs
// through the engine in whole games, to their end.
const keeper = {
  name: 'keeper',
  choose(d, view, rng) {
    const bits = new Set(view.units.filter((u) => FACES.includes(u.cardId)).map((u) => u.uid));
    // The White Dwarf on its Projectile dial, where its Port acts.
    const dwarf = view.units.find((u) => u.side === view.seat && u.kind === 'mech' && u.cardId === '287');
    for (const want of [(o) => o.tags.includes('bit'), (o) => o.tags[0] === 'recover', (o) => o.tags.includes('form'), (o) => o.tags[0] === 'designate' && bits.has(o.facts?.uid),
      (o) => d.kind === 'planning.dial' && d.unit === dwarf?.uid && o.tags.includes('timing:projectile')]) {
      const xs = d.options.filter(want);
      if (xs.length) return { option: xs[Math.floor(rng.next() * xs.length)].id, why: 'every Bit answer it may' };
    }
    return AI.tacticianPolicy.choose(d, view, rng);
  },
};
M.L.setLocalSeat(null);
{
  data.solo.squads['o-eagles'] = { name: 'Eagles', faction: 'GOF', points: 0, mechs: [
    { name: 'Tracer', loadout: { torso: '174', chasis: '179', leftHand: 'ZHLA-101', pilot: 'ZPA-43' } }, DWARF], drones: [{ cardId: 'ZHDR-206' }, { cardId: 'ZYDR-108' }] };
  const games = { ...scenario, id: 't-bit-games', seats: { s1: 'o-eagles', s2: 'o-rifles' } };
  const tally = { games: 0, over: 0, refused: 0, broken: [], launched: 0, switched: 0, recovered: 0 };
  for (const [policy, seeds] of [['legal', [1, 2]], ['eager', [1]], ['brawler', [1]], ['tactician', [1, 2]], ['keeper', [1, 2]]]) {
    for (const seed of seeds) {
      const t = botTable(M, data, games, { seed, policies: { s1: policy === 'keeper' ? keeper : AI[`${policy}Policy`], s2: AI.brawlerPolicy }, glue: M.HUD.glueAfter });
      t.watch((cmd) => {
        if (cmd.kind === 'launch' && FACES.includes(cmd.cardId)) tally.launched += 1;
        if (cmd.kind === 'switchForm') tally.switched += 1;
        if (cmd.kind === 'recoverBit') tally.recovered += 1;
      });
      let end;
      try { end = await t.run({ maxSteps: 16000 }); } catch (err) { end = { kind: 'threw', why: `${err?.message ?? err}`.split('\n')[0] }; } finally { t.close(); }
      tally.games += 1;
      if (end.kind === 'over') tally.over += 1; else tally.broken.push(`${policy} ${seed}: ${end.kind} ${end.why ?? ''} ${end.decision ?? ''}`);
      tally.refused += t.refused.length;
    }
  }
  check('EIGHT GAMES with the White Dwarf in them, on the page\'s glue, five policies: every one ends as a game should, nothing refused, and Bits were launched, turned and recovered in them',
    [tally.over, tally.games, tally.refused, tally.broken, tally.launched > 0, tally.switched > 0, tally.recovered > 0], [8, 8, 0, [], true, true, true]);
  console.log(`       launched ${tally.launched}, switched ${tally.switched}, recovered ${tally.recovered}`);
}

console.log(`\n${pass} passed, ${fail} failed`);
M.L.setLocalSeat(null);
if (fail) process.exit(1);
