// Checks the alternating designation loops against rulebook 3.2.2, 3.5 and 3.6.1.
import { readFileSync, writeFileSync } from 'node:fs';

// The pure loop rules live in loop.ts; only its activation-order half needs
// TIMINGS, which these tests do not touch, so a stub keeps the slice light.
// commandGeneration is stubbed for the same reason - the real one reads a
// Mech's Torso card and would drag the whole card model in, and it returns
// exactly what the fixture's `gen` field says: Command Generation X, or 1.
const srcUrl = new URL('../src/loop.ts', import.meta.url);
const src = readFileSync(srcUrl, 'utf8');
const tmp = new URL('./_loops.slice.ts', import.meta.url);
const PRELUDE = [
  'type GameState = any;', 'type Side = any;', 'type Token = any;', 'type Timing = any;', 'type GameData = any;',
  'const TIMINGS: any[] = [];',
  'const commandGeneration = (_d: any, t: any) => t.gen ?? 1;',
].join('\n') + '\n';
writeFileSync(tmp, PRELUDE + src.replace(/^import[^\n]*\n/gm, ''));
const { eligibleUnits, canAct, loopComplete, nextTurn, commandTokensFor, droneActionWhy, droneMoveWhy } = await import(tmp.href);

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}, got ${g}`); }
};

const mech = (uid, side, dead = false, gen = 1) => ({ uid, side, kind: 'mech', label: `M${uid}`, gen, partStates: dead ? { torso: 'destroyed' } : { torso: 'intact', chasis: 'intact' } });
const drone = (uid, side, dead = false) => ({ uid, side, kind: 'drone', label: `D${uid}`, partStates: { main: dead ? 'destroyed' : 'intact' } });
const proj = (uid, side) => ({ uid, side, kind: 'projectile', label: `P${uid}`, partStates: { main: 'intact' } });
const game = (tokens, script = {}, cmd = { s1: 9, s2: 9 }) => ({
  tokens, commandTokens: cmd,
  script: { turn: 's1', done: [], acted: [], commanded: [], passed: [], stage: '', mode: 'hotseat', seats: {}, ...script },
});
const ids = (list) => list.map((t) => t.uid).sort((a, b) => a - b);

console.log('Alternating designation loops — rulebook 3.2.2 / 3.5 / 3.6.1\n');

// Command Tokens: 1 per surviving Mech by default (3.2.1). A destroyed Mech
// generates none, and a Torso with Command Generation X generates X INSTEAD of
// the default - "a different amount", not an extra one.
check('one command token per living mech', commandTokensFor(null, game([mech(1, 's1'), mech(2, 's1'), mech(3, 's2')]), 's1'), 2);
check('a destroyed mech generates none', commandTokensFor(null, game([mech(1, 's1'), mech(2, 's1', true)]), 's1'), 1);
check('command generation X replaces the default', commandTokensFor(null, game([mech(1, 's1', false, 4), mech(2, 's1')]), 's1'), 5);
check('a destroyed generator generates none', commandTokensFor(null, game([mech(1, 's1', true, 4), mech(2, 's1')]), 's1'), 1);

// Command Phase targets Drones, and only while the side still holds a token.
const cmdBoard = [mech(1, 's1'), drone(10, 's1'), drone(11, 's1'), drone(20, 's2')];
check('command offers this side\'s drones', ids(eligibleUnits(game(cmdBoard), 'Command', 's1')), [10, 11]);
check('command offers nothing with no tokens', ids(eligibleUnits(game(cmdBoard, {}, { s1: 0, s2: 9 }), 'Command', 's1')), []);
check('an already commanded drone is not offered again', ids(eligibleUnits(game(cmdBoard, { commanded: [10] }), 'Command', 's1')), [11]);
check('a destroyed drone is not offered', ids(eligibleUnits(game([mech(1, 's1'), drone(10, 's1', true), drone(11, 's1')]), 'Command', 's1')), [11]);

// A Drone commanded this round does not act again in the Automatic Phase (3.5).
check('automatic skips drones commanded this round', ids(eligibleUnits(game(cmdBoard, { commanded: [10] }), 'Automatic', 's1')), [11]);
check('automatic ignores the command token pool', ids(eligibleUnits(game(cmdBoard, {}, { s1: 0, s2: 0 }), 'Automatic', 's1')), [10, 11]);
check('automatic skips drones that already acted', ids(eligibleUnits(game(cmdBoard, { acted: [11] }), 'Automatic', 's1')), [10]);

// Delay Phase is projectiles and deployables only (3.6.2).
const delayBoard = [drone(10, 's1'), proj(30, 's1'), proj(31, 's1'), proj(40, 's2')];
check('delay offers only projectiles', ids(eligibleUnits(game(delayBoard), 'Delay', 's1')), [30, 31]);
check('delay skips ones that already acted', ids(eligibleUnits(game(delayBoard, { acted: [30] }), 'Delay', 's1')), [31]);

// Passing takes a side out of the loop; the opponent may keep going alone.
const both = game([mech(1, 's1'), mech(2, 's2'), drone(10, 's1'), drone(20, 's2')]);
check('both sides can act at the start', [canAct(both, 'Command', 's1'), canAct(both, 'Command', 's2')], [true, true]);
check('turn alternates normally', nextTurn(both, 'Command', 's1'), 's2');

const redPassed = game([mech(1, 's1'), mech(2, 's2'), drone(10, 's1'), drone(11, 's1'), drone(20, 's2')], { passed: ['s2'] });
check('a passed side cannot act', canAct(redPassed, 'Command', 's2'), false);
check('the turn stays with the side still going', nextTurn(redPassed, 'Command', 's1'), 's1');
check('the loop is not over while one side can act', loopComplete(redPassed, 'Command'), false);

// The loop ends when nobody can act, whether by passing or by running dry.
check('both passed ends the loop', loopComplete(game([drone(10, 's1'), drone(20, 's2')], { passed: ['s1', 's2'] }), 'Command'), true);
check('no eligible units ends the loop', loopComplete(game([mech(1, 's1'), mech(2, 's2')]), 'Command'), true);
check('nextTurn returns null when the loop is done', nextTurn(game([mech(1, 's1')]), 'Command', 's1'), null);

// A board with no drones at all must not strand the Command Phase.
check('a droneless board completes immediately', loopComplete(game([mech(1, 's1'), mech(2, 's2')]), 'Command'), true);

// The icon lock (3.2.2 ② / 3.5): a Command performs COMMAND-icon Actions or a
// Move; the Automatic Phase performs AUTOMATIC Actions and nothing else. Both
// starter drones carry only Automatic Actions, and before this lock they were
// firing them off Commands and moving in the Automatic Phase.
check('a Command-icon Action is legal on a Command', droneActionWhy('Command', { speed: 'command' }), null);
check('an Automatic Action is refused on a Command', typeof droneActionWhy('Command', { speed: 'auto' }), 'string');
check('an unmarked Action is refused on a Command', typeof droneActionWhy('Command', {}), 'string');
check('an Automatic Action is legal in the Automatic Phase', droneActionWhy('Automatic', { speed: 'auto' }), null);
check('a Command-icon Action is refused in the Automatic Phase', typeof droneActionWhy('Automatic', { speed: 'command' }), 'string');
check('a Passive is never the activation\'s business', droneActionWhy('Automatic', { speed: 'passive' }), null);
check('a Commanded Drone may move', droneMoveWhy('Command'), null);
check('the Automatic Phase has no Movement in it', typeof droneMoveWhy('Automatic'), 'string');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
