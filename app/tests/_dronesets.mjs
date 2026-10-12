// AI lab (tools/ai-lab/README.md; OTTO, 2026-10-05: "test more drone compositions for both RDL and UN to see if using combinations of drones
// together helps win more than the standard ones in the raid squads"): writes the squads of the Drone study, the Raid
// squads' own Mechs with each set of Drones, priced off the cards. node tests/_dronesets.mjs <out.json>
import { writeFileSync } from 'node:fs';
import { loadEngine } from './_engine.mjs';

const { data } = await loadEngine('dronesets', ["export * as SEAT from '../src/seat';"]);
const price = (id) => (id ? data.byId.get(id)?.score ?? 0 : 0);
const pts = (sq) => sq.mechs.reduce((n, m) => n + Object.values(m.loadout).reduce((a, id) => a + price(id), 0), 0)
  + sq.drones.reduce((n, d) => n + price(d.cardId) + price(d.backpack), 0);
const rdl = data.solo.squads['raid-rdl'];
const un = data.solo.squads['raid-un'];
const d = (cardId, backpack) => (backpack ? { cardId, backpack } : { cardId });
const SETS = {
  // RDL: the Raid squad has no Drones (Mire and Dune, 400). Pairs of its Hyenas beside them, and the three.
  'rdl-none': [],
  'rdl-mg-mg': [d('078'), d('078')],
  'rdl-mg-msl': [d('078'), d('079')],
  'rdl-msl-msl': [d('079'), d('079')],
  'rdl-radar-mg': [d('080'), d('078')],
  'rdl-radar-msl': [d('080'), d('079')],
  'rdl-mg-msl-radar': [d('078'), d('079'), d('080')],
  // UN: the Raid squad's three (the Ion Porcupine, the Raven Interference, the Tarantula Carrier with its Load), and
  // other sets at about the same points.
  'un-raid': un.drones.map((x) => ({ ...x })),
  'un-ciws-ravenI-tfire-scout': [d('160'), d('166'), d('163'), d('164')],
  'un-ion-ravenI-scout-carrier': [d('543'), d('166'), d('164'), d('162')],
  'un-micro-ciws-ravenI-tfire': [d('161'), d('160'), d('166'), d('163')],
  'un-ravenI2-ciws-scout': [d('166'), d('166'), d('160'), d('164')],
  'un-ion-micro-tfire-carrier': [d('543'), d('161'), d('163'), d('162')],
  'un-tfire3-ravenI-carrier': [d('163'), d('163'), d('163'), d('166'), d('162')],
  'un-ion-ciws-micro': [d('543'), d('160'), d('161')],
};
const out = {};
for (const [name, drones] of Object.entries(SETS)) {
  const base = name.startsWith('rdl') ? rdl : un;
  const sq = { name, faction: base.faction, mechs: base.mechs.map((m) => ({ name: m.name, loadout: { ...m.loadout } })), drones };
  sq.points = pts(sq);
  out[name] = sq;
  console.log(`${name.padEnd(22)} ${sq.points}p  ${drones.map((x) => `${x.cardId}${x.backpack ? `+${x.backpack}` : ''}(${price(x.cardId) + price(x.backpack)})`).join(' ')}`);
}
writeFileSync(process.argv[2], JSON.stringify(out, null, 1));
