// A Detonation owed, and a seat that answers it (rulebook 4.7.4 to 4.7.6; FAQ
// M6, M18, M19; AI-OPPONENT-PLAN.md, M8.2d).
//
// Some units blow up of their own accord: a Grenade as it lands, a Mine a unit
// walks onto, a Pholcus that Unfolds among units or finds an enemy in reach, a
// Zealot as it is destroyed. The Match Centre shows each to the player whose
// unit it is, in a panel of its own, and keeps the list of who a blast has
// already taken in that panel. A computer seat is asked by owed(): one
// question, `blast.resolve`, read off the same board (units.ts) and the same
// reading of what a blast may take (turn.ts detonationReading), with the list
// in the seat's own memory. Until this was built the seam launched none of
// these Projectiles, and a squad that carried them left them at home.
//
// Each way the debt arises is staged on the real engine: who is asked, what
// the answers send, and what is left when they are taken. Then whole games.
import { botTable, loadEngine, tableAtRoundOne } from './_engine.mjs';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}\n       got  ${g}`); }
};

console.log('A Detonation owed\n');

const { M, data } = await loadEngine('seatblast', ["export * as SEAT from '../src/seat';", "export * as TURN from '../src/turn';", "export * as AI from '../src/ai/index';"]);
const { owed, newMind } = M.SEAT;
const T = M.TURN;
const clone = (x) => JSON.parse(JSON.stringify(x));
const src = async (f) => (await import('node:fs')).readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

// UN: a Mech with a Grenade Pod on a Freehand arm, a Stun Grenade in its Torso
// and a Pholcus rack on its back; a second Mech; a Raven, which flies. RDL: a
// Mech with a Rocket Launcher and a Mine Layer; a second with an AMS.
data.solo.squads['t-grenades'] = {
  name: 'Grenadiers', faction: 'UN', points: 0,
  mechs: [
    { name: 'Wolf', loadout: { torso: '091', chasis: '099', leftHand: '108', rightHand: '541', backpack: '082', pilot: 'LPA-23-2' } },
    { name: 'Cat', loadout: { torso: '539', chasis: '099', leftHand: '540', rightHand: '541', backpack: '538', pilot: 'LPA-23-2' } },
  ],
  drones: [{ cardId: '166' }],
};
data.solo.squads['t-sappers'] = {
  name: 'Sappers', faction: 'RDL', points: 0,
  mechs: [
    { name: 'Mire', loadout: { torso: '014', chasis: '020', leftHand: '056', rightHand: '033', backpack: '006', pilot: 'FPA-63' } },
    // (The Dune's Torso carries a Smoke Grenade: launched too since M8.2c, which is seatsmoke.test's.)
    { name: 'Dune', loadout: { torso: '016', chasis: '534', leftHand: '535', rightHand: '536', backpack: '003', pilot: 'FPA-04-2' } },
  ],
  drones: [],
};
const scenario = { ...data.solo.scenarios[0], id: 't-blast', seats: { s1: 't-grenades', s2: 't-sappers' } };

const run = (state, cmd) => {
  const v = M.C.check(data, state, cmd);
  if (v.ok) { M.C.apply(data, state, cmd); M.G.glueAfter(data, state, cmd); }
  return v;
};
const sendAll = (state, commands) => commands.map((c) => run(state, c).ok);
const ids = (d) => (d ? d.options.map((o) => o.id) : null);
const asked = (state, minds = {}) => ['s1', 's2'].map((seat) => owed(data, state, seat, minds[seat] ?? newMind())?.kind ?? null);
const name = (t) => (t.cardId === '166' ? 'Raven' : t.label);
const gridOf = (t) => [Math.floor(t.col / 3), Math.floor(t.row / 3)];

const base = (() => {
  const t = tableAtRoundOne(M, data, scenario);
  if (t.refused.length) throw new Error(t.refused.map((r) => `${r.kind}: ${r.why}`).join('; '));
  return t.state;
})();
// The table at a phase, every unit where the test wants it; with no terrain
// unless the test asks for the battlefield.
const stage = (phase, { terrain = false } = {}) => {
  const s = clone(base);
  if (!terrain) s.map = 'none';
  const U = Object.fromEntries(s.tokens.map((t) => [name(t), t]));
  const at = (t, c, r, f) => { t.col = c * 3; t.row = r * 3; if (f !== undefined) t.facing = f; };
  at(U.Wolf, 5, 5, 2); at(U.Cat, 0, 0, 2); at(U.Raven, 0, 2, 2); at(U.Mire, 5, 7, 0); at(U.Dune, 11, 11, 0);
  s.round.phase = phase; s.script.stage = `1:${phase}`; s.script.acted = []; s.script.passed = []; s.script.opp = null;
  if (phase >= 2) { s.script.revealed = ['s1', 's2']; for (const t of s.tokens) if (t.kind === 'mech') t.timing = 'firing'; }
  const turnOf = (mech, timing) => {
    mech.timing = timing ?? mech.timing;
    s.script.acted = s.tokens.filter((x) => x.kind === 'mech' && x.uid !== mech.uid).map((x) => x.uid);
    s.script.opp = null;
    return M.G.opportunity(data, s);
  };
  const activate = (unit) => { s.script.opp = M.TY.newOpportunity(unit.uid, undefined); return s.script.opp; };
  // A unit put on the board by hand: a Projectile that has landed, a Drone.
  const put = (cardId, side, c, r, extra = {}) => {
    const t = { ...M.U.makeDroneToken(s, data, data.byId.get(cardId), side), col: c * 3 + 1, row: r * 3 + 1, facing: 0, ...extra };
    s.tokens.push(t);
    return t;
  };
  return { s, U, at, turnOf, activate, put };
};
// One Explosion taken as a driver takes it (driver.ts attack): what goes
// before it is sent, a blast on every unit in Range is remembered, and the
// attack's end removes a Projectile, or a unit whose Action is a Detonation,
// unless it is held (botcombat.ts afterAttack). No die is thrown here.
const explode = (s, mind, o) => {
  const a = o.run.args;
  const sent = sendAll(s, a.before ?? []);
  if (a.blast) mind.blast = { uid: a.uid, actionId: a.actionId, hit: [...(mind.blast?.uid === a.uid ? mind.blast.hit : []), a.targetUid] };
  const by = s.tokens.find((t) => t.uid === a.uid);
  const spent = by && (by.kind === 'projectile' || T.actionOf(data, s, by, a.actionId)?.type === 'Detonation');
  if (spent && !a.hold) run(s, { kind: 'despawn', seat: by.side, uid: by.uid, targetUid: by.uid });
  return sent;
};
M.L.setLocalSeat('s1');

// ---------- the cards ----------
{
  const act = (id, n = 0) => data.byId.get(id).actions[n];
  const scope = (a) => M.U.explosionScope(a, data.actionTranslation(a.id)?.english ?? undefined);
  check('the cards are what the test means them to be: three Immediate Projectiles (a blast on every unit in the Grid, a blast on one enemy, an effect), a Delayed blast on every unit in Range, a Mine, a Pholcus that Unfolds',
    [!!M.U.immediateDetonation(data.byId.get('154')), scope(act('154')), act('154').range,
      !!M.U.immediateDetonation(data.byId.get('267')), scope(act('267')),
      !!M.U.immediateDetonation(data.byId.get('155')), (act('155').yellowDice ?? 0) + (act('155').redDice ?? 0),
      !!M.U.immediateDetonation(data.byId.get('ZHAM-004')), scope(act('ZHAM-004')), act('ZHAM-004').range, act('ZHAM-004').type,
      scope(act('074')), act('074').type, !!M.U.immediateDetonation(data.byId.get('156')), scope(act('167'))],
    [true, 'all', 0, true, 'single', true, 0, false, 'all', 1, 'Delay', 'all', 'Passive', false, 'single']);
  check('an effect Detonation names its Token on the card: the Stun Grenade hands out Fire Control Interference, to what it can see; a card that damages names none',
    [M.U.detonationToken(act('155')), M.U.detonationToken(act('154')), M.U.detonationToken(act('267')), M.U.detonationToken(act('156'))],
    [{ statusId: 'fci', sight: true }, null, null, null]);
  check('and a rule that names no Token it knows, or the name of something every object has, reads as none (never a function off the table)',
    [M.U.detonationToken({ id: 'x', gameRules: [{ effects: [{ type: 'detonation', damage: 'none', utility: 'constructor', target: { selection: 'all' } }] }] }),
      M.U.detonationToken({ id: 'x', gameRules: [{ effects: [{ type: 'detonation', damage: 'none', utility: 'toString', target: { selection: 'all' } }] }] }),
      M.U.detonationToken({ id: 'x', gameRules: [{ effects: [{ type: 'detonation', damage: 'explosion', utility: 'fire_control_interference', target: { selection: 'all' } }] }] }),
      M.U.detonationToken({ id: 'x', gameRules: [{ effects: [{ type: 'detonation', damage: 'none', utility: 'fire_control_interference', target: { selection: 'chosen' } }] }] })],
    [null, null, null, null]);
  check('whether it reaches only what the Projectile can see is the rule\'s own word, or the printed one: either says so, and with neither it reaches everything in Range',
    [M.U.detonationToken({ id: 'x', gameRules: [{ effects: [{ type: 'detonation', damage: 'none', utility: 'fire_control_interference', target: { selection: 'all', requireLosToSource: true } }] }] }),
      M.U.detonationToken({ id: 'x', description: { en: 'All units within range and line of sight gain 1 Token.' }, gameRules: [{ effects: [{ type: 'detonation', damage: 'none', utility: 'fire_control_interference', target: { selection: 'all' } }] }] }),
      M.U.detonationToken({ id: 'x', gameRules: [{ effects: [{ type: 'detonation', damage: 'none', utility: 'fire_control_interference', target: { selection: 'all' } }] }] })],
    [{ statusId: 'fci', sight: true }, { statusId: 'fci', sight: true }, { statusId: 'fci', sight: false }]);
}

// ---------- a Grenade: a blast on every unit in its Grid, as it lands ----------
{
  const { s, U, at, turnOf } = stage(2);
  // The Raven stands in the Mire's Grid: one of the launcher's own squad.
  at(U.Raven, 5, 7, 0);
  check('with nothing landed nobody is asked about a blast', asked(s), [null, null]);
  turnOf(U.Wolf, 'projectile');
  const d = owed(data, s, 's1', newMind());
  const launches = d.options.filter((o) => o.tags[0] === 'launch');
  const by = (id) => launches.filter((o) => o.facts.cardId === id);
  check('THE GRENADES ARE OFFERED: the M7 and the Stun Grenade at every Landing Point in their Range, where the seam launched neither',
    [by('154').length, by('155').length, by('154').every((o) => o.facts.strike === 0), by('155').every((o) => o.facts.strike === 1)], [25, 25, true, true]);
  const shot = by('154').find((o) => o.facts.to.c === 5 && o.facts.to.r === 7);
  check('a Grenade launched into a Grid is the Action\'s payment and the launch, and nothing else', [shot.commands.map((c) => c.kind), sendAll(s, shot.commands)], [['performAction', 'launch'], [true, true]]);
  const grenade = s.tokens.find((t) => t.cardId === '154');
  check('IT IS OWED ITS DETONATION AT ONCE, and its owner is asked: the other squad waits, and so does the rest of the turn',
    [asked(s), M.U.immediatesOwed(data, s.tokens, []).map((x) => x.uid)], [['blast.resolve', null], [grenade.uid]]);
  const mind = newMind();
  let q = owed(data, s, 's1', mind);
  check('the question: whose blast, of what kind, and that it takes every unit it caught', [q.unit, q.facts, q.seat], [grenade.uid, { blast: 'immediate', actionId: '154_A', scope: 'all' }, 's1']);
  check('one Explosion for each unit in the Grid, the launcher\'s own Raven among them (4.7.6: allies too), and no way to decline',
    [ids(q), q.options.map((o) => o.tags)], [[`blast:${grenade.uid}:${U.Raven.uid}`, `blast:${grenade.uid}:${U.Mire.uid}`],
      [['detonate', 'attack', 'explosion', 'blast', 'ally'], ['detonate', 'attack', 'explosion', 'blast']]]);
  check('each is an attack in Explosion mode by the Grenade, named as part of a blast, with the Grenade HELD while another unit is still to take its own',
    q.options.map((o) => [o.run.routine, o.run.args.mode, o.run.args.uid, o.run.args.actionId, o.run.args.before, o.run.args.blast, o.run.args.hold]),
    [['attack', 'explosion', grenade.uid, '154_A', [], true, true], ['attack', 'explosion', grenade.uid, '154_A', [], true, true]]);
  check('the window opens on it (turn.ts attackOpening): an Explosion, no Protection', (() => {
    const open = T.attackOpening(data, s, grenade.uid, '154_A', U.Mire.uid, 'explosion');
    return [!!open, open.protection.white, /Explosion damage ignores line of sight/.test(open.note)];
  })(), [true, 0, true]);
  // While an attack is on the table nobody is asked anything of the turn.
  const mid = clone(s);
  mid.script.combatView = { attackerUid: grenade.uid, targetUid: U.Raven.uid, actionId: '154_A', step: 'attack' };
  check('while one of its Explosions is being rolled, neither seat is asked for the next', asked(mid), [null, null]);
  explode(s, mind, q.options[0]);
  check('the first made, the seat remembers who has had theirs, and the Grenade still stands', [mind.blast, s.tokens.some((t) => t.uid === grenade.uid)], [{ uid: grenade.uid, actionId: '154_A', hit: [U.Raven.uid] }, true]);
  const q2 = owed(data, s, 's1', mind);
  check('ASKED AGAIN, it is a new question, for the unit that is left: and the last Explosion lets the Grenade go with it (no hold)',
    [q2.id === q.id, ids(q2), q2.options[0].run.args.hold, q2.options[0].run.args.blast], [false, [`blast:${grenade.uid}:${U.Mire.uid}`], undefined, true]);
  check('a seat with no memory of it would be asked for both again: the list is nobody\'s but the seat\'s', ids(owed(data, s, 's1', newMind())).length, 2);
  explode(s, mind, q2.options[0]);
  check('the last one made, the Grenade is gone, nothing is owed, and the turn goes on where it stood: the Volley has shots left',
    [s.tokens.some((t) => t.uid === grenade.uid), asked(s, { s1: mind }), owed(data, s, 's1', mind).options.some((o) => o.tags.includes('volley'))], [false, ['opp.act', null], true]);
}
{
  // A Grenade held to its end: what is left when everybody has had theirs.
  const { s, U, put } = stage(2);
  const grenade = put('154', 's1', 5, 7);
  const mind = { ...newMind(), blast: { uid: grenade.uid, actionId: '154_A', hit: [U.Mire.uid] } };
  const q = owed(data, s, 's1', mind);
  check('a blast that has taken everybody, its unit still standing, ends by an answer of its own: the unit is removed',
    [ids(q), q.options[0].commands, q.options[0].tags, q.fallback], [[`blast:${grenade.uid}:done`], [{ kind: 'despawn', seat: 's1', uid: grenade.uid, targetUid: grenade.uid }], ['detonate', 'destroy', 'done'], `blast:${grenade.uid}:done`]);
  check('the engine takes it, and no blast is owed after it', [sendAll(s, q.options[0].commands), s.tokens.some((t) => t.uid === grenade.uid), asked(s, { s1: mind }).includes('blast.resolve')], [[true], false, false]);
  // A memory of some other unit's blast is no memory of this one.
  const other = stage(2);
  const g2 = other.put('154', 's1', 5, 7);
  check('a memory of another unit\'s blast, or of another Action\'s, says nothing about this one',
    [ids(owed(data, other.s, 's1', { ...newMind(), blast: { uid: 4242, actionId: '154_A', hit: [other.U.Mire.uid] } })),
      ids(owed(data, other.s, 's1', { ...newMind(), blast: { uid: g2.uid, actionId: 'other', hit: [other.U.Mire.uid] } }))],
    [[`blast:${g2.uid}:${other.U.Mire.uid}`], [`blast:${g2.uid}:${other.U.Mire.uid}`]]);
  check('with one unit in the Grid and nothing else to take, its one Explosion is not held: the attack\'s end removes the Grenade',
    owed(data, other.s, 's1', newMind()).options[0].run.args.hold, undefined);
  // Into an empty Grid.
  const empty = stage(2);
  const g3 = empty.put('154', 's1', 8, 8);
  const e = owed(data, empty.s, 's1', newMind());
  check('a Grenade that catches nobody is removed, by the one answer there is', [ids(e), e.options[0].commands.map((c) => c.kind), /detonates on nothing/.test(e.options[0].label)], [[`blast:${g3.uid}:done`], ['despawn'], true]);
  // A wreck in the Grid is not a unit to attack.
  const wreck = stage(2);
  const g4 = wreck.put('154', 's1', 5, 7);
  wreck.U.Mire.partStates.torso = 'destroyed';
  check('a unit already destroyed and not yet removed takes no Explosion', ids(owed(data, wreck.s, 's1', newMind())), [`blast:${g4.uid}:done`]);
}
{
  // A Container in the blast.
  const { s, put } = stage(2, { terrain: true });
  const box = T.terrainOf(data, s).find((p) => p.isFragile);
  const g = { c: Math.floor(box.subCells[0].col / 3), r: Math.floor(box.subCells[0].row / 3) };
  for (const t of s.tokens) { t.col = 0; t.row = 0; }
  const grenade = put('154', 's1', g.c, g.r);
  const d = owed(data, s, 's1', newMind());
  check('A CONTAINER IN RANGE GOES WITH A BLAST ON EVERY UNIT (a Neutral Unit, destroyed with no roll): the end of it destroys the Container, then removes the Grenade',
    [ids(d), d.options[0].commands.map((c) => c.kind), d.options[0].commands[0].pieces, sendAll(s, d.options[0].commands), (s.removedTerrain ?? []).includes(box.id)],
    [[`blast:${grenade.uid}:done`], ['destroyTerrain', 'despawn'], [box.id], [true, true], true]);
  // A unit beside the Container, in the same Grid.
  const both = stage(2, { terrain: true });
  for (const t of both.s.tokens) { t.col = 0; t.row = 0; }
  const room = M.R.standingSpot(g.c, g.r, 1, false, T.terrainOf(data, both.s), [], undefined);
  const beacon = both.put('076', 's2', g.c, g.r, room ?? {});
  const g2 = both.put('154', 's1', g.c, g.r);
  const mind = newMind();
  const first = owed(data, both.s, 's1', mind);
  check('with one unit in the Grid beside the Container, that unit\'s Explosion is HELD: the Container is still to go, and the attack\'s end would have taken the Grenade from it',
    [!!room, ids(first), first.options[0].run.args.hold, first.options[0].run.args.blast], [true, [`blast:${g2.uid}:${beacon.uid}`], true, true]);
  explode(both.s, mind, first.options[0]);
  const last = owed(data, both.s, 's1', mind);
  check('then the end of it takes the Container and the Grenade', [both.s.tokens.some((t) => t.uid === g2.uid), ids(last), last.options[0].commands.map((c) => c.kind), sendAll(both.s, last.options[0].commands), (both.s.removedTerrain ?? []).includes(box.id)],
    [true, [`blast:${g2.uid}:done`], ['destroyTerrain', 'despawn'], [true, true], true]);
}
{
  // A Detonation with no dice: a Smoke Grenade (M8.2c; the whole of it is
  // seatsmoke.test's).
  const { s, U, turnOf } = stage(2);
  turnOf(U.Dune, 'projectile');
  const d = owed(data, s, 's2', newMind());
  check('A SMOKE GRENADE IS LAUNCHED TOO, and its answers say it is Smoke: its Detonation is where its Screens go, and no attack',
    [!!M.U.smokePlacement(data.byId.get('268').actions[0]), !!M.U.immediateDetonation(data.byId.get('268')), T.actionRows(data, s, U.Dune, s.script.opp).some((row) => row.a.id === '016_B' && row.v.ok),
      d.options.some((o) => o.facts?.cardId === '268'), d.options.filter((o) => o.tags[0] === 'launch').every((o) => o.facts.cardId === '268' && o.tags.includes('smoke'))], [true, true, true, true, true]);
  // One that stands on the board is its own squad's to resolve, as any is.
  const landed = stage(2);
  landed.put('268', 's2', 5, 6);
  const q = owed(data, landed.s, 's2', newMind());
  check('and one standing on the board is its squad\'s to resolve while the other waits: a shape for its Screens each answer, none of them an attack',
    [asked(landed.s), q.options.length > 1, q.options.every((o) => o.tags.join() === 'detonate,smoke,done' && !o.run)], [[null, 'blast.resolve'], true, true]);
}
{
  // An Interception owed at the Grenade comes first.
  const { s, U, at, turnOf } = stage(2);
  at(U.Dune, 5, 9, 0);
  turnOf(U.Wolf, 'projectile');
  const shot = owed(data, s, 's1', newMind()).options.find((o) => o.tags[0] === 'launch' && o.facts.cardId === '154' && o.facts.to.c === 5 && o.facts.to.r === 7);
  check('launched inside an interceptor\'s reach, the Grenade owes that first: the launch carries the debt', [shot.commands.map((c) => c.kind), shot.facts.intercepts], [['performAction', 'launch', 'queueIntercepts'], 1]);
  sendAll(s, shot.commands);
  const grenade = s.tokens.find((t) => t.cardId === '154');
  check('THE INTERCEPTION IS ASKED BEFORE THE BLAST (4.9): the other squad makes its attempt, and the Grenade\'s owner waits',
    [asked(s), M.U.immediatesOwed(data, s.tokens, M.C.liveIntercepts(s))], [[null, 'intercept.attempt'], []]);
  sendAll(s, owed(data, s, 's2', newMind()).options[0].run.args.before);
  check('the attempt made and missed, the Grenade that came through owes its blast', [M.C.liveIntercepts(s).length, asked(s), owed(data, s, 's1', newMind()).unit], [0, ['blast.resolve', null], grenade.uid]);
}

// ---------- a Rocket: one enemy at the Landing Point ----------
{
  const { s, U, at, turnOf } = stage(2);
  at(U.Mire, 5, 5, 2); at(U.Wolf, 5, 8, 0);
  turnOf(U.Mire, 'projectile');
  const rocket = T.actionOf(data, s, U.Mire, '056_A');
  const land = T.landingGrids(data, s, U.Mire, rocket);
  check('A DIRECT FIRE PROJECTILE MAY LAND IN A GRID A MECH FILLS (4.7.1 bars a Grid TERRAIN fills, and no other): the Rocket\'s card takes "1 Enemy Unit within landing point", and no Mech\'s Grid was one',
    [M.U.needsSightToLanding(rocket), U.Wolf.size, land.some((g) => g.c === 5 && g.r === 8), land.some((g) => g.c === 0 && g.r === 0)], [true, 3, true, true]);
  const d = owed(data, s, 's2', newMind());
  const shot = d.options.find((o) => o.tags[0] === 'launch' && o.facts.cardId === '267' && o.facts.to.c === 5 && o.facts.to.r === 8);
  check('so the Rocket is offered the Wolf\'s own Grid, and the engine takes the launch', [!!shot, shot ? sendAll(s, shot.commands) : null], [true, [true, true]]);
  const r = s.tokens.find((t) => t.cardId === '267');
  const q = owed(data, s, 's2', newMind());
  check('a blast on ONE unit: an answer for each enemy at the Landing Point, not held and not remembered (the attack\'s end removes the Rocket)',
    [asked(s), q.facts, ids(q), q.options[0].run.args.hold, q.options[0].run.args.blast, q.options[0].tags], [[null, 'blast.resolve'], { blast: 'immediate', actionId: '267_A', scope: 'single' }, [`blast:${r.uid}:${U.Wolf.uid}`], undefined, undefined, ['detonate', 'attack', 'explosion']]);
  // Its own squad's unit in the same Grid is not its target.
  const friendly = clone(s);
  const dune = friendly.tokens.find((t) => t.uid === U.Dune.uid);
  dune.col = 15; dune.row = 24;
  check('a unit of its own squad in that Grid is not offered: the card takes an Enemy Unit', ids(owed(data, friendly, 's2', newMind())), [`blast:${r.uid}:${U.Wolf.uid}`]);
  const gone = clone(s);
  const wolf = gone.tokens.find((t) => t.uid === U.Wolf.uid);
  wolf.col = 0; wolf.row = 27;
  const none = owed(data, gone, 's2', newMind());
  check('with nobody at the Landing Point it finds no target and is destroyed (4.7.5)', [ids(none), none.options[0].commands, sendAll(gone, none.options[0].commands), asked(gone)],
    [[`blast:${r.uid}:none`], [{ kind: 'despawn', seat: 's2', uid: r.uid, targetUid: r.uid }], [true], [null, 'opp.act']]);
  const hidden = clone(s);
  hidden.tokens.find((t) => t.uid === U.Wolf.uid).statuses = ['camouflage'];
  check('nor may it take a unit in Optical Camouflage unscanned: an Immediate Projectile has no later turn to wait for, and is destroyed', ids(owed(data, hidden, 's2', newMind())), [`blast:${r.uid}:none`]);
  // The Rocket detonates and is gone: its launch was made all the same.
  explode(s, newMind(), q.options[0]);
  const after = owed(data, s, 's2', newMind());
  check('THE ROCKET LAUNCHER LAUNCHES ONE ROCKET A PERFORMANCE ("Launch 1"): with the first detonated and gone, and a Token left in its magazine, the same Action offers no second Rocket on that payment',
    [s.tokens.some((t) => t.uid === r.uid), U.Mire.ammo['056_A'], after.kind, after.options.filter((o) => o.tags[0] === 'launch' && o.facts.cardId === '267').length,
      M.C.check(data, s, { kind: 'launch', seat: 's2', uid: U.Mire.uid, actionId: '056_A', cardId: '267', to: { col: 16, row: 25 }, facing: 2 }).ok], [false, 1, 'opp.act', 0, false]);
}
{
  // The same rule on a battlefield: terrain still bars it.
  const { s, U } = stage(2, { terrain: true });
  const rocket = T.actionOf(data, s, U.Mire, '056_A');
  const terrain = T.terrainOf(data, s);
  const filled = [];
  for (let c = 0; c < 12; c++) for (let r = 0; r < 12; r++) if (!M.R.standingSpot(c, r, 1, false, terrain, [], U.Mire.uid)) filled.push(`${c},${r}`);
  const land = new Set(T.landingGrids(data, s, U.Mire, rocket).map((g) => `${g.c},${g.r}`));
  check('on the battlefield a Grid terrain fills is still no Landing Point for Direct Fire', [filled.length > 0, filled.filter((g) => land.has(g))], [true, []]);
  const turnSrc = await src('turn.ts');
  const mainSrc = await src('main.ts');
  check('both pages judge it the same way: the units are left out of that test in the Match Centre\'s reading and in freeplay\'s copy of it',
    [(turnSrc.match(/if \(!standingSpot\(c, r, 1, false, terrain, \[\], t\.uid\)\) continue;/g) ?? []).length, (mainSrc.match(/if \(!standingSpot\(c, r, 1, false, terrain, \[\], t\.uid\)\) continue;/g) ?? []).length,
      /standingSpot\(c, r, 1, false, terrain, state\.tokens, t\.uid\)/.test(turnSrc + mainSrc)], [1, 1, false]);
}

// ---------- a Stun Grenade: an effect, no dice ----------
{
  const { s, U, at, turnOf } = stage(2);
  at(U.Dune, 6, 7, 0); at(U.Raven, 5, 8, 0);
  // (The Dune's AMS has no Token left: this is about the Grenade, not the Interception.)
  U.Dune.intercept['003_A'] = 0;
  turnOf(U.Wolf, 'projectile');
  const shot = owed(data, s, 's1', newMind()).options.find((o) => o.tags[0] === 'launch' && o.facts.cardId === '155' && o.facts.to.c === 5 && o.facts.to.r === 7);
  sendAll(s, shot.commands);
  const stun = s.tokens.find((t) => t.cardId === '155');
  const q = owed(data, s, 's1', newMind());
  check('an effect with no dice is ONE answer: the Token its card names on every unit in Range, its own squad\'s too, and the Grenade removed',
    [asked(s), ids(q), q.options[0].tags, q.options[0].commands.map((c) => `${c.kind}${c.targetUid && c.kind === 'applyStatus' ? `:${c.statusId}:${c.targetUid}` : ''}`), q.options[0].facts.caught],
    [['blast.resolve', null], [`blast:${stun.uid}:effect`], ['detonate', 'effect', 'done'],
      [`applyStatus:fci:${U.Mire.uid}`, `applyStatus:fci:${U.Raven.uid}`, `applyStatus:fci:${U.Dune.uid}`, 'despawn'], [U.Mire.uid, U.Raven.uid, U.Dune.uid]]);
  const fci = (t) => (t.statuses ?? []).filter((x) => x === 'fci').length;
  check('the engine takes all of it: each of them bears Fire Control Interference, the Grenade is gone, and the turn goes on',
    [sendAll(s, q.options[0].commands), [U.Mire, U.Dune, U.Raven, U.Wolf].map(fci), s.tokens.some((t) => t.uid === stun.uid), asked(s)], [[true, true, true, true], [1, 1, 1, 0], false, ['opp.act', null]]);
  // A wreck in its Range.
  const wreck = stage(2);
  wreck.at(wreck.U.Dune, 6, 7, 0);
  wreck.U.Mire.partStates.torso = 'destroyed';
  const s2 = wreck.put('155', 's1', 5, 7);
  const w = owed(data, wreck.s, 's1', newMind());
  check('a unit already destroyed is handed no Token', [ids(w), w.options[0].facts.caught], [[`blast:${s2.uid}:effect`], [wreck.U.Dune.uid]]);
  const nobody = stage(2);
  const s3 = nobody.put('155', 's1', 9, 2);
  const n = owed(data, nobody.s, 's1', newMind());
  check('one that catches nobody is removed all the same', [ids(n), n.options[0].commands.map((c) => c.kind), n.options[0].facts.caught], [[`blast:${s3.uid}:effect`], ['despawn'], []]);
}

// ---------- a Mine ----------
{
  const { s, U, at, turnOf, put } = stage(2);
  at(U.Mire, 5, 5, 2); at(U.Wolf, 5, 9, 0);
  turnOf(U.Mire, 'projectile');
  const mines = owed(data, s, 's2', newMind()).options.filter((o) => o.tags[0] === 'launch' && o.facts.cardId === '074');
  check('A MINE IS DEPLOYED: offered in its own Grid and the four beside it (Range 1), and a Deploy owes no Interception',
    [mines.map((o) => `${o.facts.to.c},${o.facts.to.r}`).sort(), mines.every((o) => o.commands.map((c) => c.kind).join() === 'performAction,launch')], [['4,5', '5,4', '5,5', '5,6', '6,5'], true]);
  sendAll(s, mines.find((o) => o.facts.to.r === 6).commands);
  const mine = s.tokens.find((t) => t.cardId === '074');
  check('put down where nobody stands it owes nothing, and nobody is asked about it', [gridOf(mine), M.U.minesOwed(data, s.tokens), asked(s)], [[5, 6], [], [null, 'opp.act']]);
  // Deployed under its own layer: the unit that stood there is spared until it moves.
  const under = stage(2);
  under.at(under.U.Mire, 5, 5, 2);
  under.turnOf(under.U.Mire, 'projectile');
  sendAll(under.s, owed(data, under.s, 's2', newMind()).options.find((o) => o.tags[0] === 'launch' && o.facts.cardId === '074' && o.facts.to.c === 5 && o.facts.to.r === 5).commands);
  check('a unit standing in the Grid as the Mine arrives never ENTERED it: nothing is owed (ruling I15)', [M.U.minesOwed(data, under.s.tokens), asked(under.s)], [[], [null, 'opp.act']]);

  // The other squad's Mech walks.
  at(U.Wolf, 5, 8, 0); at(U.Mire, 0, 11, 0);
  turnOf(U.Wolf, 'movement');
  const w = owed(data, s, 's1', newMind());
  const moves = w.options.filter((o) => o.tags.includes('move'));
  const onto = moves.filter((o) => o.tags.includes('mined') && !o.tags.includes('halt'));
  const stops = moves.filter((o) => o.tags.includes('halt'));
  check('A MOVEMENT THAT ENDS IN THE MINE\'S GRID SAYS SO, and names the Mine for whoever puts odds on it',
    [onto.length, onto.every((o) => o.facts.to.c === 5 && o.facts.to.r === 6 && o.facts.mined === true), onto[0].facts.mine, /onto the Mine there/.test(onto[0].label)],
    [4, true, { uid: mine.uid, actionId: '074_A' }, true]);
  check('A WALK THE MINE WOULD STOP IS OFFERED AS THE STOP IT IS: once for each facing, in the Mine\'s Grid, with the Range it keeps to go on with',
    [stops.map((o) => o.id), stops.every((o) => o.facts.halt === 2 && o.facts.to.c === 5 && o.facts.to.r === 6 && o.commands.at(-1).halt === 2), stops[0].tags],
    [[0, 1, 2, 3].map((f) => `move:099_A:5,6:${f}:halt`), true, ['move', 'action', 'moving', 'facing:0', 'mined', 'halt']]);
  check('and no Grid beyond the Mine on that road is offered as if the walk reached it', moves.filter((o) => !o.tags.includes('mined') && o.facts.to.c === 5 && o.facts.to.r < 6).map((o) => o.id), []);
  check('every other Movement is as it was: no tag, no Mine named', moves.filter((o) => !o.tags.includes('mined')).every((o) => !('mined' in o.facts) && !('mine' in o.facts)), true);
  check('the Raven flies, and a Mine is set off by a GROUND unit: none of its Movements is one onto a Mine', (() => {
    const air = stage(0);
    air.put('074', 's2', 2, 2);
    air.s.script.turn = 's1';
    air.activate(air.U.Raven);
    const m = owed(data, air.s, 's1', newMind()).options.filter((o) => o.tags.includes('move'));
    return [m.length > 8, m.some((o) => o.facts.to.c === 2 && o.facts.to.r === 2), m.some((o) => o.tags.includes('mined'))];
  })(), [true, true, false]);
  check('a Mech\'s own squad\'s Mine is a Mine all the same (M6: ally or not)', (() => {
    const own = stage(2);
    own.at(own.U.Wolf, 5, 8, 0); own.at(own.U.Mire, 0, 11, 0);
    own.put('074', 's1', 5, 6);
    own.turnOf(own.U.Wolf, 'movement');
    return owed(data, own.s, 's1', newMind()).options.filter((o) => o.tags.includes('mined')).length;
  })(), 8);

  // The walk is made, and stops.
  const walk = stops[0];
  check('the stop is taken as it is offered', sendAll(s, walk.commands), [true, true]);
  check('the Mech stands in the Mine\'s Grid with Range in hand, the Mine is set off, and ITS OWNER is asked: the walker waits',
    [gridOf(U.Wolf), s.script.opp.mineHalt, mine.mine, asked(s)], [[5, 6], 2, { owed: true }, [null, 'blast.resolve']]);
  const q = owed(data, s, 's2', newMind());
  check('the Mine\'s blast: every Ground unit in its Grid, and with one there the attack\'s end removes the Mine',
    [q.unit, q.facts, ids(q), q.options[0].run.args.hold, q.options[0].run.args.blast], [mine.uid, { blast: 'mine', actionId: '074_A', scope: 'all' }, [`blast:${mine.uid}:${U.Wolf.uid}`], undefined, true]);
  check('the walk may not go on while the blast is owed: the engine holds it, and the seat is not asked to try',
    [M.C.check(data, s, { kind: 'maneuver', seat: 's1', uid: U.Wolf.uid, to: { col: U.Wolf.col, row: U.Wolf.row }, resume: true }).ok, owed(data, s, 's1', newMind())], [false, null]);
  explode(s, newMind(), q.options[0]);
  check('the blast resolved, the Mine is gone and the walker is asked again', [s.tokens.some((t) => t.uid === mine.uid), asked(s)], [false, ['opp.act', null]]);
  const g = owed(data, s, 's1', newMind());
  const goes = g.options.filter((o) => o.tags.includes('resume'));
  const far = (o) => Math.abs(o.facts.to.c - 5) + Math.abs(o.facts.to.r - 6);
  check('THE GO ON: the rest of that Movement, to every Grid within the Range it kept, on each facing, beside whatever else the activation offers',
    [goes.length > 0, goes.every((o) => far(o) >= 1 && far(o) <= 2), goes.every((o) => o.commands.length === 1 && o.commands[0].kind === 'maneuver' && o.commands[0].resume === true),
      goes[0].tags.slice(0, 2), g.options.some((o) => o.tags.includes('end'))], [true, true, true, ['move', 'resume'], true]);
  const go = goes.find((o) => o.facts.to.c === 5 && o.facts.to.r === 4);
  check('taken, the Mech stands two Grids on, nothing is left to go on with, and the Go on is offered no more',
    [sendAll(s, go.commands), gridOf(U.Wolf), s.script.opp.mineHalt, owed(data, s, 's1', newMind()).options.filter((o) => o.tags.includes('resume')).length], [[true], [5, 4], undefined, 0]);
}
{
  // Two units in the Mine's Grid: held between them.
  const { s, U, at, put } = stage(2);
  at(U.Wolf, 5, 6, 0);
  const cat = U.Cat; cat.col = 0; cat.row = 0;
  const mine = put('074', 's2', 5, 6, { mine: { owed: true } });
  const raven = put('166', 's1', 5, 6, { col: 15, row: 18 });
  const q = owed(data, s, 's2', newMind());
  check('a Mine that has caught a Flying unit above it leaves that unit alone (FAQ 1.04, M22): the Ground units in its Grid, and no other',
    [ids(q), M.U.minesOwed(data, s.tokens)[0].victims], [[`blast:${mine.uid}:${U.Wolf.uid}`], [U.Wolf.uid]]);
  void raven;
}
{
  // Both squads owe a blast: they take turns from the First Player.
  const { s, U, at, put } = stage(2);
  at(U.Wolf, 5, 6, 0); at(U.Mire, 8, 6, 0);
  const theirs = put('074', 's2', 5, 6, { mine: { owed: true } });
  const ours = put('074', 's1', 8, 6, { mine: { owed: true } });
  s.round.firstPlayer = 's2';
  check('WITH BOTH SQUADS OWING A BLAST they resolve in turn, from this round\'s First Player (Supplementary Rules 1.04, 1.9): that squad is asked, the other waits',
    [M.U.blastTurn(data, s), asked(s), owed(data, s, 's2', newMind()).unit], ['s2', [null, 'blast.resolve'], theirs.uid]);
  s.round.firstPlayer = 's1';
  check('the other way round, the other squad', [M.U.blastTurn(data, s), asked(s), owed(data, s, 's1', newMind()).unit], ['s1', ['blast.resolve', null], ours.uid]);
  explode(s, newMind(), owed(data, s, 's1', newMind()).options[0]);
  check('one resolved, the turn passes to the squad that still owes', [s.tokens.some((t) => t.uid === ours.uid), asked(s)], [false, [null, 'blast.resolve']]);
}

// ---------- the Pholcus ----------
{
  const { s, U, at, turnOf } = stage(2);
  at(U.Mire, 5, 9, 0);
  turnOf(U.Wolf, 'projectile');
  const d = owed(data, s, 's1', newMind());
  const ph = d.options.filter((o) => o.tags[0] === 'launch' && o.facts.cardId === '156');
  check('THE PHOLCUS IS LAUNCHED AGAIN (the seam had stopped launching one nobody could Unfold): at every Landing Point in Range 8, and it strikes from where it lands as its Unfolded form does',
    [ph.length > 100, ph.every((o) => o.facts.strike === 1), d.options.some((o) => o.facts?.cardId === '167')], [true, true, false]);
  sendAll(s, ph.find((o) => o.facts.to.c === 5 && o.facts.to.r === 9).commands);
  const p = s.tokens.find((t) => t.cardId === '156');
  check('folded, it owes nothing as it lands: it is no Immediate Projectile, whatever its card says of an occupied Grid', [M.U.immediatesOwed(data, s.tokens, []), asked(s)], [[], ['opp.act', null]]);
  s.round.phase = 4; s.script.stage = '1:4'; s.script.acted = []; s.script.passed = []; s.script.turn = 's1'; s.script.opp = null;
  const loop = owed(data, s, 's1', newMind());
  check('IN THE DELAY PHASE IT MUST UNFOLD (FAQ M18.3): its squad is offered its activation and no pass',
    [loop.kind, ids(loop), M.C.check(data, s, { kind: 'passTurn', seat: 's1' }).ok], ['loop.designate.delay', [`designate:${p.uid}`], false]);
  sendAll(s, loop.options[0].commands);
  const act = owed(data, s, 's1', newMind());
  check('and the activation is offered the Unfold and NOTHING ELSE: not its end, which a strict table refuses while the Unfold is owed (it took it until 2026-10-03, and the phase then had no way out)',
    [act.kind, ids(act), act.fallback, act.options[0].commands.map((c) => c.kind), M.C.check(data, s, { kind: 'endOpportunity', seat: 's1', uid: p.uid }).ok],
    ['activation.act', ['unfold:156_A'], 'unfold:156_A', ['performAction', 'unfold'], false]);
  check('an asker that wants only the attacks of that turn is offered none, and is not handed the end by mistake', ids(owed(data, s, 's1', newMind(), { only: ['attack'] })), null);
  check('it Unfolds: the same piece, now its Drone form, and it came up under the Mire', [sendAll(s, act.options[0].commands), p.cardId, p.kind, p.unfoldBlast, p.uid], [[true, true], '167', 'drone', true, p.uid]);
  const q = owed(data, s, 's1', newMind());
  check('COMING UP IN AN OCCUPIED GRID IT DETONATES AT ONCE (M18.4): its owner is asked, one answer for each unit it came up among',
    [asked(s), q.unit, q.facts, ids(q)], [['blast.resolve', null], p.uid, { blast: 'mine', actionId: '167_A', scope: 'single' }, [`blast:${p.uid}:${U.Mire.uid}`]]);
  check('at an enemy it is sent as the pages send it: no jump (it is in that Grid already: turn.ts detonationJump, since 2026-10-03), then the Explosion, which removes it', [q.options[0].run.args.before, q.options[0].run.args.hold, q.options[0].run.args.blast],
    [[], undefined, undefined]);
  explode(s, newMind(), q.options[0]);
  check('resolved, it is gone, and the Delay Phase can be left', [s.tokens.some((t) => t.uid === p.uid), asked(s), M.U.unfoldsOwed(data, s.tokens)], [false, ['phase.ready', 'phase.ready'], []]);
}
{
  // Coming up under one of its own.
  const { s, U, at, put } = stage(4);
  at(U.Cat, 5, 9, 2);
  const fold = put('156', 's1', 5, 9);
  s.script.turn = 's1'; s.script.acted = [fold.uid]; s.script.opp = M.TY.newOpportunity(fold.uid, undefined);
  sendAll(s, owed(data, s, 's1', newMind()).options[0].commands);
  const q = owed(data, s, 's1', newMind());
  check('it takes one of the units it came up among, ALLY OR NOT (ruling I19): under its own squad\'s Mech, that Mech is the answer, and no jump goes before it',
    [fold.unfoldBlast, ids(q), q.options[0].tags, q.options[0].run.args.before], [true, [`blast:${fold.uid}:${U.Cat.uid}`], ['detonate', 'attack', 'explosion', 'ally'], []]);
  check('(the engine still refuses a jump at an allied unit; no page sends one for this blast since 2026-10-03, when the Match Centre\'s stopped on it: mechanics7.test drives that panel)',
    M.C.check(data, s, { kind: 'flyToTarget', seat: 's1', uid: fold.uid, actionId: '167_A', targetUid: U.Cat.uid }), { ok: false, why: 'SGM-2 Pholcus Automatic Mine (Unfolded) jumps only at an Enemy Unit.' });
  // With both under it, its owner chooses.
  const both = stage(4);
  both.at(both.U.Cat, 5, 9, 2);
  const f2 = both.put('156', 's1', 5, 9);
  both.put('LHDR-KK9', 's2', 5, 9);
  both.s.script.turn = 's1'; both.s.script.acted = [f2.uid]; both.s.script.opp = M.TY.newOpportunity(f2.uid, undefined);
  sendAll(both.s, owed(data, both.s, 's1', newMind()).options[0].commands);
  check('an Aerial unit above it is not among them (ruling I18)', [both.s.tokens.at(-1).aerial, ids(owed(data, both.s, 's1', newMind()))], [true, [`blast:${f2.uid}:${both.U.Cat.uid}`]]);
  // Nobody under it.
  const alone = stage(4);
  const f3 = alone.put('156', 's1', 8, 8);
  alone.s.script.turn = 's1'; alone.s.script.acted = [f3.uid]; alone.s.script.opp = M.TY.newOpportunity(f3.uid, undefined);
  sendAll(alone.s, owed(data, alone.s, 's1', newMind()).options[0].commands);
  const after = owed(data, alone.s, 's1', newMind());
  check('coming up where nobody stands it owes nothing, and its activation may now be ended', [f3.cardId, !!f3.unfoldBlast, after.kind, ids(after)], ['167', false, 'activation.act', ['end']]);
}
{
  // The Automatic Phase: an enemy in reach.
  const { s, U, at, put } = stage(3);
  at(U.Mire, 5, 9, 0); at(U.Dune, 4, 8, 0); at(U.Cat, 5, 7, 2);
  const ph = put('167', 's1', 5, 8);
  s.script.turn = 's1';
  const q = owed(data, s, 's1', newMind());
  check('IN THE AUTOMATIC PHASE AN UNFOLDED PHOLCUS WITH AN ENEMY IN REACH MUST DETONATE (M18.6): asked of its owner above the phase, with no activation open',
    [asked(s), q.unit, q.facts, s.script.opp], [['blast.resolve', null], ph.uid, { blast: 'automatic', actionId: '167_A', scope: 'single' }, null]);
  check('tied for nearest, its owner picks: an answer each, each a jump and then the Explosion; its own squad\'s Mech beside it is no target',
    [ids(q), q.options.map((o) => o.run.args.before.map((c) => `${c.kind}:${c.targetUid}`))], [[`blast:${ph.uid}:${U.Mire.uid}`, `blast:${ph.uid}:${U.Dune.uid}`], [[`flyToTarget:${U.Mire.uid}`], [`flyToTarget:${U.Dune.uid}`]]]);
  check('the jump lands it in its target\'s Grid', [sendAll(s, q.options[0].run.args.before), gridOf(ph), ph.jumpBlast], [[true], [5, 9], true]);
  const nearer = stage(3);
  nearer.at(nearer.U.Mire, 5, 9, 0); nearer.at(nearer.U.Dune, 5, 8, 0);
  const p2 = nearer.put('167', 's1', 5, 8, { col: 15, row: 24 });
  nearer.s.script.turn = 's1';
  check('the NEAREST is taken and nothing farther: an enemy in its own Grid before one a Grid away', ids(owed(data, nearer.s, 's1', newMind())), [`blast:${p2.uid}:${nearer.U.Dune.uid}`]);
  for (const phase of [0, 2, 4]) {
    const off = stage(phase);
    off.at(off.U.Mire, 5, 9, 0);
    off.put('167', 's1', 5, 8);
    off.s.script.turn = 's1';
    if (phase === 4) off.s.script.acted = off.s.tokens.map((t) => t.uid);
    check(`in the ${M.TY.PHASES[phase]} Phase that Detonation is not owed`, asked(off.s).includes('blast.resolve'), false);
  }
  const far = stage(3);
  far.at(far.U.Mire, 5, 11, 0);
  far.put('167', 's1', 5, 8);
  far.s.script.turn = 's1';
  check('with no enemy in its Range it owes nothing', asked(far.s).includes('blast.resolve'), false);
}

// ---------- Martyrdom ----------
{
  const { s, U, at, put } = stage(2);
  at(U.Wolf, 5, 5, 2); at(U.Mire, 5, 7, 0); at(U.Dune, 4, 6, 0);
  const zealot = put('ZHDR-302', 's2', 5, 6, { col: 15, row: 18 });
  check('a Zealot standing owes nothing', asked(s).includes('blast.resolve'), false);
  zealot.partStates.main = 'destroyed';
  const owedNow = M.U.martyrdomOwed(data, s.tokens);
  const q = owed(data, s, 's2', newMind());
  check('DESTROYED, IT DETONATES WHERE IT STANDS: its own squad is asked, the squad that destroyed it waits',
    [owedNow.length, asked(s), q.unit, q.facts], [1, [null, 'blast.resolve'], zealot.uid, { blast: 'martyrdom', actionId: 'ZHDR-302_B', scope: 'all' }]);
  check('every unit in its Range takes an Explosion, its own squad\'s as well, and each is held: an attack\'s end does not remove a unit whose own destruction set it off',
    [ids(q).sort(), q.options.every((o) => o.run.args.hold === true && o.run.args.blast === true), q.options.filter((o) => o.tags.includes('ally')).length],
    [[U.Wolf, U.Mire, U.Dune].map((t) => `blast:${zealot.uid}:${t.uid}`).sort(), true, 2]);
  check('the window opens on a blast whose attacker is itself destroyed', !!T.attackOpening(data, s, zealot.uid, 'ZHDR-302_B', U.Wolf.uid, 'explosion'), true);
  const mind = newMind();
  for (const t of [U.Wolf, U.Mire]) explode(s, mind, owed(data, s, 's2', mind).options.find((o) => o.facts.targetUid === t.uid));
  const last = owed(data, s, 's2', mind);
  check('even the last of them is held, and the wreck is still there after it', [ids(last), last.options[0].run.args.hold, (explode(s, mind, last.options[0]), s.tokens.some((t) => t.uid === zealot.uid))], [[`blast:${zealot.uid}:${U.Dune.uid}`], true, true]);
  const done = owed(data, s, 's2', mind);
  check('then its end removes it, and nothing more is owed', [ids(done), sendAll(s, done.options[0].commands), M.U.martyrdomOwed(data, s.tokens), asked(s, { s2: mind }).includes('blast.resolve')], [[`blast:${zealot.uid}:done`], [true], [], false]);
}
{
  // Where it stands among the other debts.
  const { s, U, at, put } = stage(2);
  at(U.Wolf, 5, 5, 2); at(U.Mire, 5, 7, 0);
  const zealot = put('ZHDR-302', 's2', 5, 6, { partStates: { main: 'destroyed' } });
  s.script.reactions = [{ uid: U.Mire.uid, actionId: 'COMMON_DEFENSE_REACTION', count: 0, range: 0, kind: 'stance' }];
  check('MARTYRDOM COMES BEFORE A REACTION ("immediately"): the blast is asked first', [owed(data, s, 's2', newMind()).kind, owed(data, s, 's2', newMind()).unit], ['blast.resolve', zealot.uid]);
  const grenade = put('154', 's1', 5, 7);
  check('and before an Immediate Projectile that has landed: the other squad\'s Grenade waits for it', asked(s), [null, 'blast.resolve']);
  const noMartyr = clone(s);
  noMartyr.tokens = noMartyr.tokens.filter((t) => t.uid !== zealot.uid);
  check('with no Martyrdom owed, the reaction is asked before the Grenade\'s blast', [owed(data, noMartyr, 's2', newMind()).kind, owed(data, noMartyr, 's1', newMind())], ['reaction.answer', null]);
  noMartyr.script.reactions = [];
  check('and with neither, the Grenade', [asked(noMartyr), owed(data, noMartyr, 's1', newMind()).unit], [['blast.resolve', null], grenade.uid]);
  const fight = clone(s);
  fight.script.intercepts = [{ uid: U.Dune.uid, actionId: '003_A', targetUid: grenade.uid }];
  fight.tokens.find((t) => t.uid === U.Dune.uid).col = 15;
  fight.tokens.find((t) => t.uid === U.Dune.uid).row = 27;
  check('an Interception owed comes before them all', asked(fight), [null, 'intercept.attempt']);
}

// ---------- a Delayed blast on every unit in Range ----------
{
  const { s, U, at, put } = stage(4);
  at(U.Wolf, 5, 6, 0); at(U.Mire, 5, 7, 0); at(U.Dune, 6, 8, 0); at(U.Cat, 0, 0, 0);
  const shell = put('ZHAM-004', 's1', 5, 7);
  s.script.turn = 's1'; s.script.acted = [shell.uid]; s.script.opp = M.TY.newOpportunity(shell.uid, undefined);
  const d = owed(data, s, 's1', newMind());
  const blasts = d.options.filter((o) => o.tags.includes('blast'));
  check('A SHRAPNEL SHELL\'S DELAYED ACTION is its blast, where the seam offered it nothing but the end of its activation: an Explosion for each unit within Range 1, its own squad\'s Mech too',
    [d.kind, blasts.map((o) => o.id).sort(), d.options.some((o) => o.tags.includes('end'))],
    ['activation.act', [U.Wolf, U.Mire].map((t) => `detonate:ZHAM-004_A:${t.uid}`).sort(), true]);
  check('each pays for the Action as it opens, and holds the Shell for the rest', blasts.map((o) => [o.run.args.before.map((c) => c.kind), o.run.args.hold, o.run.args.blast]), [[['performAction'], true, true], [['performAction'], true, true]]);
  const mind = newMind();
  check('the payment is taken', explode(s, mind, blasts.find((o) => o.facts.targetUid === U.Mire.uid)), [true]);
  const q = owed(data, s, 's1', mind);
  check('THE REST OF IT IS THE BLAST UNDER WAY: asked above the phase from the seat\'s memory, with nothing more to pay, and the Shell\'s activation is not offered its end meanwhile',
    [q.kind, q.facts, ids(q), q.options[0].run.args.before, q.options[0].run.args.hold], ['blast.resolve', { blast: 'delayed', actionId: 'ZHAM-004_A', scope: 'all' }, [`blast:${shell.uid}:${U.Wolf.uid}`], [], undefined]);
  check('the other seat is asked nothing while the Shell holds its activation', owed(data, s, 's2', newMind()), null);
  explode(s, mind, q.options[0]);
  check('its last Explosion made, the Shell is gone and the phase goes on', [s.tokens.some((t) => t.uid === shell.uid), asked(s, { s1: mind })], [false, ['phase.ready', 'phase.ready']]);
  // Nobody in Range.
  const empty = stage(4);
  const lone = empty.put('ZHAM-004', 's1', 9, 2);
  empty.s.script.turn = 's1'; empty.s.script.acted = [lone.uid]; empty.s.script.opp = M.TY.newOpportunity(lone.uid, undefined);
  const e = owed(data, empty.s, 's1', newMind());
  check('one that catches nobody is paid for and removed, or its activation ended', [ids(e), e.options[0].commands.map((c) => c.kind)], [['detonate:ZHAM-004_A:done', 'end'], ['performAction', 'despawn']]);
}

// ---------- a launcher's Landing Points: every one of them, and the ones a look ahead is given ----------
//
// A seat that looks ahead asks for launches at every look, and a launcher may
// reach most of the board (the Pholcus rack here has 119 Landing Points, the
// Rocket Launcher 135). Two savings, each held to what it replaced: the
// Interception a launch would owe is read off ONE copy of the table for a
// card, and an asker that is looking ahead is given only the Landing Points
// its Projectile could do something from (AI-OPPONENT-PLAN.md, section 12).
{
  // The Wolf's three launchers against the Dune's AMS (Range 3), which stands
  // out of reach of the Grid launched from, a Smoke Screen across some of its
  // lines: whether a launch owes Interception depends on where it lands (4.9).
  const { s, U, at, turnOf } = stage(2);
  at(U.Mire, 5, 9, 0); at(U.Dune, 7, 7, 0);
  s.smoke = [{ col: 6, row: 6, side: 's1' }];
  turnOf(U.Wolf, 'projectile');
  const d = owed(data, s, 's1', newMind());
  const launches = d.options.filter((o) => o.tags[0] === 'launch');
  // The slow reading: the launch made on a copy of the table of its own, and
  // the debt read off what it leaves (turn.ts interceptsAfterLaunch).
  const before = new Set(s.tokens.map((t) => t.uid));
  const slowly = (o) => {
    const after = M.G.tableAfter(data, s, o.commands.filter((c) => c.kind !== 'queueIntercepts'));
    return T.interceptsAfterLaunch(data, after, after.tokens.find((t) => t.uid === U.Wolf.uid), after.tokens.filter((t) => !before.has(t.uid)));
  };
  const wrong = [];
  const count = {};
  for (const o of launches) {
    const sent = o.commands.at(-1).kind === 'queueIntercepts' ? o.commands.at(-1).items : [];
    const c = (count[o.facts.cardId] ??= [0, 0]);
    c[0] += 1;
    if (sent.length) c[1] += 1;
    if (JSON.stringify(sent) !== JSON.stringify(slowly(o)) || (o.facts.intercepts ?? 0) !== sent.length || o.tags.includes('intercepted') !== sent.length > 0) wrong.push(o.id);
  }
  check('THE INTERCEPTION A LAUNCH CARRIES IS WHAT THE TABLE IT LEAVES WOULD OWE, at every Landing Point of every card: read off one copy of the table for a card, the Projectile stood at each Landing Point in turn, it is what a copy of its own for each one says. Of each card some owe it and some do not',
    [wrong, count], [[], { 155: [25, 10], 154: [25, 10], 156: [119, 24] }]);

  // A LOOK AHEAD is given the Landing Points within the Projectile's own reach
  // of a unit of the other squad, and those only.
  const useful = (o, side) => s.tokens.filter((t) => t.side !== side && t.deployed !== false).map(gridOf)
    .some(([c, r]) => Math.abs(c - o.facts.to.c) + Math.abs(r - o.facts.to.r) <= o.facts.strike);
  const told = (list) => list.map((o) => `${o.id}|${JSON.stringify(o.commands)}|${o.tags}|${JSON.stringify(o.facts)}`);
  for (const only of [['launch'], ['attack', 'launch', 'electronic', 'terminal']]) {
    const ahead = owed(data, s, 's1', newMind(), { only }).options.filter((o) => o.tags[0] === 'launch');
    check(`AN ASKER LOOKING AHEAD (for ${only.join(', ')}) is given the launches that land within the Projectile's own reach of an enemy unit, each word for word the answer the whole question holds, and no other: thirteen of a hundred and sixty-nine`,
      [JSON.stringify(told(ahead)) === JSON.stringify(told(launches.filter((o) => useful(o, 's1')))), ahead.length, launches.length], [true, 13, 169]);
  }
  check('a Grenade (it takes the units in its own Grid) is offered to a look ahead only at a Grid an enemy stands in, a Stun Grenade and the Pholcus (each reaches one Grid) beside one too',
    [[...new Set(launches.filter((o) => useful(o, 's1')).map((o) => `${o.facts.cardId}:${o.facts.strike}`))].sort(), launches.some((o) => o.facts.cardId === '154' && useful(o, 's1'))], [['155:1', '156:1'], false]);

  // The Rocket Launcher: Direct Fire, Range 12, one enemy at the Landing Point.
  const far = stage(2);
  far.at(far.U.Mire, 5, 9, 0); far.at(far.U.Dune, 7, 7, 0);
  M.L.setLocalSeat('s2');
  far.turnOf(far.U.Mire, 'projectile');
  const all = owed(data, far.s, 's2', newMind()).options.filter((o) => o.tags[0] === 'launch');
  const near = owed(data, far.s, 's2', newMind(), { only: ['launch'] }).options.filter((o) => o.tags[0] === 'launch');
  M.L.setLocalSeat('s1');
  check('THE QUESTION A SEAT IS PUT STILL LISTS EVERY LANDING POINT: a Rocket to every Grid in Range 12 it has a line to, a Mine to each Grid beside it; a look ahead is given the two Grids an enemy stands in, which are the only two a Rocket could do anything from',
    [all.filter((o) => o.facts.cardId === '267').length, all.filter((o) => o.facts.cardId === '074').length, near.map((o) => `${o.facts.cardId}@${o.facts.to.c},${o.facts.to.r}`),
      JSON.stringify(told(near)) === JSON.stringify(told(all.filter((o) => useful(o, 's2'))))],
    [135, 5, ['267@0,2', '267@5,5'], true]);
  // A unit that is not on the board draws no launch.
  const away = stage(2);
  away.at(away.U.Mire, 5, 9, 0); away.at(away.U.Dune, 7, 7, 0);
  away.U.Dune.deployed = false;
  away.turnOf(away.U.Wolf, 'projectile');
  const kept = owed(data, away.s, 's1', newMind(), { only: ['launch'] }).options.filter((o) => o.tags[0] === 'launch');
  check('a unit of the other squad that is not on the board draws no launch to a look ahead: what is left is within reach of the Mire, the one that is',
    [kept.length > 0, kept.length < 13, kept.every((o) => Math.abs(o.facts.to.c - 5) + Math.abs(o.facts.to.r - 9) <= o.facts.strike)], [true, true, true]);
  const seam = await src('owed.ts');
  check('the seam tells the two apart by whether the asker named the kinds it wants, and reads one table for a card',
    [(seam.match(/launchOptions\(data, state, t, row, [^\n]*, !!want\?\.only\)\)/g) ?? []).length, /const grids = ahead\n\s+\? turn\.landingGrids\(data, state, t, a, \(c, r\) => foes\.some\(/.test(seam),
      /if \(landed\) for \(const p of landed\.born\) \{ p\.col = shot\.cmd\.to\.col; p\.row = shot\.cmd\.to\.row; p\.facing = shot\.cmd\.facing; \}/.test(seam)], [2, true, true]);
}

// ---------- played: two drivers, the real window, fixed dice ----------
M.L.setLocalSeat(null);
const AI = M.AI;
const viewOf = (state, seat) => M.SEAT.viewOf(data, state, seat);
// Every die blank: an Explosion hurts nobody, so what is counted is who was
// attacked and how often. (The roll for First Player is a real one, or it
// would tie for ever.)
const blank = (pool) => Object.entries(pool).flatMap(([color, n]) => Array.from({ length: n }, () => ({ color, face: Math.max(0, data.dice.dice[color].faces.findIndex((f) => !f.length)) })));
const script = (want) => ({
  name: 'scripted',
  choose(d, view, rng) {
    const id = want(d, view);
    return id && d.options.some((o) => o.id === id) ? { option: id, why: 'scripted' } : AI.eagerPolicy.choose(d, view, rng);
  },
});
// A table past its setup, set to the Action Phase before either seat has done
// anything in a round, every unit where the test wants it, with every command
// that lands written down.
const table = async ({ policies, dice, seed = 5 }) => {
  const first = new AI.Rng(`${seed}:first`);
  let fixed = false;
  const t = botTable(M, data, { ...scenario, map: 'none' }, {
    seed, policies,
    dice: (pool, label) => (!fixed || /First Player/.test(label) ? Object.entries(pool).flatMap(([color, n]) => Array.from({ length: n }, () => ({ color, face: first.int(data.dice.dice[color].sides) }))) : dice(pool)),
  });
  await t.run({ until: (st) => M.SU.normaliseSetup(st.setup)?.stage === 'done' });
  fixed = true;
  const landed = [];
  t.watch((cmd) => landed.push(cmd));
  const U = Object.fromEntries(t.state.tokens.map((x) => [name(x), x]));
  const at = (x, c, r, f) => { x.col = c * 3; x.row = r * 3; if (f !== undefined) x.facing = f; };
  const put = (cardId, side, c, r, extra = {}) => { const x = { ...M.U.makeDroneToken(t.state, data, data.byId.get(cardId), side), col: c * 3 + 1, row: r * 3 + 1, facing: 0, ...extra }; t.state.tokens.push(x); return x; };
  at(U.Wolf, 5, 5, 2); at(U.Cat, 0, 0, 2); at(U.Raven, 0, 2, 2); at(U.Mire, 5, 7, 0); at(U.Dune, 11, 11, 0);
  const sc = t.state.script;
  t.state.round.phase = 2; sc.stage = '1:2'; sc.acted = []; sc.opp = null;
  sc.revealed = ['s1', 's2']; sc.passed = [];
  for (const x of t.state.tokens) if (x.kind === 'mech') x.timing = 'firing';
  const turnOf = (mech, timing) => {
    mech.timing = timing;
    sc.acted = t.state.tokens.filter((x) => x.kind === 'mech' && x.uid !== mech.uid).map((x) => x.uid);
    sc.opp = null;
    return M.G.opportunity(data, t.state);
  };
  // Who an attacker's window was opened on, in order.
  const struck = (uid) => landed.filter((c) => c.kind === 'setCombatView' && c.view && c.view.attackerUid === uid).map((c) => c.view.targetUid).filter((x, i, a) => i === 0 || a[i - 1] !== x);
  return { t, U, at, put, turnOf, landed, struck };
};
{
  // Martyrdom, through the window: three units in its Range, one of the other squad's.
  const x = await table({ policies: AI.legalPolicy, dice: blank });
  x.at(x.U.Wolf, 5, 5, 2); x.at(x.U.Mire, 5, 7, 0); x.at(x.U.Dune, 4, 6, 0);
  const zealot = x.put('ZHDR-302', 's2', 5, 6, { partStates: { main: 'destroyed' } });
  x.turnOf(x.U.Cat, 'movement');
  const end = await x.t.run({ until: (st) => !st.tokens.some((y) => y.uid === zealot.uid) && !st.script.combatView, maxSteps: 400 });
  const hit = x.struck(zealot.uid);
  check('PLAYED: a destroyed Zealot blows up through its own squad\'s seat: every unit in its Range takes ONE Explosion, each of them once, and then it is removed',
    [end.kind, x.t.refused, [...hit].sort(), hit.length, x.landed.filter((c) => c.kind === 'despawn' && c.targetUid === zealot.uid).length, x.landed.filter((c) => c.kind === 'despawn' && c.targetUid === zealot.uid)[0]?.seat],
    ['paused', [], [x.U.Wolf.uid, x.U.Mire.uid, x.U.Dune.uid].sort(), 3, 1, 's2']);
  check('the seat that made them remembers the blast as it went, and the other seat was never asked for one', [x.t.drivers.s2.mind.blast?.hit.length, x.t.drivers.s1.mind.blast ?? null,
    x.t.drivers.s1.log.some((l) => l.kind === 'blast.resolve'), x.t.drivers.s2.log.filter((l) => l.kind === 'blast.resolve').length], [3, null, false, 4]);
  x.t.close();
}
{
  // A Grenade thrown, and a second one of the Volley.
  let thrown = 0;
  const x = await table({
    dice: blank,
    policies: {
      s1: script((d) => {
        if (d.kind !== 'opp.act') return null;
        const g = d.options.find((o) => o.tags[0] === 'launch' && o.facts?.cardId === '154' && o.facts.to.c === 5 && o.facts.to.r === 7);
        if (g && thrown < 2) { thrown += 1; return g.id; }
        return d.options.find((o) => o.tags.includes('end'))?.id ?? null;
      }),
      s2: script(() => null),
    },
  });
  // A second unit of the other squad's in the Mire's Grid: both Grenades catch both.
  const beacon = x.put('076', 's2', 5, 7);
  x.turnOf(x.U.Wolf, 'projectile');
  const end = await x.t.run({ until: (st) => thrown >= 2 && !st.tokens.some((y) => y.cardId === '154') && !st.script.combatView, maxSteps: 400 });
  const kinds = x.landed.filter((c) => c.seat === 's1' && ['performAction', 'launch', 'despawn', 'endOpportunity'].includes(c.kind)).map((c) => c.kind);
  const grenades = x.landed.filter((c) => c.kind === 'despawn').map((c) => c.targetUid);
  const both = [x.U.Mire.uid, beacon.uid].sort();
  check('PLAYED: a Grenade is thrown at a Grid with two units in it, detonates on each of them as it lands and is gone; the Volley\'s second is thrown after it and does the same, on the one payment',
    [end.kind, x.t.refused, kinds.slice(0, 5), new Set(grenades).size, [...x.struck(grenades[0])].sort(), [...x.struck(grenades[1])].sort()],
    ['paused', [], ['performAction', 'launch', 'despawn', 'launch', 'despawn'], 2, both, both]);
  check('the second Grenade\'s blast is its own: what the first had already taken is not struck off it', x.t.drivers.s1.mind.blast, { uid: grenades[1], actionId: '154_A', hit: x.struck(grenades[1]) });
  x.t.close();
}
{
  // A walk a Mine stops, the blast, and the Go on.
  const x = await table({
    dice: blank,
    policies: {
      s1: script((d) => (d.kind !== 'opp.act' ? null
        : d.options.find((o) => o.tags.includes('resume') && o.facts.to.c === 5 && o.facts.to.r === 4 && o.facts.facing === 0)?.id
          ?? d.options.find((o) => o.tags.includes('halt') && o.facts.facing === 0)?.id
          ?? d.options.find((o) => o.tags.includes('end'))?.id ?? null)),
      s2: script(() => null),
    },
  });
  x.at(x.U.Wolf, 5, 8, 0); x.at(x.U.Mire, 0, 11, 0);
  const mine = x.put('074', 's2', 5, 6);
  x.turnOf(x.U.Wolf, 'movement');
  const end = await x.t.run({ until: (st) => gridOf(x.U.Wolf)[1] === 4 && !st.script.combatView, maxSteps: 400 });
  const moves = x.landed.filter((c) => c.kind === 'maneuver').map((c) => (c.resume ? 'go on' : c.halt !== undefined ? `stopped, ${c.halt} left` : 'moved'));
  const order = x.landed.map((c) => (c.kind === 'maneuver' ? (c.resume ? 'goon' : 'walk') : c.kind === 'despawn' && c.targetUid === mine.uid ? 'mine gone' : null)).filter(Boolean);
  check('PLAYED: a Mech walks into the other squad\'s Mine and is stopped; that squad\'s seat resolves the blast on it; then the Mech goes on with the Range it had left',
    [end.kind, x.t.refused, moves, order, x.struck(mine.uid), gridOf(x.U.Wolf), x.t.state.tokens.some((y) => y.uid === mine.uid)],
    ['paused', [], ['stopped, 2 left', 'go on'], ['walk', 'mine gone', 'goon'], [x.U.Wolf.uid], [5, 4], false]);
  x.t.close();
}
{
  // A Delayed blast on every unit in Range, through the window: a Projectile
  // is spent by an attack's end, so this is the one that shows it held.
  const x = await table({
    dice: blank,
    policies: { s1: script((d) => (d.kind === 'activation.act' ? d.options.find((o) => o.tags.includes('blast'))?.id ?? null : null)), s2: script(() => null) },
  });
  x.at(x.U.Wolf, 0, 6, 0); x.at(x.U.Mire, 5, 7, 0); x.at(x.U.Dune, 5, 8, 0);
  const shell = x.put('ZHAM-004', 's1', 5, 7);
  const sc = x.t.state.script;
  x.t.state.round.phase = 4; sc.stage = '1:4'; sc.acted = [shell.uid]; sc.turn = 's1'; sc.opp = M.TY.newOpportunity(shell.uid, undefined);
  const end = await x.t.run({ until: (st) => !st.tokens.some((y) => y.uid === shell.uid) && !st.script.combatView, maxSteps: 400 });
  const hit = x.struck(shell.uid);
  const gone = x.landed.findIndex((c) => c.kind === 'despawn' && c.targetUid === shell.uid);
  const lastView = x.landed.map((c, i) => (c.kind === 'setCombatView' && c.view?.attackerUid === shell.uid ? i : -1)).reduce((a, b) => Math.max(a, b), -1);
  check('PLAYED: a Shrapnel Shell detonates on both Mechs in its Range: it is paid for once, HELD after its first Explosion, and removed only when the second is over',
    [end.kind, x.t.refused, [...hit].sort(), hit.length, x.landed.filter((c) => c.kind === 'performAction' && c.uid === shell.uid).length,
      x.landed.filter((c) => c.kind === 'despawn' && c.targetUid === shell.uid).length, gone > lastView],
    ['paused', [], [x.U.Mire.uid, x.U.Dune.uid].sort(), 2, 1, 1, true]);
  x.t.close();
}

// ---------- what the policies make of it ----------
{
  const staged = async ({ seat = 's1', unit = 'Wolf', timing = 'projectile', phase = 2, policy = AI.eagerPolicy }, arrange) => {
    const x = await table({ policies: policy, dice: blank, seed: 2 });
    const made = arrange(x) ?? {};
    if (phase === 2) x.turnOf(x.U[unit], timing);
    else { x.t.state.round.phase = phase; x.t.state.script.stage = `1:${phase}`; }
    const d = x.t.drivers[seat].pending();
    const act = d && (d.kind === 'opp.act' || d.kind === 'activation.act');
    const pick = (p) => { const c = p.choose(d, viewOf(x.t.state, seat), new AI.Rng('pick')); return { ...c, o: d.options.find((o) => o.id === c.option) }; };
    return { ...x, d, made, pick, rows: act ? AI.weighed(d, viewOf(x.t.state, seat), { focus: false }) : [] };
  };
  const stay = (x) => x.rows.find((p) => p.how === 'stay');
  const tact = AI.makeTactician({ focus: false });

  // A Grenade in reach, on the dial that throws it.
  const one = await staged({}, () => {});
  const grenade = one.d.options.find((o) => o.facts?.cardId === '154' && o.facts.to.c === 5 && o.facts.to.r === 7);
  const blast = grenade.later(['attack', 'unfold']);
  check('THE TACTICIAN IS TOLD WHAT A GRENADE WOULD DO WHERE IT LANDS: the answer\'s own look ahead is the blast it owes, with the odds on each Explosion',
    [blast.kind, blast.options.map((o) => o.facts.targetUid), blast.options.every((o) => o.chance().pen > 0.5)], ['blast.resolve', [one.U.Mire.uid], true]);
  check('and with a Mech two Grids off, on a Projectile dial, what it does where it stands is throw something at it', [/^a Projectile for /.test(stay(one).does), stay(one).now > 1], [true, true]);
  // EVERY card it could launch is weighed, not the first that reaches each
  // enemy: the Wolf carries a Stun Grenade, a Grenade and a Pholcus, and what
  // it throws is the one worth most, which the Stun Grenade (listed first) is not.
  const worthOf = (cardId) => {
    const o = one.d.options.find((x) => x.facts?.cardId === cardId && x.facts.to.c === 5 && x.facts.to.r === 7);
    const only = { ...one.d, options: one.d.options.filter((x) => x.tags[0] !== 'launch' || x === o) };
    return AI.weighed(only, viewOf(one.t.state, 's1'), { focus: false }).find((p) => p.how === 'stay').now;
  };
  const each = { stun: worthOf('155'), grenade: worthOf('154'), pholcus: worthOf('156') };
  const most = Object.entries(each).reduce((a, b) => (b[1] > a[1] ? b : a))[0];
  check('with three cards to throw at the one Mech, each is weighed for itself and the one worth most is the one thrown',
    [Object.values(each).every((v) => v > 0.5), new Set(Object.values(each).map((v) => v.toFixed(3))).size, most, Math.abs(stay(one).now - each[most]) < 1e-9, /M7 Grenade/.test(stay(one).does)],
    [true, 3, 'grenade', true, true]);
  check('a Pholcus is weighed by what it would do as it Unfolds under that Mech, in the Delay Phase', (() => {
    const o = one.d.options.find((x) => x.facts?.cardId === '156' && x.facts.to.c === 5 && x.facts.to.r === 7);
    const turn = o.later(['attack', 'unfold']);
    const unfold = turn.options.find((x) => x.tags[0] === 'unfold');
    const among = unfold.then(['attack']);
    return [turn.kind, turn.options.map((x) => x.tags[0]), among.kind, among.options.map((x) => x.facts.targetUid)];
  })(), ['activation.act', ['unfold'], 'blast.resolve', [one.U.Mire.uid]]);
  one.t.close();
  // The Stun Grenade alone: the Wolf's other magazines are empty.
  const stunOnly = (x) => { x.U.Wolf.ammo['108_A'] = 0; x.U.Wolf.ammo['082_A'] = 0; x.at(x.U.Wolf, 5, 4, 2); };
  // A Stun Grenade is worth each enemy it catches.
  const two = await staged({}, (x) => { stunOnly(x); x.at(x.U.Dune, 6, 7, 0); x.U.Dune.intercept['003_A'] = 0; });
  const alone = await staged({}, (x) => { stunOnly(x); });
  check('a Stun Grenade that catches two enemy Mechs is worth more than one that catches one: each enemy\'s Firing for',
    [/M9 Stun Grenade: Detonation, on Mire, Dune/.test(stay(two).does), /M9 Stun Grenade: Detonation, on Mire,/.test(stay(alone).does), stay(two).now > stay(alone).now + 0.5], [true, true, true]);
  two.t.close();
  // Its own units in the blast count against it.
  const friendly = await staged({}, (x) => { stunOnly(x); x.at(x.U.Cat, 5, 6, 2); x.at(x.U.Raven, 4, 7, 2); });
  const stunAt = (x, c, r) => x.d.options.find((o) => o.facts?.cardId === '155' && o.facts.to.c === c && o.facts.to.r === r);
  check('ITS OWN UNITS IN A BLAST COUNT AGAINST IT: the same Stun Grenade on the same Mech, with two of its own squad beside it in the blast, is worth less, and is not thrown where it would catch them',
    [stunAt(friendly, 5, 7).later(['attack']).options[0].facts.caught.length, stay(friendly).now < stay(alone).now - 0.2, /Stun Grenade: Detonation, on [^,]*(Cat|ADK)/.test(stay(friendly).does) || /, (Cat|ADK)/.test(stay(friendly).does)], [3, true, false]);
  friendly.t.close(); alone.t.close();

  // A Mine in the road.
  const road = (x) => { x.at(x.U.Wolf, 5, 8, 0); x.at(x.U.Mire, 5, 1, 2); return { mine: x.put('074', 's2', 5, 6) }; };
  const mined = await staged({ timing: 'movement' }, road);
  const stop = mined.rows.find((p) => /into the Mine/.test(p.label));
  const chosen = mined.pick(tact);
  check('A MINE IN ITS ROAD COSTS WHAT ITS BLAST WOULD DO: the walk that sets it off is weighed with that taken off, by the Mine\'s own odds on the Mech',
    [!!stop, stop.now < -0.5, mined.d.options.find((o) => o.tags.includes('halt')).chance().pen > 0.5], [true, true, true]);
  check('so with another road as good, the Tactician walks round it', [chosen.o.tags.includes('mined'), chosen.o.tags[0]], [false, 'move']);
  for (const [label, policy] of [['the Brawler', AI.brawlerPolicy], ['the eager policy', AI.eagerPolicy]]) {
    const picks = [1, 2, 3, 4, 5].map((n) => { const c = policy.choose(mined.d, viewOf(mined.t.state, 's1'), new AI.Rng(`m${n}`)); return mined.d.options.find((o) => o.id === c.option); });
    check(`${label} has no rule about a Mine, and is never handed a Movement onto one to choose`, [picks.some((o) => o.tags.includes('mined')), picks.every((o) => o.tags[0] === 'move')], [false, true]);
  }
  mined.t.close();

  // A blast with a choice in it.
  const choice = await staged({ phase: 4 }, (x) => {
    x.at(x.U.Cat, 5, 9, 2);
    const foe = x.put('160', 's2', 5, 9);
    const p = x.put('167', 's1', 5, 9, { unfoldBlast: true });
    x.t.state.script.acted = x.t.state.tokens.map((y) => y.uid); x.t.state.script.opp = null; x.t.state.script.turn = 's1';
    return { p, foe };
  });
  check('A BLAST THAT TAKES ONE UNIT, with its own Mech and an enemy Drone to choose between: the Tactician takes the enemy',
    [choice.d.kind, choice.d.options.map((o) => o.facts.targetUid), choice.pick(tact).o.facts.targetUid, choice.pick(tact).reason],
    ['blast.resolve', [choice.U.Cat.uid, choice.made.foe.uid], choice.made.foe.uid, 'blast_by_value']);
  check('a policy with no rule for it takes the safe answer, which is the first on offer: here its own Mech',
    [choice.pick(AI.safePolicy).o.facts.targetUid, choice.d.fallback], [choice.U.Cat.uid, `blast:${choice.made.p.uid}:${choice.U.Cat.uid}`]);
  choice.t.close();

  // A Shrapnel Shell: made when it is worth making.
  const shell = async (arrange) => staged({ phase: 4 }, (x) => {
    arrange(x);
    const sh = x.put('ZHAM-004', 's1', 5, 7);
    x.t.state.script.acted = [sh.uid]; x.t.state.script.turn = 's1'; x.t.state.script.opp = M.TY.newOpportunity(sh.uid, undefined);
    return { sh };
  });
  const worth = await shell((x) => { x.at(x.U.Wolf, 0, 6, 0); x.at(x.U.Mire, 5, 7, 0); x.at(x.U.Dune, 5, 8, 0); });
  const bad = await shell((x) => { x.at(x.U.Wolf, 5, 6, 0); x.at(x.U.Cat, 5, 8, 0); x.at(x.U.Mire, 0, 11, 0); });
  check('A BLAST ON EVERY UNIT IN RANGE IS WEIGHED WHOLE: with two enemy Mechs in it the Shell is detonated, on a first Explosion that is one of them',
    [worth.pick(tact).reason, worth.pick(tact).o.tags.includes('blast'), [worth.U.Mire.uid, worth.U.Dune.uid].includes(worth.pick(tact).o.facts.targetUid)], ['blast_value', true, true]);
  check('with nobody in it but its own squad\'s Mechs it is not: the Shell\'s activation is ended, and the Shell kept',
    [bad.d.options.filter((o) => o.tags.includes('blast')).length, bad.pick(tact).o.tags, bad.pick(tact).reason], [2, ['end'], 'end_activation']);
  // An enemy in it, and more of its own: the blast on the enemy alone would be
  // worth making, and what it costs the two Mechs beside it is more.
  const mixed = await shell((x) => { x.at(x.U.Wolf, 5, 6, 0); x.at(x.U.Cat, 5, 8, 0); x.at(x.U.Mire, 0, 11, 0); x.put('160', 's2', 4, 7); });
  const foeShot = mixed.d.options.find((o) => o.tags.includes('blast') && !o.tags.includes('ally'));
  const foeOnly = { ...mixed.d, options: mixed.d.options.filter((o) => !o.tags.includes('ally')) };
  check('WITH ONE ENEMY DRONE AND TWO OF ITS OWN MECHS IN IT, the same blast that would be made for the Drone alone is not made: each of its own counts against it',
    [mixed.d.options.filter((o) => o.tags.includes('blast')).map((o) => o.tags.includes('ally')), !!foeShot,
      tact.choose(foeOnly, viewOf(mixed.t.state, 's1'), new AI.Rng('a')).reason, mixed.pick(tact).o.tags, mixed.pick(tact).reason],
    [[true, true, false], true, 'blast_value', ['end'], 'end_activation']);
  worth.t.close(); bad.t.close(); mixed.t.close();
}

// ---------- the seam's own text ----------
{
  const seam = await src('owed.ts');
  const drive = await src('ai/driver.ts');
  const bot = await src('ai/botcombat.ts');
  check('the question sits where the Match Centre\'s panel puts it: Martyrdom above a reaction, a Reveal owed below it (M8.2g), the other blasts below that, then the Mines a walk may still Lay (M8.2n), and above the phase',
    /if \(liveIntercepts\(state\)\.length\) return interceptOwed\(data, state, seat\);[\s\S]{0,300}const martyr = blastOwed\(data, state, seat, mind, 'martyrdom'\);\n\s+if \(martyr !== undefined\) return martyr;[\s\S]{0,500}reactionOwed\(data, state, other\(seat\)\)[\s\S]{0,300}const reveal = revealOwed\(data, state, seat\);\n\s+if \(reveal !== undefined\) return reveal;[\s\S]{0,300}const blast = blastOwed\(data, state, seat, mind, 'board'\);\n\s+if \(blast !== undefined\) return blast;\n\s+\/\/ Mines a walk[^\n]*\n\s+const lay = minesOwed\(data, state, seat, mind\);\n\s+if \(lay\) return lay;\n\s+const phase = PHASES\[state\.round\.phase\];/.test(seam), true);
  check('the driver holds the unit for a blast and remembers who has had theirs; the window removes a unit only when it is not held',
    [/this\.combat\.holdProjectile = !!args\.hold;/.test(drive), /this\.mind\.blast = \{ uid, actionId, hit: \[\.\.\.held, Number\(args\.targetUid\)\] \};/.test(drive),
      /if \(!this\.holdProjectile\) this\.host\.send\(\{ kind: 'despawn', seat: attacker\.side, uid: attacker\.uid, targetUid: attacker\.uid \}\);/.test(bot)], [true, true, true]);
}

// ---------- whole games ----------
{
  const tally = { games: 0, over: 0, refused: 0, broken: [], blasts: {}, sent: {}, left: [] };
  const bump = (bag, k) => { bag[k] = (bag[k] ?? 0) + 1; };
  for (const [policy, seeds] of [['legal', [1, 2, 3]], ['eager', [1, 2, 3]], ['brawler', [1, 2]], ['tactician', [1]]]) {
    for (const seed of seeds) {
      const t = botTable(M, data, scenario, { seed, policies: AI[`${policy}Policy`] });
      t.watch((cmd) => {
        if (cmd.kind === 'launch') bump(tally.sent, `launch:${cmd.cardId}`);
        if (cmd.kind === 'unfold') bump(tally.sent, 'unfold');
      });
      let end;
      try {
        end = await t.run({ maxSteps: 12000, onStep: (seat, r) => { if (r.decision.kind === 'blast.resolve') bump(tally.blasts, r.decision.facts.blast); } });
      } catch (err) { end = { kind: 'threw', why: `${err?.message ?? err}`.split('\n')[0] }; } finally { t.close(); }
      tally.games += 1;
      if (end.kind === 'over') tally.over += 1; else tally.broken.push(`${policy} ${seed}: ${end.kind} ${end.why ?? ''} ${end.decision ?? ''}`);
      tally.refused += t.refused.length;
      // Nothing that owed a blast, or an Unfold, is left standing at the end.
      for (const x of t.state.tokens) {
        const card = data.byId.get(x.cardId);
        if (x.kind === 'projectile' && card && (M.U.immediateDetonation(card) || x.cardId === '156')) tally.left.push(`${policy} ${seed}: ${x.label}`);
      }
    }
  }
  check('NINE GAMES between a squad of Grenades and a Pholcus rack and a squad with a Rocket Launcher and a Mine Layer, four policies: every one ends as a game should, nothing refused',
    [tally.over, tally.games, tally.refused, tally.broken], [9, 9, 0, []]);
  check('the Projectiles the seam used to leave at home were launched in them, and a Pholcus Unfolded',
    [['launch:267', 'launch:155', 'launch:156', 'launch:074'].filter((k) => !tally.sent[k]), (tally.sent.unfold ?? 0) > 0], [[], true]);
  check('blasts were owed and resolved: Immediate Projectiles and Mines, and no Immediate Projectile or folded Pholcus is left on a board when its game ends',
    [(tally.blasts.immediate ?? 0) > 0, (tally.blasts.mine ?? 0) > 0, tally.left], [true, true, []]);
  console.log(`       launched ${JSON.stringify(tally.sent)}; blasts asked ${JSON.stringify(tally.blasts)}`);
}

console.log(`\n${pass} passed, ${fail} failed`);
M.L.setLocalSeat(null);
if (fail) process.exit(1);
