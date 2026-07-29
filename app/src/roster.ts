import type { Card, MechLoadout } from './types';
import { BASE_FACTIONS, cardName, FACTION_LABEL, mechPartUrl, SIDE_LABEL, tabImageUrl, type GameData } from './data';
import { inspectOnHover } from './inspector';
import { alertDialog, confirmDialog, promptDialog } from './dialog';
import { deleteMechPreset, loadMechPresets, saveMechPreset } from './presets';

const escAttr = (v: string): string => v.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

export interface RosterCallbacks {
  onAddUnit(card: Card, side: 'blue' | 'red'): void;
  onAddMech(loadout: MechLoadout, side: 'blue' | 'red'): void;
  onSaveMech(uid: number, loadout: MechLoadout): void;
  onPreview(card: Card, opts?: { focus?: boolean }): void;
  cardFilter?(card: Card): boolean;
  cardBadge?(card: Card): string;
  pointsCap?(): { name: string; points: number; openEnded: boolean } | null;
  squadPoints?(): { blue: number; red: number };
  heldTactics?(): { blue: string[]; red: string[] };
  onAddTactic?(card: Card, side: 'blue' | 'red'): void;
  onDropTactic?(card: Card, side: 'blue' | 'red'): void;
  now(): number;
}

const MELON_RIND = 'M2,6A10,10 0 0,0 22,6Z M3.5,6A8.5,8.5 0 0,0 20.5,6Z';
const MELON_FLESH = 'M4.4,6A7.6,7.6 0 0,0 19.6,6Z'
  + [[7.8,8.5],[10.4,8.1],[13.2,8.3],[15.9,8.6],[9.1,10.5],[11.9,10.7],[14.7,10.4],[7.2,10.0],[16.9,9.9],[10.5,12.5],[13.4,12.4],[12.0,9.3]]
    .map(([cx, cy]) => `M${cx - 0.5},${cy}a0.5,0.78 0 1,0 1,0a0.5,0.78 0 1,0 -1,0Z`).join('');

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
  private editing: { uid: number; side: 'blue' | 'red'; label: string } | null = null;

  // The build rules are the same whether a mech is being added or edited, so
  // both paths run this and only the confirm wording changes.
  private async legalBuild(confirmLabel: string): Promise<boolean> {
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
      return false;
    }
    const { factions } = this.mechFactions();
    if (factions.length > 1) {
      return confirmDialog({
        title: 'That mech mixes factions',
        body: `It uses ${factions.join(' and ')} parts. Rulebook 5.1 says a Mech can only be composed of Parts from a single faction, so this build is not legal.`,
        confirmLabel,
        cancelLabel: 'Let me fix it',
        danger: true,
      });
    }
    return true;
  }

  // Pulls an existing mech off the board and back onto the bench.
  editMech(uid: number, side: 'blue' | 'red', label: string, loadout: MechLoadout): void {
    this.editing = { uid, side, label };
    this.mech = { ...loadout };
    this.tab = 'mech';
    for (const b of document.querySelectorAll<HTMLButtonElement>('#add-tabs button')) {
      b.classList.toggle('active', b.dataset.tab === 'mech');
    }
    this.render();
  }

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
      // Points ride in their own cell so they line up down the list instead of
      // trailing each name at a different indent.
      const name = document.createElement('button');
      name.className = 'unit-name';
      const badge = this.cb.cardBadge?.(c) ?? '';
      // Low Value units really do cost nothing, so they get a dash rather than a
      // blank cell, which in a column reads as a missing value.
      name.innerHTML = `<span class="un-name"></span>${badge ? `<span class="un-badge"></span>` : ''}<span class="un-pts">${c.score ? `${c.score}p` : '—'}</span>`;
      name.querySelector('.un-name')!.textContent = cardName(c);
      if (badge) name.querySelector('.un-badge')!.textContent = badge;
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

      const held = this.cb.heldTactics?.();
      for (const side of ['blue', 'red'] as const) {
        const n = held ? held[side].filter((x) => x === c.id).length : 0;
        const b = document.createElement('button');
        b.className = `tac-add side-${side}${n ? ' has' : ''}`;
        b.textContent = n ? `${SIDE_LABEL[side]} ×${n}` : SIDE_LABEL[side];
        b.title = n
          ? `In the ${SIDE_LABEL[side]} squad. Click to add another, right-click to remove one.`
          : `Add to the ${SIDE_LABEL[side]} squad`;
        b.addEventListener('click', () => this.cb.onAddTactic?.(c, side));
        b.addEventListener('contextmenu', (ev) => {
          ev.preventDefault();
          if (n) this.cb.onDropTactic?.(c, side);
        });
        row.appendChild(b);
      }
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
    if (this.editing) {
      const flag = document.createElement('p');
      flag.className = 'mech-editing';
      flag.textContent = `Editing ${this.editing.label}. Damage on any part you change is cleared; everything else about the unit stays as it is.`;
      wrap.appendChild(flag);
    }
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
    if (this.editing) {
      const ed = this.editing;
      const save = document.createElement('button');
      save.className = `add ${ed.side}`;
      save.textContent = 'Save changes';
      save.addEventListener('click', () => {
        void (async () => {
          if (!(await this.legalBuild('Save it anyway'))) return;
          this.cb.onSaveMech(ed.uid, { ...this.mech });
          this.editing = null;
          this.mech = {};
          this.render();
        })();
      });
      const cancel = document.createElement('button');
      cancel.className = 'add grey';
      cancel.textContent = 'Cancel';
      cancel.addEventListener('click', () => {
        this.editing = null;
        this.mech = {};
        this.render();
      });
      btns.append(save, cancel);
    } else {
      for (const side of ['blue', 'red'] as const) {
        const b = document.createElement('button');
        b.className = `add ${side}`;
        b.textContent = `Add mech (${side === 'blue' ? 'UN' : 'RDL'})`;
        b.addEventListener('click', () => {
          void (async () => {
            if (!(await this.legalBuild('Add it anyway'))) return;
            this.cb.onAddMech({ ...this.mech }, side);
            // Those Parts are on the board now, so start the next build empty.
            this.mech = {};
            this.render();
          })();
        });
        btns.appendChild(b);
      }
    }
    wrap.appendChild(btns);

    const squad = document.createElement('div');
    squad.className = 'mech-squad-btns';
    const builder = document.createElement('a');
    builder.id = 'btn-builder';
    builder.className = 'squad-btn';
    builder.href = 'https://watermelon02.github.io/builder-web/';
    builder.target = '_blank';
    builder.rel = 'noopener';
    builder.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill-rule="evenodd" d="${MELON_RIND}"/><path fill-rule="evenodd" d="${MELON_FLESH}"/></svg>Squad Builder`;
    inspectOnHover(builder, {
      title: 'Squad Builder',
      lines: [
        "Opens watermelon's community squad builder in a new tab.",
        'Build a list there, export it, then bring it back with Import Squad.',
      ],
    });
    const imp = document.createElement('button');
    imp.className = 'squad-btn';
    imp.textContent = 'Import Squad';
    inspectOnHover(imp, {
      title: 'Import Squad',
      lines: ['Reads a squad exported from the builder site.', 'Accepts either the .json export or the squad .png image.'],
    });
    imp.addEventListener('click', () => document.getElementById('import-squad-file')!.click());
    squad.append(builder, imp);
    wrap.appendChild(squad);

    this.body.appendChild(wrap);
  }

  private pointsText(): string {
    let total = 0;
    for (const slot of SLOTS) {
      const id = this.mech[slot.key];
      const c = id ? this.data.byId.get(id) : undefined;
      if (c?.score) total += c.score;
    }
    const lines = [`Current build: ${total} points`];
    const squads = this.cb.squadPoints?.();
    if (squads) lines.push(`Squad points: UN ${squads.blue} / RDL ${squads.red}`);
    const cap = this.cb.pointsCap?.();
    if (cap) {
      const limit = `${cap.points}${cap.openEnded ? '+' : ''}`;
      const worst = squads ? Math.max(squads.blue, squads.red) : total;
      const over = !cap.openEnded && worst > cap.points;
      lines.push(`Battle size: ${cap.name}, ${limit} points${over ? ' — over the cap' : ''}`);
    }
    return lines.join('\n');
  }
}
