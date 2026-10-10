// THE LEARNED JUDGE (M17 L3; AI-OPPONENT-PLAN.md section 4, M17): V(table, seat), the chance the seat wins from the
// position it sees, as trees trained offline on finished games say it (scratchpad train_v.py, then compact_v.py into
// the form below). The trees read the numbers features.ts reads, by name: a model whose names are not the first of
// FEATURES, in order, is refused, since a model fed numbers in another order answers nonsense and looks sound doing it.
// A model trained on the first reading (its 81 numbers) is still taken, and is given those numbers alone.
//
// One model for the whole page, set by whoever has one (`useModel`): the page from the model shipped with it
// (`SHIPPED_JUDGE`), a suite or a probe from the same file (tests/_engine.mjs) or another. With none set, `judge`
// answers null and the Ace prices nothing by it.
import { FEATURES, featuresOf, type Look } from './features';

// THE MODEL THE SITE SHIPS, under the data folder: v4, trained on the third data night's 10,329 games (all 144
// numbers). In a folder of its own because the service worker fetches every file at the data folder's top for every
// visitor (sw.js precacheShell): this one is asked for only by a page about to play a computer that reads it.
export const SHIPPED_JUDGE = 'ai/judge-v4.json';

// One tree, flat: node i splits on number f[i] (going left when the number is at most t[i], to node l[i], else to
// r[i]), or is a leaf (f[i] < 0) worth v[i].
export interface Tree { f: number[]; t: number[]; l: number[]; r: number[]; v: number[] }
export interface Model { names: string[]; trees: Tree[] }

let model: Model | null = null;

// Sets the one model (null: none). Refused, and nothing set, where its numbers are not the first of FEATURES in order.
export function useModel(m: Model | null): boolean {
  if (m && (!m.names.length || m.names.length > FEATURES.length || m.names.some((n, i) => n !== FEATURES[i]))) return false;
  model = m;
  return true;
}

export const hasModel = (): boolean => model !== null;

// The chance to win, from the numbers themselves (the model's own, in its order).
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

// The chance the seat wins from the table it sees: as many numbers read as the model was trained on.
export function judge(look: Look): number | null {
  return model ? judgeFeatures(featuresOf(look, model.names.length)) : null;
}
