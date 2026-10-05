// SHOCK ATTACK X FOR A SEAT (AI-OPPONENT-PLAN.md, "THE MORNING OF 2026-10-05",
// item 3; owed.ts, turn.ts shockWalk, the Tactician's skill `shock`). The
// Spear, the Lance and the Halberd gain Shock Attack 1 in Offensive Stance:
// "Before performing this Action, may move X grids" (Supplementary Rules 1.04,
// 3.8). The Match Centre asks it at its attack door ("Move first"); a seat was
// offered the Thrust from where the Mech stood and never the walk. Now the
// seam offers the walk and the attack as one answer, and the Tactician plans
// it, alone or after its Maneuver. Staged on the real engine: a Mech with the
// Spear in its Melee Opportunity, an enemy some Grids east of it.
import { botTable, loadEngine } from './_engine.mjs';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}\n       got  ${g}`); }
};

console.log('Shock Attack for a seat\n');

const { M, data } = await loadEngine('seatshock', ["export * as SEAT from '../src/seat';", "export * as AI from '../src/ai/index';"]);
const AI = M.AI;
// The Lancer: a Mire with the M115 Spear and nothing else to fight with. The
// Target: a UN Mech, its turn behind it.
data.solo.squads['t-lancer'] = { name: 'Lancer', faction: 'GOF', points: 0, mechs: [{ name: 'Lancer', loadout: { torso: '012', chasis: '020', rightHand: 'ZHRA-103', pilot: 'FPA-04-2' } }], drones: [] };
data.solo.squads['t-target'] = { name: 'Target', faction: 'UN', points: 0, mechs: [{ name: 'Target', loadout: { torso: '539', chasis: '099', pilot: 'LPA-23-2' } }], drones: [] };
const scenario = { ...data.solo.scenarios[0], id: 't-shock', map: 'none', seats: { s1: 't-lancer', s2: 't-target' } };

// Round 2's Action Phase, the Lancer's Melee Opportunity open at D6 in `stance`,
// the Target `gap` Grids east of it.
const staged = async (gap, stance = 'offensive', policies = AI.eagerPolicy) => {
  const t = botTable(M, data, scenario, { seed: 4, policies });
  await t.run({ until: (st) => M.SU.normaliseSetup(st.setup)?.stage === 'done' && st.round.phase === 2 });
  const s = t.state;
  const U = Object.fromEntries(s.tokens.map((x) => [x.label, x]));
  const at = (x, c, r, f) => { x.col = c * 3; x.row = r * 3; x.facing = f; };
  at(U.Lancer, 3, 5, 1); at(U.Target, 3 + gap, 5, 3);
  for (const x of s.tokens) x.statuses = (x.statuses ?? []).filter((y) => y !== 'camouflage');
  s.round.n = 2; s.script.stage = '2:2'; s.script.revealed = ['s1', 's2']; s.script.passed = [];
  U.Lancer.timing = 'melee'; U.Target.timing = 'firing'; U.Lancer.stance = stance;
  s.script.acted = [U.Target.uid];
  s.script.opp = null;
  M.G.opportunity(data, s);
  return { t, U, d: t.drivers.s1.pending(), view: M.SEAT.viewOf(data, s, 's1') };
};
const shockOn = (d, uid) => (d?.options ?? []).filter((o) => o.tags.includes('shock') && o.facts?.targetUid === uid);
const plainOn = (d, uid) => (d?.options ?? []).filter((o) => o.tags[0] === 'attack' && !o.tags.includes('shock') && o.facts?.targetUid === uid && o.facts?.actionId === 'ZHRA-103_A');

{
  const x = await staged(3);
  const walks = shockOn(x.d, x.U.Target.uid);
  check('IN OFFENSIVE STANCE, THREE GRIDS OFF: the Thrust after a Shock Attack walk is offered, ending a Grid nearer, and the Thrust from where it stands is not',
    [x.d?.kind, walks.length > 0, walks.every((o) => o.facts?.actionId === 'ZHRA-103_A' && o.facts?.to?.c === 4 && o.facts?.to?.r === 5), plainOn(x.d, x.U.Target.uid).length],
    ['opp.act', true, true, 0]);
  check('the answer pays the Action and makes the walk before the attack: the Match Centre\'s order',
    walks[0]?.run?.args?.before?.map((c) => [c.kind, c.free ?? null, c.actionId ?? null]), [['performAction', null, 'ZHRA-103_A'], ['maneuver', true, 'ZHRA-103_A']]);
  check('the seat reads the walk off the Spear: Shock Attack 1',
    x.view.units.find((u) => u.uid === x.U.Lancer.uid)?.weapons.find((w) => w.actionId === 'ZHRA-103_A')?.shock, 1);
  x.t.close();
}
{
  const x = await staged(3, 'defensive');
  check('IN DEFENSIVE STANCE no walk is offered (the grant is Offensive Stance\'s)',
    [x.d?.kind, shockOn(x.d, x.U.Target.uid).length, x.view.units.find((u) => u.uid === x.U.Lancer.uid)?.weapons.find((w) => w.actionId === 'ZHRA-103_A')?.shock ?? null], ['opp.act', 0, null]);
  x.t.close();
}
{
  // Four Grids off: the Maneuver of one, then the walk of one, then the Thrust.
  const x = await staged(4);
  // The skill is ON by default since 2026-10-05: without it is asked for in so many words.
  const off = AI.weighed(x.d, x.view, { shock: false }, {});
  const on = AI.weighed(x.d, x.view, { shock: true }, {});
  check('FOUR GRIDS OFF: without `shock` no plan takes the walk',
    off.some((r) => r.how === 'shock'), false);
  check('with it the plan worth most is the Maneuver, the walk and the Thrust, ending two Grids nearer',
    [on[0].how, on[0].at.col, on[0].at.row, /Maneuver to E6/.test(on[0].label), /Shock Attack walk to F6/.test(on[0].label)], ['shock', 5, 5, true, true]);
  x.t.close();
}
{
  // Played: a seat that takes the walk and the attack, three Grids off. The
  // engine takes the answer whole: the Lancer stands a Grid nearer, and the
  // Thrust has been made (the Target's Defense was asked for).
  const takes = { name: 'shock', choose: (d) => {
    const o = d.options.find((y) => y.tags.includes('shock'));
    return o ? { option: o.id, why: 'the walk' } : AI.eagerPolicy.choose(d);
  } };
  const x = await staged(3, 'offensive', { s1: takes, s2: AI.eagerPolicy });
  const sent = [];
  const start = { col: x.U.Lancer.col, row: x.U.Lancer.row };
  const end = await x.t.run({ maxSteps: 40, onStep: (seat, r) => { sent.push(`${seat}:${r.decision.kind}:${r.option?.tags?.includes('shock') ? 'shock' : ''}`); }, until: (st) => st.round.n > 2 || sent.some((k) => k.endsWith(':shock')) && !st.script?.combat });
  const lancer = x.t.state.tokens.find((u) => u.uid === x.U.Lancer.uid);
  check('PLAYED: the seat sends the walk and the attack, and the table takes them (the Lancer a Grid east, nothing refused)',
    [end.kind, sent.some((k) => k.endsWith(':shock')), Math.floor(lancer.col / 3) - Math.floor(start.col / 3), x.t.refused.length], ['paused', true, 1, 0]);
  x.t.close();
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
