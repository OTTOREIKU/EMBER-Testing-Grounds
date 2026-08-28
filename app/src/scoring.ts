// The scoring GLUE, shared by every page that shows a score.
//
// tasks.ts already holds the arithmetic - scoreMain, scoreSecondary,
// scoreRiders. What lived in two places was the wiring around it: read the
// Main Task off the mission card, settle Control, run the three scorers, drop
// anything already paid, add it up. matchhud.ts and playguide.ts each carried a
// copy, and both carried the same comment warning what that costs:
//
//   "the two pages keep separate copies of this glue, and wiring only one is
//    how a rule ends up live on half the app"
//
// The pad would have been a third. So there is one copy here and the pages call
// it. Anything genuinely per-page is an option below, not a branch on which
// page is asking.
import { normaliseTasks, escortTargets, scoreMain, scoreRiders, scoreSecondary, settleControl, unpaidLines, type MissionScoring, type ScoreLine, type ScoreResult, type SecondaryScoring, type TaskState } from './tasks';
import { vpRiderFor } from './units';
import { zonesOf, type GameState, type Side, type Token } from './types';
import type { GameData } from './data';

// The mission card as the scorers read it. Structural rather than imported so
// this does not pin down where a caller's mission list came from.
interface MissionLike {
  family?: string;
  vp?: number;
  zones?: string[];
  fromRound?: number;
  cadence?: string;
  scoringZone?: string;
}

// The Main Task read as scoring terms. One place, because the rider producer
// gates card 300 on the Task family and reuses its scoringZone - if these two
// readings ever disagreed, a rider would pay out against a Task that is not
// being played.
export function missionScoring(m: MissionLike): MissionScoring {
  return {
    family: m.family as MissionScoring['family'],
    vp: m.vp ?? 0,
    zones: m.zones ?? [],
    fromRound: m.fromRound ?? 1,
    cadence: (m.cadence as MissionScoring['cadence']) ?? 'per-round',
    scoringZone: m.scoringZone,
  };
}

// A Drone printed at 0 points carries the Low Value tag; Projectiles are Low
// Value by default (p.82). One definition, so a unit cannot be Low Value for
// one Task and not for another.
export function lowValueOf(data: GameData): (t: Token) => boolean {
  return (t: Token) => t.kind === 'projectile'
    || (t.kind === 'drone' && (data.byId.get(t.cardId)?.score ?? 0) === 0);
}

// The Grids a zone covers, as the scorers ask for them.
export function zoneCellsOf(data: GameData, state: GameState): (zone: string) => string[] {
  return (zone: string) => zonesOf(data.zoneData.zones, state).find((z) => z.id === zone)?.cells ?? [];
}

export interface PreviewOpts {
  // The caller's own TaskState, when it holds one it wants settled in place -
  // settleControl MUTATES it, and the guide relies on that.
  tasks?: TaskState;
  // Whether to re-read Control off the board before scoring. TRUE for a page
  // with a board. The pad passes FALSE: it has no board, so settling would
  // overwrite every hand-set claim with null and quietly score zero.
  settle?: boolean;
  // Where the zones are. Defaults to reading them off the state; a page with no
  // map passes its own, or `() => []`.
  zoneCells?: (zone: string) => string[];
}

export function previewScore(
  data: GameData,
  state: GameState,
  finalRound: boolean,
  opts: PreviewOpts = {},
): ScoreResult {
  const tasks = opts.tasks ?? normaliseTasks(state.tasks);
  const low = lowValueOf(data);
  const cells = opts.zoneCells ?? zoneCellsOf(data, state);
  // Control is judged as part of the same reading of the board that scores it.
  if (opts.settle !== false) settleControl(tasks, cells, state.tokens, low);

  const mission = state.mission ? data.missions.cards.find((c) => c.id === state.mission) : undefined;
  const scoring = mission ? missionScoring(mission) : undefined;

  const all: ScoreLine[] = [];
  if (scoring) all.push(...scoreMain(scoring, tasks, state.tokens, state.round.n, finalRound, cells).lines);
  // Printed VP riders on a Part (300, 500).
  all.push(...scoreRiders(
    scoring, tasks, state.tokens, finalRound, cells,
    escortTargets(tasks, (id) => data.secondary.find((c) => c.id === id)?.kind as SecondaryScoring['kind'] | undefined),
    (cardId) => vpRiderFor(data, cardId),
  ).lines);
  for (const side of ['s1', 's2'] as Side[]) {
    const id = tasks.secondary[side];
    const card = id ? data.secondary.find((c) => c.id === id) : undefined;
    if (!card?.kind) continue;
    all.push(...scoreSecondary(
      { id: card.id, name: card.name, vp: card.vp ?? 0, kind: card.kind as SecondaryScoring['kind'] },
      side, tasks, state.tokens, cells, finalRound, low,
    ).lines);
  }
  // Anything already paid stays paid: a Task does not score twice for the same
  // reason in a later round.
  const open = unpaidLines(all, tasks.scored);
  let s1 = 0;
  let s2 = 0;
  for (const l of open) (l.side === 's1' ? (s1 += l.vp) : (s2 += l.vp));
  return { lines: open, s1, s2 };
}
