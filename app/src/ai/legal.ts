// The LEGAL policy: a seat that knows the rules and nothing else. It answers
// what it owes with the safe answer and otherwise picks a legal option by a
// weighted draw. It plays badly on purpose. It exists so that two of them can
// play whole games in the test suite, where any change to the engine that
// leaves a seat with no answer, or with an answer the engine refuses, shows up
// as a failed game (AI-OPPONENT-PLAN.md, rule R8), and so the first game
// against the computer on screen needs no cleverness to exist.
import type { Decision, Option } from '../seat';
import type { Policy } from './policy';

// How often a kind of option is drawn, against 1 for an ordinary one. A seat
// that only ever ends its turn never tries anything, and one that never does
// plays every Opportunity to exhaustion, so ending and passing weigh about as
// much as everything else put together.
const WEIGHTS: Record<string, number> = {
  end: 3,
  pass: 2,
  decline: 4,
  attack: 4,
  electronic: 4,
  // Every Grid and facing a unit could move to, taken together, and every
  // Landing Point a Projectile could be put on.
  move: 3,
  launch: 3,
  stance: 0.5,
  tied: 0.25,
};

// Options that are one idea said many times over: a list of fifty Grids to
// walk to counts as "move", not as fifty reasons to.
const PLACES = new Set(['move', 'deploy', 'land', 'blink']);

function weightOf(o: Option, places: number): number {
  const tagged = o.tags.find((t) => WEIGHTS[t] !== undefined);
  const w = tagged ? WEIGHTS[tagged] : 1;
  return o.tags.some((t) => PLACES.has(t)) ? w / Math.max(1, places) : w;
}

// Kinds of question a seat simply answers: there is one right thing to do and
// drawing lots over it would only slow the game.
const PLAIN = new Set(['phase.ready', 'setup.ready', 'setup.begin', 'setup.lock', 'setup.accept', 'setup.tasks', 'setup.roll',
  'planning.commit', 'planning.reveal', 'end.step']);

export const legalPolicy: Policy = {
  name: 'legal',
  choose(d: Decision, _view, rng) {
    if (PLAIN.has(d.kind) || d.options.length === 1) return { option: d.fallback, why: 'the only thing to do' };
    const places = d.options.filter((o) => o.tags.some((t) => PLACES.has(t))).length;
    const pick = rng.weighted(d.options, (o) => weightOf(o, places));
    return { option: pick.id, why: 'a legal move, drawn by lot' };
  },
};
