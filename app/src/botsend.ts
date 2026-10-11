// THE COMPUTER'S GAMES ON THEIR WAY TO THE ACCOUNT (botlog.ts makes them), for
// a player who switched that on (the account screen; OTTO, 2026-10-10: off
// until the player chooses). Every log is written to this device first and
// taken off once the server has it, so a game whose page closed, or whose send
// failed, goes the next time a page opens with the same account signed in.
// Nothing is written for a player who is signed out or has the switch off, a
// sign-out leaves none on the device, and switching it off clears them.
//
// Kept apart from botlog.ts so the board, which only sends, does not load the
// game's rules to do it.
import type { Command } from './commands';
import type { Side } from './types';

export type BotGameEnd = 'over' | 'left' | 'restarted';

// One answer the computer gave: n, round, phase, the question's kind, the
// option's id, the policy's rule, and how many options there were. GAME FACTS
// ONLY (OTTO, 2026-10-10): no times (they are the device's), no labels or
// reasons (they can carry a name a player typed).
export interface BotDecision {
  n: number;
  r: number;
  p: number;
  k: string;
  o: string;
  y: string;
  c: number;
}

export interface BotStop {
  r: number;
  p: number;
  s: Side;
  k: 'refused' | 'stuck' | 'taken' | 'given';
}

// What the server takes (ember-api, POST /botgames). Every field is held to a
// bound there; botlog.ts keeps to the same ones.
export interface BotGameBody {
  v: 1;
  build: string | null;
  startedAt: number;
  scenario: string;
  map: string | null;
  mission: string | null;
  opponent: string;
  speed: string;
  human: Side;
  seed: number;
  ended: BotGameEnd;
  winner: Side | null;
  why: string;
  vp: Record<Side, number>;
  conceded: Side | null;
  round: number;
  phase: number;
  // The board as the game stood when the log was made (secrecy.ts
  // boardFingerprint): a game played back from the log must come to the same.
  fp: string;
  stops: BotStop[];
  // Where the page met an error, by the step it was taking: never its words or
  // its stack, which are the browser's.
  errors: { during: string | null }[];
  decisions: BotDecision[];
  commands: { s: Side | 'host'; c: Command }[];
  // Commands left out to keep the log under the server's limit.
  dropped: number;
}

const UNSENT = 'ember-botgames-unsent-v1';
// A few games, kept a fortnight: a log is worth less the older the code that
// played it.
const KEEP = 4;
const KEEP_MS = 14 * 24 * 60 * 60 * 1000;

interface Unsent {
  owner: number;
  at: number;
  body: BotGameBody;
}

function readUnsent(): Unsent[] {
  try {
    const raw = JSON.parse(localStorage.getItem(UNSENT) ?? '[]') as unknown;
    if (!Array.isArray(raw)) return [];
    const now = Date.now();
    return raw.filter((u): u is Unsent => !!u && typeof u === 'object'
      && Number.isSafeInteger((u as Unsent).owner) && typeof (u as Unsent).at === 'number'
      && now - (u as Unsent).at < KEEP_MS && !!(u as Unsent).body && typeof (u as Unsent).body === 'object');
  } catch {
    return [];
  }
}

function writeUnsent(list: Unsent[]): void {
  try {
    if (list.length) localStorage.setItem(UNSENT, JSON.stringify(list.slice(-KEEP)));
    else localStorage.removeItem(UNSENT);
  } catch {
    // Storage full or blocked: the log is dropped rather than anything the
    // player keeps on this device.
  }
}

const same = (a: BotGameBody, b: BotGameBody): boolean => a.startedAt === b.startedAt && a.seed === b.seed;

// Writes a game's log for `owner` to this device; a later log of the same game
// takes the earlier one's place.
export function keepLog(owner: number, body: BotGameBody): void {
  const list = readUnsent().filter((u) => !(u.owner === owner && same(u.body, body)));
  list.push({ owner, at: Date.now(), body });
  writeUnsent(list);
}

// How many logs this device holds for `owner` (for a suite).
export function keptFor(owner: number): number {
  return readUnsent().filter((u) => u.owner === owner).length;
}

// The account side of api.ts this needs.
export interface BotLogApi {
  readonly user: { id: number; logging?: { computer: string | null } } | null;
  postBotGame(body: BotGameBody): Promise<unknown>;
  onChange(fn: (a: { id: number } | null) => void): void;
  beforeSignOut(fn: () => Promise<void>): void;
  onSignedOut(fn: () => void): void;
}

let sending: Promise<void> | null = null;

// Whether the signed-in player keeps their games against the computer.
export function logsComputer(api: Pick<BotLogApi, 'user'>): boolean {
  return !!api.user?.logging?.computer;
}

// Forgets what this device holds for `owner`: the switch is off.
function dropFor(owner: number): void {
  writeUnsent(readUnsent().filter((u) => u.owner !== owner));
}

// Sends the signed-in account's unsent logs, oldest first, and takes each off
// once the server has it. Another account's stay for that account. One the
// server refuses as malformed or too large is dropped: it would be refused
// again. Anything else (no connection, a limit reached) keeps it for later.
export function sendKept(api: BotLogApi): Promise<void> {
  if (sending) return sending;
  sending = (async () => {
    const me = api.user;
    if (!me) return;
    if (!logsComputer(api)) { dropFor(me.id); return; }
    for (const u of readUnsent().filter((x) => x.owner === me.id)) {
      try {
        await api.postBotGame(u.body);
      } catch (err) {
        const status = (err as { status?: number }).status ?? 0;
        // Switched off on another device: nothing kept here goes either.
        if (status === 403) { dropFor(me.id); return; }
        if (status !== 400 && status !== 413) return;
      }
      writeUnsent(readUnsent().filter((x) => !(x.owner === u.owner && same(x.body, u.body))));
    }
  })().finally(() => { sending = null; });
  return sending;
}

// Files a finished game: kept on this device for the signed-in account, then
// sent. Signed out, or with the switch off, nothing is kept.
export function fileLog(api: BotLogApi, body: BotGameBody): Promise<void> {
  const me = api.user;
  if (!me || !logsComputer(api)) return Promise.resolve();
  keepLog(me.id, body);
  // A send already under way read the list before this one was on it.
  return (sending ?? Promise.resolve()).then(() => sendKept(api));
}

// Once per page: whatever is unsent goes when an account is known, and before
// a sign-out; after one, this device keeps none.
export function bindBotLogs(api: BotLogApi): void {
  api.onChange((who) => { if (who) void sendKept(api); });
  // (sendKept also forgets this device's logs for an account that switched off.)
  if (api.user) void sendKept(api);
  // A sign-out never waits long on these, and never fails for them.
  api.beforeSignOut(() => sendKept(api).catch(() => undefined));
  api.onSignedOut(() => writeUnsent([]));
}
