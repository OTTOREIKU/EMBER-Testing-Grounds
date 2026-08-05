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

// What a roll is being read for. The faces are the same either way; this only
// decides how the result is summarised, and it travels with the roll so both
// players read it the same way.
export type RollKind = 'hits' | 'pool';

export interface NetHooks {
  // Dice that landed in this room, whoever asked for them. Both players are
  // told, so the roll is something they watch together rather than a number
  // one of them reports to the other.
  onRolled(dice: RolledDie[], seat: Side, label: string | null, mine: boolean, kind: RollKind): void;
  // A command from the other player, already ordered by the server.
  onCommand(cmd: Command, seat: Side): void;
  // The full board, either because we joined late or because we drifted.
  onCheckpoint(state: unknown): void;
  // A catch-up is running: the board is being rebuilt from a checkpoint and
  // then walked forward through history. Worth drawing once at the end rather
  // than once per command, since the tail can be a whole match long.
  onCatchUp(active: boolean): void;
  // The table was closed by its host. The room is gone, for everyone.
  onClosed(): void;
  // The server dropped its history and wants the board republished.
  onNeedCheckpoint(): void;
  // Anything the UI should redraw on.
  onChange(view: NetView): void;
  // Our own board, for publishing.
  snapshot(): unknown;
  // A short digest of the facts both clients must agree on, or null to opt out
  // of drift checking. Whatever legitimately differs between the two — a
  // Timing Dial before its reveal — has to be left out, or every Planning
  // Phase reads as a desync.
  fingerprint?(): string | null;
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
  // The revision a running catch-up ends at. Commands at or below it are
  // history being replayed onto a checkpoint, so they are applied whoever sent
  // them — including our own, which the checkpoint predates. Above it we are
  // live again, and our own commands coming back are acknowledgements of work
  // this client already did.
  private replayTo = 0;
  private replaying = false;
  private replayGuard: number | undefined;
  // A board was asked for while this client still had work in flight, so it
  // goes out as soon as the queue drains.
  private checkpointDue = false;
  private retry = 0;
  private retryTimer: number | undefined;
  // The client half of the liveness check. The server pings every 10s and
  // terminates whoever stops answering, but a browser never sees those frames,
  // so this end cannot tell a black-holed socket from an opponent taking their
  // time — and a turn-based game is quiet for minutes at a stretch. So we ping
  // too, and treat a silence longer than a few rounds of it as a dead line.
  private beat: number | undefined;
  private heard = 0;
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

  get catchingUp(): boolean {
    return this.replaying;
  }

  // Opens and closes the replay window. The guard is there because the window
  // suppresses drawing: a tail that never arrives must not leave the board
  // frozen, so it closes itself if the history stops coming.
  private beginReplay(through: number): void {
    this.replayTo = through;
    if (this.replaying) return;
    this.replaying = true;
    this.hooks.onCatchUp(true);
    window.clearTimeout(this.replayGuard);
    this.replayGuard = window.setTimeout(() => this.endReplay(), 8000);
  }

  private endReplay(): void {
    if (!this.replaying) return;
    window.clearTimeout(this.replayGuard);
    this.replaying = false;
    this.hooks.onCatchUp(false);
  }

  // Every 15s while a socket is open, with a 45s silence — three unanswered
  // beats — counting as gone. Long enough that a phone waking up or a slow
  // hop reconnects on its own rather than being torn down mid-turn.
  private static readonly BEAT_MS = 15_000;
  private static readonly DEAF_MS = 45_000;

  // `<rev>:<hash>` — the board this client had applied, and how far it had got.
  // Null when the app offers no fingerprint, which is how the board page opts
  // out without a second code path.
  private stamp(): string | null {
    const fp = this.hooks.fingerprint?.();
    return fp === undefined || fp === null ? null : `${this.lastRev}:${fp}`;
  }

  // A command carries the sender's board as it was before it. If we are at the
  // same revision we can hold ours against it, and a difference means the two
  // boards have drifted while every revision arrived — which no gap check can
  // see, because the numbers agree. That is the shape a non-deterministic
  // apply() takes, and it is silent without this.
  private driftedFrom(raw: unknown): boolean {
    if (typeof raw !== 'string') return false;
    const at = raw.indexOf(':');
    if (at < 1) return false;
    const rev = Number(raw.slice(0, at));
    // Their board was one revision behind this command, ours is too, and only
    // then do the two describe the same moment.
    if (!Number.isInteger(rev) || rev !== this.lastRev) return false;
    const mine = this.hooks.fingerprint?.();
    if (mine === undefined || mine === null) return false;
    return mine !== raw.slice(at + 1);
  }

  private startBeat(): void {
    window.clearInterval(this.beat);
    this.heard = Date.now();
    this.beat = window.setInterval(() => {
      if (this.ws?.readyState !== WebSocket.OPEN) return;
      if (Date.now() - this.heard > Relay.DEAF_MS) {
        // Closing by hand is what makes it recoverable: onclose is the only
        // path that schedules a reconnect, and a black-holed socket will never
        // fire it on its own.
        this.ws.close();
        return;
      }
      this.send({ t: 'ping' });
    }, Relay.BEAT_MS);
  }

  private stopBeat(): void {
    window.clearInterval(this.beat);
    this.beat = undefined;
  }

  leave(): void {
    this.wanted = null;
    window.clearTimeout(this.retryTimer);
    this.stopBeat();
    this.endReplay();
    this.retry = 0;
    this.pending = [];
    this.seq = 0;
    this.lastRev = 0;
    this.replayTo = 0;
    this.checkpointDue = false;
    if (this.connected) this.send({ t: 'leave' });
    this.ws?.close();
    this.ws = null;
    this.set({ status: 'offline', room: null, seat: null, host: false, error: null, desynced: false });
  }

  // Ends the table for good rather than leaving it to the idle sweep. Only
  // the host may; the server refuses anyone else.
  closeRoom(): void {
    if (!this.view.room) return;
    this.send({ t: 'close' });
  }

  // Called by the app for every command performed locally.
  publish(cmd: Command): void {
    if (!this.view.room || !this.view.seat) return;
    this.seq += 1;
    const entry = { seq: this.seq, cmd };
    this.pending.push(entry);
    // The board as it stood before this command. The revision rides inside the
    // string rather than as a second field, so the server forwards one opaque
    // value and never has to know what it means — and the receiver can tell
    // whether it is even comparable.
    this.send({ t: 'cmd', ...entry, fp: this.stamp() });
  }

  // Asks the server to roll. The faces come back from there rather than from
  // here, which is what stops a modified client choosing its own results —
  // and it means both players watch the same dice land.
  rollDice(pool: Record<string, number>, label?: string, kind: RollKind = 'pool'): Promise<RolledDie[]> {
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
      this.send({ t: 'roll', id, pool, label: label ?? null, kind });
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
  // The revision travels with the board. Without it the server would file the
  // snapshot under wherever it had got to, and any command that landed while
  // this one was being taken would be discarded as already included.
  //
  // A board is only worth the revision it claims when nothing of ours is still
  // in flight. With a command outstanding the board already shows that
  // command's work while the number still says otherwise, so the server keeps
  // the command in its log and the next player to join applies it a second
  // time on top of a board that already had it. Waiting for the queue to drain
  // is what makes the two agree: with nothing pending, this board is exactly
  // the last revision we were told about.
  publishCheckpoint(): void {
    if (!this.view.room || !this.view.seat) return;
    if (this.pending.length) {
      this.checkpointDue = true;
      return;
    }
    this.checkpointDue = false;
    this.send({ t: 'checkpoint', rev: this.lastRev, state: this.hooks.snapshot() });
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
      this.startBeat();
      if (this.wanted?.kind === 'create') this.send({ t: 'create' });
      else if (this.wanted?.kind === 'join') this.send({ t: 'join', room: this.wanted.room });
    };

    ws.onmessage = (ev) => {
      // Anything at all counts as a sign of life, so a busy game never pings.
      this.heard = Date.now();
      this.receive(String(ev.data));
    };

    ws.onclose = () => {
      this.ws = null;
      this.stopBeat();
      // A tail cut off halfway must not leave the board waiting to be drawn.
      this.endReplay();
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

      // Nothing to do: arriving at all is the whole point, and onmessage has
      // already stamped it.
      case 'pong':
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
        // The host seeds a NEW room with the board it already has, so a guest
        // joining is not staring at an empty table. A room that already holds
        // a checkpoint must never be overwritten on join: rejoining after a
        // reload would publish this client's fresh, empty board over the live
        // match and send both players back to setup. The server sends the
        // stored board through catchUp, and asks via needCheckpoint when it
        // genuinely has none.
        if (you.host && you.seat && !room.hasCheckpoint) this.publishCheckpoint();
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
        // The server says how far the history it is about to send runs. Older
        // servers do not, in which case the room's revision is the best guess.
        const through = Number(msg.through ?? this.view.room?.revision ?? this.lastRev);
        if (through > this.lastRev) this.beginReplay(through);
        this.hooks.onCheckpoint(msg.state);
        // Whatever we had fallen behind by, this is current again.
        this.set({ desynced: false, error: null });
        return;
      }

      case 'cmd': {
        const rev = Number(msg.rev);
        const seat = msg.seat as Side;
        // The gap check comes first and covers our own commands too: the
        // server orders everything through one counter, so a hole under our
        // own seat is exactly as much of a hole as one under theirs.
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
        // Before lastRev moves and before anything is applied: the sender's
        // fingerprint describes the board *without* this command, which is the
        // one we are still holding. A replay is exempt — the tail is being laid
        // onto a checkpoint, not onto the board that made the fingerprint.
        if (!this.replaying && seat !== this.view.seat && this.driftedFrom(msg.fp)) {
          if (!this.view.desynced) {
            this.set({ desynced: true, error: 'The two boards disagree. Catching up…' });
            this.send({ t: 'resync' });
          }
          return;
        }
        this.lastRev = rev;
        const mine = seat === this.view.seat;
        if (mine) {
          // Our own command coming back is the server acknowledging it.
          // Anything at or below that sequence number has landed and no longer
          // needs replaying.
          const ack = Number(msg.seq);
          if (Number.isInteger(ack)) this.pending = this.pending.filter((p) => p.seq > ack);
          // A board that was waiting on this can go now.
          if (this.checkpointDue && !this.pending.length && !this.replaying) this.publishCheckpoint();
        }
        // Live, our own work is already on this board and applying it again
        // would double it. Inside a catch-up nothing here has been applied at
        // all — the state came from a checkpoint taken before any of it — so
        // every command in the tail counts, ours included. Skipping them was
        // what sent a rejoining player back to an empty table.
        if (!mine || this.replaying) this.hooks.onCommand(msg.cmd as Command, seat);
        if (this.replaying && rev >= this.replayTo) this.endReplay();
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
        // what puts the dice on screen, and both players get them from the
        // same message rather than one drawing its own.
        const kind: RollKind = msg.kind === 'hits' ? 'hits' : 'pool';
        this.hooks.onRolled(dice, seat, (msg.label as string) ?? null, seat === this.view.seat, kind);
        return;
      }

      case 'closed':
        // The room is gone, so there is nothing to reconnect to: forget it
        // before the socket closes or we would sit here retrying a dead code.
        this.wanted = null;
        this.endReplay();
        this.ws?.close();
        this.ws = null;
        this.set({ status: 'offline', room: null, seat: null, host: false, error: null, desynced: false });
        this.hooks.onClosed();
        return;

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
