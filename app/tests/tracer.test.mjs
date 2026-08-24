// TARGET TRACER 追击标记 (glossary :522) - a unit-level Hexagon Token with two
// effects, both Drone-related. The rulebook glossary overrides keywords.json
// here, and the difference was the whole model: the keywords file's zh line
// reads like a part-scoped hit-priority token, while the glossary defines
// (1) a Drone's Automatic Action designates a bearer even when it is not the
// closest enemy, and (2) a Drone attacking a bearer is treated as being in the
// Offensive Stance. English-over-derived-Chinese is this project's standing
// rule, and it saved building the wrong token.
import { readFileSync, writeFileSync } from 'node:fs';

const unitsSrc = readFileSync(new URL('../src/units.ts', import.meta.url), 'utf8');
const cut = (a, b, what) => {
  const i = unitsSrc.indexOf(a), j = unitsSrc.indexOf(b);
  if (i < 0 || j < 0) throw new Error(`could not locate ${what}`);
  return unitsSrc.slice(i, j);
};

const tmp = new URL('./_tracer.slice.ts', import.meta.url);
writeFileSync(tmp, `type Token = any; type GameData = any; type CardAction = any; type PartSlot = any;
const statusCount = (list: any[] | undefined, id: string): number => (list ?? []).filter((s) => s === id).length;
export function tokenCards(data: any, t: any): any[] {
  const out: any[] = [];
  for (const slot of ['torso', 'chasis', 'leftHand', 'rightHand', 'backpack']) {
    const id = t.mech?.[slot]; const c = id ? data.byId.get(id) : undefined;
    if (c) out.push({ slot, card: c });
  }
  if (t.kind !== 'mech') { const c = data.byId.get(t.cardId); if (c) out.push({ slot: 'main', card: c }); }
  return out;
}
function largeGridOf(t: any): any { return { c: Math.floor(t.col / 3), r: Math.floor(t.row / 3) }; }
function rangeBetween(a: any, b: any): any {
  const ga = largeGridOf(a), gb = largeGridOf(b);
  const dc = Math.abs(ga.c - gb.c), dr = Math.abs(ga.r - gb.r);
  return { range: dc + dr, adjacent: dc <= 1 && dr <= 1, sameGrid: dc === 0 && dr === 0 };
}
export function actionRange(_d: any, _t: any[], _u: any, a: any): number { return a.range ?? 0; }
export function isElectronicAttack(_a: any): boolean { return false; }
export function electronicOrigins(_d: any, _t: any[], u: any): any[] { return [u]; }
`
  + cut('export function treatedAsOffensive', '// ---------- DISARM', 'treatedAsOffensive')
  + cut('// Auto-attack target selection', 'export function autoNeutralTargets', 'autoTargetsFor')
  + cut('export function onHitRiders', 'export interface Knockback', 'onHitRiders')
  + cut('export const STATUS_BY_ZH', 'export interface OnHitRider {', 'STATUS_BY_ZH')
  + cut('export interface OnHitRider {', 'export function onHitRiders', 'the OnHitRider type'));
const U = await import(tmp.href);

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}, got ${g}`); }
};

console.log('Target Tracer: the token the glossary defines, not the one keywords.json implied\n');

const drone = (uid, side, col, extra = {}) =>
  ({ uid, side, kind: 'drone', col, row: 9, size: 1, facing: 0, cardId: 'x', partStates: { main: 'intact' }, statuses: [], ...extra });
const mech = (uid, side, col, extra = {}) =>
  ({ uid, side, kind: 'mech', col, row: 9, size: 3, facing: 0, mech: {}, partStates: { torso: 'intact' }, statuses: [], ...extra });

// ---------- effect 2: treated as Offensive Stance ----------
{
  const gun = drone(1, 's1', 0);
  const marked = mech(2, 's2', 3, { statuses: ['targetTracer'] });
  const clean = mech(3, 's2', 3);
  check('a Drone attacking a bearer is treated as Offensive', U.treatedAsOffensive(gun, marked), true);
  check('the same Drone against a clean target is not', U.treatedAsOffensive(gun, clean), false);
  check('a MECH gains nothing from the tracer - the glossary names Drones',
    U.treatedAsOffensive(mech(4, 's1', 0), marked), false);
  check('and a Mech really in Offensive Stance still is, tracer or none',
    U.treatedAsOffensive(mech(4, 's1', 0, { stance: 'offensive' }), clean), true);
}

// ---------- effect 1: the Automatic Action designation ----------
{
  const data = { byId: new Map() };
  const shot = { type: 'Firing', range: 12 };
  const gun = drone(1, 's1', 0);
  const near = mech(2, 's2', 3);              // 1 Grid away
  const marked = mech(3, 's2', 12, { statuses: ['targetTracer'] }); // 4 Grids away
  check('a Drone designates the tracered unit even when it is not the closest',
    U.autoTargetsFor(data, [gun, near, marked], gun, shot).map((t) => t.uid), [3]);
  check('with no tracer on the board the nearest rule stands',
    U.autoTargetsFor(data, [gun, near, mech(3, 's2', 12)], gun, shot).map((t) => t.uid), [2]);
  // The waiver is DRONES ONLY: the picker for anything else ignores the token.
  const mechGunner = mech(1, 's1', 0);
  check('a non-Drone attacker still takes the nearest',
    U.autoTargetsFor(data, [mechGunner, near, marked], mechGunner, shot).map((t) => t.uid), [2]);
  // Highlight outranks it: its glossary verb is MUST, and the overlap between
  // the two tokens is unruled - one line to flip if a ruling lands.
  const lit = mech(4, 's2', 9, { statuses: ['highlight'] });
  check('a Highlight still outranks the tracer',
    U.autoTargetsFor(data, [gun, near, marked, lit], gun, shot).map((t) => t.uid), [4]);
  // Among two bearers, nearest-within-them still breaks the tie: the glossary
  // waives the distance rule, it does not invert it.
  const marked2 = mech(5, 's2', 6, { statuses: ['targetTracer'] });
  check('two bearers: the nearer of them is taken',
    U.autoTargetsFor(data, [gun, marked, marked2], gun, shot).map((t) => t.uid), [5]);
}

// ---------- the grant, through the on-hit rider seam ----------
{
  // ZHLA-302's rider lives ONLY in the printed English - its zh description is
  // bare keywords - so route C is the one that has to carry it.
  const act = { description: { zh: '· 霰射 · 近战射击', en: '· Melee Firing\n· [On Hit] The hit part gains 1 Pursuit Token.' }, keywords: [] };
  const riders = U.onHitRiders(act, []);
  check('Marking Shot grants the tracer on a hit',
    riders.some((r) => r.kind === 'status' && r.statusId === 'targetTracer' && r.amount === 1), true);
  check('and a plain action grants none',
    U.onHitRiders({ description: { zh: '', en: 'Just a gun.' }, keywords: [] }, []).length, 0);
}

// ---------- the token itself ----------
{
  const types = readFileSync(new URL('../src/types.ts', import.meta.url), 'utf8');
  const at = types.indexOf("id: 'targetTracer'");
  // The def EXISTED all along, display-only: printed faces in data.ts, zero
  // mechanical readers. The audit's "no pursuit status" claim checked the wrong
  // spelling, and building a duplicate 'tracer' beside it was caught by
  // tokendecay.test's census of shaped tokens. Grep BOTH the English and the
  // camelCase spelling before declaring a token missing.
  check('the targetTracer StatusDef is the one and only', at > 0 && !types.includes("id: 'tracer'"), true);
  const body = types.slice(at, at + 700);
  // A HEXAGON, which is what buys the whole 2.5.3 economy for free: one per
  // unit, displaced by the next hexagon, and refused on Low Value Units by the
  // applyStatus check that already enforces J3/M23.
  check('and it is a Hexagon Token', /shape: 'hexagon'/.test(body), true);
  check('with the red-and-yellow decay pair the appendix prints', /decay: 'yellow'/.test(body), true);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
