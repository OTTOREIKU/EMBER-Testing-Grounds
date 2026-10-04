// Coordinate and Barricade, answered by a seat (009_A, 045_B; FAQ K3, K19,
// K21; AI-OPPONENT-PLAN.md, M8.2i).
//
// Two cards whose Actions the Match Centre opens as plain card text and the
// seam offered not at all. The Echoes Support Backpack's Coordinate hands an
// Ally Mech within 4 an Extra Action Opportunity: the Mech loses 1 Link and
// acts at once, nested inside the Echo's Opportunity, which resumes when it
// ends, and the Mech still takes its own turn. The Type 79 Combat Shield's
// Barricade switches its own Mech to Defensive Stance as the Action is
// performed: the one way to a Stance once a Maneuver has fixed it.
import { botTable, loadEngine, tableAtRoundOne } from './_engine.mjs';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}\n       got  ${g}`); }
};

console.log('Coordinate and Barricade\n');

const { M, data } = await loadEngine('seatextra', ["export * as SEAT from '../src/seat';", "export * as TURN from '../src/turn';", "export * as AI from '../src/ai/index';", "export * as HUD from '../src/matchhud';"]);
const { owed, newMind } = M.SEAT;
const T = M.TURN;
const AI = M.AI;
const clone = (x) => JSON.parse(JSON.stringify(x));

// RDL: an Echo (the Echoes Support Backpack), a Wall (the Type 79 Combat
// Shield) and a Dune. UN: a Wolf.
const rdl = (name, extra = {}) => ({ name, loadout: { torso: '533', chasis: '534', leftHand: '535', rightHand: '536', backpack: '004', pilot: 'FPA-04-2', ...extra } });
data.solo.squads['t-echoes'] = { name: 'Echoes', faction: 'RDL', points: 0, mechs: [rdl('Echo', { backpack: '009' }), rdl('Wall', { leftHand: '045' }), rdl('Dune')], drones: [] };
data.solo.squads['t-wolf'] = { name: 'Rifleman', faction: 'UN', points: 0, mechs: [{ name: 'Wolf', loadout: { torso: '539', chasis: '099', leftHand: '540', rightHand: '541', backpack: '538', pilot: 'LPA-23-2' } }], drones: [] };
data.solo.squads['t-wolves'] = { name: 'Riflemen', faction: 'UN', points: 0, mechs: [
  { name: 'Wolf', loadout: { torso: '539', chasis: '099', leftHand: '540', rightHand: '541', backpack: '538', pilot: 'LPA-23-2' } },
  { name: 'Cat', loadout: { torso: '539', chasis: '099', leftHand: '540', rightHand: '541', backpack: '538', pilot: 'LPA-23-2' } }], drones: [] };
const scenario = { ...data.solo.scenarios[0], id: 't-extra', seats: { s1: 't-echoes', s2: 't-wolf' } };

const run = (state, cmd) => {
  const v = M.C.check(data, state, cmd);
  if (v.ok) { M.C.apply(data, state, cmd); M.G.glueAfter(data, state, cmd); }
  return v;
};
const sendAll = (state, commands) => commands.map((c) => run(state, c).ok);
const ids = (list) => list.map((o) => o.id);
const kinds = (d, kind) => (d ? d.options.filter((o) => o.tags[0] === kind) : []);
const pays = (unit, key) => ({ kind: 'performAction', seat: unit.side, uid: unit.uid, actionId: key, partKey: key });

M.L.setLocalSeat(null);
const base = (() => {
  const t = tableAtRoundOne(M, data, scenario);
  if (t.refused.length) throw new Error(t.refused.join('; '));
  return t.state;
})();
const stage = () => {
  const s = clone(base);
  s.map = 'none';
  const U = Object.fromEntries(s.tokens.map((t) => [t.label, t]));
  const at = (t, c, r, f) => { t.col = c * 3; t.row = r * 3; if (f !== undefined) t.facing = f; };
  at(U.Echo, 3, 4, 2); at(U.Wall, 5, 4, 2); at(U.Dune, 4, 5, 2); at(U.Wolf, 4, 9, 0);
  s.round.phase = 2; s.script.stage = '1:2'; s.script.passed = []; s.script.opp = null; s.script.revealed = ['s1', 's2'];
  for (const t of s.tokens) if (t.kind === 'mech') t.timing = 'firing';
  const ask = (seat = 's1') => { M.L.setLocalSeat(seat); return owed(data, s, seat, newMind()); };
  const turnOf = (mech, timing) => {
    mech.timing = timing;
    s.script.acted = s.tokens.filter((x) => x.kind === 'mech' && x.uid !== mech.uid).map((x) => x.uid);
    s.script.opp = null;
    M.G.opportunity(data, s);
    return ask(mech.side);
  };
  return { s, U, at, ask, turnOf };
};

// ---------- the cards ----------
{
  const { U } = stage();
  const coordinate = data.byId.get('009').actions.find((a) => a.id === '009_A');
  const barricade = data.byId.get('045').actions.find((a) => a.id === '045_B');
  check('the cards are what the test means them to be: Coordinate grants an Ally Mech within 4 (not itself, with at least 2 Link) an Extra Action Opportunity for 1 Link; Barricade switches its own Mech to Defensive Stance; both are opened as card text',
    [M.U.extraActivationOf(coordinate), M.U.selfStanceShift(barricade), T.actionRoute(data, U.Echo, coordinate), T.actionRoute(data, U.Wall, barricade), [U.Echo, U.Wall, U.Dune].map((u) => u.link)],
    [{ range: 4, minimumLink: 2, excludeSelf: true, linkCost: 1, suppressGrants: true }, 'defensive', 'card', 'card', [4, 4, 4]]);
}

// ---------- Coordinate ----------
{
  const { s, U, ask, turnOf } = stage();
  const d = turnOf(U.Echo, 'tactical');
  const g = kinds(d, 'grant').find((o) => o.facts.targetUid === U.Wall.uid);
  check('COORDINATE IS AN ANSWER FOR EACH ALLY MECH IN RANGE, not the Echo itself: the Action paid for and the grant',
    [ids(kinds(d, 'grant')), g?.tags, g?.commands, g?.facts],
    [[`grant:009_A:${U.Wall.uid}`, `grant:009_A:${U.Dune.uid}`], ['grant'], [pays(U.Echo, '009_A'), { kind: 'grantExtra', seat: 's1', uid: U.Wall.uid, linkCost: 1 }], { uid: U.Echo.uid, actionId: '009_A', targetUid: U.Wall.uid, linkCost: 1 }]);
  check('TAKEN, THE WALL LOSES A LINK AND ACTS AT ONCE, in an Opportunity nested inside the Echo\'s (FAQ K21): its seat is asked the Wall\'s turn',
    [sendAll(s, g?.commands ?? []), U.Wall.link, s.script.opp?.uid === U.Wall.uid, s.script.opp?.extra, (s.script.oppStack ?? []).map((o) => o.uid), ask().unit === U.Wall.uid, ask().kind],
    [[true, true], 3, true, true, [U.Echo.uid], true, 'opp.act']);
  sendAll(s, ask().options.find((o) => o.tags.includes('end'))?.commands ?? []);
  check('ended, the Opportunity is the Echo\'s again, the Wall is not marked as having acted and still takes its own turn (K19), and the grant is spent',
    [s.script.opp?.uid === U.Echo.uid, s.script.acted.includes(U.Wall.uid) && false, kinds(ask(), 'grant').length, s.script.opp?.grantOwed ?? null], [true, false, 0, null]);
}
{
  const far = stage();
  far.at(far.U.Dune, 11, 0, 2);
  far.at(far.U.Wolf, 3, 6, 0);
  far.U.Wall.link = 2;
  const d = far.turnOf(far.U.Echo, 'tactical');
  const low = stage();
  low.U.Wall.link = 1;
  check('a Mech out of the Action\'s Range is not offered it, nor one with less Link than the card asks (2), so none would be Shut Down by it, nor an enemy Mech within the Range',
    [ids(kinds(d, 'grant')), ids(kinds(low.turnOf(low.U.Echo, 'tactical'), 'grant'))], [[`grant:009_A:${far.U.Wall.uid}`], [`grant:009_A:${low.U.Dune.uid}`]]);
  M.L.setLocalSeat('s1');
  const q = stage();
  q.turnOf(q.U.Echo, 'tactical');
  check('it answers to the kind `grant`', ids(owed(data, q.s, 's1', newMind(), { only: ['grant'] })?.options ?? []).length, 2);
}

// ---------- Barricade ----------
{
  const { s, U, ask, turnOf } = stage();
  const d = turnOf(U.Wall, 'swift');
  const b = d.options.find((o) => o.id === 'stance-act:045_B');
  check('BARRICADE IS ONE ANSWER: the Action paid for, and nothing else: the engine switches the Stance as it is performed',
    [b?.tags, b?.commands, b?.facts, sendAll(s, b?.commands ?? []), U.Wall.stance], [['stance', 'stance:defensive', 'action'], [pays(U.Wall, '045_B')], { uid: U.Wall.uid, actionId: '045_B', stance: 'defensive' }, [true], 'defensive']);
  const held = stage();
  held.U.Wall.stance = 'defensive';
  check('and a Mech already in Defensive Stance at the start of its turn is not offered it (it could change nothing)', held.turnOf(held.U.Wall, 'swift').options.some((o) => o.id === 'stance-act:045_B'), false);
  // After a Maneuver the Stance is fixed: Barricade is the one way to Defensive.
  const m = stage();
  const d2 = m.turnOf(m.U.Wall, 'swift');
  const step = d2.options.find((o) => o.tags.includes('maneuver') && !o.tags.includes('pivot'));
  sendAll(m.s, step.commands);
  const after = m.ask();
  check('ONCE A MANEUVER HAS FIXED THE STANCE no Stance change is offered, and Barricade still is',
    [m.s.script.opp.stanceLocked, after.options.filter((o) => o.tags[0] === 'stance' && !o.tags.includes('action')).length, after.options.some((o) => o.id === 'stance-act:045_B')], [true, 0, true]);
}

// ---------- the Tactician ----------
M.L.setLocalSeat(null);
{
  const viewOf = (state, seat) => M.SEAT.viewOf(data, state, seat);
  const SK = { focus: false };
  const tact = AI.makeTactician(SK);
  const table = async (arrange, policies = AI.eagerPolicy) => {
    const t = botTable(M, data, { ...scenario, map: 'none' }, { seed: 3, policies, glue: M.HUD.glueAfter });
    await t.run({ until: (st) => M.SU.normaliseSetup(st.setup)?.stage === 'done' });
    const s = t.state;
    const U = Object.fromEntries(s.tokens.map((x) => [x.label, x]));
    const at = (x, c, r, f) => { x.col = c * 3; x.row = r * 3; if (f !== undefined) x.facing = f; };
    const sc = s.script;
    s.round.phase = 2; sc.stage = '1:2'; sc.opp = null; sc.revealed = ['s1', 's2']; sc.passed = [];
    for (const x of s.tokens) if (x.kind === 'mech') x.timing = 'firing';
    const turnOf = (mech, timing) => {
      mech.timing = timing;
      sc.acted = s.tokens.filter((x) => x.kind === 'mech' && x.uid !== mech.uid).map((x) => x.uid);
      sc.opp = null;
      return M.G.opportunity(data, s);
    };
    arrange({ s, U, at, turnOf });
    return { t, s, U, d: t.drivers.s1.pending() };
  };
  // The Echo has nothing to shoot at; the Wall has the Wolf in its sights.
  const x = await table(({ U, at, turnOf }) => { at(U.Echo, 0, 0, 2); at(U.Wall, 2, 2, 2); at(U.Dune, 0, 1, 2); at(U.Wolf, 2, 7, 0); turnOf(U.Echo, 'tactical'); }, { s1: tact, s2: AI.eagerPolicy });
  const rows = AI.weighed(x.d, viewOf(x.s, 's1'), SK);
  const stay = rows.find((p) => p.how === 'stay');
  // What the Wall would do with a turn of its own: its own weighing of that question.
  const wall = x.d.options.find((o) => o.id === `grant:009_A:${x.U.Wall.uid}`);
  const theirs = AI.weighed(wall.then(), viewOf(x.s, 's1'), SK);
  const gain = theirs[0].worth - (theirs.find((p) => p.how === 'stay').worth - theirs.find((p) => p.how === 'stay').now);
  check('THE TACTICIAN WEIGHS COORDINATE AS A DEED: what the Mech handed the turn would do with it over doing nothing, less the Link it costs; with the Wolf in the Wall\'s sights it hands the Wall the turn',
    [/Extra Action Opportunity for Wall/.test(stay.does), Math.abs(stay.now - (gain - AI.TACTICIAN.link)) < 1e-6, gain > AI.TACTICIAN.link], [true, true, true]);
  const pick = tact.choose(x.d, viewOf(x.s, 's1'), new AI.Rng('pick'));
  const steps = [];
  await x.t.run({ until: (st) => st.script.opp?.uid !== x.U.Echo.uid && !(st.script.oppStack ?? []).length && !st.script.combatView, maxSteps: x.t.steps() + 60,
    onStep: (seat, r) => steps.push(`${seat}:${r.option.id}:${x.t.drivers[seat].log.at(-1)?.reason ?? ''}`) });
  void pick;
  // The grant's Link is paid (4 to 3); in its turn the Wall may spend another of
  // its own: since `restance` (M8.2q) it buys a Tick after its shot to
  // Barricade into Defensive Stance, which no longer seems to cost its next turn.
  check('and its Opportunity played out by the Tactician gives it, the Wall acts in it, and nothing is refused',
    [steps.some((y) => y === `s1:grant:009_A:${x.U.Wall.uid}:grant_by_value`), steps.some((y) => /^s1:attack:/.test(y)), x.U.Wall.link <= 3, x.t.refused], [true, true, true, []]);
  x.t.close();
  const off = await table(({ U, at, turnOf }) => { at(U.Echo, 0, 0, 2); at(U.Wall, 2, 2, 2); at(U.Dune, 0, 1, 2); at(U.Wolf, 2, 7, 0); turnOf(U.Echo, 'tactical'); });
  check('with its skill off (`grant`) it is no deed; and the policies with no rule for it never take it',
    [/Extra Action Opportunity/.test(AI.weighed(off.d, viewOf(off.s, 's1'), { ...SK, grant: false }).find((p) => p.how === 'stay').does),
      [AI.brawlerPolicy, AI.eagerPolicy].map((p) => off.d.options.find((o) => o.id === p.choose(off.d, viewOf(off.s, 's1'), new AI.Rng('x')).option)?.tags[0] === 'grant')], [false, [false, false]]);
  off.t.close();
}

// ---------- whole games ----------
M.L.setLocalSeat(null);
{
  const tally = { games: 0, over: 0, refused: 0, broken: [], grants: 0, barricades: 0 };
  const two = { ...scenario, id: 't-extra-2', seats: { s1: 't-echoes', s2: 't-wolves' } };
  for (const [policy, seeds] of [['legal', [1, 2, 3]], ['eager', [1]], ['brawler', [1]], ['tactician', [1, 2, 3]]]) {
    for (const seed of seeds) {
      const t = botTable(M, data, two, { seed, policies: AI[`${policy}Policy`], glue: M.HUD.glueAfter });
      t.watch((cmd) => {
        if (cmd.kind === 'grantExtra') tally.grants += 1;
        if (cmd.kind === 'performAction' && cmd.actionId === '045_B') tally.barricades += 1;
      });
      let end;
      try { end = await t.run({ maxSteps: 16000 }); } catch (err) { end = { kind: 'threw', why: `${err?.message ?? err}`.split('\n')[0] }; } finally { t.close(); }
      tally.games += 1;
      if (end.kind === 'over') tally.over += 1; else tally.broken.push(`${policy} ${seed}: ${end.kind} ${end.why ?? ''} ${end.decision ?? ''}`);
      tally.refused += t.refused.length;
    }
  }
  check('EIGHT GAMES with an Echo and a Wall in them, on the page\'s glue, four policies: every one ends as a game should, nothing refused, and a turn was handed over in them',
    [tally.over, tally.games, tally.refused, tally.broken, tally.grants > 0], [8, 8, 0, [], true]);
  console.log(`       turns handed over ${tally.grants}, Barricades ${tally.barricades}`);
}

console.log(`\n${pass} passed, ${fail} failed`);
M.L.setLocalSeat(null);
if (fail) process.exit(1);
