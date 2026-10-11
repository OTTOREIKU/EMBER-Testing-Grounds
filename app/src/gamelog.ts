// A FINISHED GAME, AS IT IS LOGGED (OTTO, 2026-10-10): for a player who
// switched game logging on (the account screen), the Match Centre and the Pad
// log a game by themselves when it ends, and the board when its game is ended.
// GAME FACTS ONLY: card ids (never a name a player typed), factions and points,
// the battlefield and the Tasks, who went first, the score by round and what
// scored it, the units destroyed and the Tactics played and when, how the game
// ended, the app's build. Nothing about the device, the browser or the player.
//
// Some of it is not on the table at the end - the score by round, when each
// unit fell - so a GameTrack watches the game as it goes. A page that did not
// see the battle begin (opened mid-game) sends the end result alone rather than
// a history it only half saw.
import type { GameDetail, GameReport, SquadEntry } from './api';
import type { GameData } from './data';
import { lowValueOf } from './scoring';
import { normaliseSetup } from './setup';
import { gameResult, normaliseTasks } from './tasks';
import type { GameState, Side, Token } from './types';
import { squadAllegiance, tokenCards } from './units';

declare const __BUILD_ID__: string;

const SIDES: Side[] = ['s1', 's2'];
const ROUNDS_MAX = 20;
// The server's own shapes (ember-api src/lib/gamerecord.ts).
const SCORE_KEY = /^[a-z][a-z-]{1,15}(?::[A-Za-z0-9+_-]{1,24}){1,4}$/;
const CARD_ID = /^[A-Za-z0-9][A-Za-z0-9+-]{0,23}$/;

const battleBegun = (state: GameState): boolean => {
  const setup = normaliseSetup(state.setup);
  return !setup || setup.stage === 'done';
};

// Standing, as every scorer reads it: the Torso, or a Drone's main, intact.
const standing = (t: Token): boolean => (t.partStates?.[t.kind === 'mech' ? 'torso' : 'main'] ?? 'intact') !== 'destroyed';

// Whether a squad has no Mech left once the battle is on: one way a Pad game
// is complete (OTTO, 2026-10-10), though the rules run the rounds out (FAQ P21).
export function squadWiped(state: GameState): Side | null {
  if (!battleBegun(state)) return null;
  for (const s of SIDES) {
    if (!state.tokens.some((t) => t.side === s && t.kind === 'mech' && t.deployed !== false && standing(t))) return s;
  }
  return null;
}

interface Kept {
  v: 1;
  key: string | null;
  sawStart: boolean;
  startedAt: number;
  battleAt: number | null;
  firstSeat: Side | null;
  vp: Record<Side, number>;
  vpByRound: Record<Side, number[]>;
  units: [number, Side, string][];
  destroyed: [number, Side, string, number][];
  tacticRounds: Record<Side, number[]>;
  opening: string | null;
}

export class GameTrack {
  private sawStart = false;
  private seen = false;
  private startedAt = Date.now();
  private battleAt: number | null = null;
  private firstSeat: Side | null = null;
  private vp: Record<Side, number> = { s1: 0, s2: 0 };
  private vpByRound: Record<Side, number[]> = { s1: [], s2: [] };
  // Each unit seen standing, with its side and card; each seen gone, with the round.
  private units = new Map<number, [Side, string]>();
  private destroyed = new Map<number, [Side, string, number]>();
  private tacticRounds: Record<Side, number[]> = { s1: [], s2: [] };
  // The table as the battle began: what both players' pages saw alike, the
  // ground of the key their copies of the match share.
  private opening: string | null = null;

  // The table after a command landed (either seat's, or the page's own).
  observe(state: GameState): void {
    if (!battleBegun(state)) {
      // Setting up: the battle's start will be seen. A table set up again after
      // a battle (the match ended, another begun) is a new game.
      if (this.battleAt !== null) this.restart();
      this.sawStart = true;
      this.seen = true;
      return;
    }
    const round = Math.max(1, Math.min(ROUNDS_MAX, state.round?.n ?? 1));
    const tasks = normaliseTasks(state.tasks);
    if (this.battleAt === null) {
      this.battleAt = Date.now();
      this.firstSeat = state.round?.firstPlayer ?? normaliseSetup(state.setup)?.first ?? null;
      this.opening = JSON.stringify([state.map, state.mission ?? null, normaliseSetup(state.setup)?.rolls ?? null,
        state.tokens.filter((t) => t.deployed !== false).map((t) => [t.uid, t.side, t.cardId, t.col, t.row])]);
      // Opened mid-game: what was scored before is taken as it stands, not as this round's.
      if (!this.sawStart) this.vp = { s1: tasks.vp.s1, s2: tasks.vp.s2 };
    }
    this.seen = true;
    for (const s of SIDES) {
      const d = tasks.vp[s] - this.vp[s];
      if (!d) continue;
      const row = this.vpByRound[s];
      while (row.length < round) row.push(0);
      row[round - 1] += d;
      this.vp[s] = tasks.vp[s];
    }
    const up = new Set<number>();
    for (const t of state.tokens) {
      if (t.kind === 'projectile' || t.deployed === false || !standing(t)) continue;
      up.add(t.uid);
      this.units.set(t.uid, [t.side, t.cardId]);
      // Back on the table (an Undo): not destroyed after all.
      this.destroyed.delete(t.uid);
    }
    for (const [uid, [side, card]] of this.units) {
      if (!up.has(uid) && !this.destroyed.has(uid)) this.destroyed.set(uid, [side, card, round]);
    }
    for (const s of SIDES) {
      const played = state.tacticsPlayed?.[s] ?? [];
      const rounds = this.tacticRounds[s];
      rounds.length = Math.min(rounds.length, played.length);
      while (rounds.length < played.length) rounds.push(round);
    }
  }

  private restart(): void {
    this.startedAt = Date.now();
    this.battleAt = null;
    this.firstSeat = null;
    this.vp = { s1: 0, s2: 0 };
    this.vpByRound = { s1: [], s2: [] };
    this.units.clear();
    this.destroyed.clear();
    this.tacticRounds = { s1: [], s2: [] };
    this.opening = null;
  }

  // Whether this page saw the battle from its start: only then is the history
  // whole.
  get whole(): boolean {
    return this.sawStart && this.battleAt !== null;
  }

  get openingBasis(): string | null {
    return this.opening;
  }

  minutes(): number | null {
    if (!this.whole || this.battleAt === null) return null;
    return Math.max(0, Math.min(1440, Math.round((Date.now() - this.battleAt) / 60_000)));
  }

  first(): Side | null {
    return this.firstSeat;
  }

  history(state: GameState): Pick<GameDetail, 'vpByRound' | 'destroyed' | 'tactics'> {
    if (!this.whole) return {};
    const rounds = Math.max(1, Math.min(ROUNDS_MAX, state.round?.n ?? 1));
    const pad = (row: number[]): number[] => [...row, ...Array(Math.max(0, rounds - row.length)).fill(0)].slice(0, ROUNDS_MAX);
    const tactics: NonNullable<GameDetail['tactics']> = [];
    for (const s of SIDES) {
      (state.tacticsPlayed?.[s] ?? []).forEach((card, i) => {
        if (CARD_ID.test(card)) tactics.push({ seat: s, card, round: this.tacticRounds[s][i] ?? rounds });
      });
    }
    return {
      vpByRound: { s1: pad(this.vpByRound.s1), s2: pad(this.vpByRound.s2) },
      destroyed: [...this.destroyed.values()].filter(([, card]) => CARD_ID.test(card)).slice(0, 60)
        .map(([seat, card, round]) => ({ seat, card, round })),
      tactics: tactics.slice(0, 40),
    };
  }

  // Kept for this tab (a reload carries on the same match): the page passes
  // the key the match is known by.
  keep(key: string): void {
    if (!this.seen) return;
    const k: Kept = {
      v: 1, key, sawStart: this.sawStart, startedAt: this.startedAt, battleAt: this.battleAt, firstSeat: this.firstSeat,
      vp: this.vp, vpByRound: this.vpByRound, units: [...this.units].map(([u, [s, c]]) => [u, s, c]),
      destroyed: [...this.destroyed].map(([u, [s, c, r]]) => [u, s, c, r]), tacticRounds: this.tacticRounds, opening: this.opening,
    };
    try { sessionStorage.setItem(TRACK_KEY, JSON.stringify(k)); } catch { /* the track is a nicety */ }
  }

  static resume(key: string): GameTrack {
    const t = new GameTrack();
    try {
      const k = JSON.parse(sessionStorage.getItem(TRACK_KEY) ?? 'null') as Kept | null;
      if (k?.v === 1 && k.key === key) {
        t.sawStart = k.sawStart;
        t.seen = true;
        t.startedAt = k.startedAt;
        t.battleAt = k.battleAt;
        t.firstSeat = k.firstSeat;
        t.vp = k.vp;
        t.vpByRound = k.vpByRound;
        t.units = new Map(k.units.map(([u, s, c]) => [u, [s, c]]));
        t.destroyed = new Map(k.destroyed.map(([u, s, c, r]) => [u, [s, c, r]]));
        t.tacticRounds = k.tacticRounds;
        t.opening = k.opening;
      }
    } catch { /* a fresh track */ }
    return t;
  }
}

const TRACK_KEY = 'ember-gametrack-v1';

// The key both players' copies of one match share, so the server keeps one
// game with each on their own seat: the room and the table as the battle began.
export async function matchKey(room: string, track: GameTrack, state: GameState): Promise<string | null> {
  const basis = track.openingBasis ?? JSON.stringify([state.map, state.mission ?? null, normaliseSetup(state.setup)?.rolls ?? null, state.fielded ?? null]);
  try {
    const bytes = new TextEncoder().encode(`${room}|${basis}`);
    const hash = await crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(hash)].slice(0, 16).map((b) => b.toString(16).padStart(2, '0')).join('');
  } catch {
    return null;
  }
}

// What a squad BROUGHT: the fielded roster (a Mech that died still counts), or
// the table when no roster was kept, and its Tactics hand. Card ids only; the
// category rides along for the stats (api.ts SquadEntry).
export function squadEntries(data: GameData, state: GameState, side: Side, hand: string[]): SquadEntry[] {
  const out: SquadEntry[] = [];
  const push = (id: string): void => {
    const card = data.byId.get(id);
    if (card) out.push({ id, cat: (card.category ?? 'mech_part') as SquadEntry['cat'] });
  };
  const roster = state.fielded?.[side];
  if (roster && Object.keys(roster).length) {
    for (const ids of Object.values(roster)) for (const id of ids) push(id);
  } else {
    for (const t of state.tokens) {
      if (t.side !== side || t.kind === 'projectile') continue;
      for (const { card } of tokenCards(data, t)) push(card.id);
    }
  }
  for (const id of hand) if (data.byId.get(id)) out.push({ id, cat: 'tactics_or_upgrade' });
  // The server caps a squad at 80 entries; no real list comes close.
  return out.slice(0, 80);
}

export interface ReportOpts {
  source: 'match' | 'pad' | 'table';
  mode: 'online' | 'hotseat';
  mySeat: Side | null;
  gameKey: string | null;
  ended: NonNullable<GameReport['ended']> | null;
  // Each side's Tactics hand (the page's own reader: tactichand.ts or the Pad's).
  hands: Record<Side, string[]>;
  // The rounds to report, where the page caps them (the Pad's round limit).
  rounds?: number;
}

export function gameReport(data: GameData, state: GameState, track: GameTrack | null, o: ReportOpts): GameReport {
  const tasks = normaliseTasks(state.tasks);
  const winner = gameResult(tasks, state.tokens, lowValueOf(data)).winner;
  const squads = { s1: squadEntries(data, state, 's1', o.hands.s1), s2: squadEntries(data, state, 's2', o.hands.s2) };
  const points = (entries: SquadEntry[]): number => Math.min(9999, entries.reduce((n, e) => n + (data.byId.get(e.id)?.score ?? 0), 0));
  const paid = (s: Side): boolean => {
    const id = tasks.secondary[s];
    return !!id && tasks.scored.includes(`sec:${s}:${id}`);
  };
  const detail: GameDetail = {
    ...(track?.history(state) ?? {}),
    scored: tasks.scored.filter((k) => SCORE_KEY.test(k)).slice(0, 80),
    secondary: {
      s1: { id: tasks.secondary.s1 ?? null, paid: paid('s1') },
      s2: { id: tasks.secondary.s2 ?? null, paid: paid('s2') },
    },
    conceded: tasks.conceded ?? null,
  };
  const build = typeof __BUILD_ID__ === 'string' && /^[0-9]{8,20}$/.test(__BUILD_ID__) ? __BUILD_ID__ : null;
  return {
    mode: o.mode,
    source: o.source,
    gameKey: o.gameKey,
    mission: state.mission ?? null,
    scale: state.scale ?? null,
    map: state.map || null,
    season: !!state.season,
    build,
    rounds: Math.max(1, Math.min(ROUNDS_MAX, o.rounds ?? state.round.n)),
    minutes: track?.minutes() ?? null,
    ended: o.ended,
    firstSeat: track?.first() ?? null,
    winnerSeat: winner,
    mySeat: o.mySeat,
    players: SIDES.map((side) => ({
      seat: side,
      faction: squadAllegiance(data, state.tokens.filter((t) => t.side === side)).faction,
      vp: Math.max(0, tasks.vp[side]),
      points: points(squads[side]),
      squad: squads[side],
    })),
    detail,
  };
}
