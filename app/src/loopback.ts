// A TABLE WITH NO SERVER. The Match Centre plays a game between two seats
// through a relay (net.ts): what this page performs is published, what the
// other seat performs arrives through `onCommand`, and the dice come from the
// room. A game against the computer keeps every one of those roads and takes
// the server out of the middle: this object has the surface the page uses of a
// Relay, the other seat is in the same tab, and the dice are the table's own
// seeded stream (AI-OPPONENT-PLAN.md, section 2 and decision D4).
//
// So nothing in match.ts learns that its opponent is a computer. It is seated
// at a room, it sends, it is told.
import type { Command } from './commands';
import type { NetHooks, NetRoom, NetView, RolledDie, RollKind, TableRelay } from './net';
import type { Side } from './types';

// The table's dice: a stream of whole numbers below `n`.
export interface DiceSource {
  int(n: number): number;
}

const OFFLINE: NetView = { status: 'offline', room: null, seat: null, host: false, error: null, desynced: false };

export class LoopbackRelay implements TableRelay {
  private view: NetView = OFFLINE;
  private rev = 0;
  private branch = 0;
  // What this page has performed and the other seat has not been told of yet.
  private outbox: Command[] = [];
  private flushing = false;
  private heard: ((cmd: Command) => void) | null = null;
  // The faces of each die, by colour, and where the numbers come from. Set
  // when the table opens: the page has no card data until then.
  private sides: (color: string) => number = () => 6;
  private dice: DiceSource | null = null;
  // What the page that hosts the table adds to its report: there is no line to
  // describe, so the report says what game this is instead.
  about: (() => Record<string, unknown>) | null = null;
  // Told of every command that crosses the table, either seat's, in the order
  // they land (the game's log, botlog.ts).
  tap: ((cmd: Command, seat: Side) => void) | null = null;

  constructor(private readonly hooks: NetHooks) {}

  get state(): NetView {
    return this.view;
  }

  // There is no line to lose.
  get connected(): boolean {
    return !!this.view.room;
  }

  get catchingUp(): boolean {
    return false;
  }

  private set(patch: Partial<NetView>): void {
    this.view = { ...this.view, ...patch };
    this.hooks.onChange(this.view);
  }

  // Seats this page at a table of its own: `seat` is the page's, the other is
  // the computer's, and `names` is what each is called on screen. The page is
  // the host, as the player who made a room is.
  open(o: { id: string; seat: Side; names: Record<Side, string>; dice: DiceSource; sides: (color: string) => number }): void {
    this.dice = o.dice;
    this.sides = o.sides;
    this.rev = 0;
    this.outbox = [];
    const room: NetRoom = { id: o.id, epoch: 0, revision: 0, seats: { s1: o.names.s1, s2: o.names.s2 }, online: { s1: true, s2: true }, hasCheckpoint: true };
    this.set({ status: 'playing', room, seat: o.seat, host: true, error: null, desynced: false });
  }

  // The page changes chairs: a player taking the computer's seat for a moment,
  // and handing it back.
  sit(seat: Side): void {
    if (this.view.room && this.view.seat !== seat) this.set({ seat });
  }

  // The other seat hears of every command this page performs, in order, once
  // the page has finished with it.
  onPublished(fn: ((cmd: Command) => void) | null): void {
    this.heard = fn;
  }

  host(): void { /* the table is opened by the page that plays at it */ }
  join(): void { /* and there is no other to join */ }

  leave(): void {
    this.outbox = [];
    this.heard = null;
    this.set({ ...OFFLINE });
  }

  closeRoom(): void {
    this.leave();
  }

  // Called by the page for every command it performs. The call comes from
  // INSIDE perform(), before the page has run the turn bookkeeping that
  // follows a command, so the other seat is told afterwards, in a task of its
  // own, when the table is at rest: a server's echo arrives no sooner.
  publish(cmd: Command): void {
    if (!this.view.room || !this.view.seat) return;
    this.rev += 1;
    this.tap?.(cmd, this.view.seat);
    this.outbox.push(cmd);
    if (this.flushing) return;
    this.flushing = true;
    queueMicrotask(() => {
      this.flushing = false;
      const batch = this.outbox;
      this.outbox = [];
      // One listener's failure over a command must not lose the ones behind it.
      for (const c of batch) {
        try { this.heard?.(c); } catch (err) { console.error(err); }
      }
    });
  }

  // A command of the OTHER seat, arriving as a second player's does.
  deliver(cmd: Command, seat: Side): void {
    if (!this.view.room) return;
    this.rev += 1;
    this.tap?.(cmd, seat);
    this.hooks.onCommand(cmd, seat);
  }

  // The page's own roll.
  rollDice(pool: Record<string, number>, label?: string, kind: RollKind = 'pool'): Promise<RolledDie[]> {
    const seat = this.view.seat;
    if (!this.view.room || !seat) return Promise.reject(new Error('Not in a game.'));
    return this.roll(seat, pool, label ?? null, kind);
  }

  // Dice for either seat, from the one stream, and shown to the page as a
  // room's are: every roll lands in `onRolled`, the roller's own included. A
  // `quiet` roll is one a room never announces (the Part Die is the attacking
  // page's own).
  roll(seat: Side, pool: Record<string, number>, label: string | null, kind: RollKind = 'pool', quiet = false): Promise<RolledDie[]> {
    const source = this.dice;
    if (!source) return Promise.reject(new Error('The table has no dice.'));
    const dice: RolledDie[] = [];
    for (const [color, n] of Object.entries(pool)) {
      for (let i = 0; i < (n ?? 0); i++) dice.push({ color, face: source.int(this.sides(color)) });
    }
    return new Promise((resolve) => {
      queueMicrotask(() => {
        resolve(dice);
        if (!quiet && this.view.room) this.hooks.onRolled(dice, seat, label, seat === this.view.seat, kind);
      });
    });
  }

  // Nothing to fall behind, and nowhere to file a board.
  requestResync(): void { /* one board, in one tab */ }
  publishCheckpoint(): void { /* one board, in one tab */ }

  setBranch(n: number): void {
    if (Number.isSafeInteger(n) && n > this.branch) this.branch = n;
  }

  health(): {
    latencyMs: number | null; lossPct: number; driftMs: number;
    backgrounded: boolean; silentMs: number; rev: number; branch: number; queued: number;
  } {
    return { latencyMs: null, lossPct: 0, driftMs: 0, backgrounded: false, silentMs: 0, rev: this.rev, branch: this.branch, queued: this.outbox.length };
  }

  diagnostics(): Record<string, unknown> {
    return {
      schema: 1,
      at: new Date().toISOString(),
      room: this.view.room?.id ?? null,
      solo: true,
      seat: this.view.seat,
      host: this.view.host,
      status: this.view.status,
      health: this.health(),
      ...(this.about?.() ?? {}),
    };
  }
}
