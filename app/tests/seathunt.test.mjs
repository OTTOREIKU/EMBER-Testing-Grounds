// THE OTHER SQUAD'S CARRIER, HUNTED (AI-OPPONENT-PLAN.md, M11: `hunt` and
// `huntTurn`, the Tactician's weights; `hunt` 0 walks for a Box only while it
// lies loose). OTTO, 2026-10-03: "if I saw someone go for the box ... I would
// plan accordingly to try to intercept and stop them or steal it myself". A
// carrier Penetrated drops what it carries, and the attack is worth that
// (`carried`); what was missing is the walk to it from further off than a turn.
// A traced game (2026-10-04): an RDL Missile Brawler sat in its corner at
// "worth 0.00" all game while a UN Mech walked off with three Boxes. Staged on
// the copied Key Facility table, on open ground: the Wild Cat holds a Box.
import { botTable, loadEngine } from './_engine.mjs';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}\n       got  ${g}`); }
};

console.log('A carrier hunted\n');

const { M, data } = await loadEngine('seathunt', ["export * as SEAT from '../src/seat';", "export * as AI from '../src/ai/index';"]);
const AI = M.AI;
const viewOf = (state, seat) => M.SEAT.viewOf(data, state, seat);
const name = (t) => (t.label.startsWith('ADK15P') ? 'Porcupine' : t.label.startsWith('ADK60S') ? 'Raven' : t.label.startsWith('ADK30C') ? 'Tarantula' : t.label);
const keyGame = { ...data.solo.scenarios[0], id: 't-hunt', mission: 'blackbox-key-facilities' };
// Round 3's Action Phase, the Dune's Movement Opportunity open, every other
// Mech having acted; the Boxes along the bottom edge unless `arrange` says.
const staged = async (arrange) => {
  // (Played by the Ace as it was staged, `press` 0: adopted at 10 since, it changes how a squad that is behind
  // deploys and walks, and the staged moment is never reached.)
  const t = botTable(M, data, { ...keyGame, map: 'none' }, { seed: 2, policies: { s1: AI.makeTactician({ focus: false }, { press: 0, nextAfter: 0 }), s2: AI.eagerPolicy } });
  await t.run({ until: (st) => M.SU.normaliseSetup(st.setup)?.stage === 'done' && st.round.phase === 2 });
  const U = Object.fromEntries(t.state.tokens.map((x) => [name(x), x]));
  const at = (x, c, r, f) => { x.col = c * 3; x.row = r * 3; if (f !== undefined) x.facing = f; };
  at(U.Dune, 0, 0, 2); at(U.Mire, 0, 11, 0); at(U['Wild Cat'], 9, 7, 3); at(U.Porcupine, 11, 9, 0); at(U.Raven, 9, 11, 0); at(U.Tarantula, 11, 10, 0);
  const tasks = M.TK.normaliseTasks(t.state.tasks);
  const boxes = tasks.items.filter((i) => i.kind === 'blackbox');
  boxes.forEach((b, i) => { b.col = (4 + i) * 3 + 1; b.row = 11 * 3 + 1; b.bearerUid = undefined; b.bearerSlot = undefined; });
  const carry = (unit, i) => { boxes[i].bearerUid = unit.uid; boxes[i].bearerSlot = 'leftHand'; boxes[i].col = undefined; boxes[i].row = undefined; };
  arrange({ U, at, carry });
  t.state.tasks = tasks;
  t.state.round.n = 3; t.state.script.stage = '3:2';
  U.Dune.timing = 'movement';
  t.state.script.revealed = ['s1', 's2'];
  t.state.script.acted = t.state.tokens.filter((x) => x.kind === 'mech' && x.uid !== U.Dune.uid).map((x) => x.uid);
  t.state.script.opp = null;
  M.G.opportunity(data, t.state);
  const d = t.drivers.s1.pending();
  return { t, U, d, view: viewOf(t.state, 's1') };
};
const apart = (a, b) => Math.abs(a.col - b.col) + Math.abs(a.row - b.row);
{
  const x = await staged(({ U, carry }) => carry(U['Wild Cat'], 0));
  const cat = x.view.units.find((u) => u.uid === x.U['Wild Cat'].uid).grid;
  const here = x.view.units.find((u) => u.uid === x.U.Dune.uid).grid;
  // (Every comparison at `press` 0, as the moments were staged: at 10, a squad behind counts its step toward
  // contact eleven times, and that is not the hunt's to measure.)
  const off = AI.weighed(x.d, x.view, { focus: false }, { hunt: 0, press: 0, nextAfter: 0 });
  const on = AI.weighed(x.d, x.view, { focus: false }, { hunt: 1, press: 0, nextAfter: 0 });
  const stay = (rows) => rows.find((p) => p.how === 'stay');
  // The walk worth most for where it leads (a Maneuver with the Sprint still
  // to make goes further than the Sprint alone).
  const lead = (rows) => rows.filter((p) => p.how === 'move').sort((a, b) => b.shape - a.shape)[0];
  check('THE WILD CAT HOLDS A BOX TWO ACTIVATIONS AWAY: at `hunt` 0 the best walk toward it is worth little more than staying (the step toward contact); at 1 a good deal more, and the plan chosen ends nearer it than the Dune stands',
    [x.d?.kind, lead(off).shape - stay(off).shape < 0.3, lead(on).shape - stay(on).shape > 0.4, apart(on[0].at, cat) < apart(here, cat)],
    ['opp.act', true, true, true]);
  // Nearer is worth more: each activation the walk still takes keeps
  // `huntTurn` of it. What the hunt adds to a plan, against `hunt` 0.
  const added = (rows, label) => rows.find((p) => p.label === label).shape - off.find((p) => p.label === label).shape;
  const gap = (w) => { const rows = AI.weighed(x.d, x.view, { focus: false }, { hunt: 1, press: 0, nextAfter: 0, ...w }); return added(rows, lead(rows).label) - added(rows, 'stay'); };
  check('A CHASE: with `huntTurn` 1 what the hunt adds is about the same wherever the walk ends (a Box pays whenever it is reached); with 0.5 it adds more to the walk that leads nearer',
    [Math.abs(gap({ huntTurn: 1 })) < 0.1, gap({ huntTurn: 0.5 }) > 0.2], [true, true]);
  x.t.close();
}
{
  // The Dune holding a Box of its own does not go after the Wild Cat's.
  const y = await staged(({ U, carry }) => { carry(U['Wild Cat'], 0); carry(U.Dune, 1); });
  const off = AI.weighed(y.d, y.view, { focus: false }, { hunt: 0, press: 0, nextAfter: 0 });
  const on = AI.weighed(y.d, y.view, { focus: false }, { hunt: 1, press: 0, nextAfter: 0 });
  const same = off.every((p) => { const q = on.find((z) => z.label === p.label); return !q || Math.abs(q.worth - p.worth) < 1e-9; });
  check('A UNIT CARRYING A BOX OF ITS OWN does not hunt: its plans are worth what they were', same, true);
  y.t.close();
}
{
  // Nobody carrying: nothing to hunt.
  const z = await staged(() => {});
  const off = AI.weighed(z.d, z.view, { focus: false }, { hunt: 0, press: 0, nextAfter: 0 });
  const on = AI.weighed(z.d, z.view, { focus: false }, { hunt: 1, press: 0, nextAfter: 0 });
  const same = off.every((p) => { const q = on.find((w) => w.label === p.label); return !q || Math.abs(q.worth - p.worth) < 1e-9; });
  check('WITH EVERY BOX LOOSE there is no carrier to hunt: the plans are worth what they were', same, true);
  z.t.close();
}

{
  // ON A VIP MISSION the other squad's Commander is hunted, by every unit but
  // this squad's own Commander. The copied VIP game: RDL's Commander is the
  // Dune; the Mire walks for UN's Commander, the Wild Cat, far to the south.
  const vip = data.solo.scenarios.find((s) => /vip/.test(s.mission)) ?? data.solo.scenarios[1];
  const vipTable = async (who) => {
    const t = botTable(M, data, { ...vip, map: 'none' }, { seed: 5, policies: { s1: AI.makeTactician({ focus: false }, { press: 0, nextAfter: 0 }), s2: AI.eagerPolicy } });
    await t.run({ until: (st) => M.SU.normaliseSetup(st.setup)?.stage === 'done' && st.round.phase === 2 });
    const U = Object.fromEntries(t.state.tokens.map((x) => [name(x), x]));
    const at = (x, c, r, f) => { x.col = c * 3; x.row = r * 3; if (f !== undefined) x.facing = f; };
    at(U.Dune, 1, 0, 2); at(U.Mire, 2, 0, 2); at(U['Wild Cat'], 9, 11, 0); at(U.Porcupine, 11, 0, 2); at(U.Raven, 11, 1, 2); at(U.Tarantula, 10, 0, 2);
    t.state.round.n = 2; t.state.script.stage = '2:2';
    for (const x of t.state.tokens) if (x.kind === 'mech') x.timing = 'movement';
    t.state.script.revealed = ['s1', 's2'];
    t.state.script.acted = t.state.tokens.filter((x) => x.kind === 'mech' && x.uid !== U[who].uid).map((x) => x.uid);
    t.state.script.opp = null;
    M.G.opportunity(data, t.state);
    return { t, U, d: t.drivers.s1.pending(), view: viewOf(t.state, 's1') };
  };
  const m = await vipTable('Mire');
  const lead = m.view.units.find((u) => u.side === 's2' && u.commander);
  const cat = lead?.grid;
  const off = AI.weighed(m.d, m.view, { focus: false }, { hunt: 0, press: 0, nextAfter: 0 });
  const on = AI.weighed(m.d, m.view, { focus: false }, { hunt: 1, press: 0, nextAfter: 0 });
  const stay = (rows) => rows.find((p) => p.how === 'stay');
  const lead2 = (rows) => rows.filter((p) => p.how === 'move').sort((a, b) => b.shape - a.shape)[0];
  check('ON A VIP MISSION THE MIRE HUNTS THE OTHER SQUAD\'S COMMANDER (the Wild Cat, far off): at `hunt` 0 no walk is worth more for it than the step toward contact; at 1 the best walk is worth a good deal more than staying and ends nearer the Wild Cat',
    [lead?.uid === m.U['Wild Cat'].uid, lead2(off).shape - stay(off).shape < 0.3, lead2(on).shape - stay(on).shape > 0.3, !!cat && apart(lead2(on).at, cat) < apart(m.view.units.find((u) => u.uid === m.U.Mire.uid).grid, cat)],
    [true, true, true, true]);
  m.t.close();
  const c = await vipTable('Dune');
  const offC = AI.weighed(c.d, c.view, { focus: false }, { hunt: 0, press: 0, nextAfter: 0 });
  const onC = AI.weighed(c.d, c.view, { focus: false }, { hunt: 1, press: 0, nextAfter: 0 });
  const same = offC.every((p) => { const q = onC.find((z) => z.label === p.label); return !q || Math.abs(q.worth - p.worth) < 1e-9; });
  check('THIS SQUAD\'S OWN COMMANDER does not hunt: the Dune\'s plans are worth what they were', [c.view.units.find((u) => u.uid === c.U.Dune.uid)?.commander, same], [true, true]);
  c.t.close();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
