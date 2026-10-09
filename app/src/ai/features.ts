// THE POSITION AS NUMBERS (M17 L1, the learned evaluator; AI-OPPONENT-PLAN.md section 4, M17). A table as one seat
// sees it, read into one fixed list of numbers: the same reading for the probe that writes the training data and for
// the Ace when it plays, so the two can never read the board two ways (a feature worked out twice is the classic
// failure of this kind of work). Each number is the table's, the seat's own side's (`my_`), the other side's
// (`their_`), or the difference of the two (`d_`); FEATURES names them all, in order. Read off the SeatView, and two
// questions put to the engine that a player answers by looking at the board: who could see a unit where it stands
// (walls, cover and Smoke counted), and how many activations a walk takes (walls walked round). A seat is never shown
// what it may not see, so neither is the model.
//
// THE FIRST 81 NUMBERS ARE THE FIRST READING (the first two data nights and every model trained on them); the numbers
// after them (2026-10-09, OTTO: "improve what it sees") read what those could not: who can shoot whom now, what each
// side can bring to bear next round and on which unit most, the damaged units under fire, the race to each zone the
// Main Task scores, the Commander's danger, the nearest loose Black Box; and each side's Secondary Task, what it has
// paid and what it could still pay. A model trained on the first 81 alone reads them as it always did
// (`featuresOf(look, 81)` reads no more than it needs).
import type { Outlook, SeatView, UnitView } from '../seat';
import { standingFor } from './evaluate';

type Side = SeatView['seat'];

// What a reading needs of a table: the seat's view of it, and the engine's own answers to those two questions. An
// Outlook has all three (seat.ts); the probe makes the same from the state it holds (seat.ts lookOf).
export type Look = Pick<Outlook, 'view' | 'seen' | 'walk'>;

const FAMILIES = ['control', 'vip', 'blackbox', 'terminal'] as const;
const ATTACKS = new Set(['Firing', 'Melee', 'Projectile']);
// How far apart two units are counted when one side has nobody to be near: past the far side of any board.
const FAR = 24;
// The activations a walk is counted at when no road leads to the zone (or there is nobody to walk): more than the
// rounds of a game.
const NEVER = 9;

// The table's own numbers.
const TABLE = [
  'round', 'roundsLeft', 'lastRound', 'phase', 'firstPlayer',
  ...FAMILIES.map((f) => `task_${f}`), 'task_none', 'taskVp', 'taskPerRound', 'taskFromRound',
  'zonesScoring', 'boxesLoose',
] as const;

// Each side's: what it has standing, what it can do with it, what it holds, and where it stands.
const SIDE = [
  'mechs', 'drones', 'points', 'worth', 'partsIntact', 'partsDamaged', 'partsDestroyed', 'torsoDamaged',
  'link', 'linkMax', 'fire', 'melee', 'launch', 'otherDice',
  'vp', 'zones', 'control', 'inZones', 'boxes', 'tokens', 'done', 'camo', 'standing', 'commander',
  'near', 'nearMin', 'spread', 'locked', 'threatened',
] as const;

// The differences that matter most, the seat's side less the other's.
const DIFF = ['worth', 'vp', 'zones', 'standing', 'fire', 'melee', 'mechs', 'threatened'] as const;

// THE SECOND READING, each side's: what the board lets it do.
//   aimed       its Firing dice that have an enemy in Range and in sight now (a Lock barring a gun counted)
//   reach       its attack dice that could reach an enemy next round: a walk and then the Action's Range
//   focus       the most of those dice it could bring on any one enemy
//   seen        its units an enemy gun has in Range and in sight now
//   seenWorth   what they are worth (points by health)
//   fragile     its units at half health or less
//   fragileSeen of them, those an enemy gun has in Range and in sight now
//   armor       the Armor of its Parts still standing
//   zonesFirst  the zones the Main Task scores that it can walk into in fewer activations than the other side
//   zoneTurns   the activations its nearest unit takes to each of those zones, summed (at most NEVER a zone)
//   cmdSeen     its Commander is in an enemy gun's Range and sight now
//   cmdReach    the enemy attack dice that could reach its Commander next round
//   boxNear     how far its nearest unit with a free hand stands from the nearest loose Black Box
const SIDE2 = [
  'aimed', 'reach', 'focus', 'seen', 'seenWorth', 'fragile', 'fragileSeen', 'armor',
  'zonesFirst', 'zoneTurns', 'cmdSeen', 'cmdReach', 'boxNear',
] as const;

const DIFF2 = ['aimed', 'reach', 'focus', 'seenWorth', 'zonesFirst', 'fragileSeen'] as const;

// EACH SIDE'S SECONDARY TASK (2026-10-09; OTTO: "we need to start getting secondary tasks in there as much as
// possible"), as the scorer reads its card (seat.ts SecondaryView):
//   secOn          it has one
//   secVp          the card's Victory Points (for Annihilation and Weapons Test, each)
//   secDestroy .. secZone   which way it pays: the Mech it names destroyed (Behead, Bounty Hunt, Planned
//                  Obsolescence), each enemy unit destroyed (Annihilation), its Mech standing at the end (Escort), each
//                  Part or Drone its Mech destroys (Weapons Test), no enemy Mech destroyed (Mercy), the zone held alone
//                  at the end (Excavation Claim)
//   secPaid        what it has paid so far
//   secNow         what it would pay if the game ended now, of what pays at the end
//   secLive        what it could still pay: the named Mech still standing to be destroyed, the enemy units still to be
//                  destroyed, its own Mech still to keep, Mercy still kept, the zone still to hold
//   secHealth      the Mech it names: its health (1 whole, 0 destroyed); -1 where it names none
//   secSeen        that Mech is under fire now from the squad opposing it
//   secReach       the attack dice the squad opposing that Mech could bring on it next round
const SIDE3 = [
  'secOn', 'secVp', 'secDestroy', 'secKills', 'secEscort', 'secTest', 'secMercy', 'secZone',
  'secPaid', 'secNow', 'secLive', 'secHealth', 'secSeen', 'secReach',
] as const;

const DIFF3 = ['secPaid', 'secNow', 'secLive'] as const;

// How many numbers the first reading has: what a model trained on it is given.
export const FIRST_READING = TABLE.length + 2 * SIDE.length + DIFF.length;

export const FEATURES: readonly string[] = [
  ...TABLE, ...SIDE.map((n) => `my_${n}`), ...SIDE.map((n) => `their_${n}`), ...DIFF.map((n) => `d_${n}`),
  ...SIDE2.map((n) => `my_${n}`), ...SIDE2.map((n) => `their_${n}`), ...DIFF2.map((n) => `d_${n}`),
  ...SIDE3.map((n) => `my_${n}`), ...SIDE3.map((n) => `their_${n}`), ...DIFF3.map((n) => `d_${n}`),
];

const manhattan = (a: UnitView['grid'], b: UnitView['grid']): number => Math.abs(a.col - b.col) + Math.abs(a.row - b.row);
const chebyshev = (a: UnitView['grid'], b: UnitView['grid']): number => Math.max(Math.abs(a.col - b.col), Math.abs(a.row - b.row));
// A unit on the board: deployed, not destroyed, and not a Projectile.
const standing = (u: UnitView): boolean => u.alive && u.deployed && u.kind !== 'projectile';
const dice = (w: UnitView['weapons'][number]): number => w.yellow + 1.5 * w.red;
const ready = (w: UnitView['weapons'][number]): boolean => w.usable && (w.ammo === undefined || w.ammo > 0);
const worthOf = (u: UnitView): number => u.points * u.health;

function sideOf(view: SeatView, side: Side, units: UnitView[]): Record<(typeof SIDE)[number], number> {
  const mine = units.filter((u) => u.side === side);
  const foes = units.filter((u) => u.side !== side);
  const mechs = mine.filter((u) => u.kind === 'mech');
  const parts = mine.flatMap((u) => u.parts);
  const weapons = mine.flatMap((u) => u.weapons.filter(ready));
  const sum = (ws: typeof weapons): number => ws.reduce((n, w) => n + dice(w), 0);
  const scoring = view.zones.filter((z) => z.scoring);
  const cells = new Set(scoring.flatMap((z) => z.cells));
  const nearest = mechs.map((m) => Math.min(FAR, ...foes.map((f) => manhattan(m.grid, f.grid))));
  let pairs = 0;
  let apart = 0;
  for (let i = 0; i < mechs.length; i++) {
    for (let j = i + 1; j < mechs.length; j++) { pairs += 1; apart += manhattan(mechs[i].grid, mechs[j].grid); }
  }
  // An enemy weapon that could reach the unit where it stands, by its Range alone.
  const threats = foes.flatMap((f) => f.weapons.filter((w) => ready(w) && ATTACKS.has(w.type)).map((w) => ({ at: f.grid, range: w.range })));
  return {
    mechs: mechs.length,
    drones: mine.filter((u) => u.kind === 'drone').length,
    points: mine.reduce((n, u) => n + u.points, 0),
    worth: mine.reduce((n, u) => n + u.points * u.health, 0),
    partsIntact: parts.filter((p) => p.state === 'intact').length,
    partsDamaged: parts.filter((p) => p.state === 'damaged').length,
    partsDestroyed: parts.filter((p) => p.state === 'destroyed').length,
    torsoDamaged: mechs.filter((m) => m.parts.some((p) => p.slot === 'torso' && p.state === 'damaged')).length,
    link: mechs.reduce((n, m) => n + (m.link ?? 0), 0),
    linkMax: mechs.reduce((n, m) => n + (m.linkMax ?? 0), 0),
    fire: sum(weapons.filter((w) => w.type === 'Firing')),
    melee: sum(weapons.filter((w) => w.type === 'Melee')),
    launch: sum(weapons.filter((w) => w.type === 'Projectile')),
    otherDice: sum(weapons.filter((w) => !ATTACKS.has(w.type))),
    vp: view.vp[side] ?? 0,
    zones: scoring.filter((z) => z.holder === side).length,
    control: scoring.filter((z) => z.control === side).length,
    inZones: mine.filter((u) => !u.lowValue && cells.has(`${u.grid.col},${u.grid.row}`)).length,
    boxes: view.boxes.filter((b) => b.bearer !== null && mine.some((u) => u.uid === b.bearer)).length,
    tokens: view.commandTokens[side] ?? 0,
    done: mine.filter((u) => u.done).length,
    camo: mine.filter((u) => u.camouflaged).length,
    standing: standingFor(view, side),
    commander: mine.some((u) => u.commander) ? 1 : 0,
    near: nearest.length ? nearest.reduce((n, x) => n + x, 0) / nearest.length : FAR,
    nearMin: nearest.length ? Math.min(...nearest) : FAR,
    spread: pairs ? apart / pairs : 0,
    locked: mechs.filter((m) => m.ground && foes.some((f) => f.locks && !f.camouflaged && chebyshev(f.grid, m.grid) === 1)).length,
    threatened: mine.filter((u) => threats.some((t) => manhattan(t.at, u.grid) <= t.range)).length,
  };
}

// WHAT THE BOARD LETS EACH SIDE DO (the second reading). Sight is the engine's (Look.seen: who of the other squad has
// a line to a unit where it stands, clear or obstructed), asked once for each unit that counts; the walks to the zones
// are the engine's too (Look.walk, the road its own Movement is drawn with). Everything else is the view's.
type Board = Record<(typeof SIDE2)[number] | (typeof SIDE3)[number], number>;
function boardOf(look: Look, view: SeatView, units: UnitView[]): Record<Side, Board> {
  const byUid = new Map(units.map((u) => [u.uid, u]));
  // The units a shot or a walk is worth counting for: Low Value ones neither hold a zone nor score.
  const counts = units.filter((u) => !u.lowValue);
  // A Ground unit beside an enemy that Melee Locks it fires nothing but Melee Firing (4.3.5).
  const lockedUids = new Set(units.filter((u) => u.ground && units.some((f) => f.side !== u.side && f.locks && !f.camouflaged && chebyshev(f.grid, u.grid) === 1)).map((u) => u.uid));
  const guns = (u: UnitView): UnitView['weapons'] => u.weapons.filter((w) => ready(w) && w.type === 'Firing' && (!lockedUids.has(u.uid) || w.meleeFiring));
  // Who sees each unit that counts, of the units on the board.
  const seenBy = new Map<number, UnitView[]>();
  for (const u of counts) {
    const eyes = look.seen(u.uid, [u.grid])[0] ?? [];
    seenBy.set(u.uid, eyes.map((id) => byUid.get(id)).filter((e): e is UnitView => !!e && e.side !== u.side));
  }
  // An enemy gun has it in Range and in sight now.
  const underFire = (u: UnitView): boolean => (seenBy.get(u.uid) ?? []).some((e) => guns(e).some((w) => manhattan(e.grid, u.grid) <= w.range));
  // A weapon of `m` could be brought on `u` next round: a walk of its own Movement, then the Action's reach.
  const reaches = (m: UnitView, w: UnitView['weapons'][number], u: UnitView): boolean => {
    if (w.type === 'Melee') {
      const dc = Math.abs(m.grid.col - u.grid.col);
      const dr = Math.abs(m.grid.row - u.grid.row);
      return Math.max(0, dc - 1) + Math.max(0, dr - 1) <= m.move + (w.shock ?? 0);
    }
    const strike = w.type === 'Projectile' ? (w.strike ?? 0) : 0;
    return manhattan(m.grid, u.grid) <= m.move + w.range + strike;
  };
  const attacks = (u: UnitView): UnitView['weapons'] => u.weapons.filter((w) => ready(w) && ATTACKS.has(w.type));
  // The zones the Main Task scores, and for each the fewest activations each side's nearest unit takes to walk in.
  const scoring = view.zones.filter((z) => z.scoring).map((z) => z.cells.map((ref) => {
    const [col, row] = ref.split(',').map(Number);
    return { col, row };
  }));
  const walkers = counts.filter((u) => u.move > 0 || u.kind === 'drone');
  const turnsTo = (side: Side, zone: { col: number; row: number }[]): number => {
    let best = NEVER;
    for (const u of walkers) {
      if (u.side !== side) continue;
      if (zone.some((g) => g.col === u.grid.col && g.row === u.grid.row)) return 0;
      const w = look.walk(u.uid, [u.grid], zone)[0];
      if (w && w.turns < best) best = w.turns;
    }
    return best;
  };
  const turns = scoring.map((zone) => ({ s1: turnsTo('s1', zone), s2: turnsTo('s2', zone) }));
  const loose = view.boxes.filter((b) => b.bearer === null && b.grid).map((b) => b.grid!);
  // The attack dice the squad opposing `u` could bring on it next round.
  const dangerTo = (u: UnitView): number => units.filter((m) => m.side !== u.side)
    .reduce((n, m) => n + attacks(m).filter((w) => reaches(m, w, u)).reduce((k, w) => k + dice(w), 0), 0);
  const out = {} as Record<Side, Board>;
  for (const side of ['s1', 's2'] as Side[]) {
    const other: Side = side === 's1' ? 's2' : 's1';
    const mine = units.filter((u) => u.side === side);
    const theirs = counts.filter((u) => u.side !== side);
    const ours = counts.filter((u) => u.side === side);
    let aimed = 0;
    let reach = 0;
    for (const m of mine) {
      for (const w of guns(m)) {
        if (theirs.some((u) => manhattan(m.grid, u.grid) <= w.range && (seenBy.get(u.uid) ?? []).some((e) => e.uid === m.uid))) aimed += dice(w);
      }
      for (const w of attacks(m)) if (theirs.some((u) => reaches(m, w, u))) reach += dice(w);
    }
    const onEach = theirs.map((u) => mine.reduce((n, m) => n + attacks(m).filter((w) => reaches(m, w, u)).reduce((k, w) => k + dice(w), 0), 0));
    const seen = ours.filter(underFire);
    const fragile = ours.filter((u) => u.health <= 0.5);
    const commander = ours.find((u) => u.commander);
    const hands = mine.filter((u) => u.hands > 0);
    // Its Secondary Task: the card, and the Mech it names (read off every unit of the view, deployed or not: a Mech
    // destroyed is in it with no health).
    const card = view.secondary?.[side] ?? null;
    const named = card && card.target !== null ? view.units.find((u) => u.uid === card.target) : undefined;
    const namedUp = named && standing(named) ? named : undefined;
    const alive = !!named && named.alive;
    const kind = card?.kind ?? '';
    const vp = card?.vp ?? 0;
    const enemyUnits = units.filter((u) => u.side !== side && !u.lowValue);
    const keptMercy = !!card && card.kills.mechs - card.kills.integrity === 0;
    const heldAlone = !!card && card.zone !== null && view.zones.some((z) => z.id === card.zone && z.holder === side);
    const secNow = kind === 'survive-designated' ? (alive ? vp : 0)
      : kind === 'no-mech-lost' ? (keptMercy ? vp : 0)
      : kind === 'hold-zone' ? (heldAlone ? vp : 0)
      : 0;
    const secLive = !card ? 0
      : kind === 'destroy-designated' ? (card.paid === 0 && alive ? vp : 0)
      : kind === 'per-kill' ? enemyUnits.reduce((n, u) => n + (u.kind === 'mech' ? vp : u.kind === 'drone' ? 1 : 0), 0)
      : kind === 'survive-designated' ? (alive ? vp : 0)
      : kind === 'per-kill-by-unit' ? (alive ? vp * enemyUnits.reduce((n, u) => n + (u.kind === 'mech' ? u.parts.filter((p) => p.state !== 'destroyed').length : 1), 0) : 0)
      : kind === 'no-mech-lost' ? (keptMercy ? vp : 0)
      : kind === 'hold-zone' ? (card.paid === 0 ? vp : 0)
      : 0;
    out[side] = {
      aimed,
      reach,
      focus: onEach.length ? Math.max(...onEach) : 0,
      seen: seen.length,
      seenWorth: seen.reduce((n, u) => n + worthOf(u), 0),
      fragile: fragile.length,
      fragileSeen: fragile.filter(underFire).length,
      armor: mine.reduce((n, u) => n + u.parts.filter((p) => p.state !== 'destroyed').reduce((k, p) => k + p.armor, 0), 0),
      zonesFirst: turns.filter((t) => t[side] < t[other]).length,
      zoneTurns: turns.reduce((n, t) => n + t[side], 0),
      cmdSeen: commander && underFire(commander) ? 1 : 0,
      cmdReach: commander ? dangerTo(commander) : 0,
      boxNear: loose.length && hands.length ? Math.min(...hands.flatMap((u) => loose.map((g) => manhattan(u.grid, g)))) : FAR,
      secOn: card ? 1 : 0,
      secVp: vp,
      secDestroy: kind === 'destroy-designated' ? 1 : 0,
      secKills: kind === 'per-kill' ? 1 : 0,
      secEscort: kind === 'survive-designated' ? 1 : 0,
      secTest: kind === 'per-kill-by-unit' ? 1 : 0,
      secMercy: kind === 'no-mech-lost' ? 1 : 0,
      secZone: kind === 'hold-zone' ? 1 : 0,
      secPaid: card?.paid ?? 0,
      secNow,
      secLive,
      secHealth: named ? (named.alive ? named.health : 0) : -1,
      secSeen: namedUp && seenBy.has(namedUp.uid) && underFire(namedUp) ? 1 : 0,
      secReach: namedUp ? dangerTo(namedUp) : 0,
    };
  }
  return out;
}

// The numbers, by name, as many of FEATURES as `count` asks for (all of them unless told): for a test, a probe, a
// reader, or a model trained on the first reading alone.
export function featureMap(look: Look, count = FEATURES.length): Record<string, number> {
  const view = look.view();
  const units = view.units.filter(standing);
  const my = sideOf(view, view.seat, units);
  const their = sideOf(view, view.other, units);
  const family = view.task?.family ?? '';
  const out: Record<string, number> = {
    round: view.round,
    roundsLeft: Math.max(0, view.roundLimit - view.round),
    lastRound: view.round >= view.roundLimit ? 1 : 0,
    phase: view.phase,
    firstPlayer: view.firstPlayer === view.seat ? 1 : 0,
    ...Object.fromEntries(FAMILIES.map((f) => [`task_${f}`, family === f ? 1 : 0])),
    task_none: view.task ? 0 : 1,
    taskVp: view.task?.vp ?? 0,
    taskPerRound: view.task?.cadence === 'per-round' ? 1 : 0,
    taskFromRound: view.task?.fromRound ?? 0,
    zonesScoring: view.zones.filter((z) => z.scoring).length,
    boxesLoose: view.boxes.filter((b) => b.bearer === null).length,
  };
  for (const n of SIDE) { out[`my_${n}`] = my[n]; out[`their_${n}`] = their[n]; }
  for (const n of DIFF) out[`d_${n}`] = my[n] - their[n];
  if (count <= FIRST_READING) return out;
  const board = boardOf(look, view, units);
  for (const n of [...SIDE2, ...SIDE3]) { out[`my_${n}`] = board[view.seat][n]; out[`their_${n}`] = board[view.other][n]; }
  for (const n of [...DIFF2, ...DIFF3]) out[`d_${n}`] = board[view.seat][n] - board[view.other][n];
  return out;
}

// The numbers in FEATURES' order: the first `count` of them (all unless told).
export function featuresOf(look: Look, count = FEATURES.length): number[] {
  const m = featureMap(look, count);
  return FEATURES.slice(0, count).map((n) => m[n]);
}
