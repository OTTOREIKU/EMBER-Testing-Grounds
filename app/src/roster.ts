import type { Card, MechLoadout } from './types';
import { BASE_FACTIONS, cardName, FACTION_LABEL, mechPartUrl, tabImageUrl, type GameData } from './data';
import { alertDialog, confirmDialog, promptDialog } from './dialog';
import { deleteMechPreset, loadMechPresets, saveMechPreset } from './presets';

const escAttr = (v: string): string => v.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

export interface RosterCallbacks {
  onAddUnit(card: Card, side: 'blue' | 'red'): void;
  onAddMech(loadout: MechLoadout, side: 'blue' | 'red'): void;
  onPreview(card: Card, opts?: { focus?: boolean }): void;
  cardFilter?(card: Card): boolean;
  cardBadge?(card: Card): string;
  now(): number;
}

const SLOTS: { key: keyof MechLoadout; label: string; type: string }[] = [
  { key: 'torso', label: 'Torso', type: 'torso' },
  { key: 'chasis', label: 'Chassis', type: 'chasis' },
  { key: 'leftHand', label: 'Left arm', type: 'leftHand' },
  { key: 'rightHand', label: 'Right arm', type: 'rightHand' },
  { key: 'backpack', label: 'Backpack', type: 'backpack' },
  { key: 'pilot', label: 'Pilot', type: 'pilot' },
];

export class Roster {
  private data: GameData;
  private cb: RosterCallbacks;
  private body: HTMLElement;
  private tab: 'drones' | 'mech' | 'projectiles' | 'tactics' = 'drones';
  private search = '';
  private mech: MechLoadout = {};

  constructor(data: GameData, cb: RosterCallbacks) {
    this.data = data;
    this.cb = cb;
    this.body = document.getElementById('add-body')!;
    for (const btn of document.querySelectorAll<HTMLButtonElement>('#add-tabs button')) {
      btn.addEventListener('click', () => {
        document.querySelectorAll('#add-tabs button').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        this.tab = btn.dataset.tab as typeof this.tab;
        this.render();
      });
    }
    this.render();
  }

  render(): void {
    this.body.replaceChildren();
    if (this.tab === 'mech') return this.renderMechBuilder();
    if (this.tab === 'tactics') return this.renderTactics();
    const category = this.tab === 'drones' ? 'drone' : 'projectile';

    const searchEl = document.createElement('input');
    searchEl.type = 'search';
    searchEl.placeholder = 'Search…';
    searchEl.value = this.search;
    searchEl.addEventListener('input', () => {
      this.search = searchEl.value;
      list.replaceChildren(...this.buildRows(category));
    });
    this.body.appendChild(searchEl);

    const list = document.createElement('div');
    list.className = 'unit-list';
    list.replaceChildren(...this.buildRows(category));
    this.body.appendChild(list);
  }

  private buildRows(category: 'drone' | 'projectile'): HTMLElement[] {
    const q = this.search.toLowerCase();
    const cards = this.data.cards
      .filter((c) => c.category === category)
      .filter((c) => this.cb.cardFilter?.(c) ?? true)
      .filter((c) => !q || cardName(c).toLowerCase().includes(q) || c.id.toLowerCase().includes(q))
      .sort((a, b) => cardName(a).localeCompare(cardName(b)));
    return cards.map((c) => {
      const row = document.createElement('div');
      row.className = 'unit-row';
      row.dataset.tipCard = c.id;
      const name = document.createElement('button');
      name.className = 'unit-name';
      const badge = this.cb.cardBadge?.(c) ?? '';
      name.textContent = `${cardName(c)}${c.score ? ` · ${c.score}p` : ''}${badge}`;
      name.title = 'Show card';
      name.addEventListener('click', () => this.cb.onPreview(c));
      const addB = document.createElement('button');
      addB.className = 'add blue';
      addB.textContent = '+UN';
      addB.title = 'Add for UN (blue)';
      addB.addEventListener('click', () => this.cb.onAddUnit(c, 'blue'));
      const addR = document.createElement('button');
      addR.className = 'add red';
      addR.textContent = '+RDL';
      addR.title = 'Add for RDL (red)';
      addR.addEventListener('click', () => this.cb.onAddUnit(c, 'red'));
      row.append(name, addB, addR);
      return row;
    });
  }

  private renderTactics(): void {
    const cards = this.data.cards
      .filter((c) => c.category === 'tactics_or_upgrade')
      .filter((c) => this.cb.cardFilter?.(c) ?? true)
      .sort((a, b) => cardName(a).localeCompare(cardName(b)));

    const note = document.createElement('p');
    note.className = 'tac-note';
    note.innerHTML =
      'Tactics Cards are held in hand rather than placed on the board, so there is nothing to deploy. Each costs 30 points against your squad total. Tap one to read it.' +
      '<br><b>You may only play 1 Tactics Card per round.</b>';
    this.body.appendChild(note);

    if (!cards.length) {
      const empty = document.createElement('p');
      empty.className = 'dim';
      empty.textContent = 'No Tactics Cards match your owned boxes.';
      this.body.appendChild(empty);
      return;
    }

    const list = document.createElement('div');
    list.className = 'unit-list';
    for (const c of cards) {
      const row = document.createElement('div');
      row.className = 'unit-row';
      row.dataset.tipCard = c.id;
      const name = document.createElement('button');
      name.className = 'unit-name';
      name.innerHTML = `${cardName(c)}${c.faction ? ` <span class="tac-faction">${c.faction}</span>` : ''}`;
      name.title = 'Show this card';
      name.addEventListener('click', () => this.cb.onPreview(c));
      const pts = document.createElement('span');
      pts.className = 'tac-pts';
      pts.textContent = `${c.score ?? 0}p`;
      row.append(name, pts);
      list.appendChild(row);
    }
    this.body.appendChild(list);
  }

  private mechFactions(): { factions: string[]; unknown: number } {
    const seen = new Set<string>();
    let unknown = 0;
    for (const key of ['torso', 'chasis', 'leftHand', 'rightHand', 'backpack', 'pilot'] as const) {
      const id = this.mech[key];
      if (!id) continue;
      const card = this.data.byId.get(id);
      if (!card) continue;
      const f = this.data.factionOf(card);
      if (f) seen.add(f);
      else unknown++;
    }
    return { factions: [...seen], unknown };
  }

  private paintFaction(el: HTMLElement): void {
    const { factions, unknown } = this.mechFactions();
    el.classList.toggle('bad', factions.length > 1);
    if (!factions.length) {
      el.textContent = unknown ? 'Faction unknown for the parts picked so far.' : '';
      return;
    }
    if (factions.length === 1) {
      el.textContent = `${factions[0]} mech${
        unknown ? `, plus ${unknown} part${unknown === 1 ? '' : 's'} of unknown faction` : ''
      }. Parts and pilots from other factions are dimmed in the lists.`;
      return;
    }
    el.textContent = `Illegal: this mixes ${factions.join(' and ')}. A mech may only use parts from one faction.`;
  }

  private lockedFaction(): string | null {
    const { factions } = this.mechFactions();
    return factions.length === 1 ? factions[0] : null;
  }

  private paintFactionLock(selects: HTMLSelectElement[]): void {
    const locked = this.lockedFaction();
    for (const sel of selects) {
      for (const o of Array.from(sel.options)) {
        if (!o.value) continue;
        const card = this.data.byId.get(o.value);
        const f = card ? this.data.factionOf(card) : null;
        const off = !!locked && !!f && f !== locked;
        o.classList.toggle('off-faction', off);
        o.title = off ? `${f} card. This mech is locked to ${locked} by what you have already picked.` : '';
      }
      sel.classList.toggle('faction-locked', !!locked);
    }
  }

  private renderMechBuilder(): void {
    const wrap = document.createElement('div');
    wrap.className = 'mech-builder';
    const selects: HTMLSelectElement[] = [];
    for (const slot of SLOTS) {
      const label = document.createElement('label');
      label.textContent = slot.label;
      const sel = document.createElement('select');
      const empty = document.createElement('option');
      empty.value = '';
      empty.textContent = '—';
      sel.appendChild(empty);
      const options = this.data.cards
        .filter((c) => (slot.key === 'pilot' ? c.category === 'pilot' : c.category === 'mech_part' && c.type === slot.type))
        .filter((c) => (this.cb.cardFilter?.(c) ?? true) || this.mech[slot.key] === c.id)
        .sort((a, b) => cardName(a).localeCompare(cardName(b)));
      // Grouped by faction, in a fixed order so the list does not reshuffle as
      // parts are picked. A Mech may only use Parts from one faction (5.1), so
      // this is the division that actually decides what you can legally take.
      const groups = new Map<string, Card[]>();
      for (const c of options) {
        const key = this.data.factionOf(c) ?? '';
        const list = groups.get(key);
        if (list) list.push(c);
        else groups.set(key, [c]);
      }
      const order = [...BASE_FACTIONS, 'PD', 'COLLABORATION'];
      const keys = [...groups.keys()].sort((a, b) => {
        const ai = order.indexOf(a);
        const bi = order.indexOf(b);
        return (ai < 0 ? order.length : ai) - (bi < 0 ? order.length : bi);
      });
      for (const key of keys) {
        const group = document.createElement('optgroup');
        const members = groups.get(key)!;
        group.label = `${key ? (FACTION_LABEL[key] ?? key) : 'Faction not recorded'} · ${members.length}`;
        for (const c of members) {
          const o = document.createElement('option');
          o.value = c.id;
          o.textContent = `${cardName(c)}${c.score ? ` (${c.score}p)` : ''}${this.cb.cardBadge?.(c) ?? ''}`;
          if (this.mech[slot.key] === c.id) o.selected = true;
          group.appendChild(o);
        }
        sel.appendChild(group);
      }
      sel.addEventListener('change', () => {
        this.mech[slot.key] = sel.value || undefined;
        const card = sel.value ? this.data.byId.get(sel.value) : undefined;
        if (card) this.cb.onPreview(card, { focus: false });
        pts.textContent = this.pointsText();
        this.paintFaction(fac);
        this.paintFactionLock(selects);
      });
      selects.push(sel);
      label.appendChild(sel);
      // A native <option> cannot be hovered reliably, so the chosen card gets a
      // thumbnail beside the picker that shows the full card the usual way.
      const peek = document.createElement('span');
      peek.className = 'slot-peek';
      const paintPeek = (): void => {
        const card = this.mech[slot.key] ? this.data.byId.get(this.mech[slot.key]!) : undefined;
        peek.replaceChildren();
        if (!card) {
          delete peek.dataset.tipCard;
          peek.classList.add('empty');
          peek.textContent = '?';
          return;
        }
        peek.classList.remove('empty');
        peek.dataset.tipCard = card.id;
        const img = document.createElement('img');
        const sources = [mechPartUrl(card.id), tabImageUrl(card.id)];
        let next = 0;
        const advance = (): void => {
          if (next < sources.length) img.src = sources[next++];
          else img.remove();
        };
        img.addEventListener('error', advance);
        advance();
        peek.appendChild(img);
      };
      paintPeek();
      peek.addEventListener('click', () => {
        const card = this.mech[slot.key] ? this.data.byId.get(this.mech[slot.key]!) : undefined;
        if (card) this.cb.onPreview(card);
      });
      sel.addEventListener('change', paintPeek);
      label.appendChild(peek);
      wrap.appendChild(label);
    }
    const pts = document.createElement('p');
    pts.className = 'points';
    pts.textContent = this.pointsText();
    wrap.appendChild(pts);

    const fac = document.createElement('p');
    fac.className = 'mech-faction';
    wrap.appendChild(fac);
    this.paintFaction(fac);
    this.paintFactionLock(selects);

    // Presets sit directly above the add buttons, so a build can be stored and
    // recalled without rebuilding it slot by slot every game.
    const presets = document.createElement('div');
    presets.className = 'mech-presets';
    const renderPresets = (): void => {
      const list = loadMechPresets();
      presets.innerHTML = `<select class="preset-pick"><option value="">Saved mechs…</option>${list
        .map((p) => `<option value="${escAttr(p.id)}">${escAttr(p.name)}</option>`)
        .join('')}</select>
        <button class="preset-save" title="Save the current build under a name">Save</button>
        <button class="preset-del" title="Delete the selected preset" ${list.length ? '' : 'disabled'}>✕</button>`;
      const pick = presets.querySelector<HTMLSelectElement>('.preset-pick')!;
      pick.addEventListener('change', () => {
        const found = loadMechPresets().find((p) => p.id === pick.value);
        if (!found) return;
        this.mech = { ...found.mech };
        this.render();
      });
      presets.querySelector('.preset-save')!.addEventListener('click', () => {
        void (async () => {
          const suggested = this.mech.torso ? cardName(this.data.byId.get(this.mech.torso)!) : 'My mech';
          const name = await promptDialog({
            title: 'Save this mech',
            body: 'Saved builds are kept on this device and can be dropped onto the board in any later game. Reusing a name overwrites that preset.',
            value: suggested,
            placeholder: 'Preset name',
            confirmLabel: 'Save',
          });
          if (!name) return;
          saveMechPreset(name, this.mech, this.cb.now());
          this.render();
        })();
      });
      presets.querySelector('.preset-del')!.addEventListener('click', () => {
        void (async () => {
          const found = loadMechPresets().find((p) => p.id === pick.value);
          if (!found) return;
          const ok = await confirmDialog({
            title: `Delete “${found.name}”?`,
            body: 'This only removes the saved build. Anything already on the board stays.',
            confirmLabel: 'Delete',
            danger: true,
          });
          if (!ok) return;
          deleteMechPreset(found.id);
          this.render();
        })();
      });
    };
    renderPresets();
    wrap.appendChild(presets);

    const btns = document.createElement('div');
    btns.className = 'mech-add-btns';
    for (const side of ['blue', 'red'] as const) {
      const b = document.createElement('button');
      b.className = `add ${side}`;
      b.textContent = `Add mech (${side === 'blue' ? 'UN' : 'RDL'})`;
      b.addEventListener('click', () => {
        void (async () => {
          const missing = [
            this.mech.torso ? '' : 'a Torso',
            this.mech.chasis ? '' : 'a Chassis',
            this.mech.leftHand || this.mech.rightHand ? '' : 'at least one Arm',
          ].filter(Boolean);
          if (missing.length) {
            await alertDialog({
              title: 'That mech is not legal yet',
              body: `A mech needs a Torso, a Chassis and at least one Arm (rulebook 2.2.2). Still to pick: ${missing.join(', ')}.`,
            });
            return;
          }
          const { factions } = this.mechFactions();
          if (factions.length > 1) {
            const ok = await confirmDialog({
              title: 'That mech mixes factions',
              body: `It uses ${factions.join(' and ')} parts. Rulebook 5.1 says a Mech can only be composed of Parts from a single faction, so this build is not legal.`,
              confirmLabel: 'Add it anyway',
              cancelLabel: 'Let me fix it',
              danger: true,
            });
            if (!ok) return;
          }
          this.cb.onAddMech({ ...this.mech }, side);
          // Those Parts are on the board now, so start the next build empty.
          this.mech = {};
          this.render();
        })();
      });
      btns.appendChild(b);
    }
    wrap.appendChild(btns);
    this.body.appendChild(wrap);
  }

  private pointsText(): string {
    let total = 0;
    for (const slot of SLOTS) {
      const id = this.mech[slot.key];
      const c = id ? this.data.byId.get(id) : undefined;
      if (c?.score) total += c.score;
    }
    return `Squad points: ${total}`;
  }
}
