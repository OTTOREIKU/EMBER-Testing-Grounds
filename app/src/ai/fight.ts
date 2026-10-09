// IN THE MIDDLE OF AN ATTACK (every policy's): where the Hit lands, what the defender declares, which dice a reroll
// throws again, what a Surplus buys. Each answer is the option whose odds are worth most by the policy's own reckoning
// of an attack (`Worth`, given by the policy: the Ace's is evaluate.ts gainOf), the attacker's way or the defender's.
import type { Decision, Forecast, Option, SeatView } from '../seat';
import type { Choice } from './policy';
import { unitOf } from './geometry';

const EXACT = 1e-9;

// What a forecast is worth to the attacker, in the fight a question is about.
export type Worth = (f: Forecast) => number;

// Whether one forecast is better for the attacker than another: worth more,
// or worth the same and likelier to Penetrate.
export function beats(worth: Worth, a: Forecast, b: Forecast): boolean {
  const more = worth(a) - worth(b);
  return more > EXACT || (Math.abs(more) <= EXACT && a.pen > b.pen + EXACT);
}

export const attacking = (d: Decision): boolean => d.facts.role !== 'defender';

// The answers that have odds on them, each with its forecast.
export const forecasts = (options: Option[]): { o: Option; f: Forecast }[] =>
  options.flatMap((o) => { const f = o.chance?.(); return f ? [{ o, f }] : []; });

// WHERE THE HIT LANDS, the attacker's to say: the Part worth most to hit
// (finishing a Damaged one, by the odds), and of two worth the same the one
// that cost more.
export function hitLocation(d: Decision, view: SeatView, worth: Worth): Choice | null {
  const picks = forecasts(d.options.filter((o) => o.id.startsWith('part.pick:')));
  if (!picks.length) return null;
  const target = unitOf(view, d.facts.targetUid);
  const cost = (o: Option): number => target?.parts.find((p) => p.slot === o.id.slice('part.pick:'.length))?.points ?? 0;
  const best = picks.reduce((a, b) => (beats(worth, b.f, a.f) || (!beats(worth, a.f, b.f) && cost(b.o) > cost(a.o)) ? b : a));
  return { option: best.o.id, reason: 'hit_location', score: worth(best.f), why: 'the Part worth most to hit' };
}

// WHAT THE DEFENDER DECLARES before the Part Die: the Part, and the Parry on
// it, that costs the attacker most; nothing, where nothing does better than
// that. KC Armor spends a Charge, and is never declared.
export function declare(d: Decision, view: SeatView, worth: Worth): Choice | null {
  const none = d.options.find((o) => o.id === 'declare.none');
  const base = none?.chance?.();
  if (!none || !base) return null;
  let best: { o: Option; f: Forecast } = { o: none, f: base };
  for (const x of forecasts(d.options.filter((o) => o.id.startsWith('declare.designate:')))) {
    if (beats(worth, best.f, x.f)) best = x;
  }
  return best.o === none
    ? { option: none.id, reason: 'skip_parry', score: worth(best.f), why: 'nothing it could declare would cost the attacker more' }
    : { option: best.o.id, reason: 'declare_parry', score: worth(best.f), why: 'declared where it costs the attacker most' };
}

// THE REROLL a Focus bought: the dice worth most to throw again, by the odds
// of each selection; the roll is kept where throwing none of them is as good.
export function reroll(d: Decision, view: SeatView, worth: Worth): Choice | null {
  const all = forecasts(d.options);
  const keep = all.find((x) => x.o.id.startsWith('reroll.keep'));
  if (!all.length) return null;
  const mine = attacking(d);
  let best = keep ?? all[0];
  for (const x of all) if (mine ? beats(worth, x.f, best.f) : beats(worth, best.f, x.f)) best = x;
  return best === keep
    ? { option: best.o.id, reason: 'keep_roll', score: worth(best.f), why: 'no die worth throwing again' }
    : { option: best.o.id, reason: 'reroll_value', score: worth(best.f), why: 'the dice worth most to throw again' };
}

// WHAT A SURPLUS IS SPENT ON: the keyword worth most.
export function surplus(d: Decision, view: SeatView, worth: Worth): Choice | null {
  const all = forecasts(d.options.filter((o) => o.id.startsWith('surplus.effect:')));
  if (!all.length) return null;
  const best = all.reduce((a, b) => (beats(worth, b.f, a.f) ? b : a));
  return { option: best.o.id, reason: 'attack_result_value', score: worth(best.f), why: 'the Surplus where it is worth most' };
}
