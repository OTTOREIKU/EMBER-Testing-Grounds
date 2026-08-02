import type { CardAction, ExtraTick, GameState, Opportunity, ScriptState, Side, Stance, Timing, Token } from './types';
import { newOpportunity, normaliseScript, statusCount, STATUSES, TIMINGS } from './types';
import type { GameData, MissionCard } from './data';
import { cardName, squadLabel } from './data';
import { bindTips, linkMechanics } from './inspector';
import { choiceDialog } from './dialog';
import { PHASES, PHASE_INFO } from './tracker';
import { type ActionWorld, canActivateCamo, type ExtraActivation, extraActivationOf, guidedActions, initiativeFor, maneuverRange, maxLink, SLOT_LABEL, tokenCards } from './units';
import { canManeuver, canOverload, canPerform, costLabel, costOf, extrasLeft, grantHolds, LENGTH_NAME, lengthOf, OVERLOAD_MAX, whyGrantLapsed } from './ticks';
import { perform } from './commands';
import { alive, canAct, isLoopPhase, nextTurn, onExtraOpportunity, type LoopPhase, nextActivation, activationOrder, actionPhaseComplete, loopComplete, eligibleUnits, commandTokensFor, type InitLookup, type Activation } from './loop';
import { deployable, deploymentComplete, deployTurn, firstPlayerFrom, newSetup, normaliseSetup, rollTotal, type SetupState } from './setup';
import { normaliseTasks, scoreMain, scoreSecondary, settleControl, unpaidLines, type ScoreLine, type ScoreResult, type SecondaryScoring, type TaskState } from './tasks';

function phaseDone(text: string): string {
  return `<p class="pg-complete"><i>✓</i><span>${text}</span></p>`;
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const UI_KEY = 'ember-playguide-ui-v3';

interface GuideUi {
  open: boolean;
  collapsed: boolean;
  rules: boolean;
  x: number | null;
  y: number | null;
}

function loadUi(): GuideUi {
  try {
    const raw = JSON.parse(localStorage.getItem(UI_KEY) ?? '{}') as Partial<GuideUi>;
    return {
      open: raw.open ?? true,
      collapsed: raw.collapsed ?? false,
      rules: raw.rules ?? false,
      x: raw.x ?? null,
      y: raw.y ?? null,
    };
  } catch {
    return { open: true, collapsed: false, rules: false, x: null, y: null };
  }
}

// The alternating designation loops and the Action Phase activation order live
// in loop.ts, shared with the command layer.
export { LOOP_PHASES, isLoopPhase, commandTokensFor, eligibleUnits, canAct, loopComplete, nextTurn, activationOrder, nextActivation, onExtraOpportunity, actionPhaseComplete } from './loop';
export type { Activation, InitLookup, LoopPhase } from './loop';

export interface GuideCallbacks {
  world(): ActionWorld;
  onAdvancePhase(): void;
  onStartGame(): void;
  onSelectUnit(uid: number): void;
  onPickMission(): void;
  onShowDial(uid: number): void;
  onMoveUnit(uid: number, opts: { range?: number; label: string }, done: (moved: boolean) => void): void;
  onPerformAction(uid: number, actionId: string, done: (performed: boolean) => void): void;
  onSetStance(uid: number, stance: Stance): void;
  onIntercept(uid: number, actionId: string, targetUid: number): void;
  onRollFirstPlayer(side: Side): void;
  onPlaceUnit(uid: number, opts: { stance: Stance; camo: boolean }): void;
  onRemoveSpent(): void;
  onPickSecondary(side: Side): void;
  onPlayTactic(side: Side, id: string): void;
  onEndGame(): void;
  mapLabel(): string;
  zoneLabel(): string;
  onNote(t: Token, text: string): void;
  onChanged(): void;
}

function tacticFitsPhase(when: string, phase: string): boolean {
  const w = when.toLowerCase();
  if (w.includes('command')) return phase === 'Command';
  if (w.includes('end phase')) return phase === 'End';
  if (w.includes('action opportunity')) return phase === 'Action';
  return false;
}

export class PlayGuide {
  private host: HTMLElement;
  private root: HTMLElement;
  private data: GameData;
  private cb: GuideCallbacks;
  private state: GameState | null = null;
  private picked: number | null = null;
  private warn: string | null = null;
  private deploying: { uid: number; stance: Stance; camo: boolean } | null = null;
  private ui: GuideUi;

  constructor(host: HTMLElement, data: GameData, cb: GuideCallbacks) {
    this.host = host;
    this.data = data;
    this.cb = cb;
    this.ui = loadUi();
    this.root = document.createElement('div');
    this.root.id = 'play-guide';
    this.host.appendChild(this.root);
    this.attachDrag();
  }

  private init: InitLookup = (t, timing) => initiativeFor(this.data, t, timing);

  private saveUi(): void {
    localStorage.setItem(UI_KEY, JSON.stringify(this.ui));
  }

  // Normalising in place rather than swapping in a fresh object, so a caller that
  // holds on to the script across another call is still writing to the live one.
  private script(s: GameState): ScriptState {
    const next = normaliseScript(s.script, s.round.firstPlayer);
    if (s.script) Object.assign(s.script, next);
    else s.script = next;
    return s.script;
  }

  update(state: GameState): void {
    this.state = state;
    if (this.deploying && state.tokens.find((t) => t.uid === this.deploying!.uid)?.deployed !== false) this.deploying = null;
    if (this.syncStage(state)) this.cb.onChanged();
    else this.render();
  }

  // Runs once per round-and-phase, on entry. Persisted through `stage` so a
  // reload does not re-grant tokens or wipe a loop already in progress.
  private syncStage(s: GameState): boolean {
    const sc = this.script(s);
    const now = `${s.round.n}:${s.round.phase}`;
    if (sc.stage === now || sc.stage === `${now}:locked`) return false;
    const leaving = sc.stage.split(':')[1];
    // Unspent Command Tokens do not carry over (3.2.3).
    if (leaving === '0') s.commandTokens = { s1: 0, s2: 0 };
    // Control captures are a judgement of the End Phase itself (5.3.2), so
    // walking out of it must not lose them, Award or no Award.
    if (leaving === '5') this.settleTasks(s);
    if (s.round.phase === 0) {
      s.commandTokens = { s1: commandTokensFor(s, 's1'), s2: commandTokensFor(s, 's2') };
      sc.commanded = [];
      sc.freeCommand = [];
    }
    if (s.round.phase === 0 || s.round.phase === 2) sc.acted = [];
    // End Phase ticks are keyed by round, so drop the ones that can never match
    // again rather than letting the list grow for the length of the game.
    sc.endDone = sc.endDone.filter((k) => k.startsWith(`${s.round.n}:`));
    // Ticks belong to one Action Opportunity, so none survives a phase change.
    sc.opp = null;
    sc.passed = [];
    sc.turn = s.round.firstPlayer;
    sc.stage = now;
    return true;
  }

  private renderIdle(): void {
    this.root.className = this.ui.collapsed ? 'collapsed' : '';
    this.root.innerHTML = `
      <div class="pg-head pg-head-idle">
        <span class="pg-grip" title="Drag to move">⠿</span>
        <b class="pg-title">Play guide</b>
        <span class="pg-phase pg-idle-tag">Not started</span>
        <button class="pg-fold" title="${this.ui.collapsed ? 'Expand' : 'Collapse'}">${this.ui.collapsed ? '▸' : '▾'}</button>
        <button class="pg-close" title="Hide the play guide">✕</button>
      </div>
      <div class="pg-body">
        <p class="pg-sub">New here? Start with step 1</p>
        <p class="pg-idle-lead">You need a squad before you can play. Build one in the <b>ADD</b> tab on the right, then start a game and this guide takes over: the pre-game roll, deployment, and every round driven phase by phase.</p>
        <ol class="pg-firststeps">
          <li><b>Build a squad.</b> Open the <b>ADD</b> tab on the right, then pick Mech, assemble your units and add them to their corresponding faction's squad, most teams are comprised of a few mechs and drones. Or use Squad Builder and Import Squad at the bottom of that tab.</li>
          <li><b>Pick a battlefield.</b> Choose a Map and a Mission from the toolbar.</li>
          <li><b>Start the game.</b> The button below walks you through the rest.</li>
        </ol>
        <div class="pg-units"><button class="pg-start" data-start-game="1">Start game</button></div>
        <p class="pg-idle-note">In a hurry? Load a ready-made squad and board from <b>Scenarios</b> in the toolbar.</p>
        <details class="pg-rules"${this.ui.rules ? ' open' : ''}>
          <summary>Playing without the guide</summary>
          <ul class="pg-steps">
            <li>Move units, roll dice and run attacks by hand from the Details panel.</li>
            <li>Step the round bar through the phases yourself.</li>
            <li>Browse cards, missions and the <a href="reference.html" target="_blank" rel="noopener">Reference</a> at any time.</li>
          </ul>
        </details>
      </div>`;

    bindTips(this.root);
    this.root.querySelector<HTMLButtonElement>('.pg-start')!.addEventListener('click', () => this.cb.onStartGame());
    this.root.querySelector('.pg-fold')!.addEventListener('click', () => {
      this.ui.collapsed = !this.ui.collapsed;
      this.saveUi();
      this.render();
    });
    this.root.querySelector('.pg-close')!.addEventListener('click', () => {
      this.ui.open = false;
      this.saveUi();
      this.render();
    });
    this.root.querySelector('.pg-rules')!.addEventListener('toggle', (ev) => {
      this.ui.rules = (ev.currentTarget as HTMLDetailsElement).open;
      this.saveUi();
    });
    this.place();
  }

  private render(): void {
    const s = this.state;
    if (!s) return;
    if (!this.ui.open) {
      this.root.className = 'closed';
      this.root.innerHTML = `<button class="pg-reopen" title="Show the play guide. Middle click and drag to move it.">Guide</button>`;
      this.root.querySelector('.pg-reopen')!.addEventListener('click', () => {
        this.ui.open = true;
        this.saveUi();
        this.render();
      });
      this.place();
      return;
    }

    if (!normaliseSetup(s.setup)) {
      this.renderIdle();
      return;
    }

    this.script(s);
    const phase = PHASES[s.round.phase];
    const info = PHASE_INFO[phase];
    const limit = s.roundLimit ?? 5;
    const last = s.round.phase === PHASES.length - 1;

    this.root.className = this.ui.collapsed ? 'collapsed' : '';
    this.root.innerHTML = `
      <div class="pg-head">
        <span class="pg-grip" title="Drag to move">⠿</span>
        <b class="pg-title">Round ${s.round.n}<small>/${limit}${limit && s.round.n > limit ? '+' : ''}</small></b>
        <span class="pg-phase">${phase}<small> ${s.round.phase + 1}/6</small></span>
        <button class="pg-fold" title="${this.ui.collapsed ? 'Expand' : 'Collapse'}">${this.ui.collapsed ? '▸' : '▾'}</button>
        <button class="pg-close" title="Hide the play guide">✕</button>
      </div>
      <div class="pg-body">
        <p class="pg-sub">${info.sub}</p>
        ${this.warn && (phase === 'Planning' || this.setupState(s)) ? `<p class="pg-warn">${esc(this.warn)}</p>` : ''}
        ${
          this.setupState(s)
            ? this.setupHtml(s)
            : `${this.tacticsHtml(s, phase)}${this.interceptHtml(s)}
        ${
          phase === 'Action'
            ? this.actionHtml(s)
            : phase === 'Planning'
              ? this.planningHtml(s)
              : phase === 'End'
                ? this.endHtml(s)
                : this.loopHtml(s, phase)
        }`
        }
        <details class="pg-rules"${this.ui.rules ? ' open' : ''}>
          <summary>How this phase works</summary>
          <ul class="pg-steps">${info.lines.map((x) => `<li>${x}</li>`).join('')}</ul>
        </details>
      </div>
      <div class="pg-foot">
        <span class="pg-left">${esc(this.blockedReason(s) ?? info.sub.split('·').pop()?.trim() ?? '')}</span>
        <button class="pg-next"${
          this.blockedReason(s) ? ` disabled title="${esc(this.blockedReason(s)!)}"` : ''
        }>${
          last
            ? s.round.n >= (s.roundLimit ?? 5)
              ? `Extra round ${s.round.n + 1} ▸`
              : `End round ${s.round.n}`
            : `Next: ${PHASES[s.round.phase + 1]}`
        }</button>
      </div>`;

    bindTips(this.root);
    linkMechanics(this.root, this.data.mechanics, { pin: false, mark: false });
    this.root.querySelectorAll<HTMLButtonElement>('[data-designate]').forEach((b) =>
      b.addEventListener('click', () => this.designate(Number(b.dataset.designate))),
    );
    this.root.querySelectorAll<HTMLButtonElement>('[data-move]').forEach((b) =>
      b.addEventListener('click', () => {
        const uid = Number(b.dataset.move);
        this.cb.onMoveUnit(uid, { label: 'Moving' }, (moved) => {
          if (moved) this.finishDesignation(uid);
        });
      }),
    );
    this.root.querySelectorAll<HTMLButtonElement>('[data-acted]').forEach((b) =>
      b.addEventListener('click', () => this.finishDesignation(Number(b.dataset.acted))),
    );
    this.root.querySelectorAll<HTMLButtonElement>('[data-stance]').forEach((b) =>
      b.addEventListener('click', () => {
        const o = this.state ? this.opportunity(this.state) : null;
        if (o) this.cb.onSetStance(o.uid, b.dataset.stance as Stance);
      }),
    );
    this.root.querySelector('[data-score]')?.addEventListener('click', () => this.awardScore());
    this.root.querySelectorAll<HTMLButtonElement>('[data-secondary]').forEach((b) =>
      b.addEventListener('click', () => this.cb.onPickSecondary(b.dataset.secondary as Side)),
    );
    this.root.querySelectorAll<HTMLButtonElement>('[data-stabilise]').forEach((b) =>
      b.addEventListener('click', () => this.stabilise(Number(b.dataset.stabilise))),
    );
    this.root.querySelectorAll<HTMLButtonElement>('[data-reveal]').forEach((b) =>
      b.addEventListener('click', () => this.revealUnit(Number(b.dataset.reveal))),
    );
    this.root.querySelectorAll<HTMLButtonElement>('[data-scan]').forEach((b) =>
      b.addEventListener('click', () => {
        const t = this.state?.tokens.find((x) => x.uid === Number(b.dataset.scan));
        if (!t) return;
        this.cb.onSelectUnit(t.uid);
        this.cb.onNote(t, 'Scan: pick a camouflaged or Low Profile enemy within Range 6 and make an Electronic counter-roll against it. On a success the camouflage is Revealed, or a Low Profile Token comes off.');
      }),
    );
    this.root.querySelectorAll<HTMLButtonElement>('[data-reboot]').forEach((b) =>
      b.addEventListener('click', () => this.reboot(b.dataset.reboot as Stance)),
    );
    this.root.querySelector('[data-maneuver]')?.addEventListener('click', () => this.tryManeuver());
    this.root.querySelector('[data-overload]')?.addEventListener('click', () => this.tryOverload());
    for (const b of [...this.root.querySelectorAll<HTMLButtonElement>('[data-tactic]')]) {
      b.addEventListener('click', () => {
        const [side, id] = b.dataset.tactic!.split(':');
        this.cb.onPlayTactic(side as Side, id);
      });
    }
    this.root.querySelectorAll<HTMLButtonElement>('[data-act]').forEach((b) =>
      b.addEventListener('click', () => this.tryAction(b.dataset.act!)),
    );
    const markEnd = (id: string): void => {
      perform(this.data, s, { kind: 'markEndStep', seat: this.script(s).turn, step: id });
      this.cb.onChanged();
    };
    this.root.querySelectorAll<HTMLButtonElement>('[data-end-step]').forEach((b) =>
      b.addEventListener('click', () => markEnd(b.dataset.endStep!)),
    );
    this.root.querySelector('[data-end-remove]')?.addEventListener('click', () => {
      markEnd('remove');
      this.cb.onRemoveSpent();
    });
    this.root.querySelector('[data-end-tokens]')?.addEventListener('click', () => {
      // The aging happens inside the command, so what it will do is read off
      // the tokens first and narrated after.
      const preview = s.tokens.map((t) => ({ t, removed: (t.expiring ?? []).filter((id) => (t.statuses ?? []).includes(id)) }));
      markEnd('tokens');
      const names = (ids: string[]) => [...new Set(ids)].map((id) => STATUSES.find((d) => d.id === id)?.label ?? id).join(', ');
      for (const { t, removed } of preview) {
        const flipped = t.expiring ?? [];
        if (removed.length) this.cb.onNote(t, `End Phase: ${names(removed)} expired and came off.`);
        if (flipped.length) this.cb.onNote(t, `End Phase: ${names(flipped)} flipped to red and leaves next round.`);
      }
    });
    this.root.querySelector('[data-pick-mission]')?.addEventListener('click', () => this.cb.onPickMission());
    this.root.querySelector('[data-lock-map]')?.addEventListener('click', () => {
      const su = normaliseSetup(s.setup) ?? newSetup();
      if (!s.zoneSet && !this.warn) {
        this.warn = 'No zone overlay is selected, so no unit will have a Deployment Zone to go in. Lock it again to continue anyway.';
        this.render();
        return;
      }
      this.warn = null;
      s.setup = { ...su, stage: 'roll' };
      this.cb.onChanged();
    });
    this.root.querySelectorAll<HTMLButtonElement>('[data-roll]').forEach((b) =>
      b.addEventListener('click', () => this.cb.onRollFirstPlayer(b.dataset.roll as Side)),
    );
    this.root.querySelector('[data-roll-accept]')?.addEventListener('click', () => {
      const su = normaliseSetup(s.setup) ?? newSetup();
      const winner = firstPlayerFrom(su);
      if (!winner) return;
      s.round.firstPlayer = winner;
      s.setup = { ...su, stage: 'side' };
      this.cb.onChanged();
    });
    this.root.querySelectorAll<HTMLButtonElement>('[data-edge]').forEach((b) =>
      b.addEventListener('click', () => {
        // The edge follows the roll directly (3.1.2). Tasks still come before
        // any unit lands, but that is the deploy stage's gate, not this one's.
        const su = normaliseSetup(s.setup) ?? newSetup();
        const mine = b.dataset.edge as 'black' | 'white';
        const fp = s.round.firstPlayer;
        const other: Side = fp === 's1' ? 's2' : 's1';
        s.setup = { ...su, stage: 'deploy', edge: { ...su.edge, [fp]: mine, [other]: mine === 'black' ? 'white' : 'black' } as SetupState['edge'] };
        this.warn = null;
        this.cb.onChanged();
      }),
    );
    this.root.querySelectorAll<HTMLButtonElement>('[data-place]').forEach((b) =>
      b.addEventListener('click', () => {
        const uid = Number(b.dataset.place);
        const t = s.tokens.find((x) => x.uid === uid);
        this.deploying = { uid, stance: (t?.stance as Stance) ?? 'offensive', camo: false };
        this.armPlacement();
      }),
    );
    this.root.querySelectorAll<HTMLButtonElement>('[data-dep-stance]').forEach((b) =>
      b.addEventListener('click', () => {
        if (!this.deploying) return;
        this.deploying = { ...this.deploying, stance: b.dataset.depStance as Stance };
        this.armPlacement();
      }),
    );
    this.root.querySelector('[data-dep-camo]')?.addEventListener('click', () => {
      if (!this.deploying) return;
      this.deploying = { ...this.deploying, camo: !this.deploying.camo };
      this.armPlacement();
    });
    this.root.querySelector('[data-dep-cancel]')?.addEventListener('click', () => {
      this.deploying = null;
      this.cb.onChanged();
    });
    this.root.querySelector('[data-game-over]')?.addEventListener('click', () => this.cb.onEndGame());
    this.root.querySelector('[data-deploy-done]')?.addEventListener('click', () => {
      const su = normaliseSetup(s.setup) ?? newSetup();
      s.setup = { ...su, stage: 'done' };
      // The Command Phase stage was entered back when the game started, before
      // the roll decided the First Player, so its turn points at the pre-roll
      // side. Clearing the stage makes syncStage run again now that the real
      // First Player is known (3.2.2 starts the command loop from them).
      this.script(s).stage = '';
      this.cb.onChanged();
    });
    this.root.querySelectorAll<HTMLButtonElement>('[data-dial]').forEach((b) =>
      b.addEventListener('click', () => this.cb.onShowDial(Number(b.dataset.dial))),
    );
    this.root.querySelector('[data-lock-dials]')?.addEventListener('click', () => {
      const sc = this.script(s);
      const unset = s.tokens.filter((t) => t.kind === 'mech' && alive(t) && !t.timing);
      if (unset.length && !this.warn) {
        this.warn = `${unset.length} Mech${unset.length === 1 ? ' has' : 's have'} no Timing Dial set and will not activate at all this round. Confirm again to lock it in anyway.`;
        this.render();
        return;
      }
      this.warn = null;
      sc.stage = `${s.round.n}:1:locked`;
      this.cb.onChanged();
    });
    this.root.querySelectorAll<HTMLButtonElement>('[data-intercept]').forEach((b) =>
      b.addEventListener('click', () => {
        const sc = this.script(s);
        const item = sc.intercepts[Number(b.dataset.intercept)];
        if (!item) return;
        sc.intercepts = sc.intercepts.filter((x) => x !== item);
        this.cb.onIntercept(item.uid, item.actionId, item.targetUid);
      }),
    );
    this.root.querySelector('[data-intercept-skip]')?.addEventListener('click', () => {
      this.script(s).intercepts = [];
      this.cb.onChanged();
    });
    this.root.querySelectorAll<HTMLButtonElement>('[data-unit-act]').forEach((b) =>
      b.addEventListener('click', () => {
        if (this.picked !== null) this.performUnitAction(this.picked, b.dataset.unitAct!);
      }),
    );
    this.root.querySelector('[data-end]')?.addEventListener('click', () => this.endActivation());
    this.root.querySelector('[data-unpick]')?.addEventListener('click', () => {
      this.picked = null;
      this.warn = null;
      this.render();
    });
    // Bind by explicit attribute: several other buttons share the pg-pass look
    // ("Did it myself", "Back", the End Phase steps), and a class selector here
    // used to catch "Did it myself" too, so marking a drone done also passed
    // its whole side and silently skipped the other drones.
    this.root.querySelector('[data-pass]')?.addEventListener('click', () => this.pass());

    this.root.querySelector('.pg-rules')?.addEventListener('toggle', (ev) => {
      this.ui.rules = (ev.target as HTMLDetailsElement).open;
      this.saveUi();
    });
    this.root.querySelector('.pg-fold')!.addEventListener('click', () => {
      this.ui.collapsed = !this.ui.collapsed;
      this.saveUi();
      this.render();
    });
    this.root.querySelector('.pg-close')!.addEventListener('click', () => {
      this.ui.open = false;
      this.saveUi();
      this.render();
    });
    this.root.querySelector('.pg-next')!.addEventListener('click', () => this.cb.onAdvancePhase());
    this.place();
  }

  // Interception fires the instant an Aerial Unit Moves or is Launched, so an
  // owed attempt is shown wherever we are in the round rather than waiting.
  // Tactics are held in hand, so the guide can only remind. Each card's printed
  // timing decides which phase it belongs to, and 5.4.2 caps play at 1 a round.
  private tacticsHtml(s: GameState, phase: string): string {
    const rows: string[] = [];
    for (const side of ['s1', 's2'] as const) {
      const held = s.tactics?.[side] ?? [];
      if (!held.length) continue;
      const spent = (s.tacticsPlayed?.[side] ?? []).filter((e) => e.startsWith(`${s.round.n}:`));
      const seen = new Set<string>();
      for (const id of held) {
        if (seen.has(id)) continue;
        seen.add(id);
        const card = this.data.byId.get(id);
        if (!card) continue;
        const when = card.actions?.[0]?.name?.en ?? '';
        if (!tacticFitsPhase(when, phase)) continue;
        rows.push(`<div class="pg-tac-row${spent.length ? ' spent' : ''}">
          <span class="side-${side}">${squadLabel(side)}</span>
          <b>${esc(cardName(card))}</b>
          <small>${esc(when)}</small>
          <button class="pg-tac-play" data-tactic="${side}:${id}"${spent.length ? ' disabled' : ''}>${
            spent.length ? 'Spent' : 'Play'
          }</button>
        </div>`);
      }
    }
    if (!rows.length) return '';
    return `<div class="pg-tactics">
      <p class="pg-tac-head">Tactics you could play now</p>
      ${rows.join('')}
      <p class="pg-tac-note">Only 1 per player per round (5.4.2).</p>
    </div>`;
  }

  private interceptHtml(s: GameState): string {
    const owed = this.script(s).intercepts;
    if (!owed.length) return '';
    const rows = owed
      .map((x, i) => {
        const by = s.tokens.find((t) => t.uid === x.uid);
        const at = s.tokens.find((t) => t.uid === x.targetUid);
        if (!by || !at) return '';
        return `<button class="pg-act" data-intercept="${i}" data-mech="interception">
          <span class="pg-act-name">${esc(by.label)} → ${esc(at.label)}</span>
          <span class="pg-act-cost">INT</span>
        </button>`;
      })
      .join('');
    if (!rows) return '';
    return `<div class="pg-intercept">
      <p class="pg-intercept-head"><i>⊘</i> Interception owed</p>
      <p class="pg-intercept-note">A launch or move by an Aerial Unit triggers this at once, in this phase. Each attempt spends a Token, and a unit must keep going until its Tokens run out or the target dies.</p>
      <div class="pg-acts">${rows}</div>
      <button class="pg-pass" data-intercept-skip="1">Skip the rest</button>
    </div>`;
  }

  // ---------- end phase (rulebook 3.7) ----------

  private endHtml(s: GameState): string {
    const sc = this.script(s);
    const fp = `<p class="pg-turn">First player: <b class="side-${s.round.firstPlayer}">${squadLabel(s.round.firstPlayer)}</b></p>`;
    const doomed = s.tokens.filter(
      (t) => t.kind === 'mech' && Object.values(t.partStates).filter((p) => p !== 'destroyed').length <= 2,
    );
    const marked = s.tokens.filter((t) => (t.statuses ?? []).some((id: string) => {
      const def = STATUSES.find((d) => d.id === id);
      return def?.shape === 'square' || def?.shape === 'hexagon';
    }));
    const cmd = (s.commandTokens.s1 ?? 0) + (s.commandTokens.s2 ?? 0);
    const done = new Set(sc.endDone);
    const step = (id: string, n: number, title: string, body: string, action = '') => {
      const ok = done.has(`${s.round.n}:end:${id}`);
      return `<div class="pg-endstep${ok ? ' done' : ''}">
        <p class="pg-endhead"><i>${ok ? '✓' : n}</i><b>${title}</b></p>
        <p class="pg-endbody">${body}</p>
        ${ok ? '' : action}
      </div>`;
    };

    return `${fp}
      ${step(
        'remove',
        1,
        'Remove units',
        doomed.length
          ? `${doomed.map((t) => esc(t.label)).join(', ')} ${doomed.length === 1 ? 'has' : 'have'} 2 or fewer Parts left, so ${
              doomed.length === 1 ? 'it comes' : 'they come'
            } off now. Alternate removals from the First Player if the order could matter.`
          : 'No Mech is down to 2 or fewer Parts, and nothing is marked to leave at the end of the round.',
        doomed.length
          ? `<div class="pg-units"><button class="pg-unit" data-end-remove="1">Remove ${doomed.length}</button></div>`
          : `<div class="pg-units"><button class="pg-pass" data-end-step="remove">Nothing to remove</button></div>`,
      )}
      ${(() => {
        const torso = (t: Token) => (t.partStates.torso ?? 'intact') !== 'destroyed';
        const canStabilise = s.tokens.filter((t) => t.kind === 'mech' && alive(t) && torso(t) && (t.statuses ?? []).some((id) => {
          const d = STATUSES.find((x) => x.id === id);
          return d?.shape === 'square' || d?.shape === 'hexagon';
        }));
        const canReveal = s.tokens.filter((t) => alive(t) && statusCount(t.statuses, 'camouflage') > 0);
        const hidden = s.tokens.filter((t) => alive(t) && (statusCount(t.statuses, 'camouflage') > 0 || statusCount(t.statuses, 'lowProfile') > 0));
        const canScan = hidden.length ? s.tokens.filter((t) => t.kind === 'mech' && alive(t) && torso(t) && hidden.some((h) => h.side !== t.side)) : [];
        const none = !canStabilise.length && !canReveal.length && !canScan.length;
        return step(
          'commons',
          2,
          'End Phase actions',
          none
            ? 'Nobody can Scan, Stabilize System or Reveal this round, so there is nothing to spend an End Phase Action on.'
            : 'Scan, Stabilize System and Reveal each cost 1 Action Tick and are taken now, before tokens are managed.',
          none
            ? '<div class="pg-units"><button class="pg-pass" data-end-step="commons">Nothing to do</button></div>'
            : `<div class="pg-units">
                ${canStabilise.map((t) => `<button class="pg-unit" data-stabilise="${t.uid}" data-tip-title="Stabilize System" data-tip-sub="End Phase Common Action" data-tip="Torso Action.|Remove 1 Square or Hexagon Token from this Mech, then restore 1 Link.">Stabilize ${esc(t.label)}</button>`).join('')}
                ${canReveal.map((t) => `<button class="pg-unit" data-reveal="${t.uid}" data-mech="revealed">Reveal ${esc(t.label)}</button>`).join('')}
                ${canScan.map((t) => `<button class="pg-unit" data-scan="${t.uid}" data-mech="scanning">Scan with ${esc(t.label)}</button>`).join('')}
                <button class="pg-pass" data-end-step="commons">Done</button>
              </div>`,
        );
      })()}
      ${(() => {
        const red = s.tokens.flatMap((t) => (t.expiring ?? []).map((id) => ({ t, id })));
        const yellow = s.tokens.flatMap((t) =>
          (t.statuses ?? [])
            .filter((id) => STATUSES.find((d) => d.id === id)?.decay === 'yellow' && !(t.expiring ?? []).includes(id))
            .map((id) => ({ t, id })),
        );
        const unknown = s.tokens.flatMap((t) =>
          (t.statuses ?? []).filter((id) => {
            const d = STATUSES.find((x) => x.id === id);
            return (d?.shape === 'square' || d?.shape === 'hexagon') && !d.decay;
          }),
        );
        const name = (id: string) => STATUSES.find((d) => d.id === id)?.label ?? id;
        const bits = [
          red.length ? `${red.length} red token${red.length === 1 ? '' : 's'} to remove (${[...new Set(red.map((x) => name(x.id)))].join(', ')})` : '',
          yellow.length ? `${yellow.length} yellow to flip (${[...new Set(yellow.map((x) => name(x.id)))].join(', ')})` : '',
          cmd ? `${cmd} Command Token${cmd === 1 ? '' : 's'}` : '',
        ].filter(Boolean);
        return step(
          'tokens',
          3,
          'Token management',
          `Red Square and Hexagon Tokens come off, Yellow ones flip to their red side, and every Command Token is removed.${
            bits.length ? ` Waiting: ${bits.join(' · ')}.` : ' Nothing is waiting.'
          }${
            unknown.length
              ? `<em>${[...new Set(unknown.map(name))].join(', ')} ${
                  new Set(unknown).size === 1 ? 'has' : 'have'
                } no printed colour recorded, so ${new Set(unknown).size === 1 ? 'it is' : 'they are'} left alone.</em>`
              : ''
          }`,
          `<div class="pg-units"><button class="pg-unit" data-end-tokens="1">Age the tokens</button>
            <button class="pg-pass" data-end-step="tokens">Skip</button></div>`,
        );
      })()}
      ${(() => {
        const tasks = normaliseTasks(s.tasks);
        const mission = this.data.missions.cards.find((c) => c.id === s.mission);
        const last = s.round.n >= (s.roundLimit ?? 5);
        const preview = this.previewScore(s, tasks, mission, last);
        const total = `<p class="pg-vp"><b>Victory Points</b>
          <span class="side-s1">${squadLabel('s1')} ${tasks.vp.s1}</span> ·
          <span class="side-s2">${squadLabel('s2')} ${tasks.vp.s2}</span></p>`;
        const secLine = (['s1', 's2'] as Side[])
          .map((side) => {
            const card = tasks.secondary[side] ? this.data.secondary.find((c) => c.id === tasks.secondary[side]) : undefined;
            return card ? `<span class="side-${side}">${squadLabel(side)}: ${esc(card.name)}</span>` : '';
          })
          .filter(Boolean)
          .join(' · ');
        const body = `${mission
          ? `<b>${esc(mission.name)}</b>. ${esc(mission.scoring)}`
          : 'No Main Task is chosen, so there is nothing to score. Pick one from the Missions button in the toolbar.'}${
          secLine ? `<br><small>${secLine}</small>` : ''}`;
        const lines = preview.lines.length
          ? `<ul class="pg-score">${preview.lines
              .map((l) => `<li><b class="side-${l.side}">${squadLabel(l.side)}</b> +${l.vp} VP, ${esc(l.why)}</li>`)
              .join('')}</ul>`
          : mission
            ? `<p class="dim">Nothing scores this round${mission.cadence === 'at-end' && !last ? `, because this Task only pays out at the end of Round ${s.roundLimit ?? 5}` : ''}.</p>`
            : '';
        return step(
          'tasks',
          4,
          'Tasks and victory points',
          `${body}${total}${lines}`,
          preview.s1 || preview.s2
            ? `<div class="pg-units"><button class="pg-unit" data-score="1">Award ${preview.s1 ? `${squadLabel('s1')} +${preview.s1}` : ''}${preview.s1 && preview.s2 ? ' and ' : ''}${preview.s2 ? `${squadLabel('s2')} +${preview.s2}` : ''}</button>
                <button class="pg-pass" data-end-step="tasks">Skip</button></div>`
            : '<div class="pg-units"><button class="pg-pass" data-end-step="tasks">Nothing to score</button></div>',
        );
      })()}
      ${(() => {
        // After the last scheduled round the game ends and the totals decide it
        // (3.7.4), so the guide has to say so and offer the exit, not roll on
        // into another Command Phase as if nothing happened.
        const final = s.round.n >= (s.roundLimit ?? 5);
        const t = normaliseTasks(s.tasks);
        const verdict = t.vp.s1 === t.vp.s2
          ? `${t.vp.s1} Victory Points each, so the tiebreak counts Mech Parts and Drones left on the board (5.2.4).`
          : `${squadLabel(t.vp.s1 > t.vp.s2 ? 's1' : 's2')} leads ${Math.max(t.vp.s1, t.vp.s2)} to ${Math.min(t.vp.s1, t.vp.s2)}.`;
        return step(
          'round',
          5,
          final ? 'End of the game' : 'End of round',
          final
            ? `This was the last scheduled round, so the game ends and Victory Points are totalled (3.7.4). ${verdict}`
            : `The First Player Token flips, so ${squadLabel(s.round.firstPlayer === 's1' ? 's2' : 's1')} goes first next round.`,
          final
            ? `<div class="pg-units"><button class="pg-unit" data-game-over="1">End the game and settle the result</button></div>
               <p class="pg-intercept-note">Or press ${esc(`Extra round ${s.round.n + 1}`)} below to keep playing past the printed limit.</p>`
            : '',
        );
      })()}`;
  }

  // ---------- pre-game setup (rulebook 3.1.2, 3.1.4) ----------

  private armPlacement(): void {
    const d = this.deploying;
    if (!d) return;
    this.render();
    this.cb.onPlaceUnit(d.uid, { stance: d.stance, camo: d.camo });
  }

  blockedReason(s: GameState): string | null {
    const su = this.setupState(s);
    if (su) {
      if (su.stage === 'roll') {
        return firstPlayerFrom(su)
          ? 'Take the result first'
          : su.rolls.s1.length && su.rolls.s2.length
            ? 'Tied, roll again'
            : 'Roll for First Player';
      }
      if (su.stage === 'map') return 'Lock the battlefield';
      if (su.stage === 'side') return 'Choose a board edge';
      return deploymentComplete(s) ? 'Press Begin round 1' : 'Deploy every unit';
    }
    // Free play is a sandbox: with no game running nothing is gated, so the
    // round bar can be driven by hand for testing.
    if (!normaliseSetup(s.setup)) return null;
    if (PHASES[s.round.phase] === 'Planning' && this.script(s).stage !== `${s.round.n}:1:locked`) {
      return 'Confirm the timings';
    }
    return null;
  }

  private setupState(s: GameState): SetupState | null {
    const su = normaliseSetup(s.setup);
    return su && su.stage !== 'done' ? su : null;
  }

  private setupHtml(s: GameState): string {
    const su = this.setupState(s)!;
    if (su.stage === 'map') return this.mapHtml(s);
    if (su.stage === 'roll') return this.rollHtml(s, su);
    if (su.stage === 'side') return this.edgeHtml(s, su);
    return this.deployHtml(s, su);
  }

  // The battlefield is agreed before anything else, then locked, so nobody can
  // swap the map or the zone overlay once units are down or between rounds.
  // The Main Task decides which zones the board needs, so it is chosen here
  // rather than after the battlefield is fixed. Picking one draws its tactical
  // and deployment zones, which is what later Task designations need to exist.
  private mapHtml(s: GameState): string {
    const zones = s.zoneSet ?? '';
    const mission = s.mission ? this.data.missions.cards.find((m) => m.id === s.mission) : undefined;
    const ready = !!mission && !!zones;
    return `<p class="pg-active">Agree the battlefield
        <small>choose the Main Task, then the map, and lock them in</small></p>
      <div class="pg-dials">
        <div class="pg-dial-row${mission ? '' : ' unset'}"><span class="pg-dial-unit">Main Task</span>
          <span class="pg-dial-set">${mission ? esc(mission.name) : 'not chosen'}</span></div>
        <div class="pg-dial-row"><span class="pg-dial-unit">Map</span>
          <span class="pg-dial-set">${esc(this.cb.mapLabel())}</span></div>
        <div class="pg-dial-row${zones ? '' : ' unset'}"><span class="pg-dial-unit">Zones</span>
          <span class="pg-dial-set">${esc(this.cb.zoneLabel())}</span></div>
      </div>
      <div class="pg-units">
        <button class="pg-unit${mission ? '' : ' warn'}" data-pick-mission="1">${
          mission ? 'Change the Main Task' : 'Choose a Main Task'
        }</button>
        <button class="pg-unit${ready ? '' : ' warn'}" data-lock-map="1"${
          ready ? '' : ' disabled title="Choose a Main Task first"'
        }>Lock the battlefield</button>
      </div>
      <p class="pg-intercept-note">${
        !mission
          ? 'Start with the Main Task. It draws its own tactical zones and Deployment Zones, so the board is ready for the Tasks that come next.'
          : zones
            ? 'Both are fixed for the rest of the game once locked.'
            : 'No zone overlay is selected, so there are no Deployment Zones to place units into. Pick one from the Zones list in the toolbar.'
      }</p>`;
  }

  private rollHtml(s: GameState, su: SetupState): string {
    const both = su.rolls.s1.length && su.rolls.s2.length;
    const winner = firstPlayerFrom(su);
    // A tie sends both sides back to the dice, so the buttons have to read as
    // waiting on the player again rather than as already done.
    const tie = !!both && !winner;
    const line = (side: Side) => {
      const r = su.rolls[side];
      return `<div class="pg-roll-row">
        <button class="pg-unit${r.length && !tie ? ' warn' : ''}" data-roll="${side}">${
          tie ? `${squadLabel(side)} roll again` : `${squadLabel(side)} roll`
        }</button>
        <span class="pg-roll-res">${r.length ? `${rollTotal(r)} Hit${rollTotal(r) === 1 ? '' : 's'}` : 'not rolled'}</span>
      </div>`;
    };
    return `<p class="pg-active">Table edge and First Player <small>Both players roll 2 dice. Most Hits goes first and picks a board edge.</small></p>
      ${line('s1')}${line('s2')}
      ${
        both
          ? winner
            ? `${phaseDone(`${squadLabel(winner)} rolls higher and is First Player`)}<div class="pg-units"><button class="pg-unit" data-roll-accept="1">Continue</button></div>`
            : `<p class="pg-warn">A tie on ${rollTotal(su.rolls.s1)}. The rulebook gives no tie procedure, so press both roll buttons again.</p>`
          : ''
      }`;
  }

  // The printed order is 3.1.2 edge, then 3.1.3 Secondary Tasks, then 3.1.4
  // deployment, so the edge is free to pick straight after the roll and it is
  // DEPLOYMENT that waits for the tasks, not the other way round.
  private edgeHtml(s: GameState, su: SetupState): string {
    const fp = s.round.firstPlayer;
    return `<p class="pg-active">Now: <b class="side-${fp}">${squadLabel(fp)}</b>
        <small>As First Player, choose which edge of the board to play from.</small></p>
      <div class="pg-units">
        <button class="pg-unit" data-edge="white">Take the White side</button>
        <button class="pg-unit" data-edge="black">Take the Black side</button>
      </div>
      <p class="pg-intercept-note">The other side takes the opposite edge. Deployment Zones follow the edges, so this decides where each squad starts.</p>
      ${this.secondaryHtml(s)}`;
  }

  // Prepare Tasks (5.1 step 3): starting from the First Player, each side picks
  // one Secondary Task and shows it, then names whatever the card designates.
  private secondaryHtml(s: GameState): string {
    const tasks = normaliseTasks(s.tasks);
    const order: Side[] = s.round.firstPlayer === 's1' ? ['s1', 's2'] : ['s2', 's1'];
    const row = (side: Side) => {
      const card = tasks.secondary[side] ? this.data.secondary.find((c) => c.id === tasks.secondary[side]) : undefined;
      return `<button class="pg-unit${card ? '' : ' warn'}" data-secondary="${side}">
        ${squadLabel(side)}: ${card ? esc(card.name) : 'pick a Secondary Task'}</button>`;
    };
    return `<p class="pg-active" style="margin-top:12px">Secondary Tasks
        <small>One each, open information, ${squadLabel(order[0])} first.</small></p>
      <div class="pg-units">${row(order[0])}${row(order[1])}</div>`;
  }

  private deployHtml(s: GameState, su: SetupState): string {
    const fp = `<p class="pg-turn">First player: <b class="side-${s.round.firstPlayer}">${squadLabel(s.round.firstPlayer)}</b></p>`;
    const tasks = normaliseTasks(s.tasks);
    const secRow = !tasks.secondary.s1 || !tasks.secondary.s2 ? this.secondaryHtml(s) : '';
    if (deploymentComplete(s)) {
      return `${fp}${phaseDone('Everything is deployed')}
        <div class="pg-units"><button class="pg-unit" data-deploy-done="1">Begin round 1</button></div>`;
    }
    // Tasks come before deployment (3.1.3 then 3.1.4), so the placement list
    // holds back until both Secondary Tasks are on the table. This is what
    // stops the first placement from skipping past the task step entirely.
    if (secRow) {
      return `${fp}${secRow}
        <p class="pg-intercept-note">Both Secondary Tasks are picked before anything deploys, so each side knows what the other is playing for.</p>`;
    }
    const turn = deployTurn(s, su);
    if (!turn) return `${fp}${phaseDone('Everything is deployed')}`;
    const waiting = deployable(s, turn);
    const other: Side = turn === 's1' ? 's2' : 's1';
    const otherLeft = deployable(s, other).length;

    // A Mech chooses its Stance as it lands, and anything that can activate
    // Optical Camouflage may be deployed already in it (3.1.4, 4.12.2).
    const chosen = this.deploying ? waiting.find((t) => t.uid === this.deploying!.uid) : undefined;
    if (chosen && this.deploying) {
      const d = this.deploying;
      const camoOk = canActivateCamo(this.data, chosen);
      return `${fp}
        <p class="pg-active">Placing <b class="side-${turn}">${esc(chosen.label)}</b>
          <small>click a highlighted Grid in the ${su.edge[turn]} Deployment Zone</small></p>
        ${
          chosen.kind === 'mech'
            ? `<div class="pg-stances">${(['defensive', 'mobility', 'offensive'] as const)
                .map((x) => `<button class="pg-stance${d.stance === x ? ' sel' : ''}" data-dep-stance="${x}">${x[0].toUpperCase()}${x.slice(1)}</button>`)
                .join('')}</div>`
            : ''
        }
        ${
          camoOk
            ? `<div class="pg-units"><button class="pg-unit${d.camo ? '' : ' warn'}" data-dep-camo="1">${
                d.camo ? '✓ Deploying hidden' : 'Deploy in Optical Camouflage'
              }</button></div>`
            : ''
        }
        <div class="pg-units"><button class="pg-pass" data-dep-cancel="1">Pick a different unit</button></div>
        <p class="pg-intercept-note">${
          chosen.kind === 'mech' ? 'A Mech with no Stance Token counts as Offensive. ' : ''
        }${
          camoOk
            ? 'This unit can activate Optical Camouflage, so it may start the game already in it.'
            : 'Nothing this unit carries activates Optical Camouflage, so it deploys in the open.'
        }</p>`;
    }

    return `${fp}
      ${secRow}
      <p class="pg-active">Now: <b class="side-${turn}">${squadLabel(turn)}</b>
        <small>place one unit in the ${su.edge[turn]} Deployment Zone · ${waiting.length} left${
          otherLeft ? '' : `, then ${squadLabel(turn)} places the rest`
        }</small></p>
      <div class="pg-acts">${waiting
        .map(
          (t) => `<button class="pg-act" data-place="${t.uid}" title="Place ${esc(t.label)} in the ${su.edge[turn]} Deployment Zone">
            <span class="pg-act-name">${esc(t.label)}</span>
            <span class="pg-act-cost">${t.kind === 'mech' ? 'MECH' : 'DRONE'}</span>
          </button>`,
        )
        .join('')}</div>
      <p class="pg-intercept-note">Each unit goes wholly inside one unoccupied Grid of your own zone. Mechs pick a Stance as they land, and anything that can start hidden may deploy in Optical Camouflage.</p>`;
  }

  // ---------- planning phase (rulebook 3.3) ----------

  private planningHtml(s: GameState): string {
    const sc = this.script(s);
    const fp = `<p class="pg-turn">First player: <b class="side-${s.round.firstPlayer}">${squadLabel(s.round.firstPlayer)}</b></p>`;
    const mechs = s.tokens.filter((t) => t.kind === 'mech' && alive(t));
    if (!mechs.length) return `${fp}<p class="pg-done-note">No Mechs on the board, so there are no dials to set.</p>`;
    const unset = mechs.filter((t) => !t.timing);
    if (sc.stage === `${s.round.n}:1:locked`) {
      return `${fp}${phaseDone('Timings locked in')}
        <div class="pg-dials">${mechs
          .map(
            (t) => `<div class="pg-dial-row"><span class="pg-dial-unit side-${t.side}">${esc(t.label)}</span>
              <span class="pg-dial-set">${TIMINGS.find((x) => x.id === t.timing)?.name ?? 'none'}</span></div>`,
          )
          .join('')}</div>`;
    }
    return `${fp}
      <p class="pg-active">Set a Timing Dial on every Mech <small>${mechs.length - unset.length} of ${mechs.length} set. Both players reveal at once.</small></p>
      <div class="pg-dials">${mechs
        .map((t) => {
          const cur = TIMINGS.find((x) => x.id === t.timing);
          const init = t.timing ? this.init(t, t.timing) : undefined;
          return `<div class="pg-dial-row${t.timing ? '' : ' unset'}">
            <button class="pg-dial-unit side-${t.side}" data-dial="${t.uid}" title="Jump to this Mech's dial in the Squads tab">${esc(t.label)}</button>
            <span class="pg-dial-set">${cur ? `${cur.name}${init === undefined ? '' : ` · Init ${init}`}` : 'not set'}</span>
          </div>`;
        })
        .join('')}</div>
      <div class="pg-units">
        <button class="pg-unit${unset.length ? ' warn' : ''}" data-lock-dials="1" data-tip-title="Confirm timings" data-tip="${
          unset.length
            ? `${unset.length} Mech${unset.length === 1 ? '' : 's'} still has no dial and would not activate at all.|Set every dial in the Squads tab before locking in.`
            : 'Lock the dials in and move on.'
        }">Confirm timings</button>
      </div>`;
  }

  // ---------- action phase (rulebook 3.4) ----------

  private tickActions(t: Token): { action: CardAction; label: string; note?: string; blocked?: string }[] {
    const out: { action: CardAction; label: string; note?: string; blocked?: string }[] = [];
    // An Extra Opportunity cannot hand out another one, or two Coordinating
    // Mechs would keep granting each other Opportunities for the rest of the
    // Round. The card carries the suppression itself.
    const onExtra = !!this.state && onExtraOpportunity(this.state, t.uid);
    for (const ga of guidedActions(this.data, t, this.cb.world())) {
      if (!lengthOf(ga.action)) continue;
      const chained = onExtra && extraActivationOf(ga.action)?.suppressGrants;
      out.push({
        action: ga.action,
        label: ga.action.name.en || ga.action.name.zh || ga.action.id,
        note: SLOT_LABEL[ga.slot],
        blocked: chained
          ? 'This is already an Extra Action Opportunity, and it cannot grant another one.'
          : ga.available ? undefined : ga.reason,
      });
    }
    const slots = new Set(
      Object.entries(t.partStates)
        .filter(([, v]) => v !== 'destroyed')
        .map(([k]) => k),
    );
    const hasTerminals = normaliseTasks(this.state?.tasks).items.some((i) => i.kind === 'terminal');
    for (const c of this.data.commonActions) {
      if (c.phase) continue;
      if (c.id === 'COMMON_REMOTE_ACCESS' && !hasTerminals) continue;
      const usable = c.slots.some((x) => slots.has(x));
      out.push({
        action: c,
        label: c.name.en || c.id,
        note: 'Common',
        blocked: usable ? undefined : 'no surviving Part can initiate it',
      });
    }
    return out;
  }

  private extrasFor(t: Token): ExtraTick[] {
    const have = new Set(tokenCards(this.data, t).flatMap(({ card }) => (card.actions ?? []).map((a) => a.id)));
    return this.data.extraTicks
      .filter((g) => have.has(g.actionId))
      .map((g) => ({ id: g.actionId, label: g.label, timing: g.timing as Timing, check: g.check }));
  }

  private opportunity(s: GameState): Opportunity | null {
    const sc = this.script(s);
    const next = nextActivation(s, this.init);
    if (!next) return null;
    if (sc.opp && sc.opp.uid === next.uid) return sc.opp;
    const t = s.tokens.find((x) => x.uid === next.uid);
    const fresh = newOpportunity(next.uid, next.timing);
    fresh.extras = t ? this.extrasFor(t) : [];
    sc.opp = fresh;
    return fresh;
  }

  private actionHtml(s: GameState): string {
    const fp = `<p class="pg-turn">First player: <b class="side-${s.round.firstPlayer}">${squadLabel(s.round.firstPlayer)}</b></p>`;
    const order = activationOrder(s, this.init);
    if (!order.length) {
      return `${fp}<p class="pg-done-note">No Mech has a Timing Dial set, so nobody activates. Set the dials in the Planning Phase, or step past this phase.</p>`;
    }
    const o = this.opportunity(s);
    if (!o) return `${fp}${phaseDone('Every Mech has had its Action Opportunity')}`;
    const t = s.tokens.find((x) => x.uid === o.uid);
    if (!t) return `${fp}<p class="pg-done-note">The active Mech is no longer on the board.</p>`;

    const done = new Set(this.script(s).acted);
    const at = order.findIndex((a) => a.uid === o.uid);
    const upNext = order.slice(at + 1).find((a) => !done.has(a.uid));
    const timing = TIMINGS.find((x) => x.id === o.timing);
    const init = o.timing ? this.init(t, o.timing) : undefined;

    const pip = (on: boolean) => `<i class="pip${on ? '' : ' off'}"></i>`;
    const live = extrasLeft(o);
    // A grant whose condition has lapsed reads as unavailable rather than spent,
    // and the title says which condition, since the pip alone cannot.
    const extraPip = (x: ExtraTick) => {
      if (o.spentExtras.includes(x.id)) return pip(false);
      return grantHolds(o, x) ? `<i class="pip" title="${esc(x.label)}"></i>` : `<i class="pip off lapsed" title="${esc(whyGrantLapsed(x))}"></i>`;
    };
    const pool = `<div class="pg-ticks">
      <span class="pips pips-man${o.maneuver ? '' : ' spent'}"><b class="pip-label">MAN</b>${pip(o.maneuver > 0)}</span>
      <span class="pips pips-act${o.action ? '' : ' spent'}"><b class="pip-label">ACT</b>${pip(o.action > 0)}${pip(o.action > 1)}</span>
      ${o.extras.length ? `<span class="pips pips-extra${live.length ? '' : ' spent'}"><b class="pip-label">XTR</b>${o.extras.map(extraPip).join('')}</span>` : ''}
    </div>`;

    const shutdown = t.stance === 'shutdown';
    const stanceRow =
      !o.maneuvered && !o.started && !shutdown
        ? `<div class="pg-stances">${(['defensive', 'mobility', 'offensive'] as const)
            .map((x) => `<button class="pg-stance${t.stance === x ? ' sel' : ''}" data-stance="${x}">${x[0].toUpperCase()}${x.slice(1)}</button>`)
            .join('')}</div>`
        : '';
    const rebootRow = shutdown
      ? `<p class="pg-warn">${esc(t.label)} is in Shutdown Stance, so Reboot is the only thing it may do. It cannot Maneuver and no other Action is legal (4.1.1).</p>
         <div class="pg-stances">${(['defensive', 'mobility', 'offensive'] as const)
            .map((x) => `<button class="pg-stance" data-reboot="${x}" data-mech="reboot">Reboot to ${x[0].toUpperCase()}${x.slice(1)}</button>`)
            .join('')}</div>`
      : '';

    const man = canManeuver(o);
    const range = maneuverRange(this.data, t);
    const rows = this.tickActions(t)
      .map((r) => {
        const v = canPerform(o, r.action);
        const why = r.blocked ?? (v.ok ? undefined : v.why);
        const cost = costOf(r.action)!;
        const len = LENGTH_NAME[lengthOf(r.action)!];
        return `<button class="pg-act${why ? ' warn' : ''}" data-act="${r.action.id}" title="${esc(why ?? `${len}: ${costLabel(cost)}`)}">
          <span class="pg-act-name">${esc(r.label)}</span>
          <span class="pg-act-cost">${v.extra ? 'XTR' : `${cost.maneuver ? 'M' : ''}${'●'.repeat(cost.action)}`}</span>
        </button>`;
      })
      .join('');

    const onExtra = onExtraOpportunity(s, o.uid);
    const ovl = this.hasOverload(t) ? canOverload(o, t.link ?? 0) : null;
    const ovlTip = ovl?.ok
      ? `Consume 1 Link for 1 Action Tick, up to ${OVERLOAD_MAX} an Action Opportunity. These are ordinary Action Ticks, so two of them pay for one Medium Action.`
      : ovl?.why ?? '';
    const maneuverRow = shutdown
      ? ''
      : `<div class="pg-units">
        <button class="pg-unit${man.ok ? '' : ' warn'}" data-maneuver="1" data-tip-title="Maneuver" data-tip="${esc(man.ok ? `Move up to ${range} Grid${range === 1 ? '' : 's'}. Maneuver is free once per Action Opportunity.` : man.why ?? '')}">Maneuver ${range}</button>
        ${ovl ? `<button class="pg-unit${ovl.ok ? '' : ' warn'}" data-overload="1" data-tip-title="Overload" data-tip="${esc(ovlTip)}">Overload ${o.overload}/${OVERLOAD_MAX}</button>` : ''}
      </div>`;
    const actionRows = shutdown
      ? ''
      : `<div class="pg-acts">${rows || '<p class="pg-done-note">This Mech has no Action that costs Ticks.</p>'}</div>`;

    return `${fp}
      <p class="pg-active">Now: <b class="side-${t.side}">${squadLabel(t.side)}</b>
        <small>${esc(t.label)} · ${timing?.name ?? 'no dial'}${init === undefined ? '' : ` · Initiative ${init}`} · ${onExtra ? 'Extra Action Opportunity' : `${at + 1} of ${order.length}`}</small></p>
      ${pool}
      ${this.warn ? `<p class="pg-warn">${esc(this.warn)}</p>` : ''}
      ${stanceRow}
      ${rebootRow}
      ${maneuverRow}
      ${actionRows}
      <div class="pg-units">
        <button class="pg-pass" data-end="1">End activation</button>
      </div>
      ${upNext ? `<p class="pg-next-up">Up next: ${esc(s.tokens.find((x) => x.uid === upNext.uid)?.label ?? '?')} <small>${TIMINGS.find((x) => x.id === upNext.timing)?.name}</small></p>` : ''}`;
  }

  // A Drone printed at 0 points carries the Low Value tag; Projectiles are Low
  // Value by default (p.82). Shared with the secondary-task scoring so a unit
  // cannot be Low Value for one Task and not for another.
  private lowValue = (t: Token): boolean =>
    t.kind === 'projectile' || (t.kind === 'drone' && (this.data.byId.get(t.cardId)?.score ?? 0) === 0);

  private refreshControl(s: GameState, tasks: TaskState): void {
    settleControl(tasks, (zone) => this.data.zoneData.zones.find((z) => z.id === zone)?.cells ?? [], s.tokens, this.lowValue);
  }

  private previewScore(s: GameState, tasks: TaskState, mission: MissionCard | undefined, finalRound: boolean): ScoreResult {
    this.refreshControl(s, tasks);
    const cells = (zone: string) => this.data.zoneData.zones.find((z) => z.id === zone)?.cells ?? [];
    const all: ScoreLine[] = [];
    if (mission) all.push(...this.mainScore(s, tasks, mission, finalRound).lines);
    for (const side of ['s1', 's2'] as Side[]) {
      const id = tasks.secondary[side];
      const card = id ? this.data.secondary.find((c) => c.id === id) : undefined;
      if (!card?.kind) continue;
      all.push(...scoreSecondary(
        { id: card.id, name: card.name, vp: card.vp ?? 0, kind: card.kind as SecondaryScoring['kind'] },
        side, tasks, s.tokens, cells, finalRound, this.lowValue,
      ).lines);
    }
    const open = unpaidLines(all, tasks.scored);
    let s1 = 0;
    let s2 = 0;
    for (const l of open) {
      if (l.side === 's1') s1 += l.vp;
      else s2 += l.vp;
    }
    return { lines: open, s1, s2 };
  }

  private mainScore(s: GameState, tasks: TaskState, mission: MissionCard, finalRound: boolean): ScoreResult {
    return scoreMain(
      {
        family: (mission.family as 'blackbox' | 'control' | 'terminal' | 'vip'),
        vp: mission.vp ?? 0,
        zones: mission.zones ?? [],
        fromRound: mission.fromRound ?? 1,
        cadence: mission.cadence ?? 'per-round',
      },
      tasks,
      s.tokens,
      s.round.n,
      finalRound,
    );
  }

  private settleTasks(s: GameState): void {
    const tasks = normaliseTasks(s.tasks);
    this.refreshControl(s, tasks);
    s.tasks = tasks;
  }

  // The scoring judgement stays here, where the mission logic lives; the
  // command carries the resulting numbers, so a mirrored seat applies the
  // same Award without re-deriving it.
  private awardScore(): void {
    const s = this.state;
    if (!s) return;
    const mission = this.data.missions.cards.find((c) => c.id === s.mission);
    const last = s.round.n >= (s.roundLimit ?? 5);
    const got = this.previewScore(s, normaliseTasks(s.tasks), mission, last);
    perform(this.data, s, {
      kind: 'award',
      seat: this.script(s).turn,
      vp: { s1: got.s1, s2: got.s2 },
      keys: got.lines.map((l) => l.key).filter((k): k is string => !!k),
    });
    this.cb.onChanged();
  }

  // Stabilize System (6.1): Torso removes 1 Square or Hexagon Token from this
  // Mech, then restores 1 Link.
  private stabilise(uid: number): void {
    const s = this.state;
    const t = s?.tokens.find((x) => x.uid === uid);
    if (!s || !t) return;
    const shed = (t.statuses ?? []).find((id) => {
      const d = STATUSES.find((x) => x.id === id);
      return d?.shape === 'square' || d?.shape === 'hexagon';
    });
    if (!shed) return;
    perform(this.data, s, { kind: 'stabilise', seat: t.side, uid });
    const label = STATUSES.find((x) => x.id === shed)?.label ?? shed;
    this.cb.onNote(t, `Stabilize System: ${label} removed and Link restored to ${t.link}.`);
    this.cb.onChanged();
  }

  // Reveal (6.1): leave the Optical Camouflage State, then make Manifestation
  // Movement, which the player performs by hand up to the unit's Stealth value.
  private revealUnit(uid: number): void {
    const s = this.state;
    const t = s?.tokens.find((x) => x.uid === uid);
    if (!s || !t) return;
    perform(this.data, s, { kind: 'reveal', seat: t.side, uid });
    this.cb.onSelectUnit(t.uid);
    this.cb.onNote(t, `Reveal: out of the Optical Camouflage State. Now make Manifestation Movement, up to this unit's Stealth value, to where it really is.`);
    this.cb.onChanged();
  }

  private reboot(stance: Stance): void {
    const s = this.state;
    if (!s) return;
    const first = this.opportunity(s);
    const t = first && s.tokens.find((x) => x.uid === first.uid);
    if (!first || !t) return;
    perform(this.data, s, { kind: 'reboot', seat: t.side, uid: t.uid, stance });
    this.warn = null;
    this.cb.onNote(t, `Reboot: out of Shutdown into ${stance} Stance, Link restored to ${t.link}. One Action Tick is left and it must match the dial.`);
    this.cb.onChanged();
  }

  private tryManeuver(): void {
    const s = this.state;
    if (!s) return;
    const o = this.opportunity(s);
    if (!o) return;
    const t = s.tokens.find((x) => x.uid === o.uid);
    if (!t) return;
    const v = canManeuver(o);
    if (!v.ok) {
      this.warn = v.why ?? null;
      this.render();
      return;
    }
    this.warn = null;
    this.cb.onMoveUnit(o.uid, { range: maneuverRange(this.data, t), label: 'Maneuver' }, (moved) => {
      if (!moved) return;
      // The interactive move has already landed the token, so the command
      // records where it ended up: a no-op here, the real move on a mirror.
      perform(this.data, s, { kind: 'maneuver', seat: t.side, uid: t.uid, to: { col: t.col, row: t.row }, facing: t.facing });
      this.cb.onChanged();
    });
  }

  // Range is counted the same way the rest of the app counts it: Manhattan
  // distance on the Large Grid.
  private gridsApart(a: Token, b: Token): number {
    return Math.abs(Math.floor(a.col / 3) - Math.floor(b.col / 3))
      + Math.abs(Math.floor(a.row / 3) - Math.floor(b.row / 3));
  }

  private async grantExtraOpportunity(s: GameState, from: Token, g: ExtraActivation): Promise<void> {
    const targets = s.tokens.filter(
      (t) => t.kind === 'mech'
        && t.side === from.side
        && t.deployed !== false
        && alive(t)
        && (!g.excludeSelf || t.uid !== from.uid)
        && this.gridsApart(from, t) <= g.range,
    );
    // The card refuses a Mech that could not pay, so a target too low on Link is
    // shown and disabled rather than hidden: a player needs to see why.
    const choices = targets.map((t) => ({
      id: String(t.uid),
      label: `${t.label} — Link ${t.link ?? 0}${(t.link ?? 0) < g.minimumLink ? ` (needs ${g.minimumLink})` : ''}`,
      disabled: (t.link ?? 0) < g.minimumLink,
      note: `This Mech needs at least ${g.minimumLink} Link to be chosen.`,
    }));
    if (!choices.some((c) => !c.disabled)) {
      this.warn = `No Ally Mech within Range ${g.range} has the ${g.minimumLink} Link this needs.`;
      this.render();
      return;
    }
    // choiceDialog treats the last choice as the Escape and backdrop target, so
    // the cancel is spelled out rather than left to whichever Mech sorts last.
    const id = await choiceDialog({
      title: 'Coordinate: which Ally Mech?',
      body: `That Mech pays ${g.linkCost} Link and takes an Extra Action Opportunity once the normal order is through.`,
      choices: [...choices, { id: 'cancel', label: 'Cancel' }],
    });
    const pick = targets.find((t) => String(t.uid) === id);
    if (!pick) {
      this.render();
      return;
    }
    perform(this.data, s, { kind: 'grantExtra', seat: pick.side, uid: pick.uid, linkCost: g.linkCost });
    this.cb.onNote(pick, `Coordinate: pays ${g.linkCost} Link (now ${pick.link}) and is owed an Extra Action Opportunity.`);
    this.cb.onChanged();
  }

  private hasOverload(t: Token): boolean {
    const ids = new Set(this.data.overload.map((g) => g.actionId));
    return tokenCards(this.data, t).some(({ card }) => (card.actions ?? []).some((a) => ids.has(a.id)));
  }

  // Link bought as Ticks is Link the Mech no longer has, and a Mech on 0 Link
  // Shuts Down. The Pack does not exempt it, so the guide spends the Link and
  // reports the Shutdown rather than quietly refusing the last point.
  private tryOverload(): void {
    const s = this.state;
    if (!s) return;
    const o = this.opportunity(s);
    if (!o) return;
    const t = s.tokens.find((x) => x.uid === o.uid);
    if (!t) return;
    const v = canOverload(o, t.link ?? 0);
    if (!v.ok) {
      this.warn = v.why ?? null;
      this.render();
      return;
    }
    this.warn = null;
    const wasShut = t.stance === 'shutdown';
    perform(this.data, s, { kind: 'overload', seat: t.side, uid: t.uid });
    const sc = this.script(s);
    this.cb.onNote(t, `Overload: consumed 1 Link for 1 Action Tick (Link now ${t.link}, ${sc.opp?.overload ?? '?'} of ${OVERLOAD_MAX} used).`);
    if (!wasShut && t.stance === 'shutdown') {
      this.cb.onNote(t, `Link has reached 0, so ${t.label} SHUTS DOWN.`);
    }
    this.cb.onChanged();
  }

  // Warn rather than block: the rules have more exceptions than the app knows, so
  // the guide says what is wrong and lets you overrule it.
  private tryAction(actionId: string): void {
    const s = this.state;
    if (!s) return;
    const o = this.opportunity(s);
    if (!o) return;
    const t = s.tokens.find((x) => x.uid === o.uid);
    if (!t) return;
    const row = this.tickActions(t).find((r) => r.action.id === actionId);
    if (!row) return;
    const why = row.blocked ?? (canPerform(o, row.action).ok ? undefined : canPerform(o, row.action).why);
    if (why && this.warn !== why) {
      this.warn = why;
      this.render();
      return;
    }
    this.warn = null;
    // The Tick is only spent if the action actually goes through, so backing out
    // of a target pick or a move costs nothing.
    this.cb.onPerformAction(o.uid, actionId, (performed) => {
      if (!performed) {
        this.render();
        return;
      }
      perform(this.data, s, { kind: 'performAction', seat: t.side, uid: t.uid, actionId: row.action.id });
      this.cb.onNote(t, `${row.label} (${LENGTH_NAME[lengthOf(row.action)!]}, ${costLabel(costOf(row.action)!)}).`);
      const grant = extraActivationOf(row.action);
      if (grant) {
        void this.grantExtraOpportunity(s, t, grant);
        return;
      }
      this.cb.onChanged();
    });
  }

  private endActivation(): void {
    const s = this.state;
    if (!s) return;
    const o = this.opportunity(s);
    if (!o) return;
    const t = s.tokens.find((x) => x.uid === o.uid);
    if (!t) return;
    perform(this.data, s, { kind: 'endOpportunity', seat: t.side, uid: o.uid });
    this.warn = null;
    this.cb.onChanged();
  }

  // What this unit may actually do in this phase. A Drone action carries a
  // control mode: [Command] ones need a Command, [Automatic] ones fire in the
  // Automatic Phase, and Passive ones are always on and never chosen (2.4.1).
  // A Projectile or Deployable offers its Delayed Action instead (3.6.2).
  private phaseActions(
    t: Token,
    phase: LoopPhase,
  ): { action: CardAction; label: string; tag: string; note: string; blocked?: string }[] {
    const want = phase === 'Command' ? 'command' : phase === 'Automatic' ? 'auto' : null;
    const out: { action: CardAction; label: string; tag: string; note: string; blocked?: string }[] = [];
    for (const ga of guidedActions(this.data, t, this.cb.world())) {
      const a = ga.action;
      // In the Delay Phase a Projectile performs whatever action it carries
      // (3.6.2). The card data types these four ways: Delay, Tactic (guided
      // attacks, mortar shells), and Immediate (detonate-on-landing grenades,
      // which mostly resolve at launch but can still be waiting here). Passive
      // is always on and never chosen.
      if (want) {
        if (a.speed !== want) continue;
      } else if (a.type === 'Passive' || a.speed === 'passive') {
        continue;
      }
      const ammo = ga.ammoLeft;
      out.push({
        action: a,
        label: a.name.en || a.name.zh || a.id,
        tag: ammo === undefined ? (a.type ?? '') : `${ammo}/${a.storage ?? 0}`,
        note: phase === 'Automatic'
          ? 'Automatic Actions are obligatory and take the nearest legal enemy unless the text says otherwise (3.5.2).'
          : `${a.type ?? 'Action'} action${a.range ? `, range ${a.range}` : ''}.`,
        blocked: ga.available ? undefined : ga.reason,
      });
    }
    return out;
  }

  private performUnitAction(uid: number, actionId: string): void {
    const s = this.state;
    if (!s) return;
    const unit = s.tokens.find((x) => x.uid === uid);
    const ga = unit && guidedActions(this.data, unit, this.cb.world()).find((g) => g.action.id === actionId);
    const why = ga && !ga.available ? ga.reason ?? null : null;
    if (why && this.warn !== why) {
      this.warn = why;
      this.render();
      return;
    }
    this.warn = null;
    this.cb.onPerformAction(uid, actionId, (performed) => {
      if (!performed) return;
      const t = s.tokens.find((x) => x.uid === uid);
      const a = t && guidedActions(this.data, t, this.cb.world()).find((g) => g.action.id === actionId)?.action;
      if (t && a) this.cb.onNote(t, `${a.name.en || a.name.zh || a.id}.`);
      this.finishDesignation(uid);
    });
  }

  private loopHtml(s: GameState, phase: string): string {
    const sc = this.script(s);
    const fp = `<p class="pg-turn">First player: <b class="side-${s.round.firstPlayer}">${squadLabel(s.round.firstPlayer)}</b></p>`;
    if (!isLoopPhase(phase)) return fp;

    const tokens =
      phase === 'Command'
        ? `<p class="pg-tokens">Command tokens: <b class="side-s1">${squadLabel('s1')} ${s.commandTokens.s1}</b> · <b class="side-s2">${squadLabel('s2')} ${s.commandTokens.s2}</b></p>`
        : '';

    if (loopComplete(s, phase)) {
      return `${fp}${tokens}${phaseDone(`${phase} Phase complete`)}`;
    }

    const turn = canAct(s, phase, sc.turn) ? sc.turn : (nextTurn(s, phase, sc.turn) ?? sc.turn);
    const units = eligibleUnits(s, phase, turn);

    const chosen = this.picked !== null ? units.find((t) => t.uid === this.picked) : undefined;
    if (chosen) {
      const what = phase === 'Command' ? 'It may move, or take one Command action.' : 'Resolve its action, then mark it done.';
      const own = this.phaseActions(chosen, phase);
      // A Drone's attack is usually an Automatic Action, so it is absent here by
      // design. Say where it went rather than leaving an empty list.
      const elsewhere = own.length
        ? ''
        : guidedActions(this.data, chosen, this.cb.world())
            .filter((g) => g.action.speed && g.action.speed !== 'passive')
            .map((g) => g.action.speed)
            .filter((sp, i, all) => all.indexOf(sp) === i)
            .filter((sp) => sp !== (phase === 'Command' ? 'command' : 'auto'))
            .map((sp) => (sp === 'auto' ? 'Automatic' : 'Command'))
            .join(' and ');
      const list = own.length
        ? `<div class="pg-acts">${own
            .map(
              (r) => `<button class="pg-act${r.blocked ? ' warn' : ''}" data-unit-act="${r.action.id}" title="${esc(r.blocked ?? r.note)}">
                <span class="pg-act-name">${esc(r.label)}</span>
                <span class="pg-act-cost">${esc(r.tag)}</span>
              </button>`,
            )
            .join('')}</div>`
        : '';
      return `${fp}${tokens}
        <p class="pg-active">Now: <b class="side-${turn}">${squadLabel(turn)}</b>
          <small>${chosen.label}: ${what}</small></p>
        ${this.warn ? `<p class="pg-warn">${esc(this.warn)}</p>` : ''}
        ${list}
        ${
          elsewhere && phase === 'Command'
            ? `<p class="pg-intercept-note">This Drone has no Command Action. Its actions are marked <b>!</b> on the card, meaning Automatic: they fire by themselves in the Automatic Phase. A Command can only move it, and a Drone that acts on a Command does not act again that round, so commanding it here costs that attack.</p>`
            : elsewhere
              ? `<p class="pg-intercept-note">Nothing to choose in this phase. This unit's actions are ${esc(elsewhere)} Actions, offered in the ${esc(elsewhere)} Phase.</p>`
              : ''
        }
        <div class="pg-units">
          ${
            phase === 'Command'
              ? `<button class="pg-unit" data-move="${chosen.uid}">Move</button>`
              : ''
          }
          <button class="pg-pass" data-acted="${chosen.uid}" title="Mark this unit done without the guide driving the action">Did it myself</button>
          <button class="pg-pass" data-unpick="1">Back</button>
        </div>`;
    }

    const verb = phase === 'Command' ? 'command' : 'activate';
    const noun = phase === 'Delay' ? 'projectile' : 'drone';
    return `${fp}${tokens}
      <p class="pg-active">Now: <b class="side-${turn}">${squadLabel(turn)}</b>
        <small>pick a ${noun} to ${verb}</small></p>
      <div class="pg-units">
        ${units
          .map((t) => `<button class="pg-unit" data-designate="${t.uid}">${t.label}</button>`)
          .join('')}
        <button class="pg-pass" data-pass="1" title="This side is done for the phase">Pass</button>
      </div>`;
  }

  private designate(uid: number): void {
    const s = this.state;
    if (!s) return;
    const phase = PHASES[s.round.phase];
    if (!isLoopPhase(phase)) return;
    this.picked = uid;
    this.warn = null;
    this.cb.onSelectUnit(uid);
    this.render();
  }

  private finishDesignation(uid: number): void {
    const s = this.state;
    if (!s) return;
    const phase = PHASES[s.round.phase];
    if (!isLoopPhase(phase)) return;
    const unit = s.tokens.find((t) => t.uid === uid);
    if (!unit) return;
    perform(this.data, s, { kind: 'designate', seat: unit.side, uid });
    this.picked = null;
    this.warn = null;
    this.cb.onChanged();
  }

  private pass(): void {
    const s = this.state;
    if (!s) return;
    const sc = this.script(s);
    const phase = PHASES[s.round.phase];
    if (!isLoopPhase(phase)) return;
    // The pass belongs to whoever's turn it actually is, so a stale turn
    // pointer is normalised before the command is issued.
    const turn = canAct(s, phase, sc.turn) ? sc.turn : (nextTurn(s, phase, sc.turn) ?? sc.turn);
    perform(this.data, s, { kind: 'passTurn', seat: turn });
    this.cb.onChanged();
  }

  private place(): void {
    if (this.ui.x === null || this.ui.y === null) return;
    const r = this.host.getBoundingClientRect();
    const b = this.root.getBoundingClientRect();
    const left = Math.max(0, Math.min(this.ui.x - b.width, Math.max(0, r.width - b.width)));
    const top = Math.max(0, Math.min(this.ui.y, Math.max(0, r.height - b.height)));
    this.root.style.left = `${left}px`;
    this.root.style.top = `${top}px`;
    this.root.style.right = 'auto';
    this.root.style.bottom = 'auto';
  }

  private attachDrag(): void {
    let from: { x: number; y: number; l: number; t: number } | null = null;
    const move = (ev: PointerEvent) => {
      if (!from) return;
      this.ui.x = from.l + (ev.clientX - from.x);
      this.ui.y = from.t + (ev.clientY - from.y);
      this.place();
    };
    const up = () => {
      if (!from) return;
      from = null;
      this.saveUi();
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    this.root.addEventListener('pointerdown', (ev) => {
      const t = ev.target as HTMLElement;
      // Middle button drags from anywhere on the guide, which is the only way to
      // move it while it is collapsed to its button. The left button still only
      // drags by the header, so buttons there keep working.
      const middle = ev.button === 1;
      if (!middle) {
        if (!t.closest('.pg-grip') && !t.closest('.pg-head')) return;
        if (t.closest('button')) return;
      }
      const host = this.host.getBoundingClientRect();
      const b = this.root.getBoundingClientRect();
      from = { x: ev.clientX, y: ev.clientY, l: b.right - host.left, t: b.top - host.top };
      ev.preventDefault();
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    });
    // Middle press otherwise starts the browser's autoscroll, which hijacks the
    // drag and leaves a scroll cursor stuck over the board.
    this.root.addEventListener('auxclick', (ev) => {
      if (ev.button === 1) ev.preventDefault();
    });
  }
}
