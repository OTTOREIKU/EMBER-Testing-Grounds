import type { GameData } from './data';
import { dataUrl } from './data';
import { parseGrid } from './scenarios';
import type { DieColor, GameState, PartSlot, PartState, Side, Stance, Token } from './types';
import { makeDroneToken } from './units';

// ---------- script shape ----------

export type ReplayOp =
  | { op: 'move'; unit: string; to: string }
  | { op: 'face'; unit: string; dir: 'N' | 'E' | 'S' | 'W' }
  | { op: 'stance'; unit: string; to: Stance }
  | { op: 'link'; unit: string; delta: number }
  | { op: 'part'; unit: string; slot: string; to: PartState }
  | { op: 'status'; unit: string; id: string; remove?: boolean }
  | { op: 'remove'; unit: string }
  | { op: 'spawn'; cardId: string; side: Side; at: string; label: string; parent?: string }
  | { op: 'cmd'; side: Side; n: number }
  | { op: 'first'; side: Side }
  | { op: 'vp'; side: Side; n: number; why: string };

export interface ReplayDice {
  note?: string;
  roll?: { color: DieColor; face: number }[];
  groups?: { label: string; roll: { color: DieColor; face: number }[] }[];
  reading?: string;
}

export interface ReplayStep {
  round: number;
  phase: number;
  title: string;
  say?: string[];
  focus?: string[];
  dice?: ReplayDice;
  do?: ReplayOp[];
}

export interface ReplayScript {
  id: string;
  scenarioId: string;
  title: string;
  intro?: string[];
  steps: ReplayStep[];
}

export async function loadReplays(): Promise<ReplayScript[]> {
  try {
    const r = await fetch(dataUrl('replays.json'));
    if (!r.ok) return [];
    const j = (await r.json()) as { replays?: ReplayScript[] };
    return j.replays ?? [];
  } catch {
    return [];
  }
}

// ---------- applying a script to board state ----------

const FACING: Record<string, 0 | 1 | 2 | 3> = { N: 0, E: 1, S: 2, W: 3 };

export interface ReplayTally {
  vp: Record<Side, number>;
  scored: { side: Side; n: number; why: string }[];
}

export function emptyTally(): ReplayTally {
  return { vp: { blue: 0, red: 0 }, scored: [] };
}

function findUnit(tokens: Token[], name: string): Token | undefined {
  const raw = name.trim();
  const colon = raw.indexOf(':');
  const side = colon > 0 ? (raw.slice(0, colon).trim().toLowerCase() as Side) : null;
  const want = (colon > 0 ? raw.slice(colon + 1) : raw).trim().toLowerCase();
  const pool = side ? tokens.filter((t) => t.side === side) : tokens;
  return pool.find((t) => t.label.trim().toLowerCase() === want) ?? pool.find((t) => t.label.toLowerCase().includes(want));
}

export function applyOp(state: GameState, tally: ReplayTally, op: ReplayOp, data?: GameData): string | null {
  if (op.op === 'cmd') {
    state.commandTokens[op.side] = Math.max(0, op.n);
    return null;
  }
  if (op.op === 'first') {
    state.round.firstPlayer = op.side;
    return null;
  }
  if (op.op === 'vp') {
    tally.vp[op.side] += op.n;
    tally.scored.push({ side: op.side, n: op.n, why: op.why });
    return null;
  }
  if (op.op === 'spawn') {
    if (!data) return 'replay: spawn needs card data';
    const card = data.byId.get(op.cardId);
    const g = parseGrid(op.at);
    if (!card || !g) return `replay: cannot spawn ${op.cardId} at ${op.at}`;
    const parent = op.parent ? findUnit(state.tokens, op.parent) : undefined;
    const tok = makeDroneToken(state, data, card, op.side);
    const off = tok.size === 3 ? 0 : tok.size === 2 ? 0 : 1;
    state.tokens.push({
      ...tok,
      label: op.label,
      parentUid: parent?.uid,
      col: g.c * 3 + off,
      row: g.r * 3 + off,
      facing: op.side === 'blue' ? 3 : 1,
    });
    return null;
  }
  const t = findUnit(state.tokens, op.unit);
  if (!t) return `replay: no unit named "${op.unit}"`;
  switch (op.op) {
    case 'move': {
      const g = parseGrid(op.to);
      if (!g) return `replay: bad grid "${op.to}"`;
      const off = t.size === 3 ? 0 : t.size === 2 ? 0 : 1;
      t.col = g.c * 3 + off;
      t.row = g.r * 3 + off;
      return null;
    }
    case 'face':
      t.facing = FACING[op.dir] ?? t.facing;
      return null;
    case 'stance':
      t.stance = op.to;
      return null;
    case 'link':
      t.link = Math.max(0, (t.link ?? 0) + op.delta);
      if (t.link === 0) t.stance = 'shutdown';
      return null;
    case 'part':
      t.partStates[op.slot as PartSlot | 'main'] = op.to;
      return null;
    case 'status': {
      const list = [...(t.statuses ?? [])];
      if (op.remove) {
        const at = list.lastIndexOf(op.id);
        if (at >= 0) list.splice(at, 1);
      } else {
        list.push(op.id);
      }
      t.statuses = list;
      return null;
    }
    case 'remove':
      state.tokens = state.tokens.filter((x) => x.uid !== t.uid);
      return null;
    default:
      return null;
  }
}

// ---------- player ----------

export interface ReplayHooks {
  onStep(step: ReplayStep, index: number, total: number, tally: ReplayTally): void;
  onState(): void;
  onFinish(): void;
}

export class ReplayPlayer {
  readonly script: ReplayScript;
  private state: GameState;
  private baseline: string;
  private hooks: ReplayHooks;
  private idx = -1;
  private timer: number | undefined;
  private speed = 3200;
  tally: ReplayTally = emptyTally();
  warnings: string[] = [];

  private data: GameData;

  constructor(script: ReplayScript, state: GameState, data: GameData, hooks: ReplayHooks) {
    this.script = script;
    this.state = state;
    this.data = data;
    this.hooks = hooks;
    this.baseline = JSON.stringify({
      tokens: state.tokens,
      round: state.round,
      commandTokens: state.commandTokens,
      nextUid: state.nextUid,
    });
  }

  get index(): number {
    return this.idx;
  }

  get total(): number {
    return this.script.steps.length;
  }

  get playing(): boolean {
    return this.timer !== undefined;
  }

  get stepSpeed(): number {
    return this.speed;
  }

  setSpeed(ms: number): void {
    this.speed = ms;
    if (this.playing) {
      this.pause();
      this.play();
    }
  }

  goto(target: number): void {
    const clamped = Math.max(-1, Math.min(target, this.total - 1));
    const base = JSON.parse(this.baseline) as {
      tokens: Token[];
      round: GameState['round'];
      commandTokens: GameState['commandTokens'];
      nextUid: number;
    };
    this.state.tokens = JSON.parse(JSON.stringify(base.tokens)) as Token[];
    this.state.round = { ...base.round };
    this.state.commandTokens = { ...base.commandTokens };
    this.state.nextUid = base.nextUid;
    this.tally = emptyTally();
    this.warnings = [];
    for (let i = 0; i <= clamped; i++) {
      const s = this.script.steps[i];
      this.state.round.n = s.round;
      this.state.round.phase = s.phase;
      for (const op of s.do ?? []) {
        const err = applyOp(this.state, this.tally, op, this.data);
        if (err) this.warnings.push(err);
      }
    }
    this.idx = clamped;
    this.hooks.onState();
    if (clamped >= 0) this.hooks.onStep(this.script.steps[clamped], clamped, this.total, this.tally);
  }

  next(): void {
    if (this.idx >= this.total - 1) {
      this.pause();
      this.hooks.onFinish();
      return;
    }
    this.goto(this.idx + 1);
  }

  prev(): void {
    this.pause();
    this.goto(this.idx - 1);
  }

  play(): void {
    if (this.playing) return;
    if (this.idx >= this.total - 1) this.goto(-1);
    this.next();
    this.timer = window.setInterval(() => {
      if (this.idx >= this.total - 1) {
        this.pause();
        this.hooks.onFinish();
        return;
      }
      this.next();
    }, this.speed);
  }

  pause(): void {
    if (this.timer !== undefined) clearInterval(this.timer);
    this.timer = undefined;
  }

  stop(): void {
    this.pause();
  }
}
