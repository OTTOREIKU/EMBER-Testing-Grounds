// The undo ledger's VOCABULARY: what each command should be called when a
// human reads a rollback timeline (Undo v2, U1 - see
// Project-Documents/UNDO-V2-PLAN.md).
//
// Labels, not storage. The snapshots themselves stay in history.ts; this file
// turns the command that was about to run into words a player recognises -
// "Maneuver to F4", "Charge spent: right arm" - and says whether that command
// SEALS the timeline (a die result acted on, which a networked rollback must
// never reach past; OTTO's ruling, twice: 2026-08-14 and reaffirmed
// 2026-08-24).
//
// Imports nothing but types, the same discipline history.ts keeps and for the
// same reason: the tests cut this file out and run it as written. Anything
// needing GameData - an Action's printed name, a card title - comes in through
// the optional `names` resolver the caller provides, so the file stays pure
// while the labels stay rich.
import type { GameState, Side } from './types';

export interface LedgerMeta {
  kind: string;
  seat?: Side;
  // What a player reads in the timeline. Never empty and never raw camelCase:
  // every kind gets at least the humanised fallback below.
  label: string;
  // True when this command records a die result being acted on. The catalog
  // floor stops at the most recent sealed entry.
  sealed: boolean;
  // How this command sits in a player-sized UNIT (U2). Computed here rather
  // than from the kind alone because the answer needs the command's own
  // context: a maneuver with `free` or `granted` set is part of the Action
  // that paid for it, while a bare maneuver begins a unit of its own.
  role: LedgerRole;
}

// begin     starts a unit and closes whatever was open (performAction,
//           a paid maneuver, a deployment, a Tactics Card...)
// follow    belongs to the open unit when one is open in the same phase;
//           standing alone it is its own unit - which is exactly right for the
//           dual-use kinds (applyStatus mid-attack vs a hand token edit)
// boundary  phase machinery: closes any open unit and stands alone
// quiet     bookkeeping (mirror frames, catalog publishes): rides the open
//           unit, or stands alone marked quiet so a timeline can skip it
// solo      its own unit, closing whatever was open (the default for any
//           kind not named - a NEW command lands as its own labelled unit
//           rather than being silently glued to a neighbour)
export type LedgerRole = 'begin' | 'follow' | 'boundary' | 'quiet' | 'solo';

const BEGIN = new Set(['performAction', 'deployUnit', 'playTactic', 'launch', 'blink',
  'switchForm', 'transformPart', 'unfold', 'reveal', 'riposte', 'repairPart', 'takeBlackBox',
  'accessTerminal', 'stabilise', 'reboot', 'setCharge', 'startCounterRoll', 'startMatch']);
const FOLLOW = new Set(['answerDefense', 'acceptRoll', 'focus', 'focusAnswer', 'focusReroll',
  'designate', 'designateHit', 'applyPenetration', 'applyStatus', 'removeStatus', 'recordKill',
  'drainLink', 'restoreLink', 'spendAmmo', 'restoreAmmo', 'spendCommand', 'coordinateCommand',
  'kcArmor', 'meleeEvade', 'dodgeEnhance', 'provoke', 'suppress', 'defenseReaction',
  'resolveReaction', 'resolveIntercept', 'spendIntercept', 'restoreIntercept', 'rollCounter',
  'crushSwap', 'forceMove', 'tether', 'disarm', 'destroyTerrain', 'placeSmoke', 'removeSmoke',
  'dissipateSmoke', 'despawn', 'dropBlackBox', 'breakRepaired', 'asterRestore', 'overload',
  'grantExtra', 'layMine', 'attackMode', 'setStance', 'handOver', 'placeInGrid']);
// endOpportunity and passTurn are NOT here although they close units all the
// same (solo closes too): they are a player's own deliberate acts, and "I
// ended my activation too early" is a target the catalog should keep offering
// after the boundary skip (U7) hides the true machinery below.
const BOUNDARY = new Set(['advancePhase', 'setPhase',
  'commitTimings', 'revealTimings', 'lockDials', 'markEndStep', 'finishDeployment',
  'finishTasks', 'pickEdge', 'pickSecondary', 'designateTask', 'lockMap', 'endMatch',
  'resetRounds', 'rollSetup', 'configureTable', 'setMode', 'setStrict', 'setReady',
  'setTactics', 'importSquad', 'award']);
const QUIET = new Set(['setCombatView', 'setRollbackCatalog', 'rollbackRequest',
  'rollbackAnswer', 'callDefense', 'clearDefense', 'clearCounterRoll', 'clearIntercepts',
  // noteRoll: quiet so it rides the open attack (sealing it) and a lone one
  // never becomes a row — but the FLOOR reads raw kinds, so it seals either way.
  'queueReactions', 'queueIntercepts', 'setTiming', 'adjustCommandTokens', 'noteRoll']);

function roleFor(c: AnyCmd): LedgerRole {
  // The context-sensitive case first: a free or granted move rides the Action
  // (Shock Attack's walk, the Stance Change's movement, a Tactics Card's
  // grant) - splitting it off would put a rewind target INSIDE an action.
  if (c.kind === 'maneuver') return c.free || c.granted ? 'follow' : 'begin';
  if (BEGIN.has(c.kind)) return 'begin';
  if (FOLLOW.has(c.kind)) return 'follow';
  if (BOUNDARY.has(c.kind)) return 'boundary';
  if (QUIET.has(c.kind)) return 'quiet';
  return 'solo';
}

// THE ONE CANONICAL SEALED SET. history.ts keeps a private copy because it may
// import nothing but types and the tests run it as written; ledger.test.mjs
// asserts the two sets are IDENTICAL so they cannot drift apart silently.
export const SEALED_KINDS: ReadonlySet<string> = new Set([
  // noteRoll is the roll ITSELF hitting the table (U7 finding, 2026-08-25: a
  // missed attack fired none of the consequence kinds below and its dice were
  // walked back); the rest are die results being ACTED ON.
  'acceptRoll', 'rollSetup', 'noteRoll', 'applyPenetration', 'recordKill', 'resolveIntercept',
]);

// Optional lookups the pages can afford and this file cannot: card and action
// names live in GameData. Every resolver is allowed to return undefined and
// every label has a wording that works without it.
export interface LedgerNames {
  action?(uid: number, actionId: string): string | undefined;
  card?(cardId: string): string | undefined;
}

// Builds the resolver off GameData without importing it: the parameter is
// structural, so this file's imports-nothing-but-types rule holds while the
// pages pass their real data in. Action ids are globally unique across cards
// (they are the card id plus a slot letter), so a flat index by id is enough
// for a LABEL - it does not need to know which unit performed it.
interface NamedThing { id: string; name?: { en?: string; zh?: string } }
export function namesFrom(data: {
  cards: (NamedThing & { actions?: NamedThing[] })[];
  commonActions?: NamedThing[];
}): LedgerNames {
  let actions: Map<string, string> | null = null;
  const nameOf = (x: NamedThing | undefined): string | undefined => x?.name?.en || x?.name?.zh || undefined;
  return {
    action(_uid, actionId) {
      if (!actions) {
        actions = new Map();
        for (const a of data.commonActions ?? []) {
          const n = nameOf(a);
          if (n) actions.set(a.id, n);
        }
        for (const c of data.cards) {
          for (const a of c.actions ?? []) {
            const n = nameOf(a);
            if (n) actions.set(a.id, n);
          }
        }
      }
      return actions.get(actionId);
    },
    card(cardId) {
      return nameOf(data.cards.find((c) => c.id === cardId));
    },
  };
}

// A1..L12, the same reading both boards print. Local on purpose: the page
// helpers that render grid names live in page modules this file must not pull.
function grid(at: { col: number; row: number } | undefined): string {
  if (!at || !Number.isFinite(at.col) || !Number.isFinite(at.row)) return 'the board';
  return `${String.fromCharCode(65 + Math.floor(at.col / 3))}${Math.floor(at.row / 3) + 1}`;
}

function unit(state: GameState, uid: number | undefined): string {
  if (uid === undefined) return 'a unit';
  const t = (state.tokens ?? []).find((x) => x.uid === uid);
  return t?.label || 'a unit';
}

// "adjustCommandTokens" -> "Adjust command tokens". The fallback that makes
// "every kind has a label" true without a 103-entry table nobody would keep
// current.
function humanise(kind: string): string {
  const words = kind.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

type AnyCmd = {
  kind: string;
  seat?: Side;
  uid?: number;
  targetUid?: number;
  actionId?: string;
  cardId?: string;
  slot?: string;
  statusId?: string;
  stacks?: number;
  mode?: string;
  stance?: string;
  to?: { col: number; row: number };
  at?: { col: number; row: number };
  free?: boolean;
  granted?: boolean;
  camo?: boolean;
  n?: number;
  itemId?: string;
};

export function labelFor(cmd: { kind: string }, state: GameState, names?: LedgerNames): LedgerMeta {
  const c = cmd as AnyCmd;
  const who = () => unit(state, c.uid);
  const target = () => unit(state, c.targetUid);
  const act = () => (c.uid !== undefined && c.actionId ? names?.action?.(c.uid, c.actionId) : undefined) ?? 'an Action';
  const card = () => (c.cardId ? names?.card?.(c.cardId) : undefined) ?? 'a card';

  let label: string;
  switch (c.kind) {
    // ---------- the units a timeline is made of ----------
    case 'performAction': label = `${act()} - ${who()}`; break;
    case 'maneuver': label = c.free
      ? `${who()}: free move to ${grid(c.to)}`
      : `${who()}: Maneuver to ${grid(c.to)}`; break;
    case 'deployUnit': label = `${who()} deploys at ${grid(c.to)}${c.camo ? ', hidden' : ''}`; break;
    case 'playTactic': label = `Tactics Card: ${card()}`; break;
    case 'launch': label = `${who()} launches ${card()} to ${grid(c.to)}`; break;
    case 'blink': label = `${who()}: Blink`; break;
    case 'forceMove': label = `${target()} is moved to ${grid(c.to)}`; break;
    case 'crushSwap': label = `${who()}: Crush exchange`; break;
    case 'switchForm': label = `${who()} changes form`; break;
    case 'transformPart': label = `${who()} transforms a Part`; break;
    case 'unfold': label = `${who()} Unfolds`; break;
    case 'reveal': label = `${who()} Reveals`; break;
    case 'riposte': label = `${who()}: Riposte`; break;
    case 'tether': label = `${who()} Tethers ${target()}`; break;
    case 'disarm': label = `${who()} Disarms ${target()}`; break;
    case 'suppress': label = `${who()}: Suppression`; break;
    case 'stabilise': label = `${who()}: Stabilize System`; break;
    case 'reboot': label = `${who()} Reboots`; break;
    case 'layMine': label = `${who()} lays a Mine`; break;
    case 'repairPart': label = c.mode === 'mend' ? `${who()}: Part mended` : `${who()}: Part repaired`; break;
    case 'endOpportunity': label = `${who()} ends its activation`; break;
    case 'passTurn': label = 'Turn passed'; break;

    // ---------- spends and tokens ----------
    case 'setCharge': label = `${who()}: Charge Token ${(c as { on?: boolean }).on ? 'set' : 'spent'}`; break;
    case 'spendCommand': label = `${who()} spends a Command Token`; break;
    case 'coordinateCommand': label = `Command Coordination: ${who()}`; break;
    case 'adjustCommandTokens': label = 'Command Tokens adjusted'; break;
    case 'spendAmmo': label = `${who()}: Ammo spent`; break;
    case 'restoreAmmo': label = `${who()}: Ammo restored`; break;
    case 'drainLink': label = `${target()} loses ${c.n ?? 1} Link`; break;
    case 'restoreLink': label = `${who()} recovers Link`; break;
    case 'applyStatus': label = `${target()} gains ${c.stacks && c.stacks > 1 ? `${c.stacks} ` : 'a '}${c.statusId ?? 'status'} Token${c.stacks && c.stacks > 1 ? 's' : ''}`; break;
    case 'removeStatus': label = `${target()} loses a ${c.statusId ?? 'status'} Token`; break;
    case 'setStance': label = `${who()} switches to ${c.stance ?? 'a new'} Stance`; break;

    // ---------- the board and the missions ----------
    case 'takeBlackBox': label = `${who()} picks up a Black Box`; break;
    case 'dropBlackBox': label = `${who()} drops a Black Box`; break;
    case 'accessTerminal': label = `${who()} accesses a Terminal`; break;
    case 'placeSmoke': label = `Smoke placed at ${grid(c.at)}`; break;
    case 'removeSmoke': label = 'Smoke removed'; break;
    case 'dissipateSmoke': label = 'Smoke dissipates'; break;
    case 'destroyTerrain': label = 'Terrain destroyed'; break;
    case 'despawn': label = `${who()} leaves the board`; break;

    // ---------- phase machinery ----------
    case 'advancePhase': label = 'Next phase'; break;
    case 'setPhase': label = 'Phase set'; break;
    case 'markEndStep': label = 'End Phase step'; break;
    case 'commitTimings': label = 'Timing Dials committed'; break;
    case 'revealTimings': label = 'Timing Dials revealed'; break;
    case 'lockDials': label = 'Timing Dials locked'; break;
    // THE SECRECY GUARD. setTiming is a SECRET command: it snapshots locally
    // and never travels, and its label must not leak the dial through any
    // future surface. Named for THAT reason, not politeness - a catalog entry
    // reading "Centurion sets Melee" before the reveal is a cheat sheet.
    case 'setTiming': label = `${who()}: Timing Dial set`; break;

    // ---------- combat bookkeeping (mostly sealed or invisible) ----------
    case 'acceptRoll': label = 'Dice rolled'; break;
    case 'noteRoll': label = 'Dice hit the table'; break;
    case 'rollSetup': label = 'First Player roll'; break;
    case 'applyPenetration': label = `${target()}: Penetration`; break;
    case 'recordKill': label = `${target()} is destroyed`; break;
    case 'resolveIntercept': label = 'Interception resolved'; break;

    default: label = humanise(c.kind);
  }
  return { kind: c.kind, seat: c.seat, label, sealed: SEALED_KINDS.has(c.kind), role: roleFor(c) };
}

// ---------- U2: folding the ledger into player-sized UNITS ----------
//
// A player thinks in actions, not commands: one attack is performAction plus
// everything the sequence did to the board. A UNIT is a contiguous run of
// entries belonging to one such action, and its START index is the snapshot a
// rewind would name - the board as that action began.
//
// The state machine is deliberately small. A unit is open only after a
// `begin`; `follow` attaches to it; anything else closes it. A follow with
// nothing open stands alone, which is what makes the dual-use kinds honest: an
// applyStatus inside an attack belongs to the attack, the same command from a
// hand edit is its own labelled step. A round or phase change closes the open
// unit even without a boundary command, so a unit can never straddle a phase.
export interface LedgerEntry {
  kind: string;
  // A plain string, because entries come back off stored snapshots where any
  // old value could sit; groupLedger validates and falls back to the kind
  // table rather than trusting it.
  role?: string;
  human?: string;
  // Same defensive widening as role: stored snapshots hold plain strings.
  seat?: string;
  round: number;
  phase: number;
  inPlay?: boolean;
}

export interface LedgerUnit {
  // Indexes into the entry list, inclusive. `start` is the rewind target.
  start: number;
  end: number;
  count: number;
  label: string;
  seat?: string;
  round: number;
  phase: number;
  // A die result was acted on inside this unit: the whole unit is sealed, and
  // so is everything before it (the floor is the CATALOG's job; the flag here
  // is per-unit).
  sealed: boolean;
  // Bookkeeping-only - a timeline may hide it.
  quiet: boolean;
  inPlay: boolean;
  // The OPENING entry's validated role, stamped so the catalog can tell a
  // player action (begin/solo/lone follow) from phase machinery (boundary)
  // without re-deriving the validation groupLedger already did (U7: the pop
  // was listing "Next phase" and "Set ready" beside the real actions).
  role: LedgerRole;
}

export function groupLedger(entries: LedgerEntry[]): LedgerUnit[] {
  const out: LedgerUnit[] = [];
  let open: LedgerUnit | null = null;
  const close = (): void => { open = null; };
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    // Entries recorded before U2 carry no role - and a stored one could be
    // anything, so it is VALIDATED rather than trusted. The kind-only fallback
    // is the same table minus the free/granted nuance, which old snapshots
    // cannot express anyway.
    const role: LedgerRole = e.role === 'begin' || e.role === 'follow' || e.role === 'boundary' || e.role === 'quiet' || e.role === 'solo'
      ? e.role
      : roleFor({ kind: e.kind });
    const sealed = SEALED_KINDS.has(e.kind);
    if (open && (open.round !== e.round || open.phase !== e.phase)) close();
    const attach = open !== null && (role === 'follow' || role === 'quiet');
    if (attach && open) {
      open.end = i;
      open.count++;
      open.sealed = open.sealed || sealed;
      continue;
    }
    const unit: LedgerUnit = {
      start: i,
      end: i,
      count: 1,
      label: e.human || e.kind,
      seat: e.seat,
      round: e.round,
      phase: e.phase,
      sealed,
      quiet: role === 'quiet',
      inPlay: e.inPlay !== false,
      role,
    };
    out.push(unit);
    // Only a begin leaves the door open for followers; a boundary, a solo and
    // a lone follow are complete the moment they land. A lone quiet is closed
    // too - bookkeeping must never adopt the real command that comes next.
    open = role === 'begin' ? unit : null;
  }
  return out;
}
