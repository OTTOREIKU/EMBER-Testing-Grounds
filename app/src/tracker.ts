import { SIDE_LABEL } from './data';
import { inspectOnHover, pinInspect, type InspectInfo } from './inspector';
import { SCALES, type BattleScale, type GameState, type Side } from './types';
import { normaliseSetup } from './setup';

export const PHASES = ['Command', 'Planning', 'Action', 'Automatic', 'Delay', 'End'] as const;

const ROUND_CHOICES = [3, 4, 5, 6, 8];

type Phase = (typeof PHASES)[number];

export const PHASE_INFO: Record<Phase, { sub: string; lines: string[] }> = {
  Command: {
    sub: 'Phase 1 of 6 · drones get their orders',
    lines: [
      'Each of your Mechs generates 1 Command Token.',
      'Starting with the First Player, take turns spending 1 token to issue a Command to one Drone.',
      'A commanded Drone acts straight away: it either moves, or performs one command action.',
      'Any tokens you do not spend are removed at the end of the phase, so there is no saving them.',
    ],
  },
  Planning: {
    sub: 'Phase 2 of 6 · commit in secret',
    lines: [
      'Set the Timing Dial on every one of your Mechs in secret.',
      'The six timings are Swift, Melee, Projectile, Firing, Movement and Tactical.',
      'Both players reveal at the same time, so you are guessing at what the enemy will do.',
      'The dial you pick decides both when the Mech acts and what it is allowed to do.',
    ],
  },
  Action: {
    sub: 'Phase 3 of 6 · the main phase',
    lines: [
      'Mechs activate in timing order: Swift, then Melee, Projectile, Firing, Movement, Tactical.',
      'If two Mechs share a timing, the lower Pilot Initiative goes first. Still tied, the First Player chooses.',
      'Each activation gives 1 Maneuver Tick and then 2 Action Ticks.',
      'Action costs: Short uses 1 Action Tick, Medium uses 2, and Long uses the Maneuver Tick plus both Action Ticks.',
      'Use the Attack button on an action to walk the full attack sequence.',
    ],
  },
  Automatic: {
    sub: 'Phase 4 of 6 · uncommanded drones',
    lines: [
      'Every Drone that was not commanded this round now acts on its own.',
      'They are forced to target the nearest enemy, so position matters more than choice here.',
      'Players alternate picking which drone resolves next, starting with the First Player.',
    ],
  },
  Delay: {
    sub: 'Phase 5 of 6 · things that were waiting',
    lines: [
      'Projectiles and Deployables now carry out their delayed actions, which usually means detonating.',
      'Resolve them alternately, starting with the First Player.',
      'Select a projectile on the board and use Detonate to resolve it.',
      'A projectile that detonates is destroyed. One whose delayed action needs a target and has none is destroyed too.',
    ],
  },
  End: {
    sub: 'Phase 6 of 6 · clean up and score',
    lines: [
      'Remove any Mech left with 2 or fewer Parts.',
      'Remove Red tokens, then flip Yellow tokens to Red.',
      'Remove all remaining Command Tokens.',
      'Score your Main and Secondary Tasks, and add up Victory Points.',
      'First Player passes to the other side, then the next round begins.',
    ],
  },
};

function phaseInfo(p: Phase): InspectInfo {
  return {
    title: `${p} Phase`,
    sub: `${PHASE_INFO[p].sub} · double-click to pin`,
    lines: PHASE_INFO[p].lines,
  };
}

const DOUBLE_CLICK_MS = 500;

export class RoundTracker {
  private root: HTMLElement;
  private state: GameState | null = null;
  private onChanged: () => void;
  onStartGame: (() => void) | null = null;
  // Set by the play guide, which owns the pre-game and Planning gates.
  blockedReason: ((s: GameState) => string | null) | null = null;

  // The round bar can advance the round on its own, so it has to respect the
  // same lock the guide does or setup can simply be walked past.
  private inGame(): boolean {
    return !!normaliseSetup(this.state?.setup);
  }

  private blocked(): string | null {
    const s = this.state;
    if (!s) return null;
    const su = normaliseSetup(s.setup);
    if (su && su.stage !== 'done') return 'Finish the pre-game roll and deployment first';
    return this.blockedReason?.(s) ?? null;
  }
  private lastClick: { phase: Phase; at: number } | null = null;

  constructor(root: HTMLElement, onChanged: () => void) {
    this.root = root;
    this.onChanged = onChanged;
  }

  update(state: GameState): void {
    this.state = state;
    this.render();
  }

  advance(): void {
    const s = this.state!;
    if (s.round.phase < PHASES.length - 1) {
      s.round.phase++;
    } else {
      s.round.phase = 0;
      s.round.n++;
      s.round.firstPlayer = s.round.firstPlayer === 'blue' ? 'red' : 'blue';
      s.commandTokens = { blue: 0, red: 0 };
      for (const t of s.tokens) t.timing = undefined;
      // All Terminal Tokens flip back face-up at the End Phase (5.3.3), so the
      // new round starts with every Terminal accessible again.
      for (const i of s.tasks?.items ?? []) if (i.kind === 'terminal') i.accessed = null;
    }
    this.onChanged();
  }

  private scaleInfo(id: BattleScale): InspectInfo {
    const sc = SCALES.find((x) => x.id === id)!;
    return {
      title: `${sc.name} battle`,
      sub: `Squad limit ${sc.points}${sc.openEnded ? ' points or more' : ' points'}`,
      lines: [
        sc.note,
        'Every Part, Pilot and Drone in a squad costs points, and the total is what this caps. Projectiles and Deployables are Low Value Units worth 0 and do not count.',
        'Tactics Cards count against this total too, at 30 points each.',
        'The Squads tab shows each side against this limit and warns you when a side goes over.',
      ],
    };
  }

  private render(): void {
    const s = this.state;
    if (!s) return;
    const phaseName = PHASES[s.round.phase];
    const scale = s.scale ?? 'standard';
    const limit = s.roundLimit ?? 5;
    const over = s.round.n > limit;
    this.root.innerHTML = `
      <span class="rt-round${over ? ' over' : ''}">R${s.round.n}<small>/${limit}</small></span>
      <div class="rt-controls">
      <select id="rt-scale" class="rt-scale">
        ${SCALES.map((sc) => `<option value="${sc.id}"${sc.id === scale ? ' selected' : ''}>${sc.name} ${sc.points}${sc.openEnded ? '+' : ''}p</option>`).join('')}
      </select>
      <select id="rt-limit" class="rt-scale" title="Game length in rounds">
        ${ROUND_CHOICES.map((n) => `<option value="${n}"${n === limit ? ' selected' : ''}>${n} rounds</option>`).join('')}
      </select>
      ${
        s.round.n > 1 || s.round.phase > 0
          ? `<button id="rt-reset" class="rt-scale"${
              this.blocked() ? ` disabled title="${this.blocked()}"` : ' title="Back to Round 1, Command Phase"'
            }>↺</button>`
          : ''
      }
      <button id="rt-start" class="rt-start${this.inGame() ? ' ending' : ''}" title="${
        this.inGame()
          ? 'Leave the guided game and go back to free play, keeping everything where it stands'
          : 'Take everything off the board into its squad, roll for First Player, then deploy properly'
      }">${this.inGame() ? 'End game' : 'Start game'}</button>
      <span class="rt-phases">
        ${PHASES.map(
          (p, i) =>
            `<button class="rt-phase${i === s.round.phase ? ' active' : ''}"${
              this.blocked() && i !== s.round.phase ? ` disabled title="${this.blocked()}"` : ''
            } data-i="${i}">${p}</button>`,
        ).join('')}
      </span>
      <button id="rt-next"${this.blocked() ? ` disabled title="${this.blocked()}"` : ''}>${
        s.round.phase === PHASES.length - 1 ? (s.round.n >= limit ? `Extra round ${s.round.n + 1} ▸` : `End round ${s.round.n} ▸`) : 'Next phase ▸'
      }</button>
      <span class="rt-first side-${s.round.firstPlayer}">1st: ${SIDE_LABEL[s.round.firstPlayer]}</span>
      <span class="rt-cmd">
        CMD
        ${(['blue', 'red'] as Side[])
          .map(
            (side) => `<span class="cmd-${side}" title="${SIDE_LABEL[side]} Command Tokens">${SIDE_LABEL[side]} <button data-cmd="${side}" data-d="-1">−</button><b>${s.commandTokens[side]}</b><button data-cmd="${side}" data-d="1">+</button></span>`,
          )
          .join('')}
      </span>
      </div>`;

    this.root.querySelector<HTMLButtonElement>('#rt-start')!.addEventListener('click', () => this.onStartGame?.());
    const next = this.root.querySelector<HTMLButtonElement>('#rt-next')!;
    next.addEventListener('click', () => this.advance());
    inspectOnHover(next, phaseInfo(phaseName));

    const scaleSel = this.root.querySelector<HTMLSelectElement>('#rt-scale')!;
    inspectOnHover(scaleSel, this.scaleInfo(scale));
    scaleSel.addEventListener('change', () => {
      s.scale = scaleSel.value as BattleScale;
      this.onChanged();
    });
    const limitSel = this.root.querySelector<HTMLSelectElement>('#rt-limit')!;
    inspectOnHover(limitSel, {
      title: 'Game length',
      sub: `${limit} rounds`,
      lines: [
        'A standard game runs 5 rounds, then it ends and you total Victory Points.',
        'The rulebook sets the same 5 rounds for every battle scale. Skirmish, Standard and Large differ only in the points you may spend, not in how long the game lasts.',
        'Loading a scenario sets this to that scenario’s printed length, so change it back here when you go back to a normal game.',
      ],
    });
    limitSel.addEventListener('change', () => {
      s.roundLimit = Number(limitSel.value);
      this.onChanged();
    });

    const resetBtn = this.root.querySelector<HTMLButtonElement>('#rt-reset');
    if (resetBtn) {
      inspectOnHover(resetBtn, {
        title: 'Restart the round track',
        sub: 'Back to Round 1, Command Phase',
        lines: [
          'Sets the round number back to 1 and the phase back to Command, and clears both Command Token pools.',
          'Units, damage and positions on the board are left exactly as they are.',
        ],
      });
      resetBtn.addEventListener('click', () => {
        s.round.n = 1;
        s.round.phase = 0;
        s.commandTokens = { blue: 0, red: 0 };
        this.onChanged();
      });
    }

    const roundEl = this.root.querySelector<HTMLElement>('.rt-round')!;
    inspectOnHover(roundEl, {
      title: `Round ${s.round.n} of ${limit}`,
      sub: over ? 'Past the agreed length' : 'Game length',
      lines: [
        over
          ? `This game was set to ${limit} rounds and is now on round ${s.round.n}. Nothing stops you playing on, but the printed game ended at ${limit}. Use the round selector to change the length, or the reset button to start the track again.`
          : 'A standard game runs 5 rounds, then it ends and you total Victory Points.',
        'The dropdown beside this sets the length. Loading a scenario overrides it with that scenario’s printed count.',
      ],
    });

    const other: Side = s.round.firstPlayer === 'blue' ? 'red' : 'blue';
    inspectOnHover(this.root.querySelector<HTMLElement>('.rt-first')!, {
      title: `First Player: ${SIDE_LABEL[s.round.firstPlayer]}`,
      sub: 'Who goes first, not who owns the phase',
      lines: [
        'A phase is not one side’s turn. Both sides act inside every phase, and the First Player simply goes first each time.',
        `So in this round's Command Phase, ${SIDE_LABEL[s.round.firstPlayer]} issues a Command, then ${SIDE_LABEL[other]} does, and you keep alternating until nobody has tokens left to spend.`,
        'The Action Phase is the exception to strict alternation: Mechs there activate in Timing order, and the First Player only decides ties between Mechs sharing a timing.',
        'It flips at the end of every round, so the side that moved second last round moves first this one.',
      ],
    });

    this.root.querySelectorAll<HTMLButtonElement>('.rt-phase').forEach((b) => {
      const p = PHASES[Number(b.dataset.i)];
      inspectOnHover(b, phaseInfo(p));
      b.addEventListener('click', () => {
        const now = performance.now();
        const again = this.lastClick && this.lastClick.phase === p && now - this.lastClick.at < DOUBLE_CLICK_MS;
        this.lastClick = again ? null : { phase: p, at: now };
        if (again) {
          pinInspect(`phase:${p}`, phaseInfo(p));
          return;
        }
        s.round.phase = Number(b.dataset.i);
        this.onChanged();
      });
    });
    this.root.querySelectorAll<HTMLButtonElement>('[data-cmd]').forEach((b) =>
      b.addEventListener('click', () => {
        const side = b.dataset.cmd as Side;
        s.commandTokens[side] = Math.max(0, s.commandTokens[side] + Number(b.dataset.d));
        this.onChanged();
      }),
    );
  }
}
