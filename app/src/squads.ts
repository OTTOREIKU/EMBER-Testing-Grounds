import type { GameData } from './data';
import { cardName, FACTION_LABEL, SIDE_LABEL } from './data';
import { inspectOnHover, linkMechanics, type InspectInfo } from './inspector';
import type { GameState, PartSlot, PartState, Stance, Timing, TimingDef, Token } from './types';
import { SCALES, statusCount, STATUSES, TIMINGS } from './types';
import { factionProblems, initiativeFor, pilotCard, SLOT_LABEL, tokenCards, tokenFactions } from './units';

const esc = (s: string): string => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);

const NEXT_STATE: Record<PartState, PartState> = { intact: 'damaged', damaged: 'destroyed', destroyed: 'intact' };
const STANCES: Stance[] = ['offensive', 'defensive', 'mobility', 'shutdown'];
const STANCE_SHORT: Record<Stance, string> = { offensive: 'OFF', defensive: 'DEF', mobility: 'MOB', shutdown: 'SHUT' };

export interface SquadCallbacks {
  onSelect(uid: number, focusSlot?: string): void;
  onChanged(): void;
  onDelete(uid: number): void;
}

export class SquadTracker {
  private data: GameData;
  private cb: SquadCallbacks;
  private root: HTMLElement;
  private state: GameState | null = null;
  private selectedUid: number | null = null;

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
    this.root.replaceChildren();
    const order = this.orderPanel();
    if (order) this.root.appendChild(order);
    for (const side of ['blue', 'red'] as const) {
      const tokens = this.state.tokens.filter((t) => t.side === side);
      const sec = document.createElement('div');
      sec.className = `squad squad-${side}`;
      const h = document.createElement('h3');
      const pts = tokens.reduce((sum, t) => sum + this.tokenPoints(t), 0);
      const activeScale = this.state.scale ?? 'standard';
      const sc = SCALES.find((x) => x.id === activeScale)!;
      const over = !sc.openEnded && pts > sc.points;
      const squadFactions = [...new Set(tokens.flatMap((t) => tokenFactions(this.data, t).factions))];
      const facChip =
        squadFactions.length === 1
          ? `<span class="fac-chip">${FACTION_LABEL[squadFactions[0]] ?? squadFactions[0]}</span>`
          : squadFactions.length > 1
            ? `<span class="fac-chip bad">${squadFactions.map((f) => FACTION_LABEL[f] ?? f).join(' + ')}</span>`
            : '';
      const teamName = this.state.sideNames?.[side];
      h.innerHTML = `${teamName ? esc(teamName) : `${SIDE_LABEL[side]} squad`}${facChip} <span class="pts${over ? ' over' : ''}">${pts}<small>/${sc.points}${sc.openEnded ? '+' : ''}</small>p · ${tokens.length} unit${tokens.length === 1 ? '' : 's'}</span>`;
      inspectOnHover(h, {
        title: `${SIDE_LABEL[side]} squad`,
        sub: `${pts} points of ${sc.points}${sc.openEnded ? ' or more' : ''} · ${sc.name} battle`,
        lines: over
          ? [
              `This squad is ${pts - sc.points} points over the ${sc.name} limit of ${sc.points}.`,
              'Remove a unit, or switch the battle scale in the round bar at the top of the board.',
              'Nothing is blocked here, so you can keep playing an oversized game if you both agree.',
            ]
          : [
              `${sc.points - pts} points still available at this battle scale.`,
              'Every Part, Pilot and Drone counts. Projectiles and Deployables are Low Value Units worth 0.',
              'Change the battle scale in the round bar above the board.',
            ],
      });
      sec.appendChild(h);
      if (over) {
        const warn = document.createElement('p');
        warn.className = 'squad-over';
        warn.textContent = `Over the ${sc.name} limit by ${pts - sc.points} points.`;
        sec.appendChild(warn);
      }
      for (const p of factionProblems(this.data, tokens)) {
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

  private tokenPoints(t: Token): number {
    return tokenCards(this.data, t).reduce((s, { card }) => s + (card.score ?? 0), 0);
  }

  private unitRow(t: Token): HTMLElement {
    const row = document.createElement('div');
    row.className = `squad-unit${t.uid === this.selectedUid ? ' selected' : ''}`;

    const head = document.createElement('div');
    head.className = 'squad-unit-head';

    const name = document.createElement('button');
    name.className = 'squad-unit-name';
    const kind = t.kind === 'mech' ? 'MECH' : t.kind === 'drone' ? 'DRONE' : 'PROJ';
    name.innerHTML = `<span class="pt-kind kind-${t.kind}">${kind}</span><span class="su-label">${t.label}</span>`;
    const parts = Object.entries(t.partStates);
    inspectOnHover(name, {
      title: t.label,
      sub: `${SIDE_LABEL[t.side]} · ${t.kind} · ${this.tokenPoints(t)} pts`,
      lines: [
        `Stance ${t.stance.toUpperCase()}${t.link !== undefined ? ` · Link ⚡${t.link}` : ''}`,
        `Grid ${String.fromCharCode(65 + Math.floor(t.col / 3))}${Math.floor(t.row / 3) + 1} · facing ${['North', 'East', 'South', 'West'][t.facing]}`,
        `${parts.filter(([, s]) => s === 'intact').length} intact, ${parts.filter(([, s]) => s === 'damaged').length} damaged, ${parts.filter(([, s]) => s === 'destroyed').length} destroyed`,
        'Click to select this unit on the board.',
      ],
    });
    name.addEventListener('click', () => this.cb.onSelect(t.uid));
    head.appendChild(name);

    const headPts = document.createElement('span');
    headPts.className = 'su-pts su-pts-head';
    headPts.textContent = `${this.tokenPoints(t)}p`;
    head.appendChild(headPts);

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

    if (t.kind === 'mech') {
      const dial = document.createElement('span');
      dial.className = `dial-ctrl${t.timing ? ' set' : ''}`;
      if (t.timing) dial.style.setProperty('--t-tint', `var(--t-${t.timing})`);
      const cur = t.timing ? TIMINGS.find((x) => x.id === t.timing) : undefined;
      const init = t.timing ? initiativeFor(this.data, t, t.timing) : undefined;
      dial.innerHTML = `<select class="dial-sel" title="Timing Dial">
          <option value=""${t.timing ? '' : ' selected'}>Dial…</option>
          ${TIMINGS.map((x) => `<option value="${x.id}"${x.id === t.timing ? ' selected' : ''}>${x.name}</option>`).join('')}
        </select>${cur && init !== undefined ? `<b class="dial-init" title="Pilot Initiative for ${cur.name}">${init}</b>` : ''}`;
      inspectOnHover(dial, this.dialInfo(t, cur, init));
      dial.querySelector<HTMLSelectElement>('.dial-sel')!.addEventListener('change', (ev) => {
        const v = (ev.target as HTMLSelectElement).value;
        t.timing = v ? (v as Timing) : undefined;
        this.cb.onChanged();
      });
      meta.appendChild(dial);

      const pilotCard = tokenCards(this.data, t).find((c) => c.slot === 'pilot')?.card;
      const maxLink = pilotCard?.LV ?? 0;
      const link = document.createElement('span');
      link.className = 'link-ctrl';
      link.innerHTML = `<button class="lk-minus" title="Spend/lose 1 Link">−</button><b class="lk-val">⚡${t.link ?? 0}${maxLink ? `<small>/${maxLink}</small>` : ''}</b><button class="lk-plus" title="Recover 1 Link">+</button>`;
      inspectOnHover(link, {
        title: `Link ${t.link ?? 0}${maxLink ? ` / ${maxLink}` : ''}`,
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
      meta.appendChild(link);
    }

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
      t.stance = stance.value as Stance;
      this.cb.onChanged();
    });
    meta.appendChild(stance);

    const del = document.createElement('button');
    del.className = 'squad-del';
    del.textContent = '✕';
    del.title = 'Remove this unit from the board';
    del.addEventListener('click', () => this.cb.onDelete(t.uid));
    meta.appendChild(del);

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
    return {
      title: def.name,
      sub: `${def.short}${fixed ? ' · fixed on this unit type' : ' · change it each Action Opportunity'}`,
      lines: [
        def.effect,
        `<b>Use it when</b> ${def.good}`,
        `<b>Trade-off</b> ${def.cost}`,
        fixed
          ? 'Drones, Projectiles and Deployables have a fixed Stance printed on their card and cannot change it.'
          : 'A Mech may pick its Stance every time it gets an Action Opportunity, before deciding whether to Maneuver.',
      ],
    };
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
    for (const s of STATUSES) {
      const n = statusCount(t.statuses, s.id);
      const on = n > 0;
      const b = document.createElement('button');
      b.className = `status-chip${on ? ' on' : ''}`;
      b.textContent = s.stacking && n > 1 ? `${s.icon}×${n}` : s.icon;
      b.style.setProperty('--chip-tint', s.tint);
      inspectOnHover(b, {
        title: s.stacking && on ? `${s.label} ×${n}` : s.label,
        sub: on ? `${s.icon} · on ${t.label}` : `${s.icon} · not on this unit`,
        lines: [
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
        const list = [...(t.statuses ?? [])];
        if (delta > 0) {
          if (s.stacking || !list.includes(s.id)) list.push(s.id);
        } else {
          const at = list.lastIndexOf(s.id);
          if (at >= 0) list.splice(at, 1);
        }
        t.statuses = list;
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
          <td class="pt-def">⚡${card.LV ?? 0}</td>
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
