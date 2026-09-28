// The one footprint reader (types.ts LINE_UNIT_CARDS, isLineUnit, baseBox,
// baseCells) as source text, for the harnesses that slice rules.ts: rules.ts
// imports it, and a slice drops its imports. Cut from types.ts itself, so a
// harness can never agree with a copy while the app reads something else.
import { readFileSync } from 'node:fs';

const types = readFileSync(new URL('../src/types.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const from = types.indexOf('export const LINE_UNIT_CARDS');
const to = types.indexOf('export function cellsOf');
if (from < 0 || to < 0 || to <= from) throw new Error('could not locate the footprint reader in types.ts');
export const FOOTPRINT = types.slice(from, to);
