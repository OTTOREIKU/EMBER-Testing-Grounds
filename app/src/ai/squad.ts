// THE ROUND AS PLANNED (M18, S1 and S2; OTTO, 2026-10-07: "the CPU needs to start thinking as one", and "go ahead
// with S1 and S2"). A squad's planned turns for a round laid on copies of the table in the order the round will be
// played (loop.ts activationOrder: by Timing, then Initiative, the lowest first, ties alternating from the First
// Player), so each Mech planned for later in the round meets the table its allies, and the enemy, will likely have
// left it.
//
// S1, OUR TURNS. Each is planned by the planner given (the Tactician's own, tactician.ts `turnPlanner`) on the
// table it will meet, and laid on it: its answers that are commands alone (a Movement, a Stance, a launch) through
// the seam (`after`), and an attack by its odds: a target it destroys at better than even odds is taken off the
// table for those after it (`without`). Dice are not rolled; the plan is what the odds say.
//
// S2, THE ENEMY BETWEEN OUR TURNS. Their dials are hidden: each enemy Mech is put on the Timing it would most likely
// want (a gun's Firing, else a blade's Melee) and makes its best attack on this squad from where it stands, laid the
// same way. (It does not walk: a first form.)
//
// Drones act outside the Action Phase's Timings and are left out. Nothing here changes an answer: it is read by the
// dials chosen together (S3), and measured before that is adopted.

import type { Decision, Option, Outlook, SeatView, UnitView } from '../seat';
import { strikers, type Grid } from './brawler';
import { gainOf, TACTICIAN, type Weights } from './evaluate';

export type Steps<T> = Generator<void, T, void>;

// A planned turn as the planner gives it: its first answer (null: it starts where it stands), a second Movement
// after it, the deed it makes where it ends (an attack, a launch...), where it ends, and what the plan is worth.
export interface TurnPlan { option: Option | null; via?: Option; deed: { option: Option; value: number } | null; at: Grid; worth: number }
export type Planner = (d: Decision, view: SeatView) => Steps<TurnPlan | null>;

// One turn of the projected round, in the order it would be played.
export interface RoundStep {
  uid: number;
  side: SeatView['seat'];
  label: string;
  timing: string;
  mine: boolean;
  // Where our Mech ends (null for the enemy's, which do not walk here).
  at: Grid | null;
  // What it attacks, the chance it destroys it, and whether it was taken off the table for those after it.
  target: number | null;
  kill: number;
  removed: boolean;
  // Our turns: the plan's worth on the table it met (0 where no plan was made).
  worth: number;
}
export interface ProjectedRound { steps: RoundStep[]; end: Outlook }

const ORDER = ['swift', 'melee', 'projectile', 'firing', 'movement', 'tactical'];
// Better than even odds of destroying it: off the table for those after.
export const ROUND_KILL = 0.5;
const isShot = (o: Option): boolean => o.run?.routine === 'attack';

// The Timing an enemy Mech would most likely want, its dial hidden: a gun's Firing, else a blade's Melee.
export function likelyTiming(e: UnitView): string {
  return strikers(e).some((x) => x.type === 'Firing') ? 'firing' : 'melee';
}

// The round's turns in the order they would be played: this squad's Mechs on the dials given, and (with `enemies`)
// the other squad's on their likeliest Timings.
export function roundOrder(view: SeatView, dials: ReadonlyMap<number, string>, enemies = true): { uid: number; timing: string; mine: boolean }[] {
  const turns = view.units
    .filter((u) => u.kind === 'mech' && u.alive && u.deployed && (u.side === view.seat ? dials.has(u.uid) : enemies))
    .map((u) => {
      const mine = u.side === view.seat;
      const timing = mine ? dials.get(u.uid)! : likelyTiming(u);
      return { u, timing, mine, rank: ORDER.indexOf(timing), init: u.init?.[timing as keyof NonNullable<UnitView['init']>] ?? Infinity };
    });
  const out: { uid: number; timing: string; mine: boolean }[] = [];
  const keys = [...new Set(turns.map((t) => `${t.rank}|${t.init}`))]
    .map((k) => k.split('|').map(Number))
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  for (const [rank, init] of keys) {
    const tied = turns.filter((t) => t.rank === rank && t.init === init);
    const first = tied.filter((t) => t.u.side === view.firstPlayer);
    const second = tied.filter((t) => t.u.side !== view.firstPlayer);
    let turn = first;
    while (first.length || second.length) {
      const next = (turn.length ? turn : turn === first ? second : first).shift()!;
      out.push({ uid: next.u.uid, timing: next.timing, mine: next.mine });
      turn = turn === first ? second : first;
    }
  }
  return out;
}

// THE ROUND PROJECTED: from `start` (the table as it stands, `view` this seat's view of it), each turn of
// `roundOrder` planned (ours, by `plan`) or guessed (the enemy's best attack) on the table the turns before it leave.
export function* projectRound(
  start: Outlook, view: SeatView, dials: ReadonlyMap<number, string>, plan: Planner, w: Weights = TACTICIAN, enemies = true,
): Steps<ProjectedRound> {
  let cur = start;
  const gone = new Set<number>();
  const steps: RoundStep[] = [];
  for (const turn of roundOrder(view, dials, enemies)) {
    if (gone.has(turn.uid)) continue;
    const unit = view.units.find((u) => u.uid === turn.uid)!;
    const step: RoundStep = { uid: turn.uid, side: unit.side, label: unit.label, timing: turn.timing, mine: turn.mine, at: null, target: null, kill: 0, removed: false, worth: 0 };
    steps.push(step);
    // An attack laid by its odds: its target off the table where it is destroyed at better than even odds.
    const strike = (o: Option, from: Outlook): Outlook => {
      const target = o.facts?.targetUid;
      if (typeof target !== 'number') return from;
      step.target = target;
      step.kill = o.chance?.()?.kill ?? 0;
      if (step.kill < ROUND_KILL) return from;
      step.removed = true;
      gone.add(target);
      return from.without(target);
    };
    if (turn.mine) {
      const d = cur.turnOf(turn.uid, undefined, turn.timing);
      yield;
      if (!d) continue;
      const p = yield* plan(d, cur.view());
      if (!p) continue;
      step.at = p.at;
      step.worth = p.worth;
      let next = cur;
      if (p.option) next = p.option.after?.() ?? next;
      if (p.via) next = p.via.after?.() ?? next;
      if (p.deed) next = isShot(p.deed.option) ? strike(p.deed.option, next) : (p.deed.option.after?.() ?? next);
      cur = next;
    } else {
      const d = cur.turnOf(turn.uid, ['attack'], turn.timing);
      yield;
      const v = cur.view();
      let best: { o: Option; g: number } | null = null;
      for (const o of d?.options ?? []) {
        if (!isShot(o)) continue;
        const target = v.units.find((u) => u.uid === o.facts?.targetUid);
        const f = target && target.side === view.seat ? o.chance?.() : null;
        if (!f || !target) continue;
        const g = gainOf(f, target, v, w);
        if (!best || g > best.g) best = { o, g };
      }
      if (best) cur = strike(best.o, cur);
    }
  }
  return { steps, end: cur };
}
