import { parseTokenPick, removableTokens, shedToken, STATUSES, type GameState, type Side, type Stance, type Token } from './types';
import { alive } from './loop';

// ---------- shape ----------

export interface TacticPick {
  id: string;
  label: string;
  note?: string;
}

export interface TacticCtx {
  maxLink(t: Token): number;
  // White Dwarf Cruise Mode, which no Stance-changing effect touches but a
  // system failure (Ace Strategy additional rules; audit Phase 2, D3).
  // Optional so a context built for the other cards need not supply it.
  cruising?(t: Token): boolean;
}

export interface TacticSpec {
  id: string;
  name: string;
  phase: 'Command' | 'Action' | 'End';
  timing: string;
  targets: 'mech' | 'drone' | 'unit';
  prompt: string;
  none: string;
  // The effect in a sentence. The six cards carry NO description in the card
  // data, so this is the only text either page can show for them.
  text: string;
  // What follows the card's effect: a free Maneuver (276) or a Command Action
  // that costs no token (274). Static per card, so the UI can read them without
  // running apply.
  maneuver?: boolean;
  freeCommand?: boolean;
  eligible(t: Token, s: GameState, ctx: TacticCtx): boolean;
  choices?(t: Token, s: GameState, ctx: TacticCtx): TacticPick[];
  choiceTitle?: string;
  apply(t: Token, s: GameState, ctx: TacticCtx, pick: string | null): string;
}

// ---------- helpers ----------

// One pick per Token worn, split by the face it shows where a stack holds
// both, so the player can take the yellow one and leave the red one that
// comes off at this End Phase anyway. The id carries the face ('fci:yellow'),
// read back by parseTokenPick.
function removable(t: Token): TacticPick[] {
  return removableTokens(t).map((p) => ({
    id: p.id,
    label: p.label,
    note: `${p.shape === 'square' ? 'Square' : 'Hexagon'} Token`,
  }));
}

// The three Stances a player may choose (4.1). Shutdown is never chosen - it is
// what Link 0 does to a Mech - so no card offers it, and a Mech leaving Shutdown
// simply picks from the three.
function stancePicks(t: Token): TacticPick[] {
  const all: Stance[] = ['offensive', 'defensive', 'mobility'];
  return all
    .filter((st) => st !== t.stance)
    .map((st) => ({ id: st, label: st.charAt(0).toUpperCase() + st.slice(1) }));
}

function restoreLink(t: Token, ctx: TacticCtx): number {
  const max = ctx.maxLink(t);
  const now = t.link ?? 0;
  t.link = max ? Math.min(max, now + 1) : now + 1;
  return t.link;
}

// ---------- the six cards ----------

export const TACTIC_SPECS: Record<string, TacticSpec> = {
  '274': {
    id: '274',
    name: 'Additional Instructions',
    phase: 'Command',
    timing: 'Command Phase',
    targets: 'drone',
    prompt: 'Which Drone gets the extra Command Action?',
    none: 'You have no Drones on the board to command.',
    text: "One Ally Drone may take 1 more Command Action this Command Phase without a Command Token being spent on it.",
    freeCommand: true,
    eligible: (t, _s, _c) => t.kind === 'drone' && alive(t),
    apply: (t) => `Additional Instructions: ${t.label} may take 1 more Command Action this phase without spending a Command Token.`,
  },
  '275': {
    id: '275',
    name: 'Battlefield Recovery',
    phase: 'End',
    timing: 'End Phase',
    targets: 'mech',
    prompt: 'Which Mech recovers 1 Link?',
    none: 'No Mech of yours is both out of Shutdown and short of a Link.',
    text: "In the End Phase, one Ally Mech that is not in Shutdown Stance restores 1 Link.",
    eligible: (t, _s, ctx) => {
      if (t.stance === 'shutdown') return false;
      const max = ctx.maxLink(t);
      return !max || (t.link ?? 0) < max;
    },
    apply: (t, _s, ctx) => `Battlefield Recovery: ${t.label} restores 1 Link (now Link ${restoreLink(t, ctx)}).`,
  },
  '276': {
    id: '276',
    name: 'Hit and Run',
    phase: 'Action',
    timing: 'When an Action Opportunity ends',
    targets: 'mech',
    prompt: 'Which Mech Maneuvers?',
    none: 'You have no Mech on the board to Maneuver.',
    text: "As one Ally Mech's Action Opportunity ends, it may make a Maneuver.",
    maneuver: true,
    // A Mech that cannot Maneuver gains nothing from it, so the play is
    // refused rather than spent (ruling I34; audit Phase 6, H5). Immobilized
    // is the one Token that stops a Maneuver (6.3.2); no Maneuver is
    // Unstoppable, since only a Movement Action can be.
    eligible: (t) => t.stance !== 'shutdown' && !(t.statuses ?? []).includes('immobilized'),
    apply: (t) => `Hit and Run: ${t.label} Maneuvers as its Action Opportunity ends.`,
  },
  '277': {
    id: '277',
    name: 'System Repair',
    phase: 'Action',
    timing: 'During an Action Opportunity',
    targets: 'unit',
    prompt: 'Which Unit is repaired?',
    none: 'None of your Units is carrying a Square or Hexagon Token.',
    text: "During an Action Opportunity, remove 1 Square or Hexagon Token from one Ally Unit.",
    eligible: (t) => removable(t).length > 0,
    choices: (t) => removable(t),
    choiceTitle: 'Remove which token?',
    apply: (t, _s, _c, pick) => {
      // Through shedToken, which keeps the red-face markers honest: removing
      // the last Token of a kind used to leave its red marker behind, and the
      // next one of that kind then arrived already red.
      const { statusId, face } = parseTokenPick(pick ?? '');
      if (statusId) shedToken(t, statusId, face);
      const def = STATUSES.find((d) => d.id === statusId);
      return `System Repair: ${def?.label ?? 'a token'}${face ? ` (${face})` : ''} removed from ${t.label}.`;
    },
  },
  '278': {
    id: '278',
    name: 'Tactical Disposition',
    phase: 'Action',
    timing: 'During an Action Opportunity',
    targets: 'mech',
    prompt: 'Which Mech changes Stance?',
    none: 'Every Mech of yours is in Shutdown Stance, and this card cannot touch those.',
    text: "During an Action Opportunity, one Ally Mech that is not in Shutdown Stance changes to another Stance.",
    eligible: (t, _s, ctx) => t.stance !== 'shutdown' && !ctx.cruising?.(t),
    choices: (t) => stancePicks(t),
    choiceTitle: 'Change to which Stance?',
    apply: (t, _s, _c, pick) => {
      const was = t.stance;
      if (pick) t.stance = pick as Stance;
      return `Tactical Disposition: ${t.label} changes Stance from ${was.toUpperCase()} to ${t.stance.toUpperCase()}.`;
    },
  },
  '279': {
    id: '279',
    name: 'Remote Restart',
    phase: 'End',
    timing: 'End Phase',
    targets: 'mech',
    prompt: 'Which Shutdown Mech restarts?',
    none: 'None of your Mechs is in Shutdown Stance.',
    text: "In the End Phase, one Ally Mech in Shutdown Stance changes to a Stance of its choice and restores 1 Link, as a Reboot would (4.1.1).",
    eligible: (t) => t.stance === 'shutdown',
    // A White Dwarf in Cruise Mode "may select only Mobility Stance", as its
    // Reboot does (ruling I33, audit Phase 2 D3; audit Phase 6, H3).
    choices: (t, _s, ctx) => (ctx.cruising?.(t) ? [{ id: 'mobility', label: 'Mobility' }] : stancePicks(t)),
    choiceTitle: 'Restart into which Stance?',
    apply: (t, _s, ctx, pick) => {
      if (pick) t.stance = pick as Stance;
      return `Remote Restart: ${t.label} leaves Shutdown for ${t.stance.toUpperCase()} and restores 1 Link (now Link ${restoreLink(t, ctx)}).`;
    },
  },
};

export function tacticSpec(id: string): TacticSpec | null {
  return TACTIC_SPECS[id] ?? null;
}

export function tacticTargets(spec: TacticSpec, s: GameState, side: Side, ctx: TacticCtx): Token[] {
  // Hit and Run Maneuvers the Mech whose Action Opportunity just ended, and no
  // other (ruling I28; audit Phase 6, H2). A table that records no ending (a
  // free one) offers every Mech, as before.
  const last = spec.maneuver ? s.script?.lastEnded : undefined;
  const ended = last && last.round === s.round.n ? last.uid : undefined;
  return s.tokens.filter(
    (t) =>
      t.side === side
      && alive(t)
      // On the board: a Low Value Drone waiting in a squad list is no target
      // (audit Phase 6, H6).
      && t.deployed !== false
      && (ended === undefined || t.uid === ended)
      && (spec.targets === 'unit' ? t.kind !== 'projectile' : t.kind === spec.targets)
      && spec.eligible(t, s, ctx),
  );
}

// The moment a card's own text names (5.4.2: "at the appropriate time
// according to the description on the Card"), in a guided game; null when it
// is now. The phase alone was checked, so these three were accepted at any
// moment of the Action Phase, the enemy's turn included (audit Phase 6, H2):
// - System Repair and Tactical Disposition, "during the Action Opportunity of
//   an Ally Mech": one held by a Mech of this squad, an Extra one included,
//   never a Drone's activation (ruling I29);
// - Hit and Run, "when the Action Opportunity of an Ally Mech ends": right
//   after it ends, until the next unit starts acting, on that Mech (I28).
// One reader for the command and every door.
export function tacticWindowWhy(spec: TacticSpec, s: GameState, side: Side): string | null {
  const sc = s.script;
  if (spec.id === '277' || spec.id === '278') {
    const o = sc?.opp;
    const holder = o ? s.tokens.find((t) => t.uid === o.uid) : undefined;
    if (!holder || holder.kind !== 'mech' || holder.side !== side) {
      return `${spec.name} is played during the Action Opportunity of one of your Mechs.`;
    }
    return null;
  }
  if (spec.maneuver) {
    const last = sc?.lastEnded;
    const who = last ? s.tokens.find((t) => t.uid === last.uid) : undefined;
    const next = sc?.opp;
    if (!last || last.round !== s.round.n || !who || who.side !== side || who.kind !== 'mech' || (next && next.started && next.uid !== last.uid)) {
      return `${spec.name} is played as one of your Mechs' Action Opportunity ends, on that Mech.`;
    }
    return null;
  }
  return null;
}

// A Tactics Card, once used, is discarded for the rest of the game (FAQ P2;
// audit Phase 6, H1). The round it was played in, or null if it never was: the
// check refuses it, and every door shows it "Used" rather than hiding it.
export function tacticUsedRound(s: GameState, side: Side, id: string): number | null {
  for (const e of s.tacticsPlayed?.[side] ?? []) {
    const at = e.indexOf(':');
    if (at > 0 && e.slice(at + 1) === id) return Number(e.slice(0, at));
  }
  return null;
}

// When a Tactics Card may be played. The card data carries NO actions for these
// six, so reading the moment off `card.actions[0].name` — which both pages used
// to do — always came back empty and the prompt never appeared at all. The
// hand-written spec above is the only place that knows.
export function tacticFitsPhase(id: string, phase: string): boolean {
  return tacticSpec(id)?.phase === phase;
}
