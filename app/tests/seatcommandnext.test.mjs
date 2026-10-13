// A DRONE THAT ACTS ONLY WHEN COMMANDED, A TURN ON (`commandNext`, M22, 2026-10-12). The blind-spot census found the
// Hyena Missile Type and the Porcupine Microwave Type idle in half the games: a Drone's turn a round later was read as
// its Automatic Phase, where an Action bearing the Command icon is never made, so no Grid it could walk to was worth a
// Command. The engine now opens a Drone's later turn as a Command would (`later` with 'command': its Command Actions
// alone), and the Tactician reads it at `commandNext` of what that Command could strike.
//
// Staged on the real engine, on an empty board: RDL's Hyena Missile Type (a Missile, Projectile Range 3, a Command
// Action; Move 5) eight Grids from UN's Rifle, out of its reach, a Move from it. The Command Phase's question, weighed.
import { botTable, loadEngine } from './_engine.mjs';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}\n       got  ${g}`); }
};

console.log('A Command-only Drone, a turn on\n');

const { M, data } = await loadEngine('seatcommandnext', ["export * as SEAT from '../src/seat';", "export * as AI from '../src/ai/index';", "export * as HUD from '../src/matchhud';"]);
const AI = M.AI;
data.solo.squads['t-ours'] = {
  name: 'Ours', faction: 'RDL', points: 0,
  mechs: [{ name: 'Dune', loadout: { torso: '014', chasis: '020', leftHand: '032', rightHand: '033', pilot: 'FPA-63' } }],
  drones: [{ cardId: '079' }],
};
data.solo.squads['t-theirs'] = {
  name: 'Theirs', faction: 'UN', points: 0,
  mechs: [{ name: 'Rifle', loadout: { torso: '539', chasis: '099', rightHand: '541', pilot: 'LPA-23-2' } }],
  drones: [],
};
const scenario = { ...data.solo.scenarios[0], id: 't-commandnext', map: 'none', mission: 'none', seats: { s1: 't-ours', s2: 't-theirs' } };
const t = botTable(M, data, scenario, { seed: 5, policies: { s1: AI.eagerPolicy, s2: AI.eagerPolicy }, glue: M.HUD.glueAfter });
await t.run({ until: (st) => M.SU.normaliseSetup(st.setup)?.stage === 'done' });
const U = Object.fromEntries(t.state.tokens.map((x) => [x.cardId === '079' ? 'Hyena' : x.label, x]));
const at = (x, c, r, f) => { x.col = c * 3; x.row = r * 3; x.facing = f; };
at(U.Hyena, 5, 10, 0); at(U.Dune, 0, 11, 0); at(U.Rifle, 5, 2, 2);
const d = t.drivers.s1.pending();
const view = M.SEAT.viewOf(data, t.state, 's1');
const hyena = view.units.find((u) => u.uid === U.Hyena.uid);
const missile = hyena.weapons.find((x) => x.type === 'Projectile');
const reach = missile ? missile.range + (missile.strike ?? 0) : 0;
check('THE STAGE: the Command Phase asks who is given a Command, and the Hyena\'s Missile is a Command Action out of its reach of the Rifle, a Move from it',
  [d?.kind, missile?.mode, Math.abs(10 - 2) > reach, Math.abs(10 - 5) - 2 <= reach], ['loop.designate.command', 'command', true, true]);
const designate = d.options.find((o) => o.tags.includes('designate') && o.facts?.uid === U.Hyena.uid);
const turn = designate?.then?.();
const near = (r) => r.how === 'move' && Math.abs(r.at.col - 5) + Math.abs(r.at.row - 2) <= reach;
// The engine's half: the turn a Command would open there, its Command Actions alone.
const walk = turn?.options.find((o) => o.tags[0] === 'move' && o.facts?.to && Math.abs(o.facts.to.c - 5) + Math.abs(o.facts.to.r - 2) <= reach);
const later = walk?.later?.(['launch', 'move'], 'command');
check('AS A COMMAND WOULD OPEN IT a round on, from a Grid in reach: the Missile is on offer, and no Move (a Command buys one or the other)',
  [!!walk, later?.options.some((o) => o.tags[0] === 'launch'), later?.options.some((o) => o.tags[0] === 'move')], [true, true, false]);
check('and its Automatic Phase there offers it nothing to launch', (walk?.later?.(['launch']) ?.options ?? []).some((o) => o.tags[0] === 'launch'), false);
{
  const rows = AI.weighed(turn, view, {}, { commandNext: 0 });
  check('WITHOUT IT, no Grid in reach is worth anything a turn on', rows.filter(near).every((r) => r.next === 0), true);
}
{
  const rows = AI.weighed(turn, view, {}, { commandNext: 1 });
  const best = rows.filter((r) => r.priced)[0];
  check('WITH IT a Grid in reach carries what the Command a round on could launch, and the plan walks there',
    [rows.filter(near).some((r) => r.next > 0), best?.how, best ? near(best) : false], [true, 'move', true]);
}
check('as it ships (2026-10-12): on for the Ace and the Veteran, off for the Brawler and the Recruit made of it',
  [AI.TACTICIAN.commandNext, AI.VETERAN_WEIGHTS.commandNext ?? AI.TACTICIAN.commandNext, AI.BRAWLER_WEIGHTS.commandNext], [1, 1, 0]);
t.close();

console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
