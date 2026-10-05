// A POLICY is the whole of a computer player's judgement: it is shown one
// Decision and the table as its seat sees it, and names one of the options.
//
// It imports the seat seam and nothing else of the game (AI-OPPONENT-PLAN.md,
// rule R4): it never builds a command, never reads the state, and never knows
// which rule made an option legal. Swap the policy and the same driver plays a
// different opponent.
import type { Decision, SeatView } from '../seat';
import type { Rng } from './rng';

export interface Choice {
  // The id of one of the Decision's options.
  option: string;
  // Why, in a few plain words, for the log and for the player.
  why?: string;
  // The rule that chose it, by name: one word a test or a tally can count.
  reason?: string;
  score?: number;
  // What it weighed, the one chosen first, each with what it was worth and the
  // terms that came to it: for a player watching it think (solo.ts Thought).
  // Never read by a policy.
  considered?: Weighing[];
}

export interface Weighing {
  label: string;
  worth: number;
  // What it does this turn, what it sets up for the next, the mission, where
  // it leaves the unit, what the enemy's fire is expected to cost it, and the
  // chance it is lost.
  parts?: { now: number; next: number; mission: number; shape: number; cost: number; risk: number };
}

export interface Policy {
  name: string;
  choose(decision: Decision, view: SeatView, rng: Rng): Choice;
  // The same choice, worked out in steps with a pause between them. For a
  // policy whose thinking is long enough to hold up a page it shares a thread
  // with: `breathe` hands the thread back for a moment, and the work goes on
  // after it. It must come to exactly what `choose` comes to. A policy that
  // has none is asked `choose`, and so is every policy at a table whose host
  // offers no pause (the suite's).
  ponder?(decision: Decision, view: SeatView, rng: Rng, breathe: () => Promise<void>): Promise<Choice>;
}

// The answer that is always safe: pass, decline, end, the first legal thing.
// What a seat plays when it knows nothing, and what every other policy falls
// back on for a question it has no rule for.
export const safePolicy: Policy = {
  name: 'safe',
  choose: (d) => ({ option: d.fallback, why: 'the safe answer' }),
};
