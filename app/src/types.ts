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
  // The number the publisher's own card page is keyed by. For our numeric ids
  // it IS the id; cards held under a serial get theirs from data/qr_ids.json.
  qrId?: number;
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
  // A deployed Barricade (Turtle Shell, the AS3 walls): grounded, blocking,
  // and exempt from Crush and Forced Movement (FAQ E6/M13).
  barricade?: boolean;
  // Whoever last destroyed one of this Mech's Parts: an Integrity-Loss removal
  // in the End Phase credits the kill to them (FAQ P4).
  lastDamagedBy?: { side: Side; uid: number };
  // Parts bearing a Repaired Token (SH-15). The Part STAYS destroyed in
  // partStates - that one choice makes J21 free: no Integrity, no Link back -
  // while its Actions come back to life, and a hit removes it outright with
  // the attack redirecting to the Core (FAQ J23).
  repairedSlots?: string[];
  // Which Mech issued the Command this unit is holding. A Command Token records
  // nothing about where it came from once it is on the Drone, but several cards
  // are worded "when receiving Command from THIS Mech" — the A2 Data Link lets
  // the Drone perform Automatic Actions, the M2 lets it move a grid first — so
  // the issuer has to be remembered. Cleared when the End Phase sweeps the
  // tokens, and rules-bearing, so boardFingerprint carries it.
  commandedBy?: number;
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
  // What the token DOES, in one line, as close to the printed rule as it goes.
  // `note` is the long form and carries our commentary — where the app greys a
  // button, which edge cases bite, how to click it. That belongs in the
  // reference and the panels, not floating over a board where the reader is
  // mid-turn and wants the rule and nothing else.
  rule: string;
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
  rule: 'Each Interception spends one token, and a Part with none left can never Intercept again this game (4.9).',
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
    id: 'command',
    shape: 'round',
    stacking: true,
    appliesTo: ['mech'],
    label: 'Command',
    icon: 'CMD',
    tint: '#d8c07a',
    rule: 'Face-up and ready. Issue it to an Ally Drone, which then acts, or spend it on an Action that consumes one (4.15).',
    note: 'Generated face-up on the Mech at the start of the Command Phase - 1 by default, or the printed number if its Torso has Command Generation X. Issuing takes it from this Mech and lays it FACE-DOWN on a Drone, which immediately gets an Action Opportunity. Tokens may also be reserved deliberately: an Action with Command Coordination X hands them out later in the round, and some Actions consume one outright. Every Command Token comes off in the End Phase (3.7.2).',
  },
  {
    // The same physical token, turned over. It is a separate status rather than
    // a flag on the first because everything that draws a token - the board
    // strip, the squad chips, the popout - then gets the right face for free,
    // and a Mech holding one of each is two entries in the same multiset.
    id: 'commandUsed',
    shape: 'round',
    stacking: true,
    // A Mech bears one it consumed, a Drone bears the one it was issued.
    // Projectiles are never commanded, so the popout has no business offering
    // this row on one.
    appliesTo: ['mech', 'drone'],
    label: 'Command (spent)',
    icon: 'CMD',
    tint: '#7a7a7a',
    rule: 'Face-down, so it can no longer be issued or used (4.15.4). It comes off in the End Phase.',
    note: 'A Command Token lying face-down. On a Drone it is the Command that unit was given: it stays on the card for the rest of the phase and is removed when the Command Phase ends (3.2.3). On a Mech it is one the Mech consumed for an Action, and 4.15.4 is explicit that a face-down token can no longer be issued or used for anything else. Either way the End Phase clears it (3.7.2).',
  },
  {
    id: 'fci',
    decay: 'yellow',
    shape: 'square',
    stacking: true,
    label: 'Fire Control Interference',
    icon: 'FCI',
    tint: '#c9a6ff',
    rule: 'Cannot perform Firing Actions or Interception (6.3.2).',
    note: 'A unit bearing this cannot perform Firing Actions or Interception (rulebook 6.3.2). Gained when an enemy Electronic Attack succeeds against it (4.11). A Projectile that has an Electronic Value is destroyed outright the moment it takes one.',
  },
  {
    id: 'fragile',
    decay: 'yellow',
    shape: 'square',
    label: 'Fragile',
    icon: 'FRG',
    tint: '#f0916b',
    stacking: true,
    rule: 'Each token costs 1 White die on Defense Rolls, and they stack.',
    note: 'Each Fragile Token costs this unit 1 White die on its Defense Rolls, and they stack. Laser Weapon grants one on every hit, and Ion Weapon may exchange Lightning for a Heavy Hit against a unit bearing one. A Defense Roll can never drop below 1 White (4.4.1), so on an Armor 0 unit such as most missiles this often changes nothing except the Ion Weapon trigger.',
  },
  {
    id: 'immobilized',
    decay: 'yellow',
    shape: 'square',
    stacking: true,
    label: 'Immobilized',
    icon: 'IMB',
    tint: '#8fa0b5',
    rule: 'Cannot perform Movement Actions or Maneuver, including changing facing, and rolls no Blue dice on defence (6.3.2).',
    note: 'This unit cannot perform Movement Actions or Maneuver, and that includes changing facing on the spot. It also rolls no Blue dice at all on its Defense Rolls, even in Mobility Stance (rulebook 6.3.2). A Projectile has no Movement Actions to lose, since its card only carries Immediate, Delay and Passive actions, so on a missile this mainly strips the Blue dice it would get from a printed Mobility stance.',
  },
  {
    id: 'camouflage',
    shape: 'state',
    clearsHexagons: true,
    appliesTo: ['mech', 'drone'],
    label: 'Optical Camouflage',
    icon: 'OC',
    tint: '#4fd1c5',
    rule: 'Attacks against it must Scan first or fail; Electronic Value 0 or a dash cannot target it at all (4.12.2).',
    note: 'This unit is in the Optical Camouflage State (4.12.2). On the table its model is swapped for a camouflage model and all Hexagon Tokens come off it. Attacks against it must Scan first or fail, and Electronic Value 0 or a dash cannot target it at all. The marked square is only a suspected position: when Revealed the unit makes Manifestation Movement up to its Stealth value. Not offered on Projectiles: the only two ways in are an Action that activates it or deploying in the state, and Projectiles cannot be placed during the Deployment stage (5.1).',
  },
  {
    id: 'lowProfile',
    appliesTo: ['mech', 'drone'],
    decay: 'green',
    shape: 'hexagon',
    label: 'Low Profile',
    icon: 'LP',
    tint: '#9ad9b5',
    rule: 'Against Firing Attacks, every [Eye] in its Defense Roll counts as a [Dodge] (6.3.3).',
    note: 'Against Firing Attacks this unit counts every [Eye] in its Defense Roll as a [Dodge] (rulebook 6.3.3). Maneuvering, including a facing-only change, removes the token; Scanning also strips it.',
  },
  {
    id: 'highlight',
    appliesTo: ['mech', 'drone'],
    decay: 'yellow',
    shape: 'hexagon',
    label: 'Highlight',
    icon: 'HL',
    tint: '#ffd166',
    rule: 'Any enemy Attack able to target this unit must target it (6.3.3).',
    note: 'This unit counts as having the Highlight keyword (rulebook 6.3.3). Any enemy performing an Attack Action that is able to target it must target it, and cannot pick a different unit with that Attack. Hexagon token, so taking a different one replaces this.',
  },
  {
    id: 'targetTracer',
    appliesTo: ['mech', 'drone'],
    decay: 'yellow',
    shape: 'hexagon',
    label: 'Target Tracer',
    icon: 'TT',
    tint: '#ff8b6b',
    rule: 'Drones may target this unit even when it is not the closest enemy, and attack it as if in Offensive Stance.',
    note: 'Drones may target this unit even when it is not the closest enemy, and attack it as if in Offensive Stance.',
  },
  {
    id: 'repaired',
    shape: 'triangle',
    appliesTo: ['mech'],
    label: 'Repaired',
    icon: 'REP',
    tint: '#3ddc84',
    rule: 'The Part works again, but an Attack on it makes no Defense Roll and Destroys it outright (6.3.1).',
    note: 'Emergency repair of a Destroyed Part. The Part may be used as normal again, but if it is ever the target of an Attack no Defense Roll is made and it is Destroyed immediately (rulebook 6.3.1). Mechs only: they are the only units built from Parts, the attack sequence skips the target-Part step for everything else (4.5.1), and a Destroyed Drone or Projectile leaves the board at once (4.4.4).',
  },
  {
    id: 'smoke',
    shape: 'state',
    label: 'In smoke',
    icon: 'SMK',
    tint: '#a6b0bd',
    rule: 'No line of sight for Firing Actions into or out of this Grid; Melee and Projectile ignore it (4.16).',
    note: 'This unit shares its Grid with a Smoke Screen, so line of sight cannot be established to it or from it for Firing Actions (rulebook 4.16). It cannot be shot at, and it cannot shoot out, in any direction. Melee and Projectile Actions ignore smoke completely, so it can still be hit in melee and it can still launch. Smoke blocks both sides equally no matter who placed it, and Aerial units are no exception.',
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
  // True for a granted Extra Action Opportunity: it interrupts the granter's
  // (FAQ K21/K3) and ending it resumes them instead of marking acted.
  extra?: boolean;
  maneuver: number;
  action: number;
  extras: ExtraTick[];
  maneuvered: boolean;
  moved: boolean;
  started: boolean;
  // M2 Data Link: this Drone used the single grid its Commander's rider grants
  // "before performing Actions", so the move did NOT close its activation. Only
  // one such move is free; a second, or a longer one, spends the activation the
  // ordinary way (2.4.1).
  preMoved?: boolean;
  // Where the unit STOOD before this Opportunity's Maneuver. A Movement is
  // judged at the start and landing grids only (FAQ O11/O15), and the Match
  // Centre judges it from a render-time sweep — long after the board forgot the
  // start. Without this, a unit that walked out of an enemy aura was judged as
  // though it had never been in it. Freeplay keeps its own copy in scope and
  // does not read this; it is recorded for the sweeping readers.
  movedFrom?: { col: number; row: number };
  // A Mech confirms its Stance before it may Maneuver or act (4.1). Set by
  // setStance or reboot while this Opportunity is open; drones never need it,
  // their Stance being printed on the card.
  stanceLocked?: boolean;
  overload: number;
  performed: string[];
  spentExtras: string[];
}

export function newOpportunity(uid: number, timing?: Timing): Opportunity {
  return {
    uid,
    timing,
    extra: undefined,
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
    // A nested Extra Action Opportunity (FAQ K21): its end pops the granter
    // back rather than marking anyone as having acted.
    extra: o.extra === true ? true : undefined,
    maneuver: typeof o.maneuver === 'number' ? o.maneuver : base.maneuver,
    action: typeof o.action === 'number' ? o.action : base.action,
    extras: Array.isArray(o.extras) ? (o.extras as ExtraTick[]).filter((x) => x && typeof x.id === 'string') : [],
    maneuvered: !!o.maneuvered,
    moved: !!o.moved,
    started: !!o.started,
    stanceLocked: o.stanceLocked === true ? true : undefined,
    // This function is a WHITELIST: a field it does not name is silently dropped
    // on every rehydrate, network round trip and rollback. preMoved was added
    // with the M2 Data Link and missed here, so a Drone that had spent its free
    // grid got a fresh one back after a rejoin or a replay.
    preMoved: o.preMoved === true ? true : undefined,
    // Both halves or neither: half a coordinate would put the mover in a Grid
    // it never stood in, which is worse than having no start at all.
    movedFrom: typeof o.movedFrom?.col === 'number' && typeof o.movedFrom?.row === 'number'
      ? { col: o.movedFrom.col, row: o.movedFrom.row }
      : undefined,
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
  // Networked dial secrecy (3.3). Each seat publishes a hash of its Timing
  // Dials before anyone publishes the dials themselves, so the reveal can be
  // simultaneous and neither side can change its mind after seeing the other's.
  // Empty in a hotseat game, where the gate is a screen rather than a wire.
  commits: Partial<Record<Side, string>>;
  // Seats whose dials are now public. Until a seat is in here, the other
  // player's client has never been sent its timings at all.
  revealed: Side[];
  seats: Record<Side, 'local' | 'remote'>;
  opp: Opportunity | null;
  // Opportunities interrupted by a nested Extra one (FAQ K21), resumed in
  // reverse order as the extras end.
  oppStack: Opportunity[];
  intercepts: { uid: number; actionId: string; targetUid: number }[];
  // Reactions a DEFENDER is owed for having been shot at — Emergency Smoke
  // placing Screens (FAQ B7/D10). Shared state for the same reason `counter`
  // is: the attacking client is the one that knows the attack finished, but
  // the Screens are the defender's to place and only their client may send a
  // command for their unit. Under Multi-Target these are flushed together
  // after the LAST sequence, which is the whole of B7.
  // A debt the DEFENDER owes itself after being attacked. `kind` absent means
  // Emergency Smoke -- every debt written before Target Tracing existed, and
  // every one on a saved board.
  reactions: { uid: number; actionId: string; count: number; range: number; kind?: 'smoke' | 'trace' | 'stance' | 'riposte'; fromUid?: number }[];
  // An Electronic Counter-roll in progress (4.11.2). It lives in shared state
  // rather than on one client because BOTH sides roll and either may spend Link
  // to Focus, and a player may only ever send commands for their own units.
  counter: CounterRoll | null;
  endDone: string[];
  // Abilities capped at once per round, keyed `${round}:${ability}:${uid}`.
  // Aster's Link restore is the first; anything else printed "once per round"
  // belongs here rather than in a flag of its own. Pruned each round the way
  // endDone is, so it cannot grow for the length of the game.
  oncePerRound: string[];
  // A rollback one player has asked for and the other has not answered yet.
  // It lives in shared state rather than on one client so both seats see the
  // same ask, and so a reconnect does not lose it. One at a time: a second
  // request while one is open is refused rather than queued.
  rollback: RollbackAsk | null;
  // How many rollbacks this game has agreed to. It names the BRANCH of history
  // being played: each accepted rollback abandons one and starts another, and
  // a command composed against an abandoned branch must be dropped rather than
  // applied to the rewound board.
  //
  // It is a count in shared state rather than a counter in the relay because
  // that is what makes it reach a client which was not here for the rollback.
  // A player joining afterwards receives it inside the checkpoint like any
  // other field, so their first command is stamped with the branch everyone
  // else is on. A transport-side counter starts them at zero and every command
  // they send is dropped by a host they appear to be connected to.
  rollbacks: number;
  // The points the HOST can actually return to, published by it and read by
  // both. Only the host rewinds, so only the host's ring decides what is
  // reachable — and offering a menu built from anyone else's is offering
  // choices that may not exist. Living in shared state rather than travelling
  // as a private message is what makes the check cheap: `rollbackRequest` can
  // simply require its target to be in here, and neither side can be holding a
  // staler copy than the other.
  rollbackCatalog: RollbackPoint[];
  // A defence roll owed by the defender. The attack pipeline runs on the
  // attacker's client, but the defence dice belong to the DEFENDING player —
  // they press the roll, both watch the same faces land, and the answer comes
  // back as a command. Living in shared state rather than inside the helper is
  // also what gives future die-influence effects a home: a Part that removes
  // or rerolls an opponent's die becomes another command against this record,
  // gated by check() on whose die it is.
  combat: DefenseCall | null;
  // What the attacker's combat window currently shows, published so the
  // defending player watches the same attack unfold — the part chosen, the
  // faces as they land, the resolution — instead of learning about it from
  // dice-feed lines. Display only: nothing reads it back into the rules.
  combatView: CombatView | null;
}

// Who is being attacked, by what, and the pool they owe. `faces` null while
// the defender is still rolling; the answering command fills it and the
// attacker's helper consumes it.
export interface DefenseCall {
  attackerUid: number;
  targetUid: number;
  actionId: string;
  white: number;
  blue: number;
  faces: { color: string; face: number }[] | null;
}

// A read-only snapshot of the attacker's combat window, one per open attack.
// Faces are raw die indexes — the mirror draws them with the same dice data —
// and `log` is the helper's narration tail with any markup stripped.
export interface CombatView {
  attackerUid: number;
  targetUid: number;
  actionId: string;
  mode: 'attack' | 'intercept' | 'explosion';
  step: string;
  targetPart: string | null;
  attack: { color: string; face: number }[] | null;
  defense: { color: string; face: number }[] | null;
  log: string[];
  // Where the Focus flow (4.4.1-5) stands, so the defender's mirror can ask
  // their declare and drive their reroll at the right moments.
  focus?: { stage: string; attackerUse: boolean; defenderUse: boolean } | null;
  // KC Armor already declared this attack, so the mirror stops offering it.
  kcUsed?: boolean;
  // Melee Evasion (ZYBP-302): declared already, and whether it may be declared
  // at all — a Parry is on the table, the Part carries it, and a Command Token
  // is there to spend. Judged by the attacker's window, which sees the board.
  evadeUsed?: boolean;
  evadeReady?: boolean;
  dodgeDieUsed?: boolean;
  dodgeDieReady?: boolean;
  // Shield Up / Mobile Defense: the Parts the DEFENDER may take this hit on
  // instead of the one the Black Die found, and where it landed. Present only
  // while that question is open, because it is the defender's to answer and
  // their mirror is the only place the buttons may appear.
  designate?: { from: string; slots: { slot: string; label: string }[] } | null;
}

// A boundary a rollback can return to. `available` false means a die roll has
// sealed it — kept in the list so the offer can grey it out and say why, rather
// than quietly getting shorter.
export interface RollbackPoint {
  round: number;
  phase: number;
  available: boolean;
}

// Rollback targets are ROUND/PHASE boundaries, never command indexes. The two
// clients' undo histories are NOT the same length — setTiming is secret and
// never travels, so a player who set three dials has three snapshots the
// opponent does not — but both agree on when a phase began without being told.
export interface RollbackAsk {
  by: Side;
  round: number;
  phase: number;
  // Shown to the other player so they know what they are agreeing to.
  label: string;
}

export interface CounterRoll {
  initiatorUid: number;
  responderUid: number;
  actionId: string;
  // Rolled faces, submitted by each side for its own unit. Never re-rolled by
  // the receiver; the verdict is derived from these on both clients.
  initRoll: number[] | null;
  respRoll: number[] | null;
  initFocused: boolean;
  respFocused: boolean;
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
    commits: {},
    revealed: [],
    seats: { s1: 'local', s2: 'local' },
    opp: null,
    oppStack: [],
    intercepts: [],
    reactions: [],
    counter: null,
    endDone: [],
    oncePerRound: [],
    rollback: null,
    rollbacks: 0,
    rollbackCatalog: [],
    combat: null,
    combatView: null,
  };
}

// A half-written entry is dropped rather than shown as a choice: every one of
// these is a button that promises to return the board to a named moment.
function normaliseCatalog(raw: unknown): RollbackPoint[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((p): p is RollbackPoint => !!p
      && Number.isSafeInteger((p as RollbackPoint).round)
      && Number.isSafeInteger((p as RollbackPoint).phase))
    .map((p) => ({ round: p.round, phase: p.phase, available: p.available === true }));
}

// A half-written call is dropped: every field below is something a client acts
// on, and an owed defence with no pool or no target is not a question anyone
// can answer.
function normaliseDefenseCall(raw: unknown): DefenseCall | null {
  const c = raw as Partial<DefenseCall> | null | undefined;
  if (!c || typeof c.attackerUid !== 'number' || typeof c.targetUid !== 'number') return null;
  if (typeof c.actionId !== 'string' || typeof c.white !== 'number' || typeof c.blue !== 'number') return null;
  const faces = Array.isArray(c.faces)
    ? c.faces.filter((f) => f && typeof f.color === 'string' && typeof f.face === 'number')
    : null;
  return { attackerUid: c.attackerUid, targetUid: c.targetUid, actionId: c.actionId, white: c.white, blue: c.blue, faces };
}

// Display state, so the bar is lower than the defence call's: uids and a step
// are enough to draw something honest, and junk faces are simply dropped.
function normaliseCombatView(raw: unknown): CombatView | null {
  const v = raw as Partial<CombatView> | null | undefined;
  if (!v || typeof v.attackerUid !== 'number' || typeof v.targetUid !== 'number') return null;
  if (typeof v.actionId !== 'string' || typeof v.step !== 'string') return null;
  const faces = (x: unknown): { color: string; face: number }[] | null =>
    Array.isArray(x) ? x.filter((f) => f && typeof f.color === 'string' && typeof f.face === 'number').slice(0, 40) : null;
  return {
    attackerUid: v.attackerUid,
    targetUid: v.targetUid,
    actionId: v.actionId,
    mode: v.mode === 'intercept' || v.mode === 'explosion' ? v.mode : 'attack',
    step: v.step,
    targetPart: typeof v.targetPart === 'string' ? v.targetPart : null,
    attack: faces(v.attack),
    defense: faces(v.defense),
    log: Array.isArray(v.log) ? v.log.filter((l): l is string => typeof l === 'string').slice(0, 6) : [],
    focus: (() => {
      const f = v.focus as { stage?: unknown; attackerUse?: unknown; defenderUse?: unknown } | null | undefined;
      return f && typeof f.stage === 'string'
        ? { stage: f.stage, attackerUse: !!f.attackerUse, defenderUse: !!f.defenderUse }
        : null;
    })(),
    kcUsed: !!v.kcUsed,
  };
}

function normaliseRollback(raw: unknown): RollbackAsk | null {
  const r = raw as Partial<RollbackAsk> | null | undefined;
  if (!r || typeof r.round !== 'number' || typeof r.phase !== 'number') return null;
  return {
    by: asSide(r.by),
    round: r.round,
    phase: r.phase,
    label: typeof r.label === 'string' ? r.label : '',
  };
}

function normaliseCounter(raw: unknown): CounterRoll | null {
  const c = raw as Partial<CounterRoll> | null | undefined;
  if (!c || typeof c.initiatorUid !== 'number' || typeof c.responderUid !== 'number' || typeof c.actionId !== 'string') return null;
  const faces = (v: unknown): number[] | null =>
    Array.isArray(v) ? v.filter((x): x is number => typeof x === 'number') : null;
  return {
    initiatorUid: c.initiatorUid,
    responderUid: c.responderUid,
    actionId: c.actionId,
    initRoll: faces(c.initRoll),
    respRoll: faces(c.respRoll),
    initFocused: !!c.initFocused,
    respFocused: !!c.respFocused,
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
    commits: s.commits && typeof s.commits === 'object' ? { ...s.commits } : {},
    revealed: Array.isArray(s.revealed) ? s.revealed.filter((x) => x === 's1' || x === 's2') : [],
    seats: { ...base.seats, ...(s.seats ?? {}) },
    opp: normaliseOpportunity(s.opp),
    oppStack: Array.isArray(s.oppStack)
      ? (s.oppStack as unknown[]).map(normaliseOpportunity).filter((x): x is Opportunity => !!x)
      : [],
    intercepts: Array.isArray(s.intercepts)
      ? s.intercepts.filter(
          (x) => x && typeof x.uid === 'number' && typeof x.targetUid === 'number' && typeof x.actionId === 'string',
        )
      : base.intercepts,
    reactions: Array.isArray(s.reactions)
      ? s.reactions.filter(
          (x) => x && typeof x.uid === 'number' && typeof x.actionId === 'string'
            && typeof x.count === 'number' && typeof x.range === 'number'
            // A trace debt with no attacker can never be answered, so it is not
            // carried across a reload as a row that strands the panel.
            && (x.kind !== 'trace' || typeof x.fromUid === 'number'),
        )
      : base.reactions,
    counter: normaliseCounter(s.counter),
    endDone: Array.isArray(s.endDone) ? s.endDone.filter((x) => typeof x === 'string') : base.endDone,
    oncePerRound: Array.isArray(s.oncePerRound) ? s.oncePerRound.filter((x) => typeof x === 'string') : base.oncePerRound,
    rollback: normaliseRollback(s.rollback),
    // Never allowed to go backwards by a bad save: a branch count that shrinks
    // would make this client stamp a branch the others have left behind.
    rollbacks: Number.isSafeInteger(s.rollbacks) && (s.rollbacks as number) > 0 ? (s.rollbacks as number) : base.rollbacks,
    rollbackCatalog: normaliseCatalog(s.rollbackCatalog),
    combat: normaliseDefenseCall(s.combat),
    combatView: normaliseCombatView(s.combatView),
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
  // Lobby only: a seat saying it has finished reading and is happy to start.
  ready?: Partial<Record<Side, boolean>>;
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
  // Every unit each side has fielded, uid -> its card ids, kept even after the
  // unit leaves the board. Only the game record reads it; nothing in the rules
  // does. See rememberFielded in commands.ts for why it has to exist.
  fielded?: Record<Side, Record<string, string[]>>;
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
  // Tactics Cards bought with the squad (5.4). The community builder's files
  // do not carry these, so the list is usually empty — but our own saved
  // squads round-trip through the same shape and theirs must survive.
  tactics: string[];
  unknownIds: string[];
}
