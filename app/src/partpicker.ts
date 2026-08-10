import type { Card } from './types';
import { cardImageUrl, cardName, FACTION_LABEL, type GameData } from './data';
import { factionColour, ICON_COMPARE } from './icons';
import { expandGlyphs } from './glyphs';

const esc = (s: string): string =>
  s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

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
  // One action makes a row click perform it, which is what a single-slot picker
  // wants. More than one leaves the row as a preview and makes the buttons the
  // only way to commit, since a click would not say which one you meant.
  actions: PickAction[];
}

interface Slot {
  el: HTMLElement;
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

  const back = document.createElement('div');
  back.className = 'dlg-back pp-back';
  back.innerHTML = `<div class="pp-panel" role="dialog" aria-modal="true">
    <button class="dlg-close" data-cancel title="Close">✕</button>
    <h3 class="pp-title">${esc(o.slotLabel)}<small>${all.length} card${all.length === 1 ? '' : 's'}</small></h3>
    <div class="pp-body">
      <div class="pp-preview"></div>
      <div class="pp-list">
        <input type="search" class="pp-search" placeholder="Search…">
        <div class="pp-rows"></div>
        <p class="pp-hint">${
          o.actions.length === 1
            ? `Click a card to use it. ${ICON_COMPARE} pins one to compare, then hover the list.`
            : `Hover to read a card, click or ${ICON_COMPARE} to hold it, then add it from the buttons.`
        }</p>
      </div>
    </div>
  </div>`;

  const panel = back.querySelector<HTMLElement>('.pp-panel')!;
  const preview = panel.querySelector<HTMLElement>('.pp-preview')!;
  const rows = panel.querySelector<HTMLElement>('.pp-rows')!;
  const searchEl = panel.querySelector<HTMLInputElement>('.pp-search')!;

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
    el.innerHTML = `<div class="pp-art"><img alt=""></div>
      <div class="pp-cap"><span class="pp-cap-name"></span><span class="pp-cap-meta"></span><span class="pp-cap-trait"></span></div>
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
  blank.textContent = 'Hover a card to read it here. Pin one to compare two side by side.';
  preview.appendChild(blank);

  function previewIds(): string[] {
    if (pinned.length >= MAX_PINNED) return pinned.slice(0, MAX_PINNED);
    if (pinned.length === 1) {
      const other = hoverId && hoverId !== pinned[0] ? hoverId : null;
      return other ? [pinned[0], other] : [pinned[0]];
    }
    const one = hoverId ?? o.chosen ?? null;
    return one ? [one] : [];
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
      }
      const f = o.data.factionOf(card);
      s.el.classList.toggle('pinned', pinned.includes(id));
      s.el.classList.toggle('chosen', id === o.chosen);
      s.name.textContent = cardName(card);
      s.meta.innerHTML = `<i class="pp-dot" style="background:${factionColour(f)}"></i>${
        esc(f ? (FACTION_LABEL[f] ?? f) : 'Faction not recorded')
      } · ${card.score ?? 0}p`;
      // Pinning one pilot and running the cursor down the list is what this
      // window is for, and for a pilot the thing being compared is the trait.
      // Only a NAMED trait is a rule: every generic Scout and Shock Troop also
      // carries traitDescription text, but theirs is flavour ("A new Scout from
      // Test and Evaluation Squadron 066"). The trait name itself is
      // Chinese-only in the data, so only the English description is shown.
      const traitText =
        card.category === 'pilot' && (card.trait ?? '').trim()
          ? (card.traitDescription?.en ?? '').trim().replace(/^[•·]\s*/, '')
          : '';
      s.trait.innerHTML = traitText ? expandGlyphs(esc(traitText)) : '';
      s.trait.classList.toggle('off', !traitText);
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

  function paintRows(): void {
    const q = search.trim().toLowerCase();
    rows.replaceChildren();
    let shown = 0;
    for (const g of o.groups) {
      const members = g.cards.filter(
        (c) => !q || cardName(c).toLowerCase().includes(q) || c.id.toLowerCase().includes(q),
      );
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
        const badge = o.badge?.(c) ?? '';
        item.innerHTML = `<button class="pp-row${off ? ' off-faction' : ''}${
          c.id === o.chosen ? ' sel' : ''
        }" data-pick="${esc(c.id)}"${
          off ? ` title="${esc(`${g.faction} card. This mech is locked to ${o.lockedFaction} by what you have already picked.`)}"` : ''
        }>
          <span class="pp-nm"></span>${badge ? '<span class="pp-bg"></span>' : ''}<span class="pp-pt">${
          c.score ? `${c.score}p` : '—'
        }</span>
        </button>
        <button class="pp-cmp" data-cmp="${esc(c.id)}" title="Compare this card">${ICON_COMPARE}</button>`;
        item.querySelector('.pp-nm')!.textContent = cardName(c);
        if (badge) item.querySelector('.pp-bg')!.textContent = badge;
        rows.appendChild(item);
      }
    }
    if (!shown) {
      const none = document.createElement('p');
      none.className = 'pp-none';
      none.textContent = 'Nothing matches that search.';
      rows.appendChild(none);
    }
  }

  // ---------- wiring ----------

  back.addEventListener('pointerdown', (ev) => {
    if (ev.target === back) close();
  });
  panel.querySelector<HTMLButtonElement>('[data-cancel]')!.addEventListener('click', close);

  searchEl.addEventListener('input', () => {
    search = searchEl.value;
    paintRows();
  });

  rows.addEventListener('mouseover', (ev) => {
    const item = (ev.target as Element).closest<HTMLElement>('.pp-item');
    const id = item?.dataset.id ?? null;
    if (id === hoverId) return;
    hoverId = id;
    paintPreview();
  });
  rows.addEventListener('mouseleave', () => {
    if (hoverId === null) return;
    hoverId = null;
    paintPreview();
  });

  const single = o.actions.length === 1;

  const run = (id: string, act: PickAction): void => {
    const card = byId.get(id);
    if (!card) return;
    close();
    act.run(card);
  };

  rows.addEventListener('click', (ev) => {
    const cmp = (ev.target as Element).closest<HTMLElement>('[data-cmp]');
    if (cmp) {
      togglePin(cmp.dataset.cmp!);
      return;
    }
    const row = (ev.target as Element).closest<HTMLElement>('[data-pick]');
    if (!row) return;
    // With one action the row IS the action, which is what a slot picker wants.
    // With several the click would not say which, so it holds the card instead.
    if (single) run(row.dataset.pick!, o.actions[0]);
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
  paintRows();
  paintPreview();
  searchEl.focus();
}
