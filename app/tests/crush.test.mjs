// The Crush (rulebook 4.3.6), DRIVEN rather than read.
//
// rules/03_stance_los_movement_attacks.md:170 (book p.47): a Crush is resolved
// as a Unit is "about to enter a Grid occupied by another Unit"; the crushed
// Unit "undergoes Forced Movement of 1 Grid"; and where NONE of the Grids within
// range of that Forced Movement can be entered it "instead EXCHANGES POSITIONS
// with the Crushing Unit". Worked example (C) at :173 has the pair side by side
// and ends the crusher's Movement there.
//
// WHY THIS FILE EXISTS AND NOT ANOTHER REGEX. commands.test.mjs pins the
// geometry (rules.ts) and the command reader (commands.ts); wiring.test.mjs pins
// that the two pages CALL them. Neither runs the two pages' own crush loops, and
// the defects this file was written for lived in exactly that gap:
//
//   * main.ts resolveCrush declared `const from = largeGridOf(v)` INSIDE the
//     step, shadowing the `from: LargeGrid | null` parameter. The shadow is
//     typed non-nullable, so `if (!from)` was dead code tsc had no complaint
//     about and a call-site regex could not see. A drag from across the board
//     asked the facing question that branch exists to skip and then blamed ROOM
//     for what was really DISTANCE.
//   * both pages offered the 4.3.6 exchange and only then discovered it could
//     not be made — a question the engine had already decided to refuse.
//   * and the Match Centre answered a REFUSED exchange by returning with no
//     Movement recorded at all, where freeplay ends the Movement at the last
//     Grid of the route that had room.
//
// Every assertion here is driven: the real resolveCrush, the real advanceCrush,
// the real crushPanel string, against the real rules.ts geometry.
import { readFileSync, writeFileSync } from 'node:fs';

const src = (f) => readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8');
const rules = src('rules.ts'), mainSrc = src('main.ts'), hudSrc = src('matchhud.ts');

const cut = (s, a, b, what) => {
  const i = s.indexOf(a);
  const j = b === null ? s.length : s.indexOf(b, i);
  if (i < 0 || j < 0 || j <= i) throw new Error(`could not locate ${what}`);
  return s.slice(i, j);
};

// The rules.ts geometry, sliced exactly as commands.test.mjs slices it — LG,
// largeGridOf, standingSpot, and the CrushVictims..reachableGrids block that
// carries crushTargets, crushExchangeSpots and crushExchange. Mirroring
// standingSpot's occupancy walk here instead would let this file agree with a
// copy while the app puts a Mech on top of a Drone.
const geometry = cut(rules, 'let GRIDS', 'export function smokeKey', 'the board size')
  + cut(rules, 'export function largeGridOf', '// Where inside Large Grid', 'largeGridOf')
  + cut(rules, '// Where inside Large Grid', 'export function spotsInGrid', 'standingSpot')
  + cut(rules, 'export interface CrushVictims', 'export function reachableGrids', 'the Crush geometry');

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}, got ${g}`); }
};

console.log('The Crush, driven (4.3.6)\n');

// ---------- the boards both pages are driven on ----------
//
// The same shapes commands.test.mjs uses: a Large crusher fills a whole Grid, a
// Drone takes a cell of one. The walls are enemy Mechs, so a victim is proved
// boxed in by the real standingSpot rather than assumed to be.
const grid = (c, r, size) => ({ col: c * 3 + (size === 3 ? 0 : 1), row: r * 3 + (size === 3 ? 0 : 1) });
const big = (uid, side, c, r, over = {}) => ({
  uid, side, kind: 'mech', stance: 'offensive', label: `M${uid}`, facing: 0, size: 3,
  aerial: false, mech: { torso: 'T1', pilot: 'P1' }, partStates: { torso: 'intact' }, log: [],
  ...grid(c, r, 3), ...over,
});
const small = (uid, side, c, r, over = {}) => ({
  uid, side, kind: 'drone', stance: 'offensive', label: `D${uid}`, facing: 0, size: 1,
  aerial: false, cardId: 'D1', partStates: { main: 'intact' }, ammo: {}, log: [],
  ...grid(c, r, 1), ...over,
});
const gridOf = (p) => [Math.floor(p.col / 3), Math.floor(p.row / 3)];
// The three Grids around the crushed Grid that are NOT the route, walled off so
// the only Grid left to argue about is the one the crusher steps out of.
const walls = () => [big(3, 's2', 0, 2), big(4, 's2', 2, 2), big(5, 's2', 1, 3)];

// ---------- freeplay: main.ts resolveCrush ----------
//
// The whole function, sliced with askCrushFacing beside it because the two are
// one behaviour: which questions the Crush asks, and which it answers itself.
// Everything it reaches out of the page closure is a RECORDER, so an assertion
// below can say "no dialog was raised" rather than "the source has an early
// return in it".
const mainTmp = new URL('./_crushfree.slice.ts', import.meta.url);
writeFileSync(mainTmp, `type Token = any;
type LargeGrid = { c: number; r: number };
type CrushVictims = any;
type Facing = any;
type Command = any;
type TerrainPiece = any;
export const rec: any = { logs: [], dialogs: [], hints: [], sent: [] };
export let state: any = { tokens: [] };
export function setBoard(tokens: any[]): void { state = { tokens }; rec.logs = []; rec.dialogs = []; rec.hints = []; rec.sent = []; }
// The verdict check() hands back, so the refusal path can be driven too.
export let verdict: any = { ok: true };
export function setVerdict(v: any): void { verdict = v; }
const data: any = {};
function currentTerrain(): any[] { return []; }
function logTo(_t: any, msg: string): void { rec.logs.push(msg); }
function setHint(msg: string): void { rec.hints.push(msg); }
// Stubbed, not sliced: WHICH Units may be Force-Moved is melee.ts's rule and
// meleelock.test.mjs's business. What is driven here is what the Crush loop does
// with the answer.
function canBeForceMoved(_data: any, t: any): boolean { return t.forceMovable !== false; }
function perform(_d: any, _s: any, cmd: any): void { rec.sent.push(cmd); }
function check(_d: any, _s: any, _cmd: any): any { return verdict; }
const board: any = {
  renderTerrain() {}, renderTokens() {}, clearHighlights() {},
  showSmokeTargets(spots: any[], _pick: any) { rec.hints.push('lit:' + spots.length); },
};
// The real dialog is a modal; here it records the question and answers "leave
// its facing alone", which is the choice that changes nothing on the board.
async function choiceDialog(o: any): Promise<string> { rec.dialogs.push(o.title + ' :: ' + o.body); return ''; }
`
  + geometry
  + cut(mainSrc, '  function gridRef(c: number, r: number): string {', '\r\n\r\n', 'gridRef')
  + cut(mainSrc, '  function resolveCrush(t: Token, goal: LargeGrid', '  function cancelMove(): void {', 'resolveCrush')
  + '\nexport { resolveCrush, askCrushFacing };\n');
const F = await import(mainTmp.href);

const settle = () => new Promise((r) => setTimeout(r, 5));

// A drag-drop has no route, so main.ts hands `from = null` — see its onMove
// ruling. The victim is boxed in on all four sides, so the queue reaches the
// exchange branch, and the branch has to refuse BEFORE it asks anything.
{
  const tokens = [big(1, 's1', 0, 0), small(2, 's2', 1, 2), ...walls(), big(6, 's2', 1, 1)];
  F.setBoard(tokens);
  let placed = null;
  F.resolveCrush(tokens[0], { c: 1, r: 2 }, { units: [tokens[1]], terrain: [] }, null, (p) => { placed = p; });
  await settle();
  // THE ASSERTION THE VARIABLE SHADOW KILLED. With `from` shadowed by
  // `largeGridOf(v)` the branch could never fire, so the reviewer's drag raised
  // "Turn D2?" first and only then said there was no room.
  check('a drag with no step-out Grid raises NO facing dialog', F.rec.dialogs, []);
  check('and says so exactly once', F.rec.logs.length, 1);
  // The REASON, which is the other half of what was wrong: the exchange is
  // unavailable because the drop came from further off than the next Grid, not
  // because the Grid it would trade for is full.
  check('and blames the distance rule', /single Grid boundary/.test(F.rec.logs[0]), true);
  check('and not room', /no room/.test(F.rec.logs[0]), false);
  check('nothing is sent and the crusher is not placed', [F.rec.sent, placed], [[], false]);
}

// The control, and the proof the branch above is reached by DISTANCE and not by
// the fixture: the same boxed-in victim, with the crusher standing next door.
// Now the facing question is right to ask and the exchange lands.
{
  const tokens = [big(1, 's1', 1, 1), small(2, 's2', 1, 2), ...walls()];
  F.setBoard(tokens);
  let placed = null;
  F.resolveCrush(tokens[0], { c: 1, r: 2 }, { units: [tokens[1]], terrain: [] }, { c: 1, r: 1 }, (p) => { placed = p; });
  await settle();
  check('with a Grid next door the facing question IS asked', F.rec.dialogs.length, 1);
  check('and it is asked about the crushed Unit', /Turn D2\?/.test(F.rec.dialogs[0]), true);
  check('one command carries the whole exchange', F.rec.sent.map((c) => c.kind), ['crushSwap']);
  check('the crushed Unit takes the Grid the crusher steps out of',
    F.rec.sent[0].swaps.map((s) => gridOf(s.to)), [[1, 1]]);
  check('and the crusher lands in the Grid it was entering', gridOf(F.rec.sent[0].to), [1, 2]);
  check('so the caller is told the crusher has already been placed', placed, true);
}

// The other half of the same ruling: a step-out Grid that is FULL. The exchange
// is impossible for a reason the engine already knows, so it must not be dressed
// up as a question either — and the reason given has to be room, which is what
// it actually is here.
{
  const tokens = [big(1, 's1', 1, 0), small(2, 's2', 1, 2), ...walls(), big(6, 's2', 1, 1)];
  F.setBoard(tokens);
  let placed = null;
  F.resolveCrush(tokens[0], { c: 1, r: 2 }, { units: [tokens[1]], terrain: [] }, { c: 1, r: 1 }, (p) => { placed = p; });
  await settle();
  check('a step-out Grid with somebody else in it raises no dialog either', F.rec.dialogs, []);
  check('and names the Grid that has no room', /B2, the Grid M1 is stepping out of/.test(F.rec.logs[0]), true);
  check('and the Crush is not placed', placed, false);
}

// A refused crushSwap: resolveCrush asks check() BEFORE perform(), because an
// ordinary freeplay board warns rather than blocks and would otherwise apply a
// command the log had just said did not happen.
{
  const tokens = [big(1, 's1', 1, 1), small(2, 's2', 1, 2), ...walls()];
  F.setBoard(tokens);
  F.setVerdict({ ok: false, why: 'the leash says no.' });
  let placed = null;
  F.resolveCrush(tokens[0], { c: 1, r: 2 }, { units: [tokens[1]], terrain: [] }, { c: 1, r: 1 }, (p) => { placed = p; });
  await settle();
  F.setVerdict({ ok: true });
  check('a refused exchange sends nothing', F.rec.sent, []);
  check('and reports the refusal rather than narrating a swap',
    /could not exchange places with D2: the leash says no\./.test(F.rec.logs[F.rec.logs.length - 1]), true);
  check('and hands the caller back an unplaced crusher', placed, false);
}

// ---------- the Match Centre: matchhud.ts advanceCrush and crushPanel ----------
//
// The whole crush block, from the plan type through the panel that renders it.
// The page's own helpers come with it (crushEscapes, finishCrush, the facing
// confirm); everything outside the block is a recorder.
const hudTmp = new URL('./_crushhud.slice.ts', import.meta.url);
writeFileSync(hudTmp, `type Token = any;
type LargeGrid = { c: number; r: number };
type Facing = any;
type HudCtx = any;
type Side = any;
type TerrainPiece = any;
type GameData = any;
export const rec: any = { notes: [], sent: [], tow: 0, mines: 0, boxes: 0, shove: 0 };
export function reset(): void { rec.notes = []; rec.sent = []; rec.tow = 0; rec.mines = 0; rec.boxes = 0; rec.shove = 0; }
export function setPlan(p: any): void { crushPlan = p; }
export function readPlan(): any { return crushPlan; }
// Stubbed for the same reason freeplay's is: whose rule it is decides where it
// is pinned, and this file is about the crush LOOP.
function canBeForceMoved(_data: any, t: any): boolean { return t.forceMovable !== false; }
function towDraggedAlly(): void { rec.tow++; }
function offerMinesOn(): void { rec.mines++; }
function offerBoxesOn(): void { rec.boxes++; }
function startShove(): void { rec.shove++; }
// animateMove is SVG only in the app and runs its callback when the walk ends;
// here it runs it straight away, which is the same ordering.
const board: any = { clearHighlights() {}, showSmokeTargets() {}, animateMove(_uid: number, _stops: any[], cb: any) { cb(); } };
`
  + geometry
  + cut(hudSrc, 'function esc(s: string): string {', '// ---------- the guide glue', 'esc')
  // mapPieces is SLICED, not stubbed: terrainOf reads it, and a stub that only
  // knew about terrain layouts would hide an authored map's own pieces -- the
  // exact thing E4 added.
  + cut(hudSrc, 'function mapPieces(data: GameData, map: string)', '// ---------- zones & deployment geometry', 'mapPieces')
  + cut(hudSrc, 'function terrainOf(ctx: HudCtx) {', '// `steps` is how far this particular Movement reaches', 'terrainOf')
  + cut(hudSrc, 'function head(eyebrow: string', 'function waiting(side: Side', 'head')
  + cut(hudSrc, 'function gridName(c: number, r: number): string {', '// What the Forced Movement would do, or why it does nothing.', 'gridName')
  + cut(hudSrc, 'let crushPlan: {', '// ---------- Resupply (rulebook 4.13) ----------', 'the crush block')
  + '\nexport { advanceCrush, finishCrush, crushPanel, confirmCrushed, placeCrushed, crushEscapes, gridName };\n');
const H = await import(hudTmp.href);

// The mutation the real command layer performs, in the two shapes this loop
// sends. Enough for the next reader in the same run to see a moved board — which
// is the whole point of the two-victim fixture below.
const applyCmd = (tokens, cmd) => {
  if (cmd.kind === 'forceMove') {
    const v = tokens.find((x) => x.uid === cmd.targetUid);
    if (v) { v.col = cmd.to.col; v.row = cmd.to.row; }
  }
  if (cmd.kind === 'crushSwap') {
    for (const s of cmd.swaps) {
      const v = tokens.find((x) => x.uid === s.uid);
      if (v) { v.col = s.to.col; v.row = s.to.row; }
    }
    const t = tokens.find((x) => x.uid === cmd.uid);
    if (t) { t.col = cmd.to.col; t.row = cmd.to.row; }
  }
};
const hudCtx = (tokens, verdict = () => ({ ok: true })) => ({
  data: { terrain: { layouts: { M1: [] } } },
  state: { tokens, map: 'M1', removedTerrain: [] },
  send(cmd) { H.rec.sent.push(cmd); const v = verdict(cmd); if (v.ok) applyCmd(tokens, cmd); return v; },
  noteNow(text) { H.rec.notes.push(text); },
  refresh() {},
});
// commitMove walks m.path and keeps a standing spot for EVERY Grid on it,
// including the one the Movement began in — so stops and path are the same
// length, and `walk`/`held` below are the route minus its last Grid.
const plan = (uid, goal, queue, path) => ({
  uid, goal, terrain: [], queue, exchanges: [], path,
  stops: path.map((g) => grid(g.c, g.r, 3)), steps: path.length - 1, flying: false,
});
const maneuvers = () => H.rec.sent.filter((c) => c.kind === 'maneuver');
const swaps = () => H.rec.sent.filter((c) => c.kind === 'crushSwap');

// The exchange, offered and taken. The crusher is entering B3 from B2 and the
// Drone in B3 is walled in on its other three sides.
{
  const tokens = [big(1, 's1', 1, 1), small(2, 's2', 1, 2), ...walls()];
  const ctx = hudCtx(tokens);
  H.reset();
  H.setPlan(plan(1, { c: 1, r: 2 }, [2], [{ c: 1, r: 1 }, { c: 1, r: 2 }]));
  H.advanceCrush(ctx);
  const p = H.readPlan();
  check('a boxed-in victim stops the Crush on the 4.3.6 exchange', !!p?.pendingSpot?.exchange, true);
  // THE PANEL TEXT, which nothing pinned before this line existed.
  check('the panel names the Grid the crusher steps out of, B2',
    /exchanges positions with M1 in B2 \(4\.3\.6\)/.test(H.crushPanel(ctx)), true);
  check('and the pendingSpot carries that same Grid', [p.pendingSpot.c, p.pendingSpot.r], [1, 1]);
  H.confirmCrushed(ctx);
  check('the exchange really lands the Unit there', swaps().map((c) => gridOf(c.swaps[0].to)), [[1, 1]]);
  check('with the crusher in the Grid it was entering', swaps().map((c) => gridOf(c.to)), [[1, 2]]);
  // The Movement is recorded separately, and says where it STARTED, because the
  // crushSwap above has already written the crusher's position.
  check('and the Movement is recorded from where it began',
    maneuvers().map((c) => [gridOf(c.to), gridOf(c.from)]), [[[1, 2], [1, 1]]]);
}

// R2b, on the shape that actually reaches it. A routed Crush B1 -> B2 -> B3
// carrying TWO victims: the Drone is shoved into B2 (the only Grid open to it),
// which leaves the 2x2 Unit behind it with no escape AND no room in B2 either —
// the Drone is standing in the middle of it. The exchange is impossible before
// the player is asked anything, so it must not be asked.
{
  const wide = { uid: 7, side: 's2', kind: 'drone', stance: 'offensive', label: 'W7', facing: 0, size: 2,
    aerial: false, cardId: 'D2', partStates: { main: 'intact' }, ammo: {}, log: [], col: 3, row: 6 };
  const tokens = [big(1, 's1', 1, 0), small(2, 's2', 1, 2, { col: 5, row: 8 }), wide, ...walls()];
  const ctx = hudCtx(tokens);
  H.reset();
  H.setPlan(plan(1, { c: 1, r: 2 }, [2, 7], [{ c: 1, r: 0 }, { c: 1, r: 1 }, { c: 1, r: 2 }]));
  H.advanceCrush(ctx);
  check('the Drone has exactly one Grid to be shoved into, B2',
    H.crushEscapes(ctx, tokens[1], { c: 1, r: 2 }).map((g) => [g.c, g.r]), [[1, 1]]);
  H.placeCrushed(ctx, 1, 1);
  H.confirmCrushed(ctx);
  check('and it takes the middle of it', gridOf(tokens[1]).concat([tokens[1].col, tokens[1].row]), [1, 1, 4, 4]);
  // ...which leaves W7 with nowhere to go and nowhere to trade for.
  check('the second victim is offered no facing question at all', H.readPlan(), null);
  check('and is told why, naming the Grid with no room',
    /B2, the Grid M1 is stepping out of, has no room for it either/.test(H.rec.notes[H.rec.notes.length - 2]), true);
  check('no crushSwap is sent', swaps().length, 0);
  // The Movement still happened and still pays: it stops short at the last Grid
  // of the route that had room, which is where freeplay leaves it too.
  check('the Crush stops short one Grid on', maneuvers().map((c) => gridOf(c.to)), [[1, 1]]);
  check('and the Unit that could not be moved is still standing in B3', gridOf(wide), [1, 2]);
  // NO `from` on a Crush that stopped short, and this is the sender half of the
  // command-layer guard: nothing has placed the crusher, so the Movement starts
  // where the token stands and the field must be absent. check() refuses a
  // `from` on any Maneuver whose Unit is not already standing on its landing
  // spot (commands.ts, the `maneuver` case), so a page that sent one here would
  // have its own Movement refused across the wire.
  check('and it carries no `from`, because nothing placed the crusher',
    maneuvers().map((c) => c.from), [undefined]);
}

// R5. A crushSwap check() REFUSES ends where a Crush that would not fit ends —
// at `held`, the last Grid of the route that had room — and offers the route's
// Mines and Boxes on the way out, which is what freeplay does with the same
// verdict. It used to return straight after the send: no maneuver, no Mines, no
// Boxes, and the Maneuver the page had already charged for never recorded.
{
  const tokens = [big(1, 's1', 1, 1), small(2, 's2', 1, 2), ...walls()];
  const ctx = hudCtx(tokens, (cmd) => (cmd.kind === 'crushSwap' ? { ok: false, why: 'the leash says no.' } : { ok: true }));
  H.reset();
  H.setPlan(plan(1, { c: 1, r: 2 }, [2], [{ c: 1, r: 1 }, { c: 1, r: 2 }]));
  H.advanceCrush(ctx);
  H.confirmCrushed(ctx);
  check('a refused exchange still records the Movement', maneuvers().map((c) => gridOf(c.to)), [[1, 1]]);
  check('and reports the refusal as a Crush that stopped short',
    /could not exchange places with D2: the leash says no\. The Crush stops short of B3/.test(H.rec.notes[H.rec.notes.length - 1]), true);
  check('and the route\'s Mines and Boxes are still offered', [H.rec.mines, H.rec.boxes], [1, 1]);
  check('and nothing on the board moved', [gridOf(tokens[0]), gridOf(tokens[1])], [[1, 1], [1, 2]]);
  // The same sender half again, on the branch where it matters most: the
  // exchange was REFUSED, so the crusher is still standing where the Movement
  // began and a `from` would be a placement that never happened. check() would
  // refuse the Movement outright, and the page would then have charged for a
  // Maneuver that never recorded.
  check('and a refused exchange carries no `from` either',
    maneuvers().map((c) => c.from), [undefined]);
}

// The ordinary shove, unchanged: a victim with somewhere to go is never offered
// an exchange at all, and the panel asks for a Grid rather than a Facing.
{
  const tokens = [big(1, 's1', 1, 1), small(2, 's2', 1, 2), big(3, 's2', 0, 2), big(4, 's2', 2, 2)];
  const ctx = hudCtx(tokens);
  H.reset();
  H.setPlan(plan(1, { c: 1, r: 2 }, [2], [{ c: 1, r: 1 }, { c: 1, r: 2 }]));
  H.advanceCrush(ctx);
  check('a victim with a free neighbour keeps its escape Grid',
    H.crushEscapes(ctx, tokens[1], { c: 1, r: 2 }).map((g) => [g.c, g.r]), [[1, 3]]);
  check('and the panel asks where it goes, not which way it faces',
    /Crush: where does D2 go\?/.test(H.crushPanel(ctx)), true);
  check('with no exchange pending', !!H.readPlan()?.pendingSpot, false);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
