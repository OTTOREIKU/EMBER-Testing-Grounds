// Undo, as a ring of whole-state snapshots.
//
// Not inverse commands. Several of ours cannot be inverted honestly — a roll
// has already been seen, a Task ledger has already paid out, a Command Token
// that was flipped face-down is indistinguishable from one that was issued —
// so a snapshot is the only version that is actually correct rather than
// usually correct. The cost is memory, and a board is small.
//
// JSON rather than structuredClone deliberately: save() already round-trips the
// whole state through JSON into localStorage every time anything changes, so a
// JSON round-trip is proven adequate for this shape. Anything structuredClone
// would preserve and JSON would not is already being lost on every save.
import type { GameState } from './types';

// Deep enough to undo a misclick and the two things after it, shallow enough
// that a long game does not sit on tens of megabytes of dead boards.
const LIMIT = 40;

export interface Snapshot {
  // What the board looked like BEFORE the command ran.
  json: string;
  // The command that was about to run, for naming the step in the UI.
  label: string;
  // Round and phase at the time, so a rollback list can be read by a human
  // rather than by index.
  round: number;
  phase: number;
}

let stack: Snapshot[] = [];

export function recordSnapshot(state: GameState, label: string): void {
  stack.push({
    json: JSON.stringify(state),
    label,
    round: state.round?.n ?? 0,
    phase: state.round?.phase ?? 0,
  });
  if (stack.length > LIMIT) stack.shift();
}

// Restores INTO the existing object rather than returning a new one. Every
// page holds `state` in a module-level const and hands the same reference to
// the board, the guide and the trackers; swapping the reference would leave
// all of them pointing at the old board. Same trap the script normaliser hit.
function restoreInto(target: GameState, src: Record<string, unknown>): void {
  const t = target as unknown as Record<string, unknown>;
  for (const k of Object.keys(t)) if (!(k in src)) delete t[k];
  Object.assign(t, src);
}

// Steps back one command. Returns what was undone, or null when there is
// nothing left — the caller decides whether that is worth saying out loud.
export function undoLast(state: GameState): Snapshot | null {
  const snap = stack.pop();
  if (!snap) return null;
  restoreInto(state, JSON.parse(snap.json) as Record<string, unknown>);
  return snap;
}

// Rolls back to a numbered point, dropping everything after it. The index is
// into the list `historyList()` returns, which is what a rollback request
// between two players names.
export function undoTo(state: GameState, index: number): Snapshot | null {
  if (index < 0 || index >= stack.length) return null;
  const snap = stack[index];
  stack = stack.slice(0, index);
  restoreInto(state, JSON.parse(snap.json) as Record<string, unknown>);
  return snap;
}

export function historyList(): { label: string; round: number; phase: number }[] {
  return stack.map(({ label, round, phase }) => ({ label, round, phase }));
}

export function historyDepth(): number {
  return stack.length;
}

// A new game, a loaded board or a resync makes every earlier snapshot a board
// from a different game. Undoing into one of those would be worse than having
// no undo at all.
export function clearHistory(): void {
  stack = [];
}
