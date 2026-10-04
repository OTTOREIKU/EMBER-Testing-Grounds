// Optical Camouflage, answered by a seat (rulebook 4.12; FAQ I11, I12, I20;
// AI-OPPONENT-PLAN.md, M8.2g).
//
// A unit in Optical Camouflage cannot simply be named as a target: the attack
// that designates it makes one free Scan first, an Electronic Counter-roll. Won,
// the unit is Revealed, its own player says where it appears (Manifestation
// Movement, within its Stealth value of where its marker stood), and the attack
// resumes against it there. Lost, the attack is over and its Ticks are spent.
// The seam offered no attack on such a unit at all, so a player whose Mech wore
// camouflage was safe from the computer for as long as it lasted; and no unit
// of the computer's ever wore it, because the Reveal a camouflaged unit comes
// to owe was a debt no seat answered.
//
// Each half is staged here on the real engine: the designation and what it
// leads to, the Reveal and where a unit may appear, deploying in the State and
// Activating it, the odds a policy is handed, and what the Tactician makes of
// them.
import { botTable, loadEngine, tableAtRoundOne } from './_engine.mjs';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}\n       got  ${g}`); }
};

console.log('Optical Camouflage\n');

const { M, data } = await loadEngine('seatcamo', ["export * as SEAT from '../src/seat';", "export * as TURN from '../src/turn';", "export * as AI from '../src/ai/index';", "export * as HUD from '../src/matchhud';",
  "export * as ODDS from '../src/ai/odds';", "export * as CONTEST from '../src/contest';"]);
const { owed, newMind } = M.SEAT;
const T = M.TURN;
const AI = M.AI;
const clone = (x) => JSON.parse(JSON.stringify(x));

// RDL: two gunners (a Railgun each) and a Vigilant. UN: a Ghost, whose Torso
// Activates Optical Camouflage at Stealth 2 (096), and a Bison, which has none.
const gunner = (name) => ({ name, loadout: { torso: '533', chasis: '534', leftHand: '535', rightHand: '536', backpack: '004', pilot: 'FPA-04-2' } });
data.solo.squads['t-hunters'] = { name: 'Hunters', faction: 'RDL', points: 0, mechs: [gunner('Dune'), gunner('Sand')], drones: [{ cardId: 'PRDR-202' }] };
data.solo.squads['t-ghosts'] = {
  name: 'Ghosts', faction: 'UN', points: 0,
  mechs: [
    { name: 'Ghost', loadout: { torso: '096', chasis: '099', leftHand: '540', rightHand: '541', backpack: '538', pilot: 'LPA-23-2' } },
    { name: 'Bison', loadout: { torso: '098', chasis: '099', leftHand: '540', rightHand: '541', backpack: '538', pilot: 'LPA-23-2' } },
  ],
  drones: [],
};
const scenario = { ...data.solo.scenarios[0], id: 't-camo', seats: { s1: 't-hunters', s2: 't-ghosts' } };
// The Ghost alone: a squad with nothing else in it to shoot at.
data.solo.squads['t-ghost'] = { name: 'Ghost', faction: 'UN', points: 0, mechs: [data.solo.squads['t-ghosts'].mechs[0]], drones: [] };
const hunt = { ...scenario, id: 't-camo-hunt', seats: { s1: 't-hunters', s2: 't-ghost' } };
const name = (t) => (t.cardId === 'PRDR-202' ? 'Vigilant' : t.label);

const run = (state, cmd) => {
  const v = M.C.check(data, state, cmd);
  if (v.ok) { M.C.apply(data, state, cmd); M.G.glueAfter(data, state, cmd); }
  return v;
};
const sendAll = (state, commands) => commands.map((c) => run(state, c).ok);
const ids = (list) => list.map((o) => o.id);
const hidden = (u) => (u.statuses ?? []).includes('camouflage');
const gridOf = (u) => [Math.floor(u.col / 3), Math.floor(u.row / 3)];
const pays = (unit, key) => ({ kind: 'performAction', seat: unit.side, uid: unit.uid, actionId: key, partKey: key });
const scans = (by, target, actionId) => ({ kind: 'startCounterRoll', seat: by.side, uid: by.uid, actionId: 'COMMON_SCAN', targetUid: target.uid, thenAttack: { actionId } });

M.L.setLocalSeat(null);
const base = (() => {
  const t = tableAtRoundOne(M, data, scenario);
  if (t.refused.length) throw new Error(t.refused.join('; '));
  return t.state;
})();
// A table in the Action Phase on open ground: the Dune three Grids north of the
// Ghost and facing it, everything else out of the way. `camo` puts the Ghost in
// the State, as deploying in it does.
const stage = ({ camo = true, phase = 2 } = {}) => {
  const s = clone(base);
  s.map = 'none';
  const U = Object.fromEntries(s.tokens.map((t) => [name(t), t]));
  const at = (t, c, r, f) => { t.col = c * 3; t.row = r * 3; if (f !== undefined) t.facing = f; };
  at(U.Dune, 3, 4, 2); at(U.Sand, 9, 0, 2); at(U.Vigilant, 11, 0, 2); at(U.Ghost, 3, 7, 0); at(U.Bison, 11, 11, 0);
  if (camo) U.Ghost.statuses = [...(U.Ghost.statuses ?? []), 'camouflage'];
  s.round.phase = phase; s.script.stage = `1:${phase}`; s.script.acted = []; s.script.passed = []; s.script.opp = null;
  s.script.revealed = ['s1', 's2']; for (const t of s.tokens) if (t.kind === 'mech') t.timing = 'firing';
  const ask = (seat) => { M.L.setLocalSeat(seat); return owed(data, s, seat, newMind()); };
  const turnOf = (mech, timing) => {
    mech.timing = timing;
    s.script.acted = s.tokens.filter((x) => x.kind === 'mech' && x.uid !== mech.uid).map((x) => x.uid);
    s.script.opp = null;
    M.G.opportunity(data, s);
    return ask(mech.side);
  };
  const send = (seat, commands) => { M.L.setLocalSeat(seat); return sendAll(s, commands); };
  return { s, U, at, ask, turnOf, send };
};

// ---------- the cards ----------
{
  const carriers = [];
  for (const c of data.cards) for (const a of c.actions ?? []) if (M.U.activatesCamo(a)) carriers.push(`${c.id}/${a.id}:${M.U.stealthValue(a)}`);
  const { U } = stage();
  check('the cards are what the test means them to be: three Parts Activate Optical Camouflage, the Ghost\'s Torso at Stealth 2; the Bison has none; the Action is opened by the door of its own',
    [carriers.sort(), M.U.canActivateCamo(data, U.Ghost), M.U.canActivateCamo(data, U.Bison), M.U.manifestationRange(data, U.Ghost),
      T.actionRoute(data, U.Ghost, data.byId.get('096').actions.find((a) => a.id === '096_B'))],
    [['096/096_B:2', '247/247_B:2', 'ZYBP-201/ZYBP-201_A:0'], true, false, 2, 'camo']);
}

// ---------- the designation ----------
{
  const { s, U, ask, turnOf } = stage();
  const d = turnOf(U.Dune, 'firing');
  const shots = d.options.filter((o) => o.tags[0] === 'attack');
  const o = shots.find((x) => x.id === `attack:536_A:${U.Ghost.uid}:scan`);
  check('AN ATTACK ON A UNIT IN OPTICAL CAMOUFLAGE IS OFFERED AS ITS DESIGNATION (4.12.2, FAQ I12): the Action paid for and one free Scan with the attack behind it; commands, and no dice of its own',
    [ids(shots), o.tags, o.commands, o.facts, o.run ?? null],
    [[`attack:536_A:${U.Ghost.uid}:scan`, `attack:536_B:${U.Ghost.uid}:scan`], ['attack', 'firing', 'hidden'], [pays(U.Dune, '536_A'), scans(U.Dune, U.Ghost, '536_A')],
      { uid: U.Dune.uid, targetUid: U.Ghost.uid, actionId: '536_A', hidden: true }, null]);
  check('the engine takes the Scan only behind the attack\'s own payment: sent by itself it is refused',
    [M.C.check(data, s, o.commands[1]).ok, M.C.checkAfter(data, s, o.commands[0], o.commands[1]).ok], [false, true]);
  const seen = stage({ camo: false });
  const plain = seen.turnOf(seen.U.Dune, 'firing').options.filter((x) => x.tags[0] === 'attack');
  check('the same unit seen is attacked as any unit is: a routine with dice, and no Scan',
    [ids(plain), plain[0].tags, plain[0].run.routine, plain[0].commands ?? null], [[`attack:536_A:${seen.U.Ghost.uid}`, `attack:536_B:${seen.U.Ghost.uid}`], ['attack', 'firing'], 'attack', null]);
  // The marker is designated as a unit is: by an attack that could be made on
  // it where it stands (the engine holds the free Scan to the Action's own
  // Range and arc).
  const offered = (ghostAt, facing = 2) => {
    const v = stage();
    v.at(v.U.Ghost, ...ghostAt, 0);
    v.at(v.U.Dune, 3, 4, facing);
    return ids(v.turnOf(v.U.Dune, 'firing').options.filter((x) => x.tags[0] === 'attack'));
  };
  check('IT IS DESIGNATED WHERE THE ATTACK COULD BE MADE ON ITS MARKER: at five Grids the Single Shot (Range 6) may designate it and the Burst Fire (Range 3) may not; at seven neither; and not with its back turned',
    [offered([3, 9]), offered([3, 11]), offered([3, 7], 0)], [[`attack:536_A:${U.Ghost.uid}:scan`], [], []]);
  void ask;
}

// ---------- the Counter-roll's odds ----------
{
  const { s, U } = stage();
  const r = M.CONTEST.counterReading(data, s, U.Dune.uid, U.Ghost.uid, 'COMMON_SCAN');
  check('THE COUNTER-ROLL IS READ AS ITS WINDOW DEALS IT: each side its Electronic strength in Yellow dice, and what each face of a die comes to for it; the Ghost is Offensive here, so its hollow face counts',
    [r.init.dice, r.resp.dice, M.U.electronicStrength(data, s.tokens, U.Dune, 'initiator'), M.U.electronicStrength(data, s.tokens, U.Ghost, 'responder'), r.init.faces.length, U.Ghost.stance,
      r.resp.faces[4], (() => { const v = stage(); v.U.Ghost.stance = 'defensive'; return M.CONTEST.counterReading(data, v.s, v.U.Dune.uid, v.U.Ghost.uid, 'COMMON_SCAN').resp.faces[4]; })()],
    [2, 5, 2, 5, 8, 'offensive', { lightning: 0, light: 1 }, { lightning: 0, light: 0 }]);
  // Every hand of a small pair of pools, counted one by one with the engine's
  // own tally and verdict, against the arithmetic.
  const brute = (reading) => {
    const dice = data.dice;
    const n = reading.init.dice + reading.resp.dice;
    let won = 0;
    const faces = new Array(n).fill(0);
    const total = 8 ** n;
    for (let i = 0; i < total; i++) {
      let x = i;
      for (let k = 0; k < n; k++) { faces[k] = x % 8; x = Math.floor(x / 8); }
      const sum = (list) => list.reduce((acc, f) => ({ lightning: acc.lightning + f.lightning, light: acc.light + f.light }), { lightning: 0, light: 0 });
      const a = sum(faces.slice(0, reading.init.dice).map((f) => reading.init.faces[f]));
      const b = sum(faces.slice(reading.init.dice).map((f) => reading.resp.faces[f]));
      if (M.U.resolveCounterRoll(a, b).initiatorWins) won += 1;
    }
    void dice;
    return won / total;
  };
  const small = { init: { ...r.init, dice: 2 }, resp: { ...r.resp, dice: 3 } };
  const level = { init: { ...r.init, dice: 2 }, resp: { ...r.init, dice: 2 } };
  check('ITS ODDS ARE EXACT: the chance the Initiator wins, over every hand the two pools can throw, is the engine\'s own verdict on each counted one by one; a roll level on both goes to the Initiator, so two equal pools favour it',
    [Math.abs(M.ODDS.counterChance(small) - brute(small)) < 1e-12, Math.abs(M.ODDS.counterChance(level) - brute(level)) < 1e-12, M.ODDS.counterChance(level) > 0.5,
      M.ODDS.counterChance(r) < M.ODDS.counterChance(small), M.ODDS.counterChance(r) > 0 && M.ODDS.counterChance(r) < 0.5],
    [true, true, true, true, true]);
}

// ---------- won: the Reveal, and the attack resumed ----------
M.L.setLocalSeat(null);
const lightning = data.dice.dice.yellow.faces.findIndex((f) => f.length === 1 && f[0].type === 'lightning');
const empty = (color) => Math.max(0, data.dice.dice[color].faces.findIndex((f) => !f.length));
const script = (want) => ({
  name: 'scripted',
  choose(d, view, rng) {
    const id = want(d, view);
    return id && d.options.some((o) => o.id === id) ? { option: id, why: 'scripted' } : AI.eagerPolicy.choose(d, view, rng);
  },
});
// Two drivers at a table that has been set up, the units then stood as the
// raw stage stands them. The Counter-roll's dice are fixed: the side named in
// `plan.scan` throws all {Lightning} and the other nothing; every other die
// thrown comes up blank.
const table = async ({ policies, seed = 5, camo = true, scn = scenario }) => {
  const first = new AI.Rng(`${seed}:first`);
  const plan = { fixed: false, scan: 'init', init: 2 };
  const t = botTable(M, data, { ...scn, map: 'none' }, {
    seed, policies, glue: M.HUD.glueAfter,
    dice: (pool, label) => {
      if (!plan.fixed || /First Player/.test(label)) return Object.entries(pool).flatMap(([color, n]) => Array.from({ length: n }, () => ({ color, face: first.int(data.dice.dice[color].sides) })));
      if (/Electronic Counter-roll/.test(label)) {
        const mine = (pool.yellow ?? 0) === plan.init ? 'init' : 'resp';
        return Array.from({ length: pool.yellow ?? 0 }, () => ({ color: 'yellow', face: mine === plan.scan ? lightning : empty('yellow') }));
      }
      return Object.entries(pool).flatMap(([color, n]) => Array.from({ length: n }, () => ({ color, face: empty(color) })));
    },
  });
  await t.run({ until: (st) => M.SU.normaliseSetup(st.setup)?.stage === 'done' });
  plan.fixed = true;
  const landed = [];
  t.watch((cmd) => landed.push(cmd));
  const s = t.state;
  const U = Object.fromEntries(s.tokens.map((x) => [name(x), x]));
  const at = (x, c, r, f) => { x.col = c * 3; x.row = r * 3; if (f !== undefined) x.facing = f; };
  at(U.Dune, 3, 4, 2); at(U.Sand, 9, 0, 2); at(U.Vigilant, 11, 0, 2); at(U.Ghost, 3, 7, 0);
  if (U.Bison) at(U.Bison, 11, 11, 0);
  U.Ghost.statuses = (U.Ghost.statuses ?? []).filter((x) => x !== 'camouflage');
  if (camo) U.Ghost.statuses = [...U.Ghost.statuses, 'camouflage'];
  const sc = s.script;
  s.round.phase = 2; sc.stage = '1:2'; sc.acted = []; sc.opp = null; sc.revealed = ['s1', 's2']; sc.passed = [];
  for (const x of s.tokens) if (x.kind === 'mech') x.timing = 'firing';
  const turnOf = (mech, timing) => {
    mech.timing = timing;
    sc.acted = s.tokens.filter((x) => x.kind === 'mech' && x.uid !== mech.uid).map((x) => x.uid);
    sc.opp = null;
    return M.G.opportunity(data, s);
  };
  const asked = () => ['s1', 's2'].map((seat) => t.drivers[seat].pending()?.kind ?? null);
  return { t, s, U, at, turnOf, plan, landed, asked };
};
const calm = (d) => (d.kind === 'contest.focus' ? 'focus.pass' : null);
// The table as the first command of a kind lands: what is owed, and what each
// seat is asked there.
const snapAt = (x, kind) => {
  const snap = {};
  x.t.watch((cmd) => {
    if (cmd.kind !== kind || snap.taken) return;
    const st = x.t.state;
    Object.assign(snap, {
      taken: true,
      reactions: clone(st.script.reactions ?? []), counter: st.script.counter ?? null,
      hidden: hidden(x.U.Ghost), grid: gridOf(x.U.Ghost), performed: [...(st.script.opp?.performed ?? [])], ticks: st.script.opp?.action,
      opp: st.script.opp?.uid ?? null,
      s1: owed(data, st, 's1', newMind()), s2: owed(data, st, 's2', newMind()),
    });
  });
  return snap;
};
const designates = (actionId) => (d) => calm(d) ?? (d.kind === 'opp.act' ? d.options.find((o) => o.tags.includes('hidden') && o.facts.actionId === actionId)?.id ?? null : null);
{
  const x = await table({ policies: { s1: script(designates('536_A')), s2: script((d) => (d.kind === 'reveal.make' ? 'reveal:4,7' : calm(d))) } });
  x.turnOf(x.U.Dune, 'firing');
  const odds = x.t.drivers.s1.pending().options.find((o) => o.id === `attack:536_A:${x.U.Ghost.uid}:scan`).chance();
  const start = clone(x.s);
  const won = snapAt(x, 'clearCounterRoll');
  const shown = snapAt(x, 'reveal');
  const steps = [];
  const end = await x.t.run({ until: (st) => st.script.opp?.uid !== x.U.Dune.uid && !st.script.counter && !st.script.combatView, maxSteps: x.t.steps() + 80, onStep: (seat, r) => steps.push(`${seat}:${r.decision.kind}>${r.option.id}`) });
  check('THE SCAN WON, two debts are queued: the Ghost owes its Manifestation, and the attack waits behind it for the Dune',
    [won.reactions.map((r) => [r.kind, r.uid, r.fromUid, r.actionId]), won.hidden, won.performed, won.counter],
    [[['manifest', x.U.Ghost.uid, x.U.Dune.uid, 'COMMON_SCAN'], ['scanAttack', x.U.Dune.uid, x.U.Ghost.uid, '536_A']], true, ['536_A'], null]);
  const reveal = won.s2;
  const spots = [[3, 5], [2, 6], [3, 6], [4, 6], [1, 7], [2, 7], [4, 7], [5, 7], [2, 8], [3, 8], [4, 8], [3, 9]];
  check('ITS OWN PLAYER MAKES THE REVEAL, and says where it appears: an answer for staying, and one for each Grid within its Stealth value of there that it fits in (twelve at Stealth 2, counted along the rows and columns); the squad whose Scan it was waits',
    [won.s1, reveal.kind, reveal.unit === x.U.Ghost.uid, reveal.fallback, reveal.facts.scanned, reveal.options[0].id, reveal.options[0].tags, reveal.options[0].commands,
      ids(reveal.options).slice(1).sort(), reveal.options.every((o) => o.commands.length === 1 && o.commands[0].kind === 'reveal')],
    [null, 'reveal.make', true, 'reveal:stay', true, 'reveal:stay', ['reveal', 'stay'], [{ kind: 'reveal', seat: 's2', uid: x.U.Ghost.uid }],
      spots.map(([c, r]) => `reveal:${c},${r}`).sort(), true]);
  const hop = reveal.options.find((o) => o.id === 'reveal:4,7');
  check('a Grid\'s answer is the one command: the Reveal, with where it appears (the two are one event, 4.12.2)',
    [hop.tags, hop.commands, hop.facts], [['reveal', 'manifest'], [{ kind: 'reveal', seat: 's2', uid: x.U.Ghost.uid, to: { col: 12, row: 21 } }], { uid: x.U.Ghost.uid, to: { c: 4, r: 7 } }]);
  check('as a driver puts the question, the designation came with its odds: the Scan\'s chance times the attack\'s on the unit where its marker stands',
    (() => {
      // The same table with the unit seen: the attack as it would be made on it.
      const seen = clone(start);
      const ghost = seen.tokens.find((u) => u.uid === x.U.Ghost.uid);
      ghost.statuses = ghost.statuses.filter((id) => id !== 'camouflage');
      const asked = new AI.Driver('s1', { data, state: () => seen, send: () => ({ ok: true }), roll: async () => [] }, AI.eagerPolicy, new AI.Rng('x')).pending();
      const plainOdds = asked.options.find((o) => o.id === `attack:536_A:${ghost.uid}`).chance();
      const p = M.ODDS.counterChance(M.CONTEST.counterReading(data, start, x.U.Dune.uid, ghost.uid, 'COMMON_SCAN'));
      const near = (a, b) => Math.abs(a - b) < 1e-9;
      return [odds.pen > 0, plainOdds.damage > 0, ['hit', 'pen', 'damage', 'destroy', 'kill', 'link'].map((k) => near(odds[k], p * plainOdds[k])),
        odds.parts.map((x, i) => near(x.share, p * plainOdds.parts[i].share) && near(x.pen, plainOdds.parts[i].pen)).every(Boolean), odds.pen < plainOdds.pen, p > 0 && p < 1];
    })(), [true, true, [true, true, true, true, true, true], true, true, true]);
  const resume = shown.s1;
  check('REVEALED, it stands where its player chose and the camouflage is off; the Manifestation debt is paid by the Reveal, and THE ATTACK RESUMES as a reaction of the attacker\'s: made on the unit where it now stands, with the debt settled before it, or called off; the other squad waits',
    [shown.hidden, shown.grid, shown.reactions.map((r) => r.kind), resume.kind, shown.s2, ids(resume.options), resume.fallback, resume.options[0].tags, resume.options[0].run.routine,
      resume.options[0].run.args.before, resume.options[0].run.args.targetUid, resume.facts.reaction],
    [false, [4, 7], ['scanAttack'], 'reaction.answer', null, ['resume:536_A', 'decline'], 'resume:536_A', ['reaction', 'scan', 'attack', 'firing'], 'attack',
      [{ kind: 'resolveReaction', seat: 's1', uid: x.U.Dune.uid, actionId: '536_A', placed: true }], x.U.Ghost.uid, 'scanAttack']);
  const views = x.landed.filter((c) => c.kind === 'setCombatView' && c.view).map((c) => [c.view.attackerUid, c.view.targetUid, c.view.actionId]);
  const paid = x.landed.filter((c) => c.kind === 'performAction' && c.uid === x.U.Dune.uid).map((c) => c.actionId);
  check('PLAYED: the Dune designates the Ghost, wins its Scan, the Ghost appears where its player says, and the attack is rolled out in its window against it there; the Action was paid for once, and nothing is refused',
    [end.kind, x.t.refused, steps.filter((y) => /opp\.act|reveal\.make|reaction\.answer|contest\.apply/.test(y)).slice(0, 4), views[0], paid, x.s.script.reactions ?? [], hidden(x.U.Ghost)],
    ['paused', [], [`s1:opp.act>attack:536_A:${x.U.Ghost.uid}:scan`, 's1:contest.apply>ew.apply', 's2:reveal.make>reveal:4,7', 's1:reaction.answer>resume:536_A'],
      [x.U.Dune.uid, x.U.Ghost.uid, '536_A'], ['536_A'], [], false]);
  x.t.close();
}
{
  // Where it appears out of the attack's reach, the attack cannot be made: the
  // Burst Fire reaches three Grids, and the Ghost appears two further off.
  const x = await table({ policies: { s1: script(designates('536_B')), s2: script((d) => (d.kind === 'reveal.make' ? 'reveal:3,9' : calm(d))) } });
  x.turnOf(x.U.Dune, 'firing');
  const shown = snapAt(x, 'reveal');
  const called = snapAt(x, 'resolveReaction');
  await x.t.run({ until: () => !!called.taken, maxSteps: x.t.steps() + 40 });
  check('WHERE IT APPEARS OUT OF THE ATTACK\'S REACH the attack cannot be made (4.4.1): the one answer is that it ends; its Ticks were spent at the designation (FAQ I11)',
    [shown.grid, shown.hidden, ids(shown.s1.options), shown.s1.fallback, shown.performed], [[3, 9], false, ['decline'], 'decline', ['536_B']]);
  check('ended, nothing is owed and the Opportunity is the Dune\'s still', [called.reactions, called.s1?.kind, called.s1?.unit === x.U.Dune.uid, called.s2, x.t.refused], [[], 'opp.act', true, null, []]);
  x.t.close();
}

// ---------- lost ----------
{
  const x = await table({ policies: { s1: script(designates('536_B')), s2: script(calm) } });
  x.plan.scan = 'resp';
  x.turnOf(x.U.Dune, 'firing');
  const before = x.s.script.opp.action;
  const lost = snapAt(x, 'clearCounterRoll');
  await x.t.run({ until: () => !!lost.taken, maxSteps: x.t.steps() + 30 });
  check('THE SCAN LOST, the attack is over (FAQ I11): nothing is owed, the unit stays hidden where it was, the Action\'s Ticks are spent, and the Dune is asked what else it would do',
    [x.t.refused, lost.reactions, lost.hidden, lost.grid, lost.performed, lost.ticks < before, lost.s1.kind, lost.s1.unit === x.U.Dune.uid, lost.s2],
    [[], [], true, [3, 7], ['536_B'], true, 'opp.act', true, null]);
  check('the Action that failed has made its one free Scan: no second is offered for it, and the engine refuses one sent',
    [ids(lost.s1.options.filter((o) => o.tags.includes('hidden') && o.facts.actionId === '536_B')), M.C.check(data, x.s, scans(x.U.Dune, x.U.Ghost, '536_B')).ok], [[], false]);
  x.t.close();
}

// ---------- a Reveal of its own doing ----------
{
  // A Movement that ends in Contact with it: the unit Reveals, and the squad that moved goes on.
  const { s, U, at, ask, turnOf, send } = stage();
  at(U.Dune, 3, 5, 2);
  const d = turnOf(U.Dune, 'movement');
  const step = d.options.find((o) => o.tags.includes('maneuver') && o.facts.to?.c === 3 && o.facts.to?.r === 6);
  check('A MOVEMENT THAT ENDS WITH AN ENEMY IN CONTACT Reveals it (4.12.2): the Ghost\'s player is asked where it appears, and the squad that moved is NOT made to wait (only a won Scan\'s attack waits)',
    [send('s1', step.commands).every(Boolean), s.script.revealDue.map((x) => [x.uid, x.why]), ask('s2')?.kind, ask('s2')?.facts.scanned, ask('s1')?.kind, ask('s1')?.unit === U.Dune.uid],
    [true, [[U.Ghost.uid, 'touch']], 'reveal.make', false, 'opp.act', true]);
  const stay = ask('s2').options.find((o) => o.id === 'reveal:stay');
  check('made where it stands, the debt is paid and the unit is seen', [send('s2', stay.commands), hidden(U.Ghost), s.script.revealDue, ask('s2')], [[true], false, [], null]);
}
{
  // Its own Action without Silence.
  const { s, U, at, ask, turnOf, send } = stage();
  at(U.Dune, 3, 5, 2);
  const d = turnOf(U.Ghost, 'firing');
  const shot = d.options.find((o) => o.tags[0] === 'attack' && o.facts.targetUid === U.Dune.uid);
  // (The Action paid for, as the attack's own answer pays for it.)
  const paid = send('s2', shot.run.args.before);
  const owes = ask('s2');
  check('ITS OWN ACTION WITHOUT SILENCE Reveals it: once the attack is paid for the Reveal is owed, and it is asked BEFORE the rest of its turn (the engine lets it end no Opportunity until it is made)',
    [paid, s.script.revealDue.map((x) => [x.uid, x.why]), owes.kind, owes.unit === U.Ghost.uid, M.C.check(data, s, { kind: 'endOpportunity', seat: 's2', uid: U.Ghost.uid }).ok,
      ids(owes.options).length, ids(owes.options).includes('reveal:3,5')],
    // (Eleven Grids and staying: the Grid the Dune fills is no place to appear.)
    [[true], [[U.Ghost.uid, 'act']], 'reveal.make', true, false, 12, false]);
  check('made, its turn goes on', [send('s2', owes.options.find((o) => o.id === 'reveal:3,8').commands), hidden(U.Ghost), gridOf(U.Ghost), ask('s2').kind], [[true], false, [3, 8], 'opp.act']);
}
{
  const { U, ask, turnOf, send, s } = stage();
  U.Ghost.statuses = [...U.Ghost.statuses, 'immobilized'];
  s.script.revealDue = [{ uid: U.Ghost.uid, why: 'touch', byUid: U.Dune.uid }];
  turnOf(U.Dune, 'firing');
  const d = ask('s2');
  check('a unit bearing an Immobilized Token Reveals where it stands and nowhere else (FAQ I20); and a Reveal may not be declined: every answer makes it',
    [ids(d.options), d.options.every((o) => o.commands[0].kind === 'reveal')], [['reveal:stay'], true]);
  void send;
}

// ---------- the State put on ----------
{
  const seen = [];
  const t = botTable(M, data, scenario, { seed: 3, policies: AI.eagerPolicy, glue: M.HUD.glueAfter });
  await t.run({ until: (st) => M.SU.normaliseSetup(st.setup)?.stage === 'done', onStep: (seat, r) => { if (r.decision.kind === 'setup.deploy') seen.push(r.decision); } });
  const U = Object.fromEntries(t.state.tokens.map((x) => [name(x), x]));
  const of = (u) => seen.flatMap((d) => d.options.filter((o) => o.facts.uid === u.uid));
  check('A UNIT THAT CAN DEPLOYS IN OPTICAL CAMOUFLAGE (4.12.2): every Grid offered to the Ghost is offered in the State, and none of the Bison\'s is; played, the Ghost begins the game hidden',
    [of(U.Ghost).length > 0, of(U.Ghost).every((o) => o.tags.includes('camo') && o.commands[0].camo === true && o.facts.camo === true), of(U.Bison).some((o) => o.tags.includes('camo') || o.commands[0].camo),
      hidden(U.Ghost), hidden(U.Bison), t.refused],
    [true, true, false, true, false, []]);
  t.close();
}
{
  const { s, U, ask, turnOf, send } = stage({ camo: false });
  const d = turnOf(U.Ghost, 'tactical');
  const o = d.options.find((x) => x.id === 'token:096_B');
  check('ACTIVATE OPTICAL CAMOUFLAGE (096_B) is one answer: the Action paid for and the State put on the unit itself',
    [o.tags, o.commands, o.facts], [['token', 'self', 'token:camouflage'], [pays(U.Ghost, '096_B'), { kind: 'applyStatus', seat: 's2', uid: U.Ghost.uid, targetUid: U.Ghost.uid, statusId: 'camouflage' }],
      { uid: U.Ghost.uid, actionId: '096_B', targetUid: U.Ghost.uid, statusId: 'camouflage' }]);
  check('taken, it is hidden, and the Action that hid it owes no Reveal; a unit already in the State is not offered it again',
    [send('s2', o.commands), hidden(U.Ghost), s.script.revealDue ?? [], ask('s2').kind, ask('s2').options.some((x) => x.id === 'token:096_B'),
      (() => { const v = stage(); return v.turnOf(v.U.Ghost, 'tactical').options.some((x) => x.id === 'token:096_B'); })(),
      // (The board holds the same line itself: the Action's row is not live on a unit in the State.)
      (() => { const v = stage(); v.turnOf(v.U.Ghost, 'tactical'); return T.actionRows(data, v.s, v.U.Ghost, v.s.script.opp).find((r) => r.a.id === '096_B')?.v.ok ?? null; })()],
    [[true, true], true, [], 'opp.act', false, false, false]);
  M.L.setLocalSeat('s2');
  const kinds = stage({ camo: false });
  kinds.turnOf(kinds.U.Ghost, 'tactical');
  check('it answers to the kind `token`, like a Token a unit gives itself', ids(owed(data, kinds.s, 's2', newMind(), { only: ['token'] })?.options ?? []), ['token:096_B']);
}

// ---------- what the Tactician makes of it ----------
M.L.setLocalSeat(null);
{
  const viewOf = (state, seat) => M.SEAT.viewOf(data, state, seat);
  const SK = { focus: false };
  const tact = AI.makeTactician(SK);
  const pick = (x, seat, policy = tact) => { const d = x.t.drivers[seat].pending(); const c = policy.choose(d, viewOf(x.s, seat), new AI.Rng('pick')); return { ...c, d, o: d.options.find((o) => o.id === c.option) }; };

  // With nothing else in its sights, the designation is the attack it makes.
  const lone = await table({ policies: { s1: tact, s2: script(calm) } });
  lone.turnOf(lone.U.Dune, 'firing');
  const asked = lone.t.drivers.s1.pending();
  const deedOf = (skills) => AI.weighed(asked, viewOf(lone.s, 's1'), skills).find((p) => p.how === 'stay');
  const stalk = deedOf(SK);
  const seenWorth = (() => {
    const v = clone(lone.s);
    const ghost = v.tokens.find((u) => u.uid === lone.U.Ghost.uid);
    ghost.statuses = ghost.statuses.filter((id) => id !== 'camouflage');
    const d = new AI.Driver('s1', { data, state: () => v, send: () => ({ ok: true }), roll: async () => [] }, AI.eagerPolicy, new AI.Rng('x')).pending();
    return AI.weighed(d, M.SEAT.viewOf(data, v, 's1'), SK).find((p) => p.how === 'stay').now;
  })();
  check('THE TACTICIAN ATTACKS A CAMOUFLAGED UNIT THROUGH ITS FREE SCAN, weighed at the odds of both: with nothing else in its sights the designation is the deed it would make where it stands, worth something, and less than the same attack on the unit seen',
    [/in Optical Camouflage: one free Scan first/.test(stalk.does), stalk.now > 0, stalk.now < seenWorth], [true, true, true]);
  check('with its skill off (`stalk`) it has no such deed, as before this was built; nor does the Brawler, which has no rule for it, make one; the eager policy takes whatever attack it is offered, this one too',
    [deedOf({ ...SK, stalk: false }).does, [AI.brawlerPolicy, AI.eagerPolicy].map((p) => pick(lone, 's1', p).o.tags.includes('hidden'))], ['', [false, true]]);
  const chase = [];
  await lone.t.run({ until: (st) => st.script.opp?.uid !== lone.U.Dune.uid && !st.script.counter && !st.script.combatView, maxSteps: lone.t.steps() + 40,
    onStep: (seat, r) => chase.push(`${seat}:${r.option.tags.includes('hidden') ? 'designation' : r.option.id}:${lone.t.drivers[seat].log.at(-1)?.reason ?? ''}`) });
  check('and its Opportunity played out makes it, and says why', [chase.includes('s1:designation:attack_value'), lone.t.refused], [true, []]);
  lone.t.close();
  // It walks to where it could designate one, as it walks to any target.
  const walk = await table({ policies: AI.eagerPolicy });
  walk.at(walk.U.Dune, 3, 2, 2); walk.at(walk.U.Ghost, 3, 9, 0);
  walk.turnOf(walk.U.Dune, 'firing');
  const plans = (skills) => AI.weighed(walk.t.drivers.s1.pending(), viewOf(walk.s, 's1'), skills);
  const toStrike = (skills) => plans(skills).filter((p) => p.how === 'move' && /in Optical Camouflage/.test(p.does)).length;
  check('IT WALKS TO WHERE IT COULD DESIGNATE ONE: a Grid out of its gun\'s reach of the hidden Ghost, it weighs the Grids its Maneuver takes it to from which the gun reaches the marker, each with the designation as what it would do there; with `stalk` off no Grid has anything to do',
    [toStrike(SK) > 0, toStrike({ ...SK, stalk: false }), plans(SK).find((p) => p.how === 'stay').does], [true, 0, '']);
  walk.t.close();
  // A seen target beside a hidden one: the same gun on each.
  const both = await table({ policies: AI.eagerPolicy });
  both.at(both.U.Bison, 4, 7, 0);
  both.turnOf(both.U.Dune, 'firing');
  const offer = both.t.drivers.s1.pending();
  const deed = AI.weighed(offer, viewOf(both.s, 's1'), SK).find((p) => p.how === 'stay');
  check('of a unit it can see and a unit it must first find, both in its sights and the same gun on each, the attack it would make is on the one it can see',
    [/ at Bison/.test(deed.does), /Optical Camouflage/.test(deed.does), offer.options.some((o) => o.tags.includes('hidden')), offer.options.some((o) => o.run?.routine === 'attack' && o.facts.targetUid === both.U.Bison.uid)],
    [true, false, true, true]);
  both.t.close();

  // The attack behind a won Scan is made.
  const won = await table({ policies: { s1: script((d) => (d.kind === 'reaction.answer' ? '-' : calm(d) ?? (d.kind === 'opp.act' ? d.options.find((o) => o.tags.includes('hidden'))?.id ?? null : null))), s2: script((d) => (d.kind === 'reveal.make' ? 'reveal:stay' : calm(d))) } });
  won.turnOf(won.U.Dune, 'firing');
  await won.t.run({ until: () => won.t.drivers.s1.pending()?.kind === 'reaction.answer', maxSteps: won.t.steps() + 40 });
  const resumed = pick(won, 's1');
  check('the attack behind a won Scan is paid for, and is made', [resumed.option, resumed.reason, resumed.score > 0], ['resume:536_A', 'attack_revealed', true]);
  won.t.close();

  // Where it appears.
  // (The Ghost alone against the hunters: nothing of its own squad to stand by.)
  const owing = async (policy, arrange, skills) => {
    const x = await table({ policies: AI.eagerPolicy, scn: hunt });
    arrange(x);
    x.s.script.revealDue = [{ uid: x.U.Ghost.uid, why: 'touch', byUid: x.U.Dune.uid }];
    x.turnOf(x.U.Dune, 'firing');
    const c = pick(x, 's2', policy);
    // How many attacks the two guns would be offered on the Ghost, standing in each Grid it may appear in: the engine's count.
    const shots = (o) => [x.U.Dune, x.U.Sand].reduce((n, e) => n + (o.after().turnOf(e.uid, ['attack'], 'firing')?.options ?? []).filter((y) => y.facts?.targetUid === x.U.Ghost.uid).length, 0);
    const costs = Object.fromEntries(c.d.options.map((o) => [o.id, shots(o)]));
    // And the rule's own working: each Grid as it was weighed, the best first.
    const rows = AI.weighed(c.d, viewOf(x.s, 's2'), skills);
    x.t.close();
    return { ...c, costs, rows };
  };
  // Two guns on it where it stands, and a Grid two off that neither can see past its own squad's Mech... on open ground: out of both guns' Range.
  // (With nothing to strike back with and no Main Task played, where it stands is weighed for what could be done to it there and nothing else.)
  const guns = (x) => {
    x.at(x.U.Dune, 3, 2, 2); x.at(x.U.Sand, 4, 2, 2); x.at(x.U.Ghost, 3, 7, 0);
    x.U.Ghost.partStates = { ...x.U.Ghost.partStates, leftHand: 'destroyed', rightHand: 'destroyed' };
  };
  const BARE = { ...SK, mission: false };
  const shown = await owing(AI.makeTactician(BARE), guns, BARE);
  const kept = await owing(AI.makeTactician({ ...BARE, appear: false }), guns, BARE);
  const row = (x, label) => x.rows.find((p) => p.label.endsWith(label));
  // What it costs to stand somewhere is what the other squad could still do to it there this round, a walk first
  // if need be: a Grid no gun reaches now is not a Grid no gun will reach.
  check('WHERE IT APPEARS IS WEIGHED AS A GRID TO DEPLOY IN IS: unarmed under two guns, every Grid in reach is priced for what could be done to it there before the round is out; the Grid nearest the guns costs most, staying costs more than the best of them, and it appears in the one that costs least and says why; with the skill off (`appear`) it Reveals where it stands',
    [shown.d.kind, shown.rows.length, shown.o.label === shown.rows[0].label, shown.rows[0].how, row(shown, 'appears in D6').cost > row(shown, 'where it stands').cost, row(shown, 'where it stands').cost > shown.rows[0].cost,
      shown.rows.every((p) => p.cost >= shown.rows[0].cost - 1e-9), shown.costs['reveal:3,5'] > shown.costs['reveal:stay'], shown.reason, kept.option, kept.reason === 'appear_by_value'],
    ['reveal.make', 13, true, 'appear', true, true, true, true, 'appear_by_value', 'reveal:stay', false]);
  const blindRows = (await owing(AI.makeTactician({ ...BARE, exposure: false }), guns, { ...BARE, exposure: false }));
  check('and with nothing weighed at all (no Main Task, no cost of standing anywhere) no Grid is better than where it stands, so it stays there',
    [blindRows.rows.every((p) => p.cost === 0 && p.worth === 0), blindRows.option, blindRows.reason], [true, 'reveal:stay', 'reveal_in_place']);

  // Acting out of camouflage is priced as the unit seen.
  const lurk = await table({ policies: AI.eagerPolicy });
  lurk.at(lurk.U.Dune, 3, 4, 2); lurk.at(lurk.U.Sand, 4, 4, 2); lurk.at(lurk.U.Ghost, 3, 7, 0);
  lurk.turnOf(lurk.U.Ghost, 'firing');
  const lurking = (skills) => AI.weighed(lurk.t.drivers.s2.pending(), viewOf(lurk.s, 's2'), skills).find((p) => p.how === 'stay');
  const bare = clone(lurk.s);
  bare.tokens.find((u) => u.uid === lurk.U.Ghost.uid).statuses = lurk.U.Ghost.statuses.filter((id) => id !== 'camouflage');
  const seenCost = AI.weighed(new AI.Driver('s2', { data, state: () => bare, send: () => ({ ok: true }), roll: async () => [] }, AI.eagerPolicy, new AI.Rng('x')).pending(), M.SEAT.viewOf(data, bare, 's2'), SK).find((p) => p.how === 'stay').cost;
  check('A UNIT THAT ATTACKS OUT OF CAMOUFLAGE IS SEEN FOR IT, AND ITS PLAN IS PRICED SO: hidden under two guns with a shot of its own, standing there and shooting costs what it would cost the unit seen; with the skill off (`shown`) it was priced as if it stayed hidden',
    [/Dune|Sand/.test(lurking(SK).does), Math.abs(lurking(SK).cost - seenCost) < 1e-9, lurking({ ...SK, shown: false }).cost < lurking(SK).cost, seenCost > 0], [true, true, true, true]);
  lurk.t.close();

  // Activating it: a plan like a Stance.
  const hunted = await table({ policies: { s1: AI.eagerPolicy, s2: tact }, camo: false });
  hunted.at(hunted.U.Dune, 3, 4, 2); hunted.at(hunted.U.Sand, 4, 4, 2); hunted.at(hunted.U.Ghost, 3, 7, 0);
  hunted.U.Ghost.partStates = { ...hunted.U.Ghost.partStates, leftHand: 'destroyed', rightHand: 'destroyed' };
  hunted.turnOf(hunted.U.Ghost, 'tactical');
  const rows = AI.weighed(hunted.t.drivers.s2.pending(), viewOf(hunted.s, 's2'), SK);
  const cloak = rows.find((p) => p.how === 'token');
  const stay = rows.find((p) => p.how === 'stay');
  check('ACTIVATING IT IS A PLAN LIKE A STANCE: under two guns and with nothing to strike back with, the Ghost weighs putting the camouflage on, and standing there costs less in it (each gun must win a Scan first)',
    [!!cloak, cloak && /Optical Camouflage/.test(cloak.label), cloak && cloak.cost < stay.cost, stay.cost > 0], [true, true, true, true]);
  const taken = [];
  await hunted.t.run({ until: (st) => st.script.opp?.uid !== hunted.U.Ghost.uid, maxSteps: hunted.t.steps() + 12, onStep: (seat, r) => taken.push(`${seat}:${r.option.id}:${hunted.t.drivers[seat].log.at(-1).reason}`) });
  check('and its Opportunity played out takes it, and says why: the Ghost ends its turn hidden',
    [taken.includes('s2:token:096_B:cloak'), hidden(hunted.U.Ghost), hunted.t.refused], [true, true, []]);
  hunted.t.close();
  const plain = await table({ policies: { s1: AI.eagerPolicy, s2: AI.makeTactician({ ...SK, cloak: false }) }, camo: false });
  plain.at(plain.U.Dune, 3, 4, 2); plain.at(plain.U.Sand, 4, 4, 2); plain.at(plain.U.Ghost, 3, 7, 0);
  plain.U.Ghost.partStates = { ...plain.U.Ghost.partStates, leftHand: 'destroyed', rightHand: 'destroyed' };
  plain.turnOf(plain.U.Ghost, 'tactical');
  check('with its skill off (`cloak`) no such plan is weighed',
    AI.weighed(plain.t.drivers.s2.pending(), viewOf(plain.s, 's2'), { ...SK, cloak: false }).some((p) => p.how === 'token'), false);
  plain.t.close();
}

// ---------- a look ahead ----------
{
  // What an enemy could do to a unit that owes its Reveal is asked of the unit seen.
  const { s, U, at, turnOf, send } = stage();
  at(U.Dune, 3, 4, 2);
  const d = turnOf(U.Ghost, 'movement');
  const step = d.options.find((o) => o.tags.includes('maneuver') && o.facts.to?.c === 4 && o.facts.to?.r === 7);
  const hiddenNow = M.SEAT.owedIfActivated(data, s, U.Dune.uid, 'firing').decision.options.filter((o) => o.tags[0] === 'attack').map((o) => o.tags.includes('hidden'));
  send('s2', step.commands);
  const after = M.SEAT.owedIfActivated(data, s, U.Dune.uid, 'firing');
  check('A LOOK AHEAD SEES A UNIT THAT OWES ITS REVEAL AS IT WILL STAND BY THEN: before the Ghost moves, the Dune\'s turn would hold only designations of it; once it has Maneuvered without Silence and owes its Reveal, the Dune\'s turn is asked of the unit seen, and the table in play is not touched',
    [hiddenNow.length > 0 && hiddenNow.every(Boolean), s.script.revealDue.map((x) => x.why), after.decision.options.filter((o) => o.tags[0] === 'attack').map((o) => [o.tags.includes('hidden'), o.run?.routine ?? null]),
      hidden(U.Ghost), s.script.revealDue.length],
    [true, ['move'], [[false, 'attack']], true, 1]);
}

// ---------- the paid Scan (M8.2m) ----------
{
  // The Dune has walked, back to the hidden Ghost, and has no Tick left. Its
  // pilot (FPA-04-2) could buy one with a Link, and all it would buy is a
  // Scan of the Ghost: a Scan, not a jam.
  const x = await table({ policies: AI.tacticianPolicy, scn: hunt });
  x.at(x.U.Dune, 3, 4, 0);
  x.U.Dune.stance = 'offensive';
  x.turnOf(x.U.Dune, 'movement');
  const walk = x.t.drivers.s1.pending().options.find((o) => o.tags[0] === 'move' && o.facts?.actionId === '534_A' && o.facts.to.c === 3 && o.facts.to.r === 3);
  sendAll(x.s, walk.commands);
  const d = x.t.drivers.s1.pending();
  const view = M.SEAT.viewOf(data, x.s, 's1');
  const opened = d.options.find((o) => o.id === 'tick:link')?.then?.()?.options ?? [];
  check('A SCAN PAID FOR AT A UNIT IN OPTICAL CAMOUFLAGE IS NO JAM: with no Tick left, a Link bought for one would buy only a Scan of the hidden Ghost, so the Dune keeps its Link and ends; priced as a jam (`scan` off), it bought the Tick for that Scan',
    [x.s.script.opp.action, opened.some((o) => o.tags.includes('scan') && o.facts?.targetUid === x.U.Ghost.uid),
      AI.tacticianPolicy.choose(d, view, new AI.Rng('s')).option, AI.makeTactician({ scan: false }).choose(d, view, new AI.Rng('s')).option],
    [0, true, 'end', 'tick:link']);
  x.t.close();
  // What the Tick would open, weighed: no plan there prices the Scan as a jam.
  const jams = (q, v, skills) => AI.weighed(q, v, skills).filter((r) => /Scan.*its Firing is what it would lose/.test(r.does ?? '')).length;
  const thereCamo = d.options.find((o) => o.id === 'tick:link').then();
  check('  (weighed where the Tick would leave it, no plan prices that Scan as a jam; with `scan` off one does)',
    [jams(thereCamo, view, {}), jams(thereCamo, view, { scan: false }) > 0], [0, true]);
  // The same board, the Ghost seen and bearing Low Profile instead: a Scan that
  // strips it is priced as it was.
  const y = await table({ policies: AI.tacticianPolicy, scn: hunt, camo: false });
  y.U.Ghost.statuses = [...(y.U.Ghost.statuses ?? []), 'lowProfile'];
  y.at(y.U.Dune, 3, 4, 0);
  y.U.Dune.stance = 'offensive';
  y.turnOf(y.U.Dune, 'movement');
  sendAll(y.s, y.t.drivers.s1.pending().options.find((o) => o.tags[0] === 'move' && o.facts?.actionId === '534_A' && o.facts.to.c === 3 && o.facts.to.r === 3).commands);
  const e = y.t.drivers.s1.pending();
  const thereLow = e.options.find((o) => o.id === 'tick:link')?.then?.();
  check('and a Scan that strips Low Profile is priced as it was', [(thereLow?.options ?? []).some((o) => o.tags.includes('scan')), jams(thereLow, M.SEAT.viewOf(data, y.s, 's1'), {}) > 0], [true, true]);
  y.t.close();
}

// ---------- whole games ----------
M.L.setLocalSeat(null);
{
  const tally = { games: 0, over: 0, refused: 0, broken: [], scans: 0, reveals: 0, resumed: 0, cloaks: 0, hid: 0 };
  // In the first games the Tactician hunts a squad that ends every turn it is
  // given, so its Ghost stays hidden until it is found: the whole road is
  // walked in play nobody staged.
  const still = {
    name: 'still',
    choose(d, view, rng) {
      const end = d.kind === 'opp.act' || d.kind === 'activation.act' ? d.options.find((o) => o.id === 'end') : undefined;
      return end ? { option: end.id, why: 'scripted' } : AI.legalPolicy.choose(d, view, rng);
    },
  };
  const POLICIES = { legal: AI.legalPolicy, eager: AI.eagerPolicy, brawler: AI.brawlerPolicy, tactician: AI.tacticianPolicy };
  // The hunters fly FPA-04-2 and buy a Tick with their Link (M8.2l). With one
  // to spare they paid for the Scan the designation would have had free, a
  // paid Scan being priced as a jam, until a Scan at a unit an attack could
  // designate stopped being weighed as one (M8.2m, skill `scan`).
  const hunter = AI.tacticianPolicy;
  for (const [policy, seeds] of [['hunt', [1, 2, 3]], ['legal', [1, 2, 3]], ['eager', [1]], ['brawler', [1]], ['tactician', [1, 2]]]) {
    for (const seed of seeds) {
      const t = botTable(M, data, policy === 'hunt' ? hunt : scenario, { seed, policies: policy === 'hunt' ? { s1: hunter, s2: still } : POLICIES[policy], glue: M.HUD.glueAfter });
      const behind = new Set();
      t.watch((cmd) => {
        if (cmd.kind === 'startCounterRoll' && cmd.thenAttack) tally.scans += 1;
        if (cmd.kind === 'reveal') tally.reveals += 1;
        if (cmd.kind === 'queueReactions') for (const r of cmd.items) if (r.kind === 'scanAttack') behind.add(`${r.uid}:${r.actionId}`);
        if (cmd.kind === 'resolveReaction' && behind.delete(`${cmd.uid}:${cmd.actionId}`) && cmd.placed) tally.resumed += 1;
        if (cmd.kind === 'applyStatus' && cmd.statusId === 'camouflage') tally.cloaks += 1;
        if (cmd.kind === 'deployUnit' && cmd.camo) tally.hid += 1;
      });
      let end;
      try { end = await t.run({ maxSteps: 16000 }); } catch (err) { end = { kind: 'threw', why: `${err?.message ?? err}`.split('\n')[0] }; } finally { t.close(); }
      tally.games += 1;
      if (end.kind === 'over') tally.over += 1; else tally.broken.push(`${policy} ${seed}: ${end.kind} ${end.why ?? ''} ${end.decision ?? ''}`);
      tally.refused += t.refused.length;
    }
  }
  check('TEN GAMES with a squad that wears Optical Camouflage, on the page\'s glue, six policies: every one ends as a game should, nothing refused',
    [tally.over, tally.games, tally.refused, tally.broken], [10, 10, 0, []]);
  check('and in them the Ghost deployed hidden every time, was designated through a free Scan, Revealed, and was attacked once it had appeared',
    [tally.hid, tally.scans > 3, tally.reveals > 5, tally.resumed > 0], [10, true, true, true]);
  void POLICIES;
  console.log(`       deployed hidden ${tally.hid}, designations ${tally.scans}, Reveals ${tally.reveals}, attacks resumed ${tally.resumed}, camouflage put on again ${tally.cloaks}`);
}

console.log(`\n${pass} passed, ${fail} failed`);
M.L.setLocalSeat(null);
if (fail) process.exit(1);
