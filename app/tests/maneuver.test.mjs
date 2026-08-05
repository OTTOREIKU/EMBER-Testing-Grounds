// Maneuver Value and the Mobility Stance doubling (rulebook 4.1, 3.4, 4.3.1).
//
// Mobility doubles "the Movement Range for Maneuver", and Maneuver is Mech-only:
// only a Mech generates a Maneuver Tick, the Maneuver Value is printed on a
// Chassis Card, and 4.3.1 lists a Drone's movement separately as a Command
// Action. Doubling a Drone's printed Move moved 18 of the 44 Drones at twice
// their range, so this is pinned.
import { readFileSync, writeFileSync } from 'node:fs';

const src = readFileSync(new URL('../src/units.ts', import.meta.url), 'utf8');
const start = src.indexOf('export function maneuverRange');
const end = src.indexOf('export function initiativeFor');
if (start < 0 || end < 0) throw new Error('could not locate maneuverRange in units.ts');
const tmp = new URL('./_maneuver.slice.ts', import.meta.url);
writeFileSync(tmp, 'type GameData = any;\ntype Token = any;\n' + src.slice(start, end));
const { maneuverRange } = await import(tmp.href);

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}, got ${g}`); }
};

const data = {
  byId: new Map([
    ['CH1', { id: 'CH1', move: 1 }],
    ['CH2', { id: 'CH2', move: 2 }],
    ['DRN', { id: 'DRN', move: 6 }],
    ['NOMOVE', { id: 'NOMOVE' }],
  ]),
};
const mech = (chasis, stance) => ({ kind: 'mech', stance, mech: { chasis }, cardId: 'ignored' });
const drone = (stance, cardId = 'DRN') => ({ kind: 'drone', stance, cardId });

console.log('Maneuver Value and Mobility Stance\n');

// A Mech reads its Chassis Card, and Mobility doubles it.
check('a mech maneuvers on its chassis value', maneuverRange(data, mech('CH2', 'offensive')), 2);
check('and mobility stance doubles that', maneuverRange(data, mech('CH2', 'mobility')), 4);
check('the common maneuver 1 doubles to 2', maneuverRange(data, mech('CH1', 'mobility')), 2);
check('defensive stance changes nothing', maneuverRange(data, mech('CH2', 'defensive')), 2);
check('nor does shutdown', maneuverRange(data, mech('CH2', 'shutdown')), 2);
check('a chassis with no printed move is 0', maneuverRange(data, mech('NOMOVE', 'mobility')), 0);
check('a mech with no chassis at all is 0', maneuverRange(data, { kind: 'mech', stance: 'mobility', mech: {} }), 0);

// A Drone reads its own card and is NEVER doubled: it has no Chassis Card, no
// Maneuver Tick and no Maneuver Value, so there is nothing for 4.1 to double.
check('a drone moves its printed range', maneuverRange(data, drone('offensive')), 6);
check('and mobility stance does NOT double it', maneuverRange(data, drone('mobility')), 6);
check('a defensive drone is unchanged too', maneuverRange(data, drone('defensive')), 6);
// Projectiles are in the same boat as Drones on this.
check('a mobility projectile is not doubled', maneuverRange(data, { kind: 'projectile', stance: 'mobility', cardId: 'DRN' }), 6);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
