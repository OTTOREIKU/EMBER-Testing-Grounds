// AI lab (tools/ai-lab/README.md): a named pair of squads, the first played by the policy measured (M8.2f).
//   node tests/_squadmatch.mjs <pair> <seat of the first squad> <opponent> <first seed> <last seed> [policy measured = tactician]
// Pairs: support (a Support Core, a Field Repair System, an ECM Core against two riflemen),
//        profile (a Viper with Ambush and a Bison against two RDL gunners),
//        mode    (the White Dwarf, a Mech and two Drones against two riflemen).
// The page's glue runs the table, as a game against the computer is run. One line of JSON.
import { botTable, loadEngine } from './_engine.mjs';
import { policyOf } from './_policies.mjs';

const { M, data } = await loadEngine(`squadmatch-${process.argv.slice(2).join('-').replace(/[^a-z0-9-]/gi, '_')}`, ["export * as SEAT from '../src/seat';", "export * as AI from '../src/ai/index';", "export * as HUD from '../src/matchhud';"]);
const SQUADS = {
  support: { name: 'Supporters', faction: 'RDL', points: 0, mechs: [
    { name: 'Nimbus', loadout: { torso: '504', chasis: '020', leftHand: '050', rightHand: '033', backpack: '001', pilot: 'FPA-63' } },
    { name: 'Aurora', loadout: { torso: '018', chasis: '534', leftHand: '535', rightHand: '536', backpack: '008', pilot: 'FPA-04-2' } }], drones: [{ cardId: 'PRDR-202' }] },
  lurkers: { name: 'Lurkers', faction: 'UN', points: 0, mechs: [
    { name: 'Viper', loadout: { torso: '094', chasis: '099', leftHand: '540', rightHand: '541', backpack: '538', pilot: 'LPA-23-2' } },
    { name: 'Bison', loadout: { torso: '098', chasis: '099', leftHand: '540', rightHand: '541', backpack: '538', pilot: 'LPA-23-2' } }], drones: [] },
  ghosts: { name: 'Ghosts', faction: 'UN', points: 0, mechs: [
    { name: 'Ghost', loadout: { torso: '096', chasis: '099', leftHand: '540', rightHand: '541', backpack: '538', pilot: 'LPA-23-2' } },
    { name: 'Bison', loadout: { torso: '098', chasis: '099', leftHand: '540', rightHand: '541', backpack: '538', pilot: 'LPA-23-2' } }], drones: [] },
  shades: { name: 'Shades', faction: 'UN', points: 0, mechs: [
    { name: 'Ghost', loadout: { torso: '096', chasis: '099', leftHand: '540', rightHand: '541', backpack: '538', pilot: 'LPA-23-2' } },
    { name: 'Wraith', loadout: { torso: '247', chasis: '099', leftHand: '540', rightHand: '541', backpack: '538', pilot: 'LPA-23-2' } }], drones: [] },
  eagles: { name: 'Eagles', faction: 'GOF', points: 0, mechs: [
    { name: 'Tracer', loadout: { torso: '174', chasis: '179', leftHand: 'ZHLA-101', pilot: 'ZPA-43' } },
    { name: 'Dwarf', loadout: { torso: '287', chasis: '289', leftHand: '291', rightHand: '290', backpack: '292', pilot: 'ACE-01' } }], drones: [{ cardId: 'ZHDR-206' }, { cardId: 'ZYDR-108' }] },
  gof: { name: 'GoF', faction: 'GOF', points: 0, mechs: [
    { name: 'Tracer', loadout: { torso: '174', chasis: '179', leftHand: 'ZHLA-101', rightHand: 'ZHRA-101', pilot: 'ZPA-43' } }], drones: [{ cardId: 'ZHDR-107' }, { cardId: 'ZHDR-106' }] },
  riflemen: { name: 'Riflemen', faction: 'UN', points: 0, mechs: [
    { name: 'Wolf', loadout: { torso: '539', chasis: '099', leftHand: '540', rightHand: '541', backpack: '538', pilot: 'LPA-23-2' } },
    { name: 'Cat', loadout: { torso: '539', chasis: '099', leftHand: '540', rightHand: '541', backpack: '538', pilot: 'LPA-23-2' } }], drones: [] },
  gunners: { name: 'Gunners', faction: 'RDL', points: 0, mechs: [
    { name: 'Dune', loadout: { torso: '533', chasis: '534', leftHand: '535', rightHand: '536', backpack: '004', pilot: 'FPA-04-2' } },
    { name: 'Sand', loadout: { torso: '533', chasis: '534', leftHand: '535', rightHand: '536', backpack: '004', pilot: 'FPA-04-2' } }], drones: [] },
  // A Mine Layer (Auto Mine Laying, 006_A) and a gunner.
  layers: { name: 'Layers', faction: 'RDL', points: 0, mechs: [
    { name: 'Dune', loadout: { torso: '533', chasis: '534', leftHand: '535', rightHand: '536', backpack: '006', pilot: 'FPA-04-2' } },
    { name: 'Sand', loadout: { torso: '533', chasis: '534', leftHand: '535', rightHand: '536', backpack: '004', pilot: 'FPA-04-2' } }], drones: [] },
  // The Taurus Experimental Core (Prototype Blink, 555_B) and a rifleman.
  taurus: { name: 'Taurus', faction: 'UN', points: 0, mechs: [
    { name: 'Taurus', loadout: { torso: '555', chasis: '099', leftHand: '540', rightHand: '541', backpack: '538', pilot: 'LPA-23-2' } },
    { name: 'Wolf', loadout: { torso: '539', chasis: '099', leftHand: '540', rightHand: '541', backpack: '538', pilot: 'LPA-23-2' } }], drones: [] },
  // Two Large RDL gunners, the crushers (M8.2p).
  crushers: { name: 'Crushers', faction: 'RDL', points: 0, mechs: [
    { name: 'Dune', loadout: { torso: '533', chasis: '534', leftHand: '535', rightHand: '536', backpack: '004', pilot: 'FPA-04-2' } },
    { name: 'Sand', loadout: { torso: '533', chasis: '534', leftHand: '535', rightHand: '536', backpack: '004', pilot: 'FPA-04-2' } }], drones: [] },
  // A UN rifleman and four Drones: a Raven Scout, a Delphinium, a Tarantula, a Porcupine.
  swarm: { name: 'Swarm', faction: 'UN', points: 0, mechs: [
    { name: 'Wolf', loadout: { torso: '539', chasis: '099', leftHand: '540', rightHand: '541', backpack: '538', pilot: 'LPA-23-2' } }],
    drones: [{ cardId: '164' }, { cardId: '159' }, { cardId: '163' }, { cardId: '161' }] },
  // GoF with the pilot traits (M8.2r): a Tracer flown by Firewatch, a Chariot by Aster, a Ram and a Ballista.
  pilots: { name: 'Pilots', faction: 'GOF', points: 0, mechs: [
    { name: 'Tracer', loadout: { torso: '174', chasis: '179', leftHand: 'ZHLA-101', rightHand: 'ZHRA-101', pilot: 'ZPA-38' } },
    { name: 'Chariot', loadout: { torso: '176', chasis: '180', leftHand: 'ZHLA-302', rightHand: 'ZHRA-102', pilot: 'ZPA-36' } }],
    drones: [{ cardId: 'ZHDR-107' }, { cardId: 'ZHDR-106' }] },
  // An Echoes Support Backpack (Coordinate, 009) and a Type 79 Combat Shield (Barricade, 045).
  echoes: { name: 'Echoes', faction: 'RDL', points: 0, mechs: [
    { name: 'Echo', loadout: { torso: '533', chasis: '534', leftHand: '535', rightHand: '536', backpack: '009', pilot: 'FPA-04-2' } },
    { name: 'Wall', loadout: { torso: '533', chasis: '534', leftHand: '045', rightHand: '536', backpack: '004', pilot: 'FPA-04-2' } }], drones: [] },
};
// camo: a squad that wears Optical Camouflage, measured; stalk: the squad that must find it, measured;
// shades / hunt: the same with two Mechs that wear it.
const PAIRS = { support: ['support', 'riflemen'], profile: ['lurkers', 'gunners'], mode: ['eagles', 'riflemen'], gof: ['gof', 'riflemen'],
  camo: ['ghosts', 'gunners'], stalk: ['gunners', 'ghosts'], shades: ['shades', 'gunners'], hunt: ['gunners', 'shades'],
  camo2: ['ghosts', 'riflemen'], stalk2: ['riflemen', 'ghosts'], camo3: ['ghosts', 'support'], stalk3: ['support', 'ghosts'],
  extra: ['echoes', 'riflemen'], extra2: ['echoes', 'gunners'], blink: ['taurus', 'gunners'], blink2: ['taurus', 'riflemen'], mines: ['layers', 'riflemen'],
  crush: ['crushers', 'swarm'], crushed: ['swarm', 'crushers'], pilots: ['pilots', 'riflemen'] };
const pair = process.argv[2] ?? 'support';
const seat = process.argv[3] ?? 's1';
const foe = process.argv[4] ?? 'brawler';
const from = Number(process.argv[5] ?? 1);
const to = Number(process.argv[6] ?? 10);
const subject = process.argv[7] ?? 'tactician';
const other = seat === 's1' ? 's2' : 's1';
for (const k of PAIRS[pair]) data.solo.squads[`q-${k}`] = SQUADS[k];
const scenario = { ...data.solo.scenarios[Number(process.env.SCENARIO ?? 0)], id: `q-${pair}`, seats: { [seat]: `q-${PAIRS[pair][0]}`, [other]: `q-${PAIRS[pair][1]}` }, ...(process.env.MAP ? { map: process.env.MAP } : {}), ...(process.env.MISSION ? { mission: process.env.MISSION } : {}) };
const units = (k) => SQUADS[k].mechs.length + SQUADS[k].drones.length;
const out = { pair, subject, seat, against: foe, games: 0, won: 0, lost: 0, level: 0, broken: [], vpFor: 0, vpAgainst: 0, lostUnits: 0, killedUnits: 0, sent: {}, ms: 0 };
const bump = (bag, k) => { bag[k] = (bag[k] ?? 0) + 1; };
const WATCHED = ['transformPart', 'stanceFeedback', 'restoreAmmo', 'recoverLink', 'repairPart', 'removeStatus', 'coordinateCommand', 'designate', 'firewatch', 'asterRestore', 'controlledMove', 'playTactic'];
const t0 = performance.now();
for (let seed = from; seed <= to; seed++) {
  const t = botTable(M, data, scenario, { seed, policies: { [seat]: policyOf(M.AI, subject), [other]: policyOf(M.AI, foe) }, glue: M.HUD.glueAfter });
  const resumes = new Set();
  t.watch((cmd) => {
    if (cmd.kind === 'queueReactions') for (const r of cmd.items) if (r.kind === 'scanAttack') resumes.add(`${r.uid}:${r.actionId}`);
    if (cmd.seat !== seat) return;
    if (WATCHED.includes(cmd.kind)) bump(out.sent, cmd.kind);
    if (cmd.kind === 'applyStatus' && cmd.uid === cmd.targetUid && (cmd.statusId === 'lowProfile' || cmd.statusId === 'highlight')) bump(out.sent, `self:${cmd.statusId}`);
    if (cmd.kind === 'performAction' && String(cmd.partKey ?? '').startsWith('COMMON_DISCARD@')) bump(out.sent, 'discard');
    if (cmd.kind === 'startCounterRoll') bump(out.sent, cmd.thenAttack ? 'designation' : cmd.actionId === 'COMMON_SCAN' ? 'scan' : 'counter-roll');
    if (cmd.kind === 'reveal') bump(out.sent, cmd.to ? 'reveal:hop' : 'reveal:stay');
    if (cmd.kind === 'applyStatus' && cmd.statusId === 'camouflage') bump(out.sent, 'cloak');
    if (cmd.kind === 'resolveReaction' && cmd.placed && resumes.delete(`${cmd.uid}:${cmd.actionId}`)) bump(out.sent, 'resumed');
    if (cmd.kind === 'grantExtra') bump(out.sent, 'grant');
    if (cmd.kind === 'blink') bump(out.sent, 'blink');
    if (cmd.kind === 'layMine') bump(out.sent, 'mine');
    if (cmd.kind === 'launch' && ['293', '294', '295'].includes(cmd.cardId)) bump(out.sent, `bit:${cmd.cardId}`);
    if (cmd.kind === 'switchForm') bump(out.sent, `form:${cmd.cardId}`);
    if (cmd.kind === 'recoverBit') bump(out.sent, 'recover');
    if (cmd.kind === 'crushSwap') bump(out.sent, 'crush:exchange');
    if (cmd.kind === 'forceMove' && !cmd.facing && cmd.uid !== cmd.targetUid) bump(out.sent, 'crush:push?');
    if (cmd.kind === 'performAction' && cmd.actionId === '045_B') bump(out.sent, 'barricade');
  });
  let end;
  try { end = await t.run({ maxSteps: 12000 }); } catch (err) { end = { kind: 'threw', why: `${err?.message ?? err}`.split('\n')[0] }; } finally { t.close(); }
  if (end.kind !== 'over' || t.refused.length) { out.broken.push(`seed ${seed}: ${end.kind} ${end.why ?? ''} ${t.refused.length ? JSON.stringify(t.refused[0]) : ''}`.slice(0, 300)); continue; }
  const vp = M.TK.normaliseTasks(t.state.tasks).vp;
  out.games += 1;
  if (end.result.winner === seat) out.won += 1; else if (end.result.winner === other) out.lost += 1; else out.level += 1;
  out.vpFor += vp[seat]; out.vpAgainst += vp[other];
  const standing = (side) => t.state.tokens.filter((x) => x.side === side && x.kind !== 'projectile' && (x.kind === 'mech' ? x.partStates.torso !== 'destroyed' : x.partStates.main !== 'destroyed')).length;
  out.lostUnits += units(PAIRS[pair][0]) - standing(seat);
  out.killedUnits += units(PAIRS[pair][1]) - standing(other);
}
out.ms = Math.round(performance.now() - t0);
console.log(JSON.stringify(out));
