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
import { readyCommands, rebootOwed, taskDesignations, missionZones, type CheckResult, type Command } from '../src/commands';
import { asterBlockers, offerCoordination, runAster } from '../src/commandpick';
import { canAct, dialHidden, eligibleUnits, isLoopPhase, loopComplete, nextTurn, tiedChoices, type LoopPhase } from '../src/loop';
import { deployTurn, deployable, deploymentComplete, firstPlayerFrom, normaliseSetup, rollTotal } from '../src/setup';
import { ensureScript } from '../src/glue';
import { canActivate, canAttackMode, canOverload, canPerform, costOf, extrasLeft, lengthOf, OVERLOAD_MAX, type TickVerdict } from '../src/ticks';
import { canActivateCamo, activatesCamo, controlledMoveActions, immobilizedStop, manifestationRange, targetStatusTargets, actionRange, overloadPackOn, stanceFeedbackOf, stanceFeedbackTargets, stanceShaped, knockbackOf, linkSupportOf, maxLink, tokenCleanupOf, type LinkSupport, type TokenCleanup, targetStatusGrant, twoHandedUse, chargeableSlots, coordinationFor, coordinationOnOpportunityEnd, electronicValue, extraActivationOf, formSwitch, guidedActions, initiativeFor, isChargeAction, isElectronicAttack, isScanAction, linkTickTraitOn, loanedParts, opportunityBonusOn, pilotCard, repairSpec, resupplyOf, selfGrantWhy, selfStatusGrant, SLOT_LABEL, tokenCards, transformOffer, unfoldsOwed } from '../src/units';
import { normaliseTasks } from '../src/tasks';
import { dialsOf, hashDials, newSalt, type DialEntry } from '../src/secrecy';
import { PHASES, removableTokens, TIMINGS, type CardAction, type GameState, type PartSlot, type Side, type Stance, type Timing, type Token, type TokenPick } from '../src/types';
import { choiceDialog, pickManyDialog } from '../src/dialog';

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
  // A side as the SUBJECT of a sentence ("X places next"). sideName's solo
  // labels are Yours/Theirs, which are right on a tag and wrong before a verb.
  actorName(s: Side): string;
  esc(s: string): string;
  // The Continue agreement the pad already runs on the bar.
  pressContinue(): void;
  readiness(): { me: boolean; them: boolean };
  // Opens the attack window for a Firing or Melee Action (attack.ts); the
  // pad pays the Action once the table has judged the shot.
  // `resumed`: the attack a won free Scan owes (FAQ I12), already paid.
  attack?(uid: number, actionId: string, opts?: { electronic?: boolean; granted?: boolean; only?: number; resumed?: boolean }): void;
  // Target Tracing's Counter-roll back at the attacker (174): the record in a
  // room, the local exchange solo, with its Command Token and its 1 Link.
  trace?(uid: number, actionId: string, attackerUid: number): void;
  // The engine's verdict without performing, for a chip that shows why not.
  check(cmd: Command): CheckResult;
  // The Tactics Cards this side could play in the phase that is on, and the
  // play itself (pad.ts asks the card's questions).
  tactics(side: Side): { playable: { id: string; name: string }[]; play(id: string): void };
  // Guided's End the game: pad.ts offers the record before the engine's endMatch.
  endGame(): void;
  // A Projectile's Delayed Action (pad.ts): the table names the units in the
  // blast; damage through the window as Explosion damage.
  // `joined`: the tap already sent a command (the paid Action), so the next
  // one chains to it for Undo (commands.ts CommandChain).
  detonate(uid: number, actionId: string, joined?: boolean): void;
  // Stabilize System's Token question and Link. `pay` is the Guided Common
  // Action's performAction, sent only once the player has answered, so a
  // Cancel costs nothing; what follows chains to it for Undo.
  stabilise?(uid: number, pay?: () => boolean): void;
  // Which Handheld Part goes to its Discard Card; null when the player backs out.
  pickDiscard?(uid: number): Promise<string | null>;
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
        if (actual !== promised) api.toast(`${api.actorName(cmd.seat)}'s revealed dials do not match their commitment.`);
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
  // A reaction owed to one of this phone's units comes before the phase, and
  // so does a Reveal one of them owes.
  const owed = reactionsOwed(api);
  const react = (owed.length ? reactionHtml(api, owed[0]) : '') + revealHtml(api) + tacticsStrip(api);
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

// ---------- a Reveal owed (4.12.2) ----------
//
// The engine records each Reveal as the command that causes it applies: a
// non-Silent Action, a non-Silent Maneuver, or a Movement ending in Contact
// (script.revealDue). The pad never Revealed anyone on those (audit Phase 3,
// C3), and leaves Contact to the table (F7): what it records it shows here.
function revealHtml(api: GuideApi): string {
  const s = api.state();
  const due = (ensureScript(s).revealDue ?? [])
    .map((d) => ({ d, t: s.tokens.find((x) => x.uid === d.uid) }))
    .find((x) => !!x.t && (x.t.statuses ?? []).includes('camouflage') && mine(api, x.t.side));
  if (!due?.t) return '';
  const t = due.t;
  const by = due.d.byUid !== undefined ? s.tokens.find((x) => x.uid === due.d.byUid) : undefined;
  const why = due.d.why === 'touch' ? `ended a Movement in Contact with ${by?.label ?? 'an enemy'}`
    : due.d.why === 'move' ? 'moved without Silence'
      : by ? `performed an Action whose Silence ${by.label} takes away` : 'performed a non-Silence Action';
  const range = manifestationRange(api.data, t);
  const stuck = !!immobilizedStop(t);
  return `<div class="pad-turn-react"><p class="pad-turn-name">${api.esc(t.label)} breaks camouflage</p>
    <p class="pad-turn-note">It ${api.esc(why)}, so the Optical Camouflage ends (4.12.2).${
      stuck ? ' It bears an Immobilized Token, so it Reveals where it stands (FAQ I20).'
        : range > 0 ? ` Make its Manifestation Movement on the table, within Range ${range} counted orthogonally, and face it as you choose.` : ''}</p>
    <div class="pad-chips">${btn(api, 'g-reveal', 'Revealed', `data-uid="${t.uid}"`, 'pad-chip on')}</div></div>`;
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
  const name = r.kind === 'control' ? 'The Red Shoes' : what?.name?.en
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
    const range = manifestationRange(api.data, t);
    body = `${api.esc(t.label)} is Revealed (4.12.4)${range > 0 ? `: make its Manifestation Movement on the table, within Range ${range} counted orthogonally, and face it as you choose` : ': it appears where its marker stood'}${immobilizedStop(t) ? '. It bears an Immobilized Token, so it Reveals in place (FAQ I20)' : ''}.`;
    buttons = btn(api, 'g-react-go', 'Revealed', key, 'pad-chip on');
    return `<div class="pad-turn-react"><p class="pad-turn-name">${api.esc(name)}</p><p class="pad-turn-note">${body}</p><div class="pad-chips">${buttons}</div></div>`;
  } else if (r.kind === 'control') {
    // The Red Shoes (TM35NA_B): one of the Responder's own Maneuvers or Move
    // Actions, made on the table by this player at no Tick cost (F19).
    const stop = from ? immobilizedStop(from) : null;
    body = !from ? 'The unit has left the table.'
      : stop ? api.esc(stop)
        : `Take control of ${api.esc(from.label)}: make one of its own Maneuvers or Move Actions on the table. It costs its player no Tick.`;
    buttons = from && !stop ? btn(api, 'g-react-go', 'Move it', key, 'pad-chip on') : '';
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
  // The Red Shoes: its controlledMove spends the debt, so a Move made is one
  // command; declining clears it the ordinary way.
  if (r.kind === 'control' && take && r.fromUid !== undefined) {
    void steerControlled(api, t, r.fromUid);
    return;
  }
  if (!api.send({ kind: 'resolveReaction', seat: t.side, uid, actionId })) return;
  // Scanned: the unit leaves the Optical Camouflage State; where it appears
  // is settled on the table. The answer used to clear the debt and nothing
  // else, so the unit stayed camouflaged on every phone (audit Phase 3, A2).
  if (r.kind === 'manifest') { api.send({ kind: 'reveal', seat: t.side, uid, chain: 'join' }); return; }
  if (!take) return;
  // Against the Revealed unit only, and not paid again: the Tick went at the
  // designation (FAQ I12). It opened a fresh, paid attack on anyone.
  if (r.kind === 'scanAttack') { if (r.fromUid !== undefined) api.attack?.(uid, actionId, { only: r.fromUid, resumed: true }); return; }
  // The reaction's own spends ride its resolveReaction: one tap, one Undo.
  if (r.kind === 'stance') { api.send({ kind: 'defenseReaction', seat: t.side, uid, chain: 'join' }); return; }
  if (r.kind === 'trace' && r.fromUid !== undefined) {
    // The counter-roll back at the attacker: the record in a room, the local
    // exchange solo. Range does not apply to a Target Tracing. It used to spend
    // the Command Token first and then send the Passive through the attack door,
    // which refused it: a Token gone and no roll (audit Phase 3, D8).
    api.trace?.(uid, actionId, r.fromUid);
  }
  // Smoke: placed on the table; the debt is spent.
}

// The Red Shoes on the table: which of the Responder's own Maneuver or Move
// Actions the controller made. The table moves the model; the pad records it,
// so the Responder's Silence, Non-humanoid Link and Low Profile are judged by
// the engine as the controlledMove applies (audit Phase 3, D3).
async function steerControlled(api: GuideApi, t: Token, targetUid: number): Promise<void> {
  const target = api.state().tokens.find((x) => x.uid === targetUid);
  if (!target) return;
  const moves = controlledMoveActions(api.data, target);
  const pick = moves.length ? await choiceDialog({
    title: `The Red Shoes: ${target.label}`,
    body: `Which of ${target.label}'s own Movements did you make on the table?`,
    choices: [
      { id: '__maneuver', label: 'Its Maneuver' },
      ...moves.map((a) => ({ id: a.id, label: a.name.en || a.name.zh || a.id })),
      { id: '', label: 'Cancel', cancel: true },
    ],
    stacked: true,
  }) : '__maneuver';
  if (!pick) return;
  api.send({
    kind: 'controlledMove', seat: t.side, uid: t.uid, targetUid,
    to: { col: target.col, row: target.row }, ...(pick !== '__maneuver' ? { actionId: pick } : {}),
  });
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
    // Table rolls: the dice are on the table, so the pad is only told who won.
    // Entering two dice's faces per player to arrive at the same answer was
    // busywork (OTTO, 2026-09-21). Either phone may say it.
    if (s.tableDice) {
      return head(api, 'First Player', '3.1.2', true)
        + `<div class="pad-chips">${(['s1', 's2'] as Side[]).map((side) =>
          btn(api, 'g-first', api.sideName(side), `data-side="${side}"`, 'pad-chip on')).join('')}</div>`;
    }
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
      + (winner ? `<p class="pad-turn-note">${api.esc(api.actorName(winner))} goes first.</p>${btn(api, 'g-accept', 'Continue', '', 'pad-chip on')}` : '');
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
        ${mine(api, d.by) ? btn(api, 'g-designate-task', 'Choose', `data-i="${i}"`) : `<span class="pad-turn-val">${api.esc(api.actorName(d.by))} chooses</span>`}</div>`).join('');
    // FAQ P1: the Main Task is determined (step 3) BEFORE the Secondaries
    // (steps 4-5). It also has to be settled here, because the engine freezes
    // it once the table edges are picked - a draw left half-done past this
    // point could never finish.
    const main = s.mission ? api.data.missions.cards.find((c) => c.id === s.mission) : undefined;
    const drawing = (tasks.draw ?? []).length > 0;
    const mainRow = `<div class="pad-turn-row"><span class="pad-turn-name">Main Task</span>
        <span class="pad-turn-val">${main ? api.esc(main.name) : drawing ? 'Discarding…' : '—'}</span>
        ${drawing ? btn(api, 'dock', 'Discard', 'data-dock="tasks"', 'pad-chip on')
          : main ? btn(api, 'g-main', 'Change', 'data-how="pick"')
            : `${btn(api, 'g-main', 'Draw 3', 'data-how="draw"', 'pad-chip on')}${btn(api, 'g-main', 'Choose', 'data-how="pick"')}`}</div>`;
    if (!main) return head(api, 'Main Task', 'FAQ P1', true) + mainRow;
    const done = !!tasks.secondary.s1 && !!tasks.secondary.s2 && !owed.length;
    return head(api, 'Secondary Tasks', `${api.actorName(fp)} first (FAQ P1)`, true) + mainRow + rows + desig
      + (done ? btn(api, 'g-tasks-done', 'Continue', '', 'pad-chip on') : '');
  }
  if (stage === 'side') {
    const fp = s.round.firstPlayer;
    return head(api, `${api.actorName(fp)} picks a table edge`, '3.1.2', mine(api, fp))
      + (mine(api, fp)
        ? `<div class="pad-chips">${btn(api, 'g-edge', 'White edge', 'data-edge="white"')}${btn(api, 'g-edge', 'Black edge', 'data-edge="black"')}</div>`
        : waiting(api, fp, 'picking an edge'));
  }
  // deploy
  const turn = deployTurn(s, su);
  const complete = deploymentComplete(s);
  const rows = (['s1', 's2'] as Side[]).flatMap((side) => deployable(s, side).map((t) => `<div class="pad-turn-row">
      <span class="pad-turn-name">${api.esc(t.label)}</span><span class="pad-turn-val">${api.esc(api.sideName(side))}</span>
      ${mine(api, side) && (api.solo || turn === side)
        // Tracking solo both squads' units are listed, so the ones whose turn it
        // is NOT are greyed out rather than left looking pressable.
        ? btn(api, 'g-deploy', 'On the table', `data-uid="${t.uid}"${turn === side ? '' : ' disabled'}`) : ''}</div>`));
  const rd = api.readiness();
  return head(api, 'Deploy', turn ? `${api.actorName(turn)} places next (3.1.4)` : 'Everything is placed', !!turn && mine(api, turn))
    // Joined by hand: an array added to a string joins itself with commas,
    // and each one drew as a line of its own between the units.
    + rows.join('')
    + (complete
      ? (api.solo
        ? btn(api, 'g-deployed', 'Begin Round 1', '', 'pad-chip on')
        : rd.me ? `<p class="pad-turn-note">Waiting for ${api.esc(api.actorName(other(api.me())))}.</p>` : btn(api, 'g-deployed', 'Begin Round 1', '', 'pad-chip on'))
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
      // "Moved" is offered only while the engine would take it: a Drone moves
      // INSTEAD of acting, never after, and not at all in the Automatic Phase.
      const mayMove = t.kind !== 'mech'
        && api.check({ kind: 'maneuver', seat: t.side, uid: t.uid, to: { col: 0, row: 0 } }).ok;
      const what = phase === 'Command'
        ? t.kind === 'mech' ? 'Fire the commanded Part (RWS), then end.' : mayMove ? 'One Command Action, or moved.' : 'One Command Action, then end.'
        : phase === 'Automatic' ? 'One Automatic Action, then end.' : 'Its Delay Action, then end.';
      return head(api, t.label, what, owner)
        + (owner
          ? `<div class="pad-chips">${mayMove ? btn(api, 'g-moved', 'Moved') : ''}${btn(api, 'g-end', 'End activation', '', 'pad-chip on')}</div>`
          : waiting(api, t.side, 'acting'));
    }
  }
  const turn = turnOf(s, phase, api.data);
  if (loopComplete(s, phase, api.data) || turn === null) {
    return head(api, `${phase} Phase over`, '', true) + `<p class="pad-turn-note">Continue when both are ready.</p>`;
  }
  const noun = phase === 'Command' ? 'a Drone' : phase === 'Automatic' ? 'a Drone' : 'a Projectile';
  if (!mine(api, turn)) return head(api, `${api.actorName(turn)} designates`, `${phase} Phase`, false) + waiting(api, turn, `picking ${noun} or passing`);
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
    .filter((t) => t.side === side && t.kind === 'mech' && (t.partStates.torso ?? 'intact') !== 'destroyed')
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
  const unset = sides.reduce((n, side) => n + s.tokens.filter((t) => t.side === side && t.kind === 'mech' && (t.partStates.torso ?? 'intact') !== 'destroyed' && !t.timing).length, 0);
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
        ? `<p class="pad-turn-note">Committed. ${both ? 'Revealing…' : `Waiting for ${api.esc(api.actorName(other(me)))} to lock in.`}</p>`
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
  // A Shutdown Mech whose Opportunity has come Reboots, and that is all it may
  // do (4.1.1, FAQ K17): no Maneuver, nothing to end.
  if (owner && rebootOwed(s, t)) {
    return head(api, t.label, `${tm ? `${tm} · ` : ''}Shutdown`, owner)
      + tieHtml(api)
      + `<p class="pad-turn-note">Shutdown: its Action Opportunity has come, so it Reboots now and restores 1 Link. It then has 1 Action Tick, for an Action of its dial's Timing (4.1.1).</p>
         <div class="pad-chips">${(['defensive', 'mobility', 'offensive'] as const)
           .map((x) => btn(api, 'g-reboot', `Reboot to ${x[0].toUpperCase()}${x.slice(1)}`, `data-uid="${t.uid}" data-stance="${x}"`)).join('')}</div>`;
  }
  return head(api, t.label, `${tm ? `${tm} · ` : ''}${ticks}`, owner)
    + (owner
      ? `${tieHtml(api)}<div class="pad-chips">${!opp.maneuvered && opp.maneuver > 0 && t.stance !== 'shutdown' ? btn(api, 'g-moved', 'Moved (M)') : ''}${btn(api, 'g-end', 'End Opportunity', '', 'pad-chip on')}</div>
         ${extrasHtml(api, t, opp)}
         <p class="pad-turn-note">Actions are performed from the list below.</p>`
      : waiting(api, t.side, 'taking its Action Opportunity'));
}

// Tied on Timing and Initiative with more of this squad's Mechs: the owner
// picks which takes the turn, while the one holding it has done nothing (audit
// Phase 2, E6). The engine's own list, so every chip drawn is taken.
function tieHtml(api: GuideApi): string {
  const tied = tiedChoices(api.state(), (x, tm) => initiativeFor(api.data, x, tm));
  return tied.length
    ? `<p class="pad-turn-note">Tied on Timing and Initiative: this squad picks which of its tied Mechs goes first (3.4.1).</p>
       <div class="pad-chips">${tied.map((x) => btn(api, 'g-tie', `${x.label} goes first`, `data-uid="${x.uid}"`)).join('')}</div>`
    : '';
}

// Link traded for Ticks at the start of the Opportunity: Overload (FAQ K10),
// a pilot trait that does the same (FAQ L2), and a Part's extra Tick that
// locks the Stance (4.1). Each chip carries the engine's reason when it is
// not allowed.
function extrasHtml(api: GuideApi, t: Token, opp: NonNullable<GameState['script']>['opp'] & object): string {
  if (t.kind !== 'mech') return '';
  const chips: string[] = [];
  if (overloadPackOn(api.data, t)) {
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

// ---------- Link and Token support on a table with no board ----------
//
// Strengthen Link (018_B, 504_A), a Link Beacon's Link Support (075_A) and
// System Cleanup (504_B, TM31RS_B): units.ts linkSupportOf / tokenCleanupOf.
// The table judged the range, so the pad asks which units stood in it. Shared
// by the Guided router below and the Freeform chips in pad.ts.

// The Ally Mechs that recover. 'all' is a list to tick, every Mech short of
// Link ticked to start; 'chosen' picks one. null when the player backs out.
// A Beacon's Delayed Action is its turn and resolves even when nobody is in
// range, so it may answer with nobody; a Mech's Action that could change
// nothing cannot be performed (FAQ H2), so it may not.
export async function askLinkSupport(api: GuideApi, t: Token, a: CardAction, rule: LinkSupport): Promise<Token[] | null> {
  const d = api.data;
  const s = api.state();
  const what = a.name.en ?? a.id;
  const reach = actionRange(d, s.tokens, t, a);
  const beacon = t.kind === 'projectile';
  const allies = s.tokens.filter((x) => x.kind === 'mech' && x.side === t.side && x.deployed !== false
    && (x.partStates.torso ?? 'intact') !== 'destroyed' && (x.link ?? 0) < maxLink(d, x));
  if (!allies.length) {
    api.toast(`${what}: every Ally Mech is already at its pilot's Link Value.`);
    return beacon ? [] : null;
  }
  const row = (x: Token): string => `${x.label}${x.uid === t.uid ? ' (this Mech)' : ''}`;
  const link = (x: Token): string => `Link ${x.link ?? 0}/${maxLink(d, x)}${x.stance === 'shutdown' ? ', Shutdown' : ''}`;
  if (rule.selection === 'chosen') {
    const pick = await choiceDialog({
      title: what,
      body: `One Ally Mech within Range ${reach} recovers ${rule.amount} Link, even one in Shutdown, which stays down until it Reboots (FAQ L3).`,
      choices: [
        ...allies.map((x) => ({ id: String(x.uid), label: `${row(x)} · ${link(x)}` })),
        { id: '__cancel', label: 'Cancel', cancel: true },
      ],
      stacked: true,
    });
    const one = allies.find((x) => String(x.uid) === pick);
    return one ? [one] : null;
  }
  const ids = await pickManyDialog({
    title: what,
    body: `Every Ally Mech within Range ${reach} of ${t.label} recovers ${rule.amount} Link, even one in Shutdown (FAQ L3). Untick any that stood out of range.`,
    rows: allies.map((x) => ({ id: String(x.uid), label: row(x), note: link(x), on: true })),
    confirmLabel: 'Restore Link',
    allowNone: beacon,
  });
  if (ids === null) return null;
  return allies.filter((x) => ids.includes(String(x.uid)));
}

// The Ally Unit and the Token (face included) a cleanup takes off. A single
// candidate needs no question. null when the player backs out or there is
// nothing to take (FAQ H2).
export async function askTokenCleanup(api: GuideApi, t: Token, a: CardAction, rule: TokenCleanup): Promise<{ unit: Token; pick: TokenPick } | null> {
  const s = api.state();
  const what = a.name.en ?? a.id;
  const reach = actionRange(api.data, s.tokens, t, a);
  const shape = rule.shape === 'square' ? 'Square' : 'Hexagon';
  const units = s.tokens.filter((x) => x.side === t.side && x.deployed !== false
    && (x.partStates[x.kind === 'mech' ? 'torso' : 'main'] ?? 'intact') !== 'destroyed'
    && removableTokens(x, [rule.shape]).length > 0);
  if (!units.length) { api.toast(`${what}: no Ally Unit wears a ${shape} Token.`); return null; }
  const uid = units.length === 1 ? String(units[0].uid) : await choiceDialog({
    title: what,
    body: `One ${shape} Token comes off one Ally Unit within Range ${reach}.`,
    choices: [
      ...units.map((x) => ({ id: String(x.uid), label: `${x.label}${x.uid === t.uid ? ' (this unit)' : ''} · ${removableTokens(x, [rule.shape]).map((p) => p.label).join(', ')}` })),
      { id: '__cancel', label: 'Cancel', cancel: true },
    ],
    stacked: true,
  });
  const unit = units.find((x) => String(x.uid) === uid);
  if (!unit) return null;
  const picks = removableTokens(unit, [rule.shape]);
  const pid = picks.length === 1 ? picks[0].id : await choiceDialog({
    title: `${what}: which Token comes off ${unit.label}?`,
    choices: [
      ...picks.map((p) => ({ id: p.id, label: `Remove ${p.label}` })),
      { id: '__cancel', label: 'Cancel', cancel: true },
    ],
    stacked: true,
  });
  const pick = picks.find((p) => p.id === pid);
  return pick ? { unit, pick } : null;
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
  // Activate Optical Camouflage (096_B, 247_B, ZYBP-201_A): the pad performed
  // the Action and changed nothing (audit Phase 3, C3). The Status goes on
  // with the Action; the table swaps the model for the camouflage one.
  const camo = activatesCamo(a);
  if (camo && (t.statuses ?? []).includes('camouflage')) { api.toast(`${t.label} is already in the Optical Camouflage State.`); return; }
  let form: string | null = null;
  const forms = formSwitch(a);
  if (forms) {
    const opts = forms.filter((id) => id !== t.cardId && d.byId.get(id));
    if (!opts.length) { api.toast('No other form of this unit is in the card data.'); return; }
    form = opts.length === 1 ? opts[0] : await choiceDialog({ title: a.name.en ?? a.id, choices: opts.map((id) => ({ id, label: cardName(d.byId.get(id)!) })), stacked: true });
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
    const pick = await choiceDialog({ title: a.name.en ?? a.id, choices: rows, stacked: true });
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
    const pick = holders.length === 1 ? String(holders[0].uid) : await choiceDialog({ title: a.name.en ?? a.id, body: rule.range ? `This Mech, or an Ally within Range ${rule.range}.` : 'Only this Mech is in reach.', choices: holders.map((o) => ({ id: String(o.uid), label: `${o.label}${o.uid === t.uid ? ' (this Mech)' : ''}` })), stacked: true });
    if (pick === null) return;
    const to = holders.find((o) => String(o.uid) === pick)!;
    resupply = { to, actionId: rule.actionId, amount: rule.amount };
  }
  // A Token the Action puts on a chosen target (Target Tag's Highlight). The
  // table judges range and sight; the pad asks who, before anything is paid.
  let tagged: { uid: number; statusId: string; stacks: number } | null = null;
  const tag = targetStatusGrant(a);
  if (tag) {
    // The shared reader: no Low Value Unit and, for a Highlight, no unit in
    // Optical Camouflage (FAQ I1, J3); both were offered and then refused
    // (audit Phase 3, E2). The table judges Range and sight.
    const units = targetStatusTargets(d, api.state().tokens, t, a, tag);
    if (!units.length) { api.toast(`${a.name.en}: there is no unit to target.`); return; }
    const pick = await choiceDialog({
      title: a.name.en ?? a.id,
      body: a.range ? `One target within Range ${a.range}, in line of sight.` : 'One target.',
      choices: units.map((x) => ({ id: String(x.uid), label: `${x.side === t.side ? 'Ally' : 'Enemy'} · ${x.label}` })),
      stacked: true,
    });
    if (pick === null) return;
    tagged = { uid: Number(pick), statusId: tag.statusId, stacks: tag.stacks };
  }
  // Strengthen Link and a Link Beacon: who recovers. System Cleanup: whose
  // Token, and which. Asked before anything is paid.
  const linkRule = linkSupportOf(a);
  let linkTo: Token[] | null = null;
  if (linkRule) {
    linkTo = await askLinkSupport(api, t, a, linkRule);
    if (linkTo === null) return;
  }
  const cleanRule = tokenCleanupOf(a);
  let cleaned: { unit: Token; pick: TokenPick } | null = null;
  if (cleanRule) {
    cleaned = await askTokenCleanup(api, t, a, cleanRule);
    if (!cleaned) return;
  }
  // ZHDR-206_B Stance feedback: which Ally Mech and which Stance, asked before
  // anything is paid (audit Phase 2, D1). The table judges the Range.
  let feedback: { to: Token; stance: Stance } | null = null;
  if (stanceFeedbackOf(a)) {
    const targets = stanceFeedbackTargets(d, api.state().tokens, t, a, true);
    if (!targets.length) { api.toast(`${a.name.en}: no Ally Mech out of Shutdown Stance to switch (FAQ H2).`); return; }
    const id = targets.length === 1 ? String(targets[0].uid) : await choiceDialog({ title: `${a.name.en}: which Ally Mech?`, choices: targets.map((x) => ({ id: String(x.uid), label: `${x.label} · ${x.stance}` })), stacked: true });
    const to = targets.find((x) => String(x.uid) === id);
    if (!to) return;
    const stance = await choiceDialog({ title: `${to.label}: which Stance?`, choices: (['defensive', 'mobility', 'offensive'] as const).filter((x) => x !== to.stance).map((x) => ({ id: x, label: `${x[0].toUpperCase()}${x.slice(1)}` })), stacked: true });
    if (stance !== 'defensive' && stance !== 'mobility' && stance !== 'offensive') return;
    feedback = { to, stance };
  }
  let chargeSlot: string | null = null;
  if (isChargeAction(a)) {
    const slots = chargeableSlots(d, t).filter((x) => !x.charged);
    if (!slots.length) { api.toast(`${t.label} has no Chargeable Part whose token is still face-down (4.14).`); return; }
    chargeSlot = slots.length === 1 ? String(slots[0].slot) : await choiceDialog({ title: a.name.en ?? a.id, choices: slots.map((x) => ({ id: String(x.slot), label: x.label })), stacked: true });
    if (chargeSlot === null) return;
  }
  // The shared Charge Action is that Part's Action (FAQ H6/H7; audit Phase 2, E7).
  const partKey = a.id === 'COMMON_CHARGE' && chargeSlot ? `COMMON_CHARGE@${chargeSlot}` : undefined;
  if (!api.send({ kind: 'performAction', seat: t.side, uid: t.uid, actionId: a.id, ...(partKey ? { partKey } : {}), ...(twoHandedUse(d, t, a) ? { twoHanded: true } : {}) })) return;
  // A Moving Action that shoves - 181 Centaur's Push 1 onto an enemy Ground
  // unit in the grid in front. The pad has no board to find the victim on, so
  // it says what the table owes; it said nothing (audit 2026-09-25).
  const shove = a.type === 'Moving' ? knockbackOf(a, d.actionTranslation(a.id)?.english ?? undefined) : undefined;
  api.toast(shove
    ? `${t.label}: ${a.name.en}. ${shove.push ? 'Push' : 'Knockback'} ${shove.grids}: an enemy Ground unit in the grid in front may be moved ${shove.grids}, settle it on the table.`
    : `${t.label}: ${a.name.en}.`);
  const seat = t.side;
  const uid = t.uid;
  // Everything below rides the Action: one tap, one Undo (`chain: 'join'`).
  // Without it a Charge Action undid only its Charge Token and kept the
  // Action paid.
  const chain = 'join' as const;
  if (grant) api.send({ kind: 'applyStatus', seat, uid, targetUid: uid, statusId: grant.statusId, stacks: grant.stacks, chain });
  if (camo && api.send({ kind: 'applyStatus', seat, uid, targetUid: uid, statusId: 'camouflage', chain })) {
    api.toast(`${t.label}: Optical Camouflage activated (4.12.2). Every Hexagon Token comes off; put the camouflage model on the table.`);
  }
  if (repair) api.send({ kind: 'repairPart', seat, uid, slot: repair.slot, mode: repair.mode, chain });
  if (form) api.send({ kind: 'switchForm', seat, uid, actionId: a.id, cardId: form, chain });
  const mode = transformOffer(d, t, a);
  if (mode) api.send({ kind: 'transformPart', seat, uid, slot: mode.slot, cardId: mode.into.id, chain });
  if (unfoldsOwed(d, [t]).some((x) => x.actionId === a.id)) api.send({ kind: 'unfold', seat, uid, chain });
  if (chargeSlot) api.send({ kind: 'setCharge', seat, uid, slot: chargeSlot as PartSlot, on: true, chain });
  if (tagged) api.send({ kind: 'applyStatus', seat, uid, targetUid: tagged.uid, statusId: tagged.statusId, stacks: tagged.stacks, chain });
  if (resupply) api.send({ kind: 'restoreAmmo', seat: resupply.to.side, uid: resupply.to.uid, actionId: resupply.actionId, amount: resupply.amount, chain });
  if (linkTo && linkRule) {
    for (const x of linkTo) {
      for (let i = 0; i < linkRule.amount; i++) api.send({ kind: 'recoverLink', seat, uid, targetUid: x.uid, actionId: a.id, chain });
    }
    api.toast(linkTo.length ? `${a.name.en}: Link restored to ${linkTo.map((x) => x.label).join(', ')}.` : `${a.name.en}: nobody in range was short of Link.`);
  }
  if (cleaned) {
    api.send({ kind: 'removeStatus', seat, uid, targetUid: cleaned.unit.uid, statusId: cleaned.pick.statusId, ...(cleaned.pick.face ? { face: cleaned.pick.face } : {}), chain });
    api.toast(`${a.name.en}: ${cleaned.pick.label} removed from ${cleaned.unit.label}.`);
  }
  if (feedback) {
    api.send({ kind: 'stanceFeedback', seat, uid, actionId: a.id, targetUid: feedback.to.uid, stance: feedback.stance, chain });
    api.toast(`${a.name.en}: ${feedback.to.label} switches to ${feedback.stance} Stance.`);
  }
  // Command Coordination off the back of the Action (the table judges the
  // Drone's range), then an Extra Action Opportunity the Action grants.
  const upTo = t.kind === 'mech' ? coordinationFor(d, t, a) : 0;
  if (upTo > 0) {
    await offerCoordination(d, api.state(), t, upTo, (mechUid, targetUid) => {
      api.send({ kind: 'coordinateCommand', seat, uid: mechUid, targetUid, chain });
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
      if (pick && pick !== '__none') api.send({ kind: 'grantExtra', seat, uid: Number(pick), linkCost: extra.linkCost, chain });
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
      ${done(st.id) ? '<span class="pad-turn-val">✓</span>' : (api.solo || api.me() === s.round.firstPlayer
        // Check Tasks opens the score sheet, whose Award settles the step; Done
        // stays for a round that pays nothing.
        ? `${st.id === 'tasks' ? btn(api, 'dock', 'Score', 'data-dock="tasks"', 'pad-chip on') : ''}${btn(api, 'g-endstep', 'Done', `data-step="${st.id}"`)}`
        : '<span class="pad-turn-val">…</span>')}</div>`).join('');
  const all = steps.every((st) => done(st.id));
  const last = s.round.n >= (s.roundLimit ?? 5);
  return head(api, 'End Phase', `Round ${s.round.n}`, true) + rows
    + (all ? (last ? btn(api, 'g-endmatch', 'End the game', '', 'pad-chip on') : `<p class="pad-turn-note">Continue to start Round ${s.round.n + 1}.</p>`) : '');
}

// One designation a Task still owes (a Bounty's Mech, a Leader, a Zone), asked
// as a list. Shared by the strip's Choose button and by the pad, which asks it
// the moment the Task that owes it is picked.
export async function askDesignation(api: GuideApi, index: number): Promise<void> {
  const s = api.state();
  const owed = taskDesignations(api.data, s)[index];
  if (!owed) return;
  if (owed.what === 'zone') {
    const zones = missionZones(api.data, s);
    const pick = await choiceDialog({ title: owed.label, choices: zones.map((z) => ({ id: z.id, label: z.name })), stacked: true });
    if (pick !== null) api.send({ kind: 'designateTask', seat: owed.by, what: 'zone', for: owed.side, zone: pick });
    return;
  }
  const pool = s.tokens.filter((x) => x.kind === 'mech' && (owed.owner ? x.side === owed.owner : true));
  // Two Commanders are asked back to back, so the question says whose.
  const title = owed.what === 'leader' ? `${api.sideName(owed.side)} · ${owed.label}` : owed.label;
  const pick = await choiceDialog({ title, choices: pool.map((m) => ({ id: String(m.uid), label: `${m.label} · ${api.sideName(m.side)}` })), stacked: true });
  if (pick !== null) api.send({ kind: 'designateTask', seat: owed.by, what: owed.what, for: owed.side, uid: Number(pick) });
}

// The designations this phone may answer for a side's Task, by index.
export function designationsFor(api: GuideApi, side: Side): number[] {
  return taskDesignations(api.data, api.state())
    .map((d, i) => ({ d, i }))
    .filter(({ d }) => d.side === side && (api.solo || d.by === api.me()))
    .map(({ i }) => i);
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
  // The pad takes a free hand whenever there is one, and that can change the
  // length paid (card 129: Long performed as Medium), after the Stance has
  // (ZHRA-102_A is Short in Offensive; audit Phase 2, D2).
  const priced = t.kind === 'mech' ? stanceShaped(a, t.stance) : a;
  const hands = twoHandedUse(api.data, t, priced);
  const paidAs = hands?.action ?? priced;
  const len = lengthOf(paidAs);
  // The engine's own answer: Ticks or the activation, and every rule that
  // sits on top of them - the icon lock, RWS, Shutdown. A length-less Mech
  // Action is not a choice an Opportunity pays for, so it gets no button.
  if (t.kind === 'mech' && !len) return '';
  const chk = api.check({ kind: 'performAction', seat: t.side, uid: t.uid, actionId: a.id, partKey, ...(hands ? { twoHanded: true } : {}) });
  const v: TickVerdict = chk.ok ? { ok: true } : { ok: false, why: chk.why ?? 'Not now' };
  void opp;
  const cost = costOf(paidAs);
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
    // The Reboot a Shutdown Mech owes when its Opportunity comes (FAQ K17),
    // offered on the turn panel since it is the whole of that Opportunity.
    case 'g-reboot': {
      const t = s.tokens.find((x) => x.uid === Number(el.dataset.uid));
      if (t) api.send({ kind: 'reboot', seat: t.side, uid: t.uid, stance: el.dataset.stance as Stance });
      return true;
    }
    case 'g-tie': {
      const t = s.tokens.find((x) => x.uid === Number(el.dataset.uid));
      if (t) api.send({ kind: 'chooseTied', seat: t.side, uid: t.uid });
      return true;
    }
    case 'g-first': api.send({ kind: 'acceptRoll', seat: me, first: el.dataset.side as Side }); return true;
    case 'g-accept': api.send({ kind: 'acceptRoll', seat: me }); return true;
    case 'g-tasks-done': api.send({ kind: 'finishTasks', seat: me }); return true;
    case 'g-edge': api.send({ kind: 'pickEdge', seat: s.round.firstPlayer, edge: el.dataset.edge as 'black' | 'white' }); return true;
    case 'g-deploy': {
      const t = s.tokens.find((x) => x.uid === Number(el.dataset.uid));
      if (!t) return true;
      // The piece stands on the physical table; the sheet only needs to know
      // it is out. The cell is the placeholder every boardless unit carries.
      // A unit with a Part that Activates Optical Camouflage may deploy in it
      // (FAQ I6), which the pad never offered (audit Phase 3, C3).
      const place = (camo: boolean): void => {
        api.send({ kind: 'deployUnit', seat: t.side, uid: t.uid, to: { col: 0, row: 0 }, stance: t.kind === 'mech' ? t.stance : undefined, facing: 0, ...(camo ? { camo: true } : {}) });
      };
      if (!canActivateCamo(api.data, t)) { place(false); return true; }
      void choiceDialog({
        title: `Deploy ${t.label}`,
        body: `${t.label} can Activate Optical Camouflage, so it may deploy already in it (FAQ I6): put the camouflage model on the table.`,
        choices: [
          { id: 'plain', label: 'Deploy it as it is', primary: true },
          { id: 'camo', label: 'Deploy in Optical Camouflage' },
          { id: '', label: 'Cancel', cancel: true },
        ],
        stacked: true,
      }).then((id) => { if (id === 'plain' || id === 'camo') place(id === 'camo'); });
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
        // The coordination and the end are one tap: every command after the
        // first joins it for Undo.
        let sent = 0;
        void offerCoordination(api.data, s, t, owed, (mechUid, targetUid) => {
          if (api.send({ kind: 'coordinateCommand', seat: t.side, uid: mechUid, targetUid, ...(sent ? { chain: 'join' as const } : {}) })) sent++;
        }, (_d, text) => api.toast(text)).then(() => { api.send({ kind: 'endOpportunity', seat: t.side, uid: t.uid, ...(sent ? { chain: 'join' as const } : {}) }); });
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
      // An Electronic Attack opens the counter-roll the same way, and so does a
      // Scan printed on a card (the Scan Battlefield, 080_A and 522_A), which
      // went to the plain Action door: a Tick spent and no roll (audit Phase 3, A2).
      if (a && (isElectronicAttack(a.action) || isScanAction(a.action)) && api.attack) {
        api.attack(t.uid, a.action.id, { electronic: true });
        return true;
      }
      // A Link Beacon's Delayed Action restores Link and the Beacon stays
      // (4.7.5): it is asked like any other routed Action, never Detonated.
      if (a && t.kind === 'projectile' && linkSupportOf(a.action)) {
        void performRouted(api, t, a.action);
        return true;
      }
      // A Projectile's Delayed Action: paid, then the detonation resolver.
      if (a && t.kind === 'projectile' && a.action.type !== 'Passive') {
        if (api.send({ kind: 'performAction', seat: t.side, uid: t.uid, actionId: a.action.id })) api.detonate(t.uid, a.action.id, true);
        return true;
      }
      // An Action that fires projectiles launches them; a card that names
      // more than one asks which.
      if (a && a.projectiles.length && api.launch) {
        const launch = api.launch;
        if (a.projectiles.length === 1) { launch(t.uid, a.action.id, a.projectiles[0].id); return true; }
        void choiceDialog({
          title: a.action.name.en ?? a.action.id,
          choices: a.projectiles.map((p) => ({ id: p.id, label: cardName(p) })),
          stacked: true,
        }).then((pick) => { if (pick !== null) launch(t.uid, a.action.id, pick); });
        return true;
      }
      if (a) { void performRouted(api, t, a.action); return true; }
      // A Common Action (6.1) is not among the Parts' Actions: paid the same
      // way, then its own tool. The Punch is a Melee Attack and Scan an
      // Electronic Counter-roll, so both go through the attack window, which
      // pays once the table has judged the shot. Stabilize and Reveal do more
      // than spend a Tick, so each pays and then sends its own command.
      const c = t.kind === 'mech' ? api.data.commonActions.find((x) => x.id === el.dataset.id) : undefined;
      if (c) {
        if (c.type === 'Melee' && api.attack) { api.attack(t.uid, c.id); return true; }
        // The Common Scan too: isElectronicAttack is false for it, so it paid a
        // Tick through the plain door and opened nothing (audit Phase 3, A2).
        if ((isElectronicAttack(c) || isScanAction(c)) && api.attack) { api.attack(t.uid, c.id, { electronic: true }); return true; }
        // Stabilize asks its Token question BEFORE the Tick is paid, so a
        // Cancel costs nothing; the Action is paid as the answer is sent.
        if (c.id === 'COMMON_STABILIZE') {
          api.stabilise?.(t.uid, () => api.send({ kind: 'performAction', seat: t.side, uid: t.uid, actionId: c.id }));
          return true;
        }
        // |Discard| names its Part BEFORE the Ticks are paid, so backing out of
        // the question costs nothing; then the flip is the engine's `disarm`.
        if (c.id === 'COMMON_DISCARD' && api.pickDiscard) {
          void api.pickDiscard(t.uid).then((slot) => {
            if (slot === null) return;
            // Keyed to the hand discarded, so the other hand may Discard too (E7).
            if (api.send({ kind: 'performAction', seat: t.side, uid: t.uid, actionId: c.id, partKey: `COMMON_DISCARD@${slot}` })) {
              api.send({ kind: 'disarm', seat: t.side, uid: t.uid, targetUid: t.uid, slot, chain: 'join' });
            }
          });
          return true;
        }
        if (c.id === 'COMMON_REVEAL') {
          if (api.send({ kind: 'performAction', seat: t.side, uid: t.uid, actionId: c.id })) api.send({ kind: 'reveal', seat: t.side, uid: t.uid, chain: 'join' });
          return true;
        }
        void performRouted(api, t, c);
      }
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
    case 'g-reveal': {
      const t = api.state().tokens.find((x) => x.uid === Number(el.dataset.uid));
      if (t) api.send({ kind: 'reveal', seat: t.side, uid: t.uid });
      return true;
    }
    case 'g-react-go': answerReaction(api, Number(el.dataset.uid), el.dataset.id!, true); return true;
    case 'g-react-skip': answerReaction(api, Number(el.dataset.uid), el.dataset.id!, false); return true;
    case 'g-riposte': {
      const uid = Number(el.dataset.uid);
      const t = s.tokens.find((x) => x.uid === uid);
      const r = (ensureScript(s).reactions ?? []).find((x) => x.uid === uid && x.kind === 'riposte');
      if (!t || !r) return true;
      // The Opportunity ends first, if it is still the open one.
      const ended = ensureScript(s).opp?.uid === r.fromUid;
      if (ended && !api.send({ kind: 'riposte', seat: t.side, uid, fromUid: r.fromUid! })) return true;
      const rides = ended ? { chain: 'join' as const } : {};
      if (el.dataset.only) { api.send({ kind: 'resolveReaction', seat: t.side, uid, actionId: r.actionId, ...rides }); return true; }
      const melees = guidedActions(api.data, t).filter((g) => g.action.type === 'Melee').map((g) => g.action);
      if (!melees.length) { api.send({ kind: 'resolveReaction', seat: t.side, uid, actionId: r.actionId, ...rides }); return true; }
      void (async () => {
        const pick = melees.length === 1 ? melees[0].id : await choiceDialog({
          title: 'Riposte',
          choices: melees.map((a) => ({ id: a.id, label: a.name.en ?? a.id })),
          stacked: true,
        });
        if (pick === null) return;
        // The granted Melee spends the debt through its own apply, and its one
        // target is the attacker (FAQ C1); the pick used to list every enemy.
        api.attack?.(uid, pick, { granted: true, only: r.fromUid });
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
      void askDesignation(api, Number(el.dataset.i));
      return true;
    }
    case 'g-secondary': return false; // the pad's own Tasks panel picks it
    case 'g-main': return false; // and the Main Task too
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
