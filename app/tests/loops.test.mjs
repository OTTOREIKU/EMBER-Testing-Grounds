// Checks the alternating designation loops against rulebook 3.2.2, 3.5 and 3.6.1.
import { readFileSync, writeFileSync } from 'node:fs';

// Slice out the pure loop rules — playguide.ts's class body needs the DOM.
const srcUrl = new URL('../src/playguide.ts', import.meta.url);
const src = readFileSync(srcUrl, 'utf8');
const start = src.indexOf('export const LOOP_PHASES');
const end = src.indexOf('export interface GuideCallbacks');
if (start < 0 || end < 0) throw new Error('could not locate the loop rules in playguide.ts');
const tmp = new URL('./_loops.slice.ts', import.meta.url);
writeFileSync(tmp, 'type GameState = any;\ntype Side = any;\ntype Token = any;\n' + src.slice(start, end));
const { eligibleUnits, canAct, loopComplete, nextTurn, commandTokensFor } = await import(tmp.href);

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}, got ${g}`); }
};

const mech = (uid, side, dead = false) => ({ uid, side, kind: 'mech', label: `M${uid}`, partStates: dead ? { torso: 'destroyed' } : { torso: 'intact', chasis: 'intact' } });
const drone = (uid, side, dead = false) => ({ uid, side, kind: 'drone', label: `D${uid}`, partStates: { main: dead ? 'destroyed' : 'intact' } });
const proj = (uid, side) => ({ uid, side, kind: 'projectile', label: `P${uid}`, partStates: { main: 'intact' } });
const game = (tokens, script = {}, cmd = { blue: 9, red: 9 }) => ({
  tokens, commandTokens: cmd,
  script: { turn: 'blue', done: [], acted: [], commanded: [], passed: [], stage: '', mode: 'hotseat', seats: {}, ...script },
});
const ids = (list) => list.map((t) => t.uid).sort((a, b) => a - b);

console.log('Alternating designation loops — rulebook 3.2.2 / 3.5 / 3.6.1\n');

// Command Tokens: 1 per surviving Mech (3.2.1). A destroyed Mech generates none.
check('one command token per living mech', commandTokensFor(game([mech(1, 'blue'), mech(2, 'blue'), mech(3, 'red')]), 'blue'), 2);
check('a destroyed mech generates none', commandTokensFor(game([mech(1, 'blue'), mech(2, 'blue', true)]), 'blue'), 1);

// Command Phase targets Drones, and only while the side still holds a token.
const cmdBoard = [mech(1, 'blue'), drone(10, 'blue'), drone(11, 'blue'), drone(20, 'red')];
check('command offers this side\'s drones', ids(eligibleUnits(game(cmdBoard), 'Command', 'blue')), [10, 11]);
check('command offers nothing with no tokens', ids(eligibleUnits(game(cmdBoard, {}, { blue: 0, red: 9 }), 'Command', 'blue')), []);
check('an already commanded drone is not offered again', ids(eligibleUnits(game(cmdBoard, { commanded: [10] }), 'Command', 'blue')), [11]);
check('a destroyed drone is not offered', ids(eligibleUnits(game([mech(1, 'blue'), drone(10, 'blue', true), drone(11, 'blue')]), 'Command', 'blue')), [11]);

// A Drone commanded this round does not act again in the Automatic Phase (3.5).
check('automatic skips drones commanded this round', ids(eligibleUnits(game(cmdBoard, { commanded: [10] }), 'Automatic', 'blue')), [11]);
check('automatic ignores the command token pool', ids(eligibleUnits(game(cmdBoard, {}, { blue: 0, red: 0 }), 'Automatic', 'blue')), [10, 11]);
check('automatic skips drones that already acted', ids(eligibleUnits(game(cmdBoard, { acted: [11] }), 'Automatic', 'blue')), [10]);

// Delay Phase is projectiles and deployables only (3.6.2).
const delayBoard = [drone(10, 'blue'), proj(30, 'blue'), proj(31, 'blue'), proj(40, 'red')];
check('delay offers only projectiles', ids(eligibleUnits(game(delayBoard), 'Delay', 'blue')), [30, 31]);
check('delay skips ones that already acted', ids(eligibleUnits(game(delayBoard, { acted: [30] }), 'Delay', 'blue')), [31]);

// Passing takes a side out of the loop; the opponent may keep going alone.
const both = game([mech(1, 'blue'), mech(2, 'red'), drone(10, 'blue'), drone(20, 'red')]);
check('both sides can act at the start', [canAct(both, 'Command', 'blue'), canAct(both, 'Command', 'red')], [true, true]);
check('turn alternates normally', nextTurn(both, 'Command', 'blue'), 'red');

const redPassed = game([mech(1, 'blue'), mech(2, 'red'), drone(10, 'blue'), drone(11, 'blue'), drone(20, 'red')], { passed: ['red'] });
check('a passed side cannot act', canAct(redPassed, 'Command', 'red'), false);
check('the turn stays with the side still going', nextTurn(redPassed, 'Command', 'blue'), 'blue');
check('the loop is not over while one side can act', loopComplete(redPassed, 'Command'), false);

// The loop ends when nobody can act, whether by passing or by running dry.
check('both passed ends the loop', loopComplete(game([drone(10, 'blue'), drone(20, 'red')], { passed: ['blue', 'red'] }), 'Command'), true);
check('no eligible units ends the loop', loopComplete(game([mech(1, 'blue'), mech(2, 'red')]), 'Command'), true);
check('nextTurn returns null when the loop is done', nextTurn(game([mech(1, 'blue')]), 'Command', 'blue'), null);

// A board with no drones at all must not strand the Command Phase.
check('a droneless board completes immediately', loopComplete(game([mech(1, 'blue'), mech(2, 'red')]), 'Command'), true);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
