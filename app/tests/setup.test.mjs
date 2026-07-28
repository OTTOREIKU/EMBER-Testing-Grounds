// Checks pre-game setup: the table-edge roll and the deployment alternation
// (rulebook 3.1.2 and 3.1.4).
import { readFileSync, writeFileSync } from 'node:fs';

const src = readFileSync(new URL('../src/setup.ts', import.meta.url), 'utf8');
const tmp = new URL('./_setup.slice.ts', import.meta.url);
writeFileSync(tmp, src.replace(/^import[^\n]*\n/m, 'type GameState = any;\ntype Side = any;\ntype Token = any;\n'));
const S = await import(tmp.href);

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}, got ${g}`); }
};

const unit = (uid, side, deployed, kind = 'mech') => ({ uid, side, kind, deployed, label: `u${uid}` });
const world = (tokens, firstPlayer = 'blue') => ({ tokens, round: { n: 1, phase: 0, firstPlayer } });

console.log('Pre-game setup\n');

// Only Hit icons decide the table-edge roll.
check('heavy and light hits both count', S.countHits([[{ type: 'heavyHit' }, { type: 'lightHit' }]]), 2);
check('lightning and eye are worth nothing', S.countHits([[{ type: 'lightning' }], [{ type: 'eye' }]]), 0);
check('a blank face is worth nothing', S.countHits([[]]), 0);
check('a double light hit face counts twice', S.countHits([[{ type: 'lightHit' }, { type: 'lightHit' }]]), 2);

// More Hits goes first; the book gives no tie procedure, so a tie is unresolved.
const rolled = (blue, red) => ({ ...S.newSetup(), rolls: { blue, red } });
check('more hits wins', S.firstPlayerFrom(rolled([2, 1], [1, 0])), 'blue');
check('and the other way round', S.firstPlayerFrom(rolled([0, 0], [1, 1])), 'red');
check('a tie has no winner', S.firstPlayerFrom(rolled([1, 1], [2, 0])), null);
check('an unrolled side has no winner', S.firstPlayerFrom(rolled([2, 2], [])), null);
check('neither rolled means no winner', S.firstPlayerFrom(S.newSetup()), null);

// A saved setup has to survive a reload without losing where it had got to.
const live = { stage: 'deploy', rolls: { blue: [2], red: [1] }, edge: { blue: 'black', red: 'white' }, placed: { blue: 2, red: 1 } };
check('a live setup round-trips', S.normaliseSetup(live), live);
check('junk is refused', S.normaliseSetup({ nope: 1 }).stage, 'roll');
check('a bad stage falls back', S.normaliseSetup({ stage: 'wat' }).stage, 'roll');
check('a bad edge falls back', S.normaliseSetup({ edge: { blue: 'green' } }).edge.blue, 'white');
check('negative counts are refused', S.normaliseSetup({ placed: { blue: -3 } }).placed.blue, 0);
check('nothing at all reads as null', S.normaliseSetup(null), null);

// Projectiles are never deployed; they arrive when something launches them.
const mixed = world([unit(1, 'blue', false), unit(2, 'blue', false, 'projectile'), unit(3, 'red', false, 'drone')]);
check('projectiles are not deployable', S.deployable(mixed, 'blue').map((t) => t.uid), [1]);
check('drones are', S.deployable(mixed, 'red').map((t) => t.uid), [3]);
check('a placed unit drops off the list', S.deployable(world([unit(1, 'blue', true)]), 'blue'), []);
// A token written before deployment existed has no flag and counts as on the board.
check('a legacy token counts as deployed', S.deployable(world([unit(1, 'blue', undefined)]), 'blue'), []);
check('and isDeployed agrees', S.isDeployed(unit(1, 'blue', undefined)), true);

// The First Player places one, then the sides alternate.
const two = () => world([unit(1, 'blue', false), unit(2, 'blue', false), unit(3, 'red', false), unit(4, 'red', false)], 'blue');
const at = (blue, red) => ({ ...S.newSetup(), placed: { blue, red } });
check('the first player opens', S.deployTurn(two(), at(0, 0)), 'blue');
check('then the other side', S.deployTurn(two(), at(1, 0)), 'red');
check('then back again', S.deployTurn(two(), at(1, 1)), 'blue');
check('a red first player opens instead', S.deployTurn(world([unit(1, 'blue', false), unit(3, 'red', false)], 'red'), at(0, 0)), 'red');

// Once a side is out of units, the other places everything it has left.
const lopsided = world([unit(1, 'blue', false), unit(2, 'blue', false), unit(3, 'red', true)], 'blue');
check('a finished side is skipped', S.deployTurn(lopsided, at(1, 1)), 'blue');
check('and keeps being skipped', S.deployTurn(lopsided, at(5, 1)), 'blue');
check('an empty board has no turn', S.deployTurn(world([]), at(0, 0)), null);
check('all placed means no turn', S.deployTurn(world([unit(1, 'blue', true)]), at(1, 0)), null);

// Deployment is over only when both sides are done.
check('waiting units mean it is not complete', S.deploymentComplete(two()), false);
check('all placed means complete', S.deploymentComplete(world([unit(1, 'blue', true), unit(2, 'red', true)])), true);
check('a lone projectile does not hold it open', S.deploymentComplete(world([unit(9, 'blue', false, 'projectile')])), true);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
