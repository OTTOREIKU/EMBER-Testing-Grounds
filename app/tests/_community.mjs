// AI lab (tools/ai-lab/README.md): community squads (OTTO's Discord saves, 2026-10-04) into the shape a game of one's own takes
// (SoloSquad), checked against the card data: each card known, of the squad's allegiance or one anybody may hire,
// and priced as the setup dialog prices it.
//   node tests/_community.mjs <dir of exported squads (Watermelon's builder TeamData JSON)> <out.json> [more.json]
// `more.json` holds squads transcribed from screenshots, already in SoloSquad shape ({ "<name>": squad }).
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { loadEngine } from './_engine.mjs';

const [dir, out, more] = process.argv.slice(2);
const { M, data } = await loadEngine(`community-${process.pid}`, ["export * as SOLOSETUP from '../src/solosetup';"]);
const SLOTS = ['torso', 'chasis', 'leftHand', 'rightHand', 'backpack'];
const HIRED = new Set(['PD', 'COLLABORATION']);
const squads = {};
const notes = [];

function fromTeam(name, d) {
  const mechs = (d.mechs ?? []).map((m, i) => {
    const loadout = {};
    for (const slot of SLOTS) { const p = m.parts?.[slot]; const id = typeof p === 'string' ? p : p?.id; if (id) loadout[slot] = id; }
    if (m.pilot?.id) loadout.pilot = m.pilot.id;
    return { name: `${name} ${i + 1}`, loadout };
  });
  const drones = (d.drones ?? []).map((x) => ({ cardId: x.id, ...(x.backpack?.id ? { backpack: x.backpack.id } : {}) }));
  const tactics = (d.tacticCards ?? []).map((t) => (typeof t === 'string' ? t : t?.id)).filter(Boolean);
  return { name, faction: d.faction, points: 0, mechs, drones, ...(tactics.length ? { tactics } : {}), builderTotal: d.totalScore };
}

function check(name, sq) {
  const ids = [...sq.mechs.flatMap((m) => Object.values(m.loadout)), ...sq.drones.flatMap((x) => [x.cardId, x.backpack].filter(Boolean))];
  for (const id of ids) {
    const card = data.byId.get(id);
    if (!card) { notes.push(`${name}: no card ${id}`); continue; }
    const f = data.factionOf(card);
    if (f && f !== sq.faction && !HIRED.has(f)) notes.push(`${name}: ${id} (${M.D?.cardName ? M.D.cardName(card) : card.id}) is ${f}, the squad ${sq.faction}`);
  }
  for (const t of sq.tactics ?? []) if (!data.byId.get(t)) notes.push(`${name}: no Tactics Card ${t}`);
  sq.points = M.SOLOSETUP.soloSquadPoints(data, sq);
  if (sq.builderTotal !== undefined && sq.builderTotal !== sq.points) notes.push(`${name}: priced ${sq.points} here, ${sq.builderTotal} in the builder`);
}

for (const f of readdirSync(dir).filter((x) => x.endsWith('.json') && x !== 'squads.json' && !x.startsWith('more'))) {
  const name = f.replace(/\.json$/, '');
  const sq = fromTeam(name, JSON.parse(readFileSync(`${dir}/${f}`, 'utf8')));
  check(name, sq);
  squads[name] = sq;
}
if (more) {
  for (const [name, sq] of Object.entries(JSON.parse(readFileSync(more, 'utf8')))) {
    const s = { ...sq, points: 0 };
    check(name, s);
    squads[name] = s;
  }
}
writeFileSync(out, JSON.stringify(squads, null, 1));
for (const [name, sq] of Object.entries(squads)) console.log(`${name}: ${sq.faction} ${sq.points}p, ${sq.mechs.length} Mechs, ${sq.drones.length} Drones${sq.tactics ? `, cards ${sq.tactics.join(' ')}` : ''}`);
console.log(notes.length ? `NOTES\n  ${notes.join('\n  ')}` : 'every card known and legal');
