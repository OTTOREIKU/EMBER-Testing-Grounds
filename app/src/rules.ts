import type { Side, SmokeScreen, TerrainPiece, Token } from './types';

export const LG = 12;

// ---------- smoke screens (rulebook 4.16) ----------

export function smokeKey(s: { col: number; row: number }): string {
  return `${s.col},${s.row}`;
}

export function smokeAt(smoke: SmokeScreen[], c: number, r: number, side?: Side): SmokeScreen[] {
  return smoke.filter((s) => s.col === c && s.row === r && (side === undefined || s.side === side));
}

// Contact is edge sharing, so diagonal-only corner touch does not connect (4.2.3).
export function smokeNeighbours(a: SmokeScreen, b: SmokeScreen): boolean {
  return Math.abs(a.col - b.col) + Math.abs(a.row - b.row) === 1;
}

export function smokeGroups(smoke: SmokeScreen[], side: Side): SmokeScreen[][] {
  const mine = smoke.filter((s) => s.side === side);
  const seen = new Set<number>();
  const groups: SmokeScreen[][] = [];
  for (let i = 0; i < mine.length; i++) {
    if (seen.has(i)) continue;
    const group: SmokeScreen[] = [];
    const queue = [i];
    seen.add(i);
    while (queue.length) {
      const at = queue.pop()!;
      group.push(mine[at]);
      for (let j = 0; j < mine.length; j++) {
        if (seen.has(j) || !smokeNeighbours(mine[at], mine[j])) continue;
        seen.add(j);
        queue.push(j);
      }
    }
    groups.push(group);
  }
  return groups;
}

export interface Dissipation {
  isolated: SmokeScreen[];
  groups: SmokeScreen[][];
}

// The End Phase snapshot is taken once and then applied, which is what makes the
// merge and split notes on p.77 fall out on their own.
export function dissipationFor(smoke: SmokeScreen[], side: Side): Dissipation {
  const groups = smokeGroups(smoke, side);
  return {
    isolated: groups.filter((g) => g.length === 1).map((g) => g[0]),
    groups: groups.filter((g) => g.length > 1),
  };
}

export function smokeBlocks(a: Token, b: Token, smoke: SmokeScreen[]): boolean {
  if (!smoke.length) return false;
  const grids = new Set(smoke.map(smokeKey));
  const inSmoke = (t: Token): boolean => {
    if (t.aerial) return false;
    for (let dc = 0; dc < t.size; dc++) {
      for (let dr = 0; dr < t.size; dr++) {
        if (grids.has(`${Math.floor((t.col + dc) / 3)},${Math.floor((t.row + dr) / 3)}`)) return true;
      }
    }
    return false;
  };
  if (inSmoke(a) || inSmoke(b)) return true;

  // Aerial units are not exempt from smoke the way they are from terrain (4.16).
  const ax = a.col + a.size / 2;
  const ay = a.row + a.size / 2;
  const bx = b.col + b.size / 2;
  const by = b.row + b.size / 2;
  const steps = Math.max(2, Math.ceil(Math.hypot(bx - ax, by - ay) * 3));
  for (let i = 1; i < steps; i++) {
    const x = ax + ((bx - ax) * i) / steps;
    const y = ay + ((by - ay) * i) / steps;
    if (grids.has(`${Math.floor(x / 3)},${Math.floor(y / 3)}`)) return true;
  }
  return false;
}

export interface LargeGrid {
  c: number;
  r: number;
}

// Contact is Small-Grid edge overlap (4.2.3): footprints sharing an edge, or
// overlapping outright (an Aerial unit over a ground one counts, Supplement
// "Overlapping"). A corner-only touch is NOT Contact.
export function inContact(a: Token, b: Token): boolean {
  const gapX = Math.max(a.col - (b.col + b.size), b.col - (a.col + a.size));
  const gapY = Math.max(a.row - (b.row + b.size), b.row - (a.row + a.size));
  // gap < 0 means overlap on that axis; gap === 0 means edges meet exactly.
  if (gapX < 0 && gapY < 0) return true;
  return (gapX === 0 && gapY < 0) || (gapY === 0 && gapX < 0);
}

export function largeGridOf(t: { col: number; row: number }): LargeGrid {
  return { c: Math.floor(t.col / 3), r: Math.floor(t.row / 3) };
}

// Where inside Large Grid (c,r) a unit of this size actually fits. A Grid is 3x3
// small cells, so a 1x1 or 2x2 unit sharing it with terrain has to take the free
// corner rather than the middle. Returns the small-cell origin, or null if the
// unit cannot stand in that Grid at all. `toward` biases the choice, so a unit
// hugs the side it arrived from instead of jumping across the Grid.
export function standingSpot(
  c: number,
  r: number,
  size: 1 | 2 | 3,
  aerial: boolean,
  terrain: TerrainPiece[],
  tokens: Token[],
  ignoreUid?: number,
  toward?: { col: number; row: number },
): { col: number; row: number } | null {
  if (c < 0 || r < 0 || c >= LG || r >= LG) return null;
  const maxOff = 3 - size;
  const mid = (size - 1) / 2;
  const centre = { col: c * 3 + 1, row: r * 3 + 1 };
  const score = (col: number, row: number): number => {
    const cx = col + mid;
    const cy = row + mid;
    const home = Math.abs(cx - centre.col) + Math.abs(cy - centre.row);
    if (!toward) return home;
    return home + 0.5 * (Math.abs(cx - toward.col) + Math.abs(cy - toward.row));
  };
  const spots: { col: number; row: number }[] = [];
  for (let oc = 0; oc <= maxOff; oc++) for (let or = 0; or <= maxOff; or++) spots.push({ col: c * 3 + oc, row: r * 3 + or });
  spots.sort((a, b) => score(a.col, a.row) - score(b.col, b.row));
  if (aerial) return spots[0];

  const blocked = new Set<string>();
  for (const p of terrain) for (const cell of p.subCells) blocked.add(`${cell.col},${cell.row}`);
  for (const t of tokens) {
    if (t.uid === ignoreUid || t.aerial) continue;
    for (let dc = 0; dc < t.size; dc++) for (let dr = 0; dr < t.size; dr++) blocked.add(`${t.col + dc},${t.row + dr}`);
  }
  for (const spot of spots) {
    let ok = true;
    outer: for (let dc = 0; dc < size; dc++) {
      for (let dr = 0; dr < size; dr++) {
        if (blocked.has(`${spot.col + dc},${spot.row + dr}`)) {
          ok = false;
          break outer;
        }
      }
    }
    if (ok) return spot;
  }
  return null;
}

// Every legal standing spot for a unit INSIDE the Large Grid it is already in,
// with the illegal ones kept in the list so a picker can grey them rather than
// silently offering fewer squares. Which spot a small unit takes is a real
// choice: Contact is judged at Small-Grid resolution (4.2.3), so the edge it
// touches decides who it is in Contact with even though the Grid is the same.
export function spotsInGrid(
  t: Token,
  terrain: TerrainPiece[],
  tokens: Token[],
): { col: number; row: number; ok: boolean; here: boolean }[] {
  const c = Math.floor(t.col / 3);
  const r = Math.floor(t.row / 3);
  const maxOff = 3 - t.size;
  const blocked = new Set<string>();
  if (!t.aerial) {
    for (const p of terrain) for (const cell of p.subCells) blocked.add(`${cell.col},${cell.row}`);
    for (const o of tokens) {
      if (o.uid === t.uid || o.aerial || o.deployed === false) continue;
      for (let dc = 0; dc < o.size; dc++) for (let dr = 0; dr < o.size; dr++) blocked.add(`${o.col + dc},${o.row + dr}`);
    }
  }
  const out: { col: number; row: number; ok: boolean; here: boolean }[] = [];
  for (let or = 0; or <= maxOff; or++) {
    for (let oc = 0; oc <= maxOff; oc++) {
      const col = c * 3 + oc;
      const row = r * 3 + or;
      let ok = true;
      outer: for (let dc = 0; dc < t.size; dc++) {
        for (let dr = 0; dr < t.size; dr++) {
          if (blocked.has(`${col + dc},${row + dr}`)) { ok = false; break outer; }
        }
      }
      out.push({ col, row, ok, here: col === t.col && row === t.row });
    }
  }
  return out;
}

export function canStandIn(
  c: number,
  r: number,
  size: 1 | 2 | 3,
  aerial: boolean,
  terrain: TerrainPiece[],
  tokens: Token[],
  ignoreUid?: number,
): boolean {
  return standingSpot(c, r, size, aerial, terrain, tokens, ignoreUid) !== null;
}

interface MoveSearch {
  dist: Map<string, number>;
  parent: Map<string, string>;
  reachable: (LargeGrid & { dist: number })[];
}

export interface MoveOpts {
  // Extra Movement Range charged for leaving a Large Grid, which is what Break
  // Away costs (4.3.5). Flying and Forced Movement leave this out.
  exitCost?: (c: number, r: number) => number;
  // Large Grids a Large Unit may enter by Crushing what is already there. The
  // Movement Action ends on arrival (4.3.6), so these are never expanded.
  crushable?: (c: number, r: number) => boolean;
  // Large Grids this unit may occupy at all, whatever it can afford. A Tether
  // leash (PDLH-202) is the only user today. Deliberately NOT folded into
  // exitCost: a price is something a rich Movement Range buys past, and the
  // leash does not care how much Range you have.
  allowed?: (c: number, r: number) => boolean;
  // LPA-21 Firefly, 匿踪 Stealth: while Optically Camouflaged or in Low Profile,
  // this unit's movement ROUTE may pass through other units. A legality like
  // `allowed`, not a price like `exitCost` -- and route-only: the landing still
  // has to be legal, and Break Away is still charged, because this is
  // pass-through, not flight.
  phaseThrough?: boolean;
}

// One search serving both the range overlay and the route a unit will actually
// walk, so the path drawn is the path the search found rather than a straight
// line. Steps normally cost 1, but Break Away makes leaving a Grid dearer, so
// this is a cheapest-first walk rather than a plain breadth-first one.
function searchMoves(
  t: Token,
  steps: number,
  terrain: TerrainPiece[],
  tokens: Token[],
  flying: boolean,
  opts?: MoveOpts,
): MoveSearch {
  const start = largeGridOf(t);
  const dist = new Map<string, number>([[`${start.c},${start.r}`, 0]]);
  const parent = new Map<string, string>();
  const reachable: (LargeGrid & { dist: number })[] = [];
  const crushed = new Set<string>();
  const queue: (LargeGrid & { d: number })[] = [{ ...start, d: 0 }];
  while (queue.length) {
    let best = 0;
    for (let i = 1; i < queue.length; i++) if (queue[i].d < queue[best].d) best = i;
    const g = queue.splice(best, 1)[0];
    const key = `${g.c},${g.r}`;
    if (g.d > (dist.get(key) ?? Infinity)) continue;
    // A Crush ends the Movement Action the moment the Grid is entered.
    if (crushed.has(key)) continue;
    const exit = flying || t.aerial ? 0 : opts?.exitCost?.(g.c, g.r) ?? 0;
    for (const [dc, dr] of [[0, -1], [1, 0], [0, 1], [-1, 0]] as const) {
      const n = { c: g.c + dc, r: g.r + dr };
      const nk = `${n.c},${n.r}`;
      if (n.c < 0 || n.r < 0 || n.c >= LG || n.r >= LG) continue;
      // Off-limits Grids are dropped before anything is priced, and dropped as
      // impassable rather than merely un-endable, so a leash cannot be stepped
      // over. The unit's OWN Grid is never tested: it is already standing
      // there, and a leash that no longer reaches has already been cut.
      if (opts?.allowed && !opts.allowed(n.c, n.r)) continue;
      const d = g.d + 1 + exit;
      if (d > steps || d >= (dist.get(nk) ?? Infinity)) continue;
      const standable = canStandIn(n.c, n.r, t.size, t.aerial, terrain, tokens, t.uid);
      const crush = !standable && !flying && !t.aerial && (opts?.crushable?.(n.c, n.r) ?? false);
      // The empty token list is the whole trick, and the only thing standing
      // between this and a Mech walking through a building: standingSpot folds
      // terrain subCells and unit footprints into ONE blocked set, so a naive
      // `passable = true` would open both. Re-asking canStandIn against TERRAIN
      // ONLY answers "is it just units in the way?", which is exactly what the
      // card grants.
      const phase = !standable && !flying && !t.aerial && !!opts?.phaseThrough
        && canStandIn(n.c, n.r, t.size, t.aerial, terrain, [], t.uid);
      const passable = flying || t.aerial ? true : standable || crush || phase;
      if (!passable) continue;
      dist.set(nk, d);
      parent.set(nk, key);
      queue.push({ ...n, d });
      if (crush) crushed.add(nk);
      if (standable || crush) reachable.push({ ...n, dist: d });
    }
  }
  const seen = new Set<string>();
  return {
    dist,
    parent,
    reachable: reachable
      .sort((a, b) => a.dist - b.dist)
      .filter((g) => {
        const k = `${g.c},${g.r}`;
        if (seen.has(k) || (g.c === start.c && g.r === start.r)) return false;
        seen.add(k);
        return g.dist === dist.get(k);
      }),
  };
}

// The direction Forced Movement travels for Knockback and Push: the straight
// line running away from the attacker, snapped to one of the four orthogonal
// steps. A shot from directly on a diagonal falls back to the attacker's facing,
// which is the "direction the attacker is facing" the appendix note describes.
export function attackDirection(attacker: Token, victim: Token): { dc: number; dr: number } {
  const a = largeGridOf(attacker);
  const b = largeGridOf(victim);
  const dc = b.c - a.c;
  const dr = b.r - a.r;
  if (Math.abs(dc) > Math.abs(dr)) return { dc: Math.sign(dc), dr: 0 };
  if (Math.abs(dr) > Math.abs(dc)) return { dc: 0, dr: Math.sign(dr) };
  const facing = [[0, -1], [1, 0], [0, 1], [-1, 0]][attacker.facing] as [number, number];
  return { dc: facing[0], dr: facing[1] };
}

// Where Knockback X actually lands the victim. The move is a straight line and
// stops early the moment a Unit or Terrain blocks it, and a Flying victim is
// blocked too, which is the one place Flying Movement does not pass through
// things (appendix, Knockback X).
export function knockbackPath(
  victim: Token,
  dir: { dc: number; dr: number },
  grids: number,
  terrain: TerrainPiece[],
  tokens: Token[],
): LargeGrid[] {
  const path: LargeGrid[] = [];
  // A Barricade "can neither move, be moved, nor be Crushed" (FAQ E6/M13, Rules
  // Supplement 1.1.3), so a Knockback or a Push aimed at one travels nowhere.
  // It belongs here rather than at the two callers: main.ts and matchhud.ts each
  // build their own shove UI on this one path, and both already read an empty
  // path as "blocked, but you may still turn it" - which is the right answer,
  // since 3.4.4's facing choice survives a victim that could not be moved.
  // The sibling half of the rule is already in crushTargets below.
  if (victim.barricade) return path;
  let at = largeGridOf(victim);
  for (let i = 0; i < grids; i++) {
    const next = { c: at.c + dir.dc, r: at.r + dir.dr };
    if (next.c < 0 || next.r < 0 || next.c >= LG || next.r >= LG) break;
    if (!canStandIn(next.c, next.r, victim.size, false, terrain, tokens, victim.uid)) break;
    path.push(next);
    at = next;
  }
  return path;
}

export interface CrushVictims {
  units: Token[];
  terrain: TerrainPiece[];
}

// What a Large Unit would Crush by entering Large Grid (c,r), or null when the
// Grid holds something it cannot Crush (4.3.6). Only Large Units Crush, and only
// Units smaller than themselves; Destructible Terrain in the way is destroyed.
export function crushTargets(
  t: Token,
  c: number,
  r: number,
  terrain: TerrainPiece[],
  tokens: Token[],
): CrushVictims | null {
  if (t.size !== 3 || t.aerial) return null;
  // An Optical Camouflage unit cannot Crush anything (FAQ I3/I9) — revealing
  // is what Crushing would mean, and the ruling simply forbids it.
  if ((t.statuses ?? []).filter((s) => s === 'camouflage').length > 0) return null;
  if (c < 0 || r < 0 || c >= LG || r >= LG) return null;
  const covers = (cells: { col: number; row: number }[]) =>
    cells.some((cell) => Math.floor(cell.col / 3) === c && Math.floor(cell.row / 3) === r);

  const hitTerrain: TerrainPiece[] = [];
  for (const p of terrain) {
    if (!covers(p.subCells)) continue;
    if (!p.isFragile) return null;
    hitTerrain.push(p);
  }
  const units: Token[] = [];
  for (const o of tokens) {
    if (o.uid === t.uid || o.aerial) continue;
    const cells: { col: number; row: number }[] = [];
    for (let dc = 0; dc < o.size; dc++) for (let dr = 0; dr < o.size; dr++) cells.push({ col: o.col + dc, row: o.row + dr });
    if (!covers(cells)) continue;
    if (o.size >= t.size) return null;
    // A Barricade can neither move nor be Crushed (FAQ E6), so a grid holding
    // one cannot be entered at all.
    if (o.barricade) return null;
    units.push(o);
  }
  if (!units.length && !hitTerrain.length) return null;
  return { units, terrain: hitTerrain };
}

export function reachableGrids(
  t: Token,
  steps: number,
  terrain: TerrainPiece[],
  tokens: Token[],
  flying: boolean,
  opts?: MoveOpts,
): (LargeGrid & { dist: number })[] {
  return searchMoves(t, steps, terrain, tokens, flying, opts).reachable;
}

// The route from the unit's grid to `to`, inclusive of both ends. Empty when the
// target is out of range or unreachable.
export function movePath(
  t: Token,
  to: LargeGrid,
  steps: number,
  terrain: TerrainPiece[],
  tokens: Token[],
  flying: boolean,
  opts?: MoveOpts,
): LargeGrid[] {
  const { dist, parent } = searchMoves(t, steps, terrain, tokens, flying, opts);
  const goal = `${to.c},${to.r}`;
  if (!dist.has(goal)) return [];
  const path: LargeGrid[] = [];
  let at: string | undefined = goal;
  while (at) {
    const [c, r] = at.split(',').map(Number);
    path.unshift({ c, r });
    at = parent.get(at);
  }
  return path;
}

// One cursor sample against a route being traced by hand. Returns the new route,
// or null when the sample changes nothing. Backing onto the previous grid rubs
// the last step out; a gap left by a fast cursor is bridged by the shortest legal
// run; a run that would cross the route already drawn is refused, so the trace
// stays a simple path the unit can actually walk.
// What a drawn route has already spent. Every step is 1, plus whatever Break Away
// adds for leaving each Grid along the way.
export function pathCost(path: LargeGrid[], flying: boolean, opts?: MoveOpts): number {
  if (path.length < 2) return 0;
  let n = path.length - 1;
  if (!flying && opts?.exitCost) for (let i = 0; i < path.length - 1; i++) n += opts.exitCost(path[i].c, path[i].r);
  return n;
}

export function extendPath(
  path: LargeGrid[],
  to: LargeGrid,
  t: Token,
  steps: number,
  terrain: TerrainPiece[],
  tokens: Token[],
  flying: boolean,
  opts?: MoveOpts,
): LargeGrid[] | null {
  if (!path.length) return null;
  const last = path[path.length - 1];
  if (last.c === to.c && last.r === to.r) return null;
  const prev = path[path.length - 2];
  if (prev && prev.c === to.c && prev.r === to.r) return path.slice(0, -1);
  if (path.some((g) => g.c === to.c && g.r === to.r)) return null;
  const budget = steps - pathCost(path, flying || t.aerial, opts);
  if (budget <= 0) return null;
  const from = { ...t, col: last.c * 3 + 1, row: last.r * 3 + 1 };
  const run = movePath(from, to, budget, terrain, tokens, flying, opts).slice(1);
  if (!run.length) return null;
  if (run.some((g) => path.some((p) => p.c === g.c && p.r === g.r))) return null;
  return [...path, ...run];
}

export function losBetween(
  a: Token,
  b: Token,
  terrain: TerrainPiece[],
  tokens: Token[],
): 'clear' | 'obstructed' | 'blocked' {
  if (a.aerial || b.aerial) return 'clear';
  const losCells = new Set<string>();
  const obstructCells = new Set<string>();
  for (const p of terrain) {
    for (const c of p.subCells) {
      obstructCells.add(`${c.col},${c.row}`);
      if (p.blocksLos) losCells.add(`${c.col},${c.row}`);
    }
  }
  for (const t of tokens) {
    if (t.uid === a.uid || t.uid === b.uid || t.aerial) continue;
    for (let dc = 0; dc < t.size; dc++) for (let dr = 0; dr < t.size; dr++) obstructCells.add(`${t.col + dc},${t.row + dr}`);
  }

  const basePoints = (t: Token): { x: number; y: number }[] => {
    const pts: { x: number; y: number }[] = [];
    for (let i = 0; i <= 2; i++) {
      for (let j = 0; j <= 2; j++) {
        pts.push({ x: t.col + 0.08 + (i * (t.size - 0.16)) / 2, y: t.row + 0.08 + (j * (t.size - 0.16)) / 2 });
      }
    }
    return pts;
  };

  const inBase = (x: number, y: number, t: Token) => x >= t.col && x < t.col + t.size && y >= t.row && y < t.row + t.size;

  let allBlocked = true;
  let anyObstruct = false;
  for (const pa of basePoints(a)) {
    for (const pb of basePoints(b)) {
      const len = Math.hypot(pb.x - pa.x, pb.y - pa.y);
      const n = Math.max(2, Math.ceil(len * 3));
      let lineBlocked = false;
      let lineObstruct = false;
      for (let i = 1; i < n; i++) {
        const x = pa.x + ((pb.x - pa.x) * i) / n;
        const y = pa.y + ((pb.y - pa.y) * i) / n;
        if (inBase(x, y, a) || inBase(x, y, b)) continue;
        const key = `${Math.floor(x)},${Math.floor(y)}`;
        if (losCells.has(key)) lineBlocked = true;
        if (obstructCells.has(key)) lineObstruct = true;
      }
      if (!lineBlocked) allBlocked = false;
      if (lineBlocked || lineObstruct) anyObstruct = true;
    }
  }
  if (allBlocked) return 'blocked';
  return anyObstruct ? 'obstructed' : 'clear';
}

export function rangeBetween(a: Token, b: Token): { range: number; adjacent: boolean; sameGrid: boolean } {
  const ga = largeGridOf(a);
  const gb = largeGridOf(b);
  const dc = Math.abs(ga.c - gb.c);
  const dr = Math.abs(ga.r - gb.r);
  return { range: dc + dr, adjacent: dc <= 1 && dr <= 1, sameGrid: dc === 0 && dr === 0 };
}

export function inArc(a: Token, b: Token, arc: 'forward' | 'rear'): boolean {
  const ga = largeGridOf(a);
  const gb = largeGridOf(b);
  if (ga.c === gb.c && ga.r === gb.r) {
    // Sharing a Large Grid is not a shrug: front and rear are read from the
    // SMALL grids (FAQ E15), except that overlapping footprints — an Aerial
    // unit over a ground unit — treat each other as mutually in front
    // (Supplement "Overlapping" via FAQ E15/I24), so Back Attack never
    // triggers between them.
    const overlap = a.col < b.col + b.size && b.col < a.col + a.size
      && a.row < b.row + b.size && b.row < a.row + a.size;
    if (overlap) return arc === 'forward';
    const dx = (b.col + (b.size - 1) / 2) - (a.col + (a.size - 1) / 2);
    const dy = (b.row + (b.size - 1) / 2) - (a.row + (a.size - 1) / 2);
    const fv = [ [0, -1], [1, 0], [0, 1], [-1, 0] ][a.facing];
    const dir = arc === 'forward' ? fv : [-fv[0], -fv[1]];
    const dot = dx * dir[0] + dy * dir[1];
    if (dot <= 0) return false;
    return Math.abs(dx * dir[1] - dy * dir[0]) <= dot;
  }
  const dx = gb.c - ga.c;
  const dy = gb.r - ga.r;
  const fv = [ [0, -1], [1, 0], [0, 1], [-1, 0] ][a.facing];
  const dir = arc === 'forward' ? fv : [-fv[0], -fv[1]];
  const dot = dx * dir[0] + dy * dir[1];
  if (dot <= 0) return false;
  const along = dot;
  const perp = Math.abs(dx * dir[1] - dy * dir[0]);
  return perp <= along;
}

// ---------- what a shot has to get through (4.2, 4.4.2, 4.16) ----------
//
// Both pages read the same board the same way. These were local to main.ts and
// the Match Centre had neither, so its attacks claimed no Protection at all and
// never mentioned the arc; a second copy would have drifted from the first.

// A target line for the attack helper: range, arc, and line of sight.
export function losNote(
  attacker: Token,
  defender: Token,
  action: { type?: string; range?: number; keywords?: unknown[] },
  terrain: TerrainPiece[],
  tokens: Token[],
  smoke: SmokeScreen[],
): string {
  const r = rangeBetween(attacker, defender);
  const los = losBetween(attacker, defender, terrain, tokens);
  const fwd = inArc(attacker, defender, 'forward');
  // Omni-direction Firing waives the Forward Arc requirement outright, so
  // warning about the arc on such an action is wrong guidance.
  const omni = (action.keywords ?? []).some((k) => /全向|omni/i.test(JSON.stringify(k)));
  const bits: string[] = [];
  bits.push(r.sameGrid ? 'same grid' : r.adjacent ? 'adjacent (R1)' : `Range ${r.range}`);
  if (action.range === 0) {
    if (!r.adjacent && !r.sameGrid) bits.push('⚠ target not adjacent (action range is “--”)');
  } else if (action.range && r.range > action.range) {
    bits.push(`⚠ beyond action range (R${action.range})`);
  }
  bits.push(omni ? 'Omni-direction Firing: no arc check ✓' : fwd ? 'in forward arc ✓' : '⚠ NOT in forward arc');
  if (action.type === 'Firing') {
    if (smokeBlocks(attacker, defender, smoke)) bits.push('✕ LOS blocked by a Smoke Screen (4.16)');
    // "may claim", not "does": obstruction is only the trigger. A medium unit
    // in the way obstructs and pays nothing (4.5.3), as does terrain under 2"
    // (4.5.2), so the number is protectionFor's to say and not this line's.
    else bits.push(los === 'clear' ? 'LOS clear ✓' : los === 'obstructed' ? '⚠ obstructed, so the defender may claim +2 White protection' : '✕ LOS blocked (3" terrain)');
  }
  return bits.join(' · ');
}

// The extra White dice an obstructed shot hands the defender. Terrain and Unit
// Protection are separate +2s and both can apply to the same line.
export function protectionFor(
  attacker: Token,
  defender: Token,
  action: { type?: string },
  terrain: TerrainPiece[],
  tokens: Token[],
  smoke: SmokeScreen[],
  // 095 Responsive Targetting: against a Highlighted target this attacker
  // ignores Terrain AND Unit Protection. rules.ts has no card data, so the
  // judgement is made where the data is and handed in.
  ignored = false,
  // ZHDR-101 Mobile Bunker: does this unit in the way provide Unit Protection
  // to its own side despite not being Large? Handed in for the same reason
  // `ignored` is — the print lives in units.ts. Absent, only 4.5.3 applies.
  mayProtectAllies: (t: Token) => boolean = () => false,
): { white: number; note: string } {
  if (action.type !== 'Firing') return { white: 0, note: '' };
  if (ignored) {
    return { white: 0, note: 'Responsive Targetting: the target is Highlighted, so Terrain and Unit Protection are ignored' };
  }
  // Smoke removes line of sight outright, so there is no protection to add on top.
  if (smokeBlocks(attacker, defender, smoke)) {
    return { white: 0, note: 'No line of sight: a Smoke Screen is in the way (4.16)' };
  }
  // Terrain in Contact with the attacker's base grants no Terrain Protection
  // (FAQ A1): shooting over the wall you are pressed against costs the
  // defender nothing. Contact is Small-Grid edge overlap, so orthogonal
  // adjacency to the footprint; a corner touch is not Contact.
  const touching = (p: TerrainPiece): boolean =>
    p.subCells.some((c) => {
      const dc = c.col < attacker.col ? attacker.col - c.col : c.col - (attacker.col + attacker.size - 1);
      const dr = c.row < attacker.row ? attacker.row - c.row : c.row - (attacker.row + attacker.size - 1);
      return Math.max(dc, 0) + Math.max(dr, 0) <= 1;
    });
  const cover = terrain.filter((p) => !touching(p));
  // 4.5.3: standing in the line is not the same as protecting. Only LARGE
  // Units provide Unit Protection — "medium Units do not" — while Ally and
  // Enemy alike count among the Large ones. Every Mech in this app is size 3
  // (makeMechToken), so what this filter takes out is Drones, which used to
  // hand out +2 White to both sides just by being on the board.
  //
  // ZHDR-101 Mobile Bunker is the printed exception, and only towards its own
  // side: it protects Ally Units, so the defender has to be one of them.
  //
  // The deployed Barricades (data.ts BARRICADE_CARDS) are size 1, so they lose
  // the +2 they were being handed here as well. That is right by 4.5.3 and
  // still wrong at the table: the AS3 walls are printed "counts as 3-inch
  // terrain", which is what ought to be paying them, and no code models that
  // bullet yet. Fixing it belongs with the terrain reading, not here.
  const protectors = tokens.filter((t) => t.size === 3 || (t.side === defender.side && mayProtectAllies(t)));
  const unitsOnly = losBetween(attacker, defender, [], protectors);
  // A unit that obstructs and pays nothing is the whole of what changed here,
  // so it is said out loud wherever it happens: as the entire answer when it is
  // the only thing in the line, and as a footnote when Terrain Protection alone
  // is the number. A player counting bodies on the table reads the board as +4
  // and the app as broken otherwise.
  const idle = unitsOnly === 'clear' && losBetween(attacker, defender, [], tokens) !== 'clear';
  const IDLE = 'the unit in the way is not Large, so there is no Unit Protection (4.5.3)';
  if (losBetween(attacker, defender, cover, protectors) === 'clear') {
    return { white: 0, note: idle ? `Obstructed, but ${IDLE}` : '' };
  }
  const terrainOnly = losBetween(attacker, defender, cover, []);
  let white = 0;
  const parts: string[] = [];
  if (terrainOnly !== 'clear') {
    white += 2;
    parts.push('Terrain Protection (obstructed by terrain ≥2")');
  }
  if (unitsOnly !== 'clear') {
    // Neither Protection stacks with a second obstruction of its own kind
    // (4.5.2/4.5.3), which is why each is a flat +2 rather than a count. Which
    // sentence to print is decided by asking the Large units alone: if they do
    // not obstruct on their own, the +2 came from the Mobile Bunker, and
    // naming a "Large unit" there would be a lie about the board.
    white += 2;
    parts.push(losBetween(attacker, defender, [], protectors.filter((t) => t.size === 3)) !== 'clear'
      ? 'Unit Protection (obstructed by a Large unit)'
      : 'Unit Protection (an Ally unit in the way provides it — ZHDR-101 Mobile Bunker)');
  }
  const note = parts.join(' + ') || 'Obstructed line of sight';
  return { white, note: idle ? `${note} — ${IDLE}` : note };
}
