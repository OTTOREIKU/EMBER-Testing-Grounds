import type { Card, MechLoadout, Side } from './types';
import { BASE_FACTIONS, cardName, FACTION_LABEL, isDiscardCard, mechPartUrl, SQUAD_ORDER, squadLabel, squadNumber, tabImageUrl, type GameData } from './data';
import { inspectOnHover } from './inspector';
import { alertDialog, confirmDialog, promptDialog } from './dialog';
import { deleteMechPreset, isBuiltInPreset, loadMechPresets, saveMechPreset } from './presets';
import { deleteSquad, isBuiltInSquad, loadSquads } from './squadstore';
import { canBeLoad, cardFitsSquad, isCarrier, type SquadAllegiance } from './units';
import { ICON_EXPAND, squadColour } from './icons';
import { groupByFaction, openPartPicker } from './partpicker';

const escAttr = (v: string): string => v.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

export interface RosterCallbacks {
  squadAllegiance(side: Side): SquadAllegiance;
  // `load` is the Part a Carrier drone carries onto the board (FAQ O3-O8). Only
  // a Carrier ever passes one, and it may be left off - a Tarantula is allowed
  // to stand there with nothing on its back (O8).
  onAddUnit(card: Card, side: Side, load?: string): void;
  onAddMech(loadout: MechLoadout, side: Side): void;
  onSaveMech(uid: number, loadout: MechLoadout): void;
  onPreview(card: Card, opts?: { focus?: boolean }): void;
  cardFilter?(card: Card): boolean;
  cardBadge?(card: Card): string;
  pointsCap?(): { name: string; points: number; openEnded: boolean } | null;
  squadPoints?(): { s1: number; s2: number };
  heldTactics?(): { s1: string[]; s2: string[] };
  onAddTactic?(card: Card, side: Side): void;
  onDropTactic?(card: Card, side: Side): void;
  // The full-squad library. Saving needs the board and its dialogs, loading
  // goes through the importSquad command, so both live in main and the roster
  // only asks.
  onSaveSquad?(): Promise<void>;
  onLoadSquad?(id: string): void;
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
  // What each Carrier drone will be sent onto the board carrying, keyed by the
  // drone's card id. Held here rather than on the row so it survives the
  // re-render that picking a Load causes, and so adding the same Carrier to both
  // squads gives them the same Load without choosing twice.
  private droneLoads: Record<string, string> = {};
  private presetId = '';
  private squadId = '';
  private editing: { uid: number; side: Side; label: string } | null = null;

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
  editMech(uid: number, side: Side, label: string, loadout: MechLoadout): void {
    this.editing = { uid, side, label };
    this.mech = { ...loadout };
    this.tab = 'mech';
    for (const b of document.querySelectorAll<HTMLButtonElement>('#add-tabs button')) {
      b.classList.toggle('active', b.dataset.tab === 'mech');
    }
    this.render();
  }

  // Every "put this in a squad" button in the Add tab is built here so the
  // number, the colour and the off-faction dimming cannot drift apart between
  // the drone list, the projectile list, the tactics list and the mech builder.
  // The label is always the squad number: renaming a squad must not move the
  // buttons around under the player's cursor. Pass no card to get the button
  // without the faction test, which is what the tactics list wants.
  private squadButton(side: Side, card: Card | null, suffix = ''): HTMLButtonElement {
    const b = document.createElement('button');
    b.className = 'add sq-add';
    b.textContent = `${squadNumber(side)}${suffix}`;
    const faction = this.cb.squadAllegiance(side).faction;
    if (faction) {
      b.classList.add('has-faction');
      b.style.setProperty('--sq-tint', squadColour(faction));
    }
    const fits = card ? this.squadTakes(side, card) : { ok: true, why: '' };
    if (!fits.ok) {
      b.classList.add('off-faction');
      // The reason is three sentences of rules, which is too much for a cursor
      // tooltip. The button says what is wrong and the details panel explains.
      b.title = `Off-faction for ${squadLabel(side)}`;
      inspectOnHover(b, {
        title: `${squadLabel(side)} would mix factions`,
        sub: 'Rulebook 5.1, squad composition',
        lines: [
          fits.why,
          'A squad may only hold one faction, and mercenaries (PD, Collaboration) may join any of them.',
          'Nothing is blocked. Add it and the Squads tab will flag the squad as illegal.',
        ],
      });
    } else {
      b.title = `Add to ${squadLabel(side)}`;
    }
    return b;
  }

  // `why` is one plain sentence naming the clash. Callers that have somewhere to
  // put the rest — the details panel — add it; the part browser has only a
  // tooltip, because its own window covers that panel.
  private squadTakes(side: Side, card: Card): { ok: boolean; why: string } {
    const a = this.cb.squadAllegiance(side);
    if (cardFitsSquad(this.data, a, card)) return { ok: true, why: '' };
    const theirs = FACTION_LABEL[a.faction!] ?? a.faction;
    const f = this.data.factionOf(card);
    const mine = f ? (FACTION_LABEL[f] ?? f) : 'of no known faction';
    return { ok: false, why: `${squadLabel(side)} is ${theirs}, and this is ${mine}.` };
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
    // Drones get the same browser the mech slots have. Projectiles do not: they
    // are launched from a Part rather than chosen against each other.
    if (category === 'drone') {
      const bar = document.createElement('div');
      bar.className = 'add-bar';
      const pop = document.createElement('button');
      pop.type = 'button';
      pop.className = 'slot-pop';
      pop.innerHTML = ICON_EXPAND;
      pop.title = 'Browse and compare Drone cards';
      pop.addEventListener('click', () => this.openDronePicker());
      bar.append(searchEl, pop);
      this.body.appendChild(bar);
    } else {
      this.body.appendChild(searchEl);
    }

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
      const adds = SQUAD_ORDER.map((side) => {
        const b = this.squadButton(side, c);
        b.addEventListener('click', () => this.cb.onAddUnit(c, side, this.droneLoads[c.id]));
        return b;
      });
      // Only a Carrier gets the extra control, so every other row keeps its
      // shape. The Load is chosen before the drone is added, because it is what
      // the drone walks on with.
      row.append(name, ...(isCarrier(c) ? [this.loadButton(c)] : []), ...adds);
      return row;
    });
  }

  // A Carrier lends the Part on its back to a Mech it is touching, so the Part
  // has to be picked before the drone goes down. Empty is a real answer (O8).
  private loadButton(carrier: Card): HTMLButtonElement {
    const chosen = this.droneLoads[carrier.id];
    const card = chosen ? this.data.byId.get(chosen) : undefined;
    const b = document.createElement('button');
    b.className = `add load-pick${card ? ' has-load' : ''}`;
    b.textContent = card ? cardName(card) : 'Load…';
    b.title = card
      ? `Carrying ${cardName(card)}. Click to change it, or pick the same one again to take it off.`
      : 'Give this Carrier a Part to lend. Optional: it can go on empty.';
    inspectOnHover(b, {
      title: card ? `Load: ${cardName(card)}` : 'Load',
      sub: 'Official FAQ O3-O8',
      lines: [
        'A Carrier holds one Part and lends it to a friendly Mech it is in contact with.',
        'The Carrier gains none of the Part\'s Actions or attributes; it is only carrying it.',
        'Ammo spent from the borrowed Part comes off the Carrier, not the Mech.',
        'It counts when the Mech initiates, never when it is the one being rolled against.',
      ],
    });
    b.addEventListener('click', () => this.openLoadPicker(carrier));
    return b;
  }

  private openLoadPicker(carrier: Card): void {
    const faction = this.data.factionOf(carrier);
    const parts = this.data.cards
      .filter((c) => c.category === 'mech_part' && canBeLoad(c) && !isDiscardCard(c))
      .filter((c) => this.cb.cardFilter?.(c) ?? true)
      .sort((a, b) => cardName(a).localeCompare(cardName(b)));
    openPartPicker({
      data: this.data,
      slotLabel: `Load for ${cardName(carrier)}`,
      groups: this.byFaction(parts),
      chosen: this.droneLoads[carrier.id],
      lockedFaction: faction,
      actions: [
        {
          label: 'Carry this',
          run: (card: Card) => {
            // Choosing what it already holds takes it off again, which is the
            // only way back to an empty Carrier once one is picked.
            if (this.droneLoads[carrier.id] === card.id) delete this.droneLoads[carrier.id];
            else this.droneLoads[carrier.id] = card.id;
            this.render();
          },
        },
      ],
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
      'Tactics Cards are held in hand rather than placed on the board, so there is nothing to deploy. Each costs 30 points against your squad total, and only one copy of each may be included (FAQ P2). Tap one to read it.' +
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
      // Laid out exactly like a drone row so the faction tags and the points
      // form straight columns instead of trailing each name at its own indent.
      const name = document.createElement('button');
      name.className = 'unit-name';
      name.innerHTML = `<span class="un-name"></span><span class="tac-faction"></span><span class="un-pts">${c.score ?? 0}p</span>`;
      name.querySelector('.un-name')!.textContent = cardName(c);
      name.querySelector('.tac-faction')!.textContent = c.faction ? (FACTION_LABEL[c.faction] ?? c.faction) : '';
      name.title = 'Show this card';
      name.addEventListener('click', () => this.cb.onPreview(c));
      row.append(name);

      const held = this.cb.heldTactics?.();
      for (const side of SQUAD_ORDER) {
        const n = held ? held[side].filter((x) => x === c.id).length : 0;
        // Every Tactics Card prints a faction emblem, but 5.1 restricts Units
        // and 5.4.2 calls these commander actions rather than Units, so they
        // join any squad. Passing no card skips the faction test. Only one
        // copy of each may be purchased (FAQ P2), so a held card's button
        // turns into its own remover rather than offering a second copy.
        const b = this.squadButton(side, null, n ? ' ✓' : '');
        if (n) b.classList.add('has');
        if (!b.classList.contains('off-faction')) {
          b.title = n
            ? `In ${squadLabel(side)}. Click or right-click to take it back out. Only one copy of each Tactics Card may be included (FAQ P2).`
            : `Add to ${squadLabel(side)}`;
        }
        b.addEventListener('click', () => {
          if (n) this.cb.onDropTactic?.(c, side);
          else this.cb.onAddTactic?.(c, side);
        });
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

  // The one place that decides what may go in a slot. Both the dropdown and the
  // popout picker read it, so a card can never be offered by one and withheld by
  // the other.
  private slotCards(slot: { key: keyof MechLoadout; type: string }): Card[] {
    return this.data.cards
      .filter((c) => (slot.key === 'pilot' ? c.category === 'pilot' : c.category === 'mech_part' && c.type === slot.type))
      // A Discard Card is the flipped face of a Part you already own, not a
      // Part you can equip, so it has no business in a build picker. Kept if
      // somehow already selected, so an old save still shows what it holds.
      .filter((c) => !isDiscardCard(c) || this.mech[slot.key] === c.id)
      .filter((c) => (this.cb.cardFilter?.(c) ?? true) || this.mech[slot.key] === c.id)
      .sort((a, b) => cardName(a).localeCompare(cardName(b)));
  }

  // Grouped by faction in a fixed order so the list does not reshuffle as parts
  // are picked. A Mech may only use Parts from one faction (5.1), so this is the
  // division that actually decides what you can legally take.
  private byFaction(cards: Card[]): { faction: string; cards: Card[] }[] {
    return groupByFaction(this.data, cards);
  }

  // Picking here lands in exactly the same place a dropdown change does: the
  // slot is set, the card opens in the Details panel, and the builder redraws so
  // the points, the faction line and the off-faction dimming all catch up.
  private openSlotPicker(slot: { key: keyof MechLoadout; label: string; type: string }): void {
    openPartPicker({
      data: this.data,
      slotLabel: slot.label,
      groups: this.byFaction(this.slotCards(slot)),
      chosen: this.mech[slot.key],
      lockedFaction: this.lockedFaction(),
      badge: (c) => this.cb.cardBadge?.(c) ?? '',
      actions: [
        {
          label: 'Use this',
          run: (card) => {
            this.mech[slot.key] = card.id;
            this.cb.onPreview(card, { focus: false });
            this.render();
          },
        },
      ],
    });
  }

  // The drone list has no single slot to fill, so the two squad buttons come
  // through as the actions and a row click only holds the card for comparison.
  private openDronePicker(): void {
    openPartPicker({
      data: this.data,
      slotLabel: 'Drones',
      groups: this.byFaction(
        this.data.cards
          .filter((c) => c.category === 'drone')
          .filter((c) => this.cb.cardFilter?.(c) ?? true)
          .sort((a, b) => cardName(a).localeCompare(cardName(b))),
      ),
      badge: (c) => this.cb.cardBadge?.(c) ?? '',
      actions: SQUAD_ORDER.map((side) => ({
        label: `Add to ${squadLabel(side)}`,
        tint: squadColour(this.cb.squadAllegiance(side).faction),
        check: (card: Card) => this.squadTakes(side, card),
        run: (card: Card) => {
          this.cb.onAddUnit(card, side, this.droneLoads[card.id]);
          this.render();
        },
      })),
    });
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
      const grouped = this.byFaction(this.slotCards(slot));
      for (const { faction, cards: members } of grouped) {
        const group = document.createElement('optgroup');
        group.label = `${faction ? (FACTION_LABEL[faction] ?? faction) : 'Faction not recorded'} · ${members.length}`;
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
      // A dropdown can only ever show one card at a time and cannot show the art
      // at all, so the slot also opens a browser where the scans can be read and
      // two candidates put side by side.
      const pop = document.createElement('button');
      pop.type = 'button';
      pop.className = 'slot-pop';
      pop.innerHTML = ICON_EXPAND;
      pop.title = `Browse and compare ${slot.label} cards`;
      pop.addEventListener('click', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        this.openSlotPicker(slot);
      });
      label.appendChild(pop);
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
      // Loading a preset re-renders the whole builder, which used to reset this
      // select to its placeholder. The delete button then read an empty value
      // and silently did nothing, so the choice is held on the instance and
      // re-applied here instead.
      if (this.presetId && !list.some((p) => p.id === this.presetId)) this.presetId = '';
      const chosen = list.find((p) => p.id === this.presetId);
      presets.innerHTML = `<select class="preset-pick"><option value="">Saved mechs…</option>${list
        .map((p) => `<option value="${escAttr(p.id)}"${p.id === this.presetId ? ' selected' : ''}>${escAttr(p.name)}</option>`)
        .join('')}</select>
        <button class="preset-save" title="Save the current build under a name">Save</button>
        <button class="preset-del" title="${
          !chosen
            ? 'Pick a saved mech to delete it'
            : isBuiltInPreset(chosen.id)
              ? `“${escAttr(chosen.name)}” ships with the app and cannot be deleted. Save over its name to replace it.`
              : `Delete “${escAttr(chosen.name)}”`
        }" ${chosen && !isBuiltInPreset(chosen.id) ? '' : 'disabled'}>✕</button>`;
      const pick = presets.querySelector<HTMLSelectElement>('.preset-pick')!;
      pick.addEventListener('change', () => {
        this.presetId = pick.value;
        const found = loadMechPresets().find((p) => p.id === pick.value);
        if (!found) return this.render();
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
          const found = loadMechPresets().find((p) => p.id === this.presetId);
          if (!found) return;
          const ok = await confirmDialog({
            title: `Delete “${found.name}”?`,
            body: 'This only removes the saved build. Anything already on the board stays.',
            confirmLabel: 'Delete',
            danger: true,
          });
          if (!ok) return;
          deleteMechPreset(found.id);
          this.presetId = '';
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
      // `add s1` styled nothing: there is no .s1 rule, so the button kept the
      // browser's white face while button.add forces white text, and Save read
      // as blank. It takes the squad tint the same way the Add buttons do -
      // without squadButton's off-faction check, which would compare the mech
      // against the very squad it is already in.
      save.className = 'add sq-add sq-wide';
      const saveFaction = this.cb.squadAllegiance(ed.side).faction;
      if (saveFaction) {
        save.classList.add('has-faction');
        save.style.setProperty('--sq-tint', squadColour(saveFaction));
      }
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
      for (const side of SQUAD_ORDER) {
        // The built mech has a faction of its own, so the button can say whether
        // it would clash before the player commits to the build.
        const torso = this.mech.torso ? this.data.byId.get(this.mech.torso) : undefined;
        const b = this.squadButton(side, torso ?? null);
        b.classList.add('sq-wide');
        b.textContent = `Add mech to ${squadLabel(side)}`;
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

    // The whole-squad library, in the same select–save–delete shape as the
    // mech presets above so the two read as one convention. Saving stores a
    // side's units off the board; picking one brings it back through the
    // importSquad command, so in an online room it reaches both screens.
    const squads = document.createElement('div');
    squads.className = 'mech-presets squad-presets';
    const renderSquads = (): void => {
      const list = loadSquads();
      if (this.squadId && !list.some((s) => s.id === this.squadId)) this.squadId = '';
      const chosen = list.find((s) => s.id === this.squadId);
      const blurb = (s: { mechs: unknown[]; drones: unknown[] }) =>
        [s.mechs.length ? `${s.mechs.length}M` : '', s.drones.length ? `${s.drones.length}D` : ''].filter(Boolean).join(' ');
      squads.innerHTML = `<select class="preset-pick"><option value="">Saved squads…</option>${list
        .map((s) => `<option value="${escAttr(s.id)}"${s.id === this.squadId ? ' selected' : ''}>${escAttr(`${s.name} (${blurb(s)})`)}</option>`)
        .join('')}</select>
        <button class="preset-save" title="Save a squad now on the board under a name">Save</button>
        <button class="preset-del" title="${
          !chosen
            ? 'Pick a saved squad to delete it'
            : isBuiltInSquad(chosen.id)
              ? `“${escAttr(chosen.name)}” ships with the app and cannot be deleted. Save over its name to replace it.`
              : `Delete “${escAttr(chosen.name)}”`
        }" ${chosen && !isBuiltInSquad(chosen.id) ? '' : 'disabled'}>✕</button>`;
      const pick = squads.querySelector<HTMLSelectElement>('.preset-pick')!;
      pick.addEventListener('change', () => {
        this.squadId = pick.value;
        if (pick.value) this.cb.onLoadSquad?.(pick.value);
        renderSquads();
      });
      squads.querySelector('.preset-save')!.addEventListener('click', () => {
        void this.cb.onSaveSquad?.().then(() => renderSquads());
      });
      squads.querySelector('.preset-del')!.addEventListener('click', () => {
        void (async () => {
          const found = loadSquads().find((s) => s.id === this.squadId);
          if (!found) return;
          const ok = await confirmDialog({
            title: `Delete “${found.name}”?`,
            body: 'This only removes the saved squad. Anything already on the board stays.',
            confirmLabel: 'Delete',
            danger: true,
          });
          if (!ok) return;
          deleteSquad(found.id);
          this.squadId = '';
          renderSquads();
        })();
      });
    };
    renderSquads();
    // The two libraries read as one convention, so the squads row sits right
    // under the mechs row, and the add buttons follow with room to breathe.
    wrap.append(squads, btns, squad);

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
    if (squads) lines.push(`Squad points: UN ${squads.s1} / RDL ${squads.s2}`);
    const cap = this.cb.pointsCap?.();
    if (cap) {
      const limit = `${cap.points}${cap.openEnded ? '+' : ''}`;
      const worst = squads ? Math.max(squads.s1, squads.s2) : total;
      const over = !cap.openEnded && worst > cap.points;
      lines.push(`Battle size: ${cap.name}, ${limit} points${over ? ' — over the cap' : ''}`);
    }
    return lines.join('\n');
  }
}
