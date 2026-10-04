// AN ESCORT (AI-OPPONENT-PLAN.md, M13: `escort`, the Tactician's weight; 0
// weighs a unit's own Grid alone). On a VIP mission the squad's Commander is
// worth the Main Task, and a unit standing between it and an enemy's line of
// fire takes the line. A plan that moves a unit within three Grids of its
// Commander is charged what it leaves the Commander more open to, and credited
// what it spares it. Staged on the copied VIP game, on open ground.
import { botTable, loadEngine } from './_engine.mjs';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}\n       got  ${g}`); }
};

console.log('An escort\n');

const { M, data } = await loadEngine('seatescort', ["export * as SEAT from '../src/seat';", "export * as AI from '../src/ai/index';"]);
const AI = M.AI;
const name = (t) => (t.label.startsWith('ADK15P') ? 'Porcupine' : t.label.startsWith('ADK60S') ? 'Raven' : t.label.startsWith('ADK30C') ? 'Tarantula' : t.label);
// The copied VIP game (RDL's Mire and Dune against UN), in round 2's Action
// Phase, RDL to act: `who` holds its Opportunity, the other RDL Mech is the
// Commander. The Wild Cat stands south of the Commander with a clear line.
const staged = async (who, place) => {
  const vip = data.solo.scenarios.find((s) => /vip/.test(s.mission)) ?? data.solo.scenarios[1];
  const t = botTable(M, data, { ...vip, map: 'none' }, { seed: 5, policies: { s1: AI.makeTactician({ focus: false }), s2: AI.eagerPolicy } });
  await t.run({ until: (st) => M.SU.normaliseSetup(st.setup)?.stage === 'done' && st.round.phase === 2 });
  const s = t.state;
  const U = Object.fromEntries(s.tokens.map((x) => [name(x), x]));
  const at = (x, c, r, f) => { x.col = c * 3; x.row = r * 3; if (f !== undefined) x.facing = f; };
  at(U.Porcupine, 11, 0, 2); at(U.Raven, 11, 1, 2); at(U.Tarantula, 10, 0, 2);
  place(U, at);
  s.round.n = 2; s.script.stage = '2:2';
  for (const x of s.tokens) if (x.kind === 'mech') x.timing = 'firing';
  s.script.revealed = ['s1', 's2'];
  s.script.acted = s.tokens.filter((x) => x.kind === 'mech' && x.uid !== U[who].uid).map((x) => x.uid);
  s.script.opp = null;
  M.G.opportunity(data, s);
  const d = t.drivers.s1.pending();
  return { t, U, d, view: M.SEAT.viewOf(data, s, 's1') };
};
{
  const x = await staged('Mire', (U, at) => { at(U.Dune, 4, 4, 2); at(U.Mire, 5, 4, 0); at(U['Wild Cat'], 4, 8, 0); });
  const lead = x.view.units.find((u) => u.commander && u.side === 's1');
  const off = AI.weighed(x.d, x.view, { focus: false }, { escort: 0 });
  const on = AI.weighed(x.d, x.view, { focus: false }, { escort: 1 });
  // E8 stands in the Wild Cat's line to the Dune (both in column E); G5 does not.
  const row = (rows, label) => rows.find((p) => p.label.includes(label));
  const inWay = [row(off, 'to E8'), row(on, 'to E8')];
  const aside = [row(off, 'to G5'), row(on, 'to G5')];
  check('ON A VIP MISSION, THE MIRE\'S WALK INTO THE WILD CAT\'S LINE TO ITS COMMANDER (E8) IS WORTH WHAT IT SPARES THE COMMANDER (`escort` 1), and becomes its plan; a walk out of the line (G5) is worth what it was',
    [x.d?.kind, !!lead, lead && lead.uid !== x.U.Mire.uid, inWay.every(Boolean) && inWay[1].now > inWay[0].now + 1, aside.every(Boolean) && Math.abs(aside[1].now - aside[0].now) < 1e-9, on[0].label.includes('to E8')],
    ['opp.act', true, true, true, true, true]);
  x.t.close();
}
{
  // Far from its Commander, a unit's plans are what they were.
  const y = await staged('Mire', (U, at) => { at(U.Dune, 0, 0, 2); at(U.Mire, 9, 6, 2); at(U['Wild Cat'], 1, 9, 0); });
  const off = AI.weighed(y.d, y.view, { focus: false }, { escort: 0 });
  const on = AI.weighed(y.d, y.view, { focus: false }, { escort: 1 });
  const same = off.every((p) => { const q = on.find((z) => z.label === p.label); return !q || Math.abs(q.worth - p.worth) < 1e-9; });
  check('FAR FROM ITS COMMANDER (more than three Grids, before and after), a unit\'s plans are worth what they were', same, true);
  y.t.close();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
