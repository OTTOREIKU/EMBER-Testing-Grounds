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
  control?: Side | null;
  accessed?: Side | null;
}

export interface Kills {
  mechs: number;
  drones: number;
  partsAndDrones: number;
}

export interface TaskState {
  main?: string;
  secondary: { s1?: string; s2?: string };
  items: TaskItem[];
  vp: { s1: number; s2: number };
  leader: { s1?: number; s2?: number };
  secTarget: { s1?: number; s2?: number };
  zone: { s1?: string; s2?: string };
  kills: { s1: Kills; s2: Kills };
  testKills: { s1: number; s2: number };
  paidKills: { s1: Kills; s2: Kills };
  paidTestKills: { s1: number; s2: number };
  scored: string[];
}

export function newKills(): Kills {
  return { mechs: 0, drones: 0, partsAndDrones: 0 };
}

export function newTaskState(): TaskState {
  return {
    secondary: {}, items: [], vp: { s1: 0, s2: 0 }, leader: {}, secTarget: {}, zone: {},
    kills: { s1: newKills(), s2: newKills() }, testKills: { s1: 0, s2: 0 },
    paidKills: { s1: newKills(), s2: newKills() }, paidTestKills: { s1: 0, s2: 0 }, scored: [],
  };
}

// ---------- Main Task setup (5.1) ----------

export interface MissionLike { family: string; zones?: string[] }
export interface ZoneLike { id: string; name: string; cells: string[] }

// A ref ("C7") on the 12x12 zone overlay. A private copy of the parser in
// data.ts, because this module is compiled standalone by the test slices.
function zoneRef(ref: string): { col: number; row: number } | null {
  const m = /^([A-La-l])(\d{1,2})$/.exec(ref.trim());
  if (!m) return null;
  const col = m[1].toUpperCase().charCodeAt(0) - 65;
  const row = Number(m[2]) - 1;
  if (col < 0 || col > 11 || row < 0 || row > 11) return null;
  return { col, row };
}

// The Task Items a Main Task puts on the board, derived from its zones. Rides
// inside configureTable pre-computed, so both seats hold the identical set.
export function taskItemsFor(zones: ZoneLike[], m: MissionLike): TaskState {
  const st = newTaskState();
  const kind = m.family === 'blackbox' ? 'blackbox' : m.family === 'terminal' ? 'terminal' : m.family === 'control' ? 'control' : null;
  if (!kind) return st;
  for (const name of m.zones ?? []) {
    const zone = zones.find((z) => z.name.toLowerCase() === name.toLowerCase());
    if (!zone) continue;
    const item: TaskItem = { id: `${kind}-${zone.id}`, kind, zone: zone.id, control: null, accessed: null };
    if (kind === 'blackbox') {
      const first = zone.cells[0] && zoneRef(zone.cells[0]);
      if (first) {
        item.col = first.col * 3 + 1;
        item.row = first.row * 3 + 1;
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
    secTarget: {
      s1: typeof t.secTarget?.s1 === 'number' ? t.secTarget.s1 : undefined,
      s2: typeof t.secTarget?.s2 === 'number' ? t.secTarget.s2 : undefined,
    },
    kills: { s1: kills(t.kills?.s1), s2: kills(t.kills?.s2) },
    testKills: { s1: num(t.testKills?.s1), s2: num(t.testKills?.s2) },
    paidKills: { s1: kills(t.paidKills?.s1), s2: kills(t.paidKills?.s2) },
    paidTestKills: { s1: num(t.paidTestKills?.s1), s2: num(t.paidTestKills?.s2) },
    scored: Array.isArray(t.scored) ? t.scored.filter((x): x is string => typeof x === 'string') : [],
  };

  function kills(raw: unknown): Kills {
    const k = (raw ?? {}) as Partial<Kills>;
    return { mechs: num(k.mechs), drones: num(k.drones), partsAndDrones: num(k.partsAndDrones) };
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

export function scoreMain(
  m: MissionScoring,
  st: TaskState,
  tokens: Token[],
  round: number,
  finalRound: boolean,
): ScoreResult {
  const lines: ScoreLine[] = [];
  const byUid = new Map(tokens.map((t) => [t.uid, t]));
  if (round < m.fromRound) return { lines: [], s1: 0, s2: 0 };
  if (m.cadence === 'at-end' && !finalRound) return { lines: [], s1: 0, s2: 0 };

  if (m.family === 'blackbox') {
    for (const side of ['s1', 's2'] as Side[]) {
      const held = st.items.filter((i) => {
        if (i.kind !== 'blackbox' || i.bearerUid === undefined) return false;
        const bearer = byUid.get(i.bearerUid);
        return !!bearer && bearer.side === side;
      });
      if (held.length) {
        lines.push({ side, vp: held.length * m.vp, why: `${held.length} Black Box${held.length === 1 ? '' : 'es'} in possession at ${m.vp} VP each` });
      }
    }
  }

  if (m.family === 'control') {
    for (const side of ['s1', 's2'] as Side[]) {
      const held = st.items.filter((i) => i.kind === 'control' && i.control === side);
      if (held.length) {
        lines.push({ side, vp: held.length * m.vp, why: `${held.length} controlled Zone${held.length === 1 ? '' : 's'} at ${m.vp} VP each` });
      }
    }
  }

  if (m.family === 'terminal') {
    for (const side of ['s1', 's2'] as Side[]) {
      const got = st.items.filter((i) => i.kind === 'terminal' && i.accessed === side);
      if (got.length) {
        lines.push({ side, vp: got.length * m.vp, why: `${got.length} Terminal${got.length === 1 ? '' : 's'} accessed at ${m.vp} VP each` });
      }
    }
  }

  if (m.family === 'vip') {
    for (const side of ['s1', 's2'] as Side[]) {
      const enemy: Side = side === 's1' ? 's2' : 's1';
      const uid = st.leader[enemy];
      if (uid === undefined) continue;
      if (!byUid.has(uid)) {
        // A bounty pays once, and the card ends the game on the spot.
        lines.push({ side, vp: m.vp, why: `the enemy Commander is destroyed, which ends the game immediately`, key: `vip:${side}` });
      }
    }
  }

  return tally(lines);
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
  const alive = (uid?: number) => uid !== undefined && tokens.some((t) => t.uid === uid);
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
    // Mercy pays only if this side has destroyed no enemy Mech at all.
    if (st.kills[side].mechs === 0) push(card.vp, `${card.name}: no enemy Mech was destroyed`, `sec:${side}:${card.id}`);
  }

  if (card.kind === 'hold-zone' && finalRound) {
    const zone = st.zone[side];
    if (zone) {
      const cells = zoneCells(zone);
      const inside = tokens.filter((t) => t.deployed !== false && !isLowValue(t, lowValue) && inZone(t, cells));
      if (inside.length && inside.every((t) => t.side === side)) {
        push(card.vp, `${card.name}: only your units are in the Excavation Site`, `sec:${side}:${card.id}`);
      }
    }
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
    if (victim.kind === 'mech') k.mechs += 1;
    if (victim.kind === 'drone') {
      k.drones += 1;
      k.partsAndDrones += 1;
      if (test) st.testKills[killer.side] += 1;
    }
  }
}

// ---------- end of game (5.2.4) ----------

export interface GameResult {
  winner: Side | null;
  why: string;
}

// Most Victory Points wins. On a tie it is the side with more Mech Parts and
// Drones left on the board, and only a tie in both is a genuine draw.
export function gameResult(st: TaskState, tokens: Token[]): GameResult {
  if (st.vp.s1 !== st.vp.s2) {
    const winner: Side = st.vp.s1 > st.vp.s2 ? 's1' : 's2';
    return { winner, why: `${st.vp.s1} Victory Points to ${st.vp.s2}` };
  }
  const remaining = (side: Side): number =>
    tokens
      .filter((t) => t.side === side && t.deployed !== false)
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
