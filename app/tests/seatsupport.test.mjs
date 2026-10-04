// The Actions that are settled as they are paid for, answered by a seat
// (rulebook 6.1, 6.2.1, 4.13, 4.17; AI-OPPONENT-PLAN.md, M8.2f).
//
// Some Actions roll nothing and open no window: they are paid for and then
// done to something. A Mode change turns a Part over; Ambush and Amplify
// Profile put a Token on the unit itself, Target Tag on a unit it picks; Stance
// feedback switches an Ally's Stance; a Discard turns a Handheld Part over for
// good; Ammo Supply, Strengthen Link, System Cleanup and Damage Control give an
// ally back what it has lost. The Match Centre asks each in a small panel of
// its own. The seam offered none of them: a computer's Mech with a Field
// Repair System never repaired anything. Each is staged here on the real
// engine: what is offered, what the answer sends, and what the table is after.
import { botTable, loadEngine, tableAtRoundOne } from './_engine.mjs';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}\n       got  ${g}`); }
};

console.log('The Actions settled as they are paid for\n');

const { M, data } = await loadEngine('seatsupport', ["export * as SEAT from '../src/seat';", "export * as TURN from '../src/turn';", "export * as AI from '../src/ai/index';", "export * as HUD from '../src/matchhud';"]);
const { owed, newMind } = M.SEAT;
const T = M.TURN;
const AI = M.AI;
const clone = (x) => JSON.parse(JSON.stringify(x));

// RDL: a Nimbus Support Core (Strengthen Link on one Mech, System Cleanup) with
// a Field Repair System; an Aurora ECM Core (Strengthen Link on every Mech in
// Range) with a Beacon Backpack; a Vigilant (Target Tag). UN: a Viper (Ambush)
// with a Missile Pod and the Ammunition Pack that refills it; a Bison (Amplify
// Profile). GOF: a Mech, the White Dwarf (a Mode change), a Patrol Eagle (Stance
// feedback) and an SU1 (Armor Patch).
data.solo.squads['t-support'] = {
  name: 'Supporters', faction: 'RDL', points: 0,
  mechs: [
    { name: 'Nimbus', loadout: { torso: '504', chasis: '020', leftHand: '050', rightHand: '033', backpack: '001', pilot: 'FPA-63' } },
    { name: 'Aurora', loadout: { torso: '018', chasis: '534', leftHand: '535', rightHand: '536', backpack: '008', pilot: 'FPA-04-2' } },
  ],
  drones: [{ cardId: 'PRDR-202' }],
};
data.solo.squads['t-lurkers'] = {
  name: 'Lurkers', faction: 'UN', points: 0,
  mechs: [
    { name: 'Viper', loadout: { torso: '094', chasis: '099', leftHand: '129', rightHand: '541', backpack: '086', pilot: 'LPA-23-2' } },
    { name: 'Bison', loadout: { torso: '098', chasis: '099', leftHand: '540', rightHand: '541', backpack: '538', pilot: 'LPA-23-2' } },
  ],
  drones: [],
};
data.solo.squads['t-eagles'] = {
  name: 'Eagles', faction: 'GOF', points: 0,
  mechs: [
    { name: 'Tracer', loadout: { torso: '174', chasis: '179', leftHand: 'ZHLA-101', pilot: 'ZPA-43' } },
    { name: 'Dwarf', loadout: { torso: '287', chasis: '289', leftHand: '291', rightHand: '290', backpack: '292', pilot: 'ACE-01' } },
  ],
  drones: [{ cardId: 'ZHDR-206' }, { cardId: 'ZYDR-108' }],
};
const TABLES = {
  a: { ...data.solo.scenarios[0], id: 't-support-a', seats: { s1: 't-support', s2: 't-lurkers' } },
  b: { ...data.solo.scenarios[0], id: 't-support-b', seats: { s1: 't-eagles', s2: 't-lurkers' } },
};
const NAMES = { 'PRDR-202': 'Vigilant', 'ZHDR-206': 'Eagle', 'ZYDR-108': 'Swarm', '075': 'Beacon' };
const name = (t) => NAMES[t.cardId] ?? t.label;

const run = (state, cmd) => {
  const v = M.C.check(data, state, cmd);
  if (v.ok) { M.C.apply(data, state, cmd); M.G.glueAfter(data, state, cmd); }
  return v;
};
const sendAll = (state, commands) => commands.map((c) => run(state, c).ok);
const SETTLED = ['mode', 'token', 'discard', 'support'];
const settled = (d) => (d ? d.options.filter((o) => SETTLED.includes(o.tags[0])) : []);
const ids = (list) => list.map((o) => o.id);

const bases = Object.fromEntries(Object.entries(TABLES).map(([k, scenario]) => {
  M.L.setLocalSeat(null);
  const t = tableAtRoundOne(M, data, scenario);
  if (t.refused.length) throw new Error(`table ${k}: ${t.refused.join('; ')}`);
  return [k, t.state];
}));
// A table at a phase on open ground, every unit where the test wants it: the
// first squad in a row across the middle, the second two Grids south of it.
const stage = (table, phase = 2, { terrain = false } = {}) => {
  const s = clone(bases[table]);
  if (!terrain) s.map = 'none';
  const U = Object.fromEntries(s.tokens.map((t) => [name(t), t]));
  const at = (t, c, r, f) => { t.col = c * 3; t.row = r * 3; if (f !== undefined) t.facing = f; };
  s.tokens.filter((t) => t.side === 's1').forEach((t, i) => at(t, 3 + i * 2, 4, 2));
  s.tokens.filter((t) => t.side === 's2').forEach((t, i) => at(t, 4 + i * 2, 7, 0));
  s.round.phase = phase; s.script.stage = `1:${phase}`; s.script.acted = []; s.script.passed = []; s.script.opp = null;
  if (phase >= 2) { s.script.revealed = ['s1', 's2']; for (const t of s.tokens) if (t.kind === 'mech') t.timing = 'firing'; }
  // A Mech's Action Opportunity on the Timing named; a Drone's or a
  // Projectile's activation, as its phase opens it.
  const turnOf = (unit, timing) => {
    M.L.setLocalSeat(unit.side);
    if (unit.kind !== 'mech') { s.script.opp = M.TY.newOpportunity(unit.uid, undefined); return owed(data, s, unit.side, newMind()); }
    unit.timing = timing;
    s.script.acted = s.tokens.filter((x) => x.kind === 'mech' && x.uid !== unit.uid).map((x) => x.uid);
    s.script.opp = null;
    M.G.opportunity(data, s);
    return owed(data, s, unit.side, newMind());
  };
  const put = (cardId, side, c, r, extra = {}) => {
    const t = { ...M.U.makeDroneToken(s, data, data.byId.get(cardId), side), col: c * 3 + 1, row: r * 3 + 1, facing: 0, ...extra };
    s.tokens.push(t);
    return t;
  };
  return { s, U, at, turnOf, put };
};
const pays = (unit, key, partKey = key) => ({ kind: 'performAction', seat: unit.side, uid: unit.uid, actionId: key, partKey });

// ---------- the cards ----------
{
  const { U } = stage('a');
  const b = stage('b').U;
  const route = (unit, id) => T.actionRoute(data, unit, [...M.U.tokenCards(data, unit).flatMap((x) => x.card.actions ?? []), ...(data.commonActions ?? [])].find((x) => x.id === id));
  check('the cards are what the test means them to be: each of these Actions is one the Match Centre opens a small panel for and then settles with a command',
    [route(U.Nimbus, '504_A'), route(U.Nimbus, '504_B'), route(U.Nimbus, '001_A'), route(U.Aurora, '018_B'), route(U.Vigilant, 'PRDR-202_A'), route(U.Viper, '094_A'), route(U.Viper, '086_A'), route(U.Bison, '098_B'),
      route(b.Dwarf, '287_B'), route(b.Eagle, 'ZHDR-206_B'), route(b.Swarm, 'ZYDR-108_B'), route(U.Aurora, 'COMMON_DISCARD')],
    ['link', 'cleanup', 'repair', 'link', 'targetStatus', 'selfStatus', 'resupply', 'selfStatus', 'transform', 'stanceFeedback', 'repair', 'discard']);
}

// ---------- with nothing to change, nothing is offered ----------
{
  const { s, U, turnOf } = stage('a');
  check('AN ACTION THAT COULD CHANGE NOTHING IS NOT OFFERED (FAQ H2): with every Mech at full Link, no Token worn, nothing Damaged and every magazine full, a Support Core, a Field Repair System and an Ammunition Pack offer nothing',
    [ids(settled(turnOf(U.Nimbus, 'tactical'))), ids(settled(turnOf(U.Aurora, 'tactical'))), ids(settled(turnOf(U.Viper, 'tactical')))], [[], [], []]);
  // The engine holds the same line, three ways (which is why the seam's own
  // guards for them change nothing: the break run found each redundant).
  turnOf(U.Aurora, 'tactical');
  const row = T.actionRows(data, s, U.Aurora, s.script.opp).find((r) => r.a.id === '018_B');
  const worn = stage('a');
  worn.U.Viper.statuses = [...(worn.U.Viper.statuses ?? []), 'lowProfile'];
  worn.turnOf(worn.U.Viper, 'swift');
  const b = stage('b', 0);
  b.turnOf(b.U.Eagle);
  const ambush = T.actionRows(data, worn.s, worn.U.Viper, worn.s.script.opp).find((r) => r.a.id === '094_A');
  check('and the board holds the same line itself: the row of an Action that would change nothing is not live (Strengthen Link with nobody short; Ambush on a Mech that bears the Token, FAQ J1), and the engine refuses Stance feedback to the Stance the Mech is in',
    [row.v.ok, ambush.v.ok, M.C.check(data, b.s, { kind: 'stanceFeedback', seat: 's1', uid: b.U.Eagle.uid, actionId: 'ZHDR-206_B', targetUid: b.U.Tracer.uid, stance: b.U.Tracer.stance }).ok],
    [false, false, false]);
}

// ---------- Link support ----------
{
  const { s, U, turnOf } = stage('a');
  U.Nimbus.link -= 2; U.Aurora.link -= 1;
  const d = turnOf(U.Nimbus, 'tactical');
  const links = settled(d).filter((o) => o.tags.includes('link'));
  check('STRENGTHEN LINK ON ONE ALLY MECH (504_A, Range 8) is one answer for each Mech of its squad that is short of Link, itself among them; each is the Action paid for and the Link recovered',
    [ids(links), links.map((o) => o.tags), links[1].commands, links.map((o) => o.facts.links)],
    [[`link:504_A:${U.Nimbus.uid}`, `link:504_A:${U.Aurora.uid}`], [['support', 'link'], ['support', 'link']],
      [pays(U.Nimbus, '504_A'), { kind: 'recoverLink', seat: 's1', uid: U.Nimbus.uid, targetUid: U.Aurora.uid, actionId: '504_A' }], [1, 1]]);
  const before = [U.Nimbus.link, U.Aurora.link];
  check('the engine takes it, and the Mech named has a Link more', [sendAll(s, links[1].commands), U.Nimbus.link - before[0], U.Aurora.link - before[1]], [[true, true], 0, 1]);
  const all = settled(turnOf(U.Aurora, 'tactical')).filter((o) => o.tags.includes('link'));
  check('STRENGTHEN LINK ON EVERY ALLY MECH IN RANGE (018_B, Range 4) is one answer: a Link for each Mech that is short of one, and none for a Mech that is not',
    [ids(all), all[0].commands, all[0].facts.targets, all[0].facts.links],
    [['link:018_B'], [pays(U.Aurora, '018_B'), { kind: 'recoverLink', seat: 's1', uid: U.Aurora.uid, targetUid: U.Nimbus.uid, actionId: '018_B' }], [U.Nimbus.uid], 1]);
  check('taken, the Nimbus is a Link better off', [sendAll(s, all[0].commands), U.Nimbus.link - before[0]], [[true, true], 1]);
  // Out of Range.
  const far = stage('a');
  far.U.Nimbus.link -= 1;
  far.at(far.U.Nimbus, 0, 0, 2); far.at(far.U.Aurora, 11, 11, 2);
  check('a Mech out of the Action\'s Range is not offered its Link', ids(settled(far.turnOf(far.U.Aurora, 'tactical'))), []);
}
{
  // A Link Beacon: its Delayed Action is its turn.
  const { s, U, turnOf, put } = stage('a', 4);
  U.Nimbus.link -= 1;
  const beacon = put('075', 's1', 4, 5, { parentUid: U.Aurora.uid });
  const d = turnOf(beacon);
  const o = settled(d)[0];
  check('A LINK BEACON\'S DELAYED ACTION (075_A) is offered in the Delay Phase: every Ally Mech in Range 3 that is short recovers a Link',
    [d.kind, ids(settled(d)), o.commands.map((c) => c.kind), o.facts.targets], ['activation.act', ['link:075_A'], ['performAction', 'recoverLink'], [U.Nimbus.uid]]);
  const was = U.Nimbus.link;
  check('taken, the Link is recovered and the Beacon stays on the board, to act again a round on (4.7.5)', [sendAll(s, o.commands), U.Nimbus.link - was, s.tokens.some((t) => t.uid === beacon.uid)], [[true, true], 1, true]);
  const full = stage('a', 4);
  const b2 = full.put('075', 's1', 4, 5, { parentUid: full.U.Aurora.uid });
  const idle = settled(full.turnOf(b2))[0];
  check('with nobody short of Link it is still the Beacon\'s turn: the Action is performed, and changes nothing', [idle.id, idle.commands.map((c) => c.kind), idle.facts.links], ['link:075_A', ['performAction'], 0]);
}

// ---------- a Token cleaned off an ally ----------
{
  const { s, U, turnOf } = stage('a');
  // (The Aurora wears a Hexagon Token too, which this Action does not take.)
  U.Aurora.statuses = [...(U.Aurora.statuses ?? []), 'fci', 'lowProfile'];
  U.Nimbus.statuses = [...(U.Nimbus.statuses ?? []), 'fci'];
  const picks = settled(turnOf(U.Nimbus, 'tactical')).filter((o) => o.tags.includes('cleanup'));
  check('SYSTEM CLEANUP (504_B, Range 6) is one answer for each Square Token an Ally Unit in Range wears, the Mech\'s own among them',
    [ids(picks), picks[1].commands, picks.every((o) => o.tags.join() === 'support,cleanup')],
    [[`cleanup:504_B:${U.Nimbus.uid}:fci:yellow`, `cleanup:504_B:${U.Aurora.uid}:fci:yellow`],
      [pays(U.Nimbus, '504_B'), { kind: 'removeStatus', seat: 's1', uid: U.Nimbus.uid, targetUid: U.Aurora.uid, statusId: 'fci', face: 'yellow' }], true]);
  check('taken, the Token is off the unit named and on nobody else', [sendAll(s, picks[1].commands), (U.Aurora.statuses ?? []).includes('fci'), (U.Nimbus.statuses ?? []).includes('fci')], [[true, true], false, true]);
}

// ---------- Repair ----------
{
  const { s, U, turnOf } = stage('a');
  U.Nimbus.partStates = { ...U.Nimbus.partStates, leftHand: 'damaged', rightHand: 'destroyed' };
  const picks = settled(turnOf(U.Nimbus, 'tactical')).filter((o) => o.tags.includes('repair'));
  check('DAMAGE CONTROL (001_A) is one answer for each Part of its own it could change: a Damaged one mended, a destroyed one given a Repaired Token',
    [ids(picks), picks.map((o) => o.tags), picks.map((o) => o.commands[1])],
    [['repair:001_A:leftHand:mend', 'repair:001_A:rightHand:repaired'], [['support', 'repair', 'mend'], ['support', 'repair', 'repaired']],
      [{ kind: 'repairPart', seat: 's1', uid: U.Nimbus.uid, slot: 'leftHand', mode: 'mend' }, { kind: 'repairPart', seat: 's1', uid: U.Nimbus.uid, slot: 'rightHand', mode: 'repaired' }]]);
  const mended = clone(s);
  check('mended, the Part is intact', [sendAll(mended, picks[0].commands), mended.tokens.find((t) => t.uid === U.Nimbus.uid).partStates.leftHand], [[true, true], 'intact']);
  check('Repaired, the destroyed Part bears the Token and stays destroyed (FAQ J21)',
    [sendAll(s, picks[1].commands), U.Nimbus.partStates.rightHand, (U.Nimbus.repairedSlots ?? []).includes('rightHand')], [[true, true], 'destroyed', true]);
  check('its one use is spent: the System has no second repair in it', [U.Nimbus.ammo['001_A'], ids(settled(turnOf(U.Nimbus, 'tactical')).filter((o) => o.tags.includes('repair')))], [0, []]);
}
{
  const { s, U, turnOf, at } = stage('b', 0);
  U.Tracer.partStates = { ...U.Tracer.partStates, leftHand: 'damaged' };
  U.Dwarf.partStates = { ...U.Dwarf.partStates, chasis: 'damaged' };
  at(U.Swarm, 3, 5, 2); at(U.Tracer, 3, 4, 2); at(U.Dwarf, 9, 9, 2);
  const picks = settled(turnOf(U.Swarm));
  check('ARMOR PATCH (ZYDR-108_B, Range 2) mends an ALLY: one answer for each Damaged Part of an Ally in Range, and none for one out of it',
    [ids(picks), picks[0].commands[1]], [[`repair:ZYDR-108_B:${U.Tracer.uid}:leftHand`], { kind: 'repairPart', seat: 's1', uid: U.Swarm.uid, slot: 'leftHand', mode: 'mend', targetUid: U.Tracer.uid, actionId: 'ZYDR-108_B' }]);
  check('taken, the Part is mended and the Swarm has left the board ("then remove this Unit")',
    [sendAll(s, picks[0].commands), U.Tracer.partStates.leftHand, s.tokens.some((t) => t.uid === U.Swarm.uid)], [[true, true], 'intact', false]);
}

// ---------- Ammo Supply ----------
{
  const { s, U, turnOf } = stage('a');
  U.Viper.ammo['129_A'] -= 1;
  const full = data.byId.get('129').actions[0].storage;
  const picks = settled(turnOf(U.Viper, 'tactical')).filter((o) => o.tags.includes('resupply'));
  check('AMMO SUPPLY (086_A) is offered to the unit that has spent the Ammo it restores: here the Viper\'s own Missile Pod',
    [ids(picks), picks[0].commands, U.Viper.ammo['129_A'], full],
    [[`resupply:086_A:${U.Viper.uid}`], [pays(U.Viper, '086_A'), { kind: 'restoreAmmo', seat: 's2', uid: U.Viper.uid, actionId: '129_A', amount: 1 }], full - 1, full]);
  const pack = U.Viper.ammo['086_A'];
  check('taken, the Pod is full again and the Pack has one supply fewer', [sendAll(s, picks[0].commands), U.Viper.ammo['129_A'], U.Viper.ammo['086_A']], [[true, true], full, pack - 1]);
}

// ---------- a Token the unit gives itself ----------
{
  const { s, U, turnOf } = stage('a');
  const d = turnOf(U.Viper, 'swift');
  const o = settled(d).find((x) => x.tags[0] === 'token');
  check('AMBUSH (094_A) is one answer: the Action paid for and a Low Profile Token on the Mech itself',
    [o.id, o.tags, o.commands, o.facts], ['token:094_A', ['token', 'self', 'token:lowProfile'],
      [pays(U.Viper, '094_A'), { kind: 'applyStatus', seat: 's2', uid: U.Viper.uid, targetUid: U.Viper.uid, statusId: 'lowProfile', stacks: 1 }], { uid: U.Viper.uid, actionId: '094_A', targetUid: U.Viper.uid, statusId: 'lowProfile' }]);
  check('taken, it bears the Token', [sendAll(s, o.commands), (U.Viper.statuses ?? []).includes('lowProfile')], [[true, true], true]);
  check('and a Mech that already bears one is not offered another (FAQ J1)', settled(turnOf(U.Viper, 'swift')).filter((x) => x.tags[0] === 'token'), []);
  const lit = settled(turnOf(U.Bison, 'swift')).find((x) => x.tags[0] === 'token');
  check('AMPLIFY PROFILE (098_B) is the same with a Highlight Token', [lit.id, lit.tags, lit.commands[1].statusId, sendAll(s, lit.commands), (U.Bison.statuses ?? []).includes('highlight')],
    ['token:098_B', ['token', 'self', 'token:highlight'], 'highlight', [true, true], true]);
}

// ---------- a Token put on a unit it picks ----------
{
  const { s, U, turnOf, at } = stage('a', 0);
  const d = turnOf(U.Vigilant);
  const tags = settled(d);
  check('TARGET TAG (PRDR-202_A, Range 16) is one answer for each unit in Range it can see, of either squad, and says which is which',
    [tags.map((o) => `${name(s.tokens.find((t) => t.uid === o.facts.targetUid))}:${o.tags[1]}`), tags.every((o) => o.tags[0] === 'token' && o.tags[2] === 'token:highlight'), tags[2].commands],
    [['Nimbus:ally', 'Aurora:ally', 'Viper:enemy', 'Bison:enemy'], true, [pays(U.Vigilant, 'PRDR-202_A'), { kind: 'applyStatus', seat: 's1', uid: U.Vigilant.uid, targetUid: U.Viper.uid, statusId: 'highlight', stacks: 1 }]]);
  check('they are the units the Match Centre\'s own picker lists (units.ts targetStatusTargets)',
    tags.map((o) => o.facts.targetUid), M.U.targetStatusTargets(data, s.tokens, U.Vigilant, data.byId.get('PRDR-202').actions[0], M.U.targetStatusGrant(data.byId.get('PRDR-202').actions[0]), { terrain: T.terrainOf(data, s), smoke: [] }).map((t) => t.uid));
  check('taken, the unit picked bears the Highlight', [sendAll(s, tags[2].commands), (U.Viper.statuses ?? []).includes('highlight'), (U.Bison.statuses ?? []).includes('highlight')], [[true, true], true, false]);
  // On the battlefield, a unit behind a building is out of its sight.
  const walled = stage('a', 0, { terrain: true });
  const seen = settled(walled.turnOf(walled.U.Vigilant)).map((o) => o.facts.targetUid);
  const picker = M.U.targetStatusTargets(data, walled.s.tokens, walled.U.Vigilant, data.byId.get('PRDR-202').actions[0], M.U.targetStatusGrant(data.byId.get('PRDR-202').actions[0]), { terrain: T.terrainOf(data, walled.s), smoke: [] }).map((t) => t.uid);
  check('on the battlefield it is offered the units it has a line to, and no others', [JSON.stringify(seen) === JSON.stringify(picker), seen.length < 4], [true, true]);
  void at;
}

// ---------- Stance feedback ----------
{
  const { s, U, turnOf, at } = stage('b', 0);
  const d = turnOf(U.Eagle);
  const picks = settled(d);
  check('STANCE FEEDBACK (ZHDR-206_B, Range 6) is one answer for each Ally Mech in Range and each Stance it is not in',
    [ids(picks), picks[0].tags, picks[0].commands[1]],
    [[U.Tracer, U.Dwarf].flatMap((m) => ['defensive', 'mobility', 'offensive'].filter((x) => x !== m.stance).map((x) => `feedback:ZHDR-206_B:${m.uid}:${x}`)), ['support', 'feedback', `to:${['defensive', 'mobility', 'offensive'].find((x) => x !== U.Tracer.stance)}`],
      { kind: 'stanceFeedback', seat: 's1', uid: U.Eagle.uid, actionId: 'ZHDR-206_B', targetUid: U.Tracer.uid, stance: ['defensive', 'mobility', 'offensive'].find((x) => x !== U.Tracer.stance) }]);
  const to = picks[0].commands[1].stance;
  check('taken, that Mech stands in the Stance named, outside its own turn', [sendAll(s, picks[0].commands), U.Tracer.stance], [[true, true], to]);
  const down = stage('b', 0);
  down.U.Tracer.stance = 'shutdown';
  down.at(down.U.Dwarf, 11, 11, 0);
  check('a Mech in Shutdown is not switched, nor one out of Range', ids(settled(down.turnOf(down.U.Eagle))), []);
  void at;
}

// ---------- a Mode change ----------
{
  const { s, U, turnOf } = stage('b');
  const o = settled(turnOf(U.Dwarf, 'swift')).find((x) => x.tags[0] === 'mode');
  check('A MODE CHANGE (287_B, Cruise Mode) is one answer: the Action paid for and the Core turned over to its other face',
    [o.id, o.tags, o.commands, o.facts],
    ['mode:287_B', ['mode'], [pays(U.Dwarf, '287_B'), { kind: 'transformPart', seat: 's1', uid: U.Dwarf.uid, slot: 'torso', cardId: '288' }], { uid: U.Dwarf.uid, actionId: '287_B', slot: 'torso', into: '288' }]);
  check('taken, the Mech is in Cruise Mode, which puts it in Mobility Stance', [sendAll(s, o.commands), U.Dwarf.mech.torso, U.Dwarf.cardId, U.Dwarf.stance], [[true, true], '288', '288', 'mobility']);
  const back = settled(turnOf(U.Dwarf, 'swift')).find((x) => x.tags[0] === 'mode');
  check('and at its next turn the way back is offered, by the face it now shows', [back.id, back.commands[1].cardId, sendAll(s, back.commands), U.Dwarf.mech.torso], ['mode:288_B', '287', [true, true], '287']);
}

// ---------- Discard ----------
{
  const { s, U, turnOf } = stage('a');
  const picks = settled(turnOf(U.Aurora, 'swift')).filter((o) => o.tags[0] === 'discard');
  check('DISCARD (6.1, 4.17) is one answer for each Handheld Part with a Discard Card to turn over to; the Part is named in the Action\'s own payment, which is the whole of it',
    [ids(picks), picks[0].commands, picks[0].facts, M.U.discardSlots(data, U.Aurora).map((x) => `${x.slot}:${x.card.id}:${x.into.id}`)],
    [['discard:rightHand'], [pays(U.Aurora, 'COMMON_DISCARD', 'COMMON_DISCARD@rightHand')], { uid: U.Aurora.uid, actionId: 'COMMON_DISCARD', slot: 'rightHand', into: '537' }, ['rightHand:536:537']]);
  check('taken, the Shotgun is its Discard Card', [sendAll(s, picks[0].commands), U.Aurora.mech.rightHand], [[true], '537']);
  check('a Mech that holds nothing it could Discard is offered none', settled(turnOf(U.Nimbus, 'swift')).filter((o) => o.tags[0] === 'discard'), []);
}

// ---------- asked for by kind ----------
{
  const { s, U, turnOf } = stage('a');
  U.Nimbus.link -= 1; U.Aurora.statuses = [...(U.Aurora.statuses ?? []), 'fci'];
  U.Nimbus.partStates = { ...U.Nimbus.partStates, leftHand: 'damaged' };
  const whole = turnOf(U.Nimbus, 'tactical');
  const only = (...kinds) => owed(data, s, 's1', newMind(), { only: kinds });
  check('each is a kind of answer an asker may want alone: `support`, `token`, `mode`, `discard`',
    [ids(only('support').options), only('token'), only('mode'), only('discard')], [ids(whole.options.filter((o) => o.tags[0] === 'support')), null, null, null]);
  const swift = turnOf(U.Aurora, 'swift');
  check('and the first tag of every one of them is its kind', [ids(owed(data, s, 's1', newMind(), { only: ['discard'] }).options), swift.options.filter((o) => o.tags[0] === 'discard').length], [['discard:rightHand'], 1]);
  turnOf(U.Viper, 'swift');
  check('a Token on itself is asked for as `token`, and is not `support`', [ids(owed(data, s, 's2', newMind(), { only: ['token'] }).options), owed(data, s, 's2', newMind(), { only: ['support'] })], [['token:094_A'], null]);
  const b = stage('b');
  b.turnOf(b.U.Dwarf, 'swift');
  check('a Mode change as `mode`, and is not `token`', [ids(owed(data, b.s, 's1', newMind(), { only: ['mode'] }).options), owed(data, b.s, 's1', newMind(), { only: ['token'] })], [['mode:287_B'], null]);
}

// ---------- what the Tactician makes of them ----------
M.L.setLocalSeat(null);
{
  const viewOf = (state, seat) => M.SEAT.viewOf(data, state, seat);
  const tact = AI.makeTactician({ focus: false });
  // Two drivers at a table that has been set up, the units then stood where
  // the check wants them; what one seat is asked, and what a policy answers.
  const staged = async (table, seat, arrange, policies = AI.eagerPolicy) => {
    const t = botTable(M, data, { ...TABLES[table], map: 'none' }, { seed: 3, policies });
    await t.run({ until: (st) => M.SU.normaliseSetup(st.setup)?.stage === 'done' });
    const s = t.state;
    const U = Object.fromEntries(s.tokens.map((x) => [name(x), x]));
    const at = (x, c, r, f) => { x.col = c * 3; x.row = r * 3; if (f !== undefined) x.facing = f; };
    s.tokens.filter((x) => x.side === 's1').forEach((x, i) => at(x, 3 + i * 2, 4, 2));
    s.tokens.filter((x) => x.side === 's2').forEach((x, i) => at(x, 4 + i * 2, 7, 0));
    const sc = s.script;
    s.round.phase = 2; sc.stage = '1:2'; sc.acted = []; sc.opp = null; sc.revealed = ['s1', 's2']; sc.passed = [];
    for (const x of s.tokens) if (x.kind === 'mech') x.timing = 'firing';
    const turnOf = (mech, timing) => {
      mech.timing = timing;
      sc.acted = s.tokens.filter((x) => x.kind === 'mech' && x.uid !== mech.uid).map((x) => x.uid);
      sc.opp = null;
      return M.G.opportunity(data, s);
    };
    arrange({ s, U, at, turnOf });
    const d = t.drivers[seat].pending();
    const pick = (p = tact) => { const c = p.choose(d, viewOf(s, seat), new AI.Rng('pick')); return { ...c, o: d.options.find((o) => o.id === c.option) }; };
    return { t, s, U, d, pick };
  };
  const unarmed = (...units) => { for (const u of units) u.partStates = { ...u.partStates, leftHand: 'destroyed', rightHand: 'destroyed' }; };

  // Nothing to shoot at: it puts right what it can, the dearest first.
  const idle = await staged('a', 's1', ({ U, at, turnOf }) => {
    at(U.Nimbus, 0, 0, 2); at(U.Aurora, 1, 0, 2); at(U.Viper, 11, 11, 0); at(U.Bison, 10, 11, 0);
    U.Nimbus.partStates = { ...U.Nimbus.partStates, chasis: 'damaged' };
    U.Aurora.link -= 1;
    turnOf(U.Nimbus, 'tactical');
  });
  const mend = idle.pick();
  check('WITH NOTHING TO ATTACK THE TACTICIAN PUTS RIGHT WHAT IT CAN, the dearest first: a Damaged Part mended (half a Part of that Mech) before a Link restored',
    [mend.o.tags, mend.reason, mend.o.id, idle.d.options.filter((o) => o.tags[0] === 'support').map((o) => o.id)],
    [['support', 'repair', 'mend'], 'support_value', 'repair:001_A:chasis:mend', [`link:504_A:${idle.U.Aurora.uid}`, 'repair:001_A:chasis:mend']]);
  // A Part mended is what Damaging that Part, for certain and nothing more,
  // is worth to whoever does it: the price list's own reading (evaluate.ts).
  const view1 = viewOf(idle.s, 's1');
  const dented = AI.gainOf({ hit: 1, pen: 1, damage: 1, destroy: 0, kill: 0, link: 0, parts: [], pick: null }, view1.units.find((u) => u.uid === idle.U.Nimbus.uid), view1, AI.TACTICIAN);
  check('each is priced off the list that prices losing it: the mend at exactly what Damaging that Part is worth, which is more than a Link; a Link at the weight `link`',
    [Math.abs(mend.score - dented) < 1e-9, dented > AI.TACTICIAN.link, dented < AI.unitWorth(view1.units.find((u) => u.uid === idle.U.Nimbus.uid), view1, AI.TACTICIAN) / 2,
      AI.makeTactician({ focus: false }, { link: 9 }).choose(idle.d, viewOf(idle.s, 's1'), new AI.Rng('x')).option], [true, true, true, `link:504_A:${idle.U.Aurora.uid}`]);
  // Link on every Mech in Range: a Link for each Mech that gains one.
  const short = (n) => staged('a', 's1', ({ U, at, turnOf }) => {
    at(U.Nimbus, 0, 0, 2); at(U.Aurora, 1, 0, 2); at(U.Viper, 11, 11, 0); at(U.Bison, 10, 11, 0);
    U.Nimbus.link -= 1;
    if (n > 1) U.Aurora.link -= 1;
    turnOf(U.Aurora, 'tactical');
  });
  const [one, two] = [await short(1), await short(2)];
  const linked = (x) => AI.weighed(x.d, viewOf(x.s, 's1'), { focus: false }).find((p) => p.how === 'stay');
  check('Link restored is worth the weight `link` for each Link: Strengthen Link on two Mechs that are short is worth twice what it is on one',
    [/Strengthen Link/.test(linked(one).does), Math.abs(linked(one).now - AI.TACTICIAN.link) < 1e-9, Math.abs(linked(two).now - 2 * AI.TACTICIAN.link) < 1e-9], [true, true, true]);
  one.t.close(); two.t.close();
  check('with the skill off (`support`) it does none of it; and the policies with no rule for these Actions never take one',
    [AI.makeTactician({ focus: false, support: false }).choose(idle.d, viewOf(idle.s, 's1'), new AI.Rng('x')).option.startsWith('repair') || false,
      [AI.brawlerPolicy, AI.eagerPolicy].map((p) => SETTLED.includes(idle.d.options.find((o) => o.id === p.choose(idle.d, viewOf(idle.s, 's1'), new AI.Rng('x')).option).tags[0]))],
    [false, [false, false]]);
  idle.t.close();

  // An enemy in its sights, and a mend on offer beside the attack: the attack
  // comes first. (Its Starting Action, a Token cleaned off the Aurora, is
  // behind it: on a Tactical dial a Firing Action is only ever the second.)
  const armed = await staged('a', 's1', ({ s, U, at, turnOf }) => {
    at(U.Nimbus, 5, 5, 2); at(U.Aurora, 5, 3, 2); at(U.Viper, 5, 7, 0); at(U.Bison, 11, 11, 0);
    U.Nimbus.partStates = { ...U.Nimbus.partStates, chasis: 'damaged' };
    U.Aurora.statuses = [...(U.Aurora.statuses ?? []), 'fci'];
    turnOf(U.Nimbus, 'tactical');
    M.L.setLocalSeat('s1');
    const first = owed(data, s, 's1', newMind()).options.find((o) => o.tags.includes('cleanup'));
    for (const cmd of first.commands) run(s, cmd);
  });
  const shot = armed.pick();
  check('with an enemy in its sights and a mend on offer beside the attack, the attack is worth more, and is made',
    [shot.o.tags[0], shot.reason, armed.d.options.some((o) => o.tags.includes('repair')), armed.s.script.opp.performed], ['attack', 'attack_value', true, ['504_B']]);
  armed.t.close();

  // Fire Control Interference on an ally with a gun: cleaned off before a Link.
  const jammed = await staged('a', 's1', ({ U, at, turnOf }) => {
    at(U.Nimbus, 0, 0, 2); at(U.Aurora, 2, 0, 2); at(U.Viper, 11, 11, 0); at(U.Bison, 10, 11, 0);
    U.Aurora.statuses = [...(U.Aurora.statuses ?? []), 'fci'];
    U.Aurora.link -= 1;
    turnOf(U.Nimbus, 'tactical');
  });
  // (With nobody in sight a walk toward the zones is worth more than either,
  // and is what it would do first. What is held here is the deed it would
  // make where it stands: of the two things it could put right, which.)
  const deed = AI.weighed(jammed.d, viewOf(jammed.s, 's1'), { focus: false }).find((p) => p.how === 'stay');
  const cleanup = jammed.d.options.find((o) => o.tags.includes('cleanup'));
  check('Fire Control Interference cleaned off an ally with a gun is worth the Firing that gun loses to it: of a Token to clean and a Link to restore, the Token is the deed it would make',
    [deed.does === cleanup.label, /System Cleanup, Fire Control Interference/.test(deed.does), deed.now > 0.15, jammed.d.options.some((o) => o.tags.includes('link'))], [true, true, true, true]);
  check('and it is looked for after a Stance change as it is where it stands: a plan that changes Stance first still ends in the same deed',
    AI.weighed(jammed.d, viewOf(jammed.s, 's1'), { focus: false }).filter((p) => p.how === 'stance').map((p) => p.does === cleanup.label), [true, true]);
  jammed.t.close();
  // Any other Square Token is worth a token's worth, which is less than a Link.
  const frail = await staged('a', 's1', ({ U, at, turnOf }) => {
    at(U.Nimbus, 0, 0, 2); at(U.Aurora, 2, 0, 2); at(U.Viper, 11, 11, 0); at(U.Bison, 10, 11, 0);
    U.Aurora.statuses = [...(U.Aurora.statuses ?? []), 'fragile'];
    U.Aurora.link -= 1;
    turnOf(U.Nimbus, 'tactical');
  });
  const lesser = AI.weighed(frail.d, viewOf(frail.s, 's1'), { focus: false }).find((p) => p.how === 'stay');
  check('a Fragile Token cleaned off is worth less than a Link restored, so the Link is the deed', [/Strengthen Link/.test(lesser.does), frail.d.options.some((o) => o.tags.includes('cleanup'))], [true, true]);
  frail.t.close();

  // Ambush: a Low Profile Token where standing there costs less with it.
  const hunt = ({ U, at, turnOf }) => {
    at(U.Viper, 5, 5, 0); at(U.Bison, 11, 11, 0); at(U.Nimbus, 5, 1, 2); at(U.Aurora, 1, 5, 1);
    unarmed(U.Viper);
    turnOf(U.Viper, 'swift');
  };
  const hunted = await staged('a', 's2', hunt, { s1: AI.eagerPolicy, s2: tact });
  const rows = AI.weighed(hunted.d, viewOf(hunted.s, 's2'), { focus: false });
  const low = rows.find((p) => p.how === 'token');
  const stay = rows.find((p) => p.how === 'stay');
  check('AMBUSH IS A PLAN LIKE A STANCE: under two guns and with nothing to strike back with, taking the Low Profile Token is weighed, and standing there costs less with it',
    [!!low, low && low.cost < stay.cost, low && /Ambush, a Low Profile Token/.test(low.label)], [true, true, true]);
  // Its Opportunity played out: the Token is taken in it (a Stance, which is
  // free, may come first).
  const taken = [];
  await hunted.t.run({ until: (st) => st.script.opp?.uid !== hunted.U.Viper.uid, maxSteps: hunted.t.steps() + 12, onStep: (seat, r) => taken.push(`${seat}:${r.option.id}:${hunted.t.drivers[seat].log.at(-1).reason}`) });
  check('and its Opportunity played out by the Tactician takes it, and says why: the Viper ends its turn bearing the Token',
    [taken.includes('s2:token:094_A:low_profile'), (hunted.U.Viper.statuses ?? []).includes('lowProfile'), hunted.t.refused], [true, true, []]);
  hunted.t.close();
  const plain = await staged('a', 's2', hunt, { s1: AI.eagerPolicy, s2: AI.makeTactician({ focus: false, profile: false }) });
  const untaken = [];
  await plain.t.run({ until: (st) => st.script.opp?.uid !== plain.U.Viper.uid, maxSteps: plain.t.steps() + 12, onStep: (seat, r) => untaken.push(`${seat}:${r.option.id}`) });
  check('with its skill off (`profile`) no such plan is weighed, and the same Opportunity ends without the Token',
    [AI.weighed(plain.d, viewOf(plain.s, 's2'), { focus: false, profile: false }).some((p) => p.how === 'token'), untaken.includes('s2:token:094_A'), (plain.U.Viper.statuses ?? []).includes('lowProfile'), untaken.length > 0], [false, false, false, true]);
  plain.t.close();
  const bison = await staged('a', 's2', ({ U, at, turnOf }) => {
    at(U.Bison, 5, 5, 0); at(U.Viper, 11, 11, 0); at(U.Nimbus, 5, 1, 2); at(U.Aurora, 1, 5, 1);
    turnOf(U.Bison, 'swift');
  });
  check('the Bison, offered a Highlight on itself, weighs no plan for it and does not take it',
    [bison.d.options.some((o) => o.id === 'token:098_B'), AI.weighed(bison.d, viewOf(bison.s, 's2'), { focus: false }).some((p) => p.how === 'token'), bison.pick().o.id === 'token:098_B'], [true, false, false]);
  bison.t.close();

  // A Mode change is weighed too.
  const dwarf = await staged('b', 's1', ({ U, at, turnOf }) => {
    at(U.Dwarf, 5, 5, 2); at(U.Tracer, 0, 0, 2); at(U.Viper, 5, 9, 0); at(U.Bison, 9, 5, 3);
    turnOf(U.Dwarf, 'swift');
  });
  const modes = AI.weighed(dwarf.d, viewOf(dwarf.s, 's1'), { focus: false });
  check('A MODE CHANGE IS WEIGHED AS A PLAN OF ITS OWN: what the Mech could do in the other Mode, and what standing there would cost in it; with its skill off (`mode`) it is not',
    [modes.some((p) => p.how === 'mode' && /Cruise Mode/.test(p.label)), AI.weighed(dwarf.d, viewOf(dwarf.s, 's1'), { focus: false, mode: false }).some((p) => p.how === 'mode')], [true, false]);
  dwarf.t.close();
}

// ---------- whole games ----------
M.L.setLocalSeat(null);
{
  const tally = { games: 0, over: 0, refused: 0, broken: [], sent: {} };
  const bump = (k) => { tally.sent[k] = (tally.sent[k] ?? 0) + 1; };
  const WATCHED = ['transformPart', 'stanceFeedback', 'restoreAmmo', 'recoverLink', 'repairPart', 'removeStatus'];
  for (const [table, policy, seeds] of [['a', 'legal', [1, 2, 3]], ['b', 'legal', [1, 2, 3]], ['a', 'eager', [1]], ['b', 'eager', [1]], ['a', 'brawler', [1]], ['b', 'tactician', [1]]]) {
    for (const seed of seeds) {
      const t = botTable(M, data, TABLES[table], { seed, policies: AI[`${policy}Policy`], glue: M.HUD.glueAfter });
      t.watch((cmd) => {
        if (WATCHED.includes(cmd.kind)) bump(cmd.kind);
        if (cmd.kind === 'performAction' && String(cmd.partKey ?? '').startsWith('COMMON_DISCARD@')) bump('discard');
      });
      let end;
      try { end = await t.run({ maxSteps: 12000 }); } catch (err) { end = { kind: 'threw', why: `${err?.message ?? err}`.split('\n')[0] }; } finally { t.close(); }
      tally.games += 1;
      if (end.kind === 'over') tally.over += 1; else tally.broken.push(`${table} ${policy} ${seed}: ${end.kind} ${end.why ?? ''} ${end.decision ?? ''}`);
      tally.refused += t.refused.length;
    }
  }
  check('TEN GAMES with these squads in them, on the page\'s glue, four policies: every one ends as a game should, nothing refused',
    [tally.over, tally.games, tally.refused, tally.broken], [10, 10, 0, []]);
  check('and some of the Actions were performed in them: a Mode changed, a Part Discarded, a Stance fed back',
    [(tally.sent.transformPart ?? 0) > 0, (tally.sent.discard ?? 0) > 0, (tally.sent.stanceFeedback ?? 0) > 0], [true, true, true]);
  console.log(`       sent ${JSON.stringify(tally.sent)}`);
}

console.log(`\n${pass} passed, ${fail} failed`);
M.L.setLocalSeat(null);
if (fail) process.exit(1);
