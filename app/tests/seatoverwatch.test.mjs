// The KK9's Overwatch Strike, answered by a seat (LHDR-KK9_B; FAQ K15;
// AI-OPPONENT-PLAN.md, M8.2h).
//
// "Designate 1 Enemy Unit within range as the target, allow 1 Ally Mech to
// immediately perform 1 Firing Action against it. Then remove this Drone." A
// TM39D Cobra launches the KK9 (TM39D_B); the KK9's Strike is a Command Action.
// The call names the enemy and the Mech, the KK9 leaves the board, and the
// Mech's seat owes one Firing Action at that enemy and no other, of any length
// and for no Ticks, granted as a Riposte's blow is. The Match Centre asks the
// call in a panel of enemies and Mechs and the Firing Action as a reaction. The
// seam offered neither: a computer's KK9 was launched and then stood there.
import { botTable, loadEngine, tableAtRoundOne } from './_engine.mjs';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}\n       got  ${g}`); }
};

console.log('The Overwatch Strike\n');

const { M, data } = await loadEngine('seatoverwatch', ["export * as SEAT from '../src/seat';", "export * as TURN from '../src/turn';", "export * as AI from '../src/ai/index';", "export * as HUD from '../src/matchhud';"]);
const { owed, newMind } = M.SEAT;
const T = M.TURN;
const AI = M.AI;
const clone = (x) => JSON.parse(JSON.stringify(x));

// UN: a Cobra (TM39D, which launches the KK9) and a Wolf, each with a gun in
// each hand. RDL: a Dune and a Sand.
const un = (name, torso) => ({ name, loadout: { torso, chasis: '099', leftHand: '540', rightHand: '541', backpack: '538', pilot: 'LPA-23-2' } });
const rdl = (name) => ({ name, loadout: { torso: '533', chasis: '534', leftHand: '535', rightHand: '536', backpack: '004', pilot: 'FPA-04-2' } });
data.solo.squads['t-eyes'] = { name: 'Eyes', faction: 'UN', points: 0, mechs: [un('Cobra', 'TM39D'), un('Wolf', '539')], drones: [] };
data.solo.squads['t-rdl'] = { name: 'Gunners', faction: 'RDL', points: 0, mechs: [rdl('Dune'), rdl('Sand')], drones: [] };
const scenario = { ...data.solo.scenarios[0], id: 't-overwatch', seats: { s1: 't-eyes', s2: 't-rdl' } };
const isKK9 = (t) => t.cardId === 'LHDR-KK9';
const name = (t) => (isKK9(t) ? 'KK9' : t.label);

const run = (state, cmd) => {
  const v = M.C.check(data, state, cmd);
  if (v.ok) { M.C.apply(data, state, cmd); M.G.glueAfter(data, state, cmd); }
  return v;
};
const sendAll = (state, commands) => commands.map((c) => run(state, c).ok);
const ids = (list) => list.map((o) => o.id);
const calls = (d) => (d ? d.options.filter((o) => o.tags[0] === 'overwatch') : []);
const pays = (unit, key, extra = {}) => ({ kind: 'performAction', seat: unit.side, uid: unit.uid, actionId: key, partKey: key, ...extra });

M.L.setLocalSeat(null);
const base = (() => {
  const t = tableAtRoundOne(M, data, scenario);
  if (t.refused.length) throw new Error(t.refused.join('; '));
  return t.state;
})();
// A table on open ground: the two UN Mechs facing south, the Dune four Grids in
// front of the Cobra, the Sand out of the way; with a KK9 put down two Grids
// from the Dune (as the Cobra's launch would), in the phase named.
const stage = ({ phase = 0, kk9 = [4, 6] } = {}) => {
  const s = clone(base);
  s.map = 'none';
  const at = (t, c, r, f) => { t.col = c * 3; t.row = r * 3; if (f !== undefined) t.facing = f; };
  let U = Object.fromEntries(s.tokens.map((t) => [name(t), t]));
  at(U.Cobra, 3, 4, 2); at(U.Wolf, 5, 4, 2); at(U.Dune, 4, 8, 0); at(U.Sand, 11, 11, 0);
  if (kk9) {
    s.tokens.push({ ...M.U.makeDroneToken(s, data, data.byId.get('LHDR-KK9'), 's1'), col: kk9[0] * 3 + 1, row: kk9[1] * 3 + 1, facing: 2, parentUid: U.Cobra.uid });
    U = Object.fromEntries(s.tokens.map((t) => [name(t), t]));
  }
  s.round.phase = phase; s.script.stage = `1:${phase}`; s.script.acted = []; s.script.passed = []; s.script.opp = null;
  s.script.revealed = ['s1', 's2']; for (const t of s.tokens) if (t.kind === 'mech') t.timing = 'firing';
  const ask = (seat = 's1') => { M.L.setLocalSeat(seat); return owed(data, s, seat, newMind()); };
  const turnOf = (unit, timing) => {
    if (unit.kind !== 'mech') { s.script.opp = M.TY.newOpportunity(unit.uid, undefined); return ask(unit.side); }
    unit.timing = timing;
    s.script.acted = s.tokens.filter((x) => x.kind === 'mech' && x.uid !== unit.uid).map((x) => x.uid);
    s.script.opp = null;
    M.G.opportunity(data, s);
    return ask(unit.side);
  };
  return { s, U, at, ask, turnOf };
};

// ---------- the cards ----------
{
  const { U } = stage();
  const strike = data.byId.get('LHDR-KK9').actions.find((a) => a.id === 'LHDR-KK9_B');
  const launch = data.byId.get('TM39D').actions.find((a) => a.id === 'TM39D_B');
  check('the cards are what the test means them to be: the Cobra launches a KK9; the KK9\'s Overwatch Strike is a Command Action of Range 2, opened by a door of its own',
    [launch.type, M.U.launchableCards ? (launch.projectile ?? data.byId.get('TM39D').projectile) : null, strike.type, strike.range, strike.speed, T.actionRoute(data, U.KK9, strike), M.U.overwatchOf(strike)],
    ['Projectile', ['LHDR-KK9'], 'Tactic', 2, 'command', 'overwatch', true]);
}

// ---------- launched ----------
{
  const { s, U, ask, turnOf } = stage({ kk9: null, phase: 2 });
  const d = turnOf(U.Cobra, 'projectile');
  const launches = d.options.filter((o) => o.tags[0] === 'launch');
  check('THE COBRA LAUNCHES THE KK9 as a seat launches any Projectile: an answer for each Landing Point, and the Drone is on the board once one is sent',
    [launches.length > 0, launches.every((o) => o.facts.cardId === 'LHDR-KK9'), sendAll(s, launches[0].commands).every(Boolean), s.tokens.filter(isKK9).length], [true, true, true, 1]);
  void ask;
}

// ---------- the call ----------
{
  const { s, U, ask, turnOf } = stage();
  const d = turnOf(U.KK9);
  const o = calls(d).find((x) => x.facts.mechUid === U.Cobra.uid);
  check('THE KK9 COMMANDED, with an enemy within 2: one answer for each enemy in Range and each Ally Mech, the Action paid for and the call',
    [d.kind, ids(calls(d)), o.tags, o.commands, o.facts],
    ['activation.act', [`overwatch:LHDR-KK9_B:${U.Dune.uid}:${U.Cobra.uid}`, `overwatch:LHDR-KK9_B:${U.Dune.uid}:${U.Wolf.uid}`], ['overwatch'],
      [pays(U.KK9, 'LHDR-KK9_B'), { kind: 'overwatch', seat: 's1', uid: U.KK9.uid, actionId: 'LHDR-KK9_B', targetUid: U.Dune.uid, mechUid: U.Cobra.uid }],
      { uid: U.KK9.uid, actionId: 'LHDR-KK9_B', targetUid: U.Dune.uid, mechUid: U.Cobra.uid }]);
  const down = stage();
  down.U.Wolf.stance = 'shutdown';
  const far = stage({ kk9: [4, 4] });
  const auto = stage({ phase: 3 });
  check('none for a Mech in Shutdown (it performs nothing), none on an enemy out of Range, and none in the Automatic Phase, where a Command Action is not performed',
    [ids(calls(down.turnOf(down.U.KK9))).map((x) => x.endsWith(`:${down.U.Wolf.uid}`)), ids(calls(far.turnOf(far.U.KK9))), ids(calls(auto.turnOf(auto.U.KK9)))], [[false], [], []]);
  check('taken, the KK9 leaves the board and the Cobra owes one Firing Action at the Dune',
    [sendAll(s, o.commands), s.tokens.some(isKK9), s.script.reactions.map((r) => [r.kind, r.uid, r.fromUid])], [[true, true], false, [['overwatch', U.Cobra.uid, U.Dune.uid]]]);
  const owes = ask();
  const shot = owes.options.find((x) => x.tags.includes('attack'));
  check('THE FIRING ACTION IT OWES is asked of the Cobra\'s seat as a reaction: one attack for each Firing Action that reaches the Dune from where it stands, granted (no Ticks), and none; with no better idea the first is made',
    [owes.kind, owes.unit === U.Cobra.uid, owes.facts.reaction, shot.tags, shot.run.routine, shot.run.args.targetUid, shot.run.args.before, owes.fallback, owes.options.at(-1).id],
    ['reaction.answer', true, 'overwatch', ['reaction', 'overwatch', 'attack', 'firing'], 'attack', U.Dune.uid,
      [{ kind: 'performAction', seat: 's1', uid: U.Cobra.uid, actionId: shot.facts.actionId, granted: true }], shot.id, 'decline']);
  const guns = M.U.tokenCards(data, U.Cobra).flatMap(({ card }) => card.actions ?? []).filter((a) => a.type === 'Firing').map((a) => a.id);
  const reach = guns.filter((id) => (T.attackLines(data, s, { uid: U.Cobra.uid, actionId: id, only: U.Dune.uid })?.lines ?? []).some((l) => !l.blocked));
  check('the guns offered are the Firing Actions the board reads a line for, and no others', [owes.options.filter((x) => x.tags.includes('attack')).map((x) => x.facts.actionId).sort(), reach.sort()].map((x) => x.length > 0 ? x : null), [reach.sort(), reach.sort()]);
  const before = s.script.opp?.uid ?? null;
  check('the grant settles the debt as it is paid, and spends no Tick of anybody\'s Opportunity', [sendAll(s, shot.run.args.before), s.script.reactions, s.script.opp?.uid ?? null], [[true], [], before]);
}
{
  const { s, U, ask, turnOf } = stage();
  sendAll(s, calls(turnOf(U.KK9)).find((x) => x.facts.mechUid === U.Wolf.uid).commands);
  const owes = ask();
  check('declined, nothing is owed', [owes.options.at(-1).id, sendAll(s, owes.options.at(-1).commands), s.script.reactions], ['decline', [true], []]);
  M.L.setLocalSeat('s1');
  const q = stage();
  q.turnOf(q.U.KK9);
  check('the call answers to the kind `overwatch`', ids(owed(data, q.s, 's1', newMind(), { only: ['overwatch'] })?.options ?? []).length, 2);
}

// ---------- played, and the Tactician ----------
M.L.setLocalSeat(null);
{
  const viewOf = (state, seat) => M.SEAT.viewOf(data, state, seat);
  const SK = { focus: false };
  const tact = AI.makeTactician(SK);
  const script = (want) => ({ name: 'scripted', choose(d, view, rng) { const id = want(d, view); return id && d.options.some((o) => o.id === id) ? { option: id, why: 'scripted' } : AI.eagerPolicy.choose(d, view, rng); } });
  const table = async (policies, arrange) => {
    const t = botTable(M, data, { ...scenario, map: 'none' }, { seed: 3, policies, glue: M.HUD.glueAfter });
    await t.run({ until: (st) => M.SU.normaliseSetup(st.setup)?.stage === 'done' });
    const s = t.state;
    const at = (x, c, r, f) => { x.col = c * 3; x.row = r * 3; if (f !== undefined) x.facing = f; };
    let U = Object.fromEntries(s.tokens.map((x) => [name(x), x]));
    at(U.Cobra, 3, 4, 2); at(U.Wolf, 5, 4, 2); at(U.Dune, 4, 8, 0); at(U.Sand, 11, 11, 0);
    s.tokens.push({ ...M.U.makeDroneToken(s, data, data.byId.get('LHDR-KK9'), 's1'), col: 4 * 3 + 1, row: 6 * 3 + 1, facing: 2, parentUid: U.Cobra.uid });
    U = Object.fromEntries(s.tokens.map((x) => [name(x), x]));
    s.round.phase = 0; s.script.stage = '1:0'; s.script.acted = []; s.script.passed = []; s.script.opp = M.TY.newOpportunity(U.KK9.uid, undefined); s.script.turn = 's1';
    arrange?.({ s, U, at });
    return { t, s, U };
  };
  // Played through two drivers: the call, and the Wolf's shot in its window.
  const x = await table({
    s1: script((d) => (d.kind === 'reaction.answer' ? d.options.find((o) => o.tags.includes('attack'))?.id ?? null : calls(d).find((o) => o.facts.mechUid === x.U.Wolf.uid)?.id ?? null)),
    s2: AI.eagerPolicy,
  });
  const landed = [];
  x.t.watch((cmd) => landed.push(cmd));
  const steps = [];
  await x.t.run({ until: (st) => landed.some((c) => c.kind === 'setCombatView' && c.view === null) && !st.script.combatView, maxSteps: x.t.steps() + 40, onStep: (seat, r) => steps.push(`${seat}:${r.decision.kind}>${r.option.id}`) });
  const views = landed.filter((c) => c.kind === 'setCombatView' && c.view).map((c) => [c.view.attackerUid, c.view.targetUid]);
  check('PLAYED: the KK9 calls the strike, leaves the board, and the Wolf\'s shot is rolled out in its window at the Dune, granted; nothing refused',
    [steps[0], x.s.tokens.some(isKK9), landed.filter((c) => c.kind === 'performAction').map((c) => [c.uid, !!c.granted]), views[0], x.s.script.reactions ?? [], x.t.refused],
    [`s1:activation.act>overwatch:LHDR-KK9_B:${x.U.Dune.uid}:${x.U.Wolf.uid}`, false, [[x.U.KK9.uid, false], [x.U.Wolf.uid, true]], [x.U.Wolf.uid, x.U.Dune.uid], [], []]);
  x.t.close();

  // The Tactician's call.
  const y = await table(AI.eagerPolicy);
  const d = y.t.drivers.s1.pending();
  const rows = AI.weighed(d, viewOf(y.s, 's1'), SK);
  const stay = rows.find((p) => p.how === 'stay');
  const pick = tact.choose(d, viewOf(y.s, 's1'), new AI.Rng('pick'));
  check('THE TACTICIAN WEIGHS THE CALL AS A DEED: what the best shot it buys is worth, less the KK9 it costs; here that is worth making, and it is made',
    [/Overwatch Strike on/.test(stay.does), stay.now > 0, d.options.find((o) => o.id === pick.option)?.tags[0], pick.reason], [true, true, 'overwatch', 'overwatch_value']);
  // What the call is worth is what the shot it buys is worth to the Mech that makes it (its own
  // weighing of that question), less the KK9: a Drone with no Point Value, which costs nothing.
  const bought = Math.max(...calls(d).map((o) => AI.weighed(o.then(['reaction']), viewOf(y.s, 's1'), SK).find((p) => p.how === 'stay')?.now ?? 0));
  check('the call is worth the shot it buys, as the Mech that makes it weighs that shot, less the KK9 (a Drone with no Point Value, which costs nothing by the price list)',
    [Math.abs(stay.now - bought) < 1e-9, AI.unitWorth(viewOf(y.s, 's1').units.find((u) => u.uid === y.U.KK9.uid), viewOf(y.s, 's1'), AI.TACTICIAN)], [true, 0]);
  const off = AI.weighed(d, viewOf(y.s, 's1'), { ...SK, overwatch: false }).find((p) => p.how === 'stay');
  check('with its skill off (`overwatch`) it is no deed; and neither the safe answer nor the eager policy (no rule for it) calls one',
    [/Overwatch Strike/.test(off.does), [AI.safePolicy, AI.eagerPolicy].map((p) => d.options.find((o) => o.id === p.choose(d, viewOf(y.s, 's1'), new AI.Rng('x')).option)?.tags[0] === 'overwatch')], [false, [false, false]]);
  // Of the two Mechs, the one whose shot is worth more is the one it calls on.
  const shots = calls(d).map((o) => {
    const q = o.then?.(['reaction']);
    return { o, best: Math.max(0, ...(q?.options ?? []).filter((z) => z.run?.routine === 'attack').map((z) => AI.gainOf(z.chance(), M.SEAT.viewOf(data, y.s, 's1').units.find((u) => u.uid === y.U.Dune.uid), viewOf(y.s, 's1'), AI.TACTICIAN))) };
  });
  check('and of the Mechs it could call on, the one whose shot is worth most',
    d.options.find((o) => o.id === pick.option)?.facts.mechUid === shots.reduce((a, b) => (b.best > a.best ? b : a)).o.facts.mechUid, true);
  y.t.close();
  // The shot owed, made.
  const z = await table({ s1: script((dd) => (dd.kind === 'activation.act' ? calls(dd)[0]?.id ?? null : null)), s2: AI.eagerPolicy });
  await z.t.run({ until: () => z.t.drivers.s1.pending()?.kind === 'reaction.answer', maxSteps: z.t.steps() + 10 });
  const owes = z.t.drivers.s1.pending();
  const made = tact.choose(owes, viewOf(z.s, 's1'), new AI.Rng('pick'));
  check('the Firing Action a strike owes costs nothing: the Tactician makes the one worth most',
    [owes.facts.reaction, made.reason, owes.options.find((o) => o.id === made.option)?.tags.includes('attack')], ['overwatch', 'overwatch_shot', true]);
  z.t.close();
}

// ---------- whole games ----------
M.L.setLocalSeat(null);
{
  const tally = { games: 0, over: 0, refused: 0, broken: [], launched: 0, calls: 0, shots: 0 };
  // The scripted seat plays the KK9 on purpose: launched at the Landing Point
  // nearest an enemy, Commanded whenever it may be, the strike called and the
  // shot made; anything else it draws by lot. With the Tactician the KK9 is
  // used as it judges.
  const near = (view, at) => Math.min(...view.units.filter((u) => u.side !== view.seat && u.alive && u.deployed).map((u) => Math.abs(u.grid.col - at.c) + Math.abs(u.grid.row - at.r)));
  const keen = {
    name: 'keen',
    choose(d, view, rng) {
      const launches = d.options.filter((o) => o.tags[0] === 'launch' && o.facts?.cardId === 'LHDR-KK9' && o.facts?.to);
      if (launches.length) return { option: launches.reduce((a, b) => (near(view, b.facts.to) < near(view, a.facts.to) ? b : a)).id, why: 'scripted' };
      const kk9 = d.options.find((o) => o.tags[0] === 'designate' && /KK9/.test(view.units.find((u) => `designate:${u.uid}` === o.id)?.label ?? ''));
      if (kk9) return { option: kk9.id, why: 'scripted' };
      // A call on a Mech that would have a shot to make (its seat's next question says so), or any call.
      const calls = d.options.filter((o) => o.tags[0] === 'overwatch');
      const call = calls.find((o) => (o.then?.(['reaction'])?.options ?? []).some((x) => x.tags.includes('attack'))) ?? calls[0];
      if (call) return { option: call.id, why: 'scripted' };
      // A KK9 with nobody in reach walks toward the nearest enemy.
      if (/KK9/.test(view.units.find((u) => u.uid === d.unit)?.label ?? '')) {
        const walks = d.options.filter((o) => o.tags[0] === 'move' && o.facts?.to);
        if (walks.length) return { option: walks.reduce((a, b) => (near(view, b.facts.to) < near(view, a.facts.to) ? b : a)).id, why: 'scripted' };
      }
      const shot = d.kind === 'reaction.answer' ? d.options.find((o) => o.tags.includes('overwatch') && o.tags.includes('attack')) : undefined;
      return shot ? { option: shot.id, why: 'scripted' } : AI.legalPolicy.choose(d, view, rng);
    },
  };
  const POLICIES = { keen, legal: AI.legalPolicy, eager: AI.eagerPolicy, brawler: AI.brawlerPolicy, tactician: AI.tacticianPolicy };
  for (const [policy, seeds] of [['keen', [1, 2, 3]], ['legal', [1, 2]], ['eager', [1]], ['brawler', [1]], ['tactician', [1, 2, 3]]]) {
    for (const seed of seeds) {
      const t = botTable(M, data, scenario, { seed, policies: POLICIES[policy], glue: M.HUD.glueAfter });
      t.watch((cmd) => {
        if (cmd.kind === 'launch' && cmd.cardId === 'LHDR-KK9') tally.launched += 1;
        if (cmd.kind === 'overwatch') tally.calls += 1;
        if (cmd.kind === 'performAction' && cmd.granted && t.state.tokens.find((u) => u.uid === cmd.uid)?.kind === 'mech') tally.shots += 1;
      });
      let end;
      try { end = await t.run({ maxSteps: 16000 }); } catch (err) { end = { kind: 'threw', why: `${err?.message ?? err}`.split('\n')[0] }; } finally { t.close(); }
      tally.games += 1;
      if (end.kind === 'over') tally.over += 1; else tally.broken.push(`${policy} ${seed}: ${end.kind} ${end.why ?? ''} ${end.decision ?? ''}`);
      tally.refused += t.refused.length;
    }
  }
  check('TEN GAMES with a Cobra in them, on the page\'s glue, five policies: every one ends as a game should, nothing refused',
    [tally.over, tally.games, tally.refused, tally.broken], [10, 10, 0, []]);
  // (A strike called on a Mech with a shot to make is rare in play: the KK9 reaches two Grids,
  // and the Mech must be facing the same enemy. The shot is held to by the played check above.)
  check('and in them KK9s were launched and strikes called',
    [tally.launched > 0, tally.calls > 0], [true, true]);
  console.log(`       launched ${tally.launched}, strikes called ${tally.calls}, granted shots ${tally.shots}`);
}

console.log(`\n${pass} passed, ${fail} failed`);
M.L.setLocalSeat(null);
if (fail) process.exit(1);
