export interface LangText {
  zh?: string;
  en?: string;
  jp?: string;
}

export interface CardAction {
  id: string;
  name: LangText;
  description?: LangText;
  type?: string;
  speed?: string;
  range?: number;
  storage?: number;
  yellowDice?: number;
  redDice?: number;
  keywords?: { key?: string; en?: string; inline?: string }[];
}

export interface Card {
  id: string;
  name: LangText;
  category: 'mech_part' | 'pilot' | 'drone' | 'projectile' | 'tactics_or_upgrade' | 'unknown';
  type?: string;
  score?: number;
  armor?: number;
  structure?: number;
  parray?: number;
  dodge?: number;
  electronic?: number;
  move?: number;
  stance?: string;
  faction?: string;
  LV?: number;
  swift?: number;
  melee?: number;
  firing?: number;
  movement?: number;
  tactic?: number;
  projectile?: number | string[];
  moveAsFlight?: boolean;
  flyingOrElevated?: string;
  moving?: number;
  trait?: string;
  traitDescription?: LangText;
  keywords: { key?: string; en?: string; inline?: string }[];
  containedIn?: { box: string; quantityPerBox: number }[];
  actions?: CardAction[];
}

export interface TerrainPiece {
  id: string;
  type: 'building' | 'high_wall' | 'low_wall' | 'container';
  subCells: { col: number; row: number }[];
  height: number;
  blocksLos: boolean;
  providesProtection: boolean;
  isFragile: boolean;
}

export interface TerrainData {
  maps: { id: string; name: LangText }[];
  layouts: Record<string, TerrainPiece[]>;
}

// --- dice ---

export type DieColor = 'red' | 'yellow' | 'white' | 'blue' | 'black';

export interface DiceIcon {
  type: string;
  hollow?: boolean;
  part?: string;
}

export interface DiceData {
  dice: Record<DieColor, { sides: number; color: string; role: string; faces: DiceIcon[][] }>;
}

// --- board state ---

export type Facing = 0 | 1 | 2 | 3;
export type Side = 'blue' | 'red';
export type Stance = 'offensive' | 'defensive' | 'mobility' | 'shutdown';
export type PartState = 'intact' | 'damaged' | 'destroyed';

export type PartSlot = 'torso' | 'chasis' | 'leftHand' | 'rightHand' | 'backpack';

export interface MechLoadout {
  torso?: string;
  chasis?: string;
  leftHand?: string;
  rightHand?: string;
  backpack?: string;
  pilot?: string;
}

export interface Token {
  uid: number;
  side: Side;
  kind: 'mech' | 'drone' | 'projectile';
  cardId: string;
  mech?: MechLoadout;
  parentUid?: number;
  droneBackpack?: string;
  label: string;
  col: number;
  row: number;
  size: 1 | 2 | 3;
  facing: Facing;
  aerial: boolean;
  stance: Stance;
  link?: number;
  partStates: Partial<Record<PartSlot | 'main', PartState>>;
  ammo: Record<string, number>;
  log?: LogEntry[];
  statuses?: string[];
}

export interface LogEntry {
  round: number;
  text: string;
}

export interface StatusDef {
  id: string;
  label: string;
  icon: string;
  tint: string;
  note: string;
}

export const STATUSES: StatusDef[] = [
  {
    id: 'fci',
    label: 'Fire Control Interference',
    icon: 'FCI',
    tint: '#c9a6ff',
    note: 'Gained when an enemy Electronic Attack succeeds against this unit (rulebook 4.11). Marks the unit as jammed; see the originating card for what it blocks.',
  },
  {
    id: 'lowProfile',
    label: 'Low Profile',
    icon: 'LP',
    tint: '#9ad9b5',
    note: 'This unit may exchange [Eye] for [Dodge] in Defense rolls against Firing Actions (4.12). Maneuvering, including a facing-only change, removes the token; Scanning also strips it.',
  },
  {
    id: 'interception',
    label: 'Interception used',
    icon: 'INT',
    tint: '#65a2d8',
    note: 'This unit has spent its Interception for the round (4.7.4).',
  },
  {
    id: 'targetTracer',
    label: 'Target Tracer',
    icon: 'TT',
    tint: '#ff8b6b',
    note: 'Drones may target this unit even when it is not the closest enemy, and attack it as if in Offensive Stance.',
  },
  {
    id: 'repaired',
    label: 'Repaired',
    icon: 'REP',
    tint: '#3ddc84',
    note: 'Triangle token: this unit has already been repaired, so it cannot be repaired again.',
  },
  {
    id: 'smoke',
    label: 'In smoke',
    icon: 'SMK',
    tint: '#a6b0bd',
    note: 'Standing in a Smoke Screen. Treat line of sight through the screen per 4.16.',
  },
];

export interface RoundState {
  n: number;
  phase: number;
  firstPlayer: Side;
}

export interface Marker {
  kind: string;
  col: number;
  row: number;
}

export type BattleScale = 'skirmish' | 'standard' | 'large';

export interface ScaleDef {
  id: BattleScale;
  name: string;
  points: number;
  openEnded: boolean;
  note: string;
}

export const SCALES: ScaleDef[] = [
  { id: 'skirmish', name: 'Skirmish', points: 600, openEnded: false, note: 'A small game. Squad total may not exceed 600 points.' },
  { id: 'standard', name: 'Standard', points: 900, openEnded: false, note: 'The usual size. Squad total may not exceed 900 points.' },
  { id: 'large', name: 'Large', points: 1200, openEnded: true, note: 'A big game. Squads start at 1200 points and there is no printed ceiling, so agree one with your opponent.' },
];

export interface GameState {
  v: 3;
  map: string;
  tokens: Token[];
  nextUid: number;
  round: RoundState;
  commandTokens: Record<Side, number>;
  markers?: Marker[];
  removedTerrain?: string[];
  scale?: BattleScale;
  roundLimit?: number;
  sideNames?: Partial<Record<Side, string>>;
  mission?: string | null;
  showZones?: boolean;
  deployLayout?: string | null;
  zoneSet?: string;
}

// --- builder-site squad import ---

export interface ImportedMech {
  name: string;
  loadout: MechLoadout;
}

export interface ImportedSquad {
  name: string;
  faction?: string;
  mechs: ImportedMech[];
  drones: { cardId: string; backpack?: string }[];
  unknownIds: string[];
}
