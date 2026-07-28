// Checks the card-in-play tally the Add tab subtracts from your owned copies.
import { readFileSync, writeFileSync } from 'node:fs';

// Slice out the counter — units.ts's other exports pull in GameData.
const srcUrl = new URL('../src/units.ts', import.meta.url);
const src = readFileSync(srcUrl, 'utf8');
const start = src.indexOf('export function deployedCardCounts');
const end = src.indexOf('export interface SmokePlacement');
if (start < 0 || end < 0) throw new Error('could not locate deployedCardCounts in units.ts');
const tmp = new URL('./_stock.slice.ts', import.meta.url);
writeFileSync(
  tmp,
  "type Token = any;\nconst PART_SLOTS = ['torso','chasis','leftHand','rightHand','backpack'];\n" + src.slice(start, end),
);
const { deployedCardCounts } = await import(tmp.href);

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}, got ${g}`); }
};
const counts = (tokens) => Object.fromEntries([...deployedCardCounts(tokens)].sort(([a], [b]) => a.localeCompare(b)));

const mech = (over = {}) => ({ kind: 'mech', mech: { torso: 'T1', chasis: 'C1', leftHand: 'L1', pilot: 'P1', ...over } });
const drone = (cardId, backpack) => ({ kind: 'drone', cardId, droneBackpack: backpack });

console.log('Cards in play vs cards owned\n');

check('an empty board counts nothing', counts([]), {});
check('a mech counts each of its Parts and its Pilot', counts([mech()]), { C1: 1, L1: 1, P1: 1, T1: 1 });

// Two mechs sharing a Torso must report 2, or the Add tab would offer a Part
// that is already on the table twice over.
check('duplicate Parts across mechs add up', counts([mech(), mech()]), { C1: 2, L1: 2, P1: 2, T1: 2 });

// An empty slot contributes nothing rather than an undefined key.
check('empty slots are skipped', counts([mech({ pilot: undefined, leftHand: undefined })]), { C1: 1, T1: 1 });
check('a mech never counts its own cardId', counts([{ ...mech(), cardId: 'T1' }]), { C1: 1, L1: 1, P1: 1, T1: 1 });

// Drones bring their own card plus an optional backpack, both real cards you own.
check('a drone counts its card', counts([drone('D1')]), { D1: 1 });
check('a drone counts its backpack too', counts([drone('D1', 'B1')]), { B1: 1, D1: 1 });
check('mechs and drones tally together', counts([mech(), drone('T1')]), { C1: 1, L1: 1, P1: 1, T1: 2 });

// A launched projectile is a token on the board like any other.
check('projectiles are counted', counts([{ kind: 'projectile', cardId: 'X1' }, { kind: 'projectile', cardId: 'X1' }]), { X1: 2 });

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
