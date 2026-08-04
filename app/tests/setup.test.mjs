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
const world = (tokens, firstPlayer = 's1') => ({ tokens, round: { n: 1, phase: 0, firstPlayer } });

console.log('Pre-game setup\n');

// Only Hit icons decide the table-edge roll.
check('heavy and light hits both count', S.countHits([[{ type: 'heavyHit' }, { type: 'lightHit' }]]), 2);
check('lightning and eye are worth nothing', S.countHits([[{ type: 'lightning' }], [{ type: 'eye' }]]), 0);
check('a blank face is worth nothing', S.countHits([[]]), 0);
check('a double light hit face counts twice', S.countHits([[{ type: 'lightHit' }, { type: 'lightHit' }]]), 2);
// Hollow icons do nothing until a Stance upgrades them, and nobody has taken
// a Stance before the game has started.
check('a hollow hit is worth nothing in the roll-off', S.countHits([[{ type: 'lightHit', hollow: true }]]), 0);
check('and does not spoil the solid one beside it',
  S.countHits([[{ type: 'lightHit' }, { type: 'lightHit', hollow: true }]]), 1);

// More Hits goes first; the book gives no tie procedure, so a tie is unresolved.
const rolled = (s1, s2) => ({ ...S.newSetup(), rolls: { s1, s2 } });
check('more hits wins', S.firstPlayerFrom(rolled([2, 1], [1, 0])), 's1');
check('and the other way round', S.firstPlayerFrom(rolled([0, 0], [1, 1])), 's2');
check('a tie has no winner', S.firstPlayerFrom(rolled([1, 1], [2, 0])), null);
check('an unrolled side has no winner', S.firstPlayerFrom(rolled([2, 2], [])), null);
check('neither rolled means no winner', S.firstPlayerFrom(S.newSetup()), null);

// A saved setup has to survive a reload without losing where it had got to.
const live = { stage: 'deploy', rolls: { s1: [2], s2: [1] }, edge: { s1: 'black', s2: 'white' }, placed: { s1: 2, s2: 1 } };
check('a live setup round-trips', S.normaliseSetup(live), live);
check('junk is refused', S.normaliseSetup({ nope: 1 }).stage, 'map');
check('a bad stage falls back', S.normaliseSetup({ stage: 'wat' }).stage, 'map');
check('a fresh setup opens on the map stage', S.newSetup().stage, 'map');

// The battlefield is agreed first, then frozen for the rest of the game.
check('the map stage leaves it unlocked', S.battlefieldLocked(S.newSetup()), false);
for (const stage of ['roll', 'side', 'deploy', 'done']) {
  check(`the ${stage} stage locks it`, S.battlefieldLocked({ ...S.newSetup(), stage }), true);
}
check('no setup at all leaves it unlocked', S.battlefieldLocked(null), false);
check('and undefined too', S.battlefieldLocked(undefined), false);
check('a bad edge falls back', S.normaliseSetup({ edge: { s1: 'green' } }).edge.s1, 'white');
check('negative counts are refused', S.normaliseSetup({ placed: { s1: -3 } }).placed.s1, 0);
check('nothing at all reads as null', S.normaliseSetup(null), null);

// Projectiles are never deployed; they arrive when something launches them.
const mixed = world([unit(1, 's1', false), unit(2, 's1', false, 'projectile'), unit(3, 's2', false, 'drone')]);
check('projectiles are not deployable', S.deployable(mixed, 's1').map((t) => t.uid), [1]);
check('drones are', S.deployable(mixed, 's2').map((t) => t.uid), [3]);
check('a placed unit drops off the list', S.deployable(world([unit(1, 's1', true)]), 's1'), []);
// A token written before deployment existed has no flag and counts as on the board.
check('a legacy token counts as deployed', S.deployable(world([unit(1, 's1', undefined)]), 's1'), []);
check('and isDeployed agrees', S.isDeployed(unit(1, 's1', undefined)), true);

// The First Player places one, then the sides alternate.
const two = () => world([unit(1, 's1', false), unit(2, 's1', false), unit(3, 's2', false), unit(4, 's2', false)], 's1');
const at = (s1, s2) => ({ ...S.newSetup(), placed: { s1, s2 } });
check('the first player opens', S.deployTurn(two(), at(0, 0)), 's1');
check('then the other side', S.deployTurn(two(), at(1, 0)), 's2');
check('then back again', S.deployTurn(two(), at(1, 1)), 's1');
check('a red first player opens instead', S.deployTurn(world([unit(1, 's1', false), unit(3, 's2', false)], 's2'), at(0, 0)), 's2');

// Once a side is out of units, the other places everything it has left.
const lopsided = world([unit(1, 's1', false), unit(2, 's1', false), unit(3, 's2', true)], 's1');
check('a finished side is skipped', S.deployTurn(lopsided, at(1, 1)), 's1');
check('and keeps being skipped', S.deployTurn(lopsided, at(5, 1)), 's1');
check('an empty board has no turn', S.deployTurn(world([]), at(0, 0)), null);
check('all placed means no turn', S.deployTurn(world([unit(1, 's1', true)]), at(1, 0)), null);

// Deployment is over only when both sides are done.
check('waiting units mean it is not complete', S.deploymentComplete(two()), false);
check('all placed means complete', S.deploymentComplete(world([unit(1, 's1', true), unit(2, 's2', true)])), true);
check('a lone projectile does not hold it open', S.deploymentComplete(world([unit(9, 's1', false, 'projectile')])), true);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
