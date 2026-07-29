// Checks Task scoring and the end-of-game result (rulebook 5.2.4, 5.3.2, 5.3.3
// and the Low Value Unit rules on book p.82).
import { readFileSync, writeFileSync } from 'node:fs';

const src = readFileSync(new URL('../src/tasks.ts', import.meta.url), 'utf8');
const tmp = new URL('./_tasks.slice.ts', import.meta.url);
writeFileSync(tmp, src.replace(/^import[^\n]*\n/m, 'type Side = any;\ntype Token = any;\n'));
const T = await import(tmp.href);

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}, got ${g}`); }
};

// A unit sitting in Large Grid (c,r).
const unit = (uid, side, c, r, extra = {}) => ({
  uid, side, kind: 'mech', stance: 'offensive', col: c * 3 + 1, row: r * 3 + 1,
  partStates: { torso: 'intact', chasis: 'intact', leftHand: 'intact', rightHand: 'intact' }, ...extra,
});
const drone = (uid, side, c, r, extra = {}) => unit(uid, side, c, r, { kind: 'drone', partStates: { main: 'intact' }, ...extra });

console.log('Tasks and Victory Points\n');

// ---------- board references ----------

check('A1 is the top left grid', T.cellToGrid('A1'), { c: 0, r: 0 });
check('B2 reads as column B row 2', T.cellToGrid('B2'), { c: 1, r: 1 });
check('L12 is the far corner', T.cellToGrid('L12'), { c: 11, r: 11 });
check('lower case works', T.cellToGrid('c3'), { c: 2, r: 2 });
check('junk is refused', T.cellToGrid('nope'), null);
check('a unit inside the zone is found', T.inZone(unit(1, 'blue', 1, 1), ['B2', 'C3']), true);
check('and one outside is not', T.inZone(unit(1, 'blue', 5, 5), ['B2', 'C3']), false);

// ---------- Low Value Units ----------

check('a projectile is Low Value', T.isLowValue({ kind: 'projectile' }), true);
check('a mech is not', T.isLowValue({ kind: 'mech' }), false);
check('a tagged drone is', T.isLowValue({ kind: 'drone' }, () => true), true);
check('an untagged drone is not', T.isLowValue({ kind: 'drone' }, () => false), false);

// ---------- Control Zones (5.3.2) ----------

const ZONE = ['B2', 'C3'];
check('an empty zone is neutral', T.controlOf(ZONE, []), null);
check('a lone mech takes it', T.controlOf(ZONE, [unit(1, 'blue', 1, 1)]), 'blue');
check('a drone takes it too', T.controlOf(ZONE, [drone(1, 'red', 2, 2)]), 'red');
// A Shutdown Mech cannot hold a Zone, but it is still an enemy Unit inside it.
check('a shutdown mech alone holds nothing', T.controlOf(ZONE, [unit(1, 'blue', 1, 1, { stance: 'shutdown' })]), null);
check('but it still denies the zone to the enemy', T.controlOf(ZONE, [unit(1, 'blue', 1, 1, { stance: 'shutdown' }), unit(2, 'red', 2, 2)]), null);
check('any enemy unit contests it', T.controlOf(ZONE, [unit(1, 'blue', 1, 1), unit(2, 'red', 2, 2)]), null);
// Even a Low Value projectile counts as an enemy Unit inside the Zone.
check('an enemy projectile contests it', T.controlOf(ZONE, [unit(1, 'blue', 1, 1), unit(2, 'red', 2, 2, { kind: 'projectile' })]), null);
check('a friendly projectile does not hold it alone', T.controlOf(ZONE, [unit(1, 'blue', 1, 1, { kind: 'projectile' })]), null);
check('an undeployed unit is not in the zone', T.controlOf(ZONE, [unit(1, 'blue', 1, 1, { deployed: false })]), null);
check('two friendly units still take it', T.controlOf(ZONE, [unit(1, 'blue', 1, 1), drone(3, 'blue', 2, 2)]), 'blue');

// ---------- Main Task scoring ----------

const state = (over = {}) => ({ ...T.newTaskState(), ...over });
// Black Box: each Box in possession pays out every End Phase.
const boxes = state({
  items: [
    { id: 'bb1', kind: 'blackbox', zone: 'bravo', bearerUid: 1 },
    { id: 'bb2', kind: 'blackbox', zone: 'echo', bearerUid: 1 },
    { id: 'bb3', kind: 'blackbox', zone: 'golf', bearerUid: 2 },
    { id: 'bb4', kind: 'blackbox', zone: 'hotel' },
  ],
});
// Black Box cards read "End of Round 5", so they pay once at game end.
const BB = { family: 'blackbox', vp: 2, zones: [], fromRound: 1, cadence: 'at-end' };
const bbScore = T.scoreMain(BB, boxes, [unit(1, 'blue', 0, 0), unit(2, 'red', 5, 5)], 5, true);
check('black boxes pay the bearer', [bbScore.blue, bbScore.red], [4, 2]);
check('and a box lying on the ground pays nobody', bbScore.lines.length, 2);
// A bearer that has left the board takes its box out of the count.
const bbGone = T.scoreMain(BB, boxes, [unit(2, 'red', 5, 5)], 5, true);
check('a destroyed bearer scores nothing', [bbGone.blue, bbGone.red], [0, 2]);
// Nothing at all before the last Round, because the card only pays at the end.
const bbEarly = T.scoreMain(BB, boxes, [unit(1, 'blue', 0, 0), unit(2, 'red', 5, 5)], 3, false);
check('black boxes pay nothing mid-game', [bbEarly.blue, bbEarly.red], [0, 0]);

// Control: nothing before the round the card names, then every round after.
const zones = state({
  items: [
    { id: 'z1', kind: 'control', zone: 'alpha', control: 'blue' },
    { id: 'z2', kind: 'control', zone: 'bravo', control: 'blue' },
    { id: 'z3', kind: 'control', zone: 'golf', control: 'red' },
    { id: 'z4', kind: 'control', zone: 'echo', control: null },
  ],
});
// Control cards read "Beginning Round 2 ... per round".
const CTRL = { family: 'control', vp: 2, zones: [], fromRound: 2, cadence: 'per-round' };
const r1 = T.scoreMain(CTRL, zones, [], 1, false);
check('control pays nothing in round 1', [r1.blue, r1.red], [0, 0]);
const r2 = T.scoreMain(CTRL, zones, [], 2, false);
check('and starts paying in round 2', [r2.blue, r2.red], [4, 2]);
check('an uncaptured zone pays nobody', r2.lines.length, 2);

// Terminals: only the ones accessed this round.
const terms = state({
  items: [
    { id: 't1', kind: 'terminal', zone: 'bravo', accessed: 'red' },
    { id: 't2', kind: 'terminal', zone: 'echo', accessed: null },
    { id: 't3', kind: 'terminal', zone: 'hotel', accessed: 'red' },
  ],
});
const TERM = { family: 'terminal', vp: 2, zones: [], fromRound: 1, cadence: 'per-round' };
const tScore = T.scoreMain(TERM, terms, [], 1, false);
check('terminals pay whoever accessed them', [tScore.blue, tScore.red], [0, 4]);

// VIP: killing the enemy Commander pays once.
const VIP = { family: 'vip', vp: 10, zones: [], fromRound: 1, cadence: 'per-round' };
const vipAlive = T.scoreMain(VIP, state({ leader: { red: 9 } }), [unit(9, 'red', 0, 0)], 4, false);
check('a living commander pays nobody', [vipAlive.blue, vipAlive.red], [0, 0]);
const vipDead = T.scoreMain(VIP, state({ leader: { red: 9 } }), [], 4, false);
check('killing it pays the other side', [vipDead.blue, vipDead.red], [10, 0]);
check('with no commander named, nothing scores', T.scoreMain(VIP, state(), [], 4, false).blue, 0);

// ---------- end of game (5.2.4) ----------

const board = [
  unit(1, 'blue', 0, 0),
  unit(2, 'red', 5, 5, { partStates: { torso: 'intact', chasis: 'destroyed', leftHand: 'destroyed', rightHand: 'intact' } }),
];
check('more victory points wins', T.gameResult(state({ vp: { blue: 7, red: 3 } }), board).winner, 'blue');
check('and the other way round', T.gameResult(state({ vp: { blue: 1, red: 3 } }), board).winner, 'red');
// Level on points goes to surviving Mech Parts and Drones.
check('a tie goes to what is left standing', T.gameResult(state({ vp: { blue: 4, red: 4 } }), board).winner, 'blue');
check('and says so', T.gameResult(state({ vp: { blue: 4, red: 4 } }), board).why.includes('Mech Parts and Drones left'), true);
// Drones count as one each alongside surviving Parts.
const evenBoard = [unit(1, 'blue', 0, 0), unit(2, 'red', 5, 5), drone(3, 'red', 5, 5)];
check('drones count toward the tie-break', T.gameResult(state({ vp: { blue: 2, red: 2 } }), evenBoard).winner, 'red');
check('level on both is a draw', T.gameResult(state({ vp: { blue: 2, red: 2 } }), [unit(1, 'blue', 0, 0), unit(2, 'red', 5, 5)]).winner, null);

// ---------- saved state ----------

check('a fresh state has no points', T.newTaskState().vp, { blue: 0, red: 0 });
check('junk normalises to something usable', T.normaliseTasks(null).vp, { blue: 0, red: 0 });
check('negative points are refused', T.normaliseTasks({ vp: { blue: -5, red: 2 } }).vp, { blue: 0, red: 2 });
check('a bad side on a dial reads as neutral', T.normaliseTasks({ items: [{ id: 'x', kind: 'control', zone: 'a', control: 'green' }] }).items[0].control, null);
check('an unknown kind falls back to a black box', T.normaliseTasks({ items: [{ id: 'x', kind: 'wat', zone: 'a' }] }).items[0].kind, 'blackbox');
check('an item with no id is dropped', T.normaliseTasks({ items: [{ kind: 'terminal', zone: 'a' }] }).items, []);
check('a live state round-trips', T.normaliseTasks(terms).items.length, 3);


// ---------- Secondary Tasks (5.2.3) ----------

const ZCELLS = { echo: ['F6', 'G6'] };
const zcells = (z) => ZCELLS[z] ?? [];
const sec = (kind, vp, name = 'Task') => ({ id: 'x', name, vp, kind });
const withKills = (side, k) => state({ kills: { ...T.newTaskState().kills, [side]: { ...T.newKills(), ...k } } });

// Destroy a designated unit: pays as soon as it is off the board.
check('a destroyed target pays out', T.scoreSecondary(sec('destroy-designated', 5), 'blue', state({ secTarget: { blue: 9 } }), [], zcells, false).blue, 5);
check('a living target pays nothing', T.scoreSecondary(sec('destroy-designated', 5), 'blue', state({ secTarget: { blue: 9 } }), [unit(9, 'red', 0, 0)], zcells, false).blue, 0);

// Escort: only settles at the end, and only if the unit is still there.
check('a surviving escort pays at the end', T.scoreSecondary(sec('survive-designated', 3), 'blue', state({ secTarget: { blue: 4 } }), [unit(4, 'blue', 0, 0)], zcells, true).blue, 3);
check('but not before the end', T.scoreSecondary(sec('survive-designated', 3), 'blue', state({ secTarget: { blue: 4 } }), [unit(4, 'blue', 0, 0)], zcells, false).blue, 0);
check('and not if it died', T.scoreSecondary(sec('survive-designated', 3), 'blue', state({ secTarget: { blue: 4 } }), [], zcells, true).blue, 0);

// Annihilation: the printed value is per Mech, a Drone is worth 1.
check('annihilation counts mechs and drones', T.scoreSecondary(sec('per-kill', 2), 'red', withKills('red', { mechs: 3, drones: 2 }), [], zcells, false).red, 8);
check('with nothing killed it pays nothing', T.scoreSecondary(sec('per-kill', 2), 'red', state(), [], zcells, false).red, 0);

// Weapons Test: only what the designated unit destroyed.
check('weapons test counts its own kills', T.scoreSecondary(sec('per-kill-by-unit', 1), 'blue', state({ testKills: { blue: 4, red: 0 } }), [], zcells, false).blue, 4);

// Mercy: pays only if this side destroyed no enemy Mech at all.
check('mercy pays when no mech fell', T.scoreSecondary(sec('no-mech-lost', 2), 'blue', state(), [], zcells, true).blue, 2);
check('and nothing once one has', T.scoreSecondary(sec('no-mech-lost', 2), 'blue', withKills('blue', { mechs: 1 }), [], zcells, true).blue, 0);
check('and never before the end', T.scoreSecondary(sec('no-mech-lost', 2), 'blue', state(), [], zcells, false).blue, 0);

// Excavation Site: yours only, and Low Value Units are ignored either way.
const site = state({ zone: { blue: 'echo' } });
const mine = [unit(1, 'blue', 5, 5), unit(2, 'blue', 6, 5)];
check('holding the site alone pays', T.scoreSecondary(sec('hold-zone', 2), 'blue', site, mine, zcells, true).blue, 2);
check('an enemy in the site stops it', T.scoreSecondary(sec('hold-zone', 2), 'blue', site, [...mine, unit(3, 'red', 5, 5)], zcells, true).blue, 0);
check('an enemy projectile is ignored', T.scoreSecondary(sec('hold-zone', 2), 'blue', site, [...mine, unit(3, 'red', 5, 5, { kind: 'projectile' })], zcells, true).blue, 2);
check('an empty site pays nothing', T.scoreSecondary(sec('hold-zone', 2), 'blue', site, [], zcells, true).blue, 0);
check('and it only settles at the end', T.scoreSecondary(sec('hold-zone', 2), 'blue', site, mine, zcells, false).blue, 0);

// The kill ledger survives a reload.
check('a fresh ledger is empty', T.newKills(), { mechs: 0, drones: 0, partsAndDrones: 0 });
check('kills round-trip', T.normaliseTasks(withKills('blue', { mechs: 2, partsAndDrones: 5 })).kills.blue, { mechs: 2, drones: 0, partsAndDrones: 5 });
check('junk kills read as zero', T.normaliseTasks({ kills: { blue: { mechs: 'lots' } } }).kills.blue.mechs, 0);
check('a designated zone round-trips', T.normaliseTasks({ zone: { blue: 'echo' } }).zone.blue, 'echo');


// ---------- once-only payouts and the paid ledger ----------

// A kill bounty carries a key, and a keyed line that was already awarded is
// dropped, so Decapitation can never pay again next round.
const bounty = T.scoreSecondary(sec('destroy-designated', 5), 'blue', state({ secTarget: { blue: 9 } }), [], zcells, false);
check('a bounty line carries its key', bounty.lines[0].key, 'sec:blue:x');
check('an unpaid keyed line survives the filter', T.unpaidLines(bounty.lines, []).length, 1);
check('and a paid one is dropped', T.unpaidLines(bounty.lines, ['sec:blue:x']).length, 0);
const vipLine = T.scoreMain({ family: 'vip', vp: 10, zones: [], fromRound: 1, cadence: 'per-round' }, state({ leader: { red: 9 } }), [], 3, false);
check('the vip bounty carries a key too', vipLine.lines[0].key, 'vip:blue');
check('an unkeyed line always passes', T.unpaidLines([{ side: 'blue', vp: 2, why: 'x' }], ['anything']).length, 1);

// The counting cards only pay the difference since the last award.
const counted = state({
  kills: { ...T.newTaskState().kills, red: { mechs: 2, drones: 1, partsAndDrones: 3 } },
  paidKills: { ...T.newTaskState().paidKills, red: { mechs: 1, drones: 1, partsAndDrones: 2 } },
});
check('annihilation pays only new kills', T.scoreSecondary(sec('per-kill', 2), 'red', counted, [], zcells, false).red, 2);
const testCounted = state({ testKills: { blue: 5, red: 0 }, paidTestKills: { blue: 3, red: 0 } });
check('weapons test pays only new kills', T.scoreSecondary(sec('per-kill-by-unit', 1), 'blue', testCounted, [], zcells, false).blue, 2);

// ---------- the kill ledger itself ----------

// Combat reports a dead Drone as a destroyed Part AND a destroyed Unit, and the
// ledger must count it exactly once.
const led = T.newTaskState();
led.secTarget.blue = 7;
T.applyKill(led, { side: 'blue', uid: 7 }, { side: 'red', kind: 'drone' }, 'part');
T.applyKill(led, { side: 'blue', uid: 7 }, { side: 'red', kind: 'drone' }, 'unit');
check('a dead drone counts once', led.kills.blue.drones, 1);
check('and the test unit is credited once', led.testKills.blue, 1);
// A Mech loses a Part, then the Torso goes and the Unit follows.
T.applyKill(led, { side: 'blue', uid: 7 }, { side: 'red', kind: 'mech' }, 'part');
T.applyKill(led, { side: 'blue', uid: 7 }, { side: 'red', kind: 'mech' }, 'part');
T.applyKill(led, { side: 'blue', uid: 7 }, { side: 'red', kind: 'mech' }, 'unit');
check('mech parts and the mech both count', [led.kills.blue.mechs, led.kills.blue.partsAndDrones], [1, 3]);
check('the test unit is credited per part', led.testKills.blue, 3);
// A kill by anyone else credits the side but not the Test Unit.
T.applyKill(led, { side: 'blue', uid: 99 }, { side: 'red', kind: 'drone' }, 'unit');
check('another unit does not feed the test tally', led.testKills.blue, 3);
// Friendly fire and Low Value Units never enter the ledger.
T.applyKill(led, { side: 'blue', uid: 7 }, { side: 'blue', kind: 'mech' }, 'unit');
T.applyKill(led, { side: 'blue', uid: 7 }, { side: 'red', kind: 'projectile' }, 'unit');
check('friendly fire and projectiles are ignored', [led.kills.blue.mechs, led.kills.blue.drones], [1, 2]);
// The paid snapshot survives a reload.
check('paid ledgers round-trip', T.normaliseTasks({ paidKills: { blue: { mechs: 4 } }, paidTestKills: { blue: 2 } }).paidKills.blue.mechs, 4);
check('secTarget round-trips', T.normaliseTasks({ secTarget: { red: 12 } }).secTarget.red, 12);

// A Low Value Drone is worth nothing dead, exactly like a projectile.
T.applyKill(led, { side: 'blue', uid: 7 }, { side: 'red', kind: 'drone', lowValue: true }, 'unit');
check('a low value drone never enters the ledger', led.kills.blue.drones, 2);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
