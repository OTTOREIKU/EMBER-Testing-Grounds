// THE SHOTS LEFT AND THE BAIT (`ammoCount`, `bait`; M24, 2026-10-13). OTTO: "Does the computer track how much ammo an
// enemy has? So if it's against a missile squad one team might try to get the enemies to waste all of their missiles
// and then when they are out deal with them in some way"; "baiting may be a behavior that covers multiple projectiles
// or other deployables so we can first test with missiles but keep it open to expand for other areas".
//   `ammoCount`: a launcher's threat (`launchThreat`) for as many rounds as it has Projectiles left.
//   `bait`: a unit worth less than the squad's best gains, where it stands in the strike of an enemy whose counted
//   Projectiles run out before the game does, what the shot it draws would have done to the rest of the squad.
//
// Staged on the real engine, on an empty board, in round 1 of 5: (A) UN's Rifle with its Opportunity open, an RDL
// Hyena Missile Type (four Missiles, or one) and a Tarantula Firepower Type in its sights; (B) the Command Phase, UN's
// Rifle and a Raven Interference Type against RDL's Salvo (an ML-94 rack with two Kestrels left, or six).
import { botTable, loadEngine } from './_engine.mjs';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}\n       got  ${g}`); }
};

console.log('The shots left and the bait\n');

const { M, data } = await loadEngine('seatbait', ["export * as SEAT from '../src/seat';", "export * as AI from '../src/ai/index';"]);
const AI = M.AI;
const at = (x, c, r, f) => { x.col = c * 3; x.row = r * 3; if (f !== undefined) x.facing = f; };
const RIFLE = { name: 'Rifle', loadout: { torso: '539', chasis: '099', rightHand: '541', pilot: 'LPA-23-2' } };
data.solo.squads['t-rifle'] = { name: 'Rifle', faction: 'UN', points: 0, mechs: [RIFLE], drones: [] };
data.solo.squads['t-hyena'] = {
  name: 'Hyena', faction: 'RDL', points: 0,
  mechs: [{ name: 'Dune', loadout: { torso: '014', chasis: '020', leftHand: '032', rightHand: '033', pilot: 'FPA-63' } }],
  drones: [{ cardId: '079' }, { cardId: '163' }],
};
data.solo.squads['t-raven'] = { name: 'Raven', faction: 'UN', points: 0, mechs: [RIFLE], drones: [{ cardId: '166' }] };
data.solo.squads['t-salvo'] = {
  name: 'Salvo', faction: 'RDL', points: 0,
  mechs: [{ name: 'Salvo', loadout: { torso: '014', chasis: '020', rightHand: '033', backpack: '501', pilot: 'FPA-14' } }],
  drones: [],
};

// (A) The Rifle's shot at the Hyena, its Missiles as dealt (four) or down to one.
async function hyenaShot(left, skills) {
  const scenario = { ...data.solo.scenarios[0], id: 't-ammo', map: 'none', mission: 'none', seats: { s1: 't-rifle', s2: 't-hyena' } };
  const t = botTable(M, data, scenario, { seed: 5, policies: AI.eagerPolicy });
  await t.run({ until: (st) => M.SU.normaliseSetup(st.setup)?.stage === 'done' && st.round.phase === 2 });
  const s = t.state;
  const U = {};
  for (const x of s.tokens) U[x.cardId === '079' ? 'Hyena' : x.cardId === '163' ? 'Tarantula' : x.label] = x;
  at(U.Rifle, 4, 9, 0); at(U.Hyena, 3, 5, 2); at(U.Tarantula, 5, 5, 2); at(U.Dune, 0, 0, 2);
  if (left !== undefined) U.Hyena.ammo = { ...U.Hyena.ammo, '079_A': left };
  for (const x of s.tokens) { x.stance = 'offensive'; x.timing = 'firing'; }
  s.script.revealed = ['s1', 's2'];
  s.script.acted = s.tokens.filter((x) => x.kind === 'mech' && x.side === 's2').map((x) => x.uid);
  s.script.opp = null;
  M.G.opportunity(data, s);
  const d = t.drivers.s1.pending();
  const view = M.SEAT.viewOf(data, s, 's1');
  const stay = AI.weighed(d, view, skills, { launchThreat: 1 }).find((r) => r.how === 'stay');
  const ammo = view.units.find((u) => u.uid === U.Hyena.uid).weapons.find((w) => w.type === 'Projectile')?.ammo;
  t.close();
  return { ammo, does: String(stay?.does ?? ''), now: Math.round((stay?.now ?? 0) * 100) / 100 };
}
{
  const full = await hyenaShot(undefined, {});
  const fullCounted = await hyenaShot(undefined, { ammoCount: true });
  const last = await hyenaShot(1, {});
  const lastCounted = await hyenaShot(1, { ammoCount: true });
  check('(A) THE STAGE: the Hyena carries four Missiles as dealt, and the Rifle\'s best shot is at it',
    [full.ammo, full.does.includes('Hyena'), last.ammo], [4, true, 1]);
  check('WITHOUT `ammoCount` the Hyena down to its last Missile is worth shooting as much as with four',
    last.now === full.now, true);
  check('WITH IT a Hyena with four is worth the same, one with its last Missile less (one round of threat, not two)',
    [fullCounted.now === full.now, lastCounted.now < last.now], [true, true]);
}

// (B) The Raven, sent a Command, against the Salvo's rack.
async function ravenPlans(kestrels, bait, who = 'Drone') {
  const scenario = { ...data.solo.scenarios[0], id: 't-bait', map: 'none', mission: 'none', seats: { s1: 't-raven', s2: 't-salvo' } };
  const t = botTable(M, data, scenario, { seed: 5, policies: { s1: AI.eagerPolicy, s2: AI.eagerPolicy } });
  await t.run({ until: (st) => M.SU.normaliseSetup(st.setup)?.stage === 'done' });
  const s = t.state;
  const U = {};
  for (const x of s.tokens) U[x.kind === 'drone' ? 'Drone' : x.label] = x;
  at(U.Rifle, 2, 12, 0); at(U.Drone, 6, 10, 0); at(U.Salvo, 6, 2, 2);
  U.Salvo.ammo = { ...U.Salvo.ammo, '501_A': kestrels };
  const d = t.drivers.s1.pending();
  const view = M.SEAT.viewOf(data, s, 's1');
  let turn;
  if (who === 'Drone') turn = d.options.find((o) => o.tags.includes('designate') && o.facts?.uid === U.Drone.uid)?.then?.();
  const rows = turn ? AI.weighed(turn, view, {}, { bait }).filter((r) => r.priced) : [];
  t.close();
  return { kind: d?.kind, rows };
}
const worthAt = (rows) => new Map(rows.map((r) => [`${r.how}|${r.at.col},${r.at.row}`, r.worth]));
{
  const off = await ravenPlans(2, 0);
  const on = await ravenPlans(2, 1);
  const a = worthAt(off.rows), b = worthAt(on.rows);
  const gains = [...b.keys()].filter((k) => a.has(k)).map((k) => b.get(k) - a.get(k));
  check('(B) THE STAGE: the Command Phase; the Raven\'s plans with a Command are priced',
    [off.kind, off.rows.length > 0, gains.length > 0], ['loop.designate.command', true, true]);
  check('WITH `bait` the Raven\'s Grids in the strike of the Salvo\'s last two Kestrels are worth more',
    gains.some((g) => g > 0.1), true);
  const plenty = worthAt((await ravenPlans(6, 0)).rows), plentyOn = worthAt((await ravenPlans(6, 1)).rows);
  check('and nothing where the rack has more Kestrels than the game has rounds left (six, five rounds)',
    [...plentyOn.keys()].filter((k) => plenty.has(k)).every((k) => Math.abs(plentyOn.get(k) - plenty.get(k)) < 1e-9), true);
}
check('as it ships (2026-10-13): both off until measured', [AI.SKILLS.ammoCount, AI.TACTICIAN.bait], [false, 0]);

console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
