import type { Command, CheckResult } from './commands';
import type { GameData } from './data';
import { secondaryImageUrl, squadLabel } from './data';
import { Board, footprint, snapPlacement, type BoardCallbacks } from './board';
import { printedDeployment, resolveZoneSetData } from './overlays';
import { maneuverRange, squadAllegiance } from './units';
import { crushTargets, reachableGrids } from './rules';
import { breakAwayCost } from './melee';
import { factionColour } from './icons';
import type { GameState, Side, Timing, Token, ExtraTick, Opportunity } from './types';
import { newOpportunity, newScriptState, PHASES, TIMINGS } from './types';
import { deployable, deployTurn, deploymentComplete, firstPlayerFrom, normaliseSetup, rollTotal, type SetupState } from './setup';
import { actionPhaseComplete, activationOrder, alive, canAct, commandTokensFor, eligibleUnits, isLoopPhase, loopComplete, nextActivation, nextTurn, type InitLookup, type LoopPhase } from './loop';
import { canManeuver, canPerform } from './ticks';
import { normaliseTasks } from './tasks';
import { tokenCards } from './units';

// The in-match HUD (Match Centre part 3a): one question at a time, per seat.
// Everything here renders from the shared GameState and issues the same
// commands the board page does; the board drawing is an honest schematic and
// the full interactive board is part 3b.

export interface DiceLine {
  seat: Side;
  text: string;
}

export interface HudCtx {
  data: GameData;
  state: GameState;
  seat: Side | null;
  networked: boolean;
  send(cmd: Command): CheckResult;
  // Rolls n yellow dice (server dice in a room, local in dev) → Hits per die.
  rollHits(n: number, label: string): Promise<number[]>;
  // Rolls an attack pool; the result lands in the shared dice feed.
  rollPool(y: number, r: number, label: string): Promise<void>;
  diceFeed: DiceLine[];
  note: string | null;
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
let unconfirmed: number | null = null; // placed this turn, still nudgeable
let moving = false;                // active unit is picking a destination
let targetUid: number | null = null; // enemy picked for damage bookkeeping
let attack: { y: number; r: number; name: string } | null = null; // pool of the action just performed
let secOpen = false;               // the Secondary Task picker overlay
let secFor: Side | null = null;    // whose pick the overlay is making

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
      } else if (moving) {
        const sc = ensureScript(s);
        const t = sc.opp ? s.tokens.find((x) => x.uid === sc.opp!.uid) : undefined;
        if (!t) return;
        const size = (t.size ?? 1) as 1 | 2 | 3;
        const snap = snapPlacement(col, row, size) ?? { col, row };
        board.showGhost(footprint({ ...snap, size }), canReach(ctx, t, snap.col, snap.row));
      }
    },
    onCellClick(col, row) {
      const ctx = hudRef;
      if (!ctx) return;
      const s = ctx.state;
      if (moving) {
        const sc = ensureScript(s);
        const t = sc.opp ? s.tokens.find((x) => x.uid === sc.opp!.uid) : undefined;
        if (t) {
          const snap = snapPlacement(col, row, (t.size ?? 1) as 1 | 2 | 3) ?? { col, row };
          if (!canReach(ctx, t, snap.col, snap.row)) return; // outside the range overlay
          ctx.send({ kind: 'maneuver', seat: t.side, uid: t.uid, to: snap });
        }
        moving = false;
        board?.clearGhost();
        ctx.refresh();
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
      const v = ctx.send({ kind: 'deployUnit', seat: t.side, uid: placing, to: snap });
      if (v.ok) unconfirmed = placing;
      board?.clearGhost();
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
  // Panning is the default; a placement or move click needs the cell instead.
  board.panEnabled = placing === null && !moving;
  board.clearHighlights();
  if (moving) {
    const sc = ensureScript(s);
    const t = sc.opp ? s.tokens.find((x) => x.uid === sc.opp!.uid) : undefined;
    // The same overlay freeplay shows: the Large Grids this unit can really
    // enter, with the step count on each.
    if (t) board.showReachable(reachableFor(ctx, t), maneuverRange(ctx.data, t));
  } else if (placing === null) {
    board.clearGhost();
  }
  const gone = new Set(s.removedTerrain ?? []);
  board.renderTerrain((ctx.data.terrain.layouts[s.map] ?? []).filter((p) => !gone.has(p.id)));
  const ov = resolveZoneSetData(ctx.data, s.zoneSet ?? '');
  // While setup runs, the printed Deployment Zones are always on the table,
  // whatever the zone overlay says (3.1.4).
  const su = normaliseSetup(s.setup);
  let deploy = ov.deploy;
  if (su && su.stage !== 'done' && !deploy) {
    const shapeId = (s.mission && ctx.data.zoneData.missionDeployment[s.mission]) || 'strips';
    deploy = printedDeployment(ctx.data, shapeId);
  }
  board.renderZones(ov.zones, deploy);
  const tasks = normaliseTasks(s.tasks);
  board.renderTaskItems(tasks.items, (zone) => {
    const z = ctx.data.zoneData.zones.find((x) => x.id === zone);
    const p = z?.cells[0] ? zref(z.cells[0]) : null;
    return p ? { c: p.col * 3 + 1, r: p.row * 3 + 1 } : null;
  });
  board.renderTokens(s);
  board.renderSmoke(s.smoke ?? []);
  board.renderMarkers(s.markers ?? []);
  board.setSelected(ensureScript(s).opp?.uid ?? null);
}

// The old schematic renderer, kept exported for reference until the lobby
// preview adopts the shared board too; the HUD no longer uses it.
export function boardHtml(ctx: HudCtx): string {
  const s = ctx.state;
  const pieces = ctx.data.terrain.layouts[s.map] ?? [];
  const fill = (t: string) => (t === 'container' ? 'rgba(61,220,132,.45)' : t === 'low_wall' ? '#4a5563' : '#39424e');
  const terrain = pieces
    .filter((p) => !(s.removedTerrain ?? []).includes(p.id))
    .flatMap((p) => p.subCells.map((c) => `<rect x="${c.col + 0.06}" y="${c.row + 0.06}" width="0.88" height="0.88" rx="0.12" fill="${fill(p.type)}"/>`))
    .join('');
  const active = ensureScript(s).opp?.uid;
  const tokens = s.tokens
    .filter((t) => t.deployed !== false)
    .map((t) => {
      const col = t.side === 's1' ? '#65a2d8' : '#ea6d76';
      const sz = t.size ?? 1;
      const ring = t.uid === active ? ` stroke="#f0b429" stroke-width="0.22"` : t.uid === targetUid ? ` stroke="#ea6d76" stroke-width="0.22" stroke-dasharray="0.4 0.25"` : '';
      return `<g data-tok="${t.uid}"><rect x="${t.col + 0.1}" y="${t.row + 0.1}" width="${sz - 0.2}" height="${sz - 0.2}" rx="0.25" fill="${col}" opacity="0.9"${ring}><title>${esc(t.label)}</title></rect>
        <text x="${t.col + sz / 2}" y="${t.row + sz / 2 + 0.32}" text-anchor="middle" font-size="${sz > 1 ? 1.1 : 0.7}" fill="#0f1216" font-weight="700">${esc(t.label.slice(0, 2))}</text></g>`;
    })
    .join('');
  const zones = objectiveCells(ctx.data, s)
    .map((z) => `<rect x="${z.c}" y="${z.r}" width="1" height="1" fill="rgba(240,180,41,.16)"/>`)
    .join('');
  // While placing, the placer's legal zone is tinted and everything else is not.
  let zoneTint = '';
  if (placing !== null) {
    const su = normaliseSetup(s.setup);
    const turn = su ? deployTurn(s, su) : null;
    if (turn) {
      zoneTint = [...deployCellsFor(ctx.data, s, turn)]
        .map((k) => { const [c, r] = k.split(','); return `<rect x="${c}" y="${r}" width="1" height="1" fill="rgba(61,220,132,.14)"/>`; })
        .join('');
    }
  }
  const clicks = placing !== null || moving
    ? Array.from({ length: 36 }, (_, r) =>
        Array.from({ length: 36 }, (_, c) => `<rect class="cellhit" data-cell="${c},${r}" x="${c}" y="${r}" width="1" height="1" fill="transparent"/>`).join(''),
      ).join('')
    : '';
  return `<div class="hudboardwrap"><svg class="hudsvg${placing !== null || moving ? ' placing' : ''}" viewBox="0 0 36 36">${zones}${zoneTint}${terrain}${tokens}${clicks}</svg></div>`;
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
    return head('Setup', 'Confirm the battlefield', 'The map and Main Task were set in the lobby (3.1.1).', true)
      + `<div class="tp-body"><p class="tp-note">${esc(s.map)} · ${s.mission ? esc(s.mission) : 'no Main Task'}</p></div>
        <div class="tp-foot"><button class="bigbtn" data-act="lockmap">Lock the battlefield</button></div>`;
  }
  if (su.stage === 'roll') {
    const winner = firstPlayerFrom(su);
    const rows = (['s1', 's2'] as Side[])
      .map((side) => {
        const r = su.rolls[side];
        const isMe = mine(ctx, side);
        const tie = su.rolls.s1.length && su.rolls.s2.length && !winner;
        const btn = isMe
          ? `<button class="rowbtn" data-roll="${side}">${tie ? 'Roll again' : r.length ? 'Re-roll' : 'Roll 2 dice'}</button>`
          : `<span class="tp-dim">${r.length && !tie ? '' : 'rolling…'}</span>`;
        return `<div class="dialrow"><span class="nm ${side}">${squadLabel(side)}</span>${btn}<span class="pickchip${r.length ? ' set' : ''}">${r.length ? `${rollTotal(r)} Hits` : '—'}</span></div>`;
      })
      .join('');
    return head('Setup', 'Roll for First Player', 'Two dice each, most Hits goes first (3.1.2).', true)
      + `<div class="tp-body">${rows}${winner ? `<p class="tp-note">${squadLabel(winner)} rolls higher.</p>` : ''}</div>
        <div class="tp-foot">${winner ? '<button class="bigbtn" data-act="accept">Continue</button>' : ''}</div>`;
  }
  if (su.stage === 'side') {
    const fp = s.round.firstPlayer;
    const tasks = normaliseTasks(s.tasks);
    const secRows = (['s1', 's2'] as Side[])
      .map((side) => {
        const card = tasks.secondary[side] ? ctx.data.secondary.find((c) => c.id === tasks.secondary[side]) : undefined;
        const isMe = mine(ctx, side);
        return `<div class="dialrow"><span class="nm ${side}">${squadLabel(side)}</span>
          ${card ? `<span class="pickchip set">${esc(card.name)}</span>` : isMe ? `<button class="rowbtn" data-sec="${side}">Pick a Secondary Task</button>` : '<span class="tp-dim">picking…</span>'}</div>`;
      })
      .join('');
    const edge = mine(ctx, fp)
      ? `<div class="btnrow"><button class="rowbtn" data-edge="white">Take the White edge</button><button class="rowbtn" data-edge="black">Take the Black edge</button></div>`
      : waiting(fp, 'picking a table edge');
    return head(mine(ctx, fp) ? 'Your move' : 'Setup', `${squadLabel(fp)} picks an edge`, 'The other side takes the opposite edge (3.1.2). Secondary Tasks are open information (3.1.3).', mine(ctx, fp))
      + `<div class="tp-body">${edge}<div class="tp-gap"></div>${secRows}</div><div class="tp-foot"></div>`;
  }
  // deploy
  const confirmRow = unconfirmed !== null
    ? `<button class="bigbtn" data-act="confirmplace">Confirm placement</button>
       <p class="tp-note">Or click another Grid in your zone to move it first.</p>`
    : '';
  const turn = deployTurn(s, su);
  if (!turn || deploymentComplete(s)) {
    return head('Setup', 'Deployment complete', '', true)
      + `<div class="tp-body"></div><div class="tp-foot">${confirmRow}<button class="bigbtn${unconfirmed !== null ? ' ghost2' : ''}" data-act="deploydone">Begin Round 1</button></div>`;
  }
  if (!mine(ctx, turn)) {
    placing = null;
    return head('Deployment', `${squadLabel(turn)} places a unit`, '', false)
      + `<div class="tp-body">${unconfirmed !== null ? confirmRow : ''}${waiting(turn, 'placing a unit')}</div><div class="tp-foot"></div>`;
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
      const cost = a.size === 'l' ? 3 : a.size === 'm' ? 2 : 1;
      const kind = (a.type ?? '').toLowerCase();
      const pool = `${a.yellowDice ?? 0},${a.redDice ?? 0}`;
      return `<button class="actrow k-${kind}"${v.ok ? '' : ' disabled'} data-doact="${esc(a.id)}" data-pool="${pool}" data-an="${esc(a.name?.en || a.id)}" title="${esc(v.ok ? a.type ?? '' : v.why ?? '')}">
        <span class="dotk"></span><span class="an">${esc((a.name?.en || a.id).slice(0, 30))}</span><span class="ac">${a.type ?? ''} · ${cost}t</span>
      </button>`;
    })
    .join('');
  const man = canManeuver(o);
  const ticksUsed = o.performed.length + (o.maneuvered ? 1 : 0);
  const ticks = Array.from({ length: o.maneuver + o.action }, (_, i) => `<span class="tick${i < ticksUsed ? ' used' : ''}"></span>`).join('');
  return `<div class="ticks">${ticks}</div>
    <button class="actrow k-moving${moving ? ' armed' : ''}"${man.ok ? '' : ' disabled'} data-act="maneuver" title="${esc(man.ok ? 'Then click the destination Grid. Path rules stay with the players for now.' : man.why ?? '')}">
      <span class="dotk"></span><span class="an">Maneuver</span><span class="ac">${moving ? 'click a Grid…' : 'move'}</span></button>
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
  return head('End Phase', `Round ${s.round.n} wraps up`, '', true)
    + `<div class="tp-body">${rows}${score}</div>
      <div class="tp-foot"><button class="bigbtn" data-act="advance"${all ? '' : ' disabled'}>${last ? 'Finish the game' : `Start Round ${s.round.n + 1}`}</button></div>`;
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

function feedHtml(ctx: HudCtx): string {
  if (!ctx.diceFeed.length) return '';
  const rows = ctx.diceFeed
    .slice(-3)
    .map((d) => `<div class="feedline"><b class="${d.seat}">${squadLabel(d.seat)}</b> ${esc(d.text)}</div>`)
    .join('');
  return `<div class="dicefeed">${rows}</div>`;
}

function secOverlay(ctx: HudCtx): string {
  if (!secOpen) return '';
  const rows = ctx.data.secondary
    .map((c) => `<button class="pickrow" data-picksec="${esc(c.id)}" data-img="${esc(secondaryImageUrl(c.id))}"><span class="nm">${esc(c.name)}</span><span class="ct">${c.vp ?? 0} VP</span></button>`)
    .join('');
  // The card image rides on the left, filled in as rows are hovered — same
  // habit as the freeplay picker, so the details decide the pick.
  return `<div class="mc-veil" id="mc-secveil"><div class="acct seccards">
    <button class="x" id="mc-sec-x">✕</button>
    <div class="secsplit">
      <div class="seccard"><img id="mc-seccard" alt="" src="${esc(secondaryImageUrl(ctx.data.secondary[0]?.id ?? ''))}"></div>
      <div class="seclist">
        <h3>Pick a Secondary Task</h3>
        <div class="role">Open information — the other player sees your pick (3.1.3). Hover to read the card.</div>
        ${rows}
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
    host.innerHTML = `<div class="hud" id="hud-shell">
      <div class="hudmain">
        <div id="hud-tl"></div>
        <div id="mc-board" class="hudboardhost"></div>
        <div id="hud-strip"></div>
      </div>
      <div class="turnpanel" id="hud-panel"></div>
    </div><div id="hud-veils"></div>`;
    board = new Board(host.querySelector('#mc-board')!, boardCallbacks());
  }
  (host.querySelector('#hud-tl') as HTMLElement).innerHTML = timelineHtml(ctx.state);
  (host.querySelector('#hud-strip') as HTMLElement).innerHTML = orderStripHtml(ctx);
  (host.querySelector('#hud-panel') as HTMLElement).innerHTML =
    `${ctx.note ? `<div class="mc-err" style="margin:10px 12px 0">${esc(ctx.note)}</div>` : ''}${panelHtml(ctx)}${feedHtml(ctx)}`;
  (host.querySelector('#hud-veils') as HTMLElement).innerHTML = secOverlay(ctx);
  wireHud(host, ctx);
  renderBoard(ctx);
}

// ---------- wiring ----------

export function wireHud(root: HTMLElement, ctx: HudCtx): void {
  const s = ctx.state;
  const me = (): Side => ctx.seat ?? 's1';
  const on = (sel: string, fn: (el: HTMLElement) => void) => {
    for (const el of root.querySelectorAll<HTMLElement>(sel)) el.addEventListener('click', () => fn(el));
  };

  on('[data-act="lockmap"]', () => { ctx.send({ kind: 'lockMap', seat: me() }); ctx.refresh(); });
  on('[data-roll]', (el) => {
    const side = el.dataset.roll as Side;
    void ctx.rollHits(2, 'First Player roll').then((hits) => {
      ctx.send({ kind: 'rollSetup', seat: side, hits });
      ctx.refresh();
    });
  });
  on('[data-act="accept"]', () => { ctx.send({ kind: 'acceptRoll', seat: me() }); ctx.refresh(); });
  on('[data-edge]', (el) => { ctx.send({ kind: 'pickEdge', seat: s.round.firstPlayer, edge: el.dataset.edge as 'black' | 'white' }); ctx.refresh(); });
  on('[data-sec]', (el) => {
    secFor = el.dataset.sec as Side;
    secOpen = true;
    ctx.refresh();
  });
  on('[data-picksec]', (el) => {
    ctx.send({ kind: 'pickSecondary', seat: secFor ?? me(), cardId: el.dataset.picksec! });
    secOpen = false;
    ctx.refresh();
  });
  for (const el of root.querySelectorAll<HTMLElement>('[data-picksec]')) {
    el.addEventListener('mouseenter', () => {
      const img = root.querySelector<HTMLImageElement>('#mc-seccard');
      if (img && el.dataset.img) img.src = el.dataset.img;
    });
  }
  root.querySelector('#mc-sec-x')?.addEventListener('click', () => { secOpen = false; ctx.refresh(); });
  on('[data-place]', (el) => {
    // Picking the next unit stands by the previous placement.
    unconfirmed = null;
    placing = placing === Number(el.dataset.place) ? null : Number(el.dataset.place);
    ctx.refresh();
  });
  on('[data-act="confirmplace"]', () => {
    unconfirmed = null;
    placing = null;
    board?.clearGhost();
    ctx.refresh();
  });
  // Cell and token interaction now belongs to the shared Board's callbacks.
  on('[data-act="deploydone"]', () => { ctx.send({ kind: 'finishDeployment', seat: me() }); ctx.refresh(); });

  on('[data-dial]', (el) => {
    const [uid, timing] = el.dataset.dial!.split(':');
    const t = s.tokens.find((x) => x.uid === Number(uid));
    if (t) ctx.send({ kind: 'setTiming', seat: t.side, uid: t.uid, timing: timing as Timing });
    ctx.refresh();
  });

  on('[data-designate]', (el) => {
    const t = s.tokens.find((x) => x.uid === Number(el.dataset.designate));
    if (t) ctx.send({ kind: 'designate', seat: t.side, uid: t.uid });
    ctx.refresh();
  });
  on('[data-act="pass"]', () => { ctx.send({ kind: 'passTurn', seat: me() }); ctx.refresh(); });
  on('[data-doact]', (el) => {
    const sc = ensureScript(s);
    const t = sc.opp ? s.tokens.find((x) => x.uid === sc.opp!.uid) : undefined;
    if (t) {
      const v = ctx.send({ kind: 'performAction', seat: t.side, uid: t.uid, actionId: el.dataset.doact! });
      const [y, r] = (el.dataset.pool ?? '0,0').split(',').map(Number);
      if (v.ok && (y || r)) attack = { y, r, name: el.dataset.an ?? 'attack' };
    }
    ctx.refresh();
  });
  on('[data-act="maneuver"]', () => {
    moving = !moving;
    ctx.refresh();
  });
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
    moving = false;
    if (targetUid !== null && !s.tokens.some((x) => x.uid === targetUid)) targetUid = null;
    ctx.refresh();
  });
  on('[data-endstep]', (el) => { ctx.send({ kind: 'markEndStep', seat: me(), step: el.dataset.endstep! }); ctx.refresh(); });
  on('[data-act="advance"]', () => { ctx.send({ kind: 'advancePhase', seat: me() }); ctx.refresh(); });
  on('[data-act="lockdials"]', () => {
    // The commit/reveal handshake lives in match.ts, which owns the salt.
    root.dispatchEvent(new CustomEvent('mc-lockdials', { bubbles: true }));
  });
}
