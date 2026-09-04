// Checks squad legality now that PD and the White Dwarf collaboration are
// mercenary factions that may serve alongside any allegiance.
import { readFileSync, writeFileSync } from 'node:fs';

const src = readFileSync(new URL('../src/units.ts', import.meta.url), 'utf8');
const start = src.indexOf('// Factions that hire out');
const end = src.indexOf('export function pilotCard');
if (start < 0 || end < 0) throw new Error('could not locate factionProblems in units.ts');
const tmp = new URL('./_faction.slice.ts', import.meta.url);
writeFileSync(
  tmp,
  `type GameData = any;\ntype Token = any;\ntype Card = any;\ntype FactionProblem = any;
const cardName = (c) => c.name;
const tokenCards = (data, t) => t.cards;
const tokenFactions = (data, t) => ({ factions: [...new Set(t.cards.map((c) => c.card.faction).filter(Boolean))] });
` + src.slice(start, end),
);
const { factionProblems, MERCENARY_FACTIONS } = await import(tmp.href);

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}, got ${g}`); }
};

const data = { factionOf: (c) => c.faction };
// A unit built from parts of the listed factions.
const unit = (label, factions, kind = 'mech') => ({
  label,
  kind,
  cards: factions.map((f, i) => ({ slot: `s${i}`, card: { name: `${label}-${i}`, faction: f } })),
});
const kinds = (tokens) => factionProblems(data, tokens).map((p) => p.kind);

console.log('Squad faction legality\n');

check('the mercenary list is PD and the collaboration', [...MERCENARY_FACTIONS].sort(), ['COLLABORATION', 'PD']);

// A single allegiance is always fine.
check('one faction is legal', kinds([unit('a', ['RDL']), unit('b', ['RDL'])]), []);
check('a GoF squad is legal', kinds([unit('a', ['GOF']), unit('b', ['GOF'])]), []);

// Mercenaries hire out to anyone.
check('PD alongside RDL is legal', kinds([unit('a', ['RDL']), unit('m', ['PD'])]), []);
check('PD alongside UN is legal', kinds([unit('a', ['UN']), unit('m', ['PD'])]), []);
check('PD alongside GoF is legal', kinds([unit('a', ['GOF']), unit('m', ['PD'])]), []);
check('White Dwarf alongside RDL is legal', kinds([unit('a', ['RDL']), unit('w', ['COLLABORATION'])]), []);
check('both mercenaries at once is legal', kinds([unit('a', ['UN']), unit('m', ['PD']), unit('w', ['COLLABORATION'])]), []);
check('an all-mercenary squad is legal', kinds([unit('m', ['PD']), unit('w', ['COLLABORATION'])]), []);

// Two real allegiances is still illegal, mercenaries or not.
check('RDL with UN is illegal', kinds([unit('a', ['RDL']), unit('b', ['UN'])]), ['mixed-squad']);
check('RDL with GoF is illegal', kinds([unit('a', ['RDL']), unit('b', ['GOF'])]), ['mixed-squad']);
check('UN with GoF is illegal', kinds([unit('a', ['UN']), unit('b', ['GOF'])]), ['mixed-squad']);
check('mercenaries do not launder a mixed squad', kinds([unit('a', ['RDL']), unit('b', ['UN']), unit('m', ['PD'])]), ['mixed-squad']);
check(
  'the warning names only the allegiances',
  factionProblems(data, [unit('a', ['RDL']), unit('b', ['UN']), unit('m', ['PD'])])[0].detail.includes('PD'),
  false,
);

// A Mech is still built from one faction's Parts, mercenary or not.
// An RDL+UN mech puts both allegiances into the squad, so both rules fire.
check('a mixed mech is still illegal', kinds([unit('a', ['RDL', 'UN'])]), ['mixed-mech', 'mixed-squad']);
check('a mech mixing in a mercenary part is illegal', kinds([unit('a', ['RDL', 'PD'])]), ['mixed-mech']);
check('a mech of pure mercenary parts is fine', kinds([unit('a', ['PD', 'PD'])]), []);
// Both problems can fire at once, and the mech one comes first.
check('a mixed mech in a mixed squad reports both', kinds([unit('a', ['RDL', 'GOF']), unit('b', ['UN'])]), ['mixed-mech', 'mixed-squad']);

// Drones carry a faction too and count towards the squad.
check('a drone can break the squad rule', kinds([unit('a', ['RDL']), unit('d', ['UN'], 'drone')]), ['mixed-squad']);
check('a mercenary drone cannot', kinds([unit('a', ['RDL']), unit('d', ['PD'], 'drone')]), []);
// A part with no determinable faction is ignored rather than treated as a clash.
check('unknown factions are ignored', kinds([unit('a', ['RDL', null]), unit('b', ['RDL'])]), []);

// ---------- 5.1's third rule: the same Pilot cannot be seated twice ----------
//
// The ID is the pilot CARD, so two Mechs carrying the same t.mech.pilot are
// the case. Read off the token's live pilot field, the same key pilotCard uses.
console.log('\nPilot IDs');
const piloted = (label, pilot) => ({ ...unit(label, ['RDL']), mech: { pilot } });
check('two different pilots are legal', kinds([piloted('a', 'FPA-05'), piloted('b', 'FPA-04')]), []);
check('the same pilot twice is illegal', kinds([piloted('a', 'FPA-05'), piloted('b', 'FPA-05')]), ['duplicate-pilot']);
check('and the report names both Mechs',
  factionProblems(data, [piloted('a', 'FPA-05'), piloted('b', 'FPA-05')])[0].detail.includes('a and b'), true);
check('a pilotless sandbox Mech collides with nobody', kinds([piloted('a', ''), piloted('b', ''), unit('c', ['RDL'])]), []);
check('three seats of one pilot are still one problem', kinds([piloted('a', 'X'), piloted('b', 'X'), piloted('c', 'X')]), ['duplicate-pilot']);
check('a drone does not seat a pilot', kinds([piloted('a', 'X'), { ...unit('d', ['RDL'], 'drone'), mech: { pilot: 'X' } }]), []);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
