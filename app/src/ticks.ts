import type { CardAction, ExtraTick, Opportunity, Stance, Timing } from './types';
import { TIMINGS } from './types';

// Flexible Timing (keyword 灵活时机): "This Action can be used in ADJACENT
// timings as a Starting Action. For example, a Movement Action with this
// Keyword can be used as Starting Action in Firing/Movement/Tactical Timing."
// Adjacency is the printed order of the dial, and it does NOT wrap: the
// example names exactly the two neighbours, and nothing in the glossary joins
// Tactical back round to Swift.
export function timingsAdjacent(a: Timing, b: Timing): boolean {
  const i = TIMINGS.findIndex((x) => x.id === a);
  const j = TIMINGS.findIndex((x) => x.id === b);
  return i >= 0 && j >= 0 && Math.abs(i - j) === 1;
}

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
  // Action Tick has been spent (3.4.5). This asks whether an Action was
  // performed rather than comparing the pool to its usual size, because
  // Overload can put the pool above that size and the comparison would then
  // read a spent Tick as an unspent one.
  if (o.started) {
    return { ok: false, why: 'The Maneuver Tick must be spent before any Action Tick, and an Action has already been performed.' };
  }
  return { ok: true };
}

// A grant's condition is read when the Tick is used, not when the Opportunity
// opens. The Stationary keyword is worded "has not performed any Movement
// during its Action Opportunity before performing this Action", so a Mech that
// has already moved has lost the Tick, and one that has not still holds it.
export function grantHolds(o: Opportunity, x: ExtraTick): boolean {
  if (x.check === 'stationary') return !o.moved;
  if (x.check === 'timing') return !!x.timing && o.timing === x.timing;
  return true;
}

export function whyGrantLapsed(x: ExtraTick): string {
  if (x.check === 'stationary') return `${x.label} needs this Mech to be Stationary, and it has already moved this Action Opportunity.`;
  return `${x.label} is only granted while this Mech acts during the ${x.timing ?? 'matching'} Timing.`;
}

// Which Extra Tick, if any, could pay for this Action on its own.
function extraFor(o: Opportunity, a: CardAction): ExtraTick | undefined {
  const len = lengthOf(a);
  if (len !== 'short') return undefined;
  const timing = timingOf(a);
  return o.extras.find(
    (x) => !o.spentExtras.includes(x.id) && (!x.timing || x.timing === timing) && grantHolds(o, x),
  );
}

// A performed entry is the Action id, or `id@uid` when the Action came from a
// Tarantula's Load. Anything that looks the Action back up has to strip that.
export function actionIdOf(performedKey: string): string {
  const at = performedKey.indexOf('@');
  return at < 0 ? performedKey : performedKey.slice(0, at);
}

// `key` names the PART the Action is being taken from, defaulting to the Action
// itself. Two Carrier Tarantulas lending the same Backpack lend two distinct
// Parts, so a Mech may take that Action once from each without it counting as
// repeated execution (FAQ O7) - the loan's key carries the lender's uid.
export function canPerform(
  o: Opportunity,
  a: CardAction,
  key: string = a.id,
  // Granted by an ally's aura (Tactical Coordination and friends), which only
  // the caller can see — this module is handed an Opportunity, never a board.
  opts: { flexible?: boolean } = {},
): TickVerdict {
  const len = lengthOf(a);
  if (!len) return { ok: false, why: 'This is not an Action a Mech performs with Ticks.' };
  const cost = TICK_COST[len];
  const timing = timingOf(a);

  if (baseSpent(o)) {
    const extra = extraFor(o, a);
    if (!extra) {
      // A grant that would otherwise have paid, and failed only on its own
      // condition, is worth naming. Anything else is the generic shortfall.
      const lapsed = o.extras.find(
        (x) => !o.spentExtras.includes(x.id) && (!x.timing || x.timing === timing) && !grantHolds(o, x),
      );
      if (lapsed && len === 'short') return { ok: false, why: whyGrantLapsed(lapsed) };
      return o.extras.length
        ? { ok: false, why: 'No Extra Tick left that can pay for this Action. Extra Ticks pay for one Short Action each, and a typed one only pays for its own Action Type.' }
        : { ok: false, why: 'No Ticks left. The Action Opportunity is over.' };
    }
    return { ok: true, extra };
  }

  // The first Action of an Opportunity is the Starting Action, and its Action
  // Type must match the Timing on the dial (3.4.3).
  if (!o.started && o.timing && timing !== o.timing) {
    const flexed = opts.flexible && !!timing && timingsAdjacent(timing, o.timing);
    if (!flexed) {
      return {
        ok: false,
        why: `The Starting Action must match the dial. This Mech is set to ${o.timing}, and this is a ${timing ?? 'typeless'} Action.`
          + (opts.flexible ? ' Flexible Timing only reaches the timings either side of the dial.' : ''),
      };
    }
  }
  // The shared Charge Action is the one exception to once-only: each use
  // Charges a different Part, so they count as separate Actions (FAQ H6/H7).
  // A card-printed Charge has its own id per Part and never collides.
  if (o.performed.includes(key) && a.id !== 'COMMON_CHARGE') {
    return { ok: false, why: 'Each Action of a Part can only be performed once per Action Opportunity. Only an Extra Tick may repeat one.' };
  }
  if (len === 'long' && (o.maneuvered || o.maneuver < 1 || o.started)) {
    return { ok: false, why: 'A Long Action costs the Maneuver Tick plus both Action Ticks, so it must be the first and only thing this Opportunity, with no Maneuver.' };
  }
  if (cost.action > o.action || cost.maneuver > o.maneuver) {
    return { ok: false, why: `Not enough Ticks left. This Action costs ${costLabel(cost)}.` };
  }
  return { ok: true };
}

// ---------- Overload (OCSP Overloading Pack, card 090) ----------

// The Pack buys Action Ticks with Link, up to two per Action Opportunity. What
// it grants are ordinary Action Ticks rather than Extra Ticks, so they join the
// base pool: two of them pay for one Medium Action, which no pair of Extra Ticks
// can do, and they are spent before any Extra Tick as usual.
export const OVERLOAD_MAX = 2;

export function canOverload(o: Opportunity, link: number): TickVerdict {
  // Declared at the START of the Action Opportunity, never added mid-way
  // (FAQ K10) — though both Link may be spent in one declaration.
  if (o.started || o.maneuvered) {
    return { ok: false, why: 'Overload is declared at the beginning of the Action Opportunity, before anything is performed (FAQ K10).' };
  }
  if (o.overload >= OVERLOAD_MAX) {
    return { ok: false, why: `Overload is limited to ${OVERLOAD_MAX} Link per Action Opportunity, and both are spent.` };
  }
  // Overload is a voluntary spend, and the last Link can never be spent
  // voluntarily (4.10, FAQ L1).
  if (link < 2) return { ok: false, why: 'Overload consumes Link, and the last Link can never be spent voluntarily (4.10).' };
  return { ok: true };
}

export function spendOverload(o: Opportunity): Opportunity {
  return { ...o, action: o.action + 1, overload: o.overload + 1 };
}

// ---------- Attack Mode (H2-B "Crisis" II, card 547) ----------

// "[Offensive Stance] when this mech gains an Action Opportunity, may gains
// another 1 Action Tick." It sits here beside Overload rather than with the
// Extra Tick grants because it is the SAME class of Tick: an ordinary Action
// Tick joining the base pool, which combines with the base Ticks to pay for a
// Medium Action (FAQ K14) and which does not license repeating an Action
// already performed — a licence K2/K12 give only to Extra Ticks.
//
// The Stance arrives as an argument. This module is handed an Opportunity and
// never a board, exactly as canOverload is handed the Link it may spend.
export function canAttackMode(o: Opportunity, stance: Stance, requires?: Stance): TickVerdict {
  // Banked once and never re-checked, exactly like Overload. The flag lives on
  // the Opportunity, so it must be in the normaliseOpportunity whitelist or a
  // rehydrate hands the Tick back.
  if (o.attackMode) {
    return { ok: false, why: 'This Mech has already taken its extra Action Tick this Action Opportunity.' };
  }
  // Same window Overload is declared in (FAQ K10): the Tick is claimed as the
  // Opportunity opens, before the Mech has committed to anything with it.
  if (o.started || o.maneuvered) {
    return { ok: false, why: 'The extra Action Tick is claimed at the beginning of the Action Opportunity, before anything is performed.' };
  }
  // The card names Offensive Stance, and the Stance is chosen DURING the
  // Opportunity — so this is asked when the player declares, not when the
  // Opportunity was minted, at which point the Mech still held last round's
  // Stance. A bonus whose card names no Stance is unconditional.
  if (requires && stance !== requires) {
    return { ok: false, why: `That Part only adds an Action Tick in ${requires} Stance, and this Mech is in ${stance} Stance.` };
  }
  return { ok: true };
}

// Ordinary Action Ticks, into the base pool. The Stance lock that pays for this
// is applied by the command, beside every other place the 4.1 lock is set.
export function spendAttackMode(o: Opportunity, points = 1): Opportunity {
  return { ...o, action: o.action + points, attackMode: true };
}

// Maneuvering is Movement, and the Stationary keyword counts a change of facing
// as Movement too, which a Maneuver may be on its own.
export function spendManeuver(o: Opportunity): Opportunity {
  return { ...o, maneuver: Math.max(0, o.maneuver - MANEUVER_COST.maneuver), maneuvered: true, moved: true };
}

// ---------- a Drone's activation (2.4.1) ----------
//
// A Mech buys its Actions with Ticks. A Drone or a Projectile has none: its
// activation buys **one Action or one Movement, never both**. So the same
// Opportunity object is read a second way for them — `maneuvered` closes off
// the Movement, `started` closes off the Actions, and either one closes both.
//
// This cannot be told from the Action alone, because a Mech's Passives are also
// length-less and must not eat its whole Opportunity. The caller knows the unit;
// it has to be the one to ask.

export function canActivate(o: Opportunity): TickVerdict {
  if (o.maneuvered) return { ok: false, why: 'It has already moved this activation, and it may move or act, not both (2.4.1).' };
  if (o.started) return { ok: false, why: 'It has already acted this activation.' };
  return { ok: true };
}

// `started`, not `maneuvered`: both close the activation either way, but only
// one of them is true, and the refusal quotes whichever it finds. Setting both
// made a Drone that had just fired be told it had already moved.
export function spendActivation(o: Opportunity, a: CardAction): Opportunity {
  return {
    ...o,
    maneuver: 0,
    started: true,
    performed: o.performed.includes(a.id) ? o.performed : [...o.performed, a.id],
  };
}

export function spendAction(
  o: Opportunity,
  a: CardAction,
  key: string = a.id,
  // Threaded through so the spend agrees with the check that allowed it: an
  // Action let through by Flexible Timing must not then be read as needing an
  // Extra Tick it never used.
  opts: { flexible?: boolean } = {},
): Opportunity {
  const len = lengthOf(a);
  if (!len) return o;
  const verdict = canPerform(o, a, key, opts);
  if (verdict.extra) {
    // A Movement Action is Movement however it is paid for, so the Extra Tick
    // path forfeits Stationary too (the keyword counts any Movement).
    return { ...o, spentExtras: [...o.spentExtras, verdict.extra.id], moved: o.moved || timingOf(a) === 'movement' };
  }
  const cost = TICK_COST[len];
  return {
    ...o,
    maneuver: Math.max(0, o.maneuver - cost.maneuver),
    action: Math.max(0, o.action - cost.action),
    started: true,
    moved: o.moved || timingOf(a) === 'movement',
    performed: o.performed.includes(key) ? o.performed : [...o.performed, key],
  };
}

// A grant whose condition has lapsed is not a Tick in hand, so it must not keep
// an Opportunity open or show as available.
export function extrasLeft(o: Opportunity): ExtraTick[] {
  return o.extras.filter((x) => !o.spentExtras.includes(x.id) && grantHolds(o, x));
}

export function ticksLeft(o: Opportunity): number {
  return o.maneuver + o.action + extrasLeft(o).length;
}

export function opportunityOver(o: Opportunity): boolean {
  return ticksLeft(o) === 0;
}
