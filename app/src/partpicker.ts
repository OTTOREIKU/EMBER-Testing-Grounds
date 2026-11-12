import type { Card, MechLoadout } from './types';
import { BASE_FACTIONS, cardImageUrl, cardName, FACTION_LABEL, mechArtLayers, mechPartUrl, traitName, type GameData } from './data';
import { factionColour, ICON_COMPARE, ICON_LOCK } from './icons';

// The faction lock opened: the shackle lifted off one side.
const ICON_UNLOCK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"'
  + ' stroke-linejoin="round" stroke-linecap="round" aria-hidden="true">'
  + '<rect x="4.6" y="10.4" width="14.8" height="11.2" rx="2.2"/>'
  + '<path d="M8.2 10.4V7.6a3.8 3.8 0 0 1 7.3-1.4"/></svg>';
import { expandGlyphs } from './glyphs';
import { printsWide } from './images';

const esc = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

// Grouping for the picker's list, shared so the mech builder, the drone list and
// the Load picker cannot drift into different orders.
export function groupByFaction(data: GameData, cards: Card[]): { faction: string; cards: Card[] }[] {
  const groups = new Map<string, Card[]>();
  for (const c of cards) {
    const key = data.factionOf(c) ?? '';
    const list = groups.get(key);
    if (list) list.push(c);
    else groups.set(key, [c]);
  }
  const order = [...BASE_FACTIONS, 'PD', 'COLLABORATION'];
  return [...groups.keys()]
    .sort((a, b) => {
      const ai = order.indexOf(a);
      const bi = order.indexOf(b);
      return (ai < 0 ? order.length : ai) - (bi < 0 ? order.length : bi);
    })
    .map((faction) => ({ faction, cards: groups.get(faction)! }));
}

export interface PickAction {
  label: string;
  // A squad button carries its squad's faction colour, the way the Add lists do.
  tint?: string;
  // Whether this card may go there. A failure dims the button and explains
  // itself in the title; it is never disabled, because the app warns rather
  // than blocks.
  check?(card: Card): { ok: boolean; why: string };
  run(card: Card): void;
}

export interface PartPickerOpts {
  data: GameData;
  // What the caller calls this list, so the window and the control that opened
  // it read as one thing.
  slotLabel: string;
  // Already filtered and sorted by the caller. The mech builder passes the very
  // list its <select> is built from, so the two cannot drift.
  groups: { faction: string; cards: Card[] }[];
  chosen?: string;
  // The faction a mech is already committed to, or null when the question does
  // not apply. A drone list leaves this null because legality there depends on
  // which squad you are adding to, so its action buttons carry the warning
  // instead of the row.
  lockedFaction?: string | null;
  badge?(card: Card): string;
  // How many copies of this card the collection still has to put down, or
  // null for no limit (the collection is off, or the data cannot place the
  // card). A card with none left is hidden until the list is asked to show
  // everything, and then drawn dimmed with its count.
  remaining?(card: Card): number | null;
  // One action makes a row click perform it, which is what a single-slot picker
  // wants. More than one leaves the row as a preview and makes the buttons the
  // only way to commit, since a click would not say which one you meant.
  actions: PickAction[];
  // THE BENCH (OTTO, 2026-11-11, mockup 08 "stacked"): when the list is one
  // slot of a mech, the window opens with that mech on the left wearing
  // whichever card is being looked at, the new part lit, and the unit's
  // points with it. openMechSlot passes it; every other list leaves it out.
  bench?: {
    title: string;
    slotKey: keyof MechLoadout;
    loadout: MechLoadout;
    points(m: MechLoadout): number;
  };
}

interface Slot {
  el: HTMLElement;
  tag: HTMLElement;
  img: HTMLImageElement;
  name: HTMLElement;
  meta: HTMLElement;
  trait: HTMLElement;
  uses: HTMLButtonElement[];
  drop: HTMLButtonElement;
  id: string | null;
}

// Up to two cards are shown at once. Pinning one and then running the cursor
// down the list compares every candidate against it without any further
// clicking, which is the case this window exists for.
const MAX_PINNED = 2;

export function openPartPicker(o: PartPickerOpts): void {
  const all = o.groups.flatMap((g) => g.cards);
  const byId = new Map(all.map((c) => [c.id, c]));
  const pinned: string[] = [];
  let hoverId: string | null = null;
  let search = '';
  // Whether cards the collection has none of are listed (see `remaining`).
  let showAll = false;

  const back = document.createElement('div');
  back.className = 'dlg-back pp-back';
  const facs = o.groups.filter((g) => g.cards.length);
  // THE FACTION LOCK (OTTO, 2026-11-12: "if I select swap on a RDL torso on an
  // RDL mech only the RDL parts are visible"). A mech committed to a faction
  // lists only that faction's cards (and any whose faction is not recorded)
  // until the lock is opened; opened, the others show dimmed as before.
  const lockFac = o.lockedFaction ?? null;
  const offFaction = (g: { faction: string }): boolean => !!lockFac && !!g.faction && g.faction !== lockFac;
  const canLock = !!lockFac && facs.some(offFaction);
  let locked = canLock;
  back.innerHTML = `<div class="pp-panel${o.bench ? ' has-bench' : ''}" role="dialog" aria-modal="true">
    <button class="dlg-close" data-cancel title="Close">✕</button>
    <h3 class="pp-title"><span class="pp-kick">${esc(o.slotLabel)} · ${all.length} card${all.length === 1 ? '' : 's'}</span>${o.bench ? `<span class="pp-unit">${esc(o.bench.title)}</span>` : ''}</h3>
    <div class="pp-body">
      ${o.bench ? `<div class="pp-bench">
        <div class="pp-plate"><div class="pp-plate-top"><span class="pp-lbl">Preview</span><span class="pp-total"></span></div><div class="pp-mech"></div></div>
        <button class="pp-fit" data-fit></button>
      </div>` : ''}
      <div class="pp-list">
        <input type="search" class="pp-search" placeholder="Search…">
        ${facs.length > 1 ? `<div class="pp-facets${canLock ? ' locked' : ''}">${canLock ? `<button class="pp-facet pp-lock on" data-lock aria-pressed="true"></button>` : ''}<button class="pp-facet pp-fac on" data-fac="">All<span>${all.length}</span></button>${facs
          .map((g) => `<button class="pp-facet pp-fac" data-fac="${esc(g.faction || '__none')}"><i class="pp-dot" style="background:${factionColour(g.faction || null)}"></i>${esc(g.faction ? (FACTION_LABEL[g.faction] ?? g.faction) : 'Other')}<span>${g.cards.length}</span></button>`)
          .join('')}</div>` : ''}
        <div class="pp-rows"></div>
        <p class="pp-hint">${
          o.actions.length === 1
            ? `Click a card to use it. ${ICON_COMPARE} pins one to compare, then hover the list.`
            : `Hover to read a card, click or ${ICON_COMPARE} to hold it, then add it from the buttons.`
        }</p>
      </div>
      <div class="pp-preview"></div>
    </div>
  </div>`;

  const panel = back.querySelector<HTMLElement>('.pp-panel')!;
  const preview = panel.querySelector<HTMLElement>('.pp-preview')!;
  const rows = panel.querySelector<HTMLElement>('.pp-rows')!;
  const searchEl = panel.querySelector<HTMLInputElement>('.pp-search')!;
  const benchEl = panel.querySelector<HTMLElement>('.pp-bench');
  let facFilter: string | null = null;

  const close = (): void => {
    document.removeEventListener('keydown', onKey, true);
    back.remove();
  };
  const onKey = (ev: KeyboardEvent): void => {
    if (ev.key !== 'Escape') return;
    ev.stopPropagation();
    ev.preventDefault();
    close();
  };

  // ---------- the preview column ----------

  function makeSlot(): Slot {
    const el = document.createElement('div');
    el.className = 'pp-slot';
    el.innerHTML = `<div class="pp-art"><img alt=""><div class="card-ph" role="img"><span></span></div></div>
      <div class="pp-cap"><span class="pp-cap-tag"></span><span class="pp-cap-name"></span><span class="pp-cap-meta"></span><span class="pp-cap-trait"></span></div>
      <div class="pp-cap-btns">${o.actions
        .map((a, i) => `<button class="pp-use" data-act="${i}"${
          a.tint ? ` style="--use-tint:${a.tint}"` : ''
        }>${esc(a.label)}</button>`)
        .join('')}<button class="pp-drop" title="Stop comparing this card">Unpin</button></div>`;
    const img = el.querySelector('img')!;
    img.addEventListener('error', () => el.classList.add('noart'));
    img.addEventListener('load', () => el.classList.remove('noart'));
    preview.appendChild(el);
    return {
      el,
      tag: el.querySelector<HTMLElement>('.pp-cap-tag')!,
      img,
      name: el.querySelector<HTMLElement>('.pp-cap-name')!,
      meta: el.querySelector<HTMLElement>('.pp-cap-meta')!,
      trait: el.querySelector<HTMLElement>('.pp-cap-trait')!,
      uses: [...el.querySelectorAll<HTMLButtonElement>('.pp-use')],
      drop: el.querySelector<HTMLButtonElement>('.pp-drop')!,
      id: null,
    };
  }

  // Both slots stay in the DOM for the life of the window and are only ever
  // updated in place, so running the cursor down the list does not rebuild an
  // <img> per row and flicker the card that is already on screen.
  const slots = [makeSlot(), makeSlot()];

  const blank = document.createElement('p');
  blank.className = 'pp-blank';
  blank.textContent = 'Hover a card to read it here. Pin one to compare two, one above the other.';
  preview.appendChild(blank);

  function previewIds(): string[] {
    if (pinned.length >= MAX_PINNED) return pinned.slice(0, MAX_PINNED);
    if (pinned.length === 1) {
      const other = hoverId && hoverId !== pinned[0] ? hoverId : null;
      return other ? [pinned[0], other] : [pinned[0]];
    }
    // Nothing pinned: what is fitted now on top, what the cursor is on under
    // it, so every row is compared against the slot as it stands.
    if (o.chosen && byId.has(o.chosen) && hoverId && hoverId !== o.chosen) return [o.chosen, hoverId];
    const one = hoverId ?? o.chosen ?? null;
    return one ? [one] : [];
  }

  // The points a card adds or saves against the one fitted now.
  const chosenScore = o.chosen ? (byId.get(o.chosen)?.score ?? 0) : null;
  function delta(card: Card): string {
    if (chosenScore === null || card.id === o.chosen) return '';
    const v = (card.score ?? 0) - chosenScore;
    return `<span class="pp-delta ${v > 0 ? 'up' : v < 0 ? 'down' : 'same'}">${v > 0 ? '+' : v < 0 ? '−' : '±'}${Math.abs(v)}p</span>`;
  }

  // The card the bench shows on the mech: the one under the cursor, else the
  // last one pinned, else what is fitted.
  function benchId(): string | null {
    return hoverId ?? pinned[pinned.length - 1] ?? o.chosen ?? null;
  }

  let benchShown: string | null | undefined;
  function paintBench(): void {
    const b = o.bench;
    if (!b || !benchEl) return;
    const id = benchId();
    if (id === benchShown) return;
    benchShown = id;
    const m: MechLoadout = { ...b.loadout };
    if (id) m[b.slotKey] = id; else delete m[b.slotKey];
    const lit = id && id !== o.chosen ? mechPartUrl(id) : '';
    benchEl.querySelector<HTMLElement>('.pp-mech')!.innerHTML = mechArtLayers(m)
      .map((u) => `<img src="${esc(u)}" alt=""${u === lit ? ' class="lit"' : ''}>`).join('');
    benchEl.querySelectorAll<HTMLImageElement>('.pp-mech img').forEach((img) => img.addEventListener('error', () => img.remove()));
    const card = id ? byId.get(id) : undefined;
    benchEl.querySelector<HTMLElement>('.pp-total')!.innerHTML = `<span>${b.points(m)}<i>p</i></span>${card ? delta(card) : ''}`;
    const fit = benchEl.querySelector<HTMLButtonElement>('[data-fit]')!;
    fit.dataset.fit = id ?? '';
    fit.disabled = !id;
    fit.textContent = !card ? 'Point at a card' : id === o.chosen ? `${cardName(card)} is fitted` : `${o.actions[0]?.label ?? 'Fit'}: ${cardName(card)}`;
    fit.classList.toggle('same', id === o.chosen);
  }

  function paintPreview(): void {
    const ids = previewIds();
    preview.classList.toggle('two', ids.length > 1);
    preview.classList.toggle('empty', ids.length === 0);
    slots.forEach((s, i) => {
      const id = ids[i];
      s.el.classList.toggle('off', !id);
      if (!id) return;
      const card = byId.get(id);
      if (!card) return;
      if (s.id !== id) {
        s.id = id;
        s.el.classList.remove('noart');
        s.img.src = cardImageUrl(id);
        // Shown only while the card has no scan (partpicker.css .noart).
        const ph = s.el.querySelector<HTMLElement>('.card-ph')!;
        ph.classList.toggle('wide', printsWide(card));
        ph.setAttribute('aria-label', `${cardName(card)}, no card image`);
        ph.querySelector('span')!.textContent = cardName(card);
      }
      const f = o.data.factionOf(card);
      s.el.classList.toggle('pinned', pinned.includes(id));
      s.el.classList.toggle('chosen', id === o.chosen);
      s.el.classList.toggle('looking', ids.length > 1 && i === ids.length - 1 && !pinned.includes(id));
      s.tag.textContent = pinned.includes(id) ? 'Pinned' : id === o.chosen ? 'Fitted now' : ids.length > 1 ? 'Looking at' : '';
      s.name.textContent = cardName(card);
      s.meta.innerHTML = `<i class="pp-dot" style="background:${factionColour(f)}"></i>${
        esc(f ? (FACTION_LABEL[f] ?? f) : 'Faction not recorded')
      } · ${card.score ?? 0}p ${delta(card)}`;
      // Pinning one pilot and running the cursor down the list is what this
      // window is for, and for a pilot the thing being compared is the trait.
      // Only a NAMED trait is a rule: every generic Scout and Shock Troop also
      // carries traitDescription text, but theirs is flavour ("A new Scout from
      // Test and Evaluation Squadron 066").
      // The name leads the line now that the publisher's English for it is
      // merged in; it used to be text only, because the only name in the data
      // was Chinese.
      const named = card.category === 'pilot' && (card.trait ?? '').trim();
      const traitLabel = named ? traitName(card) : '';
      const traitText = named ? (card.traitDescription?.en ?? '').trim().replace(/^[•·]\s*/, '') : '';
      s.trait.innerHTML = traitLabel || traitText
        ? `${traitLabel ? `<b>${esc(traitLabel)}</b>${traitText ? ' ' : ''}` : ''}${expandGlyphs(esc(traitText))}`
        : '';
      s.trait.classList.toggle('off', !traitLabel && !traitText);
      s.uses.forEach((b, n) => {
        const act = o.actions[n];
        b.dataset.use = id;
        const verdict = act.check?.(card) ?? { ok: true, why: '' };
        b.classList.toggle('off-faction', !verdict.ok);
        // This window covers the details panel in the corner, so the reason has
        // nowhere else to go and stays on the button. Kept to two short lines.
        b.title = verdict.ok ? act.label : `${verdict.why} Allowed, but the squad will be flagged.`;
      });
      s.drop.dataset.drop = id;
      s.drop.classList.toggle('off', !pinned.includes(id));
    });
    paintBench();
  }

  function togglePin(id: string): void {
    const at = pinned.indexOf(id);
    if (at >= 0) pinned.splice(at, 1);
    else if (pinned.length >= MAX_PINNED) pinned.splice(0, 1, id);
    else pinned.push(id);
    paintRows();
    paintPreview();
  }

  // ---------- the list column ----------

  function paintLock(): void {
    const b = panel.querySelector<HTMLElement>('[data-lock]');
    if (!b || !lockFac) return;
    const name = FACTION_LABEL[lockFac] ?? lockFac;
    b.classList.toggle('on', locked);
    b.setAttribute('aria-pressed', String(locked));
    b.title = locked ? `Showing ${name} parts only, to match this mech. Click to see every faction.` : `Showing every faction. Click to lock the list to ${name}.`;
    b.innerHTML = `${locked ? ICON_LOCK : ICON_UNLOCK}${locked ? `${esc(name)} only` : 'All factions'}`;
    const n = locked ? facs.filter((g) => !offFaction(g)).reduce((k, g) => k + g.cards.length, 0) : all.length;
    const kick = panel.querySelector('.pp-kick');
    if (kick) kick.textContent = `${o.slotLabel} · ${n} card${n === 1 ? '' : 's'}`;
    panel.querySelector('.pp-facets')?.classList.toggle('locked', locked);
    // Locked, the faction filter has nothing to choose between.
    if (locked && facFilter !== null) {
      facFilter = null;
      panel.querySelectorAll('.pp-fac').forEach((x) => x.classList.toggle('on', (x as HTMLElement).dataset.fac === ''));
    }
  }

  function paintRows(): void {
    const q = search.trim().toLowerCase();
    rows.replaceChildren();
    let shown = 0;
    let hidden = 0;
    for (const g of o.groups) {
      if (facFilter !== null && (g.faction || '__none') !== facFilter) continue;
      if (locked && offFaction(g)) continue;
      const members = g.cards.filter(
        (c) => !q || cardName(c).toLowerCase().includes(q) || c.id.toLowerCase().includes(q),
      ).filter((c) => {
        if (showAll || !o.remaining) return true;
        if (o.remaining(c) === 0) { hidden++; return false; }
        return true;
      });
      if (!members.length) continue;
      const head = document.createElement('div');
      head.className = 'pp-group';
      head.innerHTML = `<i class="pp-dot" style="background:${factionColour(g.faction || null)}"></i>${
        esc(g.faction ? (FACTION_LABEL[g.faction] ?? g.faction) : 'Faction not recorded')
      }<b>${members.length}</b>`;
      rows.appendChild(head);
      for (const c of members) {
        shown++;
        const off = !!o.lockedFaction && !!g.faction && g.faction !== o.lockedFaction;
        const item = document.createElement('div');
        item.className = `pp-item${pinned.includes(c.id) ? ' pinned' : ''}`;
        item.dataset.id = c.id;
        const left = o.remaining?.(c) ?? null;
        const badge = [o.badge?.(c) ?? '', left === null ? '' : left === 0 ? 'none left' : `×${left} left`].filter(Boolean).join(' · ');
        item.innerHTML = `<button class="pp-row${off ? ' off-faction' : ''}${
          c.id === o.chosen ? ' sel' : ''
        }${left === 0 ? ' out' : ''}" data-pick="${esc(c.id)}"${
          off ? ` title="${esc(`${g.faction} card. This mech is locked to ${o.lockedFaction} by what you have already picked.`)}"` : ''
        }>
          <img class="pp-thumb" src="${esc(cardImageUrl(c.id))}" alt="" loading="lazy"><span class="pp-nm"></span>${badge ? '<span class="pp-bg"></span>' : ''}<span class="pp-pt">${
          c.score ? `${c.score}p` : '—'
        }</span>${delta(c) || '<span class="pp-delta none"></span>'}
        </button>
        <button class="pp-cmp" data-cmp="${esc(c.id)}" title="Compare this card">${ICON_COMPARE}</button>`;
        item.querySelector('.pp-nm')!.textContent = cardName(c);
        // A missing scan leaves the thumbnail's slot empty rather than broken.
        item.querySelector<HTMLImageElement>('.pp-thumb')!.addEventListener('error', (e) => (e.target as HTMLElement).classList.add('gone'));
        if (badge) item.querySelector('.pp-bg')!.textContent = badge;
        rows.appendChild(item);
      }
    }
    if (!shown) {
      const none = document.createElement('p');
      none.className = 'pp-none';
      none.textContent = hidden ? 'Nothing you have left matches that search.' : 'Nothing matches that search.';
      rows.appendChild(none);
    }
    // The shelf's own switch: the cards not in the collection, on request.
    if (o.remaining && (hidden || showAll)) {
      const all = document.createElement('button');
      all.className = 'pp-all';
      all.dataset.all = '1';
      all.textContent = showAll ? 'Hide the cards you have none of' : `Show ${hidden} card${hidden === 1 ? '' : 's'} you have none of`;
      rows.appendChild(all);
    }
  }

  // ---------- wiring ----------

  back.addEventListener('pointerdown', (ev) => {
    if (ev.target === back) close();
  });
  panel.querySelector<HTMLButtonElement>('[data-cancel]')!.addEventListener('click', close);

  panel.querySelector('.pp-facets')?.addEventListener('click', (ev) => {
    const lock = (ev.target as Element).closest<HTMLElement>('[data-lock]');
    if (lock) {
      locked = !locked;
      paintLock();
      paintRows();
      return;
    }
    const b = (ev.target as Element).closest<HTMLElement>('[data-fac]');
    if (!b) return;
    facFilter = b.dataset.fac || null;
    panel.querySelectorAll('.pp-fac').forEach((x) => x.classList.toggle('on', x === b));
    paintRows();
  });

  benchEl?.addEventListener('click', (ev) => {
    const fit = (ev.target as Element).closest<HTMLButtonElement>('[data-fit]');
    if (fit?.dataset.fit && o.actions[0]) run(fit.dataset.fit, o.actions[0]);
  });

  searchEl.addEventListener('input', () => {
    search = searchEl.value;
    paintRows();
  });

  // A phone's taps come with synthetic mouse events: the leave would blank the
  // preview under the finger on its way to the button. The tap sets the card.
  rows.addEventListener('mouseover', (ev) => {
    if (touch) return;
    const item = (ev.target as Element).closest<HTMLElement>('.pp-item');
    const id = item?.dataset.id ?? null;
    if (id === hoverId) return;
    hoverId = id;
    paintPreview();
  });
  rows.addEventListener('mouseleave', () => {
    // With a bench the last card looked at stays on the mech, so the pointer
    // can travel to the bench's Fit button without the card going away.
    if (touch || hoverId === null || o.bench) return;
    hoverId = null;
    paintPreview();
  });

  // One action makes a row click commit - on a pointer that hovers, because
  // the preview has already shown the card. A phone has no hover, so a tap
  // would add a card nobody has read: there the row holds it and the button
  // in the preview commits, the same as a multi-action picker.
  const touch = window.matchMedia('(hover: none)').matches;
  const single = o.actions.length === 1 && !touch;

  const run = (id: string, act: PickAction): void => {
    const card = byId.get(id);
    if (!card) return;
    close();
    act.run(card);
  };

  rows.addEventListener('click', (ev) => {
    if ((ev.target as Element).closest('[data-all]')) {
      showAll = !showAll;
      paintRows();
      return;
    }
    const cmp = (ev.target as Element).closest<HTMLElement>('[data-cmp]');
    if (cmp) {
      togglePin(cmp.dataset.cmp!);
      return;
    }
    const row = (ev.target as Element).closest<HTMLElement>('[data-pick]');
    if (!row) return;
    // With one action the row IS the action, which is what a slot picker wants.
    // With several the click would not say which, so it holds the card instead.
    // A phone has no hover: a tap SHOWS the card, as hovering would, and the
    // preview's button commits; only the compare button pins.
    if (single) run(row.dataset.pick!, o.actions[0]);
    else if (touch) { hoverId = row.dataset.pick!; paintRows(); paintPreview(); }
    else togglePin(row.dataset.pick!);
  });

  preview.addEventListener('click', (ev) => {
    // An off-faction button is dimmed and still works: the app warns rather
    // than blocks, and the Squads tab flags the result.
    const use = (ev.target as Element).closest<HTMLElement>('[data-use]');
    if (use) {
      run(use.dataset.use!, o.actions[Number(use.dataset.act ?? 0)]);
      return;
    }
    const drop = (ev.target as Element).closest<HTMLElement>('[data-drop]');
    if (drop && !drop.classList.contains('off')) togglePin(drop.dataset.drop!);
  });

  document.addEventListener('keydown', onKey, true);
  document.body.appendChild(back);
  paintLock();
  paintRows();
  paintPreview();
  searchEl.focus();
}
