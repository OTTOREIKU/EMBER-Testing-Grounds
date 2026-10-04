// A MANEUVER FLOWN BY CHOICE, offered to a seat (AI-OPPONENT-PLAN.md, M12: the
// seam's to-do list, "the optional flight an Ojs200 lends its Maneuver").
//
// The Ojs200 Mobility Enhancement System (PDBP-201): "This mech's Maneuver may
// be considered as Flying." The Match Centre's move panel offers the switch
// (matchhud.ts `flytoggle`, on turn.ts moveStart `flightOptional`); a computer
// seat was offered the walked Maneuver alone. Now the seam offers the same
// Maneuver flown as answers of their own, tagged `fly`, each sending what the
// panel sends flown (`flying: true`), each judged by the engine.
import { botTable, loadEngine } from './_engine.mjs';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}\n       got  ${g}`); }
};

console.log('A Maneuver flown by choice\n');

const { M, data } = await loadEngine('seatfly', ["export * as SEAT from '../src/seat';", "export * as AI from '../src/ai/index';", "export * as HUD from '../src/matchhud';", "export * as TURN from '../src/turn';"]);
const AI = M.AI;
const pd = (name, backpack) => ({ name, loadout: { torso: '547', chasis: '548', leftHand: 'PDLH-202', rightHand: 'PDRH-202', ...(backpack ? { backpack } : {}), pilot: 'XPA-59' } });
data.solo.squads['f-flyers'] = { name: 'Flyers', faction: 'PD', points: 0, mechs: [pd('Kite', 'PDBP-201'), pd('Rock')], drones: [] };
data.solo.squads['f-foes'] = { name: 'Foes', faction: 'PD', points: 0, mechs: [pd('Far')], drones: [] };
// The copied Alley (its terrain), the flyers' Opportunity in round 1's Action Phase.
const scenario = { ...data.solo.scenarios[0], id: 't-fly', seats: { s1: 'f-flyers', s2: 'f-foes' } };
const table = async (who) => {
  const t = botTable(M, data, scenario, { seed: 4, policies: { s1: AI.tacticianPolicy, s2: AI.tacticianPolicy }, glue: M.HUD.glueAfter });
  await t.run({ until: (st) => M.SU.normaliseSetup(st.setup)?.stage === 'done' && st.round.phase === 2 });
  const U = Object.fromEntries(t.state.tokens.map((x) => [x.label, x]));
  const at = (x, c, r, f) => { x.col = c * 3; x.row = r * 3; if (f !== undefined) x.facing = f; };
  // The Kite (or the Rock) in the open at C7, Melee Locked by the foe beside
  // it at C6: walking out of the Lock costs a Break Away its one-Grid Maneuver
  // cannot pay; a Flying Movement ignores the Lock (4.3.5).
  const other = who === 'Kite' ? 'Rock' : 'Kite';
  at(U[who], 2, 6, 0); at(U[other], 9, 9, 0); at(U.Far, 2, 5, 2);
  const s = t.state;
  for (const x of s.tokens) if (x.kind === 'mech') x.timing = 'movement';
  s.script.revealed = ['s1', 's2'];
  s.script.acted = s.tokens.filter((x) => x.kind === 'mech' && x.uid !== U[who].uid).map((x) => x.uid);
  s.script.opp = null;
  M.G.opportunity(data, s);
  return { t, s, U, d: t.drivers.s1.pending() };
};

{
  const { t, s, U, d } = await table('Kite');
  const fly = d.options.filter((o) => o.tags.includes('fly'));
  const walk = d.options.filter((o) => o.tags[0] === 'move' && o.tags.includes('maneuver') && !o.tags.includes('fly') && !o.tags.includes('pivot'));
  const last = (o) => [...(o.commands ?? [])].reverse().find((x) => x.kind === 'maneuver');
  const grids = (list) => [...new Set(list.map((o) => `${o.facts?.to?.c},${o.facts?.to?.r}`))].sort();
  const start = M.TURN.moveStart(data, s, U.Kite, { maneuver: true });
  check('THE KITE, WITH ITS OJS200, IS OFFERED ITS MANEUVER FLOWN: answers of their own, each sending the Maneuver flown, and no turn on the spot twice',
    [d?.kind, start.flightOptional, fly.length > 0, fly.every((o) => o.id.startsWith('move:maneuver-fly:') && o.label.includes('Maneuver, flying') && last(o)?.flying === true), fly.some((o) => o.tags.includes('pivot'))],
    ['opp.act', true, true, true, false]);
  check('and the engine takes every one of them as it stands', fly.every((o) => (o.commands ?? []).every((c) => M.C.check(data, s, c).ok)), true);
  const asEngine = (flying) => M.TURN.reachableFor(data, s, U.Kite, start.steps, flying).map((g) => `${g.c},${g.r}`).sort();
  check('MELEE LOCKED, IT CANNOT WALK OUT AND CAN FLY OUT: the flown answers reach the Grids the engine flies it to, the walked ones none',
    [grids(walk), grids(fly).length > 0, JSON.stringify(grids(fly)) === JSON.stringify(asEngine(true)), asEngine(false)], [[], true, true, []]);
  // The Tactician weighs the flown answers among the rest.
  const rows = AI.weighed(d, M.SEAT.viewOf(data, s, 's1'));
  check('the Tactician weighs them among its plans', rows.some((p) => p.label.includes('Maneuver, flying')), true);
  t.close();
}
{
  const { t, d } = await table('Rock');
  check('THE ROCK, WITH NO OJS200, IS OFFERED NOTHING FLOWN', [d?.kind, d.options.some((o) => o.tags.includes('fly'))], ['opp.act', false]);
  t.close();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
