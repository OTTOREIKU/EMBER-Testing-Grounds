// THE DRIVER: what sits in a computer's seat. It asks the seat seam what the
// seat owes, hands the question to a policy, and sends the option the policy
// names. It holds no rule and no strategy, only the mechanics of answering:
// the seat's own memory, the routines an option may name (anything with dice
// or a secret in it), the seat's combat window, and the guards that keep a
// game from standing still.
//
// It acts as a second player would across a table (AI-OPPONENT-PLAN.md,
// section 2): everything it does leaves as a command through `host.send`, and
// everything it knows comes from the state the host shows it and the commands
// the host tells it have landed.
import type { CheckResult, Command } from '../commands';
import type { GameData } from '../data';
import { hashDials, type DialEntry } from '../secrecy';
import {
  gameOver, musing, newMind, owed, owedAfter, owedIfActivated, pondering, sightedIn, tableWithout, viewOf, walkIn, walkedKey,
  type Decision, type GameOver, type MineOffer, type Option, type Outlook, type SeatMind, type SeatView, type WalkMemo,
} from '../seat';
import { countHits } from '../setup';
import type { GameState, Side, Timing } from '../types';
import { BotCombat, type AttackArgs } from './botcombat';
import { BotContest } from './botcontest';
import { Odds } from './odds';
import type { Policy } from './policy';
import type { Rng } from './rng';

// The table a driver plays at, as far as it can touch it.
export interface Host {
  data: GameData;
  // The board as it stands now. Read afresh every step: a rollback or a
  // rejoin replaces the object.
  state(): GameState;
  // Sends one command as this seat. The verdict comes back once the command
  // has been applied and the turn bookkeeping has run, or refused.
  send(cmd: Command): CheckResult;
  // Dice from the table's own source, so neither seat picks its numbers.
  // `kind` is how a table that shows its rolls sums one up: by its Hits (the
  // roll for First Player, a Counter-roll) or by its icons.
  roll(pool: Record<string, number>, label: string, kind?: 'hits' | 'pool'): Promise<{ color: string; face: number }[]>;
  // THE PACE (OTTO, 2026-10-01: a computer that runs its whole turn in under
  // two seconds reads as a machine). The driver holds no timer of its own.
  // Before it acts on a decision it waits for `pace`: a page takes a moment
  // there, longer before a Movement or an attack is declared than before a
  // step of bookkeeping. After it has acted it waits for `settled`: the walk
  // has ended on the player's board, the dice have landed, the combat window
  // has shown the step. A host that leaves both out (the test suite's) is
  // answered at once, so a game there runs as fast as the engine does.
  pace?(decision: Decision, option: Option): Promise<void>;
  settled?(decision: Decision, option: Option): Promise<void>;
  // A pause in the middle of a decision: a page hands its thread to whatever
  // else is waiting on it (a frame to draw, a click) and comes back. A policy
  // that can work in steps (`Policy.ponder`) is given it between them, so a
  // decision that takes half a second of work does not freeze the page for
  // half a second. A host that leaves it out is answered in one go.
  breathe?(): Promise<void>;
}

export interface DriverOptions {
  // Also take the bookkeeping steps either seat may take (the End Phase's),
  // when they are the other seat's by default.
  takeShared?: boolean;
  // Answers the host has already settled, by option tag: a scenario that
  // fixes each squad's table edge names it here ('edge:black').
  prefer?: string[];
  // How many log entries to keep.
  logSize?: number;
}

export interface LogEntry {
  n: number;
  round: number;
  phase: number;
  kind: string;
  decision: string;
  option: string;
  label: string;
  why: string;
  // The policy's rule, by name, when it gave one.
  reason: string;
  options: number;
  ms: number;
}

export type Step =
  | { kind: 'acted'; decision: Decision; option: Option }
  | { kind: 'idle' }
  // The question changed while the seat took its moment over the answer: the
  // other seat is a player, and plays. Nothing was sent; it is asked again.
  | { kind: 'moot'; decision: Decision }
  | { kind: 'over'; result: GameOver }
  | { kind: 'refused'; decision: Decision; option: Option; command: Command | null; why: string }
  | { kind: 'stuck'; decision: Decision; why: string };

type Failed = { command: Command | null; why: string } | null;

// A routine is what an option names when sending commands is not the whole of
// it. Each answers with the refusal that stopped it, or null.
type Routine = (args: Record<string, unknown>, decision: Decision) => Promise<Failed>;

// How often one unit may be asked the same kind of question in one phase
// before the seat stops deliberating and takes the safe answer, and how often
// before it gives the game up as stuck. A policy that keeps changing its mind
// (a Stance set back and forth) costs the seat its turn, never the game.
const PATIENCE = 40;
const LIMIT = 80;

export class Driver {
  readonly mind: SeatMind = newMind();
  readonly log: LogEntry[] = [];
  readonly combat: BotCombat;
  readonly contest: BotContest;
  // How many decisions this seat has taken, in all.
  taken = 0;
  // Commands the host has said landed, this seat's and the other's.
  private landed = 0;
  // The options already tried for a question, while nothing has landed since:
  // an answer that did not move the game is not given a second time.
  private tried = new Map<string, Set<string>>();
  private triedAt = -1;
  private asked = new Map<string, number>();
  private readonly routines: Record<string, Routine>;
  // The window this seat's odds are asked of (odds.ts), made when first needed.
  private calculator: Odds | null = null;
  // A memory with nothing in it, for a question put as the OTHER seat would be
  // put it: that seat's dials are not this one's to know.
  private readonly nobody: SeatMind = newMind();
  // The walks worked out so far in this game (seat.ts walkIn): each is kept by
  // everything it was read from, so it holds until the terrain changes.
  private readonly walks: WalkMemo = new Map();

  constructor(
    readonly seat: Side,
    private readonly host: Host,
    private readonly policy: Policy,
    private readonly rng: Rng,
    private readonly opts: DriverOptions = {},
  ) {
    this.combat = new BotCombat(seat, host, () => this.odds);
    this.contest = new BotContest(seat, host);
    this.routines = {
      dial: (args) => this.dial(args),
      commitDials: () => this.commitDials(),
      revealDials: () => this.revealDials(),
      rollSetup: (args) => this.rollSetup(args),
      rollDefense: (args) => this.rollDefense(args),
      attack: (args) => this.attack(args),
      combat: (args) => this.press(args),
      contest: (args) => this.pressContest(args),
      // What a seat remembers and lets go of, sending nothing: the Mines a walk
      // could still Lay (seat.ts SeatMind.mines).
      forget: (args) => {
        if (args.what === 'mines') this.mind.mines = null;
        // A Tactics Card's moment let go by: not asked again (owed.ts).
        if (args.what === 'tactic') this.mind.passed = [...(this.mind.passed ?? []), String(args.key)];
        // A Forced Movement left be (blocked, or nothing left to move): what
        // a Penetration knocked loose lands now (FAQ E19).
        if (args.what === 'shove') { this.mind.shove = null; this.combat.flushDrops(); }
        this.landed += 1;
        return Promise.resolve(null);
      },
    };
  }

  get odds(): Odds {
    return (this.calculator ??= new Odds(this.host.data));
  }

  // ITS HAND OF TACTICS CARDS, dealt sealed (Supplementary Rules 1.04, 1.11):
  // each card with the salt that proves it against a commitment on the table.
  // Only this seat holds them; the host that made them keeps no copy.
  deal(hand: { id: string; salt: string }[]): void {
    this.mind.hand = hand.length ? hand.map((c) => ({ id: c.id, salt: c.salt })) : null;
  }

  // THE BOARD WAS REPLACED UNDER IT (a rollback both seats agreed to): what it
  // remembered of the table it was playing (the dials it set and has not
  // revealed, a blast's list, the Mines a walk could Lay) and the answers it
  // had found the table would not take are let go, and it reads the board again.
  forget(): void {
    // Its hand of Tactics Cards was dealt before the game, which no rollback
    // reaches past: kept.
    const hand = this.mind.hand ?? null;
    Object.assign(this.mind, newMind(), { hand });
    this.tried.clear();
    this.triedAt = -1;
    this.asked.clear();
    this.landed += 1;
  }

  // What a policy is handed beside the question (rule R5): each attack among
  // the answers is given its ODDS, what it is likely to do by the combat
  // window's own arithmetic; and each answer that is commands alone is given
  // WHAT COMES NEXT, the question this seat would be put on the table those
  // commands leave. A Timing Dial is given the Opportunity it would open, and
  // a launch what its Projectile could do when its turn comes. All of it is
  // worked out when a policy asks, and once only. `state` is the table the
  // question was asked of: the one in play, or one a policy is only thinking
  // about. The question may be one put to the OTHER seat (this seat looking at
  // what an enemy unit could do, `Outlook.turnOf`): what comes next is then
  // asked as that seat, with none of this seat's memory.
  private withOdds(d: Decision, state: GameState = this.host.state()): Decision {
    const { data } = this.host;
    const seat = d.seat;
    const mind = seat === this.seat ? this.mind : this.nobody;
    if (!d.here) {
      let stands: Outlook | undefined;
      d.here = () => (stands ??= this.outlook(state));
    }
    // One look per list of kinds wanted (and per Timing named), however often
    // it is asked for.
    type Look = (only?: string[], timing?: string) => Decision | null;
    const once = (look: Look): Look => {
      const seen = new Map<string, Decision | null>();
      return (only, timing) => {
        const key = `${only ? only.join(',') : '*'}|${timing ?? ''}`;
        if (!seen.has(key)) seen.set(key, look(only, timing));
        return seen.get(key) ?? null;
      };
    };
    // The unit whose activation this question is, if it is one.
    const actor = d.kind === 'opp.act' || d.kind === 'activation.act' ? d.unit : undefined;
    for (const o of d.options) {
      if (o.run?.routine === 'attack' && !o.chance) {
        const args = o.run.args as unknown as AttackArgs & { before?: Command[] };
        let known: ReturnType<Odds['forecast']> | undefined;
        o.chance = () => (known === undefined ? (known = this.odds.forecast(state, args)) : known);
        // What is left of the activation behind an attack: the question once
        // it has been paid for, its dice having changed nothing.
        const paid = args.before ?? [];
        if (paid.length && !o.then) {
          o.then = once((only) => {
            const after = owedAfter(data, state, seat, mind, paid, only ? { only } : undefined);
            return after?.decision ? this.withOdds(after.decision, after.table) : null;
          });
        }

      }
      // A Movement that sets a Mine off has dice in it too: the odds are those
      // of the Mine's Explosion on the unit that walked into it.
      const mine = o.facts?.mine as { uid: number; actionId: string } | undefined;
      if (mine && typeof o.facts?.uid === 'number' && !o.chance) {
        const blast: AttackArgs = { uid: mine.uid, actionId: mine.actionId, targetUid: o.facts.uid, mode: 'explosion' };
        let known: ReturnType<Odds['forecast']> | undefined;
        o.chance = () => (known === undefined ? (known = this.odds.forecast(state, blast)) : known);
      }
      // An attack on a unit in Optical Camouflage is commands and no routine
      // (the free Scan that designates it is a Counter-roll): its odds are the
      // Scan's, times the attack's on the unit where its marker stands.
      if (o.tags[0] === 'attack' && o.tags.includes('hidden') && o.commands?.length && !o.chance) {
        const args: AttackArgs & { before?: Command[] } = {
          uid: Number(o.facts?.uid), actionId: String(o.facts?.actionId), targetUid: Number(o.facts?.targetUid), mode: 'attack', before: o.commands.slice(0, -1),
        };
        let known: ReturnType<Odds['hidden']> | undefined;
        o.chance = () => (known === undefined ? (known = this.odds.hidden(state, args)) : known);
      }
      // An answer that opens an Electronic Counter-roll: the chance it is won.
      const opens = o.commands?.length ? o.commands[o.commands.length - 1] : undefined;
      if (opens?.kind === 'startCounterRoll' && !o.win) {
        const args = { uid: opens.uid, targetUid: opens.targetUid, actionId: opens.actionId, terminal: opens.terminal, before: o.commands!.slice(0, -1) };
        let known: number | null | undefined;
        o.win = () => (known === undefined ? (known = this.odds.counter(state, args)) : known);
      }
      if (o.commands?.length && !o.run && !o.then) {
        const commands = o.commands;
        o.then = once((only) => {
          const after = owedAfter(data, state, seat, mind, commands, only ? { only } : undefined);
          return after?.decision ? this.withOdds(after.decision, after.table) : null;
        });
        // The table the answer leaves, worked out once for every other look
        // at it.
        let landed: ReturnType<typeof owedAfter> | undefined;
        const after = (): ReturnType<typeof owedAfter> =>
          (landed === undefined ? (landed = owedAfter(data, state, seat, mind, commands, { only: [] })) : landed);
        let left: Outlook | null | undefined;
        o.after = () => {
          if (left === undefined) {
            const table = after();
            left = table ? this.outlook(table.table) : null;
          }
          return left;
        };
        // A turn later than this one, on that table: the Projectile a launch
        // puts down, or the unit itself the next time it is activated.
        if (!o.later && (o.tags[0] === 'launch' || actor !== undefined)) {
          const launched = o.tags[0] === 'launch';
          o.later = once((only, timing) => {
            const table = after();
            const uid = launched ? table?.born[0] : actor;
            const turn = table && uid !== undefined
              ? owedIfActivated(data, table.table, uid, launched ? undefined : timing as Timing | undefined, only ? { only } : undefined)
              : null;
            return turn?.decision ? this.withOdds(turn.decision, turn.table) : null;
          });
        }
      }
      if (o.run?.routine === 'dial' && !o.then) {
        const { uid, timing } = o.run.args as { uid: number; timing: Timing };
        o.then = once((only) => {
          const turn = owedIfActivated(data, state, uid, timing, only ? { only } : undefined);
          return turn?.decision ? this.withOdds(turn.decision, turn.table) : null;
        });
      }
    }
    return d;
  }

  // A TABLE THIS SEAT IS ONLY THINKING ABOUT (seat.ts Outlook): its view of
  // it, what it would be asked there, and what any unit would be asked if its
  // own turn opened there. Each reading is the seam's, made once.
  private outlook(state: GameState): Outlook {
    const { data } = this.host;
    let seen: SeatView | undefined;
    const asked = new Map<string, Decision | null>();
    const gone = new Map<number, Outlook>();
    const kinds = (only?: string[]): string => (only ? only.join(',') : '*');
    const once = (key: string, look: () => Decision | null): Decision | null => {
      if (!asked.has(key)) asked.set(key, look());
      return asked.get(key) ?? null;
    };
    return {
      view: () => (seen ??= viewOf(data, state, this.seat)),
      owed: (only) => once(`owed|${kinds(only)}`, () => {
        const d = owed(data, state, this.seat, this.mind, only ? { only } : undefined);
        return d ? this.withOdds(d, state) : null;
      }),
      turnOf: (uid, only, timing) => once(`turn|${uid}|${kinds(only)}|${timing ?? ''}`, () => {
        const turn = owedIfActivated(data, state, uid, timing as Timing | undefined, only ? { only } : undefined);
        return turn?.decision ? this.withOdds(turn.decision, turn.table) : null;
      }),
      seen: (uid, grids, from) => sightedIn(data, state, uid, grids.map((g) => ({ c: g.col, r: g.row })), from?.map((g) => ({ c: g.col, r: g.row }))),
      walk: (uid, from, to, left, via) => walkIn(data, state, uid, from.map((g) => ({ c: g.col, r: g.row })), to.map((g) => ({ c: g.col, r: g.row })), left, this.walks, via ? { c: via.col, r: via.row } : undefined),
      without: (uid) => {
        let out = gone.get(uid);
        if (!out) gone.set(uid, out = this.outlook(tableWithout(state, uid)));
        return out;
      },
    };
  }

  // The host tells the driver of EVERY command that lands at the table, this
  // seat's own and the other's, as a second player's page is told.
  observe(cmd: Command): void {
    this.landed += 1;
    this.combat.observe(cmd);
  }

  // What this seat is being asked, if anything. An attack in its window comes
  // first, its own or one made on it; then a Counter-roll on the table; then
  // what the turn owes. A shared step that is the other seat's by default is
  // not this one's unless the table says so.
  pending(): Decision | null {
    const fight = this.combat.decision();
    if (fight) return fight;
    if (this.combat.busy) return null;
    // A Forced Movement the attack just made owes (Knockback X, Push X) is
    // this seat's to make: kept in its memory until it is made (M8.2t).
    const owes = this.combat.shoveOwed;
    if (owes) {
      this.mind.shove = { uid: owes.attackerUid, actionId: owes.actionId, targetUid: owes.targetUid };
      this.combat.shoveOwed = null;
    }
    const duel = this.contest.decision();
    if (duel) return duel;
    // One question, asked of a board that stands still while it is asked: its
    // lines of sight are walked once (a launcher's Landing Points ask the same
    // line for each card it launches).
    const d = pondering(() => owed(this.host.data, this.host.state(), this.seat, this.mind));
    if (!d) return null;
    if (d.shared && d.seat !== this.seat && !this.opts.takeShared) return null;
    return this.withOdds(d);
  }

  // One decision: ask, choose, send. Resolves once what was chosen has landed.
  async step(): Promise<Step> {
    const { data } = this.host;
    await this.combat.settle();
    await this.contest.settle();
    const state = this.host.state();
    const result = gameOver(data, state);
    if (result.over) return { kind: 'over', result };
    const d = this.pending();
    if (!d) return { kind: 'idle' };
    const at = { round: state.round.n, phase: state.round.phase };

    // The same question with nothing having landed since: an answer already
    // given did not move the game, so it is not given a second time.
    if (this.landed !== this.triedAt) { this.tried.clear(); this.triedAt = this.landed; }
    const done = this.tried.get(d.id) ?? new Set<string>();
    const open = d.options.filter((o) => !done.has(o.id));
    if (!open.length) return { kind: 'stuck', decision: d, why: `every answer to "${d.kind}" has been tried and the question still stands` };
    const narrowed: Decision = { ...d, options: open, fallback: open.some((o) => o.id === d.fallback) ? d.fallback : open[0].id };

    const topic = `${at.round}:${at.phase}:${d.kind}:${d.unit ?? ''}`;
    const times = (this.asked.get(topic) ?? 0) + 1;
    this.asked.set(topic, times);
    if (this.asked.size > 256) this.asked.delete(this.asked.keys().next().value as string);
    if (times > LIMIT) return { kind: 'stuck', decision: d, why: `"${d.kind}" has been asked ${times} times this phase and the game has not moved on` };

    const t0 = Date.now();
    const settled = (this.opts.prefer ?? []).length ? narrowed.options.find((o) => o.tags.some((t) => this.opts.prefer!.includes(t))) : undefined;
    let pick = settled?.id;
    let why = settled ? 'settled by the table' : '';
    let reason = '';
    if (!pick && times > PATIENCE) {
      pick = narrowed.fallback;
      why = 'the safe answer (asked this too many times)';
    }
    if (!pick) {
      try {
        // Everything the policy looks at while it chooses is one seat's one
        // thought about boards that stand still: lines of sight are walked once.
        // Where the host offers a pause and the policy can work in steps, the
        // thought is put down between them (a page is not held up for it); the
        // answer is the same, and is checked against the table again below.
        const view = viewOf(data, state, this.seat);
        const pause = this.host.breathe;
        const choice = pause && this.policy.ponder
          ? await musing(() => this.policy.ponder!(narrowed, view, this.rng, pause))
          : pondering(() => this.policy.choose(narrowed, view, this.rng));
        pick = choice.option;
        why = choice.why ?? '';
        reason = choice.reason ?? '';
      } catch (err) {
        // A policy that fails costs the seat its judgement, never its turn.
        pick = narrowed.fallback;
        why = `the safe answer (the policy failed: ${err instanceof Error ? err.message : String(err)})`;
      }
    }
    const option = narrowed.options.find((o) => o.id === pick) ?? narrowed.options.find((o) => o.id === narrowed.fallback)!;
    done.add(option.id);
    this.tried.set(d.id, done);

    // The host's pace: a moment before the answer, and the table at rest
    // after it. Nothing is sent while either is pending.
    let chosen = option;
    if (this.host.pace) {
      await this.host.pace(d, option);
      // The table may have moved on meanwhile, so the question is asked again
      // and the answer is sent only if it is the same question and the answer
      // is still on offer, AS IT IS OFFERED NOW: an answer's commands are made
      // for the table as it stands (the ready that completes a pair is the one
      // that also turns the phase), so the fresh ones are the ones sent.
      const now = this.pending();
      const fresh = now && now.id === d.id ? now.options.find((o) => o.id === option.id) : undefined;
      if (!fresh) {
        done.delete(option.id);
        return { kind: 'moot', decision: d };
      }
      chosen = fresh;
    }
    let failed: Failed;
    try {
      failed = await this.perform(chosen, d);
    } catch (err) {
      // A routine that broke (its dice never came) gave no answer at all: it
      // is not one that was tried and failed to move the game.
      done.delete(option.id);
      throw err;
    }
    if (!failed) await this.host.settled?.(d, chosen);
    this.taken += 1;
    this.log.push({
      n: this.taken, round: at.round, phase: at.phase, kind: d.kind, decision: d.id,
      option: option.id, label: option.label, why: failed ? `REFUSED: ${failed.why}` : why, reason, options: d.options.length, ms: Date.now() - t0,
    });
    if (this.log.length > (this.opts.logSize ?? 400)) this.log.shift();
    if (failed) return { kind: 'refused', decision: d, option, command: failed.command, why: failed.why };
    return { kind: 'acted', decision: d, option };
  }

  private async perform(option: Option, d: Decision): Promise<Failed> {
    for (const cmd of option.commands ?? []) {
      const failed = this.sent(cmd);
      if (failed) return failed;
    }
    // A walk that leaves Range for Mines (006_A): what its route may hold is
    // this seat's to remember, as the Match Centre's Mine panel remembers it
    // (seat.ts SeatMind), and each Mine laid takes one off it.
    const offer = option.facts?.lay as MineOffer | undefined;
    if (offer) this.mind.mines = { ...offer, left: offer.max, walked: walkedKey(this.host.state()) };
    if (option.facts?.mine === 'laid' && this.mind.mines) {
      this.mind.mines.left -= 1;
      if (this.mind.mines.left <= 0) this.mind.mines = null;
    }
    // A Movement Action that may shove at its end (181_A, PLK400-SK_A, M8.2u):
    // owed now, with no victim named; a walk a Mine stopped owes it after the
    // Go on, in the same round.
    const shoves = option.facts?.shoves as { uid: number; actionId: string } | undefined;
    if (shoves) this.mind.shove = { uid: shoves.uid, actionId: shoves.actionId, targetUid: null };
    const later = option.facts?.shovesLater as { uid: number; actionId: string } | undefined;
    if (later) this.mind.shoveLater = { ...later, round: this.host.state().round.n };
    if (option.tags.includes('resume') && this.mind.shoveLater) {
      const s = this.mind.shoveLater;
      this.mind.shoveLater = null;
      if (s.round === this.host.state().round.n && option.facts?.uid === s.uid) this.mind.shove = { uid: s.uid, actionId: s.actionId, targetUid: null };
    }
    // A Forced Movement made: done, or the rest of a line a Mine stopped is
    // owed once its blast is resolved. Once it is done, a Box knocked loose by
    // the attack lands where the victim now stands (FAQ E19).
    if (option.facts?.shove === 'made' && this.mind.shove) {
      const rest = option.facts.rest as { dir: { dc: number; dr: number }; grids: number } | undefined;
      this.mind.shove = rest ? { ...this.mind.shove, resume: rest } : null;
      if (!this.mind.shove) this.combat.flushDrops();
    }
    if (option.run) {
      const routine = this.routines[option.run.routine];
      if (!routine) return { command: null, why: `no routine called "${option.run.routine}"` };
      return routine(option.run.args, d);
    }
    return null;
  }

  private sent(cmd: Command): Failed {
    const v = this.host.send(cmd);
    return v.ok ? null : { command: cmd, why: v.why };
  }

  // ---------- the Timing Dials (3.3) ----------
  //
  // Chosen in private, committed as a hash, revealed once both squads have
  // committed: what a second player's page does (match.ts lockDialsNetworked,
  // maybeReveal). The dials are never in the shared state before the reveal.

  private async dial(args: Record<string, unknown>): Promise<Failed> {
    const round = this.host.state().round.n;
    if (!this.mind.dials || this.mind.dials.round !== round) this.mind.dials = { round, picks: {} };
    this.mind.dials.picks[Number(args.uid)] = args.timing as Timing;
    // Nothing is sent, and the question that follows is a new one.
    this.landed += 1;
    return null;
  }

  private dialEntries(): DialEntry[] {
    const picks = this.mind.dials?.picks ?? {};
    return this.host.state().tokens
      .filter((t) => t.side === this.seat && t.kind === 'mech')
      .map((t) => ({ uid: t.uid, timing: picks[t.uid] }));
  }

  private async commitDials(): Promise<Failed> {
    // A squad with no Mech left sets no dial and still commits, to nothing, so
    // that the reveal can follow: its memory of the round begins here.
    const round = this.host.state().round.n;
    if (!this.mind.dials || this.mind.dials.round !== round) this.mind.dials = { round, picks: {} };
    const held = this.mind.dials;
    const salt = this.rng.hex(16);
    const hash = await hashDials(salt, this.dialEntries());
    held.salt = salt;
    return this.sent({ kind: 'commitTimings', seat: this.seat, hash });
  }

  private async revealDials(): Promise<Failed> {
    const held = this.mind.dials;
    if (!held?.salt) return { command: null, why: 'no commitment is held' };
    return this.sent({ kind: 'revealTimings', seat: this.seat, salt: held.salt, dials: this.dialEntries() });
  }

  // ---------- dice ----------

  private async rollSetup(args: Record<string, unknown>): Promise<Failed> {
    const dice = await this.host.roll({ yellow: Number(args.dice) || 2 }, 'rolls for First Player', 'hits');
    const faces = this.host.data.dice?.dice.yellow?.faces ?? [];
    // Hits per die, as the roll is recorded: a face may carry two.
    const hits = dice.map((d) => countHits([faces[d.face] ?? []]));
    return this.sent({ kind: 'rollSetup', seat: this.seat, hits });
  }

  // A defence roll asked for with no attack published to answer it in: the
  // turn panel's own roll button (matchhud defensePanel).
  private async rollDefense(args: Record<string, unknown>): Promise<Failed> {
    const white = Number(args.white) || 0;
    const blue = Number(args.blue) || 0;
    const faces = white + blue > 0
      ? await this.host.roll({ ...(white ? { white } : {}), ...(blue ? { blue } : {}) }, 'Defence')
      : [];
    return this.sent({ kind: 'answerDefense', seat: this.seat, faces });
  }

  // ---------- an attack ----------

  // What comes before the window opens is sent first, in the order the turn
  // panel keeps (matchhud commitAction, then startAttack): a Charge spent on
  // the attack, the Action's payment, a Missile's flight to its target.
  private async attack(args: Record<string, unknown>): Promise<Failed> {
    for (const cmd of (args.before as Command[] | undefined) ?? []) {
      const failed = this.sent(cmd);
      if (failed) return failed;
    }
    // An attack the seam has put off: what was just sent leaves a debt that
    // comes first (a Missile's flight owes Interception), and the seam offers
    // the attack again once that is settled. Nothing opens now.
    if (args.waits) return null;
    // One Explosion of a blast on every unit in Range (4.7.6, M21): the unit
    // that blows up stays until each has had its own attack, and which of them
    // have is this seat's to remember (seat.ts SeatMind).
    this.combat.holdProjectile = !!args.hold;
    if (args.blast) {
      const uid = Number(args.uid);
      const actionId = String(args.actionId);
      const held = this.mind.blast && this.mind.blast.uid === uid && this.mind.blast.actionId === actionId ? this.mind.blast.hit : [];
      this.mind.blast = { uid, actionId, hit: [...held, Number(args.targetUid)] };
    }
    if (!this.combat.start(args as unknown as AttackArgs)) return { command: null, why: 'the attacker, its target or its Action is gone' };
    await this.combat.settle();
    return null;
  }

  private async press(args: Record<string, unknown>): Promise<Failed> {
    const went = this.combat.press(String(args.id));
    await this.combat.settle();
    // A press sends through the window, and may send nothing at all (a die
    // picked, a step moved on). Either way the next question is a new one.
    this.landed += 1;
    return went ? null : { command: null, why: 'that control is no longer in the combat window' };
  }

  // A press in the Counter-roll's window (botcontest.ts).
  private async pressContest(args: Record<string, unknown>): Promise<Failed> {
    const went = this.contest.press(String(args.id));
    await this.contest.settle();
    this.landed += 1;
    return went ? null : { command: null, why: 'that control is no longer in the Counter-roll window' };
  }
}
