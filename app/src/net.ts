import type { Command } from './commands';
import type { Side } from './types';

// The client half of the relay. It owns the socket and the ordering, and knows
// nothing about the rules — commands arrive, get handed to the app, and the
// app's own apply() decides what they mean. That is what keeps both players
// running identical logic rather than one trusting the other.

export type NetStatus = 'offline' | 'connecting' | 'lobby' | 'playing';

export interface NetRoom {
  id: string;
  epoch: number;
  revision: number;
  seats: Record<Side, string | null>;
  // Whether the player holding each seat is connected right now. A seat can be
  // occupied by an account that has momentarily dropped, which is worth
  // showing rather than leaving the board looking mysteriously quiet.
  online: Record<Side, boolean>;
  hasCheckpoint: boolean;
}

export interface NetView {
  status: NetStatus;
  room: NetRoom | null;
  seat: Side | null;
  host: boolean;
  error: string | null;
  // Set when the two clients have diverged and the app should ask for a fresh
  // checkpoint rather than carry on applying to a state that no longer matches.
  desynced: boolean;
}

export interface RolledDie {
  color: string;
  face: number;
}

export interface NetHooks {
  // Dice that landed in this room, whoever asked for them. Both players are
  // told, so the roll is something they watch together rather than a number
  // one of them reports to the other.
  onRolled(dice: RolledDie[], seat: Side, label: string | null, mine: boolean): void;
  // A command from the other player, already ordered by the server.
  onCommand(cmd: Command, seat: Side): void;
  // The full board, either because we joined late or because we drifted.
  onCheckpoint(state: unknown): void;
  // The server dropped its history and wants the board republished.
  onNeedCheckpoint(): void;
  // Anything the UI should redraw on.
  onChange(view: NetView): void;
  // Our own board, for publishing.
  snapshot(): unknown;
}

function relayUrl(apiBase: string): string {
  return `${apiBase.replace(/^http/, 'ws')}/relay`;
}

export class Relay {
  private url: string;
  private hooks: NetHooks;
  private ws: WebSocket | null = null;
  private seq = 0;
  // Highest revision applied. A gap means something was missed, which is a
  // desync rather than something to paper over.
  private lastRev = 0;
  private view: NetView = { status: 'offline', room: null, seat: null, host: false, error: null, desynced: false };
  // Commands made while the socket was down, replayed on reconnect. The
  // server suppresses duplicates by sequence number, so resending something it
  // already saw is harmless.
  private pending: { seq: number; cmd: Command }[] = [];
  private retry = 0;
  private retryTimer: number | undefined;
  private wanted: { kind: 'create' } | { kind: 'join'; room: string } | null = null;
  // Rolls this client asked for and is still waiting on, by request id.
  private rolls = new Map<string, { resolve: (d: RolledDie[]) => void; reject: (e: Error) => void; timer: number }>();

  constructor(apiBase: string, hooks: NetHooks) {
    this.url = relayUrl(apiBase);
    this.hooks = hooks;
  }

  get state(): NetView {
    return this.view;
  }

  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  private set(patch: Partial<NetView>): void {
    this.view = { ...this.view, ...patch };
    this.hooks.onChange(this.view);
  }

  private send(msg: unknown): void {
    if (this.connected) this.ws!.send(JSON.stringify(msg));
  }

  host(): void {
    this.wanted = { kind: 'create' };
    this.open();
  }

  join(room: string): void {
    this.wanted = { kind: 'join', room: room.trim().toUpperCase() };
    this.open();
  }

  leave(): void {
    this.wanted = null;
    window.clearTimeout(this.retryTimer);
    this.retry = 0;
    this.pending = [];
    this.seq = 0;
    this.lastRev = 0;
    if (this.connected) this.send({ t: 'leave' });
    this.ws?.close();
    this.ws = null;
    this.set({ status: 'offline', room: null, seat: null, host: false, error: null, desynced: false });
  }

  // Called by the app for every command performed locally.
  publish(cmd: Command): void {
    if (!this.view.room || !this.view.seat) return;
    this.seq += 1;
    const entry = { seq: this.seq, cmd };
    this.pending.push(entry);
    this.send({ t: 'cmd', ...entry });
  }

  // Asks the server to roll. The faces come back from there rather than from
  // here, which is what stops a modified client choosing its own results —
  // and it means both players watch the same dice land.
  rollDice(pool: Record<string, number>, label?: string): Promise<RolledDie[]> {
    if (!this.view.room || !this.view.seat) return Promise.reject(new Error('Not in a game.'));
    const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    return new Promise<RolledDie[]>((resolve, reject) => {
      // A roll that never comes back must not leave the wizard waiting for
      // ever; the caller falls back to reporting the failure.
      const timer = window.setTimeout(() => {
        this.rolls.delete(id);
        reject(new Error('The server did not answer the roll.'));
      }, 10_000);
      this.rolls.set(id, { resolve, reject, timer });
      this.send({ t: 'roll', id, pool, label: label ?? null });
    });
  }

  // Asks the server for the board and everything since. Used when a revision
  // gap appears, and when a command is refused — a refusal can mean the two
  // boards have drifted rather than that anyone is cheating, and refetching
  // settles which it was.
  requestResync(): void {
    if (this.view.room) this.send({ t: 'resync' });
  }

  // Publishes the whole board. Cheap enough to do at the start of a game and
  // whenever the server asks, and far simpler than trying to replay from zero.
  publishCheckpoint(): void {
    if (!this.view.room || !this.view.seat) return;
    this.send({ t: 'checkpoint', state: this.hooks.snapshot() });
    this.set({ desynced: false });
  }

  private open(): void {
    if (this.ws) { this.ws.onclose = null; this.ws.close(); }
    this.set({ status: 'connecting', error: null });
    let ws: WebSocket;
    try {
      ws = new WebSocket(this.url);
    } catch {
      this.set({ status: 'offline', error: 'Could not open a connection.' });
      return;
    }
    this.ws = ws;

    ws.onopen = () => {
      this.retry = 0;
      if (this.wanted?.kind === 'create') this.send({ t: 'create' });
      else if (this.wanted?.kind === 'join') this.send({ t: 'join', room: this.wanted.room });
    };

    ws.onmessage = (ev) => this.receive(String(ev.data));

    ws.onclose = () => {
      this.ws = null;
      if (!this.wanted) {
        this.set({ status: 'offline', room: null, seat: null });
        return;
      }
      // Backs off to 15s so a server that is down does not get hammered, but
      // stays quick for the common case of a laptop lid closing.
      this.retry = Math.min(this.retry + 1, 6);
      const wait = Math.min(1000 * 2 ** (this.retry - 1), 15_000);
      this.set({ status: 'connecting', error: `Connection lost. Retrying in ${Math.round(wait / 1000)}s.` });
      this.retryTimer = window.setTimeout(() => this.open(), wait);
    };

    ws.onerror = () => { /* onclose always follows, and handles it */ };
  }

  private receive(raw: string): void {
    let msg: { t?: string; [k: string]: unknown };
    try {
      msg = JSON.parse(raw) as typeof msg;
    } catch {
      return;
    }

    switch (msg.t) {
      case 'welcome':
        return;

      case 'room': {
        const room = msg.room as NetRoom;
        const you = msg.you as { seat: Side | null; host: boolean };
        // A rejoin under a new room means our old sequence numbers mean
        // nothing to the server, so both counters restart together.
        this.seq = 0;
        this.lastRev = room.revision;
        this.pending = [];
        // Once we are in a room, reconnecting means rejoining *this* room.
        // Leaving it as "create" would mint a fresh room on the first dropped
        // connection and strand the other player in the old one.
        this.wanted = { kind: 'join', room: room.id };
        this.set({
          status: room.seats.s1 && room.seats.s2 ? 'playing' : 'lobby',
          room, seat: you.seat, host: you.host, error: null, desynced: false,
        });
        // The host seeds the room with the board it already has, so a guest
        // joining an in-progress game is not staring at an empty table.
        if (you.host && you.seat) this.publishCheckpoint();
        return;
      }

      case 'peer': {
        const room = msg.room as NetRoom;
        this.set({ room, status: room.seats.s1 && room.seats.s2 ? 'playing' : 'lobby' });
        return;
      }

      case 'checkpoint': {
        this.lastRev = Number(msg.rev ?? 0);
        this.pending = [];
        this.hooks.onCheckpoint(msg.state);
        // Whatever we had fallen behind by, this is current again.
        this.set({ desynced: false, error: null });
        return;
      }

      case 'cmd': {
        const rev = Number(msg.rev);
        const seat = msg.seat as Side;
        // Our own command coming back is the server acknowledging it. Anything
        // at or below that sequence number has landed and no longer needs
        // replaying, and it must not be applied a second time here.
        if (seat === this.view.seat) {
          const ack = Number(msg.seq);
          if (Number.isInteger(ack)) this.pending = this.pending.filter((p) => p.seq > ack);
          this.lastRev = rev;
          return;
        }
        if (rev !== this.lastRev + 1) {
          // A gap means we missed something. Applying anyway would leave the
          // two boards quietly different, so we stop and ask the server for
          // the board and everything since — it holds both, so recovery needs
          // nothing from the other player and no button from this one.
          if (!this.view.desynced) {
            this.set({ desynced: true, error: 'Fell behind. Catching up…' });
            this.send({ t: 'resync' });
          }
          return;
        }
        this.lastRev = rev;
        this.hooks.onCommand(msg.cmd as Command, seat);
        return;
      }

      case 'rolled': {
        const dice = (msg.dice ?? []) as RolledDie[];
        const seat = msg.seat as Side;
        const id = typeof msg.id === 'string' ? msg.id : null;
        const waiting = id ? this.rolls.get(id) : undefined;
        if (waiting) {
          window.clearTimeout(waiting.timer);
          this.rolls.delete(id!);
          waiting.resolve(dice);
        }
        // Everyone in the room is told, including the roller — the hook is
        // what puts the other player's dice on screen.
        this.hooks.onRolled(dice, seat, (msg.label as string) ?? null, seat === this.view.seat);
        return;
      }

      case 'needCheckpoint':
        this.hooks.onNeedCheckpoint();
        return;

      case 'error':
        this.set({ error: String(msg.why ?? 'Something went wrong.') });
        // A refused create or join is terminal; there is nothing to retry into.
        if (!this.view.room) this.wanted = null;
        return;

      default:
        return;
    }
  }
}
