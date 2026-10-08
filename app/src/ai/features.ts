// THE POSITION AS NUMBERS (M17 L1, the learned evaluator; AI-OPPONENT-PLAN.md section 4, M17). A table as one seat
// sees it, read into one fixed list of numbers: the same reading for the probe that writes the training data and for
// the Ace when it plays, so the two can never read the board two ways (a feature worked out twice is the classic
// failure of this kind of work). Each number is the table's, the seat's own side's (`my_`), the other side's
// (`their_`), or the difference of the two (`d_`); FEATURES names them all, in order. Read off the SeatView alone: a
// seat is never shown what it may not see, so neither is the model.
import type { SeatView, UnitView } from '../seat';
import { standingFor } from './evaluate';

type Side = SeatView['seat'];

const FAMILIES = ['control', 'vip', 'blackbox', 'terminal'] as const;
const ATTACKS = new Set(['Firing', 'Melee', 'Projectile']);
// How far apart two units are counted when one side has nobody to be near: past the far side of any board.
const FAR = 24;

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

export const FEATURES: readonly string[] = [
  ...TABLE, ...SIDE.map((n) => `my_${n}`), ...SIDE.map((n) => `their_${n}`), ...DIFF.map((n) => `d_${n}`),
];

const manhattan = (a: UnitView['grid'], b: UnitView['grid']): number => Math.abs(a.col - b.col) + Math.abs(a.row - b.row);
const chebyshev = (a: UnitView['grid'], b: UnitView['grid']): number => Math.max(Math.abs(a.col - b.col), Math.abs(a.row - b.row));
// A unit on the board: deployed, not destroyed, and not a Projectile.
const standing = (u: UnitView): boolean => u.alive && u.deployed && u.kind !== 'projectile';
const dice = (w: UnitView['weapons'][number]): number => w.yellow + 1.5 * w.red;
const ready = (w: UnitView['weapons'][number]): boolean => w.usable && (w.ammo === undefined || w.ammo > 0);

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

// The numbers, by name: for a test, a probe, or a reader.
export function featureMap(view: SeatView): Record<string, number> {
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
  return out;
}

// The numbers in FEATURES' order.
export function featuresOf(view: SeatView): number[] {
  const m = featureMap(view);
  return FEATURES.map((n) => m[n]);
}
