import { SIDE_LABEL } from './data';
import { inspectOnHover, pinInspect, type InspectInfo } from './inspector';
import type { GameState, Side } from './types';

export const PHASES = ['Command', 'Planning', 'Action', 'Automatic', 'Delay', 'End'] as const;

type Phase = (typeof PHASES)[number];

const PHASE_INFO: Record<Phase, { sub: string; lines: string[] }> = {
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
  private lastClick: { phase: Phase; at: number } | null = null;

  constructor(root: HTMLElement, onChanged: () => void) {
    this.root = root;
    this.onChanged = onChanged;
  }

  update(state: GameState): void {
    this.state = state;
    this.render();
  }

  private advance(): void {
    const s = this.state!;
    if (s.round.phase < PHASES.length - 1) {
      s.round.phase++;
    } else {
      s.round.phase = 0;
      s.round.n++;
      s.round.firstPlayer = s.round.firstPlayer === 'blue' ? 'red' : 'blue';
      s.commandTokens = { blue: 0, red: 0 };
    }
    this.onChanged();
  }

  private render(): void {
    const s = this.state;
    if (!s) return;
    const phaseName = PHASES[s.round.phase];
    this.root.innerHTML = `
      <span class="rt-round" title="Standard game = 5 rounds">R${s.round.n}<small>/5</small></span>
      <span class="rt-phases">
        ${PHASES.map((p, i) => `<button class="rt-phase${i === s.round.phase ? ' active' : ''}" data-i="${i}">${p}</button>`).join('')}
      </span>
      <button id="rt-next">${s.round.phase === PHASES.length - 1 ? `End round ${s.round.n} ▸` : 'Next phase ▸'}</button>
      <span class="rt-first side-${s.round.firstPlayer}" title="First Player (flips every round)">1st: ${SIDE_LABEL[s.round.firstPlayer]}</span>
      <span class="rt-cmd">
        CMD
        ${(['blue', 'red'] as Side[])
          .map(
            (side) => `<span class="cmd-${side}" title="${SIDE_LABEL[side]} Command Tokens">${SIDE_LABEL[side]} <button data-cmd="${side}" data-d="-1">−</button><b>${s.commandTokens[side]}</b><button data-cmd="${side}" data-d="1">+</button></span>`,
          )
          .join('')}
      </span>`;

    const next = this.root.querySelector<HTMLButtonElement>('#rt-next')!;
    next.addEventListener('click', () => this.advance());
    inspectOnHover(next, phaseInfo(phaseName));

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
