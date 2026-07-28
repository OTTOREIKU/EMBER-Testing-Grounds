import type { CardAction, ExtraTick, Opportunity, Timing } from './types';

// ---------- tick costs (rulebook 3.4.5) ----------

export type ActionLength = 'short' | 'medium' | 'long';

export interface TickCost {
  maneuver: number;
  action: number;
}

// The card data spells Action Types its own way. Only these six are Timings a
// dial can be set to; Passive, Immediate, Delay and Detonation are not chosen
// and cost nothing.
export const TIMING_OF_TYPE: Record<string, Timing> = {
  Swift: 'swift',
  Melee: 'melee',
  Projectile: 'projectile',
  Firing: 'firing',
  Moving: 'movement',
  Tactic: 'tactical',
};

export const LENGTH_OF_SIZE: Record<string, ActionLength> = { s: 'short', m: 'medium', l: 'long' };

export const LENGTH_NAME: Record<ActionLength, string> = { short: 'Short', medium: 'Medium', long: 'Long' };

export const TICK_COST: Record<ActionLength, TickCost> = {
  short: { maneuver: 0, action: 1 },
  medium: { maneuver: 0, action: 2 },
  long: { maneuver: 1, action: 2 },
};

export const MANEUVER_COST: TickCost = { maneuver: 1, action: 0 };

export const FRESH_POOL = { maneuver: 1, action: 2 };

export function timingOf(a: CardAction): Timing | undefined {
  return a.type ? TIMING_OF_TYPE[a.type] : undefined;
}

// An Action only costs Ticks if it is one a player chooses to perform. Passives
// and the like carry a size in the card data, but it describes their printed
// block rather than a cost.
export function lengthOf(a: CardAction): ActionLength | undefined {
  if (!timingOf(a)) return undefined;
  return a.size ? LENGTH_OF_SIZE[a.size] : undefined;
}

export function costOf(a: CardAction): TickCost | undefined {
  const len = lengthOf(a);
  return len ? TICK_COST[len] : undefined;
}

export function costLabel(cost: TickCost): string {
  const parts: string[] = [];
  if (cost.maneuver) parts.push(`${cost.maneuver} Maneuver Tick`);
  if (cost.action) parts.push(`${cost.action} Action Tick${cost.action === 1 ? '' : 's'}`);
  return parts.join(' + ') || 'no Ticks';
}

// ---------- spending one Action Opportunity ----------

// Base Ticks are spent before Extra Ticks, and the two never pay for one Action
// together (3.4.5). So an Action is on base Ticks only while any base Tick is
// still usable, and on Extra Ticks only once none are. An unspent Maneuver Tick
// does not count: it dies the moment an Action Tick is spent, and an Opportunity
// ends on Ticks "consumed or forfeited" (3.4.4). Counting it as still held would
// lock a Mech out of its Extra Tick for good unless it happened to Maneuver.
export function baseSpent(o: Opportunity): boolean {
  if (o.action > 0) return false;
  return o.maneuver === 0 || !canManeuver(o).ok;
}

export interface TickVerdict {
  ok: boolean;
  why?: string;
  extra?: ExtraTick;
}

export function canManeuver(o: Opportunity): TickVerdict {
  if (o.maneuvered) return { ok: false, why: 'This Mech has already Maneuvered this Action Opportunity.' };
  if (o.maneuver < 1) return { ok: false, why: 'The Maneuver Tick is gone.' };
  // Ticks are consumed in order, so the Maneuver Tick is unusable once an
  // Action Tick has been spent (3.4.5).
  if (o.action < FRESH_POOL.action) {
    return { ok: false, why: 'The Maneuver Tick must be spent before any Action Tick, and an Action has already been performed.' };
  }
  return { ok: true };
}

// Which Extra Tick, if any, could pay for this Action on its own.
function extraFor(o: Opportunity, a: CardAction): ExtraTick | undefined {
  const len = lengthOf(a);
  if (len !== 'short') return undefined;
  const timing = timingOf(a);
  return o.extras.find((x) => !o.spentExtras.includes(x.id) && (!x.timing || x.timing === timing));
}

export function canPerform(o: Opportunity, a: CardAction): TickVerdict {
  const len = lengthOf(a);
  if (!len) return { ok: false, why: 'This is not an Action a Mech performs with Ticks.' };
  const cost = TICK_COST[len];
  const timing = timingOf(a);

  if (baseSpent(o)) {
    const extra = extraFor(o, a);
    if (!extra) {
      return o.extras.length
        ? { ok: false, why: 'No Extra Tick left that can pay for this Action. Extra Ticks pay for one Short Action each, and a typed one only pays for its own Action Type.' }
        : { ok: false, why: 'No Ticks left. The Action Opportunity is over.' };
    }
    return { ok: true, extra };
  }

  // The first Action of an Opportunity is the Starting Action, and its Action
  // Type must match the Timing on the dial (3.4.3).
  if (!o.started && o.timing && timing !== o.timing) {
    return { ok: false, why: `The Starting Action must match the dial. This Mech is set to ${o.timing}, and this is a ${timing ?? 'typeless'} Action.` };
  }
  if (o.performed.includes(a.id)) {
    return { ok: false, why: 'Each Action of a Part can only be performed once per Action Opportunity. Only an Extra Tick may repeat one.' };
  }
  if (len === 'long' && (o.maneuvered || o.maneuver < 1 || o.action < FRESH_POOL.action)) {
    return { ok: false, why: 'A Long Action costs the Maneuver Tick plus both Action Ticks, so it must be the first and only thing this Opportunity, with no Maneuver.' };
  }
  if (cost.action > o.action || cost.maneuver > o.maneuver) {
    return { ok: false, why: `Not enough Ticks left. This Action costs ${costLabel(cost)}.` };
  }
  return { ok: true };
}

export function spendManeuver(o: Opportunity): Opportunity {
  return { ...o, maneuver: Math.max(0, o.maneuver - MANEUVER_COST.maneuver), maneuvered: true };
}

export function spendAction(o: Opportunity, a: CardAction): Opportunity {
  const len = lengthOf(a);
  if (!len) return o;
  const verdict = canPerform(o, a);
  if (verdict.extra) {
    return { ...o, spentExtras: [...o.spentExtras, verdict.extra.id] };
  }
  const cost = TICK_COST[len];
  return {
    ...o,
    maneuver: Math.max(0, o.maneuver - cost.maneuver),
    action: Math.max(0, o.action - cost.action),
    started: true,
    performed: o.performed.includes(a.id) ? o.performed : [...o.performed, a.id],
  };
}

export function ticksLeft(o: Opportunity): number {
  return o.maneuver + o.action + o.extras.filter((x) => !o.spentExtras.includes(x.id)).length;
}

export function opportunityOver(o: Opportunity): boolean {
  return ticksLeft(o) === 0;
}
