import type { BotGameBody } from './botsend';
import type { MechPreset } from './presets';
import type { SavedSquad } from './squadstore';
import { forgetRoomsAndSecrets } from './devicedata';
// Client for ember-api: accounts today, lobbies and the relay later.
//
// Everything here degrades quietly. The tool is a local-first tabletop and has
// always worked with no server at all, so an unreachable API must leave the
// rest of the app exactly as it was.

export type AccountRole = 'player' | 'admin';

export interface Account {
  id: number;
  username: string;
  displayName: string | null;
  role: AccountRole;
  // Game logging, the player's choice (the account screen): when each switch
  // was turned on, or null while it is off. Off is the start.
  logging?: GameLogging;
}

// OTTO, 2026-10-10: nothing is kept for an account until its player switches
// it on, one switch for games against the computer and one for multiplayer and
// Pad games.
export interface GameLogging {
  computer: string | null;
  games: string | null;
}

export interface RegistrationInfo {
  mode: 'invite_only' | 'closed' | 'open';
  open: boolean;
  inviteRequired: boolean;
}

export interface PasswordAssessment {
  ok: boolean;
  score: 0 | 1 | 2 | 3 | 4;
  issues: string[];
}

// What a squad looked like, as recorded. The category rides along because the
// server has no card database — it is what makes "top pilots" and "top parts"
// separable without teaching the API what a pilot is.
export interface SquadEntry {
  id: string;
  cat: 'mech_part' | 'pilot' | 'drone' | 'projectile' | 'tactics_or_upgrade';
}

// A finished game as the server keeps it (ember-api src/lib/gamerecord.ts): game
// facts only, card ids and no name a player typed (gamelog.ts builds it).
export interface GameReport {
  mode: 'hotseat' | 'online';
  source?: 'match' | 'pad' | 'table' | null;
  // Shared by both players' copies of one match, so the server keeps one game.
  gameKey?: string | null;
  mission?: string | null;
  scale?: string | null;
  map?: string | null;
  season?: boolean | null;
  build?: string | null;
  rounds: number;
  minutes?: number | null;
  ended?: 'rounds' | 'wiped' | 'conceded' | 'called' | null;
  firstSeat?: 's1' | 's2' | null;
  winnerSeat: 's1' | 's2' | null;
  mySeat: 's1' | 's2' | null;
  players: { seat: 's1' | 's2'; faction?: string | null; vp: number; points?: number | null; squad: SquadEntry[] }[];
  detail?: GameDetail | null;
}

export interface GameDetail {
  vpByRound?: { s1: number[]; s2: number[] };
  scored?: string[];
  secondary?: { s1: { id: string | null; paid: boolean }; s2: { id: string | null; paid: boolean } };
  destroyed?: { seat: 's1' | 's2'; card: string; round: number }[];
  tactics?: { seat: 's1' | 's2'; card: string; round: number }[];
  conceded?: 's1' | 's2' | null;
}

// The stats anyone may read (GET /stats/public): a figure only with `min`
// games or more behind it, and no name anywhere.
export interface PublicStats {
  min: number;
  games: number;
  factions: { faction: string; games: number; wins: number; draws: number; againstOthers: number; winsAgainstOthers: number }[];
  matchups: { a: string; b: string; games: number; aWins: number; bWins: number }[];
  cards: Record<string, Record<string, { card: string; games: number; wins: number | null }[]>>;
  squads: { faction: string | null; games: number; wins: number; squad: SquadEntry[] }[];
}

export interface MyRecord {
  record: { played: number; won: number; drawn: number; lost: number };
  recent: { id: number; played_at: string; mission: string | null; rounds: number; seat: string; vp: number; result: 'won' | 'lost' | 'draw' }[];
  reported: number;
}

// Admin-only views. The server refuses these to anyone whose role is not
// admin, so the client's job is only to not offer them.
export interface AdminUser {
  id: number; username: string; display_name: string | null; role: string;
  is_active: boolean; created_at: string; last_login_at: string | null;
  last_seen_at: string | null; locked_until: string | null;
  joined_with: string | null; games: number;
}
export interface AdminInvite {
  id: number; code: string; label: string | null; created_at: string;
  expires_at: string | null; used_at: string | null; used_by: string | null;
  revoked: boolean; status: 'open' | 'used' | 'expired' | 'revoked';
}

export class ApiError extends Error {
  readonly status: number;
  readonly issues: string[];
  // True when the server could not be reached at all, as opposed to reached
  // and refused. The two want very different wording in the UI.
  readonly offline: boolean;

  constructor(message: string, o: { status?: number; issues?: string[]; offline?: boolean } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = o.status ?? 0;
    this.issues = o.issues ?? [];
    this.offline = o.offline ?? false;
  }
}

// The app is served from the apex and the API from the api. subdomain, which
// keeps them same-site so the session cookie can stay SameSite=Lax. Anywhere
// else means a developer machine.
//
// Pure and exported so it can be tested: pointing production at the wrong host
// would fail silently, looking exactly like "the server is down".
export function apiBaseFor(hostname: string, protocol: string): string {
  // Suffix alone would also match a lookalike like notembertg.online, so the
  // apex and its subdomains are matched explicitly.
  if (hostname === 'embertg.online' || hostname.endsWith('.embertg.online')) {
    return 'https://api.embertg.online';
  }
  return `${protocol}//${hostname}:3002`;
}

function defaultBase(): string {
  return apiBaseFor(location.hostname, location.protocol);
}

const CSRF_COOKIE = 'ember_csrf';

function cookieCsrf(): string | null {
  for (const part of document.cookie.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === CSRF_COOKIE) return rest.join('=');
  }
  return null;
}

export class EmberApi {
  readonly base: string;
  private account: Account | null = null;
  private info: RegistrationInfo | null = null;
  // Held from the last sign-in response. The cookie is the real source, but
  // keeping the value avoids depending on cookie visibility across ports.
  private csrf: string | null = null;
  private listeners = new Set<(a: Account | null) => void>();
  private leaving = new Set<() => Promise<void>>();
  private left = new Set<() => void>();

  constructor(base = defaultBase()) {
    this.base = base;
  }

  get user(): Account | null {
    return this.account;
  }

  onChange(fn: (a: Account | null) => void): void {
    this.listeners.add(fn);
  }

  // Run before the server is asked to end the session, while it still works:
  // whatever this device has not yet sent to the account goes now. A hook
  // that throws stops the sign-out, so nothing unsent is wiped.
  beforeSignOut(fn: () => Promise<void>): void {
    this.leaving.add(fn);
  }

  // Run once the server has ended the session: what this device kept for the
  // account is forgotten, so the next person on it does not see it. Never on
  // a page opened with no session - only a sign-out.
  onSignedOut(fn: () => void): void {
    this.left.add(fn);
  }

  private announce(): void {
    for (const fn of this.listeners) fn(this.account);
  }

  private async call<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
    const method = init.method ?? 'GET';
    const headers: Record<string, string> = {};
    if (init.body !== undefined) headers['Content-Type'] = 'application/json';
    if (method !== 'GET') {
      const token = this.csrf ?? cookieCsrf();
      if (token) headers['X-CSRF-Token'] = token;
    }

    let res: Response;
    try {
      res = await fetch(this.base + path, {
        method,
        headers,
        // Without this the session cookie is neither sent nor stored, and
        // every request would look anonymous.
        credentials: 'include',
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
      });
    } catch {
      throw new ApiError('Could not reach the server. It may be offline, or you may be.', { offline: true });
    }

    const text = await res.text();
    let json: unknown = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* not json */ }
    const body = (json ?? {}) as { error?: string; issues?: string[] };

    if (!res.ok) {
      throw new ApiError(body.error ?? 'Something went wrong.', { status: res.status, issues: body.issues ?? [] });
    }
    return json as T;
  }

  private adopt(r: { user: Account; csrfToken?: string }): Account {
    this.account = r.user;
    if (r.csrfToken) this.csrf = r.csrfToken;
    this.announce();
    return r.user;
  }

  // Called once at start-up. Never throws: a missing server simply means
  // signed out, which is the state the app has always run in.
  async refresh(): Promise<Account | null> {
    try {
      const r = await this.call<{ user: Account | null }>('/auth/me');
      this.account = r.user;
    } catch {
      this.account = null;
    }
    this.announce();
    return this.account;
  }

  async registration(): Promise<RegistrationInfo> {
    if (this.info) return this.info;
    this.info = await this.call<RegistrationInfo>('/auth/registration');
    return this.info;
  }

  async passwordCheck(password: string, username?: string): Promise<PasswordAssessment> {
    return this.call<PasswordAssessment>('/auth/password-check', { method: 'POST', body: { password, username } });
  }

  async register(username: string, password: string, inviteCode: string): Promise<Account> {
    const r = await this.call<{ user: Account; csrfToken: string }>('/auth/register', {
      method: 'POST', body: { username, password, inviteCode },
    });
    return this.adopt(r);
  }

  async login(username: string, password: string): Promise<Account> {
    const r = await this.call<{ user: Account; csrfToken: string }>('/auth/login', {
      method: 'POST', body: { username, password },
    });
    return this.adopt(r);
  }

  // Signs out here. The token itself stays good on any other device that
  // holds it, until it expires or logoutEverywhere ends them all.
  async logout(): Promise<void> {
    await this.endSession('/auth/logout');
  }

  // Ends every session the account has, this one included, and its open game
  // connections.
  async logoutEverywhere(): Promise<void> {
    await this.endSession('/auth/logout-all');
  }

  private async endSession(path: string): Promise<void> {
    for (const fn of this.leaving) await fn();
    try {
      await this.call(path, { method: 'POST' });
    } catch {
      // The session cookie is httpOnly, so only the server can end it. A
      // sign-out that never arrived used to be shown as done while the cookie
      // lived on, and the next person to reload was signed in as this player
      // (security audit, 2026-09-30). It is done only when the server says
      // there is no session.
      const still = await this.call<{ user: Account | null }>('/auth/me').then((r) => r.user, () => undefined);
      if (still === undefined) {
        throw new ApiError('Could not reach the server, so you are still signed in. Check the connection and try again.', { offline: true });
      }
      if (still) throw new ApiError('The server did not sign you out, so you are still signed in. Try again.');
    }
    this.forgetHere();
  }

  // Removes the account and everything the server keeps for it. Nothing is
  // sent up first, unlike a sign-out: what this device holds goes with it.
  async deleteAccount(password: string): Promise<void> {
    await this.call('/auth/delete-account', { method: 'POST', body: { password } });
    this.forgetHere();
  }

  private forgetHere(): void {
    this.account = null;
    this.csrf = null;
    for (const fn of this.left) fn();
    forgetRoomsAndSecrets();
    this.announce();
  }

  async recordGame(report: GameReport): Promise<{ id: number }> {
    return this.call<{ id: number }>('/games', { method: 'POST', body: report });
  }

  // Whether the signed-in player keeps this kind of game (the account screen's
  // switches). Signed out, nothing is kept.
  logs(kind: keyof GameLogging): boolean {
    return !!this.account?.logging?.[kind];
  }

  async setLogging(want: Partial<Record<keyof GameLogging, boolean>>): Promise<GameLogging> {
    const logging = await this.call<GameLogging>('/auth/logging', { method: 'PUT', body: want });
    if (this.account) {
      this.account = { ...this.account, logging };
      this.announce();
    }
    return logging;
  }

  // "Delete my logged games": every game this account logged, and its games
  // against the computer. A game the other player logged too stays for them.
  async deleteMyGames(): Promise<{ deleted: number; kept: number; computer: number }> {
    return this.call<{ deleted: number; kept: number; computer: number }>('/games/mine', { method: 'DELETE' });
  }

  async publicStats(): Promise<PublicStats> {
    return this.call<PublicStats>('/stats/public');
  }

  // A game against the computer, kept for its tuning (botlog.ts); never shown.
  async postBotGame(body: BotGameBody): Promise<{ id: number }> {
    return this.call<{ id: number }>('/botgames', { method: 'POST', body });
  }

  // The player's collection on the account; collection.ts owns the store.
  async getInventory(): Promise<{ boxes: Record<string, number>; cards: Record<string, number>; updatedAt: number }> {
    return this.call('/inventory/me');
  }

  async putInventory(boxes: Record<string, number>, cards: Record<string, number>): Promise<{ updatedAt: number }> {
    return this.call('/inventory/me', { method: 'PUT', body: { boxes, cards } });
  }

  // The player's saved units and squads on the account; library.ts owns the sync.
  async getLibrary(): Promise<{ units: MechPreset[]; squads: SavedSquad[]; hidden: string[]; updatedAt: number }> {
    return this.call('/library/me');
  }

  async putLibrary(units: MechPreset[], squads: SavedSquad[], hidden: string[]): Promise<{ updatedAt: number }> {
    return this.call('/library/me', { method: 'PUT', body: { units, squads, hidden } });
  }

  async myRecord(): Promise<MyRecord> {
    return this.call<MyRecord>('/stats/me');
  }

  async adminUsers(): Promise<AdminUser[]> {
    const r = await this.call<{ users: AdminUser[] }>('/admin/users');
    return r.users;
  }

  async adminInvites(): Promise<AdminInvite[]> {
    const r = await this.call<{ invites: AdminInvite[] }>('/admin/invites');
    return r.invites;
  }

  async mintInvites(opts: { label?: string; count?: number; days?: number }): Promise<string[]> {
    const r = await this.call<{ codes: string[] }>('/admin/invites', { method: 'POST', body: opts });
    return r.codes;
  }

  async revokeInvite(id: number): Promise<void> {
    await this.call(`/admin/invites/${id}/revoke`, { method: 'POST' });
  }

  async setUserActive(id: number, active: boolean): Promise<void> {
    await this.call(`/admin/users/${id}/active`, { method: 'POST', body: { active } });
  }

  async changePassword(currentPassword: string, newPassword: string): Promise<void> {
    const r = await this.call<{ ok: true; csrfToken: string }>('/auth/change-password', {
      method: 'POST', body: { currentPassword, newPassword },
    });
    if (r.csrfToken) this.csrf = r.csrfToken;
  }
}
