import type { Side, Token } from './types';

// ---------- state ----------

export type TaskItemKind = 'blackbox' | 'terminal' | 'control';

export interface TaskItem {
  id: string;
  kind: TaskItemKind;
  zone: string;
  col?: number;
  row?: number;
  bearerUid?: number;
  bearerSlot?: string;
  // The bearer's base as a Penetration found it: the attacker owes a drop in
  // Contact with it (5.3.1, P3), and that stays true when the same attack
  // destroys the bearer and takes it off the board. The Box was lost that way
  // (audit Phase 6, F1). Cleared by the drop.
  dropFrom?: { col: number; row: number; size: number };
  // The squad that placed this Black Box at setup (5.2.1 step 3; ruling I23),
  // alternately from the First Player. Unset, it stands on its default spot.
  set?: Side;
  control?: Side | null;
  accessed?: Side | null;
}

export interface Kills {
  mechs: number;
  drones: number;
  partsAndDrones: number;
  // Of `mechs`, the ones removed in the End Phase for Integrity Loss (3.7.1).
  // Mercy leaves them out ("Enemy Mechs removed to Integrity Loss do not
  // count"); Annihilation counts them all (audit Phase 6, D2).
  integrity?: number;
}

// One Part that has left the board, remembered by the CARD that was in the
// slot. A destroyed Unit is removed outright (4.4.4) and a destroyed Part on a
// removed Unit is never written to partStates at all — a Torso kill never
// touches the backpack — so a Part that pays out at game end for "if this Part
// is destroyed" has nothing left to read. The fact has to be stamped when it
// happens, which is why this is a ledger and not a board reading.
export interface PartLoss {
  side: Side;
  uid: number;
  slot: string;
  cardId: string;
}

export interface TaskState {
  main?: string;
  secondary: { s1?: string; s2?: string };
  items: TaskItem[];
  vp: { s1: number; s2: number };
  leader: { s1?: number; s2?: number };
  secTarget: { s1?: number; s2?: number };
  zone: { s1?: string; s2?: string };
  // A hold-zone Task (Excavation Claim) SAID to be held, for a table with no
  // board to read the units' positions from. Written only by claimZone; a
  // board never sets it and goes on reading the Grids.
  zoneHeld?: { s1?: boolean; s2?: boolean };
  kills: { s1: Kills; s2: Kills };
  testKills: { s1: number; s2: number };
  paidKills: { s1: Kills; s2: Kills };
  paidTestKills: { s1: number; s2: number };
  partsLost: PartLoss[];
  scored: string[];
  // The Main Task draw (3.1.3): three cards dealt, each squad discards one,
  // the card left is played. Cleared when the Task is set. Rides the table so
  // both phones see the same three and each other's discard.
  draw?: string[];
  drawDiscards?: { s1?: string; s2?: string };
  // The squad that conceded (the `concede` command). FAQ P21 has a game run
  // its rounds, so this is the one early end the table chooses (ruling I1;
  // audit Phase 6, B8).
  conceded?: Side;
}

export function newKills(): Kills {
  return { mechs: 0, drones: 0, partsAndDrones: 0, integrity: 0 };
}

// Destroyed, as every scorer must read it: the boards remove a destroyed unit
// (4.4.4), but the pad keeps one in its tokens for its destroyed list, so
// absence alone read a kill tapped on the pad as a unit still standing (audit
// Phase 6, D4). The Torso, or a Drone's `main`, decides it, as loop.ts alive().
function standing(t: Token | undefined): t is Token {
  return !!t && (t.partStates[t.kind === 'mech' ? 'torso' : 'main'] ?? 'intact') !== 'destroyed';
}

export function newTaskState(): TaskState {
  return {
    secondary: {}, items: [], vp: { s1: 0, s2: 0 }, leader: {}, secTarget: {}, zone: {},
    kills: { s1: newKills(), s2: newKills() }, testKills: { s1: 0, s2: 0 },
    paidKills: { s1: newKills(), s2: newKills() }, paidTestKills: { s1: 0, s2: 0 },
    partsLost: [], scored: [],
  };
}

// ---------- what Task Setup is still waiting on (5.2.3) ----------
//
// A Task that names a Mech or a Tactical Zone is only set up once the naming
// has happened, and the naming is not always done by the player who scores it:
// Behead has the OPPONENT name one of their own Mechs. Both halves of the app
// read this, so the panel that asks and the rule that waits cannot disagree.

export interface SecondaryLike { id: string; name: string; designate?: string }

export interface Designation {
  // Whose Task this belongs to — the side that will score it.
  side: Side;
  what: 'target' | 'zone' | 'leader';
  // The player who makes the choice.
  by: Side;
  // For a Mech, the squad it has to come from.
  owner?: Side;
  label: string;
}

const other = (s: Side): Side => (s === 's1' ? 's2' : 's1');

export function pendingDesignations(
  st: TaskState,
  cards: SecondaryLike[],
  mission: MissionLike | undefined,
  tokens: Token[],
): Designation[] {
  const out: Designation[] = [];
  const hasMech = (side: Side) => tokens.some((t) => t.kind === 'mech' && t.side === side);
  for (const side of ['s1', 's2'] as Side[]) {
    const card = st.secondary[side] ? cards.find((c) => c.id === st.secondary[side]) : undefined;
    if (!card || !card.designate || card.designate === 'none') continue;
    if (card.designate === 'zone') {
      if (!st.zone[side]) out.push({ side, what: 'zone', by: side, label: card.name });
      continue;
    }
    // Who OWNS the named Mech differs by card: enemy-own-mech and enemy-mech
    // both name one of the opponent's, own-mech names your own. Who CHOOSES
    // differs too — enemy-own-mech is the opponent's call about their own
    // squad, the rest are yours.
    const owner: Side = card.designate === 'enemy-mech' || card.designate === 'enemy-own-mech' ? other(side) : side;
    const by: Side = card.designate === 'enemy-own-mech' ? owner : side;
    if (st.secTarget[side] === undefined && hasMech(owner)) {
      out.push({ side, what: 'target', by, owner, label: card.name });
    }
  }
  // The VIP Main Task needs both Commanders named before there is anything to
  // assassinate, and each side names their own.
  if (mission?.family === 'vip') {
    for (const side of ['s1', 's2'] as Side[]) {
      if (st.leader[side] === undefined && hasMech(side)) {
        out.push({ side, what: 'leader', by: side, owner: side, label: 'Commander' });
      }
    }
  }
  return out;
}

// The Large Grid a Tactical Zone's Item sits in: the middle of the zone, not
// the corner of it. Both boards read this, because an Item drawn from the
// first cell instead of the average lands somewhere the zone is not.
// The middle of an L-shaped zone can fall outside it: the Charlie and Golf
// Terminals were drawn at C11 and K3, off their zones. Then it is the zone's
// own Grid nearest that middle (audit Phase 6, E4). Only where an Item is
// DRAWN: a Range runs to any Grid of the zone (rangeToZone).
export function zoneCentreGrid(
  zones: ZoneLike[],
  zoneId: string,
): { c: number; r: number } | null {
  const zone = zones.find((z) => z.id === zoneId);
  if (!zone?.cells.length) return null;
  const grids = zone.cells.map(gridRef).filter((g): g is { col: number; row: number } => !!g);
  if (!grids.length) return null;
  const mc = grids.reduce((n, g) => n + g.col, 0) / grids.length;
  const mr = grids.reduce((n, g) => n + g.row, 0) / grids.length;
  const c = Math.round(mc);
  const r = Math.round(mr);
  if (grids.some((g) => g.col === c && g.row === r)) return { c, r };
  let best = grids[0];
  for (const g of grids) {
    if ((g.col - mc) ** 2 + (g.row - mr) ** 2 < (best.col - mc) ** 2 + (best.row - mr) ** 2) best = g;
  }
  return { c: best.col, r: best.row };
}

function gridRef(ref: string): { col: number; row: number } | null {
  const m = /^([A-Ra-r])(\d{1,2})$/.exec(ref.trim());
  if (!m) return null;
  return { col: m[1].toUpperCase().charCodeAt(0) - 65, row: Number(m[2]) - 1 };
}

// ---------- Main Task setup (5.1) ----------

export interface MissionLike { family: string; zones?: string[] }
export interface ZoneLike { id: string; name: string; cells: string[] }

// A ref ("C7") on the zone overlay. A private copy of the parser in data.ts,
// because this module is compiled standalone by the test slices -- do NOT
// replace it with an import, and DO keep it in step: gridref.test.mjs reads
// both files and fails if the regex or the bound drifts apart.
// Grid refs reach A-R / 1-18: 18 Large Grids is the largest board we ship, so
// the parser accepts any ref that could name a Grid on ANY board and leaves
// "is that Grid on THIS board" to the caller, which is the only place that
// knows the board's size. Parsing to the maximum keeps a map's authored zones
// readable whatever size it was drawn at.
function zoneRef(ref: string): { col: number; row: number } | null {
  const m = /^([A-Ra-r])(\d{1,2})$/.exec(ref.trim());
  if (!m) return null;
  const col = m[1].toUpperCase().charCodeAt(0) - 65;
  const row = Number(m[2]) - 1;
  if (col < 0 || col > 17 || row < 0 || row > 17) return null;
  return { col, row };
}

// The Task Items a Main Task puts on the board, derived from its zones. Rides
// inside configureTable pre-computed, so both seats hold the identical set.
// `objectives` are the map author's EXPLICIT spots (E2), matched on the zone
// NAME the mission card prints. Structurally typed rather than imported so this
// module keeps standing alone for the test slices.
export interface ObjectiveLike { kind: string; zone: string; col: number; row: number }

export function taskItemsFor(zones: ZoneLike[], m: MissionLike, objectives: ObjectiveLike[] = []): TaskState {
  const st = newTaskState();
  const kind = m.family === 'blackbox' ? 'blackbox' : m.family === 'terminal' ? 'terminal' : m.family === 'control' ? 'control' : null;
  if (!kind) return st;
  for (const name of m.zones ?? []) {
    const zone = zones.find((z) => z.name.toLowerCase() === name.toLowerCase());
    if (!zone) continue;
    const item: TaskItem = { id: `${kind}-${zone.id}`, kind, zone: zone.id, control: null, accessed: null };
    // PREFER what the author placed, fall back to what we always derived. The
    // explicit spot is matched on the zone's NAME, which is what the mission
    // card prints and what the editor binds -- an id would break the moment a
    // zone was deleted and repainted.
    const placed = objectives.find((o) => o.kind === kind && o.zone.toLowerCase() === zone.name.toLowerCase());
    if (placed) {
      item.col = placed.col;
      item.row = placed.row;
    } else if (kind === 'blackbox') {
      // Nobody has placed it yet: the default spot (ruling I23), the centre of
      // the zone's Grid nearest the middle of the zones. The zone's FIRST Grid
      // was used, always its top-left one, and in Asset Preservation that put
      // the Alpha and Golf Boxes inside the Black deployment strip (audit
      // Phase 6, F3). The players then place them alternately at setup.
      const g = boxDefaultGrid(zones, zone);
      if (g) {
        item.col = g.col * 3 + 1;
        item.row = g.row * 3 + 1;
      }
    }
    st.items.push(item);
  }
  return st;
}

export function normaliseTasks(raw: unknown): TaskState {
  const t = (raw ?? {}) as Partial<TaskState>;
  const side = (v: unknown): Side | undefined => (v === 's1' || v === 's2' ? v : undefined);
  const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.round(v)) : 0);
  return {
    main: typeof t.main === 'string' ? t.main : undefined,
    secondary: {
      s1: typeof t.secondary?.s1 === 'string' ? t.secondary.s1 : undefined,
      s2: typeof t.secondary?.s2 === 'string' ? t.secondary.s2 : undefined,
    },
    items: Array.isArray(t.items)
      ? t.items
          .filter((i): i is TaskItem => !!i && typeof i.id === 'string' && typeof i.zone === 'string')
          .map((i) => ({
            id: i.id,
            kind: i.kind === 'terminal' || i.kind === 'control' ? i.kind : 'blackbox',
            zone: i.zone,
            col: typeof i.col === 'number' ? i.col : undefined,
            row: typeof i.row === 'number' ? i.row : undefined,
            bearerUid: typeof i.bearerUid === 'number' ? i.bearerUid : undefined,
            bearerSlot: typeof i.bearerSlot === 'string' ? i.bearerSlot : undefined,
            ...(i.dropFrom && typeof i.dropFrom.col === 'number' && typeof i.dropFrom.row === 'number' && typeof i.dropFrom.size === 'number'
              ? { dropFrom: { col: i.dropFrom.col, row: i.dropFrom.row, size: i.dropFrom.size } }
              : {}),
            ...(side(i.set) ? { set: side(i.set) } : {}),
            control: side(i.control) ?? null,
            accessed: side(i.accessed) ?? null,
          }))
      : [],
    vp: { s1: num(t.vp?.s1), s2: num(t.vp?.s2) },
    leader: {
      s1: typeof t.leader?.s1 === 'number' ? t.leader.s1 : undefined,
      s2: typeof t.leader?.s2 === 'number' ? t.leader.s2 : undefined,
    },
    zone: {
      s1: typeof t.zone?.s1 === 'string' ? t.zone.s1 : undefined,
      s2: typeof t.zone?.s2 === 'string' ? t.zone.s2 : undefined,
    },
    zoneHeld: { s1: t.zoneHeld?.s1 === true ? true : undefined, s2: t.zoneHeld?.s2 === true ? true : undefined },
    secTarget: {
      s1: typeof t.secTarget?.s1 === 'number' ? t.secTarget.s1 : undefined,
      s2: typeof t.secTarget?.s2 === 'number' ? t.secTarget.s2 : undefined,
    },
    kills: { s1: kills(t.kills?.s1), s2: kills(t.kills?.s2) },
    testKills: { s1: num(t.testKills?.s1), s2: num(t.testKills?.s2) },
    paidKills: { s1: kills(t.paidKills?.s1), s2: kills(t.paidKills?.s2) },
    paidTestKills: { s1: num(t.paidTestKills?.s1), s2: num(t.paidTestKills?.s2) },
    // This is a WHITELIST: a field left out here is silently dropped on every
    // rehydrate, network round-trip and rollback, and the -1 riders would come
    // back to life on a reload. Listed the day it was added, deliberately.
    partsLost: Array.isArray(t.partsLost)
      ? t.partsLost
          .filter((p): p is PartLoss => !!p && typeof p.uid === 'number' && typeof p.slot === 'string' && typeof p.cardId === 'string')
          .map((p) => ({ side: side(p.side) ?? 's1', uid: p.uid, slot: p.slot, cardId: p.cardId }))
      : [],
    scored: Array.isArray(t.scored) ? t.scored.filter((x): x is string => typeof x === 'string') : [],
    ...(Array.isArray(t.draw) && t.draw.length
      ? {
          draw: t.draw.filter((x): x is string => typeof x === 'string'),
          drawDiscards: {
            ...(typeof t.drawDiscards?.s1 === 'string' ? { s1: t.drawDiscards.s1 } : {}),
            ...(typeof t.drawDiscards?.s2 === 'string' ? { s2: t.drawDiscards.s2 } : {}),
          },
        }
      : {}),
    ...(side(t.conceded) ? { conceded: side(t.conceded) } : {}),
  };

  function kills(raw: unknown): Kills {
    const k = (raw ?? {}) as Partial<Kills>;
    return { mechs: num(k.mechs), drones: num(k.drones), partsAndDrones: num(k.partsAndDrones), integrity: num(k.integrity) };
  }
}

// ---------- zones ----------

export function cellToGrid(cell: string): { c: number; r: number } | null {
  const m = /^([A-Za-z])(\d+)$/.exec(cell.trim());
  if (!m) return null;
  return { c: m[1].toUpperCase().charCodeAt(0) - 65, r: Number(m[2]) - 1 };
}

export function inZone(t: Token, cells: string[]): boolean {
  const c = Math.floor(t.col / 3);
  const r = Math.floor(t.row / 3);
  return cells.some((cell) => {
    const g = cellToGrid(cell);
    return !!g && g.c === c && g.r === r;
  });
}

// ---------- Black Boxes (5.3.1) ----------

// A Black Box's default Grid: the one of its zone nearest the middle of all the
// zones, so the Boxes of a mirrored pair of zones land on mirrored Grids. A tie
// goes to the Grid whose offset from the middle has dx*dy > 0, a choice a
// 180-degree turn keeps, so the pair stays mirrored (ruling I23).
function boxDefaultGrid(zones: ZoneLike[], zone: ZoneLike): { col: number; row: number } | null {
  const refs = (z: ZoneLike) => z.cells.map(zoneRef).filter((g): g is { col: number; row: number } => !!g);
  const own = refs(zone);
  const all = zones.flatMap(refs);
  if (!own.length || !all.length) return null;
  const mc = all.reduce((n, g) => n + g.col, 0) / all.length;
  const mr = all.reduce((n, g) => n + g.row, 0) / all.length;
  const score = (g: { col: number; row: number }): [number, number] => {
    const dx = g.col - mc;
    const dy = g.row - mr;
    return [dx * dx + dy * dy, dx * dy > 0 ? 0 : 1];
  };
  let best = own[0];
  let bs = score(best);
  for (const g of own.slice(1)) {
    const s = score(g);
    if (s[0] < bs[0] - 1e-9 || (Math.abs(s[0] - bs[0]) < 1e-9 && s[1] < bs[1])) {
      best = g;
      bs = s;
    }
  }
  return best;
}

// Whose turn it is to place a Black Box at setup: the First Player places one,
// then the squads alternate (5.2.1 step 3). Null once every Box is placed.
export function boxPlaceTurn(tasks: TaskState, firstPlayer: Side): Side | null {
  const boxes = tasks.items.filter((i) => i.kind === 'blackbox');
  if (!boxes.some((i) => !i.set)) return null;
  const other: Side = firstPlayer === 's1' ? 's2' : 's1';
  const by = (s: Side) => boxes.filter((i) => i.set === s).length;
  return by(firstPlayer) <= by(other) ? firstPlayer : other;
}

// ---------- deployment (3.1.4; FAQ P23) ----------

// The Large Grids ("c,r") a squad deploys into from this edge: the table's own
// Deployment Zones, or the printed shape its zone set or Main Task names (2x12
// strips when neither does). Null for a zone set only one browser can read (a
// player's own map), where the page's placement is the judge. One reader for
// the deployUnit check and the Match Centre (audit Phase 6, A3).
export function deployGrids(
  zoneData: { deployments?: { id: string; black: { from: string; to: string }; white: { from: string; to: string } }[]; missionDeployment?: Record<string, string> } | undefined,
  state: { mission?: string | null; zoneSet?: string | null; deployZones?: { black: string[]; white: string[] } },
  edge: 'black' | 'white',
): Set<string> | null {
  const out = new Set<string>();
  const own = state.deployZones?.[edge];
  if (own?.length) {
    for (const ref of own) {
      const g = zoneRef(ref);
      if (g) out.add(`${g.col},${g.row}`);
    }
    return out;
  }
  const set = state.zoneSet ?? '';
  if (set.startsWith('custom:')) return null;
  const by = zoneData?.missionDeployment ?? {};
  const shape = set.startsWith('board:')
    ? set.slice(6).split('+').find((p) => p === 'corners' || p === 'strips')
    : set.startsWith('mission:')
      ? by[set.slice(8)] || 'strips'
      : (state.mission && by[state.mission]) || 'strips';
  const area = shape ? (zoneData?.deployments ?? []).find((d) => d.id === shape)?.[edge] : undefined;
  const a = area && zoneRef(area.from);
  const b = area && zoneRef(area.to);
  if (!a || !b) return null;
  for (let c = Math.min(a.col, b.col); c <= Math.max(a.col, b.col); c++) {
    for (let r = Math.min(a.row, b.row); r <= Math.max(a.row, b.row); r++) out.add(`${c},${r}`);
  }
  return out;
}

// Where a unit may still deploy: an unoccupied Grid of the zone, one unit to a
// Grid (3.1.4; ruling I4). Once every one is taken, the Grids next to the
// zone, working outward a ring at a time (FAQ P23). `taken` holds the Grids
// with a unit in them; `grids` is the board's width in Large Grids.
export function deployOpenGrids(zone: Set<string>, taken: Set<string>, grids: number): Set<string> {
  let ring = new Set(zone);
  const seen = new Set(zone);
  for (let step = 0; step < grids && ring.size; step++) {
    const open = [...ring].filter((k) => !taken.has(k));
    if (open.length) return new Set(open);
    const next = new Set<string>();
    for (const k of ring) {
      const [c, r] = k.split(',').map(Number);
      for (let dc = -1; dc <= 1; dc++) {
        for (let dr = -1; dr <= 1; dr++) {
          const nc = c + dc;
          const nr = r + dr;
          const key = `${nc},${nr}`;
          if (nc < 0 || nr < 0 || nc >= grids || nr >= grids || seen.has(key)) continue;
          seen.add(key);
          next.add(key);
        }
      }
    }
    ring = next;
  }
  return new Set();
}

// The Parts of a unit carrying a Black Box. Their Freehand is invalid while
// they do (5.3.1): for a second Box, and for [Two-Handed], which every caller
// used to ask with an empty list (audit Phase 6, F7).
export function boxHands(tasks: unknown, uid: number): string[] {
  return normaliseTasks(tasks).items
    .filter((i) => i.kind === 'blackbox' && i.bearerUid === uid && i.bearerSlot)
    .map((i) => i.bearerSlot!);
}

// A bearer leaving the board with no drop owed, on Integrity Loss or into the
// Abyss, leaves its Boxes in the Grid it stood in (ruling I20). They vanished
// with it (audit Phase 6, F9). A Box a Penetration owes the attacker is left
// for that drop.
// `owedToo`: the End Phase's Integrity Loss, by which time no attacker's drop
// is still coming, so a stale owed one is left in the Grid as well.
export function leaveBoxes(tasks: TaskState, t: { uid: number; col: number; row: number }, owedToo = false): void {
  for (const i of tasks.items) {
    if (i.kind !== 'blackbox' || i.bearerUid !== t.uid || (i.dropFrom && !owedToo)) continue;
    i.bearerUid = undefined;
    i.bearerSlot = undefined;
    delete i.dropFrom;
    i.col = Math.floor(t.col / 3) * 3 + 1;
    i.row = Math.floor(t.row / 3) * 3 + 1;
  }
}

// ---------- Terminals and Remote Access (5.3.3, p.87) ----------

// The Range from a unit to a Tactical Zone: to its NEAREST Grid. Remote Access
// "may choose any Grid of the Terminal's Tactical Zone" (FAQ P6), and p.87
// makes the whole zone the Access Range. The zone's middle Grid was measured,
// so an access up to 2 Grids short of the zone was refused, and the rounding
// favoured an approach from the bottom and right (audit Phase 6, E1). Null for
// a zone with no Grids.
export function rangeToZone(t: { col: number; row: number }, cells: string[]): number | null {
  const c = Math.floor(t.col / 3);
  const r = Math.floor(t.row / 3);
  let best: number | null = null;
  for (const cell of cells) {
    const g = cellToGrid(cell);
    if (!g) continue;
    const d = Math.abs(g.c - c) + Math.abs(g.r - r);
    if (best === null || d < best) best = d;
  }
  return best;
}

// The Terminals a Remote Access could still take: face-up this round and, on
// a board, within `reach` of their Tactical Zone. `cells` null is a table with
// no board, where the players judge the Range. One reader for both boards, the
// pad and the check.
export function terminalsInReach(
  items: TaskItem[],
  t: { col: number; row: number },
  reach: number,
  cells: ((zone: string) => string[]) | null,
): TaskItem[] {
  return items.filter((i) => i.kind === 'terminal' && !i.accessed
    && (!cells || (rangeToZone(t, cells(i.zone)) ?? Infinity) <= reach));
}

// Why a Remote Access would change nothing now, or null. An Action that can
// change nothing is not performed (FAQ J8's principle; ruling I26; audit
// Phase 6, E3): no Terminal on the table, or none left face-up in reach.
export function remoteAccessWhy(
  items: TaskItem[],
  t: { col: number; row: number },
  reach: number,
  cells: ((zone: string) => string[]) | null,
): string | null {
  if (!items.some((i) => i.kind === 'terminal')) return 'There is no Terminal on the table to access (5.3.3).';
  if (terminalsInReach(items, t, reach, cells).length) return null;
  return cells
    ? `No Terminal within Range ${reach} of its Tactical Zone is still face-up: each is accessed once per round (5.3.3).`
    : 'Every Terminal has already been accessed this round (5.3.3).';
}

// A Terminal's Electronic Value (p.87).
export const TERMINAL_EV = 3;

// The Terminal as the RESPONDER of a Remote Access Counter-roll (p.87; ruling
// I25). A Terminal is not a unit, and the Counter-roll window is built around
// two, so the roll was left to the table and the pages only asked how it went
// (OTTO, 2026-09-28: build the stand-in). It gets this sentinel uid, on the
// Initiator's opponent's side, since the opponent rolls the Terminal's dice.
// electronicStrength gives it TERMINAL_EV, counterOffensive never counts its
// hollow faces, and it never Focuses: no unit on the board is it, so
// counterStage finds nothing that could pay for one.
export const TERMINAL_UID = -1;

export function isTerminalStandIn(t: { uid: number }): boolean {
  return t.uid === TERMINAL_UID;
}

// The stand-in the window draws, where the Terminal's token stands.
export function terminalStandIn(item: Pick<TaskItem, 'col' | 'row'>, initiatorSide: Side, zoneName: string): Token {
  return {
    uid: TERMINAL_UID,
    side: initiatorSide === 's1' ? 's2' : 's1',
    kind: 'drone',
    cardId: '',
    label: `${zoneName} Terminal`,
    col: item.col ?? 0,
    row: item.row ?? 0,
    size: 1,
    facing: 0,
    aerial: false,
    link: 0,
    partStates: {},
    ammo: {},
    intercept: {},
    statuses: [],
    log: [],
  } as unknown as Token;
}

// ---------- Low Value Units (book p.82) ----------

export function isLowValue(t: Token, tagged?: (t: Token) => boolean): boolean {
  if (t.kind === 'projectile') return true;
  return tagged ? tagged(t) : false;
}

// ---------- control zones (5.3.2) ----------

// 5.3.2 and 5.3.3 are deliberately asymmetric, so the two halves differ here.
// Capturing is interacting with a Task Item, which a Low Value Unit may never do
// (p.82), and the rule names "Mechs or Drones". Blocking is not interacting: it
// is standing on contested ground, and the rule widens to "no enemy Units" with
// no Low Value carve-out. The Excavation Claim card has to print "Low Value
// Units do not count" precisely because that exclusion is not the default, which
// is the clearest evidence the default is presence-counts-for-everything.
export function controlOf(cells: string[], tokens: Token[], lowValue?: (t: Token) => boolean): Side | null {
  const inside = tokens.filter((t) => t.deployed !== false && inZone(t, cells));
  if (!inside.length) return null;
  const sides: Side[] = ['s1', 's2'];
  for (const side of sides) {
    const holds = inside.some(
      (t) => t.side === side
        && !isLowValue(t, lowValue)
        && ((t.kind === 'mech' && t.stance !== 'shutdown') || t.kind === 'drone'),
    );
    const enemy = inside.some((t) => t.side !== side);
    if (holds && !enemy) return side;
  }
  return null;
}

// ---------- terminals (5.3.3) ----------

// A Control dial keeps its holder until someone else takes the zone, while a
// Terminal is only marked when nobody has accessed it yet this round (5.3).
export function settleControl(
  tasks: TaskState,
  zoneCells: (zone: string) => string[],
  tokens: Token[],
  lowValue?: (t: Token) => boolean,
): void {
  for (const item of tasks.items) {
    const cells = zoneCells(item.zone);
    if (item.kind === 'control') {
      const holder = controlOf(cells, tokens, lowValue);
      if (holder) item.control = holder;
      continue;
    }
    if (item.kind === 'terminal' && !item.accessed) {
      item.accessed = directAccess(cells, tokens, lowValue);
    }
  }
}

export function directAccess(cells: string[], tokens: Token[], lowValue?: (t: Token) => boolean): Side | null {
  return controlOf(cells, tokens, lowValue);
}

// ---------- scoring ----------

export interface MissionScoring {
  family: 'blackbox' | 'control' | 'terminal' | 'vip';
  vp: number;
  zones: string[];
  fromRound: number;
  cadence: 'per-round' | 'at-end';
  // Asset Preservation scores only the Boxes "they hold that is in the Echo
  // zone" — the Boxes have to be carried to the centre. A held Box is wherever
  // its bearer stands, so this is read off the bearer's Grid.
  scoringZone?: string;
  // VIP's second clause: "If neither Commander is destroyed after 5 rounds,
  // each player gains 3 Victory Points for each Part of the Enemy Commander
  // that has been Destroyed" (audit Phase 6, D1).
  vpPerPart?: number;
}

export interface ScoreLine {
  side: Side;
  vp: number;
  why: string;
  key?: string;
}

export function unpaidLines(lines: ScoreLine[], scored: string[]): ScoreLine[] {
  return lines.filter((l) => !l.key || !scored.includes(l.key));
}

export interface ScoreResult {
  lines: ScoreLine[];
  s1: number;
  s2: number;
}

// `zoneCells` is last and optional so the older five-argument calls still read
// correctly — the argument order of the two scorers has bitten this codebase
// before. It is only consulted by a mission that names a scoringZone.
export function scoreMain(
  m: MissionScoring,
  st: TaskState,
  tokens: Token[],
  round: number,
  finalRound: boolean,
  zoneCells?: (zone: string) => string[],
): ScoreResult {
  const lines: ScoreLine[] = [];
  const byUid = new Map(tokens.map((t) => [t.uid, t]));
  if (round < m.fromRound) return { lines: [], s1: 0, s2: 0 };
  if (m.cadence === 'at-end' && !finalRound) return { lines: [], s1: 0, s2: 0 };

  if (m.family === 'blackbox') {
    for (const side of ['s1', 's2'] as Side[]) {
      const wants = m.scoringZone;
      const held = heldBoxes(m, st, byUid, side, zoneCells);
      if (held.length) {
        lines.push({
          side,
          vp: held.length * m.vp,
          why: `${held.length} Black Box${held.length === 1 ? '' : 'es'}${wants ? ` held in ${wants}` : ' in possession'} at ${m.vp} VP each`,
          // Paid once in a game: an Extra round past the limit, or a second
          // Award, offered it again (audit Phase 6, B7, B9).
          key: `main:${side}:end`,
        });
      }
    }
  }

  if (m.family === 'control') {
    for (const side of ['s1', 's2'] as Side[]) {
      const held = st.items.filter((i) => i.kind === 'control' && i.control === side);
      if (held.length) {
        // Once a round (audit Phase 6, B7).
        lines.push({ side, vp: held.length * m.vp, why: `${held.length} controlled Zone${held.length === 1 ? '' : 's'} at ${m.vp} VP each`, key: `main:${side}:r${round}` });
      }
    }
  }

  if (m.family === 'terminal') {
    for (const side of ['s1', 's2'] as Side[]) {
      const got = st.items.filter((i) => i.kind === 'terminal' && i.accessed === side);
      if (got.length) {
        lines.push({ side, vp: got.length * m.vp, why: `${got.length} Terminal${got.length === 1 ? '' : 's'} accessed at ${m.vp} VP each`, key: `main:${side}:r${round}` });
      }
    }
  }

  if (m.family === 'vip') {
    for (const side of ['s1', 's2'] as Side[]) {
      const enemy: Side = side === 's1' ? 's2' : 's1';
      const uid = st.leader[enemy];
      if (uid === undefined) continue;
      if (!standing(byUid.get(uid))) {
        // A bounty pays once, and the card ends the game at this round's
        // End Phase (ruling I2; audit Phase 6, B2).
        lines.push({ side, vp: m.vp, why: `the enemy Commander is destroyed, which ends the game`, key: `vip:${side}` });
      }
    }
    // "If neither Commander is destroyed after 5 rounds, each player gains 3
    // Victory Points for each Part of the Enemy Commander that has been
    // Destroyed" (the card; audit Phase 6, D1). A Repaired Part is still a
    // destroyed Part (FAQ J23).
    const c1 = st.leader.s1 !== undefined ? byUid.get(st.leader.s1) : undefined;
    const c2 = st.leader.s2 !== undefined ? byUid.get(st.leader.s2) : undefined;
    if (finalRound && m.vpPerPart && standing(c1) && standing(c2)) {
      for (const side of ['s1', 's2'] as Side[]) {
        const foe = side === 's1' ? c2 : c1;
        const lost = Object.values(foe.partStates).filter((p) => p === 'destroyed').length;
        if (lost) {
          lines.push({
            side,
            vp: lost * m.vpPerPart,
            why: `${lost} Part${lost === 1 ? '' : 's'} of the enemy Commander destroyed at ${m.vpPerPart} VP each`,
            key: `vip:parts:${side}`,
          });
        }
      }
    }
  }

  return tally(lines);
}

// The Boxes one side is holding that the Main Task will actually pay for.
//
// Asset Preservation pays only for Boxes carried into one named zone. With no
// lookup to read it with, the zone cannot be judged, and scoring every held Box
// would be the wrong answer in the safer direction for the holder — so nothing
// scores rather than everything.
//
// It is a shared helper rather than an inline filter because card 300's VP
// rider rides on exactly this list: a Box outside the scoringZone scores 0 base
// and must earn no rider either, and two copies of the filter would drift.
function heldBoxes(
  m: MissionScoring,
  st: TaskState,
  byUid: Map<number, Token>,
  side: Side,
  zoneCells?: (zone: string) => string[],
): TaskItem[] {
  const wants = m.scoringZone;
  const cells = wants && zoneCells ? zoneCells(wants) : null;
  return st.items.filter((i) => {
    if (i.kind !== 'blackbox' || i.bearerUid === undefined) return false;
    const bearer = byUid.get(i.bearerUid);
    // A dead bearer on the pad holds nothing (audit Phase 6, D4).
    if (!standing(bearer) || bearer.side !== side) return false;
    if (!wants) return true;
    // A table with no board cannot read where the bearer stands, so the
    // players say so: claimItem writes `accessed` on a Box, and nothing else
    // ever does (a board reads the Grid instead). A claim is for the bearer's
    // own side, which is the only side it could pay.
    if (i.accessed === side) return true;
    return !!cells?.length && inZone(bearer, cells);
  });
}

function tally(lines: ScoreLine[]): ScoreResult {
  let s1 = 0;
  let s2 = 0;
  for (const l of lines) {
    if (l.side === 's1') s1 += l.vp;
    else s2 += l.vp;
  }
  return { lines, s1, s2 };
}

// ---------- secondary tasks (5.2.3) ----------

export interface SecondaryScoring {
  id: string;
  name: string;
  vp: number;
  kind: 'destroy-designated' | 'survive-designated' | 'per-kill' | 'per-kill-by-unit' | 'no-mech-lost' | 'hold-zone';
}

// A Secondary Task belongs to one player and is open information. Most of them
// only settle when the game ends; the two counting cards read the kill ledger,
// which is why destructions are recorded as they happen.
export function scoreSecondary(
  card: SecondaryScoring,
  side: Side,
  st: TaskState,
  tokens: Token[],
  zoneCells: (zone: string) => string[],
  finalRound: boolean,
  lowValue?: (t: Token) => boolean,
): ScoreResult {
  const lines: ScoreLine[] = [];
  // Standing, not merely present: the pad keeps a dead unit in its tokens
  // (audit Phase 6, D4).
  const alive = (uid?: number) => uid !== undefined && standing(tokens.find((t) => t.uid === uid));
  const push = (vp: number, why: string, key?: string) => { if (vp > 0) lines.push({ side, vp, why, key }); };

  if (card.kind === 'destroy-designated') {
    const uid = st.secTarget[side];
    if (uid !== undefined && !alive(uid)) {
      push(card.vp, `${card.name}: the designated target is destroyed`, `sec:${side}:${card.id}`);
    }
  }

  if (card.kind === 'survive-designated' && finalRound) {
    const uid = st.secTarget[side];
    if (uid !== undefined && alive(uid)) {
      push(card.vp, `${card.name}: the designated unit survived`, `sec:${side}:${card.id}`);
    }
  }

  if (card.kind === 'per-kill') {
    // Annihilation: the printed value is per Mech, and a Drone is worth 1. Only
    // kills made since the last award are paid, so nothing ever pays twice.
    const k = st.kills[side];
    const paid = st.paidKills[side];
    const mechs = Math.max(0, k.mechs - paid.mechs);
    const drones = Math.max(0, k.drones - paid.drones);
    const vp = mechs * card.vp + drones;
    push(vp, `${card.name}: ${mechs} enemy Mech${mechs === 1 ? '' : 's'} at ${card.vp} VP and ${drones} Drone${drones === 1 ? '' : 's'} at 1 VP`);
  }

  if (card.kind === 'per-kill-by-unit') {
    const n = Math.max(0, st.testKills[side] - st.paidTestKills[side]);
    push(n * card.vp, `${card.name}: the Test Unit destroyed ${n} Part${n === 1 ? '' : 's'} or Drone${n === 1 ? '' : 's'}`);
  }

  if (card.kind === 'no-mech-lost' && finalRound) {
    // Mercy pays only if this side has destroyed no enemy Mech, and "Enemy
    // Mechs removed to Integrity Loss do not count" (audit Phase 6, D2).
    const k = st.kills[side];
    if (k.mechs - (k.integrity ?? 0) === 0) push(card.vp, `${card.name}: no enemy Mech was destroyed`, `sec:${side}:${card.id}`);
  }

  if (card.kind === 'hold-zone' && finalRound) {
    const zone = st.zone[side];
    if (zone && st.zoneHeld?.[side]) {
      // Said by the players (claimZone): the pad has no Grids to read.
      push(card.vp, `${card.name}: only your units are in the Excavation Site`, `sec:${side}:${card.id}`);
    } else if (zone) {
      const cells = zoneCells(zone);
      const inside = tokens.filter((t) => t.deployed !== false && standing(t) && !isLowValue(t, lowValue) && inZone(t, cells));
      if (inside.length && inside.every((t) => t.side === side)) {
        push(card.vp, `${card.name}: only your units are in the Excavation Site`, `sec:${side}:${card.id}`);
      }
    }
  }

  return tally(lines);
}

// ---------- printed Victory Point riders on a Part (cards 300 and 500) ----------
//
// Two backpacks print their own VP line: a bonus settled at the end of the game
// and a matching penalty if the Part itself is gone. Neither is a Secondary
// Task, so neither belongs in scoreSecondary — they settle alongside the Main
// Task, once, in the final round, which is why this is its own producer.
//
// SCOPE IS THE PART, NOT THE MECH. All three printings say 本部件 / "this
// Part", so a Mech that walks away with a blown backpack still takes the -1,
// and a Mech that dies with the backpack intact takes it too.
export interface VpRider {
  cardId: string;
  name: string;
  // 300 OCS85 Black Box Carrying Pack: "the Black Box carried by this unit
  // provides 1 additional Victory Point". PER BOX — FAQ P7 allows one Box per
  // Freehand, so carrying more than one is legal — and on top of the Main Task
  // award, not instead of it.
  perBlackBox?: number;
  // 500 HD-2 Data Backpack: +1 at the end of the game if this Mech is the
  // Escort Target of a Secondary Task and the Part is still there.
  escortSurvives?: number;
  // Both: -1 if this Part is destroyed. FLAT, once per card instance, however
  // many Boxes were being carried.
  penalty?: number;
}

// Which unit each side has designated as an ESCORT Target specifically.
// st.secTarget is one slot shared by every designation a Secondary Task can
// make — the Behead victim and the Weapons Test unit live there too — so "this
// Mech is the Escort Target" cannot be read off the uid alone. Shared rather
// than re-derived at each scoring page, because that is exactly how the two
// pages drift apart.
export function escortTargets(
  st: TaskState,
  kindOf: (cardId: string) => SecondaryScoring['kind'] | undefined,
): { s1?: number; s2?: number } {
  const out: { s1?: number; s2?: number } = {};
  for (const side of ['s1', 's2'] as Side[]) {
    const card = st.secondary[side];
    if (card && kindOf(card) === 'survive-designated') out[side] = st.secTarget[side];
  }
  return out;
}

// MechLoadout's own keys minus the pilot. Read off the token rather than
// importing PART_SLOTS, because tasks.ts holds no units.ts dependency by design
// — the same reason the card readers arrive as a callback.
function partSlotsOf(t: Token): string[] {
  return Object.keys(t.mech ?? {}).filter((k) => k !== 'pilot');
}

// `riderOf` is the trailing optional callback, the house style already used for
// `lowValue`: the card text lives in GameData and this module never sees it.
// Without it nothing scores, which is what freeplay wants — main.ts runs no
// Task scoring at all.
export function scoreRiders(
  m: MissionScoring | undefined,
  st: TaskState,
  tokens: Token[],
  finalRound: boolean,
  zoneCells?: (zone: string) => string[],
  escort?: { s1?: number; s2?: number },
  riderOf?: (cardId: string) => VpRider | undefined,
): ScoreResult {
  const lines: ScoreLine[] = [];
  // Both cards pay at the end of the game, so nothing is owed before it.
  if (!finalRound || !riderOf) return tally(lines);
  const byUid = new Map(tokens.map((t) => [t.uid, t]));

  // The bonus halves read a live Part on a live Mech, which needs no ledger.
  for (const t of tokens) {
    // A dead Mech the pad keeps in its tokens earns no bonus (audit Phase 6,
    // D4); its lost Parts are the ledger's, below.
    if (t.kind !== 'mech' || !t.mech || t.deployed === false || !standing(t)) continue;
    for (const slot of partSlotsOf(t)) {
      const cardId = (t.mech as Record<string, string | undefined>)[slot];
      if (!cardId) continue;
      if ((t.partStates[slot as keyof typeof t.partStates] ?? 'intact') === 'destroyed') continue;
      const r = riderOf(cardId);
      if (!r) continue;
      const key = `rider:${t.side}:${cardId}:${t.uid}`;
      // 300 is gated on the Black Box Main task being the one in play, and it
      // counts through heldBoxes so the scoringZone filter it inherits is the
      // very same one the Task award used.
      if (r.perBlackBox && m?.family === 'blackbox') {
        const n = heldBoxes(m, st, byUid, t.side, zoneCells).filter((i) => i.bearerUid === t.uid).length;
        if (n) {
          lines.push({
            side: t.side,
            vp: n * r.perBlackBox,
            why: `${r.name}: ${n} Black Box${n === 1 ? '' : 'es'} carried at ${r.perBlackBox} extra VP each`,
            key,
          });
        }
      }
      if (r.escortSurvives && escort?.[t.side] === t.uid) {
        lines.push({ side: t.side, vp: r.escortSurvives, why: `${r.name}: the Escort Target still carries it`, key });
      }
    }
  }

  // The penalty halves read the ledger instead: the Mech may be off the board
  // entirely, and either way the -1 is owed.
  for (const loss of st.partsLost) {
    const r = riderOf(loss.cardId);
    if (!r?.penalty) continue;
    // FAQ P22: with no designation there is no bonus AND no penalty. The same
    // reading gates 300 on the Task it names — a Black Box card in a Control
    // Zone game prints a rule about a Task that is not being played.
    if (r.perBlackBox && m?.family !== 'blackbox') continue;
    if (r.escortSurvives && escort?.[loss.side] !== loss.uid) continue;
    lines.push({
      side: loss.side,
      vp: -r.penalty,
      why: `${r.name}: the Part was destroyed`,
      key: `riderlost:${loss.side}:${loss.cardId}:${loss.uid}`,
    });
  }

  return tally(lines);
}

// One destruction, entering the ledger. Combat reports a destroyed Part and a
// destroyed Unit as separate events, and a Drone death arrives as both, so each
// event type only counts what belongs to it: 'part' counts Mech Parts, 'unit'
// counts whole Units. Friendly fire and Low Value Units never count (p.82).
export function applyKill(
  st: TaskState,
  killer: { side: Side; uid: number },
  victim: { side: Side; kind: Token['kind']; lowValue?: boolean },
  what: 'part' | 'unit',
  // A Mech removed in the End Phase for Integrity Loss: still the last
  // destroyer's kill (FAQ P4), but one Mercy leaves out (audit Phase 6, D2).
  how?: 'integrity',
): void {
  if (killer.side === victim.side) return;
  if (victim.kind === 'projectile' || victim.lowValue) return;
  const k = st.kills[killer.side];
  const test = st.secTarget[killer.side] === killer.uid;
  if (what === 'part' && victim.kind === 'mech') {
    k.partsAndDrones += 1;
    if (test) st.testKills[killer.side] += 1;
  }
  if (what === 'unit') {
    if (victim.kind === 'mech') {
      k.mechs += 1;
      if (how === 'integrity') k.integrity = (k.integrity ?? 0) + 1;
    }
    if (victim.kind === 'drone') {
      k.drones += 1;
      k.partsAndDrones += 1;
      if (test) st.testKills[killer.side] += 1;
    }
  }
}

// applyKill in reverse, for a hand-set Destroyed taken back on the pad (a
// mis-tap is undone by tapping on, never by an Undo). Clamped at 0, and the
// same exclusions, so taking back a tally that was never paid changes nothing.
export function retractKill(
  st: TaskState,
  killer: { side: Side; uid: number },
  victim: { side: Side; kind: Token['kind']; lowValue?: boolean },
  what: 'part' | 'unit',
): void {
  if (killer.side === victim.side) return;
  if (victim.kind === 'projectile' || victim.lowValue) return;
  const k = st.kills[killer.side];
  const down = (n: number) => Math.max(0, n - 1);
  // The Weapons Test credit too: a tapped kill now names its killer (audit
  // Phase 6, D8), so taking it back takes back the Test Unit's count.
  const test = st.secTarget[killer.side] === killer.uid;
  if (what === 'part' && victim.kind === 'mech') {
    k.partsAndDrones = down(k.partsAndDrones);
    if (test) st.testKills[killer.side] = down(st.testKills[killer.side]);
  }
  if (what === 'unit') {
    if (victim.kind === 'mech') k.mechs = down(k.mechs);
    if (victim.kind === 'drone') {
      k.drones = down(k.drones);
      k.partsAndDrones = down(k.partsAndDrones);
      if (test) st.testKills[killer.side] = down(st.testKills[killer.side]);
    }
  }
}

// A Part back on the board takes its line out of the loss ledger.
export function unrecordPartLoss(st: TaskState, t: Token, slot: string): void {
  st.partsLost = st.partsLost.filter((p) => !(p.uid === t.uid && p.slot === slot));
}

// One Part leaving the board, entering the loss ledger. Written where
// lastDamagedBy is written, for the same reason: the board stops being able to
// answer the question the moment the unit is removed. Idempotent on
// (uid, slot), because a second Penetration into an already-destroyed Part
// re-runs the same line.
export function recordPartLoss(st: TaskState, t: Token, slot: string): void {
  const cardId = (t.mech as Record<string, string | undefined> | undefined)?.[slot];
  if (!cardId) return;
  if (st.partsLost.some((p) => p.uid === t.uid && p.slot === slot)) return;
  st.partsLost.push({ side: t.side, uid: t.uid, slot, cardId });
}

// A whole Unit leaving takes every Part still on it. A Torso kill never touches
// the backpack slot, so without this the rider Part reads 'intact' on a Mech
// that is no longer on the table.
export function recordUnitLoss(st: TaskState, t: Token): void {
  if (t.kind !== 'mech' || !t.mech) return;
  for (const slot of partSlotsOf(t)) recordPartLoss(st, t, slot);
}

// ---------- end of game (5.2.4) ----------

export interface GameResult {
  winner: Side | null;
  why: string;
}

// Most Victory Points wins. On a tie it is the side with more Mech Parts and
// Drones left on the board, and only a tie in both is a genuine draw.
// A squad with no Mech left standing. The game cannot go on without one to
// activate, so this ends the match THERE rather than walking every remaining
// phase out and starting another round, which is what OTTO watched it do after
// he destroyed the last Mech on the field.
//
// `deployed !== false` matters: before deployment nobody is on the board, and a
// squad that has not placed a Mech yet has not lost one. Aliveness is the same
// test the activation order uses (loop.ts `alive`), written out here so tasks.ts
// does not have to reach into the loop for it -- a Mech with every Part
// destroyed is the one that can no longer be activated.
export function wipedOut(tokens: Token[]): Side | null {
  for (const side of ['s1', 's2'] as Side[]) {
    const mechs = tokens.filter((t) => t.side === side && t.kind === 'mech' && t.deployed !== false);
    if (!mechs.length) continue;
    if (mechs.every((m) => Object.values(m.partStates).every((p) => p === 'destroyed'))) return side;
  }
  return null;
}

export function gameResult(st: TaskState, tokens: Token[], lowValue?: (t: Token) => boolean): GameResult {
  // A concession is the one early end, and it decides the game (ruling I1).
  if (st.conceded) {
    const winner: Side = st.conceded === 's1' ? 's2' : 's1';
    return { winner, why: 'the other squad conceded' };
  }
  // FAQ P21: "Does eliminating all of your opponent's units immediately win
  // the game? No." The game runs its rounds and the Victory Points decide; a
  // squad with units left plays on alone to score. The wipe-out used to be
  // judged first, so a side losing on points won (audit Phase 6, B8).
  if (st.vp.s1 !== st.vp.s2) {
    const winner: Side = st.vp.s1 > st.vp.s2 ? 's1' : 's2';
    return { winner, why: `${st.vp.s1} Victory Points to ${st.vp.s2}` };
  }
  // The tiebreak counts what REMAINS on the board (5.2.4): a dead unit the pad
  // keeps in its tokens counts nothing (audit Phase 6, D4), and nor does a
  // Low Value Drone, which p.82 leaves out of the Squad (ruling I18).
  const remaining = (side: Side): number =>
    tokens
      .filter((t) => t.side === side && t.deployed !== false && standing(t) && !isLowValue(t, lowValue))
      .reduce((n, t) => {
        if (t.kind === 'mech') return n + Object.values(t.partStates).filter((p) => p !== 'destroyed').length;
        return t.kind === 'drone' ? n + 1 : n;
      }, 0);
  const blue = remaining('s1');
  const red = remaining('s2');
  if (blue === red) return { winner: null, why: `level on ${st.vp.s1} Victory Points and on ${blue} Mech Parts and Drones left` };
  const winner: Side = blue > red ? 's1' : 's2';
  return {
    winner,
    why: `level on ${st.vp.s1} Victory Points, so it goes to Mech Parts and Drones left on the board, ${blue} to ${red}`,
  };
}
