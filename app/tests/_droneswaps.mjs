// AI lab (tools/ai-lab/README.md): the single swaps (2026-10-06), after _dronesets.mjs (OTTO, 2026-10-05: "test more drone compositions for both RDL and UN to see if using combinations of drones
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
  // UN single swaps from the Raid's three (Ion Porcupine 543, Raven Interference 166, Tarantula Carrier 162 with
  // its Load 083): each changes one thing, so the study says which of the three is worth least to the computer.
  'un-swap-load-for-scout': [d('543'), d('166'), d('162'), d('164')],
  'un-swap-carrier-for-ciws': [d('543'), d('166'), d('160')],
  'un-swap-raven-for-micro': [d('543'), d('161'), d('162', '083')],
  'un-swap-ion-for-ciws-scout': [d('160'), d('166'), d('162', '083'), d('164')],
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
