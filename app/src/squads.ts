import type { GameData } from './data';
import { cardName, SIDE_LABEL } from './data';
import { inspectOnHover, type InspectInfo } from './inspector';
import type { GameState, PartSlot, PartState, Stance, Token } from './types';
import { STATUSES } from './types';
import { SLOT_LABEL, tokenCards } from './units';

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

  private render(): void {
    if (!this.state) return;
    this.root.replaceChildren();
    for (const side of ['blue', 'red'] as const) {
      const tokens = this.state.tokens.filter((t) => t.side === side);
      const sec = document.createElement('div');
      sec.className = `squad squad-${side}`;
      const h = document.createElement('h3');
      const pts = tokens.reduce((sum, t) => sum + this.tokenPoints(t), 0);
      h.innerHTML = `${SIDE_LABEL[side]} squad <span class="pts">${pts}p · ${tokens.length} unit${tokens.length === 1 ? '' : 's'}</span>`;
      sec.appendChild(h);
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

    const meta = document.createElement('div');
    meta.className = 'squad-unit-meta';
    const pts = document.createElement('span');
    pts.className = 'su-pts';
    pts.textContent = `${this.tokenPoints(t)}p`;
    meta.appendChild(pts);

    if (t.kind === 'mech') {
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

  private statusRow(t: Token): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'status-row';
    for (const s of STATUSES) {
      const on = (t.statuses ?? []).includes(s.id);
      const b = document.createElement('button');
      b.className = `status-chip${on ? ' on' : ''}`;
      b.textContent = s.icon;
      b.style.setProperty('--chip-tint', s.tint);
      inspectOnHover(b, {
        title: s.label,
        sub: on ? `${s.icon} · on ${t.label}` : `${s.icon} · not on this unit`,
        lines: [s.note, on ? 'Click to take this token off the unit.' : 'Click to put this token on the unit.'],
      });
      b.addEventListener('click', () => {
        const cur = new Set(t.statuses ?? []);
        if (cur.has(s.id)) cur.delete(s.id);
        else cur.add(s.id);
        t.statuses = [...cur];
        this.cb.onChanged();
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
