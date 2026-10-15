// THE ENEMY'S ANSWER, JUDGED (`reply`, M25's first form, 2026-10-14 night). The learned judge read the table a plan
// leaves as though the unit then stood there safe; the exposure reads the other squad's answer there (`risk`). With the
// skill the judge reads both: the table the plan leaves, and the same table without the unit, as often as the answer
// destroys it.
//
// Staged on the real engine, on an empty board, in round 1's Action Phase, the judge the site ships loaded: RDL's Hail
// (an ML-32 Dual Launcher, MC-3 "Razor" Missiles) on a Projectile dial, UN's Raven EC Type and UN's Rifle. Hail whole
// with the Rifle far off: plans nothing can destroy it in. Hail with its Torso and Chassis damaged, the Rifle four
// Grids off: plans the Rifle's answer may destroy it in.
import { botTable, loadEngine } from './_engine.mjs';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}\n       got  ${g}`); }
};

console.log('The enemy\'s answer, judged\n');

const { M, data } = await loadEngine('seatreply', ["export * as SEAT from '../src/seat';", "export * as AI from '../src/ai/index';"]);
const AI = M.AI;
data.solo.squads['t-hail'] = {
  name: 'Hail', faction: 'RDL', points: 0,
  mechs: [{ name: 'Hail', loadout: { torso: '014', chasis: '020', leftHand: '029', rightHand: '033', pilot: 'FPA-14' } }],
  drones: [],
};
data.solo.squads['t-raven'] = {
  name: 'Raven', faction: 'UN', points: 0,
  mechs: [{ name: 'Rifle', loadout: { torso: '539', chasis: '099', rightHand: '541', pilot: 'LPA-23-2' } }],
  drones: [{ cardId: '165' }],
};
const at = (x, c, r, f) => { x.col = c * 3; x.row = r * 3; if (f !== undefined) x.facing = f; };
const scenario = { ...data.solo.scenarios[0], id: 't-reply', map: 'none', mission: 'none', seats: { s1: 't-hail', s2: 't-raven' } };
// Hail's Opportunity on a fresh table: `hurt` its Parts damaged, the Rifle at `rifle`, the Raven at `raven`.
const stage = async (hurt, rifle, raven) => {
  const t = botTable(M, data, scenario, { seed: 5, policies: { s1: AI.eagerPolicy, s2: AI.eagerPolicy } });
  await t.run({ until: (st) => M.SU.normaliseSetup(st.setup)?.stage === 'done' && st.round.phase === 2 });
  const s = t.state;
  const U = Object.fromEntries(s.tokens.map((x) => [x.kind === 'drone' ? 'Raven' : x.label, x]));
  at(U.Hail, 5, 2, 2); at(U.Rifle, ...rifle, 0); at(U.Raven, ...raven, 0);
  for (const x of s.tokens) { x.stance = 'offensive'; x.timing = 'firing'; }
  U.Hail.timing = 'projectile';
  for (const p of hurt) U.Hail.partStates[p] = 'damaged';
  s.script.revealed = ['s1', 's2'];
  s.script.acted = [U.Raven.uid];
  s.script.opp = null;
  M.G.opportunity(data, s);
  const d = t.drivers.s1.pending();
  const view = M.SEAT.viewOf(data, s, 's1');
  const key = (r) => `${r.label}@${r.at?.col},${r.at?.row}`;
  const off = new Map(AI.weighed(d, view, {}, {}).filter((r) => r.priced).map((r) => [key(r), r]));
  const on = new Map(AI.weighed(d, view, { reply: true }, {}).filter((r) => r.priced).map((r) => [key(r), r]));
  t.close();
  return { d, U, off, on, both: [...off.keys()].filter((k) => on.has(k)) };
};

{
  const { d, U, off, on, both } = await stage([], [5, 8], [5, 5]);
  check('THE STAGE: Hail\'s Opportunity is open, the shipped judge loaded, the Ace\'s weight on it as it ships',
    [d?.kind, d?.unit === U.Hail.uid, AI.hasModel(), AI.TACTICIAN.learned > 0], ['opp.act', true, true, true]);
  const safe = both.filter((k) => off.get(k).risk <= 1e-9);
  check('HAIL WHOLE, THE RIFLE FAR OFF: plans nothing can destroy it in, and there the judge reads the same with the skill',
    [safe.length > 0, safe.every((k) => Math.abs(on.get(k).judged - off.get(k).judged) < 1e-9)], [true, true]);
}
{
  const { off, on, both } = await stage(['torso', 'chasis'], [5, 6], [2, 2]);
  const risky = both.filter((k) => off.get(k).risk > 0.01);
  check('HAIL DAMAGED, THE RIFLE FOUR GRIDS OFF: plans the Rifle\'s answer may destroy it in, and there the judge reads less with the skill (the same table without Hail, as often as it is lost)',
    [risky.length > 0, risky.every((k) => on.get(k).judged < off.get(k).judged - 1e-9)], [true, true]);
}
check('THE SKILL SHIPS OFF', AI.SKILLS.reply, false);

console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
