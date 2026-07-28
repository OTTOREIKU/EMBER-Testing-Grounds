import type { CardAction, ExtraTick, GameState, Opportunity, ScriptState, Side, Stance, Timing, Token } from './types';
import { newOpportunity, normaliseScript, TIMINGS } from './types';
import type { GameData } from './data';
import { SIDE_LABEL } from './data';
import { PHASES, PHASE_INFO } from './tracker';
import { canActivateCamo, guidedActions, initiativeFor, maneuverRange, SLOT_LABEL, tokenCards } from './units';
import { canManeuver, canPerform, costLabel, costOf, LENGTH_NAME, lengthOf, spendAction, spendManeuver } from './ticks';
import { deployable, deploymentComplete, deployTurn, firstPlayerFrom, newSetup, normaliseSetup, rollTotal, type SetupState } from './setup';

// A finished phase reads better as a single green marker than as a sentence.
function phaseDone(text: string): string {
  return `<p class="pg-complete"><i>✓</i><span>${text}</span></p>`;
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const UI_KEY = 'ember-playguide-ui-v2';

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

// ---------- alternating designation loops (rulebook 3.2.2, 3.5.1, 3.6.1) ----------

export const LOOP_PHASES = ['Command', 'Automatic', 'Delay'] as const;
export type LoopPhase = (typeof LOOP_PHASES)[number];

export function isLoopPhase(phase: string): phase is LoopPhase {
  return (LOOP_PHASES as readonly string[]).includes(phase);
}

function alive(t: Token): boolean {
  if (t.kind !== 'mech') return (t.partStates.main ?? 'intact') !== 'destroyed';
  return Object.values(t.partStates).filter((p) => p !== 'destroyed').length > 0;
}

export function commandTokensFor(state: GameState, side: Side): number {
  return state.tokens.filter((t) => t.side === side && t.kind === 'mech' && alive(t)).length;
}

// Who this side may still designate this phase. A Drone commanded during the
// Command Phase does not act again in the Automatic Phase (3.5).
export function eligibleUnits(state: GameState, phase: LoopPhase, side: Side): Token[] {
  const sc = state.script;
  if (!sc) return [];
  const acted = new Set(sc.acted);
  const commanded = new Set(sc.commanded);
  if (phase === 'Command') {
    if ((state.commandTokens[side] ?? 0) <= 0) return [];
    return state.tokens.filter((t) => t.side === side && t.kind === 'drone' && alive(t) && !commanded.has(t.uid));
  }
  if (phase === 'Automatic') {
    return state.tokens.filter(
      (t) => t.side === side && t.kind === 'drone' && alive(t) && !commanded.has(t.uid) && !acted.has(t.uid),
    );
  }
  return state.tokens.filter((t) => t.side === side && t.kind === 'projectile' && alive(t) && !acted.has(t.uid));
}

export function canAct(state: GameState, phase: LoopPhase, side: Side): boolean {
  const sc = state.script;
  if (!sc) return false;
  if (sc.passed.includes(side)) return false;
  return eligibleUnits(state, phase, side).length > 0;
}

export function loopComplete(state: GameState, phase: LoopPhase): boolean {
  return !canAct(state, phase, 'blue') && !canAct(state, phase, 'red');
}

// A player who passes is out for the phase, but the opponent may keep going, so
// the turn only alternates to a side that can still do something (3.2.2).
export function nextTurn(state: GameState, phase: LoopPhase, from: Side): Side | null {
  const other: Side = from === 'blue' ? 'red' : 'blue';
  if (canAct(state, phase, other)) return other;
  if (canAct(state, phase, from)) return from;
  return null;
}

// ---------- action phase activation order (rulebook 3.4.1) ----------

export interface Activation {
  uid: number;
  timing: Timing;
  init?: number;
}

export type InitLookup = (t: Token, timing: Timing) => number | undefined;

// Timing order never changes, and within one Timing the lowest Pilot Initiative
// goes first. Mechs tied on both belong to no natural order, so the First
// Player's Mech goes first and the sides alternate from there.
export function activationOrder(state: GameState, init: InitLookup): Activation[] {
  const mechs = state.tokens.filter((t) => t.kind === 'mech' && alive(t) && t.timing);
  const out: Activation[] = [];
  for (const def of TIMINGS) {
    const group = mechs
      .filter((t) => t.timing === def.id)
      .map((t) => ({ t, init: init(t, def.id) }));
    if (!group.length) continue;
    const values = [...new Set(group.map((g) => g.init))].sort(
      (a, b) => (a ?? Infinity) - (b ?? Infinity),
    );
    for (const v of values) {
      const tied = group.filter((g) => g.init === v);
      const mine = tied.filter((g) => g.t.side === state.round.firstPlayer);
      const theirs = tied.filter((g) => g.t.side !== state.round.firstPlayer);
      let turn = mine;
      while (mine.length || theirs.length) {
        const next = (turn.length ? turn : turn === mine ? theirs : mine).shift()!;
        out.push({ uid: next.t.uid, timing: def.id, init: next.init });
        turn = turn === mine ? theirs : mine;
      }
    }
  }
  return out;
}

// The next Mech still owed an Action Opportunity this phase.
export function nextActivation(state: GameState, init: InitLookup): Activation | null {
  const done = new Set(state.script?.acted ?? []);
  return activationOrder(state, init).find((a) => !done.has(a.uid)) ?? null;
}

export function actionPhaseComplete(state: GameState, init: InitLookup): boolean {
  return nextActivation(state, init) === null;
}

export interface GuideCallbacks {
  onAdvancePhase(): void;
  onSelectUnit(uid: number): void;
  onMoveUnit(uid: number, opts: { range?: number; label: string }, done: (moved: boolean) => void): void;
  onPerformAction(uid: number, actionId: string, done: (performed: boolean) => void): void;
  onSetStance(uid: number, stance: Stance): void;
  onIntercept(uid: number, actionId: string, targetUid: number): void;
  onRollFirstPlayer(side: Side): void;
  onPlaceUnit(uid: number, opts: { stance: Stance; camo: boolean }): void;
  onNote(t: Token, text: string): void;
  onChanged(): void;
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
    if (leaving === '0') s.commandTokens = { blue: 0, red: 0 };
    if (s.round.phase === 0) {
      s.commandTokens = { blue: commandTokensFor(s, 'blue'), red: commandTokensFor(s, 'red') };
      sc.commanded = [];
    }
    if (s.round.phase === 0 || s.round.phase === 2) sc.acted = [];
    // Ticks belong to one Action Opportunity, so none survives a phase change.
    sc.opp = null;
    sc.passed = [];
    sc.turn = s.round.firstPlayer;
    sc.stage = now;
    return true;
  }

  private render(): void {
    const s = this.state;
    if (!s) return;
    if (!this.ui.open) {
      this.root.className = 'closed';
      this.root.innerHTML = `<button class="pg-reopen" title="Show the play guide">Guide</button>`;
      this.root.querySelector('.pg-reopen')!.addEventListener('click', () => {
        this.ui.open = true;
        this.saveUi();
        this.render();
      });
      this.place();
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
        ${this.warn && phase === 'Planning' ? `<p class="pg-warn">${esc(this.warn)}</p>` : ''}
        ${
          this.setupState(s)
            ? this.setupHtml(s)
            : `${this.interceptHtml(s)}
        ${phase === 'Action' ? this.actionHtml(s) : phase === 'Planning' ? this.planningHtml(s) : this.loopHtml(s, phase)}`
        }
        <details class="pg-rules"${this.ui.rules ? ' open' : ''}>
          <summary>How this phase works</summary>
          <ul class="pg-steps">${info.lines.map((x) => `<li>${x}</li>`).join('')}</ul>
        </details>
      </div>
      <div class="pg-foot">
        <span class="pg-left">${info.sub.split('·').pop()?.trim() ?? ''}</span>
        <button class="pg-next"${
          phase === 'Planning' && this.script(s).stage !== `${s.round.n}:1:locked` ? ' disabled title="Confirm the timings first"' : ''
        }>${last ? `End round ${s.round.n}` : `Next: ${PHASES[s.round.phase + 1]}`}</button>
      </div>`;

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
    this.root.querySelector('[data-maneuver]')?.addEventListener('click', () => this.tryManeuver());
    this.root.querySelectorAll<HTMLButtonElement>('[data-act]').forEach((b) =>
      b.addEventListener('click', () => this.tryAction(b.dataset.act!)),
    );
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
        const su = normaliseSetup(s.setup) ?? newSetup();
        const mine = b.dataset.edge as 'black' | 'white';
        const fp = s.round.firstPlayer;
        const other: Side = fp === 'blue' ? 'red' : 'blue';
        s.setup = { ...su, stage: 'deploy', edge: { ...su.edge, [fp]: mine, [other]: mine === 'black' ? 'white' : 'black' } as SetupState['edge'] };
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
    this.root.querySelector('[data-deploy-done]')?.addEventListener('click', () => {
      const su = normaliseSetup(s.setup) ?? newSetup();
      s.setup = { ...su, stage: 'done' };
      this.cb.onChanged();
    });
    this.root.querySelectorAll<HTMLButtonElement>('[data-dial]').forEach((b) =>
      b.addEventListener('click', () => this.cb.onSelectUnit(Number(b.dataset.dial))),
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
      this.render();
    });
    this.root.querySelector('.pg-pass:not([data-unpick])')?.addEventListener('click', () => this.pass());

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
  private interceptHtml(s: GameState): string {
    const owed = this.script(s).intercepts;
    if (!owed.length) return '';
    const rows = owed
      .map((x, i) => {
        const by = s.tokens.find((t) => t.uid === x.uid);
        const at = s.tokens.find((t) => t.uid === x.targetUid);
        if (!by || !at) return '';
        return `<button class="pg-act" data-intercept="${i}" title="Interception attacks as a Firing Attack, but the target must be this unit, no Forward Arc is needed, line of sight always exists, and no Terrain or Unit Protection applies.">
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

  // ---------- pre-game setup (rulebook 3.1.2, 3.1.4) ----------

  // Re-arms the board picker with the current Stance and camouflage choice, so
  // changing either before clicking a Grid is picked up.
  private armPlacement(): void {
    const d = this.deploying;
    if (!d) return;
    this.render();
    this.cb.onPlaceUnit(d.uid, { stance: d.stance, camo: d.camo });
  }

  private setupState(s: GameState): SetupState | null {
    const su = normaliseSetup(s.setup);
    return su && su.stage !== 'done' ? su : null;
  }

  private setupHtml(s: GameState): string {
    const su = this.setupState(s)!;
    if (su.stage === 'roll') return this.rollHtml(s, su);
    if (su.stage === 'side') return this.edgeHtml(s, su);
    return this.deployHtml(s, su);
  }

  private rollHtml(s: GameState, su: SetupState): string {
    const line = (side: Side) => {
      const r = su.rolls[side];
      return `<div class="pg-roll-row">
        <button class="pg-unit${r.length ? ' warn' : ''}" data-roll="${side}">${SIDE_LABEL[side]} roll</button>
        <span class="pg-roll-res">${r.length ? `${rollTotal(r)} Hit${rollTotal(r) === 1 ? '' : 's'}` : 'not rolled'}</span>
      </div>`;
    };
    const both = su.rolls.blue.length && su.rolls.red.length;
    const winner = firstPlayerFrom(su);
    return `<p class="pg-active">Table edge and First Player <small>Both players roll 2 dice. Most Hits goes first and picks a board edge.</small></p>
      ${line('blue')}${line('red')}
      ${
        both
          ? winner
            ? `${phaseDone(`${SIDE_LABEL[winner]} rolls higher and is First Player`)}<div class="pg-units"><button class="pg-unit" data-roll-accept="1">Continue</button></div>`
            : `<p class="pg-warn">A tie. The rulebook gives no tie procedure, so both sides roll again.</p>`
          : ''
      }`;
  }

  private edgeHtml(s: GameState, su: SetupState): string {
    const fp = s.round.firstPlayer;
    return `<p class="pg-active">Now: <b class="side-${fp}">${SIDE_LABEL[fp]}</b>
        <small>As First Player, choose which edge of the board to play from.</small></p>
      <div class="pg-units">
        <button class="pg-unit" data-edge="white">Take the White side</button>
        <button class="pg-unit" data-edge="black">Take the Black side</button>
      </div>
      <p class="pg-intercept-note">The other side takes the opposite edge. Deployment Zones follow the edges, so this decides where each squad starts.</p>`;
  }

  private deployHtml(s: GameState, su: SetupState): string {
    const fp = `<p class="pg-turn">First player: <b class="side-${s.round.firstPlayer}">${SIDE_LABEL[s.round.firstPlayer]}</b></p>`;
    if (deploymentComplete(s)) {
      return `${fp}${phaseDone('Everything is deployed')}
        <div class="pg-units"><button class="pg-unit" data-deploy-done="1">Begin round 1</button></div>`;
    }
    const turn = deployTurn(s, su);
    if (!turn) return `${fp}${phaseDone('Everything is deployed')}`;
    const waiting = deployable(s, turn);
    const other: Side = turn === 'blue' ? 'red' : 'blue';
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
      <p class="pg-active">Now: <b class="side-${turn}">${SIDE_LABEL[turn]}</b>
        <small>place one unit in the ${su.edge[turn]} Deployment Zone · ${waiting.length} left${
          otherLeft ? '' : `, then ${SIDE_LABEL[turn]} places the rest`
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

  // Every Mech needs a Timing before the Action Phase can order anything, and a
  // Mech with no dial simply never activates, so the phase is not done until
  // they are all set and the player has said so.
  private planningHtml(s: GameState): string {
    const sc = this.script(s);
    const fp = `<p class="pg-turn">First player: <b class="side-${s.round.firstPlayer}">${SIDE_LABEL[s.round.firstPlayer]}</b></p>`;
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
            <button class="pg-dial-unit side-${t.side}" data-dial="${t.uid}" title="Open this Mech in the Squads tab to turn its dial">${esc(t.label)}</button>
            <span class="pg-dial-set">${cur ? `${cur.name}${init === undefined ? '' : ` · Init ${init}`}` : 'not set'}</span>
          </div>`;
        })
        .join('')}</div>
      <div class="pg-units">
        <button class="pg-unit${unset.length ? ' warn' : ''}" data-lock-dials="1" title="${
          unset.length
            ? `${unset.length} Mech${unset.length === 1 ? '' : 's'} still has no dial and would not activate at all.`
            : 'Lock the dials in and move on.'
        }">Confirm timings</button>
      </div>`;
  }

  // ---------- action phase (rulebook 3.4) ----------

  // Every Action a Mech could pay Ticks for: the ones printed on its Parts, plus
  // the Common Actions any Mech can initiate through a surviving Part.
  private tickActions(t: Token): { action: CardAction; label: string; note?: string; blocked?: string }[] {
    const out: { action: CardAction; label: string; note?: string; blocked?: string }[] = [];
    for (const ga of guidedActions(this.data, t)) {
      if (!lengthOf(ga.action)) continue;
      out.push({
        action: ga.action,
        label: ga.action.name.en || ga.action.name.zh || ga.action.id,
        note: SLOT_LABEL[ga.slot],
        blocked: ga.available ? undefined : ga.reason,
      });
    }
    const slots = new Set(
      Object.entries(t.partStates)
        .filter(([, v]) => v !== 'destroyed')
        .map(([k]) => k),
    );
    for (const c of this.data.commonActions) {
      if (c.phase) continue;
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
      .map((g) => ({ id: g.actionId, label: g.label, timing: g.timing as Timing }));
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
    const fp = `<p class="pg-turn">First player: <b class="side-${s.round.firstPlayer}">${SIDE_LABEL[s.round.firstPlayer]}</b></p>`;
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
    const extrasLeft = o.extras.filter((x) => !o.spentExtras.includes(x.id));
    const pool = `<div class="pg-ticks">
      <span class="pips pips-man${o.maneuver ? '' : ' spent'}"><b class="pip-label">MAN</b>${pip(o.maneuver > 0)}</span>
      <span class="pips pips-act${o.action ? '' : ' spent'}"><b class="pip-label">ACT</b>${pip(o.action > 0)}${pip(o.action > 1)}</span>
      ${o.extras.length ? `<span class="pips pips-extra${extrasLeft.length ? '' : ' spent'}"><b class="pip-label">XTR</b>${o.extras.map((x) => pip(!o.spentExtras.includes(x.id))).join('')}</span>` : ''}
    </div>`;

    // Stance is chosen before anything is spent, and a Shutdown Mech may only Reboot.
    const stanceRow =
      !o.maneuvered && !o.started && t.stance !== 'shutdown'
        ? `<div class="pg-stances">${(['defensive', 'mobility', 'offensive'] as const)
            .map((x) => `<button class="pg-stance${t.stance === x ? ' sel' : ''}" data-stance="${x}">${x[0].toUpperCase()}${x.slice(1)}</button>`)
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

    return `${fp}
      <p class="pg-active">Now: <b class="side-${t.side}">${SIDE_LABEL[t.side]}</b>
        <small>${esc(t.label)} · ${timing?.name ?? 'no dial'}${init === undefined ? '' : ` · Initiative ${init}`} · ${at + 1} of ${order.length}</small></p>
      ${pool}
      ${this.warn ? `<p class="pg-warn">${esc(this.warn)}</p>` : ''}
      ${stanceRow}
      <div class="pg-units">
        <button class="pg-unit${man.ok ? '' : ' warn'}" data-maneuver="1" title="${esc(man.ok ? `Maneuver up to ${range} Grid${range === 1 ? '' : 's'}` : man.why ?? '')}">Maneuver ${range}</button>
      </div>
      <div class="pg-acts">${rows || '<p class="pg-done-note">This Mech has no Action that costs Ticks.</p>'}</div>
      <div class="pg-units">
        <button class="pg-pass" data-end="1">End activation</button>
      </div>
      ${upNext ? `<p class="pg-next-up">Up next: ${esc(s.tokens.find((x) => x.uid === upNext.uid)?.label ?? '?')} <small>${TIMINGS.find((x) => x.id === upNext.timing)?.name}</small></p>` : ''}`;
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
      const sc = this.script(s);
      sc.opp = spendManeuver(o);
      this.cb.onChanged();
    });
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
      const sc = this.script(s);
      sc.opp = spendAction(o, row.action);
      this.cb.onNote(t, `${row.label} (${LENGTH_NAME[lengthOf(row.action)!]}, ${costLabel(costOf(row.action)!)}).`);
      this.cb.onChanged();
    });
  }

  private endActivation(): void {
    const s = this.state;
    if (!s) return;
    const sc = this.script(s);
    const o = this.opportunity(s);
    if (!o) return;
    if (!sc.acted.includes(o.uid)) sc.acted.push(o.uid);
    sc.opp = null;
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
    for (const ga of guidedActions(this.data, t)) {
      const a = ga.action;
      if (want ? a.speed !== want : a.type !== 'Delay') continue;
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
    this.cb.onPerformAction(uid, actionId, (performed) => {
      if (!performed) return;
      const t = s.tokens.find((x) => x.uid === uid);
      const a = t && guidedActions(this.data, t).find((g) => g.action.id === actionId)?.action;
      if (t && a) this.cb.onNote(t, `${a.name.en || a.name.zh || a.id}.`);
      this.finishDesignation(uid);
    });
  }

  private loopHtml(s: GameState, phase: string): string {
    const sc = this.script(s);
    const fp = `<p class="pg-turn">First player: <b class="side-${s.round.firstPlayer}">${SIDE_LABEL[s.round.firstPlayer]}</b></p>`;
    if (!isLoopPhase(phase)) return fp;

    const tokens =
      phase === 'Command'
        ? `<p class="pg-tokens">Command tokens: <b class="side-blue">${SIDE_LABEL.blue} ${s.commandTokens.blue}</b> · <b class="side-red">${SIDE_LABEL.red} ${s.commandTokens.red}</b></p>`
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
        <p class="pg-active">Now: <b class="side-${turn}">${SIDE_LABEL[turn]}</b>
          <small>${chosen.label}: ${what}</small></p>
        ${list}
        <div class="pg-units">
          <button class="pg-unit" data-move="${chosen.uid}">Move</button>
          <button class="pg-pass" data-acted="${chosen.uid}" title="Mark this unit done without the guide driving the action">Did it myself</button>
          <button class="pg-pass" data-unpick="1">Back</button>
        </div>`;
    }

    const verb = phase === 'Command' ? 'command' : 'activate';
    const noun = phase === 'Delay' ? 'projectile' : 'drone';
    return `${fp}${tokens}
      <p class="pg-active">Now: <b class="side-${turn}">${SIDE_LABEL[turn]}</b>
        <small>pick a ${noun} to ${verb}</small></p>
      <div class="pg-units">
        ${units
          .map((t) => `<button class="pg-unit" data-designate="${t.uid}">${t.label}</button>`)
          .join('')}
        <button class="pg-pass" title="This side is done for the phase">Pass</button>
      </div>`;
  }

  // Picking a unit does not end its go. A commanded Drone either moves or takes one
  // Command action (3.2.2), so the turn only passes once that choice is resolved.
  private designate(uid: number): void {
    const s = this.state;
    if (!s) return;
    const phase = PHASES[s.round.phase];
    if (!isLoopPhase(phase)) return;
    this.picked = uid;
    this.cb.onSelectUnit(uid);
    this.render();
  }

  private finishDesignation(uid: number): void {
    const s = this.state;
    if (!s) return;
    const sc = this.script(s);
    const phase = PHASES[s.round.phase];
    if (!isLoopPhase(phase)) return;
    const unit = s.tokens.find((t) => t.uid === uid);
    if (!unit) return;
    if (phase === 'Command') {
      s.commandTokens[unit.side] = Math.max(0, (s.commandTokens[unit.side] ?? 0) - 1);
      if (!sc.commanded.includes(uid)) sc.commanded.push(uid);
    } else if (!sc.acted.includes(uid)) {
      sc.acted.push(uid);
    }
    this.picked = null;
    sc.turn = nextTurn(s, phase, unit.side) ?? unit.side;
    this.cb.onChanged();
  }

  private pass(): void {
    const s = this.state;
    if (!s) return;
    const sc = this.script(s);
    const phase = PHASES[s.round.phase];
    if (!isLoopPhase(phase)) return;
    const turn = canAct(s, phase, sc.turn) ? sc.turn : (nextTurn(s, phase, sc.turn) ?? sc.turn);
    if (!sc.passed.includes(turn)) sc.passed.push(turn);
    sc.turn = nextTurn(s, phase, turn) ?? turn;
    this.cb.onChanged();
  }

  // Position is stored as the RIGHT edge, not the left. Closing shrinks the panel
  // to a small button, and a left anchor would strand it a panel-width away from
  // the close button it replaces. A right anchor keeps it exactly where the X was.
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
      if (!t.closest('.pg-grip') && !t.closest('.pg-head')) return;
      if (t.closest('button')) return;
      const host = this.host.getBoundingClientRect();
      const b = this.root.getBoundingClientRect();
      from = { x: ev.clientX, y: ev.clientY, l: b.right - host.left, t: b.top - host.top };
      ev.preventDefault();
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    });
  }
}
