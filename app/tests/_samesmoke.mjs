// AI lab (tools/ai-lab/README.md): a fingerprint of seeded games of the squads of M8.2c and M8.2d (launchers of
// every kind, Smoke, Mines, a Pholcus), to prove a saving changes nothing where _samegames.mjs has
// nothing to say (the copied squads launch only Missiles).
//   node tests/_samesmoke.mjs [policy = tactician] [opponent = tactician] [games = 2] [first seed = 1]
// Run it before a change that is meant to be a saving only, and after: the last line must be the same.
import { createHash } from 'node:crypto';
import { botTable, loadEngine } from './_engine.mjs';
import { policyOf } from './_policies.mjs';

const HIDDEN = (process.env.HIDE ?? '').split(',').filter(Boolean);

const { M, data } = await loadEngine(`samesmoke-${process.argv.slice(2).join('-').replace(/[^a-z0-9-]/gi, '_')}`, ["export * as SEAT from '../src/seat';", "export * as AI from '../src/ai/index';", "export * as HUD from '../src/matchhud';"]);
const subject = process.argv[2] ?? 'tactician';
const foe = process.argv[3] ?? 'tactician';
const n = Number(process.argv[4] ?? 2);
const first = Number(process.argv[5] ?? 1);
data.solo.squads['x-smokers'] = { name: 'Smokers', faction: 'RDL', points: 0, mechs: [
  { name: 'Volcano', loadout: { torso: '016', chasis: '020', leftHand: '050', rightHand: '033', backpack: '532', pilot: 'FPA-63' } },
  { name: 'Mire', loadout: { torso: '014', chasis: '020', leftHand: '056', rightHand: '033', backpack: '006', pilot: 'FPA-04-2' } }], drones: [{ cardId: 'PRDR-103' }] };
data.solo.squads['x-grenadiers'] = { name: 'Grenadiers', faction: 'UN', points: 0, mechs: [
  { name: 'Wolf', loadout: { torso: '091', chasis: '099', leftHand: '108', rightHand: '541', backpack: '082', pilot: 'LPA-23-2' } },
  { name: 'Cat', loadout: { torso: '539', chasis: '099', leftHand: '540', rightHand: '541', backpack: '538', pilot: 'LPA-23-2' } }], drones: [{ cardId: '166' }] };
// A second table: an interceptor on each side (the AMS 003 and the Raven), so a launch owes Interception.
data.solo.squads['x-sappers'] = { name: 'Sappers', faction: 'RDL', points: 0, mechs: [
  { name: 'Mire', loadout: { torso: '014', chasis: '020', leftHand: '056', rightHand: '033', backpack: '006', pilot: 'FPA-63' } },
  { name: 'Dune', loadout: { torso: '016', chasis: '534', leftHand: '535', rightHand: '536', backpack: '003', pilot: 'FPA-04-2' } }], drones: [] };
const tables = [
  { ...data.solo.scenarios[0], id: 'x-smoke', seats: { s1: 'x-smokers', s2: 'x-grenadiers' } },
  { ...data.solo.scenarios[0], id: 'x-sap', map: 'crossroads', seats: { s1: 'x-grenadiers', s2: 'x-sappers' } },
];
const all = createHash('sha256');
for (const [g, scenario] of tables.entries()) {
  for (const seat of ['s1', 's2']) {
    const other = seat === 's1' ? 's2' : 's1';
    const told = [];
    for (let seed = first; seed < first + n; seed++) {
      const t = botTable(M, data, scenario, { seed, policies: { [seat]: policyOf(M.AI, subject), [other]: policyOf(M.AI, foe) }, glue: M.HUD.glueAfter });
      let end;
      try { end = await t.run({ maxSteps: 12000 }); } catch (err) { end = { kind: 'threw', why: err.message }; } finally { t.close(); }
      // With `mine` hidden, the Mines question (answered none, sending nothing)
      // is left out of the fingerprint, so the old games can be matched.
      const shown = (e) => !(HIDDEN.includes('mine') && e.kind === 'mine.lay');
      const log = ['s1', 's2'].map((s) => t.drivers[s].log.filter(shown).map((e) => `${e.kind}>${e.option}`).join('|')).join('||');
      const vp = M.TK.normaliseTasks(t.state.tasks).vp;
      all.update(log);
      told.push(`${seed}:${end.kind === 'over' ? `${vp[seat]}-${vp[other]}` : end.kind}:${createHash('sha256').update(log).digest('hex').slice(0, 10)}`);
    }
    console.log(`table ${g} as ${seat}  ${told.join('  ')}`);
  }
}
console.log(`SAME SMOKE ${subject} v ${foe} x${n}: ${all.digest('hex').slice(0, 16)}`);
