// THE PACK (the Tactician's weight `pack`; OTTO, 2026-10-06: "Melee is having a
// hard time under both main AI").
//
// A Mech whose blades outweigh its guns has to walk into the reach of the
// enemy's guns to do anything, and the Ace priced that walk as if it went alone:
// every gun in reach on it. So its blades went in one at a time and were shot
// apart one at a time (RDL_Melee1 and the hybrid melee squads against the
// community's gun squads), or did not go at all. With `pack`, the cost of a Grid
// is shared with each OTHER bladed Mech of the squad that could strike one of
// the same enemies this round: beside it already, or with its turn still to come
// and that enemy within its blade's carry (its Maneuver, its Sprint and its
// blade's reach). Staged on the real engine: two Swift Steed blades and a
// shotgun Mech against a Rifle, the Blade's Melee Opportunity open, the Rifle's
// Firing still to come.
import { botTable, loadEngine } from './_engine.mjs';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}\n       got  ${g}`); }
};

console.log('The pack: blades that go in together share the fire\n');

const { M, data } = await loadEngine('seatpack', ["export * as SEAT from '../src/seat';", "export * as AI from '../src/ai/index';"]);
const AI = M.AI;
const blade = { torso: '012', chasis: '022', leftHand: '062', rightHand: '036', pilot: 'FPA-11' };
data.solo.squads['t-blades'] = {
  name: 'Blades', faction: 'RDL', points: 0,
  mechs: [
    { name: 'Blade', loadout: blade },
    { name: 'Mate', loadout: blade },
    { name: 'Gunner', loadout: { torso: '012', chasis: '249', rightHand: '536', pilot: 'FPA-11' } },
  ],
  drones: [],
};
data.solo.squads['t-rifle'] = {
  name: 'Rifle', faction: 'UN', points: 0,
  mechs: [{ name: 'Rifle', loadout: { torso: '539', chasis: '099', rightHand: '541', pilot: 'LPA-23-2' } }],
  drones: [],
};
const scenario = { ...data.solo.scenarios[0], id: 't-pack', map: 'none', seats: { s1: 't-blades', s2: 't-rifle' } };

// Round 1's Action Phase, `who`'s Melee Opportunity open, the Rifle's Firing to come; the Mate where `mate`
// puts it, done or not.
async function staged(who, mate, mateDone = false) {
  const t = botTable(M, data, scenario, { seed: 3, policies: AI.eagerPolicy });
  await t.run({ until: (st) => M.SU.normaliseSetup(st.setup)?.stage === 'done' && st.round.phase === 2 });
  const s = t.state;
  const U = Object.fromEntries(s.tokens.map((x) => [x.label, x]));
  const at = (x, c, r, f) => { x.col = c * 3; x.row = r * 3; if (f !== undefined) x.facing = f; };
  at(U.Blade, 3, 2, 2); at(U.Gunner, 6, 2, 2); at(U.Mate, mate[0], mate[1], 2); at(U.Rifle, 3, 9, 0);
  for (const x of s.tokens) { x.stance = 'offensive'; x.timing = 'firing'; }
  U[who].timing = 'melee';
  s.script.revealed = ['s1', 's2'];
  s.script.acted = s.tokens.filter((x) => x.side === 's1' && x.uid !== U[who].uid && (x.label !== 'Mate' || mateDone)).map((x) => x.uid);
  s.script.opp = null;
  M.G.opportunity(data, s);
  const d = t.drivers.s1.pending();
  return { t, U, d, view: M.SEAT.viewOf(data, s, 's1') };
}
// The cost of the furthest move toward the Rifle, as each weight would price it.
function costs(d, view, me) {
  const moves = d.options.filter((o) => o.tags[0] === 'move' && o.facts?.to);
  const toward = moves.reduce((a, b) => (b.facts.to.r > a.facts.to.r ? b : a), moves[0]);
  const cost = (pack, packNear = 0) => AI.exposureAt(d, view, toward.id, Infinity, {}, { pack, packNear }).cost;
  return { to: toward.facts.to, off: cost(0), on: cost(1), near: cost(0, 1), me };
}
const near = (a, b) => Math.abs(a - b) < 1e-9;

{
  const { t, d, view } = await staged('Blade', [4, 2]);
  const c = costs(d, view);
  check('THE BLADE\'S WALK TOWARD THE RIFLE costs something (the Rifle\'s turn still to come, its Single Shot reaching)', c.off > 0.1, true);
  check('WITH THE MATE STILL TO ACT and the Rifle within its blade\'s carry, `pack` 1 halves it: two blades share the fire', near(c.on, c.off / 2), true);
  t.close();
}
{
  const { t, d, view } = await staged('Blade', [11, 0]);
  const c = costs(d, view);
  check('WITH THE MATE TOO FAR to strike the Rifle this round, the Blade pays alone, `pack` or not', [c.off > 0.1, near(c.on, c.off)], [true, true]);
  t.close();
}
{
  const { t, d, view } = await staged('Blade', [4, 2], true);
  const c = costs(d, view);
  check('A MATE WHOSE TURN IS BEHIND IT, out of reach, shares nothing', near(c.on, c.off), true);
  t.close();
}
{
  const { t, d, view } = await staged('Blade', [3, 8], true);
  const c = costs(d, view);
  check('a Mate whose turn is behind it but which stands beside the Rifle shares the fire', near(c.on, c.off / 2), true);
  t.close();
}
{
  const { t, d, view } = await staged('Gunner', [4, 2]);
  const c = costs(d, view);
  check('A MECH WHOSE GUNS OUTWEIGH ITS BLADES pays alone whoever is beside it: its walk is priced the same with `pack` as without', [c.off > 0.1, near(c.on, c.off)], [true, true]);
  t.close();
}
// THE PACK ALREADY IN (`packNear`): only the blades standing beside the enemy already share, whatever their turn.
// The first blade in pays alone; those that follow it in share (game 130102: two blades that could have struck
// spent their turns on the Terminals, and the one that went in on the strength of them was lost).
{
  const { t, d, view } = await staged('Blade', [4, 2]);
  const c = costs(d, view);
  check('`packNear`: A MATE STILL TO ACT that could reach the Rifle but stands off shares nothing', near(c.near, c.off), true);
  t.close();
}
{
  const { t, d, view } = await staged('Blade', [3, 8], true);
  const c = costs(d, view);
  check('`packNear`: a Mate standing beside the Rifle already shares the fire', near(c.near, c.off / 2), true);
  t.close();
}
check('the weights ship at 0 until they are measured', [AI.TACTICIAN.pack, AI.TACTICIAN.packNear], [0, 0]);

console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
