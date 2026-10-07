// THE COMPUTER'S GAMES ON THEIR WAY TO THE ACCOUNT (botlog.ts makes them).
// Every log is written to this device first and taken off once the server has
// it, so a game whose page closed, or whose send failed, goes the next time a
// page opens with the same account signed in. Nothing is written for a player
// who is signed out, and a sign-out leaves none on the device.
//
// Kept apart from botlog.ts so the board, which only sends, does not load the
// game's rules to do it.
import type { Command } from './commands';
import type { Side } from './types';

export type BotGameEnd = 'over' | 'left' | 'restarted';

// One answer the computer gave: n, round, phase, the question's kind, the
// option's id and label, the policy's rule and reason, how many options there
// were, how long it thought and how long the whole answer took (ms), and
// whether the page was out of sight meanwhile (its times are then the
// browser's: botlog.ts).
export interface BotDecision {
  n: number;
  r: number;
  p: number;
  k: string;
  o: string;
  l: string;
  y: string;
  w: string;
  c: number;
  t: number;
  ms: number;
  h?: 1;
}

export interface BotStop {
  r: number;
  p: number;
  s: Side;
  k: 'refused' | 'stuck' | 'taken' | 'given';
  why: string;
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
  cores: number | null;
  stops: BotStop[];
  errors: { what: string; during: string | null; stack: string | null }[];
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
  readonly user: { id: number } | null;
  postBotGame(body: BotGameBody): Promise<unknown>;
  onChange(fn: (a: { id: number } | null) => void): void;
  beforeSignOut(fn: () => Promise<void>): void;
  onSignedOut(fn: () => void): void;
}

let sending: Promise<void> | null = null;

// Sends the signed-in account's unsent logs, oldest first, and takes each off
// once the server has it. Another account's stay for that account. One the
// server refuses as malformed or too large is dropped: it would be refused
// again. Anything else (no connection, a limit reached) keeps it for later.
export function sendKept(api: BotLogApi): Promise<void> {
  if (sending) return sending;
  sending = (async () => {
    const me = api.user;
    if (!me) return;
    for (const u of readUnsent().filter((x) => x.owner === me.id)) {
      try {
        await api.postBotGame(u.body);
      } catch (err) {
        const status = (err as { status?: number }).status ?? 0;
        if (status !== 400 && status !== 413) return;
      }
      writeUnsent(readUnsent().filter((x) => !(x.owner === u.owner && same(x.body, u.body))));
    }
  })().finally(() => { sending = null; });
  return sending;
}

// Files a finished game: kept on this device for the signed-in account, then
// sent. Signed out, nothing is kept.
export function fileLog(api: BotLogApi, body: BotGameBody): Promise<void> {
  const me = api.user;
  if (!me) return Promise.resolve();
  keepLog(me.id, body);
  // A send already under way read the list before this one was on it.
  return (sending ?? Promise.resolve()).then(() => sendKept(api));
}

// Once per page: whatever is unsent goes when an account is known, and before
// a sign-out; after one, this device keeps none.
export function bindBotLogs(api: BotLogApi): void {
  api.onChange((who) => { if (who) void sendKept(api); });
  if (api.user) void sendKept(api);
  // A sign-out never waits long on these, and never fails for them.
  api.beforeSignOut(() => sendKept(api).catch(() => undefined));
  api.onSignedOut(() => writeUnsent([]));
}
