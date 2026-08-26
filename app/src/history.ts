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

// Deep enough that the Undo v2 catalog can list a whole round of per-action
// targets, shallow enough that a long game does not sit on tens of megabytes
// of dead boards. MEASURED before raising (U1, 2026-08-24): a two-unit
// mid-game state serialises to ~2KB, so even a crowded board's snapshot is
// tens of KB and 160 of them stay in single-digit megabytes - inside the
// budget the old comment set for 40.
const LIMIT = 160;

export interface Snapshot {
  // What the board looked like BEFORE the command ran.
  json: string;
  // The command that was about to run, for naming the step in the UI.
  label: string;
  // Round and phase at the time, so a rollback list can be read by a human
  // rather than by index.
  round: number;
  phase: number;
  // Whether the game proper had begun. Setup commands are stamped with round 1,
  // phase 0 — the track has nowhere else to sit while edges are picked and
  // units placed — so without this the catalog cannot tell the board at the
  // START of Round 1's Command Phase from a board with half a squad deployed.
  // It bit through the seal: a rejoining client replays the First Player roll
  // into its ring at "1:0", and that sealed Round 1's Command boundary as
  // "dice rolled since" when the dice came before the phase ever began.
  inPlay: boolean;
  // U1 (Undo v2): the human reading of the same command, written by
  // ledger.labelFor at record time because only the moment BEFORE apply()
  // still has the board the words refer to ("Maneuver to F4" needs the unit's
  // old grid gone by the time anyone reads the timeline). `label` above stays
  // the raw command KIND - rollbackCatalog's sealed floor matches on it - so
  // the words ride beside it rather than replacing it.
  human?: string;
  // Whose command it was, for a timeline that can say which player acted.
  seat?: string;
  // A monotonically increasing stamp, unique for the life of this history (U3).
  // The catalog names UNIT targets by seq because a RING INDEX goes stale the
  // moment the ring shifts at its limit - an index published in the catalog
  // would point one entry late after every eviction. A seq is stable, opaque
  // to the guest (who only echoes it back), and dereferenced only by the host.
  seq: number;
  // How the command sits in a player-sized unit (ledger.LedgerRole). Stored so
  // the catalog can group old entries without re-deriving context the command
  // alone no longer carries (a free maneuver's flag is gone by then).
  role?: string;
}

let stack: Snapshot[] = [];
let nextSeq = 1;

export function recordSnapshot(state: GameState, label: string, meta?: { human?: string; seat?: string; role?: string }): void {
  // The stage is read raw rather than through normaliseSetup, because this
  // file must import nothing but types: the tests import it directly and run
  // it as written, which is the property that makes them worth having.
  const stage = (state.setup as { stage?: unknown } | null | undefined)?.stage;
  stack.push({
    json: JSON.stringify(state),
    label,
    round: state.round?.n ?? 0,
    phase: state.round?.phase ?? 0,
    human: meta?.human,
    seat: meta?.seat,
    role: meta?.role,
    seq: nextSeq++,
    // A board with no setup underway at all — freeplay, the tests — counts as
    // in play; only a setup still in progress is excluded.
    inPlay: stage === undefined || stage === 'done',
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

export function historyList(): { label: string; round: number; phase: number; human?: string }[] {
  return stack.map(({ label, round, phase, human }) => ({ label, round, phase, human }));
}

// Commands that record what a die already showed. A networked rollback must not
// reach past one of these: the faces came from the server, both players watched
// them land, and rewinding to roll again is fishing rather than undoing. The
// dice themselves are not board state — they arrive through the relay's onRolled
// hook, not as a command — so this is about the results being ACTED ON, which is
// exactly what these commands do.
//
// Freeplay does not consult this at all. One player, nobody to cheat.
const SEALED = new Set(['acceptRoll', 'rollSetup', 'noteRoll', 'applyPenetration', 'recordKill', 'resolveIntercept']);

// The round/phase boundaries a rollback could name: the FIRST snapshot at each
// round/phase, which is the board as that phase began. Newest last, matching
// the order they happened.
//
// Every boundary in the ring is listed, including the ones a die roll has put
// out of reach — those are MARKED rather than dropped, so the offer can show
// them greyed. A list that silently shortens after a roll reads as a broken
// feature, and the rule behind it is worth stating where it bites.
export function rollbackCatalog(): { round: number; phase: number; index: number; available: boolean }[] {
  // Walk back from now to the most recent sealed command; only what lies after
  // it is reachable.
  let floor = 0;
  for (let i = stack.length - 1; i >= 0; i--) {
    if (SEALED.has(stack[i].label)) { floor = i + 1; break; }
  }
  const out: { round: number; phase: number; index: number; available: boolean }[] = [];
  for (let i = 0; i < stack.length; i++) {
    // Setup is not a place a rollback can return to: deployment and edges have
    // their own confirm flow, and a setup snapshot shares "round 1, phase 0"
    // with the real Command Phase, which is the boundary it would corrupt.
    if (!stack[i].inPlay) continue;
    const { round, phase } = stack[i];
    const last = out[out.length - 1];
    if (!last || last.round !== round || last.phase !== phase) {
      out.push({ round, phase, index: i, available: i >= floor });
    }
  }
  return out;
}

// Rolls back to the start of a named round/phase. Named rather than indexed
// because the two clients' rings are NOT the same length — setTiming is secret
// and never travels, so a player who set three dials has three snapshots the
// opponent does not, and the same index would be a different board on each side.
// Both agree on when a phase began without being told.
export function undoToPhase(state: GameState, round: number, phase: number): Snapshot | null {
  const at = stack.findIndex((s) => s.round === round && s.phase === phase);
  if (at < 0) return null;
  return undoTo(state, at);
}

export function historyDepth(): number {
  return stack.length;
}

// The raw entries in ring order, for the page to fold into player-sized units
// (ledger.groupLedger). This file cannot do the folding itself: ledger.ts is a
// VALUE import, and this file may import nothing but types so the tests can
// run it as written under node's type stripping - an extensionless value
// import would not resolve there.
export function historyEntries(): { kind: string; human?: string; seat?: string; role?: string; round: number; phase: number; inPlay: boolean; seq: number }[] {
  return stack.map(({ label, human, seat, role, round, phase, inPlay, seq }) => ({ kind: label, human, seat, role, round, phase, inPlay, seq }));
}

// Rolls back to the snapshot with the given seq - the UNIT targets the v2
// catalog names. Null when the ring has already evicted it, which the caller
// reports rather than swallows: the host saying "too far back" beats two
// boards quietly disagreeing.
export function undoToSeq(state: GameState, seq: number): Snapshot | null {
  const at = stack.findIndex((s) => s.seq === seq);
  if (at < 0) return null;
  return undoTo(state, at);
}

// A new game, a loaded board or a resync makes every earlier snapshot a board
// from a different game. Undoing into one of those would be worse than having
// no undo at all.
export function clearHistory(): void {
  stack = [];
}
