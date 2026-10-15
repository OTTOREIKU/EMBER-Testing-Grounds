// THE COMPUTER'S GAMES, KEPT FOR ITS TUNING (OTTO, 2026-10-05: "it will help
// tune the bots and check how they are doing against real opponents ... But
// only if they are signed in"; 2026-10-10: and only if they switch it on, on
// the account screen, with nothing but game facts kept). A game such a player
// plays against the computer goes to the account's server when it ends: how it
// ended, each answer the computer gave, where it stopped, and every command in
// the order it landed, so the game can be played back to the moment something
// went wrong. A game left before its end goes the next time a page opens with
// the same account signed in (botsend.ts).
//
// Nothing is kept or sent for a player who is signed out or has the switch off,
// nor for a game the player only watched, and none of it is shown on the page.
// No name a player typed travels in it (a squad's, a Mech's, a unit renamed),
// nor anything about the device: no times, no error texts. An account deleted
// leaves its games behind without its name; "delete my logged games" deletes
// them (ember-api, routes/botgames.ts and routes/games.ts).
import type { LogEntry } from './ai/driver';
import type { BotDecision, BotGameBody, BotGameEnd, BotStop } from './botsend';
import type { Command } from './commands';
import type { GameData } from './data';
import { gameOver } from './owed';
import { boardFingerprint } from './secrecy';
import { normaliseSetup } from './setup';
import { normaliseTasks } from './tasks';
import type { GameState, Side } from './types';

export { bindBotLogs, fileLog, keepLog, sendKept, type BotGameBody, type BotGameEnd } from './botsend';

declare const __BUILD_ID__: string;

// The game a log describes, as the page set it.
export interface BotGameSpec {
  scenario: string;
  map: string | null;
  mission: string | null;
  opponent: string;
  // The computer's play style (M19, soloask.ts STYLES) and, for the Custom one, its picks (soloask.ts customText).
  style: string;
  custom: string;
  speed: () => string;
  human: Side;
  bot: Side;
  seed: number;
}

// Commands that only draw a window on the other seat's screen: they change
// nothing a game played back needs, and are most of a log's bytes.
const UNLOGGED = new Set<string>(['setCombatView', 'setRollbackCatalog']);

// Under the server's 256 kB body limit, with room to spare.
export const MAX_BYTES = 240_000;
const MAX_DECISIONS = 4000;
const MAX_COMMANDS = 8000;
const MAX_STOPS = 40;

const cut = (s: unknown, n: number): string => {
  const t = typeof s === 'string' ? s : String(s ?? '');
  return t.length > n ? t.slice(0, n) : t;
};

// A command as it is logged: a copy, with the words a player typed taken out
// (a squad's name and its Mechs' names, a unit renamed).
export function loggedCommand(cmd: Command): Command {
  const c = JSON.parse(JSON.stringify(cmd)) as Command & Record<string, unknown>;
  if (c.kind === 'importSquad') {
    delete (c as { name?: string }).name;
    for (const m of c.mechs ?? []) delete (m as { name?: string }).name;
  } else if (c.kind === 'renameUnit') {
    delete (c as { label?: string }).label;
  }
  return c;
}

export class BotLog {
  private readonly commands: { s: Side | 'host'; c: Command }[] = [];
  private readonly decisions: BotDecision[] = [];
  private readonly stops: BotStop[] = [];
  private readonly startedAt = Date.now();
  private overflow = 0;
  // Filed already (kept or sent): a game is filed once.
  filed = false;

  constructor(private readonly o: {
    data: GameData;
    state: () => GameState;
    spec: BotGameSpec;
    // The page's error ring (diagnostics.ts), read when the log is filed: only
    // the step each error came in is kept.
    errors?: () => { during?: string }[];
  }) {}

  private at(): { r: number; p: number } {
    const s = this.o.state();
    return { r: s.round?.n ?? 0, p: s.round?.phase ?? 0 };
  }

  // A command the page sent to set the table, before either seat was held.
  host(cmd: Command): void {
    this.push('host', cmd);
  }

  // A command either seat played, as it landed.
  landed(cmd: Command, seat: Side): void {
    this.push(seat, cmd);
  }

  private push(s: Side | 'host', cmd: Command): void {
    if (UNLOGGED.has(cmd.kind)) return;
    if (this.commands.length >= MAX_COMMANDS) { this.overflow += 1; return; }
    // A copy as it was sent: nothing that holds the command later changes it here.
    this.commands.push({ s, c: loggedCommand(cmd) });
  }

  // The computer's answer to a question, as its driver logged it.
  decided(seat: Side, e: LogEntry): void {
    if (seat !== this.o.spec.bot || this.decisions.length >= MAX_DECISIONS) return;
    this.decisions.push({
      n: e.n, r: e.round, p: e.phase, k: cut(e.kind, 48), o: cut(e.option, 160), y: cut(e.reason, 48), c: e.options,
    });
  }

  // The computer stopped and waited for the player, or the player took its
  // seat for a while, or handed it back.
  stopped(seat: Side, k: BotStop['k'], _why = ''): void {
    if (this.stops.length >= MAX_STOPS) return;
    const { r, p } = this.at();
    this.stops.push({ r, p, s: seat, k });
  }

  // Worth filing when the player leaves: the battle had begun, or the computer
  // stopped on the way to it.
  get begun(): boolean {
    return normaliseSetup(this.o.state().setup)?.stage === 'done' || this.stops.length > 0;
  }

  // The log as the server takes it, the game as it stands now.
  body(ended: BotGameEnd): BotGameBody {
    const { data, spec } = this.o;
    const state = this.o.state();
    const over = gameOver(data, state);
    const { r, p } = this.at();
    const conceded = normaliseTasks(state.tasks).conceded ?? null;
    const errors = (this.o.errors?.() ?? []).slice(-12).map((e) => ({ during: e.during ? cut(e.during, 48) : null }));
    return fitted({
      v: 1,
      build: typeof __BUILD_ID__ === 'string' ? cut(__BUILD_ID__, 20) : null,
      startedAt: this.startedAt,
      scenario: spec.scenario,
      map: spec.map,
      mission: spec.mission,
      opponent: spec.opponent,
      style: spec.style,
      custom: spec.custom,
      speed: spec.speed(),
      human: spec.human,
      seed: spec.seed,
      ended: over.over ? 'over' : ended,
      winner: over.over ? over.winner : null,
      why: cut(over.over ? over.why : '', 200),
      vp: { s1: Math.max(0, over.vp.s1 ?? 0), s2: Math.max(0, over.vp.s2 ?? 0) },
      conceded,
      round: r,
      phase: p,
      fp: boardFingerprint(state),
      stops: this.stops.slice(),
      errors,
      decisions: this.decisions.slice(),
      commands: this.commands.slice(),
      dropped: this.overflow,
    });
  }
}

// Under the size limit: the commands go first (the decisions say what the
// computer did without them), then the oldest decisions.
export function fitted(body: BotGameBody): BotGameBody {
  const size = (b: BotGameBody): number => JSON.stringify(b).length;
  if (size(body) <= MAX_BYTES) return body;
  let out: BotGameBody = { ...body, commands: [], dropped: body.dropped + body.commands.length };
  while (size(out) > MAX_BYTES && out.decisions.length > 50) {
    out = { ...out, decisions: out.decisions.slice(Math.ceil(out.decisions.length / 4)) };
  }
  return out;
}
