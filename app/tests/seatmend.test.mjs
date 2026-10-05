// A DRONE LAUNCHED TO MEND AN ALLY (AI-OPPONENT-PLAN.md, the Log of
// 2026-10-04 night; the weight `patch`). The DLSP-1 Nest Guardian Swarm Control
// Pack (ZYBP-101) launches the SU1 "Nest Guardian Swarm" (ZYDR-108), a Low
// Value Drone whose one Action, Armor Patch, takes a Damaged Token off an Ally
// Unit in Range 2 and then removes the Drone. It is a Command Action (3.2.2):
// the SU1 mends nobody as it lands, and does it in a Command Phase to come,
// given a Command. A census of 21 random games with one aboard found it never
// launched: a launch was worth what the Projectile's own turn would do to an
// enemy, and this one's does nothing to anybody. Staged here: what the seam
// tells a look ahead, what the Tactician makes of it with the weight and
// without, and the whole of it played on, launch to mend.
import { botTable, loadEngine } from './_engine.mjs';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}\n       got  ${g}`); }
};

console.log('A Drone launched to mend an ally\n');

const { M, data } = await loadEngine('seatmend', ["export * as SEAT from '../src/seat';", "export * as AI from '../src/ai/index';", "export * as HUD from '../src/matchhud';"]);
const { owed, newMind } = M.SEAT;
const AI = M.AI;

// GOF: a Tracer that carries the Swarm Control Pack, and a White Dwarf beside
// it to be mended. UN: a Viper and a Bison, far off.
data.solo.squads['t-nest'] = {
  name: 'Nest', faction: 'GOF', points: 0,
  mechs: [
    { name: 'Nest', loadout: { torso: '174', chasis: '179', leftHand: 'ZHLA-101', backpack: 'ZYBP-101', pilot: 'ZPA-43' } },
    { name: 'Dwarf', loadout: { torso: '287', chasis: '289', leftHand: '291', rightHand: '290', backpack: '292', pilot: 'ACE-01' } },
  ],
  drones: [],
};
data.solo.squads['t-far'] = {
  name: 'Far', faction: 'UN', points: 0,
  mechs: [
    { name: 'Viper', loadout: { torso: '094', chasis: '099', leftHand: '129', rightHand: '541', backpack: '086', pilot: 'LPA-23-2' } },
    { name: 'Bison', loadout: { torso: '098', chasis: '099', leftHand: '540', rightHand: '541', backpack: '538', pilot: 'LPA-23-2' } },
  ],
  drones: [],
};
const SCENARIO = { ...data.solo.scenarios[0], id: 't-mend', map: 'none', seats: { s1: 't-nest', s2: 't-far' } };
const SU1 = 'ZYDR-108';
const viewOf = (state, seat) => M.SEAT.viewOf(data, state, seat);
const gridOf = (t) => [Math.floor(t.col / 3), Math.floor(t.row / 3)];
const near = (o, t, reach) => { const [c, r] = gridOf(t); return Math.abs(c - o.facts.to.c) + Math.abs(r - o.facts.to.r) <= reach; };

// A table set up and then rearranged: the Nest's Opportunity of the round
// named, on its Projectile Timing, every other Mech done; the Dwarf's Chassis
// Damaged unless `whole`.
const staged = async ({ round = 1, whole = false, dwarfAt = [4, 1], policies = AI.eagerPolicy } = {}) => {
  const t = botTable(M, data, SCENARIO, { seed: 5, policies, glue: M.HUD.glueAfter });
  await t.run({ until: (st) => M.SU.normaliseSetup(st.setup)?.stage === 'done' });
  const s = t.state;
  const U = Object.fromEntries(s.tokens.map((x) => [x.label, x]));
  const at = (x, c, r, f) => { x.col = c * 3; x.row = r * 3; if (f !== undefined) x.facing = f; };
  at(U.Nest, 1, 1, 2); at(U.Dwarf, dwarfAt[0], dwarfAt[1], 2); at(U.Viper, 11, 11, 0); at(U.Bison, 10, 11, 0);
  if (!whole) U.Dwarf.partStates = { ...U.Dwarf.partStates, chasis: 'damaged' };
  const sc = s.script;
  s.round.n = round;
  s.round.phase = 2; sc.stage = `${round}:2`; sc.passed = []; sc.revealed = ['s1', 's2'];
  for (const x of s.tokens) if (x.kind === 'mech') x.timing = 'firing';
  U.Nest.timing = 'projectile';
  sc.acted = s.tokens.filter((x) => x.kind === 'mech' && x.uid !== U.Nest.uid).map((x) => x.uid);
  sc.opp = null;
  M.G.opportunity(data, s);
  const d = t.drivers.s1.pending();
  return { t, s, U, d };
};

// ---------- the seam ----------
{
  const { t, s, U, d } = await staged();
  M.L.setLocalSeat('s1');
  const all = d.options.filter((o) => o.tags[0] === 'launch' && o.facts.cardId === SU1);
  const ahead = owed(data, s, 's1', newMind(), { only: ['launch'] }).options.filter((o) => o.tags[0] === 'launch' && o.facts.cardId === SU1);
  check('THE SWARM IS OFFERED at every Landing Point in Range 8, each saying how far from it the SU1 could mend an ally at its next Command: Armor Patch\'s Range of 2 (a Command buys a Movement or the Action, 3.2.2)',
    [all.length > 40, all.every((o) => o.facts.mends === 2 && o.facts.strike === 2)], [true, true]);
  check('A LOOK AHEAD is given the Landing Points within that reach of an ally with a Damaged Part (none is within reach of an enemy), word for word as the whole question has them',
    [ahead.length > 0, ahead.length < all.length, ahead.every((o) => near(o, U.Dwarf, 2)), JSON.stringify(ahead.map((o) => o.id)) === JSON.stringify(all.filter((o) => near(o, U.Dwarf, 2)).map((o) => o.id))],
    [true, true, true, true]);
  M.L.setLocalSeat(null);
  t.close();
  const whole = await staged({ whole: true });
  M.L.setLocalSeat('s1');
  check('with nobody Damaged and no enemy in reach, a look ahead is given none of them',
    owed(data, whole.s, 's1', newMind(), { only: ['launch'] })?.options.filter((o) => o.facts?.cardId === SU1).length ?? 0, 0);
  M.L.setLocalSeat(null);
  whole.t.close();
}

// ---------- the Tactician ----------
{
  const { t, s, U, d } = await staged();
  const mends = (w) => AI.weighed(d, viewOf(s, 's1'), { focus: false }, w).filter((p) => /to mend Dwarf a round on/.test(p.does ?? ''));
  const on = mends({ patch: 1 });
  const dented = AI.gainOf({ hit: 1, pen: 1, damage: 1, destroy: 0, kill: 0, link: 0, parts: [], pick: null }, viewOf(s, 's1').units.find((u) => u.uid === U.Dwarf.uid), viewOf(s, 's1'), AI.TACTICIAN);
  check('WITH `patch` AT 0 NO PLAN LAUNCHES IT; at 1 one does, and its deed is worth the mend a round on: what Damaging the Chassis is worth, at `future`',
    [mends({ patch: 0 }).length, on.length > 0, on.length ? Math.abs(Math.max(...on.map((p) => p.now)) - AI.TACTICIAN.future * dented) < 1e-9 : null], [0, true, true]);
  const pick = (w) => { const c = AI.makeTactician({ focus: false }, w).choose(d, viewOf(s, 's1'), new AI.Rng('pick')); return { ...c, o: d.options.find((o) => o.id === c.option) }; };
  const off = pick({ patch: 0 });
  const taken = pick({ patch: 1 });
  check('and the choice: at 0 the Tracer does not launch it; at 1 it launches it, of the Landing Points in reach of the Dwarf to the one nearest it, and says why',
    [off.o.tags[0] === 'launch', taken.o.tags[0], taken.reason, near(taken.o, U.Dwarf, 1), /to mend Dwarf a round on/.test(taken.why)], [false, 'launch', 'patch_value', true, true]);
  t.close();
  const last = await staged({ round: 5 });
  check('in the last round, which has no Command Phase after it, the launch is worth nothing',
    AI.weighed(last.d, viewOf(last.s, 's1'), { focus: false }, { patch: 1 }).filter((p) => /to mend Dwarf a round on/.test(p.does ?? '')).length, 0);
  last.t.close();
  const whole = await staged({ whole: true });
  check('and with nobody Damaged, nothing',
    AI.weighed(whole.d, viewOf(whole.s, 's1'), { focus: false }, { patch: 1 }).filter((p) => /to mend Dwarf a round on/.test(p.does ?? '')).length, 0);
  whole.t.close();
}

// ---------- played on ----------
{
  const policies = { s1: AI.makeTactician({}, { patch: 1 }), s2: AI.tacticianPolicy };
  const { t, s, U } = await staged({ policies });
  const sent = [];
  t.watch((cmd) => { if (['launch', 'designate', 'repairPart'].includes(cmd.kind)) sent.push({ kind: cmd.kind, round: s.round.n, cardId: cmd.cardId, targetUid: cmd.targetUid, slot: cmd.slot }); });
  await t.run({ until: (st) => st.round.n >= 2 && st.round.phase >= 2, maxSteps: t.steps() + 400 });
  const launched = sent.find((x) => x.kind === 'launch' && x.cardId === SU1);
  const mended = sent.find((x) => x.kind === 'repairPart');
  check('PLAYED ON, the Tracer launches one SU1 in round 1 (its Volley could put down two, and there is one Part to mend), and in the Command Phase of round 2 the SU1 is given a Command and takes the Damaged Token off the Dwarf\'s Chassis, then leaves the board',
    [sent.filter((x) => x.kind === 'launch' && x.cardId === SU1).length, launched?.round, mended?.round, mended?.targetUid === U.Dwarf.uid, mended?.slot, U.Dwarf.partStates.chasis, s.tokens.some((x) => x.cardId === SU1), t.refused],
    [1, 1, 2, true, 'chasis', 'intact', false, []]);
  t.close();
}

// ---------- a Tactic that serves its own squad is no arm ----------
{
  const { t, s, U } = await staged();
  const swarm = { ...M.U.makeDroneToken(s, data, data.byId.get(SU1), 's1'), col: 13, row: 4, facing: 0 };
  s.tokens.push(swarm);
  const weapons = (uid) => viewOf(s, 's1').units.find((u) => u.uid === uid).weapons.map((x) => `${x.actionId}:${x.type}:${x.own ? 'own' : 'aimed'}`);
  check('THE SEAM SAYS WHICH TACTICS SERVE ITS OWN SQUAD ALONE (`own`): the SU1\'s Armor Patch does; a gun, and a Projectile Action, do not',
    [weapons(swarm.uid), weapons(U.Nest.uid).filter((x) => /Firing|Projectile/.test(x)).every((x) => x.endsWith(':aimed'))], [['ZYDR-108_B:Tactic:own'], true]);
  t.close();
  // The same game played with the skill off: the SU1, given its Command,
  // walks at the enemy (its Range of 2 read as an arm, its squad behind), and
  // nothing is mended.
  const blind = await staged({ policies: { s1: AI.makeTactician({ aimed: false }, { patch: 1 }), s2: AI.tacticianPolicy } });
  const did = [];
  blind.t.watch((cmd) => {
    if (cmd.kind === 'launch' || cmd.kind === 'repairPart' || (cmd.kind === 'maneuver' && blind.s.tokens.find((x) => x.uid === cmd.uid)?.cardId === SU1)) did.push(`${blind.s.round.n}:${cmd.kind}`);
  });
  await blind.t.run({ until: (st) => st.round.n >= 2 && st.round.phase >= 2, maxSteps: blind.t.steps() + 400 });
  check('with the skill off (`aimed`) the SU1 is launched as before, and in round 2 its Command is spent walking at the enemy: nothing is mended',
    [did.filter((x) => x.startsWith('1:launch')).length, did.includes('2:maneuver'), did.includes('2:repairPart'), blind.U.Dwarf.partStates.chasis], [1, true, false, 'damaged']);
  blind.t.close();
}

console.log(`\n${pass} passed, ${fail} failed`);
M.L.setLocalSeat(null);
if (fail) process.exit(1);
