// The Season Rules in play (OTTO, 2026-09-30: "wire in the new seasonal
// mechanics to pad / the engine"; "a settings for enabling or disabling. In PAD
// this would be another button in the setup of the game").
//
// A table plays a season only when its host turned one on at setup
// (configureTable `season`, fixed once the game is under way); otherwise the
// main rules stand. What a season changes is data: each rule's `effect` in
// data/mechanics.json `seasons`, so the next season is a data edit.
import type { CommonAction, GameData, SeasonDef } from './data';
import type { GameState } from './types';

type Seasoned = Pick<GameState, 'season'> | null | undefined;

export function tableSeason(data: GameData, state: Seasoned): SeasonDef | undefined {
  const id = state?.season;
  return id ? (data.seasons ?? []).find((s) => s.id === id) : undefined;
}

// How many Smoke Screens leave each Connected group in the End Phase: one in
// the main rules (4.16), three in Season 1.04.
export function smokePerGroup(data: GameData, state: Seasoned): number {
  const n = tableSeason(data, state)?.rules.find((r) => r.effect?.smokePerGroup)?.effect?.smokePerGroup;
  return n && n > 1 ? n : 1;
}

// A season that resizes an Action (Stabilize System is Medium in Season 1.04)
// resizes the ONE CommonAction object that the engine and every page read, so
// the tick cost, the capsule on a card and every check agree without a flag
// threaded through each of them. The printed size is kept aside, so a table
// with the season off, or the next table on the same page, gets it back.
//
// The engine calls this at every check and apply, and each page before it
// draws, so a table loaded or received with a season on is right from its
// first frame. Both players' engines read the same `season` off the shared
// state, which is what keeps them agreeing.
const printed = new WeakMap<CommonAction, string | undefined>();

export function syncSeason(data: GameData, state: Seasoned): void {
  const sizes = new Map<string, string>();
  for (const r of tableSeason(data, state)?.rules ?? []) {
    if (r.effect?.action && r.effect.size) sizes.set(r.effect.action, r.effect.size);
  }
  for (const a of data.commonActions ?? []) {
    if (!printed.has(a)) printed.set(a, a.size);
    const want = sizes.get(a.id) ?? printed.get(a);
    if (a.size !== want) a.size = want;
  }
}
