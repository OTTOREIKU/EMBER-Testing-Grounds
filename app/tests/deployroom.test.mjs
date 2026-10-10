// A UNIT NOT YET DEPLOYED TAKES NO ROOM ON THE BOARD.
//
// Found playing the computer (AI-Lab challenge, games 1 to 3, 2026-10-10): the deployment question left out the Grids
// where the squad's own undeployed units were parked (the Mire offered no B1 and the Dune no A1 until the Mire was
// placed and A1 came free). rules.ts standingSpot counted every token's base, deployed or not, where its sibling
// spotsInGrid already passed over an undeployed one. A unit off the board stands nowhere (3.1.4), so every free Grid
// of the zone is offered to every unit still to place.
import { loadEngine, freshState, tableCommands } from './_engine.mjs';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}\n       got  ${g}`); }
};

console.log('A unit not yet deployed takes no room\n');

const { M, data } = await loadEngine('deployroom', ["export * as SEAT from '../src/seat';", "export * as TURN from '../src/turn';"]);
const { owed, newMind } = M.SEAT;
const [, vip] = data.solo.scenarios;
const run = (state, cmd) => {
  const v = M.C.check(data, state, cmd);
  if (v.ok) { M.C.apply(data, state, cmd); M.G.glueAfter(data, state, cmd); }
  return v;
};
const take = (state, d, id) => (d?.options.find((x) => x.id === id)?.commands ?? []).every((c) => run(state, c).ok);

// The VIP game to its deployment, as owed.test.mjs walks it.
M.L.setLocalSeat(null);
const s = freshState(M, data);
for (const cmd of tableCommands(M, data, { ...vip, secondaries: false })) M.C.perform(data, s, cmd);
for (const seat of ['s1', 's2']) {
  const sq = data.solo.squads[vip.seats[seat]];
  M.C.perform(data, s, { kind: 'importSquad', seat, name: sq.name, mechs: sq.mechs, drones: sq.drones });
}
M.C.perform(data, s, { kind: 'startMatch', seat: 's1' });
M.G.glueAfter(data, s, { kind: 'startMatch', seat: 's1' });
M.L.setLocalSeat('s1');
take(s, owed(data, s, 's1', newMind()), 'lock');
run(s, { kind: 'rollSetup', seat: 's1', hits: [1, 1] });
run(s, { kind: 'rollSetup', seat: 's2', hits: [0, 1] });
take(s, owed(data, s, 's1', newMind()), 'accept');
take(s, owed(data, s, 's1', newMind()), 'edge:black');
for (const seat of ['s1', 's2']) { const d = owed(data, s, seat, newMind()); take(s, d, d.options[0].id); }
take(s, owed(data, s, 's1', newMind()), 'done');

const su = () => M.SU.normaliseSetup(s.setup);
const first = M.SU.deployTurn(s, su(), data);
const dep = owed(data, s, first, newMind());
check('the deployment question is up', dep?.kind, 'setup.deploy');
const zone = new Set(M.TK.deployGrids(data.zoneData, s, su().edge[first]));
const waiting = M.SU.deployable(s, first, data);
const gridOf = (t) => `${Math.floor(t.col / 3)},${Math.floor(t.row / 3)}`;
// Where the squad's units wait before they are placed, inside its own zone.
const parked = [...new Set(waiting.map(gridOf))].filter((k) => zone.has(k));
check('the units waiting to be placed are parked inside the zone (the case that hid Grids)', parked.length > 0, true);

// Every unit is offered every parked Grid its base fits in once nothing deployed stands there (terrain alone decides).
const terrain = M.TURN.terrainOf(data, s);
const deployed = s.tokens.filter((t) => t.deployed !== false);
const missing = [];
for (const t of waiting) {
  for (const k of parked) {
    const [c, r] = k.split(',').map(Number);
    if (!M.R.standingSpot(c, r, t.size, t.aerial, terrain, deployed, t.uid)) continue;
    if (!dep.options.some((o) => o.facts?.uid === t.uid && `${o.facts.to.c},${o.facts.to.r}` === k)) missing.push(`${t.label} at ${k}`);
  }
}
check('every unit may be placed where a unit not yet deployed is parked', missing, []);
// And the spot finder itself: an undeployed unit's base takes no room, a deployed one's does.
const [a, b] = waiting;
const [ac, ar] = gridOf(b).split(',').map(Number);
check('standingSpot passes over a unit that is not deployed', !!M.R.standingSpot(ac, ar, a.size, a.aerial, terrain, s.tokens, a.uid), true);
check('and still stops at one that is', !!M.R.standingSpot(ac, ar, a.size, a.aerial, [], [{ ...b, deployed: true }], a.uid), a.size + b.size <= 3 && b.size < 3);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
