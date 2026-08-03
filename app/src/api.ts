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

export interface GameReport {
  mode: 'hotseat' | 'online';
  mission?: string | null;
  scale?: string | null;
  rounds: number;
  winnerSeat: 's1' | 's2' | null;
  mySeat: 's1' | 's2' | null;
  players: { seat: 's1' | 's2'; faction?: string | null; vp: number; squad: SquadEntry[] }[];
}

export interface MyRecord {
  record: { played: number; won: number; drawn: number; lost: number };
  recent: { id: number; played_at: string; mission: string | null; rounds: number; seat: string; vp: number; result: 'won' | 'lost' | 'draw' }[];
  reported: number;
}

export interface CardStat { card: string; uses: number; wins: number }
export interface FactionStat { faction: string; played: number; wins: number }

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

  constructor(base = defaultBase()) {
    this.base = base;
  }

  get user(): Account | null {
    return this.account;
  }

  onChange(fn: (a: Account | null) => void): void {
    this.listeners.add(fn);
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

  async logout(): Promise<void> {
    try {
      await this.call('/auth/logout', { method: 'POST' });
    } finally {
      // Whatever the server said, this browser is signed out.
      this.account = null;
      this.csrf = null;
      this.announce();
    }
  }

  async recordGame(report: GameReport): Promise<{ id: number }> {
    return this.call<{ id: number }>('/games', { method: 'POST', body: report });
  }

  async myRecord(): Promise<MyRecord> {
    return this.call<MyRecord>('/stats/me');
  }

  async topCards(cat?: SquadEntry['cat'], limit = 10): Promise<CardStat[]> {
    const query = `?limit=${limit}${cat ? `&cat=${cat}` : ''}`;
    const r = await this.call<{ cards: CardStat[] }>(`/stats/cards${query}`);
    return r.cards;
  }

  async factionUsage(): Promise<FactionStat[]> {
    const r = await this.call<{ factions: FactionStat[] }>('/stats/factions');
    return r.factions;
  }

  async changePassword(currentPassword: string, newPassword: string): Promise<void> {
    const r = await this.call<{ ok: true; csrfToken: string }>('/auth/change-password', {
      method: 'POST', body: { currentPassword, newPassword },
    });
    if (r.csrfToken) this.csrf = r.csrfToken;
  }
}
