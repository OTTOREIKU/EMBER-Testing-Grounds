import { STATUSES, type GameState, type Side, type Stance, type Token } from './types';

// ---------- shape ----------

export interface TacticPick {
  id: string;
  label: string;
  note?: string;
}

export interface TacticOutcome {
  log: string;
  maneuver?: boolean;
  freeCommand?: boolean;
}

export interface TacticCtx {
  maxLink(t: Token): number;
}

export interface TacticSpec {
  id: string;
  name: string;
  phase: 'Command' | 'Action' | 'End';
  timing: string;
  targets: 'mech' | 'drone' | 'unit';
  prompt: string;
  none: string;
  eligible(t: Token, s: GameState, ctx: TacticCtx): boolean;
  choices?(t: Token, s: GameState, ctx: TacticCtx): TacticPick[];
  choiceTitle?: string;
  apply(t: Token, s: GameState, ctx: TacticCtx, pick: string | null): TacticOutcome;
}

// ---------- helpers ----------

function alive(t: Token): boolean {
  if (t.kind !== 'mech') return (t.partStates.main ?? 'intact') !== 'destroyed';
  return Object.values(t.partStates).filter((p) => p !== 'destroyed').length > 0;
}

function removable(t: Token): TacticPick[] {
  const held = t.statuses ?? [];
  const seen = new Map<string, number>();
  for (const id of held) seen.set(id, (seen.get(id) ?? 0) + 1);
  const out: TacticPick[] = [];
  for (const [id, n] of seen) {
    const def = STATUSES.find((d) => d.id === id);
    if (!def || (def.shape !== 'square' && def.shape !== 'hexagon')) continue;
    out.push({
      id,
      label: `${def.label}${n > 1 ? ` ×${n}` : ''}`,
      note: `${def.shape === 'square' ? 'Square' : 'Hexagon'} Token`,
    });
  }
  return out;
}

function stancePicks(t: Token): TacticPick[] {
  const all: Stance[] = ['offensive', 'defensive', 'mobility', 'shutdown'];
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
    eligible: (t, _s, _c) => t.kind === 'drone' && alive(t),
    apply: (t) => ({
      log: `Additional Instructions: ${t.label} may take 1 more Command Action this phase without spending a Command Token.`,
      freeCommand: true,
    }),
  },
  '275': {
    id: '275',
    name: 'Battlefield Recovery',
    phase: 'End',
    timing: 'End Phase',
    targets: 'mech',
    prompt: 'Which Mech recovers 1 Link?',
    none: 'No Mech of yours is both out of Shutdown and short of a Link.',
    eligible: (t, _s, ctx) => {
      if (t.stance === 'shutdown') return false;
      const max = ctx.maxLink(t);
      return !max || (t.link ?? 0) < max;
    },
    apply: (t, _s, ctx) => ({ log: `Battlefield Recovery: ${t.label} restores 1 Link (now ⚡${restoreLink(t, ctx)}).` }),
  },
  '276': {
    id: '276',
    name: 'Hit and Run',
    phase: 'Action',
    timing: 'When an Action Opportunity ends',
    targets: 'mech',
    prompt: 'Which Mech Maneuvers?',
    none: 'You have no Mech on the board to Maneuver.',
    eligible: (t) => t.stance !== 'shutdown',
    apply: (t) => ({ log: `Hit and Run: ${t.label} Maneuvers as its Action Opportunity ends.`, maneuver: true }),
  },
  '277': {
    id: '277',
    name: 'System Repair',
    phase: 'Action',
    timing: 'During an Action Opportunity',
    targets: 'unit',
    prompt: 'Which Unit is repaired?',
    none: 'None of your Units is carrying a Square or Hexagon Token.',
    eligible: (t) => removable(t).length > 0,
    choices: (t) => removable(t),
    choiceTitle: 'Remove which token?',
    apply: (t, _s, _c, pick) => {
      const held = [...(t.statuses ?? [])];
      const at = pick ? held.indexOf(pick) : -1;
      if (at >= 0) held.splice(at, 1);
      t.statuses = held;
      const def = STATUSES.find((d) => d.id === pick);
      return { log: `System Repair: ${def?.label ?? 'a token'} removed from ${t.label}.` };
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
    eligible: (t) => t.stance !== 'shutdown',
    choices: (t) => stancePicks(t),
    choiceTitle: 'Change to which Stance?',
    apply: (t, _s, _c, pick) => {
      const was = t.stance;
      if (pick) t.stance = pick as Stance;
      return { log: `Tactical Disposition: ${t.label} changes Stance from ${was.toUpperCase()} to ${t.stance.toUpperCase()}.` };
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
    eligible: (t) => t.stance === 'shutdown',
    choices: (t) => stancePicks(t),
    choiceTitle: 'Restart into which Stance?',
    apply: (t, _s, ctx, pick) => {
      if (pick) t.stance = pick as Stance;
      return {
        log: `Remote Restart: ${t.label} leaves Shutdown for ${t.stance.toUpperCase()} and restores 1 Link (now ⚡${restoreLink(t, ctx)}).`,
      };
    },
  },
};

export function tacticSpec(id: string): TacticSpec | null {
  return TACTIC_SPECS[id] ?? null;
}

export function tacticTargets(spec: TacticSpec, s: GameState, side: Side, ctx: TacticCtx): Token[] {
  return s.tokens.filter(
    (t) =>
      t.side === side
      && alive(t)
      && (spec.targets === 'unit' ? t.kind !== 'projectile' : t.kind === spec.targets)
      && spec.eligible(t, s, ctx),
  );
}
