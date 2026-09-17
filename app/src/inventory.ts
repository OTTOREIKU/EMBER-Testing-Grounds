import type { Card } from './types';
import { boxCoverUrl, cardName, isListedBox } from './data';
import { confirmDialog } from './dialog';
import { collectionOn, copiesOf, hasAny, loadCollection, onCollection, saveCollection, setCollectionOn, type CardIndex, type Collection } from './collection';
// The rows, the exclusivity rule and the two-column comparison live in
// boxcompare.ts, shared with the reference's Boxes tab. This class keeps what
// is the inventory's own: the owned counts, the flyouts, the box grid.
import { boxItems, boxPicker, boxesOf, compareGrid, esc, exclusiveToggle, FACTION_SHORT, sharedCount, type BoxInfo } from './boxcompare';

export type { BoxInfo };

const PEEK_MS = 1500;

export class Inventory {
  private boxes: BoxInfo[];
  private onChange: () => void;
  private data: CardIndex;
  private cards: Card[];
  private facChoice = '';
  private singleSearch = '';
  // Which two boxes the compare panel is showing. Kept on the instance so
  // reopening the dialog does not lose the pair.
  private cmp: [string, string] = ['', ''];

  constructor(boxes: BoxInfo[], onChange: () => void, data: CardIndex | Card[]) {
    this.boxes = boxes;
    this.onChange = onChange;
    // A bare card list still works, for the tests that hand one in.
    this.data = Array.isArray(data) ? { cards: data, byId: new Map(data.map((c) => [c.id, c])) } : data;
    this.cards = this.data.cards;
    // The store changes under this page too: the pad on the same account, or
    // the sync after signing in. The roster repaints either way.
    onCollection(() => this.onChange());
  }

  // The collection store is the one copy (collection.ts). These are the
  // board's old names over it, so the roster and the filter read as before.
  private col(): Collection {
    return loadCollection();
  }

  get filterEnabled(): boolean {
    return collectionOn();
  }

  set filterEnabled(on: boolean) {
    setCollectionOn(on);
  }

  hasAny(): boolean {
    return hasAny(this.col());
  }

  ownedCount(card: Card): number {
    return copiesOf(this.data, this.col(), card);
  }

  private setBox(key: string, n: number): void {
    const col = this.col();
    if (n <= 0) delete col.boxes[key];
    else col.boxes[key] = n;
    saveCollection(col);
    this.onChange();
  }

  private setSingle(id: string, n: number): void {
    const col = this.col();
    if (n <= 0) delete col.cards[id];
    else col.cards[id] = Math.min(99, n);
    saveCollection(col);
    this.onChange();
  }

  // The built pieces: the models assembled from the boxes, by card. An entry
  // overrides the box count for that card (collection.ts).
  private singlesHtml(): string {
    const col = this.col();
    const held = Object.entries(col.cards)
      .map(([id, n]) => ({ card: this.data.byId.get(id), id, n }))
      .filter((e) => e.card)
      .sort((a, b) => cardName(a.card).localeCompare(cardName(b.card)));
    const q = this.singleSearch.trim().toLowerCase();
    const found = q
      ? this.cards.filter((c) => cardName(c).toLowerCase().includes(q) || c.id.includes(q)).slice(0, 8)
      : [];
    return `<div class="inv-singles">
      <div class="inv-contents-head"><b>Built pieces</b>
        <span class="inv-contents-sub">${held.length ? `${held.reduce((s, e) => s + e.n, 0)} piece${held.reduce((s, e) => s + e.n, 0) === 1 ? '' : 's'}` : 'none recorded'}</span></div>
      <input type="search" class="inv-single-search" placeholder="Find a card to record…" value="${esc(this.singleSearch)}">
      ${found.length ? `<ul class="inv-parts inv-found">${found.map((c) => `<li data-tip-card="${c.id}"><span class="ip-name">${esc(cardName(c))}</span><button class="inv-step" data-single-add="${c.id}" title="One more">+</button></li>`).join('')}</ul>` : ''}
      ${held.length ? `<ul class="inv-parts">${held.map((e) => `<li data-tip-card="${e.id}"><span class="ip-name">${esc(cardName(e.card))}</span><span class="ip-n">×${e.n}</span>
        <button class="inv-step" data-single-step="-1" data-single="${e.id}" title="One fewer">−</button>
        <button class="inv-step" data-single-step="1" data-single="${e.id}" title="One more">+</button></li>`).join('')}</ul>` : ''}
    </div>`;
  }

  passes(card: Card): boolean {
    if (!this.filterEnabled || !this.hasAny()) return true;
    // No box data at all means we cannot tell, so show it rather than imply you lack it.
    if (!(card.containedIn ?? []).length) return true;
    return this.ownedCount(card) > 0;
  }

  private sellableBoxes(): BoxInfo[] {
    return this.boxes.filter(isListedBox);
  }

  private factionFacets(): { id: string; label: string; n: number }[] {
    const all = this.sellableBoxes();
    const order = ['RDL', 'UN', 'GOF', 'PD', 'COLLABORATION'];
    const present = new Set<string>();
    for (const b of all) for (const f of b.faction ?? []) present.add(f);
    const known = order.filter((f) => present.has(f));
    const rest = [...present].filter((f) => !order.includes(f)).sort();
    return [
      { id: '', label: 'All sets', n: all.length },
      ...[...known, ...rest].map((f) => ({
        id: f,
        label: FACTION_SHORT[f] ?? f,
        n: all.filter((b) => (b.faction ?? []).includes(f)).length,
      })),
    ];
  }

  private visibleBoxes(): BoxInfo[] {
    const all = this.sellableBoxes();
    return this.facChoice ? all.filter((b) => (b.faction ?? []).includes(this.facChoice)) : all;
  }

  private boxContents(key: string) {
    return boxItems(this.cards, key);
  }

  private boxesOf(id: string): string[] {
    return boxesOf(this.cards, this.sellableBoxes(), id);
  }

  private showContents(dlg: HTMLElement, key: string): void {
    // Only ever one reading panel beside the box list. Both this and the compare
    // panel insert before .inv-panel, so leaving the other in place stacks them
    // into a third column instead of replacing it.
    dlg.querySelector('.inv-contents')?.remove();
    dlg.querySelector('.inv-compare')?.remove();
    const box = this.boxes.find((b) => b.key === key);
    const items = this.boxContents(key);
    const panel = document.createElement('div');
    panel.className = 'inv-contents';
    panel.dataset.box = key;
    const total = items.reduce((s, i) => s + i.n, 0);
    panel.innerHTML = `
      <button class="dlg-close inv-contents-close" title="Close">✕</button>
      <div class="inv-contents-head">
        <div>
          <b>${esc(box?.name.en || box?.name.zh || key)}</b>
          <span class="inv-contents-sub">${items.length} card${items.length === 1 ? '' : 's'} · ${total} piece${total === 1 ? '' : 's'}</span>
        </div>
      </div>
      ${
        items.length
          ? `<ul class="inv-parts">${items
              .map(
                (i) =>
                  `<li data-tip-card="${i.id}"><span class="ip-slot">${i.slot}</span><span class="ip-name">${esc(i.name)}</span>${i.n > 1 ? `<span class="ip-n">×${i.n}</span>` : ''}</li>`,
              )
              .join('')}</ul>`
          : '<p class="dim">No cards in the data are listed as coming from this box.</p>'
      }`;
    panel.querySelector('.inv-contents-close')!.addEventListener('click', () => {
      panel.remove();
      dlg.classList.remove('with-contents');
    });
    dlg.insertBefore(panel, dlg.querySelector('.inv-panel'));
    dlg.classList.add('with-contents');
  }

  // Two boxes side by side: covers on the outside, contents down the middle.
  // Deliberately states facts only - counts, which cards overlap, whether the
  // box is sold - and draws no conclusions from them.
  private showCompare(dlg: HTMLElement): void {
    // Read the toggle BEFORE tearing the panel down: the checkbox lives inside
    // it, so querying after the remove always answered false and the filter
    // silently never applied.
    const exclusiveOnly = dlg.querySelector<HTMLInputElement>('#inv-cmp-excl')?.checked ?? false;
    dlg.querySelector('.inv-compare')?.remove();
    const pool = this.sellableBoxes();

    // Opening compare while a box's card list is up should carry that box in as
    // the left side rather than strand it as a third column. Only on the way in:
    // the picker and the filter re-render through here too, and by then the
    // contents panel is long gone.
    const contents = dlg.querySelector<HTMLElement>('.inv-contents');
    if (contents) {
      const key = contents.dataset.box ?? '';
      contents.remove();
      if (pool.some((b) => b.key === key)) {
        this.cmp[0] = key;
        // Whatever the right side was stays, unless it is now the same box as
        // the left or no longer in the pool.
        if (this.cmp[1] === key || !pool.some((b) => b.key === this.cmp[1])) {
          this.cmp[1] = pool.find((b) => b.key !== key)?.key ?? '';
        }
      }
    }

    if (!this.cmp[0]) this.cmp = [pool[0]?.key ?? '', pool[1]?.key ?? ''];
    const panel = document.createElement('div');
    panel.className = 'inv-compare';

    const shared = sharedCount(this.cards, pool, this.cmp[0], this.cmp[1]);
    panel.innerHTML = `
      <button class="dlg-close inv-compare-close" title="Close">✕</button>
      <div class="inv-contents-head"><b>Compare boxes</b>
        <span class="inv-contents-sub">${shared} card${shared === 1 ? '' : 's'} in both</span></div>
      ${exclusiveToggle('inv-cmp-excl', exclusiveOnly, 'inv-cmp-filter')}
      ${compareGrid(this.cards, pool, this.cmp, exclusiveOnly, {
        picker: (side) => boxPicker(pool, side, this.cmp[side]),
        rowAttr: (id) => `data-tip-card="${id}"`,
        owned: (key) => this.col().boxes[key] ?? 0,
      })}`;

    panel.querySelector('.inv-compare-close')!.addEventListener('click', () => {
      panel.remove();
      dlg.classList.remove('with-contents');
    });
    panel.querySelectorAll<HTMLSelectElement>('.inv-cmp-pick').forEach((sel) =>
      sel.addEventListener('change', () => {
        this.cmp[Number(sel.dataset.side) as 0 | 1] = sel.value;
        this.showCompare(dlg);
      }),
    );
    panel.querySelector('#inv-cmp-excl')!.addEventListener('change', () => this.showCompare(dlg));
    dlg.insertBefore(panel, dlg.querySelector('.inv-panel'));
    dlg.classList.add('with-contents');
  }

  openDialog(): void {
    document.getElementById('inv-dialog')?.remove();
    const dlg = document.createElement('div');
    dlg.id = 'inv-dialog';
    const owned = this.col().boxes;
    dlg.innerHTML = `<div class="inv-panel">
      <button id="inv-close" class="dlg-close" title="Close">✕</button>
      <div class="inv-head">
        <b>My inventory</b>
        <button id="inv-compare-open" class="inv-cmp-btn">Compare boxes</button>
        ${this.hasAny() ? '<button id="inv-clear" class="inv-cmp-btn">Clear</button>' : ''}
      </div>
      <p class="dim">Set how many copies of each box you own, and record the pieces you have built. Card lists then show your available copy counts. Signed in, the collection follows your account to the pad.</p>
      <div class="inv-facets">
        ${this.factionFacets()
          .map(
            (f) =>
              `<button class="inv-facet${this.facChoice === f.id ? ' on' : ''}"${f.id ? ` data-fac-filter="${f.id}"` : ' data-fac-filter=""'}>${f.label}<span class="inv-facet-n">${f.n}</span></button>`,
          )
          .join('')}
        <label class="inv-filter"><input type="checkbox" id="inv-filter" ${this.filterEnabled ? 'checked' : ''}><span class="inv-tick"></span> Only show what I own</label>
      </div>
      <div class="inv-list">
        ${this.visibleBoxes()
          .map((b) => {
            const n = owned[b.key] ?? 0;
            const fac = (b.faction ?? [])[0] ?? '';
            return `<div class="inv-box${n > 0 ? ' owned' : ''}"${fac ? ` data-fac="${fac}"` : ''}>
              ${b.hasImage ? `<div class="inv-cover" aria-hidden="true"><img src="${boxCoverUrl(b.id)}" alt="" loading="lazy" onerror="this.closest('.inv-cover').remove()"><span class="inv-scrim"></span></div>` : ''}
              <div class="inv-box-main">
                ${
                  (b.faction ?? []).length
                    ? `<span class="inv-facs">${(b.faction ?? [])
                        .map((f) => `<span class="inv-fac" data-fac="${f}">${FACTION_SHORT[f] ?? f}</span>`)
                        .join('')}</span>`
                    : ''
                }
                <div class="inv-name">${esc(b.name.en || b.name.zh || b.key)}</div>
                <div class="inv-count">
                  <button class="inv-step" data-step="-1" data-box="${b.key}" title="One fewer">−</button>
                  <input type="number" min="0" max="9" data-box="${b.key}" value="${n}" aria-label="${esc(b.name.en || b.key)} copies owned">
                  <button class="inv-step" data-step="1" data-box="${b.key}" title="One more">+</button>
                  <button class="inv-info" data-info="${b.key}" title="What is in this box" aria-label="Contents of ${esc(b.name.en || b.key)}">i</button>
                </div>
              </div>
            </div>`;
          })
          .join('')}
      </div>
      ${this.singlesHtml()}
    </div>`;
    dlg.addEventListener('click', (ev) => {
      if (ev.target === dlg) dlg.remove();
    });
    dlg.querySelector('#inv-close')!.addEventListener('click', () => dlg.remove());
    dlg.querySelector('#inv-compare-open')!.addEventListener('click', () => this.showCompare(dlg));
    dlg.querySelector('#inv-clear')?.addEventListener('click', () => {
      void confirmDialog({
        title: 'Clear the collection?',
        body: 'Every box count and built piece is removed, here and on your account.',
        confirmLabel: 'Clear it',
        cancelLabel: 'Keep it',
      }).then((go) => {
        if (!go) return;
        saveCollection({ boxes: {}, cards: {}, updatedAt: 0 });
        this.onChange();
        this.openDialog();
      });
    });
    dlg.querySelector<HTMLInputElement>('#inv-filter')!.addEventListener('change', (ev) => {
      this.filterEnabled = (ev.target as HTMLInputElement).checked;
      this.onChange();
    });
    const setCount = (inp: HTMLInputElement, next: number): void => {
      const n = Math.min(9, Math.max(0, next));
      inp.value = String(n);
      inp.closest('.inv-box')?.classList.toggle('owned', n > 0);
      this.setBox(inp.dataset.box!, n);
    };
    // The built pieces: search adds, the steppers adjust. Both redraw the
    // dialog, which is what keeps the list and the counts honest.
    const singles = dlg.querySelector<HTMLElement>('.inv-singles')!;
    const search = singles.querySelector<HTMLInputElement>('.inv-single-search')!;
    search.addEventListener('input', () => {
      this.singleSearch = search.value;
      const at = search.selectionStart;
      this.openDialog();
      const again = document.querySelector<HTMLInputElement>('#inv-dialog .inv-single-search');
      if (again) { again.focus(); if (at !== null) again.setSelectionRange(at, at); }
    });
    singles.querySelectorAll<HTMLButtonElement>('[data-single-add]').forEach((btn) =>
      btn.addEventListener('click', () => {
        this.setSingle(btn.dataset.singleAdd!, (this.col().cards[btn.dataset.singleAdd!] ?? 0) + 1);
        this.singleSearch = '';
        this.openDialog();
      }),
    );
    singles.querySelectorAll<HTMLButtonElement>('[data-single-step]').forEach((btn) =>
      btn.addEventListener('click', () => {
        const id = btn.dataset.single!;
        this.setSingle(id, (this.col().cards[id] ?? 0) + Number(btn.dataset.singleStep));
        this.openDialog();
      }),
    );
    dlg.querySelectorAll<HTMLInputElement>('input[data-box]').forEach((inp) =>
      inp.addEventListener('change', () => setCount(inp, Number(inp.value) || 0)),
    );
    dlg.querySelectorAll<HTMLButtonElement>('.inv-step').forEach((btn) =>
      btn.addEventListener('click', () => {
        const inp = btn.parentElement?.querySelector<HTMLInputElement>('input[data-box]');
        if (inp) setCount(inp, (Number(inp.value) || 0) + Number(btn.dataset.step));
      }),
    );

    dlg.querySelectorAll<HTMLButtonElement>('[data-fac-filter]').forEach((btn) =>
      btn.addEventListener('click', () => {
        this.facChoice = btn.dataset.facFilter ?? '';
        this.openDialog();
      }),
    );

    dlg.querySelectorAll<HTMLButtonElement>('.inv-info').forEach((btn) =>
      btn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        this.showContents(dlg, btn.dataset.info!);
      }),
    );

    const timers = new WeakMap<HTMLElement, number>();
    const peek = (card: HTMLElement): void => {
      if (!card.querySelector('.inv-cover')) return;
      window.clearTimeout(timers.get(card));
      card.classList.add('peek');
      timers.set(
        card,
        window.setTimeout(() => card.classList.remove('peek'), PEEK_MS),
      );
    };
    dlg.querySelectorAll<HTMLElement>('.inv-box').forEach((card) => {
      card.addEventListener('pointerenter', () => peek(card));
      card.addEventListener('pointerleave', () => {
        window.clearTimeout(timers.get(card));
        card.classList.remove('peek');
      });
      card.addEventListener('click', (ev) => {
        if ((ev.target as Element).closest('.inv-count')) return;
        peek(card);
      });
    });
    document.body.appendChild(dlg);
  }
}
