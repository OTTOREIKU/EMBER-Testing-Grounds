// THE GAME SETUP WINDOW (player feedback, 2026-11-25; OTTO picked mockup B).
//
// A Guided game's setup ran on the turn strip above the player tabs, but its
// Main Task draw sent the player to the Tasks tab and the Secondaries were
// picked there too, while the table edge waited back on the strip. Players
// lost the thread. This is one window shaped like the attack window: the
// steps in order with numbered headers, the open step showing its buttons,
// a finished step folded to one line of what was decided, and the steps to
// come greyed with who will act. The rules and the commands are the guide's
// own (guided.ts setupStepBody, the same g-* buttons); only where the steps
// are shown changes. Optional pieces (Layout, Environment Cards, the score)
// stay on the Tasks tab.

import { taskDesignations } from '../src/commands';
import { deployable, deployTurn, firstPlayerFrom, normaliseSetup, type SetupState } from '../src/setup';
import { normaliseTasks } from '../src/tasks';
import type { Side } from '../src/types';
import { setupStepBody, type GuideApi } from './guided';

export type SetupStep = 'squads' | 'roll' | 'main' | 'edge' | 'tasks' | 'deploy';
export const SETUP_STEPS: { key: SetupStep; title: string }[] = [
  { key: 'squads', title: 'Squads' },
  { key: 'roll', title: 'First Player' },
  { key: 'main', title: 'Main Task' },
  { key: 'edge', title: 'Table edge' },
  { key: 'tasks', title: 'Secondary Tasks' },
  { key: 'deploy', title: 'Deploy' },
];

// What pad.ts draws for the window: the pieces that need its own state.
export interface SetupExtras {
  // The Guided game is chosen but not started: squads are still coming.
  pending: boolean;
  // "Guided · 900 pts · 5 rounds · S1.04"
  headline: string;
  // Each side's squad, as "Player 1 · RAID-RDL-Starter · 376 pts".
  squadLine(side: Side): string;
  // The pending step's body: Add a squad per side and Start.
  squadsBody: string;
  // The Main Task step's body: the draw, the list to choose from, or the
  // Draw 3 / Choose buttons.
  mainBody: string;
  // Choosing a Main Task again after one was set (before the edge).
  mainPicking: boolean;
  // The Secondary Task cards to pick from, for a side.
  secondaryCards(side: Side): string;
  // A side's Secondary list re-opened to change it.
  secondaryOpen(side: Side): boolean;
}

// One phone may hold a side in a room, or both solo.
function mine(api: GuideApi, side: Side): boolean {
  return api.solo || api.me() === side;
}

// Which step is open, from the setup stage and the Main Task.
export function currentStep(pending: boolean, su: SetupState | null, mission: string | null | undefined, mainPicking: boolean): SetupStep | 'done' {
  if (pending || !su) return 'squads';
  switch (su.stage) {
    case 'map':
    case 'roll': return 'roll';
    case 'side': return !mission || mainPicking ? 'main' : 'edge';
    case 'tasks': return 'tasks';
    case 'deploy': return 'deploy';
    default: return 'done';
  }
}

const EDGE: Record<'black' | 'white', string> = { black: 'Black edge', white: 'White edge' };

export function setupWindowHtml(api: GuideApi, x: SetupExtras): string {
  const s = api.state();
  const su = normaliseSetup(s.setup);
  const now = currentStep(x.pending, su, s.mission ?? undefined, x.mainPicking);
  const at = now === 'done' ? SETUP_STEPS.length : SETUP_STEPS.findIndex((st) => st.key === now);
  const fp = s.round.firstPlayer;
  const tasks = normaliseTasks(s.tasks);
  const missionName = s.mission ? api.data.missions.cards.find((c) => c.id === s.mission)?.name ?? s.mission : '';
  const secName = (side: Side) => {
    const id = tasks.secondary[side];
    return id ? api.data.secondary.find((c) => c.id === id)?.name ?? id : '';
  };

  const rolled = at > SETUP_STEPS.findIndex((st) => st.key === 'roll');
  // The line on a step's header: what was decided, who acts now, or who will.
  const summary = (key: SetupStep, state: 'done' | 'now' | 'todo'): string => {
    switch (key) {
      case 'squads': return state === 'done' ? `${pointsOf(x.squadLine('s1'))} v ${pointsOf(x.squadLine('s2'))} pts` : 'Each side adds one';
      case 'roll': {
        if (state === 'todo') return '';
        const won = su ? firstPlayerFrom(su) : null;
        if (state === 'done') return `${api.actorName(fp)} goes first`;
        return won ? `${api.actorName(won)} won the roll` : s.tableDice ? 'Rolled on the table' : 'Both roll 2 dice';
      }
      case 'main':
        if (state === 'done') return missionName;
        if (state === 'todo') return '';
        return (tasks.draw ?? []).length ? 'Discard two of three' : 'Draw 3 or choose';
      case 'edge':
        if (state === 'done' && su) return `${api.sideName(fp)}: ${EDGE[su.edge[fp]]}`;
        // Who picks is known only once the First Player is.
        return rolled ? `${api.actorName(fp)} picks` : '';
      case 'tasks': {
        if (s.noSecondary) return 'None this game';
        if (state === 'done') return [secName(fp), secName(other(fp))].filter(Boolean).join(' · ');
        if (!rolled) return '';
        if (state === 'todo') return `${api.actorName(fp)} first`;
        const due = [fp, other(fp)].find((sd) => !tasks.secondary[sd]);
        return due ? `${api.actorName(due)} chooses` : 'Then Continue';
      }
      case 'deploy': {
        const left = (['s1', 's2'] as Side[]).reduce((n, side) => n + deployable(s, side, api.data).length, 0);
        if (state === 'now' && su) {
          const turn = deployTurn(s, su, api.data);
          return turn ? `${api.actorName(turn)} places` : 'Everything is placed';
        }
        return left ? `${left} unit${left === 1 ? '' : 's'}` : '';
      }
    }
  };

  const body = (key: SetupStep): string => {
    switch (key) {
      case 'squads': return x.squadsBody;
      case 'roll': return setupStepBody(api, 'roll');
      case 'main': return x.mainBody;
      case 'edge': {
        const pick = mine(api, fp)
          ? `<div class="pad-chips">${(['white', 'black'] as const).map((e) => `<button class="pad-chip" data-act="g-edge" data-edge="${e}">${EDGE[e]}</button>`).join('')}</div>`
          : `<p class="pad-turn-wait">${api.esc(api.sideName(fp))} · picking an edge</p>`;
        return `<p class="ah-note">The First Player picks the table edge, knowing the Main Task (3.1.2). The other squad takes the opposite edge.</p>
          ${pick}
          <button class="ah-alt" data-act="ws-main-change">Change the Main Task</button>`;
      }
      case 'tasks': return tasksBody(api, x);
      case 'deploy': return setupStepBody(api, 'deploy');
    }
  };

  const cards = SETUP_STEPS.map((st, i) => {
    const state = i < at ? 'done' : i === at ? 'now' : 'todo';
    const r = summary(st.key, state);
    return `<div class="ah-card${state === 'todo' ? '' : ` ${state}`}" data-step="${st.key}">
      <div class="ah-card-h"><span class="n">${state === 'done' ? '✓' : i + 1}</span><span class="t">${api.esc(st.title)}</span><span class="r">${api.esc(r)}</span></div>
      ${state === 'now' ? `<div class="ah-card-b"><div class="ah-step">${body(st.key)}</div></div>` : ''}
    </div>`;
  }).join('');
  return `<div class="pad-panel-in pad-combat pad-setupwin"><div class="attack-helper">
    <div class="ah-head"><b>Game setup</b><span class="dim">${api.esc(x.headline)}</span><button class="ah-cancel" data-act="setup-close" title="Close" aria-label="Close the setup window">✕</button></div>
    <div class="ah-main"><div class="ah-stack">${cards}</div></div>
    <p class="pad-note pad-setupwin-foot">Layout, Environment Cards and the score are on the Tasks tab.</p>
  </div></div>`;
}

function other(s: Side): Side {
  return s === 's1' ? 's2' : 's1';
}

// "Player 1 · RAID-RDL-Starter · 376 pts" -> "376" for a header.
function pointsOf(line: string): string {
  return /(\d+) pts$/.exec(line)?.[1] ?? '0';
}

// The Secondaries, First Player first (FAQ P1): the card list for a side whose
// pick is due on this phone, the name once picked; then what each Task names.
function tasksBody(api: GuideApi, x: SetupExtras): string {
  const s = api.state();
  const fp = s.round.firstPlayer;
  const tasks = normaliseTasks(s.tasks);
  const owed = taskDesignations(api.data, s);
  const both = !!s.noSecondary || (!!tasks.secondary.s1 && !!tasks.secondary.s2);
  const rows = s.noSecondary ? '<p class="ah-note">No Secondary Tasks in this game.</p>' : [fp, other(fp)].map((side, i) => {
    const id = tasks.secondary[side];
    const card = id ? api.data.secondary.find((c) => c.id === id) : undefined;
    const waits = i === 1 && !tasks.secondary[fp];
    const open = mine(api, side) && !waits && !both && (!card || x.secondaryOpen(side));
    const tail = card
      ? (mine(api, side) && !both && !open ? `<button class="pad-chip" data-act="ws-sec-change" data-side="${side}">Change</button>` : '')
      : waits ? '' : mine(api, side) ? '' : `<span class="pad-turn-wait">choosing</span>`;
    return `<div class="pad-turn-row"><span class="pad-turn-name">${api.esc(api.sideName(side))}</span>
        <span class="pad-turn-val">${card ? api.esc(card.name) : waits ? `after ${api.esc(api.actorName(fp))}` : '—'}</span>${tail}</div>
      ${open ? x.secondaryCards(side) : ''}`;
  }).join('');
  const desig = owed.map((d, i) => `<div class="pad-turn-row"><span class="pad-turn-name">${api.esc(d.label)}</span>
      ${mine(api, d.by) ? `<button class="pad-chip" data-act="g-designate-task" data-i="${i}">Choose</button>` : `<span class="pad-turn-val">${api.esc(api.actorName(d.by))} chooses</span>`}</div>`).join('');
  const done = both && !owed.length;
  return `${s.noSecondary ? '' : `<p class="ah-note">${api.esc(api.actorName(fp))} reveals first, then the other squad. Both are final once revealed (FAQ P1).</p>`}
    ${rows}${desig}
    <button class="ah-primary" data-act="g-tasks-done"${done ? '' : ' disabled'}>Continue to deployment</button>`;
}

// For the tests: the step list as plain data.
export function setupStepStates(pending: boolean, su: SetupState | null, mission: string | null | undefined, mainPicking = false): ('done' | 'now' | 'todo')[] {
  const now = currentStep(pending, su, mission, mainPicking);
  const at = now === 'done' ? SETUP_STEPS.length : SETUP_STEPS.findIndex((st) => st.key === now);
  return SETUP_STEPS.map((_, i) => (i < at ? 'done' : i === at ? 'now' : 'todo'));
}


