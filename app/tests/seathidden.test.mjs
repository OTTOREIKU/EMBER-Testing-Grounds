// HIDDEN, AS AN ASSET (2026-10-08; OTTO: "put in some usage settings for a camo team"): the Tactician's weight
// `hiddenWorth`, and the seat's view of a unit owing its Reveal (`revealing`).
//
// A unit in Optical Camouflage must be Scanned before it can be attacked for as long as it stays hidden. What standing
// somewhere costs prices this round only, so a camouflaged Mech spent its camouflage cheaply (the camo census: UN-2's
// Octopus Revealed itself in round 1 for a small Remote Access) and put it back on as if it were worth little. With
// `hiddenWorth` a plan that gives the camouflage up pays for each round after this one, and the Activation that puts it
// back on earns as much.
//
// Staged on the real engine: UN-2's Octopus (the TM641 Octopus Stealth Core, the LM210S Stealth Chassis, the R6SD
// SMG, the Firefly) against an RDL gunner two Grids south of it. Its Maneuvers and its Silent Burst Fire keep it
// hidden; a Maneuver that ends in Contact with the gunner owes its Reveal (4.12.2).
import { botTable, loadEngine } from './_engine.mjs';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}\n       got  ${g}`); }
};

console.log('Hidden, as an asset\n');

const { M, data } = await loadEngine('seathidden', ["export * as SEAT from '../src/seat';", "export * as AI from '../src/ai/index';", "export * as HUD from '../src/matchhud';"]);
const AI = M.AI;
data.solo.squads['t-camo'] = { name: 'Camo', faction: 'UN', points: 0, mechs: [
  { name: 'Octopus', loadout: { torso: '096', chasis: '100', leftHand: '103', rightHand: '124', backpack: '083', pilot: 'LPA-21' } }], drones: [] };
data.solo.squads['t-hunters'] = { name: 'Hunters', faction: 'RDL', points: 0, mechs: [
  { name: 'Dune', loadout: { torso: '533', chasis: '534', leftHand: '535', rightHand: '536', backpack: '004', pilot: 'FPA-04-2' } }], drones: [] };
const scenario = { ...data.solo.scenarios[0], id: 't-hidden', map: 'none', mission: 'none', seats: { s1: 't-camo', s2: 't-hunters' } };

// The Planning Phase of round 1 (or `round`), the Octopus at 4,4 hidden (or seen), the gunner at 4,6.
async function staged({ hidden = true, round = 1 } = {}) {
  const t = botTable(M, data, scenario, { seed: 5, policies: { s1: AI.eagerPolicy, s2: AI.eagerPolicy }, glue: M.HUD.glueAfter });
  await t.run({ until: (st) => M.SU.normaliseSetup(st.setup)?.stage === 'done' && st.round.phase === 1 });
  const U = Object.fromEntries(t.state.tokens.map((x) => [x.label, x]));
  const at = (x, c, r, f) => { x.col = c * 3; x.row = r * 3; x.facing = f; };
  at(U.Octopus, 4, 4, 2); at(U.Dune, 4, 6, 0);
  U.Octopus.statuses = [...(U.Octopus.statuses ?? []).filter((s) => s !== 'camouflage'), ...(hidden ? ['camouflage'] : [])];
  t.state.round.n = round;
  const d = t.drivers.s1.pending();
  const view = M.SEAT.viewOf(data, t.state, 's1');
  const turnOn = (timing) => d.options.find((o) => o.tags.includes(`timing:${timing}`))?.then?.();
  return { t, U, d, view, turnOn };
}
const leaves = (o, uid) => {
  const left = o.after?.() ?? o.then?.(['end'])?.here?.();
  const u = left?.view().units.find((x) => x.uid === uid);
  return u ? { camouflaged: u.camouflaged, revealing: u.revealing } : null;
};
// Each priced plan's worth with `hiddenWorth` 1 less its worth at 0, by label.
const moved = (turn, view) => {
  const at0 = AI.weighed(turn, view, {}, { hiddenWorth: 0 }).filter((r) => r.priced);
  const at1 = AI.weighed(turn, view, {}, { hiddenWorth: 1 }).filter((r) => r.priced);
  return at1.map((r) => { const o = at0.find((x) => x.label === r.label && x.how === r.how); return o ? { label: r.label, d: Math.round((r.worth - o.worth) * 1e6) / 1e6 } : null; }).filter(Boolean);
};

{
  const { t, U, d, view, turnOn } = await staged();
  const me = view.units.find((u) => u.uid === U.Octopus.uid);
  check('THE VIEW: the Octopus asked its dial, in Optical Camouflage and owing no Reveal',
    [d.unit === U.Octopus.uid, me.camouflaged, me.revealing], [true, true, false]);
  const melee = turnOn('melee');
  const contact = melee.options.find((o) => o.tags[0] === 'move' && /to E6/.test(o.label));
  const quiet = melee.options.find((o) => o.tags[0] === 'move' && /to E4/.test(o.label));
  check('a Maneuver ending in Contact with the gunner leaves it camouflaged and owing its Reveal; a Silent one leaves it hidden',
    [leaves(contact, U.Octopus.uid), leaves(quiet, U.Octopus.uid)], [{ camouflaged: true, revealing: true }, { camouflaged: true, revealing: false }]);
  const firing = turnOn('firing');
  const burst = firing.options.find((o) => o.tags[0] === 'attack' && /Silent Burst Fire/.test(o.label));
  check('and its Silent Burst Fire at the gunner keeps it hidden', leaves(burst, U.Octopus.uid), { camouflaged: true, revealing: false });
  const m = moved(melee, view);
  const e6 = m.filter((x) => /to E6/.test(x.label)).map((x) => x.d);
  const rest = m.filter((x) => !/to E6/.test(x.label)).map((x) => x.d);
  check('THE COST: in round 1, the plan that gives the camouflage up pays 4 (four rounds after this one); every plan that keeps it, nothing',
    [e6.length > 0, e6.every((x) => x === -4), rest.length > 0, rest.every((x) => x === 0)], [true, true, true, true]);
  t.close();
}
{
  const { t, view, turnOn } = await staged({ hidden: false });
  const m = moved(turnOn('tactical'), view);
  const cloak = m.filter((x) => /Optical Camouflage/.test(x.label)).map((x) => x.d);
  check('THE GAIN: the Octopus seen, its Optical Camouflage earns 4 in round 1; nothing else it could do moves',
    [cloak, m.filter((x) => !/Optical Camouflage/.test(x.label)).every((x) => x.d === 0)], [[4], true]);
  t.close();
}
{
  const { t, view, turnOn } = await staged({ round: 5 });
  const m = moved(turnOn('melee'), view);
  check('THE LAST ROUND: no round after it for the camouflage to pay for, so nothing moves', m.every((x) => x.d === 0) && m.length > 0, true);
  t.close();
}
check('the weight ships at 0', AI.TACTICIAN.hiddenWorth, 0);

console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
