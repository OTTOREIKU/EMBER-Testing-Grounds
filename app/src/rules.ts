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

export function largeGridOf(t: { col: number; row: number }): LargeGrid {
  return { c: Math.floor(t.col / 3), r: Math.floor(t.row / 3) };
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
  if (c < 0 || r < 0 || c >= LG || r >= LG) return false;
  if (aerial) return true;
  const blocked = new Set<string>();
  for (const p of terrain) for (const cell of p.subCells) blocked.add(`${cell.col},${cell.row}`);
  for (const t of tokens) {
    if (t.uid === ignoreUid || t.aerial) continue;
    for (let dc = 0; dc < t.size; dc++) for (let dr = 0; dr < t.size; dr++) blocked.add(`${t.col + dc},${t.row + dr}`);
  }
  const maxOff = 3 - size;
  for (let oc = 0; oc <= maxOff; oc++) {
    for (let or = 0; or <= maxOff; or++) {
      let ok = true;
      outer: for (let dc = 0; dc < size; dc++) {
        for (let dr = 0; dr < size; dr++) {
          if (blocked.has(`${c * 3 + oc + dc},${r * 3 + or + dr}`)) {
            ok = false;
            break outer;
          }
        }
      }
      if (ok) return true;
    }
  }
  return false;
}

export function reachableGrids(
  t: Token,
  steps: number,
  terrain: TerrainPiece[],
  tokens: Token[],
  flying: boolean,
): (LargeGrid & { dist: number })[] {
  const start = largeGridOf(t);
  const dist = new Map<string, number>([[`${start.c},${start.r}`, 0]]);
  const queue: LargeGrid[] = [start];
  const out: (LargeGrid & { dist: number })[] = [];
  while (queue.length) {
    const g = queue.shift()!;
    const d = dist.get(`${g.c},${g.r}`)!;
    if (d >= steps) continue;
    for (const [dc, dr] of [[0, -1], [1, 0], [0, 1], [-1, 0]] as const) {
      const n = { c: g.c + dc, r: g.r + dr };
      const key = `${n.c},${n.r}`;
      if (n.c < 0 || n.r < 0 || n.c >= LG || n.r >= LG || dist.has(key)) continue;
      const standable = canStandIn(n.c, n.r, t.size, t.aerial, terrain, tokens, t.uid);
      const passable = flying || t.aerial ? true : standable;
      if (!passable) continue;
      dist.set(key, d + 1);
      queue.push(n);
      if (standable) out.push({ ...n, dist: d + 1 });
    }
  }
  return out;
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
  if (ga.c === gb.c && ga.r === gb.r) return true;
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
