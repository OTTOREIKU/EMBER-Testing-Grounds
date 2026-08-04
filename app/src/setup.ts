import type { GameState, Side, Token } from './types';

// ---------- pre-game setup (rulebook 3.1.2 and 3.1.4) ----------

export type SetupStage = 'map' | 'roll' | 'side' | 'deploy' | 'done';

export interface SetupState {
  stage: SetupStage;
  // Hits rolled for the table-edge roll, per side. Empty until rolled.
  rolls: Record<Side, number[]>;
  // Which printed board edge each side deploys from, chosen by the First Player.
  edge: Record<Side, 'black' | 'white'>;
  // How many units each side has placed, which is what drives the alternation.
  placed: Record<Side, number>;
}

// The battlefield is fixed once the game starts, so neither player can swap the
// map or the zone overlay between rounds. Only the opening stage may change it.
export function battlefieldLocked(setup: SetupState | null | undefined): boolean {
  return !!setup && setup.stage !== 'map';
}

export function newSetup(): SetupState {
  return {
    stage: 'map',
    rolls: { s1: [], s2: [] },
    edge: { s1: 'white', s2: 'black' },
    placed: { s1: 0, s2: 0 },
  };
}

export function normaliseSetup(raw: unknown): SetupState | null {
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as Partial<SetupState>;
  const base = newSetup();
  const stages: SetupStage[] = ['map', 'roll', 'side', 'deploy', 'done'];
  const nums = (v: unknown): number[] => (Array.isArray(v) ? v.filter((x) => typeof x === 'number') : []);
  const edge = (v: unknown, fallback: 'black' | 'white') => (v === 'black' || v === 'white' ? v : fallback);
  const count = (v: unknown) => (typeof v === 'number' && v >= 0 ? v : 0);
  return {
    stage: stages.includes(s.stage as SetupStage) ? (s.stage as SetupStage) : base.stage,
    rolls: { s1: nums(s.rolls?.s1), s2: nums(s.rolls?.s2) },
    edge: { s1: edge(s.edge?.s1, 'white'), s2: edge(s.edge?.s2, 'black') },
    placed: { s1: count(s.placed?.s1), s2: count(s.placed?.s2) },
  };
}

// The table-edge roll is decided on Hits, so only the Hit icons count. Lightning,
// Eye and blank faces are all worth nothing here.
//
// Nor is a hollow Hit worth anything: the dice legend has hollow icons doing
// nothing until a Stance upgrades them to solid, and no unit has taken a
// Stance when this roll happens — the game has not started. A face can still
// carry two icons and be worth two, which is what makes two dice able to come
// to four.
export function countHits(faces: { type: string; hollow?: boolean }[][]): number {
  let n = 0;
  for (const face of faces) {
    for (const icon of face) {
      if (icon.hollow) continue;
      if (icon.type === 'heavyHit' || icon.type === 'lightHit') n++;
    }
  }
  return n;
}

export function rollTotal(rolls: number[]): number {
  return rolls.reduce((a, b) => a + b, 0);
}

// More Hits wins. The book states no tie procedure, so a tie returns null and
// the guide asks for a re-roll rather than inventing a winner.
export function firstPlayerFrom(s: SetupState): Side | null {
  if (!s.rolls.s1.length || !s.rolls.s2.length) return null;
  const blue = rollTotal(s.rolls.s1);
  const red = rollTotal(s.rolls.s2);
  if (blue === red) return null;
  return blue > red ? 's1' : 's2';
}

export function isDeployed(t: Token): boolean {
  return t.deployed !== false;
}

// A Projectile is not deployed; it arrives when something launches it.
export function deployable(state: GameState, side: Side): Token[] {
  return state.tokens.filter((t) => t.side === side && t.kind !== 'projectile' && !isDeployed(t));
}

export function deploymentComplete(state: GameState): boolean {
  return !deployable(state, 's1').length && !deployable(state, 's2').length;
}

// The First Player places one Unit, then the sides alternate. Once one side has
// placed everything, the other places all of its remaining Units (3.1.4).
export function deployTurn(state: GameState, setup: SetupState): Side | null {
  const first = state.round.firstPlayer;
  const other: Side = first === 's1' ? 's2' : 's1';
  const left = { s1: deployable(state, 's1').length, s2: deployable(state, 's2').length };
  if (!left.s1 && !left.s2) return null;
  if (!left[first]) return other;
  if (!left[other]) return first;
  return setup.placed[first] <= setup.placed[other] ? first : other;
}
