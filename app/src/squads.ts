import type { GameData } from './data';
import { actionIconUrl, cardName, FACTION_LABEL, mechPartUrl, missionImageUrl, secondaryImageUrl, setSquadNames, squadLabel, squadName, tabImageUrl } from './data';
import { MECH_LAYER_ORDER } from './board';
import { inspectOnHover, linkMechanics, type InspectInfo } from './inspector';
import type { GameState, PartSlot, PartState, Side, Stance, Timing, TimingDef, Token } from './types';
import { addStatus, SCALES, SHAPE_NOTE, statusCount, statusesFor, TIMINGS } from './types';
import { normaliseTasks } from './tasks';
import { normaliseSetup } from './setup';
import { perform } from './commands';
import { dialHidden, getLocalSeat } from './loop';
import { defaultUnitLabel, emptyCarriers, factionProblems, initiativeFor, pilotCard, squadAllegiance, SLOT_LABEL, tidyUnitLabel, tokenCards, tokenFactions } from './units';
import { alertDialog, promptDialog } from './dialog';
import { factionColour, ICON_EDIT, linkIcon, squadColour } from './icons';

const esc = (s: string): string => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);

const DOUBLE_CLICK_MS = 500;

// ---------- timing dial popout ----------

let openDial: { pop: HTMLElement; trigger: HTMLElement; teardown: () => void } | null = null;

function closeDialPopout(): HTMLElement | null {
  if (!openDial) return null;
  const was = openDial.trigger;
  openDial.teardown();
  openDial.pop.remove();
  openDial = null;
  return was;
}

function placeDialPopout(pop: HTMLElement, trigger: HTMLElement): void {
  const t = trigger.getBoundingClientRect();
  const p = pop.getBoundingClientRect();
  const gap = 8;
  let left = t.left - p.width - gap;
  pop.classList.remove('flip');
  if (left < 8) {
    left = Math.min(t.right + gap, window.innerWidth - p.width - 8);
    pop.classList.add('flip');
  }
  pop.style.left = `${Math.max(8, left)}px`;
  pop.style.top = `${Math.max(8, Math.min(t.top - 6, window.innerHeight - p.height - 8))}px`;
}

const NEXT_STATE: Record<PartState, PartState> = { intact: 'damaged', damaged: 'destroyed', destroyed: 'intact' };
const STANCES: Stance[] = ['offensive', 'defensive', 'mobility', 'shutdown'];
const STANCE_SHORT: Record<Stance, string> = { offensive: 'OFF', defensive: 'DEF', mobility: 'MOB', shutdown: 'SHUT' };

export interface SquadCallbacks {
  onSelect(uid: number, focusSlot?: string): void;
  onChanged(): void;
  onDelete(uid: number): void;
  onEditMech(uid: number): void;
  onPlayTactic(side: Side, id: string): void;
  scenarioName(id: string): string | null;
  onShowScenario(): void;
}

export class SquadTracker {
  private data: GameData;
  private cb: SquadCallbacks;
  private root: HTMLElement;
  private state: GameState | null = null;
  private selectedUid: number | null = null;
  private lastNameClick: { uid: number; at: number } | null = null;
  private renaming = false;

  // Clearing the box restores the default, so a squad can always get its number
  // back without the player having to guess what it was called.
  private async renameSquad(side: Side): Promise<void> {
    const s = this.state;
    if (!s) return;
    const name = await promptDialog({
      title: `Rename ${squadLabel(side)}`,
      body: 'Leave it empty to go back to the default name.',
      value: s.sideNames?.[side] ?? '',
      placeholder: squadName(side),
    });
    if (name === null) return;
    const next = { ...(s.sideNames ?? {}) };
    if (name.trim()) next[side] = name.trim();
    else delete next[side];
    s.sideNames = next;
    setSquadNames(next);
    this.cb.onChanged();
  }

  constructor(data: GameData, root: HTMLElement, cb: SquadCallbacks) {
    this.data = data;
    this.root = root;
    this.cb = cb;
  }

  update(state: GameState, selectedUid: number | null): void {
    this.state = state;
    this.selectedUid = selectedUid;
    this.render();
  }

  private orderPanel(): HTMLElement | null {
    const s = this.state!;
    const mechs = s.tokens.filter((t) => t.kind === 'mech' && t.partStates.torso !== 'destroyed');
    if (!mechs.length) return null;
    const planning = s.round.phase === 1;
    const action = s.round.phase === 2;
    if (!planning && !action) return null;

    const set = mechs.filter((t) => t.timing);
    const wrap = document.createElement('div');
    wrap.className = 'act-order';
    if (planning) {
      wrap.innerHTML = `<h4>Planning: set the dials</h4>
        <p class="dim">${set.length} of ${mechs.length} Mech${mechs.length === 1 ? '' : 's'} set. Both players reveal at once, so set them all before moving on.</p>`;
      return wrap;
    }

    const rows: string[] = [];
    let n = 0;
    for (const def of TIMINGS) {
      const group = set.filter((t) => t.timing === def.id);
      if (!group.length) continue;
      const scored = group
        .map((t) => ({ t, init: initiativeFor(this.data, t, def.id) }))
        .sort((a, b) => (a.init ?? 99) - (b.init ?? 99));
      const counts = new Map<number, number>();
      for (const g of scored) if (g.init !== undefined) counts.set(g.init, (counts.get(g.init) ?? 0) + 1);
      rows.push(`<div class="ao-timing" style="--t-tint:var(--t-${def.id})">${def.name}</div>`);
      for (const g of scored) {
        n++;
        const tie = g.init !== undefined && (counts.get(g.init) ?? 0) > 1;
        rows.push(`<div class="ao-row side-${g.t.side}" data-uid="${g.t.uid}">
          <span class="ao-n">${n}</span>
          <span class="ao-name">${esc(g.t.label)}</span>
          <span class="ao-init">${g.init ?? '?'}</span>
          ${tie ? '<span class="ao-tie" title="Tied initiative: the First Player picks the order">tie</span>' : ''}
        </div>`);
      }
    }
    const missing = mechs.length - set.length;
    wrap.innerHTML = `<h4>Activation order</h4>
      ${rows.length ? rows.join('') : '<p class="dim">No dials are set, so there is no order to resolve.</p>'}
      ${missing ? `<p class="dim">${missing} Mech${missing === 1 ? ' has' : 's have'} no dial set and will not activate.</p>` : ''}`;
    wrap.querySelectorAll<HTMLElement>('.ao-row').forEach((r) =>
      r.addEventListener('click', () => this.cb.onSelect(Number(r.dataset.uid))),
    );
    return wrap;
  }

  private render(): void {
    if (!this.state) return;
    closeDialPopout();
    this.root.replaceChildren();
    const taskBar = this.taskBar();
    if (taskBar) this.root.appendChild(taskBar);
    const order = this.orderPanel();
    if (order) this.root.appendChild(order);
    for (const side of ['s1', 's2'] as const) {
      const tokens = this.state.tokens.filter((t) => t.side === side);
      const sec = document.createElement('div');
      sec.className = `squad squad-${side}`;
      const h = document.createElement('h3');
      // A Tactics Card is added to the Squad and counts against its point limit
      // (5.4.2), so the header has to reach past the board for them: they are
      // held in hand and never appear as a token.
      const pts = tokens.reduce((sum, t) => sum + this.tokenPoints(t), 0) + this.tacticPoints(side);
      const activeScale = this.state.scale ?? 'standard';
      const sc = SCALES.find((x) => x.id === activeScale)!;
      const over = !sc.openEnded && pts > sc.points;
      const squadFactions = [...new Set(tokens.flatMap((t) => tokenFactions(this.data, t).factions))];
      // Mercenaries alongside one allegiance is a legal squad, so the chip only
      // turns red when two real allegiances are mixed.
      const alg = squadAllegiance(this.data, tokens);
      const facChip =
        squadFactions.length === 1
          ? `<span class="fac-chip">${FACTION_LABEL[squadFactions[0]] ?? squadFactions[0]}</span>`
          : squadFactions.length > 1
            ? `<span class="fac-chip${alg.mixed.length > 1 ? ' bad' : ''}">${squadFactions.map((f) => FACTION_LABEL[f] ?? f).join(' + ')}</span>`
            : '<span class="fac-chip generic" title="No faction yet">Generic</span>';
      // The chip is one word and sits inside the heading, so its explanation
      // rides along in the heading's own details rather than as a second hover
      // target nested inside the first.
      const factionNote =
        squadFactions.length === 0
          ? 'No faction yet. The first unit with an allegiance sets it, and mercenaries never do.'
          : alg.mixed.length > 1
            ? `Illegal: ${alg.mixed.map((f) => FACTION_LABEL[f] ?? f).join(' and ')} cannot share a squad.`
            : alg.mercenaries.length
              ? 'Mercenaries carry no allegiance of their own, so they may join any squad.'
              : '';
      const waiting = tokens.filter((t) => t.deployed === false).length;
      sec.style.setProperty('--squad-tint', squadColour(alg.faction));
      h.innerHTML = `<button class="sq-name" title="Rename this squad">${esc(squadLabel(side))}</button>${facChip} <span class="pts${over ? ' over' : ''}">${pts}<small>/${sc.points}${sc.openEnded ? '+' : ''}</small>p · ${tokens.length} unit${tokens.length === 1 ? '' : 's'}${
        waiting ? ` · <b class="sq-waiting">${waiting} to deploy</b>` : ''
      }</span>`;
      h.querySelector('.sq-name')!.addEventListener('click', () => void this.renameSquad(side));
      inspectOnHover(h, {
        title: squadLabel(side),
        sub: `${pts} points of ${sc.points}${sc.openEnded ? ' or more' : ''} · ${sc.name} battle`,
        lines: (over
          ? [
              `This squad is ${pts - sc.points} points over the ${sc.name} limit of ${sc.points}.`,
              'Remove a unit, or switch the battle scale in the round bar at the top of the board.',
              'Nothing is blocked here, so you can keep playing an oversized game if you both agree.',
            ]
          : [
              `${sc.points - pts} points still available at this battle scale.`,
              'Every Part, Pilot and Drone counts. Projectiles and Deployables are Low Value Units worth 0.',
              this.tacticPoints(side) ? `Includes ${this.tacticPoints(side)} points of Tactics Cards held in hand.` : '',
              'Change the battle scale in the round bar above the board.',
            ]
        ).concat(factionNote),
      });
      sec.appendChild(h);
      if (over) {
        const warn = document.createElement('p');
        warn.className = 'squad-over';
        warn.textContent = `Over the ${sc.name} limit by ${pts - sc.points} points.`;
        sec.appendChild(warn);
      }
      // Legal but almost always unintended, so it reads as a reminder rather
      // than joining the illegal list below. Shown in the Match Centre too,
      // which mounts this same tracker.
      for (const c of this.state.scenario ? [] : emptyCarriers(this.data, tokens)) {
        const note = document.createElement('p');
        note.className = 'squad-note';
        note.textContent = `${c.label} is carrying nothing.`;
        inspectOnHover(note, {
          title: `${c.label} has no Load`,
          sub: 'Official FAQ O8',
          lines: [
            'A Carrier lends the Part on its back to a friendly Mech it is in contact with. With nothing loaded it has nothing to lend.',
            'This is allowed: O8 says a Tarantula may deploy empty. It is flagged because it is usually an oversight.',
            'Give it a Part from the Load button on its card in the Details tab, or when adding it from the Add tab.',
          ],
        });
        sec.appendChild(note);
      }
      const tac = this.tacticsBlock(side);
      if (tac) sec.appendChild(tac);
      // A prebuilt scenario is played as printed, mixed factions and all.
      for (const p of this.state.scenario ? [] : factionProblems(this.data, tokens)) {
        const bad = document.createElement('p');
        bad.className = 'squad-illegal';
        bad.innerHTML = `<b>Illegal: ${p.kind === 'mixed-squad' ? 'mixed factions' : `${p.label} mixes factions`}</b><br>${p.detail}`;
        inspectOnHover(bad, {
          title: p.kind === 'mixed-squad' ? 'Squad mixes factions' : `${p.label} mixes factions`,
          sub: 'Rulebook 5.1, squad composition',
          lines: [
            p.detail,
            p.kind === 'mixed-squad'
              ? 'A Squad may only contain Units from a single faction. The three base factions are RDL, UN and GoF.'
              : 'A Mech can only be composed of Parts from a single faction. The rulebook prints a mixed RDL and UN mech as an example of what is not allowed.',
            'A card that may be used by more than one faction says so in its own rules text.',
            'Parts whose faction we cannot determine are not counted here, so this only fires on a confirmed clash.',
          ],
        });
        sec.appendChild(bad);
      }
      if (!tokens.length) {
        const p = document.createElement('p');
        p.className = 'dim';
        p.textContent = 'No units. Add some from the Add tab or import a squad.';
        sec.appendChild(p);
      }
      const children = new Map<number, typeof tokens>();
      for (const t of tokens) {
        if (t.parentUid != null) {
          (children.get(t.parentUid) ?? children.set(t.parentUid, []).get(t.parentUid)!).push(t);
        }
      }
      for (const t of tokens) {
        if (t.parentUid != null && tokens.some((p) => p.uid === t.parentUid)) continue;
        sec.appendChild(this.unitRow(t));
        for (const child of children.get(t.uid) ?? []) {
          const row = this.unitRow(child);
          row.classList.add('nested');
          sec.appendChild(row);
        }
      }
      this.root.appendChild(sec);
    }
  }

  // Tactics are held in hand, so they live on the squad rather than the board.
  // The 1-per-round cap (5.4.2) is tracked by stamping the round onto each play,
  // which avoids needing a reset hook on every path that advances the round.
  private playedThisRound(side: Side): string[] {
    const s = this.state;
    if (!s) return [];
    // Free play is a sandbox with no round structure worth policing, so the
    // 1-per-round cap only applies once a game is actually running.
    if (!normaliseSetup(s.setup)) return [];
    return (s.tacticsPlayed?.[side] ?? []).filter((e) => e.startsWith(`${s.round.n}:`));
  }

  private tacticsBlock(side: Side): HTMLElement | null {
    const held = this.state?.tactics?.[side] ?? [];
    if (!held.length) return null;
    const spent = this.playedThisRound(side);
    const box = document.createElement('div');
    box.className = 'sq-tactics';
    const head = document.createElement('p');
    head.className = 'sq-tac-head';
    head.textContent = spent.length
      ? `Tactics (${held.length}) · 1 played this round`
      : `Tactics (${held.length})`;
    box.appendChild(head);
    const counts = new Map<string, number>();
    for (const id of held) counts.set(id, (counts.get(id) ?? 0) + 1);
    for (const [id, n] of counts) {
      const card = this.data.byId.get(id);
      if (!card) continue;
      const used = spent.filter((e) => e === `${this.state?.round.n ?? 1}:${id}`).length;
      const row = document.createElement('div');
      row.className = 'sq-tac-row';
      row.dataset.tipCard = id;
      const name = document.createElement('span');
      name.className = 'sq-tac-name';
      name.textContent = `${cardName(card)}${n > 1 ? ` ×${n}` : ''}`;
      const timing = document.createElement('span');
      timing.className = 'sq-tac-when';
      timing.textContent = card.actions?.[0]?.name?.en ?? '';
      const play = document.createElement('button');
      play.className = 'sq-tac-play';
      play.textContent = used ? 'Played' : 'Play';
      play.disabled = spent.length > 0 || used >= n;
      play.title = spent.length
        ? 'Only 1 Tactics Card may be played per round (5.4.2)'
        : `Play ${cardName(card)}`;
      play.addEventListener('click', () => this.playTactic(side, id));
      inspectOnHover(row, {
        title: cardName(card),
        sub: card.actions?.[0]?.name?.en,
        lines: [card.actions?.[0]?.description?.en ?? '', 'Only 1 Tactics Card may be played per round (rulebook 5.4.2).'],
      });
      row.append(name, timing, play);
      box.appendChild(row);
    }
    return box;
  }

  // The effect itself needs dialogs, the board and the move picker, so the app
  // resolves it and only stamps the play once the effect actually happened. A
  // card cancelled at the target picker stays in hand.
  private playTactic(side: Side, id: string): void {
    if (!this.state) return;
    if (this.playedThisRound(side).length) return;
    this.cb.onPlayTactic(side, id);
  }

  // The Main Task briefing is shown once when it is picked and then lost behind
  // the next unit selection, so the Tasks in play get a permanent home here.
  private taskBar(): HTMLElement | null {
    const s = this.state;
    if (!s) return null;
    const tasks = normaliseTasks(s.tasks);
    const mission = s.mission ? this.data.missions.cards.find((m) => m.id === s.mission) : undefined;
    const anySecondary = tasks.secondary.s1 || tasks.secondary.s2;
    // A scenario briefing is written into the Details panel once on load and is
    // gone at the next click, so it gets a permanent way back in too.
    const scenario = s.scenario ? this.cb.scenarioName(s.scenario) : null;
    if (!mission && !anySecondary && !scenario) return null;

    const bar = document.createElement('div');
    bar.className = 'sq-tasks';

    const chip = (label: string, name: string, open: () => void): HTMLElement => {
      const b = document.createElement('button');
      b.className = 'sq-task';
      b.innerHTML = `<span class="sq-task-kind">${esc(label)}</span><span class="sq-task-name">${esc(name)}</span>`;
      b.addEventListener('click', open);
      return b;
    };

    // The Main Task governs the whole game while a Secondary belongs to one
    // player, so the Main gets a line to itself and the two Secondaries share
    // the line under it rather than all three wrapping as one run of chips.
    const secRow = document.createElement('div');
    secRow.className = 'sq-task-row';

    if (scenario) bar.appendChild(chip('Scenario', scenario, () => this.cb.onShowScenario()));

    if (mission) {
      bar.appendChild(chip('Main Task', mission.name, () => {
        void alertDialog({
          title: mission.name,
          image: missionImageUrl(mission.id),
          body: mission.scoring ?? '',
          list: [
            (mission.zones ?? []).length ? `Tactical Zones: ${(mission.zones ?? []).join(', ')}` : 'No Tactical Zones',
            mission.deployment ? `Deployment: ${mission.deployment}` : '',
          ].filter(Boolean),
        });
      }));
    }

    for (const side of ['s1', 's2'] as const) {
      const id = tasks.secondary[side];
      if (!id) continue;
      const card = this.data.secondary.find((c) => c.id === id);
      if (!card) continue;
      const named = tasks.zone[side]
        ? `Tactical Area: ${tasks.zone[side]}`
        : tasks.secTarget[side] !== undefined
          ? `Designated: ${s.tokens.find((t) => t.uid === tasks.secTarget[side])?.label ?? 'a unit'}`
          : '';
      secRow.appendChild(chip(`${squadLabel(side)} Secondary`, card.name, () => {
        void alertDialog({
          title: `${squadLabel(side)}: ${card.name}`,
          image: secondaryImageUrl(card.id),
          body: card.scoring ?? '',
          list: [card.setup ?? '', named].filter(Boolean),
        });
      }));
    }
    if (secRow.childElementCount) bar.appendChild(secRow);
    return bar;
  }

  private tokenPoints(t: Token): number {
    return tokenCards(this.data, t).reduce((s, { card }) => s + (card.score ?? 0), 0);
  }

  private tacticPoints(side: Side): number {
    return (this.state?.tactics?.[side] ?? []).reduce((s, id) => s + (this.data.byId.get(id)?.score ?? 0), 0);
  }

  private async rename(t: Token): Promise<void> {
    if (this.renaming) return;
    this.renaming = true;
    const fallback = defaultUnitLabel(this.data, t);
    try {
      const next = await promptDialog({
        title: `Rename ${t.label}`,
        body:
          'Give this unit a callsign so you can tell it apart from an identical build. ' +
          `Leave it empty to go back to the default, ${fallback}.`,
        value: t.label,
        placeholder: fallback,
        confirmLabel: 'Rename',
      });
      if (next === null) return;
      const trimmed = next.trim();
      t.label = trimmed ? tidyUnitLabel(trimmed) || fallback : fallback;
      this.cb.onChanged();
    } finally {
      this.renaming = false;
      this.lastNameClick = null;
    }
  }

  private unitArt(t: Token): HTMLElement | null {
    const layers: string[] = [];
    if (t.kind === 'mech' && t.mech) {
      for (const slot of MECH_LAYER_ORDER) {
        const id = t.mech[slot];
        if (!id) continue;
        if (t.partStates[slot] === 'destroyed' && slot !== 'torso' && slot !== 'chasis') continue;
        layers.push(mechPartUrl(id));
      }
    }
    if (!layers.length && t.cardId) layers.push(tabImageUrl(t.cardId));
    if (!layers.length) return null;
    const art = document.createElement('div');
    art.className = 'su-art';
    art.setAttribute('aria-hidden', 'true');
    for (const href of layers) {
      const img = document.createElement('img');
      img.src = href;
      img.loading = 'lazy';
      img.addEventListener('error', () => img.remove(), { once: true });
      art.appendChild(img);
    }
    return art;
  }

  private unitRow(t: Token): HTMLElement {
    const row = document.createElement('div');
    row.className = `squad-unit${t.uid === this.selectedUid ? ' selected' : ''}`;

    const art = this.unitArt(t);
    if (art) row.appendChild(art);

    const head = document.createElement('div');
    head.className = 'squad-unit-head';

    const name = document.createElement('button');
    name.className = 'squad-unit-name';
    const kind = t.kind === 'mech' ? 'MECH' : t.kind === 'drone' ? 'DRONE' : 'PROJ';
    name.innerHTML = `<span class="pt-kind kind-${t.kind}">${kind}</span><span class="su-label">${t.label}</span>`;
    const parts = Object.entries(t.partStates);
    inspectOnHover(name, {
      title: t.label,
      sub: `${squadLabel(t.side)} · ${t.kind} · ${this.tokenPoints(t)} pts`,
      lines: [
        `Stance ${t.stance.toUpperCase()}${t.link !== undefined ? ` · Link ${t.link}` : ''}`,
        `Grid ${String.fromCharCode(65 + Math.floor(t.col / 3))}${Math.floor(t.row / 3) + 1} · facing ${['North', 'East', 'South', 'West'][t.facing]}`,
        `${parts.filter(([, s]) => s === 'intact').length} intact, ${parts.filter(([, s]) => s === 'damaged').length} damaged, ${parts.filter(([, s]) => s === 'destroyed').length} destroyed`,
        'Click to select this unit on the board. Double-click to rename it.',
      ],
    });
    name.title = 'Click to select · double-click to rename';
    name.addEventListener('click', () => {
      const now = performance.now();
      const again = this.lastNameClick?.uid === t.uid && now - this.lastNameClick.at < DOUBLE_CLICK_MS;
      this.lastNameClick = again ? null : { uid: t.uid, at: now };
      if (again) {
        void this.rename(t);
        return;
      }
      this.cb.onSelect(t.uid);
    });
    head.appendChild(name);

    const headPts = document.createElement('span');
    headPts.className = 'su-pts su-pts-head';
    headPts.textContent = `${this.tokenPoints(t)}p`;
    head.appendChild(headPts);

    // Swapping Parts mid-game would rewrite a unit the other player has already
    // been shooting at, so the editor is a free play tool only.
    if (t.kind === 'mech') {
      const locked = !!normaliseSetup(this.state?.setup);
      const edit = document.createElement('button');
      edit.className = 'squad-edit';
      edit.innerHTML = ICON_EDIT;
      edit.disabled = locked;
      edit.title = locked
        ? 'Parts are locked while a game is running. End the game to edit this mech.'
        : 'Change this mech’s parts';
      edit.addEventListener('click', () => this.cb.onEditMech(t.uid));
      head.appendChild(edit);
    }

    const del = document.createElement('button');
    del.className = 'squad-del';
    del.textContent = '✕';
    del.title = 'Remove this unit from the board';
    del.addEventListener('click', () => this.cb.onDelete(t.uid));
    head.appendChild(del);

    const edge = document.createElement('span');
    edge.className = 'su-fac-edge';
    head.appendChild(edge);

    const meta = document.createElement('div');
    meta.className = 'squad-unit-meta';

    if (t.kind === 'mech' && parts.length && parts.filter(([, s]) => s !== 'destroyed').length <= 2) {
      const flag = document.createElement('span');
      flag.className = 'su-integrity';
      flag.dataset.mech = 'integrity_loss';
      flag.textContent = 'INTEGRITY';
      meta.appendChild(flag);
      linkMechanics(meta, this.data.mechanics);
    }

    let linkCtrl: HTMLElement | null = null;
    if (t.kind === 'mech') {
      // The one piece of hidden information (3.3): in pass-and-play, the dial
      // of the squad not holding the device is masked and cannot be opened.
      const masked = !!this.state && dialHidden(this.state, t);
      const cur = !masked && t.timing ? TIMINGS.find((x) => x.id === t.timing) : undefined;
      const init = !masked && t.timing ? initiativeFor(this.data, t, t.timing) : undefined;
      const trig = document.createElement('button');
      trig.className = `dial-trig${cur ? ' set' : ''}`;
      trig.dataset.dialUid = String(t.uid);
      if (cur) trig.style.setProperty('--t-tint', `var(--t-${cur.id})`);
      const icon = cur ? actionIconUrl(cur.pilotKey) : null;
      // Networked and pass-and-play mask for different reasons, and the chip
      // says which. Over a network we genuinely do not hold the value — the
      // most we can know is that they have committed to one.
      const online = !!getLocalSeat();
      const committed = !!this.state?.script?.commits?.[t.side];
      const maskedLabel = online ? (committed ? 'Committed' : 'Choosing…') : (t.timing ? 'Set · hidden' : 'Dial');
      trig.innerHTML = masked
        ? `<span>${maskedLabel}</span>`
        : `${icon ? `<img src="${icon}" alt="">` : ''}<span>${cur ? cur.name : 'Dial'}</span>${
          init !== undefined ? `<b>${init}</b>` : ''
        }<i>▾</i>`;
      inspectOnHover(trig, masked
        ? {
          title: 'Timing Dial',
          sub: online ? (committed ? 'committed, not yet revealed' : 'not yet committed') : 'hidden',
          lines: [online
            ? 'In an online game this client has never been sent the other squad\'s dials. They arrive only once both squads have committed to their choices, so neither can decide after seeing the other (3.3).'
            : 'Pass-and-play keeps a squad\'s dials secret until both reveal at once (3.3). This one belongs to the squad not holding the device.'],
        }
        : this.dialInfo(t, cur, init));
      trig.addEventListener('click', (ev) => {
        ev.stopPropagation();
        if (this.state && dialHidden(this.state, t)) return;
        this.openDial(t, trig);
      });
      meta.appendChild(trig);

      const pilotCard = tokenCards(this.data, t).find((c) => c.slot === 'pilot')?.card;
      const maxLink = pilotCard?.LV ?? 0;
      const link = document.createElement('span');
      link.className = 'link-ctrl';
      // The printed pilot card tints its Link mark to the pilot's faction.
      const bolt = linkIcon(pilotCard ? this.data.factionOf(pilotCard) : null);
      link.innerHTML = `<button class="lk-minus" title="Spend/lose 1 Link">−</button><b class="lk-val">${bolt}${t.link ?? 0}${maxLink ? `<small>/${maxLink}</small>` : ''}</b><button class="lk-plus" title="Recover 1 Link">+</button>`;
      inspectOnHover(link, {
        title: `${bolt}Link ${t.link ?? 0}${maxLink ? ` / ${maxLink}` : ''}`,
        sub: 'Pilot and machine sync, not hit points',
        lines: [
          'Spend 1 to Focus: reroll dice on an attack or defence roll.',
          'Lose 1 each time one of this mech’s Parts is Destroyed.',
          'At 0 the mech immediately enters SHUTDOWN stance.',
          maxLink ? `Starting value = pilot’s Link Value (${maxLink}).` : '',
        ],
      });
      link.querySelector('.lk-minus')!.addEventListener('click', () => {
        t.link = Math.max(0, (t.link ?? 0) - 1);
        if (t.link === 0) t.stance = 'shutdown';
        this.cb.onChanged();
      });
      link.querySelector('.lk-plus')!.addEventListener('click', () => {
        t.link = (t.link ?? 0) + 1;
        this.cb.onChanged();
      });
      linkCtrl = link;
    }

    if (t.kind === 'mech') {
      const stance = document.createElement('select');
      stance.className = `stance stance-${t.stance}`;
      for (const s of STANCES) {
        const o = document.createElement('option');
        o.value = s;
        o.textContent = STANCE_SHORT[s];
        if (t.stance === s) o.selected = true;
        stance.appendChild(o);
      }
      inspectOnHover(stance, this.stanceInfo(t));
      stance.addEventListener('change', () => {
        perform(this.data, this.state!, { kind: 'setStance', seat: t.side, uid: t.uid, stance: stance.value as Stance });
        this.cb.onChanged();
      });
      meta.appendChild(stance);
    } else {
      const stance = document.createElement('span');
      stance.className = `stance stance-fixed stance-${t.stance}`;
      stance.innerHTML = `<i class="stance-lock" aria-hidden="true">🔒</i>${STANCE_SHORT[t.stance]}`;
      inspectOnHover(stance, this.stanceInfo(t));
      meta.appendChild(stance);
    }

    if (linkCtrl) {
      const gap = document.createElement('span');
      gap.className = 'su-gap';
      meta.appendChild(gap);
      meta.appendChild(linkCtrl);
    }

    row.appendChild(head);
    row.appendChild(meta);
    row.appendChild(this.statusRow(t));
    row.appendChild(this.partTable(t));
    return row;
  }

  private stanceInfo(t: Token): InspectInfo {
    const def = this.data.play.stances.find((s) => s.id === t.stance);
    const fixed = t.kind !== 'mech';
    if (!def) {
      return { title: 'Stance', sub: t.stance.toUpperCase(), lines: ['No stance details loaded.'] };
    }
    const noun = t.kind === 'drone' ? 'Drone' : t.kind === 'projectile' ? 'Projectile' : 'unit';
    return {
      title: def.name,
      sub: `${def.short}${fixed ? ' · printed on the card, locked' : ' · change it each Action Opportunity'}`,
      lines: [
        def.effect,
        `<b>Use it when</b> ${def.good}`,
        `<b>Trade-off</b> ${def.cost}`,
        fixed
          ? `Every Drone, Projectile and Deployable card prints one Stance and stays in it for the whole game, so there is nothing to choose here. This ${noun} is ${def.short}.`
          : 'A Mech may pick its Stance every time it gets an Action Opportunity, before deciding whether to Maneuver.',
      ],
    };
  }

  private openDial(t: Token, trigger: HTMLElement): void {
    if (closeDialPopout() === trigger) return;

    const pop = document.createElement('div');
    pop.className = 'dial-pop';
    const pilot = pilotCard(this.data, t);
    pop.innerHTML =
      `<h5>Timing dial${pilot ? ` · ${esc(cardName(pilot))}` : ''}</h5>` +
      TIMINGS.map((def) => {
        const v = initiativeFor(this.data, t, def.id);
        const ic = actionIconUrl(def.pilotKey);
        return `<button class="dial-opt${def.id === t.timing ? ' sel' : ''}" data-t="${def.id}" style="--t-tint:var(--t-${def.id})">
          ${ic ? `<img src="${ic}" alt="">` : '<span class="dial-noicon"></span>'}
          <span>${def.name}</span><b>${v ?? '-'}</b>
        </button>`;
      }).join('') +
      `<button class="dial-opt dial-clear" data-t="">Clear the dial</button>`;

    document.body.appendChild(pop);
    placeDialPopout(pop, trigger);

    const pick = (v: string): void => {
      perform(this.data, this.state!, { kind: 'setTiming', seat: t.side, uid: t.uid, timing: v ? (v as Timing) : undefined });
      closeDialPopout();
      this.cb.onChanged();
    };
    pop.querySelectorAll<HTMLButtonElement>('.dial-opt').forEach((b) =>
      b.addEventListener('click', (ev) => {
        ev.stopPropagation();
        pick(b.dataset.t ?? '');
      }),
    );
    const onKey = (ev: KeyboardEvent): void => {
      const opts = [...pop.querySelectorAll<HTMLButtonElement>('.dial-opt')];
      if (ev.key === 'Escape') {
        ev.stopPropagation();
        closeDialPopout();
        trigger.focus();
        return;
      }
      if (ev.key !== 'ArrowDown' && ev.key !== 'ArrowUp') return;
      ev.preventDefault();
      const at = opts.indexOf(document.activeElement as HTMLButtonElement);
      const next = ev.key === 'ArrowDown' ? at + 1 : at - 1;
      opts[(next + opts.length) % opts.length]?.focus();
    };
    const onAway = (): void => {
      closeDialPopout();
    };
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', onAway);
    window.setTimeout(() => document.addEventListener('click', onAway), 0);
    openDial = {
      pop,
      trigger,
      teardown: () => {
        document.removeEventListener('keydown', onKey, true);
        document.removeEventListener('click', onAway);
        window.removeEventListener('resize', onAway);
      },
    };
    pop.querySelector<HTMLButtonElement>('.dial-opt.sel')?.focus();
  }

  private dialInfo(t: Token, cur: TimingDef | undefined, init: number | undefined): InspectInfo {
    const pilot = pilotCard(this.data, t);
    const all = pilot
      ? TIMINGS.map((x) => `${x.name} ${typeof pilot[x.pilotKey] === 'number' ? pilot[x.pilotKey] : '-'}`).join(' · ')
      : '';
    return {
      title: cur ? `Timing Dial: ${cur.name}` : 'Timing Dial not set',
      sub: cur && init !== undefined ? `Pilot Initiative ${init}` : 'Set in the Planning Phase',
      lines: [
        'Every Mech secretly picks one Timing in the Planning Phase, then all dials reveal at once. That choice fixes both when the Mech acts and which Action Type it may use.',
        'The Action Phase resolves Swift, Melee, Projectile, Firing, Movement, then Tactical.',
        'Within a Timing the lower Pilot Initiative activates first. If two are still tied, the First Player chooses the order.',
        pilot ? `${cardName(pilot)} initiative: ${all}` : 'This Mech has no Pilot card, so it has no Initiative values.',
      ],
    };
  }

  private statusRow(t: Token): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'status-row';
    for (const s of statusesFor(t.kind)) {
      const n = statusCount(t.statuses, s.id);
      const on = n > 0;
      const b = document.createElement('button');
      b.className = `status-chip shape-${s.shape}${on ? ' on' : ''}`;
      b.textContent = s.stacking && n > 1 ? `${s.icon}×${n}` : s.icon;
      b.style.setProperty('--chip-tint', s.tint);
      inspectOnHover(b, {
        title: s.stacking && on ? `${s.label} ×${n}` : s.label,
        sub: on ? `${s.icon} · on ${t.label}` : `${s.icon} · not on this unit`,
        lines: [
          SHAPE_NOTE[s.shape],
          s.note,
          s.stacking
            ? on
              ? `${n} token${n === 1 ? '' : 's'}, so ${n} fewer White ${n === 1 ? 'die' : 'dice'} on defence. Click to add another, shift-click to remove one.`
              : 'Click to put a token on the unit.'
            : on
              ? 'Click to take this token off the unit.'
              : 'Click to put this token on the unit.',
        ],
      });
      const change = (delta: number) => {
        if (delta > 0) {
          if (!s.stacking && statusCount(t.statuses, s.id)) return;
          t.statuses = addStatus(t.statuses, s.id);
        } else {
          const list = [...(t.statuses ?? [])];
          const at = list.lastIndexOf(s.id);
          if (at >= 0) list.splice(at, 1);
          t.statuses = list;
        }
        this.cb.onChanged();
      };
      b.addEventListener('click', (ev) => {
        if (!s.stacking) {
          change(statusCount(t.statuses, s.id) ? -1 : 1);
          return;
        }
        change(ev.shiftKey ? -1 : 1);
      });
      b.addEventListener('contextmenu', (ev) => {
        if (!s.stacking) return;
        ev.preventDefault();
        change(-1);
      });
      wrap.appendChild(b);
    }
    return wrap;
  }

  private partTable(t: Token): HTMLElement {
    const table = document.createElement('table');
    table.className = 'part-table';
    const body = document.createElement('tbody');

    for (const { slot, card } of tokenCards(this.data, t)) {
      const tr = document.createElement('tr');
      tr.dataset.tipCard = card.id;

      if (slot === 'pilot') {
        tr.className = 'pt-pilot';
        tr.innerHTML = `<td class="pt-slot">${SLOT_LABEL[slot]}</td>
          <td class="pt-name">${cardName(card)}</td>
          <td class="pt-def">${linkIcon(card.faction ?? this.data.factionOf(card))}${card.LV ?? 0}</td>
          <td class="pt-state">—</td>`;
        inspectOnHover(tr, {
          title: cardName(card),
          sub: `Pilot · ${card.faction ?? ''}`,
          lines: [
            `Link Value ${card.LV ?? 0}: the mech starts with this much Link.`,
            card.trait ? 'Has a trait ability.' : '',
            'Click to open this pilot’s card (trait + timing initiative values).',
          ],
        });
        tr.addEventListener('click', () => this.cb.onSelect(t.uid, 'pilot'));
        body.appendChild(tr);
        continue;
      }

      const st = t.partStates[slot as PartSlot | 'main'] ?? 'intact';
      const armor = card.armor ?? 0;
      const structure = card.structure ?? 0;
      const hasStructure = structure > 0;
      const defVal = st === 'damaged' ? structure : armor;
      tr.className = `pt-${st}`;
      tr.innerHTML = `<td class="pt-slot">${SLOT_LABEL[slot]}</td>
        <td class="pt-name">${cardName(card)}</td>
        <td class="pt-def">${st === 'destroyed' ? '—' : `${defVal}<small>W</small>`}</td>
        <td class="pt-state">${st === 'intact' ? '●' : st === 'damaged' ? '◐' : '✕'}</td>`;
      inspectOnHover(tr, {
        title: cardName(card),
        sub: `${SLOT_LABEL[slot]} · ${st.toUpperCase()}`,
        lines: [
          `Armor ${armor}${hasStructure ? ` · Structure ${structure}` : ' · no Structure value'}`,
          st === 'destroyed'
            ? 'Destroyed, so it rolls no defence dice.'
            : `Rolls ${defVal} White defence dice (${st === 'damaged' ? 'Structure, because it is Damaged' : 'Armor'}).`,
          hasStructure
            ? 'Next Penetration: ' + (st === 'intact' ? 'becomes Damaged.' : st === 'damaged' ? 'is Destroyed.' : 'already destroyed.')
            : 'No Structure, so a single Penetration destroys it outright.',
          'Click the row to advance its damage state.',
        ],
      });
      tr.addEventListener('click', () => {
        let next: typeof st;
        if (st === 'intact') next = hasStructure ? 'damaged' : 'destroyed';
        else if (st === 'damaged') next = 'destroyed';
        else next = 'intact';
        t.partStates[slot as PartSlot | 'main'] = next;
        this.cb.onChanged();
      });
      body.appendChild(tr);
    }

    table.appendChild(body);
    return table;
  }
}
