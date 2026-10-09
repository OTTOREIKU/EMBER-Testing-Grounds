// THE POSITION AS NUMBERS (M17 L1, the learned evaluator: src/ai/features.ts). One table as a seat sees it, read into
// one fixed list of numbers, the same for the probe that writes the training data and for the Ace in play.
//
// Staged on the real engine, the board of squaddials.test: RDL's Blade (a Swift Steed) and Gun (an R-20 Railgun)
// against UN's Rifle and a Tarantula Drone. Read from both seats of the same table, the two readings must mirror each
// other exactly: what is one seat's own is the other's other.
//
// THE SECOND READING (2026-10-09): who can shoot whom now (the engine's own sight, walls counted), what each side could
// bring to bear next round, the race to the zones, the Commander, the Black Boxes. A model of the first reading is
// given the first 81 numbers alone, and they must be what they always were.
import { readFileSync } from 'node:fs';
import { botTable, loadEngine } from './_engine.mjs';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}\n       got  ${g}`); }
};

console.log('The position as numbers\n');

const { M, data } = await loadEngine('features', ["export * as SEAT from '../src/seat';", "export * as AI from '../src/ai/index';", "export * as HUD from '../src/matchhud';"]);
const AI = M.AI;
const fixture = JSON.parse(readFileSync(new URL('./learned.fixture.json', import.meta.url), 'utf8'));
data.solo.squads['t-ours'] = {
  name: 'Ours', faction: 'RDL', points: 0,
  mechs: [
    { name: 'Blade', loadout: { torso: '012', chasis: '022', leftHand: '062', rightHand: '036', pilot: 'FPA-11' } },
    { name: 'Gun', loadout: { torso: '016', chasis: '021', rightHand: '033', pilot: 'FPA-03' } },
  ],
  drones: [],
};
data.solo.squads['t-theirs'] = {
  name: 'Theirs', faction: 'UN', points: 0,
  mechs: [{ name: 'Rifle', loadout: { torso: '539', chasis: '099', rightHand: '541', pilot: 'LPA-23-2' } }],
  drones: [{ cardId: '163' }],
};
const scenario = { ...data.solo.scenarios[0], id: 't-features', map: 'none', mission: 'none', seats: { s1: 't-ours', s2: 't-theirs' } };
const t = botTable(M, data, scenario, { seed: 5, policies: { s1: AI.eagerPolicy, s2: AI.eagerPolicy }, glue: M.HUD.glueAfter });
await t.run({ until: (st) => M.SU.normaliseSetup(st.setup)?.stage === 'done' && st.round.phase === 1 });
const U = Object.fromEntries(t.state.tokens.map((x) => [x.cardId === '163' ? 'Drone' : x.label, x]));
const at = (x, c, r, f) => { x.col = c * 3; x.row = r * 3; x.facing = f; };
at(U.Blade, 4, 4, 2); at(U.Drone, 4, 6, 0); at(U.Gun, 2, 2, 2); at(U.Rifle, 10, 11, 0);
const look = (seat) => M.SEAT.lookOf(data, t.state, seat);
const read = (seat) => AI.featureMap(look(seat));
const dice = (w) => w.yellow + 1.5 * w.red;
const unitOf = (label) => M.SEAT.viewOf(data, t.state, 's1').units.find((u) => u.label === label);

{
  const f = AI.featuresOf(look('s1'));
  check('ONE FIXED LIST: every name once, a number for each, every one finite',
    [new Set(AI.FEATURES).size === AI.FEATURES.length, f.length === AI.FEATURES.length, f.every((x) => typeof x === 'number' && Number.isFinite(x))], [true, true, true]);
  check('THE FIRST READING is the 81 numbers the first data nights were written with, first and in their order',
    [AI.FIRST_READING, JSON.stringify(AI.FEATURES.slice(0, AI.FIRST_READING)) === JSON.stringify(fixture.names), AI.FEATURES.length > AI.FIRST_READING], [81, true, true]);
  const first = AI.featuresOf(look('s1'), AI.FIRST_READING);
  check('read alone (a model of the first reading), they are the same numbers as at the head of the whole reading',
    [first.length, JSON.stringify(first) === JSON.stringify(f.slice(0, AI.FIRST_READING))], [81, true]);
  const m = read('s1');
  check('ON THE STAGED BOARD, from RDL\'s seat: two Mechs of its own and no Drone against a Mech and a Drone, round 1, no Main Task',
    [m.my_mechs, m.my_drones, m.their_mechs, m.their_drones, m.d_mechs, m.round, m.task_none, m.my_partsDestroyed], [2, 0, 1, 1, 1, 1, 1, 0]);
  check('and every unit standing whole: what it is worth is what it costs, the tiebreak count its Parts and Drones',
    [m.my_worth === m.my_points, m.their_worth === m.their_points, m.my_standing > 0, m.their_standing > 0], [true, true, true, true]);
  check('no zone, no Box, no Commander on it: the race to the zones, the Commander and the Boxes read nothing',
    [m.my_zonesFirst, m.their_zonesFirst, m.my_zoneTurns, m.my_cmdSeen, m.my_cmdReach, m.my_boxNear], [0, 0, 0, 0, 0, 24]);
}
{
  // THE MIRROR: the same table read from both seats.
  const a = read('s1');
  const b = read('s2');
  const sides = AI.FEATURES.filter((n) => n.startsWith('my_')).map((n) => n.slice(3));
  const flipped = sides.filter((n) => a[`my_${n}`] !== b[`their_${n}`] || a[`their_${n}`] !== b[`my_${n}`]);
  const diffs = AI.FEATURES.filter((n) => n.startsWith('d_')).filter((n) => a[n] !== -b[n]);
  const table = AI.FEATURES.filter((n) => !/^(my_|their_|d_)/.test(n) && n !== 'firstPlayer').filter((n) => a[n] !== b[n]);
  check('THE MIRROR: one seat\'s own is the other\'s other, each difference turned round, the table the same (the First Player one seat\'s)',
    [flipped, diffs, table, a.firstPlayer + b.firstPlayer], [[], [], [], 1]);
}
{
  // A MELEE LOCK: the Blade put beside the Rifle (a Grid apart, diagonally).
  at(U.Blade, 9, 10, 2);
  const a = read('s1');
  const b = read('s2');
  check('A MELEE LOCK, counted from both seats: the Rifle beside the Blade is a locked Mech of UN\'s, and each seat counts the other\'s as it counts its own',
    [b.my_locked, a.their_locked, a.my_locked === b.their_locked], [1, 1, true]);
  at(U.Blade, 4, 4, 2);
}
{
  // REACH, NEXT ROUND: the Blade's Melee dice count against the Rifle when one walk of its own and its Shock Attack
  // bring it beside the Rifle, and not a Grid further. Everything else of RDL's is put far off.
  const blade = unitOf('Blade');
  const melee = blade.weapons.filter((w) => w.usable && w.type === 'Melee' && (w.ammo === undefined || w.ammo > 0));
  const shock = Math.max(0, ...melee.map((w) => w.shock ?? 0));
  const span = blade.move + shock;
  at(U.Gun, 0, 0, 2);
  at(U.Rifle, 11, 11, 0);
  at(U.Drone, 11, 0, 0);
  // Beside the Rifle is 10,10; a walk of `span` Grids there, straight along the row.
  at(U.Blade, Math.max(0, 10 - span), 10, 2);
  const near = read('s1');
  at(U.Blade, Math.max(0, 10 - span - 1), 10, 2);
  const far = read('s1');
  const bladeDice = melee.filter((w) => (w.shock ?? 0) === shock || span <= blade.move + (w.shock ?? 0)).reduce((n, w) => n + dice(w), 0);
  check(`REACH: a walk of ${blade.move} and a Shock Attack of ${shock} from beside the Rifle, the Blade's Melee dice count against it; a Grid further, they do not`,
    [near.my_reach >= bladeDice && bladeDice > 0, near.my_focus >= bladeDice, far.my_reach < near.my_reach], [true, true, true]);
}
{
  // SIGHT, THE ENGINE'S OWN, ON A REAL MAP: a Grid pair inside the Gun's Range where the engine says nothing blocks the
  // line, and one where a wall does. The Gun's Firing dice are aimed at the Rifle in the first and not in the second,
  // and the Rifle is under the Gun's fire (UN's `seen`) only in the first.
  t.state.map = 'alley';
  at(U.Blade, 0, 11, 2);
  at(U.Drone, 11, 0, 0);
  const gun = unitOf('Gun');
  const range = Math.max(...gun.weapons.filter((w) => w.usable && w.type === 'Firing').map((w) => w.range));
  let blocked = null;
  let clear = null;
  for (let c = 0; c < 12 && !(blocked && clear); c++) {
    for (let r = 0; r < 12 && !(blocked && clear); r++) {
      for (const [dc, dr] of [[0, 3], [3, 0], [2, 2], [1, 3], [3, 1]]) {
        if (c + dc > 11 || r + dr > 11 || dc + dr > range) continue;
        at(U.Gun, c, r, 2);
        at(U.Rifle, c + dc, r + dr, 0);
        const eyes = M.SEAT.sightedIn(data, t.state, U.Rifle.uid, [{ c: c + dc, r: r + dr }])[0];
        if (!eyes.includes(U.Gun.uid)) blocked ??= [c, r, c + dc, r + dr];
        else clear ??= [c, r, c + dc, r + dr];
      }
    }
  }
  check('on the Alley there is a pair of each kind inside the Gun\'s Range', [!!blocked, !!clear], [true, true]);
  const place = (p) => { at(U.Gun, p[0], p[1], 2); at(U.Rifle, p[2], p[3], 0); };
  place(clear);
  const gunDice = unitOf('Gun').weapons.filter((w) => w.usable && w.type === 'Firing' && w.range >= Math.abs(clear[2] - clear[0]) + Math.abs(clear[3] - clear[1])).reduce((n, w) => n + dice(w), 0);
  const open = read('s1');
  const openUn = read('s2');
  place(blocked);
  const shut = read('s1');
  const shutUn = read('s2');
  check('SIGHT: in the open the Gun\'s Firing dice are aimed at the Rifle; behind the wall none are',
    [open.my_aimed, shut.my_aimed], [gunDice, 0]);
  place(clear);
  const rifle = M.SEAT.viewOf(data, t.state, 's2').units.find((u) => u.label === 'Rifle');
  check('and the Rifle is under fire (UN\'s seen, what it is worth) in the open and not behind the wall; the mirror holds',
    [openUn.my_seen, openUn.my_seenWorth === rifle.points * rifle.health, shutUn.my_seen, open.their_seen === openUn.my_seen], [1, true, 0, true]);
  t.state.map = 'none';
}
{
  // THE RACE TO THE ZONES, THE BOXES, THE COMMANDER: the reading worked out on a table told what the engine would say
  // (a Look of our own: the staged view with a zone, a Box and a Commander added, walks of so many activations).
  at(U.Blade, 4, 4, 2); at(U.Drone, 4, 6, 0); at(U.Gun, 2, 2, 2); at(U.Rifle, 10, 11, 0);
  const base = M.SEAT.viewOf(data, t.state, 's1');
  const uid = Object.fromEntries(base.units.map((u) => [u.label === 'Gun' || u.label === 'Blade' || u.label === 'Rifle' ? u.label : 'Drone', u.uid]));
  const fake = (edit, turns, eyes = () => []) => {
    const v = structuredClone(base);
    edit(v);
    return { view: () => v, seen: (u, grids) => grids.map(() => eyes(u)), walk: (u, from) => from.map(() => (turns[u] === undefined ? null : { grids: turns[u] * 3, turns: turns[u] })) };
  };
  const zone = (cells) => (v) => v.zones.push({ id: 'z', name: 'Zed', cells, holder: null, control: null, scoring: true });
  const race = AI.featureMap(fake(zone(['6,6', '6,7']), { [uid.Gun]: 2, [uid.Blade]: 1, [uid.Rifle]: 3, [uid.Drone]: 2 }));
  check('THE ZONE RACE: RDL\'s nearest walks in in 1 activation, UN\'s in 2: RDL first, the activations summed for each',
    [race.my_zonesFirst, race.their_zonesFirst, race.d_zonesFirst, race.my_zoneTurns, race.their_zoneTurns], [1, 0, 1, 1, 2]);
  const level = AI.featureMap(fake(zone(['6,6']), { [uid.Gun]: 2, [uid.Blade]: 2, [uid.Rifle]: 2, [uid.Drone]: 3 }));
  check('level, nobody is first', [level.my_zonesFirst, level.their_zonesFirst], [0, 0]);
  const inside = AI.featureMap(fake(zone(['10,11']), { [uid.Gun]: 1, [uid.Blade]: 1 }));
  check('a unit standing in the zone is there already (0); a side with no road to it counts NEVER (9)',
    [inside.their_zoneTurns, inside.their_zonesFirst, AI.featureMap(fake(zone(['6,6']), {})).my_zoneTurns], [0, 1, 9]);
  const boxes = AI.featureMap(fake((v) => {
    v.boxes.push({ id: 'b', grid: { col: 3, row: 2 }, bearer: null });
    for (const u of v.units) u.hands = u.label === 'Gun' || u.label === 'Rifle' ? 1 : 0;
  }, {}));
  check('THE BOXES: from the nearest unit with a free hand to the nearest loose Box (the Gun 1 Grid off, the Rifle 16)',
    [boxes.my_boxNear, boxes.their_boxNear], [1, 16]);
  const rifle = base.units.find((u) => u.uid === uid.Rifle);
  const reachOf = Math.max(...rifle.weapons.filter((w) => w.usable && w.type === 'Firing').map((w) => w.range));
  const cmd = AI.featureMap(fake((v) => {
    const g = v.units.find((u) => u.uid === uid.Gun);
    g.commander = true;
    g.grid = { col: 10, row: Math.max(0, 11 - reachOf) };
  }, {}, (u) => (u === uid.Gun ? [uid.Rifle] : [])));
  check('THE COMMANDER: in the Rifle\'s Range and sight it is under fire, and the Rifle\'s dice could reach it next round',
    [cmd.my_cmdSeen, cmd.my_cmdReach > 0, cmd.their_cmdSeen], [1, true, 0]);
  const hidden = AI.featureMap(fake((v) => {
    const g = v.units.find((u) => u.uid === uid.Gun);
    g.commander = true;
    g.grid = { col: 10, row: Math.max(0, 11 - reachOf) };
  }, {}));
  check('and the same where the engine says the Rifle has no line to it: not under fire', hidden.my_cmdSeen, 0);
}
{
  // PACE: the Ace reads it in play (L3) for each plan it prices. The first reading costs well under a millisecond;
  // the whole one asks the engine for the sight of every unit that counts, on a real map.
  at(U.Blade, 4, 4, 2); at(U.Drone, 4, 6, 0); at(U.Gun, 2, 2, 2); at(U.Rifle, 6, 5, 0);
  t.state.map = 'alley';
  const l = look('s1');
  const t0 = performance.now();
  for (let i = 0; i < 2000; i++) AI.featuresOf(l, AI.FIRST_READING);
  const first = (performance.now() - t0) / 2000;
  const t1 = performance.now();
  for (let i = 0; i < 100; i++) AI.featuresOf(look('s1'));
  const whole = (performance.now() - t1) / 100;
  console.log(`       (the first reading ${first.toFixed(4)} ms, the whole ${whole.toFixed(3)} ms)`);
  check('PACE: the first reading takes well under a millisecond, the whole a few', [first < 0.5, whole < 10], [true, true]);
  t.state.map = 'none';
}
t.close();

console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
