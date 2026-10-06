// AN OUTRANGED BLADE GOES IN (the Tactician's weight `bladeIn`; the melee plan, 2026-10-06).
//
// Game 130207: four Swift Steed blades walked to the Terminal zone and stood
// there to be shot by Rail Guns seven Grids off; all three counted were
// destroyed without one Melee attack. `closeIn` and `press` count the step
// toward contact only for a unit with no zone to walk to, and a blade's only
// harm is in contact. With `bladeIn`, a Mech whose blades outweigh its guns,
// while an enemy that can reach it outranges it, pays `bladeIn` for each Grid of
// the road to the enemy it walks to beyond its blades' reach. Staged on the real
// engine: a Swift Steed blade's Movement Opportunity open, a Rifle seven Grids off.
import { botTable, loadEngine } from './_engine.mjs';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}\n       got  ${g}`); }
};

console.log('An outranged blade goes in\n');

const { M, data } = await loadEngine('seatbladein', ["export * as SEAT from '../src/seat';", "export * as AI from '../src/ai/index';"]);
const AI = M.AI;
const blade = { torso: '012', chasis: '022', leftHand: '062', rightHand: '036', pilot: 'FPA-11' };
const gunner = { torso: '012', chasis: '022', rightHand: '536', leftHand: '541', pilot: 'FPA-11' };
data.solo.squads['t-blade'] = { name: 'Blade', faction: 'RDL', points: 0, mechs: [{ name: 'Blade', loadout: blade }], drones: [] };
data.solo.squads['t-gunner'] = { name: 'Gunner', faction: 'RDL', points: 0, mechs: [{ name: 'Blade', loadout: gunner }], drones: [] };
data.solo.squads['t-rifle'] = {
  name: 'Rifle', faction: 'UN', points: 0,
  mechs: [{ name: 'Rifle', loadout: { torso: '539', chasis: '099', rightHand: '541', pilot: 'LPA-23-2' } }],
  drones: [],
};
data.solo.squads['t-sword'] = { name: 'Sword', faction: 'UN', points: 0, mechs: [{ name: 'Rifle', loadout: { torso: '539', chasis: '099', rightHand: '036', pilot: 'LPA-23-2' } }], drones: [] };

// Round 1's Action Phase, the subject's Movement Opportunity open, the enemy's Firing behind it.
async function staged(mine, foe) {
  const scenario = { ...data.solo.scenarios[0], id: `t-bladein-${mine}-${foe}`, map: 'none', seats: { s1: mine, s2: foe } };
  const t = botTable(M, data, scenario, { seed: 5, policies: AI.eagerPolicy });
  await t.run({ until: (st) => M.SU.normaliseSetup(st.setup)?.stage === 'done' && st.round.phase === 2 });
  const s = t.state;
  const U = Object.fromEntries(s.tokens.map((x) => [x.label, x]));
  const at = (x, c, r, f) => { x.col = c * 3; x.row = r * 3; if (f !== undefined) x.facing = f; };
  at(U.Blade, 4, 1, 2); at(U.Rifle, 4, 8, 0);
  for (const x of s.tokens) { x.stance = 'offensive'; x.timing = 'firing'; }
  U.Blade.timing = 'movement';
  s.script.revealed = ['s1', 's2'];
  s.script.acted = [U.Rifle.uid];
  s.script.opp = null;
  M.G.opportunity(data, s);
  return { t, U, d: t.drivers.s1.pending(), view: M.SEAT.viewOf(data, s, 's1') };
}
// Each Grid's plan as each weight would read it: the best `shape` of the plans ending there.
function shapes(d, view, bladeIn) {
  const out = new Map();
  for (const p of AI.weighed(d, view, {}, { bladeIn })) {
    const k = `${p.at.col},${p.at.row}`;
    out.set(k, Math.max(out.get(k) ?? -Infinity, p.shape));
  }
  return out;
}
const gains = (d, view) => {
  const off = shapes(d, view, 0), on = shapes(d, view, 1);
  return [...on.keys()].filter((k) => off.has(k)).map((k) => ({ k, row: Number(k.split(',')[1]), gain: on.get(k) - off.get(k) }));
};

{
  const { t, d, view } = await staged('t-blade', 't-rifle');
  const g = gains(d, view);
  const stay = g.find((x) => x.k === '4,1');
  const nearest = g.reduce((a, b) => (b.row > a.row ? b : a));
  check('A BLADE OUTRANGED BY THE RIFLE: each Grid pays a Grid\'s worth for each Grid of the road it leaves to walk, so the Grid nearest the Rifle loses least',
    [d?.kind, !!stay, stay && stay.gain < -1, nearest.row > 1 && nearest.gain > stay.gain + 1], ['opp.act', true, true, true]);
  check('and the further down the road, the less each Grid pays (each Grid nearer pays no more than one further off)',
    g.every((a) => g.every((b) => !(a.row > b.row && a.k.split(',')[0] === b.k.split(',')[0]) || a.gain >= b.gain - 1e-9)), true);
  t.close();
}
{
  const { t, d, view } = await staged('t-gunner', 't-rifle');
  check('A GUNNER in the same Grid (a Rifle in its hand) pays nothing more', gains(d, view).every((x) => Math.abs(x.gain) < 1e-9), true);
  t.close();
}
{
  const { t, d, view } = await staged('t-blade', 't-sword');
  check('NOR A BLADE NOBODY OUTRANGES (the enemy carries a blade alone)', gains(d, view).every((x) => Math.abs(x.gain) < 1e-9), true);
  t.close();
}
check('the weight ships at 0 until it is measured', AI.TACTICIAN.bladeIn, 0);

console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
