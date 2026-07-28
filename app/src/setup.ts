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
    rolls: { blue: [], red: [] },
    edge: { blue: 'white', red: 'black' },
    placed: { blue: 0, red: 0 },
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
    rolls: { blue: nums(s.rolls?.blue), red: nums(s.rolls?.red) },
    edge: { blue: edge(s.edge?.blue, 'white'), red: edge(s.edge?.red, 'black') },
    placed: { blue: count(s.placed?.blue), red: count(s.placed?.red) },
  };
}

// The table-edge roll is decided on Hits, so only the Hit icons count. Lightning,
// Eye and blank faces are all worth nothing here.
export function countHits(faces: { type: string }[][]): number {
  let n = 0;
  for (const face of faces) for (const icon of face) if (icon.type === 'heavyHit' || icon.type === 'lightHit') n++;
  return n;
}

export function rollTotal(rolls: number[]): number {
  return rolls.reduce((a, b) => a + b, 0);
}

// More Hits wins. The book states no tie procedure, so a tie returns null and
// the guide asks for a re-roll rather than inventing a winner.
export function firstPlayerFrom(s: SetupState): Side | null {
  if (!s.rolls.blue.length || !s.rolls.red.length) return null;
  const blue = rollTotal(s.rolls.blue);
  const red = rollTotal(s.rolls.red);
  if (blue === red) return null;
  return blue > red ? 'blue' : 'red';
}

export function isDeployed(t: Token): boolean {
  return t.deployed !== false;
}

// A Projectile is not deployed; it arrives when something launches it.
export function deployable(state: GameState, side: Side): Token[] {
  return state.tokens.filter((t) => t.side === side && t.kind !== 'projectile' && !isDeployed(t));
}

export function deploymentComplete(state: GameState): boolean {
  return !deployable(state, 'blue').length && !deployable(state, 'red').length;
}

// The First Player places one Unit, then the sides alternate. Once one side has
// placed everything, the other places all of its remaining Units (3.1.4).
export function deployTurn(state: GameState, setup: SetupState): Side | null {
  const first = state.round.firstPlayer;
  const other: Side = first === 'blue' ? 'red' : 'blue';
  const left = { blue: deployable(state, 'blue').length, red: deployable(state, 'red').length };
  if (!left.blue && !left.red) return null;
  if (!left[first]) return other;
  if (!left[other]) return first;
  return setup.placed[first] <= setup.placed[other] ? first : other;
}
