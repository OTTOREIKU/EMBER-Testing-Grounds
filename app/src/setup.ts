import type { GameState, MechLoadout, Side, Token } from './types';
import type { GameData } from './data';

// ---------- pre-game setup (rulebook 3.1.2 and 3.1.4) ----------

// The order (3.1.2, 3.1.3, 5.2.1; ruling I3): the map, the First Player roll,
// the Main Task and the edge the First Player picks knowing it (`side`), then
// the Tasks step (`tasks`): the Secondaries with the First Player revealing
// first, their targets, and the Black Boxes placed alternately. Then
// deployment. The edge came after the Secondaries, so the First Player picked
// it knowing both of them and every named target (audit Phase 6, A1).
export type SetupStage = 'map' | 'roll' | 'side' | 'tasks' | 'deploy' | 'done';

export interface SetupState {
  stage: SetupStage;
  // Hits rolled for the table-edge roll, per side. Empty until rolled.
  rolls: Record<Side, number[]>;
  // Which printed board edge each side deploys from, chosen by the First Player.
  edge: Record<Side, 'black' | 'white'>;
  // How many units each side has placed, which is what drives the alternation.
  placed: Record<Side, number>;
  // Who won the First Player roll (3.1.2), kept so starting the rounds over
  // returns the token to the roll's winner and not to whoever held it last
  // (audit Phase 6, A8).
  first?: Side;
}

// The battlefield is fixed once the game starts, so neither player can swap the
// map or the zone overlay between rounds. Only the opening stage may change it.
export function battlefieldLocked(setup: SetupState | null | undefined): boolean {
  return !!setup && setup.stage !== 'map';
}

// The Main Task is chosen AFTER the First Player roll and before the edge
// (ruling I3), so the Missions dialog and the zone overlay stay open through
// the roll and the edge pick, and freeze once the edge is picked: the edge
// was chosen knowing them.
export function tasksLocked(setup: SetupState | null | undefined): boolean {
  return !!setup && (setup.stage === 'tasks' || setup.stage === 'deploy' || setup.stage === 'done');
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
  const stages: SetupStage[] = ['map', 'roll', 'side', 'tasks', 'deploy', 'done'];
  const nums = (v: unknown): number[] => (Array.isArray(v) ? v.filter((x) => typeof x === 'number') : []);
  const edge = (v: unknown, fallback: 'black' | 'white') => (v === 'black' || v === 'white' ? v : fallback);
  const count = (v: unknown) => (typeof v === 'number' && v >= 0 ? v : 0);
  return {
    stage: stages.includes(s.stage as SetupStage) ? (s.stage as SetupStage) : base.stage,
    rolls: { s1: nums(s.rolls?.s1), s2: nums(s.rolls?.s2) },
    edge: { s1: edge(s.edge?.s1, 'white'), s2: edge(s.edge?.s2, 'black') },
    placed: { s1: count(s.placed?.s1), s2: count(s.placed?.s2) },
    ...(s.first === 's1' || s.first === 's2' ? { first: s.first } : {}),
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

// Why a Mech could not be deployed as built, or null: 2.2.2 wants a Torso, a
// Chassis and a Left or Right Arm, and 5.1 a Pilot (FAQ P14, P16; ruling I32).
// Only the builder asked, so a file, a saved squad or a preset reached every
// table short of them (audit Phase 6, G3).
export function incompleteMechWhy(loadout: MechLoadout | undefined, label = 'This Mech'): string | null {
  const missing = [
    !loadout?.torso ? 'a Torso' : '',
    !loadout?.chasis ? 'a Chassis' : '',
    !loadout?.leftHand && !loadout?.rightHand ? 'a Left or Right Arm' : '',
  ].filter(Boolean);
  if (missing.length) return `${label} has no ${missing.join(', no ')}. A Mech is deployed with at least a Torso, a Chassis and a Left or Right Arm (2.2.2).`;
  if (!loadout?.pilot) return `${label} has no Pilot. Each Mech in a Squad must be assigned a Pilot (5.1).`;
  return null;
}

export function isDeployed(t: Token): boolean {
  return t.deployed !== false;
}

// A Projectile is not deployed; it arrives when something launches it. Nor is
// a Low Value Drone, printed at 0 points: it "cannot be placed during the
// Deployment stage" (p.82). The Bits, the Delphinium, a Dragonfly, KK9, SU1
// and SU2 arrive when a card puts them down, and every one could be placed at
// setup (audit Phase 5, E2). A squad list may still carry one; it waits.
export function deployable(state: GameState, side: Side, data: GameData): Token[] {
  return state.tokens.filter((t) => t.side === side && t.kind !== 'projectile' && !isDeployed(t)
    && !(!!data && t.kind === 'drone' && (data.byId.get(t.cardId)?.score ?? 0) === 0));
}

export function deploymentComplete(state: GameState, data: GameData): boolean {
  return !deployable(state, 's1', data).length && !deployable(state, 's2', data).length;
}

// The First Player places one Unit, then the sides alternate. Once one side has
// placed everything, the other places all of its remaining Units (3.1.4).
export function deployTurn(state: GameState, setup: SetupState, data: GameData): Side | null {
  const first = state.round.firstPlayer;
  const other: Side = first === 's1' ? 's2' : 's1';
  const left = { s1: deployable(state, 's1', data).length, s2: deployable(state, 's2', data).length };
  if (!left.s1 && !left.s2) return null;
  if (!left[first]) return other;
  if (!left[other]) return first;
  return setup.placed[first] <= setup.placed[other] ? first : other;
}
