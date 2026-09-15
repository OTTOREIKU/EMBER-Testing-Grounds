// GUIDED PLAY on the pad: the Match Centre's scripted game with no board.
//
// The engine already runs the whole round without a position - setup ladder,
// designation loops, Timing Dials, the Continue agreement, the End Phase
// steps - and glue.ts derives whose turn it is on every client. What this
// module adds is the phone's face for it: one strip under the bar that says
// whose move it is and what the step asks, and the handful of commands each
// button sends. Anything positional (movement, range, who stands in a zone)
// stays with the physical table; the engine's noBoard flag leaves it alone.
//
// No teaching voice: a prompt names the step and, at most, the rule's number.
import type { GameData } from '../src/data';
import { actionIconUrl, cardName } from '../src/data';
import { readyCommands, taskDesignations, missionZones, type CheckResult, type Command } from '../src/commands';
import { asterBlockers, offerCoordination, runAster } from '../src/commandpick';
import { canAct, dialHidden, eligibleUnits, isLoopPhase, loopComplete, nextTurn, type LoopPhase } from '../src/loop';
import { deployTurn, deployable, deploymentComplete, firstPlayerFrom, normaliseSetup, rollTotal } from '../src/setup';
import { ensureScript } from '../src/glue';
import { canActivate, canAttackMode, canOverload, canPerform, costOf, extrasLeft, lengthOf, OVERLOAD_MAX, type TickVerdict } from '../src/ticks';
import { chargeableSlots, coordinationFor, coordinationOnOpportunityEnd, electronicValue, extraActivationOf, formSwitch, guidedActions, initiativeFor, isChargeAction, isElectronicAttack, linkTickTraitOn, loanedParts, opportunityBonusOn, pilotCard, repairSpec, resupplyOf, selfGrantWhy, selfStatusGrant, SLOT_LABEL, tokenCards, transformOffer, unfoldsOwed } from '../src/units';
import { normaliseTasks } from '../src/tasks';
import { dialsOf, hashDials, newSalt, type DialEntry } from '../src/secrecy';
import { PHASES, TIMINGS, type CardAction, type GameState, type PartSlot, type Side, type Timing, type Token } from '../src/types';
import { choiceDialog } from '../src/dialog';

// What the pad lends the guide. Kept as functions where the value moves.
export interface GuideApi {
  data: GameData;
  state(): GameState;
  me(): Side;
  solo: boolean;
  inRoom(): boolean;
  send(cmd: Command): boolean;
  toast(text: string): void;
  // n Yellow dice, the Hits per die. Server dice in a room, local solo.
  rollHits(n: number, label: string): Promise<number[]>;
  render(): void;
  selectUnit(uid: number): void;
  sideName(s: Side): string;
  esc(s: string): string;
  // The Continue agreement the pad already runs on the bar.
  pressContinue(): void;
  readiness(): { me: boolean; them: boolean };
  // Opens the attack window for a Firing or Melee Action (attack.ts); the
  // pad pays the Action once the table has judged the shot.
  attack?(uid: number, actionId: string, opts?: { electronic?: boolean; granted?: boolean }): void;
  // The engine's verdict without performing, for a chip that shows why not.
  check(cmd: Command): CheckResult;
  // The Tactics Cards this side could play in the phase that is on, and the
  // play itself (pad.ts asks the card's questions).
  tactics(side: Side): { playable: { id: string; name: string }[]; play(id: string): void };
  // Guided's End the game: pad.ts offers the record before the engine's endMatch.
  endGame(): void;
  // A Projectile's Delayed Action (pad.ts): the table names the units in the
  // blast; damage through the window as Explosion damage.
  detonate(uid: number, actionId: string): void;
  // Launches the projectiles an Action fires (pad.ts): pays the Action, then
  // one `launch` per projectile in the volley.
  launch?(uid: number, actionId: string, cardId: string): void;
}

const other = (s: Side): Side => (s === 's1' ? 's2' : 's1');

// Whether the table is in a guided game at all.
export function guidedOn(state: GameState): boolean {
  return !!normaliseSetup(state.setup);
}

// The unit whose Action Opportunity is open, if it is one of ours to drive.
export function activeOpp(api: GuideApi): { uid: number; mine: boolean } | null {
  const s = api.state();
  if (!guidedOn(s)) return null;
  const opp = s.script?.opp;
  if (!opp) return null;
  const t = s.tokens.find((x) => x.uid === opp.uid);
  if (!t) return null;
  return { uid: opp.uid, mine: api.solo || t.side === api.me() };
}

// Whose designation turn it is, read the way every client reads it: the
// scripted turn if that side can still act, else whoever can.
function turnOf(s: GameState, phase: LoopPhase, data: GameData): Side | null {
  const sc = ensureScript(s);
  if (canAct(s, phase, sc.turn, data)) return sc.turn;
  return nextTurn(s, phase, sc.turn, data);
}

// ---------- the dial secret ----------
//
// The committed dials and the salt behind them, kept on this phone until the
// reveal - the same shape the Match Centre keeps, so a reload mid-Planning does
// not lose the commitment.
const DIAL_KEY = 'ember.pad.dials';
type DialSecret = { round: number; salt: string; dials: DialEntry[] };

function dialSecret(): DialSecret | null {
  try {
    const raw = localStorage.getItem(DIAL_KEY);
    return raw ? (JSON.parse(raw) as DialSecret) : null;
  } catch {
    return null;
  }
}

function keepDialSecret(v: DialSecret | null): void {
  try {
    if (v) localStorage.setItem(DIAL_KEY, JSON.stringify(v));
    else localStorage.removeItem(DIAL_KEY);
  } catch {
    // Kept in the running page only; a reload mid-Planning recommits.
  }
}

function lockDialsNetworked(api: GuideApi): void {
  const s = api.state();
  const seat = api.me();
  const sc = ensureScript(s);
  const held = dialSecret();
  if (sc.commits[seat] && held?.round === s.round.n) return;
  const dials = dialsOf(s, seat);
  const salt = newSalt();
  keepDialSecret({ round: s.round.n, salt, dials });
  void hashDials(salt, dials).then((hash) => {
    api.send({ kind: 'commitTimings', seat, hash });
    maybeReveal(api);
    api.render();
  });
}

function maybeReveal(api: GuideApi): void {
  const s = api.state();
  const seat = api.me();
  const sc = s.script;
  const held = dialSecret();
  if (!sc || !held || held.round !== s.round.n) return;
  if (!sc.commits.s1 || !sc.commits.s2) return;
  if (sc.revealed.includes(seat)) return;
  api.send({ kind: 'revealTimings', seat, salt: held.salt, dials: held.dials });
}

// The other phone's command has landed: what the guide does about it.
export function guideOnRemote(api: GuideApi, cmd: Command): void {
  if (cmd.kind === 'commitTimings') maybeReveal(api);
  if (cmd.kind === 'revealTimings' && !api.solo) {
    const promised = api.state().script?.commits[cmd.seat];
    if (promised) {
      void hashDials(cmd.salt, cmd.dials).then((actual) => {
        if (actual !== promised) api.toast(`${api.sideName(cmd.seat)}'s revealed dials do not match their commitment.`);
      });
    }
  }
}

// ---------- the strip ----------

function head(api: GuideApi, title: string, sub: string, mine: boolean): string {
  return `<div class="pad-turn-h${mine ? ' mine' : ''}"><b>${api.esc(title)}</b>${sub ? `<span>${api.esc(sub)}</span>` : ''}</div>`;
}

function waiting(api: GuideApi, side: Side, doing: string): string {
  return `<p class="pad-turn-wait">${api.esc(api.sideName(side))} · ${api.esc(doing)}</p>`;
}

function btn(api: GuideApi, act: string, label: string, attrs = '', cls = 'pad-chip'): string {
  return `<button class="${cls}" data-act="${act}" ${attrs}>${api.esc(label)}</button>`;
}

export function turnHtml(api: GuideApi): string {
  const s = api.state();
  const su = normaliseSetup(s.setup);
  if (!su) return '';
  if (su.stage !== 'done') return setupHtml(api, su.stage);
  const phase = PHASES[s.round.phase];
  // A reaction owed to one of this phone's units comes before the phase.
  const owed = reactionsOwed(api);
  const react = (owed.length ? reactionHtml(api, owed[0]) : '') + tacticsStrip(api);
  if (isLoopPhase(phase)) return react + loopHtml(api, phase);
  if (s.round.phase === 1) return react + planningHtml(api);
  if (s.round.phase === 2) return react + actionHtml(api);
  return react + endHtml(api);
}

// A Tactics Card whose phase is on, for each side this phone holds. One per
// round; the engine refuses a second.
function tacticsStrip(api: GuideApi): string {
  const sides: Side[] = api.solo ? ['s1', 's2'] : [api.me()];
  const chips = sides.flatMap((side) => api.tactics(side).playable.map((c) => btn(api, 'g-tactic', `${api.solo ? `${api.sideName(side)} · ` : ''}${c.name}`, `data-side="${side}" data-id="${api.esc(c.id)}"`)));
  return chips.length ? `<div class="pad-turn-react"><p class="pad-turn-name">Tactics Card</p><div class="pad-chips">${chips.join('')}</div></div>` : '';
}

// ---------- reactions (the Match Centre's reaction panel, on the strip) ----------

type Owed = NonNullable<GameState['script']>['reactions'][number];

function reactionsOwed(api: GuideApi): { t: Token; r: Owed }[] {
  const s = api.state();
  return (ensureScript(s).reactions ?? [])
    .map((r) => ({ t: s.tokens.find((x) => x.uid === r.uid)!, r }))
    .filter((x) => !!x.t && mine(api, x.t.side));
}

function reactionHtml(api: GuideApi, owed: { t: Token; r: Owed }): string {
  const { t, r } = owed;
  const s = api.state();
  // The Action may sit on any of the unit's Parts, not only its core card.
  const what = tokenCards(api.data, t).flatMap(({ card }) => card.actions ?? []).find((a) => a.id === r.actionId);
  const name = what?.name?.en
    || (r.kind === 'stance' ? 'Defense Reaction' : r.kind === 'riposte' ? 'Riposte' : r.kind === 'trace' ? 'Target Tracing'
      : r.kind === 'manifest' ? 'Scanned' : r.kind === 'scanAttack' ? 'Attack resumes' : 'Emergency Smoke');
  const key = `data-uid="${t.uid}" data-id="${api.esc(r.actionId)}"`;
  const from = s.tokens.find((x) => x.uid === r.fromUid);
  let body = '';
  let buttons = '';
  if (r.kind === 'riposte') {
    body = `${api.esc(t.label)} parried: ${api.esc(from?.label ?? 'the attacker')} ends its Action Opportunity, then a Melee Action follows.`;
    buttons = btn(api, 'g-riposte', 'Riposte', key, 'pad-chip on') + btn(api, 'g-riposte', 'End the Opportunity only', `${key} data-only="1"`);
  } else if (r.kind === 'stance') {
    body = `A Part of ${api.esc(t.label)} was Penetrated: it may change to Defensive Stance.`;
    buttons = btn(api, 'g-react-go', 'Defensive Stance', key, 'pad-chip on');
  } else if (r.kind === 'trace') {
    const ev = electronicValue(api.data, t, loanedParts(api.data, s.tokens, t));
    body = `${api.esc(t.label)} may spend 1 Command Token to open an Electronic Counter-roll at ${api.esc(from?.label ?? 'the attacker')} (174).`;
    buttons = from && ev > 0 ? btn(api, 'g-react-go', 'Spend a Command Token and roll', key, 'pad-chip on') : '';
  } else if (r.kind === 'manifest') {
    body = `${api.esc(t.label)} is Revealed: make its Manifestation Movement on the table (4.12.4).`;
    buttons = btn(api, 'g-react-go', 'Done', key, 'pad-chip on');
    return `<div class="pad-turn-react"><p class="pad-turn-name">${api.esc(name)}</p><p class="pad-turn-note">${body}</p><div class="pad-chips">${buttons}</div></div>`;
  } else if (r.kind === 'scanAttack') {
    body = `${api.esc(t.label)}'s attack on ${api.esc(from?.label ?? 'the target')} resumes (FAQ I12).`;
    buttons = btn(api, 'g-react-go', 'Attack', key, 'pad-chip on');
  } else {
    body = `${api.esc(t.label)} may place ${r.count} Smoke Screen${r.count === 1 ? '' : 's'} within Range ${r.range}, on the table.`;
    buttons = btn(api, 'g-react-go', 'Placed', key, 'pad-chip on');
  }
  return `<div class="pad-turn-react"><p class="pad-turn-name">${api.esc(name)}</p><p class="pad-turn-note">${body}</p>
    <div class="pad-chips">${buttons}${btn(api, 'g-react-skip', 'Skip', key)}</div></div>`;
}

function answerReaction(api: GuideApi, uid: number, actionId: string, take: boolean): void {
  const s = api.state();
  const t = s.tokens.find((x) => x.uid === uid);
  const r = (ensureScript(s).reactions ?? []).find((x) => x.uid === uid && x.actionId === actionId);
  if (!t || !r) return;
  if (!api.send({ kind: 'resolveReaction', seat: t.side, uid, actionId })) return;
  if (!take || r.kind === 'manifest') return;
  if (r.kind === 'scanAttack') { if (r.fromUid !== undefined) api.attack?.(uid, actionId); return; }
  if (r.kind === 'stance') { api.send({ kind: 'defenseReaction', seat: t.side, uid }); return; }
  if (r.kind === 'trace') {
    if (!api.send({ kind: 'spendCommand', seat: t.side, uid })) return;
    // The counter-roll back at the attacker: the record in a room, the local
    // exchange solo. Range does not apply to a Target Tracing.
    if (api.solo) api.attack?.(uid, actionId, { electronic: true });
    else api.send({ kind: 'startCounterRoll', seat: t.side, uid, targetUid: r.fromUid!, actionId, reaction: true });
  }
  // Smoke: placed on the table; the debt is spent.
}

// One phone may hold a side in a room, or both solo.
function mine(api: GuideApi, side: Side): boolean {
  return api.solo || api.me() === side;
}

function setupHtml(api: GuideApi, stage: string): string {
  const s = api.state();
  const su = normaliseSetup(s.setup)!;
  if (stage === 'map') return head(api, 'Setup', 'Preparing the table', true);
  if (stage === 'roll') {
    const winner = firstPlayerFrom(su);
    const both = !!su.rolls.s1.length && !!su.rolls.s2.length;
    const tie = both && !winner;
    const rows = (['s1', 's2'] as Side[]).map((side) => {
      const r = su.rolls[side];
      const can = mine(api, side) && (!r.length || tie);
      return `<div class="pad-turn-row"><span class="pad-turn-name">${api.esc(api.sideName(side))}</span>
        <span class="pad-turn-val">${r.length ? `${rollTotal(r)} Hits` : '—'}</span>
        ${can ? btn(api, 'g-roll', r.length ? 'Re-roll' : 'Roll 2 dice', `data-side="${side}"`) : ''}</div>`;
    }).join('');
    return head(api, 'Roll for First Player', '3.1.2', true) + rows
      + (tie ? '<p class="pad-turn-note">Tie: both roll again.</p>' : '')
      + (winner ? `<p class="pad-turn-note">${api.esc(api.sideName(winner))} goes first.</p>${btn(api, 'g-accept', 'Continue', '', 'pad-chip on')}` : '');
  }
  if (stage === 'tasks') {
    const fp = s.round.firstPlayer;
    const tasks = normaliseTasks(s.tasks);
    const owed = taskDesignations(api.data, s);
    const rows = [fp, other(fp)].map((side) => {
      const id = tasks.secondary[side];
      const card = id ? api.data.secondary.find((c) => c.id === id) : undefined;
      return `<div class="pad-turn-row"><span class="pad-turn-name">${api.esc(api.sideName(side))}</span>
        <span class="pad-turn-val">${card ? api.esc(card.name) : '—'}</span>
        ${mine(api, side) ? btn(api, 'g-secondary', card ? 'Change' : 'Choose', `data-side="${side}"`) : ''}</div>`;
    }).join('');
    const desig = owed.map((d, i) => `<div class="pad-turn-row"><span class="pad-turn-name">${api.esc(d.label)}</span>
        ${mine(api, d.by) ? btn(api, 'g-designate-task', 'Choose', `data-i="${i}"`) : `<span class="pad-turn-val">${api.esc(api.sideName(d.by))} chooses</span>`}</div>`).join('');
    const done = !!tasks.secondary.s1 && !!tasks.secondary.s2 && !owed.length;
    return head(api, 'Secondary Tasks', `${api.sideName(fp)} first (FAQ P1)`, true) + rows + desig
      + (done ? btn(api, 'g-tasks-done', 'Continue', '', 'pad-chip on') : '');
  }
  if (stage === 'side') {
    const fp = s.round.firstPlayer;
    return head(api, `${api.sideName(fp)} picks a table edge`, '3.1.2', mine(api, fp))
      + (mine(api, fp)
        ? `<div class="pad-chips">${btn(api, 'g-edge', 'White edge', 'data-edge="white"')}${btn(api, 'g-edge', 'Black edge', 'data-edge="black"')}</div>`
        : waiting(api, fp, 'picking an edge'));
  }
  // deploy
  const turn = deployTurn(s, su);
  const complete = deploymentComplete(s);
  const rows = (['s1', 's2'] as Side[]).flatMap((side) => deployable(s, side).map((t) => `<div class="pad-turn-row">
      <span class="pad-turn-name">${api.esc(t.label)}</span><span class="pad-turn-val">${api.esc(api.sideName(side))}</span>
      ${mine(api, side) && (api.solo || turn === side) ? btn(api, 'g-deploy', 'On the table', `data-uid="${t.uid}"`) : ''}</div>`));
  const rd = api.readiness();
  return head(api, 'Deploy', turn ? `${api.sideName(turn)} places next (3.1.4)` : 'Everything is placed', !!turn && mine(api, turn))
    + rows
    + (complete
      ? (api.solo
        ? btn(api, 'g-deployed', 'Begin Round 1', '', 'pad-chip on')
        : rd.me ? `<p class="pad-turn-note">Waiting for ${api.esc(api.sideName(other(api.me())))}.</p>` : btn(api, 'g-deployed', 'Begin Round 1', '', 'pad-chip on'))
      : '');
}

function loopHtml(api: GuideApi, phase: LoopPhase): string {
  const s = api.state();
  const sc = ensureScript(s);
  const opp = sc.opp;
  if (opp) {
    const t = s.tokens.find((x) => x.uid === opp.uid);
    if (t) {
      const owner = mine(api, t.side);
      const what = phase === 'Command'
        ? t.kind === 'mech' ? 'Fire the commanded Part (RWS), then end.' : 'One Command Action, or moved.'
        : phase === 'Automatic' ? 'One Automatic Action, or moved.' : 'Its Delay Action, then end.';
      return head(api, t.label, what, owner)
        + (owner
          ? `<div class="pad-chips">${t.kind !== 'mech' ? btn(api, 'g-moved', 'Moved') : ''}${btn(api, 'g-end', 'End activation', '', 'pad-chip on')}</div>`
          : waiting(api, t.side, 'acting'));
    }
  }
  const turn = turnOf(s, phase, api.data);
  if (loopComplete(s, phase, api.data) || turn === null) {
    return head(api, `${phase} Phase over`, '', true) + `<p class="pad-turn-note">Continue when both are ready.</p>`;
  }
  const noun = phase === 'Command' ? 'a Drone' : phase === 'Automatic' ? 'a Drone' : 'a Projectile';
  if (!mine(api, turn)) return head(api, `${api.sideName(turn)} designates`, `${phase} Phase`, false) + waiting(api, turn, `picking ${noun} or passing`);
  const units = eligibleUnits(s, phase, turn, api.data);
  const tokens = phase === 'Command' ? `<span class="pad-turn-val">Command Tokens · ${s.commandTokens?.[turn] ?? 0}</span>` : '';
  const rows = units.map((u) => btn(api, 'g-designate', u.label, `data-uid="${u.uid}" data-side="${turn}"`)).join('');
  return head(api, phase === 'Command' ? 'Command a Drone' : `Activate ${noun}`, `${phase} Phase · ${api.sideName(turn)}`, true)
    + `<div class="pad-chips">${rows}${btn(api, 'g-pass', 'Pass', `data-side="${turn}"`)}</div>${tokens}${phase === 'Command' ? asterHtml(api, turn) : ''}`;
}

function planningHtml(api: GuideApi): string {
  const s = api.state();
  const sc = ensureScript(s);
  const sides: Side[] = api.solo ? ['s1', 's2'] : [api.me()];
  // Dials set no more once this side has locked: solo after lockDials, in a
  // room after its commit.
  const locked = api.solo ? sc.stage === `${s.round.n}:1:locked` : !!sc.commits[api.me()];
  const rows = sides.flatMap((side) => s.tokens
    .filter((t) => t.side === side && t.kind === 'mech' && (t.partStates.torso ?? 'intact') !== 'destroyed' && t.stance !== 'shutdown')
    .map((t) => {
      const hidden = dialHidden(s, t);
      const chips = TIMINGS.map((tm) => {
        const init = initiativeFor(api.data, t, tm.id);
        const ic = actionIconUrl(tm.pilotKey);
        return `<button class="pad-chip pad-dial${t.timing === tm.id ? ' on' : ''}" data-act="g-timing" data-uid="${t.uid}" data-timing="${tm.id}"${locked ? ' disabled' : ''}>${ic ? `<img src="${ic}" alt="">` : ''}${api.esc(`${tm.short}${init !== undefined ? ` ${init}` : ''}`)}</button>`;
      }).join('');
      return `<div class="pad-turn-unit"><span class="pad-turn-name">${api.esc(t.label)}${api.solo ? ` · ${api.esc(api.sideName(side))}` : ''}</span>
        ${hidden ? '<span class="pad-turn-val">hidden</span>' : `<div class="pad-chips pad-dials">${chips}</div>`}</div>`;
    }));
  const unset = sides.reduce((n, side) => n + s.tokens.filter((t) => t.side === side && t.kind === 'mech' && (t.partStates.torso ?? 'intact') !== 'destroyed' && t.stance !== 'shutdown' && !t.timing).length, 0);
  let foot: string;
  if (api.solo) {
    foot = sc.stage === `${s.round.n}:1:locked`
      ? '<p class="pad-turn-note">Dials locked. Continue when ready.</p>'
      : btn(api, 'g-lock', unset ? `Lock in (${unset} left)` : 'Lock in', unset ? 'disabled' : '', 'pad-chip on');
  } else {
    const me = api.me();
    const committed = !!sc.commits[me];
    const both = !!sc.commits.s1 && !!sc.commits.s2;
    const revealed = sc.revealed.includes('s1') && sc.revealed.includes('s2');
    foot = revealed
      ? '<p class="pad-turn-note">Both revealed. Continue when ready.</p>'
      : committed
        ? `<p class="pad-turn-note">Committed. ${both ? 'Revealing…' : `Waiting for ${api.esc(api.sideName(other(me)))} to lock in.`}</p>`
        : btn(api, 'g-lock', unset ? `Lock in (${unset} left)` : 'Lock in', unset ? 'disabled' : '', 'pad-chip on');
  }
  return head(api, 'Set the Timing Dials', 'Planning Phase · hidden until both lock in', true) + rows.join('') + foot;
}

function actionHtml(api: GuideApi): string {
  const s = api.state();
  const sc = ensureScript(s);
  const opp = sc.opp;
  if (!opp) return head(api, 'Every Mech has acted', 'Action Phase', true) + '<p class="pad-turn-note">Continue when both are ready.</p>';
  const t = s.tokens.find((x) => x.uid === opp.uid);
  if (!t) return '';
  const owner = mine(api, t.side);
  const extras = extrasLeft(opp).length;
  const ticks = `${opp.maneuver ? 'M ' : ''}${'●'.repeat(opp.action)}${extras ? ` +${extras}` : ''}`.trim() || 'no Ticks left';
  const tm = opp.timing ? TIMINGS.find((x) => x.id === opp.timing)?.name ?? opp.timing : '';
  return head(api, t.label, `${tm ? `${tm} · ` : ''}${ticks}`, owner)
    + (owner
      ? `<div class="pad-chips">${!opp.maneuvered && opp.maneuver > 0 ? btn(api, 'g-moved', 'Moved (M)') : ''}${btn(api, 'g-end', 'End Opportunity', '', 'pad-chip on')}</div>
         ${extrasHtml(api, t, opp)}
         <p class="pad-turn-note">Actions are performed from the list below.</p>`
      : waiting(api, t.side, 'taking its Action Opportunity'));
}

// Link traded for Ticks at the start of the Opportunity: Overload (FAQ K10),
// a pilot trait that does the same (FAQ L2), and a Part's extra Tick that
// locks the Stance (4.1). Each chip carries the engine's reason when it is
// not allowed.
function extrasHtml(api: GuideApi, t: Token, opp: NonNullable<GameState['script']>['opp'] & object): string {
  if (t.kind !== 'mech') return '';
  const chips: string[] = [];
  const overloadIds = new Set(api.data.overload.map((g) => g.actionId));
  if (tokenCards(api.data, t).some(({ card }) => (card.actions ?? []).some((a) => overloadIds.has(a.id)))) {
    const v = canOverload(opp, t.link ?? 0);
    chips.push(btn(api, 'g-overload', `Overload ${opp.overload}/${OVERLOAD_MAX}`, `${v.ok ? '' : ' disabled'} title="${api.esc(v.ok ? 'Consume 1 Link for 1 Action Tick.' : v.why ?? '')}"`));
  }
  const trait = linkTickTraitOn(api.data, t);
  if (trait) {
    const v = api.check({ kind: 'linkTick', seat: t.side, uid: t.uid });
    chips.push(btn(api, 'g-linktick', `${trait.label.replace(/^Hammerhead /, '')} ${opp.linkTicks ?? 0}/${trait.maxLink}`, `${v.ok ? '' : ' disabled'} title="${api.esc(v.ok ? 'Consume 1 Link for 1 Action Tick (FAQ L2).' : v.why ?? '')}"`));
  }
  const bonus = opportunityBonusOn(api.data, t);
  if (bonus) {
    const v = canAttackMode(opp, t.stance, bonus.stance);
    chips.push(btn(api, 'g-attackmode', opp.attackMode ? `${bonus.label} taken` : `${bonus.label} +${bonus.actionPoints}`, `${v.ok ? '' : ' disabled'} title="${api.esc(v.ok ? 'Extra Action Ticks for this Opportunity; the Stance is then set (4.1).' : v.why ?? '')}"`));
  }
  return chips.length ? `<div class="pad-chips">${chips.join('')}</div>` : '';
}

// ZPA-36 Aster: in the Command Phase, 1 Command Token restores 1 Link to an
// Ally Mech. One chip per Aster on the designating side.
function asterHtml(api: GuideApi, side: Side): string {
  const s = api.state();
  const rows = s.tokens
    .filter((t) => t.side === side && t.kind === 'mech' && (t.partStates.torso ?? 'intact') !== 'destroyed' && pilotCard(api.data, t)?.id === 'ZPA-36')
    .map((t) => {
      const why = asterBlockers(s, t) ?? '';
      return btn(api, 'g-aster', `${t.label}: Aster, restore 1 Link`, `data-uid="${t.uid}"${why ? ' disabled' : ''} title="${api.esc(why || '1 Command Token restores 1 Link to an Ally Mech.')}"`);
    });
  return rows.length ? `<div class="pad-chips">${rows.join('')}</div>` : '';
}

// Performing an Action that is not an attack: what the Match Centre's
// routeAction does around performAction, with the picks as dialogs. Repair and
// Mend name the Part, a Charge Action the Part to charge, a form switch the
// face; a self-granted Token, a Transform and an Unfold follow the Action;
// then Command Coordination and an Extra Action Opportunity are offered.
async function performRouted(api: GuideApi, t: Token, a: CardAction): Promise<void> {
  const d = api.data;
  const grant = selfStatusGrant(a);
  if (grant) {
    const why = selfGrantWhy(t, grant);
    if (why) { api.toast(why); return; }
  }
  let form: string | null = null;
  const forms = formSwitch(a);
  if (forms) {
    const opts = forms.filter((id) => id !== t.cardId && d.byId.get(id));
    if (!opts.length) { api.toast('No other form of this unit is in the card data.'); return; }
    form = opts.length === 1 ? opts[0] : await choiceDialog({ title: a.name.en, choices: opts.map((id) => ({ id, label: cardName(d.byId.get(id)!) })), stacked: true });
    if (form === null) return;
  }
  let repair: { mode: 'repaired' | 'mend'; slot: string } | null = null;
  const rep = repairSpec(a);
  if (rep) {
    const rows: { id: string; label: string }[] = [];
    for (const { slot, card } of tokenCards(d, t)) {
      if (slot === 'pilot') continue;
      const st = t.partStates[slot as PartSlot | 'main'] ?? 'intact';
      if (rep.repair && st === 'destroyed' && !(t.repairedSlots ?? []).includes(slot)) rows.push({ id: `repaired:${slot}`, label: `Repair ${SLOT_LABEL[slot] ?? slot} · ${cardName(card)}` });
      if (rep.mend && st === 'damaged') rows.push({ id: `mend:${slot}`, label: `Mend ${SLOT_LABEL[slot] ?? slot} · ${cardName(card)}` });
    }
    if (!rows.length) { api.toast(`${t.label} has nothing this can repair.`); return; }
    const pick = await choiceDialog({ title: a.name.en, choices: rows, stacked: true });
    if (pick === null) return;
    const [mode, slot] = pick.split(':');
    repair = { mode: mode as 'repaired' | 'mend', slot };
  }
  let resupply: { to: Token; actionId: string; amount: number } | null = null;
  const rule = resupplyOf(a);
  if (rule) {
    // This Mech, or an Ally the card reaches (the table judges the range),
    // that has spent the Ammo this Action restores.
    const s = api.state();
    const holders = s.tokens.filter((o) => {
      if (o.deployed === false) return false;
      if (o.uid !== t.uid && (!rule.allies || o.side !== t.side)) return false;
      const max = tokenCards(d, o).flatMap(({ card }) => card.actions ?? []).find((x) => x.id === rule.actionId)?.storage;
      if (!max) return false;
      return (o.ammo?.[rule.actionId] ?? max) < max;
    });
    if (!holders.length) { api.toast('Nothing in reach has spent any of that Ammo.'); return; }
    const pick = holders.length === 1 ? String(holders[0].uid) : await choiceDialog({ title: a.name.en, body: rule.range ? `This Mech, or an Ally within Range ${rule.range}.` : 'Only this Mech is in reach.', choices: holders.map((o) => ({ id: String(o.uid), label: `${o.label}${o.uid === t.uid ? ' (this Mech)' : ''}` })), stacked: true });
    if (pick === null) return;
    const to = holders.find((o) => String(o.uid) === pick)!;
    resupply = { to, actionId: rule.actionId, amount: rule.amount };
  }
  let chargeSlot: string | null = null;
  if (isChargeAction(a)) {
    const slots = chargeableSlots(d, t).filter((x) => !x.charged);
    if (!slots.length) { api.toast(`${t.label} has no Chargeable Part whose token is still face-down (4.14).`); return; }
    chargeSlot = slots.length === 1 ? String(slots[0].slot) : await choiceDialog({ title: a.name.en, choices: slots.map((x) => ({ id: String(x.slot), label: x.label })), stacked: true });
    if (chargeSlot === null) return;
  }
  if (!api.send({ kind: 'performAction', seat: t.side, uid: t.uid, actionId: a.id })) return;
  api.toast(`${t.label}: ${a.name.en}.`);
  const seat = t.side;
  const uid = t.uid;
  if (grant) api.send({ kind: 'applyStatus', seat, uid, targetUid: uid, statusId: grant.statusId, stacks: grant.stacks });
  if (repair) api.send({ kind: 'repairPart', seat, uid, slot: repair.slot, mode: repair.mode });
  if (form) api.send({ kind: 'switchForm', seat, uid, actionId: a.id, cardId: form });
  const mode = transformOffer(d, t, a);
  if (mode) api.send({ kind: 'transformPart', seat, uid, slot: mode.slot, cardId: mode.into.id });
  if (unfoldsOwed(d, [t]).some((x) => x.actionId === a.id)) api.send({ kind: 'unfold', seat, uid });
  if (chargeSlot) api.send({ kind: 'setCharge', seat, uid, slot: chargeSlot as PartSlot, on: true });
  if (resupply) api.send({ kind: 'restoreAmmo', seat: resupply.to.side, uid: resupply.to.uid, actionId: resupply.actionId, amount: resupply.amount });
  // Command Coordination off the back of the Action (the table judges the
  // Drone's range), then an Extra Action Opportunity the Action grants.
  const upTo = t.kind === 'mech' ? coordinationFor(d, t, a) : 0;
  if (upTo > 0) {
    await offerCoordination(d, api.state(), t, upTo, (mechUid, targetUid) => {
      api.send({ kind: 'coordinateCommand', seat, uid: mechUid, targetUid });
    }, (_drone, text) => api.toast(text));
  }
  const extra = extraActivationOf(a);
  if (extra) {
    const s = api.state();
    const allies = s.tokens.filter((x) => x.kind === 'mech' && x.side === seat && x.deployed !== false
      && (x.partStates.torso ?? 'intact') !== 'destroyed' && (!extra.excludeSelf || x.uid !== uid) && (x.link ?? 0) >= extra.minimumLink);
    if (allies.length) {
      const pick = await choiceDialog({
        title: 'Extra Action Opportunity',
        body: `That Mech pays ${extra.linkCost} Link and takes an Extra Action Opportunity now.`,
        choices: [...allies.map((x) => ({ id: String(x.uid), label: x.label })), { id: '__none', label: 'Nobody', cancel: true }],
        stacked: true,
      });
      if (pick && pick !== '__none') api.send({ kind: 'grantExtra', seat, uid: Number(pick), linkCost: extra.linkCost });
    }
  }
}

function endHtml(api: GuideApi): string {
  const s = api.state();
  const sc = ensureScript(s);
  const steps: { id: string; label: string }[] = [
    { id: 'remove', label: 'Remove units (3.7.1)' },
    { id: 'tokens', label: 'Token Management (3.7.2)' },
    { id: 'tasks', label: 'Check Tasks (3.7.3)' },
  ];
  const done = (id: string) => sc.endDone.includes(`${s.round.n}:end:${id}`);
  const rows = steps.map((st) => `<div class="pad-turn-row"><span class="pad-turn-name">${api.esc(st.label)}</span>
      ${done(st.id) ? '<span class="pad-turn-val">✓</span>' : (api.solo || api.me() === s.round.firstPlayer ? btn(api, 'g-endstep', 'Done', `data-step="${st.id}"`) : '<span class="pad-turn-val">…</span>')}</div>`).join('');
  const all = steps.every((st) => done(st.id));
  const last = s.round.n >= (s.roundLimit ?? 5);
  return head(api, 'End Phase', `Round ${s.round.n}`, true) + rows
    + (all ? (last ? btn(api, 'g-endmatch', 'End the game', '', 'pad-chip on') : `<p class="pad-turn-note">Continue to start Round ${s.round.n + 1}.</p>`) : '');
}

// ---------- the action rows: what the sheet's list may perform ----------

// The button a row in the unit's action list carries while that unit's
// Opportunity is open on this phone: the price and the engine's verdict.
export function performButton(api: GuideApi, t: Token, a: CardAction, partKey: string): string {
  const s = api.state();
  const act = activeOpp(api);
  if (!act || !act.mine || act.uid !== t.uid) return '';
  const opp = s.script?.opp;
  if (!opp) return '';
  if (a.type === 'Passive' || a.speed === 'passive') return '';
  const g = guidedActions(api.data, t).find((x) => x.action.id === a.id);
  if (g && !g.available) return '';
  const len = lengthOf(a);
  const v: TickVerdict = t.kind !== 'mech' ? canActivate(opp) : len ? canPerform(opp, a, partKey) : { ok: true };
  const cost = costOf(a);
  const price = cost ? `${cost.maneuver ? 'M' : ''}${'●'.repeat(cost.action)}` : '';
  return v.ok
    ? `<button class="pad-chip on pad-perform" data-act="g-perform" data-uid="${t.uid}" data-id="${api.esc(a.id)}">Perform${price ? ` ${price}` : ''}</button>`
    : `<span class="pad-perform-no">${api.esc(v.why ?? 'Not now')}</span>`;
}

// ---------- the buttons ----------

// Answers the guide's own acts; false when the act is not one of ours.
export function guideAct(api: GuideApi, a: string, el: HTMLElement): boolean {
  const s = api.state();
  const me = api.me();
  switch (a) {
    case 'g-roll': {
      const side = (el.dataset.side as Side) ?? me;
      void (async () => {
        const hits = await api.rollHits(2, 'First Player');
        api.send({ kind: 'rollSetup', seat: side, hits });
      })();
      return true;
    }
    case 'g-accept': api.send({ kind: 'acceptRoll', seat: me }); return true;
    case 'g-tasks-done': api.send({ kind: 'finishTasks', seat: me }); return true;
    case 'g-edge': api.send({ kind: 'pickEdge', seat: s.round.firstPlayer, edge: el.dataset.edge as 'black' | 'white' }); return true;
    case 'g-deploy': {
      const t = s.tokens.find((x) => x.uid === Number(el.dataset.uid));
      if (!t) return true;
      // The piece stands on the physical table; the sheet only needs to know
      // it is out. The cell is the placeholder every boardless unit carries.
      api.send({ kind: 'deployUnit', seat: t.side, uid: t.uid, to: { col: 0, row: 0 }, stance: t.kind === 'mech' ? t.stance : undefined, facing: 0 });
      return true;
    }
    case 'g-deployed': {
      if (api.solo) {
        api.send({ kind: 'setReady', seat: 's1', ready: true });
        api.send({ kind: 'setReady', seat: 's2', ready: true });
        api.send({ kind: 'finishDeployment', seat: 's1' });
      } else {
        api.send({ kind: 'setReady', seat: me, ready: true });
        finishIfBothReady(api);
      }
      return true;
    }
    case 'g-designate': {
      const side = (el.dataset.side as Side) ?? me;
      const uid = Number(el.dataset.uid);
      const t = s.tokens.find((x) => x.uid === uid);
      if (!t) return true;
      const phase = PHASES[s.round.phase];
      if (phase === 'Command' && t.kind === 'drone') {
        // Which Mech issues the Command (4.15.2). One issuer needs no question.
        const issuers = s.tokens.filter((x) => x.side === side && x.kind === 'mech' && readyCommands(x) > 0);
        if (issuers.length > 1) {
          void (async () => {
            const pick = await choiceDialog({ title: `Which Mech commands ${t.label}?`, choices: issuers.map((m) => ({ id: String(m.uid), label: m.label })), stacked: true });
            if (pick === null) return;
            if (api.send({ kind: 'designate', seat: side, uid, fromUid: Number(pick) })) api.selectUnit(uid);
          })();
          return true;
        }
        if (api.send({ kind: 'designate', seat: side, uid, fromUid: issuers[0]?.uid })) api.selectUnit(uid);
        return true;
      }
      if (api.send({ kind: 'designate', seat: side, uid })) api.selectUnit(uid);
      return true;
    }
    case 'g-pass': api.send({ kind: 'passTurn', seat: (el.dataset.side as Side) ?? me }); return true;
    case 'g-moved': {
      const act = activeOpp(api);
      if (!act) return true;
      const t = s.tokens.find((x) => x.uid === act.uid)!;
      api.send({ kind: 'maneuver', seat: t.side, uid: t.uid, to: { col: 0, row: 0 } });
      return true;
    }
    case 'g-end': {
      const act = activeOpp(api);
      if (!act) return true;
      const t = s.tokens.find((x) => x.uid === act.uid)!;
      // A Part that coordinates a Command as the Opportunity ends offers it
      // first; the Opportunity ends once that is answered.
      const owed = t.kind === 'mech' ? coordinationOnOpportunityEnd(api.data, t) : 0;
      if (owed > 0 && readyCommands(t) > 0) {
        void offerCoordination(api.data, s, t, owed, (mechUid, targetUid) => {
          api.send({ kind: 'coordinateCommand', seat: t.side, uid: mechUid, targetUid });
        }, (_d, text) => api.toast(text)).then(() => { api.send({ kind: 'endOpportunity', seat: t.side, uid: t.uid }); });
        return true;
      }
      api.send({ kind: 'endOpportunity', seat: t.side, uid: t.uid });
      return true;
    }
    case 'g-perform': {
      const t = s.tokens.find((x) => x.uid === Number(el.dataset.uid));
      if (!t) return true;
      const a = guidedActions(api.data, t).find((g) => g.action.id === el.dataset.id);
      // A Firing or Melee Action opens the attack window through the target
      // pick; the pad pays for it once the table has judged the shot.
      if (a && (a.action.type === 'Firing' || a.action.type === 'Melee') && api.attack) {
        api.attack(t.uid, a.action.id);
        return true;
      }
      // An Electronic Attack opens the counter-roll the same way.
      if (a && isElectronicAttack(a.action) && api.attack) {
        api.attack(t.uid, a.action.id, { electronic: true });
        return true;
      }
      // A Projectile's Delayed Action: paid, then the detonation resolver.
      if (a && t.kind === 'projectile' && a.action.type !== 'Passive') {
        if (api.send({ kind: 'performAction', seat: t.side, uid: t.uid, actionId: a.action.id })) api.detonate(t.uid, a.action.id);
        return true;
      }
      // An Action that fires projectiles launches them; a card that names
      // more than one asks which.
      if (a && a.projectiles.length && api.launch) {
        const launch = api.launch;
        if (a.projectiles.length === 1) { launch(t.uid, a.action.id, a.projectiles[0].id); return true; }
        void choiceDialog({
          title: a.action.name.en,
          choices: a.projectiles.map((p) => ({ id: p.id, label: cardName(p) })),
          stacked: true,
        }).then((pick) => { if (pick !== null) launch(t.uid, a.action.id, pick); });
        return true;
      }
      if (a) void performRouted(api, t, a.action);
      return true;
    }
    case 'g-overload': {
      const act = activeOpp(api);
      const t = act ? s.tokens.find((x) => x.uid === act.uid) : undefined;
      if (t) api.send({ kind: 'overload', seat: t.side, uid: t.uid });
      return true;
    }
    case 'g-linktick': {
      const act = activeOpp(api);
      const t = act ? s.tokens.find((x) => x.uid === act.uid) : undefined;
      if (t) api.send({ kind: 'linkTick', seat: t.side, uid: t.uid });
      return true;
    }
    case 'g-attackmode': {
      const act = activeOpp(api);
      const t = act ? s.tokens.find((x) => x.uid === act.uid) : undefined;
      if (t) api.send({ kind: 'attackMode', seat: t.side, uid: t.uid });
      return true;
    }
    case 'g-aster': {
      const t = s.tokens.find((x) => x.uid === Number(el.dataset.uid));
      if (!t) return true;
      void runAster(api.data, s, t.uid, (targetUid) => { api.send({ kind: 'asterRestore', seat: t.side, uid: t.uid, targetUid }); }, (_to, text) => api.toast(text));
      return true;
    }
    case 'g-tactic': api.tactics(el.dataset.side as Side).play(el.dataset.id!); return true;
    case 'g-react-go': answerReaction(api, Number(el.dataset.uid), el.dataset.id!, true); return true;
    case 'g-react-skip': answerReaction(api, Number(el.dataset.uid), el.dataset.id!, false); return true;
    case 'g-riposte': {
      const uid = Number(el.dataset.uid);
      const t = s.tokens.find((x) => x.uid === uid);
      const r = (ensureScript(s).reactions ?? []).find((x) => x.uid === uid && x.kind === 'riposte');
      if (!t || !r) return true;
      // The Opportunity ends first, if it is still the open one.
      if (ensureScript(s).opp?.uid === r.fromUid && !api.send({ kind: 'riposte', seat: t.side, uid, fromUid: r.fromUid! })) return true;
      if (el.dataset.only) { api.send({ kind: 'resolveReaction', seat: t.side, uid, actionId: r.actionId }); return true; }
      const melees = guidedActions(api.data, t).filter((g) => g.action.type === 'Melee').map((g) => g.action);
      if (!melees.length) { api.send({ kind: 'resolveReaction', seat: t.side, uid, actionId: r.actionId }); return true; }
      void (async () => {
        const pick = melees.length === 1 ? melees[0].id : await choiceDialog({
          title: 'Riposte',
          choices: melees.map((a) => ({ id: a.id, label: a.name.en })),
          stacked: true,
        });
        if (pick === null) return;
        // The granted Melee spends the debt through its own apply.
        api.attack?.(uid, pick, { granted: true });
      })();
      return true;
    }
    case 'g-timing': {
      const t = s.tokens.find((x) => x.uid === Number(el.dataset.uid));
      if (!t) return true;
      const tm = el.dataset.timing as Timing;
      api.send({ kind: 'setTiming', seat: t.side, uid: t.uid, timing: t.timing === tm ? undefined : tm });
      return true;
    }
    case 'g-lock': {
      if (api.solo) api.send({ kind: 'lockDials', seat: 's1' });
      else lockDialsNetworked(api);
      return true;
    }
    case 'g-endstep': api.send({ kind: 'markEndStep', seat: me, step: el.dataset.step! }); return true;
    case 'g-endmatch': api.endGame(); return true;
    case 'g-designate-task': {
      const owed = taskDesignations(api.data, s)[Number(el.dataset.i)];
      if (!owed) return true;
      void (async () => {
        if (owed.what === 'zone') {
          const zones = missionZones(api.data, s);
          const pick = await choiceDialog({ title: owed.label, choices: zones.map((z) => ({ id: z.id, label: z.name })), stacked: true });
          if (pick !== null) api.send({ kind: 'designateTask', seat: owed.by, what: 'zone', for: owed.side, zone: pick });
          return;
        }
        const pool = s.tokens.filter((x) => x.kind === 'mech' && (owed.owner ? x.side === owed.owner : true));
        const pick = await choiceDialog({ title: owed.label, choices: pool.map((m) => ({ id: String(m.uid), label: `${m.label} · ${api.sideName(m.side)}` })), stacked: true });
        if (pick !== null) api.send({ kind: 'designateTask', seat: owed.by, what: owed.what, for: owed.side, uid: Number(pick) });
      })();
      return true;
    }
    case 'g-secondary': return false; // the pad's own Tasks panel picks it
  }
  return false;
}

// Seat 1 finishes deployment once both are ready, from one phone only - the
// same rule the Continue agreement uses.
export function finishIfBothReady(api: GuideApi): void {
  const s = api.state();
  if (!normaliseSetup(s.setup) || normaliseSetup(s.setup)!.stage !== 'deploy') return;
  if (!deploymentComplete(s)) return;
  if (!(s.ready?.s1 && s.ready?.s2)) return;
  if (api.me() !== 's1') return;
  api.send({ kind: 'finishDeployment', seat: 's1' });
}

// Starting a guided game: solo starts at once; in a room both press, seat 1
// sends, exactly as the Continue agreement does.
export function startGuided(api: GuideApi): void {
  const me = api.me();
  if (api.solo) {
    api.send({ kind: 'setReady', seat: 's1', ready: true });
    api.send({ kind: 'setReady', seat: 's2', ready: true });
    if (api.send({ kind: 'startMatch', seat: 's1' })) api.send({ kind: 'lockMap', seat: 's1' });
    return;
  }
  api.send({ kind: 'setReady', seat: me, ready: true });
  startIfBothReady(api);
}

export function startIfBothReady(api: GuideApi): void {
  const s = api.state();
  if (guidedOn(s)) return;
  if (!(s.ready?.s1 && s.ready?.s2)) return;
  if (api.me() !== 's1') return;
  if (api.send({ kind: 'startMatch', seat: 's1' })) api.send({ kind: 'lockMap', seat: 's1' });
}

// The two-phase turn that Continue answers in a guided game: the pad's bar
// already runs setReady + advancePhase; this only says whether a Continue is
// wanted now (so the bar can grey it during setup and open Opportunities).
export function continueAllowed(api: GuideApi): boolean {
  const s = api.state();
  const su = normaliseSetup(s.setup);
  if (!su) return true;
  if (su.stage !== 'done') return false;
  const phase = PHASES[s.round.phase];
  if (isLoopPhase(phase)) return loopComplete(s, phase, api.data);
  if (s.round.phase === 2) return !s.script?.opp;
  if (s.round.phase === 1) {
    const sc = ensureScript(s);
    return api.solo ? sc.stage === `${s.round.n}:1:locked` : sc.revealed.includes('s1') && sc.revealed.includes('s2');
  }
  if (s.round.phase === 5) {
    const sc = ensureScript(s);
    return ['remove', 'tokens', 'tasks'].every((id) => sc.endDone.includes(`${s.round.n}:end:${id}`));
  }
  return true;
}

export { cardName };
