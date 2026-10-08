// THE LEARNED JUDGE (M17 L3; AI-OPPONENT-PLAN.md section 4, M17): V(table, seat), the chance the seat wins from the
// position it sees, as trees trained offline on finished games say it (scratchpad train_v.py, then compact_v.py into
// the form below). The trees read the numbers features.ts reads, by name: a model whose names are not FEATURES, in
// order, is refused, since a model fed numbers in another order answers nonsense and looks sound doing it.
//
// One model for the whole page, set by whoever has one (`useModel`): a probe from a file, the page, in time, from
// data shipped with it. With none set, `judge` answers null and the Ace prices nothing by it.
import type { SeatView } from '../seat';
import { FEATURES, featuresOf } from './features';

// One tree, flat: node i splits on number f[i] (going left when the number is at most t[i], to node l[i], else to
// r[i]), or is a leaf (f[i] < 0) worth v[i].
export interface Tree { f: number[]; t: number[]; l: number[]; r: number[]; v: number[] }
export interface Model { names: string[]; trees: Tree[] }

let model: Model | null = null;

// Sets the one model (null: none). Refused, and nothing set, where its numbers are not FEATURES in order.
export function useModel(m: Model | null): boolean {
  if (m && (m.names.length !== FEATURES.length || m.names.some((n, i) => n !== FEATURES[i]))) return false;
  model = m;
  return true;
}

export const hasModel = (): boolean => model !== null;

// The chance to win, from the numbers themselves.
export function judgeFeatures(f: readonly number[]): number | null {
  if (!model) return null;
  let raw = 0;
  for (const tree of model.trees) {
    let i = 0;
    while (tree.f[i] >= 0) i = f[tree.f[i]] <= tree.t[i] ? tree.l[i] : tree.r[i];
    raw += tree.v[i];
  }
  return 1 / (1 + Math.exp(-raw));
}

// The chance the seat wins from the table it sees.
export function judge(view: SeatView): number | null {
  return model ? judgeFeatures(featuresOf(view)) : null;
}
