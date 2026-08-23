// The Match Centre's board hover, DRIVEN end to end.
//
// WHY THIS FILE EXISTS. The feature is three lines in three files and every one
// of them was defended by nothing. Measured by the round-5 reviewer
// (2026-08-19), each of these survived the whole 68-file suite at exit 0:
//
//   a) deleting matchhud.ts boardCallbacks' `onInspect(info, at) { showInspect(info, at); }`
//      outright, so the Board's hover text went back to being thrown away;
//   b) reverting board.ts attachInspect to `this.callbacks.onInspect?.(info)`,
//      so the floating box was never told what to stand beside;
//   c) neutering inspector.ts showInspect's `if (at) anchor = at;`, same effect
//      one file further down.
//
// The whole feature could have been reverted and nothing would have noticed.
//
// PINNED BEHAVIOURALLY, not by a source regex: the real board.ts listener fires
// into the real matchhud.ts callbacks object, which calls the real inspector.ts,
// which renders into a real (stub) DOM, and the assertions read WHERE THE BOX
// ENDED UP and WHAT IT SAYS. A regex over any of the three would punish a rename
// and would have missed (c) entirely, which changes no names at all.
//
// The two pages are both driven, because the claim being pinned is that this is
// additive: match.html has no docked #inspect-box and gets the floating popout;
// index.html has one and must be untouched.
import { readFileSync, writeFileSync } from 'node:fs';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}, got ${g}`); }
};

console.log('The Match Centre board hover, driven\n');

// ---------- a DOM small enough to run inspector.ts and honest about position ----------
//
// Only what inspector.ts touches. getBoundingClientRect and style are real
// values rather than stubs, because WHERE the box lands is the whole assertion:
// a shim that swallowed the coordinates would pass with the anchor never set.
class El {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.id = '';
    this.className = '';
    this.children = [];
    this.listeners = {};
    this.style = {};
    this.scrollTop = 0;
    this.isConnected = true;
    this.rect = { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 };
    this._html = '';
    this._classes = new Set();
    const self = this;
    this.classList = {
      add: (c) => self._classes.add(c),
      remove: (c) => self._classes.delete(c),
      contains: (c) => self._classes.has(c),
      toggle: (c, on) => { if (on === undefined) { if (self._classes.has(c)) self._classes.delete(c); else self._classes.add(c); } else if (on) self._classes.add(c); else self._classes.delete(c); },
    };
  }
  set innerHTML(v) { this._html = String(v); }
  get innerHTML() { return this._html; }
  get classes() { return [...this._classes].sort(); }
  appendChild(c) { this.children.push(c); return c; }
  addEventListener(k, fn) { (this.listeners[k] ??= []).push(fn); }
  removeEventListener() {}
  // The one selector render() reaches for is `.inspect-unpin`, which only
  // exists while a pin is up; nothing here pins, so null is the honest answer.
  querySelector() { return null; }
  querySelectorAll() { return []; }
  closest() { return null; }
  getBoundingClientRect() { return this.rect; }
  get offsetWidth() { return 0; }
  get offsetHeight() { return 0; }
  dispatch(k) { for (const fn of this.listeners[k] ?? []) fn({ target: this }); }
}

// `docked` is the difference between the two pages, and it is the only one:
// index.html carries <div id="inspect-box">, match.html does not.
function installDom(docked) {
  const body = new El('body');
  const dockedBox = docked ? new El('div') : null;
  if (dockedBox) dockedBox.id = 'inspect-box';
  globalThis.document = {
    body,
    createElement: (t) => new El(t),
    getElementById: (id) => (id === 'inspect-box' ? dockedBox : null),
    addEventListener() {},
    removeEventListener() {},
  };
  globalThis.window = globalThis;
  globalThis.innerWidth = 1400;
  globalThis.innerHeight = 900;
  return { body, dockedBox };
}

// ---------- the three real modules ----------

const cut = (s, a, b, what) => {
  const i = s.indexOf(a), j = s.indexOf(b, i);
  if (i < 0 || j < 0 || j <= i) throw new Error(`could not locate ${what}`);
  if (s.indexOf(a, i + 1) >= 0) throw new Error(`${what}: start marker is not unique`);
  return s.slice(i, j);
};
const srcOf = (f) => readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8');
const boardSrc = srcOf('board.ts');
const hudSrc = srcOf('matchhud.ts');
const inspectorSrc = srcOf('inspector.ts');

// board.ts's attachInspect, executed rather than read. It closes over nothing
// but `this.callbacks`, so a two-field stand-in class runs the shipped lines
// exactly as the Board does. `private` is dropped and nothing else is: the
// modifier is a compile-time word and the test calls the method from outside.
const attachSrc = cut(boardSrc,
  '  private attachInspect(g: SVGGElement, info: InspectInfo): void {',
  '  renderTerrain(', 'board.ts attachInspect').replace('  private attachInspect', '  attachInspect');
const boardSlice = new URL('./_boardhover.board.slice.ts', import.meta.url);
writeFileSync(boardSlice, `type InspectInfo = any; type SVGGElement = any;
export class BoardTokens {
  callbacks: any;
  constructor(callbacks: any) { this.callbacks = callbacks; }
${attachSrc}}
`);
const { BoardTokens } = await import(`${boardSlice.href}?v=${Date.now()}`);

// matchhud.ts's boardCallbacks, executed with the REAL showInspect imported into
// it. Every other collaborator is stubbed, because none of them is on the hover
// path; onInspect is the one member this file drives.
//
// ONE cut out of matchhud.ts, boardCallbacks through renderBoard. Both markers
// checked unique. armorpiercing.test.mjs takes defensePanel..panelHtml out of
// the same file, which sits well below this and does not overlap.
const cbSrc = cut(hudSrc,
  'function boardCallbacks(): BoardCallbacks {',
  'function renderBoard(ctx: HudCtx): void {', 'the Match Centre board callbacks');

// A fresh inspector.ts module per page, because its box, its mode and its
// anchor are module-level state. The query string is what gives node a separate
// instance, and the slice below is written with the SAME query so the callbacks
// and the assertions are talking to one module and not two.
let stamp = 0;
async function page(docked) {
  const dom = installDom(docked);
  const v = `v${++stamp}`;
  const inspector = await import(`${new URL('../src/inspector.ts', import.meta.url).href}?${v}`);
  const slice = new URL(`./_boardhover.hud.${v}.slice.ts`, import.meta.url);
  writeFileSync(slice, `import { showInspect } from '../src/inspector.ts?${v}';
type BoardCallbacks = any; type HudCtx = any; type Side = any;
let hudRef: any = null;
let board: any = null;
let placing: any = null;
let movePlan: any = null;
let launchPlan: any = null;
let pending: any = null;
let inspectUid: any = null;
function snapPlacement(col: any, row: any, _size: any): any { return { col, row }; }
function normaliseSetup(_s: any): any { return null; }
function fitsZone(_ctx: any, _side: any, _at: any, _size: any): boolean { return true; }
function canReach(_ctx: any, _t: any, _col: any, _row: any): boolean { return false; }
function previewMove(_ctx: any, _c: any, _r: any): void {}
function undoWaypoint(_ctx: any): void {}
function commitWaypoint(_ctx: any): void {}
function deployFacing(_data: any, _s: any, _side: any, _at: any): number { return 0; }
function footprint(_x: any): any[] { return []; }
export ${cbSrc}`);
  const mod = await import(`${slice.href}?${v}`);
  return { ...dom, inspector, callbacks: mod.boardCallbacks() };
}

// A board token badge: an SVG group with a place on the screen. The Board hands
// this very object to onInspect, and the popout stands beside it.
const badge = (left, top) => {
  const g = new El('g');
  g.rect = { top, left, right: left + 40, bottom: top + 20, width: 40, height: 20 };
  return g;
};
const TOKEN_A = { title: 'M1 Wolverine', sub: 'RDL · Large Mech', lines: ['Link 3 of 4', 'Offensive Stance'] };
const TOKEN_B = { title: 'D7 Tarantula', sub: 'UN · Carrier Drone', lines: ['Carrying JP1 Jetpack'] };

// ---------- 1. the Match Centre: match.html has no docked box ----------
{
  const mc = await page(false);
  const board = new BoardTokens(mc.callbacks);
  const a = badge(500, 300);
  const b = badge(500, 620);
  board.attachInspect(a, TOKEN_A);
  board.attachInspect(b, TOKEN_B);

  // THE ASSERTION THE WHOLE FEATURE HANGS ON. Before this shipped, the Board
  // built all of this text and the Match Centre supplied no onInspect, so it
  // went nowhere at all.
  a.dispatch('pointerenter');
  // Read lazily rather than captured: with the Match Centre's onInspect gone
  // nothing appends a box at all, and a captured undefined would crash this
  // file instead of reporting which assertions the deletion broke.
  const popNow = () => mc.body.children[0];
  const popHtml = () => popNow()?.innerHTML ?? '';
  const pop = popNow();
  check('hovering a board token puts a box on the Match Centre page at all', !!pop, true);
  check('...the floating popout, since match.html carries no docked box', pop?.id, 'inspect-pop');
  check('...visible', pop?.classes, ['visible']);
  check('...carrying the hovered token\'s own title', /M1 Wolverine/.test(pop?.innerHTML ?? ''), true);
  check('...its subtitle', /RDL · Large Mech/.test(pop?.innerHTML ?? ''), true);
  check('...and every line the Board wrote for it',
    ['Link 3 of 4', 'Offensive Stance'].filter((l) => (pop?.innerHTML ?? '').includes(`<li>${l}</li>`)),
    ['Link 3 of 4', 'Offensive Stance']);

  // WHERE IT LANDED, which is the half that the `at` plumbing exists for and
  // the half that all three mutations break. The badge sits at left 500, top
  // 300; the box is 300 wide by default and stands to its left.
  check('the box stands beside the badge the cursor is on, not wherever it was left',
    [pop?.style.left, pop?.style.top], ['190px', '300px']);

  // THE SECOND HOVER, and the exact failure the reviewer described: without the
  // element travelling with the info, the box renders visible and place() bails
  // on a stale anchor, leaving the words parked where the last hover left them.
  a.dispatch('pointerleave');
  b.dispatch('pointerenter');
  check('a second badge moves the box to itself', pop?.style.top, '620px');
  check('...and swaps the text over with it',
    [/D7 Tarantula/.test(pop?.innerHTML ?? ''), /M1 Wolverine/.test(pop?.innerHTML ?? '')], [true, false]);

  // Leaving takes it away rather than leaving a box in the way saying nothing.
  b.dispatch('pointerleave');
  check('leaving the badge hides the box', pop?.classes, []);
  check('...and empties it', pop?.innerHTML, '');

  // ---------- what OTTO required: TEXT ONLY, never an image ----------
  //
  // Three separate things have to hold, so all three are asserted rather than
  // one standing in for the others.
  b.dispatch('pointerenter');
  check('nothing the box draws is an image element',
    /<img|<picture|<svg|background-image|url\(/i.test(pop?.innerHTML ?? ''), false);

  // An image channel offered to it is DROPPED, not rendered. The board page and
  // the Match Centre both build InspectInfo by hand, so the guard that matters
  // is the renderer's: it interpolates title, sub and lines and nothing else.
  const sneaky = badge(500, 200);
  board.attachInspect(sneaky, { ...TOKEN_A, image: '/img/cards/172.png', art: '/img/parts/088.png' });
  sneaky.dispatch('pointerenter');
  check('an image handed to the box in a field of its own never reaches the markup',
    /172\.png|088\.png|img\/cards|img\/parts/.test(pop?.innerHTML ?? ''), false);
  check('...while the text on the same info still renders', /M1 Wolverine/.test(pop?.innerHTML ?? ''), true);

  // THE SAME BOX THE KEYWORD POPUP USES, which is the comparison OTTO drew.
  // inspectOnHover is what linkMechanics binds to every keyword chip; driving
  // one has to land in the identical element, or "the same as the keyword
  // popup" is not a claim this page can make.
  const chip = new El('span');
  // Kept clear of the bottom of the window: place() pulls the box back up when
  // it would run off, and a clamped answer would say nothing about the anchor.
  chip.rect = { top: 500, left: 900, right: 960, bottom: 520, width: 60, height: 20 };
  mc.inspector.inspectOnHover(chip, { title: 'Armor Piercing X', sub: '6.2.1', lines: ['Target removes X White dice before rolling.'] });
  chip.dispatch('pointerenter');
  check('a keyword chip renders into the very same box the board hover uses', mc.body.children.length, 1);
  check('...with the same text-only markup',
    [/Armor Piercing X/.test(popHtml()), /<img/i.test(popHtml())], [true, false]);
  check('...and the same anchoring, beside the chip', popNow()?.style.top, '500px');

  // The shape of InspectInfo itself, read off the shipped interface. This is a
  // TYPE and there is nowhere else to ask: a fourth field called `image` would
  // compile, would flow through every call site, and no behavioural assertion
  // above could see it arrive until something rendered it.
  const iface = cut(inspectorSrc, 'export interface InspectInfo {', '}', 'the InspectInfo interface');
  check('InspectInfo still carries exactly title, sub and lines, with no image channel',
    iface.split('\n').slice(1).map((l) => l.trim().replace(/\??:.*$/, '')).filter(Boolean),
    ['title', 'sub', 'lines']);
}

// ---------- 2. the board page: index.html has a docked #inspect-box ----------
//
// THE ADDITIVE CLAIM, driven. showInspect grew a second parameter and board.ts
// started supplying one; the freeplay page passes none and must be untouched by
// either. Byte for byte the same behaviour it had before, which here means: the
// docked box gets the text, no popout is ever created, and nothing is positioned.
{
  const fp = await page(true);
  const board = new BoardTokens(fp.callbacks);
  const a = badge(500, 300);
  board.attachInspect(a, TOKEN_A);
  a.dispatch('pointerenter');
  check('the board page renders into its docked box', /M1 Wolverine/.test(fp.dockedBox.innerHTML), true);
  check('...and no floating popout is created beside it', fp.body.children.length, 0);
  check('...with nothing positioned, because a docked box does not move',
    [fp.dockedBox.style.left, fp.dockedBox.style.top], [undefined, undefined]);
  check('...and no visibility class toggled either', fp.dockedBox.classes, []);
  a.dispatch('pointerleave');
  check('leaving puts the idle line back rather than emptying it',
    /Hover for details/.test(fp.dockedBox.innerHTML), true);
}

// ---------- 3. board.ts's own half, in isolation ----------
//
// The end-to-end drive above catches a reverted attachInspect through the
// POSITION of the box, which is a long way from the line that broke. This says
// it directly: the element goes with the info on ENTER and deliberately does
// not on LEAVE, because re-anchoring a box to a node the cursor has just left
// would move it on its way out.
{
  const seen = [];
  const board = new BoardTokens({ onInspect(...args) { seen.push(args); } });
  const g = badge(10, 20);
  board.attachInspect(g, TOKEN_A);
  g.dispatch('pointerenter');
  g.dispatch('pointerleave');
  check('the Board fires twice for one hover', seen.length, 2);
  check('...handing the info AND the hovered element over on enter',
    [seen[0]?.length, seen[0]?.[0]?.title, seen[0]?.[1] === g], [2, 'M1 Wolverine', true]);
  check('...and passing nothing but null on leave, so the box is not re-anchored on its way out',
    [seen[1]?.length, seen[1]?.[0]], [1, null]);
}

// ---------- 4. the Match Centre really is the page that lacks a docked box ----------
//
// The mode is chosen by inspector.ts from the DOM rather than from a flag, so
// the two pages' markup is what decides it. Asserted against the shipped HTML,
// because the whole of section 1 is measuring the wrong page if match.html ever
// grows one.
{
  const html = (f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
  check('index.html carries the docked box', /id="inspect-box"/.test(html('index.html')), true);
  check('match.html does not, which is what puts it on the floating popout',
    /id="inspect-box"/.test(html('match.html')), false);
}

// ---------- the measuring line, now on both boards ----------
// OTTO: "Lets add the freeplay board feature for distance and LOS when
// selecting a unit and hovering over another in multiplayer. In freeplay it
// draws a yellow dashed line and says something like 'range 3 - clear'."
//
// The Board already fired onHover on both pages; the Match Centre simply never
// supplied one, so every hover was thrown away. Same shape as the onInspect
// gap this file was written for.
{
  const hud = readFileSync(new URL('../src/matchhud.ts', import.meta.url), 'utf8');
  const app = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
  check('the Match Centre now answers board hovers', /^    onHover\(uid\) \{/m.test(hud), true);
  check('and draws the same line freeplay draws', /board\.showRange\(sel, hov,/.test(hud), true);
  check('clearing it when there is nothing to measure',
    /if \(!sel \|\| !hov \|\| sel\.uid === hov\.uid\) \{ board\.clearRange\(\); return; \}/.test(hud), true);
  // Smoke beats the geometry (4.6), so it is asked FIRST on both boards. Asking
  // losBetween first would report 'clear' through a Screen.
  for (const [name, src] of [['freeplay', app], ['the Match Centre', hud]]) {
    check(`${name} asks smoke before line of sight`,
      /smokeBlocks\([^)]*\) \? 'smoked' : losBetween\(/.test(src), true);
  }
  // The reading itself is written once per board but must AGREE, so the same
  // three cases are spelled the same way in both.
  for (const [name, src] of [['freeplay', app], ['the Match Centre', hud]]) {
    check(`${name} names the same three readings`,
      [/'same grid'/.test(src), /'adjacent \u00b7 R1'/.test(src), /Range \$\{dc \+ dr\}/.test(src)],
      [true, true, true]);
  }
  // WHICH unit measures FROM. A live targeting is the question being asked, so
  // it outranks the opened card, which outranks whoever holds the Opportunity.
  // Getting this order wrong makes the line jump to the active unit mid-aim.
  check('a live targeting owns the line before anything else',
    /attackPick\?\.uid \?\? ewPick\?\.uid \?\? inspectUid \?\? ensureScript\(s\)\.opp\?\.uid/.test(hud), true);
  // The shield readout belongs to a real attack targeting only: nothing can
  // redirect a hover that is not aiming anything.
  check('and the Automatic Shield note is read only while aiming',
    /const aimed = attackPick \? actionOn\(ctx, sel, attackPick\.actionId\) : undefined;/.test(hud), true);
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
