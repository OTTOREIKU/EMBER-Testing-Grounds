import type { Side, SmokeScreen, TerrainPiece, Token } from './types';
import { baseBox, baseCells, DEFAULT_GRIDS } from './types';

// The board's extent in Large Grids.
//
// SETTABLE module state, deliberately, and the one place in the codebase that
// has it. E1 removed the module-level board size from board.ts because a
// RENDERER must never cache it -- but these are pure geometry helpers called
// from 44 sites across seven files, and threading a dimension through all of
// them would be a far larger change with far more places to miss one. A missed
// site here is silent: play simply stops at the printed board's edge.
//
// It is safe as module state because it is DERIVED, never authored: every page
// sets it from the state it is about to draw or judge, right beside
// board.setGrids(). Both seats set it from the same synced state, so it cannot
// make them disagree. The default is the printed board, so any path that
// forgets to set it behaves exactly as it did before larger boards existed.
//
// The pure COMMAND layer does not call anything gated by this (it does its own
// bounds against cellsOf(state)), which is what keeps commands.ts free of it.
let GRIDS = 12;

export function setBoardGrids(n: number): void {
  GRIDS = n === 16 || n === 18 ? n : 12;
}

export function boardGrids(): number {
  return GRIDS;
}

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
// `per` is how many screens leave each Connected group: 1 in the main rules,
// 3 under Season 1.04 (season.ts smokePerGroup). A group no larger than that
// goes whole, with the lone screens; a larger one owes `per` of its own
// screens, which its owner picks.
export function dissipationFor(smoke: SmokeScreen[], side: Side, per = 1): Dissipation {
  const groups = smokeGroups(smoke, side);
  return {
    isolated: groups.filter((g) => g.length <= per).flat(),
    groups: groups.filter((g) => g.length > per),
  };
}

// Does a Smoke Screen take this line of sight away? 4.16 (p.76, printed): "If
// the Attacker can establish Line of Sight along lines that do not pass through
// the Smoke Screen, then it may Attack as normal", and 4.2.4 makes line of
// sight ANY straight line between the two bases. So this walks the same 81
// base-to-base lines losBetween does and answers yes only when every one of
// them crosses smoke (ruled 2026-09-25, audit Phase 4, I11). It sampled the
// centre line alone until then, and 70% of its refusals had a clear base line
// (G1). A unit standing IN a Smoke Screen neither sees out nor is seen, which no
// line can get round, and an Aerial one is no exception: FAQ F2 answers "No,
// because Smoke is treated as infinitely high", and F3 says the same of a
// Projectile being Intercepted. The old reading let an Aerial unit stand in
// smoke untouched.
//
// Smoke alone. A Firing Action's sight is smoke AND terrain on the same lines,
// which is firingSight below; this is for a question with nothing else in it
// (an Interception at an Aerial Projectile, where terrain never counts).
export function smokeBlocks(a: Token, b: Token, smoke: SmokeScreen[]): boolean {
  if (!smoke.length) return false;
  return firingSight(a, b, [], [], smoke) === 'smoked';
}

// Does this unit share a Grid with a Smoke Screen? What the boards' "In smoke"
// badge reads, off the screens themselves rather than a hand-set Token that
// nothing obeyed (audit Phase 4, G12).
export function inSmoke(t: Token, smoke: SmokeScreen[]): boolean {
  return smoke.length > 0 && standsInSmoke(t, new Set(smoke.map(smokeKey)));
}

function standsInSmoke(t: Token, grids: Set<string>): boolean {
  return baseCells(t).some((c) => grids.has(`${Math.floor(c.col / 3)},${Math.floor(c.row / 3)}`));
}

export interface LargeGrid {
  c: number;
  r: number;
}

// Contact is Small-Grid edge overlap (4.2.3): footprints sharing an edge, or
// overlapping outright (an Aerial unit over a ground one counts, Supplement
// "Overlapping"). A corner-only touch is NOT Contact.
export function inContact(a: Token, b: Token): boolean {
  const x = baseBox(a);
  const y = baseBox(b);
  const gapX = Math.max(x.col - (y.col + y.w), y.col - (x.col + x.w));
  const gapY = Math.max(x.row - (y.row + y.h), y.row - (x.row + x.h));
  // gap < 0 means overlap on that axis; gap === 0 means edges meet exactly.
  if (gapX < 0 && gapY < 0) return true;
  return (gapX === 0 && gapY < 0) || (gapY === 0 && gapX < 0);
}

export function largeGridOf(t: { col: number; row: number }): LargeGrid {
  return { c: Math.floor(t.col / 3), r: Math.floor(t.row / 3) };
}

// A cell by one number, for the set standingSpot reads the board through: one
// for every cell within 1024 of the board, which is all of them.
const cellNo = (col: number, row: number): number => (col + 1024) * 4096 + (row + 1024);

// The cells each list of terrain fills (standingSpot), kept for as long as one
// seat's one thought lasts (thinking(), with the lines of sight). A search of
// the board asks about hundreds of Grids, and `terrainOf` hands back a new list
// each time it is asked, so what is kept is kept by the pieces (terrainKey),
// not by the list. Outside a thought nothing is kept.
let GROUND: Map<string, Set<number>> | null = null;
function groundCells(terrain: TerrainPiece[]): Set<number> {
  const key = GROUND ? terrainKey(terrain) : '';
  let cells = GROUND?.get(key);
  if (!cells) {
    cells = new Set<number>();
    for (const p of terrain) for (const c of p.subCells) cells.add(cellNo(c.col, c.row));
    GROUND?.set(key, cells);
  }
  return cells;
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
  if (c < 0 || r < 0 || c >= boardGrids() || r >= boardGrids()) return null;
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

  // The cells terrain fills are the same for every Grid asked about of one
  // board (groundCells, gathered once a thought). A unit stands in the way of
  // the cells inside its base: one standing on whole cells, as every unit
  // does; a base off them takes no cell a spot asks about.
  const ground = groundCells(terrain);
  const bases: { col: number; row: number; w: number; h: number }[] = [];
  for (const t of tokens) {
    if (t.uid === ignoreUid || t.aerial) continue;
    const b = baseBox(t);
    if (Number.isInteger(b.col) && Number.isInteger(b.row)) bases.push(b);
  }
  const taken = (col: number, row: number): boolean =>
    bases.some((b) => col >= b.col && col < b.col + b.w && row >= b.row && row < b.row + b.h);
  for (const spot of spots) {
    let ok = true;
    outer: for (let dc = 0; dc < size; dc++) {
      for (let dr = 0; dr < size; dr++) {
        const col = spot.col + dc;
        const row = spot.row + dr;
        if (ground.has(cellNo(col, row)) || taken(col, row)) {
          ok = false;
          break outer;
        }
      }
    }
    if (ok) return spot;
  }
  return null;
}

// A footprint snapped onto the board's cells, with no occupancy and no terrain
// test at all: the fallback when standingSpot finds no free spot in a Grid.
// Here, beside standingSpot, since 2026-10-01: it is pure geometry, and
// turn.ts moveOrder needs it without importing the board's page code.
// board.ts re-exports it for the callers that had it from there.
//
// `grids` defaults to the printed 12 so an un-migrated caller keeps the exact
// behaviour it had. Every caller that can see the state should pass
// gridsOf(state): on a 16 or 18 board the old default would clamp a legal
// placement back onto the printed board's last Grid, silently.
export function snapPlacement(col: number, row: number, size: 1 | 2 | 3, grids: number = DEFAULT_GRIDS): { col: number; row: number } | null {
  const cells = grids * 3;
  const last = grids - 1;
  col = Math.max(0, Math.min(cells - size, col));
  row = Math.max(0, Math.min(cells - size, row));
  if (size === 3) {
    return { col: Math.round(col / 3) * 3, row: Math.round(row / 3) * 3 };
  }
  if (size === 2) {
    const lg = { c: Math.floor((col + 1) / 3), r: Math.floor((row + 1) / 3) };
    const c = Math.min(last, Math.max(0, lg.c));
    const r = Math.min(last, Math.max(0, lg.r));
    const offC = Math.min(1, Math.max(0, col - c * 3));
    const offR = Math.min(1, Math.max(0, row - r * 3));
    return { col: c * 3 + offC, row: r * 3 + offR };
  }
  const c = Math.min(last, Math.max(0, Math.floor(col / 3)));
  const r = Math.min(last, Math.max(0, Math.floor(row / 3)));
  return { col: c * 3 + 1, row: r * 3 + 1 };
}

// Where a Mine stands in Large Grid (c, r). The Supplementary Rules 1.04 (1.3)
// make it a small Ground Unit whose Grid still counts as empty for everyone
// else: it keeps clear of terrain like any ground unit, and may share its Grid
// with any unit, which may stand on it. The GM-35 keeps `aerial` in the model
// for sight and Melee, so standingSpot's Aerial shortcut had put it on the
// first cell of the Grid, a building's or a wall's included.
export function mineSpot(
  c: number,
  r: number,
  terrain: TerrainPiece[],
  toward?: { col: number; row: number },
): { col: number; row: number } | null {
  return standingSpot(c, r, 1, false, terrain, [], undefined, toward);
}

// Where a 1x3 line unit (an AS3 wall, the Turtle Shell) stands in Large Grid
// (c, r) facing `facing`: across the facing, inside the one Grid (terrain is
// placed wholly within a Grid, p.21), the middle line first, on cells no
// terrain fills and no ground unit stands on. Null if no line fits.
export function lineSpot(
  c: number,
  r: number,
  facing: number,
  terrain: TerrainPiece[],
  tokens: Token[],
  ignoreUid?: number,
): { col: number; row: number } | null {
  if (c < 0 || r < 0 || c >= boardGrids() || r >= boardGrids()) return null;
  const blocked = new Set<string>();
  for (const p of terrain) for (const cell of p.subCells) blocked.add(`${cell.col},${cell.row}`);
  for (const t of tokens) {
    if (t.uid === ignoreUid || t.aerial) continue;
    for (const cell of baseCells(t)) blocked.add(`${cell.col},${cell.row}`);
  }
  const across = facing === 1 || facing === 3;
  for (const off of [1, 0, 2]) {
    const at = across ? { col: c * 3 + off, row: r * 3 } : { col: c * 3, row: r * 3 + off };
    const cells = [0, 1, 2].map((i) => (across ? { col: at.col, row: at.row + i } : { col: at.col + i, row: at.row }));
    if (cells.every((x) => !blocked.has(`${x.col},${x.row}`))) return at;
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
      for (const cell of baseCells(o)) blocked.add(`${cell.col},${cell.row}`);
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

// Where a dropped Black Box may land (5.3.1): a Small Grid in Contact with the
// bearer's base, edge to edge (4.2.3), so never under it and never at a
// corner, and on the ground (FAQ P9), not inside a terrain piece. A unit does
// not block it: a Box may share a Grid with one (P8). Every page offered the
// bearer's own Grid and the eight around it (ruling I24; audit Phase 6, F6).
// `cells` is the board's width in Small Grids.
export function boxDropCells(
  base: { col: number; row: number; size: number },
  terrain: TerrainPiece[],
  cells: number,
): { col: number; row: number }[] {
  const blocked = new Set<string>();
  for (const p of terrain) for (const cell of p.subCells) blocked.add(`${cell.col},${cell.row}`);
  const out: { col: number; row: number }[] = [];
  const add = (col: number, row: number): void => {
    if (col < 0 || row < 0 || col >= cells || row >= cells || blocked.has(`${col},${row}`)) return;
    out.push({ col, row });
  };
  for (let i = 0; i < base.size; i++) {
    add(base.col + i, base.row - 1);
    add(base.col + base.size, base.row + i);
    add(base.col + i, base.row + base.size);
    add(base.col - 1, base.row + i);
  }
  return out;
}

// The one cell a picker that offers Large Grids puts the Box on: of the legal
// cells in that Grid, the one nearest its middle, which for a Mech is the
// middle of the shared edge.
export function boxDropCellIn(
  c: number,
  r: number,
  legal: { col: number; row: number }[],
): { col: number; row: number } | null {
  const inGrid = legal.filter((x) => Math.floor(x.col / 3) === c && Math.floor(x.row / 3) === r);
  if (!inGrid.length) return null;
  const mid = { col: c * 3 + 1, row: r * 3 + 1 };
  return inGrid.reduce((best, x) =>
    (Math.abs(x.col - mid.col) + Math.abs(x.row - mid.row) < Math.abs(best.col - mid.col) + Math.abs(best.row - mid.row) ? x : best));
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
  // The Grid keys of the route the search chose to each Grid, start first.
  // What movePath reads: with a Link budget in play the same Grid is reached
  // in several states, and walking `parent` alone could splice two of them.
  trace: (key: string) => string[];
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
  // A Grid that ENDS the movement the moment it is entered - the Fragile
  // Platform Environment Card. Enterable and a legal landing, but never
  // expanded, which is exactly the shape a Crush already has.
  stop?: (c: number, r: number) => boolean;
  // A Grid this unit may pass over but not END in. The Abyss ban for a FLYING
  // move: a flight enters only its landing Grid (M29's reading), so the walk
  // ban in `allowed` would wrongly close the air above it.
  landing?: (c: number, r: number) => boolean;
  // LPA-21 Firefly, 匿踪 Stealth: while Optically Camouflaged or in Low Profile,
  // this unit's movement ROUTE may pass through other units. A legality like
  // `allowed`, not a price like `exitCost` -- and route-only: the landing still
  // has to be legal, and Break Away is still charged, because this is
  // pass-through, not flight.
  phaseThrough?: boolean;
  // [Moving in Straight Line] +N (直线移动): Grids past `steps` may be entered
  // only while the route has run one way from where it began, and never past
  // `steps + straightBonus`. `straightDir` ('dc,dr') fixes the direction when
  // the route being extended is already under way; '' or absent means it has
  // not stepped yet. FAQ E16 needs nothing extra: a Crush still ends the walk.
  straightBonus?: number;
  straightDir?: string;
  // LPA-20 Panzer, 阻拦 Obstruct: the part of each Grid's exit price that may
  // be paid in Link instead of Range, one per Obstruct locker, and how much
  // Link the mover may spend on it (never its last; ruled 2026-09-25, audit
  // Phase 4, I3 and D2). A second budget, so the search runs over Grid and
  // Link spent together.
  linkPay?: { budget: number; payable: (c: number, r: number) => number };
}

// The one direction a route runs in, '' for a route that has not stepped yet,
// or null once it has turned. What [Moving in Straight Line] reads.
export function pathDirection(path: LargeGrid[]): string | null {
  let dir = '';
  for (let i = 1; i < path.length; i++) {
    const d = `${Math.sign(path[i].c - path[i - 1].c)},${Math.sign(path[i].r - path[i - 1].r)}`;
    if (dir && d !== dir) return null;
    dir = d;
  }
  return dir;
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
  // Each state is a Grid AND the Link spent reaching it. Without a Link budget
  // every state spends 0, so this is exactly the plain cheapest-first walk it
  // always was; with one, a Grid reached cheaply in Link and dearly in Range
  // is a different place to stand than the reverse (audit Phase 4, D2).
  const pay = !flying && !t.aerial && (opts?.linkPay?.budget ?? 0) > 0 ? opts!.linkPay! : null;
  const sk = (c: number, r: number, l: number) => `${c},${r}|${l}`;
  const startKey = sk(start.c, start.r, 0);
  const sDist = new Map<string, number>([[startKey, 0]]);
  const sParent = new Map<string, string>();
  const found: (LargeGrid & { dist: number; link: number })[] = [];
  const crushed = new Set<string>();
  // Straight-line bookkeeping: the direction each settled state was reached
  // along, or null once the route has turned. The start carries whatever
  // direction the route already has ('' when it has not stepped yet).
  const bonus = opts?.straightBonus ?? 0;
  const straight = new Map<string, string | null>([[startKey, opts?.straightDir ?? '']]);
  // What entering a Grid comes to (stood in, crushed into, phased through) is
  // asked once for a search, however many ways the search comes at the Grid:
  // nothing it reads changes while the search runs.
  const footing = new Map<string, { standable: boolean; crush: boolean; phase: boolean }>();
  const queue: (LargeGrid & { d: number; l: number })[] = [{ ...start, d: 0, l: 0 }];
  while (queue.length) {
    let best = 0;
    for (let i = 1; i < queue.length; i++) if (queue[i].d < queue[best].d) best = i;
    const g = queue.splice(best, 1)[0];
    const key = `${g.c},${g.r}`;
    const state = sk(g.c, g.r, g.l);
    if (g.d > (sDist.get(state) ?? Infinity)) continue;
    // A Crush ends the Movement Action the moment the Grid is entered.
    if (crushed.has(key)) continue;
    const exit = flying || t.aerial ? 0 : opts?.exitCost?.(g.c, g.r) ?? 0;
    // How much of this exit Link may pay: never more than the surcharge
    // itself, nor than the Link still unspent.
    const payable = pay ? Math.max(0, Math.min(pay.payable(g.c, g.r), exit, pay.budget - g.l)) : 0;
    for (const [dc, dr] of [[0, -1], [1, 0], [0, 1], [-1, 0]] as const) {
      const n = { c: g.c + dc, r: g.r + dr };
      const nk = `${n.c},${n.r}`;
      if (n.c < 0 || n.r < 0 || n.c >= boardGrids() || n.r >= boardGrids()) continue;
      // Off-limits Grids are dropped before anything is priced, and dropped as
      // impassable rather than merely un-endable, so a leash cannot be stepped
      // over. The unit's OWN Grid is never tested: it is already standing
      // there, and a leash that no longer reaches has already been cut.
      if (opts?.allowed && !opts.allowed(n.c, n.r)) continue;
      // A Grid past the printed allowance is only reachable along the one
      // straight run the bonus pays for; anything that has turned is capped at
      // `steps` like every other route.
      const dir = `${dc},${dr}`;
      const was = straight.get(state) ?? null;
      const still = was === null ? null : (was === '' || was === dir ? dir : null);
      const limit = still !== null && bonus > 0 ? steps + bonus : steps;
      // The cheap refusals first, before the footprint test below: nothing
      // this step can buy is within the allowance, or (with no Link to spend)
      // the Grid has already been reached for less.
      const cheapest = g.d + 1 + exit - payable;
      if (cheapest > limit) continue;
      if (!pay && cheapest >= (sDist.get(sk(n.c, n.r, 0)) ?? Infinity)) continue;
      let foot = footing.get(nk);
      if (!foot) {
        const standable = canStandIn(n.c, n.r, t.size, t.aerial, terrain, tokens, t.uid);
        const crush = !standable && !flying && !t.aerial && (opts?.crushable?.(n.c, n.r) ?? false);
        // The empty token list is the whole trick, and the only thing standing
        // between this and a Mech walking through a building: standingSpot folds
        // terrain subCells and unit footprints into ONE blocked set, so a naive
        // `passable = true` would open both. Re-asking canStandIn against TERRAIN
        // ONLY answers "is it just units in the way?", which is exactly what the
        // card grants.
        // The Containers go with the units: the Rules Supplement makes both
        // "Neutral Unit - Deployable - Barricade", so a Firefly in camouflage or
        // Low Profile moves through them too (FAQ I15; audit Phase 3, C11). It
        // never stops on one: `standable` above still reads every piece.
        const phase = !standable && !flying && !t.aerial && !!opts?.phaseThrough
          && canStandIn(n.c, n.r, t.size, t.aerial, terrain.filter((p) => p.type !== 'container'), [], t.uid);
        footing.set(nk, foot = { standable, crush, phase });
      }
      const { standable, crush, phase } = foot;
      const passable = flying || t.aerial ? true : standable || crush || phase;
      if (!passable) continue;
      for (let k = 0; k <= payable; k++) {
        const d = g.d + 1 + exit - k;
        const l = g.l + k;
        const next = sk(n.c, n.r, l);
        if (d > limit || d >= (sDist.get(next) ?? Infinity)) continue;
        sDist.set(next, d);
        sParent.set(next, state);
        straight.set(next, still);
        queue.push({ ...n, d, l });
        // A stop Grid rides the crushed set: same rule, different card - the
        // movement ends the moment the Grid is entered, so it is never expanded.
        // A Grid the unit may phase through is NOT a forced stop: the Firefly in
        // Low Profile or camouflage moves through Containers (FAQ I15) and, as
        // ruled, smaller units too, where the Crush came first and ended the
        // route. Ending THERE still Crushes, since the boards resolve a Crush at
        // the route's last Grid only (ruled 2026-09-25, audit Phase 4, C3).
        if ((crush && !phase) || (opts?.stop?.(n.c, n.r) ?? false)) crushed.add(nk);
        if ((standable || crush) && (opts?.landing?.(n.c, n.r) ?? true)) found.push({ ...n, dist: d, link: l });
      }
    }
  }
  // One route per Grid: the cheapest in Range and Link together, since the
  // Link a route costs is only what its Range cannot cover, then the one that
  // leaves the most Range. With no Link budget there is one state per Grid.
  const chosen = new Map<string, { state: string; d: number; l: number }>();
  for (const [state, d] of sDist) {
    const [gk, ls] = state.split('|');
    const l = Number(ls);
    const cur = chosen.get(gk);
    if (!cur || d + l < cur.d + cur.l || (d + l === cur.d + cur.l && d < cur.d)) chosen.set(gk, { state, d, l });
  }
  const dist = new Map<string, number>();
  const parent = new Map<string, string>();
  for (const [gk, c] of chosen) {
    dist.set(gk, c.d);
    const up = sParent.get(c.state);
    if (up) parent.set(gk, up.split('|')[0]);
  }
  const trace = (gk: string): string[] => {
    const out: string[] = [];
    let at: string | undefined = chosen.get(gk)?.state;
    while (at) {
      out.unshift(at.split('|')[0]);
      at = sParent.get(at);
    }
    return out;
  };
  const seen = new Set<string>();
  return {
    dist,
    parent,
    trace,
    reachable: found
      .sort((a, b) => a.dist - b.dist)
      .filter((g) => {
        const k = `${g.c},${g.r}`;
        const c = chosen.get(k);
        if (seen.has(k) || (g.c === start.c && g.r === start.r) || !c) return false;
        if (g.dist !== c.d || g.link !== c.l) return false;
        seen.add(k);
        return true;
      })
      .map(({ c, r, dist: d }) => ({ c, r, dist: d })),
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
  // Grids that end the Forced Movement the moment the victim is pushed in: an
  // Abyss (it falls) or a Fragile Platform (the floor goes). The line still
  // ENTERS the grid - what happens there is the caller's to resolve.
  stopAt?: (c: number, r: number) => boolean,
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
    if (next.c < 0 || next.r < 0 || next.c >= boardGrids() || next.r >= boardGrids()) break;
    if (!canStandIn(next.c, next.r, victim.size, false, terrain, tokens, victim.uid)) break;
    path.push(next);
    at = next;
    if (stopAt?.(next.c, next.r)) break;
  }
  return path;
}

export interface CrushVictims {
  units: Token[];
  terrain: TerrainPiece[];
}

// LPA-23 Onyx, 不屈 Indomitable: "Piloted mech may Crush large units."
//
// The one pilot trait that reaches this far down the stack, and it is read
// STRAIGHT off the loadout rather than through pilotIs: rules.ts sits UNDER
// units.ts and melee.ts in the import graph (both import this file), so
// importing the helper back would close a cycle.
//
// It is still card-id dispatch, spelled without the database: `t.mech.pilot` IS
// the key pilotCard looks the pilot up by, and a card's own id is that key, so
// this asks exactly the question `pilotIs(data, t, 'LPA-23')` asks.
//
// DEPARTURE FROM THE PLAN, and the reason matters. The plan called for a
// derived `crushesLarge` flag stamped in makeMechToken and re-derived in
// migrateState, the way `barricade` is, to keep all six crushTargets call sites
// untouched. That flag would go STALE: main.ts's onSaveMech rewrites `t.mech`
// wholesale — pilot included — when a loadout is edited in freeplay, and
// nothing there re-stamps a derived flag. Reading the live field cannot drift,
// adds no Token field, needs no migrateState entry and no boardFingerprint
// thought, and leaves the six call sites alone anyway.
const INDOMITABLE_PILOT = 'LPA-23';

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
  if (c < 0 || r < 0 || c >= boardGrids() || r >= boardGrids()) return null;
  // RULING, taken literally: the Onyx adds a TARGET class and nothing else. The
  // size gate above — only a Large Unit Crushes at all — stands, because "may
  // Crush large units" names what may be crushed, not who may crush. Relaxing
  // both would let a Medium chassis Crush anything, which nothing printed
  // supports.
  const indomitable = t.kind === 'mech' && t.mech?.pilot === INDOMITABLE_PILOT;
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
    if (!covers(baseCells(o))) continue;
    if (indomitable ? o.size > t.size : o.size >= t.size) return null;
    // A Barricade can neither move nor be Crushed (FAQ E6), so a grid holding
    // one cannot be entered at all. NEWLY REACHABLE for a Large Barricade: the
    // size test above used to short-circuit before this line whenever the two
    // were the same size, so an Onyx is the first thing that can get here with
    // one. It still returns null, which is right — E6 has no size clause.
    if (o.barricade) return null;
    units.push(o);
  }
  if (!units.length && !hitTerrain.length) return null;
  return { units, terrain: hitTerrain };
}

// Where everybody lands when a Crush ends in an EXCHANGE (4.3.6, book p.47):
// "If NONE of the Grids within Range of that Forced Movement can be entered, the
// crushed Unit instead exchanges positions with the Crushing Unit." Worked
// example (C) says it again: C and D swap, and C's Movement ends.
//
// THE BUG THIS EXISTS TO KILL. Both pages used to ask standingSpot for a spot in
// the crusher's own Grid while the crusher was still standing in it, and
// standingSpot ignores exactly ONE uid — so a Large crusher's 3x3 footprint
// blocked every cell of the Grid it was about to vacate and the answer was
// always null. Measured before the fix: 0 spots found across 1584 crusher x
// victim-size placements. The crush then resolved as a silent no-op and the
// crusher landed on the victim's cells. TWO units are leaving here, so both come
// out of the occupancy list rather than one.
//
// `from` is the Grid the crusher STEPS OUT OF as it enters `goal`, and it is
// passed in rather than read off the token because the token has not moved yet:
// board.ts animateMove is SVG only, and settle() and the commands are the only
// things that ever write col/row — both of which run AFTER this. Derived from
// the crusher instead, this answered with the Grid the whole Movement BEGAN in:
// a crusher routed (1,0)->(1,1)->(1,2) put its victim in (1,0), two Grids away
// and not even adjacent, and freeplay's drag-drop made it sixteen.
//
// Hence the adjacency guard. 4.3.6 puts the Crush at the moment a Unit is
// "about to enter a Grid occupied by another Unit", so the crusher is standing
// in a Grid ADJACENT to the goal, and the exchange stands in for "Forced
// Movement of 1 Grid" — worked example (C) has the two next to each other. An
// exchange between neighbours can never move a Unit more than one Grid, so a
// caller with no adjacent Grid to name (freeplay's drag-drop, which teleports)
// gets null rather than an invented destination.
//
// Returns null when the exchange genuinely will not fit, which is a real answer
// and not a licence to skip it: the caller has to stop the Crush short and say
// so, because there is nothing printed that lets the crusher share a Grid.
// The VICTIM half of the same exchange, split out so a page can ask "is there an
// exchange here at all?" BEFORE it asks the player anything.
//
// Why it has to be the victim half alone. Both pages work the crushed Grid one
// Unit at a time, and the Units still queued behind this one are STILL STANDING
// in the goal Grid when the question is asked — they have not been shoved clear
// yet. crushExchange's last line looks for room for the crusher IN that Grid, so
// asked this early it always answers null and would call every exchange
// impossible. This half asks only what is already settled: whether the Grid the
// crusher steps out of has room for the Units taking its place.
// Where a crushed Unit may be Force-Moved: the orthogonal neighbours of its own
// Grid that are on the board, are not the Grid being crushed into, are not
// barred (an Abyss for a Ground Unit), and have room for it, measured with the
// CRUSHER standing in `from`, the Grid it steps out of. The Crush happens as it
// "is about to enter" the Grid (4.3.6), and p.47's example 1 offers "any of the
// three grids shown", never the crusher's own. Both boards measured the board
// as it stood before the move, since col/row are written after the Crush: on a
// longer route the victim was offered the Grid the crusher stands in and
// refused the one it had left (audit Phase 4, C1). `from` null is a crusher
// that has not moved, measured where it stands. One copy for both boards.
export function crushEscapeGrids(
  victim: Token,
  goal: LargeGrid,
  crusher: Token | undefined,
  from: LargeGrid | null,
  terrain: TerrainPiece[],
  tokens: Token[],
  barred?: (c: number, r: number) => boolean,
): LargeGrid[] {
  let world = tokens;
  if (crusher && from) {
    const others = tokens.filter((x) => x.uid !== crusher.uid);
    const at = standingSpot(from.c, from.r, crusher.size, crusher.aerial, terrain, others, crusher.uid)
      ?? { col: from.c * 3, row: from.r * 3 };
    world = [...others, { ...crusher, col: at.col, row: at.row }];
  }
  const vAt = largeGridOf(victim);
  return ([[0, -1], [1, 0], [0, 1], [-1, 0]] as const)
    .map(([dc, dr]) => ({ c: vAt.c + dc, r: vAt.r + dr }))
    .filter((g) => g.c >= 0 && g.r >= 0 && g.c < boardGrids() && g.r < boardGrids())
    .filter((g) => !(g.c === goal.c && g.r === goal.r))
    .filter((g) => !barred?.(g.c, g.r))
    .filter((g) => standingSpot(g.c, g.r, victim.size, victim.aerial, terrain, world, victim.uid) !== null);
}

export function crushExchangeSpots(
  crusher: Token,
  victims: Token[],
  goal: LargeGrid,
  from: LargeGrid,
  terrain: TerrainPiece[],
  tokens: Token[],
): { uid: number; to: { col: number; row: number } }[] | null {
  if (Math.abs(from.c - goal.c) + Math.abs(from.r - goal.r) !== 1) return null;
  const leaving = new Set([crusher.uid, ...victims.map((v) => v.uid)]);
  // Everything that is NOT part of the exchange, at wherever it stands now —
  // which includes the victims already Force-Moved clear of the Grid, since they
  // took real spots and may well have taken one in here.
  const standing = tokens.filter((x) => !leaving.has(x.uid));
  const placed: { uid: number; to: { col: number; row: number } }[] = [];
  // One at a time, each put down before the next is asked, so two exchanged
  // Units cannot be handed the same cell of the Grid the crusher is vacating.
  // Largest first: a 1x1 put down centre-first could leave no room for a 2x2
  // that fits beside it (audit Phase 4, C1).
  for (const v of [...victims].sort((a, b) => b.size - a.size)) {
    const spot = standingSpot(from.c, from.r, v.size, v.aerial, terrain, standing);
    if (!spot) return null;
    placed.push({ uid: v.uid, to: spot });
    standing.push({ ...v, col: spot.col, row: spot.row });
  }
  return placed;
}

export function crushExchange(
  crusher: Token,
  victims: Token[],
  goal: LargeGrid,
  from: LargeGrid,
  terrain: TerrainPiece[],
  tokens: Token[],
): { crusher: { col: number; row: number }; victims: { uid: number; to: { col: number; row: number } }[] } | null {
  const placed = crushExchangeSpots(crusher, victims, goal, from, terrain, tokens);
  if (!placed) return null;
  // The occupancy list the crusher is measured against: everything that stayed
  // put, plus the exchanged Units at the spots they were just handed.
  const leaving = new Set([crusher.uid, ...victims.map((v) => v.uid)]);
  const standing = tokens.filter((x) => !leaving.has(x.uid));
  for (const p of placed) {
    const v = victims.find((x) => x.uid === p.uid)!;
    standing.push({ ...v, col: p.to.col, row: p.to.row });
  }
  const spot = standingSpot(goal.c, goal.r, crusher.size, crusher.aerial, terrain, standing);
  if (!spot) return null;
  return { crusher: spot, victims: placed };
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
  return movePaths(t, [to], steps, terrain, tokens, flying, opts)[0];
}

// The routes to several Grids from the ONE search: each is the route movePath
// gives for that Grid, empty where it gives none. Whoever wants the way to
// many Grids at once (a seat reading the roads to every enemy) pays for one
// search and not one for each.
export function movePaths(
  t: Token,
  goals: LargeGrid[],
  steps: number,
  terrain: TerrainPiece[],
  tokens: Token[],
  flying: boolean,
  opts?: MoveOpts,
): LargeGrid[][] {
  const { dist, trace } = searchMoves(t, steps, terrain, tokens, flying, opts);
  return goals.map((to) => {
    const goal = `${to.c},${to.r}`;
    if (!dist.has(goal)) return [];
    // A landing ban closes the ROUTE'S END, not the route: the grid may sit in
    // `dist` because a flight passed over it, and a path may not finish there.
    if (opts?.landing && !opts.landing(to.c, to.r)) return [];
    return trace(goal).map((k) => {
      const [c, r] = k.split(',').map(Number);
      return { c, r };
    });
  });
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

// How much of a drawn route's price Link may stand in for: each exit's Obstruct
// surcharge, capped at the exit price itself (audit Phase 4, D2).
function pathPayable(path: LargeGrid[], flying: boolean, opts?: MoveOpts): number {
  if (flying || !opts?.linkPay || path.length < 2) return 0;
  let n = 0;
  for (let i = 0; i < path.length - 1; i++) {
    n += Math.min(opts.linkPay.payable(path[i].c, path[i].r), opts.exitCost?.(path[i].c, path[i].r) ?? 0);
  }
  return n;
}

// The Link a drawn route must pay for its Obstruct surcharges: only what the
// Range cannot cover, since Link is the dearer of the two (ruled 2026-09-25,
// audit Phase 4, I3). 0 for every route that fits its Range.
export function breakAwayLinkDue(path: LargeGrid[], steps: number, flying: boolean, opts?: MoveOpts): number {
  const over = pathCost(path, flying, opts) - steps;
  if (over <= 0) return 0;
  return Math.min(over, pathPayable(path, flying, opts), opts?.linkPay?.budget ?? 0);
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
  // A route that has entered a stop Grid is finished: the Fragile Platform
  // ends the movement, so there is nothing to chain a waypoint onto.
  if (opts?.stop?.(last.c, last.r)) return null;
  if (last.c === to.c && last.r === to.r) return null;
  const prev = path[path.length - 2];
  if (prev && prev.c === to.c && prev.r === to.r) return path.slice(0, -1);
  if (path.some((g) => g.c === to.c && g.r === to.r)) return null;
  // Link spent on the route already drawn stands in for its Range, and
  // spending it there is never worse than keeping it: Range pays for any step,
  // Link only for an Obstruct surcharge (audit Phase 4, D2).
  const pay = !(flying || t.aerial) && opts?.linkPay ? opts.linkPay : null;
  const linkUsed = pay ? Math.min(pay.budget, pathPayable(path, false, opts)) : 0;
  const cost = pathCost(path, flying || t.aerial, opts) - linkUsed;
  const base = steps - cost;
  // [Moving in Straight Line]: a route still running one way may spend the
  // bonus past the printed allowance, and only in that same direction. Once it
  // has turned, the bonus is gone for good and the base allowance is all there is.
  const bonus = opts?.straightBonus ?? 0;
  const dir = bonus > 0 ? pathDirection(path) : null;
  const budget = dir !== null ? steps + bonus - cost : base;
  if (budget <= 0) return null;
  const from = { ...t, col: last.c * 3 + 1, row: last.r * 3 + 1 };
  const left: MoveOpts | undefined = pay ? { ...opts, linkPay: { ...pay, budget: pay.budget - linkUsed } } : opts;
  const sub: MoveOpts | undefined = bonus > 0
    ? { ...left, straightBonus: dir !== null ? budget - Math.max(0, base) : 0, straightDir: dir ?? undefined }
    : left;
  const run = movePath(from, to, Math.max(0, base), terrain, tokens, flying, sub).slice(1);
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
  return walkLines(a, b, terrain, tokens, null) as 'clear' | 'obstructed' | 'blocked';
}

// A FIRING ACTION'S line of sight: terrain and smoke judged on the SAME lines.
// Any one of the 81 base-to-base lines that crosses neither 3" terrain nor a
// Smoke Screen is sight (4.2.4, 4.16; ruled 2026-09-25, audit Phase 4, I11).
// The two used to be separate tests, smoke on the centre line and terrain on
// the 81, so a shot with no clear line at all passed whenever the centre line
// missed the smoke and the terrain only obstructed the rest (G3). 'smoked'
// when smoke took the last line, 'blocked' when terrain alone did.
export function firingSight(
  a: Token,
  b: Token,
  terrain: TerrainPiece[],
  tokens: Token[],
  smoke: SmokeScreen[],
): 'clear' | 'obstructed' | 'blocked' | 'smoked' {
  if (!smoke.length) return walkLines(a, b, terrain, tokens, null);
  const grids = new Set(smoke.map(smokeKey));
  if (standsInSmoke(a, grids) || standsInSmoke(b, grids)) return 'smoked';
  return walkLines(a, b, terrain, tokens, grids);
}

// ---------- lines walked once, while somebody is thinking ----------
//
// One walk is eighty-one lines of some thousands of cell lookups, and a seat
// that looks ahead asks for the same line over and over: each Action of a unit
// asks its own line to the same target, and each table it thinks about asks
// them all again. A line depends on nothing but the two footprints, the
// terrain, the units standing between and the smoke, so inside `thinking()`
// each is walked once and kept by exactly those. OUTSIDE it nothing is kept:
// the pages ask a line when they draw one, and a board being edited may change
// a piece of terrain where it stands, which no key here would notice. The memo
// lives only as long as one seat's one decision, in which no board changes.
type Sight = 'clear' | 'obstructed' | 'blocked' | 'smoked';
let WALKED: Map<string, Sight> | null = null;
// The cells a list of terrain puts in a line's way (walkLinesNow), by a cell's
// number: every cell obstructs it, the cells of a piece that blocks sight
// block it. Kept by the pieces for as long as a thought lasts, as the lines
// are (thinking()).
let SIGHT_GROUND: Map<string, { all: Set<number>; los: Set<number> }> | null = null;
const PIECE = new WeakMap<TerrainPiece, number>();
let pieces = 0;

// Runs `fn` with every line of sight it asks for walked once, and the cells of
// each terrain list gathered once. Nested, it is the outer one's memory that
// is used and left in place.
export function thinking<T>(fn: () => T): T {
  if (WALKED) return fn();
  WALKED = new Map();
  GROUND = new Map();
  SIGHT_GROUND = new Map();
  try {
    return fn();
  } finally {
    WALKED = null;
    GROUND = null;
    SIGHT_GROUND = null;
  }
}

// Everything walkLines reads, as a key: the two units (their footprints are
// their cell, size, facing and card), each piece of terrain by which piece it
// is, every unit that could stand in the line, and the smoke.
const unitKey = (t: Token): string => `${t.uid},${t.col},${t.row},${t.size},${t.facing},${t.aerial ? 1 : 0},${t.mine ? 1 : 0},${t.cardId}`;
function terrainKey(terrain: TerrainPiece[]): string {
  let key = '';
  for (const p of terrain) {
    let n = PIECE.get(p);
    if (n === undefined) PIECE.set(p, n = ++pieces);
    key += `${n},`;
  }
  return key;
}
function lineKey(a: Token, b: Token, terrain: TerrainPiece[], tokens: Token[], smokeGrids: Set<string> | null): string {
  let key = `${unitKey(a)}|${unitKey(b)}|${terrainKey(terrain)}|`;
  for (const t of tokens) if (t.uid !== a.uid && t.uid !== b.uid && !t.aerial) key += `${unitKey(t)};`;
  return smokeGrids ? `${key}|${[...smokeGrids].sort().join(';')}` : key;
}

// IS THERE ANY LINE OF SIGHT AT ALL between the two: losBetween, asked only
// whether it is 'blocked'. For a reader that wants nothing more, and asks it of
// a great many places at once: where a Projectile may land is asked of every
// Grid in Range (turn.ts landingGrids). The same walk, stopped at the first of
// its lines that nothing blocks, which on open ground is the first of the 81.
// While somebody is thinking it is kept, like every line, by what it reads:
// the two footprints, the terrain, and the units that block a line as terrain
// does (a 3-inch Barricade). The other units only obstruct, which this does
// not ask, so a unit moved elsewhere on the board changes nothing here.
export function sightBetween(a: Token, b: Token, terrain: TerrainPiece[], tokens: Token[]): boolean {
  if (!WALKED) return walkLinesNow(a, b, terrain, tokens, null, true) !== 'blocked';
  let key = `?${unitKey(a)}|${unitKey(b)}|${terrainKey(terrain)}|`;
  for (const t of tokens) if (t.uid !== a.uid && t.uid !== b.uid && !t.aerial && blocksAsTerrain(t)) key += `${unitKey(t)};`;
  let sight = WALKED.get(key);
  if (sight === undefined) WALKED.set(key, sight = walkLinesNow(a, b, terrain, tokens, null, true));
  return sight !== 'blocked';
}

// The same for a thought that is put down and picked up again (a seat that
// hands the page its thread back between the steps of one decision). What is
// kept is kept by everything it was read from, so a line asked by anybody
// while the thought is open is the line walked afresh. A second thought begun
// meanwhile shares the memory, and loses it when the first ends: it is then
// only slower.
export async function musing<T>(fn: () => Promise<T>): Promise<T> {
  if (WALKED) return fn();
  WALKED = new Map();
  GROUND = new Map();
  SIGHT_GROUND = new Map();
  try {
    return await fn();
  } finally {
    WALKED = null;
    GROUND = null;
    SIGHT_GROUND = null;
  }
}

// The one line-walk behind both readers, so a smoke line and a terrain line are
// always the same line. With no smoke it is the plain losBetween it always
// was: an Aerial end sees everything, and one line not blocked is sight.
function walkLines(a: Token, b: Token, terrain: TerrainPiece[], tokens: Token[], smokeGrids: Set<string> | null): Sight {
  if (!WALKED) return walkLinesNow(a, b, terrain, tokens, smokeGrids);
  const key = lineKey(a, b, terrain, tokens, smokeGrids);
  let sight = WALKED.get(key);
  if (sight === undefined) WALKED.set(key, sight = walkLinesNow(a, b, terrain, tokens, smokeGrids));
  return sight;
}

// For the test that holds the memory to the walk: the two readers with
// nothing kept, and how many lines have been walked in all.
let walks = 0;
export const walked = (): number => walks;
export function losBetweenNow(a: Token, b: Token, terrain: TerrainPiece[], tokens: Token[]): 'clear' | 'obstructed' | 'blocked' {
  return walkLinesNow(a, b, terrain, tokens, null) as 'clear' | 'obstructed' | 'blocked';
}
export function firingSightNow(a: Token, b: Token, terrain: TerrainPiece[], tokens: Token[], smoke: SmokeScreen[]): Sight {
  if (!smoke.length) return walkLinesNow(a, b, terrain, tokens, null);
  const grids = new Set(smoke.map(smokeKey));
  if (standsInSmoke(a, grids) || standsInSmoke(b, grids)) return 'smoked';
  return walkLinesNow(a, b, terrain, tokens, grids);
}

// WHAT IS IN THE WAY (OTTO, 2026-10-05: "showing obstructed on a unit when
// they werent near something"): each piece of terrain and each unit that one
// of the lines between the two bases crosses (4.2.4: an edge or a corner
// counts), each asked on the very lines the sight is judged on. A unit in the
// air is in nobody's way, and nothing is in the way of a line to or from one.
export function obstructorsOf(a: Token, b: Token, terrain: TerrainPiece[], tokens: Token[]): { terrain: TerrainPiece[]; units: Token[] } {
  if ((a.aerial && !a.mine) || (b.aerial && !b.mine)) return { terrain: [], units: [] };
  return {
    terrain: terrain.filter((p) => walkLinesNow(a, b, [p], [], null) !== 'clear'),
    units: tokens.filter((t) => t.uid !== a.uid && t.uid !== b.uid && !t.aerial && walkLinesNow(a, b, [], [t], null) !== 'clear'),
  };
}

// The same, said: the terrain by its height and the Grid it stands in, the
// units by name, at most four.
function obstructorNames(a: Token, b: Token, terrain: TerrainPiece[], tokens: Token[]): string {
  const { terrain: pieces, units } = obstructorsOf(a, b, terrain, tokens);
  const at = (p: TerrainPiece): string => {
    const c = p.subCells[0];
    return c ? ` (${String.fromCharCode(65 + Math.floor(c.col / 3))}${Math.floor(c.row / 3) + 1})` : '';
  };
  const names = [...pieces.map((p) => `${p.height}" terrain${at(p)}`), ...units.map((t) => t.label)];
  if (!names.length) return '';
  return names.length > 4 ? `${names.slice(0, 4).join(', ')} and ${names.length - 4} more` : names.join(', ');
}

// `first` stops the walk at the first line that is sight, for a reader that
// asks only whether there is one (sightBetween): the answer is then 'clear'
// for "some line is", and says nothing of what obstructs the others.
function walkLinesNow(
  a: Token,
  b: Token,
  terrain: TerrainPiece[],
  tokens: Token[],
  smokeGrids: Set<string> | null,
  first = false,
): 'clear' | 'obstructed' | 'blocked' | 'smoked' {
  walks += 1;
  // 4.2.4: line of sight to or from an Aerial Unit is never Obstructed, and
  // terrain does not block it. Smoke still does (4.16).
  // A Mine is Aerial for placement only: sight to one is a ground unit's,
  // which is how it gets Protection (ruling I14; audit Phase 5, C4).
  const aerial = !!((a.aerial && !a.mine) || (b.aerial && !b.mine));
  if (aerial && !smokeGrids) return 'clear';
  // The terrain's cells (SIGHT_GROUND, gathered once a thought) and the
  // units' own, gathered apart: a cell is in the line's way when it is in
  // either. A cell by its number (one for every cell within 1024 of the
  // board), as are the Grids of the smoke.
  const cellNo = (col: number, row: number): number => (col + 1024) * 4096 + (row + 1024);
  const losCells = new Set<number>();
  const obstructCells = new Set<number>();
  let ground: { all: Set<number>; los: Set<number> } | null = null;
  if (!aerial) {
    const tk = SIGHT_GROUND ? terrainKey(terrain) : '';
    ground = SIGHT_GROUND?.get(tk) ?? null;
    if (!ground) {
      ground = { all: new Set<number>(), los: new Set<number>() };
      for (const p of terrain) {
        for (const c of p.subCells) {
          ground.all.add(cellNo(c.col, c.row));
          if (p.blocksLos) ground.los.add(cellNo(c.col, c.row));
        }
      }
      SIGHT_GROUND?.set(tk, ground);
    }
    for (const t of tokens) {
      if (t.uid === a.uid || t.uid === b.uid || t.aerial) continue;
      // A 3-inch Barricade blocks the lines it crosses; a 2-inch one, the
      // Turtle Shell, only obstructs them (Supplementary Rules 1.04, 1.2).
      const wall = blocksAsTerrain(t);
      for (const cell of baseCells(t)) {
        obstructCells.add(cellNo(cell.col, cell.row));
        if (wall) losCells.add(cellNo(cell.col, cell.row));
      }
    }
  }
  let smoke: Set<number> | null = null;
  if (smokeGrids) {
    smoke = new Set<number>();
    for (const k of smokeGrids) {
      const [gc, gr] = k.split(',').map(Number);
      smoke.add(cellNo(gc, gr));
    }
  }

  // The two bases, read once: every point of every line is held against both.
  type Box = { col: number; row: number; w: number; h: number };
  const boxA: Box = baseBox(a);
  const boxB: Box = baseBox(b);
  const basePoints = (b: Box): { x: number; y: number }[] => {
    const pts: { x: number; y: number }[] = [];
    for (let i = 0; i <= 2; i++) {
      for (let j = 0; j <= 2; j++) {
        pts.push({ x: b.col + 0.08 + (i * (b.w - 0.16)) / 2, y: b.row + 0.08 + (j * (b.h - 0.16)) / 2 });
      }
    }
    return pts;
  };

  const inBase = (x: number, y: number, b: Box): boolean => x >= b.col && x < b.col + b.w && y >= b.row && y < b.row + b.h;
  // Bases that stand on whole cells, as every unit does: whether a point of a
  // line is inside one is then the cell's to say, as everything else read of
  // a point is, so a line's next point in the cell just read is read already.
  const whole = (b: Box): boolean => Number.isInteger(b.col) && Number.isInteger(b.row) && Number.isInteger(b.w) && Number.isInteger(b.h);
  const byCell = whole(boxA) && whole(boxB);

  let anySight = false;
  let smokeTook = false;
  let anyObstruct = false;
  const pointsB = basePoints(boxB);
  for (const pa of basePoints(boxA)) {
    for (const pb of pointsB) {
      const len = Math.hypot(pb.x - pa.x, pb.y - pa.y);
      const n = Math.max(2, Math.ceil(len * 3));
      let lineBlocked = false;
      let lineObstruct = false;
      let lineSmoked = false;
      let last = NaN;
      for (let i = 1; i < n; i++) {
        const x = pa.x + ((pb.x - pa.x) * i) / n;
        const y = pa.y + ((pb.y - pa.y) * i) / n;
        const cx = Math.floor(x);
        const cy = Math.floor(y);
        const key = cellNo(cx, cy);
        if (byCell && key === last) continue;
        last = key;
        if (inBase(x, y, boxA) || inBase(x, y, boxB)) continue;
        if (losCells.has(key) || ground?.los.has(key)) lineBlocked = true;
        if (obstructCells.has(key) || ground?.all.has(key)) lineObstruct = true;
        if (smoke?.has(cellNo(Math.floor(cx / 3), Math.floor(cy / 3)))) lineSmoked = true;
      }
      if (first && !lineBlocked && !lineSmoked) return 'clear';
      if (!lineBlocked && !lineSmoked) anySight = true;
      if (!lineBlocked && lineSmoked) smokeTook = true;
      if (lineBlocked || lineObstruct) anyObstruct = true;
    }
  }
  if (!anySight) return smokeTook ? 'smoked' : 'blocked';
  return anyObstruct ? 'obstructed' : 'clear';
}

// The Barricades (Supplementary Rules 1.04, 1.2) are Ground Units with a
// Height, and "like Terrain, they block Line of Sight based on their Height and
// provide Terrain Protection to Units, but do not provide Unit Protection": the
// AS3 Inflatable Walls are 3 inches, so they block sight and give cover; the DBP
// Turtle Shell is 2 inches, so it gives cover to ANY unit behind it and blocks
// no sight. They had stood as small units that blocked nothing and paid nothing
// (PHASE6-PLAN D-9; audit Phase 5, E1), and then the Turtle Shell stood as
// 3-inch terrain only while one of its allies was the target, the Barricade
// keyword (p.92) that FAQ A23 retired and 1.2 replaced. The two Containers are
// Barricades too, 1 inch, and are still terrain pieces here. The ids are the
// cards' own, as data.ts BARRICADE_CARDS keeps them, because rules.ts reads no
// card data.
//
// FOOTPRINT: the 1x3 line the data's boardProfile prints for all three, across
// the unit's facing (types.ts baseCells; OTTO, 2026-09-28).
const BARRICADE_HEIGHT: Record<string, number> = { 'PDAM-003': 3, 'PDAM-004': 3, '158': 2 };
export function barricadeHeight(t: Token): number {
  return t.aerial ? 0 : BARRICADE_HEIGHT[t.cardId] ?? 0;
}

// Stands as terrain at all: 2 inches or more, which is what pays Terrain
// Protection (4.5). A unit that does is terrain in the line, not a unit in it.
export function standsAsTerrain(t: Token): boolean {
  return barricadeHeight(t) >= 2;
}

// Stands as terrain that BLOCKS the lines it crosses: 3 inches (1.1.1).
export function blocksAsTerrain(t: Token): boolean {
  return barricadeHeight(t) >= 3;
}

// The same units as terrain pieces, for the readers that take terrain.
export function unitTerrain(tokens: Token[]): TerrainPiece[] {
  return tokens.filter((t) => standsAsTerrain(t)).map((t) => {
    const height = barricadeHeight(t);
    return {
      id: `unit:${t.uid}`, type: height >= 3 ? 'high_wall' as const : 'low_wall' as const, subCells: baseCells(t),
      height, blocksLos: height >= 3, providesProtection: true, isFragile: false,
    };
  });
}

// Does the line between two Bases PASS THROUGH this third unit's footprint?
//
// This is not `losBetween`, and the difference is the whole reason it exists.
// Automatic Shield is printed as "Line of Sight also passes through this Unit"
// (rulebook glossary, and the GoF 1.021 list word for word) -- it does NOT say
// "obstructs". For every ground shield the two coincide, which is why the
// obstruction test served as a proxy for years. They diverge for exactly one
// case: an AERIAL unit standing in the line. `losBetween` skips Aerial tokens
// as obstructors, so it answers "not obstructed" -- which is right for
// Protection and wrong for this keyword, and left card 295, whose entire rules
// text is Automatic Shield, unable to ever fire.
//
// So this asks the card's own question and nothing more: geometry only, no
// Aerial skip, no terrain, no blocked/obstructed distinction. The ENDPOINT rule
// is still the caller's business -- 4.2.4 says LoS to or from an Aerial Unit is
// never Obstructed, and automaticShieldFor keeps honouring that.
//
// Sampling is `losBetween`'s, deliberately: the same 9x9 base points, the same
// step count, and the same exemption for the endpoints' own footprints. A
// second, subtly different line-walk would be two answers to one question.
export function lineCrossesUnit(a: Token, b: Token, unit: Token): boolean {
  if (unit.uid === a.uid || unit.uid === b.uid) return false;
  const cells = new Set(baseCells(unit).map((c) => `${c.col},${c.row}`));
  const basePoints = (t: Token): { x: number; y: number }[] => {
    const bx = baseBox(t);
    const pts: { x: number; y: number }[] = [];
    for (let i = 0; i <= 2; i++) {
      for (let j = 0; j <= 2; j++) {
        pts.push({ x: bx.col + 0.08 + (i * (bx.w - 0.16)) / 2, y: bx.row + 0.08 + (j * (bx.h - 0.16)) / 2 });
      }
    }
    return pts;
  };
  const inBase = (x: number, y: number, t: Token) => {
    const bx = baseBox(t);
    return x >= bx.col && x < bx.col + bx.w && y >= bx.row && y < bx.row + bx.h;
  };
  for (const pa of basePoints(a)) {
    for (const pb of basePoints(b)) {
      const len = Math.hypot(pb.x - pa.x, pb.y - pa.y);
      const n = Math.max(2, Math.ceil(len * 3));
      for (let i = 1; i < n; i++) {
        const x = pa.x + ((pb.x - pa.x) * i) / n;
        const y = pa.y + ((pb.y - pa.y) * i) / n;
        if (inBase(x, y, a) || inBase(x, y, b)) continue;
        if (cells.has(`${Math.floor(x)},${Math.floor(y)}`)) return true;
      }
    }
  }
  return false;
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
    const x = baseBox(a);
    const y = baseBox(b);
    const overlap = x.col < y.col + y.w && y.col < x.col + x.w
      && x.row < y.row + y.h && y.row < x.row + x.h;
    if (overlap) return arc === 'forward';
    const dx = (y.col + (y.w - 1) / 2) - (x.col + (x.w - 1) / 2);
    const dy = (y.row + (y.h - 1) / 2) - (x.row + (x.h - 1) / 2);
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
  // `anyDistance`: the Action waives distance and line of sight and nothing
  // else. PDRH-202_B Link Shock is the one (ruled 2026-09-25, audit Phase 4,
  // I14): it keeps the Forward Arc and the no-Aerial Melee rule. rules.ts has
  // no card data, so the caller reads the card and says so.
  action: { type?: string; range?: number; keywords?: unknown[]; anyDistance?: boolean },
  terrain: TerrainPiece[],
  tokens: Token[],
  smoke: SmokeScreen[],
  // STRICT turns the Range readings from a warning into a refusal, which is the
  // freeplay/Match Centre split the LOS reading already makes: a table may
  // house-rule a shot from just outside Range, a networked game may not. The
  // caller decides, because only it knows which page it is on.
  //
  // `action.range` must already be the EFFECTIVE reach when it matters. It is
  // the printed number as it arrives off the card, so a Firing Action lengthened
  // by an ally's aura reads as out of range here unless the caller passes
  // actionRange()'s answer in. That was wrong even as a warning.
  strict = false,
): string {
  const r = rangeBetween(attacker, defender);
  const fwd = inArc(attacker, defender, 'forward');
  // Omni-direction Firing waives the Forward Arc requirement outright, so
  // warning about the arc on such an action is wrong guidance.
  const omni = (action.keywords ?? []).some((k) => /全向|omni/i.test(JSON.stringify(k)));
  const bits: string[] = [];
  bits.push(r.sameGrid ? 'same grid' : r.adjacent ? `adjacent (R${r.range})` : `Range ${r.range}`);
  const rangeMark = strict ? '✕' : '⚠';
  if (action.anyDistance) {
    bits.push('Link Shock: distance and line of sight do not matter');
  } else if (action.range === 0) {
    if (!r.adjacent && !r.sameGrid) bits.push(`${rangeMark} target not adjacent (action range is “--”)`);
  } else if (action.range && r.range > action.range) {
    bits.push(`${rangeMark} beyond action range (R${action.range})`);
  }
  // "Unless otherwise specified, only Units in the Forward Arc can be selected
  // as targets for Melee and Firing Actions" (4.2.5), a requirement of both
  // execution flows (4.5.1, 4.6.1). Strict refuses it like Range: it was a
  // warning on every board, so an online attack could take a target behind it
  // (audit Phase 3, C2).
  bits.push(omni ? 'Omni-direction Firing: no arc check ✓' : fwd ? 'in forward arc ✓' : `${strict ? '✕' : '⚠'} NOT in forward arc`);
  // 4.4.1 step 1, Melee requirement 4: "target must NOT be an Aerial Unit". Not
  // a warning a table can overrule by strictness: the Match Centre disables
  // the row on it, and freeplay asks before letting a house rule through. The
  // pad already filtered its list; the two board pages let the swing land.
  if (action.type === 'Melee' && defender.aerial && !defender.mine) bits.push('✕ Melee cannot target an Aerial unit (4.4.1)');
  if (action.type === 'Firing' && !action.anyDistance) {
    // Terrain and smoke on the same lines: any one line clear of both is sight
    // (4.2.4, 4.16; audit Phase 4, G1/G3).
    const sight = firingSight(attacker, defender, terrain, tokens, smoke);
    // Obstruction is only the trigger, so this says WHAT is in the way and not
    // that the defender is paid: a medium unit in the way obstructs and pays
    // nothing (4.5.3), and so does 1-inch terrain (4.5.2; Supplementary Rules
    // 1.04, 1.1.1). The number is protectionFor's to say. This read "the
    // defender may claim +2 White" once, and then named what WOULD pay, both
    // read as the defender being paid for a 1-inch Container (OTTO, 2026-10-05).
    const by = sight === 'obstructed' ? obstructorNames(attacker, defender, terrain, tokens) : '';
    bits.push(sight === 'smoked'
      ? '✕ no line of sight clear of the Smoke Screen (4.16)'
      : sight === 'clear' ? 'LOS clear ✓'
        : sight === 'obstructed' ? `⚠ LOS obstructed${by ? ` by ${by}` : ''}`
          : '✕ LOS blocked (3" terrain)');
  }
  // EVERY Melee Action needs line of sight to its target: "Melee Actions
  // requires Line of Sight to the target to perform" (4.6, p.59; 4.6.1 ②), a
  // "--" one as much as an Extended one, for which 4.6.2 only repeats the rule.
  // Smoke is Firing's alone (4.16), so this is terrain only. The Range 4
  // Harpoon landed through a building (audit Phase 4, H5), and only Extended
  // Melee was asked after it, so a Punch/Kick still landed through a 3" wall on
  // an Adjacent unit it did not even Melee Lock (audit Phase 7, P7B 1).
  if (action.type === 'Melee' && !action.anyDistance
    && losBetween(attacker, defender, terrain, tokens) === 'blocked') {
    bits.push((action.range ?? 0) > 0
      ? '✕ Extended Melee needs line of sight, and 3" terrain blocks it (4.6.2)'
      : '✕ Melee needs line of sight, and 3" terrain blocks it (4.6)');
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
  // Smoke removes line of sight outright, so there is no protection to add on
  // top. Judged with the terrain on the same lines (audit Phase 4, G1/G3).
  if (firingSight(attacker, defender, terrain, tokens, smoke) === 'smoked') {
    return { white: 0, note: 'No line of sight: every line crosses a Smoke Screen (4.16)' };
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
  // HEIGHT DECIDES WHETHER TERRAIN PAYS, and this filter was missing it. 4.5
  // (rules/04:115): "Only Terrain with height 2 inches or more provides Terrain
  // Protection. 1-inch terrain can partially obstruct LoS but grants no
  // protection and no modifiers." The worked example at :121 is the same
  // board OTTO hit: 1-inch terrain between A and C gives nothing.
  //
  // `providesProtection` already carries the answer and is set false for both
  // Container sizes wherever terrain is built (mapeditor.ts, scenarios.ts). It
  // simply was not asked, so the little green boxes were handing the defender
  // +2 White while the note beside them read "obstructed by terrain >=2\"".
  // The Barricades stand as terrain here too and pay Terrain Protection like
  // any piece of their Height: the 3-inch AS3 walls and the 2-inch Turtle
  // Shell, to whichever unit is behind them (Supplementary Rules 1.04, 1.2).
  const cover = [...terrain, ...unitTerrain(tokens.filter((t) => t.uid !== attacker.uid && t.uid !== defender.uid))]
    .filter((p) => p.providesProtection && !touching(p));
  // 4.5.3: standing in the line is not the same as protecting. Only LARGE
  // Units provide Unit Protection — "medium Units do not" — while Ally and
  // Enemy alike count among the Large ones. Every Mech in this app is size 3
  // (makeMechToken), so what this filter takes out is Drones, which used to
  // hand out +2 White to both sides just by being on the board.
  //
  // ZHDR-101 Mobile Bunker is the printed exception, and only towards its own
  // side: it protects Ally Units, so the defender has to be one of them.
  //
  // The deployed Barricades (data.ts BARRICADE_CARDS) are size 1, so they give
  // no Unit Protection, which the Supplementary Rules 1.04 (1.2) now print.
  // What they pay is Terrain Protection, as terrain of their Height
  // (unitTerrain, in `cover` above).
  const protectors = tokens.filter((t) => t.size === 3 || (t.side === defender.side && mayProtectAllies(t)));
  const unitsOnly = losBetween(attacker, defender, [], protectors);
  // A unit that obstructs and pays nothing is the whole of what changed here,
  // so it is said out loud wherever it happens: as the entire answer when it is
  // the only thing in the line, and as a footnote when Terrain Protection alone
  // is the number. A player counting bodies on the table reads the board as +4
  // and the app as broken otherwise.
  // A Barricade is terrain, not a unit in the way (E1; 1.2).
  const idle = unitsOnly === 'clear' && losBetween(attacker, defender, [], tokens.filter((t) => !standsAsTerrain(t))) !== 'clear';
  const IDLE = 'the unit in the way is not Large, so there is no Unit Protection (4.5.3)';
  if (losBetween(attacker, defender, cover, protectors) === 'clear') {
    // And terrain that is in the way and pays nothing says so, as a unit that
    // is not Large does: a 1-inch Container, or a piece the attacker stands
    // against (4.5, FAQ A1). Without it the line above read "obstructed" and
    // the dice beside it said nothing (OTTO, 2026-10-05).
    const low = losBetween(attacker, defender, terrain.filter((p) => !cover.includes(p)), []) !== 'clear';
    const LOW = 'the terrain in the way is under 2" or touches the attacker, so there is no Terrain Protection (4.5, FAQ A1)';
    const why = [low ? LOW : '', idle ? IDLE : ''].filter(Boolean).join(', and ');
    return { white: 0, note: why ? `Obstructed, but ${why}` : '' };
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
      : 'Unit Protection (an Ally unit in the way provides it, ZHDR-101 Mobile Bunker)');
  }
  const note = parts.join(' + ') || 'Obstructed line of sight';
  return { white, note: idle ? `${note}, but ${IDLE}` : note };
}
