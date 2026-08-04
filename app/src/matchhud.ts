import { missionZones, taskDesignations, type Command, type CheckResult } from './commands';
import type { GameData } from './data';
import { secondaryImageUrl, squadLabel } from './data';
import { Board, footprint, snapPlacement, type BoardCallbacks } from './board';
import { printedDeployment, resolveZoneSetData } from './overlays';
import { maneuverRange, squadAllegiance } from './units';
import { crushTargets, extendPath, reachableGrids, standingSpot, type LargeGrid } from './rules';
import { breakAwayCost } from './melee';
import { factionColour } from './icons';
import { iconSvg } from './dice';
import type { DiceData, DieColor, GameState, Side, Timing, Token, ExtraTick, Opportunity } from './types';
import { newOpportunity, newScriptState, PHASES, TIMINGS } from './types';
import { deployable, deployTurn, deploymentComplete, firstPlayerFrom, normaliseSetup, rollTotal, type SetupState } from './setup';
import { actionPhaseComplete, activationOrder, alive, canAct, commandTokensFor, eligibleUnits, isLoopPhase, loopComplete, nextActivation, nextTurn, type InitLookup, type LoopPhase } from './loop';
import { canManeuver, canPerform, costLabel, costOf, extrasLeft, grantHolds, LENGTH_NAME, lengthOf, whyGrantLapsed } from './ticks';
import { normaliseTasks, zoneCentreGrid, type Designation } from './tasks';
import { tokenCards } from './units';

// The in-match HUD (Match Centre part 3a): one question at a time, per seat.
// Everything here renders from the shared GameState and issues the same
// commands the board page does; the board drawing is an honest schematic and
// the full interactive board is part 3b.

export interface DiceLine {
  seat: Side;
  // What the roll was for, without the squad name — the feed puts that in
  // front, coloured, so the line reads as one sentence.
  label: string;
  // The result, counted rather than written out, so the number can carry the
  // weight and never gets wrapped away from the word it belongs to.
  result: { n: number; unit: string }[];
  kind: 'hits' | 'pool';
  // The faces that landed, so the feed can show the dice rather than only
  // report a number. Both players are given the same ones.
  dice: { color: string; face: number }[];
  // Rising, so a line that has only just arrived can tumble on screen once and
  // then sit still through every redraw after it.
  n: number;
}

export interface HudCtx {
  data: GameData;
  state: GameState;
  seat: Side | null;
  networked: boolean;
  send(cmd: Command): CheckResult;
  // Rolls n yellow dice (server dice in a room, local in dev): the Hits per
  // die for the command, and the faces so the tray can show them.
  rollHits(n: number, label: string): Promise<{ hits: number[]; dice: { color: string; face: number }[] }>;
  // Rolls an attack pool; the result lands in the shared dice feed.
  rollPool(y: number, r: number, label: string): Promise<void>;
  diceFeed: DiceLine[];
  note: string | null;
  // Shows a one-off message in the turn panel.
  noteNow(text: string): void;
  // The local zone-overlay preference: this player's clean board is their
  // own business, so it never crosses the wire.
  zonesOn: boolean;
  toggleZones(): void;
  // Builds the left side panel once the HUD shell exists (the freeplay
  // SquadTracker and Panel bind to ids inside it).
  mountSide(): void;
  // Redraws the side panel and shows a unit's card when one is selected.
  syncSide(uid: number | null): void;
  // The printed faces, for drawing the dice a roll landed on.
  diceData: DiceData | null;
  // Keeps the finished game on both accounts. Resolves to null when it landed,
  // or to why it did not — a failure here never stops the table closing.
  recordMatch(): Promise<string | null>;
  refresh(): void;
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ---------- the guide glue, mirrored from playguide.ts ----------
// Both clients run this same deterministic bookkeeping between commands; the
// Match Centre is a full peer, so it runs it too.

const PKEY: Record<Timing, 'swift' | 'melee' | 'projectile' | 'firing' | 'moving' | 'tactic'> = {
  swift: 'swift', melee: 'melee', projectile: 'projectile', firing: 'firing', movement: 'moving', tactical: 'tactic',
};

export function makeInit(data: GameData): InitLookup {
  return (t, timing) => {
    const p = t.mech?.pilot ? data.byId.get(t.mech.pilot) : undefined;
    const v = p?.[PKEY[timing]];
    return typeof v === 'number' ? v : undefined;
  };
}

function extrasFor(data: GameData, t: Token): ExtraTick[] {
  const have = new Set(tokenCards(data, t).flatMap(({ card }) => (card.actions ?? []).map((a) => a.id)));
  return data.extraTicks
    .filter((g) => have.has(g.actionId))
    .map((g) => ({ id: g.actionId, label: g.label, timing: g.timing as Timing, check: g.check }));
}

export function ensureScript(state: GameState): NonNullable<GameState['script']> {
  if (!state.script) state.script = { ...newScriptState(state.round.firstPlayer), strict: true };
  return state.script;
}

export function enterPhase(s: GameState): void {
  const sc = ensureScript(s);
  if (s.round.phase === 0) {
    s.commandTokens = { s1: commandTokensFor(s, 's1'), s2: commandTokensFor(s, 's2') };
    sc.commanded = [];
    sc.freeCommand = [];
  }
  if (s.round.phase === 0 || s.round.phase === 2) sc.acted = [];
  sc.endDone = sc.endDone.filter((k) => k.startsWith(`${s.round.n}:`));
  sc.opp = null;
  sc.passed = [];
  sc.turn = s.round.firstPlayer;
  sc.stage = `${s.round.n}:${s.round.phase}`;
}

// Runs after any command lands, ours or theirs, so both clients derive the
// same turn bookkeeping without it ever crossing the wire.
export function glueAfter(data: GameData, state: GameState, cmd: Command): void {
  if (!normaliseSetup(state.setup) && cmd.kind !== 'startMatch') return;
  if (cmd.kind === 'startMatch' || cmd.kind === 'advancePhase' || cmd.kind === 'setPhase' || cmd.kind === 'finishDeployment') {
    enterPhase(state);
  } else if (cmd.kind === 'designate') {
    const sc = ensureScript(state);
    const t = state.tokens.find((x) => x.uid === cmd.uid);
    const opp = newOpportunity(cmd.uid, undefined);
    opp.extras = t ? extrasFor(data, t) : [];
    sc.opp = opp;
  }
}

function opportunity(data: GameData, s: GameState): Opportunity | null {
  const sc = ensureScript(s);
  const next = nextActivation(s, makeInit(data));
  if (!next) return null;
  if (sc.opp && sc.opp.uid === next.uid) return sc.opp;
  const t = s.tokens.find((x) => x.uid === next.uid);
  const fresh = newOpportunity(next.uid, next.timing);
  fresh.extras = t ? extrasFor(data, t) : [];
  sc.opp = fresh;
  return fresh;
}

// ---------- zones & deployment geometry ----------

function zref(ref: string): { col: number; row: number } | null {
  const m = /^([A-La-l])(\d{1,2})$/.exec(ref.trim());
  if (!m) return null;
  return { col: m[1].toUpperCase().charCodeAt(0) - 65, row: Number(m[2]) - 1 };
}

// Board cells (36-grid) of a mission's objective zones, from the Task Items.
export function objectiveCells(data: GameData, s: GameState): { c: number; r: number }[] {
  const tasks = normaliseTasks(s.tasks);
  const out: { c: number; r: number }[] = [];
  for (const item of tasks.items) {
    const zone = data.zoneData.zones.find((z) => z.id === item.zone);
    for (const cell of zone?.cells ?? []) {
      const p = zref(cell);
      if (p) for (let dc = 0; dc < 3; dc++) for (let dr = 0; dr < 3; dr++) out.push({ c: p.col * 3 + dc, r: p.row * 3 + dr });
    }
  }
  return out;
}

// The board cells a side may deploy into, from its edge and the mission's
// printed deployment shape (2x12 strips when no mission says otherwise).
export function deployCellsFor(data: GameData, s: GameState, side: Side): Set<string> {
  const su = normaliseSetup(s.setup);
  const out = new Set<string>();
  if (!su) return out;
  const shapeId = (s.mission && data.zoneData.missionDeployment[s.mission]) || 'strips';
  const def = data.zoneData.deployments.find((d) => d.id === shapeId);
  const area = def?.[su.edge[side]];
  if (!area) return out;
  const a = zref(area.from);
  const b = zref(area.to);
  if (!a || !b) return out;
  for (let zc = Math.min(a.col, b.col); zc <= Math.max(a.col, b.col); zc++) {
    for (let zr = Math.min(a.row, b.row); zr <= Math.max(a.row, b.row); zr++) {
      for (let dc = 0; dc < 3; dc++) for (let dr = 0; dr < 3; dr++) out.add(`${zc * 3 + dc},${zr * 3 + dr}`);
    }
  }
  return out;
}

// ---------- module UI state ----------

let placing: number | null = null; // uid being deployed via board clicks
// Where this player has put a unit but not yet confirmed it. Nothing is sent
// and nothing lands on the board until they do, so the turn stays theirs.
let pending: { uid: number; col: number; row: number; size: 1 | 2 | 3 } | null = null;
// A route being drawn, exactly as the freeplay board does it: traced by the
// cursor so a deliberate zigzag is expressible, clicked to lock, confirmed
// from the turn panel. The engine only ever sees the destination.
let movePlan: {
  uid: number;
  side: Side;
  steps: number;
  flying: boolean;
  path: LargeGrid[];
  locked: boolean;
} | null = null;
let targetUid: number | null = null; // enemy picked for damage bookkeeping
let attack: { y: number; r: number; name: string } | null = null; // pool of the action just performed
let recording = false;             // a record is being sent
let recorded = false;              // and the server took it
let recordNote: string | null = null;
let secOpen = false;               // the Secondary Task picker overlay
let secFor: Side | null = null;    // whose pick the overlay is making
let secPick: string | null = null; // highlighted card, not yet confirmed

// ---------- pieces ----------

function timelineHtml(s: GameState): string {
  const cells = PHASES.map((p, i) => {
    const cls = i < s.round.phase ? ' done' : i === s.round.phase ? ' now' : '';
    return `<div class="tl${cls}">${p}<b>${i < s.round.phase ? 'done' : i === s.round.phase ? 'now' : '—'}</b></div>`;
  }).join('');
  return `<div class="timeline"><div class="roundchip">R${s.round.n}/${s.roundLimit ?? 5}</div>${cells}</div>`;
}

function orderStripHtml(ctx: HudCtx): string {
  const s = ctx.state;
  if (s.round.phase < 1 || s.round.phase > 2) return '';
  const sc = ensureScript(s);
  const acted = new Set(sc.acted);
  const order = activationOrder(s, makeInit(ctx.data));
  if (!order.length) return '';
  const cur = s.round.phase === 2 ? nextActivation(s, makeInit(ctx.data)) : null;
  const chips = order
    .map((a) => {
      const t = s.tokens.find((x) => x.uid === a.uid);
      if (!t) return '';
      const short = TIMINGS.find((x) => x.id === a.timing)?.short ?? '';
      const cls = cur && cur.uid === a.uid && !acted.has(a.uid) ? ' now' : acted.has(a.uid) ? ' past' : '';
      return `<span class="ord ${t.side}${cls}"><span class="sw"></span>${esc(t.label)} · ${short}</span>`;
    })
    .join('');
  return `<div class="orderstrip">${chips}</div>`;
}

// ---------- the real board, shared with the freeplay page ----------

let board: Board | null = null;
let hudRef: HudCtx | null = null;

// The same reachability the freeplay board offers: Large Grids within the
// unit's Movement Range, terrain-aware, with Break Away and Crush priced the
// same way. The path law lives in the UI on both pages — the engine's
// maneuver trusts the move it is handed.
function terrainOf(ctx: HudCtx) {
  const gone = new Set(ctx.state.removedTerrain ?? []);
  return (ctx.data.terrain.layouts[ctx.state.map] ?? []).filter((p) => !gone.has(p.id));
}

function reachableFor(ctx: HudCtx, t: Token) {
  const terrain = terrainOf(ctx);
  const flying = !!t.aerial;
  return reachableGrids(t, maneuverRange(ctx.data, t), terrain, ctx.state.tokens, flying, {
    exitCost: flying ? undefined : breakAwayCost(ctx.data, t, ctx.state.tokens, terrain),
    crushable: (c, r) => crushTargets(t, c, r, terrain, ctx.state.tokens) !== null,
  });
}

function canReach(ctx: HudCtx, t: Token, col: number, row: number): boolean {
  const c = Math.floor(col / 3);
  const r = Math.floor(row / 3);
  return reachableFor(ctx, t).some((g) => g.c === c && g.r === r);
}

function moveOptsFor(ctx: HudCtx, t: Token, flying: boolean) {
  const terrain = terrainOf(ctx);
  return {
    exitCost: flying || t.aerial ? undefined : breakAwayCost(ctx.data, t, ctx.state.tokens, terrain),
    crushable: (c: number, r: number) => crushTargets(t, c, r, terrain, ctx.state.tokens) !== null,
  };
}

function startMovePlan(ctx: HudCtx, t: Token): void {
  const steps = maneuverRange(ctx.data, t);
  if (steps <= 0) {
    ctx.noteNow(`${t.label} has no Movement Range on its card.`);
    return;
  }
  movePlan = {
    uid: t.uid,
    side: t.side,
    steps,
    flying: !!ctx.data.byId.get(t.cardId)?.moveAsFlight,
    path: [{ c: Math.floor(t.col / 3), r: Math.floor(t.row / 3) }],
    locked: false,
  };
}

// Traced by the cursor rather than solved, so a deliberate zigzag is
// expressible and terrain stops the route where the rules say it stops.
function traceMove(ctx: HudCtx, c: number, r: number): void {
  const m = movePlan;
  if (!m || m.locked || !board) return;
  const t = ctx.state.tokens.find((x) => x.uid === m.uid);
  if (!t) return;
  const next = extendPath(m.path, { c, r }, t, m.steps, terrainOf(ctx), ctx.state.tokens, m.flying, moveOptsFor(ctx, t, m.flying));
  if (!next) return;
  m.path = next;
  board.showMovePath(next, m.side, false);
  ctx.refresh();
}

// Clicking freezes the route so the cursor can leave the board for Confirm
// without dragging the path along behind it.
function lockMove(ctx: HudCtx): void {
  const m = movePlan;
  if (!m || m.path.length < 2 || !board) return;
  m.locked = !m.locked;
  board.showMovePath(m.path, m.side, m.locked);
  ctx.refresh();
}

function cancelMove(ctx: HudCtx): void {
  movePlan = null;
  board?.clearMovePath();
  board?.clearHighlights();
  ctx.refresh();
}

// Each stop takes the free part of its Grid rather than the middle, so a unit
// crossing a Grid holding a low wall walks past it instead of onto it. Only
// the destination goes to the engine; the walk is local animation.
function commitMove(ctx: HudCtx): void {
  const m = movePlan;
  if (!m || m.path.length < 2 || !board) return;
  const t = ctx.state.tokens.find((x) => x.uid === m.uid);
  if (!t) return;
  const terrain = terrainOf(ctx);
  const stops: { col: number; row: number }[] = [];
  let from = { col: t.col, row: t.row };
  for (const g of m.path) {
    const spot =
      standingSpot(g.c, g.r, t.size, m.flying || t.aerial, terrain, ctx.state.tokens, t.uid, from)
      ?? snapPlacement(g.c * 3 + 1, g.r * 3 + 1, t.size as 1 | 2 | 3);
    if (!spot) continue;
    stops.push(spot);
    from = spot;
  }
  const last = stops[stops.length - 1];
  movePlan = null;
  board.clearMovePath();
  board.clearHighlights();
  if (!last) {
    ctx.refresh();
    return;
  }
  board.animateMove(t.uid, stops, () => {
    ctx.send({ kind: 'maneuver', seat: t.side, uid: t.uid, to: last });
    ctx.refresh();
  });
}

// A snapped footprint counts only when every cell sits inside the zone.
function fitsZone(ctx: HudCtx, side: Side, at: { col: number; row: number }, size: number): boolean {
  const zone = deployCellsFor(ctx.data, ctx.state, side);
  return footprint({ ...at, size }).every((c) => zone.has(`${c.col},${c.row}`));
}

function boardCallbacks(): BoardCallbacks {
  return {
    onSelect(uid) {
      const ctx = hudRef;
      if (!ctx) return;
      const s = ctx.state;
      const sc = ensureScript(s);
      const actor = sc.opp ? s.tokens.find((x) => x.uid === sc.opp!.uid) : undefined;
      const t = uid !== null ? s.tokens.find((x) => x.uid === uid) : undefined;
      if (t && actor && t.side !== actor.side) targetUid = targetUid === t.uid ? null : t.uid;
      ctx.refresh();
    },
    onMove(uid, col, row) {
      const ctx = hudRef;
      if (!ctx) return;
      const t = ctx.state.tokens.find((x) => x.uid === uid);
      if (!t) return;
      const snap = snapPlacement(col, row, (t.size ?? 1) as 1 | 2 | 3) ?? { col, row };
      // During deployment a drag nudges the unit inside its zone; in play it
      // is a Maneuver attempt the engine judges.
      const su = normaliseSetup(ctx.state.setup);
      if (su && su.stage === 'deploy') {
        if (fitsZone(ctx, t.side, snap, t.size ?? 1)) ctx.send({ kind: 'deployUnit', seat: t.side, uid, to: snap });
      } else if (canReach(ctx, t, snap.col, snap.row)) {
        // The drop only lands inside the unit's real Movement Range — the
        // same law the freeplay board enforces before offering a grid.
        ctx.send({ kind: 'maneuver', seat: t.side, uid, to: snap });
      }
      ctx.refresh();
    },
    onCellHover(col, row) {
      const ctx = hudRef;
      if (!ctx || !board) return;
      const s = ctx.state;
      if (placing !== null) {
        const t = s.tokens.find((x) => x.uid === placing);
        if (!t) return;
        const size = (t.size ?? 1) as 1 | 2 | 3;
        const snap = snapPlacement(col, row, size) ?? { col, row };
        board.showGhost(footprint({ ...snap, size }), fitsZone(ctx, t.side, snap, size));
      } else if (movePlan) {
        traceMove(ctx, Math.floor(col / 3), Math.floor(row / 3));
      }
    },
    onCellClick(col, row) {
      const ctx = hudRef;
      if (!ctx) return;
      const s = ctx.state;
      if (movePlan) {
        lockMove(ctx);
        return;
      }
      if (placing === null) return;
      const t = s.tokens.find((x) => x.uid === placing);
      if (!t) return;
      const size = (t.size ?? 1) as 1 | 2 | 3;
      const snap = snapPlacement(col, row, size) ?? { col, row };
      // Strict placement: your whole footprint inside your own Deployment
      // Zone, aligned to the grid, or nothing lands (3.1.4). The seat is the
      // unit's side — a nudge stays legal after the alternation moves on.
      if (!fitsZone(ctx, t.side, snap, size)) return;
      // Held here rather than sent: a unit that lands on the board counts as
      // placed, and the alternation would move to the other squad before this
      // player had confirmed anything. The ghost stands in until they do.
      pending = { uid: placing, col: snap.col, row: snap.row, size };
      board?.showGhost(footprint({ ...snap, size }), true);
      ctx.refresh();
    },
    onDestroyTerrain(id) {
      const ctx = hudRef;
      if (!ctx) return;
      ctx.send({ kind: 'destroyTerrain', seat: ctx.seat ?? 's1', uid: 0, pieces: [id] });
      ctx.refresh();
    },
  };
}

function renderBoard(ctx: HudCtx): void {
  if (!board) return;
  const s = ctx.state;
  // The squad tints carry each side's faction, same custom properties the
  // freeplay page sets — without them every token reads as the default gold.
  for (const side of ['s1', 's2'] as Side[]) {
    const f = squadAllegiance(ctx.data, s.tokens.filter((t) => t.side === side)).faction;
    document.documentElement.style.setProperty(`--sq-${side}`, factionColour(f));
  }
  // Panning is the default; a placement or a route needs the cell instead.
  board.panEnabled = placing === null && !movePlan;
  if (movePlan) {
    const t = s.tokens.find((x) => x.uid === movePlan!.uid);
    // The same overlay freeplay shows: the Large Grids this unit can really
    // enter, with the step count on each.
    if (t) board.showReachable(reachableFor(ctx, t), movePlan.steps);
  } else {
    board.clearHighlights();
    // A placement waiting to be confirmed keeps its ghost through every
    // redraw: it is the only thing on the board showing where the unit went.
    if (pending) board.showGhost(footprint({ col: pending.col, row: pending.row, size: pending.size }), true);
    else if (placing === null) board.clearGhost();
  }
  const gone = new Set(s.removedTerrain ?? []);
  board.renderTerrain((ctx.data.terrain.layouts[s.map] ?? []).filter((p) => !gone.has(p.id)));
  // The Zones toggle is a local preference — a clean board to look at, not a
  // rule change — so it only suppresses the overlay and never crosses the wire.
  const showZones = ctx.zonesOn;
  const ov = showZones ? resolveZoneSetData(ctx.data, s.zoneSet ?? '') : { zones: [], deploy: null };
  // While setup runs, the printed Deployment Zones are always on the table,
  // whatever the zone overlay says (3.1.4).
  const su = normaliseSetup(s.setup);
  let deploy = ov.deploy;
  if (showZones && su && su.stage !== 'done' && !deploy) {
    const shapeId = (s.mission && ctx.data.zoneData.missionDeployment[s.mission]) || 'strips';
    deploy = printedDeployment(ctx.data, shapeId);
  }
  const tasks = normaliseTasks(s.tasks);
  // Which squads have named each Tactical Zone for a Secondary Task, so the
  // board can ring it. Designations are stored by zone id; zones are drawn by
  // name, which is the same translation the freeplay board makes.
  const claimed: Record<string, Side[]> = {};
  for (const side of ['s1', 's2'] as Side[]) {
    const id = tasks.zone[side];
    if (!id) continue;
    const name = ctx.data.zoneData.zones.find((z) => z.id === id)?.name ?? id;
    (claimed[name] ??= []).push(side);
  }
  board.renderZones(ov.zones, deploy, claimed);
  board.renderTaskItems(tasks.items, (zone) => zoneCentreGrid(ctx.data.zoneData.zones, zone));
  board.renderTokens(s);
  board.renderSmoke(s.smoke ?? []);
  board.renderMarkers(s.markers ?? []);
  board.setSelected(ensureScript(s).opp?.uid ?? null);
}

// ---------- the turn panel: one question at a time ----------

function head(eyebrow: string, title: string, sub: string, mine: boolean): string {
  return `<div class="tp-head">
    <div class="tp-eyebrow${mine ? ' mine' : ''}">${esc(eyebrow)}</div>
    <div class="tp-title">${title}</div>
    ${sub ? `<div class="tp-sub">${sub}</div>` : ''}
  </div>`;
}

function waiting(side: Side, doing: string): string {
  return `<div class="waitbox"><div class="spin">◐</div><div class="msg">Waiting for <b class="${side}">${squadLabel(side)}</b></div><div class="sub">${esc(doing)}</div></div>`;
}

function mine(ctx: HudCtx, side: Side): boolean {
  return !ctx.seat || ctx.seat === side;
}

function setupPanel(ctx: HudCtx, su: SetupState): string {
  const s = ctx.state;
  if (su.stage === 'map') {
    // The battlefield was settled in the lobby; the lock is sent for us.
    return head('Setup', 'Preparing the battlefield', '', true) + '<div class="tp-body"></div><div class="tp-foot"></div>';
  }
  if (su.stage === 'roll') {
    const winner = firstPlayerFrom(su);
    const both = !!su.rolls.s1.length && !!su.rolls.s2.length;
    const tie = both && !winner;
    const rows = (['s1', 's2'] as Side[])
      .map((side) => {
        const r = su.rolls[side];
        const isMe = mine(ctx, side);
        const btn = isMe
          ? `<button class="rowbtn" data-roll="${side}">${r.length ? 'Re-roll' : 'Roll 2 dice'}</button>`
          : `<span class="tp-dim">${r.length ? '' : 'rolling…'}</span>`;
        return `<div class="dialrow"><span class="nm ${side}">${squadLabel(side)}</span>${btn}<span class="pickchip${r.length ? ' set' : ''}">${r.length ? `${rollTotal(r)} Hits` : '—'}</span></div>`;
      })
      .join('');
    const verdict = tie
      ? `<p class="tp-note">A tie on ${rollTotal(su.rolls.s1)}. The rulebook gives no tie procedure, so both squads roll again — the first re-roll clears the other total.</p>`
      : winner ? `<p class="tp-note">${squadLabel(winner)} rolls higher.</p>` : '';
    return head('Setup', 'Roll for First Player', 'Two dice each, most Hits goes first (3.1.2).', true)
      + `<div class="tp-body">${rows}${verdict}</div>
        <div class="tp-foot">${winner ? '<button class="bigbtn" data-act="accept">Continue</button>' : ''}</div>`;
  }
  if (su.stage === 'side') {
    const fp = s.round.firstPlayer;
    const edge = mine(ctx, fp)
      ? `<div class="btnrow"><button class="rowbtn" data-edge="white">Take the White edge</button><button class="rowbtn" data-edge="black">Take the Black edge</button></div>`
      : waiting(fp, 'picking a table edge');
    return head(mine(ctx, fp) ? 'Your move' : 'Setup', `${squadLabel(fp)} picks an edge`, 'The other side takes the opposite edge (3.1.2). Secondary Tasks are open information (3.1.3).', mine(ctx, fp))
      + `<div class="tp-body">${edge}<div class="tp-gap"></div>${secondaryRows(ctx)}</div><div class="tp-foot"></div>`;
  }
  // Tasks come before deployment (3.1.3 then 3.1.4), the same way the freeplay
  // guide holds its placement list back: the edge pick moves the stage on, so
  // without this the First Player could take an edge and start placing while
  // the other squad never got to choose a Task at all.
  const pending = normaliseTasks(s.tasks);
  if (!pending.secondary.s1 || !pending.secondary.s2) {
    return head('Setup', 'Secondary Tasks', 'Both are picked before anything deploys, so each side knows what the other is playing for (3.1.3).', !pending.secondary[ctx.seat ?? 's1'])
      + `<div class="tp-body">${secondaryRows(ctx)}</div><div class="tp-foot"></div>`;
  }
  // A Task that names a Mech or a Zone is part of the same step, and the naming
  // is not always the scorer's to do — Behead has the opponent name one of
  // their own. Nothing deploys until every one of them is answered.
  const owed = taskDesignations(ctx.data, s);
  if (owed.length) return designatePanel(ctx, owed);
  // deploy — every button that ends or advances a step lives in the FOOT, so
  // the panel reads the same in every state.
  // The note goes above the button, never below it. The foot is anchored to
  // the bottom of the panel, so text that comes and goes grows upward and the
  // button it explains stays where the hand expects it.
  const confirmRow = pending !== null
    ? `<p class="tp-note">Or click another Grid in your zone to move it first. It lands when you confirm.</p>
       <button class="bigbtn" data-act="confirmplace">Confirm placement</button>`
    : '';
  const turn = deployTurn(s, su);
  if (!turn || deploymentComplete(s)) {
    const foot: string[] = [confirmRow];
    let sub = '';
    if (ctx.networked && ctx.seat) {
      // Round 1 begins only when BOTH squads have said their deployment is
      // final — neither player can push the other forward.
      const meReady = !!s.ready?.[ctx.seat];
      const otherSeat: Side = ctx.seat === 's1' ? 's2' : 's1';
      const otherReady = !!s.ready?.[otherSeat];
      sub = meReady && otherReady ? 'Both squads confirmed.' : 'Both squads confirm before Round 1 begins — moves stay open until then.';
      if (!meReady) foot.push(`<button class="bigbtn${pending !== null ? ' ghost2' : ''}" data-act="deployready">My deployment is final</button>`);
      else if (!otherReady) foot.push(`<button class="bigbtn ghost2" data-act="deployunready" title="Tap to withdraw">✓ Ready — waiting for ${squadLabel(otherSeat)}…</button>`);
      else foot.push('<button class="bigbtn" data-act="deploydone">Begin Round 1</button>');
    } else {
      foot.push(`<button class="bigbtn${pending !== null ? ' ghost2' : ''}" data-act="deploydone">Begin Round 1</button>`);
    }
    return head('Setup', 'Deployment complete', sub, true)
      + `<div class="tp-body"></div><div class="tp-foot">${foot.join('')}</div>`;
  }
  if (!mine(ctx, turn)) {
    placing = null;
    return head('Deployment', `${squadLabel(turn)} places a unit`, '', false)
      + `<div class="tp-body">${waiting(turn, 'placing a unit')}</div><div class="tp-foot">${confirmRow}</div>`;
  }
  const waitingUnits = deployable(s, turn);
  const rows = waitingUnits
    .map(
      (t) => `<button class="rowwide${placing === t.uid ? ' sel' : ''}" data-place="${t.uid}">${esc(t.label)}<span class="ct">${t.kind}</span></button>`,
    )
    .join('');
  return head('Your move', 'Place a unit', placing !== null ? `Hover shows the landing spot; click a Grid in your ${su.edge[turn]} zone.` : 'Pick a unit, then click a Grid on the board.', true)
    + `<div class="tp-body">${rows}</div><div class="tp-foot">${confirmRow}</div>`;
}

function planningPanel(ctx: HudCtx): string {
  const s = ctx.state;
  const sc = ensureScript(s);
  const me = ctx.seat;
  const sides: Side[] = me ? [me] : ['s1', 's2'];
  const rows = sides
    .flatMap((side) => s.tokens.filter((t) => t.side === side && t.kind === 'mech' && alive(t) && t.partStates.torso !== 'destroyed'))
    .map((t) => {
      const chips = TIMINGS.map(
        (d) => `<button class="tchip t-${d.id}${t.timing === d.id ? ' sel' : ''}" data-dial="${t.uid}:${d.id}" title="${d.name}">${d.short}</button>`,
      ).join('');
      return `<div class="dialrow"><span class="nm">${esc(t.label)}</span><span class="tchips">${chips}</span></div>`;
    })
    .join('');
  const myMechs = me ? s.tokens.filter((t) => t.side === me && t.kind === 'mech' && alive(t) && t.partStates.torso !== 'destroyed') : [];
  const left = myMechs.filter((t) => !t.timing).length;
  const committed = me ? !!sc.commits[me] : false;
  const bothRevealed = sc.revealed.includes('s1') && sc.revealed.includes('s2');
  const foot = ctx.networked && me
    ? committed
      ? bothRevealed
        ? '<button class="bigbtn" data-act="advance">Continue to the Action Phase</button>'
        : `<p class="tp-note">Committed. Waiting for ${esc(squadLabel(me === 's1' ? 's2' : 's1'))} to lock in…</p>`
      : `<button class="bigbtn" data-act="lockdials"${left ? ' disabled' : ''}>${left ? `Lock in — ${left} dial${left === 1 ? '' : 's'} left` : 'Lock in'}</button>`
    : `<button class="bigbtn" data-act="advance"${left ? ' disabled' : ''}>${left ? `${left} dial${left === 1 ? '' : 's'} left` : 'Continue to the Action Phase'}</button>`;
  return head(me ? 'Your move' : 'Planning', 'Set your Timing Dials', me ? 'Your opponent cannot see these until both squads lock in.' : 'Both squads set dials.', true)
    + `<div class="tp-body">${rows}</div><div class="tp-foot">${foot}</div>`;
}

// The Ticks in hand, labelled the way the freeplay guide labels them: the
// Maneuver Tick, the two Action Ticks, and any Extra Ticks a Part grants. A
// grant whose condition has lapsed shows as unavailable rather than spent,
// because those are different things and only one of them can come back.
function tickPool(o: Opportunity): string {
  const pip = (on: boolean, extra = '') => `<i class="pip${on ? '' : ' off'}${extra}"></i>`;
  const live = extrasLeft(o);
  const manUsable = canManeuver(o).ok;
  const extraPip = (x: ExtraTick) => {
    if (o.spentExtras.includes(x.id)) return pip(false);
    return grantHolds(o, x) ? `<i class="pip" title="${esc(x.label)}"></i>` : `<i class="pip off lapsed" title="${esc(whyGrantLapsed(x))}"></i>`;
  };
  return `<div class="hudticks">
    <span class="pips${manUsable ? '' : ' spent'}"><b class="pip-label">MAN</b>${pip(o.maneuver > 0 && manUsable)}</span>
    <span class="pips${o.action ? '' : ' spent'}"><b class="pip-label">ACT</b>${pip(o.action > 0)}${pip(o.action > 1)}</span>
    ${o.extras.length ? `<span class="pips${live.length ? '' : ' spent'}"><b class="pip-label">XTR</b>${o.extras.map(extraPip).join('')}</span>` : ''}
  </div>`;
}

function actionButtons(ctx: HudCtx, t: Token, o: Opportunity): string {
  // Common Actions belong to Mechs (6.1); a Drone plays only what its card prints.
  const acts = [
    ...tokenCards(ctx.data, t).flatMap(({ card }) => card.actions ?? []),
    ...(t.kind === 'mech' ? ctx.data.commonActions : []),
  ];
  const seen = new Set<string>();
  const rows = acts
    .filter((a) => (seen.has(a.id) ? false : (seen.add(a.id), true)))
    .map((a) => {
      const v = canPerform(o, a);
      const cost = costOf(a);
      const len = lengthOf(a);
      const kind = (a.type ?? '').toLowerCase();
      const pool = `${a.yellowDice ?? 0},${a.redDice ?? 0}`;
      // What it costs, in the Ticks it actually spends, the way the guide
      // writes it: M for the Maneuver Tick, a dot per Action Tick.
      // No printed length means no Tick cost — Passives, and every Drone Action
      // in the card data. Those show their type rather than a price they do
      // not have, the way the guide leaves them off its Tick list entirely.
      const price = v.extra ? 'XTR' : cost ? `${cost.maneuver ? 'M' : ''}${'●'.repeat(cost.action)}` : (a.type ?? '—');
      const tip = v.ok
        ? `${len ? LENGTH_NAME[len] : a.type ?? ''}${cost ? `: ${costLabel(cost)}` : ''}`
        : v.why ?? '';
      // Blocked Actions stay on the list and say why when pressed. A disabled
      // row tells a player nothing, and "the Starting Action must match the
      // dial" is exactly the thing they need told.
      return `<button class="actrow k-${kind}${v.ok ? '' : ' warn'}" data-doact="${esc(a.id)}" data-pool="${pool}" data-an="${esc(a.name?.en || a.id)}"${v.ok ? '' : ` data-why="${esc(v.why ?? '')}"`} title="${esc(tip)}">
        <span class="dotk"></span><span class="an">${esc((a.name?.en || a.id).slice(0, 30))}</span><span class="ac">${price}</span>
      </button>`;
    })
    .join('');
  const man = canManeuver(o);
  const ticks = tickPool(o);
  // While a route is being drawn the panel becomes the move bar, the same way
  // the freeplay guide takes it over.
  if (movePlan && movePlan.uid === t.uid) {
    const drawn = movePlan.path.length - 1;
    return `${ticks}
      <div class="moveplan">
        <p class="tp-note">${drawn ? `${drawn} of ${movePlan.steps} grids${movePlan.locked ? ' · locked' : ''}` : `Draw a route on the board — up to ${movePlan.steps} grid${movePlan.steps === 1 ? '' : 's'}.`}</p>
        <p class="tp-dim">Move the cursor across grids to trace it, click to lock, then confirm.</p>
        <button class="bigbtn" data-act="commitmove"${drawn ? '' : ' disabled'}>Confirm move</button>
        <button class="bigbtn ghost2" data-act="cancelmove" style="margin-top:6px">Cancel</button>
      </div>`;
  }
  return `${ticks}
    <button class="actrow k-moving${man.ok ? '' : ' warn'}"${man.ok ? '' : ` data-why="${esc(man.why ?? '')}"`} data-act="maneuver" title="${esc(man.ok ? 'Draw a route on the board, then confirm.' : man.why ?? '')}">
      <span class="dotk"></span><span class="an">Maneuver</span><span class="ac">draw a route</span></button>
    ${rows}
    ${combatStrip(ctx)}`;
}

// The after-an-attack strip: shared dice, then the damage bookkeeping — the
// same manual moves the physical table makes, each one a mirrored command.
function combatStrip(ctx: HudCtx): string {
  const s = ctx.state;
  const target = targetUid !== null ? s.tokens.find((x) => x.uid === targetUid) : undefined;
  const parts: string[] = [];
  if (attack && (attack.y || attack.r)) {
    parts.push(`<button class="rowwide" data-rollpool="${attack.y},${attack.r}">🎲 Roll ${attack.y ? `${attack.y}Y` : ''}${attack.r ? ` ${attack.r}R` : ''} — ${esc(attack.name)}</button>`);
  }
  parts.push(target
    ? `<div class="dialrow"><span class="nm">Target: <b class="${target.side}">${esc(target.label)}</b></span><button class="rowbtn" data-act="untarget">clear</button></div>`
    : `<p class="tp-note">Click an enemy token on the board to target it for damage.</p>`);
  if (target) {
    const slots = tokenCards(ctx.data, target).map(({ slot }) => slot);
    const slotBtns = slots
      .map((sl) => {
        const st = target.partStates[sl as keyof typeof target.partStates] ?? 'intact';
        return `<button class="rowbtn sl-${st}" data-pen="${esc(sl)}"${st === 'destroyed' ? ' disabled' : ''}>${esc(sl)}${st === 'damaged' ? ' ◐' : st === 'destroyed' ? ' ✕' : ''}</button>`;
      })
      .join('');
    parts.push(`<div class="sect2" style="margin-top:8px">Penetrate</div><div class="btnwrap">${slotBtns}</div>`);
    const dead = Object.values(target.partStates).every((p) => p === 'destroyed');
    parts.push(`<div class="btnrow" style="margin-top:8px">
      <button class="rowbtn" data-act="killpart">Score a Part kill</button>
      <button class="rowbtn${dead ? ' warnb' : ''}" data-act="killunit">${dead ? 'Remove the unit' : 'Destroy the unit'}</button>
    </div>`);
  }
  return `<div class="combat">${parts.join('')}</div>`;
}

function loopPanel(ctx: HudCtx, phase: LoopPhase): string {
  const s = ctx.state;
  const sc = ensureScript(s);
  const tokens = phase === 'Command'
    ? `<p class="tp-note">Command tokens — <b class="s1">${s.commandTokens.s1}</b> · <b class="s2">${s.commandTokens.s2}</b></p>`
    : '';
  if (sc.opp) {
    const t = s.tokens.find((x) => x.uid === sc.opp!.uid);
    if (t) {
      if (!mine(ctx, t.side)) {
        return head('Waiting', `${squadLabel(t.side)} is acting`, `${esc(t.label)} — ${phase} Phase.`, false)
          + `<div class="tp-body">${waiting(t.side, 'resolving its action')}</div><div class="tp-foot"></div>`;
      }
      return head('Your move', esc(t.label), phase === 'Command' ? 'One Command Action, or move it.' : 'Resolve its action, then end.', true)
        + `<div class="tp-body">${actionButtons(ctx, t, sc.opp)}</div>
          <div class="tp-foot"><button class="bigbtn" data-act="endopp">Done — end this activation</button></div>`;
    }
  }
  if (loopComplete(s, phase)) {
    return head(phase, `${phase} Phase complete`, '', true)
      + `<div class="tp-body">${tokens}</div><div class="tp-foot"><button class="bigbtn" data-act="advance">Continue</button></div>`;
  }
  const turn = canAct(s, phase, sc.turn) ? sc.turn : (nextTurn(s, phase, sc.turn) ?? sc.turn);
  if (!mine(ctx, turn)) {
    return head('Waiting', `${squadLabel(turn)} designates`, '', false)
      + `<div class="tp-body">${tokens}${waiting(turn, `picking a ${phase === 'Delay' ? 'projectile' : 'drone'} or passing`)}</div><div class="tp-foot"></div>`;
  }
  const units = eligibleUnits(s, phase, turn);
  const rows = units.map((t) => `<button class="rowwide" data-designate="${t.uid}">${esc(t.label)}<span class="ct">${t.kind}</span></button>`).join('');
  return head('Your move', phase === 'Command' ? 'Command a drone' : phase === 'Delay' ? 'Activate a projectile' : 'Activate a drone', 'Or pass for the phase.', true)
    + `<div class="tp-body">${tokens}${rows}</div>
      <div class="tp-foot"><button class="bigbtn ghost2" data-act="pass">Pass</button></div>`;
}

function actionPanel(ctx: HudCtx): string {
  const s = ctx.state;
  const o = opportunity(ctx.data, s);
  if (!o) {
    return head('Action Phase', 'Every Mech has acted', '', true)
      + `<div class="tp-body"></div><div class="tp-foot"><button class="bigbtn" data-act="advance">Continue</button></div>`;
  }
  const t = s.tokens.find((x) => x.uid === o.uid);
  if (!t) return head('Action Phase', 'The active Mech is gone', '', true) + `<div class="tp-body"></div><div class="tp-foot"><button class="bigbtn" data-act="endopp">Skip</button></div>`;
  const timing = TIMINGS.find((x) => x.id === o.timing)?.name ?? '';
  if (!mine(ctx, t.side)) {
    return head('Waiting', `${squadLabel(t.side)} is acting`, `${esc(t.label)} — ${esc(timing)}.`, false)
      + `<div class="tp-body">${waiting(t.side, 'taking its Action Opportunity')}</div><div class="tp-foot"></div>`;
  }
  return head('Your move', `${esc(t.label)} — ${esc(timing)}`, '1 Maneuver and 2 Action ticks. Spend what you like, then end.', true)
    + `<div class="tp-body">${actionButtons(ctx, t, o)}</div>
      <div class="tp-foot"><button class="bigbtn" data-act="endopp">End this Opportunity</button></div>`;
}

function endPanel(ctx: HudCtx): string {
  const s = ctx.state;
  const sc = ensureScript(s);
  const steps: { id: string; label: string }[] = [
    { id: 'tokens', label: 'Age tokens & clear Command pools' },
    { id: 'remove', label: 'Integrity Loss — remove spent Mechs' },
    { id: 'tasks', label: 'Settle Task control' },
  ];
  const rows = steps
    .map((st) => {
      const done = sc.endDone.includes(`${s.round.n}:end:${st.id}`);
      return `<button class="rowwide${done ? ' donerow' : ''}" data-endstep="${st.id}"${done ? ' disabled' : ''}>${done ? '✓ ' : ''}${st.label}</button>`;
    })
    .join('');
  const all = steps.every((st) => sc.endDone.includes(`${s.round.n}:end:${st.id}`));
  const last = s.round.n >= (s.roundLimit ?? 5);
  const vp = normaliseTasks(s.tasks).vp;
  const score = `<div class="sect2" style="margin-top:10px">Victory Points</div>
    <div class="dialrow"><span class="nm s1">${squadLabel('s1')} · ${vp.s1} VP</span><button class="rowbtn" data-award="s1">+1</button></div>
    <div class="dialrow"><span class="nm s2">${squadLabel('s2')} · ${vp.s2} VP</span><button class="rowbtn" data-award="s2">+1</button></div>
    <p class="tp-note">Scored by hand for now, like the tabletop — the card text says what each squad earned.</p>`;
  // The last round ends the game rather than rolling into another one. Without
  // this "Finish the game" started Round 6 and the match never ended at all.
  if (last && all) return resultPanel(ctx, vp);
  return head('End Phase', `Round ${s.round.n} wraps up`, '', true)
    + `<div class="tp-body">${rows}${score}</div>
      <div class="tp-foot"><button class="bigbtn" data-act="advance"${all ? '' : ' disabled'}>${last ? 'Finish the game' : `Start Round ${s.round.n + 1}`}</button></div>`;
}

// What the game came to, and the offer to keep it. Recording is opt-in and
// never blocks ending: the match happened whether or not the server hears
// about it.
function resultPanel(ctx: HudCtx, vp: { s1: number; s2: number }): string {
  const winner: Side | null = vp.s1 === vp.s2 ? null : vp.s1 > vp.s2 ? 's1' : 's2';
  const verdict = winner
    ? `${squadLabel(winner)} wins ${Math.max(vp.s1, vp.s2)}–${Math.min(vp.s1, vp.s2)}`
    : `A draw at ${vp.s1} VP each`;
  const rows = (['s1', 's2'] as Side[])
    .map((side) => `<div class="dialrow"><span class="nm ${side}">${squadLabel(side)}</span><span class="pickchip${winner === side ? ' set' : ''}">${vp[side]} VP</span></div>`)
    .join('');
  const foot = recorded
    ? '<p class="tp-note">Saved to both accounts.</p><button class="bigbtn ghost2" data-act="endmatch">Close the table</button>'
    : `<p class="tp-note">${esc(recordNote ?? 'Keep it on your record, or just close the table.')}</p>
       <button class="bigbtn" data-act="record"${recording ? ' disabled' : ''}>${recording ? 'Recording…' : 'Record this match'}</button>
       <button class="bigbtn ghost2" data-act="endmatch" style="margin-top:6px">Close the table</button>`;
  return head('Game over', verdict, `${ctx.state.round.n} rounds played.`, true)
    + `<div class="tp-body">${rows}</div><div class="tp-foot">${foot}</div>`;
}

function panelHtml(ctx: HudCtx): string {
  const s = ctx.state;
  const su = normaliseSetup(s.setup);
  if (su && su.stage !== 'done') return setupPanel(ctx, su);
  const phase = PHASES[s.round.phase];
  if (s.round.phase === 1) return planningPanel(ctx);
  if (s.round.phase === 2) return actionPanel(ctx);
  if (isLoopPhase(phase)) return loopPanel(ctx, phase);
  return endPanel(ctx);
}

// The last roll drawn. Anything newer than this has not been on screen yet and
// gets its one tumble; everything else is redrawn as it stands, so a roll does
// not re-roll itself every time something else on the page changes.
let feedSeen = 0;

// One die: its face's icons laid out in a row. They have to sit side by side —
// a face carrying two Hit icons drawn in one place looks like a single broken
// symbol, and reads as a die showing something it never showed.
function dieHtml(ctx: HudCtx, d: { color: string; face: number }): string {
  const face = ctx.diceData?.dice[d.color as DieColor]?.faces[d.face] ?? [];
  const icons = face.map((ic) => iconSvg(ic, 15)).join('');
  return `<span class="die die-${esc(d.color)}">${icons || '<span class="die-blank">·</span>'}</span>`;
}

// The naming step. One question at a time, asked of whoever the card says
// makes the choice, and the other player watches it happen — the freeplay
// guide asks the same questions in the same order, it just never has to
// decide whose screen to put them on.
function designatePanel(ctx: HudCtx, owed: Designation[]): string {
  const s = ctx.state;
  const mine = owed.filter((d) => !ctx.seat || d.by === ctx.seat);
  const now = mine[0] ?? owed[0];
  const theirCall = !!ctx.seat && now.by !== ctx.seat;
  const title = now.what === 'zone' ? `${now.label}: which Tactical Zone?`
    : now.what === 'leader' ? 'Designate your Commander'
      : `${now.label}: which Mech?`;
  const why = now.what === 'leader'
    ? 'Destroying the enemy Commander scores 10 VP and ends the game at once (5.2.3).'
    : now.side === now.by
      ? 'Named now, before anything deploys (5.2.3).'
      : `${squadLabel(now.side)} is playing for this, so you name the Mech (5.2.3).`;
  if (theirCall) {
    return head('Setup', 'Task Setup', 'Every Task names its Mech or Zone before anything deploys (5.2.3).', false)
      + `<div class="tp-body">${waiting(now.by, now.what === 'zone' ? 'naming a Tactical Zone' : 'naming a Mech')}
        ${designationSummary(ctx, owed)}</div><div class="tp-foot"></div>`;
  }
  const rows = now.what === 'zone'
    ? missionZones(ctx.data, s)
      .map((z) => `<button class="rowwide" data-desigzone="${esc(z.id)}">${esc(z.name)}</button>`)
      .join('')
    : s.tokens
      .filter((t) => t.kind === 'mech' && t.side === now.owner)
      .map((t) => `<button class="rowwide" data-desigmech="${t.uid}" data-desigfor="${now.side}" data-desigwhat="${now.what}">${esc(t.label)}<span class="ct">${squadLabel(t.side)}</span></button>`)
      .join('');
  return head('Your move', title, why, true)
    + `<div class="tp-body">${rows}${designationSummary(ctx, owed)}</div><div class="tp-foot"></div>`;
}

// What the whole step is still waiting on, so neither player is left guessing
// why the game has not started.
function designationSummary(ctx: HudCtx, owed: Designation[]): string {
  if (owed.length < 2) return '';
  const rows = owed.slice(1)
    .map((d) => `<div class="dialrow"><span class="nm ${d.side}">${esc(d.label)}</span><span class="tp-dim">${squadLabel(d.by)} to name</span></div>`)
    .join('');
  return `<div class="tp-gap"></div>${rows}`;
}

// The other player's move, slid rather than snapped. They watched their unit
// walk the route; this is the same walk seen from the other chair, which is
// what makes a move read as something that happened rather than a jump cut.
export function animateRemoteMove(uid: number, from: { col: number; row: number }, to: { col: number; row: number }): void {
  if (!board || (from.col === to.col && from.row === to.row)) return;
  board.animateMove(uid, [from, to], () => {
    if (hudRef) renderBoard(hudRef);
  });
}

// One row per squad: the Task they have taken, or the way to take one. Shown
// while the edge is being picked and again before deployment, because both
// moments are waiting on the same two answers.
function secondaryRows(ctx: HudCtx): string {
  const tasks = normaliseTasks(ctx.state.tasks);
  return (['s1', 's2'] as Side[])
    .map((side) => {
      const card = tasks.secondary[side] ? ctx.data.secondary.find((c) => c.id === tasks.secondary[side]) : undefined;
      const isMe = mine(ctx, side);
      // Your own pick stays changeable until deployment begins — the Task is
      // open information, not a commitment you can be trapped by.
      const cell = card
        ? isMe
          ? `<button class="rowbtn" data-sec="${side}" title="Change this Secondary Task">${esc(card.name)} ✎</button>`
          : `<span class="pickchip set">${esc(card.name)}</span>`
        : isMe
          ? `<button class="rowbtn" data-sec="${side}">Pick a Secondary Task</button>`
          : '<span class="tp-dim">picking…</span>';
      return `<div class="dialrow"><span class="nm ${side}">${squadLabel(side)}</span>${cell}</div>`;
    })
    .join('');
}

function feedHtml(ctx: HudCtx): string {
  if (!ctx.diceFeed.length) return '';
  const lines = ctx.diceFeed.slice(-3);
  const highest = lines.reduce((n, d) => Math.max(n, d.n), feedSeen);
  const rows = lines
    .map((d) => {
      const dice = d.dice.length
        ? `<span class="rolldice">${d.dice.map((x) => dieHtml(ctx, x)).join('')}</span>`
        : '';
      // The count sits on its own line under what it was rolled for, so a long
      // label can never wrap the number away from the word it belongs to.
      const sum = d.result.length
        ? d.result.map((r) => `<b>${r.n}</b>${d.kind === 'pool' ? '× ' : ' '}${esc(r.unit)}`).join(', ')
        : 'all blank';
      return `<div class="feedline${d.n > feedSeen ? ' rolling' : ''}">
        <div class="feedwho"><b class="${d.seat}">${squadLabel(d.seat)}</b> ${esc(d.label)}</div>
        <div class="feedres">${dice}<span class="feedsum">${sum}</span></div>
      </div>`;
    })
    .join('');
  feedSeen = highest;
  return `<div class="dicefeed">${rows}</div>`;
}

function secOverlay(ctx: HudCtx): string {
  if (!secOpen) return '';
  // A card that designates a Tactical Area needs the board to have some. The
  // Main Task decides that, and VIP places none at all — the same gate the
  // freeplay picker applies, so an impossible Task can never be chosen.
  const mission = ctx.state.mission ? ctx.data.missions.cards.find((m) => m.id === ctx.state.mission) : undefined;
  const hasZones = (mission?.zones ?? []).length > 0;
  const rows = ctx.data.secondary
    .map((c) => {
      const blocked = c.designate === 'zone' && !hasZones;
      return `<button class="pickrow${blocked ? ' blocked' : ''}${secPick === c.id ? ' sel' : ''}"${blocked ? ' disabled' : ''} data-picksec="${esc(c.id)}" data-img="${esc(secondaryImageUrl(c.id))}">
        <span class="nm">${esc(c.name)}</span>
        <span class="ct">${blocked ? 'needs Tactical Zones' : `${c.vp ?? 0} VP`}</span>
      </button>`;
    })
    .join('');
  const shown = secPick || ctx.data.secondary[0]?.id || '';
  // The card image rides on the left, filled in as rows are hovered — same
  // habit as the freeplay picker, so the details decide the pick.
  return `<div class="mc-veil" id="mc-secveil"><div class="acct seccards">
    <button class="x" id="mc-sec-x">✕</button>
    <div class="secsplit">
      <div class="seccard"><img id="mc-seccard" alt="" src="${esc(secondaryImageUrl(shown))}"></div>
      <div class="seclist">
        <h3>Pick a Secondary Task</h3>
        <div class="role">Open information — the other player sees your pick (3.1.3). Hover to read a card, then confirm.</div>
        ${rows}
        ${!hasZones ? '<p class="quiet">This Main Task places no Tactical Zones, so Tasks that designate one are unavailable.</p>' : ''}
        <button class="btn wide" id="mc-sec-ok"${secPick ? '' : ' disabled'}>Confirm this Task</button>
      </div>
    </div>
  </div></div>`;
}

// Mounts the HUD once and updates it in place from then on. The board is the
// same stateful renderer the freeplay page uses — zoom, pan, art and all — so
// it must never be torn down by a re-render.
export function ensureHud(host: HTMLElement, ctx: HudCtx): void {
  hudRef = ctx;
  if (!host.querySelector('#hud-shell')) {
    // The freeplay side panel moves to the LEFT here and keeps its own tabs,
    // so a player can read either squad and any card mid-match. The ids are
    // the ones SquadTracker and Panel bind to.
    // Squads and Details sit on the RIGHT, where a player coming from the
    // freeplay board expects them; the turn panel takes the left.
    host.innerHTML = `<div class="hud" id="hud-shell">
      <div class="turnpanel" id="hud-panel"></div>
      <div class="hudmain">
        <div id="hud-tl"></div>
        <div id="mc-board" class="hudboardhost"></div>
        <div id="hud-strip"></div>
      </div>
      <div class="hudside">
        <div class="hudtabs">
          <button class="hudtab active" data-sidetab="squad">Squads</button>
          <button class="hudtab" data-sidetab="details">Details</button>
        </div>
        <section id="tab-squad" class="side-tab active"><div id="squad-body"></div></section>
        <section id="tab-details" class="side-tab"><div id="details-body"></div></section>
      </div>
    </div><div id="hud-veils"></div>`;
    board = new Board(host.querySelector('#mc-board')!, boardCallbacks());
    // The shell was written this frame, so the board's own fit ran against a
    // column that had not settled yet.
    requestAnimationFrame(() => board?.fit());
    // The zone toggle floats bottom-left INSIDE the board, exactly where the
    // freeplay page keeps it — same markup, same .zone-ctrl styling.
    const zc = document.createElement('div');
    zc.className = 'zone-ctrl';
    zc.innerHTML = '<button id="btn-zones" title="Shows or hides the tactical zone and deployment overlay drawn on the board." aria-pressed="true">Zones</button>';
    host.querySelector('#mc-board')!.appendChild(zc);
    zc.querySelector('#btn-zones')!.addEventListener('click', () => hudRef?.toggleZones());
    ctx.mountSide();
    for (const b of host.querySelectorAll<HTMLElement>('[data-sidetab]')) {
      b.addEventListener('click', () => {
        for (const x of host.querySelectorAll('.hudtab')) x.classList.toggle('active', x === b);
        for (const s of host.querySelectorAll<HTMLElement>('.side-tab')) {
          s.classList.toggle('active', s.id === `tab-${b.dataset.sidetab}`);
        }
      });
    }
  }
  (host.querySelector('#hud-tl') as HTMLElement).innerHTML = timelineHtml(ctx.state);
  (host.querySelector('#hud-strip') as HTMLElement).innerHTML = orderStripHtml(ctx);
  (host.querySelector('#hud-panel') as HTMLElement).innerHTML =
    `${ctx.note ? `<div class="mc-err" style="margin:10px 12px 0">${esc(ctx.note)}</div>` : ''}${panelHtml(ctx)}${feedHtml(ctx)}`;
  (host.querySelector('#hud-veils') as HTMLElement).innerHTML = secOverlay(ctx);
  const zb = host.querySelector<HTMLButtonElement>('#btn-zones');
  if (zb) {
    zb.classList.toggle('on', ctx.zonesOn);
    zb.setAttribute('aria-pressed', ctx.zonesOn ? 'true' : 'false');
  }
  wireHud(host, ctx);
  renderBoard(ctx);
  ctx.syncSide(ensureScript(ctx.state).opp?.uid ?? null);
}

// ---------- wiring ----------

export function wireHud(root: HTMLElement, ctx: HudCtx): void {
  const s = ctx.state;
  // In a room this is simply my seat. Solo — the dev harness, where one screen
  // walks both squads — it has to be whoever is being asked, or the second
  // squad could never pass and the phase would never close.
  const me = (): Side => ctx.seat ?? ensureScript(ctx.state).turn ?? 's1';
  const on = (sel: string, fn: (el: HTMLElement) => void) => {
    for (const el of root.querySelectorAll<HTMLElement>(sel)) el.addEventListener('click', () => fn(el));
  };

  on('[data-act="lockmap"]', () => { ctx.send({ kind: 'lockMap', seat: me() }); ctx.refresh(); });
  on('[data-roll]', (el) => {
    const side = el.dataset.roll as Side;
    // The dice themselves reach the feed from the roll announcement, which
    // both players get; this only has to record what they were worth. The
    // squad's name is not in the label because the feed prints it in front.
    void ctx.rollHits(2, 'rolls for First Player').then((res) => {
      ctx.send({ kind: 'rollSetup', seat: side, hits: res.hits });
      ctx.refresh();
    });
  });
  on('[data-act="accept"]', () => { ctx.send({ kind: 'acceptRoll', seat: me() }); ctx.refresh(); });
  on('[data-edge]', (el) => { ctx.send({ kind: 'pickEdge', seat: s.round.firstPlayer, edge: el.dataset.edge as 'black' | 'white' }); ctx.refresh(); });
  on('[data-sec]', (el) => {
    secFor = el.dataset.sec as Side;
    secPick = null;
    secOpen = true;
    ctx.refresh();
  });
  // Choosing highlights; confirming commits. A Task is only locked in once
  // the player has read it and said so.
  on('[data-picksec]', (el) => {
    secPick = el.dataset.picksec!;
    ctx.refresh();
  });
  for (const el of root.querySelectorAll<HTMLElement>('[data-picksec]')) {
    el.addEventListener('mouseenter', () => {
      const img = root.querySelector<HTMLImageElement>('#mc-seccard');
      if (img && el.dataset.img) img.src = el.dataset.img;
    });
  }
  root.querySelector('#mc-sec-ok')?.addEventListener('click', () => {
    if (secPick) ctx.send({ kind: 'pickSecondary', seat: secFor ?? me(), cardId: secPick });
    secOpen = false;
    secPick = null;
    ctx.refresh();
  });
  root.querySelector('#mc-sec-x')?.addEventListener('click', () => { secOpen = false; secPick = null; ctx.refresh(); });
  on('[data-place]', (el) => {
    // Picking a different unit gives up an unconfirmed placement — it was
    // never sent, so there is nothing on the board to take back.
    pending = null;
    board?.clearGhost();
    placing = placing === Number(el.dataset.place) ? null : Number(el.dataset.place);
    ctx.refresh();
  });
  on('[data-act="confirmplace"]', () => {
    // Now it lands, and only now does the turn pass to the other squad.
    if (pending) {
      const t = ctx.state.tokens.find((x) => x.uid === pending!.uid);
      const v = ctx.send({
        kind: 'deployUnit', seat: t?.side ?? me(), uid: pending.uid,
        to: { col: pending.col, row: pending.row },
      });
      if (!v.ok) { ctx.refresh(); return; }
    }
    pending = null;
    placing = null;
    board?.clearGhost();
    ctx.refresh();
  });
  // Cell and token interaction now belongs to the shared Board's callbacks.
  on('[data-act="deployready"]', () => { ctx.send({ kind: 'setReady', seat: me(), ready: true }); ctx.refresh(); });
  on('[data-act="deployunready"]', () => { ctx.send({ kind: 'setReady', seat: me(), ready: false }); ctx.refresh(); });
  on('[data-act="deploydone"]', () => { ctx.send({ kind: 'finishDeployment', seat: me() }); ctx.refresh(); });

  on('[data-dial]', (el) => {
    const [uid, timing] = el.dataset.dial!.split(':');
    const t = s.tokens.find((x) => x.uid === Number(uid));
    if (t) ctx.send({ kind: 'setTiming', seat: t.side, uid: t.uid, timing: timing as Timing });
    ctx.refresh();
  });

  on('[data-desigzone]', (el) => {
    ctx.send({ kind: 'designateTask', seat: me(), what: 'zone', zone: el.dataset.desigzone! });
    ctx.refresh();
  });
  on('[data-desigmech]', (el) => {
    ctx.send({
      kind: 'designateTask', seat: me(),
      what: el.dataset.desigwhat as 'target' | 'leader',
      for: el.dataset.desigfor as Side,
      uid: Number(el.dataset.desigmech),
    });
    ctx.refresh();
  });

  on('[data-designate]', (el) => {
    const t = s.tokens.find((x) => x.uid === Number(el.dataset.designate));
    if (t) ctx.send({ kind: 'designate', seat: t.side, uid: t.uid });
    ctx.refresh();
  });
  on('[data-act="pass"]', () => { ctx.send({ kind: 'passTurn', seat: me() }); ctx.refresh(); });
  on('[data-doact]', (el) => {
    if (el.dataset.why) { ctx.noteNow(el.dataset.why); ctx.refresh(); return; }
    const sc = ensureScript(s);
    const t = sc.opp ? s.tokens.find((x) => x.uid === sc.opp!.uid) : undefined;
    if (t) {
      const v = ctx.send({ kind: 'performAction', seat: t.side, uid: t.uid, actionId: el.dataset.doact! });
      const [y, r] = (el.dataset.pool ?? '0,0').split(',').map(Number);
      if (v.ok && (y || r)) attack = { y, r, name: el.dataset.an ?? 'attack' };
    }
    ctx.refresh();
  });
  on('[data-act="maneuver"]', (el) => {
    if (el.dataset.why) { ctx.noteNow(el.dataset.why); ctx.refresh(); return; }
    const sc = ensureScript(s);
    const t = sc.opp ? s.tokens.find((x) => x.uid === sc.opp!.uid) : undefined;
    if (t) startMovePlan(ctx, t);
    ctx.refresh();
  });
  on('[data-act="commitmove"]', () => commitMove(ctx));
  on('[data-act="cancelmove"]', () => cancelMove(ctx));
  on('[data-rollpool]', (el) => {
    const [y, r] = el.dataset.rollpool!.split(',').map(Number);
    void ctx.rollPool(y, r, attack?.name ?? 'attack').then(() => ctx.refresh());
  });
  on('[data-act="untarget"]', () => { targetUid = null; ctx.refresh(); });
  on('[data-pen]', (el) => {
    const sc = ensureScript(s);
    const actor = sc.opp ? s.tokens.find((x) => x.uid === sc.opp!.uid) : undefined;
    if (actor && targetUid !== null) {
      ctx.send({ kind: 'applyPenetration', seat: actor.side, uid: actor.uid, targetUid, slot: el.dataset.pen as never });
    }
    ctx.refresh();
  });
  on('[data-act="killpart"]', () => {
    const sc = ensureScript(s);
    const actor = sc.opp ? s.tokens.find((x) => x.uid === sc.opp!.uid) : undefined;
    if (actor && targetUid !== null) ctx.send({ kind: 'recordKill', seat: actor.side, uid: actor.uid, targetUid, what: 'part' });
    ctx.refresh();
  });
  on('[data-act="killunit"]', () => {
    const sc = ensureScript(s);
    const actor = sc.opp ? s.tokens.find((x) => x.uid === sc.opp!.uid) : undefined;
    if (actor && targetUid !== null) {
      ctx.send({ kind: 'recordKill', seat: actor.side, uid: actor.uid, targetUid, what: 'unit' });
      targetUid = null;
    }
    ctx.refresh();
  });
  on('[data-award]', (el) => {
    const side = el.dataset.award as Side;
    ctx.send({ kind: 'award', seat: me(), vp: { s1: side === 's1' ? 1 : 0, s2: side === 's2' ? 1 : 0 }, keys: [] });
    ctx.refresh();
  });
  on('[data-act="endopp"]', () => {
    const sc = ensureScript(s);
    if (sc.opp) {
      const t = s.tokens.find((x) => x.uid === sc.opp!.uid);
      ctx.send({ kind: 'endOpportunity', seat: t?.side ?? me(), uid: sc.opp.uid });
    }
    attack = null;
    movePlan = null;
    board?.clearMovePath();
    if (targetUid !== null && !s.tokens.some((x) => x.uid === targetUid)) targetUid = null;
    ctx.refresh();
  });
  on('[data-endstep]', (el) => { ctx.send({ kind: 'markEndStep', seat: me(), step: el.dataset.endstep! }); ctx.refresh(); });
  on('[data-act="advance"]', () => { ctx.send({ kind: 'advancePhase', seat: me() }); ctx.refresh(); });
  on('[data-act="record"]', () => {
    recording = true;
    recordNote = null;
    ctx.refresh();
    void ctx.recordMatch().then((why) => {
      recording = false;
      recorded = !why;
      recordNote = why;
      ctx.refresh();
    });
  });
  on('[data-act="endmatch"]', () => {
    recorded = false;
    recordNote = null;
    ctx.send({ kind: 'endMatch', seat: me() });
    ctx.refresh();
  });
  on('[data-act="lockdials"]', () => {
    // The commit/reveal handshake lives in match.ts, which owns the salt.
    root.dispatchEvent(new CustomEvent('mc-lockdials', { bubbles: true }));
  });
}
