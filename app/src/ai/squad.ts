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
  // The enemy's turns: what its best attack on this squad is worth to it (`gainOf`), the harm this squad takes there
  // (0 for ours, and for an enemy with no attack on us from where it stands, a Melee Lock barring its gun included).
  harm: number;
}
export interface ProjectedRound { steps: RoundStep[]; end: Outlook }
// The round as far as a run of turns, kept for another projection that begins with the same turns (S3 tries many
// dials, and a change to one Mech's leaves every turn before it as it was).
export interface RoundCut { cur: Outlook; steps: RoundStep[]; gone: number[] }

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
  cache?: Map<string, RoundCut>, known?: ReadonlyMap<string, TurnPlan>,
): Steps<ProjectedRound> {
  let cur = start;
  let gone = new Set<number>();
  let steps: RoundStep[] = [];
  let key = '';
  // The round so far, kept under the turns that made it.
  const keep = (): void => { cache?.set(key, { cur, steps: steps.map((s) => ({ ...s })), gone: [...gone] }); };
  for (const turn of roundOrder(view, dials, enemies)) {
    key += `|${turn.uid}:${turn.timing}`;
    const hit = cache?.get(key);
    if (hit) {
      cur = hit.cur;
      steps = hit.steps.map((s) => ({ ...s }));
      gone = new Set(hit.gone);
      continue;
    }
    if (gone.has(turn.uid)) { keep(); continue; }
    const unit = view.units.find((u) => u.uid === turn.uid)!;
    const step: RoundStep = { uid: turn.uid, side: unit.side, label: unit.label, timing: turn.timing, mine: turn.mine, at: null, target: null, kill: 0, removed: false, worth: 0, harm: 0 };
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
      // A turn met on the starting table was planned already (`known`, by `${uid}:${timing}`): the same plan.
      const was = cur === start ? known?.get(`${turn.uid}:${turn.timing}`) : undefined;
      const d = was ? null : cur.turnOf(turn.uid, undefined, turn.timing);
      if (!was) yield;
      const p = was ?? (d ? yield* plan(d, cur.view()) : null);
      if (p) {
        step.at = p.at;
        step.worth = p.worth;
        let next = cur;
        if (p.option) next = p.option.after?.() ?? next;
        if (p.via) next = p.via.after?.() ?? next;
        if (p.deed) next = isShot(p.deed.option) ? strike(p.deed.option, next) : (p.deed.option.after?.() ?? next);
        cur = next;
      }
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
      if (best) { step.harm = Math.max(0, best.g); cur = strike(best.o, cur); }
    }
    keep();
  }
  return { steps, end: cur };
}

// THE DIALS CHOSEN TOGETHER (S3, the Tactician's skill `squadDials`). `candidates` gives each Mech of this squad the
// Timings worth trying, its best alone first. The squad's worth of an assignment is every one of its Mechs' plans as
// projected, each on the table it would meet (and the earlier Timing's small edge, `tempo`, as a Mech alone has it),
// LESS THE HARM the enemy's turns do it in the round (each one's best attack on the squad, `harm`): a Mech dialled
// late is shot before it acts, and a gunner Locked before its turn harms nobody. (The first form left the harm out:
// only a unit destroyed outright counted against it, so the search drifted to late Timings that looked safe; random
// squads, 75 of 200 won against 92, 2026-10-07.)
// From each Mech's best alone, a Mech at a time in the round's order each other Timing it has is tried, and kept where
// the squad's worth rises by more than `margin`; `passes` times over, or until nothing changes. The round's unchanged
// beginning is reused from one trial to the next (`RoundCut`).
//
// WITH `own` (the third form, 2026-10-07): for each Mech, its Timings as the Tactician's `dial` reads them alone
// (`value`: the plan, and what standing where it is costs it, and the rest of that reading) and the worth of the plan
// that reading found (`worth`). A Mech's dial then changes where the round gains by more than `margin` with the Mech
// itself read as `dial` reads it, and the projection kept for what is the squad's: what the Mech's own plan gains or
// loses by the turns around it, every other Mech's plan as projected, and the harm the enemy's turns do every OTHER
// unit of ours (its own is in its reading). (The second form weighed a Mech's own Timings by its plan's bare worth,
// and set worse dials than `dial` did even where no Mech's turn touched another's: random squads 76 of 200 against
// 92, the melee bed 29 of 85 against 49.)
export interface DialOwn { value: number; worth: number }
export interface SquadChoice { dials: Map<number, string>; total: number; alone: number; tried: number }
export function* chooseDials(
  start: Outlook, view: SeatView, candidates: ReadonlyMap<number, readonly string[]>, plan: Planner, w: Weights = TACTICIAN,
  passes = 1, margin = 0.01, known?: ReadonlyMap<string, TurnPlan>, own?: ReadonlyMap<number, ReadonlyMap<string, DialOwn>>,
): Steps<SquadChoice> {
  const cache = new Map<string, RoundCut>();
  const tempo = (timing: string): number => w.tempo * (ORDER.length - ORDER.indexOf(timing));
  const worth = (r: ProjectedRound, dials: ReadonlyMap<number, string>): number =>
    r.steps.reduce((n, s) => n + (s.mine ? s.worth : -s.harm), 0) + [...dials.values()].reduce((n, t) => n + tempo(t), 0);
  // What each Mech of ours does in a round, and the harm done to each unit of ours.
  const split = (r: ProjectedRound): { did: Map<number, number>; hit: Map<number, number> } => {
    const did = new Map<number, number>();
    const hit = new Map<number, number>();
    for (const s of r.steps) {
      if (s.mine) did.set(s.uid, (did.get(s.uid) ?? 0) + s.worth);
      else if (s.target !== null) hit.set(s.target, (hit.get(s.target) ?? 0) + s.harm);
    }
    return { did, hit };
  };
  const sum = (m: ReadonlyMap<number, number>, skip?: number): number => [...m].reduce((n, [u, v]) => (u === skip ? n : n + v), 0);
  const dials = new Map([...candidates].filter(([, ts]) => ts.length).map(([uid, ts]) => [uid, ts[0]] as [number, string]));
  let round = yield* projectRound(start, view, dials, plan, w, true, cache, known);
  const alone = worth(round, dials);
  let total = alone;
  let tried = 1;
  for (let pass = 0; pass < passes; pass++) {
    let moved = false;
    for (const turn of roundOrder(view, dials, true).filter((t) => t.mine)) {
      for (const timing of candidates.get(turn.uid) ?? []) {
        const was = dials.get(turn.uid);
        if (timing === was) continue;
        const trial = new Map(dials);
        trial.set(turn.uid, timing);
        const next = yield* projectRound(start, view, trial, plan, w, true, cache, known);
        tried += 1;
        const a = was === undefined ? undefined : own?.get(turn.uid)?.get(was);
        const b = own?.get(turn.uid)?.get(timing);
        let gain: number;
        if (a && b) {
          const then = split(round);
          const now = split(next);
          gain = sum(now.did) - sum(then.did) - (b.worth - a.worth) + (b.value - a.value) - (sum(now.hit, turn.uid) - sum(then.hit, turn.uid));
        } else gain = worth(next, trial) - worth(round, dials);
        if (gain > margin) { total += gain; dials.set(turn.uid, timing); round = next; moved = true; }
      }
    }
    if (!moved) break;
  }
  return { dials, total, alone, tried };
}
