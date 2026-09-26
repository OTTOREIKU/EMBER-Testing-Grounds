import type { Side, SmokeScreen, TerrainPiece, Token } from './types';

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
export function dissipationFor(smoke: SmokeScreen[], side: Side): Dissipation {
  const groups = smokeGroups(smoke, side);
  return {
    isolated: groups.filter((g) => g.length === 1).map((g) => g[0]),
    groups: groups.filter((g) => g.length > 1),
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
  for (let dc = 0; dc < t.size; dc++) {
    for (let dr = 0; dr < t.size; dr++) {
      if (grids.has(`${Math.floor((t.col + dc) / 3)},${Math.floor((t.row + dr) / 3)}`)) return true;
    }
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
    const cells: { col: number; row: number }[] = [];
    for (let dc = 0; dc < o.size; dc++) for (let dr = 0; dr < o.size; dr++) cells.push({ col: o.col + dc, row: o.row + dr });
    if (!covers(cells)) continue;
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
  const { dist, trace } = searchMoves(t, steps, terrain, tokens, flying, opts);
  const goal = `${to.c},${to.r}`;
  if (!dist.has(goal)) return [];
  // A landing ban closes the ROUTE'S END, not the route: the grid may sit in
  // `dist` because a flight passed over it, and a path may not finish there.
  if (opts?.landing && !opts.landing(to.c, to.r)) return [];
  return trace(goal).map((k) => {
    const [c, r] = k.split(',').map(Number);
    return { c, r };
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

// The one line-walk behind both readers, so a smoke line and a terrain line are
// always the same line. With no smoke it is the plain losBetween it always
// was: an Aerial end sees everything, and one line not blocked is sight.
function walkLines(
  a: Token,
  b: Token,
  terrain: TerrainPiece[],
  tokens: Token[],
  smokeGrids: Set<string> | null,
): 'clear' | 'obstructed' | 'blocked' | 'smoked' {
  // 4.2.4: line of sight to or from an Aerial Unit is never Obstructed, and
  // terrain does not block it. Smoke still does (4.16).
  const aerial = !!(a.aerial || b.aerial);
  if (aerial && !smokeGrids) return 'clear';
  const losCells = new Set<string>();
  const obstructCells = new Set<string>();
  if (!aerial) {
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

  let anySight = false;
  let smokeTook = false;
  let anyObstruct = false;
  for (const pa of basePoints(a)) {
    for (const pb of basePoints(b)) {
      const len = Math.hypot(pb.x - pa.x, pb.y - pa.y);
      const n = Math.max(2, Math.ceil(len * 3));
      let lineBlocked = false;
      let lineObstruct = false;
      let lineSmoked = false;
      for (let i = 1; i < n; i++) {
        const x = pa.x + ((pb.x - pa.x) * i) / n;
        const y = pa.y + ((pb.y - pa.y) * i) / n;
        if (inBase(x, y, a) || inBase(x, y, b)) continue;
        const key = `${Math.floor(x)},${Math.floor(y)}`;
        if (losCells.has(key)) lineBlocked = true;
        if (obstructCells.has(key)) lineObstruct = true;
        if (smokeGrids?.has(`${Math.floor(x / 3)},${Math.floor(y / 3)}`)) lineSmoked = true;
      }
      if (!lineBlocked && !lineSmoked) anySight = true;
      if (!lineBlocked && lineSmoked) smokeTook = true;
      if (lineBlocked || lineObstruct) anyObstruct = true;
    }
  }
  if (!anySight) return smokeTook ? 'smoked' : 'blocked';
  return anyObstruct ? 'obstructed' : 'clear';
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
  const cells = new Set<string>();
  for (let dc = 0; dc < unit.size; dc++) {
    for (let dr = 0; dr < unit.size; dr++) cells.add(`${unit.col + dc},${unit.row + dr}`);
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
  if (action.type === 'Melee' && defender.aerial) bits.push('✕ Melee cannot target an Aerial unit (4.4.1)');
  if (action.type === 'Firing' && !action.anyDistance) {
    // Terrain and smoke on the same lines: any one line clear of both is sight
    // (4.2.4, 4.16; audit Phase 4, G1/G3).
    const sight = firingSight(attacker, defender, terrain, tokens, smoke);
    // "may claim", not "does": obstruction is only the trigger. A medium unit
    // in the way obstructs and pays nothing (4.5.3), as does terrain under 2"
    // (4.5.2), so the number is protectionFor's to say and not this line's.
    bits.push(sight === 'smoked'
      ? '✕ no line of sight clear of the Smoke Screen (4.16)'
      : sight === 'clear' ? 'LOS clear ✓'
        : sight === 'obstructed' ? '⚠ obstructed, so the defender may claim +2 White protection'
          : '✕ LOS blocked (3" terrain)');
  }
  // EXTENDED MELEE (a Melee Action with a Range) needs line of sight to the
  // target, 4.6.2 (p.59). Smoke is Firing's alone (4.16), so this is terrain
  // only. The Range 4 Harpoon landed through a building (audit Phase 4, H5).
  if (action.type === 'Melee' && (action.range ?? 0) > 0 && !action.anyDistance
    && losBetween(attacker, defender, terrain, tokens) === 'blocked') {
    bits.push('✕ Extended Melee needs line of sight, and 3" terrain blocks it (4.6.2)');
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
  const cover = terrain.filter((p) => p.providesProtection && !touching(p));
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
      : 'Unit Protection (an Ally unit in the way provides it, ZHDR-101 Mobile Bunker)');
  }
  const note = parts.join(' + ') || 'Obstructed line of sight';
  return { white, note: idle ? `${note}, but ${IDLE}` : note };
}
