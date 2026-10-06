// A CLICK ON A CONTAINER WHILE A ROUTE IS BEING DRAWN, DRIVEN.
//
// OTTO, 2026-10-05: "I thought the rules said a mech can move into the same
// grid as a 1'' and destroy it but our engine seems to stop a mech from moving
// into a grid that has a small destroyable terrain." The engine had the Crush
// right (4.3.6). The board did not: a Destructible piece had its own pointerdown,
// which stopped the event and asked about destroying the piece by hand, so a
// click on the Container's picture never reached the route at all. Now, while a
// route is being drawn (the callbacks' `routing`), the piece lets the click
// through to its Grid; otherwise it asks as before.
//
// Driven, not read: board.ts's real renderTerrain draws the piece into a stub
// DOM and the test presses it; matchhud.ts's real boardCallbacks answer
// `routing` off its own movePlan.
import { readFileSync, writeFileSync } from 'node:fs';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}, got ${g}`); }
};

console.log('A click on a Container while a route is drawn\n');

class El {
  constructor(tag) { this.tag = tag; this.attrs = {}; this.children = []; this.listeners = {}; this.style = {}; this.textContent = ''; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  appendChild(c) { this.children.push(c); return c; }
  replaceChildren(...cs) { this.children = cs; }
  addEventListener(k, fn) { (this.listeners[k] ??= []).push(fn); }
}
globalThis.document = { createElementNS: (_ns, tag) => new El(tag) };

const cut = (s, a, b, what) => {
  const i = s.indexOf(a), j = s.indexOf(b, i);
  if (i < 0 || j < 0 || j <= i) throw new Error(`could not locate ${what}`);
  if (s.indexOf(a, i + 1) >= 0) throw new Error(`${what}: start marker is not unique`);
  return s.slice(i, j);
};
const srcOf = (f) => readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const boardSrc = srcOf('board.ts');
const hudSrc = srcOf('matchhud.ts');
const mainSrc = srcOf('main.ts');

// board.ts: the fill table, the element maker and renderTerrain, on a stand-in
// that has the two fields renderTerrain touches besides them.
const fills = cut(boardSrc, 'const TERRAIN_FILL', 'const SVG_NS', 'the terrain fills');
const svgNs = cut(boardSrc, 'const SVG_NS', '\n', 'the SVG namespace');
const maker = cut(boardSrc, 'function el<', 'function badgeWidth', 'the element maker');
const render = cut(boardSrc, '  renderTerrain(pieces: TerrainPiece[], editable = false): void {', '  renderZones(', 'renderTerrain');
const slice = new URL('./_containerclick.board.slice.ts', import.meta.url);
writeFileSync(slice, `type TerrainPiece = any; type SVGElementTagNameMap = any;
const CELL = 30;
${fills}${svgNs}
${maker}
export class BoardTerrain {
  gTerrain: any = { children: [] as any[], replaceChildren(...cs: any[]) { this.children = cs; }, appendChild(c: any) { this.children.push(c); return c; } };
  callbacks: any;
  constructor(callbacks: any) { this.callbacks = callbacks; }
  attachInspect(_g: any, _info: any): void {}
${render}}
`);
const { BoardTerrain } = await import(`${slice.href}?v=${Date.now()}`);

const container = {
  id: 'ctr1', type: 'container', subCells: [{ col: 20, row: 11 }], height: 1,
  blocksLos: false, providesProtection: false, isFragile: true,
};
const press = (routing) => {
  const destroyed = [];
  const board = new BoardTerrain({ onDestroyTerrain: (id) => destroyed.push(id), ...(routing === undefined ? {} : { routing: () => routing }) });
  board.renderTerrain([container]);
  const g = board.gTerrain.children[0];
  let stopped = false;
  for (const fn of g.listeners.pointerdown ?? []) fn({ button: 0, stopPropagation() { stopped = true; } });
  return { destroyed, stopped };
};

const idle = press(false);
check('with no route drawn, a click on a Container asks to destroy it', idle.destroyed, ['ctr1']);
check('and keeps the click to itself', idle.stopped, true);
const page = press(undefined);
check('a page that says nothing about routes is as it was', [page.destroyed, page.stopped], [['ctr1'], true]);
const drawing = press(true);
check('while a route is drawn, the click asks nothing', drawing.destroyed, []);
check('and goes on to the board, which takes the Grid for the route', drawing.stopped, false);

// matchhud.ts's boardCallbacks, executed: `routing` reads its own movePlan.
const cbSrc = cut(hudSrc, 'function boardCallbacks(): BoardCallbacks {', 'function renderBoard(ctx: HudCtx): void {', 'the Match Centre board callbacks');
const hudSlice = new URL('./_containerclick.hud.slice.ts', import.meta.url);
writeFileSync(hudSlice, `type BoardCallbacks = any; type HudCtx = any; type Side = any;
let hudRef: any = null; let board: any = null; let placing: any = null; let launchPlan: any = null;
let pending: any = null; let inspectUid: any = null;
export let movePlan: any = null;
export function plan(p: any): void { movePlan = p; }
function snapPlacement(col: any, row: any, _size: any): any { return { col, row }; }
function normaliseSetup(_s: any): any { return null; }
function fitsZone(_ctx: any, _side: any, _at: any, _size: any): boolean { return true; }
function canReach(_ctx: any, _t: any, _col: any, _row: any): boolean { return false; }
function previewMove(_ctx: any, _c: any, _r: any): void {}
function undoWaypoint(_ctx: any): void {}
function commitWaypoint(_ctx: any): void {}
function deployFacing(_data: any, _s: any, _side: any, _at: any): number { return 0; }
function footprint(_x: any): any[] { return []; }
function showInspect(..._a: any[]): void {}
function confirmDialog(_o: any): Promise<boolean> { return Promise.resolve(false); }
export ${cbSrc}`);
const hud = await import(`${hudSlice.href}?v=${Date.now()}`);
const callbacks = hud.boardCallbacks();
check('the Match Centre says no route is drawn when none is', callbacks.routing(), false);
hud.plan({ uid: 1, path: [{ c: 5, r: 5 }] });
check('and says one is while its movePlan stands', callbacks.routing(), true);

// main.ts's callbacks live inside the page's boot, so the one line is read: the
// tabletop answers off its own movePlan the same way.
check('the tabletop answers `routing` off its movePlan', /routing\(\) \{\n\s*return !!movePlan;\n\s*\},\n\s*async onDestroyTerrain\(id\)/.test(mainSrc), true);

console.log(`\n${pass} passed, ${fail} failed`);
// The exit code, not process.exit(): exiting outright while Node is still closing the handle that compiled the
// slice above aborts on Windows (a libuv assertion, every run once the machine had 16 threads).
process.exitCode = fail ? 1 : 0;
