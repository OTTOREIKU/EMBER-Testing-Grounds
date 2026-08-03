import type { TaskState } from './tasks';
import type { SetupState } from './setup';

export interface LangText {
  zh?: string;
  en?: string;
  jp?: string;
}

export interface GameRuleEffect {
  type?: string;
  mode?: string;
  status?: string;
  stacks?: number;
  effects?: GameRuleEffect[];
}

export interface CardAction {
  id: string;
  name: LangText;
  description?: LangText;
  type?: string;
  size?: string;
  speed?: 'command' | 'auto' | 'passive';
  range?: number;
  storage?: number;
  yellowDice?: number;
  redDice?: number;
  keywords?: { key?: string; en?: string; inline?: string }[];
  gameRules?: { id?: string; consumesCharge?: boolean; conditions?: { type?: string }[]; effects?: GameRuleEffect[] }[];
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
  description?: LangText;
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
// Squads are identified positionally, not by colour: a squad's colour comes
// from the faction of the units in it. Saved games from before this used 'blue'
// and 'red', which migrateState maps on load.
export type Side = 's1' | 's2';

export const LEGACY_SIDE: Record<string, Side> = { blue: 's1', red: 's2' };

export function asSide(v: unknown, fallback: Side = 's1'): Side {
  if (v === 's1' || v === 's2') return v;
  if (typeof v === 'string' && LEGACY_SIDE[v]) return LEGACY_SIDE[v];
  return fallback;
}
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
  timing?: Timing;
  deployed?: boolean;
  expiring?: string[];
  partStates: Partial<Record<PartSlot | 'main', PartState>>;
  ammo: Record<string, number>;
  intercept?: Record<string, number>;
  charge?: string[];
  log?: LogEntry[];
  statuses?: string[];
}

export interface LogEntry {
  round: number;
  text: string;
}

export type Timing = 'swift' | 'melee' | 'projectile' | 'firing' | 'movement' | 'tactical';

export interface TimingDef {
  id: Timing;
  name: string;
  short: string;
  pilotKey: 'swift' | 'melee' | 'projectile' | 'firing' | 'moving' | 'tactic';
}

export const PHASES = ['Command', 'Planning', 'Action', 'Automatic', 'Delay', 'End'] as const;

export const TIMINGS: TimingDef[] = [
  { id: 'swift', name: 'Swift', short: 'SWF', pilotKey: 'swift' },
  { id: 'melee', name: 'Melee', short: 'MEL', pilotKey: 'melee' },
  { id: 'projectile', name: 'Projectile', short: 'PRJ', pilotKey: 'projectile' },
  { id: 'firing', name: 'Firing', short: 'FIR', pilotKey: 'firing' },
  { id: 'movement', name: 'Movement', short: 'MOV', pilotKey: 'moving' },
  { id: 'tactical', name: 'Tactical', short: 'TAC', pilotKey: 'tactic' },
];

export type TokenShape = 'square' | 'hexagon' | 'triangle' | 'round' | 'state';

export interface StatusDef {
  id: string;
  decay?: 'green' | 'yellow';
  label: string;
  icon: string;
  tint: string;
  note: string;
  shape: TokenShape;
  stacking?: boolean;
  clearsHexagons?: boolean;
  appliesTo?: Token['kind'][];
}

export function statusesFor(kind: Token['kind']): StatusDef[] {
  return STATUSES.filter((s) => !s.appliesTo || s.appliesTo.includes(kind));
}

export const INTERCEPT_DEF: StatusDef = {
  id: 'interception',
  shape: 'round',
  label: 'Interception',
  icon: 'INT',
  tint: '#65a2d8',
  note: 'Intercept X puts X Round Tokens on the Part at Deployment, and they are never restored. Each Interception spends one, and once a Part is empty it cannot Intercept again for the rest of the game (rulebook 4.9). The count here is what the unit has left across all of its Parts.',
};

export const SHAPE_NOTE: Record<TokenShape, string> = {
  square: 'Square Token. A unit may bear any number of these at once.',
  hexagon: 'Hexagon Token. A unit may bear only one, so taking a new one removes the old (2.5.3).',
  triangle: 'Triangle Token. In the physical game this sits on the Part Card, not the unit.',
  round: 'Round Token. In the physical game this sits on the Part Card, not the unit.',
  state: 'Not a token. This is a State the unit is in (2.5.4).',
};

export function hexagonIds(): Set<string> {
  return new Set(STATUSES.filter((s) => s.shape === 'hexagon').map((s) => s.id));
}

export function addStatus(statuses: string[] | undefined, id: string): string[] {
  const def = STATUSES.find((s) => s.id === id);
  let list = [...(statuses ?? [])];
  if (def?.shape === 'hexagon' || def?.clearsHexagons) {
    const hexes = hexagonIds();
    list = list.filter((s) => !hexes.has(s));
  }
  return [...list, id];
}

export function statusCount(statuses: string[] | undefined, id: string): number {
  return (statuses ?? []).filter((s) => s === id).length;
}

export function ageTokens(t: Token): { removed: string[]; flipped: string[] } {
  const statuses = [...(t.statuses ?? [])];
  const removed: string[] = [];
  for (const id of t.expiring ?? []) {
    const at = statuses.indexOf(id);
    if (at >= 0) {
      statuses.splice(at, 1);
      removed.push(id);
    }
  }
  const flipped = statuses.filter((id) => STATUSES.find((d) => d.id === id)?.decay === 'yellow');
  t.statuses = statuses;
  t.expiring = flipped.length ? flipped : undefined;
  return { removed, flipped };
}

export function statusStacks(statuses: string[] | undefined): { def: StatusDef; n: number }[] {
  const out: { def: StatusDef; n: number }[] = [];
  for (const id of statuses ?? []) {
    const found = out.find((x) => x.def.id === id);
    if (found) {
      found.n++;
      continue;
    }
    const def = STATUSES.find((s) => s.id === id);
    if (def) out.push({ def, n: 1 });
  }
  return out;
}

export const STATUSES: StatusDef[] = [
  {
    id: 'fci',
    decay: 'yellow',
    shape: 'square',
    label: 'Fire Control Interference',
    icon: 'FCI',
    tint: '#c9a6ff',
    note: 'A unit bearing this cannot perform Firing Actions or Interception (rulebook 6.3.2). Gained when an enemy Electronic Attack succeeds against it (4.11). A Projectile that has an Electronic Value is destroyed outright the moment it takes one. Firing actions are greyed out in the Details tab while this is on.',
  },
  {
    id: 'fragile',
    decay: 'yellow',
    shape: 'square',
    label: 'Fragile',
    icon: 'FRG',
    tint: '#f0916b',
    stacking: true,
    note: 'Each Fragile Token costs this unit 1 White die on its Defense Rolls, and they stack. Laser Weapon grants one on every hit, and Ion Weapon may exchange Lightning for a Heavy Hit against a unit bearing one. A Defense Roll can never drop below 1 White (4.4.1), so on an Armor 0 unit such as most missiles this often changes nothing except the Ion Weapon trigger. Click to add a token, shift-click or right-click to take one off.',
  },
  {
    id: 'immobilized',
    decay: 'yellow',
    shape: 'square',
    label: 'Immobilized',
    icon: 'IMB',
    tint: '#8fa0b5',
    note: 'This unit cannot perform Movement Actions or Maneuver, and that includes changing facing on the spot. It also rolls no Blue dice at all on its Defense Rolls, even in Mobility Stance (rulebook 6.3.2). Movement actions are greyed out in the Details tab while this is on. Note that a Projectile has no Movement Actions to lose, since its card only carries Immediate, Delay and Passive actions, so on a missile this mainly strips the Blue dice it would get from a printed Mobility stance.',
  },
  {
    id: 'camouflage',
    shape: 'state',
    clearsHexagons: true,
    appliesTo: ['mech', 'drone'],
    label: 'Optical Camouflage',
    icon: 'OC',
    tint: '#4fd1c5',
    note: 'This unit is in the Optical Camouflage State (4.12.2). On the table its model is swapped for a camouflage model and all Hexagon Tokens come off it. Attacks against it must Scan first or fail, and Electronic Value 0 or a dash cannot target it at all. The marked square is only a suspected position: when Revealed the unit makes Manifestation Movement up to its Stealth value. Not offered on Projectiles: the only two ways in are an Action that activates it or deploying in the state, and Projectiles cannot be placed during the Deployment stage (5.1).',
  },
  {
    id: 'lowProfile',
    decay: 'green',
    shape: 'hexagon',
    label: 'Low Profile',
    icon: 'LP',
    tint: '#9ad9b5',
    note: 'Against Firing Attacks this unit counts every [Eye] in its Defense Roll as a [Dodge] (rulebook 6.3.3), which the attack helper applies for you. Maneuvering, including a facing-only change, removes the token; Scanning also strips it.',
  },
  {
    id: 'highlight',
    decay: 'yellow',
    shape: 'hexagon',
    label: 'Highlight',
    icon: 'HL',
    tint: '#ffd166',
    note: 'This unit counts as having the Highlight keyword (rulebook 6.3.3). Any enemy performing an Attack Action that is able to target it must target it, and cannot pick a different unit with that Attack. Hexagon token, so taking a different one replaces this.',
  },
  {
    id: 'targetTracer',
    decay: 'yellow',
    shape: 'hexagon',
    label: 'Target Tracer',
    icon: 'TT',
    tint: '#ff8b6b',
    note: 'Drones may target this unit even when it is not the closest enemy, and attack it as if in Offensive Stance.',
  },
  {
    id: 'repaired',
    shape: 'triangle',
    appliesTo: ['mech'],
    label: 'Repaired',
    icon: 'REP',
    tint: '#3ddc84',
    note: 'Emergency repair of a Destroyed Part. The Part may be used as normal again, but if it is ever the target of an Attack no Defense Roll is made and it is Destroyed immediately (rulebook 6.3.1). Mechs only: they are the only units built from Parts, the attack sequence skips the target-Part step for everything else (4.5.1), and a Destroyed Drone or Projectile leaves the board at once (4.4.4).',
  },
  {
    id: 'smoke',
    shape: 'state',
    label: 'In smoke',
    icon: 'SMK',
    tint: '#a6b0bd',
    note: 'This unit shares its Grid with a Smoke Screen, so line of sight cannot be established to it or from it for Firing Actions (rulebook 4.16). It cannot be shot at, and it cannot shoot out, in any direction. Melee and Projectile Actions ignore smoke completely, so it can still be hit in melee and it can still launch. Smoke blocks both sides equally no matter who placed it, and Aerial units are no exception. Screens placed on the board apply this for you in the attack helper, so use this chip only to note smoke you are tracking by hand.',
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

export interface SmokeScreen {
  col: number;
  row: number;
  side: Side;
}

// A grant may carry a condition. "stationary" is the printed keyword: no
// Movement yet this Action Opportunity. "timing" means the grant only exists
// when the dial is set to the grant's own Timing, which is a condition on
// having the Tick at all rather than on what it may pay for.
export type ExtraTickCheck = 'stationary' | 'timing';

export interface ExtraTick {
  id: string;
  label: string;
  timing?: Timing;
  check?: ExtraTickCheck;
}

export interface Opportunity {
  uid: number;
  timing?: Timing;
  maneuver: number;
  action: number;
  extras: ExtraTick[];
  maneuvered: boolean;
  moved: boolean;
  started: boolean;
  overload: number;
  performed: string[];
  spentExtras: string[];
}

export function newOpportunity(uid: number, timing?: Timing): Opportunity {
  return {
    uid,
    timing,
    maneuver: 1,
    action: 2,
    extras: [],
    maneuvered: false,
    moved: false,
    started: false,
    overload: 0,
    performed: [],
    spentExtras: [],
  };
}

export function normaliseOpportunity(raw: unknown): Opportunity | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Partial<Opportunity>;
  if (typeof o.uid !== 'number') return null;
  const base = newOpportunity(o.uid, o.timing);
  const list = (v: unknown): string[] => (Array.isArray(v) ? (v as string[]).filter((x) => typeof x === 'string') : []);
  return {
    uid: o.uid,
    timing: o.timing,
    maneuver: typeof o.maneuver === 'number' ? o.maneuver : base.maneuver,
    action: typeof o.action === 'number' ? o.action : base.action,
    extras: Array.isArray(o.extras) ? (o.extras as ExtraTick[]).filter((x) => x && typeof x.id === 'string') : [],
    maneuvered: !!o.maneuvered,
    moved: !!o.moved,
    started: !!o.started,
    overload: typeof o.overload === 'number' ? Math.max(0, Math.round(o.overload)) : base.overload,
    performed: list(o.performed),
    spentExtras: list(o.spentExtras),
  };
}

export interface ScriptState {
  turn: Side;
  acted: number[];
  extraOpps: number[];
  commanded: number[];
  freeCommand: number[];
  passed: Side[];
  stage: string;
  mode: 'hotseat' | 'hidden';
  // Teaching explains and warns; the strict tracker refuses illegal commands
  // outright and drops the prose. Same engine, two presentations.
  strict: boolean;
  seats: Record<Side, 'local' | 'remote'>;
  opp: Opportunity | null;
  intercepts: { uid: number; actionId: string; targetUid: number }[];
  endDone: string[];
}

export function newScriptState(firstPlayer: Side): ScriptState {
  return {
    turn: firstPlayer,
    acted: [],
    extraOpps: [],
    commanded: [],
    freeCommand: [],
    passed: [],
    stage: '',
    mode: 'hotseat',
    strict: false,
    seats: { s1: 'local', s2: 'local' },
    opp: null,
    intercepts: [],
    endDone: [],
  };
}

export function normaliseScript(raw: unknown, firstPlayer: Side): ScriptState {
  const base = newScriptState(firstPlayer);
  const s = (raw ?? {}) as Partial<ScriptState>;
  const list = (v: unknown, fallback: number[]): number[] => (Array.isArray(v) ? (v as number[]) : fallback);
  return {
    turn: asSide(s.turn, base.turn),
    acted: list(s.acted, base.acted),
    extraOpps: list(s.extraOpps, base.extraOpps),
    commanded: list(s.commanded, base.commanded),
    freeCommand: list(s.freeCommand, base.freeCommand),
    passed: Array.isArray(s.passed) ? s.passed : base.passed,
    stage: typeof s.stage === 'string' ? s.stage : base.stage,
    mode: s.mode === 'hidden' ? 'hidden' : 'hotseat',
    strict: !!s.strict,
    seats: { ...base.seats, ...(s.seats ?? {}) },
    opp: normaliseOpportunity(s.opp),
    intercepts: Array.isArray(s.intercepts)
      ? s.intercepts.filter(
          (x) => x && typeof x.uid === 'number' && typeof x.targetUid === 'number' && typeof x.actionId === 'string',
        )
      : base.intercepts,
    endDone: Array.isArray(s.endDone) ? s.endDone.filter((x) => typeof x === 'string') : base.endDone,
  };
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
  smoke?: SmokeScreen[];
  script?: ScriptState;
  removedTerrain?: string[];
  scale?: BattleScale;
  roundLimit?: number;
  sideNames?: Partial<Record<Side, string>>;
  mission?: string | null;
  tasks?: TaskState | null;
  scenario?: string | null;
  setup?: SetupState | null;
  showZones?: boolean;
  deployLayout?: string | null;
  zoneSet?: string;
  boardTheme?: string;
  tactics?: Record<Side, string[]>;
  tacticsPlayed?: Record<Side, string[]>;
}

// --- builder-site squad import ---

export interface ImportedMech {
  name?: string;
  loadout: MechLoadout;
}

export interface ImportedSquad {
  name: string;
  faction?: string;
  mechs: ImportedMech[];
  drones: { cardId: string; backpack?: string }[];
  unknownIds: string[];
}
