// THE TURN ORDER (OTTO, 2026-10-17 and 22): "a new function in PAD that lists
// out the timing turn order for units ... who is going and maybe who has gone".
// Picked from the mockups (https://claude.ai/artifact/MVS4zWXC6TyKtWyVNLnCeY):
// option A, a bottom sheet the bar's ORDER chip opens, and B3, a thin track in
// the Guided strip during the Action Phase that opens the same sheet.
//
// Nothing here decides an order. The Mechs come from the engine's own
// activationOrder (loop.ts, rulebook 3.4.1), so the list can never disagree
// with whose Opportunity the Guided strip hands out. Drones have no set order
// at all: in the Command, Automatic and Delay Phases the players take turns
// picking one (3.2.2, 3.5.1, 3.6.1), so they are listed, not numbered.

import type { GameData } from '../src/data';
import type { GameState, Side, Token } from '../src/types';
import { PHASES, TIMINGS } from '../src/types';
import { activationOrder, alive, dialHidden, isLoopPhase } from '../src/loop';
import { initiativeFor } from '../src/units';

// done: had its Opportunity this round. now: holds it. next: the one after.
// up: still to come. free: a Freeform table, which keeps no record of who has
// acted, so a row says nothing about it.
export type OrderState = 'done' | 'now' | 'next' | 'up' | 'free';

export interface OrderRow {
  uid: number;
  label: string;
  side: Side;
  timing: string;
  short: string;
  init?: number;
  state: OrderState;
  // Tied on Timing and Initiative with the row beside it. Between squads the
  // First Player's goes first and they alternate (3.4.1); within one squad the
  // owner picks. The order shown is the engine's, so the tag only says why.
  tie: boolean;
}

export interface OrderView {
  rows: OrderRow[];
  // Mechs on the table whose dial this phone cannot read yet: not set, or the
  // other player's before the reveal (3.3).
  hidden: Token[];
  drones: Token[];
}

export interface OrderLook {
  esc(s: string): string;
  sideName(s: Side): string;
}

// A side's own colour (ui.css --side-s1/--side-s2), as the pad's sideColour.
const dot = (s: Side) => `<span class="pad-order-dot" style="background:var(--side-${s})"></span>`;

export function turnOrder(data: GameData, s: GameState, guided: boolean): OrderView {
  const sc = s.script;
  const phase = s.round.phase;
  const onTable = (t: Token) => alive(t) && t.deployed !== false;
  const hidden = s.tokens.filter((t) => t.kind === 'mech' && onTable(t) && (!t.timing || dialHidden(s, t)));
  const masked = new Set(hidden.map((t) => t.uid));
  const order = activationOrder(s, (t, tm) => initiativeFor(data, t, tm)).filter((a) => !masked.has(a.uid));
  const acted = new Set(sc?.acted ?? []);
  // Only a Mech's Opportunity in the Action Phase is a place in this list; a
  // Command Phase activation (a Drone, or Coordination) is not.
  const opp = phase === 2 && sc?.opp?.timing ? sc.opp : null;
  let nextGiven = false;
  const rows = order.flatMap((a, i): OrderRow[] => {
    const t = s.tokens.find((x) => x.uid === a.uid);
    if (!t) return [];
    const def = TIMINGS.find((x) => x.id === a.timing);
    let state: OrderState;
    if (!guided || !sc) state = 'free';
    else if (phase < 2) state = 'up';
    else if (phase > 2) state = 'done';
    else if (opp?.uid === a.uid) state = 'now';
    else if (acted.has(a.uid)) state = 'done';
    else if (!nextGiven) { state = 'next'; nextGiven = true; }
    else state = 'up';
    const same = (b?: { timing: string; init?: number }) => !!b && b.timing === a.timing && b.init === a.init;
    return [{ uid: a.uid, label: t.label, side: t.side, timing: a.timing, short: def?.short ?? a.timing, init: a.init, state,
      tie: same(order[i - 1]) || same(order[i + 1]) }];
  });
  // "next" is the first row still owed that is not acting, in the engine's
  // order, which is the one nextActivation serves once this Opportunity ends.
  const drones = s.tokens.filter((t) => t.kind === 'drone' && onTable(t));
  return { rows, hidden, drones };
}

function rowHtml(r: OrderRow, n: number, look: OrderLook): string {
  const tag = { done: '✓', now: 'NOW', next: 'NEXT', up: '', free: '' }[r.state];
  return `<li class="pad-order-row ${r.state}" data-act="order-unit" data-uid="${r.uid}">
    <span class="pad-order-n">${n}</span>
    <span class="pad-order-t" data-timing="${look.esc(r.timing)}">${look.esc(r.short)}${r.init !== undefined ? ` ${r.init}` : ''}</span>
    <span class="pad-order-name">${dot(r.side)}<span>${look.esc(r.label)}</span>${
      r.tie ? '<small>TIE</small>' : ''}</span>
    ${tag ? `<span class="pad-order-tag">${tag}</span>` : ''}
  </li>`;
}

// The sheet's body. The frame (the house dialog, docked as a sheet) is the
// pad's; this is what goes inside it.
export function orderSheetHtml(data: GameData, s: GameState, guided: boolean, look: OrderLook): string {
  const v = turnOrder(data, s, guided);
  const fp = s.round.firstPlayer;
  const rows = v.rows.map((r, i) => rowHtml(r, i + 1, look)).join('');
  const hidden = v.hidden.map((t) => `<li class="pad-order-row hidden">
    <span class="pad-order-n">?</span><span class="pad-order-t">???</span>
    <span class="pad-order-name">${dot(t.side)}<span>${look.esc(t.label)}</span></span>
    <span class="pad-order-tag">${t.timing ? 'HIDDEN' : 'NO DIAL'}</span></li>`).join('');
  const phase = PHASES[s.round.phase] ?? '';
  const loop = isLoopPhase(phase) && guided && s.script;
  const acted = new Set(s.script?.acted ?? []);
  const drones = v.drones.map((t) => `<li class="pad-order-row${loop && acted.has(t.uid) ? ' done' : ''}" data-act="order-unit" data-uid="${t.uid}">
    <span class="pad-order-name">${dot(t.side)}<span>${look.esc(t.label)}</span></span>
    ${loop && acted.has(t.uid) ? '<span class="pad-order-tag">✓</span>' : ''}</li>`).join('');
  const none = !v.rows.length && !v.hidden.length;
  return `<h3 class="dlg-title">Turn order · R${s.round.n} // ${look.esc(phase)}</h3>
    <p class="pad-order-sub">${look.esc(look.sideName(fp))} is First Player this round.</p>
    <p class="pad-label pad-sec">Mechs</p>
    ${none ? '<p class="pad-order-note">No Mech has a Timing Dial set yet.</p>' : `<ol class="ui-list pad-order">${rows}${hidden}</ol>`}
    ${v.hidden.length ? '<p class="pad-order-note">A Mech marked ? takes its place once its dial is revealed.</p>' : ''}
    ${!guided ? '<p class="pad-order-note">Freeform keeps no record of who has acted: the order is from the dials this phone knows.</p>' : ''}
    ${v.drones.length ? `<p class="pad-label pad-sec pad-order-grey">Drones</p>
    <p class="pad-order-note">No set order: in the Command, Automatic and Delay Phases the players take turns picking one, the First Player first.</p>
    <ul class="ui-list pad-order">${drones}</ul>` : ''}`;
}

// B3: one segment per Mech in its timing's colour, the ones gone faded, the one
// acting thicker, and where the turn has got to under it. Action Phase only,
// Guided only; it opens the sheet.
export function orderTrackHtml(data: GameData, s: GameState, look: OrderLook): string {
  if (s.round.phase !== 2) return '';
  const v = turnOrder(data, s, true);
  const total = v.rows.length + v.hidden.length;
  if (total < 2) return '';
  const segs = v.rows.map((r) => `<i class="${r.state}" data-timing="${look.esc(r.timing)}"></i>`).join('')
    + v.hidden.map(() => '<i class="up"></i>').join('');
  const now = v.rows.findIndex((r) => r.state === 'now');
  const at = now >= 0 ? now + 1 : Math.min(v.rows.filter((r) => r.state === 'done').length + 1, total);
  const next = v.rows.find((r) => r.state === 'next');
  const cap = next ? `NEXT <b>${look.esc(next.label)}</b>` : now >= 0 ? '<b>LAST MECH</b>' : '';
  return `<button class="pad-order-track" type="button" data-act="order" aria-label="${look.esc(`Mech ${at} of ${total}.${next ? ` Next: ${next.label}.` : ''} Open the turn order`)}">
    <span class="pad-order-tw"><span class="pad-order-segs">${segs}</span>
      <span class="pad-order-cap"><span>${at} / ${total}</span>${cap ? `<span>${cap}</span>` : ''}</span></span>
    <span class="ui-go" aria-hidden="true">›</span>
  </button>`;
}
